#!/usr/bin/env python3
"""Ūkis - namų užduočių Home Assistant priedo serveris.

Naudoja tik standartinę Python biblioteką (be papildomų paketų).
Duomenys ir failai saugomi /data aplanke (patenka į HA atsargines kopijas).
"""
import calendar
import datetime as dt
import http.client
import time
import hashlib
import json
import os
import re
import secrets
import socket
import shutil
import sqlite3
import threading
import uuid
import zipfile
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote, parse_qs

DATA_DIR = os.environ.get("DATA_DIR", "/data")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
FILE_DIR = os.path.join(DATA_DIR, "files")
TMP_DIR = os.path.join(DATA_DIR, "tmp")
DB_PATH = os.path.join(DATA_DIR, "ukis.db")
PORT = int(os.environ.get("PORT", "8099"))
INGRESS_IP = "172.30.32.2"  # HA ingress proxy adresas
CHUNK_MAX = 9 * 1024 * 1024
UPLOAD_MAX = 600 * 1024 * 1024

os.makedirs(FILE_DIR, exist_ok=True)
shutil.rmtree(TMP_DIR, ignore_errors=True)
os.makedirs(TMP_DIR, exist_ok=True)

LOCK = threading.RLock()


def load_options():
    try:
        with open(os.path.join(DATA_DIR, "options.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


OPTIONS = load_options()
PIN = str(OPTIONS.get("pin") or "").strip()
AUTH_TOKEN = hashlib.sha256(("ukis:" + PIN).encode()).hexdigest() if PIN else ""

# ---------------------------------------------------------------- DB

# lentelė -> stulpeliai, kuriuos galima keisti per bendrą „save“ veiksmą
TABLES = {
    "sections": ["name", "emoji", "pos", "collapsed"],
    "tasks": ["section_id", "title", "notes", "due", "done", "done_at", "pos", "tags", "created", "repeat"],
    "subtasks": ["task_id", "title", "done", "pos"],
    "comments": ["task_id", "text", "created"],
    "files": ["task_id", "filename", "orig_name", "mime", "size", "created"],
    "tags": ["name", "emoji", "pos"],
    "task_log": ["task_id", "date", "due", "note"],
}
NUMERIC = {"pos", "collapsed", "section_id", "done", "task_id", "size"}
POS_GROUP = {"sections": None, "tags": None, "tasks": "section_id", "subtasks": "task_id"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sections (id INTEGER PRIMARY KEY, name TEXT, emoji TEXT DEFAULT '', pos INTEGER DEFAULT 0,
  collapsed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, section_id INTEGER, title TEXT, notes TEXT DEFAULT '',
  due TEXT, done INTEGER DEFAULT 0, done_at TEXT, pos INTEGER DEFAULT 0, tags TEXT DEFAULT '[]', created TEXT,
  repeat TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS subtasks (id INTEGER PRIMARY KEY, task_id INTEGER, title TEXT, done INTEGER DEFAULT 0,
  pos INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, task_id INTEGER, text TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, task_id INTEGER, filename TEXT, orig_name TEXT, mime TEXT,
  size INTEGER, created TEXT);
CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, name TEXT, emoji TEXT DEFAULT '', pos INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS task_log (id INTEGER PRIMARY KEY, task_id INTEGER, date TEXT, due TEXT, note TEXT DEFAULT '');
"""

DEFAULT_SETTINGS = {
    "done_keep_days": 1,   # kiek dienų atliktos užduotys dar rodomos perbrauktos
    "ha_days": 7,          # kiek dienų į priekį rodyti HA kortelėje
}
DEFAULT_SECTIONS = [("Darbai", "🔨"), ("Pirkiniai", "🛒"), ("Kada nors", "💡")]
DEFAULT_TAGS = [("Senukai", "🏬"), ("Ermitažas", "🏬")]


def now():
    return dt.datetime.now().isoformat(timespec="seconds")


def today():
    return dt.date.today().isoformat()


DB = sqlite3.connect(DB_PATH, check_same_thread=False)
DB.row_factory = sqlite3.Row


def rows(sql, args=()):
    return [dict(r) for r in DB.execute(sql, args).fetchall()]


def meta_get(key, default=None):
    r = DB.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    if not r:
        return default
    try:
        return json.loads(r["value"])
    except Exception:
        return r["value"]


def meta_set(key, value):
    DB.execute("INSERT OR REPLACE INTO meta(key, value) VALUES(?,?)", (key, json.dumps(value, ensure_ascii=False)))


def init_db():
    with LOCK:
        DB.executescript(SCHEMA)
        if meta_get("version") is None:
            meta_set("version", 1)
        s = meta_get("settings") or {}
        for k, v in DEFAULT_SETTINGS.items():
            s.setdefault(k, v)
        meta_set("settings", s)
        if meta_get("seeded") is None:
            for i, (n, e) in enumerate(DEFAULT_SECTIONS):
                DB.execute("INSERT INTO sections(name, emoji, pos) VALUES(?,?,?)", (n, e, i))
            for i, (n, e) in enumerate(DEFAULT_TAGS):
                DB.execute("INSERT INTO tags(name, emoji, pos) VALUES(?,?,?)", (n, e, i))
            meta_set("seeded", True)
        if not meta_get("ics_token"):
            meta_set("ics_token", secrets.token_hex(12))
        DB.commit()


def bump():
    meta_set("version", int(meta_get("version", 1)) + 1)


def version():
    return int(meta_get("version", 1))


def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        return v
    s = str(v).strip().replace(",", ".").replace(" ", "")
    try:
        f = float(s)
        return int(f) if f.is_integer() and "." not in s else f
    except ValueError:
        return None


def clean_date(v):
    v = (v or "").strip() if isinstance(v, str) else v
    if not v:
        return None
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(v)):
        raise ValueError(f"Bloga data: {v}")
    return v


def full_state():
    out = {"version": version(), "today": today(), "settings": meta_get("settings") or DEFAULT_SETTINGS}
    for t in TABLES:
        out[t] = rows(f"SELECT * FROM {t} ORDER BY id")
    return out


# ---------------------------------------------------------------- failai

def upload_path(uid):
    if not re.match(r"^[a-f0-9]{32}$", uid or ""):
        raise ValueError("Blogas įkėlimo ID")
    return os.path.join(TMP_DIR, uid + ".part")


def take_upload(uid, orig_name, prefix="f"):
    src = upload_path(uid)
    if not os.path.isfile(src):
        raise ValueError("Failas neįkeltas – bandykite dar kartą")
    ext = os.path.splitext(orig_name or "")[1].lower()
    if not re.match(r"^\.[a-z0-9]{1,6}$", ext):
        ext = ".bin"
    fn = f"{prefix}_{dt.date.today().strftime('%Y%m%d')}_{uuid.uuid4().hex[:10]}{ext}"
    shutil.move(src, os.path.join(FILE_DIR, fn))
    return fn, os.path.getsize(os.path.join(FILE_DIR, fn))


def remove_file(fn):
    if fn:
        try:
            os.remove(os.path.join(FILE_DIR, os.path.basename(fn)))
        except OSError:
            pass


# ---------------------------------------------------------------- veiksmai

def next_pos(t, group_val=None):
    g = POS_GROUP.get(t)
    if g:
        r = DB.execute(f"SELECT MAX(pos) FROM {t} WHERE {g} IS ?", (group_val,)).fetchone()
    else:
        r = DB.execute(f"SELECT MAX(pos) FROM {t}").fetchone()
    return (r[0] if r and r[0] is not None else -1) + 1


def act_save(d):
    t = d.get("t")
    if t not in TABLES:
        raise ValueError("Nežinoma lentelė")
    row = dict(d.get("row") or {})
    rid = row.get("id")
    if t == "files":
        raise ValueError("Failą reikia įkelti")
    if rid and t == "tasks" and "pos" in row and row["pos"] in (None, "") and row.get("section_id"):
        row["pos"] = next_pos("tasks", num(row["section_id"]))
    if not rid:
        if t in POS_GROUP and row.get("pos") in (None, ""):
            g = POS_GROUP[t]
            row["pos"] = next_pos(t, num(row.get(g)) if g else None)
        if t in ("tasks", "comments") and not row.get("created"):
            row["created"] = now()
    if t in ("sections", "tasks", "tags") and "name" in row and not str(row.get("name") or "").strip():
        raise ValueError("Įrašykite pavadinimą")
    if t == "tasks" and "title" in row and not str(row.get("title") or "").strip():
        raise ValueError("Įrašykite pavadinimą")
    if t == "tasks" and "done" in row:
        row["done_at"] = now() if num(row["done"]) else None
    cols = [c for c in TABLES[t] if c in row]
    vals = []
    for c in cols:
        v = row[c]
        if c in NUMERIC:
            v = num(v)
        elif c == "due":
            v = clean_date(v)
        elif c == "repeat":
            v = json.dumps(clean_repeat(v), ensure_ascii=False) if v else ""
        elif isinstance(v, (list, dict)):
            v = json.dumps(v, ensure_ascii=False)
        elif isinstance(v, str):
            v = v.strip()
        vals.append(v)
    if rid:
        if cols:
            DB.execute(f"UPDATE {t} SET {', '.join(c + '=?' for c in cols)} WHERE id=?", vals + [rid])
    else:
        cur = DB.execute(f"INSERT INTO {t}({', '.join(cols) or 'id'}) VALUES({', '.join('?' * len(cols)) or 'NULL'})", vals)
        rid = cur.lastrowid
    return {"id": rid}


def delete_task(tid):
    for r in rows("SELECT filename FROM files WHERE task_id=?", (tid,)):
        remove_file(r["filename"])
    for t in ("files", "subtasks", "comments", "task_log"):
        DB.execute(f"DELETE FROM {t} WHERE task_id=?", (tid,))
    DB.execute("DELETE FROM tasks WHERE id=?", (tid,))


def act_delete(d):
    t, rid = d.get("t"), d.get("id")
    if t not in TABLES:
        raise ValueError("Nežinoma lentelė")
    if t == "tasks":
        return delete_task(rid)
    if t == "sections":
        left = DB.execute("SELECT COUNT(*) FROM sections").fetchone()[0]
        if left <= 1:
            raise ValueError("Turi likti bent viena sekcija")
        move_to = num(d.get("move_to"))
        if move_to:
            start = next_pos("tasks", move_to)
            for i, r in enumerate(rows("SELECT id FROM tasks WHERE section_id=? ORDER BY pos, id", (rid,))):
                DB.execute("UPDATE tasks SET section_id=?, pos=? WHERE id=?", (move_to, start + i, r["id"]))
        else:
            for r in rows("SELECT id FROM tasks WHERE section_id=?", (rid,)):
                delete_task(r["id"])
    if t == "tags":
        for r in rows("SELECT id, tags FROM tasks WHERE tags LIKE ?", (f"%{int(rid)}%",)):
            try:
                tg = [x for x in json.loads(r["tags"] or "[]") if int(x) != int(rid)]
            except Exception:
                tg = []
            DB.execute("UPDATE tasks SET tags=? WHERE id=?", (json.dumps(tg), r["id"]))
    if t == "files":
        r = DB.execute("SELECT filename FROM files WHERE id=?", (rid,)).fetchone()
        if r:
            remove_file(r["filename"])
    DB.execute(f"DELETE FROM {t} WHERE id=?", (rid,))


def act_order_tasks(d):
    """items: [[užduoties id, sekcijos id], ...] – nauja tvarka (visa arba dalis sąrašo)."""
    cnt = {}
    for item in d.get("items", []) or []:
        tid, sid = int(item[0]), int(item[1])
        cnt[sid] = cnt.get(sid, -1) + 1
        DB.execute("UPDATE tasks SET section_id=?, pos=? WHERE id=?", (sid, cnt[sid], tid))


def act_order(d):
    t = d.get("t")
    if t not in ("sections", "tags", "subtasks"):
        raise ValueError("Netinkama lentelė")
    for i, rid in enumerate(d.get("ids", []) or []):
        DB.execute(f"UPDATE {t} SET pos=? WHERE id=?", (i, rid))


def act_file_add(d):
    tid = num(d.get("task_id"))
    if not tid:
        raise ValueError("Nenurodyta užduotis")
    fn, size = take_upload(d.get("upload"), d.get("orig_name"))
    cur = DB.execute("INSERT INTO files(task_id, filename, orig_name, mime, size, created) VALUES(?,?,?,?,?,?)",
                     (tid, fn, d.get("orig_name") or "", d.get("mime") or "", size, now()))
    return {"id": cur.lastrowid}


def act_settings_save(d):
    s = meta_get("settings") or dict(DEFAULT_SETTINGS)
    for k, dflt in DEFAULT_SETTINGS.items():
        if k in d:
            v = d[k]
            if isinstance(dflt, int):
                v = num(v)
                v = dflt if v is None else int(v)
            s[k] = v
    meta_set("settings", s)


def act_import(d):
    """Importas iš paprasto JSON (pvz. paruošto Claude pokalbyje). Tik papildo."""
    data = d.get("data")
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, dict):
        raise ValueError("Netinkamas failo formatas")
    cnt = {"sekcijos": 0, "uzduotys": 0}

    def tag_id(name):
        name = (name or "").strip()
        if not name:
            return None
        r = DB.execute("SELECT id FROM tags WHERE lower(name)=lower(?)", (name,)).fetchone()
        if r:
            return r["id"]
        return DB.execute("INSERT INTO tags(name, emoji, pos) VALUES(?,?,?)", (name, "", next_pos("tags"))).lastrowid

    for s in data.get("sekcijos", []) or []:
        name = (s.get("pavadinimas") or "").strip() or "Be pavadinimo"
        r = DB.execute("SELECT id FROM sections WHERE lower(name)=lower(?)", (name,)).fetchone()
        if r:
            sid = r["id"]
        else:
            sid = DB.execute("INSERT INTO sections(name, emoji, pos) VALUES(?,?,?)",
                             (name, s.get("emoji", ""), next_pos("sections"))).lastrowid
            cnt["sekcijos"] += 1
        for u in s.get("uzduotys", []) or []:
            title = (u.get("pavadinimas") or "").strip()
            if not title:
                continue
            tags = [x for x in (tag_id(n) for n in (u.get("zymos") or [])) if x]
            due = clean_date(u.get("data"))
            rep = ""
            k = u.get("kartojimas")
            if isinstance(k, dict):
                unit = {"d": "d", "dien": "d", "sav": "w", "men": "m", "mėn": "m", "m": "y", "met": "y"}.get(
                    str(k.get("vnt", "sav")).lower().rstrip("."), "w")
                due = due or today()
                rep = json.dumps(clean_repeat({"type": "after" if "atlik" in str(k.get("tipas", "")) else "cal",
                                               "every": k.get("kas", 1), "unit": unit, "next": due}))
            tid = DB.execute("""INSERT INTO tasks(section_id, title, notes, due, done, pos, tags, created, repeat)
                                VALUES(?,?,?,?,?,?,?,?,?)""",
                             (sid, title, u.get("aprasymas", ""), due,
                              1 if u.get("atlikta") else 0, next_pos("tasks", sid), json.dumps(tags), now(),
                              rep)).lastrowid
            for i, st in enumerate(u.get("subuzduotys", []) or []):
                DB.execute("INSERT INTO subtasks(task_id, title, pos) VALUES(?,?,?)", (tid, str(st).strip(), i))
            cnt["uzduotys"] += 1
    return {"imported": cnt}


# ---------------------------------------------------------------- kartojimai

def clean_repeat(v):
    if isinstance(v, str):
        v = json.loads(v)
    if not isinstance(v, dict):
        raise ValueError("Blogas kartojimas")
    every = int(num(v.get("every")) or 1)
    if every < 1 or every > 999:
        raise ValueError("Blogas kartojimo intervalas")
    unit = v.get("unit") if v.get("unit") in ("d", "w", "m", "y") else "w"
    typ = "after" if v.get("type") == "after" else "cal"
    return {"type": typ, "every": every, "unit": unit, "next": clean_date(v.get("next"))}


def add_iv(d, every, unit):
    if unit == "d":
        return d + dt.timedelta(days=every)
    if unit == "w":
        return d + dt.timedelta(weeks=every)
    months = every if unit == "m" else every * 12
    y, m = divmod(d.month - 1 + months, 12)
    y, m = d.year + y, m + 1
    return dt.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def task_repeat(t):
    try:
        r = json.loads(t["repeat"] or "null")
        return clean_repeat(r) if r else None
    except Exception:
        return None


def next_occurrence(t, r, done_day, skip=False):
    """Kita data po atlikimo / praleidimo."""
    if r["type"] == "after":
        if skip and t["due"]:
            return add_iv(dt.date.fromisoformat(t["due"]), r["every"], r["unit"])
        return add_iv(done_day, r["every"], r["unit"])
    base = dt.date.fromisoformat(r.get("next") or t["due"] or done_day.isoformat())
    nxt = add_iv(base, r["every"], r["unit"])
    while nxt <= dt.date.today() and nxt <= done_day:
        nxt = add_iv(nxt, r["every"], r["unit"])
    return nxt


def act_task_complete(d):
    t = DB.execute("SELECT * FROM tasks WHERE id=?", (d.get("id"),)).fetchone()
    if not t:
        raise ValueError("Užduotis nerasta")
    r = task_repeat(t)
    undo = {"id": t["id"], "due": t["due"] or "", "repeat": t["repeat"] or ""}
    if not r:
        DB.execute("UPDATE tasks SET done=1, done_at=? WHERE id=?", (now(), t["id"]))
        return {"undo": undo}
    skip = bool(d.get("skip"))
    log_id = None
    if not skip:
        log_id = DB.execute("INSERT INTO task_log(task_id, date, due, note) VALUES(?,?,?,?)",
                            (t["id"], today(), t["due"], d.get("note", ""))).lastrowid
        DB.execute("UPDATE subtasks SET done=0 WHERE task_id=?", (t["id"],))
    nxt = next_occurrence(t, r, dt.date.today(), skip).isoformat()
    r["next"] = nxt
    DB.execute("UPDATE tasks SET due=?, repeat=?, done=0, done_at=NULL WHERE id=?",
               (nxt, json.dumps(r), t["id"]))
    undo["log_id"] = log_id
    return {"next": nxt, "undo": undo}


def act_task_undo(d):
    tid = d.get("id")
    if d.get("log_id"):
        DB.execute("DELETE FROM task_log WHERE id=?", (d["log_id"],))
    if d.get("repeat"):
        DB.execute("UPDATE tasks SET due=?, repeat=?, done=0, done_at=NULL WHERE id=?",
                   (d.get("due") or None, d["repeat"], tid))
    else:
        DB.execute("UPDATE tasks SET done=0, done_at=NULL WHERE id=?", (tid,))


# ---------------------------------------------------------------- Home Assistant: jutiklis ir kalendorius

SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
HA_HOST = os.environ.get("UKIS_HA_HOST", "supervisor")
HA_PORT = int(os.environ.get("UKIS_HA_PORT", "80"))
HA_STATE = {"error": "", "last": ""}
CHANGED = threading.Event()


def log(*a):
    print(dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


def ha_request(method, path, body=None):
    conn = http.client.HTTPConnection(HA_HOST, HA_PORT, timeout=15)
    try:
        data = json.dumps(body).encode() if body is not None else None
        conn.request(method, "/core/api" + path, body=data, headers={
            "Authorization": "Bearer " + SUPERVISOR_TOKEN, "Content-Type": "application/json"})
        r = conn.getresponse()
        raw = r.read()
        if r.status >= 300:
            raise ValueError(f"Home Assistant atsakė {r.status}: {raw[:200].decode('utf-8', 'replace')}")
        return json.loads(raw) if raw else None
    finally:
        conn.close()


def days_text(n):
    if n < 0:
        return f"Vėluoja {-n} d."
    if n == 0:
        return "Šiandien"
    if n == 1:
        return "Rytoj"
    return f"Po {n} d."


def upcoming_items(horizon):
    t0 = dt.date.today()
    secs = {r["id"]: r for r in rows("SELECT * FROM sections")}
    out = []
    for t in rows("SELECT * FROM tasks WHERE done=0 AND due IS NOT NULL ORDER BY due, pos, id"):
        n = (dt.date.fromisoformat(t["due"]) - t0).days
        if n > horizon:
            continue
        s = secs.get(t["section_id"]) or {}
        out.append({"id": t["id"], "pavadinimas": t["title"], "data": t["due"], "dienos": n, "tekstas": days_text(n),
                    "sekcija": s.get("name", ""), "emoji": s.get("emoji", ""), "kartojasi": bool(task_repeat(t))})
    return out


def sensor_payload():
    st = meta_get("settings") or {}
    items = upcoming_items(int(st.get("ha_days", 7)))
    now_cnt = len([i for i in items if i["dienos"] <= 0])
    return {"state": now_cnt, "attributes": {
        "friendly_name": "Ūkis – artimiausi", "icon": "mdi:home-roof", "unit_of_measurement": "užd.",
        "items": items,
        "siandien": [i["pavadinimas"] for i in items if i["dienos"] == 0],
        "rytoj": [i["pavadinimas"] for i in items if i["dienos"] == 1],
        "veluoja": [i["pavadinimas"] for i in items if i["dienos"] < 0],
        "atnaujinta": now()}}


def sensor_loop():
    last = None
    while True:
        try:
            with LOCK:
                p = sensor_payload()
            key = json.dumps({**p, "attributes": {**p["attributes"], "atnaujinta": ""}}, sort_keys=True)
            # HA perkrovus būsena dingsta, todėl kas 10 min. siunčiama iš naujo
            if key != last or time.time() - HA_STATE.get("ts", 0) > 600:
                ha_request("POST", "/states/sensor.ukis_artimiausi", p)
                last, HA_STATE["ts"], HA_STATE["last"], HA_STATE["error"] = key, time.time(), now(), ""
        except Exception as e:  # noqa
            HA_STATE["error"] = str(e)
            log("HA jutiklio klaida:", e)
        CHANGED.wait(60)
        CHANGED.clear()


def ics_escape(s):
    return str(s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def build_ics():
    t0 = dt.date.today()
    until = t0 + dt.timedelta(days=200)
    secs = {r["id"]: r for r in rows("SELECT * FROM sections")}
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ukis//LT", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Ūkis"]
    stamp = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

    def ev(t, day, uid):
        s = secs.get(t["section_id"]) or {}
        lines.extend(["BEGIN:VEVENT", f"UID:{uid}@ukis", f"DTSTAMP:{stamp}",
                      f"DTSTART;VALUE=DATE:{day.strftime('%Y%m%d')}",
                      f"DTEND;VALUE=DATE:{(day + dt.timedelta(days=1)).strftime('%Y%m%d')}",
                      f"SUMMARY:{ics_escape(t['title'])}",
                      f"DESCRIPTION:{ics_escape((s.get('emoji', '') + ' ' + s.get('name', '')).strip() + (chr(10) + t['notes'] if t['notes'] else ''))}",
                      "TRANSP:TRANSPARENT", "END:VEVENT"])

    for t in rows("SELECT * FROM tasks WHERE done=0 AND due IS NOT NULL"):
        due = dt.date.fromisoformat(t["due"])
        ev(t, due, f"t{t['id']}-{due.isoformat()}")
        r = task_repeat(t)
        if r and r["type"] == "cal":
            d = dt.date.fromisoformat(r.get("next") or t["due"])
            for _ in range(400):
                d = add_iv(d, r["every"], r["unit"])
                if d > until:
                    break
                if d != due:
                    ev(t, d, f"t{t['id']}-{d.isoformat()}")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def export_zip():
    path = os.path.join(TMP_DIR, "export_" + uuid.uuid4().hex + ".zip")
    data = {"programa": "ukis", "eksportuota": now(),
            "meta": rows("SELECT * FROM meta"), "tables": {t: rows(f"SELECT * FROM {t}") for t in TABLES}}
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("data.json", json.dumps(data, ensure_ascii=False, indent=1))
        for fn in os.listdir(FILE_DIR):
            z.write(os.path.join(FILE_DIR, fn), "files/" + fn, compress_type=zipfile.ZIP_STORED)
    return path


def act_restore(d):
    src = upload_path(d.get("upload"))
    if not os.path.isfile(src):
        raise ValueError("Failas neįkeltas")
    try:
        with zipfile.ZipFile(src) as z:
            data = json.loads(z.read("data.json").decode("utf-8"))
            if data.get("programa") != "ukis":
                raise ValueError("Tai ne Ūkio atsarginė kopija")
            for t in TABLES:
                DB.execute(f"DELETE FROM {t}")
                for r in data["tables"].get(t, []):
                    cols = [c for c in r if c == "id" or c in TABLES[t]]
                    DB.execute(f"INSERT INTO {t}({','.join(cols)}) VALUES({','.join('?' * len(cols))})",
                               [r[c] for c in cols])
            for m in data.get("meta", []):
                if m["key"] != "version":
                    DB.execute("INSERT OR REPLACE INTO meta(key, value) VALUES(?,?)", (m["key"], m["value"]))
            for fn in os.listdir(FILE_DIR):
                os.remove(os.path.join(FILE_DIR, fn))
            for name in z.namelist():
                if name.startswith("files/") and not name.endswith("/"):
                    with z.open(name) as fsrc, open(os.path.join(FILE_DIR, os.path.basename(name)), "wb") as fdst:
                        shutil.copyfileobj(fsrc, fdst)
    except zipfile.BadZipFile:
        raise ValueError("Netinkamas ZIP failas")
    finally:
        os.remove(src)
    return {"ok": True}


ACTIONS = {
    "save": act_save, "delete": act_delete, "order_tasks": act_order_tasks, "order": act_order,
    "file_add": act_file_add, "task_complete": act_task_complete, "task_undo": act_task_undo, "settings_save": act_settings_save, "import": act_import, "restore": act_restore,
}

MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png",
        ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic",
        ".pdf": "application/pdf", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
        ".txt": "text/plain; charset=utf-8", ".zip": "application/zip"}


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "Ukis/1.0"

    def log_message(self, fmt, *args):
        if os.environ.get("DEBUG"):
            super().log_message(fmt, *args)

    def authed(self):
        if not PIN:
            return True
        if self.client_address[0] == INGRESS_IP:
            return True
        c = SimpleCookie(self.headers.get("Cookie", ""))
        return "ukis_auth" in c and secrets.compare_digest(c["ukis_auth"].value, AUTH_TOKEN)

    def send(self, code, body, ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, ctype, extra=None):
        size = os.path.getsize(path)
        start, end = 0, size - 1
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1024 * 256, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def read_body(self, limit):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise ValueError("Per didelė užklausa")
        return self.rfile.read(n) if n else b""

    def static(self, rel):
        rel = rel or "index.html"
        path = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not path.startswith(STATIC_DIR) or not os.path.isfile(path):
            path = os.path.join(STATIC_DIR, "index.html")
        ext = os.path.splitext(path)[1]
        extra = {"Cache-Control": "max-age=86400"} if "/pdf/" in path else None
        with open(path, "rb") as f:
            self.send(200, f.read(), MIME.get(ext, "application/octet-stream"), extra)

    def do_GET(self):
        url = urlparse(self.path)
        path = unquote(url.path).lstrip("/")
        if path in ("login", "login.html"):
            return self.static("login.html")
        m = re.match(r"^calendar/([a-f0-9]+)\.ics$", path)
        if m:
            with LOCK:
                ok = secrets.compare_digest(m.group(1), str(meta_get("ics_token") or "x"))
                body = build_ics() if ok else ""
            return self.send(200, body, "text/calendar; charset=utf-8") if ok else self.send(404, {"error": "Nerasta"})
        if not self.authed():
            if path.startswith("api/") or path.startswith("files/"):
                return self.send(401, {"error": "Reikia PIN"})
            if path.endswith((".js", ".css", ".png", ".webmanifest", ".svg")):
                return self.static(path)
            return self.static("login.html")
        try:
            if path == "api/state":
                with LOCK:
                    return self.send(200, full_state())
            if path == "api/ha":
                with LOCK:
                    tok = meta_get("ics_token")
                return self.send(200, {"ha": bool(SUPERVISOR_TOKEN), "error": HA_STATE["error"], "last": HA_STATE["last"],
                                       "ics": f"calendar/{tok}.ics", "host": socket.gethostname()})
            if path == "api/version":
                with LOCK:
                    return self.send(200, {"version": version()})
            if path == "api/export":
                with LOCK:
                    zp = export_zip()
                try:
                    name = "ukis-" + today() + ".zip"
                    self.send_file(zp, "application/zip", {"Content-Disposition": f'attachment; filename="{name}"'})
                finally:
                    os.remove(zp)
                return
            if path.startswith("files/"):
                fn = os.path.basename(path)
                fp = os.path.join(FILE_DIR, fn)
                if os.path.isfile(fp):
                    q = parse_qs(url.query)
                    extra = {"Cache-Control": "max-age=31536000"}
                    if q.get("dl"):
                        extra["Content-Disposition"] = f'attachment; filename="{fn}"'
                    return self.send_file(fp, MIME.get(os.path.splitext(fn)[1].lower(), "application/octet-stream"), extra)
                return self.send(404, {"error": "Failas nerastas"})
            return self.static(path)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as e:  # noqa
            return self.send(500, {"error": str(e)})

    def do_POST(self):
        url = urlparse(self.path)
        path = unquote(url.path).lstrip("/")
        try:
            if path == "api/login":
                d = json.loads(self.read_body(10000) or b"{}")
                if PIN and secrets.compare_digest(str(d.get("pin", "")), PIN):
                    return self.send(200, {"ok": True}, extra={
                        "Set-Cookie": f"ukis_auth={AUTH_TOKEN}; Path=/; Max-Age=31536000; SameSite=Lax"})
                return self.send(403, {"error": "Neteisingas PIN"})
            if not self.authed():
                return self.send(401, {"error": "Reikia PIN"})
            if path == "api/upload":
                q = parse_qs(url.query)
                uid, idx = q.get("u", [""])[0], int(q.get("i", ["0"])[0])
                p = upload_path(uid)
                body = self.read_body(CHUNK_MAX)
                if idx == 0 and os.path.exists(p):
                    os.remove(p)
                if idx > 0 and not os.path.exists(p):
                    raise ValueError("Įkėlimas nutrūko – bandykite dar kartą")
                if os.path.exists(p) and os.path.getsize(p) + len(body) > UPLOAD_MAX:
                    raise ValueError("Failas per didelis")
                with open(p, "ab") as f:
                    f.write(body)
                return self.send(200, {"ok": True, "size": os.path.getsize(p)})
            if path.startswith("api/do/"):
                fn = ACTIONS.get(path[len("api/do/"):])
                if not fn:
                    return self.send(404, {"error": "Nežinomas veiksmas"})
                d = json.loads(self.read_body(20 * 1024 * 1024).decode("utf-8") or "{}")
                with LOCK:
                    try:
                        res = fn(d) or {}
                        bump()
                        DB.commit()
                    except Exception:
                        DB.rollback()
                        raise
                    res["version"] = version()
                CHANGED.set()
                return self.send(200, res)
            return self.send(404, {"error": "Nerasta"})
        except ValueError as e:
            return self.send(400, {"error": str(e)})
        except Exception as e:  # noqa
            return self.send(500, {"error": f"Klaida: {e}"})


def main():
    init_db()
    if SUPERVISOR_TOKEN:
        threading.Thread(target=sensor_loop, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Ūkis veikia per prievadą {PORT}. Duomenys: {DATA_DIR}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
