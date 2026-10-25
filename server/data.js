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
  },
  gadyuka: {
    name: 'Гадюка', cls: 'Ракетный фрегат', price: 95000, color: 0x3d4a3a,
    maxSpeed: 360, align: 3, warpSpeed: 5, sig: 38, radius: 42,
    shield: 520, armor: 420, hull: 460, cap: 380, capRegen: 9,
    cargo: 250, slots: { high: 3, mid: 2, low: 2 }, maxLocks: 3, lockRange: 40000, lockTime: 2,
    bonus: { missile: 0.3 }, desc: 'Быстрый ракетный фрегат: +30% урона ракет. Бьёт издалека и уходит.', req: { gunnery: 1 }
  },
  burya: {
    name: 'Буря', cls: 'Ракетный крейсер', price: 780000, color: 0x46423a,
    maxSpeed: 230, align: 6, warpSpeed: 3, sig: 140, radius: 105,
    shield: 3200, armor: 2600, hull: 2800, cap: 1600, capRegen: 22,
    cargo: 600, slots: { high: 5, mid: 4, low: 3 }, maxLocks: 5, lockRange: 60000, lockTime: 3,
    bonus: { missile: 0.35, missileSpeed: 0.25 }, desc: 'Ракетный крейсер: +35% урона и +25% скорости ракет. Встроенный запас ракет на 3 залпа больше.', req: { gunnery: 3 }
  },
  bastion: {
    name: 'Бастион', cls: 'Линкор обороны', price: 4200000, color: 0x4a5058,
    maxSpeed: 105, align: 13, warpSpeed: 1.8, sig: 420, radius: 280,
    shield: 16000, armor: 18000, hull: 14000, cap: 6000, capRegen: 60,
    cargo: 1500, slots: { high: 6, mid: 6, low: 4 }, maxLocks: 6, lockRange: 70000, lockTime: 5,
    bonus: { turrets: 3, turretDmg: 0.5, pd: 0.5 }, desc: 'Линкор обороны: +3 развёртываемые турели, урон турелей +50%, ПРО перезаряжается вдвое быстрее. Держит позицию, пока союзники работают.', req: { gunnery: 4, shields: 3 }
  },
  matka: {
    name: 'Матка', cls: 'Авианосец', price: 6500000, color: 0x45484e,
    maxSpeed: 95, align: 15, warpSpeed: 1.6, sig: 480, radius: 300,
    shield: 14000, armor: 15000, hull: 15000, cap: 5500, capRegen: 55,
    cargo: 1200, slots: { high: 3, mid: 6, low: 5 }, maxLocks: 8, lockRange: 80000, lockTime: 5,
    bonus: { drones: 0.6 }, desc: 'Авианосец: отсек на 800 м³ и до 10 дронов в космосе одновременно, +60% урона дронов.', req: { drones: 4, gunnery: 2 }
  },
  fortress: {
    name: 'Пиратская крепость', cls: 'Станция Скверны', price: 0, color: 0x3a2a28,
    maxSpeed: 0, align: 99, warpSpeed: 0, sig: 6000, radius: 2400,
    shield: 120000, armor: 140000, hull: 160000, cap: 99999, capRegen: 999,
    cargo: 0, slots: { high: 0, mid: 0, low: 0 }, maxLocks: 8, lockRange: 90000, lockTime: 2,
    desc: 'Укреплённая база Скверны. Орудийные башни, ракетные батареи и ПРО. В одиночку не взять.'
  },
  begemot: {
    name: 'Бегемот', cls: 'Индустриальный дредноут', price: 18000000, color: 0x3a3c40, code: 'SC-02',
    maker: 'Орион-Хэви-Индастриз', length: 4200, crew: '450 + 1500 технологов',
    maxSpeed: 55, align: 30, warpSpeed: 0.8, sig: 1200, radius: 1000,
    shield: 30000, armor: 45000, hull: 50000, cap: 9000, capRegen: 70,
    cargo: 80000, slots: { high: 4, mid: 4, low: 4 }, maxLocks: 3, lockRange: 40000, lockTime: 8,
    bonus: { mining: 1.5 }, foundry: { range: 25000, cycle: 6, perRock: 300, maxRocks: 10, refine: 0.85 },
    desc: 'SC-02 — мобильный плавильный комплекс длиной 4,2 км. Всеядные буры сами поглощают ВСЕ астероиды в радиусе 25 км, а литейный цех на лету переплавляет руду в слитки (85% выхода завода). Трюм 80 000 м³, +150% к добыче, отсек на 5 дронов-тендеров.',
    req: { mining: 4, trade: 2, engineering: 2 }
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
  ore_xenon:     { name: 'Ксенон-кристалл', cat: 'Руда', vol: 3, base: 720, color: 0x50ffd0 },
  mat_steel:     { name: 'Сталь', cat: 'Материалы', vol: 0.5, base: 80 },
  mat_ceramite:  { name: 'Керамит', cat: 'Материалы', vol: 0.6, base: 230 },
  mat_crystal:   { name: 'Кристаллит', cat: 'Материалы', vol: 0.8, base: 950 },
  mat_nullalloy: { name: 'Нуль-сплав', cat: 'Материалы', vol: 1, base: 3000 },
  mat_xcore:     { name: 'Ксенон-ядро', cat: 'Материалы', vol: 1.5, base: 16000 },
  ore_nullium:   { name: 'Нуллий', cat: 'Руда', vol: 2, base: 220, color: 0xb050e0 },
  salv_scrap:    { name: 'Металлолом', cat: 'Трофеи', vol: 1, base: 600 },
  salv_core:     { name: 'Пиратское ядро', cat: 'Трофеи', vol: 2, base: 6000 },
  salv_relic:    { name: 'Древняя реликвия', cat: 'Трофеи', vol: 5, base: 40000 },
  courier_pack:  { name: 'Опечатанный контейнер', cat: 'Миссия', vol: 5, base: 0, noSell: true },
  energy_cell:   { name: 'Энергоячейка', cat: 'Энергия', vol: 0.2, base: 250, consumable: true },
  msl_std:       { name: 'Ракета «Игла»', cat: 'Боеприпасы', vol: 0.5, base: 150, consumable: true },
  msl_torp:      { name: 'Торпеда «Гром»', cat: 'Боеприпасы', vol: 2.5, base: 1100, consumable: true },
  turret_kit:    { name: 'Развёртываемая турель «Страж-Т»', cat: 'Оборона', vol: 20, base: 45000, consumable: true }
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
// Ракеты, ПРО: ракеты — отдельные снаряды (летят, их можно сбить), урон зависит от сигнатуры цели
Object.assign(MODULES, {
  ml_light: { name: 'Ракетная установка «Игла»', slot: 'high', kind: 'launcher', price: 14000, dmg: 70, cycle: 5, cap: 3, range: 32000, speed: 3200, explR: 60, ammo: 'msl_std', color: 0xffa040, vol: 5 },
  ml_heavy: { name: 'Торпедный аппарат «Гром»', slot: 'high', kind: 'launcher', price: 110000, dmg: 380, cycle: 12, cap: 8, range: 45000, speed: 1700, explR: 320, ammo: 'msl_torp', color: 0xff5020, vol: 20 },
  ml_x:     { name: 'Ракетный рой «Шторм»', slot: 'high', kind: 'launcher', price: 560000, dmg: 90, cycle: 6, cap: 6, range: 38000, speed: 3800, explR: 70, salvo: 3, ammo: 'msl_std', color: 0xff70d0, vol: 10, elite: true },
  pd_1:     { name: 'Система ПРО «Заслон»', slot: 'mid', kind: 'pd', price: 18000, cycle: 1.5, cap: 4, range: 7000, shots: 1, vol: 5 },
  pd_2:     { name: 'Тяжёлая ПРО «Купол»', slot: 'mid', kind: 'pd', price: 90000, cycle: 1.2, cap: 8, range: 12000, shots: 2, vol: 15 }
});

// ---------- Улучшение модулей до 5 уровня ----------
// Каждый уровень — отдельный предмет «<id>_l<N>»: его можно ставить, хранить, продавать и выставлять на биржу,
// поэтому весь остальной код работает с ним как с обычным модулем.
const MOD_UPGRADE = {
  maxLv: 5,
  isk: [0, 0, 0.5, 1, 2, 4],                // доля базовой цены модуля за переход на уровень N
  mats: { 2: { mat_steel: 20 }, 3: { mat_steel: 40, mat_ceramite: 20 }, 4: { mat_ceramite: 40, mat_crystal: 15 }, 5: { mat_crystal: 30, mat_nullalloy: 10 } },
  eliteMats: { 4: { mat_xcore: 1 }, 5: { mat_xcore: 3 } },
  cells: { 2: 5, 3: 10, 4: 25, 5: 50 },     // энергоячейки на работу верфи
  buyMarkup: 1.5,                           // недостающие материалы станция продаёт дороже рынка
  // прирост характеристик за каждый уровень сверх первого
  per: { dmg: 0.12, range: 0.05, yield: 0.15, amount: 0.12, speed: 0.1, passive: 0.15, cap: -0.04 }
};
const modBase = (id) => (MODULES[id] && MODULES[id].base) || id;
const modLevel = (id) => (MODULES[id] && MODULES[id].lv) || 1;
function upgradeCost(id) {
  const m = MODULES[id], L = modLevel(id) + 1;
  if (!m || L > MOD_UPGRADE.maxLv) return null;
  const base = MODULES[modBase(id)], k = Math.max(1, base.vol / 5);
  const mats = {};
  for (const [it, q] of Object.entries(MOD_UPGRADE.mats[L])) mats[it] = Math.ceil(q * k);
  if (base.elite) for (const [it, q] of Object.entries(MOD_UPGRADE.eliteMats[L] || {})) mats[it] = (mats[it] || 0) + q;
  mats.energy_cell = MOD_UPGRADE.cells[L];
  return { next: `${modBase(id)}_l${L}`, level: L, isk: Math.round(base.price * MOD_UPGRADE.isk[L]), mats };
}
for (const [id, m] of Object.entries({ ...MODULES })) {
  m.base = id; m.lv = 1;
  const P = MOD_UPGRADE.per;
  for (let L = 2; L <= MOD_UPGRADE.maxLv; L++) {
    const f = (k) => 1 + P[k] * (L - 1);
    const v = { ...m, base: id, lv: L, name: `${m.name} · ур.${L}`, price: Math.round(m.price * (1 + 0.6 * (L - 1))) };
    if (m.dmg) v.dmg = Math.round(m.dmg * f('dmg'));
    if (m.optimal) { v.optimal = Math.round(m.optimal * f('range')); v.falloff = Math.round(m.falloff * f('range')); }
    if (m.yield) v.yield = Math.round(m.yield * f('yield'));
    if (m.range) v.range = Math.round(m.range * f('range'));
    if (m.amount) v.amount = Math.round(m.amount * f('amount'));
    if (m.speedBonus) v.speedBonus = Math.round(m.speedBonus * f('speed') * 100) / 100;
    if (m.cap) v.cap = Math.round(m.cap * f('cap') * 10) / 10;
    if (m.passive) v.passive = Object.fromEntries(Object.entries(m.passive).map(([k, x]) => [k, Math.round(x * f('passive') * 1000) / 1000]));
    MODULES[`${id}_l${L}`] = v;
  }
}

// нагрев за выстрел: лазеры греются сильнее рельсотронов, мощные орудия — сильнее слабых
for (const [id, m] of Object.entries(MODULES)) if (m.kind === 'weapon') m.heatPerShot = Math.round(m.dmg * (m.base.startsWith('rail') ? 0.09 : 0.12) * 10) / 10;
for (const [id, m] of Object.entries(MODULES)) ITEMS[id] = { name: m.name, cat: m.elite ? 'Элитные модули' : 'Модули', vol: m.vol, base: m.price, module: true, elite: m.elite, lv: m.lv };

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
  strizh: [0, 0], sokol: [10, 2], staratel: [15, 3], vihr: [10, 2], piligrim: [150, 5], leviafan: [100, 5], kit: [0, 0], citadel: [100, 5], begemot: [400, 5],
  gadyuka: [10, 2], burya: [50, 4], bastion: [150, 5], matka: [800, 10], fortress: [0, 0] };
for (const [id, [bay, max]] of Object.entries(DRONE_CAPS)) { SHIPS[id].droneBay = bay; SHIPS[id].maxDrones = max; }

// Какие руды встречаются при данном уровне безопасности
function oresForSec(sec) {
  if (sec >= 0.7) return [['ore_ferit', 0.75], ['ore_korundit', 0.25]];
  if (sec >= 0.45) return [['ore_ferit', 0.4], ['ore_korundit', 0.45], ['ore_arkselit', 0.15]];
  if (sec > 0) return [['ore_korundit', 0.4], ['ore_arkselit', 0.5], ['ore_nullium', 0.1]];
  if (sec <= -0.8) return [['ore_nullium', 0.6], ['ore_xenon', 0.4]];
  return [['ore_arkselit', 0.45], ['ore_nullium', 0.55]];
}

// ---------- Пираты ----------
const NPCS = {
  raider: { name: 'Рейдер Скверны', ship: 'klinok', bounty: 9000, dmgMul: 0.8, hpMul: 0.7, weapon: 'laser_s', guns: 2, speedMul: 0.9,
            loot: [['salv_scrap', 0.7, 1, 3], ['salv_core', 0.08, 1, 1]] },
  reaper: { name: 'Жнец Скверны', ship: 'strazh', bounty: 45000, dmgMul: 0.75, hpMul: 0.9, weapon: 'rail_s', guns: 3, speedMul: 0.9, launchers: ['ml_light'],
            loot: [['salv_scrap', 0.9, 2, 6], ['salv_core', 0.3, 1, 2], ['laser_m', 0.1, 1, 1]] },
  hunter: { name: 'Охотник Скверны', ship: 'vihr', bounty: 28000, dmgMul: 0.75, hpMul: 0.8, weapon: 'laser_s', guns: 4, speedMul: 0.9,
            loot: [['salv_scrap', 0.9, 1, 4], ['salv_core', 0.2, 1, 1], ['laser_s', 0.15, 1, 1]] },
  dreadlord: { name: 'Владыка Скверны', ship: 'citadel', bounty: 750000, dmgMul: 0.8, hpMul: 1, weapon: 'rail_l', guns: 4, speedMul: 0.8, launchers: ['ml_heavy', 'ml_light'], pd: 'pd_1',
            loot: [['salv_relic', 1, 1, 3], ['salv_core', 1, 3, 6], ['rail_l', 0.5, 1, 2], ['shield_booster_l', 0.4, 1, 1], ['drone_heavy', 0.4, 1, 2]] },
  outlaw: { name: 'Преступник', ship: 'klinok', bounty: 60000, dmgMul: 0.95, hpMul: 1, weapon: 'laser_m', guns: 3, speedMul: 1,
            loot: [['salv_core', 0.6, 1, 2], ['salv_scrap', 0.8, 2, 5], ['laser_m', 0.25, 1, 1], ['afterburner', 0.25, 1, 1], ['drone_light', 0.3, 1, 2]] },
  corsair:{ name: 'Корсар Скверны', ship: 'gadyuka', bounty: 35000, dmgMul: 0.85, hpMul: 0.9, weapon: 'ml_light', guns: 3, speedMul: 1.05,
            loot: [['msl_std', 0.8, 10, 40], ['salv_core', 0.3, 1, 2], ['ml_light', 0.15, 1, 1]] },
  brood:  { name: 'Матка Скверны', ship: 'matka', bounty: 400000, dmgMul: 0.7, hpMul: 0.6, weapon: 'laser_m', guns: 2, speedMul: 0.9, swarm: 6, pd: 'pd_1',
            loot: [['salv_core', 1, 3, 6], ['drone_heavy', 0.5, 1, 3], ['salv_relic', 0.4, 1, 2], ['pd_2', 0.2, 1, 1]] },
  swarm:  { name: 'Рой Скверны', ship: 'strizh', bounty: 3000, dmgMul: 0.6, hpMul: 0.4, weapon: 'laser_s', guns: 1, speedMul: 1.3, loot: [['salv_scrap', 0.3, 1, 1]] },
  fortress:{ name: 'Пиратская крепость', ship: 'fortress', bounty: 4000000, dmgMul: 1, hpMul: 1, weapon: 'rail_l', guns: 6, speedMul: 0, launchers: ['ml_heavy', 'ml_heavy', 'ml_light', 'ml_light'], pd: 'pd_2',
            loot: [['salv_relic', 1, 4, 8], ['salv_core', 1, 8, 15], ['laser_x', 0.3, 1, 1], ['rail_x', 0.3, 1, 1], ['ml_x', 0.4, 1, 1], ['shield_x', 0.25, 1, 1], ['mat_xcore', 1, 3, 8]] },
  warlord:{ name: 'Полководец Скверны', ship: 'molot', bounty: 220000, dmgMul: 0.85, hpMul: 1.15, weapon: 'rail_l', guns: 3, speedMul: 0.8, launchers: ['ml_light', 'ml_light'], pd: 'pd_1',
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
// Регионы: свой облик неба и множитель дохода (добыча, награды за пиратов, аномалии, задания)
const REGIONS = {
  core:   { name: 'Ядро Арктура', income: 1.0, color: '#4fd0ff', nebula: 'calm',   stars: ['yellow', 'white', 'yellow'] , labels: [[-40, -265]] },
  border: { name: 'Пограничье', income: 1.4, color: '#e8d05f', nebula: 'gold',   stars: ['yellow', 'orange', 'blue'] , labels: [[330, -150], [-430, -90]] },
  low:    { name: 'Тёмный рубеж', income: 2.0, color: '#ff8a3d', nebula: 'ember',  stars: ['orange', 'red', 'red'] , labels: [[-470, 240], [560, 120]] },
  null:   { name: 'Бездна', income: 2.8, color: '#ff3d4a', nebula: 'blood',  stars: ['red', 'blue', 'white'] , labels: [[650, 360], [-420, 500]] },
  deep:   { name: 'Глубокий космос', income: 4.0, color: '#b45cff', nebula: 'void',   stars: ['blackhole', 'blue', 'white'] , labels: [[500, 610]] }
};
// x,y — координаты на звёздной карте, sec — уровень безопасности, star — тип звезды (иначе выбирается по региону)
const SYSTEMS = [
  { id: 'arktur', name: 'Арктур Прайм', sec: 1.0, x: 0, y: 0, hub: true, region: 'core', star: 'yellow' },
  { id: 'vella', name: 'Велла', sec: 0.9, x: -140, y: -60, region: 'core' },
  { id: 'kassiopa', name: 'Кассиопа', sec: 0.8, x: 130, y: -80, region: 'core', star: 'white' },
  { id: 'lumen', name: 'Люмен', sec: 0.7, x: 40, y: 140, region: 'core' },
  { id: 'sirian', name: 'Сириан', sec: 0.9, x: -60, y: -180, region: 'core', star: 'white' },
  { id: 'polaris', name: 'Полярис', sec: 1.0, x: 100, y: -220, region: 'core', star: 'blue' },
  { id: 'altair', name: 'Альтаир', sec: 0.8, x: -230, y: -170, region: 'core' },
  { id: 'dront', name: 'Дронт', sec: 0.6, x: 260, y: 0, region: 'border' },
  { id: 'eridan', name: 'Эридан', sec: 0.5, x: -260, y: 60, region: 'border', star: 'orange' },
  { id: 'talos', name: 'Талос', sec: 0.7, x: 250, y: -190, region: 'border', star: 'blue' },
  { id: 'korona', name: 'Корона', sec: 0.6, x: 400, y: -90, region: 'border' },
  { id: 'rigel', name: 'Ригель', sec: 0.5, x: -420, y: -40, region: 'border', star: 'blue' },
  { id: 'mirra', name: 'Мирра', sec: 0.4, x: 330, y: 140, region: 'low' },
  { id: 'gierax', name: 'Гиеракс', sec: 0.3, x: -330, y: 190, region: 'low' },
  { id: 'ten7', name: 'Тень-7', sec: 0.1, x: 180, y: 260, region: 'low', star: 'red' },
  { id: 'pepel', name: 'Пепел', sec: 0.2, x: -480, y: 160, region: 'low', star: 'red' },
  { id: 'skorp', name: 'Скорпиус', sec: 0.3, x: 540, y: 60, region: 'low', star: 'orange' },
  { id: 'mgla', name: 'Мгла', sec: 0.1, x: 30, y: 330, region: 'low', star: 'white' },
  { id: 'bezdna', name: 'Бездна', sec: -0.3, x: 450, y: 250, region: 'null' },
  { id: 'haos', name: 'Хаос-Х', sec: -0.7, x: 320, y: 380, region: 'null', star: 'blue' },
  { id: 'nihil', name: 'Нихиль', sec: -0.9, x: -200, y: 340, region: 'null', star: 'red' },
  { id: 'razlom', name: 'Разлом', sec: -0.4, x: 620, y: 300, region: 'null' },
  { id: 'pustosh', name: 'Пустошь', sec: -0.5, x: -400, y: 430, region: 'null', star: 'white' },
  { id: 'kladbishe', name: 'Кладбище кораблей', sec: -0.6, x: 110, y: 480, region: 'null', star: 'red' },
  { id: 'sing', name: 'Сингулярность', sec: -1.0, x: 470, y: 520, region: 'deep', star: 'blackhole' },
  { id: 'eho', name: 'Эхо', sec: -0.8, x: 740, y: 440, region: 'deep', star: 'blue' },
  { id: 'predtecha', name: 'Предтеча', sec: -0.9, x: -180, y: 590, region: 'deep', star: 'white' },
  { id: 'kray', name: 'Край', sec: -1.0, x: 240, y: 650, region: 'deep', star: 'blackhole' }
];
const GATES = [
  ['arktur', 'vella'], ['arktur', 'kassiopa'], ['arktur', 'lumen'], ['kassiopa', 'dront'],
  ['vella', 'eridan'], ['dront', 'mirra'], ['lumen', 'ten7'], ['eridan', 'gierax'],
  ['mirra', 'bezdna'], ['ten7', 'bezdna'], ['ten7', 'haos'], ['bezdna', 'haos'],
  ['gierax', 'nihil'], ['lumen', 'gierax'], ['kassiopa', 'vella'],
  ['vella', 'sirian'], ['sirian', 'polaris'], ['polaris', 'kassiopa'], ['sirian', 'altair'], ['altair', 'vella'],
  ['kassiopa', 'talos'], ['talos', 'korona'], ['dront', 'korona'], ['eridan', 'rigel'], ['rigel', 'altair'],
  ['gierax', 'pepel'], ['pepel', 'rigel'], ['mirra', 'skorp'], ['korona', 'skorp'], ['ten7', 'mgla'], ['mgla', 'lumen'],
  ['bezdna', 'razlom'], ['skorp', 'razlom'], ['nihil', 'pustosh'], ['pepel', 'pustosh'], ['haos', 'kladbishe'], ['mgla', 'kladbishe'],
  ['razlom', 'eho'], ['haos', 'sing'], ['sing', 'eho'], ['kladbishe', 'kray'], ['sing', 'kray'], ['pustosh', 'predtecha'], ['predtecha', 'kray']
];
const STAR_TYPES = {
  yellow:    { name: 'Жёлтая звезда', light: 0xfff1dc },
  white:     { name: 'Белый карлик', light: 0xeef4ff },
  blue:      { name: 'Голубой гигант', light: 0xbcd4ff },
  orange:    { name: 'Оранжевая звезда', light: 0xffd2a0 },
  red:       { name: 'Красный карлик', light: 0xff9c78 },
  blackhole: { name: 'Чёрная дыра', light: 0xc8a0ff }
};
// Перерабатывающая станция игрока: рецепты (выход материала на 1 ед. руды), уровни
const RECIPES = {
  ore_ferit: { out: 'mat_steel', ratio: 0.2 },
  ore_korundit: { out: 'mat_ceramite', ratio: 0.15 },
  ore_arkselit: { out: 'mat_crystal', ratio: 0.12 },
  ore_nullium: { out: 'mat_nullalloy', ratio: 0.1 },
  ore_xenon: { out: 'mat_xcore', ratio: 0.06 }
};
const REFINERY = {
  buildCost: 1500000, buildTime: 30,
  levels: [null, { yield: 1.0, speed: 1, cost: 0 }, { yield: 1.15, speed: 1.6, cost: 2000000 }, { yield: 1.3, speed: 2.5, cost: 5000000 }],
  maxJobs: 3
};
const incomeOf = (sysId) => { const s = SYSTEMS.find(x => x.id === sysId); return s ? REGIONS[s.region].income : 1; };

const STATION_NAMES = ['Торговый узел', 'Шахтёрская платформа', 'Верфь', 'Аванпост', 'Научная станция', 'Перевалочная база'];

module.exports = { AU, SHIPS, MODULES, DRONES, ITEMS, NPCS, SKILLS, SKILL_TIME, SYSTEMS, GATES, STATION_NAMES, oresForSec, REGIONS, STAR_TYPES, incomeOf, RECIPES, REFINERY , MOD_UPGRADE, upgradeCost, modBase, modLevel };
