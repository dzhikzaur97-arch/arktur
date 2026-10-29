// Пиратские базы: по одной в каждой системе. Нападение поднимает щит базы и вызывает пять волн:
// рои дронов Скверны и пиратские корабли разных классов, каждая волна сильнее предыдущей.
// После пятой волны щит падает, базу можно уничтожить. Награда (ISK и тайник) растёт с опасностью сектора.
'use strict';
const crypto = require('crypto');
const { MODULES, NPCS, AU, incomeOf } = require('./data');
const { rng } = require('./universe');

const uid = () => crypto.randomBytes(6).toString('hex');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');

// Уровни баз по безопасности системы: чем опаснее сектор, тем крепче база, злее волны и богаче награда
const PBASE_TIERS = [
  { min: 0.7,  name: 'Пиратский аванпост', danger: 'низкая',      hpMul: 0.06, guns: 2, weapon: 'laser_s', reward: 120000,  budget: 2.5, ships: ['raider', 'hunter', 'corsair'] },
  { min: 0.4,  name: 'Пиратская застава',  danger: 'средняя',     hpMul: 0.12, guns: 3, weapon: 'laser_m', reward: 350000,  budget: 4,   ships: ['raider', 'hunter', 'corsair', 'reaper'] },
  { min: 0.01, name: 'Пиратская база',     danger: 'высокая',     hpMul: 0.25, guns: 4, weapon: 'laser_m', reward: 900000,  budget: 6,   ships: ['hunter', 'corsair', 'reaper', 'warlord'] },
  { min: -0.5, name: 'Пиратская твердыня', danger: 'очень высокая', hpMul: 0.5, guns: 5, weapon: 'rail_l', reward: 2200000, budget: 9,   ships: ['corsair', 'reaper', 'warlord', 'brood'] },
  { min: -9,   name: 'Пиратская цитадель', danger: 'смертельная', hpMul: 1,    guns: 6, weapon: 'rail_l',  reward: 5000000, budget: 13,  ships: ['reaper', 'warlord', 'brood', 'dreadlord'] }
];
const PBASE = { waves: 5, pause: 8000, firstWave: 3000, respawn: 45 * 60000, resetAfter: 120000, growth: 1.5 };
// «цена» класса в бюджете волны
const COST = { raider: 2, hunter: 3, corsair: 3, reaper: 5, warlord: 9, brood: 12, dreadlord: 22 };
const BASE_NAMES = ['Ржавый Зуб', 'Гнилой Причал', 'Чёрная Дыра', 'Жало', 'Нора', 'Кривой Якорь', 'Улей', 'Шрам', 'Последний Приют', 'Волчья Яма'];
// тайник базы по уровню: [предмет, шанс, от, до]
const LOOT = [
  [['salv_scrap', 1, 5, 10], ['salv_core', 1, 1, 2], ['energy_cell', 1, 20, 40], ['drone_light', 0.6, 1, 2], ['drone_scout', 0.5, 1, 3]],
  [['salv_core', 1, 2, 4], ['energy_cell', 1, 40, 80], ['drone_heavy', 0.6, 1, 2], ['drone_medic', 0.4, 1, 1], ['laser_m', 0.4, 1, 1]],
  [['salv_core', 1, 4, 8], ['salv_relic', 0.8, 1, 2], ['drone_goliath', 0.6, 1, 1], ['drone_sentry', 0.5, 1, 2], ['rail_l', 0.3, 1, 1]],
  [['salv_relic', 1, 2, 4], ['drone_sentry', 0.8, 1, 2], ['drone_goliath', 0.6, 1, 2], ['cb_artifact', 0.3, 1, 1], ['elite', 0.5, 1, 1]],
  [['salv_relic', 1, 4, 8], ['drone_monolith', 0.4, 1, 1], ['drone_colossus', 0.15, 1, 1], ['cb_artifact', 0.6, 1, 2], ['elite', 1, 1, 2]]
];
const ELITE = ['laser_x', 'rail_x', 'shield_x', 'dmg_x', 'speed_x', 'drone_x'];

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseApplyDamage = P.applyDamage, baseDestroy = P.destroyShip, baseAiTick = P.aiTick, baseEntView = P.entView;

  P.pbaseTier = function (sysId) { const sec = this.U.byId[sysId].sec; return PBASE_TIERS.findIndex(t => sec >= t.min); };
  P.pbaseReward = function (b) { return Math.round(PBASE_TIERS[b.pb.tier].reward * incomeOf(b.sys)); };

  // ---------- появление баз ----------
  P.pbaseUpkeep = function () {
    if (this._pbCheck && this.now - this._pbCheck < 10000) return;
    this._pbCheck = this.now;
    const bases = this.db.pbases || (this.db.pbases = {});
    if (!this.anoms) this.anoms = new Map();
    for (const sys of Object.values(this.U.systems)) {
      const b = bases[sys.id] || (bases[sys.id] = { deadUntil: 0 });
      if (b.deadUntil > this.now || (b.entId && this.ents.has(b.entId))) continue;
      this.spawnPbase(sys, b);
    }
  };

  P.spawnPbase = function (sys, rec) {
    const tier = this.pbaseTier(sys.id), T = PBASE_TIERS[tier];
    // место постоянно для системы, но не совпадает с крепостью
    const r = rng('pbase:' + sys.id), ang = r() * Math.PI * 2, rr = (1.2 + r() * 3) * AU;
    const pos = [Math.cos(ang) * rr, (r() - 0.5) * 0.04 * rr, Math.sin(ang) * rr];
    const e = this.spawnNpc('pbase', sys.id, pos, { name: `${T.name} «${BASE_NAMES[Math.floor(r() * BASE_NAMES.length)]}»` });
    e.pbase = true; e.npcSpeedMul = 0; e.home = pos; e.anom = 'an_pbase_' + sys.id;
    for (const k of ['shield', 'armor', 'hull']) { e.stats[k] = Math.round(e.stats[k] * T.hpMul); e[k] = e.stats[k]; }
    e.modules = Array.from({ length: T.guns }, () => ({ id: T.weapon, active: false, cycleEnd: 0, target: null }))
      .concat(tier >= 3 ? [{ id: 'ml_heavy', active: false, cycleEnd: 0, target: null }] : [])
      .concat(e.modules.filter(m => m.npcPd));
    e.pb = { tier, state: 'idle', wave: 0, waveIds: [], attackers: new Set(), lastSeen: 0, nextWaveAt: 0, cleared: true };
    rec.entId = e.id;
    const a = { id: e.anom, sys: sys.id, kind: 'pbase', public: true, name: e.name, radius: 0, landing: 25000, pos, sig: 1, created: this.now, expires: Infinity, triggered: true, npcs: new Set([e.id]) };
    this.anoms.set(a.id, a);
    this.broadcastAnoms(sys.id);
    return e;
  };

  // ---------- нападение ----------
  P.pbaseAttacker = function (src) {
    if (!src) return null;
    const own = src.owner || (src.ownerEnt && (this.ents.get(src.ownerEnt) || {}).owner);
    return own && this.db.players[own] ? own : null;
  };
  P.pbaseNotify = function (b, text, kind) {
    for (const s of this.sessions) {
      if (!s.ent || s.ent.sys !== b.sys) continue;
      if (b.pb.attackers.has(s.player.name) || dist(s.ent.pos, b.pos) < 150000) this.notify(s, text, kind);
    }
  };
  P.applyDamage = function (t, dmg, src) {
    const b = t.pb ? t : t.pbaseOf ? this.ents.get(t.pbaseOf) : null;
    if (b && b.pb) {
      const who = this.pbaseAttacker(src);
      if (who) { b.pb.attackers.add(who); b.pb.lastSeen = this.now; }
      if (t === b && who && b.pb.state === 'idle') { this.pbaseAlert(b); return; } // первый удар поднимает щит
      if (t === b && b.pb.state === 'waves') {
        const s = src && (src.session || (this.ents.get(src.ownerEnt) || {}).session);
        if (s && (!s.pbShieldNote || this.now - s.pbShieldNote > 15000)) { s.pbShieldNote = this.now; this.notify(s, `Щит базы держит удар — сначала отбейте волны (${b.pb.wave}/${PBASE.waves})`, 'warn'); }
        return;
      }
    }
    return baseApplyDamage.call(this, t, dmg, src);
  };

  P.pbaseAlert = function (b) {
    b.pb.state = 'waves'; b.pb.wave = 0; b.pb.cleared = true; b.pb.nextWaveAt = this.now + PBASE.firstWave;
    this.broadcastSys(b.sys, { t: 'chat', ch: 'local', from: b.name, text: pick(['Тревога! Рои — на взлёт!', 'Гости? Встречайте их, братья.', 'Поднять щит! Всем кораблям — к базе!', 'Вы пожалеете, что прилетели.']) });
    this.pbaseNotify(b, `⚠ ${b.name} подняла щит! Отбейте ${PBASE.waves} волн, чтобы снять его. Награда за базу: ${fmt(this.pbaseReward(b))} ISK`, 'bad');
  };

  // состав волны: рой дронов растёт с каждой волной, корабли — из классов уровня базы, в последней — главарь
  P.pbaseWave = function (b, w) {
    const T = PBASE_TIERS[b.pb.tier], tier = b.pb.tier;
    const list = [];
    const light = Math.round((3 + 2 * (w - 1)) * (1 + 0.25 * tier));
    for (let i = 0; i < light; i++) list.push('pdrone');
    for (let i = 0; i < Math.floor(Math.max(0, w - 2) * (1 + tier / 2)); i++) list.push('pdrone_h');
    let budget = T.budget * Math.pow(PBASE.growth, w - 1);
    const avail = T.ships.slice(0, Math.min(T.ships.length, 1 + Math.ceil(w / 2)));
    if (w === PBASE.waves) { const boss = T.ships[T.ships.length - 1]; list.push(boss); budget -= COST[boss]; }
    for (let guard = 0; guard < 40 && budget >= 2; guard++) {
      const opts = avail.filter(k => COST[k] <= budget + 0.5);
      if (!opts.length) break;
      const k = pick(opts); list.push(k); budget -= COST[k];
    }
    return list;
  };

  P.pbaseSpawnWave = function (b) {
    const w = ++b.pb.wave, list = this.pbaseWave(b, w);
    const hpK = 1 + 0.12 * (w - 1), dmgK = 1 + 0.08 * (w - 1);
    const targets = [...this.sessions].filter(s => s.ent && s.ent.sys === b.sys && !s.ent.warp && b.pb.attackers.has(s.player.name)).map(s => s.ent);
    b.pb.waveIds = [];
    for (const type of list) {
      const a = Math.random() * Math.PI * 2, R = b.radius + rnd(5000, 12000);
      const pos = add(b.pos, [Math.cos(a) * R, rnd(-1500, 1500), Math.sin(a) * R]);
      const n = this.spawnNpc(type, b.sys, pos);
      for (const k of ['shield', 'armor', 'hull']) { n.stats[k] *= hpK; n[k] = n.stats[k]; }
      n.npcDmgMul *= dmgK; n.bountyMul = 0.5; n.pbaseOf = b.id; n.home = b.pos;
      if (targets.length) n.npcTarget = pick(targets).id;
      b.pb.waveIds.push(n.id);
      if (type !== 'pdrone') this.fxSys(b.sys, n.pos, { k: 'jump', pos: n.pos });
    }
    b.pb.cleared = false;
    const cnt = {};
    for (const t of list) cnt[t] = (cnt[t] || 0) + 1;
    const desc = Object.entries(cnt).map(([k, q]) => `${NPCS[k].name} ×${q}`).join(', ');
    this.pbaseNotify(b, `Волна ${w}/${PBASE.waves}: ${desc}`, 'bad');
  };

  // ---------- ход волн (раз в секунду) ----------
  P.pbaseTick = function () {
    for (const b of this.ents.values()) {
      if (!b.pb || b.pb.state === 'idle') continue;
      const pb = b.pb;
      // нападающие рядом? если все улетели — база восстанавливается
      for (const s of this.sessions) if (s.ent && s.ent.sys === b.sys && !s.ent.warp && pb.attackers.has(s.player.name) && dist(s.ent.pos, b.pos) < 150000) pb.lastSeen = this.now;
      if (this.now - pb.lastSeen > PBASE.resetAfter) { this.pbaseReset(b); continue; }
      if (pb.state !== 'waves') continue;
      const alive = pb.waveIds.filter(id => this.ents.has(id)).length;
      if (alive) continue;
      if (!pb.cleared) {
        pb.cleared = true;
        if (pb.wave >= PBASE.waves) {
          pb.state = 'open';
          this.broadcastSys(b.sys, { t: 'chat', ch: 'local', from: b.name, text: 'Щит… щит не держит! Всем, кто жив, — уходить!' });
          this.pbaseNotify(b, `Все ${PBASE.waves} волн отбиты! Щит базы отключён — уничтожьте её.`, 'good');
          continue;
        }
        pb.nextWaveAt = this.now + PBASE.pause;
        this.pbaseNotify(b, `Волна ${pb.wave} отбита! Следующая — через ${PBASE.pause / 1000} с`, 'good');
      }
      if (this.now >= pb.nextWaveAt) this.pbaseSpawnWave(b);
    }
  };

  P.pbaseReset = function (b) {
    for (const id of b.pb.waveIds) { const n = this.ents.get(id); if (n) { this.fxSys(n.sys, n.pos, { k: 'jump', pos: n.pos }); this.removeEntity(n); } }
    b.pb = { ...b.pb, state: 'idle', wave: 0, waveIds: [], attackers: new Set(), cleared: true };
    for (const k of ['shield', 'armor', 'hull']) b[k] = b.stats[k];
    b.npcTarget = null; b.locks.clear();
    this.broadcastSys(b.sys, { t: 'chat', ch: 'local', from: b.name, text: 'Сбежали. Чинимся и ждём следующих.' });
  };

  // база спокойна, пока на неё не напали; потом бьёт нападающих
  P.aiTick = function (e, dt) {
    if (e.pbase) {
      e.npcSpeedMul = 0;
      if (!e.pb || e.pb.state === 'idle') { e.npcTarget = null; if (e.locks.size) e.locks.clear(); for (const m of e.modules) if (!m.npcPd) m.active = false; return; }
      const t = e.npcTarget && this.ents.get(e.npcTarget);
      if (!t || !e.pb.attackers.has(this.pbaseAttacker(t) || '')) {
        let best = null, bd = 70000;
        for (const s of this.sessions) if (s.ent && s.ent.sys === e.sys && !s.ent.warp && e.pb.attackers.has(s.player.name)) { const d = dist(s.ent.pos, e.pos); if (d < bd) { bd = d; best = s.ent; } }
        e.npcTarget = best ? best.id : null;
      }
    }
    return baseAiTick.call(this, e, dt);
  };

  // ---------- уничтожение базы ----------
  P.destroyShip = function (t, killer) {
    if (!t.pbase) return baseDestroy.call(this, t, killer);
    const pb = t.pb, T = PBASE_TIERS[pb.tier];
    this.fxSys(t.sys, t.pos, { k: 'boom', pos: t.pos, size: t.radius * 4 });
    for (const id of pb.waveIds) { const n = this.ents.get(id); if (n) this.removeEntity(n); }
    this.removeEntity(t);
    // тайник
    const items = {};
    for (const [item, chance, a, b] of LOOT[pb.tier]) {
      if (Math.random() >= chance) continue;
      const id = item === 'elite' ? pick(ELITE) : item;
      items[id] = (items[id] || 0) + Math.floor(rnd(a, b + 1));
    }
    // редкий чертёж: чем опаснее база, тем вероятнее
    if (Math.random() < [0.05, 0.1, 0.2, 0.35, 0.6][pb.tier]) { const bp = this.rareBlueprint(); if (bp) items[bp] = 1; }
    const w = { id: 'wr_' + uid(), type: 'wreck', sys: t.sys, pos: t.pos.slice(), vel: [0, 0, 0], radius: 120, name: `Тайник: ${t.name}`, items, expires: this.now + 30 * 60000 };
    this.ents.set(w.id, w);
    // награда делится между всеми, кто участвовал в штурме
    const killerName = this.pbaseAttacker(killer);
    if (killerName) pb.attackers.add(killerName);
    const names = [...pb.attackers].filter(n => this.db.players[n]);
    const total = this.pbaseReward(t), share = Math.round(total / Math.max(1, names.length));
    for (const n of names) {
      const p = this.db.players[n];
      p.credits += share; p.stats.npcKills++;
      p.stats.pbases = (p.stats.pbases || 0) + 1;
      for (const s of this.sessions) if (s.player === p) { this.notify(s, `${t.name} уничтожена! Награда: ${fmt(share)} ISK${names.length > 1 ? ` (доля из ${fmt(total)})` : ''}. Заберите тайник базы.`, 'good'); this.sendProfile(s); }
    }
    const rec = (this.db.pbases || {})[t.sys];
    if (rec) { rec.deadUntil = this.now + PBASE.respawn; rec.entId = null; }
    if (this.anoms) { const a = this.anoms.get(t.anom); if (a) { a.done = true; a.expires = this.now + 10 * 60000; this.broadcastAnoms(t.sys); } }
    for (const s of this.sessions) s.send({ t: 'chat', ch: 'global', from: 'Новости галактики', text: `${t.name} в системе ${this.U.byId[t.sys].name} уничтожена${names.length ? ' пилотами: ' + names.join(', ') : ''}. Опасность сектора: ${T.danger}.` });
  };

  P.entView = function (o, viewer) {
    const v = baseEntView.call(this, o, viewer);
    if (v && o.pb) { v.pbs = o.pb.state; v.pbw = o.pb.wave; v.pbn = PBASE.waves; v.pbr = this.pbaseReward(o); v.pbd = PBASE_TIERS[o.pb.tier].danger; }
    return v;
  };

  P.pbasesSlowTick = function () { this.pbaseUpkeep(); this.pbaseTick(); };
};
module.exports.PBASE_TIERS = PBASE_TIERS;
module.exports.PBASE = PBASE;
