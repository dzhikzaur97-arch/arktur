// Торговля товарами между регионами.
//
// 14 товаров: каждый дёшево производится в одних регионах и дорого нужен в других. У каждой станции к тому же
// своя специализация: 2 товара она выпускает особенно дёшево, на 2 других у неё повышенный спрос.
// Станция продаёт товар только там, где он производится (цена ниже обычной), и покупает любой товар.
//
// Насыщение рынка: каждая партия сдвигает цены. Продали много — цена у станции падает, скупили — растёт.
// Отклонение запаса рассасывается за ~40 минут. Поэтому выгоднее возить несколько товаров партиями
// в разные места, а не один товар бесконечно. Окно «Торговля» на станции ищет лучшие маршруты в пределах 8 прыжков.
'use strict';
const { ITEMS, SYSTEMS } = require('./data');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// id, название, базовая цена, объём, где производят (дёшево), где нужен (дорого)
const GOODS = [
  ['tg_food', 'Пайки и консервы', 60, 1, ['core'], ['low', 'null', 'deep']],
  ['tg_water', 'Очищенный лёд', 35, 2, ['border', 'deep'], ['core']],
  ['tg_med', 'Медикаменты', 420, 0.5, ['core'], ['low', 'null']],
  ['tg_tech', 'Электроника', 900, 0.5, ['core'], ['border', 'deep']],
  ['tg_mach', 'Станки и механизмы', 650, 3, ['border'], ['low', 'deep']],
  ['tg_fuel', 'Реакторное топливо', 240, 1, ['low'], ['core', 'border']],
  ['tg_alloy', 'Конструкционные сплавы', 180, 2, ['low', 'null'], ['core']],
  ['tg_spice', 'Ксенопряности', 1600, 0.2, ['deep'], ['core', 'border']],
  ['tg_wine', 'Вина Пограничья', 1100, 0.5, ['border'], ['core', 'null']],
  ['tg_art', 'Предметы искусства', 5200, 0.2, ['core'], ['null', 'deep']],
  ['tg_cool', 'Хладагент', 120, 2, ['null'], ['low', 'border']],
  ['tg_gear', 'Оружейные узлы', 1400, 1, ['null'], ['border', 'low']],
  ['tg_terra', 'Наборы терраформинга', 2600, 4, ['core', 'border'], ['deep']],
  ['tg_relicdust', 'Пыль Предтеч', 3800, 0.1, ['deep'], ['core']]
];
const TR = { from: 0.66, to: 1.45, spread: 0.06, tau: 40 * 60000, depthCr: 700000, maxJumps: 8, special: 0.12 };
const G = {};
for (const [id, name, base, vol, from, to] of GOODS) {
  G[id] = { from, to, depth: clamp(Math.round(TR.depthCr / base), 120, 8000) };
  ITEMS[id] = { name, cat: 'Товары', base, vol, trade: true, desc: `Производят: ${from.map(r => regionName(r)).join(', ')}. Нужен: ${to.map(r => regionName(r)).join(', ')}` };
}
function regionName(r) { try { return require('./data').REGIONS[r].name; } catch (e) { return r; } }
// детерминированный «случай» по станции и товару
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSell = P.c_sell, baseBuy = P.c_buy, basePrice = P.priceOf, baseSlow = P.slowTick;

  P.tradeRegion = function (st) { const c = this.U.celestials[st]; const sys = c && this.U.byId[c.sys]; return sys && sys.region; };
  // базовый множитель станции для товара: регион × специализация станции × небольшой разброс
  P.tradeMul = function (st, id) {
    const g = G[id], reg = this.tradeRegion(st);
    let m = g.from.includes(reg) ? TR.from : g.to.includes(reg) ? TR.to : 1;
    const ids = Object.keys(G), h = hash(st);
    const cheap = [ids[Math.floor(h * ids.length)], ids[Math.floor(hash(st + 'b') * ids.length)]];
    const need = [ids[Math.floor(hash(st + 'c') * ids.length)], ids[Math.floor(hash(st + 'd') * ids.length)]];
    if (cheap.includes(id) && !need.includes(id)) m *= 1 - TR.special * 1.5;
    if (need.includes(id) && !cheap.includes(id)) m *= 1 + TR.special * 2;
    m *= 0.94 + 0.12 * hash(st + id);
    const sys = this.U.byId[this.U.celestials[st].sys];
    if (sys && sys.sec < 0.5 && m > 1) m *= 1.08; // опасные системы платят больше
    return m;
  };
  const book = (g) => g.db.tradeBook || (g.db.tradeBook = {});
  P.tradeDev = function (st, id) {
    const b = book(this), k = st + '|' + id, e = b[k];
    if (!e) return 0;
    const d = e.d * Math.exp(-(this.now - e.at) / TR.tau);
    if (Math.abs(d) < 1) { delete b[k]; return 0; }
    return d;
  };
  P.tradeShift = function (st, id, q) { const b = book(this), d = this.tradeDev(st, id); b[st + '|' + id] = { d: d + q, at: this.now }; };
  P.tradeSells = function (st, id) { return this.tradeMul(st, id) <= 0.95; }; // станция продаёт товар, только если он здесь производится
  // цена за 1 ед. сейчас (side: 'sell' — станция платит игроку, 'buy' — игрок платит станции)
  P.tradeUnit = function (st, id, side) {
    const g = G[id], k = Math.exp(-this.tradeDev(st, id) / g.depth);
    return ITEMS[id].base * this.tradeMul(st, id) * k * (side === 'buy' ? 1 + TR.spread : 1 - TR.spread);
  };
  // сумма за партию с учётом сдвига цены внутри партии
  P.tradeTotal = function (st, id, q, side) {
    const D = G[id].depth, u = this.tradeUnit(st, id, side), x = q / D;
    if (x < 1e-6) return u * q;
    return side === 'sell' ? u * q * (1 - Math.exp(-x)) / x : u * q * (Math.exp(x) - 1) / x;
  };

  P.priceOf = function (st, item) { return G[item] ? Math.round(this.tradeUnit(st, item, 'sell')) : basePrice.apply(this, arguments); };

  P.tradeView = function (s, p) {
    const st = s.docked, here = this.U.celestials[st], h = this.hangar(p, st).items, cargo = p.ship.cargo;
    const free = this.calcStats(p, p.ship).cargo - this.cargoUsed(cargo);
    const tax = Math.max(0, 0.04 - 0.01 * (p.skills.trade || 0));
    const goods = Object.keys(G).map(id => ({ id, name: ITEMS[id].name, vol: ITEMS[id].vol, base: ITEMS[id].base,
      buy: this.tradeSells(st, id) ? Math.round(this.tradeUnit(st, id, 'buy')) : null, sell: Math.round(this.tradeUnit(st, id, 'sell') * (1 - tax)),
      have: (h[id] || 0) + (cargo[id] || 0), depth: G[id].depth }));
    // маршруты: что купить здесь и где продать в пределах 8 прыжков
    const dist = { [here.sys]: 0 }, q = [here.sys];
    while (q.length) { const c = q.shift(); if (dist[c] >= TR.maxJumps) continue; for (const n of this.U.neighbors[c] || []) if (!(n in dist)) { dist[n] = dist[c] + 1; q.push(n); } }
    const stations = Object.values(this.U.celestials).filter(c => c.kind === 'station' && c.id !== st && c.sys in dist && !c.owner);
    const routes = [];
    const room = Math.max(free, 0);
    for (const g of goods) {
      if (g.buy == null) continue;
      let best = null;
      for (const o of stations) {
        const sellU = this.tradeUnit(o.id, g.id, 'sell') * (1 - tax), prof = sellU - g.buy;
        if (prof <= g.buy * 0.08) continue;
        const score = prof / g.vol / (1 + dist[o.sys] * 0.35);
        if (!best || score > best.score) best = { score, o, sellU, prof };
      }
      if (!best) continue;
      // сколько выгодно везти: пока средняя прибыль на единицу остаётся положительной (ограничено трюмом)
      const D = G[g.id].depth;
      let qty = Math.min(Math.floor(room / g.vol), Math.round(D * 0.9));
      const profitOf = (n) => this.tradeTotal(o2(best), g.id, n, 'sell') * (1 - tax) - this.tradeTotal(st, g.id, n, 'buy');
      function o2(b) { return b.o.id; }
      while (qty > 10 && profitOf(qty) < profitOf(Math.floor(qty * 0.8))) qty = Math.floor(qty * 0.8);
      const sys = this.U.byId[best.o.sys];
      routes.push({ id: g.id, name: g.name, buy: g.buy, sell: Math.round(best.sellU), unit: Math.round(best.prof), per: Math.round(best.prof / g.vol),
        to: best.o.id, toName: best.o.name, sys: best.o.sys, sysName: sys.name, sec: sys.sec, jumps: dist[best.o.sys], qty: Math.max(0, qty), total: qty > 0 ? Math.round(profitOf(qty)) : 0 });
    }
    routes.sort((a, b) => b.total / (1 + b.jumps * 0.35) - a.total / (1 + a.jumps * 0.35) || b.per - a.per);
    return { t: 'trade', station: here.name, region: regionName(this.tradeRegion(st)), goods, routes: routes.slice(0, 8), free: Math.floor(room), tax };
  };
  P.c_tradeInfo = function (s, m, p) { if (!this.requireDocked(s)) return; s.send(this.tradeView(s, p)); };

  P.c_tradeBuy = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const id = m.item; if (!G[id]) return;
    if (!this.tradeSells(st, id)) return this.notify(s, `«${ITEMS[id].name}» здесь не производят — купить нельзя`, 'warn');
    let qty = clamp(Math.floor(+m.qty) || 0, 1, 200000);
    const cost = Math.round(this.tradeTotal(st, id, qty, 'buy'));
    if (p.credits < cost) return this.notify(s, `Недостаточно CR: нужно ${fmt(cost)}`, 'warn');
    p.credits -= cost; this.tradeShift(st, id, -qty);
    // сразу в трюм, сколько влезет; остальное — в ангар станции
    const free = this.calcStats(p, p.ship).cargo - this.cargoUsed(p.ship.cargo);
    const toCargo = Math.max(0, Math.min(qty, Math.floor(free / ITEMS[id].vol + 1e-9)));
    if (toCargo) p.ship.cargo[id] = (p.ship.cargo[id] || 0) + toCargo;
    if (qty - toCargo) { const h = this.hangar(p, st).items; h[id] = (h[id] || 0) + qty - toCargo; }
    p.stats.tradeSpent = (p.stats.tradeSpent || 0) + cost;
    this.notify(s, `Куплено: ${ITEMS[id].name} ×${fmt(qty)} за ${fmt(cost)} CR${qty - toCargo ? ` (в трюм ${fmt(toCargo)}, остальное в ангар)` : ' — в трюме'}`, 'good');
    this.sendProfile(s); s.send(this.tradeView(s, p)); this.save();
  };
  P.c_tradeSell = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const id = m.item; if (!G[id]) return;
    const h = this.hangar(p, st).items, have = (h[id] || 0) + (p.ship.cargo[id] || 0);
    const qty = Math.min(have, Math.max(1, Math.floor(+m.qty) || have));
    if (!qty) return this.notify(s, 'Нет этого товара в трюме и ангаре станции', 'warn');
    const tax = Math.max(0, 0.04 - 0.01 * (p.skills.trade || 0));
    const got = Math.round(this.tradeTotal(st, id, qty, 'sell') * (1 - tax));
    let left = qty; const fc = Math.min(left, p.ship.cargo[id] || 0); p.ship.cargo[id] -= fc; left -= fc; if (!p.ship.cargo[id]) delete p.ship.cargo[id];
    if (left) { h[id] -= left; if (!h[id]) delete h[id]; }
    p.credits += got; this.tradeShift(st, id, qty);
    p.stats.tradeEarned = (p.stats.tradeEarned || 0) + got;
    this.notify(s, `Продано: ${ITEMS[id].name} ×${fmt(qty)} за ${fmt(got)} CR`, 'good');
    this.sendProfile(s); s.send(this.tradeView(s, p)); this.save();
  };
  // обычная продажа/покупка через рынок тоже идёт по торговым правилам
  P.c_sell = function (s, m, p) { if (G[m.item]) return this.c_tradeSell(s, m, p); return baseSell.apply(this, arguments); };
  P.c_buy = function (s, m, p) { if (G[m.item]) return this.c_tradeBuy(s, m, p); return baseBuy.apply(this, arguments); };
  P.slowTick = function () { // раз в 10 минут чистим давно рассосавшиеся записи
    const r = baseSlow.apply(this, arguments);
    if (!this._tbAt || this.now - this._tbAt > 600000) { this._tbAt = this.now; const b = book(this); for (const k of Object.keys(b)) { const [st, id] = k.split('|'); this.tradeDev(st, id); } }
    return r;
  };
};
module.exports.GOODS = GOODS;
module.exports.TR = TR;
