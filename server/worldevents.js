// Мировые события: раз в 20–35 минут (когда в игре есть пилоты) в одной из систем появляется босс —
// «Колосс Предтеч» или пиратский дредноут «Левиафан Скверны» — с волнами эскорта. Новость получают все,
// на карте и в обзоре появляется метка ☄ для варпа. Охотники за головами слетаются на помощь.
// Каждый, кто нанёс боссу урон (сам, дронами или напарниками), получает долю награды по вкладу;
// тайник босса — трофейное снаряжение, которого нет больше нигде, редкие чертежи, реликвии и ксенон-ядра.
'use strict';
const crypto = require('crypto');
const { SYSTEMS, SHIPS, ITEMS, MODULES, incomeOf } = require('./data');

const uid = () => crypto.randomBytes(6).toString('hex');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const WEV = {
  every: [20 * 60000, 35 * 60000], first: 4 * 60000, duration: 20 * 60000, waveEvery: 60000,
  kinds: {
    invasion: { boss: 'wb_colossus', name: 'Вторжение Предтеч', hp: 5, escort: ['shard', 'shard', 'sentinel'], trophies: ['ev_core', 'ev_aegis'], pool: 1200000,
      news: (sys) => `Сенсоры фиксируют пробуждение Колосса Предтеч в системе ${sys}! Всем пилотам — на перехват. Награда — по вкладу в бой.` },
    dread:    { boss: 'wb_dread', name: 'Нападение дредноута', hp: 6, escort: ['raider', 'hunter', 'reaper'], trophies: ['ev_cannon', 'ev_warden'], pool: 1400000,
      news: (sys) => `Дредноут «Левиафан Скверны» вышел из прыжка в системе ${sys}! Кто собьёт флагман пиратов — поделит награду.` }
  }
};

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick, baseDestroy = P.destroyShip, baseApply = P.applyDamage, baseSendAnoms = P.sendAnoms, baseEntView = P.entView;

  P.wevAttacker = function (src) {
    if (!src) return null;
    if (src.wingOf) return src.wingOf;
    return this.pbaseAttacker(src);
  };
  // вклад в бой с боссом — по нанесённому урону
  P.applyDamage = function (t, dmg, src, ...rest) {
    if (t && t.wboss && this.wev && this.wev.boss === t.id && this.wevShielded()) {
      dmg *= 0.1;
      const s = src && this.wevAttacker(src) && [...this.sessions].find(x => x.player && x.player.name === this.wevAttacker(src));
      if (s && (!s.genWarn || this.now - s.genWarn > 20000)) { s.genWarn = this.now; this.notify(s, '☄ Щит Колосса держат генераторы — сначала уничтожьте четыре генератора щита!', 'warn'); }
    }
    if (t && t.wboss && this.wev && this.wev.boss === t.id) {
      const name = this.wevAttacker(src);
      if (name && this.db.players[name]) this.wev.dmg[name] = (this.wev.dmg[name] || 0) + dmg;
    }
    return baseApply.call(this, t, dmg, src, ...rest);
  };

  // купол щита на Колоссе виден, пока живы генераторы (клиент рисует его как купол пиратской базы)
  P.entView = function (o, viewer) {
    const v = baseEntView.call(this, o, viewer);
    if (v && o.wboss && this.wev && this.wev.boss === o.id && this.wevShielded()) v.pbs = 'waves';
    return v;
  };
  P.wevShielded = function () { const ev = this.wev; if (!ev || !ev.gens) return false; for (const id of ev.gens) if (this.ents.has(id)) return true; return false; };
  P.wevStart = function (kindId, sysId) {
    const K = WEV.kinds[kindId || pick(Object.keys(WEV.kinds))];
    kindId = Object.keys(WEV.kinds).find(k => WEV.kinds[k] === K);
    const cand = SYSTEMS.filter(s => s.sec < 0.8 && this.U.systems[s.id].celestials.some(c => c.kind === 'planet'));
    const def = sysId ? SYSTEMS.find(s => s.id === sysId) : pick(cand);
    const sys = this.U.systems[def.id];
    const pl = pick(sys.celestials.filter(c => c.kind === 'planet'));
    const a0 = Math.random() * Math.PI * 2;
    const pos = add(pl.pos, [Math.cos(a0) * ((pl.radius || 0) + 140000), rnd(-5000, 5000), Math.sin(a0) * ((pl.radius || 0) + 140000)]);
    const boss = this.spawnNpc(K.boss, def.id, pos);
    boss.wboss = true; boss.home = pos; boss.npcSpeedMul = 0.35; boss.regenMul = 0.05;
    const inc = incomeOf(def.id);
    for (const k of ['shield', 'armor', 'hull']) { boss.stats[k] = Math.round(boss.stats[k] * K.hp * (0.8 + 0.2 * inc)); boss[k] = boss.stats[k]; }
    const anomId = 'an_wev_' + uid();
    boss.anom = null;
    this.anoms.set(anomId, { id: anomId, sys: def.id, kind: 'wevent', public: true, name: `${K.name}: ${boss.name}`, radius: 0, landing: 25000, pos, sig: 1, created: this.now, expires: this.now + WEV.duration + 60000, triggered: true, npcs: new Set() });
    this.wev = { id: anomId, kind: kindId, sys: def.id, boss: boss.id, start: this.now, until: this.now + WEV.duration, nextWave: this.now + 20000, dmg: {}, escort: new Set(), gens: new Set() };
    // Колосс: четыре генератора щита вокруг — пока цел хоть один, по Колоссу проходит только 10% урона
    if (K.boss === 'wb_colossus') for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.4, gpos = add(pos, [Math.cos(a) * 7000, (i % 2 ? 1500 : -1500), Math.sin(a) * 7000]);
      const gnr = this.spawnNpc('wb_gen', def.id, gpos); gnr.npcSpeedMul = 0; gnr.home = gpos; gnr.wgen = true; gnr.regenMul = 0.2;
      this.wev.gens.add(gnr.id); this.wev.escort.add(gnr.id);
    }
    const text = K.news(def.name);
    for (const s of this.sessions) {
      s.send({ t: 'chat', ch: 'global', from: '*', text: '☄ ' + text });
      this.notify(s, `☄ Мировое событие: ${K.name} в системе ${def.name} — метка ☄ на карте и в обзоре`, 'warn');
      s.send({ t: 'wevent', sys: def.id, name: K.name, boss: boss.name, until: this.wev.until });
    }
    this.broadcastAnoms(def.id);
    // охотники за головами слетаются на помощь
    for (let i = 0; i < 3; i++) {
      const h = this.spawnCiv(def.id, { role: 'hunter', shipType: pick(['molot', 'strazh', 'vihr', 'citadel']), name: `Охотник ${pick(['Рэй', 'Кира', 'Зар', 'Ева', 'Гор', 'Нора'])} ${pick(['Корвин', 'Ноэль', 'Варга', 'Кейн', 'Сато'])}` });
      h.pos = add(pos, [rnd(-30000, 30000), rnd(-3000, 3000), rnd(-30000, 30000)]); h.engage = boss.id; h.wevHelper = true;
    }
    return this.wev;
  };

  P.wevEnd = function (won) {
    const ev = this.wev; if (!ev) return;
    this.wev = null;
    this.wevNext = this.now + rnd(...WEV.every); // пауза 20–35 минут — от конца события
    const K = WEV.kinds[ev.kind], sysName = (SYSTEMS.find(s => s.id === ev.sys) || {}).name;
    const a = this.anoms.get(ev.id); if (a) { a.done = true; a.expires = this.now + (won ? 10 * 60000 : 0); }
    for (const id of ev.escort) { const e = this.ents.get(id); if (e) this.removeEntity(e); }
    for (const e of [...this.ents.values()]) if (e.wevHelper) this.removeEntity(e);
    if (!won) {
      const boss = this.ents.get(ev.boss); if (boss) { this.fxSys(boss.sys, boss.pos, { k: 'jump', pos: boss.pos }); this.removeEntity(boss); }
      for (const s of this.sessions) { s.send({ t: 'chat', ch: 'global', from: '*', text: `☄ «${K.name}» в системе ${sysName}: враг ушёл в прыжок. Следующий шанс — позже.` }); s.send({ t: 'wevent', sys: null }); }
      this.broadcastAnoms(ev.sys);
      return;
    }
    // награда: CR по доле урона (каждому участнику не меньше 8% пула), тайник с трофеями — у места боя
    const total = Object.values(ev.dmg).reduce((x, y) => x + y, 0) || 1;
    const pool = K.pool * (0.6 + 0.4 * incomeOf(ev.sys)), names = Object.keys(ev.dmg); // доход региона влияет мягче, чем на добычу
    for (const n of names) {
      const p = this.db.players[n]; if (!p) continue;
      const share = Math.max(0.08, ev.dmg[n] / total), isk = Math.round(pool * share);
      p.credits += isk; p.stats.wevents = (p.stats.wevents || 0) + 1;
      const s = [...this.sessions].find(x => x.player === p);
      if (s) { this.notify(s, `☄ Босс повержен! Ваш вклад ${Math.round(ev.dmg[n] / total * 100)}% — награда ${fmt(isk)} CR. Заберите тайник босса!`, 'good'); this.sendProfile(s); }
    }
    const items = { salv_relic: 3 + Math.floor(Math.random() * 4), mat_xcore: 2 + Math.floor(Math.random() * 4) };
    for (let i = 0; i < Math.min(3, 1 + Math.floor(names.length / 2)); i++) { const t = pick(K.trophies); items[t] = (items[t] || 0) + 1; }
    if (Math.random() < 0.6) { const bp = this.rareBlueprint(); if (bp) items[bp] = 1; }
    const w = { id: 'wr_' + uid(), type: 'wreck', sys: ev.sys, pos: ev.bossPos || (a && a.pos), vel: [0, 0, 0], radius: 160, name: `Тайник: ${K.name}`, items, expires: this.now + 30 * 60000 };
    this.ents.set(w.id, w);
    const trophies = Object.keys(items).filter(k => MODULES[k] && MODULES[k].trophy).map(k => `«${MODULES[k].name}»`).join(', ');
    for (const s of this.sessions) { s.send({ t: 'chat', ch: 'global', from: '*', text: `☄ Победа! «${K.name}» в системе ${sysName} отражено. Участников: ${names.length}. В тайнике — ${trophies}.` }); s.send({ t: 'wevent', sys: null }); }
    this.broadcastAnoms(ev.sys);
  };

  P.destroyShip = function (t, killer) {
    if (this.wev && t.id === this.wev.boss) {
      this.wev.bossPos = t.pos.slice();
      const name = this.wevAttacker(killer);
      if (name && this.db.players[name]) this.wev.dmg[name] = (this.wev.dmg[name] || 0) + 1;
      const r = baseDestroy.call(this, t, killer);
      this.wevEnd(true);
      return r;
    }
    if (this.wev) {
      this.wev.escort.delete(t.id);
      if (this.wev.gens && this.wev.gens.delete(t.id)) {
        const left = [...this.wev.gens].filter(id => this.ents.has(id) && id !== t.id).length;
        for (const s of this.sessions) if (s.ent && s.ent.sys === this.wev.sys) this.notify(s, left ? `☄ Генератор щита уничтожен! Осталось: ${left}` : '☄ Все генераторы уничтожены — щит Колосса пал! Огонь по Колоссу!', 'good');
      }
    }
    return baseDestroy.call(this, t, killer);
  };

  P.wevTick = function () {
    if (!this.anoms) return;
    const online = [...this.sessions].some(s => s.player);
    if (!this.wev) {
      if (!online) return;
      if (!this.wevNext) this.wevNext = this.now + WEV.first;
      // пилот на сюжетном этапе «Первый Колосс» — событие начнётся в ближайшие полторы минуты
      if ([...this.sessions].some(s => { const st = s.player && s.player.story, md = st && st.state === 'active' && require('./story').MISSIONS[st.m], sg = md && md.stages[st.st]; return sg && sg.type === 'stat' && sg.stat === 'wevents'; }))
        this.wevNext = Math.min(this.wevNext, this.now + 90000);
      if (this.now >= this.wevNext) { this.wevNext = Infinity; this.wevStart(); } // следующее назначается, когда это закончится
      return;
    }
    const ev = this.wev, boss = this.ents.get(ev.boss);
    if (!boss) return this.wevEnd(false);
    // лучи от генераторов к Колоссу — видно, что держит щит
    if (ev.gens && ev.gens.size && (!ev.beamAt || this.now - ev.beamAt > 2500)) { ev.beamAt = this.now; for (const id of ev.gens) if (this.ents.has(id)) this.fxSys(ev.sys, null, { k: 'beam', from: id, to: boss.id, color: 0x9a70ff, hit: true, dur: 2.4 }); }
    if (this.now > ev.until) return this.wevEnd(false);
    // волны эскорта, пока рядом есть пилоты
    const near = [...this.sessions].some(s => s.ent && s.ent.sys === ev.sys && dist(s.ent.pos, boss.pos) < 150000);
    if (near && this.now >= ev.nextWave && ev.escort.size < 8) {
      ev.nextWave = this.now + WEV.waveEvery;
      for (const type of WEV.kinds[ev.kind].escort) {
        const e = this.spawnNpc(type, ev.sys, add(boss.pos, [rnd(-12000, 12000), rnd(-2000, 2000), rnd(-12000, 12000)]));
        e.home = boss.pos.slice(); ev.escort.add(e.id);
        this.fxSys(ev.sys, e.pos, { k: 'jump', pos: e.pos });
      }
    }
  };
  P.slowTick = function () {
    baseSlow.call(this);
    this.wevTick();
  };
  // новому пилоту — текущее событие на карте
  P.sendAnoms = function (s) {
    baseSendAnoms.call(this, s);
    if (this.wev && !s.wevSent) { s.wevSent = true; s.send({ t: 'wevent', sys: this.wev.sys, name: WEV.kinds[this.wev.kind].name, until: this.wev.until }); }
  };
};
module.exports.WEV = WEV;
