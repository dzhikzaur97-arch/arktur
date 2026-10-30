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
  pbase: {
    name: 'Пиратская база', cls: 'Станция Скверны', price: 0, color: 0x3a2a28,
    maxSpeed: 0, align: 99, warpSpeed: 0, sig: 3000, radius: 900,
    shield: 50000, armor: 60000, hull: 70000, cap: 99999, capRegen: 999,
    cargo: 0, slots: { high: 0, mid: 0, low: 0 }, maxLocks: 6, lockRange: 70000, lockTime: 2,
    desc: 'Гнездо Скверны в астероидном обломке. При нападении поднимает щит и выпускает пять волн роёв дронов и кораблей.'
  },
  pdrone: {
    name: 'Дрон Скверны', cls: 'Пиратский дрон', price: 0, color: 0x4a2a28,
    maxSpeed: 750, align: 0.8, warpSpeed: 0, sig: 14, radius: 7,
    shield: 110, armor: 120, hull: 150, cap: 400, capRegen: 30,
    cargo: 0, slots: { high: 1, mid: 0, low: 0 }, maxLocks: 1, lockRange: 40000, lockTime: 1,
    desc: 'Лёгкий боевой дрон пиратов. Нападает роем.'
  },
  // босс мирового события и его генераторы щита (только у NPC)
  colossus: {
    name: 'Колосс Предтеч', cls: 'Машина Предтеч', price: 0, color: 0xf0ece2,
    maxSpeed: 60, align: 20, warpSpeed: 0, sig: 3000, radius: 1800,
    shield: 15000, armor: 20000, hull: 15000, cap: 5000, capRegen: 100,
    cargo: 0, slots: { high: 6, mid: 0, low: 0 }, maxLocks: 6, lockRange: 90000, lockTime: 2,
    desc: 'Машина Предтеч размером с луну. Щит питают четыре генератора — сначала их.'
  },
  wb_gen: {
    name: 'Генератор щита', cls: 'Машина Предтеч', price: 0, color: 0xc8b8ff,
    maxSpeed: 0, align: 1, warpSpeed: 0, sig: 400, radius: 140,
    shield: 3000, armor: 4000, hull: 3000, cap: 1000, capRegen: 20,
    cargo: 0, slots: { high: 1, mid: 0, low: 0 }, maxLocks: 1, lockRange: 40000, lockTime: 2,
    desc: 'Питает щит Колосса. Пока цел хоть один генератор, Колосс почти неуязвим.'
  },
  pdrone_h: {
    name: 'Тяжёлый дрон Скверны', cls: 'Пиратский дрон', price: 0, color: 0x4a2a28,
    maxSpeed: 400, align: 1.5, warpSpeed: 0, sig: 45, radius: 16,
    shield: 700, armor: 1000, hull: 1000, cap: 800, capRegen: 40,
    cargo: 0, slots: { high: 1, mid: 0, low: 0 }, maxLocks: 1, lockRange: 50000, lockTime: 1.5,
    desc: 'Бронированный дрон пиратов с тяжёлым лазером.'
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
,
  // ===== Фракционные линейки: продаются только на станциях своей фракции и требуют репутации =====
  // Консорциум Арктура — верфи Ядра: обтекаемые корпуса цвета слоновой кости с золотой отделкой
  merkuriy: {
    name: 'Меркурий', cls: 'Курьерский фрегат', price: 85000, color: 0xd9d3c4, fac: 'cons', rep: 0,
    maxSpeed: 520, align: 2.3, warpSpeed: 9, sig: 36, radius: 44,
    shield: 700, armor: 450, hull: 500, cap: 420, capRegen: 10,
    cargo: 1800, slots: { high: 1, mid: 3, low: 2 }, maxLocks: 2, lockRange: 28000, lockTime: 2,
    bonus: { cargo: 0.2 }, desc: 'Курьер с лицензией Консорциума: трюм 1 800 м³ (+20% от расширителей) при скорости перехватчика и варпе 9 а.е./с.',
    lore: 'Серийный курьер верфей «Арктур-Индастриз». Возит документы, образцы и срочные заказы между станциями Ядра; страховые компании Консорциума любят его за то, что он почти всегда успевает уйти.'
  },
  prorab: {
    name: 'Прораб', cls: 'Промышленный эсминец', price: 210000, color: 0xd2c8b0, fac: 'cons', rep: 15,
    maxSpeed: 230, align: 5, warpSpeed: 3.5, sig: 90, radius: 85,
    shield: 1600, armor: 1400, hull: 1500, cap: 800, capRegen: 14,
    cargo: 2600, slots: { high: 4, mid: 2, low: 2 }, maxLocks: 3, lockRange: 28000, lockTime: 2.5,
    bonus: { mining: 0.45, cargo: 0.25 }, desc: 'Рабочая лошадка корпоративных рудников: +45% к добыче, +25% к трюму, четыре порта под буры.',
    lore: 'Строится по контракту для подрядчиков Консорциума. Передние захваты держат астероид, пока буры режут жилу, а боковые капсулы принимают руду прямо в трюм.'
  },
  argus: {
    name: 'Аргус', cls: 'Крейсер охраны конвоев', price: 560000, color: 0xe0dac8, fac: 'cons', rep: 15,
    maxSpeed: 250, align: 5.5, warpSpeed: 3, sig: 125, radius: 110,
    shield: 4200, armor: 2200, hull: 2200, cap: 1500, capRegen: 24,
    cargo: 500, slots: { high: 4, mid: 5, low: 3 }, maxLocks: 6, lockRange: 55000, lockTime: 2.5,
    bonus: { pd: 0.5, turrets: 1, damage: 0.1 }, desc: 'Щитовой крейсер сопровождения: мощный щит, ПРО перезаряжается вдвое быстрее, +1 развёртываемая турель, +10% урона.',
    lore: 'Купол-излучатель над корпусом — фирменный знак охраны Консорциума. Сам по себе «Аргус» не гонится за пиратами: он стоит рядом с грузом и сбивает всё, что к нему летит.'
  },
  senator: {
    name: 'Сенатор', cls: 'Флагманский линкор', price: 7500000, color: 0xe4ddc8, fac: 'cons', rep: 40,
    maxSpeed: 110, align: 12, warpSpeed: 2, sig: 420, radius: 300,
    shield: 16000, armor: 13000, hull: 13000, cap: 6500, capRegen: 70,
    cargo: 1400, slots: { high: 8, mid: 6, low: 5 }, maxLocks: 8, lockRange: 85000, lockTime: 4.5,
    bonus: { damage: 0.3, turrets: 1 }, desc: 'Флагман Консорциума: +30% урона, восемь орудийных портов, шесть средних слотов и штабная надстройка. Продаётся только союзникам.',
    lore: 'Таких кораблей меньше двух десятков. Совет директоров выдаёт право на покупку лично — и всегда напоминает, что флагман должен возвращаться к причалу целым.',
    req: { gunnery: 4, shields: 3 }
  },
  // Пограничная Лига — вольные колонисты: грубые модульные корпуса, фермы, контейнеры, оранжевые дюзы
  brodyaga: {
    name: 'Бродяга', cls: 'Колониальный фрегат', price: 40000, color: 0x6e6b4c, fac: 'liga', rep: 0,
    maxSpeed: 310, align: 3.2, warpSpeed: 4.5, sig: 42, radius: 42,
    shield: 550, armor: 650, hull: 600, cap: 380, capRegen: 9,
    cargo: 950, slots: { high: 3, mid: 2, low: 2 }, maxLocks: 2, lockRange: 25000, lockTime: 2.2,
    bonus: { mining: 0.2, damage: 0.1, cargo: 0.3 }, desc: 'Всё понемногу: +20% к добыче, +10% урона, +30% к трюму. Дешёвый и живучий старт на Пограничье.',
    lore: 'Собран из того, что было на складе: кабина от буксира, ферма от старой мачты и контейнер на брюхе. В Лиге шутят, что «Бродяг» не строят — их выращивают.'
  },
  pastuh: {
    name: 'Пастух', cls: 'Дроновый эсминец', price: 170000, color: 0x6a684a, fac: 'liga', rep: 15,
    maxSpeed: 300, align: 4, warpSpeed: 4, sig: 75, radius: 75,
    shield: 1100, armor: 1400, hull: 1200, cap: 700, capRegen: 13,
    cargo: 400, slots: { high: 2, mid: 3, low: 3 }, maxLocks: 4, lockRange: 45000, lockTime: 2,
    bonus: { drones: 0.4 }, desc: 'Открытые ангары на 100 м³ и +40% урона и добычи дронов. Пасёт рой дронов, сам держится в стороне.',
    lore: 'Колонисты Рубежа пасут дронами и скот на фермах, и рудные поля. Боевой «Пастух» — тот же сельский носитель, только с бронёй и рациями пограничников.',
    req: { drones: 1 }
  },
  kovcheg: {
    name: 'Ковчег', cls: 'Колониальный транспорт', price: 650000, color: 0x707052, fac: 'liga', rep: 15,
    maxSpeed: 150, align: 11, warpSpeed: 2, sig: 300, radius: 200,
    shield: 3500, armor: 6500, hull: 8000, cap: 1400, capRegen: 16,
    cargo: 18000, slots: { high: 2, mid: 4, low: 4 }, maxLocks: 2, lockRange: 30000, lockTime: 3.5,
    bonus: { turrets: 2, turretDmg: 0.3 }, desc: 'Трюм 18 000 м³, толстая броня и +2 развёртываемые турели (+30% урона турелей): сам защищает свой груз.',
    lore: 'Вращающееся жилое кольцо, связка контейнеров и шесть дюз. На таких Лига перевозит целые посёлки — вместе с жителями, скотом и оборонительными турелями.',
    req: { trade: 1 }
  },
  taran: {
    name: 'Таран', cls: 'Штурмовой крейсер', price: 1400000, color: 0x5e5c44, fac: 'liga', rep: 40,
    maxSpeed: 270, align: 6, warpSpeed: 3, sig: 160, radius: 140,
    shield: 3000, armor: 7000, hull: 5000, cap: 2200, capRegen: 28,
    cargo: 600, slots: { high: 6, mid: 3, low: 4 }, maxLocks: 5, lockRange: 40000, lockTime: 2.5,
    bonus: { damage: 0.3, speed: 0.15 }, desc: 'Бронированный клин для ближнего боя: +30% урона, +15% скорости, броня 7 000. Врывается в строй пиратов.',
    lore: 'Носовой таран — не украшение: пограничники действительно сносят им пиратские заграждения. Продаётся только тем, кого Лига считает своими.',
    req: { gunnery: 3 }
  },
  // Орден Предела — учёные: плавные «живые» корпуса, кристаллы и кольца с фиолетовым свечением
  iskatel: {
    name: 'Искатель', cls: 'Исследовательский фрегат', price: 130000, color: 0x3c3650, fac: 'orden', rep: 0,
    maxSpeed: 430, align: 2.2, warpSpeed: 10, sig: 30, radius: 40,
    shield: 650, armor: 380, hull: 420, cap: 600, capRegen: 14,
    cargo: 350, slots: { high: 1, mid: 4, low: 2 }, maxLocks: 3, lockRange: 50000, lockTime: 1.5,
    bonus: { scan: 1.0, speed: 0.1 }, desc: 'Лучший сканер в галактике: аномалии находятся вдвое быстрее, варп 10 а.е./с, +10% скорости.',
    lore: 'Кольцо-резонатор вокруг корпуса скопировано с обломков Предтеч. Магистры Ордена отдают «Искатели» всем, кто готов летать туда, где карты ещё пусты.'
  },
  prizma: {
    name: 'Призма', cls: 'Лучевой фрегат', price: 160000, color: 0x3a3450, fac: 'orden', rep: 15,
    maxSpeed: 380, align: 2.8, warpSpeed: 5, sig: 40, radius: 44,
    shield: 900, armor: 450, hull: 500, cap: 900, capRegen: 20,
    cargo: 200, slots: { high: 4, mid: 2, low: 2 }, maxLocks: 3, lockRange: 40000, lockTime: 1.8,
    bonus: { damage: 0.25 }, desc: 'Четыре орудийных порта, +25% урона и огромный накопитель: держит огонь лазеров дольше любого фрегата.',
    lore: 'Между «рогами» корабля парит кристалл, фокусирующий энергию накопителя. Орден признаёт, что сам до конца не понимает, почему это работает.'
  },
  orakul: {
    name: 'Оракул', cls: 'Крейсер поддержки', price: 720000, color: 0x3e3852, fac: 'orden', rep: 15,
    maxSpeed: 240, align: 5.5, warpSpeed: 3.5, sig: 120, radius: 115,
    shield: 2800, armor: 2200, hull: 2400, cap: 2000, capRegen: 30,
    cargo: 500, slots: { high: 3, mid: 5, low: 3 }, maxLocks: 7, lockRange: 85000, lockTime: 2,
    bonus: { drones: 0.45, scan: 0.5 }, desc: 'Сенсорный носитель: отсек дронов 200 м³, +45% к дронам, +50% к сканеру, 7 целей на дальности 85 км.',
    lore: 'Три дуги вокруг ядра — антенны дальнего поиска. «Оракул» видит бой раньше всех и направляет туда рой, сам оставаясь за пределами досягаемости.',
    req: { drones: 2 }
  },
  relikvariy: {
    name: 'Реликварий', cls: 'Линкор Предтеч', price: 9000000, color: 0x332e46, fac: 'orden', rep: 40,
    maxSpeed: 115, align: 12, warpSpeed: 2.2, sig: 400, radius: 290,
    shield: 15000, armor: 11000, hull: 14000, cap: 7000, capRegen: 75,
    cargo: 1200, slots: { high: 7, mid: 6, low: 5 }, maxLocks: 7, lockRange: 90000, lockTime: 4,
    bonus: { missile: 0.4, missileSpeed: 0.3, damage: 0.15, pd: 0.5 }, desc: 'Линкор на технологиях Предтеч: ракеты +40% урона и +30% скорости, +15% урона орудий, ускоренная ПРО. Только для союзников Ордена.',
    lore: 'Корпус выращен вокруг найденного в Глубине реликтового ядра — кристаллический гребень на спине светится, даже когда реактор заглушен.',
    req: { gunnery: 4, shields: 3 }
  },
  // ===== Уникальный флагман: один на пилота =====
  serafim: {
    name: 'Серафим', cls: 'Флагман-носитель «Предвестник»', price: 25000000, color: 0xeef0f4, unique: true, code: 'ПР-01',
    maker: 'Небесная верфь Предела (последний заказ Предтеч)', length: 1650, crew: '900 + 120 операторов дронов',
    maxSpeed: 125, align: 13, warpSpeed: 2.5, sig: 520, radius: 600,
    shield: 28000, armor: 22000, hull: 24000, cap: 9000, capRegen: 95,
    cargo: 3000, slots: { high: 6, mid: 6, low: 5 }, maxLocks: 10, lockRange: 100000, lockTime: 3.5,
    bonus: { drones: 0.75, damage: 0.2, pd: 0.6, turrets: 1 },
    droneShield: 0.5, // «Покров»: урон по своим дронам в 40 км принимает щит флагмана, вполовину
    defaultFit: ['arc_lance', 'arc_lance', 'rail_l', 'rail_l', 'ml_heavy', null, 'shield_booster_l', 'shield_booster_l', 'pd_1', 'pd_1', 'afterburner', null, 'armor_rep', 'dmg_amp', 'dmg_amp', null, null],
    kit: { drones: { drone_heavy: 6, drone_goliath: 4 }, cargo: { msl_torp: 40 } },
    desc: 'Уникальный флагман-носитель — один на пилота. Два «Копья Зари» (цепная молния бьёт цель и перескакивает ещё на 4 врагов, не теряя урона по мелким целям), ангар дронов 1 200 м³ и до 12 дронов в бою с +75% к урону; «Покров»: урон по своим дронам рядом принимает щит флагмана (вполовину), поэтому рой не гибнет, пока жив «Серафим»; +20% урона орудий, ускоренная ПРО. Поставляется полностью оснащённым, с 10 дронами в ангаре.',
    lore: 'Чертежи нашли в ковчеге Предтеч: корабль должен был «вести рои меж звёзд». Фарфорово-белый корпус, открытое сердце-реактор — бело-голубое солнце в золотой клетке, крылья-листья с живой золотой филигранью и кормовая астролябия из вращающихся колец. В залпе по всему кораблю пляшут молнии. Небесная верфь собирает по одному «Серафиму» на пилота и никогда не повторяет серийный номер.',
    req: { drones: 4, gunnery: 4, shields: 3 }
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
  rel_ioncrystal: { name: 'Ионный кристалл', cat: 'Трофеи', vol: 0.5, base: 3500 },
  courier_pack:  { name: 'Опечатанный контейнер', cat: 'Миссия', vol: 5, base: 0, noSell: true },
  energy_cell:   { name: 'Энергоячейка', cat: 'Энергия', vol: 0.5, base: 250, consumable: true },
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
  speed_x:  { name: 'Варп-ускоритель «Призрак»', slot: 'low', kind: 'passive', price: 300000, passive: { speed: 0.3 }, vol: 5, elite: true },
  // уникальное оружие «Серафима»: цепная молния — бьёт цель и перескакивает на ближайших врагов, каждый прыжок слабее.
  // Не теряет урон по маленьким целям (дронам, перехватчикам) — создано против роёв
  arc_lance: { name: 'Копьё Зари', slot: 'high', kind: 'weapon', price: 1500000, dmg: 300, cycle: 4, cap: 16, optimal: 32000, falloff: 12000, color: 0xffe2a0, vol: 25, elite: true, only: 'serafim',
    arc: { jumps: 4, range: 14000, decay: 0.75 } }
});
// Артефакты Предтеч — уникальное оборудование из особых аномалий (хранилища, спящие стражи, ионные штормы,
// кладбища флота). Не продаются нигде, но улучшаются до 5 уровня. Новые эффекты: rof — скорострельность орудий,
// hp — щит, броня и корпус, capRegen — перезарядка накопителя, warp — скорость варпа, droneCount — дронов в бою
Object.assign(MODULES, {
  art_resonator: { name: 'Резонатор щита Предтеч', slot: 'mid', kind: 'shieldRep', price: 900000, amount: 620, cycle: 4, cap: 30, vol: 10, elite: true, artifact: true },
  art_chrono:    { name: 'Хроноускоритель «Миг»', slot: 'low', kind: 'passive', price: 950000, passive: { rof: 0.2 }, vol: 5, elite: true, artifact: true },
  art_compass:   { name: 'Компас Предтеч', slot: 'mid', kind: 'passive', price: 600000, passive: { scan: 1, warp: 0.35 }, vol: 5, elite: true, artifact: true },
  art_heart:     { name: 'Сердце Стража', slot: 'low', kind: 'passive', price: 1200000, passive: { hp: 0.18 }, vol: 5, elite: true, artifact: true },
  art_prism:     { name: 'Призматическая линза', slot: 'high', kind: 'weapon', price: 1100000, dmg: 150, cycle: 2.6, cap: 8, optimal: 26000, falloff: 9000, color: 0x80ffe0, vol: 10, elite: true, artifact: true },
  art_ioncap:    { name: 'Ионный конденсатор', slot: 'low', kind: 'passive', price: 700000, passive: { capRegen: 0.6 }, vol: 5, elite: true, artifact: true },
  art_anchor:    { name: 'Гравитационный якорь', slot: 'mid', kind: 'scram', price: 800000, range: 24000, cycle: 5, cap: 8, vol: 10, elite: true, artifact: true },
  art_swarm:     { name: 'Рой-матрица', slot: 'low', kind: 'passive', price: 1000000, passive: { drones: 0.35, droneCount: 2 }, vol: 5, elite: true, artifact: true }
});
// Трофеи мировых событий — только из тайников побеждённых боссов (вторжение Предтеч, пиратский дредноут).
// Не продаются и не производятся, но улучшаются до 5 уровня.
Object.assign(MODULES, {
  ev_core:   { name: 'Ядро Колосса', slot: 'low', kind: 'passive', price: 1600000, passive: { hp: 0.22, damage: 0.08 }, vol: 5, elite: true, trophy: true },
  ev_cannon: { name: 'Главный калибр «Левиафан»', slot: 'high', kind: 'weapon', price: 1800000, dmg: 330, cycle: 4.2, cap: 12, optimal: 60000, falloff: 20000, color: 0xff3060, vol: 25, elite: true, trophy: true },
  ev_aegis:  { name: 'Эгида Предтеч', slot: 'mid', kind: 'shieldRep', price: 1500000, amount: 900, cycle: 4, cap: 40, vol: 15, elite: true, trophy: true },
  ev_warden: { name: 'Командный модуль «Вожак»', slot: 'mid', kind: 'passive', price: 1200000, passive: { drones: 0.25, damage: 0.06, droneCount: 1 }, vol: 5, elite: true, trophy: true }
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
for (const [id, m] of Object.entries(MODULES)) if (m.kind === 'weapon') m.heatPerShot = Math.round(m.dmg * (m.base.startsWith('rail') ? 0.09 : m.arc ? 0.07 : 0.12) * 10) / 10;
for (const [id, m] of Object.entries(MODULES)) ITEMS[id] = { name: m.name, cat: m.artifact ? 'Артефакты Предтеч' : m.trophy ? 'Трофеи мировых событий' : m.elite ? 'Элитные модули' : 'Модули', vol: m.vol, base: m.price, module: true, elite: m.elite, lv: m.lv };

// ---------- Дроны ----------
// Классы: лёгкие перехватчики → средние → тяжёлые → стационарные «часовые» → огромные бастионы и штурмовики.
// sig — сигнатура (по маленьким дронам крупные орудия мажут), r — размер, resist — доля поглощаемого урона,
// regen — восстановление прочности в секунду, pd — шанс сбить ракету, taunt — пираты стреляют по нему в первую очередь
const DRONE_CLASSES = {
  light:   { name: 'Лёгкий', desc: 'очень быстрый, сбивает ракеты, по нему трудно попасть' },
  medium:  { name: 'Средний', desc: 'основа роя: урон и прочность в балансе' },
  heavy:   { name: 'Тяжёлый', desc: 'медленный, мощный и бронированный' },
  sentry:  { name: 'Стационарный', desc: 'стоит там, где выпущен, бьёт очень далеко' },
  bastion: { name: 'Огромный стационарный', desc: 'неподвижная крепость: поглощает урон, чинится и отвлекает пиратов на себя' },
  super:   { name: 'Огромный штурмовой', desc: 'медленный, почти непробиваемый, страшный урон' },
  support: { name: 'Ремонтный', desc: 'чинит щит и броню корабля и других ваших дронов' },
  mining:  { name: 'Шахтёрский', desc: 'добывает руду в трюм' }
};
const DRONES = {
  drone_scout:    { name: 'Лёгкий дрон «Комар»', kind: 'combat', cls: 'light', price: 4500, vol: 2.5, dmg: 7, cycle: 1.2, range: 2000, speed: 3600, hp: 140, sig: 10, r: 4, pd: 0.7, color: 0x60e0ff },
  drone_light:    { name: 'Лёгкий дрон «Оса»', kind: 'combat', cls: 'light', price: 8000, vol: 5, dmg: 14, cycle: 2, range: 2500, speed: 2200, hp: 260, sig: 18, r: 6, pd: 0.45, color: 0xffb040 },
  drone_heavy:    { name: 'Средний дрон «Шершень»', kind: 'combat', cls: 'medium', price: 32000, vol: 10, dmg: 40, cycle: 3, range: 3000, speed: 1400, hp: 750, sig: 30, r: 8, pd: 0.35, color: 0xff7040 },
  drone_medic:    { name: 'Ремонтный дрон «Медик»', kind: 'repair', cls: 'support', price: 28000, vol: 10, rep: 70, cycle: 4, range: 2500, speed: 1600, hp: 600, sig: 25, r: 7, color: 0x70ffc0 },
  drone_goliath:  { name: 'Тяжёлый дрон «Голиаф»', kind: 'combat', cls: 'heavy', price: 90000, vol: 25, dmg: 110, cycle: 4, range: 4000, speed: 700, hp: 2800, sig: 60, r: 13, resist: 0.2, pd: 0.2, color: 0xff5030 },
  drone_sentry:   { name: 'Стационарный дрон «Часовой»', kind: 'combat', cls: 'sentry', price: 75000, vol: 25, dmg: 85, cycle: 3.5, range: 14000, speed: 0, hp: 2200, sig: 50, r: 11, resist: 0.3, pd: 0.15, color: 0x80b0ff },
  drone_monolith: { name: 'Дрон-бастион «Монолит»', kind: 'combat', cls: 'bastion', price: 420000, vol: 50, dmg: 140, cycle: 4, range: 10000, speed: 0, hp: 12000, sig: 300, r: 26, resist: 0.55, regen: 40, taunt: true, pd: 0.35, color: 0xffe070 },
  drone_colossus: { name: 'Штурмовой дрон «Колосс»', kind: 'combat', cls: 'super', price: 650000, vol: 75, dmg: 190, cycle: 4, range: 5000, speed: 450, hp: 16000, sig: 380, r: 30, resist: 0.5, regen: 25, pd: 0.25, color: 0xff4060 },
  drone_mine:     { name: 'Шахтёрский дрон «Крот»', kind: 'mining', cls: 'mining', price: 9000, vol: 5, yield: 20, cycle: 6, range: 1500, speed: 1200, hp: 220, sig: 20, r: 6, color: 0x80ff90 },
  drone_mine2:    { name: 'Тяжёлый шахтёрский дрон «Бур»', kind: 'mining', cls: 'mining', price: 60000, vol: 25, yield: 85, cycle: 6, range: 1800, speed: 700, hp: 1200, sig: 50, r: 12, resist: 0.2, color: 0x60e070 },
  drone_x:        { name: 'Дрон-призрак «Мираж»', kind: 'combat', cls: 'medium', price: 260000, vol: 10, dmg: 75, cycle: 2.5, range: 3500, speed: 2600, hp: 1100, sig: 22, r: 8, pd: 0.5, color: 0xd060ff, elite: true }
};
for (const [id, d] of Object.entries(DRONES)) ITEMS[id] = { name: d.name, cat: d.elite ? 'Элитные дроны' : 'Дроны', vol: d.vol, base: d.price, drone: true, elite: d.elite };
// Планетарные ресурсы: добываются мультитулом на поверхности планет (см. server/surface.js, public/js/planetgen.js)
Object.assign(ITEMS, {
  res_carbon:     { name: 'Углерод', cat: 'Планетарные ресурсы', vol: 0.02, base: 14, desc: 'из растений и деревьев' },
  res_ferrite:    { name: 'Ферритовая пыль', cat: 'Планетарные ресурсы', vol: 0.02, base: 16, desc: 'из камней и валунов' },
  res_oxygen:     { name: 'Кислород', cat: 'Планетарные ресурсы', vol: 0.02, base: 34, desc: 'пополняет жизнеобеспечение костюма' },
  res_sodium:     { name: 'Натрий', cat: 'Планетарные ресурсы', vol: 0.02, base: 40, desc: 'пополняет защиту от опасной среды' },
  res_dihydro:    { name: 'Ди-водород', cat: 'Планетарные ресурсы', vol: 0.02, base: 34, desc: 'топливо взлёта и ранца' },
  res_bulb:       { name: 'Звёздная луковица', cat: 'Планетарные ресурсы', vol: 0.02, base: 64, desc: 'цветущие миры' },
  res_coral:      { name: 'Кораллит', cat: 'Планетарные ресурсы', vol: 0.02, base: 64, desc: 'океанические миры' },
  res_pyrite:     { name: 'Пирит', cat: 'Планетарные ресурсы', vol: 0.02, base: 62, desc: 'пустыни' },
  res_cryo:       { name: 'Криотий', cat: 'Планетарные ресурсы', vol: 0.02, base: 62, desc: 'ледяные миры' },
  res_phosphor:   { name: 'Фосфор', cat: 'Планетарные ресурсы', vol: 0.02, base: 62, desc: 'вулканические миры' },
  res_quartzite:  { name: 'Кварцит', cat: 'Планетарные ресурсы', vol: 0.02, base: 58, desc: 'бесплодные миры' },
  res_ammonia:    { name: 'Аммиак', cat: 'Планетарные ресурсы', vol: 0.02, base: 62, desc: 'токсичные миры' },
  res_uranium:    { name: 'Уран', cat: 'Планетарные ресурсы', vol: 0.02, base: 66, desc: 'радиоактивные миры' },
  res_paraquartz: { name: 'Паракварц', cat: 'Планетарные ресурсы', vol: 0.02, base: 85, desc: 'аномальные миры' },
  res_copper:     { name: 'Медь', cat: 'Планетарные ресурсы', vol: 0.02, base: 110, desc: 'рудные жилы, безопасные системы' },
  res_cadmium:    { name: 'Кадмий', cat: 'Планетарные ресурсы', vol: 0.02, base: 230, desc: 'рудные жилы, низкая безопасность' },
  res_emeril:     { name: 'Эмерил', cat: 'Планетарные ресурсы', vol: 0.02, base: 350, desc: 'рудные жилы, нулевая безопасность' },
  res_indium:     { name: 'Индий', cat: 'Планетарные ресурсы', vol: 0.02, base: 470, desc: 'рудные жилы, Бездна' },
  bio_meat:       { name: 'Сырое мясо', cat: 'Фауна', vol: 0.05, base: 90, desc: 'добыча охоты' },
  bio_hide:       { name: 'Шкура', cat: 'Фауна', vol: 0.1, base: 160, desc: 'добыча охоты' },
  bio_gel:        { name: 'Биоматериал', cat: 'Фауна', vol: 0.05, base: 210, desc: 'дают прирученные животные' },
  sentinel_core:  { name: 'Ядро смотрителя', cat: 'Фауна', vol: 0.5, base: 650, desc: 'из сбитых дронов-смотрителей' },
  surf_kit:       { name: 'Ремкомплект костюма', cat: 'Снаряжение', vol: 0.5, base: 900, desc: 'восстанавливает здоровье на поверхности' },
  launch_fuel:    { name: 'Топливо взлёта', cat: 'Снаряжение', vol: 1, base: 1500, desc: 'один взлёт с планеты без аварийного режима' }
});
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
  gadyuka: [10, 2], burya: [50, 4], bastion: [150, 5], matka: [800, 10], fortress: [0, 0],
  merkuriy: [0, 0], prorab: [40, 4], argus: [60, 5], senator: [150, 5], brodyaga: [15, 2], pastuh: [100, 5], kovcheg: [25, 3], taran: [50, 4],
  iskatel: [10, 2], prizma: [15, 2], orakul: [200, 5], relikvariy: [150, 5], serafim: [1200, 12] };
for (const [id, [bay, max]] of Object.entries(DRONE_CAPS)) { SHIPS[id].droneBay = bay; SHIPS[id].maxDrones = max; }
// Назначение и класс мощи (I–V) — для каталога флота и единой серии фото
const SHIP_ROLES = {
  combat:    { name: 'Боевые', desc: 'истребляют пиратов и держат оборону', color: '#ff6a50' },
  carrier:   { name: 'Носители дронов', desc: 'воюют роями дронов', color: '#c080ff' },
  mining:    { name: 'Добыча и промышленность', desc: 'копают руду и плавят металл', color: '#ffb040' },
  transport: { name: 'Перевозка', desc: 'возят грузы между станциями', color: '#60d890' },
  explore:   { name: 'Разведка и старт', desc: 'ищут аномалии, первые шаги пилота', color: '#60c8ff' }
};
const SHIP_ROLE = { iskra: ['explore', 1], sokol: ['explore', 1], staratel: ['mining', 1], klinok: ['combat', 1], strizh: ['combat', 1], gadyuka: ['combat', 1],
  vihr: ['combat', 2], tyagach: ['transport', 2], burlak: ['mining', 2],
  strazh: ['combat', 3], burya: ['combat', 3], piligrim: ['carrier', 3],
  molot: ['combat', 4], citadel: ['combat', 4], leviafan: ['mining', 4], kit: ['transport', 4],
  bastion: ['combat', 5], matka: ['carrier', 5], begemot: ['mining', 5],
  merkuriy: ['transport', 1], prorab: ['mining', 2], argus: ['combat', 3], senator: ['combat', 5],
  brodyaga: ['explore', 1], pastuh: ['carrier', 2], kovcheg: ['transport', 3], taran: ['combat', 4],
  iskatel: ['explore', 2], prizma: ['combat', 2], orakul: ['carrier', 3], relikvariy: ['combat', 5],
  serafim: ['carrier', 5] };
// Фракции и их стиль кораблей (общие для сервера и клиента). Репутация: 0 — нейтралитет, 15 — уважение, 40 — союзник
const FACTION_INFO = {
  cons:  { name: 'Консорциум Арктура', short: 'Консорциум', color: '#e0a64a', regions: ['core'], shipyard: 'Верфи «Арктур-Индастриз»',
           style: 'обтекаемые корпуса цвета слоновой кости с золотой отделкой' },
  liga:  { name: 'Пограничная Лига', short: 'Лига', color: '#6fd88a', regions: ['border', 'low'], shipyard: 'Мастерские Пограничья',
           style: 'грубые модульные корпуса из ферм и контейнеров, оранжевые дюзы' },
  orden: { name: 'Орден Предела', short: 'Орден', color: '#a07cff', regions: ['null', 'deep'], shipyard: 'Лаборатории Предела',
           style: 'плавные «живые» корпуса с кристаллами и кольцами фиолетового света' }
};
const REP_NEED = (v) => v >= 40 ? 'Союзник' : v >= 15 ? 'Уважение' : 'Нейтралитет';
for (const [id, [role, tier]] of Object.entries(SHIP_ROLE)) { SHIPS[id].role = role; SHIPS[id].tier = tier; }

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
  pdrone: { name: 'Дрон Скверны', ship: 'pdrone', bounty: 2500, dmgMul: 0.5, hpMul: 1, weapon: 'laser_s', guns: 1, speedMul: 1.2, loot: [['salv_scrap', 0.2, 1, 1]] },
  // хранитель аномалии «Спящий страж» — корабль Предтеч, пробуждённый пилотом
  sentinel: { name: 'Страж Предтеч', ship: 'relikvariy', bounty: 350000, dmgMul: 0.85, hpMul: 1.6, weapon: 'laser_x', guns: 4, speedMul: 0.5, loot: [['salv_relic', 1, 2, 4], ['salv_core', 1, 3, 6]] },
  shard: { name: 'Осколок Стража', ship: 'pdrone_h', bounty: 15000, dmgMul: 0.8, hpMul: 1.6, weapon: 'laser_m', guns: 1, speedMul: 1.1, loot: [['salv_core', 0.4, 1, 2]] },
  vaultguard: { name: 'Страж хранилища', ship: 'pdrone', bounty: 4000, dmgMul: 0.6, hpMul: 1.2, weapon: 'laser_s', guns: 1, speedMul: 1.2, loot: [] },
  wb_gen: { name: 'Генератор щита Колосса', ship: 'wb_gen', bounty: 25000, dmgMul: 0.6, hpMul: 1, weapon: 'laser_m', guns: 1, speedMul: 0, loot: [['salv_core', 0.6, 1, 2]] },
  wb_colossus: { name: 'Колосс Предтеч', ship: 'colossus', bounty: 0, dmgMul: 1.1, hpMul: 1, weapon: 'laser_x', guns: 6, speedMul: 0.35, loot: [] },
  wb_dread: { name: 'Дредноут «Левиафан Скверны»', ship: 'citadel', bounty: 0, dmgMul: 1.1, hpMul: 1, weapon: 'rail_x', guns: 6, speedMul: 0.4, loot: [] },
  pdrone_h: { name: 'Тяжёлый дрон Скверны', ship: 'pdrone_h', bounty: 9000, dmgMul: 0.7, hpMul: 1, weapon: 'laser_m', guns: 1, speedMul: 1, loot: [['salv_scrap', 0.5, 1, 2], ['salv_core', 0.15, 1, 1]] },
  pbase:  { name: 'Пиратская база', ship: 'pbase', bounty: 0, dmgMul: 0.9, hpMul: 1, weapon: 'laser_m', guns: 4, speedMul: 0, pd: 'pd_1', loot: [] },
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
  trade:      { name: 'Торговля', group: 'Промысел', desc: 'Меньше налог с продаж (базовый 6%).', step: 1, unit: '%', what: 'налога', sign: '−' },
  industry:   { name: 'Производство', group: 'Промысел', desc: 'Экономнее расход материалов, быстрее и больше заказов на заводах станций.',
                levels: ['−4% материалов и времени, 3 заказа', '−8%, 4 заказа', '−12%, 5 заказов', '−16%, 6 заказов', '−20%, 7 заказов'] }
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
// ---------- Производство: чертежи ----------
// Чертёж — вечный оригинал: не расходуется, каждый запуск тратит материалы, немного CR и время.
// Состав материалов считается из цены изделия: дешёвое — сталь и керамит, дорогое — кристаллит, нуль-сплав
// и ксенон-ядра; элитное требует пиратских ядер и реликвий. Материалы по базовой цене стоят ~половину изделия.
// Обычные чертежи продаются на любой станции; редкие (элитные модули и дроны, фракционные корабли)
// добываются в аномалиях Предтеч, на пиратских базах, в мировых событиях и за войну фракций.
const BP_TIERS = [
  [10000, { mat_steel: 0.7, mat_ceramite: 0.3 }],
  [60000, { mat_steel: 0.4, mat_ceramite: 0.4, mat_crystal: 0.2 }],
  [250000, { mat_ceramite: 0.3, mat_crystal: 0.45, mat_nullalloy: 0.25 }],
  [Infinity, { mat_crystal: 0.3, mat_nullalloy: 0.45, mat_xcore: 0.25 }]
];
// энергоячеек в производстве нет: это товар для торговли между регионами, его цена зависит от спроса
const BP_BATCH = { msl_std: 20, msl_torp: 10, turret_kit: 1 };
const BLUEPRINTS = {};
function addBlueprint(out, kind, price, rare) {
  const qty = BP_BATCH[out] || 1, value = price * qty;
  const share = BP_TIERS.find(([lim]) => value < lim)[1], mats = {};
  const matValue = value * (rare ? 0.35 : 0.5);
  for (const [it, f] of Object.entries(share)) mats[it] = Math.max(1, Math.ceil(matValue * f / ITEMS[it].base));
  if (rare) { mats.salv_core = Math.max(1, Math.ceil(value / 150000)); if (value >= 400000) mats.salv_relic = Math.ceil(value / 600000); }
  const id = 'bp_' + out;
  BLUEPRINTS[id] = { out, kind, qty, mats, fee: Math.round(value * 0.05), time: Math.round(Math.min(900, Math.max(20, 15 + Math.sqrt(value) * 0.6))),
    price: rare ? 0 : Math.round(Math.max(15000, kind === 'ship' ? price * 1.2 : value * 3)), rare: !!rare };
  const name = (kind === 'ship' ? SHIPS[out].name : ITEMS[out].name);
  ITEMS[id] = { name: 'Чертёж: ' + name, cat: rare ? 'Редкие чертежи' : 'Чертежи', vol: 0.1, base: Math.round(rare ? value * 0.6 : BLUEPRINTS[id].price * 0.3), blueprint: true, rare: !!rare };
}
for (const [id, m] of Object.entries(MODULES)) if (m.lv === 1 && !m.artifact && !m.trophy && !m.only) addBlueprint(id, 'module', m.price, m.elite);
for (const [id, d] of Object.entries(DRONES)) addBlueprint(id, 'drone', d.price, d.elite);
for (const id of Object.keys(BP_BATCH)) addBlueprint(id, 'item', ITEMS[id].base, false);
for (const [id, t] of Object.entries(SHIPS)) if (t.price > 0 && !t.unique) addBlueprint(id, 'ship', t.price, !!t.fac);
// перепродажа станции: модули, дроны и боеприпасы — за полцены (иначе «докупил материалы → сделал → продал» печатало бы деньги)
for (const it of Object.values(ITEMS)) it.resale = it.module || it.drone || (it.consumable && it !== ITEMS.energy_cell) ? 0.5 : 1;
const RARE_BLUEPRINTS = Object.keys(BLUEPRINTS).filter(id => BLUEPRINTS[id].rare);
const INDUSTRY = { baseJobs: 2, maxRuns: 50, buyMarkup: 1.5, skillCut: 0.04 };

const incomeOf = (sysId) => { const s = SYSTEMS.find(x => x.id === sysId); return s ? REGIONS[s.region].income : 1; };

const STATION_NAMES = ['Торговый узел', 'Шахтёрская платформа', 'Верфь', 'Аванпост', 'Научная станция', 'Перевалочная база'];

module.exports = { AU, SHIPS, SHIP_ROLES, FACTION_INFO, REP_NEED, MODULES, DRONES, DRONE_CLASSES, ITEMS, NPCS, SKILLS, SKILL_TIME, SYSTEMS, GATES, STATION_NAMES, oresForSec, REGIONS, STAR_TYPES, incomeOf, RECIPES, REFINERY , MOD_UPGRADE, upgradeCost, modBase, modLevel, BLUEPRINTS, RARE_BLUEPRINTS, INDUSTRY };
