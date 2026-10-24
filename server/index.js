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

let db = { players: {}, orders: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); console.log(`База загружена: ${Object.keys(db.players).length} пилотов`); }
catch { console.log('Создаётся новая база данных'); }

let dirty = false, lastSave = 0;
function save(force) {
  dirty = true;
  if (!force && Date.now() - lastSave < 5000) return;
  flush();
}
function flush() {
  if (!dirty) return;
  dirty = false; lastSave = Date.now();
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
setInterval(() => { dirty = true; flush(); }, 20000);

const game = new Game(db, save);

// ---------- Статика ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const STATIC = [
  ['/vendor/three/addons/', path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm')],
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three', 'build')],
  ['/', path.join(ROOT, 'public')]
];
const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  for (const [prefix, dir] of STATIC) {
    if (!url.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, url.slice(prefix.length)));
    if (!file.startsWith(dir)) break;
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }
  res.writeHead(404); res.end('Not found');
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
wss.on('connection', (ws) => {
  const sess = {
    ws, player: null, ent: null, docked: null,
    send(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  };
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg && typeof msg.t === 'string') game.handle(sess, msg);
  });
  ws.on('close', () => game.logout(sess));
  ws.on('error', () => {});
});

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.5, (now - last) / 1000);
  last = now;
  game.tick(dt);
}, TICK);

function shutdown() { console.log('\nСохранение…'); for (const s of game.sessions) game.logout(s); dirty = true; flush(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Void Frontier запущен: http://localhost:${PORT}`));
