// Дерево технологий своей станции: исследования идут в лаборатории станции (одно за раз, и без пилота в сети),
// стоят CR и материалы, открываются по веткам. Каждая технология — постоянный бонус пилоту.
'use strict';
const { ITEMS } = require('./data');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');

const TECH = {
  // ветка «Производство»
  refine1: { name: 'Точная переработка', branch: 'Производство', desc: 'выход переработки +10%', cr: 250000, mat: { mat_steel: 60 }, min: 20 },
  yard1:   { name: 'Сборочные роботы', branch: 'Производство', desc: 'детали в цехе делаются на 25% быстрее', cr: 400000, mat: { mat_ceramite: 40 }, min: 30, req: ['refine1'] },
  yard2:   { name: 'Модульные стапели', branch: 'Производство', desc: 'сбор за постройку корабля на стапеле −30%', cr: 900000, mat: { part_control: 4 }, min: 45, req: ['yard1'] },
  // ветка «Добыча»
  mine1:   { name: 'Резонансные лазеры', branch: 'Добыча', desc: 'добыча руды +8%', cr: 200000, mat: { mat_steel: 40 }, min: 15 },
  gas1:    { name: 'Криосепараторы', branch: 'Добыча', desc: 'сбор газа +25%', cr: 350000, mat: { gas_h3: 60 }, min: 25, req: ['mine1'] },
  base1:   { name: 'Автоматика баз', branch: 'Добыча', desc: 'добытчик на планетарной базе +30%', cr: 500000, mat: { mat_crystal: 15 }, min: 30, req: ['mine1'] },
  // ветка «Бой»
  shield1: { name: 'Плотные щиты', branch: 'Бой', desc: 'щиты всех ваших кораблей +8%', cr: 300000, mat: { mat_ceramite: 30 }, min: 20 },
  drone1:  { name: 'Боевые нейросети', branch: 'Бой', desc: 'урон дронов +10%', cr: 450000, mat: { mat_crystal: 10 }, min: 30, req: ['shield1'] },
  wing1:   { name: 'Лётная академия', branch: 'Бой', desc: 'тренировка напарников дешевле на 25%, эскорт крепче на 15%', cr: 600000, mat: { part_plate: 4 }, min: 35, req: ['shield1'] },
  // ветка «Разведка и управление»
  probe1:  { name: 'Глубокие зонды', branch: 'Разведка', desc: 'сигнал засчитывается с 0,35 а.е. вместо 0,2', cr: 250000, mat: { mat_crystal: 6 }, min: 20 },
  corp1:   { name: 'Штаб корпорации', branch: 'Разведка', desc: '+5 мест в корпорации', cr: 1200000, mat: { part_reactor: 2 }, min: 60, req: ['probe1'] },
  fleet1:  { name: 'Командный узел', branch: 'Разведка', desc: '+1 корабль во флоте эскорта (до 4)', cr: 1500000, mat: { part_warp: 1 }, min: 60, req: ['probe1'] }
};

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick, baseCalc = P.calcStats, baseMine = P.mineYield, baseRefine = P.c_refine, basePart = P.c_partMake, baseBuild = P.c_yardBuild, baseInfo = P.c_structInfo;

  P.techHas = function (p, id) { return !!(p && p.tech && p.tech.done && p.tech.done.includes(id)); };
  P.techView = function (p) {
    const t = p.tech || { done: [], cur: null };
    return { t: 'tech', tree: TECH, done: t.done, cur: t.cur, now: this.now, station: !!this.myStructure(p) };
  };
  P.c_techInfo = function (s, m, p) { s.send(this.techView(p)); };
  P.c_techStart = function (s, m, p) {
    const st = this.ownStation(s, p); if (!st) return;
    const T = TECH[m.id]; if (!T) return;
    p.tech = p.tech || { done: [], cur: null };
    if (p.tech.done.includes(m.id)) return this.notify(s, 'Уже исследовано', 'warn');
    if (p.tech.cur) return this.notify(s, `Лаборатория занята: «${TECH[p.tech.cur.id].name}»`, 'warn');
    const lack = (T.req || []).filter(r => !p.tech.done.includes(r));
    if (lack.length) return this.notify(s, `Сначала: ${lack.map(r => '«' + TECH[r].name + '»').join(', ')}`, 'warn');
    if (p.credits < T.cr) return this.notify(s, `Нужно ${fmt(T.cr)} CR`, 'warn');
    const h = this.hangar(p, st.id).items;
    const miss = Object.entries(T.mat).filter(([k, q]) => (h[k] || 0) < q);
    if (miss.length) return this.notify(s, `Не хватает в ангаре станции: ${miss.map(([k, q]) => `${ITEMS[k].name} ${h[k] || 0}/${q}`).join(', ')}`, 'warn');
    for (const [k, q] of Object.entries(T.mat)) { h[k] -= q; if (!h[k]) delete h[k]; }
    p.credits -= T.cr;
    p.tech.cur = { id: m.id, end: this.now + T.min * 60000 };
    this.notify(s, `🔬 Исследование «${T.name}» начато — ${T.min} мин`, 'good');
    this.sendProfile(s); s.send(this.techView(p)); this.save(true);
  };
  P.techTick = function () {
    for (const p of Object.values(this.db.players)) {
      const c = p.tech && p.tech.cur;
      if (!c || this.now < c.end) continue;
      p.tech.cur = null; p.tech.done.push(c.id);
      for (const s of this.sessions) if (s.player === p) { this.notify(s, `🔬 Исследовано: «${TECH[c.id].name}» — ${TECH[c.id].desc}`, 'good'); this.sendProfile(s); s.send(this.techView(p)); }
      this.save(true);
    }
  };
  P.slowTick = function () { baseSlow.call(this); if (!this._techAt || this.now - this._techAt > 5000) { this._techAt = this.now; this.techTick(); } };

  // ---- бонусы ----
  P.calcStats = function (p, ship) {
    const r = baseCalc.call(this, p, ship);
    if (this.techHas(p, 'shield1')) r.shield *= 1.08;
    if (this.techHas(p, 'mine1')) r.mineMul *= 1.08;
    if (this.techHas(p, 'drone1')) r.droneMul += 0.1;
    if (this.techHas(p, 'gas1')) r.gasMul = 1.25;
    return r;
  };
  P.mineYield = function (e, mod, def) {
    const t = this.ents.get(mod.target);
    if (t && t.gas && e.stats.gasMul) { const k = e.stats.mineMul; e.stats.mineMul = k * e.stats.gasMul; try { return baseMine.call(this, e, mod, def); } finally { e.stats.mineMul = k; } }
    return baseMine.call(this, e, mod, def);
  };
  P.c_refine = function (s, m, p) {
    const st = this.myStructure(p), n = st ? st.jobs.length : 0;
    const r = baseRefine.call(this, s, m, p);
    if (st && st.jobs.length > n && this.techHas(p, 'refine1')) { const j = st.jobs[st.jobs.length - 1]; j.outQty = Math.floor(j.outQty * 1.1); }
    return r;
  };
  P.c_partMake = function (s, m, p) {
    const st = this.myStructure(p), n = st && st.asm ? st.asm.length : 0;
    const r = basePart.call(this, s, m, p);
    if (st && st.asm && st.asm.length > n && this.techHas(p, 'yard1')) { const j = st.asm[st.asm.length - 1]; j.end = j.start + (j.end - j.start) * 0.75; }
    return r;
  };
  P.c_yardBuild = function (s, m, p) {
    const st = this.myStructure(p), n = st && st.asm ? st.asm.length : 0, c0 = p.credits;
    const r = baseBuild.call(this, s, m, p);
    if (st && st.asm && st.asm.length > n && this.techHas(p, 'yard2')) { const back = Math.round((c0 - p.credits) * 0.3); p.credits += back; this.notify(s, `Модульные стапели: возвращено ${fmt(back)} CR сбора`, 'info'); this.sendProfile(s); }
    return r;
  };
  P.c_structInfo = function (s, m, p) { const r = baseInfo.call(this, s, m, p); if (this.myStructure(p)) s.send(this.techView(p)); return r; };
};
module.exports.TECH = TECH;
