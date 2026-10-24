// Дроны и исследование космоса (сканирование, аномалии). Подмешивается в класс Game.
'use strict';
const crypto = require('crypto');
const { AU, SHIPS, DRONES, ITEMS, oresForSec } = require('./data');
const { makeAsteroid, rng } = require('./universe');

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const uid = () => crypto.randomBytes(6).toString('hex');
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');

const ANOMALY_KINDS = {
  combat: { names: ['Логово Скверны', 'Укреплённая база Скверны', 'Пиратский перевалочный пункт'], weight: 0.45 },
  ore:    { names: ['Богатая жила', 'Скрытое месторождение', 'Кристаллическое поле'], weight: 0.3 },
  relic:  { names: ['Руины древней станции', 'Заброшенный аванпост', 'Обломки ковчега'], weight: 0.25 }
};

module.exports = function install(Game) {
  const P = Game.prototype;

  // ======================================================================
  // Дроны
  // ======================================================================
  P.droneBay = function (ship) { return ship.drones || (ship.drones = {}); };
  P.droneVol = function (bay) { let v = 0; for (const id in bay) v += bay[id] * DRONES[id].vol; return v; };
  P.myDrones = function (e) { return [...this.ents.values()].filter(d => d.type === 'drone' && d.ownerEnt === e.id); };

  P.c_loadDrone = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const h = this.hangar(p, st), bay = this.droneBay(p.ship);
    if (!DRONES[m.item] || !(h.items[m.item] > 0)) return;
    const cap = SHIPS[p.ship.type].droneBay;
    if (this.droneVol(bay) + DRONES[m.item].vol > cap) return this.notify(s, cap ? `Отсек дронов заполнен (${cap} м³)` : 'У этого корабля нет отсека дронов', 'warn');
    h.items[m.item]--; if (!h.items[m.item]) delete h.items[m.item];
    bay[m.item] = (bay[m.item] || 0) + 1;
    this.sendProfile(s);
  };

  P.c_unloadDrone = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const bay = this.droneBay(p.ship);
    if (!(bay[m.item] > 0)) return;
    bay[m.item]--; if (!bay[m.item]) delete bay[m.item];
    const h = this.hangar(p, st);
    h.items[m.item] = (h.items[m.item] || 0) + 1;
    this.sendProfile(s);
  };

  P.c_droneLaunch = function (s, m, p, e) {
    if (!e || e.warp) return;
    const bay = this.droneBay(p.ship);
    let free = SHIPS[p.ship.type].maxDrones - this.myDrones(e).length;
    if (free <= 0) return this.notify(s, 'Выпущено максимальное число дронов', 'warn');
    let n = 0;
    for (const id of Object.keys(bay)) {
      while (bay[id] > 0 && free > 0) {
        bay[id]--; free--; n++;
        this.spawnDrone(e, s, id);
      }
      if (!bay[id]) delete bay[id];
    }
    if (!n) return this.notify(s, 'Отсек дронов пуст. Загрузите дронов на станции.', 'warn');
    this.notify(s, `Выпущено дронов: ${n}`);
    this.sendProfile(s);
  };

  P.spawnDrone = function (owner, sess, item) {
    const def = DRONES[item];
    const p = this.db.players[owner.owner];
    const hp = def.hp;
    const d = {
      id: 'dr_' + uid(), type: 'drone', item, name: def.name, owner: owner.owner, ownerEnt: owner.id, session: sess, sys: owner.sys,
      pos: add(owner.pos, [rnd(-150, 150), rnd(-80, 80), rnd(-150, 150)]), vel: owner.vel.slice(), heading: [0, 0, 1],
      stats: { maxSpeed: def.speed, align: 0.6, sig: 20, shield: 1, armor: 1, hull: hp, radius: 6 }, shield: 0, armor: 0, hull: hp,
      cmd: { type: 'orbit', target: owner.id, range: 500 }, speedFrac: 1, modules: [], radius: 6,
      aggressors: new Map(), task: 'idle', target: null, nextCycle: 0, mul: 1 + 0.1 * ((p && p.skills.drones) || 0)
    };
    this.ents.set(d.id, d);
    return d;
  };

  P.c_droneEngage = function (s, m, p, e) {
    if (!e) return;
    const t = this.ents.get(m.target);
    if (!t || !e.locks.has(t.id)) return this.notify(s, 'Сначала захватите цель', 'warn');
    if (t.type === 'ship' && t.owner && !this.canAttack(e, t, s, m.confirm)) return;
    let n = 0;
    for (const d of this.myDrones(e)) {
      const kind = DRONES[d.item].kind;
      if ((kind === 'combat' && t.type === 'ship') || (kind === 'mining' && t.type === 'asteroid')) { d.task = kind === 'combat' ? 'attack' : 'mine'; d.target = t.id; n++; }
    }
    if (!n) this.notify(s, t.type === 'asteroid' ? 'Нет выпущенных шахтёрских дронов' : 'Нет выпущенных боевых дронов', 'warn');
  };

  P.c_droneRecall = function (s, m, p, e) {
    if (!e) return;
    for (const d of this.myDrones(e)) { d.task = 'return'; d.target = null; }
  };

  P.scoopDrone = function (d) {
    const p = this.db.players[d.owner];
    if (p) { const bay = this.droneBay(p.ship); bay[d.item] = (bay[d.item] || 0) + 1; }
    this.removeEntity(d);
    if (d.session) this.sendProfile(d.session);
  };

  // При варпе, прыжке или стыковке дроны автоматически возвращаются в отсек
  P.scoopAll = function (e) { for (const d of this.myDrones(e)) this.scoopDrone(d); };

  P.droneTick = function (d) {
    const owner = this.ents.get(d.ownerEnt);
    if (!owner || owner.sys !== d.sys) { this.removeEntity(d); return; }
    if (d.task === 'return') {
      d.cmd = { type: 'approach', target: owner.id };
      if (this.surfaceDist(d, owner) < 400) this.scoopDrone(d);
      return;
    }
    let t = d.target && this.ents.get(d.target);
    if (!t || t.sys !== d.sys || (t.type === 'ship' && t.warp)) { d.task = 'idle'; d.target = null; t = null; }
    const def = DRONES[d.item];
    if (d.task === 'idle') {
      // агрессивный режим: боевые дроны сами защищают хозяина от пиратов
      const att = owner.lastAttacker && this.ents.get(owner.lastAttacker);
      if (def.kind === 'combat' && att && att.npc && att.sys === d.sys && this.now - owner.lastHitAt < 8000) { d.task = 'attack'; d.target = att.id; t = att; }
      else { d.cmd = { type: 'orbit', target: owner.id, range: 500 }; return; }
    }
    d.cmd = { type: 'orbit', target: t.id, range: def.range * 0.5 };
    if (this.now < d.nextCycle || this.surfaceDist(d, t) > def.range) return;
    d.nextCycle = this.now + def.cycle * 1000;
    if (def.kind === 'combat') {
      this.fxSys(d.sys, null, { k: 'beam', from: d.id, to: t.id, color: def.color, hit: true, dur: 0.5 });
      this.applyDamage(t, def.dmg * d.mul * rnd(0.8, 1.2), d);
    } else {
      const p = this.db.players[d.owner];
      const item = ITEMS[t.ore];
      const free = owner.stats.cargo - this.cargoUsed(p.ship.cargo);
      const units = Math.min(Math.floor(def.yield * d.mul / item.vol), t.amount, Math.floor(free / item.vol));
      this.fxSys(d.sys, null, { k: 'mine', from: d.id, to: t.id, color: def.color, dur: def.cycle });
      if (units <= 0) { d.task = 'return'; if (d.session) this.notify(d.session, 'Трюм полон — дроны возвращаются', 'warn'); return; }
      p.ship.cargo[t.ore] = (p.ship.cargo[t.ore] || 0) + units;
      p.stats.mined += units;
      t.amount -= units;
      if (d.session) this.sendProfile(d.session);
      if (t.amount <= 0) this.depleteAsteroid(t);
    }
  };

  P.destroyDrone = function (d, killer) {
    this.fxSys(d.sys, d.pos, { k: 'boom', pos: d.pos, size: 40 });
    this.removeEntity(d);
    if (d.session) this.notify(d.session, `Дрон «${d.name}» уничтожен`, 'bad');
  };

  // ======================================================================
  // Аномалии и сканирование
  // ======================================================================
  P.anomTick = function () {
    if (!this.anoms) this.anoms = new Map();
    if (this._anomCheck && this.now - this._anomCheck < 10000) return;
    this._anomCheck = this.now;
    const count = {};
    for (const a of [...this.anoms.values()]) {
      if (a.expires < this.now) { this.removeAnomaly(a); continue; }
      count[a.sys] = (count[a.sys] || 0) + 1;
    }
    for (const sys of Object.values(this.U.systems)) {
      const sec = sys.def.sec;
      const want = sec >= 0.9 ? 1 : sec >= 0.5 ? 2 : sec > 0 ? 3 : 4;
      if ((count[sys.id] || 0) < want) this.createAnomaly(sys);
    }
  };

  P.createAnomaly = function (sys) {
    const sec = sys.def.sec;
    let roll = Math.random(), kind = 'relic';
    for (const [k, v] of Object.entries(ANOMALY_KINDS)) { if ((roll -= v.weight) <= 0) { kind = k; break; } }
    if (sec >= 0.9 && kind === 'combat') kind = 'ore';
    const ang = Math.random() * Math.PI * 2, r = (1 + Math.random() * 6) * AU;
    const a = {
      id: 'an_' + uid(), sys: sys.id, kind, name: pick(ANOMALY_KINDS[kind].names), radius: 0, landing: 6000,
      pos: [Math.cos(ang) * r, (Math.random() - 0.5) * 0.05 * r, Math.sin(ang) * r],
      sig: rnd(0.35, 1), created: this.now, expires: this.now + rnd(60, 100) * 60000, triggered: false, npcs: new Set()
    };
    this.anoms.set(a.id, a);
    if (kind === 'ore') {
      // самые ценные руды, доступные для этого уровня безопасности
      const ores = oresForSec(sec - 0.3).slice(-2);
      const beltLike = { id: a.id, sys: sys.id, pos: a.pos, ores: ores.map(([o]) => [o, 1 / ores.length]) };
      const r2 = rng(a.id);
      for (let i = 0; i < 8; i++) {
        const ast = makeAsteroid(beltLike, r2, i);
        ast.amount = ast.maxAmount = Math.round(ast.amount * 2.5);
        ast.anom = a.id;
        this.ents.set(ast.id, ast);
      }
    }
    return a;
  };

  P.removeAnomaly = function (a) {
    this.anoms.delete(a.id);
    for (const e of [...this.ents.values()]) {
      if (e.anom !== a.id) continue;
      // не убираем то, рядом с чем сейчас игрок
      const near = [...this.sessions].some(s => s.ent && s.ent.sys === e.sys && dist(s.ent.pos, e.pos) < 300000);
      if (!near || e.type === 'asteroid') this.removeEntity(e);
    }
    this.broadcastAnoms(a.sys);
  };

  P.knownAnoms = function (p, sysId) {
    const known = p.known || (p.known = {});
    for (const id of Object.keys(known)) if (!this.anoms || !this.anoms.has(id)) delete known[id];
    return this.anoms ? [...this.anoms.values()].filter(a => a.sys === sysId && known[a.id]) : [];
  };

  P.sendAnoms = function (s) {
    const sysId = s.ent ? s.ent.sys : this.playerSys(s.player);
    s.send({ t: 'anoms', list: this.knownAnoms(s.player, sysId).map(a => ({ id: a.id, kind: 'anomaly', akind: a.kind, name: a.name, pos: a.pos, radius: 0, done: !!a.done })) });
  };
  P.broadcastAnoms = function (sysId) { for (const s of this.sessions) if (this.playerSys(s.player) === sysId) this.sendAnoms(s); };

  P.c_scan = function (s, m, p, e) {
    if (!e || e.warp) return;
    if (e.scanUntil > this.now) return;
    const dur = Math.max(3, 8 - (p.skills.scanning || 0)) * 1000;
    e.scanStart = this.now; e.scanUntil = this.now + dur;
    this.notify(s, 'Сканирование системы…');
  };

  P.scanTick = function (s) {
    const e = s.ent, p = s.player;
    if (!e || !e.scanUntil || this.now < e.scanUntil) return;
    e.scanUntil = 0;
    const known = p.known || (p.known = {});
    let found = 0;
    for (const a of this.anoms.values()) {
      if (a.sys !== e.sys || known[a.id]) continue;
      if (Math.random() < clamp(a.sig * (0.7 + 0.1 * (p.skills.scanning || 0)), 0.1, 1)) { known[a.id] = true; found++; }
    }
    const total = this.knownAnoms(p, e.sys).length;
    const hidden = [...this.anoms.values()].filter(a => a.sys === e.sys && !known[a.id]).length;
    this.notify(s, found ? `Найдено аномалий: ${found}. Они в обзоре на вкладке «Навигация».` : hidden ? 'Сигналы слишком слабые. Попробуйте ещё раз.' : `Новых сигналов нет. Известно аномалий: ${total}.`, found ? 'good' : 'info');
    this.sendAnoms(s);
  };

  // Игрок прилетел в аномалию — активируем содержимое
  P.triggerAnomalies = function (s) {
    const e = s.ent;
    if (!e || e.warp || !this.anoms) return;
    for (const a of this.anoms.values()) {
      if (a.sys !== e.sys || a.triggered || dist(a.pos, e.pos) > 150000) continue;
      a.triggered = true;
      const sec = this.U.byId[a.sys].sec;
      if (a.kind === 'combat') {
        const group = sec >= 0.5 ? ['raider', 'raider', 'raider'] : sec > 0 ? ['raider', 'raider', 'reaper', 'reaper'] : ['reaper', 'reaper', 'raider', 'raider', ...(Math.random() < 0.5 ? ['warlord'] : [])];
        for (const type of group) this.spawnAnomNpc(a, type);
        this.notify(s, `${a.name}: обнаружены враждебные корабли!`, 'bad');
      } else if (a.kind === 'relic') {
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const items = { salv_scrap: 1 + Math.floor(Math.random() * 4) };
          if (Math.random() < (sec > 0.4 ? 0.35 : 0.7)) items.salv_relic = 1;
          if (Math.random() < 0.4) items.salv_core = 1 + Math.floor(Math.random() * 2);
          if (Math.random() < 0.25) items[pick(['laser_m', 'rail_l', 'shield_booster_l', 'dmg_amp', 'drone_heavy', 'mining_upg'])] = 1;
          const w = { id: 'wr_' + uid(), type: 'wreck', sys: a.sys, pos: add(a.pos, [rnd(-12000, 12000), rnd(-2000, 2000), rnd(-12000, 12000)]), vel: [0, 0, 0],
            radius: 80, name: 'Древний контейнер', items, expires: a.expires, anom: a.id };
          this.ents.set(w.id, w);
        }
        if (sec < 0.5) { this.spawnAnomNpc(a, 'raider'); this.spawnAnomNpc(a, sec > 0 ? 'raider' : 'reaper'); }
        this.notify(s, `${a.name}: на сканере древние контейнеры.`, 'good');
      } else this.notify(s, `${a.name}: богатые залежи руды.`, 'good');
    }
  };

  P.spawnAnomNpc = function (a, type) {
    const e = this.spawnNpc(type, a.sys, add(a.pos, [rnd(-20000, 20000), rnd(-3000, 3000), rnd(-20000, 20000)]));
    e.home = a.pos; e.anom = a.id;
    a.npcs.add(e.id);
  };

  // Вызывается при уничтожении NPC из аномалии
  P.anomNpcKilled = function (t, killerPlayer) {
    const a = this.anoms && this.anoms.get(t.anom);
    if (!a) return;
    a.npcs.delete(t.id);
    if (a.npcs.size || a.kind !== 'combat' || a.done) return;
    a.done = true;
    a.expires = Math.min(a.expires, this.now + 10 * 60000);
    const sec = this.U.byId[a.sys].sec;
    const items = { salv_core: 2 + Math.floor(Math.random() * 3), salv_scrap: 3 + Math.floor(Math.random() * 5) };
    if (Math.random() < (sec > 0 ? 0.3 : 0.8)) items.salv_relic = 1 + (sec <= 0 && Math.random() < 0.4 ? 1 : 0);
    items[pick(['laser_m', 'rail_l', 'shield_booster_l', 'drone_heavy', 'dmg_amp', 'overdrive'])] = 1;
    const w = { id: 'wr_' + uid(), type: 'wreck', sys: a.sys, pos: a.pos.slice(), vel: [0, 0, 0], radius: 90, name: 'Тайник Скверны', items, expires: this.now + 20 * 60000, anom: a.id };
    this.ents.set(w.id, w);
    const bonus = Math.round((sec >= 0.5 ? 20000 : sec > 0 ? 60000 : 150000) * rnd(0.8, 1.2));
    if (killerPlayer) killerPlayer.credits += bonus;
    for (const s of this.sessions) {
      if (!s.ent || s.ent.sys !== a.sys) continue;
      this.notify(s, `Аномалия «${a.name}» зачищена! Тайник Скверны открыт.${killerPlayer && s.player === killerPlayer ? ` Премия: ${fmt(bonus)} ISK` : ''}`, 'good');
      this.sendAnoms(s);
    }
  };
};
