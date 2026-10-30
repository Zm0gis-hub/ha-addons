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
  bought: { icon: '✓', name: 'Nupirkta' },
  given: { icon: '🎁', name: 'Įteikta' },
};
const NEXT_STATUS = { idea: 'bought', bought: 'given', given: 'idea' };
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
  const c = { idea: 0, bought: 0, given: 0 };
  gifts.forEach(g => c[g.status] = (c[g.status] || 0) + 1);
  return c;
}
function countPills(gifts) {
  const c = counts(gifts), out = [];
  if (c.idea) out.push(`<span class="pill gold">💡 ${c.idea}</span>`);
  if (c.bought) out.push(`<span class="pill ok">✓ ${c.bought}</span>`);
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
  CL = [];
  VIEWS[name](route[1]);
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

// ============================================================ ARTĖJA
VIEWS.soon = () => {
  setTop('Dovanos');
  const days = S.settings.ahead_days || 60;
  const ev = upcoming(days);
  let h = `<h2>⏳ Artėjančios progos <span class="sum small">${days} d. į priekį</span></h2>`;
  if (!ev.length) h += `<div class="card empty">Artimiausiu metu progų nėra.<br><span class="small">Gimtadienius įrašykite skiltyje „Žmonės“.</span></div>`;
  h += `<div class="grid">` + ev.map((e, i) => {
    const gifts = e.occ ? giftsOf(e.occ.id) : [];
    const recs = e.occ ? recipientsOf(e.occ.id) : [];
    const n = diffDays(T(), e.date);
    let detail;
    if (!e.occ) {
      const ideas = e.person_id ? freeIdeas(e.person_id).length : 0;
      detail = `<span class="muted small">Dovanų dar nėra${ideas ? ` · <b>${ideas}</b> idėj${ideas === 1 ? 'a' : 'os'} laukia` : ''}</span>`;
    } else {
      const lines = recs.slice(0, 6).map(r => {
        const g = gifts.filter(x => x.person_id === r.person_id);
        const done = g.some(x => x.status !== 'idea');
        return `<span class="pill ${done ? 'ok' : g.length ? 'gold' : 'red'} ${pcCls(r.person_id)}" ${pcSty(r.person_id)}>${done ? '✓' : g.length ? '💡' : '·'} ${esc(pname(r.person_id))}</span>`;
      });
      if (recs.length > 6) lines.push(`<span class="pill">+${recs.length - 6}</span>`);
      detail = `<div class="chips" style="margin-top:6px">${lines.join('') || '<span class="muted small">Gavėjų dar nėra</span>'}</div>`;
    }
    return `<div class="card event ${n <= 0 ? 'today' : ''} ${e.person_id ? pcCls(e.person_id) : ''}" ${e.person_id ? pcSty(e.person_id) : ''} data-i="${i}">
      <div class="ico">${KINDS[e.kind].icon}</div>
      <div class="grow"><b>${esc(eventName(e))}</b>${e.occ ? ` <span class="muted small">· ${moneyShort(spent(gifts))}</span>` : ''}<br>${detail}</div>
      <div class="when ${dcls(e.date)}"><b>${until(e.date)}</b><span class="small">${niceDate(e.date)}${e.kind === 'birthday' ? ageBadge(e.person_id || e.occ?.person_id, e.year) : ''}</span></div>
    </div>`;
  }).join('') + `</div>`;

  const ideas = clusters(freeIdeas());
  h += `<h2>💡 Naujausios idėjos <a class="btn small" href="#ideas">Visos (${ideas.length})</a></h2>`;
  h += ideas.length ? `<div class="card list">${ideas.slice(0, 6).map(c => ideaLi(c)).join('')}</div>`
    : `<div class="card empty">Idėjų nėra. Spauskite <b>＋ Idėja</b>, kai tik kas šaus į galvą.</div>`;
  view.innerHTML = h;
  $$('.event', view).forEach(el => el.onclick = () => openEvent(ev[+el.dataset.i]));
  bindIdeaLis();
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
  const who = skipPid === -1 ? '' : others ? (others.length ? 'taip pat: ' + others.map(x => pname(x)).join(', ') : '') : namesOf(c);
  const uses = usesOf(g), cat = !noCat && g.cat ? catLabel(g.cat) : '';
  return `<div class="li" data-c="${i}"><div class="ico">💡</div>
    <div class="grow"><div class="ellip">${esc(g.title)}</div><div class="small muted ellip">${esc([cat, who, g.shop].filter(Boolean).join(' · '))}</div>
      ${uses.length ? `<div class="used ellip">↺ ${uses.length > 1 ? uses.length + '× · ' : ''}${esc(useTxt(uses[0]))}</div>` : ''}</div>
    ${g.price != null ? `<b class="nowrap">${money(g.price)}</b>` : ''}
    <button class="btn small ghost" data-assign="${i}" title="Priskirti progai">→ Proga</button></div>`;
}
function bindIdeaLis() {
  $$('[data-c]', view).forEach(el => el.onclick = e => { if (!e.target.closest('[data-assign]')) ideaQuickSheet(CL[+el.dataset.c]); });
  $$('[data-assign]', view).forEach(el => el.onclick = () => assignSheet(CL[+el.dataset.assign]));
}
// idėjos redagavimas: bendri laukai visoms kopijoms, gavėjus galima pridėti / nuimti
function clusterSheet(c) {
  if (c.gifts.length === 1 && !c.pids.length) return giftSheet(c.gifts[0], { person_ids: [] }, true, c);
  giftSheet(c.gifts[0], { person_ids: [...c.pids] }, true, c);
}
// gavėjų keitimas idėjai: nuimtiems kopija ištrinama, naujiems – sukuriama su tais pačiais laukais
async function setClusterPeople(c, pids, common) {
  const g0 = c.gifts[0];
  common = common || { title: g0.title, price: g0.price, shop: g0.shop, url: g0.url, note: g0.note, cat: g0.cat || '', status: 'idea', recipient_text: '' };
  const want = pids.length ? pids : [null];
  const keep = c.gifts.filter(x => want.includes(x.person_id));
  for (const x of c.gifts) if (!keep.includes(x)) await api('api/do/delete', { t: 'gifts', id: x.id });
  for (const x of keep) await api('api/do/save', { t: 'gifts', row: { ...common, id: x.id } });
  for (const pid of want) if (!keep.some(x => x.person_id === pid)) await api('api/do/save', { t: 'gifts', row: { ...common, person_id: pid } });
  await load();
}
// paspaudus idėją: kam ją skirti (vienam ar keliems), kuriai progai tinka, kur jau naudota
function ideaQuickSheet(c) {
  const g = c.gifts[0], pids = [...c.pids], uses = usesOf(g);
  openSheet(`<h3>💡 ${esc(g.title)}</h3>
    ${g.price != null || g.shop ? `<p class="small muted" style="margin:-8px 2px 12px">${esc([g.price != null ? money(g.price) : '', g.shop].filter(Boolean).join(' · '))}</p>` : ''}
    <span class="lbl-s">Kam skirti? (galima kelis)</span><div id="iq-p">${multiPeopleChips(pids)}</div>
    <div style="margin-top:12px">${catSelectHtml('iq', g.cat || '', pids)}</div>
    ${uses.length ? `<div class="uses"><span class="lbl-s">Jau naudota</span>${uses.map(x => `<a class="use" href="#occ/${x.occasion_id}">${STATUS[x.status]?.icon || ''} ${esc(useTxt(x))}</a>`).join('')}</div>` : ''}
    <div class="actions" style="flex-wrap:wrap">
      <button class="btn" data-edit>✏️</button><button class="btn" data-occ>→ Proga</button>
      <button class="btn" data-x>Atšaukti</button><button class="btn primary" data-ok>Išsaugoti</button></div>`, el => {
    bindMultiPeople($('#iq-p', el), pids);
    $('#iq-cat', el).onchange = () => bdAutoPick($('#iq-p', el), pids)($('#iq-cat', el).value);
    $('[data-x]', el).onclick = closeSheet;
    $$('.use', el).forEach(a => a.onclick = closeSheet);
    $('[data-edit]', el).onclick = () => clusterSheet(c);
    $('[data-occ]', el).onclick = () => assignSheet(c);
    $('[data-ok]', el).onclick = async () => {
      const cat = $('#iq-cat', el).value;
      closeSheet();
      const same = pids.length === c.pids.length && pids.every(x => c.pids.includes(x));
      if (same && cat === (g.cat || '')) return;
      await setClusterPeople(c, pids, { title: g.title, price: g.price, shop: g.shop, url: g.url, note: g.note, cat, status: 'idea', recipient_text: '' });
      toast('💡 Išsaugota' + (pids.length ? ': ' + pids.map(pname).join(', ') : '') + (cat ? ` · ${catLabel(cat)}` : ''));
    };
  });
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
  setTop(occTitle(o) + (o.kind === 'birthday' && ageAt(o.person_id, o.year) ? ` (${ageAt(o.person_id, o.year)} m.)` : ''), `<button class="icon-btn" id="occ-menu" title="Progos nustatymai">⋯</button>`, true);
  const gifts = giftsOf(o.id), recs = recipientsOf(o.id), date = occDate(o);
  const sp = spent(gifts), pl = planned(gifts), c = counts(gifts);
  const past = date && date < T();
  let h = `<div class="card summary">
    <div><div class="muted small">${occIcon(o)} ${date ? `<span class="${dcls(date)}">${niceDate(date, true)}${o.kind === 'birthday' ? ageBadge(o.person_id, o.year) : ''} · ${until(date)}</span>` : 'data nenurodyta'}</div><div class="big">${money(sp) || '0,00 €'}</div></div>
    ${o.budget ? `<div class="budget"><div class="small muted">Biudžetas ${money(o.budget)}${sp > o.budget ? ' · <b style="color:var(--danger)">viršyta</b>' : ` · liko ${money(o.budget - sp)}`}</div>
      <div class="bar ${sp > o.budget ? 'over' : ''}"><i style="width:${Math.min(100, sp / o.budget * 100)}%"></i></div></div>` : ''}
    <div class="chips">${c.idea ? `<span class="pill gold">💡 ${c.idea} idėj.${pl ? ' · ' + moneyShort(pl) : ''}</span>` : ''}
      ${c.bought ? `<span class="pill ok">✓ ${c.bought} nupirkta</span>` : ''}${c.given ? `<span class="pill">🎁 ${c.given} įteikta</span>` : ''}</div>
  </div>`;
  if (o.notes) h += `<div class="card pad pre small" style="margin-bottom:14px">${esc(o.notes)}</div>`;
  h += `<div class="occbar"><span class="muted small grow">Spauskite ženkliuką prie dovanos: 💡 idėja → ✓ nupirkta → 🎁 įteikta</span>
    <button class="btn small" id="add-rec">＋ Gavėjas</button></div>`;
  h += `<div class="grid">`;
  for (const r of recs) h += recipientCard(o, r, gifts.filter(g => g.person_id === r.person_id), past);
  const extra = gifts.filter(g => !g.person_id || !recs.some(r => r.person_id === g.person_id));
  if (extra.length || !recs.length) h += recipientCard(o, null, extra, past);
  h += `</div>`;
  view.innerHTML = h;

  $('#occ-menu').onclick = () => occasionSheet(o);
  $('#add-rec').onclick = () => recipientSheet(o);
  bindGiftRows(view, past);
  $$('[data-addg]', view).forEach(el => el.onclick = () => {
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

function recipientCard(o, r, gifts, past) {
  const pid = r ? r.person_id : null;
  const pi = pid ? pickableIdeas(pid) : null, nIdeas = pi ? pi.own.length + pi.loose.length : 0;
  const canRemove = r && !(o.kind === 'birthday' && o.person_id === pid);
  return `<div class="card rcard ${r ? pcCls(pid) : 'extra'}" ${r ? pcSty(pid) : ''}>
    <div class="rhead">
      ${r ? `<a class="name ellip" href="#person/${pid}">${esc(pname(pid))}</a>` : `<span class="grow"><b>Kiti</b> <span class="muted small">(be gavėjo)</span></span>`}
      <span class="total">${moneyShort(spent(gifts))}</span>
      ${canRemove ? `<button class="icon-btn" style="font-size:15px;min-width:30px;height:30px" data-rmrec="${r.id}" title="Pašalinti gavėją">✕</button>` : ''}
    </div>
    ${gifts.length ? `<ul class="gifts">${gifts.map(giftRow).join('')}</ul>` : `<div class="empty-g muted small">Dovanų dar nėra</div>`}
    <div class="ractions">
      <button class="btn small" data-addg="${pid || ''}">＋ Dovana</button>
      ${nIdeas ? `<button class="btn small idea-btn" data-pick="${pid}">💡 Iš idėjų${pi.own.length ? ` <b>${pi.own.length}</b>` : ''}</button>` : ''}
    </div>
  </div>`;
}

function pickIdeaSheet(o, pid) {
  const { own, loose } = pickableIdeas(pid);
  const li = g => `<li class="gift idea" data-take="${g.id}"><span class="st">💡</span><span class="t">${esc(g.title)}${g.shop ? ` <span class="shop">· ${esc(g.shop)}</span>` : ''}</span><span class="p">${money(g.price)}</span></li>`;
  openSheet(`<h3>💡 Idėja – ${esc(pname(pid))}</h3>
    <p class="muted small" style="margin-top:-6px">Pasirinkite idėją – ji bus priskirta šiai progai.</p>
    ${own.length ? `<div class="lbl-s">${esc(pname(pid))} idėjos</div><ul class="gifts pick">${own.map(li).join('')}</ul>` : ''}
    ${loose.length ? `<div class="lbl-s">Nežinia kam</div><ul class="gifts pick">${loose.map(li).join('')}</ul>` : ''}
    <div class="actions"><button class="btn" data-x>Uždaryti</button></div>`, el => {
    $('[data-x]', el).onclick = closeSheet;
    $$('[data-take]', el).forEach(x => x.onclick = async () => {
      closeSheet();
      await saveRow('gifts', { id: +x.dataset.take, occasion_id: o.id, person_id: pid });
      toast('Idėja priskirta');
    });
  });
}

function giftRow(g) {
  const st = STATUS[g.status] || STATUS.idea;
  const showTo = !g.person_id && g.recipient_text ? `<span class="to">${esc(g.recipient_text)}:</span> ` : '';
  const pmap = g.person_id && !S.recipients.some(r => r.occasion_id === g.occasion_id && r.person_id === g.person_id) ? `<span class="to">${esc(pname(g.person_id))}:</span> ` : '';
  return `<li class="gift ${g.status}" data-gift="${g.id}">
    <button class="st ${g.status}" data-st="${g.id}" title="${st.name} – spauskite, kad pakeistumėte">${st.icon}</button>
    <span class="t">${showTo}${pmap}${esc(g.title)}${g.shop ? ` <span class="shop">· ${esc(g.shop)}</span>` : ''}${g.url ? ' 🔗' : ''}</span>
    <span class="p">${money(g.price)}</span></li>`;
}
function bindGiftRows(root) {
  $$('[data-gift]', root).forEach(el => el.onclick = e => { if (!e.target.closest('[data-st]')) giftSheet(I.gifts[el.dataset.gift]); });
  $$('[data-st]', root).forEach(el => el.onclick = async () => {
    const g = I.gifts[el.dataset.st], prev = g.status, next = NEXT_STATUS[prev] || 'bought';
    await saveRow('gifts', { id: g.id, status: next });
    toast(`${STATUS[next].icon} ${STATUS[next].name}`, { label: 'Atšaukti', fn: () => saveRow('gifts', { id: g.id, status: prev }) }, 2500);
  });
}

function recipientSheet(o) {
  const have = new Set(recipientsOf(o.id).map(r => r.person_id));
  const avail = people().filter(p => !have.has(p.id));
  openSheet(`<h3>Pridėti gavėją</h3>
    ${avail.length ? `<div class="chips" style="margin-bottom:14px">${avail.map(p => `<button class="chip" data-pp="${p.id}">${esc(p.name)}</button>`).join('')}</div>` : ''}
    <label class="field"><span>Arba naujas žmogus (ar grupė, pvz. „Kaimynams“)</span><input type="text" id="np" ${avail.length ? '' : 'autofocus'} placeholder="Vardas"></label>
    <div class="actions"><button class="btn" data-x>Atšaukti</button><button class="btn primary" data-ok>Pridėti</button></div>`, el => {
    $('[data-x]', el).onclick = closeSheet;
    $$('[data-pp]', el).forEach(b => b.onclick = async () => { closeSheet(); await act('recipient_add', { occasion_id: o.id, person_id: +b.dataset.pp }); });
    const ok = async () => { const n = $('#np').value.trim(); if (!n) return; closeSheet(); await act('recipient_add', { occasion_id: o.id, name: n }); };
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
function catSelectHtml(id, cur, pids = [], none = '— bet kuriai progai —', label = 'Tinka progai') {
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
const useTxt = x => { const o = I.occasions[x.occasion_id]; return `${occTitle(o)}${x.person_id && !(o.kind === 'birthday' && o.person_id === x.person_id) ? ' · ' + pname(x.person_id) : ''}`; };

// artimiausi metai, kai ta proga dar bus
function catNextYear(key) {
  const [kind, pid, title] = key.split('|');
  if (kind === 'other') return Math.max(Y(), ...S.occasions.filter(o => o.kind === 'other' && (o.title || '').trim() === title).map(o => o.year));
  const d = kindDate(kind, Y(), I.people[+pid]);
  return d && d < T() ? Y() + 1 : Y();
}
function giftSheet(g, preset = {}, _, cluster) {
  const isNew = !g, multi = isNew || !!cluster;
  g = g || { title: '', person_id: null, occasion_id: null, status: 'idea', price: null, shop: '', url: '', note: '', recipient_text: '', ...preset };
  let status = g.status;
  const ideaMode = !g.occasion_id;
  openSheet(`<h3>${isNew ? (g.occasion_id ? 'Nauja dovana' : '💡 Nauja idėja') : 'Dovana'}</h3>
    <div class="fgrid">
      <label class="field full"><span>Kas</span><input type="text" id="g-title" value="${esc(g.title)}" ${isNew ? 'autofocus' : ''} placeholder="pvz. Šilko pagalvės užvalkalas"></label>
      ${multi ? `<div class="field full"><span class="lbl-s">Kam (galima pažymėti kelis)</span><div id="g-multi">${multiPeopleChips(preset.person_ids || g.person_ids || (g.person_id ? [g.person_id] : []))}</div></div>`
        : `<label class="field"><span>Kam</span><select id="g-person">${personOptions(g.person_id, '— kitas / nežinia —')}</select></label>`}
      <label class="field" id="g-rt-wrap"><span>Kam (laisvai)</span><input type="text" id="g-rt" value="${esc(g.recipient_text)}" placeholder="pvz. kaimynams"></label>
      ${ideaMode ? `<div class="full">${catSelectHtml('g', g.cat, preset.person_ids || (g.person_id ? [g.person_id] : []))}</div>`
        : occPickHtml('g', I.occasions[g.occasion_id] ? { cat: catKey(I.occasions[g.occasion_id]), year: I.occasions[g.occasion_id].year } : {}, preset.person_ids || (g.person_id ? [g.person_id] : []))}
      <div class="full"><div class="seg" id="g-status">${Object.entries(STATUS).map(([k, s]) => `<button type="button" data-s="${k}" class="${k === status ? 'on' : ''}">${s.icon} ${s.name}</button>`).join('')}</div></div>
      <label class="field"><span>Kaina, €</span><input type="text" inputmode="decimal" id="g-price" value="${g.price != null ? fmtNum(g.price) : ''}"></label>
      <label class="field"><span>Parduotuvė / iš kur</span><input type="text" id="g-shop" value="${esc(g.shop)}" list="shops"></label>
      <label class="field full"><span>Nuoroda</span><div class="row"><input type="url" id="g-url" value="${esc(g.url)}" placeholder="https://">${g.url ? `<a class="btn" href="${esc(g.url)}" target="_blank" rel="noopener">Atidaryti</a>` : ''}</div></label>
      <label class="field full"><span>Pastaba</span><textarea id="g-note" placeholder="dydis, spalva, kodėl...">${esc(g.note)}</textarea></label>
    </div>
    <datalist id="shops">${[...new Set(S.gifts.map(x => x.shop).filter(Boolean))].sort(lt).map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    <div class="actions">${isNew ? '' : '<button class="btn danger" data-del>Ištrinti</button>'}<button class="btn" data-x>Atšaukti</button><button class="btn primary" data-ok>Išsaugoti</button></div>`, el => {
    const rtWrap = $('#g-rt-wrap', el), sel = $('#g-person', el);
    const pids = multi ? [...(preset.person_ids || g.person_ids || (g.person_id ? [g.person_id] : []))] : null;
    const upd = () => rtWrap.style.display = (multi ? pids.length : sel.value) ? 'none' : '';
    if (multi) bindMultiPeople($('#g-multi', el), pids, upd); else sel.onchange = upd;
    upd();
    // gimtadienio proga – jei gavėjas nepasirinktas, juo tampa tas žmogus
    const getOcc = bindOccPick(el, 'g', v => {
      const [kind, pid] = v.split('|');
      if (kind === 'birthday' && +pid) {
        if (multi && !pids.length) $(`#g-multi .chip[data-p="${pid}"]`, el)?.click();
        else if (!multi && !sel.value) { sel.value = pid; upd(); }
      }
    });
    $$('#g-status button', el).forEach(b => b.onclick = () => { status = b.dataset.s; $$('#g-status button', el).forEach(x => x.classList.toggle('on', x === b)); });
    $('[data-x]', el).onclick = closeSheet;
    const save = async () => {
      const title = $('#g-title').value.trim();
      if (!title) return toast('Įrašykite, kas per dovana');
      const occasion_id = ideaMode ? null : await getOcc();
      const row = {
        title, person_id: multi ? null : +sel.value || null, recipient_text: (multi ? pids.length : sel.value) ? '' : $('#g-rt').value,
        occasion_id, cat: ideaMode ? $('#g-cat').value : (g.cat || ''), status, price: pnum($('#g-price').value), shop: $('#g-shop').value,
        url: $('#g-url').value, note: $('#g-note').value,
      };
      closeSheet();
      if (cluster) { const { person_id, ...common } = row; return setClusterPeople(cluster, pids, common); }
      if (!isNew) { row.id = g.id; await saveRow('gifts', row); return; }
      const n = await addForMany(row, pids);
      toast((row.occasion_id ? 'Dovana įrašyta' : '💡 Idėja įrašyta') + (n > 1 ? ` (${n} gavėjams)` : ''));
    };
    $('[data-ok]', el).onclick = save;
    $('#g-title', el).onkeydown = e => { if (e.key === 'Enter' || e.keyCode === 13) save(); };
    if (!isNew) $('[data-del]', el).onclick = () => confirmSheet(`Ištrinti „${g.title}“${cluster ? ' visiems' : ''}?`, 'Ištrinti', async () => {
      for (const x of cluster ? cluster.gifts : [g]) await api('api/do/delete', { t: 'gifts', id: x.id });
      await load();
    });
  });
}

// kelių gavėjų pasirinkimas (naujai idėjai): „Nežinia kam“ arba keli žmonės / grupės
function multiPeopleChips(sel) {
  return `<div class="chips multi"><button type="button" class="chip ${sel.length ? '' : 'on'}" data-p="">Nežinia kam</button>
    ${people().map(p => `<button type="button" class="chip ${sel.includes(p.id) ? 'on' : ''}" data-p="${p.id}">${esc(pLabel(p))}</button>`).join('')}</div>`;
}
function bindMultiPeople(box, sel, after) {
  $$('.chip', box).forEach(b => b.onclick = () => {
    const id = +b.dataset.p;
    if (!id) sel.length = 0;
    else if (sel.includes(id)) sel.splice(sel.indexOf(id), 1);
    else sel.push(id);
    $$('.chip', box).forEach(x => x.classList.toggle('on', +x.dataset.p ? sel.includes(+x.dataset.p) : !sel.length));
    if (after) after();
  });
}
// ta pati idėja keliems – kiekvienam atskiras įrašas (priskyrus vienam, kitiems lieka)
async function addForMany(row, pids) {
  const list = pids.length ? pids : [null];
  for (const pid of list) await api('api/do/save', { t: 'gifts', row: { ...row, person_id: pid } });
  await load();
  return list.length;
}

// greitas idėjos įrašymas (ypač telefone)
$('#fab').onclick = () => {
  const preset = {};
  if (route[0] === 'person') preset.person_id = +route[1];
  openSheet(`<h3>💡 Nauja idėja</h3>
    <div class="stack">
      <input type="text" id="q-title" autofocus placeholder="Kokia idėja? (pvz. Kava 8,99)">
      <div id="q-people">${multiPeopleChips(preset.person_id ? [preset.person_id] : [])}</div>
      ${catSelectHtml('q', '', preset.person_id ? [preset.person_id] : [])}
    </div>
    <div class="actions"><button class="btn" data-more>Daugiau…</button><button class="btn primary" data-ok>Įrašyti</button></div>`, el => {
    const pids = preset.person_id ? [preset.person_id] : [];
    bindMultiPeople($('#q-people', el), pids, () => $('#q-title').focus());
    $('#q-cat', el).onchange = () => bdAutoPick($('#q-people', el), pids)($('#q-cat', el).value);
    const ok = async () => {
      const v = $('#q-title').value.trim();
      if (!v) return $('#q-title').focus();
      const cat = $('#q-cat', el).value;
      closeSheet();
      const { title, price } = splitPrice(v);
      await addForMany({ title, price, status: 'idea', cat }, pids);
      toast('💡 Idėja įrašyta' + (pids.length ? ` (${pids.map(pname).join(', ')})` : '') + (cat ? ` · ${catLabel(cat)}` : ''));
    };
    $('[data-ok]', el).onclick = ok;
    $('#q-title').onkeydown = e => { if (e.key === 'Enter' || e.keyCode === 13) ok(); };
    $('[data-more]', el).onclick = () => { const s = splitPrice($('#q-title').value); giftSheet(null, { ...s, cat: $('#q-cat', el).value, person_ids: [...pids] }); };
  });
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
  setTop('Progos', `<button class="btn small primary" id="new-occ">＋ Nauja proga</button>`);
  const years = [...new Set([Y(), ...S.occasions.map(o => o.year)])].sort((a, b) => b - a);
  const yr = years.includes(UI.year) ? UI.year : Y();
  const list = S.occasions.filter(o => o.year === yr).sort((a, b) => (occDate(a) || '9').localeCompare(occDate(b) || '9'));
  const total = spent(S.gifts.filter(g => list.some(o => o.id === g.occasion_id)));
  let h = `<div class="chips" style="margin-bottom:6px">${years.map(y => `<button class="chip ${y === yr ? 'on' : ''} ${y === Y() ? 'cur' : ''}" data-y="${y}">${y}</button>`).join('')}</div>`;
  h += `<h2>${yr} m. progos <span class="sum">Iš viso: ${money(total) || '0,00 €'}</span></h2>`;
  if (!list.length) h += `<div class="card empty">${yr} m. progų dar nėra.<br><span class="small">Jos atsiranda pačios, kai atidarote artėjančią progą, arba spauskite „＋ Nauja proga“.</span></div>`;
  const groups = [['Kalėdos', list.filter(o => o.kind === 'christmas')], ['Gimtadieniai', list.filter(o => o.kind === 'birthday')],
    ['Šventės ir kitos progos', list.filter(o => o.kind !== 'christmas' && o.kind !== 'birthday')]];
  for (const [name, arr] of groups) {
    if (!arr.length) continue;
    h += `<div class="year-h">${name}</div><div class="grid narrow">` + arr.map(o => {
      const gifts = giftsOf(o.id), d = occDate(o);
      return `<div class="card event ${o.kind === 'birthday' ? pcCls(o.person_id) : ''}" ${o.kind === 'birthday' ? pcSty(o.person_id) : ''} data-o="${o.id}"><div class="ico">${occIcon(o)}</div>
        <div class="grow"><b>${esc(occName(o))}</b><div class="small muted">${d ? `<span class="${dcls(d)}">${niceDate(d)}${o.kind === 'birthday' ? ageBadge(o.person_id, o.year) : ''}</span>` : ''}${recipientsOf(o.id).length > 1 ? ` · ${recipientsOf(o.id).length} gavėjai` : ''}</div>
        <div style="margin-top:4px">${countPills(gifts) || '<span class="small muted">tuščia</span>'}</div></div>
        <div class="when"><b>${moneyShort(spent(gifts))}</b></div></div>`;
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
  setTop('Idėjos', `<button class="btn small" id="paste">📋<span class="lbl"> Įklijuoti sąrašą</span></button>`);
  const all = clusters(freeIdeas());
  const qp = [];
  let h = `<div class="card pad stack"><div class="row"><input type="text" id="qi" class="grow" placeholder="Kokia idėja? (pvz. Kava 8,99)"><button class="btn primary" id="qa">Įrašyti</button></div>
    <div id="qmore" hidden class="stack"><div id="qp">${multiPeopleChips(qp)}</div>${catSelectHtml('qo', '')}</div></div>`;
  h += `<h2>💡 Laukiančios idėjos <span class="sum">${all.length}</span></h2>`;
  if (!all.length) h += `<div class="card empty">Laukiančių idėjų nėra.</div>`;
  const byCat = new Map();
  for (const c of all) { const k = KINDS[(c.gifts[0].cat || '').split('|')[0]] ? c.gifts[0].cat : ''; if (!byCat.has(k)) byCat.set(k, []); byCat.get(k).push(c); }
  const keys = [...byCat.keys()].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0) || lt(catLabel(a), catLabel(b)));
  for (const k of keys) {
    if (keys.length > 1 || k) h += `<div class="cat-h">${k ? esc(catLabel(k)) : 'Bet kuriai progai'} <span>${byCat.get(k).length}</span></div>`;
    h += `<div class="card list compact">${byCat.get(k).map(c => ideaLi(c, null, true)).join('')}</div>`;
  }
  const assigned = S.gifts.filter(g => g.occasion_id && g.status === 'idea' && occDate(I.occasions[g.occasion_id] || {}) >= T());
  if (assigned.length) {
    h += `<h2>Priskirtos progoms, bet dar nenupirktos</h2><div class="card list">` + assigned.map(g => {
      const o = I.occasions[g.occasion_id];
      return `<div class="li" data-go="${o.id}"><div class="ico">${occIcon(o)}</div><div class="grow"><div class="ellip">${esc(g.title)}</div>
        <div class="small muted ellip">${esc([pname(g.person_id) || g.recipient_text, occTitle(o)].filter(Boolean).join(' · '))}</div></div>${g.price != null ? `<b class="nowrap">${money(g.price)}</b>` : ''}</div>`;
    }).join('') + `</div>`;
  }
  view.innerHTML = h;
  bindIdeaLis();
  bindMultiPeople($('#qp'), qp, () => $('#qi').focus());
  $('#qo-cat').onchange = () => bdAutoPick($('#qp'), qp)($('#qo-cat').value);
  $('#qi').oninput = () => $('#qmore').hidden = !$('#qi').value.trim();
  $$('[data-go]', view).forEach(el => el.onclick = () => go('occ/' + el.dataset.go));
  $('#paste').onclick = pasteSheet;
  const add = async () => {
    const v = $('#qi').value.trim(); if (!v) return $('#qi').focus();
    const { title, price } = splitPrice(v);
    const cat = $('#qo-cat').value;
    await addForMany({ title, price, status: 'idea', cat }, qp);
    toast('💡 Idėja įrašyta' + (qp.length ? ` (${qp.map(pname).join(', ')})` : '') + (cat ? ` · ${catLabel(cat)}` : ''));
    $('#qi')?.focus();
  };
  $('#qa').onclick = add;
  $('#qi').onkeydown = e => { if (e.key === 'Enter' || e.keyCode === 13) add(); };
};

// ============================================================ ŽMONĖS
const nextBd = p => { if (!p.birthday || p.is_group) return null; let d = mdInYear(p.birthday, Y()); if (d < T()) d = mdInYear(p.birthday, Y() + 1); return d; };
const bdLine = p => { const d = nextBd(p); return d ? `<span class="${dcls(d)}">🎂 ${mdNice(p.birthday)}${ageBadge(p.id, +d.slice(0, 4))} · ${until(d)}</span>` : ''; };
// vardai, panašūs į grupę („A ir B“, „Tėvams“, „Šeimai“)
const looksGroup = p => !p.is_group && /\s(ir|su)\s|,|\+|&|ams$|iems$|ėms$|oms$|šeim|vaik|tėv(ai|ams|ų)/i.test(p.name.trim()) && !(UI.notGroup || []).includes(p.id);

VIEWS.people = () => {
  setTop('Žmonės', `<a class="btn small" href="#merge" title="Sujungti">🔗<span class="lbl"> Sujungti</span>${mergePairs().length ? ` (${mergePairs().length})` : ''}</a>
    <button class="btn small" id="new-g" title="Nauja grupė">＋<span class="lbl"> Grupė</span><span class="ico-only">👥</span></button>
    <button class="btn small primary" id="new-p" title="Naujas žmogus">＋<span class="lbl"> Žmogus</span><span class="ico-only">👤</span></button>`);
  const all = people(), arch = people(true).filter(p => p.archived);
  const groups = all.filter(p => p.is_group), indiv = all.filter(p => !p.is_group);
  const sugg = indiv.filter(looksGroup);
  let h = '';
  if (sugg.length) h += `<div class="card pad stack" style="margin-bottom:14px"><b>Panašu į grupes</b>
    <div class="small muted">Šie įrašai, atrodo, yra keli žmonės kartu. Pažymėjus grupe, jai galima priskirti narius.</div>
    <div class="list">${sugg.map(p => `<div class="li" style="cursor:default"><span class="grow">${esc(p.name)}</span>
      <button class="btn small primary" data-mkg="${p.id}">👥 Grupė</button><button class="btn small ghost" data-nog="${p.id}">Ne</button></div>`).join('')}</div></div>`;
  h += `<h2>👥 Grupės <span class="sum">${groups.length}</span></h2>`;
  h += groups.length ? `<div class="grid narrow">` + groups.map(g => {
    const ms = membersOf(g.id).filter(m => !m.archived), ideas = freeIdeas(g.id).length;
    return `<div class="card person ${pcCls(g.id)}" ${pcSty(g.id)} data-p="${g.id}"><div class="row"><span class="nm grow ellip">${esc(g.name)}</span>${ideas ? `<span class="pill gold">💡 ${ideas}</span>` : ''}${g.archived ? '<span class="pill">archyve</span>' : ''}</div>
      ${ms.length ? `<div class="members">${ms.map(m => `<a class="member" href="#person/${m.id}"><span class="ellip">${esc(m.name)}</span><span class="small">${bdLine(m)}</span></a>`).join('')}</div>`
        : '<div class="small muted">Narių dar nėra – ✏️ priskirkite</div>'}</div>`;
  }).join('') + `</div>` : `<div class="card empty">Grupių dar nėra. Grupė – keli žmonės, kuriems dovanojama kartu (pvz. „A tėvai“).</div>`;
  h += `<h2>👤 Žmonės <span class="sum">${indiv.length}</span></h2>`;
  h += indiv.length ? `<div class="grid narrow">` + indiv.map(p => {
    const ideas = freeIdeas(p.id).length, gs = groupsOf(p.id);
    return `<div class="card person ${pcCls(p.id)}" ${pcSty(p.id)} data-p="${p.id}"><div class="row"><span class="nm grow ellip">${esc(p.name)}</span>${ideas ? `<span class="pill gold">💡 ${ideas}</span>` : ''}${p.archived ? '<span class="pill">archyve</span>' : ''}</div>
      ${p.birthday ? `<div class="small muted">${bdLine(p)}</div>` : ''}
      ${gs.length ? `<div class="small muted ellip">👥 ${gs.map(g => esc(g.name)).join(', ')}</div>` : ''}</div>`;
  }).join('') + `</div>` : `<div class="card empty">Žmonių dar nėra. Pridėkite artimuosius ir jų gimtadienius.</div>`;
  // archyvas: nerodomi sąrašuose, bet istorija lieka; bet kada galima grąžinti
  if (arch.length) h += `<h2 id="arch" style="cursor:pointer">🗄 Archyvas <span class="sum">${arch.length} ${UI.arch ? '▾' : '▸'}</span></h2>` + (UI.arch ? `<div class="card list">${arch.map(p =>
    `<div class="li" data-p="${p.id}"><span class="grow ellip">${esc(pLabel(p))}</span><button class="btn small" data-unarch="${p.id}">↩ Išarchyvuoti</button></div>`).join('')}</div>` : '');
  view.innerHTML = h;
  $$('[data-p]', view).forEach(el => el.onclick = e => { if (!e.target.closest('a.member, [data-unarch]')) go('person/' + el.dataset.p); });
  $$('[data-mkg]', view).forEach(b => b.onclick = async () => { const id = +b.dataset.mkg; await saveRow('people', { id, is_group: 1 }, true); render(); personSheet(I.people[id]); });
  $$('[data-nog]', view).forEach(b => b.onclick = () => { UI.notGroup = [...(UI.notGroup || []), +b.dataset.nog]; saveUI(); render(); });
  $('#new-p').onclick = () => personSheet(null);
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
      <label class="field full"><span>Pastabos (pomėgiai, dydžiai, ko nedovanoti)</span><textarea id="p-notes">${esc(p.notes)}</textarea></label>
      ${isNew ? '' : `<label class="check full"><input type="checkbox" id="p-arch" ${p.archived ? 'checked' : ''}> Archyvuoti (paslėpti)</label>`}
    </div>
    <div class="actions">${isNew ? '' : '<button class="btn danger" data-del>Ištrinti</button>'}<button class="btn" data-x>Atšaukti</button><button class="btn primary" data-ok>Išsaugoti</button></div>`, el => {
    $('[data-x]', el).onclick = closeSheet;
    const upd = () => {
      const g = $('#p-isg').checked;
      $('#p-ind').hidden = g; $('#p-grp').hidden = !g;
      $('#p-name-l').textContent = g ? 'Grupės pavadinimas (pvz. „A tėvai“)' : 'Vardas';
    };
    $('#p-isg').onchange = upd; upd();
    let color = p.color || '';
    $$('#p-color .sw', el).forEach(b => b.onclick = () => { color = b.dataset.c; $$('#p-color .sw', el).forEach(x => x.classList.toggle('on', x === b)); });
    const save = async () => {
      const isG = $('#p-isg').checked;
      const row = { name: $('#p-name').value.trim(), notes: $('#p-notes').value, color, is_group: isG ? 1 : 0 };
      if (!row.name) return toast('Įrašykite vardą');
      if (!isG) {
        const b = parseBirth($('#p-bd').value);
        if (b === null) return toast('Gimimo datą rašykite taip: 1990-01-15 arba 01-15');
        Object.assign(row, b);
      }
      if (!isNew) { row.id = p.id; row.archived = $('#p-arch').checked ? 1 : 0; }
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
  setTop(pLabel(p), `<button class="icon-btn" id="p-arch-t" title="${p.archived ? 'Išarchyvuoti' : 'Archyvuoti (paslėpti iš sąrašų)'}">${p.archived ? '↩' : '🗄'}</button><button class="icon-btn" id="p-edit" title="Redaguoti">✏️</button>`, true);
  const ideas = clusters(freeIdeas()).filter(c => c.pids.includes(p.id));
  const gs = groupsOf(p.id), ms = p.is_group ? membersOf(p.id) : [];
  // istorija: savo dovanos ir (žmogui) – grupių, kurioms priklauso, dovanos
  const ids = new Set([p.id, ...gs.map(g => g.id)]);
  const gifts = S.gifts.filter(g => ids.has(g.person_id) && g.occasion_id && I.occasions[g.occasion_id]);
  let info = '';
  if (p.is_group) info = ms.length ? `<div class="chips">${ms.map(m => `<a class="chip" href="#person/${m.id}">${esc(m.name)}</a>`).join('')}</div>` : '<span class="muted small">Narių nėra – ✏️ priskirkite</span>';
  else info = [p.birthday ? `<div class="small">${bdLine(p)}</div>` : '',
    gs.length ? `<div class="chips" style="margin-top:6px">${gs.map(g => `<a class="chip" href="#person/${g.id}">👥 ${esc(g.name)}</a>`).join('')}</div>` : ''].join('');
  let h = (info || p.notes) ? `<div class="card summary ${pcCls(p.id)}" ${pcSty(p.id)}>${info ? `<div>${info}</div>` : ''}
    ${p.notes ? `<div class="grow pre small" style="min-width:200px">${esc(p.notes)}</div>` : ''}</div>` : '';
  h += `<div class="grid"><div><h2 style="margin-top:4px">💡 Idėjos <span class="sum">${ideas.length}</span></h2>
    <div class="card list">${ideas.map(c => ideaLi(c, p.id)).join('')}
    <div class="addline" style="padding:10px"><input type="text" id="pi" placeholder="＋ Nauja idėja (Enter)"></div></div></div>`;
  h += `<div><h2 style="margin-top:4px">🎁 Dovanų istorija</h2>`;
  const byYear = new Map();
  for (const g of gifts) { const y = I.occasions[g.occasion_id].year; if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(g); }
  if (!gifts.length) h += `<div class="card empty">Dovanų įrašų dar nėra.</div>`;
  for (const y of [...byYear.keys()].sort((a, b) => b - a)) {
    const arr = byYear.get(y);
    const keys = [...new Set(arr.map(g => g.occasion_id + ':' + g.person_id))]
      .sort((a, b) => (occDate(I.occasions[+a.split(':')[0]]) || '').localeCompare(occDate(I.occasions[+b.split(':')[0]]) || ''));
    h += `<div class="year-h row">${y} <span class="grow"></span>${moneyShort(spent(arr))}</div><div class="card" style="padding:4px 0">`;
    for (const k of keys) {
      const [oid, pid] = k.split(':').map(Number), o = I.occasions[oid];
      h += `<div class="small muted" style="padding:6px 14px 0"><a href="#occ/${oid}" style="color:inherit">${occIcon(o)} ${esc(occName(o))}</a>${pid !== p.id ? ` · 👥 ${esc(pname(pid))}` : ''}</div>
        <ul class="gifts">${arr.filter(g => g.occasion_id === oid && g.person_id === pid).map(giftRow).join('')}</ul>`;
    }
    h += `</div>`;
  }
  h += `</div></div>`;
  if (p.archived) h = `<div class="card pad row" style="margin-bottom:12px;background:var(--chip)"><span class="grow">🗄 Archyvuota – nerodoma sąrašuose, istorija išsaugota.</span><button class="btn small" id="p-unarch">↩ Išarchyvuoti</button></div>` + h;
  view.innerHTML = h;
  $('#p-edit').onclick = () => personSheet(p);
  const setArch = async v => {
    await saveRow('people', { id: p.id, archived: v });
    toast(v ? '🗄 Archyvuota' : 'Grąžinta iš archyvo', { label: 'Atšaukti', fn: () => saveRow('people', { id: p.id, archived: v ? 0 : 1 }) });
  };
  $('#p-arch-t').onclick = () => setArch(p.archived ? 0 : 1);
  if ($('#p-unarch')) $('#p-unarch').onclick = () => setArch(0);
  bindIdeaLis(); bindGiftRows(view);
  $('#pi').onkeydown = async e => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    const { title, price } = splitPrice(e.target.value);
    await saveRow('gifts', { title, price, person_id: p.id, status: 'idea' });
    $('#pi')?.focus();
  };
};

// ============================================================ STATISTIKA
VIEWS.stats = () => {
  setTop('Statistika');
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
  h += `<div class="grid" style="margin-top:4px"><div><h2>${yr}: pagal progą</h2>${bars(byKind)}</div><div><h2>${yr}: pagal žmogų</h2>${bars(byPerson)}</div></div>`;
  if (byShop.length) h += `<h2>Dažniausios parduotuvės (visi metai)</h2>${bars(byShop)}`;
  h += `<p class="small muted center">Skaičiuojamos tik nupirktos ir įteiktos dovanos su kaina.</p>`;
  view.innerHTML = h;
  $$('[data-y]', view).forEach(b => b.onclick = () => { UI.syear = +b.dataset.y; saveUI(); render(); });
};

// ============================================================ PAIEŠKA
VIEWS.search = () => {
  setTop('Paieška');
  view.innerHTML = `<input type="search" id="sq" placeholder="Ar jau dovanojom? Ieškokite dovanos, parduotuvės, žmogaus…" value="${esc(UI.sq || '')}" autofocus>
    <div id="sr" style="margin-top:14px"></div>`;
  const run = () => {
    const q = $('#sq').value.trim().toLowerCase();
    UI.sq = q; saveUI();
    if (q.length < 2) { $('#sr').innerHTML = '<div class="empty">Įveskite bent 2 raides.</div>'; return; }
    const hit = s => String(s || '').toLowerCase().includes(q);
    const ps = people(true).filter(p => hit(p.name) || hit(p.notes));
    const gs = S.gifts.filter(g => hit(g.title) || hit(g.shop) || hit(g.note) || hit(g.recipient_text) || hit(pname(g.person_id)))
      .sort((a, b) => (I.occasions[b.occasion_id]?.year || 9999) - (I.occasions[a.occasion_id]?.year || 9999));
    let h = ps.length ? `<div class="chips" style="margin-bottom:12px">${ps.map(p => `<a class="chip" href="#person/${p.id}">👤 ${esc(p.name)}</a>`).join('')}</div>` : '';
    h += gs.length ? `<div class="card list">${gs.slice(0, 200).map(g => {
      const o = I.occasions[g.occasion_id];
      return `<div class="li" data-g="${g.id}"><div class="ico">${STATUS[g.status].icon}</div><div class="grow"><div class="ellip">${esc(g.title)}${g.shop ? ` <span class="muted small">· ${esc(g.shop)}</span>` : ''}</div>
        <div class="small muted">${esc([pname(g.person_id) || g.recipient_text, o ? occTitle(o) : 'laukianti idėja'].filter(Boolean).join(' · '))}</div></div>${g.price != null ? `<b class="nowrap">${money(g.price)}</b>` : ''}</div>`;
    }).join('')}</div>` : `<div class="empty">Nieko nerasta.</div>`;
    $('#sr').innerHTML = h;
    $$('[data-g]', $('#sr')).forEach(el => el.onclick = () => giftSheet(I.gifts[el.dataset.g]));
  };
  $('#sq').oninput = run; run();
  setTimeout(() => $('#sq').focus(), 50);
};

// ============================================================ NUSTATYMAI
VIEWS.settings = () => {
  setTop('Nustatymai');
  const st = S.settings;
  view.innerHTML = `<div class="grid">
    <div class="card pad stack"><b>Artėjančios progos</b>
      <label class="field"><span>Kiek dienų į priekį rodyti</span><input type="number" id="s-days" value="${st.ahead_days}"></label>
      <div class="small muted">Kurias šventes rodyti (gimtadieniai rodomi visada):</div>
      ${HOLIDAYS.map(k => `<label class="check"><input type="checkbox" data-h="${k}" ${(st.holidays || []).includes(k) ? 'checked' : ''}> ${KINDS[k].icon} ${KINDS[k].name}</label>`).join('')}
      <button class="btn primary" id="s-save">Išsaugoti</button></div>
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
    <p class="small muted">Po importo žmonės su skirtingai užrašytais vardais atsiras atskirai – juos galima sujungti žmogaus lange (✏️ → Sujungti).</p>
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
