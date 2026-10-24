// Искусственный интеллект: тактика пиратов, поведение гражданских, ИИ-пилоты со своей экономикой.
// Подмешивается в класс Game поверх базового поведения.
'use strict';
const crypto = require('crypto');
const { SHIPS, MODULES, NPCS, ITEMS, incomeOf, SYSTEMS, REGIONS } = require('./data');
const { route } = require('./universe');

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const norm = (a) => { const l = Math.hypot(...a); return l > 1e-9 ? a.map(x => x / l) : [0, 0, 1]; };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const uid = () => crypto.randomBytes(6).toString('hex');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const MIN_WARP = 150000;

// Лестница кораблей по роли: ИИ-пилот копит деньги и строит следующий
const LADDER = {
  miner: ['iskra', 'staratel', 'burlak', 'leviafan', 'begemot'],
  hunter: ['klinok', 'vihr', 'strazh', 'molot', 'citadel'],
  trader: ['tyagach', 'kit'],
  pirate: ['klinok', 'vihr', 'strazh', 'molot', 'citadel']
};
const ROLE_NAME = { miner: 'Шахтёр', hunter: 'Охотник за головами', trader: 'Торговец', pirate: 'Пиратский главарь' };
// доход в минуту на ступени 0 (растёт с каждой ступенью) и риск гибели в минуту по уровню безопасности
const ECON = {
  miner:  { base: 9000, step: 1.3, risk: [0, 0.004, 0.012, 0.025] },
  hunter: { base: 12000, step: 1.3, risk: [0, 0.006, 0.015, 0.03] },
  trader: { base: 22000, step: 3.5, risk: [0, 0.003, 0.012, 0.03] },
  pirate: { base: 14000, step: 1.3, risk: [0, 0.01, 0.012, 0.015] }
};
// куда тянет пилота: регионы по ступени корабля
const HABITAT = {
  miner: [['core', 'border'], ['core', 'border'], ['border', 'low'], ['low', 'null', 'deep']],
  hunter: [['border', 'low'], ['border', 'low'], ['low', 'null'], ['low', 'null'], ['null', 'deep']],
  trader: [['core', 'border'], ['core', 'border', 'low']],
  pirate: [['low'], ['low', 'null'], ['low', 'null'], ['null', 'deep'], ['null', 'deep']]
};
const FIRST = ['Арс', 'Вега', 'Дан', 'Кира', 'Лео', 'Мира', 'Ник', 'Ольга', 'Рэй', 'Тэо', 'Юна', 'Зар', 'Ирма', 'Сол', 'Тарас', 'Ева', 'Гор', 'Лана', 'Марк', 'Нора', 'Ян', 'Ада'];
const LAST = ['Корвин', 'Стрельцов', 'Ноэль', 'Варга', 'Айхен', 'Мерк', 'Ростов', 'Кейн', 'Орлова', 'Тайри', 'Векс', 'Лунд', 'Сато', 'Белых', 'Драгер', 'Рейн'];
const PIRATE_NICK = ['Гадюка', 'Ворон', 'Шрам', 'Палач', 'Клык', 'Призрак', 'Барракуда', 'Мясник'];
const secBand = (sec) => sec >= 0.5 ? 0 : sec > 0 ? 1 : sec > -0.8 ? 2 : 3;

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseAiTick = P.aiTick, baseCivTick = P.civTick, baseDestroy = P.destroyShip, baseSpawnCiv = P.spawnCiv;

  // ======================================================================
  // Тактика пиратов и преступников
  // ======================================================================
  // Оценка цели: ценность и уязвимость, а не только расстояние
  P.pirateTarget = function (e) {
    // сюжетная атака: волна идёт на охраняемый транспорт
    if (e.storyFocus && Math.random() < 0.75) { const f = this.ents.get(e.storyFocus); if (f && f.sys === e.sys && dist(f.pos, e.pos) < 150000) return f; }
    const sec = this.U.byId[e.sys].sec;
    let best = null, bestScore = 0;
    for (const o of this.ents.values()) {
      if (o.sys !== e.sys || o === e || o.warp) continue;
      if (o.type !== 'ship' && o.type !== 'drone') continue;
      if (o.npc || o.guardian || o.dealer) continue;
      if (o.invulnUntil && o.invulnUntil > this.now) continue;
      if (o.civ && sec >= 0.5) continue; // в безопасных системах гражданских не трогают
      const d = dist(o.pos, e.pos);
      if (d > 70000) continue;
      let s = o.owner ? 1.25 : o.civ === 'miner' || o.civ === 'hauler' ? 1.4 : o.civ ? 1.0 : 0.5;
      if (o.type === 'drone') s = 0.5;
      const hpFrac = (o.shield + o.armor + o.hull) / (o.stats.shield + o.stats.armor + o.stats.hull);
      s *= 1 + (1 - hpFrac) * 1.2;                            // добивать раненых
      if ((e.aggressors.get(o.id) || 0) > this.now) s *= 1.8;  // отвечать обидчику
      if (o.type === 'drone' && (e.aggressors.get(o.id) || 0) > this.now) s *= 2;
      s /= 1 + d / 25000;
      if (s > bestScore) { bestScore = s; best = o; }
    }
    return best;
  };

  P.groupKey = function (e) { return e.belt || e.anom || e.fleet || null; };

  P.aiTick = function (e) {
    if (this.now < e.nextThink) return;
    e.nextThink = this.now + 500;
    if (e.guardian) return this.guardianTick(e);
    if (e.warp || e.cmd.type === 'align') return;

    // отступление на ремонт
    if (e.retreating) {
      e.shield = Math.min(e.stats.shield, e.shield + e.stats.shield * 0.02);
      e.armor = Math.min(e.stats.armor, e.armor + e.stats.armor * 0.02);
      e.hull = Math.min(e.stats.hull, e.hull + e.stats.hull * 0.015);
      if (this.now > e.retreatUntil) {
        e.retreating = false;
        if (e.home && dist(e.home, e.pos) > MIN_WARP) this.startAlignWarp(e, { pos: e.home, name: 'засада', landing: 12000 }, 0);
      }
      return;
    }
    const hullFrac = e.hull / e.stats.hull;
    if (!e.fled && hullFrac < 0.3 && e.scrambledUntil < this.now && Math.random() < 0.65) {
      const sys = this.U.systems[e.sys];
      const spots = sys.celestials.filter(c => (c.kind === 'planet' || c.kind === 'belt') && dist(c.pos, e.pos) > MIN_WARP * 3);
      if (spots.length) {
        e.fled = true; e.retreating = true; e.retreatUntil = this.now + 50000 + Math.random() * 40000;
        for (const m of e.modules) m.active = false;
        e.npcTarget = null; e.locks.clear();
        if (Math.random() < 0.6) this.broadcastSys(e.sys, { t: 'chat', ch: 'local', from: e.name, text: pick(['Отходим! Ещё встретимся.', 'Корпус трещит — ухожу на ремонт.', 'Это не конец. Я вернусь.']) });
        this.startAlignWarp(e, pick(spots), 0);
        return;
      }
    }

    // выбор цели: личный выбор + общая цель группы (фокус огня)
    let t = e.npcTarget ? this.ents.get(e.npcTarget) : null;
    if (t && (t.sys !== e.sys || t.warp || dist(t.pos, e.pos) > 150000)) { t = null; e.npcTarget = null; e.locks.clear(); }
    const gk = this.groupKey(e);
    const groups = this.aiGroups || (this.aiGroups = new Map());
    const gt = gk && groups.get(gk);
    if (gt && gt.until > this.now) {
      const o = this.ents.get(gt.id);
      if (o && o.sys === e.sys && !o.warp && dist(o.pos, e.pos) < 90000 && o !== t) { t = o; e.npcTarget = o.id; }
    }
    if (!t || this.now > (e.nextPick || 0)) {
      e.nextPick = this.now + 2500;
      const cand = this.pirateTarget(e);
      if (cand && cand !== t) {
        const firstContact = !t;
        t = cand; e.npcTarget = cand.id; e.locks.clear(); e.locking.clear();
        if (gk) groups.set(gk, { id: cand.id, until: this.now + 8000 });
        if (firstContact && (e.outlaw || e.aiPilot) && (!e.taunt || this.now - e.taunt > 120000)) {
          e.taunt = this.now;
          this.broadcastSys(e.sys, { t: 'chat', ch: 'local', from: e.name, text: pick([`Твой трюм теперь мой, ${cand.name}.`, 'Ничего личного, просто бизнес.', `Беги, ${cand.name}. Если успеешь.`, 'Здесь нет Стражей. Только я.', 'Окружаем. Огонь по моей цели!']) });
        }
      }
    }
    if (!t) return baseAiTick.call(this, Object.assign(e, { nextThink: 0 })); // бродить / возвращаться домой

    // дистанция под своё оружие: дальнобойные держат дистанцию, ближние кружат
    const def = MODULES[e.modules[0].id];
    const d = this.surfaceDist(e, t);
    const longRange = def.optimal >= 20000;
    const want = def.optimal * (longRange ? 0.8 : 0.5);
    if (longRange) { if (e.cmd.type !== 'keep' || e.cmd.target !== t.id) e.cmd = { type: 'keep', target: t.id, range: want }; }
    else if (e.cmd.type !== 'orbit' || e.cmd.target !== t.id) e.cmd = { type: 'orbit', target: t.id, range: want };

    // варп-глушитель у охотников, преступников и ИИ-пиратов
    if ((e.outlaw || e.npc === 'hunter' || e.aiPilot) && d < 10000 && t.type === 'ship') {
      if (t.scrambledUntil < this.now && t.session) this.notify(t.session, `${e.name} глушит ваш варп-двигатель!`, 'bad');
      t.scrambledUntil = Math.max(t.scrambledUntil, this.now + 1500);
    }
    if (!e.locks.has(t.id) && !e.locking.has(t.id)) e.locking.set(t.id, this.now + 2000);
    if (e.locks.has(t.id)) {
      for (const m of e.modules) {
        if (m.target !== t.id) m.active = false;
        if (!m.active && d < def.optimal + def.falloff) { m.target = t.id; m.active = true; if (this.now >= m.cycleEnd) this.startCycle(e, m); }
      }
    }
    // подкрепление, если группа несёт потери
    if (e.belt && this.beltState[e.belt]) {
      const bs = this.beltState[e.belt];
      const recent = (bs.losses || []).filter(x => this.now - x < 60000).length;
      if (recent >= 2 && this.now > (bs.reinfUntil || 0)) {
        bs.reinfUntil = this.now + 180000;
        if (Math.random() < 0.4) {
          const sec = this.U.byId[e.sys].sec;
          const types = sec >= 0.5 ? ['raider', 'raider'] : sec > 0 ? ['reaper', 'hunter'] : ['warlord', 'reaper'];
          for (const type of types) {
            const pos = add(e.pos, [rnd(-15000, 15000), rnd(-3000, 3000), rnd(-15000, 15000)]);
            const r = this.spawnNpc(type, e.sys, pos);
            r.belt = e.belt; r.home = e.home; bs.npcs.add(r.id);
            this.fxSys(e.sys, pos, { k: 'jump', pos });
          }
          this.broadcastSys(e.sys, { t: 'chat', ch: 'local', from: NPCS[types[0]].name, text: 'Братья, на помощь! Подкрепление прибыло.' });
        }
      }
    }
  };

  // ======================================================================
  // Гражданские: бегство под огнём, охотники отвечают ударом
  // ======================================================================
  P.civTick = function (e) {
    if (e.storyHold) { e.cmd = e.escortDir ? { type: 'dir', dir: e.escortDir } : { type: 'stop' }; return; } // сюжетный транспорт стоит или идёт по маршруту сопровождения
    // охотник держит бой, пока противник жив и рядом
    if (e.civ === 'hunter') {
      if (e.lastHitAt && this.now - e.lastHitAt < 6000 && e.lastAttacker) e.engage = e.lastAttacker;
      const foe = e.engage && this.ents.get(e.engage);
      if (foe && foe.sys === e.sys && !foe.warp && dist(foe.pos, e.pos) < 100000) {
        if (this.now < e.nextThink || e.warp) return;
        e.nextThink = this.now + 1000;
        if (e.cmd.type === 'align') e.cmd = { type: 'stop' };
        const fd = this.surfaceDist(e, foe);
        // форсаж, пока цель далеко
        e.cmd = { type: 'orbit', target: foe.id, range: 6000 }; e.speedFrac = fd > 15000 ? 1.7 : 1;
        if (fd < 24000 && this.now >= (e.nextShot || 0)) {
          e.nextShot = this.now + 2500;
          const hit = Math.random() < 0.8;
          this.fxSys(e.sys, null, { k: 'beam', from: e.id, to: foe.id, color: 0xffa040, hit, dur: 0.9 });
          if (hit) this.applyDamage(foe, rnd(45, 110) * (SHIPS[e.shipType].radius > 100 ? 2 : 1) * (1 + 0.3 * this.aiTier(e)), e);
          if (!this.ents.has(foe.id)) { e.engage = null; if (foe.npc) this.aiEarn(e, NPCS[foe.npc].bounty * incomeOf(e.sys)); }
        }
        return;
      }
      e.engage = null;
    } else if (!e.warp && e.lastHitAt && this.now - e.lastHitAt < 6000) {
      const att = e.lastAttacker && this.ents.get(e.lastAttacker);
      if (!e.fleeing) {
        e.fleeing = true;
        const sys = this.U.systems[e.sys];
        const st = sys.stations.length ? pick(sys.stations) : null;
        e.goal = st ? { type: 'dock', target: st.id } : { type: 'jump', target: pick(sys.gates).id };
        if (Math.random() < 0.8) this.broadcastSys(e.sys, { t: 'chat', ch: 'local', from: e.name, text: pick(['Меня атакуют! Ухожу!', 'Помогите! Пираты в поясе!', 'Бросаю всё, улетаю.', 'Охотники, сюда! Меня бьют!']) });
        // охотники в системе спешат на помощь
        if (att) for (const h of this.ents.values()) if (h.civ === 'hunter' && h.sys === e.sys && !h.warp && dist(h.pos, e.pos) < 400000) h.engage = att.id;
      }
    }
    // под глушилкой варп невозможен — бегство полным ходом прочь от нападающего
    if (e.fleeing && e.scrambledUntil > this.now && !e.warp) {
      const att = e.lastAttacker && this.ents.get(e.lastAttacker);
      if (att) { e.cmd = { type: 'dir', dir: norm(sub(e.pos, att.pos)) }; e.speedFrac = 1; }
      return;
    }
    if (e.fleeing && e.cmd.type === 'dir') e.cmd = { type: 'stop' };
    return baseCivTick.call(this, e);
  };

  P.aiTier = function (e) { const p = e.aiPilot && this.aiPilot(e.aiPilot); return p ? LADDER[p.role].indexOf(p.ship) : 0; };

  // Гражданские корабли теперь можно уничтожить: обломки, гибель ИИ-пилота
  P.destroyShip = function (t, killer) {
    if (!t.civ && !t.aiPilot) return baseDestroy.call(this, t, killer);
    const sysId = t.sys;
    this.fxSys(sysId, t.pos, { k: 'boom', pos: t.pos, size: t.radius * 4 });
    const items = { salv_scrap: 1 + Math.floor(Math.random() * 4) };
    if (t.civ === 'miner') items[pick(['ore_ferit', 'ore_korundit', 'ore_arkselit'])] = 50 + Math.floor(Math.random() * 300);
    if (t.civ === 'hauler') items[pick(['mat_steel', 'mat_ceramite', 'cb_spice', 'salv_core'])] = 2 + Math.floor(Math.random() * 20);
    if (t.npc && NPCS[t.npc]) for (const [item, chance, a, b] of NPCS[t.npc].loot) if (Math.random() < chance) items[item] = (items[item] || 0) + Math.floor(rnd(a, b + 1));
    this.removeEntity(t);
    if (t.belt && this.beltState[t.belt]) { this.beltState[t.belt].npcs.delete(t.id); (this.beltState[t.belt].losses = this.beltState[t.belt].losses || []).push(this.now); }
    const w = { id: 'wr_' + uid(), type: 'wreck', sys: sysId, pos: t.pos.slice(), vel: [0, 0, 0], radius: 60, name: `Обломки: ${t.name}`, items, expires: this.now + 20 * 60000 };
    this.ents.set(w.id, w);
    const killerEnt = killer && this.ents.get(killer.id);
    const killerName = killerEnt ? (killerEnt.owner || killerEnt.name) : 'неизвестно';
    this.broadcastSys(sysId, { t: 'chat', ch: 'local', from: '*', text: `${t.name} (${SHIPS[t.shipType].name}) уничтожен. Убийца: ${killerName}` });
    // награда игроку за ИИ-пирата
    if (t.npc && killerEnt && killerEnt.owner) {
      const kp = this.db.players[killerEnt.owner];
      const bounty = Math.round((NPCS[t.npc].bounty + SHIPS[t.shipType].price * 0.15) * incomeOf(sysId));
      kp.credits += bounty; kp.stats.npcKills++;
      if (killerEnt.session) { this.notify(killerEnt.session, `Уничтожен ${t.name}. Награда за голову: ${fmt(bounty)} ISK`, 'good'); this.sendProfile(killerEnt.session); }
    }
    // добыча убийцы — ИИ-пилота
    const kpil = killerEnt && killerEnt.aiPilot && this.aiPilot(killerEnt.aiPilot);
    if (kpil) { kpil.credits += Math.round(SHIPS[t.shipType].price * 0.2 + 5000); kpil.kills++; }
    if (t.aiPilot) this.aiPilotDied(this.aiPilot(t.aiPilot), killerName);
    if (t.civ) this.sendLocalMembers(sysId);
  };

  // ======================================================================
  // ИИ-пилоты: экономика, перемещения, постройка кораблей
  // ======================================================================
  P.initAI = function () {
    if (!this.db.ai) this.db.ai = { pilots: [] };
    const ai = this.db.ai;
    if (!ai.pilots.length) {
      const used = new Set();
      const mk = (role) => {
        let name;
        do name = role === 'pirate' ? `${pick(FIRST)} «${pick(PIRATE_NICK)}»` : `${pick(FIRST)} ${pick(LAST)}`; while (used.has(name));
        used.add(name);
        const tier = Math.random() < 0.6 ? 0 : 1;
        const regs = HABITAT[role][tier];
        const sys = pick(SYSTEMS.filter(s => regs.includes(s.region)));
        ai.pilots.push({ id: 'ai_' + uid(), name, role, ship: LADDER[role][Math.min(tier, LADDER[role].length - 1)], sys: sys.id,
          credits: Math.round(rnd(5000, 60000)), kills: 0, deaths: 0, earned: 0, built: 0, state: 'fly', dest: null, buildUntil: 0, buildShip: null, restUntil: 0 });
      };
      for (const [role, n] of [['miner', 5], ['hunter', 4], ['trader', 3], ['pirate', 4]]) for (let i = 0; i < n; i++) mk(role);
    }
    this.aiEnts = new Map(); // id пилота → id сущности в космосе
  };

  P.aiPilot = function (id) { return this.db.ai && this.db.ai.pilots.find(p => p.id === id); };

  P.aiNews = function (text) { for (const s of this.sessions) s.send({ t: 'chat', ch: 'global', from: '*', text: 'Новости галактики: ' + text }); };

  P.aiPilotDied = function (p, killer) {
    if (!p) return;
    this.aiEnts.delete(p.id);
    p.deaths++;
    const lad = LADDER[p.role], i = lad.indexOf(p.ship);
    const lost = p.ship;
    p.ship = lad[Math.max(0, i - 1)];
    p.credits = Math.round(p.credits * 0.8 + SHIPS[lost].price * 0.3); // страховка
    p.state = 'fly'; p.restUntil = this.now + 120000;
    // уцелевший пилот возвращается в свои края
    const regs = HABITAT[p.role][Math.min(lad.indexOf(p.ship), HABITAT[p.role].length - 1)];
    p.sys = pick(SYSTEMS.filter(s => regs.includes(s.region) && this.U.systems[s.id].stations.length)).id;
    this.aiNews(`${p.name} (${ROLE_NAME[p.role].toLowerCase()}): потерян корабль «${SHIPS[lost].name}»${killer ? ', убийца — ' + killer : ''}. Пилот пересел на «${SHIPS[p.ship].name}».`);
  };

  P.aiEconomyTick = function () {
    if (!this.db.ai) return;
    if (this._aiEcon && this.now - this._aiEcon < 5000) return;
    const dtMin = this._aiEcon ? (this.now - this._aiEcon) / 60000 : 0;
    this._aiEcon = this.now;
    const occupied = new Set();
    for (const s of this.sessions) if (s.ent) occupied.add(s.ent.sys);
    for (const p of this.db.ai.pilots) {
      const live = this.aiEnts.get(p.id);
      const ent = live && this.ents.get(live);
      if (live && !ent) this.aiEnts.delete(p.id);
      const lad = LADDER[p.role], tier = lad.indexOf(p.ship);
      // постройка корабля
      if (p.state === 'building') {
        if (this.now >= p.buildUntil) {
          const old = p.ship;
          p.ship = p.buildShip; p.state = 'fly'; p.buildShip = null; p.built++;
          this.aiNews(`${p.name} (${ROLE_NAME[p.role].toLowerCase()}): на верфи системы ${this.U.byId[p.sys].name} достроен новый корабль «${SHIPS[p.ship].name}» вместо «${SHIPS[old].name}».`);
          this.broadcastSys(p.sys, { t: 'chat', ch: 'local', from: p.name, text: pick(['Новый корабль готов! Пора за работу.', `Встречайте мой «${SHIPS[p.ship].name}».`, 'Долго копил — и вот он, красавец.']) });
        }
        continue;
      }
      if (ent) continue; // пока пилот в космосе рядом с игроком, он зарабатывает «вживую»
      // заработок и риск в фоне
      const sec = this.U.byId[p.sys].sec;
      const E = ECON[p.role];
      const inc = E.base * (1 + tier * E.step) * (p.role === 'trader' ? 1 : incomeOf(p.sys)) * dtMin * rnd(0.6, 1.4);
      p.credits += Math.round(inc); p.earned += Math.round(inc);
      if (Math.random() < E.risk[secBand(sec)] * dtMin * (p.role === 'pirate' ? 1 : 1 / (1 + tier * 0.4))) { this.aiPilotDied(p, p.role === 'pirate' ? 'охотники за головами' : 'пираты'); continue; }
      // решение строить следующий корабль
      const next = lad[tier + 1];
      if (next && p.credits >= SHIPS[next].price * 1.15) {
        const sys = this.U.systems[p.sys];
        if (sys.stations.length) {
          p.credits -= SHIPS[next].price;
          p.state = 'building'; p.buildShip = next;
          p.buildUntil = this.now + Math.min(300, 25 + SHIPS[next].price / 12000) * 1000;
          this.aiNews(`${p.name} (${ROLE_NAME[p.role].toLowerCase()}): на верфи системы ${sys.def.name} заложен корабль «${SHIPS[next].name}» за ${fmt(SHIPS[next].price)} ISK.`);
          continue;
        }
      }
      // перемещение: в подходящий регион, по одному прыжку
      if (!p.dest || p.dest === p.sys) {
        if (Math.random() < 0.05 * dtMin * 12) {
          const regs = HABITAT[p.role][Math.min(tier, HABITAT[p.role].length - 1)];
          const opts = SYSTEMS.filter(s => regs.includes(s.region));
          p.dest = pick(opts).id;
        }
      } else if (this.now > (p.nextJump || 0)) {
        const r = route(this.U.neighbors, p.sys, p.dest);
        if (r && r.length > 1) {
          const from = p.sys; p.sys = r[1]; p.nextJump = this.now + 30000;
          // если в системе-источнике или назначении есть игроки — показываем прыжок
          if (occupied.has(from) || occupied.has(p.sys)) this.sendLocalMembers(from), this.sendLocalMembers(p.sys);
        } else p.dest = null;
      }
    }
  };

  // Пилот появляется вживую, если в его системе есть игрок
  P.aiMaterialize = function (occupied) {
    if (!this.db.ai) return;
    for (const p of this.db.ai.pilots) {
      if (p.state === 'building' || !occupied.has(p.sys) || this.now < (p.restUntil || 0)) continue;
      const live = this.aiEnts.get(p.id);
      if (live && this.ents.has(live)) continue;
      const sys = this.U.systems[p.sys];
      let e;
      if (p.role === 'pirate') {
        const spot = pick(sys.belts.length ? sys.belts : sys.gates);
        const pos = add(spot.pos, [rnd(-20000, 20000), rnd(-3000, 3000), rnd(-20000, 20000)]);
        e = this.spawnNpc('outlaw', p.sys, pos, { ship: p.ship, name: p.name });
        e.outlaw = true; e.home = spot.pos; e.nextRoam = this.now + 20000;
        const k = 1 + 0.35 * LADDER.pirate.indexOf(p.ship);
        e.stats.shield *= k; e.stats.armor *= k; e.stats.hull *= k; e.shield = e.stats.shield; e.armor = e.stats.armor; e.hull = e.stats.hull;
        e.bountyMul = k; e.npcDmgMul *= 1 + 0.15 * LADDER.pirate.indexOf(p.ship);
        this.fxSys(p.sys, pos, { k: 'jump', pos });
        // свита из обычных пиратов у крупных главарей
        const tier = LADDER.pirate.indexOf(p.ship);
        if (tier >= 2) for (let i = 0; i < tier - 1; i++) { const m = this.spawnNpc(pick(['raider', 'hunter']), p.sys, add(pos, [rnd(-6000, 6000), 0, rnd(-6000, 6000)])); m.fleet = p.id; m.home = spot.pos; }
        e.fleet = p.id;
      } else {
        e = baseSpawnCiv.call(this, p.sys, { role: p.role === 'trader' ? 'hauler' : p.role, shipType: p.ship, name: p.name });
        if (!e) continue;
      }
      e.aiPilot = p.id;
      this.aiEnts.set(p.id, e.id);
    }
    // уходят из пустых систем
    for (const [pid, eid] of this.aiEnts) {
      const e = this.ents.get(eid);
      if (!e) { this.aiEnts.delete(pid); continue; }
      if (!occupied.has(e.sys)) { this.removeEntity(e); this.aiEnts.delete(pid); }
    }
  };

  // Гражданский улетел через врата или пристыковался — ИИ-пилот продолжает путь
  P.civLeft = function (e, how, tgt) {
    const p = e.aiPilot && this.aiPilot(e.aiPilot);
    if (!p) return;
    this.aiEnts.delete(p.id);
    p.restUntil = this.now + 90000;
    if (how === 'jump' && tgt && tgt.dest) { p.sys = tgt.dest; p.nextJump = this.now + 30000; }
  };

  // Живой заработок (добыча, охота) зачисляется ИИ-пилоту
  P.aiEarn = function (e, amount) { const p = e.aiPilot && this.aiPilot(e.aiPilot); if (p) { p.credits += Math.round(amount); p.earned += Math.round(amount); } };

  // Окно «Пилоты галактики»
  P.c_aiList = function (s) {
    const list = (this.db.ai ? this.db.ai.pilots : []).map(p => ({
      name: p.name, role: p.role, roleName: ROLE_NAME[p.role], ship: p.ship, sys: p.sys, credits: p.credits, kills: p.kills, deaths: p.deaths, built: p.built,
      worth: p.credits + SHIPS[p.ship].price, building: p.state === 'building' ? { ship: p.buildShip, left: Math.max(0, p.buildUntil - this.now) } : null,
      live: this.aiEnts.has(p.id), next: LADDER[p.role][LADDER[p.role].indexOf(p.ship) + 1] || null
    }));
    for (const o of this.sessions) {
      const q = o.player;
      list.push({ name: q.name, player: true, roleName: 'Игрок', ship: q.ship.type, sys: this.playerSys(q), credits: q.credits, kills: q.stats.kills + q.stats.npcKills, deaths: q.stats.deaths, worth: q.credits + SHIPS[q.ship.type].price });
    }
    list.sort((a, b) => b.worth - a.worth);
    s.send({ t: 'aiList', list });
  };
};
