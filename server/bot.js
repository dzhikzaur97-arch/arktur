// Самообучающиеся ИИ-пилоты («ученики»).
// Бот — полноценный пилот: входит в игру как игрок и действует теми же командами, что и человек
// (варп, стыковка, захват, модули, рынок, стройка). Знает только то, что видит в своей системе.
//
// Обучение — обучение с подкреплением на уровне «занятий» (options):
//   состояние  = класс корабля (шахтёр / боец / универсал) × уровень капитала;
//   действия   = копать руду, охотиться на пиратов, возить энергоячейки, улучшить модуль, купить корабль, построить электростанцию;
//   награда    = рост капитала (CR + корабли + модули + склады) в минуту; гибель корабля — штраф;
//   обновление = Q ← Q + α·(r − Q), выбор ε-жадный, ε убывает с опытом;
//   вложения (улучшения, корабли, станции) оцениваются отложенно: по изменению дохода в следующих трёх занятиях;
//   внутри занятий — свои «бандиты»: в каких системах копать, где охотиться, куда везти ячейки.
// Весь опыт хранится в базе (db.bots) и накапливается между запусками сервера.
'use strict';
const crypto = require('crypto');
const { SHIPS, MODULES, ITEMS, SKILLS, NPCS, REGIONS, incomeOf, upgradeCost } = require('./data');
const { route } = require('./universe');
const { INFRA } = require('./infra');

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');

const BOT_NAMES = ['Нейро-1', 'Нейро-2', 'Нейро-3', 'Нейро-4', 'Нейро-5', 'Нейро-6'];
const ACTIONS = {
  mine:   { name: 'Копать руду', work: true },
  hunt:   { name: 'Охота на пиратов', work: true },
  trade:  { name: 'Возить энергоячейки', work: true },
  upgrade:{ name: 'Улучшить модуль', invest: true },
  ship:   { name: 'Купить корабль', invest: true },
  solar:  { name: 'Построить электростанцию', invest: true }
};
const BANDS = {
  mine: { hi: [0.8, 1.01], mid: [0.5, 0.8], low: [0.05, 0.5] },
  hunt: { calm: [0.5, 0.8], edge: [0.3, 0.5], wild: [0.0, 0.3] },
  trade: { border: 'border', low: 'low', null: 'null' }
};
const LADDER = {
  miner: ['iskra', 'staratel', 'burlak', 'leviafan', 'begemot'],
  fighter: ['klinok', 'vihr', 'gadyuka', 'strazh', 'burya', 'molot', 'citadel', 'bastion']
};
const SKILL_PLAN = {
  miner: ['mining', 'mining', 'trade', 'navigation', 'mining', 'engineering', 'trade', 'mining', 'shields', 'engineering', 'mining'],
  fighter: ['gunnery', 'shields', 'gunnery', 'targeting', 'navigation', 'gunnery', 'shields', 'drones', 'gunnery', 'armor', 'shields', 'gunnery']
};
const ALPHA = 0.25, EPISODE_MAX = { mine: 12 * 60000, hunt: 9 * 60000, trade: 14 * 60000, upgrade: 60000, ship: 3 * 60000, solar: 8 * 60000 };

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseBroadcast = P.broadcastState;

  // боты не получают пакеты состояния — они читают мир напрямую (только свою систему)
  P.broadcastState = function () {
    const bots = [...this.sessions].filter(s => s.isBot);
    for (const s of bots) this.sessions.delete(s);
    try { baseBroadcast.call(this); } finally { for (const s of bots) this.sessions.add(s); }
  };

  P.initBots = function () {
    const n = Math.max(0, Math.min(BOT_NAMES.length, +(typeof process !== 'undefined' && process.env && process.env.VF_BOTS) || 2));
    if (!this.db.bots) this.db.bots = {};
    this.bots = [];
    for (let i = 0; i < n; i++) {
      const name = BOT_NAMES[i];
      const mem = this.db.bots[name] || (this.db.bots[name] = { pass: crypto.randomBytes(8).toString('hex'), Q: {}, sub: {}, episodes: 0, history: [], log: [], worth: [] });
      const bot = { name, mem, sess: null, opt: null, nextStep: this.now + 3000 + i * 1500, inbox: [] };
      this.bots.push(bot);
    }
  };

  P.botLogin = function (bot) {
    const sess = { isBot: true, bot, player: null, ent: null, docked: null, send: (m) => { if (m.t === 'note' || m.t === 'destroyed') { bot.inbox.push(m); if (bot.inbox.length > 30) bot.inbox.shift(); } } };
    this.login(sess, bot.name, bot.mem.pass);
    if (!sess.player) return;
    sess.player.bot = true;
    bot.sess = sess;
    this.botLog(bot, 'Вышел на связь. Опыт: ' + bot.mem.episodes + ' занятий');
  };

  P.botTick = function () {
    if (!this.bots) return;
    for (const bot of this.bots) {
      if (this.now < bot.nextStep) continue;
      bot.nextStep = this.now + 1000;
      try {
        if (!bot.sess || !this.sessions.has(bot.sess)) { this.botLogin(bot); continue; }
        this.botStep(bot);
      } catch (err) { this.botLog(bot, 'Сбой логики: ' + err.message); bot.opt = null; }
    }
  };

  // ---------- память и отчёты ----------
  P.botLog = function (bot, text) {
    bot.mem.log.unshift({ t: this.now, text }); if (bot.mem.log.length > 40) bot.mem.log.length = 40;
  };
  P.botWorth = function (p) {
    let w = p.credits + (SHIPS[p.ship.type].price || 0);
    const val = (items) => { let v = 0; for (const [k, q] of Object.entries(items || {})) if (ITEMS[k]) v += (ITEMS[k].base || 0) * q * (ITEMS[k].resale || 1); return v; };
    for (const m of p.ship.fit) if (m) w += MODULES[m].price * 0.5;
    w += val(p.ship.cargo);
    for (const h of Object.values(p.hangars)) { w += val(h.items); for (const sh of h.ships) w += SHIPS[sh.type].price * 0.8; }
    for (const st of this.db.structures || []) if (st.owner === p.name) w += (INFRA[st.type] || { buildCost: 1500000 }).buildCost * 0.7;
    return w;
  };
  P.botRole = function (p) {
    const fit = p.ship.fit.filter(Boolean).map(m => MODULES[m].kind);
    const mining = fit.includes('miner') || SHIPS[p.ship.type].foundry || ((SHIPS[p.ship.type].bonus || {}).mining > 0);
    const combat = fit.includes('weapon') || fit.includes('launcher');
    return mining && !combat ? 'miner' : combat && !mining ? 'fighter' : 'mixed';
  };
  P.botState = function (p) {
    const w = this.botWorth(p);
    const tier = w < 150000 ? 0 : w < 1500000 ? 1 : w < 10000000 ? 2 : 3;
    return `${this.botRole(p)}|${tier}`;
  };
  const qOf = (mem, st, a) => ((mem.Q[st] || (mem.Q[st] = {}))[a] || (mem.Q[st][a] = { q: 0, n: 0 }));
  const learn = (cell, r) => { cell.n++; cell.q += (cell.n === 1 ? 1 : ALPHA) * (r - cell.q); };
  P.botEpsilon = function (bot) { return Math.max(0.06, 0.6 / Math.sqrt(1 + bot.mem.episodes / 4)); };

  // какие действия сейчас вообще возможны
  P.botUpgradeTotal = function (c) {
    let v = c.isk;
    for (const [it, q] of Object.entries(c.mats)) v += q * ITEMS[it].base * 1.5;
    return v;
  };
  P.botFeasible = function (bot) {
    const p = bot.sess.player, out = ['mine', 'hunt'];
    if (p.credits > 60000) out.push('trade');
    const up = p.ship.fit.map(id => id && upgradeCost(id)).filter(Boolean);
    if (up.some(c => this.botUpgradeTotal(c) < p.credits * 0.35)) out.push('upgrade');
    if (this.botNextShip(p)) out.push('ship');
    if (p.credits > INFRA.solar.buildCost * 2.2 && this.infraOf(p, 'solar').length < INFRA.solar.max) out.push('solar');
    return out;
  };
  // выбор занятия: ε-жадно по Q, неопробованные — в приоритете
  P.botChoose = function (bot) {
    const p = bot.sess.player, st = this.botState(p), feas = this.botFeasible(bot);
    const eps = this.botEpsilon(bot);
    const untried = feas.filter(a => qOf(bot.mem, st, a).n === 0 && ACTIONS[a].work);
    let a;
    if (untried.length) a = pick(untried);
    else if (Math.random() < eps) a = pick(feas);
    else a = feas.reduce((b, x) => qOf(bot.mem, st, x).q > qOf(bot.mem, st, b).q ? x : b, feas[0]);
    return { a, st, explore: untried.includes(a) || false };
  };
  P.botSubChoose = function (bot, kind) {
    const sub = bot.mem.sub[kind] || (bot.mem.sub[kind] = {});
    const keys = Object.keys(BANDS[kind]);
    for (const k of keys) if (!sub[k]) sub[k] = { q: 0, n: 0 };
    const untried = keys.filter(k => sub[k].n === 0);
    if (untried.length) return pick(untried);
    if (Math.random() < this.botEpsilon(bot)) return pick(keys);
    return keys.reduce((b, k) => sub[k].q > sub[b].q ? k : b, keys[0]);
  };

  // ---------- главный цикл бота ----------
  P.botStep = function (bot) {
    const s = bot.sess, p = s.player;
    // навыки учатся всегда
    if (!p.training) {
      const plan = SKILL_PLAN[this.botRole(p) === 'miner' ? 'miner' : 'fighter'];
      const next = plan.find(sk => (p.skills[sk] || 0) < 5 && plan.filter(x => x === sk).length > (p.skills[sk] || 0)) || plan.find(sk => (p.skills[sk] || 0) < 5);
      if (next) this.handle(s, { t: 'train', skill: next });
    }
    // гибель корабля
    const dead = bot.inbox.find(m => m.t === 'destroyed');
    if (dead) { bot.inbox = []; if (bot.opt) { bot.opt.died = true; this.botLog(bot, `Корабль уничтожен (${dead.killer}). Вывод: здесь слишком опасно.`); this.botFinish(bot, true); } return; }
    if (!bot.opt) {
      const c = this.botChoose(bot);
      bot.opt = { a: c.a, st: c.st, phase: 'start', t0: this.now, w0: this.botWorth(p), lastProgress: this.now, mark: '', data: {} };
      this.botLog(bot, `${c.explore ? 'Пробую новое' : 'Решение'}: ${ACTIONS[c.a].name} (Q=${Math.round(qOf(bot.mem, c.st, c.a).q)})`);
    }
    const o = bot.opt;
    // сторож застревания: нет прогресса 150 с — возвращаемся на станцию, при повторе — аварийная коррекция
    const mark = `${o.phase}|${s.docked || ''}|${s.ent ? s.ent.sys + Math.round((s.ent.pos[0] + s.ent.pos[2]) / 5000) : ''}|${Object.values(p.ship.cargo).reduce((a, b) => a + b, 0)}`;
    if (mark !== o.mark) { o.mark = mark; o.lastProgress = this.now; }
    if (this.now - o.lastProgress > 150000) {
      o.stuck = (o.stuck || 0) + 1;
      this.botLog(bot, `Застрял (этап «${o.phase}») — ${o.stuck > 1 ? 'аварийная коррекция: возврат домой' : 'возвращаюсь на станцию'}`);
      if (o.stuck > 1 && s.ent) { this.removeEntity(s.ent); s.ent = null; this.enterStation(s, p.home, true); }
      o.lastProgress = this.now; o.phase = 'return';
    }
    if (this.now - o.t0 > EPISODE_MAX[o.a] && o.phase !== 'return' && o.phase !== 'sell') o.phase = 'return';
    this['bot_' + o.a](bot, o, s, p);
  };

  // завершение занятия: расчёт награды и обучение
  P.botFinish = function (bot, died) {
    const o = bot.opt, p = bot.sess.player;
    bot.opt = null;
    if (!o) return;
    const mins = Math.max(1, (this.now - o.t0) / 60000);
    const dw = this.botWorth(p) - o.w0;
    let r = dw / mins;
    if (died) r -= 30000;                         // риск гибели — отдельный штраф
    const mem = bot.mem;
    mem.episodes++;
    if (ACTIONS[o.a].work) {
      learn(qOf(mem, o.st, o.a), r);
      if (o.band) { const sb = (mem.sub[o.a] || (mem.sub[o.a] = {}))[o.band] || (mem.sub[o.a][o.band] = { q: 0, n: 0 }); learn(sb, r); }
      // отложенная оценка вложений: доход после покупки против дохода до
      for (const pend of mem.pending || []) { pend.after.push(r); }
      for (const pend of [...(mem.pending || [])]) {
        if (pend.after.length < 3) continue;
        const gain = pend.after.reduce((a, b) => a + b, 0) / pend.after.length - pend.before;
        learn(qOf(mem, pend.st, pend.a), gain);
        this.botLog(bot, `Оценка вложения «${ACTIONS[pend.a].name}»: доход ${gain >= 0 ? 'вырос' : 'упал'} на ${fmt(Math.abs(gain))} CR/мин`);
        mem.pending = mem.pending.filter(x => x !== pend);
      }
    } else if (!o.failed) {
      const recent = mem.history.filter(h => ACTIONS[h.a].work).slice(0, 3);
      const before = recent.length ? recent.reduce((a, h) => a + h.r, 0) / recent.length : 0;
      (mem.pending || (mem.pending = [])).push({ a: o.a, st: o.st, before, after: [] });
    }
    mem.history.unshift({ t: this.now, a: o.a, r: Math.round(r), mins: +mins.toFixed(1), died: !!died, band: o.band || null });
    if (mem.history.length > 60) mem.history.length = 60;
    mem.worth.push([this.now, Math.round(this.botWorth(p))]); if (mem.worth.length > 120) mem.worth.shift();
    this.botLog(bot, `Итог «${ACTIONS[o.a].name}»${o.band ? ' (' + o.band + ')' : ''}: ${dw >= 0 ? '+' : ''}${fmt(dw)} CR за ${mins.toFixed(1)} мин → награда ${fmt(r)}`);
    this.save();
  };

  // ---------- общие навыки пилотирования ----------
  P.botDockNearest = function (bot, s) {
    if (s.docked) return true;
    const e = s.ent; if (!e || e.warp || e.cmd.type === 'align' || e.cmd.type === 'dock') return false;
    const sts = this.U.systems[e.sys].stations.filter(st => !st.player || st.owner === s.player.name);
    if (!sts.length) { const r = route(this.U.neighbors, e.sys, this.U.celestials[s.player.home].sys); if (r && !e.autopilot) this.handle(s, { t: 'autopilot', dest: r[r.length - 1], go: true }); return false; }
    const st = sts.reduce((b, x) => dist(x.pos, e.pos) < dist(b.pos, e.pos) ? x : b, sts[0]);
    this.handle(s, { t: 'dock', id: st.id });
    return false;
  };
  P.botTravel = function (bot, s, sysId) {
    if (s.docked) { this.handle(s, { t: 'undock' }); return false; } // в космос — даже если нужная система та же
    const e = s.ent; if (!e) return false;
    if (e.sys === sysId && !e.autopilot) return true;
    if (!e.autopilot && !e.warp && e.cmd.type !== 'align' && e.cmd.type !== 'jump') this.handle(s, { t: 'autopilot', dest: sysId, go: true });
    return false;
  };
  // варп к объекту, а если он ближе дистанции варпа — просто подлёт
  P.botGoTo = function (s, c, range) {
    const e = s.ent;
    if (dist(c.pos, e.pos) < 150000) this.handle(s, { t: 'dir', dir: norm(sub(c.pos, e.pos)) });
    else this.handle(s, { t: 'warp', id: c.id, range: range || 0 });
  };
  P.botNearestSys = function (from, test) {
    let best = null, bl = 1e9;
    for (const id of Object.keys(this.U.systems)) {
      if (this.U.byId[id].wormhole || !test(this.U.byId[id])) continue;
      const r = route(this.U.neighbors, from, id); if (r && r.length < bl) { bl = r.length; best = id; }
    }
    return best;
  };
  P.botBuyFit = function (s, p, kind, item, count) {
    // докупить и поставить модуль нужного вида, если его не хватает
    const have = p.ship.fit.filter(m => m && MODULES[m].kind === kind).length;
    if (have >= count) return;
    const t = SHIPS[p.ship.type];
    for (let i = 0; i < p.ship.fit.length && p.ship.fit.filter(m => m && MODULES[m].kind === kind).length < count; i++) {
      if (p.ship.fit[i] || this.slotType(p.ship.type, i) !== MODULES[item].slot) continue;
      const h = this.hangar(p, s.docked);
      if (!(h.items[item] > 0)) { if (p.credits < MODULES[item].price * 1.2) return; this.handle(s, { t: 'buy', item, qty: 1 }); }
      this.handle(s, { t: 'fit', slot: i, item });
    }
  };
  P.botSellCargo = function (s, p, filter) {
    if (!s.docked) return;
    for (const id of Object.keys(p.ship.cargo)) if (filter(id)) this.handle(s, { t: 'unload', item: id });
    const h = this.hangar(p, s.docked);
    for (const [id, q] of Object.entries(h.items)) if (filter(id) && q > 0 && !ITEMS[id].noSell) this.handle(s, { t: 'sell', item: id, qty: q });
  };
  P.botRestock = function (s, p) {
    if (!s.docked) return;
    const cells = p.ship.cargo.energy_cell || 0;
    if (cells < 12 && p.credits > 20000) this.handle(s, { t: 'buy', item: 'energy_cell', qty: 20 - cells });
    for (const m of p.ship.fit) if (m && MODULES[m].kind === 'launcher' && (p.ship.cargo[MODULES[m].ammo] || 0) < 30 && p.credits > 30000) this.handle(s, { t: 'buy', item: MODULES[m].ammo, qty: 60 });
  };

  // ---------- занятие: добыча руды ----------
  P.bot_mine = function (bot, o, s, p) {
    const e = s.ent;
    switch (o.phase) {
      case 'start': {
        if (!s.docked && !this.botDockNearest(bot, s)) return;
        this.botSellCargo(s, p, id => ITEMS[id] && (ITEMS[id].cat === 'Руда' || ITEMS[id].cat === 'Материалы'));
        this.botRestock(s, p);
        if (!SHIPS[p.ship.type].foundry) this.botBuyFit(s, p, 'miner', p.credits > 200000 ? 'miner_2' : 'miner_1', SHIPS[p.ship.type].slots.high >= 3 ? 2 : 1);
        o.band = this.botSubChoose(bot, 'mine');
        const [lo, hi] = BANDS.mine[o.band];
        o.data.sys = this.botNearestSys(this.U.celestials[s.docked].sys, d => d.sec >= lo && d.sec < hi);
        o.phase = 'travel'; return;
      }
      case 'travel': if (this.botTravel(bot, s, o.data.sys)) o.phase = 'belt'; return;
      case 'belt': {
        if (!e || e.warp || e.cmd.type === 'align') return;
        const belts = this.U.systems[e.sys].belts;
        const b = belts.find(x => dist(x.pos, e.pos) < 30000);
        if (b) { o.data.belt = b.id; o.phase = 'mining'; if (e.cmd.type === 'dir') this.handle(s, { t: 'stop' }); return; }
        if (!o.data.target || !belts.some(x => x.id === o.data.target)) o.data.target = pick(belts).id;
        this.botGoTo(s, this.U.celestials[o.data.target], 0);
        return;
      }
      case 'mining': {
        if (!e) return (o.phase = 'return');
        const stats = e.stats, used = this.cargoUsed(p.ship.cargo);
        if (used > stats.cargo * 0.9) return (o.phase = 'return');
        if (e.lastHitAt && this.now - e.lastHitAt < 5000 && e.hull < e.stats.hull * 0.7) { this.botLog(bot, 'Атакован у пояса — ухожу'); return (o.phase = 'return'); }
        if (SHIPS[p.ship.type].foundry) return;                          // «Бегемот» копает сам
        let t = o.data.ast && this.ents.get(o.data.ast);
        if (!t) {
          const asts = [...this.ents.values()].filter(x => x.type === 'asteroid' && x.sys === e.sys && dist(x.pos, e.pos) < 60000);
          if (!asts.length) { o.phase = 'belt'; o.data.belt = null; o.data.target = null; return; }
          t = asts.reduce((b, x) => (x.amount * ITEMS[x.ore].base) / (1 + dist(x.pos, e.pos) / 10000) > (b.amount * ITEMS[b.ore].base) / (1 + dist(b.pos, e.pos) / 10000) ? x : b, asts[0]);
          o.data.ast = t.id;
        }
        const miners = p.ship.fit.map((m, i) => m && MODULES[m].kind === 'miner' ? i : -1).filter(i => i >= 0);
        const range = Math.min(...miners.map(i => MODULES[p.ship.fit[i]].range), 10000);
        if (this.surfaceDist(e, t) > range * 0.85) { if (e.cmd.type !== 'approach') this.handle(s, { t: 'approach', id: t.id }); return; }
        if (e.cmd.type === 'approach') this.handle(s, { t: 'stop' });
        if (!e.locks.has(t.id)) { if (!e.locking.has(t.id)) this.handle(s, { t: 'lock', id: t.id }); return; }
        for (const i of miners) if (!e.modules[i].active) this.handle(s, { t: 'module', slot: i, target: t.id });
        return;
      }
      case 'return': if (this.botDockNearest(bot, s)) o.phase = 'sell'; return;
      case 'sell':
        this.botSellCargo(s, p, id => ITEMS[id] && (ITEMS[id].cat === 'Руда' || ITEMS[id].cat === 'Материалы' || ITEMS[id].cat === 'Трофеи'));
        this.botFinish(bot);
    }
  };

  // ---------- занятие: охота на пиратов ----------
  P.bot_hunt = function (bot, o, s, p) {
    const e = s.ent;
    switch (o.phase) {
      case 'start': {
        if (!s.docked && !this.botDockNearest(bot, s)) return;
        this.botSellCargo(s, p, id => ITEMS[id] && (ITEMS[id].cat === 'Трофеи' || ITEMS[id].cat === 'Руда'));
        const hi = SHIPS[p.ship.type].slots.high;
        const gun = p.credits > 400000 ? 'ml_light' : p.credits > 60000 ? 'rail_s' : 'laser_s';
        this.botBuyFit(s, p, gun === 'ml_light' ? 'launcher' : 'weapon', gun, Math.max(1, hi - (this.botRole(p) === 'mixed' ? 1 : 0)));
        this.botBuyFit(s, p, 'shieldRep', 'shield_booster', 1);
        if (p.credits > 300000) this.botBuyFit(s, p, 'pd', 'pd_1', 1);
        this.botRestock(s, p);
        if (!p.ship.fit.some(m => m && ['weapon', 'launcher'].includes(MODULES[m].kind))) { o.failed = true; this.botLog(bot, 'Нет орудий и денег на них — охота отменена'); return this.botFinish(bot); }
        o.band = this.botSubChoose(bot, 'hunt');
        const [lo, hi2] = BANDS.hunt[o.band];
        o.data.sys = this.botNearestSys(this.U.celestials[s.docked].sys, d => d.sec >= lo && d.sec < hi2 && this.U.systems[d.id].belts.length);
        o.data.belts = 0; o.phase = 'travel'; return;
      }
      case 'travel': if (this.botTravel(bot, s, o.data.sys)) o.phase = 'belt'; return;
      case 'belt': {
        if (!e || e.warp || e.cmd.type === 'align') return;
        if (o.data.belts >= 4) return (o.phase = 'return');
        const belts = this.U.systems[e.sys].belts;
        o.data.belts++; o.data.quietSince = this.now;
        this.botGoTo(s, belts[o.data.belts % belts.length], 15000);
        o.phase = 'fight'; return;
      }
      case 'fight': {
        if (!e) return (o.phase = 'return');
        if (e.warp || e.cmd.type === 'align') return;
        if (e.hull < e.stats.hull * 0.45) { this.botLog(bot, 'Корпус ниже 45% — отступаю'); return (o.phase = 'return'); }
        // ремонт и ПРО
        e.modules.forEach((m, i) => { if (!m) return; const k = MODULES[m.id].kind;
          if ((k === 'shieldRep' && e.shield < e.stats.shield * 0.6 || k === 'armorRep' && e.armor < e.stats.armor * 0.7) && !m.active) this.handle(s, { t: 'module', slot: i });
          if (k === 'pd' && !m.active && [...this.ents.values()].some(x => x.type === 'missile' && x.target === e.id)) this.handle(s, { t: 'module', slot: i }); });
        const foes = [...this.ents.values()].filter(x => x.type === 'ship' && x.npc && !x.guardian && !x.fortress && x.sys === e.sys && !x.warp && dist(x.pos, e.pos) < 90000);
        if (!foes.length) {
          // подобрать трофеи после боя
          const w = [...this.ents.values()].find(x => x.type === 'wreck' && x.sys === e.sys && dist(x.pos, e.pos) < 40000 && Object.keys(x.items).length && !x.storySite);
          if (w && this.cargoUsed(p.ship.cargo) < e.stats.cargo * 0.8) { this.handle(s, { t: 'loot', id: w.id }); o.data.quietSince = this.now; return; }
          if (this.now - o.data.quietSince > 45000) o.phase = 'belt';
          return;
        }
        o.data.quietSince = this.now;
        // цель: самая раненая из ближайших (фокус огня)
        const t = foes.reduce((b, x) => ((x.shield + x.armor + x.hull) / (x.stats.shield + x.stats.armor + x.stats.hull)) * (1 + dist(x.pos, e.pos) / 40000) < ((b.shield + b.armor + b.hull) / (b.stats.shield + b.stats.armor + b.stats.hull)) * (1 + dist(b.pos, e.pos) / 40000) ? x : b, foes[0]);
        const guns = e.modules.map((m, i) => m && ['weapon', 'launcher'].includes(MODULES[m.id].kind) ? i : -1).filter(i => i >= 0);
        const md = MODULES[e.modules[guns[0]].id];
        const opt = md.kind === 'launcher' ? md.range * 0.55 : md.optimal * 0.8;
        if (e.cmd.type !== 'orbit' || e.cmd.target !== t.id) this.handle(s, { t: 'orbit', id: t.id, range: opt });
        if (!e.locks.has(t.id)) { if (!e.locking.has(t.id)) this.handle(s, { t: 'lock', id: t.id }); return; }
        for (const i of guns) { const m = e.modules[i]; if (!m.active || m.target !== t.id) { if (m.active) this.handle(s, { t: 'module', slot: i }); this.handle(s, { t: 'module', slot: i, target: t.id }); } }
        if (p.ship.drones && Object.keys(p.ship.drones).length && !this.myDrones(e).length) this.handle(s, { t: 'droneLaunch' });
        return;
      }
      case 'return': if (this.botDockNearest(bot, s)) o.phase = 'sell'; return;
      case 'sell':
        this.botSellCargo(s, p, id => ITEMS[id] && (ITEMS[id].cat === 'Трофеи' || ITEMS[id].cat === 'Руда'));
        this.botFinish(bot);
    }
  };

  // ---------- занятие: торговля энергоячейками ----------
  P.bot_trade = function (bot, o, s, p) {
    switch (o.phase) {
      case 'start': {
        if (!s.docked && !this.botDockNearest(bot, s)) return;
        // покупаем там, где дёшево: в Ядре
        const here = this.U.celestials[s.docked].sys;
        if (this.U.byId[here].region !== 'core') { o.data.buySys = this.botNearestSys(here, d => d.region === 'core'); o.phase = 'toCore'; return; }
        o.phase = 'buy'; return;
      }
      case 'toCore': if (this.botTravel(bot, s, o.data.buySys)) o.phase = 'dockCore'; return;
      case 'dockCore': if (this.botDockNearest(bot, s)) o.phase = 'buy'; return;
      case 'buy': {
        const stats = this.calcStats(p, p.ship), free = stats.cargo - this.cargoUsed(p.ship.cargo) - 10;
        const price = this.buyPriceOf(s.docked, 'energy_cell');
        const qty = Math.floor(Math.min(free / ITEMS.energy_cell.vol, p.credits * 0.5 / price));
        if (qty < 20) { o.failed = true; this.botLog(bot, 'Мало места или денег для торговли'); return this.botFinish(bot); }
        this.handle(s, { t: 'buy', item: 'energy_cell', qty });
        o.data.qty = qty;
        o.band = this.botSubChoose(bot, 'trade');
        o.data.sys = this.botNearestSys(this.U.celestials[s.docked].sys, d => d.region === BANDS.trade[o.band] && this.U.systems[d.id].stations.some(x => !x.player));
        o.phase = 'travel'; return;
      }
      case 'travel': if (this.botTravel(bot, s, o.data.sys)) o.phase = 'return'; return;
      case 'return': if (this.botDockNearest(bot, s)) o.phase = 'sell'; return;
      case 'sell': {
        const keep = 15; // запас на прыжки
        const have = p.ship.cargo.energy_cell || 0;
        if (have > keep) { this.handle(s, { t: 'unload', item: 'energy_cell' }); this.handle(s, { t: 'sell', item: 'energy_cell', qty: have - keep }); this.handle(s, { t: 'load', item: 'energy_cell', qty: keep }); }
        this.botFinish(bot);
      }
    }
  };

  // ---------- вложения ----------
  P.bot_upgrade = function (bot, o, s, p) {
    if (!s.docked && !this.botDockNearest(bot, s)) return;
    const opts = p.ship.fit.map((id, i) => ({ i, c: id && upgradeCost(id) })).filter(x => x.c && this.botUpgradeTotal(x.c) < p.credits * 0.35);
    if (!opts.length) { o.failed = true; return this.botFinish(bot); }
    // в первую очередь — главный рабочий модуль роли
    const role = this.botRole(p), prio = (id) => ({ miner: role !== 'fighter' ? 3 : 0, weapon: 3, launcher: 3, shieldRep: 2, pd: 1 }[MODULES[id].kind] || 1);
    const best = opts.sort((a, b) => prio(p.ship.fit[b.i]) - prio(p.ship.fit[a.i]) || a.c.isk - b.c.isk)[0];
    const before = p.ship.fit[best.i];
    this.handle(s, { t: 'upgradeModule', slot: best.i, buyMissing: true });
    if (p.ship.fit[best.i] === before) { o.failed = true; this.botLog(bot, 'Улучшение не удалось'); }
    else this.botLog(bot, `Улучшил «${MODULES[p.ship.fit[best.i]].name}»`);
    this.botFinish(bot);
  };
  P.botNextShip = function (p) {
    const role = this.botRole(p) === 'miner' ? 'miner' : 'fighter';
    const ladder = LADDER[role], i = ladder.indexOf(p.ship.type);
    for (const t of ladder.slice(i + 1)) {
      const req = SHIPS[t].req || {};
      if (Object.entries(req).some(([sk, lv]) => (p.skills[sk] || 0) < lv)) continue;
      if (p.credits > SHIPS[t].price * 1.4) return t;
    }
    return null;
  };
  P.bot_ship = function (bot, o, s, p) {
    if (!s.docked && !this.botDockNearest(bot, s)) return;
    const t = this.botNextShip(p);
    if (!t) { o.failed = true; return this.botFinish(bot); }
    const oldFit = p.ship.fit.filter(Boolean);
    this.handle(s, { t: 'buy', item: t, board: true });
    if (p.ship.type !== t) { o.failed = true; return this.botFinish(bot); }
    // переносим подходящие модули со старого корабля из ангара
    const h = this.hangar(p, s.docked);
    const old = h.ships.find(x => x.fit.some(Boolean));
    if (old) for (let i = 0; i < old.fit.length; i++) if (old.fit[i]) { h.items[old.fit[i]] = (h.items[old.fit[i]] || 0) + 1; old.fit[i] = null; }
    for (const id of oldFit) for (let i = 0; i < p.ship.fit.length; i++) if (!p.ship.fit[i] && this.slotType(p.ship.type, i) === MODULES[id].slot && h.items[id] > 0) { this.handle(s, { t: 'fit', slot: i, item: id }); break; }
    this.botLog(bot, `Купил корабль «${SHIPS[t].name}»`);
    this.botFinish(bot);
  };
  P.bot_solar = function (bot, o, s, p) {
    const e = s.ent;
    switch (o.phase) {
      case 'start':
        if (s.docked) { this.handle(s, { t: 'undock' }); return; }
        if (!e || e.warp) return;
        { const planets = this.U.systems[e.sys].celestials.filter(c => c.kind === 'planet');
          this.handle(s, { t: 'warp', id: pick(planets).id, range: 100000 }); }
        o.phase = 'clear'; return;
      case 'clear': {
        if (!e || e.warp || e.cmd.type === 'align') return;
        const bad = this.U.systems[e.sys].celestials.find(c => dist(c.pos, e.pos) - (c.radius || 0) < (c.kind === 'sun' ? 0.3 * 1.496e11 : 230000));
        if (bad) { if (e.cmd.type !== 'dir') this.handle(s, { t: 'dir', dir: norm(sub(e.pos, bad.pos)) }); return; }
        const before = this.infraOf(p, 'solar').length;
        this.handle(s, { t: 'buildInfra', kind: 'solar' });
        if (this.infraOf(p, 'solar').length > before) this.botLog(bot, `Построил солнечную электростанцию в ${this.U.byId[e.sys].name}`);
        else o.failed = true;
        o.phase = 'return'; return;
      }
      case 'return': if (this.botDockNearest(bot, s)) this.botFinish(bot); return;
    }
  };

  // ---------- отчёт для окна «Обучение ИИ» ----------
  P.c_botInfo = function (s) {
    const list = (this.bots || []).map(bot => {
      const p = bot.sess && bot.sess.player, mem = bot.mem;
      const st = p ? this.botState(p) : null;
      const table = Object.keys(ACTIONS).map(a => { const c = (mem.Q[st] || {})[a] || { q: 0, n: 0 }; return { a, name: ACTIONS[a].name, q: Math.round(c.q), n: c.n }; });
      const sub = Object.fromEntries(Object.entries(mem.sub).map(([k, v]) => [k, Object.entries(v).map(([b, c]) => ({ b, q: Math.round(c.q), n: c.n }))]));
      return {
        name: bot.name, online: !!(bot.sess && this.sessions.has(bot.sess)), ship: p ? p.ship.type : null, credits: p ? Math.round(p.credits) : 0,
        worth: p ? Math.round(this.botWorth(p)) : 0, sys: p ? this.playerSys(p) : null, state: st, episodes: mem.episodes, eps: +this.botEpsilon(bot).toFixed(2),
        doing: bot.opt ? { a: ACTIONS[bot.opt.a].name, aKey: bot.opt.a, phase: bot.opt.phase, band: bot.opt.band || null, secs: Math.round((this.now - bot.opt.t0) / 1000) } : null,
        table, sub, history: mem.history.slice(0, 12), log: mem.log.slice(0, 12), worthHist: mem.worth.slice(-60), skills: p ? p.skills : {},
        structures: p ? (this.db.structures || []).filter(x => x.owner === p.name).length : 0
      };
    });
    s.send({ t: 'bots', list, actions: ACTIONS });
  };
};
module.exports.ACTIONS = ACTIONS;
