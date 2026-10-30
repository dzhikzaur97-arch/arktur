// Карьера пилота, достижения, звания и таблица лидеров.
// «Карьера» — цепочка из 10 шагов, которая по очереди знакомит с системами игры (производство, напарники,
// война фракций, пиратские базы, мировые события, посадка на планеты) и платит за каждый шаг.
// Достижения открываются сами по счётчикам пилота; некоторые дают звание, которое видно в таблице лидеров.
// Таблица лидеров — общий рейтинг пилотов-людей и ИИ-пилотов галактики.
'use strict';
const { SHIPS, BLUEPRINTS, SYSTEMS } = require('./data');

const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const st = (p, k) => (p.stats && p.stats[k]) || 0;
const hasBp = (p) => Object.keys(p.ship.cargo || {}).some(k => BLUEPRINTS[k]) || Object.values(p.hangars || {}).some(h => Object.keys(h.items || {}).some(k => BLUEPRINTS[k]));
const shipsOwned = (p) => 1 + Object.values(p.hangars || {}).reduce((a, h) => a + (h.ships || []).length, 0);
const skillSum = (p) => Object.values(p.skills || {}).reduce((a, b) => a + b, 0);

const CAREER = [
  { id: 'skill', title: 'Начните изучать навык «Производство»', hint: 'Навыки → группа «Промысел» → Производство. Навык растёт, даже когда вы не в игре.',
    check: (p) => (p.skills.industry || 0) > 0 || (p.training && p.training.skill === 'industry'), isk: 20000 },
  { id: 'bp', title: 'Купите первый чертёж', hint: 'На станции: вкладка «Производство» → «Магазин чертежей». Дешевле всего — ракеты и лёгкие модули.',
    check: hasBp, isk: 15000 },
  { id: 'build', title: 'Произведите первое изделие', hint: '«Производство» → «Мои чертежи» → «Запустить». Отметьте «докупить недостающее», если материалов нет.',
    check: (p) => st(p, 'built') > 0, isk: 30000, items: { mat_steel: 40, mat_ceramite: 15 } },
  { id: 'wing', title: 'Наймите напарника', hint: 'На станции: вкладка «Напарники». Шахтёр копает в ваш трюм, боец защищает, ремонтник чинит.',
    check: (p) => (p.wing || []).length > 0, isk: 40000 },
  { id: 'wingwin', title: 'Победа вашего напарника', hint: 'Отстыкуйтесь и слетайте в пояс астероидов с пиратами: напарник сам ответит нападающим.',
    check: (p) => st(p, 'wingKills') > 0, isk: 30000 },
  { id: 'land', title: 'Высадитесь на планету', hint: 'Подлетите к планете и нажмите «Посадка». На поверхности — ресурсы, животные и открытия.',
    check: (p) => st(p, 'landings') > 0, isk: 25000 },
  { id: 'war', title: 'Вступите в войну фракций', hint: 'Вкладка «Фронт» на станции. Патрули противника начнут атаковать вас на границе ⚔.',
    check: (p) => !!p.war || st(p, 'medals') > 0, isk: 50000 },
  { id: 'medals', title: 'Получите 3 знака отличия', hint: 'Сбивайте патрули противника у метки «Линия фронта» или выполняйте задания во вкладке «Фронт».',
    check: (p) => st(p, 'medals') >= 3, isk: 75000 },
  { id: 'pbase', title: 'Уничтожьте пиратскую базу', hint: 'В каждой системе есть пиратская база ☠. Возьмите напарников и дронов: волны охраны идут одна за другой.',
    check: (p) => st(p, 'pbases') > 0, isk: 100000 },
  { id: 'boss', title: 'Сразитесь в мировом событии', hint: 'Ждите новость ☄: Колосс Предтеч или дредноут. Нанесите боссу урон — награда по вкладу.',
    check: (p) => st(p, 'wevents') > 0, isk: 150000, rareBp: true }
];

// t — звание, которое даёт достижение
const ACH = [
  { id: 'miner1', name: 'Шахтёр', desc: 'Добыть 10 000 единиц руды', check: (p) => st(p, 'mined') >= 1e4 },
  { id: 'miner2', name: 'Горный магнат', desc: 'Добыть 200 000 единиц руды', check: (p) => st(p, 'mined') >= 2e5, t: 'Горный магнат' },
  { id: 'hunt1', name: 'Охотник', desc: 'Уничтожить 25 пиратов', check: (p) => st(p, 'npcKills') >= 25 },
  { id: 'hunt2', name: 'Гроза Скверны', desc: 'Уничтожить 250 пиратов', check: (p) => st(p, 'npcKills') >= 250, t: 'Гроза Скверны' },
  { id: 'pbase1', name: 'Штурмовик', desc: 'Уничтожить пиратскую базу', check: (p) => st(p, 'pbases') >= 1 },
  { id: 'pbase2', name: 'Сокрушитель баз', desc: 'Уничтожить 10 пиратских баз', check: (p) => st(p, 'pbases') >= 10, t: 'Сокрушитель баз' },
  { id: 'rich1', name: 'Состоятельный', desc: 'Иметь 1 000 000 ISK', check: (p) => p.credits >= 1e6 },
  { id: 'rich2', name: 'Магнат', desc: 'Иметь 50 000 000 ISK', check: (p) => p.credits >= 5e7, t: 'Магнат' },
  { id: 'build1', name: 'Инженер', desc: 'Произвести 10 изделий', check: (p) => st(p, 'built') >= 10, t: 'Инженер' },
  { id: 'build2', name: 'Промышленник', desc: 'Произвести 200 изделий', check: (p) => st(p, 'built') >= 200, t: 'Промышленник' },
  { id: 'war1', name: 'Солдат фронта', desc: 'Заработать 10 знаков отличия', check: (p) => st(p, 'medals') >= 10 },
  { id: 'war2', name: 'Ветеран фронта', desc: 'Заработать 100 знаков отличия', check: (p) => st(p, 'medals') >= 100, t: 'Ветеран фронта' },
  { id: 'war3', name: 'Завоеватель', desc: 'Участвовать во взятии системы', check: (p) => st(p, 'captures') >= 1, t: 'Завоеватель' },
  { id: 'boss1', name: 'Охотник на Колоссов', desc: 'Участвовать в победе над боссом мирового события', check: (p) => st(p, 'wevents') >= 1, t: 'Охотник на Колоссов' },
  { id: 'boss2', name: 'Убийца титанов', desc: 'Победить 5 боссов мировых событий', check: (p) => st(p, 'wevents') >= 5, t: 'Убийца титанов' },
  { id: 'wing1', name: 'Командир звена', desc: 'Собрать полное звено из трёх напарников', check: (p) => (p.wing || []).length >= 3, t: 'Командир звена' },
  { id: 'wing2', name: 'Наставник', desc: 'Вырастить напарника до 5 уровня', check: (p) => (p.wing || []).some(w => w.lv >= 5), t: 'Наставник' },
  { id: 'story1', name: 'Хранитель тайны', desc: 'Пройти кампанию «Неизвестный сигнал»', check: (p) => !!(p.story && p.story.m >= 12), t: 'Хранитель тайны' },
  { id: 'story2', name: 'Наследник Предтеч', desc: 'Пройти кампанию «Эхо Колосса»', check: (p) => !!(p.story && p.story.c2done), t: 'Наследник Предтеч' },
  { id: 'skills', name: 'Профессионал', desc: 'Набрать 25 уровней навыков', check: (p) => skillSum(p) >= 25 },
  { id: 'fleet', name: 'Коллекционер', desc: 'Владеть пятью кораблями', check: (p) => shipsOwned(p) >= 5 },
  { id: 'explorer', name: 'Покоритель Края', desc: 'Побывать в Глубоком космосе', check: (p) => st(p, 'deep') > 0, t: 'Покоритель Края' },
  { id: 'lander', name: 'Исследователь миров', desc: 'Совершить 10 посадок на планеты', check: (p) => st(p, 'landings') >= 10 }
];
// звание по числу достижений, если пилот не выбрал своё
const RANKS = [[0, 'Новичок'], [3, 'Пилот'], [7, 'Ветеран'], [12, 'Ас'], [18, 'Легенда']];
const rankOf = (n) => RANKS.filter(([k]) => n >= k).pop()[1];
const DEEP = new Set(SYSTEMS.filter(s => s.region === 'deep').map(s => s.id));

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick, baseLogin = P.login;

  P.careerView = function (p) {
    const c = p.career || (p.career = { step: 0 });
    const ach = p.ach || {};
    const n = Object.keys(ach).length;
    const titles = ACH.filter(a => a.t && ach[a.id]).map(a => a.t);
    return {
      steps: CAREER.map((x, i) => ({ id: x.id, title: x.title, hint: x.hint, isk: x.isk, done: i < c.step, cur: i === c.step, extra: x.items ? 'и материалы' : x.rareBp ? 'и редкий чертёж' : '' })),
      step: c.step, total: CAREER.length,
      ach: ACH.map(a => ({ id: a.id, name: a.name, desc: a.desc, t: a.t || null, at: ach[a.id] || 0 })),
      rank: rankOf(n), title: p.title && titles.includes(p.title) ? p.title : rankOf(n), titles
    };
  };
  P.c_careerInfo = function (s, m, p) { s.send({ t: 'career', ...this.careerView(p) }); };
  P.c_setTitle = function (s, m, p) {
    const v = this.careerView(p);
    if (m.title && !v.titles.includes(m.title)) return;
    p.title = m.title || null;
    this.notify(s, `Звание: ${p.title || v.rank}`, 'good');
    this.c_careerInfo(s, m, p); this.save();
  };

  // проверка шагов карьеры и достижений — раз в 2 секунды для пилотов в игре
  P.careerTick = function () {
    if (this._careerAt && this.now - this._careerAt < 2000) return;
    this._careerAt = this.now;
    for (const s of this.sessions) {
      const p = s.player; if (!p || p.bot) continue;
      if (s.ent && DEEP.has(s.ent.sys) && !st(p, 'deep')) p.stats.deep = 1;
      let changed = false;
      const c = p.career || (p.career = { step: 0 });
      // несколько шагов подряд могут быть уже выполнены — засчитываем все
      while (c.step < CAREER.length && CAREER[c.step].check(p)) {
        const x = CAREER[c.step]; c.step++; changed = true;
        p.credits += x.isk;
        const h = this.hangar(p, p.home), got = [];
        for (const [it, q] of Object.entries(x.items || {})) { h.items[it] = (h.items[it] || 0) + q; got.push(it); }
        if (x.rareBp) { const bp = this.rareBlueprint(); if (bp) { h.items[bp] = (h.items[bp] || 0) + 1; got.push(bp); } }
        this.notify(s, `🎖 Карьера ${c.step}/${CAREER.length}: «${x.title}» — +${fmt(x.isk)} ISK${got.length ? ', подарки в ангаре домашней станции' : ''}`, 'good');
        if (c.step === CAREER.length) this.notify(s, '🎖 Карьера пилота пройдена целиком! Теперь вы знаете все системы галактики.', 'good');
      }
      p.ach = p.ach || {};
      for (const a of ACH) if (!p.ach[a.id] && a.check(p)) {
        p.ach[a.id] = this.now; changed = true;
        const bonus = a.t ? 50000 : 20000;
        p.credits += bonus;
        this.notify(s, `🏆 Достижение «${a.name}»: ${a.desc}. +${fmt(bonus)} ISK${a.t ? ` · новое звание «${a.t}»` : ''}`, 'good');
        s.send({ t: 'achieve', id: a.id, name: a.name, desc: a.desc, title: a.t || null });
      }
      if (changed) { this.sendProfile(s); this.c_careerInfo(s, {}, p); this.save(); }
    }
  };

  // рейтинг: деньги и имущество, победы, вклад в войну и события, достижения
  P.scoreOf = function (p) {
    const worth = p.credits + (SHIPS[p.ship.type] ? SHIPS[p.ship.type].price : 0);
    return Math.round(worth / 1000 + st(p, 'npcKills') * 20 + st(p, 'kills') * 50 + st(p, 'pbases') * 500 + st(p, 'medals') * 50 + st(p, 'wevents') * 1000
      + Object.keys(p.ach || {}).length * 300 + st(p, 'mined') / 200 + st(p, 'built') * 5);
  };
  P.c_leaders = function (s, m, p) {
    const rows = [];
    for (const q of Object.values(this.db.players)) {
      if (q.bot) continue;
      const v = this.careerView(q);
      rows.push({ name: q.name, human: true, me: q === p, title: v.title, score: this.scoreOf(q), ach: Object.keys(q.ach || {}).length, kills: st(q, 'npcKills') + st(q, 'kills'), ship: q.ship.type });
    }
    for (const a of (this.db.ai ? this.db.ai.pilots : [])) {
      const worth = a.credits + (SHIPS[a.ship] ? SHIPS[a.ship].price : 0);
      rows.push({ name: a.name, human: false, title: { miner: 'Шахтёр', hunter: 'Охотник за головами', trader: 'Торговец', pirate: 'Пиратский главарь' }[a.role] || 'ИИ-пилот',
        score: Math.round((worth + (a.earned || 0)) / 1000 + (a.kills || 0) * 20 + (a.built || 0) * 200), ach: 0, kills: a.kills || 0, ship: a.ship });
    }
    rows.sort((a, b) => b.score - a.score);
    rows.forEach((r, i) => { r.place = i + 1; });
    const mine = rows.find(r => r.me);
    s.send({ t: 'leaders', top: rows.slice(0, 25), me: mine && mine.place > 25 ? mine : null, total: rows.length });
  };

  P.slowTick = function () {
    baseSlow.call(this);
    this.careerTick();
  };
  P.login = function (sess, name, pass) {
    baseLogin.call(this, sess, name, pass);
    if (sess.player && !sess.isBot) this.c_careerInfo(sess, {}, sess.player);
  };
};
module.exports.CAREER = CAREER;
module.exports.ACH = ACH;
