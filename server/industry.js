// Производство на станциях: чертежи → изделия.
// Чертёж лежит в ангаре станции (или в трюме пристыкованного корабля) и не расходуется.
// Запуск списывает материалы из ангара и трюма (недостающие можно докупить с наценкой) и сбор станции;
// готовые изделия появляются в ангаре той станции, где шёл заказ. Заказы идут и без пилота в сети.
// Навык «Производство»: −4% материалов и времени за уровень и +1 одновременный заказ.
'use strict';
const crypto = require('crypto');
const D = require('./data');
const { ITEMS, SHIPS, BLUEPRINTS, RARE_BLUEPRINTS, INDUSTRY } = D;

const uid = () => crypto.randomBytes(6).toString('hex');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const pick = (a) => a[Math.floor(Math.random() * a.length)];

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick;

  P.prodLevel = function (p) { return (p.skills && p.skills.industry) || 0; };
  P.prodMaxJobs = function (p) { return INDUSTRY.baseJobs + this.prodLevel(p); };
  // фактическая стоимость запуска с учётом навыка: материалы и время
  P.prodCost = function (p, bpId, runs) {
    const bp = BLUEPRINTS[bpId], cut = 1 - INDUSTRY.skillCut * this.prodLevel(p);
    const mats = {};
    for (const [it, q] of Object.entries(bp.mats)) mats[it] = Math.max(1, Math.ceil(q * cut)) * runs;
    return { mats, fee: bp.fee * runs, time: Math.max(10, Math.round(bp.time * cut)) * runs };
  };
  // чертёж доступен, если лежит в ангаре этой станции или в трюме
  P.hasBlueprint = function (p, st, bpId) { return (this.hangar(p, st).items[bpId] || 0) > 0 || (p.ship.cargo[bpId] || 0) > 0; };

  P.c_prodInfo = function (s, m, p) {
    const st = s.docked;
    const jobs = (p.jobs || []).map(j => ({ ...j, stationName: (this.U.celestials[j.station] || {}).name || '?' }));
    s.send({ t: 'prod', now: this.now, jobs, maxJobs: this.prodMaxJobs(p), level: this.prodLevel(p), station: st || null,
      shop: Object.keys(BLUEPRINTS).filter(id => !BLUEPRINTS[id].rare), markup: INDUSTRY.buyMarkup, cut: INDUSTRY.skillCut });
  };

  P.c_bpBuy = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const bp = BLUEPRINTS[m.bp];
    if (!bp || bp.rare) return this.notify(s, 'Такой чертёж здесь не продаётся', 'warn');
    if (this.hasBlueprint(p, st, m.bp)) return this.notify(s, 'Этот чертёж у вас уже есть на этой станции', 'warn');
    if (p.credits < bp.price) return this.notify(s, `Недостаточно ISK: нужно ${fmt(bp.price)}`, 'warn');
    p.credits -= bp.price;
    const h = this.hangar(p, st);
    h.items[m.bp] = (h.items[m.bp] || 0) + 1;
    this.notify(s, `Куплен ${ITEMS[m.bp].name}. Он в ангаре станции — запускайте производство`, 'good');
    this.sendProfile(s); this.c_prodInfo(s, m, p); this.save();
  };

  P.c_prodStart = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const bp = BLUEPRINTS[m.bp];
    if (!bp) return;
    if (!this.hasBlueprint(p, st, m.bp)) return this.notify(s, 'Чертёж должен лежать в ангаре этой станции или в трюме', 'warn');
    p.jobs = p.jobs || [];
    if (p.jobs.length >= this.prodMaxJobs(p)) return this.notify(s, `Все линии заняты (${p.jobs.length} из ${this.prodMaxJobs(p)}). Навык «Производство» добавляет линии`, 'warn');
    const runs = Math.max(1, Math.min(INDUSTRY.maxRuns, Math.floor(+m.runs) || 1));
    const c = this.prodCost(p, m.bp, runs), h = this.hangar(p, st);
    const missing = {}; let missingCost = 0;
    for (const [it, q] of Object.entries(c.mats)) {
      const have = (h.items[it] || 0) + (p.ship.cargo[it] || 0);
      if (have < q) { missing[it] = q - have; missingCost += Math.ceil((q - have) * ITEMS[it].base * INDUSTRY.buyMarkup); }
    }
    if (missingCost && !m.buyMissing) return this.notify(s, 'Не хватает материалов — привезите их или отметьте «докупить недостающее»', 'warn');
    const total = c.fee + missingCost;
    if (p.credits < total) return this.notify(s, `Недостаточно ISK: нужно ${fmt(total)}`, 'warn');
    p.credits -= total;
    for (const [it, q] of Object.entries(c.mats)) {
      let need = q - (missing[it] || 0);
      const fromH = Math.min(need, h.items[it] || 0); h.items[it] = (h.items[it] || 0) - fromH; need -= fromH; if (!h.items[it]) delete h.items[it];
      if (need) { p.ship.cargo[it] -= need; if (!p.ship.cargo[it]) delete p.ship.cargo[it]; }
    }
    const job = { id: uid(), bp: m.bp, out: bp.out, kind: bp.kind, qty: bp.qty * runs, runs, station: st, start: this.now, end: this.now + c.time * 1000, mats: c.mats };
    p.jobs.push(job);
    const name = bp.kind === 'ship' ? SHIPS[bp.out].name : ITEMS[bp.out].name;
    this.notify(s, `Производство запущено: ${name} ×${job.qty} — готово через ${Math.ceil(c.time / 60)} мин. Списано ${fmt(total)} ISK`, 'good');
    this.sendProfile(s); this.c_prodInfo(s, m, p); this.save();
  };

  // отмена: материалы возвращаются в ангар станции заказа, сбор — нет
  P.c_prodCancel = function (s, m, p) {
    const i = (p.jobs || []).findIndex(j => j.id === m.id);
    if (i < 0) return;
    const j = p.jobs.splice(i, 1)[0], h = this.hangar(p, j.station);
    for (const [it, q] of Object.entries(j.mats || {})) h.items[it] = (h.items[it] || 0) + q;
    this.notify(s, 'Заказ отменён — материалы возвращены в ангар станции', 'info');
    this.sendProfile(s); this.c_prodInfo(s, m, p); this.save();
  };

  // выдача готового: по всем пилотам, в том числе не в сети
  P.prodDeliver = function (p) {
    if (!p.jobs || !p.jobs.length) return false;
    let done = false;
    for (const j of p.jobs.slice()) {
      if (j.end > this.now) continue;
      p.jobs.splice(p.jobs.indexOf(j), 1);
      if (!this.U.celestials[j.station]) continue;
      const h = this.hangar(p, j.station);
      if (j.kind === 'ship') for (let k = 0; k < j.qty; k++) h.ships.push(this.newShip(j.out, false));
      else h.items[j.out] = (h.items[j.out] || 0) + j.qty;
      done = true;
      const sess = [...this.sessions].find(x => x.player === p);
      if (sess) {
        const name = j.kind === 'ship' ? SHIPS[j.out].name : ITEMS[j.out].name;
        this.notify(sess, `⚙ Готово: ${name} ×${j.qty} — в ангаре станции «${this.U.celestials[j.station].name}»`, 'good');
        this.sendProfile(sess);
        if (sess.docked) this.c_prodInfo(sess, {}, p);
      }
    }
    return done;
  };

  P.slowTick = function () {
    baseSlow.call(this);
    let any = false;
    for (const p of Object.values(this.db.players)) if (this.prodDeliver(p)) any = true;
    if (any) this.save();
  };

  // редкий чертёж в награду: элитные модули и дроны; фракционные корабли — только за войну фракций
  P.rareBlueprint = function (opts) {
    const pool = RARE_BLUEPRINTS.filter(id => (opts && opts.ships) ? BLUEPRINTS[id].kind === 'ship' : BLUEPRINTS[id].kind !== 'ship');
    return pool.length ? pick(pool) : null;
  };
};
