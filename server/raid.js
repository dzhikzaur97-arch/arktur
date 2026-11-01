// Финальный рейд: в системе «Край» стоят «Врата за Край». Подлетите к ним и начните рейд — из Врат выходит
// Архонт Края, самая сильная машина Предтеч. На 66% и 33% прочности он поднимает щит и зовёт подкрепление:
// пока живы его стражи, по нему проходит только 10% урона. На бой — 25 минут. Награда делится по вкладу
// (вас, ваших дронов, напарников и флота) — CR, ксенон-ядра, реликвии и трофейное снаряжение.
// Один пилот может открыть Врата раз в 2 часа; присоединиться к идущему рейду может кто угодно.
'use strict';
const crypto = require('crypto');
const { NPCS, SHIPS, MODULES, incomeOf } = require('./data');
const { rng } = require('./universe');

const uid = () => crypto.randomBytes(6).toString('hex');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const RAID = { sys: 'kray', startR: 30000, fightR: 200000, duration: 25 * 60000, cooldown: 2 * 3600000, hp: 9, pool: 6000000,
  phases: [0.66, 0.33], adds: [['shard', 'shard', 'sentinel', 'sentinel'], ['sentinel', 'sentinel', 'sentinel', 'shard', 'shard', 'shard']],
  trophies: ['ev_core', 'ev_aegis', 'ev_cannon', 'ev_warden'] };

SHIPS.archon = Object.assign({}, SHIPS.colossus, { name: 'Архонт Края', cls: 'Машина Предтеч', radius: (SHIPS.colossus.radius || 600) * 1.25, color: 0xff70d0,
  shield: 30000, armor: 40000, hull: 30000, desc: 'Сторож Врат за Край. Поднимает щит и зовёт стражей на 66% и 33% прочности.' });
NPCS.wb_archon = { name: 'Архонт Края', ship: 'archon', bounty: 0, dmgMul: 1.25, hpMul: 1, weapon: 'laser_x', guns: 8, speedMul: 0.3, loot: [] };

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseInit = P.initBelts, baseSlow = P.slowTick, baseApply = P.applyDamage, baseDestroy = P.destroyShip, baseEntView = P.entView;

  P.initBelts = function () {
    baseInit.call(this);
    const sys = this.U.systems[RAID.sys]; if (!sys) return;
    const r = rng('raid'), a = r() * Math.PI * 2, d = 3.2 * 1.496e11, sun = sys.celestials[0].pos;
    const c = { id: `${RAID.sys}:raid`, kind: 'raid', name: 'Врата за Край', sys: RAID.sys, pos: [sun[0] + Math.cos(a) * d, sun[1], sun[2] + Math.sin(a) * d], radius: 1, landing: 12000 };
    sys.celestials.push(c); this.U.celestials[c.id] = c; this.raidGate = c;
  };
  const shielded = (rd, g) => rd.shieldUntil > g.now && [...rd.adds].some(id => g.ents.has(id));
  P.raidView = function (s) {
    const rd = this.raid, e = s.ent, g = this.raidGate, p = s.player;
    const near = !!(g && e && !e.warp && e.sys === g.sys && dist(e.pos, g.pos) < RAID.startR);
    if (!rd && !near) return null;
    const boss = rd && this.ents.get(rd.boss);
    const tot = rd ? Object.values(rd.dmg).reduce((a, b) => a + b, 0) || 1 : 1;
    return { t: 'raid', near, active: !!rd, cd: Math.max(0, (p.raidAt || 0) + RAID.cooldown - this.now),
      hp: boss ? +((boss.shield + boss.armor + boss.hull) / (boss.stats.shield + boss.stats.armor + boss.stats.hull)).toFixed(3) : 0,
      phase: rd ? rd.phase : 0, shield: rd ? shielded(rd, this) : false, left: rd ? Math.max(0, rd.until - this.now) : 0,
      share: rd ? Math.round((rd.dmg[p.name] || 0) / tot * 100) : 0, best: (p.stats && p.stats.archon) || 0 };
  };
  P.c_raidStart = function (s, m, p, e) {
    const g = this.raidGate;
    if (!g || !e || e.warp || e.sys !== g.sys || dist(e.pos, g.pos) > RAID.startR) return this.notify(s, 'Подлетите к «Вратам за Край» (система Край, ближе 30 км)', 'warn');
    if (this.raid) return this.notify(s, 'Рейд уже идёт — Архонт рядом, вступайте в бой!', 'info');
    const cd = (p.raidAt || 0) + RAID.cooldown - this.now;
    if (cd > 0) return this.notify(s, `Врата ещё не восстановились для вас: ${Math.ceil(cd / 60000)} мин`, 'warn');
    p.raidAt = this.now;
    const a = Math.random() * Math.PI * 2, pos = add(g.pos, [Math.cos(a) * 18000, 0, Math.sin(a) * 18000]);
    const boss = this.spawnNpc('wb_archon', g.sys, pos);
    boss.wboss = true; boss.raidBoss = true; boss.home = pos; boss.npcSpeedMul = 0.3; boss.regenMul = 0.03;
    for (const k of ['shield', 'armor', 'hull']) { boss.stats[k] = Math.round(boss.stats[k] * RAID.hp); boss[k] = boss.stats[k]; }
    this.raid = { id: uid(), boss: boss.id, sys: g.sys, pos, start: this.now, until: this.now + RAID.duration, phase: 0, dmg: {}, adds: new Set(), shieldUntil: 0, by: p.name };
    this.fxSys(g.sys, pos, { k: 'jump', pos });
    for (const x of this.sessions) {
      x.send({ t: 'chat', ch: 'global', from: '*', text: `⛬ ${p.name} открыл Врата за Край! Архонт Края вышел в систему Край — все пилоты на помощь, награда по вкладу.` });
      if (x.ent && x.ent.sys === g.sys) this.notify(x, '⛬ Архонт Края пробуждается! На 66% и 33% он поднимет щит — сначала сбейте стражей', 'warn');
    }
  };
  P.raidPhase = function (rd, boss) {
    rd.phase++;
    rd.shieldUntil = this.now + 60000;
    for (const k of RAID.adds[rd.phase - 1]) {
      const n = this.spawnNpc(k, rd.sys, add(boss.pos, [rnd(-9000, 9000), rnd(-2000, 2000), rnd(-9000, 9000)]));
      n.home = boss.pos.slice(); rd.adds.add(n.id); this.fxSys(rd.sys, n.pos, { k: 'jump', pos: n.pos });
    }
    for (const x of this.sessions) if (x.ent && x.ent.sys === rd.sys) this.notify(x, `⛬ Фаза ${rd.phase + 1}: Архонт поднял щит и позвал стражей! Уничтожьте их — по Архонту проходит лишь 10% урона`, 'bad');
  };
  P.applyDamage = function (t, dmg, src, ...rest) {
    const rd = this.raid;
    if (t && rd && t.id === rd.boss) {
      if (shielded(rd, this)) dmg *= 0.1;
      const name = this.wevAttacker ? this.wevAttacker(src) : null;
      if (name && this.db.players[name]) rd.dmg[name] = (rd.dmg[name] || 0) + dmg;
      const r = baseApply.call(this, t, dmg, src, ...rest);
      const frac = (t.shield + t.armor + t.hull) / (t.stats.shield + t.stats.armor + t.stats.hull);
      if (this.raid === rd && this.ents.has(t.id) && rd.phase < RAID.phases.length && frac < RAID.phases[rd.phase]) this.raidPhase(rd, t);
      return r;
    }
    return baseApply.call(this, t, dmg, src, ...rest);
  };
  P.entView = function (o, viewer) {
    const v = baseEntView.call(this, o, viewer);
    if (v && this.raid && o.id === this.raid.boss && shielded(this.raid, this)) v.pbs = 'waves';
    return v;
  };
  P.raidEnd = function (won, bossPos) {
    const rd = this.raid; if (!rd) return;
    this.raid = null;
    for (const id of rd.adds) { const n = this.ents.get(id); if (n) this.removeEntity(n); }
    if (!won) {
      const b = this.ents.get(rd.boss); if (b) { this.fxSys(b.sys, b.pos, { k: 'jump', pos: b.pos }); this.removeEntity(b); }
      for (const x of this.sessions) x.send({ t: 'chat', ch: 'global', from: '*', text: '⛬ Архонт Края ушёл обратно за Врата. Попробуйте снова — с флотом и напарниками.' });
      return;
    }
    const total = Object.values(rd.dmg).reduce((a, b) => a + b, 0) || 1, names = Object.keys(rd.dmg);
    for (const n of names) {
      const p = this.db.players[n]; if (!p) continue;
      const share = Math.max(0.1, rd.dmg[n] / total), cr = Math.round(RAID.pool * share);
      p.credits += cr; p.stats.archon = (p.stats.archon || 0) + 1; p.stats.wevents = (p.stats.wevents || 0) + 1;
      const s = [...this.sessions].find(x => x.player === p);
      if (s) { this.notify(s, `⛬ Архонт Края повержен! Ваш вклад ${Math.round(rd.dmg[n] / total * 100)}% — ${fmt(cr)} CR. Заберите тайник Архонта!`, 'good'); this.sendProfile(s); }
    }
    const items = { mat_xcore: 6 + Math.floor(Math.random() * 5), salv_relic: 6 + Math.floor(Math.random() * 5) };
    for (let i = 0; i < 2 + Math.min(3, names.length); i++) { const t = pick(RAID.trophies); if (MODULES[t]) items[t] = (items[t] || 0) + 1; }
    if (this.rareBlueprint) { const bp = this.rareBlueprint(); if (bp) items[bp] = 1; }
    const w = { id: 'wr_' + uid(), type: 'wreck', sys: rd.sys, pos: bossPos, vel: [0, 0, 0], radius: 200, name: 'Тайник Архонта Края', items, expires: this.now + 40 * 60000 };
    this.ents.set(w.id, w);
    for (const x of this.sessions) x.send({ t: 'chat', ch: 'global', from: '*', text: `⛬ Победа за Краем! Архонт повержен. Участников: ${names.length}.` });
    this.save();
  };
  P.destroyShip = function (t, killer) {
    const rd = this.raid;
    if (rd && t.id === rd.boss) { const pos = t.pos.slice(); const r = baseDestroy.call(this, t, killer); this.raidEnd(true, pos); return r; }
    if (rd) rd.adds.delete(t.id);
    return baseDestroy.call(this, t, killer);
  };
  P.slowTick = function () {
    baseSlow.call(this);
    const rd = this.raid;
    if (rd && (!this.ents.has(rd.boss) || this.now > rd.until)) this.raidEnd(false);
    if (this._raidViewAt && this.now - this._raidViewAt < 1000) return;
    this._raidViewAt = this.now;
    for (const s of this.sessions) {
      if (!s.player) continue;
      const v = this.raidView(s);
      if (v || s.raidShown) { s.send(v || { t: 'raid', near: false, active: false }); s.raidShown = !!v; }
    }
  };
};
module.exports.RAID = RAID;
