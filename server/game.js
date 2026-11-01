// Авторитарная серверная симуляция: полёт, варп, бой, добыча, NPC, экономика, миссии.
'use strict';
const crypto = require('crypto');
const D = require('./data');
const { buildUniverse, makeAsteroid, route, rng } = require('./universe');
const { AU, SHIPS, MODULES, DRONES, ITEMS, NPCS, SKILLS, SKILL_TIME, REGIONS, STAR_TYPES, incomeOf } = D;

// ---------- Векторная математика ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const norm = (a) => { const l = len(a); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rnd = (a, b) => a + Math.random() * (b - a);
const uid = () => crypto.randomBytes(6).toString('hex');

const GRID_RANGE = 400000;      // дальность «сетки» (видимые объекты), м
const DOCK_RANGE = 2500;
const JUMP_RANGE = 2500;
const LOOT_RANGE = 2500;
const MIN_WARP = 150000;
const CRIME_TIME = 15 * 60 * 1000;
const RECONNECT_GRACE = 120 * 1000; // корабль ждёт пилота после обрыва связи
const BASE_TAX = 0.06;

class Game {
  constructor(db, save) {
    this.db = db;           // { players: {}, orders: [] }
    this.save = save;
    this.U = buildUniverse();
    this.ents = new Map();  // id -> сущность в космосе (корабли, астероиды, обломки)
    this.sessions = new Set();
    this.now = Date.now();
    this.prices = {};       // stationId -> { itemId: множитель }
    this.missionBoards = {};
    this.beltState = {};
    this.initBelts();
    this.loadStructures();
    this.initAI(); this.initBots();
    this.rollPrices();
    setInterval(() => this.rollPrices(), 10 * 60 * 1000);
  }

  // ======================================================================
  // Инициализация
  // ======================================================================
  initBelts() {
    for (const sys of Object.values(this.U.systems)) {
      for (const b of sys.belts) {
        const r = rng(b.id);
        const n = 16 + Math.floor(r() * 10);
        this.beltState[b.id] = { npcs: new Set(), nextSpawn: 0, counter: n, r, size: n };
        for (let i = 0; i < n; i++) { const a = makeAsteroid(b, r, i); this.ents.set(a.id, a); }
      }
    }
  }

  rollPrices() {
    for (const sys of Object.values(this.U.systems)) {
      for (const st of sys.stations) {
        const p = this.prices[st.id] || (this.prices[st.id] = {});
        for (const id of Object.keys(ITEMS)) {
          const prev = p[id] || 1;
          let base = sys.def.hub ? 1.05 : 1 - (sys.def.sec < 0.5 ? 0.08 : 0);
          // дальние станции платят больше за редкую руду
          if (id === 'ore_nullium' && sys.def.hub) base = 1.15;
          p[id] = clamp(prev * 0.7 + base * 0.3 + rnd(-0.06, 0.06), 0.75, 1.3);
        }
      }
    }
  }

  // ======================================================================
  // Игроки и сессии
  // ======================================================================
  hashPass(pass, salt) { return crypto.scryptSync(pass, salt, 32).toString('hex'); }

  login(sess, name, pass) {
    name = String(name || '').trim().slice(0, 20);
    pass = String(pass || '');
    if (!/^[\p{L}\p{N}_\- ]{3,20}$/u.test(name)) return sess.send({ t: 'loginErr', msg: 'Имя: 3–20 символов (буквы, цифры, _ -)' });
    if (pass.length < 3) return sess.send({ t: 'loginErr', msg: 'Пароль слишком короткий (минимум 3 символа)' });
    let p = this.db.players[name];
    if (p && this.hashPass(pass, p.salt) !== p.pass) return sess.send({ t: 'loginErr', msg: 'Неверный пароль' });
    // повторный вход того же пилота (например, после обрыва связи) вытесняет старую сессию
    for (const s of [...this.sessions]) if (s.player && s.player.name === name) {
      s.send({ t: 'kicked', msg: 'Выполнен вход с другого устройства или после переподключения' });
      this.logout(s, true);
      if (s.ws && s.ws.close) try { s.ws.close(); } catch (e) {}
    }
    if (!p) {
      p = this.newPlayer(name, pass);
      this.db.players[name] = p;
      this.save(true);
    }
    this.repairLocation(p);
    sess.player = p;
    this.sessions.add(sess);
    this.checkSkills(p);

    sess.send({
      t: 'welcome', name: p.name, ship: p.ship && p.ship.type,
      data: {
        ships: SHIPS, shipRoles: D.SHIP_ROLES, factions: D.FACTION_INFO, modules: MODULES, modUpgrade: D.MOD_UPGRADE, drones: DRONES, droneClasses: D.DRONE_CLASSES, blueprints: D.BLUEPRINTS, items: ITEMS, skills: SKILLS, skillTime: SKILL_TIME,
        systems: D.SYSTEMS, gates: D.GATES, regions: D.REGIONS, starTypes: D.STAR_TYPES,
        stars: Object.fromEntries(Object.values(this.U.systems).map(x => [x.id, x.celestials[0].star])),
        stars2: Object.fromEntries(Object.values(this.U.systems).map(x => { const c = x.celestials.find(o => o.companion); return [x.id, c ? c.star : null]; })),
        stations: Object.values(this.U.celestials).filter(c => c.kind === 'station').map(s => ({ id: s.id, name: s.name, sys: s.sys, owner: s.owner }))
      }
    });
    if (p.loc.docked) this.enterStation(sess, p.loc.docked, true);
    else this.spawnInSpace(sess, p.loc.sys, p.loc.pos);
    this.broadcastSys(this.playerSys(p), { t: 'chat', ch: 'local', from: '*', text: `${p.name} входит в систему` });
    this.sendProfile(sess);
  }

  // Если сохранение ссылается на станцию или систему, которой больше нет, — возвращаем пилота домой
  repairLocation(p) {
    const isStation = (id) => this.U.celestials[id] && this.U.celestials[id].kind === 'station';
    if (!isStation(p.home)) p.home = 'arktur:st1';
    if (p.loc.docked && !isStation(p.loc.docked)) p.loc = { docked: p.home };
    if (!p.loc.docked && (!this.U.systems[p.loc.sys] || !Array.isArray(p.loc.pos) || p.loc.pos.some(x => !isFinite(x)))) p.loc = { docked: p.home };
    if (!p.ship || !SHIPS[p.ship.type]) p.ship = this.newShip('iskra', true);
  }

  newPlayer(name, pass) {
    const salt = uid();
    const home = 'arktur:st1';
    return {
      name, salt, pass: this.hashPass(pass, salt), credits: 25000, home,
      loc: { docked: home },
      ship: this.newShip('iskra', true),
      hangars: {}, skills: {}, training: null, missions: [], stats: { kills: 0, npcKills: 0, deaths: 0, mined: 0 },
      criminalUntil: 0, suspectUntil: 0, created: Date.now()
    };
  }

  newShip(type, fitted) {
    const t = SHIPS[type];
    const n = t.slots.high + t.slots.mid + t.slots.low;
    const fit = fitted && t.defaultFit ? t.defaultFit.slice(0, n) : new Array(n).fill(null);
    return { uid: uid(), type, fit, cargo: {}, drones: {}, hp: { shield: 1, armor: 1, hull: 1 } };
  }

  logout(sess, replaced) {
    if (!this.sessions.has(sess)) return;
    this.sessions.delete(sess);
    const p = sess.player;
    if (sess.ent) {
      const e = sess.ent;
      // Обрыв связи: корабль остаётся в космосе до 120 с под защитным ИИ (и может погибнуть) — можно вернуться.
      // Осознанный выход вне боя («bye») убирает корабль сразу.
      const fighting = e.lastHitAt && this.now - e.lastHitAt < 30000;
      this.scoopAll(e);
      this.storeShipState(p, e);
      p.loc = { sys: e.sys, pos: e.warp ? e.warp.to : e.pos.slice() };
      if (fighting || replaced || !sess.bye) {
        e.session = null; if (e.cmd.type === 'manual') e.cmd = { type: 'stop' };
        e.logoffAt = this.now + RECONNECT_GRACE;
      } else this.ents.delete(e.id);
    }
    this.broadcastSys(this.playerSys(p), { t: 'chat', ch: 'local', from: '*', text: `${p.name} покидает систему` });
    this.save(true);
  }

  // Защитный ИИ корабля без пилота (обрыв связи): отвечает огнём нападающему и включает ремонт
  guardTick(e) {
    if (this.now < (e.nextGuard || 0)) return;
    e.nextGuard = this.now + 1000;
    const att = e.lastAttacker && this.ents.get(e.lastAttacker);
    const threatened = att && att.sys === e.sys && !att.warp && this.now - (e.lastHitAt || 0) < 15000;
    for (const m of e.modules) {
      if (!m) continue;
      const def = MODULES[m.id];
      if (def.kind === 'shieldRep' || def.kind === 'armorRep') {
        if (threatened && !m.active) { m.active = true; if (this.now >= m.cycleEnd) this.startCycle(e, m); }
        else if (!threatened) m.active = false;
      } else if (def.kind === 'weapon' && threatened && (!m.active || m.target !== att.id) && this.surfaceDist(e, att) <= def.optimal + def.falloff * 2) {
        e.locks.add(att.id); m.target = att.id; m.active = true;
        if (this.now >= m.cycleEnd) this.startCycle(e, m);
      }
    }
  }
  c_bye(s) { s.bye = true; }

  playerSys(p) {
    if (p.loc.docked) return this.U.celestials[p.loc.docked].sys;
    return p.loc.sys;
  }

  hangar(p, stationId) {
    return p.hangars[stationId] || (p.hangars[stationId] = { items: {}, ships: [] });
  }

  // ---------- Характеристики корабля с учётом модулей и навыков ----------
  calcStats(p, ship) {
    const t = SHIPS[ship.type];
    const sk = (p && p.skills) || {};
    const b = { damage: 0, mining: 0, cargo: 0, speed: 0, scan: 0, drones: 0, rof: 0, hp: 0, capRegen: 0, warp: 0, droneCount: 0 };
    for (const k in (t.bonus || {})) b[k] += t.bonus[k];
    for (const m of ship.fit) if (m && MODULES[m].passive) for (const k in MODULES[m].passive) b[k] += MODULES[m].passive[k];
    b.damage += 0.05 * (sk.gunnery || 0);
    b.mining += 0.05 * (sk.mining || 0);
    b.speed += 0.05 * (sk.navigation || 0);
    const eng = 1 + 0.05 * (sk.engineering || 0);
    return {
      maxSpeed: t.maxSpeed * (1 + b.speed), align: t.align, warpSpeed: t.warpSpeed * (1 + 0.1 * (sk.warpnav || 0)) * (1 + b.warp), sig: t.sig, radius: t.radius,
      shield: t.shield * (1 + 0.05 * (sk.shields || 0)) * (1 + b.hp), armor: t.armor * (1 + 0.05 * (sk.armor || 0)) * (1 + b.hp), hull: t.hull * (1 + b.hp),
      cap: t.cap * eng, capRegen: t.capRegen * eng * (1 + b.capRegen), cargo: t.cargo * (1 + b.cargo), rof: b.rof,
      maxLocks: t.maxLocks + ((sk.targeting || 0) >= 5 ? 2 : (sk.targeting || 0) >= 3 ? 1 : 0), lockRange: t.lockRange * (1 + 0.1 * (sk.targeting || 0)), lockTime: t.lockTime,
      dmgMul: 1 + b.damage, mineMul: 1 + b.mining, scanBonus: b.scan, droneMul: b.drones, droneBay: t.droneBay || 0, maxDrones: (t.maxDrones || 0) + Math.floor(b.droneCount)
    };
  }

  cargoUsed(cargo) {
    let v = 0;
    for (const id in cargo) v += cargo[id] * (ITEMS[id] ? ITEMS[id].vol : 1);
    return v;
  }

  slotType(shipType, idx) {
    const s = SHIPS[shipType].slots;
    if (idx < s.high) return 'high';
    if (idx < s.high + s.mid) return 'mid';
    return 'low';
  }

  // ======================================================================
  // Космос: появление, станции, прыжки
  // ======================================================================
  makeShipEntity(p, sysId, pos) {
    const ship = p.ship;
    const st = this.calcStats(p, ship);
    const e = {
      id: 'sh_' + ship.uid, type: 'ship', owner: p.name, name: p.name, shipType: ship.type, sys: sysId,
      pos: pos.slice(), vel: [0, 0, 0], heading: [0, 0, 1], stats: st,
      shield: st.shield * ship.hp.shield, armor: st.armor * ship.hp.armor, hull: st.hull * ship.hp.hull, cap: st.cap,
      cmd: { type: 'stop' }, speedFrac: 1, modules: ship.fit.map(m => m ? { id: m, active: false, cycleEnd: 0, target: null } : null),
      locks: new Set(), locking: new Map(), warp: null, scrambledUntil: 0, aggressors: new Map(), radius: st.radius
    };
    return e;
  }

  spawnInSpace(sess, sysId, pos) {
    const p = sess.player;
    if (!this.U.systems[sysId]) { sysId = 'arktur'; pos = null; }
    if (!pos) pos = add(this.U.systems[sysId].stations[0].pos, [8000, 0, 0]);
    // Подхватываем корабль, если он ещё висит в космосе после выхода
    let e = this.ents.get('sh_' + p.ship.uid);
    if (!e) { e = this.makeShipEntity(p, sysId, pos); this.ents.set(e.id, e); }
    e.session = sess; e.logoffAt = 0;
    sess.ent = e; sess.docked = null;
    p.loc = { sys: e.sys, pos: e.pos };
    this.sendSystem(sess);
  }

  sendSystem(sess) {
    const sysId = sess.ent ? sess.ent.sys : this.playerSys(sess.player);
    const sys = this.U.systems[sysId];
    sess.send({
      t: 'system', id: sysId, name: sys.def.name, sec: sys.def.sec,
      region: sys.def.region, income: incomeOf(sysId),
      celestials: sys.celestials.map(c => ({ id: c.id, kind: c.kind, name: c.name, pos: c.pos, radius: c.radius, ptype: c.ptype, hue: c.hue, dest: c.dest, style: c.style, star: c.star, companion: c.companion, owner: c.owner, wh: c.wh }))
    });
    this.sendLocalMembers(sysId);
    this.sendAnoms(sess);
  }

  storeShipState(p, e) {
    p.ship.hp = { shield: clamp(e.shield / e.stats.shield, 0, 1), armor: clamp(e.armor / e.stats.armor, 0, 1), hull: clamp(e.hull / e.stats.hull, 0, 1) };
  }

  enterStation(sess, stationId, silent) {
    const p = sess.player;
    const st = this.U.celestials[stationId];
    // каждый прилёт на станцию обновляет руду в поясах системы
    if (!silent && this.refillBelts(st.sys)) this.notify(sess, 'Пояса астероидов системы обновлены — руда восстановлена', 'good');
    if (sess.ent) {
      this.scoopAll(sess.ent);
      this.storeShipState(p, sess.ent);
      this.removeEntity(sess.ent);
      sess.ent = null;
    }
    // Бесплатный ремонт на станции
    p.ship.hp = { shield: 1, armor: 1, hull: 1 };
    p.loc = { docked: stationId };
    sess.docked = stationId;
    this.sendSystem(sess);
    sess.send({ t: 'docked', station: stationId, name: st.name, sys: st.sys });
    this.checkCourier(sess);
    this.storyDock(sess);
    this.sendProfile(sess);
    if (!silent) this.notify(sess, `Стыковка: ${st.name}`);
  }

  undock(sess) {
    if (!sess.docked) return;
    const st = this.U.celestials[sess.docked];
    const p = sess.player;
    const pos = add(st.pos, mul(st.undock, st.radius + 1200 + Math.random() * 300));
    p.loc = { sys: st.sys, pos };
    sess.docked = null;
    const e = this.makeShipEntity(p, st.sys, pos);
    e.vel = mul(st.undock, e.stats.maxSpeed * 0.8);
    e.heading = st.undock.slice();
    e.cmd = { type: 'dir', dir: st.undock.slice() };
    e.invulnUntil = this.now + 5000;
    this.ents.set(e.id, e);
    e.session = sess; sess.ent = e;
    sess.send({ t: 'undocked' });
    const hd = this.hangar(p, st.id).items;
    if (SHIPS[p.ship.type].droneBay && !Object.keys(this.droneBay(p.ship)).length && (Object.keys(hd).some(k => DRONES[k]) || Object.keys(p.ship.cargo).some(k => DRONES[k])))
      this.notify(sess, 'Отсек дронов пуст, а дроны есть в ангаре или трюме. В следующий раз нажмите «Заполнить отсек» во вкладке «Оснастка».', 'warn');
    this.sendProfile(sess);
  }

  jump(e, gate) {
    if (e.owner) this.scoopAll(e);
    const destSys = this.U.systems[gate.dest];
    const back = destSys.gates.find(g => g.dest === e.sys);
    this.clearLocks(e);
    for (const m of e.modules) if (m) m.active = false;
    const oldSys = e.sys;
    e.sys = gate.dest;
    e.pos = add(back.pos, [rnd(-6000, 6000), rnd(-1000, 1000), rnd(-6000, 6000)]);
    e.vel = [0, 0, 0]; e.cmd = { type: 'stop' }; e.warp = null;
    e.invulnUntil = this.now + 6000; // «маскировка» после прыжка
    this.fxSys(oldSys, gate.pos, { k: 'jump', pos: gate.pos });
    if (e.session) {
      const p = e.session.player;
      p.loc = { sys: e.sys, pos: e.pos };
      this.sendSystem(e.session);
      this.sendLocalMembers(oldSys);
      this.notify(e.session, `Прыжок в систему ${destSys.def.name} (${destSys.def.sec.toFixed(1)})`);
      if (destSys.def.sec < 0.5 && this.U.byId[oldSys].sec >= 0.5) this.notify(e.session, 'Внимание: низкий уровень безопасности. Стражи порядка здесь не защитят вас.', 'warn');
    }
  }

  removeEntity(e) {
    this.ents.delete(e.id);
    for (const o of this.ents.values()) {
      if (o.type !== 'ship') continue;
      if (o.locks.has(e.id) || o.locking.has(e.id)) { o.locks.delete(e.id); o.locking.delete(e.id); }
      if (o.cmd && o.cmd.target === e.id) o.cmd = { type: 'stop' };
      if (o.npcTarget === e.id) o.npcTarget = null;
      for (const m of o.modules) if (m && m.target === e.id) m.active = false;
    }
  }

  clearLocks(e) {
    e.locks.clear(); e.locking.clear();
    for (const o of this.ents.values()) {
      if (o.type !== 'ship' || o === e) continue;
      o.locks.delete(e.id); o.locking.delete(e.id);
      for (const m of o.modules) if (m && m.target === e.id) m.active = false;
      if (o.npcTarget === e.id) o.npcTarget = null;
    }
  }

  // Найти объект (сущность или небесное тело) в системе сущности e
  findTarget(e, id) {
    const x = this.ents.get(id);
    if (x && x.sys === e.sys) return x;
    const c = this.U.celestials[id];
    if (c && c.sys === e.sys) return c;
    const a = this.anoms && this.anoms.get(id);
    if (a && a.sys === e.sys) return a;
    if (id.startsWith('bm_bm_')) { const d = this.ents.get(id.slice(3)); if (d && d.sys === e.sys) return d; }
    return null;
  }

  surfaceDist(a, b) { return Math.max(0, dist(a.pos, b.pos) - (a.radius || 0) - (b.radius || 0)); }

  // ======================================================================
  // Обработка команд клиента
  // ======================================================================
  handle(sess, msg) {
    // ограничение частоты: не больше 40 сообщений в секунду (ручной полёт шлёт ~11)
    const rl = sess.rl || (sess.rl = { t: 0, n: 0, warn: 0 });
    const sec = Math.floor(Date.now() / 1000);
    if (rl.t !== sec) { rl.t = sec; rl.n = 0; }
    if (++rl.n > 40 && !sess.isBot) { if (Date.now() - rl.warn > 10000) { rl.warn = Date.now(); if (sess.player) this.notify(sess, 'Слишком много запросов — часть команд отброшена', 'warn'); } return; }
    // идемпотентность: повтор команды с тем же tx (повторная отправка после сбоя) не исполняется второй раз
    // журнал tx хранится по пилоту, поэтому повтор после переподключения тоже отсекается
    if (typeof msg.tx === 'string' && msg.tx.length <= 40 && sess.player) {
      const all = this.txSeen || (this.txSeen = new Map());
      const seen = all.get(sess.player.name) || all.set(sess.player.name, new Map()).get(sess.player.name);
      if (seen.has(msg.tx)) return;
      seen.set(msg.tx, Date.now());
      if (seen.size > 300) seen.delete(seen.keys().next().value);
    }
    const p = sess.player;
    if (!p) { if (msg.t === 'login') this.login(sess, msg.name, msg.pass); return; }
    const e = sess.ent;
    const fn = this['c_' + msg.t];
    if (!fn) return;
    try { fn.call(this, sess, msg, p, e); } catch (err) { console.error('cmd error', msg.t, err); }
  }

  // --- Полёт ---
  c_approach(s, m, p, e) { if (!e || e.warp) return; const t = this.findTarget(e, m.id); if (t) { e.cmd = { type: 'approach', target: t.id }; e.autopilot = null; } }
  c_orbit(s, m, p, e) { if (!e || e.warp) return; const t = this.findTarget(e, m.id); if (t) { e.cmd = { type: 'orbit', target: t.id, range: clamp(+m.range || 5000, 500, 100000) }; e.autopilot = null; } }
  c_keep(s, m, p, e) { if (!e || e.warp) return; const t = this.findTarget(e, m.id); if (t) { e.cmd = { type: 'keep', target: t.id, range: clamp(+m.range || 10000, 500, 150000) }; e.autopilot = null; } }
  c_stop(s, m, p, e) { if (!e || e.warp) return; e.cmd = { type: 'stop' }; e.autopilot = null; }
  c_manual(s, m, p, e) {
    if (!e || e.warp) return;
    if (!m.on) { if (e.cmd.type === 'manual') e.cmd = { type: 'stop' }; return; }
    const n = (v, lo, hi) => { v = +v; return Number.isFinite(v) ? clamp(v, lo, hi) : 0; };
    let dir = Array.isArray(m.dir) && m.dir.length === 3 ? m.dir.map(x => n(x, -1, 1)) : null;
    if (dir && len(dir) < 0.1) dir = null;
    e.cmd = { type: 'manual', dir: dir ? norm(dir) : e.heading, thr: n(m.thr, -0.5, 1), sx: n(m.sx, -1, 1), uy: n(m.uy, -1, 1), boost: !!m.boost, brake: !!m.brake, stab: m.stab !== false };
    e.autopilot = null;
  }
  c_dir(s, m, p, e) {
    if (!e || e.warp || !Array.isArray(m.dir)) return;
    e.cmd = { type: 'dir', dir: norm(m.dir.map(Number)) }; e.autopilot = null;
  }
  c_speed(s, m, p, e) { if (e) e.speedFrac = clamp(+m.v || 0, 0, 1); }
  c_warp(s, m, p, e) {
    if (!e || e.warp) return;
    const t = this.findTarget(e, m.id);
    if (!t) return;
    this.startAlignWarp(e, t, clamp(+m.range || 0, 0, 500000));
  }
  c_dock(s, m, p, e) {
    if (!e || e.warp) return;
    const t = this.findTarget(e, m.id);
    if (!t || t.kind !== 'station') return this.notify(s, 'Цель — не станция', 'warn');
    const ps = t.player && (this.db.structures || []).find(x => x.id === t.id);
    if (ps && ps.buildUntil > this.now) return this.notify(s, `Станция ещё строится (${Math.ceil((ps.buildUntil - this.now) / 1000)} с)`, 'warn');
    if (dist(e.pos, t.pos) > MIN_WARP) this.startAlignWarp(e, t, 0, 'dock');
    else e.cmd = { type: 'dock', target: t.id };
  }
  c_jump(s, m, p, e) {
    if (!e || e.warp) return;
    const t = this.findTarget(e, m.id);
    if (!t || t.kind !== 'gate') return this.notify(s, 'Цель — не звёздные врата', 'warn');
    if (dist(e.pos, t.pos) > MIN_WARP) this.startAlignWarp(e, t, 0, 'jump');
    else e.cmd = { type: 'jump', target: t.id };
  }
  c_undock(s) { this.undock(s); }
  c_autopilot(s, m, p, e) {
    if (!m.dest) { if (e) e.autopilot = null; return; }
    const sysId = e ? e.sys : this.playerSys(p);
    const r = route(this.U.neighbors, sysId, m.dest);
    if (!r) return;
    s.send({ t: 'route', route: r });
    if (m.go && e) { e.autopilot = { dest: m.dest }; this.notify(s, 'Автопилот включён'); }
  }

  // --- Захват целей и модули ---
  c_lock(s, m, p, e) {
    if (!e || e.warp) return;
    const t = this.ents.get(m.id);
    if (!t || t.sys !== e.sys || t === e || !['ship', 'asteroid', 'wreck', 'drone', 'turret'].includes(t.type)) return;
    if (t.dealer) return this.notify(s, 'Контрабандиста нельзя захватить — подлетите и нажмите «Торговать»', 'warn');
    if (t.civ && this.U.byId[e.sys].sec >= 0.5) return this.notify(s, 'Гражданское судно под защитой Стражей — захват невозможен', 'warn');
    if (e.locks.has(t.id) || e.locking.has(t.id)) return;
    if (e.locks.size + e.locking.size >= e.stats.maxLocks) return this.notify(s, `Максимум целей: ${e.stats.maxLocks}`, 'warn');
    if (this.surfaceDist(e, t) > e.stats.lockRange) return this.notify(s, `Цель вне дальности захвата (${(e.stats.lockRange / 1000).toFixed(0)} км)`, 'warn');
    if (t.warp) return;
    const sig = t.type === 'ship' ? t.stats.sig : 300;
    e.locking.set(t.id, this.now + 1000 * e.stats.lockTime * clamp(60 / sig, 0.4, 2));
  }
  c_unlock(s, m, p, e) {
    if (!e) return;
    e.locks.delete(m.id); e.locking.delete(m.id);
    for (const mod of e.modules) if (mod && mod.target === m.id) mod.active = false;
  }
  c_module(s, m, p, e) {
    if (!e || e.warp) return;
    const mod = e.modules[m.slot | 0];
    if (!mod) return;
    const def = MODULES[mod.id];
    if (def.kind === 'passive') return;
    if (mod.active) { mod.active = false; return; }
    if (['weapon', 'miner', 'scram', 'launcher'].includes(def.kind)) {
      const t = this.ents.get(m.target);
      if (!t || !e.locks.has(t.id)) return this.notify(s, 'Нужна захваченная цель', 'warn');
      if (def.kind === 'miner' && t.type !== 'asteroid') return this.notify(s, 'Буровой лазер работает только по астероидам', 'warn');
      if (def.kind !== 'miner' && t.type !== 'ship' && t.type !== 'turret') return this.notify(s, 'Цель должна быть кораблём', 'warn');
      const range = def.kind === 'weapon' ? def.optimal + def.falloff * 2 : def.range;
      if (this.surfaceDist(e, t) > range) return this.notify(s, `Цель слишком далеко (дальность ${(range / 1000).toFixed(1)} км)`, 'warn');
      if (t.type === 'ship' && t.owner && e.owner && !this.canAttack(e, t, s, m.confirm)) return;
      mod.target = t.id;
    }
    mod.active = true;
    if (this.now >= mod.cycleEnd) this.startCycle(e, mod);
  }

  canAttack(e, t, s, confirmed) {
    const sec = this.U.byId[e.sys].sec;
    const pa = this.db.players[e.owner], pt = this.db.players[t.owner];
    if (!pt || pa === pt) return true;
    const legal = pt.criminalUntil > this.now || pt.suspectUntil > this.now || (e.aggressors.get(t.id) || 0) > this.now /* самооборона */;
    if (legal || sec <= 0) return true;
    if (!confirmed) {
      s.send({ t: 'confirmAttack', sec, msg: sec >= 0.5
        ? 'Атака на пилота в системе с высоким уровнем безопасности. Стражи порядка уничтожат ваш корабль! Продолжить?'
        : 'Атака на пилота сделает вас «подозреваемым» — любой сможет атаковать вас без последствий. Продолжить?' });
      return false;
    }
    if (sec >= 0.5) { pa.criminalUntil = this.now + CRIME_TIME; this.notify(s, 'Вы стали преступником! Стражи порядка уже в пути.', 'bad'); }
    else { pa.suspectUntil = this.now + CRIME_TIME; this.notify(s, 'Вы получили статус «подозреваемый».', 'bad'); }
    return true;
  }

  // Нагрев: каждый выстрел греет корабль (heatPerShot), мощное оружие — сильнее. При 100% орудия отключаются на время остывания.
  startCycle(e, mod) {
    const def = MODULES[mod.id];
    if (e.owner && mod.damagedUntil > this.now) { mod.active = false; if (e.session) this.notify(e.session, `${def.name} повреждён — ремонт ещё ${Math.ceil((mod.damagedUntil - this.now) / 1000)} с`, 'warn'); return; }
    if (e.owner && def.kind === 'weapon' && e.overheatUntil > this.now) { mod.active = false; if (e.session) this.notify(e.session, 'Орудия перегреты — дождитесь остывания', 'warn'); return; }
    if (e.cap < def.cap) { mod.active = false; if (e.session) this.notify(e.session, 'Недостаточно энергии в накопителе', 'warn'); return; }
    e.cap -= def.cap;
    mod.cycleStart = this.now;
    mod.cycleEnd = this.now + def.cycle * 1000 / (def.kind === 'weapon' ? 1 + ((e.stats && e.stats.rof) || 0) : 1); // «Хроноускоритель» — чаще стреляет
    if (def.kind === 'weapon') {
      this.fireWeapon(e, mod, def);
      if (e.owner) {
        // запас тепла и охлаждение растут с числом орудийных портов корабля
        const before = e.heat || 0, hs = SHIPS[e.shipType].slots.high || 1;
        e.heat = before + (MODULES[mod.id].heatPerShot || 0) * 100 / (100 + 25 * hs);
        if (before < 80 && e.heat >= 80 && e.heat < 100 && e.session) this.notify(e.session, 'Нагрев орудий 80% — сбавьте темп или выключите часть орудий', 'warn');
        if (e.heat >= 100) {
          e.overheatUntil = this.now + 6000; e.heat = 100;
          for (const m of e.modules) if (m && MODULES[m.id].kind === 'weapon') m.active = false;
          if (e.session) this.notify(e.session, 'ПЕРЕГРЕВ! Орудия отключены на 6 секунд', 'bad');
        }
      }
    }
    if (def.kind === 'miner') { const t = this.ents.get(mod.target); if (t) this.fxSys(e.sys, null, { k: 'mine', from: e.id, to: t.id, color: def.color, dur: def.cycle }); }
    if (def.kind === 'scram') { const t = this.ents.get(mod.target); if (t) t.scrambledUntil = mod.cycleEnd + 500; }
  }

  endCycle(e, mod) {
    const def = MODULES[mod.id];
    if (def.kind === 'miner') this.mineYield(e, mod, def);
    else if (def.kind === 'shieldRep') e.shield = Math.min(e.stats.shield, e.shield + def.amount);
    else if (def.kind === 'armorRep') e.armor = Math.min(e.stats.armor, e.armor + def.amount);
    if (!mod.active) return;
    // проверка цели для следующего цикла
    if (mod.target) {
      const t = this.ents.get(mod.target);
      const range = def.kind === 'weapon' ? def.optimal + def.falloff * 2 : (def.range || 1e12);
      if (!t || !e.locks.has(t.id) || this.surfaceDist(e, t) > range || t.warp) { mod.active = false; return; }
    }
    this.startCycle(e, mod);
  }

  fireWeapon(e, mod, def) {
    const t = this.ents.get(mod.target);
    if (!t || (t.type !== 'ship' && t.type !== 'drone')) { mod.active = false; return; }
    const d = this.surfaceDist(e, t);
    const q = d <= def.optimal ? 1 : Math.pow(0.5, Math.pow((d - def.optimal) / def.falloff, 2));
    const hit = Math.random() < q;
    const fx = { k: 'beam', from: e.id, to: t.id, color: def.color, hit, dur: Math.min(1.2, def.cycle * 0.5) };
    this.fxSys(e.sys, null, fx);
    if (!hit) return;
    let dmg = def.dmg * e.stats.dmgMul * (e.npcDmgMul || 1) * rnd(0.7, 1.3) * (0.5 + 0.5 * q);
    // крупные орудия плохо попадают по маленьким целям
    const sigRes = def.dmg > 100 ? 160 : def.dmg > 60 ? 80 : 40;
    dmg *= clamp(t.stats.sig / sigRes, 0.25, 1);
    fx.dmg = Math.round(dmg); // для всплывающих цифр урона
    this.applyDamage(t, dmg, e);
  }

  // Цепная молния: от поражённой цели разряд перескакивает на ближайшего врага в радиусе, каждый раз слабее.
  // Врагом считаются пираты, преступники и те, кто напал на стрелка; свои и мирные — никогда
  arcChain(e, first, dmg, def) {
    const hitIds = new Set([first.id]);
    const hostile = (o) => (o.npc && !o.guardian) || o.outlaw || (e.aggressors.get(o.id) || 0) > this.now
      || (o.type === 'drone' && o.ownerEnt && (e.aggressors.get(o.ownerEnt) || 0) > this.now);
    let cur = first, k = dmg;
    for (let j = 0; j < def.arc.jumps; j++) {
      let best = null, bd = def.arc.range;
      for (const o of this.ents.values()) {
        if (o.sys !== e.sys || o === e || o.warp || hitIds.has(o.id) || (o.type !== 'ship' && o.type !== 'drone')) continue;
        if (o.owner && o.owner === e.owner) continue;
        if (o.ownerEnt === e.id || !hostile(o)) continue;
        const d = dist(o.pos, cur.pos);
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) break;
      k *= def.arc.decay;
      hitIds.add(best.id);
      this.fxSys(e.sys, null, { k: 'beam', arc: 1, from: cur.id, to: best.id, color: def.color, hit: true, dur: 0.6, dmg: Math.round(k) });
      this.applyDamage(best, k, e);
      if (!this.ents.has(cur.id) && !this.ents.has(best.id)) break;
      cur = this.ents.get(best.id) || best;
    }
  }

  applyDamage(t, dmg, src) {
    if (t.invulnUntil && t.invulnUntil > this.now) return;
    if (t.warp) return;
    t.lastHitAt = this.now;
    if (src) {
      t.aggressors.set(src.id, this.now + 60000);
      if (t.owner && src.owner) t.aggressors.set(src.id, this.now + CRIME_TIME);
      t.lastAttacker = src.id;
      if (t.npc && !t.npcTarget) t.npcTarget = src.id;
      else if (t.npc && src.type === 'drone' && Math.random() < 0.12) t.npcTarget = src.id;
    }
    // на «Истории» пираты наносят игроку меньше урона, а на «Опытном» — те же цифры, но больше врагов и умнее тактика
    if (t.owner && src && src.npc) { const d = (this.db.players[t.owner] || {}).difficulty; if (d === 'story') dmg *= 0.7; }
    let rest = dmg;
    const s = Math.min(t.shield, rest); t.shield -= s; rest -= s;
    const a = Math.min(t.armor, rest); t.armor -= a; rest -= a;
    t.hull -= rest;
    // попадания в корпус могут вывести из строя модуль (временно) — состояния повреждений вместо разрушения
    if (rest > 0 && t.owner && t.hull > 0 && Math.random() < Math.min(0.35, 0.12 * rest / (t.stats.hull * 0.05))) {
      const live = t.modules.filter(m => m && MODULES[m.id].kind !== 'passive' && !(m.damagedUntil > this.now));
      if (live.length) {
        const m = live[Math.floor(Math.random() * live.length)];
        m.damagedUntil = this.now + 10000; m.active = false;
        if (t.session) this.notify(t.session, `Попадание в корпус: «${MODULES[m.id].name}» выведен из строя на 10 с`, 'bad');
      }
    }
    if (t.hull <= 0) { if (t.type === 'drone') this.destroyDrone(t, src); else this.destroyShip(t, src); }
  }

  destroyShip(t, killer) {
    const sysId = t.sys;
    this.fxSys(sysId, t.pos, { k: 'boom', pos: t.pos, size: t.radius * 4 });
    // обломки с добычей
    const items = {};
    if (t.npc) {
      for (const [item, chance, a, b] of NPCS[t.npc].loot) if (Math.random() < chance) items[item] = (items[item] || 0) + Math.floor(rnd(a, b + 1));
    } else if (t.owner) {
      const p = this.db.players[t.owner];
      for (const [id, q] of Object.entries(p.ship.cargo)) if (Math.random() < 0.6) items[id] = q;
      for (const m of p.ship.fit) if (m && Math.random() < 0.5) items[m] = (items[m] || 0) + 1;
    }
    this.removeEntity(t);
    if (Object.keys(items).length) {
      const w = { id: 'wr_' + uid(), type: 'wreck', sys: sysId, pos: t.pos.slice(), vel: [0, 0, 0], radius: 60,
        name: `Обломки: ${t.npc ? NPCS[t.npc].name : SHIPS[t.shipType].name}`, items, expires: this.now + 20 * 60000 };
      this.ents.set(w.id, w);
    }
    const killerEnt = killer && this.ents.get(killer.id);
    const killerPlayer = killerEnt && killerEnt.owner ? this.db.players[killerEnt.owner] : null;
    // убийство NPC — награда
    if (t.npc) {
      if (t.belt && this.beltState[t.belt]) { const bs = this.beltState[t.belt]; bs.npcs.delete(t.id); (bs.losses = bs.losses || []).push(this.now); if (bs.losses.length > 10) bs.losses.shift(); }
      if (t.anom) this.anomNpcKilled(t, killerPlayer);
      if (killerPlayer) {
        const bounty = Math.round(NPCS[t.npc].bounty * (t.bountyMul || 1) * incomeOf(sysId));
        killerPlayer.credits += bounty;
        killerPlayer.stats.npcKills++;
        const ks = killerEnt.session;
        if (ks) { this.notify(ks, `Уничтожен ${NPCS[t.npc].name}. Награда: ${fmt(bounty)} CR`, 'good'); }
        for (const ms of killerPlayer.missions) {
          if (ms.type === 'kill' && ms.sys === sysId && ms.progress < ms.count) {
            ms.progress++;
            if (ms.progress >= ms.count) this.completeMission(killerPlayer, ms, ks);
          }
        }
        this.storyKill(killerPlayer, t, sysId);
        if (ks) this.sendProfile(ks);
      }
      return;
    }
    if (t.guardian) return;
    // уничтожение корабля игрока
    const p = this.db.players[t.owner];
    if (!p) return;
    for (const d of this.myDrones(t)) this.destroyDrone(d);
    p.ship.drones = {};
    p.stats.deaths++;
    if (killerPlayer && killerPlayer !== p) killerPlayer.stats.kills++;
    const lost = SHIPS[t.shipType];
    const insurance = Math.round(lost.price * 0.4);
    p.credits += insurance;
    const killerName = killerEnt ? (killerEnt.owner || killerEnt.name) : 'неизвестно';
    this.broadcastSys(sysId, { t: 'chat', ch: 'local', from: '*', text: `${p.name} (${lost.name}) уничтожен. Убийца: ${killerName}` });
    // возрождение на домашней станции в новом корабле
    const home = this.hangar(p, p.home);
    const spare = home.ships.shift();
    p.ship = spare || this.newShip('iskra', true);
    p.loc = { docked: p.home };
    const sess = t.session;
    if (sess) {
      sess.ent = null;
      sess.send({ t: 'destroyed', ship: lost.name, killer: killerName, insurance });
      this.enterStation(sess, p.home, true);
    }
    this.save(true);
  }

  mineYield(e, mod, def) {
    const t = this.ents.get(mod.target);
    if (!t || t.type !== 'asteroid' || !e.owner) return;
    if (this.surfaceDist(e, t) > def.range) return;
    const p = this.db.players[e.owner];
    const item = ITEMS[t.ore];
    const free = e.stats.cargo - this.cargoUsed(p.ship.cargo);
    let units = Math.floor(def.yield * e.stats.mineMul * incomeOf(e.sys) / item.vol);
    units = Math.min(units, t.amount, Math.floor(free / item.vol));
    if (units <= 0) {
      mod.active = false;
      if (e.session) this.notify(e.session, 'Трюм полон!', 'warn');
      return;
    }
    p.ship.cargo[t.ore] = (p.ship.cargo[t.ore] || 0) + units;
    p.stats.mined += units;
    t.amount -= units;
    if (e.session) { this.notify(e.session, `+${units} ${item.name}`, 'mine'); this.sendProfile(e.session); }
    if (t.amount <= 0) this.depleteAsteroid(t);
  }

  depleteAsteroid(t) {
    this.removeEntity(t);
    const bs = this.beltState[t.belt];
    const belt = this.U.celestials[t.belt];
    if (bs && belt) setTimeout(() => {
      if (this.beltAsteroids(belt.id).length >= bs.size) return; // пояс уже восполнен
      const a = makeAsteroid(belt, bs.r, bs.counter++); this.ents.set(a.id, a);
    }, 8 * 60000);
  }

  beltAsteroids(beltId) { return [...this.ents.values()].filter(a => a.type === 'asteroid' && a.belt === beltId); }

  // Полностью восстанавливает руду во всех поясах системы: выкопанные астероиды появляются заново, остальные наполняются до максимума
  refillBelts(sysId) {
    let restored = 0;
    for (const belt of this.U.systems[sysId].belts) {
      const bs = this.beltState[belt.id];
      const list = this.beltAsteroids(belt.id);
      for (const a of list) if (a.amount < a.maxAmount) { a.amount = a.maxAmount; restored++; }
      for (let i = list.length; i < bs.size; i++) { const a = makeAsteroid(belt, bs.r, bs.counter++); this.ents.set(a.id, a); restored++; }
    }
    return restored;
  }

  // --- Варп ---
  startAlignWarp(e, t, range, then) {
    const d = dist(e.pos, t.pos);
    if (d < MIN_WARP) return this.notify(e.session, 'Цель слишком близко для варпа (< 150 км)', 'warn');
    if (e.scrambledUntil > this.now) return this.notify(e.session, 'Варп-двигатель заблокирован глушителем!', 'bad');
    const landing = (t.landing || (t.radius || 0) + 2500) + range;
    const dir = norm(sub(t.pos, e.pos));
    const to = sub(t.pos, mul(dir, landing));
    e.cmd = { type: 'align', dir, to, target: t.id, then };
    e.speedFrac = 1;
    if (e.session) this.notify(e.session, `Разгон для варпа: ${t.name || '…'}`);
  }

  beginWarp(e) {
    const c = e.cmd;
    if (e.owner) this.scoopAll(e);
    this.clearLocks(e);
    for (const m of e.modules) if (m) m.active = false;
    const d = dist(e.pos, c.to);
    const dur = 3 + 3 * d / (e.stats.warpSpeed * AU) + Math.min(4, d / 2e7 * 0.1);
    e.warp = { from: e.pos.slice(), to: c.to, start: this.now, dur: dur * 1000, then: c.then, target: c.target };
    e.cmd = { type: 'stop' };
  }

  // ======================================================================
  // Главный цикл
  // ======================================================================
  tick(dt) {
    this.now = Date.now();
    const now = this.now;
    for (const e of this.ents.values()) {
      if (e.type === 'drone') { this.droneTick(e); if (this.ents.has(e.id)) this.physics(e, dt); continue; }
      if (e.type === 'missile') { this.missileTick(e, dt); continue; }
      if (e.type === 'turret') { this.turretTick(e); continue; }
      if (e.type !== 'ship') {
        if (e.type === 'wreck' && e.expires < now) this.removeEntity(e);
        continue;
      }
      if (e.logoffAt && !e.session) {
        if (e.logoffAt < now) { const p = this.db.players[e.owner]; if (p) { this.storeShipState(p, e); p.loc = { sys: e.sys, pos: e.pos.slice() }; } this.ents.delete(e.id); continue; }
        this.guardTick(e);
      }
      if (e.npc || e.guardian) this.aiTick(e, dt);
      else if (e.civ) this.civTick(e);
      this.physics(e, dt);
      // накопитель и щит
      const capFrac = e.cap / e.stats.cap;
      e.cap = Math.min(e.stats.cap, e.cap + e.stats.capRegen * dt * (0.4 + 1.2 * Math.sqrt(Math.max(0.01, 1 - capFrac))));
      const sf = e.shield / e.stats.shield;
      e.shield = Math.min(e.stats.shield, e.shield + e.stats.shield / 120 * dt * (0.3 + 2 * (Math.sqrt(Math.max(sf, 0.01)) - sf)) * (e.regenMul == null ? 1 : e.regenMul)); // regenMul — у боссов щит почти не восстанавливается
      // захват целей
      for (const [id, doneAt] of e.locking) {
        const t = this.ents.get(id);
        if (!t || t.sys !== e.sys || t.warp) { e.locking.delete(id); continue; }
        if (now >= doneAt) { e.locking.delete(id); e.locks.add(id); }
      }
      for (const id of e.locks) {
        const t = this.ents.get(id);
        if (!t || t.sys !== e.sys || t.warp || this.surfaceDist(e, t) > e.stats.lockRange * 1.15) {
          e.locks.delete(id);
          for (const m of e.modules) if (m && m.target === id) m.active = false;
        }
      }
      // остывание орудий
      if (e.owner && e.heat) { const hs = SHIPS[e.shipType].slots.high || 1; e.heat = Math.max(0, e.heat - (4 + 2.2 * hs) * 100 / (100 + 25 * hs) * dt); }
      // модули
      for (const m of e.modules) {
        if (!m || !m.cycleEnd) continue;
        if (now >= m.cycleEnd) { m.cycleEnd = 0; this.endCycle(e, m); }
      }
    }
    this.npcSpawns();
    this.anomTick();
    this.blackTick();
    this.eventsTick();
    if (!this._slow || now - this._slow > 1000) { this._slow = now; this.slowTick(); }
    this.broadcastState();
  }

  physics(e, dt) {
    const now = this.now;
    if (e.warp) {
      const w = e.warp;
      const t = clamp((now - w.start) / w.dur, 0, 1);
      const s = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const prev = e.pos;
      e.pos = lerp(w.from, w.to, s);
      e.vel = mul(sub(e.pos, prev), 1 / dt);
      if (t >= 1) {
        e.warp = null;
        e.vel = mul(norm(sub(w.to, w.from)), e.stats.maxSpeed * 0.3);
        e.cmd = { type: 'stop' };
        if (w.then && w.target) e.cmd = { type: w.then, target: w.target };
        if (e.session) e.session.player.loc = { sys: e.sys, pos: e.pos };
      }
      return;
    }
    let maxSpeed = e.stats.maxSpeed * (e.npcSpeedMul || 1);
    if (e.owner && e.hull < e.stats.hull * 0.35) maxSpeed *= 0.7; // повреждённые двигатели
    for (const m of e.modules) if (m && m.active && MODULES[m.id].kind === 'prop') maxSpeed *= 1 + MODULES[m.id].speedBonus;
    if (e.cmd.type === 'manual') return this.manualPhysics(e, dt, maxSpeed);
    let dir = null, speed = maxSpeed * e.speedFrac;
    const c = e.cmd;
    const tgt = c.target ? this.findTarget(e, c.target) : null;
    if (c.target && !tgt) e.cmd = { type: 'stop' };
    switch (c.type) {
      case 'stop': speed = 0; break;
      case 'dir': dir = c.dir; break;
      case 'align': {
        dir = c.dir; speed = maxSpeed;
        const vAlong = dot(e.vel, dir);
        if (vAlong >= maxSpeed * 0.75 && dot(norm(e.vel), dir) > 0.98) this.beginWarp(e);
        break;
      }
      case 'approach': case 'dock': case 'jump': {
        if (!tgt) break;
        const off = sub(tgt.pos, e.pos);
        const d = len(off) - (tgt.radius || 0) - e.radius;
        dir = norm(off);
        speed = Math.min(speed, Math.max(20, d * 0.8));
        if (c.type === 'approach' && d < 50) speed = 0;
        if (c.type === 'dock' && d <= DOCK_RANGE && e.session) { this.enterStation(e.session, tgt.id); return; }
        if (c.type === 'dock' && d <= DOCK_RANGE && e.civ) { const sysId = e.sys; this.civLeft(e, 'dock', tgt); this.removeEntity(e); this.sendLocalMembers(sysId); return; }
        if (c.type === 'jump' && d <= JUMP_RANGE) {
          if (e.civ) { const sysId = e.sys; this.fxSys(sysId, tgt.pos, { k: 'jump', pos: tgt.pos }); this.civLeft(e, 'jump', tgt); this.removeEntity(e); this.sendLocalMembers(sysId); return; }
          this.jump(e, tgt); return;
        }
        break;
      }
      case 'orbit': {
        if (!tgt) break;
        const off = sub(e.pos, tgt.pos);
        const d = len(off);
        const radial = norm(off);
        let up = [0, 1, 0];
        if (Math.abs(dot(up, radial)) > 0.95) up = [1, 0, 0];
        const tangent = norm(cross(up, radial));
        const want = c.range + (tgt.radius || 0);
        const corr = clamp((want - d) / (0.25 * c.range + 300), -2, 2);
        dir = norm(add(tangent, mul(radial, corr)));
        break;
      }
      case 'keep': {
        if (!tgt) break;
        const off = sub(tgt.pos, e.pos);
        const d = len(off) - (tgt.radius || 0) - e.radius;
        if (d > c.range * 1.05) { dir = norm(off); speed = Math.min(speed, (d - c.range) * 0.8 + 20); }
        else if (d < c.range * 0.9) dir = mul(norm(off), -1);
        else speed = 0;
        break;
      }
    }
    // поворот курса с инерцией (время разгона ~ align)
    if (dir) {
      const turn = 1 - Math.exp(-dt * 2.2 / Math.max(0.5, e.stats.align * 0.5));
      e.heading = norm(lerp(e.heading, dir, turn));
    }
    const desired = dir ? mul(e.heading, speed) : [0, 0, 0];
    const tau = e.stats.align / Math.log(4);
    const k = 1 - Math.exp(-dt / tau);
    e.vel = add(e.vel, mul(sub(desired, e.vel), k));
    e.pos = add(e.pos, mul(e.vel, dt));
    this.collideCelestials(e);
  }

  // Ручной полёт: нос следует за прицелом камеры, тяга вперёд/назад, боковая и вертикальная,
  // форсаж тратит накопитель. Стабилизация гасит снос; без неё корабль летит по инерции.
  manualPhysics(e, dt, maxSpeed) {
    const c = e.cmd, st = e.stats;
    if (c.dir) e.heading = norm(lerp(e.heading, c.dir, 1 - Math.exp(-dt * 3 / Math.max(0.4, st.align * 0.35))));
    let up = [0, 1, 0];
    if (Math.abs(dot(up, e.heading)) > 0.97) up = [1, 0, 0];
    const right = norm(cross(e.heading, up)), upv = cross(right, e.heading);
    let vmax = maxSpeed;
    if (c.boost && e.cap > st.cap * 0.05) { vmax *= 1.7; e.cap = Math.max(0, e.cap - st.cap * 0.07 * dt); }
    const thrust = add(add(mul(e.heading, c.thr), mul(right, c.sx * 0.6)), mul(upv, c.uy * 0.6));
    const tau = st.align / Math.log(4);
    if (c.stab) {
      const k = 1 - Math.exp(-dt / (c.brake ? tau * 0.5 : tau));
      e.vel = add(e.vel, mul(sub(mul(thrust, vmax), e.vel), k));
    } else {
      e.vel = add(e.vel, mul(thrust, vmax / tau * dt));
      if (c.brake) e.vel = mul(e.vel, Math.exp(-dt / (tau * 0.7))); // контртяга
      const sp = len(e.vel);
      if (sp > vmax) e.vel = mul(e.vel, vmax / sp);
    }
    e.pos = add(e.pos, mul(e.vel, dt));
    this.collideCelestials(e);
  }

  collideCelestials(e) {
    // не даём пролететь сквозь станции и планеты
    const sys = this.U.systems[e.sys];
    for (const cel of sys.celestials) {
      if (cel.kind !== 'station' && cel.kind !== 'planet' && cel.kind !== 'sun' && cel.kind !== 'gate') continue;
      const off = sub(e.pos, cel.pos);
      const d = len(off), minD = cel.radius * (cel.kind === 'gate' ? 0.6 : 1) + e.radius;
      if (d < minD) e.pos = add(cel.pos, mul(norm(off), minD));
    }
  }

  // ---------- NPC ----------
  npcSpawns() {
    if (this._spawnCheck && this.now - this._spawnCheck < 2000) return;
    this._spawnCheck = this.now;
    const occupied = new Set();
    for (const s of this.sessions) if (s.ent) occupied.add(s.ent.sys);
    this.civTraffic(occupied);
    this.aiMaterialize(occupied);
    this.outlawSpawns(occupied);
    for (const sysId of occupied) {
      const sys = this.U.systems[sysId];
      const sec = sys.def.sec;
      if (sec >= 0.8) continue;
      for (const b of sys.belts) {
        const bs = this.beltState[b.id];
        if (bs.npcs.size > 0 || this.now < bs.nextSpawn) continue;
        const group = [];
        if (sec >= 0.5) { for (let i = 0; i < 1 + (Math.random() < 0.5 ? 1 : 0); i++) group.push('raider'); }
        else if (sec > 0) { for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) group.push('raider'); if (Math.random() < 0.5) group.push('reaper'); if (Math.random() < 0.4) group.push('hunter'); if (Math.random() < 0.45) group.push('corsair'); }
        else if (sec <= -0.8) { group.push('warlord', 'reaper', 'corsair', 'corsair', 'hunter'); if (Math.random() < 0.25) group.push('dreadlord'); if (Math.random() < 0.2) group.push('brood'); }
        else { group.push('reaper', 'hunter', 'corsair'); if (Math.random() < 0.6) group.push('reaper'); group.push('raider', 'raider'); if (Math.random() < 0.2) group.push('warlord'); if (Math.random() < 0.08) group.push('brood'); if (Math.random() < 0.05) group.push('dreadlord'); }
        for (const type of group) {
          const e = this.spawnNpc(type, sysId, add(b.pos, [rnd(-15000, 15000), rnd(-3000, 3000), rnd(-15000, 15000)]));
          e.belt = b.id; e.home = b.pos;
          bs.npcs.add(e.id);
        }
        bs.nextSpawn = this.now + 120000 + Math.random() * 120000;
      }
    }
  }

  // ---------- Гражданский трафик: шахтёры, перевозчики, путешественники ----------
  civTraffic(occupied) {
    const bySys = {};
    for (const e of this.ents.values()) {
      if (!e.civ) continue;
      if (!occupied.has(e.sys)) { this.removeEntity(e); continue; }
      if (e.aiPilot) continue;
      bySys[e.sys] = (bySys[e.sys] || 0) + 1;
    }
    for (const sysId of occupied) {
      const sys = this.U.systems[sysId];
      const sec = sys.def.sec;
      const want = sys.def.hub ? 15 : sec >= 0.5 ? 10 : sec > 0 ? 6 : 3;
      if ((bySys[sysId] || 0) < want && Math.random() < 0.6) this.spawnCiv(sysId);
      // болтовня в локальном чате
      if ((bySys[sysId] || 0) > 0 && Math.random() < 0.025) {
        const civs = [...this.ents.values()].filter(e => e.civ && e.sys === sysId);
        const who = civs[Math.floor(Math.random() * civs.length)];
        const pool = sec >= 0.5 ? CIV_CHAT.safe : CIV_CHAT.danger;
        this.broadcastSys(sysId, { t: 'chat', ch: 'local', from: who.name, text: pool[Math.floor(Math.random() * pool.length)] });
      }
    }
  }

  outlawSpawns(occupied) {
    for (const sysId of occupied) {
      const sys = this.U.systems[sysId];
      if (sys.def.sec >= 0.5) continue;
      const have = [...this.ents.values()].filter(e => e.outlaw && e.sys === sysId).length;
      const want = sys.def.sec > 0 ? 2 : 3;
      if (have >= want || Math.random() > 0.15) continue;
      const g = sys.gates[Math.floor(Math.random() * sys.gates.length)];
      const pos = add(g.pos, [rnd(-8000, 8000), rnd(-2000, 2000), rnd(-8000, 8000)]);
      const ship = ['strizh', 'klinok', 'vihr', 'strazh', 'vihr', 'molot'][Math.floor(Math.random() * (sys.def.sec > 0 ? 4 : 6))];
      const name = CIV_NAMES[0][Math.floor(Math.random() * CIV_NAMES[0].length)] + ' «' + ['Гадюка', 'Ворон', 'Шрам', 'Палач', 'Тень', 'Клык', 'Призрак'][Math.floor(Math.random() * 7)] + '»';
      const e = this.spawnNpc('outlaw', sysId, pos, { ship, name });
      e.outlaw = true; e.nextRoam = this.now + 20000;
      // корабль-преступник крепче обычного пирата и платит награду по размеру
      const k = SHIPS[ship].radius > 100 ? 2.2 : SHIPS[ship].radius > 60 ? 1.4 : 1;
      e.stats.shield *= k; e.stats.armor *= k; e.stats.hull *= k; e.shield = e.stats.shield; e.armor = e.stats.armor; e.hull = e.stats.hull;
      e.bountyMul = k;
      this.fxSys(sysId, pos, { k: 'jump', pos });
    }
  }

  spawnCiv(sysId, opts = {}) {
    const sys = this.U.systems[sysId];
    const roll = Math.random();
    const role = opts.role || (sys.def.sec < 0.8 && Math.random() < 0.28 ? 'hunter' : roll < 0.4 && sys.belts.length ? 'miner' : roll < 0.75 ? 'hauler' : 'traveler');
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    let shipType = opts.shipType || (role === 'hunter' ? pick(['klinok', 'strazh', 'vihr', 'molot', 'piligrim', 'strizh', 'gonchaya', 'burevestnik']) : role === 'miner' ? pick(['burlak', 'burlak', 'staratel', 'staratel', 'iskra', 'leviafan', 'meduza'])
      : role === 'hauler' ? pick(['tyagach', 'tyagach', 'tyagach', 'kit', 'avrora'])
      : pick(['klinok', 'strazh', 'iskra', 'strizh', 'sokol', 'vihr', 'piligrim', 'molot', 'citadel', 'kometa', 'peleng']));
    if (!SHIPS[shipType]) shipType = 'iskra'; // корабли гильдий подключаются модулем newships
    // в регионах фракций часть пилотов летает на кораблях своей фракции
    let facTag = '';
    const fac = !opts.shipType && Object.keys(D.FACTION_INFO).find(f => D.FACTION_INFO[f].regions.includes(sys.def.region));
    if (fac && Math.random() < 0.4) {
      const roles = { hunter: ['combat', 'carrier'], miner: ['mining', 'explore'], hauler: ['transport'], traveler: null }[role];
      const line = Object.keys(SHIPS).filter(id => SHIPS[id].fac === fac && (!roles || roles.includes(SHIPS[id].role)) && (SHIPS[id].tier < 5 || Math.random() < 0.15));
      if (line.length) { shipType = pick(line); facTag = D.FACTION_INFO[fac].short + ': '; }
    }
    let pos, vel = [0, 0, 0];
    const fromStation = sys.stations.length && Math.random() < 0.6;
    if (fromStation) {
      const st = sys.stations[Math.floor(Math.random() * sys.stations.length)];
      pos = add(st.pos, mul(st.undock, st.radius + 1200));
      vel = mul(st.undock, 100);
    } else {
      const g = sys.gates[Math.floor(Math.random() * sys.gates.length)];
      pos = add(g.pos, [rnd(-6000, 6000), rnd(-1000, 1000), rnd(-6000, 6000)]);
      this.fxSys(sysId, pos, { k: 'jump', pos });
    }
    const t = SHIPS[shipType];
    const stats = this.calcStats(null, { type: shipType, fit: [] });
    const name = opts.name || (facTag + CIV_NAMES[0][Math.floor(Math.random() * CIV_NAMES[0].length)] + ' ' + CIV_NAMES[1][Math.floor(Math.random() * CIV_NAMES[1].length)]);
    const e = {
      id: 'civ_' + uid(), type: 'ship', civ: role, name, shipType, sys: sysId,
      pos, vel, heading: norm(vel[0] || vel[2] ? vel : [1, 0, 0]), stats, shield: stats.shield, armor: stats.armor, hull: stats.hull, cap: stats.cap,
      cmd: { type: 'stop' }, speedFrac: 0.6 + Math.random() * 0.4, modules: [], locks: new Set(), locking: new Map(), warp: null,
      scrambledUntil: 0, aggressors: new Map(), radius: t.radius, nextThink: this.now + 2000 + Math.random() * 4000, goal: null
    };
    this.ents.set(e.id, e);
    this.sendLocalMembers(sysId);
    return e;
  }

  civGoal(e) {
    const sys = this.U.systems[e.sys];
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    if (e.civ === 'hunter' && (e.kills || 0) < 4) {
      const hot = sys.belts.filter(b => this.beltState[b.id] && this.beltState[b.id].npcs.size);
      if (hot.length) return { type: 'hunt', target: pick(hot).id };
    }
    if (e.civ === 'miner' && !e.mined && sys.belts.length) return { type: 'mine', target: pick(sys.belts).id, cycles: 4 + Math.floor(Math.random() * 6) };
    if (sys.stations.length && Math.random() < 0.55) return { type: 'dock', target: pick(sys.stations).id };
    return { type: 'jump', target: pick(sys.gates).id };
  }

  civTick(e) {
    if (this.now < e.nextThink) return;
    e.nextThink = this.now + 1000;
    if (e.warp || e.cmd.type === 'align') return;
    if (!e.goal) e.goal = this.civGoal(e);
    const g = e.goal;
    const tgt = this.U.celestials[g.target];
    if (!tgt) { e.goal = null; return; }
    const far = dist(e.pos, tgt.pos) > MIN_WARP;
    if (g.type === 'dock' || g.type === 'jump') {
      if (far) this.startAlignWarp(e, tgt, 0, g.type);
      else if (e.cmd.type !== g.type) e.cmd = { type: g.type, target: tgt.id };
      return;
    }
    // охота: долететь до пояса с пиратами и сражаться
    if (g.type === 'hunt') {
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      if (far) { this.startAlignWarp(e, tgt, 0); return; }
      let prey = g.prey && this.ents.get(g.prey);
      if (!prey || prey.sys !== e.sys) {
        prey = [...this.ents.values()].filter(o => o.npc && o.sys === e.sys && dist(o.pos, e.pos) < 80000).sort((a, b) => dist(a.pos, e.pos) - dist(b.pos, e.pos))[0];
        if (!prey) { e.goal = null; e.kills = (e.kills || 0) + 1; return; }
        g.prey = prey.id;
        if (Math.random() < 0.3) this.broadcastSys(e.sys, { t: 'chat', ch: 'local', from: e.name, text: pick(['Беру пиратов в первом поясе, не мешайте.', 'Охота началась.', 'Ещё одна награда за голову — моя.', 'Скверна, вам здесь не рады.']) });
      }
      e.cmd = { type: 'orbit', target: prey.id, range: 6000 };
      if (this.surfaceDist(e, prey) < 18000 && (!g.next || this.now >= g.next)) {
        g.next = this.now + 2500;
        const hit = Math.random() < 0.8;
        this.fxSys(e.sys, null, { k: 'beam', from: e.id, to: prey.id, color: 0xffa040, hit, dur: 0.9 });
        if (hit) this.applyDamage(prey, rnd(45, 110) * (SHIPS[e.shipType].radius > 100 ? 2 : 1) * (1 + 0.3 * this.aiTier(e)), e);
        if (!this.ents.has(prey.id)) { g.prey = null; e.kills = (e.kills || 0) + 1; if (prey.npc) this.aiEarn(e, NPCS[prey.npc].bounty * incomeOf(e.sys)); }
      }
      return;
    }
    // добыча: долететь до пояса, подойти к астероиду, работать буром
    if (far) { this.startAlignWarp(e, tgt, 0); return; }
    let ast = g.ast && this.ents.get(g.ast);
    if (!ast) {
      const list = [...this.ents.values()].filter(a => a.type === 'asteroid' && a.belt === tgt.id);
      if (!list.length) { e.mined = true; e.goal = null; return; }
      ast = list[Math.floor(Math.random() * list.length)];
      g.ast = ast.id;
      e.cmd = { type: 'keep', target: ast.id, range: 2000 + Math.random() * 3000 };
    }
    if (this.surfaceDist(e, ast) < 9000 && (!g.nextCycle || this.now >= g.nextCycle)) {
      g.nextCycle = this.now + 6000;
      this.fxSys(e.sys, null, { k: 'mine', from: e.id, to: ast.id, color: 0x80ff90, dur: 6 });
      this.aiEarn(e, 60 * ITEMS[ast.ore].base / ITEMS[ast.ore].vol * incomeOf(e.sys) * (1 + this.aiTier(e)));
      if (--g.cycles <= 0) { e.mined = true; e.goal = null; }
    }
  }

  spawnNpc(type, sysId, pos, opts = {}) {
    const n = NPCS[type];
    const shipType = opts.ship || n.ship;
    const t = SHIPS[shipType];
    const stats = this.calcStats(null, { type: shipType, fit: [] });
    stats.shield *= n.hpMul; stats.armor *= n.hpMul; stats.hull *= n.hpMul;
    stats.lockTime = 2; stats.lockRange = 60000;
    const e = {
      id: 'npc_' + uid(), type: 'ship', npc: type, name: opts.name || n.name, shipType, sys: sysId,
      pos, vel: [0, 0, 0], heading: [1, 0, 0], stats, shield: stats.shield, armor: stats.armor, hull: stats.hull, cap: stats.cap * 10,
      cmd: { type: 'stop' }, speedFrac: 1, modules: Array.from({ length: n.guns }, () => ({ id: n.weapon, active: false, cycleEnd: 0, target: null })),
      locks: new Set(), locking: new Map(), warp: null, scrambledUntil: 0, aggressors: new Map(), radius: t.radius,
      npcDmgMul: n.dmgMul, npcSpeedMul: n.speedMul, nextThink: 0
    };
    e.stats.cap *= 10; e.stats.capRegen *= 10;
    this.ents.set(e.id, e);
    return e;
  }

  aiTick(e) {
    if (this.now < e.nextThink) return;
    e.nextThink = this.now + 500;
    if (e.guardian) return this.guardianTick(e);
    let t = e.npcTarget ? this.ents.get(e.npcTarget) : null;
    if (t && (t.sys !== e.sys || t.warp || dist(t.pos, e.pos) > 150000)) { t = null; e.npcTarget = null; e.locks.clear(); }
    if (!t) {
      let best = null, bd = 50000;
      for (const o of this.ents.values()) {
        if (o.type !== 'ship' || !o.owner || o.sys !== e.sys || o.warp) continue;
        if (o.invulnUntil && o.invulnUntil > this.now) continue;
        const d = dist(o.pos, e.pos);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) {
        e.npcTarget = best.id; t = best;
        if (e.outlaw && (!e.taunt || this.now - e.taunt > 120000)) {
          e.taunt = this.now;
          const msg = ['Твой трюм теперь мой, ' + best.name + '.', 'Ничего личного, просто бизнес.', 'Беги, ' + best.name + '. Если успеешь.', 'Здесь нет Стражей. Только я.', 'Отличный корабль. Был.'];
          this.broadcastSys(e.sys, { t: 'chat', ch: 'local', from: e.name, text: msg[Math.floor(Math.random() * msg.length)] });
        }
      }
    }
    if (!t) {
      for (const m of e.modules) m.active = false;
      if (e.outlaw && !e.warp && this.now > (e.nextRoam || 0)) {
        // преступник бродит по системе: пояса, врата, станции
        e.nextRoam = this.now + 40000 + Math.random() * 50000;
        const sys = this.U.systems[e.sys];
        const spots = [...sys.belts, ...sys.gates, ...sys.stations].filter(c => dist(c.pos, e.pos) > MIN_WARP);
        if (spots.length) { this.startAlignWarp(e, spots[Math.floor(Math.random() * spots.length)], 15000 + Math.random() * 20000); return; }
      }
      if (e.cmd.type === 'align') return;
      if (e.home && dist(e.pos, e.home) > 30000) e.cmd = { type: 'dir', dir: norm(sub(e.home, e.pos)) };
      else if (e.cmd.type !== 'orbit') { e.cmd = { type: 'stop' }; }
      return;
    }
    const def0 = MODULES[e.modules[0].id], def = def0.kind === 'launcher' ? { optimal: def0.range * 0.6, falloff: def0.range * 0.3 } : def0; // ракетчики держат дистанцию
    if (e.cmd.type !== 'orbit' || e.cmd.target !== t.id) e.cmd = { type: 'orbit', target: t.id, range: def.optimal * 0.6 };
    if (!e.locks.has(t.id) && !e.locking.has(t.id)) e.locking.set(t.id, this.now + 2500);
    if (e.locks.has(t.id)) {
      for (const m of e.modules) {
        if (!m.active && this.surfaceDist(e, t) < def.optimal + def.falloff) {
          m.target = t.id; m.active = true;
          if (this.now >= m.cycleEnd) this.startCycle(e, m);
        }
      }
    }
  }

  guardianTick(e) {
    const t = this.ents.get(e.npcTarget);
    if (!t || t.sys !== e.sys) { if (this.now > e.despawnAt) this.removeEntity(e); return; }
    e.cmd = { type: 'orbit', target: t.id, range: 3000 };
    if (this.now > e.strikeAt && !t.warp) {
      this.fxSys(e.sys, null, { k: 'beam', from: e.id, to: t.id, color: 0x80c0ff, hit: true, dur: 1.5 });
      t.invulnUntil = 0;
      this.applyDamage(t, 1e7, e);
    }
  }

  spawnGuardian(target) {
    const pos = add(target.pos, [rnd(-4000, 4000), rnd(-1000, 1000), rnd(-4000, 4000)]);
    const stats = this.calcStats(null, { type: 'molot', fit: [] });
    stats.shield = stats.armor = stats.hull = 1e9;
    stats.maxSpeed = 3000;
    const e = {
      id: 'gd_' + uid(), type: 'ship', guardian: true, name: 'Страж порядка', shipType: 'molot', sys: target.sys,
      pos, vel: [0, 0, 0], heading: [1, 0, 0], stats, shield: 1e9, armor: 1e9, hull: 1e9, cap: 1e9,
      cmd: { type: 'stop' }, speedFrac: 1, modules: [], locks: new Set(), locking: new Map(), warp: null, scrambledUntil: 0,
      aggressors: new Map(), radius: 160, npcTarget: target.id, strikeAt: this.now + 4000, despawnAt: this.now + 30000, nextThink: 0
    };
    target.scrambledUntil = this.now + 30000;
    this.ents.set(e.id, e);
    this.fxSys(e.sys, pos, { k: 'jump', pos });
  }

  // Раз в секунду: навыки, стражи, обновление профилей
  slowTick() {
    this.structTick();
    this.foundryTick();
    this.storyTick();
    this.contractTick();
    this.infraTick();
    this.piratesSlowTick();
    this.pbasesSlowTick();
    this.botTick();
    this.autoTick();
    this.aiEconomyTick();
    for (const s of this.sessions) {
      const p = s.player;
      if (this.checkSkills(p)) this.sendProfile(s);
      const e = s.ent;
      this.scanTick(s);
      this.triggerAnomalies(s);
      if (e && !e.warp && p.criminalUntil > this.now && this.U.byId[e.sys].sec >= 0.5) {
        const hunted = [...this.ents.values()].some(o => o.guardian && o.npcTarget === e.id);
        if (!hunted) this.spawnGuardian(e);
      }
      // автопилот
      if (e && e.autopilot && !e.warp && e.cmd.type !== 'align' && e.cmd.type !== 'jump') {
        if (e.sys === e.autopilot.dest) { e.autopilot = null; this.notify(s, 'Автопилот: прибытие в пункт назначения', 'good'); }
        else {
          const r = route(this.U.neighbors, e.sys, e.autopilot.dest);
          const gate = r && this.U.systems[e.sys].gates.find(g => g.dest === r[1]);
          if (gate) {
            if (dist(e.pos, gate.pos) > MIN_WARP) { const ap = e.autopilot; this.startAlignWarp(e, gate, 0, 'jump'); e.autopilot = ap; }
            else e.cmd = { type: 'jump', target: gate.id };
          }
        }
      }
    }
  }

  checkSkills(p) {
    if (p.training && this.now >= p.training.end) {
      p.skills[p.training.skill] = p.training.level;
      const msg = `Навык «${SKILLS[p.training.skill].name}» изучен до уровня ${p.training.level}`;
      p.training = null;
      for (const s of this.sessions) if (s.player === p) {
        this.notify(s, msg, 'good');
        if (s.ent) { const st = this.calcStats(p, p.ship); s.ent.stats = st; }
      }
      return true;
    }
    return false;
  }

  // ======================================================================
  // Станционные сервисы
  // ======================================================================
  requireDocked(s) {
    if (!s.docked) { this.notify(s, 'Нужно находиться на станции', 'warn'); return null; }
    return s.docked;
  }

  priceOf(stationId, item) { return Math.round(ITEMS[item].base * ((this.prices[stationId] || {})[item] || 1)); }
  buyPriceOf(stationId, item) {
    const hub = this.U.byId[this.U.celestials[stationId].sys].hub;
    return Math.round(ITEMS[item].base * (hub ? 1 : 1.1));
  }

  c_market(s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const sell = {}, buy = {};
    for (const id of Object.keys(ITEMS)) if (!ITEMS[id].noSell) sell[id] = Math.round(this.priceOf(st, id) * (ITEMS[id].resale || 1));
    for (const id of Object.keys(MODULES)) if (!MODULES[id].elite && MODULES[id].lv === 1) buy[id] = this.buyPriceOf(st, id);
    const ships = {};
    for (const [id, t] of Object.entries(SHIPS)) if (t.price > 0) ships[id] = Math.round(t.price * (this.U.byId[this.U.celestials[st].sys].hub ? 1 : 1.1));
    const tax = Math.max(0, BASE_TAX - 0.01 * (p.skills.trade || 0));
    const orders = this.db.orders.map(o => ({ ...o, stationName: this.U.celestials[o.station].name, sysName: this.U.byId[this.U.celestials[o.station].sys].name }));
    const drones = {};
    for (const id of Object.keys(DRONES)) if (!DRONES[id].elite) drones[id] = this.buyPriceOf(st, id);
    s.send({ t: 'market', sell, buy, drones, ships, tax, orders, cell: this.buyPriceOf(st, 'energy_cell'),
      consumables: Object.fromEntries(Object.keys(ITEMS).filter(id => ITEMS[id].consumable).map(id => [id, this.buyPriceOf(st, id)])) });
  }

  c_sell(s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const h = this.hangar(p, st);
    const item = m.item, qty = Math.floor(+m.qty);
    if (!ITEMS[item] || ITEMS[item].noSell || !(qty > 0) || (h.items[item] || 0) < qty) return this.notify(s, 'Нет такого количества в ангаре', 'warn');
    const unit = Math.round(this.priceOf(st, item) * (ITEMS[item].resale || 1));
    const tax = Math.max(0, BASE_TAX - 0.01 * (p.skills.trade || 0));
    const total = Math.round(unit * qty * (1 - tax));
    h.items[item] -= qty; if (!h.items[item]) delete h.items[item];
    p.credits += total;
    this.notify(s, `Продано: ${ITEMS[item].name} ×${qty} за ${fmt(total)} CR`, 'good');
    this.sendProfile(s); this.c_market(s, m, p);
  }

  c_buy(s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const qty = clamp(Math.floor(+m.qty) || 1, 1, 10000); // отрицательное количество не должно превращать покупку в доход
    if (ITEMS[m.item] && ITEMS[m.item].elite) return this.notify(s, 'Этот товар продаётся только на чёрном рынке', 'warn');
    if (MODULES[m.item] && MODULES[m.item].lv > 1) return this.notify(s, 'Улучшенные модули не продаются — улучшайте свои во вкладке «Оснастка»', 'warn');
    if (MODULES[m.item] || DRONES[m.item]) {
      const cost = this.buyPriceOf(st, m.item) * qty;
      if (p.credits < cost) return this.notify(s, 'Недостаточно CR', 'warn');
      p.credits -= cost;
      const h = this.hangar(p, st);
      h.items[m.item] = (h.items[m.item] || 0) + qty;
      // дроны сразу попадают в отсек, если там есть место
      const toBay = DRONES[m.item] ? this.moveToBay(p, h.items, m.item, qty) : 0;
      this.notify(s, `Куплено: ${ITEMS[m.item].name} ×${qty}` + (toBay ? (toBay === qty ? ' — загружено в отсек дронов' : ` — ${toBay} в отсек, остальные в ангар`) : ''), 'good');
    } else if (SHIPS[m.item] && SHIPS[m.item].price > 0) {
      const T = SHIPS[m.item];
      if (T.unique && this.ownsShip(p, m.item)) return this.notify(s, `«${T.name}» — уникальный корабль: у пилота может быть только один`, 'warn');
      const cost = Math.round(T.price * (this.U.byId[this.U.celestials[st].sys].hub ? 1 : 1.1));
      if (p.credits < cost) return this.notify(s, 'Недостаточно CR', 'warn');
      p.credits -= cost;
      // уникальный корабль приходит полностью оснащённым: модули, дроны в ангаре, боезапас
      const ship = this.newShip(m.item, !!T.kit);
      if (T.kit) { Object.assign(ship.drones, T.kit.drones || {}); Object.assign(ship.cargo, T.kit.cargo || {}); }
      this.hangar(p, st).ships.push(ship);
      this.notify(s, `Куплен корабль «${SHIPS[m.item].name}». Он в ангаре.`, 'good');
      if (m.board) { this.sendProfile(s); return this.c_board(s, { uid: ship.uid }, p); }
    } else return;
    this.sendProfile(s); this.save();
  }

  c_board(s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const h = this.hangar(p, st);
    const i = h.ships.findIndex(x => x.uid === m.uid);
    if (i < 0) return;
    const req = SHIPS[h.ships[i].type].req || {};
    const miss = Object.entries(req).filter(([sk, lv]) => (p.skills[sk] || 0) < lv);
    if (miss.length) return this.notify(s, 'Не хватает навыков: ' + miss.map(([sk, lv]) => `${SKILLS[sk].name} ${lv}`).join(', '), 'warn');
    const next = h.ships.splice(i, 1)[0];
    h.ships.push(p.ship);
    p.ship = next;
    this.notify(s, `Вы пересели в «${SHIPS[next.type].name}»`, 'good');
    this.sendProfile(s);
  }

  ownsShip(p, type) {
    if (p.ship && p.ship.type === type) return true;
    return Object.values(p.hangars || {}).some(h => (h.ships || []).some(x => x.type === type));
  }

  c_fit(s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const h = this.hangar(p, st);
    const idx = m.slot | 0, item = m.item;
    if (idx < 0 || idx >= p.ship.fit.length || !MODULES[item] || !(h.items[item] > 0)) return;
    if (MODULES[item].only && MODULES[item].only !== p.ship.type) return this.notify(s, `«${MODULES[item].name}» ставится только на «${SHIPS[MODULES[item].only].name}»`, 'warn');
    if (MODULES[item].slot !== this.slotType(p.ship.type, idx)) return this.notify(s, 'Модуль не подходит к этому слоту', 'warn');
    const old = p.ship.fit[idx];
    if (old) h.items[old] = (h.items[old] || 0) + 1;
    h.items[item]--; if (!h.items[item]) delete h.items[item];
    p.ship.fit[idx] = item;
    this.sendProfile(s);
  }

  // Улучшение модуля на станции: установленного (slot) или лежащего в ангаре (item).
  // Материалы берутся из ангара станции и трюма; недостающие можно докупить (buyMissing) с наценкой.
  c_upgradeModule(s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const h = this.hangar(p, st);
    const fitted = m.slot !== undefined && m.slot !== null;
    const idx = m.slot | 0, id = fitted ? p.ship.fit[idx] : m.item;
    if (!id || !MODULES[id] || (!fitted && !(h.items[id] > 0)) || (fitted && (idx < 0 || idx >= p.ship.fit.length))) return;
    const c = D.upgradeCost(id);
    if (!c) return this.notify(s, 'Модуль уже на максимальном уровне', 'warn');
    let missingCost = 0;
    const missing = {};
    for (const [it, q] of Object.entries(c.mats)) {
      const have = (h.items[it] || 0) + (p.ship.cargo[it] || 0);
      if (have < q) { missing[it] = q - have; missingCost += Math.ceil((q - have) * ITEMS[it].base * D.MOD_UPGRADE.buyMarkup); }
    }
    if (missingCost && !m.buyMissing) return this.notify(s, 'Не хватает материалов — докупите их или привезите со своего завода', 'warn');
    const total = c.isk + missingCost;
    if (p.credits < total) return this.notify(s, `Недостаточно CR: нужно ${fmt(total)}`, 'warn');
    // всё проверено — списываем одной операцией
    p.credits -= total;
    for (const [it, q] of Object.entries(c.mats)) {
      let need = q - (missing[it] || 0);
      const fromH = Math.min(need, h.items[it] || 0); h.items[it] = (h.items[it] || 0) - fromH; need -= fromH; if (!h.items[it]) delete h.items[it];
      if (need) { p.ship.cargo[it] -= need; if (!p.ship.cargo[it]) delete p.ship.cargo[it]; }
    }
    if (fitted) p.ship.fit[idx] = c.next;
    else { h.items[id]--; if (!h.items[id]) delete h.items[id]; h.items[c.next] = (h.items[c.next] || 0) + 1; }
    this.notify(s, `${MODULES[D.modBase(id)].name} улучшен до уровня ${c.level}! Списано ${fmt(total)} CR`, 'good');
    this.sendProfile(s); this.save();
  }

  c_unfit(s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const idx = m.slot | 0;
    const old = p.ship.fit[idx];
    if (!old) return;
    const h = this.hangar(p, st);
    h.items[old] = (h.items[old] || 0) + 1;
    p.ship.fit[idx] = null;
    this.sendProfile(s);
  }

  c_unload(s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const h = this.hangar(p, st);
    for (const [id, q] of Object.entries(p.ship.cargo)) {
      if (m.item && m.item !== id) continue;
      h.items[id] = (h.items[id] || 0) + q; delete p.ship.cargo[id];
    }
    this.sendProfile(s);
  }

  c_load(s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const h = this.hangar(p, st);
    const item = m.item;
    if (!ITEMS[item] || !h.items[item]) return;
    const stats = this.calcStats(p, p.ship);
    const free = stats.cargo - this.cargoUsed(p.ship.cargo);
    const qty = Math.min(h.items[item], Math.floor(+m.qty) || h.items[item], Math.floor(free / ITEMS[item].vol + 1e-9));
    if (qty <= 0) return this.notify(s, 'Не хватает места в трюме', 'warn');
    h.items[item] -= qty; if (!h.items[item]) delete h.items[item];
    p.ship.cargo[item] = (p.ship.cargo[item] || 0) + qty;
    this.sendProfile(s);
  }

  c_jettison(s, m, p, e) {
    const q = p.ship.cargo[m.item];
    if (!q) return;
    delete p.ship.cargo[m.item];
    if (e) {
      const w = { id: 'wr_' + uid(), type: 'wreck', sys: e.sys, pos: add(e.pos, [0, -200, 0]), vel: [0, 0, 0], radius: 30, name: `Контейнер (${p.name})`, items: { [m.item]: q }, expires: this.now + 30 * 60000 };
      this.ents.set(w.id, w);
    }
    this.sendProfile(s);
  }

  c_loot(s, m, p, e) {
    if (!e) return;
    const w = this.ents.get(m.id);
    if (!w || w.type !== 'wreck' || w.sys !== e.sys) return;
    if (this.surfaceDist(e, w) > LOOT_RANGE) { e.cmd = { type: 'approach', target: w.id }; return this.notify(s, 'Подлетаем к обломкам…'); }
    let free = e.stats.cargo - this.cargoUsed(p.ship.cargo);
    const got = [];
    for (const [id, q] of Object.entries(w.items)) {
      const n = Math.min(q, Math.floor(free / ITEMS[id].vol + 1e-9));
      if (n <= 0) continue;
      p.ship.cargo[id] = (p.ship.cargo[id] || 0) + n;
      free -= n * ITEMS[id].vol;
      w.items[id] -= n; if (!w.items[id]) delete w.items[id];
      got.push(`${ITEMS[id].name} ×${n}`);
    }
    if (got.length) this.notify(s, 'Подобрано: ' + got.join(', '), 'good');
    else this.notify(s, 'Нет места в трюме', 'warn');
    if (!Object.keys(w.items).length) this.removeEntity(w);
    this.sendProfile(s);
  }

  c_sethome(s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    p.home = st;
    this.notify(s, 'Станция назначена домашней (клон-станция)', 'good');
    this.sendProfile(s);
  }

  // --- Биржа между игроками ---
  c_placeOrder(s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const h = this.hangar(p, st);
    const qty = Math.floor(+m.qty), price = Math.floor(+m.price);
    if (!ITEMS[m.item] || ITEMS[m.item].noSell || !(qty > 0) || !(price > 0) || (h.items[m.item] || 0) < qty) return this.notify(s, 'Неверный ордер', 'warn');
    if (this.db.orders.filter(o => o.seller === p.name).length >= 20) return this.notify(s, 'Максимум 20 ордеров', 'warn');
    h.items[m.item] -= qty; if (!h.items[m.item]) delete h.items[m.item];
    this.db.orders.push({ id: uid(), seller: p.name, station: st, item: m.item, qty, price, created: this.now });
    this.notify(s, 'Ордер на продажу выставлен', 'good');
    this.sendProfile(s); this.c_market(s, m, p); this.save();
  }

  c_cancelOrder(s, m, p) {
    const i = this.db.orders.findIndex(o => o.id === m.id && o.seller === p.name);
    if (i < 0) return;
    const o = this.db.orders.splice(i, 1)[0];
    const h = this.hangar(p, o.station);
    h.items[o.item] = (h.items[o.item] || 0) + o.qty;
    this.notify(s, 'Ордер снят, товар возвращён в ангар станции ' + this.U.celestials[o.station].name);
    this.sendProfile(s); if (s.docked) this.c_market(s, m, p); this.save();
  }

  c_buyOrder(s, m, p) {
    const o = this.db.orders.find(x => x.id === m.id);
    if (!o) return this.notify(s, 'Ордер уже исполнен', 'warn');
    if (o.seller === p.name) return;
    const qty = Math.min(o.qty, clamp(Math.floor(+m.qty) || 1, 1, 1e9));
    const cost = qty * o.price;
    if (p.credits < cost) return this.notify(s, 'Недостаточно CR', 'warn');
    p.credits -= cost;
    const seller = this.db.players[o.seller];
    if (seller) {
      seller.credits += Math.round(cost * (1 - Math.max(0, BASE_TAX - 0.01 * (seller.skills.trade || 0))));
      for (const ss of this.sessions) if (ss.player === seller) { this.notify(ss, `Продано по ордеру: ${ITEMS[o.item].name} ×${qty} → ${p.name}`, 'good'); this.sendProfile(ss); }
    }
    const h = this.hangar(p, o.station);
    h.items[o.item] = (h.items[o.item] || 0) + qty;
    o.qty -= qty;
    if (o.qty <= 0) this.db.orders.splice(this.db.orders.indexOf(o), 1);
    this.notify(s, `Куплено ${ITEMS[o.item].name} ×${qty}. Товар на станции ${this.U.celestials[o.station].name}`, 'good');
    this.sendProfile(s); if (s.docked) this.c_market(s, m, p); this.save();
  }

  // --- Навыки ---
  c_train(s, m, p) {
    const sk = m.skill;
    if (!SKILLS[sk]) return;
    const lvl = (p.skills[sk] || 0) + 1;
    if (lvl > 5) return this.notify(s, 'Навык уже изучен до максимума', 'warn');
    p.training = { skill: sk, level: lvl, start: this.now, end: this.now + SKILL_TIME[lvl] * 1000 };
    this.notify(s, `Начато изучение: ${SKILLS[sk].name} ${lvl}`, 'good');
    this.sendProfile(s);
  }

  // --- Агенты и миссии ---
  missionBoard(stationId) {
    let b = this.missionBoards[stationId];
    if (b && b.until > this.now) return b;
    const sysId = this.U.celestials[stationId].sys;
    const offers = [];
    // ближайшие системы для заданий
    const near = Object.keys(this.U.systems).filter(id => !this.U.byId[id].wormhole).map(id => ({ id, r: route(this.U.neighbors, sysId, id) })).filter(x => x.r && x.r.length <= 5);
    const hostile = near.filter(x => this.U.byId[x.id].sec < 0.8);
    for (let i = 0; i < 4; i++) {
      if (i % 2 === 0 && hostile.length) {
        const tgt = hostile[Math.floor(Math.random() * hostile.length)];
        const sec = this.U.byId[tgt.id].sec;
        const count = 2 + Math.floor(Math.random() * 4);
        const reward = Math.round(count * 9000 * incomeOf(tgt.id) * (1 + 0.2 * (tgt.r.length - 1)));
        offers.push({ id: uid(), type: 'kill', sys: tgt.id, count, progress: 0, reward,
          title: `Зачистка: ${this.U.byId[tgt.id].name}`, text: `Уничтожьте ${count} пиратских кораблей в системе ${this.U.byId[tgt.id].name} (${sec.toFixed(1)}).` });
      } else {
        const dests = Object.values(this.U.celestials).filter(c => c.kind === 'station' && c.id !== stationId && near.some(n => n.id === c.sys));
        if (!dests.length) continue;
        const d = dests[Math.floor(Math.random() * dests.length)];
        const jumps = near.find(n => n.id === d.sys).r.length - 1;
        const sec = this.U.byId[d.sys].sec;
        const reward = Math.round((6000 + jumps * 9000) * incomeOf(d.sys));
        offers.push({ id: uid(), type: 'courier', dest: d.id, reward, from: stationId,
          title: `Доставка: ${this.U.byId[d.sys].name}`, text: `Доставьте опечатанный контейнер (5 м³) на станцию «${d.name}» (${jumps} прыжк.).` });
      }
    }
    b = { offers, until: this.now + 15 * 60000 };
    this.missionBoards[stationId] = b;
    return b;
  }

  c_agents(s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    s.send({ t: 'agents', offers: this.missionBoard(st).offers });
  }

  c_acceptMission(s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    if (p.missions.length >= 3) return this.notify(s, 'Не более трёх активных заданий', 'warn');
    const b = this.missionBoard(st);
    const i = b.offers.findIndex(o => o.id === m.id);
    if (i < 0) return;
    const ms = b.offers.splice(i, 1)[0];
    if (ms.type === 'courier') {
      const h = this.hangar(p, st);
      h.items.courier_pack = (h.items.courier_pack || 0) + 1;
      ms.pack = true;
      this.notify(s, 'Контейнер помещён в ангар. Загрузите его в трюм перед вылетом.', 'good');
    }
    p.missions.push(ms);
    this.notify(s, `Задание принято: ${ms.title}`, 'good');
    this.sendProfile(s); this.c_agents(s, m, p);
  }

  c_abandonMission(s, m, p) {
    const i = p.missions.findIndex(x => x.id === m.id);
    if (i >= 0) { p.missions.splice(i, 1); this.notify(s, 'Задание отменено'); this.sendProfile(s); }
  }

  checkCourier(s) {
    const p = s.player;
    for (const ms of [...p.missions]) {
      if (ms.type !== 'courier' || ms.dest !== s.docked) continue;
      const h = this.hangar(p, s.docked);
      if (p.ship.cargo.courier_pack > 0) { p.ship.cargo.courier_pack--; if (!p.ship.cargo.courier_pack) delete p.ship.cargo.courier_pack; }
      else if (h.items.courier_pack > 0) { h.items.courier_pack--; if (!h.items.courier_pack) delete h.items.courier_pack; }
      else continue;
      this.completeMission(p, ms, s);
    }
  }

  completeMission(p, ms, s) {
    p.missions = p.missions.filter(x => x !== ms);
    p.credits += ms.reward;
    if (s) { this.notify(s, `Задание выполнено: ${ms.title}. Награда ${fmt(ms.reward)} CR`, 'good'); this.sendProfile(s); }
  }

  // --- Чат ---
  c_chat(s, m, p) {
    const text = String(m.text || '').slice(0, 300).trim();
    if (!text) return;
    // команда разработчика: вызвать контрабандиста (только при запуске с VF_DEV=1)
    // /ship <тип> — пересесть на любой корабль в доке (только VF_DEV)
    if (text.startsWith('/ship ') && typeof process !== 'undefined' && process.env && process.env.VF_DEV) {
      const t = text.slice(6).trim(); if (SHIPS[t] && !s.ent) { p.ship = this.newShip(t, false); this.sendProfile(s); } return;
    }
    if (text === '/dealer' && typeof process !== 'undefined' && process.env && process.env.VF_DEV) { this.spawnDealer(this.playerSys(p)); return; }
    if (s.lastChat && this.now - s.lastChat < 700) return;
    s.lastChat = this.now;
    const msg = { t: 'chat', ch: m.ch === 'global' ? 'global' : 'local', from: p.name, text };
    if (msg.ch === 'global') for (const o of this.sessions) o.send(msg);
    else this.broadcastSys(this.playerSys(p), msg);
  }

  // ======================================================================
  // Рассылка состояния
  // ======================================================================
  notify(s, text, kind) { if (s) s.send({ t: 'note', text, kind: kind || 'info' }); }

  broadcastSys(sysId, msg) {
    for (const s of this.sessions) if (this.playerSys(s.player) === sysId) s.send(msg);
  }

  sendLocalMembers(sysId) {
    const members = [...this.sessions].filter(s => this.playerSys(s.player) === sysId).map(s => {
      const p = s.player;
      return { name: p.name, crim: p.criminalUntil > this.now, susp: p.suspectUntil > this.now };
    });
    for (const e of this.ents.values()) if (e.civ && e.sys === sysId) members.push({ name: e.name });
    this.broadcastSys(sysId, { t: 'local', members });
  }

  fxSys(sysId, pos, fx) {
    for (const s of this.sessions) {
      if (!s.ent || s.ent.sys !== sysId) continue;
      if (pos && dist(pos, s.ent.pos) > GRID_RANGE * 2) continue;
      (s.fx || (s.fx = [])).push(fx);
    }
  }

  sendProfile(s) {
    const p = s.player;
    const st = s.docked;
    const stats = this.calcStats(p, p.ship);
    s.send({
      t: 'profile',
      credits: p.credits, home: p.home, skills: p.skills, training: p.training, missions: p.missions, stats: p.stats,
      ship: p.ship, shipStats: stats, cargoUsed: this.cargoUsed(p.ship.cargo),
      hangar: st ? this.hangar(p, st) : null,
      assets: Object.entries(p.hangars).filter(([, h]) => Object.keys(h.items).length || h.ships.length)
        .map(([id, h]) => ({ station: id, name: this.U.celestials[id].name, items: h.items, ships: h.ships.map(x => x.type) })),
      story: this.storyView(p), rep: p.rep, difficulty: p.difficulty || 'normal', foundryOff: !!p.foundryOff, criminal: p.criminalUntil > this.now ? p.criminalUntil - this.now : 0,
      suspect: p.suspectUntil > this.now ? p.suspectUntil - this.now : 0,
      myOrders: this.db.orders.filter(o => o.seller === p.name)
    });
  }

  entView(o, viewer) {
    const v = { id: o.id, k: o.type[0], n: o.name, p: o.pos.map(x => Math.round(x * 10) / 10) };
    if (o.type === 'ship') {
      v.st = o.shipType; v.v = o.vel.map(x => Math.round(x)); v.h = o.heading.map(x => +x.toFixed(3));
      v.sh = +(o.shield / o.stats.shield).toFixed(3); v.ar = +(o.armor / o.stats.armor).toFixed(3); v.hu = +(o.hull / o.stats.hull).toFixed(3);
      v.r = o.radius;
      if (o.warp) v.w = 1;
      if (o.npc) v.npc = 1;
      if (o.outlaw) v.ol = 1;
      if (o.wingOf) v.wg = o.wingOf;   // напарник игрока
      if (o.war) v.wf = o.war;          // патруль фракции в войне
      if (o.guardian) v.gd = 1;
      if (o.relicGuard) v.rl = 1; // хранители аномалий Предтеч — свой облик
      if (o.civ) { v.civ = 1; v.o = o.name; }
      if (o.aiPilot) v.ai = 1;
      if (o.dealer) { v.dl = 1; v.o = o.name; v.exp = o.expires; }
      if (o.owner) {
        v.o = o.owner;
        const p = this.db.players[o.owner];
        if (p.bot) v.lb = 1; // ИИ-ученик
        if (p.criminalUntil > this.now) v.cr = 1; else if (p.suspectUntil > this.now) v.su = 1;
      }
      if (viewer && (o.locks.has(viewer.id) || o.locking.has(viewer.id))) v.tg = 1; // нацелен на вас
      if (o.modules.some(m => m && m.active && m.target === viewer.id && MODULES[m.id].kind === 'weapon')) v.ag = 1;
      { const wm = o.modules.find(m => m && m.active && m.target && MODULES[m.id].kind === 'weapon'); const at = wm ? wm.target : o.npc && o.npcTarget ? o.npcTarget : o.fightUntil > this.now ? o.fightAt : null; if (at) v.at = at; } // для тактического обзора
    } else if (o.type === 'asteroid') {
      v.ore = o.ore; v.r = o.radius; v.am = o.amount; v.sd = o.seed;
    } else if (o.type === 'drone') {
      v.v = o.vel.map(x => Math.round(x)); v.h = o.heading.map(x => +x.toFixed(3));
      v.hu = +(o.hull / o.stats.hull).toFixed(3); v.r = o.radius; v.o = o.owner; v.item = o.item; v.task = o.task;
    } else if (o.type === 'wreck') {
      v.r = o.radius;
      v.items = o.items;
      if (o.relic) { v.rv = o.relic; if (o.sealed) v.sl = 1; }
    }
    return v;
  }

  broadcastState() {
    for (const s of this.sessions) {
      const e = s.ent;
      if (!e) { if (s.fx) s.fx = null; continue; }
      const ents = [];
      for (const o of this.ents.values()) {
        if (o.sys !== e.sys || o === e) continue;
        if (dist(o.pos, e.pos) > GRID_RANGE && !(o.type === 'ship' && o.warp)) continue;
        if (o.type === 'ship' && o.warp && dist(o.pos, e.pos) > GRID_RANGE * 20) continue;
        ents.push(this.entView(o, e));
      }
      const me = {
        id: e.id, p: e.pos, v: e.vel, h: e.heading, st: e.shipType,
        sh: e.shield, ar: e.armor, hu: e.hull, cap: e.cap,
        max: { sh: e.stats.shield, ar: e.stats.armor, hu: e.stats.hull, cap: e.stats.cap, spd: e.stats.maxSpeed },
        speedFrac: e.speedFrac, cmd: { type: e.cmd.type, target: e.cmd.target, range: e.cmd.range },
        warp: e.warp ? { to: e.warp.to, prog: (this.now - e.warp.start) / e.warp.dur } : null,
        locks: [...e.locks], locking: [...e.locking].map(([id, t]) => [id, t]),
        mods: e.modules.map(m => m ? { id: m.id, a: m.active, s: m.cycleStart || 0, e: m.cycleEnd, t: m.target, d: m.damagedUntil > this.now ? m.damagedUntil : 0 } : null),
        heat: Math.round(e.heat || 0), oh: e.overheatUntil > this.now ? e.overheatUntil : 0, eng: e.hull < e.stats.hull * 0.35 ? 1 : 0,
        scram: e.scrambledUntil > this.now, ap: e.autopilot ? e.autopilot.dest : null,
        msl: [...this.ents.values()].filter(x => x.type === 'missile' && x.target === e.id).length, dm: e.droneMode || s.player.droneMode || 'defensive',
        invuln: e.invulnUntil > this.now,
        scan: e.scanUntil > this.now ? (this.now - e.scanStart) / (e.scanUntil - e.scanStart) : null
      };
      const msg = { t: 'state', now: this.now, me, ents };
      if (s.fx && s.fx.length) { msg.fx = s.fx; s.fx = null; }
      s.send(msg);
    }
  }
}

const CIV_NAMES = [
  ['Арс', 'Вега', 'Дан', 'Кира', 'Лео', 'Мира', 'Ник', 'Ольга', 'Рэй', 'Тэо', 'Юна', 'Зар', 'Ирма', 'Сол', 'Тарас', 'Ева', 'Гор', 'Лана', 'Марк', 'Нора'],
  ['Корвин', 'Стрельцов', 'Ноэль', 'Варга', 'Айхен', 'Мерк', 'Ростов', 'Кейн', 'Орлова', 'Тайри', 'Векс', 'Лунд', 'Сато', 'Белых', 'Драгер', 'Рейн']
];
const CIV_CHAT = {
  safe: [
    'Кто-нибудь продаёт Корундит? Беру оптом на Арктуре.', 'Ферит опять подешевел, эх…', 'Летим колонной на Кассиопу, кто с нами?',
    'Ищу корпорацию для добычи, опыт есть.', 'Поясная пустота сегодня… все в лоу ушли?', 'Новички, не летайте в 0.4 на «Искре» :)',
    'Спасибо Стражам за спокойную смену.', 'Курьерские задания на Велле хорошо платят, советую.', 'Кто видел цены на «Бурлак»?',
    'Отличный вид на газовый гигант из второго пояса.', 'Продам Импульсный лазер М1, недорого.', 'о7'
  ],
  danger: [
    'Осторожно, на вратах дежурят пираты.', 'В первом поясе Жнецы, не суйтесь в одиночку.', 'Кто-то видел «Молот» без опознавательных знаков?',
    'Нуллий здесь хороший, но долго не задерживайтесь.', 'Ищу сопровождение до хайсека, плачу.', 'Тут кто-нибудь вообще живой?',
    'Мой трюм полон, уношу ноги.', 'о7, удачной охоты.'
  ]
};

function fmt(n) { return Math.round(n).toLocaleString('ru-RU'); }

require('./features')(Game);
require('./ai')(Game);
require('./story')(Game);
require('./contracts')(Game);
require('./infra')(Game);
require('./combat')(Game);
require('./drones')(Game);
require('./pirates')(Game);
require('./pbases')(Game);
require('./surface')(Game);
require('./bot')(Game);
require('./autoplay')(Game);
require('./relics')(Game);
require('./industry')(Game);
require('./war')(Game);
require('./wingmen')(Game);
require('./worldevents')(Game);
require('./career')(Game);
require('./npctalk')(Game);
require('./sleep')(Game);
require('./cmissions')(Game);
require('./dailies')(Game);
require('./outposts')(Game);
require('./wormholes')(Game);
require('./shipyard')(Game);
require('./marks')(Game);
require('./gas')(Game);
require('./probes')(Game);
require('./activities')(Game);
require('./passengers')(Game);
require('./corp')(Game);
require('./tech')(Game);
require('./raid')(Game);
require('./world')(Game);
require('./newships')(Game);

module.exports = { Game };
