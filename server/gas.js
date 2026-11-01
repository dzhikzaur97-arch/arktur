// Газ: у каждого газового гиганта — газовое облако со сгустками гелия-3 (в опасных системах — и плазменного газа).
// Собирает его только газовый сборщик (модуль верхнего слота), буровые лазеры по газу не работают — и наоборот.
// Гелий-3 продаётся, а на своей станции превращается в энергоячейки и термоядерные блоки (см. shipyard.js).
'use strict';
const { ITEMS, MODULES } = require('./data');
const { rng } = require('./universe');

const GAS = { perField: 14, refillMs: 20 * 60000 };

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseInit = P.initBelts, baseModule = P.c_module, baseSlow = P.slowTick;

  P.gasCloud = function (field, r, i) {
    const sec = this.U.byId[field.sys].sec;
    const ore = sec < 0.5 && r() < 0.45 ? 'gas_plasma' : 'gas_h3';
    const ang = r() * Math.PI * 2, d = 2500 + r() * 18000, rad = 400 + r() * 700;
    const amount = Math.round(rad * 6);
    return { id: `${field.id}:c${i}`, type: 'asteroid', gas: true, sys: field.sys, belt: field.id, ore, name: `${ITEMS[ore].name} (облако)`,
      pos: [field.pos[0] + Math.cos(ang) * d, field.pos[1] + (r() - 0.5) * 4000, field.pos[2] + Math.sin(ang) * d],
      vel: [0, 0, 0], radius: rad, amount, maxAmount: amount, seed: Math.floor(r() * 1e9) };
  };
  P.gasFill = function (field) {
    const st = this.gasState[field.id];
    const have = [...this.ents.values()].filter(a => a.belt === field.id && a.amount > 0).length;
    for (let i = have; i < GAS.perField; i++) { const c = this.gasCloud(field, st.r, st.n++); this.ents.set(c.id, c); }
  };
  // газовые облака появляются вместе с поясами астероидов
  P.initBelts = function () {
    baseInit.call(this);
    this.gasState = {};
    for (const sys of Object.values(this.U.systems)) {
      sys.gasFields = [];
      sys.celestials.filter(c => c.kind === 'planet' && c.ptype === 'Газовый гигант').forEach((pl, i) => {
        const r = rng('gas:' + pl.id), a = r() * Math.PI * 2, d = pl.radius + 3e6 + r() * 3e6;
        const f = { id: `${sys.id}:gas${i + 1}`, kind: 'gasfield', name: `${pl.name} — газовое облако`, sys: sys.id,
          pos: [pl.pos[0] + Math.cos(a) * d, pl.pos[1] + (r() - 0.5) * 2e5, pl.pos[2] + Math.sin(a) * d], radius: 1, landing: 8000 };
        sys.celestials.push(f); sys.gasFields.push(f); this.U.celestials[f.id] = f;
        this.gasState[f.id] = { r: rng('gasc:' + f.id), n: 0, refill: 0 };
        this.gasFill(f);
      });
    }
  };
  // газ собирает только газовый сборщик
  P.c_module = function (s, m, p, e) {
    const mod = e && e.modules[m.slot | 0];
    if (mod && !mod.active && MODULES[mod.id].kind === 'miner') {
      const t = this.ents.get(m.target), gasMod = !!MODULES[mod.id].gas;
      if (t && t.type === 'asteroid' && !!t.gas !== gasMod)
        return this.notify(s, gasMod ? 'Газовый сборщик работает только по газовым облакам' : 'Газ собирает только газовый сборщик — купите его на рынке', 'warn');
    }
    return baseModule.call(this, s, m, p, e);
  };
  // облака понемногу восстанавливаются
  P.slowTick = function () {
    baseSlow.call(this);
    if (this._gasAt && this.now - this._gasAt < 60000) return;
    this._gasAt = this.now;
    for (const sys of Object.values(this.U.systems)) for (const f of sys.gasFields || []) {
      const st = this.gasState[f.id]; if (!st || this.now < st.refill) continue;
      st.refill = this.now + GAS.refillMs; this.gasFill(f);
    }
  };
};
module.exports.GAS = GAS;
