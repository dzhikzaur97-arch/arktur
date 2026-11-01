// Гонки и арена.
//  · Гонки: в шести системах Ядра у станции стоит маяк трассы. Подлетите к маяку и нажмите «Старт»:
//    нужно по порядку пролететь кольца-ворота (ближе 1,5 км к центру). Время, рекорд трассы, награда за первый финиш и рекорд.
//  · Арена: в Люмене и Мирре — арена Скверны. Волны пиратов одна сильнее другой; за каждую отбитую волну — награда,
//    лучший результат — в таблице рекордов. Покинули арену или погибли — забег окончен.
'use strict';
const { incomeOf, SHIPS } = require('./data');
const { rng } = require('./universe');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// ближайшая точка отрезка a→b к c: для быстрого корабля проверяем весь путь за тик, а не только конечную точку
const segDist = (a, b, c) => {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const L = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1, t = Math.max(0, Math.min(1, (ac[0] * ab[0] + ac[1] * ab[1] + ac[2] * ab[2]) / L));
  return dist(c, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
};

const ACT = {
  raceSys: ['arktur', 'vella', 'kassiopa', 'lumen', 'sirian', 'polaris'],
  cps: 7, cpR: 1500, startR: 6000, raceLimit: 10 * 60000,
  arenaSys: ['lumen', 'mirra'], arenaR: 40000, startArenaR: 12000
};
const ARENA_WAVES = (n) => {
  const pool = n < 3 ? ['raider'] : n < 5 ? ['raider', 'hunter'] : n < 8 ? ['raider', 'hunter', 'reaper'] : ['hunter', 'reaper', 'reaper', 'dreadlord'];
  return Array.from({ length: Math.min(9, 1 + Math.ceil(n * 0.8)) }, (_, i) => pool[i % pool.length]);
};

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseInit = P.initBelts, baseSlow = P.slowTick, baseDestroy = P.destroyShip, baseWarp = P.beginWarp;

  P.initBelts = function () {
    baseInit.call(this);
    this.tracks = {};
    for (const sysId of ACT.raceSys) {
      const sys = this.U.systems[sysId]; if (!sys || !sys.stations.length) continue;
      const st = sys.stations[0], r = rng('race:' + sysId), a0 = r() * Math.PI * 2;
      const start = [st.pos[0] + Math.cos(a0) * 80000, st.pos[1], st.pos[2] + Math.sin(a0) * 80000];
      const cps = []; let p = start.slice(), dir = a0 + Math.PI / 2;
      for (let i = 0; i < ACT.cps; i++) {
        dir += (r() - 0.5) * 1.6; const step = 5000 + r() * 4000;
        p = [p[0] + Math.cos(dir) * step, p[1] + (r() - 0.5) * 2500, p[2] + Math.sin(dir) * step]; cps.push(p.map(Math.round));
      }
      const c = { id: `${sysId}:race`, kind: 'race', name: `Трасса «${sys.def.name}»`, sys: sysId, pos: start, radius: 1, landing: 3000 };
      sys.celestials.push(c); this.U.celestials[c.id] = c;
      this.tracks[c.id] = { id: c.id, name: c.name, sys: sysId, start, cps, len: Math.round(cps.reduce((s, x, i) => s + dist(i ? cps[i - 1] : start, x), 0)) };
    }
    for (const sysId of ACT.arenaSys) {
      const sys = this.U.systems[sysId]; if (!sys) continue;
      const r = rng('arena:' + sysId), a = r() * Math.PI * 2, d = (2 + r() * 2) * 1.496e11;
      const c = { id: `${sysId}:arena`, kind: 'arena', name: `Арена Скверны «${sys.def.name}»`, sys: sysId, pos: [Math.cos(a) * d, 0, Math.sin(a) * d], radius: 1, landing: 8000 };
      sys.celestials.push(c); this.U.celestials[c.id] = c;
    }
  };

  // ---------- гонка ----------
  P.raceView = function (s) {
    const p = s.player, rc = s.race, e = s.ent;
    const near = !rc && e && !e.warp ? Object.values(this.tracks).find(t => t.sys === e.sys && dist(e.pos, t.start) < ACT.startR) : null;
    const tr = rc ? this.tracks[rc.track] : near;
    return { t: 'race', active: !!rc, near: near ? near.id : null, track: tr ? { id: tr.id, name: tr.name, cps: tr.cps, len: tr.len } : null,
      next: rc ? rc.next : 0, t0: rc ? rc.t0 : 0, best: tr ? ((p.races || {})[tr.id] || null) : null,
      record: tr ? this.raceRecord(tr.id) : null };
  };
  P.raceRecord = function (id) {
    let best = null;
    for (const p of Object.values(this.db.players)) { const t = (p.races || {})[id]; if (t && (!best || t < best.t)) best = { t, name: p.name }; }
    return best;
  };
  P.c_raceStart = function (s, m, p, e) {
    if (!e || e.warp || s.race) return;
    const tr = Object.values(this.tracks).find(t => t.sys === e.sys && dist(e.pos, t.start) < ACT.startR);
    if (!tr) return this.notify(s, 'Подлетите к маяку трассы (ближе 6 км)', 'warn');
    s.race = { track: tr.id, next: 0, t0: this.now, last: e.pos.slice() };
    this.notify(s, `🏁 Старт! ${tr.name}: ${tr.cps.length} ворот, ${fmt(tr.len / 1000)} км. Время пошло`, 'good');
    s.send(this.raceView(s));
  };
  P.c_raceStop = function (s) { if (s.race) { s.race = null; this.notify(s, 'Гонка прервана', 'info'); s.send(this.raceView(s)); } };
  P.raceTick = function (s) {
    const rc = s.race, e = s.ent, tr = rc && this.tracks[rc.track];
    if (!rc) return;
    if (!e || e.sys !== tr.sys || this.now - rc.t0 > ACT.raceLimit) { s.race = null; this.notify(s, 'Гонка окончена: вы покинули трассу или вышло время', 'warn'); s.send(this.raceView(s)); return; }
    let passed = false;
    while (rc.next < tr.cps.length && segDist(rc.last, e.pos, tr.cps[rc.next]) < ACT.cpR) { rc.next++; passed = true; }
    rc.last = e.pos.slice();
    if (!passed) return;
    if (rc.next < tr.cps.length) { s.send(this.raceView(s)); return; }
    // финиш
    const t = this.now - rc.t0, p = s.player; p.races = p.races || {};
    const prev = p.races[tr.id], rec = this.raceRecord(tr.id);
    let prize = 0, why = [];
    if (!prev) { prize += 20000; why.push('первый финиш'); }
    if (!prev || t < prev) { p.races[tr.id] = t; if (prev) { prize += 10000; why.push('личный рекорд'); } }
    if (!rec || t < rec.t) { prize += 30000; why.push('рекорд трассы'); }
    { const rb = (SHIPS[p.ship.type] || {}).raceBonus; if (rb && prize) { prize = Math.round(prize * (1 + rb)); why.push('бонус «Кометы»'); } }
    p.credits += prize; p.stats.races = (p.stats.races || 0) + 1;
    s.race = null;
    this.notify(s, `🏁 Финиш! ${tr.name}: ${(t / 1000).toFixed(1)} с${prize ? ` · +${fmt(prize)} CR (${why.join(', ')})` : ''}`, 'good');
    this.sendProfile(s); s.send(this.raceView(s)); this.save();
  };
  // варп во время гонки — дисквалификация
  P.beginWarp = function (e) {
    const s = e.session;
    if (s && s.race) { s.race = null; this.notify(s, 'Варп во время гонки — дисквалификация', 'warn'); s.send(this.raceView(s)); }
    return baseWarp.call(this, e);
  };

  // ---------- арена ----------
  P.arenaAt = function (e) { return e && Object.values(this.U.systems[e.sys] ? this.U.systems[e.sys].celestials : []).find(c => c.kind === 'arena' && dist(e.pos, c.pos) < ACT.startArenaR); };
  P.arenaView = function (s) {
    const a = s.arena, e = s.ent, near = !a && e && !e.warp ? this.arenaAt(e) : null;
    const top = Object.values(this.db.players).filter(p => p.arenaBest).sort((x, y) => y.arenaBest - x.arenaBest).slice(0, 5).map(p => ({ name: p.name, w: p.arenaBest }));
    return { t: 'arena', active: !!a, near: near ? near.id : null, wave: a ? a.wave : 0, left: a ? [...a.npcs].filter(id => this.ents.has(id)).length : 0, best: s.player.arenaBest || 0, top, earned: a ? a.earned : 0 };
  };
  P.c_arenaStart = function (s, m, p, e) {
    if (!e || e.warp || s.arena) return;
    const c = this.arenaAt(e); if (!c) return this.notify(s, 'Подлетите к арене (ближе 12 км)', 'warn');
    s.arena = { id: c.id, pos: c.pos, sys: c.sys, wave: 0, npcs: new Set(), nextAt: this.now + 3000, earned: 0 };
    this.notify(s, '⚔ Арена: волны Скверны идут одна за другой. Держитесь ближе 40 км к арене', 'warn');
    s.send(this.arenaView(s));
  };
  P.arenaEnd = function (s, why) {
    const a = s.arena; if (!a) return;
    for (const id of a.npcs) { const n = this.ents.get(id); if (n) this.removeEntity(n); }
    s.arena = null;
    const p = s.player, cleared = Math.max(0, a.wave - 1);
    const rec = cleared > (p.arenaBest || 0); if (rec) p.arenaBest = cleared;
    this.notify(s, `⚔ Арена окончена (${why}): отбито волн — ${cleared}${rec ? ' · новый личный рекорд' : ''}. Заработано ${fmt(a.earned)} CR`, rec ? 'good' : 'info');
    s.send(this.arenaView(s)); this.save();
  };
  P.arenaTick = function (s) {
    const a = s.arena; if (!a) return;
    const e = s.ent;
    if (!e || e.sys !== a.sys || dist(e.pos, a.pos) > ACT.arenaR) return this.arenaEnd(s, e ? 'вы покинули арену' : 'корабль потерян');
    const alive = [...a.npcs].filter(id => this.ents.has(id));
    if (alive.length) { a.nextAt = this.now + 8000; return; }
    if (a.wave > 0 && !a.paid) {
      const prize = Math.round(15000 * a.wave * incomeOf(a.sys)); a.paid = true;
      s.player.credits += prize; a.earned += prize; this.sendProfile(s);
      this.notify(s, `⚔ Волна ${a.wave} отбита: +${fmt(prize)} CR. Следующая — через 8 с`, 'good');
      s.send(this.arenaView(s));
    }
    if (this.now < a.nextAt) return;
    a.wave++; a.paid = false;
    for (const k of ARENA_WAVES(a.wave)) {
      const ang = Math.random() * Math.PI * 2;
      const n = this.spawnNpc(k, a.sys, [a.pos[0] + Math.cos(ang) * 14000, a.pos[1], a.pos[2] + Math.sin(ang) * 14000]);
      n.arena = true; n.npcTarget = e.id; a.npcs.add(n.id);
      const k2 = 1 + 0.08 * (a.wave - 1); for (const f of ['shield', 'armor', 'hull']) { n.stats[f] = Math.round(n.stats[f] * k2); n[f] = n.stats[f]; }
    }
    this.notify(s, `⚔ Волна ${a.wave}: ${ARENA_WAVES(a.wave).length} кораблей`, 'bad');
    s.send(this.arenaView(s));
  };
  // гибель пилота на арене
  P.destroyShip = function (t, killer) {
    if (t.session && t.session.arena) this.arenaEnd(t.session, 'корабль уничтожен');
    if (t.session && t.session.race) t.session.race = null;
    return baseDestroy.call(this, t, killer);
  };

  P.slowTick = function () {
    baseSlow.call(this);
    for (const s of this.sessions) {
      if (s.isBot || !s.player) continue;
      this.raceTick(s); this.arenaTick(s);
      // подсказка у маяка трассы или арены (раз в 2 с)
      if (!s._actAt || this.now - s._actAt > 2000) {
        s._actAt = this.now;
        const rv = this.raceView(s), av = this.arenaView(s);
        const key = `${rv.active}|${rv.near}|${av.active}|${av.near}`;
        if (key !== s._actKey || rv.active || av.active) { s._actKey = key; s.send(rv); s.send(av); }
      }
    }
  };
};
module.exports.ACT = ACT;
