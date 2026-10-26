// Процедурная генерация поверхностей планет — общий код сервера и клиента (детерминированный по id планеты).
// Профиль планеты: биом, климат, погода, гравитация, смотрители, палитра, рельеф, флора, виды животных.
// По чанкам 80×80 м: высоты, узлы ресурсов (для добычи мультитулом), декор (трава, кусты, камни), стада животных.
// Сервер по тем же формулам проверяет добычу и охоту — клиент не может «придумать» ресурс.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.PlanetGen = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CHUNK = 80;

  // ---------- случайность и шум ----------
  function rng(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = h >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function pickW(r, list) { let s = 0; for (const [, w] of list) s += w; let x = r() * s; for (const [v, w] of list) if ((x -= w) <= 0) return v; return list[list.length - 1][0]; }

  // градиентный шум 2D на целочисленном хэше (одинаков в любом движке JS)
  function makeNoise(seed) {
    const perm = new Uint8Array(512), r = rng('perm:' + seed);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    return (x, y) => {
      const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y, xi = X & 255, yi = Y & 255;
      const g = (i, j, dx, dy) => { const v = G[perm[perm[xi + i] + yi + j] & 7]; return v[0] * dx + v[1] * dy; };
      const u = fade(xf), v = fade(yf);
      return lerp(lerp(g(0, 0, xf, yf), g(1, 0, xf - 1, yf), u), lerp(g(0, 1, xf, yf - 1), g(1, 1, xf - 1, yf - 1), u), v) * 1.4;
    };
  }
  function fbm(n, x, y, oct) { let s = 0, a = 1, f = 1, t = 0; for (let i = 0; i < oct; i++) { s += n(x * f, y * f) * a; t += a; a *= 0.5; f *= 2.03; } return s / t; }

  function hsl(h, s, l) {
    h = ((h % 1) + 1) % 1;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  }

  // ---------- биомы ----------
  // hz — тип опасности среды; storm — вероятность бури; special — особый ресурс биома
  const BIOMES = {
    lush:       { name: 'Цветущая', temp: [12, 28], hz: null, flora: 0.95, fauna: 0.95, storm: 0.15, stormName: 'Ливень', special: 'res_bulb', trees: ['broad', 'conifer', 'palm', 'mushroom'], liquid: 'water' },
    ocean:      { name: 'Океаническая', temp: [8, 26], hz: null, flora: 0.75, fauna: 0.8, storm: 0.3, stormName: 'Шторм', special: 'res_coral', trees: ['palm', 'broad', 'coral'], liquid: 'water' },
    desert:     { name: 'Пустынная', temp: [38, 72], hz: 'heat', flora: 0.3, fauna: 0.45, storm: 0.35, stormName: 'Песчаная буря', special: 'res_pyrite', trees: ['cactus', 'dead'], liquid: null },
    frozen:     { name: 'Ледяная', temp: [-85, -20], hz: 'cold', flora: 0.35, fauna: 0.45, storm: 0.4, stormName: 'Метель', special: 'res_cryo', trees: ['conifer', 'spire', 'dead'], liquid: 'ice' },
    volcanic:   { name: 'Вулканическая', temp: [65, 140], hz: 'heat', flora: 0.15, fauna: 0.2, storm: 0.4, stormName: 'Огненный шторм', special: 'res_phosphor', trees: ['dead', 'spire'], liquid: 'lava' },
    barren:     { name: 'Бесплодная', temp: [-15, 30], hz: null, flora: 0.2, fauna: 0.25, storm: 0.2, stormName: 'Пыльная буря', special: 'res_quartzite', trees: ['dead', 'cactus', 'spire'], liquid: null },
    toxic:      { name: 'Токсичная', temp: [12, 42], hz: 'toxic', flora: 0.7, fauna: 0.5, storm: 0.35, stormName: 'Кислотный дождь', special: 'res_ammonia', trees: ['mushroom', 'bulb'], liquid: 'acid' },
    irradiated: { name: 'Радиоактивная', temp: [0, 45], hz: 'rad', flora: 0.4, fauna: 0.35, storm: 0.35, stormName: 'Радиационная буря', special: 'res_uranium', trees: ['bulb', 'spire', 'dead'], liquid: null },
    exotic:     { name: 'Аномальная', temp: [-5, 25], hz: null, flora: 0.6, fauna: 0.3, storm: 0.12, stormName: 'Аномальный шторм', special: 'res_paraquartz', trees: ['spire', 'mushroom', 'coral'], liquid: null }
  };
  const HAZARD_NAME = { heat: 'Жара', cold: 'Холод', toxic: 'Токсины', rad: 'Радиация' };
  const SENTINEL_NAME = { none: 'Нет', low: 'Низкая', normal: 'Обычная', high: 'Агрессивная' };

  // ---------- узлы ресурсов ----------
  // t — время добычи (с) мультитулом 1-го уровня; y — выход [от, до]
  const NODES = {
    plant:   { name: 'Растение', item: 'res_carbon', y: [12, 26], t: 1.1 },
    tree:    { name: 'Дерево', item: 'res_carbon', y: [35, 60], t: 2.6 },
    oxygen:  { name: 'Кислородный цветок', item: 'res_oxygen', y: [18, 34], t: 1.2 },
    sodium:  { name: 'Натриевый куст', item: 'res_sodium', y: [18, 34], t: 1.2 },
    dihydro: { name: 'Кристалл ди-водорода', item: 'res_dihydro', y: [20, 40], t: 1.5 },
    rock:    { name: 'Камень', item: 'res_ferrite', y: [15, 30], t: 1.5 },
    boulder: { name: 'Валун', item: 'res_ferrite', y: [50, 90], t: 3.8 },
    special: { name: 'Особый ресурс', item: null, y: [22, 42], t: 2.0 },
    metal:   { name: 'Рудная жила', item: null, y: [60, 120], t: 6.0 },
    capsule: { name: 'Аварийная капсула', item: null, y: [0, 0], t: 0, use: true },
    crate:   { name: 'Грузовой контейнер', item: null, y: [0, 0], t: 0, use: true }
  };
  const SPECIAL_NAME = { res_bulb: 'Звёздная луковица', res_coral: 'Кораллит', res_pyrite: 'Пирит', res_cryo: 'Криотий', res_phosphor: 'Фосфор', res_quartzite: 'Кварцит', res_ammonia: 'Аммиак', res_uranium: 'Уран', res_paraquartz: 'Паракварц' };
  // металл жил зависит от опасности системы
  const metalFor = (sec) => sec >= 0.5 ? 'res_copper' : sec > 0 ? 'res_cadmium' : sec > -0.5 ? 'res_emeril' : 'res_indium';
  const METAL_NAME = { res_copper: 'Медь', res_cadmium: 'Кадмий', res_emeril: 'Эмерил', res_indium: 'Индий' };

  // ---------- имена ----------
  const SYL = ['ко', 'ра', 'зу', 'ли', 'вак', 'тор', 'ми', 'ша', 'гло', 'бре', 'нуф', 'ка', 'ди', 'ро', 'зел', 'фан', 'ти', 'мо', 'ур', 'га', 'ксе', 'лун', 'дра', 'по', 'вир', 'эн', 'са', 'хор', 'ям', 'бо'];
  const word = (r, n) => { let s = ''; for (let i = 0; i < n; i++) s += pick(r, SYL); return s[0].toUpperCase() + s.slice(1); };

  // ---------- профиль планеты ----------
  const cache = new Map();
  function profile(planet, sys = {}) {
    if (cache.has(planet.id)) return cache.get(planet.id);
    const r = rng('pg:' + planet.id);
    const sec = sys.sec !== undefined ? sys.sec : 0.5;
    let biome;
    switch (planet.ptype) {
      case 'Газовый гигант': biome = null; break;
      case 'Океаническая': biome = r() < 0.7 ? 'ocean' : 'lush'; break;
      case 'Пустынная': biome = 'desert'; break;
      case 'Ледяная': biome = 'frozen'; break;
      case 'Лавовая': biome = 'volcanic'; break;
      default: biome = pickW(r, [['lush', 0.3], ['barren', 0.25], ['toxic', 0.2], ['irradiated', 0.15], ['exotic', 0.1]]);
    }
    if (!biome) { const P = { id: planet.id, name: planet.name, landable: false, why: 'Газовый гигант: твёрдой поверхности нет' }; cache.set(planet.id, P); return P; }
    const B = BIOMES[biome], hue = planet.hue || r();
    const P = { id: planet.id, name: planet.name, landable: true, biome, biomeName: B.name, sec, seed: Math.floor(hue * 1e9) ^ Math.floor(r() * 1e9) };
    // климат и погода
    P.temp = [Math.round(lerp(B.temp[0], B.temp[1], r() * 0.5)), 0]; P.temp[1] = P.temp[0] + Math.round(8 + r() * 18); // ночь / день
    P.hz = B.hz; P.hzK = B.hz ? 0.6 + r() * 0.6 : 0;
    P.storm = B.storm * (0.6 + r() * 0.8); P.stormName = B.stormName;
    P.gravity = +(0.6 + r() * 0.9).toFixed(2);
    P.dayLen = Math.round(600 + r() * 900);                        // секунд в сутках
    P.flora = clamp(B.flora * (0.7 + r() * 0.5), 0.05, 1); P.fauna = clamp(B.fauna * (0.6 + r() * 0.6), 0.05, 1);
    P.sentinels = pickW(r, sec >= 0.5 ? [['low', 0.5], ['normal', 0.4], ['high', 0.1]] : sec > 0 ? [['low', 0.3], ['normal', 0.45], ['high', 0.25]] : [['none', 0.3], ['low', 0.2], ['normal', 0.25], ['high', 0.25]]);
    P.special = B.special; P.specialName = SPECIAL_NAME[B.special];
    P.metal = metalFor(sec); P.metalName = METAL_NAME[P.metal];
    P.liquid = B.liquid;
    // рельеф
    const T = { lush: [26, 230, 0.25, 0.35], ocean: [20, 260, 0.15, 0.2], desert: [16, 300, 0.1, 0.25], frozen: [34, 200, 0.6, 0.5], volcanic: [32, 190, 0.45, 0.6],
      barren: [20, 210, 0.3, 0.3], toxic: [22, 170, 0.2, 0.3], irradiated: [26, 200, 0.35, 0.4], exotic: [36, 160, 0.4, 0.5] }[biome];
    P.terrain = { amp: T[0] * (0.65 + r() * 0.8), scale: T[1] * (0.7 + r() * 0.6), ridge: T[2] * (0.5 + r()), mount: T[3] * (0.5 + r()),
      terrace: (biome === 'desert' || biome === 'barren' || biome === 'exotic') && r() < 0.6 ? 3 + r() * 5 : 0,
      dunes: biome === 'desert' ? 1.5 + r() * 2.5 : 0, duneDir: r() * Math.PI, base: biome === 'ocean' ? -8 - r() * 6 : 0,
      spikes: biome === 'exotic' && r() < 0.6 ? 10 + r() * 25 : 0 };
    P.liquidY = biome === 'ocean' ? 0 : biome === 'lush' ? -P.terrain.amp * 0.45 : biome === 'volcanic' ? -P.terrain.amp * 0.55 : biome === 'toxic' ? -P.terrain.amp * 0.5 : biome === 'frozen' ? -P.terrain.amp * 0.5 : null;
    // палитра: основа биома + сдвиг оттенка планеты; иногда — «чужие» цвета, как в No Man's Sky
    const alien = r() < (biome === 'exotic' ? 1 : 0.22), sh = alien ? r() : (hue - 0.5) * 0.08;
    const base = { lush: [0.3, 0.55, 0.32], ocean: [0.28, 0.5, 0.35], desert: [0.08, 0.55, 0.55], frozen: [0.58, 0.18, 0.86], volcanic: [0.03, 0.15, 0.16],
      barren: [0.08, 0.18, 0.42], toxic: [0.2, 0.55, 0.42], irradiated: [0.42, 0.35, 0.4], exotic: [r(), 0.6, 0.5] }[biome];
    const gh = base[0] + sh;
    P.pal = {
      low: hsl(gh + 0.02, base[1], base[2] * 0.85), mid: hsl(gh, base[1], base[2]), high: hsl(gh - 0.03, base[1] * 0.7, Math.min(0.92, base[2] * 1.25)),
      rock: hsl(gh + (biome === 'volcanic' ? 0 : 0.04), 0.12, biome === 'volcanic' ? 0.1 : biome === 'frozen' ? 0.55 : 0.3), sand: hsl(0.1 + sh * 0.3, 0.45, 0.62),
      snow: biome === 'frozen' || biome === 'lush' || biome === 'barren' ? hsl(0.58, 0.15, 0.93) : null,
      leaf: hsl(gh + (r() - 0.5) * 0.12, Math.min(1, base[1] + 0.15), base[2] * 0.85), leaf2: hsl(gh + 0.08 + r() * 0.15, 0.6, 0.5), trunk: hsl(0.07 + r() * 0.05, 0.35, 0.22),
      flower: hsl(r(), 0.8, 0.6),
      sky: biome === 'volcanic' ? hsl(0.03, 0.5, 0.32) : biome === 'toxic' ? hsl(0.2, 0.5, 0.6) : biome === 'irradiated' ? hsl(0.42, 0.45, 0.58) : biome === 'desert' ? hsl(0.08, 0.5, 0.7)
        : alien ? hsl(r(), 0.5, 0.62) : biome === 'barren' ? hsl(0.6, 0.15, 0.62) : hsl(0.58 + (r() - 0.5) * 0.05, 0.55, 0.65),
      liquid: biome === 'volcanic' ? [1.0, 0.35, 0.05] : biome === 'toxic' ? hsl(0.22, 0.7, 0.4) : biome === 'frozen' ? hsl(0.55, 0.35, 0.82) : hsl(0.56 + sh * 0.3, 0.6, 0.35)
    };
    P.pal.fog = P.pal.sky.map((v, i) => lerp(v, [0.75, 0.75, 0.78][i], 0.25));
    P.fog = biome === 'toxic' || biome === 'irradiated' || biome === 'volcanic' ? 0.0075 : biome === 'ocean' || biome === 'lush' ? 0.0042 : 0.005;
    // флора: два вида деревьев, куст, трава
    P.flora2 = {
      trees: [pick(r, B.trees), pick(r, B.trees)].map(style => ({ style, h: 5 + r() * (style === 'spire' ? 18 : 12), w: 0.6 + r() * 0.8, leaf: hsl(gh + (r() - 0.5) * 0.25, 0.55 + r() * 0.3, 0.3 + r() * 0.3), glow: biome === 'irradiated' || biome === 'exotic' || style === 'bulb' ? hsl(r(), 0.9, 0.6) : null })),
      bush: { h: 0.6 + r() * 1.4, leaf: hsl(gh + (r() - 0.5) * 0.2, 0.6, 0.35) },
      grass: { h: biome === 'frozen' || biome === 'volcanic' ? 0 : 0.4 + r() * 0.9, col: hsl(gh + (r() - 0.5) * 0.06, base[1] + 0.1, base[2] * 1.05) },
      density: P.flora
    };
    // виды животных
    const nSp = Math.max(1, Math.round(1 + P.fauna * 6 * (0.6 + r() * 0.6)));
    P.species = [];
    for (let i = 0; i < nSp; i++) P.species.push(makeSpecies(P, r, i, gh));
    P.name2 = planet.name;
    cache.set(planet.id, P);
    return P;
  }

  const PLANS = [['quad', 3], ['biped', 1.6], ['hexa', 1.4], ['serpent', 0.8], ['flyer', 1.4], ['blob', 0.8], ['hopper', 1.2], ['giant', 0.5]];
  const PLAN_NAME = { quad: 'четвероногое', biped: 'двуногое', hexa: 'шестиногое', serpent: 'змеевидное', flyer: 'летающее', blob: 'слизень', hopper: 'прыгун', giant: 'гигант' };
  const TEMPER = { skittish: 'Пугливый', calm: 'Спокойный', territorial: 'Территориальный', predator: 'Хищник' };
  const DIET = ['Травоядное', 'Плотоядное', 'Всеядное', 'Камнеед', 'Питается светом'];
  const EPITHET = ['рогатый', 'пятнистый', 'длинношеий', 'светящийся', 'бронированный', 'мохнатый', 'полосатый', 'гребнистый', 'шипастый', 'голый', 'короткохвостый', 'большеглазый'];
  function makeSpecies(P, r, i, gh) {
    const plan = pickW(r, PLANS);
    const hostile = P.biome === 'volcanic' || P.biome === 'toxic' || P.biome === 'irradiated' ? 0.3 : 0.15;
    const temper = pickW(r, [['skittish', 0.35], ['calm', 0.35], ['territorial', 0.15], ['predator', hostile]]);
    const size = plan === 'giant' ? 5 + r() * 5 : plan === 'blob' || plan === 'hopper' ? 0.4 + r() * 0.9 : plan === 'flyer' ? 0.6 + r() * 1.6 : 0.6 + r() * 2.6;
    const traits = { horns: r() < 0.35, spikes: r() < 0.3, longNeck: plan === 'giant' || r() < 0.2, tail: r() < 0.75, plates: r() < 0.25, antennae: plan === 'hexa' || r() < 0.15, glow: r() < (P.biome === 'exotic' || P.biome === 'irradiated' ? 0.6 : 0.15), stripes: r() < 0.4 };
    const epi = traits.horns ? 'рогатый' : traits.longNeck ? 'длинношеий' : traits.glow ? 'светящийся' : traits.plates ? 'бронированный' : traits.spikes ? 'шипастый' : traits.stripes ? 'полосатый' : pick(r, EPITHET);
    const rarity = size > 4 || traits.glow ? 3 : r() < 0.4 ? 2 : 1;
    return {
      idx: i, name: word(r, 2 + (r() < 0.4 ? 1 : 0)) + ' ' + epi, plan, planName: PLAN_NAME[plan], size: +size.toFixed(2),
      col: hsl(gh + 0.5 + (r() - 0.5) * 0.6, 0.35 + r() * 0.5, 0.3 + r() * 0.35), col2: hsl(r(), 0.4 + r() * 0.5, 0.45 + r() * 0.35), eye: hsl(r(), 1, 0.6),
      temper, temperName: TEMPER[temper], diet: temper === 'predator' ? 'Плотоядное' : pick(r, DIET.filter(d => d !== 'Плотоядное')),
      speed: +(plan === 'flyer' ? 7 + r() * 6 : plan === 'giant' ? 2 + r() * 1.5 : plan === 'blob' ? 1 + r() * 1.5 : 3 + r() * 5).toFixed(1),
      hp: Math.round(30 + size * 45 + (temper === 'predator' ? 40 : 0)), dmg: temper === 'predator' ? Math.round(6 + size * 4) : temper === 'territorial' ? Math.round(4 + size * 3) : 0,
      herd: plan === 'giant' ? [1, 3] : plan === 'flyer' ? [2, 6] : temper === 'predator' ? [1, 2] : [2, 6], rarity, traits,
      height: +(plan === 'flyer' ? 0 : size * (plan === 'giant' ? 1.6 : plan === 'serpent' || plan === 'blob' ? 0.45 : 0.9)).toFixed(2),
      meat: Math.round(4 + size * 6), hide: plan === 'blob' || plan === 'hexa' ? 0 : Math.round(1 + size * 2)
    };
  }

  // ---------- высота ----------
  const noiseCache = new Map();
  function noises(P) {
    if (!noiseCache.has(P.id)) noiseCache.set(P.id, { a: makeNoise(P.seed), b: makeNoise(P.seed + 17), c: makeNoise(P.seed + 91) });
    return noiseCache.get(P.id);
  }
  function height(P, x, z) {
    const N = noises(P), T = P.terrain, sc = T.scale;
    let h = fbm(N.a, x / sc, z / sc, 5) * T.amp;
    const rd = 1 - Math.abs(N.b(x / (sc * 1.7), z / (sc * 1.7)));
    h += rd * rd * T.amp * T.ridge;
    const big = fbm(N.c, x / (sc * 4.5), z / (sc * 4.5), 3);
    h += Math.max(0, big) * Math.max(0, big) * T.amp * 4 * T.mount;
    if (T.terrace) { const st = T.terrace, k = h / st, f = k - Math.floor(k); h = (Math.floor(k) + Math.pow(f, 4)) * st; }
    if (T.dunes) { const d = x * Math.cos(T.duneDir) + z * Math.sin(T.duneDir); h += Math.sin(d / 22 + N.b(x / 90, z / 90) * 3) * T.dunes; }
    if (T.spikes) { const s = N.c(x / 26, z / 26); if (s > 0.35) h += (s - 0.35) * (s - 0.35) * T.spikes * 6; }
    return h + T.base;
  }

  // ---------- чанки ----------
  const key = (cx, cz) => cx + ':' + cz;
  // узлы ресурсов: id «cx:cz:i»
  function chunkNodes(P, cx, cz) {
    const r = rng('nodes:' + P.id + ':' + key(cx, cz)), out = [];
    const n = Math.round((7 + 16 * P.flora) * (0.75 + r() * 0.5));
    const weights = [['plant', 0.9 * P.flora + 0.15], ['tree', 1.1 * P.flora], ['oxygen', 0.22], ['sodium', P.hz ? 0.26 : 0.16], ['dihydro', 0.18],
      ['rock', 0.45], ['boulder', 0.12], ['special', 0.14]];
    for (let i = 0; i < n; i++) {
      const kind = pickW(r, weights), x = (cx + r()) * CHUNK, z = (cz + r()) * CHUNK, s = 0.7 + r() * 0.7;
      if (P.liquidY !== null && height(P, x, z) < P.liquidY + 0.4) continue;
      const D = NODES[kind];
      out.push({ id: key(cx, cz) + ':' + i, kind, x, z, s, rot: r() * 6.283, item: kind === 'special' ? P.special : D.item, amount: Math.round(lerp(D.y[0], D.y[1], r()) * (0.6 + s * 0.4)) });
    }
    // редкости: рудная жила, аварийная капсула, грузовой контейнер
    const extra = [['metal', 0.09], ['capsule', 0.022], ['crate', 0.04]];
    extra.forEach(([kind, ch], j) => {
      if (r() >= ch) return;
      const x = (cx + 0.15 + r() * 0.7) * CHUNK, z = (cz + 0.15 + r() * 0.7) * CHUNK;
      if (P.liquidY !== null && height(P, x, z) < P.liquidY + 0.4) return;
      const D = NODES[kind];
      out.push({ id: key(cx, cz) + ':x' + j, kind, x, z, s: kind === 'metal' ? 1.2 + r() * 0.8 : 1, rot: r() * 6.283, item: kind === 'metal' ? P.metal : null, amount: Math.round(lerp(D.y[0], D.y[1], r())) });
    });
    return out;
  }
  function findNode(P, id) {
    const [cx, cz] = String(id).split(':').map(Number);
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) return null;
    return chunkNodes(P, cx, cz).find(n => n.id === id) || null;
  }
  // декор: трава, кусты, камешки (без добычи)
  function chunkDecor(P, cx, cz) {
    const r = rng('decor:' + P.id + ':' + key(cx, cz)), out = [];
    const n = Math.round((P.flora2.grass.h ? 60 : 12) * P.flora + 10);
    for (let i = 0; i < n; i++) {
      const x = (cx + r()) * CHUNK, z = (cz + r()) * CHUNK;
      if (P.liquidY !== null && height(P, x, z) < P.liquidY + 0.2) continue;
      const t = r();
      out.push({ kind: t < 0.62 && P.flora2.grass.h ? 'grass' : t < 0.85 ? 'bush' : 'pebble', x, z, s: 0.6 + r() * 0.9, rot: r() * 6.283 });
    }
    return out;
  }
  // стада: id существа «cx:cz:h:k»
  function chunkHerds(P, cx, cz) {
    const r = rng('herd:' + P.id + ':' + key(cx, cz)), out = [];
    if (!P.species.length || r() > P.fauna * 0.4) return out;
    const sp = P.species[Math.floor(r() * P.species.length)];
    if (sp.rarity === 3 && r() < 0.5) return out;
    const n = sp.herd[0] + Math.floor(r() * (sp.herd[1] - sp.herd[0] + 1));
    const hx = (cx + 0.2 + r() * 0.6) * CHUNK, hz = (cz + 0.2 + r() * 0.6) * CHUNK;
    for (let k = 0; k < n; k++) {
      const x = hx + (r() - 0.5) * 16, z = hz + (r() - 0.5) * 16;
      if (sp.plan !== 'flyer' && P.liquidY !== null && height(P, x, z) < P.liquidY + 0.3) continue;
      out.push({ id: key(cx, cz) + ':0:' + k, sp: sp.idx, x, z });
    }
    return out;
  }
  function findCreature(P, id) {
    const [cx, cz] = String(id).split(':').map(Number);
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) return null;
    return chunkHerds(P, cx, cz).find(c => c.id === id) || null;
  }

  // ---------- время суток и бури (по игровому времени — одинаково у всех) ----------
  function dayPhase(P, t) { return ((t / 1000 / P.dayLen) + Math.abs(P.seed % 1000) / 1000) % 1; } // 0 — полночь, 0.5 — полдень
  function storm(P, t) {
    const w = Math.floor(t / 1000 / 300), r = rng('storm:' + P.id + ':' + w);
    if (r() > P.storm) return 0;
    const into = (t / 1000) % 300, start = r() * 150, len = 60 + r() * 70;
    if (into < start || into > start + len) return 0;
    return clamp(Math.min(into - start, start + len - into) / 12, 0, 1); // плавное нарастание и спад
  }

  return { CHUNK, rng, makeNoise, fbm, hsl, BIOMES, NODES, HAZARD_NAME, SENTINEL_NAME, SPECIAL_NAME, METAL_NAME, profile, height, chunkNodes, findNode, chunkDecor, chunkHerds, findCreature, dayPhase, storm };
});
