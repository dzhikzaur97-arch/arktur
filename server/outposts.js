// Базы на планетах: игрок строит на поверхности посадочную площадку, добытчик и склад.
// Добытчик сам добывает особый ресурс планеты и металл её жил — даже когда пилота нет в игре (считается при посещении),
// добыча копится на складе базы. С площадки взлёт бесплатный, а посадка на эту планету — сразу на базу.
// Стройматериалы — ресурсы планет: из костюма, со склада базы и (рядом с кораблём) из трюма.
'use strict';
const { ITEMS } = require('./data');

const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const OUT = {
  maxBases: 3,        // баз у одного пилота
  range: 32,          // радиус базы: строить, забирать и складывать можно только рядом
  minFromShip: 0,
  // постройки: стоимость каждого уровня (ресурсы + CR). METAL и SPECIAL — металл жил и особый ресурс этой планеты
  build: {
    pad:       { name: 'Посадочная площадка', max: 1, desc: 'Корабль садится прямо на базу, взлёт с площадки — без топлива',
      cost: [{ res_ferrite: 150, res_carbon: 60 }], isk: [25000] },
    extractor: { name: 'Добытчик', max: 3, desc: 'Сам добывает особый ресурс и металл планеты, пока вас нет',
      cost: [{ res_ferrite: 120, res_carbon: 40 }, { res_ferrite: 220, METAL: 60 }, { res_ferrite: 320, METAL: 120, SPECIAL: 80 }], isk: [30000, 90000, 240000] },
    silo:      { name: 'Склад', max: 3, desc: 'Хранит добычу базы и ваши ресурсы',
      cost: [{ res_ferrite: 100 }, { res_ferrite: 200, res_carbon: 100 }, { res_ferrite: 350, METAL: 80 }], isk: [15000, 50000, 150000] }
  },
  rate: [0, 40, 90, 160],          // особого ресурса в час по уровню добытчика; металла — вдвое меньше
  cap: [200, 1000, 3000, 8000],    // вместимость склада по уровню (без склада — 200 ед. в бункере добытчика)
  // где стоят постройки относительно центра базы (площадка — в центре)
  layout: { pad: [0, 0], extractor: [16, 5], silo: [-14, 7] }
};

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseEnter = P.enterSurface;

  const used = (o) => Object.values(o.store).reduce((a, b) => a + b, 0);
  const capOf = (o) => OUT.cap[o.b.silo || 0];
  const resolve = (k, prof) => k === 'METAL' ? prof.metal : k === 'SPECIAL' ? prof.special : k;
  P.outOf = function (p, planet) { return (p.outposts || {})[planet] || null; };
  // добыча за прошедшее время (в том числе пока пилот был не в сети)
  P.outAccrue = function (o, planet, p) {
    const lv = o.b.extractor || 0, now = this.now, tk = p && this.techHas && this.techHas(p, 'base1') ? 1.3 : 1;
    if (!lv) { o.at = now; return; }
    const prof = this.surfProfile(planet); if (!prof) return;
    const h = Math.max(0, (now - (o.at || now)) / 3600000);
    o.at = now; o.frac = o.frac || {};
    for (const [item, per] of [[prof.special, OUT.rate[lv] * tk], [prof.metal, OUT.rate[lv] / 2 * tk]]) {
      const v = (o.frac[item] || 0) + per * h, n = Math.floor(v);
      o.frac[item] = v - n;
      const room = capOf(o) - used(o), add = Math.max(0, Math.min(n, room));
      if (add) o.store[item] = (o.store[item] || 0) + add;
      if (add < n) o.frac[item] = 0; // склад полон — лишнее не копится
    }
  };
  P.outView = function (p, planet) {
    const o = this.outOf(p, planet), prof = this.surfProfile(planet);
    const defs = Object.fromEntries(Object.entries(OUT.build).map(([k, d]) => [k, { name: d.name, desc: d.desc, max: d.max,
      next: (o ? o.b[k] || 0 : 0) < d.max ? { cost: Object.fromEntries(Object.entries(d.cost[o ? o.b[k] || 0 : 0]).map(([r, q]) => [resolve(r, prof), q])), isk: d.isk[o ? o.b[k] || 0 : 0] } : null }]));
    const base = o ? { x: o.x, z: o.z, b: o.b, store: o.store, cap: capOf(o), rate: OUT.rate[o.b.extractor || 0] } : null;
    return { t: 'outpost', planet, base, defs, layout: OUT.layout, range: OUT.range, special: prof && prof.special, metal: prof && prof.metal,
      count: Object.keys(p.outposts || {}).length, max: OUT.maxBases };
  };
  P.outSend = function (s) { if (s.surf) { const o = this.outOf(s.player, s.surf.planet); if (o) this.outAccrue(o, s.surf.planet, s.player); s.send(this.outView(s.player, s.surf.planet)); } };
  const nearBase = (s, o) => !!o && dist2([s.surf.pos[0], s.surf.pos[2]], [o.x, o.z]) <= OUT.range;

  // сколько ресурса доступно для стройки: костюм + склад базы (рядом с базой) + трюм (рядом с кораблём)
  P.outHave = function (s, o, item) { return this.surfHave(s, item) + (nearBase(s, o) ? o.store[item] || 0 : 0); };
  P.outTake = function (s, o, item, qty) {
    let rest = qty;
    if (nearBase(s, o)) { const a = Math.min(rest, o.store[item] || 0); if (a) { o.store[item] -= a; if (!o.store[item]) delete o.store[item]; rest -= a; } }
    if (rest > 0) rest -= this.surfTake(s, item, rest);
    return qty - rest;
  };

  P.c_outpost = function (s) { this.outSend(s); };
  P.c_outBuild = function (s, m, p) {
    const u = s.surf; if (!u) return;
    const d = OUT.build[m.k]; if (!d) return;
    p.outposts = p.outposts || {};
    let o = this.outOf(p, u.planet);
    const prof = this.surfProfile(u.planet); if (!prof || !prof.landable) return;
    if (this.U.byId[u.sys] && this.U.byId[u.sys].wormhole) return this.notify(s, 'Здесь базу не построить: червоточина скоро схлопнется', 'warn');
    if (!o && Object.keys(p.outposts).length >= OUT.maxBases) return this.notify(s, `Баз может быть не больше ${OUT.maxBases}. Разберите старую базу, чтобы заложить новую`, 'warn');
    // новая база закладывается там, где стоит пилот
    const draft = o || { x: Math.round(u.pos[0]), z: Math.round(u.pos[2]), b: {}, store: {}, at: this.now, since: this.now };
    if (o && !nearBase(s, o)) return this.notify(s, `Подойдите к базе (ближе ${OUT.range} м)`, 'warn');
    if (!o && prof.liquidY !== null && u.pos[1] < prof.liquidY + 1) return this.notify(s, 'Здесь не построить — нужна твёрдая земля', 'warn');
    if (o) this.outAccrue(o, u.planet, p);
    const lv = draft.b[m.k] || 0;
    if (lv >= d.max) return this.notify(s, `${d.name}: уже максимальный уровень`, 'warn');
    const cost = Object.entries(d.cost[lv]).map(([r, q]) => [resolve(r, prof), q]), isk = d.isk[lv];
    const lack = cost.filter(([r, q]) => this.outHave(s, o, r) < q);
    if (lack.length) return this.notify(s, `Не хватает: ${lack.map(([r, q]) => `${ITEMS[r].name} ${this.outHave(s, o, r)}/${q}`).join(', ')}`, 'warn');
    if (p.credits < isk) return this.notify(s, `Недостаточно CR: нужно ${fmt(isk)}`, 'warn');
    for (const [r, q] of cost) this.outTake(s, o, r, q);
    p.credits -= isk;
    if (!o) { p.outposts[u.planet] = o = draft; p.stats.outposts = (p.stats.outposts || 0) + 1; }
    o.b[m.k] = lv + 1; if (m.k === 'extractor' && lv === 0) o.at = this.now;
    this.notify(s, lv ? `${d.name} улучшен до уровня ${lv + 1}` : `${d.name} построен${d.name.endsWith('а') ? 'а' : ''}${Object.keys(o.b).length === 1 ? '. Это ваша база на планете ' + prof.name : ''}`, 'good');
    this.sendProfile(s); s.send({ t: 'suit', suit: this.suitOf(p) }); this.outSend(s); this.save();
  };
  // забрать со склада в костюм (или всё — в трюм, если корабль рядом)
  P.c_outTake = function (s, m, p) {
    const u = s.surf; if (!u) return;
    const o = this.outOf(p, u.planet); if (!nearBase(s, o)) return this.notify(s, 'Подойдите к базе', 'warn');
    this.outAccrue(o, u.planet, p);
    let moved = 0;
    for (const [k, q] of Object.entries(o.store)) {
      if (m.item && m.item !== k) continue;
      const n = this.suitAdd(p, k, q);
      if (n) { o.store[k] -= n; if (!o.store[k]) delete o.store[k]; moved += n; }
    }
    if (!moved) this.notify(s, 'Костюм полон — перенесите ресурсы в трюм корабля', 'warn');
    s.send({ t: 'suit', suit: this.suitOf(p) }); this.outSend(s);
  };
  // сложить ресурсы костюма на склад
  P.c_outPut = function (s, m, p) {
    const u = s.surf; if (!u) return;
    const o = this.outOf(p, u.planet); if (!nearBase(s, o)) return this.notify(s, 'Подойдите к базе', 'warn');
    this.outAccrue(o, u.planet, p);
    const suit = this.suitOf(p);
    let moved = 0;
    for (const [k, q] of Object.entries(suit.inv)) {
      if (m.item && m.item !== k) continue;
      if (!k.startsWith('res_') && !k.startsWith('bio_')) continue;
      const n = Math.max(0, Math.min(q, capOf(o) - used(o)));
      if (!n) break;
      o.store[k] = (o.store[k] || 0) + n; suit.inv[k] -= n; if (!suit.inv[k]) delete suit.inv[k]; moved += n;
    }
    if (!moved) this.notify(s, 'Склад базы полон — улучшите склад', 'warn');
    s.send({ t: 'suit', suit }); this.outSend(s);
  };
  P.c_outDemolish = function (s, m, p) {
    const u = s.surf; if (!u) return;
    const o = this.outOf(p, u.planet); if (!o) return;
    if (!nearBase(s, o)) return this.notify(s, 'Подойдите к базе', 'warn');
    delete p.outposts[u.planet];
    this.notify(s, 'База разобрана. Ресурсы склада потеряны', 'info');
    this.outSend(s); this.save();
  };
  // взлёт с площадки — без топлива (проверка в c_takeoff)
  P.padLaunch = function (s) {
    const u = s.surf, o = u && this.outOf(s.player, u.planet);
    return !!(o && o.b.pad && dist2(u.ship, [o.x, o.z]) < 3);
  };
  // посадка на планету, где есть площадка, — прямо на базу
  P.enterSurface = function (s, restore) {
    const p = s.player, loc = p.loc, o = loc && this.outOf(p, loc.surface);
    if (!restore && o && o.b.pad) { loc.site = [o.x, o.z]; loc.ship = [o.x, o.z]; }
    const r = baseEnter.call(this, s, restore);
    if (o) { this.outAccrue(o, loc.surface, p); if (!restore && o.b.pad) this.notify(s, 'Посадка на площадку вашей базы', 'good'); }
    if (s.surf) s.send(this.outView(p, loc.surface));
    return r;
  };
  // список баз (окно «Имущество»)
  P.c_outList = function (s, m, p) {
    const list = Object.entries(p.outposts || {}).map(([planet, o]) => {
      this.outAccrue(o, planet, p);
      const c = this.U.celestials[planet];
      return { planet, name: c ? c.name : planet, sys: c && c.sys, b: o.b, used: used(o), cap: capOf(o), rate: OUT.rate[o.b.extractor || 0] };
    });
    s.send({ t: 'outList', list });
  };
};
module.exports.OUT = OUT;
