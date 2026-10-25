/* Receptai ir pirkiniai – programos sąsaja */
'use strict';

// ------------------------------------------------------------ pagalbinės
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
let S = null;            // visa būsena iš serverio
let IDX = {};            // greitos paieškos žemėlapiai
let busyEditing = false; // redagavimo formose nepersipiešiam
const UI = JSON.parse(localStorage.getItem('receptai_ui') || '{}');
function saveUI() { try { localStorage.setItem('receptai_ui', JSON.stringify(UI)); } catch (e) {} }

const DAYS = ['Sekmadienis', 'Pirmadienis', 'Antradienis', 'Trečiadienis', 'Ketvirtadienis', 'Penktadienis', 'Šeštadienis'];
const DAYS_SHORT = ['Sk', 'Pr', 'An', 'Tr', 'Kt', 'Pn', 'Št'];
const MONTHS = ['sausio', 'vasario', 'kovo', 'balandžio', 'gegužės', 'birželio', 'liepos', 'rugpjūčio', 'rugsėjo', 'spalio', 'lapkričio', 'gruodžio'];
const UNITS = ['', 'g', 'kg', 'ml', 'l', 'vnt', 'šaukštas', 'šaukštelis', 'stiklinė', 'skiltelė', 'pakelis', 'žiupsnelis', 'riekė', 'gabalas', 'pagal skonį'];

function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms);
}

async function api(path, data) {
  const opt = data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  let r;
  try { r = await fetch(path, opt); }
  catch (e) { toast('Nėra ryšio su serveriu'); throw e; }
  if (r.status === 401) { location.href = 'login.html'; throw new Error('auth'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || 'Klaida'); throw new Error(j.error || r.status); }
  return j;
}

async function act(name, data, opts = {}) {
  const res = await api('api/do/' + name, data || {});
  await load(opts.keep);
  return res;
}

async function load(noRender) {
  S = await api('api/state');
  buildIndex();
  if (!noRender) render();
}

function buildIndex() {
  IDX = { p: {}, r: {}, s: {}, ps: {} };
  S.products.forEach(p => IDX.p[p.id] = p);
  S.recipes.forEach(r => IDX.r[r.id] = r);
  S.sections.forEach(s => IDX.s[s.id] = s);
  S.pstate.forEach(x => IDX.ps[x.product_id] = x);
}

// sinchronizacija tarp telefonų – tikrinam kas 4 s
setInterval(async () => {
  if (!S || document.hidden || busyEditing || !$('#sheet').hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
  try {
    const v = await (await fetch('api/version')).json();
    if (v.version !== S.version) {
      const y = window.scrollY; await load(); window.scrollTo(0, y);
    }
  } catch (e) {}
}, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S && !busyEditing) load().catch(() => {}); });

// ------------------------------------------------------------ skaičiai ir kiekiai
function fmtNum(n) {
  if (n == null || isNaN(n)) return '';
  const fr = { 0.25: '¼', 0.5: '½', 0.75: '¾', 0.33: '⅓', 0.67: '⅔' };
  const w = Math.floor(n), f = Math.round((n - w) * 100) / 100;
  if (n < 20 && fr[f]) return (w ? w : '') + fr[f];
  const r = n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return String(r).replace('.', ',');
}
function baseUnit(qty, unit) {
  const u = (unit || '').toLowerCase();
  if (u === 'kg') return [qty * 1000, 'g'];
  if (u === 'l') return [qty * 1000, 'ml'];
  return [qty, unit || ''];
}
const UNIT_SHORT = { 'šaukštas': 'v. š.', 'šaukštelis': 'a. š.', 'skiltelė': 'skilt.', 'stiklinė': 'stikl.', 'pakelis': 'pak.', 'žiupsnelis': 'žiupsn.', 'gabalas': 'gab.', 'riekė': 'riek.' };
function fmtAmount(qty, unit) {
  if (qty == null) return unit || '';
  unit = UNIT_SHORT[unit] || unit;
  if (unit === 'g' && qty >= 1000) return fmtNum(qty / 1000) + ' kg';
  if (unit === 'ml' && qty >= 1000) return fmtNum(qty / 1000) + ' l';
  return fmtNum(qty) + (unit ? ' ' + unit : '');
}
function fmtAmounts(map) { // {unit: qty|null}
  return Object.entries(map).map(([u, q]) => fmtAmount(q, u)).filter(Boolean).join(' + ');
}

// Eilutės atpažinimas: "200 g svogūnų (smulkiai)", "1/2 šaukštelio druskos"
const UNIT_RX = [
  [/^(kg|kilogram\p{L}*)\.?$/iu, 'kg'], [/^(g|gr|gramų|gramai|gramo)\.?$/iu, 'g'],
  [/^(ml|mililitr\p{L}*)\.?$/iu, 'ml'], [/^(l|litr\p{L}*)\.?$/iu, 'l'],
  [/^(vnt|vienet\p{L}*)\.?$/iu, 'vnt'], [/^(a\.?\s?š\.?|arb\.?|šaukštel\p{L}*|saukstel\p{L}*)$/iu, 'šaukštelis'],
  [/^(v\.?\s?š\.?|šaukšt\p{L}*|saukst\p{L}*)$/iu, 'šaukštas'], [/^(stiklin\p{L}*)$/iu, 'stiklinė'],
  [/^(skiltel\p{L}*)$/iu, 'skiltelė'], [/^(pakel\p{L}*|pak\.)$/iu, 'pakelis'], [/^(žiupsn\p{L}*|ziupsn\p{L}*)$/iu, 'žiupsnelis'],
  [/^(riek\p{L}*)$/iu, 'riekė'], [/^(gabal\p{L}*)$/iu, 'gabalas'],
  [/^(cups?|c\.)$/iu, 'stiklinė'], [/^(tbsp|tablespoons?|tbs\.?)$/iu, 'šaukštas'], [/^(tsp|teaspoons?)$/iu, 'šaukštelis'],
  [/^(grams?)$/iu, 'g'], [/^(pcs|pieces?|cloves?)$/iu, 'vnt'],
];
function parseLine(line) {
  let s = line.trim().replace(/^[-•*·]\s*/, '');
  if (!s) return null;
  let note = '';
  const pm = s.match(/\(([^)]*)\)/); if (pm) { note = pm[1]; s = s.replace(pm[0], '').trim(); }
  if (/pagal skon/i.test(s)) { s = s.replace(/,?\s*pagal skon\p{L}*/iu, '').trim(); note = note ? note + ', pagal skonį' : 'pagal skonį'; }
  let qty = null, unit = '';
  const nm = s.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?|[½¼¾])\s*/);
  if (nm) {
    let t = nm[1].replace(',', '.');
    if (t.includes('-')) t = t.split('-')[1].trim(); // "2-3" -> 3
    if (/^\d+\s+\d+\/\d+$/.test(t)) { const [a, b] = t.split(/\s+/); const [x, y] = b.split('/'); qty = +a + x / y; }
    else if (t.includes('/')) { const [x, y] = t.split('/'); qty = x / y; }
    else qty = { '½': .5, '¼': .25, '¾': .75 }[t] ?? parseFloat(t);
    s = s.slice(nm[0].length);
    const um = s.match(/^([^\s]+(?:\s?š\.)?)\s*/u);
    if (um) {
      const hit = UNIT_RX.find(([rx]) => rx.test(um[1]));
      if (hit) { unit = hit[1]; s = s.slice(um[0].length); }
    }
  }
  const cm = s.split(/,\s*/);
  let name = cm.shift().trim();
  if (cm.length) note = [cm.join(', '), note].filter(Boolean).join(', ');
  if (!name) return null;
  const hadUnit = !!unit;
  if (qty != null && !unit) unit = 'vnt';
  // kilmininkas tik po mato vieneto („2 kg morkų“, „500 ml pieno“); „Morkos“, „3 morkos“ – paliekam
  if (hadUnit && !findProduct(name)) name = toNominative(name);
  name = name[0].toUpperCase() + name.slice(1);
  return { name, qty, unit, note };
}
// "pieno" -> "pienas", "miltų" -> "miltai", "maltos mėsos" -> "malta mėsa" (tik naujiems produktams)
function toNominative(name) {
  const words = name.split(/\s+/);
  const EXC = { bulvių: 'bulvės', morkų: 'morkos', citrinų: 'citrinos', pupelių: 'pupelės', uogų: 'uogos', kriaušių: 'kriaušės', slyvų: 'slyvos', braškių: 'braškės', dešrelių: 'dešrelės', alyvuogių: 'alyvuogės', mėlynių: 'mėlynės', avietių: 'avietės', vyšnių: 'vyšnios', kruopų: 'kruopos', mielių: 'mielės', sėklų: 'sėklos', lazdelių: 'lazdelės', dribsnių: 'dribsniai', kopūsto: 'kopūstas', grietinėlės: 'grietinėlė' };
  const conv = w => {
    if (EXC[w.toLowerCase()]) return EXC[w.toLowerCase()];
    const rules = [[/aus$/u, 'us'], [/ių$/u, 'iai'], [/ų$/u, 'ai'], [/ės$/u, 'ė'], [/os$/u, 'a'], [/io$/u, 'is'], [/o$/u, 'as']];
    for (const [rx, rep] of rules) if (w.length > 3 && rx.test(w)) return w.replace(rx, rep);
    return w;
  };
  return words.map((w, i) => (i === words.length - 1 || /(os|o|ės)$/u.test(w)) ? conv(w) : w).join(' ');
}

// Lietuviškų galūnių nukirpimas (turi sutapti su serverio logika)
const ENDINGS = ['iai', 'ių', 'ius', 'ėms', 'ams', 'ais', 'ys', 'ės', 'ai', 'ui', 'ų', 'as', 'is', 'us', 'os', 'ė', 'a', 'o', 'e', 'ą', 'ę', 'į', 'i', 's'];
function normName(n) {
  return (n || '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.map(w => {
    for (const e of ENDINGS) if (w.length > e.length + 2 && w.endsWith(e)) { w = w.slice(0, -e.length); break; }
    return w.normalize('NFD').replace(/\p{M}/gu, '');
  }).join(' ') || '';
}
function findProduct(name) { const n = normName(name); return S.products.find(p => p.norm === n); }

// ------------------------------------------------------------ pirkinių sąrašo skaičiavimas
function computeList() {
  const need = {}; // product_id -> {amounts:{unit:qty}, recipes:Set, notes:[], extra:bool}
  const add = (pid, qty, unit, src, note, extra) => {
    const o = need[pid] || (need[pid] = { amounts: {}, recipes: new Set(), labels: new Set(), notes: [], extra: false, extraIds: [] });
    if (qty != null) { const [q, u] = baseUnit(qty, unit); o.amounts[u] = (o.amounts[u] || 0) + q; }
    else if (unit && unit !== 'pagal skonį' && !(unit in o.amounts)) o.amounts[unit] = null;
    if (src) o.recipes.add(src);
    if (note) o.notes.push(note);
    if (extra) o.extra = true;
    return o;
  };
  const active = S.menu.filter(m => m.in_list && !m.cooked && IDX.r[m.recipe_id]);
  const recipeProgress = [];
  for (const m of active) {
    const r = IDX.r[m.recipe_id];
    const f = (m.servings || r.servings) / (r.servings || 1);
    for (const i of r.ingredients) add(i.product_id, i.qty != null ? i.qty * f : null, i.unit, r.title);
    recipeProgress.push({ m, r });
  }
  for (const e of S.extras) { const o = add(e.product_id, e.qty, e.unit, null, e.note, true); o.extraIds.push(e.id); (e.recipe || '').split('|').filter(Boolean).forEach(t => o.labels.add(t)); }

  const isDone = pid => {
    const p = IDX.p[pid], st = IDX.ps[pid];
    if (st?.checked) return true;
    if (st?.state === 'have' || st?.state === 'low') return true;
    if (p?.always_have && st?.state !== 'need') return true;
    return false;
  };
  const toBuy = [], have = [], always = [], bought = [];
  for (const [pidS, o] of Object.entries(need)) {
    const pid = +pidS, p = IDX.p[pid]; if (!p) continue;
    const st = IDX.ps[pid] || {};
    const row = { pid, p, st, ...o };
    if (st.checked) bought.push(row);
    else if (st.state === 'have') have.push(row);
    else if (p.always_have && !o.extra && st.state !== 'need' && st.state !== 'low') always.push(row);
    else toBuy.push(row);
  }
  const progress = recipeProgress.map(({ m, r }) => {
    const pids = [...new Set(r.ingredients.map(i => i.product_id))];
    const done = pids.filter(isDone).length;
    return { m, r, done, total: pids.length, missing: pids.filter(x => !isDone(x)) };
  });
  return { toBuy, have, always, bought, progress, need };
}

// Rankinė tvarka (kaip Keep): pagal pos, naujos prekės – gale
function manualSort(rows) {
  const pos = {}; S.sections.forEach((s, i) => pos[s.id] = i);
  const p = r => { const v = IDX.ps[r.pid]?.pos; return v == null ? 1e9 : v; };
  return [...rows].sort((a, b) => p(a) - p(b) || (pos[a.p.section_id] ?? 999) - (pos[b.p.section_id] ?? 999) || a.p.name.localeCompare(b.p.name, 'lt'));
}
const trunc = (t, n = 10) => t.length > n ? t.slice(0, n).trimEnd() + '…' : t;
// Pastabų paryškinimas pagal taisykles (Daugiau → Pastabų paryškinimas)
const COLORS = [['', 'Įprasta'], ['#e5484d', 'Raudona'], ['#f08c2e', 'Oranžinė'], ['#e2b100', 'Geltona'], ['#30a46c', 'Žalia'], ['#3b82f6', 'Mėlyna'], ['#8e4ec6', 'Violetinė'], ['#e93d82', 'Rožinė'], ['ink', 'Balta / juoda'], ['#8b8d98', 'Pilka']];
const colorCss = c => c === 'ink' ? 'var(--ink)' : c;
function highlight(text) {
  const rules = (S.rules || []).map(r => ({ ...r, w: r.word.toLowerCase() }));
  if (!rules.length) return esc(text);
  return text.split(/([\p{L}\p{N}]+)/u).map(tok => {
    const t = tok.toLowerCase(); const r = rules.find(r => t && t.startsWith(r.w));
    if (!r) return esc(tok);
    return `<span style="${r.color ? 'color:' + colorCss(r.color) + ';' : ''}${r.bold ? 'font-weight:700;' : ''}">${esc(tok)}</span>`;
  }).join('');
}
function sortBySection(rows) {
  const pos = {}; S.sections.forEach((s, i) => pos[s.id] = i);
  const k = r => (r.p.section_id in pos) ? pos[r.p.section_id] : 999;
  return [...rows].sort((a, b) => k(a) - k(b) || a.p.name.localeCompare(b.p.name, 'lt'));
}
function groupBySection(rows) {
  const g = {};
  for (const row of rows) { const k = row.p.section_id && IDX.s[row.p.section_id] ? row.p.section_id : 0; (g[k] = g[k] || []).push(row); }
  const order = S.sections.map(s => s.id).filter(id => g[id]);
  if (g[0]) order.push(0);
  return order.map(id => ({ sec: IDX.s[id] || { id: 0, name: 'Nepriskirta skyriui', emoji: '❓' }, rows: g[id].sort((a, b) => a.p.name.localeCompare(b.p.name, 'lt')) }));
}

// ------------------------------------------------------------ maršrutai
const routes = {};
let route = { name: 'list', arg: null };
function go(hash) { location.hash = hash; }
window.addEventListener('hashchange', () => { closeSheet(); render(); window.scrollTo(0, 0); });

function setTop(title, opts = {}) {
  $('#title').textContent = title;
  $('#back').hidden = !opts.back;
  $('#back').onclick = () => opts.back === true ? history.back() : go(opts.back);
  $('#top-actions').innerHTML = opts.actions || '';
}

function render() {
  if (!S) return;
  const h = (location.hash || '#list').slice(1).split('/');
  route = { name: h[0] || 'list', arg: h[1] };
  const fn = routes[route.name] || routes.list;
  const ae = document.activeElement, keep = ae && ae.id && view.contains(ae) && /INPUT|TEXTAREA/.test(ae.tagName) ? { id: ae.id, v: ae.value, s: ae.selectionStart } : null;
  document.body.classList.toggle('on-list', route.name === 'list' || !location.hash || location.hash === '#');
  const tab = { list: 'list', menu: 'menu', recipes: 'recipes', recipe: 'recipes', edit: 'recipes', cook: 'recipes', original: 'recipes' }[route.name] || 'more';
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  busyEditing = route.name === 'edit';
  if (route.name !== 'edit') draft = null;
  stopNoSleep(route.name === 'cook');
  fn(route.arg);
  if (keep) { const el = document.getElementById(keep.id); if (el) { el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.s, keep.s); } catch (e) { } } }
  else if (route.name !== 'list') document.body.classList.remove('typing');
  if (route.name !== 'list') { const u = $('#undo'); if (u) u.hidden = true; }
}

// ------------------------------------------------------------ SĄRAŠAS
routes.list = () => {
  const mode = UI.listMode || 'shop';
  const L = computeList();
  setTop('Pirkinių sąrašas', { actions: `<button class="icon-btn" id="list-menu" aria-label="Daugiau">⋮</button>` });
  if (L.toBuy.length) $('#title').insertAdjacentHTML('beforeend', ` <span class="title-cnt">${L.toBuy.length}</span>`);
  $('#list-menu').onclick = listMenu;

  let html = '';
  if (L.progress.length) {
    html += `<div class="chips progress-strip">${L.progress.map(x => {
      const ok = x.done === x.total;
      return `<button class="chip ${ok ? 'ok' : ''}" data-prog="${x.m.id}">${ok ? '✅ ' : ''}${esc(x.r.title)} <b>${x.done}/${x.total}</b></button>`;
    }).join('')}</div>`;
  }
  html += `<div class="mode-switch">
    <button data-mode="shop" class="${mode === 'shop' ? 'on' : ''}">🛒 Parduotuvėje</button>
    <button data-mode="check" class="${mode === 'check' ? 'on' : ''}">🏠 Namų patikra</button></div>`;
  if (mode === 'shop') html += shopView(L); else html += checkView(L);
  const ins = insAfter && IDX.p[insAfter] && L.toBuy.some(r => r.pid === insAfter) ? IDX.p[insAfter] : null;
  if (!ins) insAfter = null;
  html += `<form class="addbar dock" id="addform">${ins ? `<div class="ins-chip">↳ Įterpiama po: <b>${esc(ins.name)}</b><button type="button" id="ins-x" aria-label="Atšaukti įterpimą">✕</button></div>` : ''}<div class="ac-wrap grow"><input type="text" id="addin" placeholder="Pridėti prekę, pvz. 2 l pieno" autocomplete="off" enterkeyhint="done"></div><button class="btn primary" id="addbtn" aria-label="Pridėti">＋</button></form>`;
  view.innerHTML = html;

  $$('[data-mode]').forEach(b => b.onclick = () => { UI.listMode = b.dataset.mode; saveUI(); render(); });
  $$('[data-prog]').forEach(b => b.onclick = () => progressSheet(L.progress.find(x => x.m.id == b.dataset.prog)));
  autocomplete($('#addin'), { prefixQty: true, shield: true, onPick: () => $('#addform').requestSubmit() }); // paspaustas pasiūlymas iškart įdedamas į sąrašą
  $('#ins-x') && ($('#ins-x').onclick = () => { insAfter = null; render(); });
  const ain = $('#addin');
  ain.addEventListener('focus', () => document.body.classList.add('typing'));
  ain.addEventListener('blur', () => setTimeout(() => { if (document.activeElement?.id !== 'addin') document.body.classList.remove('typing'); }, 120));
  $('#addbtn').addEventListener('pointerdown', e => { if (document.activeElement === ain) e.preventDefault(); }); // klaviatūra lieka
  $('#addform').onsubmit = async e => {
    e.preventDefault();
    const v = $('#addin').value.trim(); if (!v) return;
    const inp0 = $('#addin'); if (inp0) inp0.value = '';
    await addLines([v]);
    const inp = $('#addin'); if (inp) { inp.value = ''; inp.focus(); }
  };
  bindListRows();
};

function itemRow(row, mode) {
  const st = row.st || {};
  const amt = fmtAmounts(row.amounts);
  const chips = [...new Set([...row.recipes, ...(row.labels || [])])].map(t => `<span class="rchip">${esc(trunc(t))}</span>`).join('');
  const notes = row.notes.length ? `<span class="note">${highlight(row.notes.join(', '))}</span>` : '';
  const badge = st.state === 'low' ? '<span class="badge low">baigiasi</span>' : (st.state === 'need' && row.p.always_have ? '<span class="badge need">reikia</span>' : '');
  const sec = IDX.s[row.p.section_id];
  const emo = `<span class="semoji" title="${esc(sec ? sec.name : 'Be kategorijos')}">${sec ? esc(sec.emoji || '•') : '❓'}</span>`;
  const mid = `<div class="grow" data-info="${row.pid}"><div class="name">${esc(row.p.name)}${badge}</div>${chips || notes ? `<div class="sub">${chips}${notes}</div>` : ''}</div>`;
  if (mode === 'check') {
    const s = st.state || '';
    return `<div class="item" data-row="${row.pid}" data-pid="${row.pid}">${emo}${mid}<div class="tri">
      <button class="have ${s === 'have' ? 'on' : ''}" data-st="have">Turiu</button>
      <button class="low ${s === 'low' ? 'on' : ''}" data-st="low">Baigiasi</button>
      <button class="need ${s === 'need' ? 'on' : ''}" data-st="need">Reikia</button></div></div>`;
  }
  return `<div class="item ${st.checked ? 'checked' : ''}" data-row="${row.pid}">${emo}${mid}<div class="qty" data-info="${row.pid}">${esc(amt)}</div><button class="box" data-check="${row.pid}" aria-label="Nupirkta">${st.checked ? '✓' : ''}</button></div>`;
}

function shopView(L) {
  if (!L.toBuy.length && !L.bought.length && !L.have.length) {
    return `<div class="empty"><span class="big">🧺</span>Sąrašas tuščias.<br>Pridėkite receptų į <a href="#menu">meniu</a> arba įrašykite prekę apačioje.</div>`;
  }
  let h = '';
  if (!L.toBuy.length) h += `<div class="empty"><span class="big">🎉</span>Viskas nupirkta!</div>`;
  if (L.toBuy.length) h += `<div class="card items" id="sortlist">${manualSort(L.toBuy).map(r => itemRow(r, 'shop')).join('')}</div><p class="muted small center" style="margin:6px 0 0">Ilgai palaikykite prekę, kad perkeltumėte</p>`;
  if (L.bought.length) h += `<details class="fold" ${UI.openBought ? 'open' : ''} data-fold="openBought"><summary>Nupirkta (${L.bought.length})</summary><div class="card items">${manualSort(L.bought).map(r => itemRow(r, 'shop')).join('')}</div></details>`;
  const haveAll = [...L.have, ...L.always];
  if (haveAll.length) h += `<details class="fold" data-fold="openHave" ${UI.openHave ? 'open' : ''}><summary>Turima namie (${haveAll.length})</summary><div class="card items">${haveAll.map(r => `<div class="item"><div class="grow" data-info="${r.pid}"><div class="name muted">${esc(r.p.name)}</div></div><div class="qty muted">${esc(fmtAmounts(r.amounts))}</div></div>`).join('')}</div></details>`;
  return h;
}

function checkView(L) {
  const rowsAll = [...L.toBuy, ...L.have];
  if (!rowsAll.length && !L.always.length) return `<div class="empty"><span class="big">🏠</span>Nėra ką tikrinti. Pirma pridėkite receptų į <a href="#menu">meniu</a>.</div>`;
  let h = `<p class="muted small" style="margin:0 4px 6px">Pažymėkite, ką jau turite namie. <b>Turiu</b> – pirkti nereikia. <b>Baigiasi</b> – receptui užteks, bet nupirkti reikia.</p>`;
  if (rowsAll.length) h += `<div class="card items" id="sortlist">${manualSort(rowsAll).map(r => itemRow(r, 'check')).join('')}</div>`;
  if (L.always.length) h += `<details class="fold"><summary>Visada turima (${L.always.length})</summary><div class="card items">${L.always.map(r => itemRow(r, 'check')).join('')}</div></details>`;
  return h;
}

function bindListRows() {
  $$('[data-check]').forEach(el => el.onclick = e => { e.stopPropagation(); toggleCheck(+el.dataset.check, true); });
  const sl = $('#sortlist');
  if (sl) longPressSort(sl, ids => {
    const L = computeList(); const all = manualSort([...L.toBuy, ...L.have, ...L.always, ...L.bought]).map(r => r.pid);
    const order = [...ids, ...all.filter(id => !ids.includes(id))];
    order.forEach((id, i) => { const st = IDX.ps[id] || (IDX.ps[id] = { product_id: id }); st.pos = i + 1; if (!S.pstate.includes(st)) S.pstate.push(st); });
    render(); act('list_order', { ids: order }, { keep: true }).then(render).catch(() => load());
  });
  $$('.item[data-pid] [data-st]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const pid = +b.closest('[data-pid]').dataset.pid, cur = IDX.ps[pid]?.state;
    const st = cur === b.dataset.st ? null : b.dataset.st;
    await act('state', { product_id: pid, state: st });
  });
  $$('[data-info]').forEach(el => el.onclick = () => itemSheet(+el.dataset.info));
  $$('details[data-fold]').forEach(d => d.ontoggle = () => { UI[d.dataset.fold] = d.open; saveUI(); });
}

function toggleCheck(pid, withUndo) {
  const st = IDX.ps[pid] || { product_id: pid };
  st.checked = st.checked ? 0 : 1; IDX.ps[pid] = st;
  if (!S.pstate.includes(st)) S.pstate.push(st);
  render(); // greitas atsakas
  act('check', { product_id: pid, checked: !!st.checked }, { keep: true }).then(render).catch(() => load());
  if (withUndo) showUndo(pid, st.checked);
}
function showUndo(pid, checked) {
  const u = $('#undo'), p = IDX.p[pid];
  u.innerHTML = `<span class="grow">${checked ? '✓' : '↺'} ${esc(p ? p.name : '')}</span><button id="undo-btn">↶ Atšaukti</button>`;
  u.hidden = false;
  $('#undo-btn').onclick = () => { u.hidden = true; toggleCheck(pid, false); };
  clearTimeout(showUndo._t); showUndo._t = setTimeout(() => u.hidden = true, 5000);
}

// Automatinis slinkimas tempiant prie ekrano krašto: lėtai pradeda, greitėja tik arčiau krašto.
// Slenka ir laikant pirštą vietoje; tempiamas elementas lieka po pirštu.
function dragScroller(box, onScroll, topZone = 90, bottomZone = 150) {
  const MIN = 0.06, MAX = 0.5; // px per ms: krašto pradžioje ~60 px/s, pačiame krašte ~500 px/s
  let sc = null, y = null, raf = 0, last = 0, carry = 0;
  const parent = () => {
    for (let p = box.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
  };
  const pos = () => sc ? sc.scrollTop : window.scrollY;
  const speed = d => MIN + (MAX - MIN) * Math.min(1, d) ** 2;
  const step = now => {
    if (y == null) { raf = 0; return; }
    const dt = Math.min(50, last ? now - last : 16); last = now;
    const r = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    const tz = Math.min(topZone, (r.bottom - r.top) / 4), bz = Math.min(bottomZone, (r.bottom - r.top) / 4);
    let v = 0;
    if (y < r.top + tz) v = -speed((r.top + tz - y) / tz);
    else if (y > r.bottom - bz) v = speed((y - r.bottom + bz) / bz);
    carry += v * dt; const px = Math.trunc(carry); carry -= px;
    if (px) { const b = pos(); if (sc) sc.scrollTop += px; else window.scrollBy(0, px); if (pos() !== b) onScroll(); }
    raf = requestAnimationFrame(step);
  };
  return {
    start() { sc = parent(); return pos(); },
    pos,
    at(ny) { y = ny; if (!raf) raf = requestAnimationFrame(step); },
    stop() { y = null; cancelAnimationFrame(raf); raf = 0; last = 0; carry = 0; },
  };
}

// Ilgas paspaudimas + tempimas (pirkinių sąrašo tvarkai)
function longPressSort(box, onDone) {
  let timer = null, drag = null, idx = 0, target = 0, startY = 0, sx = 0, sy = 0, rows = [], centers = [], h = 0, suppress = false, lastY = 0, s0 = 0;
  const auto = dragScroller(box, () => drag && move(lastY));
  const begin = el => {
    rows = $$('.item[data-row]', box); idx = rows.indexOf(el); target = idx; drag = el; s0 = auto.start();
    centers = rows.map(r => { const b = r.getBoundingClientRect(); return b.top + s0 + b.height / 2; });
    h = el.offsetHeight; startY = sy; el.classList.add('dragging'); navigator.vibrate && navigator.vibrate(20);
  };
  const move = y => {
    lastY = y; const dy = y - startY + auto.pos() - s0, c = centers[idx] + dy;
    drag.style.transform = `translateY(${dy}px)`;
    target = rows.reduce((n, r, j) => n + (j !== idx && centers[j] < c ? 1 : 0), 0);
    rows.forEach((r, j) => { if (j === idx) return; let sh = 0; if (j > idx && j <= target) sh = -h; if (j < idx && j >= target) sh = h; r.style.transform = sh ? `translateY(${sh}px)` : ''; r.style.transition = 'transform .12s'; });
    auto.at(y);
  };
  const finish = () => {
    clearTimeout(timer); timer = null; auto.stop();
    if (!drag) return;
    rows.forEach(r => { r.style.transform = ''; r.style.transition = ''; }); drag.classList.remove('dragging');
    const ids = rows.map(r => +r.dataset.row); const [m] = ids.splice(idx, 1); ids.splice(target, 0, m);
    const changed = target !== idx; drag = null; suppress = true; setTimeout(() => suppress = false, 400);
    if (changed) onDone(ids);
  };
  const press = (x, y, t) => {
    if (t.closest('button, select, input')) return;
    const el = t.closest('.item[data-row]'); if (!el) return;
    sx = x; sy = y; clearTimeout(timer); timer = setTimeout(() => begin(el), 420);
  };
  box.addEventListener('touchstart', e => press(e.touches[0].clientX, e.touches[0].clientY, e.target), { passive: true });
  box.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (!drag) { if (Math.abs(t.clientY - sy) > 8 || Math.abs(t.clientX - sx) > 8) { clearTimeout(timer); timer = null; } return; }
    e.preventDefault(); move(t.clientY);
  }, { passive: false });
  box.addEventListener('touchend', finish); box.addEventListener('touchcancel', finish);
  box.addEventListener('mousedown', e => {
    press(e.clientX, e.clientY, e.target);
    const mm = ev => { if (!drag) { if (Math.abs(ev.clientY - sy) > 6) clearTimeout(timer); return; } ev.preventDefault(); move(ev.clientY); };
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); finish(); };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
  });
  box.addEventListener('contextmenu', e => e.preventDefault());
  box.addEventListener('click', e => { if (suppress) { e.stopPropagation(); e.preventDefault(); } }, true);
}

// Įterpimo vieta (null – į galą)
let insAfter = null;
// Nuslinkti iki naujų prekių ir trumpai jas paryškinti
function flashRows(ids) {
  const els = ids.map(id => $(`#sortlist .item[data-row="${id}"]`)).filter(Boolean);
  if (!els.length) return;
  const last = els[els.length - 1], r = last.getBoundingClientRect();
  const dock = $('#addform')?.getBoundingClientRect().top || innerHeight;
  if (r.bottom > dock - 8 || r.top < 70) last.scrollIntoView({ block: 'center', behavior: 'smooth' });
  els.forEach(el => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
}

// Keep / kitų programų žymės eilutės pradžioje
function cleanLine(l) { return l.replace(/^\s*(\[[ xX]?\]|[☐☑✓✔□■▪•·*\-–]+)\s*/u, '').trim(); }

async function addLines(lines) {
  const items = lines.map(cleanLine).filter(Boolean).map(l => {
    const p = parseLine(l) || { name: l, qty: null, unit: '', note: '' };
    const ex = findProduct(p.name) || S.products.find(x => x.name.toLowerCase() === l.toLowerCase());
    return { name: ex ? ex.name : p.name, product_id: ex ? ex.id : null, qty: p.qty, unit: p.unit, note: p.note };
  });
  if (!items.length) return;
  const res = await act('extras_bulk', { items, after: insAfter || null });
  const ids = res.product_ids || [];
  if (insAfter && ids.length) insAfter = ids[ids.length - 1]; // kitos prekės – po ką tik įterptos (kaip Keep)
  render(); flashRows(ids);
  const un = (res.product_ids || []).filter(id => !IDX.p[id]?.section_id).length;
  toast(items.length === 1 ? 'Pridėta' + (un ? ' – paspauskite prekę, kad parinktumėte kategoriją' : '') : `Pridėta prekių: ${items.length}` + (un ? ` (be kategorijos: ${un})` : ''), 3000);
}

function bulkSheet() {
  sheet(`<h3>Įklijuoti sąrašą</h3>
    <p class="muted small" style="margin:0 2px 8px">Kiekviena prekė – naujoje eilutėje. Galima tiesiog nukopijuoti visą Google Keep sąrašą. Kiekius programa atpažins pati, pvz. „2 l pieno“.</p>
    <textarea id="bulkbox" style="min-height:40vh" placeholder="Pienas&#10;2 kg bulvių&#10;Duona"></textarea>
    <button class="btn primary block" id="bulkok" style="margin-top:10px">Pridėti į sąrašą</button>`, () => {
    $('#bulkok').onclick = async () => {
      const lines = $('#bulkbox').value.split(/\r?\n/);
      closeSheet(); await addLines(lines);
    };
  });
}

// Prekės detalės: pavadinimas, kiekis, pastaba, skyrius, pašalinimas
function itemSheet(pid) {
  const p = IDX.p[pid]; if (!p) return;
  const L = computeList(), o = L.need[pid] || { amounts: {}, recipes: new Set(), labels: new Set(), notes: [], extraIds: [] };
  const extra = S.extras.find(e => e.product_id === pid);
  const st = IDX.ps[pid] || {};
  const fromRecipes = o.recipes.size > 0;
  // receptų kiekis (be papildomų)
  const recAmt = {};
  if (fromRecipes) for (const m of S.menu.filter(m => m.in_list && !m.cooked && IDX.r[m.recipe_id])) {
    const r = IDX.r[m.recipe_id], f = (m.servings || r.servings) / (r.servings || 1);
    r.ingredients.filter(i => i.product_id === pid).forEach(i => { if (i.qty != null) { const [q, u] = baseUnit(i.qty * f, i.unit); recAmt[u] = (recAmt[u] || 0) + q; } });
  }
  const defUnit = extra ? (extra.unit || '') : (Object.keys(recAmt)[0] || '');
  sheet(`<h3>Prekė</h3><div class="stack">
    <label class="field"><span>Pavadinimas${fromRecipes ? ' <span class="small">(pasikeis ir receptuose)</span>' : ''}</span><input type="text" id="ix-name" value="${esc(p.name)}"></label>
    ${o.labels && o.labels.size ? `<p class="muted small" style="margin:0">Liko nuo recepto: ${[...o.labels].map(t => `<span class="rchip">${esc(t)}</span>`).join(' ')}</p>` : ''}
    ${fromRecipes ? `<p class="muted small" style="margin:0">Receptams (${esc([...o.recipes].join(', '))}): <b>${esc(fmtAmounts(recAmt) || 'kiekis nenurodytas')}</b></p>` : ''}
    <div><span class="muted small" style="margin:0 2px 4px;display:block">${fromRecipes ? 'Pirkti papildomai (pvz. atsargai, akcija)' : 'Kiekis'}</span>
    <div class="row"><div class="stepper"><button type="button" id="ix-m">−</button><input type="text" inputmode="decimal" id="ix-qty" placeholder="—" value="${extra && extra.qty != null ? fmtNum(extra.qty) : ''}"><button type="button" id="ix-p">＋</button></div>
      <select id="ix-unit" class="grow">${UNITS.map(u => `<option ${u === defUnit ? 'selected' : ''}>${u}</option>`).join('')}${UNITS.includes(defUnit) ? '' : `<option selected>${esc(defUnit)}</option>`}</select></div></div>
    <label class="field"><span>Pastaba (pvz. „Lidl Plus kuponas“)</span><input type="text" id="ix-note" value="${esc(extra?.note || '')}"></label>
    <label class="field"><span>Kategorija ${p.section_id ? '' : '<b style="color:var(--warn)">– nepriskirta</b>'}</span><select id="ix-sec"><option value="">— nepriskirta —</option>${S.sections.map(s => `<option value="${s.id}" ${s.id === p.section_id ? 'selected' : ''}>${esc(s.emoji + ' ' + s.name)}</option>`).join('')}</select></label>
    <button class="btn primary block" id="ix-save">Išsaugoti</button>
    ${L.toBuy.some(r => r.pid === pid) ? '<button class="btn block" id="ix-ins">↳ Įterpti naują prekę po šia</button>' : ''}
    <div class="row">
      <button class="btn grow" id="ix-have">${st.state === 'have' ? '↺ Vis dėlto reikia' : '🏠 Turiu namie'}</button>
      ${extra && !fromRecipes ? '<button class="btn grow danger" id="ix-del">🗑 Pašalinti</button>' : ''}
    </div></div>`, () => {
    const q = $('#ix-qty');
    const step = d => { const v = parseFloat((q.value || '0').replace(',', '.')) || 0; const u = $('#ix-unit').value; const inc = (u === 'g' || u === 'ml') ? 100 : 1; q.value = fmtNum(Math.max(0, v + d * inc)).replace(/^0$/, ''); };
    $('#ix-m').onclick = () => step(-1); $('#ix-p').onclick = () => step(1);
    $('#ix-save').onclick = async () => {
      const name = $('#ix-name').value.trim();
      const sec = +$('#ix-sec').value || null;
      let id = pid;
      if (name && name !== p.name) { const r = await api('api/do/product_save', { id: pid, name }); id = r.id; }
      if (sec !== p.section_id) await api('api/do/product_save', { id, section_id: sec });
      const qty = q.value.trim(), unit = $('#ix-unit').value, note = $('#ix-note').value.trim();
      if (extra) {
        if (fromRecipes && !qty && !note) for (const eid of o.extraIds) await api('api/do/extra_delete', { id: eid });
        else await api('api/do/extra_update', { id: extra.id, qty, unit, note });
      } else if (qty || note) await api('api/do/extra_add', { product_id: id, qty, unit, note });
      closeSheet(); await load();
    };
    $('#ix-ins') && ($('#ix-ins').onclick = () => { insAfter = pid; closeSheet(); render(); setTimeout(() => $('#addin')?.focus(), 50); });
    $('#ix-have').onclick = async () => { await act('state', { product_id: pid, state: st.state === 'have' ? null : 'have' }); closeSheet(); };
    $('#ix-del') && ($('#ix-del').onclick = async () => { for (const id of o.extraIds) await api('api/do/extra_delete', { id }); closeSheet(); await load(); });
  });
}

// Kompaktiškas pasiūlymų sąrašas (vietoj naršyklės datalist)
function autocomplete(input, opts = {}) {
  const wrap = input.parentElement; wrap.classList.add('ac-wrap');
  const box = document.createElement('div'); box.className = 'ac'; box.hidden = true; wrap.appendChild(box);
  const split = v => { // "2 l pie" -> ["2 l ", "pie"]
    if (!opts.prefixQty) return ['', v];
    const m = v.match(/^(\s*[\d½¼¾][\d.,\/\s-]*(?:(?:kg|g|gr|ml|l|vnt|pak\.?|v\.\s?š\.|a\.\s?š\.|šaukšt\p{L}*|stiklin\p{L}*|skiltel\p{L}*)\s+)?)(.*)$/iu);
    return m ? [m[1], m[2]] : ['', v];
  };
  const show = () => {
    const [pre, q0] = split(input.value); const q = q0.trim();
    if (q.length < 1) { hide(); return; }
    const nq = normName(q), lq = q.toLowerCase();
    const list = (opts.source ? opts.source() : S.products)
      .map(p => { const ln = p.name.toLowerCase(); const sc = ln.startsWith(lq) ? 0 : (p.norm || normName(p.name)).startsWith(nq) ? 1 : ln.includes(lq) || (p.norm || '').includes(nq) ? 2 : 9; return [sc, p]; })
      .filter(x => x[0] < 9 && x[1].name.toLowerCase() !== lq).sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name, 'lt')).slice(0, 5);
    if (!list.length) { hide(); return; }
    box.innerHTML = `<div class="ac-head">Siūlomos prekės</div>` + list.map(([, p]) => `<button type="button" data-v="${esc(p.name)}">${esc(p.name)}</button>`).join('');
    box.hidden = false; if (opts.shield) shield.hidden = false;
    box._pre = pre;
  };
  // Pasirinkimas iškart paspaudus (pointerdown), kad įvedimo laukas nespėtų prarasti fokuso ir sąrašas – dingti
  const pick = b => { input.value = box._pre + b.dataset.v; hide(); input.focus(); opts.onPick && opts.onPick(b.dataset.v); };
  box.addEventListener('pointerdown', e => { e.preventDefault(); const b = e.target.closest('button[data-v]'); if (b) pick(b); });
  box.addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b && !box.hidden) pick(b); }); // klaviatūrai / be pointer įvykių
  // permatomas sluoksnis po pasiūlymais – netyčinis paspaudimas nepataiko į sąrašą
  const shield = document.createElement('div'); shield.className = 'ac-shield'; shield.hidden = true;
  if (opts.shield) { document.body.appendChild(shield); shield.addEventListener('pointerdown', e => { e.preventDefault(); hide(); }); }
  function hide() { box.hidden = true; shield.hidden = true; }
  input.addEventListener('input', show);
  input.addEventListener('blur', () => setTimeout(hide, 150));
  input.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
}

function progressSheet(x) {
  const r = x.r;
  sheet(`<h3>${esc(r.title)} – ${x.done}/${x.total}</h3>
    ${x.missing.length ? `<p class="muted">Dar trūksta:</p><ul class="ings">${x.missing.map(pid => `<li>${esc(IDX.p[pid]?.name)}</li>`).join('')}</ul>` : '<p>✅ Viskas šiam receptui yra!</p>'}
    <div class="stack" style="margin-top:14px"><a class="btn block" href="#recipe/${r.id}">Atidaryti receptą</a>
    <button class="btn block" id="rm-list">Išimti iš sąrašo</button>
    <p class="muted small" style="margin:0">Išėmus dings ir nenupirktos šio recepto prekės. Jei norite jas palikti – naudokite „Baigti apsipirkimą“.</p></div>`, () => {
    $('#rm-list').onclick = async () => { await act('menu_update', { id: x.m.id, in_list: false }); closeSheet(); };
  });
}

// Meniu kaip Google Keep
function listMenu() {
  const L = computeList(), nChecked = L.bought.length;
  popMenu($('#list-menu'), `<div class="kmenu">
    <button id="lm-uncheck" ${nChecked ? '' : 'disabled'}>Atžymėti visus elementus</button>
    <button id="lm-delchecked" ${nChecked || L.progress.length ? '' : 'disabled'}>Ištrinti pažymėtus elementus${nChecked ? ` (${nChecked})` : ''}</button>
    <button id="lm-paste">Įklijuoti sąrašą</button>
    <button id="lm-copy">Kopijuoti sąrašą</button>
    <button id="lm-clear" class="danger">Išvalyti visą sąrašą</button></div>`, () => {
    $('#lm-uncheck').onclick = async () => { closePop(); await act('uncheck_all'); toast('Visi elementai atžymėti'); };
    $('#lm-delchecked').onclick = async () => {
      closePop(); $('#undo').hidden = true;
      const r = await act('shopping_done', {});
      toast(`Ištrinta pažymėtų: ${nChecked}` + (r.carried ? ` · liko prekių iš receptų: ${r.carried}` : ''), 3500);
    };
    $('#lm-copy').onclick = () => { closePop(); shareList(); };
    $('#lm-paste').onclick = () => { closePop(); bulkSheet(); };
    $('#lm-clear').onclick = async () => { closePop(); if (confirm('Išvalyti visą sąrašą?')) await act('list_clear'); };
  });
}

// Paprastas tekstinis sąrašas – įklijuoti galima bet kur
async function shareList() {
  const L = computeList();
  const text = manualSort(L.toBuy).map(r => { const a = fmtAmounts(r.amounts); return r.p.name + (a ? ' – ' + a : ''); }).join('\n');
  if (!text) return toast('Sąrašas tuščias');
  let ok = false;
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { }
  if (!ok) {
    const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    t.remove();
  }
  if (ok) toast(`Nukopijuota prekių: ${L.toBuy.length}`);
  else sheet(`<h3>Sąrašas</h3><p class="muted small">Pažymėkite tekstą ir nukopijuokite.</p><textarea style="min-height:50vh">${esc(text)}</textarea>`);
}

// ------------------------------------------------------------ MENIU
function dateStr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function niceDate(s) { const d = parseDate(s); return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()} d.`; }

routes.menu = () => {
  setTop('Savaitės meniu');
  const today = parseDate(S.today);
  const off = UI.weekOff || 0;
  const mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay() + 6) % 7) + off * 7);
  const days = [...Array(7)].map((_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return dateStr(d); });
  const end = parseDate(days[6]);
  let h = `<div class="weeknav"><button class="btn small" data-w="-1">‹</button><b>${mon.getDate()} ${MONTHS[mon.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}</b><button class="btn small" data-w="1">›</button></div>`;
  if (off) h += `<div class="center" style="margin:-4px 0 10px"><button class="btn small" data-w="0">Ši savaitė</button></div>`;
  const inList = S.menu.filter(m => m.in_list && !m.cooked).length;
  for (const day of days) {
    const items = S.menu.filter(m => m.day === day);
    const d = parseDate(day);
    h += `<div class="card day ${day === S.today ? 'today' : ''}"><div class="dh"><span>${DAYS[d.getDay()]} <span class="muted small">${d.getDate()} ${MONTHS[d.getMonth()]}</span></span>
      <button class="btn small" data-add="${day}">＋</button></div>
      ${items.map(m => { const r = IDX.r[m.recipe_id]; if (!r) return ''; return `<div class="mi ${m.cooked ? 'cooked' : ''}">
        <div class="grow"><b data-open="${r.id}">${esc(r.title)}</b><span class="muted small">${fmtNum(m.servings)} porc.</span></div>
        <button class="tog ${m.in_list ? 'on' : ''}" data-inlist="${m.id}" title="Pirkinių sąraše">🛒</button>
        <button class="tog ${m.cooked ? 'on' : ''}" data-cooked="${m.id}" title="Pagaminta">✓</button>
        <button class="tog" data-mopt="${m.id}">⋯</button></div>`; }).join('')}
    </div>`;
  }
  h += `<p class="muted small center">🛒 – receptas pirkinių sąraše (${inList}) · ✓ – pagaminta (įrašoma į istoriją)</p>`;
  view.innerHTML = h;
  $$('[data-w]').forEach(b => b.onclick = () => { UI.weekOff = b.dataset.w === '0' ? 0 : off + +b.dataset.w; saveUI(); render(); });
  $$('[data-add]').forEach(b => b.onclick = () => pickRecipe(b.dataset.add));
  $$('[data-open]').forEach(b => b.onclick = () => go('#recipe/' + b.dataset.open));
  $$('[data-inlist]').forEach(b => b.onclick = () => { const m = S.menu.find(x => x.id == b.dataset.inlist); act('menu_update', { id: m.id, in_list: !m.in_list }); });
  $$('[data-cooked]').forEach(b => b.onclick = () => { const m = S.menu.find(x => x.id == b.dataset.cooked); act('menu_cooked', { id: m.id, cooked: !m.cooked }); });
  $$('[data-mopt]').forEach(b => b.onclick = () => menuItemSheet(S.menu.find(x => x.id == b.dataset.mopt)));
};

function pickRecipe(day) {
  const list = () => {
    const q = normName($('#pq')?.value || '');
    return S.recipes.filter(r => !q || normName(r.title).includes(q))
      .sort((a, b) => (b.favorite - a.favorite) || a.title.localeCompare(b.title, 'lt'))
      .map(r => `<div class="list-row" data-pick="${r.id}" style="cursor:pointer"><div class="grow"><b>${r.favorite ? '❤️ ' : ''}${esc(r.title)}</b><div class="muted small">${r.last_cooked ? 'Gaminta ' + r.last_cooked : 'Dar negaminta'}</div></div><span class="muted">${fmtNum(r.servings)} porc.</span></div>`).join('') || '<div class="empty">Receptų nerasta</div>';
  };
  sheet(`<h3>${esc(niceDate(day))}</h3><input type="search" id="pq" placeholder="Ieškoti recepto…"><div class="card" id="plist" style="margin-top:10px;overflow:hidden">${list()}</div>`, () => {
    const bind = () => $$('[data-pick]').forEach(el => el.onclick = async () => { await act('menu_add', { day, recipe_id: +el.dataset.pick }); closeSheet(); toast('Pridėta į meniu ir sąrašą'); });
    $('#pq').oninput = () => { $('#plist').innerHTML = list(); bind(); };
    bind();
  });
}

function menuItemSheet(m) {
  const r = IDX.r[m.recipe_id];
  sheet(`<h3>${esc(r.title)}</h3><div class="stack">
    <label class="field"><span>Porcijos</span><div class="serv"><button id="sm">−</button><b id="sv">${fmtNum(m.servings)}</b><button id="sp">＋</button></div></label>
    <label class="field"><span>Diena</span><input type="date" id="mday" value="${m.day}"></label>
    <button class="btn block" id="m-save">Išsaugoti</button>
    <button class="btn block danger" id="m-del">Pašalinti iš meniu</button></div>`, () => {
    let sv = m.servings;
    $('#sm').onclick = () => { sv = Math.max(1, sv - 1); $('#sv').textContent = fmtNum(sv); };
    $('#sp').onclick = () => { sv += 1; $('#sv').textContent = fmtNum(sv); };
    $('#m-save').onclick = async () => { await act('menu_update', { id: m.id, servings: sv, day: $('#mday').value }); closeSheet(); };
    $('#m-del').onclick = async () => { await act('menu_delete', { id: m.id }); closeSheet(); };
  });
}

// ------------------------------------------------------------ RECEPTAI
function photoUrl(r, kind = 'dish') { const p = r.photos.find(x => x.kind === kind); return p ? 'photos/' + p.filename : ''; }

routes.recipes = () => {
  setTop('Receptai', { actions: `<button class="btn small primary" onclick="go('#edit/new')">＋ Naujas</button>` });
  const tags = [...new Set(S.recipes.flatMap(r => r.tags))].sort((a, b) => a.localeCompare(b, 'lt'));
  const f = UI.rf || {};
  let h = `<input type="search" id="rq" placeholder="Ieškoti pagal pavadinimą ar produktą…" value="${esc(f.q || '')}">
    <div class="chips" style="margin-top:10px">
      <button class="chip ${f.fav ? 'on' : ''}" data-f="fav">❤️ Mėgstami</button>
      <button class="chip ${f.sort === 'last' ? 'on' : ''}" data-f="sort">🕒 Seniausiai gaminti</button>
      ${tags.map(t => `<button class="chip ${f.tag === t ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
    </div><div class="rgrid" id="rgrid" style="margin-top:8px"></div>`;
  view.innerHTML = h;
  const draw = () => {
    const q = normName(f.q || '');
    let list = S.recipes.filter(r => {
      if (f.fav && !r.favorite) return false;
      if (f.tag && !r.tags.includes(f.tag)) return false;
      if (q) {
        const hay = normName(r.title) + ' ' + r.ingredients.map(i => IDX.p[i.product_id]?.norm || '').join(' ') + ' ' + normName(r.tags.join(' '));
        if (!q.split(' ').every(w => hay.includes(w))) return false;
      }
      return true;
    });
    if (f.sort === 'last') list.sort((a, b) => (a.last_cooked || '0').localeCompare(b.last_cooked || '0'));
    $('#rgrid').innerHTML = list.map(r => {
      const u = photoUrl(r);
      return `<div class="card rcard" onclick="go('#recipe/${r.id}')"><div class="img" ${u ? `style="background-image:url('${u}')"` : ''}>${u ? '' : '🍲'}</div>
        <div class="t"><b>${r.favorite ? '❤️ ' : ''}${esc(r.title)}</b><span class="muted">${r.rating ? '★'.repeat(r.rating) + ' · ' : ''}${r.cooked_count ? 'gaminta ' + r.cooked_count + '×' : 'dar negaminta'}</span></div></div>`;
    }).join('') || `<div class="empty" style="grid-column:1/-1"><span class="big">📖</span>${S.recipes.length ? 'Nieko nerasta' : 'Dar nėra receptų.<br>Spauskite „＋ Naujas“ arba importuokite skiltyje <a href="#data">Daugiau → Importas</a>.'}</div>`;
  };
  draw();
  $('#rq').oninput = e => { f.q = e.target.value; UI.rf = f; saveUI(); draw(); };
  $$('[data-f]').forEach(b => b.onclick = () => { if (b.dataset.f === 'fav') f.fav = !f.fav; else f.sort = f.sort === 'last' ? '' : 'last'; UI.rf = f; saveUI(); render(); });
  $$('[data-tag]').forEach(b => b.onclick = () => { f.tag = f.tag === b.dataset.tag ? '' : b.dataset.tag; UI.rf = f; saveUI(); render(); });
};

routes.recipe = id => {
  const r = IDX.r[id]; if (!r) return go('#recipes');
  if (!UI.serv || UI.serv.id != id) UI.serv = { id, n: r.servings };
  const sv = UI.serv.n, f = sv / (r.servings || 1);
  setTop(r.title, { back: '#recipes', actions: `<button class="icon-btn" id="r-edit" aria-label="Redaguoti">✏️</button>` });
  $('#r-edit').onclick = () => go('#edit/' + id);
  const u = photoUrl(r);
  const originals = r.photos.filter(p => p.kind === 'original');
  let h = `${u ? `<img class="hero" src="${u}" alt="">` : ''}
  <div class="row wrap" style="margin:12px 2px 4px">
    <div class="grow"><div class="stars">${r.rating ? '★'.repeat(r.rating) + '<span class="muted">' + '★'.repeat(5 - r.rating) + '</span>' : ''}</div>
    <div>${r.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    <div class="muted small">${r.cooked_count ? `Gaminta ${r.cooked_count} k., paskutinį kartą ${r.last_cooked}` : 'Dar negaminta'}</div></div>
    <button class="icon-btn" id="r-fav" title="Mėgstamas">${r.favorite ? '❤️' : '🤍'}</button>
  </div>
  <div class="row wrap" style="gap:8px;margin:10px 0">
    <button class="btn primary grow" onclick="go('#cook/${id}')">👩‍🍳 Gaminti</button>
    <button class="btn grow" id="r-menu">📅 Į meniu</button>
  </div>
  <div class="card pad"><div class="row"><h2 class="grow" style="margin:0">Ingredientai</h2>
    <div class="serv"><button id="svm">−</button><b>${fmtNum(sv)}</b><button id="svp">＋</button></div></div>
    <div class="muted small" style="text-align:right;margin-bottom:6px">porcijos</div>
    <ul class="ings">${r.ingredients.map(i => `<li><span class="q">${i.qty != null ? esc(fmtAmount(i.qty * f, i.unit)) : esc(i.unit)}</span><span class="grow">${esc(IDX.p[i.product_id]?.name)}${i.note ? ` <span class="muted">(${esc(i.note)})</span>` : ''}</span></li>`).join('') || '<li class="muted">Nėra ingredientų</li>'}</ul></div>
  ${r.steps.length ? `<h2>Gaminimas</h2><div class="card pad"><ol class="steps">${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
  ${r.notes ? `<h2>Pastabos</h2><div class="card pad" style="white-space:pre-wrap">${esc(r.notes)}</div>` : ''}
  ${r.source ? `<p class="muted small" style="margin:12px 4px">Šaltinis: ${/^https?:/.test(r.source) ? `<a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.source)}</a>` : esc(r.source)}</p>` : ''}
  <div class="stack" style="margin-top:16px">
    ${r.has_original || originals.length ? `<button class="btn block" onclick="go('#original/${id}')">📜 Rodyti originalą</button>` : ''}
    <button class="btn block" id="r-cooked">✓ Pagaminau šiandien</button>
  </div>`;
  view.innerHTML = h;
  $('#svm').onclick = () => { UI.serv.n = Math.max(1, sv - 1); render(); };
  $('#svp').onclick = () => { UI.serv.n = sv + 1; render(); };
  $('#r-fav').onclick = () => act('recipe_save', recipePayload(r, { favorite: !r.favorite }));
  $('#r-cooked').onclick = async () => { await act('cooked_now', { recipe_id: r.id }); toast('Įrašyta į istoriją'); };
  $('#r-menu').onclick = () => {
    const opts = [...Array(10)].map((_, i) => { const d = parseDate(S.today); d.setDate(d.getDate() + i); return dateStr(d); });
    sheet(`<h3>Į kurią dieną?</h3><div class="card" style="overflow:hidden">${opts.map((d, i) => `<div class="list-row" data-d="${d}" style="cursor:pointer"><b class="grow">${i === 0 ? 'Šiandien' : i === 1 ? 'Rytoj' : DAYS[parseDate(d).getDay()]}</b><span class="muted">${parseDate(d).getDate()} ${MONTHS[parseDate(d).getMonth()]}</span></div>`).join('')}</div>`, () => {
      $$('[data-d]').forEach(el => el.onclick = async () => { await act('menu_add', { day: el.dataset.d, recipe_id: r.id, servings: sv }); closeSheet(); toast('Pridėta į meniu ir pirkinių sąrašą'); });
    });
  };
};

function recipePayload(r, over = {}) {
  return Object.assign({
    id: r.id, title: r.title, servings: r.servings, tags: r.tags, notes: r.notes, rating: r.rating,
    favorite: r.favorite, steps: r.steps, source: r.source,
    ingredients: r.ingredients.map(i => ({ product_id: i.product_id, qty: i.qty, unit: i.unit, note: i.note })),
  }, over);
}

routes.original = async id => {
  const r = IDX.r[id]; if (!r) return go('#recipes');
  setTop('Originalas', { back: '#recipe/' + id });
  view.innerHTML = '<div class="empty">Kraunama…</div>';
  const o = await api('api/original/' + id);
  const originals = r.photos.filter(p => p.kind === 'original');
  let h = '';
  if (originals.length) h += `<h2>Originalo nuotraukos</h2>${originals.map(p => `<a href="photos/${p.filename}" target="_blank"><img class="full" src="photos/${p.filename}" alt=""></a>`).join('')}`;
  if (o.text) h += `<h2>Originalus tekstas</h2><div class="orig-box">${esc(o.text)}</div>`;
  if (o.snapshot) {
    const s = o.snapshot;
    h += `<h2>Pirmoji versija <span class="muted small">(${esc((s.saved || '').replace('T', ' '))})</span></h2><div class="card pad">
      <b>${esc(s.title)}</b> <span class="muted">· ${fmtNum(s.servings)} porc.</span>
      <ul class="ings" style="margin-top:8px">${s.ingredients.map(i => `<li><span class="q">${esc(fmtAmount(i.qty, i.unit))}</span><span>${esc(i.name)}${i.note ? ` <span class="muted">(${esc(i.note)})</span>` : ''}</span></li>`).join('')}</ul>
      ${s.steps.length ? `<ol class="steps" style="margin-top:10px">${s.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
      ${s.notes ? `<p style="white-space:pre-wrap">${esc(s.notes)}</p>` : ''}</div>`;
  }
  view.innerHTML = h || '<div class="empty">Originalas neišsaugotas</div>';
};

// ------------------------------------------------------------ RECEPTO REDAGAVIMAS
let draft = null;
routes.edit = id => {
  const isNew = id === 'new';
  const r = isNew ? null : IDX.r[id];
  if (!isNew && !r) return go('#recipes');
  if (!draft || draft._for !== id) {
    draft = r ? JSON.parse(JSON.stringify(recipePayload(r))) : { title: '', servings: 4, tags: [], notes: '', rating: 0, favorite: 0, steps: [], source: '', ingredients: [], original_text: '' };
    draft._for = id; draft.new_photos = [];
    draft.ingredients.forEach(i => { i.product_name = IDX.p[i.product_id]?.name || ''; });
  }
  const d = draft;
  setTop(isNew ? 'Naujas receptas' : 'Redaguoti', { back: true });
  const existing = r ? r.photos : [];
  view.innerHTML = `${isNew ? `<div class="row" style="gap:8px;margin-bottom:12px"><button type="button" class="btn grow" id="imp-url">🔗 Iš nuorodos</button><button type="button" class="btn grow" id="imp-text">📝 Iš teksto</button></div>` : ''}<form id="ef" class="stack" autocomplete="off">
    <label class="field"><span>Pavadinimas</span><input type="text" name="title" value="${esc(d.title)}" required></label>
    <div class="row"><label class="field" style="width:110px"><span>Porcijos</span><input type="number" min="1" step="1" name="servings" value="${esc(d.servings)}"></label>
      <label class="field grow"><span>Žymos (per kablelį)</span><input type="text" name="tags" value="${esc(d.tags.join(', '))}" placeholder="pvz. vakarienė, greita"></label></div>
    <div><span class="muted small">Įvertinimas</span><div class="stars" id="stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-star="${n}">${n <= d.rating ? '★' : '☆'}</button>`).join('')}</div></div>

    <h2>Ingredientai</h2>
    <div class="card pad"><div id="ings"></div>
      <div class="row wrap" style="margin-top:8px"><button type="button" class="btn small" id="ing-add">＋ Eilutė</button>
      <button type="button" class="btn small" id="ing-paste">📋 Įklijuoti sąrašą</button></div></div>

    <h2>Gaminimo žingsniai</h2>
    <label class="field"><span>Kiekvienas žingsnis – nauja eilutė</span><textarea name="steps" style="min-height:160px">${esc(d.steps.join('\n'))}</textarea></label>
    <label class="field"><span>Pastabos</span><textarea name="notes" placeholder="pvz. kitą kartą mažiau druskos">${esc(d.notes)}</textarea></label>
    <label class="field"><span>Šaltinis (knyga, nuoroda, močiutės sąsiuvinis…)</span><input type="text" name="source" value="${esc(d.source)}"></label>
    ${isNew ? `<label class="field"><span>Originalus tekstas (neprivaloma, išsaugomas nekeičiamas)</span><textarea name="original_text">${esc(d.original_text)}</textarea></label>` : ''}

    <h2>Nuotraukos</h2>
    <div class="card pad stack">
      <div><b>Patiekalo nuotrauka</b><div class="photos" style="margin-top:6px">${existing.filter(p => p.kind === 'dish').map(p => `<div class="ph" style="background-image:url('photos/${p.filename}')"><button type="button" data-delph="${p.id}">×</button></div>`).join('')}${d.new_photos.filter(p => p.kind === 'dish').map(p => `<div class="ph" style="background-image:url('${p.data}')"></div>`).join('')}</div>
        <label class="btn small" style="margin-top:6px">📷 Pridėti<input type="file" accept="image/*" data-kind="dish" hidden></label></div>
      <div><b>Originalo nuotraukos</b> <span class="muted small">(knygos puslapis, ekrano kopija, užrašai)</span><div class="photos" style="margin-top:6px">${existing.filter(p => p.kind === 'original').map(p => `<div class="ph" style="background-image:url('photos/${p.filename}')"><button type="button" data-delph="${p.id}">×</button></div>`).join('')}${d.new_photos.filter(p => p.kind === 'original').map(p => `<div class="ph" style="background-image:url('${p.data}')"></div>`).join('')}</div>
        <label class="btn small" style="margin-top:6px">📷 Pridėti<input type="file" accept="image/*" multiple data-kind="original" hidden></label></div>
    </div>

    <button class="btn primary block" style="min-height:52px;margin-top:16px">💾 Išsaugoti</button>
    ${isNew ? '' : '<button type="button" class="btn danger block" id="r-del">Ištrinti receptą</button>'}
  </form>`;

  const syncFields = () => {
    const f = new FormData($('#ef'));
    d.title = f.get('title'); d.servings = f.get('servings'); d.notes = f.get('notes'); d.source = f.get('source');
    d.tags = f.get('tags').split(',').map(t => t.trim()).filter(Boolean);
    d.steps = f.get('steps').split('\n').map(s => s.trim()).filter(Boolean);
    if (f.has('original_text')) d.original_text = f.get('original_text');
    $$('.ing-edit').forEach((row, i) => {
      const g = d.ingredients[i];
      g.qty = $('[data-k=qty]', row).value; g.unit = $('[data-k=unit]', row).value;
      g.product_name = $('[data-k=name]', row).value; g.note = $('[data-k=note]', row).value;
      const p = findProduct(g.product_name); g.product_id = p ? p.id : null;
    });
  };
  const drawIngs = () => {
    $('#ings').innerHTML = d.ingredients.map((g, i) => `<div class="ing-edit">
      <input type="text" inputmode="decimal" data-k="qty" placeholder="Kiek" value="${g.qty != null && g.qty !== '' ? esc(typeof g.qty === 'number' ? fmtNum(g.qty) : g.qty) : ''}">
      <select data-k="unit">${UNITS.map(u => `<option ${u === (g.unit || '') ? 'selected' : ''}>${u}</option>`).join('')}${UNITS.includes(g.unit || '') ? '' : `<option selected>${esc(g.unit)}</option>`}</select>
      <div class="ac-name"><input type="text" data-k="name" placeholder="Produktas" autocomplete="off" value="${esc(g.product_name)}"></div>
      <button type="button" class="x-btn" data-rm="${i}">×</button>
      <input type="text" class="note" data-k="note" placeholder="pastaba" value="${esc(g.note)}">
    </div>`).join('');
    $$('.ing-edit [data-k=name]').forEach(inp => autocomplete(inp));
    $$('[data-rm]').forEach(b => b.onclick = () => { syncFields(); d.ingredients.splice(+b.dataset.rm, 1); drawIngs(); });
  };
  drawIngs();
  $('#ing-add').onclick = () => { syncFields(); d.ingredients.push({ qty: '', unit: '', product_name: '', note: '' }); drawIngs(); $$('.ing-edit [data-k=name]').pop().focus(); };
  $('#ing-paste').onclick = () => sheet(`<h3>Įklijuoti ingredientus</h3><p class="muted small">Po vieną eilutėje, pvz.:<br>500 g maltos mėsos<br>2 svogūnai<br>1 šaukštas pomidorų pastos<br>druska pagal skonį</p>
    <textarea id="pastebox" style="min-height:200px"></textarea><button class="btn primary block" id="pasteok" style="margin-top:10px">Pridėti</button>`, () => {
    $('#pasteok').onclick = () => {
      syncFields();
      $('#pastebox').value.split('\n').map(parseLine).filter(Boolean).forEach(p => d.ingredients.push({ qty: p.qty, unit: p.unit, product_name: p.name, note: p.note }));
      closeSheet(); drawIngs();
    };
  });
  $$('[data-star]').forEach(b => b.onclick = () => { syncFields(); d.rating = d.rating === +b.dataset.star ? 0 : +b.dataset.star; render(); });
  $$('input[type=file]').forEach(inp => inp.onchange = async () => {
    syncFields();
    for (const file of inp.files) d.new_photos.push({ kind: inp.dataset.kind, data: await resizeImage(file, inp.dataset.kind === 'original' ? 2000 : 1400) });
    render();
  });
  $$('[data-delph]').forEach(b => b.onclick = async () => { if (confirm('Ištrinti nuotrauką?')) { syncFields(); await act('photo_delete', { id: +b.dataset.delph }); } });
  $('#ef').onsubmit = async e => {
    e.preventDefault(); syncFields();
    const payload = { ...d, ingredients: d.ingredients.filter(g => (g.product_name || '').trim()).map(g => ({ product_id: g.product_id, product_name: g.product_name, qty: g.qty, unit: g.unit, note: g.note })) };
    delete payload._for;
    const btn = $('#ef button.primary'); btn.disabled = true; btn.textContent = 'Saugoma…';
    try {
      const res = await api('api/do/recipe_save', payload);
      draft = null; busyEditing = false; await load(true);
      location.replace('#recipe/' + res.id);
    } catch (err) { btn.disabled = false; btn.textContent = '💾 Išsaugoti'; }
  };
  $('#imp-url') && ($('#imp-url').onclick = importUrlSheet);
  $('#imp-text') && ($('#imp-text').onclick = () => importTextSheet(''));
  const del = $('#r-del');
  if (del) del.onclick = async () => { if (confirm('Tikrai ištrinti receptą „' + r.title + '“? To atšaukti negalima.')) { await api('api/do/recipe_delete', { id: r.id }); draft = null; await load(true); go('#recipes'); } };
};

// ------------------------------------------------------------ importas iš nuorodos / teksto
function importUrlSheet() {
  sheet(`<h3>🔗 Receptas iš nuorodos</h3>
    <p class="muted small" style="margin:0 2px 8px">Įklijuokite recepto puslapio nuorodą. Daugumai receptų svetainių programa pati paims pavadinimą, ingredientus, žingsnius ir nuotrauką. Instagram – tik bandymas.</p>
    <input type="url" id="iu" placeholder="https://..." autocomplete="off">
    <button class="btn primary block" id="iu-go" style="margin-top:10px">Paimti receptą</button>
    <p class="muted small" id="iu-msg" style="margin:10px 2px 0"></p>`, () => {
    $('#iu').focus();
    $('#iu-go').onclick = async () => {
      const url = $('#iu').value.trim(); if (!url) return;
      const b = $('#iu-go'); b.disabled = true; b.textContent = 'Atsisiunčiama…'; $('#iu-msg').textContent = '';
      let r; try { r = await api('api/import_url', { url }); } catch (e) { r = { error: 'Nėra ryšio su serveriu' }; }
      b.disabled = false; b.textContent = 'Paimti receptą';
      if (r.error) {
        $('#iu-msg').innerHTML = `⚠️ ${esc(r.error)}<br><button class="btn small" id="iu-text" style="margin-top:8px">📝 Įklijuoti tekstą</button>`;
        $('#iu-text').onclick = () => importTextSheet('', url);
        return;
      }
      closeSheet();
      if (r.kind === 'recipe') {
        fillDraft({ title: r.title, servings: r.servings, ingredients: r.ingredients, steps: r.steps, notes: r.notes, source: r.source, image: r.image,
          original: [r.title, '', ...(r.ingredients || []), '', ...(r.steps || [])].join('\n') });
        toast('Receptas paimtas – peržiūrėkite ir išsaugokite', 3500);
      } else importTextSheet(r.text, r.source, r.image);
    };
  });
}

function importTextSheet(text, source = '', image = null) {
  sheet(`<h3>📝 Receptas iš teksto</h3>
    <p class="muted small" style="margin:0 2px 8px">Įklijuokite recepto tekstą (pvz. Instagram aprašymą, nukopijuotą per Google Lens). Ingredientai ir žingsniai bus atskirti automatiškai – vėliau galėsite pataisyti.</p>
    <textarea id="it" style="min-height:45vh">${esc(text)}</textarea>
    <button class="btn primary block" id="it-go" style="margin-top:10px">Atpažinti</button>`, () => {
    $('#it-go').onclick = () => {
      const raw = $('#it').value; if (!raw.trim()) return;
      const p = parseRecipeText(raw);
      closeSheet();
      fillDraft({ ...p, source, image, original: raw });
      toast(`Atpažinta: ${p.ingredients.length} ingred., ${p.steps.length} žingsn. – patikrinkite`, 3500);
    };
  });
}

// Taisyklėmis paremtas recepto teksto atpažinimas (be DI)
function parseRecipeText(raw) {
  const ING_H = /^(ingredient\p{L}*|reikės|reikia|sudėtis|produktai|ko reikia|ingredients?|you(?:'|’)ll need)\b/iu;
  const STEP_H = /^(gamin\p{L}*|paruoš\p{L}*|eiga|instrukcij\p{L}*|būdas|kaip gaminti|steps?|method|directions|instructions|preparation)\b/iu;
  const lines = raw.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim());
  let title = '', servings = null, mode = '', ings = [], steps = [], notes = [];
  for (let l of lines) {
    if (!l) continue;
    if (/^(#\S+\s*)+$/.test(l)) continue;                       // tik grotažymės
    l = l.replace(/(\s#[\p{L}\p{N}_]+)+$/u, '').trim();          // grotažymės gale
    const sv = l.match(/(\d+)\s*(porc\p{L}*|asm\p{L}*|serving\p{L}*|serves)/iu) || l.match(/(?:serves|porcijos?)\s*:?\s*(\d+)/iu);
    if (sv && !servings) servings = +sv[1];
    if (sv && l.length < 30) continue;                           // „Porcijos: 4“ – atskira eilutė
    const head = l.replace(/^[\p{Extended_Pictographic}\s*•\-–:]+/u, '').replace(/[:：]\s*$/, '');
    if (ING_H.test(head) && head.length < 40) { mode = 'ing'; continue; }
    if (STEP_H.test(head) && head.length < 40) { mode = 'step'; continue; }
    const bare = l.replace(/^[\p{Extended_Pictographic}\s]+/u, '').replace(/^[-•*·▪️✔️✅☑️]+\s*/u, '').trim();
    if (!bare) continue;
    const numbered = /^\d+\s*[.)]\s+/.test(bare);
    const p = parseLine(bare);
    const looksIng = !numbered && bare.length < 70 && !/[.!?]$/.test(bare) && (p?.qty != null || /^[-•*·]/.test(l) || mode === 'ing');
    if (!title && !looksIng && mode === '' && bare.length < 80 && !numbered) { title = bare.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/[.!]+$/, '').trim(); continue; }
    if (mode === 'step' || numbered || (!looksIng && bare.length >= 40)) { steps.push(bare.replace(/^\d+\s*[.)]\s*/, '')); continue; }
    if (looksIng) { ings.push(bare); continue; }
    notes.push(bare);
  }
  return { title, servings, ingredients: ings, steps, notes: notes.join('\n') };
}

function fillDraft(p) {
  if (!draft || draft._for !== 'new') draft = { title: '', servings: 4, tags: [], notes: '', rating: 0, favorite: 0, steps: [], source: '', ingredients: [], original_text: '', _for: 'new', new_photos: [] };
  const d = draft;
  if (p.title) d.title = p.title;
  if (p.servings) d.servings = p.servings;
  d.ingredients = (p.ingredients || []).map(x => { const q = parseLine(x) || { name: x, qty: null, unit: '', note: '' }; const ex = findProduct(q.name); return { qty: q.qty, unit: q.unit, product_name: ex ? ex.name : q.name, note: q.note }; });
  d.steps = p.steps || [];
  if (p.notes) d.notes = p.notes;
  if (p.source) d.source = p.source;
  d.original_text = p.original || '';
  if (p.image) d.new_photos = [...(d.new_photos || []).filter(x => x.kind !== 'dish'), { kind: 'dish', data: p.image }];
  if (location.hash !== '#edit/new') location.hash = '#edit/new'; else render();
}

function resizeImage(file, max) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.84));
    };
    img.onerror = rej; img.src = url;
  });
}

// ------------------------------------------------------------ GAMINIMO REŽIMAS
let cook = { id: null, step: 0, got: new Set() };
routes.cook = id => {
  const r = IDX.r[id]; if (!r) return go('#recipes');
  if (cook.id !== id) cook = { id, step: 0, got: new Set() };
  const sv = UI.serv && UI.serv.id == id ? UI.serv.n : r.servings, f = sv / (r.servings || 1);
  setTop(r.title, { back: '#recipe/' + id });
  startNoSleep();
  const steps = r.steps;
  const st = steps[cook.step] || '';
  const tm = st.match(/(\d+)\s*(?:[-–]\s*(\d+)\s*)?(min|minut\w*|val\w*|h)\b/i);
  let mins = 0; if (tm) { mins = +(tm[2] || tm[1]); if (/^(val|h)/i.test(tm[3])) mins *= 60; }
  view.innerHTML = `
    <div class="muted small" style="margin:0 4px 6px">Ingredientai (${fmtNum(sv)} porc.) – paspauskite, kai pasiruošta</div>
      <div class="card pad"><ul class="ings cook-ings">${r.ingredients.map((i, k) => `<li data-got="${k}" class="${cook.got.has(k) ? 'got' : ''}"><span class="q">${i.qty != null ? esc(fmtAmount(i.qty * f, i.unit)) : esc(i.unit)}</span><span>${esc(IDX.p[i.product_id]?.name)}${i.note ? ` <span class="muted">(${esc(i.note)})</span>` : ''}</span></li>`).join('')}</ul></div>
    ${steps.length ? `<div class="card pad" style="margin-top:14px">
      <div class="muted small" style="margin-bottom:8px">Žingsnis ${cook.step + 1} iš ${steps.length}</div>
      <div class="cook-step"><span class="num">${cook.step + 1}</span>${esc(st)}</div>
      ${mins ? `<button class="btn timer-btn" id="tbtn">⏱ Laikmatis ${mins} min</button>` : ''}
    </div>
    <div class="cook-nav"><button class="btn" id="prev" ${cook.step === 0 ? 'disabled' : ''}>‹ Atgal</button>
      ${cook.step < steps.length - 1 ? '<button class="btn primary" id="next">Toliau ›</button>' : '<button class="btn primary" id="fin">✓ Baigta</button>'}</div>` : '<div class="empty">Šis receptas neturi žingsnių</div>'}
    <div class="row" style="margin-top:16px"><button class="btn small" id="tman">⏱ Kitas laikmatis</button><span class="grow"></span><span class="muted small" id="wl"></span></div>`;
  $$('[data-got]').forEach(li => li.onclick = () => { const k = +li.dataset.got; cook.got.has(k) ? cook.got.delete(k) : cook.got.add(k); li.classList.toggle('got'); });
  $('#prev') && ($('#prev').onclick = () => { cook.step--; render(); });
  $('#next') && ($('#next').onclick = () => { cook.step++; render(); });
  $('#fin') && ($('#fin').onclick = () => sheet(`<h3>Skanaus! 🍽</h3><div class="stack"><button class="btn primary block" id="logc">✓ Įrašyti, kad pagaminta šiandien</button><button class="btn block" data-close>Ne, ačiū</button></div>`, () => {
    $('#logc').onclick = async () => {
      const m = S.menu.find(x => x.recipe_id == id && !x.cooked && x.day <= S.today);
      if (m) await act('menu_cooked', { id: m.id, cooked: true }); else await act('cooked_now', { recipe_id: +id });
      closeSheet(); cook = { id: null }; go('#recipe/' + id); toast('Įrašyta į istoriją');
    };
  }));
  $('#tbtn') && ($('#tbtn').onclick = () => startTimer(mins, `Žingsnis ${cook.step + 1}`));
  $('#tman').onclick = () => { const m = prompt('Kiek minučių?', '10'); if (m && +m > 0) startTimer(+m, 'Laikmatis'); };
  showScreenState();
};

// laikmačiai
const timers = [];
function startTimer(mins, label) {
  timers.push({ id: Date.now(), end: Date.now() + mins * 60000, label, done: false });
  tickTimers(); toast(`Laikmatis paleistas: ${mins} min`);
}
function tickTimers() {
  const box = $('#timers');
  box.hidden = !timers.length;
  box.innerHTML = timers.map(t => {
    const left = Math.max(0, Math.round((t.end - Date.now()) / 1000));
    if (!left && !t.done) { t.done = true; alarm(t); }
    return `<div class="timer ${t.done ? 'done' : ''}"><span>${esc(t.label)}</span><span>${t.done ? '⏰ Baigta!' : Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0')}</span><button data-tx="${t.id}">✕</button></div>`;
  }).join('');
  $$('[data-tx]', box).forEach(b => b.onclick = () => { timers.splice(timers.findIndex(t => t.id == b.dataset.tx), 1); tickTimers(); });
}
setInterval(() => { if (timers.length) tickTimers(); }, 1000);
function alarm(t) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, .4, .8, 1.6, 2.0, 2.4].forEach(s => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.value = .25; o.start(ctx.currentTime + s); o.stop(ctx.currentTime + s + .25); });
  } catch (e) { }
  navigator.vibrate && navigator.vibrate([400, 200, 400, 200, 400]);
}

// ekranas neužgęsta
// Ekranas neužgęsta gaminant:
// 1) per HA programėlę – Receptai paprašo HA nusiųsti telefonui komandą keep_screen_on (patikimiausia);
// 2) jei atidaryta per https naršyklėje – naršyklės Wake Lock.
// Užrašas rodomas TIK jei vienas iš būdų tikrai pavyko.
let wakeLock = null, noSleepActive = false, screenMode = '', screenBeat = null, screenMsg = '';
async function screenApi(on) {
  try { const r = await fetch('api/screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) }); return await r.json(); }
  catch (e) { return { ok: false, error: 'Nėra ryšio' }; }
}
async function startNoSleep() {
  if (noSleepActive) return;
  noSleepActive = true; screenMsg = ''; screenMode = 'pending'; showScreenState();
  if ('wakeLock' in navigator && window.isSecureContext) {
    try { wakeLock = await navigator.wakeLock.request('screen'); screenMode = 'browser'; } catch (e) { wakeLock = null; }
  }
  if (!wakeLock) {
    const r = await screenApi(true);
    if (r.ok) { screenMode = 'ha'; clearInterval(screenBeat); screenBeat = setInterval(() => screenApi(true), 5 * 60000); }
    else { screenMode = ''; screenMsg = r.error || ''; }
  }
  showScreenState();
}
function showScreenState() {
  const w = $('#wl'); if (!w) return;
  w.innerHTML = screenMode === 'pending' ? '' : screenMode ? '☀️ ekranas neužges' : `<a href="#screen" style="color:inherit">⚠️ ekranas gali užgesti</a>`;
}
function stopNoSleep(keep) {
  if (keep || !noSleepActive) return;
  noSleepActive = false;
  try { wakeLock && wakeLock.release(); } catch (e) { }
  wakeLock = null; clearInterval(screenBeat); screenBeat = null;
  if (screenMode === 'ha') screenApi(false);
  screenMode = '';
}
window.addEventListener('pagehide', () => { if (screenMode === 'ha') navigator.sendBeacon && navigator.sendBeacon('api/screen', new Blob([JSON.stringify({ on: false })], { type: 'application/json' })); });
document.addEventListener('visibilitychange', async () => {
  if (route.name !== 'cook') return;
  if (!document.hidden && screenMode === 'browser') { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { } }
});

// ------------------------------------------------------------ DAUGIAU
routes.more = () => {
  setTop('Daugiau');
  view.innerHTML = `<div class="card" style="overflow:hidden">
    <a class="menu-link" href="#sections"><span>🗂️</span><span>Kategorijos<br><span class="muted small">Pavadinimai ir ženkliukai</span></span></a>
    <a class="menu-link" href="#products"><span>🥕</span><span>Produktai<br><span class="muted small">Kategorija, „visada turima“, sujungimas</span></span></a>
    <a class="menu-link" href="#rules"><span>🎨</span><span>Pastabų paryškinimas<br><span class="muted small">pvz. „Maxima“ – mėlyna, „kuponas“ – balta</span></span></a>
    <a class="menu-link" href="#screen"><span>☀️</span><span>Ekranas gaminant<br><span class="muted small">Kad telefonas neužgestų gaminimo metu</span></span></a>
    <a class="menu-link" href="#stats"><span>📊</span><span>Statistika ir istorija</span></a>
    <a class="menu-link" href="#data"><span>💾</span><span>Importas ir eksportas</span></a>
  </div>
  <p class="muted small center" style="margin-top:20px">Receptai v1.9.0 · ${S.recipes.length} receptai · ${S.products.length} produktai</p>`;
};

// --- Parduotuvės skyriai (tempimas aukštyn/žemyn)
routes.sections = () => {
  setTop('Kategorijos', { back: '#more', actions: `<button class="btn small primary" id="sec-add">＋</button>` });
  const cnt = {}; S.products.forEach(p => cnt[p.section_id] = (cnt[p.section_id] || 0) + 1);
  view.innerHTML = `<p class="muted small" style="margin:0 4px 10px">Kategorijos nustato ženkliuką prieš prekę. Pirkinių sąrašo tvarka nuo jų nepriklauso. Tvarką čia galima keisti tempiant už ☰.</p>
    <div class="card" id="seclist" style="overflow:hidden">${S.sections.map(s => `<div class="list-row" data-sid="${s.id}">
      <span class="handle">☰</span><span style="font-size:22px">${esc(s.emoji)}</span><div class="grow"><b>${esc(s.name)}</b><div class="muted small">${cnt[s.id] || 0} produktai</div></div>
      <button class="icon-btn" data-sedit="${s.id}">✏️</button></div>`).join('')}</div>`;
  $('#sec-add').onclick = () => sectionSheet(null);
  $$('[data-sedit]').forEach(b => b.onclick = () => sectionSheet(IDX.s[b.dataset.sedit]));
  makeSortable($('#seclist'), ids => act('section_order', { ids }));
};

function sectionSheet(s) {
  sheet(`<h3>${s ? 'Redaguoti skyrių' : 'Naujas skyrius'}</h3><form id="sf" class="stack">
    <div class="row"><label class="field" style="width:80px"><span>Ženkliukas</span><input type="text" name="emoji" value="${esc(s?.emoji || '')}" maxlength="4" style="text-align:center;font-size:22px"></label>
    <label class="field grow"><span>Pavadinimas</span><input type="text" name="name" value="${esc(s?.name || '')}" required></label></div>
    <button class="btn primary block">Išsaugoti</button>
    ${s ? '<button type="button" class="btn danger block" id="sdel">Ištrinti skyrių</button>' : ''}</form>`, () => {
    $('#sf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); await act('section_save', { id: s?.id, name: f.get('name'), emoji: f.get('emoji') }); closeSheet(); };
    $('#sdel') && ($('#sdel').onclick = async () => { if (confirm('Ištrinti skyrių? Jo produktai liks be skyriaus.')) { await act('section_delete', { id: s.id }); closeSheet(); } });
  });
}

function makeSortable(list, onDone) {
  let drag = null, startY = 0, rows = [], h = 0, target = 0, lastY = 0, s0 = 0;
  const auto = dragScroller(list, () => drag && move(lastY), 90, 110);
  const start = (y, el) => {
    s0 = auto.start(); drag = el; rows = $$('.list-row', list); h = drag.offsetHeight; startY = y; target = rows.indexOf(drag);
    drag.classList.add('dragging'); navigator.vibrate && navigator.vibrate(15);
  };
  const move = y => {
    lastY = y; const dy = y - startY + auto.pos() - s0; drag.style.transform = `translateY(${dy}px)`;
    const idx = rows.indexOf(drag); target = Math.max(0, Math.min(rows.length - 1, idx + Math.round(dy / h)));
    rows.forEach((r, i) => { if (r === drag) return; let sh = 0; if (idx < target && i > idx && i <= target) sh = -h; if (idx > target && i < idx && i >= target) sh = h; r.style.transform = sh ? `translateY(${sh}px)` : ''; r.style.transition = 'transform .12s'; });
    auto.at(y);
  };
  const end = () => {
    auto.stop();
    if (!drag) return;
    const idx = rows.indexOf(drag);
    rows.forEach(r => { r.style.transform = ''; r.style.transition = ''; });
    drag.classList.remove('dragging');
    const ids = rows.map(r => +r.dataset.sid); const [m] = ids.splice(idx, 1); ids.splice(target, 0, m);
    drag = null;
    if (target !== idx) onDone(ids);
  };
  // telefonas: touch įvykiai (patikimiausia HA programėlėje)
  list.addEventListener('touchstart', e => { const hd = e.target.closest('.handle'); if (!hd) return; e.preventDefault(); start(e.touches[0].clientY, hd.closest('.list-row')); }, { passive: false });
  list.addEventListener('touchmove', e => { if (!drag) return; e.preventDefault(); move(e.touches[0].clientY); }, { passive: false });
  list.addEventListener('touchend', end); list.addEventListener('touchcancel', end);
  // kompiuteris: pelė
  list.addEventListener('mousedown', e => { const hd = e.target.closest('.handle'); if (!hd) return; e.preventDefault(); start(e.clientY, hd.closest('.list-row'));
    const mm = ev => move(ev.clientY), mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); end(); };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu); });
}

// --- Ekranas gaminant (būsena ir bandymas)
routes.screen = async () => {
  setTop('Ekranas gaminant', { back: '#more' });
  view.innerHTML = '<div class="empty">Tikrinama…</div>';
  let st = {}; try { st = await (await fetch('api/screen_status')).json(); } catch (e) { st = { error: 'Nėra ryšio' }; }
  const ok = st.targets && st.targets.length;
  view.innerHTML = `<div class="card pad stack">
    <p style="margin:0">Paspaudus <b>„Gaminti“</b>, Receptai paprašo Home Assistant, kad telefono ekranas neužgestų. Baigus gaminti (ar po 15 min. neveiklumo) – atšaukiama.</p>
    <p class="muted small" style="margin:0">Veikia, kai Receptai atidaryti per <b>Home Assistant programėlę</b> Android telefone.</p></div>
    <h2>Šis telefonas</h2><div class="card pad stack">
    ${!st.via_ha ? '<p style="margin:0">⚠️ Receptai atidaryti ne per HA programėlę, todėl ekrano valdyti negalima.</p>' : ''}
    ${st.user ? `<div>Naudotojas: <b>${esc(st.user)}</b></div>` : ''}
    ${st.via_ha ? `<div>Asmuo HA: <b>${st.person ? esc(st.person) : '— nerastas'}</b></div>
      <div>Sekami įrenginiai: <b>${st.trackers && st.trackers.length ? st.trackers.map(esc).join(', ') : '— nėra'}</b></div>` : ''}
    ${ok ? `<div>✅ Telefonas: <b>${st.targets.map(esc).join(', ')}</b></div>` : st.via_ha ? '<div>⚠️ Telefonas nerastas.</div>' : ''}
    ${st.error ? `<div class="muted small">${esc(st.error)}</div>` : ''}
    ${ok ? '<div class="row"><button class="btn grow" id="sc-on">Bandyti įjungti</button><button class="btn grow" id="sc-off">Atšaukti</button></div><p class="muted small" style="margin:0">Įjungus palikite ekraną ramybėje ilgiau nei įprastas užmigimo laikas – jis neturėtų užgesti.</p>' : ''}
    </div>
    ${st.via_ha && !ok ? `<h2>Kaip sutvarkyti</h2><div class="card pad"><p style="margin-top:0">HA: <b>Nustatymai → Žmonės</b> → jūsų vardas → skiltyje „Sekti įrenginius“ turi būti pasirinktas jūsų telefonas.</p>
      <p style="margin-bottom:0">Arba Receptai programėlės <b>Konfigūracijoje</b> laukelyje <i>ekrano_telefonai</i> įrašykite telefono pranešimų paslaugą${st.all && st.all.length ? ': ' + st.all.map(x => '<code>' + esc(x) + '</code>').join(', ') : ''}.</p></div>` : ''}`;
  $('#sc-on') && ($('#sc-on').onclick = async () => { const r = await screenApi(true); toast(r.ok ? 'Įjungta – ekranas neužges' : (r.error || 'Nepavyko')); });
  $('#sc-off') && ($('#sc-off').onclick = async () => { const r = await screenApi(false); toast(r.ok ? 'Atšaukta' : (r.error || 'Nepavyko')); });
};

// --- Pastabų paryškinimas
routes.rules = () => {
  setTop('Pastabų paryškinimas', { back: '#more', actions: `<button class="btn small primary" id="rule-add">＋</button>` });
  const rules = S.rules || [];
  view.innerHTML = `<p class="muted small" style="margin:0 4px 10px">Kai prekės pastaboje yra šis žodis, jis bus nuspalvintas. Žodis atpažįstamas pagal pradžią, todėl „kupon“ tiks ir „kuponas“, ir „kupono“. Didžiosios ir mažosios raidės nesvarbu.</p>
    <div class="card" style="overflow:hidden">${rules.map(r => `<div class="list-row" data-rule="${r.id}" style="cursor:pointer"><div class="grow"><span style="font-size:17px;${r.color ? 'color:' + colorCss(r.color) + ';' : ''}${r.bold ? 'font-weight:700' : ''}">${esc(r.word)}</span></div><span class="muted small">${esc((COLORS.find(c => c[0] === r.color) || COLORS[0])[1])}${r.bold ? ' · paryškinta' : ''}</span><span class="muted">›</span></div>`).join('') || '<div class="empty">Dar nėra taisyklių. Spauskite ＋</div>'}</div>`;
  $('#rule-add').onclick = () => ruleSheet(null);
  $$('[data-rule]').forEach(el => el.onclick = () => ruleSheet(rules.find(r => r.id == el.dataset.rule)));
};

function ruleSheet(r) {
  let color = r ? r.color : '#3b82f6', bold = r ? !!r.bold : true;
  sheet(`<h3>${r ? 'Redaguoti' : 'Nauja taisyklė'}</h3><div class="stack">
    <label class="field"><span>Žodis</span><input type="text" id="rw" value="${esc(r?.word || '')}" placeholder="pvz. Maxima"></label>
    <div><span class="muted small">Spalva</span><div class="swatches" id="sw">${COLORS.map(([c, n]) => `<button type="button" data-c="${c}" title="${n}" class="${c === color ? 'on' : ''}" style="${c ? 'background:' + colorCss(c) : ''}">${c ? '' : 'Aa'}</button>`).join('')}</div></div>
    <div class="row"><b class="grow">Paryškinta (bold)</b><label class="switch"><input type="checkbox" id="rb" ${bold ? 'checked' : ''}><i></i></label></div>
    <div class="card pad"><span class="muted small">Peržiūra: </span><span id="rprev"></span></div>
    <button class="btn primary block" id="rsave">Išsaugoti</button>
    ${r ? '<button class="btn danger block" id="rdel">Ištrinti</button>' : ''}</div>`, () => {
    const prev = () => { $('#rprev').innerHTML = `Padažas – <span style="${color ? 'color:' + colorCss(color) + ';' : ''}${bold ? 'font-weight:700' : ''}">${esc($('#rw').value || 'žodis')}</span>, akcija`; };
    $$('#sw button').forEach(b => b.onclick = () => { color = b.dataset.c; $$('#sw button').forEach(x => x.classList.toggle('on', x === b)); prev(); });
    $('#rb').onchange = () => { bold = $('#rb').checked; prev(); };
    $('#rw').oninput = prev; prev();
    $('#rsave').onclick = async () => { await act('rule_save', { id: r?.id, word: $('#rw').value, color, bold }); closeSheet(); };
    $('#rdel') && ($('#rdel').onclick = async () => { await act('rule_delete', { id: r.id }); closeSheet(); });
  });
}

// --- Produktai
routes.products = () => {
  setTop('Produktai', { back: '#more' });
  const q0 = UI.pq || '';
  view.innerHTML = `<input type="search" id="pq" placeholder="Ieškoti produkto…" value="${esc(q0)}"><p class="muted small" style="margin:8px 4px">Paspauskite produktą norėdami pakeisti skyrių, pavadinimą arba sujungti du produktus (pvz. „Svogūnas“ ir „Svogūnai“).</p><div id="plist"></div>`;
  const usage = {}; S.recipes.forEach(r => r.ingredients.forEach(i => usage[i.product_id] = (usage[i.product_id] || 0) + 1));
  const draw = () => {
    const q = normName($('#pq').value);
    const rowsP = S.products.filter(p => !q || p.norm.includes(q)).map(p => ({ p, pid: p.id }));
    $('#plist').innerHTML = groupBySection(rowsP).map(g => `<div class="sec-title">${esc(g.sec.emoji)} ${esc(g.sec.name)}</div><div class="card" style="overflow:hidden">${g.rows.map(({ p }) => `<div class="list-row" data-prod="${p.id}" style="cursor:pointer"><div class="grow"><b>${esc(p.name)}</b><div class="muted small">${usage[p.id] ? usage[p.id] + ' recept.' : 'nenaudojamas receptuose'}${p.always_have ? ' · visada turima' : ''}</div></div><span class="muted">›</span></div>`).join('')}</div>`).join('') || '<div class="empty">Nerasta</div>';
    $$('[data-prod]').forEach(el => el.onclick = () => productSheet(IDX.p[el.dataset.prod], usage[el.dataset.prod] || 0));
  };
  draw();
  $('#pq').oninput = () => { UI.pq = $('#pq').value; saveUI(); draw(); };
};

function productSheet(p, used) {
  sheet(`<h3>${esc(p.name)}</h3><form id="pf" class="stack">
    <label class="field"><span>Pavadinimas</span><input type="text" name="name" value="${esc(p.name)}"></label>
    <label class="field"><span>Skyrius parduotuvėje</span><select name="section_id"><option value="">— nepriskirta —</option>${S.sections.map(s => `<option value="${s.id}" ${s.id === p.section_id ? 'selected' : ''}>${esc(s.emoji + ' ' + s.name)}</option>`).join('')}</select></label>
    <div class="row"><div class="grow"><b>Visada turima namie</b><div class="muted small">pvz. druska, aliejus – į sąrašą nepateks, nebent pažymėsite „Reikia“</div></div>
    <label class="switch"><input type="checkbox" name="always_have" ${p.always_have ? 'checked' : ''}><i></i></label></div>
    <button class="btn primary block">Išsaugoti</button>
    <hr><label class="field"><span>Sujungti su kitu produktu (šis bus pašalintas, receptai perkelti)</span>
    <div class="row"><div class="grow"><input type="text" id="mergeto" autocomplete="off" placeholder="Į kurį produktą…"></div><button type="button" class="btn" id="merge">Sujungti</button></div></label>
    ${used ? '' : '<button type="button" class="btn danger block" id="pdel">Ištrinti produktą</button>'}</form>`, () => {
    $('#pf').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      await act('product_save', { id: p.id, name: f.get('name'), section_id: +f.get('section_id') || null, always_have: !!f.get('always_have') }); closeSheet();
    };
    autocomplete($('#mergeto'), { source: () => S.products.filter(x => x.id !== p.id) });
    $('#merge').onclick = async () => {
      const t = S.products.find(x => x.name === $('#mergeto').value && x.id !== p.id);
      if (!t) return toast('Pasirinkite produktą iš sąrašo');
      if (confirm(`Sujungti „${p.name}“ į „${t.name}“?`)) { await act('product_merge', { from: p.id, into: t.id }); closeSheet(); }
    };
    $('#pdel') && ($('#pdel').onclick = async () => { await act('product_delete', { id: p.id }); closeSheet(); });
  });
}

// --- Statistika
const MONTHS_S = ['saus.', 'vas.', 'kov.', 'bal.', 'geg.', 'birž.', 'liep.', 'rugp.', 'rugs.', 'spal.', 'lapkr.', 'gruod.'];
const MONTHS_N = ['Sausis', 'Vasaris', 'Kovas', 'Balandis', 'Gegužė', 'Birželis', 'Liepa', 'Rugpjūtis', 'Rugsėjis', 'Spalis', 'Lapkritis', 'Gruodis'];
function agoText(day) {
  const n = Math.round((parseDate(S.today) - parseDate(day)) / 86400000);
  if (n <= 0) return 'šiandien';
  if (n === 1) return 'vakar';
  if (n < 45) return `prieš ${n} d.`;
  if (n < 365) return `prieš ${Math.round(n / 30)} mėn.`;
  return `prieš ${(n / 365).toFixed(1).replace('.', ',')} m.`;
}
routes.stats = () => {
  setTop('Statistika', { back: '#more' });
  const hist = S.history;
  const top = [...S.recipes].filter(r => r.cooked_count).sort((a, b) => b.cooked_count - a.cooked_count || (b.last_cooked || '').localeCompare(a.last_cooked || '')).slice(0, 10);
  const longAgo = [...S.recipes].filter(r => r.last_cooked).sort((a, b) => a.last_cooked.localeCompare(b.last_cooked)).slice(0, 8);
  const never = S.recipes.filter(r => !r.cooked_count);
  const d30 = parseDate(S.today); d30.setDate(d30.getDate() - 30);
  const last30 = hist.filter(h => h.day >= dateStr(d30)).length;
  // 6 mėnesių stulpeliai
  const t = parseDate(S.today), months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(t.getFullYear(), t.getMonth() - i, 1); months.push({ key: dateStr(d).slice(0, 7), m: d.getMonth(), n: 0 }); }
  hist.forEach(h => { const x = months.find(m => m.key === h.day.slice(0, 7)); if (x) x.n++; });
  const maxM = Math.max(1, ...months.map(m => m.n)), maxTop = Math.max(1, ...top.map(r => r.cooked_count));
  // istorija pagal mėnesius
  let hh = '', cur = '';
  const HN = UI.statAll ? 300 : 25;
  hist.slice(0, HN).forEach(h => {
    const k = h.day.slice(0, 7), d = parseDate(h.day);
    if (k !== cur) { cur = k; hh += `<div class="st-mh">${MONTHS_N[d.getMonth()]} ${d.getFullYear() !== t.getFullYear() ? d.getFullYear() : ''}</div>`; }
    hh += `<div class="st-row"><span class="st-day">${d.getDate()} d.<br><span>${DAYS_SHORT[d.getDay()]}</span></span><a class="grow st-t" href="#recipe/${h.recipe_id}">${esc(IDX.r[h.recipe_id]?.title || '?')}</a><button class="x-btn" data-hdel="${h.id}" aria-label="Ištrinti">×</button></div>`;
  });
  view.innerHTML = `<div class="st-kpi">
      <div class="card"><b>${S.recipes.length}</b><span>receptų</span></div>
      <div class="card"><b>${last30}</b><span>per 30 d.</span></div>
      <div class="card"><b>${never.length}</b><span>dar negaminta</span></div></div>
    <h2>Gaminimas per mėnesį</h2>
    <div class="card st-chart">${months.map(m => `<div class="st-col"><span class="st-n">${m.n || ''}</span><i style="height:${Math.round(m.n / maxM * 100)}%"></i><span class="st-m">${MONTHS_S[m.m]}</span></div>`).join('')}</div>
    <h2>Dažniausiai gaminami</h2>
    <div class="card st-list">${top.map((r, i) => `<a class="st-row" href="#recipe/${r.id}"><span class="st-rank">${i + 1}</span><span class="grow"><span class="st-t">${esc(r.title)}</span>
      <span class="st-bar"><i style="width:${Math.round(r.cooked_count / maxTop * 100)}%"></i></span><span class="st-sub">paskutinį kartą ${agoText(r.last_cooked)}</span></span><span class="st-cnt">${r.cooked_count}×</span></a>`).join('') || '<div class="empty">Dar nėra istorijos</div>'}</div>
    <h2>Seniai gaminta</h2>
    <div class="card st-list">${longAgo.map(r => `<a class="st-row" href="#recipe/${r.id}"><span class="grow st-t">${esc(r.title)}</span><span class="st-ago">${agoText(r.last_cooked)}</span></a>`).join('') || '<div class="empty">—</div>'}</div>
    <h2>Istorija</h2>
    <div class="card st-list">${hh || '<div class="empty">Kai pažymėsite, kad receptas pagamintas, jis atsiras čia.</div>'}${hist.length > HN ? `<button class="st-more" id="st-more">Rodyti visą istoriją (${hist.length})</button>` : ''}</div>`;
  $('#st-more') && ($('#st-more').onclick = () => { UI.statAll = true; render(); });
  $$('[data-hdel]').forEach(b => b.onclick = async () => { if (confirm('Ištrinti įrašą iš istorijos?')) await act('history_delete', { id: +b.dataset.hdel }); });
};

// --- Importas / eksportas
routes.data = () => {
  setTop('Importas ir eksportas', { back: '#more' });
  view.innerHTML = `<div class="card pad stack">
      <b>📥 Importuoti receptus</b>
      <p class="muted small" style="margin:0">Pasirinkite .json failą, kurį paruošė Claude iš jūsų receptų nuotraukų, arba įklijuokite jo turinį žemiau.</p>
      <label class="btn block">Pasirinkti failą<input type="file" id="impfile" accept=".json,application/json,text/plain" hidden></label>
      <textarea id="imptext" placeholder='{"receptai": [ ... ]}'></textarea>
      <button class="btn primary block" id="impgo">Importuoti įklijuotą tekstą</button>
    </div>
    <div class="card pad stack" style="margin-top:12px">
      <b>📤 Atsarginė kopija</b>
      <p class="muted small" style="margin:0">Atsisiunčia visus duomenis su nuotraukomis į vieną failą. Visi duomenys taip pat patenka į jūsų Home Assistant atsargines kopijas.</p>
      <a class="btn block" href="api/export" download>Atsisiųsti kopiją</a>
      <p class="muted small" style="margin:0">Atkurti iš tokios kopijos galima tuo pačiu importo mygtuku – <b>dėmesio:</b> tada esami duomenys bus pakeisti.</p>
    </div>`;
  const doImport = async text => {
    let data; try { data = JSON.parse(text); } catch (e) { return toast('Neteisingas failo formatas'); }
    const isBackup = data && data.programa === 'receptai';
    if (isBackup && !confirm('Tai pilna atsarginė kopija. Visi dabartiniai duomenys bus pakeisti. Tęsti?')) return;
    const res = await act('import', { data });
    toast(`Importuota receptų: ${res.imported}`, 3500); go('#recipes');
  };
  $('#impfile').onchange = async e => { const f = e.target.files[0]; if (f) doImport(await f.text()); };
  $('#impgo').onclick = () => doImport($('#imptext').value);
};

// ------------------------------------------------------------ apatinis langas
function sheet(html, bind) {
  $('#sheet').innerHTML = '<div class="grab"></div>' + html;
  $('#sheet').hidden = false; $('#sheet-bg').hidden = false; $('#undo').hidden = true;
  $$('[data-close]', $('#sheet')).forEach(b => b.onclick = closeSheet);
  bind && bind();
  const first = $('#sheet input[type=text], #sheet input[type=search]');
  if (first && !('ontouchstart' in window)) first.focus();
}
// Iškrentantis meniu (kaip Google Keep ⋮)
function popMenu(anchor, html, bind) {
  closePop();
  const bg = document.createElement('div'); bg.id = 'pop-bg'; bg.onclick = closePop;
  const box = document.createElement('div'); box.id = 'pop'; box.innerHTML = html;
  document.body.append(bg, box);
  const r = anchor.getBoundingClientRect();
  box.style.top = (r.top + 4) + 'px';
  box.style.right = Math.max(8, innerWidth - r.right) + 'px';
  $('#undo').hidden = true;
  bind && bind();
}
function closePop() { $('#pop')?.remove(); $('#pop-bg')?.remove(); }
window.addEventListener('hashchange', closePop);

function closeSheet() { $('#sheet').hidden = true; $('#sheet-bg').hidden = true; $('#sheet').innerHTML = ''; }
$('#sheet-bg').onclick = closeSheet;

// ------------------------------------------------------------ paleidimas
load().catch(e => { view.innerHTML = `<div class="empty"><span class="big">⚠️</span>Nepavyko prisijungti prie serverio.<br><button class="btn" onclick="location.reload()">Bandyti dar kartą</button></div>`; });
