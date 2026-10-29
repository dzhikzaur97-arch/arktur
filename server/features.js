// Дроны и исследование космоса (сканирование, аномалии). Подмешивается в класс Game.
'use strict';
const crypto = require('crypto');
const { AU, SHIPS, DRONES, ITEMS, oresForSec, RECIPES, incomeOf } = require('./data');
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

const ELITE_STOCK = ['laser_x', 'rail_x', 'miner_x', 'shield_x', 'dmg_x', 'speed_x', 'drone_x'];
const CONTRABAND = ['cb_implants', 'cb_spice', 'cb_artifact', 'cb_ai'];
const DEALER_NAMES = ['Шёпот', 'Лис', 'Барон', 'Седой', 'Мадам Ро', 'Кот', 'Ювелир', 'Старый Гас'];
const DEALER_LINES = [
  'Есть товар, которого не найдёте ни на одной станции. Я недолго здесь.',
  'Элитное снаряжение, без вопросов и лицензий. Прилетайте, пока Стражи спят.',
  'Скупаю реликвии и ядра дороже станций. И кое-что продаю.',
  'Особые предложения для особых пилотов. Время ограничено.'
];

module.exports = function install(Game) {
  const P = Game.prototype;

  // ======================================================================
  // «Бегемот»: всеядные буры поглощают все астероиды вокруг, литейный цех сразу плавит руду в слитки
  // ======================================================================
  P.foundryTick = function () {
    for (const s of this.sessions) {
      const e = s.ent, p = s.player;
      if (!e || e.warp || !e.owner) continue;
      const F = SHIPS[e.shipType].foundry;
      if (!F || p.foundryOff) continue;
      if (this.now < (e.nextFoundry || 0)) continue;
      e.nextFoundry = this.now + F.cycle * 1000;
      // литейный цех питается энергоячейками из трюма: 1 за цикл, без них — половинная производительность
      const powered = (p.ship.cargo.energy_cell || 0) > 0;
      if (powered) { p.ship.cargo.energy_cell--; if (!p.ship.cargo.energy_cell) delete p.ship.cargo.energy_cell; }
      else if (!e.foundryWarn || this.now - e.foundryWarn > 60000) { e.foundryWarn = this.now; this.notify(s, 'Литейному цеху не хватает энергоячеек — работает вполсилы', 'warn'); }
      const pw = powered ? 1 : 0.5;
      const rocks = [];
      for (const t of this.ents.values()) if (t.type === 'asteroid' && t.sys === e.sys && this.surfaceDist(e, t) <= F.range) rocks.push(t);
      if (!rocks.length) continue;
      rocks.sort((a, b) => this.surfaceDist(e, a) - this.surfaceDist(e, b));
      const acc = e.foundryAcc || (e.foundryAcc = {});
      const got = {};
      let free = e.stats.cargo - this.cargoUsed(p.ship.cargo), full = false;
      for (const t of rocks.slice(0, F.maxRocks)) {
        const rec = RECIPES[t.ore];
        let units = Math.min(t.amount, Math.floor(F.perRock * pw * e.stats.mineMul * incomeOf(e.sys) / ITEMS[t.ore].vol));
        if (rec) { // не берём больше, чем влезет слитков
          const outVol = ITEMS[rec.out].vol * rec.ratio * F.refine;
          units = Math.min(units, Math.floor(free / outVol));
        } else units = Math.min(units, Math.floor(free / ITEMS[t.ore].vol));
        if (units <= 0) { full = true; break; }
        t.amount -= units; p.stats.mined += units;
        if (rec) {
          acc[rec.out] = (acc[rec.out] || 0) + units * rec.ratio * F.refine;
          const n = Math.floor(acc[rec.out]); acc[rec.out] -= n;
          if (n > 0) { p.ship.cargo[rec.out] = (p.ship.cargo[rec.out] || 0) + n; got[rec.out] = (got[rec.out] || 0) + n; free -= n * ITEMS[rec.out].vol; }
        } else { p.ship.cargo[t.ore] = (p.ship.cargo[t.ore] || 0) + units; got[t.ore] = (got[t.ore] || 0) + units; free -= units * ITEMS[t.ore].vol; }
        this.fxSys(e.sys, null, { k: 'mine', from: e.id, to: t.id, color: 0xff9a40, dur: F.cycle });
        if (t.amount <= 0) this.depleteAsteroid(t);
      }
      const parts = Object.entries(got).map(([id, n]) => `+${n} ${ITEMS[id].name}`);
      if (parts.length) this.notify(s, 'Литейный цех: ' + parts.join(', '), 'mine');
      if (full) { this.notify(s, 'Трюм «Бегемота» полон — литейный цех остановлен.', 'warn'); e.nextFoundry = this.now + 20000; }
      this.sendProfile(s);
    }
  };
  P.c_foundry = function (s, m, p) {
    p.foundryOff = !p.foundryOff;
    this.notify(s, p.foundryOff ? 'Всеядные буры остановлены.' : 'Всеядные буры запущены: поглощаем всё вокруг.');
    this.sendProfile(s);
  };

  // ======================================================================
  // Дроны
  // ======================================================================
  P.droneBay = function (ship) { return ship.drones || (ship.drones = {}); };
  P.droneVol = function (bay) { let v = 0; for (const id in bay) v += bay[id] * DRONES[id].vol; return v; };
  P.myDrones = function (e) { return [...this.ents.values()].filter(d => d.type === 'drone' && d.ownerEnt === e.id); };

  // ---------- загрузка дронов: ангар / трюм ↔ отсек ----------
  P.bayFree = function (p) { return (SHIPS[p.ship.type].droneBay || 0) - this.droneVol(this.droneBay(p.ship)); };

  // Перекладывает до qty дронов из склада src (объект id→кол-во) в отсек. Возвращает, сколько поместилось.
  P.moveToBay = function (p, src, item, qty) {
    const bay = this.droneBay(p.ship);
    const fit = Math.floor(this.bayFree(p) / DRONES[item].vol + 1e-9);
    const n = Math.max(0, Math.min(qty, src[item] || 0, fit));
    if (!n) return 0;
    src[item] -= n; if (!src[item]) delete src[item];
    bay[item] = (bay[item] || 0) + n;
    return n;
  };

  P.bayReport = function (s, p, n, item, from) {
    const cap = SHIPS[p.ship.type].droneBay;
    if (!cap) return this.notify(s, `У корабля «${SHIPS[p.ship.type].name}» нет отсека дронов`, 'warn');
    if (!n) return this.notify(s, `Отсек дронов заполнен (${cap} м³). Освободите место или выберите дронов поменьше.`, 'warn');
    this.notify(s, `В отсек загружено: ${ITEMS[item].name} ×${n} (${from})`, 'good');
  };

  // из ангара станции
  P.c_loadDrone = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    if (!DRONES[m.item]) return;
    const n = this.moveToBay(p, this.hangar(p, st).items, m.item, Math.max(1, Math.floor(+m.qty) || 1));
    this.bayReport(s, p, n, m.item, 'из ангара');
    this.sendProfile(s);
  };

  // из трюма — работает и в космосе
  P.c_cargoToBay = function (s, m, p) {
    if (!DRONES[m.item]) return;
    const n = this.moveToBay(p, p.ship.cargo, m.item, Math.max(1, Math.floor(+m.qty) || 999));
    this.bayReport(s, p, n, m.item, 'из трюма');
    this.sendProfile(s);
  };

  // из отсека в ангар (на станции) или в трюм (в космосе)
  P.c_unloadDrone = function (s, m, p) {
    const bay = this.droneBay(p.ship);
    const qty = Math.min(bay[m.item] || 0, Math.max(1, Math.floor(+m.qty) || 1));
    if (!qty) return;
    let dest;
    if (s.docked && m.to !== 'cargo') dest = this.hangar(p, s.docked).items;
    else {
      const free = this.calcStats(p, p.ship).cargo - this.cargoUsed(p.ship.cargo);
      if (DRONES[m.item].vol * qty > free + 1e-9) return this.notify(s, 'Не хватает места в трюме', 'warn');
      dest = p.ship.cargo;
    }
    bay[m.item] -= qty; if (!bay[m.item]) delete bay[m.item];
    dest[m.item] = (dest[m.item] || 0) + qty;
    this.sendProfile(s);
  };

  // «Заполнить отсек»: лучшие дроны (сначала боевые по урону, потом шахтёрские) из трюма и ангара
  P.c_fillBay = function (s, m, p) {
    const cap = SHIPS[p.ship.type].droneBay;
    if (!cap) return this.notify(s, 'У этого корабля нет отсека дронов', 'warn');
    const sources = [['трюм', p.ship.cargo]];
    if (s.docked) sources.push(['ангар', this.hangar(p, s.docked).items]);
    const order = Object.keys(DRONES).sort((a, b) => (DRONES[b].kind === 'combat') - (DRONES[a].kind === 'combat') || (DRONES[b].dmg || 0) - (DRONES[a].dmg || 0));
    let total = 0;
    for (const id of order) for (const [, src] of sources) total += this.moveToBay(p, src, id, 999);
    if (!total) this.notify(s, this.bayFree(p) < 5 ? 'Отсек уже заполнен' : (s.docked ? 'Нет дронов в ангаре и трюме. Купите их на рынке.' : 'В трюме нет дронов'), 'warn');
    else this.notify(s, `Загружено дронов: ${total}. Свободно в отсеке: ${this.bayFree(p)} м³`, 'good');
    this.sendProfile(s);
  };

  P.c_droneLaunch = function (s, m, p, e) {
    if (!e || e.warp) return;
    const bay = this.droneBay(p.ship);
    let free = ((e.stats && e.stats.maxDrones) || SHIPS[p.ship.type].maxDrones) - this.myDrones(e).length; // «Рой-матрица» добавляет дронов
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
      aggressors: new Map(), task: 'idle', target: null, nextCycle: 0, mul: 1 + 0.1 * ((p && p.skills.drones) || 0) + ((owner.stats && owner.stats.droneMul) || ((SHIPS[owner.shipType].bonus || {}).drones || 0))
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
      const dmg = def.dmg * d.mul * rnd(0.8, 1.2);
      this.fxSys(d.sys, null, { k: 'beam', from: d.id, to: t.id, color: def.color, hit: true, dur: 0.5, dmg: Math.round(dmg) });
      this.applyDamage(t, dmg, d);
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
      if (!a.owner && !a.fortress && a.kind !== 'pbase' && a.kind !== 'front' && !a.relic) count[a.sys] = (count[a.sys] || 0) + 1;
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
    return this.anoms ? [...this.anoms.values()].filter(a => a.sys === sysId && (known[a.id] || a.public) && (!a.owner || a.owner === p.name)) : [];
  };

  P.sendAnoms = function (s) {
    const sysId = s.ent ? s.ent.sys : this.playerSys(s.player);
    const list = this.knownAnoms(s.player, sysId).map(a => ({ id: a.id, kind: 'anomaly', akind: a.fortress ? 'fortress' : a.kind, name: a.name, pos: a.pos, radius: 0, done: !!a.done }));
    // контрабандисты видны всем в системе как метка для варпа
    for (const d of this.ents.values()) if (d.dealer && d.sys === sysId) list.push({ id: 'bm_' + d.id, dealer: d.id, kind: 'anomaly', akind: 'black', name: 'Чёрный рынок: ' + d.name, pos: d.pos, radius: 0 });
    s.send({ t: 'anoms', list });
  };
  P.broadcastAnoms = function (sysId) { for (const s of this.sessions) if (this.playerSys(s.player) === sysId) this.sendAnoms(s); };

  P.c_scan = function (s, m, p, e) {
    if (!e || e.warp) return;
    if (e.scanUntil > this.now) return;
    const dur = Math.max(2, (8 - (p.skills.scanning || 0)) * (1 - (e.stats.scanBonus || 0) * 0.5)) * 1000;
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
      if (a.owner || a.public || a.sys !== e.sys || known[a.id]) continue;
      if (Math.random() < clamp(a.sig * (0.7 + 0.1 * (p.skills.scanning || 0)) * (1 + (e.stats.scanBonus || 0) * 2), 0.1, 1)) { known[a.id] = true; found++; }
    }
    const total = this.knownAnoms(p, e.sys).length;
    const hidden = [...this.anoms.values()].filter(a => a.sys === e.sys && !known[a.id]).length;
    this.notify(s, found ? `Найдено аномалий: ${found}. Они в обзоре на вкладке «Навигация».` : hidden ? 'Сигналы слишком слабые. Попробуйте ещё раз.' : `Новых сигналов нет. Известно аномалий: ${total}.`, found ? 'good' : 'info');
    this.sendAnoms(s);
    this.storyScan(s);
  };

  // Игрок прилетел в аномалию — активируем содержимое
  P.triggerAnomalies = function (s) {
    const e = s.ent;
    if (!e || e.warp || !this.anoms) return;
    for (const a of this.anoms.values()) {
      if (a.owner || a.kind === 'event') continue; // сюжетные точки, контракты и события обрабатываются отдельно
      if (a.sys !== e.sys || dist(a.pos, e.pos) > 150000) continue;
      if ((s.player.known || {})[a.id] && dist(a.pos, e.pos) < 30000) this.contractAnomalyVisited(s, a);
      if (a.triggered) continue;
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
    const bonus = Math.round(25000 * require('./data').incomeOf(a.sys) * (a.sys && sec <= 0 ? 1.5 : 1) * rnd(0.8, 1.2));
    if (killerPlayer) killerPlayer.credits += bonus;
    for (const s of this.sessions) {
      if (!s.ent || s.ent.sys !== a.sys) continue;
      this.notify(s, `Аномалия «${a.name}» зачищена! Тайник Скверны открыт.${killerPlayer && s.player === killerPlayer ? ` Премия: ${fmt(bonus)} ISK` : ''}`, 'good');
      this.sendAnoms(s);
    }
  };

  // ======================================================================
  // Чёрный рынок: случайные контрабандисты с элитным товаром
  // ======================================================================
  P.blackTick = function () {
    if (this._bmCheck && this.now - this._bmCheck < 10000) return;
    this._bmCheck = this.now;
    const occupied = new Set();
    for (const s of this.sessions) occupied.add(this.playerSys(s.player));
    for (const d of [...this.ents.values()]) {
      if (!d.dealer) continue;
      if (this.now > d.expires || !occupied.has(d.sys)) {
        if (occupied.has(d.sys)) {
          this.broadcastSys(d.sys, { t: 'chat', ch: 'local', from: d.name, text: 'Мне пора. Ищите меня в других системах.' });
          this.fxSys(d.sys, d.pos, { k: 'jump', pos: d.pos });
        }
        this.removeEntity(d); this.broadcastAnoms(d.sys);
      }
    }
    for (const sysId of occupied) {
      if ([...this.ents.values()].some(d => d.dealer && d.sys === sysId)) continue;
      const sec = this.U.byId[sysId].sec;
      const chance = sec >= 0.8 ? 0.012 : sec >= 0.5 ? 0.025 : sec > 0 ? 0.05 : 0.07; // за 10 с
      if (Math.random() < chance) this.spawnDealer(sysId);
    }
  };

  P.spawnDealer = function (sysId) {
    const sys = this.U.systems[sysId];
    const sec = sys.def.sec;
    const spots = [...sys.belts, ...sys.celestials.filter(c => c.kind === 'planet')];
    const near = pick(spots);
    const pos = add(near.pos, [rnd(-1, 1) * 3e5, rnd(-1, 1) * 5e4, rnd(-1, 1) * 3e5]);
    const r = Math.random;
    // ассортимент: 2–4 элитных товара + 1–2 вида контрабанды; в опасных системах дешевле и больше
    const disc = sec >= 0.5 ? 1.15 : sec > 0 ? 1 : 0.85;
    const stock = [];
    for (const id of [...ELITE_STOCK].sort(() => r() - 0.5).slice(0, 2 + Math.floor(r() * 3)))
      stock.push({ item: id, qty: 1 + Math.floor(r() * (sec > 0.4 ? 1 : 3)), price: Math.round(ITEMS[id].base * disc * rnd(0.85, 1.25)) });
    for (const id of [...CONTRABAND].sort(() => r() - 0.5).slice(0, 1 + Math.floor(r() * 2)))
      stock.push({ item: id, qty: 3 + Math.floor(r() * 10), price: Math.round(ITEMS[id].base * rnd(0.6, 0.9)) });
    // что скупает и почём
    const buys = { salv_relic: Math.round(ITEMS.salv_relic.base * rnd(1.4, 1.9)), salv_core: Math.round(ITEMS.salv_core.base * rnd(1.3, 1.7)) };
    for (const id of CONTRABAND) if (!stock.some(o => o.item === id)) buys[id] = Math.round(ITEMS[id].base * rnd(1.15, 1.6));
    for (const id of ELITE_STOCK) if (r() < 0.4) buys[id] = Math.round(ITEMS[id].base * rnd(0.55, 0.75));
    const stats = this.calcStats(null, { type: 'tyagach', fit: [] });
    const d = {
      id: 'bm_' + uid(), type: 'ship', dealer: true, name: pick(DEALER_NAMES), shipType: r() < 0.5 ? 'tyagach' : 'kit', sys: sysId,
      pos, vel: [0, 0, 0], heading: [1, 0, 0], stats, shield: 1e9, armor: 1e9, hull: 1e9, cap: 1e9, invulnUntil: Infinity,
      cmd: { type: 'stop' }, speedFrac: 0, modules: [], locks: new Set(), locking: new Map(), warp: null, scrambledUntil: 0,
      aggressors: new Map(), radius: 110, nextThink: 0, stock, buys, expires: this.now + rnd(8, 12) * 60000
    };
    d.stats.shield = d.stats.armor = d.stats.hull = 1e9;
    this.ents.set(d.id, d);
    this.fxSys(sysId, pos, { k: 'jump', pos });
    this.broadcastSys(sysId, { t: 'chat', ch: 'local', from: d.name, text: pick(DEALER_LINES) + ` Ищите меня у «${near.name}».` });
    for (const s of this.sessions) if (this.playerSys(s.player) === sysId) this.notify(s, `В системе появился чёрный рынок (${d.name}). Он в обзоре на вкладке «Навигация».`, 'good');
    this.broadcastAnoms(sysId);
    return d;
  };

  P.dealerFor = function (s, id) {
    const e = s.ent, d = this.ents.get(id);
    if (!e || !d || !d.dealer || d.sys !== e.sys) { this.notify(s, 'Контрабандист уже ушёл', 'warn'); return null; }
    if (this.surfaceDist(e, d) > 10000) {
      if (!e.warp) e.cmd = { type: 'approach', target: d.id };
      this.notify(s, 'Подлетите ближе 10 км, чтобы торговать');
      return null;
    }
    return d;
  };

  P.sendBlack = function (s, d) {
    const p = s.player;
    s.send({ t: 'black', id: d.id, name: d.name, expires: d.expires, stock: d.stock, buys: d.buys, cargo: p.ship.cargo,
      cargoFree: this.calcStats(p, p.ship).cargo - this.cargoUsed(p.ship.cargo) });
  };

  P.c_blackOpen = function (s, m) { const d = this.dealerFor(s, m.id); if (d) this.sendBlack(s, d); };

  P.c_blackBuy = function (s, m, p) {
    const d = this.dealerFor(s, m.id); if (!d) return;
    const o = d.stock.find(x => x.item === m.item);
    const qty = Math.max(1, Math.floor(+m.qty) || 1);
    if (!o || o.qty < qty) return this.notify(s, 'Столько нет в наличии', 'warn');
    const cost = o.price * qty;
    if (p.credits < cost) return this.notify(s, 'Недостаточно ISK', 'warn');
    const free = this.calcStats(p, p.ship).cargo - this.cargoUsed(p.ship.cargo);
    if (ITEMS[o.item].vol * qty > free + 1e-9) return this.notify(s, 'Не хватает места в трюме', 'warn');
    p.credits -= cost; o.qty -= qty;
    if (!o.qty) d.stock.splice(d.stock.indexOf(o), 1);
    p.ship.cargo[o.item] = (p.ship.cargo[o.item] || 0) + qty;
    this.notify(s, `Куплено у контрабандиста: ${ITEMS[o.item].name} ×${qty} за ${fmt(cost)} ISK. Товар в трюме.`, 'good');
    this.sendProfile(s); this.sendBlack(s, d); this.save();
  };

  P.c_blackSell = function (s, m, p) {
    const d = this.dealerFor(s, m.id); if (!d) return;
    const price = d.buys[m.item];
    const have = p.ship.cargo[m.item] || 0;
    const qty = Math.min(have, Math.max(1, Math.floor(+m.qty) || have));
    if (!price || qty <= 0) return this.notify(s, 'Этот товар контрабандисту не нужен', 'warn');
    p.ship.cargo[m.item] -= qty; if (!p.ship.cargo[m.item]) delete p.ship.cargo[m.item];
    p.credits += price * qty;
    this.notify(s, `Продано контрабандисту: ${ITEMS[m.item].name} ×${qty} за ${fmt(price * qty)} ISK`, 'good');
    this.sendProfile(s); this.sendBlack(s, d); this.save();
  };

  // ======================================================================
  // Перерабатывающие станции игроков
  // ======================================================================
  P.loadStructures = function () {
    if (!this.db.structures) this.db.structures = [];
    for (const st of this.db.structures) this.attachStructure(st);
  };

  // Добавляет станцию игрока во вселенную как обычную станцию (стыковка, ангар, рынок)
  P.attachStructure = function (st) {
    const sys = this.U.systems[st.sys];
    if (!sys) return null;
    const ang = rng(st.id)() * Math.PI * 2;
    const c = {
      id: st.id, kind: 'station', sys: st.sys, name: st.name, pos: st.pos, radius: 2500, landing: 4500,
      undock: [Math.cos(ang), 0, Math.sin(ang)], style: 3, owner: st.owner, player: true
    };
    this.U.celestials[c.id] = c;
    sys.celestials.push(c); sys.stations.push(c);
    this.prices[c.id] = {};
    for (const id of Object.keys(ITEMS)) this.prices[c.id][id] = 0.95; // на частной станции чуть дешевле
    return c;
  };

  P.myStructure = function (p) { return (this.db.structures || []).find(x => x.owner === p.name && (!x.type || x.type === 'refinery')); };

  P.c_structInfo = function (s, m, p) {
    const st = this.myStructure(p);
    const D = require('./data');
    s.send({ t: 'struct', mine: st ? { id: st.id, name: st.name, sys: st.sys, level: st.level, jobs: st.jobs, building: st.buildUntil > this.now ? st.buildUntil : 0 } : null,
      cost: D.REFINERY.buildCost, levels: D.REFINERY.levels, recipes: D.RECIPES, maxJobs: D.REFINERY.maxJobs, now: this.now });
  };

  P.c_build = function (s, m, p, e) {
    const D = require('./data');
    if (!e || e.warp) return this.notify(s, 'Строить можно только в космосе', 'warn');
    if (this.myStructure(p)) return this.notify(s, 'У вас уже есть станция. Её можно улучшить.', 'warn');
    if (this.U.byId[e.sys].sec >= 1.0) return this.notify(s, 'В столичных системах (1.0) частные станции запрещены', 'warn');
    if (p.credits < D.REFINERY.buildCost) return this.notify(s, `Нужно ${fmt(D.REFINERY.buildCost)} ISK`, 'warn');
    for (const c of this.U.systems[e.sys].celestials) {
      if (dist(c.pos, e.pos) - (c.radius || 0) < 200000) return this.notify(s, `Слишком близко к объекту «${c.name}». Отлетите дальше 200 км (щелчок по космосу — корабль полетит в ту сторону).`, 'warn');
    }
    p.credits -= D.REFINERY.buildCost;
    const st = { id: 'ps_' + uid(), owner: p.name, name: `Завод «${p.name}»`, sys: e.sys, pos: e.pos.map(x => x + rnd(-1, 1) * 4000), level: 1, jobs: [],
      buildUntil: this.now + D.REFINERY.buildTime * 1000, created: this.now };
    this.db.structures.push(st);
    this.attachStructure(st);
    this.fxSys(e.sys, st.pos, { k: 'jump', pos: st.pos });
    this.notify(s, `Строительство началось! Станция будет готова через ${D.REFINERY.buildTime} с.`, 'good');
    for (const o of this.sessions) {
      o.send({ t: 'stationAdd', station: { id: st.id, name: st.name, sys: st.sys, owner: st.owner } });
      if (this.playerSys(o.player) === e.sys && !o.docked) this.sendSystem(o);
    }
    this.broadcastSys(e.sys, { t: 'chat', ch: 'local', from: '*', text: `${p.name} строит перерабатывающую станцию` });
    this.sendProfile(s); this.c_structInfo(s, m, p); this.save(true);
  };

  P.ownStation = function (s, p) {
    const st = this.myStructure(p);
    if (!st || s.docked !== st.id) { this.notify(s, 'Нужно находиться на своей станции', 'warn'); return null; }
    return st;
  };

  P.c_upgrade = function (s, m, p) {
    const D = require('./data');
    const st = this.ownStation(s, p); if (!st) return;
    const next = D.REFINERY.levels[st.level + 1];
    if (!next) return this.notify(s, 'Станция уже максимального уровня', 'warn');
    if (p.credits < next.cost) return this.notify(s, `Нужно ${fmt(next.cost)} ISK`, 'warn');
    p.credits -= next.cost; st.level++;
    this.notify(s, `Станция улучшена до уровня ${st.level}: выход ×${next.yield}, скорость ×${next.speed}`, 'good');
    this.sendProfile(s); this.c_structInfo(s, m, p); this.save(true);
  };

  P.c_refine = function (s, m, p) {
    const D = require('./data');
    const st = this.ownStation(s, p); if (!st) return;
    const rec = D.RECIPES[m.item];
    const h = this.hangar(p, st.id);
    const qty = Math.min(h.items[m.item] || 0, Math.floor(+m.qty) || 0);
    if (!rec || qty <= 0) return this.notify(s, 'Нет руды в ангаре станции. Разгрузите трюм.', 'warn');
    if (st.jobs.length >= D.REFINERY.maxJobs) return this.notify(s, `Одновременно не больше ${D.REFINERY.maxJobs} заказов`, 'warn');
    const lv = D.REFINERY.levels[st.level];
    const outQty = Math.floor(qty * rec.ratio * lv.yield);
    if (outQty <= 0) return this.notify(s, 'Слишком мало руды для переработки', 'warn');
    h.items[m.item] -= qty; if (!h.items[m.item]) delete h.items[m.item];
    // заказы идут по очереди: каждый начинается после предыдущего
    const start = Math.max(this.now, ...st.jobs.map(j => j.end));
    const dur = Math.max(5, qty * ITEMS[m.item].base / 600 / lv.speed) * 1000;
    st.jobs.push({ ore: m.item, qty, out: rec.out, outQty, start, end: start + dur });
    this.notify(s, `Заказ принят: ${ITEMS[m.item].name} ×${qty} → ${ITEMS[rec.out].name} ×${outQty}`, 'good');
    this.sendProfile(s); this.c_structInfo(s, m, p); this.save(true);
  };

  // Раз в секунду: стройка и готовые заказы (работают и без игрока в сети)
  P.structTick = function () {
    for (const st of this.db.structures || []) {
      if (st.buildUntil && this.now >= st.buildUntil) {
        st.buildUntil = 0;
        for (const s of this.sessions) if (s.player.name === st.owner) this.notify(s, `Станция «${st.name}» построена! Пристыкуйтесь к ней, вкладка «Завод».`, 'good');
      }
      const done = st.jobs.filter(j => this.now >= j.end);
      if (!done.length) continue;
      st.jobs = st.jobs.filter(j => this.now < j.end);
      const p = this.db.players[st.owner];
      if (!p) continue;
      const h = this.hangar(p, st.id);
      for (const j of done) h.items[j.out] = (h.items[j.out] || 0) + j.outQty;
      for (const s of this.sessions) if (s.player === p) {
        this.notify(s, 'Переработка завершена: ' + done.map(j => `${ITEMS[j.out].name} ×${j.outQty}`).join(', ') + ' (ангар вашей станции)', 'good');
        this.sendProfile(s);
        if (s.docked === st.id) this.c_structInfo(s, {}, p);
      }
      this.save();
    }
  };
};
