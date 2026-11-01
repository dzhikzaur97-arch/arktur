// Зонды: в каждой системе спрятаны 1–3 глубоких сигнала, которых не видит обычный скан.
// Пилот ставит круг зонда на карте системы (центр и радиус 8 / 4 / 2 / 1 / 0.5 а.е.) и сканирует:
// сигналы внутри круга отвечают силой и примерной точкой (чем меньше круг — тем точнее). Сигнал найден,
// когда круг 0.5 а.е. накрывает его ближе 0.2 а.е. — тогда на месте сигнала появляется тайник, а у пилота — метка для варпа.
'use strict';
const { ITEMS, RARE_BLUEPRINTS, incomeOf } = require('./data');
const AU = 1.496e11;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const uid = () => Math.random().toString(36).slice(2, 9);

const PROBE = {
  radii: [8, 4, 2, 1, 0.5], cooldown: 2500, findR: 0.5, findD: 0.2,
  kinds: {
    data:  { name: 'Зашифрованный архив', w: 0.45 },
    relic: { name: 'Тайник Предтеч', w: 0.3 },
    ghost: { name: 'Корабль-призрак', w: 0.25, guards: true }
  }
};

module.exports = function install(Game) {
  const P = Game.prototype;

  P.sigList = function (sysId) {
    this.sigs = this.sigs || new Map();
    let l = (this.sigs.get(sysId) || []).filter(x => !x.found && x.expires > this.now);
    const sys = this.U.systems[sysId]; if (!sys) return [];
    const want = sys.def.sec >= 0.5 ? 1 : sys.def.sec > 0 ? 2 : 3;
    const sun = sys.celestials[0].pos;
    while (l.length < want) {
      let x = Math.random(), kind = 'data';
      for (const [k, v] of Object.entries(PROBE.kinds)) { if ((x -= v.w) <= 0) { kind = k; break; } }
      const a = Math.random() * Math.PI * 2, d = rnd(1.5, 9) * AU;
      l.push({ id: 'sg_' + uid(), kind, pos: [sun[0] + Math.cos(a) * d, sun[1] + rnd(-0.02, 0.02) * AU, sun[2] + Math.sin(a) * d], expires: this.now + rnd(60, 120) * 60000 });
    }
    this.sigs.set(sysId, l);
    return l;
  };

  P.c_probe = function (s, m, p, e) {
    if (!e || e.warp) return this.notify(s, 'Зонды запускают из космоса (не в варпе)', 'warn');
    if (!Array.isArray(m.pos) || m.pos.length !== 3 || !m.pos.every(Number.isFinite)) return;
    const r = PROBE.radii.includes(+m.r) ? +m.r : 4;
    if (this.now - (s.probeAt || 0) < PROBE.cooldown) return;
    s.probeAt = this.now;
    const hits = [], findD = this.techHas && this.techHas(p, 'probe1') ? 0.35 : PROBE.findD;
    for (const g of this.sigList(e.sys)) {
      const d = Math.hypot(g.pos[0] - m.pos[0], g.pos[2] - m.pos[2]) / AU;
      if (d > r) continue;
      if (r <= PROBE.findR && d <= findD) { this.sigFound(s, p, e, g); hits.push({ id: g.id, found: true, name: PROBE.kinds[g.kind].name, pos: g.pos }); continue; }
      // примерная точка: шум тем меньше, чем меньше круг
      const err = r * 0.28 * AU, a = Math.random() * Math.PI * 2, k = Math.random();
      hits.push({ id: g.id, strength: Math.round(Math.max(5, (1 - d / r) * 100 / Math.sqrt(r))), est: [g.pos[0] + Math.cos(a) * err * k, g.pos[1], g.pos[2] + Math.sin(a) * err * k], err: r * 0.28 });
    }
    s.send({ t: 'probe', pos: m.pos, r, hits, total: this.sigList(e.sys).length });
    p.stats.probes = (p.stats.probes || 0) + 1;
  };

  P.sigFound = function (s, p, e, g) {
    g.found = true;
    const K = PROBE.kinds[g.kind], inc = incomeOf(e.sys);
    const items = {};
    if (g.kind === 'data') { items.salv_core = 1 + Math.floor(Math.random() * 2); if (Math.random() < 0.35) items[pick(RARE_BLUEPRINTS)] = 1; }
    else if (g.kind === 'relic') { items.salv_relic = 2 + Math.floor(Math.random() * 3); if (Math.random() < 0.25) items.mat_xcore = 2; }
    else { items.salv_core = 3; items.salv_relic = 2; if (Math.random() < 0.5) items[pick(RARE_BLUEPRINTS)] = 1; }
    const w = { id: 'wr_' + uid(), type: 'wreck', sys: e.sys, pos: g.pos.slice(), vel: [0, 0, 0], radius: 120, name: K.name, items, expires: this.now + 60 * 60000 };
    this.ents.set(w.id, w);
    if (K.guards) {
      const sec = this.U.byId[e.sys].sec, kinds = sec >= 0.5 ? ['raider', 'raider'] : sec > 0 ? ['raider', 'reaper', 'hunter'] : ['reaper', 'reaper', 'hunter', 'dreadlord'];
      for (const k of kinds) this.spawnNpc(k, e.sys, [g.pos[0] + rnd(-6000, 6000), g.pos[1], g.pos[2] + rnd(-6000, 6000)]);
    }
    const bonus = Math.round((g.kind === 'ghost' ? 120000 : g.kind === 'relic' ? 80000 : 50000) * inc);
    p.credits += bonus; p.stats.sigFound = (p.stats.sigFound || 0) + 1;
    // метка для варпа к тайнику
    p.marks = p.marks || [];
    if (p.marks.length < 30) { p.marks.push({ id: 'mk_' + uid(), sys: e.sys, name: '✦ ' + K.name, pos: g.pos.map(v => Math.round(v)) }); if (this.marksSend) this.marksSend(s); }
    this.notify(s, `✦ Сигнал найден: ${K.name}! Данные проданы за ${Math.round(bonus).toLocaleString('ru-RU')} CR. Метка для варпа — в «📍 Метки»${K.guards ? '. Осторожно: охрана!' : ''}`, 'good');
    this.sendProfile(s); this.save();
  };
};
module.exports.PROBE = PROBE;
