// Червоточины: в Бездне и Глубоком космосе время от времени открывается проход в неизведанную систему.
// Каждая такая система новая: своё имя, звезда, планеты и пояса (раскладка строится тем же генератором, но со своим зерном),
// в ней лучшая руда, пиратская база, а в самых опасных — крепость Скверны и аномалии Предтеч (их расставляют обычные модули).
// Доход в ней ×5. Через 45 минут проход схлопывается: оставшихся пилотов выбрасывает обратно к месту червоточины.
'use strict';
const D = require('./data');
const { buildSystem, makeAsteroid, rng } = require('./universe');

const WH = {
  firstAfter: 3 * 60000,          // первая червоточина — через 3 минуты после старта
  every: [16 * 60000, 28 * 60000], // дальше — раз в 16–28 минут
  life: 45 * 60000,
  maxOpen: 2,
  warnAt: [5 * 60000, 60000],
  income: 5.0,
  stars: ['blackhole', 'blue', 'white', 'red', 'orange', 'yellow'],
  words: ['Карман', 'Сектор', 'Разрыв', 'Аномалия', 'Тень', 'Провал'],
  letters: 'ABCDEFGHJKLMNPQRSTVWXYZ'
};
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const AU = D.AU;

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick, baseLogin = P.login, baseJump = P.jump;

  P.whState = function () { return this.wh || (this.wh = { seq: 0, open: new Map(), next: this.now + WH.firstAfter }); };
  P.whView = function () {
    return { t: 'whState', list: [...this.whState().open.values()].map(w => ({ id: w.id, from: w.from, def: w.def, star: w.star, star2: w.star2, expires: w.expires })) };
  };
  P.whBroadcast = function () { const v = this.whView(); for (const s of this.sessions) s.send(v); };

  P.whOpen = function (fromId) {
    const st = this.whState();
    const src = D.SYSTEMS.filter(s => s.sec <= -0.5 && ![...st.open.values()].some(w => w.from === s.id));
    if (!src.length) return null;
    const from = fromId ? D.SYSTEMS.find(s => s.id === fromId) : pick(src);
    st.seq++;
    const id = 'wh' + this.now.toString(36) + st.seq;
    const name = `${pick(WH.words)} ${pick(WH.letters.split(''))}${Math.floor(rnd(1, 10))}-${Math.floor(rnd(100, 999))}`;
    const ang = Math.random() * Math.PI * 2;
    const def = { id, name, sec: -Math.round(rnd(6, 10)) / 10, x: Math.round(from.x + Math.cos(ang) * 85), y: Math.round(from.y + Math.sin(ang) * 85),
      region: 'deep', star: pick(WH.stars), wormhole: true, income: WH.income };
    const U = this.U;
    U.byId[id] = def; D.EXTRA_SYS[id] = def;
    U.neighbors[id] = [from.id]; U.neighbors[from.id].push(id);
    const sys = buildSystem(def, U.neighbors, U.byId, U.celestials, id + ':' + Math.random());
    // в неизведанной системе станций нет
    for (const c of sys.stations) { delete U.celestials[c.id]; sys.celestials.splice(sys.celestials.indexOf(c), 1); }
    sys.stations = [];
    const back = sys.gates[0]; back.wh = true; back.name = `Червоточина (${from.name})`;
    U.systems[id] = sys;
    // вход — в исходной системе, в случайной точке
    const fs = U.systems[from.id], r = (2 + Math.random() * 4) * AU, a2 = Math.random() * Math.PI * 2;
    const gate = { id: `${from.id}:g:${id}`, kind: 'gate', wh: true, name: `Червоточина (${name})`, dest: id, sys: from.id,
      pos: [Math.cos(a2) * r, (Math.random() - 0.5) * 0.04 * r, Math.sin(a2) * r], radius: 1500, landing: 5000 };
    fs.celestials.push(gate); fs.gates.push(gate); U.celestials[gate.id] = gate;
    // пояса астероидов
    for (const b of sys.belts) {
      const rr = rng(b.id + Math.random()), n = 18 + Math.floor(rr() * 10);
      this.beltState[b.id] = { npcs: new Set(), nextSpawn: 0, counter: n, r: rr, size: n };
      for (let i = 0; i < n; i++) { const ast = makeAsteroid(b, rr, i); this.ents.set(ast.id, ast); }
    }
    const sun2 = sys.celestials.find(c => c.kind === 'sun' && c.companion);
    const w = { id, from: from.id, def, star: def.star, star2: sun2 ? sun2.star : null, gate: gate.id, expires: this.now + WH.life, warned: {} };
    st.open.set(id, w);
    this.whBroadcast();
    this.whRefreshSys(from.id);
    for (const s of this.sessions) s.send({ t: 'chat', ch: 'global', from: 'Новости галактики', text: `В системе ${from.name} открылась червоточина в неизведанную систему «${name}». Доход там ×${WH.income}, проход схлопнется через ${WH.life / 60000} минут.` });
    return w;
  };

  // обновить небесные тела у пилотов в системе (появилась или исчезла червоточина)
  P.whRefreshSys = function (sysId) {
    const sys = this.U.systems[sysId]; if (!sys) return;
    const cel = sys.celestials.map(c => ({ id: c.id, kind: c.kind, name: c.name, pos: c.pos, radius: c.radius, ptype: c.ptype, hue: c.hue, dest: c.dest, style: c.style, star: c.star, companion: c.companion, owner: c.owner, wh: c.wh }));
    for (const s of this.sessions) if (this.playerSys(s.player) === sysId) s.send({ t: 'celestials', sys: sysId, celestials: cel });
  };

  P.whClose = function (w) {
    const U = this.U, id = w.id, sys = U.systems[id], fromSys = U.systems[w.from], gate = U.celestials[w.gate];
    // пилоты с поверхности планет — на орбиту
    for (const s of this.sessions) if (s.surf && s.surf.sys === id) {
      const p = s.player; s.surf.pos = [s.surf.ship[0] + 1, 0, s.surf.ship[1]];
      p.suit = p.suit || {}; this.suitOf(p).inv.launch_fuel = (this.suitOf(p).inv.launch_fuel || 0) + 1;
      this.c_takeoff(s, {}, p);
    }
    // корабли пилотов — выброшены к месту червоточины
    const thrown = [];
    for (const e of [...this.ents.values()]) {
      if (e.sys !== id || !e.session) continue;
      if (e.owner) this.scoopAll(e);
      this.clearLocks(e);
      for (const m of e.modules || []) if (m) m.active = false;
      e.sys = w.from; e.pos = [gate.pos[0] + rnd(-8000, 8000), gate.pos[1] + rnd(-1500, 1500), gate.pos[2] + rnd(-8000, 8000)];
      e.vel = [0, 0, 0]; e.cmd = { type: 'stop' }; e.warp = null; e.invulnUntil = this.now + 8000;
      const p = e.session.player; p.loc = { sys: w.from, pos: e.pos };
      thrown.push(e.session);
      this.notify(e.session, `Червоточина схлопнулась! Вас выбросило обратно в систему ${fromSys.def.name}.`, 'warn');
    }
    // всё остальное в системе исчезает
    for (const e of [...this.ents.values()]) if (e.sys === id && !e.session) this.removeEntity(e);
    if (this.anoms) for (const a of [...this.anoms.values()]) if (a.sys === id) this.removeAnomaly(a);
    if (this.db.pbases) delete this.db.pbases[id];
    if (this.db.fortresses) delete this.db.fortresses[id];
    for (const b of sys.belts) delete this.beltState[b.id];
    for (const c of sys.celestials) delete U.celestials[c.id];
    fromSys.celestials.splice(fromSys.celestials.indexOf(gate), 1); fromSys.gates.splice(fromSys.gates.indexOf(gate), 1); delete U.celestials[gate.id];
    U.neighbors[w.from] = U.neighbors[w.from].filter(x => x !== id);
    delete U.neighbors[id]; delete U.systems[id]; delete U.byId[id]; delete D.EXTRA_SYS[id];
    this.whState().open.delete(id);
    this.whBroadcast();
    this.whRefreshSys(w.from);
    for (const ss of thrown) { this.sendSystem(ss); this.sendLocalMembers(w.from); }
    for (const s of this.sessions) s.send({ t: 'chat', ch: 'global', from: 'Новости галактики', text: `Червоточина «${w.def.name}» в системе ${fromSys.def.name} схлопнулась.` });
  };

  P.whTick = function () {
    const st = this.whState();
    for (const w of [...st.open.values()]) {
      const left = w.expires - this.now;
      if (left <= 0) { this.whClose(w); continue; }
      for (const t of WH.warnAt) if (left <= t && !w.warned[t]) {
        w.warned[t] = true;
        for (const s of this.sessions) if (this.playerSys(s.player) === w.id) this.notify(s, `Червоточина схлопнется через ${Math.round(t / 60000)} мин! Летите к ней, чтобы вернуться.`, 'bad');
      }
    }
    if (this.now >= st.next && st.open.size < WH.maxOpen && [...this.sessions].some(s => !s.isBot)) {
      st.next = this.now + rnd(WH.every[0], WH.every[1]);
      this.whOpen();
    }
  };

  P.slowTick = function () { baseSlow.call(this); this.whTick(); };
  P.login = function (sess, name, pass) {
    const r = baseLogin.call(this, sess, name, pass);
    if (sess.player && this.whState().open.size) sess.send(this.whView());
    return r;
  };
  P.jump = function (e, gate) {
    const r = baseJump.call(this, e, gate);
    const w = this.whState().open.get(gate.dest);
    if (w && e.session) this.notify(e.session, `Неизведанная система «${w.def.name}». Доход ×${WH.income}. Проход схлопнется через ${Math.ceil((w.expires - this.now) / 60000)} мин — не опоздайте.`, 'warn');
    return r;
  };
  P.c_whInfo = function (s) { s.send(this.whView()); };
};
module.exports.WH = WH;
