// Собирает одиночную версию игры в один HTML-файл: серверная симуляция работает прямо в браузере.
// Запуск: node tools/build-standalone.js  →  dist/void-frontier.html
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const THREE_VER = require(path.join(ROOT, 'node_modules/three/package.json')).version;

// --- серверные модули в мини-загрузчике CommonJS ---
const serverMods = ['data', 'universe', 'features', 'ai', 'story', 'contracts', 'game'].map(name =>
  `'./${name}': function (module, exports, require) {\n${read(`server/${name}.js`)}\n}`).join(',\n');

const serverBundle = `
const __mods = {\n${serverMods}\n};
const __cache = {};
const __crypto = {
  randomBytes(n) {
    const a = crypto.getRandomValues(new Uint8Array(n));
    return { toString: () => Array.from(a, b => b.toString(16).padStart(2, '0')).join('') };
  },
  scryptSync(pass, salt) {
    let h1 = 0x811c9dc5, h2 = 0x1234567;
    const s = salt + ':' + pass;
    for (let k = 0; k < 2000; k++) for (let i = 0; i < s.length; i++) {
      h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619); h2 = Math.imul(h2 + s.charCodeAt(i) + k, 2654435761);
    }
    return { toString: () => (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) };
  }
};
function __require(name) {
  if (name === 'crypto') return __crypto;
  const key = name.replace(/\\.js$/, '');
  if (__cache[key]) return __cache[key].exports;
  const module = { exports: {} };
  __cache[key] = module;
  __mods[key](module, module.exports, __require);
  return module.exports;
}
const { Game: __Game } = __require('./game');

// Локальное «соединение» с сервером, работающим в этой же вкладке
// Сохранения: основной слот + резервная копия, 3 циклических автосохранения, 5 ручных слотов.
// Повреждённое сохранение не перезаписывает исправное: при ошибке чтения берётся резервная копия.
const DB_KEY = 'void-frontier-db', BAK_KEY = DB_KEY + '.bak', SLOT = (i) => 'vf-slot-' + i, AUTO = (i) => 'vf-auto-' + i;
const __ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { localStorage.setItem(k, v); }, del(k) { try { localStorage.removeItem(k); } catch {} } };
let __db = { players: {}, orders: [] }, __noSave = false;
window.VF_SAVE_STATUS = { ok: true, msg: '' };
(function load() {
  const raw = __ls.get(DB_KEY);
  if (!raw) return;
  try { __db = Object.assign(__db, JSON.parse(raw)); }
  catch {
    try { __ls.set(DB_KEY + '.corrupt', raw); } catch {}
    try { __db = Object.assign(__db, JSON.parse(__ls.get(BAK_KEY))); window.VF_SAVE_STATUS = { ok: true, msg: 'Основное сохранение было повреждено — загружена резервная копия.' }; }
    catch { window.VF_SAVE_STATUS = { ok: false, msg: 'Сохранение повреждено, резервной копии нет. Повреждённые данные отложены, начата новая игра.' }; }
  }
})();
let __lastSave = 0, __lastAuto = Date.now(), __autoIdx = 0;
function __write(key, data) {
  __ls.set(key, data);
  if (__ls.get(key) !== data) throw new Error('проверка записи не прошла');
}
function __save(force) {
  if (__noSave) return false;
  if (!force && Date.now() - __lastSave < 5000) return false;
  __lastSave = Date.now();
  const data = JSON.stringify({ ...__db, savedAt: Date.now() });
  try {
    const prev = __ls.get(DB_KEY);
    if (prev) __ls.set(BAK_KEY, prev);
    __write(DB_KEY, data);
    if (Date.now() - __lastAuto > 5 * 60000) { __lastAuto = Date.now(); __write(AUTO(__autoIdx), data); __autoIdx = (__autoIdx + 1) % 3; }
    window.VF_SAVE_STATUS = { ok: true, msg: '' };
    return true;
  } catch (err) {
    // нет места или запись не удалась: честно сообщаем, исправные данные не трогаем
    window.VF_SAVE_STATUS = { ok: false, msg: 'Не удалось сохранить игру: ' + (err && err.name === 'QuotaExceededError' ? 'нет места в хранилище браузера' : (err && err.message || 'ошибка записи')) + '. Освободите место или экспортируйте сохранение в файл.' };
    return false;
  }
}
function __meta(raw) { try { const d = JSON.parse(raw); const ps = Object.values(d.players || {}); return { when: d.savedAt || 0, pilots: ps.map(p => p.name), credits: ps.reduce((a, p) => a + (p.credits || 0), 0) }; } catch { return null; } }
window.VF_SAVES = {
  list() {
    const out = [];
    for (let i = 1; i <= 5; i++) { const r = __ls.get(SLOT(i)); out.push({ id: 'slot' + i, kind: 'manual', n: i, meta: r ? __meta(r) : null }); }
    for (let i = 0; i < 3; i++) { const r = __ls.get(AUTO(i)); if (r) out.push({ id: 'auto' + i, kind: 'auto', n: i + 1, meta: __meta(r) }); }
    return out;
  },
  key(id) { return id.startsWith('slot') ? SLOT(+id.slice(4)) : AUTO(+id.slice(4)); },
  save(id) {
    for (const s of GAME.sessions) if (s.ent) GAME.storeShipState(s.player, s.ent);
    try { __write(this.key(id), JSON.stringify({ ...__db, savedAt: Date.now() })); return { ok: true }; }
    catch (err) { return { ok: false, msg: err && err.name === 'QuotaExceededError' ? 'нет места в хранилище браузера' : String(err && err.message) }; }
  },
  load(id) {
    const raw = __ls.get(this.key(id));
    if (!raw || !__meta(raw)) return { ok: false, msg: 'Слот пуст или повреждён' };
    __noSave = true;
    try { const prev = __ls.get(DB_KEY); if (prev) __ls.set(BAK_KEY, prev); __write(DB_KEY, raw); } catch (err) { __noSave = false; return { ok: false, msg: 'Не удалось записать: ' + err.message }; }
    location.reload();
    return { ok: true };
  },
  del(id) { __ls.del(this.key(id)); },
  exportText() { return JSON.stringify({ ...__db, savedAt: Date.now() }); },
  importText(text) {
    const m = __meta(text);
    if (!m || !m.pilots.length) return { ok: false, msg: 'Файл не похож на сохранение Void Frontier' };
    __noSave = true;
    try { const prev = __ls.get(DB_KEY); if (prev) __ls.set(BAK_KEY, prev); __write(DB_KEY, text); } catch (err) { __noSave = false; return { ok: false, msg: err.message }; }
    location.reload();
    return { ok: true };
  },
  status() { return window.VF_SAVE_STATUS; },
  flush() { return __save(true); }
};
const GAME = new __Game(__db, __save);
let __last = Date.now();
setInterval(() => { const n = Date.now(); GAME.tick(Math.min(0.5, (n - __last) / 1000)); __last = n; }, 100);
setInterval(() => __save(true), 15000);

class LocalSocket {
  constructor() {
    this.readyState = 0;
    this.sess = { ws: this, player: null, ent: null, docked: null,
      send: (m) => { const d = JSON.stringify(m); queueMicrotask(() => this.onmessage && this.onmessage({ data: d })); } };
    LocalSocket.current = this;
    setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 0);
  }
  send(str) { const m = JSON.parse(str); queueMicrotask(() => GAME.handle(this.sess, m)); }
  close() { if (this.readyState === 3) return; this.readyState = 3; GAME.logout(this.sess); setTimeout(() => this.onclose && this.onclose(), 0); }
}
addEventListener('pagehide', () => { if (LocalSocket.current && LocalSocket.current.readyState === 1) GAME.logout(LocalSocket.current.sess); __save(true); });
const WebSocket = LocalSocket;
`;

// --- рендер как замкнутый модуль ---
let render = read('public/js/render.js');
const renderImports = [...render.matchAll(/^import .*;$/gm)].map(m => m[0]).filter(l => !l.includes("* as THREE"));
render = render.replace(/^import .*;\n/gm, '');
const exportsList = [...render.matchAll(/^export (?:function|const) (\w+)/gm)].map(m => m[1]);
render = render.replace(/^export /gm, '');
const renderBundle = `const R = (() => {\n${render}\nreturn { ${exportsList.join(', ')} };\n})();`;

// --- клиент ---
let main = read('public/js/main.js');
main = main.replace(/^import \* as R from '\.\/render\.js';\n/m, '');
main = main.replace("$('#lg-pass').onkeydown", "$('#lg-name').onkeydown = (e) => { if (e.key === 'Enter') $('#lg-go').click(); };\n$('#lg-pass').onkeydown");

// --- разметка ---
const html = read('public/index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
let css = read('public/style.css');
css = css.replace(':root {', ':root {\n  color-scheme: dark;');
// концепт-арты кораблей встраиваем прямо в страницу
const artDir = path.join(ROOT, 'public/img/ships');
const art = {};
for (const f of fs.existsSync(artDir) ? fs.readdirSync(artDir) : []) if (f.endsWith('.jpg')) art[f.replace('.jpg', '')] = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(artDir, f)).toString('base64');
const page = `<title>Void Frontier</title>
<script>window.VF_ART = ${JSON.stringify(art)};</script>
<style>
${css}
.offline-tag { display: block; margin-top: 4px; color: var(--accent2); font-size: 11px; text-align: center; }
</style>
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@${THREE_VER}/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@${THREE_VER}/examples/jsm/" } }</script>
${body.replace('<p class="hint">Новый пилот создаётся автоматически при первом входе.</p>',
  '<p class="hint">Новый пилот создаётся автоматически при первом входе.<span class="offline-tag">Одиночный режим: вселенная работает в вашем браузере, прогресс сохраняется на этом устройстве.</span></p>')}
<script type="module">
import * as THREE from 'three';
${renderImports.join('\n')}
${serverBundle}
${renderBundle}
${main}
</script>
`;
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/void-frontier.html'), page);
console.log('dist/void-frontier.html', (page.length / 1024).toFixed(0) + ' KB');
