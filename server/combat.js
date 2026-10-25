// Расширенный бой: ракеты и торпеды (летящие снаряды с боезапасом), ПРО, развёртываемые турели,
// режимы дронов (агрессивный / защитный / пассивный) и уклонение за счёт поперечной скорости.
'use strict';
const crypto = require('crypto');
const { SHIPS, MODULES, DRONES, NPCS, ITEMS } = require('./data');

const uid = () => crypto.randomBytes(6).toString('hex');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const TURRET = { hp: 1800, dmg: 55, range: 24000, cycle: 2.5, life: 15 * 60000, baseMax: 2 };

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSpawnNpc = P.spawnNpc, baseStartCycle = P.startCycle, baseDestroy = P.destroyShip, baseEntView = P.entView;

  const bonus = (e, k) => ((SHIPS[e.shipType] || {}).bonus || {})[k] || 0;
  // враждебны ли две сущности (для ПРО, турелей и дронов)
  P.hostileTo = function (a, b) {
    if (!a || !b || a === b) return false;
    const ownA = a.owner || (a.ownerEnt && (this.ents.get(a.ownerEnt) || {}).owner), ownB = b.owner || (b.ownerEnt && (this.ents.get(b.ownerEnt) || {}).owner);
    if (ownA && ownB) return ownA !== ownB && ((a.aggressors && (a.aggressors.get(b.id) || 0) > this.now) || (b.aggressors && (b.aggressors.get(a.id) || 0) > this.now));
    const pirate = (x) => x.npc && !x.guardian;
    return (pirate(a) && !pirate(b)) || (pirate(b) && !pirate(a)) || (!!a.outlaw !== !!b.outlaw && (a.outlaw || b.outlaw));
  };

  // ---------- пираты получают ракеты, ПРО и рой ----------
  P.spawnNpc = function (type, sysId, pos, opts = {}) {
    const e = baseSpawnNpc.call(this, type, sysId, pos, opts);
    const n = NPCS[type];
    for (const id of n.launchers || []) e.modules.push({ id, active: false, cycleEnd: 0, target: null });
    if (n.pd) e.modules.push({ id: n.pd, active: true, cycleEnd: 0, target: null, npcPd: true });
    if (n.swarm) e.swarmLeft = n.swarm;
    if (type === 'fortress') { e.fortress = true; e.npcSpeedMul = 0; }
    // сила пиратов зависит от безопасности: в Ядре мягче (новичкам есть где учиться), на окраинах — жёстче
    const sec = this.U.byId[sysId].sec;
    e.npcDmgMul *= sec >= 0.8 ? 0.6 : sec >= 0.5 ? 0.8 : sec > 0 ? 1 : 1.2;
    return e;
  };

  // ---------- запуск ракет ----------
  P.startCycle = function (e, mod) {
    const def = MODULES[mod.id];
    if (def.kind === 'launcher' && e.owner && e.session) {
      const p = e.session.player, need = def.salvo || 1;
      if ((p.ship.cargo[def.ammo] || 0) < need) { mod.active = false; this.notify(e.session, `Нет боеприпасов: ${ITEMS[def.ammo].name}. Купите на рынке станции.`, 'warn'); return; }
    }
    baseStartCycle.call(this, e, mod);
    if (def.kind !== 'launcher' || !mod.active || mod.cycleStart !== this.now) return;
    const t = this.ents.get(mod.target);
    if (!t) return;
    const salvo = def.salvo || 1;
    if (e.owner && e.session) {
      const p = e.session.player;
      p.ship.cargo[def.ammo] -= salvo; if (p.ship.cargo[def.ammo] <= 0) delete p.ship.cargo[def.ammo];
      e.heat = (e.heat || 0) + def.dmg * 0.04 * salvo;
    }
    for (let i = 0; i < salvo; i++) this.launchMissile(e, t, def);
  };

  P.launchMissile = function (e, t, def) {
    const speed = def.speed * (1 + bonus(e, 'missileSpeed'));
    const dir = norm(sub(t.pos, e.pos));
    const m = {
      id: 'ms_' + uid(), type: 'missile', name: def.ammo === 'msl_torp' ? 'Торпеда' : 'Ракета', sys: e.sys,
      pos: add(e.pos, add(mul(dir, (e.radius || 50) + 30), [rnd(-40, 40), rnd(-40, 40), rnd(-40, 40)])),
      vel: mul(norm(add(dir, [rnd(-0.3, 0.3), rnd(-0.2, 0.3), rnd(-0.3, 0.3)])), speed * 0.4), heading: dir,
      shooter: e.id, shooterOwner: e.owner || null, target: t.id, speed, explR: def.explR, torp: def.ammo === 'msl_torp',
      dmg: def.dmg * (e.stats.dmgMul || 1) * (e.npcDmgMul || 1) * (1 + bonus(e, 'missile')),
      expires: this.now + (def.range / speed * 1.5 + 2) * 1000, radius: 8, color: def.color
    };
    this.ents.set(m.id, m);
    if (t.session && t.owner) { if (!t.mslWarn || this.now - t.mslWarn > 4000) { t.mslWarn = this.now; this.notify(t.session, `⚠ Ракетная атака: ${e.name}`, 'bad'); } }
  };

  // полёт ракеты: самонаведение, перехват ПРО и дронами, взрыв у цели
  P.missileTick = function (m, dt) {
    const t = this.ents.get(m.target);
    if (!t || t.sys !== m.sys || t.warp || this.now > m.expires) { this.removeEntity(m); return; }
    // перехват: модули ПРО цели и её союзников, дроны в защитном режиме
    for (const o of this.ents.values()) {
      if (o.sys !== m.sys || (o.type !== 'ship' && o.type !== 'turret' && o.type !== 'drone')) continue;
      if (o.type === 'drone') {
        const pdc = DRONES[o.item].pd || 0;
        if (o.ownerEnt !== m.target || !pdc || (this.ents.get(o.ownerEnt) || {}).droneMode === 'passive') continue;
        if (dist(o.pos, m.pos) > 3000 + o.radius || this.now < (o.pdReady || 0)) continue;
        o.pdReady = this.now + (DRONES[o.item].cls === 'light' ? 1500 : 2500);
        if (Math.random() < pdc) return this.interceptMissile(o, m, 'дрон');
        continue;
      }
      if (!(o === t || (o.owner && o.owner === t.owner) || (o.npc && t.npc))) continue;
      for (const mod of o.modules || []) {
        if (!mod) continue;
        const def = MODULES[mod.id];
        if (def.kind !== 'pd' || !(mod.active || mod.npcPd) || this.now < (mod.pdReady || 0)) continue;
        if (dist(o.pos, m.pos) > def.range) continue;
        mod.pdReady = this.now + def.cycle * 1000 / (1 + bonus(o, 'pd')) / (def.shots || 1);
        if (Math.random() < (m.torp ? 0.6 : 0.85)) return this.interceptMissile(o, m, 'ПРО');
      }
    }
    // самонаведение
    const to = sub(t.pos, m.pos), d = len(to);
    const want = mul(norm(to), m.speed);
    m.vel = add(m.vel, mul(sub(want, m.vel), Math.min(1, dt * 4)));
    m.heading = norm(m.vel);
    m.pos = add(m.pos, mul(m.vel, dt));
    if (d <= (t.radius || 30) + m.speed * dt * 1.2) {
      // урон зависит от сигнатуры цели: торпеды плохо бьют по маленьким кораблям
      const sig = (t.stats && t.stats.sig) || 100;
      const dmg = m.dmg * clamp(sig / m.explR, 0.2, 1) * rnd(0.85, 1.15);
      this.fxSys(m.sys, m.pos, { k: 'boom', pos: m.pos, size: m.torp ? 160 : 60 });
      this.fxSys(m.sys, null, { k: 'beam', from: m.id, to: t.id, color: m.color, hit: true, dur: 0.05, dmg: Math.round(dmg) });
      this.removeEntity(m);
      const shooter = this.ents.get(m.shooter);
      this.applyDamage(t, dmg, shooter || null);
    }
  };
  P.interceptMissile = function (o, m, who) {
    this.fxSys(m.sys, null, { k: 'beam', from: o.id, to: m.id, color: 0x9fe8ff, hit: true, dur: 0.25 });
    this.fxSys(m.sys, m.pos, { k: 'boom', pos: m.pos, size: 25 });
    this.removeEntity(m);
    const owner = o.session ? o : o.ownerEnt ? this.ents.get(o.ownerEnt) : null;
    if (owner && owner.session && (!owner.pdNote || this.now - owner.pdNote > 3000)) { owner.pdNote = this.now; this.notify(owner.session, `${who === 'дрон' ? 'Дрон' : 'ПРО'} сбил${who === 'дрон' ? '' : 'а'} ракету`, 'good'); }
  };

  // ---------- выстрел с учётом уклонения ----------
  // поперечная скорость цели относительно стрелка снижает шанс попадания (быстрые корабли «танкуют» скоростью)
  P.fireWeapon = function (e, mod, def) {
    const t = this.ents.get(mod.target);
    if (!t || (t.type !== 'ship' && t.type !== 'drone' && t.type !== 'turret')) { mod.active = false; return; }
    const d = this.surfaceDist(e, t);
    let q = d <= def.optimal ? 1 : Math.pow(0.5, Math.pow((d - def.optimal) / def.falloff, 2));
    const rel = sub(t.vel || [0, 0, 0], e.vel || [0, 0, 0]), los = norm(sub(t.pos, e.pos));
    const trans = len(sub(rel, mul(los, dot(rel, los))));
    const track = def.dmg > 100 ? 0.55 : def.dmg > 60 ? 0.35 : 0.2; // крупные орудия хуже ведут быстрые цели
    q *= clamp(1 - track * trans / (250 + d / 40), 0.35, 1);
    const hit = Math.random() < q;
    const fx = { k: 'beam', from: e.id, to: t.id, color: def.color, hit, dur: Math.min(1.2, def.cycle * 0.5) };
    this.fxSys(e.sys, null, fx);
    if (!hit) return;
    let dmg = def.dmg * (e.stats.dmgMul || 1) * (e.npcDmgMul || 1) * rnd(0.7, 1.3) * (0.5 + 0.5 * Math.min(1, q + 0.3));
    const sigRes = def.dmg > 100 ? 160 : def.dmg > 60 ? 80 : 40;
    dmg *= clamp(((t.stats && t.stats.sig) || 100) / sigRes, 0.25, 1);
    fx.dmg = Math.round(dmg);
    this.applyDamage(t, dmg, e);
  };

  // ---------- развёртываемые турели ----------
  P.turretMax = function (e) { return TURRET.baseMax + bonus(e, 'turrets'); };
  P.c_deployTurret = function (s, m, p, e) {
    if (!e || e.warp) return this.notify(s, 'Турель можно развернуть только в космосе', 'warn');
    if (!(p.ship.cargo.turret_kit > 0)) return this.notify(s, 'Нет турели в трюме — купите «Развёртываемую турель» на рынке', 'warn');
    const mine = [...this.ents.values()].filter(x => x.type === 'turret' && x.owner === p.name);
    if (mine.length >= this.turretMax(e)) return this.notify(s, `Не больше ${this.turretMax(e)} турелей одновременно`, 'warn');
    if (this.U.byId[e.sys].sec >= 1.0) return this.notify(s, 'В столичных системах турели запрещены', 'warn');
    if (!--p.ship.cargo.turret_kit) delete p.ship.cargo.turret_kit;
    const hp = TURRET.hp;
    const t = {
      id: 'tu_' + uid(), type: 'turret', name: `Турель «Страж-Т» (${p.name})`, owner: p.name, ownerEnt: e.id, sys: e.sys,
      pos: add(e.pos, [rnd(-1500, 1500), rnd(-300, 300), rnd(-1500, 1500)]), vel: [0, 0, 0], heading: [1, 0, 0],
      stats: { shield: hp, armor: hp, hull: hp, sig: 90, maxSpeed: 0, align: 1, cap: 1, capRegen: 0, lockRange: TURRET.range },
      shield: hp, armor: hp, hull: hp, cap: 1, radius: 45, aggressors: new Map(), locks: new Set(), locking: new Map(), modules: [],
      dmg: TURRET.dmg * (1 + bonus(e, 'turretDmg')), expires: this.now + TURRET.life, nextShot: 0
    };
    this.ents.set(t.id, t);
    this.fxSys(e.sys, t.pos, { k: 'jump', pos: t.pos });
    this.notify(s, `Турель развёрнута. Будет защищать вас ${TURRET.life / 60000} мин.`, 'good');
    this.sendProfile(s);
  };
  P.c_scoopTurret = function (s, m, p, e) {
    const t = this.ents.get(m.id);
    if (!e || !t || t.type !== 'turret' || t.owner !== p.name) return;
    if (dist(t.pos, e.pos) > 5000) return this.notify(s, 'Подлетите к турели ближе 5 км', 'warn');
    this.removeEntity(t);
    p.ship.cargo.turret_kit = (p.ship.cargo.turret_kit || 0) + 1;
    this.notify(s, 'Турель свёрнута и погружена в трюм', 'good'); this.sendProfile(s);
  };
  P.turretTick = function (t) {
    if (this.now > t.expires) { this.fxSys(t.sys, t.pos, { k: 'boom', pos: t.pos, size: 80 }); this.removeEntity(t); return; }
    if (this.now < t.nextShot) return;
    t.nextShot = this.now + TURRET.cycle * 1000;
    t.shield = Math.min(t.stats.shield, t.shield + 15);
    let best = null, bd = TURRET.range;
    for (const o of this.ents.values()) {
      if (o.sys !== t.sys || (o.type !== 'ship' && o.type !== 'drone') || o.warp) continue;
      const hostile = (o.npc && !o.guardian) || o.outlaw || (o.owner && o.owner !== t.owner && (t.aggressors.get(o.id) || 0) > this.now);
      if (!hostile) continue;
      const d = dist(o.pos, t.pos);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) return;
    const dmg = t.dmg * rnd(0.8, 1.2);
    this.fxSys(t.sys, null, { k: 'beam', from: t.id, to: best.id, color: 0x60d0ff, hit: true, dur: 0.6, dmg: Math.round(dmg) });
    this.applyDamage(best, dmg, t);
  };

  // уничтожение турели или ракеты не проходит через логику кораблей
  P.destroyShip = function (t, killer) {
    if (t.type === 'turret') {
      this.fxSys(t.sys, t.pos, { k: 'boom', pos: t.pos, size: 120 });
      this.removeEntity(t);
      for (const s of this.sessions) if (s.player.name === t.owner) this.notify(s, 'Ваша турель уничтожена', 'bad');
      return;
    }
    if (t.type === 'missile') return this.removeEntity(t);
    return baseDestroy.call(this, t, killer);
  };

  // ---------- режимы дронов ----------
  P.c_droneMode = function (s, m, p, e) {
    if (!e || !['aggressive', 'defensive', 'passive'].includes(m.mode)) return;
    e.droneMode = m.mode; p.droneMode = m.mode;
    this.notify(s, { aggressive: 'Дроны: агрессивный режим — сами атакуют пиратов рядом', defensive: 'Дроны: защитный режим — бьют тех, кто атакует вас, и сбивают ракеты', passive: 'Дроны: пассивный режим — только по приказу' }[m.mode]);
  };
  P.droneTick = function (d) {
    const owner = this.ents.get(d.ownerEnt);
    if (!owner || owner.sys !== d.sys) { this.removeEntity(d); return; }
    if (d.task === 'return') {
      d.cmd = { type: 'approach', target: owner.id };
      if (this.surfaceDist(d, owner) < 400) this.scoopDrone(d);
      return;
    }
    let t = d.target && this.ents.get(d.target);
    if (!t || t.sys !== d.sys || (t.type === 'ship' && t.warp)) { d.task = 'idle'; d.target = null; t = null; }
    const def = DRONES[d.item];
    const mode = owner.droneMode || (owner.session && owner.session.player.droneMode) || 'defensive';
    if (d.task === 'idle' && def.kind === 'combat' && mode !== 'passive') {
      const att = owner.lastAttacker && this.ents.get(owner.lastAttacker);
      if (att && att.sys === d.sys && !att.warp && this.now - (owner.lastHitAt || 0) < 10000 && (att.npc || att.outlaw || (owner.aggressors.get(att.id) || 0) > this.now)) { d.task = 'attack'; d.target = att.id; t = att; }
      else if (mode === 'aggressive') {
        let best = null, bd = 25000;
        for (const o of this.ents.values()) if (o.sys === d.sys && o.type === 'ship' && o.npc && !o.guardian && !o.warp) { const dd = dist(o.pos, owner.pos); if (dd < bd) { bd = dd; best = o; } }
        if (best) { d.task = 'attack'; d.target = best.id; t = best; }
      }
    }
    if (d.task === 'idle') { d.cmd = { type: 'orbit', target: owner.id, range: 500 }; return; }
    d.cmd = { type: 'orbit', target: t.id, range: def.range * 0.5 };
    if (this.now < d.nextCycle || this.surfaceDist(d, t) > def.range) return;
    d.nextCycle = this.now + def.cycle * 1000;
    if (def.kind === 'combat') {
      const dmg = def.dmg * d.mul * rnd(0.8, 1.2);
      this.fxSys(d.sys, null, { k: 'beam', from: d.id, to: t.id, color: def.color, hit: true, dur: 0.5, dmg: Math.round(dmg) });
      this.applyDamage(t, dmg, d);
    } else {
      const p = this.db.players[d.owner];
      const item = ITEMS[t.ore];
      const free = owner.stats.cargo - this.cargoUsed(p.ship.cargo);
      const units = Math.min(Math.floor(def.yield * d.mul / item.vol), t.amount, Math.floor(free / item.vol));
      this.fxSys(d.sys, null, { k: 'mine', from: d.id, to: t.id, color: def.color, dur: def.cycle });
      if (units <= 0) { d.task = 'return'; if (d.session) this.notify(d.session, 'Трюм полон — дроны возвращаются', 'warn'); return; }
      p.ship.cargo[t.ore] = (p.ship.cargo[t.ore] || 0) + units;
      p.stats.mined += units;
      t.amount -= units;
      if (d.session) this.sendProfile(d.session);
      if (t.amount <= 0) this.depleteAsteroid(t);
    }
  };

  // ---------- вид для клиента ----------
  P.entView = function (o, viewer) {
    if (o.type === 'missile') {
      const v = { id: o.id, k: 'm', n: o.name, p: o.pos.map(x => Math.round(x)), v: o.vel.map(x => Math.round(x)), h: o.heading.map(x => +x.toFixed(3)), c: o.color, tp: o.torp ? 1 : 0 };
      if (viewer && o.target === viewer.id) v.tg = 1;
      return v;
    }
    if (o.type === 'turret') {
      const v = { id: o.id, k: 't', n: o.name, p: o.pos.map(x => Math.round(x)), r: o.radius, o: o.owner,
        sh: +(o.shield / o.stats.shield).toFixed(3), ar: +(o.armor / o.stats.armor).toFixed(3), hu: +(o.hull / o.stats.hull).toFixed(3), exp: o.expires };
      return v;
    }
    return baseEntView.call(this, o, viewer);
  };
};
module.exports.TURRET = TURRET;
