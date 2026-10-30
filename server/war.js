// Война фракций за системы.
// Владелец системы — фракция; на границах (системы, соседние по вратам с чужими) идёт борьба за влияние.
// Влияние растёт само (фоновые стычки), от побед патрулей и от дел пилотов, вступивших в войну.
// Когда влияние нападающих заметно перевешивает — система переходит к ним: меняются станции (скидки,
// фракционные корабли в продаже), граница сдвигается. Пилот вступает в войну на станции фракции:
// получает задания за сторону (удар, снабжение, патруль), знаки отличия и доступ к лавке трофеев —
// фракционные корабли и редкие чертежи; самые редкие продаются только на захваченных станциях.
'use strict';
const crypto = require('crypto');
const D = require('./data');
const { SYSTEMS, GATES, SHIPS, ITEMS, BLUEPRINTS, FACTION_INFO, incomeOf } = D;
const story = require('./story');

const uid = () => crypto.randomBytes(6).toString('hex');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const FACS = Object.keys(FACTION_INFO);
const NEIGH = {};
for (const [a, b] of GATES) { (NEIGH[a] = NEIGH[a] || []).push(b); (NEIGH[b] = NEIGH[b] || []).push(a); }
// столицы не сдаются никогда — фракция не может исчезнуть с карты
const CAPITAL = { cons: 'arktur', liga: 'mirra', orden: 'sing' };
const WAR = {
  driftEvery: 60000, flipMargin: 25, flipMin: 60, minSystems: 3,
  ships: { cons: ['argus', 'argus', 'strazh', 'molot'], liga: ['taran', 'pastuh', 'klinok', 'vihr'], orden: ['prizma', 'prizma', 'orakul', 'strizh'] },
  flagship: { cons: 'senator', liga: 'taran', orden: 'relikvariy' },
  patrolName: { cons: ['Патруль', 'Страж Ядра', 'Конвой'], liga: ['Ополченец', 'Рейнджер', 'Вольный'], orden: ['Хранитель', 'Искатель', 'Послушник'] },
  medalShip: (tier) => 8 + tier * 6, medalRareBp: 30
};

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick, baseCivTick = P.civTick, baseDestroy = P.destroyShip, baseLogin = P.login;

  // ---------- состояние ----------
  P.warState = function () {
    if (!this.db.war) this.db.war = { owner: {}, inf: {} };
    const w = this.db.war;
    for (const s of SYSTEMS) if (!w.owner[s.id]) w.owner[s.id] = story.homeFactionOfSys(s.id);
    story.setWarOwner(w.owner);
    return w;
  };
  // нападающие на систему — владельцы соседних систем другой фракции
  P.warAttackers = function (sysId) {
    const w = this.warState(), own = w.owner[sysId], out = new Set();
    for (const n of NEIGH[sysId] || []) if (w.owner[n] !== own) out.add(w.owner[n]);
    return [...out];
  };
  P.warFront = function () { return SYSTEMS.map(s => s.id).filter(id => this.warAttackers(id).length); };
  P.warInf = function (sysId) {
    const w = this.warState(), own = w.owner[sysId];
    const inf = w.inf[sysId] || (w.inf[sysId] = {});
    if (inf[own] == null) inf[own] = 60;
    for (const f of this.warAttackers(sysId)) if (inf[f] == null) inf[f] = 20;
    return inf;
  };
  P.warSysCount = function (fac) { const w = this.warState(); return SYSTEMS.filter(s => w.owner[s.id] === fac).length; };

  // изменение влияния фракции в системе; возвращает true, если система перешла к ней
  P.warPush = function (sysId, fac, v) {
    if (!this.warAttackers(sysId).length) return false;
    const w = this.warState(), inf = this.warInf(sysId), own = w.owner[sysId];
    if (fac !== own && !this.warAttackers(sysId).includes(fac)) return false;
    inf[fac] = clamp((inf[fac] || 0) + v, 0, 100);
    this._warDirty = true;
    if (fac === own || inf[fac] < WAR.flipMin || inf[fac] < (inf[own] || 0) + WAR.flipMargin) return false;
    if (CAPITAL[own] === sysId || this.warSysCount(own) <= WAR.minSystems) { inf[fac] = (inf[own] || 0) + WAR.flipMargin - 1; return false; }
    // система переходит
    w.owner[sysId] = fac;
    for (const f of Object.keys(inf)) inf[f] = f === fac ? 55 : Math.min(inf[f], 35);
    const name = (SYSTEMS.find(s => s.id === sysId) || {}).name;
    const msg = `Война фракций: ${FACTION_INFO[fac].name} захватывает систему ${name} у фракции «${FACTION_INFO[own].short}»!`;
    for (const s of this.sessions) s.send({ t: 'chat', ch: 'global', from: '*', text: msg });
    // герои захвата — вступившие пилоты-победители, воевавшие тут последний час
    for (const p of Object.values(this.db.players)) {
      if (!p.war || p.war.fac !== fac || !p.war.contrib || !(this.now - (p.war.contrib[sysId] || 0) < 3600000)) continue;
      p.war.medals += 5; p.stats.medals = (p.stats.medals || 0) + 5; p.stats.captures = (p.stats.captures || 0) + 1;
      const s = [...this.sessions].find(x => x.player === p);
      if (s) this.notify(s, `⚔ ${name} взята! Вы сражались за неё — +5 знаков отличия`, 'good');
    }
    // патрули проигравших покидают систему
    for (const e of [...this.ents.values()]) if (e.war === own && e.sys === sysId && Math.random() < 0.6) this.removeEntity(e);
    this.warFrontAnoms();
    this.warBroadcast();
    this.save();
    return true;
  };

  // ---------- метки «Линия фронта» для варпа ----------
  P.warFrontPos = function (sysId) {
    const sys = this.U.systems[sysId];
    const pl = sys.celestials.find(c => c.kind === 'planet') || sys.celestials[0];
    const a = (sysId.length * 1.7) % (Math.PI * 2);
    return add(pl.pos, [Math.cos(a) * ((pl.radius || 0) + 90000), 4000, Math.sin(a) * ((pl.radius || 0) + 90000)]);
  };
  P.warFrontAnoms = function () {
    if (!this.anoms) this.anoms = new Map();
    const front = new Set(this.warFront()), w = this.warState();
    for (const s of SYSTEMS) {
      const id = 'an_front_' + s.id, has = this.anoms.has(id);
      if (front.has(s.id)) {
        const name = `Линия фронта: ${FACTION_INFO[w.owner[s.id]].short} ⚔ ${this.warAttackers(s.id).map(f => FACTION_INFO[f].short).join(', ')}`;
        if (has) { this.anoms.get(id).name = name; continue; }
        this.anoms.set(id, { id, sys: s.id, kind: 'front', public: true, name, radius: 0, landing: 20000, pos: this.warFrontPos(s.id), sig: 1, created: this.now, expires: Infinity, triggered: true, npcs: new Set() });
      } else if (has) this.anoms.delete(id);
    }
    for (const s of SYSTEMS) this.broadcastAnoms(s.id);
  };

  // ---------- что видит клиент ----------
  P.warView = function (p) {
    const w = this.warState(), front = this.warFront();
    const v = { owner: w.owner, home: Object.fromEntries(SYSTEMS.map(s => [s.id, story.homeFactionOfSys(s.id)])), front,
      inf: Object.fromEntries(front.map(id => [id, this.warInf(id)])), capital: CAPITAL, me: null };
    if (p && p.war) { this.warContracts(p); v.me = { fac: p.war.fac, medals: p.war.medals, kills: p.war.kills || 0, contracts: p.war.contracts }; }
    return v;
  };
  P.warBroadcast = function () { for (const s of this.sessions) if (s.player) s.send({ t: 'war', ...this.warView(s.player) }); };
  P.c_warInfo = function (s, m, p) {
    const st = s.docked && this.U.celestials[s.docked];
    s.send({ t: 'war', ...this.warView(p), here: st ? { station: st.id, sys: st.sys, fac: story.factionOfSys(st.sys), home: story.homeFactionOfSys(st.sys) } : null, shop: this.warShop(p, st) });
  };

  // ---------- вступление и выход ----------
  P.c_warJoin = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const fac = story.factionOfSys(this.U.celestials[st].sys);
    if (m.fac !== fac) return this.notify(s, 'Вступить можно только во фракцию, которой принадлежит эта станция', 'warn');
    if (p.war) return this.notify(s, `Вы уже воюете за «${FACTION_INFO[p.war.fac].short}»`, 'warn');
    this.storyOf(p);
    if ((p.rep[fac] || 0) < 0) return this.notify(s, 'Фракция вам не доверяет (репутация ниже нуля)', 'warn');
    p.war = { fac, medals: 0, kills: 0, joined: this.now, contracts: [], contrib: {} };
    this.addRep(p, fac, 5, s);
    this.notify(s, `Вы вступили в войну на стороне фракции «${FACTION_INFO[fac].name}». Патрули противника теперь атакуют вас на границе`, 'good');
    this.c_warInfo(s, m, p); this.sendProfile(s); this.save();
  };
  P.c_warLeave = function (s, m, p) {
    if (!p.war) return;
    const lost = Math.ceil(p.war.medals / 2);
    this.notify(s, `Вы вышли из войны. Сгорело знаков отличия: ${lost}`, 'warn');
    p.war = null;
    this.c_warInfo(s, m, p); this.save();
  };

  // ---------- задания за сторону ----------
  P.warContracts = function (p) {
    const w = p.war;
    const before = (w.contracts || []).length;
    w.contracts = (w.contracts || []).filter(c => !c.done && c.expires > this.now);
    // новые задания взамен выполненных — не чаще одного в 3 минуты
    if (w.contracts.length < before) w.nextGen = Math.max(w.nextGen || 0, this.now + 180000);
    if (w.nextGen && this.now < w.nextGen && w.contracts.length) return w.contracts;
    const front = this.warFront().filter(id => this.warState().owner[id] === w.fac || this.warAttackers(id).includes(w.fac));
    if (!front.length) return w.contracts;
    const kinds = ['strike', 'supply', 'patrol'];
    while (w.contracts.length < 3) {
      if (w.nextGen && this.now < w.nextGen && w.contracts.length) break;
      const used = new Set(w.contracts.map(c => c.type)), type = kinds.find(k => !used.has(k)) || pick(kinds);
      const sys = pick(front), inc = incomeOf(sys), sname = (SYSTEMS.find(x => x.id === sys) || {}).name, mine = this.warState().owner[sys] === w.fac;
      const c = { id: uid(), type, sys, sysName: sname, prog: 0, expires: this.now + 45 * 60000 };
      if (type === 'strike') { c.need = 3 + Math.floor(Math.random() * 3); c.medals = 4; c.isk = Math.round(70000 * inc); c.inf = 8; c.text = `Уничтожьте ${c.need} кораблей противника в системе ${sname}`; }
      else if (type === 'patrol') { c.need = 300; c.medals = 2; c.isk = Math.round(30000 * inc); c.inf = 5; c.text = `Патрулируйте систему ${sname}: ${c.need / 60} мин в космосе`; }
      else {
        // снабжение: везём на станцию своей фракции в системе фронта (или в ближайшую свою)
        const own = mine ? sys : (NEIGH[sys] || []).find(n => this.warState().owner[n] === w.fac) || sys;
        const stn = this.U.systems[own].stations[0];
        if (!stn) continue;
        const item = pick(['mat_steel', 'mat_ceramite', 'energy_cell']), qty = { mat_steel: 40, mat_ceramite: 20, energy_cell: 60 }[item];
        Object.assign(c, { sys: own, sysName: (SYSTEMS.find(x => x.id === own) || {}).name, station: stn.id, stationName: stn.name, item, need: qty, medals: 3,
          isk: Math.round(Math.max(45000, ITEMS[item].base * qty * 1.6) * incomeOf(own)), inf: 6, text: `Доставьте ${ITEMS[item].name} ×${qty} на станцию «${stn.name}»` });
      }
      w.contracts.push(c);
    }
    return w.contracts;
  };
  P.warContractDone = function (p, c) {
    c.done = true;
    p.war.medals += c.medals; p.credits += c.isk; p.stats.medals = (p.stats.medals || 0) + c.medals;
    p.war.contrib[c.sys] = this.now;
    this.warPush(c.sys, p.war.fac, c.inf);
    const s = [...this.sessions].find(x => x.player === p);
    if (s) {
      this.notify(s, `⚔ Задание выполнено: ${c.text}. Награда: ${fmt(c.isk)} ISK и ${c.medals} знака отличия`, 'good');
      this.addRep(p, p.war.fac, 2, s);
      this.sendProfile(s); this.c_warInfo(s, {}, p);
    }
  };
  P.c_warDeliver = function (s, m, p) {
    const st = this.requireDocked(s); if (!st || !p.war) return;
    const c = (p.war.contracts || []).find(x => x.id === m.id && x.type === 'supply' && !x.done);
    if (!c) return;
    if (c.station !== st) return this.notify(s, `Груз ждут на станции «${c.stationName}»`, 'warn');
    const h = this.hangar(p, st), have = (h.items[c.item] || 0) + (p.ship.cargo[c.item] || 0);
    if (have < c.need) return this.notify(s, `Не хватает: ${ITEMS[c.item].name} ${have}/${c.need} (ангар этой станции и трюм)`, 'warn');
    let need = c.need;
    const fromH = Math.min(need, h.items[c.item] || 0); h.items[c.item] -= fromH; need -= fromH; if (!h.items[c.item]) delete h.items[c.item];
    if (need) { p.ship.cargo[c.item] -= need; if (!p.ship.cargo[c.item]) delete p.ship.cargo[c.item]; }
    this.warContractDone(p, c);
    this.save();
  };

  // ---------- лавка за знаки отличия ----------
  // фракционные корабли — чертежи; самые мощные (уровень 4–5) — только на захваченных станциях
  P.warShop = function (p, st) {
    if (!p.war || !st) return [];
    const here = story.factionOfSys(st.sys), captured = here !== story.homeFactionOfSys(st.sys);
    if (here !== p.war.fac) return [];
    const out = [];
    for (const [id, t] of Object.entries(SHIPS)) if (t.fac === p.war.fac && BLUEPRINTS['bp_' + id]) {
      const top = t.tier >= 4;
      out.push({ id: 'bp_' + id, cost: WAR.medalShip(t.tier), captured: top, ok: !top || captured, kind: 'ship' });
    }
    for (const id of D.RARE_BLUEPRINTS) if (BLUEPRINTS[id].kind !== 'ship') out.push({ id, cost: WAR.medalRareBp, captured: false, ok: true, kind: BLUEPRINTS[id].kind });
    return out;
  };
  P.c_warBuy = function (s, m, p) {
    const st = this.requireDocked(s); if (!st || !p.war) return;
    const item = this.warShop(p, this.U.celestials[st]).find(x => x.id === m.id);
    if (!item) return this.notify(s, 'Здесь это не купить — нужна станция вашей фракции', 'warn');
    if (!item.ok) return this.notify(s, 'Этот чертёж выдают только на станциях, захваченных вашей фракцией', 'warn');
    if (p.war.medals < item.cost) return this.notify(s, `Нужно ${item.cost} знаков отличия (у вас ${p.war.medals})`, 'warn');
    p.war.medals -= item.cost;
    const h = this.hangar(p, st); h.items[item.id] = (h.items[item.id] || 0) + 1;
    this.notify(s, `Получен ${ITEMS[item.id].name} — в ангаре станции. Производство — во вкладке «Производство»`, 'good');
    this.sendProfile(s); this.c_warInfo(s, m, p); this.save();
  };

  // ---------- патрули фракций ----------
  P.warSpawnShip = function (sysId, fac) {
    const type = Math.random() < 0.08 ? WAR.flagship[fac] : pick(WAR.ships[fac]);
    const e = this.spawnCiv(sysId, { role: 'hunter', shipType: type, name: `${FACTION_INFO[fac].short}: ${pick(WAR.patrolName[fac])} ${String.fromCharCode(1040 + Math.floor(Math.random() * 28))}-${10 + Math.floor(Math.random() * 90)}` });
    const home = this.warFrontPos(sysId);
    const side = FACS.indexOf(fac) - 1;
    e.pos = add(home, [side * 18000 + rnd(-6000, 6000), rnd(-2000, 2000), rnd(-15000, 15000)]); e.vel = [0, 0, 0];
    e.civ = 'war'; e.war = fac; e.home = home; e.goal = null;
    this.fxSys(sysId, e.pos, { k: 'jump', pos: e.pos });
    return e;
  };
  P.warHostile = function (e, o) {
    if (o === e || o.sys !== e.sys || o.warp || o.type !== 'ship') return false;
    if (o.war) return o.war !== e.war;
    if (o.wingOf) { const op = this.db.players[o.wingOf]; return !!(op && op.war && op.war.fac !== e.war); }
    if (o.owner) { const op = this.db.players[o.owner]; return !!(op && op.war && op.war.fac !== e.war) || (e.aggressors.get(o.id) || 0) > this.now; }
    return o.npc && !o.pbase && (e.aggressors.get(o.id) || 0) > this.now;
  };
  P.warShipTick = function (e) {
    if (this.now < e.nextThink || e.warp) return;
    e.nextThink = this.now + 1000;
    if (e.lastHitAt && this.now - e.lastHitAt < 6000 && e.lastAttacker) e.aggressors.set(e.lastAttacker, this.now + 60000);
    let foe = e.engage && this.ents.get(e.engage);
    if (!foe || !this.warHostile(e, foe) || dist(foe.pos, e.pos) > 120000) {
      foe = null; let bd = 90000;
      for (const o of this.ents.values()) { if (!this.warHostile(e, o)) continue; const d = dist(o.pos, e.pos); if (d < bd) { bd = d; foe = o; } }
      e.engage = foe ? foe.id : null;
    }
    if (!foe) {
      if (dist(e.pos, e.home) > 40000) e.cmd = { type: 'dir', dir: [e.home[0] - e.pos[0], e.home[1] - e.pos[1], e.home[2] - e.pos[2]].map((x, _, a) => x / (Math.hypot(...a) || 1)) };
      else if (e.cmd.type !== 'stop') e.cmd = { type: 'stop' };
      return;
    }
    const fd = this.surfaceDist(e, foe);
    e.cmd = { type: 'orbit', target: foe.id, range: 7000 }; e.speedFrac = fd > 15000 ? 1.6 : 1;
    if (fd < 26000 && this.now >= (e.nextShot || 0)) {
      e.nextShot = this.now + 2500;
      const hit = Math.random() < 0.8, col = { cons: 0xffc860, liga: 0xff8a3d, orden: 0xb080ff }[e.war];
      this.fxSys(e.sys, null, { k: 'beam', from: e.id, to: foe.id, color: col, hit, dur: 0.9 });
      if (hit) this.applyDamage(foe, rnd(0.8, 1.2) * (45 + SHIPS[e.shipType].radius * 0.9), e);
    }
  };
  P.civTick = function (e) {
    if (e.war) return this.warShipTick(e);
    return baseCivTick.call(this, e);
  };

  // гибель патрульного: знаки и влияние победителю
  P.destroyShip = function (t, killer) {
    if (t.war) {
      const sys = t.sys, tier = SHIPS[t.shipType].tier || 1;
      const kname = this.pbaseAttacker(killer), kp = kname && this.db.players[kname];
      if (kp && kp.war && kp.war.fac !== t.war) {
        kp.war.medals += 1; kp.war.kills = (kp.war.kills || 0) + 1; kp.stats.medals = (kp.stats.medals || 0) + 1; kp.war.contrib[sys] = this.now;
        const bounty = Math.round(15000 * tier * incomeOf(sys));
        kp.credits += bounty;
        this.warPush(sys, kp.war.fac, 2);
        const s = [...this.sessions].find(x => x.player === kp);
        if (s) { this.notify(s, `⚔ ${t.name} уничтожен: +1 знак отличия, ${fmt(bounty)} ISK`, 'good'); this.addRep(kp, t.war, -1, null); }
        for (const c of kp.war.contracts || []) if (c.type === 'strike' && !c.done && c.sys === sys && ++c.prog >= c.need) this.warContractDone(kp, c);
        if (s) this.sendProfile(s);
      } else if (killer && killer.war && killer.war !== t.war) this.warPush(sys, killer.war, 1);
    }
    return baseDestroy.call(this, t, killer);
  };

  // ---------- такт войны ----------
  P.warTick = function () {
    const w = this.warState();
    if (!this._warInit) { this._warInit = true; this.warFrontAnoms(); }
    const front = this.warFront();
    // фоновые стычки раз в минуту; у слабой фракции оборона крепче
    if (!w.last || this.now - w.last > WAR.driftEvery) {
      w.last = this.now;
      const avg = SYSTEMS.length / FACS.length;
      for (const id of front) {
        const inf = this.warInf(id), own = w.owner[id];
        inf[own] = clamp(inf[own] + rnd(0, 1) + 0.4 * Math.max(0, (avg - this.warSysCount(own)) / avg), 0, 100);
        for (const f of this.warAttackers(id)) if (this.warPush(id, f, rnd(0, 1))) break;
      }
    }
    // патрули: только там, где есть пилоты в космосе, — чтобы не тратить расчёты на пустые системы
    if (!this._warShips || this.now - this._warShips > 5000) {
      this._warShips = this.now;
      const occupied = new Set();
      for (const s of this.sessions) if (s.ent && !s.docked) occupied.add(s.ent.sys);
      const count = {};
      for (const e of this.ents.values()) if (e.war) {
        if (!occupied.has(e.sys) || !front.includes(e.sys)) { if (!e.emptySince) e.emptySince = this.now; else if (this.now - e.emptySince > 90000) { this.removeEntity(e); continue; } }
        else e.emptySince = 0;
        const k = e.sys + '|' + e.war; count[k] = (count[k] || 0) + 1;
      }
      for (const sys of occupied) {
        if (!front.includes(sys)) continue;
        for (const f of [w.owner[sys], ...this.warAttackers(sys)]) {
          const want = f === w.owner[sys] ? 3 : 2;
          if ((count[sys + '|' + f] || 0) < want && Math.random() < 0.5) this.warSpawnShip(sys, f);
        }
      }
    }
    // патрульные задания: время в космосе в системе задания
    for (const s of this.sessions) {
      const p = s.player;
      if (!p || !p.war || !s.ent || s.docked || s.ent.warp) continue;
      for (const c of p.war.contracts || []) if (c.type === 'patrol' && !c.done && c.sys === s.ent.sys && ++c.prog >= c.need) this.warContractDone(p, c);
    }
    // карта у всех обновляется не чаще раза в 10 с
    if (this._warDirty && (!this._warSent || this.now - this._warSent > 10000)) { this._warDirty = false; this._warSent = this.now; this.warBroadcast(); }
  };
  P.slowTick = function () {
    baseSlow.call(this);
    this.warTick();
  };
  P.login = function (sess, name, pass) {
    baseLogin.call(this, sess, name, pass);
    if (sess.player) sess.send({ t: 'war', ...this.warView(sess.player) });
  };
};
module.exports.WAR = WAR;
module.exports.CAPITAL = CAPITAL;
