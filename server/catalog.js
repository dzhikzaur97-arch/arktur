// Каталог серийных товаров: оружие, ракетные установки, буры, щиты, ремонтники, двигатели, глушители, ПРО,
// усилители корабля и дроны — по семействам, классам (I–V) и производителям. Около 300 позиций на рынке.
// Производители (вымышленные) отличаются характером: «Арктур» — сбалансированно, «Векс» — сильнее и прожорливее,
// «Корвин» — экономно и дешевле, «Орион» — дальнобойно, «Предел» — экзотика Ордена (дороже, мощнее, только классы III–V).
// Каждая серийная позиция получает чертёж — её можно сделать из материалов (см. data.js, addBlueprint).
'use strict';
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
const BRANDS = {
  ar: { name: 'Арктур', dmg: 1, range: 1, cap: 1, cycle: 1, price: 1, eff: 1 },
  vx: { name: 'Векс', dmg: 1.15, range: 0.9, cap: 1.3, cycle: 1, price: 1.2, eff: 1.15 },
  kv: { name: 'Корвин', dmg: 0.95, range: 1, cap: 0.7, cycle: 1, price: 0.85, eff: 0.92 },
  or: { name: 'Орион', dmg: 1, range: 1.25, cap: 1.05, cycle: 1.1, price: 1.15, eff: 1 },
  pr: { name: 'Предел', dmg: 1.25, range: 1.1, cap: 1.2, cycle: 1, price: 1.8, eff: 1.25, minTier: 3 }
};
const r10 = (x) => Math.round(x * 10) / 10, rnd = (x, k = 1) => Math.round(x / k) * k;

// оружие: базовые параметры класса I; рост по классам
const WEAPONS = {
  pl: { name: 'Импульсный лазер', dmg: 26, cycle: 2.0, cap: 4, opt: 8000, fall: 4000, color: 0xff5040, brands: ['ar', 'vx', 'kv', 'pr'] },
  bl: { name: 'Лучевой лазер', dmg: 34, cycle: 2.6, cap: 6, opt: 12000, fall: 5000, color: 0xff8030, brands: ['ar', 'vx', 'or'] },
  rg: { name: 'Рельсотрон', dmg: 40, cycle: 3.4, cap: 2, opt: 20000, fall: 8000, color: 0x60c0ff, brands: ['ar', 'kv', 'or'] },
  ac: { name: 'Автопушка', dmg: 12, cycle: 1.0, cap: 1, opt: 5000, fall: 6000, color: 0xffd060, brands: ['ar', 'vx', 'kv'] },
  pt: { name: 'Плазмомёт', dmg: 44, cycle: 3.0, cap: 8, opt: 3500, fall: 2500, color: 0x60ffd0, brands: ['ar', 'vx', 'pr'] },
  ion: { name: 'Ионный разрядник', dmg: 30, cycle: 2.4, cap: 5, opt: 15000, fall: 10000, color: 0xa080ff, brands: ['ar', 'or', 'pr'] }
};
const WT = { dmg: [0, 1, 1.8, 2.8, 4, 5.5], cap: [0, 1, 2, 3.5, 5.5, 8], range: [0, 1, 1.25, 1.55, 1.9, 2.3], vol: [0, 5, 10, 15, 20, 25] };
const LAUNCHERS = {
  ml: { name: 'Ракетная установка', dmg: 60, cycle: 5, cap: 3, range: 30000, speed: 3200, explR: 60, ammo: 'msl_std', color: 0xffa040, tiers: [1, 2, 3, 4], brands: ['ar', 'vx', 'or'] },
  tl: { name: 'Торпедный аппарат', dmg: 260, cycle: 12, cap: 8, range: 42000, speed: 1700, explR: 300, ammo: 'msl_torp', color: 0xff5020, tiers: [2, 3, 4, 5], brands: ['ar', 'vx'] }
};
const LT = [0, 1, 1.4, 1.9, 2.5, 3.2];

module.exports = function addCatalog(MODULES, DRONES) {
  const put = (id, m) => { if (!MODULES[id]) MODULES[id] = Object.assign(m, { series: true }); };
  const label = (fam, t, b) => `${fam} ${ROMAN[t]} «${BRANDS[b].name}»`;
  // ---------- оружие ----------
  for (const [fid, F] of Object.entries(WEAPONS)) for (let t = 1; t <= 5; t++) for (const b of F.brands) {
    const B = BRANDS[b]; if (B.minTier && t < B.minTier) continue;
    const dmg = Math.round(F.dmg * WT.dmg[t] * B.dmg), price = rnd(3000 * Math.pow(WT.dmg[t], 2.6) * (F.dmg / 28) * B.price, 100);
    put(`c_${fid}${t}_${b}`, { name: label(F.name, t, b), slot: 'high', kind: 'weapon', price, dmg, cycle: r10(F.cycle * B.cycle), cap: r10(F.cap * WT.cap[t] * B.cap),
      optimal: rnd(F.opt * WT.range[t] * B.range, 100), falloff: rnd(F.fall * WT.range[t] * B.range, 100), color: F.color, vol: WT.vol[t], tier: t, fam: fid, brand: b });
  }
  for (const [fid, F] of Object.entries(LAUNCHERS)) for (const t of F.tiers) for (const b of F.brands) {
    const B = BRANDS[b];
    put(`c_${fid}${t}_${b}`, { name: label(F.name, t, b), slot: 'high', kind: 'launcher', price: rnd((fid === 'tl' ? 60000 : 9000) * Math.pow(LT[t], 1.9) * B.price, 100),
      dmg: Math.round(F.dmg * LT[t] * B.dmg), cycle: F.cycle, cap: r10(F.cap * (1 + 0.5 * (t - 1)) * B.cap), range: rnd(F.range * (1 + 0.1 * (t - 1)) * B.range, 500),
      speed: F.speed, explR: Math.round(F.explR * (1 + 0.25 * (t - 1))), ammo: F.ammo, color: F.color, vol: WT.vol[t], tier: t, fam: fid, brand: b });
  }
  // ---------- добыча ----------
  const DRILL = [0, 40, 70, 120, 180, 260], GAS = [0, 50, 90, 150, 230];
  for (let t = 1; t <= 5; t++) for (const b of ['ar', 'kv', 'or']) {
    const B = BRANDS[b];
    put(`c_dr${t}_${b}`, { name: label('Буровой лазер', t, b), slot: 'high', kind: 'miner', price: rnd(2000 * Math.pow(t, 2.4) * B.price, 100), yield: Math.round(DRILL[t] * B.eff),
      cycle: 6 + t * 0.5, cap: r10((4 + t * 3) * B.cap), range: rnd((9000 + t * 2000) * B.range, 500), color: [0, 0x80ff90, 0x60ffb0, 0x40ffd0, 0x40e0ff, 0x80c0ff][t], vol: WT.vol[t], tier: t, fam: 'dr', brand: b });
  }
  for (let t = 1; t <= 4; t++) for (const b of ['ar', 'kv']) {
    const B = BRANDS[b];
    put(`c_gh${t}_${b}`, { name: label('Газовый сборщик', t, b), slot: 'high', kind: 'miner', gas: true, price: rnd(20000 * Math.pow(t, 2) * B.price, 100), yield: Math.round(GAS[t] * B.eff),
      cycle: 8, cap: r10((5 + t * 3) * B.cap), range: 12000 + t * 1500, color: 0x9fe8ff, vol: WT.vol[t], tier: t, fam: 'gh', brand: b });
  }
  // ---------- защита и ремонт ----------
  const SHR = [0, 70, 140, 240, 380, 560], ARR = [0, 90, 170, 300, 480, 700];
  for (let t = 1; t <= 5; t++) for (const b of ['ar', 'vx', 'kv']) {
    const B = BRANDS[b];
    put(`c_sb${t}_${b}`, { name: label('Усилитель щита', t, b), slot: 'mid', kind: 'shieldRep', price: rnd(4000 * Math.pow(t, 2.3) * B.price, 100), amount: Math.round(SHR[t] * B.eff), cycle: 3 + t * 0.25, cap: r10((15 + t * 12) * B.cap), vol: WT.vol[t], tier: t, fam: 'sb', brand: b });
    put(`c_ar${t}_${b}`, { name: label('Ремонтник брони', t, b), slot: 'low', kind: 'armorRep', price: rnd(5000 * Math.pow(t, 2.3) * B.price, 100), amount: Math.round(ARR[t] * B.eff), cycle: 5 + t * 0.2, cap: r10((20 + t * 12) * B.cap), vol: WT.vol[t], tier: t, fam: 'ar', brand: b });
  }
  // ---------- двигатели, глушители, ПРО ----------
  for (let t = 1; t <= 4; t++) for (const b of ['ar', 'vx']) {
    const B = BRANDS[b];
    put(`c_ab${t}_${b}`, { name: label('Форсаж', t, b), slot: 'mid', kind: 'prop', price: rnd(6000 * Math.pow(t, 2.2) * B.price, 100), speedBonus: Math.round((0.9 + t * 0.2) * B.eff * 100) / 100, cycle: 5, cap: r10((8 + t * 5) * B.cap), vol: WT.vol[t], tier: t, fam: 'ab', brand: b });
  }
  for (let t = 1; t <= 3; t++) for (const b of ['ar', 'or']) {
    const B = BRANDS[b];
    put(`c_sc${t}_${b}`, { name: label('Варп-глушитель', t, b), slot: 'mid', kind: 'scram', price: rnd(15000 * Math.pow(t, 2) * B.price, 100), range: rnd([0, 9000, 14000, 20000][t] * B.range, 500), cycle: 5, cap: r10((6 + t * 3) * B.cap), vol: 5 * t, tier: t, fam: 'sc', brand: b });
    put(`c_pd${t}_${b}`, { name: label('Система ПРО', t, b), slot: 'mid', kind: 'pd', price: rnd(18000 * Math.pow(t, 2) * B.price, 100), cycle: r10(1.6 - t * 0.15), cap: r10((4 + t * 3) * B.cap), range: rnd([0, 7000, 10000, 13000][t] * B.range, 500), shots: t, vol: 5 * t, tier: t, fam: 'pd', brand: b });
  }
  // ---------- усилители корабля ----------
  const PASS = [
    ['da', 'Усилитель урона', 'low', 'damage', [0.08, 0.12, 0.16, 0.22], 9000],
    ['hs', 'Теплоотвод', 'low', 'cool', [0.15, 0.22, 0.3, 0.4], 8000],
    ['rf', 'Стабилизатор скорострельности', 'low', 'rof', [0.06, 0.1, 0.14, 0.18], 12000],
    ['cx', 'Расширитель трюма', 'low', 'cargo', [0.2, 0.3, 0.45, 0.6], 4000],
    ['od', 'Нагнетатель двигателя', 'low', 'speed', [0.08, 0.12, 0.16, 0.2], 6000],
    ['mu', 'Модуль добычи', 'low', 'mining', [0.1, 0.15, 0.22, 0.3], 10000],
    ['hp', 'Усиленная переборка', 'low', 'hp', [0.06, 0.1, 0.14, 0.18], 11000],
    ['cr', 'Регенератор накопителя', 'low', 'capRegen', [0.15, 0.25, 0.35, 0.5], 7000],
    ['wa', 'Варп-ускоритель', 'low', 'warp', [0.15, 0.25, 0.4, 0.6], 6000],
    ['dl', 'Узел управления дронами', 'low', 'drones', [0.1, 0.15, 0.22, 0.3], 12000],
    ['ss', 'Сенсорный усилитель', 'mid', 'scan', [0.2, 0.35, 0.5, 0.7], 8000]
  ];
  for (const [fid, name, slot, key, vals, p0] of PASS) for (let t = 1; t <= 4; t++) for (const b of ['ar', 'vx']) {
    const B = BRANDS[b], passive = { [key]: Math.round(vals[t - 1] * B.eff * 1000) / 1000 };
    if (fid === 'dl' && t === 4) passive.droneCount = 1;
    put(`c_${fid}${t}_${b}`, { name: label(name, t, b), slot, kind: 'passive', price: rnd(p0 * Math.pow(t, 2.3) * B.price, 100), passive, vol: 5, tier: t, fam: fid, brand: b });
  }
  // ---------- дроны ----------
  const DR = [
    ['dl', 'Лёгкий дрон', 'combat', 'light', { dmg: 12, cycle: 1.8, range: 2400, speed: 2600, hp: 220, sig: 14, r: 5, pd: 0.5 }, 6000, 4, 0xffc060],
    ['dm', 'Средний дрон', 'combat', 'medium', { dmg: 36, cycle: 2.8, range: 3000, speed: 1500, hp: 700, sig: 28, r: 8, pd: 0.3 }, 28000, 4, 0xff8050],
    ['dh', 'Тяжёлый дрон', 'combat', 'heavy', { dmg: 95, cycle: 3.8, range: 4000, speed: 750, hp: 2500, sig: 55, r: 12, resist: 0.2, pd: 0.15 }, 80000, 4, 0xff5040],
    ['ds', 'Дрон-часовой', 'combat', 'sentry', { dmg: 80, cycle: 3.4, range: 13000, speed: 0, hp: 2000, sig: 48, r: 11, resist: 0.3, pd: 0.1 }, 70000, 3, 0x80b0ff],
    ['dr', 'Ремонтный дрон', 'repair', 'support', { rep: 60, cycle: 4, range: 2500, speed: 1600, hp: 550, sig: 24, r: 7 }, 24000, 3, 0x70ffc0],
    ['dmn', 'Шахтёрский дрон', 'mining', 'mining', { yield: 18, cycle: 6, range: 1500, speed: 1200, hp: 220, sig: 20, r: 6 }, 8000, 3, 0x80ff90]
  ];
  const DVOL = { light: 5, medium: 10, heavy: 25, sentry: 25, support: 10, mining: 5 };
  for (const [fid, name, kind, cls, st, p0, tiers, color] of DR) for (let t = 1; t <= tiers; t++) for (const b of ['ar', 'vx']) {
    const B = BRANDS[b], k = 1 + 0.35 * (t - 1), id = `cd_${fid}${t}_${b}`;
    if (DRONES[id]) continue;
    const d = { name: `${name} Mk${ROMAN[t]} «${B.name}»`, kind, cls, price: rnd(p0 * Math.pow(k, 2.2) * B.price, 100), vol: DVOL[cls] * (t >= 3 && cls === 'mining' ? 2 : 1),
      cycle: st.cycle, range: Math.round(st.range * (1 + 0.08 * (t - 1)) * (b === 'vx' ? 0.95 : 1)), speed: Math.round(st.speed * (b === 'vx' ? 1.1 : 1)),
      hp: Math.round(st.hp * k), sig: st.sig, r: st.r, color, tier: t, series: true };
    if (st.dmg) d.dmg = Math.round(st.dmg * k * B.dmg);
    if (st.rep) d.rep = Math.round(st.rep * k * B.eff);
    if (st.yield) d.yield = Math.round(st.yield * k * B.eff);
    if (st.resist) d.resist = st.resist; if (st.pd) d.pd = st.pd;
    DRONES[id] = d;
  }
};
module.exports.BRANDS = BRANDS;
