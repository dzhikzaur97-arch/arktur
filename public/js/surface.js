// Мир поверхности планеты: выход из корабля и прогулка пешком, как в No Man's Sky.
// - рельеф чанками 80×80 м по общему генератору (planetgen.js), вода/лава/кислота/лёд, небо со сменой дня и ночи, бури;
// - флора и узлы ресурсов (инстансы), мультитул: добыча лучом с нагревом, охота;
// - животные: процедурные тела по плану (четвероногие, шестиногие, летуны, змеи, слизни, прыгуны, гиганты),
//   поведение по характеру (пугливые, спокойные, территориальные, хищники), анализ вида, кормление;
// - дроны-смотрители: патруль, розыск ★ за охоту и жадную добычу, атака;
// - костюм: здоровье, жизнеобеспечение, защита от среды, ранец, бег; сканер ресурсов; корабль: взлёт.
// Экономика (добыча, охота, открытия, крафт) проверяется сервером (server/surface.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as R from './render.js';

const PG = window.PlanetGen;
const CH = PG.CHUNK;
let ctx = null;          // { send, note, data, sound, serverNow }
let W = null;            // состояние текущей планеты

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const col = (c) => new THREE.Color(c[0], c[1], c[2]);
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');

export function init(c) { ctx = c; }
export function active() { return !!W; }

// ======================================================================
// Геометрия из частей с цветами вершин (одна отрисовка на вид объекта)
// ======================================================================
function part(geo, color, m) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (m) g.applyMatrix4(m);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = color[0]; a[i * 3 + 1] = color[1]; a[i * 3 + 2] = color[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const M4 = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const merge = (parts) => parts.length ? mergeGeometries(parts) : null;
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
// камень: искажённый икосаэдр
function rockGeo(seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, r = PG.rng('rock' + seed);
  const bumps = Array.from({ length: 5 }, () => [new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), 0.15 + r() * 0.25]);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const n = v.clone().normalize();
    let k = 1; for (const [d, a] of bumps) k += Math.max(0, n.dot(d)) * a * 0.6;
    v.multiplyScalar(k * (0.85 + ((i * 7919) % 13) / 60)); p.setXYZ(i, v.x, v.y * 0.75, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------- деревья по стилю ----------
function treeGeo(t, pal, seed) {
  const r = PG.rng('tree' + seed), H = t.h, w = t.w, solid = [], glow = [];
  const trunk = pal.trunk, leaf = t.leaf;
  switch (t.style) {
    case 'conifer':
      solid.push(part(new THREE.CylinderGeometry(0.12 * w, 0.22 * w, H * 0.35, 7), trunk, M4(0, H * 0.175)));
      for (let i = 0; i < 4; i++) solid.push(part(new THREE.ConeGeometry((1.6 - i * 0.32) * w, H * 0.32, 8), shade(leaf, 0.85 + i * 0.07), M4(0, H * (0.3 + i * 0.17))));
      break;
    case 'palm': {
      let x = 0, y = 0;
      for (let i = 0; i < 6; i++) { const nx = x + 0.12 * H * 0.12 * i; solid.push(part(new THREE.CylinderGeometry(0.13 * w, 0.17 * w, H / 6 + 0.05, 6), trunk, M4((x + nx) / 2, y + H / 12, 0, 1, 1, 1, 0, 0, -0.08 * i))); x = nx; y += H / 6; }
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; solid.push(part(new THREE.BoxGeometry(0.5 * w, 0.06, H * 0.32), leaf, M4(x + Math.cos(a) * H * 0.13, y - 0.1, Math.sin(a) * H * 0.13, 1, 1, 1, 0.45, -a + Math.PI / 2, 0))); }
      break;
    }
    case 'mushroom':
      solid.push(part(new THREE.CylinderGeometry(0.22 * w, 0.32 * w, H * 0.75, 9), shade(pal.sand, 0.9), M4(0, H * 0.37)));
      solid.push(part(new THREE.SphereGeometry(1.4 * w + H * 0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), leaf, M4(0, H * 0.72, 0, 1, 0.55, 1)));
      glow.push(part(new THREE.CylinderGeometry((1.3 * w + H * 0.11), 0.3 * w, 0.12, 14), t.glow || shade(leaf, 1.8), M4(0, H * 0.72)));
      break;
    case 'spire':
      for (let i = 0; i < 3; i++) { const a = r() * 6.28, d = i ? 0.6 * w : 0; (t.glow ? glow : solid).push(part(new THREE.OctahedronGeometry(1, 0), t.glow || leaf, M4(Math.cos(a) * d, H * (0.5 - i * 0.12), Math.sin(a) * d, 0.45 * w, H * (0.55 - i * 0.12), 0.45 * w, (r() - 0.5) * 0.3, r(), (r() - 0.5) * 0.3))); }
      break;
    case 'bulb':
      solid.push(part(new THREE.CylinderGeometry(0.08 * w, 0.14 * w, H * 0.8, 6), trunk, M4(0, H * 0.4)));
      glow.push(part(new THREE.SphereGeometry(0.7 * w + H * 0.06, 12, 8), t.glow || leaf, M4(0, H * 0.85)));
      for (let i = 0; i < 3; i++) { const a = i * 2.1; solid.push(part(new THREE.SphereGeometry(0.35 * w, 8, 6), leaf, M4(Math.cos(a) * 0.5 * w, H * 0.45, Math.sin(a) * 0.5 * w, 1, 0.5, 1))); }
      break;
    case 'coral':
      for (let i = 0; i < 7; i++) { const a = r() * 6.28, tilt = 0.3 + r() * 0.5, len = H * (0.4 + r() * 0.5); solid.push(part(new THREE.CylinderGeometry(0.1 * w, 0.2 * w, len, 6), i % 2 ? leaf : t.glow || shade(leaf, 1.2), M4(Math.cos(a) * len * 0.25, len * 0.45, Math.sin(a) * len * 0.25, 1, 1, 1, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt))); }
      break;
    case 'cactus':
      solid.push(part(new THREE.CylinderGeometry(0.35 * w, 0.4 * w, H * 0.8, 8), leaf, M4(0, H * 0.4)));
      for (const sx of [-1, 1]) { solid.push(part(new THREE.CylinderGeometry(0.2 * w, 0.22 * w, H * 0.3, 7), leaf, M4(sx * 0.55 * w, H * 0.45, 0, 1, 1, 1, 0, 0, sx * 1.4))); solid.push(part(new THREE.CylinderGeometry(0.2 * w, 0.2 * w, H * 0.3, 7), leaf, M4(sx * 0.9 * w, H * 0.6))); }
      break;
    case 'dead':
      solid.push(part(new THREE.CylinderGeometry(0.1 * w, 0.25 * w, H, 6), shade(trunk, 0.8), M4(0, H / 2)));
      for (let i = 0; i < 5; i++) { const a = r() * 6.28, y = H * (0.45 + r() * 0.45), l = H * 0.3; solid.push(part(new THREE.CylinderGeometry(0.03 * w, 0.08 * w, l, 5), shade(trunk, 0.8), M4(Math.cos(a) * l * 0.4, y, Math.sin(a) * l * 0.4, 1, 1, 1, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9))); }
      break;
    default: // broad
      solid.push(part(new THREE.CylinderGeometry(0.16 * w, 0.28 * w, H * 0.55, 7), trunk, M4(0, H * 0.27)));
      for (let i = 0; i < 5; i++) { const a = r() * 6.28, d = i ? 0.9 * w : 0; solid.push(part(new THREE.IcosahedronGeometry(1, 1), shade(leaf, 0.85 + r() * 0.3), M4(Math.cos(a) * d, H * (0.62 + r() * 0.2), Math.sin(a) * d, 1.1 * w + H * 0.08, 0.9 * w + H * 0.06, 1.1 * w + H * 0.08))); }
  }
  if (t.glow && t.style !== 'spire' && t.style !== 'bulb' && t.style !== 'mushroom') glow.push(part(new THREE.SphereGeometry(0.18 * w, 6, 5), t.glow, M4(0, H * 0.95)));
  return { solid: merge(solid), glow: merge(glow) };
}

// ---------- виды объектов на планете (геометрии на всю планету) ----------
const SPECIAL_COL = { res_bulb: [1.6, 1.2, 0.3], res_coral: [1.4, 0.45, 0.6], res_pyrite: [1.5, 1.1, 0.25], res_cryo: [0.7, 1.3, 1.8], res_phosphor: [1.9, 0.6, 0.12],
  res_quartzite: [1.4, 1.4, 1.35], res_ammonia: [0.9, 1.6, 0.25], res_uranium: [0.5, 1.8, 0.4], res_paraquartz: [1.2, 0.45, 1.8] };
const METAL_COL = { res_copper: [0.3, 1.5, 1.4], res_cadmium: [1.8, 0.25, 0.25], res_emeril: [0.35, 1.7, 0.45], res_indium: [0.45, 0.6, 1.9] };
function buildKinds(P) {
  const pal = P.pal, K = {};
  const F = P.flora2;
  K.tree0 = treeGeo(F.trees[0], pal, 1); K.tree1 = treeGeo(F.trees[1], pal, 2);
  K.plant = { solid: merge([part(new THREE.IcosahedronGeometry(0.5, 0), F.bush.leaf, M4(0, 0.35, 0, 1, 0.8, 1)), part(new THREE.ConeGeometry(0.18, 1.1, 5), shade(F.bush.leaf, 1.2), M4(0.2, 0.6, 0.1, 1, 1, 1, 0.2, 0, -0.2)), part(new THREE.ConeGeometry(0.15, 0.9, 5), shade(F.bush.leaf, 0.9), M4(-0.25, 0.5, -0.1, 1, 1, 1, -0.3, 0, 0.3))]) };
  K.oxygen = { solid: merge([part(new THREE.CylinderGeometry(0.05, 0.07, 0.8, 5), [0.2, 0.45, 0.15], M4(0, 0.4)), part(new THREE.ConeGeometry(0.4, 0.3, 6), [0.25, 0.55, 0.2], M4(0, 0.1))]),
    glow: merge([part(new THREE.IcosahedronGeometry(0.32, 0), [1.8, 0.25, 0.2], M4(0, 0.95, 0, 1, 0.7, 1))]) };
  K.sodium = { solid: merge([part(new THREE.IcosahedronGeometry(0.55, 0), [0.35, 0.4, 0.15], M4(0, 0.3, 0, 1, 0.6, 1))]),
    glow: merge([0, 1, 2, 3].map(i => part(new THREE.SphereGeometry(0.16, 8, 6), [1.9, 1.5, 0.25], M4(Math.cos(i * 1.57) * 0.3, 0.65, Math.sin(i * 1.57) * 0.3)))) };
  K.dihydro = { glow: merge([0, 1, 2, 3, 4].map(i => part(new THREE.OctahedronGeometry(1, 0), [0.35, 0.8, 1.9], M4(Math.cos(i * 1.3) * 0.35 * (i ? 1 : 0), 0.5, Math.sin(i * 1.3) * 0.35 * (i ? 1 : 0), 0.18, i ? 0.45 : 0.75, 0.18, (i % 2) * 0.4, i, 0)))) };
  K.rock = { solid: merge([part(rockGeo(3), pal.rock, M4(0, 0.35, 0, 0.8, 0.8, 0.8))]) };
  K.boulder = { solid: merge([part(rockGeo(7, 2), shade(pal.rock, 0.9), M4(0, 1.2, 0, 2.4, 2.2, 2.2))]) };
  const sc = SPECIAL_COL[P.special] || [1.4, 1.4, 1.4];
  K.special = { solid: merge([part(rockGeo(11), shade(pal.rock, 0.7), M4(0, 0.25, 0, 0.7, 0.5, 0.7))]),
    glow: merge([0, 1, 2].map(i => part(new THREE.OctahedronGeometry(1, 0), sc, M4(Math.cos(i * 2.1) * 0.3, 0.7, Math.sin(i * 2.1) * 0.3, 0.2, 0.55, 0.2, 0.3 * i, i, 0)))) };
  const mc = METAL_COL[P.metal] || [1, 1, 1];
  K.metal = { solid: merge([part(rockGeo(17, 2), shade(pal.rock, 0.6), M4(0, 0.8, 0, 2.8, 1.4, 2.8))]),
    glow: merge([0, 1, 2, 3, 4, 5].map(i => part(new THREE.CylinderGeometry(0.01, 0.45, 1, 6), mc, M4(Math.cos(i) * 1.1 * (i ? 1 : 0), 2.6 + (i ? -0.5 : 0.6), Math.sin(i) * 1.1 * (i ? 1 : 0), 1, i ? 3 : 4.5, 1, Math.cos(i) * 0.25 * (i ? 1 : 0), 0, Math.sin(i) * 0.25 * (i ? 1 : 0))))) };
  K.capsule = { solid: merge([part(new THREE.CylinderGeometry(0.55, 0.55, 1.6, 10), [0.55, 0.58, 0.62], M4(0, 0.6, 0, 1, 1, 1, 0.4, 0, 1.2)), part(new THREE.ConeGeometry(0.55, 0.6, 10), [0.4, 0.42, 0.45], M4(0.85, 0.95, 0, 1, 1, 1, 0, 0, -0.37))]),
    glow: merge([part(new THREE.SphereGeometry(0.16, 8, 6), [0.3, 1.6, 2], M4(-0.3, 1.2, 0.3))]) };
  K.crate = { solid: merge([part(new THREE.BoxGeometry(1.6, 1, 1.1), [0.75, 0.5, 0.15], M4(0, 0.5)), part(new THREE.BoxGeometry(1.65, 0.12, 1.15), [0.25, 0.25, 0.27], M4(0, 0.95))]),
    glow: merge([part(new THREE.BoxGeometry(0.3, 0.06, 1.16), [1.8, 1.2, 0.3], M4(0, 0.6))]) };
  K.grass = F.grass.h ? { solid: merge([0, 1, 2, 3].map(i => part(new THREE.ConeGeometry(0.05, F.grass.h, 3), shade(F.grass.col, 0.8 + i * 0.1), M4(Math.cos(i * 1.7) * 0.15, F.grass.h / 2, Math.sin(i * 1.7) * 0.15, 1, 1, 1, Math.cos(i) * 0.2, 0, Math.sin(i) * 0.2)))) } : null;
  K.bush = { solid: merge([part(new THREE.IcosahedronGeometry(0.6, 0), F.bush.leaf, M4(0, F.bush.h * 0.4, 0, 1.2, F.bush.h, 1.2))]) };
  K.pebble = { solid: merge([part(rockGeo(23, 0), shade(pal.rock, 1.1), M4(0, 0.1, 0, 0.25, 0.25, 0.25))]) };
  return K;
}

// ======================================================================
// Животные: тело по плану, анимация конечностей
// ======================================================================
function speciesModel(sp) {
  const S = sp.size, g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const M = new THREE.MeshStandardMaterial({ color: col(sp.col), roughness: 0.75, metalness: 0.05 });
  const M2 = new THREE.MeshStandardMaterial({ color: col(sp.col2), roughness: 0.8 });
  const E = new THREE.MeshBasicMaterial({ color: col(sp.eye).multiplyScalar(2) });
  const mesh = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; parent.add(m); return m; };
  const legs = [], wings = [], segs = [];
  const leg = (x, y, z, len, th, mat = M2, splay = 0) => { const p = new THREE.Group(); p.position.set(x, y, z); p.rotation.z = splay; body.add(p); const l = mesh(new THREE.CylinderGeometry(th * 0.7, th, len, 6), mat, 0, -len / 2, 0, 1, 1, 1, p); l.castShadow = true; legs.push(p); return p; };
  const T = sp.traits;
  const head = (x, y, z, r) => {
    const h = mesh(new THREE.SphereGeometry(r, 12, 9), M, x, y, z, 0.9, 0.85, 1.2);
    for (const sx of [-1, 1]) mesh(new THREE.SphereGeometry(r * 0.18, 6, 5), E, x + sx * r * 0.45, y + r * 0.25, z + r * 0.85);
    if (T.horns) for (const sx of [-1, 1]) mesh(new THREE.ConeGeometry(r * 0.15, r * 1.1, 6), M2, x + sx * r * 0.45, y + r * 0.9, z, 1, 1, 1).rotation.z = -sx * 0.4;
    if (T.antennae) for (const sx of [-1, 1]) mesh(new THREE.CylinderGeometry(r * 0.03, r * 0.03, r * 1.4, 4), M2, x + sx * r * 0.3, y + r * 1.0, z + r * 0.3).rotation.x = 0.5;
    return h;
  };
  let legLen = 0, top = 0;
  switch (sp.plan) {
    case 'quad': case 'giant': {
      legLen = S * (sp.plan === 'giant' ? 1.0 : 0.55); top = legLen + S * 0.25;
      mesh(new THREE.SphereGeometry(S * 0.5, 14, 10), M, 0, top, 0, 0.75, 0.6, 1.1);
      mesh(new THREE.SphereGeometry(S * 0.42, 12, 8), M2, 0, top - S * 0.12, 0, 0.65, 0.4, 0.95);
      for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) leg(x * S * 0.24, top - S * 0.1, z * S * 0.32, legLen + S * 0.05, S * 0.08);
      const neck = T.longNeck ? S * 0.9 : S * 0.2;
      if (T.longNeck) mesh(new THREE.CylinderGeometry(S * 0.08, S * 0.14, neck, 8), M, 0, top + neck * 0.45, S * 0.55, 1, 1, 1).rotation.x = 0.5;
      head(0, top + (T.longNeck ? neck * 0.85 : S * 0.12), S * (T.longNeck ? 0.85 : 0.62), S * 0.24);
      if (T.tail) mesh(new THREE.ConeGeometry(S * 0.1, S * 0.8, 7), M, 0, top, -S * 0.75).rotation.x = -Math.PI / 2 - 0.4;
      if (T.spikes) for (let i = 0; i < 5; i++) mesh(new THREE.ConeGeometry(S * 0.05, S * 0.25, 5), M2, 0, top + S * 0.3, S * (0.3 - i * 0.16));
      if (T.plates) for (let i = 0; i < 4; i++) mesh(new THREE.BoxGeometry(S * 0.04, S * 0.25, S * 0.2), M2, 0, top + S * 0.32, S * (0.25 - i * 0.18)).rotation.x = 0.2;
      break;
    }
    case 'hexa': {
      legLen = S * 0.35; top = legLen + S * 0.15;
      for (const [z, r] of [[S * 0.45, S * 0.2], [S * 0.1, S * 0.24], [-S * 0.35, S * 0.34]]) mesh(new THREE.SphereGeometry(r, 10, 8), M, 0, top, z, 1, 0.75, 1.2);
      for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) leg(sx * S * 0.18, top, S * (0.25 - i * 0.22), legLen * 1.5, S * 0.035, M2, sx * 0.7);
      head(0, top + S * 0.05, S * 0.62, S * 0.15);
      break;
    }
    case 'biped': {
      legLen = S * 0.6; top = legLen + S * 0.35;
      mesh(new THREE.SphereGeometry(S * 0.38, 12, 9), M, 0, top, 0, 0.8, 1.1, 0.8);
      for (const sx of [-1, 1]) leg(sx * S * 0.17, top - S * 0.3, 0, legLen, S * 0.08);
      for (const sx of [-1, 1]) mesh(new THREE.CylinderGeometry(S * 0.03, S * 0.05, S * 0.4, 5), M2, sx * S * 0.3, top + S * 0.05, S * 0.15).rotation.x = 1;
      head(0, top + S * 0.45, S * 0.2, S * 0.22);
      if (T.tail) mesh(new THREE.ConeGeometry(S * 0.09, S * 0.9, 6), M, 0, top - S * 0.2, -S * 0.5).rotation.x = -Math.PI / 2 - 0.6;
      break;
    }
    case 'serpent': {
      top = S * 0.22;
      for (let i = 0; i < 8; i++) { const sg = new THREE.Group(); sg.position.set(0, top, -i * S * 0.32); body.add(sg); mesh(new THREE.SphereGeometry(S * (0.24 - i * 0.017), 10, 8), i % 2 ? M : M2, 0, 0, 0, 1, 0.8, 1.2, sg); segs.push(sg); }
      head(0, top + S * 0.05, S * 0.3, S * 0.22);
      break;
    }
    case 'flyer': {
      top = 0;
      mesh(new THREE.SphereGeometry(S * 0.3, 12, 9), M, 0, 0, 0, 0.7, 0.6, 1.5);
      for (const sx of [-1, 1]) { const p = new THREE.Group(); p.position.set(sx * S * 0.15, S * 0.05, 0); body.add(p); const w = mesh(new THREE.BoxGeometry(S * 1.1, S * 0.03, S * 0.5), M2, sx * S * 0.55, 0, 0, 1, 1, 1, p); w.rotation.y = sx * 0.2; wings.push(p); }
      head(0, S * 0.08, S * 0.45, S * 0.16);
      mesh(new THREE.ConeGeometry(S * 0.2, S * 0.5, 4), M2, 0, 0, -S * 0.55, 1, 0.2, 1).rotation.x = -Math.PI / 2;
      break;
    }
    case 'blob': {
      top = S * 0.4;
      mesh(new THREE.SphereGeometry(S * 0.5, 14, 10), M, 0, top, 0, 1.1, 0.8, 1.2);
      for (const sx of [-1, 1]) { mesh(new THREE.CylinderGeometry(S * 0.03, S * 0.04, S * 0.4, 5), M2, sx * S * 0.15, top + S * 0.5, S * 0.25); mesh(new THREE.SphereGeometry(S * 0.08, 7, 5), E, sx * S * 0.15, top + S * 0.72, S * 0.25); }
      break;
    }
    default: { // hopper
      legLen = S * 0.4; top = legLen + S * 0.2;
      mesh(new THREE.SphereGeometry(S * 0.32, 12, 9), M, 0, top, 0, 0.9, 0.9, 1.15);
      for (const sx of [-1, 1]) { leg(sx * S * 0.2, top - S * 0.1, -S * 0.15, legLen * 1.2, S * 0.09); leg(sx * S * 0.12, top - S * 0.15, S * 0.2, legLen * 0.8, S * 0.05); }
      head(0, top + S * 0.25, S * 0.3, S * 0.2);
      for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(S * 0.08, S * 0.45, S * 0.04), M2, sx * S * 0.12, top + S * 0.65, S * 0.25).rotation.z = sx * 0.25;
    }
  }
  if (T.glow) mesh(new THREE.SphereGeometry(S * 0.1, 8, 6), E, 0, top + S * 0.35, 0);
  g.userData = { legs, wings, segs, body, top };
  return g;
}

// ======================================================================
// Небо: градиент по высоте солнца, солнце, ночные звёзды, планета-спутник в небе
// ======================================================================
function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: new THREE.Vector3(0, 1, 0) }, day: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, night: { value: new THREE.Color(0.01, 0.015, 0.035) },
      sunCol: { value: new THREE.Color(1, 0.95, 0.85) }, k: { value: 1 }, storm: { value: 0 }, moonDir: { value: new THREE.Vector3(0.5, 0.4, -0.7).normalize() }, moonCol: { value: new THREE.Color(0.6, 0.65, 0.7) } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 sunDir, day, horizon, night, sunCol, moonDir, moonCol; uniform float k, storm; varying vec3 vD;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vD); float up = clamp(d.y, -0.2, 1.0);
        vec3 sky = mix(horizon, day, pow(max(up, 0.0), 0.55));
        float sunE = sunDir.y;
        // закат: тёплый край у горизонта со стороны солнца
        vec3 hd = vec3(d.x, 0.0, d.z), hs = vec3(sunDir.x, 0.0, sunDir.z);
        float sset = smoothstep(0.35, -0.05, abs(sunE)) * pow(max(dot(hd / max(length(hd), 1e-4), hs / max(length(hs), 1e-4)), 0.0), 3.0) * (1.0 - up);
        sky = mix(sky, vec3(1.0, 0.45, 0.2), sset * 0.7);
        float dayK = smoothstep(-0.18, 0.15, sunE);
        sky = mix(night + horizon * 0.04 * (1.0 - up), sky, dayK) * (1.0 - storm * 0.55);
        // звёзды ночью
        vec3 q = floor(d * 280.0); float st = step(0.9965, h(q)) * (1.0 - dayK) * (1.0 - storm) * smoothstep(-0.05, 0.2, d.y);
        sky += vec3(st) * (0.6 + h(q + 1.0));
        // солнце и ореол
        float sd = max(dot(d, sunDir), 0.0);
        sky += sunCol * (pow(sd, 1800.0) * 30.0 + pow(sd, 12.0) * 0.35 * k) * (1.0 - storm * 0.8);
        // планета-спутник в небе
        float md = dot(d, moonDir);
        if (md > 0.9975) { float e = smoothstep(0.9975, 0.9985, md); vec3 mo = d - moonDir * md; float lit = clamp(dot(mo / max(length(mo), 1e-5), sunDir) * 3.0 + 0.4, 0.05, 1.0); sky = mix(sky, moonCol * lit, e * (1.0 - storm)); }
        gl_FragColor = vec4(sky, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false
  });
}

// ======================================================================
// Вход на планету
// ======================================================================
export function enter(info) {
  if (W) leave();
  const P = info.P;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 3000);
  const pal = P.pal;
  scene.fog = new THREE.FogExp2(col(pal.fog), P.fog);
  scene.environment = R.envMap();
  scene.environmentIntensity = 0.35;
  const hemi = new THREE.HemisphereLight(col(pal.sky), col(pal.mid), 0.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.color.set(R.starLook(info.star).light);
  sun.castShadow = R.getGfx().shadows > 0;
  sun.shadow.mapSize.setScalar(Math.min(4096, R.getGfx().shadows || 1024)); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 });
  scene.add(sun, sun.target);
  const moon = new THREE.DirectionalLight(0x8aa0ff, 0); scene.add(moon);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), skyMaterial()); sky.renderOrder = -10; scene.add(sky);
  sky.material.uniforms.day.value.copy(col(pal.sky)); sky.material.uniforms.horizon.value.copy(col(pal.fog)); sky.material.uniforms.sunCol.value.set(R.starLook(info.star).light);
  const r = PG.rng('moon:' + P.id); sky.material.uniforms.moonDir.value.set(r() - 0.5, 0.25 + r() * 0.4, r() - 0.5).normalize(); sky.material.uniforms.moonCol.value.copy(col(PG.hsl(r(), 0.35, 0.6)));

  // материалы
  const terrMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0.02 });
  const floraMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.02 });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const K = buildKinds(P);

  // жидкость: вода, лава, кислота, лёд — плоскость, идущая за игроком
  let liquid = null;
  if (P.liquidY !== null && P.liquid) {
    const lc = col(P.pal.liquid);
    const mat = P.liquid === 'lava' ? new THREE.MeshBasicMaterial({ color: lc.clone().multiplyScalar(1.6) })
      : P.liquid === 'ice' ? new THREE.MeshStandardMaterial({ color: lc, roughness: 0.25, metalness: 0.1 })
      : new THREE.MeshStandardMaterial({ color: lc, roughness: 0.08, metalness: 0.3, transparent: true, opacity: P.liquid === 'acid' ? 0.85 : 0.78 });
    liquid = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600, 1, 1), mat); liquid.rotation.x = -Math.PI / 2; liquid.receiveShadow = true;
    scene.add(liquid);
  }

  // частицы погоды: дождь, снег, песок, пепел, токсичные капли, радиоактивная пыль
  const PN = 1800, pp = new Float32Array(PN * 3);
  for (let i = 0; i < PN * 3; i++) pp[i] = (Math.random() - 0.5) * 60;
  const pgeo = new THREE.BufferGeometry(); pgeo.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  const pcol = { lush: 0x9fc8ff, ocean: 0x9fc8ff, frozen: 0xffffff, desert: 0xd8b070, barren: 0xb8a890, volcanic: 0xff7a30, toxic: 0xa8ff40, irradiated: 0x80ff90, exotic: 0xff80ff }[P.biome];
  const weather = new THREE.Points(pgeo, new THREE.PointsMaterial({ color: pcol, size: P.biome === 'frozen' ? 0.14 : 0.08, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  weather.frustumCulled = false; scene.add(weather);

  // корабль
  const ship = R.landedShip(info.shipType, info.shipColor);
  const shipBox = new THREE.Box3().setFromObject(ship), shipSize = shipBox.getSize(new THREE.Vector3());
  const shipG = new THREE.Group(); shipG.add(ship); ship.position.y = -shipBox.min.y + 1.2;
  // посадочные опоры с «пятками» — под корпусом
  const legMat = new THREE.MeshStandardMaterial({ color: 0x8a9098, metalness: 0.7, roughness: 0.35 });
  for (const [x, z] of [[0.18, 0.22], [-0.18, 0.22], [0, -0.25]]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.5, 6), legMat); l.position.set(x * shipSize.x, 0.75, z * shipSize.z); shipG.add(l);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.12, 10), legMat); foot.position.set(x * shipSize.x, 0.06, z * shipSize.z); shipG.add(foot);
  }
  const shipR = Math.max(shipSize.x, shipSize.z) / 2;
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2, 1.2) })); beacon.position.y = shipSize.y + 3; shipG.add(beacon);
  shipG.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(shipG);
  const sx = info.ship[0], sz = info.ship[1], sy = PG.height(P, sx, sz);
  shipG.position.set(0, sy, 0);
  shipG.rotation.y = 0.6;

  // игрок
  const player = makePlayer();
  scene.add(player.g);

  // сканер: расходящееся кольцо
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 1.8), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2; scene.add(ring);
  // луч мультитула и искры
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.6, 0.25), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.visible = false; scene.add(beam);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.2, 0.5) })); spark.visible = false; scene.add(spark);

  const suit = info.suit;
  W = {
    P, info, scene, cam, sun, moon, hemi, sky, liquid, weather, terrMat, floraMat, glowMat, K, ship: shipG, shipPos: [sx, sz], shipR, shipBeacon: beacon, player, ring, beam, spark,
    origin: [sx, sz], chunks: new Map(), queue: [], creatures: new Map(), sentinels: [],
    depleted: new Set(info.depleted || []), dead: new Set(info.dead || []), taken: new Set([...(info.caps || []), ...(info.crates || [])].filter(k => k.startsWith(P.id + '|')).map(k => k.slice(P.id.length + 1))),
    disc: new Set(info.disc || []), recipes: info.recipes || {},
    suit, hp: suit.hp, ls: suit.ls, hz: suit.hz, jet: 1, stamina: 1, heat: 0, overheat: 0,
    pos: new THREE.Vector3(shipR + 3, 0, 2), vel: new THREE.Vector3(), yaw: 0.6 + Math.PI, pitch: -0.15, camDist: 4.5, ground: true,
    keys: new Set(), firing: false, mineT: null, mineP: 0, target: null, analyze: { id: null, t: 0 },
    scanUntil: 0, scanT: -1, markers: [], wanted: 0, wantedSeen: 0, lastHurt: 0,
    intro: 3.2, outro: 0, lastSync: 0, lastPos: 0, stormWas: 0, nightWas: null, hzWarned: 0, lsWarned: 0, picks: [], panel: null, locked: false, dt: 0, t: 0
  };
  W.pos.y = PG.height(P, sx + W.pos.x, sz + W.pos.z);
  buildHud();
  // корабль садится: сначала камера смотрит, как он опускается
  document.body.classList.add('on-surface');
  fade(1, 0); setTimeout(() => fade(0, 1.2), 50);
  ctx.note(`Вход в атмосферу: ${P.name}`, 'info');
  ctx.sound && ctx.sound.whoosh && ctx.sound.whoosh(0.4, false, 3);
}

export function leave() {
  if (!W) return;
  W.scene.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose && o.geometry.dispose(); });
  if (document.pointerLockElement) document.exitPointerLock();
  W = null;
  document.body.classList.remove('on-surface', 'sf-cine');
  const h = $('#surf-hud'); if (h) h.innerHTML = '';
}

function fade(to, dur) { const f = $('#sf-fade'); if (!f) return; f.style.transition = `opacity ${dur}s`; f.style.opacity = to; }

// ======================================================================
// Игрок: скафандр, ранец, мультитул
// ======================================================================
function makePlayer() {
  const g = new THREE.Group(), suitC = new THREE.MeshStandardMaterial({ color: 0xd8dce2, roughness: 0.55, metalness: 0.15 }), dark = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.5, metalness: 0.5 });
  const visor = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.9, 0.3) }), accent = new THREE.MeshStandardMaterial({ color: 0xd06a20, roughness: 0.6 });
  const m = (geo, mat, x, y, z, parent = g) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  m(new THREE.CapsuleGeometry(0.28, 0.55, 4, 10), suitC, 0, 1.15, 0);
  m(new THREE.SphereGeometry(0.22, 14, 10), suitC, 0, 1.68, 0);
  m(new THREE.SphereGeometry(0.15, 10, 8), visor, 0, 1.69, 0.12).scale.set(1.1, 0.7, 0.6);
  m(new THREE.BoxGeometry(0.42, 0.5, 0.22), dark, 0, 1.2, -0.3);
  m(new THREE.BoxGeometry(0.44, 0.08, 0.24), accent, 0, 1.42, -0.3);
  const jets = [-0.13, 0.13].map(x => { const f = m(new THREE.ConeGeometry(0.07, 0.5, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.2, 2.2), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }), x, 0.72, -0.34); f.rotation.x = Math.PI; f.visible = false; return f; });
  const legs = [-0.14, 0.14].map(x => { const p = new THREE.Group(); p.position.set(x, 0.85, 0); g.add(p); m(new THREE.CapsuleGeometry(0.1, 0.55, 3, 8), suitC, 0, -0.42, 0, p); return p; });
  const arms = [-0.36, 0.36].map(x => { const p = new THREE.Group(); p.position.set(x, 1.42, 0); g.add(p); m(new THREE.CapsuleGeometry(0.08, 0.45, 3, 8), suitC, 0, -0.3, 0, p); return p; });
  const tool = new THREE.Group(); arms[1].add(tool); tool.position.set(0, -0.55, 0.12);
  m(new THREE.BoxGeometry(0.1, 0.16, 0.5), dark, 0, 0, 0.1, tool); m(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 8), accent, 0, 0.03, 0.42, tool).rotation.x = Math.PI / 2;
  const tip = new THREE.Object3D(); tip.position.set(0, 0.03, 0.6); tool.add(tip);
  return { g, legs, arms, jets, tip };
}

// ======================================================================
// Чанки: рельеф, флора, узлы, стада
// ======================================================================
const TERR_SEG = 32;
function buildChunk(cx, cz) {
  const P = W.P, ox = W.origin[0], oz = W.origin[1], N = TERR_SEG + 1, step = CH / TERR_SEG;
  // сетка высот с каймой в 1 вершину — нормали без швов между чанками
  const Hs = new Float32Array((N + 2) * (N + 2));
  for (let j = -1; j <= N; j++) for (let i = -1; i <= N; i++) Hs[(j + 1) * (N + 2) + (i + 1)] = PG.height(P, cx * CH + i * step, cz * CH + j * step);
  const hAt = (i, j) => Hs[(j + 1) * (N + 2) + (i + 1)];
  const pos = new Float32Array(N * N * 3), nor = new Float32Array(N * N * 3), colr = new Float32Array(N * N * 3), idx = [];
  const pal = P.pal, amp = P.terrain.amp, liq = P.liquidY;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, h = hAt(i, j), x = cx * CH + i * step, z = cz * CH + j * step;
    pos[k * 3] = x - ox; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z - oz;
    const nx = hAt(i - 1, j) - hAt(i + 1, j), nz = hAt(i, j - 1) - hAt(i, j + 1), ny = 2 * step, L = Math.hypot(nx, ny, nz);
    nor[k * 3] = nx / L; nor[k * 3 + 1] = ny / L; nor[k * 3 + 2] = nz / L;
    const slope = 1 - ny / L, t = clamp((h + amp * 0.5) / (amp * 1.6), 0, 1);
    let c = t < 0.5 ? mix3(pal.low, pal.mid, t * 2) : mix3(pal.mid, pal.high, (t - 0.5) * 2);
    if (liq !== null && h < liq + 1.6 && P.liquid !== 'lava') c = mix3(c, pal.sand, clamp((liq + 1.6 - h) / 1.6, 0, 1));
    if (liq !== null && h < liq + 1.2 && P.liquid === 'lava') c = mix3(c, [0.08, 0.05, 0.04], 0.8);
    c = mix3(c, pal.rock, clamp((slope - 0.18) * 3.2, 0, 1));
    if (pal.snow && h > amp * 0.9) c = mix3(c, pal.snow, clamp((h - amp * 0.9) / (amp * 0.3), 0, 1));
    const v = 0.92 + (((Math.floor(x * 0.7) * 73856093) ^ (Math.floor(z * 0.7) * 19349663)) & 255) / 255 * 0.14;
    colr[k * 3] = c[0] * v; colr[k * 3 + 1] = c[1] * v; colr[k * 3 + 2] = c[2] * v;
  }
  for (let j = 0; j < TERR_SEG; j++) for (let i = 0; i < TERR_SEG; i++) { const a = j * N + i, b = a + 1, c = a + N, d = c + 1; idx.push(a, c, b, b, c, d); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  geo.setIndex(idx); geo.computeBoundingSphere();
  const terr = new THREE.Mesh(geo, W.terrMat); terr.receiveShadow = true;
  const group = new THREE.Group(); group.add(terr);
  // узлы ресурсов и декор — инстансами по видам
  const nodes = PG.chunkNodes(P, cx, cz).filter(n => !W.depleted.has(n.id) && !W.taken.has(n.id));
  const byKind = {};
  for (const n of nodes) { const k = n.kind === 'tree' ? 'tree' + (Math.abs(n.id.length + Math.floor(n.x)) % 2) : n.kind; (byKind[k] = byKind[k] || []).push(n); }
  const decor = PG.chunkDecor(P, cx, cz);
  for (const d of decor) { if (!W.K[d.kind]) continue; (byKind[d.kind] = byKind[d.kind] || []).push(d); }
  const meshes = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const shadows = R.getGfx().shadows > 0;
  for (const [k, list] of Object.entries(byKind)) {
    const kind = W.K[k]; if (!kind) continue;
    for (const [geo2, mat] of [[kind.solid, W.floraMat], [kind.glow, W.glowMat]]) {
      if (!geo2) continue;
      const im = new THREE.InstancedMesh(geo2, mat, list.length);
      list.forEach((n, i) => { e.set(0, n.rot, 0); q.setFromEuler(e); m4.compose(new THREE.Vector3(n.x - ox, PG.height(P, n.x, n.z) - 0.05, n.z - oz), q, new THREE.Vector3(n.s, n.s, n.s)); im.setMatrixAt(i, m4); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      im.castShadow = shadows && mat === W.floraMat && k !== 'grass' && k !== 'pebble'; im.receiveShadow = false;
      im.userData.nodes = list[0] && list[0].id ? list : null;
      group.add(im); meshes.push(im);
    }
  }
  W.scene.add(group);
  const ch = { cx, cz, group, terr, meshes, nodes };
  // стада
  for (const c of PG.chunkHerds(P, cx, cz)) if (!W.dead.has(c.id) && !W.creatures.has(c.id)) spawnCreature(c, cx, cz);
  return ch;
}
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function dropChunk(ch) {
  W.scene.remove(ch.group);
  ch.terr.geometry.dispose();
  for (const m of ch.meshes) m.dispose();
  for (const [id, c] of W.creatures) if (c.cx === ch.cx && c.cz === ch.cz && c.state !== 'friendly') { W.scene.remove(c.g); W.creatures.delete(id); }
}
// скрыть добытый узел
function hideNode(id) {
  for (const ch of W.chunks.values()) for (const m of ch.meshes) {
    const list = m.userData.nodes; if (!list) continue;
    const i = list.findIndex(n => n.id === id); if (i < 0) continue;
    m.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); m.instanceMatrix.needsUpdate = true;
  }
}
function updateChunks() {
  const P = W.P, wx = W.origin[0] + W.pos.x, wz = W.origin[1] + W.pos.z;
  const pcx = Math.floor(wx / CH), pcz = Math.floor(wz / CH), RAD = { low: 2, med: 3, high: 4, ultra: 5 }[R.getGfx().dist] || 3;
  const want = new Set();
  for (let dz = -RAD; dz <= RAD; dz++) for (let dx = -RAD; dx <= RAD; dx++) { if (dx * dx + dz * dz > (RAD + 0.5) * (RAD + 0.5)) continue; want.add((pcx + dx) + ':' + (pcz + dz)); }
  for (const [k, ch] of W.chunks) if (!want.has(k) && (Math.abs(ch.cx - pcx) > RAD + 1 || Math.abs(ch.cz - pcz) > RAD + 1)) { dropChunk(ch); W.chunks.delete(k); }
  const todo = [...want].filter(k => !W.chunks.has(k)).map(k => k.split(':').map(Number)).sort((a, b) => (Math.abs(a[0] - pcx) + Math.abs(a[1] - pcz)) - (Math.abs(b[0] - pcx) + Math.abs(b[1] - pcz)));
  // не больше ~5 мс на чанки за кадр — без фризов
  const t0 = performance.now();
  for (const [cx, cz] of todo) { W.chunks.set(cx + ':' + cz, buildChunk(cx, cz)); if (performance.now() - t0 > 5) break; }
}

// ======================================================================
// Животные
// ======================================================================
const spModels = new Map();
function spawnCreature(c, cx, cz) {
  const P = W.P, sp = P.species[c.sp];
  const key = P.id + ':' + sp.idx;
  if (!spModels.has(key)) spModels.set(key, speciesModel(sp));
  const tpl = spModels.get(key), g = tpl.clone(true);
  // клон сохраняет ссылки на конечности
  const src = [], dst = []; tpl.traverse(o => src.push(o)); g.traverse(o => dst.push(o));
  const pick = (arr) => arr.map(o => dst[src.indexOf(o)]);
  g.userData = { legs: pick(tpl.userData.legs), wings: pick(tpl.userData.wings), segs: pick(tpl.userData.segs), body: dst[src.indexOf(tpl.userData.body)], top: tpl.userData.top };
  W.scene.add(g);
  const cr = { id: c.id, sp, g, cx, cz, x: c.x, z: c.z, hx: c.x, hz: c.z, y: 0, heading: Math.random() * 6.28, speed: 0, state: 'idle', t: Math.random() * 3, phase: Math.random() * 6, hp: sp.hp, alt: sp.plan === 'flyer' ? 8 + Math.random() * 14 : 0, atk: 0, tx: c.x, tz: c.z, dying: 0 };
  W.creatures.set(c.id, cr);
}
function creatureTick(cr, dt) {
  const P = W.P, sp = cr.sp, ox = W.origin[0], oz = W.origin[1];
  const px = W.pos.x + ox, pz = W.pos.z + oz, dx = px - cr.x, dz = pz - cr.z, dP = Math.hypot(dx, dz);
  if (cr.dying) {
    cr.dying += dt; cr.g.rotation.z = Math.min(1.5, cr.dying * 2);
    cr.g.position.y = cr.y - Math.max(0, cr.dying - 1) * 0.6;
    if (cr.dying > 3) { W.scene.remove(cr.g); W.creatures.delete(cr.id); }
    return;
  }
  cr.t -= dt;
  const hostile = sp.temper === 'predator' ? dP < 32 : sp.temper === 'territorial' ? dP < 10 || cr.angry > 0 : cr.angry > 0 && sp.dmg > 0;
  if (cr.state === 'friendly') { if (dP > 6) { cr.tx = px - dx / dP * 4; cr.tz = pz - dz / dP * 4; cr.speed = sp.speed * 0.8; } else cr.speed = 0; }
  else if (hostile && cr.hp > sp.hp * 0.3 && W.hp > 0) {
    cr.state = 'chase'; cr.tx = px; cr.tz = pz; cr.speed = sp.speed * 1.3;
    const reach = 1.6 + sp.size * 0.6;
    if (dP < reach && (sp.plan !== 'flyer' || Math.abs(W.pos.y - (cr.y - PG.height(P, cr.x, cr.z))) < 6)) {
      cr.speed = 0; cr.atk -= dt;
      if (cr.atk <= 0) { cr.atk = 1.2; hurt(sp.dmg, sp.name); }
    }
    if (cr.angry > 0) cr.angry -= dt;
  } else if ((sp.temper === 'skittish' && dP < 14) || cr.fear > 0) {
    cr.state = 'flee'; cr.tx = cr.x - dx / (dP || 1) * 20; cr.tz = cr.z - dz / (dP || 1) * 20; cr.speed = sp.speed * 1.6;
    if (cr.fear > 0) cr.fear -= dt;
  } else if (cr.t <= 0) {
    cr.t = 3 + Math.random() * 6;
    if (Math.random() < 0.55) { cr.state = 'walk'; const a = Math.random() * 6.28, d = 6 + Math.random() * 20; cr.tx = cr.hx + Math.cos(a) * d; cr.tz = cr.hz + Math.sin(a) * d; cr.speed = sp.speed * 0.5; }
    else { cr.state = 'idle'; cr.speed = 0; }
  }
  // движение к цели
  const tx = cr.tx - cr.x, tz = cr.tz - cr.z, td = Math.hypot(tx, tz);
  if (td > 0.5 && cr.speed > 0) {
    const want = Math.atan2(tx, tz); let dh = want - cr.heading; while (dh > Math.PI) dh -= 6.283; while (dh < -Math.PI) dh += 6.283;
    cr.heading += clamp(dh, -dt * 3, dt * 3);
    const v = Math.min(cr.speed, td * 2);
    const nx = cr.x + Math.sin(cr.heading) * v * dt, nz = cr.z + Math.cos(cr.heading) * v * dt;
    if (sp.plan === 'flyer' || P.liquidY === null || PG.height(P, nx, nz) > P.liquidY + 0.2) { cr.x = nx; cr.z = nz; }
    cr.phase += v * dt * 3.2 / Math.max(0.5, sp.size);
  } else if (cr.state !== 'chase' && cr.state !== 'friendly') { cr.speed = 0; if (cr.state !== 'idle') cr.state = 'idle'; }
  const gh = PG.height(P, cr.x, cr.z);
  cr.y = gh + (sp.plan === 'flyer' ? cr.alt + Math.sin(W.t * 0.8 + cr.phase) * 1.5 : 0);
  if (sp.plan === 'flyer' && P.liquidY !== null) cr.y = Math.max(cr.y, P.liquidY + cr.alt);
  cr.g.position.set(cr.x - ox, cr.y, cr.z - oz);
  cr.g.rotation.y = cr.heading;
  // анимация
  const u = cr.g.userData, moving = cr.speed > 0.1, sw = moving ? Math.sin(cr.phase) : 0;
  u.legs.forEach((l, i) => { l.rotation.x = sw * 0.6 * (i % 2 ? 1 : -1) * (sp.plan === 'hopper' ? 0 : 1); });
  if (sp.plan === 'hopper' && moving) u.body.position.y = Math.abs(Math.sin(cr.phase * 0.7)) * sp.size * 0.6;
  else u.body.position.y = moving ? Math.abs(sw) * sp.size * 0.04 : Math.sin(W.t * 1.5 + cr.phase) * sp.size * 0.01;
  u.wings.forEach((w, i) => { w.rotation.z = Math.sin(W.t * 9 + cr.phase) * 0.7 * (i ? -1 : 1); });
  u.segs.forEach((s, i) => { s.position.x = Math.sin(cr.phase - i * 0.8) * sp.size * 0.12; });
  if (sp.plan === 'blob') u.body.scale.y = 1 + Math.sin(W.t * 4 + cr.phase) * 0.08 * (moving ? 2 : 1);
}
function hurtCreature(cr, dmg) {
  if (cr.dying) return;
  cr.hp -= dmg;
  if (cr.sp.dmg > 0) cr.angry = 10; else cr.fear = 6;
  if (cr.state === 'friendly') cr.state = 'flee';
  if (cr.hp <= 0) {
    cr.dying = 0.01; W.dead.add(cr.id);
    ctx.send({ t: 'hunt', id: cr.id, x: cr.x, z: cr.z });
    // смотрители не любят охотников
    if (W.P.sentinels !== 'none' && (W.P.sentinels === 'high' || W.sentinels.some(s => Math.hypot(s.x - cr.x, s.z - cr.z) < 80))) raiseWanted('Смотрители видели охоту');
  }
}

// ======================================================================
// Смотрители
// ======================================================================
const SENT_MAX = { none: 0, low: 1, normal: 2, high: 3 };
let sentGeo = null;
function sentinelModel() {
  const g = new THREE.Group();
  if (!sentGeo) sentGeo = { body: new THREE.SphereGeometry(0.6, 14, 10), ring: new THREE.TorusGeometry(0.75, 0.08, 6, 20), eye: new THREE.SphereGeometry(0.18, 8, 6) };
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.85, roughness: 0.35 });
  const b = new THREE.Mesh(sentGeo.body, metal); b.scale.set(1, 0.7, 1.2); b.castShadow = true; g.add(b);
  const ring = new THREE.Mesh(sentGeo.ring, metal); ring.rotation.x = Math.PI / 2; g.add(ring);
  const eye = new THREE.Mesh(sentGeo.eye, new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.6, 0.3) })); eye.position.z = 0.65; g.add(eye);
  g.userData.eye = eye;
  return g;
}
function sentinelTick(dt) {
  const P = W.P, max = SENT_MAX[P.sentinels] || 0, ox = W.origin[0], oz = W.origin[1];
  const px = W.pos.x + ox, pz = W.pos.z + oz;
  const want = Math.min(6, max + W.wanted * (W.wanted ? 1 : 0));
  while (W.sentinels.length < want) {
    const a = Math.random() * 6.28, d = W.wanted ? 70 : 40 + Math.random() * 60;
    const s = { g: sentinelModel(), x: px + Math.cos(a) * d, z: pz + Math.sin(a) * d, y: 0, hp: 80, cd: 1 + Math.random(), a: Math.random() * 6, hostile: !!W.wanted };
    W.scene.add(s.g); W.sentinels.push(s);
  }
  for (const s of [...W.sentinels]) {
    const dx = px - s.x, dz = pz - s.z, d = Math.hypot(dx, dz);
    if (d > 260) { W.scene.remove(s.g); W.sentinels.splice(W.sentinels.indexOf(s), 1); continue; }
    s.hostile = W.wanted > 0 && d < 140;
    let tx, tz;
    if (s.hostile) { tx = px - dx / d * 12; tz = pz - dz / d * 12; W.wantedSeen = W.t; }
    else { s.a += dt * 0.15; tx = px + Math.cos(s.a) * 45; tz = pz + Math.sin(s.a) * 45; }
    const mx = tx - s.x, mz = tz - s.z, md = Math.hypot(mx, mz), v = s.hostile ? 11 : 4;
    if (md > 0.5) { s.x += mx / md * Math.min(md, v * dt); s.z += mz / md * Math.min(md, v * dt); }
    s.y = PG.height(P, s.x, s.z) + (s.hostile ? 6 : 9) + Math.sin(W.t * 2 + s.a) * 0.5;
    s.g.position.set(s.x - ox, s.y, s.z - oz);
    s.g.lookAt(W.pos.x, W.pos.y + 1.2, W.pos.z);
    s.g.userData.eye.material.color.setRGB(s.hostile ? 2.5 : 2, s.hostile ? 0.3 : 1.6, 0.3);
    if (s.hostile && d < 60) {
      s.cd -= dt;
      if (s.cd <= 0) {
        s.cd = 1.4 + Math.random() * 0.6;
        laserFx(s.g.position, new THREE.Vector3(W.pos.x, W.pos.y + 1.1, W.pos.z), [2.2, 0.4, 0.2]);
        if (Math.random() < 0.8) hurt(5 + W.wanted * 2 + (P.sentinels === 'high' ? 3 : 0), 'Смотритель');
        ctx.sound && ctx.sound.laser && ctx.sound.laser(0.25);
      }
    }
  }
  // розыск снимается, если смотрители давно не видели игрока или все уничтожены
  if (W.wanted && W.t - W.wantedSeen > 25) { W.wanted = 0; ctx.note('Смотрители потеряли вас из виду', 'good'); }
}
function raiseWanted(why) {
  if (W.P.sentinels === 'none') return;
  W.wanted = Math.min(3, W.wanted + 1); W.wantedSeen = W.t;
  ctx.note(`⚠ ${why}: розыск ${'★'.repeat(W.wanted)}`, 'bad');
  ctx.sound && ctx.sound.alarm && ctx.sound.alarm();
}
const lasers = [];
function laserFx(a, b, c) {
  const d = b.clone().sub(a), L = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, L, 5, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(...c), transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  W.scene.add(m); lasers.push({ m, t: 0.18 });
}

// ======================================================================
// Здоровье и костюм
// ======================================================================
function hurt(dmg, from) {
  if (W.hp <= 0) return;
  W.hp = Math.max(0, W.hp - dmg); W.lastHurt = W.t;
  const f = $('#sf-hurt'); if (f) { f.style.opacity = 0.6; setTimeout(() => { if (f) f.style.opacity = 0; }, 160); }
  if (W.hp <= 0) die(from);
}
function die(from) {
  ctx.note(`Вы погибли (${from}). Половина ресурсов костюма потеряна. Возрождение у корабля.`, 'bad');
  fade(1, 0.6);
  ctx.send({ t: 'surfDeath' });
}

// ======================================================================
// Ввод
// ======================================================================
export function onKey(e, down) {
  if (!W) return false;
  const k = e.code;
  if (down) W.keys.add(k); else W.keys.delete(k);
  if (!down) return true;
  if (k === 'KeyE') interact();
  else if (k === 'KeyF') scan();
  else if (k === 'Tab' || k === 'KeyI') { e.preventDefault(); togglePanel('suit'); }
  else if (k === 'KeyV') W.camDist = W.camDist > 0.5 ? 0 : 4.5;
  else if (k === 'Digit1') useItem('res_oxygen');
  else if (k === 'Digit2') useItem('res_sodium');
  else if (k === 'Digit3') useItem('surf_kit');
  return true;
}
export function onMouseMove(dx, dy) { if (!W || !W.locked) return; W.yaw -= dx * 0.0025; W.pitch = clamp(W.pitch - dy * 0.0025, -1.3, 1.1); }
export function onMouse(btn, down) { if (!W) return; if (btn === 0) W.firing = down; }
export function onWheel(d) { if (!W) return; W.camDist = clamp(W.camDist + d * 0.004, 0, 10); }
export function setLocked(v) { if (W) W.locked = v; const h = $('#sf-lockhint'); if (h) h.style.display = v || !W ? 'none' : ''; }
// сенсорное управление (телефон)
export function touchMove(x, y) { if (!W) return; W.touch = { x, y }; }
export function touchLook(dx, dy) { if (!W) return; W.yaw -= dx * 0.006; W.pitch = clamp(W.pitch - dy * 0.006, -1.3, 1.1); }
export function touchBtn(b, down) {
  if (!W) return;
  if (b === 'jump') { if (down) W.keys.add('Space'); else W.keys.delete('Space'); }
  else if (b === 'fire') W.firing = down;
  else if (down && b === 'use') interact();
  else if (down && b === 'scan') scan();
  else if (down && b === 'suit') togglePanel('suit');
}

function useItem(item) {
  const need = item === 'res_oxygen' ? Math.ceil(100 - W.ls) : item === 'res_sodium' ? Math.ceil(100 - W.hz) : 1;
  if (item !== 'surf_kit' && need < 1) return ctx.note(item === 'res_oxygen' ? 'Жизнеобеспечение полное' : 'Защита полная', 'info');
  ctx.send({ t: 'suitState', hp: W.hp, ls: W.ls, hz: W.hz });
  ctx.send({ t: 'suitUse', item, need });
}

function interact() {
  const it = nearestInteract();
  if (!it) return;
  if (it.kind === 'ship') togglePanel('ship');
  else if (it.kind === 'creature') ctx.send({ t: 'feed', id: it.cr.id, x: it.cr.x, z: it.cr.z });
  else if (it.kind === 'node') { ctx.send({ t: 'harvest', id: it.node.id }); }
}
function nearestInteract() {
  const ox = W.origin[0], oz = W.origin[1], px = W.pos.x + ox, pz = W.pos.z + oz;
  if (Math.hypot(W.pos.x, W.pos.z) < W.shipR + 4) return { kind: 'ship', label: 'Корабль: взлёт, трюм, крафт' };
  for (const ch of W.chunks.values()) for (const n of ch.nodes) if (PG.NODES[n.kind].use && !W.taken.has(n.id) && !W.depleted.has(n.id) && Math.hypot(n.x - px, n.z - pz) < 4) return { kind: 'node', node: n, label: n.kind === 'capsule' ? 'Открыть аварийную капсулу' : 'Вскрыть грузовой контейнер' };
  for (const cr of W.creatures.values()) if (!cr.dying && cr.sp.temper !== 'predator' && Math.hypot(cr.x - px, cr.z - pz) < 3.5 + cr.sp.size * 0.6) return { kind: 'creature', cr, label: `Покормить: ${cr.sp.name} (${cr.sp.diet === 'Плотоядное' ? 'мясо' : '10 углерода'})` };
  return null;
}

function scan() {
  if (W.t - W.scanT < 4) return;
  W.scanT = W.t; W.scanUntil = W.t + 16;
  const ox = W.origin[0], oz = W.origin[1], px = W.pos.x + ox, pz = W.pos.z + oz;
  const list = [];
  for (const ch of W.chunks.values()) for (const n of ch.nodes) {
    if (W.depleted.has(n.id) || W.taken.has(n.id)) continue;
    if (!['oxygen', 'sodium', 'dihydro', 'special', 'metal', 'capsule', 'crate', 'boulder'].includes(n.kind)) continue;
    const d = Math.hypot(n.x - px, n.z - pz); if (d < 160) list.push({ n, d });
  }
  list.sort((a, b) => a.d - b.d);
  W.markers = list.slice(0, 26).map(({ n }) => ({ n, el: null }));
  ctx.sound && ctx.sound.beep && ctx.sound.beep(600, 1200, 0.12);
  const sp = new Set(); for (const cr of W.creatures.values()) if (Math.hypot(cr.x - px, cr.z - pz) < 90) sp.add(cr.sp.idx);
  ctx.note(`Сканер: ресурсов рядом — ${list.length}, видов животных — ${sp.size}. Наведите прицел на животное, чтобы изучить вид.`, 'info');
}

// ======================================================================
// Ответы сервера
// ======================================================================
const ITEM = (id) => (ctx.data.items[id] || { name: id }).name;
export function onServer(m) {
  if (!W) return;
  switch (m.t) {
    case 'harvested':
      W.suit = m.suit;
      if (m.ok) { W.depleted.add(m.id); hideNode(m.id); if (m.use) W.taken.add(m.id); if (m.amount) pickup(m.item, m.amount); if (m.bonus) pickup('res_ferrite', m.bonus); if (m.lost) ctx.note(`Костюм заполнен: ${m.lost} ед. потеряно. Перенесите ресурсы в трюм (Tab)`, 'warn'); }
      else if (m.full) ctx.note('Костюм полон — перенесите ресурсы в трюм корабля (Tab у корабля) или выбросьте лишнее', 'warn');
      break;
    case 'hunted': W.suit = m.suit; if (m.meat) pickup('bio_meat', m.meat); if (m.hide) pickup('bio_hide', m.hide); break;
    case 'fed': {
      W.suit = m.suit; const cr = W.creatures.get(m.id);
      if (cr) { cr.state = 'friendly'; cr.angry = 0; cr.fear = 0; heart(cr); }
      if (m.gel) pickup('bio_gel', m.gel);
      ctx.note(`${cr ? cr.sp.name : 'Животное'} доволен и теперь ходит за вами. Подарок: биоматериал ×${m.gel}`, 'good');
      break;
    }
    case 'discovered': {
      W.disc.add(m.idx); const sp = W.P.species[m.idx];
      showDiscovery(sp, m);
      break;
    }
    case 'suit': W.suit = m.suit; W.ls = m.suit.ls; W.hz = m.suit.hz; W.hp = m.suit.hp; break;
    case 'surfRespawn':
      W.suit = m.suit; W.hp = 100; W.ls = m.suit.ls; W.hz = m.suit.hz; W.wanted = 0;
      W.pos.set(W.shipR + 3, PG.height(W.P, W.origin[0] + W.shipR + 3, W.origin[1] + 2) + 0.5, 2); W.vel.set(0, 0, 0);
      setTimeout(() => fade(0, 1), 400);
      if (m.lost && m.lost.length) ctx.note('Потеряно: ' + m.lost.join(', '), 'bad');
      break;
    case 'takeoffFuel': W.outro = 0; W.outroSent = false; W.ship.position.y = PG.height(W.P, W.origin[0], W.origin[1]); W.player.g.visible = true; setEngineGlow(0); fade(0, 0.5); W.panel = 'nofuel'; renderPanel(); break;
  }
  if (W.panel) renderPanel();
}
function pickup(item, n) {
  W.picks.unshift({ text: `+${n} ${ITEM(item)}`, t: W.t });
  if (W.picks.length > 6) W.picks.length = 6;
  ctx.sound && ctx.sound.beep && ctx.sound.beep(900, 1400, 0.05);
}
function heart(cr) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff6080, transparent: true }));
  s.scale.setScalar(0.6); s.position.set(0, cr.sp.size * 1.8 + 1, 0); cr.g.add(s);
  setTimeout(() => cr.g.remove(s), 2500);
}
function showDiscovery(sp, m) {
  const el = $('#sf-disc'); if (!el) return;
  el.innerHTML = `<div class="sd-h">Новый вид открыт</div><div class="sd-n">${sp.name}</div>
    <div class="sd-k">${sp.planName} · ${sp.temperName} · ${sp.diet} · рост ${sp.height || sp.size} м · ${'◆'.repeat(sp.rarity)}</div>
    <div class="sd-r">+${fmt(m.reward)} ISK${m.bonus ? ` · все виды планеты изучены: +${fmt(m.bonus)} ISK` : ''} · ${m.count}/${m.total}</div>`;
  el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 5500);
  ctx.sound && ctx.sound.beep && ctx.sound.beep(700, 1500, 0.14);
}

// ======================================================================
// Кадр
// ======================================================================
const ray = new THREE.Raycaster(), V = new THREE.Vector3(), V2 = new THREE.Vector3();
export function frame(dt, nowMs) {
  if (!W) return;
  dt = Math.min(dt, 0.1); W.t += dt; W.dt = dt;
  const P = W.P, ox = W.origin[0], oz = W.origin[1], serverNow = ctx.serverNow() + (W.timeOff || 0); // timeOff — только для отладки
  updateChunks();
  document.body.classList.toggle('sf-cine', W.intro > 0 || W.outro > 0); // ролики посадки и взлёта — без интерфейса

  // ---------- время суток и погода ----------
  const phase = PG.dayPhase(P, serverNow), ang = (phase - 0.25) * Math.PI * 2;
  const sunDir = V2.set(Math.cos(ang) * 0.85, Math.sin(ang), 0.35).normalize();
  const storm = PG.storm(P, serverNow);
  const dayK = clamp((sunDir.y + 0.12) / 0.35, 0, 1);
  W.sky.material.uniforms.sunDir.value.copy(sunDir); W.sky.material.uniforms.storm.value = storm;
  W.sun.position.copy(W.pos).addScaledVector(sunDir, 200); W.sun.target.position.copy(W.pos);
  W.sun.intensity = 3.1 * dayK * (1 - storm * 0.6);
  W.moon.position.set(-sunDir.x, Math.abs(sunDir.y) + 0.3, -sunDir.z).multiplyScalar(100).add(W.pos); W.moon.target.position.copy(W.pos); W.moon.intensity = 0.55 * (1 - dayK);
  W.hemi.intensity = 0.32 + 0.6 * dayK; // ночью темно, но не непроглядно
  const fogC = col(P.pal.fog).multiplyScalar(0.12 + 0.88 * dayK * (1 - storm * 0.5));
  W.scene.fog.color.copy(fogC); W.scene.fog.density = P.fog * (1 + storm * 3.5);
  W.sky.position.copy(W.cam.position);
  if (storm > 0.3 && W.stormWas <= 0.3) { ctx.note(`⚠ ${P.stormName}! ${P.hz ? 'Защита костюма тратится втрое быстрее.' : 'Видимость падает.'} Укрыться можно у корабля.`, 'bad'); ctx.sound && ctx.sound.alarm && ctx.sound.alarm(); }
  W.stormWas = storm;
  const night = dayK < 0.2;
  if (W.nightWas !== null && night !== W.nightWas) ctx.note(night ? 'Наступает ночь' + (P.hz === 'cold' ? ' — холодает, защита тратится быстрее' : '') : 'Рассвет', 'info');
  W.nightWas = night;
  // частицы
  const wp = W.weather.geometry.attributes.position, fall = { frozen: 2, desert: 0.5, barren: 0.4, volcanic: -1.2, irradiated: 0.3, exotic: 0.2 }[P.biome] ?? 9;
  for (let i = 0; i < wp.count; i++) {
    let y = wp.getY(i) - fall * dt * (P.biome === 'lush' || P.biome === 'ocean' || P.biome === 'toxic' ? 1.5 : 1), x = wp.getX(i) + (P.biome === 'desert' || P.biome === 'barren' ? 8 * dt * (0.3 + storm) : 0);
    if (y < -10) y += 30; if (y > 20) y -= 30; if (x > 30) x -= 60;
    wp.setX(i, x); wp.setY(i, y);
  }
  wp.needsUpdate = true;
  W.weather.position.set(W.pos.x, W.pos.y, W.pos.z);
  W.weather.material.opacity = 0.12 + storm * 0.8;
  if (W.liquid) { W.liquid.position.set(W.pos.x, P.liquidY, W.pos.z); if (P.liquid === 'lava') W.liquid.material.color.setRGB(1.6 + Math.sin(W.t * 1.3) * 0.2, 0.55, 0.08); }

  // ---------- посадка: корабль опускается ----------
  if (W.intro > 0) {
    W.intro -= dt;
    const k = Math.max(0, W.intro / 3.2);
    W.ship.position.y = PG.height(P, ox, oz) + k * k * 90;
    W.cam.position.set(18, W.ship.position.y + 6 + k * 10, 26); W.cam.lookAt(0, W.ship.position.y + 2, 0);
    W.player.g.visible = false;
    setEngineGlow(1);
    R.renderOther(W.scene, W.cam);
    if (W.intro <= 0) { W.player.g.visible = true; setEngineGlow(0); ctx.note('Вы вышли из корабля. WASD — идти, Shift — бег, Пробел — прыжок и ранец, ЛКМ — мультитул, F — сканер, E — действие, Tab — костюм', 'info'); }
    return;
  }
  // ---------- взлёт: корабль поднимается ----------
  if (W.outro > 0) {
    W.outro += dt;
    W.ship.position.y = PG.height(P, ox, oz) + W.outro * W.outro * 12;
    W.cam.position.set(20, PG.height(P, ox, oz) + 8 + W.outro * 6, 28); W.cam.lookAt(0, W.ship.position.y, 0);
    setEngineGlow(1);
    R.renderOther(W.scene, W.cam);
    if (W.outro > 2.6 && !W.outroSent) { W.outroSent = true; fade(1, 0.4); ctx.send({ t: 'takeoff' }); }
    return;
  }

  // ---------- игрок ----------
  const lv = W.suit.lv || { tool: 1, jet: 1 };
  const g = 9.8 * P.gravity * 0.8;
  const fwd = new THREE.Vector3(-Math.sin(W.yaw), 0, -Math.cos(W.yaw));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  let mx = 0, mz = 0;
  if (W.keys.has('KeyW')) mz += 1; if (W.keys.has('KeyS')) mz -= 1; if (W.keys.has('KeyD')) mx += 1; if (W.keys.has('KeyA')) mx -= 1;
  if (W.touch) { mx += W.touch.x; mz += W.touch.y; }
  const ml = Math.hypot(mx, mz) || 1, moving = Math.abs(mx) + Math.abs(mz) > 0.05;
  // физика — фиксированный шаг 1/60 с, отображение интерполируется между шагами (плавно при любом FPS)
  const STEP = 1 / 60;
  if (!W.prevPos || W.prevPos.distanceToSquared(W.pos) > 400) { W.prevPos = W.pos.clone(); W.rpos = W.pos.clone(); W.acc = 0; }
  W.acc = Math.min((W.acc || 0) + dt, STEP * 8);
  let jetting = false;
  while (W.acc >= STEP) {
    const h = STEP; W.acc -= STEP;
    W.prevPos.copy(W.pos);
    const sprint = (W.keys.has('ShiftLeft') || W.keys.has('ShiftRight')) && W.stamina > 0.05 && moving;
    W.stamina = clamp(W.stamina + (sprint ? -0.28 : 0.16) * h, 0, 1);
    const inLiquid = P.liquidY !== null && P.liquid !== 'ice' && W.pos.y < P.liquidY - 0.6;
    const speed = inLiquid ? 2.6 : sprint ? 8.5 : 5;
    const wish = new THREE.Vector3().addScaledVector(fwd, mz / ml).addScaledVector(right, mx / ml).multiplyScalar(moving ? speed : 0);
    const accel = W.ground || inLiquid ? 12 : 3;
    W.vel.x += (wish.x - W.vel.x) * Math.min(1, accel * h); W.vel.z += (wish.z - W.vel.z) * Math.min(1, accel * h);
    // прыжок и ранец
    jetting = W.keys.has('Space') && !W.ground && W.jet > 0.01 && !inLiquid;
    if (W.keys.has('Space') && W.ground && !W.jumpHeld) { W.vel.y = 5.2; W.ground = false; }
    W.jumpHeld = W.keys.has('Space') && W.ground;
    if (jetting) { W.vel.y = Math.min(W.vel.y + (g + 16) * h, 8.5); W.jet = Math.max(0, W.jet - h * (lv.jet >= 2 ? 0.16 : 0.32)); }
    else if (W.ground) W.jet = Math.min(1, W.jet + h * 0.45);
    if (inLiquid) { W.vel.y += (P.liquidY - 1.1 - W.pos.y) * 4 * h; W.vel.y *= 0.9; }
    else W.vel.y -= g * h;
    W.pos.addScaledVector(W.vel, h);
    // столкновения с деревьями и валунами
    const qx = W.pos.x + ox, qz = W.pos.z + oz;
    for (const ch of W.chunks.values()) {
      if (Math.abs((ch.cx + 0.5) * CH - qx) > CH || Math.abs((ch.cz + 0.5) * CH - qz) > CH) continue;
      for (const n of ch.nodes) {
        if (W.depleted.has(n.id) || !(n.kind === 'tree' || n.kind === 'boulder' || n.kind === 'metal')) continue;
        const rr = (n.kind === 'tree' ? 0.5 : n.kind === 'metal' ? 2.6 : 2.2) * n.s, ddx = qx - n.x, ddz = qz - n.z, dd = Math.hypot(ddx, ddz);
        if (dd < rr && dd > 0.001) { W.pos.x += ddx / dd * (rr - dd); W.pos.z += ddz / dd * (rr - dd); }
      }
    }
    const sr = W.shipR * 0.55; if (Math.hypot(W.pos.x, W.pos.z) < sr && W.pos.y < PG.height(P, ox, oz) + 4) { const d = Math.hypot(W.pos.x, W.pos.z) || 1; W.pos.x *= sr / d; W.pos.z *= sr / d; }
    const gh = PG.height(P, W.pos.x + ox, W.pos.z + oz);
    const floor = P.liquid === 'ice' && P.liquidY !== null ? Math.max(gh, P.liquidY) : gh;
    if (W.pos.y <= floor) { if (!W.ground && W.vel.y < -14) hurt(Math.round((-W.vel.y - 14) * 4), 'падение'); W.pos.y = floor; W.vel.y = Math.max(0, W.vel.y); W.ground = true; }
    else if (W.pos.y > floor + 0.15) W.ground = false;
    // лава и кислота
    if (P.liquidY !== null && W.pos.y < P.liquidY + 0.2 && (P.liquid === 'lava' || P.liquid === 'acid')) { hurt((P.liquid === 'lava' ? 30 : 8) * h, P.liquid === 'lava' ? 'лава' : 'кислота'); if (P.liquid === 'lava') W.vel.y = Math.max(W.vel.y, 4); }
  }
  W.player.jets.forEach(j => { j.visible = jetting; j.scale.y = 0.8 + Math.random() * 0.5; });
  W.rpos.lerpVectors(W.prevPos, W.pos, W.acc / STEP);
  const pxw = W.pos.x + ox, pzw = W.pos.z + oz;

  // модель игрока
  const pg = W.player.g;
  pg.position.copy(W.rpos);
  const hv = Math.hypot(W.vel.x, W.vel.z);
  if (hv > 0.3) pg.rotation.y = Math.atan2(W.vel.x, W.vel.z);
  else if (W.firing) pg.rotation.y = W.yaw + Math.PI;
  W.walkPh = (W.walkPh || 0) + hv * dt * 2.2;
  W.player.legs.forEach((l, i) => { l.rotation.x = W.ground ? Math.sin(W.walkPh) * 0.7 * Math.min(1, hv / 4) * (i ? 1 : -1) : -0.3; });
  W.player.arms[0].rotation.x = W.ground ? -Math.sin(W.walkPh) * 0.5 * Math.min(1, hv / 4) : -0.5;
  W.player.arms[1].rotation.x = W.firing ? -1.45 : W.ground ? Math.sin(W.walkPh) * 0.5 * Math.min(1, hv / 4) : -0.5;
  pg.visible = W.camDist > 0.6;

  // камера: из-за плеча (или от первого лица)
  const cp = Math.cos(W.pitch);
  const look = new THREE.Vector3(-Math.sin(W.yaw) * cp, Math.sin(W.pitch), -Math.cos(W.yaw) * cp);
  const head = new THREE.Vector3(W.rpos.x, W.rpos.y + 1.65, W.rpos.z);
  const shoulder = head.clone().addScaledVector(right, W.camDist > 0.6 ? 0.55 : 0);
  W.cam.position.copy(shoulder).addScaledVector(look, -W.camDist);
  const ch2 = PG.height(P, W.cam.position.x + ox, W.cam.position.z + oz) + 0.4;
  if (W.cam.position.y < ch2) W.cam.position.y = ch2;
  W.cam.lookAt(shoulder.clone().addScaledVector(look, 30));
  W.cam.aspect = innerWidth / innerHeight; W.cam.fov = (R.getGfx().fov || 60) + 10; W.cam.updateProjectionMatrix();

  // ---------- мультитул ----------
  if (!W.firing || W.overheat > 0) W.heat = Math.max(0, W.heat - dt * 0.45);
  if (W.overheat > 0) W.overheat -= dt;
  ray.setFromCamera({ x: 0, y: 0 }, W.cam); ray.far = 60;
  let hit = null;
  const objs = [];
  for (const chk of W.chunks.values()) if (Math.abs((chk.cx + 0.5) * CH - pxw) < CH * 1.2 && Math.abs((chk.cz + 0.5) * CH - pzw) < CH * 1.2) for (const m of chk.meshes) if (m.userData.nodes) objs.push(m);
  for (const cr of W.creatures.values()) if (!cr.dying && Math.hypot(cr.x - pxw, cr.z - pzw) < 60) { cr.g.userData.cr = cr; objs.push(cr.g); }
  for (const s of W.sentinels) { s.g.userData.sent = s; objs.push(s.g); }
  const hits = ray.intersectObjects(objs, true);
  for (const h of hits) {
    if (h.point.distanceTo(W.pos) > 38) continue;
    let o = h.object;
    if (o.isInstancedMesh && o.userData.nodes) { const n = o.userData.nodes[h.instanceId]; if (n && !W.depleted.has(n.id)) { hit = { kind: 'node', n, point: h.point }; break; } continue; }
    while (o && !o.userData.cr && !o.userData.sent) o = o.parent;
    if (o && o.userData.cr) { hit = { kind: 'cr', cr: o.userData.cr, point: h.point }; break; }
    if (o && o.userData.sent) { hit = { kind: 'sent', s: o.userData.sent, point: h.point }; break; }
  }
  W.target = hit;
  const canFire = W.firing && W.overheat <= 0 && W.hp > 0 && !W.panel;
  const toolK = [1, 1, 1.6, 2.4][lv.tool] || 1;
  W.player.tip.getWorldPosition(V);
  if (canFire) {
    W.heat += dt * 0.16;
    if (W.heat >= 1) { W.overheat = 3; W.heat = 1; ctx.note('Мультитул перегрелся!', 'warn'); }
    const end = hit ? hit.point : W.cam.position.clone().addScaledVector(ray.ray.direction, 30);
    const d = end.clone().sub(V), L = d.length();
    W.beam.visible = true; W.beam.scale.set(1, L, 1); W.beam.position.copy(V).addScaledVector(d, 0.5); W.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    W.spark.visible = !!hit; if (hit) { W.spark.position.copy(hit.point); W.spark.scale.setScalar(0.6 + Math.random() * 0.8); }
    if (!W.mineSnd || W.t - W.mineSnd > 0.9) { W.mineSnd = W.t; ctx.sound && ctx.sound.mine && ctx.sound.mine(0.12, 0.9); }
    if (hit && hit.kind === 'node' && !PG.NODES[hit.n.kind].use) {
      if (W.mineT !== hit.n.id) { W.mineT = hit.n.id; W.mineP = 0; }
      W.mineP += dt * toolK / PG.NODES[hit.n.kind].t;
      if (W.mineP >= 1) {
        W.mineP = 0; W.mineT = null;
        ctx.send({ t: 'harvest', id: hit.n.id });
        if (hit.n.kind === 'metal' && (P.sentinels === 'high' || (P.sentinels === 'normal' && Math.random() < 0.35))) raiseWanted('Смотрители охраняют рудные жилы');
      }
    } else if (hit && hit.kind === 'cr') hurtCreature(hit.cr, 26 * toolK * dt);
    else if (hit && hit.kind === 'sent') {
      hit.s.hp -= 30 * toolK * dt;
      if (!W.wanted) raiseWanted('Вы атаковали смотрителя');
      if (hit.s.hp <= 0) { W.scene.remove(hit.s.g); W.sentinels.splice(W.sentinels.indexOf(hit.s), 1); ctx.send({ t: 'sentinelKill' }); ctx.sound && ctx.sound.boom && ctx.sound.boom(0.3, false); if (!W.sentinels.some(s => s.hostile)) W.wantedSeen = W.t - 20; }
    }
  } else { W.beam.visible = false; W.spark.visible = false; if (!W.firing) { W.mineT = null; W.mineP = Math.max(0, W.mineP - dt); } }

  // анализ вида: прицел на животном 1.2 с
  if (hit && hit.kind === 'cr') {
    if (W.analyze.id !== hit.cr.id) W.analyze = { id: hit.cr.id, t: 0 };
    W.analyze.t += dt;
    if (W.analyze.t > 1.2 && !W.disc.has(hit.cr.sp.idx) && !W.analyze.sent) { W.analyze.sent = true; ctx.send({ t: 'discover', idx: hit.cr.sp.idx }); }
  } else W.analyze = { id: null, t: 0 };

  // ---------- существа и смотрители ----------
  for (const cr of [...W.creatures.values()]) {
    const d = Math.hypot(cr.x - pxw, cr.z - pzw);
    cr.g.visible = d < 170;
    if (d < 190) creatureTick(cr, dt);
  }
  if (P.sentinels !== 'none') sentinelTick(dt);
  for (const l of [...lasers]) { l.t -= dt; l.m.material.opacity = Math.max(0, l.t / 0.18); if (l.t <= 0) { W.scene.remove(l.m); l.m.geometry.dispose(); lasers.splice(lasers.indexOf(l), 1); } }

  // ---------- костюм ----------
  const nearShip = Math.hypot(W.pos.x, W.pos.z) < W.shipR + 6;
  W.ls = Math.max(0, W.ls - dt * 100 / 480);
  if (P.hz) {
    const prot = (W.suit.lv || {})[P.hz] || 0, tempK = P.hz === 'cold' ? (night ? 1.5 : 0.8) : P.hz === 'heat' ? (night ? 0.6 : 1.3) : 1;
    const drain = P.hzK * tempK * (1 + storm * 2.5) * 100 / 200 / (1 + prot * 1.5);
    W.hz = nearShip ? Math.min(100, W.hz + dt * 6) : Math.max(0, W.hz - dt * drain);
  } else if (storm > 0.3) W.hz = Math.max(0, W.hz - dt * 0.25);
  else if (nearShip) W.hz = Math.min(100, W.hz + dt * 6);
  if (W.ls <= 0) hurt(2 * dt, 'нет кислорода');
  if (W.hz <= 0) hurt(2.5 * dt, P.hz ? PG.HAZARD_NAME[P.hz].toLowerCase() : 'буря');
  if (W.ls > 0 && W.hz > 0 && W.t - W.lastHurt > 5) W.hp = Math.min(100, W.hp + dt * 2);
  if (W.ls < 25 && W.t - W.lsWarned > 30) { W.lsWarned = W.t; ctx.note('Жизнеобеспечение ниже 25% — пополните кислородом (клавиша 1)', 'warn'); }
  if (P.hz && W.hz < 25 && W.t - W.hzWarned > 30) { W.hzWarned = W.t; ctx.note(`Защита от среды ниже 25% (${PG.HAZARD_NAME[P.hz].toLowerCase()}) — пополните натрием (клавиша 2) или вернитесь к кораблю`, 'warn'); }
  if (W.t - W.lastSync > 3) { W.lastSync = W.t; ctx.send({ t: 'suitState', hp: Math.round(W.hp), ls: Math.round(W.ls), hz: Math.round(W.hz) }); }
  if (W.t - W.lastPos > 0.25) { W.lastPos = W.t; ctx.send({ t: 'surfPos', p: [+(W.pos.x + ox).toFixed(1), +W.pos.y.toFixed(1), +(W.pos.z + oz).toFixed(1)] }); }

  // ---------- маяк корабля и кольцо сканера ----------
  W.shipBeacon.visible = Math.sin(W.t * 4) > 0;
  const sk = W.t - W.scanT;
  if (sk < 1.4) { W.ring.visible = true; W.ring.position.set(W.pos.x, W.pos.y + 0.3, W.pos.z); W.ring.scale.setScalar(2 + sk * 120); W.ring.material.opacity = (1 - sk / 1.4) * 0.8; } else W.ring.visible = false;

  R.renderOther(W.scene, W.cam);
  updateHud(storm, phase, dayK, nearShip);
}
function setEngineGlow(k) { W.ship.traverse(o => { if (o.userData.plume) o.scale.set(1, 0.3 + k, 1); }); }

// ======================================================================
// HUD поверхности
// ======================================================================
function buildHud() {
  const h = $('#surf-hud');
  h.innerHTML = `<div id="sf-fade"></div><div id="sf-hurt"></div>
    <div id="sf-info" class="panel"></div>
    <div id="sf-wanted"></div><div id="sf-compass"><span id="sf-ship-mark">▲ Корабль</span></div>
    <div id="sf-cross"></div><div id="sf-target"></div><div id="sf-prompt"></div>
    <div id="sf-bars" class="panel"></div>
    <div id="sf-picks"></div><div id="sf-disc"></div><div id="sf-markers"></div>
    <div id="sf-panel" class="panel hidden"></div>
    <div id="sf-lockhint">Щёлкните по экрану, чтобы управлять (мышь — обзор)</div>
    <div id="sf-touch"><div id="sf-stick"><i></i></div><div class="sf-tbtns"><button data-tb="fire">⚒</button><button data-tb="jump">⇧</button><button data-tb="use">E</button><button data-tb="scan">◎</button><button data-tb="suit">☰</button></div></div>`;
  h.onclick = (e) => {
    const b = e.target.closest('[data-sf]'); if (!b) return;
    const a = b.dataset.sf;
    if (a === 'close') togglePanel(null);
    else if (a === 'takeoff') { W.panel = null; renderPanel(); W.outro = 0.01; W.outroSent = false; W.player.g.visible = false; ctx.sound && ctx.sound.whoosh && ctx.sound.whoosh(0.5, true, 3); }
    else if (a === 'emergency') { W.panel = null; renderPanel(); W.outro = 2.7; W.outroSent = true; fade(1, 0.4); ctx.send({ t: 'takeoff', emergency: true }); }
    else if (a === 'use') useItem(b.dataset.item);
    else if (a === 'toship') ctx.send({ t: 'suitXfer', item: b.dataset.item, to: 'ship' });
    else if (a === 'allship') for (const k of Object.keys(W.suit.inv)) ctx.send({ t: 'suitXfer', item: k, to: 'ship' });
    else if (a === 'craft') ctx.send({ t: 'craft', recipe: b.dataset.r });
    else if (a === 'tab') { W.tab = b.dataset.tab; renderPanel(); }
  };
}
function togglePanel(name) {
  W.panel = W.panel === name || !name ? null : name;
  if (W.panel && document.pointerLockElement) document.exitPointerLock();
  renderPanel();
}
function renderPanel() {
  const el = $('#sf-panel'); if (!el) return;
  if (!W.panel) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const s = W.suit, used = Object.values(s.inv).reduce((a, b) => a + b, 0), near = Math.hypot(W.pos.x, W.pos.z) < Math.min(22, W.shipR + 8);
  const have = (k) => s.inv[k] || 0;
  if (W.panel === 'nofuel') {
    el.innerHTML = `<h3>Нет топлива для взлёта</h3><p>Нужно «Топливо взлёта» ×1 или ${40} ди-водорода (синие кристаллы). Ди-водорода в костюме: ${have('res_dihydro')}.</p>
      <p class="muted">Аварийный взлёт возможен, но двигатели перегрузятся: щит обнулится, броня и корпус пострадают.</p>
      <div class="btn2"><button data-sf="close">Остаться и добыть</button><button data-sf="emergency" class="danger">Аварийный взлёт</button></div>`;
    return;
  }
  const tab = W.tab || (W.panel === 'ship' ? 'ship' : 'inv');
  const tabs = [['inv', 'Костюм'], ['craft', 'Крафт'], ['disc', 'Открытия'], ...(W.panel === 'ship' || near ? [['ship', 'Корабль']] : [])];
  let body = '';
  if (tab === 'inv') {
    body = `<div class="muted">Заполнено ${used} / ${s.cap} ед. · модулей костюма ${s.ups || 0}/6 (аварийные капсулы)</div><div class="cap-bar"><i style="width:${Math.min(100, used / s.cap * 100)}%"></i></div>
      <div class="sf-inv">${Object.entries(s.inv).sort((a, b) => b[1] - a[1]).map(([k, q]) => `<div class="sf-it"><span>${ITEM(k)}</span><b>${q}</b>${near ? `<button data-sf="toship" data-item="${k}">В трюм</button>` : ''}</div>`).join('') || '<div class="muted">Пусто. Добывайте ресурсы мультитулом (ЛКМ).</div>'}</div>
      <div class="btn2"><button data-sf="use" data-item="res_oxygen">[1] Кислород → жизнеобеспечение</button><button data-sf="use" data-item="res_sodium">[2] Натрий → защита</button><button data-sf="use" data-item="surf_kit">[3] Ремкомплект</button>${near && used ? '<button data-sf="allship">Всё в трюм</button>' : ''}</div>
      <div class="muted small">Улучшения: мультитул ур.${(s.lv || {}).tool || 1}, ранец ур.${(s.lv || {}).jet || 1}, защита — холод ${s.lv.cold}, жара ${s.lv.heat}, токсины ${s.lv.toxic}, радиация ${s.lv.rad}</div>`;
  } else if (tab === 'craft') {
    body = Object.entries(W.recipes).map(([id, r]) => {
      const done = r.up && (s.lv[r.up[0]] || 0) >= r.up[1];
      const ok = Object.entries(r.in).every(([k, q]) => have(k) >= q || near);
      return `<div class="sf-rec${done ? ' done' : ''}"><div><b>${r.name}</b><div class="muted small">${Object.entries(r.in).map(([k, q]) => `<span class="${have(k) >= q ? 'req-ok' : 'req-no'}">${ITEM(k)} ${have(k)}/${q}</span>`).join(' · ')}</div></div>
        ${done ? '<span class="sk-max">есть</span>' : `<button data-sf="craft" data-r="${id}" ${ok ? '' : 'disabled'}>Создать</button>`}</div>`;
    }).join('') + '<div class="muted small">Рядом с кораблём в рецептах можно тратить и ресурсы трюма.</div>';
  } else if (tab === 'disc') {
    const P = W.P;
    body = `<div class="muted">${P.name}: ${P.biomeName.toLowerCase()} планета. Изучено видов: ${P.species.filter(x => W.disc.has(x.idx)).length} / ${P.species.length}. Наведите прицел на животное на 1 с, чтобы изучить.</div>` +
      P.species.map(sp => W.disc.has(sp.idx) ? `<div class="sf-sp"><b>${sp.name}</b> <span class="muted">${'◆'.repeat(sp.rarity)}</span><div class="muted small">${sp.planName} · ${sp.temperName} · ${sp.diet} · рост ${sp.height || sp.size} м · скорость ${sp.speed} м/с</div></div>`
        : `<div class="sf-sp unk"><b>Неизвестный вид</b><div class="muted small">${sp.planName}</div></div>`).join('');
  } else {
    body = `<p>Корабль готов ${W.suit && have('launch_fuel') ? 'к взлёту (есть «Топливо взлёта»)' : `к взлёту: нужно 40 ди-водорода (в костюме ${have('res_dihydro')}) или «Топливо взлёта»`}. Ресурсы костюма при взлёте переносятся в трюм.</p>
      <div class="btn2"><button class="primary" data-sf="takeoff">⇪ Взлёт</button>${used ? '<button data-sf="allship">Всё из костюма в трюм</button>' : ''}<button data-sf="craft" data-r="launch_fuel">Сделать топливо (40 ди-водорода + 20 феррита)</button></div>`;
  }
  el.innerHTML = `<div class="sf-tabs">${tabs.map(([k, l]) => `<span data-sf="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</span>`).join('')}<span data-sf="close" class="x">✕</span></div>${body}`;
}
const HZ_ICON = { heat: '🔥', cold: '❄', toxic: '☣', rad: '☢' };
function updateHud(storm, phase, dayK, nearShip) {
  const P = W.P, now = performance.now();
  if (!W.hudT || now - W.hudT > 120) {
    W.hudT = now;
    const temp = Math.round(lerp(P.temp[0], P.temp[1], dayK)) + (storm > 0.3 ? (P.hz === 'cold' ? -25 : P.hz === 'heat' ? 30 : 0) : 0);
    const hh = Math.floor(phase * 24), mm = Math.floor((phase * 24 - hh) * 60);
    $('#sf-info').innerHTML = `<div class="sf-pn">${P.name}</div><div class="muted">${P.biomeName} · ${temp} °C · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${dayK > 0.5 ? '☀' : '☾'}</div>
      <div class="muted small">${storm > 0.3 ? `<b style="color:var(--bad)">${P.stormName}</b> · ` : ''}гравитация ${P.gravity} g · смотрители: ${PG.SENTINEL_NAME[P.sentinels].toLowerCase()}${P.hz ? ` · ${HZ_ICON[P.hz]} ${PG.HAZARD_NAME[P.hz].toLowerCase()}` : ''}</div>
      <div class="muted small">Виды: ${P.species.filter(x => W.disc.has(x.idx)).length}/${P.species.length} · особый ресурс: ${P.specialName} · жилы: ${P.metalName}</div>`;
    const bar = (cls, label, v, extra = '') => `<div class="sf-b ${cls}"><span>${label}</span><div class="bar"><i style="width:${clamp(v, 0, 100)}%"></i></div><b>${Math.round(v)}%</b>${extra}</div>`;
    $('#sf-bars').innerHTML = bar('hp', 'Здоровье', W.hp) + bar('ls', 'Жизнеобесп.', W.ls, ` <small>[1] ${W.suit.inv.res_oxygen || 0}</small>`)
      + bar('hz', P.hz ? `${HZ_ICON[P.hz]} Защита` : 'Защита', W.hz, ` <small>[2] ${W.suit.inv.res_sodium || 0}</small>`) + bar('jet', 'Ранец', W.jet * 100) + bar('heat', W.overheat > 0 ? 'ПЕРЕГРЕВ' : 'Мультитул', W.heat * 100)
      + `<div class="muted small">${nearShip ? 'Укрытие корабля: защита восстанавливается' : `Костюм: ${Object.values(W.suit.inv).reduce((a, b) => a + b, 0)} / ${W.suit.cap}`}</div>`;
    $('#sf-wanted').textContent = W.wanted ? '★'.repeat(W.wanted) + ' РОЗЫСК СМОТРИТЕЛЕЙ' : '';
    // цель под прицелом
    const t = W.target;
    let tg = '';
    if (t && t.kind === 'node') {
      const D = PG.NODES[t.n.kind];
      tg = `<b>${t.n.kind === 'special' ? P.specialName : t.n.kind === 'metal' ? 'Жила: ' + P.metalName : D.name}</b><div class="muted">${D.use ? 'E — открыть' : `${ITEM(t.n.item)} ×${t.n.amount}`}</div>${W.mineT === t.n.id ? `<div class="bar"><i style="width:${W.mineP * 100}%"></i></div>` : ''}`;
    } else if (t && t.kind === 'cr') {
      const sp = t.cr.sp, known = W.disc.has(sp.idx);
      tg = `<b>${known ? sp.name : 'Неизвестный вид'}</b><div class="muted">${sp.planName}${known ? ` · ${sp.temperName} · ${sp.diet}` : ''}</div>${!known ? `<div class="muted small">Анализ…</div><div class="bar"><i style="width:${Math.min(100, W.analyze.t / 1.2 * 100)}%"></i></div>` : ''}<div class="bar hu"><i style="width:${Math.max(0, t.cr.hp / sp.hp * 100)}%"></i></div>`;
    } else if (t && t.kind === 'sent') tg = `<b>Дрон-смотритель</b><div class="bar hu"><i style="width:${Math.max(0, t.s.hp / 80 * 100)}%"></i></div>`;
    $('#sf-target').innerHTML = tg; $('#sf-target').style.display = tg ? '' : 'none';
    const it = nearestInteract();
    $('#sf-prompt').innerHTML = it ? `<b>E</b> ${it.label}` : '';
    $('#sf-prompt').style.display = it ? '' : 'none';
    $('#sf-picks').innerHTML = W.picks.filter(p => W.t - p.t < 4).map(p => `<div>${p.text}</div>`).join('');
  }
  // компас: направление на корабль
  const toShip = Math.atan2(-W.pos.x, -W.pos.z), rel = ((toShip - (W.yaw + Math.PI)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  const dShip = Math.hypot(W.pos.x, W.pos.z);
  const sm = $('#sf-ship-mark'); if (sm) { sm.style.transform = `translateX(${clamp(-rel * 160, -200, 200)}px)`; sm.textContent = `▲ Корабль ${Math.round(dShip)} м`; }
  // метки сканера
  const mk = $('#sf-markers');
  if (W.t < W.scanUntil && W.markers.length) {
    const ox = W.origin[0], oz = W.origin[1];
    let html = '';
    for (const m of W.markers) {
      if (W.depleted.has(m.n.id) || W.taken.has(m.n.id)) continue;
      V.set(m.n.x - ox, PG.height(W.P, m.n.x, m.n.z) + 1.5, m.n.z - oz).project(W.cam);
      if (V.z > 1 || Math.abs(V.x) > 1.1 || Math.abs(V.y) > 1.1) continue;
      const D = PG.NODES[m.n.kind], name = m.n.kind === 'special' ? P.specialName : m.n.kind === 'metal' ? P.metalName : D.name;
      const d = Math.hypot(m.n.x - ox - W.pos.x, m.n.z - oz - W.pos.z);
      html += `<div class="sf-mk k-${m.n.kind}" style="left:${(V.x * 0.5 + 0.5) * innerWidth}px;top:${(-V.y * 0.5 + 0.5) * innerHeight}px">◆<span>${name} · ${Math.round(d)} м</span></div>`;
    }
    mk.innerHTML = html;
  } else if (mk.innerHTML) mk.innerHTML = '';
}

// для инструментов отладки и тестов
export function debugState() { return W; }
