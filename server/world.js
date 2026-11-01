// Живой мир:
//  · экономические кризисы — в регионе внезапно не хватает товара (цена ×1.6–2) или рынок завален (×0.5–0.6);
//    новость получают все, кризис длится 25–45 минут;
//  · космическая погода — в части систем идут ионные штормы, солнечные вспышки, магнитные бури, туманности:
//    они меняют дальность захвата, щиты, скорость варпа и добычу, пока вы в этой системе;
//  · доска розыска — именные пиратские главари живут в опасных системах и растут в уровне (и в награде), пока их не собьют;
//    ваши преступления ставят награду и на вашу голову — за вами приходят охотники; долг можно погасить на станции.
'use strict';
const crypto = require('crypto');
const { SYSTEMS, ITEMS, NPCS, SHIPS, incomeOf } = require('./data');
const { rng } = require('./universe');

const uid = () => crypto.randomBytes(5).toString('hex');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const AU = 1.496e11;

const REGION_NAME = { core: 'Ядро', border: 'Пограничье', low: 'Нижние рубежи', null: 'Нулевые сектора', deep: 'Глубокий космос' };
const CRISIS = {
  every: [15 * 60000, 25 * 60000], dur: [25 * 60000, 45 * 60000], max: 2,
  goods: ['ore_ferit', 'ore_korundit', 'ore_arkselit', 'ore_nullium', 'mat_steel', 'mat_ceramite', 'mat_crystal', 'mat_nullalloy', 'gas_h3', 'gas_plasma', 'energy_cell', 'salv_core'],
  kinds: {
    shortage: { mul: [1.6, 2.0], text: (it, rg) => `Нехватка: ${it} в регионе «${rg}» — станции платят больше обычного! Цена продажи ↑` },
    glut:     { mul: [0.5, 0.6], text: (it, rg) => `Обвал цен: ${it} в регионе «${rg}» — склады переполнены. Цена ↓` }
  }
};
const WEATHER = {
  every: [20 * 60000, 35 * 60000], share: 0.3,
  kinds: {
    ion:    { name: 'Ионный шторм', icon: '⚡', desc: 'дальность захвата −30%, целей на одну меньше' },
    flare:  { name: 'Солнечная вспышка', icon: '☀', desc: 'щиты −20%, накопитель восстанавливается на 30% быстрее' },
    magnet: { name: 'Магнитная буря', icon: '🧲', desc: 'скорость варпа −40%' },
    nebula: { name: 'Плотная туманность', icon: '☁', desc: 'захват −20%, скорость −10%, добыча и сбор газа +15%' }
  }
};
const WANTED = {
  count: 6, growMs: 30 * 60000, maxLv: 10, respawnMs: 30 * 60000, spawnR: 150000, crime: 60000, decayH: 0.1, huntEvery: 3 * 60000,
  first: ['Безглазый', 'Кровавый', 'Чёрный', 'Седой', 'Тихий', 'Бешеный', 'Ржавый', 'Красная', 'Хромой', 'Ледяная'],
  last: ['Гарм', 'Варг', 'Морра', 'Сайрус', 'Кадр', 'Зверь', 'Вдова', 'Пёс', 'Барон', 'Карга', 'Мясник', 'Шакал']
};

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick, basePrice = P.priceOf, baseBuyPrice = P.buyPriceOf, baseDestroy = P.destroyShip, baseLogin = P.login;

  // ---------- кризисы ----------
  P.crisisMul = function (stationId, item) {
    const l = this.crises; if (!l || !l.length) return 1;
    const c = this.U.celestials[stationId], reg = c && (SYSTEMS.find(s => s.id === c.sys) || {}).region;
    let k = 1; for (const x of l) if (x.item === item && x.region === reg && x.until > this.now) k *= x.mul;
    return k;
  };
  P.priceOf = function (st, item) { const v = basePrice.call(this, st, item), k = this.crisisMul(st, item); return k === 1 ? v : Math.round(v * k); };
  P.buyPriceOf = function (st, item) { const v = baseBuyPrice.call(this, st, item), k = ITEMS[item] ? this.crisisMul(st, item) : 1; return k === 1 ? v : Math.round(v * Math.sqrt(k)); };
  P.crisisTick = function () {
    this.crises = (this.crises || []).filter(c => c.until > this.now);
    if (!this.crisisNext) this.crisisNext = this.now + 3 * 60000;
    if (this.now < this.crisisNext || this.crises.length >= CRISIS.max) return;
    this.crisisNext = this.now + rnd(...CRISIS.every);
    const kind = Math.random() < 0.6 ? 'shortage' : 'glut', K = CRISIS.kinds[kind];
    const item = pick(CRISIS.goods.filter(g => ITEMS[g] && !this.crises.some(c => c.item === g)));
    const region = pick(Object.keys(REGION_NAME));
    const c = { id: uid(), kind, item, region, mul: +rnd(...K.mul).toFixed(2), until: this.now + rnd(...CRISIS.dur), text: K.text(ITEMS[item].name, REGION_NAME[region]) };
    this.crises.push(c);
    for (const s of this.sessions) { s.send({ t: 'chat', ch: 'global', from: '*', text: '📈 ' + c.text }); this.notify(s, '📈 ' + c.text, kind === 'shortage' ? 'good' : 'warn'); }
    this.worldBroadcast();
  };

  // ---------- погода ----------
  P.weatherOf = function (sysId) { const w = this.weather && this.weather[sysId]; return w && w.until > this.now ? w.kind : null; };
  P.weatherTick = function () {
    if (this.weatherNext && this.now < this.weatherNext) return;
    this.weatherNext = this.now + rnd(...WEATHER.every);
    this.weather = {};
    const keys = Object.keys(WEATHER.kinds);
    for (const s of SYSTEMS) {
      if (s.hub || this.U.byId[s.id].wormhole || Math.random() > WEATHER.share) continue;
      this.weather[s.id] = { kind: pick(keys), until: this.weatherNext + 5000 };
    }
    for (const s of this.sessions) { const e = s.ent, w = e && this.weatherOf(e.sys); if (w) this.notify(s, `${WEATHER.kinds[w].icon} В системе — ${WEATHER.kinds[w].name}: ${WEATHER.kinds[w].desc}`, 'warn'); }
    this.worldBroadcast();
  };
  // погода меняет характеристики корабля пилота в системе (пересчёт, когда погода или система сменились)
  P.weatherApply = function (e) {
    const p = this.db.players[e.owner]; if (!p) return;
    const w = this.weatherOf(e.sys) || 'calm';
    if (e.stats.__wx === w) return;
    const st = this.calcStats(p, p.ship);
    if ((SHIPS[p.ship.type] || {}).stormproof) { if (w !== 'calm') { st.dmgMul *= 1.2; st.maxSpeed *= 1.15; } }
    else if (w === 'ion') { st.lockRange *= 0.7; st.maxLocks = Math.max(1, st.maxLocks - 1); }
    else if (w === 'flare') { st.shield *= 0.8; st.capRegen *= 1.3; }
    else if (w === 'magnet') st.warpSpeed *= 0.6;
    else if (w === 'nebula') { st.lockRange *= 0.8; st.maxSpeed *= 0.9; st.mineMul *= 1.15; }
    const fr = e.stats.shield ? e.shield / e.stats.shield : 1;
    st.__wx = w; e.stats = st; e.shield = Math.min(st.shield, st.shield * fr);
    if (w !== 'calm' && e.session && e.wxSeen !== e.sys + w) { e.wxSeen = e.sys + w; this.notify(e.session, `${WEATHER.kinds[w].icon} ${WEATHER.kinds[w].name}: ${WEATHER.kinds[w].desc}`, 'warn'); }
    if (e.session) e.session.send({ t: 'weather', sys: e.sys, kind: w === 'calm' ? null : w, info: WEATHER.kinds[w] || null });
  };

  // ---------- доска розыска ----------
  P.wantedInit = function () {
    const db = this.db; db.wanted = db.wanted || { bosses: [] };
    const danger = SYSTEMS.filter(s => s.sec < 0.5 && !s.hub && this.U.systems[s.id] && !this.U.byId[s.id].wormhole);
    while (db.wanted.bosses.length < WANTED.count) db.wanted.bosses.push(this.wantedNew(danger));
    for (const b of db.wanted.bosses) if (!this.U.systems[b.sys]) Object.assign(b, this.wantedNew(danger));
  };
  P.wantedNew = function (danger) {
    const used = new Set(((this.db.wanted || {}).bosses || []).map(b => b.sys));
    const s = pick(danger.filter(x => !used.has(x.id))) || pick(danger);
    const r = rng('lair:' + s.id + ':' + this.now), a = r() * Math.PI * 2, d = (2 + r() * 4) * AU, sun = this.U.systems[s.id].celestials[0].pos;
    return { id: 'wb_' + uid(), name: `${pick(WANTED.first)} ${pick(WANTED.last)}`, sys: s.id, lv: 1, born: this.now, back: 0,
      ship: pick(['strazh', 'molot', 'vihr', 'citadel']), pos: [sun[0] + Math.cos(a) * d, sun[1], sun[2] + Math.sin(a) * d] };
  };
  P.wantedBounty = function (b) { return Math.round(60000 * Math.pow(b.lv, 1.4) * (0.75 + 0.25 * incomeOf(b.sys))); };
  P.wantedTick = function () {
    if (!this.db.wanted) this.wantedInit();
    if (!this.anoms) return;
    for (const b of this.db.wanted.bosses) {
      if (b.back) { if (this.now < b.back) continue; const danger = SYSTEMS.filter(s => s.sec < 0.5 && !s.hub && this.U.systems[s.id] && !this.U.byId[s.id].wormhole); Object.assign(b, this.wantedNew(danger)); }
      // рост: каждые 30 минут на свободе — уровень выше
      const lv = Math.min(WANTED.maxLv, 1 + Math.floor((this.now - b.born) / WANTED.growMs));
      if (lv > b.lv) { b.lv = lv; if (lv % 3 === 0) for (const s of this.sessions) s.send({ t: 'chat', ch: 'global', from: '*', text: `☠ Розыск: «${b.name}» (${this.U.byId[b.sys].name}) набирает силу — уровень ${lv}, награда ${fmt(this.wantedBounty(b))} CR` }); }
      // метка логова для варпа
      const aid = 'an_wanted_' + b.id;
      if (!this.anoms.has(aid)) { this.anoms.set(aid, { id: aid, sys: b.sys, kind: 'wanted', public: true, name: `☠ Логово: ${b.name}`, radius: 0, landing: 20000, pos: b.pos, sig: 1, created: this.now, expires: Infinity, triggered: true, npcs: new Set() }); this.broadcastAnoms(b.sys); }
      // главарь появляется, когда рядом пилот; без свидетелей — уходит и залечивает раны
      const near = [...this.sessions].some(s => s.ent && s.ent.sys === b.sys && dist(s.ent.pos, b.pos) < WANTED.spawnR);
      let e = b.ent && this.ents.get(b.ent);
      if (near && !e) {
        e = this.spawnNpc('dreadlord', b.sys, b.pos.map((v, i) => i === 1 ? v : v + rnd(-3000, 3000)), { ship: b.ship, name: `☠ ${b.name} · ур. ${b.lv}` });
        const k = 0.5 + 0.18 * b.lv;
        for (const f of ['shield', 'armor', 'hull']) { e.stats[f] = Math.round(e.stats[f] * k); e[f] = e.stats[f]; }
        e.npcDmgMul = (e.npcDmgMul || 1) * (0.7 + 0.08 * b.lv); e.wantedId = b.id; e.home = b.pos.slice(); e.bountyMul = 0.05;
        b.ent = e.id; b.guards = [];
        for (let i = 0; i < Math.min(4, 1 + Math.floor(b.lv / 3)); i++) { const g = this.spawnNpc(b.lv > 6 ? 'reaper' : 'raider', b.sys, b.pos.map((v, j) => j === 1 ? v : v + rnd(-6000, 6000))); g.home = b.pos.slice(); b.guards.push(g.id); }
        b.seen = this.now;
      } else if (e && near) b.seen = this.now;
      else if (e && this.now - (b.seen || 0) > 120000) { this.removeEntity(e); for (const id of b.guards || []) { const g = this.ents.get(id); if (g) this.removeEntity(g); } b.ent = null; }
    }
  };
  P.destroyShip = function (t, killer) {
    const b = t.wantedId && this.db.wanted && this.db.wanted.bosses.find(x => x.id === t.wantedId);
    if (b) {
      const name = killer && (killer.owner || (this.wevAttacker && this.wevAttacker(killer)));
      const p = name && this.db.players[name], prize = Math.round(this.wantedBounty(b) * (1 + ((p && SHIPS[p.ship.type] || {}).bountyBonus || 0)));
      const r = baseDestroy.call(this, t, killer);
      if (p) { p.credits += prize; p.stats.wantedKills = (p.stats.wantedKills || 0) + 1; }
      for (const s of this.sessions) { s.send({ t: 'chat', ch: 'global', from: '*', text: `☠ Розыск закрыт: «${b.name}» (ур. ${b.lv}) сбит${p ? ` пилотом ${p.name}` : ''}! Награда ${fmt(prize)} CR` }); if (s.player === p) { this.notify(s, `☠ Награда за «${b.name}»: +${fmt(prize)} CR`, 'good'); this.sendProfile(s); } }
      const items = { salv_core: 1 + Math.floor(b.lv / 2) }; if (b.lv >= 5) items.mat_xcore = Math.floor(b.lv / 3); if (b.lv >= 8 && this.rareBlueprint) { const bp = this.rareBlueprint(); if (bp) items[bp] = 1; }
      const wid = 'wr_' + uid(); this.ents.set(wid, { id: wid, type: 'wreck', sys: t.sys, pos: t.pos.slice(), vel: [0, 0, 0], radius: 120, name: `Обломки: ${b.name}`, items, expires: this.now + 30 * 60000 });
      const aid = 'an_wanted_' + b.id; if (this.anoms && this.anoms.delete(aid)) this.broadcastAnoms(b.sys);
      b.ent = null; b.back = this.now + WANTED.respawnMs;
      this.worldBroadcast(); this.save();
      return r;
    }
    return baseDestroy.call(this, t, killer);
  };
  // награда за вашу голову: растёт за преступления, за вами приходят охотники
  P.bountyTick = function () {
    for (const s of this.sessions) {
      const p = s.player; if (!p) continue;
      if (p.criminalUntil > this.now && p._crimeMark !== p.criminalUntil) { p._crimeMark = p.criminalUntil; p.wanted = (p.wanted || 0) + WANTED.crime; this.notify(s, `☠ За вашу голову назначена награда: ${fmt(p.wanted)} CR. Охотники выйдут на след — погасить долг можно на любой станции (📰 Сводка)`, 'bad'); }
      if (!p.wanted) continue;
      p.wanted = Math.max(0, p.wanted * (1 - WANTED.decayH / 3600)); if (p.wanted < 1000) p.wanted = 0;
      const e = s.ent; if (!e || e.warp || s.docked || this.U.byId[e.sys].sec >= 0.95) continue;
      if (this.now - (s.huntAt || 0) < WANTED.huntEvery) continue;
      s.huntAt = this.now;
      if (Math.random() > 0.35) continue;
      const n = p.wanted > 200000 ? 3 : p.wanted > 100000 ? 2 : 1;
      for (let i = 0; i < n; i++) { const h = this.spawnNpc('hunter', e.sys, e.pos.map((v, j) => j === 1 ? v : v + rnd(-15000, 15000)), { name: 'Охотник за головами' }); h.npcTarget = e.id; h.bountyHunter = true; }
      this.notify(s, `☠ Охотники за головами нашли вас (${n})! Награда за вас — ${fmt(p.wanted)} CR`, 'bad');
    }
  };
  P.c_wantedPay = function (s, m, p) {
    if (!this.requireDocked(s)) return;
    const sum = Math.round(p.wanted || 0); if (!sum) return;
    if (p.credits < sum) return this.notify(s, `Нужно ${fmt(sum)} CR`, 'warn');
    p.credits -= sum; p.wanted = 0;
    this.notify(s, `Долг погашен (${fmt(sum)} CR) — охотники отозваны`, 'good');
    this.sendProfile(s); s.send(this.worldView(p)); this.save();
  };

  // ---------- сводка для клиента ----------
  P.worldView = function (p) {
    return { t: 'world', now: this.now,
      crises: (this.crises || []).filter(c => c.until > this.now).map(c => ({ kind: c.kind, item: c.item, region: c.region, regionName: REGION_NAME[c.region], mul: c.mul, until: c.until, text: c.text })),
      weather: Object.entries(this.weather || {}).filter(([, w]) => w.until > this.now).map(([sys, w]) => ({ sys, kind: w.kind, until: w.until })), weatherKinds: WEATHER.kinds,
      bosses: ((this.db.wanted || {}).bosses || []).map(b => ({ id: b.id, name: b.name, sys: b.sys, lv: b.lv, bounty: this.wantedBounty(b), back: b.back > this.now ? b.back - this.now : 0 })),
      myBounty: Math.round((p && p.wanted) || 0) };
  };
  P.c_worldInfo = function (s, m, p) { s.send(this.worldView(p)); };
  P.worldBroadcast = function () { for (const s of this.sessions) if (s.player) s.send(this.worldView(s.player)); };
  P.login = function (s, m) { const r = baseLogin.apply(this, arguments); if (s.player) s.send(this.worldView(s.player)); return r; };

  P.slowTick = function () {
    baseSlow.call(this);
    for (const e of this.ents.values()) if (e.owner && e.type === 'ship' && e.stats) this.weatherApply(e);
    if (this._worldAt && this.now - this._worldAt < 2000) return;
    this._worldAt = this.now;
    this.crisisTick(); this.weatherTick(); this.wantedTick(); this.bountyTick();
  };
};
module.exports.WEATHER = WEATHER;
module.exports.CRISIS = CRISIS;
module.exports.WANTED = WANTED;
