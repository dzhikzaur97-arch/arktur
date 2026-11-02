// Корабельные истории: у каждого корабля своя сюжетная цепочка из 10 заданий. Её предлагают, когда пилот садится на корабль.
// Задания засчитываются только на этом корабле и по очереди раскрывают его сильные стороны: скорость, урон, трюм,
// дроны, ракеты, особые умения гильдий. За каждое задание — награда, за всю цепочку — звание «мастер корабля»
// и +5% прочности на кораблях этого типа навсегда.
'use strict';
const { SHIPS, FACTION_INFO, incomeOf } = require('./data');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const AU = 1.496e11;

// откуда корабль: гильдия, фракция, уникальная верфь или серийная верфь Арктура
function originOf(T) {
  if (T.guild) return T.guild;
  if (T.fac && FACTION_INFO[T.fac]) return FACTION_INFO[T.fac].shipyard || FACTION_INFO[T.fac].name;
  if (T.maker) return T.maker;
  return 'Верфи «Арктур-Индастриз»';
}
const pct = (x) => Math.round(x * 100) + '%';
// плюсы корабля по его характеристикам — строки для «чему учит это задание»
function lessons(T) {
  const b = T.bonus || {}, L = {};
  L.speed = `${T.name} разгоняется до ${T.maxSpeed} м/с и разворачивается за ${T.align} с — ${T.maxSpeed >= 400 ? 'быстрее почти любого пирата: можно выбирать, когда начинать бой и когда уходить' : T.maxSpeed >= 250 ? 'достаточно, чтобы держать дистанцию и вовремя выйти из боя' : 'немного, зато корпус держит удар — тяжёлые корабли не бегают, а стоят'}.`;
  L.warp = `Варп ${T.warpSpeed} а.е./с${T.warpSpeed >= 6 ? ' — один из самых быстрых в галактике' : ''}: от станции до пояса — считаные секунды.`;
  L.guns = `${T.slots.high} верхних слотов под орудия${b.damage ? `, и корпус даёт +${pct(b.damage)} урона` : ''}.`;
  L.dmg = b.damage ? `Бонус корпуса +${pct(b.damage)} урона орудий работает с любым оружием — ставьте лучшие пушки.` : b.missile ? `Ракеты с этого корпуса бьют на ${pct(b.missile)} сильнее${b.missileSpeed ? ` и летят на ${pct(b.missileSpeed)} быстрее` : ''}.` : `Урон зависит от орудий: ${T.slots.high} верхних слотов — подберите оружие на рынке (раздел «🔫 Орудия»).`;
  L.hp = `Щит ${fmt(T.shield)}, броня ${fmt(T.armor)}, корпус ${fmt(T.hull)} — всего ${fmt(T.shield + T.armor + T.hull)} прочности.`;
  L.cargo = `Трюм ${fmt(T.cargo)} м³${b.cargo ? ` и +${pct(b.cargo)} от расширителей` : ''}.`;
  L.mine = b.mining ? `Корпус даёт +${pct(b.mining)} к добыче — каждая руда стоит больше времени, потраченного на неё.` : 'Буры можно поставить в верхние слоты; лучшие — в разделе «⛏ Добыча» на рынке.';
  L.drones = T.droneBay ? `Отсек дронов ${T.droneBay} м³, до ${T.maxDrones || 2} дронов в бою${b.drones ? `, урон и добыча дронов +${pct(b.drones)}` : ''}.` : 'Дронов этот корабль не несёт — он воюет сам.';
  L.scan = b.scan ? `Сканер +${pct(b.scan)}: аномалии находятся быстрее и с первого раза.` : 'Сканер обычный; для поиска тайников лучше подходят разведчики.';
  L.slots = `Слоты: ${T.slots.high} верхних, ${T.slots.mid} средних, ${T.slots.low} нижних — в средние идут щиты и форсаж, в нижние — броня и усилители.`;
  return L;
}
// шаг: stat — что считаем (только на этом корабле), need — сколько, title/text — история, lesson — чему учит
const S = (stat, need, title, text, lesson) => ({ stat, need: Math.max(1, Math.round(need)), title, text, lesson });
function chainOf(type) {
  const T = SHIPS[type]; if (!T || !T.role) return null;
  const k = [1, 1, 1.6, 2.6, 4, 6][T.tier || 1], L = lessons(T), n = T.name, org = originOf(T), b = T.bonus || {};
  let steps;
  if (T.role === 'mining') steps = [
    S('warps', 3, 'Приёмка', `Мастер ${org} передаёт вам «${n}» и просит прогнать его по системе: три варпа, чтобы откалибровать навигацию.`, L.warp),
    S('mined', 400 * k, 'Первая жила', `Найдите пояс астероидов и снимите первую руду. Бригадир хочет увидеть, как «${n}» держит бур.`, L.mine),
    S('mined', 1500 * k, 'Полный трюм', 'Заполните трюм — проверим, сколько корабль увезёт за один рейс.', L.cargo),
    S('refined', 80 * k, 'Из руды — металл', 'Отвезите руду на станцию и переработайте её (вкладка «Переработка»). Материалы стоят дороже руды.', 'Руда → материалы → компоненты → модули: переработка многократно увеличивает выручку с каждой тонны.'),
    S('soldCr', 40000 * k, 'Первая сделка', 'Продайте добытое на рынке станции. Цена выше там, где сейчас кризис нехватки — смотрите «📰 Сводку».', 'Кризисы на рынках поднимают цену продажи до ×2 — выгодно возить туда, где нехватка.'),
    b.gasMul || T.gasBonus ? S('gasMined', 250, 'Газовое облако', 'Слетайте к газовому гиганту и наберите гелия-3 газовым сборщиком.', `Сбор газа на «${n}» +${pct(T.gasBonus || 0)}: гелий-3 идёт в энергоячейки и компоненты.`) : S('mined', 3000 * k, 'Глубинная жила', 'Ищите богатые астероиды — в опасных системах руда дороже.', L.speed),
    S('lowsec', 120, 'За границей безопасности', 'Самые ценные руды — в системах с безопасностью ниже 0.5. Продержитесь там две минуты.', L.hp),
    S('mined', 6000 * k, 'Смена без перерыва', T.foundry ? 'Включите всеядные буры и дайте «Бегемоту» поработать: плавильня сама разбивает астероиды и затягивает куски в пасть.' : 'Большая смена: добудьте много руды подряд.', T.foundry ? 'Плавильня «Бегемота» плавит руду прямо в полёте; улучшения «Всасывание» и «Ковка» — во вкладке «Переработка».' : L.mine),
    S('soldCr', 180000 * k, 'Поставщик станции', 'Станция заключает с вами постоянный контракт — нужны крупные поставки.', 'Выручка растёт с переработкой и с кризисами — сочетайте их.'),
    S('mined', 12000 * k, 'Легенда поясов', `Последнее испытание: покажите, на что способен «${n}» на полную мощность.`, 'Вы знаете корабль: трюм, бонусы добычи, переработку и рынки.')
  ];
  else if (T.role === 'transport') steps = [
    S('warps', 3, 'Приёмка', `Диспетчер ${org} выдаёт «${n}»: три пробных варпа по системе.`, L.warp),
    S('jumps', 4, 'Первый маршрут', 'Проведите корабль через четверо звёздных врат.', `Каждый прыжок тратит энергоячейку — ${L.cargo}`),
    S('soldCr', 30000 * k, 'Первая партия', 'Купите груз подешевле и продайте дороже — или продайте добытое. Нужна первая выручка.', L.cargo),
    S('taxi', 1, 'Пассажирский рейс', 'У агентов станций бывают заказы «Пассажиры» и «Срочный груз» с таймером. Возьмите один и успейте вовремя.', T.taxiBonus ? `На «${n}» награда за пассажиров +${pct(T.taxiBonus)}, а засады вдвое реже.` : 'Быстрее довезёте — выше награда, до +50%.'),
    S('jumps', 12, 'Длинный маршрут', 'Проложите путь через несколько систем.', L.speed),
    S('dist', 800, 'Километры', 'Налетайте 800 км на досветовой скорости — проверим двигатели.', L.speed),
    S(T.taxiBonus ? 'taxi' : 'soldCr', T.taxiBonus ? 3 : 90000 * k, T.taxiBonus ? 'Расписание' : 'Оборот', T.taxiBonus ? 'Выполните ещё три пассажирских рейса.' : 'Нарастите оборот: продавайте там, где дорого.', T.taxiBonus ? 'Лайнер окупается регулярными рейсами — смотрите доску заданий у агентов.' : '«📰 Сводка» показывает, где сейчас нехватка товара.'),
    S('lowsec', 120, 'Опасный коридор', 'Самая выгодная торговля — через опасные системы. Пройдите ими и выживите.', L.hp),
    S('soldCr', 250000 * k, 'Торговый дом', 'Вас знают на рынках — нужна крупная сделка.', L.cargo),
    S('jumps', 35, 'Через всю галактику', `Финальный перелёт: покажите, что «${n}» дойдёт куда угодно.`, 'Вы знаете маршрутизацию, рынки, пассажиров и риск опасных коридоров.')
  ];
  else if (T.role === 'explore') steps = [
    S('warps', 5, 'Приёмка', `Картографы ${org} просят пять варпов — проверить навигацию «${n}».`, L.warp),
    S('scans', 3, 'Первый скан', 'Запустите сканер (кнопка ◎) три раза и найдите аномалии.', L.scan),
    S('jumps', 6, 'Белые пятна', 'Прыгните через шесть врат — расширим карту.', L.speed),
    S('sigFound', 1, 'Скрытый сигнал', 'Карта системы → «📡 Зонды»: найдите один скрытый сигнал.', T.probeBonus ? `Зонды «${n}» засчитывают находку с 0,45 а.е. и сканируют вдвое чаще.` : 'Сужайте круг зонда до 0,5 а.е. — сигнал найдётся точно.'),
    S('landings', 1, 'Твёрдая земля', 'Посадите корабль на планету (кнопка «Посадка» у планеты) и осмотритесь.', 'На поверхности — ресурсы, животные и открытия; базу можно построить там же.'),
    S(T.raceBonus ? 'races' : 'scans', T.raceBonus ? 1 : 10, T.raceBonus ? 'Трасса' : 'Глубокое сканирование', T.raceBonus ? 'В системах Арктур, Велла, Кассиопа, Люмен, Сириан и Полярис есть трассы 🏁. Пройдите одну.' : 'Просканируйте десять раз — найдите редкие аномалии.', T.raceBonus ? `Призы за гонки на «${n}» +${pct(T.raceBonus)}.` : L.scan),
    S('lowsec', 150, 'Нулевые сектора', 'Разведчик живёт там, где опасно: продержитесь в системах ниже 0.5.', L.speed),
    S('sigFound', 3, 'Охота за тайниками', 'Найдите ещё три сигнала зондами — там архивы и тайники Предтеч.', 'Тайники дают CR, реликвии и редкие чертежи, а метка для варпа появляется сама.'),
    S(T.raceBonus ? 'races' : 'jumps', T.raceBonus ? 3 : 20, T.raceBonus ? 'Сезон гонок' : 'Дальний рейд', T.raceBonus ? 'Пройдите ещё три гонки — побейте свои рекорды.' : 'Двадцать прыжков без возвращения домой.', L.warp),
    S('sigFound', 6, 'Картограф галактики', `Финал: докажите, что «${n}» находит то, что другие не видят.`, 'Вы знаете сканер, зонды, посадки и скорость разведчика.')
  ];
  else if (T.role === 'carrier') steps = [
    S('warps', 3, 'Приёмка', `Командир лётной палубы (${org}) просит три варпа — проверить навигацию «${n}».`, L.warp),
    S('droneDmg', 1500 * k, 'Первый вылет роя', 'Купите дронов (рынок → «🛸 Дроны»), выпустите их и атакуйте пиратов.', L.drones),
    S('npcKills', 3, 'Рой против пиратов', 'Уничтожьте трёх пиратов — дроны должны сделать основную работу.', 'Режимы роя: «Агрессия» — сами ищут врагов, «Защита» — отвечают нападающим.'),
    S('droneDmg', 6000 * k, 'Слаженность', 'Нанесите дронами ещё больше урона: держитесь в стороне, рой работает.', L.drones),
    S('lowsec', 120, 'Дальний патруль', 'Проведите носитель через опасные системы.', L.hp),
    S('npcKills', 12, 'Зачистка', 'Двенадцать пиратов: пусть рой учится работать по разным целям.', L.slots),
    S(T.corpHQ || T.wingBonus ? 'wingKills' : 'pbases', T.corpHQ || T.wingBonus ? 4 : 1, T.corpHQ || T.wingBonus ? 'Звено' : 'Пиратская база', T.corpHQ || T.wingBonus ? 'Наймите напарников или выведите эскорт из ангара — пусть они одержат четыре победы.' : 'Атакуйте пиратскую базу ☠: волны охраны — работа для роя.', T.wingBonus ? 'Флагман усиливает напарников на 35% и возвращает сбитых через минуту.' : T.corpHQ ? '«Вече» добавляет место во флоте эскорта и делает эскорт сильнее на 25%.' : L.drones),
    S('droneDmg', 20000 * k, 'Мастер роя', 'Нанесите дронами крупный урон.', 'Узлы управления дронами (рынок → «⚙ Усилители») делают рой ещё сильнее.'),
    S(T.droneShield ? 'wevents' : 'npcKills', T.droneShield ? 1 : 20, T.droneShield ? 'Против Колосса' : 'Гроза Скверны', T.droneShield ? 'Примите участие в бою с боссом мирового события ☄.' : 'Ещё двадцать пиратов.', T.droneShield ? '«Покров» принимает урон по своим дронам на щит флагмана — рой не гибнет.' : L.hp),
    S('droneDmg', 50000 * k, 'Адмирал роя', `Финал: покажите всю мощь «${n}».`, 'Вы знаете отсек дронов, режимы роя, напарников и выживание носителя.')
  ];
  else steps = [ // боевые
    S('warps', 3, 'Приёмка', `Офицер ${org} передаёт вам «${n}»: три варпа для калибровки.`, L.warp),
    S('dist', 150, 'Пробный полёт', 'Налетайте 150 км на досветовой — почувствуйте разгон и манёвр.', L.speed),
    S('npcKills', 3, 'Первая кровь', 'Найдите пиратов в поясе астероидов и уничтожьте трёх. Подсказка: «⚔ В бой» — захват, орбита и огонь одной кнопкой.', L.guns),
    S('dmgDealt', 3000 * k, 'Огневые испытания', 'Нанесите противнику много урона — проверим орудия.', L.dmg),
    T.stormproof ? S('storm', 120, 'В сердце бури', 'Найдите систему с космической погодой («📰 Сводка») и продержитесь в ней две минуты.', '«Буревестник» не получает штрафов от погоды, а в бурю бьёт на 20% сильнее и летит быстрее.')
      : S('lowsec', 120, 'Граница', 'Пройдите в системы с безопасностью ниже 0.5 и продержитесь там.', L.hp),
    S('npcKills', 10, 'Чистка пояса', 'Уничтожьте ещё десять пиратов.', L.slots),
    S((T.tier || 1) >= 2 ? 'pbases' : 'npcKills', (T.tier || 1) >= 2 ? 1 : 15, (T.tier || 1) >= 2 ? 'Логово' : 'Патруль', (T.tier || 1) >= 2 ? 'Уничтожьте пиратскую базу ☠ — пять волн охраны и тайник.' : 'Ещё пятнадцать пиратов — пора к серьёзным целям.', L.hp),
    T.bountyBonus ? S('wantedKills', 1, 'Заказ гильдии', '«📰 Сводка» → «Доска розыска»: сбейте одного главаря.', `Награды за главарей на «${n}» +${pct(T.bountyBonus)}, за обычных пиратов +25%.`)
      : S('dmgDealt', 10000 * k, 'Тяжёлый бой', 'Выдержите долгий бой и нанесите много урона.', L.dmg),
    T.bossBonus ? S('wevents', 1, 'Против гиганта', 'Примите участие в бою с боссом мирового события ☄ или Архонтом.', `По боссам «${n}» бьёт на ${pct(T.bossBonus)} сильнее.`)
      : T.bountyBonus ? S('wantedKills', 2, 'Охотник', 'Ещё два главаря с доски розыска.', 'Главари растут каждые 30 минут — выгоднее бить их выросшими, но опаснее.')
      : S('npcKills', 20, 'Гроза Скверны', 'Двадцать пиратов подряд.', L.speed),
    S('dmgDealt', 25000 * k, `Легенда «${n}»`, `Финал: покажите, на что способен «${n}» в настоящем бою.`, 'Вы знаете скорость, орудия, прочность и сильные стороны корабля.')
  ];
  const reward = (i) => Math.round((5000 + (T.price || 50000) * 0.004) * (1 + i * 0.2) * (i === 9 ? 4 : 1) / 100) * 100;
  return { type, name: n, origin: org,
    intro: `«${n}» — ${T.cls.toLowerCase()}. Создатель: ${org}. ${T.lore || T.desc || ''} Пройдите 10 заданий — и вы узнаете корабль досконально: каждое задание раскрывает одну из его сильных сторон.`,
    steps: steps.map((s, i) => ({ ...s, reward: reward(i) })) };
}

const STAT_NAME = { warps: 'варпы', dist: 'км полёта', jumps: 'прыжки через врата', mined: 'добыто руды', refined: 'переработано в материалы', soldCr: 'выручка, CR', gasMined: 'собрано газа', lowsec: 'секунды в опасных системах',
  storm: 'секунды в непогоде', taxi: 'пассажирские рейсы', scans: 'сканирования', sigFound: 'найдено сигналов', landings: 'посадки на планеты', races: 'гонки', npcKills: 'сбито пиратов', dmgDealt: 'нанесено урона', droneDmg: 'урон дронами',
  pbases: 'пиратские базы', wantedKills: 'главари с доски розыска', wevents: 'бои с боссами', wingKills: 'победы напарников' };

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick, baseJump = P.jump, baseWarp = P.beginWarp, baseApply = P.applyDamage, baseSell = P.c_sell, baseScan = P.c_scan, baseMine = P.mineYield, baseCalc = P.calcStats;
  const st = (p, k) => (p.stats && p.stats[k]) || 0;
  const add = (p, k, v) => { p.stats[k] = (p.stats[k] || 0) + v; };
  const playerOf = (g, e) => e && e.owner && !e.npc ? g.db.players[e.owner] : null;

  // ---- учёт действий для заданий ----
  P.jump = function (e, gate) { const p = playerOf(this, e); if (p && e.type === 'ship') add(p, 'jumps', 1); return baseJump.call(this, e, gate); };
  P.beginWarp = function (e) { const p = e && e.session && playerOf(this, e); if (p) add(p, 'warps', 1); return baseWarp.call(this, e); };
  P.applyDamage = function (t, dmg, src, ...rest) {
    if (t && src && t.type === 'ship' && (t.npc || t.outlaw) && dmg > 0) {
      const owner = src.type === 'drone' ? src.owner : src.type === 'missile' ? src.shooterOwner : src.owner && src.type === 'ship' ? src.owner : null, p = owner && this.db.players[owner];
      if (p) { add(p, 'dmgDealt', dmg); if (src.type === 'drone') add(p, 'droneDmg', dmg); }
    }
    return baseApply.call(this, t, dmg, src, ...rest);
  };
  P.c_sell = function (s, m, p) { const c0 = p.credits; const r = baseSell.call(this, s, m, p); if (p.credits > c0) add(p, 'soldCr', p.credits - c0); return r; };
  if (baseScan) P.c_scan = function (s, m, p, e) { const was = e && e.scanUntil; const r = baseScan.call(this, s, m, p, e); if (e && e.scanUntil !== was) add(p, 'scans', 1); return r; };
  P.mineYield = function (e, mod, def) {
    const t = this.ents.get(mod.target), p = playerOf(this, e), m0 = p ? st(p, 'mined') : 0;
    const r = baseMine.call(this, e, mod, def);
    if (p && t && t.gas) add(p, 'gasMined', st(p, 'mined') - m0);
    return r;
  };
  P.calcStats = function (p, ship) {
    const r = baseCalc.call(this, p, ship);
    if (p && ship && p.mastery && p.mastery[ship.type]) { r.shield *= 1.05; r.armor *= 1.05; r.hull *= 1.05; }
    return r;
  };

  // ---- цепочки ----
  P.shipStoryView = function (p, type) {
    type = type || p.ship.type;
    const ch = chainOf(type); if (!ch) return { t: 'shipStory', type, chain: null };
    const s = (p.shipStory || {})[type] || null;
    return { t: 'shipStory', type, chain: ch, state: s, mastered: !!(p.mastery && p.mastery[type]), statName: STAT_NAME };
  };
  P.c_shipStoryInfo = function (s, m, p) { s.send(this.shipStoryView(p, SHIPS[m.type] ? m.type : p.ship.type)); };
  P.c_shipStoryStart = function (s, m, p) {
    const type = p.ship.type, ch = chainOf(type); if (!ch) return;
    p.shipStory = p.shipStory || {};
    if (p.shipStory[type] && !p.shipStory[type].done) return s.send(this.shipStoryView(p));
    p.shipStory[type] = { step: 0, prog: 0, done: false, at: this.now };
    s.ssLast = null;
    this.notify(s, `📘 История «${SHIPS[type].name}»: задание 1 из 10 — ${ch.steps[0].title}`, 'good');
    s.send(this.shipStoryView(p)); this.save();
  };
  P.shipStoryTick = function () {
    for (const s of this.sessions) {
      const p = s.player; if (!p || !p.shipStory) continue;
      const type = p.ship.type, cs = p.shipStory[type]; if (!cs || cs.done) { s.ssLast = null; continue; }
      const ch = chainOf(type), step = ch.steps[cs.step]; if (!step) continue;
      const e = s.ent; let delta = 0;
      if (step.stat === 'lowsec' || step.stat === 'storm') {
        const ok = e && !e.warp && !s.docked && (step.stat === 'lowsec' ? this.U.byId[e.sys] && this.U.byId[e.sys].sec < 0.5 : this.weatherOf && this.weatherOf(e.sys));
        delta = ok ? 2 : 0;
      } else if (step.stat === 'dist') {
        if (e && !e.warp && !s.docked) { const d = s.ssPos && s.ssPos.sys === e.sys ? Math.hypot(e.pos[0] - s.ssPos.p[0], e.pos[1] - s.ssPos.p[1], e.pos[2] - s.ssPos.p[2]) : 0; if (d < 50000) delta = d / 1000; s.ssPos = { sys: e.sys, p: e.pos.slice() }; } else s.ssPos = null;
      } else {
        const cur = st(p, step.stat);
        if (s.ssLast && s.ssLast.type === type && s.ssLast.stat === step.stat) delta = Math.max(0, cur - s.ssLast.v);
        s.ssLast = { type, stat: step.stat, v: cur };
      }
      if (delta <= 0) continue;
      cs.prog += delta;
      if (cs.prog < step.need) { if (!s.ssSentAt || this.now - s.ssSentAt > 3000) { s.ssSentAt = this.now; s.send({ t: 'shipStoryProg', type, step: cs.step, prog: Math.floor(cs.prog) }); } continue; }
      // задание выполнено
      p.credits += step.reward;
      this.notify(s, `📘 «${SHIPS[type].name}» ${cs.step + 1}/10 — «${step.title}» выполнено! +${fmt(step.reward)} CR. ${step.lesson}`, 'good');
      cs.step++; cs.prog = 0; s.ssLast = null;
      if (cs.step >= ch.steps.length) {
        cs.done = true; p.mastery = p.mastery || {}; p.mastery[type] = true; p.stats.shipChains = (p.stats.shipChains || 0) + 1;
        this.notify(s, `🏅 Вы — мастер «${SHIPS[type].name}»! На кораблях этого типа прочность +5% навсегда.`, 'good');
        if (s.ent) s.ent.stats = this.calcStats(p, p.ship);
      } else this.notify(s, `📘 Следующее задание ${cs.step + 1}/10: ${ch.steps[cs.step].title}`, 'info');
      this.sendProfile(s); s.send(this.shipStoryView(p)); this.save();
    }
  };
  P.slowTick = function () {
    baseSlow.call(this);
    if (this._ssAt && this.now - this._ssAt < 2000) return;
    this._ssAt = this.now; this.shipStoryTick();
  };
};
module.exports.chainOf = chainOf;
