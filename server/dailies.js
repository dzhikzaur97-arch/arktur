// Ежедневные задания, бонус за вход и покраска кораблей.
// Каждый день — три задания из пула (по счётчикам пилота: добыча, пираты, производство, фронт, напарники,
// планеты, особые задания, пиратские базы); набор зависит от того, что пилоту уже доступно.
// Бонус за вход растёт с каждым днём подряд (до 7), на седьмой день — редкий чертёж.
'use strict';
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const st = (p, k) => (p.stats && p.stats[k]) || 0;
const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
const POOL = [
  { id: 'mine', stat: 'mined', need: 3000, isk: 40000, text: 'Добудьте 3 000 единиц руды' },
  { id: 'hunt', stat: 'npcKills', need: 6, isk: 50000, text: 'Уничтожьте 6 пиратов' },
  { id: 'build', stat: 'built', need: 2, isk: 35000, text: 'Выполните 2 заказа производства' },
  { id: 'land', stat: 'landings', need: 1, isk: 30000, text: 'Высадитесь на любую планету' },
  { id: 'harvest', stat: 'harvested', need: 300, isk: 40000, text: 'Соберите 300 ресурсов на поверхности планет' },
  { id: 'war', stat: 'medals', need: 2, isk: 60000, text: 'Заработайте 2 знака отличия на фронте', when: (p) => !!p.war },
  { id: 'wing', stat: 'wingKills', need: 4, isk: 40000, text: 'Ваши напарники должны одержать 4 победы', when: (p) => (p.wing || []).length > 0 },
  { id: 'cm', stat: 'cmissions', need: 1, isk: 70000, text: 'Выполните особое задание (вкладка «Агенты»)' },
  { id: 'pbase', stat: 'pbases', need: 1, isk: 120000, text: 'Уничтожьте пиратскую базу' }
];
const PALETTE = [0x9fb4c8, 0xd8dee8, 0x2b2f36, 0xc0392b, 0xe67e22, 0xf1c40f, 0x27ae60, 0x16a085, 0x2980b9, 0x8e44ad, 0xe84393, 0xb08d57];
const PAINT_COST = 5000;
// внешний вид: второй цвет ливреи, цвет полос, цвет пламени двигателей, герб на корпусе
const ENGINES = [0x40b8ff, 0xff9a3a, 0xb47cff, 0x70ff90, 0xff4070, 0xffffff, 0xffd860, 0x30fff0];
const EMBLEMS = ['✦', '◆', '⬢', '☄', '⚔', '♜', '✪', '☀', '❖', '⚓', '♛', '✹'];
const LOOK_COST = 15000;

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick, baseLogin = P.login;

  P.dailyOf = function (p, s) {
    const today = dayKey(this.now);
    const d = p.daily || (p.daily = { day: null, tasks: [], streak: 0, lastDay: null });
    if (d.day === today) return d;
    // новый день: бонус за вход и свежие задания
    const yesterday = dayKey(this.now - 86400000);
    d.streak = d.lastDay === yesterday ? d.streak + 1 : 1;
    d.lastDay = today; d.day = today;
    const bonus = 15000 * Math.min(7, d.streak);
    p.credits += bonus;
    let gift = null;
    if (d.streak % 7 === 0) { gift = this.rareBlueprint && this.rareBlueprint(); if (gift) { const h = this.hangar(p, p.home); h.items[gift] = (h.items[gift] || 0) + 1; } }
    if (s) this.notify(s, `🎁 Бонус за вход: день ${d.streak} подряд — +${fmt(bonus)} CR${gift ? ' и редкий чертёж (в ангаре домашней станции)' : ''}`, 'good');
    const avail = POOL.filter(x => !x.when || x.when(p));
    let seed = [...(today + p.name)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const pick = [];
    while (pick.length < 3 && avail.length) { seed = (seed * 1103515245 + 12345) >>> 0; pick.push(avail.splice(seed % avail.length, 1)[0]); }
    d.tasks = pick.map(x => ({ id: x.id, stat: x.stat, text: x.text, need: x.need, isk: Math.round(x.isk * (1 + 0.1 * (Math.min(7, d.streak) - 1))), base: st(p, x.stat), done: false }));
    return d;
  };
  P.dailyView = function (p) {
    const d = this.dailyOf(p);
    return { streak: d.streak, tasks: d.tasks.map(t => ({ text: t.text, need: t.need, prog: Math.min(t.need, st(p, t.stat) - t.base), isk: t.isk, done: t.done })),
      nextBonus: 15000 * Math.min(7, d.streak + 1), palette: PALETTE, paintCost: PAINT_COST, engines: ENGINES, emblems: EMBLEMS, lookCost: LOOK_COST };
  };
  P.c_dailyInfo = function (s, m, p) { s.send({ t: 'daily', ...this.dailyView(p) }); };

  P.dailyTick = function () {
    if (this._dailyAt && this.now - this._dailyAt < 3000) return;
    this._dailyAt = this.now;
    for (const s of this.sessions) {
      const p = s.player; if (!p || p.bot) continue;
      const before = p.daily && p.daily.day;
      const d = this.dailyOf(p, s);
      let changed = before !== d.day;
      for (const t of d.tasks) if (!t.done && st(p, t.stat) - t.base >= t.need) {
        t.done = true; p.credits += t.isk; changed = true;
        this.notify(s, `📅 Ежедневное задание выполнено: ${t.text} — +${fmt(t.isk)} CR`, 'good');
        if (d.tasks.every(x => x.done)) this.notify(s, '📅 Все задания на сегодня выполнены! Завтра — новые, а бонус за вход вырастет.', 'good');
      }
      if (changed) { this.sendProfile(s); this.c_dailyInfo(s, {}, p); this.save(); }
    }
  };

  // покраска активного корабля на станции
  P.c_paint = function (s, m, p) {
    if (!this.requireDocked(s)) return;
    const c = m.color == null ? null : +m.color;
    if (c !== null && !PALETTE.includes(c)) return;
    if (c !== null) {
      if (p.credits < PAINT_COST) return this.notify(s, `Покраска стоит ${fmt(PAINT_COST)} CR`, 'warn');
      p.credits -= PAINT_COST;
    }
    p.ship.paint = c;
    this.notify(s, c === null ? 'Заводская окраска восстановлена' : `Корабль перекрашен (−${fmt(PAINT_COST)} CR)`, 'good');
    this.sendProfile(s); this.save();
  };

  P.c_look = function (s, m, p) {
    if (!this.requireDocked(s)) return;
    const k = m.k, v = m.v == null || m.v === '' ? null : m.v;
    const ok = { second: (x) => PALETTE.includes(+x), accent: (x) => PALETTE.includes(+x), engine: (x) => ENGINES.includes(+x), emblem: (x) => EMBLEMS.includes(x), emc: (x) => PALETTE.includes(+x) || +x === 0xffffff };
    if (!ok[k] || (v !== null && !ok[k](v))) return;
    const look = p.ship.look || (p.ship.look = {});
    if (v !== null) {
      const free = k === 'emc' || (k === 'emblem' && p.corp && p.corp.emblem === v);
      if (!free) { if (p.credits < LOOK_COST) return this.notify(s, `Стоит ${fmt(LOOK_COST)} CR`, 'warn'); p.credits -= LOOK_COST; }
      look[k] = k === 'emblem' ? v : +v;
    } else delete look[k];
    this.notify(s, { second: 'Второй цвет корпуса', accent: 'Цвет полос', engine: 'Цвет двигателей', emblem: 'Герб', emc: 'Цвет герба' }[k] + (v === null ? ' — по умолчанию' : ' обновлён'), 'good');
    this.sendProfile(s); this.save();
  };

  P.slowTick = function () {
    baseSlow.call(this);
    this.dailyTick();
  };
  P.login = function (sess, name, pass) {
    baseLogin.call(this, sess, name, pass);
    if (sess.player && !sess.player.bot && !sess.isBot) { this.dailyOf(sess.player, sess); this.c_dailyInfo(sess, {}, sess.player); } // ИИ-ученикам бонусы не положены
  };
};
module.exports.POOL = POOL;
module.exports.PALETTE = PALETTE;
