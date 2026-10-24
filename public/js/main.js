// Клиент: сеть, состояние, управление, интерфейс.
import * as R from './render.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isk = (n) => Math.round(n).toLocaleString('ru-RU') + ' ISK';
const num = (n) => Math.round(n).toLocaleString('ru-RU');
const AU = 1.496e11;

function fmtDist(m) {
  if (m < 10000) return num(m) + ' м';
  if (m < 0.05 * AU) return num(m / 1000) + ' км';
  return (m / AU).toFixed(1) + ' а.е.';
}
function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}ч ${m}м` : m ? `${m}м ${s}с` : `${s}с`;
}
function secColor(sec) {
  const t = [[1, '#2fefef'], [0.9, '#48f0c0'], [0.8, '#00ef47'], [0.7, '#00f000'], [0.6, '#8fef2f'], [0.5, '#efef00'],
    [0.4, '#d77700'], [0.3, '#f06000'], [0.2, '#f04800'], [0.1, '#d73000']];
  const r = Math.round(sec * 10) / 10;
  for (const [v, c] of t) if (r >= v - 0.001) return c;
  return '#f00000';
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
function setHTML(el, html) { if (el._h !== html) { el.innerHTML = html; el._h = html; } }

// ======================================================================
// Состояние
// ======================================================================
const S = {
  ws: null, data: null, name: '', sys: null, me: null, meRec: null, ents: new Map(), prof: null,
  sel: null, active: null, docked: null, route: [], members: [], chatCh: 'local', chat: { local: [], global: [] },
  ovFilter: 'all', orbitRange: 5000, keepRange: 10000, stTab: 'hangar', market: null, agents: null, win: null,
  pendingModule: null, interval: 100
};

function send(msg) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(msg)); }

// ======================================================================
// Вход и сеть
// ======================================================================
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  S.ws = new WebSocket(`${proto}://${location.host}`);
  S.ws.onopen = () => {
    $('#lg-err').textContent = '';
    send({ t: 'login', name: $('#lg-name').value, pass: $('#lg-pass').value });
  };
  S.ws.onmessage = (ev) => onMsg(JSON.parse(ev.data));
  S.ws.onclose = () => {
    if (S.data) { $('#ui').classList.add('hidden'); $('#login').classList.remove('hidden'); $('#lg-err').textContent = 'Соединение с сервером потеряно'; S.data = null; }
    S.ws = null;
  };
}
$('#lg-go').onclick = () => { localStorage.setItem('vf-name', $('#lg-name').value); if (S.ws) S.ws.close(); connect(); };
$('#lg-pass').onkeydown = (e) => { if (e.key === 'Enter') $('#lg-go').click(); };
try { $('#lg-name').value = localStorage.getItem('vf-name') || ''; } catch {}

function onMsg(m) {
  switch (m.t) {
    case 'loginErr': $('#lg-err').textContent = m.msg; S.ws.close(); break;
    case 'welcome':
      S.data = m.data; S.name = m.name;
      $('#login').classList.add('hidden'); $('#ui').classList.remove('hidden');
      S.stationById = Object.fromEntries(m.data.stations.map(s => [s.id, s]));
      S.sysById = Object.fromEntries(m.data.systems.map(s => [s.id, s]));
      addChat('local', '*', `Добро пожаловать, пилот ${m.name}! Нажмите H или «?» слева, чтобы узнать управление.`);
      break;
    case 'system':
      S.sys = m; S.ents.clear(); S.sel = null; S.active = null; S.meRec = null;
      S.celById = Object.fromEntries(m.celestials.map(c => [c.id, c]));
      R.setSystem(m);
      clearBrackets();
      if (S.route.length && S.route[S.route.length - 1] === m.id) S.route = [];
      else if (S.route.includes(m.id)) S.route = S.route.slice(S.route.indexOf(m.id));
      updateSysInfo();
      break;
    case 'state': onState(m); break;
    case 'profile': S.prof = m; onProfile(); break;
    case 'docked': {
      const c = S.celById && S.celById[m.station];
      S.docked = { id: m.station, name: m.name, sys: m.sys, style: c ? c.style : 0 };
      S.me = null; S.meRec = null; S.ents.clear(); clearBrackets();
      showStation(); break;
    }
    case 'undocked': S.docked = null; hideStation(); break;
    case 'note': note(m.text, m.kind); break;
    case 'chat': addChat(m.ch, m.from, m.text); break;
    case 'local': S.members = m.members; renderMembers(); break;
    case 'market': S.market = m; if (S.docked && (S.stTab === 'market' || S.stTab === 'exchange')) renderStation(); break;
    case 'agents': S.agents = m.offers; if (S.docked && S.stTab === 'agents') renderStation(); break;
    case 'route': S.route = m.route; updateSysInfo(); if (!$('#map').classList.contains('hidden')) drawMap(); break;
    case 'destroyed':
      modal(`<h3 style="color:var(--bad)">Корабль уничтожен</h3><p>Ваш «${esc(m.ship)}» уничтожен. Нападавший: <b>${esc(m.killer)}</b>.</p>
        <p>Страховая выплата: <span class="isk">${isk(m.insurance)}</span></p><p class="muted">Вы очнулись в клоне на домашней станции.</p>`, [['Понятно', null]]);
      break;
    case 'confirmAttack':
      modal(`<h3 style="color:var(--warn)">Предупреждение</h3><p>${esc(m.msg)}</p>`, [['Отмена', null], ['Атаковать', () => { if (S.pendingModule) send({ ...S.pendingModule, confirm: true }); }, 'danger']]);
      break;
  }
}

// ---------- снимки состояния и интерполяция ----------
function onState(m) {
  const now = performance.now();
  if (S.lastStateAt) S.interval = S.interval * 0.9 + Math.min(300, now - S.lastStateAt) * 0.1;
  S.lastStateAt = now;
  S.clockSkew = m.now - Date.now();
  const me = m.me;
  if (!S.meRec) S.meRec = { prev: me.p, cur: me.p, dp: me.p, t0: now };
  else {
    const jump = len(sub(me.p, S.meRec.cur)) > 5e5 && !me.warp && !(S.me && S.me.warp);
    S.meRec.prev = jump ? me.p : S.meRec.dp; S.meRec.cur = me.p; S.meRec.t0 = now;
  }
  S.me = me;
  const seen = new Set();
  for (const e of m.ents) {
    seen.add(e.id);
    const old = S.ents.get(e.id);
    if (old) { e.prev = old.dp; e.cur = e.p; e.dp = old.dp; e.t0 = now; }
    else { e.prev = e.cur = e.dp = e.p; e.t0 = now; }
    S.ents.set(e.id, e);
  }
  for (const id of [...S.ents.keys()]) if (!seen.has(id)) S.ents.delete(id);
  if (S.sel && !S.ents.has(S.sel) && !(S.celById && S.celById[S.sel])) S.sel = null;
  if (S.active && !me.locks.includes(S.active)) S.active = me.locks[0] || null;
  if (m.fx) for (const fx of m.fx) R.addFx(fx, viewState());
  R.setMyShip(me.st, S.data);
}

function interp(rec, now) {
  const a = Math.min(1.25, (now - rec.t0) / S.interval);
  rec.dp = [rec.prev[0] + (rec.cur[0] - rec.prev[0]) * a, rec.prev[1] + (rec.cur[1] - rec.prev[1]) * a, rec.prev[2] + (rec.cur[2] - rec.prev[2]) * a];
}

function viewState() {
  return {
    origin: S.meRec ? S.meRec.dp : [0, 0, 0], me: S.me, ents: S.ents, data: S.data, docked: S.docked,
    dockedShip: S.prof && S.prof.ship ? S.prof.ship.type : null
  };
}

// ======================================================================
// Объекты: поиск, расстояния, типы
// ======================================================================
function getObj(id) {
  const e = S.ents.get(id);
  if (e) return { ...e, pos: e.dp, kind: e.k === 's' ? 'ship' : e.k === 'a' ? 'asteroid' : 'wreck', radius: e.r || 0 };
  const c = S.celById && S.celById[id];
  if (c) return { ...c, n: c.name };
  return null;
}
function distTo(o) {
  if (!S.meRec) return 0;
  const myR = S.data.ships[S.me.st].radius;
  const r = o.kind === 'planet' || o.kind === 'sun' || o.kind === 'station' || o.kind === 'gate' || o.kind === 'ship' || o.kind === 'asteroid' || o.kind === 'wreck' ? (o.radius || 0) : 0;
  return Math.max(0, len(sub(o.pos, S.meRec.dp)) - r - myR);
}
const KIND = {
  sun: ['☀', 'Звезда'], planet: ['◍', 'Планета'], station: ['⌂', 'Станция'], belt: ['⁂', 'Пояс астероидов'], gate: ['⊚', 'Звёздные врата'],
  asteroid: ['◆', 'Астероид'], wreck: ['⌧', 'Обломки']
};
function iconOf(o) {
  if (o.kind === 'ship') return o.gd ? '✠' : o.npc ? '▼' : '▲';
  return (KIND[o.kind] || ['•'])[0];
}
function typeOf(o) {
  if (o.kind === 'ship') return o.gd ? 'Страж порядка' : S.data.ships[o.st] ? S.data.ships[o.st].name : 'Корабль';
  if (o.kind === 'asteroid') return S.data.items[o.ore].name;
  return (KIND[o.kind] || ['', ''])[1];
}
function isHostile(o) {
  if (o.kind !== 'ship') return false;
  return !!(o.npc || o.cr || o.su || o.ag);
}
function allObjects() {
  const list = [];
  for (const e of S.ents.values()) list.push(getObj(e.id));
  if (S.sys) for (const c of S.sys.celestials) list.push({ ...c, n: c.name });
  return list;
}

// ======================================================================
// Действия
// ======================================================================
function act(a, id) {
  id = id || S.sel;
  if (!id && !['stop'].includes(a)) return;
  const o = getObj(id);
  switch (a) {
    case 'approach': send({ t: 'approach', id }); break;
    case 'orbit': send({ t: 'orbit', id, range: S.orbitRange }); break;
    case 'keep': send({ t: 'keep', id, range: S.keepRange }); break;
    case 'warp': send({ t: 'warp', id }); break;
    case 'dock': send({ t: 'dock', id }); break;
    case 'jump': send({ t: 'jump', id }); break;
    case 'lock': send({ t: 'lock', id }); break;
    case 'unlock': send({ t: 'unlock', id }); break;
    case 'loot': send({ t: 'loot', id }); break;
    case 'stop': send({ t: 'stop' }); break;
    case 'info': showInfo(o); break;
    case 'smart': {
      if (!o) return;
      const d = distTo(o);
      if (o.kind === 'station') act('dock', id);
      else if (o.kind === 'gate') act('jump', id);
      else if (d > 150000) act('warp', id);
      else if (o.kind === 'wreck') act('loot', id);
      else act('approach', id);
      break;
    }
  }
}

function actionsFor(o) {
  if (!o) return [];
  const d = distTo(o);
  const A = [];
  const far = d > 150000;
  if (o.kind === 'station') A.push(['dock', '⌂', 'Стыковка', 'D']);
  if (o.kind === 'gate') A.push(['jump', '⊚', 'Прыжок', 'D']);
  if (far) A.push(['warp', '»', 'Варп', 'S']);
  if (!far || o.kind === 'ship') {
    A.push(['approach', '→', 'Подлететь', 'Q']);
    if (o.kind !== 'sun' && o.kind !== 'planet') {
      A.push(['orbit', '↻', `Орбита ${S.orbitRange / 1000}км`, 'W']);
      A.push(['keep', '↔', `Дистанция ${S.keepRange / 1000}км`, 'E']);
    }
  }
  if (['ship', 'asteroid', 'wreck'].includes(o.kind)) {
    if (S.me && (S.me.locks.includes(o.id) || S.me.locking.some(l => l[0] === o.id))) A.push(['unlock', '⊗', 'Снять захват', '']);
    else A.push(['lock', '⌖', 'Захват', 'Ctrl']);
  }
  if (o.kind === 'wreck') A.push(['loot', '⇩', 'Обыскать', '']);
  A.push(['info', 'i', 'Информация', '']);
  return A;
}

function toggleModule(slot) {
  if (!S.me) return;
  const mod = S.me.mods[slot];
  if (!mod) return;
  const def = S.data.modules[mod.id];
  if (def.kind === 'passive') return;
  let target = S.active;
  if (!target && S.sel && S.me.locks.includes(S.sel)) target = S.sel;
  if (['weapon', 'miner', 'scram'].includes(def.kind) && !mod.a) {
    // для шахтёрского лазера ищем захваченный астероид, для орудий — корабль
    const want = def.kind === 'miner' ? 'a' : 's';
    const t = target && S.ents.get(target);
    if (!t || t.k !== want) {
      const alt = S.me.locks.map(id => S.ents.get(id)).find(e => e && e.k === want);
      if (alt) target = alt.id;
    }
  }
  S.pendingModule = { t: 'module', slot, target };
  send(S.pendingModule);
}

// ======================================================================
// Ввод
// ======================================================================
const canvas = $('#scene');
R.init(canvas);
let drag = null;
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) drag = { x: e.clientX, y: e.clientY, moved: 0 }; hideCtx(); });
addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = e.clientX; drag.y = e.clientY;
  R.cam.yaw -= dx * 0.006;
  R.cam.pitch = Math.max(-1.45, Math.min(1.45, R.cam.pitch + dy * 0.006));
});
addEventListener('mouseup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => {
  const minD = S.me ? S.data.ships[S.me.st].radius * 4 : 200;
  R.cam.target = Math.max(minD, Math.min(400000, R.cam.target * Math.pow(1.0015, e.deltaY)));
}, { passive: true });
canvas.addEventListener('dblclick', (e) => { if (S.me && !S.docked) send({ t: 'dir', dir: R.screenDir(e.clientX, e.clientY) }); });
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!S.docked) spaceMenu(e.clientX, e.clientY); });

addEventListener('keydown', (e) => {
  if (!S.data) return;
  const typing = document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
  if (e.key === 'Escape') { hideCtx(); closeWin(); $('#map').classList.add('hidden'); $('#modal').classList.add('hidden'); document.activeElement.blur(); return; }
  if (typing) return;
  const fk = /^F([1-8])$/.exec(e.key);
  if (fk) { e.preventDefault(); toggleModule(moduleOrder()[+fk[1] - 1]); return; }
  if (/^[1-8]$/.test(e.key) && !e.ctrlKey) { toggleModule(moduleOrder()[+e.key - 1]); return; }
  const k = e.code;
  if (k === 'Enter') { e.preventDefault(); $('#chat-in').focus(); return; }
  if (k === 'KeyM') return toggleMap();
  if (k === 'KeyC') return openWin('cargo');
  if (k === 'KeyK') return openWin('skills');
  if (k === 'KeyJ') return openWin('missions');
  if (k === 'KeyA' && !e.ctrlKey) return openWin('assets');
  if (k === 'KeyH') return openWin('help');
  if (S.docked) return;
  if (k === 'Space' && e.ctrlKey) { e.preventDefault(); return act('stop'); }
  if (k === 'KeyQ') act('approach');
  if (k === 'KeyW') act('orbit');
  if (k === 'KeyE') act('keep');
  if (k === 'KeyS') act('warp');
  if (k === 'KeyD') { const o = getObj(S.sel); if (o && o.kind === 'station') act('dock'); else if (o && o.kind === 'gate') act('jump'); }
  if (k === 'KeyL') act('lock');
  if (k === 'KeyX') act('stop');
  if (k === 'Tab') { e.preventDefault(); cycleTarget(); }
});

function cycleTarget() {
  if (!S.me || !S.me.locks.length) return;
  const i = S.me.locks.indexOf(S.active);
  S.active = S.me.locks[(i + 1) % S.me.locks.length];
}

function moduleOrder() {
  if (!S.me) return [];
  const out = [];
  S.me.mods.forEach((m, i) => { if (m && S.data.modules[m.id].kind !== 'passive') out.push(i); });
  return out;
}

function select(id, ev) {
  if (ev && (ev.ctrlKey || ev.metaKey)) { act('lock', id); return; }
  S.sel = id;
}

// ---------- контекстное меню ----------
function showCtx(x, y, title, items) {
  const el = $('#ctx');
  el.innerHTML = (title ? `<div class="ch">${esc(title)}</div>` : '') + items.map((it, i) => `<div class="ci" data-i="${i}">${esc(it[0])}</div>`).join('');
  el.classList.remove('hidden');
  el.style.left = Math.min(x, innerWidth - 220) + 'px';
  el.style.top = Math.min(y, innerHeight - el.offsetHeight - 10) + 'px';
  el.onclick = (e) => { const i = e.target.dataset.i; if (i != null) { hideCtx(); items[i][1](); } };
}
function hideCtx() { $('#ctx').classList.add('hidden'); }
addEventListener('mousedown', (e) => { if (!$('#ctx').contains(e.target)) hideCtx(); });

function objMenu(x, y, id) {
  const o = getObj(id);
  if (!o) return;
  S.sel = id;
  const items = actionsFor(o).map(([a, , label]) => [label, () => act(a, id)]);
  if (['ship', 'asteroid', 'station', 'gate'].includes(o.kind) && distTo(o) < 150000) {
    items.push(['Орбита на 1 / 2.5 / 10 / 20 км…', () => showCtx(x, y, 'Орбита', [1000, 2500, 5000, 10000, 20000].map(r => [`${r / 1000} км`, () => { S.orbitRange = r; act('orbit', id); }]))]);
  }
  if (distTo(o) > 150000) items.push(['Варп на 10 / 30 / 50 км…', () => showCtx(x, y, 'Варп на дистанцию', [10000, 30000, 50000].map(r => [`${r / 1000} км`, () => send({ t: 'warp', id, range: r })]))]);
  if (o.kind === 'gate') items.push(['Проложить маршрут в ' + S.sysById[o.dest].name, () => send({ t: 'autopilot', dest: o.dest })]);
  showCtx(x, y, o.n || o.name, items);
}

function spaceMenu(x, y) {
  if (!S.sys) return;
  const groups = [['Станции', 'station'], ['Звёздные врата', 'gate'], ['Пояса астероидов', 'belt'], ['Планеты', 'planet'], ['Звезда', 'sun']];
  const items = [];
  for (const [label, kind] of groups) {
    const cs = S.sys.celestials.filter(c => c.kind === kind);
    if (!cs.length) continue;
    items.push([`${label} ▸`, () => showCtx(x, y, label, cs.map(c => [c.name, () => {
      S.sel = c.id;
      if (kind === 'station') act('dock', c.id); else if (kind === 'gate') act('jump', c.id); else act('warp', c.id);
    }]))]);
  }
  items.push(['Стоп', () => act('stop')]);
  showCtx(x, y, 'Космос', items);
}

// ======================================================================
// Скобки объектов
// ======================================================================
const brackets = new Map();
const brRoot = $('#brackets');
function clearBrackets() { brRoot.innerHTML = ''; brackets.clear(); }
brRoot.addEventListener('click', (e) => { const b = e.target.closest('.br'); if (b) select(b.dataset.id, e); });
brRoot.addEventListener('dblclick', (e) => { const b = e.target.closest('.br'); if (b) act('smart', b.dataset.id); });
brRoot.addEventListener('contextmenu', (e) => { const b = e.target.closest('.br'); if (b) { e.preventDefault(); objMenu(e.clientX, e.clientY, b.dataset.id); } });

function updateBrackets() {
  if (!S.me || S.docked) { if (brackets.size) clearBrackets(); return; }
  const origin = S.meRec.dp;
  const used = new Set();
  const objs = allObjects();
  for (const o of objs) {
    const rel = sub(o.pos, origin);
    const d = len(rel);
    if (o.kind === 'asteroid' && d > 120000) continue;
    const p = R.project(rel);
    if (!p) continue;
    used.add(o.id);
    let b = brackets.get(o.id);
    if (!b) {
      b = document.createElement('div'); b.className = 'br'; b.dataset.id = o.id;
      b.innerHTML = '<div class="bi"></div><div class="bl"></div>';
      brRoot.appendChild(b); brackets.set(o.id, b);
    }
    const cls = ['br'];
    if (o.kind === 'ship') {
      if (o.gd) cls.push('guard'); else if (o.npc) cls.push('hostile'); else cls.push('player');
      if (o.cr) cls.push('crim'); else if (o.su) cls.push('susp');
      if (o.ag) cls.push('aggro');
    } else if (o.kind === 'asteroid') cls.push('ast'); else cls.push('cel');
    if (S.sel === o.id) cls.push('sel');
    if (S.me.locks.includes(o.id)) cls.push('locked');
    if (o.kind === 'ship' || o.kind === 'station' || o.kind === 'gate') cls.push('lbl');
    const c = cls.join(' ');
    if (b._c !== c) { b.className = c; b._c = c; }
    const icon = iconOf(o);
    const label = `${o.n || o.name}${o.o && o.o !== o.n ? '' : ''} · ${fmtDist(distTo(o))}`;
    if (b._i !== icon) { b.firstChild.textContent = icon; b._i = icon; }
    if (b._l !== label) { b.lastChild.textContent = label; b._l = label; }
    b.style.left = p[0] + 'px'; b.style.top = p[1] + 'px';
  }
  for (const [id, b] of brackets) if (!used.has(id)) { b.remove(); brackets.delete(id); }
}

// ======================================================================
// Обзор и выбранный объект
// ======================================================================
const OV_FILTERS = {
  all: (o) => o.kind !== 'asteroid' || distTo(o) < 100000,
  combat: (o) => o.kind === 'ship' || o.kind === 'wreck',
  mining: (o) => o.kind === 'asteroid' || o.kind === 'belt',
  nav: (o) => ['station', 'gate', 'belt', 'planet', 'sun'].includes(o.kind)
};
$('#ov-tabs').onclick = (e) => {
  const f = e.target.dataset.f; if (!f) return;
  S.ovFilter = f;
  for (const s of $('#ov-tabs').children) s.classList.toggle('on', s.dataset.f === f);
  renderOverview();
};
// Списки перерисовываются несколько раз в секунду, поэтому реагируем на mousedown, а не click
let lastPress = { id: null, t: 0 };
$('#ov-list').addEventListener('mousedown', (e) => {
  const r = e.target.closest('.ov-row'); if (!r) return;
  const id = r.dataset.id;
  if (e.button === 2) { e.preventDefault(); objMenu(e.clientX, e.clientY, id); return; }
  if (e.button !== 0) return;
  const now = performance.now();
  if (lastPress.id === id && now - lastPress.t < 400) act('smart', id);
  lastPress = { id, t: now };
  select(id, e); renderOverview();
});
$('#ov-list').addEventListener('contextmenu', (e) => e.preventDefault());

function renderOverview() {
  if (!S.me) return;
  const list = allObjects().filter(OV_FILTERS[S.ovFilter]).map(o => ({ o, d: distTo(o) })).sort((a, b) => a.d - b.d);
  const html = list.slice(0, 120).map(({ o, d }) => {
    const cls = ['ov-row'];
    if (S.sel === o.id) cls.push('sel');
    if (isHostile(o)) cls.push('hostile');
    if (S.me.locks.includes(o.id)) cls.push('locked');
    let name = o.n || o.name;
    if (o.kind === 'asteroid') name = `${S.data.items[o.ore].name} (${num(o.am)})`;
    return `<div class="${cls.join(' ')}" data-id="${esc(o.id)}"><span class="ic">${iconOf(o)}</span><span>${esc(name)}</span><span class="muted">${esc(typeOf(o))}</span><span class="d">${fmtDist(d)}</span></div>`;
  }).join('');
  setHTML($('#ov-list'), html);
}

$('#sel-body').addEventListener('mousedown', (e) => { const b = e.target.closest('[data-act]'); if (b && e.button === 0) act(b.dataset.act); });

function renderSelected() {
  const o = S.sel && getObj(S.sel);
  if (!o) { setHTML($('#sel-body'), '<div class="muted">Ничего не выбрано. Щёлкните объект в космосе или в обзоре.</div>'); return; }
  let extra = '';
  if (o.kind === 'ship') {
    extra = `<div class="bars"><div class="bar sh"><i style="width:${o.sh * 100}%"></i></div><div class="bar ar"><i style="width:${o.ar * 100}%"></i></div><div class="bar hu"><i style="width:${o.hu * 100}%"></i></div></div>`;
    if (o.o) extra += `<div class="muted">Пилот: ${esc(o.o)}${o.cr ? ' · <span style="color:var(--bad)">преступник</span>' : o.su ? ' · <span style="color:var(--warn)">подозреваемый</span>' : ''}</div>`;
    if (o.tg) extra += `<div style="color:var(--bad)">⚠ Захватил вас в прицел</div>`;
  }
  if (o.kind === 'asteroid') extra = `<div class="muted">Осталось: ${num(o.am)} ед. руды «${esc(S.data.items[o.ore].name)}»</div>`;
  if (o.kind === 'wreck' && o.items) extra = `<div class="muted">${Object.entries(o.items).map(([k, q]) => `${esc(S.data.items[k].name)} ×${q}`).join(', ')}</div>`;
  const acts = actionsFor(o).map(([a, ic, label, key]) => `<button data-act="${a}" title="${key}"><b>${ic}</b>${esc(label)}</button>`).join('');
  setHTML($('#sel-body'), `<div class="sel-name">${esc(o.n || o.name)}</div><div class="sel-sub">${esc(typeOf(o))} · ${fmtDist(distTo(o))}</div>${extra}<div class="sel-actions">${acts}</div>`);
}

// ======================================================================
// Цели, HUD, модули
// ======================================================================
$('#targets').addEventListener('mousedown', (e) => {
  const t = e.target.closest('.tgt'); if (!t) return;
  if (e.button === 2) { e.preventDefault(); objMenu(e.clientX, e.clientY, t.dataset.id); }
  else if (e.button === 0) { S.active = t.dataset.id; S.sel = t.dataset.id; renderTargets(); }
});
$('#targets').addEventListener('contextmenu', (e) => e.preventDefault());

function arcPath(r, a0, a1, cx = 32, cy = 32) {
  const p = (a) => [cx + r * Math.cos(a * Math.PI / 180), cy - r * Math.sin(a * Math.PI / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const large = Math.abs(a0 - a1) > 180 ? 1 : 0;
  const sweep = a1 < a0 ? 1 : 0;
  return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} ${sweep} ${x1.toFixed(1)},${y1.toFixed(1)}`;
}

function renderTargets() {
  if (!S.me) return setHTML($('#targets'), '');
  const items = [];
  for (const id of S.me.locks) items.push([id, 1]);
  for (const [id, t] of S.me.locking) items.push([id, 0, t]);
  const html = items.map(([id, locked]) => {
    const o = getObj(id);
    if (!o) return '';
    let rings = '';
    if (o.kind === 'ship') {
      rings = `<path d="${arcPath(29, 160, 160 - 140 * o.sh)}" stroke="var(--shield)" stroke-width="3" fill="none"/>
        <path d="${arcPath(25, 160, 160 - 140 * o.ar)}" stroke="var(--armor)" stroke-width="3" fill="none"/>
        <path d="${arcPath(21, 160, 160 - 140 * o.hu)}" stroke="var(--hull)" stroke-width="3" fill="none"/>`;
    } else if (o.kind === 'asteroid') rings = `<circle cx="32" cy="32" r="27" stroke="#888" stroke-width="2" fill="none"/>`;
    const active = S.active === id;
    return `<div class="tgt ${active ? 'active' : ''} ${locked ? '' : 'locking'}" data-id="${esc(id)}">
      <div class="ring"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="rgba(5,10,14,.7)" stroke="${active ? 'var(--accent)' : isHostile(o) ? 'var(--bad)' : 'var(--line)'}"/>${rings}</svg>
      <div class="lbl" style="color:${isHostile(o) ? 'var(--bad)' : '#cde'}">${locked ? iconOf(o) : '⌖'}</div></div>
      <div class="tn">${esc(o.n || o.name)}</div><div class="td">${locked ? fmtDist(distTo(o)) : 'захват…'}</div></div>`;
  }).join('');
  setHTML($('#targets'), html);
}

function gaugeArc(r, frac, a0 = 160, span = 140) {
  const p = (a) => [100 + r * Math.cos(a * Math.PI / 180), 100 - r * Math.sin(a * Math.PI / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a0 - span * Math.max(0.0001, frac));
  return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
}

function renderHud(now) {
  const me = S.me;
  if (!me) return;
  const m = me.max;
  $('#g-sh-bg').setAttribute('d', gaugeArc(78, 1)); $('#g-sh').setAttribute('d', gaugeArc(78, me.sh / m.sh));
  $('#g-ar-bg').setAttribute('d', gaugeArc(68, 1)); $('#g-ar').setAttribute('d', gaugeArc(68, me.ar / m.ar));
  $('#g-hu-bg').setAttribute('d', gaugeArc(58, 1)); $('#g-hu').setAttribute('d', gaugeArc(58, me.hu / m.hu));
  // накопитель — нижняя дуга
  const cf = me.cap / m.cap;
  const p = (a) => [100 + 84 * Math.cos(a * Math.PI / 180), 100 - 84 * Math.sin(a * Math.PI / 180)];
  const [x0, y0] = p(200), [x1, y1] = p(200 + 140 * Math.max(0.0001, cf));
  $('#g-cap').setAttribute('d', `M${x0},${y0} A84,84 0 0 0 ${x1},${y1}`);
  const spd = len(me.v);
  $('#g-speed').textContent = me.warp ? (spd / AU).toFixed(2) + ' а.е./с' : num(spd);
  $('#g-speed').style.fontSize = me.warp ? '15px' : '26px';
  $('#hp-text').textContent = `Щит ${Math.round(me.sh / m.sh * 100)}% · Броня ${Math.round(me.ar / m.ar * 100)}% · Корпус ${Math.round(me.hu / m.hu * 100)}% · Энергия ${Math.round(cf * 100)}%`;
  $('#speedfill').style.width = (me.speedFrac * 100) + '%';
  const st = [];
  if (me.warp) st.push(`<div class="warp">ВАРП-ПЕРЕХОД · ${Math.round(me.warp.prog * 100)}%</div>`);
  else if (me.cmd.type === 'align') st.push('<div class="warp">РАЗГОН ДЛЯ ВАРПА…</div>');
  if (me.scram) st.push('<div class="scram">⚠ ВАРП-ДВИГАТЕЛЬ ЗАБЛОКИРОВАН</div>');
  if (me.invuln) st.push('<div class="muted">Маскировка после прыжка / отстыковки</div>');
  if (me.ap) st.push(`<div>Автопилот → ${esc(S.sysById[me.ap].name)}</div>`);
  const cmdName = { approach: 'Подлёт', orbit: 'Орбита', keep: 'Удержание дистанции', dock: 'Подлёт для стыковки', jump: 'Подлёт к вратам', dir: 'Курс задан' }[me.cmd.type];
  if (cmdName && !me.warp) { const t = me.cmd.target && getObj(me.cmd.target); st.push(`<div class="muted">${cmdName}${t ? ': ' + esc(t.n || t.name) : ''}</div>`); }
  setHTML($('#hud-status'), st.join(''));

  // модули
  const order = moduleOrder();
  const cells = me.mods.map((md, i) => {
    if (!md) return `<div class="mod empty" title="Пустой слот">·</div>`;
    const def = S.data.modules[md.id];
    const slotT = S.prof ? slotType(S.prof.ship.type, i) : def.slot;
    const icon = { weapon: '✸', miner: '⛏', shieldRep: '⛨', armorRep: '✚', prop: '➤', scram: '⊘', passive: '◌' }[def.kind];
    let ring = '';
    if (md.e && md.s) {
      const f = Math.min(1, Math.max(0, (S.serverNow(now) - md.s) / (md.e - md.s)));
      ring = `<svg viewBox="0 0 58 58"><path d="${arcPath(27, 90, 90 - 359.9 * f, 29, 29)}" stroke="${md.a ? 'var(--good)' : 'var(--warn)'}" stroke-width="3" fill="none"/></svg>`;
    }
    const keyIdx = order.indexOf(i);
    return `<div class="mod ${slotT} ${md.a ? 'active' : ''} ${def.kind === 'passive' ? 'passive' : ''}" data-slot="${i}" title="${esc(def.name)}">${icon}${ring}<span class="k">${keyIdx >= 0 ? 'F' + (keyIdx + 1) : ''}</span></div>`;
  });
  const sl = S.data.ships[me.st].slots;
  const html = [[0, sl.high], [sl.high, sl.high + sl.mid], [sl.high + sl.mid, cells.length]]
    .map(([a, b]) => `<div class="mrow">${cells.slice(a, b).join('')}</div>`).join('');
  setHTML($('#modules'), html);
}
S.serverNow = () => Date.now() + (S.clockSkew || 0);
$('#modules').addEventListener('mousedown', (e) => { const m = e.target.closest('.mod'); if (m && m.dataset.slot && e.button === 0) toggleModule(+m.dataset.slot); });
$('#speedbar').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); send({ t: 'speed', v: (e.clientX - r.left) / r.width }); });
$('#b-stop').onclick = () => act('stop');
$('#b-full').onclick = () => send({ t: 'speed', v: 1 });

function slotType(shipType, idx) {
  const s = S.data.ships[shipType].slots;
  return idx < s.high ? 'high' : idx < s.high + s.mid ? 'mid' : 'low';
}

// ======================================================================
// Инфо о системе, уведомления, чат
// ======================================================================
function updateSysInfo() {
  if (!S.sys) return;
  $('#sys-sec').textContent = S.sys.sec.toFixed(1);
  $('#sys-sec').style.color = secColor(S.sys.sec);
  $('#sys-name').textContent = S.sys.name;
  const r = S.route;
  $('#sys-route').innerHTML = r.length > 1
    ? `Маршрут: ${r.slice(1).map(id => `<span class="hop" title="${esc(S.sysById[id].name)}" style="background:${secColor(S.sysById[id].sec)}"></span>`).join('')} <span>&nbsp;${r.length - 1} прыжк. → ${esc(S.sysById[r[r.length - 1]].name)}</span>`
    : '';
}

function updateWallet() {
  const p = S.prof;
  if (!p) return;
  $('#wallet').textContent = isk(p.credits);
  let f = '';
  if (p.criminal) f += `<span class="flag crim">ПРЕСТУПНИК ${fmtTime(p.criminal / 1000)}</span>`;
  if (p.suspect) f += `<span class="flag susp">ПОДОЗРЕВАЕМЫЙ ${fmtTime(p.suspect / 1000)}</span>`;
  $('#flags').innerHTML = f;
}

function note(text, kind = 'info') {
  const n = document.createElement('div');
  n.className = 'note ' + kind; n.textContent = text;
  const box = $('#notes');
  box.appendChild(n);
  while (box.children.length > 6) box.firstChild.remove();
  setTimeout(() => { n.style.opacity = 0; setTimeout(() => n.remove(), 600); }, kind === 'mine' ? 2000 : 4500);
}

function addChat(ch, from, text) {
  const arr = S.chat[ch];
  arr.push({ from, text, time: new Date() });
  if (arr.length > 200) arr.shift();
  if (ch === S.chatCh) renderChat();
}
function renderChat() {
  const log = $('#chat-log');
  log.innerHTML = S.chat[S.chatCh].map(m => {
    const t = m.time.toTimeString().slice(0, 5);
    return m.from === '*' ? `<div class="sys">[${t}] ${esc(m.text)}</div>` : `<div>[${t}] <span class="from">${esc(m.from)}</span>: ${esc(m.text)}</div>`;
  }).join('');
  log.scrollTop = log.scrollHeight;
}
function renderMembers() {
  $('#local-count').textContent = `Пилотов: ${S.members.length}`;
  $('#chat-members').innerHTML = S.members.map(m => `<div class="${m.crim ? 'crim' : m.susp ? 'susp' : ''}">${esc(m.name)}</div>`).join('');
}
$('#chat-tabs').onclick = (e) => {
  const ch = e.target.dataset.ch; if (!ch) return;
  S.chatCh = ch;
  for (const s of $('#chat-tabs').children) s.classList.toggle('on', s.dataset.ch === ch);
  renderChat();
};
$('#chat-in').onkeydown = (e) => {
  if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) send({ t: 'chat', ch: S.chatCh, text: v }); e.target.value = ''; e.target.blur(); }
  e.stopPropagation();
};

// ---------- модальные окна ----------
function modal(html, buttons) {
  $('#modal-body').innerHTML = html + `<div class="btns">${buttons.map((b, i) => `<button data-i="${i}" class="${b[2] || ''}">${esc(b[0])}</button>`).join('')}</div>`;
  $('#modal').classList.remove('hidden');
  $('#modal-body').querySelector('.btns').onclick = (e) => {
    const i = e.target.dataset.i; if (i == null) return;
    $('#modal').classList.add('hidden');
    if (buttons[i][1]) buttons[i][1]();
  };
}

function showInfo(o) {
  if (!o) return;
  let html = `<h3>${esc(o.n || o.name)}</h3><div class="kv"><span>Тип</span><span>${esc(typeOf(o))}</span><span>Расстояние</span><span>${fmtDist(distTo(o))}</span>`;
  if (o.kind === 'ship' && S.data.ships[o.st]) {
    const t = S.data.ships[o.st];
    html += `<span>Класс</span><span>${esc(t.cls)}</span><span>Пилот</span><span>${esc(o.o || 'NPC')}</span>`;
    html += `</div><p class="muted">${esc(t.desc || '')}</p>`;
  } else if (o.kind === 'planet') html += `<span>Тип планеты</span><span>${esc(o.ptype)}</span><span>Радиус</span><span>${num(o.radius / 1000)} км</span></div>`;
  else if (o.kind === 'gate') html += `<span>Ведут в</span><span>${esc(S.sysById[o.dest].name)} (${S.sysById[o.dest].sec.toFixed(1)})</span></div>`;
  else html += '</div>';
  openWin('info', html);
}

// ======================================================================
// Окна (Неоком)
// ======================================================================
$('#neocom').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.win === 'map') toggleMap(); else openWin(b.dataset.win); };
$('#win-close').onclick = closeWin;
function closeWin() { $('#win').classList.add('hidden'); S.win = null; }
const WIN_TITLES = { cargo: 'Трюм корабля', skills: 'Навыки', missions: 'Задания', assets: 'Имущество', help: 'Управление', info: 'Информация' };
function openWin(name, html) {
  if (S.win === name && !html) return closeWin();
  S.win = name; S.winHtml = html;
  $('#win-title').textContent = WIN_TITLES[name] || '';
  $('#win').classList.remove('hidden');
  renderWin();
}
function renderWin() {
  if (!S.win || !S.prof) return;
  const el = $('#win-body');
  if (S.win === 'info') return setHTML(el, S.winHtml);
  if (S.win === 'cargo') return setHTML(el, cargoHTML(!S.docked));
  if (S.win === 'skills') return setHTML(el, skillsHTML());
  if (S.win === 'missions') return setHTML(el, missionsHTML(false));
  if (S.win === 'assets') return setHTML(el, assetsHTML());
  if (S.win === 'help') return setHTML(el, HELP);
}
$('#win-body').addEventListener('mousedown', onActionClick);

const HELP = `<h3>Полёт</h3><div class="kv">
<span>Двойной щелчок в космосе</span><span>лететь в этом направлении</span>
<span>Перетаскивание ЛКМ</span><span>вращение камеры, колесо — приближение</span>
<span>ПКМ по космосу</span><span>меню варпа к станциям, вратам, поясам</span>
<span>ПКМ по объекту</span><span>все действия с объектом</span>
<span>Q / W / E</span><span>подлететь / орбита / держать дистанцию</span>
<span>S</span><span>варп к выбранному объекту (дальше 150 км)</span>
<span>D</span><span>стыковка со станцией / прыжок через врата</span>
<span>X или Ctrl+Space</span><span>стоп</span>
<span>Двойной щелчок по объекту</span><span>«умное» действие (варп, стыковка, прыжок, подлёт)</span></div>
<h3>Бой и добыча</h3><div class="kv">
<span>Ctrl+щелчок или L</span><span>захватить цель</span>
<span>Tab</span><span>сменить активную цель</span>
<span>F1–F8 или 1–8</span><span>включить/выключить модули</span></div>
<h3>Окна</h3><div class="kv"><span>M</span><span>звёздная карта и автопилот</span><span>C / K / J / A</span><span>трюм / навыки / задания / имущество</span><span>Enter</span><span>чат</span></div>
<h3>С чего начать</h3><p>1) Отстыкуйтесь, щёлкните ПКМ по космосу → «Пояса астероидов» и выберите пояс.<br>
2) Захватите астероид (Ctrl+щелчок), включите буровой лазер (F2).<br>
3) Когда трюм заполнится — вернитесь на станцию, разгрузите трюм и продайте руду на рынке.<br>
4) Купите корабль получше, изучайте навыки, берите задания у агентов.<br>
5) В системах с безопасностью ниже 0.5 руда дороже, но там пираты и другие игроки могут атаковать вас.</p>`;

// ---------- HTML-генераторы для окон и станции ----------
function itemsTable(items, actions) {
  const rows = Object.entries(items || {}).map(([id, q]) => {
    const it = S.data.items[id];
    return `<tr><td>${esc(it.name)}</td><td class="muted">${esc(it.cat)}</td><td class="r">${num(q)}</td><td class="r muted">${(q * it.vol).toFixed(1)} м³</td><td class="r">${actions(id, q)}</td></tr>`;
  }).join('');
  return rows ? `<table class="tbl"><tr><th>Предмет</th><th>Категория</th><th class="r">Кол-во</th><th class="r">Объём</th><th></th></tr>${rows}</table>` : '<div class="muted">Пусто</div>';
}

function cargoHTML(inSpace) {
  const p = S.prof;
  const cap = p.shipStats.cargo;
  return `<div>Трюм: ${p.cargoUsed.toFixed(1)} / ${num(cap)} м³</div><div class="cap-bar"><i style="width:${Math.min(100, p.cargoUsed / cap * 100)}%"></i></div>` +
    itemsTable(p.ship.cargo, (id) => inSpace ? `<button data-a="jettison" data-item="${id}">Выбросить</button>` : `<button data-a="unload" data-item="${id}">В ангар</button>`);
}

function skillsHTML() {
  const p = S.prof;
  let html = '';
  if (p.training) {
    const tr = p.training;
    const f = (S.serverNow() - tr.start) / (tr.end - tr.start);
    html += `<div class="mission"><div>Изучается: <b>${esc(S.data.skills[tr.skill].name)} ${tr.level}</b></div><div class="cap-bar"><i style="width:${Math.min(100, f * 100)}%"></i></div><div class="muted">Осталось: ${fmtTime((tr.end - S.serverNow()) / 1000)}</div></div>`;
  } else html += '<div class="muted" style="margin-bottom:8px">Навык не изучается. Навыки изучаются в реальном времени, даже когда вы не в игре.</div>';
  for (const [id, sk] of Object.entries(S.data.skills)) {
    const lv = p.skills[id] || 0;
    const tr = p.training && p.training.skill === id;
    const boxes = [1, 2, 3, 4, 5].map(i => `<i class="${i <= lv ? 'on' : tr && i === lv + 1 ? 'tr' : ''}"></i>`).join('');
    const next = lv < 5 ? S.data.skillTime[lv + 1] : 0;
    html += `<div class="skill"><div class="lv">${boxes}</div><div class="sn"><div>${esc(sk.name)}</div><div class="muted">${esc(sk.desc)}</div></div>
      ${lv < 5 && !tr ? `<button data-a="train" data-skill="${id}">Изучить ${lv + 1} (${fmtTime(next)})</button>` : ''}</div>`;
  }
  return html;
}

function missionsHTML(withOffers) {
  const p = S.prof;
  let html = '<h3>Активные задания</h3>';
  if (!p.missions.length) html += '<div class="muted">Нет активных заданий. Возьмите их у агентов на любой станции.</div>';
  for (const ms of p.missions) {
    const prog = ms.type === 'kill' ? `Прогресс: ${ms.progress} / ${ms.count}` : `Пункт назначения: ${esc(S.stationById[ms.dest].name)}`;
    html += `<div class="mission"><div class="mt">${esc(ms.title)}</div><div>${esc(ms.text)}</div><div class="muted">${prog} · Награда: <span class="isk">${isk(ms.reward)}</span></div>
      <button data-a="route" data-sys="${ms.type === 'kill' ? ms.sys : S.stationById[ms.dest].sys}">Маршрут</button> <button data-a="abandon" data-id="${ms.id}" class="danger">Отказаться</button></div>`;
  }
  if (withOffers) {
    html += '<h3>Предложения агентов этой станции</h3>';
    if (!S.agents) html += '<div class="muted">Загрузка…</div>';
    else if (!S.agents.length) html += '<div class="muted">Новых предложений нет. Загляните позже.</div>';
    else for (const o of S.agents) html += `<div class="mission"><div class="mt">${esc(o.title)}</div><div>${esc(o.text)}</div><div class="muted">Награда: <span class="isk">${isk(o.reward)}</span></div><button class="primary" data-a="accept" data-id="${o.id}">Принять</button></div>`;
  }
  return html;
}

function assetsHTML() {
  const p = S.prof;
  let html = `<div class="kv"><span>Баланс</span><span class="isk">${isk(p.credits)}</span><span>Домашняя станция</span><span>${esc(S.stationById[p.home].name)}</span>
    <span>Текущий корабль</span><span>${esc(S.data.ships[p.ship.type].name)}</span><span>Уничтожено NPC</span><span>${p.stats.npcKills}</span>
    <span>Уничтожено игроков</span><span>${p.stats.kills}</span><span>Потеряно кораблей</span><span>${p.stats.deaths}</span><span>Добыто руды</span><span>${num(p.stats.mined)} ед.</span></div>`;
  html += '<h3>Имущество на станциях</h3>';
  if (!p.assets.length) html += '<div class="muted">Пусто</div>';
  for (const a of p.assets) {
    const items = Object.entries(a.items).map(([id, q]) => `${esc(S.data.items[id].name)} ×${num(q)}`).join(', ');
    const ships = a.ships.map(t => esc(S.data.ships[t].name)).join(', ');
    html += `<div class="mission"><div class="mt">${esc(a.name)}</div>${ships ? `<div>Корабли: ${ships}</div>` : ''}${items ? `<div class="muted">${items}</div>` : ''}</div>`;
  }
  return html;
}

function shipStatsHTML(t, stats) {
  const s = stats || t;
  return `<div class="kv"><span>Скорость</span><span>${num(s.maxSpeed)} м/с</span><span>Щит / броня / корпус</span><span>${num(s.shield)} / ${num(s.armor)} / ${num(s.hull)}</span>
    <span>Накопитель</span><span>${num(s.cap)} (${(s.capRegen).toFixed(1)}/с)</span><span>Трюм</span><span>${num(s.cargo)} м³</span>
    <span>Слоты</span><span>${t.slots.high} верх. / ${t.slots.mid} сред. / ${t.slots.low} ниж.</span><span>Захват</span><span>${t.maxLocks} целей, ${t.lockRange / 1000} км</span>
    <span>Варп</span><span>${t.warpSpeed} а.е./с, разгон ${t.align} с</span></div>`;
}

function moduleDesc(d) {
  if (d.kind === 'weapon') return `урон ${d.dmg} / ${d.cycle}с, дальность ${d.optimal / 1000}+${d.falloff / 1000} км`;
  if (d.kind === 'miner') return `${d.yield} м³ / ${d.cycle}с, дальность ${d.range / 1000} км`;
  if (d.kind === 'shieldRep') return `+${d.amount} щита / ${d.cycle}с`;
  if (d.kind === 'armorRep') return `+${d.amount} брони / ${d.cycle}с`;
  if (d.kind === 'prop') return `+${d.speedBonus * 100}% скорости`;
  if (d.kind === 'scram') return `блокирует варп цели, ${d.range / 1000} км`;
  if (d.kind === 'passive') return Object.entries(d.passive).map(([k, v]) => `+${Math.round(v * 100)}% ${{ damage: 'урона', cargo: 'трюма', mining: 'добычи', speed: 'скорости' }[k]}`).join(', ');
  return '';
}

// ======================================================================
// Станция
// ======================================================================
function showStation() {
  $('#station').classList.remove('hidden');
  for (const id of ['#rightcol', '#targets', '#hud']) $(id).classList.add('hidden');
  $('#st-name').textContent = S.docked.name;
  const sys = S.sysById[S.docked.sys];
  $('#st-sys').innerHTML = `<span style="color:${secColor(sys.sec)}">${sys.sec.toFixed(1)}</span> ${esc(sys.name)}`;
  S.market = null; S.agents = null;
  renderStation();
}
function hideStation() {
  $('#station').classList.add('hidden');
  for (const id of ['#rightcol', '#targets', '#hud']) $(id).classList.remove('hidden');
}
$('#st-undock').onclick = () => send({ t: 'undock' });
$('#st-tabs').onclick = (e) => {
  const t = e.target.dataset.tab; if (!t) return;
  S.stTab = t;
  for (const s of $('#st-tabs').children) s.classList.toggle('on', s.dataset.tab === t);
  if (t === 'market' || t === 'exchange') send({ t: 'market' });
  if (t === 'agents') send({ t: 'agents' });
  renderStation();
};
$('#st-body').addEventListener('mousedown', onActionClick);

function renderStation() {
  if (!S.docked || !S.prof) return;
  const el = $('#st-body');
  const p = S.prof, h = p.hangar || { items: {}, ships: [] };
  const t = S.data.ships[p.ship.type];
  let html = '';
  switch (S.stTab) {
    case 'hangar': {
      html = `<div class="cols"><div><h3>Активный корабль: ${esc(t.name)} <span class="muted">(${esc(t.cls)})</span></h3>${shipStatsHTML(t, p.shipStats)}
        <h3>Трюм</h3>${cargoHTML(false)}<div style="margin-top:6px"><button data-a="unloadAll">Разгрузить всё в ангар</button></div></div>
        <div><h3>Ангар станции</h3>${itemsTable(h.items, (id, q) => `<button data-a="load" data-item="${id}">В трюм</button>`)}
        <h3>Корабли в ангаре</h3>${h.ships.length ? h.ships.map(s => `<div class="slot-row"><span class="sm">${esc(S.data.ships[s.type].name)} <span class="muted">${esc(S.data.ships[s.type].cls)}</span></span><button data-a="board" data-uid="${s.uid}">Пересесть</button></div>`).join('') : '<div class="muted">Нет других кораблей</div>'}
        <h3>Клон</h3><div>${p.home === S.docked.id ? '<span class="muted">Эта станция — ваша домашняя (здесь вы возродитесь).</span>' : '<button data-a="sethome">Сделать станцию домашней</button>'}</div></div></div>`;
      break;
    }
    case 'fitting': {
      const slots = p.ship.fit.map((m, i) => {
        const st = slotType(p.ship.type, i);
        const d = m && S.data.modules[m];
        return `<div class="slot-row"><span class="st ${st}">${{ high: 'Верх', mid: 'Сред', low: 'Ниж' }[st]}</span><span class="sm">${d ? esc(d.name) + ` <span class="muted">${moduleDesc(d)}</span>` : '<span class="muted">— пусто —</span>'}</span>${d ? `<button data-a="unfit" data-slot="${i}">Снять</button>` : ''}</div>`;
      }).join('');
      const mods = Object.entries(h.items).filter(([id]) => S.data.modules[id]).map(([id, q]) => {
        const d = S.data.modules[id];
        return `<div class="slot-row"><span class="st ${d.slot}">${{ high: 'Верх', mid: 'Сред', low: 'Ниж' }[d.slot]}</span><span class="sm">${esc(d.name)} ×${q}<br><span class="muted">${moduleDesc(d)}</span></span><button data-a="fit" data-item="${id}">Установить</button></div>`;
      }).join('');
      html = `<div class="cols"><div><h3>${esc(t.name)} — слоты</h3>${slots}<h3>Характеристики</h3>${shipStatsHTML(t, p.shipStats)}</div>
        <div><h3>Модули в ангаре</h3>${mods || '<div class="muted">Нет модулей. Купите их на рынке.</div>'}</div></div>`;
      break;
    }
    case 'market': {
      const mk = S.market;
      if (!mk) { html = '<div class="muted">Загрузка рынка…</div>'; break; }
      const sellRows = Object.entries(h.items).filter(([id]) => mk.sell[id]).map(([id, q]) =>
        `<tr><td>${esc(S.data.items[id].name)}</td><td class="r">${num(q)}</td><td class="r isk">${num(mk.sell[id])}</td><td class="r isk">${num(mk.sell[id] * q * (1 - mk.tax))}</td>
        <td class="r"><input class="qty" type="number" min="1" max="${q}" value="${q}" id="sq-${id}"> <button data-a="sell" data-item="${id}">Продать</button></td></tr>`).join('');
      html = `<h3>Продажа из ангара <span class="muted">(налог ${(mk.tax * 100).toFixed(0)}%)</span></h3>
        ${sellRows ? `<table class="tbl"><tr><th>Предмет</th><th class="r">Есть</th><th class="r">Цена за ед.</th><th class="r">Итого</th><th></th></tr>${sellRows}</table>` : '<div class="muted">Нечего продавать. Разгрузите трюм в ангар (вкладка «Ангар»).</div>'}
        <h3>Цены на сырьё в этой системе</h3><div class="kv">${Object.entries(mk.sell).filter(([id]) => S.data.items[id].cat === 'Руда' || S.data.items[id].cat === 'Трофеи').map(([id, pr]) => `<span>${esc(S.data.items[id].name)}</span><span class="isk">${num(pr)} ISK</span>`).join('')}</div>
        <h3>Модули</h3><table class="tbl"><tr><th>Модуль</th><th>Слот</th><th>Параметры</th><th class="r">Цена</th><th></th></tr>
        ${Object.entries(mk.buy).map(([id, pr]) => { const d = S.data.modules[id]; return `<tr><td>${esc(d.name)}</td><td class="muted">${{ high: 'верх', mid: 'сред', low: 'ниж' }[d.slot]}</td><td class="muted">${moduleDesc(d)}</td><td class="r isk">${num(pr)}</td><td class="r"><button data-a="buy" data-item="${id}">Купить</button></td></tr>`; }).join('')}</table>
        <h3>Корабли</h3><div class="grid-cards">${Object.entries(mk.ships).map(([id, pr]) => { const st = S.data.ships[id]; return `<div class="shipcard"><div class="sname">${esc(st.name)}</div><div class="muted">${esc(st.cls)}</div><div>${esc(st.desc)}</div>${shipStatsHTML(st)}<div class="isk">${isk(pr)}</div><button class="primary" data-a="buyShip" data-item="${id}">Купить</button></div>`; }).join('')}</div>`;
      break;
    }
    case 'exchange': {
      const mk = S.market;
      if (!mk) { html = '<div class="muted">Загрузка…</div>'; break; }
      const sellable = Object.entries(h.items).filter(([id]) => !S.data.items[id].noSell);
      html = `<h3>Ордера на продажу от пилотов</h3><p class="muted">Покупка возможна удалённо — товар окажется в ангаре станции продавца.</p>
        ${mk.orders.length ? `<table class="tbl"><tr><th>Товар</th><th class="r">Кол-во</th><th class="r">Цена</th><th>Продавец</th><th>Где</th><th></th></tr>
        ${mk.orders.map(o => `<tr><td>${esc(S.data.items[o.item].name)}</td><td class="r">${num(o.qty)}</td><td class="r isk">${num(o.price)}</td><td>${esc(o.seller)}</td><td class="muted">${esc(o.sysName)} — ${esc(o.stationName)}</td>
          <td class="r">${o.seller === S.name ? `<button data-a="cancelOrder" data-id="${o.id}">Снять</button>` : `<input class="qty" type="number" min="1" max="${o.qty}" value="1" id="bq-${o.id}"> <button data-a="buyOrder" data-id="${o.id}">Купить</button>`}</td></tr>`).join('')}</table>` : '<div class="muted">Ордеров пока нет.</div>'}
        <h3>Выставить свой товар</h3>
        ${sellable.length ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><select id="po-item">${sellable.map(([id, q]) => `<option value="${id}">${esc(S.data.items[id].name)} (${q})</option>`).join('')}</select>
          Кол-во <input id="po-qty" class="qty" type="number" min="1" value="1"> Цена за ед. <input id="po-price" class="qty" type="number" min="1" value="100" style="width:100px">
          <button class="primary" data-a="placeOrder">Выставить</button></div>` : '<div class="muted">В ангаре этой станции нет товаров.</div>'}`;
      break;
    }
    case 'agents': html = missionsHTML(true); break;
    case 'skills': html = skillsHTML(); break;
  }
  setHTML(el, html);
}

// Единый обработчик кнопок с data-a
function onActionClick(e) {
  const b = e.target.closest('[data-a]');
  if (!b || e.button !== 0) return;
  const d = b.dataset;
  switch (d.a) {
    case 'jettison': send({ t: 'jettison', item: d.item }); break;
    case 'unload': send({ t: 'unload', item: d.item }); break;
    case 'unloadAll': send({ t: 'unload' }); break;
    case 'load': send({ t: 'load', item: d.item }); break;
    case 'board': send({ t: 'board', uid: d.uid }); break;
    case 'sethome': send({ t: 'sethome' }); break;
    case 'fit': {
      const mod = S.data.modules[d.item];
      const fit = S.prof.ship.fit;
      let slot = fit.findIndex((m, i) => !m && slotType(S.prof.ship.type, i) === mod.slot);
      if (slot < 0) slot = fit.findIndex((m, i) => slotType(S.prof.ship.type, i) === mod.slot);
      if (slot < 0) note('У корабля нет подходящих слотов', 'warn'); else send({ t: 'fit', slot, item: d.item });
      break;
    }
    case 'unfit': send({ t: 'unfit', slot: +d.slot }); break;
    case 'sell': send({ t: 'sell', item: d.item, qty: +$('#sq-' + d.item).value }); break;
    case 'buy': send({ t: 'buy', item: d.item, qty: 1 }); break;
    case 'buyShip': send({ t: 'buy', item: d.item }); break;
    case 'buyOrder': send({ t: 'buyOrder', id: d.id, qty: +$('#bq-' + d.id).value }); break;
    case 'cancelOrder': send({ t: 'cancelOrder', id: d.id }); break;
    case 'placeOrder': send({ t: 'placeOrder', item: $('#po-item').value, qty: +$('#po-qty').value, price: +$('#po-price').value }); break;
    case 'train': send({ t: 'train', skill: d.skill }); break;
    case 'accept': send({ t: 'acceptMission', id: d.id }); break;
    case 'abandon': send({ t: 'abandonMission', id: d.id }); break;
    case 'route': send({ t: 'autopilot', dest: d.sys }); note('Маршрут проложен. Откройте карту (M), чтобы включить автопилот.'); break;
  }
}

function onProfile() {
  updateWallet();
  if (S.docked) renderStation();
  renderWin();
}

// ======================================================================
// Звёздная карта
// ======================================================================
const map = { x: 0, y: 0, z: 1.4, sel: null, drag: null, init: false };
function toggleMap() {
  const m = $('#map');
  m.classList.toggle('hidden');
  if (!m.classList.contains('hidden')) {
    if (!map.init) {
      const xs = S.data.systems.map(s => s.x), ys = S.data.systems.map(s => s.y);
      map.x = (Math.min(...xs) + Math.max(...xs)) / 2; map.y = (Math.min(...ys) + Math.max(...ys)) / 2;
      map.z = Math.min((innerWidth - 420) / (Math.max(...xs) - Math.min(...xs) + 120), (innerHeight - 120) / (Math.max(...ys) - Math.min(...ys) + 120));
      map.init = true;
    }
    map.sel = map.sel || (S.sys && S.sys.id); drawMap(); renderMapInfo();
  }
}
$('#map-close').onclick = toggleMap;
const mc = $('#map-canvas');
mc.addEventListener('mousedown', (e) => { map.drag = { x: e.clientX, y: e.clientY, moved: 0 }; });
mc.addEventListener('mousemove', (e) => {
  if (!map.drag) return;
  const dx = e.clientX - map.drag.x, dy = e.clientY - map.drag.y;
  map.drag.moved += Math.abs(dx) + Math.abs(dy);
  map.x -= dx / map.z; map.y -= dy / map.z;
  map.drag.x = e.clientX; map.drag.y = e.clientY;
  drawMap();
});
mc.addEventListener('mouseup', (e) => {
  if (map.drag && map.drag.moved < 5) {
    const hit = S.data.systems.find(s => Math.hypot(...mapPt(s).map((v, i) => v - [e.clientX, e.clientY][i])) < 14);
    if (hit) { map.sel = hit.id; renderMapInfo(); drawMap(); }
  }
  map.drag = null;
});
mc.addEventListener('wheel', (e) => { map.z = Math.max(0.5, Math.min(6, map.z * Math.pow(0.999, e.deltaY))); drawMap(); }, { passive: true });
function mapPt(s) { return [(s.x - map.x) * map.z + (innerWidth - 340) / 2, (s.y - map.y) * map.z + innerHeight / 2]; }

function drawMap() {
  const dpr = devicePixelRatio || 1;
  mc.width = innerWidth * dpr; mc.height = innerHeight * dpr;
  const g = mc.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, innerWidth, innerHeight);
  const routeSet = new Set();
  for (let i = 0; i < S.route.length - 1; i++) routeSet.add([S.route[i], S.route[i + 1]].sort().join('|'));
  for (const [a, b] of S.data.gates) {
    const pa = mapPt(S.sysById[a]), pb = mapPt(S.sysById[b]);
    const onRoute = routeSet.has([a, b].sort().join('|'));
    g.strokeStyle = onRoute ? '#ffcc44' : 'rgba(120,170,200,0.35)'; g.lineWidth = onRoute ? 3 : 1.2;
    g.beginPath(); g.moveTo(...pa); g.lineTo(...pb); g.stroke();
  }
  for (const s of S.data.systems) {
    const [x, y] = mapPt(s);
    const col = secColor(s.sec);
    const glow = g.createRadialGradient(x, y, 0, x, y, 22);
    glow.addColorStop(0, col + '88'); glow.addColorStop(1, 'transparent');
    g.fillStyle = glow; g.fillRect(x - 22, y - 22, 44, 44);
    g.fillStyle = col; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
    if (S.sys && s.id === S.sys.id) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 12, 0, 7); g.stroke(); }
    if (s.id === map.sel) { g.strokeStyle = '#5fc8e8'; g.setLineDash([4, 3]); g.beginPath(); g.arc(x, y, 17, 0, 7); g.stroke(); g.setLineDash([]); }
    g.fillStyle = '#dde'; g.font = '13px Segoe UI, sans-serif'; g.textAlign = 'center';
    g.fillText(s.name, x, y - 16);
    g.fillStyle = col; g.font = '11px Segoe UI, sans-serif'; g.fillText(s.sec.toFixed(1), x, y + 22);
  }
}

function renderMapInfo() {
  const s = S.sysById[map.sel];
  if (!s) return;
  const stations = S.data.stations.filter(st => st.sys === s.id);
  const cur = S.sys && S.sys.id;
  $('#map-info').innerHTML = `<h3 style="color:${secColor(s.sec)}">${esc(s.name)} <span>${s.sec.toFixed(1)}</span></h3>
    <div class="kv"><span>Безопасность</span><span>${s.sec >= 0.5 ? 'высокая — стражи порядка' : s.sec > 0 ? 'низкая — PvP без защиты' : 'нулевая — закона нет'}</span>
    <span>Станции</span><span>${stations.length || 'нет'}</span><span>Пираты</span><span>${s.sec >= 0.8 ? 'нет' : s.sec >= 0.5 ? 'слабые' : s.sec > 0 ? 'средние' : 'сильные'}</span>
    <span>Руда</span><span>${s.sec >= 0.7 ? 'Ферит, Корундит' : s.sec >= 0.45 ? '+ Аркселит' : s.sec > 0 ? 'Корундит, Аркселит, Нуллий' : 'Аркселит, Нуллий'}</span></div>
    ${stations.map(st => `<div class="muted" style="font-size:11px">⌂ ${esc(st.name)}</div>`).join('')}
    ${s.id !== cur ? `<div style="display:flex;gap:6px;margin-top:10px"><button id="mi-route">Проложить маршрут</button><button id="mi-ap" class="primary">Автопилот</button></div>` : '<p class="muted">Вы здесь.</p>'}
    ${S.route.length ? '<button id="mi-clear" style="margin-top:6px">Сбросить маршрут</button>' : ''}`;
  const r = $('#mi-route'), ap = $('#mi-ap'), cl = $('#mi-clear');
  if (r) r.onclick = () => send({ t: 'autopilot', dest: s.id });
  if (ap) ap.onclick = () => { send({ t: 'autopilot', dest: s.id, go: true }); if (S.docked) note('Маршрут проложен. Отстыкуйтесь и включите автопилот снова.'); else toggleMap(); };
  if (cl) cl.onclick = () => { S.route = []; send({ t: 'autopilot', dest: null }); updateSysInfo(); drawMap(); renderMapInfo(); };
}

// ======================================================================
// Главный цикл отрисовки
// ======================================================================
let lastFrame = performance.now(), lastUi = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!S.data) return;
  if (S.me && !S.docked) {
    interp(S.meRec, now);
    for (const e of S.ents.values()) interp(e, now);
  }
  R.frame(viewState(), dt, now / 1000);
  updateBrackets();
  if (now - lastUi > 200) {
    lastUi = now;
    if (!S.docked && S.me) { renderOverview(); renderSelected(); renderTargets(); renderHud(now); }
    if (S.win === 'skills') renderWin();
    if (S.docked && S.stTab === 'skills') renderStation();
  }
}
requestAnimationFrame(loop);
