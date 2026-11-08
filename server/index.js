// Точка входа: HTTP-сервер для клиента + WebSocket для игры + сохранение в JSON.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game } = require('./game');

const PORT = +process.env.PORT || 8080;
const ROOT = path.join(__dirname, '..');
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'db.json');
const TICK = 100; // мс, 10 тиков в секунду

// Загрузка: основной файл → резервная копия. Повреждённый файл не перезаписывается, а откладывается в сторону.
let db = { players: {}, orders: [] };
function tryLoad(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
if (fs.existsSync(DB_FILE)) {
  try { db = Object.assign(db, tryLoad(DB_FILE)); console.log(`База загружена: ${Object.keys(db.players).length} пилотов`); }
  catch (err) {
    const bad = DB_FILE + '.corrupt-' + Date.now();
    fs.copyFileSync(DB_FILE, bad);
    console.error(`Файл базы повреждён (${err.message}). Копия сохранена в ${bad}.`);
    try { db = Object.assign(db, tryLoad(DB_FILE + '.bak')); console.log(`Восстановлено из резервной копии: ${Object.keys(db.players).length} пилотов`); }
    catch { console.error('Резервной копии нет или она тоже повреждена — запуск с пустой базой. Повреждённый файл сохранён.'); }
  }
} else console.log('Создаётся новая база данных');

let dirty = false, lastSave = 0;
function save(force) {
  dirty = true;
  if (!force && Date.now() - lastSave < 5000) return;
  flush();
}
function flush() {
  if (!dirty) return;
  dirty = false; lastSave = Date.now();
  // атомарная запись: временный файл → проверка → прежний файл становится .bak → замена
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    const tmp = DB_FILE + '.tmp', data = JSON.stringify(db);
    fs.writeFileSync(tmp, data);
    if (fs.statSync(tmp).size !== Buffer.byteLength(data)) throw new Error('файл записан не полностью');
    if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, DB_FILE + '.bak');
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    dirty = true; // не считаем сохранение успешным — повторим позже
    console.error('ОШИБКА СОХРАНЕНИЯ:', err.code === 'ENOSPC' ? 'нет места на диске' : err.message, '— рабочий файл не тронут');
  }
}
setInterval(() => { dirty = true; flush(); }, 20000);

const game = new Game(db, save);
game.online = true; // сетевой сервер: строже правила для новых пилотов (пароль от 6 символов)

// ---------- Статика ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };
const STATIC = [
  ['/vendor/three/addons/', path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm')],
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three', 'build')],
  ['/', path.join(ROOT, 'public')]
];
// Заголовки безопасности: запрет встраивания чужими сайтами, запрет «угадывания» типов, строгая политика скриптов
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: blob:", "media-src 'self' data: blob:", "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"].join('; ');
const SEC_HEADERS = {
  'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
};
if (process.env.HTTPS === '1') SEC_HEADERS['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD', ...SEC_HEADERS }); return res.end(); }
  let url;
  try { url = decodeURIComponent(String(req.url || '/').split('?')[0]); } catch { res.writeHead(400, SEC_HEADERS); return res.end('Bad request'); }
  if (url.includes('\0') || url.length > 512) { res.writeHead(400, SEC_HEADERS); return res.end('Bad request'); }
  if (url === '/') url = '/index.html';
  for (const [prefix, dir] of STATIC) {
    if (!url.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, url.slice(prefix.length)));
    // файл строго внутри папки (а не «public-secret» рядом с «public»), без скрытых файлов
    if (!file.startsWith(dir + path.sep) || /[\\/]\./.test(file.slice(dir.length))) break;
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, SEC_HEADERS); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC_HEADERS });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }
  res.writeHead(404, SEC_HEADERS); res.end('Not found');
});
server.headersTimeout = 15000; server.requestTimeout = 30000;

// ---------- WebSocket ----------
// Источник подключения: только своя страница (или адреса из ALLOWED_ORIGINS через запятую) — чужой сайт не подключится от имени игрока
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
function originOk(req) {
  const o = req.headers.origin;
  if (!o) return true; // нативные клиенты (Android-обёртка, боты) без Origin
  if (ALLOWED.includes(o)) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}
const ipOf = (req) => (process.env.TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
const PER_IP = +process.env.MAX_CONN_PER_IP || 8, conns = new Map();
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024, perMessageDeflate: false,
  verifyClient: (info, done) => {
    if (!originOk(info.req)) return done(false, 403, 'Forbidden origin');
    if ((conns.get(ipOf(info.req)) || 0) >= PER_IP) return done(false, 429, 'Too many connections');
    done(true);
  } });
wss.on('connection', (ws, req) => {
  const ip = ipOf(req);
  conns.set(ip, (conns.get(ip) || 0) + 1);
  const sess = {
    ws, ip, player: null, ent: null, docked: null,
    send(msg) { if (ws.readyState === 1 && ws.bufferedAmount < 4e6) ws.send(JSON.stringify(msg)); } // медленный клиент не съедает память сервера
  };
  ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  let bad = 0;
  ws.on('message', (raw, isBinary) => {
    if (isBinary) { if (++bad > 20) ws.terminate(); return; }
    let msg;
    try { msg = JSON.parse(raw); } catch { if (++bad > 20) ws.terminate(); return; }
    try { if (msg && typeof msg.t === 'string') game.handle(sess, msg); } catch (err) { console.error('ошибка команды', err); }
  });
  ws.on('close', () => { const n = (conns.get(ip) || 1) - 1; if (n > 0) conns.set(ip, n); else conns.delete(ip); try { game.logout(sess); } catch (err) { console.error('ошибка выхода', err); } });
  ws.on('error', () => {});
});
// мёртвые соединения (телефон ушёл из сети) закрываются, а не висят
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch {} } }, 30000);
// непредвиденная ошибка не роняет сервер для всех игроков: пишем в журнал и сохраняемся
process.on('uncaughtException', (err) => { console.error('НЕПРЕДВИДЕННАЯ ОШИБКА:', err); try { dirty = true; flush(); } catch {} });
process.on('unhandledRejection', (err) => { console.error('НЕОБРАБОТАННЫЙ ОТКАЗ:', err); });

// фиксированный шаг симуляции с накопителем (догоняем не больше 5 шагов)
let last = Date.now(), acc = 0;
const STEP = TICK / 1000;
setInterval(() => {
  const now = Date.now();
  acc = Math.min(acc + (now - last) / 1000, 0.5); last = now;
  for (let i = 0; i < 5 && acc >= STEP - 0.0005; i++) { try { game.tick(STEP); } catch (err) { console.error('ошибка тика', err); } acc -= STEP; }
  if (acc < 0) acc = 0;
}, TICK / 2);

function shutdown() { console.log('\nСохранение…'); for (const s of game.sessions) game.logout(s); dirty = true; flush(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Arktur запущен: http://localhost:${PORT}`));
