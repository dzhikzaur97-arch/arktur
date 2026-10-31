// Поверхности планет: посадка и взлёт, выход из корабля, добыча ресурсов мультитулом, охота и приручение,
// открытия видов, костюм (инвентарь, жизнеобеспечение, защита от среды), крафт и улучшения, дроны-смотрители.
// Мир поверхности строит клиент по общему генератору (public/js/planetgen.js); сервер по тем же формулам
// проверяет каждый ресурс и каждое животное (существует ли, не истощено ли, рядом ли игрок, не слишком ли часто).
'use strict';
const { SHIPS, ITEMS, incomeOf } = require('./data');
const PG = require('../public/js/planetgen');

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rnd = (a, b) => a + Math.random() * (b - a);
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');

const SURF = {
  landRange: 600000,          // посадка — не дальше 600 км от поверхности
  mineRange: 40, useRange: 7, huntRange: 90, shipRange: 25,
  nodeRespawn: 30 * 60000, creatureRespawn: 15 * 60000, feedCooldown: 3 * 60000,
  takeoffFuel: 40,            // ди-водорода на взлёт без «Топлива взлёта»
  suitCap: 600, capUp: 150, capUps: 6
};
// рецепты: что получаем и из чего (из костюма, а рядом с кораблём — и из трюма)
const RECIPES = {
  launch_fuel: { name: 'Топливо взлёта', out: { launch_fuel: 1 }, in: { res_dihydro: 40, res_ferrite: 20 } },
  surf_kit:    { name: 'Ремкомплект костюма', out: { surf_kit: 1 }, in: { res_ferrite: 30, res_carbon: 30 } },
  energy_cell: { name: 'Энергоячейки ×2', out: { energy_cell: 2 }, in: { res_dihydro: 12, res_ferrite: 8 } },
  tool2:  { name: 'Мультитул ур.2 (добыча ×1.6)', up: ['tool', 2], in: { res_ferrite: 120, res_copper: 40 } },
  tool3:  { name: 'Мультитул ур.3 (добыча ×2.4)', up: ['tool', 3], in: { res_ferrite: 200, res_cadmium: 50, res_dihydro: 60 } },
  jet2:   { name: 'Ранец ур.2 (вдвое дольше)', up: ['jet', 2], in: { res_dihydro: 100, res_quartzite: 40 } },
  cold1:  { name: 'Защита от холода I', up: ['cold', 1], in: { res_cryo: 60, res_ferrite: 40 } },
  cold2:  { name: 'Защита от холода II', up: ['cold', 2], in: { res_cryo: 120, res_cadmium: 30 } },
  heat1:  { name: 'Защита от жары I', up: ['heat', 1], in: { res_pyrite: 60, res_ferrite: 40 } },
  heat2:  { name: 'Защита от жары II', up: ['heat', 2], in: { res_phosphor: 120, res_cadmium: 30 } },
  toxic1: { name: 'Защита от токсинов I', up: ['toxic', 1], in: { res_ammonia: 60, res_ferrite: 40 } },
  toxic2: { name: 'Защита от токсинов II', up: ['toxic', 2], in: { res_ammonia: 120, res_emeril: 25 } },
  rad1:   { name: 'Защита от радиации I', up: ['rad', 1], in: { res_uranium: 60, res_ferrite: 40 } },
  rad2:   { name: 'Защита от радиации II', up: ['rad', 2], in: { res_uranium: 120, res_emeril: 25 } }
};

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSpawnInSpace = P.spawnInSpace, baseLogout = P.logout;

  P.suitOf = function (p) {
    const s = p.suit || (p.suit = {});
    s.inv = s.inv || {}; s.cap = s.cap || SURF.suitCap; s.ups = s.ups || 0;
    s.lv = Object.assign({ tool: 1, jet: 1, cold: 0, heat: 0, toxic: 0, rad: 0 }, s.lv || {});
    for (const k of ['hp', 'ls', 'hz']) if (typeof s[k] !== 'number') s[k] = 100;
    return s;
  };
  P.discOf = function (p) { const d = p.disc || (p.disc = {}); d.planets = d.planets || {}; d.species = d.species || {}; return d; };
  const suitUsed = (s) => Object.values(s.inv).reduce((a, b) => a + b, 0);
  P.suitAdd = function (p, item, qty) {
    const s = this.suitOf(p), n = Math.max(0, Math.min(qty, s.cap - suitUsed(s)));
    if (n) s.inv[item] = (s.inv[item] || 0) + n;
    return n;
  };
  // сколько предмета есть: костюм, а рядом с кораблём — и трюм
  P.surfHave = function (sess, item) {
    const p = sess.player, s = this.suitOf(p);
    return (s.inv[item] || 0) + (this.nearShip(sess) ? (p.ship.cargo[item] || 0) : 0);
  };
  P.surfTake = function (sess, item, qty) {
    const p = sess.player, s = this.suitOf(p);
    const a = Math.min(qty, s.inv[item] || 0); s.inv[item] -= a; if (!s.inv[item]) delete s.inv[item];
    let rest = qty - a;
    if (rest > 0 && this.nearShip(sess)) { const b = Math.min(rest, p.ship.cargo[item] || 0); p.ship.cargo[item] -= b; if (!p.ship.cargo[item]) delete p.ship.cargo[item]; rest -= b; }
    return qty - rest;
  };
  P.nearShip = function (sess) { const u = sess.surf; return !!u && dist2([u.pos[0], u.pos[2]], u.ship) <= SURF.shipRange; };

  P.surfProfile = function (planetId) {
    const c = this.U.celestials[planetId];
    if (!c || c.kind !== 'planet') return null;
    return PG.profile(c, { sec: this.U.byId[c.sys].sec });
  };

  // ---------- посадка ----------
  P.c_land = function (s, m, p, e) {
    if (!e || e.warp) return;
    const c = this.U.celestials[m.planet];
    if (!c || c.kind !== 'planet' || c.sys !== e.sys) return;
    const P2 = this.surfProfile(c.id);
    if (!P2.landable) return this.notify(s, P2.why, 'warn');
    const alt = Math.hypot(e.pos[0] - c.pos[0], e.pos[1] - c.pos[1], e.pos[2] - c.pos[2]) - c.radius;
    if (alt > SURF.landRange) return this.notify(s, `Слишком высоко для посадки: ${fmt(alt / 1000)} км. Варп к планете, затем «Посадка» (до ${SURF.landRange / 1000} км).`, 'warn');
    if (e.lastHitAt && this.now - e.lastHitAt < 10000) return this.notify(s, 'Нельзя садиться под огнём', 'warn');
    // место посадки — по точке над планетой, где сейчас корабль
    const d = [e.pos[0] - c.pos[0], e.pos[1] - c.pos[1], e.pos[2] - c.pos[2]], L = Math.hypot(...d) || 1;
    const lon = Math.atan2(d[2], d[0]), lat = Math.asin(d[1] / L);
    let sx = Math.round(lon * 25000), sz = Math.round(lat * 25000);
    for (let i = 0; i < 60 && P2.liquidY !== null && PG.height(P2, sx, sz) < P2.liquidY + 1.5; i++) sx += 45; // не садимся в воду и лаву
    this.scoopAll(e);
    this.storeShipState(p, e);
    this.removeEntity(e);
    s.ent = null;
    p.loc = { sys: c.sys, pos: e.pos.slice(), surface: c.id, site: [sx, sz], ship: [sx, sz] };
    p.stats.landings = (p.stats.landings || 0) + 1;
    this.enterSurface(s, false);
  };

  P.enterSurface = function (s, restore) {
    const p = s.player, loc = p.loc, P2 = this.surfProfile(loc.surface);
    const ship = loc.ship || loc.site;
    s.surf = { planet: loc.surface, sys: loc.sys, ship, pos: [ship[0] + 6, PG.height(P2, ship[0] + 6, ship[1] + 4), ship[1] + 4], lastPos: this.now, lastHarvest: 0, lastHunt: 0, lastSentinel: 0 };
    const suit = this.suitOf(p), disc = this.discOf(p);
    // первое приземление на планету — открытие
    let found = 0;
    if (!disc.planets[loc.surface]) { disc.planets[loc.surface] = this.now; found = Math.round(6000 * incomeOf(loc.sys)); p.credits += found; }
    const dep = this.surfDepleted(loc.surface), dead = this.surfDead(loc.surface);
    s.send({ t: 'surface', planet: loc.surface, sys: loc.sys, ship, shipType: p.ship.type, suit, restore: !!restore, now: this.now,
      depleted: [...dep.keys()], dead: [...dead.keys()], caps: Object.keys(p.surfCaps || {}), crates: Object.entries(p.surfCrates || {}).filter(([, t]) => t > this.now).map(([k]) => k),
      disc: Object.keys(disc.species).filter(k => k.startsWith(loc.surface + '#')).map(k => +k.split('#')[1]), recipes: RECIPES });
    if (found) this.notify(s, `Открыта планета ${P2.name} (${P2.biomeName}). Данные проданы картографам: +${fmt(found)} CR`, 'good');
    if (!restore) this.notify(s, `Посадка: ${P2.name}. ${P2.biomeName} · ${P2.temp[0]}…${P2.temp[1]} °C${P2.hz ? ' · опасность: ' + PG.HAZARD_NAME[P2.hz].toLowerCase() : ''}`, 'info');
    this.sendProfile(s);
  };

  // вход в игру с поверхности
  P.spawnInSpace = function (sess, sys, pos) {
    const p = sess.player;
    if (p.loc && p.loc.surface && this.surfProfile(p.loc.surface) && this.surfProfile(p.loc.surface).landable) return this.surfRestore(sess);
    return baseSpawnInSpace.call(this, sess, sys, pos);
  };
  P.surfRestore = function (sess) {
    this.sendSystem(sess);
    this.enterSurface(sess, true);
  };
  P.logout = function (sess, replaced) {
    if (sess.surf && sess.player) { const p = sess.player; p.loc.ship = sess.surf.ship; sess.surf = null; }
    return baseLogout.call(this, sess, replaced);
  };

  // ---------- взлёт ----------
  P.c_takeoff = function (s, m, p) {
    const u = s.surf;
    if (!u) return;
    if (!this.nearShip(s)) return this.notify(s, 'Подойдите к кораблю', 'warn');
    const c = this.U.celestials[u.planet];
    let how;
    if (this.padLaunch && this.padLaunch(s)) how = 'Взлёт с площадки базы — без топлива';
    else if (this.surfHave(s, 'launch_fuel') >= 1) { this.surfTake(s, 'launch_fuel', 1); how = 'Топливо взлёта израсходовано'; }
    else if (this.surfHave(s, 'res_dihydro') >= SURF.takeoffFuel) { this.surfTake(s, 'res_dihydro', SURF.takeoffFuel); how = `Израсходовано ${SURF.takeoffFuel} ди-водорода`; }
    else if (!m.emergency) return s.send({ t: 'takeoffFuel', need: SURF.takeoffFuel });
    else { p.ship.hp = { shield: 0, armor: Math.min(p.ship.hp.armor, 0.5), hull: Math.max(0.2, (p.ship.hp.hull || 1) * 0.65) }; how = 'Аварийный взлёт без топлива: двигатели перегружены, броня и корпус повреждены'; }
    // ресурсы костюма — в трюм (сколько поместится)
    const suit = this.suitOf(p), free0 = this.calcStats(p, p.ship).cargo - this.cargoUsed(p.ship.cargo);
    let free = free0, moved = 0;
    for (const [k, q] of Object.entries(suit.inv)) {
      const n = Math.min(q, Math.floor(free / ITEMS[k].vol));
      if (n <= 0) continue;
      p.ship.cargo[k] = (p.ship.cargo[k] || 0) + n; suit.inv[k] -= n; if (!suit.inv[k]) delete suit.inv[k]; free -= n * ITEMS[k].vol; moved += n;
    }
    const lon = u.ship[0] / 25000, lat = Math.max(-1.5, Math.min(1.5, u.ship[1] / 25000));
    const dir = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
    const pos = [c.pos[0] + dir[0] * (c.radius + 60000), c.pos[1] + dir[1] * (c.radius + 60000), c.pos[2] + dir[2] * (c.radius + 60000)];
    s.surf = null;
    p.loc = { sys: c.sys, pos };
    const e = this.makeShipEntity(p, c.sys, pos);
    e.vel = dir.map(v => v * e.stats.maxSpeed * 0.6); e.heading = dir.slice(); e.cmd = { type: 'stop' };
    e.invulnUntil = this.now + 8000;
    this.ents.set(e.id, e);
    e.session = s; s.ent = e;
    s.send({ t: 'surfaceLeft' });
    this.sendSystem(s);
    this.notify(s, `Взлёт с планеты ${c.name}. ${how}.${moved ? ` В трюм перенесено ресурсов: ${fmt(moved)}.` : ''}`, m.emergency ? 'warn' : 'good');
    this.sendProfile(s);
  };

  // ---------- положение игрока (для проверок) ----------
  P.c_surfPos = function (s, m) {
    const u = s.surf;
    if (!u || !Array.isArray(m.p) || m.p.length !== 3 || m.p.some(v => !Number.isFinite(v))) return;
    const dt = Math.max(0.05, (this.now - u.lastPos) / 1000);
    if (dist2([m.p[0], m.p[2]], [u.pos[0], u.pos[2]]) > 45 * dt + 8) return; // быстрее ранца не бегают — подозрительный скачок игнорируем
    u.pos = m.p.slice(); u.lastPos = this.now;
  };

  // ---------- истощённые узлы и убитые животные ----------
  P.surfDepleted = function (planet) {
    const all = this.surfDep || (this.surfDep = new Map());
    const m = all.get(planet) || all.set(planet, new Map()).get(planet);
    for (const [k, t] of m) if (t < this.now) m.delete(k);
    return m;
  };
  P.surfDead = function (planet) {
    const all = this.surfKill || (this.surfKill = new Map());
    const m = all.get(planet) || all.set(planet, new Map()).get(planet);
    for (const [k, t] of m) if (t < this.now) m.delete(k);
    return m;
  };

  // ---------- добыча ----------
  P.c_harvest = function (s, m, p) {
    const u = s.surf;
    if (!u) return;
    const P2 = this.surfProfile(u.planet), node = PG.findNode(P2, m.id);
    if (!node) return;
    const D = PG.NODES[node.kind], dep = this.surfDepleted(u.planet);
    const reply = (ok, extra) => s.send(Object.assign({ t: 'harvested', id: node.id, ok, suit: this.suitOf(p) }, extra || {}));
    if (dep.has(node.id)) return reply(false);
    const d = dist2([u.pos[0], u.pos[2]], [node.x, node.z]);
    if (d > (D.use ? SURF.useRange + 3 : SURF.mineRange + node.s * 3)) return reply(false, { why: 'далеко' });
    const suit = this.suitOf(p), speed = [1, 1, 1.6, 2.4][suit.lv.tool];
    if (!D.use && this.now - u.lastHarvest < D.t * 650 / speed) return reply(false, { why: 'слишком часто' });
    u.lastHarvest = this.now;
    if (node.kind === 'capsule') {
      const caps = p.surfCaps || (p.surfCaps = {});
      if (caps[u.planet + '|' + node.id]) return reply(false);
      caps[u.planet + '|' + node.id] = 1;
      if (suit.ups < SURF.capUps) { suit.ups++; suit.cap += SURF.capUp; this.notify(s, `Модуль костюма установлен: вместимость ${suit.cap} ед. (${suit.ups}/${SURF.capUps})`, 'good'); }
      else { this.suitAdd(p, 'surf_kit', 2); this.notify(s, 'Костюм улучшен до предела. В капсуле — 2 ремкомплекта', 'good'); }
      return reply(true, { use: true });
    }
    if (node.kind === 'crate') {
      const cr = p.surfCrates || (p.surfCrates = {}), k = u.planet + '|' + node.id;
      if (cr[k] && cr[k] > this.now) return reply(false);
      cr[k] = this.now + 2 * 3600000;
      const isk = Math.round(rnd(2000, 8000) * incomeOf(u.sys)); p.credits += isk;
      const loot = Math.random() < 0.5 ? ['energy_cell', 5] : Math.random() < 0.5 ? ['launch_fuel', 1] : ['surf_kit', 1];
      const n = this.suitAdd(p, loot[0], loot[1]);
      this.notify(s, `Контейнер вскрыт: ${fmt(isk)} CR${n ? `, ${ITEMS[loot[0]].name} ×${n}` : ''}`, 'good');
      this.sendProfile(s);
      return reply(true, { use: true });
    }
    let amount = node.amount;
    const got = this.suitAdd(p, node.item, amount);
    if (!got) { u.lastHarvest = 0; return reply(false, { why: 'полон', full: true }); }
    const bonus = node.kind === 'metal' && Math.random() < 0.3 ? this.suitAdd(p, 'res_ferrite', 20) : 0;
    dep.set(node.id, this.now + SURF.nodeRespawn);
    p.stats.harvested = (p.stats.harvested || 0) + got;
    reply(true, { item: node.item, amount: got, bonus, lost: amount - got });
  };

  // ---------- охота и приручение ----------
  P.c_hunt = function (s, m, p) {
    const u = s.surf;
    if (!u) return;
    const P2 = this.surfProfile(u.planet), c = PG.findCreature(P2, m.id);
    if (!c) return;
    const dead = this.surfDead(u.planet), sp = P2.species[c.sp];
    if (dead.has(c.id) || this.now - u.lastHunt < 1200) return;
    if (!Number.isFinite(m.x) || !Number.isFinite(m.z) || dist2([m.x, m.z], [c.x, c.z]) > 400 || dist2([u.pos[0], u.pos[2]], [m.x, m.z]) > SURF.huntRange) return; // животные бродят, но недалеко от стада
    u.lastHunt = this.now;
    dead.set(c.id, this.now + SURF.creatureRespawn);
    const meat = this.suitAdd(p, 'bio_meat', sp.meat), hide = sp.hide ? this.suitAdd(p, 'bio_hide', sp.hide) : 0;
    p.stats.hunted = (p.stats.hunted || 0) + 1;
    s.send({ t: 'hunted', id: c.id, meat, hide, suit: this.suitOf(p) });
  };
  P.c_feed = function (s, m, p) {
    const u = s.surf;
    if (!u) return;
    const P2 = this.surfProfile(u.planet), c = PG.findCreature(P2, m.id);
    if (!c) return;
    const sp = P2.species[c.sp], fed = this.surfFed || (this.surfFed = new Map()), k = u.planet + '|' + c.id + '|' + p.name;
    if ((fed.get(k) || 0) > this.now) return this.notify(s, `${sp.name} уже сыт`, 'info');
    if (!Number.isFinite(m.x) || dist2([u.pos[0], u.pos[2]], [m.x, m.z]) > 12) return;
    const food = sp.diet === 'Плотоядное' ? ['bio_meat', 1] : ['res_carbon', 10];
    if (this.surfHave(s, food[0]) < food[1]) return this.notify(s, `Нужно для кормления: ${ITEMS[food[0]].name} ×${food[1]}`, 'warn');
    this.surfTake(s, food[0], food[1]);
    fed.set(k, this.now + SURF.feedCooldown);
    const gel = this.suitAdd(p, 'bio_gel', 1 + Math.floor(Math.random() * 3));
    s.send({ t: 'fed', id: c.id, gel, suit: this.suitOf(p) });
  };
  // ---------- открытия ----------
  P.c_discover = function (s, m, p) {
    const u = s.surf;
    if (!u) return;
    const P2 = this.surfProfile(u.planet), sp = P2.species[m.idx];
    if (!sp) return;
    const disc = this.discOf(p), k = u.planet + '#' + sp.idx;
    if (disc.species[k]) return;
    disc.species[k] = this.now;
    const reward = Math.round(2500 * sp.rarity * sp.rarity * incomeOf(u.sys));
    p.credits += reward;
    const all = P2.species.filter(x => disc.species[u.planet + '#' + x.idx]).length;
    let bonus = 0;
    if (all === P2.species.length) { bonus = Math.round(25000 * incomeOf(u.sys)); p.credits += bonus; }
    s.send({ t: 'discovered', idx: sp.idx, reward, bonus, count: all, total: P2.species.length });
    this.sendProfile(s);
  };

  // ---------- костюм ----------
  P.c_suitUse = function (s, m, p) {
    if (!s.surf) return;
    const suit = this.suitOf(p), need = Math.max(1, Math.min(100, Math.floor(+m.need) || 1));
    if (m.item === 'surf_kit') { if (!this.surfTake(s, 'surf_kit', 1)) return; suit.hp = Math.min(100, suit.hp + 60); }
    else if (m.item === 'res_oxygen' || m.item === 'res_sodium') {
      const used = this.surfTake(s, m.item, need);
      if (!used) return this.notify(s, `Нет: ${ITEMS[m.item].name}`, 'warn');
      if (m.item === 'res_oxygen') suit.ls = Math.min(100, suit.ls + used); else suit.hz = Math.min(100, suit.hz + used);
    } else return;
    s.send({ t: 'suit', suit });
  };
  P.c_suitState = function (s, m, p) {
    if (!s.surf) return;
    const suit = this.suitOf(p), n = (v) => Number.isFinite(+v) ? Math.max(0, Math.min(100, +v)) : null;
    for (const k of ['hp', 'ls', 'hz']) { const v = n(m[k]); if (v !== null) suit[k] = v; }
  };
  P.c_surfDeath = function (s, m, p) {
    const u = s.surf;
    if (!u) return;
    const suit = this.suitOf(p), lost = [];
    for (const [k, q] of Object.entries(suit.inv)) { const n = Math.floor(q / 2); if (n) { suit.inv[k] -= n; lost.push(`${ITEMS[k].name} ×${n}`); } if (!suit.inv[k]) delete suit.inv[k]; }
    suit.hp = 100; suit.ls = Math.max(suit.ls, 50); suit.hz = Math.max(suit.hz, 50);
    u.pos = [u.ship[0] + 6, u.pos[1], u.ship[1] + 4];
    p.stats.deaths++;
    s.send({ t: 'surfRespawn', suit, lost });
  };
  // перенос между костюмом и трюмом (рядом с кораблём)
  P.c_suitXfer = function (s, m, p) {
    if (!s.surf || !this.nearShip(s) || !ITEMS[m.item]) return;
    const suit = this.suitOf(p);
    if (m.to === 'ship') {
      const free = this.calcStats(p, p.ship).cargo - this.cargoUsed(p.ship.cargo);
      const n = Math.min(suit.inv[m.item] || 0, Math.floor(free / ITEMS[m.item].vol), Math.floor(+m.qty) || Infinity);
      if (n <= 0) return this.notify(s, 'В трюме нет места', 'warn');
      suit.inv[m.item] -= n; if (!suit.inv[m.item]) delete suit.inv[m.item];
      p.ship.cargo[m.item] = (p.ship.cargo[m.item] || 0) + n;
    } else {
      const n = this.suitAdd(p, m.item, Math.min(p.ship.cargo[m.item] || 0, Math.floor(+m.qty) || Infinity));
      if (!n) return this.notify(s, 'Костюм полон', 'warn');
      p.ship.cargo[m.item] -= n; if (!p.ship.cargo[m.item]) delete p.ship.cargo[m.item];
    }
    s.send({ t: 'suit', suit }); this.sendProfile(s);
  };
  P.c_craft = function (s, m, p) {
    if (!s.surf) return;
    const R = RECIPES[m.recipe];
    if (!R) return;
    const suit = this.suitOf(p);
    if (R.up && suit.lv[R.up[0]] >= R.up[1]) return this.notify(s, 'Уже установлено', 'info');
    if (R.up && suit.lv[R.up[0]] < R.up[1] - 1) return this.notify(s, 'Сначала нужно предыдущее улучшение', 'warn');
    const miss = Object.entries(R.in).filter(([k, q]) => this.surfHave(s, k) < q).map(([k, q]) => `${ITEMS[k].name} ${this.surfHave(s, k)}/${q}`);
    if (miss.length) return this.notify(s, `Не хватает: ${miss.join(', ')}`, 'warn');
    for (const [k, q] of Object.entries(R.in)) this.surfTake(s, k, q);
    if (R.up) suit.lv[R.up[0]] = R.up[1];
    for (const [k, q] of Object.entries(R.out || {})) {
      const n = this.suitAdd(p, k, q);
      if (n < q) p.ship.cargo[k] = (p.ship.cargo[k] || 0) + (q - n);
    }
    this.notify(s, `Изготовлено: ${R.name}`, 'good');
    s.send({ t: 'suit', suit }); this.sendProfile(s);
  };
  // сбитый дрон-смотритель
  P.c_sentinelKill = function (s, m, p) {
    const u = s.surf;
    if (!u || this.now - u.lastSentinel < 2500) return;
    u.lastSentinel = this.now;
    const core = Math.random() < 0.6 ? this.suitAdd(p, 'sentinel_core', 1) : 0, fe = this.suitAdd(p, 'res_ferrite', 20);
    s.send({ t: 'suit', suit: this.suitOf(p) });
    if (core) this.notify(s, `Смотритель сбит: Ядро смотрителя ×1, Ферритовая пыль ×${fe}`, 'good');
  };
};
module.exports.SURF = SURF;
module.exports.RECIPES = RECIPES;
