// Статические данные игры: корабли, модули, руды, предметы, звёздные системы.
'use strict';

const AU = 1.496e11;

// ---------- Корабли ----------
const SHIPS = {
  iskra: {
    name: 'Искра', cls: 'Фрегат-новичок', price: 0, color: 0x9fb4c8,
    maxSpeed: 330, align: 3.0, warpSpeed: 3, sig: 35, radius: 40,
    shield: 350, armor: 300, hull: 300, cap: 250, capRegen: 6,
    cargo: 400, slots: { high: 2, mid: 2, low: 1 }, maxLocks: 2, lockRange: 25000, lockTime: 2.5,
    defaultFit: ['laser_s', 'miner_1', 'shield_booster', null, null],
    desc: 'Выдаётся бесплатно каждому пилоту. Немного копает, немного стреляет.'
  },
  klinok: {
    name: 'Клинок', cls: 'Штурмовой фрегат', price: 45000, color: 0xc8553d,
    maxSpeed: 420, align: 2.6, warpSpeed: 5, sig: 40, radius: 45,
    shield: 600, armor: 550, hull: 450, cap: 400, capRegen: 9,
    cargo: 300, slots: { high: 3, mid: 2, low: 2 }, maxLocks: 3, lockRange: 30000, lockTime: 2,
    bonus: { damage: 0.15 }, desc: 'Быстрый боевой фрегат. +15% урона орудий.'
  },
  burlak: {
    name: 'Бурлак', cls: 'Шахтёрская баржа', price: 120000, color: 0xd9a441,
    maxSpeed: 150, align: 8, warpSpeed: 2, sig: 180, radius: 120,
    shield: 1500, armor: 900, hull: 1100, cap: 700, capRegen: 12,
    cargo: 5000, slots: { high: 3, mid: 2, low: 1 }, maxLocks: 3, lockRange: 25000, lockTime: 3,
    bonus: { mining: 0.6 }, desc: 'Огромный трюм и +60% к добыче руды.'
  },
  tyagach: {
    name: 'Тягач', cls: 'Транспорт', price: 80000, color: 0x7d8f69,
    maxSpeed: 200, align: 7, warpSpeed: 3, sig: 200, radius: 110,
    shield: 1200, armor: 1200, hull: 1500, cap: 500, capRegen: 8,
    cargo: 12000, slots: { high: 1, mid: 3, low: 3 }, maxLocks: 1, lockRange: 20000, lockTime: 3,
    desc: 'Перевозка грузов между системами. Беззащитен, но вместителен.'
  },
  strazh: {
    name: 'Страж', cls: 'Крейсер', price: 320000, color: 0x4f86c6,
    maxSpeed: 260, align: 5, warpSpeed: 3, sig: 120, radius: 90,
    shield: 2200, armor: 2400, hull: 2000, cap: 1300, capRegen: 20,
    cargo: 450, slots: { high: 5, mid: 3, low: 3 }, maxLocks: 4, lockRange: 45000, lockTime: 3,
    bonus: { damage: 0.1 }, desc: 'Универсальный крейсер для охоты на пиратов.'
  },
  molot: {
    name: 'Молот', cls: 'Линейный крейсер', price: 950000, color: 0x8a5cc2,
    maxSpeed: 190, align: 8, warpSpeed: 2.5, sig: 260, radius: 160,
    shield: 5500, armor: 6000, hull: 5000, cap: 2600, capRegen: 32,
    cargo: 700, slots: { high: 7, mid: 4, low: 4 }, maxLocks: 6, lockRange: 60000, lockTime: 4,
    bonus: { damage: 0.25 }, desc: 'Тяжёлый ударный корабль. +25% урона.', req: { gunnery: 2 }
  },
  strizh: {
    name: 'Стриж', cls: 'Перехватчик', price: 70000, color: 0x5a616b,
    maxSpeed: 680, align: 1.8, warpSpeed: 8, sig: 28, radius: 32,
    shield: 450, armor: 350, hull: 380, cap: 380, capRegen: 9,
    cargo: 120, slots: { high: 2, mid: 3, low: 1 }, maxLocks: 3, lockRange: 35000, lockTime: 1.2,
    bonus: { speed: 0.1 }, desc: 'Самый быстрый корабль. Ловит цели глушителем и уходит от огня крупных орудий.'
  },
  sokol: {
    name: 'Сокол', cls: 'Разведчик', price: 60000, color: 0x60656e,
    maxSpeed: 400, align: 2.4, warpSpeed: 7, sig: 34, radius: 38,
    shield: 500, armor: 400, hull: 420, cap: 450, capRegen: 11,
    cargo: 250, slots: { high: 2, mid: 3, low: 1 }, maxLocks: 3, lockRange: 40000, lockTime: 1.8,
    bonus: { scan: 0.5 }, desc: 'Корабль исследователя: сканирует быстрее и находит аномалии с первого раза.'
  },
  staratel: {
    name: 'Старатель', cls: 'Шахтёрский фрегат', price: 32000, color: 0x5b6068,
    maxSpeed: 280, align: 3.5, warpSpeed: 4, sig: 45, radius: 48,
    shield: 600, armor: 500, hull: 550, cap: 400, capRegen: 9,
    cargo: 900, slots: { high: 2, mid: 2, low: 1 }, maxLocks: 2, lockRange: 25000, lockTime: 2,
    bonus: { mining: 0.35 }, desc: 'Недорогой шахтёрский фрегат: +35% к добыче и трюм 900 м³.'
  },
  vihr: {
    name: 'Вихрь', cls: 'Эсминец', price: 150000, color: 0x575d66,
    maxSpeed: 330, align: 3.5, warpSpeed: 4, sig: 70, radius: 70,
    shield: 1100, armor: 1200, hull: 1000, cap: 700, capRegen: 13,
    cargo: 250, slots: { high: 6, mid: 2, low: 2 }, maxLocks: 4, lockRange: 40000, lockTime: 2,
    bonus: { damage: 0.2 }, desc: 'Шесть орудий на лёгком корпусе. Гроза пиратских фрегатов.', req: { gunnery: 1 }
  },
  piligrim: {
    name: 'Пилигрим', cls: 'Дроновый крейсер', price: 380000, color: 0x545a63,
    maxSpeed: 240, align: 5.5, warpSpeed: 3, sig: 130, radius: 110,
    shield: 2600, armor: 2600, hull: 2400, cap: 1400, capRegen: 20,
    cargo: 500, slots: { high: 3, mid: 4, low: 3 }, maxLocks: 5, lockRange: 55000, lockTime: 3,
    bonus: { drones: 0.5 }, desc: 'Огромный отсек дронов и +50% к их урону и добыче.', req: { drones: 2 }
  },
  leviafan: {
    name: 'Левиафан', cls: 'Эксгуматор', price: 1200000, color: 0x5e5a56,
    maxSpeed: 130, align: 10, warpSpeed: 2, sig: 260, radius: 170,
    shield: 4500, armor: 2500, hull: 3000, cap: 1500, capRegen: 20,
    cargo: 12000, slots: { high: 4, mid: 3, low: 2 }, maxLocks: 4, lockRange: 30000, lockTime: 3.5,
    bonus: { mining: 1.2 }, desc: 'Король добычи: +120% к буровым лазерам и трюм 12 000 м³.', req: { mining: 3 }
  },
  kit: {
    name: 'Кит', cls: 'Грузовоз', price: 900000, color: 0x585d65,
    maxSpeed: 120, align: 14, warpSpeed: 1.5, sig: 400, radius: 260,
    shield: 6000, armor: 8000, hull: 12000, cap: 1200, capRegen: 12,
    cargo: 40000, slots: { high: 0, mid: 2, low: 3 }, maxLocks: 1, lockRange: 20000, lockTime: 5,
    desc: 'Трюм на 40 000 м³ для крупной торговли. Медленный и беззащитный.', req: { trade: 2 }
  },
  citadel: {
    name: 'Цитадель', cls: 'Линкор', price: 2800000, color: 0x50565f,
    maxSpeed: 120, align: 11, warpSpeed: 2, sig: 380, radius: 260,
    shield: 11000, armor: 13000, hull: 11000, cap: 5000, capRegen: 55,
    cargo: 900, slots: { high: 8, mid: 5, low: 5 }, maxLocks: 7, lockRange: 80000, lockTime: 5,
    bonus: { damage: 0.35 }, desc: 'Летающая крепость. +35% урона, восемь орудийных портов.', req: { gunnery: 4, shields: 2 }
  }
};

// ---------- Модули ----------
// slot: high/mid/low; kind: weapon/miner/shieldRep/armorRep/prop/scram/passive
const MODULES = {
  laser_s:   { name: 'Импульсный лазер М1', slot: 'high', kind: 'weapon', price: 3000, dmg: 28, cycle: 2.2, cap: 4, optimal: 8000, falloff: 4000, color: 0xff5040, vol: 5 },
  laser_m:   { name: 'Фокусный лазер М2', slot: 'high', kind: 'weapon', price: 28000, dmg: 75, cycle: 3, cap: 10, optimal: 14000, falloff: 6000, color: 0xff7a30, vol: 10 },
  rail_s:    { name: 'Рельсотрон Р1', slot: 'high', kind: 'weapon', price: 9000, dmg: 45, cycle: 3.5, cap: 2, optimal: 22000, falloff: 8000, color: 0x60c0ff, vol: 5 },
  rail_l:    { name: 'Тяжёлый рельсотрон Р3', slot: 'high', kind: 'weapon', price: 90000, dmg: 160, cycle: 5, cap: 6, optimal: 40000, falloff: 15000, color: 0x90e0ff, vol: 20 },
  miner_1:   { name: 'Буровой лазер Б1', slot: 'high', kind: 'miner', price: 2000, yield: 40, cycle: 6, cap: 5, range: 10000, color: 0x80ff90, vol: 5 },
  miner_2:   { name: 'Глубинный бур Б2', slot: 'high', kind: 'miner', price: 35000, yield: 120, cycle: 8, cap: 12, range: 14000, color: 0x40ffd0, vol: 10 },
  shield_booster: { name: 'Усилитель щита', slot: 'mid', kind: 'shieldRep', price: 4000, amount: 70, cycle: 3, cap: 20, vol: 5 },
  shield_booster_l: { name: 'Тяжёлый усилитель щита', slot: 'mid', kind: 'shieldRep', price: 40000, amount: 260, cycle: 4, cap: 60, vol: 15 },
  afterburner: { name: 'Форсаж', slot: 'mid', kind: 'prop', price: 6000, speedBonus: 1.0, cycle: 5, cap: 8, vol: 5 },
  scrambler: { name: 'Варп-глушитель', slot: 'mid', kind: 'scram', price: 15000, range: 9000, cycle: 5, cap: 6, vol: 5 },
  armor_rep: { name: 'Ремонтник брони', slot: 'low', kind: 'armorRep', price: 5000, amount: 90, cycle: 5, cap: 25, vol: 5 },
  dmg_amp:   { name: 'Усилитель урона', slot: 'low', kind: 'passive', price: 12000, passive: { damage: 0.12 }, vol: 5 },
  cargo_exp: { name: 'Расширитель трюма', slot: 'low', kind: 'passive', price: 5000, passive: { cargo: 0.3 }, vol: 5 },
  mining_upg:{ name: 'Модуль добычи', slot: 'low', kind: 'passive', price: 15000, passive: { mining: 0.12 }, vol: 5 },
  overdrive: { name: 'Нагнетатель двигателя', slot: 'low', kind: 'passive', price: 8000, passive: { speed: 0.12 }, vol: 5 }
};

// ---------- Руды и прочие предметы ----------
const ITEMS = {
  ore_ferit:     { name: 'Ферит', cat: 'Руда', vol: 1, base: 12, color: 0x8c8c8c },
  ore_korundit:  { name: 'Корундит', cat: 'Руда', vol: 1, base: 26, color: 0xb07040 },
  ore_arkselit:  { name: 'Аркселит', cat: 'Руда', vol: 1.5, base: 85, color: 0x6aa0c0 },
  ore_nullium:   { name: 'Нуллий', cat: 'Руда', vol: 2, base: 220, color: 0xb050e0 },
  salv_scrap:    { name: 'Металлолом', cat: 'Трофеи', vol: 1, base: 600 },
  salv_core:     { name: 'Пиратское ядро', cat: 'Трофеи', vol: 2, base: 6000 },
  salv_relic:    { name: 'Древняя реликвия', cat: 'Трофеи', vol: 5, base: 40000 },
  courier_pack:  { name: 'Опечатанный контейнер', cat: 'Миссия', vol: 5, base: 0, noSell: true }
};
// Элитные модули — только на чёрном рынке
Object.assign(MODULES, {
  laser_x:  { name: 'Фазовый лазер «Сверхновая»', slot: 'high', kind: 'weapon', price: 420000, dmg: 125, cycle: 2.4, cap: 9, optimal: 17000, falloff: 7000, color: 0xff40d0, vol: 10, elite: true },
  rail_x:   { name: 'Гаусс-орудие «Комета»', slot: 'high', kind: 'weapon', price: 650000, dmg: 270, cycle: 4.5, cap: 5, optimal: 52000, falloff: 18000, color: 0xb0f0ff, vol: 20, elite: true },
  miner_x:  { name: 'Квантовый бур «Жила»', slot: 'high', kind: 'miner', price: 380000, yield: 260, cycle: 7, cap: 10, range: 18000, color: 0xffe060, vol: 10, elite: true },
  shield_x: { name: 'Щит Предтеч', slot: 'mid', kind: 'shieldRep', price: 520000, amount: 480, cycle: 4, cap: 45, vol: 15, elite: true },
  dmg_x:    { name: 'Нейроусилитель «Ярость»', slot: 'low', kind: 'passive', price: 480000, passive: { damage: 0.3 }, vol: 5, elite: true },
  speed_x:  { name: 'Варп-ускоритель «Призрак»', slot: 'low', kind: 'passive', price: 300000, passive: { speed: 0.3 }, vol: 5, elite: true }
});
for (const [id, m] of Object.entries(MODULES)) ITEMS[id] = { name: m.name, cat: m.elite ? 'Элитные модули' : 'Модули', vol: m.vol, base: m.price, module: true, elite: m.elite };

// ---------- Дроны ----------
const DRONES = {
  drone_light: { name: 'Боевой дрон «Оса»', kind: 'combat', price: 8000, vol: 5, dmg: 14, cycle: 2, range: 2500, speed: 2200, hp: 260, color: 0xffb040 },
  drone_heavy: { name: 'Тяжёлый дрон «Шершень»', kind: 'combat', price: 32000, vol: 10, dmg: 40, cycle: 3, range: 3000, speed: 1400, hp: 750, color: 0xff7040 },
  drone_mine:  { name: 'Шахтёрский дрон «Крот»', kind: 'mining', price: 9000, vol: 5, yield: 20, cycle: 6, range: 1500, speed: 1200, hp: 220, color: 0x80ff90 },
  drone_x:     { name: 'Дрон-призрак «Мираж»', kind: 'combat', price: 260000, vol: 10, dmg: 75, cycle: 2.5, range: 3500, speed: 2600, hp: 1100, color: 0xd060ff, elite: true }
};
for (const [id, d] of Object.entries(DRONES)) ITEMS[id] = { name: d.name, cat: d.elite ? 'Элитные дроны' : 'Дроны', vol: d.vol, base: d.price, drone: true, elite: d.elite };
// Контрабанда: станции её не покупают, торгуют только контрабандисты
Object.assign(ITEMS, {
  cb_implants: { name: 'Запрещённые импланты', cat: 'Контрабанда', vol: 1, base: 18000, noSell: true, contraband: true },
  cb_spice:    { name: 'Контрабандный спайс', cat: 'Контрабанда', vol: 2, base: 9000, noSell: true, contraband: true },
  cb_artifact: { name: 'Артефакт Предтеч', cat: 'Контрабанда', vol: 5, base: 95000, noSell: true, contraband: true },
  cb_ai:       { name: 'Боевой ИИ без лицензии', cat: 'Контрабанда', vol: 3, base: 45000, noSell: true, contraband: true }
});
// Отсек дронов (м³) и сколько дронов можно выпустить одновременно
const DRONE_CAPS = { iskra: [10, 2], klinok: [15, 2], burlak: [50, 5], tyagach: [0, 0], strazh: [50, 5], molot: [75, 5],
  strizh: [0, 0], sokol: [10, 2], staratel: [15, 3], vihr: [10, 2], piligrim: [150, 5], leviafan: [100, 5], kit: [0, 0], citadel: [100, 5] };
for (const [id, [bay, max]] of Object.entries(DRONE_CAPS)) { SHIPS[id].droneBay = bay; SHIPS[id].maxDrones = max; }

// Какие руды встречаются при данном уровне безопасности
function oresForSec(sec) {
  if (sec >= 0.7) return [['ore_ferit', 0.75], ['ore_korundit', 0.25]];
  if (sec >= 0.45) return [['ore_ferit', 0.4], ['ore_korundit', 0.45], ['ore_arkselit', 0.15]];
  if (sec > 0) return [['ore_korundit', 0.4], ['ore_arkselit', 0.5], ['ore_nullium', 0.1]];
  return [['ore_arkselit', 0.45], ['ore_nullium', 0.55]];
}

// ---------- Пираты ----------
const NPCS = {
  raider: { name: 'Рейдер Скверны', ship: 'klinok', bounty: 9000, dmgMul: 0.55, hpMul: 0.7, weapon: 'laser_s', guns: 2, speedMul: 0.9,
            loot: [['salv_scrap', 0.7, 1, 3], ['salv_core', 0.08, 1, 1]] },
  reaper: { name: 'Жнец Скверны', ship: 'strazh', bounty: 45000, dmgMul: 0.5, hpMul: 0.8, weapon: 'rail_s', guns: 3, speedMul: 0.9,
            loot: [['salv_scrap', 0.9, 2, 6], ['salv_core', 0.3, 1, 2], ['laser_m', 0.1, 1, 1]] },
  hunter: { name: 'Охотник Скверны', ship: 'vihr', bounty: 28000, dmgMul: 0.5, hpMul: 0.75, weapon: 'laser_s', guns: 4, speedMul: 0.9,
            loot: [['salv_scrap', 0.9, 1, 4], ['salv_core', 0.2, 1, 1], ['laser_s', 0.15, 1, 1]] },
  dreadlord: { name: 'Владыка Скверны', ship: 'citadel', bounty: 750000, dmgMul: 0.5, hpMul: 0.8, weapon: 'rail_l', guns: 4, speedMul: 0.8,
            loot: [['salv_relic', 1, 1, 3], ['salv_core', 1, 3, 6], ['rail_l', 0.5, 1, 2], ['shield_booster_l', 0.4, 1, 1], ['drone_heavy', 0.4, 1, 2]] },
  outlaw: { name: 'Преступник', ship: 'klinok', bounty: 60000, dmgMul: 0.7, hpMul: 0.9, weapon: 'laser_m', guns: 3, speedMul: 1,
            loot: [['salv_core', 0.6, 1, 2], ['salv_scrap', 0.8, 2, 5], ['laser_m', 0.25, 1, 1], ['afterburner', 0.25, 1, 1], ['drone_light', 0.3, 1, 2]] },
  warlord:{ name: 'Полководец Скверны', ship: 'molot', bounty: 220000, dmgMul: 0.55, hpMul: 1, weapon: 'rail_l', guns: 3, speedMul: 0.8,
            loot: [['salv_core', 1, 2, 5], ['salv_relic', 0.3, 1, 1], ['rail_l', 0.2, 1, 1], ['shield_booster_l', 0.2, 1, 1]] }
};

// ---------- Навыки ----------
// step/unit/what — эффект одного уровня (клиент рисует таблицу по уровням); levels — свой текст для каждого уровня
const SKILLS = {
  gunnery:    { name: 'Артиллерия', group: 'Бой', desc: 'Точная наводка и перезарядка орудий.', step: 5, unit: '%', what: 'урона орудий' },
  shields:    { name: 'Щиты', group: 'Бой', desc: 'Тонкая настройка генераторов щита.', step: 5, unit: '%', what: 'ёмкости щитов' },
  armor:      { name: 'Бронирование', group: 'Бой', desc: 'Укрепление бронеплит корпуса.', step: 5, unit: '%', what: 'прочности брони' },
  targeting:  { name: 'Системы наведения', group: 'Бой', desc: 'Дальше захват и больше целей одновременно.',
                levels: ['+10% дальности захвата', '+20% дальности захвата', '+30% дальности, +1 цель', '+40% дальности, +1 цель', '+50% дальности, +2 цели'] },
  drones:     { name: 'Управление дронами', group: 'Бой', desc: 'Дроны бьют и копают эффективнее.', step: 10, unit: '%', what: 'урона и добычи дронов' },
  navigation: { name: 'Навигация', group: 'Полёт', desc: 'Выжимаете из двигателей всё.', step: 5, unit: '%', what: 'скорости' },
  warpnav:    { name: 'Варп-навигация', group: 'Полёт', desc: 'Быстрее варп между объектами системы.', step: 10, unit: '%', what: 'скорости варпа' },
  engineering:{ name: 'Энергетика', group: 'Полёт', desc: 'Больше энергии для модулей.', step: 5, unit: '%', what: 'накопителя и его регенерации' },
  mining:     { name: 'Добыча', group: 'Промысел', desc: 'Буровые лазеры работают точнее.', step: 5, unit: '%', what: 'добычи руды' },
  scanning:   { name: 'Астрометрия', group: 'Промысел', desc: 'Поиск скрытых аномалий.',
                levels: ['−1 с скан, +10% шанс', '−2 с скан, +20% шанс', '−3 с скан, +30% шанс', '−4 с скан, +40% шанс', '−5 с скан, +50% шанс'] },
  trade:      { name: 'Торговля', group: 'Промысел', desc: 'Меньше налог с продаж (базовый 6%).', step: 1, unit: '%', what: 'налога', sign: '−' }
};
const SKILL_TIME = [0, 60, 240, 900, 3000, 9000]; // секунд на уровень 1..5

// ---------- Карта вселенной ----------
// x,y — координаты на звёздной карте, sec — уровень безопасности
const SYSTEMS = [
  { id: 'arktur', name: 'Арктур Прайм', sec: 1.0, x: 0, y: 0, hub: true },
  { id: 'vella', name: 'Велла', sec: 0.9, x: -140, y: -60 },
  { id: 'kassiopa', name: 'Кассиопа', sec: 0.8, x: 130, y: -80 },
  { id: 'lumen', name: 'Люмен', sec: 0.7, x: 40, y: 140 },
  { id: 'dront', name: 'Дронт', sec: 0.6, x: 260, y: 0 },
  { id: 'eridan', name: 'Эридан', sec: 0.5, x: -260, y: 60 },
  { id: 'mirra', name: 'Мирра', sec: 0.4, x: 330, y: 140 },
  { id: 'gierax', name: 'Гиеракс', sec: 0.3, x: -330, y: 190 },
  { id: 'ten7', name: 'Тень-7', sec: 0.1, x: 180, y: 260 },
  { id: 'bezdna', name: 'Бездна', sec: -0.3, x: 450, y: 250 },
  { id: 'haos', name: 'Хаос-Х', sec: -0.7, x: 320, y: 380 },
  { id: 'nihil', name: 'Нихиль', sec: -0.9, x: -200, y: 340 }
];
const GATES = [
  ['arktur', 'vella'], ['arktur', 'kassiopa'], ['arktur', 'lumen'], ['kassiopa', 'dront'],
  ['vella', 'eridan'], ['dront', 'mirra'], ['lumen', 'ten7'], ['eridan', 'gierax'],
  ['mirra', 'bezdna'], ['ten7', 'bezdna'], ['ten7', 'haos'], ['bezdna', 'haos'],
  ['gierax', 'nihil'], ['lumen', 'gierax'], ['kassiopa', 'vella']
];

const STATION_NAMES = ['Торговый узел', 'Шахтёрская платформа', 'Верфь', 'Аванпост', 'Научная станция', 'Перевалочная база'];

module.exports = { AU, SHIPS, MODULES, DRONES, ITEMS, NPCS, SKILLS, SKILL_TIME, SYSTEMS, GATES, STATION_NAMES, oresForSec };
