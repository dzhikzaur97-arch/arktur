// 3D-рендер космоса на three.js: PBR-материалы, отражения окружения, свечение (bloom),
// процедурные планеты, туманности, корабли, станции и эффекты.
// Плавающее начало координат: всё рисуется относительно корабля игрока.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const FAR_START = 1.5e6; // дальше этого расстояния объекты «сжимаются» с сохранением углового размера

let renderer, composer, bloom, scene, camera, sunLight, ambient, pmrem;
let celGroup, entGroup, fxGroup, warpLines, dust, starField, skyRT, envRT, skyDome;
const celMeshes = new Map();   // id -> { obj, data }
const entMeshes = new Map();   // id -> { obj, kind, seen }
const fxList = [];
let stationView = null;
const GU = { time: { value: 0 } }; // общие uniform-переменные шейдеров

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

function buildSky(sysId, sec) {
  const seed = strSeed(sysId);
  const r = seeded(seed);
  let pal = NEBULA_PALETTES[seed % NEBULA_PALETTES.length];
  if (sec < 0) pal = NEBULA_PALETTES[4]; // в нулях небо тревожно-красное
  const mat = new THREE.ShaderMaterial({
    depthWrite: false, depthTest: false,
    uniforms: { c1: { value: new THREE.Vector3(...pal[0]) }, c2: { value: new THREE.Vector3(...pal[1]) }, c3: { value: new THREE.Vector3(...pal[2]) },
      seed: { value: r() * 100 }, bandN: { value: new THREE.Vector3(r() - 0.5, 1.5, r() - 0.5).normalize() } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `${GLSL_NOISE}
      uniform vec3 c1, c2, c3, bandN; uniform float seed; varying vec2 vUv;
      void main(){
        // равнопромежуточная проекция в той же раскладке, что использует three.js
        float lon = (vUv.x - 0.5) * 6.2831853, lat = (vUv.y - 0.5) * 3.1415927;
        vec3 d = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
        vec3 p = d * 2.2 + seed;
        float w = fbm3(p * 1.3 + 4.0);
        float n = fbm3(p + w * 1.6);
        float n2 = fbm3(p * 2.7 + 9.0);
        float neb = smoothstep(0.42, 0.85, n);
        vec3 col = mix(c1, c2, smoothstep(0.3, 0.75, n2)) * neb * 0.5;
        col += c3 * pow(smoothstep(0.55, 0.95, fbm3(p * 1.7 + w)), 2.0) * 0.4;
        float band = exp(-pow(dot(d, bandN) * 3.0, 2.0));
        float mw = band * (0.3 + 0.7 * fbm3(d * 9.0 + seed));
        float dustLane = smoothstep(0.48, 0.72, fbm3(d * 7.0 + seed * 2.0));
        col += vec3(0.62, 0.56, 0.5) * mw * 0.3 * (1.0 - dustLane * 0.85);
        col *= 1.0 - 0.6 * smoothstep(0.5, 0.8, fbm3(d * 4.0 - seed)) * neb;
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
    skyDome = new THREE.Mesh(new THREE.SphereGeometry(2e9, 96, 48), new THREE.MeshBasicMaterial({ map: skyRT.texture, side: THREE.BackSide, depthWrite: false }));
    skyDome.frustumCulled = false; skyDome.renderOrder = -100;
    scene.add(skyDome);
  }
  if (envRT) envRT.dispose();
  envRT = pmrem.fromEquirectangular(skyRT.texture);
  scene.environment = envRT.texture;

  // звёзды: три слоя разной яркости, сгущаются к плоскости галактики
  if (starField) { scene.remove(starField); starField.traverse(o => o.geometry && o.geometry.dispose()); }
  starField = new THREE.Group();
  const bandN = mat.uniforms.bandN.value;
  const layers = [[9000, 1.6, 0.55], [2500, 2.4, 0.85], [400, 3.4, 1.0]];
  for (const [count, size, bright] of layers) {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      let v;
      do { v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1); } while (v.lengthSq() > 1 || v.lengthSq() < 0.01);
      v.normalize();
      if (r() < 0.45) { v.addScaledVector(bandN, -v.dot(bandN) * (0.75 + r() * 0.25)).normalize(); }
      pos.set([v.x * 1e8, v.y * 1e8, v.z * 1e8], i * 3);
      const tint = r(), b = bright * (0.4 + r() * 0.6);
      const c = tint < 0.15 ? [1, 0.75, 0.55] : tint < 0.3 ? [0.7, 0.8, 1] : [1, 0.97, 0.92];
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
  scene.add(starField);
}

// ======================================================================
// Корабли
// ======================================================================
const shipCache = new Map();
const matCache = new Map();
function hullMat(color, faction) {
  const key = color + ':' + faction;
  if (matCache.has(key)) return matCache.get(key);
  const T = sharedTextures();
  const map = faction === 'pirate' ? T.hullPirate : faction === 'guard' ? T.hullGuard : T.hull;
  const m = new THREE.MeshStandardMaterial({ color, map, roughnessMap: map, bumpMap: map, bumpScale: 1.2, metalness: 0.75, roughness: 0.55, envMapIntensity: 1.1 });
  matCache.set(key, m);
  return m;
}
const darkMetal = () => matCache.get('dark') || (matCache.set('dark', new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.85, roughness: 0.4, map: sharedTextures().hull, bumpMap: sharedTextures().hull, bumpScale: 0.8 })), matCache.get('dark'));
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
  const core = new THREE.Mesh(new THREE.CircleGeometry(r * 0.8, 20), glowMat(color, 4));
  core.position.set(x, y, z - r * 0.55 * len); core.rotation.y = Math.PI; g.add(core);
  const plume = new THREE.Mesh(new THREE.ConeGeometry(r * 0.75, r * 8, 16, 1, true),
    new THREE.MeshBasicMaterial({ map: T.plume, color: new THREE.Color(color).multiplyScalar(1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
  plume.geometry.translate(0, -r * 4, 0); plume.rotation.x = -Math.PI / 2;
  plume.position.set(x, y, z - r * 0.6 * len);
  plume.userData.plume = r; g.add(plume);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: new THREE.Color(color).multiplyScalar(1.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
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

function buildShip(type, color, faction) {
  const g = new THREE.Group();
  const M = hullMat(color, faction), D = darkMetal();
  const eng = faction === 'pirate' ? 0xff3a1a : faction === 'guard' ? 0x9fd0ff : 0x40b8ff;
  const R = { iskra: 40, klinok: 45, burlak: 120, tyagach: 110, strazh: 90, molot: 160 }[type] || 50;
  const add = (geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); return m; };
  switch (type) {
    case 'iskra': {
      add(lathe(R * 1.9, R * 0.32, [[0, 0.55], [0.1, 0.8], [0.45, 1], [0.75, 0.8], [0.92, 0.4], [1, 0.05]]), M, 0, 0, 0, 1, 0.7, 1);
      add(new THREE.SphereGeometry(R * 0.16, 20, 12), glassMat(), 0, R * 0.17, R * 0.42, 1, 0.6, 1.8);
      const w = wingGeo(R * 0.75, R * 0.6, R * 0.25, R * 0.04);
      add(w, M, R * 0.2, -R * 0.03, -R * 0.25); const w2 = add(w, M, -R * 0.2, -R * 0.03, -R * 0.25); w2.scale.x = -1;
      add(new THREE.BoxGeometry(R * 0.04, R * 0.35, R * 0.4), D, 0, R * 0.25, -R * 0.55);
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
        add(new THREE.BoxGeometry(R * 0.04, R * 0.3, R * 0.35), M, s * R * 0.35, R * 0.15, -R * 0.65).rotation.z = -s * 0.4;
      }
      addEngine(g, R * 0.22, 0, -R * 1.1, R * 0.14, eng); addEngine(g, -R * 0.22, 0, -R * 1.1, R * 0.14, eng);
      addLights(g, [[R * 1.05, 0, R * 0.42, R * 0.03], [-R * 1.05, 0, R * 0.42, R * 0.03]], faction === 'pirate' ? 0xff2020 : 0x40ff60);
      break;
    }
    case 'burlak': {
      add(lathe(R * 1.6, R * 0.5, [[0, 0.7], [0.1, 0.95], [0.6, 1], [0.85, 0.85], [1, 0.45]], 8), M, 0, 0, -R * 0.1, 1.1, 0.75, 1);
      add(new THREE.BoxGeometry(R * 0.5, R * 0.25, R * 0.5), D, 0, R * 0.42, R * 0.15);
      add(new THREE.BoxGeometry(R * 0.35, R * 0.1, R * 0.06), glowMat(0xffd9a0, 1.6), 0, R * 0.45, R * 0.41);
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
      add(new THREE.BoxGeometry(R * 0.18, R * 0.18, R * 1.8), D);
      add(lathe(R * 0.5, R * 0.22, [[0, 0.8], [0.4, 1], [0.8, 0.8], [1, 0.3]], 12), M, 0, 0, R * 1.05);
      add(new THREE.SphereGeometry(R * 0.08, 12, 8), glassMat(), 0, R * 0.12, R * 1.2, 1.4, 0.6, 1);
      const r = seeded(4);
      const cols = [0x8a3a2a, 0x3a5a7a, 0x9a8a50, 0x5a6a5a, 0xa06030];
      for (let i = 0; i < 4; i++) for (let a = 0; a < 4; a++) {
        const ang = a * Math.PI / 2 + Math.PI / 4;
        const box = add(new THREE.BoxGeometry(R * 0.26, R * 0.26, R * 0.36), new THREE.MeshStandardMaterial({ color: cols[Math.floor(r() * cols.length)], map: sharedTextures().hull, metalness: 0.4, roughness: 0.7 }),
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
      add(new THREE.BoxGeometry(R * 0.5, R * 0.22, R * 0.9), M, 0, R * 0.2, -R * 0.25);
      if (big) {
        add(new THREE.BoxGeometry(R * 0.25, R * 0.35, R * 0.35), D, 0, R * 0.45, -R * 0.35);
        add(new THREE.BoxGeometry(R * 0.4, R * 0.04, R * 0.12), glowMat(0xffd9a0, 1.4), 0, R * 0.5, -R * 0.17);
        for (const s of [1, -1]) add(new THREE.BoxGeometry(R * 0.08, R * 0.5, R * 1.2), M, s * R * 0.75, 0, -R * 0.1);
      }
      const win = new THREE.Mesh(new THREE.BoxGeometry(R * 0.52, R * 0.05, R * 0.7), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: sharedTextures().windowsDense, emissiveIntensity: 1.6, metalness: 0.5 }));
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
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; } });
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
  const base = { iskra: 40, klinok: 45, burlak: 120, tyagach: 110, strazh: 90, molot: 160 }[type] || 50;
  m.scale.setScalar(radius / base);
  return m;
}

function setEngines(obj, frac, time) {
  const f = Math.min(1.3, Math.max(0.12, frac));
  obj.traverse(o => {
    if (o.userData.plume) o.scale.set(1, 0.25 + f * (0.9 + 0.1 * Math.sin(time * 40 + o.id)), 1);
    else if (o.userData.glow) o.scale.setScalar(o.userData.glow * (0.6 + f * 0.6));
    else if (o.userData.blink !== undefined) o.visible = ((time + o.userData.blink) % 2) < 0.25;
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
  const M = new THREE.MeshStandardMaterial({ color: tint, map: T.hull, roughnessMap: T.hull, bumpMap: T.hull, bumpScale: 2, metalness: 0.7, roughness: 0.5 });
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
  g.userData.spinY = 0.012;
  return g;
}

function gateModel() {
  const g = new THREE.Group();
  const T = sharedTextures();
  const M = new THREE.MeshStandardMaterial({ color: 0x9aa4b0, map: T.hull, bumpMap: T.hull, bumpScale: 2, metalness: 0.85, roughness: 0.35 });
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
  scene = new THREE.Scene();
  pmrem = new THREE.PMREMGenerator(renderer);
  sharedTextures();
  camera = new THREE.PerspectiveCamera(60, 1, 1, 5e9);
  ambient = new THREE.AmbientLight(0x8090b0, 0.18);
  scene.add(ambient);
  scene.environmentIntensity = 0.7;
  sunLight = new THREE.DirectionalLight(0xfff1dc, 3.2);
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
    setEngines(myShip, Math.hypot(...view.me.v) / (view.me.max.spd || 1), time);
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
      setEngines(rec.obj, e.v ? Math.hypot(...e.v) / (t ? t.maxSpeed : 300) : 0, time);
    } else if (e.k === 'd') {
      if (e.v && Math.hypot(...e.v) > 1) { tmpV.set(rel[0] + e.v[0], rel[1] + e.v[1], rel[2] + e.v[2]); rec.obj.lookAt(tmpV); }
      setEngines(rec.obj, 1, time);
    } else if (e.k === 'a') rec.obj.rotation.y += rec.obj.userData.spin * dt;
    else if (e.k === 'w') rec.obj.userData.flicker.material.opacity = 0.5 + 0.5 * Math.random();
  }
  for (const [id, rec] of [...entMeshes]) if (!rec.seen) removeEnt(id);

  updateDust(origin, view.me);
  updateFx(view, dt, origin);
  updateWarp(view, dt);
  composer.render();
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
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 1.4, 5), fresnelMaterial(0x4a90ff, 3, 0.9, false));
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
