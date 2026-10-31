// Напарники: ИИ-пилоты, которых нанимают на станциях (до 4 каждого типа: боец, шахтёр, ремонтник). Летают рядом с кораблём игрока,
// следуют через варп и врата, защищают от нападающих, бьют вашу цель, копают руду в ваш трюм
// или чинят корабль. Растут в уровне от побед. Погибший напарник возвращается через 5 минут.
// Приказы (всем сразу): «следовать», «атаковать мою цель», «копать», «стоять».
// Усиление на станции: тренировка (уровень за CR, до 7), улучшения корабля (броня, орудия, спецмодуль роли — по 3 ступени),
// срочный ремонт погибшего напарника.
'use strict';
const crypto = require('crypto');
const { SHIPS, ITEMS, NPCS } = require('./data');
const { rng } = require('./universe');

const uid = () => crypto.randomBytes(6).toString('hex');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const rnd = (a, b) => a + Math.random() * (b - a);

const WING = {
  max: 12, perRole: 4, reviveMs: 5 * 60000, leash: 150000, // до 4 напарников каждого типа
  roles: {
    combat: { name: 'Боец', ships: ['klinok', 'vihr', 'molot', 'molot', 'citadel'], fee: 60000, desc: 'защищает вас и бьёт вашу цель' },
    miner:  { name: 'Шахтёр', ships: ['burlak', 'staratel', 'staratel', 'leviafan', 'leviafan'], fee: 45000, desc: 'копает руду прямо в ваш трюм' },
    medic:  { name: 'Ремонтник', ships: ['sokol', 'piligrim', 'strazh', 'strazh', 'bastion'], fee: 55000, desc: 'чинит щит и броню вашего корабля' }
  },
  xpNeed: [0, 15, 40, 80, 150, 250, 400],   // побед до уровня 2..7 (6 и 7 — ветеран и ас)
  maxLv: 7,
  // улучшения корабля напарника: 3 ступени каждое; цена ступени = base × ступень²
  ups: {
    arm:  { name: 'Броня и щиты', desc: '+20% прочности за ступень', base: 40000 },
    gun:  { name: 'Орудия', desc: '+20% урона за ступень', base: 50000 },
    spec: { name: 'Спецмодуль', base: 45000, byRole: { combat: 'скорострельность +15% за ступень', miner: 'добыча +25% за ступень', medic: 'ремонт +25% за ступень' } }
  },
  upMax: 3,
  rankName: ['', 'новичок', 'пилот', 'опытный', 'бывалый', 'элита', 'ветеран', 'ас'],
  first: ['Арс', 'Вега', 'Дан', 'Кира', 'Лео', 'Мира', 'Ник', 'Ольга', 'Рэй', 'Тэо', 'Юна', 'Зар', 'Сол', 'Тарас', 'Ева', 'Гор', 'Лана', 'Марк', 'Нора', 'Ян'],
  last: ['Корвин', 'Стрельцов', 'Ноэль', 'Варга', 'Айхен', 'Мерк', 'Ростов', 'Кейн', 'Орлова', 'Тайри', 'Векс', 'Лунд', 'Сато', 'Белых', 'Рейн'],
  orders: { follow: 'Следовать', attack: 'Атаковать мою цель', mine: 'Копать', hold: 'Стоять' }
};
const shipFor = (role, lv) => { const l = WING.roles[role].ships; return l[Math.min(l.length - 1, lv - 1)]; };
const trainFee = (role, lv) => Math.round(WING.roles[role].fee * 0.6 * Math.pow(lv + 1, 1.8)); // цена перехода lv → lv+1
const upFee = (k, r) => WING.ups[k].base * (r + 1) * (r + 1);
const upOf = (w, k) => (w.up && w.up[k]) || 0;
const reviveFee = (w) => Math.round(3000 * w.lv * w.lv);
const levelOf = (xp) => { let lv = 1; for (let i = 1; i < WING.xpNeed.length; i++) if (xp >= WING.xpNeed[i]) lv = i + 1; return lv; };

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick, baseCivTick = P.civTick, baseDestroy = P.destroyShip;

  // кандидаты на станции обновляются раз в час
  P.wingCandidates = function (stationId) {
    const hour = Math.floor(this.now / 3600000), r = rng('wing:' + stationId + ':' + hour);
    const sec = this.U.byId[this.U.celestials[stationId].sys].sec;
    const out = [];
    for (let i = 0; i < 9; i++) { // по три кандидата каждого типа
      const role = ['combat', 'miner', 'medic'][i % 3];
      const lv = Math.max(1, Math.min(3, 1 + Math.floor(r() * 2) + (sec < 0.5 ? 1 : 0)));
      const name = WING.first[Math.floor(r() * WING.first.length)] + ' ' + WING.last[Math.floor(r() * WING.last.length)];
      out.push({ id: stationId + ':' + hour + ':' + i, name, role, lv, ship: shipFor(role, lv), fee: Math.round(WING.roles[role].fee * Math.pow(lv, 1.8)) });
    }
    return out;
  };
  P.wingView = function (p) {
    return (p.wing || []).map(w => {
      const e = w.ent && this.ents.get(w.ent);
      return { id: w.id, name: w.name, role: w.role, roleName: WING.roles[w.role].name, lv: w.lv, xp: w.xp, next: WING.xpNeed[w.lv] || null, ship: w.ship,
        dead: w.deadUntil > this.now ? w.deadUntil - this.now : 0, up: { arm: upOf(w, 'arm'), gun: upOf(w, 'gun'), spec: upOf(w, 'spec') },
        train: w.lv < WING.maxLv ? trainFee(w.role, w.lv) : null, upFee: Object.fromEntries(Object.keys(WING.ups).map(k => [k, upOf(w, k) < WING.upMax ? upFee(k, upOf(w, k)) : null])),
        revive: w.deadUntil > this.now ? reviveFee(w) : null, rank: WING.rankName[w.lv] || '', hp: e ? +((e.shield + e.armor + e.hull) / (e.stats.shield + e.stats.armor + e.stats.hull)).toFixed(2) : null, hold: w.hold || {} };
    });
  };
  P.c_wingInfo = function (s, m, p) {
    s.send({ t: 'wing', list: this.wingView(p), order: p.wingOrder || 'follow', max: WING.max, perRole: WING.perRole, orders: WING.orders, maxLv: WING.maxLv, upMax: WING.upMax,
      ups: Object.fromEntries(Object.entries(WING.ups).map(([k, u]) => [k, { name: u.name, desc: u.desc || '', byRole: u.byRole || null }])),
      roles: Object.fromEntries(Object.entries(WING.roles).map(([k, r]) => [k, { name: r.name, desc: r.desc }])),
      candidates: s.docked ? this.wingCandidates(s.docked).filter(c => !(p.wing || []).some(w => w.cand === c.id)) : [] });
  };
  P.c_wingHire = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const c = this.wingCandidates(st).find(x => x.id === m.id);
    if (!c) return this.notify(s, 'Этот пилот уже ушёл — список обновился', 'warn');
    p.wing = p.wing || [];
    if (p.wing.filter(w => w.role === c.role).length >= WING.perRole) return this.notify(s, `${WING.roles[c.role].name}: больше ${WING.perRole} напарников одного типа не нанять — сначала отпустите кого-нибудь`, 'warn');
    if (p.wing.some(w => w.cand === c.id)) return;
    if (p.credits < c.fee) return this.notify(s, `Недостаточно CR: нужно ${fmt(c.fee)}`, 'warn');
    p.credits -= c.fee;
    p.wing.push({ id: uid(), cand: c.id, name: c.name, role: c.role, lv: c.lv, xp: WING.xpNeed[c.lv - 1] || 0, ship: c.ship, deadUntil: 0, hold: {} });
    this.notify(s, `${WING.roles[c.role].name} ${c.name} теперь летает с вами («${SHIPS[c.ship].name}»). Отстыкуйтесь — напарник вылетит следом`, 'good');
    this.sendProfile(s); this.c_wingInfo(s, m, p); this.save();
  };
  P.c_wingFire = function (s, m, p) {
    const i = (p.wing || []).findIndex(w => w.id === m.id);
    if (i < 0) return;
    const w = p.wing.splice(i, 1)[0], e = w.ent && this.ents.get(w.ent);
    if (e) this.removeEntity(e);
    this.notify(s, `${w.name} покидает команду`, 'info');
    this.c_wingInfo(s, m, p); this.save();
  };
  // ---------- усиление ----------
  const findW = (p, id) => (p.wing || []).find(w => w.id === id);
  const respawn = function (p, w) { // пересобрать корабль в космосе с новыми характеристиками
    const s = [...this.sessions].find(x => x.player === p), old = w.ent && this.ents.get(w.ent);
    if (old && s && s.ent) { this.removeEntity(old); this.wingSpawn(p, w, s.ent, p.wing.indexOf(w)); }
  };
  P.c_wingTrain = function (s, m, p) {
    if (!this.requireDocked(s)) return;
    const w = findW(p, m.id); if (!w) return;
    if (w.lv >= WING.maxLv) return this.notify(s, `${w.name} уже на высшем уровне`, 'warn');
    const fee = trainFee(w.role, w.lv);
    if (p.credits < fee) return this.notify(s, `Недостаточно CR: нужно ${fmt(fee)}`, 'warn');
    p.credits -= fee;
    const oldShip = w.ship;
    w.lv++; w.xp = Math.max(w.xp, WING.xpNeed[w.lv - 1] || 0); w.ship = shipFor(w.role, w.lv);
    this.notify(s, `★ ${w.name} прошёл тренировку: уровень ${w.lv} (${WING.rankName[w.lv]})${w.ship !== oldShip ? ` и пересел на «${SHIPS[w.ship].name}»` : ''}`, 'good');
    this.sendProfile(s); this.c_wingInfo(s, m, p); this.save();
  };
  P.c_wingUpgrade = function (s, m, p) {
    if (!this.requireDocked(s)) return;
    const w = findW(p, m.id), u = WING.ups[m.k]; if (!w || !u) return;
    const r = upOf(w, m.k);
    if (r >= WING.upMax) return this.notify(s, `${u.name}: уже максимальная ступень`, 'warn');
    const fee = upFee(m.k, r);
    if (p.credits < fee) return this.notify(s, `Недостаточно CR: нужно ${fmt(fee)}`, 'warn');
    p.credits -= fee;
    w.up = w.up || {}; w.up[m.k] = r + 1;
    this.notify(s, `${w.name}: «${u.name}» — ступень ${r + 1} из ${WING.upMax}`, 'good');
    this.sendProfile(s); this.c_wingInfo(s, m, p); this.save();
  };
  P.c_wingRevive = function (s, m, p) {
    const w = findW(p, m.id); if (!w || !(w.deadUntil > this.now)) return;
    const fee = reviveFee(w);
    if (p.credits < fee) return this.notify(s, `Недостаточно CR: нужно ${fmt(fee)}`, 'warn');
    p.credits -= fee; w.deadUntil = 1; // на следующем тике вернётся в строй
    this.notify(s, `Срочный ремонт оплачен: ${w.name} вылетает к вам`, 'good');
    this.sendProfile(s); this.c_wingInfo(s, m, p); this.save();
  };
  P.c_wingOrder = function (s, m, p) {
    if (!WING.orders[m.order]) return;
    p.wingOrder = m.order;
    for (const w of p.wing || []) { const e = w.ent && this.ents.get(w.ent); if (e) { e.engage = null; e.nextThink = 0; } }
    if ((p.wing || []).length) this.notify(s, `Напарникам: «${WING.orders[m.order]}»`, 'info');
    this.c_wingInfo(s, m, p);
  };

  // ---------- появление рядом с хозяином ----------
  P.wingSpawn = function (p, w, oe, i) {
    const e = this.spawnCiv(oe.sys, { role: 'hunter', shipType: w.ship, name: `${w.name} · напарник` });
    const a = (i / 3) * Math.PI * 2 + Math.random();
    e.pos = add(oe.pos, [Math.cos(a) * 3000, rnd(-500, 500), Math.sin(a) * 3000]); e.vel = oe.vel.slice();
    e.civ = 'wing'; e.wingOf = p.name; e.wingId = w.id; e.goal = null;
    const k = (1 + 0.15 * (w.lv - 1)) * (1 + 0.2 * upOf(w, 'arm'));
    for (const f of ['shield', 'armor', 'hull']) { e.stats[f] = Math.round(e.stats[f] * k * 1.3); e[f] = e.stats[f]; }
    e.stats.maxSpeed = Math.max(e.stats.maxSpeed, (oe.stats.maxSpeed || 300) * 1.1);
    this.fxSys(oe.sys, e.pos, { k: 'jump', pos: e.pos });
    w.ent = e.id;
    return e;
  };
  P.wingDespawn = function (p, toHangar) {
    for (const w of p.wing || []) {
      const e = w.ent && this.ents.get(w.ent);
      if (e) this.removeEntity(e);
      w.ent = null;
      // руда из трюма напарника — в ангар станции
      if (toHangar && w.hold && Object.keys(w.hold).length) {
        const h = this.hangar(p, toHangar);
        for (const [it, q] of Object.entries(w.hold)) h.items[it] = (h.items[it] || 0) + q;
        w.hold = {};
      }
    }
  };
  P.wingTick = function () {
    const live = new Set();
    for (const s of this.sessions) {
      const p = s.player;
      if (!p || !(p.wing || []).length) continue;
      const oe = s.ent;
      if (!oe || s.docked || oe.landed || s.surface) { this.wingDespawn(p, s.docked); continue; }
      p.wing.forEach((w, i) => {
        if (w.deadUntil > this.now) return;
        if (w.deadUntil) { w.deadUntil = 0; this.notify(s, `${w.name} вернулся из ремонта и снова в строю`, 'good'); this.c_wingInfo(s, {}, p); }
        let e = w.ent && this.ents.get(w.ent);
        if (!e) { if (!oe.warp) e = this.wingSpawn(p, w, oe, i); else return; }
        live.add(e.id);
        // догоняем хозяина: другая система или отстали после варпа — прыжок к нему
        if (!oe.warp && (e.sys !== oe.sys || dist(e.pos, oe.pos) > WING.leash)) {
          if (e.sys !== oe.sys) { this.removeEntity(e); e = this.wingSpawn(p, w, oe, i); live.add(e.id); }
          else { const a = Math.random() * 6.3; e.pos = add(oe.pos, [Math.cos(a) * 3500, 0, Math.sin(a) * 3500]); e.vel = oe.vel.slice(); this.fxSys(oe.sys, e.pos, { k: 'jump', pos: e.pos }); }
        }
      });
    }
    // напарники без хозяина в космосе не остаются
    for (const e of [...this.ents.values()]) if (e.civ === 'wing' && !live.has(e.id)) {
      const p = this.db.players[e.wingOf], w = p && (p.wing || []).find(x => x.id === e.wingId);
      if (w && w.ent === e.id && w.deadUntil <= this.now) continue;
      this.removeEntity(e);
    }
  };

  // ---------- поведение ----------
  P.wingThreat = function (e, oe, p) {
    let best = null, bd = 60000;
    for (const o of this.ents.values()) {
      if (o.sys !== e.sys || o.warp || o.type !== 'ship' || o === oe || o.civ === 'wing') continue;
      const attacker = (oe.aggressors && (oe.aggressors.get(o.id) || 0) > this.now) || o.npcTarget === oe.id || o.engage === oe.id || (e.aggressors.get(o.id) || 0) > this.now;
      const warFoe = o.war && p.war && o.war !== p.war.fac;
      if (!attacker && !warFoe) continue;
      const d = dist(o.pos, oe.pos);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };
  P.wingFight = function (e, foe, w) {
    const fd = this.surfaceDist(e, foe);
    e.cmd = { type: 'orbit', target: foe.id, range: 5000 }; e.speedFrac = fd > 12000 ? 1.6 : 1;
    if (fd < 24000 && this.now >= (e.nextShot || 0)) {
      e.nextShot = this.now + 2400 / (1 + (w.role === 'combat' ? 0.15 * upOf(w, 'spec') : 0));
      const hit = Math.random() < 0.82;
      this.fxSys(e.sys, null, { k: 'beam', from: e.id, to: foe.id, color: 0x60e0ff, hit, dur: 0.8 });
      if (hit) this.applyDamage(foe, rnd(0.85, 1.15) * (25 + SHIPS[e.shipType].radius * 0.5) * (1 + 0.15 * (w.lv - 1)) * (1 + 0.2 * upOf(w, 'gun')), e); // помощник, а не замена игроку
    }
  };
  P.wingShipTick = function (e) {
    if (this.now < e.nextThink || e.warp) return;
    e.nextThink = this.now + 800;
    const p = this.db.players[e.wingOf], w = p && (p.wing || []).find(x => x.id === e.wingId);
    const s = p && [...this.sessions].find(x => x.player === p), oe = s && s.ent;
    if (!w || !oe) return;
    if (e.lastHitAt && this.now - e.lastHitAt < 6000 && e.lastAttacker) e.aggressors.set(e.lastAttacker, this.now + 60000);
    const order = p.wingOrder || 'follow';
    if (order === 'hold') { if (e.cmd.type !== 'stop') e.cmd = { type: 'stop' }; const t = this.wingThreat(e, oe, p); if (t && this.surfaceDist(e, t) < 24000) this.wingFight(e, t, w); return; }
    // ремонтник: чинит хозяина, если тот ранен
    if (w.role === 'medic') {
      const hurt = oe.shield < oe.stats.shield * 0.95 || oe.armor < oe.stats.armor * 0.98;
      if (hurt && this.surfaceDist(e, oe) < 15000 && this.now >= (e.nextRep || 0)) {
        e.nextRep = this.now + 3000;
        const amt = (60 + 25 * w.lv) * (SHIPS[e.shipType].radius > 100 ? 2 : 1) * (1 + 0.25 * upOf(w, 'spec'));
        if (oe.shield < oe.stats.shield) oe.shield = Math.min(oe.stats.shield, oe.shield + amt);
        else oe.armor = Math.min(oe.stats.armor, oe.armor + amt * 0.7);
        this.fxSys(e.sys, null, { k: 'beam', from: e.id, to: oe.id, color: 0x70ffc0, hit: true, dur: 0.9 });
      }
    }
    // цель: при приказе «атака» — захваченная вами цель, иначе — тот, кто нападает на вас
    let foe = null;
    if (order === 'attack') {
      for (const id of oe.locks || []) { const t = this.ents.get(id); if (t && t.type === 'ship' && (t.npc || (t.war && p.war && t.war !== p.war.fac) || (oe.aggressors.get(t.id) || 0) > this.now)) { foe = t; break; } }
    }
    if (!foe && w.role !== 'miner') foe = this.wingThreat(e, oe, p);
    if (!foe && w.role === 'miner' && order !== 'mine') { const t = this.wingThreat(e, oe, p); if (t && this.surfaceDist(e, t) < 15000) foe = t; }
    if (foe) { this.wingFight(e, foe, w); return; }
    // шахтёр: копает ближайший к хозяину астероид
    if (w.role === 'miner' && (order === 'mine' || order === 'follow')) {
      let ast = e.mineAst && this.ents.get(e.mineAst);
      if (!ast || ast.amount <= 0 || dist(ast.pos, oe.pos) > 40000) {
        ast = null; let bd = 40000;
        for (const o of this.ents.values()) if (o.type === 'asteroid' && o.sys === e.sys && o.amount > 0) { const d = dist(o.pos, oe.pos); if (d < bd) { bd = d; ast = o; } }
        e.mineAst = ast ? ast.id : null;
      }
      if (ast) {
        e.cmd = { type: 'orbit', target: ast.id, range: 1500 }; e.speedFrac = 1;
        if (this.surfaceDist(e, ast) < 4000 && this.now >= (e.nextMine || 0)) {
          e.nextMine = this.now + 6000;
          const units = Math.min(ast.amount, Math.round((15 + 12 * w.lv) * (SHIPS[e.shipType].radius > 100 ? 2 : 1) * (1 + 0.25 * upOf(w, 'spec')))); // примерно половина шахтёрского корабля игрока
          const vol = ITEMS[ast.ore].vol, free = oe.stats.cargo - this.cargoUsed(p.ship.cargo), toShip = Math.max(0, Math.min(units, Math.floor(free / vol)));
          if (toShip) p.ship.cargo[ast.ore] = (p.ship.cargo[ast.ore] || 0) + toShip;
          const rest = units - toShip, holdUsed = Object.entries(w.hold || {}).reduce((a, [it, q]) => a + q * ITEMS[it].vol, 0);
          const toHold = Math.max(0, Math.min(rest, Math.floor((3000 - holdUsed) / vol)));
          if (toHold) w.hold[ast.ore] = (w.hold[ast.ore] || 0) + toHold;
          const got = toShip + toHold;
          ast.amount -= got; p.stats.mined += got;
          this.fxSys(e.sys, null, { k: 'beam', from: e.id, to: ast.id, color: 0x80ff90, hit: true, dur: 1.2 });
          if (got && s) { this.notify(s, `${w.name}: +${got} ${ITEMS[ast.ore].name}${toHold ? ' (в трюм напарника)' : ''}`, 'mine'); this.sendProfile(s); }
          if (!got && s && !e.fullWarned) { e.fullWarned = true; this.notify(s, `${w.name}: трюмы полны — пристыкуйтесь, руда напарника выгрузится в ангар`, 'warn'); }
          if (ast.amount <= 0) this.depleteAsteroid(ast);
        }
        return;
      }
    }
    // строй: кружим вокруг хозяина
    const idx = p.wing.indexOf(w);
    if (e.cmd.type !== 'orbit' || e.cmd.target !== oe.id) e.cmd = { type: 'orbit', target: oe.id, range: 2500 + idx * 1200 };
    e.speedFrac = this.surfaceDist(e, oe) > 10000 ? 1.6 : 1;
  };
  P.civTick = function (e) {
    if (e.civ === 'wing') return this.wingShipTick(e);
    return baseCivTick.call(this, e);
  };

  // убийство напарником засчитывается хозяину (награды, задания, война); гибель напарника — ремонт 5 минут
  P.destroyShip = function (t, killer) {
    let k = killer;
    if (killer && killer.wingOf) {
      const p = this.db.players[killer.wingOf], s = p && [...this.sessions].find(x => x.player === p), w = p && (p.wing || []).find(x => x.id === killer.wingId);
      if (w && (t.npc || t.war)) {
        w.xp++; if (p) p.stats.wingKills = (p.stats.wingKills || 0) + 1;
        const lv = levelOf(w.xp);
        if (lv > w.lv) {
          w.lv = lv; w.ship = shipFor(w.role, lv);
          if (s) this.notify(s, `★ ${w.name} получил уровень ${lv}${SHIPS[w.ship].name !== SHIPS[killer.shipType].name ? ` и пересел на «${SHIPS[w.ship].name}»` : ''}`, 'good');
          respawn.call(this, p, w);
          if (s) this.c_wingInfo(s, {}, p);
        }
      }
      if (s && s.ent) k = s.ent;
      // половина награды за победу напарника — ему самому
      if (p && w && (t.npc || t.war)) { const c0 = p.credits; const r = baseDestroy.call(this, t, k); const half = Math.floor((p.credits - c0) / 2); if (half > 0) { p.credits -= half; if (s) s.wingShare = (s.wingShare || 0) + half; } return r; }
    }
    if (t.civ === 'wing') {
      const p = this.db.players[t.wingOf], w = p && (p.wing || []).find(x => x.id === t.wingId);
      if (w) {
        w.deadUntil = this.now + WING.reviveMs; w.ent = null;
        const s = [...this.sessions].find(x => x.player === p);
        if (s) this.notify(s, `✖ Корабль напарника ${w.name} уничтожен! Пилот катапультировался — вернётся через 5 минут`, 'bad');
        if (s) this.c_wingInfo(s, {}, p);
      }
    }
    return baseDestroy.call(this, t, k);
  };

  P.slowTick = function () {
    baseSlow.call(this);
    this.wingTick();
    // раз в минуту — сводка: сколько напарники взяли себе из наград
    if (!this._wingShareAt || this.now - this._wingShareAt > 60000) { this._wingShareAt = this.now; for (const s of this.sessions) if (s.wingShare) { this.notify(s, `Напарники взяли свою долю наград за последние победы: ${fmt(s.wingShare)} CR`, 'info'); s.wingShare = 0; } }
  };
};
module.exports.WING = WING;
module.exports.fees = { trainFee, upFee, reviveFee };
