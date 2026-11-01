// Своя корпорация: пилот основывает её (1 млн CR), выбирает название, тег и герб, нанимает ИИ-пилотов.
// Участники сами копают, торгуют и охотятся — каждый час приносят в казну CR (шахтёры — ещё и руду на общий склад,
// охотники — трофеи). Растут в уровне, иногда попадают в беду (ранены, сбиты — выбывают на время).
// Казну можно забрать себе, общий склад — выгрузить в ангар любой станции. Уровень корпорации даёт больше мест.
'use strict';
const crypto = require('crypto');
const { ITEMS } = require('./data');
const { rng } = require('./universe');
const uid = () => crypto.randomBytes(5).toString('hex');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');

const CORP = {
  cost: 1000000,
  levels: [null, { slots: 5, cost: 0 }, { slots: 10, cost: 3000000 }, { slots: 20, cost: 10000000 }],
  roles: {
    miner:  { name: 'Шахтёр', cr: 7000, risk: 0.02, ore: true },
    trader: { name: 'Торговец', cr: 10000, risk: 0.03 },
    hunter: { name: 'Охотник', cr: 12000, risk: 0.06, loot: true }
  },
  emblems: ['✦', '◆', '⬢', '☄', '⚔', '♜', '✪', '☀', '❖', '⚓', '♛', '✹'],
  colors: ['#5fc8e8', '#ffb040', '#ff6a50', '#8ae08a', '#c080ff', '#ffd860', '#e0e0e0', '#ff7ab0'],
  xpNeed: [0, 3, 8, 16, 30], downMs: 30 * 60000, hireFee: 25000,
  first: ['Арс', 'Вега', 'Дан', 'Кира', 'Лео', 'Мира', 'Ник', 'Рэй', 'Тэо', 'Юна', 'Сол', 'Ева', 'Гор', 'Лана', 'Нора', 'Ян', 'Ада', 'Кай', 'Вера', 'Тим'],
  last: ['Корвин', 'Стрельцов', 'Ноэль', 'Варга', 'Мерк', 'Ростов', 'Кейн', 'Орлова', 'Векс', 'Лунд', 'Сато', 'Рейн', 'Дорн', 'Сорель', 'Остен']
};

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick;

  P.corpSlots = function (p) { const c = p.corp; return c ? CORP.levels[c.level].slots + (this.techHas && this.techHas(p, 'corp1') ? 5 : 0) : 0; };
  P.corpView = function (p) {
    const c = p.corp;
    const hour = Math.floor(this.now / 3600000), r = rng('corp:' + p.name + ':' + hour);
    const cands = Array.from({ length: 6 }, (_, i) => { const role = ['miner', 'trader', 'hunter'][i % 3]; const lv = 1 + Math.floor(r() * 3);
      return { id: hour + ':' + i, role, lv, name: CORP.first[Math.floor(r() * CORP.first.length)] + ' ' + CORP.last[Math.floor(r() * CORP.last.length)], fee: CORP.hireFee * lv * lv }; })
      .filter(x => !(c && c.members.some(m => m.cand === x.id)));
    return { t: 'corp', corp: c ? { ...c, slots: this.corpSlots(p), next: CORP.levels[c.level + 1] || null, rateH: c.members.reduce((a, m) => a + (m.downUntil > this.now ? 0 : CORP.roles[m.role].cr * m.lv), 0) } : null,
      cost: CORP.cost, roles: CORP.roles, emblems: CORP.emblems, colors: CORP.colors, cands, now: this.now };
  };
  P.c_corpInfo = function (s, m, p) { s.send(this.corpView(p)); };
  P.c_corpCreate = function (s, m, p) {
    if (p.corp) return;
    const name = String(m.name || '').replace(/[<>]/g, '').trim().slice(0, 28), tag = String(m.tag || '').replace(/[^A-Za-zА-Яа-яЁё0-9]/g, '').slice(0, 4).toUpperCase();
    if (name.length < 3 || tag.length < 2) return this.notify(s, 'Название — от 3 знаков, тег — 2–4 буквы или цифры', 'warn');
    if (p.credits < CORP.cost) return this.notify(s, `Нужно ${fmt(CORP.cost)} CR`, 'warn');
    p.credits -= CORP.cost;
    p.corp = { name, tag, emblem: CORP.emblems.includes(m.emblem) ? m.emblem : CORP.emblems[0], color: CORP.colors.includes(m.color) ? m.color : CORP.colors[0],
      level: 1, treasury: 0, hangar: {}, members: [], log: [], at: this.now, founded: this.now };
    this.corpLog(p, `Корпорация «${name}» [${tag}] основана`);
    this.notify(s, `🏛 Корпорация «${name}» [${tag}] основана! Нанимайте пилотов — они будут работать на казну`, 'good');
    this.sendProfile(s); s.send(this.corpView(p)); this.save();
  };
  P.corpLog = function (p, text) { const c = p.corp; c.log.unshift({ t: this.now, text }); c.log.length = Math.min(c.log.length, 30); };
  P.c_corpHire = function (s, m, p) {
    const c = p.corp; if (!c) return;
    const cand = this.corpView(p).cands.find(x => x.id === m.id); if (!cand) return this.notify(s, 'Этот пилот уже нашёл работу — список обновился', 'warn');
    if (c.members.length >= this.corpSlots(p)) return this.notify(s, `Все места заняты (${this.corpSlots(p)}). Улучшите корпорацию`, 'warn');
    if (p.credits < cand.fee) return this.notify(s, `Недостаточно CR: нужно ${fmt(cand.fee)}`, 'warn');
    p.credits -= cand.fee;
    c.members.push({ id: uid(), cand: cand.id, name: cand.name, role: cand.role, lv: cand.lv, xp: CORP.xpNeed[cand.lv - 1] || 0, downUntil: 0, earned: 0 });
    this.corpLog(p, `${CORP.roles[cand.role].name} ${cand.name} вступил в корпорацию`);
    this.notify(s, `${cand.name} теперь в вашей корпорации`, 'good');
    this.sendProfile(s); s.send(this.corpView(p)); this.save();
  };
  P.c_corpFire = function (s, m, p) {
    const c = p.corp; if (!c) return;
    const i = c.members.findIndex(x => x.id === m.id); if (i < 0) return;
    const [x] = c.members.splice(i, 1); this.corpLog(p, `${x.name} покинул корпорацию`);
    s.send(this.corpView(p)); this.save();
  };
  P.c_corpUpgrade = function (s, m, p) {
    const c = p.corp; if (!c) return;
    const n = CORP.levels[c.level + 1]; if (!n) return this.notify(s, 'Корпорация уже максимального уровня', 'warn');
    if (p.credits < n.cost) return this.notify(s, `Нужно ${fmt(n.cost)} CR`, 'warn');
    p.credits -= n.cost; c.level++;
    this.corpLog(p, `Корпорация выросла до уровня ${c.level}`);
    this.notify(s, `🏛 Уровень корпорации ${c.level}: мест — ${this.corpSlots(p)}`, 'good');
    this.sendProfile(s); s.send(this.corpView(p)); this.save();
  };
  P.c_corpWithdraw = function (s, m, p) {
    const c = p.corp; if (!c || c.treasury <= 0) return;
    const sum = Math.floor(c.treasury); p.credits += sum; c.treasury -= sum;
    this.notify(s, `Из казны получено ${fmt(sum)} CR`, 'good');
    this.sendProfile(s); s.send(this.corpView(p)); this.save();
  };
  // общий склад → ангар станции, где вы пристыкованы
  P.c_corpUnload = function (s, m, p) {
    const c = p.corp; if (!c) return;
    const st = this.requireDocked(s); if (!st) return;
    const h = this.hangar(p, st).items; let n = 0;
    for (const [k, q] of Object.entries(c.hangar)) { h[k] = (h[k] || 0) + q; n += q; }
    c.hangar = {};
    this.notify(s, n ? `Общий склад выгружен в ангар станции: ${fmt(n)} ед.` : 'Общий склад пуст', n ? 'good' : 'info');
    this.sendProfile(s); s.send(this.corpView(p)); this.save();
  };
  P.c_corpStyle = function (s, m, p) {
    const c = p.corp; if (!c) return;
    if (CORP.emblems.includes(m.emblem)) c.emblem = m.emblem;
    if (CORP.colors.includes(m.color)) c.color = m.color;
    this.sendProfile(s); s.send(this.corpView(p)); this.save();
  };

  // работа участников: раз в минуту, с учётом прошедшего времени (и без пилота в сети)
  P.corpWork = function (p) {
    const c = p.corp; if (!c) return null;
    const mins = Math.min(24 * 60, Math.floor((this.now - c.at) / 60000)); if (mins < 1) return null;
    c.at += mins * 60000;
    const events = [];
    for (const mb of c.members) {
      if (mb.downUntil > this.now) continue;
      const R = CORP.roles[mb.role], cr = R.cr * mb.lv * mins / 60;
      c.treasury += cr; mb.earned = (mb.earned || 0) + cr;
      if (R.ore) { const ore = mb.lv >= 3 ? 'ore_arkselit' : 'ore_korundit'; c.hangar[ore] = (c.hangar[ore] || 0) + Math.round(12 * mb.lv * mins / 60); }
      if (R.loot && Math.random() < 0.05 * mins / 60 * mb.lv) { c.hangar.salv_core = (c.hangar.salv_core || 0) + 1; events.push(`${mb.name} принёс трофей: пиратское ядро`); }
      if (Math.random() < 0.1 * mins / 60 && mb.lv < 5) { mb.xp++; if (mb.xp >= CORP.xpNeed[mb.lv]) { mb.lv++; events.push(`${mb.name} вырос до уровня ${mb.lv}`); } }
      if (Math.random() < R.risk * mins / 60) { mb.downUntil = this.now + CORP.downMs; events.push(`${mb.name} ${mb.role === 'hunter' ? 'сбит в бою' : 'попал в засаду'} — выбыл на 30 минут`); }
    }
    for (const e of events) this.corpLog(p, e);
    return events;
  };
  P.slowTick = function () {
    baseSlow.call(this);
    if (this._corpAt && this.now - this._corpAt < 60000) return;
    this._corpAt = this.now;
    for (const p of Object.values(this.db.players)) {
      if (!p.corp) continue;
      const ev = this.corpWork(p);
      const s = ev && [...this.sessions].find(x => x.player === p);
      if (s) for (const e of ev) this.notify(s, '🏛 ' + e, 'info');
    }
  };
};
module.exports.CORP = CORP;
