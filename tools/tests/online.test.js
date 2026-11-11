// Запуск: node tools/tests/online.test.js — поднимает настоящий сетевой сервер (server/index.js) на время теста
// и проверяет общий мир: два пилота входят, видят чат друг друга; страница и музыка отдаются сервером.
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const WebSocket = require(path.join(__dirname, '../../node_modules/ws'));
const PORT = 8844, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arktur-online-'));
const srv = spawn(process.execPath, [path.join(__dirname, '../../server/index.js')], { env: { ...process.env, PORT: String(PORT), DB_FILE: path.join(dir, 'db.json') }, stdio: 'ignore' });
const R = []; const ok = (c, m) => { R.push(c); console.log((c ? '✓ ' : '✗ ') + m); };
const get = (u) => new Promise(r => http.get(`http://127.0.0.1:${PORT}${u}`, res => { let n = 0; res.on('data', d => n += d.length); res.on('end', () => r({ code: res.statusCode, n, type: res.headers['content-type'] })); }).on('error', () => r({ code: 0 })));
const mk = (name) => new Promise((res) => { const ws = new WebSocket(`ws://127.0.0.1:${PORT}`); const box = { ws, msgs: [] }; ws.on('message', d => box.msgs.push(JSON.parse(d))); ws.on('open', () => { ws.send(JSON.stringify({ t: 'login', name, pass: 'secret123' })); setTimeout(() => res(box), 2500); }); ws.on('error', () => res(box)); });
setTimeout(async () => {
  try {
    const page = await get('/'), track = await get('/audio/music/explore.mp3');
    ok(page.code === 200 && /text\/html/.test(page.type), 'сервер отдаёт игру по HTTP');
    ok(track.code === 200 && /audio\/mpeg/.test(track.type) && track.n > 1e6, 'сервер отдаёт музыку (' + track.type + ', ' + track.n + ' байт)');
    const a = await mk('Альфа'), b = await mk('Бета');
    ok(a.msgs.some(m => m.t === 'welcome') && b.msgs.some(m => m.t === 'welcome'), 'оба пилота вошли в общий мир');
    a.ws.send(JSON.stringify({ t: 'chat', ch: 'local', text: 'Привет из Альфы!' }));
    await new Promise(r => setTimeout(r, 1500));
    ok(b.msgs.some(m => m.t === 'chat' && /Привет из Альфы/.test(m.text || '')), 'Бета видит сообщение Альфы в локальном чате');
    a.ws.close(); b.ws.close();
  } finally { srv.kill(); const bad = R.filter(x => !x).length; console.log(`ИТОГО: ${R.length - bad}/${R.length}`); process.exit(bad ? 1 : 0); }
}, 4000);
