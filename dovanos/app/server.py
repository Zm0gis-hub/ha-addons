#!/usr/bin/env python3
"""Dovanos - dovanų idėjų ir progų Home Assistant priedo serveris.

Naudoja tik standartinę Python biblioteką (be papildomų paketų).
Duomenys saugomi /data aplanke (patenka į HA atsargines kopijas).
"""
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

DATA_DIR = os.environ.get("DATA_DIR", "/data")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
DB_PATH = os.path.join(DATA_DIR, "dovanos.db")
PORT = int(os.environ.get("PORT", "8099"))
INGRESS_IP = "172.30.32.2"  # HA ingress proxy adresas

os.makedirs(DATA_DIR, exist_ok=True)
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
    "people": ["name", "birthday", "notes", "archived", "pos"],
    "occasions": ["kind", "title", "year", "date", "person_id", "budget", "notes"],
    "recipients": ["occasion_id", "person_id", "pos"],
    "gifts": ["title", "person_id", "recipient_text", "occasion_id", "shop", "price", "url", "note", "status", "pos"],
}
NUMERIC = {"archived", "pos", "year", "person_id", "budget", "occasion_id", "price"}
KINDS = {"christmas", "birthday", "easter", "mother", "father", "midsummer", "valentine", "other"}
STATUSES = ("idea", "bought", "given")

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY, name TEXT, birthday TEXT DEFAULT '',
  notes TEXT DEFAULT '', archived INTEGER DEFAULT 0, pos INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS occasions (id INTEGER PRIMARY KEY, kind TEXT, title TEXT DEFAULT '', year INTEGER,
  date TEXT DEFAULT '', person_id INTEGER, budget REAL, notes TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS recipients (id INTEGER PRIMARY KEY, occasion_id INTEGER, person_id INTEGER,
  pos INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS gifts (id INTEGER PRIMARY KEY, title TEXT, person_id INTEGER, recipient_text TEXT DEFAULT '',
  occasion_id INTEGER, shop TEXT DEFAULT '', price REAL, url TEXT DEFAULT '', note TEXT DEFAULT '',
  status TEXT DEFAULT 'idea', pos INTEGER DEFAULT 0, created TEXT);
"""

DEFAULT_SETTINGS = {
    "ahead_days": 60,
    "holidays": ["christmas", "easter", "mother", "father", "midsummer"],
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
        elif c == "kind":
            if v not in KINDS:
                raise ValueError("Nežinoma progos rūšis")
        elif isinstance(v, str):
            v = v.strip()
        vals.append(v)
    return cols, vals


def insert(t, row):
    cols, vals = clean_row(t, row)
    if t == "gifts":
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
        DB.execute("DELETE FROM recipients WHERE person_id=?", (rid,))
        DB.execute("UPDATE occasions SET person_id=NULL WHERE person_id=?", (rid,))
    if t == "occasions":
        # dovanos nedingsta: tampa idėjomis be progos
        DB.execute("UPDATE gifts SET occasion_id=NULL, status='idea' WHERE occasion_id=? AND status='idea'", (rid,))
        DB.execute("DELETE FROM gifts WHERE occasion_id=?", (rid,))
        DB.execute("DELETE FROM recipients WHERE occasion_id=?", (rid,))
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
    if not oid or not pid:
        raise ValueError("Pasirinkite žmogų")
    ensure_recipient(oid, pid)
    return {"person_id": pid}


def act_person_merge(d):
    """Perkelia visus žmogaus įrašus kitam žmogui ir ištrina pirmąjį (pvz. po importo)."""
    src, dst = num(d.get("from")), num(d.get("to"))
    if not src or not dst or src == dst:
        raise ValueError("Pasirinkite, su kuo sujungti")
    DB.execute("UPDATE gifts SET person_id=? WHERE person_id=?", (dst, src))
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
    DB.execute("DELETE FROM people WHERE id=?", (src,))


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
    if not all(isinstance(d.get(t), list) for t in TABLES):
        raise ValueError("Tai ne Dovanų atsarginės kopijos failas")
    for t, cols in TABLES.items():
        DB.execute(f"DELETE FROM {t}")
        extra = ["created"] if t == "gifts" else []
        for r in d[t]:
            cc = ["id"] + [c for c in cols + extra if c in r]
            DB.execute(f"INSERT INTO {t}({', '.join(cc)}) VALUES({', '.join('?' * len(cc))})", [r.get(c) for c in cc])
    if isinstance(d.get("settings"), dict):
        meta_set("settings", {**DEFAULT_SETTINGS, **d["settings"]})


ACTIONS = {
    "save": act_save,
    "delete": act_delete,
    "occasion_open": act_occasion_open,
    "recipient_add": act_recipient_add,
    "order": act_order,
    "person_merge": act_person_merge,
    "settings_save": act_settings_save,
    "import": act_import,
    "restore": act_restore,
}

MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png",
        ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json"}


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "Dovanos/1.0"

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
            if path.startswith("api/do/"):
                name = path[len("api/do/"):]
                fn = ACTIONS.get(name)
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
                return self.send(200, res)
            return self.send(404, {"error": "Nerasta"})
        except ValueError as e:
            return self.send(400, {"error": str(e)})
        except Exception as e:  # noqa
            return self.send(500, {"error": f"Klaida: {e}"})


def main():
    init_db()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Dovanos veikia per prievadą {PORT}. Duomenys: {DATA_DIR}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
