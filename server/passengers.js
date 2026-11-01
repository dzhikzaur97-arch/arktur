// Пассажиры и срочные грузы: у агентов станций появляются заказы со временем — довезти людей или груз
// на другую станцию за N минут. Чем раньше — тем выше награда (до +50% за скорость); опоздали — половина;
// вдвое дольше срока — заказ сорван. В пути бывают засады: пираты знают, кто везёт ценный груз.
'use strict';
const crypto = require('crypto');
const { ITEMS, SHIPS, incomeOf } = require('./data');
const { route } = require('./universe');
const uid = () => crypto.randomBytes(6).toString('hex');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);

ITEMS.q_pass = { name: 'Пассажиры', cat: 'Миссия', vol: 2, base: 0, quest: true };
ITEMS.q_rush = { name: 'Срочный груз', cat: 'Миссия', vol: 10, base: 0, quest: true };
const WHO = ['учёные Ордена', 'семья колонистов', 'инженеры верфи', 'журналисты', 'дипломаты Лиги', 'курьер Консорциума', 'туристы', 'врачи с вакциной'];
const RUSH = ['медикаменты', 'запчасти для реактора', 'образцы руды', 'дипломатическая почта', 'свежие продукты', 'детали для верфи'];

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseBoard = P.missionBoard, baseAccept = P.c_acceptMission, baseCheck = P.checkCourier, baseJump = P.jump;

  P.missionBoard = function (stationId) {
    const fresh = !this.missionBoards[stationId] || this.missionBoards[stationId].until <= this.now;
    const b = baseBoard.call(this, stationId);
    if (fresh && !b.offers.some(o => o.type === 'taxi')) {
      const sysId = this.U.celestials[stationId].sys;
      const dests = Object.values(this.U.celestials).filter(c => c.kind === 'station' && !c.player && c.id !== stationId && !this.U.byId[c.sys].wormhole)
        .map(c => ({ c, r: route(this.U.neighbors, sysId, c.sys) })).filter(x => x.r && x.r.length - 1 <= 4);
      for (let k = 0; k < 2 && dests.length; k++) {
        const { c, r } = pick(dests), j = r.length - 1, rush = Math.random() < 0.4;
        const n = rush ? 1 : 2 + Math.floor(Math.random() * 6);
        const mins = Math.round(4 + j * 3.5);
        const reward = Math.round((9000 + j * 14000) * (rush ? 1.3 : 1 + n * 0.08) * incomeOf(c.sys));
        const what = rush ? pick(RUSH) : pick(WHO);
        b.offers.push({ id: uid(), type: 'taxi', typeName: rush ? 'Срочный груз' : 'Пассажиры', from: stationId, dest: c.id, sys: c.sys, rush, n, mins, reward,
          title: rush ? `Срочно: ${what} → ${this.U.byId[c.sys].name}` : `Пассажиры: ${what} → ${this.U.byId[c.sys].name}`,
          text: `${rush ? `Доставьте ${what} (10 м³)` : `Довезите ${n} пасс. (${n * 2} м³ в трюме)`} на станцию «${c.name}» (${j} прыжк.) за ${mins} мин. Быстрее — больше награда, опоздание — половина.`,
          goal: `Станция «${c.name}» · ${mins} мин` });
      }
    }
    return b;
  };
  P.c_acceptMission = function (s, m, p) {
    const st = s.docked; const b = st && this.missionBoards[st];
    const o = b && b.offers.find(x => x.id === m.id);
    if (o && o.type === 'taxi') {
      if (p.missions.length >= 3) return this.notify(s, 'Не более трёх активных заданий', 'warn');
      const item = o.rush ? 'q_rush' : 'q_pass', qty = o.rush ? 1 : o.n, vol = ITEMS[item].vol * qty;
      const free = this.calcStats(p, p.ship).cargo - this.cargoUsed(p.ship.cargo);
      if (free < vol) return this.notify(s, `Нужно ${vol} м³ свободного места в трюме (есть ${Math.floor(free)})`, 'warn');
      b.offers.splice(b.offers.indexOf(o), 1);
      p.ship.cargo[item] = (p.ship.cargo[item] || 0) + qty;
      Object.assign(o, { item, qty, t0: this.now, deadline: this.now + o.mins * 60000 });
      p.missions.push(o);
      this.notify(s, `${o.rush ? '📦 Груз' : '🧳 Пассажиры'} на борту — время пошло: ${o.mins} мин`, 'good');
      this.sendProfile(s); return this.c_agents(s, m, p);
    }
    return baseAccept.call(this, s, m, p);
  };
  // доставка: при стыковке на станции назначения
  P.checkCourier = function (s) {
    baseCheck.call(this, s);
    const p = s.player;
    for (const ms of [...p.missions]) {
      if (ms.type !== 'taxi') continue;
      const late = this.now - ms.deadline;
      if (late > ms.mins * 60000) { this.taxiDrop(p, ms); p.missions = p.missions.filter(x => x !== ms); this.notify(s, `✖ Заказ сорван: ${ms.title} — слишком большое опоздание`, 'bad'); this.sendProfile(s); continue; }
      if (ms.dest !== s.docked) continue;
      this.taxiDrop(p, ms);
      const left = ms.deadline - this.now, k = late > 0 ? 0.5 : 1 + 0.5 * Math.min(1, left / (ms.mins * 60000));
      ms.reward = Math.round(ms.reward * k * (1 + ((SHIPS[p.ship.type] || {}).taxiBonus || 0)));
      p.stats.taxi = (p.stats.taxi || 0) + 1;
      this.completeMission(p, ms, s);
      this.notify(s, late > 0 ? `Опоздание на ${Math.ceil(late / 60000)} мин — заплатили половину` : `Успели с запасом ${Math.floor(left / 60000)} мин — бонус за скорость`, late > 0 ? 'warn' : 'good');
    }
  };
  P.taxiDrop = function (p, ms) { const c = p.ship.cargo; c[ms.item] = Math.max(0, (c[ms.item] || 0) - ms.qty); if (!c[ms.item]) delete c[ms.item]; };
  // засада: пираты поджидают у врат того, кто везёт пассажиров или срочный груз
  P.jump = function (e, gate) {
    const r = baseJump.call(this, e, gate);
    const s = e.session, p = s && s.player;
    if (p && (p.missions || []).some(m => m.type === 'taxi') && this.U.byId[e.sys].sec < 0.8 && Math.random() < 0.22 / ((SHIPS[p.ship.type] || {}).taxiBonus ? 2 : 1)) {
      const sec = this.U.byId[e.sys].sec;
      for (const k of sec > 0.4 ? ['raider', 'raider'] : ['raider', 'hunter', 'reaper']) {
        const n = this.spawnNpc(k, e.sys, [e.pos[0] + rnd(-9000, 9000), e.pos[1], e.pos[2] + rnd(-9000, 9000)]); n.npcTarget = e.id;
      }
      this.notify(s, '⚠ Засада у врат! Пираты знали, кого вы везёте', 'bad');
    }
    return r;
  };
};
