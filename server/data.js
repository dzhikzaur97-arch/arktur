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
    bonus: { damage: 0.25 }, desc: 'Тяжёлый ударный корабль. +25% урона.'
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
for (const [id, m] of Object.entries(MODULES)) ITEMS[id] = { name: m.name, cat: 'Модули', vol: m.vol, base: m.price, module: true };

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
  warlord:{ name: 'Полководец Скверны', ship: 'molot', bounty: 220000, dmgMul: 0.55, hpMul: 1, weapon: 'rail_l', guns: 3, speedMul: 0.8,
            loot: [['salv_core', 1, 2, 5], ['salv_relic', 0.3, 1, 1], ['rail_l', 0.2, 1, 1], ['shield_booster_l', 0.2, 1, 1]] }
};

// ---------- Навыки ----------
const SKILLS = {
  gunnery:    { name: 'Артиллерия', desc: '+5% урона орудий за уровень' },
  mining:     { name: 'Добыча', desc: '+5% добычи руды за уровень' },
  navigation: { name: 'Навигация', desc: '+5% скорости за уровень' },
  shields:    { name: 'Щиты', desc: '+5% ёмкости щитов за уровень' },
  engineering:{ name: 'Энергетика', desc: '+5% накопителя и его регенерации за уровень' },
  trade:      { name: 'Торговля', desc: '−1% налога с продаж за уровень (базовый налог 6%)' }
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

module.exports = { AU, SHIPS, MODULES, ITEMS, NPCS, SKILLS, SKILL_TIME, SYSTEMS, GATES, STATION_NAMES, oresForSec };
