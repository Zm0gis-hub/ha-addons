/* Sveikata – galvos skausmų dienoraštis ir išgerto vandens sekimas */
'use strict';

// ============================================================ pagalbinės
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
let S = null;   // būsena (tik šio profilio)
let I = {};     // id -> įrašas
const UI = (() => { try { return JSON.parse(localStorage.getItem('sveikata_ui') || '{}'); } catch (e) { return {}; } })();
function saveUI() { try { localStorage.setItem('sveikata_ui', JSON.stringify(UI)); } catch (e) { } }

const MONTHS = ['Sausis', 'Vasaris', 'Kovas', 'Balandis', 'Gegužė', 'Birželis', 'Liepa', 'Rugpjūtis', 'Rugsėjis', 'Spalis', 'Lapkritis', 'Gruodis'];
const MONTHS_G = ['sausio', 'vasario', 'kovo', 'balandžio', 'gegužės', 'birželio', 'liepos', 'rugpjūčio', 'rugsėjo', 'spalio', 'lapkričio', 'gruodžio'];
const WD = ['Pr', 'An', 'Tr', 'Kt', 'Pn', 'Št', 'Sk'];
const DAYS = ['sekmadienis', 'pirmadienis', 'antradienis', 'trečiadienis', 'ketvirtadienis', 'penktadienis', 'šeštadienis'];

// migrenos dienoraščio pasirinkimai (pagal gydytojų rekomenduojamus galvos skausmo dienoraščius)
const LOCS = ['Kairė pusė', 'Dešinė pusė', 'Abi pusės', 'Abi – kairė stipriau', 'Abi – dešinė stipriau', 'Kakta', 'Smilkiniai', 'Už akies', 'Pakaušis', 'Viršugalvis', 'Kaklas'];
const CHARS = ['Pulsuojantis', 'Spaudžiantis', 'Duriantis', 'Maudžiantis', 'Deginantis'];
const SYMPTOMS = ['Pykinimas', 'Vėmimas', 'Jautrumas šviesai', 'Jautrumas garsui', 'Jautrumas kvapams', 'Aura (regos)', 'Svaigulys',
  'Nuovargis', 'Kaklo įtampa', 'Sunku susikaupti', 'Ašarojimas / nosies užgulimas', 'Stiprėja judant'];
const TRIGGERS = ['Stresas', 'Per mažai miego', 'Per daug miego', 'Praleistas valgis', 'Per mažai vandens', 'Kofeinas (daug ar trūko)',
  'Alkoholis', 'Oro pokyčiai', 'Menstruacijos', 'Ekranas / kompiuteris', 'Ryški šviesa', 'Triukšmas', 'Kvapai', 'Fizinis krūvis', 'Kelionė', 'Maistas'];
const RELIEF = ['Miegas / poilsis', 'Tamsus kambarys', 'Šaltas kompresas', 'Šiltas kompresas', 'Vanduo', 'Kava', 'Gaivus oras', 'Masažas', 'Dušas'];
const KIND = { migrena: 'Migrena', itampos: 'Įtampos', kita: 'Kita', '': 'Nežinau' };
const IMPACT = { nepaveike: 'Nepaveikė', sumazejo: 'Sumažėjo darbingumas', negalejo: 'Teko gulėti' };
const MED_KINDS = {
  triptanas: 'Triptanas (sumatriptanas, eletriptanas…)', analgetikas: 'Nuskausminamasis (paracetamolis…)',
  nvnu: 'NVNU (ibuprofenas, naproksenas, aspirinas…)', kombinuotas: 'Kombinuotas (pvz. su kofeinu)',
  profilaktinis: 'Profilaktinis (vartojamas kasdien)', kita: 'Kita',
};
const EFFECT = { padejo: ['✅', 'Padėjo'], is_dalies: ['🟡', 'Iš dalies'], nepadejo: ['❌', 'Nepadėjo'], '': ['⏳', 'Dar nežinau'] };
const EMOJIS = ['🙂', '😊', '🧔', '👨', '👩', '👱‍♀️', '🌸', '⭐', '🌿', '🐻', '🐱', '🦊'];
const DRINK_EMOJIS = ['💧', '☕', '🍵', '🍋', '🧃', '🥛', '🥤', '🧋', '🍺', '🍷', '🥥', '🫖', '⚡', '🍹'];

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
  if (r.status === 409 && j.need_profile) { S = null; boot(); throw new Error('profile'); }
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
  const me = $('#me');
  me.hidden = false;
  me.innerHTML = `<span>${esc(S.profile.emoji || '🙂')}</span><span class="nm">${esc(S.profile.name)}</span>`;
  if (!noRender) render();
}

// sinchronizacija (pvz. pažymėta laikrodyje ar kitame įrenginyje)
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
const pd = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const ds = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const T = () => S.today;
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ds(d); };
const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);
const nowLocal = () => { const d = new Date(); return ds(d) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const hhmm = ts => (ts || '').slice(11, 16);
const dayNice = (s, withYear) => { if (!s) return ''; const d = pd(s); return `${withYear ? d.getFullYear() + ' m. ' : ''}${MONTHS_G[d.getMonth()]} ${d.getDate()} d.`; };
const dayRel = s => { const n = diffDays(s, T()); return n === 0 ? 'Šiandien' : n === 1 ? 'Vakar' : dayNice(s, s.slice(0, 4) !== T().slice(0, 4)); };
const tsNice = ts => ts ? `${dayRel(ts.slice(0, 10))}, ${hhmm(ts)}` : '';
const fmtMl = ml => ml >= 1000 ? (Math.round(ml / 100) / 10).toString().replace('.', ',') + ' l' : Math.round(ml) + ' ml';
const fmt1 = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
const durH = (a, b) => (new Date(b) - new Date(a)) / 3600000;
function durTxt(a, b) {
  const h = durH(a, b);
  if (!(h >= 0)) return '';
  if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min.';
  if (h < 48) { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return hh + ' val.' + (mm ? ' ' + mm + ' min.' : ''); }
  return fmt1(h / 24) + ' d.';
}
const lt = (a, b) => String(a || '').localeCompare(String(b || ''), 'lt', { sensitivity: 'base' });
const icol = i => i == null || i === '' ? 'var(--i0)' : i <= 3 ? 'var(--i1)' : i <= 6 ? 'var(--i2)' : 'var(--i3)';
const ilvl = i => `<span class="ilvl" style="background:${icol(i)}">${i == null || i === '' ? '?' : i}</span>`;

// ============================================================ navigacija
let route = [];
function go(h) { if (location.hash === '#' + h) render(); else location.hash = h; }
window.addEventListener('hashchange', () => { closeSheet(); render(); scrollTo(0, 0); });
$('#back').onclick = () => history.length > 1 ? history.back() : go('vanduo');

function setTop(title, actions = '', back = false) {
  $('#title').textContent = title;
  document.title = title === 'Sveikata' ? 'Sveikata' : title + ' · Sveikata';
  $('#top-actions').innerHTML = actions;
  $('#back').hidden = !back;
}

const VIEWS = {};
function render() {
  if (!S) return;
  $('#tabs').hidden = false;
  route = (location.hash.slice(1) || 'vanduo').split('/');
  const name = VIEWS[route[0]] ? route[0] : 'vanduo';
  const tab = { istorija: 'vanduo', epizodas: 'galva', laikrodis: 'nustatymai' }[name] || name;
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
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
function confirmSheet(text, okLabel, fn, sub = '') {
  openSheet(`<h3>${esc(text)}</h3>${sub ? `<p class="muted" style="margin:-6px 2px 0">${esc(sub)}</p>` : ''}<div class="sheet-actions"><button class="btn" data-x>Atšaukti</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`, el => {
    $('[data-x]', el).onclick = closeSheet;
    $('[data-ok]', el).onclick = async () => { closeSheet(); await fn(); };
  });
}

// anksčiau naudoti savi pasirinkimai – kad liktų sąraše
const usedVals = (col, base) => { const s = new Set(); S.episodes.forEach(e => (e[col] || []).forEach(v => { if (!base.includes(v)) s.add(v); })); return [...base, ...s]; };

function segHtml(id, opts, cur) {
  return `<div class="seg" id="${id}">${Object.entries(opts).map(([k, v]) => `<button type="button" data-v="${esc(k)}" class="${k === cur ? 'on' : ''}">${esc(v)}</button>`).join('')}</div>`;
}
function bindSeg(el, toggle) {
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const was = b.classList.contains('on');
    $$('button', el).forEach(x => x.classList.remove('on'));
    if (!(toggle && was)) b.classList.add('on');
  };
}
const segVal = el => $('button.on', el)?.dataset.v ?? null;

// ============================================================ duomenų išvestinės
const drinkTypes = () => S.drink_types.filter(t => !t.archived);
// rūšys (pvz. Kava → Americano, Cappuccino): t.parent = grupės id
const kidsOf = id => drinkTypes().filter(t => t.parent === id);
const parentOf = t => (t && t.parent && I.drink_types[t.parent] && !I.drink_types[t.parent].archived) ? I.drink_types[t.parent] : null;
const topTypes = () => drinkTypes().filter(t => !parentOf(t));
const isGroup = t => kidsOf(t.id).length > 0;
const leafTypes = () => drinkTypes().filter(t => !isGroup(t));
const meds = () => S.meds.filter(m => !m.archived);
const activeEp = () => S.episodes.find(e => !e.ended);
const dosesOf = eid => S.doses.filter(d => d.episode_id === eid);
const goal = () => S.profile.goal_ml || 2000;
function dayDrinks(day) { return S.drinks.filter(d => d.day === day); }
function dayTotal(day) {
  const st = S.days.find(x => x.day === day);
  return st ? st.ml : 0;
}
function caffeineOf(list) {
  return Math.round(list.reduce((a, d) => { const t = I.drink_types[d.type_id]; return a + (t && t.caffeine && t.ml ? t.caffeine * d.ml / t.ml : 0); }, 0));
}

function banner() {
  const a = activeEp();
  if (!a) return '';
  const ds_ = dosesOf(a.id);
  return `<div class="card banner"><div class="t"><b>Galvos skausmas ${ilvl(a.intensity)}</b><span class="small muted">nuo ${esc(tsNice(a.start))} · ${durTxt(a.start, nowLocal())}${ds_.length ? ' · 💊 ' + ds_.map(d => esc(I.meds[d.med_id]?.name || '?') + ' ' + hhmm(d.ts)).join(', ') : ''}</span></div>
    <div class="btns"><button class="btn small" data-bmed>💊 Vaistai</button><button class="btn small" data-bedit>✏️ Pildyti</button><button class="btn small primary" data-bend>✔ Praėjo</button></div></div>`;
}
function bindBanner() {
  const a = activeEp(); if (!a) return;
  $('[data-bmed]') && ($('[data-bmed]').onclick = () => medQuickSheet(a.id));
  $('[data-bedit]') && ($('[data-bedit]').onclick = () => episodeSheet(a, null, { step: a.intensity == null ? 0 : 1 }));
  $('[data-bend]') && ($('[data-bend]').onclick = () => endSheet(a));
}

// ============================================================ VANDUO
function ringSvg(val, max, color = 'var(--water)') {
  const r = 54, c = 2 * Math.PI * r, p = Math.min(1, max ? val / max : 0);
  return `<svg viewBox="0 0 128 128"><circle cx="64" cy="64" r="${r}" fill="none" stroke="var(--water-soft)" stroke-width="12"/>
    <circle class="rp" cx="64" cy="64" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" style="stroke-dasharray:${(c * p).toFixed(1)} ${c.toFixed(1)};opacity:${p > 0 ? 1 : 0}"/></svg>`;
}
// žiedas sklandžiai „prisipildo“ nuo ankstesnio kiekio iki naujo, skaičius keičiasi palaipsniui
let ringShown = null;
function animRing(total, g) {
  const el = $('.wtop .ring .rp'), num = $('.wtop .ring .c b');
  if (!el) return;
  const from = ringShown == null ? 0 : ringShown;
  ringShown = total;
  if (from === total || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = 2 * Math.PI * 54, pf = Math.min(1, from / g), pt = Math.min(1, total / g);
  el.style.transition = 'none';
  el.style.strokeDasharray = `${(c * pf).toFixed(1)} ${c.toFixed(1)}`;
  el.style.opacity = pf > 0 ? 1 : 0;
  el.getBoundingClientRect();
  el.style.transition = 'stroke-dasharray .8s cubic-bezier(.22,.9,.3,1), opacity .2s';
  requestAnimationFrame(() => { el.style.strokeDasharray = `${(c * pt).toFixed(1)} ${c.toFixed(1)}`; el.style.opacity = pt > 0 ? 1 : 0; });
  const t0 = performance.now();
  const tick = t => {
    const k = Math.min(1, (t - t0) / 800), e = 1 - Math.pow(1 - k, 3);
    num.textContent = fmtMl(Math.round((from + (total - from) * e) / 10) * 10);
    if (k < 1) requestAnimationFrame(tick); else num.textContent = fmtMl(total);
  };
  requestAnimationFrame(tick);
  if (total > from) { const rg = $('.wtop .ring'); rg.classList.remove('pulse'); rg.getBoundingClientRect(); rg.classList.add('pulse'); }
}

VIEWS.vanduo = () => {
  setTop('Vanduo');
  const t = T(), total = dayTotal(t), g = goal(), list = dayDrinks(t).slice().reverse();
  const allMl = list.reduce((a, d) => a + d.ml, 0), caf = caffeineOf(list);
  const left = Math.max(0, g - total);
  view.innerHTML = `${banner()}
  <div class="grid">
    <div>
      <div class="card wtop">
        <div class="ring">${ringSvg(total, g)}<div class="c"><b>${fmtMl(total)}</b><span>iš ${fmtMl(g)}</span></div></div>
        <div class="info stack">
          <div class="big">${total >= g ? '🎉 Dienos tikslas pasiektas!' : `Liko išgerti ${fmtMl(left)}`}</div>
          <div class="small muted">${Math.round(100 * total / g)} % tikslo${allMl !== total ? ` · iš viso gėrimų ${fmtMl(allMl)}` : ''}${caf ? ` · kofeino ~${caf} mg` : ''}</div>
          ${drinkSummary(list)}
        </div>
      </div>
      <div class="dgrid">${topTypes().map(dt => `<button class="dbtn" data-dt="${dt.id}"><span class="e">${esc(dt.emoji)}</span><span class="n">${esc(dt.name)}</span><span class="m">${isGroup(dt) ? 'pasirinkti ›' : `+${dt.ml} ml`}</span></button>`).join('')}
        <button class="dbtn other" id="d-other"><span class="e">＋</span><span class="n">Kitas kiekis</span><span class="m">ar laikas</span></button></div>
    </div>
    <div>
      <h2>Šiandien${list.length ? `<span class="sum">${list.length} kart.</span>` : ''}</h2>
      <div class="card list">${list.map(d => drinkRow(d)).join('') || '<div class="empty">Šiandien dar nieko neįrašyta.<br>Paspauskite gėrimą viršuje.</div>'}</div>
      <h2>Savaitė<a class="btn small" href="#istorija" style="margin-left:auto">📈 Istorija</a></h2>
      <div class="card chart">${barsSvg(7)}</div>
    </div>
  </div>`;
  bindBanner();
  $$('[data-dt]').forEach(b => b.onclick = () => { const t = I.drink_types[b.dataset.dt]; isGroup(t) ? pickSheet(t) : quickDrink(t.id); });
  $('#d-other').onclick = () => drinkSheet();
  bindDrinkRows();
  animRing(total, g);
};

function drinkSummary(list) {
  const per = {};
  list.forEach(d => { const t = I.drink_types[d.type_id], k = parentOf(t)?.id || d.type_id; per[k] = (per[k] || 0) + d.ml; });
  const parts = Object.entries(per).map(([tid, ml]) => { const t = I.drink_types[tid]; return `<span class="pill">${esc(t?.emoji || '🥤')} ${fmtMl(ml)}</span>`; });
  return parts.length ? `<div class="chips">${parts.join('')}</div>` : '';
}
function drinkRow(d) {
  const t = I.drink_types[d.type_id] || { emoji: '🥤', name: 'Gėrimas' };
  return `<div class="li" data-drink="${d.id}"><span class="tm">${hhmm(d.ts)}</span><span class="ico">${esc(t.emoji)}</span><div class="grow">${esc(t.name)}${d.src === 'laikrodis' ? ' <span class="small muted">⌚</span>' : d.src === 'pranesimas' ? ' <span class="small muted">🔔</span>' : ''}</div><span class="v">${d.ml} ml</span><button class="x" data-del="${d.id}" aria-label="Ištrinti">✕</button></div>`;
}
function bindDrinkRows() {
  $$('[data-del]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const d = I.drinks[b.dataset.del];
    await delRow('drinks', d.id);
    toast('Ištrinta', { label: 'Grąžinti', fn: () => saveRow('drinks', { type_id: d.type_id, ml: d.ml, ts: d.ts }) });
  });
  $$('[data-drink]').forEach(r => r.onclick = () => drinkSheet(I.drinks[r.dataset.drink]));
}
async function quickDrink(tid, ml) {
  const t = I.drink_types[tid];
  if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) { }
  const r = await act('drink', { type_id: tid, ml: ml || t.ml });
  toast(`+${ml || t.ml} ml ${t.emoji} ${t.name}`, { label: 'Atšaukti', fn: () => delRow('drinks', r.id) });
}

function pickSheet(g) {
  openSheet(`<h3>${esc(g.emoji)} ${esc(g.name)}</h3><div class="stack">
    <div class="dgrid pick">${kidsOf(g.id).map(t => `<button class="dbtn" data-k="${t.id}"><span class="e">${esc(t.emoji)}</span><span class="n">${esc(t.name)}</span><span class="m">+${t.ml} ml</span></button>`).join('')}</div>
    <div class="sheet-actions"><button class="btn" data-x>Atšaukti</button><button class="btn" id="pk-o">Kitas kiekis ar laikas</button></div></div>`, el => {
    $('[data-x]', el).onclick = closeSheet;
    $('#pk-o', el).onclick = () => { closeSheet(); drinkSheet(null, kidsOf(g.id)[0]?.id); };
    $$('[data-k]', el).forEach(b => b.onclick = () => { closeSheet(); quickDrink(+b.dataset.k); });
  });
}

function drinkSheet(d, preset) {
  const types = leafTypes();
  if (d && !types.some(t => t.id === d.type_id) && I.drink_types[d.type_id]) types.push(I.drink_types[d.type_id]);
  let tid = d ? d.type_id : (preset || types[0]?.id || 0);
  const amounts = [100, 150, 200, 250, 300, 330, 400, 500, 750, 1000];
  openSheet(`<h3>${d ? 'Gėrimas' : 'Įrašyti gėrimą'}</h3><div class="stack">
    <div class="chips" id="ds-t">${types.map(t => `<button type="button" class="chip ${t.id === tid ? 'on' : ''}" data-t="${t.id}">${esc(t.emoji)} ${esc(t.name)}</button>`).join('')}</div>
    <div><span class="lbl-s">Kiekis</span><div class="chips" id="ds-a">${amounts.map(a => `<button type="button" class="chip" data-a="${a}">${fmtMl(a)}</button>`).join('')}</div></div>
    <div class="fgrid"><label class="field"><span>Kiekis, ml</span><input type="number" inputmode="numeric" id="ds-ml" value="${d ? d.ml : (I.drink_types[tid]?.ml || 250)}"></label>
    <label class="field"><span>Kada</span><input type="datetime-local" id="ds-ts" value="${esc(d ? d.ts : nowLocal())}"></label></div>
    <div class="sheet-actions">${d ? '<button class="btn danger" id="ds-del">Ištrinti</button>' : '<button class="btn" data-x>Atšaukti</button>'}<button class="btn primary" id="ds-ok">${d ? 'Išsaugoti' : 'Įrašyti'}</button></div></div>`, el => {
    const markA = () => $$('#ds-a .chip', el).forEach(c => c.classList.toggle('on', +c.dataset.a === +$('#ds-ml', el).value));
    markA();
    $('#ds-t', el).onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; tid = +b.dataset.t; $$('#ds-t .chip', el).forEach(c => c.classList.toggle('on', c === b)); if (!d) { $('#ds-ml', el).value = I.drink_types[tid].ml; markA(); } };
    $('#ds-a', el).onclick = e => { const b = e.target.closest('[data-a]'); if (!b) return; $('#ds-ml', el).value = b.dataset.a; markA(); };
    $('#ds-ml', el).oninput = markA;
    $('[data-x]', el) && ($('[data-x]', el).onclick = closeSheet);
    $('#ds-del', el) && ($('#ds-del', el).onclick = async () => { closeSheet(); await delRow('drinks', d.id); toast('Ištrinta'); });
    $('#ds-ok', el).onclick = async () => {
      const ml = parseInt($('#ds-ml', el).value, 10);
      if (!tid) return toast('Pasirinkite gėrimą');
      if (!(ml > 0)) return toast('Įrašykite kiekį');
      const ts = $('#ds-ts', el).value;
      closeSheet();
      if (d) await saveRow('drinks', { id: d.id, type_id: tid, ml, ts });
      else await act('drink', { type_id: tid, ml, ts });
      toast('Įrašyta');
    };
  });
}

function barsSvg(n, end) {
  end = end || T();
  const days = [];
  for (let i = n - 1; i >= 0; i--) { const d = addDays(end, -i); days.push({ d, ml: dayTotal(d) }); }
  const g = goal(), max = Math.max(g * 1.2, ...days.map(x => x.ml)), W = 320, H = 130, bw = W / n;
  const y = v => H - (v / max) * H;
  return `<svg viewBox="0 -6 ${W} ${H + 24}">
    <line x1="0" x2="${W}" y1="${y(g)}" y2="${y(g)}" stroke="var(--water)" stroke-dasharray="4 4" opacity=".6"/>
    <text x="${W}" y="${y(g) - 4}" text-anchor="end">tikslas ${fmtMl(g)}</text>
    ${days.map((x, i) => {
      const h = H - y(x.ml), dd = pd(x.d);
      const lbl = n <= 7 ? WD[(dd.getDay() + 6) % 7] : (dd.getDate() === 1 || i % 5 === 0 ? dd.getDate() : '');
      return `<g><title>${dayNice(x.d)}: ${x.ml} ml</title><rect x="${i * bw + bw * .18}" y="${y(x.ml)}" width="${bw * .64}" height="${Math.max(h, 0.5)}" rx="${Math.min(5, bw * .2)}" fill="${x.ml >= g ? 'var(--water)' : 'color-mix(in srgb, var(--water) 55%, var(--card))'}"/>
      ${n <= 7 && x.ml ? `<text x="${i * bw + bw / 2}" y="${y(x.ml) - 4}" text-anchor="middle">${fmtMl(x.ml)}</text>` : ''}
      <text x="${i * bw + bw / 2}" y="${H + 14}" text-anchor="middle" ${x.d === T() ? 'style="font-weight:800;fill:var(--ink)"' : ''}>${lbl}</text></g>`;
    }).join('')}</svg>`;
}

VIEWS.istorija = () => {
  setTop('Vandens istorija', '', true);
  const n = UI.histN || 30;
  const last = []; for (let i = 0; i < n; i++) last.push(addDays(T(), -i));
  const stats = S.days.filter(x => x.day >= last[last.length - 1] && x.day <= T());
  const avg = stats.length ? stats.reduce((a, x) => a + x.ml, 0) / n : 0;
  const hit = stats.filter(x => x.ml >= goal()).length;
  const caf = stats.length ? stats.reduce((a, x) => a + x.caf, 0) / n : 0;
  const cups = stats.length ? stats.reduce((a, x) => a + x.caf_n, 0) / n : 0;
  let streak = 0; for (let i = 0; ; i++) { const d = addDays(T(), -i); if (dayTotal(d) >= goal()) streak++; else if (i > 0) break; if (i > 400) break; }
  view.innerHTML = `<div class="rep-tools">${segHtml('h-n', { 7: '7 d.', 30: '30 d.', 90: '90 d.' }, String(n))}</div>
    <div class="tiles"><div class="card tile"><b>${fmtMl(avg)}</b><span>vidutiniškai per dieną</span></div>
      <div class="card tile"><b>${hit} iš ${n}</b><span>dienų pasiektas tikslas</span></div>
      <div class="card tile"><b>${streak}</b><span>dienų iš eilės su tikslu</span></div>
      <div class="card tile"><b>${fmt1(cups)}</b><span>kavos puodelių per dieną${caf ? ` (~${Math.round(caf)} mg kofeino)` : ''}</span></div></div>
    <h2>Per dieną</h2><div class="card chart">${barsSvg(Math.min(n, 60))}</div>
    <h2>Dienos</h2><div class="card list">${last.slice(0, 60).map(d => { const st = S.days.find(x => x.day === d); return `<div class="li" data-day="${d}"><div class="grow">${dayRel(d)} <span class="small muted">${DAYS[pd(d).getDay()]}</span></div>${st && st.caf_n ? `<span class="pill">☕ ${st.caf_n}</span>` : ''}<span class="v" style="${(st?.ml || 0) >= goal() ? 'color:var(--water)' : ''}">${fmtMl(st?.ml || 0)}</span></div>`; }).join('')}</div>`;
  bindSeg($('#h-n'));
  $('#h-n').addEventListener('click', () => setTimeout(() => { UI.histN = +segVal($('#h-n')) || 30; saveUI(); render(); }));
  $$('[data-day]').forEach(r => r.onclick = () => daySheet(r.dataset.day));
};
function daySheet(day) {
  const list = S.drinks.filter(d => d.day === day);
  openSheet(`<h3>${dayRel(day)} · ${fmtMl(dayTotal(day))}</h3>
    <div class="card list">${list.map(d => drinkRow(d)).join('') || `<div class="empty">${day < addDays(T(), -45) ? 'Smulkūs įrašai saugomi, bet čia rodomi tik paskutinių 45 dienų.' : 'Įrašų nėra.'}</div>`}</div>
    <div class="sheet-actions"><button class="btn" data-x>Uždaryti</button></div>`, el => { $('[data-x]', el).onclick = closeSheet; bindDrinkRows(); });
}

// ============================================================ GALVA
VIEWS.galva = () => {
  setTop('Galvos skausmai');
  const a = activeEp();
  const m = UI.calM || T().slice(0, 7);
  const mStats = monthStats(m);
  const eps = S.episodes.slice(0, UI.epN || 25);
  let lastM = '';
  view.innerHTML = `${banner()}
  <div class="row wrap g-acts">${a ? '' : '<button class="btn primary" id="g-start">＋ Galvos skausmas</button>'}<button class="btn" id="g-med">💊 Išgėriau vaistų</button></div>
  <div class="grid" style="margin-top:12px">
    <div>
      <div class="card cal">${calendarHtml(m, true)}</div>
      <div class="tiles" style="margin-top:10px">
        <div class="card tile"><b>${mStats.days}</b><span>skausmo dienų (${MONTHS[+m.slice(5) - 1].toLowerCase()})</span></div>
        <div class="card tile"><b>${mStats.mig}</b><span>migrenos dienų</span></div>
        <div class="card tile"><b>${mStats.medDays}</b><span>dienų su vaistais</span></div>
        <div class="card tile"><b>${mStats.free}</b><span>dienų be skausmo</span></div>
      </div>
    </div>
    <div>
      <h2>Įrašai<button class="btn small" id="g-new">＋ Įrašyti praėjusį</button></h2>
      ${eps.map(e => { const mm = e.start.slice(0, 7); const h = mm !== lastM ? `<div class="month-h">${MONTHS[+mm.slice(5) - 1]} ${mm.slice(0, 4)}</div>` : ''; lastM = mm; return h + epCard(e); }).join('') || '<div class="card empty">Įrašų dar nėra. Kai skaudės galvą – spauskite „＋ Galvos skausmas“.</div>'}
      ${S.episodes.length > eps.length ? '<button class="btn block" id="g-more" style="margin-top:10px">Rodyti daugiau</button>' : ''}
      ${looseDoses()}
    </div>
  </div>`;
  bindBanner();
  $('#g-start') && ($('#g-start').onclick = () => startSheet());
  $('#g-new').onclick = () => episodeSheet(null, null, { past: true });
  $('#g-med').onclick = () => medQuickSheet(a ? a.id : null);
  $('#g-more') && ($('#g-more').onclick = () => { UI.epN = (UI.epN || 25) + 50; saveUI(); render(); });
  bindCalendar();
  $$('[data-ep]').forEach(c => c.onclick = () => episodeSheet(I.episodes[c.dataset.ep]));
  $$('[data-dose]').forEach(c => c.onclick = () => doseSheet(I.doses[c.dataset.dose]));
};

function epCard(e) {
  const dz = dosesOf(e.id);
  const tags = [
    e.kind === 'migrena' ? '<span class="tg mig">Migrena</span>' : e.kind ? `<span class="tg">${esc(KIND[e.kind])}</span>` : '',
    ...dz.map(d => `<span class="tg med">💊 ${esc(I.meds[d.med_id]?.name || '?')} ${EFFECT[d.effect || ''][0]}</span>`),
    ...(e.symptoms || []).slice(0, 3).map(s => `<span class="tg">${esc(s)}</span>`),
    ...(e.triggers || []).slice(0, 2).map(s => `<span class="tg">⚡ ${esc(s)}</span>`),
  ].filter(Boolean).join('');
  return `<div class="card ep" data-ep="${e.id}" style="padding:10px 12px;margin-bottom:8px;cursor:pointer"><div class="row">${ilvl(e.intensity)}<b class="grow">${esc(dayRel(e.start.slice(0, 10)))}, ${hhmm(e.start)}${e.ended ? '–' + (e.ended.slice(0, 10) !== e.start.slice(0, 10) ? dayNice(e.ended.slice(0, 10)) + ' ' : '') + hhmm(e.ended) : ''}</b><span class="meta">${e.ended ? durTxt(e.start, e.ended) : '<b style="color:var(--i3)">tęsiasi</b>'}</span></div>
    ${tags ? `<div class="tags">${tags}</div>` : ''}${e.notes ? `<div class="meta" style="margin-top:3px">${esc(e.notes.slice(0, 120))}</div>` : ''}</div>`;
}
function looseDoses() {
  const list = S.doses.filter(d => !d.episode_id).slice(-10).reverse();
  if (!list.length) return '';
  return `<h2>Vaistai be skausmo įrašo</h2><div class="card list">${list.map(d => `<div class="li" data-dose="${d.id}"><span class="ico">💊</span><div class="grow">${esc(I.meds[d.med_id]?.name || '?')} <span class="small muted">${esc(d.amount || '')}</span></div><span class="small muted">${esc(tsNice(d.ts))}</span></div>`).join('')}</div>`;
}

// dienos -> skausmo informacija (kiekviena diena, kurią apėmė epizodas)
function painDays(from, to) {
  const out = {};
  for (const e of S.episodes) {
    const a = e.start.slice(0, 10), b = (e.ended || nowLocal()).slice(0, 10);
    if (b < from || a > to) continue;
    let d = a, guard = 0;
    while (d <= b && guard++ < 31) {
      if (d >= from && d <= to) {
        const o = out[d] || (out[d] = { max: null, mig: false, eps: [], meds: new Set() });
        if (e.intensity != null && (o.max == null || e.intensity > o.max)) o.max = e.intensity;
        if (e.kind === 'migrena') o.mig = true;
        o.eps.push(e);
      }
      d = addDays(d, 1);
    }
  }
  for (const x of S.doses) {
    const d = x.ts.slice(0, 10);
    if (d < from || d > to) continue;
    const o = out[d] || (out[d] = { max: null, mig: false, eps: [], meds: new Set(), noPain: true });
    o.meds.add(I.meds[x.med_id]?.kind || 'kita');
  }
  return out;
}
function monthStats(m) {
  const from = m + '-01', last = ds(new Date(+m.slice(0, 4), +m.slice(5), 0));
  const to = last < T() ? last : T();
  const pdays = painDays(from, to);
  const vals = Object.values(pdays);
  const n = from > T() ? 0 : diffDays(from, to) + 1;
  const days = vals.filter(v => !v.noPain).length;
  return { days, mig: vals.filter(v => v.mig).length, medDays: vals.filter(v => [...v.meds].some(k => k !== 'profilaktinis')).length, free: Math.max(0, n - days) };
}
function calendarHtml(m, nav) {
  const y = +m.slice(0, 4), mo = +m.slice(5) - 1;
  const first = new Date(y, mo, 1), n = new Date(y, mo + 1, 0).getDate();
  const off = (first.getDay() + 6) % 7;
  const pdays = painDays(ds(first), ds(new Date(y, mo, n)));
  let cells = '';
  for (let i = 0; i < off; i++) cells += '<span class="d out"></span>';
  for (let d = 1; d <= n; d++) {
    const s = ds(new Date(y, mo, d)), p = pdays[s];
    const pain = p && !p.noPain;
    const medAcute = p && [...p.meds].some(k => k !== 'profilaktinis');
    cells += `<button type="button" class="d ${s === T() ? 'today' : ''} ${s > T() ? 'future' : ''} ${pain ? 'p' : ''}" data-cday="${s}" ${pain ? `style="background:${icol(p.max)}"` : ''} title="${dayNice(s)}">${d}${medAcute ? '<i>💊</i>' : ''}</button>`;
  }
  return `${nav ? `<div class="cal-h"><button class="icon-btn" data-cm="-1">‹</button><b>${MONTHS[mo]} ${y}</b><button class="icon-btn" data-cm="1">›</button></div>` : `<b>${MONTHS[mo]} ${y}</b>`}
    <div class="cal-g">${WD.map(w => `<span class="wd">${w}</span>`).join('')}${cells}</div>
    ${nav ? `<div class="cal-leg"><span><i style="background:var(--i1)"></i>1–3</span><span><i style="background:var(--i2)"></i>4–6</span><span><i style="background:var(--i3)"></i>7–10</span><span>💊 vaistai</span></div>` : ''}`;
}
function bindCalendar() {
  $$('[data-cm]').forEach(b => b.onclick = () => {
    const m = UI.calM || T().slice(0, 7);
    const d = new Date(+m.slice(0, 4), +m.slice(5) - 1 + (+b.dataset.cm), 1);
    UI.calM = ds(d).slice(0, 7); saveUI(); render();
  });
  $$('[data-cday]').forEach(b => b.onclick = () => {
    const d = b.dataset.cday;
    const eps = S.episodes.filter(e => e.start.slice(0, 10) <= d && (e.ended || nowLocal()).slice(0, 10) >= d);
    if (eps.length === 1) return episodeSheet(eps[0]);
    if (eps.length > 1) {
      return openSheet(`<h3>${dayRel(d)}</h3>${eps.map(epCard).join('')}<div class="sheet-actions"><button class="btn" data-x>Uždaryti</button><button class="btn primary" data-n>＋ Naujas įrašas</button></div>`, el => {
        $('[data-x]', el).onclick = closeSheet;
        $('[data-n]', el).onclick = () => episodeSheet(null, d);
        $$('[data-ep]', el).forEach(c => c.onclick = () => episodeSheet(I.episodes[c.dataset.ep]));
      });
    }
    if (d > T()) return;
    episodeSheet(null, d);
  });
}

function intsHtml(cur) {
  let h = '<div class="ints" id="e-int">';
  for (let i = 0; i <= 10; i++) h += `<button type="button" data-i="${i}" class="${cur === i ? 'on' : ''}" style="${cur === i ? `background:${icol(i)}` : ''}">${i}</button>`;
  return h + '</div><div class="ints-l"><span>0 – neskauda</span><span>5 – vidutiniškai</span><span>10 – nepakeliamai</span></div>';
}
function bindInts(el, onPick) {
  $('#e-int', el).onclick = e => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    $$('#e-int button', el).forEach(x => { x.classList.remove('on'); x.style.background = ''; });
    b.classList.add('on'); b.style.background = icol(+b.dataset.i);
    if (onPick) onPick(+b.dataset.i);
  };
}
const intVal = el => { const b = $('#e-int button.on', el); return b ? +b.dataset.i : null; };

// greitas pradžia – tas pats žingsninis langas
function startSheet() { episodeSheet(null); }

function endSheet(a) {
  openSheet(`<h3>✔ Galvos skausmas praėjo</h3><div class="stack">
    <label class="field"><span>Kada praėjo</span><input type="datetime-local" id="x-ts" value="${nowLocal()}"></label>
    <div><span class="lbl-s">Stipriausias skausmas buvo</span>${intsHtml(a.intensity)}</div>
    ${dosesOf(a.id).filter(d => !d.effect).map(d => `<div><span class="lbl-s">Ar padėjo 💊 ${esc(I.meds[d.med_id]?.name || '?')} (${hhmm(d.ts)})?</span>${segHtml('x-d' + d.id, { padejo: '✅ Padėjo', is_dalies: '🟡 Iš dalies', nepadejo: '❌ Ne' }, '')}</div>`).join('')}
    <div class="sheet-actions"><button class="btn" id="x-more">Pildyti daugiau</button><button class="btn primary" id="x-ok">Išsaugoti</button></div></div>`, el => {
    bindInts(el);
    const ds_ = dosesOf(a.id).filter(d => !d.effect);
    ds_.forEach(d => bindSeg($('#x-d' + d.id, el), true));
    const save = async () => {
      await api('api/do/save', { t: 'episodes', row: { id: a.id, ended: $('#x-ts', el).value, intensity: intVal(el) } });
      for (const d of ds_) { const v = segVal($('#x-d' + d.id, el)); if (v) await api('api/do/save', { t: 'doses', row: { id: d.id, effect: v } }); }
      await load(true);
    };
    $('#x-ok', el).onclick = async () => { await save(); closeSheet(); render(); toast('Išsaugota. Sveikatos!'); };
    $('#x-more', el).onclick = async () => { await save(); render(); episodeSheet(I.episodes[a.id], null, { step: 1 }); };
  });
}

// ============================================================ galvos skausmo pildymas žingsniais
const ICON = {
  'Pulsuojantis': '💓', 'Spaudžiantis': '🗜️', 'Duriantis': '📌', 'Maudžiantis': '〰️', 'Deginantis': '🔥',
  'Pykinimas': '🤢', 'Vėmimas': '🤮', 'Jautrumas šviesai': '💡', 'Jautrumas garsui': '🔊', 'Jautrumas kvapams': '👃', 'Aura (regos)': '✨',
  'Svaigulys': '💫', 'Nuovargis': '🥱', 'Kaklo įtampa': '🦴', 'Sunku susikaupti': '🧠', 'Ašarojimas / nosies užgulimas': '💧', 'Stiprėja judant': '🚶',
  'Stresas': '😣', 'Per mažai miego': '🌙', 'Per daug miego': '🛌', 'Praleistas valgis': '🍽️', 'Per mažai vandens': '🚰', 'Kofeinas (daug ar trūko)': '☕',
  'Alkoholis': '🍷', 'Oro pokyčiai': '🌦️', 'Menstruacijos': '🩸', 'Ekranas / kompiuteris': '💻', 'Ryški šviesa': '☀️', 'Triukšmas': '📢', 'Kvapai': '🌸',
  'Fizinis krūvis': '🏋️', 'Kelionė': '🚗', 'Maistas': '🧀',
  'Miegas / poilsis': '😴', 'Tamsus kambarys': '🌑', 'Šaltas kompresas': '🧊', 'Šiltas kompresas': '♨️', 'Vanduo': '💧', 'Kava': '☕', 'Gaivus oras': '🌬️',
  'Masažas': '💆', 'Dušas': '🚿', 'Pakaušis': '🔙',
};
const KIND_ICON = { migrena: '⚡', itampos: '🪢', kita: '❔', '': '🤷' };
const IMPACT_ICON = { nepaveike: '🙂', sumazejo: '😕', negalejo: '🛌' };
// kuri pusė skauda – pasirenkama viena; „Abi pusės“ = abi vienodai (senų įrašų reikšmė nekeičiama)
const SIDES = ['Kairė pusė', 'Dešinė pusė', 'Abi pusės', 'Abi – kairė stipriau', 'Abi – dešinė stipriau'];
const SIDE_LBL = { 'Abi pusės': 'Abi vienodai', 'Abi – kairė stipriau': 'Abi, kairė stipriau', 'Abi – dešinė stipriau': 'Abi, dešinė stipriau' };
const sideOf = e => (e.locs || []).find(v => SIDES.includes(v)) || '';
const iword = i => i == null ? 'Pasirinkite' : i === 0 ? 'Neskauda' : i <= 3 ? 'Lengvas' : i <= 6 ? 'Vidutinis' : i <= 8 ? 'Stiprus' : 'Labai stiprus';
const plusMin = (ts, m) => { const d = new Date(ts); d.setMinutes(d.getMinutes() + m); return ds(d) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

// dideli paspaudžiami žetonai (su ženkliuku); multi=false – tik vienas pasirinkimas
function tilesHtml(id, opts, sel, multi = true, icons = ICON, add = true) {
  const list = Array.isArray(opts) ? opts.map(o => [o, o]) : Object.entries(opts);
  if (multi) sel.forEach(s => { if (!list.some(([k]) => k === s)) list.push([s, s]); });
  return `<div class="wtiles" id="${id}" data-multi="${multi ? 1 : 0}">${list.map(([k, v]) => `<button type="button" class="wt ${(multi ? sel.includes(k) : sel === k) ? 'on' : ''}" data-v="${esc(k)}"><i>${icons[k] || '•'}</i><span>${esc(v)}</span></button>`).join('')}${add && multi ? '<button type="button" class="wt add" data-add><i>＋</i><span>Kita</span></button>' : ''}</div>`;
}
function bindTiles(el, onChange) {
  el.onclick = ev => {
    const b = ev.target.closest('.wt'); if (!b) return;
    if (b.hasAttribute('data-add')) {
      if ($('input', el)) return;
      b.outerHTML = '<span class="wt-in"><input type="text" placeholder="Įrašykite…"><button type="button" class="btn small primary">✓</button></span>';
      const box = $('.wt-in', el), inp = $('input', box);
      inp.focus();
      const ok = () => {
        const v = inp.value.trim();
        box.outerHTML = (v ? `<button type="button" class="wt on" data-v="${esc(v)}"><i>${ICON[v] || '•'}</i><span>${esc(v)}</span></button>` : '') + '<button type="button" class="wt add" data-add><i>＋</i><span>Kita</span></button>';
        onChange && onChange();
      };
      $('button', box).onclick = ok;
      inp.onkeydown = e2 => { if (e2.key === 'Enter') { e2.preventDefault(); ok(); } };
      return;
    }
    if (el.dataset.multi === '1') b.classList.toggle('on');
    else { const was = b.classList.contains('on'); $$('.wt', el).forEach(x => x.classList.remove('on')); if (!was) b.classList.add('on'); }
    b.animate && b.animate([{ transform: 'scale(.92)' }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
    onChange && onChange();
  };
}
const tileVals = el => $$('.wt.on[data-v]', el).map(b => b.dataset.v);
const tileVal = el => $('.wt.on[data-v]', el)?.dataset.v ?? null;

// galva iš priekio ir iš nugaros; zonos – paspaudžiamos sritys
function headSvg(sel, back) {
  const z = (v, tag) => `<${tag.replace('/>', '')} class="zone${sel.includes(v) ? ' on' : ''}" data-z="${v}"/>`;
  const face = `
    <path class="hd" d="M100 22c-38 0-64 28-64 72 0 30 9 54 22 70 11 14 26 22 42 22s31-8 42-22c13-16 22-40 22-70 0-44-26-72-64-72z"/>
    <path class="hd" d="M36 104c-9-4-15 2-13 13 2 12 8 22 16 24M164 104c9-4 15 2 13 13-2 12-8 22-16 24"/>
    <path class="ft" d="M70 116q11 6 22 0M108 116q11 6 22 0M100 120v26q-6 6-8 8M100 154q4 2 8 0M86 168q14 6 28 0"/>`;
  const backHead = `
    <path class="hd" d="M100 22c-38 0-64 28-64 72 0 34 12 60 28 76 11 11 23 16 36 16s25-5 36-16c16-16 28-42 28-76 0-44-26-72-64-72z"/>
    <path class="hd" d="M36 104c-9-4-15 2-13 13 2 12 8 22 16 24M164 104c9-4 15 2 13 13-2 12-8 22-16 24"/>
    <path class="ft" d="M100 30v60"/>`;
  const neck = `<path class="hd" d="M74 172v24c0 8-26 14-46 22-8 3-12 10-12 22h168c0-12-4-19-12-22-20-8-46-14-46-22v-24"/>`;
  const front = `${neck}${face}
    ${z('Viršugalvis', '<path d="M38 82C42 46 66 26 100 26s58 20 62 56c-18-8-39-12-62-12s-44 4-62 12z"/>')}
    ${z('Kakta', '<path d="M37 89c19-9 40-13 63-13s44 4 63 13c1 6 1 11 1 17-20-8-41-12-64-12s-44 4-64 12c0-6 0-11 1-17z"/>')}
    ${z('Smilkiniai', '<ellipse cx="44" cy="124" rx="9" ry="17"/>')}${z('Smilkiniai', '<ellipse cx="156" cy="124" rx="9" ry="17"/>')}
    ${z('Už akies', '<ellipse cx="81" cy="117" rx="15" ry="9"/>')}${z('Už akies', '<ellipse cx="119" cy="117" rx="15" ry="9"/>')}
    ${z('Kaklas', '<path d="M76 184c7 2 15 4 24 4s17-2 24-4v26c-7 3-15 4-24 4s-17-1-24-4z"/>')}`;
  const rear = `${neck}${backHead}
    ${z('Viršugalvis', '<path d="M38 82C42 46 66 26 100 26s58 20 62 56c-18-8-39-12-62-12s-44 4-62 12z"/>')}
    ${z('Pakaušis', '<path d="M40 128c18-8 38-12 60-12s42 4 60 12c-3 16-10 30-20 40-11 11-25 16-40 16s-29-5-40-16c-10-10-17-24-20-40z"/>')}
    ${z('Kaklas', '<path d="M76 188c7 1 15 2 24 2s17-1 24-2v24c-7 3-15 4-24 4s-17-1-24-4z"/>')}`;
  return `<svg class="head" viewBox="0 0 200 244" aria-label="Galva ${back ? 'iš nugaros' : 'iš priekio'}">${back ? rear : front}</svg>`;
}
// mažos galvutės mygtukams: kuri sritis paryškinta
function miniHead(kind) {
  const o = '<path class="mo" d="M18 4c-7 0-11 5-11 12 0 5 2 9 5 12 2 2 4 3 6 3s4-1 6-3c3-3 5-7 5-12 0-7-4-12-11-12z"/><path class="mo" d="M13 30v3M23 30v3"/>';
  const f = {
    'Kairė pusė': '<path class="mf" d="M18 4c-7 0-11 5-11 12 0 5 2 9 5 12 2 2 4 3 6 3z"/>',
    'Dešinė pusė': '<path class="mf" d="M18 4c7 0 11 5 11 12 0 5-2 9-5 12-2 2-4 3-6 3z"/>',
    'Abi pusės': '<path class="mf" d="M18 4c-7 0-11 5-11 12 0 5 2 9 5 12 2 2 4 3 6 3s4-1 6-3c3-3 5-7 5-12 0-7-4-12-11-12z"/>',
    'Abi – kairė stipriau': '<path class="mf2" d="M18 4c7 0 11 5 11 12 0 5-2 9-5 12-2 2-4 3-6 3z"/><path class="mf" d="M18 4c-7 0-11 5-11 12 0 5 2 9 5 12 2 2 4 3 6 3z"/>',
    'Abi – dešinė stipriau': '<path class="mf2" d="M18 4c-7 0-11 5-11 12 0 5 2 9 5 12 2 2 4 3 6 3z"/><path class="mf" d="M18 4c7 0 11 5 11 12 0 5-2 9-5 12-2 2-4 3-6 3z"/>',
    'Pakaušis': '<path class="mf" d="M7.6 19c3-1.4 6.6-2 10.4-2s7.4.6 10.4 2c-.6 3.4-2 6.6-4.4 9-2 2-4 3-6 3s-4-1-6-3c-2.4-2.4-3.8-5.6-4.4-9z"/>',
    'Kaklas': '<path class="mf" d="M13 29c2 1.4 3.4 2 5 2s3-.6 5-2v6h-10z"/>',
  }[kind] || '';
  return `<svg class="mini" viewBox="0 0 36 36">${f}${o}</svg>`;
}

function episodeSheet(e, day, opt = {}) {
  const past = !e && (opt.past || (day && day !== T()));
  const pStart = day && day !== T() ? day + 'T09:00' : plusMin(nowLocal(), -180);
  const w = {
    start: e ? e.start : (past ? pStart : nowLocal()),
    still: e ? !e.ended : !past,
    ended: e?.ended || (past ? plusMin(pStart, 120) : ''),
    intensity: e?.intensity ?? null, kind: e?.kind ?? null,
    locs: [...(e?.locs || [])], chars: [...(e?.chars || [])], symptoms: [...(e?.symptoms || [])],
    triggers: [...(e?.triggers || [])], relief: [...(e?.relief || [])], impact: e?.impact || '', notes: e?.notes || '',
    dz: e ? dosesOf(e.id).map(d => ({ ...d })) : [],
    back: false,
  };
  const quickStart = !e && !past;
  let step = opt.step || 0, el;

  const STEPS = [
    {
      t: 'Kaip stipriai skauda?', h: () => `
      <div class="pain-big" id="wz-ib"><b>${w.intensity ?? '–'}</b><span>${iword(w.intensity)}</span></div>
      <input type="range" min="0" max="10" step="1" id="wz-r" class="painrange${w.intensity == null ? ' unset' : ''}" value="${w.intensity ?? 5}">
      <div class="ints-l"><span>0</span><span>5</span><span>10</span></div>
      ${quickStart ? `<span class="lbl-s" style="margin-top:14px">Kada prasidėjo?</span>
        <div class="chips" id="wz-when">${[[0, 'Dabar'], [30, 'Prieš 30 min'], [60, 'Prieš 1 val'], [120, 'Prieš 2 val'], [180, 'Prieš 3 val']].map(([m, l]) => `<button type="button" class="chip" data-m="${m}">${l}</button>`).join('')}</div>
        <label class="field" style="margin-top:8px"><span>Pradžia</span><input type="datetime-local" id="wz-s" value="${esc(w.start)}"></label>`
        : `<div class="fgrid" style="margin-top:14px"><label class="field"><span>Pradžia</span><input type="datetime-local" id="wz-s" value="${esc(w.start)}"></label>
        <label class="field"><span>Pabaiga</span><input type="datetime-local" id="wz-e" value="${esc(w.ended)}" ${w.still ? 'disabled' : ''}></label></div>
        <label class="check"><input type="checkbox" id="wz-on" ${w.still ? 'checked' : ''}> Dar skauda</label>`}`,
      b: () => {
        const r = $('#wz-r', el), big = $('#wz-ib', el);
        const paint = () => { const i = w.intensity; big.style.setProperty('--c', icol(i)); $('b', big).textContent = i ?? '–'; $('span', big).textContent = iword(i); r.style.setProperty('--c', icol(i)); };
        paint();
        r.oninput = () => { w.intensity = +r.value; r.classList.remove('unset'); paint(); big.animate && big.animate([{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 180 }); };
        $('#wz-s', el).onchange = ev => { w.start = ev.target.value; $$('#wz-when .chip', el).forEach(c => c.classList.remove('on')); };
        $('#wz-when', el) && ($('#wz-when', el).onclick = ev => { const c = ev.target.closest('[data-m]'); if (!c) return; w.start = plusMin(nowLocal(), -c.dataset.m); $('#wz-s', el).value = w.start; $$('#wz-when .chip', el).forEach(x => x.classList.toggle('on', x === c)); });
        $('#wz-e', el) && ($('#wz-e', el).onchange = ev => { w.ended = ev.target.value; });
        $('#wz-on', el) && ($('#wz-on', el).onchange = ev => { w.still = ev.target.checked; $('#wz-e', el).disabled = w.still; if (!w.still && !w.ended) { w.ended = nowLocal() > w.start ? nowLocal() : plusMin(w.start, 120); $('#wz-e', el).value = w.ended; } });
      },
    },
    {
      t: 'Kur skauda?', h: () => {
        const tile = v => `<button type="button" class="wt${w.locs.includes(v) ? ' on' : ''}" data-l="${esc(v)}"><i>${miniHead(v)}</i><span>${esc(SIDE_LBL[v] || v)}</span></button>`;
        const extra = usedVals('locs', LOCS).filter(v => !LOCS.includes(v)).concat(w.locs.filter(v => !LOCS.includes(v)));
        return `<div class="headbox">
          <div class="head-view">${headSvg(w.locs, w.back)}</div>
          <div class="head-side">
            <button type="button" class="btn small" id="wz-rot">↻ ${w.back ? 'Iš priekio' : 'Iš nugaros'}</button>
            <div class="legend"><span><i class="on"></i>Skauda</span><span><i></i>Kitos sritys</span></div>
          </div></div>
          <div class="small muted head-sel">${w.locs.length ? 'Pažymėta: ' + w.locs.map(v => esc(SIDE_LBL[v] || v)).join(', ') : `Paspauskite vietą ant galvos${w.back ? '' : ' (pakaušis – apsukus galvą)'}`}</div>
          <span class="lbl-s">Kuri pusė?</span>
          <div class="wtiles">${SIDES.map(tile).join('')}</div>
          <span class="lbl-s" style="margin-top:12px">Dar</span>
          <div class="wtiles">${tile('Pakaušis')}${tile('Kaklas')}</div>
          <div style="margin-top:8px">${tilesHtml('wz-lx', [...new Set(extra)], w.locs.filter(v => !LOCS.includes(v)))}</div>`;
      },
      b: () => {
        const redraw = () => { $('.wz-body', el).innerHTML = STEPS[1].h(); STEPS[1].b(); };
        const flip = v => {
          const i = w.locs.indexOf(v);
          if (i >= 0) w.locs.splice(i, 1);
          else {
            if (SIDES.includes(v)) w.locs = w.locs.filter(x => !SIDES.includes(x)); // pusė – tik viena
            w.locs.push(v);
          }
          redraw();
        };
        $$('.zone', el).forEach(z => z.onclick = () => flip(z.dataset.z));
        $$('[data-l]', el).forEach(b => b.onclick = () => flip(b.dataset.l));
        $('#wz-rot', el).onclick = () => {
          w.back = !w.back; redraw();
          const h = $('.head-view svg', el);
          h.animate && h.animate([{ transform: 'rotateY(90deg)', opacity: .3 }, { transform: 'rotateY(0)', opacity: 1 }], { duration: 260, easing: 'ease-out' });
        };
        bindTiles($('#wz-lx', el), () => { w.locs = w.locs.filter(v => LOCS.includes(v)).concat(tileVals($('#wz-lx', el))); });
      },
    },
    {
      t: 'Koks tai skausmas?', h: () => `${tilesHtml('wz-c', usedVals('chars', CHARS), w.chars)}
      <span class="lbl-s" style="margin-top:16px">Kaip manote, kas tai?</span>${tilesHtml('wz-k', KIND, w.kind, false, KIND_ICON)}`,
      b: () => { bindTiles($('#wz-c', el), () => { w.chars = tileVals($('#wz-c', el)); }); bindTiles($('#wz-k', el), () => { w.kind = tileVal($('#wz-k', el)); }); },
    },
    {
      t: 'Kiti simptomai', h: () => tilesHtml('wz-y', usedVals('symptoms', SYMPTOMS), w.symptoms),
      b: () => bindTiles($('#wz-y', el), () => { w.symptoms = tileVals($('#wz-y', el)); }),
    },
    {
      t: 'Kas galėjo išprovokuoti?', h: () => tilesHtml('wz-t', usedVals('triggers', TRIGGERS), w.triggers),
      b: () => bindTiles($('#wz-t', el), () => { w.triggers = tileVals($('#wz-t', el)); }),
    },
    {
      t: 'Vaistai', h: () => `
      <div class="wtiles" id="wz-m">${meds().map(m => `<button type="button" class="wt" data-m="${m.id}"><i>💊</i><span>${esc(m.name)}${m.dose ? `<small>${esc(m.dose)}</small>` : ''}</span></button>`).join('')}<button type="button" class="wt add" data-new><i>＋</i><span>Naujas vaistas</span></button></div>
      <div class="small muted" style="margin:6px 2px 10px">Paspauskite išgertą vaistą – bus pridėtas žemiau.</div>
      <div id="wz-dz"></div>`,
      b: () => {
        const draw = () => {
          const list = w.dz.map((d, i) => [d, i]).filter(([d]) => !d.removed);
          $('#wz-dz', el).innerHTML = list.map(([d, i]) => `<div class="card wdose" data-i="${i}"><div class="row"><b class="grow">💊 ${esc(I.meds[d.med_id]?.name || '?')}</b><input type="time" value="${esc((d.ts || '').slice(11, 16))}" data-k="t"><button type="button" class="x" data-k="rm" aria-label="Pašalinti">✕</button></div>
            <div class="seg sm" data-k="eff">${Object.entries(EFFECT).map(([k, v]) => `<button type="button" data-v="${k}" class="${(d.effect || '') === k ? 'on' : ''}">${v[0]} ${v[1]}</button>`).join('')}</div></div>`).join('') || '<div class="empty small">Vaistų nepažymėta</div>';
          $$('.wdose', el).forEach(c => {
            const d = w.dz[+c.dataset.i];
            $('[data-k=rm]', c).onclick = () => { d.removed = true; draw(); };
            $('[data-k=t]', c).onchange = ev => { d.ts = (d.ts || w.start).slice(0, 11) + ev.target.value; };
            $('[data-k=eff]', c).onclick = ev => { const b = ev.target.closest('button'); if (!b) return; d.effect = b.dataset.v; $$('button', b.parentNode).forEach(x => x.classList.toggle('on', x === b)); };
          });
        };
        draw();
        $('#wz-m', el).onclick = async ev => {
          const b = ev.target.closest('.wt'); if (!b) return;
          if (b.hasAttribute('data-new')) {
            if ($('.wt-in', el)) return;
            b.insertAdjacentHTML('afterend', '<span class="wt-in"><input type="text" placeholder="Pavadinimas"><input type="text" placeholder="Dozė" style="max-width:90px"><button type="button" class="btn small primary">✓</button></span>');
            const box = $('.wt-in', el); $('input', box).focus();
            $('button', box).onclick = async () => {
              const [n_, d_] = $$('input', box).map(x => x.value.trim());
              if (!n_) return toast('Įrašykite pavadinimą');
              const res = await api('api/do/save', { t: 'meds', row: { name: n_, dose: d_, kind: 'nvnu' } });
              await load(true);
              w.dz.push({ med_id: res.id, ts: w.still ? nowLocal() : w.start, effect: '' });
              render_();
            };
            return;
          }
          w.dz.push({ med_id: +b.dataset.m, ts: w.still ? nowLocal() : w.start, effect: '' });
          b.animate && b.animate([{ transform: 'scale(.9)' }, { transform: 'scale(1)' }], { duration: 160 });
          draw();
        };
      },
    },
    {
      t: 'Kaip baigėsi?', h: () => `<span class="lbl-s">Kas padėjo (be vaistų)</span>${tilesHtml('wz-rl', usedVals('relief', RELIEF), w.relief)}
      <span class="lbl-s" style="margin-top:16px">Kaip paveikė dieną</span>${tilesHtml('wz-i', IMPACT, w.impact, false, IMPACT_ICON)}
      <label class="field" style="margin-top:14px"><span>Pastabos</span><textarea id="wz-n" placeholder="pvz. ką valgėte, kaip miegojote, kas vyko">${esc(w.notes)}</textarea></label>`,
      b: () => {
        bindTiles($('#wz-rl', el), () => { w.relief = tileVals($('#wz-rl', el)); });
        bindTiles($('#wz-i', el), () => { w.impact = tileVal($('#wz-i', el)) || ''; });
        $('#wz-n', el).oninput = ev => { w.notes = ev.target.value; };
      },
    },
  ];
  const filled = i => [w.intensity != null, w.locs.length, w.chars.length || w.kind != null, w.symptoms.length, w.triggers.length, w.dz.some(d => !d.removed), w.relief.length || w.impact || w.notes][i];

  const save = async () => {
    const s = w.start;
    if (!s) { step = 0; render_(); return toast('Nurodykite pradžią'); }
    const end = w.still ? '' : (w.ended || plusMin(s, 120));
    if (end && end < s) { step = 0; render_(); return toast('Pabaiga ankstesnė už pradžią'); }
    if (w.still && S.episodes.some(x => !x.ended && (!e || x.id !== e.id))) return toast('Jau yra nebaigtas įrašas – pirmiausia pažymėkite jį „Praėjo“');
    const row = { start: s, ended: end, intensity: w.intensity, kind: w.kind ?? '', locs: w.locs, chars: w.chars, symptoms: w.symptoms,
      triggers: w.triggers, relief: w.relief, impact: w.impact, notes: w.notes };
    if (e) row.id = e.id;
    const r = await api('api/do/save', { t: 'episodes', row });
    const eid = e ? e.id : r.id;
    for (const d of w.dz) {
      if (d.removed) { if (d.id) await api('api/do/delete', { t: 'doses', id: d.id }); continue; }
      if (!d.med_id) continue;
      const dr = { episode_id: eid, med_id: d.med_id, ts: d.ts || s, effect: d.effect || '' };
      if (d.id) dr.id = d.id; else dr.amount = I.meds[d.med_id]?.dose || '';
      await api('api/do/save', { t: 'doses', row: dr });
    }
    closeSheet(); await load();
    toast(w.still && !e ? 'Įrašyta. Kai praeis – spauskite „✔ Praėjo“.' : 'Išsaugota', null, 4000);
  };

  const render_ = () => {
    const st = STEPS[step], last = step === STEPS.length - 1;
    $('#wz', el).innerHTML = `<div class="wz-top"><div class="wz-dots">${STEPS.map((x, i) => `<button type="button" data-s="${i}" class="${i === step ? 'cur' : ''}${filled(i) ? ' ok' : ''}" aria-label="${esc(x.t)}"></button>`).join('')}</div>
      <span class="small muted">${step + 1} / ${STEPS.length}</span></div>
      <h3 class="wz-h">${esc(st.t)}</h3><div class="wz-body">${st.h()}</div>
      <div class="sheet-actions">${step ? '<button class="btn" data-b>‹ Atgal</button>' : (e ? '<button class="btn danger" data-del>Ištrinti</button>' : '<button class="btn" data-x>Atšaukti</button>')}
        ${last ? '' : `<button class="btn" data-ok>Išsaugoti</button>`}
        <button class="btn primary" ${last ? 'data-ok' : 'data-n'}>${last ? 'Išsaugoti' : (filled(step) ? 'Toliau ›' : 'Praleisti ›')}</button></div>`;
    st.b();
    const body = $('.wz-body', el);
    body.animate && body.animate([{ opacity: 0, transform: `translateX(${render_.dir * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
    $('#sheet').scrollTop = 0;
    const nb = $('[data-n]', el);
    const upd = () => { if (nb) nb.textContent = filled(step) ? 'Toliau ›' : 'Praleisti ›'; $$('.wz-dots button', el).forEach((d, i) => d.classList.toggle('ok', !!filled(i))); };
    $('.wz-body', el).addEventListener('click', () => setTimeout(upd, 0));
    $('.wz-body', el).addEventListener('input', upd);
    $$('.wz-dots button', el).forEach(d => d.onclick = () => go_(+d.dataset.s));
    $('[data-b]', el) && ($('[data-b]', el).onclick = () => go_(step - 1));
    $('[data-n]', el) && ($('[data-n]', el).onclick = () => go_(step + 1));
    $$('[data-ok]', el).forEach(b => b.onclick = () => { commit(); setTimeout(save, 0); });
    $('[data-x]', el) && ($('[data-x]', el).onclick = closeSheet);
    $('[data-del]', el) && ($('[data-del]', el).onclick = () => confirmSheet('Ištrinti šį įrašą?', 'Ištrinti', async () => {
      for (const d of dosesOf(e.id)) await api('api/do/delete', { t: 'doses', id: d.id });
      await delRow('episodes', e.id); toast('Ištrinta');
    }));
  };
  render_.dir = 1;
  // neužbaigtas „Kita“ įvedimas – patvirtinti prieš einant toliau
  const commit = () => $$('.wt-in', el).forEach(b => { if ($('input', b).value.trim()) $('button', b).click(); });
  const go_ = i => { commit(); if (i < 0 || i >= STEPS.length) return; render_.dir = i > step ? 1 : -1; step = i; render_(); };
  openSheet('<div id="wz" class="wz"></div>', x => { el = x; render_(); });
}

// greitas vaisto pažymėjimas
function medQuickSheet(eid) {
  const list = meds().filter(m => m.kind !== 'profilaktinis').concat(meds().filter(m => m.kind === 'profilaktinis'));
  openSheet(`<h3>💊 Išgėriau vaistų</h3><div class="stack">
    ${list.length ? `<div class="medbtns">${list.map(m => `<button class="btn" data-m="${m.id}"><span>${esc(m.name)}</span><small>${esc(m.dose || MED_KINDS[m.kind]?.split(' (')[0] || '')}</small></button>`).join('')}</div>` : '<p class="muted" style="margin:0">Vaistų sąrašas tuščias. Įrašykite vaistą žemiau – kitą kartą jis bus mygtukas.</p>'}
    <details class="more" ${list.length ? '' : 'open'}><summary>＋ Naujas vaistas</summary><div class="stack" style="margin-top:8px">
      <div class="fgrid"><label class="field"><span>Pavadinimas</span><input type="text" id="m-n" placeholder="pvz. Ibuprofenas"></label><label class="field"><span>Dozė</span><input type="text" id="m-d" placeholder="pvz. 400 mg"></label></div>
      <label class="field"><span>Rūšis (svarbu ataskaitai)</span><select id="m-k">${Object.entries(MED_KINDS).map(([k, v]) => `<option value="${k}" ${k === 'nvnu' ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <button class="btn" id="m-add">Įrašyti ir pažymėti išgertą</button></div></details>
    <label class="field"><span>Kada išgerta</span><input type="datetime-local" id="m-ts" value="${nowLocal()}"></label>
    <div class="sheet-actions"><button class="btn" data-x>Atšaukti</button></div></div>`, el => {
    $('[data-x]', el).onclick = closeSheet;
    const mark = async mid => {
      const opt = { med_id: mid, ts: $('#m-ts', el).value || nowLocal() };
      if (eid !== undefined) opt.episode_id = eid;
      await act('dose', opt);
      closeSheet();
      const s = S.profile.settings;
      toast(`Pažymėta: ${I.meds[mid].name} ${hhmm(opt.ts)}${s.mc_on ? `. Po ${fmt1(s.mc_hours)} val. paklausiu, ar padėjo.` : ''}`, null, 4500);
    };
    $$('[data-m]', el).forEach(b => b.onclick = () => mark(+b.dataset.m));
    $('#m-add', el).onclick = async () => {
      const name = $('#m-n', el).value.trim(); if (!name) return toast('Įrašykite pavadinimą');
      const r = await api('api/do/save', { t: 'meds', row: { name, dose: $('#m-d', el).value, kind: $('#m-k', el).value } });
      await load(true); mark(r.id);
    };
  });
}

function doseSheet(d) {
  openSheet(`<h3>💊 ${esc(I.meds[d.med_id]?.name || 'Vaistas')}</h3><div class="stack">
    <div class="fgrid"><label class="field"><span>Kada</span><input type="datetime-local" id="d-ts" value="${esc(d.ts)}"></label><label class="field"><span>Dozė</span><input type="text" id="d-a" value="${esc(d.amount || '')}"></label></div>
    <div><span class="lbl-s">Ar padėjo?</span>${segHtml('d-e', { padejo: '✅ Padėjo', is_dalies: '🟡 Iš dalies', nepadejo: '❌ Ne' }, d.effect || '')}</div>
    <label class="field"><span>Pastaba</span><input type="text" id="d-n" value="${esc(d.note || '')}"></label>
    <div class="sheet-actions"><button class="btn danger" id="d-del">Ištrinti</button><button class="btn primary" id="d-ok">Išsaugoti</button></div></div>`, el => {
    bindSeg($('#d-e', el), true);
    $('#d-del', el).onclick = async () => { closeSheet(); await delRow('doses', d.id); };
    $('#d-ok', el).onclick = async () => { const row = { id: d.id, ts: $('#d-ts', el).value, amount: $('#d-a', el).value, effect: segVal($('#d-e', el)) || '', note: $('#d-n', el).value }; closeSheet(); await saveRow('doses', row); };
  });
}

// ============================================================ ATASKAITA GYDYTOJUI
function reportRange() {
  const n = UI.repN || '3';
  if (n === 'x') return [UI.repFrom || addDays(T(), -90), UI.repTo || T()];
  const d = pd(T()); d.setMonth(d.getMonth() - +n); d.setDate(d.getDate() + 1);
  return [ds(d), T()];
}
VIEWS.ataskaita = () => {
  setTop('Ataskaita gydytojui', `<button class="btn small" id="r-print">🖨 Spausdinti / PDF</button>`);
  const [from, to] = reportRange();
  const n = UI.repN || '3';
  const nd = diffDays(from, to) + 1;
  const eps = S.episodes.filter(e => e.start.slice(0, 10) >= from && e.start.slice(0, 10) <= to).slice().reverse();
  const doses = S.doses.filter(d => d.ts.slice(0, 10) >= from && d.ts.slice(0, 10) <= to);
  const pdays = painDays(from, to);
  const painN = Object.values(pdays).filter(v => !v.noPain).length;
  const migN = Object.values(pdays).filter(v => v.mig).length;
  const acuteDays = Object.values(pdays).filter(v => [...v.meds].some(k => k !== 'profilaktinis')).length;
  const ints = eps.filter(e => e.intensity != null).map(e => e.intensity);
  const durs = eps.filter(e => e.ended && e.ended > e.start).map(e => durH(e.start, e.ended)); // importuoti be pabaigos – neskaičiuojami
  const perMonth = 30.4 * painN / nd;
  // mėnesiai
  const months = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = ds(new Date(+m.slice(0, 4), +m.slice(5), 1)).slice(0, 7)) months.push(m);
  const mrows = months.map(m => {
    const a = m + '-01' < from ? from : m + '-01';
    const lastD = ds(new Date(+m.slice(0, 4), +m.slice(5), 0)), b = lastD > to ? to : lastD;
    const pd_ = Object.entries(pdays).filter(([d]) => d >= a && d <= b).map(([, v]) => v);
    const me = eps.filter(e => e.start.slice(0, 10) >= a && e.start.slice(0, 10) <= b);
    const mi = me.filter(e => e.intensity != null).map(e => e.intensity);
    const kd = k => pd_.filter(v => k.some(x => v.meds.has(x))).length;
    return { m, days: diffDays(a, b) + 1, pain: pd_.filter(v => !v.noPain).length, mig: pd_.filter(v => v.mig).length, eps: me.length,
      avg: mi.length ? mi.reduce((x, y) => x + y, 0) / mi.length : null, trip: kd(['triptanas', 'kombinuotas']), simple: kd(['analgetikas', 'nvnu']),
      acute: pd_.filter(v => [...v.meds].some(k => k !== 'profilaktinis')).length };
  });
  const overuse = mrows.filter(r => r.trip >= 10 || r.simple >= 15 || r.acute >= 15);
  // vaistų veiksmingumas
  const medEff = {};
  doses.forEach(d => { const o = medEff[d.med_id] || (medEff[d.med_id] = { n: 0, padejo: 0, is_dalies: 0, nepadejo: 0, days: new Set() }); o.n++; o.days.add(d.ts.slice(0, 10)); if (d.effect) o[d.effect]++; });
  const counts = col => { const c = {}; eps.forEach(e => (e[col] || []).forEach(v => c[v] = (c[v] || 0) + 1)); return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const barsBlock = (title, list) => list.length ? `<div class="card"><div style="padding:10px 14px 0"><b>${title}</b></div><div class="bars">${list.slice(0, 8).map(([k, v]) => `<span class="l">${esc(k)}</span><div class="bar"><i style="width:${Math.round(100 * v / eps.length)}%"></i></div><span class="v">${v} <span class="small muted">(${Math.round(100 * v / eps.length)}%)</span></span>`).join('')}</div></div>` : '';
  const wdays = S.days.filter(x => x.day >= from && x.day <= to);
  const wavg = wdays.length ? wdays.reduce((a, x) => a + x.ml, 0) / wdays.length : 0;
  const cafAvg = wdays.length ? wdays.reduce((a, x) => a + x.caf, 0) / wdays.length : 0;
  const kinds = {}; eps.forEach(e => kinds[e.kind || ''] = (kinds[e.kind || ''] || 0) + 1);
  const auraN = eps.filter(e => (e.symptoms || []).includes('Aura (regos)')).length;
  const sides = { k: 0, d: 0, a: 0, n: 0 };
  eps.forEach(e => { const v = sideOf(e); if (!v) sides.n++; else if (v === 'Abi pusės') sides.a++; else if (v.includes('airė')) sides.k++; else sides.d++; });
  const sideN = eps.length - sides.n;
  const sideBlock = sideN ? `<div class="card"><div style="padding:10px 14px 0"><b>Kuri pusė skauda</b></div><div class="bars">${[['Kairė', sides.k], ['Dešinė', sides.d], ['Abi vienodai', sides.a]].map(([k, v]) => `<span class="l">${k}</span><div class="bar"><i style="width:${Math.round(100 * v / sideN)}%"></i></div><span class="v">${v} <span class="small muted">(${Math.round(100 * v / sideN)}%)</span></span>`).join('')}</div>
    <p class="small muted" style="margin:6px 14px 12px">${sides.k > sides.d && sides.k >= sides.a ? `Dažniau kairėje: ${sides.k} iš ${sideN}.` : sides.d > sides.k && sides.d >= sides.a ? `Dažniau dešinėje: ${sides.d} iš ${sideN}.` : 'Pusės pasiskirsčiusios panašiai.'} Kairė / dešinė įskaičiuoja ir „abi, bet viena stipriau“.${sides.n ? ` Pusė nepažymėta: ${sides.n}.` : ''}</p></div>` : '';
  const impact = {}; eps.forEach(e => { if (e.impact) impact[e.impact] = (impact[e.impact] || 0) + 1; });

  view.innerHTML = `<div class="rep-tools">${segHtml('r-n', { 1: '1 mėn.', 3: '3 mėn.', 6: '6 mėn.', 12: '12 mėn.', x: 'Pasirinkti' }, n)}
    ${n === 'x' ? `<input type="date" id="r-f" value="${from}" style="width:auto"><input type="date" id="r-t" value="${to}" style="width:auto">` : ''}
    <a class="btn small" href="api/export.csv?nuo=${from}&iki=${to}" download>⬇ CSV (Excel)</a></div>
  <p class="small muted no-print" style="margin:-4px 4px 12px">Patogiausia spausdinti ar išsaugoti PDF kompiuteryje (🖨 → „Išsaugoti kaip PDF“). Telefone ataskaitą galima tiesiog parodyti gydytojui.</p>
  <div class="report">
  <div class="card rep-head"><h1>Galvos skausmo dienoraštis</h1>
    <div><b>${esc(S.profile.name)}</b> · ${dayNice(from, true)} – ${dayNice(to, true)} (${nd} d.)</div>
    <div class="small muted">Sudaryta ${dayNice(T(), true)} Duomenys iš asmeninio dienoraščio (programa „Sveikata“).</div></div>
  <h2>Santrauka</h2>
  <div class="tiles">
    <div class="card tile"><b>${painN}</b><span>skausmo dienų iš ${nd} (≈${fmt1(perMonth)} per mėn.)</span></div>
    <div class="card tile"><b>${migN}</b><span>migrenos dienų</span></div>
    <div class="card tile"><b>${eps.length}</b><span>skausmo epizodų</span></div>
    <div class="card tile"><b>${ints.length ? fmt1(ints.reduce((a, b) => a + b, 0) / ints.length) : '–'}</b><span>vid. stiprumas (0–10)${ints.length ? `, didž. ${Math.max(...ints)}` : ''}</span></div>
    <div class="card tile"><b>${durs.length ? (() => { const a = durs.reduce((x, y) => x + y, 0) / durs.length; return a < 1 ? Math.round(a * 60) + ' min.' : fmt1(a) + ' val.'; })() : '–'}</b><span>vid. trukmė${durs.length ? ` (ilgiausia ${fmt1(Math.max(...durs))} val.)` : ''}</span></div>
    <div class="card tile"><b>${acuteDays}</b><span>dienų su vaistais nuo skausmo</span></div>
    ${auraN ? `<div class="card tile"><b>${auraN}</b><span>epizodų su aura</span></div>` : ''}
    ${wdays.length ? `<div class="card tile"><b>${fmtMl(wavg)}</b><span>vid. išgerta per dieną${cafAvg ? `, kofeino ~${Math.round(cafAvg)} mg` : ''}</span></div>` : ''}
  </div>
  ${eps.length ? `<p class="small" style="margin:10px 4px 0">Tipas: ${Object.entries(kinds).map(([k, v]) => `${esc(KIND[k] || k)} – ${v}`).join(', ')}${Object.keys(impact).length ? `. Poveikis dienai: ${Object.entries(impact).map(([k, v]) => `${esc(IMPACT[k] || k).toLowerCase()} – ${v}`).join(', ')}` : ''}.</p>` : ''}
  ${overuse.length ? `<div class="warn" style="margin-top:12px">⚠️ ${overuse.map(r => `${MONTHS[+r.m.slice(5) - 1]}: ${r.trip ? `triptanai / kombinuoti ${r.trip} d.` : ''}${r.trip && r.simple ? ', ' : ''}${r.simple ? `paprasti nuskausminamieji ${r.simple} d.` : ''}`).join('; ')}. Vaistų nuo skausmo vartojimas ≥10 d./mėn. (triptanai, kombinuoti) arba ≥15 d./mėn. (paprasti nuskausminamieji) gali būti susijęs su vaistų sukeltu galvos skausmu – verta aptarti su gydytoju.</div>` : ''}
  <h2>Pagal mėnesius</h2>
  <div class="card tscroll"><table class="t"><thead><tr><th>Mėnuo</th><th class="n">Skausmo d.</th><th class="n">Migrenos d.</th><th class="n">Epizodai</th><th class="n">Vid. stipr.</th><th class="n">D. su vaistais</th><th class="n">Triptanai</th><th class="n">Nuskausm.</th></tr></thead>
    <tbody>${mrows.map(r => `<tr><td>${MONTHS[+r.m.slice(5) - 1]} ${r.m.slice(0, 4)}${r.days < 28 ? ` <span class="small muted">(${r.days} d.)</span>` : ''}</td><td class="n"><b>${r.pain}</b></td><td class="n">${r.mig}</td><td class="n">${r.eps}</td><td class="n">${r.avg == null ? '–' : fmt1(r.avg)}</td><td class="n">${r.acute}</td><td class="n">${r.trip}</td><td class="n">${r.simple}</td></tr>`).join('')}</tbody></table></div>
  <h2>Kalendorius</h2>
  <div class="mcal">${months.map(m => `<div class="card cal">${calendarHtml(m, false)}</div>`).join('')}</div>
  <div class="cal-leg" style="margin:6px 4px 0"><span><i style="background:var(--i1)"></i>stiprumas 1–3</span><span><i style="background:var(--i2)"></i>4–6</span><span><i style="background:var(--i3)"></i>7–10</span><span><i style="background:var(--i0)"></i>nenurodyta</span><span>💊 vaistai nuo skausmo</span></div>
  <h2>Vaistai ir jų poveikis</h2>
  ${Object.keys(medEff).length ? `<div class="card tscroll"><table class="t"><thead><tr><th>Vaistas</th><th>Rūšis</th><th class="n">Kartų</th><th class="n">Dienų</th><th class="n">✅ Padėjo</th><th class="n">🟡 Iš dalies</th><th class="n">❌ Nepadėjo</th></tr></thead>
    <tbody>${Object.entries(medEff).sort((a, b) => b[1].n - a[1].n).map(([mid, o]) => { const m = I.meds[mid] || {}; return `<tr><td><b>${esc(m.name || '?')}</b> ${esc(m.dose || '')}</td><td class="small">${esc((MED_KINDS[m.kind] || '').split(' (')[0])}</td><td class="n">${o.n}</td><td class="n">${o.days.size}</td><td class="n">${o.padejo}</td><td class="n">${o.is_dalies}</td><td class="n">${o.nepadejo}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="card empty">Vaistų šiuo laikotarpiu nepažymėta.</div>'}
  <div class="grid" style="margin-top:14px">
    ${barsBlock('Dažniausi galimi provokatoriai', counts('triggers'))}
    ${barsBlock('Simptomai', counts('symptoms'))}
    ${sideBlock}
    ${barsBlock('Skausmo vieta', counts('locs').filter(([k]) => !SIDES.includes(k)))}
    ${barsBlock('Skausmo pobūdis', counts('chars'))}
  </div>
  <h2>Visi įrašai</h2>
  ${eps.length ? `<div class="card tscroll"><table class="t"><thead><tr><th>Data</th><th>Laikas</th><th class="n">Trukmė</th><th class="n">Stipr.</th><th>Tipas</th><th>Vaistai</th><th>Simptomai</th><th>Provokatoriai</th><th>Pastabos</th></tr></thead>
    <tbody>${eps.map(e => `<tr><td class="nowrap">${e.start.slice(0, 10)}</td><td class="nowrap">${hhmm(e.start)}${e.ended ? '–' + hhmm(e.ended) : ''}</td><td class="n">${e.ended ? durTxt(e.start, e.ended) : 'tęsiasi'}</td><td class="n">${e.intensity ?? '–'}</td><td>${esc(e.kind ? KIND[e.kind] : '')}</td>
      <td>${dosesOf(e.id).map(d => `${esc(I.meds[d.med_id]?.name || '?')} ${hhmm(d.ts)}${d.effect ? ' ' + EFFECT[d.effect][0] : ''}`).join('<br>')}</td>
      <td class="small">${esc([...(e.locs || []), ...(e.chars || []), ...(e.symptoms || [])].join(', '))}</td><td class="small">${esc((e.triggers || []).join(', '))}</td><td class="small">${esc(e.notes || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty">Šiuo laikotarpiu įrašų nėra.</div>'}
  <h2>Klausimai gydytojui</h2>
  <div class="card pad"><textarea id="r-q" class="no-print" placeholder="Ką norite paklausti ar papasakoti gydytojui (išsaugoma automatiškai ir spausdinama)">${esc(S.profile.settings.doc_notes || '')}</textarea>
    <div class="print-only pre">${esc(S.profile.settings.doc_notes || '—')}</div></div>
  </div>`;
  bindSeg($('#r-n'));
  $('#r-n').addEventListener('click', () => setTimeout(() => { UI.repN = segVal($('#r-n')) || '3'; saveUI(); render(); }));
  $('#r-f') && ($('#r-f').onchange = $('#r-t').onchange = () => { UI.repFrom = $('#r-f').value; UI.repTo = $('#r-t').value; saveUI(); render(); });
  $('#r-print').onclick = () => window.print();
  let qt;
  $('#r-q').oninput = () => { clearTimeout(qt); qt = setTimeout(() => api('api/do/profile_save', { settings: { doc_notes: $('#r-q').value } }).then(r => { S.version = r.version; S.profile.settings.doc_notes = $('#r-q').value; $('.print-only.pre').textContent = $('#r-q').value || '—'; }), 700); };
};

// ============================================================ NUSTATYMAI
VIEWS.nustatymai = () => {
  setTop('Nustatymai');
  const p = S.profile, s = p.settings;
  view.innerHTML = `<div class="grid">
    <div class="card pad stack"><b>${esc(p.emoji)} Mano profilis</b>
      <div class="small muted">${S.me.ha_user ? `Šis profilis susietas su Home Assistant naudotoju <b>${esc(S.me.ha_name || '')}</b> – atidarius Sveikatą jis parenkamas automatiškai. Kiti mato tik savo duomenis.` : 'Profilis pasirinktas šiame įrenginyje.'}</div>
      <label class="field"><span>Vardas</span><input type="text" id="p-n" value="${esc(p.name)}"></label>
      <div><span class="lbl-s">Ženkliukas</span><div class="emojis" id="p-e">${EMOJIS.map(e => `<button type="button" class="${e === p.emoji ? 'on' : ''}">${e}</button>`).join('')}</div></div>
      <label class="field"><span>Dienos vandens tikslas, ml</span><input type="number" inputmode="numeric" id="p-g" value="${p.goal_ml}" step="100"></label>
      <div class="small muted">Dažnai rekomenduojama ~30–35 ml vienam kūno svorio kilogramui (pvz. 70 kg → ~2,1–2,5 l). Daugiau – kai karšta ar sportuojate.</div>
      <button class="btn primary" id="p-save">Išsaugoti</button></div>

    <div class="card pad stack"><div class="row"><b class="grow">🥤 Gėrimai</b><button class="btn small" id="dt-add">＋ Gėrimas</button></div>
      <div class="small muted">Mygtukai skiltyje Vanduo (ir laikrodyje). Rodyklėmis – tvarka.</div>
      <div class="card list">${topTypes().map((t, i, a) => dtRow(t, i, a) + (isGroup(t) ? kidsOf(t.id).map((k, j, b) => dtRow(k, j, b, true)).join('') + `<div class="li sub" data-addk="${t.id}"><span class="ico">＋</span><div class="grow small muted">Pridėti rūšį: ${esc(t.name)}</div></div>` : '')).join('')}</div></div>

    <div class="card pad stack"><div class="row"><b class="grow">💊 Mano vaistai</b><button class="btn small" id="m-add">＋ Vaistas</button></div>
      <div class="small muted">Vaistai nuo galvos skausmo – kad pažymėti užtektų vieno paspaudimo. Rūšis svarbi ataskaitai gydytojui.</div>
      <div class="card list">${meds().map(m => `<div class="li" data-med="${m.id}"><span class="ico">💊</span><div class="grow"><b>${esc(m.name)}</b> <span class="small muted">${esc(m.dose || '')}</span><div class="small muted">${esc((MED_KINDS[m.kind] || '').split(' (')[0])}</div></div><span class="muted">›</span></div>`).join('') || '<div class="empty">Dar nėra vaistų</div>'}</div></div>

    <div class="card pad stack" id="nt"><b>🔔 Pranešimai telefone</b>
      <div id="nt-ph" class="small muted">Ieškoma telefonų…</div>
      <div class="tline"><div class="grow"><b>💧 Priminti atsigerti</b><span class="small muted">Tik jei atsiliekate nuo dienos tikslo ir seniai gėrėte. Pranešime – mygtukai „+250 ml“, veikia ir laikrodyje.</span></div><label class="switch"><input type="checkbox" id="nt-wr" ${s.wr_on ? 'checked' : ''}><i></i></label></div>
      <div class="mini2"><label class="field"><span>Nuo</span><input type="time" id="nt-f" value="${esc(s.wr_from)}"></label><label class="field"><span>Iki</span><input type="time" id="nt-t" value="${esc(s.wr_to)}"></label><label class="field"><span>Ne dažniau, val.</span><input type="number" id="nt-e" value="${esc(s.wr_every)}" step="0.5" min="1"></label></div>
      <div class="tline"><div class="grow"><b>💊 Paklausti, ar padėjo vaistai</b><span class="small muted">Praėjus nurodytam laikui po vaisto – pranešimas su mygtukais „Padėjo / Iš dalies / Nepadėjo“.</span></div><label class="switch"><input type="checkbox" id="nt-mc" ${s.mc_on ? 'checked' : ''}><i></i></label></div>
      <label class="field"><span>Po kiek valandų klausti</span><input type="number" id="nt-h" value="${esc(s.mc_hours)}" step="0.5" min="0.5"></label>
      <div class="row wrap"><button class="btn primary" id="nt-save">Išsaugoti</button><button class="btn" id="nt-test">📨 Išbandyti</button></div>
      <div class="small muted" id="nt-st"></div></div>

    <div class="card pad stack"><b>⌚ Laikrodis</b>
      <div class="small muted">Wear OS laikrodžio programėlė „Sveikata“: ciferblatas su vandens „＋“, komplikacija ir plytelė. Įrašai iš laikrodžio iškart atsiranda čia.</div>
      <a class="btn" href="#laikrodis">Susieti laikrodį</a></div>

    <div class="card pad stack"><b>💾 Duomenys</b>
      <div class="small muted">Duomenys automatiškai patenka į Home Assistant atsargines kopijas. Čia galima atsisiųsti atskirai.</div>
      <a class="btn" href="api/export.csv" download>⬇ Galvos skausmų įrašai (CSV, Excel)</a>
      <a class="btn" href="api/export" download>💾 Visi mano duomenys (JSON)</a>
      <label class="btn">⬆ Importuoti galvos skausmų įrašus<input type="file" id="imp-f" accept=".json,application/json" hidden></label></div>

    <div class="card pad stack"><b>👤 Profilis</b>
      <label class="field"><span>Profilio PIN (nebūtina)</span><input type="password" inputmode="numeric" id="p-pin" placeholder="${p.has_pin ? 'Nustatytas – įrašykite naują arba palikite' : 'Nenustatytas'}"></label>
      <div class="small muted">PIN klausiamas, kai profilis renkamas ne per HA programėlę (pvz. naršyklėje per ${location.port || 'atskirą'} prievadą) arba kai jį nori pasirinkti kitas HA naudotojas.</div>
      <button class="btn" id="p-pin-s">Išsaugoti PIN</button>
      <button class="btn" id="p-leave">🔄 Keisti profilį šiame įrenginyje</button>
      <button class="btn danger" id="p-del">Ištrinti profilį ir visus jo duomenis</button></div>
  </div>`;
  let emoji = p.emoji;
  $('#p-e').onclick = e => { const b = e.target.closest('button'); if (!b) return; emoji = b.textContent; $$('#p-e button').forEach(x => x.classList.toggle('on', x === b)); };
  $('#p-save').onclick = async () => { await act('profile_save', { name: $('#p-n').value, emoji, goal_ml: +$('#p-g').value }); toast('Išsaugota'); };
  $('#p-pin-s').onclick = async () => { await act('profile_save', { pin: $('#p-pin').value }); toast($('#p-pin').value ? 'PIN nustatytas' : 'PIN panaikintas'); };
  $('#p-leave').onclick = () => confirmSheet('Keisti profilį?', 'Keisti', async () => { await api('api/profile/leave', {}); S = null; location.hash = ''; boot(); },
    S.me.ha_user ? 'Šis HA naudotojas bus atsietas nuo profilio. Duomenys neišnyks – vėl pasirinkite tą patį profilį arba sukurkite naują.' : '');
  $('#p-del').onclick = () => openSheet(`<h3>Ištrinti profilį „${esc(p.name)}“?</h3><p class="muted" style="margin:-6px 2px 10px">Bus ištrinti visi šio profilio įrašai: gėrimai, galvos skausmai, vaistai. Atkurti bus galima tik iš HA atsarginės kopijos.</p>
    <label class="field"><span>Įrašykite TRINTI</span><input type="text" id="pd-c" autocomplete="off"></label>
    <div class="sheet-actions"><button class="btn" data-x>Atšaukti</button><button class="btn danger" id="pd-ok">Ištrinti</button></div>`, el => {
    $('[data-x]', el).onclick = closeSheet;
    $('#pd-ok', el).onclick = async () => { await api('api/do/profile_delete', { confirm: $('#pd-c', el).value.trim().toUpperCase() }); closeSheet(); S = null; location.hash = ''; boot(); };
  });
  $('#imp-f').onchange = async ev => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch (e) { return toast('Netinkamas failas'); }
    if (!Array.isArray(data.episodes)) return toast('Faile nėra galvos skausmų įrašų');
    const c = await api('api/do/import', { episodes: data.episodes, dry: true });
    openSheet(`<h3>⬆ Importuoti įrašus?</h3><div class="stack">
      <p style="margin:0">Į profilį <b>${esc(S.profile.name)}</b> bus įrašyta <b>${c.episodes}</b> galvos skausmų įrašų${c.from ? ` (${esc(dayNice(c.from.slice(0, 10), true))} – ${esc(dayNice(c.to.slice(0, 10), true))})` : ''}${c.doses ? `, ${c.doses} vaistų žymų` : ''}.</p>
      ${c.skipped ? `<p class="small muted" style="margin:0">${c.skipped} praleista – tokie jau yra arba be datos.</p>` : ''}
      ${c.meds_new ? `<p class="small muted" style="margin:0">Bus pridėta naujų vaistų: ${c.meds_new}. Jų rūšį vėliau galite patikslinti Nustatymuose.</p>` : ''}
      <div class="sheet-actions"><button class="btn" data-x>Atšaukti</button><button class="btn primary" id="imp-ok" ${c.episodes ? '' : 'disabled'}>Importuoti</button></div></div>`, el => {
      $('[data-x]', el).onclick = closeSheet;
      $('#imp-ok', el).onclick = async () => { const r = await api('api/do/import', { episodes: data.episodes }); closeSheet(); await load(); toast(`Importuota: ${r.episodes} įrašų`); };
    });
  };
  $('#dt-add').onclick = () => drinkTypeSheet(null);
  $$('[data-dt]').forEach(r => r.onclick = e => { if (e.target.closest('[data-up],[data-dn]')) return; drinkTypeSheet(I.drink_types[r.dataset.dt]); });
  $$('[data-addk]').forEach(r => r.onclick = () => drinkTypeSheet(null, +r.dataset.addk));
  const move = async (id, dir) => { const t0 = I.drink_types[id], p0 = parentOf(t0); const ids = (p0 ? kidsOf(p0.id) : topTypes()).map(t => t.id); const i = ids.indexOf(id), j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await act('order', { t: 'drink_types', ids }); };
  $$('[data-up]').forEach(b => b.onclick = () => move(+b.dataset.up, -1));
  $$('[data-dn]').forEach(b => b.onclick = () => move(+b.dataset.dn, 1));
  $('#m-add').onclick = () => medSheet(null);
  $$('[data-med]').forEach(r => r.onclick = () => medSheet(I.meds[r.dataset.med]));
  // pranešimai
  let phones = [...(s.notify || [])];
  const drawPhones = st => {
    const all = st.all || [];
    if (!st.ha) { $('#nt-ph').innerHTML = 'Pranešimai veikia tik kai programa paleista Home Assistant priede.'; return; }
    $('#nt-ph').innerHTML = `<div style="margin-bottom:4px">${s.notify?.length ? 'Pasirinkti telefonai:' : st.auto?.length ? `Automatiškai rastas jūsų telefonas: <b>${esc(st.auto.join(', '))}</b>. Jei reikia kito – pažymėkite:` : 'Telefonas automatiškai nerastas – pažymėkite savo:'}</div>
      <div class="chips">${all.map(x => `<button type="button" class="chip ${phones.includes(x) ? 'on' : ''}" data-ph="${esc(x)}">📱 ${esc(x.replace('mobile_app_', ''))}</button>`).join('') || '<span>HA programėlių nerasta</span>'}</div>`;
    $$('[data-ph]').forEach(b => b.onclick = () => { b.classList.toggle('on'); phones = $$('[data-ph].on').map(x => x.dataset.ph); });
    $('#nt-st').textContent = st.error ? '⚠️ ' + st.error : st.last ? 'Paskutinis išsiųstas: ' + tsNice(st.last) : '';
  };
  api('api/notify_status').then(drawPhones).catch(() => { });
  const ntSave = () => act('profile_save', { settings: { notify: phones, wr_on: $('#nt-wr').checked, wr_from: $('#nt-f').value, wr_to: $('#nt-t').value, wr_every: +$('#nt-e').value || 2, mc_on: $('#nt-mc').checked, mc_hours: +$('#nt-h').value || 2 } }, true);
  $('#nt-save').onclick = async () => { await ntSave(); toast('Išsaugota'); };
  $('#nt-test').onclick = async () => {
    await ntSave();
    try { await api('api/do/notify_test', {}); toast('Išsiųsta – patikrinkite telefoną'); } catch (e) { }
    api('api/notify_status').then(drawPhones).catch(() => { });
  };
};

function dtRow(t, i, a, sub) {
  return `<div class="li${sub ? ' sub' : ''}" data-dt="${t.id}"><span class="ico">${esc(t.emoji)}</span><div class="grow"><b>${esc(t.name)}</b> <span class="small muted">${isGroup(t) ? 'paspaudus – pasirinkimas' : `${t.ml} ml${t.in_goal ? '' : ' · neįskaičiuojama į tikslą'}${t.caffeine ? ` · ☕ ${t.caffeine} mg` : ''}`}</span></div>
        <button class="x" data-up="${t.id}" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>↑</button><button class="x" data-dn="${t.id}" ${i === a.length - 1 ? 'disabled style="opacity:.3"' : ''}>↓</button></div>`;
}
function drinkTypeSheet(t, parent) {
  let emoji = t ? t.emoji : (parent ? I.drink_types[parent].emoji : '🥤');
  const par = t ? (parentOf(t)?.id || 0) : (parent || 0);
  const groupOpts = t && isGroup(t) ? null : topTypes().filter(g => !t || g.id !== t.id);
  openSheet(`<h3>${t ? 'Gėrimas' : 'Naujas gėrimas'}</h3><div class="stack">
    <div class="fgrid"><label class="field"><span>Pavadinimas</span><input type="text" id="t-n" value="${esc(t?.name || '')}" placeholder="pvz. Mineralinis"></label>
      <label class="field"><span>Įprastas kiekis, ml</span><input type="number" inputmode="numeric" id="t-ml" value="${t?.ml || 250}"></label></div>
    <div><span class="lbl-s">Ženkliukas</span><div class="emojis" id="t-e">${DRINK_EMOJIS.map(e => `<button type="button" class="${e === emoji ? 'on' : ''}">${e}</button>`).join('')}</div></div>
    ${groupOpts ? `<label class="field"><span>Rodyti kaip rūšį po (paspaudus jį – iššoka pasirinkimas)</span><select id="t-p"><option value="0">– atskiras mygtukas –</option>${groupOpts.map(g => `<option value="${g.id}" ${g.id === par ? 'selected' : ''}>${esc(g.emoji)} ${esc(g.name)}</option>`).join('')}</select></label>` : '<div class="small muted">Šis gėrimas turi rūšių – paspaudus iššoka pasirinkimas. Kiekis ir kofeinas imami iš rūšių.</div>'}
    <label class="check"><input type="checkbox" id="t-g" ${!t || t.in_goal ? 'checked' : ''}> Skaičiuoti į vandens tikslą</label>
    <label class="field"><span>Kofeino viename įprastame kiekyje, mg (kava ~80, arbata ~40, 0 – nėra)</span><input type="number" inputmode="numeric" id="t-c" value="${t?.caffeine || 0}"></label>
    <div class="sheet-actions">${t ? '<button class="btn danger" id="t-del">Pašalinti</button>' : '<button class="btn" data-x>Atšaukti</button>'}<button class="btn primary" id="t-ok">Išsaugoti</button></div></div>`, el => {
    $('#t-e', el).onclick = e => { const b = e.target.closest('button'); if (!b) return; emoji = b.textContent; $$('#t-e button', el).forEach(x => x.classList.toggle('on', x === b)); };
    $('[data-x]', el) && ($('[data-x]', el).onclick = closeSheet);
    $('#t-del', el) && ($('#t-del', el).onclick = async () => { closeSheet(); await delRow('drink_types', t.id); toast('Pašalinta'); });
    $('#t-ok', el).onclick = async () => {
      const row = { name: $('#t-n', el).value, emoji, ml: +$('#t-ml', el).value || 250, in_goal: $('#t-g', el).checked ? 1 : 0, caffeine: +$('#t-c', el).value || 0 };
      if ($('#t-p', el)) row.parent = +$('#t-p', el).value || 0;
      if (!row.name.trim()) return toast('Įrašykite pavadinimą');
      if (t) row.id = t.id;
      closeSheet(); await saveRow('drink_types', row);
    };
  });
}
function medSheet(m) {
  openSheet(`<h3>${m ? '💊 ' + esc(m.name) : 'Naujas vaistas'}</h3><div class="stack">
    <div class="fgrid"><label class="field"><span>Pavadinimas</span><input type="text" id="v-n" value="${esc(m?.name || '')}" placeholder="pvz. Ibuprofenas"></label>
      <label class="field"><span>Dozė</span><input type="text" id="v-d" value="${esc(m?.dose || '')}" placeholder="pvz. 400 mg"></label></div>
    <label class="field"><span>Rūšis</span><select id="v-k">${Object.entries(MED_KINDS).map(([k, v]) => `<option value="${k}" ${k === (m?.kind || 'nvnu') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    <div class="sheet-actions">${m ? '<button class="btn danger" id="v-del">Pašalinti</button>' : '<button class="btn" data-x>Atšaukti</button>'}<button class="btn primary" id="v-ok">Išsaugoti</button></div></div>`, el => {
    $('[data-x]', el) && ($('[data-x]', el).onclick = closeSheet);
    $('#v-del', el) && ($('#v-del', el).onclick = async () => { closeSheet(); await delRow('meds', m.id); toast('Pašalinta (istorija išlieka)'); });
    $('#v-ok', el).onclick = async () => {
      const row = { name: $('#v-n', el).value, dose: $('#v-d', el).value, kind: $('#v-k', el).value };
      if (!row.name.trim()) return toast('Įrašykite pavadinimą');
      if (m) row.id = m.id;
      closeSheet(); await saveRow('meds', row);
    };
  });
}

// --- Laikrodis
let watchTimer = null;
VIEWS.laikrodis = async () => {
  setTop('Laikrodis', '', true);
  clearInterval(watchTimer);
  view.innerHTML = '<div class="empty">Tikrinama…</div>';
  let w = {}; try { w = await (await fetch('api/laikrodis')).json(); } catch (e) { w = { error: 'Nėra ryšio' }; }
  if (route[0] !== 'laikrodis') return;
  if (!w.via_ha) {
    view.innerHTML = `<div class="card pad"><p style="margin:0">Laikrodį galima susieti tik atidarius Sveikatą per <b>Home Assistant</b> (šoninis meniu → Sveikata).</p></div>`;
    return;
  }
  const url = w.url || w.auto_url || '';
  view.innerHTML = `<div class="card pad stack">
    <p style="margin:0">Laikrodžio programėlė <b>„Sveikata“</b> (Wear OS): ciferblatas su vandens „＋“, komplikacija bet kuriam ciferblatui, plytelė ir programėlė su gėrimais, galvos skausmo ir vaistų žymėjimu. Ji jungiasi prie Home Assistant, todėl veikia ir ne namie. Kaip įsidiegti – priedo skirtuke <b>Dokumentacija</b>.</p>
    <p class="small muted" style="margin:0">Laikrodis susiejamas su šiuo profiliu – <b>${esc(S.profile.emoji)} ${esc(S.profile.name)}</b>. Antras žmogus savo laikrodį susieja atidaręs Sveikatą savo telefone.</p></div>
    <h2>1. Ryšys su Home Assistant</h2>
    <div class="card pad stack">
      <label class="field"><span>HA adresas iš išorės</span><input type="text" inputmode="url" id="w-url" value="${esc(url)}" placeholder="https://xxxx.ui.nabu.casa" autocomplete="off"></label>
      <label class="field"><span>Ilgalaikis prieigos raktas ${w.has_token ? '<b style="color:var(--ok)">✓ įrašytas</b>' : ''}</span><input type="password" id="w-tok" placeholder="${w.has_token ? 'Palikite tuščią, jei nekeičiate' : 'Įklijuokite raktą'}" autocomplete="off"></label>
      <p class="muted small" style="margin:0">Raktas: HA → apačioje kairėje jūsų vardas → skirtukas <b>Sauga</b> → <b>Ilgalaikiai prieigos raktai</b> → <b>Sukurti raktą</b> (pavadinimas „Laikrodis Sveikata“) → nukopijuokite ir įklijuokite čia. Raktas turi būti administratoriaus paskyros. Tai daroma vieną kartą – tinka abiem profiliams.</p>
      <button class="btn primary" id="w-save">Išsaugoti ir patikrinti</button>
      <div id="w-res"></div>
    </div>
    <h2>2. Susieti laikrodį</h2>
    <div class="card pad stack">
      <p style="margin:0">Laikrodis turi būti prijungtas prie namų Wi-Fi. Atidarykite jame <b>Sveikata</b>, paspauskite žemiau esantį mygtuką ir laikrodyje įveskite kodą.</p>
      <div id="w-code"></div>
      <p class="muted small" style="margin:0">Jei laikrodis paprašys HA IP adreso: <b>${w.ip ? esc(w.ip) : 'žr. HA → Nustatymai → Sistema → Tinklas'}</b></p>
      <button class="btn" id="w-new" ${w.has_token && w.url ? '' : 'disabled'}>Gauti susiejimo kodą</button>
    </div>`;
  const showCode = (code, left) => {
    clearInterval(watchTimer);
    const until = Date.now() + left * 1000;
    const draw = () => {
      const s = Math.round((until - Date.now()) / 1000);
      if (route[0] !== 'laikrodis' || s <= 0) { clearInterval(watchTimer); $('#w-code') && ($('#w-code').innerHTML = s <= 0 ? '<p class="muted small" style="margin:0">Kodas nebegalioja.</p>' : ''); return; }
      $('#w-code').innerHTML = `<div style="font-size:44px;font-weight:800;letter-spacing:6px;text-align:center">${code.slice(0, 3)} ${code.slice(3)}</div><p class="muted small center" style="margin:0">Galioja dar ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</p>`;
    };
    draw(); watchTimer = setInterval(draw, 1000);
  };
  if (w.code) showCode(w.code, w.left);
  $('#w-save').onclick = async () => {
    const b = $('#w-save'); b.disabled = true; $('#w-res').innerHTML = '<p class="muted small" style="margin:0">Tikrinama… (iki 10 s)</p>';
    let r = {}; try { r = await api('api/laikrodis/nustatymai', { url: $('#w-url').value, token: $('#w-tok').value }); } catch (e) { r = { error: 'Nepavyko' }; }
    b.disabled = false;
    if (r.ok) { toast('Viskas veikia'); VIEWS.laikrodis(); return; }
    $('#w-res').innerHTML = `<p style="margin:0">⚠️ ${esc(r.error || 'Nepavyko')}</p>`;
  };
  $('#w-new').onclick = async () => {
    let r = {}; try { r = await api('api/laikrodis/kodas', {}); } catch (e) { r = {}; }
    if (r.code) showCode(r.code, r.left); else toast(r.error || 'Nepavyko');
  };
};

// ============================================================ profilio pasirinkimas
async function boot() {
  let me;
  try { me = await api('api/me'); } catch (e) { view.innerHTML = '<div class="empty">Nepavyko įkelti. Perkraukite puslapį.</div>'; return; }
  if (me.profile) { await load(); return; }
  $('#tabs').hidden = true; $('#me').hidden = true;
  setTop('Sveikata');
  let emoji = EMOJIS[0];
  view.innerHTML = `<div class="welcome stack">
    <div class="center"><img src="icon-192.png" alt="" width="84" height="84" style="border-radius:22px"></div>
    <h2 style="justify-content:center;font-size:22px;margin:4px 0 0">Sveiki${me.ha_name ? ', ' + esc(me.ha_name) : ''}!</h2>
    <p class="center muted" style="margin:0 10px">Čia – galvos skausmų dienoraštis ir išgerto vandens sekimas. Kiekvienas žmogus turi savo profilį ir mato tik savo duomenis.${me.ha_user ? ' Profilis bus susietas su jūsų Home Assistant naudotoju – kitą kartą atsidarys iš karto.' : ''}</p>
    <div class="card pad stack"><b>Sukurti mano profilį</b>
      <label class="field"><span>Vardas</span><input type="text" id="w-n" value="${esc(me.ha_name || '')}" placeholder="pvz. Algis"></label>
      <div class="emojis" id="w-e">${EMOJIS.map((e, i) => `<button type="button" class="${i === 0 ? 'on' : ''}">${e}</button>`).join('')}</div>
      <button class="btn primary" id="w-c">Sukurti</button></div>
    ${me.candidates.length ? `<div class="card pad stack"><b>Arba – tai jau esamas mano profilis</b>${me.candidates.map(c => `<button class="btn block" data-c="${c.id}" data-pin="${c.has_pin ? 1 : 0}" style="justify-content:flex-start">${esc(c.emoji)} ${esc(c.name)}${c.has_pin ? ' 🔒' : ''}</button>`).join('')}</div>` : ''}
  </div>`;
  $('#w-e').onclick = e => { const b = e.target.closest('button'); if (!b) return; emoji = b.textContent; $$('#w-e button').forEach(x => x.classList.toggle('on', x === b)); };
  $('#w-c').onclick = async () => {
    const name = $('#w-n').value.trim(); if (!name) return toast('Įrašykite vardą');
    await api('api/profile/create', { name, emoji });
    location.hash = 'vanduo'; await load(); toast('Profilis sukurtas. Gėrimus ir vaistus galite pasikeisti Nustatymuose.', null, 5000);
  };
  $$('[data-c]').forEach(b => b.onclick = async () => {
    if (b.dataset.pin === '1' && !b.nextElementSibling?.matches('.pinrow')) {
      const row = document.createElement('div'); row.className = 'row pinrow';
      row.innerHTML = '<input type="password" inputmode="numeric" placeholder="Profilio PIN"><button class="btn primary">Gerai</button>';
      b.after(row); $('input', row).focus();
      $('button', row).onclick = async () => { await api('api/profile/claim', { id: +b.dataset.c, pin: $('input', row).value }); location.hash = 'vanduo'; await load(); };
      return;
    }
    if (b.dataset.pin === '1') return;
    await api('api/profile/claim', { id: +b.dataset.c, pin: '' });
    location.hash = 'vanduo'; await load();
  });
}

boot();
