// Контракты агентов (8 шаблонов) и случайные события мира.
// Шаблоны: перехват, доставка, добыча, разведка, спасение, оборона, сопровождение, исследование аномалии.
// События: сигнал бедствия, повреждённый транспорт, тайник, нестабильная аномалия, налёт пиратов.
'use strict';
const crypto = require('crypto');
const { ITEMS, NPCS, oresForSec, incomeOf } = require('./data');
const { route, makeAsteroid, rng } = require('./universe');
const { factionOfSys } = require('./story');

const uid = () => crypto.randomBytes(6).toString('hex');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const AU = 1.496e11;

ITEMS.q_pod = { name: 'Спасательная капсула с пилотом', cat: 'Миссия', vol: 5, base: 0, quest: true };

// Шаблоны контрактов: вес в генераторе и проверка, подходит ли система
const TEMPLATES = {
  kill:    { w: 2, ok: (sec, j) => sec < 0.8 && j <= 5 },
  courier: { w: 2, station: true },
  mine:    { w: 1.5, local: true },
  recon:   { w: 1.2, ok: (sec, j) => j >= 1 && j <= 4 },
  rescue:  { w: 1.2, ok: (sec, j) => j >= 1 && j <= 4 },
  defend:  { w: 1.2, ok: (sec, j) => sec < 0.8 && j <= 4 },
  escort:  { w: 1, ok: (sec, j) => sec < 0.8 && j <= 4 },
  anomaly: { w: 1, ok: (sec, j) => sec < 0.9 && j <= 4 }
};
const SITE_TYPES = new Set(['recon', 'rescue', 'defend', 'escort']);

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseCompleteMission = P.completeMission, baseAbandon = P.c_abandonMission, baseCheckCourier = P.checkCourier;

  // ---------- генератор контрактов ----------
  P.missionBoard = function (stationId) {
    let b = this.missionBoards[stationId];
    if (b && b.until > this.now) return b;
    const sysId = this.U.celestials[stationId].sys;
    const near = Object.keys(this.U.systems).map(id => ({ id, r: route(this.U.neighbors, sysId, id) })).filter(x => x.r && x.r.length <= 6)
      .map(x => ({ id: x.id, j: x.r.length - 1, sec: this.U.byId[x.id].sec }));
    const offers = [], used = new Set();
    const names = (id) => this.U.byId[id].name;
    const secs = (id) => this.U.byId[id].sec.toFixed(1);
    for (let tries = 0; offers.length < 5 && tries < 40; tries++) {
      let r = Math.random() * Object.values(TEMPLATES).reduce((a, t) => a + t.w, 0), type = 'kill';
      for (const [k, t] of Object.entries(TEMPLATES)) if ((r -= t.w) <= 0) { type = k; break; }
      if (used.has(type) && Math.random() < 0.7) continue;
      const T = TEMPLATES[type];
      const id = uid(), base = { id, type, from: stationId };
      let o = null;
      if (type === 'courier') {
        const dests = Object.values(this.U.celestials).filter(c => c.kind === 'station' && c.id !== stationId && near.some(n => n.id === c.sys && n.j <= 5));
        if (!dests.length) continue;
        const d = pick(dests), j = near.find(n => n.id === d.sys).j;
        o = { ...base, dest: d.id, sys: d.sys, reward: Math.round((6000 + j * 9000) * incomeOf(d.sys)),
          title: `Доставка: ${names(d.sys)}`, text: `Доставьте опечатанный контейнер (5 м³) на станцию «${d.name}» (${j} прыжк.).`, goal: `Станция «${d.name}»` };
      } else if (type === 'mine') {
        const ores = oresForSec(this.U.byId[sysId].sec);
        const ore = ores[ores.length - 1][0], qty = Math.round(rnd(3, 12)) * 100;
        o = { ...base, ore, qty, sys: sysId, dest: stationId, reward: Math.round(qty * ITEMS[ore].base * 1.8 * incomeOf(sysId) + 4000),
          title: `Добыча: ${ITEMS[ore].name}`, text: `Доставьте на эту станцию ${fmt(qty)} ед. руды «${ITEMS[ore].name}». Её можно добыть в поясах астероидов поблизости.`, goal: `${fmt(qty)} ед. «${ITEMS[ore].name}» на «${this.U.celestials[stationId].name}»` };
      } else {
        const cand = near.filter(n => T.ok(n.sec, n.j));
        if (!cand.length) continue;
        const t = pick(cand), inc = incomeOf(t.id), jm = 1 + 0.25 * t.j;
        if (type === 'kill') {
          const count = 2 + Math.floor(Math.random() * 4);
          o = { ...base, sys: t.id, count, progress: 0, reward: Math.round(count * 9000 * inc * jm),
            title: `Перехват: ${names(t.id)}`, text: `Уничтожьте ${count} пиратских кораблей в системе ${names(t.id)} (${secs(t.id)}).`, goal: `Пиратов: 0 / ${count}` };
        } else if (type === 'recon') {
          o = { ...base, sys: t.id, secs: 15, reward: Math.round((15000 + 9000 * t.j) * inc),
            title: `Разведка: ${names(t.id)}`, text: `Пролетите к точке разведки в системе ${names(t.id)} (${secs(t.id)}) и снимите показания сенсоров (15 с ближе 15 км).`, goal: 'Точка разведки' };
        } else if (type === 'rescue') {
          o = { ...base, sys: t.id, dest: stationId, reward: Math.round((25000 + 12000 * t.j) * inc),
            title: `Спасение: ${names(t.id)}`, text: `В системе ${names(t.id)} (${secs(t.id)}) дрейфует спасательная капсула. Подберите её и привезите пилота на эту станцию.` + (t.sec < 0.7 ? ' Рядом замечены пираты.' : ''), goal: 'Спасательная капсула' };
        } else if (type === 'defend') {
          o = { ...base, sys: t.id, reward: Math.round((40000 + 15000 * t.j) * inc * (t.sec < 0.5 ? 1.5 : 1)),
            title: `Оборона: ${names(t.id)}`, text: `Рудовоз в системе ${names(t.id)} (${secs(t.id)}) под угрозой налёта. Защитите его от двух волн пиратов.`, goal: 'Атакованный рудовоз' };
        } else if (type === 'escort') {
          o = { ...base, sys: t.id, reward: Math.round((45000 + 15000 * t.j) * inc * (t.sec < 0.5 ? 1.5 : 1)),
            title: `Сопровождение: ${names(t.id)}`, text: `Проведите повреждённый транспорт в системе ${names(t.id)} (${secs(t.id)}) 30 км до точки прыжка. Пираты попытаются его перехватить.`, goal: 'Транспорт' };
        } else if (type === 'anomaly') {
          o = { ...base, sys: t.id, reward: Math.round((30000 + 10000 * t.j) * inc),
            title: `Исследование: ${names(t.id)}`, text: `Найдите сканером любую аномалию в системе ${names(t.id)} (${secs(t.id)}) и долетите до неё.`, goal: 'Любая аномалия (сканер — V)' };
        }
      }
      if (!o) continue;
      used.add(type);
      o.typeName = { kill: 'Перехват', courier: 'Доставка', mine: 'Добыча', recon: 'Разведка', rescue: 'Спасение', defend: 'Оборона', escort: 'Сопровождение', anomaly: 'Исследование' }[type];
      offers.push(o);
    }
    b = { offers, until: this.now + 15 * 60000 };
    this.missionBoards[stationId] = b;
    return b;
  };

  // награда строго один раз: повторный вызов для того же задания ничего не даёт
  P.completeMission = function (p, ms, s) {
    if (!p.missions.includes(ms)) return;
    this.clearCSite(p, ms);
    return baseCompleteMission.call(this, p, ms, s);
  };
  P.c_abandonMission = function (s, m, p) {
    const ms = p.missions.find(x => x.id === m.id);
    if (ms) this.clearCSite(p, ms);
    return baseAbandon.call(this, s, m, p);
  };
  // сдача добычи и спасённых пилотов при стыковке
  P.checkCourier = function (s) {
    baseCheckCourier.call(this, s);
    const p = s.player, h = () => this.hangar(p, s.docked);
    for (const ms of [...p.missions]) {
      if (ms.dest !== s.docked) continue;
      if (ms.type === 'mine') {
        const have = (p.ship.cargo[ms.ore] || 0) + (h().items[ms.ore] || 0);
        if (have < ms.qty) { if (have > 0) this.notify(s, `Добыча: нужно ${fmt(ms.qty)} ед. «${ITEMS[ms.ore].name}», у вас ${fmt(have)}`, 'warn'); continue; }
        let need = ms.qty;
        const fromCargo = Math.min(need, p.ship.cargo[ms.ore] || 0);
        p.ship.cargo[ms.ore] -= fromCargo; need -= fromCargo; if (!p.ship.cargo[ms.ore]) delete p.ship.cargo[ms.ore];
        if (need) { h().items[ms.ore] -= need; if (!h().items[ms.ore]) delete h().items[ms.ore]; }
        this.completeMission(p, ms, s);
      } else if (ms.type === 'rescue') {
        if (p.ship.cargo.q_pod > 0) { if (!--p.ship.cargo.q_pod) delete p.ship.cargo.q_pod; this.completeMission(p, ms, s); }
      }
    }
  };
  // исследование аномалии: засчитывается, когда игрок долетает до любой аномалии в нужной системе
  P.contractAnomalyVisited = function (s, a) {
    const p = s.player;
    for (const ms of [...p.missions]) if (ms.type === 'anomaly' && ms.sys === a.sys) this.completeMission(p, ms, s);
  };

  // ---------- точки контрактов ----------
  P.cSiteOf = function (p, ms) { return this.anoms ? [...this.anoms.values()].find(a => a.owner === p.name && a.contract === ms.id) : null; };
  P.clearCSite = function (p, ms) {
    const a = this.cSiteOf(p, ms);
    if (!a) return;
    this.anoms.delete(a.id);
    for (const e of [...this.ents.values()]) if (e.storySite === a.id) this.removeEntity(e);
    for (const s of this.sessions) if (s.player === p) this.sendAnoms(s);
  };
  P.ensureCSite = function (s, p, ms) {
    let a = this.cSiteOf(p, ms);
    if (a) return a;
    if (!this.anoms) this.anoms = new Map();
    const ang = Math.random() * Math.PI * 2, r = (1 + Math.random() * 5) * AU;
    a = { id: 'an_ct_' + uid(), sys: ms.sys, kind: 'contract', owner: p.name, contract: ms.id, name: ms.goal, radius: 0, landing: 8000,
      pos: [Math.cos(ang) * r, (Math.random() - 0.5) * 0.04 * r, Math.sin(ang) * r], sig: 1, created: this.now, expires: Infinity, triggered: false, npcs: new Set() };
    this.anoms.set(a.id, a);
    (p.known || (p.known = {}))[a.id] = true;
    this.sendAnoms(s);
    return a;
  };

  P.contractTick = function () {
    for (const s of this.sessions) {
      const p = s.player;
      for (const ms of [...p.missions]) {
        if (!SITE_TYPES.has(ms.type)) continue;
        if (ms.type === 'rescue' && (p.ship.cargo.q_pod || 0) > 0) continue; // капсула уже на борту — везите на станцию
        const a = this.ensureCSite(s, p, ms), e = s.ent;
        if (!e || e.warp || e.sys !== a.sys) continue;
        const d = dist(e.pos, a.pos);
        if (ms.type === 'recon') {
          if (d > 15000) continue;
          ms.prog = (ms.prog || 0) + 1;
          if (ms.prog === 1 || ms.prog % 5 === 0) this.notify(s, `Разведка: ${Math.min(100, Math.round(ms.prog / ms.secs * 100))}%`);
          if (ms.prog >= ms.secs) this.completeMission(p, ms, s);
        } else if (ms.type === 'rescue') {
          if (d > 150000 || this.ents.has(a.lootId)) continue;
          const w = { id: 'wr_' + uid(), type: 'wreck', sys: a.sys, pos: add(a.pos, [rnd(-3000, 3000), rnd(-500, 500), rnd(-3000, 3000)]), vel: [0, 0, 0],
            radius: 40, name: 'Спасательная капсула', items: { q_pod: 1 }, expires: this.now + 3600000, anom: a.id, storySite: a.id };
          this.ents.set(w.id, w); a.lootId = w.id;
          if (this.U.byId[a.sys].sec < 0.7 && !a.triggered) { a.triggered = true; this.spawnStoryNpc(a, 'raider'); this.spawnStoryNpc(a, 'raider'); }
          this.notify(s, 'Капсула на сканере. Подлетите и подберите её (как обломки).', 'info');
        } else this.runDefense(s, p, ms, a, d, ms.type === 'escort');
      }
    }
  };

  // Оборона и сопровождение: транспорт + две волны пиратов, которые идут на него
  P.runDefense = function (s, p, ms, a, d, moving) {
    if (!a.triggered) {
      if (d > 120000) return;
      a.triggered = true; a.wave = 0; a.nextWave = this.now + (moving ? 12000 : 8000);
      const t = this.spawnCiv(a.sys, { role: 'trader', shipType: moving ? 'tyagach' : 'burlak', name: moving ? 'Транспорт «Вега»' : 'Рудовоз «Каменка»' });
      t.pos = a.pos.slice(); t.vel = [0, 0, 0]; t.storyHold = true; t.storySite = a.id; t.cmd = { type: 'stop' };
      if (moving) { const ang = Math.random() * Math.PI * 2; t.escortDir = [Math.cos(ang), 0, Math.sin(ang)]; t.speedFrac = 0.35; t.start = t.pos.slice(); }
      a.allyId = t.id; a.waves = moving ? [['raider', 'raider'], ['raider', 'raider', 'raider']] : [['raider', 'raider'], ['raider', 'raider', this.U.byId[a.sys].sec < 0.4 ? 'reaper' : 'raider']];
      this.notify(s, moving ? 'Транспорт «Вега»: «Двигатель на четверти мощности. Ведите нас к точке прыжка!»' : 'Рудовоз «Каменка»: «Пираты на подходе! Прикройте!»', 'warn');
      return;
    }
    const t = this.ents.get(a.allyId);
    if (!t) {
      for (const id of a.npcs) { const n = this.ents.get(id); if (n) this.removeEntity(n); }
      a.npcs.clear(); a.triggered = false;
      this.notify(s, `Контракт «${ms.title}»: подзащитный уничтожен. Вернитесь к точке, чтобы попробовать снова.`, 'bad');
      return;
    }
    for (const id of [...a.npcs]) if (!this.ents.has(id)) a.npcs.delete(id);
    if (a.wave < a.waves.length && (this.now >= a.nextWave || (!a.npcs.size && this.now >= a.nextWave - 6000))) {
      for (const type of this.diffEnemies(p, a.waves[a.wave])) this.spawnStoryNpc(a, type, t.id);
      a.wave++; a.nextWave = this.now + 40000;
      this.notify(s, `Волна ${a.wave} из ${a.waves.length}!`, 'bad');
    }
    const arrived = !t.escortDir || dist(t.pos, t.start) >= 30000;
    if (t.escortDir && arrived && t.speedFrac) { t.speedFrac = 0; t.escortDir = null; this.notify(s, 'Транспорт у точки прыжка. Добейте пиратов!', 'good'); }
    if (a.wave >= a.waves.length && !a.npcs.size && arrived) {
      this.fxSys(t.sys, t.pos, { k: 'jump', pos: t.pos });
      this.removeEntity(t);
      this.completeMission(p, ms, s);
    }
  };

  // ======================================================================
  // Случайные события мира
  // ======================================================================
  const EVENTS = {
    distress: { w: 3, name: 'Сигнал бедствия' },
    damaged:  { w: 2, name: 'Повреждённый транспорт' },
    cache:    { w: 2, name: 'Тайник контрабандистов' },
    unstable: { w: 1.5, name: 'Нестабильная аномалия' },
    raid:     { w: 1.5, name: 'Налёт пиратов' }
  };
  const EVENT_BUDGET = 6; // одновременно активных событий во всей галактике

  P.eventsTick = function () {
    if (!this.anoms) return;
    for (const a of [...this.anoms.values()]) if (a.event) this.eventStep(a);
    if (this._evCheck && this.now - this._evCheck < 30000) return;
    this._evCheck = this.now;
    const active = [...this.anoms.values()].filter(a => a.event);
    if (active.length >= EVENT_BUDGET) return;
    // события чаще там, где есть игроки
    const occupied = [...new Set([...this.sessions].filter(s => s.ent).map(s => s.ent.sys))];
    if (!occupied.length || Math.random() > 0.55) return;
    const sysId = pick(occupied);
    if (active.some(a => a.sys === sysId)) return;
    let r = Math.random() * Object.values(EVENTS).reduce((x, e) => x + e.w, 0), kind = 'distress';
    for (const [k, e] of Object.entries(EVENTS)) if ((r -= e.w) <= 0) { kind = k; break; }
    this.startEvent(sysId, kind);
  };

  P.startEvent = function (sysId, kind) {
    const sys = this.U.systems[sysId], sec = sys.def.sec;
    if (kind === 'raid' && !sys.belts.length) kind = 'distress';
    const anchor = kind === 'raid' ? pick(sys.belts).pos : null;
    const ang = Math.random() * Math.PI * 2, r = (0.8 + Math.random() * 4) * AU;
    const pos = anchor ? add(anchor, [rnd(-15000, 15000), 0, rnd(-15000, 15000)]) : [Math.cos(ang) * r, (Math.random() - 0.5) * 0.04 * r, Math.sin(ang) * r];
    const a = { id: 'an_ev_' + uid(), sys: sysId, kind: 'event', public: true, event: { kind, stage: 0 }, name: EVENTS[kind].name, radius: 0, landing: 8000,
      pos, sig: 1, created: this.now, expires: this.now + 20 * 60000, triggered: false, npcs: new Set() };
    this.anoms.set(a.id, a);
    const inc = incomeOf(sysId);
    const ev = a.event;
    if (kind === 'distress') {
      const t = this.spawnCiv(sysId, { role: 'trader', shipType: pick(['tyagach', 'burlak', 'staratel']), name: pick(['Шлюп «Искатель»', 'Баржа «Дельта»', 'Рудовоз «Орлан»']) });
      t.pos = pos.slice(); t.vel = [0, 0, 0]; t.storyHold = true; t.storySite = a.id;
      t.shield *= 0.4; ev.allyId = t.id;
      const n = sec >= 0.5 ? 2 : 3;
      for (let i = 0; i < n; i++) this.spawnStoryNpc(a, i === 2 && sec < 0.3 ? 'reaper' : 'raider', t.id);
      ev.reward = Math.round(25000 * inc);
    } else if (kind === 'damaged') {
      const t = this.spawnCiv(sysId, { role: 'trader', shipType: pick(['tyagach', 'kit']), name: pick(['Транспорт «Сирин»', 'Грузовоз «Тайга»', 'Танкер «Полоз»']) });
      t.pos = pos.slice(); t.vel = [0, 0, 0]; t.storyHold = true; t.storySite = a.id; t.hull *= 0.35; t.armor = 0; t.shield = 0;
      ev.allyId = t.id; ev.reward = Math.round(18000 * inc); ev.prog = {};
    } else if (kind === 'cache') {
      const items = { salv_scrap: 3 + Math.floor(Math.random() * 6), salv_core: 1 + Math.floor(Math.random() * 3) };
      items[pick(['laser_m', 'rail_l', 'shield_booster_l', 'dmg_amp', 'drone_heavy', 'mining_upg', 'overdrive', 'cargo_exp'])] = 1;
      if (Math.random() < (sec < 0.5 ? 0.35 : 0.12)) items[pick(['laser_x', 'rail_x', 'miner_x', 'shield_x', 'dmg_x'])] = 1;
      if (Math.random() < 0.4) items[pick(['cb_implants', 'cb_spice', 'cb_artifact'])] = 1 + Math.floor(Math.random() * 3);
      const w = { id: 'wr_' + uid(), type: 'wreck', sys: sysId, pos: pos.slice(), vel: [0, 0, 0], radius: 90, name: 'Тайник контрабандистов', items, expires: a.expires, anom: a.id, storySite: a.id };
      this.ents.set(w.id, w); ev.lootId = w.id;
      if (sec < 0.6) { this.spawnStoryNpc(a, 'raider'); if (sec < 0.3) this.spawnStoryNpc(a, 'reaper'); }
    } else if (kind === 'unstable') {
      a.expires = this.now + 9 * 60000; ev.collapse = a.expires - 5000;
      const ores = oresForSec(sec - 0.4).slice(-2);
      const beltLike = { id: a.id, sys: sysId, pos, ores: ores.map(([o]) => [o, 1 / ores.length]) };
      const r2 = rng(a.id);
      for (let i = 0; i < 10; i++) { const ast = makeAsteroid(beltLike, r2, i); ast.anom = a.id; ast.storySite = a.id; this.ents.set(ast.id, ast); }
    } else if (kind === 'raid') {
      a.expires = this.now + 12 * 60000;
      const n = sec >= 0.5 ? 3 : 4;
      for (let i = 0; i < n; i++) { const e = this.spawnStoryNpc(a, i === 3 ? 'reaper' : 'raider'); e.bountyMul = 1.5; }
    }
    this.fxSys(sysId, pos, { k: 'jump', pos });
    for (const s of this.sessions) {
      if (this.playerSys(s.player) !== sysId) continue;
      s.send({ t: 'chat', ch: 'local', from: 'Аварийный канал', text: {
        distress: `SOS! Нас атакуют пираты! Координаты переданы в обзор: «${a.name}».`,
        damaged: 'Говорит повреждённый транспорт. Двигатели мертвы, нужен ремонт — подлетите ближе 3 км.',
        cache: 'Перехвачена переписка контрабандистов: где-то в системе спрятан тайник. Метка — в обзоре.',
        unstable: 'ВНИМАНИЕ: нестабильная аномалия. Богатая руда, но через 9 минут она схлопнется — не оставайтесь рядом!',
        raid: 'Пиратский налёт на пояс астероидов! Награда за головы налётчиков ×1.5.' }[kind] });
      this.sendAnoms(s);
    }
  };

  P.eventStep = function (a) {
    const ev = a.event;
    const nearby = () => [...this.sessions].filter(s => s.ent && !s.ent.warp && s.ent.sys === a.sys && dist(s.ent.pos, a.pos) < 150000);
    const finish = (text, good) => {
      for (const s of this.sessions) if (this.playerSys(s.player) === a.sys) this.notify(s, `${a.name}: ${text}`, good ? 'good' : 'warn');
      a.expires = Math.min(a.expires, this.now + 60000); a.event = null; a.done = true;
      this.broadcastAnoms(a.sys);
    };
    for (const id of [...a.npcs]) if (!this.ents.has(id)) a.npcs.delete(id);
    if (ev.kind === 'distress') {
      const t = this.ents.get(ev.allyId);
      if (!t) return finish('сигнал оборвался — корабль уничтожен.', false);
      if (!a.npcs.size) {
        const helpers = nearby();
        for (const s of helpers) { s.player.credits += ev.reward; this.addRep(s.player, factionOfSys(a.sys), 3, s); this.notify(s, `Спасибо, пилот! Награда за спасение: ${fmt(ev.reward)} CR`, 'good'); this.sendProfile(s); }
        t.storyHold = false; t.goal = null;
        finish(helpers.length ? 'корабль спасён.' : 'пираты ушли.', true);
      }
    } else if (ev.kind === 'damaged') {
      const t = this.ents.get(ev.allyId);
      if (!t) return finish('транспорт потерян.', false);
      for (const s of nearby()) {
        if (dist(s.ent.pos, t.pos) - t.radius > 3000) continue;
        const k = s.player.name;
        ev.prog[k] = (ev.prog[k] || 0) + 0.1; // eventStep вызывается каждый тик (10 Гц)
        if (Math.floor(ev.prog[k] * 10) % 30 === 1) this.notify(s, `Ремонт транспорта: ${Math.min(100, Math.round(ev.prog[k] / 12 * 100))}%`);
        if (ev.prog[k] >= 12) {
          s.player.credits += ev.reward;
          const h = this.hangar(s.player, s.player.home), gift = pick(['shield_booster', 'armor_rep', 'afterburner', 'mining_upg', 'drone_light']);
          h.items[gift] = (h.items[gift] || 0) + 1;
          this.addRep(s.player, factionOfSys(a.sys), 3, s);
          this.notify(s, `Транспорт отремонтирован! ${fmt(ev.reward)} CR и «${ITEMS[gift].name}» (в ангаре домашней станции)`, 'good');
          this.sendProfile(s);
          t.storyHold = false; t.hull = t.stats.hull * 0.6;
          return finish('транспорт снова на ходу.', true);
        }
      }
    } else if (ev.kind === 'cache') {
      const w = this.ents.get(ev.lootId);
      if (!w || !Object.keys(w.items).length) return finish('тайник опустошён.', true);
    } else if (ev.kind === 'unstable') {
      const left = ev.collapse - this.now;
      for (const mark of [120000, 30000]) if (left < mark && !ev['w' + mark]) {
        ev['w' + mark] = true;
        for (const s of nearby()) this.notify(s, `Аномалия схлопнется через ${mark / 1000} с! Уходите дальше 40 км.`, 'bad');
      }
      if (left <= 0) {
        for (const e of [...this.ents.values()]) {
          if (e.sys !== a.sys) continue;
          if (e.storySite === a.id && e.type === 'asteroid') { this.removeEntity(e); continue; }
          if (e.type === 'ship' && !e.warp && dist(e.pos, a.pos) < 40000) this.applyDamage(e, (e.stats.shield + e.stats.armor + e.stats.hull) * 0.45, null);
        }
        this.fxSys(a.sys, a.pos, { k: 'boom', pos: a.pos, size: 8000 });
        return finish('аномалия схлопнулась!', false);
      }
    } else if (ev.kind === 'raid') {
      if (!a.npcs.size) return finish('налёт отбит!', true);
    }
  };
};
