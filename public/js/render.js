// 3D-рендер космоса на three.js: PBR-материалы, отражения окружения, свечение (bloom),
// процедурные планеты, туманности, корабли, станции и эффекты.
// Плавающее начало координат: всё рисуется относительно корабля игрока.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

const FAR_START = 1.5e6; // дальше этого расстояния объекты «сжимаются» с сохранением углового размера

let renderer, composer, bloom, grade, scene, camera, sunLight, rimLight, ambient, pmrem;
let celGroup, entGroup, fxGroup, warpLines, dust, starField, skyRT, envRT, skyDome;
const celMeshes = new Map();   // id -> { obj, data }
const entMeshes = new Map();   // id -> { obj, kind, seen }
const fxList = [];
let stationView = null;
const GU = { time: { value: 0 } }; // общие uniform-переменные шейдеров

let quality = 'high';
// Качество графики: high — всё; medium — без теней и с меньшим разрешением; low — без свечения, следов и постэффектов
export function setQuality(q) {
  quality = q;
  if (!renderer) return;
  renderer.setPixelRatio(Math.min(q === 'high' ? 1.75 : q === 'medium' ? 1.25 : 1, devicePixelRatio));
  sunLight.castShadow = q === 'high';
  bloom.enabled = q !== 'low';
  grade.enabled = q !== 'low';
  if (q === 'low') { for (const [id, tr] of trails) { fxGroup.remove(tr.mesh); trails.delete(id); } }
  resize();
}

export const cam = { yaw: 0.6, pitch: 0.3, dist: 600, target: 600 };

// ======================================================================
// Шум
// ======================================================================
function seeded(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return ((a >>> 0) % 1000003) / 1000003; };
}
function strSeed(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

// Симплекс-шум 3D (Gustavson)
const G3 = [1,1,0, -1,1,0, 1,-1,0, -1,-1,0, 1,0,1, -1,0,1, 1,0,-1, -1,0,-1, 0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1];
function makeNoise(seed) {
  const r = seeded(seed), p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512), pm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm[i] = perm[i] % 12; }
  const F3 = 1 / 3, Gc = 1 / 6;
  return (x, y, z) => {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * Gc;
    const x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + Gc, y1 = y0 - j1 + Gc, z1 = z0 - k1 + Gc;
    const x2 = x0 - i2 + 2 * Gc, y2 = y0 - j2 + 2 * Gc, z2 = z0 - k2 + 2 * Gc;
    const x3 = x0 - 1 + 3 * Gc, y3 = y0 - 1 + 3 * Gc, z3 = z0 - 1 + 3 * Gc;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, tt, g;
    tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0; if (tt > 0) { g = pm[ii + perm[jj + perm[kk]]] * 3; tt *= tt; n += tt * tt * (G3[g] * x0 + G3[g + 1] * y0 + G3[g + 2] * z0); }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1; if (tt > 0) { g = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; tt *= tt; n += tt * tt * (G3[g] * x1 + G3[g + 1] * y1 + G3[g + 2] * z1); }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2; if (tt > 0) { g = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; tt *= tt; n += tt * tt * (G3[g] * x2 + G3[g + 1] * y2 + G3[g + 2] * z2); }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3; if (tt > 0) { g = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; tt *= tt; n += tt * tt * (G3[g] * x3 + G3[g + 1] * y3 + G3[g + 2] * z3); }
    return 32 * n; // [-1, 1]
  };
}
function fbm(n, x, y, z, oct = 5, lac = 2.03, gain = 0.5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f, z * f); f *= lac; a *= gain; }
  return s; // ~[-1, 1]
}
function ridged(n, x, y, z, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(n(x * f, y * f, z * f))); f *= 2.1; a *= 0.5; }
  return s;
}
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function ramp(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return [lerp(c0[0], c1[0], k), lerp(c0[1], c1[1], k), lerp(c0[2], c1[2], k)];
    }
  }
  return stops[stops.length - 1][1];
}

// GLSL: шум и логарифмическая глубина
const GLSL_NOISE = `
float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
`;
// Симплекс-шум 3D (Ashima Arts, MIT) — плавнее value-шума, без «квадратиков»
const GLSL_SIMPLEX = `
vec3 m289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 m289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return m289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy;
  i = m289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0; vec4 s1 = floor(b1) * 2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0); m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbmS(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 7; i++) { s += a * snoise(p); p = p * 2.02 + 0.31; a *= 0.5; } return s; }
float ridgedS(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { float n = 1.0 - abs(snoise(p)); s += a * n * n; p = p * 2.07 + 0.53; a *= 0.5; } return s; }
`;

function logShader({ uniforms, vertex, fragment, ...rest }) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\n${vertex.replace('/*LOGDEPTH*/', '\n#include <logdepthbuf_vertex>\n')}`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>\n${GLSL_NOISE}\n${fragment.replace('/*LOGDEPTH*/', '\n#include <logdepthbuf_fragment>\n')}`,
    ...rest
  });
}

// Френелевская оболочка: атмосферы планет, щиты кораблей, корона
function fresnelMaterial(color, power = 3, intensity = 1.2, sunSide = true) {
  return logShader({
    uniforms: { color: { value: new THREE.Color(color) }, power: { value: power }, intensity: { value: intensity },
      sunDir: { value: new THREE.Vector3(1, 0, 0) }, sunSide: { value: sunSide ? 1 : 0 }, opacity: { value: 1 } },
    vertex: `varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        vW = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * mv; /*LOGDEPTH*/ }`,
    fragment: `uniform vec3 color; uniform float power, intensity, sunSide, opacity; uniform vec3 sunDir; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ /*LOGDEPTH*/ float f = pow(1.0 - abs(dot(vN, vV)), power);
        float lit = mix(1.0, smoothstep(-0.35, 0.6, dot(vW, sunDir)), sunSide);
        gl_FragColor = vec4(color * f * intensity * lit * opacity, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
  });
}

// ======================================================================
// Текстуры
// ======================================================================
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function glowTexture(soft = 1) {
  return canvasTex(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.15 * soft, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  });
}

// Обшивка корабля: панели, швы, люки, полосы. Используется как цвет, шероховатость и рельеф.
function hullTexture(seed, stripe) {
  const r = seeded(seed);
  return canvasTex(1024, 1024, (g, W, H) => {
    g.fillStyle = '#9a9ea3'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1400; i++) {
      const w = 20 + r() * 140, h = 20 + r() * 100, x = r() * W, y = r() * H;
      const v = 130 + r() * 50;
      g.fillStyle = `rgb(${v},${v + 2},${v + 5})`; g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(30,32,36,0.75)'; g.lineWidth = 1.5; g.strokeRect(x + 0.5, y + 0.5, w, h);
    }
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(20,22,25,${0.3 + r() * 0.5})`; g.fillRect(r() * W, r() * H, 3 + r() * 10, 3 + r() * 10); }
    for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(40,42,46,0.8)'; g.fillRect(r() * W, r() * H, 60 + r() * 200, 2); }
    if (stripe) {
      g.fillStyle = stripe;
      for (let i = 0; i < 6; i++) { const y = r() * H; g.fillRect(0, y, W, 6 + r() * 14); }
    }
    // потёртости
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.06})`; g.fillRect(r() * W, r() * H, 2 + r() * 30, 1 + r() * 3); }
  });
}

// Светящиеся окна для станций и больших кораблей
function windowTexture(seed, density = 0.35) {
  const r = seeded(seed);
  return canvasTex(1024, 512, (g, W, H) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (let row = 0; row < H; row += 16) {
      if (r() < 0.35) continue;
      for (let x = 0; x < W; x += 10) {
        if (r() > density) continue;
        const warm = r() < 0.8;
        g.fillStyle = warm ? `rgba(255,${200 + r() * 40},${130 + r() * 60},${0.5 + r() * 0.5})` : `rgba(150,210,255,${0.6 + r() * 0.4})`;
        g.fillRect(x, row + 4, 6, 6);
      }
    }
  });
}

function solarTexture() {
  return canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#0b1830'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#3a5a8a'; g.lineWidth = 2;
    for (let i = 0; i <= W; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, H); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(W, i); g.stroke(); }
  });
}

function plumeTexture() {
  return canvasTex(64, 256, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.15, 'rgba(255,255,255,0.7)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.15)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    const side = g.createLinearGradient(0, 0, W, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.5, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = side; g.fillRect(0, 0, W, H);
  });
}

// Полный PBR-набор обшивки: цвет с покраской и маркировкой, карта нормалей (швы, заклёпки),
// шероховатость и металличность (G/B каналы), светящиеся окна
function hullSet(paint, accent, faction, seed) {
  const W = 1024, r = seeded(seed);
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = W; return [c, c.getContext('2d')]; };
  const [cc, cg] = mk(), [hc, hg] = mk(), [oc, og] = mk(), [ec, eg] = mk();
  const P = new THREE.Color(paint), A = new THREE.Color(accent);
  const rgb = (c, k = 1) => `rgb(${Math.min(255, c.r * 255 * k) | 0},${Math.min(255, c.g * 255 * k) | 0},${Math.min(255, c.b * 255 * k) | 0})`;
  const gray = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;
  const orm = (rough, metal) => `rgb(255,${rough | 0},${metal | 0})`;
  cg.fillStyle = '#3c4046'; cg.fillRect(0, 0, W, W);
  hg.fillStyle = gray(60); hg.fillRect(0, 0, W, W);
  og.fillStyle = orm(170, 200); og.fillRect(0, 0, W, W);
  eg.fillStyle = '#000'; eg.fillRect(0, 0, W, W);
  const bareShare = faction === 'pirate' ? 0.35 : faction === 'dark' ? 0.7 : 0.18;
  const codes = faction === 'pirate' ? ['СКВ', 'XX', '666', 'РЕЙД'] : faction === 'guard' ? ['СТРАЖ', 'ГП-1', 'ПОРЯДОК'] : ['VF', 'ВФ-07', 'ПФ-21', 'АРК', '12', 'Б-3'];
  const panels = [];
  const split = (x, y, w, h, d) => {
    if (d >= 6 || w < 50 || h < 50 || (d > 2 && r() < 0.22)) { panels.push([x, y, w, h]); return; }
    if (w > h ? r() < 0.78 : r() < 0.22) { const k = w * (0.3 + r() * 0.4); split(x, y, k, h, d + 1); split(x + k, y, w - k, h, d + 1); }
    else { const k = h * (0.3 + r() * 0.4); split(x, y, w, k, d + 1); split(x, y + k, w, h - k, d + 1); }
  };
  split(0, 0, W, W, 0);
  for (const [x, y, w, h] of panels) {
    const gap = 2, X = x + gap, Y = y + gap, Wd = w - gap * 2, Hd = h - gap * 2;
    const t = r();
    if (t < bareShare) { // голый металл
      const v = 0.75 + r() * 0.35;
      cg.fillStyle = rgb(new THREE.Color(0.62, 0.64, 0.67), v); cg.fillRect(X, Y, Wd, Hd);
      og.fillStyle = orm(145 + r() * 60, 190); og.fillRect(X, Y, Wd, Hd);
      hg.fillStyle = gray(150 + r() * 20); hg.fillRect(X, Y, Wd, Hd);
    } else if (t < bareShare + 0.08) { // решётка радиатора
      cg.fillStyle = '#33373d'; cg.fillRect(X, Y, Wd, Hd);
      og.fillStyle = orm(190, 120); og.fillRect(X, Y, Wd, Hd);
      hg.fillStyle = gray(110); hg.fillRect(X, Y, Wd, Hd);
      const vert = Wd < Hd;
      for (let k = 4; k < (vert ? Wd : Hd) - 2; k += 7) {
        hg.fillStyle = gray(170); cg.fillStyle = '#6a7079';
        if (vert) { hg.fillRect(X + k, Y + 3, 3, Hd - 6); cg.fillRect(X + k, Y + 3, 3, Hd - 6); }
        else { hg.fillRect(X + 3, Y + k, Wd - 6, 3); cg.fillRect(X + 3, Y + k, Wd - 6, 3); }
      }
    } else { // окрашенная панель
      const v = 0.9 + r() * 0.16;
      cg.fillStyle = rgb(P, v); cg.fillRect(X, Y, Wd, Hd);
      og.fillStyle = orm(115 + r() * 40, 40); og.fillRect(X, Y, Wd, Hd);
      hg.fillStyle = gray(160 + r() * 15); hg.fillRect(X, Y, Wd, Hd);
      // фаска по краю
      hg.strokeStyle = gray(190); hg.lineWidth = 2; hg.strokeRect(X + 2, Y + 2, Wd - 4, Hd - 4);
      const deco = r();
      if (deco < 0.16 && Wd > 90) { // полосы фракционного цвета
        cg.fillStyle = rgb(A); const sh = 6 + r() * 10, sy = Y + Hd * (0.2 + r() * 0.5);
        cg.fillRect(X, sy, Wd, sh); cg.fillRect(X, sy + sh + 4, Wd, sh * 0.4);
      } else if (deco < 0.24 && Wd > 70 && Hd > 30) { // полосы опасности
        cg.save(); cg.beginPath(); cg.rect(X, Y + Hd - 18, Wd, 14); cg.clip();
        cg.fillStyle = '#d8b020'; cg.fillRect(X, Y + Hd - 18, Wd, 14);
        cg.fillStyle = '#16181a';
        for (let k = -20; k < Wd + 20; k += 16) { cg.beginPath(); cg.moveTo(X + k, Y + Hd - 4); cg.lineTo(X + k + 8, Y + Hd - 4); cg.lineTo(X + k + 22, Y + Hd - 18); cg.lineTo(X + k + 14, Y + Hd - 18); cg.fill(); }
        cg.restore();
      } else if (deco < 0.36 && Wd > 80 && Hd > 40) { // маркировка
        cg.fillStyle = P.getHSL({}).l > 0.5 ? 'rgba(25,28,32,0.85)' : 'rgba(235,238,242,0.85)';
        cg.font = `bold ${Math.min(36, Hd * 0.45) | 0}px Arial, sans-serif`;
        cg.fillText(codes[Math.floor(r() * codes.length)], X + 8, Y + Hd * 0.65);
      } else if (deco < 0.44 && Wd > 60) { // иллюминаторы
        const n = Math.floor(Wd / 12);
        const wy = Y + Hd * (0.3 + r() * 0.4);
        for (let k = 0; k < n; k++) {
          cg.fillStyle = '#0a1018'; cg.fillRect(X + 6 + k * 12, wy, 7, 5);
          hg.fillStyle = gray(110); hg.fillRect(X + 6 + k * 12, wy, 7, 5);
          if (r() < 0.7) { eg.fillStyle = r() < 0.8 ? `rgba(255,${210 + r() * 30},${150 + r() * 60},1)` : 'rgba(160,215,255,1)'; eg.fillRect(X + 7 + k * 12, wy + 1, 5, 3); }
        }
      }
      // заклёпки вдоль краёв
      if (r() < 0.35) {
        hg.fillStyle = gray(235); cg.fillStyle = rgb(P, 1.15);
        for (let k = 8; k < Wd - 6; k += 11) for (const yy of [Y + 5, Y + Hd - 5]) {
          hg.beginPath(); hg.arc(X + k, yy, 1.8, 0, 7); hg.fill(); cg.beginPath(); cg.arc(X + k, yy, 1.4, 0, 7); cg.fill();
        }
      }
    }
  }
  // грязь и потёки, потёртости по краям
  for (let i = 0; i < 900; i++) {
    const x = r() * W, y = r() * W, l = 20 + r() * 120;
    const gr = cg.createLinearGradient(x, y, x, y + l);
    gr.addColorStop(0, `rgba(15,12,10,${0.12 + r() * 0.15})`); gr.addColorStop(1, 'rgba(15,12,10,0)');
    cg.fillStyle = gr; cg.fillRect(x, y, 2 + r() * 8, l);
    og.fillStyle = `rgba(255,230,0,${0.15})`; og.fillRect(x, y, 2 + r() * 8, l * 0.6);
  }
  for (let i = 0; i < 1500; i++) {
    cg.fillStyle = `rgba(200,205,210,${r() * 0.18})`;
    cg.fillRect(r() * W, r() * W, 1 + r() * 14, 1);
  }
  // карта нормалей из карты высот (оператор Собеля)
  const hd = hg.getImageData(0, 0, W, W).data;
  const nd = hg.createImageData(W, W), nn = nd.data;
  const H = (x, y) => hd[(((y + W) % W) * W + ((x + W) % W)) * 4] / 255;
  const k = 3.2;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = -dx * k, ny = dy * k, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * W + x) * 4;
    nn[i] = (nx * 0.5 + 0.5) * 255; nn[i + 1] = (ny * 0.5 + 0.5) * 255; nn[i + 2] = (nz * 0.5 + 0.5) * 255; nn[i + 3] = 255;
  }
  const [nc, ng] = mk(); ng.putImageData(nd, 0, 0);
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  };
  return { map: tex(cc, true), normalMap: tex(nc, false), ormMap: tex(oc, false), emissiveMap: tex(ec, true) };
}

// Раскладка UV «кубической проекцией» по нормали каждого треугольника — текстура не растягивается на корпусах
function boxUV(geo, tile) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const pos = g.attributes.position, uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(t.subVectors(a, b));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c;
      let u, v;
      if (ax >= ay && ax >= az) { u = p.z; v = p.y; } else if (ay >= az) { u = p.x; v = p.z; } else { u = p.x; v = p.y; }
      uv[(i + k) * 2] = u / tile; uv[(i + k) * 2 + 1] = v / tile;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function applyBoxUV(root, tile, shadows) {
  const conv = new Map();
  root.traverse(o => {
    if (!o.isMesh || !o.material.userData || !o.material.userData.boxUV) return;
    if (!conv.has(o.geometry)) conv.set(o.geometry, boxUV(o.geometry, tile));
    o.geometry = conv.get(o.geometry);
    if (shadows) o.castShadow = o.receiveShadow = true;
  });
}

let TEX = null;
function sharedTextures() {
  if (TEX) return TEX;
  TEX = {
    glow: glowTexture(1), glowHard: glowTexture(0.4), plume: plumeTexture(), solar: solarTexture(),
    hull: hullTexture(11, null), hullPirate: hullTexture(23, 'rgba(120,10,10,0.9)'), hullGuard: hullTexture(37, 'rgba(240,240,255,0.9)'),
    windows: windowTexture(5), windowsDense: windowTexture(9, 0.6)
  };
  for (const k of ['hull', 'hullPirate', 'hullGuard']) { TEX[k].wrapS = TEX[k].wrapT = THREE.RepeatWrapping; }
  for (const k of ['windows', 'windowsDense', 'solar']) { TEX[k].wrapS = TEX[k].wrapT = THREE.RepeatWrapping; }
  return TEX;
}

// ======================================================================
// Небо: туманность в кубической карте (своя для каждой системы) + чёткие звёзды
// ======================================================================
const NEBULA_PALETTES = [
  [[0.55, 0.18, 0.45], [0.12, 0.25, 0.6], [0.9, 0.45, 0.25]],
  [[0.1, 0.4, 0.55], [0.3, 0.12, 0.5], [0.3, 0.8, 0.9]],
  [[0.6, 0.3, 0.12], [0.35, 0.08, 0.15], [1.0, 0.7, 0.35]],
  [[0.15, 0.35, 0.2], [0.08, 0.2, 0.45], [0.5, 0.9, 0.6]],
  [[0.45, 0.1, 0.12], [0.15, 0.05, 0.3], [1.0, 0.35, 0.3]],
  [[0.2, 0.2, 0.55], [0.5, 0.15, 0.4], [0.7, 0.6, 1.0]]
];

// Текстура далёкой галактики (спираль или эллипс)
function galaxyTexture(seed) {
  const r = seeded(seed);
  return canvasTex(256, 256, (g, W) => {
    const c = W / 2;
    const core = g.createRadialGradient(c, c, 0, c, c, W * 0.18);
    core.addColorStop(0, 'rgba(255,240,220,1)'); core.addColorStop(1, 'rgba(255,220,180,0)');
    const spiral = r() < 0.7, arms = 2 + Math.floor(r() * 2), tw = 2.5 + r() * 2;
    for (let i = 0; i < 2600; i++) {
      const rad = Math.pow(r(), 0.7) * W * 0.46;
      let ang = r() * Math.PI * 2;
      if (spiral) { const arm = Math.floor(r() * arms); ang = arm * Math.PI * 2 / arms + rad / W * tw * 3 + (r() - 0.5) * 0.6; }
      const x = c + Math.cos(ang) * rad, y = c + Math.sin(ang) * rad * 0.42;
      const blue = rad > W * 0.15 && r() < 0.6;
      g.fillStyle = blue ? `rgba(170,200,255,${0.05 + r() * 0.12})` : `rgba(255,225,190,${0.05 + r() * 0.12})`;
      g.beginPath(); g.arc(x, y, 1 + r() * 2.5, 0, 7); g.fill();
    }
    g.fillStyle = core; g.fillRect(0, 0, W, W);
  });
}

// Яркая звезда с дифракционными лучами
function spikeTexture() {
  return canvasTex(256, 256, (g, W) => {
    const c = W / 2;
    const grd = g.createRadialGradient(c, c, 0, c, c, c);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.05, 'rgba(255,255,255,0.8)');
    grd.addColorStop(0.2, 'rgba(255,255,255,0.08)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, W);
    for (const [ang, len, w] of [[0, 1, 2.2], [Math.PI / 2, 1, 2.2], [Math.PI / 4, 0.45, 1.2], [-Math.PI / 4, 0.45, 1.2]]) {
      g.save(); g.translate(c, c); g.rotate(ang);
      const lg = g.createLinearGradient(-c * len, 0, c * len, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.9)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg; g.fillRect(-c * len, -w / 2, c * len * 2, w);
      g.restore();
    }
  });
}

function buildSky(sysId, sec) {
  const seed = strSeed(sysId);
  const r = seeded(seed);
  let pal = NEBULA_PALETTES[seed % NEBULA_PALETTES.length];
  if (sec < 0) pal = NEBULA_PALETTES[4]; // в нулях небо тревожно-красное
  const rv = () => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
  const bandN = new THREE.Vector3(r() - 0.5, 1.6, r() - 0.5).normalize();
  const nebDir = rv();
  // центр галактики лежит в плоскости Млечного Пути
  const coreDir = rv().addScaledVector(bandN, -rv().dot(bandN)).normalize();
  const mat = new THREE.ShaderMaterial({
    depthWrite: false, depthTest: false,
    uniforms: { c1: { value: new THREE.Vector3(...pal[0]) }, c2: { value: new THREE.Vector3(...pal[1]) }, c3: { value: new THREE.Vector3(...pal[2]) },
      seed: { value: r() * 50 }, bandN: { value: bandN }, nebDir: { value: nebDir }, coreDir: { value: coreDir }, nebSize: { value: 0.45 + r() * 0.3 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `${GLSL_SIMPLEX}
      uniform vec3 c1, c2, c3, bandN, nebDir, coreDir; uniform float seed, nebSize; varying vec2 vUv;
      void main(){
        // равнопромежуточная проекция (совпадает с UV сферы неба)
        float lon = (vUv.x - 0.5) * 6.2831853, lat = (vUv.y - 0.5) * 3.1415927;
        vec3 d = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
        vec3 col = vec3(0.002, 0.003, 0.007);

        // Млечный Путь: светящаяся полоса со звёздной дымкой и тёмными пылевыми прожилками
        float bd = dot(d, bandN);
        float band = exp(-bd * bd * 16.0);
        float mwN = fbmS(d * 4.0 + seed) * 0.5 + 0.5;
        float haze = band * (0.15 + 0.85 * mwN * mwN);
        float lane = 1.0 - abs(fbmS(d * 5.0 + seed * 1.7 + vec3(0.0, bd * 9.0, 0.0)));
        float dust = smoothstep(0.82, 0.98, lane) * smoothstep(0.3, 0.7, fbmS(d * 2.0 - seed) * 0.5 + 0.5) * exp(-bd * bd * 90.0);
        float core = pow(max(0.0, dot(d, coreDir)), 6.0);
        float grain = pow(max(0.0, snoise(d * 420.0 + seed)), 5.0) + 0.5 * pow(max(0.0, snoise(d * 900.0 - seed)), 6.0);
        vec3 mwCol = mix(vec3(0.42, 0.5, 0.72), vec3(0.95, 0.75, 0.5), clamp(mwN * 0.5 + core * 0.9, 0.0, 1.0));
        col += mwCol * (haze * (0.07 + core * 0.45) + grain * band * 0.5) * (1.0 - 0.7 * dust);

        // Эмиссионная туманность: светящийся газ, яркие волокна, тёмные глобулы
        vec3 q = d * 2.3 + seed * 0.37;
        vec3 w = vec3(fbmS(q + 1.7), fbmS(q + 9.2), fbmS(q + 4.4));
        float gas = fbmS(q * 1.3 + w * 1.7) * 0.5 + 0.5;
        float fil = ridgedS(q * 2.4 + w * 1.3);
        float nd = 1.0 - dot(d, nebDir);
        float mask = smoothstep(nebSize, 0.0, nd + 0.35 * fbmS(d * 2.2 + seed * 2.0));
        float density = mask * smoothstep(0.38, 0.95, gas);
        vec3 gcol = mix(c1, c2, smoothstep(0.25, 0.75, fbmS(q * 0.9 + 3.0) * 0.5 + 0.5));
        col += gcol * density * 1.15;
        col += c3 * pow(fil, 5.0) * mask * smoothstep(0.35, 0.8, gas) * 2.2;
        col += mix(c3, vec3(1.0), 0.4) * pow(max(0.0, gas - 0.62) * 2.8, 3.0) * mask * 1.2;
        float globule = smoothstep(0.58, 0.82, fbmS(q * 2.0 - w * 0.7 + 11.0) * 0.5 + 0.5);
        col *= 1.0 - 0.92 * globule * smoothstep(0.0, 0.3, mask);

        // слабое отражённое свечение по всему небу
        col += gcol * 0.012 * (fbmS(d * 1.4 + seed * 3.0) * 0.5 + 0.5);
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  quadScene.add(quad);
  if (!skyRT) {
    const size = Math.min(4096, renderer.capabilities.maxTextureSize);
    skyRT = new THREE.WebGLRenderTarget(size, size / 2, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  }
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(skyRT);
  renderer.render(quadScene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
  renderer.setRenderTarget(prevTarget);
  quad.geometry.dispose(); mat.dispose();
  if (!skyDome) {
    skyDome = new THREE.Mesh(new THREE.SphereGeometry(2e9, 128, 64), new THREE.MeshBasicMaterial({ map: skyRT.texture, side: THREE.BackSide, depthWrite: false }));
    skyDome.frustumCulled = false; skyDome.renderOrder = -100;
    scene.add(skyDome);
  }
  if (envRT) envRT.dispose();
  envRT = pmrem.fromEquirectangular(skyRT.texture);
  scene.environment = envRT.texture;

  // звёзды: слои разной яркости, сгущаются к плоскости и центру галактики
  if (starField) { scene.remove(starField); starField.traverse(o => o.geometry && o.geometry.dispose()); }
  starField = new THREE.Group();
  const randDir = () => { let v; do { v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1); } while (v.lengthSq() > 1 || v.lengthSq() < 0.01); return v.normalize(); };
  const starDir = () => {
    const v = randDir(), k = r();
    if (k < 0.5) v.addScaledVector(bandN, -v.dot(bandN) * (0.8 + r() * 0.2)).normalize();
    else if (k < 0.62) v.lerp(coreDir, 0.6 + r() * 0.3).normalize();
    return v;
  };
  const tintOf = (t) => t < 0.12 ? [1, 0.7, 0.45] : t < 0.25 ? [1, 0.88, 0.7] : t < 0.42 ? [0.68, 0.8, 1] : [1, 0.98, 0.95];
  const layers = [[16000, 1.3, 0.45], [5000, 2.0, 0.75], [900, 3.0, 1.0]];
  for (const [count, size, bright] of layers) {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = starDir();
      pos.set([v.x * 1e8, v.y * 1e8, v.z * 1e8], i * 3);
      const c = tintOf(r()), b = bright * (0.35 + Math.pow(r(), 2) * 0.9);
      col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, map: TEX.glowHard,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false; pts.renderOrder = -10;
    starField.add(pts);
  }
  // яркие звёзды с лучами
  if (!TEX.spike) TEX.spike = spikeTexture();
  for (let i = 0; i < 28; i++) {
    const v = randDir(), c = tintOf(r()), k = 1.2 + r() * 1.5;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.spike, color: new THREE.Color(c[0] * k, c[1] * k, c[2] * k), sizeAttenuation: false,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, rotation: (r() - 0.5) * 0.3 }));
    sp.position.copy(v).multiplyScalar(1e8); sp.scale.setScalar(0.012 + Math.pow(r(), 3) * 0.035);
    sp.renderOrder = -9; starField.add(sp);
  }
  // далёкие галактики
  for (let i = 0; i < 6; i++) {
    const v = randDir();
    const gx = new THREE.Sprite(new THREE.SpriteMaterial({ map: galaxyTexture(seed + i * 101), color: new THREE.Color(0.55, 0.55, 0.6), sizeAttenuation: false,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, rotation: r() * Math.PI }));
    gx.position.copy(v).multiplyScalar(1e8); gx.scale.setScalar(0.03 + r() * 0.05);
    gx.renderOrder = -9; starField.add(gx);
  }
  scene.add(starField);
}

// ======================================================================
// Корабли
// ======================================================================
const shipCache = new Map();
const matCache = new Map();
const FACTION_ACCENT = { player: 0x2a8fd0, pirate: 0xb01818, guard: 0x2060c0, dark: 0x8a6a2a, station: 0xd08a30 };
function pbrMat(paint, faction, opts = {}) {
  const key = paint + ':' + faction;
  if (matCache.has(key)) return matCache.get(key);
  const set = hullSet(paint, FACTION_ACCENT[faction] || 0x2a8fd0, faction, (paint ^ strSeed(faction)) >>> 0);
  const m = new THREE.MeshPhysicalMaterial({
    map: set.map, normalMap: set.normalMap, normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: set.ormMap, metalnessMap: set.ormMap, roughness: 1, metalness: 1,
    emissiveMap: set.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.4,
    clearcoat: faction === 'dark' ? 0 : 0.12, clearcoatRoughness: 0.55, envMapIntensity: 1.2, ...opts
  });
  m.userData.boxUV = true;
  matCache.set(key, m);
  return m;
}
function hullMat(color, faction) {
  const paint = faction === 'pirate' ? 0x3b2a28 : faction === 'guard' ? 0xe4eaf2 : color;
  return pbrMat(paint, faction);
}
const darkMetal = () => pbrMat(0x34383e, 'dark');
const glassMat = () => matCache.get('glass') || (matCache.set('glass', new THREE.MeshStandardMaterial({ color: 0x0a1a28, metalness: 1, roughness: 0.05, emissive: 0x0a3050, emissiveIntensity: 0.6 })), matCache.get('glass'));
function glowMat(color, k = 3) {
  const key = 'glow' + color + k;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false }));
  return matCache.get(key);
}

// Корпус: тело вращения по профилю [t (0 корма → 1 нос), радиус 0..1], вытянуто вдоль +Z
function lathe(len, rad, profile, seg = 28) {
  const pts = profile.map(([t, r]) => new THREE.Vector2(Math.max(0.001, r * rad), (t - 0.5) * len));
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(Math.PI / 2);
  return g;
}
function wingGeo(span, chord, sweep, thick) {
  const s = new THREE.Shape();
  s.moveTo(0, chord * 0.5); s.lineTo(span, chord * 0.5 - sweep); s.lineTo(span, chord * 0.5 - sweep - chord * 0.35); s.lineTo(0, -chord * 0.5); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.3, bevelSize: thick * 0.3, bevelSegments: 2 });
  g.translate(0, 0, -thick / 2);
  g.rotateX(Math.PI / 2); // крыло в плоскости XZ, нос — по +Z
  return g;
}

function addEngine(g, x, y, z, r, color, len = 1) {
  const T = sharedTextures();
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, r * 1.2 * len, 20, 1, true), darkMetal());
  nozzle.rotation.x = Math.PI / 2; nozzle.position.set(x, y, z); g.add(nozzle);
  const core = new THREE.Mesh(new THREE.CircleGeometry(r * 0.8, 20), glowMat(color, 2.6));
  core.position.set(x, y, z - r * 0.55 * len); core.rotation.y = Math.PI; g.add(core);
  const plume = new THREE.Mesh(new THREE.ConeGeometry(r * 0.75, r * 8, 16, 1, true),
    new THREE.MeshBasicMaterial({ map: T.plume, color: new THREE.Color(color).multiplyScalar(1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
  plume.geometry.translate(0, -r * 4, 0); plume.rotation.x = -Math.PI / 2;
  plume.position.set(x, y, z - r * 0.6 * len);
  plume.userData.plume = r; g.add(plume);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: new THREE.Color(color).multiplyScalar(0.75), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  glow.position.set(x, y, z - r * 1.2 * len); glow.scale.setScalar(r * 3); glow.userData.glow = r * 3; g.add(glow);
}

function addTurret(g, x, y, z, s, mat) {
  const t = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.6, s * 0.75, s * 0.4, 16), mat); t.add(base);
  const head = new THREE.Mesh(new THREE.SphereGeometry(s * 0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat); head.position.y = s * 0.2; t.add(head);
  for (const dx of [-0.18, 0.18]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.07, s * 0.09, s * 1.4, 8), darkMetal());
    b.rotation.x = Math.PI / 2; b.position.set(dx * s, s * 0.35, s * 0.7); t.add(b);
  }
  t.position.set(x, y, z); g.add(t);
}

function addLights(g, pts, color) {
  for (const p of pts) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(p[3] || 1, 8, 6), glowMat(color, 5));
    l.position.set(p[0], p[1], p[2]); l.userData.blink = Math.random() * 6; g.add(l);
  }
}

function greebles(g, R, count, mat, region) {
  const r = seeded(count * 7 + R);
  for (let i = 0; i < count; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(R * (0.04 + r() * 0.12), R * (0.03 + r() * 0.06), R * (0.05 + r() * 0.2)), mat);
    b.position.set((r() - 0.5) * region[0], region[1] + r() * R * 0.04, (r() - 0.5) * region[2]);
    g.add(b);
  }
}

// Базовый радиус модели каждого корабля (модель строится в этих единицах, потом масштабируется)
const SHIP_BASE_R = { iskra: 40, klinok: 45, burlak: 120, tyagach: 110, strazh: 90, molot: 160,
  strizh: 32, sokol: 38, staratel: 48, vihr: 70, piligrim: 110, leviafan: 170, kit: 260, citadel: 260 };


// Коробка со скруглёнными рёбрами — корпуса не выглядят «кубиками»
const rbox = (w, h, d) => new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.22);

// Отрезок манипулятора между двумя точками
function armSegment(g, a, b, r, mat) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, len, 10), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
  g.add(m);
  return m;
}

// Гатлинг: корпус и вращающийся блок стволов
function gatling(g, x, y, z, s, M, D, flip = 1) {
  const t = new THREE.Group();
  t.add(Object.assign(new THREE.Mesh(rbox(s * 1.3, s * 1.0, s * 1.4), M), {}));
  const barrels = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.07, s * 0.07, s * 2.2, 6), D);
    b.rotation.x = Math.PI / 2; b.position.set(Math.cos(a) * s * 0.22, Math.sin(a) * s * 0.22, s * 1.6);
    barrels.add(b);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.32, s * 0.32, s * 0.25, 12), D);
  hub.rotation.x = Math.PI / 2; hub.position.z = s * 0.8; barrels.add(hub);
  barrels.userData.spin = ['z', 4];
  for (const sd of [1, -1]) { const twin = barrels.clone(); twin.position.x = sd * s * 0.35; twin.userData.spin = ['z', 4 * sd]; t.add(twin); }
  t.position.set(x, y, z);
  if (flip < 0) t.rotation.z = Math.PI;
  g.add(t);
}

// Общая основа «стелс»-истребителя: гранёный фюзеляж, дельта-крыло, кили, два двигателя, красные огни
function fighterBase(g, R, M, D, eng, o = {}) {
  const L = o.long || 1, W = o.wide || 1;
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  // фюзеляж из граней — как у стелс-самолёта
  const body = add(lathe(R * 2.5 * L, R * 0.2, [[0, 0.8], [0.06, 0.95], [0.45, 1], [0.7, 0.82], [0.88, 0.42], [1, 0.02]], 6), M, 0, 0, R * 0.1 * L);
  body.scale.set(1.35 * W, 0.6, 1); body.rotation.z = Math.PI / 6;
  add(rbox(R * 0.26 * W, R * 0.1, R * 1.3 * L), M, 0, R * 0.09, -R * 0.2);
  // гранёный фонарь кабины
  const canopy = add(new THREE.SphereGeometry(R * 0.13, 6, 4), glassMat(), 0, R * 0.12, R * 0.62 * L);
  canopy.scale.set(0.95, 0.62, 2.6);
  // дельта-крыло
  const wing = new THREE.Shape();
  wing.moveTo(0, R * 0.35); wing.lineTo(R * 1.05 * W, -R * 0.82); wing.lineTo(R * 1.0 * W, -R * 0.98); wing.lineTo(0, -R * 0.95);
  const wg = new THREE.ExtrudeGeometry(wing, { depth: R * 0.03, bevelEnabled: true, bevelThickness: R * 0.012, bevelSize: R * 0.012, bevelSegments: 1 });
  wg.translate(0, 0, -R * 0.015); wg.rotateX(Math.PI / 2);
  for (const sd of [1, -1]) {
    const w = add(wg, M, sd * R * 0.12, -R * 0.03, -R * 0.05 * L); w.scale.x = sd;
    // переднее наплывное крыло
    const can = new THREE.Shape(); can.moveTo(0, R * 0.25); can.lineTo(R * 0.32, -R * 0.12); can.lineTo(0, -R * 0.15);
    const cg = new THREE.ExtrudeGeometry(can, { depth: R * 0.02, bevelEnabled: false }); cg.rotateX(Math.PI / 2);
    const c = add(cg, M, sd * R * 0.14, R * 0.02, R * 0.55 * L); c.scale.x = sd;
    // разведённые кили
    const fin = add(rbox(R * 0.025, R * 0.42, R * 0.34), M, sd * R * 0.26 * W, R * 0.22, -R * 0.82 * L);
    fin.rotation.set(-0.45, 0, -sd * 0.38);
    // двигатели
    add(lathe(R * 0.7, R * 0.1, [[0, 0.85], [0.15, 1], [0.85, 0.95], [1, 0.6]], 14), D, sd * R * 0.16 * W, -R * 0.02, -R * 0.78 * L);
    addEngine(g, sd * R * 0.16 * W, -R * 0.02, -R * 1.14 * L, R * 0.085, eng, 0.9);
    // орудия под крыльями
    if (o.guns) for (let k = 0; k < o.guns; k++) {
      const gun = add(new THREE.CylinderGeometry(R * 0.018, R * 0.022, R * 0.55, 8), D, sd * R * (0.55 + k * 0.3) * W, -R * 0.07, -R * 0.15 - k * R * 0.2);
      gun.rotation.x = Math.PI / 2;
    }
  }
  // носовой штырь
  add(new THREE.CylinderGeometry(R * 0.006, R * 0.012, R * 0.35, 6), D, 0, 0, R * 1.5 * L).rotation.x = Math.PI / 2;
  // постоянные красные огни по корпусу и мигающие на законцовках крыльев
  const red = glowMat(0xff1a1a, 4);
  for (const [x, y, z] of [[0.22, 0.04, 0.45], [-0.22, 0.04, 0.45], [0.12, 0.13, 0.15], [-0.12, 0.13, 0.15], [0.3, 0.42, -0.95], [-0.3, 0.42, -0.95]])
    add(new THREE.SphereGeometry(R * 0.018, 8, 6), red, R * x * W, R * y, R * z * L);
  addLights(g, [[R * 1.04 * W, -R * 0.03, -R * 0.92, R * 0.022], [-R * 1.04 * W, -R * 0.03, -R * 0.92, R * 0.022]], 0xff2020);
}


function buildShip(type, color, faction) {
  const g = new THREE.Group();
  const M = hullMat(color, faction), D = darkMetal();
  const eng = faction === 'pirate' ? 0xff3a1a : faction === 'guard' ? 0x9fd0ff : 0x40b8ff;
  const R = SHIP_BASE_R[type] || 50;
  const add = (geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); return m; };
  switch (type) {
    case 'iskra': {
      add(lathe(R * 1.9, R * 0.32, [[0, 0.55], [0.1, 0.8], [0.45, 1], [0.75, 0.8], [0.92, 0.4], [1, 0.05]]), M, 0, 0, 0, 1, 0.7, 1);
      add(new THREE.SphereGeometry(R * 0.16, 20, 12), glassMat(), 0, R * 0.17, R * 0.42, 1, 0.6, 1.8);
      const w = wingGeo(R * 0.75, R * 0.6, R * 0.25, R * 0.04);
      add(w, M, R * 0.2, -R * 0.03, -R * 0.25); const w2 = add(w, M, -R * 0.2, -R * 0.03, -R * 0.25); w2.scale.x = -1;
      add(rbox(R * 0.04, R * 0.35, R * 0.4), D, 0, R * 0.25, -R * 0.55);
      addEngine(g, 0, 0, -R * 0.95, R * 0.17, eng);
      addLights(g, [[R * 0.95, -R * 0.03, -R * 0.45, R * 0.025], [-R * 0.95, -R * 0.03, -R * 0.45, R * 0.025]], 0xff2020);
      break;
    }
    case 'klinok': {
      add(lathe(R * 2.2, R * 0.28, [[0, 0.6], [0.15, 1], [0.5, 0.9], [0.8, 0.55], [1, 0.02]], 6), M, 0, 0, 0, 1.3, 0.6, 1);
      add(new THREE.SphereGeometry(R * 0.13, 16, 10), glassMat(), 0, R * 0.12, R * 0.35, 1, 0.6, 2.2);
      const w = wingGeo(R * 0.9, R * 0.7, -R * 0.3, R * 0.04);
      add(w, M, R * 0.2, 0, -R * 0.2); const w2 = add(w, M, -R * 0.2, 0, -R * 0.2); w2.scale.x = -1;
      for (const s of [1, -1]) {
        const pod = add(lathe(R * 0.9, R * 0.08, [[0, 0.6], [0.2, 1], [0.8, 1], [1, 0.3]], 10), D, s * R * 1.05, 0, -R * 0.05);
        pod.userData = {};
        add(rbox(R * 0.04, R * 0.3, R * 0.35), M, s * R * 0.35, R * 0.15, -R * 0.65).rotation.z = -s * 0.4;
      }
      addEngine(g, R * 0.22, 0, -R * 1.1, R * 0.14, eng); addEngine(g, -R * 0.22, 0, -R * 1.1, R * 0.14, eng);
      addLights(g, [[R * 1.05, 0, R * 0.42, R * 0.03], [-R * 1.05, 0, R * 0.42, R * 0.03]], faction === 'pirate' ? 0xff2020 : 0x40ff60);
      break;
    }
    case 'burlak': {
      add(lathe(R * 1.6, R * 0.5, [[0, 0.7], [0.1, 0.95], [0.6, 1], [0.85, 0.85], [1, 0.45]], 8), M, 0, 0, -R * 0.1, 1.1, 0.75, 1);
      add(rbox(R * 0.5, R * 0.25, R * 0.5), D, 0, R * 0.42, R * 0.15);
      add(rbox(R * 0.35, R * 0.1, R * 0.06), glowMat(0xffd9a0, 1.6), 0, R * 0.45, R * 0.41);
      for (const a of [-0.5, 0, 0.5]) { // шахтёрские манипуляторы
        const arm = new THREE.Group();
        const boom = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.04, R * 0.06, R * 0.9, 10), D); boom.rotation.x = Math.PI / 2; boom.position.z = R * 0.45; arm.add(boom);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(R * 0.07, 12, 8), glowMat(0x50ff90, 3)); tip.position.z = R * 0.92; arm.add(tip);
        arm.position.set(Math.sin(a) * R * 0.45, -R * 0.12 + Math.cos(a) * R * 0.05, R * 0.6); arm.rotation.y = a * 0.3;
        g.add(arm);
      }
      greebles(g, R, 40, D, [R * 0.9, R * 0.3, R * 1.2]);
      for (const s of [1, -1]) add(new THREE.CylinderGeometry(R * 0.18, R * 0.18, R * 0.9, 16), M, s * R * 0.62, -R * 0.05, -R * 0.35).rotation.x = Math.PI / 2;
      addEngine(g, R * 0.62, -R * 0.05, -R * 0.85, R * 0.15, eng); addEngine(g, -R * 0.62, -R * 0.05, -R * 0.85, R * 0.15, eng);
      addEngine(g, 0, 0, -R * 0.95, R * 0.2, eng);
      addLights(g, [[R * 0.8, 0, 0, R * 0.03], [-R * 0.8, 0, 0, R * 0.03], [0, R * 0.55, R * 0.15, R * 0.025]], 0xffaa30);
      break;
    }
    case 'tyagach': {
      add(rbox(R * 0.18, R * 0.18, R * 1.8), D);
      add(lathe(R * 0.5, R * 0.22, [[0, 0.8], [0.4, 1], [0.8, 0.8], [1, 0.3]], 12), M, 0, 0, R * 1.05);
      add(new THREE.SphereGeometry(R * 0.08, 12, 8), glassMat(), 0, R * 0.12, R * 1.2, 1.4, 0.6, 1);
      const r = seeded(4);
      const cols = [0x8a3a2a, 0x3a5a7a, 0x9a8a50, 0x5a6a5a, 0xa06030];
      for (let i = 0; i < 4; i++) for (let a = 0; a < 4; a++) {
        const ang = a * Math.PI / 2 + Math.PI / 4;
        const box = add(rbox(R * 0.26, R * 0.26, R * 0.36), new THREE.MeshStandardMaterial({ color: cols[Math.floor(r() * cols.length)], map: sharedTextures().hull, metalness: 0.4, roughness: 0.7 }),
          Math.cos(ang) * R * 0.22, Math.sin(ang) * R * 0.22, R * (0.55 - i * 0.4));
        box.rotation.z = ang;
      }
      add(new THREE.CylinderGeometry(R * 0.3, R * 0.3, R * 0.3, 8), M, 0, 0, -R * 0.95).rotation.x = Math.PI / 2;
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; addEngine(g, Math.cos(a) * R * 0.17, Math.sin(a) * R * 0.17, -R * 1.15, R * 0.09, eng); }
      addLights(g, [[R * 0.32, 0, R * 0.6, R * 0.02], [-R * 0.32, 0, R * 0.6, R * 0.02]], 0xff3030);
      break;
    }
    case 'strazh': case 'molot': {
      const big = type === 'molot';
      add(lathe(R * 2, R * 0.35, [[0, 0.75], [0.12, 1], [0.55, 0.95], [0.85, 0.6], [1, 0.08]], 8), M, 0, 0, 0, 1.6, 0.55, 1);
      add(rbox(R * 0.5, R * 0.22, R * 0.9), M, 0, R * 0.2, -R * 0.25);
      if (big) {
        add(rbox(R * 0.25, R * 0.35, R * 0.35), D, 0, R * 0.45, -R * 0.35);
        add(rbox(R * 0.4, R * 0.04, R * 0.12), glowMat(0xffd9a0, 1.4), 0, R * 0.5, -R * 0.17);
        for (const s of [1, -1]) add(rbox(R * 0.08, R * 0.5, R * 1.2), M, s * R * 0.75, 0, -R * 0.1);
      }
      const win = new THREE.Mesh(rbox(R * 0.52, R * 0.05, R * 0.7), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: sharedTextures().windowsDense, emissiveIntensity: 1.6, metalness: 0.5 }));
      win.position.set(0, R * 0.29, -R * 0.25); g.add(win);
      for (const s of [1, -1]) {
        add(lathe(R * 1.1, R * 0.16, [[0, 0.7], [0.15, 1], [0.8, 1], [1, 0.4]], 14), M, s * R * 0.6, -R * 0.05, -R * 0.35);
        addEngine(g, s * R * 0.6, -R * 0.05, -R * 0.92, R * 0.13, eng);
      }
      addEngine(g, 0, R * 0.05, -R * 1.02, R * 0.17, eng);
      const tN = big ? 4 : 2;
      for (let i = 0; i < tN; i++) addTurret(g, (i % 2 ? -1 : 1) * R * (big ? 0.28 : 0.2), R * (big ? 0.31 : 0.31), R * (0.3 - Math.floor(i / 2) * 0.35), R * 0.14, D);
      greebles(g, R, big ? 50 : 30, D, [R * 0.9, R * 0.17, R * 1.4]);
      addLights(g, [[R * 0.78, 0, -R * 0.2, R * 0.025], [-R * 0.78, 0, -R * 0.2, R * 0.025], [0, R * 0.42, -R * 0.7, R * 0.02]], faction === 'guard' ? 0x80c0ff : 0xff3020);
      break;
    }

    // ===== Новые корабли по концепт-артам: тёмный «стелс»-корпус, дельта-крылья, красные огни =====
    case 'strizh': {
      fighterBase(g, R, M, D, eng, { guns: 2 });
      break;
    }
    case 'sokol': {
      fighterBase(g, R, M, D, eng, { guns: 1 });
      // мачта с сенсорной сферой
      add(new THREE.CylinderGeometry(R * 0.025, R * 0.04, R * 0.55, 10), D, 0, R * 0.38, R * 0.05);
      add(new THREE.SphereGeometry(R * 0.09, 20, 14), M, 0, R * 0.7, R * 0.05);
      add(new THREE.SphereGeometry(R * 0.045, 16, 10), glowMat(0x50e0c0, 2.2), 0, R * 0.7, R * 0.13);
      // приборный отсек на хребте
      add(rbox(R * 0.32, R * 0.12, R * 0.55), M, 0, R * 0.15, -R * 0.05);
      // тарелка под брюхом
      const dish = add(new THREE.SphereGeometry(R * 0.3, 28, 10, 0, Math.PI * 2, 0, 0.6), D, 0, -R * 0.3, R * 0.15);
      dish.rotation.x = Math.PI * 0.75;
      // камерные модули у двигателей
      for (const sd of [1, -1]) {
        add(new THREE.SphereGeometry(R * 0.08, 16, 12), M, sd * R * 0.36, -R * 0.02, -R * 0.65, 1, 1, 1.3);
        add(new THREE.CircleGeometry(R * 0.04, 16), glowMat(0x60c0ff, 1.8), sd * R * 0.36, -R * 0.02, -R * 0.54);
      }
      break;
    }
    case 'staratel': {
      fighterBase(g, R, M, D, eng, { guns: 1 });
      // грузовые ящики на хребте и бортах
      const crate = pbrMat(0x3a3d42, 'dark');
      for (const [x, y, z, w, h, d] of [[0, 0.17, 0.05, 0.34, 0.16, 0.5], [0, 0.15, -0.55, 0.4, 0.2, 0.42], [0.3, 0.06, -0.45, 0.2, 0.16, 0.5], [-0.3, 0.06, -0.45, 0.2, 0.16, 0.5]])
        add(rbox(R * w, R * h, R * d), crate, R * x, R * y, R * z);
      // четыре манипулятора под брюхом с буровыми головками
      for (const [sx, z] of [[1, 0.25], [-1, 0.25], [1, -0.25], [-1, -0.25]]) {
        const j1 = [sx * R * 0.2, -R * 0.1, R * z], j2 = [sx * R * 0.38, -R * 0.38, R * (z + 0.08)], j3 = [sx * R * 0.3, -R * 0.62, R * (z + 0.22)];
        armSegment(g, j1, j2, R * 0.035, D); armSegment(g, j2, j3, R * 0.03, D);
        add(new THREE.SphereGeometry(R * 0.045, 12, 8), D, ...j2);
        add(rbox(R * 0.1, R * 0.1, R * 0.1), M, ...j3).rotation.set(0.6, 0.6, 0);
        const tip = add(new THREE.OctahedronGeometry(R * 0.04), glowMat(0xe8f4ff, 3), j3[0], j3[1] - R * 0.06, j3[2] + R * 0.05);
        tip.userData.spin = ['y', 3 * sx];
      }
      break;
    }
    case 'vihr': {
      fighterBase(g, R, M, D, eng, { guns: 2, wide: 1.15 });
      // четыре гатлинга: два сверху, два снизу
      for (const [x, y, z, flip] of [[0.32, 0.17, 0.05, 1], [-0.32, 0.17, 0.05, 1], [0.24, -0.15, -0.3, -1], [-0.24, -0.15, -0.3, -1]])
        gatling(g, R * x, R * y, R * z, R * 0.2, M, D, flip);
      break;
    }
    case 'piligrim': {
      fighterBase(g, R, M, D, eng, { guns: 1, long: 1.35 });
      add(rbox(R * 0.5, R * 0.22, R * 1.8), M, 0, R * 0.02, -R * 0.15);
      // два ангара дронов с тёплым светом на каждом борту
      const bayGlow = glowMat(0xffb070, 1.3);
      for (const sd of [1, -1]) for (const z of [0.25, -0.55]) {
        add(rbox(R * 0.12, R * 0.26, R * 0.42), M, sd * R * 0.3, -R * 0.02, R * z);
        add(new THREE.PlaneGeometry(R * 0.34, R * 0.17), bayGlow, sd * R * 0.362, -R * 0.03, R * z).rotation.y = sd * Math.PI / 2;
      }
      addTurret(g, 0, R * 0.14, -R * 0.75, R * 0.11, D);
      add(new THREE.CylinderGeometry(R * 0.012, R * 0.012, R * 0.5, 6), D, 0, 0, R * 1.85).rotation.x = Math.PI / 2;
      break;
    }
    case 'leviafan': {
      // промышленный корпус: длинный короб, рамы, трубы, баки, манипуляторы с красными излучателями
      add(rbox(R * 0.55, R * 0.42, R * 1.9), M, 0, 0, 0);
      add(rbox(R * 0.65, R * 0.5, R * 0.45), M, 0, 0, R * 0.9);
      for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(R * 0.09, R * 0.09, R * 0.28, 16), pbrMat(0x5a4a3e, 'dark'), R * (0.15 - (i % 2) * 0.3), R * 0.34, -R * (0.15 + Math.floor(i / 2) * 0.22));
      for (const [x, z, h] of [[0.15, 0.4, 0.3], [-0.12, 0.55, 0.22], [0.05, -0.6, 0.35]]) add(new THREE.CylinderGeometry(R * 0.02, R * 0.02, R * h, 6), D, R * x, R * (0.21 + h / 2), R * z);
      // рама сверху
      for (const z of [-0.5, 0, 0.5]) { add(rbox(R * 0.03, R * 0.25, R * 0.03), D, R * 0.26, R * 0.33, R * z); add(rbox(R * 0.03, R * 0.25, R * 0.03), D, -R * 0.26, R * 0.33, R * z); }
      add(rbox(R * 0.55, R * 0.03, R * 1.1), D, 0, R * 0.46, 0);
      // трубы вдоль бортов
      for (const sd of [1, -1]) for (const y of [0.05, -0.1]) add(new THREE.CylinderGeometry(R * 0.025, R * 0.025, R * 1.7, 8), pbrMat(0x6a4a30, 'dark'), sd * R * 0.3, R * y, -R * 0.05).rotation.x = Math.PI / 2;
      // кормовой блок двигателей
      add(rbox(R * 0.75, R * 0.6, R * 0.35), M, 0, 0, -R * 0.95);
      for (const [x, y] of [[0.2, 0.15], [-0.2, 0.15], [0.2, -0.15], [-0.2, -0.15]]) addEngine(g, R * x, R * y, -R * 1.15, R * 0.11, eng);
      // манипуляторы-излучатели на носу
      for (const [x, y] of [[0.22, 0.18], [-0.22, 0.18], [0.25, -0.12], [-0.25, -0.12], [0, 0.26]]) {
        const base = [R * x * 0.8, R * y * 0.8, R * 1.1], mid = [R * x * 1.3, R * y * 1.3, R * 1.35], end = [R * x * 1.1, R * y * 1.1, R * 1.6];
        armSegment(g, base, mid, R * 0.045, D); armSegment(g, mid, end, R * 0.035, M);
        add(new THREE.SphereGeometry(R * 0.035, 12, 8), glowMat(0xff2020, 3), ...end);
      }
      // два нижних манипулятора к астероиду
      for (const sd of [1, -1]) { armSegment(g, [sd * R * 0.2, -R * 0.2, -R * 0.3], [sd * R * 0.25, -R * 0.55, -R * 0.1], R * 0.03, D); add(new THREE.SphereGeometry(R * 0.03, 10, 8), glowMat(0xff3030, 3), sd * R * 0.25, -R * 0.57, -R * 0.1); }
      greebles(g, R, 50, D, [R * 0.5, R * 0.22, R * 1.6]);
      addLights(g, [[R * 0.28, R * 0.2, R * 0.6, R * 0.02], [-R * 0.28, R * 0.2, R * 0.6, R * 0.02], [R * 0.28, R * 0.2, -R * 0.3, R * 0.02], [-R * 0.28, R * 0.2, -R * 0.3, R * 0.02]], 0xff2020);
      break;
    }
    case 'kit': {
      // ферма-хребет, контейнерные блоки в два яруса, рубка с антеннами, четыре больших двигателя
      add(rbox(R * 0.2, R * 0.2, R * 1.9), D, 0, 0, 0);
      for (const sd of [1, -1]) add(rbox(R * 0.03, R * 0.03, R * 1.8), D, sd * R * 0.14, R * 0.14, 0);
      const cont = pbrMat(0x34383e, 'dark');
      for (let i = 0; i < 5; i++) {
        const z = R * (0.62 - i * 0.3);
        for (const sd of [1, -1]) for (const y of [0.1, -0.12]) add(rbox(R * 0.26, R * 0.2, R * 0.26), cont, sd * R * 0.26, R * y, z);
        if (i % 2 === 0) add(rbox(R * 0.26, R * 0.16, R * 0.26), cont, 0, R * 0.22, z);
      }
      add(rbox(R * 0.4, R * 0.35, R * 0.3), M, 0, 0, R * 0.92);
      add(rbox(R * 0.22, R * 0.12, R * 0.18), M, 0, R * 0.32, -R * 0.55);
      add(rbox(R * 0.16, R * 0.08, R * 0.12), M, 0, R * 0.42, -R * 0.55);
      const win = new THREE.Mesh(rbox(R * 0.23, R * 0.025, R * 0.15), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: sharedTextures().windowsDense, emissiveIntensity: 1.4 }));
      win.position.set(0, R * 0.34, -R * 0.55); g.add(win);
      for (const x of [0.04, -0.04]) add(new THREE.CylinderGeometry(R * 0.006, R * 0.006, R * 0.18, 5), D, R * x, R * 0.55, -R * 0.55);
      add(rbox(R * 0.6, R * 0.5, R * 0.3), M, 0, 0, -R * 0.95);
      for (const [x, y] of [[0.17, 0.13], [-0.17, 0.13], [0.17, -0.13], [-0.17, -0.13]]) {
        add(new THREE.CylinderGeometry(R * 0.1, R * 0.12, R * 0.25, 16), D, R * x, R * y, -R * 1.15).rotation.x = Math.PI / 2;
        addEngine(g, R * x, R * y, -R * 1.28, R * 0.1, eng);
      }
      addLights(g, [[R * 0.4, R * 0.2, R * 0.62, R * 0.012], [-R * 0.4, R * 0.2, R * 0.62, R * 0.012], [0, R * 0.65, -R * 0.55, R * 0.012], [R * 0.4, -R * 0.22, -R * 0.6, R * 0.012]], 0xff2020);
      break;
    }
    case 'citadel': {
      // бронированный корпус-утюг, ярусы надстроек, много башен со спаренными стволами
      add(rbox(R * 0.7, R * 0.36, R * 2.0), M, 0, 0, 0);
      add(rbox(R * 0.55, R * 0.3, R * 0.5), M, 0, -R * 0.05, R * 1.1).rotation.x = -0.15;
      for (const sd of [1, -1]) {
        for (let k = 0; k < 5; k++) add(rbox(R * 0.08, R * 0.3, R * 0.36), M, sd * R * 0.39, -R * 0.02, R * (0.75 - k * 0.38));
        add(new THREE.CylinderGeometry(R * 0.05, R * 0.05, R * 1.6, 12), pbrMat(0x2a2c30, 'dark'), sd * R * 0.42, -R * 0.12, R * 0.05).rotation.x = Math.PI / 2;
        // носовые стволы
        for (const y of [0.05, -0.08]) add(new THREE.CylinderGeometry(R * 0.018, R * 0.018, R * 0.5, 8), D, sd * R * 0.2, R * y, R * 1.45).rotation.x = Math.PI / 2;
      }
      add(rbox(R * 0.5, R * 0.16, R * 0.9), M, 0, R * 0.25, -R * 0.2);
      add(rbox(R * 0.36, R * 0.16, R * 0.5), M, 0, R * 0.4, -R * 0.35);
      add(rbox(R * 0.2, R * 0.12, R * 0.28), M, 0, R * 0.54, -R * 0.42);
      const win = new THREE.Mesh(rbox(R * 0.37, R * 0.035, R * 0.45), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: sharedTextures().windowsDense, emissiveIntensity: 1.5 }));
      win.position.set(0, R * 0.43, -R * 0.34); g.add(win);
      for (const x of [0.05, -0.05]) add(new THREE.CylinderGeometry(R * 0.006, R * 0.006, R * 0.2, 5), D, R * x, R * 0.7, -R * 0.45);
      for (let i = 0; i < 4; i++) for (const sd of [1, -1]) addTurret(g, sd * R * 0.2, R * 0.2, R * (0.85 - i * 0.22), R * 0.14, D);
      addTurret(g, 0, R * 0.34, R * 0.25, R * 0.12, D);
      add(rbox(R * 0.8, R * 0.5, R * 0.3), M, 0, 0, -R * 1.05);
      for (const [x, y] of [[0.25, 0.12], [-0.25, 0.12], [0.25, -0.12], [-0.25, -0.12], [0, 0]]) addEngine(g, R * x, R * y, -R * 1.22, R * 0.11, eng);
      greebles(g, R, 70, D, [R * 0.65, R * 0.19, R * 1.8]);
      addLights(g, [[R * 0.44, R * 0.15, R * 0.9, R * 0.015], [-R * 0.44, R * 0.15, R * 0.9, R * 0.015], [R * 0.44, R * 0.15, -R * 0.4, R * 0.015], [-R * 0.44, R * 0.15, -R * 0.4, R * 0.015], [0, R * 0.8, -R * 0.45, R * 0.015]], faction === 'guard' ? 0x80c0ff : 0xff2020);
      break;
    }
    default: add(new THREE.SphereGeometry(R * 0.5, 16, 12), M);
  }
  if (faction === 'pirate') { // шипы на пиратских кораблях
    const r = seeded(type.length * 31);
    for (let i = 0; i < 8; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(R * 0.04, R * 0.35, 6), D);
      const a = r() * Math.PI * 2;
      sp.position.set(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.2, (r() - 0.5) * R);
      sp.rotation.set(0, 0, a - Math.PI / 2); g.add(sp);
    }
  }
  applyBoxUV(g, R * 0.9, true);
  return g;
}

// Дрон: корпус-капсула, три лопасти, светящийся «глаз» и двигатель
function droneModel(item) {
  const key = 'drone:' + item;
  if (!shipCache.has(key)) {
    const g = new THREE.Group();
    const mining = item === 'drone_mine', heavy = item === 'drone_heavy';
    const R = heavy ? 9 : 6;
    const M = hullMat(mining ? 0xc8a050 : 0x8a96a4, 'player');
    const body = new THREE.Mesh(new THREE.SphereGeometry(R * 0.55, 20, 14), M); body.scale.set(1, 0.8, 1.3); g.add(body);
    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(R * 0.08, R * 0.9, R * 0.8), darkMetal());
      fin.rotation.z = i * Math.PI * 2 / 3; fin.translateY(R * 0.55); g.add(fin);
    }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(R * 0.18, 12, 8), glowMat(mining ? 0x60ff90 : 0xff9040, 4));
    eye.position.z = R * 0.7; g.add(eye);
    addEngine(g, 0, 0, -R * 0.75, R * 0.2, 0x60c0ff, 0.6);
    shipCache.set(key, g);
  }
  return shipCache.get(key).clone();
}

function shipModel(type, color, radius, faction) {
  const key = type + color + faction;
  if (!shipCache.has(key)) shipCache.set(key, buildShip(type, color, faction));
  const m = shipCache.get(key).clone();
  const base = SHIP_BASE_R[type] || 50;
  m.scale.setScalar(radius / base);
  return m;
}

function setEngines(obj, frac, time) {
  const f = Math.min(1.3, Math.max(0.12, frac));
  obj.traverse(o => {
    if (o.userData.plume) o.scale.set(1, 0.25 + f * (0.9 + 0.1 * Math.sin(time * 40 + o.id)), 1);
    else if (o.userData.glow) o.scale.setScalar(o.userData.glow * (0.6 + f * 0.6));
    else if (o.userData.blink !== undefined) o.visible = ((time + o.userData.blink) % 2) < 0.25;
    if (o.userData.spin) o.rotation[o.userData.spin[0]] = time * o.userData.spin[1];
  });
}

// ======================================================================
// Астероиды
// ======================================================================
const astGeoCache = [];
function asteroidGeo(variant) {
  if (astGeoCache[variant]) return astGeoCache[variant];
  const n = makeNoise(variant * 977 + 13), n2 = makeNoise(variant * 31 + 7);
  let geo = new THREE.IcosahedronGeometry(1, 5);
  geo.deleteAttribute('uv'); geo.deleteAttribute('normal');
  geo = mergeVertices(geo);
  const pos = geo.attributes.position;
  const r = seeded(variant + 1);
  const stretch = [0.8 + r() * 0.5, 0.6 + r() * 0.3, 0.8 + r() * 0.4];
  const craters = Array.from({ length: 6 }, () => [new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), 0.15 + r() * 0.25, 0.05 + r() * 0.08]);
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let h = 1 + 0.32 * fbm(n, v.x * 1.3, v.y * 1.3, v.z * 1.3, 5) + 0.08 * ridged(n2, v.x * 4, v.y * 4, v.z * 4, 3);
    for (const [c, rad, depth] of craters) {
      const d = v.distanceTo(c);
      if (d < rad) { const k = d / rad; h -= depth * (1 - k * k) - (k > 0.75 ? depth * 0.6 * (1 - Math.abs(k - 0.87) * 8) : 0); }
    }
    pos.setXYZ(i, v.x * h * stretch[0], v.y * h * stretch[1], v.z * h * stretch[2]);
    const shade = 0.55 + 0.35 * fbm(n2, v.x * 3, v.y * 3, v.z * 3, 3) + (h - 1) * 0.6;
    const vein = smooth(0.62, 0.72, ridged(n, v.x * 2.2 + 5, v.y * 2.2, v.z * 2.2, 3));
    colors.set([shade, shade, vein], i * 3); // b-канал временно хранит прожилки руды
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  astGeoCache[variant] = geo;
  return geo;
}

// Мелкий рельеф и пятна на камне считаются в шейдере — поверхность детальна на любом расстоянии
function rockDetail(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjP; varying vec3 vNM0; varying vec3 vNM1; varying vec3 vNM2;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position; vNM0 = normalMatrix[0]; vNM1 = normalMatrix[1]; vNM2 = normalMatrix[2];');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vObjP; varying vec3 vNM0; varying vec3 vNM1; varying vec3 vNM2;
${GLSL_NOISE}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * (0.72 + 0.56 * fbm3(vObjP * 6.0)), opacity );')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  { // градиент шума в пространстве объекта → возмущение нормали (без экранных производных)
    vec3 q = vObjP * 8.0; float e = 0.03; float h0 = fbm3(q);
    vec3 g = vec3(fbm3(q + vec3(e, 0.0, 0.0)) - h0, fbm3(q + vec3(0.0, e, 0.0)) - h0, fbm3(q + vec3(0.0, 0.0, e)) - h0) / e;
    normal = normalize(normal - mat3(vNM0, vNM1, vNM2) * g * 0.09); }`);
  };
}

const ORE_LOOK = {
  ore_ferit: { rock: [0.42, 0.4, 0.38], vein: [0.75, 0.75, 0.78] },
  ore_korundit: { rock: [0.45, 0.32, 0.22], vein: [0.95, 0.5, 0.2] },
  ore_arkselit: { rock: [0.3, 0.34, 0.4], vein: [0.3, 0.75, 1.0] },
  ore_nullium: { rock: [0.25, 0.2, 0.3], vein: [0.8, 0.3, 1.0] }
};
const astMatCache = new Map();
function asteroidModel(radius, seed, ore) {
  const variant = seed % 8;
  const key = ore + variant;
  if (!astMatCache.has(key)) {
    const base = asteroidGeo(variant);
    const look = ORE_LOOK[ore] || ORE_LOOK.ore_ferit;
    const geo = base.clone();
    const c = geo.attributes.color;
    for (let i = 0; i < c.count; i++) {
      const s = c.getX(i), vein = c.getZ(i);
      c.setXYZ(i, lerp(look.rock[0] * s, look.vein[0], vein), lerp(look.rock[1] * s, look.vein[1], vein), lerp(look.rock[2] * s, look.vein[2], vein));
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.08, flatShading: false, envMapIntensity: 0.4 });
    rockDetail(mat);
    astMatCache.set(key, { geo, mat });
  }
  const { geo, mat } = astMatCache.get(key);
  const m = new THREE.Mesh(geo, mat);
  const r = seeded(seed);
  m.rotation.set(r() * 6, r() * 6, r() * 6);
  m.scale.setScalar(radius);
  m.userData.spin = (r() - 0.5) * 0.04;
  return m;
}

// ======================================================================
// Станции и врата
// ======================================================================
function stationModel(style) {
  const T = sharedTextures();
  const g = new THREE.Group();
  const tint = [0xb8c0c8, 0xc8b8a0, 0xa8b8a8][style || 0];
  const M = pbrMat(tint, 'station');
  const D = darkMetal();
  const winMat = new THREE.MeshStandardMaterial({ color: tint, map: T.hull, metalness: 0.6, roughness: 0.5, emissive: 0xffffff, emissiveMap: T.windows, emissiveIntensity: 2.2 });
  winMat.emissiveMap = T.windows.clone(); winMat.emissiveMap.repeat.set(6, 1); winMat.emissiveMap.needsUpdate = true;
  // центральный шпиль
  const spire = new THREE.Mesh(new THREE.LatheGeometry([[0, -3200], [400, -3000], [650, -2200], [500, -1400], [800, -600], [800, 600], [550, 1200], [700, 1900], [300, 2700], [80, 3600]].map(p => new THREE.Vector2(p[0], p[1])), 32), M);
  g.add(spire);
  // жилые кольца
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2300, 230, 20, 120), winMat); ring.rotation.x = Math.PI / 2; g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1500, 120, 16, 96), winMat); ring2.rotation.x = Math.PI / 2; ring2.position.y = 1300; g.add(ring2);
  const ring3 = new THREE.Mesh(new THREE.TorusGeometry(1200, 90, 12, 80), M); ring3.rotation.x = Math.PI / 2; ring3.position.y = -1700; g.add(ring3);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(60, 60, 1500, 8), D);
    sp.rotation.z = Math.PI / 2; sp.rotation.y = a; sp.position.set(Math.cos(a) * 1550, 0, -Math.sin(a) * 1550); g.add(sp);
  }
  // солнечные панели
  const solar = new THREE.MeshStandardMaterial({ map: T.solar, metalness: 0.9, roughness: 0.25, color: 0x8899bb });
  for (const s of [1, -1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(50, 50, 2600, 8), D); arm.rotation.z = Math.PI / 2; arm.position.set(s * 1300, -2500, 0); g.add(arm);
    for (let k = 0; k < 3; k++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(700, 20, 1400), solar); p.position.set(s * (1300 + k * 750), -2500, 0); g.add(p);
    }
  }
  // антенны и док
  for (let i = 0; i < 5; i++) {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(15, 25, 900 + i * 120, 6), D);
    a.position.set(Math.cos(i * 1.3) * 300, 3500 + i * 60, Math.sin(i * 1.3) * 300); a.rotation.z = (i - 2) * 0.12; g.add(a);
  }
  const dockGlow = new THREE.Mesh(new THREE.TorusGeometry(650, 40, 8, 48), glowMat(0x60c8ff, 2.5)); dockGlow.rotation.x = Math.PI / 2; dockGlow.position.y = -3150; g.add(dockGlow);
  const lights = [];
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; lights.push([Math.cos(a) * 2550, 0, Math.sin(a) * 2550, 45]); }
  lights.push([0, 3700, 0, 70], [2600, -2500, 0, 50], [-2600, -2500, 0, 50]);
  addLights(g, lights, 0xff4030);
  greebles(g, 3000, 120, D, [1100, 700, 1100]);
  applyBoxUV(g, 700, false);
  g.userData.spinY = 0.012;
  return g;
}

function gateModel() {
  const g = new THREE.Group();
  const T = sharedTextures();
  const M = pbrMat(0x8e98a6, 'station');
  g.add(new THREE.Mesh(new THREE.TorusGeometry(1500, 140, 24, 96), M));
  const inner = new THREE.Mesh(new THREE.TorusGeometry(1330, 30, 8, 96), glowMat(0x50a0ff, 3)); g.add(inner);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(260, 1100, 380), M);
    pylon.position.set(Math.cos(a) * 1750, Math.sin(a) * 1750, 0); pylon.rotation.z = a - Math.PI / 2; g.add(pylon);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(90, 12, 8), glowMat(0x80c0ff, 4));
    tip.position.set(Math.cos(a) * 2300, Math.sin(a) * 2300, 0); g.add(tip);
  }
  const disk = new THREE.Mesh(new THREE.CircleGeometry(1360, 96), logShader({
    uniforms: { time: GU.time },
    vertex: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); /*LOGDEPTH*/ }`,
    fragment: `uniform float time; varying vec2 vUv;
      void main(){ /*LOGDEPTH*/ vec2 p = vUv * 2.0 - 1.0; float r = length(p); float a = atan(p.y, p.x);
        float swirl = fbm3(vec3(cos(a + r * 4.0 - time * 0.6) * 2.0, sin(a + r * 4.0 - time * 0.6) * 2.0, r * 3.0 - time * 0.3));
        float edge = smoothstep(1.0, 0.85, r);
        vec3 col = mix(vec3(0.1, 0.3, 1.0), vec3(0.5, 0.9, 1.0), swirl) * (0.25 + 0.9 * pow(swirl, 2.0)) * edge;
        col += vec3(0.6, 0.85, 1.0) * pow(r, 6.0) * edge * 1.5;
        gl_FragColor = vec4(col, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  }));
  applyBoxUV(g, 700, false);
  g.add(disk);
  return g;
}

function wreckModel(radius) {
  const g = new THREE.Group();
  const D = darkMetal();
  const burnt = new THREE.MeshStandardMaterial({ color: 0x302820, map: sharedTextures().hull, metalness: 0.6, roughness: 0.85 });
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(radius * (0.2 + Math.random() * 0.8), radius * (0.05 + Math.random() * 0.2), radius * (0.15 + Math.random() * 0.6)), i % 2 ? D : burnt);
    b.position.set((Math.random() - 0.5) * radius * 1.5, (Math.random() - 0.5) * radius * 0.6, (Math.random() - 0.5) * radius * 1.5);
    b.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); g.add(b);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sharedTextures().glow, color: new THREE.Color(0xff7020).multiplyScalar(2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.setScalar(radius * 1.2); g.add(s); g.userData.flicker = s;
  return g;
}

// ======================================================================
// Небесные тела
// ======================================================================
const PLANET_LOOK = {
  'Каменистая': { atmo: 0x9ab0c8, atmoK: 0.6 },
  'Газовый гигант': { atmo: 0xffc890, atmoK: 1.2 },
  'Ледяная': { atmo: 0xb0e0ff, atmoK: 1.0 },
  'Лавовая': { atmo: 0xff6030, atmoK: 0.9 },
  'Океаническая': { atmo: 0x5aa8ff, atmoK: 1.5 },
  'Пустынная': { atmo: 0xffc080, atmoK: 0.8 }
};

const PTYPE_ID = { 'Каменистая': 0, 'Газовый гигант': 1, 'Ледяная': 2, 'Лавовая': 3, 'Океаническая': 4, 'Пустынная': 5 };

// Поверхность планеты считается в шейдере для каждого пикселя — детализация не теряется вблизи
const PLANET_FRAG = `
uniform int ptype; uniform float seed; uniform vec3 sunDir; uniform vec3 tint;
varying vec3 vP; varying vec3 vWN;
float ridge(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * (1.0 - abs(vnoise(p) * 2.0 - 1.0)); p *= 2.1; a *= 0.5; } return s; }
float fbm8(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 9; i++) { s += a * vnoise(p); p = p * 2.02 + 0.37; a *= 0.5; } return s; }
void main(){
  /*LOGDEPTH*/
  vec3 p = normalize(vP);
  vec3 q = p * 2.2 + seed;
  vec3 col; vec3 em = vec3(0.0);
  float h = fbm8(q + fbm3(q * 0.8) * 0.6);
  if (ptype == 1) {
    float t = fbm3(q * 1.3);
    float band = p.y * 7.0 + (t - 0.5) * 2.2 + (fbm8(vec3(q.x * 3.0, p.y * 40.0, q.z * 3.0)) - 0.5) * 0.4;
    col = mix(vec3(0.82, 0.68, 0.5), vec3(0.55, 0.35, 0.22), 0.5 + 0.5 * sin(band * 2.6 + seed));
    col = mix(col, vec3(0.94, 0.88, 0.76), smoothstep(0.55, 0.8, fbm3(vec3(q.x * 2.0, p.y * 18.0, q.z * 2.0))) * 0.6);
    float spot = length(vec2(atan(p.z, p.x) - 1.0, (p.y + 0.3) * 3.0));
    col = mix(vec3(0.7, 0.28, 0.14), col, smoothstep(0.12, 0.3, spot + (t - 0.5) * 0.15));
  } else if (ptype == 2) {
    float crack = pow(ridge(q * 2.0), 5.0);
    col = mix(vec3(0.62, 0.75, 0.88), vec3(0.95, 0.97, 1.0), smoothstep(0.35, 0.65, h));
    col = mix(col, vec3(0.2, 0.42, 0.7), clamp(crack * 1.6, 0.0, 1.0));
  } else if (ptype == 3) {
    float crack = pow(ridge(q * 1.6), 4.0);
    col = mix(vec3(0.06, 0.05, 0.05), vec3(0.22, 0.17, 0.15), smoothstep(0.3, 0.7, h));
    float lava = smoothstep(0.35, 0.8, crack) + smoothstep(0.42, 0.3, h) * 0.8;
    col = mix(col, vec3(0.9, 0.35, 0.08), clamp(lava, 0.0, 1.0));
    em = vec3(2.2, 0.7, 0.12) * clamp(lava, 0.0, 1.0);
  } else if (ptype == 4) {
    float land = smoothstep(0.52, 0.535, h);
    vec3 sea = mix(vec3(0.01, 0.05, 0.16), vec3(0.04, 0.2, 0.36), smoothstep(0.35, 0.53, h));
    vec3 ground = mix(vec3(0.2, 0.36, 0.13), vec3(0.45, 0.38, 0.25), smoothstep(0.56, 0.68, h));
    ground = mix(ground, vec3(0.9), smoothstep(0.7, 0.76, h));
    col = mix(sea, ground, land);
    col = mix(col, vec3(0.93, 0.96, 1.0), smoothstep(0.8, 0.88, abs(p.y) + (fbm3(q * 3.0) - 0.5) * 0.15));
    float city = smoothstep(0.62, 0.8, vnoise(p * 900.0 + seed)) * smoothstep(0.55, 0.75, fbm3(q * 4.0)) * land * (1.0 - smoothstep(0.62, 0.7, h));
    em = vec3(1.0, 0.7, 0.35) * city * 1.4;
  } else if (ptype == 5) {
    float dune = sin(dot(p, vec3(60.0, 13.0, 40.0)) + fbm3(q * 4.0) * 10.0) * 0.03;
    col = mix(vec3(0.6, 0.36, 0.2), vec3(0.88, 0.66, 0.42), smoothstep(0.35, 0.65, h + dune));
    col = mix(col, vec3(0.5, 0.33, 0.24), smoothstep(0.6, 0.75, ridge(q * 2.5)) * 0.6);
  } else {
    float r = ridge(q * 2.0);
    col = mix(vec3(0.22, 0.21, 0.2), vec3(0.6, 0.56, 0.5), smoothstep(0.3, 0.7, h));
    col = mix(col, vec3(0.75, 0.72, 0.68), smoothstep(0.7, 0.85, r) * 0.5);
  }
  col *= tint;
  vec3 n = normalize(vWN);
  float d = dot(n, sunDir);
  float light = clamp(d * 1.1 + 0.05, 0.0, 1.0);
  float spec = (ptype == 4) ? pow(max(0.0, d), 30.0) * (1.0 - smoothstep(0.52, 0.535, h)) * 0.4 : 0.0;
  vec3 c = col * light * 1.35 + vec3(1.0, 0.95, 0.85) * spec + col * 0.012 + em * (1.0 - smoothstep(-0.15, 0.15, d));
  gl_FragColor = vec4(c, 1.0);
}`;

const CLOUD_FRAG = `
uniform float seed; uniform vec3 sunDir; uniform float time; uniform float amount;
varying vec3 vP; varying vec3 vWN;
void main(){
  /*LOGDEPTH*/
  vec3 p = normalize(vP);
  vec3 q = p * 3.0 + seed + vec3(time * 0.004, 0.0, 0.0);
  float w = fbm3(q * 0.7);
  float c = smoothstep(0.5 - amount * 0.1, 0.78, fbm3(q + w * 1.2) * 0.7 + fbm3(q * 4.0) * 0.3);
  float d = dot(normalize(vWN), sunDir);
  float light = clamp(d * 1.2 + 0.1, 0.0, 1.0);
  gl_FragColor = vec4(vec3(1.0, 0.98, 0.95) * light * 1.2, c * 0.85 * amount);
}`;

const PLANET_VERT = `varying vec3 vP; varying vec3 vWN;
  void main(){ vP = position; vWN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); /*LOGDEPTH*/ }`;

function planetModel(c) {
  const g = new THREE.Group();
  const look = PLANET_LOOK[c.ptype] || PLANET_LOOK['Каменистая'];
  const seed = c.hue * 100;
  const r = seeded(Math.floor(c.hue * 1e6) + 3);
  const sunDir = { value: new THREE.Vector3(1, 0, 0) };
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), logShader({
    uniforms: { ptype: { value: PTYPE_ID[c.ptype] || 0 }, seed: { value: seed }, sunDir,
      tint: { value: new THREE.Vector3(0.9 + r() * 0.2, 0.9 + r() * 0.2, 0.9 + r() * 0.2) } },
    vertex: PLANET_VERT, fragment: PLANET_FRAG
  }));
  g.add(body);
  const cloudy = { 'Океаническая': 1, 'Каменистая': 0.45, 'Ледяная': 0.4 }[c.ptype];
  let clouds = null;
  if (cloudy) {
    clouds = new THREE.Mesh(new THREE.SphereGeometry(1.01, 128, 64), logShader({
      uniforms: { seed: { value: seed + 17 }, sunDir, time: GU.time, amount: { value: cloudy } },
      vertex: PLANET_VERT, fragment: CLOUD_FRAG, transparent: true, depthWrite: false
    }));
    g.add(clouds);
  }
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.02, 96, 48), fresnelMaterial(look.atmo, 4.5, look.atmoK * 1.3, true));
  atmo.material.uniforms.sunDir = sunDir;
  g.add(atmo);
  g.userData = { unit: true, body, clouds, atmo, sunDir };
  g.rotation.z = 0.2 + c.hue * 0.3;
  return g;
}

function sunModel() {
  const g = new THREE.Group();
  const T = sharedTextures();
  const surface = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), logShader({
    uniforms: { time: GU.time },
    vertex: `varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; /*LOGDEPTH*/ }`,
    fragment: `uniform float time; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){ /*LOGDEPTH*/ float n = fbm3(vP * 6.0 + vec3(time * 0.05)); float n2 = fbm3(vP * 22.0 - vec3(time * 0.1));
        float limb = pow(max(dot(vN, vV), 0.0), 0.45);
        vec3 col = mix(vec3(4.0, 1.6, 0.5), vec3(6.0, 4.5, 2.6), n * 0.7 + n2 * 0.5) * (0.55 + 0.45 * limb);
        gl_FragColor = vec4(col, 1.0); }`
  }));
  g.add(surface);
  const corona = new THREE.Mesh(new THREE.SphereGeometry(1.15, 64, 32), fresnelMaterial(0xffb060, 1.6, 2.5, false));
  g.add(corona);
  for (const [s, c, k] of [[5, 0xffe0b0, 1.6], [14, 0xffa050, 0.7], [40, 0xff8040, 0.25]]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: new THREE.Color(c).multiplyScalar(k), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
    sp.scale.setScalar(s); g.add(sp);
  }
  // блики в объективе
  if (!TEX.flareRing) {
    TEX.flareRing = canvasTex(128, 128, (c, W) => {
      const grd = c.createRadialGradient(64, 64, 40, 64, 64, 62);
      grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = grd; c.fillRect(0, 0, W, W);
    });
    TEX.flareHex = canvasTex(128, 128, (c) => {
      c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; c[i ? 'lineTo' : 'moveTo'](64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58); }
      c.fill();
    });
  }
  const flare = new Lensflare();
  flare.addElement(new LensflareElement(TEX.glow, 380, 0, new THREE.Color(1, 0.9, 0.75)));
  flare.addElement(new LensflareElement(TEX.flareHex, 50, 0.35, new THREE.Color(0.12, 0.18, 0.3)));
  flare.addElement(new LensflareElement(TEX.flareHex, 80, 0.55, new THREE.Color(0.25, 0.15, 0.1)));
  flare.addElement(new LensflareElement(TEX.flareRing, 110, 0.75, new THREE.Color(0.12, 0.25, 0.18)));
  flare.addElement(new LensflareElement(TEX.flareHex, 36, 0.9, new THREE.Color(0.2, 0.14, 0.3)));
  flare.addElement(new LensflareElement(TEX.flareRing, 180, 1.1, new THREE.Color(0.1, 0.15, 0.3)));
  g.add(flare);
  g.userData.flare = flare;
  g.userData.unit = true;
  return g;
}

// ======================================================================
// Инициализация
// ======================================================================
export function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(1.75, devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  pmrem = new THREE.PMREMGenerator(renderer);
  sharedTextures();
  camera = new THREE.PerspectiveCamera(60, 1, 1, 5e9);
  ambient = new THREE.AmbientLight(0x8090b0, 0.3);
  scene.add(ambient);
  scene.environmentIntensity = 0.7;
  sunLight = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.02;
  // слабый холодный контровой свет с теневой стороны, чтобы силуэты читались
  rimLight = new THREE.DirectionalLight(0x7090ff, 0.9);
  scene.add(rimLight);
  scene.add(sunLight, sunLight.target);
  celGroup = new THREE.Group(); entGroup = new THREE.Group(); fxGroup = new THREE.Group();
  scene.add(celGroup, entGroup, fxGroup);

  // космическая пыль вокруг корабля — даёт ощущение скорости
  const DN = 900, dpos = new Float32Array(DN * 3), dseed = new Float32Array(DN * 3);
  for (let i = 0; i < DN * 3; i++) dseed[i] = Math.random();
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: 0x8a96a8, map: TEX.glowHard, transparent: true, depthWrite: false, opacity: 0.7, blending: THREE.AdditiveBlending }));
  dust.frustumCulled = false; dust.userData.seed = dseed;
  scene.add(dust);

  // варп-туннель
  const n = 600, arr = new Float32Array(n * 6), wcol = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) { const b = 0.4 + Math.random() * 0.6, blue = Math.random() < 0.7; wcol.set(blue ? [0.5 * b, 0.8 * b, b * 1.4, 0, 0, 0] : [b, b, b, 0, 0, 0], i * 6); }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  wg.setAttribute('color', new THREE.BufferAttribute(wcol, 3));
  warpLines = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  warpLines.frustumCulled = false; warpLines.userData.seed = Array.from({ length: n }, () => [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
  scene.add(warpLines);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
      void main(){
        vec2 d = vUv - 0.5;
        // лёгкая хроматическая аберрация к краям
        float ca = dot(d, d) * 0.006;
        vec4 c = vec4(texture2D(tDiffuse, vUv + d * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d * ca).b, 1.0);
        float v = smoothstep(0.95, 0.3, length(d * vec2(1.0, 0.85)));
        c.rgb *= mix(0.45, 1.0, v);
        float n = fract(sin(dot(vUv * vec2(1931.7, 1087.3) + time, vec2(12.9898, 78.233))) * 43758.5453);
        c.rgb += (n - 0.5) * 0.022;
        gl_FragColor = c;
      }`
  });
  composer.addPass(grade);

  buildSky('lobby', 1);
  resize();
  addEventListener('resize', resize);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}

// ======================================================================
// Система
// ======================================================================
export function setSystem(sys) {
  for (const { obj } of celMeshes.values()) celGroup.remove(obj);
  celMeshes.clear();
  for (const id of [...entMeshes.keys()]) removeEnt(id);
  buildSky(sys.id, sys.sec);
  for (const c of sys.celestials) {
    let obj = null;
    if (c.kind === 'sun') obj = sunModel();
    else if (c.kind === 'planet') obj = planetModel(c);
    else if (c.kind === 'station') obj = stationModel(c.style);
    else if (c.kind === 'gate') obj = gateModel();
    if (!obj) continue;
    celGroup.add(obj);
    celMeshes.set(c.id, { obj, data: c });
  }
}

// ======================================================================
// Сущности
// ======================================================================
function makeEnt(e, data) {
  let obj;
  if (e.k === 's') {
    const t = data.ships[e.st];
    const faction = e.gd ? 'guard' : e.npc ? 'pirate' : 'player';
    const col = e.gd ? 0xd8e4f0 : e.npc ? 0x4a3a38 : t.color;
    obj = shipModel(e.st, col, e.r || t.radius, faction);
  } else if (e.k === 'd') obj = droneModel(e.item);
  else if (e.k === 'a') obj = asteroidModel(e.r, e.sd, e.ore);
  else if (e.k === 'w') obj = wreckModel(e.r || 60);
  else return null;
  entGroup.add(obj);
  const rec = { obj, kind: e.k, seen: 0 };
  entMeshes.set(e.id, rec);
  return rec;
}
function removeEnt(id) {
  const r = entMeshes.get(id);
  if (!r) return;
  entGroup.remove(r.obj);
  entMeshes.delete(id);
}

let myShip = null, myShipType = null;
export function setMyShip(type, data) {
  if (myShip && myShipType === type) return;
  if (myShip) entGroup.remove(myShip);
  myShipType = type;
  if (!type) { myShip = null; return; }
  const t = data.ships[type];
  myShip = shipModel(type, t.color, t.radius, 'player');
  cam.target = cam.dist = t.radius * 9;
  entGroup.add(myShip);
}

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
function placeFar(obj, rel, radius, isUnit) {
  const d = Math.hypot(rel[0], rel[1], rel[2]);
  let k = 1;
  if (d > FAR_START) { const rd = FAR_START * (1 + Math.log(d / FAR_START)); k = rd / d; }
  obj.position.set(rel[0] * k, rel[1] * k, rel[2] * k);
  obj.scale.setScalar(isUnit ? radius * k : k);
}

// ======================================================================
// Кадр
// ======================================================================
export function frame(view, dt, time) {
  GU.time.value = time;
  grade.uniforms.time.value = time % 100;
  const origin = view.origin;

  cam.dist += (cam.target - cam.dist) * Math.min(1, dt * 8);
  const cp = Math.cos(cam.pitch);
  camera.position.set(Math.sin(cam.yaw) * cp * cam.dist, Math.sin(cam.pitch) * cam.dist, Math.cos(cam.yaw) * cp * cam.dist);
  camera.lookAt(0, 0, 0);
  camera.near = Math.max(0.5, cam.dist * 0.01);
  camera.updateProjectionMatrix();
  if (starField) starField.position.copy(camera.position);
  if (skyDome) skyDome.position.copy(camera.position);

  if (view.docked) { stationFrame(view, dt, time); return; }
  if (stationView) { scene.remove(stationView); stationView = null; celGroup.visible = entGroup.visible = true; dust.visible = true; }

  // направление на звезду
  const sunRel = [-origin[0], -origin[1], -origin[2]];
  const sl = Math.hypot(...sunRel) || 1;
  const sunDir = tmpV2.set(sunRel[0] / sl, sunRel[1] / sl, sunRel[2] / sl);
  sunLight.position.copy(sunDir).multiplyScalar(1e5);
  sunLight.target.position.set(0, 0, 0);
  rimLight.position.copy(sunDir).multiplyScalar(-1e5).add(tmpV.set(0, 3e4, 0));
  if (myShip) {
    const R = view.data.ships[view.me.st].radius * 3;
    const sc = sunLight.shadow.camera;
    if (sc.right !== R) { sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1e5 - R * 2; sc.far = 1e5 + R * 2; sc.updateProjectionMatrix(); }
  }

  for (const { obj, data } of celMeshes.values()) {
    const rel = [data.pos[0] - origin[0], data.pos[1] - origin[1], data.pos[2] - origin[2]];
    placeFar(obj, rel, data.radius, obj.userData.unit);
    if (obj.userData.spinY) obj.rotation.y += obj.userData.spinY * dt;
    if (data.kind === 'gate') {
      tmpV.set(-data.pos[0], -data.pos[1], -data.pos[2]).normalize().add(obj.position);
      obj.lookAt(tmpV);
    } else if (data.kind === 'planet') {
      obj.userData.body.rotation.y += dt * 0.004;
      if (obj.userData.clouds) obj.userData.clouds.rotation.y += dt * 0.005;
      // направление на солнце от планеты (освещение поверхности, облаков и атмосферы)
      obj.userData.sunDir.value.set(-data.pos[0], -data.pos[1], -data.pos[2]).normalize();
    }
    setEngines(obj, 0, time);
  }

  if (myShip) {
    myShip.position.set(0, 0, 0);
    const h = view.me.h;
    tmpV.set(h[0], h[1], h[2]);
    if (tmpV.lengthSq() > 0.01) myShip.lookAt(tmpV);
    const sf = Math.hypot(...view.me.v) / (view.me.max.spd || 1);
    setEngines(myShip, sf, time);
    if (quality !== 'low') updateTrail('me', origin, view.me.h, view.data.ships[view.me.st].radius, sf, 0x3aa8ff, origin, time, !!view.me.warp);
  }

  for (const rec of entMeshes.values()) rec.seen = 0;
  for (const e of view.ents.values()) {
    const rec = entMeshes.get(e.id) || makeEnt(e, view.data);
    if (!rec) continue;
    rec.seen = 1;
    const rel = [e.dp[0] - origin[0], e.dp[1] - origin[1], e.dp[2] - origin[2]];
    rec.obj.position.set(rel[0], rel[1], rel[2]);
    if (e.k === 's') {
      if (e.h) { tmpV.set(rel[0] + e.h[0], rel[1] + e.h[1], rel[2] + e.h[2]); rec.obj.lookAt(tmpV); }
      rec.obj.visible = !e.w || Math.hypot(...rel) < 2e6;
      const t = view.data.ships[e.st];
      const sf = e.v ? Math.hypot(...e.v) / (t ? t.maxSpeed : 300) : 0;
      setEngines(rec.obj, sf, time);
      if (quality !== 'low' && e.h && Math.hypot(...rel) < 60000) updateTrail(e.id, e.dp, e.h, e.r || 50, sf, e.npc ? 0xff4020 : e.gd ? 0x9fd0ff : 0x3aa8ff, origin, time, !!e.w);
    } else if (e.k === 'd') {
      if (e.v && Math.hypot(...e.v) > 1) { tmpV.set(rel[0] + e.v[0], rel[1] + e.v[1], rel[2] + e.v[2]); rec.obj.lookAt(tmpV); }
      setEngines(rec.obj, 1, time);
    } else if (e.k === 'a') rec.obj.rotation.y += rec.obj.userData.spin * dt;
    else if (e.k === 'w') rec.obj.userData.flicker.material.opacity = 0.5 + 0.5 * Math.random();
  }
  for (const [id, rec] of [...entMeshes]) if (!rec.seen) removeEnt(id);

  sweepTrails();
  updateDust(origin, view.me);
  updateFx(view, dt, origin);
  updateWarp(view, dt);
  composer.render();
}

// ---------- инверсионные следы двигателей ----------
const trails = new Map(); // id -> { pts: [{p, t}], mesh }
const TRAIL_LIFE = 1.0, TRAIL_N = 40;
function trailFor(id, color) {
  let tr = trails.get(id);
  if (tr) return tr;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
  const idx = [];
  for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  mesh.frustumCulled = false;
  fxGroup.add(mesh);
  tr = { pts: [], mesh, color: new THREE.Color(color), seen: 0 };
  trails.set(id, tr);
  return tr;
}
function updateTrail(id, abs, heading, radius, speedFrac, color, origin, time, warping) {
  const tr = trailFor(id, color);
  tr.seen = 1;
  if (warping) { tr.pts.length = 0; }
  const tail = [abs[0] - heading[0] * radius * 0.95, abs[1] - heading[1] * radius * 0.95, abs[2] - heading[2] * radius * 0.95];
  const last = tr.pts[tr.pts.length - 1];
  if (!warping && speedFrac > 0.08 && (!last || Math.hypot(tail[0] - last.p[0], tail[1] - last.p[1], tail[2] - last.p[2]) > radius * 0.15)) {
    tr.pts.push({ p: tail, t: time });
    if (tr.pts.length > TRAIL_N) tr.pts.shift();
  }
  while (tr.pts.length && time - tr.pts[0].t > TRAIL_LIFE) tr.pts.shift();
  const pos = tr.mesh.geometry.attributes.position.array, col = tr.mesh.geometry.attributes.color.array;
  pos.fill(0); col.fill(0);
  const n = tr.pts.length;
  const w = radius * 0.14;
  const v = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3(), view = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = tr.pts[i].p, q = tr.pts[Math.min(n - 1, i + 1)].p, o = tr.pts[Math.max(0, i - 1)].p;
    v.set(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]);
    dir.set(q[0] - o[0], q[1] - o[1], q[2] - o[2]).normalize();
    view.copy(camera.position).sub(v);
    side.crossVectors(dir, view).normalize();
    const age = (time - tr.pts[i].t) / TRAIL_LIFE;
    const k = (1 - age) * (i / Math.max(1, n - 1));
    const ww = w * (0.3 + 0.7 * (1 - age));
    pos.set([v.x + side.x * ww, v.y + side.y * ww, v.z + side.z * ww, v.x - side.x * ww, v.y - side.y * ww, v.z - side.z * ww], i * 6);
    const c = tr.color, b = k * k * k * 0.25;
    col.set([c.r * b, c.g * b, c.b * b, c.r * b, c.g * b, c.b * b], i * 6);
  }
  tr.mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
  tr.mesh.geometry.attributes.position.needsUpdate = true;
  tr.mesh.geometry.attributes.color.needsUpdate = true;
}
function sweepTrails() {
  for (const [id, tr] of trails) {
    if (!tr.seen) { fxGroup.remove(tr.mesh); tr.mesh.geometry.dispose(); trails.delete(id); }
    else tr.seen = 0;
  }
}

function updateDust(origin, me) {
  const S = Math.max(1500, cam.dist * 5);
  const arr = dust.geometry.attributes.position.array, sd = dust.userData.seed;
  const ox = ((origin[0] % S) + S) % S, oy = ((origin[1] % S) + S) % S, oz = ((origin[2] % S) + S) % S;
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = ((sd[i] * S - ox) % S + S) % S - S / 2;
    arr[i + 1] = ((sd[i + 1] * S - oy) % S + S) % S - S / 2;
    arr[i + 2] = ((sd[i + 2] * S - oz) % S + S) % S - S / 2;
  }
  dust.geometry.attributes.position.needsUpdate = true;
  dust.visible = !(me && me.warp);
}

// ---------- вид станции (при стыковке) ----------
function stationFrame(view, dt, time) {
  if (!stationView) {
    stationView = new THREE.Group();
    const st = stationModel(view.docked.style || 0);
    stationView.add(st);
    stationView.userData.st = st;
    scene.add(stationView);
    celGroup.visible = entGroup.visible = false; dust.visible = false;
  }
  if (view.dockedShip && stationView.userData.shipType !== view.dockedShip) {
    if (stationView.userData.ship) stationView.remove(stationView.userData.ship);
    const t = view.data.ships[view.dockedShip];
    const sh = shipModel(view.dockedShip, t.color, 900, 'player');
    sh.position.set(2200, -1200, 5200);
    stationView.add(sh); stationView.userData.ship = sh; stationView.userData.shipType = view.dockedShip;
  }
  sunLight.position.set(1, 0.5, 0.7).multiplyScalar(1e5);
  stationView.userData.st.rotation.y += dt * 0.03;
  setEngines(stationView, 0, time);
  if (stationView.userData.ship) { stationView.userData.ship.rotation.y = time * 0.12; stationView.userData.ship.position.y = -1200 + Math.sin(time * 0.6) * 80; }
  camera.position.set(Math.sin(time * 0.025) * 9000 + 3000, 1800, Math.cos(time * 0.025) * 9000 + 9000);
  camera.lookAt(1500, -600, 2500);
  camera.near = 20; camera.updateProjectionMatrix();
  if (starField) starField.position.copy(camera.position);
  if (skyDome) skyDome.position.copy(camera.position);
  warpLines.material.opacity = 0;
  composer.render();
}

// ======================================================================
// Эффекты
// ======================================================================
function entRel(view, id, origin) {
  if (id === view.me.id) return new THREE.Vector3(0, 0, 0);
  const e = view.ents.get(id);
  if (!e) return null;
  return new THREE.Vector3(e.dp[0] - origin[0], e.dp[1] - origin[1], e.dp[2] - origin[2]);
}
function entRadius(view, id) {
  if (id === view.me.id) return view.data.ships[view.me.st].radius;
  const e = view.ents.get(id);
  return e ? (e.r || 50) : 50;
}
function sprite(color, k = 2) {
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: new THREE.Color(color).multiplyScalar(k), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
}
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);

export function addFx(fx, view) {
  const origin = view.origin;
  if (fx.k === 'beam' || fx.k === 'mine') {
    const col = new THREE.Color(fx.color || 0xff4040);
    const glow = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const core = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).lerp(col, 0.4).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    fxGroup.add(glow, core);
    const muzzle = sprite(col, 3); fxGroup.add(muzzle);
    const miss = fx.hit === false ? new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(entRadius(view, fx.to) * 8) : null;
    fxList.push({ glow, core, muzzle, from: fx.from, to: fx.to, t: 0, dur: fx.dur || 1, kind: fx.k, miss });
    if (fx.hit) {
      const p = entRel(view, fx.to, origin);
      if (p) {
        spark(fx.color, fx.to, entRadius(view, fx.to));
        const tgt = view.ents.get(fx.to);
        const shieldUp = fx.to === view.me.id ? view.me.sh > view.me.max.sh * 0.03 : tgt && tgt.sh > 0.03;
        if (fx.k === 'beam' && shieldUp) shieldFlash(fx.to, entRadius(view, fx.to));
      }
    }
  } else if (fx.k === 'boom') explosion(fx.pos, fx.size || 300);
  else if (fx.k === 'jump') {
    const s = sprite(0x60b0ff, 3); fxGroup.add(s);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x80c8ff).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    fxGroup.add(ring);
    fxList.push({ sprite: s, ring, abs: fx.pos, t: 0, dur: 1.6, kind: 'flash', size: 5000 });
  }
}

function spark(color, id, r) {
  const s = sprite(color || 0xffaa66, 3);
  fxGroup.add(s);
  fxList.push({ sprite: s, follow: id, t: 0, dur: 0.5, kind: 'spark', size: r * 1.5, jitter: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(r * 0.8) });
}

const lastShield = new Map();
function shieldFlash(id, r) {
  // не чаще раза в 0.4 с на цель, иначе вспышки складываются в белый шар
  const now = performance.now();
  if (now - (lastShield.get(id) || 0) < 400) return;
  lastShield.set(id, now);
  if (lastShield.size > 200) lastShield.clear();
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 1.4, 5), fresnelMaterial(0x3a7cff, 3.5, 0.45, false));
  fxGroup.add(m);
  fxList.push({ shield: m, follow: id, t: 0, dur: 0.6, kind: 'shield' });
}

function explosion(pos, size) {
  const parts = [];
  const flash = sprite(0xfff0d0, 6); fxGroup.add(flash);
  for (let i = 0; i < 7; i++) {
    const s = sprite(i % 2 ? 0xff7a20 : 0xffb050, 2.5); fxGroup.add(s);
    parts.push({ s, off: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(size * 0.8), grow: 0.6 + Math.random() });
  }
  const N = 260, pp = new Float32Array(N * 3), vel = [];
  for (let i = 0; i < N; i++) vel.push(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(size * (0.5 + Math.random() * 2.5)));
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  const sparks = new THREE.Points(pg, new THREE.PointsMaterial({ color: new THREE.Color(0xffc070).multiplyScalar(3), size: 3, sizeAttenuation: false, map: TEX.glowHard, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  sparks.frustumCulled = false; fxGroup.add(sparks);
  const wave = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), fresnelMaterial(0xff9a50, 1.5, 2, false)); fxGroup.add(wave);
  const debris = [];
  const D = darkMetal();
  for (let i = 0; i < 14; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 0.7), D);
    d.scale.setScalar(size * (0.04 + Math.random() * 0.08)); fxGroup.add(d);
    debris.push({ d, v: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(size * 0.6), spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(4) });
  }
  fxList.push({ kind: 'boom', abs: pos, t: 0, dur: 3.5, size, flash, parts, sparks, vel, wave, debris });
}

function disposeFx(f) {
  for (const k of ['glow', 'core', 'muzzle', 'sprite', 'ring', 'shield', 'flash', 'sparks', 'wave']) if (f[k]) { fxGroup.remove(f[k]); if (f[k].material) f[k].material.dispose(); if (f[k].geometry && f[k].geometry !== beamGeo) f[k].geometry.dispose(); }
  if (f.parts) for (const p of f.parts) { fxGroup.remove(p.s); p.s.material.dispose(); }
  if (f.debris) for (const d of f.debris) { fxGroup.remove(d.d); d.d.geometry.dispose(); }
}

function updateFx(view, dt, origin) {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i];
    f.t += dt;
    const k = f.t / f.dur;
    if (k >= 1) { disposeFx(f); fxList.splice(i, 1); continue; }
    if (f.glow) {
      const a = entRel(view, f.from, origin), b = entRel(view, f.to, origin);
      if (!a || !b) { f.t = f.dur; continue; }
      if (f.miss) b.add(f.miss);
      const mid = a.clone().add(b).multiplyScalar(0.5), d = a.distanceTo(b);
      const w = Math.max(0.4, cam.dist * 0.0012);
      const fade = f.kind === 'mine' ? 0.7 + 0.3 * Math.sin(f.t * 14) : Math.pow(1 - k, 1.5);
      for (const [m, ww] of [[f.glow, w * 2.5], [f.core, w * 0.5]]) {
        m.position.copy(mid); m.lookAt(b); m.rotateX(Math.PI / 2);
        m.scale.set(ww, d, ww); m.material.opacity = fade * (m === f.glow ? 0.35 : 0.9);
      }
      f.muzzle.position.copy(a.clone().lerp(b, Math.min(0.5, 30 / Math.max(1, d))));
      f.muzzle.scale.setScalar(w * 10); f.muzzle.material.opacity = fade * 0.6;
    } else if (f.kind === 'boom') {
      const c = new THREE.Vector3(f.abs[0] - origin[0], f.abs[1] - origin[1], f.abs[2] - origin[2]);
      const s = f.size;
      f.flash.position.copy(c); f.flash.scale.setScalar(s * (2 + k * 8)); f.flash.material.opacity = Math.max(0, 1 - k * 4);
      for (const p of f.parts) {
        p.s.position.copy(c).add(p.off.clone().multiplyScalar(0.3 + k * 1.5));
        p.s.scale.setScalar(s * p.grow * (0.6 + Math.sqrt(k) * 2.5));
        p.s.material.opacity = Math.pow(1 - k, 2);
        p.s.material.color.setRGB(2.5 * (1 - k * 0.5), 1.2 * (1 - k), 0.4 * (1 - k));
      }
      const arr = f.sparks.geometry.attributes.position.array;
      for (let j = 0; j < f.vel.length; j++) { const v = f.vel[j]; arr[j * 3] = c.x + v.x * f.t; arr[j * 3 + 1] = c.y + v.y * f.t; arr[j * 3 + 2] = c.z + v.z * f.t; }
      f.sparks.geometry.attributes.position.needsUpdate = true;
      f.sparks.material.opacity = 1 - k;
      f.wave.position.copy(c); f.wave.scale.setScalar(s * (0.3 + k * 6)); f.wave.material.uniforms.opacity.value = Math.max(0, 1 - k * 1.6);
      for (const d of f.debris) {
        d.d.position.copy(c).addScaledVector(d.v, f.t);
        d.d.rotation.set(d.spin.x * f.t, d.spin.y * f.t, d.spin.z * f.t);
      }
    } else if (f.kind === 'flash') {
      const c = new THREE.Vector3(f.abs[0] - origin[0], f.abs[1] - origin[1], f.abs[2] - origin[2]);
      f.sprite.position.copy(c); f.sprite.scale.setScalar(f.size * (0.3 + k)); f.sprite.material.opacity = 1 - k;
      f.ring.position.copy(c); f.ring.lookAt(camera.position); f.ring.scale.setScalar(f.size * 0.3 * (0.2 + k * 2)); f.ring.material.opacity = 1 - k;
    } else if (f.kind === 'spark') {
      const p = entRel(view, f.follow, origin);
      if (p) f.sprite.position.copy(p.add(f.jitter));
      f.sprite.scale.setScalar(f.size * (1 + k)); f.sprite.material.opacity = 1 - k;
    } else if (f.kind === 'shield') {
      const p = entRel(view, f.follow, origin);
      if (p) f.shield.position.copy(p);
      f.shield.material.uniforms.opacity.value = Math.pow(1 - k, 2);
    }
  }
}

function updateWarp(view, dt) {
  const w = view.me && view.me.warp;
  const m = warpLines.material;
  const target = w && w.prog > 0.04 && w.prog < 0.96 ? 1 : 0;
  m.opacity += (target - m.opacity) * Math.min(1, dt * 3);
  camera.fov += ((target ? 78 : 60) - camera.fov) * Math.min(1, dt * 2.5);
  camera.updateProjectionMatrix();
  bloom.strength = 0.7 + m.opacity * 0.5;
  if (m.opacity < 0.01) { warpLines.visible = false; return; }
  warpLines.visible = true;
  const v = view.me.v;
  const dir = new THREE.Vector3(v[0], v[1], v[2]).normalize();
  if (dir.lengthSq() < 0.5) return;
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const s1 = new THREE.Vector3().crossVectors(dir, up).normalize();
  const s2 = new THREE.Vector3().crossVectors(dir, s1).normalize();
  const arr = warpLines.geometry.attributes.position.array;
  const R = cam.dist * 2.5, L = cam.dist * 25;
  warpLines.userData.seed.forEach((sd, i) => {
    sd[2] -= dt * 3; if (sd[2] < -1) sd[2] += 2;
    const ang = (sd[0] + 1) * Math.PI, rad = R * (0.35 + Math.abs(sd[1]));
    const base = s1.clone().multiplyScalar(Math.cos(ang) * rad).add(s2.clone().multiplyScalar(Math.sin(ang) * rad)).add(dir.clone().multiplyScalar(sd[2] * L));
    const tail = base.clone().add(dir.clone().multiplyScalar(-L * 0.12));
    arr.set([base.x, base.y, base.z, tail.x, tail.y, tail.z], i * 6);
  });
  warpLines.geometry.attributes.position.needsUpdate = true;
}

// ======================================================================
// Утилиты для интерфейса
// ======================================================================
export function project(rel) {
  const d = Math.hypot(rel[0], rel[1], rel[2]);
  let k = 1;
  if (d > FAR_START) k = FAR_START * (1 + Math.log(d / FAR_START)) / d;
  tmpV.set(rel[0] * k, rel[1] * k, rel[2] * k).project(camera);
  if (tmpV.z > 1) return null;
  return [(tmpV.x * 0.5 + 0.5) * innerWidth, (-tmpV.y * 0.5 + 0.5) * innerHeight];
}

export function screenDir(x, y) {
  const v = new THREE.Vector3((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1, 0.5).unproject(camera);
  v.sub(camera.position).normalize();
  return [v.x, v.y, v.z];
}

// Для отладки рендера из консоли браузера
export function debugScene() { return { scene, camera, celGroup }; }
