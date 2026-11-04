// Мечта и пути пилота: шесть профессий по 10 рангов, собранные из того, что уже есть в игре.
// Опыт пути считается из счётчиков пилота (p.stats и т. п.), поэтому старые сохранения сразу получают ранги.
// Мечта — путь, который пилот выбрал главным: его опыт идёт ×1.25, награды за ранги ×1.5,
// а на экране всегда виден следующий шаг к нему.
'use strict';

const RANK_XP = [0, 100, 300, 700, 1500, 3000, 6000, 12000, 25000, 50000];
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const st = (p, k) => (p.stats && p.stats[k]) || 0;

// шаг: [ключ, очков за единицу, что сделать, где/как, функция значения (по умолчанию p.stats[ключ]), делитель единицы]
const PATHS = {
  hunter: {
    name: 'Охотник за головами', icon: '⚔', desc: 'Пираты, главари с доски розыска, пиратские базы и крепости.',
    ranks: ['Новобранец', 'Стрелок', 'Охотник', 'Ловчий', 'Гроза поясов', 'Палач пиратов', 'Ловец главарей', 'Страх Скверны', 'Легенда охоты', 'Охотник за головами'],
    top: 'Добить всех главарей сектора',
    steps: [
      ['npcKills', 10, 'Уничтожьте пирата', 'Пояса астероидов в системах с безопасностью 0.6 и ниже'],
      ['pbases', 400, 'Уничтожьте пиратскую базу ☠', 'Есть в каждой системе; возьмите напарников и дронов'],
      ['wantedKills', 300, 'Закройте заказ с доски розыска', '📰 Сводка → Доска розыска'],
      ['captures', 80, 'Возьмите пирата в плен', 'Добейте пирата сетью или выкупом'],
      ['kills', 30, 'Победите пилота-преступника', 'Низкая безопасность и нули']
    ]
  },
  industry: {
    name: 'Промышленник', icon: '⚒', desc: 'Добыча руды и газа, переработка, производство, базы на планетах, своя верфь.',
    ranks: ['Старатель', 'Бурильщик', 'Мастер забоя', 'Технолог', 'Инженер', 'Начальник цеха', 'Заводчик', 'Промышленник', 'Магнат недр', 'Строитель титанов'],
    top: 'Построить титан «Император»',
    steps: [
      ['mined', 1, 'Добудьте руду', 'Пояса астероидов; 1 очко за 100 единиц', null, 100],
      ['built', 30, 'Произведите изделие по чертежу', 'Станция → Производство'],
      ['harvested', 1, 'Соберите газ', 'Газовые облака ☁; 1 очко за 100 единиц', null, 100],
      ['outposts', 300, 'Постройте базу на планете', 'Посадка на планету → «Основать базу»'],
      ['yardShips', 600, 'Соберите корабль на своей верфи', 'Станция → Верфь'],
      ['imperator', 5000, 'Достройте титан «Император»', '👑 Стройки']
    ]
  },
  trader: {
    name: 'Торговец', icon: '⚖', desc: 'Маршруты и разница цен, перевозки, пассажиры, чёрный рынок.',
    ranks: ['Лоточник', 'Перевозчик', 'Купец', 'Экспедитор', 'Оптовик', 'Хозяин каравана', 'Торговый дом', 'Король караванов', 'Владыка рынков', 'Торговая империя'],
    top: 'Выручить 500 млн CR на торговле',
    steps: [
      ['tradeEarned', 1, 'Продайте товар с наценкой', 'Станция → Торговля → «Маршруты»; 1 очко за 5 000 CR выручки', null, 5000],
      ['taxi', 80, 'Довезите пассажиров или срочный груз', 'Агенты станции → «Пассажиры»'],
      ['missions', 40, 'Выполните задание агента', 'Станция → Агенты']
    ]
  },
  explorer: {
    name: 'Исследователь', icon: '✦', desc: 'Зонды и скрытые сигналы, посадки на планеты, аномалии Предтеч, Глубокий космос.',
    ranks: ['Турист', 'Штурман', 'Разведчик', 'Следопыт', 'Картограф', 'Первопроходец', 'Ксенолог', 'Хранитель тайн', 'Покоритель Края', 'Открыватель миров'],
    top: 'Побывать во всех системах сектора',
    steps: [
      ['visited', 60, 'Побывайте в новой системе', 'Звёздная карта → маршрут → автопилот'],
      ['sigFound', 120, 'Найдите скрытый сигнал зондами', 'Карта системы → «📡 Зонды»'],
      ['landings', 100, 'Высадитесь на планету', 'Подлетите к планете и нажмите «Посадка»'],
      ['relics', 300, 'Вскройте тайник Предтеч', 'Аномалии Предтеч: хранилище, страж, шторм, кладбище'],
      ['races', 80, 'Пройдите гоночную трассу 🏁', 'Арктур, Велла, Кассиопа, Люмен, Сириан, Полярис'],
      ['deep', 800, 'Доберитесь до Глубокого космоса', 'Через червоточины и врата за Краем']
    ]
  },
  hero: {
    name: 'Герой фракции', icon: '✠', desc: 'Сюжет, война фракций, задания агентов, мировые события.',
    ranks: ['Доброволец', 'Курсант', 'Боец', 'Сержант', 'Лейтенант', 'Капитан', 'Майор', 'Полковник', 'Командарм', 'Герой сектора'],
    top: 'Победить Архонта Края',
    steps: [
      ['storyDone', 150, 'Пройдите сюжетную миссию', 'Задания (J) → сюжет'],
      ['medals', 120, 'Заработайте знак отличия', 'Станция → «Фронт»: патрули у линии фронта'],
      ['wevents', 250, 'Сразитесь в мировом событии ☄', 'Следите за новостью «Мировое событие»'],
      ['cmissions', 200, 'Выполните особое задание', 'Станция → Агенты → особое задание'],
      ['archon', 4000, 'Победите Архонта Края', 'Система Край → «Врата за Край»']
    ]
  },
  commander: {
    name: 'Командор', icon: '♛', desc: 'Напарники, флот эскорта, корпорация, своя система, истории кораблей.',
    ranks: ['Одиночка', 'Ведущий', 'Командир звена', 'Капитан крыла', 'Комэск', 'Коммодор', 'Командор', 'Адмирал', 'Флотоводец', 'Владыка флотов'],
    top: 'Своя система и флот из 6 кораблей',
    steps: [
      ['wing', 150, 'Наймите напарника', 'Станция → Напарники', (p) => (p.wing || []).length],
      ['wingKills', 25, 'Победа ваших напарников', 'Возьмите напарников в бой'],
      ['shipChains', 300, 'Пройдите историю корабля', 'Задания → история вашего корабля'],
      ['corp', 800, 'Основайте корпорацию', '🏛 Корпорация', (p) => p.corp ? 1 : 0],
      ['sovIncome', 1, 'Получайте доход со своей системы', '👑 Стройки → своя система; 1 очко за 20 000 CR', null, 20000]
    ]
  }
};

const valOf = (p, step) => step[4] ? step[4](p) : st(p, step[0]);
function pathXp(p, id) {
  const P = PATHS[id];
  let xp = 0;
  for (const s of P.steps) xp += Math.floor(valOf(p, s) / (s[5] || 1)) * s[1];
  if (p.dream === id) xp = Math.round(xp * 1.25);
  return xp;
}
const rankOf = (xp) => { let r = 0; for (const t of RANK_XP) if (xp >= t) r++; return r; };
function nextStep(p, id) {
  const P = PATHS[id];
  // сначала знакомим с занятиями, к которым пилот ещё не прикасался; потом — самое выгодное
  const fresh = P.steps.find(s => valOf(p, s) === 0);
  return fresh || P.steps.slice().sort((a, b) => b[1] / (b[5] || 1) - a[1] / (a[5] || 1))[0];
}

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseComplete = P.completeMission, baseJump = P.jump, baseSlow = P.slowTick, baseLogin = P.login;
  const baseRelic = P.relicCache, baseNext = P.nextMission;
  const inc = (p, k, n = 1) => { if (p) { p.stats = p.stats || {}; p.stats[k] = (p.stats[k] || 0) + n; } };

  P.completeMission = function (p, ms, s) { const r = baseComplete.apply(this, arguments); inc(p, 'missions'); return r; };
  if (baseNext) P.nextMission = function (s, p) { inc(p, 'storyDone'); return baseNext.apply(this, arguments); };
  if (baseRelic) P.relicCache = function (a) {
    const r = baseRelic.apply(this, arguments);
    // тайник открыл тот, кто рядом: всем пилотам-людям в системе аномалии
    for (const s of this.sessions) if (s.ent && s.player && s.ent.sys === a.sys) inc(s.player, 'relics');
    return r;
  };
  P.jump = function (e, gate) {
    const r = baseJump.apply(this, arguments);
    const p = e && e.owner && this.db.players[e.owner];
    if (p) { p.seen = p.seen || {}; if (!p.seen[gate.dest]) { p.seen[gate.dest] = 1; inc(p, 'visited'); } }
    return r;
  };

  P.pathsView = function (p) {
    return {
      t: 'paths', dream: p.dream || null, rankXp: RANK_XP,
      list: Object.entries(PATHS).map(([id, D]) => {
        const xp = pathXp(p, id), r = rankOf(xp), ns = nextStep(p, id);
        return { id, name: D.name, icon: D.icon, desc: D.desc, top: D.top, xp, rank: r, rankName: D.ranks[r - 1], nextRankName: D.ranks[r] || null,
          need: r < 10 ? RANK_XP[r] - xp : 0, next: ns ? { text: ns[2], hint: ns[3], pts: ns[1], per: ns[5] || 1 } : null,
          steps: D.steps.map(s => ({ text: s[2], hint: s[3], pts: s[1], per: s[5] || 1, have: valOf(p, s) })) };
      })
    };
  };
  P.c_pathsInfo = function (s, m, p) { s.send(this.pathsView(p)); };
  P.c_dream = function (s, m, p) {
    if (!PATHS[m.id]) return;
    const first = !p.dream;
    p.dream = m.id;
    this.notify(s, `${first ? 'Мечта выбрана' : 'Мечта изменена'}: ${PATHS[m.id].icon} ${PATHS[m.id].name}. Её опыт идёт ×1.25, награды за ранги ×1.5`, 'good');
    this.pathsCheck(s, true); s.send(this.pathsView(p)); this.save();
  };
  // награды за новые ранги; quiet — первый расчёт для старого сохранения: ранги без денежного потока
  P.pathsCheck = function (s, quiet) {
    const p = s.player; if (!p) return;
    const first = !p.pathRank;
    p.pathRank = p.pathRank || {};
    let changed = false;
    for (const id of Object.keys(PATHS)) {
      const r = rankOf(pathXp(p, id)), was = p.pathRank[id] || (first ? r : 1);
      if (r > was) {
        let sum = 0;
        for (let k = was + 1; k <= r; k++) sum += 25000 * k * k * (p.dream === id ? 1.5 : 1);
        if (!first) {
          p.credits += sum;
          this.notify(s, `🎖 ${PATHS[id].icon} ${PATHS[id].name}: новый ранг «${PATHS[id].ranks[r - 1]}» (${r}/10). Награда ${fmt(sum)} CR`, 'good');
          if (r === 10) for (const x of this.sessions) x.send({ t: 'chat', ch: 'global', from: 'Новости галактики', text: `${p.name} достиг вершины пути «${PATHS[id].name}»!` });
        }
        changed = true;
      }
      if (r > (p.pathRank[id] || 0)) p.pathRank[id] = r;
    }
    if (changed && !quiet) this.sendProfile(s);
    if (changed) s.send(this.pathsView(p));
  };
  P.login = function (s) {
    const r = baseLogin.apply(this, arguments);
    if (s.player) { this.pathsCheck(s, true); s.send(this.pathsView(s.player)); }
    return r;
  };
  P.slowTick = function () {
    const r = baseSlow ? baseSlow.apply(this, arguments) : undefined;
    if (!this._pathsAt || this.now - this._pathsAt > 5000) {
      this._pathsAt = this.now;
      for (const s of this.sessions) if (s.player && !s.isBot) this.pathsCheck(s);
    }
    return r;
  };
};
module.exports.PATHS = PATHS;
module.exports.pathXp = pathXp;
module.exports.rankOf = rankOf;
