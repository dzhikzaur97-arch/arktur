// Сюжетная кампания «Неизвестный сигнал» (12 миссий, 3 акта) и репутация трёх фракций.
// Подключается к Game как mixin. Прогресс хранится в профиле: p.story, p.rep.
'use strict';
const crypto = require('crypto');
const { SYSTEMS, REGIONS, ITEMS, SHIPS, FACTION_INFO, REP_NEED } = require('./data');

const uid = () => crypto.randomBytes(6).toString('hex');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const rnd = (a, b) => a + Math.random() * (b - a);
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const AU = 1.496e11;

// ---------- Фракции ----------
// названия, цвета и регионы — общие с клиентом (data.js), здесь — описание и лидер
const FACTIONS = {
  cons:  { ...FACTION_INFO.cons, desc: 'Промышленники и верфи Ядра. Ценят порядок, контракты и прибыль.', leader: 'Директор Ирма Вальд' },
  liga:  { ...FACTION_INFO.liga, desc: 'Вольные колонисты Пограничья и Рубежа. Держатся друг за друга.', leader: 'Командор Яр Белов' },
  orden: { ...FACTION_INFO.orden, desc: 'Учёные и искатели древностей. Изучают аномалии и наследие Предтеч.', leader: 'Магистр Сайра Нод' }
};
const REP_TIERS = [[-50, 'Враждебность'], [-15, 'Недоверие'], [15, 'Нейтралитет'], [40, 'Уважение'], [75, 'Союзник'], [101, 'Герой']];
const repTier = (v) => REP_TIERS.find(([lim]) => v < lim)[1];
// владелец системы меняется в войне фракций (server/war.js); без войны — по региону
let WAR_OWNER = null;
function homeFactionOfSys(sysId) {
  const def = SYSTEMS.find(s => s.id === sysId);
  if (!def) return 'cons';
  for (const [id, f] of Object.entries(FACTIONS)) if (f.regions.includes(def.region)) return id;
  return 'cons';
}
function factionOfSys(sysId) {
  if (WAR_OWNER && WAR_OWNER[sysId]) return WAR_OWNER[sysId];
  const def = SYSTEMS.find(s => s.id === sysId);
  if (!def) return 'cons';
  for (const [id, f] of Object.entries(FACTIONS)) if (f.regions.includes(def.region)) return id;
  return 'cons';
}

// Сюжетные предметы
Object.assign(ITEMS, {
  q_recorder: { name: 'Бортовой самописец', cat: 'Миссия', vol: 1, base: 0, quest: true },
  q_key:      { name: 'Зашифрованный ключ', cat: 'Миссия', vol: 1, base: 0, quest: true },
  q_map:      { name: 'Фрагмент звёздной карты Предтеч', cat: 'Миссия', vol: 2, base: 0, quest: true },
  q_core:     { name: 'Ядро маяка Предтеч', cat: 'Миссия', vol: 5, base: 0, quest: true },
  q_shard:    { name: 'Осколок карты Колосса', cat: 'Миссия', vol: 2, base: 0, quest: true },
  q_heart:    { name: 'Сердце Стража Предтеч', cat: 'Миссия', vol: 5, base: 0, quest: true }
});

// ---------- Кампания ----------
// Типы этапов: travel (прилететь в систему), site (сюжетная точка с действием: reach/hack/kill/loot/defend),
// dock (пристыковаться), deliver (привезти предмет), mine (добыть руду), scan (просканировать систему),
// hunt (уничтожить пиратов в опасных системах), choice (выбор союзника).
const ALLY = '$ally';
const MISSIONS = [
  // ===== Акт I. Знакомство с сектором и конфликтом =====
  { id: 'm1', act: 1, title: 'Шёпот в эфире', from: 'Диспетчер Арктура', faction: 'cons',
    brief: ['Пилот, на частоте маяков Велла уже третьи сутки висит сигнал. Это не наш позывной и не пиратский.',
            'Слетайте к источнику и запишите его. Ничего не трогайте — только данные.'],
    stages: [
      { type: 'travel', sys: 'vella', text: 'Прыгните в систему Велла' },
      { type: 'site', sys: 'vella', site: 'Источник помех', act: 'hack', secs: 20, text: 'Варп к точке «Источник помех» и запишите сигнал (держитесь ближе 15 км)' },
      { type: 'dock', station: 'arktur:st1', text: 'Вернитесь на станцию Арктур Прайм II' }],
    done: 'Это… повторяющийся математический узор. Так не говорят ни люди, ни машины Скверны. Будем разбираться.',
    reward: { isk: 30000, rep: { cons: 5 } } },
  { id: 'm2', act: 1, title: 'Пропавший рудовоз', from: 'Диспетчер Арктура', faction: 'cons',
    brief: ['Рудовоз «Тихон» шёл через Кассиопу и пропал в момент всплеска того самого сигнала.',
            'Найдите обломки и заберите бортовой самописец.'],
    stages: [
      { type: 'site', sys: 'kassiopa', site: 'Обломки рудовоза «Тихон»', act: 'loot', item: 'q_recorder', text: 'Найдите обломки «Тихона» в Кассиопе и заберите самописец' },
      { type: 'deliver', item: 'q_recorder', station: 'arktur:st1', text: 'Доставьте самописец на Арктур Прайм II' }],
    done: 'Самописец показывает: перед гибелью навигация «Тихона» сама развернула корабль на сигнал. Кто-то перехватил управление.',
    reward: { isk: 50000, rep: { cons: 5 } } },
  { id: 'm3', act: 1, title: 'Налёт на Люмен', from: 'Командор Яр Белов', faction: 'liga',
    brief: ['Говорит Белов, Пограничная Лига. Наш конвой с продовольствием застрял в Люмене — у него отказал двигатель.',
            'Скверна уже близко. Продержитесь, пока экипаж не починит двигатель.'],
    stages: [
      { type: 'site', sys: 'lumen', site: 'Конвой Лиги', act: 'defend', ship: 'tyagach', ally: 'Транспорт «Надежда»',
        waves: [['raider', 'raider'], ['raider', 'raider', 'raider']], text: 'Защитите транспорт «Надежда» в Люмене от двух волн рейдеров' }],
    done: 'Двигатель запущен, «Надежда» уходит. Лига такого не забывает, пилот.',
    reward: { isk: 80000, rep: { liga: 10 } } },
  { id: 'm4', act: 1, title: 'Глушилка Скверны', from: 'Диспетчер Арктура', faction: 'cons',
    brief: ['Скверна поставила в Дронте ретранслятор и глушит наши маяки. Совпадение? Вряд ли.',
            'Уничтожьте охрану ретранслятора.'],
    stages: [
      { type: 'site', sys: 'dront', site: 'Ретранслятор Скверны', act: 'kill', enemies: ['raider', 'raider', 'raider', 'reaper'], text: 'Уничтожьте охрану ретранслятора в Дронте' },
      { type: 'site', sys: 'dront', site: 'Ретранслятор Скверны', act: 'hack', secs: 15, text: 'Скачайте журнал ретранслятора' }],
    done: 'В журнале ретранслятора — тот же узор. Скверна не создаёт сигнал. Она его ищет — так же, как мы.',
    reward: { isk: 120000, rep: { cons: 10 } } },

  // ===== Акт II. Поиск источника сигнала =====
  { id: 'm5', act: 2, title: 'Пеленг', from: 'Магистр Сайра Нод', faction: 'orden',
    brief: ['Орден Предела давно слушает этот узор. Это навигационный код Предтеч — цивилизации, исчезнувшей до нас.',
            'Нужна вторая точка пеленга. Просканируйте систему Талос и найдите наш маяк.'],
    stages: [
      { type: 'travel', sys: 'talos', text: 'Прыгните в систему Талос' },
      { type: 'scan', sys: 'talos', text: 'Просканируйте систему (V или кнопка «Скан»)' },
      { type: 'site', sys: 'talos', site: 'Пеленгационный маяк Ордена', act: 'hack', secs: 30, text: 'Подлетите к маяку и снимите пеленг (30 с)' }],
    done: 'Две точки пеленга сходятся на Рубеже. Источник ближе, чем мы думали.',
    reward: { isk: 150000, rep: { orden: 10 } } },
  { id: 'm6', act: 2, title: 'Топливо для экспедиции', from: 'Командор Яр Белов', faction: 'liga',
    brief: ['Экспедиции на Рубеж нужна руда для реакторов. Лига заплатит, но копать придётся самому.'],
    stages: [{ type: 'mine', qty: 3000, text: 'Добудьте 3 000 единиц любой руды' }],
    done: 'Реакторы экспедиции заправлены. Лига готова идти за вами.',
    reward: { isk: 120000, rep: { liga: 10 } } },
  { id: 'm7', act: 2, title: 'Охота на курьера', from: 'Директор Ирма Вальд', faction: 'cons',
    brief: ['Это Ирма Вальд, Консорциум. Наша разведка засекла в Гиераксе курьера Скверны с ключом к их шифрам.',
            'Перехватите его. Ключ нужен нам целым.'],
    stages: [
      { type: 'site', sys: 'gierax', site: 'Курьер Скверны', act: 'kill', enemies: ['hunter', 'raider', 'raider'], text: 'Перехватите курьера Скверны в Гиераксе' },
      { type: 'site', sys: 'gierax', site: 'Курьер Скверны', act: 'loot', item: 'q_key', text: 'Заберите зашифрованный ключ из обломков' },
      { type: 'deliver', item: 'q_key', station: 'arktur:st1', text: 'Доставьте ключ на Арктур Прайм II' }],
    done: 'Ключ подошёл. Скверна идёт к «Маяку Предтеч» — и уже знает, где он.',
    reward: { isk: 200000, rep: { cons: 10 } } },
  { id: 'm8', act: 2, title: 'Ковчег во мгле', from: 'Магистр Сайра Нод', faction: 'orden',
    brief: ['В системе Мгла дрейфует древний ковчег. Если там есть карта Предтеч, мы найдём маяк раньше Скверны.',
            'Будьте осторожны: это Рубеж, Стражей там нет.'],
    stages: [
      { type: 'site', sys: 'mgla', site: 'Древний ковчег', act: 'kill', enemies: ['reaper', 'reaper', 'raider'], text: 'Зачистите подходы к ковчегу в Мгле' },
      { type: 'site', sys: 'mgla', site: 'Древний ковчег', act: 'loot', item: 'q_map', text: 'Найдите фрагмент звёздной карты в ковчеге' },
      { type: 'deliver', item: 'q_map', station: 'arktur:st1', text: 'Доставьте карту на Арктур Прайм II' }],
    done: 'Карта указывает на Тень-7. Маяк Предтеч там. Пора решать, с кем вы идёте до конца.',
    reward: { isk: 350000, rep: { orden: 10 } } },

  // ===== Акт III. Выбор союзника и заключительная операция =====
  { id: 'm9', act: 3, title: 'Совет трёх', from: 'Совет фракций', faction: null,
    brief: ['Консорциум, Лига и Орден хотят возглавить операцию у Маяка. Каждый предлагает вам союз — и у каждого своя цель.',
            'Консорциум хочет технологию маяка. Лига — безопасность колоний. Орден — знание. Выберите союзника.'],
    stages: [{ type: 'choice', text: 'Выберите союзника для финальной операции' }],
    done: null, reward: { isk: 0 } },
  { id: 'm10', act: 3, title: 'Подготовка удара', from: ALLY, faction: ALLY,
    brief: ['Прежде чем идти к Маяку, нужно ослабить Скверну на Рубеже.', 'Уничтожьте шесть их кораблей в опасных системах (безопасность ниже 0.5).'],
    stages: [{ type: 'hunt', qty: 6, text: 'Уничтожьте 6 кораблей Скверны в системах с безопасностью ниже 0.5' }],
    done: 'Скверна отходит к Тени-7. Флагман экспедиции выдвигается.',
    reward: { isk: 300000, rep: { [ALLY]: 10 } } },
  { id: 'm11', act: 3, title: 'Сердце сигнала', from: ALLY, faction: ALLY,
    brief: ['Флагман экспедиции вышел в Пепел, чтобы открыть путь к Маяку. Скверна бросит на него всё, что есть.',
            'Не дайте им уничтожить флагман.'],
    stages: [
      { type: 'site', sys: 'pepel', site: 'Флагман экспедиции', act: 'defend', ship: 'kit', ally: 'Флагман «Рассвет»',
        waves: [['raider', 'raider', 'raider'], ['reaper', 'raider', 'raider'], ['hunter', 'reaper']], text: 'Защитите флагман «Рассвет» в Пепле от трёх волн' }],
    done: 'Флагман проложил коридор. Маяк Предтеч — прямо по курсу.',
    reward: { isk: 500000, rep: { [ALLY]: 10 } } },
  { id: 'm12', act: 3, title: 'Тишина', from: ALLY, faction: ALLY,
    brief: ['Маяк Предтеч в Тени-7 охраняет Полководец Скверны. Уничтожьте его и отключите маяк — или заберите его ядро.',
            'Это последний бой. Удачи, пилот.'],
    stages: [
      { type: 'site', sys: 'ten7', site: 'Маяк Предтеч', act: 'kill', enemies: ['warlord', 'reaper', 'reaper'], text: 'Уничтожьте Полководца Скверны у Маяка в Тени-7' },
      { type: 'site', sys: 'ten7', site: 'Маяк Предтеч', act: 'hack', secs: 30, text: 'Отключите маяк и извлеките ядро (30 с у маяка)' },
      { type: 'dock', station: 'arktur:st1', text: 'Вернитесь на Арктур Прайм II' }],
    done: null, epilogue: true, // эпилог первой кампании зависит от союзника
    reward: { isk: 1000000, rep: { [ALLY]: 20 }, items: { q_core: 1 } } },

  // ===== Кампания «Эхо Колосса». Акт IV. Эхо =====
  // Новые типы этапов: stat (вырасти счётчик пилота: built, wingKills, medals, wevents, pbases),
  // warjoin (вступить в войну фракций), choice2 (выбор судьбы Колосса — меняет фронт и награду).
  { id: 'm13', act: 4, title: 'Резонанс', from: 'Магистр Сайра Нод', faction: 'orden',
    brief: ['Ядро маяка, которое вы извлекли, не молчит. Оно отвечает на что-то в глубине — тем же узором, но в тысячу раз сильнее.',
            'В Короне стоит наш резонатор. Подвезите ядро на расстояние приёма и снимите эхо.'],
    stages: [
      { type: 'site', sys: 'korona', site: 'Резонатор Ордена', act: 'hack', secs: 25, text: 'Снимите эхо ядра у резонатора в Короне (25 с ближе 15 км)' },
      { type: 'dock', station: 'arktur:st1', text: 'Вернитесь на Арктур Прайм II' }],
    done: 'Эхо идёт от Колосса — машины Предтеч размером с луну. Он просыпается. И он не один.',
    reward: { isk: 400000, rep: { orden: 10 } } },
  { id: 'm14', act: 4, title: 'Оружие против гиганта', from: ALLY, faction: ALLY,
    brief: ['Обычными пушками Колосса не пробить. Нужны свои заводы и свои изделия — быстро и много.',
            'Запустите производство: три заказа на любой станции. Чертежи — во вкладке «Производство».'],
    stages: [{ type: 'stat', stat: 'built', qty: 3, text: 'Выполните 3 заказа производства (вкладка «Производство» на станции)' }],
    done: 'Линии работают. Теперь нужны пилоты, которые встанут рядом с вами.',
    reward: { isk: 300000, rep: { [ALLY]: 5 }, items: { mat_crystal: 30, mat_nullalloy: 10 } } },
  { id: 'm15', act: 4, title: 'Звено', from: ALLY, faction: ALLY,
    brief: ['Против Колосса в одиночку не летают. Наймите пилотов — во вкладке «Напарники» на станции — и проверьте их в деле.'],
    stages: [{ type: 'stat', stat: 'wingKills', qty: 4, text: 'Ваши напарники должны одержать 4 победы' }],
    done: 'Звено сыграно. Хорошая команда — половина победы.',
    reward: { isk: 350000, rep: { [ALLY]: 5 } } },
  { id: 'm16', act: 4, title: 'Цена фронта', from: ALLY, faction: ALLY,
    brief: ['Колосс тянется туда, где льётся больше всего энергии, — к линии фронта. Война фракций кормит его.',
            'Вступите в войну и заработайте знаки отличия: нам нужно понять, где он ударит.'],
    stages: [
      { type: 'warjoin', text: 'Вступите в войну фракций (вкладка «Фронт» на станции)' },
      { type: 'stat', stat: 'medals', qty: 5, text: 'Заработайте 5 знаков отличия на фронте' }],
    done: 'Сенсоры фронта засекли всплеск. Колосс выходит. Скоро.',
    reward: { isk: 500000, rep: { [ALLY]: 10 } } },
  { id: 'm17', act: 4, title: 'Первый Колосс', from: ALLY, faction: ALLY,
    brief: ['Это не учения. Колосс Предтеч или дредноут Скверны вот-вот выйдет в одной из систем — вы получите новость ☄.',
            'Сразитесь с ним вместе со всеми, кто откликнется. Важен каждый выстрел.'],
    stages: [{ type: 'stat', stat: 'wevents', qty: 1, text: 'Нанесите урон боссу мирового события ☄ и победите' }],
    done: 'Он пал — но в его ядре мы нашли координаты. Колосс был стражем. А то, что он сторожил, всё ещё там.',
    reward: { isk: 800000, rep: { [ALLY]: 10 } } },

  // ===== Акт V. Наследие =====
  { id: 'm18', act: 5, title: 'Осколки карты', from: 'Магистр Сайра Нод', faction: 'orden',
    brief: ['Координаты указывают в Бездну. В Разломе дрейфуют осколки звёздной карты Колосса, и их стерегут.',
            'Это нулевая безопасность. Возьмите звено и дронов.'],
    stages: [
      { type: 'site', sys: 'razlom', site: 'Поле осколков', act: 'kill', enemies: ['shard', 'shard', 'reaper', 'reaper'], text: 'Уничтожьте стражей поля осколков в Разломе' },
      { type: 'site', sys: 'razlom', site: 'Поле осколков', act: 'loot', item: 'q_shard', text: 'Заберите осколок карты' },
      { type: 'deliver', item: 'q_shard', station: 'arktur:st1', text: 'Доставьте осколок на Арктур Прайм II' }],
    done: 'Карта сложилась. Сердце Колосса — на Кладбище кораблей. Там его последний Страж.',
    reward: { isk: 900000, rep: { orden: 10 } } },
  { id: 'm19', act: 5, title: 'Сердце Стража', from: ALLY, faction: ALLY,
    brief: ['На Кладбище кораблей ждёт Страж Предтеч и его осколки. Сердце Стража — ключ к Колоссу.',
            'Уничтожьте охрану и извлеките сердце.'],
    stages: [
      { type: 'site', sys: 'kladbishe', site: 'Гробница Стража', act: 'kill', enemies: ['shard', 'shard', 'shard', 'warlord'], text: 'Уничтожьте охрану гробницы на Кладбище кораблей' },
      { type: 'site', sys: 'kladbishe', site: 'Гробница Стража', act: 'hack', secs: 35, text: 'Извлеките Сердце Стража (35 с у гробницы)' },
      { type: 'site', sys: 'kladbishe', site: 'Гробница Стража', act: 'loot', item: 'q_heart', text: 'Заберите Сердце Стража' }],
    done: 'Сердце бьётся в вашем трюме. Теперь решать вам — что будет с Колоссом.',
    reward: { isk: 1000000, rep: { [ALLY]: 10 } } },
  { id: 'm20', act: 5, title: 'Судьба Колосса', from: 'Совет фракций', faction: null,
    brief: ['Сердце Стража позволяет управлять Колоссом. Совет фракций спорит, но последнее слово — за вами, пилот.',
            'Уничтожить машину навсегда, подчинить её вашему союзнику — или отпустить за Край, туда, откуда пришли Предтечи?'],
    stages: [{ type: 'choice2', text: 'Решите судьбу Колосса' }],
    options: {
      destroy: { text: 'Уничтожить Колосса', desc: 'Галактика станет безопаснее. Все фракции поднимут вашу репутацию (+10).' },
      control: { text: 'Подчинить Колосса союзнику', desc: 'Сила Предтеч на стороне вашего союзника: +15 влияния во всех системах, где он наступает на фронте.' },
      free:    { text: 'Отпустить за Край', desc: 'Колосс уйдёт к Предтечам и оставит дар: два редких чертежа.' } },
    done: null, reward: { isk: 0 } },
  { id: 'm21', act: 5, title: 'Последний рубеж', from: ALLY, faction: ALLY,
    brief: ['Скверна узнала о Сердце и бросила на нас всё. Флагман «Рассвет» везёт Сердце через Тень-7.',
            'Удержите коридор — три волны, в последней их Полководец.'],
    stages: [
      { type: 'site', sys: 'ten7', site: 'Коридор «Рассвета»', act: 'defend', ship: 'kit', ally: 'Флагман «Рассвет»',
        waves: [['shard', 'shard', 'raider'], ['reaper', 'shard', 'shard'], ['warlord', 'shard', 'reaper']], text: 'Защитите флагман «Рассвет» в Тени-7 от трёх волн' }],
    done: '«Рассвет» прорвался. Осталось последнее — Предтеча.',
    reward: { isk: 1200000, rep: { [ALLY]: 10 } } },
  { id: 'm22', act: 5, title: 'Тишина Предтеч', from: ALLY, faction: ALLY,
    brief: ['Система Предтеча. Здесь Колосс спал тысячу лет. Его охраняют последние осколки — и Страж.',
            'Доведите дело до конца.'],
    stages: [
      { type: 'travel', sys: 'predtecha', text: 'Прыгните в систему Предтеча (Глубокий космос)' },
      { type: 'site', sys: 'predtecha', site: 'Колыбель Колосса', act: 'kill', enemies: ['sentinel', 'shard', 'shard'], text: 'Уничтожьте Стража у Колыбели Колосса' },
      { type: 'site', sys: 'predtecha', site: 'Колыбель Колосса', act: 'hack', secs: 40, text: 'Исполните решение — 40 с у Колыбели' },
      { type: 'dock', station: 'arktur:st1', text: 'Вернитесь на Арктур Прайм II' }],
    done: null, final2: true,
    reward: { isk: 2000000, rep: { [ALLY]: 20 }, items: { ev_core: 1 } } }
];
// Эпилог «Эха Колосса» — по решению судьбы Колосса
const EPILOGUE2 = {
  destroy: 'Колосс распался на миллиард искр, и узор в эфире умолк навсегда. Фракции впервые за век подписали перемирие на один день — в вашу честь. Галактика стала тише. И, может быть, безопаснее.',
  control: 'Колосс склонился перед вашим союзником. На фронте всё изменилось: там, где появляется его тень, враги отступают без боя. Вы дали своей фракции силу Предтеч. Время покажет, во что она её превратит.',
  free: 'Колосс развернулся к Краю и ушёл туда, откуда пришли Предтечи. Перед уходом он оставил в вашем трюме два чертежа — и одну фразу на древнем языке, которую Орден переводит как «Мы ещё встретимся».'
};
const EPILOGUE = {
  cons: 'Консорциум изучит ядро маяка на верфях Арктура. Через год первые корабли с двигателями Предтеч сойдут со стапелей — и вы будете первым в очереди.',
  liga: 'Лига разобрала маяк и похоронила его ядро в недрах астероида. Сигнал умолк. Колонии Пограничья наконец спят спокойно — и знают, кому этим обязаны.',
  orden: 'Орден расшифровал маяк. Он ведёт дальше, за Край — туда, где Предтечи оставили что-то ещё. Путь только начинается.'
};
const ALLY_REWARD = {
  cons: { items: { dmg_amp: 2, shield_booster_l: 1 }, isk: 300000, text: 'Консорциум: 300 000 ISK, 2 усилителя урона и тяжёлый усилитель щита' },
  liga: { items: { drone_heavy: 3, rail_l: 1 }, isk: 300000, text: 'Лига: 300 000 ISK, 3 тяжёлых дрона и тяжёлый рельсотрон' },
  orden: { items: { speed_x: 1, drone_light: 2 }, isk: 200000, text: 'Орден: 200 000 ISK, варп-ускоритель «Призрак» и 2 дрона' }
};

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseC_buy = P.c_buy, baseCompleteMission = P.completeMission;

  P.storyOf = function (p) {
    if (!p.rep) p.rep = { cons: 0, liga: 0, orden: 0 };
    if (!p.story) p.story = { m: 0, st: 0, state: 'offer', ally: null, rew: {}, prog: 0 };
    return p.story;
  };
  P.missionDef = function (p) { const st = this.storyOf(p); return MISSIONS[st.m] || null; };
  const allyOf = (p, v) => v === ALLY ? p.story.ally : v;
  P.speakerOf = function (p, md) {
    if (md.from !== ALLY) return md.from;
    const f = FACTIONS[p.story.ally]; return f ? f.leader : 'Командование';
  };

  P.addRep = function (p, fac, v, s) {
    this.storyOf(p);
    if (!FACTIONS[fac] || !v) return;
    p.rep[fac] = Math.max(-100, Math.min(100, (p.rep[fac] || 0) + v));
    if (s) this.notify(s, `Репутация: ${FACTIONS[fac].name} ${v > 0 ? '+' : ''}${v} (${repTier(p.rep[fac])})`, v > 0 ? 'good' : 'warn');
  };
  // скидка у станций фракции: до −10% при высокой репутации, наценка до +5% при вражде
  P.repDiscount = function (p, sysId) {
    this.storyOf(p);
    const r = p.rep[factionOfSys(sysId)] || 0;
    return Math.max(-0.05, Math.min(0.1, r / 1000));
  };

  // Покупка у станции: скидка по репутации возвращается сразу после оплаты
  // Фракционный корабль: только на станциях своей фракции и при нужной репутации
  P.shipLock = function (p, stationId, type) {
    const t = SHIPS[type];
    if (!t || !t.fac) return null;
    const f = FACTIONS[t.fac], here = stationId && this.U.celestials[stationId] ? factionOfSys(this.U.celestials[stationId].sys) : null;
    if (here !== t.fac) return `продаётся только на станциях фракции «${f.name}»`;
    this.storyOf(p);
    if ((p.rep[t.fac] || 0) < (t.rep || 0)) return `нужна репутация «${REP_NEED(t.rep)}» у фракции «${f.short}» (сейчас ${p.rep[t.fac] || 0}, нужно ${t.rep})`;
    return null;
  };
  P.c_buy = function (s, m, p) {
    if (SHIPS[m.item] && SHIPS[m.item].fac) {
      const why = this.shipLock(p, s.docked, m.item);
      if (why) return this.notify(s, `«${SHIPS[m.item].name}»: ${why}`, 'warn');
    }
    const before = p.credits;
    baseC_buy.call(this, s, m, p);
    const spent = before - p.credits;
    if (spent <= 0 || !s.docked) return;
    const d = this.repDiscount(p, this.U.celestials[s.docked].sys);
    if (!d) return;
    const delta = Math.round(spent * d);
    p.credits += delta;
    this.notify(s, d > 0 ? `Скидка ${FACTIONS[factionOfSys(this.U.celestials[s.docked].sys)].short}: −${fmt(delta)} ISK` : `Наценка из-за плохой репутации: ${fmt(-delta)} ISK`, d > 0 ? 'good' : 'warn');
    this.sendProfile(s);
  };
  // Контракты агентов дают репутацию фракции станции
  P.completeMission = function (p, ms, s) {
    baseCompleteMission.call(this, p, ms, s);
    const sid = ms.from || (s && s.docked);
    const sys = sid && this.U.celestials[sid] ? this.U.celestials[sid].sys : ms.sys;
    if (sys) this.addRep(p, factionOfSys(sys), 2, s);
  };

  P.storyView = function (p) {
    const st = this.storyOf(p), md = MISSIONS[st.m];
    const rep = Object.entries(FACTIONS).map(([id, f]) => ({ id, name: f.name, short: f.short, color: f.color, desc: f.desc, leader: f.leader, v: p.rep[id] || 0, tier: repTier(p.rep[id] || 0) }));
    if (!md) return { done: true, total: MISSIONS.length, ally: st.ally, rep, epilogue: st.c2done ? EPILOGUE2[st.c2choice] || EPILOGUE2.destroy : st.ally ? EPILOGUE[st.ally] : null };
    const stage = md.stages[st.st] || {};
    let text = stage.text || '';
    if (stage.type === 'hack' || stage.act === 'hack') text += st.prog ? ` — ${Math.min(100, Math.round(st.prog / stage.secs * 100))}%` : '';
    if (stage.type === 'mine') text += ` — ${fmt(Math.min(stage.qty, p.stats.mined - (st.mined0 || 0)))} / ${fmt(stage.qty)}`;
    if (stage.type === 'hunt') text += ` — ${st.kills || 0} / ${stage.qty}`;
    if (stage.type === 'stat') text += ` — ${Math.min(stage.qty, ((p.stats && p.stats[stage.stat]) || 0) - (st.base || 0))} / ${stage.qty}`;
    const sys = stage.sys || (stage.station && this.U.celestials[stage.station] ? this.U.celestials[stage.station].sys : null);
    return { n: st.m + 1, total: MISSIONS.length, act: md.act, title: md.title, from: this.speakerOf(p, md), state: st.state,
      stage: st.st + 1, stages: md.stages.length, text, sys, ally: st.ally, rep, failed: st.failed || null };
  };

  // ---------- диалоги ----------
  P.sendBriefing = function (s) {
    const p = s.player, st = this.storyOf(p), md = MISSIONS[st.m];
    if (!md || st.state !== 'offer') return;
    const choice = md.stages[0].type === 'choice', choice2 = md.stages[0].type === 'choice2';
    s.send({ t: 'dialog', kind: choice || choice2 ? 'choice' : 'brief', title: `Акт ${md.act}. ${md.title}`, from: this.speakerOf(p, md), lines: md.brief,
      choices: choice ? Object.entries(FACTIONS).map(([id, f]) => ({ id, text: f.name, desc: f.desc + ' Награда — ' + ALLY_REWARD[id].text + '.' }))
        : choice2 ? Object.entries(md.options).map(([id, o]) => ({ id, text: o.text, desc: o.desc })) : null,
      reward: md.reward.isk ? `${fmt(md.reward.isk)} ISK` : null });
  };
  P.c_storyBrief = function (s, m, p) {
    const st = this.storyOf(p), md = MISSIONS[st.m];
    if (md && st.state === 'active') return s.send({ t: 'dialog', kind: 'info', title: `Акт ${md.act}. ${md.title}`, from: this.speakerOf(p, md), lines: md.brief });
    this.sendBriefing(s);
  };
  P.c_storyAccept = function (s, m, p) {
    const st = this.storyOf(p), md = MISSIONS[st.m];
    if (!md || st.state !== 'offer' || md.stages[0].type === 'choice' || md.stages[0].type === 'choice2') return;
    st.state = 'active'; st.st = 0; this.beginStage(s, p);
    this.notify(s, `Миссия принята: ${md.title}`, 'good');
    this.sendProfile(s); this.save();
  };
  P.c_storyChoice = function (s, m, p) {
    const st = this.storyOf(p), md = MISSIONS[st.m];
    if (md && md.stages[0].type === 'choice2') return this.storyChoice2(s, m, p, st, md);
    if (!md || md.stages[0].type !== 'choice' || !FACTIONS[m.id] || st.ally) return;
    st.ally = m.id;
    for (const f of Object.keys(FACTIONS)) this.addRep(p, f, f === m.id ? 25 : -10, s);
    const r = ALLY_REWARD[m.id];
    if (!st.rew[md.id]) {
      st.rew[md.id] = true;
      p.credits += r.isk;
      const h = this.hangar(p, p.home);
      for (const [it, n] of Object.entries(r.items)) h.items[it] = (h.items[it] || 0) + n;
      this.notify(s, `Союз заключён. ${r.text} — в ангаре вашей домашней станции.`, 'good');
    }
    s.send({ t: 'dialog', kind: 'info', title: 'Союз заключён', from: FACTIONS[m.id].leader, lines: ['Добро пожаловать. Теперь это и ваша война, пилот.'] });
    this.nextMission(s, p);
  };

  // судьба Колосса: меняет фронт, репутацию или даёт чертежи
  P.storyChoice2 = function (s, m, p, st, md) {
    if (!md.options[m.id] || st.c2choice) return;
    st.c2choice = m.id;
    const h = this.hangar(p, p.home);
    if (m.id === 'destroy') for (const f of Object.keys(FACTIONS)) this.addRep(p, f, 10, s);
    else if (m.id === 'control' && st.ally && this.warFront) {
      let n = 0;
      for (const sys of this.warFront()) if (this.warAttackers(sys).includes(st.ally)) { this.warPush(sys, st.ally, 15); n++; }
      this.notify(s, `Тень Колосса легла на фронт: «${FACTIONS[st.ally].short}» усилила натиск в ${n} системах`, 'good');
    } else if (m.id === 'free') { for (let i = 0; i < 2; i++) { const bp = this.rareBlueprint && this.rareBlueprint(); if (bp) h.items[bp] = (h.items[bp] || 0) + 1; } this.notify(s, 'Дар Колосса — два редких чертежа — в ангаре домашней станции', 'good'); }
    s.send({ t: 'dialog', kind: 'info', title: 'Решение принято', from: 'Совет фракций', lines: [md.options[m.id].text + '. Так тому и быть, пилот.'] });
    this.nextMission(s, p);
  };

  P.nextMission = function (s, p) {
    const st = this.storyOf(p);
    st.m++; st.st = 0; st.prog = 0; st.kills = 0; st.failed = null; st.state = 'offer';
    this.clearSite(p);
    if (MISSIONS[st.m]) setTimeout(() => { if (this.sessions.has(s)) this.sendBriefing(s); }, 2500);
    this.sendProfile(s); this.save();
  };

  P.completeStory = function (s, p) {
    const st = this.storyOf(p), md = MISSIONS[st.m];
    if (!st.rew[md.id]) { // награда выдаётся строго один раз
      st.rew[md.id] = true;
      p.credits += md.reward.isk || 0;
      for (const [f, v] of Object.entries(md.reward.rep || {})) this.addRep(p, allyOf(p, f), v, s);
      if (md.reward.items) { const h = this.hangar(p, p.home); for (const [it, n] of Object.entries(md.reward.items)) h.items[it] = (h.items[it] || 0) + n; }
      this.notify(s, `Миссия «${md.title}» выполнена! Награда: ${fmt(md.reward.isk || 0)} ISK`, 'good');
    }
    if (md.final2) st.c2done = true;
    const last = md.epilogue || md.final2;
    const text = md.epilogue ? EPILOGUE[st.ally] || EPILOGUE.liga : md.final2 ? EPILOGUE2[st.c2choice] || EPILOGUE2.destroy : md.done;
    if (text) s.send({ t: 'dialog', kind: last ? 'final' : 'info', title: last ? 'Эпилог' : `Миссия выполнена: ${md.title}`, from: last ? (FACTIONS[st.ally] || FACTIONS.liga).leader : this.speakerOf(p, md), lines: [text],
      reward: md.reward.isk ? `${fmt(md.reward.isk)} ISK` : null });
    this.nextMission(s, p);
  };

  // ---------- этапы ----------
  P.beginStage = function (s, p) {
    const st = this.storyOf(p), md = MISSIONS[st.m], stage = md && md.stages[st.st];
    if (!stage) return;
    st.prog = 0; st.failed = null;
    if (stage.type === 'mine') st.mined0 = p.stats.mined;
    if (stage.type === 'hunt') st.kills = 0;
    if (stage.type === 'stat') st.base = (p.stats && p.stats[stage.stat]) || 0;
    this.notify(s, 'Новая задача: ' + stage.text, 'info');
  };
  P.advanceStage = function (s, p) {
    const st = this.storyOf(p), md = MISSIONS[st.m];
    st.st++;
    if (st.st >= md.stages.length) return this.completeStory(s, p);
    // одна и та же точка может обслуживать несколько этапов — пересоздаём только при смене места
    const next = md.stages[st.st], site = this.siteOf(p);
    if (site && (next.type !== 'site' || next.site !== site.name || next.sys !== site.sys)) this.clearSite(p);
    else if (site) { site.triggered = false; site.stageKey = null; }
    this.beginStage(s, p);
    this.sendProfile(s); this.save();
  };

  P.siteOf = function (p) { return this.anoms ? [...this.anoms.values()].find(a => a.owner === p.name && a.kind === 'story') : null; };
  P.clearSite = function (p) {
    const a = this.siteOf(p);
    if (!a) return;
    this.anoms.delete(a.id);
    for (const e of [...this.ents.values()]) if (e.storySite === a.id) this.removeEntity(e);
    for (const s of this.sessions) if (s.player === p) this.sendAnoms(s);
  };
  P.ensureSite = function (s, p, stage) {
    let a = this.siteOf(p);
    if (a && a.sys === stage.sys && a.name === stage.site) return a;
    if (a) this.clearSite(p);
    if (!this.anoms) this.anoms = new Map();
    const ang = Math.random() * Math.PI * 2, r = (1.2 + Math.random() * 4) * AU;
    a = { id: 'an_st_' + uid(), sys: stage.sys, kind: 'story', owner: p.name, name: stage.site, radius: 0, landing: 8000,
      pos: [Math.cos(ang) * r, (Math.random() - 0.5) * 0.04 * r, Math.sin(ang) * r], sig: 1, created: this.now, expires: Infinity, triggered: false, npcs: new Set() };
    this.anoms.set(a.id, a);
    (p.known || (p.known = {}))[a.id] = true;
    this.sendAnoms(s);
    return a;
  };

  P.spawnStoryNpc = function (a, type, focus) {
    const e = this.spawnNpc(type, a.sys, add(a.pos, [rnd(-18000, 18000), rnd(-3000, 3000), rnd(-18000, 18000)]));
    e.home = a.pos; e.anom = a.id; e.storySite = a.id;
    if (focus) e.storyFocus = focus;
    a.npcs.add(e.id);
    return e;
  };

  // Раз в секунду: проверка условий этапа для каждого игрока
  P.storyTick = function () {
    for (const s of this.sessions) {
      const p = s.player, st = this.storyOf(p);
      if (st.state !== 'active') continue;
      const md = MISSIONS[st.m], stage = md && md.stages[st.st];
      if (!stage) continue;
      const e = s.ent;
      switch (stage.type) {
        case 'travel': if (e && !e.warp && e.sys === stage.sys) this.advanceStage(s, p); break;
        case 'mine': if (p.stats.mined - (st.mined0 || 0) >= stage.qty) this.advanceStage(s, p); else if (this.now - (st.lastSync || 0) > 5000) { st.lastSync = this.now; this.sendProfile(s); } break;
        case 'hunt': if ((st.kills || 0) >= stage.qty) this.advanceStage(s, p); break;
        case 'stat': if (((p.stats && p.stats[stage.stat]) || 0) - (st.base || 0) >= stage.qty) this.advanceStage(s, p); else if (this.now - (st.lastSync || 0) > 5000) { st.lastSync = this.now; this.sendProfile(s); } break;
        case 'warjoin': if (p.war) this.advanceStage(s, p); break;
        case 'site': this.siteStage(s, p, st, stage); break;
      }
    }
  };

  P.siteStage = function (s, p, st, stage) {
    const e = s.ent;
    const a = this.ensureSite(s, p, stage);
    const key = st.m + ':' + st.st;
    if (!e || e.warp || e.sys !== a.sys) return;
    const d = dist(e.pos, a.pos);
    if (stage.act === 'reach') { if (d < 30000) this.advanceStage(s, p); return; }
    if (stage.act === 'hack') {
      if (a.npcs.size) return;
      if (d > 15000) { if (st.prog && this.now - (st.hackWarn || 0) > 15000) { st.hackWarn = this.now; this.notify(s, 'Слишком далеко от точки — подлетите ближе 15 км', 'warn'); } return; }
      st.prog = (st.prog || 0) + 1;
      if (st.prog % 5 === 0 || st.prog === 1) { this.notify(s, `Сбор данных: ${Math.min(100, Math.round(st.prog / stage.secs * 100))}%`, 'info'); this.sendProfile(s); }
      if (st.prog >= stage.secs) this.advanceStage(s, p);
      return;
    }
    if (stage.act === 'kill') {
      if (d > 150000 && !a.triggered) return;
      if (!a.triggered || a.stageKey !== key) {
        a.triggered = true; a.stageKey = key;
        for (const id of a.npcs) { const n = this.ents.get(id); if (n) this.removeEntity(n); }
        a.npcs.clear();
        for (const type of this.diffEnemies(p, stage.enemies)) this.spawnStoryNpc(a, type);
        this.notify(s, `${a.name}: противник на сканере!`, 'bad');
        return;
      }
      for (const id of [...a.npcs]) if (!this.ents.has(id)) a.npcs.delete(id);
      if (!a.npcs.size) this.advanceStage(s, p);
      return;
    }
    if (stage.act === 'loot') {
      if ((p.ship.cargo[stage.item] || 0) > 0) return this.advanceStage(s, p);
      if (d > 150000) return;
      if (a.stageKey !== key || !this.ents.has(a.lootId)) {
        a.stageKey = key;
        const w = { id: 'wr_' + uid(), type: 'wreck', sys: a.sys, pos: add(a.pos, [rnd(-4000, 4000), rnd(-800, 800), rnd(-4000, 4000)]), vel: [0, 0, 0],
          radius: 120, name: `Обломки: ${a.name}`, items: { [stage.item]: 1, salv_scrap: 3 }, expires: this.now + 3600000, anom: a.id, storySite: a.id, owner: p.name };
        this.ents.set(w.id, w); a.lootId = w.id;
        this.notify(s, `${a.name}: обломки на сканере. Подлетите и заберите «${ITEMS[stage.item].name}».`, 'info');
      }
      return;
    }
    if (stage.act === 'defend') return this.defendStage(s, p, st, stage, a, d, key);
  };

  P.defendStage = function (s, p, st, stage, a, d, key) {
    if (!a.triggered || a.stageKey !== key) {
      if (d > 120000) return;
      a.triggered = true; a.stageKey = key; a.wave = 0; a.nextWave = this.now + 8000;
      const t = this.spawnCiv(a.sys, { role: 'trader', shipType: stage.ship, name: stage.ally });
      t.pos = a.pos.slice(); t.vel = [0, 0, 0]; t.storyHold = true; t.storySite = a.id; t.cmd = { type: 'stop' };
      a.allyId = t.id;
      this.notify(s, `${stage.ally} на связи: «Скверна близко! Прикройте нас!»`, 'warn');
      return;
    }
    const t = this.ents.get(a.allyId);
    if (!t) {
      // провал: откат к контрольной точке — этап можно повторить, вернувшись к точке
      for (const id of a.npcs) { const n = this.ents.get(id); if (n) this.removeEntity(n); }
      a.npcs.clear(); a.triggered = false; a.stageKey = null;
      st.failed = `${stage.ally} уничтожен. Держитесь ближе к нему и в первую очередь бейте тех, кто его атакует.`;
      this.notify(s, 'Миссия провалена: ' + st.failed + ' Вернитесь к точке, чтобы попробовать снова.', 'bad');
      this.sendProfile(s);
      return;
    }
    for (const id of [...a.npcs]) if (!this.ents.has(id)) a.npcs.delete(id);
    if (a.wave < stage.waves.length && (this.now >= a.nextWave || (!a.npcs.size && this.now >= a.nextWave - 6000))) {
      for (const type of this.diffEnemies(p, stage.waves[a.wave])) this.spawnStoryNpc(a, type, t.id);
      a.wave++; a.nextWave = this.now + 45000;
      this.notify(s, `Волна ${a.wave} из ${stage.waves.length}!`, 'bad');
      return;
    }
    if (a.wave >= stage.waves.length && !a.npcs.size) {
      this.removeEntity(t);
      this.advanceStage(s, p);
    }
  };

  // ---------- сложность ----------
  // История: на одного врага меньше (не меньше двух), «Жнецы» заменены «Рейдерами»; опытный пилот: +1 рейдер.
  P.diffEnemies = function (p, list) {
    const d = p.difficulty || 'normal';
    if (d === 'story') { const l = list.map(x => x === 'reaper' ? 'raider' : x); return l.length > 2 ? l.slice(0, -1) : l; }
    if (d === 'veteran') return [...list, 'raider'];
    return list;
  };
  P.c_difficulty = function (s, m, p) {
    if (!['story', 'normal', 'veteran'].includes(m.v)) return;
    if (s.ent && s.ent.lastHitAt && this.now - s.ent.lastHitAt < 30000) return this.notify(s, 'Сложность нельзя менять в бою', 'warn');
    p.difficulty = m.v;
    this.notify(s, 'Сложность: ' + { story: 'История', normal: 'Стандарт', veteran: 'Опытный пилот' }[m.v], 'good');
    this.sendProfile(s);
  };

  // ---------- хуки игровых событий ----------
  P.storyKill = function (p, t, sysId) {
    const st = this.storyOf(p), md = MISSIONS[st.m], stage = md && md.stages[st.st];
    if (st.state !== 'active' || !stage) return;
    if (stage.type === 'hunt' && t.npc && this.U.byId[sysId].sec < 0.5) st.kills = (st.kills || 0) + 1;
  };
  P.storyScan = function (s) {
    const p = s.player, st = this.storyOf(p), md = MISSIONS[st.m], stage = md && md.stages[st.st];
    if (st.state === 'active' && stage && stage.type === 'scan' && s.ent && s.ent.sys === stage.sys) this.advanceStage(s, p);
  };
  P.storyDock = function (s) {
    const p = s.player, st = this.storyOf(p);
    const md = MISSIONS[st.m], stage = md && md.stages[st.st];
    if (st.state === 'offer' && md && !s._briefed) { s._briefed = true; setTimeout(() => { if (this.sessions.has(s)) this.sendBriefing(s); }, 1500); }
    if (st.state !== 'active' || !stage) return;
    if (stage.type === 'dock' && s.docked === stage.station) return this.advanceStage(s, p);
    if (stage.type === 'deliver' && s.docked === stage.station) {
      const h = this.hangar(p, s.docked);
      if ((p.ship.cargo[stage.item] || 0) > 0) { if (!--p.ship.cargo[stage.item]) delete p.ship.cargo[stage.item]; }
      else if ((h.items[stage.item] || 0) > 0) { if (!--h.items[stage.item]) delete h.items[stage.item]; }
      else return;
      this.advanceStage(s, p);
    }
  };
};
module.exports.FACTIONS = FACTIONS;
module.exports.MISSIONS = MISSIONS;
module.exports.factionOfSys = factionOfSys;
module.exports.homeFactionOfSys = homeFactionOfSys;
module.exports.setWarOwner = (o) => { WAR_OWNER = o; };
