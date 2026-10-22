/* Ūkis – namų užduočių programa */
'use strict';

// ============================================================ pagalbinės
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
let S = null;   // visa būsena iš serverio
let I = {};     // id -> įrašas kiekvienai lentelei
const UI = (() => { try { return JSON.parse(localStorage.getItem('ukis_ui') || '{}'); } catch (e) { return {}; } })();
UI.col = UI.col || {}; UI.showDone = UI.showDone || {};
function saveUI() { try { localStorage.setItem('ukis_ui', JSON.stringify(UI)); } catch (e) { } }
const fileUrl = fn => window.UKIS_FILE_URL ? window.UKIS_FILE_URL(fn) : 'files/' + encodeURIComponent(fn);

const MONTHS_G = ['sausio', 'vasario', 'kovo', 'balandžio', 'gegužės', 'birželio', 'liepos', 'rugpjūčio', 'rugsėjo', 'spalio', 'lapkričio', 'gruodžio'];
const MONTHS_S = ['saus.', 'vas.', 'kov.', 'bal.', 'geg.', 'birž.', 'liep.', 'rugp.', 'rugs.', 'spal.', 'lapkr.', 'gruod.'];
const DAYS = ['Sekmadienis', 'Pirmadienis', 'Antradienis', 'Trečiadienis', 'Ketvirtadienis', 'Penktadienis', 'Šeštadienis'];
const DAYS_S = ['Sk', 'Pr', 'An', 'Tr', 'Kt', 'Pn', 'Št'];

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
  S.tasks.forEach(t => {
    try { t.tagIds = JSON.parse(t.tags || '[]').map(Number); } catch (e) { t.tagIds = []; }
    try { t.rep = t.repeat ? JSON.parse(t.repeat) : null; } catch (e) { t.rep = null; }
    try { t.rem = JSON.parse(t.remind || '[]') || []; } catch (e) { t.rem = []; }
  });
  if (!noRender) render();
}

// sinchronizacija tarp telefonų
const busy = () => !$('#sheet').hidden || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) || DRAGGING;
setInterval(async () => {
  if (!S || document.hidden || busy()) return;
  try {
    const v = await (await fetch('api/version')).json();
    if (v.version !== S.version) { const y = scrollY; await load(); scrollTo(0, y); }
  } catch (e) { }
}, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S && !busy()) load().catch(() => { }); });

// ---- datos
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ds = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const T = () => S.today;
const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ds(d); };
const shortDate = s => { const d = pd(s); return `${MONTHS_S[d.getMonth()]} ${d.getDate()}`; };
const longDate = s => { const d = pd(s); return `${DAYS[d.getDay()]}, ${MONTHS_G[d.getMonth()]} ${d.getDate()} d.`; };
const isoWd = s => pd(s).getDay() || 7;
function stamp(iso) { // „spal. 20, 21:30“ / „šiandien 21:30“
  if (!iso) return '';
  const [d, t] = iso.split('T'); const hm = (t || '').slice(0, 5);
  const n = diffDays(d, T());
  return (n === 0 ? 'šiandien' : n === 1 ? 'vakar' : shortDate(d) + (d.slice(0, 4) !== T().slice(0, 4) ? ' ' + d.slice(0, 4) : '')) + (hm ? ' ' + hm : '');
}
function dueInfo(due) {
  if (!due) return null;
  const n = diffDays(T(), due);
  if (n < 0) return { cls: 'over', txt: `Vėluoja ${-n} d.` };
  if (n === 0) return { cls: 'today', txt: 'Šiandien' };
  if (n === 1) return { cls: 'soon', txt: 'Rytoj' };
  if (n < 7) return { cls: 'week', txt: `Po ${n} d. · ${DAYS_S[pd(due).getDay()]}` };
  return { cls: '', txt: shortDate(due) + (due.slice(0, 4) !== T().slice(0, 4) ? ' ' + due.slice(0, 4) : '') };
}

// ---- duomenys
const sectionsSorted = () => [...S.sections].sort((a, b) => a.pos - b.pos || a.id - b.id);
const tagsSorted = () => [...S.tags].sort((a, b) => a.pos - b.pos || a.name.localeCompare(b.name, 'lt'));
const tasksOf = sid => S.tasks.filter(t => t.section_id === sid).sort((a, b) => a.pos - b.pos || a.id - b.id);
const subsOf = tid => S.subtasks.filter(s => s.task_id === tid).sort((a, b) => a.pos - b.pos || a.id - b.id);
const commentsOf = tid => S.comments.filter(c => c.task_id === tid).sort((a, b) => (a.created || '').localeCompare(b.created || '') || a.id - b.id);
const filesOf = tid => S.files.filter(f => f.task_id === tid).sort((a, b) => a.id - b.id);
const secLabel = s => s ? `${s.emoji ? s.emoji + ' ' : ''}${s.name}` : '—';
const tagLabel = g => `${g.emoji ? g.emoji + ' ' : ''}${g.name}`;
function doneVisible(t) {
  if (!t.done) return true;
  if (!t.done_at) return false;
  return diffDays(t.done_at.slice(0, 10), T()) <= (S.settings.done_keep_days ?? 1);
}

const UNITS = { d: ['dieną', 'd.'], w: ['savaitę', 'sav.'], m: ['mėnesį', 'mėn.'], y: ['metus', 'm.'] };
function repText(r) {
  if (!r) return '';
  const u = UNITS[r.unit] || UNITS.w;
  return (r.every == 1 ? 'Kas ' + u[0] : `Kas ${r.every} ${u[1]}`) + (r.type === 'after' ? ' nuo atlikimo' : '');
}
const logsOf = tid => S.task_log.filter(l => l.task_id === tid).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);

// ============================================================ maršrutai
const routes = {};
let route = { name: 'list', arg: null };
function go(hash) { location.hash = hash; }
window.addEventListener('hashchange', () => { closeSheet(); render(); scrollTo(0, 0); });

function setTop(title, opts = {}) {
  $('#title').textContent = title;
  $('#back').hidden = !opts.back;
  $('#back').onclick = () => opts.back === true ? (history.length > 1 ? history.back() : go('#list')) : go(opts.back);
  $('#top-actions').innerHTML = opts.actions || '';
}
function render() {
  if (!S) return;
  const h = (location.hash || '#list').slice(1).split('/');
  route = { name: h[0] || 'list', arg: h[1] };
  const fn = routes[route.name] || routes.list;
  const tab = { soon: 'soon', find: 'find', list: 'list' }[route.name] || UI.lastTab || 'list';
  if (['list', 'soon', 'find'].includes(route.name)) { UI.lastTab = route.name; saveUI(); }
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  fn(route.arg);
  $$('[data-go]').forEach(el => el.onclick = e => { e.stopPropagation(); go(el.dataset.go); });
}

// ---- užduoties eilutė (naudojama visur)
function taskRow(t, o = {}) {
  const di = !t.done && dueInfo(t.due);
  const subs = subsOf(t.id), sd = subs.filter(s => s.done).length;
  const nf = filesOf(t.id).length, nc = commentsOf(t.id).length;
  const tags = t.tagIds.map(id => I.tags[id]).filter(Boolean);
  const meta = [];
  if (o.section) meta.push(`<span class="tk-sec">${esc(secLabel(I.sections[t.section_id]))}</span>`);
  if (di) meta.push(`<span class="due ${di.cls}">📅 ${esc(di.txt)}${t.time ? ' ' + esc(t.time) : ''}</span>`);
  if (t.rem && t.rem.length && !t.done) meta.push('<span class="ico">🔔</span>');
  else if (t.due && t.done) meta.push(`<span class="due">📅 ${esc(shortDate(t.due))}</span>`);
  tags.forEach(g => meta.push(`<span class="tg">${esc(tagLabel(g))}</span>`));
  if (subs.length) meta.push(`<span class="ico ${sd === subs.length ? 'all' : ''}">☑ ${sd}/${subs.length}</span>`);
  if (t.rep) meta.push(`<span class="ico" title="${esc(repText(t.rep))}">🔁</span>`);
  if (nf) meta.push(`<span class="ico">📎 ${nf}</span>`);
  if (nc) meta.push(`<span class="ico">💬 ${nc}</span>`);
  return `<div class="tk ${t.done ? 'done' : ''} ${di ? 'd-' + di.cls : ''}" ${o.sortable ? 'data-sort' : ''} data-task="${t.id}">
    <button class="ck" data-ck="${t.id}" aria-label="Atlikta"></button>
    <div class="grow tk-b" data-open="${t.id}"><div class="tk-t">${esc(t.title)}</div>${t.notes && t.notes.trim() ? `<div class="tk-n">${esc(t.notes.replace(/\s+/g, ' ').trim())}</div>` : ''}${meta.length ? `<div class="tk-m">${meta.join('')}</div>` : ''}</div>
    ${o.sortable ? '<span class="grip" aria-label="Tempti">⠿</span>' : ''}
  </div>`;
}
function bindTaskRows(root = view) {
  $$('[data-ck]', root).forEach(b => b.onclick = e => { e.stopPropagation(); toggleDone(I.tasks[b.dataset.ck]); });
  $$('[data-open]', root).forEach(el => el.onclick = () => go('#task/' + el.dataset.open));
}
async function toggleDone(t, skip) {
  if (t.done) { t.done = 0; render(); await saveRow('tasks', { id: t.id, done: 0 }); return; }
  if (!t.rep) { t.done = 1; t.done_at = new Date().toISOString().slice(0, 19); render(); } // greitas atsakas
  const r = await act('task_complete', { id: t.id, skip: !!skip });
  const undo = { label: 'Atšaukti', fn: () => act('task_undo', r.undo) };
  if (r.next) toast(`${skip ? '⏭' : '✓'} ${t.title} · kitas kartas ${dueWord(r.next)}`, undo, 5000);
  else toast('✓ ' + t.title, undo);
}
function dueWord(d) { const n = diffDays(T(), d); return n === 0 ? 'šiandien' : n === 1 ? 'rytoj' : shortDate(d); }

// ============================================================ UŽDUOTYS (sąrašas su sekcijomis)
let addingIn = null; // sekcija, kurioje atidarytas įvedimo laukelis
routes.list = () => {
  setTop('Ūkis', { actions: `<button class="icon-btn" data-go="#settings" aria-label="Nustatymai">⚙️</button>` });
  const secs = sectionsSorted();
  if (!secs.some(s => s.id === UI.qaSec)) UI.qaSec = secs[0]?.id;
  let h = `<form id="qa" class="qa" autocomplete="off"><input type="text" id="qa-in" placeholder="＋ Nauja užduotis…" enterkeyhint="done">
    <button type="button" class="qa-sec" id="qa-sec">${esc(secLabel(I.sections[UI.qaSec]))} ▾</button></form>
    <div id="tlist">`;
  for (const s of secs) {
    const all = tasksOf(s.id), vis = all.filter(t => UI.showDone[s.id] || doneVisible(t));
    const open = all.filter(t => !t.done).length, hidden = all.length - vis.length;
    const col = !!UI.col[s.id];
    h += `<div class="sec-h ${col ? 'col' : ''}" data-sort data-sec="${s.id}">
      <button class="sec-tg" data-tg="${s.id}"><span class="chev">›</span><b>${esc(secLabel(s))}</b><span class="cnt">${open || ''}</span></button>
      <button class="icon-btn" data-secm="${s.id}" aria-label="Sekcijos meniu">⋯</button></div>`;
    if (col) continue;
    h += `<div class="tk-card">${vis.map(t => taskRow(t, { sortable: true })).join('')}`;
    h += addingIn === s.id
      ? `<form class="tk-new" data-newf="${s.id}"><span class="ck ghost"></span><input type="text" placeholder="Užduoties pavadinimas" enterkeyhint="done"></form>`
      : `<div class="tk-add" data-addin="${s.id}">＋ Pridėti užduotį</div>`;
    if (hidden || UI.showDone[s.id]) {
      const nd = all.filter(t => t.done).length;
      h += `<div class="tk-more" data-showdone="${s.id}">${UI.showDone[s.id] ? 'Slėpti senas atliktas' : `✓ Rodyti atliktas (${hidden})`}</div>`;
      void nd;
    }
    h += `</div>`;
  }
  h += `</div><button class="btn block" id="add-sec" style="margin-top:18px">＋ Nauja sekcija</button>`;
  view.innerHTML = h;
  bindTaskRows();

  const qa = $('#qa');
  qa.onsubmit = async e => {
    e.preventDefault();
    const inp = $('#qa-in'), title = inp.value.trim();
    if (!title) return;
    inp.value = '';
    await saveRow('tasks', { title, section_id: UI.qaSec }, true);
    render(); $('#qa-in').focus();
    toast(`Pridėta į „${I.sections[UI.qaSec]?.name}“`);
  };
  $('#qa-sec').onclick = () => pickSection(UI.qaSec, sid => { UI.qaSec = sid; saveUI(); render(); });

  $$('[data-tg]').forEach(b => b.onclick = () => { const id = b.dataset.tg; UI.col[id] = !UI.col[id]; saveUI(); render(); });
  $$('[data-secm]').forEach(b => b.onclick = () => sectionMenu(I.sections[b.dataset.secm]));
  $$('[data-showdone]').forEach(b => b.onclick = () => { const id = b.dataset.showdone; UI.showDone[id] = !UI.showDone[id]; saveUI(); render(); });
  $$('[data-addin]').forEach(b => b.onclick = () => { addingIn = +b.dataset.addin; render(); });
  const nf = $('[data-newf]');
  if (nf) {
    const inp = $('input', nf); inp.focus();
    nf.onsubmit = async e => {
      e.preventDefault();
      const title = inp.value.trim();
      if (!title) { addingIn = null; render(); return; }
      await saveRow('tasks', { title, section_id: +nf.dataset.newf }, true);
      render();
    };
    inp.onblur = () => setTimeout(() => { if (addingIn && !inp.value.trim() && document.activeElement !== inp) { addingIn = null; render(); } }, 150);
  }
  $('#add-sec').onclick = () => sectionSheet();

  // ilgas paspaudimas ir tempimas – tvarka ir perkėlimas tarp sekcijų
  longPressSort($('#tlist'), '[data-sort]', el => el.matches('.tk'), (order) => {
    const items = [], seen = new Set();
    let sid = null;
    for (const el of order) {
      if (el.dataset.sec) { sid = +el.dataset.sec; continue; }
      if (sid == null) sid = secs[0].id;
      items.push([+el.dataset.task, sid]); seen.add(+el.dataset.task);
    }
    // paslėptos (atliktos / suskleistos) užduotys lieka savo sekcijų gale
    const bySec = {};
    for (const [tid, s] of items) (bySec[s] = bySec[s] || []).push(tid);
    const full = [];
    for (const s of secs) {
      (bySec[s.id] || []).forEach(tid => full.push([tid, s.id]));
      tasksOf(s.id).filter(t => !seen.has(t.id)).forEach(t => full.push([t.id, s.id]));
    }
    // greitas atsakas
    const cnt = {};
    full.forEach(([tid, s]) => { cnt[s] = (cnt[s] ?? -1) + 1; Object.assign(I.tasks[tid], { section_id: s, pos: cnt[s] }); });
    render();
    act('order_tasks', { items: full });
  });
};

function pickSection(cur, cb) {
  sheet(`<h3>Į kurią sekciją?</h3><div class="card list">${sectionsSorted().map(s => `<div class="li" data-ps="${s.id}"><span class="grow t">${esc(secLabel(s))}</span>${s.id === cur ? '<b style="color:var(--accent)">✓</b>' : ''}</div>`).join('')}</div>`, () => {
    $$('[data-ps]').forEach(el => el.onclick = () => { closeSheet(); cb(+el.dataset.ps); });
  });
}

function sectionMenu(s) {
  const secs = sectionsSorted(), i = secs.findIndex(x => x.id === s.id);
  sheet(`<h3>${esc(secLabel(s))}</h3><div class="card list">
    <div class="li" id="sm-add"><span class="ic">＋</span><span class="grow t">Pridėti užduotį</span></div>
    <div class="li" id="sm-edit"><span class="ic">✏️</span><span class="grow t">Pervadinti</span></div>
    ${i > 0 ? '<div class="li" id="sm-up"><span class="ic">⬆️</span><span class="grow t">Perkelti aukščiau</span></div>' : ''}
    ${i < secs.length - 1 ? '<div class="li" id="sm-down"><span class="ic">⬇️</span><span class="grow t">Perkelti žemiau</span></div>' : ''}
    ${secs.length > 1 ? '<div class="li" id="sm-del" style="color:var(--danger)"><span class="ic">🗑️</span><span class="grow t">Ištrinti sekciją</span></div>' : ''}
  </div>`, () => {
    $('#sm-add').onclick = () => { closeSheet(); UI.col[s.id] = false; saveUI(); addingIn = s.id; render(); };
    $('#sm-edit').onclick = () => sectionSheet(s);
    const mv = d => { const ids = secs.map(x => x.id); ids.splice(i, 1); ids.splice(i + d, 0, s.id); closeSheet(); act('order', { t: 'sections', ids }); };
    if ($('#sm-up')) $('#sm-up').onclick = () => mv(-1);
    if ($('#sm-down')) $('#sm-down').onclick = () => mv(1);
    if ($('#sm-del')) $('#sm-del').onclick = () => sectionDelete(s);
  });
}

// emoji ir pavadinimas vienoje eilutėje (emoji – iš telefono klaviatūros)
function nameRow(v, ph) {
  return `<div class="name-row"><input type="text" name="emoji" class="emo" value="${esc(v?.emoji || '')}" placeholder="emoji" autocomplete="off" aria-label="Emoji">
    <input type="text" name="name" value="${esc(v?.name || '')}" placeholder="${esc(ph)}" aria-label="Pavadinimas"></div>`;
}
// paliekamas tik vienas (paskutinis įvestas) emoji
function oneEmoji(str) {
  str = (str || '').trim();
  if (!str) return '';
  try { const seg = [...new Intl.Segmenter('lt', { granularity: 'grapheme' }).segment(str)].map(x => x.segment).filter(x => x.trim()); return seg[seg.length - 1] || ''; }
  catch (e) { return [...str].slice(-2).join(''); }
}
function bindEmoji(form) {
  const inp = form.elements.emoji;
  inp.addEventListener('input', () => { const one = oneEmoji(inp.value); if (one !== inp.value) inp.value = one; });
}

function sectionSheet(s) {
  formSheet({
    title: s ? 'Sekcija' : 'Nauja sekcija', fields: [],
    pre: nameRow(s, 'Pavadinimas, pvz. Darbai'),
    bind: f => { bindEmoji(f); if (!s) setTimeout(() => f.elements.name.focus(), 50); },
    onSave: async (v, f) => { await saveRow('sections', { id: s?.id, name: f.elements.name.value, emoji: oneEmoji(f.elements.emoji.value) }); },
  });
}
function sectionDelete(s) {
  const n = tasksOf(s.id).length;
  const others = sectionsSorted().filter(x => x.id !== s.id);
  if (!n) { if (confirm(`Ištrinti sekciją „${s.name}“?`)) { closeSheet(); delRow('sections', s.id); } return; }
  sheet(`<h3>Ištrinti „${esc(s.name)}“?</h3><p class="muted">Sekcijoje yra užduočių: ${n}. Ką su jomis daryti?</p>
    <label class="field"><span>Perkelti į</span><select id="sd-to">${others.map(o => `<option value="${o.id}">${esc(secLabel(o))}</option>`).join('')}</select></label>
    <button class="btn primary block" id="sd-move" style="margin-top:14px">Perkelti ir ištrinti sekciją</button>
    <button class="btn danger block" id="sd-all" style="margin-top:10px">Ištrinti kartu su užduotimis</button>`, () => {
    $('#sd-move').onclick = async () => { const to = +$('#sd-to').value; closeSheet(); await act('delete', { t: 'sections', id: s.id, move_to: to }); };
    $('#sd-all').onclick = async () => { if (!confirm(`Tikrai ištrinti ${n} užduotis? To atšaukti negalima.`)) return; closeSheet(); await delRow('sections', s.id); };
  });
}

// ============================================================ ARTIMIAUSI
routes.soon = () => {
  setTop('Artimiausi', { actions: `<button class="icon-btn" data-go="#settings" aria-label="Nustatymai">⚙️</button>` });
  const t0 = T(), sunday = addDays(t0, 7 - isoWd(t0)), nextSunday = addDays(sunday, 7);
  const groups = [
    ['over', 'Pavėluota', d => d < t0],
    ['today', 'Šiandien', d => d === t0],
    ['soon', 'Rytoj', d => d === addDays(t0, 1)],
    ['week', 'Šią savaitę', d => d > addDays(t0, 1) && d <= sunday],
    ['next', 'Kitą savaitę', d => d > sunday && d <= nextSunday],
    ['later', 'Vėliau', d => d > nextSunday],
  ];
  const dated = S.tasks.filter(t => t.due && (!t.done || (doneVisible(t) && t.due >= addDays(t0, -1))))
    .sort((a, b) => a.due.localeCompare(b.due) || (a.time || '99').localeCompare(b.time || '99') || a.done - b.done || a.pos - b.pos);
  let h = '';
  for (const [cls, name, fn] of groups) {
    const list = dated.filter(t => fn(t.due));
    if (!list.length) continue;
    h += `<h2 class="grp-${cls}">${esc(name)}${cls === 'today' || cls === 'soon' ? ` <span class="muted small" style="font-weight:600">${esc(longDate(cls === 'today' ? t0 : addDays(t0, 1)))}</span>` : ''}</h2>
      <div class="tk-card">${list.map(t => taskRow(t, { section: true })).join('')}</div>`;
  }
  view.innerHTML = h || `<div class="empty"><span class="big">🌤️</span>Nėra užduočių su data.<br><span class="small">Užduotys be datos čia nerodomos – jos lieka tik sąraše.</span></div>`;
  bindTaskRows();
};

// ============================================================ ŽYMOS IR PAIEŠKA
routes.find = () => {
  setTop('Žymos', { actions: `<button class="icon-btn" id="tags-edit" aria-label="Tvarkyti žymas">✏️</button>` });
  const tags = tagsSorted();
  const q = UI.q || '';
  if (UI.tag && !I.tags[UI.tag]) UI.tag = null;
  view.innerHTML = `<input type="search" id="f-q" placeholder="🔍 Ieškoti užduočių…" value="${esc(q)}">
    <div class="chips" style="margin-top:10px">${tags.map(g => `<button class="chip ${UI.tag === g.id ? 'on' : ''}" data-tag="${g.id}">${esc(tagLabel(g))} <span class="n">${S.tasks.filter(t => !t.done && t.tagIds.includes(g.id)).length}</span></button>`).join('')}
      <button class="chip" id="tag-new">＋ Nauja žyma</button></div>
    <div id="f-res"></div>`;
  const draw = () => {
    const qq = (UI.q || '').trim().toLowerCase();
    if (!UI.tag && !qq) { $('#f-res').innerHTML = `<div class="empty"><span class="big">🏷️</span>Pasirinkite žymą arba įrašykite paieškos žodį.<br><span class="small">Žymos tinka vietoms – pvz. „Senukai“: parduotuvėje iškart matysite, ką ten pirkti.</span></div>`; return; }
    const res = S.tasks.filter(t => (!UI.tag || t.tagIds.includes(UI.tag)) && (!qq || (t.title + ' ' + (t.notes || '')).toLowerCase().includes(qq)) && (!t.done || doneVisible(t)))
      .sort((a, b) => a.done - b.done || (I.sections[a.section_id]?.pos ?? 0) - (I.sections[b.section_id]?.pos ?? 0) || a.pos - b.pos);
    $('#f-res').innerHTML = res.length ? `<div class="tk-card" style="margin-top:6px">${res.map(t => taskRow(t, { section: true })).join('')}</div>` : '<div class="empty">Nieko nerasta</div>';
    bindTaskRows($('#f-res'));
  };
  draw();
  $('#f-q').oninput = e => { UI.q = e.target.value; saveUI(); draw(); };
  $$('[data-tag]').forEach(b => b.onclick = () => { UI.tag = UI.tag === +b.dataset.tag ? null : +b.dataset.tag; saveUI(); render(); });
  $('#tag-new').onclick = () => tagSheet();
  $('#tags-edit').onclick = () => go('#settings');
};

function tagSheet(g, after) {
  formSheet({
    title: g ? 'Žyma' : 'Nauja žyma', fields: [],
    pre: nameRow(g, 'Pavadinimas, pvz. Senukai'),
    bind: f => { bindEmoji(f); if (!g) setTimeout(() => f.elements.name.focus(), 50); },
    onSave: async (v, f) => { const r = await saveRow('tags', { id: g?.id, name: f.elements.name.value, emoji: oneEmoji(f.elements.emoji.value) }); after && after(r.id); },
    onDelete: g ? async () => { await delRow('tags', g.id); } : null,
  });
}

// ============================================================ UŽDUOTIS
routes.task = id => {
  const t = I.tasks[id]; if (!t) return go('#' + (UI.lastTab || 'list'));
  setTop('', { back: true, actions: `<button class="icon-btn" id="tk-menu" aria-label="Daugiau">⋯</button>` });
  const di = !t.done && dueInfo(t.due);
  const subs = subsOf(t.id), files = filesOf(t.id), coms = commentsOf(t.id);
  const t0 = T();
  const wd = isoWd(t0), sat = wd < 6 ? addDays(t0, 6 - wd) : wd === 6 ? t0 : addDays(t0, 6);
  const quick = [['Šiandien', t0], ['Rytoj', addDays(t0, 1)], ['Šeštadienį', sat], ['Po savaitės', addDays(t0, 7)]];
  view.innerHTML = `
  <div class="td-head ${t.done ? 'done' : ''}">
    <button class="ck big" id="td-ck" aria-label="Atlikta"></button>
    <textarea id="td-title" rows="1" placeholder="Užduoties pavadinimas">${esc(t.title)}</textarea>
  </div>
  ${t.done ? `<div class="donebar">✓ Atlikta ${esc(stamp(t.done_at))}</div>` : ''}
  <div class="card list" style="margin-top:12px">
    <div class="li" id="td-sec"><span class="ic">📁</span><div class="grow"><div class="s">Sekcija</div><div class="t">${esc(secLabel(I.sections[t.section_id]))}</div></div><span class="muted">›</span></div>
    <div class="li td-date" style="align-items:flex-start"><span class="ic">📅</span><div class="grow"><div class="s">Data</div>
      <div class="row"><input type="date" id="td-due" value="${esc(t.due || '')}">${t.due ? '<button class="icon-btn" id="td-due-x" aria-label="Pašalinti datą">✕</button>' : ''}</div>
      ${t.due ? `<div class="row wrap tm-row"><label class="row allday"><span class="switch"><input type="checkbox" id="td-allday" ${t.time ? '' : 'checked'}><i></i></span><span>Visa diena</span></label>
        ${t.time ? `<span class="row"><input type="time" id="td-t1" value="${esc(t.time)}"><span>–</span><input type="time" id="td-t2" value="${esc(t.end_time || '')}"></span>` : ''}</div>` : ''}
      ${di ? `<div class="due ${di.cls}" style="margin-top:6px">${esc(di.txt)}${t.time ? ' ' + esc(t.time) + (t.end_time ? '–' + esc(t.end_time) : '') : ''} · ${esc(longDate(t.due))}</div>` : ''}
      <div class="qdates">${quick.map(([l, d]) => `<button class="chip ${t.due === d ? 'on' : ''}" data-qd="${d}">${l}</button>`).join('')}</div></div></div>
    <div class="li" id="td-rep"><span class="ic">🔁</span><div class="grow"><div class="s">Kartojimas</div><div class="t ${t.rep ? '' : 'muted'}">${t.rep ? esc(repText(t.rep)) : 'Nesikartoja'}</div>
      ${t.rep && t.rep.type === 'cal' && t.rep.next && t.due && t.rep.next !== t.due ? `<div class="s" style="color:var(--warn);font-weight:700">Šį kartą perkelta (pagal grafiką – ${esc(shortDate(t.rep.next))})</div>` : ''}</div><span class="muted">›</span></div>
    ${t.due ? `<div class="li" style="align-items:flex-start"><span class="ic">🔔</span><div class="grow"><div class="s">Priminimai telefone</div>
      <div id="rems">${t.rem.map((r, i) => remRow(t, r, i)).join('')}</div>
      <button class="chip" id="rem-add" style="margin-top:8px">＋ Pridėti priminimą</button>
      ${S.settings.notify_services?.length ? '' : '<div class="s" style="margin-top:6px">Telefonas dar nepasirinktas – ⚙️ Nustatymai → Priminimai telefone</div>'}</div></div>` : ''}
    <div class="li" style="align-items:flex-start"><span class="ic">🏷️</span><div class="grow"><div class="s">Žymos</div>
      <div class="tagpick">${tagsSorted().map(g => `<button class="chip ${t.tagIds.includes(g.id) ? 'on' : ''}" data-tt="${g.id}">${esc(tagLabel(g))}</button>`).join('')}<button class="chip" id="td-newtag">＋</button></div></div></div>
  </div>

  ${t.rep ? (() => { const L = logsOf(t.id); return `<div class="row" style="margin-top:12px"><button class="btn primary grow" id="td-done-rep">✓ Atlikta</button><button class="btn grow" id="td-skip">⏭ Praleisti šį kartą</button></div>
    ${L.length ? `<details class="card fold-card"><summary class="li"><span class="ic">🕘</span><div class="grow"><div class="t">Atlikta paskutinį kartą ${esc(stamp(L[0].date))}</div><div class="s">Istorija: ${L.length} kart.</div></div><span class="chev">›</span></summary>
      ${L.slice(0, 30).map(l => `<div class="li" data-log="${l.id}"><span class="ic">✓</span><div class="grow"><div class="t">${esc(longDate(l.date))}</div>${l.due && l.due !== l.date ? `<div class="s">buvo numatyta ${esc(shortDate(l.due))}</div>` : ''}</div></div>`).join('')}</details>` : ''}`; })() : ''}

  <h2>📝 Aprašymas</h2>
  <div class="card"><textarea id="td-notes" class="plain" placeholder="Smulkesnė informacija, telefonai, matmenys…">${esc(t.notes || '')}</textarea></div>

  <h2>☑ Sub-užduotys${subs.length ? ` <span class="muted small">${subs.filter(s => s.done).length}/${subs.length}</span>` : ''}</h2>
  <div class="card" id="subs">${subs.map(s => `<div class="sub ${s.done ? 'done' : ''}" data-sub="${s.id}"><button class="ck sm" data-sck="${s.id}"></button>
      <input type="text" class="plain" value="${esc(s.title)}" data-sti="${s.id}"><button class="x-btn" data-sdel="${s.id}" aria-label="Ištrinti">×</button><span class="grip" aria-label="Tempti">⠿</span></div>`).join('')}
    <form id="sub-new" class="sub"><span class="ck sm ghost"></span><input type="text" class="plain" placeholder="＋ Pridėti sub-užduotį" enterkeyhint="done"></form>
  </div>

  <h2>📎 Failai ir nuotraukos</h2>
  <div class="card pad">
    ${files.length ? `<div class="thumbs" style="margin-bottom:12px">${files.map(thumbHtml).join('')}</div>` : ''}
    <label class="btn block">📷 Pridėti nuotrauką ar failą<input type="file" id="td-file" multiple accept="image/*,application/pdf,video/*,.doc,.docx,.xls,.xlsx,.txt" hidden></label>
  </div>

  <h2>💬 Komentarai</h2>
  <div class="card">${coms.map(c => `<div class="com" data-com="${c.id}"><div class="when">${esc(stamp(c.created))}</div><div class="pre">${esc(c.text)}</div></div>`).join('')}
    <form id="com-new" class="com-new"><textarea placeholder="Komentaras…" rows="1"></textarea><button class="btn primary small">Rašyti</button></form>
  </div>
  <p class="muted small center" style="margin-top:18px">Sukurta ${esc(stamp(t.created))}</p>`;

  // pavadinimas
  const ti = $('#td-title');
  autosize(ti); ti.oninput = () => autosize(ti);
  ti.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ti.blur(); } };
  ti.onblur = async () => { const v = ti.value.trim(); if (!v) { ti.value = t.title; return; } if (v !== t.title) { await saveRow('tasks', { id: t.id, title: v }, true); } };
  $('#td-ck').onclick = () => toggleDone(t);
  $('#tk-menu').onclick = () => taskMenu(t);
  $('#td-sec').onclick = () => pickSection(t.section_id, async sid => { if (sid === t.section_id) return; await saveRow('tasks', { id: t.id, section_id: sid, pos: '' }); });
  // data
  const setDue = d => {
    if (!t.rep) return saveRow('tasks', { id: t.id, due: d || '' });
    if (!d) { $('#td-due').value = t.due || ''; return toast('Kartojamai užduočiai data būtina'); }
    if (d === t.due) return;
    if (t.rep.type === 'after') return saveRow('tasks', { id: t.id, due: d, repeat: { ...t.rep, next: d } });
    sheet(`<h3>Keisti datą į ${esc(longDate(d))}?</h3><div class="card list">
      <div class="li" id="dd-once"><span class="ic">1️⃣</span><div class="grow"><div class="t">Tik šį kartą</div><div class="s">Kiti kartai lieka pagal grafiką (${esc(repText(t.rep).toLowerCase())})</div></div></div>
      <div class="li" id="dd-all"><span class="ic">🔁</span><div class="grow"><div class="t">Perkelti visą grafiką</div><div class="s">Toliau bus skaičiuojama nuo ${esc(shortDate(d))}</div></div></div></div>`, () => {
      $('#dd-once').onclick = () => { closeSheet(); saveRow('tasks', { id: t.id, due: d, repeat: { ...t.rep, next: t.rep.next || t.due } }); };
      $('#dd-all').onclick = () => { closeSheet(); saveRow('tasks', { id: t.id, due: d, repeat: { ...t.rep, next: d } }); };
    });
    $('#sheet-bg').onclick = () => { closeSheet(); render(); };
  };
  $('#td-rep').onclick = () => repeatSheet(t);
  // laikas ir priminimai
  const conv = (list, timed) => list.map(r => timed
    ? (r.u === 'd' && r.n === 0 ? { n: 30, u: 'min' } : { n: r.n, u: r.u })
    : (r.u === 'd' || r.u === 'sav' ? { n: r.n, u: r.u, at: r.at || '13:00' } : { n: 0, u: 'd', at: '13:00' }));
  if ($('#td-allday')) $('#td-allday').onchange = e => {
    if (e.target.checked) return saveRow('tasks', { id: t.id, time: '', end_time: '', remind: conv(t.rem, false) });
    const h = Math.min(22, new Date().getHours() + 1), p2 = n => String(n).padStart(2, '0');
    saveRow('tasks', { id: t.id, time: p2(h) + ':00', end_time: p2(h + 1) + ':00', remind: conv(t.rem, true) });
  };
  if ($('#td-t1')) $('#td-t1').onchange = e => { if (!e.target.value) return; const o = { id: t.id, time: e.target.value };
    if (t.end_time && t.end_time <= e.target.value) { const [hh, mm] = e.target.value.split(':').map(Number); o.end_time = String(Math.min(23, hh + 1)).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); }
    saveRow('tasks', o); };
  if ($('#td-t2')) $('#td-t2').onchange = e => saveRow('tasks', { id: t.id, end_time: e.target.value || '' });
  const remSave = () => {
    const list = $$('#rems .rem').map(el => { const r = { n: Math.max(0, parseInt($('.rn', el).value) || 0), u: $('.ru', el).value }; const a = $('.ra', el); if (a) r.at = a.value || '13:00'; return r; });
    saveRow('tasks', { id: t.id, remind: list });
  };
  $$('#rems .rn, #rems .ru, #rems .ra').forEach(el => el.onchange = remSave);
  $$('#rems [data-rdel]').forEach(b => b.onclick = () => { b.closest('.rem').remove(); remSave(); });
  if ($('#rem-add')) $('#rem-add').onclick = () => saveRow('tasks', { id: t.id, remind: [...t.rem, t.time ? { n: 30, u: 'min' } : { n: 0, u: 'd', at: '13:00' }] });
  if ($('#td-done-rep')) { $('#td-done-rep').onclick = () => toggleDone(t); $('#td-skip').onclick = () => toggleDone(t, true); }
  $$('[data-log]').forEach(el => el.onclick = () => { const l = I.task_log[el.dataset.log]; if (confirm(`Ištrinti įrašą „atlikta ${l.date}“ iš istorijos?`)) delRow('task_log', l.id); });
  $('#td-due').onchange = e => setDue(e.target.value);
  if ($('#td-due-x')) $('#td-due-x').onclick = () => setDue('');
  $$('[data-qd]').forEach(b => b.onclick = () => setDue(t.due === b.dataset.qd ? '' : b.dataset.qd));
  // žymos
  $$('[data-tt]').forEach(b => b.onclick = () => {
    const gid = +b.dataset.tt, ids = t.tagIds.includes(gid) ? t.tagIds.filter(x => x !== gid) : [...t.tagIds, gid];
    saveRow('tasks', { id: t.id, tags: ids });
  });
  $('#td-newtag').onclick = () => tagSheet(null, nid => saveRow('tasks', { id: t.id, tags: [...t.tagIds, nid] }));
  // aprašymas
  const no = $('#td-notes');
  autosize(no, 110); no.oninput = () => autosize(no, 110);
  no.onblur = async () => { if (no.value !== (t.notes || '')) { await saveRow('tasks', { id: t.id, notes: no.value }, true); toast('Aprašymas išsaugotas'); } };
  // sub-užduotys
  $$('[data-sck]').forEach(b => b.onclick = () => { const s = I.subtasks[b.dataset.sck]; saveRow('subtasks', { id: s.id, done: s.done ? 0 : 1 }); });
  $$('[data-sti]').forEach(inp => {
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
    inp.onblur = () => { const s = I.subtasks[inp.dataset.sti], v = inp.value.trim(); if (!v) { inp.value = s.title; return; } if (v !== s.title) saveRow('subtasks', { id: s.id, title: v }, true); };
  });
  $$('[data-sdel]').forEach(b => b.onclick = async () => { const s = I.subtasks[b.dataset.sdel]; await delRow('subtasks', s.id); toast('Ištrinta: ' + s.title, { label: 'Atšaukti', fn: () => saveRow('subtasks', { task_id: s.task_id, title: s.title, done: s.done, pos: s.pos }) }); });
  $('#sub-new').onsubmit = async e => {
    e.preventDefault();
    const inp = $('input', e.target), v = inp.value.trim(); if (!v) return;
    await saveRow('subtasks', { task_id: t.id, title: v });
    $('#sub-new input').focus();
  };
  longPressSort($('#subs'), '[data-sub]', () => true, order => act('order', { t: 'subtasks', ids: order.map(el => +el.dataset.sub) }));
  // failai
  $('#td-file').onchange = async e => {
    const fs = [...e.target.files]; if (!fs.length) return;
    for (const f of fs) { const uid = await uploadFile(f, 'Įkeliama: ' + f.name); await api('api/do/file_add', { upload: uid, orig_name: f.name, mime: f.type, task_id: t.id }); }
    await load(); toast(fs.length > 1 ? `Įkelta failų: ${fs.length}` : 'Įkelta');
  };
  $$('[data-file]').forEach(el => el.onclick = () => fileViewer(I.files[el.dataset.file]));
  // komentarai
  const cn = $('#com-new'), ct = $('textarea', cn);
  ct.oninput = () => autosize(ct);
  cn.onsubmit = async e => { e.preventDefault(); const v = ct.value.trim(); if (!v) return; await saveRow('comments', { task_id: t.id, text: v }); };
  $$('[data-com]').forEach(el => el.onclick = () => commentSheet(I.comments[el.dataset.com]));
};

const phoneName = sv => sv.replace(/^mobile_app_/, '').replace(/_/g, ' ');
function remRow(t, r, i) {
  const units = t.time ? [['min', 'min.'], ['val', 'val.'], ['d', 'd.'], ['sav', 'sav.']] : [['d', 'd.'], ['sav', 'sav.']];
  const when = t.time ? 'prieš' : (r.n === 0 ? 'tą dieną' : 'prieš,');
  return `<div class="rem"><input type="text" inputmode="numeric" class="rn" value="${esc(r.n)}">
    <select class="ru">${units.map(([v, l]) => `<option value="${v}" ${r.u === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <span class="muted">${when}</span>${t.time ? '' : `<input type="time" class="ra" value="${esc(r.at || '13:00')}">`}
    <button class="x-btn" data-rdel="${i}" aria-label="Pašalinti">×</button></div>`;
}
function repeatSheet(t) {
  const r = t.rep || { type: 'cal', every: 1, unit: 'w' };
  const first = t.due || T();
  sheet(`<h3>🔁 Kartojimas</h3><form id="rp" autocomplete="off">
    <div class="seg" id="rp-type"><button type="button" data-v="cal" class="${r.type !== 'after' ? 'on' : ''}">Pagal kalendorių</button><button type="button" data-v="after" class="${r.type === 'after' ? 'on' : ''}">Nuo atlikimo</button></div>
    <div class="muted small" id="rp-hint" style="margin:-4px 4px 12px"></div>
    <div class="row"><span style="font-weight:700">Kas</span><input type="text" inputmode="numeric" name="every" value="${esc(r.every)}" style="width:80px;text-align:center;font-weight:800">
      <select name="unit">${Object.entries({ d: 'dienas', w: 'savaites', m: 'mėnesius', y: 'metus' }).map(([k, l]) => `<option value="${k}" ${r.unit === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="chips" style="margin-top:10px">${[['1', 'd', 'Kasdien'], ['1', 'w', 'Kas savaitę'], ['2', 'w', 'Kas 2 sav.'], ['1', 'm', 'Kas mėnesį'], ['1', 'y', 'Kas metus']].map(([e, u, l]) => `<button type="button" class="chip" data-pre="${e}:${u}">${l}</button>`).join('')}</div>
    <label class="field" style="margin-top:12px"><span id="rp-dl">Kita data</span><input type="date" name="next" value="${esc(first)}"></label>
    <div class="card pad small" id="rp-prev" style="margin-top:12px"></div>
    <button class="btn primary block" style="margin-top:16px;min-height:50px">💾 Išsaugoti</button>
    ${t.rep ? '<button type="button" class="btn danger block" id="rp-off" style="margin-top:10px">Nebekartoti</button>' : ''}
  </form>`, () => {
    const f = $('#rp'); let type = r.type === 'after' ? 'after' : 'cal';
    const prev = () => {
      $('#rp-hint').textContent = type === 'cal' ? 'Fiksuotas grafikas, pvz. šiukšlių išvežimas – nesvarbu, kada pažymėsite.' : 'Kitas kartas skaičiuojamas nuo tos dienos, kai pažymėsite atlikta (pvz. filtro keitimas).';
      const ev = Math.max(1, parseInt(f.elements.every.value) || 1), u = f.elements.unit.value, d0 = f.elements.next.value;
      if (!d0) { $('#rp-prev').innerHTML = ''; return; }
      if (type === 'after') { $('#rp-prev').innerHTML = `Pirmą kartą: <b>${esc(longDate(d0))}</b>, vėliau – ${esc(repText({ type, every: ev, unit: u }).toLowerCase())}.`; return; }
      const ds_ = [d0]; let d = d0;
      for (let i = 0; i < 4; i++) { d = u === 'd' ? addDays(d, ev) : u === 'w' ? addDays(d, 7 * ev) : addMonthsS(d, u === 'm' ? ev : 12 * ev); ds_.push(d); }
      $('#rp-prev').innerHTML = 'Artimiausios datos:<br>' + ds_.map(x => `<b>${esc(DAYS_S[pd(x).getDay()])} ${esc(shortDate(x))}</b>`).join(' · ');
    };
    $$('#rp-type button').forEach(b => b.onclick = () => { type = b.dataset.v; $$('#rp-type button').forEach(x => x.classList.toggle('on', x === b)); prev(); });
    $$('[data-pre]').forEach(b => b.onclick = () => { const [e, u] = b.dataset.pre.split(':'); f.elements.every.value = e; f.elements.unit.value = u; prev(); });
    ['every', 'unit', 'next'].forEach(k => f.elements[k].addEventListener('input', prev));
    prev();
    f.onsubmit = async e => {
      e.preventDefault();
      const next = f.elements.next.value; if (!next) { toast('Nurodykite datą'); return; }
      const every = Math.max(1, parseInt(f.elements.every.value) || 1);
      await saveRow('tasks', { id: t.id, due: next, done: 0, repeat: { type, every, unit: f.elements.unit.value, next } });
      closeSheet();
    };
    if ($('#rp-off')) $('#rp-off').onclick = async () => { closeSheet(); await saveRow('tasks', { id: t.id, repeat: '' }); };
  });
}
const addMonthsS = (s, n) => { const d = pd(s), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return ds(d); };

function autosize(el, min = 0) { el.style.height = 'auto'; el.style.height = Math.max(min, el.scrollHeight + 2) + 'px'; }

function taskMenu(t) {
  sheet(`<h3>${esc(t.title)}</h3><div class="card list">
    <div class="li" id="tm-dup"><span class="ic">📄</span><span class="grow t">Kopijuoti užduotį</span></div>
    <div class="li" id="tm-del" style="color:var(--danger)"><span class="ic">🗑️</span><span class="grow t">Ištrinti užduotį</span></div></div>`, () => {
    $('#tm-dup').onclick = async () => {
      closeSheet();
      const r = await saveRow('tasks', { title: t.title + ' (kopija)', section_id: t.section_id, notes: t.notes, due: t.due || '', tags: t.tagIds }, true);
      for (const s of subsOf(t.id)) await api('api/do/save', { t: 'subtasks', row: { task_id: r.id, title: s.title, pos: s.pos } });
      await load(true); go('#task/' + r.id); toast('Nukopijuota');
    };
    $('#tm-del').onclick = async () => {
      if (!confirm('Ištrinti užduotį kartu su sub-užduotimis, failais ir komentarais?')) return;
      closeSheet(); await act('delete', { t: 'tasks', id: t.id }, true); go('#' + (UI.lastTab || 'list')); toast('Užduotis ištrinta');
    };
  });
}

function commentSheet(c) {
  formSheet({
    title: 'Komentaras · ' + stamp(c.created), values: c,
    fields: [{ k: 'text', label: 'Tekstas', type: 'textarea' }],
    onSave: async v => { await saveRow('comments', { id: c.id, text: v.text }); },
    onDelete: async () => { await delRow('comments', c.id); },
  });
}

// ---- failai
const isImg = f => /image\/(jpe?g|png|webp|gif)|\.(jpe?g|png|webp|gif)$/i.test((f.mime || '') + ' ' + f.filename);
const isVid = f => /video|\.(mp4|mov|webm)$/i.test((f.mime || '') + ' ' + f.filename);
const isPdf = f => /pdf/i.test((f.mime || '') + f.filename);
function fileIcon(f) { return isPdf(f) ? '📄' : isVid(f) ? '🎬' : isImg(f) ? '🖼️' : '📎'; }
function thumbHtml(f) {
  return `<div class="thumb" data-file="${f.id}" ${isImg(f) ? `style="background-image:url('${esc(fileUrl(f.filename))}')"` : ''}>${isImg(f) ? '' : `<span class="ft">${fileIcon(f)}</span>`}<span class="cap">${esc(f.orig_name || f.filename)}</span></div>`;
}
function fileViewer(f) {
  const url = fileUrl(f.filename);
  let body;
  if (isImg(f)) body = `<img src="${esc(url)}" alt="">`;
  else if (isVid(f)) body = `<video src="${esc(url)}" controls playsinline></video>`;
  else if (isPdf(f)) body = `<div id="pdfbox"><div class="muted center">Kraunama…</div></div>`;
  else body = `<div class="empty"><span class="big">${fileIcon(f)}</span>${esc(f.orig_name)}</div>`;
  sheet(`<h3>${esc(f.orig_name || f.filename)}</h3><div class="viewer">${body}</div>
    <div class="row"><a class="btn grow" href="${esc(url)}${url.includes('?') ? '&' : '?'}dl=1" download="${esc(f.orig_name || f.filename)}">⬇ Atsisiųsti</a><a class="btn grow" href="${esc(url)}" target="_blank" rel="noopener">↗ Atidaryti</a></div>
    <button class="btn danger block" id="fv-del" style="margin-top:10px">Ištrinti failą</button>`, () => {
    if (isPdf(f)) renderPdf(url, $('#pdfbox'));
    $('#fv-del').onclick = async () => { if (!confirm('Ištrinti failą?')) return; closeSheet(); await delRow('files', f.id); };
  });
}
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
    el.innerHTML = `<div class="empty"><span class="big">📄</span>PDF nepavyko parodyti čia. Spauskite „Atidaryti“ arba „Atsisiųsti“.<div class="small">${esc(e.message || e)}</div></div>`;
  }
}

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

// ============================================================ NUSTATYMAI
routes.settings = () => {
  setTop('Nustatymai', { back: true });
  const keep = S.settings.done_keep_days ?? 1;
  view.innerHTML = `
  <h2>📁 Sekcijos <button class="btn small" id="st-sec-new">＋ Nauja</button></h2>
  <div class="card list">${sectionsSorted().map((s, i, a) => `<div class="li"><span class="grow t" data-sedit="${s.id}">${esc(secLabel(s))} <span class="muted small">${tasksOf(s.id).filter(t => !t.done).length}</span></span>
    <button class="icon-btn mv" data-smv="${s.id}:-1" ${i === 0 ? 'disabled style="opacity:.25"' : ''}>▲</button><button class="icon-btn mv" data-smv="${s.id}:1" ${i === a.length - 1 ? 'disabled style="opacity:.25"' : ''}>▼</button></div>`).join('')}</div>

  <h2>🏷️ Žymos <button class="btn small" id="st-tag-new">＋ Nauja</button></h2>
  <div class="card list">${tagsSorted().map((g, i, a) => `<div class="li"><span class="grow t" data-tedit="${g.id}">${esc(tagLabel(g))}</span>
    <button class="icon-btn mv" data-tmv="${g.id}:-1" ${i === 0 ? 'disabled style="opacity:.25"' : ''}>▲</button><button class="icon-btn mv" data-tmv="${g.id}:1" ${i === a.length - 1 ? 'disabled style="opacity:.25"' : ''}>▼</button></div>`).join('') || '<div class="empty" style="padding:16px">Žymų dar nėra</div>'}</div>

  <h2>✓ Atliktos užduotys</h2>
  <div class="card pad"><label class="field"><span>Kiek laiko rodyti perbrauktas sąraše</span><select id="st-keep">
    ${[[0, 'Tik tą dieną'], [1, 'Iki kitos dienos pabaigos'], [3, '3 dienas'], [7, 'Savaitę']].map(([v, l]) => `<option value="${v}" ${keep == v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="muted small" style="margin-top:6px">Vėliau jos pasislepia, bet visada pasiekiamos sekcijos apačioje („Rodyti atliktas“).</div></div>

  <h2>🔔 Priminimai telefone</h2>
  <div class="card pad stack" id="st-nt">
    <div class="muted small">Kada priminti, nustatote kiekvienai užduočiai atskirai – užduoties lange <b>🔔 Priminimai telefone</b>. Pranešime yra mygtukas <b>✓ Atlikta</b>, o užduočiai tą dieną – ir <b>Rytoj</b> (atidėti dienai).</div>
    <div><div class="muted small" style="margin:0 2px 6px">Į kuriuos telefonus siųsti</div><div id="st-phones" class="muted small">Ieškoma telefonų…</div></div>
    <label class="row"><span class="grow"><b>Priminti pavėluotas</b><br><span class="muted small">kasdien užduoties laiku (arba 13:00), kol nepažymėsite; tik užduotims su priminimais</span></span><span class="switch"><input type="checkbox" id="st-ov" ${S.settings.notify_overdue !== false ? 'checked' : ''}><i></i></span></label>
    <button class="btn block" id="st-test">📨 Išbandyti pranešimą</button>
    <div class="muted small" id="st-ntstat"></div>
  </div>

  <h2>🏠 Home Assistant</h2>
  <div class="card pad stack" id="st-ha">
    <label class="field"><span>Kiek dienų į priekį rodyti HA kortelėje</span><select id="st-hadays">${[3, 7, 14, 30].map(v => `<option value="${v}" ${(S.settings.ha_days ?? 7) == v ? 'selected' : ''}>${v} d.</option>`).join('')}</select></label>
    <div class="muted small" id="st-hastat">Tikrinama…</div>
    <button class="btn block" id="st-card">📋 Kortelė pagrindiniam langui</button>
    <button class="btn block" id="st-cal">📅 Rodyti HA kalendoriuje</button>
  </div>

  <h2>💾 Duomenys</h2>
  <div class="card list">
    <a class="li go" href="api/export" download><span class="ic">⬇️</span><div class="grow"><div class="t">Atsisiųsti atsarginę kopiją</div><div class="s">Viskas su failais, ZIP</div></div></a>
    <label class="li go"><span class="ic">♻️</span><div class="grow"><div class="t">Atkurti iš kopijos</div><div class="s">Dabartiniai duomenys bus pakeisti</div></div><input type="file" id="st-restore" accept=".zip" hidden></label>
    <label class="li go"><span class="ic">📥</span><div class="grow"><div class="t">Importuoti užduotis (.json)</div><div class="s">Tik papildo, nieko netrina</div></div><input type="file" id="st-import" accept=".json,application/json" hidden></label>
  </div>
  <p class="muted small center" style="margin-top:18px">Ūkis 1.3.4 · Duomenys patenka į Home Assistant atsargines kopijas</p>`;
  $('#st-sec-new').onclick = () => sectionSheet();
  $('#st-tag-new').onclick = () => tagSheet();
  $$('[data-sedit]').forEach(el => el.onclick = () => sectionMenu(I.sections[el.dataset.sedit]));
  $$('[data-tedit]').forEach(el => el.onclick = () => tagSheet(I.tags[el.dataset.tedit]));
  const mover = (list, t) => b => b.onclick = () => {
    const [id, d] = b.dataset[t === 'sections' ? 'smv' : 'tmv'].split(':').map(Number);
    const ids = list().map(x => x.id), i = ids.indexOf(id); ids.splice(i, 1); ids.splice(i + d, 0, id);
    act('order', { t, ids });
  };
  $$('[data-smv]').forEach(mover(sectionsSorted, 'sections'));
  $$('[data-tmv]').forEach(mover(tagsSorted, 'tags'));
  $('#st-keep').onchange = e => act('settings_save', { done_keep_days: +e.target.value });
  $('#st-hadays').onchange = e => act('settings_save', { ha_days: +e.target.value });
  // priminimai
  const ntSave = o => act('settings_save', o, true).then(() => toast('Išsaugota'));
  $('#st-ov').onchange = e => ntSave({ notify_overdue: e.target.checked });
  api('api/notify_status').then(n => {
    const sel = S.settings.notify_services || [];
    const all = [...new Set([...n.services, ...sel])];
    $('#st-phones').innerHTML = !n.ha ? 'Veikia ne Home Assistant viduje.' : all.length
      ? `<div class="chips" style="flex-wrap:wrap">${all.map(sv => `<button type="button" class="chip ${sel.includes(sv) ? 'on' : ''}" data-ph="${esc(sv)}">📱 ${esc(phoneName(sv))}</button>`).join('')}</div>`
      : 'Telefonų nerasta. Įsidiekite Home Assistant programėlę telefone ir prisijunkite.';
    $$('[data-ph]').forEach(b => b.onclick = () => {
      const v = b.dataset.ph, cur = S.settings.notify_services || [];
      const next = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v];
      S.settings.notify_services = next; b.classList.toggle('on', next.includes(v)); ntSave({ notify_services: next });
    });
    $('#st-ntstat').innerHTML = n.error ? `⚠️ ${esc(n.error)}` : (n.ws ? '✓ Mygtukai pranešimuose veikia' : '') + (n.last_sent ? ` · paskutinis pranešimas ${esc(stamp(n.last_sent))}` : '');
  }).catch(() => { $('#st-phones').textContent = ''; });
  $('#st-test').onclick = async () => {
    if (!(S.settings.notify_services || []).length) return toast('Pirma pasirinkite telefoną');
    await api('api/do/notify_test', {}); toast('Išsiųsta – pažiūrėkite telefoną');
  };
  let HA = null;
  api('api/ha').then(h => {
    HA = h;
    $('#st-hastat').innerHTML = !h.ha ? 'Veikia ne Home Assistant viduje.' : h.error ? `⚠️ Klaida: ${esc(h.error)}` : `✓ Jutiklis <b>sensor.ukis_artimiausi</b> atnaujintas ${esc(stamp(h.last))}`;
  }).catch(() => { $('#st-hastat').textContent = ''; });
  $('#st-card').onclick = () => copySheet('Kortelė pagrindiniam langui', `HA skydelyje: <b>✏️ Redaguoti → ＋ Pridėti kortelę → Žymėjimas (Markdown) → Rodyti kodo redaktorių</b>, ištrinkite viską ir įklijuokite:`, CARD_YAML);
  $('#st-cal').onclick = () => {
    const path = HA ? HA.ics : 'calendar/….ics';
    copySheet('Rodyti HA kalendoriuje', `Visos užduotys su data (ir būsimi kartojimai) atsiras HA <b>Kalendoriuje</b>.<br><br>HA: <b>Nustatymai → Įrenginiai ir paslaugos → ＋ Pridėti integraciją → „Remote calendar“</b>. Pavadinimas – <b>Ūkis</b>, adresas:`, 'http://' + (HA && HA.host ? HA.host : 'local-ukis') + ':8099/' + path,
      `Jei nepriima, bandykite <b>http://&lt;HA IP&gt;:8767/${esc(path)}</b>. Kalendorius atsinaujina maždaug kas valandą.`);
  };
  $('#st-restore').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!confirm('Atkurti iš kopijos? Dabartiniai duomenys bus pakeisti.')) return;
    const uid = await uploadFile(f, 'Įkeliama kopija…'); await act('restore', { upload: uid }); toast('Atkurta');
  };
  $('#st-import').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const r = await act('import', { data: await f.text() }); toast(`Importuota: ${r.imported.uzduotys} užd., ${r.imported.sekcijos} nauj. sekc.`); }
    catch (err) { }
  };
};

const CARD_YAML = `type: markdown
title: 🏡 Ūkis
content: |
  {% set items = state_attr('sensor.ukis_artimiausi', 'items') or [] %}
  {% for i in items %}
  {{ '🔴' if i.dienos < 0 else '🟠' if i.dienos == 0 else '🟡' if i.dienos == 1 else '⚪' }} **{{ i.tekstas }}{{ ' ' ~ i.laikas if i.laikas }}** · {{ i.emoji }} {{ i.pavadinimas }}

  {% else %}
  ✓ Artimiausiu metu nieko nėra
  {% endfor %}`;
function copySheet(title, intro, text, after) {
  sheet(`<h3>${esc(title)}</h3><p>${intro}</p><textarea id="cp-t" readonly wrap="off" style="white-space:pre;overflow-x:auto;font-family:monospace;font-size:13px;min-height:${text.includes('\n') ? 220 : 70}px">${esc(text)}</textarea>
    <button class="btn primary block" id="cp-b" style="margin-top:10px">📋 Kopijuoti</button>${after ? `<p class="muted small">${after}</p>` : ''}`, () => {
    $('#cp-b').onclick = async () => {
      const ta = $('#cp-t');
      try { await navigator.clipboard.writeText(text); } catch (e) { ta.select(); document.execCommand('copy'); }
      toast('Nukopijuota');
    };
  });
}

// ============================================================ tempimas (ilgas paspaudimas)
let DRAGGING = false;
function longPressSort(box, sel, canDrag, onDone) {
  if (!box) return;
  let timer = null, drag = null, idx = 0, target = 0, startY = 0, sx = 0, sy = 0, items = [], centers = [], h = 0, suppress = false;
  const begin = el => {
    items = $$(sel, box); idx = items.indexOf(el); target = idx; drag = el; DRAGGING = true;
    centers = items.map(r => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; });
    h = el.offsetHeight; startY = sy; el.classList.add('dragging'); navigator.vibrate && navigator.vibrate(20);
  };
  const move = y => {
    const dy = y - startY, c = centers[idx] + dy;
    drag.style.transform = `translateY(${dy}px)`;
    target = items.reduce((n, r, j) => n + (j !== idx && centers[j] < c ? 1 : 0), 0);
    if (items[0] && items[0].dataset.sec) target = Math.max(1, target); // ne virš pirmos sekcijos
    items.forEach((r, j) => { if (j === idx) return; let sh = 0; if (j > idx && j <= target) sh = -h; if (j < idx && j >= target) sh = h; r.style.transform = sh ? `translateY(${sh}px)` : ''; r.style.transition = 'transform .12s'; });
    if (y < 90) window.scrollBy(0, -10); else if (y > innerHeight - 150) window.scrollBy(0, 10);
  };
  const finish = () => {
    clearTimeout(timer); timer = null;
    if (!drag) return;
    items.forEach(r => { r.style.transform = ''; r.style.transition = ''; }); drag.classList.remove('dragging');
    const order = [...items]; const [m] = order.splice(idx, 1); order.splice(target, 0, m);
    const changed = target !== idx; drag = null; DRAGGING = false; suppress = true; setTimeout(() => suppress = false, 400);
    if (changed) onDone(order);
  };
  const press = (x, y, t) => {
    if (t.closest('button, select, input, textarea, form')) return;
    const el = t.closest(sel); if (!el || !box.contains(el) || !canDrag(el)) return;
    sx = x; sy = y; clearTimeout(timer); timer = setTimeout(() => begin(el), 420);
  };
  // rankenėlė: tempimas prasideda iš karto (patikima ir HA programėlėje)
  const grab = (x, y, t) => {
    const g = t.closest('.grip'); if (!g || !box.contains(g)) return false;
    const el = g.closest(sel); if (!el || !canDrag(el)) return false;
    sx = x; sy = y; clearTimeout(timer); timer = null; begin(el); return true;
  };
  box.addEventListener('touchstart', e => { if (grab(e.touches[0].clientX, e.touches[0].clientY, e.target)) { e.preventDefault(); return; } press(e.touches[0].clientX, e.touches[0].clientY, e.target); }, { passive: false });
  box.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (!drag) { if (Math.abs(t.clientY - sy) > 8 || Math.abs(t.clientX - sx) > 8) { clearTimeout(timer); timer = null; } return; }
    e.preventDefault(); move(t.clientY);
  }, { passive: false });
  box.addEventListener('touchend', finish); box.addEventListener('touchcancel', finish);
  box.addEventListener('mousedown', e => {
    if (grab(e.clientX, e.clientY, e.target)) e.preventDefault(); else press(e.clientX, e.clientY, e.target);
    const mm = ev => { if (!drag) { if (Math.abs(ev.clientY - sy) > 6) clearTimeout(timer); return; } ev.preventDefault(); move(ev.clientY); };
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); finish(); };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
  });
  box.addEventListener('contextmenu', e => { if (e.target.closest(sel) && !e.target.closest('input, textarea')) e.preventDefault(); });
  box.addEventListener('click', e => { if (suppress) { e.stopPropagation(); e.preventDefault(); } }, true);
}

// ============================================================ formos ir apatinis langas
function fieldHtml(f, v) {
  const val = v ?? '';
  const cls = f.half ? '' : 'full';
  const name = `name="${f.k}"`;
  let inner;
  if (f.type === 'select') inner = `<select ${name}>${f.opts.map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol || '—')}</option>`; }).join('')}</select>`;
  else if (f.type === 'textarea') inner = `<textarea ${name} placeholder="${esc(f.ph || '')}">${esc(val)}</textarea>`;
  else inner = `<input type="${f.type || 'text'}" ${name} value="${esc(val)}" placeholder="${esc(f.ph || '')}">`;
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
      for (const f of o.fields) { const el = form.elements[f.k]; if (el) out[f.k] = el.value; }
      const btn = $('button.primary', form); btn.disabled = true;
      try { const r = await o.onSave(out, form); if (r !== false) closeSheet(); }
      catch (err) { console.error(err); }
      finally { btn.disabled = false; }
    };
    const del = $('#fs-del');
    if (del) del.onclick = async () => { if (!confirm('Tikrai ištrinti?')) return; const r = await o.onDelete(); if (r !== false) closeSheet(); };
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
