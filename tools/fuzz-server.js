// Нагрузочная проверка сервера: 8 пилотов на автоигре, с напарниками, заданиями, сюжетом и метками.
// Проверяет каждое сообщение клиенту (координаты кораблей, аномалий, тел) и ловит исключения сервера.
// Запуск: node tools/fuzz-server.js [минут игрового времени, по умолчанию 60]
const { Game } = require(require('path').join(__dirname, '../server/game.js'));
const { SHIPS } = require(require('path').join(__dirname, '../server/data.js'));
const db = { players: {}, orders: [] }; const g = new Game(db, () => {});
let sim = Date.now(); Date.now = () => sim;
const bad = new Map(); const errs = new Map();
const isV = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
function flag(k, x) { if (!bad.has(k)) bad.set(k, JSON.stringify(x).slice(0, 300)); }
function check(m) {
  if (m.t === 'state') {
    if (!m.me || !isV(m.me.p)) flag('state.me.p', m.me);
    for (const e of m.ents || []) if (!isV(e.p)) flag('ent.p:' + e.k, e);
    for (const fx of m.fx || []) for (const k of ['a', 'b', 'p', 'from', 'to']) if (fx[k] && Array.isArray(fx[k]) && !isV(fx[k])) flag('fx.' + k + ':' + fx.k, fx);
  }
  if (m.t === 'anoms') for (const a of m.list || []) if (!isV(a.pos)) flag('anom.pos:' + (a.kind || a.akind), a);
  if (m.t === 'sys' || m.t === 'system') for (const c of (m.sys || m).celestials || []) if (!isV(c.pos)) flag('cel.pos:' + c.kind, c);
  if (m.t === 'ghosts') for (const x of m.list || []) if (x.p && !isV(x.p)) flag('ghost.p', x);
}
const sess = [];
const modes = ['auto', 'mine', 'hunt', 'trade', 'hunt', 'auto', 'mine', 'hunt'];
const ships = ['iskra', 'matka', 'molot', 'argus', 'senator', 'porog', 'sokol', 'citadel'];
for (let i = 0; i < 8; i++) {
  const s = { send(m) { try { check(m); } catch (e) { flag('check', e.message); } } };
  g.handle(s, { t: 'login', name: 'Фаззер' + i, pass: 'xxx' + i }); const p = s.player; p.credits = 5e9;
  try {
    const h = g.hangar(p, s.docked); h.ships.push({ type: ships[i], fit: new Array(SHIPS[ships[i]].slots ? 0 : 0), cargo: {} });
  } catch {}
  g.handle(s, { t: 'wingInfo' });
  const cands = g.wingCandidates(s.docked).slice(0, 2);
  for (const c of cands) g.handle(s, { t: 'wingHire', id: c.id });
  try { const offers = g.missionBoard(s.docked).offers.slice(0, 3); for (const o of offers) g.handle(s, { t: 'acceptMission', id: o.id }); } catch (e) { errs.set('missions ' + e.message, 1); }
  try { g.handle(s, { t: 'storyAccept' }); g.handle(s, { t: 'shipStoryStart', type: p.ship.type }); } catch (e) { errs.set('story ' + e.message, 1); }
  try { g.handle(s, { t: 'markAdd', pos: [1e10, 0, 2e10], name: 'М' + i }); } catch (e) { errs.set('mark ' + e.message, 1); }
  g.handle(s, { t: 'autoplay', on: true, mode: modes[i], bold: i % 2 === 0 });
  sess.push(s);
}
const origTick = g.tick.bind(g);
let ticks = 0;
const t0 = Date.now();
const MIN = +process.argv[2] || 60;
for (let m = 0; m < MIN; m++) {
  for (let i = 0; i < 600; i++) {
    sim += 100; ticks++;
    try { origTick(0.1); } catch (e) { const k = (e.stack || e.message).split('\n').slice(0, 3).join(' | '); errs.set(k, (errs.get(k) || 0) + 1); }
  }
  // иногда — ручные команды поверх автоигры
  for (const s of sess) if (Math.random() < 0.05 && s.ent) { try { g.handle(s, { t: 'wingOrder', order: ['follow', 'attack', 'defend'][m % 3] }); } catch (e) { errs.set('wingOrder ' + e.message, 1); } }
}
console.log('симуляция', MIN, 'мин, тиков', ticks, 'реально', Math.round((Date.now() - t0) / 1000), 'с');
console.log('систем у игроков:', sess.map(s => g.playerSys(s.player)).join(' '));
console.log('ПЛОХИЕ ДАННЫЕ:', bad.size ? '' : 'нет'); for (const [k, v] of bad) console.log(' ', k, v);
console.log('ИСКЛЮЧЕНИЯ СЕРВЕРА:', errs.size ? '' : 'нет'); for (const [k, v] of errs) console.log(' ', v, '×', k);
process.exit(0);
