#!/usr/bin/env python3
"""Sekiklis - prekių atsiradimo parduotuvėse sekimo Home Assistant priedas.

Kas kelias minutes atsisiunčia prekių puslapius, iš jų struktūrinių duomenų
(schema.org „availability“) nustato, ar prekę galima pirkti, ir prekei atsiradus
siunčia pranešimus į visus telefonus su HA programėle.

Naudoja tik standartinę Python biblioteką. Duomenys: /data/sekiklis.json.
"""
import base64
import datetime as dt
import gzip
import hashlib
import http.client
import json
import os
import random
import re
import secrets
import socket
import ssl
import struct
import threading
import time
import urllib.error
import urllib.request
import zlib
from html import unescape
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote, parse_qsl, urlencode, urlunparse, urljoin

DATA_DIR = os.environ.get("DATA_DIR", "/data")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
STATE_PATH = os.path.join(DATA_DIR, "sekiklis.json")
PORT = int(os.environ.get("PORT", "8099"))
INGRESS_IP = "172.30.32.2"
SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
HA_HOST = os.environ.get("SEKIKLIS_HA_HOST", "supervisor")
HA_PORT = int(os.environ.get("SEKIKLIS_HA_PORT", "80"))
ACTION_PREFIX = "SEKIKLIS_"
VERSION = "1.2.0"
LOCK = threading.RLock()
WAKE = threading.Event()

os.makedirs(DATA_DIR, exist_ok=True)


def log(*a):
    print(dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


def load_options():
    try:
        with open(os.path.join(DATA_DIR, "options.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


OPTIONS = load_options()
PIN = str(OPTIONS.get("pin") or "").strip()
AUTH_TOKEN = hashlib.sha256(("sekiklis:" + PIN).encode()).hexdigest() if PIN else ""

# ---------------------------------------------------------------- būsena

SEED = [
    "https://gameroom.lt/en/playstation-controllers/products/sony-playstation-dualsense-gta-vi-black-limited-edition-wireless-controller-ps5-29720",
    "https://gameroom.lt/en/playstation-controllers/products/sony-playstation-dualsense-gta-vi-white-limited-edition-wireless-controller-ps5-29721",
    "https://www.senukai.lt/p/zaidimu-pultas-sony-dualsense-grand-theft-auto-vi-limited-edition-juoda-sp/16494",
    "https://www.senukai.lt/p/zaidimu-pultas-sony-dualsense-grand-theft-auto-vi-limited-edition-balta-sp/16495",
    "https://www.1a.lt/p/zaidimu-pultas-sony-dualsense-grand-theft-auto-vi-limited-edition-juoda-sp/10gf2",
    "https://www.1a.lt/p/zaidimu-pultas-sony-dualsense-grand-theft-auto-vi-limited-edition-balta-sp/10gf4",
]
# 1.1 versijoje pridėtos (Suomija – juodas 89 €, Amazon.de – baltas, tik kai parduoda pats Amazon)
SEED_V2 = [
    "https://www.verkkokauppa.com/en/product/1073438/Sony-Dualsense-GTA-VI-Limited-Edition-game-controller-black",
    "https://www.amazon.de/dp/B0HHS4DKRM",
]
SEARCH_SEED = [
    "https://www.senukai.lt/paieska?q=dualsense%20gta%20vi",
    "https://www.varle.lt/search/?q=dualsense%20gta",
    "https://pigu.lt/lt/search?q=dualsense%20gta%20vi",
    "https://gameroom.lt/en/search?search_query=dualsense+gta",
]
WHITE_LIMIT = 100.0
SEARCH_EVERY = 15 * 60

# Ar pavadinimas – GTA VI pultelis (bet kuria kalba), o ne žaidimas ar priedas
RE_GTA = re.compile(r"(gta\s*-?\s*(vi|6)\b|grand\s+theft\s+auto\s*:?\s*(vi|6)\b|gta[\s-]*vi|gta6)", re.I)
RE_PAD = re.compile(r"(dual\s*sense|pult|valdikl|controller|kontroler|\bpad\b|gamepad|ohjain|mando)", re.I)
RE_NOT = re.compile(r"(\bžaidimas\b|\bgame\b(?!\s*(controller|pad))|\bgra\b|\bpeli\b(?!ohjain)|stov|stand|stojak|"
                    r"podstaw|dėkl|\bskin|lipduk|naklej|įkrov|charger|ładowar|ladestation|konsol|console|rinkin|"
                    r"zestaw|bundle|\bkodas\b|\bcode\b|marškin|plakat|nakładk|\bgrip|thumb|apsaug|\bcover|\bcase\b|"
                    r"futerał|\bdėžut)", re.I)
RE_BLACK = re.compile(r"(juod|black|czarn|musta|\bmust\b|melna)", re.I)
RE_WHITE = re.compile(r"(balt|white|biał|bial|valkoi|valge|\bbalta)", re.I)


def is_target(name):
    n = name or ""
    return bool(RE_GTA.search(n) and RE_PAD.search(n) and not RE_NOT.search(n))


def colour_of(text):
    t = text or ""
    if RE_BLACK.search(t):
        return "black"
    if RE_WHITE.search(t):
        return "white"
    return ""

DEFAULT_SETTINGS = {
    "interval": 5,          # min. tarp tikrinimų
    "services": None,       # None = visi mobile_app_* telefonai
    "persistent": True,     # dar ir HA pranešimų skiltyje
    "repeat_every": 10,     # min. tarp pakartotinių pranešimų
    "repeat_max": 6,        # kiek kartų iš viso siųsti, kol nenutildyta
    "watchdog": True,       # pranešti, jei sekiklis nebeveikia
}

STATE = {"seq": 0, "items": [], "searches": [], "seed_version": 0, "settings": dict(DEFAULT_SETTINGS),
         "health": {"last_send_ok": "", "last_send_err": "", "last_test": "", "watchdog_sent": ""}}
RUNTIME = {"ws": False, "started": time.time(), "checking": None}


def now_ts():
    return time.time()


def iso(ts=None):
    return dt.datetime.fromtimestamp(ts or time.time()).isoformat(timespec="seconds")


def save():
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(STATE, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE_PATH)


ITEM_DEFAULTS = {"name": "", "custom_name": "", "enabled": True, "status": "new", "price": None,
                 "checked_at": 0, "changed_at": 0, "next_at": 0, "error": "", "http": 0, "fails": 0,
                 "alerts": 0, "last_alert": 0, "muted": False, "history": [], "probe": "",
                 "mode": "alert",       # alert = tikrina ir praneša; watch = tik tikrina
                 "max_price": None,     # pranešti tik jei kaina ne didesnė
                 "ref_name": "",        # pirmas rastas pavadinimas – kad pastebėtume „pakeistą“ prekę
                 "source": "manual"}


def new_item(url, **kw):
    STATE["seq"] += 1
    it = {"id": STATE["seq"], "url": url, "shop": shop_name(url)}
    it.update(json.loads(json.dumps(ITEM_DEFAULTS)))
    if colour_of(url) == "white":
        it["max_price"] = WHITE_LIMIT
    it.update(kw)
    return it


def new_search(url):
    STATE["seq"] += 1
    return {"id": STATE["seq"], "url": url, "shop": shop_name(url), "enabled": True, "status": "new",
            "error": "", "http": 0, "checked_at": 0, "next_at": 0, "found": 0, "added": []}


def migrate():
    """Prideda 1.1 versijos naujoves prie jau esamų duomenų (nieko netrinant)."""
    for it in STATE["items"]:
        for k, v in ITEM_DEFAULTS.items():
            it.setdefault(k, json.loads(json.dumps(v)))
        if not it.get("ref_name") and it.get("name") and it["status"] not in ("new", "blocked", "error"):
            it["ref_name"] = it["name"]
    STATE.setdefault("searches", [])
    if STATE.get("seed_version", 0) < 2:
        for it in STATE["items"]:
            if it.get("max_price") is None and colour_of(it["url"] + " " + it.get("name", "")) == "white":
                it["max_price"] = WHITE_LIMIT
        have = {it["url"] for it in STATE["items"]}
        for u in SEED_V2:
            if u not in have:
                STATE["items"].append(new_item(u, max_price=WHITE_LIMIT if "amazon." in u else None))
        shave = {s["url"] for s in STATE["searches"]}
        for u in SEARCH_SEED:
            if u not in shave:
                STATE["searches"].append(new_search(u))
        STATE["seed_version"] = 2
    for it in STATE["items"]:
        if it["status"] in AVAILABLE and it.get("max_price") and it.get("price") and it["price"] > it["max_price"]:
            it["status"] = "pricey"


def load_state():
    global STATE
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, encoding="utf-8") as f:
                data = json.load(f)
            STATE.update(data)
            st = dict(DEFAULT_SETTINGS)
            st.update(STATE.get("settings") or {})
            STATE["settings"] = st
            STATE.setdefault("health", {})
            migrate()
            for it in STATE["items"] + STATE["searches"]:
                it["next_at"] = 0  # po paleidimo tikrinam iš karto
            save()
            return
        except Exception as e:  # noqa
            log("Nepavyko nuskaityti duomenų, pradedama iš naujo:", e)
    for u in SEED:
        STATE["items"].append(new_item(u))
    migrate()
    save()


# ---------------------------------------------------------------- nuorodos

SHOPS = {"gameroom.lt": "Gameroom", "senukai.lt": "Senukai", "1a.lt": "1A", "pigu.lt": "Pigu",
         "varle.lt": "Varle", "topocentras.lt": "Topocentras", "euronics.lt": "Euronics",
         "kilobaitas.lt": "Kilobaitas", "elektromarkt.lt": "Elektromarkt", "amazon.de": "Amazon.de 🇩🇪",
         "verkkokauppa.com": "Verkkokauppa 🇫🇮"}
TRACKING = re.compile(r"^(_gl|_ga|utm_.*|gclid|fbclid|gad_source|srsltid|mc_.*|yclid)$", re.I)


def host_of(url):
    h = (urlparse(url).hostname or "").lower()
    return h[4:] if h.startswith("www.") else h


def shop_name(url):
    h = host_of(url)
    return SHOPS.get(h, h)


def clean_url(url):
    url = (url or "").strip()
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    p = urlparse(url)
    if not p.hostname or "." not in p.hostname:
        raise ValueError("Neteisinga nuoroda")
    q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if not TRACKING.match(k)]
    return urlunparse((p.scheme.lower(), p.netloc.lower(), p.path, "", urlencode(q), ""))


# ---------------------------------------------------------------- puslapio tikrinimas

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/131.0.0.0 Safari/537.36")
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "lt-LT,lt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Upgrade-Insecure-Requests": "1",
}
SSL_CTX = ssl.create_default_context()

AVAIL = {
    "instock": "in", "instoreonly": "in", "onlineonly": "in", "limitedavailability": "in",
    "preorder": "pre", "presale": "pre", "backorder": "pre",
    "outofstock": "out", "soldout": "out", "discontinued": "out",
}
AVAILABLE = ("in", "pre")
LD_RE = re.compile(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", re.S | re.I)
PRODUCT_TYPES = ("Product", "ProductGroup", "IndividualProduct", "ProductModel")


def fetch(url):
    """Grąžina (HTTP kodas, HTML, galutinė nuoroda po peradresavimų)."""
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as r:
            code, raw, hdr, final = r.status, r.read(8_000_000), r.headers, r.geturl()
    except urllib.error.HTTPError as e:
        code, raw, hdr, final = e.code, e.read(300_000), e.headers, url
    enc = (hdr.get("Content-Encoding") or "").lower()
    try:
        if "gzip" in enc:
            raw = gzip.decompress(raw)
        elif "deflate" in enc:
            raw = zlib.decompress(raw, -zlib.MAX_WBITS) if raw[:1] != b"\x78" else zlib.decompress(raw)
    except Exception:  # noqa
        pass
    m = re.search(r"charset=([\w-]+)", hdr.get("Content-Type") or "")
    return code, raw.decode(m.group(1) if m else "utf-8", "replace"), final


def avail_code(v):
    v = str(v or "").strip().rstrip("/").split("/")[-1].lower()
    return AVAIL.get(v)


def walk(o, prod, out):
    if isinstance(o, list):
        for x in o:
            walk(x, prod, out)
    elif isinstance(o, dict):
        t = o.get("@type")
        ts = t if isinstance(t, list) else [t]
        if any(x in PRODUCT_TYPES for x in ts):
            prod = o
        if "availability" in o:
            out.append((o, prod))
        for k, v in o.items():
            if isinstance(v, (dict, list)):
                walk(v, prod, out)


def norm_path(u):
    p = urlparse(u or "")
    return (host_of(u), p.path.rstrip("/").lower())


def to_price(v):
    if v in (None, ""):
        return None
    s = re.sub(r"[^\d,.]", "", str(v))
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    else:
        s = s.replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def title_of(html):
    m = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)', html, re.I) \
        or re.search(r"<title[^>]*>([^<]+)", html, re.I)
    return unescape(m.group(1)).strip() if m else ""


def parse_amazon(url, html):
    """Amazon: „yra“ tik jei galima dėti į krepšelį IR parduoda pats Amazon (ne perpardavinėtojai)."""
    m = re.search(r'id="productTitle"[^>]*>([\s\S]*?)</span>', html)
    name = unescape(re.sub(r"\s+", " ", m.group(1))).strip() if m else title_of(html)
    pm = re.search(r'id="corePrice(?:Display_desktop)?_feature_div"[\s\S]{0,3000}?class="a-offscreen">([^<]+)<', html) \
        or re.search(r'class="a-price[^"]*"[^>]*>\s*<span class="a-offscreen">([^<]+)<', html)
    price = to_price(unescape(pm.group(1))) if pm else None
    can_buy = bool(re.search(r'<input[^>]+id="add-to-cart-button"', html))
    third = bool(re.search(r'id="sellerProfileTriggerId"', html))
    if can_buy and not third:
        return "in", name, price, ""
    if can_buy and third:
        return "out", name, price, "Parduoda kitas pardavėjas (ne Amazon)" + (f" už {price:.2f} €".replace(".", ",") if price else "")
    return "out", name, None, ""


def parse_verkkokauppa(url, html):
    name = re.sub(r"\s*[–-]\s*Verkkokauppa\.com\s*$", "", title_of(html))
    ship = re.search(r'"stocks":\{"shipment":\{"isAvailable":(true|false)', html)
    purch = re.search(r'"isPurchasable":(true|false)', html)
    pm = re.search(r'"price":"(\d+(?:\.\d+)?)"', html)
    if not ship and not purch:
        return None, name, None, ""
    if ship and ship.group(1) == "true":
        st = "in"
    elif purch and purch.group(1) == "true":
        st = "pre"
    else:
        st = "out"
    return st, name, to_price(pm.group(1)) if pm else None, ""


def parse_page(url, html):
    """Grąžina (status, vardas, kaina, pastaba); status None – jei nerasta."""
    h = host_of(url)
    if h.startswith("amazon."):
        return parse_amazon(url, html)
    if h == "verkkokauppa.com":
        return parse_verkkokauppa(url, html)
    offers = []
    for block in LD_RE.findall(html):
        try:
            walk(json.loads(block.strip(), strict=False), None, offers)
        except Exception:  # noqa
            continue
    offers = [(o, p) for o, p in offers if avail_code(o.get("availability"))]
    chosen = None
    target = norm_path(url)
    for o, p in offers:  # tikslus atitikmuo pagal nuorodą (Senukai: kelios spalvos viename puslapyje)
        if o.get("url") and norm_path(o["url"]) == target:
            chosen = (o, p)
            break
    if not chosen and offers:
        chosen = offers[0]
    name, price = "", None
    if chosen:
        o, p = chosen
        status = avail_code(o.get("availability"))
        name = str((p or {}).get("name") or "")
        price = o.get("price") or o.get("lowPrice")
    else:
        status = None
        m = re.search(r'itemprop=["\']availability["\'][^>]*(?:href|content)=["\']([^"\']+)', html, re.I) \
            or re.search(r'"availability"\s*:\s*"([^"]+)"', html)
        if m:
            status = avail_code(m.group(1))
    if not name:
        name = title_of(html)
    return status, unescape(name).strip()[:160], to_price(price), ""


def is_blocked(code, html):
    head = html[:8000]
    return (code in (403, 429, 503) or "Just a moment" in head or "cf-chl" in head or "challenge-platform" in head
            or "/errors/validateCaptcha" in html[:60000] or "Robot Check" in head)


def check_item(it):
    url = it["url"]
    try:
        code, html, final = fetch(url)
        it["http"] = code
        if is_blocked(code, html):
            return "blocked", "Parduotuvė blokuoja automatinį tikrinimą (apsauga nuo botų)", None, None
        if code >= 400:
            return "error", f"Parduotuvė atsakė klaida {code}", None, None
        status, name, price, note = parse_page(url, html)
        if final and norm_path(final) != norm_path(url):
            it["final_url"] = final
        if not status:
            return "unknown", note or "Puslapyje nepavyko rasti prekės būsenos", name, price
        return status, note, name, price
    except Exception as e:  # noqa
        return "error", f"Nepavyko pasiekti: {e}", None, None


def same_product(ref, name):
    """Ar puslapyje vis dar ta pati prekė (pvz. Otto nukreipia į pultelių įkroviklį)."""
    if not ref or not name:
        return True
    if is_target(ref):
        return is_target(name) and (colour_of(ref) in ("", colour_of(name)) or not colour_of(name))
    a = set(re.findall(r"[0-9a-ząčęėįšųūž]{2,}", ref.lower()))
    b = set(re.findall(r"[0-9a-ząčęėįšųūž]{2,}", name.lower()))
    return not a or not b or len(a & b) / min(len(a), len(b)) >= 0.5


def apply_result(it, status, err, name, price):
    s = STATE["settings"]
    prev = it["status"]
    t = now_ts()
    old_price = it.get("price")
    it["checked_at"] = t
    it["error"] = err
    if status in ("in", "pre", "out", "unknown") and name:
        if not it.get("ref_name"):
            it["ref_name"] = name
        elif not same_product(it["ref_name"], name):
            status, it["error"] = "changed", f"Puslapyje dabar kita prekė: „{name[:80]}“"
    if name and status != "changed":
        it["name"] = name
    if price is not None and status != "changed":
        it["price"] = price
    # kainos riba: yra, bet per brangu – rodom, bet neskambinam
    if status in AVAILABLE and it.get("max_price") and it.get("price") and it["price"] > it["max_price"]:
        status = "pricey"
    if status in ("in", "pre", "out", "unknown", "pricey", "changed"):
        it["fails"] = 0
    else:
        it["fails"] = it.get("fails", 0) + 1
    # blokuojamos – rečiau, kad neužsiblokuotų dar labiau
    wait = s["interval"] * 60
    if status == "blocked":
        wait = max(wait, 30 * 60)
    elif status == "error":
        wait = max(wait, 10 * 60)
    it["next_at"] = t + wait + random.uniform(0, 40)
    # techninės klaidos nekeičia paskutinės žinomos būsenos „yra/nėra“
    if status in ("blocked", "error") and prev in ("in", "pre", "out", "pricey"):
        it["probe"] = status
        return False
    it["probe"] = ""
    if status != prev:
        it["changed_at"] = t
        it["history"] = ([{"at": iso(t), "status": status, "price": it.get("price")}] + it.get("history", []))[:30]
        it["status"] = status
        if status in AVAILABLE and prev not in AVAILABLE:
            it["alerts"], it["last_alert"], it["muted"] = 0, 0, False
            return it.get("mode", "alert") == "alert"
        if status not in AVAILABLE:
            it["alerts"], it["muted"] = 0, False
    elif price is not None and old_price is not None and abs(price - old_price) >= 0.005:
        # būsena ta pati, bet pasikeitė kaina – irgi į istoriją
        it["history"] = ([{"at": iso(t), "status": status, "price": price, "old_price": old_price}] + it.get("history", []))[:30]
    return False


# ---------------------------------------------------------------- paieškos

A_RE = re.compile(r"<a\b([^>]*)>([\s\S]{0,1500}?)</a>", re.I)


def keep_query(url):
    """Iš paieškos nuorodos paliekam tik prekę identifikuojančius parametrus (pvz. Pigu ?id=)."""
    p = urlparse(url)
    q = [(k, v) for k, v in parse_qsl(p.query) if k.lower() in ("id", "pid", "product_id")]
    return urlunparse((p.scheme, p.netloc, p.path, "", urlencode(q), ""))


def parse_search(base, html):
    """Iš paieškos puslapio ištraukia (nuoroda, pavadinimas) poras, kurios atitinka GTA VI pultelį."""
    found = {}
    bh = host_of(base)
    for attrs, inner in A_RE.findall(html):
        hm = re.search(r'href=["\']([^"\']+)["\']', attrs)
        if not hm:
            continue
        tm = re.search(r'title=["\']([^"\']+)["\']', attrs)
        text = unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", inner))).strip()
        name = unescape(tm.group(1)).strip() if tm and len(tm.group(1)) > len(text) else text
        if not is_target(name):
            continue
        href = urljoin(base, unescape(hm.group(1)))
        if host_of(href) != bh:
            continue
        u = keep_query(href)
        if u not in found or len(name) > len(found[u]):
            found[u] = name[:160]
    return found


def check_search(sr):
    """Grąžina naujas rastas prekes [(url, name)]."""
    t = now_ts()
    sr["checked_at"] = t
    sr["next_at"] = t + SEARCH_EVERY + random.uniform(0, 60)
    try:
        code, html, _ = fetch(sr["url"])
        sr["http"] = code
        if is_blocked(code, html):
            sr["status"], sr["error"] = "blocked", "Paieška blokuojama"
            return []
        if code >= 400:
            sr["status"], sr["error"] = "error", f"Klaida {code}"
            return []
        found = parse_search(sr["url"], html)
    except Exception as e:  # noqa
        sr["status"], sr["error"] = "error", f"Nepavyko pasiekti: {e}"
        return []
    sr["status"], sr["error"], sr["found"] = "ok", "", len(found)
    have = {norm_path(it["url"]) for it in STATE["items"]} | {norm_path(it.get("final_url", "")) for it in STATE["items"]}
    new = [(u, n) for u, n in found.items() if norm_path(u) not in have and u not in sr.get("ignored", [])]
    return new


# ---------------------------------------------------------------- Home Assistant

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


SERVICES_CACHE = {"list": [], "at": 0, "error": ""}


def phone_services(force=False):
    if not SUPERVISOR_TOKEN:
        SERVICES_CACHE["error"] = "Nėra ryšio su Home Assistant (priedas paleistas ne HA viduje)"
        return []
    if not force and SERVICES_CACHE["list"] and now_ts() - SERVICES_CACHE["at"] < 300:
        return SERVICES_CACHE["list"]
    try:
        out = []
        for d in ha_request("GET", "/services") or []:
            if d.get("domain") == "notify":
                out += [n for n in d.get("services", {}) if n.startswith("mobile_app_")]
        SERVICES_CACHE.update(list=sorted(out), at=now_ts(), error="")
    except Exception as e:  # noqa
        SERVICES_CACHE["error"] = str(e)
    return SERVICES_CACHE["list"]


def target_services():
    chosen = STATE["settings"].get("services")
    all_ = phone_services()
    if chosen is None:
        return all_
    return [s for s in chosen if s in all_] or ([] if all_ else list(chosen))


def send_alert(title, message, url=None, tag="sekiklis", item_id=None, persistent=True, urgent=True):
    """Siunčia į visus pasirinktus telefonus ir (jei įjungta) į HA pranešimų skiltį.
    Grąžina (kiek telefonų gavo, klaidų sąrašas)."""
    services = target_services()
    errs = []
    data = {"tag": tag, "channel": "Sekiklis – prekė atsirado" if urgent else "Sekiklis",
            "importance": "high" if urgent else "default", "priority": "high", "ttl": 0,
            "vibrationPattern": "100, 400, 100, 400, 100, 400" if urgent else None}
    data = {k: v for k, v in data.items() if v is not None}
    if url:
        data["clickAction"] = url
        data["url"] = url
        acts = [{"action": "URI", "title": "🛒 Atidaryti", "uri": url}]
        if item_id is not None:
            acts.append({"action": f"{ACTION_PREFIX}MUTE_{item_id}", "title": "🔕 Nutildyti"})
        data["actions"] = acts
    ok = 0
    if not services:
        if SERVICES_CACHE["error"]:
            errs.append(SERVICES_CACHE["error"])
        elif SERVICES_CACHE["list"]:
            errs.append("Pasirinkti telefonai nebėra HA – ⚙️ Nustatymuose pažymėkite „Visi telefonai“")
        else:
            errs.append("Nerastas nė vienas telefonas su HA programėle")
    for svc in services:
        try:
            ha_request("POST", f"/services/notify/{svc}", {"title": title, "message": message, "data": data})
            ok += 1
        except Exception as e:  # noqa
            errs.append(f"{svc}: {e}")
    if persistent and STATE["settings"].get("persistent", True) and SUPERVISOR_TOKEN:
        try:
            msg = message + (f"\n\n[🛒 Atidaryti parduotuvę]({url})" if url else "")
            ha_request("POST", "/services/persistent_notification/create",
                       {"title": title, "message": msg, "notification_id": tag})
        except Exception as e:  # noqa
            errs.append(f"HA pranešimų skiltis: {e}")
    h = STATE["health"]
    if ok:
        h["last_send_ok"] = iso()
    if errs:
        h["last_send_err"] = iso() + " – " + "; ".join(errs)
        log("Pranešimo klaidos:", errs)
    elif ok:
        h["last_send_err"] = ""
    return ok, errs


def item_title(it):
    return it.get("custom_name") or it.get("name") or it["url"]


def alert_text(it, repeat=False):
    st = "Galima užsisakyti iš anksto" if it["status"] == "pre" else "YRA SANDĖLYJE"
    price = f", {it['price']:.2f} €".replace(".", ",") if it.get("price") else ""
    title = ("🔁 Vis dar yra: " if repeat else "🎮 Atsirado! ") + it["shop"]
    return title, f"{item_title(it)}\n{st}{price}. Spausk – atsidarys parduotuvė."


def fire_alert(it, repeat=False):
    title, msg = alert_text(it, repeat)
    ok, errs = send_alert(title, msg, url=it["url"], tag=f"sekiklis_{it['id']}", item_id=it["id"])
    it["alerts"] = it.get("alerts", 0) + 1
    it["last_alert"] = now_ts()
    log("Pranešimas:", title, item_title(it), f"telefonų: {ok}", ("klaidos: " + "; ".join(errs)) if errs else "")
    return ok, errs


def mute(item_id):
    with LOCK:
        for it in STATE["items"]:
            if it["id"] == item_id:
                it["muted"] = True
                save()
                log("Nutildyta:", item_title(it))
                return True
    return False


# ---------------------------------------------------------------- pagrindinis ciklas

def due_items():
    t = now_ts()
    return [it for it in STATE["items"] if it.get("enabled", True) and it.get("next_at", 0) <= t]


def checker_loop():
    last_host = {}
    while True:
        try:
            with LOCK:
                todo = [dict(id=it["id"], url=it["url"]) for it in due_items()]
            for d in todo:
                h = host_of(d["url"])
                gap = 4 - (now_ts() - last_host.get(h, 0))
                if gap > 0:
                    time.sleep(gap)
                RUNTIME["checking"] = d["id"]
                res = check_item(d)
                last_host[h] = now_ts()
                RUNTIME["checking"] = None
                with LOCK:
                    it = next((x for x in STATE["items"] if x["id"] == d["id"]), None)
                    if not it or it["url"] != d["url"]:
                        continue
                    became = apply_result(it, *res)
                    log("Patikrinta:", it["shop"], item_title(it)[:50], "→", it["status"],
                        f"({res[0]})" if res[0] != it["status"] else "")
                    if became:
                        fire_alert(it)
                    if it.get("announce") and it["status"] not in ("new",):
                        announce_new(it, became)
                    save()
            with LOCK:
                stodo = [dict(id=x["id"], url=x["url"]) for x in STATE["searches"]
                         if x.get("enabled", True) and x.get("next_at", 0) <= now_ts()]
            for d in stodo:
                h = host_of(d["url"])
                gap = 4 - (now_ts() - last_host.get(h, 0))
                if gap > 0:
                    time.sleep(gap)
                with LOCK:
                    sr = next((x for x in STATE["searches"] if x["id"] == d["id"]), None)
                    if not sr:
                        continue
                    new = check_search(sr)
                    last_host[h] = now_ts()
                    log("Paieška:", sr["shop"], "→", sr["status"], f"rasta {sr.get('found', 0)}, naujų {len(new)}")
                    for u, n in new:
                        add_discovered(sr, u, n)
                    save()
            with LOCK:
                repeat_alerts()
                watchdog()
                save()
        except Exception as e:  # noqa
            log("Tikrinimo ciklo klaida:", e)
            RUNTIME["checking"] = None
        WAKE.wait(5)
        WAKE.clear()


def add_discovered(sr, url, name):
    """Paieškoje rasta nauja prekė: įtraukiam į sekimą ir pranešam (jei ne baltas brangiau nei riba)."""
    it = new_item(url, name=name, source="search", ref_name=name)
    if colour_of(name) == "white":
        it["max_price"] = WHITE_LIMIT
    STATE["items"].append(it)
    sr.setdefault("added", []).insert(0, {"at": iso(), "url": url, "name": name})
    sr["added"] = sr["added"][:20]
    log("Rasta nauja prekė:", sr["shop"], name)
    it["announce"] = True  # pranešim po pirmo tikrinimo, kai žinosim kainą
    WAKE.set()


def announce_new(it, became):
    """Pirmas naujos (paieškoje rastos) prekės patikrinimas: ar verta apie ją pranešti."""
    it["announce"] = False
    if became:  # jau išsiųstas skubus „Atsirado!“
        return
    lim = it.get("max_price")
    if it["status"] in ("pricey", "changed", "blocked", "error"):
        return
    if lim and (it.get("price") is None or it["price"] > lim):
        return
    price = f", {it['price']:.2f} €".replace(".", ",") if it.get("price") else ""
    st = {"out": "Kol kas nėra", "unknown": "Būsena neaiški"}.get(it["status"], "")
    send_alert(f"🆕 Nauja prekė: {it['shop']}", f"{item_title(it)}{price}\n{st} – įtraukta į sekimą.",
               url=it["url"], tag=f"sekiklis_new_{it['id']}", urgent=False)


def repeat_alerts():
    s = STATE["settings"]
    t = now_ts()
    for it in STATE["items"]:
        if (it["status"] in AVAILABLE and it.get("enabled", True) and not it.get("muted")
                and it.get("mode", "alert") == "alert"
                and it.get("alerts", 0) < s["repeat_max"] and t - it.get("last_alert", 0) >= s["repeat_every"] * 60):
            fire_alert(it, repeat=it.get("alerts", 0) > 0)


def watchdog():
    """Jei visos tikrinamos (neblokuojamos) parduotuvės > 30 min. nepasiekiamos – pranešti vieną kartą."""
    if not STATE["settings"].get("watchdog", True):
        return
    t = now_ts()
    if t - RUNTIME["started"] < 1800:
        return
    live = [it for it in STATE["items"] if it.get("enabled", True) and it["status"] != "blocked"]
    if not live:
        return
    recent_ok = [it for it in live if it.get("fails", 0) == 0 and t - it.get("checked_at", 0) < 1800]
    h = STATE["health"]
    if recent_ok:
        if h.get("watchdog_sent"):
            h["watchdog_sent"] = ""
            send_alert("✅ Sekiklis vėl veikia", "Parduotuvės vėl tikrinamos.", tag="sekiklis_watchdog",
                       persistent=False, urgent=False)
        return
    if not h.get("watchdog_sent"):
        h["watchdog_sent"] = iso()
        send_alert("⚠️ Sekiklis neveikia",
                   "Jau 30 min. nepavyksta patikrinti nė vienos parduotuvės. Atidaryk Sekiklį ir pažiūrėk klaidas.",
                   tag="sekiklis_watchdog", urgent=False)


class MiniWS:
    """Paprastas WebSocket klientas (pranešimų mygtukų paspaudimams gauti)."""

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
            if ws.recv().get("type") != "auth_ok":
                raise ConnectionError("Nepavyko prisijungti prie Home Assistant")
            ws.send({"id": 1, "type": "subscribe_events", "event_type": "mobile_app_notification_action"})
            RUNTIME["ws"] = True
            log("Laukiama pranešimų mygtukų paspaudimų")
            while True:
                m = ws.recv()
                if m.get("type") == "event":
                    a = ((m.get("event") or {}).get("data") or {}).get("action", "")
                    mm = re.match(ACTION_PREFIX + r"MUTE_(\d+)$", a or "")
                    if mm:
                        mute(int(mm.group(1)))
        except Exception as e:  # noqa
            RUNTIME["ws"] = False
            log("Ryšys su HA nutrūko:", e)
            time.sleep(20)


# ---------------------------------------------------------------- API veiksmai

def find(item_id):
    for it in STATE["items"]:
        if it["id"] == int(item_id):
            return it
    raise ValueError("Prekė nerasta")


def act_add(d):
    url = clean_url(d.get("url"))
    if any(it["url"] == url for it in STATE["items"]):
        raise ValueError("Ši nuoroda jau sekama")
    it = new_item(url)
    STATE["items"].append(it)
    WAKE.set()
    return {"id": it["id"]}


def act_update(d):
    it = find(d.get("id"))
    if "custom_name" in d:
        it["custom_name"] = str(d["custom_name"] or "").strip()[:160]
    if "enabled" in d:
        it["enabled"] = bool(d["enabled"])
        if it["enabled"]:
            it["next_at"] = 0
            WAKE.set()
    if "muted" in d:
        it["muted"] = bool(d["muted"])
    if "mode" in d:
        it["mode"] = "watch" if d["mode"] == "watch" else "alert"
    if "max_price" in d:
        mp = to_price(d["max_price"])
        it["max_price"] = mp if mp and mp > 0 else None
        # perskaičiuojam būseną pagal naują ribą (be naujo tikrinimo)
        if it["status"] in ("pricey", "in", "pre"):
            it["next_at"] = 0
            WAKE.set()
    if d.get("accept_name"):
        it["ref_name"] = it.get("name", "")
        it["next_at"] = 0
        WAKE.set()
    return {}


def act_search_update(d):
    sr = next((x for x in STATE["searches"] if x["id"] == int(d.get("id"))), None)
    if not sr:
        raise ValueError("Paieška nerasta")
    if "enabled" in d:
        sr["enabled"] = bool(d["enabled"])
        sr["next_at"] = 0
        WAKE.set()
    if d.get("check"):
        sr["next_at"] = 0
        WAKE.set()
    return {}


def act_delete(d):
    it = find(d.get("id"))
    STATE["items"].remove(it)
    if it.get("source") == "search":  # kad paieška jos vėl nepridėtų
        for sr in STATE["searches"]:
            if sr["shop"] == it["shop"]:
                sr.setdefault("ignored", []).append(it["url"])
    return {}


def act_check_now(d):
    for it in STATE["items"]:
        if d.get("id") in (None, it["id"]) and it.get("enabled", True):
            it["next_at"] = 0
    if d.get("id") is None:
        for sr in STATE["searches"]:
            sr["next_at"] = 0
    WAKE.set()
    return {}


def act_settings(d):
    s = STATE["settings"]
    if "interval" in d:
        s["interval"] = max(3, min(120, int(d["interval"])))
        for it in STATE["items"]:
            it["next_at"] = min(it.get("next_at", 0), now_ts() + s["interval"] * 60)
    if "services" in d:
        s["services"] = None if d["services"] is None else [str(x) for x in d["services"]]
    for k in ("persistent", "watchdog"):
        if k in d:
            s[k] = bool(d[k])
    if "repeat_every" in d:
        s["repeat_every"] = max(2, min(120, int(d["repeat_every"])))
    if "repeat_max" in d:
        s["repeat_max"] = max(1, min(30, int(d["repeat_max"])))
    return {}


def act_test(d):
    ok, errs = send_alert("🎮 Bandomasis pranešimas",
                          "Taip atrodys pranešimas, kai prekė atsiras. Paspaudus atsidarys parduotuvė.",
                          url="https://www.senukai.lt", tag="sekiklis_test", item_id=None, persistent=bool(d.get("persistent")))
    STATE["health"]["last_test"] = iso()
    if not ok:
        raise ValueError("Pranešimas neišsiųstas: " + "; ".join(errs))
    return {"sent": ok, "errors": errs}


def act_simulate(d):
    """Imituoja prekės atsiradimą: siunčia tikrą „Atsirado!“ pranešimą (be būsenos keitimo)."""
    it = find(d.get("id"))
    title, msg = alert_text(dict(it, status="in"))
    ok, errs = send_alert("🧪 BANDYMAS – " + title, msg, url=it["url"], tag=f"sekiklis_sim_{it['id']}",
                          item_id=it["id"])
    STATE["health"]["last_test"] = iso()
    if not ok:
        raise ValueError("Pranešimas neišsiųstas: " + "; ".join(errs))
    return {"sent": ok, "errors": errs}


ACTIONS = {"add": act_add, "update": act_update, "delete": act_delete, "check_now": act_check_now,
           "settings": act_settings, "test": act_test, "simulate": act_simulate, "search_update": act_search_update}


def public_state():
    t = now_ts()
    return {"items": STATE["items"], "searches": STATE["searches"], "settings": STATE["settings"],
            "health": STATE["health"], "now": t, "version": VERSION,
            "checking": RUNTIME["checking"], "ws": RUNTIME["ws"], "ha": bool(SUPERVISOR_TOKEN),
            "phones": phone_services(), "all_phones_error": SERVICES_CACHE["error"],
            "targets": target_services()}


# ---------------------------------------------------------------- HTTP

MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json", ".json": "application/json"}


class Handler(BaseHTTPRequestHandler):
    server_version = "Sekiklis/1.0"

    def log_message(self, fmt, *args):
        if os.environ.get("DEBUG"):
            super().log_message(fmt, *args)

    def authed(self):
        if not PIN or self.client_address[0] == INGRESS_IP:
            return True
        c = SimpleCookie(self.headers.get("Cookie", ""))
        return "sekiklis_auth" in c and secrets.compare_digest(c["sekiklis_auth"].value, AUTH_TOKEN)

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

    def static(self, rel):
        rel = rel or "index.html"
        path = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not path.startswith(STATIC_DIR) or not os.path.isfile(path):
            path = os.path.join(STATIC_DIR, "index.html")
        with open(path, "rb") as f:
            self.send(200, f.read(), MIME.get(os.path.splitext(path)[1], "application/octet-stream"))

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
                    return self.send(200, public_state())
            return self.static(path)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as e:  # noqa
            return self.send(500, {"error": str(e)})

    def do_POST(self):
        path = unquote(urlparse(self.path).path).lstrip("/")
        try:
            n = min(int(self.headers.get("Content-Length") or 0), 200_000)
            d = json.loads(self.rfile.read(n).decode("utf-8") or "{}") if n else {}
            if path == "api/login":
                if PIN and secrets.compare_digest(str(d.get("pin", "")), PIN):
                    return self.send(200, {"ok": True}, extra={
                        "Set-Cookie": f"sekiklis_auth={AUTH_TOKEN}; Path=/; Max-Age=31536000; SameSite=Lax"})
                return self.send(403, {"error": "Neteisingas PIN"})
            if not self.authed():
                return self.send(401, {"error": "Reikia PIN"})
            if path.startswith("api/do/"):
                fn = ACTIONS.get(path[len("api/do/"):])
                if not fn:
                    return self.send(404, {"error": "Nežinomas veiksmas"})
                if fn in (act_test, act_simulate):
                    phone_services(force=True)
                with LOCK:
                    res = fn(d) or {}
                    save()
                    res["state"] = public_state()
                return self.send(200, res)
            return self.send(404, {"error": "Nerasta"})
        except ValueError as e:
            return self.send(400, {"error": str(e)})
        except Exception as e:  # noqa
            return self.send(500, {"error": f"Klaida: {e}"})


def main():
    load_state()
    threading.Thread(target=checker_loop, daemon=True).start()
    if SUPERVISOR_TOKEN:
        threading.Thread(target=action_listener, daemon=True).start()
        phone_services(force=True)
        log("Rasti telefonai:", ", ".join(SERVICES_CACHE["list"]) or "nėra", SERVICES_CACHE["error"])
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log(f"Sekiklis veikia per prievadą {PORT}. Sekama prekių: {len(STATE['items'])}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
