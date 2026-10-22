/* Rodukas – augintinio priežiūros programa */
'use strict';

// ============================================================ pagalbinės
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
let S = null;   // visa būsena iš serverio
let I = {};     // id -> įrašas kiekvienai lentelei
const UI = (() => { try { return JSON.parse(localStorage.getItem('rodukas_ui') || '{}'); } catch (e) { return {}; } })();
function saveUI() { try { localStorage.setItem('rodukas_ui', JSON.stringify(UI)); } catch (e) { } }

const MONTHS_G = ['sausio', 'vasario', 'kovo', 'balandžio', 'gegužės', 'birželio', 'liepos', 'rugpjūčio', 'rugsėjo', 'spalio', 'lapkričio', 'gruodžio'];
const MONTHS_N = ['Sausis', 'Vasaris', 'Kovas', 'Balandis', 'Gegužė', 'Birželis', 'Liepa', 'Rugpjūtis', 'Rugsėjis', 'Spalis', 'Lapkritis', 'Gruodis'];
const MONTHS_S = ['saus.', 'vas.', 'kov.', 'bal.', 'geg.', 'birž.', 'liep.', 'rugp.', 'rugs.', 'spal.', 'lapkr.', 'gruod.'];
const DAYS = ['Sekmadienis', 'Pirmadienis', 'Antradienis', 'Trečiadienis', 'Ketvirtadienis', 'Penktadienis', 'Šeštadienis'];

const VISIT_ICON = { VET: '🩺', SPA: '🛁', Tyrimai: '🧪' };
const JOURNAL_ICON = { 'Pastaba': '📝', 'Vėmimas': '🤮', 'Viduriavimas': '💩', 'Kosulys / čiaudulys': '🤧', 'Kvėpavimas': '😮‍💨', 'Akys': '👁️', 'Ausys': '👂', 'Oda / kailis': '🐾', 'Šlubavimas': '🦵', 'Apetitas': '🥣', 'Elgesys': '🐕', 'Kita': '❗' };
const PREV_ICON = { 'Vakcina': '💉', 'Antiparazitinė': '🛡️' };
const SEVERITY = [[0, '—'], [1, 'Lengvas'], [2, 'Vidutinis'], [3, 'Stiprus']];
const FOOD_KINDS = ['Sausas', 'Šlapias', 'Skanėstas', 'Papildas', 'Kita'];
const vIcon = c => VISIT_ICON[c] || '📍';
const jIcon = c => JOURNAL_ICON[c] || '🩹';
const pIcon = k => PREV_ICON[k] || '💊';

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
async function act(name, data) { const res = await api('api/do/' + name, data || {}); await load(); return res; }
const saveRow = (t, row) => act('save', { t, row });
const delRow = (t, id) => act('delete', { t, id });

async function load(noRender) {
  S = await api('api/state');
  I = {};
  for (const k of Object.keys(S)) if (Array.isArray(S[k])) { I[k] = {}; S[k].forEach(r => I[k][r.id] = r); }
  if (!noRender) render();
}

// sinchronizacija tarp telefonų
setInterval(async () => {
  if (!S || document.hidden || !$('#sheet').hidden) return;
  try {
    const v = await (await fetch('api/version')).json();
    if (v.version !== S.version) { const y = scrollY; await load(); scrollTo(0, y); }
  } catch (e) { }
}, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S && $('#sheet').hidden) load().catch(() => { }); });

// ---- datos ir skaičiai
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ds = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const T = () => S.today;
const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ds(d); };
const addMonths = (s, n) => { const d = pd(s), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return ds(d); };
const niceDate = s => { if (!s) return ''; const d = pd(s); return `${d.getFullYear()} m. ${MONTHS_G[d.getMonth()]} ${d.getDate()} d.`; };
const dayTitle = s => { const d = pd(s); return `${DAYS[d.getDay()]}, ${MONTHS_G[d.getMonth()]} ${d.getDate()} d.`; };
function ago(s) {
  if (!s) return '';
  const n = diffDays(s, T());
  if (n === 0) return 'šiandien';
  if (n === 1) return 'vakar';
  if (n < 0) return until(s);
  if (n < 60) return `prieš ${n} d.`;
  if (n < 730) return `prieš ${Math.round(n / 30.44)} mėn.`;
  return `prieš ${fmtNum(n / 365.25, 1)} m.`;
}
function until(s) {
  const n = diffDays(T(), s);
  if (n === 0) return 'šiandien';
  if (n === 1) return 'rytoj';
  if (n < 0) return ago(s);
  if (n < 60) return `po ${n} d.`;
  return `po ${Math.round(n / 30.44)} mėn.`;
}
function age(birth) {
  if (!birth) return '';
  const b = pd(birth), t = pd(T());
  let m = (t.getFullYear() - b.getFullYear()) * 12 + t.getMonth() - b.getMonth();
  if (t.getDate() < b.getDate()) m--;
  const y = Math.floor(m / 12); m %= 12;
  return y ? `${y} m.${m ? ' ' + m + ' mėn.' : ''}` : `${m} mėn.`;
}
function duration(a, b) {
  const n = diffDays(a, b || T()) + 1;
  if (n < 60) return `${n} d.`;
  if (n < 730) return `${Math.round(n / 30.44)} mėn.`;
  return `${fmtNum(n / 365.25, 1)} m.`;
}
function fmtNum(n, dec = 1) {
  if (n == null || n === '' || isNaN(n)) return '';
  return String(Math.round(n * 10 ** dec) / 10 ** dec).replace('.', ',');
}
const pnum = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
const kg = v => fmtNum(v, 2) + ' kg';
const money = v => v == null ? '' : fmtNum(v, 2).replace(/,(\d)$/, ',$10') + ' €';

// ============================================================ duomenų išvestinės
const sortDesc = (arr, k = 'date') => [...arr].sort((a, b) => (b[k] || '').localeCompare(a[k] || '') || b.id - a.id);
const weightsDesc = () => sortDesc(S.weights.filter(w => w.date && w.kg));
const lastWeight = () => weightsDesc()[0];
const activeFeedings = () => S.feedings.filter(f => (!f.start || f.start <= T()) && (!f.end || f.end >= T()));
const activeMeds = () => S.meds.filter(m => (!m.start || m.start <= T()) && (!m.end || m.end >= T()));
const procsSorted = () => [...S.procedures].sort((a, b) => a.pos - b.pos || a.id - b.id);
const foodName = id => { const f = I.foods[id]; return f ? f.name + (f.brand && !f.name.toLowerCase().includes(f.brand.toLowerCase()) ? ` (${f.brand})` : '') : '?'; };
const contactName = id => I.contacts[id]?.name || '';
const visitLabel = v => v.title || v.category || 'Vizitas';
const docsOf = (k, id) => sortDesc(S.documents.filter(d => d[k] == id));

function preventionLatest() {
  const by = {};
  for (const p of sortDesc(S.prevention)) { const k = (p.name || '').toLowerCase(); if (!by[k]) by[k] = p; }
  return Object.values(by).sort((a, b) => (a.valid_until || '9999').localeCompare(b.valid_until || '9999'));
}
function prevStatus(p) {
  if (!p.valid_until) return { cls: '', txt: 'be galiojimo datos' };
  const n = diffDays(T(), p.valid_until);
  if (n < 0) return { cls: 'bad', txt: `baigėsi ${p.valid_until}`, n };
  if (n <= (S.settings.alert_days || 30)) return { cls: 'warn', txt: `baigiasi ${until(p.valid_until)}`, n };
  return { cls: 'ok', txt: `iki ${p.valid_until}`, n };
}
function procLast(p) {
  const logs = S.proc_log.filter(l => l.procedure_id === p.id && l.date).map(l => l.date).sort();
  return logs[logs.length - 1] || null;
}
const WEEKDAYS = [[1, 'Pirmadienis'], [2, 'Antradienis'], [3, 'Trečiadienis'], [4, 'Ketvirtadienis'], [5, 'Penktadienis'], [6, 'Šeštadienis'], [7, 'Sekmadienis']];
const isoWd = s => pd(s).getDay() || 7;
function nextDue(p, last) {
  const mode = p.mode || 'interval';
  if (mode === 'daily') return null;
  if (mode === 'weekday') {
    const wd = +p.weekday || 7;
    let d = last ? addDays(last, 1) : addDays(T(), -6);
    while (isoWd(d) !== wd) d = addDays(d, 1);
    return d;
  }
  const iv = Math.max(1, +p.interval_days || 7);
  return last ? addDays(last, iv) : T();
}
function procState(p) {
  const last = procLast(p);
  const due = nextDue(p, last);
  if (!due) return { cls: '', txt: 'kasdien, nežymima', last, due };
  const n = diffDays(T(), due);
  const nx = n === 1 ? 'rytoj' : `po ${n} d.`;
  if (last === T()) return { cls: 'done', txt: `✓ atlikta šiandien · kitas ${nx}`, last, due, n };
  if (n > 0) return { cls: '', txt: nx, last, due, n };
  if (n === 0) return { cls: 'due', txt: 'šiandien', last, due, n };
  return { cls: 'over', txt: `vėluoja ${-n} d.`, last, due, n };
}
const trackedProcs = () => procsSorted().filter(p => (p.mode || 'interval') !== 'daily' && p.active);
function procModeText(p) {
  const mode = p.mode || 'interval';
  if (mode === 'daily') return 'kasdien, nežymima';
  const base = mode === 'weekday' ? `kas savaitę, ${(WEEKDAYS.find(w => w[0] == p.weekday) || WEEKDAYS[6])[1].toLowerCase()}` : `kas ${p.interval_days || 7} d. nuo paskutinio karto`;
  return base + (p.remind ? ` · 🔔 ${p.remind_time || ''}` : ' · be priminimo');
}
function birthdayInfo(birth) {
  if (!birth) return null;
  const b = pd(birth), t = pd(T());
  let next = new Date(t.getFullYear(), b.getMonth(), b.getDate());
  if (next < t) next = new Date(t.getFullYear() + 1, b.getMonth(), b.getDate());
  const days = Math.round((next - t) / 86400000);
  return days <= 30 ? { days, turns: next.getFullYear() - b.getFullYear() } : null;
}
const SUPPLY_ICON = { 'Raukšlės': '🫧', 'Dantys': '🦷', 'Ausys': '👂', 'Akys': '👁️', 'Letenos': '🐾', 'Kailis / maudymas': '🛁', 'Nagai': '✂️', 'Oda': '🩹' };
const sIcon = p => SUPPLY_ICON[p] || '🧴';
const isActiveRange = (start, end) => (!start || start <= T()) && (!end || end >= T());
const supplyActive = s => (!s.start || s.start <= T()) && (!s.end || s.end > T());
const activeSupplies = () => S.supplies.filter(supplyActive);
const nw = v => `<span class="nw">${esc(v)}</span>`;
const overlaps = (start, end, from, to) => (!start || start <= to) && (!end || end >= from);
function unsuitableList() {
  return [...S.foods.filter(f => f.unsuitable).map(f => '🍽️ ' + f.name), ...S.supplies.filter(s => s.unsuitable).map(s => sIcon(s.purpose) + ' ' + s.name)];
}

// ============================================================ maršrutai
const routes = {};
let route = { name: 'home', arg: null };
function go(hash) { location.hash = hash; }
window.addEventListener('hashchange', () => { closeSheet(); render(); scrollTo(0, 0); });

function setTop(title, opts = {}) {
  $('#title').textContent = title;
  $('#back').hidden = !opts.back;
  $('#back').onclick = () => opts.back === true ? history.back() : go(opts.back);
  $('#top-actions').innerHTML = opts.actions || '';
}
function render() {
  if (!S) return;
  const h = (location.hash || '#home').slice(1).split('/');
  route = { name: h[0] || 'home', arg: h[1] };
  const fn = routes[route.name] || routes.home;
  const tab = { cal: 'cal', health: 'health', sup: 'health', food: 'food', foodd: 'food', visits: 'visits', visit: 'visits', contact: 'visits', doc: 'visits' }[route.name] || 'home';
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  fn(route.arg);
  bindCommon();
}
function bindCommon() {
  $$('[data-go]').forEach(el => el.onclick = e => { e.stopPropagation(); go(el.dataset.go); });
}

// ============================================================ PRADŽIA
routes.home = () => {
  const P = S.profile;
  setTop(P.name || 'Rodukas', { actions: `<button class="icon-btn" data-go="#settings" aria-label="Nustatymai">⚙️</button>` });
  const w = lastWeight(), ws = weightsDesc();
  let trend = '';
  if (w && ws[1]) { const d = w.kg - ws[1].kg; trend = Math.abs(d) < 0.005 ? '' : (d > 0 ? ` ↑${fmtNum(d, 2)}` : ` ↓${fmtNum(-d, 2)}`); }
  const bd = birthdayInfo(P.birth_date);
  const ageLine = bd ? (bd.days === 0 ? `🎂 <b>Šiandien gimtadienis!</b> Sukako ${bd.turns} m.` : `🎂 Gimtadienis ${bd.days === 1 ? 'rytoj' : 'po <b>' + bd.days + ' d.</b>'} · sueis ${bd.turns} m.`) : esc(age(P.birth_date) || '');
  const feeds = activeFeedings();
  const meds = sortDesc(activeMeds(), 'start');
  const prev = preventionLatest();
  const procs = trackedProcs();
  let h = `<div class="card pad hero-card" data-go="#profile">
    <div class="hero">
      <div class="avatar" ${P.photo ? `style="background-image:url('files/${esc(P.photo)}')"` : ''}>${P.photo ? '' : '🐶'}</div>
      <div class="grow"><h2>${esc(P.name || 'Rodukas')}</h2>
        <div class="${bd ? 'bday' : 'muted'}">${ageLine || '<span class="muted">Įveskite gimimo datą ⚙️</span>'}</div>
        <div class="wline" data-go="#health/weight">⚖️ ${w ? `<b>${kg(w.kg)}</b><span class="muted">${trend}</span>` : '<span class="muted">svoris neįvestas</span>'}${P.target_kg ? ` <span class="muted">· tikslas ${kg(P.target_kg)}</span>` : ''}${w ? ` <span class="muted">· ${esc(ago(w.date))}</span>` : ''}</div>
      </div>
    </div>
  </div>
  <button class="addbtn" id="add-new"><span class="p">+</span><span class="t">Įvesti naują</span><span class="ics">📝🏥📄⚖️💉🧴</span></button>`;

  if (procs.length) {
    h += `<h2>🧽 Priežiūra</h2><div class="card list">${procs.map(p => {
      const st = procState(p);
      return `<div class="li proc-row ${st.cls}" data-go="#proc/${p.id}"><span class="ic">${esc(p.emoji || '✔️')}</span><div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${esc(st.txt)}${st.last && st.cls !== 'done' ? ` · paskutinį kartą ${esc(ago(st.last))}` : ''}</div></div>
        ${st.cls === 'done' ? '' : `<button class="btn small done-btn" data-done="${p.id}">✓ Atlikta</button>`}</div>`;
    }).join('')}</div>`;
  }

  h += `<h2>🍽️ Maistas</h2>`;
  h += feeds.length ? feeds.map(feedLine).join('') : `<div class="card list"><a class="li go" href="#food"><span class="ic">🍽️</span><span class="grow muted">Maitinimas nenustatytas</span></a></div>`;

  if (meds.length) {
    h += `<h2>💊 Vaistai ir vitaminai</h2><div class="card list">${meds.map(m => `<div class="li" data-go="#health/meds"><span class="ic">💊</span><div class="grow"><div class="t">${esc(m.name)}</div><div class="s">${esc([m.dose, m.freq].filter(Boolean).join(' · '))}${m.end ? ` · iki ${esc(m.end)} (${esc(until(m.end))})` : ''}</div></div></div>`).join('')}</div>`;
  } else {
    h += `<div class="card list fold-line"><a class="li go" href="#health/meds"><span class="ic">💊</span><div class="grow"><div class="t">Vaistai ir vitaminai</div><div class="s">Šiuo metu nieko neduodama</div></div></a></div>`;
  }

  const prevRow = p => { const st = prevStatus(p); return `<div class="li" data-go="#health/prev"><span class="ic">${pIcon(p.kind)}</span><div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${esc(p.kind || '')}${p.date ? ' · ' + esc(p.date) : ''}</div></div><span class="pill ${st.cls}">${esc(st.txt)}</span></div>`; };
  if (!prev.length) {
    h += `<div class="card list fold-line"><a class="li go" href="#health/prev"><span class="ic">💉</span><div class="grow"><div class="t">Skiepai ir apsauga</div><div class="s">Dar neįvesta</div></div></a></div>`;
  } else {
    const soon = prev.filter(p => p.valid_until && diffDays(T(), p.valid_until) <= 60);
    if (soon.length) {
      h += `<h2>💉 Skiepai ir apsauga</h2><div class="card list">${prev.map(prevRow).join('')}</div>`;
    } else {
      const first = prev.find(p => p.valid_until);
      h += `<details class="card fold-card"><summary class="li"><span class="ic">💉</span><div class="grow"><div class="t">Skiepai ir apsauga</div><div class="s">✓ Viskas galioja${first ? ` · artimiausia: ${esc(first.name)} iki ${esc(first.valid_until)}` : ''}</div></div><span class="chev">›</span></summary>${prev.map(prevRow).join('')}</details>`;
    }
  }
  view.innerHTML = h;
  $('#add-new').onclick = () => addAnySheet(T());
  $$('[data-done]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const p = I.procedures[b.dataset.done];
    const res = await saveRow('proc_log', { procedure_id: p.id, date: T() });
    toast(`${p.name} – pažymėta`, { label: 'Atšaukti', fn: () => delRow('proc_log', res.id) });
  });
};

function feedLine(f) {
  const g = f.g_day, meals = f.meals || 1, por = f.portions || 1;
  return `<div class="card feed-c" data-go="#food"><span class="ic">🍽️</span><div class="grow"><div class="t">${esc(foodName(f.food_id))}</div>
    <div class="s">${g ? `${fmtNum(g)} g/d. · ${meals} maitin. × ${por} įdėj.` : 'kiekis neįvestas'}</div></div>
    ${g ? `<div class="big">${fmtNum(g / meals / por)} g<span>į kartą</span></div>` : ''}</div>`;
}

function feedCard(f, compact) {
  const g = f.g_day, meals = f.meals || 1, por = f.portions || 1;
  return `<div class="card pad" data-feed="${f.id}" style="margin-bottom:8px;cursor:pointer">
    <div class="row"><b class="grow">${esc(foodName(f.food_id))}</b><span class="muted small">nuo ${esc(f.start || '?')}</span></div>
    <div class="feed-line">
      <div class="box"><b>${g ? fmtNum(g) + ' g' : '—'}</b><span>per dieną</span></div>
      <div class="box"><b>${g ? fmtNum(g / meals) + ' g' : '—'}</b><span>${meals} maitin. / d.</span></div>
      <div class="box"><b>${g ? fmtNum(g / meals / por) + ' g' : '—'}</b><span>po ${por} įdėj.</span></div>
    </div>${f.note && !compact ? `<div class="muted small" style="margin-top:6px">${esc(f.note)}</div>` : ''}</div>`;
}

function procMarkSheet(p) {
  const st = procState(p);
  sheet(`<h3>${esc(p.emoji)} ${esc(p.name)}</h3>
    <p class="muted" style="margin-top:-6px">Paskutinį kartą: <b>${st.last ? esc(st.last) + ' (' + ago(st.last) + ')' : 'dar nežymėta'}</b>${p.interval_days ? ` · norima kas ${p.interval_days} d.` : ''}</p>
    <button class="btn primary block" id="pm-today" style="min-height:56px;font-size:18px">✓ Atlikta šiandien</button>
    <details style="margin-top:12px"><summary class="muted">Kita data ar pastaba</summary>
      <div class="stack" style="margin-top:10px"><label class="field"><span>Data</span><input type="date" id="pm-date" value="${T()}"></label>
      <label class="field"><span>Pastaba</span><input type="text" id="pm-note"></label>
      <button class="btn block" id="pm-save">Pažymėti</button></div></details>
    <a class="btn block" href="#proc/${p.id}" style="margin-top:12px">📈 Istorija ir tendencija</a>`, () => {
    const mark = async (date, note) => {
      const res = await saveRow('proc_log', { procedure_id: p.id, date, note });
      closeSheet();
      toast(`${p.name} – pažymėta`, { label: 'Atšaukti', fn: () => delRow('proc_log', res.id) });
    };
    $('#pm-today').onclick = () => mark(T(), '');
    $('#pm-save').onclick = () => mark($('#pm-date').value || T(), $('#pm-note').value);
  });
}

// ============================================================ ĮVYKIAI (kalendorius ir laiko juosta)
const EV_TYPES = [['health', 'Sveikata'], ['note', 'Pastabos'], ['visit', 'Vizitai'], ['prev', 'Skiepai'], ['med', 'Vaistai'], ['prod', 'Priemonės'], ['food', 'Maistas'], ['weight', 'Svoris'], ['proc', 'Procedūros'], ['doc', 'Dokumentai']];
function allEvents() {
  const E = [];
  const add = (date, type, icon, title, sub, open, extra = {}) => { if (date) E.push({ date, type, icon, title, sub, open, ...extra }); };
  for (const j of S.journal) {
    const n = docsOf('journal_id', j.id).length;
    add(j.date, j.category === 'Pastaba' ? 'note' : 'health', jIcon(j.category), j.category === 'Pastaba' ? (j.text || 'Pastaba').split('\n')[0] : j.category,
      (j.category === 'Pastaba' ? '' : j.text || '') + (n ? ` 📎${n}` : ''), () => journalSheet(j), { sev: j.severity, time: j.time });
  }
  for (const v of S.visits) {
    const n = docsOf('visit_id', v.id).length;
    add(v.date, 'visit', vIcon(v.category), visitLabel(v), [v.category !== visitLabel(v) ? v.category : '', contactName(v.contact_id) || v.place, v.price != null ? money(v.price) : '', n ? `📎${n}` : ''].filter(Boolean).join(' · '), '#visit/' + v.id, { time: v.time });
  }
  for (const p of S.prevention) add(p.date, 'prev', pIcon(p.kind), p.name, [p.kind, p.valid_until ? 'galioja iki ' + p.valid_until : ''].filter(Boolean).join(' · '), () => prevSheet(p));
  for (const m of S.meds) {
    add(m.start, 'med', '💊', 'Pradėta: ' + m.name, [m.dose, m.freq, m.reason].filter(Boolean).join(' · '), () => medSheet(m));
    add(m.end, 'med', '💊', 'Baigta: ' + m.name, m.start ? `vartota ${duration(m.start, m.end)}` : '', () => medSheet(m));
  }
  for (const f of S.feedings) {
    add(f.start, 'food', '🍽️', 'Pradėta: ' + foodName(f.food_id), f.g_day ? `${fmtNum(f.g_day)} g/d. · ${f.meals || 1} maitin. · po ${f.portions || 1} įdėj.` : '', () => feedingSheet(f));
    add(f.end, 'food', '🍽️', 'Baigta: ' + foodName(f.food_id), f.start ? `duota ${duration(f.start, f.end)}` : '', () => feedingSheet(f));
  }
  for (const s of S.supplies) {
    add(s.start, 'prod', sIcon(s.purpose), 'Pradėta naudoti: ' + s.name, s.purpose || '', '#sup/' + s.id);
    add(s.end, 'prod', sIcon(s.purpose), 'Nebenaudojama: ' + s.name, s.start ? `naudota ${duration(s.start, s.end)}` : '', '#sup/' + s.id);
  }
  for (const w of S.weights) add(w.date, 'weight', '⚖️', 'Svoris ' + kg(w.kg), w.note || '', () => weightSheet(w));
  for (const l of S.proc_log) { const p = I.procedures[l.procedure_id]; if (p) add(l.date, 'proc', p.emoji || '✔️', p.name, l.note || '', () => procLogSheet(l)); }
  for (const d of S.documents) if (!d.visit_id && !d.journal_id && !d.supply_id) add(d.date, 'doc', docIcon(d), d.title, 'Dokumentas', '#doc/' + d.id);
  return E.sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || ''));
}
let EVS = [];
function evHtml(e, withDate) {
  const i = EVS.push(e) - 1, d = pd(e.date);
  return `<div class="ev" data-ev="${i}">
    ${withDate ? `<div class="date"><b>${d.getDate()}</b>${MONTHS_S[d.getMonth()]}</div>` : ''}
    <span class="ic">${e.icon}</span>
    <div class="grow"><div class="t">${e.sev ? `<span class="sev sev${e.sev}"></span>` : ''}${esc(e.title)}${e.time ? ` <span class="muted small">${esc(e.time)}</span>` : ''}</div>${e.sub ? `<div class="s">${esc(e.sub)}</div>` : ''}</div>
  </div>`;
}
function bindEvs() { $$('[data-ev]').forEach(el => el.onclick = () => { const e = EVS[el.dataset.ev]; typeof e.open === 'string' ? go(e.open) : e.open(); }); }

// ============================================================ KALENDORIUS
routes.cal = () => {
  setTop('Kalendorius', { actions: `<button class="btn small primary" id="c-add">＋</button>` });
  EVS = [];
  const ev = allEvents();
  const byDay = {};
  ev.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  const sel = UI.calSel && UI.calSel <= addDays(T(), 400) ? UI.calSel : T();
  const month = UI.calMonth || sel.slice(0, 7);
  const first = pd(month + '-01');
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  let grid = ['Pr', 'An', 'Tr', 'Kt', 'Pn', 'Št', 'Sk'].map(d => `<div class="wd">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const s = ds(d);
    if (i >= 35 && s.slice(0, 7) !== month) break;
    const types = [...new Set((byDay[s] || []).map(e => e.type))].slice(0, 4);
    grid += `<div class="d ${s.slice(0, 7) !== month ? 'out' : ''} ${s === T() ? 'today' : ''} ${s === sel ? 'sel' : ''}" data-day="${s}">${d.getDate()}<span class="dots">${types.map(t => `<i class="dot-${t}"></i>`).join('')}</span></div>`;
  }
  const dayEv = byDay[sel] || [];
  const filt = UI.tlFilter || EV_TYPES.map(t => t[0]).filter(t => t !== 'proc');
  const tl = ev.filter(e => filt.includes(e.type));
  const limit = UI.tlLimit || 120;
  let tlHtml = '', cur = '';
  for (const e of tl.slice(0, limit)) {
    const m = e.date.slice(0, 7);
    if (m !== cur) { if (cur) tlHtml += '</div>'; cur = m; const d = pd(e.date); tlHtml += `<div class="tl-month">${MONTHS_N[d.getMonth()]} ${d.getFullYear()}</div><div class="card list">`; }
    tlHtml += evHtml(e, true);
  }
  if (cur) tlHtml += '</div>';
  view.innerHTML = `
    <div class="cal-head"><button class="btn small" data-m="-1">‹</button><b>${MONTHS_N[first.getMonth()]} ${first.getFullYear()}</b><button class="btn small" data-m="1">›</button></div>
    <div class="card cal">${grid}</div>
    ${month !== T().slice(0, 7) || sel !== T() ? `<div class="center" style="margin-top:8px"><button class="btn small" id="c-today">Šiandien</button></div>` : ''}
    <h2>${esc(dayTitle(sel))}</h2>
    <div class="card list">${dayEv.map(e => evHtml(e, false)).join('') || '<div class="empty" style="padding:16px">Įrašų nėra</div>'}</div>
    <div class="row" style="margin-top:8px"><button class="btn grow" id="c-note">📝 Pastaba šiai dienai</button><button class="btn grow" id="c-more">＋ Kitas įrašas</button></div>
    <h2>Laiko juosta</h2>
    <div class="chips">${EV_TYPES.map(([k, l]) => `<button class="chip ${filt.includes(k) ? 'on' : ''}" data-f="${k}"><i class="sev dot-${k}" style="margin-right:6px"></i>${l}</button>`).join('')}</div>
    ${tlHtml || '<div class="empty"><span class="big">🗓️</span>Įrašų dar nėra</div>'}
    ${tl.length > limit ? `<button class="btn block" id="tl-more" style="margin-top:12px">Rodyti daugiau</button>` : ''}`;
  $$('[data-m]').forEach(b => b.onclick = () => { const d = pd(month + '-01'); d.setMonth(d.getMonth() + +b.dataset.m); UI.calMonth = ds(d).slice(0, 7); saveUI(); render(); });
  $$('[data-day]').forEach(el => el.onclick = () => { UI.calSel = el.dataset.day; UI.calMonth = el.dataset.day.slice(0, 7); saveUI(); render(); });
  $('#c-today') && ($('#c-today').onclick = () => { UI.calSel = T(); UI.calMonth = T().slice(0, 7); saveUI(); render(); });
  $$('[data-f]').forEach(b => b.onclick = () => { const k = b.dataset.f; const f = new Set(filt); f.has(k) ? f.delete(k) : f.add(k); UI.tlFilter = [...f]; saveUI(); render(); });
  $('#tl-more') && ($('#tl-more').onclick = () => { UI.tlLimit = limit + 200; render(); });
  $('#c-note').onclick = () => journalSheet({ date: sel, category: 'Pastaba' });
  $('#c-more').onclick = () => addAnySheet(sel);
  $('#c-add').onclick = () => addAnySheet(sel);
  bindEvs();
};

function addAnySheet(date) {
  const opts = [
    ['📝', 'Pastaba', 'bet kas, ką norite užsirašyti', () => journalSheet({ date, category: 'Pastaba' })],
    ['🩹', 'Sveikatos įrašas', 'simptomas, sunegalavimas, su nuotrauka', () => journalSheet({ date })],
    ['🏥', 'Vizitas', 'veterinaras, SPA, tyrimai', () => visitSheet({ date })],
    ['📄', 'Dokumentas', 'tyrimų lapas, išrašas, PDF ar nuotrauka', () => docUploadSheet({ date })],
    ['⚖️', 'Svoris', '', () => weightSheet({ date })],
    ['💉', 'Skiepas ar apsauga', 'vakcina, antiparazitinė priemonė', () => prevSheet({ date })],
    ['💊', 'Vaistas ar vitaminas', 'kursas nuo–iki', () => medSheet({ start: date })],
    ['🧴', 'Priežiūros priemonė', 'servetėlės, valikliai, purškalai', () => supplySheet({ start: date })],
    ...trackedProcs().map(p => [p.emoji || '✔️', `${p.name} – atlikta`, '', async () => { const r = await saveRow('proc_log', { procedure_id: p.id, date }); toast(p.name + ' – pažymėta', { label: 'Atšaukti', fn: () => delRow('proc_log', r.id) }); }]),
  ];
  sheet(`<h3>Įvesti naują${date !== T() ? ' · ' + esc(date) : ''}</h3><div class="card list">${opts.map((o, i) => `<div class="li" data-o="${i}"><span class="ic">${o[0]}</span><div class="grow"><div class="t">${esc(o[1])}</div>${o[2] ? `<div class="s">${esc(o[2])}</div>` : ''}</div></div>`).join('')}</div>`, () => {
    $$('[data-o]').forEach(el => el.onclick = () => { closeSheet(); opts[el.dataset.o][3](); });
  });
}

// ============================================================ SVEIKATA
routes.health = seg => {
  seg = seg || UI.healthSeg || 'prev'; UI.healthSeg = seg; saveUI();
  const add = { prev: () => prevSheet(), meds: () => kitAddSheet(), log: () => journalSheet(), weight: () => weightSheet() }[seg];
  setTop('Sveikata', { actions: `<button class="btn small primary" id="h-add">＋ Pridėti</button>` });
  let h = `<div class="seg">${[['prev', 'Skiepai'], ['meds', 'Vaistinėlė'], ['log', 'Žurnalas'], ['weight', 'Svoris']].map(([k, l]) => `<a href="#health/${k}" class="${k === seg ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  h += ({ prev: healthPrev, meds: healthMeds, log: healthLog, weight: healthWeight })[seg]();
  view.innerHTML = h;
  $('#h-add').onclick = add;
  $$('[data-prev]').forEach(el => el.onclick = () => prevSheet(I.prevention[el.dataset.prev]));
  $$('[data-med]').forEach(el => el.onclick = () => medSheet(I.meds[el.dataset.med]));
  $$('[data-w]').forEach(el => el.onclick = () => weightSheet(I.weights[el.dataset.w]));
  $$('[data-jf]').forEach(b => b.onclick = () => { UI.jf = UI.jf === b.dataset.jf ? '' : b.dataset.jf; saveUI(); render(); });
  $('#set-target') && ($('#set-target').onclick = () => formSheet({ title: 'Tikslinis svoris', fields: [{ k: 'target_kg', label: 'Tikslinis svoris, kg', type: 'number' }], values: S.profile, onSave: v => act('profile_save', v) }));
  bindEvs();
};

function kitAddSheet() {
  sheet(`<h3>Ką pridėti?</h3><div class="card list">
    <div class="li" id="ka-med"><span class="ic">💊</span><div class="grow"><div class="t">Vaistas ar vitaminas</div><div class="s">kursas nuo–iki</div></div></div>
    <div class="li" id="ka-sup"><span class="ic">🧴</span><div class="grow"><div class="t">Priežiūros priemonė</div><div class="s">servetėlės, valikliai, šampūnai, purškalai</div></div></div></div>`, () => {
    $('#ka-med').onclick = () => { closeSheet(); medSheet(); };
    $('#ka-sup').onclick = () => { closeSheet(); supplySheet(); };
  });
}

function healthPrev() {
  const latest = preventionLatest();
  const all = sortDesc(S.prevention);
  if (!all.length) return `<div class="empty"><span class="big">💉</span>Įveskite skiepus ir antiparazitines priemones – matysite, iki kada galioja, ir gausite įspėjimą prieš baigiantis.</div>`;
  return `<h2>Dabartinė apsauga</h2><div class="card list">${latest.map(p => { const st = prevStatus(p); return `<div class="li" data-prev="${p.id}"><span class="ic">${pIcon(p.kind)}</span><div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${esc(p.kind || '')} · paskutinį kartą ${esc(p.date || '?')}</div></div><span class="pill ${st.cls}">${esc(st.txt)}</span></div>`; }).join('')}</div>
  <h2>Visa istorija</h2><div class="card list">${all.map(p => `<div class="li" data-prev="${p.id}"><span class="ic">${pIcon(p.kind)}</span><div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${esc(p.date || '?')}${p.valid_until ? ' → ' + esc(p.valid_until) : ''}${p.batch ? ' · serija ' + esc(p.batch) : ''}${p.visit_id && I.visits[p.visit_id] ? ' · ' + esc(visitLabel(I.visits[p.visit_id])) : ''}</div></div></div>`).join('')}</div>`;
}

function healthMeds() {
  const actM = sortDesc(activeMeds(), 'start');
  const pastM = sortDesc(S.meds.filter(m => !actM.includes(m)), 'start');
  const medRow = m => `<div class="li" data-med="${m.id}"><span class="ic">💊</span><div class="grow"><div class="t">${esc(m.name)}</div>
    <div class="s">${esc([m.dose, m.freq].filter(Boolean).join(' · '))}</div>
    <div class="s">${m.start ? esc(m.start) : '?'} – ${m.end ? esc(m.end) : 'dabar'}${m.start ? ` (${duration(m.start, m.end && m.end < T() ? m.end : T())})` : ''}${m.reason ? ' · ' + esc(m.reason) : ''}</div></div></div>`;
  let h = `<h2>💊 Vaistai ir vitaminai <button class="btn small" id="k-med">＋ Pridėti</button></h2>
    <div class="card list">${actM.map(medRow).join('') || '<div class="li muted">Šiuo metu nieko neduodama</div>'}</div>
    ${pastM.length ? `<details class="fold"><summary>Anksčiau duota (${pastM.length})</summary><div class="card list">${pastM.map(medRow).join('')}</div></details>` : ''}`;

  const actS = activeSupplies();
  const pastS = sortDesc(S.supplies.filter(s => !actS.includes(s)), 'end');
  const purposes = uniq([...S.settings.supply_purposes, ...S.supplies.map(s => s.purpose || 'Kita')]);
  h += `<h2>🧴 Priežiūros priemonės <button class="btn small" id="k-sup">＋ Pridėti</button></h2>`;
  if (!S.supplies.length) {
    h += `<div class="card pad muted small">Čia surašykite viską, ką naudojate: raukšlių ir ausų valiklius, dantų servetėles, šampūnus, purškalus. Pas veterinarą matysite visą sąrašą, o sudėties nuotrauka padės ieškant alergijos priežasties.</div>`;
  } else if (!actS.length) {
    h += `<div class="card list"><div class="li muted">Šiuo metu nieko nenaudojama</div></div>`;
  }
  for (const pur of purposes) {
    const list = actS.filter(s => (s.purpose || 'Kita') === pur).sort((a, b) => a.name.localeCompare(b.name, 'lt'));
    if (!list.length) continue;
    h += `<div class="tl-month">${sIcon(pur)} ${esc(pur)}</div><div class="card list">${list.map(supplyRow).join('')}</div>`;
  }
  if (pastS.length) h += `<details class="fold"><summary>Anksčiau naudota (${pastS.length})</summary><div class="card list">${pastS.map(supplyRow).join('')}</div></details>`;
  setTimeout(() => {
    $('#k-med') && ($('#k-med').onclick = () => medSheet());
    $('#k-sup') && ($('#k-sup').onclick = () => supplySheet());
  });
  return h;
}

function supplyRow(s) {
  const ph = docsOf('supply_id', s.id).find(isImg);
  const active = supplyActive(s);
  return `<a class="li go" href="#sup/${s.id}">${ph ? `<span class="sthumb" style="background-image:url('files/${esc(ph.filename)}')"></span>` : `<span class="ic">${sIcon(s.purpose)}</span>`}
    <div class="grow"><div class="t">${esc(s.name)} ${s.unsuitable ? '<span class="pill bad">netinka</span>' : ''}</div>
    <div class="s">${esc([s.brand, active ? s.usage : `${s.start || '?'} – ${s.end || '?'}`].filter(Boolean).join(' · '))}</div></div></a>`;
}

routes.sup = id => {
  const s = I.supplies[id]; if (!s) return go('#health/meds');
  setTop(s.name, { back: '#health/meds', actions: `<button class="icon-btn" id="su-edit" aria-label="Redaguoti">✏️</button>` });
  const photos = docsOf('supply_id', s.id);
  const active = supplyActive(s);
  const row = (ic, label, val) => val ? `<div class="kv"><span>${ic} ${label}</span><b>${val}</b></div>` : '';
  view.innerHTML = `${s.unsuitable ? '<div class="card pad warnbox">⚠️ Pažymėta, kad <b>netinka</b></div>' : ''}
    <div class="card list">
      ${row(sIcon(s.purpose), 'Paskirtis', esc(s.purpose || 'Kita'))}
      ${row('🏷️', 'Gamintojas', esc(s.brand))}
      ${row('📅', 'Naudojama', `${esc(s.start || '?')} – ${s.end ? esc(s.end) : 'dabar'}${s.start ? ` (${duration(s.start, s.end && s.end < T() ? s.end : T())})` : ''}`)}
      ${row('🛒', 'Kur pirkta', esc(s.place))}
      ${row('💶', 'Kaina', s.price != null ? money(s.price) : '')}
    </div>
    ${s.usage ? `<h2>Kaip naudojama</h2><div class="card pad pre">${esc(s.usage)}</div>` : ''}
    ${s.notes ? `<h2>Pastabos</h2><div class="card pad pre">${esc(s.notes)}</div>` : ''}
    <h2>Nuotraukos <label class="btn small">📷 Pridėti<input type="file" id="su-ph" accept="image/*,application/pdf" multiple hidden></label></h2>
    ${photos.length ? `<div class="thumbs">${photos.map(thumbHtml).join('')}</div>` : '<div class="muted small" style="margin:0 4px">Nufotografuokite pakuotę ir sudėtį – praverčia ieškant alergijos priežasties.</div>'}
    <div style="margin-top:16px">${active ? '<button class="btn block" id="su-stop">⏹ Nebenaudojame</button>' : '<button class="btn block" id="su-again">↺ Vėl naudojame</button>'}</div>`;
  $('#su-edit').onclick = () => supplySheet(s);
  $('#su-ph').onchange = async e => {
    const files = [...e.target.files];
    for (let i = 0; i < files.length; i++) await uploadDoc(files[i], { title: `${s.name} – nuotrauka`, date: T(), supply_id: s.id });
    await load(); toast('Įkelta');
  };
  $('#su-stop') && ($('#su-stop').onclick = async () => { await saveRow('supplies', { id: s.id, end: T() }); toast('Pažymėta, kad nebenaudojama'); });
  $('#su-again') && ($('#su-again').onclick = async () => { await saveRow('supplies', { id: s.id, end: '', start: s.start || T() }); toast('Vėl naudojama'); });
};

function supplySheet(s) {
  s = s || {};
  formSheet({
    title: s.id ? 'Redaguoti priemonę' : 'Nauja priežiūros priemonė',
    values: { start: T(), purpose: S.settings.supply_purposes[0] || 'Kita', ...s },
    fields: [
      { k: 'name', label: 'Pavadinimas (pvz. Raukšlių valymo servetėlės)', list: uniq(S.supplies.map(x => x.name)) },
      { k: 'purpose', label: 'Kam naudojama', type: 'select', opts: uniq([...S.settings.supply_purposes, s.purpose]), half: true },
      { k: 'brand', label: 'Gamintojas', half: true, list: uniq(S.supplies.map(x => x.brand)) },
      { k: 'usage', label: 'Kaip ir kaip dažnai naudojama', type: 'textarea', ph: 'pvz. kasdien vakare nuvalyti raukšlę' },
      { k: 'start', label: 'Naudojama nuo', type: 'date', half: true },
      { k: 'end', label: 'Iki (tuščia = vis dar naudojama)', type: 'date', half: true },
      { k: 'place', label: 'Kur pirkta', half: true }, { k: 'price', label: 'Kaina, €', type: 'number', half: true },
      { k: 'notes', label: 'Pastabos (kaip tiko, reakcijos)', type: 'textarea' },
      { k: 'unsuitable', label: '⚠️ Netinka (sukėlė reakciją)', type: 'switch' },
    ],
    extra: s.id ? '' : `<label class="btn block">📷 Pakuotės / sudėties nuotraukos<input type="file" id="sup-files" multiple accept="image/*,application/pdf" hidden></label><div class="muted small" id="sup-fl"></div>`,
    bind: f => { const fi = $('#sup-files', f); if (fi) fi.onchange = e => $('#sup-fl').textContent = [...e.target.files].map(x => x.name).join(', '); },
    onSave: async (v, f) => {
      if (!v.name) { toast('Įrašykite pavadinimą'); return false; }
      const res = await api('api/do/save', { t: 'supplies', row: { ...v, unsuitable: v.unsuitable ? 1 : 0, id: s.id } });
      const files = s.id ? [] : [...($('#sup-files', f)?.files || [])];
      for (const file of files) await uploadDoc(file, { title: `${v.name} – nuotrauka`, date: T(), supply_id: res.id });
      await load();
      if (!s.id) go('#sup/' + res.id);
    },
    onDelete: s.id && (async () => { await delRow('supplies', s.id); go('#health/meds'); }),
  });
}

function healthLog() {
  const cats = [...new Set(S.journal.map(j => j.category))];
  const f = UI.jf || '';
  EVS = [];
  const list = sortDesc(S.journal.filter(j => !f || j.category === f));
  if (!S.journal.length) return `<div class="empty"><span class="big">📝</span>Užsirašykite sunegalavimus, simptomus ir pastabas – pas veterinarą tiksliai žinosite, kada kas buvo.</div>`;
  return `<div class="chips">${cats.map(c => `<button class="chip ${f === c ? 'on' : ''}" data-jf="${esc(c)}">${jIcon(c)} ${esc(c)}</button>`).join('')}</div>
  <div class="card list">${list.map(j => { const n = docsOf('journal_id', j.id).length; return evHtml({ date: j.date, type: 'health', icon: jIcon(j.category), title: j.category, sub: (j.text || '') + (n ? ` 📎${n}` : ''), sev: j.severity, open: () => journalSheet(j) }, true); }).join('')}</div>`;
}

function healthWeight() {
  const ws = weightsDesc();
  const P = S.profile;
  let h = `<div class="card pad">
    <div class="row"><div class="grow"><div class="muted small">Dabar</div><div style="font-size:26px;font-weight:700">${ws[0] ? kg(ws[0].kg) : '—'}</div><div class="muted small">${ws[0] ? esc(ws[0].date) + ' · ' + ago(ws[0].date) : ''}</div></div>
    <div style="text-align:right"><div class="muted small">Tikslas</div><div style="font-size:20px;font-weight:700">${P.target_kg ? kg(P.target_kg) : '—'}</div><button class="btn small" id="set-target">Keisti</button></div></div>
    ${weightChart(ws)}
    ${changeLine(ws)}
  </div>`;
  h += `<h2>Visi svėrimai</h2><div class="card list">${ws.map((w, i) => { const prev = ws[i + 1]; const d = prev ? w.kg - prev.kg : null; return `<div class="li" data-w="${w.id}"><span class="ic">⚖️</span><div class="grow"><div class="t">${kg(w.kg)}</div><div class="s">${esc(w.date)}${w.note ? ' · ' + esc(w.note) : ''}</div></div><span class="muted small">${d == null ? '' : (d > 0 ? '+' : '') + fmtNum(d, 2)}</span></div>`; }).join('') || '<div class="empty">Svėrimų dar nėra</div>'}</div>`;
  return h;
}
function changeLine(ws) {
  if (ws.length < 2) return '';
  const cur = ws[0];
  const at = days => { const lim = addDays(cur.date, -days); return ws.find(w => w.date <= lim); };
  const parts = [[30, '30 d.'], [90, '3 mėn.'], [365, 'metus']].map(([d, l]) => { const o = at(d); if (!o) return ''; const x = cur.kg - o.kg; return `per ${l}: <b>${x > 0 ? '+' : ''}${fmtNum(x, 2)} kg</b>`; }).filter(Boolean);
  return parts.length ? `<div class="muted small" style="margin-top:6px">Pokytis ${parts.join(' · ')}</div>` : '';
}
function weightChart(wsDesc) {
  const ws = [...wsDesc].reverse();
  if (ws.length < 2) return '<p class="muted small">Grafikas atsiras, kai bus bent du svėrimai.</p>';
  const W = 340, H = 170, L = 34, R = 8, TOP = 10, B = 22;
  const tgt = S.profile.target_kg;
  const xs = ws.map(w => pd(w.date).getTime());
  let lo = Math.min(...ws.map(w => w.kg), tgt ?? Infinity), hi = Math.max(...ws.map(w => w.kg), tgt ?? -Infinity);
  const pad = Math.max(0.2, (hi - lo) * 0.15); lo -= pad; hi += pad;
  const x0 = xs[0], x1 = xs[xs.length - 1] === x0 ? x0 + 1 : xs[xs.length - 1];
  const X = t => L + (t - x0) / (x1 - x0) * (W - L - R), Y = v => TOP + (hi - v) / (hi - lo) * (H - TOP - B);
  const path = ws.map((w, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(w.kg).toFixed(1)}`).join(' ');
  const ticks = [lo + pad * 0.3, (lo + hi) / 2, hi - pad * 0.3];
  const fd = s => { const d = pd(s); return `${MONTHS_S[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; };
  return `<div class="chart" style="margin-top:12px"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Svorio grafikas">
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${L - 4}" y="${Y(t) + 4}" text-anchor="end">${fmtNum(t, 1)}</text>`).join('')}
    ${tgt ? `<line x1="${L}" x2="${W - R}" y1="${Y(tgt)}" y2="${Y(tgt)}" stroke="var(--ok)" stroke-dasharray="5 4" stroke-width="1.5"/><text x="${W - R}" y="${Y(tgt) - 4}" text-anchor="end" style="fill:var(--ok)">tikslas</text>` : ''}
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${ws.map((w, i) => `<circle cx="${X(xs[i])}" cy="${Y(w.kg)}" r="3.5" fill="var(--card)" stroke="var(--accent)" stroke-width="2"/>`).join('')}
    <text x="${L}" y="${H - 5}">${fd(ws[0].date)}</text><text x="${W - R}" y="${H - 5}" text-anchor="end">${fd(ws[ws.length - 1].date)}</text>
  </svg></div>`;
}

// ---- formos
function weightSheet(w) {
  w = w || {};
  formSheet({
    title: w.id ? 'Svoris' : 'Naujas svėrimas', values: { date: T(), ...w },
    fields: [{ k: 'date', label: 'Data', type: 'date', half: true }, { k: 'kg', label: 'Svoris, kg', type: 'number', half: true, ph: 'pvz. 8,4' }, { k: 'note', label: 'Pastaba' }],
    onSave: v => { if (!pnum(v.kg)) { toast('Įveskite svorį'); return false; } return saveRow('weights', { ...v, id: w.id }); },
    onDelete: w.id && (() => delRow('weights', w.id)),
  });
}

function prevSheet(p) {
  p = p || {};
  const names = [...new Set(S.prevention.map(x => x.name).filter(Boolean))];
  formSheet({
    title: p.id ? p.name : 'Skiepas / apsauga', values: { kind: 'Vakcina', date: T(), ...p },
    fields: [
      { k: 'kind', label: 'Tipas', type: 'select', opts: S.settings.prevention_kinds, half: true },
      { k: 'date', label: 'Data', type: 'date', half: true },
      { k: 'name', label: 'Pavadinimas (pvz. Pasiutligė, Nobivac DHPPi+L4, Bravecto)', list: names },
      { k: 'valid_until', label: 'Galioja iki / kitas kartas', type: 'date' },
      { k: 'batch', label: 'Serija (iš lipduko)', half: true },
      { k: 'visit_id', label: 'Vizitas', type: 'select', opts: visitOpts(), half: true },
      { k: 'note', label: 'Pastaba', type: 'textarea' },
    ],
    extra: `<div class="row wrap" style="margin-top:-2px"><span class="muted small">Galioja:</span>${[[1, '1 mėn.'], [3, '3 mėn.'], [6, '6 mėn.'], [12, '1 metai'], [36, '3 metai']].map(([m, l]) => `<button type="button" class="btn small" data-plus="${m}">${l}</button>`).join('')}</div>`,
    bind: f => $$('[data-plus]', f).forEach(b => b.onclick = () => { const d = f.elements.date.value || T(); f.elements.valid_until.value = addMonths(d, +b.dataset.plus); }),
    onSave: v => { if (!v.name) { toast('Įrašykite pavadinimą'); return false; } return saveRow('prevention', { ...v, id: p.id }); },
    onDelete: p.id && (() => delRow('prevention', p.id)),
  });
}

function medSheet(m) {
  m = m || {};
  const names = [...new Set(S.meds.map(x => x.name).filter(Boolean))];
  const isActive = m.id && (!m.end || m.end >= T());
  formSheet({
    title: m.id ? m.name : 'Vaistai / vitaminai', values: { start: T(), ...m },
    fields: [
      { k: 'name', label: 'Pavadinimas', list: names },
      { k: 'dose', label: 'Dozė (pvz. ½ tabl., 5 lašai)', half: true },
      { k: 'freq', label: 'Kaip dažnai (pvz. 2× per d.)', half: true },
      { k: 'start', label: 'Nuo', type: 'date', half: true },
      { k: 'end', label: 'Iki (tuščia = vis dar duodama)', type: 'date', half: true },
      { k: 'reason', label: 'Kodėl / nuo ko' },
      { k: 'note', label: 'Pastaba', type: 'textarea' },
    ],
    extra: isActive ? `<button type="button" class="btn block" id="med-stop">⏹ Baigti šiandien</button>` : '',
    bind: f => { const b = $('#med-stop', f); if (b) b.onclick = async () => { await saveRow('meds', { id: m.id, end: T() }); closeSheet(); toast('Kursas baigtas'); }; },
    onSave: v => { if (!v.name) { toast('Įrašykite pavadinimą'); return false; } return saveRow('meds', { ...v, id: m.id }); },
    onDelete: m.id && (() => delRow('meds', m.id)),
  });
}

function journalSheet(j) {
  j = j || {};
  const docs = j.id ? docsOf('journal_id', j.id) : [];
  formSheet({
    title: j.id ? (j.category || 'Įrašas') : (j.category === 'Pastaba' ? 'Pastaba' : 'Sveikatos įrašas'),
    values: { date: T(), category: S.settings.journal_cats[1] || 'Kita', severity: 0, ...j },
    fields: [
      { k: 'date', label: 'Data', type: 'date', half: true }, { k: 'time', label: 'Laikas (nebūtina)', type: 'time', half: true },
      { k: 'category', label: 'Kategorija', type: 'select', opts: uniq([...S.settings.journal_cats, j.category]), half: true },
      { k: 'severity', label: 'Sunkumas', type: 'select', opts: SEVERITY, half: true },
      { k: 'text', label: 'Kas nutiko, kaip elgėsi, ką darėte', type: 'textarea' },
    ],
    extra: `${docs.length ? `<div class="thumbs">${docs.map(thumbHtml).join('')}</div>` : ''}
      <label class="btn block">📷 Pridėti nuotrauką ar failą<input type="file" id="j-files" multiple accept="image/*,application/pdf,video/*" hidden></label>
      <div class="muted small" id="j-fl"></div>`,
    bind: f => {
      $('#j-files', f).onchange = e => $('#j-fl').textContent = [...e.target.files].map(x => x.name).join(', ');
      $$('[data-doc]', f).forEach(el => el.onclick = () => { closeSheet(); go('#doc/' + el.dataset.doc); });
    },
    onSave: async (v, f) => {
      const files = [...$('#j-files', f).files];
      const res = await api('api/do/save', { t: 'journal', row: { ...v, id: j.id } });
      for (let i = 0; i < files.length; i++) await uploadDoc(files[i], { title: `${v.category} ${v.date}${files.length > 1 ? ` (${i + 1})` : ''}`, date: v.date, journal_id: res.id });
      await load();
    },
    onDelete: j.id && (() => delRow('journal', j.id)),
  });
}

function procLogSheet(l) {
  const p = I.procedures[l.procedure_id];
  formSheet({
    title: `${p?.emoji || ''} ${p?.name || 'Procedūra'}`, values: l,
    fields: [{ k: 'date', label: 'Data', type: 'date' }, { k: 'note', label: 'Pastaba' }],
    onSave: v => saveRow('proc_log', { ...v, id: l.id }),
    onDelete: () => delRow('proc_log', l.id),
  });
}

// ============================================================ MAISTAS
routes.food = () => {
  setTop('Maistas', { actions: `<button class="btn small primary" id="f-calc">🧮 Skaičiuoklė</button>` });
  const cur = activeFeedings();
  const hist = sortDesc(S.feedings, 'start');
  const foods = [...S.foods].sort((a, b) => a.unsuitable - b.unsuitable || a.name.localeCompare(b.name, 'lt'));
  let h = `<h2>Dabar</h2>`;
  h += cur.length ? cur.map(f => feedCard(f) + `<div class="row" style="margin:-2px 0 12px"><button class="btn small grow" data-fchange="${f.id}">🧮 Keisti kiekį ar maistą</button><button class="btn small" data-fedit="${f.id}">✏️</button><button class="btn small" data-fend="${f.id}">⏹ Baigti</button></div>`).join('')
    : `<div class="card pad center"><p class="muted" style="margin-top:0">Maitinimas dar nenustatytas.</p><button class="btn primary" id="f-start">Nustatyti maitinimą</button></div>`;
  h += `<h2>Istorija</h2><div class="card list">${hist.map(f => `<div class="li" data-fedit="${f.id}"><span class="ic">🍽️</span><div class="grow"><div class="t">${esc(foodName(f.food_id))}</div>
    <div class="s">${esc(f.start || '?')} – ${f.end ? esc(f.end) : 'dabar'}${f.start ? ` (${duration(f.start, f.end && f.end < T() ? f.end : T())})` : ''}</div>
    <div class="s">${f.g_day ? `${fmtNum(f.g_day)} g/d. · ${f.meals || 1} maitin. · po ${f.portions || 1} įdėj.` : ''}${f.note ? ' · ' + esc(f.note) : ''}</div></div></div>`).join('') || '<div class="empty" style="padding:16px">Dar nėra</div>'}</div>`;
  h += `<h2>Maistai <button class="btn small" id="f-new">＋ Naujas</button></h2><div class="card list">${foods.map(f => `<a class="li go" href="#foodd/${f.id}"><span class="ic">${f.kind === 'Skanėstas' ? '🦴' : f.kind === 'Šlapias' ? '🥫' : f.kind === 'Papildas' ? '🧴' : '🥣'}</span><div class="grow"><div class="t">${esc(f.name)} ${f.unsuitable ? '<span class="pill bad">netinka</span>' : ''}</div><div class="s">${esc([f.brand, f.kind].filter(Boolean).join(' · '))}${tableOf(f).length ? ' · lentelė ✓' : ''}${f.notes ? ' · ' + esc(f.notes.slice(0, 60)) : ''}</div></div></a>`).join('') || '<div class="empty" style="padding:16px">Pridėkite maistą su pakuotės lentele – skaičiuoklė pagal ją pasiūlys kiekį.</div>'}</div>`;
  view.innerHTML = h;
  $('#f-calc').onclick = () => calcSheet({ close: cur.map(f => f.id) });
  $('#f-start') && ($('#f-start').onclick = () => calcSheet({}));
  $('#f-new').onclick = () => foodSheet();
  $$('[data-fchange]').forEach(b => b.onclick = () => { const f = I.feedings[b.dataset.fchange]; calcSheet({ food_id: f.food_id, g_day: f.g_day, meals: f.meals, portions: f.portions, close: [f.id] }); });
  $$('[data-fedit]').forEach(b => b.onclick = () => feedingSheet(I.feedings[b.dataset.fedit]));
  $$('[data-fend]').forEach(b => b.onclick = async () => { if (confirm('Baigti šį maitinimą šiandien?')) { await saveRow('feedings', { id: +b.dataset.fend, end: T() }); toast('Maitinimas baigtas'); } });
};

function tableOf(f) {
  try { return (JSON.parse(f.table_json || '[]') || []).map(r => [pnum(r[0]), pnum(r[1])]).filter(r => r[0] && r[1]).sort((a, b) => a[0] - b[0]); } catch (e) { return []; }
}
function fromTable(tab, w) {
  if (!tab.length || !w) return null;
  if (tab.length === 1) return tab[0][1] * w / tab[0][0];
  let i = tab.findIndex(r => r[0] >= w);
  if (i === -1) i = tab.length - 1; if (i === 0) i = 1;
  const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
  return Math.max(0, y0 + (y1 - y0) * (w - x0) / (x1 - x0));
}

function calcSheet(o) {
  const foods = S.foods.filter(f => !f.unsuitable || f.id === o.food_id);
  if (!foods.length) { toast('Pirma pridėkite maistą'); return foodSheet(); }
  const w = lastWeight(), tgt = S.profile.target_kg;
  const cf = activeFeedings()[0];
  const st = { food_id: o.food_id || cf?.food_id || foods[0].id, basis: tgt || w?.kg || '', g: o.g_day || '', meals: o.meals || cf?.meals || 2, portions: o.portions || cf?.portions || 2, manual: !!o.g_day };
  const cur = activeFeedings();
  sheet(`<h3>🧮 Maisto skaičiuoklė</h3><div class="stack">
    <label class="field"><span>Maistas</span><select id="c-food">${foods.map(f => `<option value="${f.id}" ${f.id == st.food_id ? 'selected' : ''}>${esc(foodName(f.id))}</option>`).join('')}</select></label>
    <label class="field"><span>Skaičiuoti pagal svorį, kg</span><input type="text" inputmode="decimal" id="c-w" value="${esc(fmtNum(st.basis, 2))}"></label>
    <div class="row wrap">${w ? `<button type="button" class="btn small" data-wb="${w.kg}">Dabartinis ${kg(w.kg)}</button>` : ''}${tgt ? `<button type="button" class="btn small" data-wb="${tgt}">Tikslinis ${kg(tgt)}</button>` : ''}</div>
    <div class="card pad small" id="c-tab"></div>
    <label class="field"><span>Gramai per dieną</span><div class="stepper"><button type="button" data-st="g:-5">−</button><input type="text" inputmode="decimal" id="c-g"><button type="button" data-st="g:5">＋</button></div></label>
    <div class="fgrid">
      <label class="field"><span>Maitinimai per dieną</span><div class="stepper"><button type="button" data-st="meals:-1">−</button><input type="text" inputmode="numeric" id="c-meals" value="${st.meals}"><button type="button" data-st="meals:1">＋</button></div></label>
      <label class="field"><span>Įdėjimai per maitinimą</span><div class="stepper"><button type="button" data-st="portions:-1">−</button><input type="text" inputmode="numeric" id="c-por" value="${st.portions}"><button type="button" data-st="portions:1">＋</button></div></label>
    </div>
    <div class="calc-out"><div><b id="o-d">—</b><span>g per dieną</span></div><div><b id="o-m">—</b><span>g per maitinimą</span></div><div><b id="o-p">—</b><span>g per įdėjimą</span></div></div>
    <hr><b>Išsaugoti kaip naują maitinimo laikotarpį</b>
    <div class="fgrid"><label class="field"><span>Nuo</span><input type="date" id="c-start" value="${T()}"></label><label class="field"><span>Pastaba</span><input type="text" id="c-note" placeholder="pvz. metimui"></label></div>
    ${cur.length ? `<div class="small muted">Užbaigti dabartinį (diena anksčiau):</div>${cur.map(f => `<label class="row"><input type="checkbox" data-close="${f.id}" ${(o.close || []).includes(f.id) ? 'checked' : ''}> ${esc(foodName(f.food_id))} · ${fmtNum(f.g_day)} g/d.</label>`).join('')}` : ''}
    <button class="btn primary block" id="c-save">💾 Išsaugoti</button></div>`, () => {
    const gEl = $('#c-g');
    const recalc = fromInput => {
      const food = I.foods[$('#c-food').value], tab = tableOf(food), wv = pnum($('#c-w').value);
      const sug = fromTable(tab, wv);
      $('#c-tab').innerHTML = tab.length
        ? `Pagal pakuotės lentelę ${wv ? `${kg(wv)} šuniui: <b>${fmtNum(sug, 0)} g/d.</b>` : ''} ${st.manual && sug != null && Math.round(pnum(gEl.value)) !== Math.round(sug) ? `<button type="button" class="btn small" id="c-use">Naudoti ${fmtNum(sug, 0)} g</button>` : ''}`
        : `<span class="muted">Šiam maistui pakuotės lentelė neįvesta – gramus įveskite ranka.</span> <a href="#foodd/${food.id}">Įvesti lentelę</a>`;
      if (!st.manual && !fromInput && sug != null) gEl.value = fmtNum(Math.round(sug), 0);
      const g = pnum(gEl.value), m = Math.max(1, pnum($('#c-meals').value) || 1), p = Math.max(1, pnum($('#c-por').value) || 1);
      $('#o-d').textContent = g ? fmtNum(g) : '—'; $('#o-m').textContent = g ? fmtNum(g / m) : '—'; $('#o-p').textContent = g ? fmtNum(g / m / p) : '—';
      const u = $('#c-use'); if (u) u.onclick = () => { st.manual = false; gEl.value = fmtNum(Math.round(sug), 0); recalc(); };
    };
    if (st.g) gEl.value = fmtNum(st.g);
    $('#c-food').onchange = () => { st.manual = false; recalc(); };
    $('#c-w').oninput = () => recalc();
    gEl.oninput = () => { st.manual = true; recalc(true); };
    $('#c-meals').oninput = $('#c-por').oninput = () => recalc(true);
    $$('[data-wb]').forEach(b => b.onclick = () => { $('#c-w').value = fmtNum(+b.dataset.wb, 2); st.manual = false; recalc(); });
    $$('[data-st]').forEach(b => b.onclick = () => {
      const [k, d] = b.dataset.st.split(':'); const el = { g: gEl, meals: $('#c-meals'), portions: $('#c-por') }[k];
      el.value = fmtNum(Math.max(k === 'g' ? 0 : 1, (pnum(el.value) || 0) + +d)); if (k === 'g') st.manual = true; recalc(true);
    });
    $('#c-save').onclick = async () => {
      const g = pnum(gEl.value); if (!g) return toast('Įveskite gramus per dieną');
      await act('feeding_start', { row: { food_id: +$('#c-food').value, start: $('#c-start').value, g_day: g, meals: pnum($('#c-meals').value) || 1, portions: pnum($('#c-por').value) || 1, note: $('#c-note').value }, close: $$('[data-close]').filter(c => c.checked).map(c => +c.dataset.close) });
      closeSheet(); toast('Naujas maitinimas išsaugotas');
    };
    recalc();
  });
}

function feedingSheet(f) {
  formSheet({
    title: 'Maitinimo laikotarpis', values: f,
    fields: [
      { k: 'food_id', label: 'Maistas', type: 'select', opts: S.foods.map(x => [x.id, foodName(x.id)]) },
      { k: 'start', label: 'Nuo', type: 'date', half: true }, { k: 'end', label: 'Iki (tuščia = dabar)', type: 'date', half: true },
      { k: 'g_day', label: 'Gramai per dieną', type: 'number' },
      { k: 'meals', label: 'Maitinimai per d.', type: 'number', half: true }, { k: 'portions', label: 'Įdėjimai per maitinimą', type: 'number', half: true },
      { k: 'note', label: 'Pastaba' },
    ],
    onSave: v => saveRow('feedings', { ...v, id: f.id }),
    onDelete: () => delRow('feedings', f.id),
  });
}

routes.foodd = id => {
  const f = I.foods[id]; if (!f) return go('#food');
  setTop(f.name, { back: '#food', actions: `<button class="icon-btn" id="fd-edit">✏️</button>` });
  const tab = tableOf(f), w = lastWeight(), tgt = S.profile.target_kg;
  const periods = sortDesc(S.feedings.filter(x => x.food_id === f.id), 'start');
  view.innerHTML = `<div class="card pad stack">
      <div>${esc([f.brand, f.kind].filter(Boolean).join(' · ')) || '<span class="muted">Gamintojas ir tipas nenurodyti</span>'} ${f.unsuitable ? '<span class="pill bad">netinka</span>' : ''}</div>
      ${f.notes ? `<div class="pre">${esc(f.notes)}</div>` : '<div class="muted small">Pastabų nėra</div>'}
    </div>
    <h2>Pakuotės lentelė</h2><div class="card pad">${tab.length ? `<table class="t"><tr><th>Šuns svoris</th><th>Per dieną</th></tr>${tab.map(r => `<tr><td>${kg(r[0])}</td><td>${fmtNum(r[1])} g</td></tr>`).join('')}</table>
      <div class="small" style="margin-top:8px">${w ? `Dabartiniam svoriui (${kg(w.kg)}): <b>${fmtNum(fromTable(tab, w.kg), 0)} g/d.</b>` : ''}${tgt ? `<br>Tiksliniam svoriui (${kg(tgt)}): <b>${fmtNum(fromTable(tab, tgt), 0)} g/d.</b>` : ''}</div>`
      : '<span class="muted">Neįvesta. Spauskite ✏️ ir įrašykite lentelę nuo pakuotės.</span>'}</div>
    <h2>Kada duota</h2><div class="card list">${periods.map(p => `<div class="li" data-fedit="${p.id}"><span class="ic">🍽️</span><div class="grow"><div class="t">${esc(p.start || '?')} – ${p.end ? esc(p.end) : 'dabar'}</div><div class="s">${p.g_day ? fmtNum(p.g_day) + ' g/d.' : ''}${p.note ? ' · ' + esc(p.note) : ''}</div></div></div>`).join('') || '<div class="empty" style="padding:16px">Dar neduota</div>'}</div>
    <button class="btn primary block" id="fd-start" style="margin-top:14px">🧮 Pradėti duoti šį maistą</button>`;
  $('#fd-edit').onclick = () => foodSheet(f);
  $('#fd-start').onclick = () => calcSheet({ food_id: f.id, close: activeFeedings().map(x => x.id) });
  $$('[data-fedit]').forEach(b => b.onclick = () => feedingSheet(I.feedings[b.dataset.fedit]));
};

function foodSheet(f) {
  f = f || {};
  let tab = tableOf(f);
  if (!tab.length) tab = [['', ''], ['', '']];
  formSheet({
    title: f.id ? 'Redaguoti maistą' : 'Naujas maistas', values: { kind: 'Sausas', ...f },
    fields: [
      { k: 'name', label: 'Pavadinimas' },
      { k: 'brand', label: 'Gamintojas', half: true }, { k: 'kind', label: 'Tipas', type: 'select', opts: FOOD_KINDS, half: true },
      { k: 'notes', label: 'Pastabos (kaip tiko, ar patiko, problemos)', type: 'textarea' },
      { k: 'unsuitable', label: 'Netinka (nesiūlyti skaičiuoklėje)', type: 'switch' },
    ],
    extra: `<b>Pakuotės lentelė</b><div class="muted small" style="margin:2px 0 8px">Šuns svoris (kg) → gramai per dieną. Jei nurodytas intervalas, pvz. 95–110 g, įrašykite vidurį.</div>
      <div id="tab"></div><button type="button" class="btn small" id="tab-add">＋ Eilutė</button>`,
    bind: () => {
      const draw = () => {
        $('#tab').innerHTML = tab.map((r, i) => `<div class="trow"><input type="text" inputmode="decimal" placeholder="kg" data-r="${i}:0" value="${esc(r[0] == null ? '' : fmtNum(r[0], 2))}"><input type="text" inputmode="decimal" placeholder="g/d." data-r="${i}:1" value="${esc(r[1] == null ? '' : fmtNum(r[1]))}"><button type="button" class="x-btn" data-rx="${i}">×</button></div>`).join('');
        $$('[data-r]').forEach(inp => inp.oninput = () => { const [i, j] = inp.dataset.r.split(':'); tab[i][j] = inp.value; });
        $$('[data-rx]').forEach(b => b.onclick = () => { tab.splice(+b.dataset.rx, 1); draw(); });
      };
      draw();
      $('#tab-add').onclick = () => { tab.push(['', '']); draw(); };
    },
    onSave: v => {
      if (!v.name) { toast('Įrašykite pavadinimą'); return false; }
      const t = tab.map(r => [pnum(r[0]), pnum(r[1])]).filter(r => r[0] && r[1]);
      return saveRow('foods', { ...v, unsuitable: v.unsuitable ? 1 : 0, table_json: JSON.stringify(t), id: f.id });
    },
    onDelete: f.id && (async () => { await delRow('foods', f.id); go('#food'); }),
  });
}

// ============================================================ VIZITAI, KONTAKTAI, DOKUMENTAI
const visitOpts = () => [['', '—'], ...sortDesc(S.visits).slice(0, 60).map(v => [v.id, `${v.date} · ${visitLabel(v)}`])];
const contactOpts = () => [['', '—'], ...[...S.contacts].sort((a, b) => a.name.localeCompare(b.name, 'lt')).map(c => [c.id, c.name])];
const uniq = a => [...new Set(a.filter(x => x != null && x !== ''))];

routes.visits = seg => {
  seg = seg || UI.visitSeg || 'list'; UI.visitSeg = seg; saveUI();
  const add = { list: ['＋ Vizitas', () => visitSheet()], contacts: ['＋ Kontaktas', () => contactSheet()], docs: ['＋ Įkelti', () => docUploadSheet({})] }[seg];
  setTop('Vizitai', { actions: `<button class="btn small primary" id="v-add">${add[0]}</button>` });
  let h = `<div class="seg">${[['list', 'Vizitai'], ['contacts', 'Kontaktai'], ['docs', 'Dokumentai']].map(([k, l]) => `<a href="#visits/${k}" class="${k === seg ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  h += ({ list: visitsList, contacts: contactsList, docs: docsList })[seg]();
  view.innerHTML = h;
  $('#v-add').onclick = add[1];
  $$('[data-vf]').forEach(b => b.onclick = () => { UI.vf = UI.vf === b.dataset.vf ? '' : b.dataset.vf; saveUI(); render(); });
  const q = $('#dq'); if (q) { q.oninput = () => { UI.dq = q.value; saveUI(); $('#dlist').innerHTML = docsListInner(); bindCommon(); }; }
};

function visitsList() {
  const f = UI.vf || '';
  const cats = uniq([...S.settings.visit_cats, ...S.visits.map(v => v.category)]);
  const list = sortDesc(S.visits.filter(v => !f || v.category === f));
  if (!S.visits.length) return `<div class="empty"><span class="big">🏥</span>Čia bus visi vizitai – pas veterinarą, į SPA, tyrimai – su kaina, vieta ir prisegtais dokumentais.</div>`;
  let h = `<div class="chips">${cats.map(c => `<button class="chip ${f === c ? 'on' : ''}" data-vf="${esc(c)}">${vIcon(c)} ${esc(c)}</button>`).join('')}</div>`;
  let year = '';
  for (const v of list) {
    const y = (v.date || '????').slice(0, 4);
    if (y !== year) {
      if (year) h += '</div>';
      year = y;
      const yl = list.filter(x => (x.date || '').startsWith(y)), sum = yl.reduce((s, x) => s + (x.price || 0), 0);
      h += `<div class="tl-month">${y} m. · ${yl.length} viz.${sum ? ' · ' + money(sum) : ''}</div><div class="card list">`;
    }
    const n = docsOf('visit_id', v.id).length;
    h += `<a class="li go" href="#visit/${v.id}"><span class="ic">${vIcon(v.category)}</span><div class="grow"><div class="t">${esc(visitLabel(v))}</div><div class="s">${esc(v.date || '')} · ${esc([v.title ? v.category : '', contactName(v.contact_id) || v.place].filter(Boolean).join(' · '))}${n ? ` · 📎${n}` : ''}</div></div>${v.price != null ? `<span class="r small">${money(v.price)}</span>` : ''}</a>`;
  }
  return h + '</div>';
}

function contactsList() {
  if (!S.contacts.length) return `<div class="empty"><span class="big">📇</span>Veterinarai, SPA, parduotuvės ir kiti – su telefonais ir adresais.</div>`;
  const cats = uniq([...S.settings.contact_cats, ...S.contacts.map(c => c.category || 'Kita')]);
  return cats.map(cat => {
    const cs = S.contacts.filter(c => (c.category || 'Kita') === cat).sort((a, b) => a.name.localeCompare(b.name, 'lt'));
    if (!cs.length) return '';
    return `<div class="tl-month">${esc(cat)}</div><div class="card list">${cs.map(c => `<a class="li go" href="#contact/${c.id}"><span class="ic">${cat === 'Veterinarija' ? '🩺' : cat === 'SPA' ? '🛁' : '📇'}</span><div class="grow"><div class="t">${esc(c.name)}</div><div class="s">${esc([c.phone, c.address].filter(Boolean).join(' · '))}</div></div></a>`).join('')}</div>`;
  }).join('');
}

function docIcon(d) { const m = (d.mime || '') + (d.filename || ''); return /pdf/i.test(m) ? '📄' : /video|mp4|mov|webm/i.test(m) ? '🎬' : /image|jpe?g|png|webp|heic|gif/i.test(m) ? '🖼️' : '📎'; }
const isImg = d => /image|\.(jpe?g|png|webp|gif)$/i.test((d.mime || '') + ' ' + d.filename) && !/heic/i.test(d.filename);
function thumbHtml(d) {
  return `<div class="thumb" data-doc="${d.id}" data-go="#doc/${d.id}" ${isImg(d) ? `style="background-image:url('files/${esc(d.filename)}')"` : ''}>${isImg(d) ? '' : `<span class="ft">${docIcon(d)}</span>`}<span class="cap">${esc(d.title)}</span></div>`;
}
function docsList() {
  if (!S.documents.filter(d => !d.supply_id).length) return `<div class="empty"><span class="big">📂</span>Įkelkite tyrimų lapus, išrašus, nuotraukas ar PDF skenus. Juos galima susieti su vizitu.</div>`;
  return `<input type="search" id="dq" placeholder="Ieškoti dokumento…" value="${esc(UI.dq || '')}"><div id="dlist">${docsListInner()}</div>`;
}
function docsListInner() {
  const q = (UI.dq || '').toLowerCase();
  const list = sortDesc(S.documents.filter(d => !d.supply_id).filter(d => !q || (d.title + ' ' + d.note + ' ' + (d.visit_id && I.visits[d.visit_id] ? visitLabel(I.visits[d.visit_id]) : '')).toLowerCase().includes(q)));
  let h = '', year = '';
  for (const d of list) {
    const y = (d.date || '').slice(0, 4);
    if (y !== year) { if (year) h += '</div>'; year = y; h += `<div class="tl-month">${y} m.</div><div class="card list">`; }
    const v = d.visit_id && I.visits[d.visit_id];
    h += `<a class="li go" href="#doc/${d.id}"><span class="ic">${docIcon(d)}</span><div class="grow"><div class="t">${esc(d.title)}</div><div class="s">${esc(d.date || '')}${v ? ' · ' + vIcon(v.category) + ' ' + esc(visitLabel(v)) : ''}${d.journal_id ? ' · žurnalas' : ''}</div></div></a>`;
  }
  return (h ? h + '</div>' : '<div class="empty">Nerasta</div>');
}

routes.visit = id => {
  const v = I.visits[id]; if (!v) return go('#visits/list');
  setTop(visitLabel(v), { back: '#visits/list', actions: `<button class="icon-btn" id="vi-edit">✏️</button>` });
  const c = I.contacts[v.contact_id], w = v.weight_id && I.weights[v.weight_id];
  const docs = docsOf('visit_id', v.id), prev = S.prevention.filter(p => p.visit_id === v.id);
  view.innerHTML = `<div class="card list">
      <div class="li"><span class="ic">📅</span><div class="grow"><div class="t">${esc(niceDate(v.date))}${v.time ? ' ' + esc(v.time) : ''}</div><div class="s">${esc(ago(v.date))}</div></div></div>
      <div class="li"><span class="ic">${vIcon(v.category)}</span><div class="grow">${esc(v.category || '')}</div></div>
      ${c ? `<a class="li go" href="#contact/${c.id}"><span class="ic">📇</span><div class="grow"><div class="t">${esc(c.name)}</div><div class="s">${esc(c.phone || '')}</div></div></a>` : ''}
      ${v.place ? `<div class="li"><span class="ic">📍</span><div class="grow">${esc(v.place)}</div></div>` : ''}
      ${v.price != null ? `<div class="li"><span class="ic">💶</span><div class="grow">${money(v.price)}</div></div>` : ''}
      ${w ? `<div class="li"><span class="ic">⚖️</span><div class="grow">Svoris vizito metu: ${kg(w.kg)}</div></div>` : ''}
    </div>
    ${v.notes ? `<h2>Pastabos</h2><div class="card pad pre">${esc(v.notes)}</div>` : ''}
    <h2>Dokumentai <button class="btn small" id="vi-doc">＋ Įkelti</button></h2>
    ${docs.length ? `<div class="thumbs">${docs.map(thumbHtml).join('')}</div>` : '<div class="muted small" style="margin:0 4px">Dar nėra. Įkelkite tyrimų lapą, išrašą ar sąskaitą.</div>'}
    <h2>Skiepai ir apsauga šio vizito metu <button class="btn small" id="vi-prev">＋</button></h2>
    <div class="card list">${prev.map(p => `<div class="li" data-prev="${p.id}"><span class="ic">${pIcon(p.kind)}</span><div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${p.valid_until ? 'galioja iki ' + esc(p.valid_until) : ''}</div></div></div>`).join('') || '<div class="li muted">—</div>'}</div>`;
  $('#vi-edit').onclick = () => visitSheet(v);
  $('#vi-doc').onclick = () => docUploadSheet({ visit_id: v.id, date: v.date, title: v.title || '' });
  $('#vi-prev').onclick = () => prevSheet({ date: v.date, visit_id: v.id });
  $$('[data-prev]').forEach(el => el.onclick = () => prevSheet(I.prevention[el.dataset.prev]));
};

function visitSheet(v) {
  v = v || {};
  const w = v.weight_id && I.weights[v.weight_id];
  const places = uniq(S.visits.map(x => x.place));
  formSheet({
    title: v.id ? 'Redaguoti vizitą' : 'Naujas vizitas', values: { date: T(), category: S.settings.visit_cats[0] || 'VET', ...v, kg: w ? fmtNum(w.kg, 2) : '' },
    fields: [
      { k: 'date', label: 'Data', type: 'date', half: true }, { k: 'time', label: 'Laikas', type: 'time', half: true },
      { k: 'category', label: 'Kategorija', type: 'select', opts: uniq([...S.settings.visit_cats, v.category]), half: true },
      { k: 'price', label: 'Kaina, €', type: 'number', half: true },
      { k: 'title', label: 'Priežastis / pavadinimas (pvz. Metinė apžiūra, Kraujo tyrimai)' },
      { k: 'contact_id', label: 'Kontaktas (klinika, specialistas)', type: 'select', opts: contactOpts() },
      { k: 'place', label: 'Vieta (jei kitur)', list: places },
      { k: 'kg', label: 'Svoris vizito metu, kg (nebūtina)', type: 'number' },
      { k: 'notes', label: 'Pastabos, ką sakė, ką paskyrė', type: 'textarea' },
    ],
    onSave: async val => { const res = await act('visit_save', { row: { ...val, id: v.id } }); if (!v.id) go('#visit/' + res.id); },
    onDelete: v.id && (async () => { await delRow('visits', v.id); go('#visits/list'); }),
  });
}

routes.contact = id => {
  const c = I.contacts[id]; if (!c) return go('#visits/contacts');
  setTop(c.name, { back: '#visits/contacts', actions: `<button class="icon-btn" id="co-edit">✏️</button>` });
  const vs = sortDesc(S.visits.filter(v => v.contact_id === c.id)), sum = vs.reduce((s, v) => s + (v.price || 0), 0);
  const tel = (c.phone || '').replace(/[^\d+]/g, '');
  view.innerHTML = `<div class="card pad stack">
      ${c.category ? `<div class="muted">${esc(c.category)}</div>` : ''}
      <div class="row wrap">
        ${tel ? `<a class="btn primary grow" href="tel:${esc(tel)}">📞 ${esc(c.phone)}</a>` : ''}
        ${c.email ? `<a class="btn grow" href="mailto:${esc(c.email)}">✉️ Rašyti</a>` : ''}
        ${c.address ? `<a class="btn grow" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}">🗺️ Žemėlapis</a>` : ''}
        ${c.web ? `<a class="btn grow" target="_blank" rel="noopener" href="${esc(/^https?:/.test(c.web) ? c.web : 'https://' + c.web)}">🌐 Svetainė</a>` : ''}
      </div>
      ${c.address ? `<div>📍 ${esc(c.address)}</div>` : ''}
      ${c.note ? `<div class="pre">${esc(c.note)}</div>` : ''}
    </div>
    <h2>Vizitai (${vs.length})${sum ? ` <span class="muted small" style="margin-left:auto">${money(sum)}</span>` : ''}</h2>
    <div class="card list">${vs.map(v => `<a class="li go" href="#visit/${v.id}"><span class="ic">${vIcon(v.category)}</span><div class="grow"><div class="t">${esc(visitLabel(v))}</div><div class="s">${esc(v.date || '')}</div></div>${v.price != null ? `<span class="r small">${money(v.price)}</span>` : ''}</a>`).join('') || '<div class="li muted">Dar nėra</div>'}</div>
    <button class="btn block" id="co-visit" style="margin-top:12px">＋ Naujas vizitas čia</button>`;
  $('#co-edit').onclick = () => contactSheet(c);
  $('#co-visit').onclick = () => visitSheet({ contact_id: c.id, category: c.category === 'SPA' ? 'SPA' : undefined });
};

function contactSheet(c) {
  c = c || {};
  formSheet({
    title: c.id ? 'Redaguoti kontaktą' : 'Naujas kontaktas', values: { category: S.settings.contact_cats[0], ...c },
    fields: [
      { k: 'name', label: 'Pavadinimas / vardas' },
      { k: 'category', label: 'Kategorija', type: 'select', opts: uniq([...S.settings.contact_cats, c.category]), half: true },
      { k: 'phone', label: 'Telefonas', type: 'tel', half: true },
      { k: 'email', label: 'El. paštas', type: 'email' },
      { k: 'address', label: 'Adresas' }, { k: 'web', label: 'Svetainė' },
      { k: 'note', label: 'Pastabos (darbo laikas, gydytojo vardas…)', type: 'textarea' },
    ],
    onSave: async v => { if (!v.name) { toast('Įrašykite pavadinimą'); return false; } const r = await saveRow('contacts', { ...v, id: c.id }); if (!c.id) go('#contact/' + r.id); },
    onDelete: c.id && (async () => { await delRow('contacts', c.id); go('#visits/contacts'); }),
  });
}

// ---- dokumentų peržiūra
routes.doc = id => {
  const d = I.documents[id]; if (!d) return go('#visits/docs');
  const v = d.visit_id && I.visits[d.visit_id], j = d.journal_id && I.journal[d.journal_id], su = d.supply_id && I.supplies[d.supply_id];
  setTop(d.title, { back: true, actions: `<button class="icon-btn" id="d-edit">✏️</button>` });
  const url = 'files/' + encodeURIComponent(d.filename);
  const isPdf = /pdf/i.test(d.mime + d.filename), isVid = /video|\.(mp4|mov|webm)$/i.test(d.mime + ' ' + d.filename);
  view.innerHTML = `<div class="muted small" style="margin:0 4px 10px">${esc(d.date || '')}${v ? ` · <a href="#visit/${v.id}">${vIcon(v.category)} ${esc(visitLabel(v))}</a>` : ''}${j ? ` · ${jIcon(j.category)} ${esc(j.category)} įrašas` : ''}${su ? ` · <a href="#sup/${su.id}">${sIcon(su.purpose)} ${esc(su.name)}</a>` : ''}${d.size ? ` · ${fmtNum(d.size / 1048576, 1)} MB` : ''}</div>
    ${d.note ? `<div class="card pad pre" style="margin-bottom:10px">${esc(d.note)}</div>` : ''}
    <div class="viewer" id="viewer">${isImg(d) ? `<img src="${url}" alt="">` : isVid ? `<video src="${url}" controls playsinline></video>` : isPdf ? '<div class="empty">Kraunamas PDF…</div>' : `<div class="empty"><span class="big">${docIcon(d)}</span>Šio failo peržiūrėti programoje negalima – atsisiųskite.</div>`}</div>
    <div class="row" style="margin-top:6px"><a class="btn grow" href="${url}" target="_blank" rel="noopener">↗ Atidaryti atskirai</a><a class="btn grow" href="${url}?dl=1" download="${esc(d.orig_name || d.filename)}">⬇ Atsisiųsti</a></div>`;
  $('#d-edit').onclick = () => formSheet({
    title: 'Dokumentas', values: d,
    fields: [{ k: 'title', label: 'Pavadinimas' }, { k: 'date', label: 'Data', type: 'date', half: true }, { k: 'visit_id', label: 'Vizitas', type: 'select', opts: visitOpts(), half: true }, { k: 'note', label: 'Pastaba', type: 'textarea' }],
    onSave: val => saveRow('documents', { ...val, id: d.id }),
    onDelete: async () => { await delRow('documents', d.id); history.back(); },
  });
  if (isPdf) renderPdf(url, $('#viewer'));
};

let pdfjsLib = null;
async function renderPdf(url, el) {
  try {
    if (!pdfjsLib) {
      pdfjsLib = await import('./pdf/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdf/pdf.worker.min.mjs', location.href.split('#')[0]).href;
    }
    const doc = await pdfjsLib.getDocument({ url: new URL(url, location.href.split('#')[0]).href }).promise;
    el.innerHTML = doc.numPages > 1 ? `<div class="muted small center" style="margin-bottom:6px">${doc.numPages} psl.</div>` : '';
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    for (let i = 1; i <= doc.numPages; i++) {
      if (!document.body.contains(el)) return;
      const page = await doc.getPage(i);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = Math.min(4, (el.clientWidth || 360) * dpr / vp0.width);
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      el.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
  } catch (e) {
    el.innerHTML = `<div class="empty"><span class="big">📄</span>PDF nepavyko parodyti čia. Spauskite „Atidaryti atskirai“ arba „Atsisiųsti“.<div class="small">${esc(e.message || e)}</div></div>`;
  }
}

// ---- failų įkėlimas dalimis
function progress(label, frac) {
  const p = $('#progress');
  if (frac == null) { p.hidden = true; return; }
  p.hidden = false; $('span', p).textContent = label; $('i', p).style.width = Math.round(frac * 100) + '%';
}
async function uploadFile(file, label) {
  const uid = [...Array(32)].map(() => '0123456789abcdef'[Math.random() * 16 | 0]).join('');
  const CH = 4 * 1024 * 1024, n = Math.max(1, Math.ceil(file.size / CH));
  try {
    for (let i = 0; i < n; i++) {
      progress(label || 'Įkeliama…', i / n);
      let ok = false, err = '';
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const r = await fetch(`api/upload?u=${uid}&i=${i}`, { method: 'POST', body: file.slice(i * CH, (i + 1) * CH) });
          if (r.ok) ok = true; else { err = (await r.json().catch(() => ({}))).error || r.status; if (r.status < 500) break; }
        } catch (e) { err = 'nėra ryšio'; }
      }
      if (!ok) { toast('Įkelti nepavyko: ' + err); throw new Error(err); }
    }
    progress(label, 1);
    return uid;
  } finally { progress(null); }
}
async function uploadDoc(file, meta) {
  const uid = await uploadFile(file, 'Įkeliama: ' + file.name);
  return api('api/do/doc_add', { upload: uid, orig_name: file.name, mime: file.type, ...meta });
}

function docUploadSheet(o) {
  formSheet({
    title: 'Įkelti dokumentą', values: { date: o.date || T(), title: o.title || '', visit_id: o.visit_id || '' },
    fields: [
      { k: 'title', label: 'Pavadinimas (pvz. Kraujo tyrimai, Echoskopija, Sąskaita)', list: uniq(S.documents.map(d => d.title)) },
      { k: 'date', label: 'Data', type: 'date', half: true },
      { k: 'visit_id', label: 'Susietas vizitas', type: 'select', opts: visitOpts(), half: true },
      { k: 'note', label: 'Pastaba', type: 'textarea' },
    ],
    pre: `<label class="btn block primary" style="margin-bottom:12px">📎 Pasirinkti failą (-us) ar fotografuoti<input type="file" id="u-files" multiple accept="image/*,application/pdf,video/*" hidden></label><div class="muted small" id="u-fl" style="margin:-6px 4px 10px"></div>`,
    saveLabel: '⬆ Įkelti',
    bind: f => $('#u-files', f).onchange = e => {
      const fs = [...e.target.files];
      $('#u-fl').textContent = fs.map(x => `${x.name} (${fmtNum(x.size / 1048576, 1)} MB)`).join(', ');
      if (!f.elements.title.value && fs[0]) f.elements.title.value = fs[0].name.replace(/\.[^.]+$/, '');
    },
    onSave: async (v, f) => {
      const files = [...$('#u-files', f).files];
      if (!files.length) { toast('Pasirinkite failą'); return false; }
      let last;
      for (let i = 0; i < files.length; i++) {
        last = await uploadDoc(files[i], { ...v, title: (v.title || files[i].name.replace(/\.[^.]+$/, '')) + (files.length > 1 && v.title ? ` (${i + 1})` : '') });
      }
      await load();
      toast(files.length > 1 ? `Įkelta failų: ${files.length}` : 'Įkelta');
      if (!o.visit_id && files.length === 1 && last) go('#doc/' + last.id);
    },
  });
}

// ============================================================ PROCEDŪROS
routes.proc = id => {
  const p = I.procedures[id]; if (!p) return go('#home');
  setTop(`${p.emoji || ''} ${p.name}`, { back: '#home', actions: `<button class="icon-btn" id="pr-edit" aria-label="Redaguoti">✏️</button>` });
  const logs = sortDesc(S.proc_log.filter(l => l.procedure_id === p.id && l.date));
  const dates = new Set(logs.map(l => l.date));
  const st = procState(p);
  const cnt = d => [...dates].filter(x => diffDays(x, T()) < d).length;
  const uniqDates = [...dates].sort().reverse();
  const ivs = []; for (let i = 0; i < Math.min(uniqDates.length - 1, 12); i++) ivs.push(diffDays(uniqDates[i + 1], uniqDates[i]));
  const avg = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  const end = pd(T()); const startD = new Date(end); startD.setDate(end.getDate() - ((end.getDay() + 6) % 7) - 49);
  let strip = '';
  for (let i = 0; i < 56; i++) { const d = new Date(startD); d.setDate(startD.getDate() + i); const s = ds(d); strip += `<i class="${dates.has(s) ? 'on' : ''} ${s === T() ? 't' : ''} ${st.due === s ? 'due' : ''}" title="${s}" ${s > T() && st.due !== s ? 'style="opacity:.3"' : ''}></i>`; }
  const daily = (p.mode || 'interval') === 'daily';
  view.innerHTML = `<div class="stats" style="margin-top:0">
      <div class="card stat"><div class="k">Paskutinį kartą</div><div class="v" style="font-size:18px">${st.last ? esc(ago(st.last)) : '—'}</div><div class="s">${esc(st.last || 'dar nežymėta')}</div></div>
      <div class="card stat proc-${st.cls}"><div class="k">Kitas kartas</div><div class="v" style="font-size:18px">${daily ? '—' : esc(st.cls === 'done' ? (st.n === 1 ? 'rytoj' : 'po ' + st.n + ' d.') : st.txt)}</div><div class="s">${esc(st.due || '')}</div></div>
      <div class="card stat"><div class="k">Vidutiniškai</div><div class="v" style="font-size:18px">${avg ? 'kas ' + fmtNum(avg, 1) + ' d.' : '—'}</div><div class="s">${esc(procModeText(p).split(' · ')[0])}</div></div>
      <div class="card stat"><div class="k">Per 30 d.</div><div class="v">${cnt(30)}×</div><div class="s">per 90 d. – ${cnt(90)}×</div></div>
    </div>
    <div class="card pad small" style="margin-top:10px">${p.remind ? `🔔 Priminimas ${esc(p.remind_time || '')}${p.repeat ? ', kartojamas kas dieną, kol nepažymėta' : ''}` : '🔕 Priminimas išjungtas'} · <a href="#" id="pr-rem">keisti</a></div>
    <h2>Paskutinės 8 savaitės</h2><div class="card pad"><div class="row small muted" style="justify-content:center;gap:4px;margin-bottom:4px">${['Pr', 'An', 'Tr', 'Kt', 'Pn', 'Št', 'Sk'].map(x => `<span style="width:30px;text-align:center">${x}</span>`).join('')}</div><div class="strip">${strip}</div><div class="muted small" style="margin-top:6px">Užpildytas langelis – atlikta, rėmelis – planuojama.</div></div>
    <div class="row" style="margin-top:14px"><button class="btn primary grow" id="pr-mark" style="min-height:52px">✓ Atlikta šiandien</button><button class="btn" id="pr-other" style="min-height:52px">Kita data</button></div>
    <h2>Istorija</h2><div class="card list">${logs.map(l => `<div class="li" data-pl="${l.id}"><span class="ic">${esc(p.emoji || '✔️')}</span><div class="grow"><div class="t">${esc(l.date)}</div>${l.note ? `<div class="s">${esc(l.note)}</div>` : ''}</div><span class="muted small">${esc(ago(l.date))}</span></div>`).join('') || '<div class="empty" style="padding:16px">Dar nežymėta</div>'}</div>`;
  $('#pr-edit').onclick = () => procSheet(p);
  $('#pr-rem').onclick = e => { e.preventDefault(); procSheet(p); };
  $('#pr-mark').onclick = async () => { const r = await saveRow('proc_log', { procedure_id: p.id, date: T() }); toast('Pažymėta', { label: 'Atšaukti', fn: () => delRow('proc_log', r.id) }); };
  $('#pr-other').onclick = () => procMarkSheet(p);
  $$('[data-pl]').forEach(el => el.onclick = () => procLogSheet(I.proc_log[el.dataset.pl]));
};

function procSheet(p) {
  p = p || {};
  formSheet({
    title: p.id ? 'Procedūra ir priminimas' : 'Nauja procedūra',
    values: { active: 1, mode: 'interval', interval_days: 7, weekday: 7, remind: 1, remind_time: '21:00', repeat: 1, ...p },
    fields: [
      { k: 'emoji', label: 'Ženkliukas', half: true }, { k: 'name', label: 'Pavadinimas', half: true },
      { k: 'mode', label: 'Kaip dažnai', type: 'select', opts: [['interval', 'Kas X dienų nuo paskutinio karto'], ['weekday', 'Kas savaitę, konkrečią dieną'], ['daily', 'Kasdien (nežymima, be priminimų)']] },
      { k: 'interval_days', label: 'Kas kiek dienų', type: 'number', half: true },
      { k: 'weekday', label: 'Savaitės diena', type: 'select', opts: WEEKDAYS, half: true },
      { k: 'remind', label: '🔔 Siųsti priminimą į telefoną', type: 'switch' },
      { k: 'remind_time', label: 'Kada siųsti', type: 'time', half: true },
      { k: 'repeat', label: 'Kartoti kas dieną, kol nepažymėta', type: 'switch' },
      { k: 'message', label: 'Pranešimo tekstas', ph: 'pvz. Ar išvalytos ausys?' },
      { k: 'active', label: 'Rodyti pradžios ekrane', type: 'switch' },
    ],
    extra: `<div class="muted small">Pažymėjus atlikimą anksčiau, kitas priminimas pasislenka. Pranešime bus mygtukai <b>✓ Atlikta</b> ir <b>Rytoj</b>.</div>`,
    bind: f => {
      const wrap = k => f.elements[k].closest('label');
      const upd = () => {
        const m = f.elements.mode.value, daily = m === 'daily', rem = f.elements.remind.checked;
        wrap('interval_days').hidden = m !== 'interval';
        wrap('weekday').hidden = m !== 'weekday';
        for (const k of ['remind', 'active']) wrap(k).hidden = daily;
        for (const k of ['remind_time', 'repeat', 'message']) wrap(k).hidden = daily || !rem;
      };
      f.elements.mode.onchange = upd; f.elements.remind.onchange = upd; upd();
    },
    onSave: v => {
      if (!v.name) { toast('Įrašykite pavadinimą'); return false; }
      const daily = v.mode === 'daily';
      return saveRow('procedures', { ...v, id: p.id, active: daily ? 0 : (v.active ? 1 : 0), remind: daily ? 0 : (v.remind ? 1 : 0), repeat: v.repeat ? 1 : 0, notify_last: null, pos: p.id ? p.pos : S.procedures.length });
    },
    onDelete: p.id && (async () => { if (!confirm('Bus ištrinta ir visa šios procedūros istorija. Tęsti?')) return false; await delRow('procedures', p.id); go('#settings'); }),
  });
}

// ============================================================ NUSTATYMAI
routes.settings = () => {
  setTop('Nustatymai', { back: '#home' });
  const P = S.profile;
  const procs = procsSorted();
  const st = S.settings;
  view.innerHTML = `<h2>Profilis</h2><div class="card list">
      <a class="li go" href="#profile"><div class="avatar" style="width:48px;height:48px;font-size:26px;${P.photo ? `background-image:url('files/${esc(P.photo)}')` : ''}">${P.photo ? '' : '🐶'}</div><div class="grow"><div class="t">${esc(P.name)}</div><div class="s">Visa informacija, kortelė, lapas veterinarui</div></div></a>
      <label class="li go"><span class="ic">📷</span><span class="grow">Keisti nuotrauką</span><input type="file" id="s-photo" accept="image/*" hidden></label>
    </div>
    <h2>🔔 Priminimai</h2><div class="card list">
      <div class="li go" id="s-notify"><span class="ic">📱</span><div class="grow"><div class="t">Telefonas ir skiepų priminimai</div><div class="s" id="s-notify-s">${st.notify_service ? esc(st.notify_service.replace('mobile_app_', '')) : 'Telefonas nepasirinktas'}${st.prevention_notify ? ` · skiepai prieš ${st.prevention_days} d.` : ''}</div></div></div>
    </div>
    <h2>Priežiūra namuose <button class="btn small" id="s-proc-add">＋</button></h2>
    <div class="card list">${procs.map((p, i) => `<div class="li"><span class="ic">${esc(p.emoji || '✔️')}</span><div class="grow" data-pe="${p.id}" style="cursor:pointer"><div class="t">${esc(p.name)}</div><div class="s">${esc(procModeText(p))}</div></div>
      <button class="btn small" data-mv="${i}:-1" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn small" data-mv="${i}:1" ${i === procs.length - 1 ? 'disabled' : ''}>↓</button></div>`).join('')}</div>
    <h2>Sąrašai</h2><div class="card list">
      <div class="li go" id="s-cats"><span class="ic">🏷️</span><div class="grow"><div class="t">Kategorijos</div><div class="s">Vizitų, žurnalo, kontaktų, priemonių paskirtys, apsaugos tipai</div></div></div>
    </div>
    <h2>Duomenys</h2><div class="card list">
      <a class="li" href="api/export" download><span class="ic">💾</span><div class="grow"><div class="t">Atsisiųsti atsarginę kopiją</div><div class="s">ZIP su visais duomenimis ir failais</div></div></a>
      <label class="li"><span class="ic">📥</span><div class="grow"><div class="t">Importuoti duomenis (.json)</div><div class="s">Papildo esamus – pvz. Claude paruoštą skiepų ir svorių istoriją</div></div><input type="file" id="s-imp" accept=".json,application/json,text/plain" hidden></label>
      <label class="li"><span class="ic">♻️</span><div class="grow"><div class="t">Atkurti iš atsarginės kopijos (.zip)</div><div class="s">Dėmesio: visi dabartiniai duomenys bus pakeisti</div></div><input type="file" id="s-rest" accept=".zip,application/zip" hidden></label>
    </div>
    <p class="muted small center" style="margin-top:20px">Rodukas v1.3 · ${S.visits.length} vizitai · ${S.documents.length} failai · ${S.supplies.length} priemonės</p>`;
  $('#s-photo').onchange = async e => { const f = e.target.files[0]; if (!f) return; const uid = await uploadFile(f, 'Įkeliama nuotrauka'); await act('profile_photo', { upload: uid, orig_name: f.name }); toast('Nuotrauka pakeista'); };
  $('#s-notify').onclick = notifySheet;
  $('#s-proc-add').onclick = () => procSheet();
  $$('[data-pe]').forEach(el => el.onclick = () => procSheet(I.procedures[el.dataset.pe]));
  $$('[data-mv]').forEach(b => b.onclick = () => { const [i, d] = b.dataset.mv.split(':').map(Number); const ids = procs.map(p => p.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; act('proc_order', { ids }); });
  $('#s-cats').onclick = catsSheet;
  $('#s-imp').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    let data; try { data = JSON.parse(await f.text()); } catch (err) { return toast('Neteisingas failo formatas'); }
    const r = await act('import', { data });
    toast('Importuota: ' + (Object.entries(r.imported).map(([k, v]) => `${k} ${v}`).join(', ') || 'nieko'), null, 5000);
  };
  $('#s-rest').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!confirm('Visi dabartiniai duomenys bus pakeisti duomenimis iš kopijos. Tęsti?')) return;
    const uid = await uploadFile(f, 'Įkeliama kopija');
    await act('restore', { upload: uid }); toast('Duomenys atkurti');
  };
};

async function notifySheet() {
  let stt = { ha: false, services: [], error: '' };
  try { stt = await api('api/notify_status'); } catch (e) { }
  const st = S.settings;
  const svcs = uniq([...stt.services, st.notify_service]);
  formSheet({
    title: 'Priminimų nustatymai', values: st,
    pre: !stt.ha ? '<div class="card pad warnbox small" style="margin-bottom:12px">Pranešimai veikia tik Home Assistant programoje. Čia nustatymus galima peržiūrėti, bet pranešimai nebus siunčiami.</div>' : '',
    fields: [
      { k: 'notify_service', label: 'Į kurį telefoną siųsti', type: 'select', opts: [['', '— nepasirinkta —'], ...svcs.map(s => [s, s.replace('mobile_app_', '📱 ')])] },
      { k: 'prevention_notify', label: '💉 Priminti apie skiepus ir antiparazitines', type: 'switch' },
      { k: 'prevention_days', label: 'Prieš kiek dienų', type: 'number', half: true },
      { k: 'prevention_time', label: 'Kada siųsti', type: 'time', half: true },
    ],
    extra: `<button type="button" class="btn block" id="n-test">🔔 Išbandyti pranešimą</button>
      <div class="muted small" id="n-stat">${stt.ha ? (stt.error ? '⚠️ ' + esc(stt.error) : (stt.ws ? '✓ Ryšys su Home Assistant veikia, mygtukai pranešimuose bus priimami' : '⏳ Jungiamasi prie Home Assistant…')) : ''}${stt.last_sent ? `<br>Paskutinis pranešimas: ${esc(stt.last_sent.replace('T', ' '))}` : ''}</div>
      <div class="muted small">Procedūrų priminimai (ausys, nagai) nustatomi paspaudus pačią procedūrą nustatymuose.</div>`,
    bind: f => {
      $('#n-test', f).onclick = async () => {
        if (!f.elements.notify_service.value) return toast('Pirma pasirinkite telefoną');
        try { await api('api/do/notify_test', { service: f.elements.notify_service.value }); toast('Išsiųsta – pažiūrėkite telefone'); } catch (e) { }
      };
    },
    onSave: v => act('settings_save', v),
  });
}

function profileSheet() {
  const P = S.profile;
  formSheet({
    title: 'Profilis', values: { ...P, target_kg: P.target_kg != null ? fmtNum(P.target_kg, 2) : '' },
    fields: [
      { k: 'name', label: 'Vardas', half: true }, { k: 'breed', label: 'Veislė', half: true },
      { k: 'birth_date', label: 'Gimimo data', type: 'date', half: true }, { k: 'sex', label: 'Lytis', type: 'select', opts: ['', 'Patinas', 'Patinas (kastruotas)', 'Patelė', 'Patelė (sterilizuota)'], half: true },
      { k: 'color', label: 'Spalva', half: true }, { k: 'target_kg', label: 'Tikslinis svoris, kg', type: 'number', half: true },
      { k: 'chip', label: 'Mikroschemos (čipo) nr.' }, { k: 'passport', label: 'Paso nr.', half: true }, { k: 'insurance', label: 'Draudimas', half: true },
      { k: 'emergency_contact_id', label: 'Skubios pagalbos klinika', type: 'select', opts: contactOpts() },
      { k: 'allergies', label: 'Alergijos / kas netinka', type: 'textarea' },
      { k: 'notes', label: 'Kitos svarbios pastabos (būdas, baimės, įpročiai)', type: 'textarea' },
    ],
    onSave: v => act('profile_save', v),
  });
}

function catsSheet() {
  const s = S.settings;
  const j = k => (s[k] || []).join('\n');
  formSheet({
    title: 'Kategorijos', values: { ...s, visit_cats: j('visit_cats'), journal_cats: j('journal_cats'), contact_cats: j('contact_cats'), prevention_kinds: j('prevention_kinds'), supply_purposes: j('supply_purposes') },
    fields: [
      { k: 'supply_purposes', label: 'Priemonių paskirtys (po vieną eilutėje)', type: 'textarea' },
      { k: 'visit_cats', label: 'Vizitų kategorijos', type: 'textarea' },
      { k: 'journal_cats', label: 'Žurnalo kategorijos', type: 'textarea' },
      { k: 'contact_cats', label: 'Kontaktų kategorijos', type: 'textarea' },
      { k: 'prevention_kinds', label: 'Apsaugos tipai', type: 'textarea' },
      { k: 'alert_days', label: 'Oranžinė žymė, kai iki galiojimo pabaigos liko mažiau nei (d.)', type: 'number' },
    ],
    onSave: v => act('settings_save', v),
  });
}

// ============================================================ PROFILIS, KORTELĖ, LAPAS VETERINARUI
routes.profile = () => {
  const P = S.profile;
  setTop('Profilis', { back: '#home', actions: `<button class="icon-btn" id="pf-edit" aria-label="Redaguoti">✏️</button>` });
  const w = lastWeight();
  const em = P.emergency_contact_id && I.contacts[P.emergency_contact_id];
  const kv = (label, val) => val ? `<div class="kv"><span>${label}</span><b>${val}</b></div>` : '';
  const uns = unsuitableList();
  view.innerHTML = `<div class="card pad"><div class="hero">
      <div class="avatar" ${P.photo ? `style="background-image:url('files/${esc(P.photo)}')"` : ''}>${P.photo ? '' : '🐶'}</div>
      <div class="grow"><h2>${esc(P.name)}</h2><div class="muted">${esc([P.breed, age(P.birth_date)].filter(Boolean).join(' · '))}</div></div></div></div>
    <div class="stack" style="margin-top:10px"><a class="btn block" href="#card">🖨 Priežiūros kortelė (spausdinti ar siųsti)</a><a class="btn block" href="#vet">🩺 Lapas veterinarui</a></div>
    <h2>Pagrindinė informacija</h2><div class="card list">
      ${kv('Veislė', esc(P.breed))}${kv('Lytis', esc(P.sex))}${kv('Gimė', P.birth_date ? `${esc(P.birth_date)} (${esc(age(P.birth_date))})` : '')}
      ${kv('Spalva', esc(P.color))}${kv('Svoris', w ? `${kg(w.kg)} <span class="muted">(${esc(w.date)})</span>` : '')}${kv('Tikslinis svoris', P.target_kg ? kg(P.target_kg) : '')}
      ${kv('Čipas', esc(P.chip))}${kv('Pasas', esc(P.passport))}${kv('Draudimas', esc(P.insurance))}
      ${!P.breed && !P.birth_date && !P.chip ? '<div class="li muted">Spauskite ✏️ ir užpildykite</div>' : ''}
    </div>
    <h2>⚠️ Alergijos ir kas netinka</h2><div class="card pad">${P.allergies ? `<div class="pre">${esc(P.allergies)}</div>` : '<span class="muted">Neįrašyta</span>'}
      ${uns.length ? `<div class="small" style="margin-top:8px"><b>Pažymėta kaip netinka:</b> ${uns.map(esc).join(', ')}</div>` : ''}</div>
    ${em ? `<h2>🚑 Skubi pagalba</h2><div class="card list"><a class="li go" href="#contact/${em.id}"><span class="ic">🩺</span><div class="grow"><div class="t">${esc(em.name)}</div><div class="s">${esc([em.phone, em.address].filter(Boolean).join(' · '))}</div></div></a></div>` : ''}
    ${P.notes ? `<h2>Pastabos</h2><div class="card pad pre">${esc(P.notes)}</div>` : ''}`;
  $('#pf-edit').onclick = profileSheet;
};

function docHeader(title, sub) {
  const P = S.profile;
  return `<div class="doc-head">
    <div class="avatar" ${P.photo ? `style="background-image:url('files/${esc(P.photo)}')"` : ''}>${P.photo ? '' : '🐶'}</div>
    <div class="grow"><div class="doc-kicker">${esc(title)}</div><h2>${esc(P.name)}</h2><div class="muted small">${esc(sub)}</div></div></div>`;
}
const tbl = (head, rowsArr, empty = '—') => rowsArr.length
  ? `<div class="tscroll"><table class="t"><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rowsArr.map(r => `<tr>${r.map(c => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</table></div>`
  : `<p class="muted small">${empty}</p>`;
function printBar(extra = '') {
  return `<div class="noprint printbar">${extra}<button class="btn primary" id="do-print">🖨 Spausdinti / išsaugoti PDF</button>
    <div class="muted small">Jei Home Assistant programėlėje spausdinimas neatsidaro, atidarykite programą per atskirą ikonėlę Chrome naršyklėje arba kompiuteryje.</div></div>`;
}
function bindPrint() { const b = $('#do-print'); if (b) b.onclick = () => { try { window.print(); } catch (e) { toast('Spausdinimas čia nepalaikomas'); } }; }

function aboutRows() {
  const P = S.profile, w = lastWeight();
  return [['Veislė', esc(P.breed)], ['Lytis', esc(P.sex)], ['Gimė', P.birth_date ? `${esc(P.birth_date)} (${esc(age(P.birth_date))})` : ''],
    ['Spalva', esc(P.color)], ['Svoris', w ? `${kg(w.kg)} (${esc(w.date)})` : ''], ['Čipas', esc(P.chip)], ['Pasas', esc(P.passport)], ['Draudimas', esc(P.insurance)]]
    .filter(r => r[1]);
}
function feedRows(list) {
  return list.map(f => [esc(foodName(f.food_id)), f.g_day ? `${fmtNum(f.g_day)} g/d.` : '', `${f.meals || 1} × ${f.portions || 1}`, f.g_day ? `<b class="nw">${fmtNum(f.g_day / (f.meals || 1) / (f.portions || 1))} g</b>` : '', `${nw(f.start || '?')} – ${nw(f.end || 'dabar')}`]);
}

routes.card = () => {
  const P = S.profile;
  setTop('Priežiūros kortelė', { back: '#profile' });
  const em = P.emergency_contact_id && I.contacts[P.emergency_contact_id];
  const vets = S.contacts.filter(c => c.category === 'Veterinarija' && (!em || c.id !== em.id));
  const uns = unsuitableList();
  const supplies = activeSupplies().sort((a, b) => (a.purpose || '').localeCompare(b.purpose || '', 'lt'));
  const procs = procsSorted().filter(p => p.active || p.mode === 'daily');
  view.innerHTML = printBar() + `<div class="doc">
    ${docHeader('Priežiūros kortelė', 'Atnaujinta ' + T())}
    <h3>Apie</h3>${tbl(['', ''], aboutRows())}
    <h3>⚠️ Alergijos ir kas netinka</h3>
    ${P.allergies ? `<p class="pre">${esc(P.allergies)}</p>` : ''}${uns.length ? `<p><b>Netinka:</b> ${uns.map(esc).join(', ')}</p>` : ''}${!P.allergies && !uns.length ? '<p class="muted small">Nežinoma</p>' : ''}
    <h3>🍽️ Maitinimas</h3>${tbl(['Maistas', 'Per dieną', 'Maitin. × įdėj.', 'Į kartą', 'Nuo'], feedRows(activeFeedings()))}
    <h3>💊 Vaistai ir vitaminai</h3>${tbl(['Pavadinimas', 'Dozė', 'Kaip dažnai', 'Iki'], sortDesc(activeMeds(), 'start').map(m => [esc(m.name), esc(m.dose), esc(m.freq), esc(m.end || '—')]), 'Šiuo metu nieko neduodama')}
    <h3>🧴 Priežiūros priemonės</h3>${tbl(['Kam', 'Priemonė', 'Kaip naudojama'], supplies.map(s => [esc(s.purpose || ''), `<b>${esc(s.name)}</b>${s.brand ? '<br><span class="muted">' + esc(s.brand) + '</span>' : ''}`, esc(s.usage)]), 'Neįvesta')}
    <h3>🧽 Priežiūra namuose</h3>${tbl(['Procedūra', 'Kaip dažnai'], procs.map(p => [`${esc(p.emoji || '')} ${esc(p.name)}`, esc(procModeText(p).split(' · ')[0])]))}
    <h3>💉 Skiepai ir apsauga</h3>${tbl(['Pavadinimas', 'Data', 'Galioja iki'], preventionLatest().map(p => [esc(p.name), nw(p.date || ''), nw(p.valid_until || '')]))}
    <h3>📞 Kontaktai</h3>${tbl(['', 'Telefonas', 'Adresas'], [...(em ? [em] : []), ...vets].map(c => [`<b>${esc(c.name)}</b>${c === em ? '<br><span class="muted">skubi pagalba</span>' : ''}`, esc(c.phone), esc(c.address)]), 'Neįvesta')}
    ${P.notes ? `<h3>Pastabos</h3><p class="pre">${esc(P.notes)}</p>` : ''}
  </div>`;
  bindPrint();
};

routes.vet = () => {
  const P = S.profile;
  const months = UI.vetMonths || 3;
  const from = addMonths(T(), -months), to = T();
  setTop('Lapas veterinarui', { back: '#profile' });
  const inP = d => d && d >= from && d <= to;
  const ws = weightsDesc().filter(w => inP(w.date));
  const wAll = weightsDesc();
  const before = wAll.find(w => w.date < from);
  const wFirst = ws[ws.length - 1] || before, wLast = ws[0] || wAll[0];
  const journal = sortDesc(S.journal.filter(j => inP(j.date)));
  const visits = sortDesc(S.visits.filter(v => inP(v.date)));
  const meds = sortDesc(S.meds.filter(m => overlaps(m.start, m.end, from, to)), 'start');
  const feeds = sortDesc(S.feedings.filter(f => overlaps(f.start, f.end, from, to)), 'start');
  const supNow = activeSupplies().sort((a, b) => (a.purpose || '').localeCompare(b.purpose || '', 'lt'));
  const supChanged = S.supplies.filter(s => inP(s.start) || inP(s.end));
  const uns = unsuitableList();
  const sevTxt = n => ['', 'lengvas', 'vidutinis', 'stiprus'][n] || '';
  view.innerHTML = printBar(`<div class="chips">${[1, 3, 6, 12].map(m => `<button class="chip ${m === months ? 'on' : ''}" data-mo="${m}">${m === 12 ? '1 metai' : m + ' mėn.'}</button>`).join('')}</div>`) + `<div class="doc">
    ${docHeader('Lapas veterinarui', `${[P.breed, age(P.birth_date), P.sex].filter(Boolean).join(' · ')} · laikotarpis ${from} – ${to}`)}
    ${P.allergies || uns.length ? `<div class="warnbox pad small"><b>⚠️ Alergijos / netinka:</b> ${esc([P.allergies, ...uns].filter(Boolean).join('; '))}</div>` : ''}
    <h3>⚖️ Svoris</h3>
    ${wLast ? `<p>Dabar <b>${kg(wLast.kg)}</b> (${esc(wLast.date)})${wFirst && wFirst !== wLast ? ` · prieš tai ${kg(wFirst.kg)} (${esc(wFirst.date)}) · pokytis <b>${wLast.kg - wFirst.kg > 0 ? '+' : ''}${fmtNum(wLast.kg - wFirst.kg, 2)} kg</b>` : ''}${P.target_kg ? ` · tikslas ${kg(P.target_kg)}` : ''}</p>` : '<p class="muted small">Svėrimų nėra</p>'}
    ${ws.length >= 2 ? weightChart(ws) : ''}
    <h3>🩹 Sveikatos įrašai</h3>${tbl(['Data', 'Kas', 'Aprašymas'], journal.map(j => [nw(j.date) + (j.time ? '<br>' + esc(j.time) : ''), `${esc(j.category)}${j.severity ? `<br><span class="muted">${sevTxt(j.severity)}</span>` : ''}`, `<span class="pre">${esc(j.text)}</span>`]), 'Per šį laikotarpį įrašų nėra')}
    <h3>🏥 Vizitai</h3>${tbl(['Data', 'Vizitas', 'Pastabos'], visits.map(v => [nw(v.date), `${esc(visitLabel(v))}<br><span class="muted">${esc(contactName(v.contact_id) || v.place || v.category)}</span>`, `<span class="pre">${esc(v.notes)}</span>`]), 'Vizitų nebuvo')}
    <h3>💊 Vaistai ir vitaminai</h3>${tbl(['Pavadinimas', 'Dozė', 'Laikotarpis', 'Kodėl'], meds.map(m => [esc(m.name), esc([m.dose, m.freq].filter(Boolean).join(', ')), `${nw(m.start || '?')} – ${nw(m.end || 'dabar')}`, esc(m.reason)]), 'Nebuvo duodama')}
    <h3>🍽️ Maistas</h3>${tbl(['Maistas', 'Per dieną', 'Maitin. × įdėj.', 'Į kartą', 'Laikotarpis'], feeds.map(f => feedRows([f])[0]))}
    <h3>🧴 Naudojamos priemonės</h3>${tbl(['Kam', 'Priemonė', 'Nuo'], supNow.map(s => [esc(s.purpose || ''), `<b>${esc(s.name)}</b>${s.brand ? ' · ' + esc(s.brand) : ''}`, nw(s.start || '')]), 'Neįvesta')}
    ${supChanged.length ? `<p class="small"><b>Pakeitimai per laikotarpį:</b> ${supChanged.map(s => esc(`${s.name}: ${inP(s.start) ? 'pradėta ' + s.start : ''}${inP(s.start) && inP(s.end) ? ', ' : ''}${inP(s.end) ? 'nebenaudojama nuo ' + s.end : ''}`)).join('; ')}</p>` : ''}
    <h3>💉 Skiepai ir apsauga</h3>${tbl(['Pavadinimas', 'Data', 'Galioja iki'], preventionLatest().map(p => [esc(p.name), nw(p.date || ''), nw(p.valid_until || '')]))}
  </div>`;
  $$('[data-mo]').forEach(b => b.onclick = () => { UI.vetMonths = +b.dataset.mo; saveUI(); render(); });
  bindPrint();
};

// ============================================================ formos ir apatinis langas
function fieldHtml(f, v) {
  const val = v ?? '';
  const cls = f.half ? '' : 'full';
  const name = `name="${f.k}"`;
  if (f.type === 'switch') return `<label class="row ${cls}" style="justify-content:space-between"><span>${esc(f.label)}</span><span class="switch"><input type="checkbox" ${name} ${val && val !== '0' ? 'checked' : ''}><i></i></span></label>`;
  let inner;
  if (f.type === 'select') inner = `<select ${name}>${f.opts.map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol || '—')}</option>`; }).join('')}</select>`;
  else if (f.type === 'textarea') inner = `<textarea ${name} placeholder="${esc(f.ph || '')}">${esc(val)}</textarea>`;
  else if (f.type === 'number') inner = `<input type="text" inputmode="decimal" ${name} value="${esc(typeof val === 'number' ? fmtNum(val, 2) : val)}" placeholder="${esc(f.ph || '')}">`;
  else {
    const lid = f.list ? 'dl_' + f.k : '';
    inner = `<input type="${f.type || 'text'}" ${name} value="${esc(val)}" placeholder="${esc(f.ph || '')}" ${lid ? `list="${lid}" autocomplete="off"` : ''}>${lid ? `<datalist id="${lid}">${f.list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}`;
  }
  return `<label class="field ${cls}"><span>${esc(f.label)}</span>${inner}</label>`;
}

function formSheet(o) {
  const vals = o.values || {};
  sheet(`<h3>${esc(o.title)}</h3><form id="fs" autocomplete="off">${o.pre || ''}<div class="fgrid">${o.fields.map(f => fieldHtml(f, vals[f.k])).join('')}</div>
    ${o.extra ? `<div class="stack" style="margin-top:12px">${o.extra}</div>` : ''}
    <button class="btn primary block" style="margin-top:16px;min-height:50px">${esc(o.saveLabel || '💾 Išsaugoti')}</button>
    ${o.onDelete ? '<button type="button" class="btn danger block" id="fs-del" style="margin-top:10px">Ištrinti</button>' : ''}</form>`, () => {
    const form = $('#fs');
    o.bind && o.bind(form);
    form.onsubmit = async e => {
      e.preventDefault();
      const out = {};
      for (const f of o.fields) { const el = form.elements[f.k]; if (el) out[f.k] = f.type === 'switch' ? el.checked : el.value; }
      const btn = $('button.primary', form); btn.disabled = true;
      try { const r = await o.onSave(out, form); if (r !== false) closeSheet(); }
      catch (err) { console.error(err); }
      finally { btn.disabled = false; }
    };
    const del = $('#fs-del');
    if (del) del.onclick = async () => { if (!confirm('Tikrai ištrinti? To atšaukti negalima.')) return; const r = await o.onDelete(); if (r !== false) closeSheet(); };
  });
}

function sheet(html, bind) {
  $('#sheet').innerHTML = '<div class="grab"></div>' + html;
  $('#sheet').hidden = false; $('#sheet-bg').hidden = false;
  $('#sheet').scrollTop = 0;
  bind && bind();
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet-bg').hidden = true; $('#sheet').innerHTML = ''; }
$('#sheet-bg').onclick = closeSheet;

// ============================================================ paleidimas
load().catch(e => { view.innerHTML = `<div class="empty"><span class="big">⚠️</span>Nepavyko prisijungti prie serverio.<br><button class="btn" onclick="location.reload()">Bandyti dar kartą</button></div>`; });
