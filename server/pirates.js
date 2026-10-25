// Пираты Скверны: умнее и опаснее.
// - тактика: рывок на сближение, уклонение под огнём, охота на гружёных шахтёров, ракетчики бьют тех, у кого нет ПРО;
// - «Матка» выпускает рой малых кораблей;
// - налёты на станции игроков в опасных системах: если их не отбить, пираты выкачивают склад;
// - пиратские крепости в Бездне и Глубоком космосе — укреплённые станции с башнями, ракетами и ПРО;
// - оборонная платформа игрока защищает свои постройки и транспорты в системе.
'use strict';
const crypto = require('crypto');
const { MODULES, NPCS, ITEMS, AU } = require('./data');
const { INFRA } = require('./infra');

const uid = () => crypto.randomBytes(6).toString('hex');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');

// оборонная платформа — новая постройка игрока
INFRA.defense = {
  name: 'Оборонная платформа', max: 4, buildCost: 1500000, buildTime: 30,
  levels: [null, { dmg: 260, range: 60000, cost: 0 }, { dmg: 450, range: 75000, cost: 2500000 }, { dmg: 750, range: 90000, cost: 6000000 }]
};
const RAID = { interval: 5 * 60000, chance: 0.22, siphonAfter: 90000, take: 0.25 };
const FORTRESS_RESPAWN = 3 * 3600 * 1000;

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseAiTick = P.aiTick, baseAttach = P.attachStructure, baseDestroy = P.destroyShip;

  // ---------- выбор цели ----------
  P.pirateTarget = function (e) {
    if (e.storyFocus && Math.random() < 0.75) { const f = this.ents.get(e.storyFocus); if (f && f.sys === e.sys && dist(f.pos, e.pos) < 150000) return f; }
    if (e.raidOn) { const s = this.U.celestials[e.raidOn]; if (s && !this.raidDefenders(e).length) return null; } // налётчики заняты станцией, пока их никто не трогает
    const sec = this.U.byId[e.sys].sec;
    const missileBoat = MODULES[e.modules[0].id].kind === 'launcher';
    let best = null, bestScore = 0;
    for (const o of this.ents.values()) {
      if (o.sys !== e.sys || o === e || o.warp) continue;
      if (o.type !== 'ship' && o.type !== 'drone' && o.type !== 'turret') continue;
      if (o.npc || o.guardian || o.dealer) continue;
      if (o.invulnUntil && o.invulnUntil > this.now) continue;
      if (o.civ && sec >= 0.5 && !o.storyHold) continue;
      const d = dist(o.pos, e.pos);
      if (d > 80000) continue;
      let s = o.owner ? 1.3 : o.civ === 'miner' || o.civ === 'hauler' || o.transportOf ? 1.5 : o.civ ? 1.0 : 0.5;
      if (o.type === 'drone') s = 0.5;
      if (o.type === 'turret') s = 0.9;
      const hpFrac = (o.shield + o.armor + o.hull) / (o.stats.shield + o.stats.armor + o.stats.hull);
      s *= 1 + (1 - hpFrac) * 1.4;                                   // добивать раненых
      if ((e.aggressors.get(o.id) || 0) > this.now) s *= 1.8;        // отвечать обидчику
      if (o.type === 'drone' && (e.aggressors.get(o.id) || 0) > this.now) s *= 2;
      if (o.owner && o.modules && o.modules.some(m => m && m.active && MODULES[m.id].kind === 'miner')) s *= 1.5; // шахтёр за работой — лёгкая добыча
      if (o.owner && o.session) { const p = o.session.player, used = this.cargoUsed(p.ship.cargo); if (used > o.stats.cargo * 0.6) s *= 1.4; } // полный трюм
      if (missileBoat && o.modules && !o.modules.some(m => m && m.active && MODULES[m.id].kind === 'pd')) s *= 1.4; // без ПРО ракеты долетят
      s /= 1 + d / 30000;
      if (s > bestScore) { bestScore = s; best = o; }
    }
    return best;
  };

  // ---------- тактика в бою ----------
  P.aiTick = function (e) {
    const before = e.nextThink;
    baseAiTick.call(this, e);
    if (e.nextThink === before || e.guardian || !e.npc) return; // ход не делался
    const n = NPCS[e.npc];
    const base = (n && n.speedMul) || 1;
    if (e.fortress) { e.npcSpeedMul = 0; return this.fortressTick(e); }
    const t = e.npcTarget && this.ents.get(e.npcTarget);
    if (!t || e.retreating) { e.npcSpeedMul = base; return; }
    const md = MODULES[e.modules[0].id], d = this.surfaceDist(e, t);
    const reach = md.kind === 'launcher' ? md.range * 0.8 : md.optimal + md.falloff;
    if (d > reach) e.npcSpeedMul = base * 1.45;                             // рывок на сближение
    else if (this.now - (e.lastHitAt || 0) < 3000) e.npcSpeedMul = base * 1.25; // уклонение под огнём
    else e.npcSpeedMul = base;
    // «Матка» выпускает рой
    if (e.swarmLeft > 0 && d < 60000 && this.now > (e.nextSwarm || 0)) {
      e.nextSwarm = this.now + 25000;
      for (let i = 0; i < 2 && e.swarmLeft > 0; i++, e.swarmLeft--) {
        const sw = this.spawnNpc('swarm', e.sys, add(e.pos, [rnd(-800, 800), rnd(-300, 300), rnd(-800, 800)]));
        sw.npcTarget = t.id; sw.home = e.home || e.pos; sw.belt = e.belt; sw.anom = e.anom;
        if (e.belt && this.beltState[e.belt]) this.beltState[e.belt].npcs.add(sw.id);
      }
      if (t.session) this.notify(t.session, `${e.name} выпускает рой!`, 'bad');
    }
  };

  // ---------- налёты на станции игроков ----------
  P.raidDefenders = function (e) {
    return [...this.ents.values()].filter(o => o.sys === e.sys && (o.owner || o.type === 'turret') && !o.warp && dist(o.pos, e.pos) < 60000);
  };
  P.pirateRaidTick = function () {
    if (this._raidCheck && this.now - this._raidCheck < RAID.interval) { this.raidProgress(); return; }
    this._raidCheck = this.now;
    const raided = new Set((this.db.structures || []).filter(x => x.raid).map(x => x.owner)); // не больше одного налёта на игрока
    for (const st of this.db.structures || []) {
      if (st.buildUntil > this.now || st.raid || st.type === 'defense' || raided.has(st.owner)) continue;
      const sec = this.U.byId[st.sys].sec;
      if (sec >= 0.7 || Math.random() > RAID.chance * (sec < 0.3 ? 1.5 : 1)) continue;
      const types = sec >= 0.4 ? ['raider', 'raider', 'corsair'] : sec > 0 ? ['raider', 'reaper', 'corsair', 'hunter'] : ['reaper', 'corsair', 'corsair', 'warlord'];
      const ids = [];
      for (const type of types) {
        const n = this.spawnNpc(type, st.sys, add(st.pos, [rnd(-20000, 20000), rnd(-3000, 3000), rnd(-20000, 20000)]));
        n.home = st.pos; n.raidOn = st.id; ids.push(n.id);
        this.fxSys(st.sys, n.pos, { k: 'jump', pos: n.pos });
      }
      st.raid = { ids, start: this.now }; raided.add(st.owner);
      this.broadcastSys(st.sys, { t: 'chat', ch: 'local', from: 'Скверна', text: `Станция «${st.name}» — наша. Сопротивление бесполезно.` });
      for (const s of this.sessions) if (s.player.name === st.owner) this.notify(s, `⚠ Пиратский налёт на «${st.name}» (${this.U.byId[st.sys].name})! Через ${RAID.siphonAfter / 1000} с они начнут грабить склад. Защитите станцию или постройте оборонную платформу.`, 'bad');
    }
  };
  P.raidProgress = function () {
    for (const st of this.db.structures || []) {
      if (!st.raid) continue;
      const alive = st.raid.ids.filter(id => this.ents.has(id));
      if (!alive.length) {
        for (const s of this.sessions) if (s.player.name === st.owner) this.notify(s, `Налёт на «${st.name}» отбит!`, 'good');
        st.raid = null; continue;
      }
      if (this.now - st.raid.start < RAID.siphonAfter || st.raid.robbed) continue;
      st.raid.robbed = true;
      const p = this.db.players[st.owner]; if (!p) continue;
      const h = this.hangar(p, st.id), stolen = [];
      for (const [k, v] of Object.entries(h.items)) {
        if (ITEMS[k] && (ITEMS[k].cat === 'Энергия' || ITEMS[k].cat === 'Материалы' || ITEMS[k].cat === 'Руда')) {
          const n = Math.floor(v * RAID.take); if (!n) continue;
          h.items[k] -= n; stolen.push(`${ITEMS[k].name} ×${fmt(n)}`);
        }
      }
      for (const s of this.sessions) if (s.player.name === st.owner) this.notify(s, `Пираты разграбили склад «${st.name}»: ${stolen.join(', ') || 'нечего было взять'}`, 'bad');
      // ограбив, уходят
      for (const id of alive) { const n = this.ents.get(id); if (n) { n.raidOn = null; n.despawnAt = this.now + 60000; } }
      setTimeout(() => { for (const id of alive) { const n = this.ents.get(id); if (n && !n.npcTarget) { this.fxSys(n.sys, n.pos, { k: 'jump', pos: n.pos }); this.removeEntity(n); } } st.raid = null; }, 60000);
    }
  };

  // ---------- оборонная платформа ----------
  P.attachStructure = function (st) {
    const c = baseAttach.call(this, st);
    if (c && st.type === 'defense') c.style = 6;
    return c;
  };
  P.defenseTick = function () {
    for (const st of this.db.structures || []) {
      if (st.type !== 'defense' || st.buildUntil > this.now || this.now < (st.nextShot || 0)) continue;
      const L = INFRA.defense.levels[st.level];
      let best = null, bd = L.range;
      for (const o of this.ents.values()) {
        if (o.sys !== st.sys || o.type !== 'ship' || o.warp || !(o.npc && !o.guardian) && !o.outlaw) continue;
        const d = dist(o.pos, st.pos);
        if (d < bd) { bd = d; best = o; }
      }
      // ПРО платформы сбивает ракеты, летящие в постройки и корабли владельца поблизости
      for (const m of this.ents.values()) {
        if (m.type !== 'missile' || m.sys !== st.sys || dist(m.pos, st.pos) > 20000) continue;
        const t = this.ents.get(m.target);
        if (t && (t.owner === st.owner) && Math.random() < 0.5) { this.fxSys(st.sys, null, { k: 'beam', from: st.id, fromPos: st.pos, to: m.id, color: 0x9fe8ff, hit: true, dur: 0.25 }); this.removeEntity(m); }
      }
      if (!best) continue;
      st.nextShot = this.now + 1500;
      const dmg = L.dmg * rnd(0.85, 1.15);
      this.fxSys(st.sys, null, { k: 'beam', from: st.id, fromPos: st.pos, to: best.id, color: 0x60c0ff, hit: true, dur: 0.8, dmg: Math.round(dmg) });
      const owner = this.db.players[st.owner];
      const proxy = owner ? [...this.sessions].find(s => s.player === owner && s.ent) : null;
      this.applyDamage(best, dmg, proxy ? proxy.ent : null); // награда за убийство — владельцу, если он в системе
    }
  };

  // ---------- пиратские крепости ----------
  P.fortressTick = function (e) {
    // крепость сама выбирает цели в радиусе и бьёт всем, что есть; её ПРО работает автоматически
    if (!e.npcTarget) {
      const t = this.pirateTarget(e);
      if (t) e.npcTarget = t.id;
    }
  };
  P.fortressUpkeep = function () {
    if (this._fortCheck && this.now - this._fortCheck < 20000) return;
    this._fortCheck = this.now;
    const forts = this.db.fortresses || (this.db.fortresses = {});
    if (!this.anoms) this.anoms = new Map();
    for (const sys of Object.values(this.U.systems)) {
      if (sys.def.sec > -0.5) continue;
      const f = forts[sys.id] || (forts[sys.id] = { deadUntil: 0 });
      if (f.deadUntil > this.now) continue;
      if (f.entId && this.ents.has(f.entId)) continue;
      // позиция крепости постоянна для системы
      const r = require('./universe').rng('fort:' + sys.id), ang = r() * Math.PI * 2, rr = (1.5 + r() * 3) * AU;
      const pos = [Math.cos(ang) * rr, (r() - 0.5) * 0.03 * rr, Math.sin(ang) * rr];
      const e = this.spawnNpc('fortress', sys.id, pos, { name: `Крепость Скверны «${pick(['Чёрный Клык', 'Гнездо', 'Пасть', 'Цитадель Тьмы', 'Котёл'])}»` });
      e.home = pos; e.anom = 'an_fort_' + sys.id;
      f.entId = e.id;
      const a = { id: e.anom, sys: sys.id, kind: 'event', public: true, name: e.name, radius: 0, landing: 30000, pos, sig: 1, created: this.now, expires: Infinity, triggered: true, npcs: new Set([e.id]), fortress: true };
      this.anoms.set(a.id, a);
      for (const s of this.sessions) if (this.playerSys(s.player) === sys.id) this.sendAnoms(s);
    }
  };
  P.destroyShip = function (t, killer) {
    if (t.fortress) {
      const f = (this.db.fortresses || {})[t.sys];
      if (f) { f.deadUntil = this.now + FORTRESS_RESPAWN; f.entId = null; }
      if (this.anoms) { const a = this.anoms.get('an_fort_' + t.sys); if (a) { a.expires = this.now + 15 * 60000; a.done = true; } }
      for (const s of this.sessions) s.send({ t: 'chat', ch: 'global', from: 'Новости галактики', text: `${t.name} в системе ${this.U.byId[t.sys].name} пала! Скверна отступает из сектора.` });
    }
    return baseDestroy.call(this, t, killer);
  };

  P.piratesSlowTick = function () { this.pirateRaidTick(); this.defenseTick(); this.fortressUpkeep(); };
};
