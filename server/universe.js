// Процедурная генерация звёздных систем (детерминированная по id системы).
'use strict';
const { AU, SYSTEMS, GATES, STATION_NAMES, oresForSec, ITEMS, REGIONS, STAR_TYPES } = require('./data');

function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const PLANET_TYPES = ['Каменистая', 'Газовый гигант', 'Ледяная', 'Лавовая', 'Океаническая', 'Пустынная'];

function pickWeighted(r, list) {
  let x = r();
  for (const [v, w] of list) { if ((x -= w) <= 0) return v; }
  return list[list.length - 1][0];
}

// компаньоны двойных звёзд: какие звёзды встречаются в паре с основной
const COMPANIONS = {
  yellow: [['orange', 0.4], ['red', 0.35], ['white', 0.25]],
  white: [['yellow', 0.5], ['blue', 0.25], ['red', 0.25]],
  blue: [['white', 0.45], ['blue', 0.3], ['yellow', 0.25]],
  orange: [['red', 0.55], ['yellow', 0.3], ['white', 0.15]],
  red: [['red', 0.6], ['orange', 0.4]],
  blackhole: [['blue', 0.6], ['white', 0.4]] // рентгеновская двойная: звезда питает аккреционный диск
};
const STAR_SIZE = { yellow: 1, white: 0.5, blue: 2.2, orange: 0.9, red: 0.6, blackhole: 0.35 };

function buildUniverse() {
  const byId = {};
  for (const s of SYSTEMS) byId[s.id] = s;
  const neighbors = {};
  for (const s of SYSTEMS) neighbors[s.id] = [];
  for (const [a, b] of GATES) { neighbors[a].push(b); neighbors[b].push(a); }

  const systems = {};
  const celestials = {}; // id -> celestial (всех систем)
  for (const def of SYSTEMS) systems[def.id] = buildSystem(def, neighbors, byId, celestials);
  return { systems, celestials, neighbors, byId };
}

// Одна система: звезда, планеты, станции, пояса, врата к соседям, второе солнце.
// seed — для временных систем (червоточины): у каждой своя раскладка
function buildSystem(def, neighbors, byId, celestials, seed) {
  {
    const r = rng('sys:' + (seed || def.id));
    const sys = { def, id: def.id, celestials: [], belts: [], stations: [], gates: [], asteroidSeed: 0 };
    const add = (c) => { c.sys = def.id; sys.celestials.push(c); celestials[c.id] = c; return c; };

    const reg = REGIONS[def.region] || REGIONS.core;
    // отдельный генератор для звезды — чтобы не сдвигать раскладку планет и станций, сохранённую у игроков
    const star = def.star || reg.stars[Math.floor(rng('star:' + def.id)() * reg.stars.length)];
    const sr = { yellow: 1, white: 0.5, blue: 2.2, orange: 0.9, red: 0.6, blackhole: 0.35 }[star];
    add({ id: def.id + ':sun', kind: 'sun', star, name: def.name + ' A — ' + STAR_TYPES[star].name.toLowerCase(), pos: [0, 0, 0], radius: (4e8 + r() * 4e8) * sr, landing: 2e9 * Math.max(1, sr) });

    const nPlanets = 3 + Math.floor(r() * 4);
    let orbit = 0.4 * AU;
    const planets = [];
    for (let i = 0; i < nPlanets; i++) {
      orbit += (0.4 + r() * 1.4) * AU;
      const ang = r() * Math.PI * 2;
      const radius = 2e6 + r() * 6e6;
      const ptype = PLANET_TYPES[Math.floor(r() * PLANET_TYPES.length)];
      const p = add({
        id: `${def.id}:p${i + 1}`, kind: 'planet', name: `${def.name} ${ROMAN[i]}`, ptype,
        pos: [Math.cos(ang) * orbit, (r() - 0.5) * 0.05 * orbit, Math.sin(ang) * orbit],
        radius, landing: radius + 40000, hue: r()
      });
      planets.push(p);
    }

    // Станции
    const nStations = def.hub ? 3 : (def.sec > 0 ? 1 + Math.floor(r() * 2) : (r() < 0.7 ? 1 : 0));
    for (let i = 0; i < nStations; i++) {
      const p = planets[Math.floor(r() * planets.length)];
      const d = p.radius + 1.5e6 + r() * 2e6;
      const a = r() * Math.PI * 2;
      const st = add({
        id: `${def.id}:st${i + 1}`, kind: 'station', name: `${p.name} — ${STATION_NAMES[Math.floor(r() * STATION_NAMES.length)]}`,
        pos: [p.pos[0] + Math.cos(a) * d, p.pos[1] + (r() - 0.5) * 3e5, p.pos[2] + Math.sin(a) * d],
        radius: 2500, landing: 4500, undock: [-Math.cos(a), 0, -Math.sin(a)], style: Math.floor(r() * 3)
      });
      sys.stations.push(st);
    }

    // Пояса астероидов
    const nBelts = 2 + Math.floor(r() * 3);
    for (let i = 0; i < nBelts; i++) {
      const p = planets[Math.floor(r() * planets.length)];
      const d = p.radius + 4e6 + r() * 6e6;
      const a = r() * Math.PI * 2;
      const b = add({
        id: `${def.id}:b${i + 1}`, kind: 'belt', name: `${p.name} — пояс астероидов ${i + 1}`,
        pos: [p.pos[0] + Math.cos(a) * d, p.pos[1] + (r() - 0.5) * 4e5, p.pos[2] + Math.sin(a) * d],
        radius: 1, landing: 8000, ores: oresForSec(def.sec)
      });
      sys.belts.push(b);
    }

    // Звёздные врата — направление совпадает с направлением на карте
    for (const nb of neighbors[def.id] || []) {
      const o = byId[nb];
      const dx = o.x - def.x, dy = o.y - def.y;
      const len = Math.hypot(dx, dy) || 1;
      const dist = orbit * (0.7 + r() * 0.4);
      const g = add({
        id: `${def.id}:g:${nb}`, kind: 'gate', name: `Врата (${o.name})`, dest: nb,
        pos: [dx / len * dist, (r() - 0.5) * 0.04 * dist, dy / len * dist],
        radius: 1500, landing: 5000
      });
      sys.gates.push(g);
    }
    // Второе солнце: каждая система — двойная. Компаньон строится отдельным генератором и добавляется в конец,
    // поэтому раскладка планет, станций и врат (и сохранения игроков) не меняется.
    const r2 = rng('star2:' + (seed || def.id));
    const star2 = pickWeighted(r2, COMPANIONS[star]);
    const sr2 = STAR_SIZE[star2];
    const close = r2() < 0.7; // 70% — тесная пара (два солнца рядом на небе), 30% — далёкий компаньон за орбитами планет
    const d2 = close ? (0.12 + r2() * 0.18) * AU : orbit * (1.45 + r2() * 0.5);
    const a2 = r2() * Math.PI * 2;
    add({ id: def.id + ':sun2', kind: 'sun', companion: true, star: star2, name: def.name + ' B — ' + STAR_TYPES[star2].name.toLowerCase(),
      pos: [Math.cos(a2) * d2, (r2() - 0.5) * 0.04 * d2, Math.sin(a2) * d2], radius: (2.5e8 + r2() * 3e8) * sr2, landing: 2e9 * Math.max(1, sr2) });
    return sys;
  }
}

// Создаёт астероид в поясе
function makeAsteroid(belt, r, idx) {
  const ore = pickWeighted(r, belt.ores);
  const rad = 250 + r() * 900;
  const ang = r() * Math.PI * 2, dist = 3000 + r() * 22000;
  const amount = (Math.round(rad * rad * 0.01 / ITEMS[ore].vol) + 300) * 50; // руда богаче в 50 раз
  return {
    id: `${belt.id}:a${idx}`, type: 'asteroid', sys: belt.sys, belt: belt.id, ore,
    name: `${ITEMS[ore].name} (астероид)`,
    pos: [belt.pos[0] + Math.cos(ang) * dist, belt.pos[1] + (r() - 0.5) * 6000, belt.pos[2] + Math.sin(ang) * dist],
    vel: [0, 0, 0], radius: rad, amount, maxAmount: amount, seed: Math.floor(r() * 1e9)
  };
}

// Поиск кратчайшего маршрута (в прыжках)
function route(neighbors, from, to) {
  if (from === to) return [from];
  const prev = { [from]: null };
  const q = [from];
  while (q.length) {
    const c = q.shift();
    for (const n of neighbors[c]) {
      if (n in prev) continue;
      prev[n] = c;
      if (n === to) {
        const path = [to];
        let x = c;
        while (x) { path.unshift(x); x = prev[x]; }
        return path;
      }
      q.push(n);
    }
  }
  return null;
}

module.exports = { buildUniverse, buildSystem, makeAsteroid, route, rng };
