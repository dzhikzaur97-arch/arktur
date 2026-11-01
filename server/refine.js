// Переработка на любой станции: руда → материалы сразу (выход 70%, сбор 5%), материалы → компоненты (сбор 3%).
// Своя станция-завод перерабатывает дешевле и с большим выходом, но по времени — здесь быстро и везде.
// Компоненты нужны для чертежей серийных модулей классов II–V и дронов Mk II+ (см. data.js).
'use strict';
const { ITEMS, RECIPES, COMPONENTS } = require('./data');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const RF = { yield: 0.7, fee: 0.05, compFee: 0.03, skill: 0.02 };

module.exports = function install(Game) {
  const P = Game.prototype;
  P.refineView = function (p) {
    const k = RF.yield * (1 + RF.skill * ((p.skills && p.skills.industry) || 0));
    return { t: 'refine', yield: +k.toFixed(3), fee: RF.fee, compFee: RF.compFee, recipes: RECIPES, comps: COMPONENTS };
  };
  P.c_refineInfo = function (s, m, p) { s.send(this.refineView(p)); };
  P.c_stRefine = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const rec = RECIPES[m.item]; if (!rec) return;
    const h = this.hangar(p, st).items, have = h[m.item] || 0;
    const qty = Math.min(have, Math.max(0, Math.floor(+m.qty) || have));
    const k = this.refineView(p).yield, out = Math.floor(qty * rec.ratio * k);
    if (out <= 0) return this.notify(s, `Мало руды: на 1 ед. «${ITEMS[rec.out].name}» нужно ${Math.ceil(1 / (rec.ratio * k))} ед.`, 'warn');
    const used = Math.min(have, Math.ceil(out / (rec.ratio * k))), fee = Math.round(out * ITEMS[rec.out].base * RF.fee);
    if (p.credits < fee) return this.notify(s, `Сбор станции ${fmt(fee)} CR — не хватает денег`, 'warn');
    p.credits -= fee; h[m.item] -= used; if (!h[m.item]) delete h[m.item];
    h[rec.out] = (h[rec.out] || 0) + out;
    p.stats.refined = (p.stats.refined || 0) + out;
    this.notify(s, `♻ ${ITEMS[m.item].name} ×${fmt(used)} → ${ITEMS[rec.out].name} ×${fmt(out)} (сбор ${fmt(fee)} CR)`, 'good');
    this.sendProfile(s); this.save();
  };
  P.c_compMake = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const C = COMPONENTS[m.id]; if (!C) return;
    const h = this.hangar(p, st).items;
    const max = Math.min(...Object.entries(C.mats).map(([k, q]) => Math.floor((h[k] || 0) / q)));
    const n = Math.min(max, Math.max(1, Math.floor(+m.qty) || 1));
    if (n <= 0) return this.notify(s, `Не хватает в ангаре станции: ${Object.entries(C.mats).map(([k, q]) => `${ITEMS[k].name} ${h[k] || 0}/${q}`).join(', ')}`, 'warn');
    const fee = Math.round(n * ITEMS[m.id].base * RF.compFee);
    if (p.credits < fee) return this.notify(s, `Сбор мастерской ${fmt(fee)} CR — не хватает денег`, 'warn');
    p.credits -= fee;
    for (const [k, q] of Object.entries(C.mats)) { h[k] -= q * n; if (!h[k]) delete h[k]; }
    h[m.id] = (h[m.id] || 0) + n;
    this.notify(s, `⚙ Собрано: ${C.name} ×${n} (сбор ${fmt(fee)} CR)`, 'good');
    this.sendProfile(s); this.save();
  };
};
module.exports.RF = RF;
