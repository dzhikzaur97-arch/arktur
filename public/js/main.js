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
// Мобильный режим: телефоны и планшеты (сенсорный экран или узкое окно)
// ======================================================================
const MOBILE = matchMedia('(pointer: coarse)').matches || innerWidth < 820;
if (MOBILE) document.body.classList.add('mobile');
// Нажатие: мышью — сразу на pointerdown (списки перерисовываются часто), пальцем — по click (чтобы не мешать прокрутке)
function onTap(el, fn) {
  let pt = 'mouse';
  el.addEventListener('pointerdown', (e) => { pt = e.pointerType; if (pt === 'mouse' && e.button === 0) fn(e); });
  el.addEventListener('click', (e) => { if (pt !== 'mouse') fn(e); });
}
function togglePanel(name, force) {
  const cls = name + '-open';
  const on = force !== undefined ? force : !document.body.classList.contains(cls);
  for (const n of ['menu', 'ov', 'chat']) document.body.classList.remove(n + '-open');
  if (on) document.body.classList.add(cls);
}

// ======================================================================
// Настройки игрока (хранятся только в этом браузере)
// ======================================================================
const CFG_DEFAULT = { quality: MOBILE ? 'medium' : 'high', volume: 0.55, ui: 1, labels: false, sens: 1 };
let CFG = { ...CFG_DEFAULT };
try { CFG = { ...CFG_DEFAULT, ...JSON.parse(localStorage.getItem('vf-cfg') || '{}') }; } catch {}
function saveCfg() { try { localStorage.setItem('vf-cfg', JSON.stringify(CFG)); } catch {} }

// ======================================================================
// Звук: всё синтезируется на лету через Web Audio, без файлов
// ======================================================================
const Sound = {
  ctx: null, master: null, muted: false, noiseBuf: null, ambient: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    try { this.muted = localStorage.getItem('vf-mute') === '1'; } catch {}
    this.master.gain.value = this.muted ? 0 : CFG.volume;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbient();
  },
  setVolume(v) { if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); },
  toggle() {
    this.init();
    this.muted = !this.muted;
    try { localStorage.setItem('vf-mute', this.muted ? '1' : '0'); } catch {}
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : CFG.volume, this.ctx.currentTime, 0.05);
    return this.muted;
  },
  ok() { return this.ctx && !this.muted && this.ctx.state === 'running'; },
  env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); },
  noise(t, dur) { const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true; n.start(t, Math.random()); n.stop(t + dur); return n; },
  startAmbient() {
    // низкий гул корабля и космоса
    const c = this.ctx, g = c.createGain(); g.gain.value = 0.06; g.connect(this.master);
    for (const f of [41, 55.3, 82.1]) { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; const og = c.createGain(); og.gain.value = 0.5; o.connect(og); og.connect(g); o.start(); }
    const n = this.noise(c.currentTime, 1e6); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    const ng = c.createGain(); ng.gain.value = 0.6; n.connect(lp); lp.connect(ng); ng.connect(g);
    this.ambient = g;
  },
  laser(vol) {
    if (!this.ok() || vol <= 0) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(1400 + Math.random() * 300, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.28);
    f.type = 'lowpass'; f.frequency.value = 3500;
    this.env(g, t, 0.005, 0.25 * vol, 0.3);
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.4);
  },
  rail(vol) {
    if (!this.ok() || vol <= 0) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(t, 0.5), bp = c.createBiquadFilter(), g = c.createGain();
    bp.type = 'bandpass'; bp.frequency.setValueAtTime(2500, t); bp.frequency.exponentialRampToValueAtTime(300, t + 0.4); bp.Q.value = 0.8;
    this.env(g, t, 0.003, 0.5 * vol, 0.4); n.connect(bp); bp.connect(g); g.connect(this.master);
    const o = c.createOscillator(), og = c.createGain(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    this.env(og, t, 0.003, 0.5 * vol, 0.35); o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.45);
  },
  mine(vol, dur) {
    if (!this.ok() || vol <= 0) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = 190; lfo.frequency.value = 7; lg.gain.value = 25;
    lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09 * vol, t + 0.3);
    g.gain.setValueAtTime(0.09 * vol, t + dur - 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); lfo.start(t); o.stop(t + dur); lfo.stop(t + dur);
  },
  boom(vol, big) {
    if (!this.ok() || vol <= 0) return;
    const c = this.ctx, t = c.currentTime, dur = big ? 3 : 1.8;
    const n = this.noise(t, dur), lp = c.createBiquadFilter(), g = c.createGain();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(80, t + dur);
    this.env(g, t, 0.01, 0.9 * vol, dur); n.connect(lp); lp.connect(g); g.connect(this.master);
    const o = c.createOscillator(), og = c.createGain(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(25, t + dur);
    this.env(og, t, 0.01, 0.8 * vol, dur * 0.8); o.connect(og); og.connect(this.master); o.start(t); o.stop(t + dur);
  },
  whoosh(vol, up = true, dur = 2.5) {
    if (!this.ok() || vol <= 0) return;
    const c = this.ctx, t = c.currentTime, n = this.noise(t, dur), bp = c.createBiquadFilter(), g = c.createGain();
    bp.type = 'bandpass'; bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(up ? 150 : 2500, t); bp.frequency.exponentialRampToValueAtTime(up ? 2800 : 120, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * vol, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp); bp.connect(g); g.connect(this.master);
  },
  beep(f1 = 880, f2 = 1320, vol = 0.12) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime;
    [[f1, 0], [f2, 0.09]].forEach(([f, dt]) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = f;
      this.env(g, t + dt, 0.005, vol, 0.07); o.connect(g); g.connect(this.master); o.start(t + dt); o.stop(t + dt + 0.1);
    });
  },
  click() { this.beep(1600, 1600, 0.04); },
  alarm() { this.beep(520, 390, 0.14); }
};

// громкость эффекта по расстоянию от корабля игрока
function fxVolume(fx) {
  if (!S.meRec) return 0;
  let pos = fx.pos;
  if (!pos) {
    const id = fx.from === S.me.id || fx.to === S.me.id ? null : fx.from;
    if (!id) return 1;
    const e = S.ents.get(id); if (!e) return 0;
    pos = e.dp;
  }
  const d = len(sub(pos, S.meRec.dp));
  return Math.max(0, 1 - d / 80000) ** 1.5;
}
function playFx(fx) {
  const v = fxVolume(fx);
  if (fx.k === 'beam') { const c = fx.color || 0; ((c >> 16) & 255) > ((c & 255)) ? Sound.laser(v) : Sound.rail(v); }
  else if (fx.k === 'mine') Sound.mine(v * 0.8, Math.min(6, fx.dur || 5));
  else if (fx.k === 'boom') Sound.boom(v, (fx.size || 0) > 500);
  else if (fx.k === 'jump') Sound.whoosh(v * 0.7, false, 1.5);
}
addEventListener('mousedown', () => Sound.init(), { capture: true });
addEventListener('keydown', () => Sound.init(), { capture: true });

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
$('#lg-go').onclick = () => { Sound.init(); try { localStorage.setItem('vf-name', $('#lg-name').value); } catch {} if (S.ws) S.ws.close(); connect(); };
$('#lg-pass').onkeydown = (e) => { if (e.key === 'Enter') $('#lg-go').click(); };
try { $('#lg-name').value = localStorage.getItem('vf-name') || ''; } catch {}
(function loginSlides() {
  const box = $('#login-art');
  if (!box) return;
  const order = ['strizh', 'citadel', 'piligrim', 'leviafan', 'vihr', 'kit', 'sokol', 'staratel'];
  const layers = [0, 1].map(() => { const d = document.createElement('div'); d.className = 'login-slide'; box.appendChild(d); return d; });
  let i = 0, top = 0;
  const show = () => {
    if ($('#login').classList.contains('hidden')) return;
    const src = (window.VF_ART && window.VF_ART[order[i]]) || `img/ships/${order[i]}.jpg`;
    const next = layers[1 - top];
    next.style.backgroundImage = `url("${src}")`;
    next.classList.add('on'); layers[top].classList.remove('on');
    top = 1 - top; i = (i + 1) % order.length;
  };
  show(); setInterval(show, 7000);
})();

function onMsg(m) {
  switch (m.t) {
    case 'loginErr': $('#lg-err').textContent = m.msg; S.ws.close(); break;
    case 'welcome':
      S.data = m.data; S.name = m.name;
      $('#login').classList.add('hidden'); $('#ui').classList.remove('hidden');
      S.stationById = Object.fromEntries(m.data.stations.map(s => [s.id, s]));
      S.sysById = Object.fromEntries(m.data.systems.map(s => [s.id, s]));
      R.prewarm(m.data.ships);
      addChat('local', '*', `Добро пожаловать, пилот ${m.name}! Нажмите H или «?» слева, чтобы узнать управление.`);
      break;
    case 'system':
      if (S.sys && S.sys.id !== m.id) jumpBanner(m);
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
      Sound.whoosh(0.6, true, 1.5);
      showStation(); break;
    }
    case 'undocked': S.docked = null; hideStation(); Sound.whoosh(0.8, false, 2); break;
    case 'note': note(m.text, m.kind); if (m.text.startsWith('Продано:')) markTut('sell'); break;
    case 'chat': addChat(m.ch, m.from, m.text); break;
    case 'local': S.members = m.members; renderMembers(); break;
    case 'market': S.market = m; if (S.docked && (S.stTab === 'market' || S.stTab === 'exchange')) renderStation(); break;
    case 'agents': S.agents = m.offers; if (S.docked && S.stTab === 'agents') renderStation(); break;
    case 'anoms': S.anoms = m.list; break;
    case 'black': S.black = m; openWin('black', null, true); break;
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
  // сглаженное соответствие серверного времени локальным часам (performance.now)
  const off = m.now - now;
  if (S.timeOff === undefined || Math.abs(off - S.timeOff) > 1000) S.timeOff = off;
  else S.timeOff += (off - S.timeOff) * 0.05;
  const me = m.me;
  if (!S.meRec) S.meRec = { snaps: [], dp: me.p, dh: me.h };
  pushSnap(S.meRec, m.now, me.p, me.v, me.h, !!me.warp);
  const prev = S.me;
  if (prev) {
    if (me.warp && !prev.warp) Sound.whoosh(1, true, 3);
    if (!me.warp && prev.warp) Sound.whoosh(0.8, false, 1.8);
    if (me.locks.length > prev.locks.length) Sound.beep();
    if (me.hu < prev.hu && me.hu / me.max.hu < 0.5 && (!S.lastAlarm || performance.now() - S.lastAlarm > 4000)) { S.lastAlarm = performance.now(); Sound.alarm(); }
  }
  S.me = me;
  const seen = new Set();
  for (const e of m.ents) {
    seen.add(e.id);
    const old = S.ents.get(e.id);
    if (old) { e.snaps = old.snaps; e.dp = old.dp; e.dh = old.dh; }
    else { e.snaps = []; e.dp = e.p; e.dh = e.h; }
    pushSnap(e, m.now, e.p, e.v, e.h, !!e.w);
    S.ents.set(e.id, e);
  }
  for (const id of [...S.ents.keys()]) if (!seen.has(id)) S.ents.delete(id);
  if (S.sel && !S.ents.has(S.sel) && !(S.celById && S.celById[S.sel]) && !(S.anoms && S.anoms.some(a => a.id === S.sel))) S.sel = null;
  if (S.active && !me.locks.includes(S.active)) S.active = me.locks[0] || null;
  if (m.fx) for (const fx of m.fx) { R.addFx(fx, viewState()); playFx(fx); damageNumber(fx); }
  R.setMyShip(me.st, S.data);
}

// ---------- плавное движение: буфер снимков и интерполяция по кривой Эрмита ----------
// Мир показывается с небольшой задержкой (~120 мс), поэтому между двумя снимками сервера всегда есть плавная кривая
const RENDER_DELAY = 120;
function pushSnap(rec, t, p, v, h, warp) {
  const s = rec.snaps;
  const last = s[s.length - 1];
  if (last && t <= last.t) return;
  // телепорт (прыжок через врата, возрождение) — начинаем заново, без «протягивания» через полсистемы
  if (last && !warp && !last.w && len(sub(p, last.p)) > Math.max(5e5, len(last.v) * (t - last.t) / 1000 * 4 + 5e4)) s.length = 0;
  s.push({ t, p, v: v || [0, 0, 0], h, w: warp });
  if (s.length > 8) s.shift();
}
function sample(rec, rt) {
  const s = rec.snaps;
  if (!s || !s.length) return;
  let a = s[0], b = null;
  if (rt <= a.t) { rec.dp = a.p; if (a.h) rec.dh = a.h; return; }
  for (let i = 0; i < s.length - 1; i++) if (s[i].t <= rt && rt <= s[i + 1].t) { a = s[i]; b = s[i + 1]; break; }
  if (!b) {
    // новых данных ещё нет — продолжаем движение по скорости (не дольше 0,35 с)
    const l = s[s.length - 1], dt = Math.min(rt - l.t, 350) / 1000;
    rec.dp = [l.p[0] + l.v[0] * dt, l.p[1] + l.v[1] * dt, l.p[2] + l.v[2] * dt];
    if (l.h) rec.dh = l.h;
    return;
  }
  const span = b.t - a.t, u = (rt - a.t) / span, d = span / 1000;
  if (a.w || b.w) {
    rec.dp = [a.p[0] + (b.p[0] - a.p[0]) * u, a.p[1] + (b.p[1] - a.p[1]) * u, a.p[2] + (b.p[2] - a.p[2]) * u];
  } else {
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = (u3 - 2 * u2 + u) * d, h01 = -2 * u3 + 3 * u2, h11 = (u3 - u2) * d;
    rec.dp = [0, 1, 2].map(k => h00 * a.p[k] + h10 * a.v[k] + h01 * b.p[k] + h11 * b.v[k]);
  }
  if (a.h && b.h) {
    const hx = a.h[0] + (b.h[0] - a.h[0]) * u, hy = a.h[1] + (b.h[1] - a.h[1]) * u, hz = a.h[2] + (b.h[2] - a.h[2]) * u;
    const l = Math.hypot(hx, hy, hz) || 1;
    rec.dh = [hx / l, hy / l, hz / l];
  }
}

function viewState() {
  return {
    origin: S.meRec ? S.meRec.dp : [0, 0, 0], me: S.me && S.meRec ? Object.assign({}, S.me, { h: S.meRec.dh || S.me.h }) : S.me, ents: S.ents, data: S.data, docked: S.docked,
    dockedShip: S.prof && S.prof.ship ? S.prof.ship.type : null
  };
}

// ======================================================================
// Объекты: поиск, расстояния, типы
// ======================================================================
function getObj(id) {
  const e = S.ents.get(id);
  if (e) return { ...e, pos: e.dp, kind: { s: 'ship', a: 'asteroid', w: 'wreck', d: 'drone' }[e.k], radius: e.r || 0 };
  const c = S.celById && S.celById[id];
  if (c) return { ...c, n: c.name };
  const an = S.anoms && S.anoms.find(a => a.id === id);
  if (an) return { ...an, n: an.name };
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
  asteroid: ['◆', 'Астероид'], wreck: ['⌧', 'Обломки'], drone: ['•', 'Дрон'], anomaly: ['✧', 'Аномалия']
};
const ANOM_TYPE = { combat: 'Боевая аномалия', ore: 'Рудная аномалия', relic: 'Руины', black: 'Чёрный рынок' };
function iconOf(o) {
  if (o.kind === 'ship') return o.dl ? '¤' : o.gd ? '✠' : o.npc ? '▼' : '▲';
  if (o.kind === 'anomaly' && o.akind === 'black') return '¤';
  return (KIND[o.kind] || ['•'])[0];
}
function typeOf(o) {
  if (o.kind === 'ship' && o.dl) return 'Контрабандист';
  if (o.kind === 'ship') return o.gd ? 'Страж порядка' : (o.ol ? 'Преступник · ' : '') + (S.data.ships[o.st] ? S.data.ships[o.st].name : 'Корабль');
  if (o.kind === 'asteroid') return S.data.items[o.ore].name;
  if (o.kind === 'anomaly') return ANOM_TYPE[o.akind] + (o.done ? ' (зачищено)' : '');
  if (o.kind === 'drone') return o.o === S.name ? 'Ваш дрон' : 'Дрон: ' + o.o;
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
  if (S.anoms) for (const a of S.anoms) list.push({ ...a, n: a.name });
  return list;
}

// ======================================================================
// Действия
// ======================================================================
function act(a, id) {
  id = id || S.sel;
  if (!id && !['stop', 'desel'].includes(a)) return;
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
    case 'black': {
      const did = o && o.dealer ? o.dealer : id;
      const near = S.ents.get(did);
      if (near && distTo(getObj(did)) <= 10000) send({ t: 'blackOpen', id: did });
      else if (o && distTo(o) > 150000) { send({ t: 'warp', id: o.dealer ? id : did, range: 0 }); note('Варп к контрабандисту. Нажмите «Торговать» ещё раз по прибытии.'); }
      else send({ t: 'blackOpen', id: did });
      break;
    }
    case 'desel': S.sel = null; break;
    case 'smart': {
      if (!o) return;
      const d = distTo(o);
      if (o.dl || (o.kind === 'anomaly' && o.akind === 'black' && d < 150000)) act('black', id);
      else if (o.kind === 'station') act('dock', id);
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
  if (o.dl || (o.kind === 'anomaly' && o.akind === 'black')) A.unshift(['black', '¤', 'Торговать', '']);
  if (['ship', 'asteroid', 'wreck'].includes(o.kind) && !o.dl) {
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
  Sound.click();
  send(S.pendingModule);
}

// ======================================================================
// Ввод
// ======================================================================
const canvas = $('#scene');
R.init(canvas);
applyCfg();
let drag = null;
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) drag = { x: e.clientX, y: e.clientY, moved: 0 }; hideCtx(); });
addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = e.clientX; drag.y = e.clientY;
  R.cam.yaw -= dx * 0.006 * CFG.sens;
  R.cam.pitch = Math.max(-1.45, Math.min(1.45, R.cam.pitch + dy * 0.006 * CFG.sens));
});
addEventListener('mouseup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => {
  const minD = S.me ? S.data.ships[S.me.st].radius * 4 : 200;
  R.cam.target = Math.max(minD, Math.min(400000, R.cam.target * Math.pow(1.0015, e.deltaY)));
}, { passive: true });
canvas.addEventListener('dblclick', (e) => { if (S.me && !S.docked) send({ t: 'dir', dir: R.screenDir(e.clientX, e.clientY) }); });
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!S.docked) spaceMenu(e.clientX, e.clientY); });

// Сенсорное управление: палец — вращение камеры, щипок — зум, двойной тап — курс, долгое нажатие — меню варпа
const touches = new Map();
let pinch0 = null, tap = null, lastTap = 0, lpTimer = null;
const touchDist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  canvas.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  hideCtx();
  if (touches.size === 1) {
    tap = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
    clearTimeout(lpTimer);
    lpTimer = setTimeout(() => { if (tap && tap.moved < 10 && !S.docked) { tap.long = true; spaceMenu(tap.x, tap.y); } }, 600);
  } else { clearTimeout(lpTimer); tap = null; pinch0 = { d: touchDist(), z: R.cam.target }; }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' || !touches.has(e.pointerId)) return;
  const prev = touches.get(e.pointerId);
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 1) {
    if (tap) tap.moved += Math.abs(dx) + Math.abs(dy);
    R.cam.yaw -= dx * 0.008 * CFG.sens;
    R.cam.pitch = Math.max(-1.45, Math.min(1.45, R.cam.pitch + dy * 0.008 * CFG.sens));
  } else if (touches.size === 2 && pinch0) {
    const minD = S.me ? S.data.ships[S.me.st].radius * 4 : 200;
    R.cam.target = Math.max(minD, Math.min(400000, pinch0.z * pinch0.d / touchDist()));
  }
});
const touchEnd = (e) => {
  if (e.pointerType === 'mouse') return;
  touches.delete(e.pointerId);
  clearTimeout(lpTimer);
  const now = performance.now();
  if (tap && tap.moved < 10 && !tap.long && now - tap.t < 300) {
    if (now - lastTap < 350 && S.me && !S.docked) { send({ t: 'dir', dir: R.screenDir(tap.x, tap.y) }); lastTap = 0; note('Курс задан'); }
    else lastTap = now;
  }
  tap = null;
  if (touches.size < 2) pinch0 = null;
};
canvas.addEventListener('pointerup', touchEnd);
canvas.addEventListener('pointercancel', touchEnd);

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
  if (k === 'KeyO') return openWin('settings');
  if (S.docked) return;
  if (k === 'Space' && e.ctrlKey) { e.preventDefault(); return act('stop'); }
  if (k === 'KeyQ') act('approach');
  if (k === 'KeyW') act('orbit');
  if (k === 'KeyE') act('keep');
  if (k === 'KeyS') act('warp');
  if (k === 'KeyD') { const o = getObj(S.sel); if (o && o.kind === 'station') act('dock'); else if (o && o.kind === 'gate') act('jump'); }
  if (k === 'KeyL') act('lock');
  if (k === 'KeyV') send({ t: 'scan' });
  if (k === 'KeyF' && e.shiftKey) send({ t: 'droneLaunch' });
  else if (k === 'KeyF') droneEngage();
  if (k === 'KeyR' && e.shiftKey) send({ t: 'droneRecall' });
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
  const z = CFG.ui || 1;
  el.style.left = Math.min(x / z, innerWidth / z - 220) + 'px';
  el.style.top = Math.min(y / z, innerHeight / z - el.offsetHeight - 10) + 'px';
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
  const groups = [['Станции', 'station'], ['Звёздные врата', 'gate'], ['Пояса астероидов', 'belt'], ['Аномалии', 'anomaly'], ['Планеты', 'planet'], ['Звезда', 'sun']];
  const items = [];
  for (const [label, kind] of groups) {
    const cs = [...S.sys.celestials, ...(S.anoms || [])].filter(c => c.kind === kind);
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

// ---------- всплывающие цифры урона ----------
const dmgNums = [];
function damageNumber(fx) {
  if (fx.k !== 'beam' || !fx.hit || !fx.dmg || !S.me) return;
  const fromEnt = S.ents.get(fx.from);
  const mine = fx.from === S.me.id || (fromEnt && fromEnt.k === 'd' && fromEnt.o === S.name);
  const onMe = fx.to === S.me.id;
  if (!mine && !onMe) return;
  const el = document.createElement('div');
  el.className = 'dmg ' + (onMe ? 'in' : 'out');
  el.textContent = fx.dmg;
  brRoot.appendChild(el);
  dmgNums.push({ el, id: fx.to, t0: performance.now(), dx: (Math.random() - 0.5) * 110, dy: (Math.random() - 0.5) * 50 });
  if (dmgNums.length > 40) dmgNums.shift().el.remove();
}
function updateDamageNumbers(now) {
  for (let i = dmgNums.length - 1; i >= 0; i--) {
    const d = dmgNums[i], k = (now - d.t0) / 1100;
    let pos = null;
    if (d.id === S.me.id) pos = S.meRec.dp; else { const e = S.ents.get(d.id); if (e) pos = e.dp; }
    const p = pos && R.project(sub(pos, S.meRec.dp));
    if (k >= 1 || !p) { d.el.remove(); dmgNums.splice(i, 1); continue; }
    d.el.style.transform = `translate(${p[0] + d.dx}px, ${p[1] - 30 + d.dy - k * 50}px) scale(${1.15 - k * 0.35})`;
    d.el.style.opacity = 1 - k * k;
  }
}

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
      b.innerHTML = '<div class="bi"></div><div class="bh"><i></i><i></i><i></i></div><div class="bl"></div>';
      brRoot.appendChild(b); brackets.set(o.id, b);
    }
    const cls = ['br'];
    if (o.kind === 'ship') {
      if (o.dl) cls.push('dealer', 'lbl'); else if (o.gd) cls.push('guard'); else if (o.npc) cls.push('hostile'); else if (o.civ) cls.push('civ'); else cls.push('player');
      if (o.cr) cls.push('crim'); else if (o.su) cls.push('susp');
      if (o.ol) cls.push('outlaw');
      if (o.ag) cls.push('aggro');
    } else if (o.kind === 'asteroid') cls.push('ast');
    else if (o.kind === 'drone') cls.push(o.o === S.name ? 'mydrone' : 'player');
    else if (o.kind === 'anomaly') cls.push(o.akind === 'black' ? 'dealer' : 'anom', 'lbl');
    else cls.push('cel');
    if (S.sel === o.id) cls.push('sel');
    if (S.me.locks.includes(o.id)) cls.push('locked');
    if (o.kind === 'ship' || o.kind === 'station' || o.kind === 'gate' || (CFG.labels && o.kind !== 'asteroid')) cls.push('lbl');
    const showHp = (o.kind === 'ship' || o.kind === 'drone') && d < 150000 && (S.sel === o.id || S.me.locks.includes(o.id) || isHostile(o));
    if (showHp) {
      cls.push('hp');
      const hp = o.kind === 'drone' ? `0,0,${o.hu}` : `${o.sh},${o.ar},${o.hu}`;
      if (b._hp !== hp) {
        const [sh, ar, hu] = hp.split(',').map(Number), bars = b.children[1].children;
        bars[0].style.width = sh * 100 + '%'; bars[1].style.width = ar * 100 + '%'; bars[2].style.width = hu * 100 + '%';
        b._hp = hp;
      }
    }
    const c = cls.join(' ');
    if (b._c !== c) { b.className = c; b._c = c; }
    const icon = iconOf(o);
    const label = `${o.n || o.name}${o.o && o.o !== o.n ? '' : ''} · ${fmtDist(distTo(o))}`;
    if (b._i !== icon) { b.firstChild.textContent = icon; b._i = icon; }
    if (b._l !== label) { b.lastChild.textContent = label; b._l = label; }
    b.style.transform = `translate3d(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px, 0) translate(-50%, -50%)`;
  }
  for (const [id, b] of brackets) if (!used.has(id)) { b.remove(); brackets.delete(id); }
}

// ======================================================================
// Обзор и выбранный объект
// ======================================================================
const OV_FILTERS = {
  all: (o) => o.kind !== 'asteroid' || distTo(o) < 100000,
  combat: (o) => o.kind === 'ship' || o.kind === 'wreck' || o.kind === 'drone',
  mining: (o) => o.kind === 'asteroid' || o.kind === 'belt',
  nav: (o) => ['station', 'gate', 'belt', 'planet', 'sun', 'anomaly'].includes(o.kind)
};
$('#ov-tabs').onclick = (e) => {
  const f = e.target.dataset.f; if (!f) return;
  S.ovFilter = f;
  for (const s of $('#ov-tabs').children) s.classList.toggle('on', s.dataset.f === f);
  renderOverview();
};
// Строки обзора не пересоздаются, а обновляются на месте — поэтому обычный click надёжен и для мыши, и для пальца
let lastPress = { id: null, t: 0 };
$('#ov-list').addEventListener('click', (e) => {
  const r = e.target.closest('.ov-row'); if (!r) return;
  const id = r.dataset.id;
  const now = performance.now();
  if (lastPress.id === id && now - lastPress.t < 400) { act('smart', id); if (MOBILE) togglePanel('ov', false); }
  lastPress = { id, t: now };
  select(id, e); renderOverview();
  if (MOBILE) togglePanel('ov', false);
});
$('#ov-list').addEventListener('contextmenu', (e) => { const r = e.target.closest('.ov-row'); e.preventDefault(); if (r) objMenu(e.clientX, e.clientY, r.dataset.id); });

const ovRows = new Map();
function renderOverview() {
  if (!S.me) return;
  const box = $('#ov-list');
  const list = allObjects().filter(OV_FILTERS[S.ovFilter]).map(o => ({ o, d: distTo(o) })).sort((a, b) => a.d - b.d).slice(0, 120);
  const keep = new Set();
  let prev = null;
  for (const { o, d } of list) {
    keep.add(o.id);
    let r = ovRows.get(o.id);
    if (!r) {
      r = document.createElement('div'); r.dataset.id = o.id;
      r.innerHTML = '<span class="ic"></span><span></span><span class="muted"></span><span class="d"></span>';
      ovRows.set(o.id, r);
    }
    const cls = 'ov-row' + (S.sel === o.id ? ' sel' : '') + (isHostile(o) ? ' hostile' : '') + (S.me.locks.includes(o.id) ? ' locked' : '');
    if (r.className !== cls) r.className = cls;
    let name = o.n || o.name;
    if (o.kind === 'asteroid') name = `${S.data.items[o.ore].name} (${num(o.am)})`;
    const cells = [iconOf(o), name, typeOf(o), fmtDist(d)];
    cells.forEach((t, i) => { const c = r.children[i]; if (c.textContent !== t) c.textContent = t; });
    const expected = prev ? prev.nextSibling : box.firstChild;
    if (expected !== r) box.insertBefore(r, expected);
    prev = r;
  }
  for (const [id, r] of ovRows) if (!keep.has(id)) { r.remove(); ovRows.delete(id); }
}

$('#sel-body').innerHTML = '<div id="sel-info"></div><div class="sel-actions" id="sel-acts"></div>';
onTap($('#sel-acts'), (e) => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); });
onTap($('#mact-btns'), (e) => { const b = e.target.closest('[data-act]'); if (b) { act(b.dataset.act); Sound.click(); } });

function renderSelected() {
  const o = S.sel && getObj(S.sel);
  if (!o) {
    setHTML($('#sel-info'), '<div class="muted">Ничего не выбрано. Щёлкните объект в космосе или в обзоре.</div>'); setHTML($('#sel-acts'), '');
    $('#mact').classList.add('hidden');
    return;
  }
  let extra = '';
  if (o.kind === 'ship') {
    extra = `<div class="bars"><div class="bar sh"><i style="width:${o.sh * 100}%"></i></div><div class="bar ar"><i style="width:${o.ar * 100}%"></i></div><div class="bar hu"><i style="width:${o.hu * 100}%"></i></div></div>`;
    if (o.o) extra += `<div class="muted">Пилот: ${esc(o.o)}${o.cr ? ' · <span style="color:var(--bad)">преступник</span>' : o.su ? ' · <span style="color:var(--warn)">подозреваемый</span>' : ''}</div>`;
    if (o.tg) extra += `<div style="color:var(--bad)">⚠ Захватил вас в прицел</div>`;
  }
  if (o.kind === 'asteroid') extra = `<div class="muted">Осталось: ${num(o.am)} ед. руды «${esc(S.data.items[o.ore].name)}»</div>`;
  if (o.kind === 'wreck' && o.items) extra = `<div class="muted">${Object.entries(o.items).map(([k, q]) => `${esc(S.data.items[k].name)} ×${q}`).join(', ')}</div>`;
  const acts = actionsFor(o).map(([a, ic, label, key]) => `<button data-act="${a}" title="${key}"><b>${ic}</b>${esc(label)}</button>`).join('');
  setHTML($('#sel-info'), `<div class="sel-name">${esc(o.n || o.name)}</div><div class="sel-sub">${esc(typeOf(o))} · ${fmtDist(distTo(o))}</div>${extra}`);
  setHTML($('#sel-acts'), acts);
  // мобильная полоса действий у нижнего края
  $('#mact').classList.remove('hidden');
  const nm = `${o.n || o.name} · ${fmtDist(distTo(o))}`;
  if ($('#mact-name').textContent !== nm) $('#mact-name').textContent = nm;
  setHTML($('#mact-btns'), actionsFor(o).filter(([a]) => a !== 'info').map(([a, ic, label]) => `<button data-act="${a}"><b>${ic}</b>${esc(label)}</button>`).join('') + '<button data-act="desel"><b>×</b>Снять</button>');
}

// ======================================================================
// Цели, HUD, модули
// ======================================================================
onTap($('#targets'), (e) => { const t = e.target.closest('.tgt'); if (t) { S.active = t.dataset.id; S.sel = t.dataset.id; renderTargets(); } });
$('#targets').addEventListener('contextmenu', (e) => { e.preventDefault(); const t = e.target.closest('.tgt'); if (t) objMenu(e.clientX, e.clientY, t.dataset.id); });

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
  if (me.scan != null) st.push(`<div class="warp">СКАНИРОВАНИЕ · ${Math.round(me.scan * 100)}%</div>`);
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
$('#modules').addEventListener('pointerdown', (e) => { const m = e.target.closest('.mod'); if (m && m.dataset.slot && e.button === 0) toggleModule(+m.dataset.slot); });
$('#speedbar').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); send({ t: 'speed', v: (e.clientX - r.left) / r.width }); });
$('#b-stop').onclick = () => act('stop');
$('#b-full').onclick = () => send({ t: 'speed', v: 1 });
$('#b-scan').onclick = () => send({ t: 'scan' });

function slotType(shipType, idx) {
  const s = S.data.ships[shipType].slots;
  return idx < s.high ? 'high' : idx < s.high + s.mid ? 'mid' : 'low';
}

// ======================================================================
// Инфо о системе, уведомления, чат
// ======================================================================
// Заставка при входе в новую систему
function jumpBanner(m) {
  const reg = S.data.regions[m.region] || {};
  const star = S.data.starTypes[S.data.stars[m.id]] || {};
  const el = $('#jump-banner');
  el.innerHTML = `<div class="jb-region" style="color:${reg.color}">${esc(reg.name || '')}</div>
    <div class="jb-name">${esc(m.name)}</div>
    <div class="jb-row"><span style="color:${secColor(m.sec)}">безопасность ${m.sec.toFixed(1)}</span><span>${esc(star.name || '')}</span><span class="jb-inc">доход ×${(m.income || 1).toFixed(1)}</span></div>`;
  el.style.setProperty('--rc', reg.color || '#5fc8e8');
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  if (S.lastRegion && S.lastRegion !== m.region) note(`Вы вошли в регион «${reg.name}». Множитель дохода ×${(m.income || 1).toFixed(1)}`, m.income > 1 ? 'good' : 'info');
  S.lastRegion = m.region;
}

function updateSysInfo() {
  if (!S.sys) return;
  if (!S.lastRegion) S.lastRegion = S.sys.region;
  const reg = S.data.regions[S.sys.region] || {};
  $('#sys-region').innerHTML = `<span style="color:${reg.color}">${esc(reg.name || '')}</span> · <span class="inc" title="Множитель дохода: добыча, награды за пиратов, аномалии, задания">доход ×${(S.sys.income || 1).toFixed(1)}</span>`;
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
    html = artImg(o.st, 'ship-art big') + html;
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
$('#neocom').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (MOBILE) togglePanel('menu', false);
  if (b.id === 'snd') { updateSoundBtn(Sound.toggle()); return; }
  if (b.dataset.win === 'map') toggleMap(); else openWin(b.dataset.win);
};
$('#mbar').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  Sound.click();
  const k = b.dataset.m;
  if (k === 'warp') { togglePanel('x', false); spaceMenu(innerWidth / 2 - 100, 70); }
  else if (k === 'scan') send({ t: 'scan' });
  else togglePanel(k);
};
function updateSoundBtn(muted) { $('#snd').innerHTML = (muted ? '🔇' : '🔊') + '<small>Звук</small>'; }
try { updateSoundBtn(localStorage.getItem('vf-mute') === '1'); } catch { updateSoundBtn(false); }
$('#win-close').onclick = closeWin;
function closeWin() { $('#win').classList.add('hidden'); S.win = null; }
const WIN_TITLES = { black: 'Чёрный рынок', settings: 'Настройки', cargo: 'Трюм корабля', skills: 'Навыки', missions: 'Задания', assets: 'Имущество', help: 'Управление', info: 'Информация' };
function openWin(name, html, keep) {
  if (S.win === name && !html && !keep) return closeWin();
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
  if (S.win === 'skills') { setHTML(el, skillsHTML()); return updateSkillProgress(); }
  if (S.win === 'missions') return setHTML(el, missionsHTML(false));
  if (S.win === 'assets') return setHTML(el, assetsHTML());
  if (S.win === 'help') return setHTML(el, (MOBILE ? HELP_MOBILE : '') + HELP + `<p><button data-a="tutorial">Показать обучение «Первые шаги» заново</button></p>`);
  if (S.win === 'settings') return setHTML(el, settingsHTML());
  if (S.win === 'black') return setHTML(el, blackHTML());
}
onTap($('#win-body'), onActionClick);

const HELP_MOBILE = `<h3>Управление на телефоне</h3><div class="kv">
<span>Палец по экрану</span><span>вращать камеру</span>
<span>Два пальца (щипок)</span><span>приблизить / отдалить</span>
<span>Двойной тап по космосу</span><span>лететь в этом направлении</span>
<span>Долгое нажатие на космос</span><span>меню варпа</span>
<span>Тап по объекту</span><span>выбрать — внизу появятся кнопки действий</span>
<span>☰</span><span>меню: карта, трюм, навыки, задания, настройки</span>
<span>◫ / » / ◎ / 💬</span><span>обзор / варп / скан / чат</span>
<span>Круглые кнопки справа внизу</span><span>модули: орудия, бур, щит</span></div>`;
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
<span>Shift+F / F / Shift+R</span><span>выпустить дронов / дроны атакуют или копают активную цель / вернуть дронов</span>
<span>V</span><span>сканировать систему в поисках аномалий</span>
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

// Эмблемы навыков (SVG): своя фигура и цвет у каждого
const SKILL_ICON = {
  gunnery: ['#ff7a50', '<circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M24 6v10M24 32v10M6 24h10M32 24h10" stroke="currentColor" stroke-width="2.5"/><circle cx="24" cy="24" r="2.5" fill="currentColor"/>'],
  shields: ['#5fb8ff', '<path d="M24 6l15 6v10c0 10-7 17-15 20C16 39 9 32 9 22V12z" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M17 23l5 5 9-10" fill="none" stroke="currentColor" stroke-width="2.5"/>'],
  armor: ['#c8cdd4', '<path d="M10 14h28v8H10zM10 26h28v8H10z" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M17 14v8M31 14v8M24 26v8" stroke="currentColor" stroke-width="2"/>'],
  targeting: ['#ff5a6a', '<path d="M12 18v-6h6M30 12h6v6M36 30v6h-6M18 36h-6v-6" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M24 17l7 7-7 7-7-7z" fill="none" stroke="currentColor" stroke-width="2.2"/>'],
  drones: ['#9fe08a', '<circle cx="24" cy="24" r="5" fill="currentColor"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="36" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="39" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5 5M33 15l-5 5M24 29v6" stroke="currentColor" stroke-width="1.8"/>'],
  navigation: ['#5fe0d0', '<circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="2"/><path d="M24 11l5 13-5 13-5-13z" fill="currentColor" opacity=".9"/>'],
  warpnav: ['#a08cff', '<path d="M8 16h18M6 24h26M8 32h18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M30 14l10 10-10 10" fill="none" stroke="currentColor" stroke-width="2.8"/>'],
  engineering: ['#ffd24a', '<path d="M27 6L13 27h10l-3 15 15-22H25z" fill="currentColor"/>'],
  mining: ['#7cf0a0', '<path d="M24 7l11 10-11 24-11-24z" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M13 17h22M24 7v34" stroke="currentColor" stroke-width="1.6"/>'],
  scanning: ['#4ad0ff', '<circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M24 24L36 13" stroke="currentColor" stroke-width="2.5"/><circle cx="31" cy="29" r="2.5" fill="currentColor"/>'],
  trade: ['#e8b45f', '<circle cx="19" cy="27" r="9" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="30" cy="20" r="9" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M30 16v8M19 23v8" stroke="currentColor" stroke-width="2"/>']
};
function skillIcon(id, big) {
  const [color, body] = SKILL_ICON[id] || ['#5fc8e8', '<circle cx="24" cy="24" r="12" fill="none" stroke="currentColor" stroke-width="2.5"/>'];
  return `<svg class="sk-icon${big ? ' big' : ''}" viewBox="0 0 48 48" style="color:${color}"><path d="M24 2l19 11v22L24 46 5 35V13z" fill="rgba(255,255,255,0.04)" stroke="currentColor" stroke-opacity=".45" stroke-width="1.5"/>${body}</svg>`;
}
function skillLevelText(sk, lv) {
  if (sk.levels) return sk.levels[lv - 1];
  return `${sk.sign || '+'}${sk.step * lv}${sk.unit} ${sk.what}`;
}
function skillsHTML() {
  const p = S.prof;
  let html = '<div id="sk-train"></div>';
  const groups = {};
  for (const [id, sk] of Object.entries(S.data.skills)) (groups[sk.group || 'Прочее'] = groups[sk.group || 'Прочее'] || []).push([id, sk]);
  for (const [grp, list] of Object.entries(groups)) {
    html += `<h3>${esc(grp)}</h3><div class="sk-grid">`;
    for (const [id, sk] of list) {
      const lv = p.skills[id] || 0;
      const tr = p.training && p.training.skill === id;
      const boxes = [1, 2, 3, 4, 5].map(i => `<i class="${i <= lv ? 'on' : tr && i === lv + 1 ? 'tr' : ''}"></i>`).join('');
      const steps = [1, 2, 3, 4, 5].map(i => `<div class="sk-step ${i <= lv ? 'got' : i === lv + 1 ? 'next' : ''}"><b>${i}</b><span>${esc(skillLevelText(sk, i))}</span><em>${fmtTime(S.data.skillTime[i])}</em></div>`).join('');
      html += `<div class="sk-card ${tr ? 'training' : ''}">
        <div class="sk-head">${skillIcon(id)}<div class="sk-title"><div class="sk-name">${esc(sk.name)}</div><div class="lv">${boxes}</div></div></div>
        <div class="muted sk-desc">${esc(sk.desc)}</div>
        <div class="sk-now">Сейчас: <b>${lv ? esc(skillLevelText(sk, lv)) : 'нет бонуса'}</b></div>
        <details class="sk-steps"><summary>Что даёт каждый уровень</summary>${steps}</details>
        ${lv >= 5 ? '<div class="sk-max">Изучен полностью</div>' : tr ? '<div class="sk-max">Изучается…</div>' : `<button class="primary" data-a="train" data-skill="${id}">Изучить ${lv + 1} · ${fmtTime(S.data.skillTime[lv + 1])}</button>`}
      </div>`;
    }
    html += '</div>';
  }
  return html;
}
// Прогресс изучения обновляем отдельно, не трогая кнопки (иначе нажатия теряются)
function updateSkillProgress() {
  const el = document.getElementById('sk-train');
  if (!el || !S.prof) return;
  const tr = S.prof.training;
  let h;
  if (tr) {
    const f = Math.min(1, (S.serverNow() - tr.start) / (tr.end - tr.start));
    h = `<div class="sk-training">${skillIcon(tr.skill, true)}<div style="flex:1"><div>Изучается: <b>${esc(S.data.skills[tr.skill].name)} ${tr.level}</b> — ${esc(skillLevelText(S.data.skills[tr.skill], tr.level))}</div>
      <div class="cap-bar"><i style="width:${(f * 100).toFixed(1)}%"></i></div><div class="muted">Осталось: ${fmtTime((tr.end - S.serverNow()) / 1000)}</div></div></div>`;
  } else h = '<div class="muted" style="margin-bottom:8px">Навык не изучается. Навыки изучаются в реальном времени, даже когда вы не в игре. Выберите навык ниже.</div>';
  setHTML(el, h);
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

// Концепт-арты кораблей (в одиночной сборке встроены в страницу как window.VF_ART)
const SHIP_ART = ['iskra', 'klinok', 'burlak', 'tyagach', 'strazh', 'molot', 'strizh', 'sokol', 'staratel', 'vihr', 'piligrim', 'leviafan', 'kit', 'citadel'];
function shipArt(type) {
  if (!SHIP_ART.includes(type)) return null;
  return (window.VF_ART && window.VF_ART[type]) || `img/ships/${type}.jpg`;
}
function artImg(type, cls = 'ship-art') {
  const src = shipArt(type);
  return src ? `<img class="${cls}" src="${src}" alt="${esc(S.data.ships[type].name)}" loading="lazy">` : '';
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
// Обучение «Первые шаги»
// ======================================================================
const TUT = [
  ['undock', 'Отстыкуйтесь от станции', 'Кнопка «Отстыковка» справа вверху.'],
  ['belt', 'Варп к поясу астероидов', 'Правый щелчок по космосу → «Пояса астероидов» → любой пояс.', 'Кнопка » вверху → «Пояса астероидов» → любой пояс.'],
  ['lock', 'Захватите астероид', 'Ctrl+щелчок по астероиду в космосе или в обзоре (вкладка «Добыча»).', 'Откройте обзор ◫ → «Добыча», выберите астероид и нажмите «Захват» внизу.'],
  ['mine', 'Добудьте руду', 'Включите буровой лазер — F2 или кнопка с киркой внизу. Подлетите ближе, если цель далеко.', 'Нажмите кнопку с киркой справа внизу. Если цель далеко — «Подлететь».'],
  ['dock', 'Вернитесь на станцию', 'Правый щелчок по космосу → «Станции» — корабль сам долетит и пристыкуется.', 'Кнопка » → «Станции» — корабль сам долетит и пристыкуется.'],
  ['sell', 'Продайте руду', 'Ангар → «Разгрузить всё в ангар», затем вкладка «Рынок» → «Продать».'],
  ['skill', 'Начните изучать навык', 'Вкладка «Навыки» на станции. Навыки учатся даже без вас в игре.'],
  ['scan', 'Найдите аномалию', 'В космосе нажмите V (или «◎ Скан») — найденное появится в обзоре на вкладке «Навигация».', 'Кнопка ◎ вверху — найденное появится в обзоре ◫ на вкладке «Навигация».']
];
const tut = { done: {}, hidden: false };
try { Object.assign(tut, JSON.parse(localStorage.getItem('vf-tut') || '{}')); } catch {}
function saveTut() { try { localStorage.setItem('vf-tut', JSON.stringify(tut)); } catch {} }
function markTut(id) { if (!tut.done[id]) { tut.done[id] = true; saveTut(); if (!tut.hidden) { Sound.beep(660, 990, 0.08); note('Шаг выполнен: ' + TUT.find(t => t[0] === id)[1], 'good'); } } }
function checkTutorial() {
  const p = S.prof;
  if (!p) return;
  if (S.me && !S.docked) markTut('undock');
  if (S.me && S.sys && S.sys.celestials.some(c => c.kind === 'belt' && len(sub(c.pos, S.meRec.dp)) < 60000)) markTut('belt');
  if (S.me && S.me.locks.some(id => { const e = S.ents.get(id); return e && e.k === 'a'; })) markTut('lock');
  if (Object.keys(p.ship.cargo).some(k => k.startsWith('ore_'))) markTut('mine');
  if (S.docked && tut.done.mine) markTut('dock');
  if (p.training || Object.keys(p.skills).length) markTut('skill');
  if (S.anoms && S.anoms.some(a => a.akind !== 'black')) markTut('scan');
  renderTutorial();
}
function renderTutorial() {
  const el = $('#tut');
  const left = TUT.filter(t => !tut.done[t[0]]);
  if (tut.hidden || !left.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const cur = left[0][0];
  setHTML(el, `<div class="ph">Первые шаги <span>${TUT.length - left.length} / ${TUT.length}</span><button class="x" data-tut="hide" title="Скрыть (вернуть можно в «Помощи»)">×</button></div>
    <div class="tut-list">${TUT.map(([id, title, pcHint, mobHint]) => { const hint = MOBILE && mobHint ? mobHint : pcHint; return `<div class="tut-step ${tut.done[id] ? 'done' : id === cur ? 'cur' : ''}"><b>${tut.done[id] ? '✓' : id === cur ? '›' : '·'}</b><div>${esc(title)}${id === cur ? `<div class="tut-hint">${esc(hint)}</div>` : ''}</div></div>`; }).join('')}</div>`);
}
onTap($('#tut'), (e) => { if (e.target.dataset.tut === 'hide') { tut.hidden = true; saveTut(); renderTutorial(); } });

// ======================================================================
// Дроны
// ======================================================================
// Окно чёрного рынка
function blackHTML() {
  const b = S.black;
  if (!b) return '';
  const left = Math.max(0, (b.expires - S.serverNow()) / 1000);
  const desc = (id) => S.data.modules[id] ? moduleDesc(S.data.modules[id]) : S.data.drones[id] ? droneDesc(S.data.drones[id]) : S.data.items[id].cat;
  let h = `<div class="bm-head"><div class="bm-logo">¤</div><div><div class="bm-name">${esc(b.name)}</div><div class="muted">Уйдёт через <b class="bm-timer">${fmtTime(left)}</b> · место в трюме ${num(b.cargoFree)} м³ · баланс <span class="isk">${isk(S.prof.credits)}</span></div></div></div>`;
  h += '<h3>Продаёт</h3>';
  h += b.stock.length ? `<table class="tbl"><tr><th>Товар</th><th>Описание</th><th class="r">Есть</th><th class="r">Цена</th><th></th></tr>${b.stock.map(o => {
    const it = S.data.items[o.item];
    return `<tr class="${it.elite ? 'bm-elite' : 'bm-cb'}"><td>${esc(it.name)}<div class="muted">${esc(it.cat)}</div></td><td class="muted">${desc(o.item)}</td><td class="r">${o.qty}</td><td class="r isk">${num(o.price)}</td>
      <td class="r"><input class="qty" type="number" min="1" max="${o.qty}" value="1" id="bq-bm-${o.item}"> <button class="primary" data-a="bmBuy" data-item="${o.item}">Купить</button></td></tr>`;
  }).join('')}</table>` : '<div class="muted">Всё распродано.</div>';
  h += '<h3>Скупает</h3><table class="tbl"><tr><th>Товар</th><th class="r">У вас</th><th class="r">Цена за ед.</th><th></th></tr>' + Object.entries(b.buys).map(([id, pr]) => {
    const q = (S.prof.ship.cargo || {})[id] || 0;
    return `<tr><td>${esc(S.data.items[id].name)}</td><td class="r">${q}</td><td class="r isk">${num(pr)}</td><td class="r">${q ? `<button data-a="bmSell" data-item="${id}">Продать всё</button>` : '<span class="muted">нет в трюме</span>'}</td></tr>`;
  }).join('') + '</table>';
  h += '<p class="muted">Покупки кладутся в трюм. Чтобы установить элитный модуль, долетите до станции, разгрузите трюм и поставьте модуль во вкладке «Оснастка». Контрабанду станции не покупают — продайте её другому контрабандисту дороже.</p>';
  return h;
}

function settingsHTML() {
  const opt = (v, cur, label) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${label}</option>`;
  return `<div class="settings">
    <label>Качество графики<select id="cfg-quality">${opt('high', CFG.quality, 'Высокое — тени, свечение, следы')}${opt('medium', CFG.quality, 'Среднее — без теней')}${opt('low', CFG.quality, 'Низкое — для слабых компьютеров')}</select></label>
    <label>Громкость <span id="cfg-vol-v">${Math.round(CFG.volume * 100)}%</span><input type="range" id="cfg-volume" min="0" max="1" step="0.05" value="${CFG.volume}"></label>
    <label>Масштаб интерфейса<select id="cfg-ui">${[0.85, 1, 1.15, 1.3].map(v => opt(v, CFG.ui, Math.round(v * 100) + '%')).join('')}</select></label>
    <label>Чувствительность камеры <span id="cfg-sens-v">${CFG.sens.toFixed(1)}</span><input type="range" id="cfg-sens" min="0.3" max="2.5" step="0.1" value="${CFG.sens}"></label>
    <label class="chk"><input type="checkbox" id="cfg-labels" ${CFG.labels ? 'checked' : ''}> Подписи у всех объектов в космосе</label>
  </div>`;
}
function applyCfg() {
  R.setQuality(CFG.quality);
  $('#ui').style.zoom = CFG.ui;
  Sound.setVolume(CFG.volume);
}
$('#win-body').addEventListener('input', (e) => {
  const id = e.target.id;
  if (!id.startsWith('cfg-')) return;
  if (id === 'cfg-quality') { CFG.quality = e.target.value; CFG.autoQ = false; }
  if (id === 'cfg-volume') { CFG.volume = +e.target.value; $('#cfg-vol-v').textContent = Math.round(CFG.volume * 100) + '%'; }
  if (id === 'cfg-ui') CFG.ui = +e.target.value;
  if (id === 'cfg-sens') { CFG.sens = +e.target.value; $('#cfg-sens-v').textContent = CFG.sens.toFixed(1); }
  if (id === 'cfg-labels') CFG.labels = e.target.checked;
  saveCfg(); applyCfg();
});

function droneDesc(d) {
  return d.kind === 'combat' ? `урон ${d.dmg} / ${d.cycle}с, ${d.vol} м³, прочность ${d.hp}` : `${d.yield} м³ руды / ${d.cycle}с, ${d.vol} м³`;
}
function droneBayHTML() {
  const p = S.prof, t = S.data.ships[p.ship.type];
  if (!t.droneBay) return '<h3>Отсек дронов</h3><div class="muted">У этого корабля нет отсека дронов.</div>';
  const bay = p.ship.drones || {};
  let used = 0; for (const id in bay) used += bay[id] * S.data.drones[id].vol;
  const rows = Object.entries(bay).map(([id, q]) => `<div class="slot-row"><span class="sm">${esc(S.data.drones[id].name)} ×${q}<br><span class="muted">${droneDesc(S.data.drones[id])}</span></span><button data-a="unloadDrone" data-item="${id}">В ангар</button></div>`).join('');
  return `<h3>Отсек дронов <span class="muted">${used} / ${t.droneBay} м³ · одновременно до ${t.maxDrones}</span></h3>${rows || '<div class="muted">Пусто. Купите дронов на рынке и загрузите из ангара.</div>'}`;
}
function droneEngage() {
  let target = S.active;
  if (!target && S.sel && S.me && S.me.locks.includes(S.sel)) target = S.sel;
  if (!target) return note('Сначала захватите цель (Ctrl+щелчок)', 'warn');
  send({ t: 'droneEngage', target });
}
onTap($('#drones'), (e) => {
  const b = e.target.closest('[data-dr]'); if (!b) return;
  Sound.click();
  if (b.dataset.dr === 'launch') { send({ t: 'droneLaunch' }); Sound.whoosh(0.3, true, 0.8); }
  else if (b.dataset.dr === 'engage') droneEngage();
  else if (b.dataset.dr === 'recall') send({ t: 'droneRecall' });
});
const TASK = { idle: 'ожидает', attack: 'атакует', mine: 'добывает', return: 'возвращается' };
function renderDrones() {
  const el = $('#drones');
  const p = S.prof;
  const t = p && S.data.ships[p.ship.type];
  if (!t || !t.droneBay || S.docked) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const bay = p.ship.drones || {};
  const inBay = Object.entries(bay).map(([id, q]) => `${esc(S.data.drones[id].name.replace(/^.*«(.*)»$/, '$1'))} ×${q}`).join(', ') || 'пусто';
  const mine = [...S.ents.values()].filter(e => e.k === 'd' && e.o === S.name);
  const list = mine.map(d => `<div class="dr-row"><span>${esc(d.n.replace(/^.*«(.*)»$/, '$1'))}</span><span class="bar hu" style="flex:1"><i style="width:${d.hu * 100}%"></i></span><span class="muted">${TASK[d.task] || ''}</span></div>`).join('');
  setHTML($('#dr-body'), `<div class="muted" style="font-size:11px">В отсеке: ${inBay}</div>${list}
    <div class="dr-btns"><button data-dr="launch" title="Shift+F">Выпустить</button><button data-dr="engage" title="F">Атака / добыча</button><button data-dr="recall" title="Shift+R">Вернуть</button></div>`);
  $('#dr-count').textContent = `${mine.length} / ${t.maxDrones}`;
}

// ======================================================================
// Станция
// ======================================================================
function showStation() {
  document.body.classList.add('docked'); togglePanel('x', false);
  $('#station').classList.remove('hidden');
  for (const id of ['#rightcol', '#targets', '#hud']) $(id).classList.add('hidden');
  $('#st-name').textContent = S.docked.name;
  const sys = S.sysById[S.docked.sys];
  $('#st-sys').innerHTML = `<span style="color:${secColor(sys.sec)}">${sys.sec.toFixed(1)}</span> ${esc(sys.name)}`;
  S.market = null; S.agents = null;
  renderStation();
}
function hideStation() {
  document.body.classList.remove('docked');
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
onTap($('#st-body'), onActionClick);

function renderStation() {
  if (!S.docked || !S.prof) return;
  const el = $('#st-body');
  const p = S.prof, h = p.hangar || { items: {}, ships: [] };
  const t = S.data.ships[p.ship.type];
  let html = '';
  switch (S.stTab) {
    case 'hangar': {
      html = `<div class="cols"><div><h3>Активный корабль: ${esc(t.name)} <span class="muted">(${esc(t.cls)})</span></h3>${artImg(p.ship.type, 'ship-art big')}${shipStatsHTML(t, p.shipStats)}
        <h3>Трюм</h3>${cargoHTML(false)}<div style="margin-top:6px"><button data-a="unloadAll">Разгрузить всё в ангар</button></div>
        ${droneBayHTML()}</div>
        <div><h3>Ангар станции</h3>${itemsTable(h.items, (id, q) => `${S.data.drones[id] ? `<button data-a="loadDrone" data-item="${id}">В отсек дронов</button> ` : ''}<button data-a="load" data-item="${id}">В трюм</button>`)}
        <h3>Корабли в ангаре</h3>${h.ships.length ? h.ships.map(s => `<div class="slot-row">${artImg(s.type, 'ship-thumb')}<span class="sm">${esc(S.data.ships[s.type].name)} <span class="muted">${esc(S.data.ships[s.type].cls)}</span></span><button data-a="board" data-uid="${s.uid}">Пересесть</button></div>`).join('') : '<div class="muted">Нет других кораблей</div>'}
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
      html = `<div class="cols"><div><h3>${esc(t.name)} — слоты</h3>${slots}${droneBayHTML()}<h3>Характеристики</h3>${shipStatsHTML(t, p.shipStats)}</div>
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
        <h3>Дроны</h3><table class="tbl"><tr><th>Дрон</th><th>Параметры</th><th class="r">Цена</th><th></th></tr>
        ${Object.entries(mk.drones || {}).map(([id, pr]) => `<tr><td>${esc(S.data.drones[id].name)}</td><td class="muted">${droneDesc(S.data.drones[id])}</td><td class="r isk">${num(pr)}</td><td class="r"><button data-a="buy" data-item="${id}">Купить</button></td></tr>`).join('')}</table>
        <h3>Корабли</h3><div class="grid-cards">${Object.entries(mk.ships).map(([id, pr]) => { const st = S.data.ships[id]; const req = Object.entries(st.req || {}).map(([sk, lv]) => `<span class="${(S.prof.skills[sk] || 0) >= lv ? 'req-ok' : 'req-no'}">${esc(S.data.skills[sk].name)} ${lv}</span>`).join(', ');
          return `<div class="shipcard">${artImg(id)}<div class="sname">${esc(st.name)}</div><div class="muted">${esc(st.cls)}</div><div>${esc(st.desc)}</div>${shipStatsHTML(st)}${req ? `<div class="muted">Навыки для управления: ${req}</div>` : ''}<div class="isk">${isk(pr)}</div><div class="btn2"><button class="primary" data-a="buyShip" data-item="${id}">Купить</button><button data-a="buyBoard" data-item="${id}">Купить и пересесть</button></div></div>`; }).join('')}</div>`;
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
    case 'ships': html = shipsTabHTML(); break;
  }
  setHTML(el, html);
  if (S.stTab === 'skills') updateSkillProgress();
}

// Вкладка «Корабли»: смена активного корабля
function shipsTabHTML() {
  const p = S.prof, h = p.hangar || { ships: [] };
  const t = S.data.ships[p.ship.type];
  const reqHTML = (st) => Object.entries(st.req || {}).map(([sk, lv]) => `<span class="${(p.skills[sk] || 0) >= lv ? 'req-ok' : 'req-no'}">${esc(S.data.skills[sk].name)} ${lv}</span>`).join(', ');
  const card = (type, btn) => {
    const st = S.data.ships[type], req = reqHTML(st);
    return `<div class="shipcard">${artImg(type)}<div class="sname">${esc(st.name)} <span class="muted">${esc(st.cls)}</span></div><div class="muted">${esc(st.desc)}</div>
      <div class="kv"><span>Скорость</span><span>${num(st.maxSpeed)} м/с</span><span>Щит / броня / корпус</span><span>${num(st.shield)} / ${num(st.armor)} / ${num(st.hull)}</span><span>Трюм</span><span>${num(st.cargo)} м³</span><span>Слоты</span><span>${st.slots.high}/${st.slots.mid}/${st.slots.low}</span></div>
      ${req ? `<div class="muted">Навыки: ${req}</div>` : ''}${btn}</div>`;
  };
  let html = `<h3>Сейчас вы летите на</h3><div class="ship-current">${card(p.ship.type, '<div class="sk-max">Активный корабль</div>')}</div>`;
  html += '<h3>Корабли на этой станции</h3>';
  html += h.ships.length ? `<div class="grid-cards">${h.ships.map(sh => card(sh.type, `<button class="primary" data-a="board" data-uid="${sh.uid}">Пересесть</button>`)).join('')}</div>`
    : '<div class="muted">Других кораблей здесь нет. Купите новый на рынке или в списке ниже — он сразу станет вашим.</div>';
  const elsewhere = (p.assets || []).filter(a => a.station !== S.docked.id && a.ships.length);
  if (elsewhere.length) html += `<h3>Корабли на других станциях</h3>${elsewhere.map(a => `<div class="slot-row">${a.ships.map(tp => artImg(tp, 'ship-thumb')).join('')}<span class="sm">${a.ships.map(tp => esc(S.data.ships[tp].name)).join(', ')}<br><span class="muted">${esc(a.name)}</span></span><button data-a="route" data-sys="${S.stationById[a.station].sys}">Маршрут</button></div>`).join('')}`;
  html += '<h3>Купить и сразу пересесть</h3><div class="grid-cards">' + Object.entries(S.data.ships).filter(([, st]) => st.price > 0 && st !== t)
    .map(([id, st]) => card(id, `<div class="isk">${isk(st.price)}</div><button data-a="buyBoard" data-item="${id}" ${p.credits < st.price ? 'disabled' : ''}>Купить и пересесть</button>`)).join('') + '</div>';
  return html;
}

// Единый обработчик кнопок с data-a
function onActionClick(e) {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const d = b.dataset;
  switch (d.a) {
    case 'jettison': send({ t: 'jettison', item: d.item }); break;
    case 'unload': send({ t: 'unload', item: d.item }); break;
    case 'unloadAll': send({ t: 'unload' }); break;
    case 'loadDrone': send({ t: 'loadDrone', item: d.item }); break;
    case 'unloadDrone': send({ t: 'unloadDrone', item: d.item }); break;
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
    case 'bmBuy': send({ t: 'blackBuy', id: S.black.id, item: d.item, qty: +$('#bq-bm-' + d.item).value }); break;
    case 'bmSell': send({ t: 'blackSell', id: S.black.id, item: d.item }); break;
    case 'buyBoard': send({ t: 'buy', item: d.item, board: true }); break;
    case 'buyOrder': send({ t: 'buyOrder', id: d.id, qty: +$('#bq-' + d.id).value }); break;
    case 'cancelOrder': send({ t: 'cancelOrder', id: d.id }); break;
    case 'placeOrder': send({ t: 'placeOrder', item: $('#po-item').value, qty: +$('#po-qty').value, price: +$('#po-price').value }); break;
    case 'train': send({ t: 'train', skill: d.skill }); break;
    case 'accept': send({ t: 'acceptMission', id: d.id }); break;
    case 'abandon': send({ t: 'abandonMission', id: d.id }); break;
    case 'tutorial': tut.hidden = false; tut.done = {}; saveTut(); renderTutorial(); break;
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
      map.z = Math.min((MOBILE ? innerWidth - 30 : innerWidth - 420) / (Math.max(...xs) - Math.min(...xs) + 120), (MOBILE ? innerHeight * 0.62 : innerHeight - 120) / (Math.max(...ys) - Math.min(...ys) + 120));
      map.init = true;
    }
    map.sel = map.sel || (S.sys && S.sys.id); drawMap(); renderMapInfo();
  }
}
$('#map-close').onclick = toggleMap;
const mc = $('#map-canvas');
mc.addEventListener('pointerdown', (e) => { mc.setPointerCapture(e.pointerId); map.drag = { x: e.clientX, y: e.clientY, moved: 0 }; });
mc.addEventListener('pointermove', (e) => {
  if (!map.drag) return;
  const dx = e.clientX - map.drag.x, dy = e.clientY - map.drag.y;
  map.drag.moved += Math.abs(dx) + Math.abs(dy);
  map.x -= dx / map.z; map.y -= dy / map.z;
  map.drag.x = e.clientX; map.drag.y = e.clientY;
  drawMap();
});
mc.addEventListener('pointerup', (e) => {
  if (map.drag && map.drag.moved < 8) {
    const hit = S.data.systems.find(s => Math.hypot(...mapPt(s).map((v, i) => v - [e.clientX, e.clientY][i])) < (MOBILE ? 26 : 14));
    if (hit) { map.sel = hit.id; renderMapInfo(); drawMap(); }
  }
  map.drag = null;
});
mc.addEventListener('wheel', (e) => { map.z = Math.max(0.5, Math.min(6, map.z * Math.pow(0.999, e.deltaY))); drawMap(); }, { passive: true });
function mapPt(s) { return [(s.x - map.x) * map.z + (MOBILE ? innerWidth : innerWidth - 340) / 2, (s.y - map.y) * map.z + (MOBILE ? innerHeight * 0.38 : innerHeight / 2)]; }
$('#map-zoom').onclick = (e) => { const d = e.target.dataset.z; if (!d) return; map.z = Math.max(0.5, Math.min(6, map.z * (d === '+' ? 1.3 : 1 / 1.3))); drawMap(); };

function drawMap() {
  const dpr = devicePixelRatio || 1;
  mc.width = innerWidth * dpr; mc.height = innerHeight * dpr;
  const g = mc.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, innerWidth, innerHeight);
  // подложки регионов: мягкие пятна цвета региона и подпись в центре
  const byReg = {};
  for (const s of S.data.systems) (byReg[s.region] = byReg[s.region] || []).push(s);
  for (const [rid, list] of Object.entries(byReg)) {
    const reg = S.data.regions[rid]; if (!reg) continue;
    for (const s of list) {
      const [x, y] = mapPt(s), rad = 95 * map.z;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, reg.color + '26'); grd.addColorStop(1, reg.color + '00');
      g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.font = `600 ${Math.max(11, 14 * Math.min(1.4, map.z))}px Segoe UI, sans-serif`; g.textAlign = 'center';
    g.fillStyle = reg.color + 'bb';
    for (const [x, y] of reg.labels || []) { const [lx, ly] = mapPt({ x, y }); g.fillText(reg.name.toUpperCase() + `  ×${reg.income.toFixed(1)}`, lx, ly); }
  }
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
  const reg = S.data.regions[s.region] || {}, star = S.data.starTypes[S.data.stars[s.id]] || {};
  $('#map-info').innerHTML = `<h3 style="color:${secColor(s.sec)}">${esc(s.name)} <span>${s.sec.toFixed(1)}</span></h3>
    <div class="kv"><span>Регион</span><span style="color:${reg.color}">${esc(reg.name || '')}</span>
    <span>Доход</span><span class="isk">×${(reg.income || 1).toFixed(1)} к добыче, наградам и заданиям</span>
    <span>Звезда</span><span>${esc(star.name || '')}</span>
    <span>Безопасность</span><span>${s.sec >= 0.5 ? 'высокая — стражи порядка' : s.sec > 0 ? 'низкая — PvP без защиты' : 'нулевая — закона нет'}</span>
    <span>Станции</span><span>${stations.length || 'нет'}</span><span>Пираты</span><span>${s.sec >= 0.8 ? 'нет' : s.sec >= 0.5 ? 'слабые' : s.sec > 0 ? 'средние' : 'сильные'}</span>
    <span>Руда</span><span>${s.sec >= 0.7 ? 'Ферит, Корундит' : s.sec >= 0.45 ? '+ Аркселит' : s.sec > 0 ? 'Корундит, Аркселит, Нуллий' : s.sec <= -0.8 ? 'Нуллий, Ксенон-кристалл' : 'Аркселит, Нуллий'}</span></div>
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
// Автоподстройка качества: если кадров мало, снижаем графику (только пока игрок сам не выбрал качество)
const fps = { t0: 0, n: 0 };
function autoQuality(now, dt) {
  if (CFG.autoQ === false || !S.me || S.docked || document.hidden) { fps.t0 = 0; return; }
  if (!fps.t0) { fps.t0 = now; fps.n = 0; return; }
  fps.n++;
  if (now - fps.t0 < 5000) return;
  const f = fps.n * 1000 / (now - fps.t0);
  fps.t0 = 0;
  const next = f < 40 && CFG.quality === 'high' ? 'medium' : f < 26 && CFG.quality === 'medium' ? 'low' : null;
  if (next) { CFG.quality = next; saveCfg(); applyCfg(); note(`Графика упрощена для плавности (${Math.round(f)} кадров/с). Изменить можно в настройках ⚙`, 'info'); }
}
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!S.data) return;
  if (S.me && !S.docked) {
    const rt = now + (S.timeOff || 0) - RENDER_DELAY;
    sample(S.meRec, rt);
    for (const e of S.ents.values()) sample(e, rt);
  }
  R.frame(viewState(), dt, now / 1000);
  autoQuality(now, dt);
  updateBrackets();
  if (S.me && !S.docked) updateDamageNumbers(now);
  if (now - lastUi > 200) {
    lastUi = now;
    if (!S.docked && S.me) { renderOverview(); renderSelected(); renderTargets(); renderHud(now); renderDrones(); }
    if (S.win === 'skills' || (S.docked && S.stTab === 'skills')) updateSkillProgress();
    if (S.win === 'black' && S.black) { const t = document.querySelector('.bm-timer'); if (t) t.textContent = fmtTime(Math.max(0, (S.black.expires - S.serverNow()) / 1000)); }
    if (now - (S.lastTut || 0) > 500) { S.lastTut = now; checkTutorial(); }

  }
}
requestAnimationFrame(loop);
