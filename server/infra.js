// Инфраструктура игрока: энергоячейки, солнечные электростанции, транспортный хаб с автоматической логистикой.
// Энергоячейки — базовый ресурс: топливо для прыжков через врата, питание завода, улучшение модулей,
// топливо транспортов. Их продают и покупают все станции, вдали от Ядра — дороже.
'use strict';
const crypto = require('crypto');
const { ITEMS, SHIPS, incomeOf, AU } = require('./data');
const { route, rng } = require('./universe');

const uid = () => crypto.randomBytes(6).toString('hex');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rnd = (a, b) => a + Math.random() * (b - a);
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');


const STAR_POWER = { blue: 2.2, white: 1.5, yellow: 1.0, orange: 0.8, red: 0.6, blackhole: 0.35 };
const INFRA = {
  solar: {
    name: 'Солнечная электростанция', max: 3, buildCost: 900000, buildTime: 30,
    // выработка (ячеек в минуту при жёлтой звезде на средней орбите) и склад
    levels: [null, { rate: 3, cap: 3000, cost: 0 }, { rate: 6, cap: 8000, cost: 1500000 }, { rate: 10.5, cap: 20000, cost: 4000000 }]
  },
  hub: {
    name: 'Транспортный хаб', max: 1, buildCost: 2000000, buildTime: 30,
    levels: [null, { transports: 2, routes: 3, cost: 0 }, { transports: 4, routes: 6, cost: 3000000 }, { transports: 8, routes: 12, cost: 8000000 }]
  },
  transports: {
    mul: { name: 'Транспорт «Мул»', ship: 'tyagach', cap: 4000, perJump: 45, price: 350000, hubLv: 1 },
    vol: { name: 'Тяжёлый транспорт «Вол»', ship: 'kit', cap: 20000, perJump: 70, price: 1500000, hubLv: 2 }
  },
  jumpCells: (shipType) => Math.max(1, Math.ceil((SHIPS[shipType].radius || 40) / 100)),
  refineCellsPer: 40,   // 1 ячейка на 40 единиц руды
  starterCells: 40
};
// фильтры грузов для маршрутов
const ROUTE_ITEMS = {
  energy_cell: 'Энергоячейки', '@mat': 'Все материалы', '@ore': 'Вся руда', '@salv': 'Трофеи', '@mod': 'Модули', '@all': 'Всё, кроме кораблей'
};
const matchItem = (filter, id) => {
  const it = ITEMS[id]; if (!it || it.noSell || it.quest) return false;
  if (filter === '@all') return true;
  if (filter === '@mat') return it.cat === 'Материалы';
  if (filter === '@ore') return it.cat === 'Руда';
  if (filter === '@salv') return it.cat === 'Трофеи';
  if (filter === '@mod') return !!it.module;
  return id === filter;
};

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseJump = P.jump, basePriceOf = P.priceOf, baseBuyPriceOf = P.buyPriceOf, baseBuy = P.c_buy, baseRefine = P.c_refine,
    baseNewPlayer = P.newPlayer, baseLogin = P.login, baseAttach = P.attachStructure, baseDestroy = P.destroyShip;
  // сбитый пиратами (или игроком) транспорт теряет груз
  P.destroyShip = function (t, killer) {
    if (t.transportOf) (this.transportShot || (this.transportShot = new Set())).add(t.transportOf);
    return baseDestroy.call(this, t, killer);
  };

  // ---------- энергоячейки в экономике ----------
  // цена ячеек: вдали от Ядра дороже, но умеренно; массовые продажи насыщают рынок станции (восстанавливается со временем)
  const regionK = (st) => 1 + 0.3 * (incomeOf(this_sys(st)) - 1);
  let this_sys = null;
  P.cellGlut = function (st) {
    const g = this.cellSold || (this.cellSold = {}), r = g[st];
    if (!r) return 0;
    r.v *= Math.pow(0.5, (this.now - r.t) / (20 * 60000)); r.t = this.now; // половина «насыщения» уходит за 20 мин
    return r.v;
  };
  P.priceOf = function (st, item) {
    if (item !== 'energy_cell') return basePriceOf.call(this, st, item);
    this_sys = (id) => this.U.celestials[id].sys;
    return Math.round(ITEMS.energy_cell.base * regionK(st) * ((this.prices[st] || {})[item] || 1) / (1 + this.cellGlut(st) / 1500));
  };
  P.buyPriceOf = function (st, item) {
    if (item !== 'energy_cell') return baseBuyPriceOf.call(this, st, item);
    this_sys = (id) => this.U.celestials[id].sys;
    return Math.round(ITEMS.energy_cell.base * 1.15 * regionK(st));
  };
  const baseSell = P.c_sell;
  P.c_sell = function (s, m, p) {
    const before = (this.hangar(p, s.docked || p.home).items.energy_cell) || 0;
    baseSell.call(this, s, m, p);
    if (m.item === 'energy_cell' && s.docked) {
      const sold = before - ((this.hangar(p, s.docked).items.energy_cell) || 0);
      if (sold > 0) { this.cellGlut(s.docked); const g = this.cellSold[s.docked] || (this.cellSold[s.docked] = { v: 0, t: this.now }); g.v += sold; }
    }
  };
  // расходники (энергоячейки, ракеты, торпеды, турели) продаются поштучно на любой станции
  P.c_buy = function (s, m, p) {
    if (!ITEMS[m.item] || !ITEMS[m.item].consumable) return baseBuy.call(this, s, m, p);
    const st = this.requireDocked(s); if (!st) return;
    const qty = Math.max(1, Math.min(100000, Math.floor(+m.qty) || 1));
    const cost = this.buyPriceOf(st, m.item) * qty;
    if (p.credits < cost) return this.notify(s, 'Недостаточно ISK', 'warn');
    p.credits -= cost;
    // сразу в трюм, если влезает, иначе в ангар
    const stats = this.calcStats(p, p.ship), free = stats.cargo - this.cargoUsed(p.ship.cargo);
    const toCargo = Math.min(qty, Math.floor(free / ITEMS[m.item].vol + 1e-9));
    if (toCargo) p.ship.cargo[m.item] = (p.ship.cargo[m.item] || 0) + toCargo;
    if (qty > toCargo) { const h = this.hangar(p, st); h.items[m.item] = (h.items[m.item] || 0) + qty - toCargo; }
    this.notify(s, `Куплено: ${ITEMS[m.item].name} ×${fmt(qty)} за ${fmt(cost)} ISK${toCargo === qty ? ' (в трюме)' : toCargo ? ` (${fmt(toCargo)} в трюме, остальное в ангаре)` : ' (в ангаре)'}`, 'good');
    this.sendProfile(s); this.c_market(s, m, p);
  };

  // стартовый запас ячеек — новым и уже существующим пилотам
  P.newPlayer = function (name, pass) {
    const p = baseNewPlayer.call(this, name, pass);
    p.ship.cargo.energy_cell = INFRA.starterCells; p.cellGift = true;
    return p;
  };
  P.login = function (sess, name, pass) {
    baseLogin.call(this, sess, name, pass);
    const p = sess.player;
    if (p && !p.cellGift) {
      p.cellGift = true;
      const h = this.hangar(p, p.home); h.items.energy_cell = (h.items.energy_cell || 0) + INFRA.starterCells;
      this.notify(sess, `Энергоячейки теперь нужны для прыжков, завода и улучшений. ${INFRA.starterCells} шт. ждут вас в ангаре домашней станции.`, 'info');
      this.sendProfile(sess);
    }
  };

  // прыжок через врата расходует ячейки из трюма; без них — аварийный прыжок
  P.jump = function (e, gate) {
    if (e.owner && e.session) {
      const p = e.session.player, need = INFRA.jumpCells(e.shipType), have = p.ship.cargo.energy_cell || 0;
      if (have >= need) {
        p.ship.cargo.energy_cell = have - need; if (!p.ship.cargo.energy_cell) delete p.ship.cargo.energy_cell;
        if (p.ship.cargo.energy_cell && p.ship.cargo.energy_cell <= need * 3) this.notify(e.session, `Энергоячеек осталось: ${p.ship.cargo.energy_cell}. Пополните запас на станции.`, 'warn');
      } else {
        e.shield = 0; e.cap = 0;
        this.notify(e.session, `Нет энергоячеек (нужно ${need}) — аварийный прыжок: щит и накопитель обнулены!`, 'bad');
      }
      if (e.session) this.sendProfile(e.session);
    }
    return baseJump.call(this, e, gate);
  };

  // завод потребляет ячейки из ангара своей станции
  P.c_refine = function (s, m, p) {
    const st = this.myStructure(p);
    const qty = Math.floor(+m.qty) || 0;
    if (st && s.docked === st.id && qty > 0) {
      const h = this.hangar(p, st.id), need = Math.max(1, Math.ceil(Math.min(qty, h.items[m.item] || 0) / INFRA.refineCellsPer));
      if ((h.items.energy_cell || 0) < need) return this.notify(s, `Заводу нужно ${need} энергоячеек в ангаре станции (есть ${h.items.energy_cell || 0}). Купите их на рынке или привезите со своей электростанции.`, 'warn');
      const before = st.jobs.length;
      baseRefine.call(this, s, m, p);
      if (st.jobs.length > before) { h.items.energy_cell -= need; if (!h.items.energy_cell) delete h.items.energy_cell; this.sendProfile(s); }
      return;
    }
    return baseRefine.call(this, s, m, p);
  };

  // ---------- постройки ----------
  P.infraOf = function (p, type) { return (this.db.structures || []).filter(x => x.owner === p.name && x.type === type); };
  P.attachStructure = function (st) {
    const c = baseAttach.call(this, st);
    if (c && st.type === 'solar') c.style = 4;
    if (c && st.type === 'hub') c.style = 5;
    return c;
  };
  // освещённость точки: вклад обеих звёзд двойной системы (сила звезды × близость)
  P.starLight = function (sysId, pos) {
    let k = 0;
    for (const c of this.U.systems[sysId].celestials) {
      if (c.kind !== 'sun') continue;
      const d = dist(pos, c.pos) / AU;
      k += (STAR_POWER[c.star] || 1) * (d < 1 ? 1.5 : d < 3 ? 1.0 : d < 6 ? 0.6 : 0.15);
    }
    return k;
  };
  P.solarRate = function (st) {
    return INFRA.solar.levels[st.level].rate * this.starLight(st.sys, st.pos); // ячеек в минуту
  };

  P.c_buildInfra = function (s, m, p, e) {
    const type = m.kind, cfg = INFRA[type];
    if (!cfg || !cfg.levels) return;
    if (!e || e.warp) return this.notify(s, 'Строить можно только в космосе', 'warn');
    if (this.infraOf(p, type).length >= cfg.max) return this.notify(s, `Не больше ${cfg.max}: ${cfg.name}`, 'warn');
    if (type === 'hub' && this.U.byId[e.sys].sec >= 1.0) return this.notify(s, 'В столичных системах (1.0) хаб строить нельзя', 'warn');
    if (p.credits < cfg.buildCost) return this.notify(s, `Нужно ${fmt(cfg.buildCost)} ISK`, 'warn');
    for (const c of this.U.systems[e.sys].celestials) {
      const minD = c.kind === 'sun' ? 0.25 * AU : 200000;
      if (dist(c.pos, e.pos) - (c.radius || 0) < minD) return this.notify(s, c.kind === 'sun' ? 'Слишком близко к звезде — станцию расплавит. Отлетите дальше 0.25 а.е.' : `Слишком близко к «${c.name}». Отлетите дальше 200 км.`, 'warn');
    }
    p.credits -= cfg.buildCost;
    const n = this.infraOf(p, type).length + 1;
    const st = { id: 'ps_' + uid(), type, owner: p.name, name: type === 'solar' ? `Солнечная станция «${p.name}»${n > 1 ? ' ' + n : ''}` : type === 'defense' ? `Оборонная платформа «${p.name}»${n > 1 ? ' ' + n : ''}` : `Транспортный хаб «${p.name}»`,
      sys: e.sys, pos: e.pos.map(x => x + rnd(-1, 1) * 4000), level: 1, jobs: [], buildUntil: this.now + cfg.buildTime * 1000, created: this.now };
    if (type === 'solar') { st.acc = 0; st.produced = 0; }
    if (type === 'hub') { st.transports = []; st.routes = []; }
    this.db.structures.push(st);
    this.attachStructure(st);
    this.fxSys(e.sys, st.pos, { k: 'jump', pos: st.pos });
    this.notify(s, `Строительство началось: ${cfg.name}. Готово через ${cfg.buildTime} с.`, 'good');
    for (const o of this.sessions) {
      o.send({ t: 'stationAdd', station: { id: st.id, name: st.name, sys: st.sys, owner: st.owner } });
      if (this.playerSys(o.player) === e.sys && !o.docked) this.sendSystem(o);
    }
    this.broadcastSys(e.sys, { t: 'chat', ch: 'local', from: '*', text: `${p.name} строит: ${cfg.name}` });
    this.sendProfile(s); this.c_infraInfo(s, m, p); this.save(true);
  };

  P.c_infraUpgrade = function (s, m, p) {
    const st = (this.db.structures || []).find(x => x.id === m.id && x.owner === p.name);
    if (!st || !INFRA[st.type]) return;
    const next = INFRA[st.type].levels[st.level + 1];
    if (!next) return this.notify(s, 'Максимальный уровень', 'warn');
    if (p.credits < next.cost) return this.notify(s, `Нужно ${fmt(next.cost)} ISK`, 'warn');
    p.credits -= next.cost; st.level++;
    this.notify(s, `${st.name}: уровень ${st.level}`, 'good');
    this.sendProfile(s); this.c_infraInfo(s, m, p); this.save(true);
  };

  // ---------- транспорты и маршруты ----------
  P.c_buyTransport = function (s, m, p) {
    const hub = this.infraOf(p, 'hub')[0], T = INFRA.transports[m.kind];
    if (!hub || !T) return this.notify(s, 'Сначала постройте транспортный хаб', 'warn');
    if (hub.buildUntil > this.now) return this.notify(s, 'Хаб ещё строится', 'warn');
    if (hub.level < T.hubLv) return this.notify(s, `Нужен хаб уровня ${T.hubLv}`, 'warn');
    if (hub.transports.length >= INFRA.hub.levels[hub.level].transports) return this.notify(s, 'Все места в хабе заняты — улучшите хаб', 'warn');
    if (p.credits < T.price) return this.notify(s, `Нужно ${fmt(T.price)} ISK`, 'warn');
    p.credits -= T.price;
    hub.transports.push({ id: 'tr_' + uid(), kind: m.kind, name: `${T.name} №${hub.transports.length + 1}`, at: hub.id, state: 'idle', cargo: {}, trips: 0, delivered: 0 });
    this.notify(s, `Куплен ${T.name}. Задайте маршрут — и он начнёт возить грузы сам.`, 'good');
    this.sendProfile(s); this.c_infraInfo(s, m, p); this.save(true);
  };
  P.c_addRoute = function (s, m, p) {
    const hub = this.infraOf(p, 'hub')[0];
    if (!hub) return this.notify(s, 'Сначала постройте транспортный хаб', 'warn');
    const ok = (id) => this.U.celestials[id] && this.U.celestials[id].kind === 'station';
    if (!ok(m.from) || !ok(m.to) || m.from === m.to) return this.notify(s, 'Выберите две разные станции', 'warn');
    if (!(m.item in ROUTE_ITEMS) && !ITEMS[m.item]) return;
    if (!route(this.U.neighbors, this.U.celestials[m.from].sys, this.U.celestials[m.to].sys)) return this.notify(s, 'Между станциями нет пути', 'warn');
    if (hub.routes.length >= INFRA.hub.levels[hub.level].routes) return this.notify(s, 'Лимит маршрутов — улучшите хаб', 'warn');
    hub.routes.push({ id: 'rt_' + uid(), from: m.from, to: m.to, item: m.item, keep: Math.max(0, Math.floor(+m.keep) || 0), on: true, moved: 0 });
    this.notify(s, 'Маршрут добавлен', 'good');
    this.c_infraInfo(s, m, p); this.save(true);
  };
  P.c_routeCmd = function (s, m, p) {
    const hub = this.infraOf(p, 'hub')[0]; if (!hub) return;
    const r = hub.routes.find(x => x.id === m.id); if (!r) return;
    if (m.cmd === 'del') hub.routes = hub.routes.filter(x => x !== r);
    if (m.cmd === 'toggle') r.on = !r.on;
    this.c_infraInfo(s, m, p); this.save(true);
  };

  // путь транспорта и его длительность
  P.tripPlan = function (from, to, kind) {
    const a = this.U.celestials[from].sys, b = this.U.celestials[to].sys;
    const path = route(this.U.neighbors, a, b) || [a];
    return { path, dur: (30 + (path.length - 1) * INFRA.transports[kind].perJump) * 1000 };
  };
  P.startLeg = function (t, to, loaded) {
    const plan = this.tripPlan(t.at, to, t.kind);
    Object.assign(t, { state: loaded ? 'hauling' : 'moving', from: t.at, to, path: plan.path, start: this.now, end: this.now + plan.dur });
  };

  // раз в секунду: выработка электростанций и работа транспортов (идут и без игрока в сети)
  P.infraTick = function () {
    for (const st of this.db.structures || []) {
      if (st.buildUntil && st.buildUntil > this.now) continue;
      const p = this.db.players[st.owner];
      if (!p) continue;
      if (st.type === 'solar') {
        const h = this.hangar(p, st.id), cap = INFRA.solar.levels[st.level].cap;
        st.acc = (st.acc || 0) + this.solarRate(st) / 60;
        const n = Math.floor(st.acc);
        if (n > 0) { st.acc -= n; const room = Math.max(0, cap - (h.items.energy_cell || 0)); const put = Math.min(n, room); if (put) { h.items.energy_cell = (h.items.energy_cell || 0) + put; st.produced = (st.produced || 0) + put; } }
      } else if (st.type === 'hub') this.hubTick(st, p);
    }
  };

  P.hubTick = function (hub, p) {
    const say = (text, kind) => { for (const s of this.sessions) if (s.player === p) this.notify(s, text, kind || 'info'); };
    for (const t of hub.transports) {
      if (t.state === 'repair') { if (this.now >= t.end) { t.state = 'idle'; say(`${t.name} отремонтирован и снова в строю`, 'good'); } continue; }
      if (t.state === 'moving' || t.state === 'hauling') {
        this.transportVisual(hub, t, p);
        if (this.now < t.end) continue;
        this.removeTransportVisual(t);
        t.at = t.to;
        if (t.state === 'hauling') {
          // нападение пиратов по пути: в опасных системах есть шанс потерять часть груза
          const risky = t.path.filter(sys => this.U.byId[sys].sec < 0.5).length;
          if (risky && Math.random() < 0.04 * risky) {
            for (const k of Object.keys(t.cargo)) { t.cargo[k] = Math.floor(t.cargo[k] * 0.7); if (!t.cargo[k]) delete t.cargo[k]; }
            say(`${t.name}: пираты перехватили часть груза в опасной системе (−30%)`, 'bad');
          }
          const h = this.hangar(p, t.to);
          let units = 0;
          for (const [k, v] of Object.entries(t.cargo)) { h.items[k] = (h.items[k] || 0) + v; units += v; }
          t.cargo = {}; t.trips++; t.delivered += units;
          const r = hub.routes.find(x => x.id === t.route); if (r) r.moved = (r.moved || 0) + units;
          if (units && this.now - (hub.lastSay || 0) > 30000) { hub.lastSay = this.now; say(`${t.name} доставил ${fmt(units)} ед. на «${this.U.celestials[t.to].name}»`, 'good'); }
          for (const s of this.sessions) if (s.player === p && s.docked === t.to) this.sendProfile(s);
        }
        t.state = 'idle';
        continue;
      }
      // свободный транспорт берёт следующий маршрут, где есть что везти
      if (t.state !== 'idle') continue;
      const routes = hub.routes.filter(r => r.on);
      if (!routes.length) continue;
      hub.rr = (hub.rr || 0) + 1;
      for (let i = 0; i < routes.length; i++) {
        const r = routes[(hub.rr + i) % routes.length];
        if (hub.transports.some(o => o !== t && o.route === r.id && o.state !== 'idle' && o.state !== 'repair')) continue; // один маршрут — один транспорт за раз
        const h = this.hangar(p, r.from);
        const avail = Object.entries(h.items).filter(([k, v]) => v > 0 && matchItem(r.item, k)).map(([k, v]) => [k, k === 'energy_cell' ? Math.max(0, v - r.keep) : v]).filter(([, v]) => v > 0);
        if (!avail.length) continue;
        if (t.at !== r.from) { t.route = r.id; this.startLeg(t, r.from, false); break; }
        // топливо: 1 + число прыжков ячеек из ангара станции отправки (или хаба)
        const plan = this.tripPlan(r.from, r.to, t.kind), fuel = 1 + plan.path.length - 1;
        const src = (h.items.energy_cell || 0) >= fuel ? h : this.hangar(p, hub.id);
        if ((src.items.energy_cell || 0) < fuel) { if (this.now - (t.warnAt || 0) > 120000) { t.warnAt = this.now; say(`${t.name}: нет энергоячеек на топливо (нужно ${fuel}) на «${this.U.celestials[r.from].name}» или в хабе`, 'warn'); } continue; }
        src.items.energy_cell -= fuel; if (!src.items.energy_cell) delete src.items.energy_cell;
        let room = INFRA.transports[t.kind].cap;
        for (const [k] of avail) {
          let have = h.items[k] || 0; if (k === 'energy_cell') have = Math.max(0, have - r.keep);
          const n = Math.min(have, Math.floor(room / ITEMS[k].vol));
          if (n <= 0) continue;
          h.items[k] -= n; if (!h.items[k]) delete h.items[k];
          t.cargo[k] = (t.cargo[k] || 0) + n; room -= n * ITEMS[k].vol;
          if (room < 1) break;
        }
        if (!Object.keys(t.cargo).length) continue;
        t.route = r.id; this.startLeg(t, r.to, true);
        break;
      }
    }
  };

  // транспорт виден в системе, через которую сейчас летит, — если там есть игроки; его можно сбить
  P.transportVisual = function (hub, t, p) {
    const k = Math.min(0.999, (this.now - t.start) / (t.end - t.start));
    const sysId = t.path[Math.min(t.path.length - 1, Math.floor(k * t.path.length))];
    let v = t.visId && this.ents.get(t.visId);
    if (t.visId && !v) {
      t.visId = null;
      if (!this.transportShot || !this.transportShot.delete(t.id)) return; // просто исчез из мира — появится снова
      // сбит — груз потерян, транспорт на ремонте
      const lost = Object.values(t.cargo).reduce((a, b) => a + b, 0);
      t.cargo = {}; t.state = 'repair'; t.end = this.now + 120000;
      for (const s of this.sessions) if (s.player === p) this.notify(s, `${t.name} сбит в системе ${this.U.byId[sysId].name}! Потеряно груза: ${fmt(lost)} ед. Ремонт 2 мин.`, 'bad');
      return;
    }
    if (v && v.sys !== sysId) { this.removeTransportVisual(t); v = null; }
    if (v) return;
    if (![...this.sessions].some(s => s.ent && s.ent.sys === sysId)) return;
    const sys = this.U.systems[sysId], idx = t.path.indexOf(sysId), nextSys = t.path[idx + 1];
    const gateTo = nextSys && sys.gates.find(g => g.dest === nextSys);
    const fromSt = this.U.celestials[t.from];
    const start = idx === 0 && fromSt ? add(fromSt.pos, [rnd(-5000, 5000), 0, rnd(-5000, 5000)]) : (sys.gates.find(g => g.dest === t.path[idx - 1]) || sys.gates[0]).pos;
    const goal = gateTo ? gateTo.pos : (this.U.celestials[t.to] || {}).pos || [0, 0, 0];
    const e = this.spawnCiv(sysId, { role: 'trader', shipType: INFRA.transports[t.kind].ship, name: `${t.name} (${p.name})` });
    e.pos = add(start, [rnd(-3000, 3000), rnd(-500, 500), rnd(-3000, 3000)]);
    e.storyHold = true; e.escortDir = norm(sub(goal, e.pos)); e.speedFrac = 0.5; e.transportOf = t.id;
    t.visId = e.id;
  };
  P.removeTransportVisual = function (t) {
    const v = t.visId && this.ents.get(t.visId);
    t.visId = null;
    if (v) this.removeEntity(v);
  };

  // ---------- информация для окна «Стройка» ----------
  P.c_infraInfo = function (s, m, p) {
    const view = (st) => ({ id: st.id, type: st.type, name: st.name, sys: st.sys, level: st.level, building: st.buildUntil > this.now ? st.buildUntil : 0 });
    const solars = this.infraOf(p, 'solar').map(st => {
      const sun = this.U.systems[st.sys].celestials[0];
      const sun2 = this.U.systems[st.sys].celestials.find(c => c.kind === 'sun' && c.companion);
      return { ...view(st), rate: Math.round(this.solarRate(st) * 10) / 10, star: sun.star, au: Math.round(dist(st.pos, sun.pos) / AU * 10) / 10,
        star2: sun2 && sun2.star, au2: sun2 && Math.round(dist(st.pos, sun2.pos) / AU * 10) / 10,
        stored: this.hangar(p, st.id).items.energy_cell || 0, cap: INFRA.solar.levels[st.level].cap, produced: st.produced || 0 };
    });
    const hubSt = this.infraOf(p, 'hub')[0];
    const hub = hubSt && { ...view(hubSt), cells: this.hangar(p, hubSt.id).items.energy_cell || 0,
      transports: hubSt.transports.map(t => ({ id: t.id, name: t.name, kind: t.kind, state: t.state, at: t.at, to: t.to, start: t.start, end: t.end, route: t.route,
        cargo: Object.values(t.cargo).reduce((a, b) => a + b, 0), trips: t.trips, delivered: t.delivered,
        where: t.state === 'moving' || t.state === 'hauling' ? t.path[Math.min(t.path.length - 1, Math.floor(Math.min(0.999, (this.now - t.start) / (t.end - t.start)) * t.path.length))] : (this.U.celestials[t.at] || {}).sys })),
      routes: hubSt.routes };
    // станции для маршрутов: свои постройки, дом и все, где есть имущество
    const ids = new Set([p.home, ...(this.db.structures || []).filter(x => x.owner === p.name).map(x => x.id), ...Object.entries(p.hangars).filter(([, h]) => Object.keys(h.items).length).map(([id]) => id)]);
    const stations = [...ids].filter(id => this.U.celestials[id]).map(id => ({ id, name: this.U.celestials[id].name, sys: this.U.celestials[id].sys }));
    const sys = s.ent ? this.U.systems[s.ent.sys] : null;
    const suns = sys ? sys.celestials.filter(c => c.kind === 'sun') : [];
    const here = s.ent && sys ? { sys: sys.id, suns: suns.map(c => ({ star: c.star, au: Math.round(dist(s.ent.pos, c.pos) / AU * 10) / 10 })),
      rate: Math.round(INFRA.solar.levels[1].rate * this.starLight(sys.id, s.ent.pos) * 10) / 10 } : null;
    const defenses = this.infraOf(p, 'defense').map(st => ({ ...view(st), raid: !!st.raid }));
    const raids = (this.db.structures || []).filter(x => x.owner === p.name && x.raid).map(x => ({ id: x.id, name: x.name, sys: x.sys, left: Math.max(0, x.raid.start + 90000 - this.now) }));
    s.send({ t: 'infra', defenses, raids, cfg: { defense: INFRA.defense, solar: INFRA.solar, hub: INFRA.hub, transports: INFRA.transports, starPower: STAR_POWER, routeItems: ROUTE_ITEMS, jumpCells: INFRA.jumpCells(p.ship.type) },
      solars, hub, stations, here, now: this.now });
  };
};
module.exports.INFRA = INFRA;
