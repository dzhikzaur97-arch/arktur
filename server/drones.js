// Классы дронов и их поведение:
// - цель выбирается автоматически: враг, ближайший к кораблю хозяина (ручной приказ «Атака» важнее);
// - стационарные «Часовой» и «Монолит» стоят там, где выпущены, и бьют далеко;
// - тяжёлые и огромные дроны поглощают часть урона (resist), огромные ещё и восстанавливаются (regen);
// - «Монолит» отвлекает пиратов на себя, «Медик» чинит корабль и других дронов хозяина;
// - шахтёрские дроны сами берут астероид, ближайший к кораблю.
'use strict';
const { DRONES, ITEMS, SHIPS } = require('./data');

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rnd = (a, b) => a + Math.random() * (b - a);

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSpawn = P.spawnDrone, baseApplyDamage = P.applyDamage, baseEngage = P.c_droneEngage;

  P.spawnDrone = function (owner, sess, item) {
    const d = baseSpawn.call(this, owner, sess, item);
    const def = DRONES[item];
    d.radius = d.stats.radius = def.r || 6;
    d.stats.sig = def.sig || 20;
    d.resist = def.resist || 0;
    if (!def.speed) {
      // стационарный дрон встаёт рядом с кораблём, вне его корпуса
      const a = Math.random() * Math.PI * 2, R = (owner.radius || 50) + (def.r || 10) * 3 + 150;
      d.pos = [owner.pos[0] + Math.cos(a) * R, owner.pos[1] + rnd(-60, 60), owner.pos[2] + Math.sin(a) * R];
      d.vel = [0, 0, 0]; d.cmd = { type: 'stop' };
    }
    return d;
  };

  // броня тяжёлых и огромных дронов поглощает часть урона.
  // «Покров» флагмана (droneShield): урон по дронам рядом с ним принимает щит флагмана — рой не гибнет, пока жив корабль.
  // Остальные дроны при сильных повреждениях сами уходят в отсек (там чинятся), а не дерутся до гибели
  P.applyDamage = function (t, dmg, src) {
    if (t.type !== 'drone') return baseApplyDamage.call(this, t, dmg, src);
    if (!this.ents.has(t.id)) return; // дрон уже в отсеке или уничтожен — запоздалые попадания не считаются
    if (t.resist) dmg *= 1 - t.resist;
    const owner = this.ents.get(t.ownerEnt), cover = owner && (SHIPS[owner.shipType] || {}).droneShield;
    if (cover && owner.sys === t.sys && !owner.warp && dist(owner.pos, t.pos) < 40000) {
      t.lastHitAt = this.now;
      if (src) { t.aggressors.set(src.id, this.now + 60000); t.lastAttacker = src.id; }
      if (!t.coverFx || this.now - t.coverFx > 900) { t.coverFx = this.now; this.fxSys(t.sys, null, { k: 'beam', arc: 1, from: owner.id, to: t.id, color: 0xffe2a0, hit: true, dur: 0.35, cover: 1 }); }
      return this.applyDamage(owner, dmg * cover, src); // полная цепочка урона по кораблю (сложность, повреждения модулей…)
    }
    // «последний шанс»: дрон, который ещё не отступал, не гибнет от одного удара — остаётся на волоске и уходит
    if (owner && t.task !== 'return' && t.hull > t.stats.hull * 0.3 && t.hull - dmg <= 0) dmg = Math.max(0, t.hull - 1);
    const r = baseApplyDamage.call(this, t, dmg, src);
    if (owner && this.ents.has(t.id) && t.hull < t.stats.hull * 0.3 && t.task !== 'return') {
      t.task = 'return'; t.target = null; t.manual = false;
      const near = owner.sys === t.sys && !owner.warp && dist(owner.pos, t.pos) < 5000;
      if (t.session && (!owner.retreatNote || this.now - owner.retreatNote > 4000)) { owner.retreatNote = this.now; this.notify(t.session, `Дрон «${t.name}» тяжело повреждён — ${near ? 'принят в отсек' : 'возвращается в отсек'} на ремонт`, 'warn'); }
      if (near) this.scoopDrone(t); // рядом с кораблём — сразу в отсек (там он восстанавливается)
    }
    return r;
  };

  // ручной приказ закрепляет цель, пока она жива
  P.c_droneEngage = function (s, m, p, e) {
    baseEngage.call(this, s, m, p, e);
    if (e) for (const d of this.myDrones(e)) if (d.target === m.target) d.manual = true;
  };

  P.hpFrac = function (o) {
    if (o.type === 'drone') return o.hull / o.stats.hull;
    return (o.shield + o.armor + o.hull) / ((o.stats.shield + o.stats.armor + o.stats.hull) || 1);
  };

  // Угрозы для хозяина (кэш на 0.7 с): кто бьёт его или его дронов, пираты, нацеленные на него;
  // в агрессивном режиме — ещё и все пираты в 25 км (кроме крепостей и баз — на них нападают по приказу)
  P.droneThreats = function (owner, mode) {
    const c = owner._thr;
    if (c && c.mode === mode && this.now - c.at < 700) return c.list;
    const list = [];
    for (const o of this.ents.values()) {
      if (o.sys !== owner.sys || o === owner || o.warp) continue;
      if (o.type !== 'ship' && o.type !== 'drone' && o.type !== 'turret') continue;
      if (o.guardian || o.dealer || o.civ || o.ownerEnt === owner.id || (o.owner && o.owner === owner.owner)) continue;
      if (o.invulnUntil && o.invulnUntil > this.now) continue;
      if (o.pb && o.pb.state !== 'open') continue; // база под щитом — бить бесполезно
      const d = dist(o.pos, owner.pos);
      if (d > 40000) continue;
      const tgt = o.npcTarget && this.ents.get(o.npcTarget);
      if ((owner.aggressors.get(o.id) || 0) > this.now
        || (o.npc && tgt && (tgt === owner || tgt.ownerEnt === owner.id))
        || (mode === 'aggressive' && o.npc && !o.fortress && !o.pbase && d <= 25000)) list.push(o);
    }
    owner._thr = { at: this.now, mode, list };
    return list;
  };

  P.droneAutoTarget = function (d, owner, def, mode) {
    let best = null, bd = Infinity;
    for (const o of this.droneThreats(owner, mode)) {
      if (!this.ents.has(o.id) || o.sys !== d.sys || o.warp) continue;
      if (!def.speed && this.surfaceDist(d, o) > def.range) continue; // стационарный бьёт только тех, кого достаёт
      const dd = dist(o.pos, owner.pos);
      if (dd < bd) { bd = dd; best = o; }
    }
    return best;
  };

  P.droneTick = function (d) {
    const owner = this.ents.get(d.ownerEnt);
    if (!owner || owner.sys !== d.sys) { this.removeEntity(d); return; }
    const def = DRONES[d.item];
    const dt = Math.min(1, (this.now - (d.lastTick || this.now)) / 1000); d.lastTick = this.now;
    if (def.regen && d.hull < d.stats.hull) d.hull = Math.min(d.stats.hull, d.hull + def.regen * dt);
    if (d.task === 'return') {
      if (!def.speed) d.stats.maxSpeed = 400; // стационарные возвращаются на маневровых двигателях
      d.cmd = { type: 'approach', target: owner.id };
      if (this.surfaceDist(d, owner) < 400) this.scoopDrone(d);
      return;
    }
    const mode = owner.droneMode || (owner.session && owner.session.player.droneMode) || 'defensive';
    let t = d.target && this.ents.get(d.target);
    if (!t || t.sys !== d.sys || (t.type === 'ship' && t.warp) || (t.type === 'asteroid' && t.amount <= 0)) { d.task = 'idle'; d.target = null; d.manual = false; t = null; }

    // автоматический выбор цели раз в секунду
    if (!d.manual && this.now >= (d.nextPick || 0)) {
      d.nextPick = this.now + 1000;
      if (def.kind === 'combat' && mode !== 'passive') {
        // враг, ближайший к кораблю; на нового переключаемся, только если он заметно ближе к кораблю
        const best = this.droneAutoTarget(d, owner, def, mode);
        if (best && best !== t && (!t || d.task !== 'attack' || dist(best.pos, owner.pos) < dist(t.pos, owner.pos) - 1500)) { d.task = 'attack'; d.target = best.id; t = best; }
      } else if (def.kind === 'mining' && mode !== 'passive' && d.task === 'idle') {
        const p = this.db.players[d.owner];
        if (p && owner.stats.cargo - this.cargoUsed(p.ship.cargo) > 50) {
          let best = null, bd = 8000;
          for (const o of this.ents.values()) if (o.type === 'asteroid' && o.sys === d.sys && o.amount > 0) { const dd = this.surfaceDist(owner, o); if (dd < bd) { bd = dd; best = o; } }
          if (best) { d.task = 'mine'; d.target = best.id; t = best; }
        }
      } else if (def.kind === 'repair') {
        // самый повреждённый из корабля и его дронов
        let best = null, bf = 0.97;
        for (const o of [owner, ...this.myDrones(owner)]) {
          if (o === d || dist(o.pos, owner.pos) > 15000) continue;
          const f = this.hpFrac(o);
          if (f < bf) { bf = f; best = o; }
        }
        if (best) { d.task = 'repair'; d.target = best.id; t = best; }
        else if (d.task === 'repair') { d.task = 'idle'; d.target = null; t = null; }
      }
    }

    if (d.task === 'idle' || !t) {
      d.cmd = def.speed ? { type: 'orbit', target: owner.id, range: 500 + (def.r || 6) * 4 } : { type: 'stop' };
      return;
    }
    d.cmd = def.speed ? { type: 'orbit', target: t.id, range: Math.max(300, def.range * 0.5) } : { type: 'stop' };
    if (this.now < d.nextCycle || this.surfaceDist(d, t) > def.range) return;
    d.nextCycle = this.now + def.cycle * 1000;
    if (def.kind === 'combat') {
      const dmg = def.dmg * d.mul * rnd(0.8, 1.2);
      this.fxSys(d.sys, null, { k: 'beam', from: d.id, to: t.id, color: def.color, hit: true, dur: 0.5, dmg: Math.round(dmg) });
      this.applyDamage(t, dmg, d);
    } else if (def.kind === 'repair') {
      let amt = def.rep * d.mul;
      const healed = amt;
      if (t.type === 'drone') t.hull = Math.min(t.stats.hull, t.hull + amt);
      else for (const k of ['shield', 'armor', 'hull']) { const add = Math.min(amt, t.stats[k] - t[k]); if (add > 0) { t[k] += add; amt -= add; } if (amt <= 0) break; }
      this.fxSys(d.sys, null, { k: 'beam', from: d.id, to: t.id, color: def.color, hit: true, dur: 0.9, rep: Math.round(healed) });
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
};
