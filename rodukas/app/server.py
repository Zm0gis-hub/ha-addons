#!/usr/bin/env python3
"""Rodukas - augintinio priežiūros Home Assistant priedo serveris.

Naudoja tik standartinę Python biblioteką (be papildomų paketų).
Duomenys ir failai saugomi /data aplanke (patenka į HA atsargines kopijas).
"""
import base64
import datetime as dt
import hashlib
import http.client
import socket
import struct
import time
import json
import os
import re
import secrets
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
DB_PATH = os.path.join(DATA_DIR, "rodukas.db")
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
AUTH_TOKEN = hashlib.sha256(("rodukas:" + PIN).encode()).hexdigest() if PIN else ""

# ---------------------------------------------------------------- DB

# lentelė -> stulpeliai, kuriuos galima keisti per bendrą „save“ veiksmą
TABLES = {
    "weights": ["date", "kg", "note", "visit_id"],
    "foods": ["name", "brand", "kind", "notes", "table_json", "unsuitable"],
    "feedings": ["food_id", "start", "end", "g_day", "meals", "portions", "note"],
    "prevention": ["kind", "name", "date", "valid_until", "batch", "visit_id", "note"],
    "meds": ["name", "dose", "freq", "start", "end", "reason", "note"],
    "journal": ["date", "time", "category", "severity", "text"],
    "contacts": ["name", "category", "phone", "email", "address", "web", "note"],
    "visits": ["date", "time", "category", "contact_id", "place", "title", "price", "notes", "weight_id"],
    "documents": ["title", "date", "filename", "orig_name", "mime", "size", "visit_id", "journal_id", "supply_id", "note"],
    "procedures": ["name", "emoji", "interval_days", "active", "pos", "mode", "weekday", "remind", "remind_time",
                   "repeat", "message", "notify_last"],
    "supplies": ["name", "brand", "purpose", "usage", "start", "end", "place", "price", "notes", "unsuitable"],
    "proc_log": ["procedure_id", "date", "note"],
}
NUMERIC = {"kg", "g_day", "meals", "portions", "price", "interval_days", "severity", "size",
           "food_id", "visit_id", "journal_id", "contact_id", "weight_id", "procedure_id",
           "active", "pos", "unsuitable", "supply_id", "weekday", "remind", "repeat"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS weights (id INTEGER PRIMARY KEY, date TEXT, kg REAL, note TEXT DEFAULT '', visit_id INTEGER);
CREATE TABLE IF NOT EXISTS foods (id INTEGER PRIMARY KEY, name TEXT, brand TEXT DEFAULT '', kind TEXT DEFAULT '',
  notes TEXT DEFAULT '', table_json TEXT DEFAULT '[]', unsuitable INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS feedings (id INTEGER PRIMARY KEY, food_id INTEGER, start TEXT, end TEXT,
  g_day REAL, meals INTEGER DEFAULT 2, portions INTEGER DEFAULT 1, note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS prevention (id INTEGER PRIMARY KEY, kind TEXT, name TEXT, date TEXT, valid_until TEXT,
  batch TEXT DEFAULT '', visit_id INTEGER, note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS meds (id INTEGER PRIMARY KEY, name TEXT, dose TEXT DEFAULT '', freq TEXT DEFAULT '',
  start TEXT, end TEXT, reason TEXT DEFAULT '', note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY, date TEXT, time TEXT DEFAULT '', category TEXT,
  severity INTEGER DEFAULT 0, text TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY, name TEXT, category TEXT DEFAULT '', phone TEXT DEFAULT '',
  email TEXT DEFAULT '', address TEXT DEFAULT '', web TEXT DEFAULT '', note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY, date TEXT, time TEXT DEFAULT '', category TEXT,
  contact_id INTEGER, place TEXT DEFAULT '', title TEXT DEFAULT '', price REAL, notes TEXT DEFAULT '', weight_id INTEGER);
CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, title TEXT, date TEXT, filename TEXT, orig_name TEXT,
  mime TEXT, size INTEGER, visit_id INTEGER, journal_id INTEGER, note TEXT DEFAULT '', created TEXT);
CREATE TABLE IF NOT EXISTS procedures (id INTEGER PRIMARY KEY, name TEXT, emoji TEXT DEFAULT '',
  interval_days INTEGER, active INTEGER DEFAULT 1, pos INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS proc_log (id INTEGER PRIMARY KEY, procedure_id INTEGER, date TEXT, note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS supplies (id INTEGER PRIMARY KEY, name TEXT, brand TEXT DEFAULT '', purpose TEXT DEFAULT '',
  usage TEXT DEFAULT '', start TEXT, end TEXT, place TEXT DEFAULT '', price REAL, notes TEXT DEFAULT '',
  unsuitable INTEGER DEFAULT 0);
"""

# stulpeliai, pridėti vėlesnėse versijose (senoms duomenų bazėms)
NEW_COLUMNS = {
    "documents": {"supply_id": "INTEGER"},
    "procedures": {"mode": "TEXT DEFAULT 'interval'", "weekday": "INTEGER", "remind": "INTEGER DEFAULT 0",
                   "remind_time": "TEXT DEFAULT '21:00'", "repeat": "INTEGER DEFAULT 1",
                   "message": "TEXT DEFAULT ''", "notify_last": "TEXT"},
}

DEFAULT_PROFILE = {
    "name": "Rodukas", "breed": "", "sex": "", "birth_date": "", "color": "",
    "chip": "", "passport": "", "insurance": "", "target_kg": None, "allergies": "",
    "notes": "", "photo": "", "emergency_contact_id": None,
}
DEFAULT_SETTINGS = {
    "visit_cats": ["VET", "SPA", "Tyrimai", "Kita"],
    "journal_cats": ["Pastaba", "Vėmimas", "Viduriavimas", "Kosulys / čiaudulys", "Kvėpavimas", "Akys",
                     "Ausys", "Oda / kailis", "Šlubavimas", "Apetitas", "Elgesys", "Kita"],
    "contact_cats": ["Veterinarija", "SPA", "Parduotuvė", "Kita"],
    "prevention_kinds": ["Vakcina", "Antiparazitinė", "Kita"],
    "supply_purposes": ["Raukšlės", "Dantys", "Ausys", "Akys", "Letenos", "Kailis / maudymas", "Nagai", "Oda", "Kita"],
    "alert_days": 30,
    "notify_service": "",
    "prevention_notify": True,
    "prevention_days": 14,
    "prevention_time": "19:00",
}
# (pavadinimas, ženkliukas, režimas, kas kiek d., priminti, laikas, tekstas)
DEFAULT_PROCEDURES = [
    ("Raukšlės valymas", "🫧", "daily", 1, 0, "21:00", ""),
    ("Dantų valymas", "🦷", "daily", 1, 0, "21:00", ""),
    ("Ausų valymas", "👂", "interval", 3, 1, "23:00", "Ar išvalytos ausys?"),
    ("Nagų kirpimas", "✂️", "interval", 7, 1, "20:00", "Laikas nukirpti nagus"),
]


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
        if meta_get("profile") is None:
            meta_set("profile", DEFAULT_PROFILE)
        s = meta_get("settings") or {}
        for k, v in DEFAULT_SETTINGS.items():
            s.setdefault(k, v)
        meta_set("settings", s)
        if meta_get("procedures_seeded") is None:
            for i, (n, e, mode, d, rem, tm, msg) in enumerate(DEFAULT_PROCEDURES):
                DB.execute("""INSERT INTO procedures(name, emoji, interval_days, active, pos, mode, remind, remind_time,
                              repeat, message) VALUES(?,?,?,?,?,?,?,?,1,?)""",
                           (n, e, d, 0 if mode == "daily" else 1, i, mode, rem, tm, msg))
            meta_set("procedures_seeded", True)
            meta_set("v12_migrated", True)
        if meta_get("v12_migrated") is None:
            # 1.2: raukšlės ir dantys nebežymimi, ausims ir nagams – priminimai
            for p in rows("SELECT * FROM procedures"):
                n = (p["name"] or "").lower()
                for key, (_, _, mode, d, rem, tm, msg) in (("rauk", DEFAULT_PROCEDURES[0]), ("dant", DEFAULT_PROCEDURES[1]),
                                                          ("aus", DEFAULT_PROCEDURES[2]), ("nag", DEFAULT_PROCEDURES[3])):
                    if key in n:
                        DB.execute("""UPDATE procedures SET mode=?, interval_days=?, remind=?, remind_time=?, repeat=1,
                                      message=?, active=? WHERE id=?""",
                                   (mode, d, rem, tm, msg, 0 if mode == "daily" else 1, p["id"]))
                        break
            meta_set("v12_migrated", True)
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
    out = {"version": version(), "today": today(),
           "profile": {**DEFAULT_PROFILE, **(meta_get("profile") or {})},
           "settings": meta_get("settings") or DEFAULT_SETTINGS}
    for t in TABLES:
        out[t] = rows(f"SELECT * FROM {t} ORDER BY id")
    return out


# ---------------------------------------------------------------- failai

def upload_path(uid):
    if not re.match(r"^[a-f0-9]{32}$", uid or ""):
        raise ValueError("Blogas įkėlimo ID")
    return os.path.join(TMP_DIR, uid + ".part")


def take_upload(uid, orig_name, prefix="doc"):
    """Perkelia įkeltą failą į nuolatinę vietą ir grąžina (failo vardas, dydis)."""
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

def act_save(d):
    t = d.get("t")
    if t not in TABLES:
        raise ValueError("Nežinoma lentelė")
    row = d.get("row") or {}
    cols = [c for c in TABLES[t] if c in row and c not in ("filename", "size", "mime", "orig_name")]
    vals = []
    for c in cols:
        v = row[c]
        if c in NUMERIC:
            v = num(v)
        elif c in ("date", "start", "end", "valid_until"):
            v = clean_date(v)
        elif isinstance(v, (list, dict)):
            v = json.dumps(v, ensure_ascii=False)
        elif isinstance(v, str):
            v = v.strip()
        vals.append(v)
    rid = row.get("id")
    if rid:
        if cols:
            DB.execute(f"UPDATE {t} SET {', '.join(c + '=?' for c in cols)} WHERE id=?", vals + [rid])
    else:
        if t == "documents":
            raise ValueError("Dokumentą reikia įkelti su failu")
        cur = DB.execute(f"INSERT INTO {t}({', '.join(cols) or 'id'}) VALUES({', '.join('?' * len(cols)) or 'NULL'})", vals)
        rid = cur.lastrowid
    return {"id": rid}


def act_delete(d):
    t, rid = d.get("t"), d.get("id")
    if t not in TABLES:
        raise ValueError("Nežinoma lentelė")
    if t == "foods":
        n = DB.execute("SELECT COUNT(*) FROM feedings WHERE food_id=?", (rid,)).fetchone()[0]
        if n:
            raise ValueError("Šis maistas yra maitinimo istorijoje – pirma ištrinkite tuos laikotarpius.")
    if t == "documents":
        r = DB.execute("SELECT filename FROM documents WHERE id=?", (rid,)).fetchone()
        if r:
            remove_file(r["filename"])
    if t == "visits":
        DB.execute("UPDATE documents SET visit_id=NULL WHERE visit_id=?", (rid,))
        DB.execute("UPDATE prevention SET visit_id=NULL WHERE visit_id=?", (rid,))
        DB.execute("UPDATE weights SET visit_id=NULL WHERE visit_id=?", (rid,))
    if t == "journal":
        DB.execute("UPDATE documents SET journal_id=NULL WHERE journal_id=?", (rid,))
    if t == "contacts":
        DB.execute("UPDATE visits SET contact_id=NULL WHERE contact_id=?", (rid,))
    if t == "weights":
        DB.execute("UPDATE visits SET weight_id=NULL WHERE weight_id=?", (rid,))
    if t == "procedures":
        DB.execute("DELETE FROM proc_log WHERE procedure_id=?", (rid,))
    if t == "supplies":
        for r in rows("SELECT filename FROM documents WHERE supply_id=?", (rid,)):
            remove_file(r["filename"])
        DB.execute("DELETE FROM documents WHERE supply_id=?", (rid,))
    DB.execute(f"DELETE FROM {t} WHERE id=?", (rid,))


def act_visit_save(d):
    """Vizitas + (neprivalomai) svoris, pasvertas vizito metu."""
    row = dict(d.get("row") or {})
    kg = num(row.pop("kg", None))
    res = act_save({"t": "visits", "row": row})
    vid = res["id"]
    v = DB.execute("SELECT * FROM visits WHERE id=?", (vid,)).fetchone()
    if kg:
        if v["weight_id"] and DB.execute("SELECT 1 FROM weights WHERE id=?", (v["weight_id"],)).fetchone():
            DB.execute("UPDATE weights SET kg=?, date=? WHERE id=?", (kg, v["date"], v["weight_id"]))
        else:
            cur = DB.execute("INSERT INTO weights(date, kg, note, visit_id) VALUES(?,?,?,?)",
                             (v["date"], kg, "Pasverta vizito metu", vid))
            DB.execute("UPDATE visits SET weight_id=? WHERE id=?", (cur.lastrowid, vid))
    elif "kg" in (d.get("row") or {}) and v["weight_id"]:
        DB.execute("DELETE FROM weights WHERE id=?", (v["weight_id"],))
        DB.execute("UPDATE visits SET weight_id=NULL WHERE id=?", (vid,))
    return {"id": vid}


def act_feeding_start(d):
    """Naujas maitinimo laikotarpis; pasirinkti dabartiniai užbaigiami diena anksčiau."""
    row = d.get("row") or {}
    start = clean_date(row.get("start")) or today()
    end_prev = (dt.date.fromisoformat(start) - dt.timedelta(days=1)).isoformat()
    for fid in d.get("close", []) or []:
        r = DB.execute("SELECT start FROM feedings WHERE id=?", (fid,)).fetchone()
        if not r:
            continue
        e = end_prev if not r["start"] or r["start"] <= end_prev else r["start"]
        DB.execute("UPDATE feedings SET end=? WHERE id=? AND (end IS NULL OR end > ?)", (e, fid, e))
    row["start"] = start
    return act_save({"t": "feedings", "row": row})


def act_doc_add(d):
    fn, size = take_upload(d.get("upload"), d.get("orig_name"))
    cur = DB.execute("""INSERT INTO documents(title, date, filename, orig_name, mime, size, visit_id, journal_id,
                        supply_id, note, created) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                     ((d.get("title") or d.get("orig_name") or "Dokumentas").strip(), clean_date(d.get("date")) or today(),
                      fn, d.get("orig_name") or "", d.get("mime") or "", size, num(d.get("visit_id")),
                      num(d.get("journal_id")), num(d.get("supply_id")), (d.get("note") or "").strip(), now()))
    return {"id": cur.lastrowid}


def act_profile_save(d):
    p = {**DEFAULT_PROFILE, **(meta_get("profile") or {})}
    for k in DEFAULT_PROFILE:
        if k in d and k != "photo":
            v = d[k]
            if k == "target_kg":
                v = num(v)
            elif k == "emergency_contact_id":
                v = num(v)
            elif k == "birth_date":
                v = clean_date(v) or ""
            elif isinstance(v, str):
                v = v.strip()
            p[k] = v
    meta_set("profile", p)


def act_profile_photo(d):
    p = {**DEFAULT_PROFILE, **(meta_get("profile") or {})}
    fn, _ = take_upload(d.get("upload"), d.get("orig_name") or "foto.jpg", "profile")
    remove_file(p.get("photo"))
    p["photo"] = fn
    meta_set("profile", p)


def act_settings_save(d):
    s = meta_get("settings") or dict(DEFAULT_SETTINGS)
    for k in DEFAULT_SETTINGS:
        if k in d:
            v = d[k]
            dflt = DEFAULT_SETTINGS[k]
            if isinstance(dflt, list):
                v = [x.strip() for x in (v if isinstance(v, list) else str(v).split("\n")) if x and x.strip()]
            elif isinstance(dflt, bool):
                v = bool(v) and v not in ("0", "false")
            elif isinstance(dflt, int):
                v = num(v) or dflt
            else:
                v = str(v or "").strip()
                if k.endswith("_time") and not re.match(r"^\d{1,2}:\d{2}$", v):
                    v = dflt
            s[k] = v
    meta_set("settings", s)


def act_proc_order(d):
    for i, pid in enumerate(d.get("ids", [])):
        DB.execute("UPDATE procedures SET pos=? WHERE id=?", (i, pid))


# ---- duomenų importas (paruoštas Claude pokalbyje), papildo esamus duomenis
def act_import(d):
    data = d.get("data")
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, dict):
        raise ValueError("Netinkamas failo formatas")
    cnt = {}

    def inc(k):
        cnt[k] = cnt.get(k, 0) + 1

    def contact_id(name):
        if not name:
            return None
        r = DB.execute("SELECT id FROM contacts WHERE lower(name)=lower(?)", (name.strip(),)).fetchone()
        if r:
            return r["id"]
        return DB.execute("INSERT INTO contacts(name) VALUES(?)", (name.strip(),)).lastrowid

    def food_id(name):
        if not name:
            return None
        r = DB.execute("SELECT id FROM foods WHERE lower(name)=lower(?)", (name.strip(),)).fetchone()
        if r:
            return r["id"]
        return DB.execute("INSERT INTO foods(name) VALUES(?)", (name.strip(),)).lastrowid

    if isinstance(data.get("profilis"), dict):
        m = {"vardas": "name", "veisle": "breed", "lytis": "sex", "gimimo_data": "birth_date", "spalva": "color",
             "cipas": "chip", "pasas": "passport", "draudimas": "insurance", "tikslinis_svoris": "target_kg",
             "alergijos": "allergies", "pastabos": "notes"}
        act_profile_save({m[k]: v for k, v in data["profilis"].items() if k in m and v not in (None, "")})
        inc("profilis")
    for c in data.get("kontaktai", []) or []:
        cid = contact_id(c.get("vardas") or c.get("pavadinimas"))
        DB.execute("""UPDATE contacts SET category=COALESCE(NULLIF(?,''),category), phone=COALESCE(NULLIF(?,''),phone),
                      email=COALESCE(NULLIF(?,''),email), address=COALESCE(NULLIF(?,''),address),
                      web=COALESCE(NULLIF(?,''),web), note=COALESCE(NULLIF(?,''),note) WHERE id=?""",
                   (c.get("kategorija", ""), c.get("telefonas", ""), c.get("el_pastas", ""), c.get("adresas", ""),
                    c.get("svetaine", ""), c.get("pastaba", ""), cid))
        inc("kontaktai")
    for w in data.get("svoriai", []) or []:
        DB.execute("INSERT INTO weights(date, kg, note) VALUES(?,?,?)",
                   (clean_date(w.get("data")), num(w.get("kg")), w.get("pastaba", "")))
        inc("svoriai")
    for p in data.get("skiepai", []) or []:
        DB.execute("INSERT INTO prevention(kind, name, date, valid_until, batch, note) VALUES(?,?,?,?,?,?)",
                   (p.get("tipas") or "Vakcina", p.get("pavadinimas"), clean_date(p.get("data")),
                    clean_date(p.get("galioja_iki")), p.get("serija", ""), p.get("pastaba", "")))
        inc("skiepai")
    for m in data.get("vaistai", []) or []:
        DB.execute("INSERT INTO meds(name, dose, freq, start, end, reason, note) VALUES(?,?,?,?,?,?,?)",
                   (m.get("pavadinimas"), m.get("doze", ""), m.get("daznis", ""), clean_date(m.get("nuo")),
                    clean_date(m.get("iki")), m.get("priezastis", ""), m.get("pastaba", "")))
        inc("vaistai")
    for f in data.get("maistai", []) or []:
        fid = food_id(f.get("pavadinimas"))
        DB.execute("""UPDATE foods SET brand=?, kind=?, notes=?, table_json=?, unsuitable=? WHERE id=?""",
                   (f.get("gamintojas", ""), f.get("tipas", ""), f.get("pastabos", ""),
                    json.dumps(f.get("lentele") or []), 1 if f.get("netinka") else 0, fid))
        inc("maistai")
    for f in data.get("maitinimas", []) or []:
        DB.execute("INSERT INTO feedings(food_id, start, end, g_day, meals, portions, note) VALUES(?,?,?,?,?,?,?)",
                   (food_id(f.get("maistas")), clean_date(f.get("nuo")), clean_date(f.get("iki")),
                    num(f.get("g_per_diena")), num(f.get("maitinimai")) or 2, num(f.get("idejimai")) or 1,
                    f.get("pastaba", "")))
        inc("maitinimas")
    for v in data.get("vizitai", []) or []:
        act_visit_save({"row": {"date": v.get("data"), "category": v.get("kategorija") or "VET",
                                "contact_id": contact_id(v.get("kontaktas")), "place": v.get("vieta", ""),
                                "title": v.get("pavadinimas", ""), "price": v.get("kaina"),
                                "notes": v.get("pastabos", ""), "kg": v.get("svoris")}})
        inc("vizitai")
    for p in data.get("priemones", []) or []:
        DB.execute("""INSERT INTO supplies(name, brand, purpose, usage, start, end, place, price, notes, unsuitable)
                      VALUES(?,?,?,?,?,?,?,?,?,?)""",
                   (p.get("pavadinimas"), p.get("gamintojas", ""), p.get("paskirtis", "Kita"), p.get("naudojimas", ""),
                    clean_date(p.get("nuo")), clean_date(p.get("iki")), p.get("kur_pirkta", ""), num(p.get("kaina")),
                    p.get("pastabos", ""), 1 if p.get("netinka") else 0))
        inc("priemones")
    for j in data.get("zurnalas", []) or []:
        DB.execute("INSERT INTO journal(date, category, severity, text) VALUES(?,?,?,?)",
                   (clean_date(j.get("data")), j.get("kategorija") or "Pastaba", num(j.get("sunkumas")) or 0,
                    j.get("tekstas", "")))
        inc("zurnalas")
    return {"imported": cnt}


# ---- pilna atsarginė kopija (ZIP)
def export_zip():
    path = os.path.join(TMP_DIR, "export_" + uuid.uuid4().hex + ".zip")
    data = {"programa": "rodukas", "eksportuota": now(),
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
            if data.get("programa") != "rodukas":
                raise ValueError("Tai ne šios programos atsarginė kopija")
            for t in TABLES:
                DB.execute(f"DELETE FROM {t}")
                for r in data["tables"].get(t, []):
                    cols = [c for c in r if c == "id" or c in TABLES[t] or c == "created"]
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



# ---------------------------------------------------------------- priminimai ir HA pranešimai

SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
HA_HOST = os.environ.get("APP_HA_HOST", "supervisor")
HA_PORT = int(os.environ.get("APP_HA_PORT", "80"))
NOTIFY_STATE = {"ws": False, "error": "", "last_sent": ""}
ACTION_PREFIX = "RODUKAS_"


def log(*a):
    print(dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


def ha_request(method, path, body=None):
    if not SUPERVISOR_TOKEN:
        raise ValueError("Pranešimai veikia tik Home Assistant viduje")
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


def notify_services():
    if not SUPERVISOR_TOKEN:
        return []
    out = []
    for d in ha_request("GET", "/services") or []:
        if d.get("domain") == "notify":
            out += [n for n in d.get("services", {}) if n.startswith("mobile_app_")]
    return sorted(out)


def ingress_path():
    """Kelias į šį priedą HA viduje (pvz. /hassio/ingress/a0d7b954_rodukas)."""
    return "/hassio/ingress/" + socket.gethostname().replace("-", "_", 1)


def send_notification(message, title=None, actions=None, tag=None, service=None):
    if title is None:
        title = "🐶 " + (((meta_get("profile") or {}).get("name") or "").strip() or "Rodukas")
    service = service or (meta_get("settings") or {}).get("notify_service")
    if not service:
        raise ValueError("Nepasirinktas telefonas (Nustatymai → Priminimai)")
    data = {"clickAction": ingress_path(), "channel": "Rodukas"}
    if actions:
        data["actions"] = actions
    if tag:
        data["tag"] = tag
    ha_request("POST", f"/services/notify/{service}", {"title": title, "message": message, "data": data})
    NOTIFY_STATE["last_sent"] = now()


def last_done(pid):
    r = DB.execute("SELECT MAX(date) AS d FROM proc_log WHERE procedure_id=?", (pid,)).fetchone()
    return dt.date.fromisoformat(r["d"]) if r and r["d"] else None


def next_due(p, last, today_=None):
    """Kada procedūrą reikia atlikti kitą kartą (None – nežymima)."""
    t = today_ or dt.date.today()
    mode = p["mode"] or "interval"
    if mode == "daily":
        return None
    if mode == "weekday":
        wd = int(p["weekday"] or 7)
        d = last + dt.timedelta(days=1) if last else t - dt.timedelta(days=6)
        while d.isoweekday() != wd:
            d += dt.timedelta(days=1)
        return d
    iv = max(1, int(p["interval_days"] or 7))
    return last + dt.timedelta(days=iv) if last else t


def hm(v, dflt="21:00"):
    m = re.match(r"^(\d{1,2}):(\d{2})$", str(v or ""))
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else dflt


def collect_due_notifications():
    """Grąžina pranešimus, kuriuos reikia išsiųsti dabar, ir pažymi, kad išsiųsti."""
    out = []
    t = dt.date.today()
    nowhm = dt.datetime.now().strftime("%H:%M")
    for p in rows("SELECT * FROM procedures WHERE remind=1 AND active=1"):
        due = next_due(p, last_done(p["id"]), t)
        if not due or due > t or nowhm < hm(p["remind_time"]):
            continue
        if p["notify_last"] == t.isoformat():
            continue
        if not p["repeat"] and p["notify_last"] and p["notify_last"] >= due.isoformat():
            continue
        late = (t - due).days
        msg = (p["message"] or f"{p['name']} – laikas") + (f" (vėluoja {late} d.)" if late > 0 else "")
        out.append({"message": msg, "tag": f"rodukas_proc_{p['id']}", "actions": [
            {"action": f"{ACTION_PREFIX}DONE_{p['id']}", "title": "✓ Atlikta"},
            {"action": f"{ACTION_PREFIX}LATER_{p['id']}", "title": "Rytoj"}]})
        DB.execute("UPDATE procedures SET notify_last=? WHERE id=?", (t.isoformat(), p["id"]))
    st = meta_get("settings") or {}
    if st.get("prevention_notify", True) and nowhm >= hm(st.get("prevention_time"), "19:00"):
        sent = meta_get("prev_notified") or {}
        latest = {}
        for p in rows("SELECT * FROM prevention WHERE valid_until IS NOT NULL ORDER BY date DESC, id DESC"):
            latest.setdefault((p["name"] or "").strip().lower(), p)
        days_before = int(st.get("prevention_days") or 14)
        for p in latest.values():
            left = (dt.date.fromisoformat(p["valid_until"]) - t).days
            got = sent.get(str(p["id"]), [])
            if 0 < left <= days_before and "pre" not in got:
                hint = "laikas registruotis pas veterinarą" if p["kind"] == "Vakcina" else "nepamirškite laiku duoti"
                out.append({"message": f"{p['name']} galioja iki {p['valid_until']} (liko {left} d.) – {hint}",
                            "tag": f"rodukas_prev_{p['id']}"})
                got.append("pre")
            if -7 <= left <= 0 and "due" not in got:
                if p["kind"] == "Vakcina":
                    out.append({"message": f"{p['name']}: galiojimas baigėsi – reikia pas veterinarą",
                                "tag": f"rodukas_prev_{p['id']}"})
                else:
                    out.append({"message": f"Šiandien reikia duoti: {p['name']}", "tag": f"rodukas_prev_{p['id']}",
                                "actions": [{"action": f"{ACTION_PREFIX}GIVEN_{p['id']}", "title": "✓ Duota"},
                                            {"action": f"{ACTION_PREFIX}LATER_0", "title": "Vėliau"}]})
                got.append("due")
            sent[str(p["id"])] = got
        meta_set("prev_notified", sent)
    return out


def handle_action(action):
    m = re.match(ACTION_PREFIX + r"(DONE|LATER|GIVEN)_(\d+)$", action or "")
    if not m:
        return
    kind, oid = m.group(1), int(m.group(2))
    with LOCK:
        t = today()
        if kind == "DONE":
            if not DB.execute("SELECT 1 FROM proc_log WHERE procedure_id=? AND date=?", (oid, t)).fetchone():
                DB.execute("INSERT INTO proc_log(procedure_id, date, note) VALUES(?,?,?)", (oid, t, "Pažymėta iš pranešimo"))
        elif kind == "GIVEN":
            p = DB.execute("SELECT * FROM prevention WHERE id=?", (oid,)).fetchone()
            if p and not DB.execute("SELECT 1 FROM prevention WHERE lower(name)=lower(?) AND date=?", (p["name"], t)).fetchone():
                span = 30
                if p["date"] and p["valid_until"]:
                    span = max(1, (dt.date.fromisoformat(p["valid_until"]) - dt.date.fromisoformat(p["date"])).days)
                DB.execute("""INSERT INTO prevention(kind, name, date, valid_until, batch, note) VALUES(?,?,?,?,?,?)""",
                           (p["kind"], p["name"], t, (dt.date.today() + dt.timedelta(days=span)).isoformat(), "",
                            "Pažymėta iš pranešimo"))
        else:
            return
        bump()
        DB.commit()
    log("Pranešimo veiksmas:", action)


def reminder_loop():
    while True:
        try:
            with LOCK:
                todo = collect_due_notifications()
                if todo:
                    bump()
                DB.commit()
            for n in todo:
                try:
                    send_notification(n["message"], actions=n.get("actions"), tag=n.get("tag"))
                    NOTIFY_STATE["error"] = ""
                    log("Išsiųsta:", n["message"])
                except Exception as e:  # noqa
                    NOTIFY_STATE["error"] = str(e)
                    log("Pranešimo klaida:", e)
        except Exception as e:  # noqa
            log("Priminimų klaida:", e)
        time.sleep(30)


class MiniWS:
    """Paprastas WebSocket klientas (tik tam, kad gautume pranešimų mygtukų paspaudimus)."""

    def __init__(self, host, port, path):
        self.sock = socket.create_connection((host, port), timeout=30)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
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
        self.sock.settimeout(None)

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


def action_listener():
    while True:
        try:
            ws = MiniWS(HA_HOST, HA_PORT, "/core/websocket")
            ws.recv()
            ws.send({"type": "auth", "access_token": SUPERVISOR_TOKEN})
            r = ws.recv()
            if r.get("type") != "auth_ok":
                raise ConnectionError("Nepavyko prisijungti prie Home Assistant")
            ws.send({"id": 1, "type": "subscribe_events", "event_type": "mobile_app_notification_action"})
            NOTIFY_STATE["ws"] = True
            log("Laukiama pranešimų mygtukų paspaudimų")
            while True:
                m = ws.recv()
                if m.get("type") == "event":
                    handle_action(((m.get("event") or {}).get("data") or {}).get("action", ""))
        except Exception as e:  # noqa
            NOTIFY_STATE["ws"] = False
            log("Ryšys su HA nutrūko:", e)
            time.sleep(20)


def act_notify_test(d):
    send_notification("Bandomasis pranešimas – priminimai veikia ✓", service=d.get("service") or None,
                      actions=[{"action": f"{ACTION_PREFIX}LATER_0", "title": "Gerai"}], tag="rodukas_test")
    return {"ok": True}

ACTIONS = {
    "save": act_save, "delete": act_delete, "visit_save": act_visit_save,
    "feeding_start": act_feeding_start, "doc_add": act_doc_add,
    "profile_save": act_profile_save, "profile_photo": act_profile_photo,
    "settings_save": act_settings_save, "proc_order": act_proc_order,
    "import": act_import, "restore": act_restore, "notify_test": act_notify_test,
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
    server_version = "Rodukas/1.3"

    def log_message(self, fmt, *args):
        if os.environ.get("DEBUG"):
            super().log_message(fmt, *args)

    def authed(self):
        if not PIN:
            return True
        if self.client_address[0] == INGRESS_IP:
            return True
        c = SimpleCookie(self.headers.get("Cookie", ""))
        return "rodukas_auth" in c and secrets.compare_digest(c["rodukas_auth"].value, AUTH_TOKEN)

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
        rng = self.headers.get("Range")
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
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
            if path == "api/notify_status":
                try:
                    services = notify_services()
                    err = ""
                except Exception as e:  # noqa
                    services, err = [], str(e)
                return self.send(200, {"ha": bool(SUPERVISOR_TOKEN), "services": services, "ws": NOTIFY_STATE["ws"],
                                       "error": err or NOTIFY_STATE["error"], "last_sent": NOTIFY_STATE["last_sent"]})
            if path == "api/version":
                with LOCK:
                    return self.send(200, {"version": version()})
            if path == "api/export":
                with LOCK:
                    zp = export_zip()
                try:
                    name = "rodukas-" + today() + ".zip"
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
                        "Set-Cookie": f"rodukas_auth={AUTH_TOKEN}; Path=/; Max-Age=31536000; SameSite=Lax"})
                return self.send(403, {"error": "Neteisingas PIN"})
            if not self.authed():
                return self.send(401, {"error": "Reikia PIN"})
            if path == "api/upload":
                # failas siunčiamas dalimis: ?u=<id>&i=<dalies nr.>
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


# ---------------------------------------------------------------- jutiklis HA skydeliui
SENSOR_ID = "sensor.rodukas_priminimai"
SENSOR_STATE = {"error": "", "last": ""}


def sensor_payload():
    """Artimiausi darbai: procedūros, skiepai / antiparazitinės, vizitai ir šiuo metu duodami vaistai."""
    t = dt.date.today()
    st = meta_get("settings") or DEFAULT_SETTINGS
    items = []
    for p in rows("SELECT * FROM procedures WHERE active=1 ORDER BY pos, id"):
        due = next_due(p, last_done(p["id"]), t)
        if due and (due - t).days <= 3:
            items.append({"tekstas": p["name"], "emoji": p["emoji"] or "✂️", "tipas": "procedūra",
                          "dienos": (due - t).days, "data": due.isoformat()})
    latest = {}
    for p in rows("SELECT * FROM prevention WHERE valid_until IS NOT NULL AND valid_until<>'' ORDER BY date DESC, id DESC"):
        latest.setdefault((p["name"] or "").strip().lower(), p)
    for p in latest.values():
        try:
            left = (dt.date.fromisoformat(p["valid_until"]) - t).days
        except ValueError:
            continue
        if -60 <= left <= int(st.get("alert_days") or 30):
            items.append({"tekstas": p["name"] + (" – baigėsi" if left < 0 else " – galioja iki " + p["valid_until"]),
                          "emoji": "💉" if p["kind"] == "Vakcina" else "🛡️", "tipas": p["kind"] or "prevencija",
                          "dienos": left, "data": p["valid_until"]})
    for v in rows("SELECT * FROM visits WHERE date>=? AND date<=? ORDER BY date, time",
                  (t.isoformat(), (t + dt.timedelta(days=14)).isoformat())):
        items.append({"tekstas": (v["title"] or v["category"] or "Vizitas") + (" " + v["time"] if v["time"] else ""),
                      "emoji": "🏥", "tipas": "vizitas", "dienos": (dt.date.fromisoformat(v["date"]) - t).days,
                      "data": v["date"]})
    items.sort(key=lambda i: i["dienos"])
    meds = [" ".join(x for x in (m["name"], m["dose"], m["freq"]) if x)
            for m in rows("SELECT * FROM meds WHERE (start IS NULL OR start='' OR start<=?) AND (end IS NULL OR end='' OR end>=?) ORDER BY id",
                          (t.isoformat(), t.isoformat()))]
    name = ((meta_get("profile") or {}).get("name") or "").strip() or "Rodukas"
    return {"state": len([i for i in items if i["dienos"] <= 0]), "attributes": {
        "friendly_name": name + " – priminimai", "icon": "mdi:dog", "unit_of_measurement": "prim.",
        "items": items, "vaistai": meds, "atnaujinta": now()}}


def sensor_loop():
    last, sent = None, 0
    while True:
        try:
            with LOCK:
                p = sensor_payload()
            key = json.dumps({**p, "attributes": {**p["attributes"], "atnaujinta": ""}}, sort_keys=True)
            # HA perkrovus būsena dingsta, todėl kas 10 min. siunčiama iš naujo
            if key != last or time.time() - sent > 600:
                ha_request("POST", "/states/" + SENSOR_ID, p)
                last, sent, SENSOR_STATE["last"], SENSOR_STATE["error"] = key, time.time(), now(), ""
        except Exception as e:  # noqa
            SENSOR_STATE["error"] = str(e)
            log("HA jutiklio klaida:", e)
        time.sleep(20)


def main():
    init_db()
    if SUPERVISOR_TOKEN:
        threading.Thread(target=sensor_loop, daemon=True).start()
        threading.Thread(target=reminder_loop, daemon=True).start()
        threading.Thread(target=action_listener, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Rodukas veikia per prievadą {PORT}. Duomenys: {DATA_DIR}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
