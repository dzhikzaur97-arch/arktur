// Своя верфь: на собственной станции игрока (перерабатывающий завод) есть сборочный цех и стапель.
//  · сборочный цех делает детали кораблей из материалов переработки (сталь, керамит, кристаллит, нуль-сплав, ксенон-ядра);
//    детали дороже материалов на четверть-треть — их можно продать или пустить в дело;
//  · стапель собирает корабль из деталей и небольшого сбора — заметно дешевле, чем купить на рынке.
// Детали и корабли появляются в ангаре этой станции. Цех работает, даже когда пилота нет в игре. Каждая деталь тратит энергоячейку.
'use strict';
const { ITEMS, SHIPS } = require('./data');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');

const PARTS = {
  part_plate:   { in: { mat_steel: 30, mat_ceramite: 10 }, time: 20 },
  part_engine:  { in: { mat_steel: 20, mat_crystal: 6 }, time: 30 },
  part_control: { in: { mat_ceramite: 20, mat_crystal: 4 }, time: 30 },
  part_reactor: { in: { mat_crystal: 10, mat_nullalloy: 3 }, time: 60 },
  part_warp:    { in: { mat_nullalloy: 6, mat_xcore: 1 }, time: 90 },
  part_fusion:  { in: { gas_h3: 30, mat_crystal: 4 }, time: 40 },
  cells_gas:    { in: { gas_h3: 10 }, out: 'energy_cell', qty: 6, time: 10, noCells: true }   // гелий-3 → энергоячейки
};
const YARD = { maxQueue: 4, maxRuns: 50, cells: 1, fee: 0.2, partsShare: 0.55, bigShip: 1500000 };
// доля деталей по назначению корабля (по стоимости)
const MIX = {
  combat:    { part_plate: 0.4, part_engine: 0.2, part_reactor: 0.25, part_control: 0.15 },
  mining:    { part_plate: 0.35, part_engine: 0.25, part_reactor: 0.2, part_control: 0.2 },
  transport: { part_plate: 0.45, part_engine: 0.3, part_reactor: 0.15, part_control: 0.1 },
  carrier:   { part_plate: 0.3, part_engine: 0.2, part_reactor: 0.25, part_control: 0.25 },
  explore:   { part_plate: 0.25, part_engine: 0.3, part_reactor: 0.2, part_control: 0.25 }
};
// что нужно для сборки корабля: детали, сбор и время
function shipRecipe(type) {
  const T = SHIPS[type];
  if (!T || !(T.price > 0) || T.unique || T.fac) return null;
  const mix = Object.assign({}, MIX[T.role] || MIX.combat);
  if (T.price >= YARD.bigShip) { for (const k in mix) mix[k] *= 0.9; mix.part_warp = 0.1; }
  const parts = {};
  for (const [k, sh] of Object.entries(mix)) { const n = Math.round(T.price * YARD.partsShare * sh / ITEMS[k].base); if (n > 0) parts[k] = n; }
  if (!Object.keys(parts).length) parts.part_plate = 1;
  return { parts, fee: Math.round(T.price * YARD.fee), time: Math.round(30 + Math.sqrt(T.price) * 0.25) };
}

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick, baseInfo = P.c_structInfo;

  P.yardView = function (st) {
    return { parts: PARTS, queue: st.asm || [], ships: Object.fromEntries(Object.keys(SHIPS).map(t => [t, shipRecipe(t)]).filter(([, r]) => r)), maxQueue: YARD.maxQueue, cells: YARD.cells };
  };
  // сведения о станции дополняем верфью
  P.c_structInfo = function (s, m, p) {
    const r = baseInfo.call(this, s, m, p);
    const st = this.myStructure(p);
    if (st && !st.buildUntil) s.send(Object.assign({ t: 'yard' }, this.yardView(st)));
    return r;
  };
  const queueEnd = (st, now) => Math.max(now, ...(st.asm || []).map(j => j.end));

  // сборочный цех: детали из материалов ангара станции
  P.c_partMake = function (s, m, p) {
    const st = this.ownStation(s, p); if (!st) return;
    const R = PARTS[m.part]; if (!R) return;
    st.asm = st.asm || [];
    if (st.asm.length >= YARD.maxQueue) return this.notify(s, `В очереди цеха не больше ${YARD.maxQueue} заказов`, 'warn');
    const runs = Math.max(1, Math.min(YARD.maxRuns, Math.floor(+m.runs) || 1));
    const h = this.hangar(p, st.id).items;
    const need = Object.assign({}, ...Object.entries(R.in).map(([k, q]) => ({ [k]: q * runs })), R.noCells ? {} : { energy_cell: YARD.cells * runs });
    const lack = Object.entries(need).filter(([k, q]) => (h[k] || 0) < q);
    if (lack.length) return this.notify(s, `Не хватает в ангаре станции: ${lack.map(([k, q]) => `${ITEMS[k].name} ${h[k] || 0}/${q}`).join(', ')}`, 'warn');
    for (const [k, q] of Object.entries(need)) { h[k] -= q; if (!h[k]) delete h[k]; }
    const lv = require('./data').REFINERY.levels[st.level] || { speed: 1 };
    const start = queueEnd(st, this.now), dur = R.time * runs / lv.speed * 1000;
    const out = R.out || m.part, outQty = (R.qty || 1) * runs;
    st.asm.push({ kind: 'part', item: out, qty: outQty, start, end: start + dur });
    this.notify(s, `Цех: ${ITEMS[out].name} ×${outQty} — готово через ${fmt(Math.ceil((start + dur - this.now) / 60000))} мин`, 'good');
    this.sendProfile(s); this.c_structInfo(s, m, p); this.save(true);
  };
  // стапель: корабль из деталей
  P.c_yardBuild = function (s, m, p) {
    const st = this.ownStation(s, p); if (!st) return;
    const R = shipRecipe(m.ship); if (!R) return this.notify(s, 'Этот корабль на своей верфи не собрать', 'warn');
    st.asm = st.asm || [];
    if (st.asm.length >= YARD.maxQueue) return this.notify(s, `В очереди цеха не больше ${YARD.maxQueue} заказов`, 'warn');
    const h = this.hangar(p, st.id).items;
    const lack = Object.entries(R.parts).filter(([k, q]) => (h[k] || 0) < q);
    if (lack.length) return this.notify(s, `Не хватает деталей: ${lack.map(([k, q]) => `${ITEMS[k].name} ${h[k] || 0}/${q}`).join(', ')}`, 'warn');
    if (p.credits < R.fee) return this.notify(s, `Недостаточно CR: нужно ${fmt(R.fee)}`, 'warn');
    for (const [k, q] of Object.entries(R.parts)) { h[k] -= q; if (!h[k]) delete h[k]; }
    p.credits -= R.fee;
    const lv = require('./data').REFINERY.levels[st.level] || { speed: 1 };
    const start = queueEnd(st, this.now), dur = R.time / lv.speed * 1000;
    st.asm.push({ kind: 'ship', item: m.ship, qty: 1, start, end: start + dur });
    p.stats.yardShips = (p.stats.yardShips || 0) + 1;
    this.notify(s, `Стапель: заложен корабль «${SHIPS[m.ship].name}» — готов через ${fmt(Math.ceil(dur / 60000))} мин`, 'good');
    this.sendProfile(s); this.c_structInfo(s, m, p); this.save(true);
  };
  // готовые заказы — в ангар станции (и без игрока в сети)
  P.yardTick = function () {
    for (const st of this.db.structures || []) {
      if (!st.asm || !st.asm.length) continue;
      const done = st.asm.filter(j => this.now >= j.end);
      if (!done.length) continue;
      st.asm = st.asm.filter(j => this.now < j.end);
      const p = this.db.players[st.owner]; if (!p) continue;
      const h = this.hangar(p, st.id);
      const s = [...this.sessions].find(x => x.player === p);
      for (const j of done) {
        if (j.kind === 'ship') { h.ships.push(this.newShip(j.item, false)); if (s) this.notify(s, `⚓ Верфь «${st.name}»: корабль «${SHIPS[j.item].name}» готов — он в ангаре станции`, 'good'); }
        else { h.items[j.item] = (h.items[j.item] || 0) + j.qty; if (s) this.notify(s, `⚙ Цех «${st.name}»: ${ITEMS[j.item].name} ×${j.qty} готово`, 'good'); }
      }
      if (s) { this.sendProfile(s); if (s.docked === st.id) this.c_structInfo(s, {}, p); }
      this.save(true);
    }
  };
  P.slowTick = function () { baseSlow.call(this); this.yardTick(); };
};
module.exports.PARTS = PARTS;
module.exports.shipRecipe = shipRecipe;
