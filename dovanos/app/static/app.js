/* Dovanos – dovanų idėjų ir progų programa */
'use strict';

// ============================================================ pagalbinės
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
let S = null;   // visa būsena iš serverio
let I = {};     // id -> įrašas kiekvienai lentelei
const UI = (() => { try { return JSON.parse(localStorage.getItem('dovanos_ui') || '{}'); } catch (e) { return {}; } })();
function saveUI() { try { localStorage.setItem('dovanos_ui', JSON.stringify(UI)); } catch (e) { } }

const MONTHS_G = ['sausio', 'vasario', 'kovo', 'balandžio', 'gegužės', 'birželio', 'liepos', 'rugpjūčio', 'rugsėjo', 'spalio', 'lapkričio', 'gruodžio'];
const DAYS = ['sekmadienis', 'pirmadienis', 'antradienis', 'trečiadienis', 'ketvirtadienis', 'penktadienis', 'šeštadienis'];

const KINDS = {
  christmas: { name: 'Kalėdos', icon: '🎄' },
  birthday: { name: 'Gimtadienis', icon: '🎂' },
  easter: { name: 'Velykos', icon: '🐣' },
  mother: { name: 'Mamos diena', icon: '🌷' },
  father: { name: 'Tėčio diena', icon: '👔' },
  midsummer: { name: 'Joninės', icon: '🌿' },
  valentine: { name: 'Valentino diena', icon: '💝' },
  other: { name: 'Kita proga', icon: '🎁' },
};
const HOLIDAYS = ['christmas', 'easter', 'mother', 'father', 'midsummer', 'valentine'];
const STATUS = {
  idea: { icon: '💡', name: 'Idėja' },
  ordered: { icon: '📦', name: 'Užsakyta' },
  bought: { icon: '✓', name: 'Nupirkta' },
  wrapped: { icon: '🎀', name: 'Supakuota' },
  given: { icon: '🎁', name: 'Įteikta' },
};
// paspaudus ženkliuką – kitas žingsnis; ties „Įteikta“ sustoja (atgal – tik dovanos lange)
const NEXT_STATUS = { idea: 'bought', ordered: 'bought', bought: 'wrapped', wrapped: 'given' };
// progai priskirta, bet nenupirkta dovana – „🛒 Reikia nupirkti“; 💡 – tik laukiančios idėjos
const TODO = { icon: '🛒', name: 'Reikia nupirkti' };
const stOf = g => g.occasion_id && g.status === 'idea' ? TODO : (STATUS[g.status] || STATUS.idea);
const stName = (k, inOcc) => inOcc && k === 'idea' ? TODO : STATUS[k];
// pastelinės žmonių (pusių) spalvos
const COLORS = { blue: ['#7fb2e5', 'Mėlyna'], pink: ['#eea3c4', 'Rožinė'], green: ['#8fcf9f', 'Žalia'], yellow: ['#e8cc6e', 'Geltona'],
  purple: ['#b9a3e3', 'Violetinė'], orange: ['#f2b183', 'Oranžinė'], teal: ['#7fcdc8', 'Žydra'], gray: ['#b8b0a8', 'Pilka'] };
const groupsOf = pid => (S.members || []).filter(m => m.person_id === pid).map(m => I.people[m.group_id]).filter(Boolean).sort((a, b) => lt(a.name, b.name));
const membersOf = gid => (S.members || []).filter(m => m.group_id === gid).map(m => I.people[m.person_id]).filter(Boolean).sort((a, b) => lt(a.name, b.name));
// žmogaus spalva; jei savos nėra – pirmos spalvotos grupės
const pcolor = pid => { const p = I.people?.[pid]; if (!p) return ''; const c = p.color || groupsOf(pid).find(g => g.color)?.color; return COLORS[c]?.[0] || ''; };
const pLabel = p => (p.is_group ? '👥 ' : '') + p.name;
const pcCls = pid => pcolor(pid) ? 'pcol' : '';
const pcSty = pid => pcolor(pid) ? `style="--pc:${pcolor(pid)}"` : '';
// būsima data – žalia, praėjusi – blanki
const dcls = d => !d ? '' : d < T() ? 'd-past' : 'd-future';
// žmogus / grupė – užpildytas ženkliukas (jo spalva), proga – kitos spalvos rėmelis
const tagP = (pid, pre = '') => { const p = I.people?.[pid]; return p ? `<span class="tg p" ${pcSty(pid)}>${pre}${esc(p.name)}</span>` : ''; };
const tagO = txt => txt ? `<span class="tg o">${esc(txt)}</span>` : '';
const tagT = txt => txt ? `<span class="tg t">${esc(txt)}</span>` : '';
const thumb = (photo, cls = '') => photo ? `<img class="th ${cls}" src="photos/${esc(photo)}" alt="" loading="lazy">` : '';
// ikonos (linijinės, kaip įprastose programėlėse)
const svg = (d, w = 1.9) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 3.2),
  more: '<svg class="i" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
  archive: svg('<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10h14V9M10 13h4"/>'),
  unarchive: svg('<path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-2"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>', 2),
};
// žmogaus inicialai spalvotame apskritime (spalva – žmogaus ar jo grupės)
const initials = n => { const w = String(n || '?').replace(/[„“"()]/g, '').split(/\s+/).filter(Boolean); return w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] || '?').slice(0, 2); };
const ava = (pid, cls = '') => { const p = I.people?.[pid]; return `<span class="ava ${cls}" ${pcSty(pid)}>${esc(initials(p?.name))}</span>`; };
const prof = p => { try { return JSON.parse(p?.profile || '{}') || {}; } catch (e) { return {}; } };

function toast(msg, action, ms = 3200) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  if (action) $('button', t).onclick = () => { t.hidden = true; action.fn(); };
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms);
}

async function api(path, data) {
  const opt = data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  let r;
  try { r = await fetch(path, opt); } catch (e) { toast('Nėra ryšio su serveriu'); throw e; }
  if (r.status === 401) { location.href = 'login.html'; throw new Error('auth'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || 'Klaida'); throw new Error(j.error || r.status); }
  return j;
}
async function act(name, data, noRender) { const res = await api('api/do/' + name, data || {}); await load(noRender); return res; }
const saveRow = (t, row, noRender) => act('save', { t, row }, noRender);
const delRow = (t, id) => act('delete', { t, id });

async function load(noRender) {
  S = await api('api/state');
  I = {};
  for (const k of Object.keys(S)) if (Array.isArray(S[k])) { I[k] = {}; S[k].forEach(r => I[k][r.id] = r); }
  if (!noRender) render();
}

// sinchronizacija tarp įrenginių
setInterval(async () => {
  if (!S || document.hidden || !$('#sheet').hidden || isTyping()) return;
  try {
    const v = await (await fetch('api/version')).json();
    if (v.version !== S.version) { const y = scrollY; await load(); scrollTo(0, y); }
  } catch (e) { }
}, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S && $('#sheet').hidden && !isTyping()) load().catch(() => { }); });
const isTyping = () => { const a = document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.value; };

// ---- datos ir skaičiai
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ds = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const T = () => S.today;
const Y = () => +S.today.slice(0, 4);
const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ds(d); };
const niceDate = (s, withYear) => { if (!s) return ''; const d = pd(s); return `${withYear ? d.getFullYear() + ' m. ' : ''}${MONTHS_G[d.getMonth()]} ${d.getDate()} d.`; };
const mdNice = md => { if (!md) return ''; const [m, d] = md.split('-').map(Number); return `${MONTHS_G[m - 1]} ${d} d.`; };
function until(s) {
  const n = diffDays(T(), s);
  if (n === 0) return 'šiandien';
  if (n === 1) return 'rytoj';
  if (n === -1) return 'vakar';
  return n < 0 ? 'prieš ' + span(s, T()) : 'po ' + span(T(), s);
}
// kalendorinis skirtumas: 25 d. / 1 mėn. 22 d. / 1 m. 5 mėn.
function addMonthsD(d, n) { const r = new Date(d.getFullYear(), d.getMonth() + n, 1); r.setDate(Math.min(d.getDate(), new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate())); return r; }
function span(a, b) {
  const A = pd(a), B = pd(b);
  let m = (B.getFullYear() - A.getFullYear()) * 12 + B.getMonth() - A.getMonth();
  if (addMonthsD(A, m) > B) m--;
  const d = Math.round((B - addMonthsD(A, m)) / 86400000);
  if (m <= 0) return `${d} d.`;
  if (m < 12) return `${m} mėn.${d ? ` ${d} d.` : ''}`;
  return `${Math.floor(m / 12)} m.${m % 12 ? ` ${m % 12} mėn.` : ''}`;
}
// kiek sukaks tų metų gimtadienį – „(37 m.)“ datos gale; jubiliejus (kas 5 m.) paryškintas
const ageAt = (pid, year) => { const by = I.people[pid]?.birth_year; return by && year > by ? year - by : null; };
function ageBadge(pid, year) {
  const a = ageAt(pid, year);
  if (!a) return '';
  return ` <span class="age ${a % 5 === 0 ? 'jub' : ''}">(${a % 5 === 0 ? '🎉 ' : ''}${a} m.)</span>`;
}
function fmtNum(n, dec = 2) {
  if (n == null || n === '' || isNaN(n)) return '';
  return (Math.round(n * 10 ** dec) / 10 ** dec).toFixed(dec).replace('.', ',');
}
const pnum = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/\s|€/g, '').replace(',', '.')); return isNaN(n) ? null : n; };
const money = v => v == null || v === '' ? '' : fmtNum(v) + ' €';
const moneyShort = v => { if (!v) return '0 €'; return (Math.round(v) === Math.round(v * 100) / 100 ? String(Math.round(v)) : fmtNum(v)) + ' €'; };
const lt = (a, b) => String(a || '').localeCompare(String(b || ''), 'lt', { sensitivity: 'base' });

// ---- šventinių dienų datos
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return ds(new Date(y, month - 1, day));
}
function firstSunday(y, m) { const d = new Date(y, m - 1, 1); d.setDate(1 + (7 - d.getDay()) % 7); return ds(d); }
function mdInYear(md, y) {
  if (!md) return '';
  let [m, d] = md.split('-').map(Number);
  if (m === 2 && d === 29 && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) d = 28;
  return ds(new Date(y, m - 1, d));
}
function kindDate(kind, y, person) {
  switch (kind) {
    case 'christmas': return `${y}-12-24`;
    case 'easter': return easter(y);
    case 'mother': return firstSunday(y, 5);
    case 'father': return firstSunday(y, 6);
    case 'midsummer': return `${y}-06-24`;
    case 'valentine': return `${y}-02-14`;
    case 'birthday': return person ? mdInYear(person.birthday, y) : '';
  }
  return '';
}
const occDate = o => o.kind === 'other' ? (o.date || '') : kindDate(o.kind, o.year, I.people[o.person_id]);
const occName = o => o.kind === 'birthday' ? `${I.people[o.person_id]?.name || '?'} gimtadienis`
  : o.kind === 'other' ? (o.title || KINDS.other.name) : KINDS[o.kind]?.name || o.kind;
const occTitle = o => `${occName(o)} ${o.year}`;
const occIcon = o => KINDS[o.kind]?.icon || '🎁';

// ============================================================ duomenų išvestinės
const people = (all) => S.people.filter(p => all || !p.archived).sort((a, b) => lt(a.name, b.name));
const pname = id => I.people[id]?.name || '';
const giftsOf = oid => S.gifts.filter(g => g.occasion_id === oid).sort((a, b) => a.pos - b.pos || a.id - b.id);
const recipientsOf = oid => S.recipients.filter(r => r.occasion_id === oid && I.people[r.person_id]).sort((a, b) => a.pos - b.pos || a.id - b.id);
const freeIdeas = pid => S.gifts.filter(g => !g.occasion_id && g.status === 'idea' && (pid === undefined ? !I.people[g.person_id]?.archived : g.person_id === pid))
  .sort((a, b) => b.id - a.id);
const spent = gifts => gifts.filter(g => g.status !== 'idea').reduce((s, g) => s + (g.price || 0), 0);
const planned = gifts => gifts.filter(g => g.status === 'idea').reduce((s, g) => s + (g.price || 0), 0);
function counts(gifts) {
  const c = { idea: 0, ordered: 0, bought: 0, wrapped: 0, given: 0 };
  gifts.forEach(g => c[g.status] = (c[g.status] || 0) + 1);
  return c;
}
function countPills(gifts) {
  const c = counts(gifts), out = [];
  if (c.idea) out.push(`<span class="pill gold">🛒 ${c.idea}</span>`);
  if (c.ordered) out.push(`<span class="pill">📦 ${c.ordered}</span>`);
  if (c.bought + c.wrapped) out.push(`<span class="pill ok">✓ ${c.bought + c.wrapped}</span>`);
  if (c.given) out.push(`<span class="pill">🎁 ${c.given}</span>`);
  return out.join(' ');
}

// būsimos progos (ir jau sukurtos, ir dar ne) per artimiausias `days` dienas
function upcoming(days) {
  const from = addDays(T(), -1), to = addDays(T(), days), out = [];
  const add = (kind, year, date, person_id, occ, title) => {
    if (!date || date < from || date > to) return;
    out.push({ kind, year, date, person_id: person_id || null, occ, title });
  };
  for (const y of [Y(), Y() + 1]) {
    for (const k of S.settings.holidays || []) {
      if (k === 'birthday' || k === 'other') continue;
      add(k, y, kindDate(k, y), null, S.occasions.find(o => o.kind === k && o.year === y));
    }
    for (const p of people()) {
      if (!p.birthday || p.is_group) continue;
      add('birthday', y, mdInYear(p.birthday, y), p.id, S.occasions.find(o => o.kind === 'birthday' && o.year === y && o.person_id === p.id));
    }
  }
  // jau sukurtos progos (ir tos, kurių šventė nustatymuose išjungta)
  for (const o of S.occasions) if (o.kind !== 'birthday') add(o.kind, o.year, occDate(o), null, o);
  const seen = new Set();
  return out.filter(e => { const k = e.occ ? 'o' + e.occ.id : e.kind + e.year + e.person_id; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.date.localeCompare(b.date));
}
const eventName = e => e.occ ? occName(e.occ) : e.kind === 'birthday' ? `${pname(e.person_id)} gimtadienis` : KINDS[e.kind].name;

async function openEvent(e) {
  if (e.occ) return go('occ/' + e.occ.id);
  const r = await act('occasion_open', { kind: e.kind, year: e.year, person_id: e.person_id }, true);
  go('occ/' + r.id);
}

// ============================================================ navigacija
let route = [];
function go(h) { if (location.hash === '#' + h) render(); else location.hash = h; }
window.addEventListener('hashchange', () => { closeSheet(); render(); scrollTo(0, 0); });
$('#back').onclick = () => history.length > 1 ? history.back() : go('soon');

function setTop(title, actions = '', back = false) {
  $('#title').textContent = title;
  document.title = title === 'Dovanos' ? 'Dovanos' : title + ' · Dovanos';
  $('#top-actions').innerHTML = actions;
  $('#back').hidden = !back;
}

const VIEWS = {};
function render() {
  if (!S) return;
  route = (location.hash.slice(1) || 'soon').split('/');
  const name = VIEWS[route[0]] ? route[0] : 'soon';
  const tab = { occ: 'occs', person: 'people', merge: 'people' }[name] || name;
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  // ＋ mygtukas: žmonių skiltyje – naujas žmogus, kitur – nauja idėja
  $('#fab').hidden = !['soon', 'ideas', 'people', 'person'].includes(name);
  $('#fab-l').textContent = name === 'people' ? 'Žmogus' : 'Idėja';
  view.classList.toggle('wide', ['stats', 'settings', 'merge', 'occs'].includes(name));
  view.classList.toggle('full', ['occ', 'ideas'].includes(name) && DESK());
  CL = [];
  VIEWS[name](route[1]);
  sideEvents();
}

// ============================================================ KOMPIUTERIS (platus ekranas)
// Kompiuteryje: kairėje – artėjančios progos, progos lange – lenta (gavėjai stulpeliais) ir idėjų skydelis.
const DESK_MQ = matchMedia('(min-width: 1100px)');
const DESK = () => DESK_MQ.matches;
DESK_MQ.addEventListener?.('change', () => render());
const MON_S = ['Sau', 'Vas', 'Kov', 'Bal', 'Geg', 'Bir', 'Lie', 'Rgp', 'Rgs', 'Spa', 'Lap', 'Grd'];
const calTile = date => { const d = pd(date); return `<span class="calt"><small>${MON_S[d.getMonth()]}</small><b>${d.getDate()}</b></span>`; };
function sideEvents() {
  const box = $('#side-ev');
  if (!box) return;
  if (!DESK()) { box.innerHTML = ''; return; }
  const ev = upcoming(S.settings.ahead_days || 60).slice(0, 12);
  const cur = route[0] === 'occ' ? +route[1] : null;
  box.innerHTML = ev.length ? `<div class="side-h">Artėja</div>` + ev.map((e, i) => {
    const st = occStatus(e.occ, e.kind, e.person_id || e.occ?.person_id);
    return `<div class="sev ${e.occ && e.occ.id === cur ? 'on' : ''}" data-sev="${i}" role="button" tabindex="0">${calTile(e.date)}
      <span class="grow"><span class="t">${esc(eventName(e))}</span><span class="s">${until(e.date)}${st.todo ? ` · <b class="todo">nupirkti ${st.todo}</b>` : ''}</span></span></div>`;
  }).join('') : '';
  if ($('.sev.on', box)) $('#tabs a[data-tab="occs"]')?.classList.remove('on');  // atidaryta proga jau pažymėta „Artėja“ sąraše
  $$('[data-sev]', box).forEach(a => {
    a.onclick = () => openEvent(ev[+a.dataset.sev]);
    a.onkeydown = e => { if (e.key === 'Enter') a.click(); };
  });
}
// „Knyga 15“, „Knyga 15,90“, „Knyga 15 €“ → pavadinimas ir kaina (iki 4 skaitmenų, kad „Lego 42115“ liktų pavadinimu)
function boardPrice(text) {
  const m = text.trim().match(/^(.*?\S)\s+(\d{1,4}(?:[.,]\d{1,2})?)\s*€?$/);
  return m ? { title: m[1], price: pnum(m[2]) } : { title: text.trim(), price: null };
}
function boardCol(o, r, list) {
  const pid = r ? r.person_id : null;
  const tot = list.reduce((s, g) => s + (g.price || 0), 0);
  const canRemove = r && !(o.kind === 'birthday' && o.person_id === pid);
  return `<div class="bcol" ${r ? `data-col="${pid}"` : ''}>
    <div class="bh ${list.length ? '' : 'none'}">${r ? ava(pid, 'sm') : ''}${r ? `<a class="nm" href="#person/${pid}">${esc(pname(pid))}</a>` : '<span class="nm">Kiti (be gavėjo)</span>'}
      <span class="tot">${list.length ? (tot ? money(tot) : '') : 'Be dovanos'}</span>${canRemove ? `<button class="icon-btn" data-rmrec="${r.id}" title="Pašalinti iš šios progos">${IC.x}</button>` : ''}</div>
    ${list.length ? `<div class="list">${list.map(g => giftLi(g)).join('')}</div>` : ''}
    ${r ? `<input type="text" class="bq" id="bq-${pid}" data-bq="${pid}" placeholder="+ Dovana, pvz. Knyga 15" autocomplete="off" title="Įrašykite ir spauskite Enter">` : ''}
  </div>`;
}
// idėjų skydelis dešinėje: pirmiau – šios progos gavėjų ir šiai šventei tinkančios
function ideaPanelList(o, recs) {
  const rp = new Set(recs.map(r => r.person_id)), ck = catKey(o);
  const q = (UI.bpq || '').trim().toLowerCase();
  const cs = clusters(freeIdeas()).filter(c => !q || [c.gifts[0].title, c.gifts[0].shop, namesOf(c)].join(' ').toLowerCase().includes(q));
  const fits = c => c.pids.some(p => rp.has(p)) || c.gifts[0].cat === ck;
  const li = c => {
    const i = CL.push(c) - 1, g = c.gifts[0];
    const meta = [c.pids.map(pname).join(', '), g.cat && g.cat !== ck ? catLabel(g.cat) : ''].filter(Boolean).join(' · ');
    return `<div class="li" data-bi="${i}" draggable="true" title="Tempkite į žmogaus stulpelį">${thumb(g.photo)}<div class="grow"><div class="t">${esc(g.title)}</div>${meta ? `<div class="s">${esc(meta)}</div>` : ''}</div>${g.price != null ? `<span class="end">${money(g.price)}</span>` : ''}</div>`;
  };
  const a = cs.filter(fits), b = cs.filter(c => !fits(c));
  if (!cs.length) return `<div class="empty small">${q ? 'Nerasta' : 'Idėjų nėra'}</div>`;
  return (a.length ? `<div class="lbl-s">Šiai progai</div><div class="list">${a.map(li).join('')}</div>` : '')
    + (b.length ? `<div class="lbl-s">${a.length ? 'Kitos idėjos' : 'Idėjos'}</div><div class="list">${b.map(li).join('')}</div>` : '');
}
// idėja nutempta į žmogaus stulpelį: jo (ar be gavėjo) kopija perkeliama į progą, kitaip sukuriama nauja
async function takeIdea(c, o, pid) {
  const g0 = c.gifts[0];
  const own = c.gifts.find(g => g.person_id === pid) || c.gifts.find(g => !g.person_id);
  let undo;
  if (own) {
    const prev = { id: own.id, occasion_id: null, person_id: own.person_id };
    await saveRow('gifts', { id: own.id, occasion_id: o.id, person_id: pid });
    undo = () => saveRow('gifts', prev);
  } else {
    const r = await saveRow('gifts', { title: g0.title, price: g0.price, shop: g0.shop, url: g0.url, note: g0.note, photo: g0.photo || '', cat: g0.cat || '', status: 'idea', occasion_id: o.id, person_id: pid });
    undo = () => delRow('gifts', r.id);
  }
  toast(`${g0.title} → ${pname(pid)}`, { label: 'Atšaukti', fn: undo }, 4000);
}
function bindBoard(o, recs, past) {
  const panel = $('#bp-list');
  const bindPanel = () => $$('[data-bi]', panel).forEach(el => {
    el.onclick = () => ideaSheet(CL[+el.dataset.bi]);
    el.ondragstart = e => { e.dataTransfer.setData('text/plain', 'bi:' + el.dataset.bi); e.dataTransfer.effectAllowed = 'move'; document.body.classList.add('dragging'); };
    el.ondragend = () => { document.body.classList.remove('dragging'); $$('.bcol.drop').forEach(x => x.classList.remove('drop')); };
  });
  bindPanel();
  $('#bpq').oninput = () => { UI.bpq = $('#bpq').value; saveUI(); CL = []; panel.innerHTML = ideaPanelList(o, recs); bindPanel(); };
  $$('[data-col]', view).forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add('drop'); };
    col.ondragleave = e => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); };
    col.ondrop = async e => {
      e.preventDefault(); col.classList.remove('drop');
      const m = (e.dataTransfer.getData('text/plain') || '').match(/^bi:(\d+)$/);
      if (m && CL[+m[1]]) await takeIdea(CL[+m[1]], o, +col.dataset.col);
    };
  });
  $$('[data-bq]', view).forEach(inp => inp.onkeydown = async e => {
    if (e.key === 'Escape') { inp.value = ''; inp.blur(); return; }
    if (e.key !== 'Enter' || !inp.value.trim()) return;
    const pid = +inp.dataset.bq, { title, price } = boardPrice(inp.value);
    inp.value = '';
    await saveRow('gifts', { title, price, person_id: pid, occasion_id: o.id, status: past ? 'given' : 'idea' });
    $('#bq-' + pid)?.focus();
  });
}

// ============================================================ apatinis langas
function openSheet(html, mount) {
  $('#sheet').innerHTML = `<div class="grab"></div>${html}`;
  $('#sheet').hidden = $('#sheet-bg').hidden = false;
  $('#sheet').scrollTop = 0;
  if (mount) mount($('#sheet'));
  const f = $('#sheet [autofocus]');
  if (f) setTimeout(() => f.focus(), 60);
}
function closeSheet() { $('#sheet').hidden = $('#sheet-bg').hidden = true; $('#sheet').innerHTML = ''; }
$('#sheet-bg').onclick = closeSheet;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
function confirmSheet(text, okLabel, fn) {
  openSheet(`<h3>${esc(text)}</h3><div class="actions"><button class="btn" data-x>Atšaukti</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`, el => {
    $('[data-x]', el).onclick = closeSheet;
    $('[data-ok]', el).onclick = async () => { closeSheet(); await fn(); };
  });
}
const personOptions = (sel, emptyLabel = '— nežinia kam —') =>
  `<option value="">${esc(emptyLabel)}</option>` + people().map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(pLabel(p))}</option>`).join('');

// „Kava 8,99“ / „Kava 9 €“ → pavadinimas ir kaina
function splitPrice(text) {
  const m = text.trim().match(/^(.*?\S)\s+(\d+(?:[.,]\d{1,2})?)\s*€$/) || text.trim().match(/^(.*?\S)\s+(\d+[.,]\d{1,2})$/);
  return m ? { title: m[1], price: pnum(m[2]) } : { title: text.trim(), price: null };
}

// ============================================================ ŠVENTĖS (pradžia)
// trumpa būsena: kiek gavėjų jau turi dovaną, kiek dar reikia nupirkti
function occStatus(o, kind, pid) {
  if (!o) {
    const ideas = pid ? freeIdeas(pid).length : 0;
    return { txt: 'Dovanų dar nėra' + (ideas ? ` · ${ideas} idėj${ideas === 1 ? 'a' : 'os'} laukia` : ''), have: 0, total: 0, todo: 0 };
  }
  const gifts = giftsOf(o.id), recs = recipientsOf(o.id);
  const todo = gifts.filter(g => g.status === 'idea' || g.status === 'ordered').length;
  const have = recs.filter(r => gifts.some(g => g.person_id === r.person_id)).length;
  let txt;
  if (!gifts.length) txt = 'Dovanų dar nėra';
  else if (recs.length > 1) txt = have === recs.length ? 'Visi turi dovanas' : `${have} iš ${recs.length} turi dovaną`;
  else txt = todo ? 'Reikia nupirkti' : 'Nupirkta';
  return { txt, have, total: recs.length, todo };
}
const evIcon = e => e.kind === 'birthday' && (e.person_id || e.occ?.person_id) ? ava(e.person_id || e.occ.person_id) : `<span class="ico">${KINDS[e.kind].icon}</span>`;
const ageTxt = (pid, year) => { const a = ageAt(pid, year); return a ? `<span class="age ${a % 5 === 0 ? 'jub' : ''}">${a} m.${a % 5 === 0 ? ' 🎉' : ''}</span>` : ''; };

VIEWS.soon = () => {
  setTop('Dovanos');
  const days = S.settings.ahead_days || 60;
  const ev = upcoming(days);
  let h = '';
  // artimiausia didelė šventė (ne gimtadienis) – su pažanga
  const big = ev.find(e => e.kind !== 'birthday');
  if (big) {
    const st = occStatus(big.occ, big.kind);
    h += `<div class="card hero" data-i="${ev.indexOf(big)}">
      <div class="k">Artimiausia šventė</div>
      <div class="n">${KINDS[big.kind].icon} ${esc(eventName(big))}</div>
      <div class="d">${until(big.date)} · ${niceDate(big.date)}</div>
      ${st.total > 1 ? `<div class="bar"><i style="width:${st.have / st.total * 100}%"></i></div>` : '<div style="height:10px"></div>'}
      <div class="p"><span>${st.txt}</span>${st.todo ? `<span class="pill todo">Nupirkti dar: ${st.todo}</span>` : ''}</div></div>`;
  }
  h += `<h2>Artėja <span class="sum">${days} d.</span></h2>`;
  h += ev.length ? `<div class="card list">${ev.map((e, i) => {
    const pid = e.person_id || e.occ?.person_id, st = occStatus(e.occ, e.kind, pid);
    const age = e.kind === 'birthday' ? ageTxt(pid, e.year) : '';
    return `<div class="li" data-i="${i}">${evIcon(e)}
      <div class="grow"><div class="t">${esc(eventName(e))}</div><div class="s">${age ? age + ' · ' : ''}${esc(st.txt)}</div></div>
      <div class="end"><b class="${dcls(e.date)}">${until(e.date)}</b>${niceDate(e.date)}</div></div>`;
  }).join('')}</div>` : `<div class="card empty">Artimiausiu metu progų nėra.<br><span class="small">Gimtadienius įrašykite skiltyje „Žmonės“.</span></div>`;
  const todo = toBuy();
  h += `<h2>Apsipirkimui ir istorija</h2><div class="card list">
    ${todo.length ? `<a class="li" href="#shop"><span class="ico">🛒</span><div class="grow"><div class="t">Reikia nupirkti</div><div class="s">${todo.length} dovan${todo.length === 1 ? 'a' : 'os'} · ${moneyShort(todo.reduce((s, g) => s + (g.price || 0), 0))}</div></div><span class="chev">›</span></a>` : ''}
    <a class="li" href="#occs"><span class="ico">🎁</span><div class="grow"><div class="t">Visos progos</div><div class="s">Ir praėjusių metų</div></div><span class="chev">›</span></a></div>`;
  view.innerHTML = h;
  $$('[data-i]', view).forEach(el => el.onclick = () => openEvent(ev[+el.dataset.i]));
};

// Vienodos laukiančios idėjos (tas pats pavadinimas, kaina, parduotuvė, nuoroda, pastaba) rodomos kaip viena su keliais vardais.
// Kiekvienam gavėjui lieka atskiras įrašas – priskyrus vieno progai, kitiems idėja lieka.
let CL = [];
const ideaKey = g => [g.title, g.price ?? '', g.shop, g.url, g.note, g.cat].map(x => String(x ?? '').trim().toLowerCase()).join('|');
function clusters(list) {
  const m = new Map();
  for (const g of list) { const k = ideaKey(g); if (!m.has(k)) m.set(k, []); m.get(k).push(g); }
  return [...m.values()].map(gs => ({ gifts: gs, pids: gs.map(g => g.person_id).filter(Boolean).sort((a, b) => lt(pname(a), pname(b))) }));
}
const clusterOf = g => clusters(freeIdeas()).find(c => c.gifts.some(x => x.id === g.id)) || { gifts: [g], pids: g.person_id ? [g.person_id] : [] };
const namesOf = c => c.pids.map(pid => pLabel(I.people[pid] || { name: '?' })).join(', ');  // be gavėjo – nieko nerašoma
function ideaLi(c, skipPid, noCat) {
  if (!c.gifts) c = clusterOf(c);
  const i = CL.push(c) - 1, g = c.gifts[0];
  const others = skipPid ? c.pids.filter(x => x !== skipPid) : null;
  const who = skipPid === -1 ? '' : others ? (others.length ? 'taip pat: ' + others.map(pname).join(', ') : '') : c.pids.map(x => pname(x)).join(', ');
  const uses = usesOf(g), cat = !noCat && g.cat ? catLabel(g.cat) : '';
  const meta = [cat, who, g.shop].filter(Boolean).join(' · ');
  return `<div class="li" data-c="${i}">${thumb(g.photo)}
    <div class="grow"><div class="t">${esc(g.title)}${g.url ? ' <span class="small">🔗</span>' : ''}</div>${meta ? `<div class="s">${esc(meta)}</div>` : ''}${usedLine(uses)}</div>
    ${g.price != null ? `<span class="end">${money(g.price)}</span>` : ''}</div>`;
}
function bindIdeaLis(root = view) {
  $$('[data-c]', root).forEach(el => el.onclick = () => ideaSheet(CL[+el.dataset.c]));
}
// idėjos langas: vienas visoms vienodos idėjos kopijoms (keli gavėjai)
const ideaSheet = c => giftSheet(c.gifts[0], { person_ids: [...c.pids] }, true, c);
// gavėjų keitimas idėjai: nuimtiems kopija ištrinama, naujiems – sukuriama su tais pačiais laukais
async function setClusterPeople(c, pids, common) {
  const g0 = c.gifts[0];
  common = common || { title: g0.title, price: g0.price, shop: g0.shop, url: g0.url, note: g0.note, cat: g0.cat || '', photo: g0.photo || '', status: 'idea' };
  const want = pids.length ? pids : [null];
  const keep = c.gifts.filter(x => want.includes(x.person_id));
  for (const x of c.gifts) if (!keep.includes(x)) await api('api/do/delete', { t: 'gifts', id: x.id });
  for (const x of keep) await api('api/do/save', { t: 'gifts', row: { ...common, id: x.id } });
  for (const pid of want) if (!keep.some(x => x.person_id === pid)) await api('api/do/save', { t: 'gifts', row: { ...common, person_id: pid } });
  await load();
}
// sąrašo įklijavimas: kiekviena eilutė – atskira idėja (žymės „- “, „• “, „1.“, „☐“ nuimamos)
function pasteSheet() {
  const pids = [];
  openSheet(`<h3>📋 Įklijuoti idėjų sąrašą</h3>
    <textarea id="ps-t" autofocus style="min-height:180px" placeholder="Kiekviena eilutė – atskira idėja, pvz.:&#10;- Šalikas&#10;- Knyga apie keliones 15,90&#10;- Termosas"></textarea>
    <p class="small muted" id="ps-n" style="margin:6px 2px 12px">Idėjų: 0</p>
    <span class="lbl-s">Kam skirti visas? (nebūtina, galima kelis)</span><div id="ps-p">${multiPeopleChips(pids)}</div>
    <div style="margin-top:12px">${catSelectHtml('ps', '')}</div>
    <div class="actions"><button class="btn" data-x>Atšaukti</button><button class="btn primary" data-ok>Įrašyti</button></div>`, el => {
    const lines = () => [...new Set($('#ps-t', el).value.split(/\r?\n/)
      .map(l => l.replace(/^\s*([-*•·▪◦–—>]+|\d+[.)]|\[[ xX✓]?\]|☐|☑️?|✅|⬜|✔️?)\s*/, '').trim()).filter(Boolean))];
    $('#ps-t', el).oninput = () => $('#ps-n', el).textContent = 'Idėjų: ' + lines().length;
    bindMultiPeople($('#ps-p', el), pids);
    $('#ps-cat', el).onchange = () => bdAutoPick($('#ps-p', el), pids)($('#ps-cat', el).value);
    $('[data-x]', el).onclick = closeSheet;
    $('[data-ok]', el).onclick = async () => {
      const ls = lines();
      if (!ls.length) return toast('Įklijuokite sąrašą');
      const cat = $('#ps-cat', el).value;
      closeSheet();
      for (const l of [...ls].reverse()) {  // naujausios rodomos viršuje – kad tvarka liktų kaip sąraše
        const { title, price } = splitPrice(l);
        for (const pid of pids.length ? pids : [null]) await api('api/do/save', { t: 'gifts', row: { title, price, person_id: pid, status: 'idea', cat } });
      }
      await load();
      toast(`💡 Įrašyta idėjų: ${ls.length}` + (pids.length ? ` (${pids.map(pname).join(', ')})` : ''), null, 4000);
    };
  });
}

// ============================================================ PROGA
VIEWS.occ = id => {
  const o = I.occasions[id];
  if (!o) return go('occs');
  setTop(occTitle(o), `<button class="icon-btn" id="occ-menu" title="Biudžetas, pastabos, trynimas">${IC.edit}</button>`, true);
  const gifts = giftsOf(o.id), recs = recipientsOf(o.id), date = occDate(o);
  const sp = spent(gifts), todo = gifts.filter(g => g.status === 'idea' || g.status === 'ordered');
  const todoSum = todo.reduce((s, g) => s + (g.price || 0), 0);
  const past = date && date < T();
  let h = `<div class="occ-head">
    <div class="d">${date ? `${niceDate(date, true)}${o.kind === 'birthday' ? ageBadge(o.person_id, o.year) : ''} · <span class="${dcls(date)}">${until(date)}</span>` : 'Data nenurodyta'}</div>
    <div class="m">Išleista <b>${money(sp) || '0 €'}</b>${todo.length ? ` · nupirkti dar ${todo.length}${todoSum ? ` (${moneyShort(todoSum)})` : ''}` : ''}${o.budget ? ` · biudžetas ${moneyShort(o.budget)}${sp > o.budget ? ' <b style="color:var(--danger)">viršytas</b>' : ''}` : ''}</div>
    ${o.budget ? `<div class="bar ${sp > o.budget ? 'over' : ''}"><i style="width:${Math.min(100, sp / o.budget * 100)}%"></i></div>` : ''}
  </div>`;
  if (o.notes) h += `<div class="card pad pre small" style="margin-top:12px">${esc(o.notes)}</div>`;
  if (DESK()) {
    // kompiuteris: visi gavėjai iš karto stulpeliais, dešinėje – idėjos
    const have = recs.filter(r => gifts.some(g => g.person_id === r.person_id)).length;
    const extra = gifts.filter(g => !g.person_id || !recs.some(r => r.person_id === g.person_id));
    h = `<div class="occ-desk"><div class="grow">${h}
      ${recs.length > 1 ? `<div class="bprog"><span>Dovaną turi <b>${have} iš ${recs.length}</b></span><div class="bar"><i style="width:${have / recs.length * 100}%"></i></div></div>` : ''}
      <div class="board">${recs.map(r => boardCol(o, r, gifts.filter(g => g.person_id === r.person_id))).join('')}
        ${extra.length ? boardCol(o, null, extra) : ''}
        <button class="bcol add-col" id="add-rec">+ Pridėti žmogų ar grupę</button></div>
      ${receivedBlock(S.received.filter(r => r.occasion_id === o.id), 'Gauta šia proga')}</div>
      <aside class="ipanel"><div class="ip-h">Idėjos <span class="small muted">– tempkite į stulpelį</span></div>
        <div class="searchbox">${svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>')}<input type="search" id="bpq" placeholder="Ieškoti idėjų…" value="${esc(UI.bpq || '')}" autocomplete="off"></div>
        <div id="bp-list">${ideaPanelList(o, recs)}</div></aside></div>`;
    view.innerHTML = h;
    bindReceived(view, { occasion_id: o.id });
    $('#occ-menu').onclick = () => occasionSheet(o);
    $('#add-rec').onclick = () => recipientSheet(o);
    bindGiftRows(view, past);
    bindBoard(o, recs, past);
    $$('[data-rmrec]', view).forEach(el => el.onclick = () => {
      const r = I.recipients[el.dataset.rmrec];
      confirmSheet(`Pašalinti ${pname(r.person_id)} iš šios progos?`, 'Pašalinti', () => delRow('recipients', r.id));
    });
    return;
  }
  const f = recs.length > 1 ? (UI.occF || 'all') : 'all';
  if (recs.length > 1) h += `<div class="seg occ-seg">${[['all', 'Visi'], ['todo', 'Nupirkti'], ['none', 'Be dovanos']].map(([k, l]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  let shown = 0;
  for (const r of recs) {
    const all = gifts.filter(g => g.person_id === r.person_id);
    if (f === 'todo' && !all.some(g => g.status === 'idea' || g.status === 'ordered')) continue;
    if (f === 'none' && all.length) continue;
    h += recipientGroup(o, r, f === 'todo' ? all.filter(g => g.status === 'idea' || g.status === 'ordered') : all, all, f);
    shown++;
  }
  const extra = gifts.filter(g => !g.person_id || !recs.some(r => r.person_id === g.person_id));
  if (f !== 'none' && extra.length) { h += recipientGroup(o, null, extra, extra, f); shown++; }
  if (!shown && f !== 'all') h += `<div class="empty">${f === 'todo' ? 'Viskas nupirkta 🎉' : 'Visi jau turi dovanas'}</div>`;
  if (f === 'all') h += `<div class="card list" style="margin-top:18px"><div class="li add" id="add-rec"><span class="plus">+</span><span class="grow">Pridėti žmogų ar grupę</span></div></div>`;
  h += receivedBlock(S.received.filter(r => r.occasion_id === o.id), 'Gauta šia proga');
  view.innerHTML = h;
  bindReceived(view, { occasion_id: o.id });

  $('#occ-menu').onclick = () => occasionSheet(o);
  if ($('#add-rec')) $('#add-rec').onclick = () => recipientSheet(o);
  $$('[data-f]', view).forEach(b => b.onclick = () => { UI.occF = b.dataset.f; saveUI(); render(); });
  bindGiftRows(view, past);
  $$('[data-addg]', view).forEach(el => el.onclick = e => {
    if (e.target.closest('[data-pick]')) return;
    const pid = +el.dataset.addg || null;
    giftSheet(null, { occasion_id: o.id, person_ids: pid ? [pid] : [], status: past ? 'given' : 'idea' });
  });
  $$('[data-pick]', view).forEach(el => el.onclick = () => pickIdeaSheet(o, +el.dataset.pick));
  $$('[data-rmrec]', view).forEach(el => el.onclick = () => {
    const r = I.recipients[el.dataset.rmrec];
    confirmSheet(`Pašalinti ${pname(r.person_id)} iš šios progos?`, 'Pašalinti', () => delRow('recipients', r.id));
  });
};

// idėjos, kurias galima priskirti gavėjui: jo paties ir „nežinia kam“
const pickableIdeas = pid => ({ own: freeIdeas(pid), loose: S.gifts.filter(g => !g.occasion_id && g.status === 'idea' && !g.person_id).sort((a, b) => b.id - a.id) });

// vienas gavėjas progoje: vardas, jo dovanos su varnelėmis, „+ Pridėti dovaną“ ir „Iš idėjų“
function recipientGroup(o, r, shown, all, f) {
  const pid = r ? r.person_id : null;
  const pi = pid ? pickableIdeas(pid) : null, nIdeas = pi ? pi.own.length + pi.loose.length : 0;
  const canRemove = r && !(o.kind === 'birthday' && o.person_id === pid);
  const tot = all.reduce((s, g) => s + (g.price || 0), 0);
  // viena eilutė: „+ Pridėti dovaną“ ir dešinėje – „Iš idėjų“
  const adds = f === 'todo' ? '' : `<div class="li add" data-addg="${pid || ''}"><span class="plus">+</span><span class="grow">${all.length ? 'Dar viena dovana' : 'Pridėti dovaną'}</span>
    ${nIdeas ? `<button class="btn small" data-pick="${pid}">💡 Iš idėjų${pi.own.length ? ' ' + pi.own.length : ''}</button>` : ''}</div>`;
  return `<div class="phead">${r ? ava(pid, 'sm') : ''}${r ? `<a class="nm" href="#person/${pid}">${esc(pname(pid))}</a>` : '<span class="nm">Kiti (be gavėjo)</span>'}
      <span class="tot">${tot ? money(tot) : ''}</span>${canRemove ? `<button class="icon-btn" data-rmrec="${r.id}" title="Pašalinti iš šios progos">${IC.x}</button>` : ''}</div>
    <div class="card list">${shown.map(g => giftLi(g)).join('')}${adds}</div>`;
}

function pickIdeaSheet(o, pid) {
  const { own, loose } = pickableIdeas(pid);
  const li = g => `<div class="li" data-take="${g.id}">${thumb(g.photo)}<div class="grow"><div class="t">${esc(g.title)}</div>${g.shop ? `<div class="s">${esc(g.shop)}</div>` : ''}</div><span class="end">${money(g.price)}</span></div>`;
  openSheet(`<h3>Idėja: ${esc(pname(pid))}</h3>
    <p class="muted small" style="margin:-8px 2px 14px">Pasirinkite idėją – ji bus pridėta prie šios progos.</p>
    ${own.length ? `<div class="lbl-s">${esc(pname(pid))} idėjos</div><div class="list" style="margin-bottom:14px">${own.map(li).join('')}</div>` : ''}
    ${loose.length ? `<div class="lbl-s">Be konkretaus gavėjo</div><div class="list">${loose.map(li).join('')}</div>` : ''}
    <div class="actions"><button class="btn" data-x>Uždaryti</button></div>`, el => {
    $('[data-x]', el).onclick = closeSheet;
    $$('[data-take]', el).forEach(x => x.onclick = async () => {
      closeSheet();
      await saveRow('gifts', { id: +x.dataset.take, occasion_id: o.id, person_id: pid });
      toast('Idėja pridėta');
    });
  });
}

// dovanos eilutė su apvalia varnele: pažymėta = nupirkta
const DONE = ['bought', 'wrapped', 'given'];
function giftLi(g, sub) {
  const done = DONE.includes(g.status);
  const stTxt = { ordered: '📦 Užsakyta', bought: 'Nupirkta', wrapped: '🎀 Supakuota', given: '🎁 Įteikta' }[g.status] || '';
  const who = !g.person_id && g.recipient_text ? g.recipient_text : g.person_id && !S.recipients.some(r => r.occasion_id === g.occasion_id && r.person_id === g.person_id) ? pname(g.person_id) : '';
  const line = [sub, who, stTxt, g.shop].filter(Boolean).join(' · ');
  return `<div class="li gift-li ${done ? 'done' : ''}" data-gift="${g.id}"><button class="chk ${done ? 'on' : ''}" data-st="${g.id}" aria-label="${done ? 'Nuimti žymę „nupirkta“' : 'Pažymėti „nupirkta“'}">${IC.check}</button>${thumb(g.photo)}
    <div class="grow"><div class="t">${esc(g.title)}${g.url ? ' <span class="small">🔗</span>' : ''}</div>${line ? `<div class="s">${esc(line)}</div>` : ''}</div>
    <span class="end">${money(g.price)}</span></div>`;
}
function bindGiftRows(root) {
  $$('[data-gift]', root).forEach(el => el.onclick = e => { if (!e.target.closest('[data-st]')) giftSheet(I.gifts[el.dataset.gift]); });
  $$('[data-st]', root).forEach(el => el.onclick = async () => {
    const g = I.gifts[el.dataset.st], prev = g.status, next = DONE.includes(prev) ? 'idea' : 'bought';
    await saveRow('gifts', { id: g.id, status: next });
    toast(next === 'bought' ? `Nupirkta: ${g.title}` : 'Žymė nuimta', { label: 'Atšaukti', fn: () => saveRow('gifts', { id: g.id, status: prev }) }, 2600);
  });
}

function recipientSheet(o) {
  const have = new Set(recipientsOf(o.id).map(r => r.person_id));
  const avail = people().filter(p => !have.has(p.id));
  openSheet(`<h3>Pridėti gavėją</h3>
    ${avail.length ? `<div class="chips" style="margin-bottom:14px">${avail.map(p => `<button class="chip" data-pp="${p.id}">${esc(p.name)}</button>`).join('')}</div>` : ''}
    <label class="field"><span>Arba naujas žmogus ar grupė</span><input type="text" id="np" ${avail.length ? '' : 'autofocus'} placeholder="Vardas arba pvz. „Kaimynai“"></label>
    <label class="check"><input type="checkbox" id="np-g"> 👥 Tai grupė (keli žmonės, kuriems dovanojama kartu)</label>
    <div class="sheet-actions"><button class="btn" data-x>Atšaukti</button><button class="btn primary" data-ok>Pridėti</button></div>`, el => {
    $('[data-x]', el).onclick = closeSheet;
    $$('[data-pp]', el).forEach(b => b.onclick = async () => { closeSheet(); await act('recipient_add', { occasion_id: o.id, person_id: +b.dataset.pp }); });
    const ok = async () => { const n = $('#np').value.trim(); if (!n) return; const g = $('#np-g').checked; closeSheet(); await act('recipient_add', { occasion_id: o.id, name: n, is_group: g ? 1 : 0 }); };
    $('[data-ok]', el).onclick = ok;
    $('#np').onkeydown = e => { if (e.key === 'Enter') ok(); };
  });
}

function occasionSheet(o) {
  openSheet(`<h3>${esc(occTitle(o))}</h3>
    <div class="fgrid">
      ${o.kind === 'other' ? `<label class="field"><span>Pavadinimas</span><input type="text" id="o-title" value="${esc(o.title)}"></label>
      <label class="field"><span>Data</span><input type="date" id="o-date" value="${esc(o.date)}"></label>` : ''}
      <label class="field"><span>Biudžetas, €</span><input type="text" inputmode="decimal" id="o-budget" value="${o.budget != null ? fmtNum(o.budget) : ''}" placeholder="nebūtina"></label>
      <label class="field full"><span>Pastabos</span><textarea id="o-notes">${esc(o.notes)}</textarea></label>
    </div>
    <div class="actions"><button class="btn danger" data-del>Ištrinti</button><button class="btn" data-x>Atšaukti</button><button class="btn primary" data-ok>Išsaugoti</button></div>`, el => {
    $('[data-x]', el).onclick = closeSheet;
    $('[data-ok]', el).onclick = async () => {
      const row = { id: o.id, budget: pnum($('#o-budget').value), notes: $('#o-notes').value };
      if (o.kind === 'other') Object.assign(row, { title: $('#o-title').value, date: $('#o-date').value });
      closeSheet(); await saveRow('occasions', row);
    };
    $('[data-del]', el).onclick = () => {
      const n = giftsOf(o.id).filter(g => g.status !== 'idea').length;
      confirmSheet(`Ištrinti ${occTitle(o)}?${n ? ` Bus ištrinta ir ${n} nupirktų dovanų įrašų (idėjos liks).` : ''}`, 'Ištrinti', async () => {
        await act('delete', { t: 'occasions', id: o.id }, true); go('occs');
      });
    };
  });
}

// ============================================================ DOVANOS / IDĖJOS LANGAS
// Proga – kategorija (Kalėdos, Velykos, X gimtadienis…), metai – atskirai
const catKey = o => o.kind === 'birthday' ? `birthday|${o.person_id}|` : o.kind === 'other' ? `other||${(o.title || '').trim()}` : `${o.kind}||`;
function occCategories() {
  const out = HOLIDAYS.map(k => ({ key: `${k}||`, label: `${KINDS[k].icon} ${KINDS[k].name}` }));
  for (const p of people().filter(p => !p.is_group && p.birthday)) out.push({ key: `birthday|${p.id}|`, label: `🎂 ${p.name} gimtadienis` });
  for (const t of [...new Set(S.occasions.filter(o => o.kind === 'other' && o.title).map(o => o.title.trim()))]) out.push({ key: `other||${t}`, label: `🎁 ${t}` });
  return out;
}
// Proga ir metai – du atskiri pasirinkimai; naudojama visur, kur įrašomos idėjos ir dovanos.
// pids – gavėjai, kurių gimtadieniai rodomi pirmi
function catSelectHtml(id, cur, pids = [], none = 'Bet kada', label = 'Kada tiktų?') {
  const cats = occCategories(), mine = new Set(pids.flatMap(pid => [pid, ...membersOf(pid).map(m => m.id)]).map(pid => `birthday|${pid}|`));
  cats.sort((a, b) => (mine.has(b.key) ? 1 : 0) - (mine.has(a.key) ? 1 : 0));
  if (cur && !cats.some(c => c.key === cur)) cats.push({ key: cur, label: catLabel(cur) });
  return `<label class="field"><span>${label}</span><select id="${id}-cat"><option value="">${none}</option>
      ${cats.map(c => `<option value="${esc(c.key)}" ${c.key === cur ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>`;
}
// konkreti proga: kategorija + metai (priskiriant idėją ar įrašant dovaną progai)
function occPickHtml(id, sel = {}, pids = [], none = '— be progos (laukianti idėja) —') {
  const yr = sel.year || (sel.cat ? catNextYear(sel.cat) : Y());
  const years = [Y() - 3, Y() - 2, Y() - 1, Y(), Y() + 1, Y() + 2, Y() + 3, yr].filter((v, i, a) => a.indexOf(v) === i).sort();
  return catSelectHtml(id, sel.cat || '', pids, none, 'Proga') +
    `<label class="field" id="${id}-year-w"><span>Metai</span><select id="${id}-year">${years.map(y => `<option value="${y}" ${y === yr ? 'selected' : ''}>${y}</option>`).join('')}</select></label>`;
}
// grąžina funkciją, kuri (jei proga pasirinkta) suranda ar sukuria progą ir grąžina jos id
function bindOccPick(el, id, onCat) {
  const cat = $(`#${id}-cat`, el), yr = $(`#${id}-year`, el);
  const upd = setYear => {
    if (!yr) return;
    $(`#${id}-year-w`, el).style.visibility = cat.value ? '' : 'hidden';
    if (setYear && cat.value) yr.value = catNextYear(cat.value);
  };
  cat.onchange = () => { upd(true); onCat && onCat(cat.value); };
  upd(false);
  return async () => {
    if (!cat.value) return null;
    const [kind, pid, title] = cat.value.split('|');
    return (await act('occasion_open', { kind, year: +yr.value, person_id: +pid || null, title }, true)).id;
  };
}
// pasirinkus gimtadienį, gavėju pažymimas tas žmogus (jei dar niekas nepažymėtas)
const bdAutoPick = (box, pids) => v => { const [k, pid] = v.split('|'); if (k === 'birthday' && +pid && !pids.length) $(`.chip[data-p="${pid}"]`, box)?.click(); };
function catLabel(key) {
  const [kind, pid, title] = (key || '').split('|');
  if (!KINDS[kind]) return '';
  if (kind === 'birthday') return `🎂 ${pname(+pid) || '?'} gimtadienis`;
  if (kind === 'other') return `🎁 ${title}`;
  return `${KINDS[kind].icon} ${KINDS[kind].name}`;
}
// kur ir kam tokia pati dovana (pagal pavadinimą) jau buvo panaudota / suplanuota
const normT = t => String(t || '').trim().toLowerCase();
const usesOf = g => S.gifts.filter(x => x.occasion_id && I.occasions[x.occasion_id] && normT(x.title) === normT(g.title))
  .sort((a, b) => I.occasions[b.occasion_id].year - I.occasions[a.occasion_id].year || (occDate(I.occasions[b.occasion_id]) || '').localeCompare(occDate(I.occasions[a.occasion_id]) || ''));
// trumpas panaudojimas idėjų sąraše: „🎄25 Mama“ (visa informacija – paspaudus idėją)
const cut = (t, n) => t.length > n ? t.slice(0, n - 1) + '…' : t;
const useShort = x => { const o = I.occasions[x.occasion_id], who = pname(x.person_id || (o.kind === 'birthday' ? o.person_id : 0));
  return `${occIcon(o)}${String(o.year).slice(-2)}${who ? ' ' + cut(who, 9) : ''}`; };
const USED_MAX = 3;
function usedLine(uses) {
  if (!uses.length) return '';
  if (uses.length === 1) return `<div class="used ellip">↺ ${esc(useTxt(uses[0]))}</div>`;
  const more = uses.length - USED_MAX;
  return `<div class="used multi"><span class="ellip">↺ ${uses.length}× · ${esc(uses.slice(0, USED_MAX).map(useShort).join(', '))}</span>${more > 0 ? `<b class="more">+${more}</b>` : ''}</div>`;
}
const useTxt = x => { const o = I.occasions[x.occasion_id]; return `${occTitle(o)}${x.person_id && !(o.kind === 'birthday' && o.person_id === x.person_id) ? ' · ' + pname(x.person_id) : ''}`; };

// artimiausi metai, kai ta proga dar bus
function catNextYear(key) {
  const [kind, pid, title] = key.split('|');
  if (kind === 'other') return Math.max(Y(), ...S.occasions.filter(o => o.kind === 'other' && (o.title || '').trim() === title).map(o => o.year));
  const d = kindDate(kind, Y(), I.people[+pid]);
  return d && d < T() ? Y() + 1 : Y();
}
// Vienas langas dovanai ir idėjai. cluster – vienoda idėja keliems (keičiama visiems kartu).
function giftSheet(g, preset = {}, _, cluster) {
  const isNew = !g;
  g = g || { title: '', person_id: null, occasion_id: null, status: 'idea', price: null, shop: '', url: '', note: '', photo: '', ...preset };
  let status = g.status, photo = g.photo || '';
  const ideaMode = !g.occasion_id;
  const pids = [...(preset.person_ids || (g.person_id ? [g.person_id] : []))];
  const uses = !isNew && ideaMode ? usesOf(g) : [];
  const more = g.price != null || g.shop || g.url || g.note || g.photo;
  openSheet(`<h3>${isNew ? (g.occasion_id ? 'Nauja dovana' : 'Nauja idėja') : ideaMode ? 'Idėja' : 'Dovana'}</h3>
    <div class="fgrid">
      <label class="field full"><span>Ką dovanoti?</span><input type="text" id="g-title" value="${esc(g.title)}" ${isNew && !g.title ? 'autofocus' : ''} placeholder="pvz. Šilko pagalvės užvalkalas"></label>
      <div class="field full"><span class="lbl-s">Kam?</span><div id="g-multi">${multiPeopleChips(pids)}</div></div>
      ${ideaMode ? `<div class="full">${catSelectHtml('g', g.cat, pids)}</div>`
        : occPickHtml('g', I.occasions[g.occasion_id] ? { cat: catKey(I.occasions[g.occasion_id]), year: I.occasions[g.occasion_id].year } : {}, pids)}
      ${ideaMode ? '' : `<div class="full"><div class="seg st5" id="g-status">${Object.keys(STATUS).map(k => { const s = stName(k, true); return `<button type="button" data-s="${k}" class="${k === status ? 'on' : ''}"><span>${s.icon}</span>${s.name}</button>`; }).join('')}</div></div>`}
      <details class="full more" ${more ? 'open' : ''}><summary>Kaina, parduotuvė, nuoroda, nuotrauka, pastaba</summary>
        <div class="fgrid" style="margin-top:10px">
          <label class="field"><span>Kaina, €</span><input type="text" inputmode="decimal" id="g-price" value="${g.price != null ? fmtNum(g.price) : ''}"></label>
          <label class="field"><span>Parduotuvė / iš kur</span><input type="text" id="g-shop" value="${esc(g.shop)}" list="shops"></label>
          <label class="field full"><span>Nuoroda (įklijavus užpildoma pati)</span><div class="row"><input type="url" id="g-url" value="${esc(g.url)}" placeholder="https://"><button type="button" class="btn" id="g-fill" title="Užpildyti iš nuorodos">↧</button>${g.url ? `<a class="btn" href="${esc(g.url)}" target="_blank" rel="noopener" title="Atidaryti">↗</a>` : ''}</div></label>
          <div class="field full"><span class="lbl-s">Nuotrauka</span><div class="row wrap" id="g-photo"></div></div>
          <label class="field full"><span>Pastaba</span><textarea id="g-note" placeholder="dydis, spalva, kodėl...">${esc(g.note)}</textarea></label>
        </div></details>
    </div>
    <datalist id="shops">${[...new Set(S.gifts.map(x => x.shop).filter(Boolean))].sort(lt).map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    ${uses.length ? `<div class="uses"><span class="lbl-s">Jau naudota</span>${uses.map(x => `<a class="use" href="#occ/${x.occasion_id}">${stOf(x).icon} ${useTags(x)}</a>`).join('')}</div>` : ''}
    <div class="sheet-actions">${isNew ? '<button class="btn" data-x>Atšaukti</button>' : '<button class="btn danger" data-del>Ištrinti</button>'}
      ${!isNew && ideaMode ? '<button class="btn" data-occ>→ Proga</button>' : ''}<button class="btn primary" data-ok>Išsaugoti</button></div>`, el => {
    bindMultiPeople($('#g-multi', el), pids);
    photoField($('#g-photo', el), () => photo, v => photo = v);
    // gimtadienio proga – jei gavėjas nepasirinktas, juo tampa tas žmogus
    const getOcc = ideaMode ? null : bindOccPick(el, 'g', v => { const [kind, pid] = v.split('|'); if (kind === 'birthday' && +pid && !pids.length) $(`#g-multi .chip[data-p="${pid}"]`, el)?.click(); });
    if (ideaMode) $('#g-cat', el).onchange = () => bdAutoPick($('#g-multi', el), pids)($('#g-cat', el).value);
    $$('#g-status button', el).forEach(b => b.onclick = () => { status = b.dataset.s; $$('#g-status button', el).forEach(x => x.classList.toggle('on', x === b)); });
    // nuoroda → pavadinimas, kaina, parduotuvė, nuotrauka (tušti laukai užpildomi)
    const fill = async force => {
      const url = $('#g-url', el).value.trim();
      if (!/^https?:\/\//i.test(url)) return force && toast('Įklijuokite nuorodą (https://…)');
      const r = await urlInfo(url);
      if (!r || !$('#g-url')) return;
      if (r.title && (!$('#g-title').value.trim() || force)) $('#g-title').value = r.title;
      if (r.price != null && (!$('#g-price').value.trim() || force)) $('#g-price').value = fmtNum(r.price);
      if (r.shop && (!$('#g-shop').value.trim() || force)) $('#g-shop').value = r.shop;
      if (r.photo && (!photo || force)) { photo = r.photo; photoField($('#g-photo', el), () => photo, v => photo = v); }
      toast('↧ Užpildyta iš nuorodos');
    };
    $('#g-fill', el).onclick = () => fill(true);
    $('#g-url', el).onchange = () => fill(false);
    if ($('[data-x]', el)) $('[data-x]', el).onclick = closeSheet;
    const save = async () => {
      const title = $('#g-title').value.trim();
      if (!title) return toast('Įrašykite, kas per dovana');
      const occasion_id = ideaMode ? null : await getOcc();
      const row = {
        title, occasion_id, cat: ideaMode ? $('#g-cat').value : (g.cat || ''), status: ideaMode ? 'idea' : status,
        price: pnum($('#g-price').value), shop: $('#g-shop').value, url: $('#g-url').value, note: $('#g-note').value, photo,
      };
      closeSheet();
      if (cluster) return setClusterPeople(cluster, pids, row);
      if (!isNew) {
        await saveRow('gifts', { ...row, id: g.id, person_id: pids[0] || null }, pids.length > 1);
        if (pids.length > 1) await addForMany(row, pids.slice(1));
        return;
      }
      const n = await addForMany(row, pids);
      toast((row.occasion_id ? 'Dovana įrašyta' : '💡 Idėja įrašyta') + (n > 1 ? ` (${n} gavėjams)` : ''));
    };
    $('[data-ok]', el).onclick = save;
    $('#g-title', el).onkeydown = e => { if (e.key === 'Enter' || e.keyCode === 13) save(); };
    if ($('[data-occ]', el)) $('[data-occ]', el).onclick = () => assignSheet(cluster || clusterOf(g));
    if (!isNew) $('[data-del]', el).onclick = () => confirmSheet(`Ištrinti „${g.title}“${cluster && cluster.gifts.length > 1 ? ' visiems' : ''}?`, 'Ištrinti', async () => {
      for (const x of cluster ? cluster.gifts : [g]) await api('api/do/delete', { t: 'gifts', id: x.id });
      await load();
    });
  });
}
// panaudojimas: proga (rėmelis) + gavėjas (ženkliukas)
const useTags = x => { const o = I.occasions[x.occasion_id]; return tagO(occTitle(o)) + (x.person_id && !(o.kind === 'birthday' && o.person_id === x.person_id) ? ' ' + tagP(x.person_id) : ''); };

// nuotraukos laukas: peržiūra, ✕ ir „📷 Pridėti“ (telefone – kamera ar galerija)
function photoField(box, get, set) {
  const draw = () => {
    const ph = get();
    box.innerHTML = `${ph ? `<a href="photos/${esc(ph)}" target="_blank" rel="noopener">${thumb(ph, 'l')}</a><button type="button" class="btn small" data-phx>✕ Pašalinti</button>` : ''}
      <label class="btn small">📷 ${ph ? 'Pakeisti' : 'Pridėti'}<input type="file" accept="image/*,application/pdf" hidden></label>`;
    if ($('[data-phx]', box)) $('[data-phx]', box).onclick = () => { set(''); draw(); };
    $('input', box).onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      // „image/*,application/pdf“, nes vien „image/*“ HA programėlėje telefone nuotraukos negrąžina
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name)) return toast('Pasirinkite nuotrauką');
      toast('Įkeliama nuotrauka…');
      try { set(await uploadPhoto(f)); draw(); toast('📷 Nuotrauka pridėta'); } catch (err) { }
    };
  };
  draw();
}
// sumažinama iki 1280 px (JPEG), kad neužimtų daug vietos
async function uploadPhoto(file) {
  let blob = file;
  try {
    const img = await createImageBitmap(file);
    const k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .85)) || file;
  } catch (e) { }
  let r;
  try { r = await fetch('api/photo', { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob }); } catch (e) { toast('Nėra ryšio su serveriu'); throw e; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || 'Nepavyko įkelti nuotraukos'); throw new Error(j.error); }
  return j.photo;
}
// parduotuvės nuorodos informacija (serveris atsisiunčia puslapį)
async function urlInfo(url) {
  toast('Skaitoma nuoroda…', null, 15000);
  try { const r = await api('api/do/url_info', { url }); $('#toast').hidden = true; return r; } catch (e) { return null; }
}

// kelių gavėjų pasirinkimas: pažymėti ir dažniausi rodomi iškart, kiti – paspaudus „Kiti…“.
// Nieko nepažymėta – idėja be konkretaus gavėjo.
function topPeople(n, sel) {
  const cnt = {}; S.gifts.forEach(g => { if (g.person_id) cnt[g.person_id] = (cnt[g.person_id] || 0) + 1; });
  const rest = people().filter(p => !sel.includes(p.id)).sort((a, b) => (cnt[b.id] || 0) - (cnt[a.id] || 0) || lt(a.name, b.name));
  return [...sel, ...rest.slice(0, Math.max(0, n - sel.length)).map(p => p.id)];
}
function multiPeopleChips(sel) {
  const top = topPeople(6, sel), all = people();
  const order = [...top.map(id => I.people[id]).filter(Boolean), ...all.filter(p => !top.includes(p.id))];
  return `<div class="chips multi ${all.length > top.length ? 'collapsed' : ''}">${order.map(p => `<button type="button" class="chip ${sel.includes(p.id) ? 'on' : ''} ${top.includes(p.id) ? '' : 'x'}" data-p="${p.id}">${esc(pLabel(p))}</button>`).join('')}
    ${all.length > top.length ? `<button type="button" class="chip more" data-morep>Kiti… (${all.length - top.length})</button>` : ''}</div>`;
}
function bindMultiPeople(box, sel, after) {
  $$('.chip[data-p]', box).forEach(b => b.onclick = () => {
    const id = +b.dataset.p;
    if (sel.includes(id)) sel.splice(sel.indexOf(id), 1); else sel.push(id);
    b.classList.toggle('on', sel.includes(id));
    if (after) after();
  });
  const more = $('[data-morep]', box);
  if (more) more.onclick = () => { $('.chips', box)?.classList.remove('collapsed'); box.classList.remove('collapsed'); more.remove(); };
}
// ta pati idėja keliems – kiekvienam atskiras įrašas (priskyrus vienam, kitiems lieka)
async function addForMany(row, pids) {
  const list = pids.length ? pids : [null];
  for (const pid of list) await api('api/do/save', { t: 'gifts', row: { ...row, person_id: pid } });
  await load();
  return list.length;
}

// VIENINTELĖ vieta naujai idėjai įrašyti: ＋ Idėja (apačioje), žmogaus lange – su pažymėtu žmogumi.
// Galima įklijuoti ir parduotuvės nuorodą – pavadinimas, kaina ir nuotrauka užsipildo patys.
function newIdeaSheet(pre = []) {
  const pids = [...pre];
  openSheet(`<h3>Nauja idėja</h3>
    <div class="stack">
      <label class="field"><span>Ką dovanoti?</span><input type="text" id="q-title" autofocus placeholder="pvz. Termosas, Kava 8,99 arba nuoroda"></label>
      <div><span class="lbl-s">Kam? (nebūtina, galima kelis)</span><div id="q-people">${multiPeopleChips(pids)}</div></div>
      ${catSelectHtml('q', '', pids)}
    </div>
    <div class="sheet-actions"><button class="btn" data-paste title="Daug idėjų iš karto">Sąrašas</button><button class="btn" data-more>Daugiau</button><button class="btn primary" data-ok>Išsaugoti</button></div>`, el => {
    bindMultiPeople($('#q-people', el), pids, () => $('#q-title').focus());
    $('#q-cat', el).onchange = () => bdAutoPick($('#q-people', el), pids)($('#q-cat', el).value);
    const isUrl = v => /^https?:\/\/\S+$/i.test(v);
    const ok = async () => {
      const v = $('#q-title').value.trim();
      if (!v) return $('#q-title').focus();
      const cat = $('#q-cat', el).value;
      closeSheet();
      let row;
      if (isUrl(v)) {
        const r = await urlInfo(v) || {};
        row = { title: r.title || v.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0], price: r.price ?? null, shop: r.shop || '', url: v, photo: r.photo || '', status: 'idea', cat };
      } else row = { ...splitPrice(v), status: 'idea', cat };
      await addForMany(row, pids);
      toast('💡 Idėja įrašyta' + (pids.length ? ` (${pids.map(pname).join(', ')})` : '') + (cat ? ` · ${catLabel(cat)}` : ''));
    };
    $('[data-ok]', el).onclick = ok;
    $('#q-title').onkeydown = e => { if (e.key === 'Enter' || e.keyCode === 13) ok(); };
    $('[data-paste]', el).onclick = () => pasteSheet();
    $('[data-more]', el).onclick = () => {
      const v = $('#q-title').value.trim(), s = isUrl(v) ? { title: '', url: v } : splitPrice(v);
      giftSheet(null, { ...s, cat: $('#q-cat', el).value, person_ids: [...pids] });
      if (s.url) setTimeout(() => $('#g-fill')?.click(), 50);
    };
  });
}
$('#fab').onclick = () => route[0] === 'people' ? personSheet(null) : newIdeaSheet(route[0] === 'person' && I.people[+route[1]] ? [+route[1]] : []);
// meniu ⋯ (telefone; kompiuteryje tie patys punktai yra šoniniame meniu)
$('#top-menu').onclick = () => {
  const n = toBuy().length, mp = mergePairs().length;
  const item = (href, ic, t, end = '') => `<a class="li" href="#${href}"><span class="mi">${ic}</span><span class="grow t">${t}</span>${end ? `<span class="end">${end}</span>` : ''}</a>`;
  openSheet(`<div class="list menu-list">
    ${item('occs', '🎁', 'Visos progos')}
    ${item('shop', '🛒', 'Reikia nupirkti', n ? String(n) : '')}
    ${item('stats', '📊', 'Statistika')}
    ${mp ? item('merge', '🔗', 'Sujungti pasikartojančius vardus', String(mp)) : ''}
    ${item('settings', '⚙️', 'Nustatymai')}</div>`, el => $$('a', el).forEach(a => a.onclick = closeSheet));
};

// idėjos priskyrimas progai: proga ir metai atskirai
function assignSheet(c) {
  if (!c.gifts) c = clusterOf(c);
  const g = c.gifts[0];
  openSheet(`<h3>„${esc(g.title)}“ – kuriai progai?</h3>
    <div class="fgrid occpick">${occPickHtml('as', { cat: g.cat || '' }, c.pids, '— pasirinkite —')}</div>
    <div class="actions"><button class="btn" data-x>Atšaukti</button><button class="btn" data-new>＋ Kita proga</button><button class="btn primary" data-ok>Priskirti</button></div>`, el => {
    const getOcc = bindOccPick(el, 'as');
    $('[data-x]', el).onclick = closeSheet;
    $('[data-new]', el).onclick = () => newOccasionSheet(oid => assignTo(c, oid));
    $('[data-ok]', el).onclick = async () => {
      const oid = await getOcc();
      if (!oid) return toast('Pasirinkite progą');
      closeSheet();
      await assignTo(c, oid);
    };
  });
}

// kai idėja keliems – paklausiama, kuriems šioje progoje ją panaudoti
async function assignTo(c, oid) {
  const done = async gifts => {
    for (const x of gifts) await api('api/do/save', { t: 'gifts', row: { id: x.id, occasion_id: oid } });
    await load();
    toast(`Priskirta: ${occTitle(I.occasions[oid])}`, { label: 'Atidaryti', fn: () => go('occ/' + oid) });
  };
  if (c.gifts.length === 1) return done(c.gifts);
  const o = I.occasions[oid];
  const rel = c.pids.filter(pid => o.person_id === pid || S.recipients.some(r => r.occasion_id === oid && r.person_id === pid));
  const sel = rel.length ? rel : [...c.pids];
  openSheet(`<h3>Kam per ${esc(occTitle(o))}?</h3>
    <div class="chips" id="as-p">${c.pids.map(pid => `<button type="button" class="chip ${sel.includes(pid) ? 'on' : ''}" data-p="${pid}">${esc(pLabel(I.people[pid]))}</button>`).join('')}</div>
    <p class="small muted">Nepažymėtiems idėja liks laukti.</p>
    <div class="actions"><button class="btn" data-x>Atšaukti</button><button class="btn primary" data-ok>Priskirti</button></div>`, el => {
    $$('#as-p .chip', el).forEach(b => b.onclick = () => { const id = +b.dataset.p; sel.includes(id) ? sel.splice(sel.indexOf(id), 1) : sel.push(id); b.classList.toggle('on', sel.includes(id)); });
    $('[data-x]', el).onclick = closeSheet;
    $('[data-ok]', el).onclick = async () => { if (!sel.length) return toast('Pažymėkite bent vieną'); closeSheet(); await done(c.gifts.filter(x => sel.includes(x.person_id))); };
  });
}

// ============================================================ PROGOS
VIEWS.occs = () => {
  setTop('Visos progos', `<button class="btn small" id="new-occ">+ Nauja proga</button>`, true);
  const years = [...new Set([Y(), ...S.occasions.map(o => o.year)])].sort((a, b) => b - a);
  const yr = years.includes(UI.year) ? UI.year : Y();
  const list = S.occasions.filter(o => o.year === yr).sort((a, b) => (occDate(a) || '9').localeCompare(occDate(b) || '9'));
  const total = spent(S.gifts.filter(g => list.some(o => o.id === g.occasion_id)));
  let h = `<div class="chips scroll" style="margin-top:4px">${years.map(y => `<button class="chip ${y === yr ? 'on' : ''} ${y === Y() ? 'cur' : ''}" data-y="${y}">${y}</button>`).join('')}</div>`;
  h += `<h2>${yr} m. <span class="sum">Išleista ${money(total) || '0 €'}</span></h2>`;
  if (!list.length) h += `<div class="card empty">${yr} m. progų dar nėra.<br><span class="small">Jos atsiranda pačios, kai atidarote artėjančią progą.</span></div>`;
  const groups = [['Kalėdos', list.filter(o => o.kind === 'christmas')], ['Gimtadieniai', list.filter(o => o.kind === 'birthday')],
    ['Kitos šventės ir progos', list.filter(o => o.kind !== 'christmas' && o.kind !== 'birthday')]];
  for (const [name, arr] of groups) {
    if (!arr.length) continue;
    h += `<div class="cat-h">${name}</div><div class="card list">` + arr.map(o => {
      const gifts = giftsOf(o.id), d = occDate(o), st = occStatus(o, o.kind);
      return `<div class="li" data-o="${o.id}">${o.kind === 'birthday' ? ava(o.person_id) : `<span class="ico">${occIcon(o)}</span>`}
        <div class="grow"><div class="t">${esc(occName(o))}</div><div class="s">${d ? `${niceDate(d)}${o.kind === 'birthday' ? ageBadge(o.person_id, o.year) : ''} · ` : ''}${esc(st.txt)}</div></div>
        <span class="end"><b>${moneyShort(spent(gifts))}</b>${st.todo ? `<span style="color:var(--todo)">nupirkti dar ${st.todo}</span>` : ''}</span></div>`;
    }).join('') + `</div>`;
  }
  view.innerHTML = h;
  $$('[data-y]', view).forEach(b => b.onclick = () => { UI.year = +b.dataset.y; saveUI(); render(); });
  $$('[data-o]', view).forEach(el => el.onclick = () => go('occ/' + el.dataset.o));
  $('#new-occ').onclick = () => newOccasionSheet(oid => go('occ/' + oid));
};

function newOccasionSheet(done) {
  let kind = 'christmas';
  openSheet(`<h3>Nauja proga</h3>
    <div class="chips" id="n-kind" style="margin-bottom:14px">${Object.entries(KINDS).map(([k, v]) => `<button class="chip ${k === kind ? 'on' : ''}" data-k="${k}">${v.icon} ${v.name}</button>`).join('')}</div>
    <div class="fgrid">
      <label class="field"><span>Metai</span><input type="number" id="n-year" value="${UI.year || Y()}"></label>
      <label class="field" id="n-person-w" hidden><span>Kieno gimtadienis</span><select id="n-person">${personOptions(null, '— pasirinkite —')}</select></label>
      <label class="field" id="n-title-w" hidden><span>Pavadinimas</span><input type="text" id="n-title" placeholder="pvz. Krikštynos"></label>
      <label class="field" id="n-date-w" hidden><span>Data</span><input type="date" id="n-date"></label>
    </div>
    <p class="small muted" id="n-hint">Gavėjai bus nukopijuoti iš ankstesnių metų tos pačios progos.</p>
    <div class="actions"><button class="btn" data-x>Atšaukti</button><button class="btn primary" data-ok>Sukurti</button></div>`, el => {
    const upd = () => {
      $('#n-person-w').hidden = kind !== 'birthday';
      $('#n-title-w').hidden = $('#n-date-w').hidden = kind !== 'other';
      $('#n-hint').hidden = kind === 'birthday' || kind === 'other';
    };
    $$('#n-kind .chip', el).forEach(b => b.onclick = () => { kind = b.dataset.k; $$('#n-kind .chip', el).forEach(x => x.classList.toggle('on', x === b)); upd(); });
    $('[data-x]', el).onclick = closeSheet;
    $('[data-ok]', el).onclick = async () => {
      const d = { kind, year: +$('#n-year').value || Y() };
      if (kind === 'birthday') { d.person_id = +$('#n-person').value; if (!d.person_id) return toast('Pasirinkite žmogų'); }
      if (kind === 'other') {
        d.title = $('#n-title').value.trim(); d.date = $('#n-date').value;
        if (!d.title) return toast('Įrašykite pavadinimą');
        if (d.date) d.year = +d.date.slice(0, 4);
      }
      closeSheet();
      const r = await act('occasion_open', d, true);
      UI.year = d.year; saveUI();
      if (!r.created) toast('Tokia proga jau yra – atidaroma');
      await done(r.id);
      render();
    };
  });
}

// ============================================================ IDĖJOS
VIEWS.ideas = () => {
  setTop('Idėjos', `<button class="icon-btn" id="paste" title="Įklijuoti sąrašą (daug idėjų iš karto)">${svg('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h3"/>')}</button>`);
  const all = clusters(freeIdeas());
  // filtrai: progos ir žmonės, kurie turi idėjų (daugiausia turintys – pirmi)
  const catN = new Map(), pN = new Map();
  for (const c of all) {
    const k = KINDS[(c.gifts[0].cat || '').split('|')[0]] ? c.gifts[0].cat : '';
    if (k) catN.set(k, (catN.get(k) || 0) + 1);
    c.pids.forEach(pid => pN.set(pid, (pN.get(pid) || 0) + 1));
  }
  const filters = [['', `Visos ${all.length}`], ...[...catN.keys()].sort((a, b) => lt(catLabel(a), catLabel(b))).map(k => ['c:' + k, catLabel(k)]),
    ...[...pN.entries()].sort((a, b) => b[1] - a[1] || lt(pname(a[0]), pname(b[0]))).map(([pid]) => ['p:' + pid, pname(pid)])];
  if (!filters.some(x => x[0] === UI.idf)) UI.idf = '';
  view.innerHTML = `<label class="searchbox">${svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>')}<input type="search" id="iq" placeholder="Ieškoti idėjų" value="${esc(UI.iq || '')}"></label>
    <div class="chips scroll filters">${filters.map(([k, l]) => `<button class="chip ${UI.idf === k ? 'on' : ''}" data-f="${esc(k)}">${esc(l)}</button>`).join('')}</div>
    <div id="ilist"></div>`;
  const draw = () => {
    CL = [];
    const q = (UI.iq || '').trim().toLowerCase(), f = UI.idf || '';
    const list = all.filter(c => {
      const g = c.gifts[0];
      if (q && ![g.title, g.shop, g.note, ...c.pids.map(pname)].some(x => String(x || '').toLowerCase().includes(q))) return false;
      if (f.startsWith('c:')) return g.cat === f.slice(2);
      if (f.startsWith('p:')) return c.pids.includes(+f.slice(2));
      return true;
    });
    let h = '';
    if (!all.length) h = `<div class="card empty" style="margin-top:14px">Idėjų dar nėra. Spauskite <b>+ Idėja</b>, kai tik kas šaus į galvą.</div>`;
    else if (!list.length) h = `<div class="empty">Nieko nerasta</div>`;
    else if (DESK()) h = ideaTable(list, !q && !f);
    else if (!q && !f) {
      // be filtro – sugrupuota pagal tai, kuriai progai tinka
      const byCat = new Map();
      for (const c of list) { const k = KINDS[(c.gifts[0].cat || '').split('|')[0]] ? c.gifts[0].cat : ''; if (!byCat.has(k)) byCat.set(k, []); byCat.get(k).push(c); }
      const keys = [...byCat.keys()].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0) || lt(catLabel(a), catLabel(b)));
      for (const k of keys) h += `<div class="cat-h">${k ? esc(catLabel(k)) : 'Bet kada'}<span>${byCat.get(k).length}</span></div><div class="card list">${byCat.get(k).map(c => ideaLi(c, null, true)).join('')}</div>`;
    } else h = `<div class="cat-h">Rasta<span>${list.length}</span></div><div class="card list">${list.map(c => ideaLi(c, null, f.startsWith('c:'))).join('')}</div>`;
    const todo = toBuy();
    if (todo.length && !q) h += `<div class="card list" style="margin-top:18px"><a class="li" href="#shop"><span class="ico">🛒</span><div class="grow"><div class="t">Priskirta progoms, dar nenupirkta</div><div class="s">${todo.length} · sąrašas pagal parduotuves</div></div><span class="chev">›</span></a></div>`;
    $('#ilist').innerHTML = h;
    bindIdeaLis($('#ilist'));
  };
  draw();
  $('#iq').oninput = e => { UI.iq = e.target.value; saveUI(); draw(); };
  $$('[data-f]', view).forEach(b => b.onclick = () => { UI.idf = b.dataset.f; saveUI(); $$('[data-f]', view).forEach(x => x.classList.toggle('on', x === b)); draw(); });
  $('#paste').onclick = pasteSheet;
};

// kompiuteryje – tanki lentelė per visą plotį (kaip Excel): idėja, kam, kada tiktų, parduotuvė, panaudota, kaina
function ideaTable(list, grouped) {
  const groups = new Map();
  if (grouped) for (const c of list) { const k = KINDS[(c.gifts[0].cat || '').split('|')[0]] ? c.gifts[0].cat : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  else groups.set(null, list);
  const keys = [...groups.keys()].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0) || lt(catLabel(a), catLabel(b)));
  const row = c => {
    const i = CL.push(c) - 1, g = c.gifts[0], uses = usesOf(g);
    const usedFull = uses.map(useTxt).join('; ');
    return `<tr data-c="${i}"><td class="it-t">${thumb(g.photo)}<span>${esc(g.title)}</span>${g.url ? ' <span class="small">🔗</span>' : ''}</td>
      <td class="it-p">${c.pids.map(pid => `<span class="it-who">${ava(pid, 'xs')}${esc(pname(pid))}</span>`).join('')}</td>
      <td class="it-c">${g.cat ? esc(catLabel(g.cat)) : '<span class="muted">Bet kada</span>'}</td>
      <td class="it-s">${esc(g.shop || '')}</td>
      <td class="it-u" title="${esc(usedFull)}">${uses.length ? `↺ ${uses.length > 1 ? uses.length + '× · ' : ''}${esc(uses.map(useShort).join(', '))}` : ''}</td>
      <td class="it-m">${money(g.price)}</td></tr>`;
  };
  return `<div class="itbl-w"><table class="itbl"><thead><tr><th>Idėja</th><th>Kam</th><th>Kada tiktų</th><th>Parduotuvė</th><th>Jau dovanota</th><th class="it-m">Kaina</th></tr></thead>
    ${keys.map(k => `<tbody>${grouped ? `<tr class="it-g"><td colspan="6">${k ? esc(catLabel(k)) : 'Bet kada'} <span>${groups.get(k).length}</span></td></tr>` : ''}${groups.get(k).map(row).join('')}</tbody>`).join('')}</table></div>`;
}

// ============================================================ PIRKINIAI
// progoms priskirtos, bet dar nenupirktos dovanos (ir užsakytos) – būsimoms progoms
const toBuy = () => S.gifts.filter(g => (g.status === 'idea' || g.status === 'ordered') && g.occasion_id && I.occasions[g.occasion_id]
  && (occDate(I.occasions[g.occasion_id]) || '9999') >= addDays(T(), -1));
VIEWS.shop = () => {
  setTop('Reikia nupirkti', '', true);
  const all = toBuy(), need = all.filter(g => g.status === 'idea'), ord = all.filter(g => g.status === 'ordered');
  const row = g => {
    const o = I.occasions[g.occasion_id], st = stOf(g);
    return `<div class="li" data-g="${g.id}"><button class="chk" data-buy="${g.id}" aria-label="Pažymėti „nupirkta“">${IC.check}</button>${thumb(g.photo)}
      <div class="grow"><div class="t">${esc(g.title)}${g.url ? ' <span class="small">🔗</span>' : ''}</div><div class="s">${esc([occTitle(o), g.person_id ? pname(g.person_id) : g.recipient_text, st === STATUS.ordered ? 'užsakyta' : ''].filter(Boolean).join(' · '))}</div></div>
      <span class="end">${money(g.price)}</span></div>`;
  };
  let h = `<p class="muted small" style="margin:0 4px 12px">Kas dar nenupirkta artėjančioms progoms. Pažymėkite apskritimą, kai nupirksite.</p>`;
  if (!all.length) h += `<div class="card empty">Viskas nupirkta 🎉<br><span class="small">Čia atsiranda dovanos, priskirtos progoms, bet dar nenupirktos.</span></div>`;
  const shops = new Map();
  for (const g of need) { const k = (g.shop || '').trim(); if (!shops.has(k)) shops.set(k, []); shops.get(k).push(g); }
  const keys = [...shops.keys()].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || lt(a, b));
  if (need.length) h += `<h2>Iš viso ${need.length} <span class="sum">${moneyShort(need.reduce((s, g) => s + (g.price || 0), 0))}</span></h2>`
    + keys.map(k => { const arr = shops.get(k).sort((a, b) => (occDate(I.occasions[a.occasion_id]) || '').localeCompare(occDate(I.occasions[b.occasion_id]) || ''));
      return `<div class="cat-h">${k ? esc(k) : 'Parduotuvė nenurodyta'}<span>${arr.length}</span></div><div class="card list">${arr.map(row).join('')}</div>`; }).join('');
  if (ord.length) h += `<div class="cat-h">Užsakyta, laukiama<span>${ord.length}</span></div><div class="card list">${ord.map(row).join('')}</div>`;
  view.innerHTML = h;
  $$('[data-g]', view).forEach(el => el.onclick = e => { if (!e.target.closest('[data-buy]')) giftSheet(I.gifts[el.dataset.g]); });
  $$('[data-buy]', view).forEach(b => b.onclick = async () => {
    const g = I.gifts[b.dataset.buy], prev = g.status;
    await saveRow('gifts', { id: g.id, status: 'bought' });
    toast(`Nupirkta: ${g.title}`, { label: 'Atšaukti', fn: () => saveRow('gifts', { id: g.id, status: prev }) }, 3000);
  });
};

// ============================================================ GAUTOS DOVANOS
function receivedBlock(list, title, addPreset = true) {
  list = [...list].sort((a, b) => b.id - a.id);
  if (!list.length && !addPreset) return '';
  return `<h2>${esc(title)}${list.length ? ` <span class="sum">${list.length}</span>` : ''}</h2>
    <div class="card list">${list.map(r => { const o = I.occasions[r.occasion_id];
      const line = [r.person_id ? 'nuo ' + pname(r.person_id) : '', o ? occTitle(o) : '', r.note].filter(Boolean).join(' · ');
      return `<div class="li" data-rcv="${r.id}">${r.photo ? thumb(r.photo) : '<span class="ico">📥</span>'}<div class="grow"><div class="t">${esc(r.title)}</div>${line ? `<div class="s">${esc(line)}</div>` : ''}</div></div>`; }).join('')}
      ${addPreset ? '<div class="li add" data-rcv-add><span class="plus">+</span><span class="grow">Įrašyti gautą dovaną</span></div>' : ''}</div>`;
}
function bindReceived(root, preset) {
  $$('[data-rcv]', root).forEach(el => el.onclick = () => receivedSheet(I.received[el.dataset.rcv]));
  $$('[data-rcv-add]', root).forEach(b => b.onclick = () => receivedSheet(null, preset));
}
function receivedSheet(r, preset = {}) {
  const isNew = !r;
  r = r || { title: '', person_id: null, occasion_id: null, note: '', photo: '', ...preset };
  let photo = r.photo || '', from = r.person_id || null;
  const o = I.occasions[r.occasion_id];
  openSheet(`<h3>📥 ${isNew ? 'Gauta dovana' : esc(r.title)}</h3>
    <div class="fgrid">
      <label class="field full"><span>Kas</span><input type="text" id="r-title" value="${esc(r.title)}" ${isNew ? 'autofocus' : ''} placeholder="pvz. Šalikas"></label>
      <div class="field full"><span class="lbl-s">Nuo ko</span><div class="chips" id="r-from">${people().map(p => `<button type="button" class="chip ${p.id === from ? 'on' : ''}" data-p="${p.id}">${esc(pLabel(p))}</button>`).join('')}</div></div>
      ${occPickHtml('r', o ? { cat: catKey(o), year: o.year } : {}, from ? [from] : [], '— be progos —')}
      <div class="field full"><span class="lbl-s">Nuotrauka</span><div class="row wrap" id="r-photo"></div></div>
      <label class="field full"><span>Pastaba</span><textarea id="r-note" placeholder="pvz. labai patiko">${esc(r.note)}</textarea></label>
    </div>
    <div class="sheet-actions">${isNew ? '<button class="btn" data-x>Atšaukti</button>' : '<button class="btn danger" data-del>Ištrinti</button>'}<button class="btn primary" data-ok>Išsaugoti</button></div>`, el => {
    $$('#r-from .chip', el).forEach(b => b.onclick = () => { from = from === +b.dataset.p ? null : +b.dataset.p; $$('#r-from .chip', el).forEach(x => x.classList.toggle('on', +x.dataset.p === from)); });
    photoField($('#r-photo', el), () => photo, v => photo = v);
    const getOcc = bindOccPick(el, 'r');
    if ($('[data-x]', el)) $('[data-x]', el).onclick = closeSheet;
    $('[data-ok]', el).onclick = async () => {
      const title = $('#r-title').value.trim();
      if (!title) return toast('Įrašykite, kas gauta');
      const note = $('#r-note').value, occasion_id = await getOcc();
      closeSheet();
      await saveRow('received', { ...(isNew ? {} : { id: r.id }), title, person_id: from, occasion_id, note, photo });
      toast('📥 Išsaugota');
    };
    if (!isNew) $('[data-del]', el).onclick = () => confirmSheet(`Ištrinti „${r.title}“?`, 'Ištrinti', () => delRow('received', r.id));
  });
}

// ============================================================ ŽMONĖS
const nextBd = p => { if (!p.birthday || p.is_group) return null; let d = mdInYear(p.birthday, Y()); if (d < T()) d = mdInYear(p.birthday, Y() + 1); return d; };
const bdLine = p => { const d = nextBd(p); return d ? `<span class="${dcls(d)}">🎂 ${mdNice(p.birthday)}${ageBadge(p.id, +d.slice(0, 4))} · ${until(d)}</span>` : ''; };
// vardai, panašūs į grupę („A ir B“, „Tėvams“, „Šeimai“)
const looksGroup = p => !p.is_group && /\s(ir|su)\s|,|\+|&|ams$|iems$|ėms$|oms$|šeim|vaik|tėv(ai|ams|ų)/i.test(p.name.trim()) && !(UI.notGroup || []).includes(p.id);

VIEWS.people = () => {
  setTop('Žmonės');
  const all = people(), arch = people(true).filter(p => p.archived);
  const groups = all.filter(p => p.is_group), indiv = all.filter(p => !p.is_group);
  const sugg = indiv.filter(looksGroup), pairs = mergePairs().length;
  let h = '';
  if (sugg.length) h += `<h2>Panašu į grupes</h2><div class="card list">${sugg.map(p => `<div class="li" style="cursor:default">${ava(p.id)}<div class="grow"><div class="t">${esc(p.name)}</div><div class="s">Keli žmonės kartu?</div></div>
      <button class="btn small" data-mkg="${p.id}">Grupė</button><button class="btn small ghost" data-nog="${p.id}">Ne</button></div>`).join('')}</div>`;
  h += `<h2>Grupės <span class="sum">${groups.length || ''}</span></h2><div class="card list">` + groups.map(g => {
    const ms = membersOf(g.id).filter(m => !m.archived);
    return `<div class="li" data-p="${g.id}">${ava(g.id)}<div class="grow"><div class="t">${esc(g.name)}</div><div class="s">${ms.length ? esc(ms.map(m => m.name).join(', ')) : 'Narių dar nėra'}</div></div><span class="chev">›</span></div>`;
  }).join('') + `<div class="li add" id="new-g"><span class="plus">+</span><span class="grow">Nauja grupė <span class="small muted">(pvz. „A tėvai“)</span></span></div></div>`;
  h += `<h2>Žmonės <span class="sum">${indiv.length || ''}</span></h2>`;
  h += indiv.length ? `<div class="card list">` + indiv.map(p => {
    const d = nextBd(p), gs = groupsOf(p.id);
    const line = d ? `🎂 ${mdNice(p.birthday)}${ageBadge(p.id, +d.slice(0, 4))}` : esc(gs.map(g => g.name).join(', '));
    return `<div class="li" data-p="${p.id}">${ava(p.id)}<div class="grow"><div class="t">${esc(p.name)}</div>${line ? `<div class="s">${line}</div>` : ''}</div>
      ${d ? `<span class="end"><b class="${dcls(d)}">${until(d)}</b></span>` : ''}</div>`;
  }).join('') + `</div>` : `<div class="card empty">Žmonių dar nėra. Spauskite <b>+ Žmogus</b> ir įrašykite artimuosius su gimtadieniais.</div>`;
  if (pairs) h += `<div class="card list" style="margin-top:14px"><a class="li" href="#merge"><span class="ico">🔗</span><div class="grow"><div class="t">Sujungti pasikartojančius vardus</div><div class="s">Rasta panašių porų: ${pairs}</div></div><span class="chev">›</span></a></div>`;
  // archyvas: nerodomi sąrašuose, bet istorija lieka; bet kada galima grąžinti
  if (arch.length) h += `<h2 id="arch" style="cursor:pointer">Archyvas <span class="sum">${arch.length} ${UI.arch ? '▾' : '▸'}</span></h2>` + (UI.arch ? `<div class="card list">${arch.map(p =>
    `<div class="li" data-p="${p.id}">${ava(p.id)}<div class="grow"><div class="t">${esc(p.name)}</div></div><button class="btn small" data-unarch="${p.id}">Grąžinti</button></div>`).join('')}</div>` : '');
  view.innerHTML = h;
  $$('[data-p]', view).forEach(el => el.onclick = e => { if (!e.target.closest('[data-unarch]')) go('person/' + el.dataset.p); });
  $$('[data-mkg]', view).forEach(b => b.onclick = async () => { const id = +b.dataset.mkg; await saveRow('people', { id, is_group: 1 }, true); render(); personSheet(I.people[id]); });
  $$('[data-nog]', view).forEach(b => b.onclick = () => { UI.notGroup = [...(UI.notGroup || []), +b.dataset.nog]; saveUI(); render(); });
  $('#new-g').onclick = () => personSheet(null, true);
  if ($('#arch')) $('#arch').onclick = () => { UI.arch = !UI.arch; saveUI(); render(); };
  $$('[data-unarch]', view).forEach(b => b.onclick = async e => { e.stopPropagation(); await saveRow('people', { id: +b.dataset.unarch, archived: 0 }); toast('Grąžinta iš archyvo'); });
};

function personSheet(p, asGroup) {
  const isNew = !p;
  p = p || { name: '', birthday: '', birth_year: null, notes: '', archived: 0, color: '', is_group: asGroup ? 1 : 0 };
  const others = people(true).filter(x => x.id !== p.id);
  const indiv = others.filter(x => !x.is_group), groups = others.filter(x => x.is_group);
  const mem = new Set(membersOf(p.id).map(x => x.id)), inG = new Set(groupsOf(p.id).map(x => x.id));
  const bdVal = p.birthday ? (p.birth_year ? `${p.birth_year}-${p.birthday}` : p.birthday) : '';
  const pf = prof(p);
  const checks = (list, set, attr) => list.length ? `<div class="checks">${list.map(x => `<label class="check"><input type="checkbox" ${attr}="${x.id}" ${set.has(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('')}</div>` : '';
  openSheet(`<h3>${isNew ? (p.is_group ? 'Nauja grupė' : 'Naujas žmogus') : esc(p.name)}</h3>
    <div class="fgrid">
      <label class="field full"><span id="p-name-l">Vardas</span><input type="text" id="p-name" value="${esc(p.name)}" ${isNew ? 'autofocus' : ''}></label>
      <label class="check full"><input type="checkbox" id="p-isg" ${p.is_group ? 'checked' : ''}> 👥 Tai grupė (keli žmonės, kuriems dovanojama kartu)</label>
      <div class="full" id="p-ind">
        <label class="field"><span>Gimimo data</span><input type="text" id="p-bd" value="${esc(bdVal)}" placeholder="pvz. 1990-01-15 (jei metų nežinote – 01-15)" inputmode="numeric"></label>
        ${groups.length ? `<div class="field" style="margin-top:10px"><span class="lbl-s">Priklauso grupėms</span>${checks(groups, inG, 'data-ing')}</div>` : ''}
      </div>
      <div class="full" id="p-grp"><span class="lbl-s">Grupės nariai</span>${checks(indiv, mem, 'data-mem') || '<div class="small muted">Pirma pridėkite žmonių.</div>'}</div>
      <div class="field full"><span class="lbl-s">Spalva (pvz. kieno pusės giminė)</span><div class="swatches" id="p-color">
        <button type="button" class="sw ${!p.color ? 'on' : ''}" data-c="" title="Be spalvos">✕</button>
        ${Object.entries(COLORS).map(([k, [c, n]]) => `<button type="button" class="sw ${p.color === k ? 'on' : ''}" data-c="${k}" title="${n}" style="--pc:${c}"></button>`).join('')}</div></div>
      <div class="full fgrid three" id="p-sizes">
        <label class="field"><span>👕 Drabužiai</span><input type="text" data-pf="clothes" value="${esc(pf.clothes)}" placeholder="pvz. M"></label>
        <label class="field"><span>👟 Avalynė</span><input type="text" data-pf="shoes" value="${esc(pf.shoes)}" placeholder="pvz. 42"></label>
        <label class="field"><span>💍 Žiedas</span><input type="text" data-pf="ring" value="${esc(pf.ring)}" placeholder="pvz. 17"></label>
      </div>
      <label class="field full"><span>❤️ Mėgsta (spalvos, pomėgiai, prekės ženklai)</span><input type="text" data-pf="likes" value="${esc(pf.likes)}"></label>
      <label class="field full"><span>🚫 Ko nedovanoti</span><input type="text" data-pf="avoid" value="${esc(pf.avoid)}"></label>
      <label class="field full"><span>✅ Jau turi</span><input type="text" data-pf="has" value="${esc(pf.has)}"></label>
      <label class="field full"><span>Pastabos</span><textarea id="p-notes">${esc(p.notes)}</textarea></label>
    </div>
    <div class="sheet-actions">${isNew ? '<button class="btn" data-x>Atšaukti</button>' : '<button class="btn danger" data-del>Ištrinti</button>'}<button class="btn primary" data-ok>Išsaugoti</button></div>`, el => {
    if ($('[data-x]', el)) $('[data-x]', el).onclick = closeSheet;
    const upd = () => {
      const g = $('#p-isg').checked;
      $('#p-ind').hidden = g; $('#p-grp').hidden = !g; $('#p-sizes').hidden = g;
      $('#p-name-l').textContent = g ? 'Grupės pavadinimas (pvz. „A tėvai“)' : 'Vardas';
    };
    $('#p-isg').onchange = upd; upd();
    let color = p.color || '';
    $$('#p-color .sw', el).forEach(b => b.onclick = () => { color = b.dataset.c; $$('#p-color .sw', el).forEach(x => x.classList.toggle('on', x === b)); });
    const save = async () => {
      const isG = $('#p-isg').checked;
      const profile = {}; $$('[data-pf]', el).forEach(i => { if (!(isG && i.closest('#p-sizes'))) profile[i.dataset.pf] = i.value.trim(); });
      const row = { name: $('#p-name').value.trim(), notes: $('#p-notes').value, color, is_group: isG ? 1 : 0, profile };
      if (!row.name) return toast('Įrašykite vardą');
      if (!isG) {
        const b = parseBirth($('#p-bd').value);
        if (b === null) return toast('Gimimo datą rašykite taip: 1990-01-15 arba 01-15');
        Object.assign(row, b);
      }
      if (!isNew) row.id = p.id;
      const r = await saveRow('people', row, true);
      if (isG) await act('group_set', { group_id: r.id, member_ids: $$('[data-mem]', el).filter(c => c.checked).map(c => +c.dataset.mem) }, true);
      else if (groups.length || inG.size) await act('person_groups', { person_id: r.id, group_ids: $$('[data-ing]', el).filter(c => c.checked).map(c => +c.dataset.ing) }, true);
      closeSheet();
      if (isNew) go('person/' + r.id); else render();
    };
    $('[data-ok]', el).onclick = save;
    $('#p-name').onkeydown = e => { if (e.key === 'Enter') save(); };
    if (!isNew) $('[data-del]', el).onclick = () => confirmSheet(`Ištrinti ${p.name}?`, 'Ištrinti', async () => { await act('delete', { t: 'people', id: p.id }, true); go('people'); });
  });
}
// „1990-01-15“ → {birthday: '01-15', birth_year: 1990}; „01-15“ → be metų; tuščia → be gimtadienio; bloga → null
function parseBirth(v) {
  v = (v || '').trim();
  if (!v) return { birthday: '', birth_year: null };
  let m = v.match(/^(\d{4})[-.\/ ](\d{1,2})[-.\/ ](\d{1,2})\.?$/);
  if (m) return +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? { birthday: `${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, birth_year: +m[1] } : null;
  m = v.match(/^(\d{1,2})[-.\/ ](\d{1,2})\.?$/);
  if (m) return +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31 ? { birthday: `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`, birth_year: null } : null;
  return null;
}

// ============================================================ SUJUNGIMAS
// Tas pats žmogus lentelėje dažnai užrašytas skirtingais linksniais („Sesei“ / „Sesės“).
// Panašūs: tiek pat žodžių ir kiekvieno žodžio pradžia sutampa (bent 3 raidės, ilgiems – visa be galūnės).
function similarNames(a, b) {
  const wa = a.toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  const wb = b.toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  if (!wa.length || wa.length !== wb.length || a.toLowerCase() === b.toLowerCase()) return false;
  return wa.every((x, i) => {
    const y = wb[i];
    if (x === y) return true;
    let n = 0; while (n < x.length && n < y.length && x[n] === y[n]) n++;
    return n >= Math.max(3, Math.min(x.length, y.length) - 3);
  });
}
const giftCount = pid => S.gifts.filter(g => g.person_id === pid).length;
function mergePairs() {
  const skip = new Set(UI.notSame || []), ps = people(true), out = [];
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], b = ps[j];
    if (!skip.has(a.id + '-' + b.id) && similarNames(a.name, b.name)) out.push([a, b]);
  }
  return out;
}
function personBrief(p) {
  const n = giftCount(p.id), occs = new Set(S.gifts.filter(g => g.person_id === p.id && g.occasion_id).map(g => I.occasions[g.occasion_id]?.kind));
  const kinds = [...occs].filter(Boolean).map(k => KINDS[k].icon).join(' ');
  return `${p.is_group ? '👥 grupė · ' : ''}${n} dovan.${p.birthday ? ' · 🎂 ' + (p.birth_year ? p.birth_year + '-' : '') + p.birthday : ''}${kinds ? ' · ' + kinds : ''}`;
}

VIEWS.merge = () => {
  setTop('Sujungti žmones', '', true);
  const pairs = mergePairs();
  let h = `<p class="muted small" style="margin:0 4px 12px">Sujungus visos dovanos, idėjos, progos ir gimtadienis atitenka vienam žmogui. Pasirinkite, kuris vardas lieka, arba įrašykite naują (pvz. „Sesė“).</p>`;
  h += `<h2>Panašūs vardai <span class="sum">${pairs.length}</span></h2>`;
  h += pairs.length ? `<div class="grid">` + pairs.map(([a, b], i) => `<div class="card pad stack" data-pair="${i}">
      ${[a, b].map((p, k) => `<label class="check" style="align-items:flex-start"><input type="radio" name="keep${i}" value="${p.id}" ${k === (giftCount(b.id) > giftCount(a.id) ? 1 : 0) ? 'checked' : ''}>
        <span><b>${esc(p.name)}</b><br><span class="small muted">${personBrief(p)}</span></span></label>`).join('')}
      <label class="field"><span>Bendras vardas</span><input type="text" data-name value="${esc(giftCount(b.id) > giftCount(a.id) ? b.name : a.name)}"></label>
      <div class="row"><button class="btn primary grow" data-go>🔗 Sujungti</button><button class="btn" data-no>Skirtingi</button></div></div>`).join('') + `</div>`
    : `<div class="card empty">Panašių vardų nebėra.</div>`;
  const ps = people(true);
  const opts = ps.map(p => `<option value="${p.id}">${esc(p.name)} (${giftCount(p.id)})</option>`).join('');
  h += `<h2>Sujungti bet kuriuos du</h2><div class="card pad"><div class="fgrid">
    <label class="field"><span>Šį žmogų…</span><select id="m-from"><option value="">— pasirinkite —</option>${opts}</select></label>
    <label class="field"><span>…prijungti prie</span><select id="m-to"><option value="">— pasirinkite —</option>${opts}</select></label>
    <label class="field full"><span>Bendras vardas</span><input type="text" id="m-name" placeholder="paliekamas antrojo vardas"></label></div>
    <button class="btn primary block" id="m-go" style="margin-top:12px">🔗 Sujungti</button></div>`;
  view.innerHTML = h;
  $$('[data-pair]', view).forEach(card => {
    const [a, b] = pairs[+card.dataset.pair];
    $$('input[type=radio]', card).forEach(r => r.onchange = () => { $('[data-name]', card).value = I.people[r.value].name; });
    $('[data-go]', card).onclick = async () => {
      const to = +$('input[type=radio]:checked', card).value, from = to === a.id ? b.id : a.id;
      await act('person_merge', { from, to, name: $('[data-name]', card).value });
      toast('Sujungta: ' + pname(to));
    };
    $('[data-no]', card).onclick = () => { UI.notSame = [...(UI.notSame || []), a.id + '-' + b.id]; saveUI(); render(); };
  });
  $('#m-from').onchange = $('#m-to').onchange = () => { const t = +$('#m-to').value; if (t) $('#m-name').value = pname(t); };
  $('#m-go').onclick = async () => {
    const from = +$('#m-from').value, to = +$('#m-to').value;
    if (!from || !to || from === to) return toast('Pasirinkite du skirtingus žmones');
    confirmSheet(`Sujungti „${pname(from)}“ su „${pname(to)}“?`, 'Sujungti', async () => {
      await act('person_merge', { from, to, name: $('#m-name')?.value || '' });
      toast('Sujungta: ' + pname(to));
    });
  };
};

// ============================================================ ŽMOGUS
VIEWS.person = id => {
  const p = I.people[id];
  if (!p) return go('people');
  setTop(p.name, `<button class="icon-btn" id="p-arch-t" title="${p.archived ? 'Grąžinti iš archyvo' : 'Archyvuoti (paslėpti iš sąrašų)'}">${p.archived ? IC.unarchive : IC.archive}</button><button class="icon-btn" id="p-edit" title="Redaguoti">${IC.edit}</button>`, true);
  const ideas = clusters(freeIdeas()).filter(c => c.pids.includes(p.id));
  const gs = groupsOf(p.id), ms = p.is_group ? membersOf(p.id) : [];
  // istorija: savo dovanos ir (žmogui) – grupių, kurioms priklauso, dovanos
  const ids = new Set([p.id, ...gs.map(g => g.id)]);
  const gifts = S.gifts.filter(g => ids.has(g.person_id) && g.occasion_id && I.occasions[g.occasion_id]);
  const d = nextBd(p);
  let h = '';
  if (p.archived) h += `<div class="card pad row" style="margin-bottom:12px"><span class="grow small">Archyvuota – nerodoma sąrašuose, istorija išsaugota.</span><button class="btn small" id="p-unarch">Grąžinti</button></div>`;
  h += `<div class="p-head">${ava(p.id, 'lg')}<div class="info">
    ${p.is_group ? `<div class="muted">Grupė${ms.length ? '' : ' · narių dar nėra'}</div>` : d ? `<div>🎂 ${mdNice(p.birthday)}${ageBadge(p.id, +d.slice(0, 4))}</div><div class="${dcls(d)}">${until(d)}</div>` : '<div class="muted">Gimtadienis neįrašytas</div>'}
    </div></div>`;
  const links = p.is_group ? ms : gs;
  if (links.length) h += `<div class="chips" style="margin:12px 0 0">${links.map(x => `<a class="chip" href="#person/${x.id}">${esc(pLabel(x))}</a>`).join('')}</div>`;
  h += `<h2>Idėjos <span class="sum">${ideas.length || ''}</span></h2><div class="card list">${ideas.map(c => ideaLi(c, p.id)).join('')}
    <div class="li add" id="pi"><span class="plus">+</span><span class="grow">Nauja idėja</span></div></div>`;
  const pf = prof(p);
  const kv = [['Drabužiai', pf.clothes], ['Avalynė', pf.shoes], ['Žiedas', pf.ring], ['Mėgsta', pf.likes], ['Nedovanoti', pf.avoid], ['Jau turi', pf.has]].filter(x => x[1]);
  if (kv.length || p.notes) h += `<h2>Dydžiai ir pomėgiai</h2><div class="card">${kv.map(([k, v]) => `<div class="kv"><span>${k}</span><span>${esc(v)}</span></div>`).join('')}
    ${p.notes ? `<div class="kv"><span class="pre" style="color:var(--ink)">${esc(p.notes)}</span></div>` : ''}</div>`;
  else h += `<div class="card list" style="margin-top:14px"><div class="li add" id="p-edit2"><span class="plus">+</span><span class="grow">Įrašyti dydžius, pomėgius</span></div></div>`;
  h += `<h2>Dovanos per progas <span class="sum">${gifts.length ? moneyShort(spent(gifts)) : ''}</span></h2>`;
  if (!gifts.length) h += `<div class="card empty small">Dovanų įrašų dar nėra.</div>`;
  const byYear = new Map();
  for (const g of gifts) { const y = I.occasions[g.occasion_id].year; if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(g); }
  for (const y of [...byYear.keys()].sort((a, b) => b - a)) {
    const arr = byYear.get(y).sort((a, b) => (occDate(I.occasions[a.occasion_id]) || '').localeCompare(occDate(I.occasions[b.occasion_id]) || ''));
    h += `<div class="cat-h">${y}<span>${moneyShort(spent(arr))}</span></div><div class="card list">${arr.map(g => {
      const o = I.occasions[g.occasion_id];
      return giftLi(g, `${occIcon(o)} ${occName(o)}${g.person_id !== p.id ? ' · ' + pname(g.person_id) : ''}`);
    }).join('')}</div>`;
  }
  h += receivedBlock(S.received.filter(r => r.person_id === p.id), 'Gautos dovanos');
  view.innerHTML = h;
  $('#p-edit').onclick = () => personSheet(p);
  if ($('#p-edit2')) $('#p-edit2').onclick = () => personSheet(p);
  const setArch = async v => {
    await saveRow('people', { id: p.id, archived: v });
    toast(v ? 'Archyvuota' : 'Grąžinta iš archyvo', { label: 'Atšaukti', fn: () => saveRow('people', { id: p.id, archived: v ? 0 : 1 }) });
  };
  $('#p-arch-t').onclick = () => setArch(p.archived ? 0 : 1);
  if ($('#p-unarch')) $('#p-unarch').onclick = () => setArch(0);
  bindIdeaLis(); bindGiftRows(view); bindReceived(view, { person_id: p.id });
  $('#pi').onclick = () => newIdeaSheet([p.id]);
};

// ============================================================ STATISTIKA
VIEWS.stats = () => {
  setTop('Statistika', '', true);
  const real = S.gifts.filter(g => g.status !== 'idea' && g.occasion_id && I.occasions[g.occasion_id]);
  const years = [...new Set(real.map(g => I.occasions[g.occasion_id].year))].sort((a, b) => b - a);
  if (!years.length) { view.innerHTML = `<div class="card empty">Statistika atsiras, kai bus nupirktų dovanų.</div>`; return; }
  const yr = years.includes(UI.syear) ? UI.syear : years[0];
  const bars = (rows) => {
    const max = Math.max(...rows.map(r => r[1]), 1);
    return `<div class="card bars">${rows.map(([l, v, extra]) => `<span class="l" title="${esc(l)}">${esc(l)}</span>
      <div class="bar"><i style="width:${v / max * 100}%"></i></div><span class="v">${moneyShort(v)}${extra ? ` <span class="muted small">${extra}</span>` : ''}</span>`).join('')}</div>`;
  };
  const sumBy = (arr, key) => { const m = new Map(); arr.forEach(g => { const k = key(g); m.set(k, (m.get(k) || 0) + (g.price || 0)); }); return [...m.entries()]; };
  const perYear = years.map(y => [String(y), spent(real.filter(g => I.occasions[g.occasion_id].year === y)), `${real.filter(g => I.occasions[g.occasion_id].year === y).length} vnt.`]);
  const inYr = real.filter(g => I.occasions[g.occasion_id].year === yr);
  const byKind = sumBy(inYr, g => { const o = I.occasions[g.occasion_id]; return o.kind === 'other' ? (o.title || 'Kita') : KINDS[o.kind].name; }).sort((a, b) => b[1] - a[1]);
  const byPerson = sumBy(inYr, g => pname(g.person_id) || g.recipient_text || 'Kiti').sort((a, b) => b[1] - a[1]);
  const byShop = sumBy(real.filter(g => g.shop), g => g.shop).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const avg = perYear.reduce((s, r) => s + r[1], 0) / perYear.length;
  let h = `<h2>Išlaidos per metus <span class="sum">vidutiniškai ${moneyShort(avg)} / m.</span></h2>${bars(perYear)}`;
  h += `<div class="chips" style="margin:22px 0 0">${years.map(y => `<button class="chip ${y === yr ? 'on' : ''} ${y === Y() ? 'cur' : ''}" data-y="${y}">${y}</button>`).join('')}</div>`;
  // suvestinė: išleista, kiek dovanų, vidutinė dovana, dar suplanuota, gauta
  const priced = inYr.filter(g => g.price), yrSpent = spent(inYr);
  const plannedYr = S.gifts.filter(g => g.status === 'idea' && g.occasion_id && I.occasions[g.occasion_id]?.year === yr).reduce((s, g) => s + (g.price || 0), 0);
  const recvYr = (S.received || []).filter(r => I.occasions[r.occasion_id]?.year === yr || (!r.occasion_id && (r.created || '').startsWith(String(yr)))).length;
  const tile = (v, l) => `<div class="card tile"><b>${v}</b><span class="small muted">${l}</span></div>`;
  h += `<div class="tiles">${tile(moneyShort(yrSpent), 'išleista')}${tile(inYr.length, 'dovanų')}${tile(priced.length ? moneyShort(yrSpent / priced.length) : '–', 'vidutinė dovana')}
    ${plannedYr ? tile(moneyShort(plannedYr), 'dar suplanuota (nenupirkta)') : ''}${tile(recvYr, 'gauta dovanų')}</div>`;
  // biudžetas ir išleista – progoms, kurioms nustatytas biudžetas
  const withB = S.occasions.filter(o => o.year === yr && o.budget).sort((a, b) => (occDate(a) || '').localeCompare(occDate(b) || ''));
  if (withB.length) h += `<h2>${yr}: biudžetas ir išleista</h2><div class="card bars">${withB.map(o => { const sp = spent(giftsOf(o.id)), over = sp > o.budget;
    return `<a class="l nolink" href="#occ/${o.id}" title="${esc(occName(o))}">${occIcon(o)} ${esc(occName(o))}</a><div class="bar ${over ? 'over' : ''}"><i style="width:${Math.min(100, sp / o.budget * 100)}%"></i></div>
      <span class="v">${moneyShort(sp)} <span class="muted small">iš ${moneyShort(o.budget)}</span></span>`; }).join('')}</div>`;
  h += `<div class="grid" style="margin-top:4px"><div><h2>${yr}: pagal progą</h2>${bars(byKind)}</div><div><h2>${yr}: pagal žmogų</h2>${bars(byPerson)}</div></div>`;
  if (byShop.length) h += `<h2>Dažniausios parduotuvės (visi metai)</h2>${bars(byShop)}`;
  h += `<p class="small muted center">Skaičiuojamos tik nupirktos ir įteiktos dovanos su kaina.</p>`;
  view.innerHTML = h;
  $$('[data-y]', view).forEach(b => b.onclick = () => { UI.syear = +b.dataset.y; saveUI(); render(); });
};

// ============================================================ PAIEŠKA
VIEWS.search = () => {
  setTop('Paieška', '', true);
  view.innerHTML = `<label class="searchbox">${svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>')}<input type="search" id="sq" placeholder="Ar jau dovanojom? Dovana, parduotuvė, žmogus…" value="${esc(UI.sq || '')}" autofocus></label>
    <div id="sr" style="margin-top:14px"></div>`;
  const run = () => {
    const q = $('#sq').value.trim().toLowerCase();
    UI.sq = q; saveUI();
    if (q.length < 2) { $('#sr').innerHTML = '<div class="empty">Įveskite bent 2 raides.</div>'; return; }
    const hit = s => String(s || '').toLowerCase().includes(q);
    const ps = people(true).filter(p => hit(p.name) || hit(p.notes));
    const gs = S.gifts.filter(g => hit(g.title) || hit(g.shop) || hit(g.note) || hit(g.recipient_text) || hit(pname(g.person_id)))
      .sort((a, b) => (I.occasions[b.occasion_id]?.year || 9999) - (I.occasions[a.occasion_id]?.year || 9999));
    let h = ps.length ? `<div class="chips" style="margin-bottom:12px">${ps.map(p => `<a class="chip" href="#person/${p.id}">${esc(p.name)}</a>`).join('')}</div>` : '';
    const rs = (S.received || []).filter(r => hit(r.title) || hit(r.note) || hit(pname(r.person_id)));
    h += gs.length ? `<div class="card list">${gs.slice(0, 200).map(g => {
      const o = I.occasions[g.occasion_id];
      return `<div class="li" data-g="${g.id}">${g.photo ? thumb(g.photo) : `<span class="ico">${stOf(g).icon}</span>`}<div class="grow"><div class="t">${esc(g.title)}</div>
        <div class="s">${esc([g.person_id ? pname(g.person_id) : g.recipient_text, o ? occTitle(o) : 'laukianti idėja', g.shop].filter(Boolean).join(' · '))}</div></div><span class="end">${money(g.price)}</span></div>`;
    }).join('')}</div>` : (rs.length ? '' : `<div class="empty">Nieko nerasta.</div>`);
    if (rs.length) h += receivedBlock(rs, 'Gautos dovanos', false);
    $('#sr').innerHTML = h;
    $$('[data-g]', $('#sr')).forEach(el => el.onclick = () => { const g = I.gifts[el.dataset.g]; g.occasion_id ? giftSheet(g) : ideaSheet(clusterOf(g)); });
    bindReceived($('#sr'), {});
  };
  $('#sq').oninput = run; run();
  setTimeout(() => $('#sq').focus(), 50);
};

// ============================================================ NUSTATYMAI
VIEWS.settings = () => {
  setTop('Nustatymai', '', true);
  const st = S.settings;
  view.innerHTML = `<div class="grid">
    <div class="card pad stack"><b>Artėjančios progos</b>
      <label class="field"><span>Kiek dienų į priekį rodyti</span><input type="number" id="s-days" value="${st.ahead_days}"></label>
      <div class="small muted">Kurias šventes rodyti (gimtadieniai rodomi visada):</div>
      ${HOLIDAYS.map(k => `<label class="check"><input type="checkbox" data-h="${k}" ${(st.holidays || []).includes(k) ? 'checked' : ''}> ${KINDS[k].icon} ${KINDS[k].name}</label>`).join('')}
      <button class="btn primary" id="s-save">Išsaugoti</button></div>
    <div class="card pad stack" id="s-nt"><b>🔔 Priminimai telefone</b>
      <div class="small muted">Prieš gimtadienius ir įjungtas šventes atsiunčiamas pranešimas, pvz. „Po 14 d. – Kalėdos · Nupirkta 2 iš 5“. Paspaudus atsidaro Dovanos.</div>
      <div><div class="small muted" style="margin-bottom:6px">Į kuriuos telefonus siųsti</div><div id="s-phones" class="small muted">Ieškoma telefonų…</div></div>
      <div><div class="small muted" style="margin-bottom:6px">Kiek dienų prieš priminti</div><div class="chips" id="s-ndays">${[30, 14, 7, 3, 1, 0].map(n => `<button type="button" class="chip ${(st.notify_days || []).includes(n) ? 'on' : ''}" data-nd="${n}">${n === 0 ? 'tą dieną' : n === 1 ? 'dieną prieš' : n + ' d.'}</button>`).join('')}</div></div>
      <label class="field"><span>Kuriuo metu</span><input type="time" id="s-ntime" value="${esc(st.notify_time || '10:00')}"></label>
      <button class="btn" id="s-ntest">📨 Išbandyti pranešimą</button>
      <div class="small muted" id="s-nstat"></div></div>
    <div class="card pad stack"><b>Importas iš Google Sheets</b>
      <div class="small muted">Google Sheets: <b>Failas → Atsisiųsti → Microsoft Excel (.xlsx)</b> – vienu failu visi lapai. Tinka ir <b>CSV</b> (tik atidarytas lapas). Tada pasirinkite failą čia. Prieš įrašant bus parodyta peržiūra. Importas tik papildo – to paties failo nekelkite du kartus.</div>
      <input type="file" id="s-csv" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden><button class="btn" id="s-csv-b">📄 Pasirinkti .xlsx ar .csv failą</button>
      <hr><b>Importas iš JSON</b>
      <div class="small muted">Pvz. jei Claude paruošė idėjų sąrašą. Formatas aprašytas dokumentacijoje.</div>
      <input type="file" id="s-json" accept=".json,application/json" hidden><button class="btn" id="s-json-b">📥 Importuoti JSON</button></div>
    <div class="card pad stack"><b>Atsarginė kopija</b>
      <div class="small muted">Duomenys automatiškai patenka į Home Assistant atsargines kopijas. Čia galima atsisiųsti atskirą failą.</div>
      <a class="btn" href="api/export" download>💾 Atsisiųsti kopiją</a>
      <input type="file" id="s-rest" accept=".json" hidden><button class="btn danger" id="s-rest-b">♻️ Atkurti iš kopijos</button></div>
  </div>`;
  $('#s-save').onclick = async () => {
    await act('settings_save', { settings: { ahead_days: +$('#s-days').value || 60, holidays: $$('[data-h]', view).filter(c => c.checked).map(c => c.dataset.h) } });
    toast('Išsaugota');
  };
  // priminimai telefone
  const ntSave = o => act('settings_save', { settings: { ...S.settings, ...o } }, true).then(() => toast('Išsaugota'));
  $$('[data-nd]', view).forEach(b => b.onclick = () => { b.classList.toggle('on'); ntSave({ notify_days: $$('[data-nd].on', view).map(x => +x.dataset.nd) }); });
  $('#s-ntime').onchange = e => e.target.value && ntSave({ notify_time: e.target.value });
  const phoneName = sv => sv.replace(/^mobile_app_/, '').replace(/_/g, ' ');
  api('api/notify_status').then(n => {
    const sel = S.settings.notify_services || [], all = [...new Set([...n.services, ...sel])];
    $('#s-phones').innerHTML = !n.ha ? 'Veikia ne Home Assistant viduje.' : all.length
      ? `<div class="chips">${all.map(sv => `<button type="button" class="chip ${sel.includes(sv) ? 'on' : ''}" data-ph="${esc(sv)}">📱 ${esc(phoneName(sv))}</button>`).join('')}</div>`
      : 'Telefonų nerasta. Įdiekite Home Assistant programėlę telefone ir prisijunkite.';
    $$('[data-ph]', view).forEach(b => b.onclick = () => { b.classList.toggle('on'); ntSave({ notify_services: $$('[data-ph].on', view).map(x => x.dataset.ph) }); });
    $('#s-nstat').textContent = n.error ? '⚠️ ' + n.error : n.last ? 'Paskutinis pranešimas: ' + n.last.replace('T', ' ') : '';
  }).catch(() => { $('#s-phones').textContent = 'Nepavyko patikrinti.'; });
  $('#s-ntest').onclick = async () => {
    const svcs = $$('[data-ph].on', view).map(x => x.dataset.ph);
    if (!svcs.length) return toast('Pirma pažymėkite telefoną');
    try { await api('api/do/notify_test', { services: svcs }); toast('📨 Išsiųsta – patikrinkite telefoną'); } catch (e) { }
  };
  const pick = (btn, inp, fn) => { $(btn).onclick = () => $(inp).click(); $(inp).onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) fn(await f.text()); }; };
  $('#s-csv-b').onclick = () => $('#s-csv').click();
  $('#s-csv').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (/\.xlsx$/i.test(f.name)) {
      toast('Skaitomas failas…');
      let r;
      try { r = await fetch('api/xlsx', { method: 'POST', body: await f.arrayBuffer() }); } catch (err) { return toast('Nėra ryšio su serveriu'); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return toast(j.error || 'Nepavyko perskaityti failo');
      importPreview(parseSheet(j.sheets.map(s => s.rows.map(row => row.map(c => String(c ?? '').replace(/\s+/g, ' ').trim())))));
    } else if (/\.xls$/i.test(f.name)) {
      toast('Senas .xls formatas netinka – išsaugokite kaip .xlsx', null, 5000);
    } else importPreview(parseSheet([parseCSV(await f.text())]));
  };
  pick('#s-json-b', '#s-json', async text => {
    let d; try { d = JSON.parse(text); } catch (e) { return toast('Netinkamas JSON failas'); }
    if (d.app === 'dovanos') return toast('Tai atsarginė kopija – naudokite „Atkurti iš kopijos“');
    const r = await act('import', d); toast(`Importuota: ${r.gifts} dovanų, ${r.people} žmonių`);
  });
  pick('#s-rest-b', '#s-rest', text => {
    let d; try { d = JSON.parse(text); } catch (e) { return toast('Netinkamas failas'); }
    confirmSheet('Atkurti duomenis iš kopijos? Dabartiniai duomenys bus pakeisti.', 'Atkurti', async () => { await act('restore', d); toast('Atkurta'); });
  });
};

// ---- CSV skaitymas
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const out = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.map(r => r.map(c => c.replace(/\s+/g, ' ').trim()));
}

// ---- Google Sheets lentelės išdėstymo atpažinimas:
// skyrius (Kalėdos / Gimtadieniai / Šventinės dienos + metai), po juo gavėjų antraštės eilutė,
// po jos – dovanų eilutės su varnele (TRUE/FALSE), pavadinimu ir kaina.
function parseSheet(grids) {
  const SEC = [[/^kal[eė]d/i, 'christmas'], [/^gimtad/i, 'birthday'], [/^(švent|svent)/i, 'holiday']];
  const isCheck = v => /^(true|false|taip|ne|✅|⬜|☑️?|☐|✔️?|✓)$/i.test(v);
  const checked = v => /^(true|taip|✅|☑️?|✔️?|✓)$/i.test(v);
  const isMoney = v => /^[€\s]*-?\d[\d\s]*(?:[.,]\d{1,2})?\s*(€|eur)?$/i.test(v) && !/^(19|20)\d\d$/.test(v);
  const holidayKind = s => /velyk/i.test(s) ? 'easter' : /mam/i.test(s) ? 'mother' : /t[eė][cč]/i.test(s) ? 'father'
    : /jonin/i.test(s) ? 'midsummer' : /valentin/i.test(s) ? 'valentine' : /kal[eė]d/i.test(s) ? 'christmas' : 'other';
  const occs = new Map(), peopleBd = new Map();
  const occ = (key, base) => { if (!occs.has(key)) occs.set(key, { ...base, gifts: [], recipients: [] }); return occs.get(key); };
  let sec = null, year = null, heads = [], blank = 1, lastWasItem = false;

  const headTarget = label => {
    if (label === '__extra') return { o: occ(`${sec}|${year}|extra`, sec === 'christmas' ? { kind: 'christmas', year, extra: true } : { kind: 'other', year, title: 'Kita', extra: true }), person: null };
    const m = label.match(/^(.*?)\s+(\d{1,2})[-.](\d{1,2})\.?$/);
    const name = (m ? m[1] : label).trim(), md = m ? `${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
    if (sec === 'christmas') return { o: occ(`christmas|${year}`, { kind: 'christmas', year }), person: name };
    if (sec === 'birthday') {
      if (md) peopleBd.set(name, md); else if (!peopleBd.has(name)) peopleBd.set(name, '');
      return { o: occ(`birthday|${year}|${name}`, { kind: 'birthday', year, person: name, birthday: md }), person: null };
    }
    const kind = holidayKind(name);
    const date = kind === 'other' && md ? `${year}-${md}` : '';
    return { o: occ(`h|${year}|${kind}|${kind === 'other' ? name.toLowerCase() : ''}`, { kind, year, title: kind === 'other' ? name : '', date }), person: null };
  };

  for (const grid of grids) { sec = null; year = null; heads = []; blank = 1; lastWasItem = false;
  for (const r of grid) {
    const cells = r.map((v, i) => ({ v, i })).filter(c => c.v !== '');
    if (!cells.length) { blank++; lastWasItem = false; continue; }
    const first = cells[0].v;
    const s = SEC.find(([re]) => re.test(first));
    if (s && cells.length <= 5 && !cells.some(c => isCheck(c.v))) {
      sec = s[1]; heads = [];
      const ym = r.join(' ').match(/\b(20\d\d)\b/);
      year = ym ? +ym[1] : year;
      blank = 1; lastWasItem = false; continue;
    }
    if (!sec || !year) continue;
    if (/^extra$/i.test(first) && cells.length <= 3) { heads = [{ col: cells[0].i, label: '__extra' }]; blank = 0; lastWasItem = false; continue; }
    const checks = cells.filter(c => isCheck(c.v)).map(c => c.i);
    if (!checks.length) {
      const texts = cells.filter(c => !isMoney(c.v) && c.v !== '?' && !/^(19|20)\d\d$/.test(c.v));
      if (texts.length && (blank > 0 || !lastWasItem || !heads.length)) {
        heads = [];
        // data atskiroje ląstelėje („Vardas“ | „03-15“) prijungiama prie pavadinimo
        for (const c of texts) {
          if (/^\d{1,2}-\d{1,2}$/.test(c.v) && heads.length) heads[heads.length - 1].label += ' ' + c.v;
          else heads.push({ col: c.i, label: c.v });
        }
        for (const h of heads) { const t = headTarget(h.label); if (t.person) t.o.recipients.includes(t.person) || t.o.recipients.push(t.person); }
      }
      blank = 0; lastWasItem = false; continue;
    }
    for (let k = 0; k < checks.length; k++) {
      const ci = checks[k], end = k + 1 < checks.length ? checks[k + 1] : Infinity;
      const inside = cells.filter(c => c.i > ci && c.i < end && !isCheck(c.v));
      const tc = inside.find(c => !isMoney(c.v));
      if (!tc || tc.v === '?') continue;
      const pc = inside.find(c => c.i > tc.i && isMoney(c.v));
      let head = null;
      for (const h of heads) if (h.col <= tc.i && (!head || h.col > head.col)) head = h;
      head = head || heads[0];
      if (!head) continue;
      const t = headTarget(head.label);
      const isIdea = /^gal\s/i.test(tc.v) || !checked(r[ci]);
      t.o.gifts.push({ title: tc.v, person: t.person, price: pc ? pnum(pc.v) : null, status: isIdea ? 'idea' : 'given' });
    }
    blank = 0; lastWasItem = true;
  }
  }
  // nupirktos, bet dar neįteiktos (būsimos progos)
  for (const o of occs.values()) {
    const d = o.kind === 'other' ? o.date : kindDate(o.kind, o.year, { birthday: o.birthday });
    if (d && d >= T()) o.gifts.forEach(g => { if (g.status === 'given') g.status = 'bought'; });
  }
  const list = [...occs.values()].filter(o => o.gifts.length || o.recipients.length);
  return { occasions: list, people: [...peopleBd.entries()].map(([name, birthday]) => ({ name, birthday })) };
}

function importPreview(data) {
  const list = data.occasions.sort((a, b) => b.year - a.year);
  if (!list.length) return toast('Faile nerasta atpažįstamų dovanų. Patikrinkite, ar tai CSV iš dovanų lentelės.', null, 5000);
  const label = o => `${KINDS[o.kind].icon} ${o.kind === 'birthday' ? o.person + ' gimtadienis' : o.kind === 'other' ? o.title : KINDS[o.kind].name} ${o.year}${o.extra ? ' · Extra' : ''}`;
  const exists = o => S.occasions.some(x => x.kind === o.kind && x.year === o.year &&
    (o.kind === 'birthday' ? pname(x.person_id).toLowerCase() === o.person.toLowerCase() : o.kind === 'other' ? (x.title || '').toLowerCase() === o.title.toLowerCase() : true));
  const nG = list.reduce((s, o) => s + o.gifts.length, 0);
  openSheet(`<h3>Importo peržiūra</h3>
    <p class="small muted">Rasta ${list.length} progų, ${nG} dovanų, ${data.people.length} žmonių su gimtadieniais. Nuimkite varneles nuo to, ko nereikia.</p>
    <div class="card list preview">${list.map((o, i) => `<label class="li"><input type="checkbox" data-i="${i}" ${exists(o) ? '' : 'checked'} style="width:20px;height:20px;accent-color:var(--accent)">
      <div class="grow"><div>${esc(label(o))}${exists(o) ? ' <span class="pill red">jau yra</span>' : ''}</div>
      <div class="small muted ellip">${o.gifts.length} dovan. · ${moneyShort(o.gifts.reduce((s, g) => s + (g.status !== 'idea' && g.price || 0), 0))}${o.recipients.length ? ' · ' + esc(o.recipients.join(', ')) : ''}</div></div></label>`).join('')}</div>
    <p class="small muted">Po importo žmonės su skirtingai užrašytais vardais atsiras atskirai – juos galima sujungti: <b>Žmonės → 🔗 Sujungti</b>.</p>
    <div class="actions"><button class="btn" data-x>Atšaukti</button><button class="btn primary" data-ok>Importuoti</button></div>`, el => {
    $('[data-x]', el).onclick = closeSheet;
    $('[data-ok]', el).onclick = async () => {
      const pick = $$('[data-i]', el).filter(c => c.checked).map(c => list[+c.dataset.i]);
      if (!pick.length) return toast('Nieko nepasirinkta');
      closeSheet();
      const r = await act('import', { occasions: pick, people: data.people });
      toast(`Importuota: ${r.gifts} dovanų, ${r.occasions} progų, ${r.people} žmonių`, null, 5000);
      go('occs');
    };
  });
}

// ============================================================ paleidimas
load().catch(() => { view.innerHTML = '<div class="empty">Nepavyko įkelti duomenų. Perkraukite puslapį.</div>'; });
