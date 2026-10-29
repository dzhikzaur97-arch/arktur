// Аномалии Предтеч — источник уникального оборудования (артефактов). У каждой своё испытание:
//  · «Хранилище Предтеч» — держаться рядом 30 с, пока идёт взлом, и отбиваться от стражей хранилища;
//  · «Спящий страж» — победить корабль Предтеч и его осколки (только в опасных системах);
//  · «Ионный шторм» — выработать светящиеся кристаллы, пока разряды бьют по кораблю и сосут накопитель;
//  · «Кладбище флота» — обыскать остовы древнего флота; через 20 с прилетают мародёры.
// Награда — тайник с артефактом из пула аномалии (в опасных системах иногда два) и реликвиями.
'use strict';
const crypto = require('crypto');
const { AU, MODULES, ITEMS, incomeOf } = require('./data');
const { makeAsteroid, rng } = require('./universe');

const uid = () => crypto.randomBytes(6).toString('hex');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const RELIC = {
  vault:     { names: ['Хранилище Предтеч', 'Запечатанный архив', 'Склеп ковчега'], maxSec: 1, pool: ['art_resonator', 'art_chrono', 'art_compass'] },
  sentinel:  { names: ['Спящий страж', 'Колыбель стража', 'Безмолвный часовой'], maxSec: 0.45, pool: ['art_heart', 'art_prism'] },
  ionstorm:  { names: ['Ионный шторм', 'Поющее облако', 'Электрическая туманность'], maxSec: 1, pool: ['art_ioncap', 'art_compass', 'art_chrono'] },
  graveyard: { names: ['Кладбище флота', 'Поле последней битвы', 'Обломки армады Предтеч'], maxSec: 0.7, pool: ['art_anchor', 'art_swarm', 'art_prism'] }
};
const HACK_TIME = 30, HACK_RANGE = 9000, STORM_RANGE = 60000;

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseTrigger = P.triggerAnomalies, baseNpcKilled = P.anomNpcKilled, baseDeplete = P.depleteAsteroid, baseLoot = P.c_loot, baseAnomTick = P.anomTick;

  // В каждой системе — хотя бы одна аномалия Предтеч (их сигналы слабые: искать сканером дольше)
  P.anomTick = function () {
    baseAnomTick.call(this);
    if (this._relicCheck && this.now - this._relicCheck < 15000) return;
    this._relicCheck = this.now;
    const have = {};
    for (const a of this.anoms.values()) if (RELIC[a.kind] && !a.done) have[a.sys] = (have[a.sys] || 0) + 1;
    for (const sys of Object.values(this.U.systems)) {
      const want = sys.def.sec >= 0.5 ? 1 : 2;
      if ((have[sys.id] || 0) < want) this.createRelicAnomaly(sys);
    }
  };

  P.createRelicAnomaly = function (sys, kind) {
    const sec = sys.def.sec;
    kind = kind || pick(Object.keys(RELIC).filter(k => sec <= RELIC[k].maxSec));
    const ang = Math.random() * Math.PI * 2, r = (1.5 + Math.random() * 6) * AU;
    const a = {
      id: 'an_' + uid(), sys: sys.id, kind, relic: true, name: pick(RELIC[kind].names), radius: 0, landing: 6000,
      pos: [Math.cos(ang) * r, (Math.random() - 0.5) * 0.05 * r, Math.sin(ang) * r],
      sig: rnd(0.25, 0.6), created: this.now, expires: this.now + rnd(90, 150) * 60000, triggered: false, npcs: new Set(), hack: 0
    };
    this.anoms.set(a.id, a);
    return a;
  };

  const say = (g, sysId, text, kind = 'info') => { for (const s of g.sessions) if (s.ent && s.ent.sys === sysId) g.notify(s, text, kind); };

  // тайник с наградой: артефакт из пула (в опасных системах — шанс второго), реликвии, ядра
  P.relicCache = function (a, extra = {}) {
    const sec = this.U.byId[a.sys].sec, pool = RELIC[a.kind].pool;
    const items = { salv_relic: 1 + Math.floor(Math.random() * 3), salv_core: 2 + Math.floor(Math.random() * 3), ...extra };
    const art = pick(pool); items[art] = 1;
    if (sec < 0.3 && Math.random() < (sec <= 0 ? 0.35 : 0.2)) { const art2 = pick(pool); items[art2] = (items[art2] || 0) + 1; }
    if (Math.random() < (sec < 0.45 ? 0.35 : 0.2)) { const bp = this.rareBlueprint(); if (bp) items[bp] = 1; } // редкий чертёж
    const w = { id: 'wr_' + uid(), type: 'wreck', sys: a.sys, pos: add(a.pos, [rnd(-800, 800), rnd(-200, 200), rnd(-800, 800)]), vel: [0, 0, 0],
      radius: 120, name: 'Тайник Предтеч', items, relic: 'cache', expires: this.now + 30 * 60000, anom: a.id };
    this.ents.set(w.id, w);
    a.done = true; a.expires = Math.min(a.expires, this.now + 30 * 60000);
    const arts = Object.keys(items).filter(k => MODULES[k] && MODULES[k].artifact).map(k => `«${MODULES[k].name}»`).join(' и ');
    say(this, a.sys, `${a.name}: испытание пройдено! Тайник Предтеч открыт — внутри ${arts}.`, 'good');
    this.broadcastAnoms(a.sys);
    return w;
  };

  P.relicNpc = function (a, type, spread, track = true) {
    const e = this.spawnNpc(type, a.sys, add(a.pos, [rnd(-spread, spread), rnd(-spread / 6, spread / 6), rnd(-spread, spread)]));
    e.home = a.pos; e.anom = a.id; e.relicGuard = true;
    if (track) a.npcs.add(e.id);
    return e;
  };

  // Прилёт: запуск испытания (раньше базовой обработки, иначе та сочтёт аномалию «рудной»)
  P.triggerAnomalies = function (s) {
    const e = s.ent;
    if (e && !e.warp && this.anoms) for (const a of this.anoms.values()) {
      if (!a.relic || a.sys !== e.sys || dist(a.pos, e.pos) > 150000) continue;
      if (!a.triggered) { a.triggered = true; this.relicStart(a, s); }
      this.relicTick(a, s);
    }
    return baseTrigger.call(this, s);
  };

  P.relicStart = function (a, s) {
    const sec = this.U.byId[a.sys].sec;
    if (a.kind === 'vault') {
      const v = { id: 'wr_' + uid(), type: 'wreck', sys: a.sys, pos: a.pos.slice(), vel: [0, 0, 0], radius: 320, name: 'Хранилище Предтеч (запечатано)',
        items: {}, sealed: true, relic: 'vault', expires: a.expires, anom: a.id };
      this.ents.set(v.id, v); a.vault = v.id;
      this.notify(s, `${a.name}: держитесь в ${HACK_RANGE / 1000} км от хранилища ${HACK_TIME} с — идёт взлом. Стражи хранилища будут мешать.`, 'warn');
    } else if (a.kind === 'sentinel') {
      const boss = this.relicNpc(a, 'sentinel', 3000);
      boss.relicBoss = true;
      if (sec <= 0) { boss.stats.shield *= 1.4; boss.stats.armor *= 1.4; boss.shield = boss.stats.shield; boss.armor = boss.stats.armor; }
      for (let i = 0; i < (sec <= 0 ? 4 : 2); i++) this.relicNpc(a, 'shard', 8000);
      this.notify(s, `${a.name}: корабль Предтеч пробуждается! Победите стража и его осколки.`, 'bad');
    } else if (a.kind === 'ionstorm') {
      const r2 = rng(a.id), beltLike = { id: a.id, sys: a.sys, pos: a.pos, ores: [['rel_ioncrystal', 1]] };
      for (let i = 0; i < 6; i++) {
        const ast = makeAsteroid(beltLike, r2, i);
        ast.amount = ast.maxAmount = 120 + Math.floor(Math.random() * 80); ast.anom = a.id; ast.storm = true;
        this.ents.set(ast.id, ast);
      }
      this.notify(s, `${a.name}: выработайте все ионные кристаллы. Разряды бьют по щиту и разряжают накопитель — не задерживайтесь.`, 'warn');
    } else if (a.kind === 'graveyard') {
      const art = pick(RELIC.graveyard.pool), lucky = Math.floor(Math.random() * 6);
      for (let i = 0; i < 6; i++) {
        const items = { salv_scrap: 3 + Math.floor(Math.random() * 6), salv_core: 1 + Math.floor(Math.random() * 3) };
        if (Math.random() < 0.5) items.salv_relic = 1;
        if (i === lucky) items[art] = 1;
        const w = { id: 'wr_' + uid(), type: 'wreck', sys: a.sys, pos: add(a.pos, [rnd(-14000, 14000), rnd(-2500, 2500), rnd(-14000, 14000)]), vel: [0, 0, 0],
          radius: 240, name: pick(['Остов линкора', 'Остов крейсера', 'Разбитый носитель', 'Корма флагмана']) + ' Предтеч', items, expires: a.expires, anom: a.id };
        this.ents.set(w.id, w);
      }
      a.ambushAt = this.now + 20000;
      this.notify(s, `${a.name}: шесть древних остовов. В одном из них — артефакт. Сканеры ловят чужие сигнатуры…`, 'warn');
    }
    this.broadcastAnoms(a.sys);
  };

  // Ход испытания — раз в секунду для каждого пилота рядом
  P.relicTick = function (a, s) {
    const e = s.ent;
    if (a.done) return;
    const sec = this.U.byId[a.sys].sec;
    if (a.kind === 'vault') {
      const v = this.ents.get(a.vault);
      if (!v || a.lastHackTick === this.now) return;
      if (dist(v.pos, e.pos) > HACK_RANGE + v.radius) { if (a.hack > 0 && (!a.farNote || this.now - a.farNote > 8000)) { a.farNote = this.now; this.notify(s, `Взлом приостановлен: подлетите ближе ${HACK_RANGE / 1000} км к хранилищу`, 'warn'); } return; }
      a.lastHackTick = this.now; a.hack++;
      if (a.hack % 8 === 1) { // волна стражей хранилища
        const alive = [...this.ents.values()].filter(x => x.anom === a.id && x.relicGuard).length;
        for (let i = 0; i < Math.min(3 + (sec < 0.5 ? 1 : 0), 9 - alive); i++) this.relicNpc(a, a.hack > 15 && i === 0 ? 'shard' : 'vaultguard', 6000, false);
      }
      if (a.hack % 10 === 0 && a.hack < HACK_TIME) this.notify(s, `Взлом хранилища: ${Math.round(a.hack / HACK_TIME * 100)}%`, 'info');
      if (a.hack >= HACK_TIME) {
        v.sealed = false; v.name = 'Хранилище Предтеч (вскрыто)';
        const cache = this.relicCache(a);
        v.items = cache.items; this.removeEntity(cache); v.relic = 'vault_open'; v.expires = this.now + 30 * 60000;
      }
    } else if (a.kind === 'ionstorm') {
      if (dist(a.pos, e.pos) > STORM_RANGE || (e.invulnUntil && e.invulnUntil > this.now)) return;
      e.cap = Math.max(0, e.cap - e.stats.cap * 0.06); // шторм «высасывает» 6% накопителя в секунду
      if (!a.zapAt || this.now >= a.zapAt) { // разряд от случайного кристалла к кораблю
        a.zapAt = this.now + rnd(2500, 4500);
        const rocks = [...this.ents.values()].filter(x => x.storm && x.anom === a.id);
        if (rocks.length) {
          const r = pick(rocks);
          this.fxSys(a.sys, null, { k: 'beam', arc: 1, from: r.id, to: e.id, color: 0x80e0ff, hit: true, dur: 0.45 });
          this.applyDamage(e, e.stats.shield * 0.02 + 40 * (1 + Math.max(0, 0.5 - sec)), null);
        }
      }
    } else if (a.kind === 'graveyard') {
      if (a.ambushAt && this.now >= a.ambushAt) {
        a.ambushAt = 0;
        const team = sec >= 0.5 ? ['hunter', 'raider'] : sec > 0 ? ['hunter', 'hunter', 'reaper'] : ['hunter', 'reaper', 'reaper', 'warlord'];
        for (const t of team) { const n = this.relicNpc(a, t, 12000); n.name = 'Мародёр: ' + n.name; n.npcTarget = e.id; }
        this.notify(s, `${a.name}: мародёры! Они тоже пришли за артефактом.`, 'bad');
      }
    }
  };

  // хранилище нельзя обыскать, пока не вскрыто
  P.c_loot = function (s, m, p, e) {
    const w = this.ents.get(m.id);
    if (w && w.sealed) return this.notify(s, 'Хранилище запечатано: удерживайтесь рядом, пока идёт взлом', 'warn');
    const before = w && w.items ? Object.keys(w.items).filter(k => MODULES[k] && MODULES[k].artifact) : [];
    const r = baseLoot.call(this, s, m, p, e);
    for (const k of before) if (!(w.items && w.items[k]) && s.ent) this.notify(s, `Получен артефакт Предтеч: «${MODULES[k].name}»! Установите его на станции (вкладка «Оснастка»).`, 'good');
    // на кладбище флота испытание пройдено, когда артефакт подобран
    const a = w && w.anom && this.anoms && this.anoms.get(w.anom);
    if (a && a.kind === 'graveyard' && !a.done && before.length && !before.some(k => w.items && w.items[k])) { a.done = true; this.broadcastAnoms(a.sys); }
    return r;
  };

  // страж и осколки побеждены — тайник
  P.anomNpcKilled = function (t, killerPlayer) {
    baseNpcKilled.call(this, t, killerPlayer);
    const a = this.anoms && this.anoms.get(t.anom);
    if (!a || !a.relic || a.done) return;
    if (a.kind === 'sentinel' && !a.npcs.size) this.relicCache(a, { salv_relic: 3 });
  };

  // ионный шторм: выработан последний кристалл — тайник
  P.depleteAsteroid = function (t) {
    baseDeplete.call(this, t);
    if (!t.storm) return;
    const a = this.anoms && this.anoms.get(t.anom);
    if (!a || a.done) return;
    const left = [...this.ents.values()].some(x => x.storm && x.anom === a.id);
    if (!left) this.relicCache(a);
  };
};
module.exports.RELIC = RELIC;
