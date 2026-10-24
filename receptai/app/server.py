#!/usr/bin/env python3
"""Receptai ir pirkiniai - Home Assistant priedo serveris.

Naudoja tik standartinę Python biblioteką (be papildomų paketų).
Duomenys saugomi /data aplanke (patenka į HA atsargines kopijas).
"""
import base64
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
import unicodedata
import uuid
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote
import time
import urllib.request
import html as htmlmod

DATA_DIR = os.environ.get("DATA_DIR", "/data")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
PHOTO_DIR = os.path.join(DATA_DIR, "photos")
DB_PATH = os.path.join(DATA_DIR, "receptai.db")
PORT = int(os.environ.get("PORT", "8099"))
INGRESS_IP = "172.30.32.2"  # HA ingress proxy adresas

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
AUTH_TOKEN = hashlib.sha256(("receptai:" + PIN).encode()).hexdigest() if PIN else ""

# ---------------------------------------------------------------- DB

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, emoji TEXT DEFAULT '', pos INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, norm TEXT NOT NULL,
  section_id INTEGER, always_have INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, servings REAL DEFAULT 4,
  tags TEXT DEFAULT '[]', notes TEXT DEFAULT '', rating INTEGER DEFAULT 0,
  favorite INTEGER DEFAULT 0, steps TEXT DEFAULT '[]', source TEXT DEFAULT '',
  original_text TEXT DEFAULT '', original_json TEXT DEFAULT '',
  created TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY, recipe_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
  qty REAL, unit TEXT DEFAULT '', note TEXT DEFAULT '', pos INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY, recipe_id INTEGER NOT NULL, kind TEXT NOT NULL,
  filename TEXT NOT NULL, created TEXT);
CREATE TABLE IF NOT EXISTS menu (
  id INTEGER PRIMARY KEY, day TEXT NOT NULL, recipe_id INTEGER NOT NULL,
  servings REAL, in_list INTEGER DEFAULT 1, cooked INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY, recipe_id INTEGER NOT NULL, day TEXT NOT NULL, menu_id INTEGER);
CREATE TABLE IF NOT EXISTS extras (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, qty REAL, unit TEXT DEFAULT '',
  note TEXT DEFAULT '', created TEXT, recipe TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS pstate (
  product_id INTEGER PRIMARY KEY, state TEXT, checked INTEGER DEFAULT 0, updated TEXT, pos REAL);
CREATE TABLE IF NOT EXISTS note_rules (
  id INTEGER PRIMARY KEY, word TEXT NOT NULL, color TEXT DEFAULT '', bold INTEGER DEFAULT 1);
"""

DEFAULT_SECTIONS = [
    ("Daržovės", "🥦"), ("Vaisiai ir uogos", "🍎"), ("Žalumynai", "🌿"), ("Duona ir kepiniai", "🍞"),
    ("Pieno produktai", "🥛"), ("Sūriai", "🧀"), ("Kiaušiniai", "🥚"), ("Mėsa", "🥩"), ("Paukštiena", "🍗"),
    ("Mėsos gaminiai", "🌭"), ("Žuvis ir jūros gėrybės", "🐟"), ("Kruopos ir makaronai", "🍝"),
    ("Miltai ir kepimas", "🧁"), ("Aliejai ir padažai", "🫙"), ("Prieskoniai", "🧂"), ("Konservai", "🥫"),
    ("Šaldyti", "🧊"), ("Saldumynai ir užkandžiai", "🍫"), ("Riešutai ir džiovinti", "🥜"),
    ("Kava ir arbata", "☕"), ("Gėrimai", "🥤"), ("Alkoholis", "🍷"), ("Higiena", "🧴"),
    ("Buitinė chemija", "🧽"), ("Gyvūnams", "🐾"), ("Kita", "📦"),
]

# raktažodis (normalizuotas kamienas) -> kategorija
KEYWORDS = {
    "Daržovės": "svogun cesnak mork bulv pomidor agurk paprik kopust salot cukini baklazan burok porai poras "
        "saliera ridik moliug kalafior brokol grybai pievagryb kukuruzu_burbuol avokad imbier ropes",
    "Vaisiai ir uogos": "citrin obuol banan apelsin mandarin kriaus vynuog uog brask melyn aviet vysni slyv "
        "kivi kiwi ananas mango persik abrikos arbuz melion granat laim",
    "Žalumynai": "krap petrazel kalendr bazilik spinat laiskin rukol salotu_lap mėt met",
    "Duona ir kepiniai": "duon batonas baton tortilj lavas pita bandel sausuci",
    "Pieno produktai": "pien grietin sviest varsk jogurt kefyr grietinel maskarpon pasuk",
    "Sūriai": "sur mocarel parmezan feta cedar gauda brie",
    "Kiaušiniai": "kiausin",
    "Mėsa": "kiaulien jautien malt mes sonkaul ėrien erien veršien versien kepen",
    "Paukštiena": "vistien kalakut antien sparneli blauzdel",
    "Mėsos gaminiai": "kumpi desr desrel sonin rukyt salam",
    "Žuvis ir jūros gėrybės": "lasis lasis lasis zuv krevet tun silke menk upetak kalmar midij",
    "Kruopos ir makaronai": "ryz makaron spaget spagec lakstin grik avizin aviz kruop lesi pupel zirni dribsn kuskus bulgur",
    "Miltai ir kepimas": "milt cukr miel krakmol kepimo sod vanil kakav",
    "Aliejai ir padažai": "aliej acto actas kecup majonez garstyc padaz sojos",
    "Prieskoniai": "drusk pipir prieskon cinamon lauro kmyn ciobrel raudonel kario ciberzol muskat gvazdik",
    "Konservai": "konserv pomidoru_past trinti_pomidor smulkinti_pomidor alyvuog pupeli_konserv",
    "Šaldyti": "saldyt ledai",
    "Saldumynai ir užkandžiai": "sokolad sausain saldain traskuc spurg tort pyrag",
    "Riešutai ir džiovinti": "riesut migdol razin dziovint kokos seklos",
    "Kava ir arbata": "kava kav arbat",
    "Gėrimai": "vanduo vand sult limonad gaivus",
    "Alkoholis": "alus vyn degtin",
    "Higiena": "sampun muil dantu kremas dezodorant vatos higien tualetin",
    "Buitinė chemija": "ploviklis plovikl popier servetel maisel indaplov skalbim",
    "Gyvūnams": "sun kat edal kraik",
}

ENDINGS = sorted(["iai", "ių", "ius", "ys", "ės", "ėms", "ams", "ais", "ai", "ui", "ų", "as",
                  "is", "us", "os", "ės", "ė", "a", "o", "e", "ą", "ę", "į", "ų", "i", "s"],
                 key=len, reverse=True)


def strip_acc(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def norm_name(name):
    """Produkto pavadinimo kamienas palyginimui (svogūnas = svogūnai = svogūnų)."""
    words = re.findall(r"\w+", (name or "").lower())
    out = []
    for w in words:
        for e in ENDINGS:
            if len(w) > len(e) + 2 and w.endswith(e):
                w = w[: -len(e)]
                break
        out.append(strip_acc(w))
    return " ".join(out)


def now():
    return dt.datetime.now().isoformat(timespec="seconds")


def get_db():
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=OFF")
    return con


DB = get_db()


def init_db():
    with LOCK:
        DB.executescript(SCHEMA)
        if DB.execute("SELECT COUNT(*) FROM sections").fetchone()[0] == 0:
            for i, (n, e) in enumerate(DEFAULT_SECTIONS):
                DB.execute("INSERT INTO sections(name, emoji, pos) VALUES(?,?,?)", (n, e, i))
            for n in ("Druska", "Juodieji pipirai", "Aliejus", "Cukrus"):
                sec = guess_section(n)
                DB.execute("INSERT INTO products(name, norm, section_id, always_have) VALUES(?,?,?,1)",
                           (n, norm_name(n), sec))
        DB.execute("INSERT OR IGNORE INTO meta(key, value) VALUES('version', '1')")
        cols = [r[1] for r in DB.execute("PRAGMA table_info(pstate)").fetchall()]
        if "pos" not in cols:
            DB.execute("ALTER TABLE pstate ADD COLUMN pos REAL")
        if "recipe" not in [r[1] for r in DB.execute("PRAGMA table_info(extras)").fetchall()]:
            DB.execute("ALTER TABLE extras ADD COLUMN recipe TEXT DEFAULT ''")
        backfill_pos()
        dedupe_extras()
        if not DB.execute("SELECT 1 FROM meta WHERE key='sections_v2'").fetchone():
            migrate_sections_v2()
            DB.execute("INSERT INTO meta(key, value) VALUES('sections_v2', '1')")
        DB.commit()


def migrate_sections_v2():
    """Smulkesnės kategorijos: esamos išskaidomos, produktai perskirstomi."""
    have = {r["name"]: r["id"] for r in DB.execute("SELECT id, name FROM sections")}
    renames = {"Daržovės ir vaisiai": "Daržovės", "Mėsa ir žuvis": "Mėsa", "Bakalėja": "Kruopos ir makaronai",
               "Prieskoniai ir padažai": "Prieskoniai", "Saldumynai": "Saldumynai ir užkandžiai"}
    for old, new in renames.items():
        if old in have and new not in have:
            DB.execute("UPDATE sections SET name=? WHERE id=?", (new, have[old]))
    have = {r["name"]: r["id"] for r in DB.execute("SELECT id, name FROM sections")}
    for i, (n, e) in enumerate(DEFAULT_SECTIONS):
        if n in have:
            DB.execute("UPDATE sections SET emoji=?, pos=? WHERE id=?", (e, i, have[n]))
        else:
            DB.execute("INSERT INTO sections(name, emoji, pos) VALUES(?,?,?)", (n, e, i))
    # perskirstom produktus, kuriuos atpažįstam (ranka priskirti nežinomi lieka kur buvo)
    for p in DB.execute("SELECT id, name, section_id FROM products").fetchall():
        sec = guess_section(p["name"])
        if sec:
            DB.execute("UPDATE products SET section_id=? WHERE id=?", (sec, p["id"]))


def bump():
    DB.execute("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key='version'")


def version():
    return int(DB.execute("SELECT value FROM meta WHERE key='version'").fetchone()[0])


def guess_section(name):
    n = strip_acc((name or "").lower())
    best, best_len = None, 0
    for sec_name, words in KEYWORDS.items():
        for kw in words.split():
            k = strip_acc(kw).replace("_", " ")
            if k and k in n and len(k) > best_len:
                best, best_len = sec_name, len(k)
    if not best:
        return None
    row = DB.execute("SELECT id FROM sections WHERE name=?", (best,)).fetchone()
    return row["id"] if row else None


def find_or_create_product(name, section_name=None):
    name = (name or "").strip()
    if not name:
        return None
    n = norm_name(name)
    row = DB.execute("SELECT id FROM products WHERE norm=?", (n,)).fetchone()
    if row:
        return row["id"]
    sec = None
    if section_name:
        r = DB.execute("SELECT id FROM sections WHERE lower(name)=lower(?)", (section_name.strip(),)).fetchone()
        sec = r["id"] if r else None
    if sec is None:
        sec = guess_section(name)
    cur = DB.execute("INSERT INTO products(name, norm, section_id) VALUES(?,?,?)",
                     (name[:1].upper() + name[1:], n, sec))
    return cur.lastrowid


def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", ".")
    m = re.match(r"^(\d+)\s*/\s*(\d+)$", s)
    if m:
        return float(m.group(1)) / float(m.group(2))
    m = re.match(r"^(\d+)\s+(\d+)\s*/\s*(\d+)$", s)
    if m:
        return float(m.group(1)) + float(m.group(2)) / float(m.group(3))
    s = s.replace("½", ".5").replace("¼", ".25").replace("¾", ".75")
    try:
        return float(s)
    except ValueError:
        return None


# ---------------------------------------------------------------- state

def rows(sql, args=()):
    return [dict(r) for r in DB.execute(sql, args).fetchall()]


def full_state():
    today = dt.date.today()
    since = (today - dt.timedelta(days=14)).isoformat()
    recipes = rows("SELECT * FROM recipes ORDER BY title COLLATE NOCASE")
    ings = rows("SELECT * FROM ingredients ORDER BY recipe_id, pos, id")
    photos = rows("SELECT * FROM photos ORDER BY id")
    hist = rows("SELECT recipe_id, COUNT(*) AS cnt, MAX(day) AS last FROM history GROUP BY recipe_id")
    hmap = {h["recipe_id"]: h for h in hist}
    by_r = {}
    for i in ings:
        by_r.setdefault(i["recipe_id"], []).append(i)
    ph_r = {}
    for p in photos:
        ph_r.setdefault(p["recipe_id"], []).append(p)
    for r in recipes:
        r["tags"] = json.loads(r["tags"] or "[]")
        r["steps"] = json.loads(r["steps"] or "[]")
        r["ingredients"] = by_r.get(r["id"], [])
        r["photos"] = ph_r.get(r["id"], [])
        h = hmap.get(r["id"])
        r["cooked_count"] = h["cnt"] if h else 0
        r["last_cooked"] = h["last"] if h else None
        r["has_original"] = bool(r["original_json"] or r["original_text"])
        del r["original_json"]
    return {
        "version": version(),
        "today": today.isoformat(),
        "sections": rows("SELECT * FROM sections ORDER BY pos, id"),
        "products": rows("SELECT * FROM products ORDER BY name COLLATE NOCASE"),
        "recipes": recipes,
        "menu": rows("SELECT * FROM menu WHERE day >= ? OR in_list = 1 ORDER BY day, id", (since,)),
        "extras": rows("SELECT * FROM extras ORDER BY id"),
        "pstate": rows("SELECT * FROM pstate"),
        "history": rows("SELECT * FROM history ORDER BY day DESC, id DESC LIMIT 300"),
        "rules": rows("SELECT * FROM note_rules ORDER BY id"),
    }


# ---------------------------------------------------------------- actions

def save_photo(recipe_id, kind, data_url):
    m = re.match(r"^data:image/(\w+);base64,(.*)$", data_url or "", re.S)
    if not m:
        raise ValueError("Netinkama nuotrauka")
    ext = "jpg" if m.group(1) in ("jpeg", "jpg") else m.group(1)
    raw = base64.b64decode(m.group(2))
    if len(raw) > 12 * 1024 * 1024:
        raise ValueError("Nuotrauka per didelė")
    fn = f"{recipe_id}_{kind}_{uuid.uuid4().hex[:10]}.{ext}"
    with open(os.path.join(PHOTO_DIR, fn), "wb") as f:
        f.write(raw)
    if kind == "dish":  # tik viena patiekalo nuotrauka
        for old in rows("SELECT * FROM photos WHERE recipe_id=? AND kind='dish'", (recipe_id,)):
            remove_photo(old)
    DB.execute("INSERT INTO photos(recipe_id, kind, filename, created) VALUES(?,?,?,?)",
               (recipe_id, kind, fn, now()))


def remove_photo(p):
    try:
        os.remove(os.path.join(PHOTO_DIR, p["filename"]))
    except OSError:
        pass
    DB.execute("DELETE FROM photos WHERE id=?", (p["id"],))


def write_ingredients(recipe_id, ingredients):
    DB.execute("DELETE FROM ingredients WHERE recipe_id=?", (recipe_id,))
    for pos, ing in enumerate(ingredients or []):
        pid = ing.get("product_id")
        if pid:
            if not DB.execute("SELECT 1 FROM products WHERE id=?", (pid,)).fetchone():
                pid = None
        if not pid:
            pid = find_or_create_product(ing.get("product_name") or ing.get("name") or "",
                                         ing.get("section"))
        if not pid:
            continue
        DB.execute("INSERT INTO ingredients(recipe_id, product_id, qty, unit, note, pos) VALUES(?,?,?,?,?,?)",
                   (recipe_id, pid, num(ing.get("qty")), (ing.get("unit") or "").strip(),
                    (ing.get("note") or "").strip(), pos))


def recipe_snapshot(recipe_id):
    r = dict(DB.execute("SELECT * FROM recipes WHERE id=?", (recipe_id,)).fetchone())
    ings = DB.execute("""SELECT p.name, i.qty, i.unit, i.note FROM ingredients i
                         JOIN products p ON p.id=i.product_id WHERE recipe_id=? ORDER BY pos""",
                      (recipe_id,)).fetchall()
    return {"title": r["title"], "servings": r["servings"], "steps": json.loads(r["steps"] or "[]"),
            "notes": r["notes"], "ingredients": [dict(x) for x in ings], "saved": now()}


def act_recipe_save(d):
    rid = d.get("id")
    fields = (
        (d.get("title") or "Be pavadinimo").strip(),
        num(d.get("servings")) or 4,
        json.dumps([t.strip() for t in d.get("tags", []) if t and t.strip()], ensure_ascii=False),
        d.get("notes") or "",
        int(d.get("rating") or 0),
        1 if d.get("favorite") else 0,
        json.dumps([s.strip() for s in d.get("steps", []) if s and s.strip()], ensure_ascii=False),
        d.get("source") or "",
    )
    if rid:
        DB.execute("""UPDATE recipes SET title=?, servings=?, tags=?, notes=?, rating=?, favorite=?,
                      steps=?, source=?, updated=? WHERE id=?""", fields + (now(), rid))
    else:
        cur = DB.execute("""INSERT INTO recipes(title, servings, tags, notes, rating, favorite, steps, source,
                            original_text, created, updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                         fields + (d.get("original_text") or "", now(), now()))
        rid = cur.lastrowid
    write_ingredients(rid, d.get("ingredients"))
    # Originalas išsaugomas tik pirmą kartą ir niekada neperrašomas
    r = DB.execute("SELECT original_json FROM recipes WHERE id=?", (rid,)).fetchone()
    if not r["original_json"]:
        DB.execute("UPDATE recipes SET original_json=? WHERE id=?",
                   (json.dumps(recipe_snapshot(rid), ensure_ascii=False), rid))
    for ph in d.get("new_photos", []) or []:
        save_photo(rid, ph.get("kind", "original"), ph.get("data"))
    return {"id": rid}


def act_recipe_delete(d):
    rid = d["id"]
    for p in rows("SELECT * FROM photos WHERE recipe_id=?", (rid,)):
        remove_photo(p)
    DB.execute("DELETE FROM ingredients WHERE recipe_id=?", (rid,))
    DB.execute("DELETE FROM menu WHERE recipe_id=?", (rid,))
    DB.execute("DELETE FROM recipes WHERE id=?", (rid,))
    # istorija paliekama statistikai? ištrinam, nes receptas dingo
    DB.execute("DELETE FROM history WHERE recipe_id=?", (rid,))


def act_recipe_photo(d):
    save_photo(d["recipe_id"], d.get("kind", "dish"), d["data"])


def act_photo_delete(d):
    p = DB.execute("SELECT * FROM photos WHERE id=?", (d["id"],)).fetchone()
    if p:
        remove_photo(dict(p))


def act_section_save(d):
    if d.get("id"):
        DB.execute("UPDATE sections SET name=?, emoji=? WHERE id=?",
                   (d["name"].strip(), d.get("emoji", ""), d["id"]))
    else:
        mx = DB.execute("SELECT COALESCE(MAX(pos), 0) FROM sections").fetchone()[0]
        DB.execute("INSERT INTO sections(name, emoji, pos) VALUES(?,?,?)",
                   (d["name"].strip(), d.get("emoji", ""), mx + 1))


def act_section_delete(d):
    DB.execute("UPDATE products SET section_id=NULL WHERE section_id=?", (d["id"],))
    DB.execute("DELETE FROM sections WHERE id=?", (d["id"],))


def act_section_order(d):
    for i, sid in enumerate(d["ids"]):
        DB.execute("UPDATE sections SET pos=? WHERE id=?", (i, sid))


def act_product_save(d):
    if d.get("id"):
        sets, args = [], []
        if "name" in d and d["name"].strip():
            other = DB.execute("SELECT id FROM products WHERE norm=? AND id<>?",
                               (norm_name(d["name"]), d["id"])).fetchone()
            if other:  # toks produktas jau yra - sujungiam
                act_product_merge({"from": d["id"], "into": other["id"]})
                DB.execute("UPDATE products SET name=? WHERE id=?", (d["name"].strip(), other["id"]))
                return {"id": other["id"]}
        if "name" in d and d["name"].strip():
            sets += ["name=?", "norm=?"]
            args += [d["name"].strip(), norm_name(d["name"])]
        if "section_id" in d:
            sets.append("section_id=?")
            args.append(d["section_id"] or None)
        if "always_have" in d:
            sets.append("always_have=?")
            args.append(1 if d["always_have"] else 0)
        if sets:
            DB.execute(f"UPDATE products SET {', '.join(sets)} WHERE id=?", args + [d["id"]])
        return {"id": d["id"]}
    pid = find_or_create_product(d["name"])
    if "section_id" in d:
        DB.execute("UPDATE products SET section_id=? WHERE id=?", (d["section_id"] or None, pid))
    return {"id": pid}


def act_product_merge(d):
    """Sujungia du produktus (pvz. 'Svogūnas' ir 'Svogūnai')."""
    src, dst = d["from"], d["into"]
    if src == dst:
        return
    DB.execute("UPDATE ingredients SET product_id=? WHERE product_id=?", (dst, src))
    DB.execute("UPDATE extras SET product_id=? WHERE product_id=?", (dst, src))
    DB.execute("DELETE FROM pstate WHERE product_id=?", (src,))
    DB.execute("DELETE FROM products WHERE id=?", (src,))


def act_product_delete(d):
    used = DB.execute("SELECT COUNT(*) FROM ingredients WHERE product_id=?", (d["id"],)).fetchone()[0]
    if used:
        raise ValueError(f"Produktas naudojamas {used} recepte(-uose). Pirma sujunkite jį su kitu.")
    DB.execute("DELETE FROM extras WHERE product_id=?", (d["id"],))
    DB.execute("DELETE FROM pstate WHERE product_id=?", (d["id"],))
    DB.execute("DELETE FROM products WHERE id=?", (d["id"],))


def act_menu_add(d):
    r = DB.execute("SELECT servings FROM recipes WHERE id=?", (d["recipe_id"],)).fetchone()
    DB.execute("INSERT INTO menu(day, recipe_id, servings, in_list) VALUES(?,?,?,1)",
               (d["day"], d["recipe_id"], num(d.get("servings")) or (r["servings"] if r else 4)))
    ensure_recipe_pos(d["recipe_id"])


def act_menu_update(d):
    for k in ("day", "servings", "in_list"):
        if k in d:
            v = num(d[k]) if k == "servings" else (1 if d[k] else 0) if k == "in_list" else d[k]
            DB.execute(f"UPDATE menu SET {k}=? WHERE id=?", (v, d["id"]))
    if d.get("in_list"):
        m = DB.execute("SELECT recipe_id FROM menu WHERE id=?", (d["id"],)).fetchone()
        if m:
            ensure_recipe_pos(m["recipe_id"])


def act_menu_delete(d):
    DB.execute("DELETE FROM menu WHERE id=?", (d["id"],))
    DB.execute("DELETE FROM history WHERE menu_id=?", (d["id"],))


def act_menu_cooked(d):
    m = DB.execute("SELECT * FROM menu WHERE id=?", (d["id"],)).fetchone()
    if not m:
        return
    if d.get("cooked"):
        DB.execute("UPDATE menu SET cooked=1, in_list=0 WHERE id=?", (m["id"],))
        if not DB.execute("SELECT 1 FROM history WHERE menu_id=?", (m["id"],)).fetchone():
            DB.execute("INSERT INTO history(recipe_id, day, menu_id) VALUES(?,?,?)",
                       (m["recipe_id"], m["day"], m["id"]))
    else:
        DB.execute("UPDATE menu SET cooked=0 WHERE id=?", (m["id"],))
        DB.execute("DELETE FROM history WHERE menu_id=?", (m["id"],))


def act_cooked_now(d):
    """Pažymėti, kad receptas pagamintas šiandien (be meniu)."""
    DB.execute("INSERT INTO history(recipe_id, day) VALUES(?,?)",
               (d["recipe_id"], d.get("day") or dt.date.today().isoformat()))


def act_history_delete(d):
    DB.execute("DELETE FROM history WHERE id=?", (d["id"],))


def act_extra_add(d):
    pid = d.get("product_id")
    if pid and not DB.execute("SELECT 1 FROM products WHERE id=?", (pid,)).fetchone():
        pid = None
    pid = pid or find_or_create_product(d.get("name", ""))
    if not pid:
        raise ValueError("Įrašykite prekės pavadinimą")
    merge_extra(pid, num(d.get("qty")), d.get("unit", "") or "", d.get("note", "") or "", d.get("recipe", "") or "")
    DB.execute("UPDATE pstate SET checked=0, state=NULL WHERE product_id=?", (pid,))
    ensure_pos(pid)
    return {"product_id": pid}


def dedupe_extras():
    for r in DB.execute("SELECT product_id FROM extras GROUP BY product_id HAVING COUNT(*) > 1").fetchall():
        exs = DB.execute("SELECT * FROM extras WHERE product_id=? ORDER BY id", (r["product_id"],)).fetchall()
        for e in exs[1:]:
            DB.execute("DELETE FROM extras WHERE id=?", (e["id"],))
            merge_extra(e["product_id"], e["qty"], e["unit"] or "", e["note"] or "", e["recipe"] or "")


def merge_extra(pid, qty, unit, note, recipe):
    """Viena eilutė vienai prekei: tas pats produktas sujungiamas (kiekiai sudedami)."""
    ex = DB.execute("SELECT * FROM extras WHERE product_id=? ORDER BY id LIMIT 1", (pid,)).fetchone()
    if not ex:
        DB.execute("INSERT INTO extras(product_id, qty, unit, note, created, recipe) VALUES(?,?,?,?,?,?)",
                   (pid, qty, unit, note, now(), recipe))
        return
    eq, eu = ex["qty"], ex["unit"] or ""
    if qty is not None and eq is not None and eu == unit:
        nq, nu = eq + qty, unit
    elif eq is None and qty is not None:
        nq, nu = qty, unit
    else:  # skirtingi vienetai - paliekam esamą kiekį
        nq, nu = eq, eu
        if qty is not None and eu != unit:
            note = ", ".join(x for x in [note, f"+{qty:g} {unit}".strip()] if x)
    notes = [x for x in (ex["note"] or "").split(", ") if x]
    for x in [y for y in note.split(", ") if y]:
        if x not in notes:
            notes.append(x)
    labels = [x for x in (ex["recipe"] or "").split("|") if x]
    for rcp in [x for x in (recipe or "").split("|") if x]:
        if rcp not in labels:
            labels.append(rcp)
    DB.execute("UPDATE extras SET qty=?, unit=?, note=?, recipe=? WHERE id=?",
               (nq, nu, ", ".join(notes), "|".join(labels), ex["id"]))


def act_extras_bulk(d):
    ids = []
    for it in d.get("items", []) or []:
        if not (it.get("name") or it.get("product_id")):
            continue
        ids.append(act_extra_add(it)["product_id"])
    after = d.get("after")
    if after and ids:
        # įterpiam naujas prekes iškart po nurodytos (likusios pasislenka žemyn)
        order = [r["product_id"] for r in rows("SELECT product_id FROM pstate WHERE pos IS NOT NULL ORDER BY pos")]
        new = [i for i in dict.fromkeys(ids) if i != after]
        order = [i for i in order if i not in new]
        at = order.index(after) + 1 if after in order else len(order)
        order[at:at] = new
        for k, pid in enumerate(order):
            DB.execute("UPDATE pstate SET pos=? WHERE product_id=?", (k + 1, pid))
    return {"product_ids": ids}


def act_extra_update(d):
    DB.execute("UPDATE extras SET qty=?, unit=?, note=? WHERE id=?",
               (num(d.get("qty")), d.get("unit", "") or "", d.get("note", "") or "", d["id"]))


def act_extra_delete(d):
    DB.execute("DELETE FROM extras WHERE id=?", (d["id"],))


def ensure_pos(pid):
    DB.execute("INSERT OR IGNORE INTO pstate(product_id, state, checked) VALUES(?, NULL, 0)", (pid,))
    r = DB.execute("SELECT pos FROM pstate WHERE product_id=?", (pid,)).fetchone()
    if r["pos"] is None:
        mx = DB.execute("SELECT COALESCE(MAX(pos), 0) FROM pstate").fetchone()[0]
        DB.execute("UPDATE pstate SET pos=? WHERE product_id=?", (mx + 1, pid))


def backfill_pos():
    """Prekėms sąraše be eilės numerio priskiriam jį (seni duomenys)."""
    for r in DB.execute("SELECT product_id FROM extras ORDER BY id").fetchall():
        ensure_pos(r["product_id"])
    for m in DB.execute("SELECT recipe_id FROM menu WHERE in_list=1 AND cooked=0 ORDER BY id").fetchall():
        ensure_recipe_pos(m["recipe_id"])


def ensure_recipe_pos(recipe_id):
    for r in DB.execute("SELECT product_id FROM ingredients WHERE recipe_id=? ORDER BY pos, id", (recipe_id,)).fetchall():
        ensure_pos(r["product_id"])


def act_list_order(d):
    for i, pid in enumerate(d.get("ids", [])):
        ensure_pos(pid)
        DB.execute("UPDATE pstate SET pos=? WHERE product_id=?", (i + 1, pid))


def act_rule_save(d):
    word = (d.get("word") or "").strip()
    if not word:
        raise ValueError("Įrašykite žodį")
    color, bold = d.get("color", ""), 1 if d.get("bold") else 0
    if d.get("id"):
        DB.execute("UPDATE note_rules SET word=?, color=?, bold=? WHERE id=?", (word, color, bold, d["id"]))
    else:
        DB.execute("INSERT INTO note_rules(word, color, bold) VALUES(?,?,?)", (word, color, bold))


def act_rule_delete(d):
    DB.execute("DELETE FROM note_rules WHERE id=?", (d["id"],))


def upsert_pstate(pid, **kw):
    DB.execute("INSERT OR IGNORE INTO pstate(product_id, state, checked) VALUES(?, NULL, 0)", (pid,))
    for k, v in kw.items():
        DB.execute(f"UPDATE pstate SET {k}=?, updated=? WHERE product_id=?", (v, now(), pid))


def act_check(d):
    upsert_pstate(d["product_id"], checked=1 if d.get("checked") else 0)


def act_state(d):
    st = d.get("state")
    if st not in (None, "have", "low", "need"):
        raise ValueError("Bloga būsena")
    upsert_pstate(d["product_id"], state=st)


def act_shopping_done(d):
    """Apsipirkimas baigtas.
    - nupirktos (pažymėtos) prekės nuimamos;
    - receptai išimami iš sąrašo, bet jų NEnupirktos prekės lieka kaip paprastos prekės
      su recepto pavadinimu (jas reikės pažymėti ar ištrinti ranka);
    - turimos namie / visada turimos prekės neperkeliamos."""
    st = {r["product_id"]: r for r in rows("SELECT * FROM pstate")}
    carry = []
    for m in rows("""SELECT m.*, r.title, r.servings AS rserv FROM menu m JOIN recipes r ON r.id=m.recipe_id
                     WHERE m.in_list=1 AND m.cooked=0 ORDER BY m.id"""):
        f = (m["servings"] or m["rserv"] or 1) / (m["rserv"] or 1)
        for i in rows("""SELECT i.*, p.always_have FROM ingredients i JOIN products p ON p.id=i.product_id
                         WHERE i.recipe_id=? ORDER BY i.pos, i.id""", (m["recipe_id"],)):
            s_ = st.get(i["product_id"]) or {}
            if s_.get("checked") or s_.get("state") == "have":
                continue
            if i["always_have"] and s_.get("state") not in ("need", "low"):
                continue
            carry.append((i["product_id"], i["qty"] * f if i["qty"] is not None else None, i["unit"] or "", m["title"]))
    checked = [pid for pid, r in st.items() if r["checked"]]
    for pid in checked:
        DB.execute("DELETE FROM extras WHERE product_id=?", (pid,))
    DB.execute("UPDATE menu SET in_list=0 WHERE in_list=1")
    for pid, qty, unit, title in carry:
        merge_extra(pid, qty, unit, "", title)
        ensure_pos(pid)
        DB.execute("UPDATE pstate SET state=NULL, checked=0 WHERE product_id=?", (pid,))
    DB.execute("DELETE FROM pstate WHERE product_id NOT IN (SELECT product_id FROM extras)")
    return {"carried": len(carry)}


def act_uncheck_all(d):
    DB.execute("UPDATE pstate SET checked=0 WHERE checked=1")


def act_list_clear(d):
    DB.execute("UPDATE menu SET in_list=0 WHERE in_list=1")
    DB.execute("DELETE FROM extras")
    DB.execute("DELETE FROM pstate")


# ---------------------------------------------------------------- receptas iš nuorodos
UA = ("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Mobile Safari/537.36")


def fetch(url, limit=4 * 1024 * 1024, accept="text/html,*/*"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept,
                                               "Accept-Language": "lt,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = r.read(limit + 1)
        if len(data) > limit:
            raise ValueError("Puslapis per didelis")
        ctype = r.headers.get("Content-Type", "")
        m = re.search(r"charset=([\w-]+)", ctype)
        return data, ctype, (m.group(1) if m else "utf-8"), r.geturl()


def clean_text(t):
    t = htmlmod.unescape(re.sub(r"<[^>]+>", " ", str(t or "")))
    return re.sub(r"[ \t\u00a0]+", " ", t).strip()


def _find_recipe(o):
    if isinstance(o, list):
        for x in o:
            r = _find_recipe(x)
            if r:
                return r
    elif isinstance(o, dict):
        t = o.get("@type")
        if t == "Recipe" or (isinstance(t, list) and "Recipe" in t):
            return o
        for k in ("@graph", "mainEntity", "itemListElement"):
            if k in o:
                r = _find_recipe(o[k])
                if r:
                    return r
    return None


def _steps(ins):
    out = []
    if isinstance(ins, str):
        out += [x for x in re.split(r"\n+|(?<=\.)\s+(?=\d+\.)", clean_text(ins.replace("<br", "\n<br"))) if x.strip()]
    elif isinstance(ins, list):
        for x in ins:
            out += _steps(x)
    elif isinstance(ins, dict):
        if ins.get("itemListElement"):
            out += _steps(ins["itemListElement"])
        elif ins.get("text") or ins.get("name"):
            out.append(clean_text(ins.get("text") or ins.get("name")))
    return [re.sub(r"^\d+[.)]\s*", "", x).strip() for x in out if x and x.strip()]


def _image(img):
    if isinstance(img, list) and img:
        return _image(img[0])
    if isinstance(img, dict):
        return img.get("url") or img.get("contentUrl")
    return img if isinstance(img, str) else None


def _meta(html, prop):
    m = re.search(r'<meta[^>]+(?:property|name)=["\']%s["\'][^>]*content=["\']([^"\']*)' % re.escape(prop), html, re.I) \
        or re.search(r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']%s["\']' % re.escape(prop), html, re.I)
    return htmlmod.unescape(m.group(1)).strip() if m else ""


def image_data_url(url, base):
    if not url:
        return None
    try:
        from urllib.parse import urljoin
        data, ctype, _, _ = fetch(urljoin(base, url), limit=6 * 1024 * 1024, accept="image/*")
        if not ctype.startswith("image/") or len(data) < 2000:
            return None
        return "data:%s;base64,%s" % (ctype.split(";")[0], base64.b64encode(data).decode())
    except Exception:
        return None


def instagram_caption(url):
    """Bandymas: Instagram dažnai rodo tik prisijungimo langą, todėl tai ne visada pavyksta."""
    m = re.search(r"instagram\.com/(?:[\w.]+/)?(p|reel|reels|tv)/([\w-]+)", url)
    if not m:
        return None
    code = m.group(2)
    for u in ("https://www.instagram.com/p/%s/embed/captioned/" % code, url):
        try:
            data, _, cs, final = fetch(u)
            html = data.decode(cs, "replace")
            cap = re.search(r'<div class="Caption"[^>]*>(.*?)</div>', html, re.S)
            text = ""
            if cap:
                t = re.sub(r"<br\s*/?>", "\n", cap.group(1))
                t = re.sub(r'<a class="CaptionUsername"[^>]*>.*?</a>', "", t, flags=re.S)
                t = re.sub(r'<div class="CaptionComments".*', "", t, flags=re.S)
                text = htmlmod.unescape(re.sub(r"<[^>]+>", "", t)).strip()
            if not text:
                d = _meta(html, "og:description") or _meta(html, "description")
                d = re.sub(r'^.*?:\s*["“]', "", d, count=1).rstrip('"”. ')
                text = d if len(d) > 40 else ""
            if text:
                img = re.search(r'<img class="EmbeddedMediaImage"[^>]*src="([^"]+)"', html)
                return {"text": text, "image": htmlmod.unescape(img.group(1)) if img else _meta(html, "og:image"), "base": final}
        except Exception:
            continue
    return None


def import_from_url(url):
    url = (url or "").strip()
    if not re.match(r"^https?://", url):
        raise ValueError("Įklijuokite pilną nuorodą (prasideda https://)")
    if "instagram.com" in url:
        ig = instagram_caption(url)
        if not ig:
            raise ValueError("Instagram neleido paimti įrašo teksto. Nukopijuokite aprašymą (pvz. per Google Lens) ir naudokite „Iš teksto“.")
        return {"kind": "text", "text": ig["text"], "source": url, "image": image_data_url(ig["image"], ig["base"])}
    data, _, cs, final = fetch(url)
    html = data.decode(cs, "replace")
    rec = None
    for blk in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            rec = _find_recipe(json.loads(blk.strip()))
        except ValueError:
            try:
                rec = _find_recipe(json.loads(re.sub(r"[\x00-\x1f]", " ", blk.strip())))
            except ValueError:
                rec = None
        if rec:
            break
    if rec:
        y = rec.get("recipeYield")
        y = y[0] if isinstance(y, list) and y else y
        m = re.search(r"\d+", str(y or ""))
        return {"kind": "recipe", "source": final,
                "title": clean_text(rec.get("name")) or _meta(html, "og:title"),
                "servings": int(m.group()) if m else None,
                "ingredients": [clean_text(x) for x in (rec.get("recipeIngredient") or rec.get("ingredients") or []) if clean_text(x)],
                "steps": _steps(rec.get("recipeInstructions")),
                "notes": clean_text(rec.get("description"))[:500],
                "image": image_data_url(_image(rec.get("image")) or _meta(html, "og:image"), final)}
    title = _meta(html, "og:title") or clean_text((re.search(r"<title>(.*?)</title>", html, re.S | re.I) or [None, ""])[1])
    desc = _meta(html, "og:description") or _meta(html, "description")
    raise ValueError("Šiame puslapyje nepavyko rasti recepto struktūros%s. Nukopijuokite recepto tekstą ir naudokite „Iš teksto“."
                     % (f" („{title[:60]}“)" if title else ""))


def act_import(d):
    data = d.get("data")
    if isinstance(data, str):
        data = json.loads(data)
    items = data.get("receptai") if isinstance(data, dict) else data
    if items is None and isinstance(data, dict) and "recipes" in data:
        return import_backup(data)
    count = 0
    for it in items or []:
        ings = []
        for g in it.get("ingredientai", []):
            if isinstance(g, str):
                g = {"produktas": g}
            ings.append({"product_name": g.get("produktas") or g.get("pavadinimas"),
                         "qty": g.get("kiekis"), "unit": g.get("vienetas", ""),
                         "note": g.get("pastaba", ""), "section": g.get("skyrius")})
        res = act_recipe_save({
            "title": it.get("pavadinimas"), "servings": it.get("porcijos") or 4,
            "tags": it.get("zymos", []), "notes": it.get("pastabos", ""),
            "steps": it.get("zingsniai", []), "source": it.get("saltinis", ""),
            "original_text": it.get("originalas", ""), "ingredients": ings,
        })
        for ph in it.get("nuotraukos", []) or []:
            try:
                save_photo(res["id"], ph.get("tipas", "original"), ph.get("duomenys"))
            except Exception:
                pass
        count += 1
    return {"imported": count}


def import_backup(data):
    """Atkuria pilną programos eksportą (viską pakeičia)."""
    for t in ("sections", "products", "recipes", "ingredients", "photos", "menu", "history",
              "extras", "pstate", "note_rules"):
        DB.execute(f"DELETE FROM {t}")
        for r in data.get(t, []):
            if t == "photos" and r.get("data"):
                fn = r["filename"]
                with open(os.path.join(PHOTO_DIR, fn), "wb") as f:
                    f.write(base64.b64decode(r["data"]))
                r = {k: v for k, v in r.items() if k != "data"}
            cols = ",".join(r.keys())
            DB.execute(f"INSERT INTO {t}({cols}) VALUES({','.join('?' * len(r))})", list(r.values()))
    return {"imported": len(data.get("recipes", []))}


def export_all(with_photos=True):
    out = {"programa": "receptai", "eksportuota": now()}
    for t in ("sections", "products", "recipes", "ingredients", "photos", "menu", "history",
              "extras", "pstate", "note_rules"):
        out[t] = rows(f"SELECT * FROM {t}")
    if with_photos:
        for p in out["photos"]:
            try:
                with open(os.path.join(PHOTO_DIR, p["filename"]), "rb") as f:
                    p["data"] = base64.b64encode(f.read()).decode()
            except OSError:
                p["data"] = None
    return out


def get_original(rid):
    r = DB.execute("SELECT original_json, original_text FROM recipes WHERE id=?", (rid,)).fetchone()
    if not r:
        return {}
    return {"snapshot": json.loads(r["original_json"]) if r["original_json"] else None,
            "text": r["original_text"]}


ACTIONS = {
    "recipe_save": act_recipe_save, "recipe_delete": act_recipe_delete,
    "recipe_photo": act_recipe_photo, "photo_delete": act_photo_delete,
    "section_save": act_section_save, "section_delete": act_section_delete,
    "section_order": act_section_order,
    "product_save": act_product_save, "product_delete": act_product_delete,
    "product_merge": act_product_merge,
    "menu_add": act_menu_add, "menu_update": act_menu_update, "menu_delete": act_menu_delete,
    "menu_cooked": act_menu_cooked, "cooked_now": act_cooked_now, "history_delete": act_history_delete,
    "extra_add": act_extra_add, "extra_delete": act_extra_delete,
    "extras_bulk": act_extras_bulk, "extra_update": act_extra_update,
    "list_order": act_list_order, "rule_save": act_rule_save, "rule_delete": act_rule_delete,
    "check": act_check, "state": act_state,
    "shopping_done": act_shopping_done, "uncheck_all": act_uncheck_all, "list_clear": act_list_clear,
    "import": act_import,
}

MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png",
        ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4"}


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "Receptai/1.0"

    def log_message(self, fmt, *args):
        if os.environ.get("DEBUG"):
            super().log_message(fmt, *args)

    # --- pagalbinės
    def authed(self):
        if not PIN:
            return True
        if self.client_address[0] == INGRESS_IP:
            return True
        c = SimpleCookie(self.headers.get("Cookie", ""))
        return "receptai_auth" in c and secrets.compare_digest(c["receptai_auth"].value, AUTH_TOKEN)

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

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 60 * 1024 * 1024:
            raise ValueError("Per didelis failas")
        raw = self.rfile.read(n) if n else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def static(self, rel):
        rel = rel or "index.html"
        path = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not path.startswith(STATIC_DIR) or not os.path.isfile(path):
            path = os.path.join(STATIC_DIR, "index.html")
        ext = os.path.splitext(path)[1]
        with open(path, "rb") as f:
            self.send(200, f.read(), MIME.get(ext, "application/octet-stream"))

    # --- GET
    def do_GET(self):
        path = unquote(urlparse(self.path).path).lstrip("/")
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
            if path == "api/screen_status":
                uid = self.headers.get("X-Remote-User-Id", "")
                info = {"user": self.headers.get("X-Remote-User-Display-Name") or self.headers.get("X-Remote-User-Name") or "",
                        "via_ha": bool(uid), "api": bool(SUP_TOKEN)}
                try:
                    info["targets"], info["all"] = phones_for_user(uid, info)
                except Exception as e:  # noqa
                    info["error"] = str(e)
                return self.send(200, info)
            if path == "api/version":
                with LOCK:
                    return self.send(200, {"version": version()})
            if path.startswith("api/original/"):
                with LOCK:
                    return self.send(200, get_original(int(path.split("/")[-1])))
            if path == "api/export":
                with LOCK:
                    data = export_all(True)
                name = "receptai-" + dt.date.today().isoformat() + ".json"
                return self.send(200, data, "application/json",
                                 {"Content-Disposition": f'attachment; filename="{name}"'})
            if path.startswith("photos/"):
                fn = os.path.basename(path)
                fp = os.path.join(PHOTO_DIR, fn)
                if os.path.isfile(fp):
                    with open(fp, "rb") as f:
                        return self.send(200, f.read(), MIME.get(os.path.splitext(fn)[1].lower(), "image/jpeg"),
                                         {"Cache-Control": "max-age=31536000"})
                return self.send(404, {"error": "Nerasta"})
            return self.static(path)
        except Exception as e:  # noqa
            return self.send(500, {"error": str(e)})

    # --- POST
    def do_POST(self):
        path = unquote(urlparse(self.path).path).lstrip("/")
        try:
            if path == "api/login":
                d = self.read_json()
                if PIN and secrets.compare_digest(str(d.get("pin", "")), PIN):
                    return self.send(200, {"ok": True}, extra={
                        "Set-Cookie": f"receptai_auth={AUTH_TOKEN}; Path=/; Max-Age=31536000; SameSite=Lax"})
                return self.send(403, {"error": "Neteisingas PIN"})
            if not self.authed():
                return self.send(401, {"error": "Reikia PIN"})
            if path == "api/import_url":
                d = self.read_json()
                try:
                    return self.send(200, import_from_url(d.get("url")))
                except ValueError as e:
                    return self.send(200, {"error": str(e)})
                except Exception as e:  # noqa
                    return self.send(200, {"error": "Nepavyko atidaryti nuorodos (%s)" % e})
            if path == "api/screen":
                d = self.read_json()
                uid = self.headers.get("X-Remote-User-Id", "")
                try:
                    t = act_screen(uid, bool(d.get("on")))
                    return self.send(200, {"ok": True, "targets": t})
                except Exception as e:  # noqa
                    return self.send(200, {"ok": False, "error": str(e)})
            if path.startswith("api/do/"):
                name = path[len("api/do/"):]
                fn = ACTIONS.get(name)
                if not fn:
                    return self.send(404, {"error": "Nežinomas veiksmas"})
                d = self.read_json()
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


# ---------------------------------------------------------------- ekranas gaminant
# HA Android programėlė moka laikyti ekraną įjungtą, kai gauna pranešimą-komandą
# "command_screen_on" su command: keep_screen_on. Kita command reikšmė tai atšaukia.
SUP_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
SCREEN = {}  # notify paslauga -> paskutinio „gyvybės ženklo“ laikas
SCREEN_LOCK = threading.Lock()
SCREEN_TIMEOUT = 15 * 60  # jei programa užsidaro neatšaukusi – atšaukiam po 15 min.


def ha(method, path, body=None):
    if not SUP_TOKEN:
        raise RuntimeError("Nėra ryšio su Home Assistant (priedui neleista naudoti HA API)")
    req = urllib.request.Request("http://supervisor/core/api/" + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + SUP_TOKEN, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        raw = r.read()
        if not raw:
            return None
        try:
            return json.loads(raw)
        except ValueError:  # /api/template grąžina paprastą tekstą
            return raw.decode("utf-8", "replace")


def phones_for_user(user_id, diag=None):
    """HA naudotojas -> asmuo -> jo telefonų sekikliai -> mobile_app_* pranešimų paslaugos.
    Paslaugos vardas imamas iš įrenginio pavadinimo (patikimiau nei iš sekiklio pavadinimo)."""
    diag = diag if diag is not None else {}
    manual = [x.strip().replace("notify.", "") for x in (OPTIONS.get("ekrano_telefonai") or []) if x and x.strip()]
    notify = set()
    for d in ha("GET", "services") or []:
        if d.get("domain") == "notify":
            notify.update(k for k in d.get("services", {}) if k.startswith("mobile_app_"))
    found, trackers, person = [], [], None
    if user_id:
        for st in ha("GET", "states") or []:
            if st["entity_id"].startswith("person.") and st.get("attributes", {}).get("user_id") == user_id:
                person = st["attributes"].get("friendly_name") or st["entity_id"]
                trackers = st["attributes"].get("device_trackers", []) or []
    for tr in trackers:
        cands = ["mobile_app_" + tr.split(".", 1)[-1]]
        try:
            slug = ha("POST", "template", {"template": "{{ device_attr(device_id('%s'), 'name') | slugify }}" % tr})
            if slug and str(slug).strip() not in ("", "none"):
                cands.insert(0, "mobile_app_" + str(slug).strip())
        except Exception:
            pass
        for c in cands:
            if c in notify and c not in found:
                found.append(c)
                break
    diag.update({"person": person, "trackers": trackers})
    return found or [m for m in manual if m in notify] or manual, sorted(notify)


def screen_send(svc, on):
    ha("POST", "services/notify/" + svc,
       {"message": "command_screen_on", "data": {"command": "keep_screen_on" if on else "default"}})


def act_screen(user_id, on):
    targets, _ = phones_for_user(user_id)
    if not targets:
        raise RuntimeError("Nerastas telefonas. Žr. Daugiau → Ekranas gaminant.")
    for svc in targets:
        with SCREEN_LOCK:
            was_on = svc in SCREEN
            if on:
                SCREEN[svc] = time.time()
            else:
                SCREEN.pop(svc, None)
        if on and not was_on or not on:
            screen_send(svc, on)
    return targets


def screen_watchdog():
    while True:
        time.sleep(60)
        now_ = time.time()
        with SCREEN_LOCK:
            stale = [s for s, t in SCREEN.items() if now_ - t > SCREEN_TIMEOUT]
            for s_ in stale:
                SCREEN.pop(s_, None)
        for s_ in stale:
            try:
                screen_send(s_, False)
            except Exception as e:  # noqa
                print("Ekrano atšaukimo klaida:", e, flush=True)


def main():
    init_db()
    threading.Thread(target=screen_watchdog, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Receptai veikia per prievadą {PORT}. Duomenys: {DATA_DIR}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
