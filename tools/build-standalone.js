// Собирает одиночную версию игры в один HTML-файл: серверная симуляция работает прямо в браузере.
// Запуск: node tools/build-standalone.js  →  dist/void-frontier.html
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const THREE_VER = require(path.join(ROOT, 'node_modules/three/package.json')).version;

// --- серверные модули в мини-загрузчике CommonJS ---
// генератор планет общий для сервера и клиента — лежит в public/js
const modPath = (name) => name === 'planetgen' ? 'public/js/planetgen.js' : `server/${name}.js`;
const serverMods = ['catalog', 'data', 'universe', 'planetgen', 'features', 'ai', 'story', 'contracts', 'infra', 'combat', 'drones', 'pirates', 'pbases', 'surface', 'bot', 'autoplay', 'relics', 'industry', 'war', 'wingmen', 'worldevents', 'career', 'npctalk', 'sleep', 'cmissions', 'dailies', 'outposts', 'wormholes', 'shipyard', 'marks', 'gas', 'probes', 'activities', 'passengers', 'corp', 'tech', 'raid', 'world', 'newships', 'refine', 'shipstory', 'insure', 'trade', 'mega', 'fleetx', 'season', 'heat', 'traits', 'paths', 'nemesis', 'board', 'game'].map(name =>
  `'./${name}': function (module, exports, require) {\nconst Date = __VDate;\n${read(modPath(name))}\n}`).join(',\n');

const serverBundle = `
// Игровые часы сервера: на паузе (Esc) время симуляции замирает — таймеры модулей, навыков и событий не идут
const __RealDate = Date;
let __pausedTotal = 0, __pauseStart = 0;
class __VDate extends __RealDate { static now() { const r = __RealDate.now(); return r - __pausedTotal - (__pauseStart ? r - __pauseStart : 0); } }
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
  const key = './' + name.split('/').pop().replace(/\\.js$/, ''); // '../public/js/planetgen' → './planetgen'
  if (__cache[key]) return __cache[key].exports;
  const module = { exports: {} };
  __cache[key] = module;
  __mods[key](module, module.exports, __require);
  return module.exports;
}
const { Game: __Game } = __require('./game');
window.PlanetGen = __require('./planetgen'); // тот же генератор планет — для клиента

// Локальное «соединение» с сервером, работающим в этой же вкладке
// Сохранения: основной слот + резервная копия, 3 циклических автосохранения, 5 ручных слотов.
// Повреждённое сохранение не перезаписывает исправное: при ошибке чтения берётся резервная копия.
const DB_KEY = 'void-frontier-db', BAK_KEY = DB_KEY + '.bak', SLOT = (i) => 'vf-slot-' + i, AUTO = (i) => 'vf-auto-' + i;
const __ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { localStorage.setItem(k, v); }, del(k) { try { localStorage.removeItem(k); } catch {} } };
let __db = { players: {}, orders: [] }, __noSave = false;
// чтение сохранения без опасных ключей (__proto__, constructor, prototype): чужой или подправленный файл не испортит объекты игры
const __BADK = new Set(['__proto__', 'constructor', 'prototype']);
const __safeParse = (raw) => { const d = JSON.parse(raw, (k, v) => __BADK.has(k) ? undefined : v); if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('не сохранение'); if (d.players && (typeof d.players !== 'object' || Array.isArray(d.players))) throw new Error('не сохранение'); return d; };
window.VF_SAVE_STATUS = { ok: true, msg: '' };
(function load() {
  const raw = __ls.get(DB_KEY);
  if (!raw) return;
  try { __db = Object.assign(__db, __safeParse(raw)); }
  catch {
    try { __ls.set(DB_KEY + '.corrupt', raw); } catch {}
    try { __db = Object.assign(__db, __safeParse(__ls.get(BAK_KEY))); window.VF_SAVE_STATUS = { ok: true, msg: 'Основное сохранение было повреждено — загружена резервная копия.' }; }
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
function __meta(raw) { try { const d = __safeParse(raw); const ps = Object.values(d.players || {}); return { when: d.savedAt || 0, pilots: ps.map(p => p.name), credits: ps.reduce((a, p) => a + (p.credits || 0), 0) }; } catch { return null; } }
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
    if (!m || !m.pilots.length || m.pilots.some(n => typeof n !== 'string')) return { ok: false, msg: 'Файл не похож на сохранение ARKTUR' };
    try { text = JSON.stringify(__safeParse(text)); } catch (e) { return { ok: false, msg: 'Файл повреждён' }; } // записываем уже очищенную копию
    __noSave = true;
    try { const prev = __ls.get(DB_KEY); if (prev) __ls.set(BAK_KEY, prev); __write(DB_KEY, text); } catch (err) { __noSave = false; return { ok: false, msg: err.message }; }
    location.reload();
    return { ok: true };
  },
  // текущее состояние для сверки с облачной копией: время сохранения и пилоты
  // только пилоты-люди: ИИ-ученики появляются в каждой новой игре и не считаются прогрессом
  // (иначе новое устройство «с ботами» не предложило бы восстановить облачную копию и затёрло бы её)
  current() { const humans = Object.values(__db.players || {}).filter(p => !p.bot); return { when: humans.length ? (__lastSave || __db.savedAt || 0) : 0, pilots: humans.map(p => p.name) }; },
  status() { return window.VF_SAVE_STATUS; },
  flush() { __snapshotLive(); return __save(true); }
};
// корабли пилотов в космосе: прочность и место — в сохранение (иначе после выгрузки страницы пилот оказался бы на старой станции)
function __snapshotLive() {
  try {
    for (const s of GAME.sessions) {
      if (!s.player || s.isBot || !s.ent) continue;
      GAME.storeShipState(s.player, s.ent);
      if (!s.ent.warp && Array.isArray(s.ent.pos) && s.ent.pos.every(Number.isFinite)) s.player.loc = { sys: s.ent.sys, pos: s.ent.pos.slice() };
    }
  } catch (e) {}
}
const GAME = new __Game(__db, __save);
// сохранение не только по событиям: каждые 20 с, при сворачивании и закрытии страницы
// (iPhone выгружает вкладку без предупреждения — терялись добыча, награды и место корабля)
setInterval(() => { if (!__noSave) { __snapshotLive(); __save(true); } }, 20000);
document.addEventListener('visibilitychange', () => { if (document.hidden && !__noSave) { __snapshotLive(); __save(true); } });
addEventListener('pagehide', () => { if (!__noSave) { __snapshotLive(); __save(true); } });
// отладочный доступ к симуляции — только в автотестах или с флагом разработчика; встроенному тесту производительности — скрытая ссылка
try { if (navigator.webdriver === true || localStorage.getItem('vf-dev') === '1') window.__VF_GAME = GAME; } catch (e) {}
Object.defineProperty(window, '__vfLocal', { value: () => GAME, enumerable: false });
// симуляция — фиксированный шаг 0,1 с с накопителем: таймеры браузера «плавают», а физика не должна
let __last = Date.now(), __acc = 0;
setInterval(() => {
  const n = Date.now();
  if (window.VF_PAUSED) { if (!__pauseStart) __pauseStart = n; __last = n; return; }
  if (__pauseStart) { __pausedTotal += n - __pauseStart; __pauseStart = 0; }
  __acc = Math.min(__acc + (n - __last) / 1000, 0.5); __last = n;
  for (let i = 0; i < 5 && __acc >= 0.0995; i++) { GAME.tick(0.1); __acc -= 0.1; }
  if (__acc < 0) __acc = 0;
}, 50);
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
// мир поверхности планет — так же, модуль SF (использует R и window.PlanetGen)
let surf = read('public/js/surface.js');
const surfImports = [...surf.matchAll(/^import .*;$/gm)].map(m => m[0]).filter(l => !l.includes("* as THREE") && !l.includes('./render.js'));
surf = surf.replace(/^import .*;\n/gm, '');
const surfExports = [...surf.matchAll(/^export (?:function|const) (\w+)/gm)].map(m => m[1]);
surf = surf.replace(/^export /gm, '');
const surfBundle = `const SF = (() => {\n${surf}\nreturn { ${surfExports.join(', ')} };\n})();`;

// --- клиент ---
let main = read('public/js/main.js');
main = main.replace(/^import \* as R from '\.\/render\.js';\n/m, '').replace(/^import \* as SF from '\.\/surface\.js';\n/m, '');
main = main.replace("$('#lg-pass').onkeydown", "$('#lg-name').onkeydown = (e) => { if (e.key === 'Enter') $('#lg-go').click(); };\n$('#lg-pass').onkeydown");

// --- разметка ---
const html = read('public/index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"')).replace('<script src="js/planetgen.js"></script>', '');
let css = read('public/style.css');
css = css.replace(':root {', ':root {\n  color-scheme: dark;');
// концепт-арты кораблей встраиваем прямо в страницу
const artDir = path.join(ROOT, 'public/img/ships');
// картинки встраиваются в WebP (втрое легче, iOS 14+); без Python и Pillow — исходные JPEG
const embed = (dir, w, q) => {
  if (!fs.existsSync(dir)) return {};
  try { return JSON.parse(require('child_process').execFileSync('python3', [path.join(ROOT, 'tools/webp.py'), dir, String(w), String(q)], { maxBuffer: 64 << 20 }).toString()); }
  catch (e) {
    console.warn('WebP недоступен, встраиваю JPEG:', e.message.split('\n')[0]);
    const out = {};
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.jpg')) out[f.replace('.jpg', '')] = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(dir, f)).toString('base64');
    return out;
  }
};
const art = embed(artDir, 960, 70);
// единая серия фото кораблей (tools/make-photos.js)
const photoDir = path.join(ROOT, 'public/img/photos');
const photos = embed(photoDir, 800, 72);
// фототекстуры CC0 (ambientCG): фактура металла и камень астероидов
const photoTex = embed(path.join(ROOT, 'public/img/tex'), 512, 86);
// модели кораблей из Blender (tools/blender/ships.py → tools/compress-ships.mjs): base64, расжимаются в браузере
const shipDir = path.join(ROOT, 'public/models/ships');
const shipGlb = fs.existsSync(shipDir) ? Object.fromEntries(fs.readdirSync(shipDir).filter(f => f.endsWith('.glb')).sort().map(f => [f.slice(0, -4), require('zlib').gzipSync(fs.readFileSync(path.join(shipDir, f)), { level: 9 }).toString('base64')])) : {};
const i18n = read('public/js/i18n-en.js') + '\n' + read('public/js/i18n.js');
if (i18n.includes('</script')) throw new Error('в словаре перевода встретилось </script');
const page = `<title>ARKTUR: Космический рубеж</title>
<script>${i18n}</script>
<script>window.VF_ART = ${JSON.stringify(art)}; window.VF_PHOTO = ${JSON.stringify(photos)}; window.VF_TEX = ${JSON.stringify(photoTex)}; window.VF_SHIP_GLB = ${JSON.stringify(shipGlb)};</script>
<style>
${css}
.offline-tag { display: block; margin-top: 4px; color: var(--accent2); font-size: 11px; text-align: center; }
</style>
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@${THREE_VER}/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@${THREE_VER}/examples/jsm/" } }</script>
${body.replace('<p class="hint">Новый пилот создаётся автоматически при первом входе.</p>',
  '<p class="hint">Новый пилот создаётся автоматически при первом входе.<span class="offline-tag">Одиночный режим: вселенная работает в вашем браузере, прогресс сохраняется на этом устройстве каждые 20 секунд и копируется в облако claude.ai.</span></p>')}
<script type="module">
import * as THREE from 'three';
${[...new Set([...renderImports, ...surfImports])].join('\n')}
${serverBundle}
${renderBundle}
${surfBundle}
${main}
</script>
`;
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/void-frontier.html'), page);
console.log('dist/void-frontier.html', (page.length / 1024).toFixed(0) + ' KB');
