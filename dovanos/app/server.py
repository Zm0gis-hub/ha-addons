#!/usr/bin/env python3
"""Dovanos - dovanų idėjų ir progų Home Assistant priedo serveris.

Naudoja tik standartinę Python biblioteką (be papildomų paketų).
Duomenys saugomi /data aplanke (patenka į HA atsargines kopijas).
"""
import base64
import datetime as dt
import hashlib
import html
import http.client
import socket
import struct
import time
import urllib.request
import uuid
import json
import os
import re
import secrets
import sqlite3
import threading
import io
import zipfile
import xml.etree.ElementTree as ET
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.parse
from urllib.parse import urlparse, unquote

DATA_DIR = os.environ.get("DATA_DIR", "/data")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
DB_PATH = os.path.join(DATA_DIR, "dovanos.db")
PHOTO_DIR = os.path.join(DATA_DIR, "photos")
PORT = int(os.environ.get("PORT", "8099"))
INGRESS_IP = "172.30.32.2"  # HA ingress proxy adresas

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PHOTO_DIR, exist_ok=True)
LOCK = threading.RLock()


def load_options():
    try:
        with open(os.path.join(DATA_DIR, "options.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


OPTIONS = load_options()
PIN = str(OPTIONS.get("pin") or "").strip()
AUTH_TOKEN = hashlib.sha256(("dovanos:" + PIN).encode()).hexdigest() if PIN else ""

# ---------------------------------------------------------------- DB

# lentelė -> stulpeliai, kuriuos galima keisti per bendrą „save“ veiksmą
TABLES = {
    "people": ["name", "birthday", "birth_year", "notes", "archived", "pos", "color", "is_group", "profile"],
    "members": ["group_id", "person_id"],
    "occasions": ["kind", "title", "year", "date", "person_id", "budget", "notes"],
    "recipients": ["occasion_id", "person_id", "pos"],
    "gifts": ["title", "person_id", "recipient_text", "occasion_id", "cat", "shop", "price", "url", "note", "status", "pos", "photo"],
    # gautos dovanos: kas, nuo ko (person_id), kokia proga (nebūtina)
    "received": ["title", "person_id", "occasion_id", "note", "photo", "price"],
}
NUMERIC = {"is_group", "group_id", "birth_year", "archived", "pos", "year", "person_id", "budget", "occasion_id", "price"}
KINDS = {"christmas", "birthday", "easter", "mother", "father", "midsummer", "valentine", "other"}
STATUSES = ("idea", "ordered", "bought", "wrapped", "given")

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY, name TEXT, birthday TEXT DEFAULT '',
  notes TEXT DEFAULT '', archived INTEGER DEFAULT 0, pos INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS occasions (id INTEGER PRIMARY KEY, kind TEXT, title TEXT DEFAULT '', year INTEGER,
  date TEXT DEFAULT '', person_id INTEGER, budget REAL, notes TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS recipients (id INTEGER PRIMARY KEY, occasion_id INTEGER, person_id INTEGER,
  pos INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY, group_id INTEGER, person_id INTEGER);
CREATE TABLE IF NOT EXISTS gifts (id INTEGER PRIMARY KEY, title TEXT, person_id INTEGER, recipient_text TEXT DEFAULT '',
  occasion_id INTEGER, shop TEXT DEFAULT '', price REAL, url TEXT DEFAULT '', note TEXT DEFAULT '',
  status TEXT DEFAULT 'idea', pos INTEGER DEFAULT 0, created TEXT);
CREATE TABLE IF NOT EXISTS received (id INTEGER PRIMARY KEY, title TEXT, person_id INTEGER, occasion_id INTEGER,
  note TEXT DEFAULT '', photo TEXT DEFAULT '', price REAL, created TEXT);
"""

# stulpeliai, pridėti vėlesnėse versijose (senoms duomenų bazėms)
NEW_COLUMNS = {
    "people": {"color": "TEXT DEFAULT ''", "birth_year": "INTEGER", "is_group": "INTEGER DEFAULT 0",
               "profile": "TEXT DEFAULT '{}'"},
    # idėjai tinkanti proga be metų, pvz. „christmas||“ (tas pats raktas kaip JS catKey)
    "gifts": {"cat": "TEXT DEFAULT ''", "photo": "TEXT DEFAULT ''"},
}

DEFAULT_SETTINGS = {
    "ahead_days": 60,
    "holidays": ["christmas", "easter", "mother", "father", "midsummer"],
    "notify_services": [],     # mobile_app_* (telefonai), į kuriuos siųsti priminimus
    "notify_days": [14, 3],    # kiek dienų prieš progą priminti
    "notify_time": "10:00",    # kuriuo metu siųsti
}


def now():
    return dt.datetime.now().isoformat(timespec="seconds")


def today():
    return dt.date.today().isoformat()


def get_db():
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


DB = get_db()


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
        for t, cols in NEW_COLUMNS.items():
            have = {r["name"] for r in DB.execute(f"PRAGMA table_info({t})")}
            for c, typ in cols.items():
                if c not in have:
                    DB.execute(f"ALTER TABLE {t} ADD COLUMN {c} {typ}")
        if meta_get("version") is None:
            meta_set("version", 1)
        s = meta_get("settings") or {}
        for k, v in DEFAULT_SETTINGS.items():
            s.setdefault(k, v)
        meta_set("settings", s)
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
    s = str(v).strip().replace(",", ".").replace(" ", "").replace("€", "")
    try:
        f = float(s)
        return int(f) if f.is_integer() and "." not in s else f
    except ValueError:
        return None


def clean_md(v):
    """Gimtadienis saugomas kaip MM-DD (metai nebūtini)."""
    v = (v or "").strip()
    if not v:
        return ""
    m = re.match(r"^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$", v)
    if not m or not (1 <= int(m.group(1)) <= 12 and 1 <= int(m.group(2)) <= 31):
        raise ValueError(f"Bloga data: {v} (reikia MM-DD, pvz. 03-15)")
    return f"{int(m.group(1)):02d}-{int(m.group(2)):02d}"


def clean_date(v):
    v = (v or "").strip() if isinstance(v, str) else v
    if not v:
        return ""
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(v)):
        raise ValueError(f"Bloga data: {v}")
    return v


def full_state():
    out = {"version": version(), "today": today(), "settings": meta_get("settings") or DEFAULT_SETTINGS}
    for t in TABLES:
        out[t] = rows(f"SELECT * FROM {t} ORDER BY id")
    return out


# ---------------------------------------------------------------- veiksmai

def clean_row(t, row):
    cols = [c for c in TABLES[t] if c in row]
    vals = []
    for c in cols:
        v = row[c]
        if c in NUMERIC:
            v = num(v)
        elif c == "birthday":
            v = clean_md(v)
        elif c == "date":
            v = clean_date(v)
        elif c == "status":
            v = v if v in STATUSES else "idea"
        elif c == "photo":
            v = v if isinstance(v, str) and re.match(r"^[0-9a-f]{32}\.(jpg|png|webp)$", v) else ""
        elif c == "profile":
            v = json.dumps({k: str(x).strip()[:500] for k, x in (v if isinstance(v, dict) else {}).items()
                            if str(x).strip()}, ensure_ascii=False)
        elif c == "kind":
            if v not in KINDS:
                raise ValueError("Nežinoma progos rūšis")
        elif isinstance(v, str):
            v = v.strip()
        vals.append(v)
    return cols, vals


def insert(t, row):
    cols, vals = clean_row(t, row)
    if t in ("gifts", "received"):
        cols.append("created")
        vals.append(now())
    cur = DB.execute(f"INSERT INTO {t}({', '.join(cols) or 'id'}) VALUES({', '.join('?' * len(cols)) or 'NULL'})", vals)
    return cur.lastrowid


def act_save(d):
    t = d.get("t")
    if t not in TABLES:
        raise ValueError("Nežinoma lentelė")
    row = d.get("row") or {}
    if t == "people" and "name" in row and not (row.get("name") or "").strip():
        raise ValueError("Įrašykite vardą")
    if t == "gifts" and "title" in row and not (row.get("title") or "").strip():
        raise ValueError("Įrašykite dovaną")
    rid = row.get("id")
    if rid:
        cols, vals = clean_row(t, row)
        if cols:
            DB.execute(f"UPDATE {t} SET {', '.join(c + '=?' for c in cols)} WHERE id=?", vals + [rid])
    else:
        rid = insert(t, row)
    if t == "gifts":
        g = DB.execute("SELECT occasion_id, person_id FROM gifts WHERE id=?", (rid,)).fetchone()
        if g and g["occasion_id"] and g["person_id"]:
            ensure_recipient(g["occasion_id"], g["person_id"])
    return {"id": rid}


def act_delete(d):
    t, rid = d.get("t"), d.get("id")
    if t not in TABLES:
        raise ValueError("Nežinoma lentelė")
    if t == "people":
        n = DB.execute("SELECT COUNT(*) FROM gifts WHERE person_id=?", (rid,)).fetchone()[0]
        if n:
            raise ValueError(f"Šis žmogus turi {n} dovanų įrašų. Vietoj trynimo galite jį paslėpti (Archyvuoti).")
        DB.execute("UPDATE received SET person_id=NULL WHERE person_id=?", (rid,))
        DB.execute("DELETE FROM recipients WHERE person_id=?", (rid,))
        DB.execute("DELETE FROM members WHERE group_id=? OR person_id=?", (rid, rid))
        DB.execute("UPDATE occasions SET person_id=NULL WHERE person_id=?", (rid,))
    if t == "occasions":
        # dovanos nedingsta: tampa idėjomis be progos
        DB.execute("UPDATE gifts SET occasion_id=NULL, status='idea' WHERE occasion_id=? AND status='idea'", (rid,))
        DB.execute("DELETE FROM gifts WHERE occasion_id=?", (rid,))
        DB.execute("DELETE FROM recipients WHERE occasion_id=?", (rid,))
        DB.execute("UPDATE received SET occasion_id=NULL WHERE occasion_id=?", (rid,))
    if t == "recipients":
        r = DB.execute("SELECT * FROM recipients WHERE id=?", (rid,)).fetchone()
        if r:
            n = DB.execute("SELECT COUNT(*) FROM gifts WHERE occasion_id=? AND person_id=? AND status!='idea'",
                           (r["occasion_id"], r["person_id"])).fetchone()[0]
            if n:
                raise ValueError("Šis gavėjas jau turi nupirktų dovanų – pirma jas ištrinkite ar perkelkite.")
            DB.execute("UPDATE gifts SET occasion_id=NULL WHERE occasion_id=? AND person_id=?",
                       (r["occasion_id"], r["person_id"]))
    DB.execute(f"DELETE FROM {t} WHERE id=?", (rid,))


def ensure_recipient(occasion_id, person_id):
    if not DB.execute("SELECT 1 FROM recipients WHERE occasion_id=? AND person_id=?",
                      (occasion_id, person_id)).fetchone():
        pos = DB.execute("SELECT COALESCE(MAX(pos), -1) + 1 FROM recipients WHERE occasion_id=?",
                         (occasion_id,)).fetchone()[0]
        DB.execute("INSERT INTO recipients(occasion_id, person_id, pos) VALUES(?,?,?)", (occasion_id, person_id, pos))


def find_occasion(kind, year, person_id=None, title=""):
    if kind == "birthday":
        r = DB.execute("SELECT id FROM occasions WHERE kind=? AND year=? AND person_id=?",
                       (kind, year, person_id)).fetchone()
    elif kind == "other":
        r = DB.execute("SELECT id FROM occasions WHERE kind=? AND year=? AND lower(title)=lower(?)",
                       (kind, year, title)).fetchone()
    else:
        r = DB.execute("SELECT id FROM occasions WHERE kind=? AND year=?", (kind, year)).fetchone()
    return r["id"] if r else None


def open_occasion(kind, year, person_id=None, title="", date="", copy=True):
    """Randa progą arba sukuria naują (gavėjai nukopijuojami iš ankstesnių metų)."""
    if kind not in KINDS:
        raise ValueError("Nežinoma progos rūšis")
    year = int(year)
    oid = find_occasion(kind, year, person_id, title)
    if oid:
        return oid, False
    oid = insert("occasions", {"kind": kind, "year": year, "person_id": person_id if kind == "birthday" else None,
                               "title": title, "date": date})
    if kind == "birthday" and person_id:
        ensure_recipient(oid, person_id)
    elif copy and kind != "other":
        prev = DB.execute("SELECT id FROM occasions WHERE kind=? AND year<? ORDER BY year DESC LIMIT 1",
                          (kind, year)).fetchone()
        if prev:
            for r in rows("""SELECT r.person_id FROM recipients r JOIN people p ON p.id=r.person_id
                             WHERE r.occasion_id=? AND p.archived=0 ORDER BY r.pos, r.id""", (prev["id"],)):
                ensure_recipient(oid, r["person_id"])
    return oid, True


def act_occasion_open(d):
    oid, created = open_occasion(d.get("kind"), d.get("year"), num(d.get("person_id")),
                                 (d.get("title") or "").strip(), clean_date(d.get("date")), d.get("copy", True))
    return {"id": oid, "created": created}


def act_recipient_add(d):
    oid = num(d.get("occasion_id"))
    pid = num(d.get("person_id"))
    if not pid and (d.get("name") or "").strip():
        pid = person_by_name(d["name"])
        if d.get("is_group"):
            DB.execute("UPDATE people SET is_group=1, birthday='' WHERE id=?", (pid,))
    if not oid or not pid:
        raise ValueError("Pasirinkite žmogų")
    ensure_recipient(oid, pid)
    return {"person_id": pid}


def act_group_set(d):
    """Grupės nariai (grupė – keli žmonės kartu, pvz. „A tėvai“)."""
    gid = num(d.get("group_id"))
    if not gid:
        raise ValueError("Nėra grupės")
    DB.execute("UPDATE people SET is_group=1 WHERE id=?", (gid,))
    DB.execute("DELETE FROM members WHERE group_id=?", (gid,))
    for pid in {num(x) for x in d.get("member_ids") or []}:
        if pid and pid != gid:
            DB.execute("INSERT INTO members(group_id, person_id) VALUES(?,?)", (gid, pid))


def act_person_groups(d):
    """Kurioms grupėms priklauso žmogus."""
    pid = num(d.get("person_id"))
    if not pid:
        raise ValueError("Nėra žmogaus")
    DB.execute("DELETE FROM members WHERE person_id=?", (pid,))
    for gid in {num(x) for x in d.get("group_ids") or []}:
        if gid and gid != pid:
            DB.execute("INSERT INTO members(group_id, person_id) VALUES(?,?)", (gid, pid))


def act_person_merge(d):
    """Perkelia visus žmogaus įrašus kitam žmogui ir ištrina pirmąjį (pvz. po importo)."""
    src, dst = num(d.get("from")), num(d.get("to"))
    if not src or not dst or src == dst:
        raise ValueError("Pasirinkite, su kuo sujungti")
    DB.execute("UPDATE gifts SET person_id=? WHERE person_id=?", (dst, src))
    DB.execute("UPDATE received SET person_id=? WHERE person_id=?", (dst, src))
    for o in rows("SELECT id FROM occasions WHERE kind='birthday' AND person_id=?", (src,)):
        r = DB.execute("SELECT id FROM occasions WHERE kind='birthday' AND person_id=? AND year=(SELECT year FROM occasions WHERE id=?)",
                       (dst, o["id"])).fetchone()
        if r:  # tų metų gimtadienis jau yra – dovanas perkeliam ten
            DB.execute("UPDATE gifts SET occasion_id=? WHERE occasion_id=?", (r["id"], o["id"]))
            DB.execute("DELETE FROM recipients WHERE occasion_id=?", (o["id"],))
            DB.execute("DELETE FROM occasions WHERE id=?", (o["id"],))
        else:
            DB.execute("UPDATE occasions SET person_id=? WHERE id=?", (dst, o["id"]))
    for r in rows("SELECT * FROM recipients WHERE person_id=?", (src,)):
        if DB.execute("SELECT 1 FROM recipients WHERE occasion_id=? AND person_id=?", (r["occasion_id"], dst)).fetchone():
            DB.execute("DELETE FROM recipients WHERE id=?", (r["id"],))
        else:
            DB.execute("UPDATE recipients SET person_id=? WHERE id=?", (dst, r["id"]))
    s = DB.execute("SELECT birthday, notes FROM people WHERE id=?", (src,)).fetchone()
    t = DB.execute("SELECT birthday, notes FROM people WHERE id=?", (dst,)).fetchone()
    if s and t:
        notes = "\n".join(x for x in (t["notes"], s["notes"]) if x)
        DB.execute("UPDATE people SET birthday=?, notes=? WHERE id=?", (t["birthday"] or s["birthday"], notes, dst))
    DB.execute("UPDATE members SET person_id=? WHERE person_id=?", (dst, src))
    DB.execute("UPDATE members SET group_id=? WHERE group_id=?", (dst, src))
    DB.execute("DELETE FROM members WHERE group_id=person_id OR id NOT IN (SELECT MIN(id) FROM members GROUP BY group_id, person_id)")
    DB.execute("DELETE FROM people WHERE id=?", (src,))
    name = (d.get("name") or "").strip()
    if name:
        DB.execute("UPDATE people SET name=? WHERE id=?", (name, dst))


def act_order(d):
    t = d.get("t")
    if t not in ("people", "recipients", "gifts"):
        raise ValueError("Nežinoma lentelė")
    for i, rid in enumerate(d.get("ids") or []):
        DB.execute(f"UPDATE {t} SET pos=? WHERE id=?", (i, rid))


def act_settings_save(d):
    s = meta_get("settings") or {}
    s.update({k: v for k, v in (d.get("settings") or {}).items() if k in DEFAULT_SETTINGS})
    s["ahead_days"] = max(7, min(366, int(num(s.get("ahead_days")) or 60)))
    s["holidays"] = [h for h in s.get("holidays") or [] if h in KINDS]
    s["notify_services"] = [str(x) for x in s.get("notify_services") or [] if str(x).startswith("mobile_app_")]
    s["notify_days"] = sorted({int(num(x)) for x in s.get("notify_days") or [] if num(x) is not None and 0 <= num(x) <= 60},
                              reverse=True)
    m = re.match(r"^(\d{1,2}):(\d{2})$", str(s.get("notify_time") or ""))
    s["notify_time"] = f"{int(m.group(1)):02d}:{m.group(2)}" if m and int(m.group(1)) < 24 and int(m.group(2)) < 60 else "10:00"
    meta_set("settings", s)


def person_by_name(name, birthday=""):
    name = (name or "").strip()
    r = DB.execute("SELECT id, birthday FROM people WHERE lower(name)=lower(?)", (name,)).fetchone()
    if r:
        if birthday and not r["birthday"]:
            DB.execute("UPDATE people SET birthday=? WHERE id=?", (clean_md(birthday), r["id"]))
        return r["id"]
    pos = DB.execute("SELECT COALESCE(MAX(pos), -1) + 1 FROM people").fetchone()[0]
    return insert("people", {"name": name, "birthday": birthday, "pos": pos})


def act_import(d):
    """Importas (tik papildo). Formatas:
    {"occasions": [{"kind": "christmas", "year": 2025, "title": "", "date": "",
                    "person": "Vardas" (gimtadieniui), "birthday": "MM-DD",
                    "gifts": [{"title": "...", "person": "Vardas" | null, "recipient_text": "",
                               "shop": "", "price": 9.99, "status": "given", "note": ""}]}],
     "people": [{"name": "...", "birthday": "MM-DD", "notes": ""}],
     "ideas": [{"title": "...", "person": "Vardas", "price": null, "shop": "", "note": ""}]}
    """
    cnt = {"people": 0, "occasions": 0, "gifts": 0}
    before = DB.execute("SELECT COUNT(*) FROM people").fetchone()[0]
    for p in d.get("people") or []:
        if (p.get("name") or "").strip():
            pid = person_by_name(p["name"], p.get("birthday") or "")
            if p.get("notes"):
                DB.execute("UPDATE people SET notes=? WHERE id=? AND notes=''", (p["notes"], pid))
    for o in d.get("occasions") or []:
        kind = o.get("kind")
        if kind not in KINDS or not num(o.get("year")):
            continue
        pid = person_by_name(o["person"], o.get("birthday") or "") if kind == "birthday" and o.get("person") else None
        if kind == "birthday" and not pid:
            continue
        oid, created = open_occasion(kind, num(o["year"]), pid, (o.get("title") or "").strip(),
                                     clean_date(o.get("date")), copy=False)
        cnt["occasions"] += 1 if created else 0
        for g in o.get("gifts") or []:
            if not (g.get("title") or "").strip():
                continue
            gpid = person_by_name(g["person"]) if g.get("person") else (pid if kind == "birthday" else None)
            insert("gifts", {"title": g["title"], "person_id": gpid, "recipient_text": g.get("recipient_text") or "",
                             "occasion_id": oid, "shop": g.get("shop") or "", "price": g.get("price"),
                             "url": g.get("url") or "", "note": g.get("note") or "",
                             "status": g.get("status") or "given"})
            if gpid:
                ensure_recipient(oid, gpid)
            cnt["gifts"] += 1
        for name in o.get("recipients") or []:
            ensure_recipient(oid, person_by_name(name))
    for g in d.get("ideas") or []:
        if (g.get("title") or "").strip():
            insert("gifts", {"title": g["title"], "person_id": person_by_name(g["person"]) if g.get("person") else None,
                             "shop": g.get("shop") or "", "price": g.get("price"), "note": g.get("note") or "",
                             "url": g.get("url") or "", "status": "idea"})
            cnt["gifts"] += 1
    cnt["people"] = DB.execute("SELECT COUNT(*) FROM people").fetchone()[0] - before
    return cnt


def act_restore(d):
    """Atkuria visus duomenis iš atsarginės kopijos (api/export)."""
    if not all(isinstance(d.get(t), list) for t in ("people", "occasions", "recipients", "gifts")):
        raise ValueError("Tai ne Dovanų atsarginės kopijos failas")
    for t, cols in TABLES.items():
        DB.execute(f"DELETE FROM {t}")
        extra = ["created"] if t in ("gifts", "received") else []
        for r in d.get(t) or []:
            cc = ["id"] + [c for c in cols + extra if c in r]
            DB.execute(f"INSERT INTO {t}({', '.join(cc)}) VALUES({', '.join('?' * len(cc))})", [r.get(c) for c in cc])
    if isinstance(d.get("settings"), dict):
        meta_set("settings", {**DEFAULT_SETTINGS, **d["settings"]})


# ---------------------------------------------------------------- .xlsx skaitymas (be papildomų paketų)

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "rel": "http://schemas.openxmlformats.org/package/2006/relationships"}
DATE_FMT_IDS = set(range(14, 23)) | {45, 46, 47}


def col_index(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_xlsx(data):
    """Grąžina [{"name": lapo pavadinimas, "rows": [[ląstelės tekstas, ...], ...]}]."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("Tai ne .xlsx failas")
    names = set(z.namelist())
    texts = lambda el: "".join(t.text or "" for t in el.iter(f"{{{NS['m']}}}t"))
    shared = []
    if "xl/sharedStrings.xml" in names:
        shared = [texts(si) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]
    date_styles = set()
    if "xl/styles.xml" in names:
        st = ET.fromstring(z.read("xl/styles.xml"))
        custom = {int(f.get("numFmtId")) for f in st.findall("m:numFmts/m:numFmt", NS)
                  if re.search(r"[dy]", re.sub(r'"[^"]*"|\[[^]]*\]', "", f.get("formatCode", "")), re.I)}
        for i, xf in enumerate(st.findall("m:cellXfs/m:xf", NS)):
            fid = int(xf.get("numFmtId", 0))
            if fid in DATE_FMT_IDS or fid in custom:
                date_styles.add(i)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")).findall("rel:Relationship", NS)}
    out = []
    for sh in wb.findall("m:sheets/m:sheet", NS):
        target = rels.get(sh.get(f"{{{NS['r']}}}id"), "")
        path = target.lstrip("/") if target.startswith("/") else "xl/" + target
        if path not in names:
            continue
        grid = []
        for row in ET.fromstring(z.read(path)).iter(f"{{{NS['m']}}}row"):
            r = int(row.get("r", len(grid) + 1)) - 1
            while len(grid) <= r:
                grid.append([])
            cells = grid[r]
            for c in row.findall("m:c", NS):
                t, v = c.get("t"), c.find("m:v", NS)
                if t == "inlineStr":
                    val = texts(c)
                elif v is None or v.text is None:
                    continue
                elif t == "s":
                    val = shared[int(v.text)]
                elif t == "b":
                    val = "TRUE" if v.text == "1" else "FALSE"
                elif t in ("str", "e"):
                    val = v.text
                else:
                    f = float(v.text)
                    if int(c.get("s", 0)) in date_styles and 1 < f < 100000:
                        d = dt.date(1899, 12, 30) + dt.timedelta(days=int(f))
                        val = d.strftime("%m-%d")
                    else:
                        val = str(int(f)) if f.is_integer() else str(round(f, 2)).replace(".", ",")
                ci = col_index(c.get("r")) if c.get("r") else len(cells)
                while len(cells) <= ci:
                    cells.append("")
                cells[ci] = val.strip()
        out.append({"name": sh.get("name"), "rows": grid})
    return out


# ---------------------------------------------------------------- nuotraukos ir nuorodos

PHOTO_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|png|webp)$")
IMG_EXT = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp"}


def save_photo(data, ctype):
    ext = IMG_EXT.get((ctype or "").split(";")[0].strip().lower())
    if not ext:
        if data[:3] == b"\xff\xd8\xff":
            ext = "jpg"
        elif data[:8] == b"\x89PNG\r\n\x1a\n":
            ext = "png"
        elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            ext = "webp"
        else:
            raise ValueError("Tai ne nuotrauka (tinka JPG, PNG, WEBP)")
    if len(data) < 100:
        raise ValueError("Tuščia nuotrauka")
    name = uuid.uuid4().hex + "." + ext
    with open(os.path.join(PHOTO_DIR, name), "wb") as f:
        f.write(data)
    return name


def cleanup_photos():
    """Ištrina nuotraukas, kurių nebenaudoja jokia dovana (pvz. po trynimo)."""
    used = {r[0] for r in DB.execute("SELECT photo FROM gifts WHERE photo!='' UNION SELECT photo FROM received WHERE photo!=''")}
    cutoff = time.time() - 86400  # ką tik įkeltos, bet dar neišsaugotos – paliekamos
    for fn in os.listdir(PHOTO_DIR):
        p = os.path.join(PHOTO_DIR, fn)
        if fn not in used and os.path.getmtime(p) < cutoff:
            try:
                os.remove(p)
            except OSError:
                pass


UA = ("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Mobile Safari/537.36")


def http_get(url, limit):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "lt,en;q=0.8",
                                               "Accept": "text/html,application/xhtml+xml,image/*,*/*;q=0.8"})
    with urllib.request.urlopen(req, timeout=12) as r:
        return r.read(limit), r.headers.get("Content-Type", ""), r.geturl()


def meta_content(page, *names):
    for n in names:
        for pat in (rf'<meta[^>]+(?:property|name|itemprop)\s*=\s*["\']{re.escape(n)}["\'][^>]*content\s*=\s*["\']([^"\']*)',
                    rf'<meta[^>]+content\s*=\s*["\']([^"\']*)["\'][^>]*(?:property|name|itemprop)\s*=\s*["\']{re.escape(n)}["\']'):
            m = re.search(pat, page, re.I)
            if m and m.group(1).strip():
                return html.unescape(m.group(1).strip())
    return ""


def parse_price(v):
    v = re.sub(r"[^\d.,]", "", str(v or ""))
    if not v:
        return None
    if "," in v and "." in v:
        v = v.replace(".", "").replace(",", ".") if v.rfind(",") > v.rfind(".") else v.replace(",", "")
    else:
        v = v.replace(",", ".")
    try:
        f = round(float(v), 2)
        return f if 0 < f < 100000 else None
    except ValueError:
        return None


def act_url_info(d):
    """Iš parduotuvės nuorodos: pavadinimas, kaina, parduotuvė ir nuotrauka (jei pavyksta)."""
    url = (d.get("url") or "").strip()
    if not re.match(r"^https?://[^\s/]+", url, re.I):
        raise ValueError("Tai ne nuoroda")
    try:
        raw, ctype, final = http_get(url, 3 * 1024 * 1024)
    except Exception as e:  # noqa
        raise ValueError(f"Nepavyko atidaryti nuorodos ({e.__class__.__name__}) – įrašykite ranka")
    cs = re.search(r"charset=([\w-]+)", ctype or "")
    page = raw.decode(cs.group(1) if cs else "utf-8", "replace")
    title = meta_content(page, "og:title", "twitter:title")
    if not title:
        m = re.search(r"<title[^>]*>(.*?)</title>", page, re.I | re.S)
        title = html.unescape(re.sub(r"\s+", " ", m.group(1)).strip()) if m else ""
    price = parse_price(meta_content(page, "product:price:amount", "og:price:amount", "price", "twitter:data1"))
    if price is None:
        m = re.search(r'"price"\s*:\s*"?([\d][\d.,\s]*)', page)
        price = parse_price(m.group(1)) if m else None
    host = re.sub(r"^www\.", "", urlparse(final).hostname or "")
    shop = meta_content(page, "og:site_name") or host
    # pavadinime dažnai būna „ | Parduotuvė“ – nuimama
    if title and shop:
        title = re.sub(r"\s*[|\-–—]\s*" + re.escape(shop) + r".*$", "", title, flags=re.I).strip() or title
    photo = ""
    img = meta_content(page, "og:image", "og:image:url", "twitter:image")
    if img:
        try:
            img = urllib.parse.urljoin(final, html.unescape(img))
            data, ictype, _ = http_get(img, 8 * 1024 * 1024)
            photo = save_photo(data, ictype)
        except Exception:  # noqa
            photo = ""
    if not title and not price:
        raise ValueError("Puslapyje nieko nepavyko rasti – įrašykite ranka")
    return {"title": title[:200], "price": price, "shop": shop[:80], "photo": photo, "url": url}


# ---------------------------------------------------------------- priminimai telefone (per Home Assistant)

SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
HA_HOST = os.environ.get("DOVANOS_HA_HOST", "supervisor")
HA_PORT = int(os.environ.get("DOVANOS_HA_PORT", "80"))
NOTIFY_STATE = {"error": "", "last_sent": ""}
MONTHS_G = ["sausio", "vasario", "kovo", "balandžio", "gegužės", "birželio", "liepos", "rugpjūčio", "rugsėjo",
            "spalio", "lapkričio", "gruodžio"]
KIND_NAME = {"christmas": "🎄 Kalėdos", "easter": "🐣 Velykos", "mother": "🌷 Mamos diena", "father": "👔 Tėčio diena",
             "midsummer": "🌿 Joninės", "valentine": "💝 Valentino diena"}


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


class MiniWS:
    """Paprastas WebSocket klientas (tik HA skydelių sąrašui gauti)."""

    def __init__(self, host, port, path):
        self.sock = socket.create_connection((host, port), timeout=20)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(1024)
            if not chunk:
                raise ConnectionError("Ryšys nutrūko")
            head += chunk
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise ConnectionError(head.split(b"\r\n", 1)[0].decode("latin-1"))
        self.buf = head.split(b"\r\n\r\n", 1)[1]

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("Ryšys nutrūko")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send_frame(self, opcode, payload):
        mask = os.urandom(4)
        n = len(payload)
        head = bytes([0x80 | opcode])
        if n < 126:
            head += bytes([0x80 | n])
        elif n < 65536:
            head += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            head += bytes([0x80 | 127]) + struct.pack(">Q", n)
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def send(self, obj):
        self._send_frame(0x1, json.dumps(obj).encode())

    def recv(self):
        data = b""
        while True:
            b0, b1 = self._read(2)
            op, n = b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            mask = self._read(4) if b1 & 0x80 else None
            payload = self._read(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if op == 0x9:
                self._send_frame(0xA, payload)
                continue
            if op == 0x8:
                raise ConnectionError("Home Assistant uždarė ryšį")
            if op in (0x0, 0x1, 0x2):
                data += payload
                if b0 & 0x80:
                    return json.loads(data.decode("utf-8"))


CLICK_PATH = {"path": "", "at": 0.0}


def ingress_path():
    """Kur nuveda paspaudus pranešimą: priedo punktas šoninėje juostoje (/<slug>), randamas per get_panels."""
    slug = socket.gethostname().replace("-", "_", 1)
    if CLICK_PATH["path"] and time.time() - CLICK_PATH["at"] < 3600:
        return CLICK_PATH["path"]
    path = ""
    try:
        ws = MiniWS(HA_HOST, HA_PORT, "/core/websocket")
        try:
            ws.recv()
            ws.send({"type": "auth", "access_token": SUPERVISOR_TOKEN})
            if ws.recv().get("type") == "auth_ok":
                ws.send({"id": 1, "type": "get_panels"})
                m = {}
                for _ in range(20):
                    m = ws.recv()
                    if m.get("id") == 1:
                        break
                for key, pnl in ((m.get("result") or {}) if m.get("id") == 1 else {}).items():
                    url = (pnl or {}).get("url_path") or key
                    if url == slug or ((pnl or {}).get("config") or {}).get("ingress") == slug:
                        path = "/" + url
                        break
        finally:
            try:
                ws.sock.close()
            except Exception:  # noqa
                pass
    except Exception as e:  # noqa
        log("Nepavyko gauti HA skydelių sąrašo:", e)
    if not path:
        path = "/hassio/ingress/" + slug
    CLICK_PATH.update(path=path, at=time.time())
    return path


def notify_services():
    if not SUPERVISOR_TOKEN:
        return []
    out = []
    for d in ha_request("GET", "/services") or []:
        if d.get("domain") == "notify":
            out += [n for n in d.get("services", {}) if n.startswith("mobile_app_")]
    return sorted(out)


def send_notification(title, message, tag=None, services=None):
    services = services or (meta_get("settings") or {}).get("notify_services") or []
    if not services:
        raise ValueError("Nepasirinktas telefonas (⚙️ Nustatymai → Priminimai telefone)")
    data = {"clickAction": ingress_path(), "channel": "Dovanos"}
    if tag:
        data["tag"] = tag
    errs = []
    for svc in services:
        try:
            ha_request("POST", f"/services/notify/{svc}", {"title": title, "message": message, "data": data})
        except Exception as e:  # noqa
            errs.append(f"{svc}: {e}")
    if errs and len(errs) == len(services):
        raise ValueError("; ".join(errs))
    NOTIFY_STATE["last_sent"] = now()


def easter(y):
    a, b, c = y % 19, y // 100, y % 100
    d, e, f = b // 4, b % 4, (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    return dt.date(y, (h + l_ - 7 * m + 114) // 31, (h + l_ - 7 * m + 114) % 31 + 1)


def first_sunday(y, mo):
    d = dt.date(y, mo, 1)
    return d + dt.timedelta(days=(6 - d.weekday()) % 7)


def md_in_year(md, y):
    m, d = (int(x) for x in md.split("-"))
    if m == 2 and d == 29 and not (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)):
        d = 28
    return dt.date(y, m, d)


def kind_date(kind, y):
    return {"christmas": lambda: dt.date(y, 12, 24), "easter": lambda: easter(y), "mother": lambda: first_sunday(y, 5),
            "father": lambda: first_sunday(y, 6), "midsummer": lambda: dt.date(y, 6, 24),
            "valentine": lambda: dt.date(y, 2, 14)}.get(kind, lambda: None)()


def upcoming_events(t0, horizon):
    """Artimiausios progos: [(data, rūšis, person_id, pavadinimas, occasion_id|None)]."""
    st = meta_get("settings") or DEFAULT_SETTINGS
    out = []
    for y in (t0.year, t0.year + 1):
        for k in st.get("holidays") or []:
            d = kind_date(k, y)
            if d:
                o = DB.execute("SELECT id FROM occasions WHERE kind=? AND year=?", (k, y)).fetchone()
                out.append((d, k, None, KIND_NAME.get(k, k), o["id"] if o else None))
        for p in rows("SELECT * FROM people WHERE archived=0 AND is_group=0 AND birthday!=''"):
            try:
                d = md_in_year(p["birthday"], y)
            except ValueError:
                continue
            age = f" ({y - p['birth_year']} m.)" if p.get("birth_year") and y > p["birth_year"] else ""
            o = DB.execute("SELECT id FROM occasions WHERE kind='birthday' AND year=? AND person_id=?", (y, p["id"])).fetchone()
            out.append((d, "birthday", p["id"], f"🎂 {p['name']} gimtadienis{age}", o["id"] if o else None))
    for o in rows("SELECT * FROM occasions WHERE kind='other' AND date!=''"):
        try:
            out.append((dt.date.fromisoformat(o["date"]), "other", None, "🎁 " + (o["title"] or "Proga"), o["id"]))
        except ValueError:
            pass
    return [e for e in out if 0 <= (e[0] - t0).days <= horizon]


def event_status(kind, pid, oid):
    if not oid:
        n = DB.execute("SELECT COUNT(*) FROM gifts WHERE occasion_id IS NULL AND status='idea' AND person_id=?",
                       (pid,)).fetchone()[0] if pid else 0
        return f"Dovanų dar nėra, idėjų: {n}" if n else "Dovanų dar nėra"
    recs = [r["person_id"] for r in rows("SELECT person_id FROM recipients WHERE occasion_id=?", (oid,))]
    gifts = rows("SELECT person_id, status FROM gifts WHERE occasion_id=?", (oid,))
    done = {g["person_id"] for g in gifts if g["status"] != "idea"}
    todo = len([g for g in gifts if g["status"] == "idea"])
    parts = [f"Nupirkta {len([r for r in recs if r in done])} iš {len(recs)}"] if recs else []
    if todo:
        parts.append(f"reikia nupirkti: {todo}")
    return ", ".join(parts) or "Dovanų dar nėra"


def when_txt(n):
    return "Šiandien" if n == 0 else "Rytoj" if n == 1 else f"Po {n} d."


def collect_notifications(nowdt=None):
    st = meta_get("settings") or {}
    if not st.get("notify_services") or not st.get("notify_days"):
        return []
    nowdt = nowdt or dt.datetime.now()
    t0 = nowdt.date()
    at = dt.datetime.combine(t0, dt.time.fromisoformat(st.get("notify_time") or "10:00"))
    if nowdt < at:
        return []
    days = set(st["notify_days"])
    sent = meta_get("notified") or {}
    out = []
    for d, kind, pid, name, oid in upcoming_events(t0, max(days)):
        n = (d - t0).days
        if n not in days:
            continue
        key = f"{kind}|{pid}|{name}|{d.isoformat()}|{n}"
        if key in sent:
            continue
        sent[key] = t0.isoformat()
        out.append({"title": f"{when_txt(n)} – {name}",
                    "message": f"{MONTHS_G[d.month - 1]} {d.day} d. · {event_status(kind, pid, oid)}",
                    "tag": f"dovanos_{kind}_{pid or ''}_{d.isoformat()}"})
    lim = (t0 - dt.timedelta(days=90)).isoformat()
    meta_set("notified", {k: v for k, v in sent.items() if v >= lim})
    return out


def reminder_loop():
    while True:
        try:
            with LOCK:
                todo = collect_notifications()
                DB.commit()
            for n in todo:
                try:
                    send_notification(n["title"], n["message"], tag=n["tag"])
                    NOTIFY_STATE["error"] = ""
                    log("Išsiųsta:", n["title"])
                except Exception as e:  # noqa
                    NOTIFY_STATE["error"] = str(e)
                    log("Pranešimo klaida:", e)
        except Exception as e:  # noqa
            log("Priminimų klaida:", e)
        time.sleep(60)


def act_notify_test(d):
    send_notification("🎁 Dovanos", "Bandomasis pranešimas – priminimai veikia ✓", tag="dovanos_test",
                      services=d.get("services") or None)
    return {"ok": True}


ACTIONS = {
    "save": act_save,
    "delete": act_delete,
    "occasion_open": act_occasion_open,
    "recipient_add": act_recipient_add,
    "order": act_order,
    "person_merge": act_person_merge,
    "group_set": act_group_set,
    "person_groups": act_person_groups,
    "settings_save": act_settings_save,
    "import": act_import,
    "restore": act_restore,
    "url_info": act_url_info,
    "notify_test": act_notify_test,
}

NO_LOCK = {"url_info", "notify_test"}

MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png",
        ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".jpg": "image/jpeg", ".webp": "image/webp"}


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "Dovanos/1.5"

    def log_message(self, fmt, *args):
        if os.environ.get("DEBUG"):
            super().log_message(fmt, *args)

    def authed(self):
        if not PIN:
            return True
        if self.client_address[0] == INGRESS_IP:
            return True
        c = SimpleCookie(self.headers.get("Cookie", ""))
        return "dovanos_auth" in c and secrets.compare_digest(c["dovanos_auth"].value, AUTH_TOKEN)

    def send(self, code, body, ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if "Cache-Control" not in (extra or {}):
            self.send_header("Cache-Control", "no-cache")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

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
        with open(path, "rb") as f:
            self.send(200, f.read(), MIME.get(ext, "application/octet-stream"))

    def do_GET(self):
        url = urlparse(self.path)
        path = unquote(url.path).lstrip("/")
        if path in ("login", "login.html"):
            return self.static("login.html")
        if not self.authed():
            if path.startswith("api/"):
                return self.send(401, {"error": "Reikia PIN"})
            if path.endswith((".js", ".css", ".png", ".webmanifest", ".svg")):
                return self.static(path)
            return self.static("login.html")
        try:
            if path == "api/state":
                with LOCK:
                    return self.send(200, full_state())
            if path == "api/version":
                with LOCK:
                    return self.send(200, {"version": version()})
            if path.startswith("photos/"):
                name = path[len("photos/"):]
                fp = os.path.join(PHOTO_DIR, name)
                if not PHOTO_RE.match(name) or not os.path.isfile(fp):
                    return self.send(404, {"error": "Nėra nuotraukos"})
                with open(fp, "rb") as f:
                    return self.send(200, f.read(), MIME.get(os.path.splitext(name)[1], "image/jpeg"),
                                     extra={"Cache-Control": "max-age=31536000, immutable"})
            if path == "api/notify_status":
                services, err = [], ""
                try:
                    services = notify_services()
                except Exception as e:  # noqa
                    err = str(e)
                return self.send(200, {"ha": bool(SUPERVISOR_TOKEN), "services": services,
                                       "error": err or NOTIFY_STATE["error"], "last": NOTIFY_STATE["last_sent"]})
            if path == "api/export":
                with LOCK:
                    data = full_state()
                data["app"] = "dovanos"
                name = "dovanos-" + today() + ".json"
                return self.send(200, data, extra={"Content-Disposition": f'attachment; filename="{name}"'})
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
                        "Set-Cookie": f"dovanos_auth={AUTH_TOKEN}; Path=/; Max-Age=31536000; SameSite=Lax"})
                return self.send(403, {"error": "Neteisingas PIN"})
            if not self.authed():
                return self.send(401, {"error": "Reikia PIN"})
            if path == "api/photo":
                return self.send(200, {"photo": save_photo(self.read_body(15 * 1024 * 1024), self.headers.get("Content-Type"))})
            if path == "api/xlsx":
                return self.send(200, {"sheets": read_xlsx(self.read_body(30 * 1024 * 1024))})
            if path.startswith("api/do/"):
                name = path[len("api/do/"):]
                fn = ACTIONS.get(name)
                if not fn:
                    return self.send(404, {"error": "Nežinomas veiksmas"})
                d = json.loads(self.read_body(20 * 1024 * 1024).decode("utf-8") or "{}")
                if name in NO_LOCK:  # ilgai trunkantys tinklo veiksmai, duomenų nekeičia
                    return self.send(200, fn(d) or {})
                with LOCK:
                    try:
                        res = fn(d) or {}
                        bump()
                        DB.commit()
                    except Exception:
                        DB.rollback()
                        raise
                    res["version"] = version()
                return self.send(200, res)
            return self.send(404, {"error": "Nerasta"})
        except ValueError as e:
            return self.send(400, {"error": str(e)})
        except Exception as e:  # noqa
            return self.send(500, {"error": f"Klaida: {e}"})


def main():
    init_db()
    try:
        cleanup_photos()
    except Exception as e:  # noqa
        log("Nuotraukų tvarkymo klaida:", e)
    if SUPERVISOR_TOKEN:
        threading.Thread(target=reminder_loop, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Dovanos veikia per prievadą {PORT}. Duomenys: {DATA_DIR}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
