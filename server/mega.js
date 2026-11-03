// Великие стройки — куда потратить сотни миллионов.
//
// 1. Своя система: выкупить право на систему (кроме систем Ядра и уже занятых) и развивать её:
//    Застава → Крепость → Столица. Система платит налог с торговли и добычи (копится в казне, забирается из окна),
//    с Крепости — прыжковый мост: с любой станции мгновенно на станцию своей системы за энергоячейки,
//    со Столицы — пиратов в системе становится меньше (их выбивает ополчение), награды за пиратов там +25%.
// 2. Мегакорабль «Император»: пять этапов стройки на верфи Арктур Прайм. Каждый этап — деньги, материалы,
//    компоненты и реальное время. Недостающее можно докупить с наценкой. В конце — уникальный титан.
// 3. Монумент Арктура: бесконечный вклад. Каждый уровень даёт +1% к деньгам за продажу, торговлю, пиратов
//    и задания (до +30%). Цена уровня растёт в 1,45 раза.
'use strict';
const crypto = require('crypto');
const { SHIPS, ITEMS, SYSTEMS } = require('./data');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const uid = () => crypto.randomBytes(6).toString('hex');

const SOV = {
  levels: [null,
    { name: 'Застава', cost: 60000000, mats: {}, rate: 600000, desc: 'налог с системы 600 тыс. CR/ч' },
    { name: 'Крепость', cost: 150000000, mats: { mat_ceramite: 3000, mat_crystal: 1200, comp_plate: 60 }, rate: 1500000, bridge: true, desc: 'налог 1,5 млн CR/ч и прыжковый мост в систему с любой станции' },
    { name: 'Столица', cost: 400000000, mats: { mat_nullalloy: 1500, mat_xcore: 40, comp_core: 60, comp_chip: 40 }, rate: 3500000, bridge: true, capital: true, desc: 'налог 3,5 млн CR/ч, ополчение вдвое сокращает пиратов, награды за пиратов в системе +25%' }],
  bankHours: 48,          // казна копит не больше, чем за двое суток
  bridgeCells: 60,
  buyMarkup: 1.5
};
const LEVI = {
  ship: 'imperator', yard: null,
  stages: [
    { name: 'Киль и хребет', cost: 25000000, mats: { mat_steel: 6000, comp_plate: 40 }, hours: 1 },
    { name: 'Каркас и бронепояс', cost: 40000000, mats: { mat_ceramite: 4000, comp_plate: 80, comp_servo: 40 }, hours: 2 },
    { name: 'Реакторный зал', cost: 60000000, mats: { mat_crystal: 2500, comp_core: 40, comp_coil: 60 }, hours: 3 },
    { name: 'Орудийные палубы и ангар', cost: 80000000, mats: { mat_nullalloy: 1200, comp_lens: 60, comp_chip: 30 }, hours: 4 },
    { name: 'Мостик и ввод в строй', cost: 120000000, mats: { mat_xcore: 60, comp_chip: 60 }, hours: 6 }
  ]
};
const MON = { base: 10000000, k: 1.45, per: 0.01, max: 30 };

// титан «Император» — только из стройки, на рынке не продаётся
SHIPS.imperator = {
  name: 'Император', cls: 'Титан', price: 0, color: 0x3c4652, guild: 'Верфь Арктур Прайм (по личному заказу)',
  maxSpeed: 95, align: 16, warpSpeed: 1.8, sig: 600, radius: 420,
  shield: 42000, armor: 46000, hull: 40000, cap: 14000, capRegen: 140,
  cargo: 12000, slots: { high: 10, mid: 7, low: 7 }, maxLocks: 10, lockRange: 120000, lockTime: 4,
  bonus: { damage: 0.35, drones: 0.4, hp: 0.15 }, bossBonus: 0.3, role: 'carrier', tier: 5, unique: true, megaOnly: true,
  droneBay: 400, maxDrones: 10,
  desc: 'Титан, построенный по вашему заказу: 10 орудийных портов, ангар на 10 дронов, +35% урона, +40% к дронам, +15% прочности, +30% по боссам. Единственный в галактике.',
  lore: 'Верфь Арктур Прайм не строила титанов со времён Войны Ядра: последний «Император» ушёл на переплавку, когда флот распустили. Чертежи сохранились у старого главного инженера — и он согласился собрать ещё один, если заказчик оплатит каждую заклёпку. Пять этапов, тысячи тонн сплавов и месяцы ожидания, сжатые в часы: корабль, который можно увидеть из соседней системы.'
};

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick, baseSell = P.c_sell, baseTSell = P.c_tradeSell, baseDestroy = P.destroyShip, baseComplete = P.completeMission;

  const yardStation = (g) => Object.values(g.U.celestials).find(c => c.kind === 'station' && c.sys === 'arktur' && !c.owner);
  const matsHave = (g, p, st) => { const h = g.hangar(p, st).items; return (it) => (h[it] || 0) + (p.ship.cargo[it] || 0); };
  // списать материалы (ангар станции + трюм), недостающее докупить с наценкой; вернуть цену докупки или null
  const takeMats = (g, p, st, mats, buy, dry) => {
    const h = g.hangar(p, st).items, have = matsHave(g, p, st);
    let miss = 0; const lack = {};
    for (const [it, q] of Object.entries(mats)) { const d = q - have(it); if (d > 0) { lack[it] = d; miss += Math.ceil(d * ITEMS[it].base * SOV.buyMarkup); } }
    if (dry) return { miss, lack };
    if (miss && !buy) return null;
    for (const [it, q] of Object.entries(mats)) {
      let need = q - (lack[it] || 0);
      const a = Math.min(need, h[it] || 0); h[it] = (h[it] || 0) - a; need -= a; if (!h[it]) delete h[it];
      if (need) { p.ship.cargo[it] -= need; if (!p.ship.cargo[it]) delete p.ship.cargo[it]; }
    }
    return { miss, lack };
  };
  const sovOwner = (g, sys) => Object.values(g.db.players).find(x => x.sov && x.sov.sys === sys);
  P.sovOf = function (sys) { const o = sovOwner(this, sys); return o ? { owner: o.name, lv: o.sov.lv } : null; };
  const sovAccrue = (g, p) => {
    const v = p.sov; if (!v) return;
    const L = SOV.levels[v.lv], h = Math.max(0, (g.now - (v.at || g.now)) / 3600000);
    v.at = g.now; v.bank = Math.min((v.bank || 0) + L.rate * h, L.rate * SOV.bankHours);
  };
  const monLv = (p) => (p.mega && p.mega.mon) || 0;
  const monCost = (lv) => Math.round(MON.base * Math.pow(MON.k, lv));

  P.megaView = function (s, p) {
    sovAccrue(this, p);
    const st = s.docked, here = st && this.U.celestials[st], sysHere = here && this.U.byId[here.sys];
    const m = p.mega || {}, L = m.levi;
    const stage = L ? LEVI.stages[L.stage] : LEVI.stages[0];
    const dryM = (mats) => st ? takeMats(this, p, st, mats, false, true).miss : null;
    const owners = Object.values(this.db.players).filter(x => x.sov).map(x => ({ sys: x.sov.sys, name: (this.U.byId[x.sov.sys] || {}).name, owner: x.name, lv: x.sov.lv }));
    return { t: 'mega', now: this.now, docked: !!st, credits: p.credits,
      sov: p.sov ? { ...p.sov, sysName: this.U.byId[p.sov.sys].name, level: SOV.levels[p.sov.lv], next: SOV.levels[p.sov.lv + 1] || null, nextMiss: SOV.levels[p.sov.lv + 1] ? dryM(SOV.levels[p.sov.lv + 1].mats) : null } : null,
      sovLevels: SOV.levels.slice(1), bridgeCells: SOV.bridgeCells,
      here: sysHere ? { id: sysHere.id, name: sysHere.name, region: sysHere.region, sec: sysHere.sec, owner: (sovOwner(this, sysHere.id) || {}).name || null, canClaim: sysHere.region !== 'core' && !sysHere.hub && !sovOwner(this, sysHere.id) } : null,
      owners,
      levi: { stages: LEVI.stages, at: L ? L.stage : 0, building: L && L.until > this.now ? L.until : 0, done: !!(L && L.done), stageMiss: stage && !(L && L.done) ? dryM(stage.mats) : null,
        atYard: st === (yardStation(this) || {}).id, yardName: (yardStation(this) || {}).name, ship: { name: SHIPS.imperator.name, desc: SHIPS.imperator.desc, lore: SHIPS.imperator.lore } },
      mon: { lv: monLv(p), cost: monCost(monLv(p)), per: MON.per, max: MON.max, total: (m.monTotal || 0),
        top: Object.values(this.db.players).filter(x => x.mega && x.mega.mon).sort((a, b) => b.mega.mon - a.mega.mon).slice(0, 5).map(x => ({ name: x.name, lv: x.mega.mon })) } };
  };
  P.c_megaInfo = function (s, m, p) { s.send(this.megaView(s, p)); };

  // ---------- своя система ----------
  P.c_sovClaim = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const sys = this.U.byId[this.U.celestials[st].sys];
    if (p.sov) return this.notify(s, `У вас уже есть система — ${this.U.byId[p.sov.sys].name}`, 'warn');
    if (sys.region === 'core' || sys.hub) return this.notify(s, 'Системы Ядра под защитой Конфедерации — выкупить нельзя', 'warn');
    const own = sovOwner(this, sys.id); if (own) return this.notify(s, `Систему уже держит ${own.name}`, 'warn');
    const L = SOV.levels[1];
    if (p.credits < L.cost) return this.notify(s, `Нужно ${fmt(L.cost)} CR`, 'warn');
    p.credits -= L.cost; p.sov = { sys: sys.id, lv: 1, at: this.now, bank: 0, since: this.now };
    this.broadcastSys(sys.id, { t: 'chat', ch: 'local', from: '*', text: `${p.name} выкупил систему ${sys.name} и ставит Заставу` });
    this.notify(s, `👑 Система ${sys.name} теперь ваша! Застава: ${L.desc}`, 'good');
    p.stats.sov = 1;
    this.sendProfile(s); s.send(this.megaView(s, p)); this.save(true);
  };
  P.c_sovUp = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    if (!p.sov) return;
    if (this.U.celestials[st].sys !== p.sov.sys) return this.notify(s, 'Улучшать систему можно, находясь на её станции', 'warn');
    const N = SOV.levels[p.sov.lv + 1]; if (!N) return this.notify(s, 'Система уже Столица', 'warn');
    const dry = takeMats(this, p, st, N.mats, false, true), total = N.cost + dry.miss;
    if (dry.miss && !m.buy) return this.notify(s, 'Не хватает материалов — привезите или докупите', 'warn');
    if (p.credits < total) return this.notify(s, `Нужно ${fmt(total)} CR`, 'warn');
    sovAccrue(this, p);
    takeMats(this, p, st, N.mats, true); p.credits -= total; p.sov.lv++;
    this.notify(s, `👑 ${this.U.byId[p.sov.sys].name}: теперь ${N.name}! ${N.desc}`, 'good');
    this.sendProfile(s); s.send(this.megaView(s, p)); this.save(true);
  };
  P.c_sovCollect = function (s, m, p) {
    if (!p.sov) return; sovAccrue(this, p);
    const v = Math.floor(p.sov.bank || 0); if (v < 1) return this.notify(s, 'Казна системы пуста', 'warn');
    p.sov.bank -= v; p.credits += v; p.stats.sovIncome = (p.stats.sovIncome || 0) + v;
    this.notify(s, `👑 Налоги системы: +${fmt(v)} CR`, 'good');
    this.sendProfile(s); s.send(this.megaView(s, p)); this.save();
  };
  P.c_sovBridge = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    if (!p.sov || !SOV.levels[p.sov.lv].bridge) return this.notify(s, 'Прыжковый мост есть с уровня «Крепость»', 'warn');
    const dest = Object.values(this.U.celestials).find(c => c.kind === 'station' && c.sys === p.sov.sys && !c.owner);
    if (!dest) return this.notify(s, 'В вашей системе нет станции', 'warn');
    if (dest.id === st) return this.notify(s, 'Вы уже в своей системе', 'warn');
    const h = this.hangar(p, st).items, have = (h.energy_cell || 0) + (p.ship.cargo.energy_cell || 0);
    if (have < SOV.bridgeCells) return this.notify(s, `Мосту нужно ${SOV.bridgeCells} энергоячеек (в трюме или ангаре)`, 'warn');
    let need = SOV.bridgeCells; const fc = Math.min(need, p.ship.cargo.energy_cell || 0); p.ship.cargo.energy_cell -= fc; need -= fc; if (!p.ship.cargo.energy_cell) delete p.ship.cargo.energy_cell;
    if (need) { h.energy_cell -= need; if (!h.energy_cell) delete h.energy_cell; }
    p.loc = { docked: dest.id };
    this.enterStation(s, dest.id, true);
    this.notify(s, `🌀 Прыжковый мост: вы на станции ${dest.name}`, 'good');
    this.sendProfile(s); this.save();
  };

  // ---------- мегакорабль ----------
  P.c_leviBuild = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const y = yardStation(this); if (!y || st !== y.id) return this.notify(s, `Титан строят только на верфи ${(y || {}).name || 'Арктур Прайм'}`, 'warn');
    p.mega = p.mega || {}; const L = p.mega.levi || (p.mega.levi = { stage: 0, until: 0, done: false });
    if (L.done) return this.notify(s, '«Император» уже построен', 'warn');
    if (L.until > this.now) return this.notify(s, 'Этап ещё идёт', 'warn');
    const S = LEVI.stages[L.stage];
    const dry = takeMats(this, p, st, S.mats, false, true), total = S.cost + dry.miss;
    if (dry.miss && !m.buy) return this.notify(s, 'Не хватает материалов — привезите или докупите', 'warn');
    if (p.credits < total) return this.notify(s, `Нужно ${fmt(total)} CR`, 'warn');
    takeMats(this, p, st, S.mats, true); p.credits -= total;
    L.until = this.now + S.hours * 3600000; L.paid = (L.paid || 0) + total;
    this.notify(s, `🛠 «Император»: начат этап «${S.name}» — готов через ${S.hours} ч`, 'good');
    this.sendProfile(s); s.send(this.megaView(s, p)); this.save(true);
  };
  const leviTick = (g, p) => {
    const L = p.mega && p.mega.levi; if (!L || L.done || !L.until || L.until > g.now) return;
    const S = LEVI.stages[L.stage]; L.stage++; L.until = 0;
    const sess = [...g.sessions].find(x => x.player === p);
    if (L.stage >= LEVI.stages.length) {
      L.done = true;
      const y = yardStation(g), ship = g.newShip('imperator', false);
      g.hangar(p, y.id).ships.push(ship);
      p.stats.imperator = 1;
      if (sess) g.notify(sess, `⚜ «Император» спущен на воду! Титан ждёт в ангаре ${y.name}`, 'good');
      for (const s of g.sessions) if (s.player !== p) g.notify(s, `⚜ ${p.name} построил титан «Император»`, 'info');
    } else if (sess) g.notify(sess, `🛠 «Император»: этап «${S.name}» завершён. Следующий — «${LEVI.stages[L.stage].name}»`, 'good');
    g.save(true);
  };

  // ---------- монумент ----------
  P.c_monGive = function (s, m, p) {
    p.mega = p.mega || {};
    const lv = monLv(p); if (lv >= MON.max) return this.notify(s, 'Монумент уже в полной славе', 'warn');
    const c = monCost(lv); if (p.credits < c) return this.notify(s, `Нужно ${fmt(c)} CR`, 'warn');
    p.credits -= c; p.mega.mon = lv + 1; p.mega.monTotal = (p.mega.monTotal || 0) + c;
    this.notify(s, `🗿 Монумент Арктура: уровень ${lv + 1} — ваши доходы +${Math.round((lv + 1) * MON.per * 100)}%`, 'good');
    this.sendProfile(s); s.send(this.megaView(s, p)); this.save();
  };
  // бонус монумента и Столицы к доходам: считаем прирост денег за действие и добавляем процент
  const withBonus = (g, p, fn, extra) => {
    if (!p) return fn();
    const c0 = p.credits, r = fn(), d = p.credits - c0;
    const k = monLv(p) * MON.per + (extra || 0);
    if (d > 0 && k > 0) p.credits += Math.round(d * k);
    return r;
  };
  P.c_sell = function (s, m, p) { if (ITEMS[m.item] && ITEMS[m.item].trade) return baseSell.apply(this, [s, m, p]); return withBonus(this, p, () => baseSell.apply(this, [s, m, p])); }; // товары: бонус даёт c_tradeSell
  P.c_tradeSell = function (s, m, p) { return withBonus(this, p, () => baseTSell.apply(this, [s, m, p])); };
  P.completeMission = function (p) { const a = arguments; return withBonus(this, p, () => baseComplete.apply(this, a)); };
  P.destroyShip = function (t, killer) {
    const ke = killer && this.ents.get(killer.id), kp = ke && ke.owner ? this.db.players[ke.owner] : null;
    const capital = kp && kp.sov && kp.sov.sys === t.sys && SOV.levels[kp.sov.lv].capital && t.npc ? 0.25 : 0;
    const a = arguments;
    return withBonus(this, t.npc ? kp : null, () => baseDestroy.apply(this, a), capital);
  };

  P.slowTick = function () {
    const r = baseSlow.apply(this, arguments);
    if (!this._megaAt || this.now - this._megaAt > 5000) {
      this._megaAt = this.now;
      for (const p of Object.values(this.db.players)) if (p.mega && p.mega.levi) leviTick(this, p);
      // Столица: ополчение выбивает половину пиратов в системе
      if (!this._milAt || this.now - this._milAt > 60000) {
        this._milAt = this.now;
        const caps = new Set(Object.values(this.db.players).filter(x => x.sov && SOV.levels[x.sov.lv].capital).map(x => x.sov.sys));
        const busy = new Set([...this.sessions].filter(x => x.ent).map(x => x.ent.sys)); // в бою при пилоте пиратов не трогаем
        if (caps.size) for (const e of [...this.ents.values()]) if (e.npc && caps.has(e.sys) && !busy.has(e.sys) && e.belt && !e.pbase && !e.wboss && Math.random() < 0.5) { if (this.beltState[e.belt]) this.beltState[e.belt].npcs.delete(e.id); this.removeEntity(e); }
      }
    }
    return r;
  };
};
module.exports.SOV = SOV; module.exports.LEVI = LEVI; module.exports.MON = MON;
