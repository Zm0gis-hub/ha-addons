'use strict';
let S = null;          // paskutinė serverio būsena
let openId = null;     // atidarytas prekės lapas
let sheetKind = null;  // 'item' | 'settings'

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS = {
  in:      { ico: '✅', pill: 'YRA!', text: 'Yra sandėlyje' },
  pre:     { ico: '🟢', pill: 'Galima užsakyti', text: 'Galima užsakyti iš anksto' },
  out:     { ico: '❌', pill: 'Nėra', text: 'Nėra / išparduota' },
  blocked: { ico: '🛡️', pill: 'Blokuoja', text: 'Parduotuvė blokuoja automatinį tikrinimą' },
  error:   { ico: '⚠️', pill: 'Klaida', text: 'Nepavyko patikrinti' },
  unknown: { ico: '❔', pill: 'Neaišku', text: 'Puslapyje nerasta prekės būsena' },
  new:     { ico: '⏳', pill: 'Tikrinama', text: 'Dar netikrinta' },
};

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (r.status === 401) { location.href = 'login'; throw new Error('Reikia PIN'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ('Klaida ' + r.status));
  return d;
}
const act = async (name, body = {}) => { const d = await api('api/do/' + name, body); S = d.state; render(); return d; };

function toast(t, ms = 2600) {
  const el = $('#toast'); el.textContent = t; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, ms);
}

function ago(ts) {
  if (!ts) return 'dar niekada';
  const s = Math.max(0, Math.round(S.now - ts));
  if (s < 60) return 'ką tik';
  const m = Math.round(s / 60);
  if (m < 60) return `prieš ${m} min.`;
  const h = Math.floor(m / 60);
  if (h < 24) return `prieš ${h} val.`;
  return new Date(ts * 1000).toLocaleString('lt-LT', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function inTxt(ts) {
  const s = Math.round(ts - S.now);
  if (s <= 30) return 'tuoj';
  const m = Math.round(s / 60);
  return m < 60 ? `po ${m} min.` : `po ${Math.round(m / 60)} val.`;
}
const euro = p => p == null ? '' : p.toFixed(2).replace('.', ',') + ' €';
const title = it => it.custom_name || it.name || it.url;
const phoneName = s => s.replace(/^mobile_app_/, '').replace(/_/g, ' ');

// ------------------------------------------------------------ sveikata
function healthIssues() {
  const bad = [], warn = [];
  if (!S.ha) bad.push('Nėra ryšio su Home Assistant – pranešimai nebus siunčiami.');
  else {
    if (!S.phones.length) bad.push('Nerastas nė vienas telefonas su HA programėle' + (S.all_phones_error ? ` (${S.all_phones_error})` : '') + '.');
    else if (!S.targets.length) bad.push('Nepasirinktas nė vienas telefonas (⚙️ Nustatymai).');
    if (S.health.last_send_err) bad.push('Paskutinis siuntimas nepavyko: ' + S.health.last_send_err);
    if (!S.ws) warn.push('Mygtukas „Nutildyti“ pranešime kol kas neveikia (jungiamasi prie HA). Nutildyti galima čia.');
  }
  if (S.health.watchdog_sent) bad.push('Jau ilgiau nei 30 min. nepavyksta patikrinti nė vienos parduotuvės.');
  if (!S.health.last_test) warn.push('Dar nebandytas pranešimas – paspausk ⚙️ → „Bandomasis pranešimas“.');
  return { bad, warn };
}

function renderHealth() {
  const { bad, warn } = healthIssues();
  const el = $('#health');
  const phones = S.targets.length ? S.targets.map(phoneName).join(', ') : '—';
  if (bad.length) {
    el.innerHTML = `<div class="card health bad"><span class="dot">🔴</span><div><b>Pranešimai gali neveikti</b>
      <ul>${bad.concat(warn).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>`;
  } else if (warn.length) {
    el.innerHTML = `<div class="card health warn"><span class="dot">🟡</span><div><b>Veikia, bet patikrink</b>
      <ul>${warn.map(x => `<li>${esc(x)}</li>`).join('')}</ul><div class="small muted" style="margin-top:4px">Pranešimai: ${esc(phones)}</div></div></div>`;
  } else {
    el.innerHTML = `<div class="card health"><span class="dot">🟢</span><div><b>Viskas veikia</b>
      <span class="small muted">Pranešimai: ${esc(phones)} · bandyta ${esc(ago(Date.parse(S.health.last_test) / 1000))}</span></div></div>`;
  }
}

// ------------------------------------------------------------ sąrašas
function sortKey(it) {
  const order = { in: 0, pre: 0, new: 1, out: 2, unknown: 3, error: 3, blocked: 4 };
  return (it.enabled ? 0 : 10) + (order[it.status] ?? 5);
}

function itemHtml(it) {
  const st = STATUS[it.status] || STATUS.unknown;
  const checking = S.checking === it.id;
  const meta = [euro(it.price),
    checking ? 'tikrinama…' : `tikrinta ${ago(it.checked_at)}`,
    it.enabled ? (checking ? '' : `kitas ${inTxt(it.next_at)}`) : 'sustabdyta'].filter(Boolean).join(' · ');
  let note = '';
  if (it.probe === 'blocked') note = '🛡️ Paskutinį kartą parduotuvė užblokavo – rodoma ankstesnė būsena';
  else if (it.probe === 'error') note = '⚠️ Paskutinis tikrinimas nepavyko – rodoma ankstesnė būsena';
  else if (it.status === 'blocked') note = 'Apsauga nuo botų – tikrinama kas 30 min., jei kartais praleistų';
  else if ((it.status === 'in' || it.status === 'pre') && it.muted) note = '🔕 Nutildyta';
  return `<div class="card item s-${it.status} ${it.enabled ? '' : 'off'}" data-id="${it.id}">
    <div class="badge">${st.ico}</div>
    <div class="body"><div class="name">${esc(title(it))}</div><div class="meta">${esc(meta)}</div>
      ${note ? `<div class="note">${esc(note)}</div>` : ''}</div>
    <span class="pill">${esc(st.pill)}</span></div>`;
}

function renderList() {
  const items = [...S.items].sort((a, b) => sortKey(a) - sortKey(b) || a.shop.localeCompare(b.shop) || a.id - b.id);
  const avail = items.filter(it => it.enabled && (it.status === 'in' || it.status === 'pre'));
  const rest = items.filter(it => !avail.includes(it));
  let html = '';
  if (avail.length) html += `<div class="shop-h" style="color:var(--ok)">🎉 Galima pirkti</div>` + avail.map(itemHtml).join('');
  const shops = [...new Set(rest.map(it => it.shop))];
  for (const sh of shops) html += `<div class="shop-h">${esc(sh)}</div>` + rest.filter(it => it.shop === sh).map(itemHtml).join('');
  if (!items.length) html = '<p class="muted center">Dar nieko nesekama. Įklijuok prekės nuorodą viršuje.</p>';
  $('#list').innerHTML = html;
  $('#foot').textContent = `Tikrinama kas ${S.settings.interval} min. Sekama prekių: ${items.filter(i => i.enabled).length}.`;
  $('#btn-check').classList.toggle('spin', S.checking != null);
}

function render() {
  if (!S) return;
  renderHealth();
  renderList();
  if (sheetKind === 'item') {
    if (S.items.some(i => i.id === openId)) itemSheet(openId, true); else closeSheet();
  }
}

// ------------------------------------------------------------ lapai
function openSheet(html, kind) {
  sheetKind = kind;
  $('#sheet').innerHTML = html; $('#sheet').hidden = false; $('#sheet-bg').hidden = false;
}
function closeSheet() { sheetKind = null; openId = null; $('#sheet').hidden = true; $('#sheet-bg').hidden = true; }
$('#sheet-bg').onclick = closeSheet;

function itemSheet(id, refresh) {
  const it = S.items.find(i => i.id === id); if (!it) return;
  openId = id;
  const st = STATUS[it.status] || STATUS.unknown;
  const keepResult = refresh ? ($('#sim-res')?.outerHTML || '') : '';
  const keepName = refresh && document.activeElement?.id === 'f-name' ? document.activeElement.value : null;
  if (refresh && keepName !== null) return; // nerašom ant viršaus, kol vedamas pavadinimas
  const hist = (it.history || []).slice(0, 8).map(h =>
    `<li>${esc(new Date(h.at).toLocaleString('lt-LT', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))} – ${esc((STATUS[h.status] || STATUS.unknown).text)}</li>`).join('');
  openSheet(`<div class="stack">
    <div><h2>${st.ico} ${esc(title(it))}</h2>
      <div class="muted small">${esc(it.shop)}${it.price != null ? ' · ' + euro(it.price) : ''} · ${esc(st.text)}</div>
      ${it.error ? `<div class="note">${esc(it.error)}${it.http ? ` (HTTP ${it.http})` : ''}</div>` : ''}</div>
    <a class="btn primary block center" style="text-decoration:none" href="${esc(it.url)}" target="_blank" rel="noopener">🛒 Atidaryti parduotuvėje</a>
    <div class="row">
      <button class="btn" id="b-now">⟳ Tikrinti dabar</button>
      <button class="btn" id="b-pause">${it.enabled ? '⏸ Sustabdyti' : '▶ Tęsti'}</button>
    </div>
    ${(it.status === 'in' || it.status === 'pre') ? `<button class="btn block" id="b-mute">${it.muted ? '🔔 Vėl priminti' : '🔕 Nutildyti priminimus'}</button>` : ''}
    <button class="btn block" id="b-sim">🧪 Imituoti atsiradimą (bandymas)</button>
    ${keepResult || '<div id="sim-res" hidden></div>'}
    <p class="small muted" style="margin:0">Imitacija išsiunčia tikrą „Atsirado!“ pranešimą su šios prekės nuoroda į visus telefonus – taip patikrinsi, ar ateina garsas ir ar paspaudus atsidaro parduotuvė. Prekės būsena nesikeičia.</p>
    <label class="field">Pavadinimas (nebūtina)<input id="f-name" value="${esc(it.custom_name)}" placeholder="${esc(it.name || 'Automatinis')}"></label>
    <h3>Istorija</h3>
    ${hist ? `<ul class="hist">${hist}</ul>` : '<p class="small muted" style="margin:0">Būsena dar nesikeitė.</p>'}
    <div class="small muted" style="word-break:break-all">${esc(it.url)}</div>
    <button class="btn danger block" id="b-del">🗑 Nebesekti</button>
  </div>`, 'item');
  $('#b-now').onclick = () => act('check_now', { id }).then(() => toast('Tikrinama…'));
  $('#b-pause').onclick = () => act('update', { id, enabled: !it.enabled });
  if ($('#b-mute')) $('#b-mute').onclick = () => act('update', { id, muted: !it.muted });
  $('#f-name').onchange = e => act('update', { id, custom_name: e.target.value });
  $('#b-del').onclick = () => { if (confirm('Nebesekti šios prekės?')) act('delete', { id }).then(closeSheet); };
  $('#b-sim').onclick = async e => {
    e.target.disabled = true;
    const box = $('#sim-res');
    try {
      const d = await act('simulate', { id });
      itemSheet(id);
      showResult($('#sim-res'), true, `Išsiųsta į ${d.sent} telefon${d.sent === 1 ? 'ą' : 'us'}. Pažiūrėk telefoną: ar suskambo ir ar paspaudus atsidaro parduotuvė?` + (d.errors.length ? ' Dalis klaidų: ' + d.errors.join('; ') : ''));
    } catch (err) { showResult(box, false, err.message); e.target.disabled = false; }
  };
}

function showResult(el, ok, text) {
  if (!el) return;
  el.className = 'result ' + (ok ? 'ok' : 'bad'); el.hidden = false; el.textContent = (ok ? '✓ ' : '✗ ') + text;
}

function settingsSheet() {
  const s = S.settings;
  const all = s.services === null;
  const phones = S.phones.map(p => `<label class="check"><input type="checkbox" class="ph" value="${esc(p)}" ${all || (s.services || []).includes(p) ? 'checked' : ''} ${all ? 'disabled' : ''}><span>📱 ${esc(phoneName(p))}</span></label>`).join('')
    || `<p class="small" style="color:var(--danger)">Nerastas nė vienas telefonas. Telefone įdiekite Home Assistant programėlę ir prisijunkite prie savo HA.</p>`;
  const opt = (v, cur, txt) => `<option value="${v}" ${+cur === v ? 'selected' : ''}>${txt}</option>`;
  openSheet(`<div class="stack">
    <h2>⚙️ Nustatymai</h2>
    <h3>🔔 Pranešimų patikra</h3>
    <button class="btn primary block" id="b-test">Siųsti bandomąjį pranešimą</button>
    <div id="test-res" hidden></div>
    <p class="small muted" style="margin:0">Paskutinis sėkmingas siuntimas: ${esc(S.health.last_send_ok ? ago(Date.parse(S.health.last_send_ok) / 1000) : 'dar nebuvo')}.
      Pirmą kartą gavus pranešimą telefone atsiras kanalas „Sekiklis – prekė atsirado“ – jį galima nustatyti, kad skambėtų net tyliu režimu
      (telefone: Nustatymai → Programos → Home Assistant → Pranešimai).</p>
    <h3>📱 Kur siųsti</h3>
    <div class="card group">
      <label class="check"><input type="checkbox" id="ph-all" ${all ? 'checked' : ''}><span><b>Visi telefonai</b> (ir nauji, kai atsiras)</span></label>
      ${phones}
      <label class="check"><input type="checkbox" id="persist" ${s.persistent ? 'checked' : ''}><span>🏠 Dar ir HA pranešimų skiltyje (varpelis)</span></label>
    </div>
    <h3>⏱ Tikrinimas</h3>
    <div class="row">
      <label class="field">Tikrinti kas<select id="interval">${[3, 5, 10, 15, 30].map(v => opt(v, s.interval, v + ' min.')).join('')}</select></label>
      <label class="field">Kartoti pranešimą kas<select id="rep-every">${[5, 10, 15, 30].map(v => opt(v, s.repeat_every, v + ' min.')).join('')}</select></label>
    </div>
    <label class="field">Kiek kartų priminti, kol nenutildysi<select id="rep-max">${[1, 3, 6, 10, 20].map(v => opt(v, s.repeat_max, v + (v === 1 ? ' (tik vieną)' : ' kartų'))).join('')}</select></label>
    <div class="card group">
      <label class="check"><input type="checkbox" id="watchdog" ${s.watchdog ? 'checked' : ''}><span>🐕 Pranešti, jei sekiklis 30 min. nebegali patikrinti parduotuvių</span></label>
    </div>
    <button class="btn block" id="b-close">Uždaryti</button>
  </div>`, 'settings');
  const saveSvc = () => {
    if ($('#ph-all').checked) return act('settings', { services: null }).then(settingsSheet);
    return act('settings', { services: [...document.querySelectorAll('.ph:checked')].map(x => x.value) });
  };
  $('#ph-all').onchange = e => e.target.checked ? saveSvc() :
    act('settings', { services: S.phones.slice() }).then(settingsSheet);
  document.querySelectorAll('.ph').forEach(x => x.onchange = saveSvc);
  $('#persist').onchange = e => act('settings', { persistent: e.target.checked });
  $('#watchdog').onchange = e => act('settings', { watchdog: e.target.checked });
  $('#interval').onchange = e => act('settings', { interval: +e.target.value }).then(() => toast('Išsaugota'));
  $('#rep-every').onchange = e => act('settings', { repeat_every: +e.target.value });
  $('#rep-max').onchange = e => act('settings', { repeat_max: +e.target.value });
  $('#b-close').onclick = closeSheet;
  $('#b-test').onclick = async e => {
    e.target.disabled = true; e.target.textContent = 'Siunčiama…';
    try {
      const d = await act('test', { persistent: $('#persist').checked });
      settingsSheet();
      showResult($('#test-res'), true, `Išsiųsta į ${d.sent} telefon${d.sent === 1 ? 'ą' : 'us'}. Jei telefone pranešimo nematai per minutę – patikrink, ar Home Assistant programėlei leisti pranešimai.` + (d.errors.length ? ' Dalis klaidų: ' + d.errors.join('; ') : ''));
    } catch (err) {
      showResult($('#test-res'), false, err.message);
      e.target.disabled = false; e.target.textContent = 'Siųsti bandomąjį pranešimą';
    }
  };
}

// ------------------------------------------------------------ įvykiai
$('#list').onclick = e => { const c = e.target.closest('.item'); if (c) itemSheet(+c.dataset.id); };
$('#btn-settings').onclick = settingsSheet;
$('#btn-check').onclick = () => act('check_now').then(() => toast('Tikrinama visa…'));
$('#add').onsubmit = async e => {
  e.preventDefault();
  const inp = $('#add-url');
  try { await act('add', { url: inp.value }); inp.value = ''; toast('Pridėta – tuoj patikrinsiu'); }
  catch (err) { toast(err.message, 4000); }
};

async function refresh() {
  try { S = await api('api/state'); if (sheetKind !== 'settings') render(); else { renderHealth(); renderList(); } }
  catch (e) { if (!S) $('#list').innerHTML = `<p class="center" style="color:var(--danger)">${esc(e.message)}</p>`; }
}
refresh();
setInterval(refresh, 8000);
