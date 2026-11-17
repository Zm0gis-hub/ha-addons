#!/usr/bin/env python3
"""Sveikata – galvos skausmų (migrenos) dienoraščio ir išgerto vandens Home Assistant priedo serveris.

Naudoja tik standartinę Python biblioteką (be papildomų paketų).
Duomenys saugomi /data aplanke (patenka į HA atsargines kopijas).

Kiekvienas žmogus turi savo profilį. Atidarius per Home Assistant profilis parenkamas
pagal prisijungusį HA naudotoją (ingress antraštė X-Remote-User-Id), todėl kiekvienas
mato tik savo duomenis.
"""
import base64
import csv
import datetime as dt
import hashlib
import hmac
import http.client
import io
import json
import os
import re
import secrets
import socket
import sqlite3
import struct
import threading
import time
import urllib.error
import urllib.request
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote, parse_qs

DATA_DIR = os.environ.get("DATA_DIR", "/data")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
DB_PATH = os.path.join(DATA_DIR, "sveikata.db")
PORT = int(os.environ.get("PORT", "8099"))
INGRESS_IP = "172.30.32.2"  # HA ingress proxy adresas
SUP_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
HA_HOST = os.environ.get("SVEIKATA_HA_HOST", "supervisor")
HA_PORT = int(os.environ.get("SVEIKATA_HA_PORT", "80"))

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
AUTH_TOKEN = hashlib.sha256(("sveikata:" + PIN).encode()).hexdigest() if PIN else ""


def log(*a):
    print(dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


# ---------------------------------------------------------------- DB

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS profiles (id INTEGER PRIMARY KEY, name TEXT, emoji TEXT DEFAULT '🙂', color TEXT DEFAULT '',
  pin TEXT DEFAULT '', goal_ml INTEGER DEFAULT 2000, settings TEXT DEFAULT '{}', archived INTEGER DEFAULT 0, created TEXT);
CREATE TABLE IF NOT EXISTS links (ha_user TEXT PRIMARY KEY, profile_id INTEGER, ha_name TEXT DEFAULT '', created TEXT);
CREATE TABLE IF NOT EXISTS drink_types (id INTEGER PRIMARY KEY, profile_id INTEGER, name TEXT, emoji TEXT DEFAULT '🥤',
  ml INTEGER DEFAULT 250, in_goal INTEGER DEFAULT 1, caffeine INTEGER DEFAULT 0, pos INTEGER DEFAULT 0, archived INTEGER DEFAULT 0,
  parent INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS drinks (id INTEGER PRIMARY KEY, profile_id INTEGER, type_id INTEGER, ml INTEGER, ts TEXT,
  day TEXT, uid TEXT, src TEXT DEFAULT 'app');
CREATE INDEX IF NOT EXISTS drinks_pd ON drinks(profile_id, day);
CREATE UNIQUE INDEX IF NOT EXISTS drinks_uid ON drinks(uid) WHERE uid IS NOT NULL AND uid != '';
CREATE TABLE IF NOT EXISTS meds (id INTEGER PRIMARY KEY, profile_id INTEGER, name TEXT, dose TEXT DEFAULT '',
  kind TEXT DEFAULT 'analgetikas', pos INTEGER DEFAULT 0, archived INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS episodes (id INTEGER PRIMARY KEY, profile_id INTEGER, start TEXT, ended TEXT DEFAULT '',
  intensity INTEGER, kind TEXT DEFAULT '', locs TEXT DEFAULT '[]', chars TEXT DEFAULT '[]', symptoms TEXT DEFAULT '[]',
  triggers TEXT DEFAULT '[]', relief TEXT DEFAULT '[]', impact TEXT DEFAULT '', notes TEXT DEFAULT '',
  uid TEXT DEFAULT '', created TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS doses (id INTEGER PRIMARY KEY, profile_id INTEGER, episode_id INTEGER, med_id INTEGER,
  ts TEXT, amount TEXT DEFAULT '', effect TEXT DEFAULT '', note TEXT DEFAULT '', uid TEXT DEFAULT '', asked INTEGER DEFAULT 0);
"""

# lentelė -> stulpeliai, kuriuos galima keisti per bendrą „save“ veiksmą
TABLES = {
    "drink_types": ["name", "emoji", "ml", "in_goal", "caffeine", "pos", "archived", "parent"],
    "drinks": ["type_id", "ml", "ts"],
    "meds": ["name", "dose", "kind", "pos", "archived"],
    "episodes": ["start", "ended", "intensity", "kind", "locs", "chars", "symptoms", "triggers", "relief", "impact", "notes"],
    "doses": ["episode_id", "med_id", "ts", "amount", "effect", "note"],
}
NUMERIC = {"ml", "in_goal", "caffeine", "pos", "archived", "parent", "type_id", "intensity", "episode_id", "med_id"}
LISTS = {"locs", "chars", "symptoms", "triggers", "relief"}
EFFECTS = {"", "padejo", "is_dalies", "nepadejo"}
MED_KINDS = {"triptanas", "analgetikas", "nvnu", "kombinuotas", "profilaktinis", "kita"}

DEFAULT_DRINKS = [
    ("Vanduo", "💧", 250, 1, 0),
    ("Kava", "☕", 200, 1, 80),
    ("Arbata", "🍵", 250, 1, 0),
    ("Limonadas", "🍋", 330, 1, 0),
    ("Sultys", "🧃", 250, 1, 0),
]
# „Kava“ – grupė: paspaudus iššoka pasirinkimas iš šių rūšių
KAVA_VARIANTS = [
    ("Americano viengubas", "☕", 150, 1, 80),
    ("Americano dvigubas", "☕", 250, 1, 150),
    ("Cappuccino dvigubas", "☕", 250, 1, 150),
]

PROFILE_DEFAULTS = {
    "notify": [],          # mobile_app_* paslaugos; tuščia ir notify_auto – telefonai randami pagal HA naudotoją
    "notify_auto": True,
    "wr_on": False,        # priminti gerti vandenį
    "wr_from": "09:00",
    "wr_to": "21:00",
    "wr_every": 2,         # valandos
    "mc_on": True,         # po kiek laiko paklausti, ar padėjo vaistai
    "mc_hours": 2,
    "doc_notes": "",       # klausimai gydytojui (ataskaitoje)
}


def now():
    return dt.datetime.now().strftime("%Y-%m-%dT%H:%M")


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
        if not meta_get("secret"):
            meta_set("secret", secrets.token_hex(16))
        cols = {c["name"] for c in DB.execute("PRAGMA table_info(drink_types)").fetchall()}
        if "parent" not in cols:
            DB.execute("ALTER TABLE drink_types ADD COLUMN parent INTEGER DEFAULT 0")
        if not meta_get("kava_variants"):
            # 1.1.0: esamiems profiliams „Kava“ tampa grupe su kavos rūšimis
            for k in rows("SELECT * FROM drink_types WHERE name='Kava' AND archived=0 AND COALESCE(parent,0)=0"):
                if not DB.execute("SELECT 1 FROM drink_types WHERE parent=?", (k["id"],)).fetchone():
                    add_variants(k["profile_id"], k["id"])
            meta_set("kava_variants", 1)
        DB.commit()


def bump():
    meta_set("version", int(meta_get("version", 1)) + 1)
    SENSOR_NOW.set()


def version():
    return int(meta_get("version", 1))


def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        return int(v) if float(v).is_integer() else v
    s = str(v).strip().replace(",", ".").replace(" ", "")
    try:
        f = float(s)
        return int(f) if f.is_integer() else f
    except ValueError:
        return None


TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")


def clean_ts(v, allow_empty=False):
    v = (v or "").strip().replace(" ", "T")[:16]
    if not v:
        if allow_empty:
            return ""
        raise ValueError("Nenurodytas laikas")
    if not TS_RE.match(v):
        raise ValueError(f"Blogas laikas: {v}")
    dt.datetime.fromisoformat(v)
    return v


def epoch_ts(sec):
    try:
        return dt.datetime.fromtimestamp(float(sec)).strftime("%Y-%m-%dT%H:%M")
    except Exception:
        return now()


def profile_settings(p):
    try:
        s = json.loads(p.get("settings") or "{}")
    except Exception:
        s = {}
    out = dict(PROFILE_DEFAULTS)
    out.update(s if isinstance(s, dict) else {})
    return out


def get_profile(pid):
    r = DB.execute("SELECT * FROM profiles WHERE id=? AND archived=0", (pid,)).fetchone()
    return dict(r) if r else None


# ---------------------------------------------------------------- būsena (tik vieno profilio)

def loads_list(v):
    try:
        x = json.loads(v or "[]")
        return x if isinstance(x, list) else []
    except Exception:
        return []


def day_stats(pid, since=None):
    """Kiekvienos dienos suvestinė: į tikslą įskaičiuota, iš viso, kofeinas, kavos porcijos."""
    q = """SELECT d.day, SUM(CASE WHEN t.in_goal=1 OR t.id IS NULL THEN d.ml ELSE 0 END) AS goal_ml,
                  SUM(d.ml) AS all_ml,
                  SUM(CASE WHEN t.caffeine>0 AND t.ml>0 THEN t.caffeine*d.ml*1.0/t.ml ELSE 0 END) AS caf,
                  SUM(CASE WHEN t.caffeine>0 THEN 1 ELSE 0 END) AS caf_n, COUNT(*) AS n
           FROM drinks d LEFT JOIN drink_types t ON t.id=d.type_id
           WHERE d.profile_id=?""" + (" AND d.day>=?" if since else "") + " GROUP BY d.day ORDER BY d.day"
    return [{"day": r["day"], "ml": int(r["goal_ml"] or 0), "all": int(r["all_ml"] or 0),
             "caf": int(round(r["caf"] or 0)), "caf_n": r["caf_n"], "n": r["n"]}
            for r in rows(q, (pid, since) if since else (pid,))]


def full_state(pid, info=None):
    p = get_profile(pid)
    since = (dt.date.today() - dt.timedelta(days=45)).isoformat()
    eps = rows("SELECT * FROM episodes WHERE profile_id=? ORDER BY start DESC", (pid,))
    for e in eps:
        for c in LISTS:
            e[c] = loads_list(e.get(c))
    others = [{"id": r["id"], "name": r["name"], "emoji": r["emoji"]}
              for r in rows("SELECT id, name, emoji FROM profiles WHERE archived=0 AND id!=? ORDER BY id", (pid,))]
    return {
        "version": version(), "today": today(), "now": now(),
        "profile": {"id": p["id"], "name": p["name"], "emoji": p["emoji"], "color": p["color"],
                    "goal_ml": p["goal_ml"], "has_pin": bool(p["pin"]), "settings": profile_settings(p)},
        "me": info or {},
        "profiles_n": 1 + len(others),
        "drink_types": rows("SELECT * FROM drink_types WHERE profile_id=? ORDER BY archived, pos, id", (pid,)),
        "drinks": rows("SELECT * FROM drinks WHERE profile_id=? AND day>=? ORDER BY ts, id", (pid, since)),
        "days": day_stats(pid),
        "meds": rows("SELECT * FROM meds WHERE profile_id=? ORDER BY archived, pos, id", (pid,)),
        "episodes": eps,
        "doses": rows("SELECT * FROM doses WHERE profile_id=? ORDER BY ts", (pid,)),
        "ha": bool(SUP_TOKEN),
    }


# ---------------------------------------------------------------- veiksmai

def owned(t, rid, pid):
    r = DB.execute(f"SELECT profile_id FROM {t} WHERE id=?", (rid,)).fetchone()
    if not r or r["profile_id"] != pid:
        raise ValueError("Įrašas nerastas")


def clean_row(t, row, pid):
    out = {}
    for k, v in row.items():
        if k not in TABLES[t]:
            continue
        if k in LISTS:
            v = json.dumps([str(x)[:60] for x in (v or []) if str(x).strip()][:40], ensure_ascii=False)
        elif k in NUMERIC:
            v = num(v)
        elif isinstance(v, str):
            v = v.strip()[:4000]
        out[k] = v
    if t == "drinks":
        if "ts" in out:
            out["ts"] = clean_ts(out["ts"])
            out["day"] = out["ts"][:10]
        if "ml" in out and (not out["ml"] or out["ml"] <= 0 or out["ml"] > 5000):
            raise ValueError("Kiekis turi būti 1–5000 ml")
        if out.get("type_id"):
            owned("drink_types", out["type_id"], pid)
    if t == "drink_types":
        if "name" in out and not out["name"]:
            raise ValueError("Įrašykite pavadinimą")
        if "ml" in out and (not out["ml"] or out["ml"] <= 0):
            out["ml"] = 250
        if out.get("parent"):
            par = DB.execute("SELECT profile_id, parent FROM drink_types WHERE id=?", (out["parent"],)).fetchone()
            if not par or par["profile_id"] != pid or (par["parent"] or 0):
                raise ValueError("Netinkama grupė")
            rid = num(row.get("id"))
            if rid and (rid == out["parent"] or DB.execute("SELECT 1 FROM drink_types WHERE parent=? AND archived=0", (rid,)).fetchone()):
                raise ValueError("Gėrimas, turintis rūšių, negali būti kito rūšimi")
        elif "parent" in out:
            out["parent"] = 0
    if t == "meds":
        if "name" in out and not out["name"]:
            raise ValueError("Įrašykite vaisto pavadinimą")
        if "kind" in out and out["kind"] not in MED_KINDS:
            out["kind"] = "kita"
    if t == "episodes":
        if "start" in out:
            out["start"] = clean_ts(out["start"])
        if "ended" in out:
            out["ended"] = clean_ts(out["ended"], allow_empty=True)
        if "intensity" in out and out["intensity"] is not None:
            out["intensity"] = max(0, min(10, int(out["intensity"])))
        out["updated"] = now()
    if t == "doses":
        if "ts" in out:
            out["ts"] = clean_ts(out["ts"])
        if "effect" in out and out["effect"] not in EFFECTS:
            out["effect"] = ""
        if out.get("med_id"):
            owned("meds", out["med_id"], pid)
        if out.get("episode_id"):
            owned("episodes", out["episode_id"], pid)
        if "effect" in out:
            out["asked"] = 1
    return out


def insert(t, row):
    cols = list(row.keys())
    cur = DB.execute(f"INSERT INTO {t} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", [row[c] for c in cols])
    return cur.lastrowid


def act_save(d, pid):
    t = d.get("t")
    if t not in TABLES:
        raise ValueError("Nežinoma lentelė")
    row = clean_row(t, d.get("row") or {}, pid)
    rid = num((d.get("row") or {}).get("id"))
    if rid:
        owned(t, rid, pid)
        if row:
            DB.execute(f"UPDATE {t} SET {','.join(c + '=?' for c in row)} WHERE id=?", [*row.values(), rid])
        return {"id": rid}
    row["profile_id"] = pid
    if t == "drinks":
        row.setdefault("ts", now())
        row.setdefault("day", row["ts"][:10])
        row["uid"] = str((d.get("row") or {}).get("uid") or secrets.token_hex(8))
        if not row.get("ml"):
            raise ValueError("Nenurodytas kiekis")
    if t == "episodes":
        row.setdefault("start", now())
        row["created"] = now()
        row["uid"] = secrets.token_hex(8)
    if t == "doses":
        row.setdefault("ts", now())
        if not row.get("med_id"):
            raise ValueError("Pasirinkite vaistą")
        if not row.get("effect"):
            row["asked"] = 0
    if t in ("drink_types", "meds"):
        row.setdefault("pos", (DB.execute(f"SELECT COALESCE(MAX(pos),0)+1 FROM {t} WHERE profile_id=?", (pid,)).fetchone()[0]))
    return {"id": insert(t, row)}


def act_delete(d, pid):
    t, rid = d.get("t"), num(d.get("id"))
    if t not in TABLES or not rid:
        raise ValueError("Blogas trynimas")
    owned(t, rid, pid)
    if t == "episodes":
        # epizodo vaistai lieka kaip atskiri įrašai (be epizodo)
        DB.execute("UPDATE doses SET episode_id=NULL WHERE episode_id=?", (rid,))
    if t == "drink_types":
        DB.execute("UPDATE drink_types SET parent=0 WHERE parent=?", (rid,))  # rūšys tampa atskirais gėrimais
        if DB.execute("SELECT 1 FROM drinks WHERE type_id=? LIMIT 1", (rid,)).fetchone():
            DB.execute("UPDATE drink_types SET archived=1 WHERE id=?", (rid,))
            return {"archived": True}
    if t == "meds":
        if DB.execute("SELECT 1 FROM doses WHERE med_id=? LIMIT 1", (rid,)).fetchone():
            DB.execute("UPDATE meds SET archived=1 WHERE id=?", (rid,))
            return {"archived": True}
    DB.execute(f"DELETE FROM {t} WHERE id=?", (rid,))
    return {}


def add_drink(pid, type_id, ml=None, ts=None, uid="", src="app"):
    t = DB.execute("SELECT * FROM drink_types WHERE id=? AND profile_id=?", (type_id, pid)).fetchone()
    if not t:
        raise ValueError("Nėra tokio gėrimo")
    ml = int(num(ml) or t["ml"] or 250)
    if ml <= 0 or ml > 5000:
        raise ValueError("Kiekis turi būti 1–5000 ml")
    ts = clean_ts(ts) if ts else now()
    if uid and DB.execute("SELECT 1 FROM drinks WHERE uid=?", (uid,)).fetchone():
        return None  # jau įrašyta (pvz. laikrodis pakartojo)
    return insert("drinks", {"profile_id": pid, "type_id": type_id, "ml": ml, "ts": ts, "day": ts[:10],
                             "uid": uid or secrets.token_hex(8), "src": src})


def act_drink(d, pid):
    return {"id": add_drink(pid, num(d.get("type_id")), d.get("ml"), d.get("ts"), str(d.get("uid") or ""))}


def active_episode(pid):
    r = DB.execute("SELECT * FROM episodes WHERE profile_id=? AND ended='' ORDER BY start DESC LIMIT 1", (pid,)).fetchone()
    return dict(r) if r else None


def start_episode(pid, intensity=None, ts=None, uid=""):
    if uid and DB.execute("SELECT 1 FROM episodes WHERE uid=?", (uid,)).fetchone():
        return None
    a = active_episode(pid)
    if a:
        if intensity is not None and (a["intensity"] or 0) < intensity:
            DB.execute("UPDATE episodes SET intensity=?, updated=? WHERE id=?", (intensity, now(), a["id"]))
        return a["id"]
    return insert("episodes", {"profile_id": pid, "start": ts or now(), "ended": "", "intensity": intensity,
                               "uid": uid or secrets.token_hex(8), "created": now(), "updated": now()})


def act_episode_end(d, pid):
    rid = num(d.get("id"))
    a = get_episode(rid, pid) if rid else active_episode(pid)
    if not a:
        raise ValueError("Šiuo metu galvos skausmas nepažymėtas")
    end = clean_ts(d.get("ended")) if d.get("ended") else now()
    if end < a["start"]:
        end = a["start"]
    DB.execute("UPDATE episodes SET ended=?, updated=? WHERE id=?", (end, now(), a["id"]))
    return {"id": a["id"]}


def get_episode(rid, pid):
    r = DB.execute("SELECT * FROM episodes WHERE id=? AND profile_id=?", (rid, pid)).fetchone()
    return dict(r) if r else None


def add_dose(pid, med_id, ts=None, uid="", episode_id="auto"):
    if uid and DB.execute("SELECT 1 FROM doses WHERE uid=?", (uid,)).fetchone():
        return None
    m = DB.execute("SELECT * FROM meds WHERE id=? AND profile_id=?", (med_id, pid)).fetchone()
    if not m:
        raise ValueError("Nėra tokio vaisto")
    ts = ts or now()
    if episode_id == "auto":
        a = active_episode(pid)
        episode_id = a["id"] if a else None
    elif episode_id:
        owned("episodes", episode_id, pid)
    else:
        episode_id = None
    return insert("doses", {"profile_id": pid, "episode_id": episode_id, "med_id": med_id, "ts": ts,
                            "amount": m["dose"] or "", "effect": "", "uid": uid or secrets.token_hex(8), "asked": 0})


def act_profile_save(d, pid):
    p = get_profile(pid)
    upd = {}
    if "name" in d:
        upd["name"] = (d.get("name") or "").strip()[:40] or p["name"]
    if "emoji" in d:
        upd["emoji"] = (d.get("emoji") or "🙂").strip()[:8]
    if "color" in d:
        upd["color"] = (d.get("color") or "")[:20]
    if "goal_ml" in d:
        g = int(num(d.get("goal_ml")) or 2000)
        upd["goal_ml"] = max(500, min(6000, g))
    if "pin" in d:
        upd["pin"] = re.sub(r"\D", "", str(d.get("pin") or ""))[:8]
    if "settings" in d and isinstance(d["settings"], dict):
        s = profile_settings(p)
        for k in PROFILE_DEFAULTS:
            if k in d["settings"]:
                s[k] = d["settings"][k]
        upd["settings"] = json.dumps(s, ensure_ascii=False)
    if upd:
        DB.execute(f"UPDATE profiles SET {','.join(k + '=?' for k in upd)} WHERE id=?", [*upd.values(), pid])
    return {}


def act_order(d, pid):
    t = d.get("t")
    if t not in ("drink_types", "meds"):
        raise ValueError("Blogas rikiavimas")
    for i, rid in enumerate(d.get("ids") or []):
        DB.execute(f"UPDATE {t} SET pos=? WHERE id=? AND profile_id=?", (i, num(rid), pid))
    return {}


def act_profile_delete(d, pid):
    if str(d.get("confirm") or "") != "TRINTI":
        raise ValueError("Nepatvirtinta")
    for t in ("drinks", "drink_types", "doses", "meds", "episodes"):
        DB.execute(f"DELETE FROM {t} WHERE profile_id=?", (pid,))
    DB.execute("DELETE FROM links WHERE profile_id=?", (pid,))
    DB.execute("DELETE FROM profiles WHERE id=?", (pid,))
    return {"deleted": True}


def act_notify_test(d, pid):
    p = get_profile(pid)
    send_notification(pid, "💧 Sveikata", f"Bandomasis pranešimas ({p['name']}) – priminimai veikia ✓",
                      tag="sveikata_test", services=d.get("services") or None)
    return {"ok": True}


ACTIONS = {
    "save": act_save,
    "delete": act_delete,
    "drink": act_drink,
    "episode_start": lambda d, pid: {"id": start_episode(pid, num(d.get("intensity")),
                                                          clean_ts(d["start"]) if d.get("start") else None)},
    "episode_end": act_episode_end,
    "dose": lambda d, pid: {"id": add_dose(pid, num(d.get("med_id")), clean_ts(d["ts"]) if d.get("ts") else None,
                                           episode_id=num(d.get("episode_id")) if "episode_id" in d else "auto")},
    "profile_save": act_profile_save,
    "profile_delete": act_profile_delete,
    "order": act_order,
    "notify_test": act_notify_test,
}
NO_LOCK = {"notify_test"}


def add_variants(pid, parent):
    base = DB.execute("SELECT COALESCE(MAX(pos),0)+1 FROM drink_types WHERE profile_id=?", (pid,)).fetchone()[0]
    for i, (n, e, ml, g, caf) in enumerate(KAVA_VARIANTS):
        insert("drink_types", {"profile_id": pid, "name": n, "emoji": e, "ml": ml, "in_goal": g, "caffeine": caf,
                               "pos": base + i, "parent": parent})


def create_profile(name, emoji="🙂", color=""):
    name = (name or "").strip()[:40]
    if not name:
        raise ValueError("Įrašykite vardą")
    pid = insert("profiles", {"name": name, "emoji": (emoji or "🙂")[:8], "color": color or "", "goal_ml": 2000,
                              "settings": "{}", "created": now()})
    kava = None
    for i, (n, e, ml, g, caf) in enumerate(DEFAULT_DRINKS):
        tid = insert("drink_types", {"profile_id": pid, "name": n, "emoji": e, "ml": ml, "in_goal": g, "caffeine": caf, "pos": i})
        kava = tid if n == "Kava" else kava
    if kava:
        add_variants(pid, kava)
    return pid


# ---------------------------------------------------------------- profilio nustatymas pagal užklausą

def sign(pid):
    return f"{pid}.{hmac.new(str(meta_get('secret')).encode(), str(pid).encode(), 'sha256').hexdigest()[:24]}"


def who(h):
    """Grąžina (profilio id arba None, informacija). Per HA – pagal HA naudotoją, kitaip – pagal slapuką."""
    via = h.client_address[0] == INGRESS_IP
    uid = (h.headers.get("X-Remote-User-Id") or "") if via else ""
    name = (h.headers.get("X-Remote-User-Display-Name") or h.headers.get("X-Remote-User-Name") or "") if via else ""
    try:  # HTTP antraštės skaitomos kaip latin-1, o HA siunčia UTF-8 (pvz. „Rūta“)
        name = name.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    info = {"via_ha": via, "ha_user": bool(uid), "ha_name": name}
    with LOCK:
        if uid:
            r = DB.execute("SELECT l.profile_id FROM links l JOIN profiles p ON p.id=l.profile_id "
                           "WHERE l.ha_user=? AND p.archived=0", (uid,)).fetchone()
            return (r["profile_id"] if r else None), info
        c = SimpleCookie(h.headers.get("Cookie", ""))
        if "sveikata_prof" in c:
            val = c["sveikata_prof"].value
            pid = num(val.split(".", 1)[0])
            if pid and secrets.compare_digest(val, sign(pid)) and get_profile(pid):
                return pid, info
    return None, info


def candidates(info):
    """Kuriuos profilius galima pasirinkti: per HA – dar niekam nepriskirtus arba su profilio PIN."""
    out = []
    for p in rows("SELECT p.*, (SELECT COUNT(*) FROM links l WHERE l.profile_id=p.id) AS nlinks "
                  "FROM profiles p WHERE archived=0 ORDER BY id"):
        if info.get("ha_user") and p["nlinks"] and not p["pin"]:
            continue
        out.append({"id": p["id"], "name": p["name"], "emoji": p["emoji"], "has_pin": bool(p["pin"]),
                    "linked": bool(p["nlinks"])})
    return out


# ---------------------------------------------------------------- Home Assistant

def ha(method, path, body=None, timeout=10):
    if not SUP_TOKEN:
        raise RuntimeError("Nėra ryšio su Home Assistant")
    conn = http.client.HTTPConnection(HA_HOST, HA_PORT, timeout=timeout)
    try:
        data = json.dumps(body).encode() if body is not None else None
        conn.request(method, "/core/api/" + path.lstrip("/"), body=data, headers={
            "Authorization": "Bearer " + SUP_TOKEN, "Content-Type": "application/json"})
        r = conn.getresponse()
        raw = r.read()
        if r.status >= 300:
            raise ValueError(f"Home Assistant atsakė {r.status}: {raw[:200].decode('utf-8', 'replace')}")
        if not raw:
            return None
        try:
            return json.loads(raw)
        except ValueError:
            return raw.decode("utf-8", "replace")
    finally:
        conn.close()


class MiniWS:
    """Paprastas WebSocket klientas HA (skydelių sąrašui ir pranešimų mygtukų įvykiams)."""

    def __init__(self, host, port, path, timeout=20):
        self.sock = socket.create_connection((host, port), timeout=timeout)
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

    def auth(self):
        self.recv()
        self.send({"type": "auth", "access_token": SUP_TOKEN})
        if self.recv().get("type") != "auth_ok":
            raise ConnectionError("HA neprileido")

    def close(self):
        try:
            self.sock.close()
        except Exception:  # noqa
            pass


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
            ws.auth()
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
            ws.close()
    except Exception as e:  # noqa
        log("Nepavyko gauti HA skydelių sąrašo:", e)
    if not path:
        path = "/hassio/ingress/" + slug
    CLICK_PATH.update(path=path, at=time.time())
    return path


def notify_all():
    out = []
    for d in ha("GET", "services") or []:
        if d.get("domain") == "notify":
            out += [n for n in d.get("services", {}) if n.startswith("mobile_app_")]
    return sorted(out)


def phones_for_user(user_id):
    """HA naudotojas -> asmuo -> jo telefonų sekikliai -> mobile_app_* pranešimų paslaugos."""
    notify = set(notify_all())
    found, trackers = [], []
    for st in ha("GET", "states") or []:
        if st["entity_id"].startswith("person.") and st.get("attributes", {}).get("user_id") == user_id:
            trackers = st["attributes"].get("device_trackers", []) or []
    for tr in trackers:
        cands = ["mobile_app_" + tr.split(".", 1)[-1]]
        try:
            slug = ha("POST", "template", {"template": "{{ device_attr(device_id('%s'), 'name') | slugify }}" % tr})
            if slug and str(slug).strip() not in ("", "none"):
                cands.insert(0, "mobile_app_" + str(slug).strip())
        except Exception:  # noqa
            pass
        for c in cands:
            if c in notify and c not in found:
                found.append(c)
                break
    return found


PHONES = {}  # profilio id -> (telefonai, laikas)


def phones_for_profile(pid, refresh=False):
    with LOCK:
        p = get_profile(pid)
        if not p:
            return []
        s = profile_settings(p)
        users = [r["ha_user"] for r in rows("SELECT ha_user FROM links WHERE profile_id=?", (pid,))]
    if s.get("notify"):
        return list(s["notify"])
    if not s.get("notify_auto") or not users:
        return []
    c = PHONES.get(pid)
    if c and not refresh and time.time() - c[1] < 3600:
        return c[0]
    found = []
    for u in users:
        for x in phones_for_user(u):
            if x not in found:
                found.append(x)
    PHONES[pid] = (found, time.time())
    return found


NOTIFY_STATE = {}  # profilio id -> {"error", "last"}


def send_notification(pid, title, message, tag=None, services=None, actions=None):
    services = services or phones_for_profile(pid)
    if not services:
        raise ValueError("Nerastas telefonas (⚙️ Nustatymai → Pranešimai telefone)")
    data = {"clickAction": ingress_path(), "channel": "Sveikata"}
    if tag:
        data["tag"] = tag
    if actions:
        data["actions"] = actions
    errs = []
    for svc in services:
        try:
            ha("POST", f"services/notify/{svc}", {"title": title, "message": message, "data": data})
        except Exception as e:  # noqa
            errs.append(f"{svc}: {e}")
    st = NOTIFY_STATE.setdefault(pid, {"error": "", "last": ""})
    if errs and len(errs) == len(services):
        st["error"] = "; ".join(errs)
        raise ValueError(st["error"])
    st.update(error="", last=now())


# ---------------------------------------------------------------- priminimai

def hm(s, default):
    try:
        h, m = (s or default).split(":")
        return int(h) * 60 + int(m)
    except Exception:  # noqa
        h, m = default.split(":")
        return int(h) * 60 + int(m)


def today_total(pid, day=None):
    r = DB.execute("""SELECT COALESCE(SUM(d.ml),0) FROM drinks d LEFT JOIN drink_types t ON t.id=d.type_id
                      WHERE d.profile_id=? AND d.day=? AND (t.in_goal=1 OR t.id IS NULL)""",
                   (pid, day or today())).fetchone()
    return int(r[0] or 0)


def drink_actions(pid, n=2):
    out = []
    for t in rows("""SELECT * FROM drink_types t WHERE profile_id=? AND archived=0 AND COALESCE(parent,0)=0
                     AND NOT EXISTS (SELECT 1 FROM drink_types c WHERE c.parent=t.id AND c.archived=0)
                     ORDER BY pos, id LIMIT ?""", (pid, n)):
        out.append({"action": f"SVK_G_{pid}_{t['id']}_{t['ml']}", "title": f"+{t['ml']} ml {t['name'].lower()}"})
    return out


def collect_reminders(nowdt=None):
    nowdt = nowdt or dt.datetime.now()
    out = []
    mins = nowdt.hour * 60 + nowdt.minute
    for p in rows("SELECT * FROM profiles WHERE archived=0"):
        pid, s = p["id"], profile_settings(p)
        # vanduo: jei atsiliekama nuo tempo ir seniai gerta
        if s.get("wr_on"):
            a, b = hm(s.get("wr_from"), "09:00"), hm(s.get("wr_to"), "21:00")
            every = max(1, float(num(s.get("wr_every")) or 2)) * 60
            if a < b and a <= mins <= b:
                goal, total = p["goal_ml"] or 2000, today_total(pid)
                expected = goal * (mins - a) / (b - a)
                last_drink = DB.execute("SELECT MAX(ts) FROM drinks WHERE profile_id=? AND day=?",
                                        (pid, today())).fetchone()[0]
                since_drink = (nowdt - dt.datetime.fromisoformat(last_drink)).total_seconds() / 60 if last_drink else 1e9
                last_rem = meta_get(f"wr_last_{pid}") or ""
                since_rem = (nowdt - dt.datetime.fromisoformat(last_rem)).total_seconds() / 60 if last_rem else 1e9
                if total < goal and total < expected - 150 and since_drink >= every and since_rem >= every:
                    meta_set(f"wr_last_{pid}", nowdt.strftime("%Y-%m-%dT%H:%M"))
                    out.append((pid, "💧 Laikas atsigerti",
                                f"Šiandien išgerta {total} ml iš {goal} ml", f"sveikata_vanduo_{pid}",
                                drink_actions(pid)))
        # vaistai: po kelių valandų paklausti, ar padėjo
        if s.get("mc_on"):
            hours = max(0.5, float(num(s.get("mc_hours")) or 2))
            lim = (nowdt - dt.timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M")
            old = (nowdt - dt.timedelta(hours=hours + 10)).strftime("%Y-%m-%dT%H:%M")
            for x in rows("""SELECT d.*, m.name FROM doses d JOIN meds m ON m.id=d.med_id
                             WHERE d.profile_id=? AND d.asked=0 AND d.effect='' AND d.ts<=? AND d.ts>=?""",
                          (pid, lim, old)):
                DB.execute("UPDATE doses SET asked=1 WHERE id=?", (x["id"],))
                out.append((pid, f"💊 Ar padėjo {x['name']}?", f"Išgerta {x['ts'][11:16]}. Pažymėkite – bus matyti ataskaitoje gydytojui.",
                            f"sveikata_vaistas_{x['id']}",
                            [{"action": f"SVK_D_{x['id']}_padejo", "title": "Padėjo"},
                             {"action": f"SVK_D_{x['id']}_is_dalies", "title": "Iš dalies"},
                             {"action": f"SVK_D_{x['id']}_nepadejo", "title": "Nepadėjo"}]))
    return out


def reminder_loop():
    while True:
        try:
            with LOCK:
                todo = collect_reminders()
                DB.commit()
            for pid, title, msg, tag, actions in todo:
                try:
                    send_notification(pid, title, msg, tag=tag, actions=actions)
                    log("Išsiųsta:", title)
                except Exception as e:  # noqa
                    log("Pranešimo klaida:", e)
        except Exception as e:  # noqa
            log("Priminimų klaida:", e)
        time.sleep(60)


def handle_action(action):
    """Paspaustas pranešimo mygtukas (mobile_app_notification_action)."""
    m = re.match(r"^SVK_G_(\d+)_(\d+)_(\d+)$", action or "")
    with LOCK:
        try:
            if m:
                add_drink(int(m.group(1)), int(m.group(2)), int(m.group(3)), src="pranesimas")
            else:
                m = re.match(r"^SVK_D_(\d+)_(padejo|is_dalies|nepadejo)$", action or "")
                if not m:
                    return
                DB.execute("UPDATE doses SET effect=?, asked=1 WHERE id=?", (m.group(2), int(m.group(1))))
            bump()
            DB.commit()
            log("Pranešimo mygtukas:", action)
        except Exception as e:  # noqa
            DB.rollback()
            log("Pranešimo mygtuko klaida:", e)


def event_loop():
    """Klauso HA įvykių: paspausti pranešimų mygtukai."""
    while True:
        try:
            ws = MiniWS(HA_HOST, HA_PORT, "/core/websocket", timeout=None)
            try:
                ws.auth()
                ws.send({"id": 1, "type": "subscribe_events", "event_type": "mobile_app_notification_action"})
                while True:
                    m = ws.recv()
                    if m.get("type") == "event":
                        a = ((m.get("event") or {}).get("data") or {}).get("action") or ""
                        if a.startswith("SVK_"):
                            handle_action(a)
            finally:
                ws.close()
        except Exception as e:  # noqa
            log("HA įvykių ryšys nutrūko:", e)
        time.sleep(30)


# ---------------------------------------------------------------- jutikliai HA (ir laikrodžiui)

SENSOR_NOW = threading.Event()
SLUG = ""


def sensor_id(pid):
    return f"sensor.sveikata_vanduo_{pid}"


def addon_slug():
    """Šio priedo pavadinimas Supervisor'iuje (pvz. 44e59b9c_sveikata) – jo reikia hassio.addon_stdin."""
    global SLUG
    if SLUG:
        return SLUG
    try:
        req = urllib.request.Request("http://supervisor/addons/self/info",
                                     headers={"Authorization": "Bearer " + SUP_TOKEN})
        with urllib.request.urlopen(req, timeout=10) as r:
            SLUG = json.loads(r.read())["data"]["slug"]
    except Exception:  # noqa
        SLUG = os.environ.get("HOSTNAME", "").replace("-", "_")
    return SLUG


def sensor_payload(p):
    pid = p["id"]
    goal, total = p["goal_ml"] or 2000, today_total(pid)
    t0 = today()
    types = rows("SELECT * FROM drink_types WHERE profile_id=? AND archived=0 ORDER BY pos, id", (pid,))
    per = {r["type_id"]: r["s"] for r in rows("SELECT type_id, SUM(ml) AS s FROM drinks WHERE profile_id=? AND day=? GROUP BY type_id", (pid, t0))}
    uids = [r["uid"] for r in rows("SELECT uid FROM drinks WHERE profile_id=? AND day=? AND src='laikrodis' ORDER BY id DESC LIMIT 60", (pid, t0))]
    a = active_episode(pid)
    meds = rows("SELECT id, name FROM meds WHERE profile_id=? AND archived=0 ORDER BY pos, id LIMIT 12", (pid,))
    caf = sum((t["caffeine"] or 0) * (per.get(t["id"]) or 0) / (t["ml"] or 250) for t in types)
    return {"state": total, "attributes": {
        "friendly_name": f"Vanduo – {p['name']}", "icon": "mdi:cup-water", "unit_of_measurement": "ml",
        "tikslas": goal, "procentai": int(round(100 * total / goal)) if goal else 0, "diena": t0,
        "kofeinas_mg": int(round(caf)), "skauda_galva": bool(a), "profilis": p["name"],
        "laikrodis": {
            "g": [{"i": t["id"], "n": t["name"], "e": t["emoji"], "ml": t["ml"], "g": t["in_goal"], "s": per.get(t["id"]) or 0, "k": t["parent"] or 0} for t in types],
            "u": uids,
            "s": {"i": a["id"], "nuo": a["start"][11:16], "d": a["start"][:10], "st": a["intensity"]} if a else None,
            "v": [{"i": m["id"], "n": m["name"]} for m in meds],
            "p": pid, "vardas": p["name"],
        },
        "priedas": addon_slug(),
    }}


def sensor_loop():
    last, sent = {}, {}
    while True:
        try:
            with LOCK:
                payloads = {p["id"]: sensor_payload(p) for p in rows("SELECT * FROM profiles WHERE archived=0")}
            for pid, pl in payloads.items():
                key = json.dumps(pl, sort_keys=True)
                # HA perkrovus būsena dingsta, todėl kas 10 min. siunčiama iš naujo
                if key != last.get(pid) or time.time() - sent.get(pid, 0) > 600:
                    ha("POST", "states/" + sensor_id(pid), pl)
                    last[pid], sent[pid] = key, time.time()
        except Exception as e:  # noqa
            log("HA jutiklio klaida:", e)
        SENSOR_NOW.wait(20)
        SENSOR_NOW.clear()


# ---------------------------------------------------------------- laikrodis (Wear OS programėlė „Sveikata“)
# Laikrodis skaito jutiklio sensor.sveikata_vanduo_<profilis> atributą „laikrodis“ per HA API,
# o gėrimą / skausmą / vaistą pažymi per HA paslaugą hassio.addon_stdin – komanda ateina į šio priedo stdin.

PINGS = {}
PAIR = {"code": "", "until": 0.0, "fails": 0, "pid": None}


def handle_stdin(obj):
    if isinstance(obj, str):
        try:
            obj = json.loads(obj)
        except ValueError:
            return
    if not isinstance(obj, dict):
        return
    v = obj.get("veiksmas")
    if v == "ping":
        PINGS[str(obj.get("n"))] = time.time()
        return
    pid = num(obj.get("p"))
    uid = str(obj.get("u") or "")[:40]
    ts = epoch_ts(obj["ts"]) if obj.get("ts") else now()
    with LOCK:
        if not pid or not get_profile(pid):
            return
        try:
            if v == "gerti":
                t = num(obj.get("t"))
                if not t or t < 0:  # laikrodis dar nežino gėrimų – pirmasis sąraše (vanduo)
                    r = DB.execute("SELECT id FROM drink_types WHERE profile_id=? AND archived=0 AND COALESCE(parent,0)=0 ORDER BY pos, id LIMIT 1", (pid,)).fetchone()
                    t = r["id"] if r else None
                add_drink(pid, t, obj.get("ml"), ts, uid, src="laikrodis")
            elif v == "atsaukti":
                DB.execute("DELETE FROM drinks WHERE uid=? AND profile_id=?", (uid, pid))
            elif v == "skausmas":
                start_episode(pid, num(obj.get("st")), ts, uid)
            elif v == "praejo":
                a = active_episode(pid)
                if a:
                    DB.execute("UPDATE episodes SET ended=?, updated=? WHERE id=?", (max(ts, a["start"]), now(), a["id"]))
            elif v == "vaistas":
                add_dose(pid, num(obj.get("m")), ts, uid)
            else:
                return
            bump()
            DB.commit()
        except Exception:
            DB.rollback()
            raise


def stdin_loop():
    """HA paslauga hassio.addon_stdin rašo JSON į priedo stdin (be naujos eilutės gale)."""
    dec, buf = json.JSONDecoder(), ""
    while True:
        try:
            chunk = os.read(0, 65536)
        except OSError:
            return
        if not chunk:
            return
        buf += chunk.decode("utf-8", "replace")
        while True:
            buf = buf.lstrip()
            if not buf:
                break
            try:
                obj, end = dec.raw_decode(buf)
            except ValueError:
                if buf.rstrip().endswith(("}", '"', "\n")) or len(buf) > 100000:
                    buf = ""  # sugadinta komanda – išmetam
                break
            buf = buf[end:]
            try:
                handle_stdin(obj)
            except Exception as e:  # noqa
                log("Laikrodžio komandos klaida:", e)


def lan_ip():
    try:
        req = urllib.request.Request("http://supervisor/network/info",
                                     headers={"Authorization": "Bearer " + SUP_TOKEN})
        with urllib.request.urlopen(req, timeout=10) as r:
            for i in json.loads(r.read())["data"]["interfaces"]:
                for a in (i.get("ipv4") or {}).get("address") or []:
                    if i.get("connected", True) and a:
                        return a.split("/")[0]
    except Exception:  # noqa
        pass
    return ""


def watch_cfg():
    with LOCK:
        return meta_get("w_url") or "", meta_get("w_token") or ""


def watch_info(via_ha, pid):
    url, tok = watch_cfg()
    auto = ""
    if not url and SUP_TOKEN:
        try:
            c = ha("GET", "config") or {}
            auto = c.get("external_url") or c.get("internal_url") or ""
        except Exception:  # noqa
            pass
    left = int(PAIR["until"] - time.time()) if PAIR["code"] and PAIR["pid"] == pid else 0
    return {"via_ha": via_ha, "url": url, "auto_url": auto, "has_token": bool(tok), "slug": addon_slug() if SUP_TOKEN else "",
            "ip": lan_ip() if via_ha and SUP_TOKEN else "", "sensor": sensor_id(pid),
            "code": PAIR["code"] if via_ha and left > 0 else "", "left": max(left, 0)}


def clean_url(u):
    u = (u or "").strip().rstrip("/")
    if u and not re.match(r"^https?://", u):
        u = "https://" + u
    return u


def http_status(method, url, tok, body=None, timeout=10):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status


def watch_save(d, pid):
    url = clean_url(d.get("url"))
    tok = (d.get("token") or "").strip()
    with LOCK:
        meta_set("w_url", url)
        if tok:
            meta_set("w_token", tok)
        DB.commit()
    return watch_test(pid)


def watch_test(pid):
    url, tok = watch_cfg()
    if not url or not tok:
        return {"ok": False, "error": "Įrašykite HA adresą ir raktą."}
    try:
        http_status("GET", url + "/api/states/" + sensor_id(pid), tok)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return {"ok": False, "error": "Raktas netinka (HA atsakė 401). Sukurkite naują ir įklijuokite iš naujo."}
        if e.code == 404:
            return {"ok": False, "error": "Prisijungta, bet HA dar nemato jutiklio „%s“. Palaukite minutę ir bandykite dar kartą." % sensor_id(pid)}
        return {"ok": False, "error": "HA atsakė klaida %s." % e.code}
    except Exception as e:  # noqa
        return {"ok": False, "error": "Nepavyko prisijungti prie %s (%s). Patikrinkite adresą." % (url, e)}
    n = secrets.token_hex(4)
    try:
        http_status("POST", url + "/api/services/hassio/addon_stdin", tok,
                    {"addon": addon_slug(), "input": {"veiksmas": "ping", "n": n}})
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return {"ok": False, "error": "Raktas turi būti sukurtas administratoriaus paskyroje (HA atsakė %s)." % e.code}
        return {"ok": False, "error": "Nepavyko perduoti komandos priedui (HA klaida %s)." % e.code}
    except Exception as e:  # noqa
        return {"ok": False, "error": "Nepavyko perduoti komandos priedui (%s)." % e}
    for _ in range(30):
        if n in PINGS:
            PINGS.pop(n, None)
            return {"ok": True}
        time.sleep(0.2)
    return {"ok": False, "error": "Priedas komandos negavo. Paleiskite Sveikatą iš naujo (Nustatymai → Priedai → Sveikata → Paleisti iš naujo) ir bandykite dar kartą."}


def watch_new_code(pid):
    url, tok = watch_cfg()
    if not url or not tok:
        return {"error": "Pirmiausia įrašykite HA adresą ir raktą."}
    PAIR.update(code="%06d" % secrets.randbelow(10 ** 6), until=time.time() + 600, fails=0, pid=pid)
    return {"code": PAIR["code"], "left": 600}


def watch_pair(code):
    """Laikrodis namų tinkle atsiunčia kodą ir gauna HA adresą, raktą ir profilį."""
    if not PAIR["code"] or time.time() > PAIR["until"]:
        return 403, {"error": "Kodas nebegalioja. Sveikatoje sukurkite naują."}
    if not secrets.compare_digest(code.strip(), PAIR["code"]):
        PAIR["fails"] += 1
        if PAIR["fails"] >= 5:
            PAIR["code"] = ""
        return 403, {"error": "Neteisingas kodas."}
    PAIR["code"] = ""
    url, tok = watch_cfg()
    pid = PAIR["pid"]
    with LOCK:
        p = get_profile(pid) or {"name": ""}
    return 200, {"url": url, "token": tok, "priedas": addon_slug(), "jutiklis": sensor_id(pid),
                 "profilis": pid, "vardas": p["name"]}


# ---------------------------------------------------------------- eksportas

def export_csv(pid, nuo="", iki=""):
    meds = {m["id"]: m for m in rows("SELECT * FROM meds WHERE profile_id=?", (pid,))}
    doses = rows("SELECT * FROM doses WHERE profile_id=? ORDER BY ts", (pid,))
    out = io.StringIO()
    w = csv.writer(out, delimiter=";")
    w.writerow(["Pradžia", "Pabaiga", "Trukmė (val.)", "Stiprumas (0–10)", "Tipas", "Vieta", "Pobūdis", "Simptomai",
                "Galimi provokatoriai", "Vaistai", "Kas dar padėjo", "Poveikis veiklai", "Pastabos"])
    for e in rows("SELECT * FROM episodes WHERE profile_id=? ORDER BY start", (pid,)):
        if nuo and e["start"][:10] < nuo or iki and e["start"][:10] > iki:
            continue
        hrs = ""
        if e["ended"]:
            hrs = ("%.1f" % ((dt.datetime.fromisoformat(e["ended"]) - dt.datetime.fromisoformat(e["start"])).total_seconds() / 3600)).replace(".", ",")
        md = [f"{meds.get(x['med_id'], {}).get('name', '?')} {x['amount']} {x['ts'][11:16]}"
              f"{' (' + {'padejo': 'padėjo', 'is_dalies': 'iš dalies', 'nepadejo': 'nepadėjo'}[x['effect']] + ')' if x['effect'] else ''}".replace("  ", " ")
              for x in doses if x["episode_id"] == e["id"]]
        w.writerow([e["start"].replace("T", " "), e["ended"].replace("T", " "), hrs, e["intensity"] if e["intensity"] is not None else "",
                    e["kind"], ", ".join(loads_list(e["locs"])), ", ".join(loads_list(e["chars"])),
                    ", ".join(loads_list(e["symptoms"])), ", ".join(loads_list(e["triggers"])), "; ".join(md),
                    ", ".join(loads_list(e["relief"])), e["impact"], e["notes"]])
    return ("﻿" + out.getvalue()).encode("utf-8")


# ---------------------------------------------------------------- HTTP

MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png",
        ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json"}


class Handler(BaseHTTPRequestHandler):
    server_version = "Sveikata/1.0"

    def log_message(self, fmt, *args):
        if os.environ.get("DEBUG"):
            super().log_message(fmt, *args)

    def authed(self):
        if not PIN or self.client_address[0] == INGRESS_IP:
            return True
        c = SimpleCookie(self.headers.get("Cookie", ""))
        return "sveikata_auth" in c and secrets.compare_digest(c["sveikata_auth"].value, AUTH_TOKEN)

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

    def read_json(self, limit=2 * 1024 * 1024):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise ValueError("Per didelė užklausa")
        raw = self.rfile.read(n) if n else b""
        return json.loads(raw.decode("utf-8") or "{}")

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
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if path in ("login", "login.html"):
            return self.static("login.html")
        if path == "api/laikrodis/susieti":
            code, res = watch_pair(q.get("kodas", ""))
            return self.send(code, res)
        if not self.authed():
            if path.startswith("api/"):
                return self.send(401, {"error": "Reikia PIN"})
            if path.endswith((".js", ".css", ".png", ".webmanifest", ".svg")):
                return self.static(path)
            return self.static("login.html")
        try:
            if path.startswith("api/"):
                pid, info = who(self)
                if path == "api/me":
                    with LOCK:
                        return self.send(200, {"profile": pid, **info, "candidates": [] if pid else candidates(info)})
                if path == "api/version":
                    with LOCK:
                        return self.send(200, {"version": version(), "profile": pid})
                if not pid:
                    return self.send(409, {"error": "Pasirinkite profilį", "need_profile": True})
                if path == "api/state":
                    with LOCK:
                        return self.send(200, full_state(pid, info))
                if path == "api/notify_status":
                    res = {"ha": bool(SUP_TOKEN), "auto": [], "all": [], "error": ""}
                    try:
                        res["all"] = notify_all()
                        res["auto"] = phones_for_profile(pid, refresh=True)
                    except Exception as e:  # noqa
                        res["error"] = str(e)
                    st = NOTIFY_STATE.get(pid) or {}
                    res["error"] = res["error"] or st.get("error", "")
                    res["last"] = st.get("last", "")
                    return self.send(200, res)
                if path == "api/laikrodis":
                    return self.send(200, watch_info(self.client_address[0] == INGRESS_IP, pid))
                if path == "api/export":
                    with LOCK:
                        data = full_state(pid)
                    data["app"] = "sveikata"
                    data.pop("me", None)
                    name = "sveikata-" + today() + ".json"
                    return self.send(200, data, extra={"Content-Disposition": f'attachment; filename="{name}"'})
                if path == "api/export.csv":
                    with LOCK:
                        body = export_csv(pid, q.get("nuo", ""), q.get("iki", ""))
                    name = "galvos-skausmai-" + today() + ".csv"
                    return self.send(200, body, "text/csv; charset=utf-8",
                                     extra={"Content-Disposition": f'attachment; filename="{name}"'})
                return self.send(404, {"error": "Nerasta"})
            return self.static(path)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as e:  # noqa
            return self.send(500, {"error": str(e)})

    def do_POST(self):
        path = unquote(urlparse(self.path).path).lstrip("/")
        try:
            if path == "api/login":
                d = self.read_json(10000)
                if PIN and secrets.compare_digest(str(d.get("pin", "")), PIN):
                    return self.send(200, {"ok": True}, extra={
                        "Set-Cookie": f"sveikata_auth={AUTH_TOKEN}; Path=/; Max-Age=31536000; SameSite=Lax"})
                return self.send(403, {"error": "Neteisingas PIN"})
            if not self.authed():
                return self.send(401, {"error": "Reikia PIN"})
            pid, info = who(self)
            uid = (self.headers.get("X-Remote-User-Id") or "") if info["via_ha"] else ""
            if path in ("api/profile/create", "api/profile/claim"):
                d = self.read_json()
                with LOCK:
                    try:
                        if path == "api/profile/create":
                            new = create_profile(d.get("name"), d.get("emoji"), d.get("color"))
                        else:
                            new = num(d.get("id"))
                            p = get_profile(new)
                            if not p or new not in [c["id"] for c in candidates(info)]:
                                raise ValueError("Šio profilio pasirinkti negalima")
                            if p["pin"] and not secrets.compare_digest(str(d.get("pin") or ""), p["pin"]):
                                raise ValueError("Neteisingas profilio PIN")
                        if uid:
                            DB.execute("INSERT OR REPLACE INTO links(ha_user, profile_id, ha_name, created) VALUES(?,?,?,?)",
                                       (uid, new, info.get("ha_name") or "", now()))
                        bump()
                        DB.commit()
                    except Exception:
                        DB.rollback()
                        raise
                PHONES.pop(new, None)
                extra = {} if uid else {"Set-Cookie": f"sveikata_prof={sign(new)}; Path=/; Max-Age=31536000; SameSite=Lax"}
                return self.send(200, {"ok": True, "profile": new}, extra=extra)
            if path == "api/profile/leave":
                with LOCK:
                    if uid:
                        DB.execute("DELETE FROM links WHERE ha_user=?", (uid,))
                        DB.commit()
                    PHONES.pop(pid, None)
                return self.send(200, {"ok": True}, extra={"Set-Cookie": "sveikata_prof=; Path=/; Max-Age=0; SameSite=Lax"})
            if not pid:
                return self.send(409, {"error": "Pasirinkite profilį", "need_profile": True})
            if path.startswith("api/laikrodis/"):
                if self.client_address[0] != INGRESS_IP:
                    return self.send(403, {"error": "Atidarykite Sveikatą per Home Assistant"})
                d = self.read_json()
                if path == "api/laikrodis/nustatymai":
                    return self.send(200, watch_save(d, pid))
                if path == "api/laikrodis/patikrinti":
                    return self.send(200, watch_test(pid))
                if path == "api/laikrodis/kodas":
                    return self.send(200, watch_new_code(pid))
                return self.send(404, {"error": "Nerasta"})
            if path.startswith("api/do/"):
                name = path[len("api/do/"):]
                fn = ACTIONS.get(name)
                if not fn:
                    return self.send(404, {"error": "Nežinomas veiksmas"})
                d = self.read_json()
                if name in NO_LOCK:
                    return self.send(200, fn(d, pid) or {})
                with LOCK:
                    try:
                        res = fn(d, pid) or {}
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
    if SUP_TOKEN:
        threading.Thread(target=sensor_loop, daemon=True).start()
        threading.Thread(target=reminder_loop, daemon=True).start()
        threading.Thread(target=event_loop, daemon=True).start()
    threading.Thread(target=stdin_loop, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log(f"Sveikata veikia per prievadą {PORT}. Duomenys: {DATA_DIR}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
