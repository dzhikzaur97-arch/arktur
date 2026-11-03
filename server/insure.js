// Страховка корабля и сводка «Пока вас не было».
//
// Страховка: базовая есть всегда (40% цены корпуса деньгами). На станции можно купить полис на текущий корабль:
//   «Серебро» — 8% цены: корпус 80% + половина стоимости установленных модулей;
//   «Платина» — 18% цены: корабль со всей оснасткой ждёт в ангаре домашней станции (без груза и дронов).
// Полис действует до первой гибели корабля, потом его нужно покупать заново.
//
// Сводка: игра запоминает, когда пилот был в сети. При входе после 10+ минут отсутствия показывает,
// что успело произойти: доход корпорации, готовые заказы производства, склады баз на планетах,
// изученные навыки и общий рост имущества.
'use strict';
const crypto = require('crypto');
const { SHIPS, MODULES, ITEMS, SKILLS } = require('./data');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const uid = () => crypto.randomBytes(6).toString('hex');

const INS = {
  basic: { name: 'Базовая', cost: 0, hull: 0.4, fit: 0, desc: '40% цены корпуса деньгами' },
  silver: { name: 'Серебро', cost: 0.08, hull: 0.8, fit: 0.5, desc: '80% цены корпуса и половина стоимости модулей' },
  platinum: { name: 'Платина', cost: 0.18, hull: 0, fit: 0, restore: true, desc: 'корабль со всей оснасткой ждёт вас в ангаре домашней станции' }
};
const AWAY_MIN = 10 * 60000;

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseDestroy = P.destroyShip, baseLogin = P.login, baseSlow = P.slowTick;

  const fitValue = (ship) => (ship.fit || []).reduce((a, id) => a + ((id && MODULES[id] && MODULES[id].price) || 0), 0);
  P.insView = function (p) {
    const t = SHIPS[p.ship.type], ins = (p.ship.ins && INS[p.ship.ins]) ? p.ship.ins : 'basic';
    return { t: 'ins', ship: t.name, price: t.price, fitValue: fitValue(p.ship), now: ins,
      tiers: Object.fromEntries(Object.entries(INS).map(([k, v]) => [k, { ...v, price: Math.round(t.price * v.cost) }])) };
  };
  P.c_insInfo = function (s, m, p) { s.send(this.insView(p)); };
  P.c_insure = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const T = INS[m.tier]; if (!T || m.tier === 'basic') return;
    const cur = p.ship.ins;
    if (cur === m.tier) return this.notify(s, 'Этот полис уже действует', 'warn');
    if (cur === 'platinum') return this.notify(s, 'Платиновый полис уже действует — он лучше', 'warn');
    const price = Math.round(SHIPS[p.ship.type].price * T.cost);
    if (p.credits < price) return this.notify(s, `Нужно ${fmt(price)} CR`, 'warn');
    p.credits -= price; p.ship.ins = m.tier;
    p.stats.insBought = (p.stats.insBought || 0) + 1;
    this.notify(s, `🛡 Страховка «${T.name}» на «${SHIPS[p.ship.type].name}» оформлена: ${T.desc}. Списано ${fmt(price)} CR`, 'good');
    this.sendProfile(s); s.send(this.insView(p)); this.save();
  };

  P.destroyShip = function (t, killer) {
    const p = t && !t.npc && !t.guardian && t.owner && this.db.players[t.owner];
    const ship = p && p.ship, tier = ship && ship.ins, home = p && p.home;
    const r = baseDestroy.apply(this, arguments);
    if (!p || p.ship === ship || !tier || !INS[tier]) return r; // корабль не погиб (арена, рейд и т. п.) или полиса нет
    const T = INS[tier], lost = SHIPS[ship.type], sess = [...this.sessions].find(x => x.player === p);
    const base = Math.round(lost.price * INS.basic.hull);
    let msg;
    if (T.restore) {
      p.credits -= Math.min(p.credits, base); // вместо денег — сам корабль
      const copy = { uid: uid(), type: ship.type, fit: ship.fit.slice(), cargo: {}, drones: {}, hp: { shield: 1, armor: 1, hull: 1 } };
      for (const k of ['paint', 'look', 'name', 'fu', 'parts']) if (ship[k] !== undefined) copy[k] = JSON.parse(JSON.stringify(ship[k]));
      this.hangar(p, home).ships.push(copy);
      msg = `🛡 Платиновая страховка: новый «${lost.name}» со всей оснасткой ждёт в ангаре домашней станции (раздел «Корабли»)`;
    } else {
      const extra = Math.round(lost.price * (T.hull - INS.basic.hull) + fitValue(ship) * T.fit);
      p.credits += extra;
      msg = `🛡 Страховка «${T.name}»: доплата ${fmt(extra)} CR сверх базовых ${fmt(base)} CR`;
    }
    p.stats.insPaid = (p.stats.insPaid || 0) + 1;
    if (sess) { this.notify(sess, msg, 'good'); this.sendProfile(sess); }
    this.save(true);
    return r;
  };

  // ---------- сводка «Пока вас не было» ----------
  const worth = (g, p) => {
    let v = p.credits || 0;
    for (const h of Object.values(p.hangars || {})) for (const [id, q] of Object.entries(h.items || {})) v += ((ITEMS[id] && ITEMS[id].base) || 0) * q;
    if (p.corp) v += p.corp.treasury || 0;
    return v;
  };
  const snap = (g, p) => ({ worth: worth(g, p), treasury: p.corp ? p.corp.treasury || 0 : 0, skills: { ...(p.skills || {}) },
    outStore: Object.values(p.outposts || {}).reduce((a, o) => a + Object.values(o.store || {}).reduce((x, y) => x + y, 0), 0) });

  P.login = function (sess, name) {
    const nm = String(name || '').trim().slice(0, 20), pp = this.db.players[nm];
    const pre = pp && pp.lastSeen && this.now - pp.lastSeen >= AWAY_MIN ? { from: pp.lastSeen, s0: snap(this, pp) } : null;
    const r = baseLogin.apply(this, arguments);
    if (pre && sess.player === pp) sess.awayCheck = { at: this.now + 4000, ...pre };
    return r;
  };

  P.awayReport = function (s, p, a) {
    // пусть отложенные начисления досчитаются: базы на планетах и корпорация
    for (const [pl, o] of Object.entries(p.outposts || {})) if (this.outAccrue) try { this.outAccrue(o, pl, p); } catch (e) {}
    if (this.corpWork && p.corp) try { this.corpWork(p); } catch (e) {}
    const s1 = snap(this, p), lines = [];
    const mins = Math.round((this.now - a.from) / 60000);
    if (p.corp && s1.treasury - a.s0.treasury >= 1) lines.push(['🏢', `Корпорация заработала ${fmt(s1.treasury - a.s0.treasury)} CR — заберите в окне «Корпорация»`]);
    const learned = Object.entries(s1.skills).filter(([k, v]) => v > (a.s0.skills[k] || 0)).map(([k, v]) => `${(SKILLS[k] || {}).name || k} ${v}`);
    if (learned.length) lines.push(['🎓', `Изучено: ${learned.join(', ')}`]);
    const ready = (p.jobs || []).filter(j => j.end && j.end <= this.now);
    if (ready.length) lines.push(['🏭', `Производство: готово заказов — ${ready.length}. Заберите на станции (вкладка «Производство»)`]);
    if (s1.outStore > a.s0.outStore) lines.push(['🪐', `Базы на планетах накопили ${fmt(s1.outStore - a.s0.outStore)} ед. ресурсов`]);
    const st = this.myStructure && this.myStructure(p);
    if (st && st.jobs && st.jobs.length) { const done = st.jobs.filter(j => j.end <= this.now).length; if (done) lines.push(['♻', `Своя станция: переработка готова (${done})`]); }
    if (p.sov && this.megaView) { try { this.megaView({ docked: null }, p); } catch (e) {} if ((p.sov.bank || 0) >= 1) lines.push(['👑', `Казна вашей системы: ${fmt(p.sov.bank)} CR — заберите в окне «Великие стройки»`]); }
    const L = p.mega && p.mega.levi; if (L && L.until && L.until <= this.now + 6000 && !L.done) lines.push(['⚜', 'Этап стройки титана «Император» завершён']);
    const dw = s1.worth - a.s0.worth;
    if (dw >= 1000) lines.push(['📈', `Имущество выросло на ${fmt(dw)} CR`]);
    if (p.training) lines.push(['⏳', `Учится навык «${(SKILLS[p.training.skill] || {}).name}» до ${p.training.level}`]);
    else if (!learned.length) lines.push(['💡', 'Навыки не изучаются — поставьте следующий во вкладке «Навыки»']);
    s.send({ t: 'away', mins, lines });
  };

  P.slowTick = function () {
    const r = baseSlow.apply(this, arguments);
    for (const s of this.sessions) {
      const p = s.player; if (!p || s.isBot) continue;
      p.lastSeen = this.now;
      if (s.awayCheck && this.now >= s.awayCheck.at) { const a = s.awayCheck; s.awayCheck = null; try { this.awayReport(s, p, a); } catch (e) { console.error('away', e); } }
    }
    return r;
  };
};
module.exports.INS = INS;
