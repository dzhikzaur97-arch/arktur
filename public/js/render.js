// 3D-рендер космоса на three.js: PBR-материалы, отражения окружения, свечение (bloom),
// процедурные планеты, туманности, корабли, станции и эффекты.
// Плавающее начало координат: всё рисуется относительно корабля игрока.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const FAR_START = 1.5e6; // дальше этого расстояния объекты «сжимаются» с сохранением углового размера

let renderer, composer, bloom, grade, godRays, smaa, fxaa, afterimage, scene, camera, sunLight, sunLight2, rimLight, ambient, pmrem;
let curSuns = { a: null, b: null }; // основная звезда и компаньон двойной системы
let celGroup, entGroup, fxGroup, warpLines, dust, starField, skyRT, envRT, skyDome;
const celMeshes = new Map();   // id -> { obj, data }
const entMeshes = new Map();   // id -> { obj, kind, seen }
const fxList = [];
let stationView = null;
const GU = { time: { value: 0 } }; // общие uniform-переменные шейдеров

let quality = 'high';
// Прогрев: заранее строим модели и текстуры кораблей маленькими порциями, а затем в фоне компилируем
// их шейдеры — иначе первая встреча с новым кораблём (пиратская волна, прыжок) даёт заметный фриз
// Заранее строим только то, что встретится почти наверняка: свой корабль и частые пиратские корпуса.
// Раньше строились все ~64 модели (каждая окраска — своя текстура корпуса) — на телефоне это сотни МБ разом
// Прогрев на экране входа: шейдеры станции, стартового корабля и пост-обработки компилируются,
// пока пилот вводит имя, — иначе всё это компилируется в первом кадре после входа (≈1,5 с подвисания)
let warmed = false;
export function warmup() {
  if (warmed || !renderer) return;
  warmed = true;
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 60));
  idle(() => {
    try {
      const g = new THREE.Group();
      g.add(stationModel(0));
      g.add(shipModel('iskra', 0x9fb4c8, 900, 'player'));
      const done = () => idle(() => { try { composer.render(); } catch {} });
      if (renderer.compileAsync) renderer.compileAsync(g, camera, scene).then(done, done); else { renderer.compile(g, camera, scene); done(); }
    } catch (e) { console.warn('warmup', e); }
  }, { timeout: 2500 });
}
export function prewarm(ships, drones = {}, mine = null) {
  if (LOW_MEM) return; // на телефоне модели строятся по мере появления
  const jobs = [];
  if (mine && ships[mine]) jobs.push([mine, ships[mine].color, 'player']);
  for (const type of ['klinok', 'vihr', 'strazh', 'pdrone', 'pdrone_h']) if (ships[type]) jobs.push([type, 0x4a3a38, 'pirate']);
  jobs.push(['molot', 0xd8e4f0, 'guard']);
  drones = Object.fromEntries(Object.entries(drones).slice(0, 4));
  const built = [];
  const step = () => {
    const j = jobs.shift();
    if (j) {
      built.push(shipModel(j[0], j[1], 50, j[2]));
      (window.requestIdleCallback || ((f) => setTimeout(f, 30)))(step, { timeout: 400 });
      return;
    }
    const g = new THREE.Group();
    for (const m of built) g.add(m);
    for (const [id, d] of Object.entries(drones)) g.add(droneModel(id, d));
    if (renderer && renderer.compileAsync) renderer.compileAsync(g, camera, scene).catch(() => {});
  };
  setTimeout(step, 300);
}
// ======================================================================
// Настройки графики: профиль + отдельные параметры (сохраняются клиентом в localStorage)
// scale — масштаб рендера относительно родного разрешения экрана (1 = пиксель в пиксель);
// aa — сглаживание: off | fxaa | smaa | msaa2 | msaa4 | msaa8 | msaa4s | msaa8s (MSAA + SMAA);
// tex — текстуры и детализация моделей (low/med/high/ultra, применяются после перезапуска);
// shadows — размер карты теней (0 — без теней); refl — отражения окружения; fx — лучи, следы, частицы;
// dist — дальность прорисовки; bloom — сила свечения (0 — выкл.); mblur — размытие в движении; fov; shake — тряска камеры
// ======================================================================
export const GFX_PROFILES = {
  low:    { scale: 0.75, aa: 'fxaa',   tex: 'low',   shadows: 0,    refl: false, fx: 'low',  dist: 'low',   bloom: 0.35, mblur: false },
  medium: { scale: 1,    aa: 'smaa',   tex: 'med',   shadows: 1024, refl: true,  fx: 'med',  dist: 'med',   bloom: 0.5,  mblur: false },
  high:   { scale: 1,    aa: 'msaa4',  tex: 'high',  shadows: 2048, refl: true,  fx: 'high', dist: 'high',  bloom: 0.55, mblur: false },
  ultra:  { scale: 1,    aa: 'msaa8s', tex: 'ultra', shadows: 4096, refl: true,  fx: 'high', dist: 'ultra', bloom: 0.6,  mblur: false }
};
let gfx = { ...GFX_PROFILES.high, fov: 60, shake: 0.5 };
export function getGfx() { return gfx; }
// текстуры и детализация моделей фиксируются при запуске (модели строятся и кэшируются один раз)
// Телефоны и планшеты: у WebView (особенно iOS) жёсткий предел памяти — при его превышении система молча
// перезагружает страницу. Поэтому там текстуры корпусов не больше 512, кадр не больше ~2,3 Мп, тени не больше 1024
export const LOW_MEM = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const TEX_RES = { low: 512, med: 1024, high: 1024, ultra: 2048 };
const texRes = () => LOW_MEM ? 512 : (TEX_RES[texLevel] || 1024);
const PIXEL_BUDGET = LOW_MEM ? 2.3e6 : 17e6; // пикселей в буфере кадра (17 Мп — 4K с запасом под масштаб 150%)
const DETAIL = { low: 0.7, med: 1, high: 1.3, ultra: 1.7 };
const DIST_K = { low: 0.6, med: 1, high: 1.5, ultra: 2.2 }; // дальность прорисовки: следы, переходы LOD
const distK = () => DIST_K[gfx.dist] || 1;
let texLevel = 'high';
export function setTexLevel(t) { if (!renderer) texLevel = t; }
let shakeAmp = 0;
export function shake(k) { shakeAmp = Math.min(1.5, Math.max(shakeAmp, k * (gfx.shake ?? 0.5))); }
export function setGraphics(g) {
  gfx = { ...gfx, ...g };
  if (LOW_MEM) { gfx.shadows = Math.min(gfx.shadows || 0, 1024); if (gfx.tex === 'ultra' || gfx.tex === 'high') gfx.tex = 'med'; }
  quality = gfx.fx === 'low' ? 'low' : gfx.shadows >= 2048 ? 'high' : 'medium';
  if (!renderer) { texLevel = gfx.tex; return; }
  const maxS = renderer.capabilities.maxSamples || 4;
  const samples = Math.min(maxS, { msaa2: 2, msaa4: 4, msaa8: 8, msaa4s: 4, msaa8s: 8 }[gfx.aa] || 0);
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
  smaa.enabled = gfx.aa === 'smaa' || gfx.aa === 'msaa4s' || gfx.aa === 'msaa8s';
  fxaa.enabled = gfx.aa === 'fxaa';
  sunLight.castShadow = gfx.shadows > 0;
  if (gfx.shadows && sunLight.shadow.mapSize.x !== gfx.shadows) { sunLight.shadow.mapSize.set(gfx.shadows, gfx.shadows); if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; } }
  scene.environmentIntensity = gfx.refl ? 0.95 : 0.3;
  bloom.enabled = gfx.bloom > 0; bloom.strength = gfx.bloom;
  godRays.uniforms.rays.value = gfx.fx === 'high' ? 1 : 0; // лучи от звёзд — 60 выборок на пиксель, только на высоких эффектах
  afterimage.enabled = !!gfx.mblur;
  if (gfx.fx === 'low') { for (const [id, tr] of trails) { fxGroup.remove(tr.mesh); tr.mesh.geometry.dispose(); trails.delete(id); } }
  resize();
}
// совместимость со старым переключателем качества
export function setQuality(q) { setGraphics(GFX_PROFILES[q] || GFX_PROFILES.high); }
// сведения о видеокарте и буфере (для окна настроек и теста производительности)
export function gpuInfo() {
  if (!renderer) return {};
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
  return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), maxSamples: renderer.capabilities.maxSamples, aniso: renderer.capabilities.getMaxAnisotropy(),
    buffer: [sz.x, sz.y], pixelRatio: renderer.getPixelRatio(), calls: renderer.info.render.calls, tris: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: (renderer.info.programs || []).length };
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
      sunDir: { value: new THREE.Vector3(1, 0, 0) }, sunSide: { value: sunSide ? 1 : 0 }, opacity: { value: 1 }, sunset: { value: 0 } },
    vertex: `varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        vW = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * mv; /*LOGDEPTH*/ }`,
    fragment: `uniform vec3 color; uniform float power, intensity, sunSide, opacity, sunset; uniform vec3 sunDir; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ /*LOGDEPTH*/ float f = pow(clamp(1.0 - abs(dot(vN, vV)), 0.0, 1.0), power);
        float sd = dot(vW, sunDir);
        float lit = mix(1.0, smoothstep(-0.35, 0.6, sd), sunSide);
        // у линии терминатора атмосфера краснеет — рассеяние света, как на закате
        vec3 c = mix(color, vec3(1.0, 0.45, 0.18) * length(color), sunset * smoothstep(0.45, 0.0, abs(sd + 0.05)) * 0.75);
        gl_FragColor = vec4(c * f * intensity * lit * opacity, 1.0); }`,
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
  t.anisotropy = maxAniso();
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
// Рельеф, металл и огни зависят только от фракции — их считаем один раз (карта нормалей — дорогая:
// чтение пикселей и фильтр Собеля), а для каждой окраски перерисовываем лишь цветовую карту
// анизотропная фильтрация — максимум видеокарты (16× на современных), на низком качестве 4×
const maxAniso = () => renderer ? Math.min(texLevel === 'low' ? 4 : 16, renderer.capabilities.getMaxAnisotropy()) : 8;
const hullShared = new Map();
function hullSet(paint, accent, faction, seed, second) {
  // рисуем в логических координатах 512×512, холсты — в разрешении уровня качества (512 / 1024 / 2048)
  const W = 512, RES = texRes(), r = seeded(seed), shared = hullShared.get(faction + ':' + accent + ':' + seed);
  const mk = (size = RES, read = false) => { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d', read ? { willReadFrequently: true } : undefined); g.setTransform(size / W, 0, 0, size / W, 0, 0); return [c, g]; };
  // если общие карты уже есть, рисуем их на холстах 1×1 — вызовы те же (та же последовательность случайных чисел), но почти бесплатно
  const [cc, cg] = mk(), [hc, hg] = mk(shared ? 1 : RES, true), [oc, og] = mk(shared ? 1 : RES), [ec, eg] = mk(shared ? 1 : RES);
  const P = new THREE.Color(paint), A = new THREE.Color(accent);
  const rgb = (c, k = 1) => `rgb(${Math.min(255, c.r * 255 * k) | 0},${Math.min(255, c.g * 255 * k) | 0},${Math.min(255, c.b * 255 * k) | 0})`;
  const gray = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;
  const orm = (rough, metal) => `rgb(255,${rough | 0},${metal | 0})`;
  cg.fillStyle = '#1d2024'; cg.fillRect(0, 0, W, W); // фон = цвет швов между панелями
  hg.fillStyle = gray(40); hg.fillRect(0, 0, W, W);
  og.fillStyle = orm(170, 200); og.fillRect(0, 0, W, W);
  eg.fillStyle = '#000'; eg.fillRect(0, 0, W, W);
  // Окраска крупными зонами (основной цвет, светлый второй цвет ливреи, голый металл, тёмные технические
  // панели) — корпус читается как цельный, а не «лоскутный»; внутри зоны — тонкие швы, люки, решётки, заклёпки
  const ZW = { player: [0.64, 0.22, 0.1, 0.04], guard: [0.62, 0.24, 0.1, 0.04], station: [0.55, 0.27, 0.13, 0.05], pirate: [0.5, 0.08, 0.27, 0.15], dark: [0, 0, 0.55, 0.45], cons: [0.6, 0.3, 0.06, 0.04], liga: [0.45, 0.15, 0.22, 0.18], orden: [0.62, 0.1, 0.08, 0.2], seraph: [0.74, 0.2, 0.04, 0.02] }[faction] || [0.64, 0.22, 0.1, 0.04];
  const pickZone = () => { let t = r(), i = 0; while (i < 3 && t > ZW[i]) { t -= ZW[i]; i++; } return i; };
  const codes = { pirate: ['СКВ', 'XX', '666', 'РЕЙД'], guard: ['СТРАЖ', 'ГП-1', 'ПОРЯДОК'], cons: ['АИ-7', 'КОНС', 'АРКТУР', 'К-12'], liga: ['ЛИГА', 'ПЛ-3', 'РУБЕЖ', '42'], orden: ['ОРДЕН', 'ОП-1', 'ПРЕДЕЛ'], seraph: ['ПР-01', 'СЕРАФИМ', 'Ω'] }[faction] || ['VF', 'ВФ-07', 'ПФ-21', 'АРК', '12', 'Б-3'];
  const panels = [];
  const split = (x, y, w, h, d, zone) => {
    if (d === 2) zone = pickZone();
    if (d >= 7 || w < 34 || h < 34 || (d > 3 && r() < 0.2)) { panels.push([x, y, w, h, zone]); return; }
    if (w > h ? r() < 0.78 : r() < 0.22) { const k = w * (0.3 + r() * 0.4); split(x, y, k, h, d + 1, zone); split(x + k, y, w - k, h, d + 1, zone); }
    else { const k = h * (0.3 + r() * 0.4); split(x, y, w, k, d + 1, zone); split(x, y + k, w, h - k, d + 1, zone); }
  };
  split(0, 0, W, W, 0, 0);
  const S2 = second != null ? new THREE.Color(second) : P.clone().lerp(new THREE.Color(0.72, 0.74, 0.77), 0.55), BARE = new THREE.Color(0.5, 0.52, 0.55), DARK = new THREE.Color(0.16, 0.17, 0.19);
  for (const [x, y, w, h, zone] of panels) {
    const gap = 0.9, X = x + gap, Y = y + gap, Wd = w - gap * 2, Hd = h - gap * 2;
    const kind = r() < 0.9 ? zone : (r() < 0.8 ? 2 : 3); // изредка — панель другого типа внутри зоны
    const base = [P, S2, BARE, DARK][kind], v = 0.955 + r() * 0.09;
    cg.fillStyle = rgb(base, v); cg.fillRect(X, Y, Wd, Hd);
    og.fillStyle = kind === 2 ? orm(125 + r() * 50, 165) : kind === 3 ? orm(175, 150) : orm(100 + r() * 30, 30); og.fillRect(X, Y, Wd, Hd);
    hg.fillStyle = gray(150 + r() * 10); hg.fillRect(X, Y, Wd, Hd);
    // фаска по краю панели
    hg.strokeStyle = gray(175); hg.lineWidth = 1.2; hg.strokeRect(X + 1.2, Y + 1.2, Wd - 2.4, Hd - 2.4);
    const deco = r();
    if (kind === 3 && Wd > 16 && Hd > 16) { // техническая панель: решётка радиатора
      const vert = Wd < Hd;
      for (let k = 3; k < (vert ? Wd : Hd) - 2; k += 4.5) {
        hg.fillStyle = gray(185); cg.fillStyle = rgb(DARK, 1.9);
        if (vert) { hg.fillRect(X + k, Y + 3, 1.6, Hd - 6); cg.fillRect(X + k, Y + 3, 1.6, Hd - 6); }
        else { hg.fillRect(X + 3, Y + k, Wd - 6, 1.6); cg.fillRect(X + 3, Y + k, Wd - 6, 1.6); }
      }
    } else if (deco < 0.14 && Wd > 50 && kind !== 2) { // полосы фракционного цвета
      cg.fillStyle = rgb(A); const sh = 3 + r() * 6, sy = Y + Hd * (0.2 + r() * 0.5);
      cg.fillRect(X, sy, Wd, sh); cg.fillRect(X, sy + sh + 2.5, Wd, sh * 0.35);
    } else if (deco < 0.19 && Wd > 50 && Hd > 20) { // полосы опасности
      cg.save(); cg.beginPath(); cg.rect(X, Y + Hd - 10, Wd, 7); cg.clip();
      cg.fillStyle = '#c9a21e'; cg.fillRect(X, Y + Hd - 10, Wd, 7);
      cg.fillStyle = '#16181a';
      for (let k = -12; k < Wd + 12; k += 9) { cg.beginPath(); cg.moveTo(X + k, Y + Hd - 3); cg.lineTo(X + k + 4.5, Y + Hd - 3); cg.lineTo(X + k + 11.5, Y + Hd - 10); cg.lineTo(X + k + 7, Y + Hd - 10); cg.fill(); }
      cg.restore();
    } else if (deco < 0.3 && Wd > 50 && Hd > 24 && kind < 2) { // маркировка
      cg.fillStyle = base.getHSL({}).l > 0.45 ? 'rgba(25,28,32,0.8)' : 'rgba(235,238,242,0.8)';
      cg.font = `bold ${Math.min(20, Hd * 0.42) | 0}px Arial, sans-serif`;
      cg.fillText(codes[Math.floor(r() * codes.length)], X + 5, Y + Hd * 0.62);
    } else if (deco < 0.4 && Wd > 40) { // иллюминаторы
      const n = Math.floor((Wd - 6) / 7), wy = Y + Hd * (0.3 + r() * 0.4);
      for (let k = 0; k < n; k++) {
        cg.fillStyle = '#081018'; cg.fillRect(X + 4 + k * 7, wy, 4, 3);
        hg.fillStyle = gray(100); hg.fillRect(X + 4 + k * 7, wy, 4, 3);
        if (r() < 0.7) { eg.fillStyle = r() < 0.8 ? `rgba(255,${210 + r() * 30},${150 + r() * 60},1)` : 'rgba(160,215,255,1)'; eg.fillRect(X + 4.5 + k * 7, wy + 0.6, 3, 1.8); }
      }
    } else if (deco < 0.58 && Wd > 26 && Hd > 26) { // сервисный люк: утопленная рамка
      const hw = Wd * (0.3 + r() * 0.35), hh = Hd * (0.3 + r() * 0.35), hx = X + (Wd - hw) * r(), hy = Y + (Hd - hh) * r();
      hg.strokeStyle = gray(95); hg.lineWidth = 1; hg.strokeRect(hx, hy, hw, hh);
      cg.strokeStyle = 'rgba(15,17,20,0.55)'; cg.lineWidth = 0.7; cg.strokeRect(hx, hy, hw, hh);
    }
    // заклёпки вдоль краёв
    if (r() < 0.3 && kind !== 3) {
      hg.fillStyle = gray(205); cg.fillStyle = rgb(base, 1.12);
      for (let k = 5; k < Wd - 4; k += 6) for (const yy of [Y + 3, Y + Hd - 3]) {
        hg.beginPath(); hg.arc(X + k, yy, 0.9, 0, 7); hg.fill(); cg.beginPath(); cg.arc(X + k, yy, 0.7, 0, 7); cg.fill();
      }
    }
  }
  // грязь и потёки, потёртости по краям
  for (let i = 0; i < 900; i++) {
    const x = r() * W, y = r() * W, l = 20 + r() * 120;
    const gr = cg.createLinearGradient(x, y, x, y + l);
    gr.addColorStop(0, `rgba(15,12,10,${(faction === 'pirate' ? 0.14 : 0.05) + r() * 0.08})`); gr.addColorStop(1, 'rgba(15,12,10,0)');
    cg.fillStyle = gr; cg.fillRect(x, y, 2 + r() * 8, l);
    og.fillStyle = `rgba(255,230,0,${0.15})`; og.fillRect(x, y, 2 + r() * 8, l * 0.6);
  }
  for (let i = 0; i < 1500; i++) {
    cg.fillStyle = `rgba(200,205,210,${r() * (faction === 'pirate' ? 0.16 : 0.08)})`;
    cg.fillRect(r() * W, r() * W, 1 + r() * 14, 1);
  }
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso();
    return t;
  };
  if (shared) return { map: tex(cc, true), ...shared };
  // карта нормалей из карты высот (оператор Собеля)
  const hd = hg.getImageData(0, 0, RES, RES).data;
  const nd = hg.createImageData(RES, RES), nn = nd.data;
  const H = (x, y) => hd[(((y + RES) % RES) * RES + ((x + RES) % RES)) * 4] / 255;
  const k = 3.2 * RES / W; // рельеф одинаковой силы при любом разрешении
  for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = -dx * k, ny = dy * k, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * RES + x) * 4;
    nn[i] = (nx * 0.5 + 0.5) * 255; nn[i + 1] = (ny * 0.5 + 0.5) * 255; nn[i + 2] = (nz * 0.5 + 0.5) * 255; nn[i + 3] = 255;
  }
  const [nc, ng] = mk(); ng.putImageData(nd, 0, 0);
  const common = { normalMap: tex(nc, false), ormMap: tex(oc, false), emissiveMap: tex(ec, true) };
  hullShared.set(faction + ':' + accent + ':' + seed, common);
  return { map: tex(cc, true), ...common };
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
    if (!conv.has(o.geometry)) conv.set(o.geometry, boxUV(o.geometry, tile * (o.userData.uvTile || 1)));
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

// Палитры туманностей по регионам: [основной газ, второй газ, яркие волокна], плюс размер туманности и плотность звёзд
const REGION_SKY = {
  core:   { pals: [[[0.1, 0.35, 0.6], [0.2, 0.15, 0.55], [0.4, 0.85, 1.0]], [[0.12, 0.4, 0.5], [0.08, 0.2, 0.5], [0.5, 0.95, 0.9]]], size: [0.35, 0.55], stars: 1.0 },
  border: { pals: [[[0.6, 0.45, 0.12], [0.35, 0.15, 0.45], [1.0, 0.85, 0.4]], [[0.5, 0.3, 0.1], [0.15, 0.25, 0.5], [1.0, 0.75, 0.35]]], size: [0.45, 0.65], stars: 1.0 },
  low:    { pals: [[[0.65, 0.22, 0.06], [0.3, 0.06, 0.08], [1.0, 0.55, 0.2]], [[0.55, 0.18, 0.1], [0.25, 0.08, 0.2], [1.0, 0.45, 0.25]]], size: [0.55, 0.75], stars: 0.8 },
  null:   { pals: [[[0.55, 0.05, 0.08], [0.18, 0.02, 0.12], [1.0, 0.25, 0.2]], [[0.45, 0.04, 0.15], [0.15, 0.03, 0.2], [1.0, 0.2, 0.35]]], size: [0.6, 0.85], stars: 0.65 },
  deep:   { pals: [[[0.1, 0.45, 0.3], [0.35, 0.05, 0.5], [0.4, 1.0, 0.75]], [[0.3, 0.05, 0.55], [0.05, 0.3, 0.35], [0.85, 0.5, 1.0]]], size: [0.7, 0.95], stars: 0.45 }
};

let lastSky = ['lobby', 1];
function buildSky(sysId, sec, region) {
  lastSky = [sysId, sec, region];
  const seed = strSeed(sysId);
  const r = seeded(seed);
  const RS = REGION_SKY[region];
  let pal = RS ? RS.pals[seed % RS.pals.length] : NEBULA_PALETTES[seed % NEBULA_PALETTES.length];
  if (!RS && sec < 0) pal = NEBULA_PALETTES[4];
  const rv = () => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
  const bandN = new THREE.Vector3(r() - 0.5, 1.6, r() - 0.5).normalize();
  const nebDir = rv();
  // центр галактики лежит в плоскости Млечного Пути
  const coreDir = rv().addScaledVector(bandN, -rv().dot(bandN)).normalize();
  const mat = new THREE.ShaderMaterial({
    depthWrite: false, depthTest: false,
    uniforms: { c1: { value: new THREE.Vector3(...pal[0]) }, c2: { value: new THREE.Vector3(...pal[1]) }, c3: { value: new THREE.Vector3(...pal[2]) },
      seed: { value: r() * 50 }, bandN: { value: bandN }, nebDir: { value: nebDir }, coreDir: { value: coreDir }, nebSize: { value: RS ? RS.size[0] + r() * (RS.size[1] - RS.size[0]) : 0.45 + r() * 0.3 } },
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
    const size = Math.min(LOW_MEM ? 1024 : 2048, renderer.capabilities.maxTextureSize); // 4096 в половинной точности с мипмапами — ~90 МБ видеопамяти
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
  const sk = RS ? RS.stars : 1;
  const layers = [[Math.round(16000 * sk), 1.3, 0.45], [Math.round(5000 * sk), 2.0, 0.75], [Math.round(900 * sk), 3.0, 1.0]];
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
const FACTION_ACCENT = { player: 0x2a8fd0, pirate: 0xb01818, guard: 0x2060c0, dark: 0x8a6a2a, station: 0xd08a30, cons: 0xc89a38, liga: 0xd07020, orden: 0x8a5cff, seraph: 0xd8a842 };
function pbrMat(paint, faction, opts = {}, accent = null, second = null) {
  const key = paint + ':' + faction + ':' + (accent == null ? '' : accent) + ':' + (second == null ? '' : second);
  if (matCache.has(key)) return matCache.get(key);
  const set = hullSet(paint, accent != null ? accent : FACTION_ACCENT[faction] || 0x2a8fd0, faction, strSeed(faction) >>> 0, second);
  const m = new THREE.MeshPhysicalMaterial({
    map: set.map, normalMap: set.normalMap, normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: set.ormMap, metalnessMap: set.ormMap, roughness: 1, metalness: 1,
    emissiveMap: set.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.4,
    clearcoat: faction === 'dark' ? 0 : 0.25, clearcoatRoughness: 0.4, envMapIntensity: 1.2, ...opts
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
  if (seg >= 16) seg = Math.round(seg * (DETAIL[texLevel] || 1)); // круглые корпуса глаже на высоком качестве (гранёные — как задуманы)
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
  strizh: 32, sokol: 38, staratel: 48, vihr: 70, piligrim: 110, leviafan: 170, kit: 260, citadel: 260, begemot: 300, flagman: 320,
  gadyuka: 42, burya: 105, bastion: 280, matka: 300, fortress: 2400, pbase: 900, pdrone: 7, pdrone_h: 16,
  merkuriy: 44, prorab: 85, argus: 110, senator: 300, brodyaga: 42, pastuh: 75, kovcheg: 200, taran: 140,
  iskatel: 40, prizma: 44, orakul: 115, relikvariy: 290, serafim: 600, colossus: 1800, wb_gen: 140,
  kometa: 34, meduza: 110, peleng: 42, avrora: 160, gonchaya: 90, burevestnik: 85, veche: 170, porog: 320 };
// Фракционные линейки: свой стиль корпуса, окраски и цвет дюз у каждой фракции
const DESIGN_FAC = { merkuriy: 'cons', prorab: 'cons', argus: 'cons', senator: 'cons', brodyaga: 'liga', pastuh: 'liga', kovcheg: 'liga', taran: 'liga',
  iskatel: 'orden', prizma: 'orden', orakul: 'orden', relikvariy: 'orden', serafim: 'seraph' };
const FAC_ENGINE = { cons: 0xa8dcff, liga: 0xff9a3a, orden: 0xb47cff, seraph: 0xffdca8 };
const goldMat = () => matCache.get('gold') || (matCache.set('gold', new THREE.MeshStandardMaterial({ color: 0xe0b050, metalness: 0.85, roughness: 0.32, envMapIntensity: 1.4, emissive: 0x3a2606, emissiveIntensity: 0.7 })), matCache.get('gold'));
// кристаллы Ордена: светятся изнутри, гладкие
const crystalMat = () => matCache.get('crystal') || (matCache.set('crystal', new THREE.MeshStandardMaterial({ color: 0x5a38a0, emissive: 0x9a60ff, emissiveIntensity: 1.25, metalness: 0.1, roughness: 0.12 })), matCache.get('crystal'));


// Коробка со скруглёнными рёбрами — корпуса не выглядят «кубиками»
const rbox = (w, h, d) => new RoundedBoxGeometry(w, h, d, texLevel === 'ultra' ? 4 : 3, Math.min(w, h, d) * 0.22);

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


// ======================================================================
// «Серафим» — уникальный флагман по концепт-арту пилота: фарфорово-белый корпус, открытое сердце-реактор
// (бело-голубое солнце в золотой клетке), золотой осевой стержень, крылья-листья в золотых рамах
// с тёмными вставками и светящейся филигранью, кормовая «астролябия» из вращающихся колец.
// В userData — точки, по которым при залпе «Копья Зари» бегут молнии (arcPts), и центр реактора (core)
// ======================================================================
const cachedMat = (k, f) => matCache.get(k) || (matCache.set(k, f()), matCache.get(k));
const porcelainMat = () => cachedMat('porcelain', () => new THREE.MeshPhysicalMaterial({ color: 0xf3f4f7, roughness: 0.2, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.5 }));
const chromeMat = () => cachedMat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xdad4c4, metalness: 1, roughness: 0.22, envMapIntensity: 1.7, emissive: 0x2a2416, emissiveIntensity: 0.6 }));
export const SERAPH = { panel: null, core: null, burst: null, charge: 0 }; // материалы, которые разгораются при залпе
// филигрань крыла: тёмная вставка, золотые линии в стиле модерн (ось листа — по v, корень внизу)
function filigreeTexture() {
  const t = canvasTex(256, 1024, (g, W, H) => {
    g.fillStyle = '#06080e'; g.fillRect(0, 0, W, H);
    const P = (u, v) => [u * W, (1 - v) * H], hw = (v) => 0.5 * (0.5 + 0.5 * v);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#ffd27a'; g.fillStyle = '#ffd27a'; g.shadowColor = '#ffb030'; g.shadowBlur = 12;
    const edge = (k, lw) => { g.lineWidth = lw; g.beginPath();
      for (let i = 0; i <= 40; i++) { const v = 0.03 + 0.94 * i / 40; g.lineTo(...P(0.5 - hw(v) * k, v)); }
      for (let i = 40; i >= 0; i--) { const v = 0.03 + 0.94 * i / 40; g.lineTo(...P(0.5 + hw(v) * k, v)); }
      g.closePath(); g.stroke(); };
    edge(0.9, 6); edge(0.74, 2.5);
    g.lineWidth = 4; g.beginPath(); g.moveTo(...P(0.5, 0.05)); g.lineTo(...P(0.5, 0.95)); g.stroke();
    for (const v0 of [0.12, 0.28, 0.44, 0.6, 0.76]) for (const sd of [-1, 1]) {
      const w = hw(v0 + 0.06);
      g.lineWidth = 3; g.beginPath(); g.moveTo(...P(0.5, v0));
      g.bezierCurveTo(...P(0.5 + sd * w * 0.45, v0 - 0.05), ...P(0.5 + sd * w * 0.85, v0 + 0.02), ...P(0.5 + sd * w * 0.6, v0 + 0.1));
      g.stroke();
      const [cx, cy] = P(0.5 + sd * w * 0.52, v0 + 0.085); g.beginPath(); g.arc(cx, cy, 7, 0, Math.PI * 2); g.stroke(); // завиток
      g.beginPath(); g.ellipse(...P(0.5 + sd * w * 0.25, v0 + 0.1), 5, 22, sd * 0.35, 0, Math.PI * 2); g.stroke();
    }
    for (const v0 of [0.2, 0.36, 0.52, 0.68]) { g.beginPath(); g.ellipse(...P(0.5, v0), 9, 26, 0, 0, Math.PI * 2); g.stroke(); }
    // заострённый овал у законцовки
    g.lineWidth = 3.5; g.beginPath(); g.moveTo(...P(0.5, 0.8)); g.quadraticCurveTo(...P(0.5 + hw(0.88) * 0.55, 0.88), ...P(0.5, 0.96)); g.quadraticCurveTo(...P(0.5 - hw(0.88) * 0.55, 0.88), ...P(0.5, 0.8)); g.stroke();
    for (let v = 0.08; v < 0.95; v += 0.055) for (const sd of [-1, 1]) { const [x, y] = P(0.5 + sd * hw(v) * 0.82, v); g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill(); }
  });
  t.anisotropy = maxAniso();
  return t;
}
// многоугольник, сдвинутый внутрь на d (выпуклый, обход по часовой/против — по знаку площади)
function insetPoly(pts, d) {
  const n = pts.length, area = pts.reduce((a, p, i) => { const q = pts[(i + 1) % n]; return a + p[0] * q[1] - q[0] * p[1]; }, 0), sg = area > 0 ? 1 : -1;
  const lines = pts.map((p, i) => { const q = pts[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy), nx = -dy / L * sg, ny = dx / L * sg;
    return [[p[0] + nx * d, p[1] + ny * d], [dx, dy]]; });
  return lines.map((l, i) => { const m = lines[(i + n - 1) % n], [p1, d1] = m, [p2, d2] = l, den = d1[0] * d2[1] - d1[1] * d2[0];
    const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den; return [p1[0] + d1[0] * t, p1[1] + d1[1] * t]; });
}
function buildSerafim(g, R) {
  const W = porcelainMat(), G = goldMat(), C = chromeMat(), arcPts = [];
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  const pt = (x, y, z) => arcPts.push([x * R, y * R, z * R]);
  // корпус: носовая «капля» и узкая кормовая часть, между ними — открытый реактор
  add(lathe(R * 1.15, R * 0.3, [[0, 0.62], [0.08, 0.85], [0.3, 1], [0.55, 0.95], [0.78, 0.72], [0.92, 0.4], [1, 0.04]], 64), W, 0, 0, R * 0.48).scale.y = 0.9;
  add(lathe(R * 0.72, R * 0.16, [[0, 0.8], [0.08, 0.95], [0.5, 1], [0.92, 0.95], [1, 0.85]], 48), W, 0, 0, -R * 0.66);
  for (const z of [-0.45, -0.62, -0.82]) add(new THREE.TorusGeometry(R * 0.162, R * 0.007, 8, 72), G, 0, 0, R * z);
  for (const z of [0.25, 0.62]) add(new THREE.TorusGeometry(R * (z > 0.5 ? 0.21 : 0.268), R * 0.006, 8, 96), G, 0, 0, R * z).scale.y = 0.9;
  // сердце-реактор: бело-голубое солнце с лучами в золотой клетке
  const zc = -0.2;
  // торцы корпуса по обе стороны реактора — «солнечные» диски с лучами
  const sunTex = cachedMat('sunDiskTex', () => canvasTex(256, 256, (c, w, h) => {
    const gr = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, '#cfe6ff'); gr.addColorStop(0.7, '#2a4a80'); gr.addColorStop(1, '#0a1020');
    c.fillStyle = gr; c.fillRect(0, 0, w, h); c.translate(w / 2, h / 2);
    for (let i = 0; i < 48; i++) { c.rotate(Math.PI * 2 / 48); c.fillStyle = i % 2 ? 'rgba(210,235,255,0.9)' : 'rgba(255,220,150,0.7)'; c.fillRect(-1.5, w * 0.08, 3, w * (0.3 + (i % 3) * 0.05)); }
  }));
  const sunMat = cachedMat('sunDisk', () => new THREE.MeshBasicMaterial({ map: sunTex, color: new THREE.Color(1, 1, 1).multiplyScalar(2.2), toneMapped: false }));
  add(new THREE.CircleGeometry(R * 0.186, 64), sunMat, 0, 0, -R * 0.096).rotation.y = Math.PI;
  add(new THREE.CircleGeometry(R * 0.128, 48), sunMat, 0, 0, -R * 0.299);
  SERAPH.core = SERAPH.core || new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.98, 1).multiplyScalar(5), toneMapped: false });
  SERAPH.burst = SERAPH.burst || new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.85, 1).multiplyScalar(3), toneMapped: false });
  add(new THREE.SphereGeometry(R * 0.085, 32, 20), SERAPH.core, 0, 0, R * zc);
  const rays = [];
  for (let i = 0; i < 44; i++) { // лучи по сфере Фибоначчи, кроме направлений вдоль оси (там корпус)
    const y = 1 - (i + 0.5) / 44 * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    const d = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    if (Math.abs(d.z) > 0.55) continue;
    const L = R * (0.08 + (i % 3) * 0.03), b = new THREE.BoxGeometry(R * 0.007, L, R * 0.018);
    b.translate(0, R * 0.085 + L / 2, 0); b.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d)); rays.push(b);
  }
  add(mergeGeometries(rays), SERAPH.burst, 0, 0, R * zc);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: sharedTextures().glow, color: new THREE.Color(0.75, 0.88, 1).multiplyScalar(1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  halo.position.set(0, 0, R * zc); halo.scale.setScalar(R * 0.75); g.add(halo);
  add(new THREE.TorusGeometry(R * 0.195, R * 0.02, 10, 96), G, 0, 0, -R * 0.095);
  add(new THREE.TorusGeometry(R * 0.17, R * 0.018, 10, 96), G, 0, 0, -R * 0.3);
  add(new THREE.TorusGeometry(R * 0.215, R * 0.005, 6, 96), glowMat(0x9fd0ff, 3), 0, 0, R * zc);
  for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; g.add(rod([Math.cos(a) * R * 0.195, Math.sin(a) * R * 0.195, -R * 0.095], [Math.cos(a + 0.3) * R * 0.17, Math.sin(a + 0.3) * R * 0.17, -R * 0.3], R * 0.007, G)); }
  // золотой осевой стержень с навершиями
  add(new THREE.CylinderGeometry(R * 0.013, R * 0.013, R * 2.68, 12), G, 0, 0, -R * 0.02).rotation.x = Math.PI / 2;
  add(new THREE.OctahedronGeometry(R * 0.035), G, 0, 0, R * 1.34).scale.set(0.6, 0.6, 2);
  add(new THREE.SphereGeometry(R * 0.016, 12, 8), glowMat(0xfff0c8, 4), 0, 0, R * 1.42);
  for (const [z, r] of [[-1.18, 0.04], [-1.23, 0.03], [-1.28, 0.022]]) add(new THREE.CylinderGeometry(R * r, R * r, R * 0.012, 24), G, 0, 0, R * z).rotation.x = Math.PI / 2;
  add(new THREE.OctahedronGeometry(R * 0.04), G, 0, 0, -R * 1.36).scale.set(0.6, 0.6, 1.8);
  // крылья-листья: золотая рама, тёмная вставка со светящейся филигранью
  SERAPH.panel = SERAPH.panel || new THREE.MeshStandardMaterial({ map: filigreeTexture(), emissiveMap: null, emissive: 0xffc860, emissiveIntensity: 1.7, metalness: 0.55, roughness: 0.35, side: THREE.DoubleSide });
  if (!SERAPH.panel.emissiveMap) SERAPH.panel.emissiveMap = SERAPH.panel.map;
  const outline = [[0.1, 0.16], [1.22, -0.7], [1.06, -1.0], [0.1, -0.02]].map(([x, z]) => [x * R, -z * R]); // (x, y = −z) для Shape
  const inner = insetPoly(outline, R * 0.03);
  const shape = (pts) => { const sh = new THREE.Shape(); pts.forEach(([x, y], i) => i ? sh.lineTo(x, y) : sh.moveTo(x, y)); sh.closePath(); return sh; };
  const frameShape = shape(outline); frameShape.holes.push(shape(inner));
  const frameGeo = new THREE.ExtrudeGeometry(frameShape, { depth: R * 0.022, bevelEnabled: true, bevelThickness: R * 0.005, bevelSize: R * 0.005, bevelSegments: 2 });
  frameGeo.translate(0, 0, -R * 0.011); frameGeo.rotateX(-Math.PI / 2);
  const panelGeo = new THREE.ShapeGeometry(shape(inner)); panelGeo.rotateX(-Math.PI / 2);
  { // UV вдоль оси листа: v — от корня к законцовке, u — поперёк
    const rc = [0.1 * R, 0.07 * R], tc = [1.14 * R, -0.85 * R], ax = [tc[0] - rc[0], tc[1] - rc[1]], L = Math.hypot(...ax), A = [ax[0] / L, ax[1] / L], B = [-A[1], A[0]];
    const pos = panelGeo.attributes.position, uv = panelGeo.attributes.uv; let wmax = 0;
    for (let i = 0; i < pos.count; i++) wmax = Math.max(wmax, Math.abs((pos.getX(i) - rc[0]) * B[0] + (pos.getZ(i) - rc[1]) * B[1]));
    for (let i = 0; i < pos.count; i++) { const dx = pos.getX(i) - rc[0], dz = pos.getZ(i) - rc[1]; uv.setXY(i, 0.5 + (dx * B[0] + dz * B[1]) / (wmax * 2.05), (dx * A[0] + dz * A[1]) / L); }
  }
  for (const sd of [1, -1]) {
    const wg = new THREE.Group(); wg.scale.x = sd; wg.position.z = R * 0.02; wg.rotation.z = sd * 0.17; // лёгкий подъём законцовок
    wg.add(new THREE.Mesh(frameGeo, G), new THREE.Mesh(panelGeo, SERAPH.panel));
    const pyl = new THREE.Mesh(rbox(R * 0.12, R * 0.04, R * 0.2), G); pyl.position.set(R * 0.12, 0, R * 0.05); wg.add(pyl);
    g.add(wg);
    for (const [x, z] of [[0.15, 0.13], [0.45, -0.1], [0.75, -0.35], [1.05, -0.6], [1.22, -0.7], [1.15, -0.85], [1.06, -1.0], [0.8, -0.72], [0.5, -0.45], [0.2, -0.15], [0.6, -0.5], [0.95, -0.75]])
      for (const y of [0.025, -0.025]) { wg.updateMatrix(); const v = new THREE.Vector3(x * R, y * R, z * R).applyMatrix4(wg.matrix); arcPts.push([v.x, v.y, v.z]); }
  }
  addLights(g, [[R * 1.2, R * 0.2, -R * 0.68, R * 0.012], [-R * 1.2, R * 0.2, -R * 0.68, R * 0.012]], 0xffd070);
  // кормовая «астролябия»: кольца разного диаметра, зубчатый обод, спицы; часть колец вращается
  const astro = new THREE.Group(); astro.position.z = -R * 1.06; g.add(astro);
  const ring = (r, tube, mat, z = 0, spin = 0) => { const m = new THREE.Mesh(new THREE.TorusGeometry(R * r, R * tube, 12, 160), mat); m.position.z = R * z; if (spin) m.userData.spin = ['z', spin]; astro.add(m); return m; };
  ring(0.64, 0.028, C); ring(0.6, 0.012, G, 0.035); ring(0.67, 0.008, G, -0.03);
  const teeth = []; for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2, b = new THREE.BoxGeometry(R * 0.022, R * 0.05, R * 0.05); b.translate(0, R * 0.69, 0); b.rotateZ(a); teeth.push(b); }
  const teethM = new THREE.Mesh(mergeGeometries(teeth), C); teethM.userData.spin = ['z', 0.06]; astro.add(teethM);
  const mid = new THREE.Group(); mid.userData.spin = ['z', -0.22]; astro.add(mid);
  mid.add(new THREE.Mesh(new THREE.TorusGeometry(R * 0.5, R * 0.02, 12, 140), C));
  mid.add(new THREE.Mesh(new THREE.TorusGeometry(R * 0.42, R * 0.005, 8, 140), glowMat(0xffd890, 2)));
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; mid.add(rod([Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3, 0], [Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, 0], R * 0.008, G)); }
  const inn = new THREE.Group(); inn.userData.spin = ['z', 0.4]; inn.position.z = -R * 0.03; astro.add(inn);
  inn.add(new THREE.Mesh(new THREE.TorusGeometry(R * 0.3, R * 0.024, 12, 120), C));
  inn.add(new THREE.Mesh(new THREE.TorusGeometry(R * 0.085, R * 0.02, 10, 48), G));
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; inn.add(rod([Math.cos(a) * R * 0.09, Math.sin(a) * R * 0.09, 0], [Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3, 0], R * 0.006, C)); }
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.add(rod([Math.cos(a) * R * 0.14, Math.sin(a) * R * 0.14, -R * 0.92], [Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62, -R * 1.06], R * 0.01, G)); }
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; pt(Math.cos(a) * 0.665, Math.sin(a) * 0.665, -1.06); }
  addEngine(g, 0, 0, -R * 1.03, R * 0.07, 0xbfe0ff);
  // ангар дронов: створки на брюхе носовой части
  for (const x of [-0.07, 0.07]) add(new THREE.PlaneGeometry(R * 0.035, R * 0.36), glowMat(0xffc880, 1.2), R * x, -R * 0.262, R * 0.45).rotation.x = Math.PI / 2;
  for (const z of [0.15, 0.4, 0.65, 0.9]) { pt(0, 0.26, z); pt(0, -0.25, z); pt(0.27, 0, z); pt(-0.27, 0, z); }
  for (const z of [-0.45, -0.65, -0.9]) { pt(0.16, 0, z); pt(-0.16, 0, z); pt(0, 0.16, z); }
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; pt(Math.cos(a) * 0.2, Math.sin(a) * 0.2, -0.2); }
  pt(0, 0, 1.4); pt(0, 0, -1.36);
  g.traverse(o => { if (o.isMesh && (o.material === W || o.material === G || o.material === C)) o.castShadow = o.receiveShadow = true; });
  g.userData.arcPts = arcPts; g.userData.core = [0, 0, R * zc];
}

// ======================================================================
// Набор «скульптурных» корпусов: корпус собирается по сечениям вдоль длины (лофт), гранёный или гладкий.
// Четыре стиля верфей: Стандарт Арктура (гранёные клинья, слоистая броня, спонсоны),
// Консорциум («соборные» корпуса слоновой кости с золотом), Лига (ржавый индустриальный: фермы, асимметрия, лопасти),
// Орден (гладкие органические формы и кристаллы).
// ======================================================================
const PROFS = {
  hex: [[1, 0], [0.5, 0.87], [-0.5, 0.87], [-1, 0], [-0.5, -0.87], [0.5, -0.87]],
  diamond: [[1, 0], [0, 1], [-1, 0], [0, -1]],
  wedge: [[1, -0.4], [0.72, 0.22], [0, 1], [-0.72, 0.22], [-1, -0.4], [-0.55, -0.85], [0.55, -0.85]],
  keel: [[1, 0.05], [0.6, 0.6], [0, 0.85], [-0.6, 0.6], [-1, 0.05], [-0.55, -0.55], [0, -1], [0.55, -0.55]],
  box: [[1, 0.6], [0.72, 1], [-0.72, 1], [-1, 0.6], [-1, -0.6], [-0.72, -1], [0.72, -1], [1, -0.6]],
  cath: [[1, -0.3], [0.62, 0.32], [0.2, 1], [-0.2, 1], [-0.62, 0.32], [-1, -0.3], [-0.6, -0.85], [0.6, -0.85]],
  flat: [[1, 0.1], [0.8, 0.55], [-0.8, 0.55], [-1, 0.1], [-1, -0.2], [-0.75, -0.5], [0.75, -0.5], [1, -0.2]],
  blade: [[1, 0], [0.3, 1], [-0.3, 1], [-1, 0], [-0.3, -1], [0.3, -1]],
  round: Array.from({ length: 20 }, (_, i) => [Math.cos(i / 20 * Math.PI * 2), Math.sin(i / 20 * Math.PI * 2)])
};
// Лофт: сечения [z, w, h, y = 0, x = 0], одинаковый профиль; гранёный (плоские нормали) или гладкий
// плавные переходы между сечениями: Catmull-Rom по каждому параметру (z, ширина, высота, смещения)
function smoothSecs(secs, sub = 3) {
  if (secs.length < 3) return secs;
  const out = [], v = secs.map(([z, w, h, y = 0, x = 0]) => [z, w, h, y, x]);
  for (let i = 0; i + 1 < v.length; i++) {
    const p0 = v[Math.max(0, i - 1)], p1 = v[i], p2 = v[i + 1], p3 = v[Math.min(v.length - 1, i + 2)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      out.push(p1.map((_, j) => Math.max(j === 1 || j === 2 ? 0.0005 : -1e9, 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3))));
    }
  }
  out.push(v[v.length - 1]);
  return out;
}
// нормали «с изломом»: пологие переходы сглажены, острые рёбра (больше 38°) остаются острыми
function creaseNormals(g, deg = 38) {
  const pos = g.attributes.position, n = pos.count, fn = new Float32Array(n * 3), cos = Math.cos(deg * Math.PI / 180);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2); const L = e1.length() || 1; e1.divideScalar(L);
    for (let k = 0; k < 3; k++) { fn[(i + k) * 3] = e1.x; fn[(i + k) * 3 + 1] = e1.y; fn[(i + k) * 3 + 2] = e1.z; }
  }
  const key = (i) => `${Math.round(pos.getX(i) * 1e3)},${Math.round(pos.getY(i) * 1e3)},${Math.round(pos.getZ(i) * 1e3)}`;
  const groups = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); let l = groups.get(k); if (!l) groups.set(k, l = []); l.push(i); }
  const out = new Float32Array(n * 3);
  for (const l of groups.values()) for (const i of l) {
    let x = 0, y = 0, z = 0;
    for (const j of l) { const d = fn[i * 3] * fn[j * 3] + fn[i * 3 + 1] * fn[j * 3 + 1] + fn[i * 3 + 2] * fn[j * 3 + 2]; if (d >= cos) { x += fn[j * 3]; y += fn[j * 3 + 1]; z += fn[j * 3 + 2]; } }
    const L = Math.hypot(x, y, z) || 1; out[i * 3] = x / L; out[i * 3 + 1] = y / L; out[i * 3 + 2] = z / L;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}
function loftGeo(secs, prof = 'hex', smooth = false) {
  secs = smoothSecs(secs, smooth ? 4 : 3);
  const P = PROFS[prof] || PROFS.hex, n = P.length, rings = secs.map(([z, w, h, y = 0, x = 0]) => P.map(([px, py]) => [x + px * w, y + py * h, z]));
  const tri = [];
  const push = (a, b, c) => tri.push(...a, ...b, ...c);
  for (let i = 0; i + 1 < rings.length; i++) for (let k = 0; k < n; k++) {
    const a = rings[i][k], b = rings[i][(k + 1) % n], c = rings[i + 1][(k + 1) % n], d = rings[i + 1][k];
    push(a, c, d); push(a, b, c); // обход — наружу (нос по +Z)
  }
  const cap = (ring, rev) => { const c = ring.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]); for (let k = 0; k < n; k++) rev ? push(c, ring[k], ring[(k + 1) % n]) : push(c, ring[(k + 1) % n], ring[k]); };
  cap(rings[0], false); cap(rings[rings.length - 1], true);
  let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  if (smooth) { g = mergeVertices(g, 1e-4); g.computeVertexNormals(); }
  else creaseNormals(g);
  return g;
}
function shipKit(g, R, M, D, eng, faction, add) {
  const s = (v) => v * R;
  const K = {
    R, M, D, s, g,
    G: goldMat(), C: crystalMat(), glass: glassMat(),
    glow: (c, k = 2.6) => glowMat(c, k),
    // корпус по сечениям: значения — в долях R
    loft(secs, prof = 'hex', mat = M, smooth = false) { const m = add(loftGeo(secs.map(([z, w, h, y = 0, x = 0]) => [s(z), s(w), s(h), s(y), s(x)]), prof, smooth), mat); m.userData.uvTile = 2.2; return m; },
    mirror(fn) { fn(1); fn(-1); },
    box(w, h, d, x = 0, y = 0, z = 0, mat = M) { return add(rbox(s(w), s(h), s(d)), mat, s(x), s(y), s(z)); },
    rod(a, b, r, mat = D) { return g.add(rod(a.map(s), b.map(s), s(r), mat)); },
    // крыло: размах, хорда, стреловидность, толщина; sd — сторона (±1), dih — поперечный наклон
    wing(x, y, z, span, chord, sweep, thick, sd, dih = 0, mat = M) {
      const w = add(wingGeo(s(span), s(chord), s(sweep), s(thick)), mat, s(x) * sd, s(y), s(z));
      if (sd < 0) w.scale.x = -1; w.rotation.z = dih * sd; return w;
    },
    // вертикальный киль/лопасть
    fin(x, y, z, h, chord, sweep, thick = 0.03, mat = M, tilt = 0) {
      const f = add(wingGeo(s(h), s(chord), s(sweep), s(thick)), mat, s(x), s(y), s(z)); f.rotation.z = Math.PI / 2 + tilt; return f;
    },
    eng(x, y, z, r, len = 1) {
      add(lathe(s(r) * 2.4 * len, s(r) * 1.25, [[0, 0.85], [0.2, 1], [0.8, 0.95], [1, 0.75]], 18), D, s(x), s(y), s(z) + s(r) * 1.1 * len); // кожух дюзы
      addEngine(g, s(x), s(y), s(z), s(r), eng, len);
    },
    turret(x, y, z, sz, mat = D) { addTurret(g, s(x), s(y), s(z), s(sz), mat); },
    lights(pts, c) { addLights(g, pts.map(([x, y, z, r]) => [s(x), s(y), s(z), s(r || 0.02)]), c); },
    trim(w, h, d, x, y, z, c = 0x9fd8ff, k = 1.6) { return add(rbox(s(w), s(h), s(d)), glowMat(c, k), s(x), s(y), s(z)); },
    canopy(x, y, z, sx, sy, sz) { return add(new THREE.SphereGeometry(s(1), 20, 12), glassMat(), s(x), s(y), s(z), sx, sy, sz); },
    // ряд окон на борту: полоса с текстурой светящихся иллюминаторов
    windows(x, y, z, len, h, sd = 1, dense = false) {
      const key = 'win' + (dense ? 'D' : '');
      const m = cachedMat(key, () => new THREE.MeshStandardMaterial({ color: 0x0c0c0c, emissive: 0xffe8c0, emissiveMap: dense ? sharedTextures().windowsDense : sharedTextures().windows, emissiveIntensity: 1.25, metalness: 0.3, roughness: 0.6 }));
      const p = add(new THREE.PlaneGeometry(s(len), s(h)), m, s(x) * sd, s(y), s(z)); p.rotation.y = sd * Math.PI / 2; return p;
    },
    greeb(count, w, y, d, z = 0) { const gr = new THREE.Group(); greebles(gr, R, count, D, [s(w), s(y), s(d)]); gr.position.z = s(z); g.add(gr); },
    // ферма между двумя точками: два пояса и раскосы
    truss(a, b, r = 0.015, mat = D, n = 6, off = 0.06) {
      const A = new THREE.Vector3(...a.map(s)), B = new THREE.Vector3(...b.map(s)), up = new THREE.Vector3(0, s(off), 0);
      g.add(rod(A.clone().add(up).toArray(), B.clone().add(up).toArray(), s(r), mat)); g.add(rod(A.clone().sub(up).toArray(), B.clone().sub(up).toArray(), s(r), mat));
      for (let i = 0; i < n; i++) { const p = A.clone().lerp(B, i / n), q = A.clone().lerp(B, (i + 1) / n); g.add(rod(p.clone().add(up).toArray(), q.clone().sub(up).toArray(), s(r * 0.7), mat)); }
    },
    // светящийся шов по корпусу: повторяет его сечения (верх — 'top', низ — 'bottom', борта — 'side')
    seam(secs, where = 'top', c = 0xb080ff, k = 2.3, t = 0.012) {
      const pick = (sec, sd) => { const [z, w, h, y = 0, x = 0] = sec; return where === 'side' ? [z, t, t, y, x + (w + t * 0.4) * sd] : [z, t, t, y + (h + t * 0.4) * (where === 'top' ? 1 : -1), x]; };
      const inner = secs.slice(1, -1);
      if (inner.length < 2) return;
      const mat = glowMat(c, k);
      if (where === 'side') this.mirror(sd => this.loft(inner.map(q => pick(q, sd)), 'round', mat, true)); else this.loft(inner.map(q => pick(q, 1)), 'round', mat, true);
    },
    dish(x, y, z, r, spin = 0.8) { const d = add(new THREE.SphereGeometry(s(r), 20, 6, 0, Math.PI * 2, 0, 0.85), D, s(x), s(y), s(z)); d.rotation.x = -1.1; if (spin) d.userData.spin = ['y', spin]; return d; }
  };
  return K;
}
const DESIGN = {
  // ===================== Стандарт Арктура: гранёные клинья, слоистая броня =====================
  iskra(K) { // фрегат-новичок: короткий гранёный корпус, утки-крылья, один двигатель
    K.loft([[-0.9, 0.26, 0.2], [-0.55, 0.34, 0.25, 0.02], [0.1, 0.3, 0.22, 0.04], [0.65, 0.16, 0.13, 0.01], [1.0, 0.02, 0.03, -0.02]], 'keel');
    K.loft([[-0.45, 0.14, 0.08, 0.2], [0.2, 0.12, 0.08, 0.22], [0.45, 0.02, 0.02, 0.16]], 'wedge', K.D);
    K.canopy(0, 0.2, 0.3, 0.09, 0.06, 0.2);
    K.mirror(sd => { K.wing(0.22, -0.04, -0.4, 0.5, 0.45, 0.3, 0.035, sd, 0.12); K.wing(0.15, 0.0, 0.5, 0.18, 0.18, 0.08, 0.025, sd, -0.1); });
    K.fin(0, 0.15, -0.65, 0.28, 0.35, 0.2);
    K.eng(0, 0, -0.98, 0.15);
    K.trim(0.02, 0.012, 0.6, 0, 0.255, -0.1);
    K.lights([[0.7, -0.02, -0.45], [-0.7, -0.02, -0.45]], 0xff2020);
  },
  klinok(K) { // штурмовой фрегат: кинжал с двумя носовыми клинками
    K.loft([[-1.0, 0.2, 0.16], [-0.6, 0.3, 0.2, 0.02], [0.1, 0.24, 0.17, 0.03], [0.55, 0.08, 0.08, 0.01], [0.75, 0.01, 0.01]], 'wedge');
    K.mirror(sd => {
      K.loft([[-0.3, 0.07, 0.09, -0.02, 0.26 * sd], [0.4, 0.07, 0.08, -0.02, 0.28 * sd], [1.0, 0.035, 0.04, -0.03, 0.22 * sd], [1.3, 0.005, 0.005, -0.04, 0.16 * sd]], 'diamond');
      K.wing(0.18, -0.02, -0.55, 0.62, 0.5, 0.42, 0.03, sd, -0.08);
      K.fin(0.3 * sd, 0.05, -0.8, 0.26, 0.3, 0.2, 0.02, K.M, -0.35 * sd);
      K.eng(0.14 * sd, 0, -1.03, 0.11);
    });
    K.trim(0.02, 0.02, 0.4, 0, -0.02, 1.0, 0xff6040, 2.4);
    K.canopy(0, 0.16, 0.15, 0.07, 0.05, 0.2);
    K.lights([[0.78, -0.02, -0.65], [-0.78, -0.02, -0.65]], 0x40ff60);
  },
  strizh(K) { // перехватчик: игла и опущенные дельта-крылья
    K.loft([[-1.0, 0.16, 0.14], [-0.4, 0.2, 0.15], [0.4, 0.13, 0.1], [1.15, 0.01, 0.01]], 'diamond');
    K.mirror(sd => { K.wing(0.1, -0.03, -0.45, 0.8, 0.85, 0.75, 0.025, sd, -0.28); K.fin(0.55 * sd, -0.2, -0.75, 0.2, 0.25, 0.2, 0.015, K.M, 0.9 * sd); });
    K.canopy(0, 0.1, 0.25, 0.06, 0.05, 0.22);
    K.eng(0, 0, -1.05, 0.15, 1.2);
    K.trim(0.015, 0.01, 0.9, 0, 0.13, -0.05, 0x60c0ff, 2);
  },
  sokol(K) { // разведчик: корпус с носовой штангой антенны и спинной тарелкой
    K.loft([[-0.95, 0.2, 0.18], [-0.45, 0.28, 0.22, 0.02], [0.35, 0.22, 0.17, 0.03], [0.8, 0.06, 0.06]], 'hex');
    K.rod([0, 0, 0.78], [0, 0, 1.35], 0.012);
    K.trim(0.03, 0.03, 0.03, 0, 0, 1.35, 0x60e0ff, 3);
    K.rod([0, 0.2, -0.2], [0, 0.42, -0.25], 0.012); K.dish(0, 0.44, -0.25, 0.14, 1.4);
    K.mirror(sd => { K.wing(0.18, 0.02, -0.45, 0.45, 0.42, 0.3, 0.025, sd, 0.35); K.rod([0.25 * sd, 0, 0.1], [0.55 * sd, 0.05, 0.6], 0.008); });
    K.canopy(0, 0.17, 0.2, 0.08, 0.055, 0.2);
    K.eng(0, 0, -1.0, 0.13);
    K.lights([[0.6, 0.2, -0.6], [-0.6, 0.2, -0.6]], 0x60e0ff);
  },
  staratel(K) { // шахтёрский фрегат: короткий корпус, две буровые клешни, рудный контейнер снизу
    K.loft([[-0.9, 0.3, 0.22], [-0.3, 0.38, 0.28, 0.03], [0.4, 0.32, 0.24, 0.03], [0.75, 0.18, 0.15]], 'box');
    K.loft([[-0.6, 0.22, 0.14, -0.3], [0.3, 0.24, 0.15, -0.3], [0.5, 0.12, 0.08, -0.26]], 'hex', K.D);
    K.mirror(sd => {
      armSegment(K.g, [K.s(0.3 * sd), 0, K.s(0.6)], [K.s(0.55 * sd), K.s(0.05), K.s(0.95)], K.s(0.04), K.D);
      armSegment(K.g, [K.s(0.55 * sd), K.s(0.05), K.s(0.95)], [K.s(0.32 * sd), -K.s(0.05), K.s(1.25)], K.s(0.03), K.D);
      K.trim(0.05, 0.05, 0.05, 0.32 * sd, -0.05, 1.27, 0x80ff90, 3);
      K.eng(0.18 * sd, 0, -0.95, 0.11);
    });
    K.canopy(0, 0.24, 0.35, 0.1, 0.06, 0.16);
    K.trim(0.5, 0.012, 0.03, 0, 0.29, 0.1, 0xffb040, 1.5);
    K.lights([[0.4, 0, -0.6], [-0.4, 0, -0.6]], 0xffa020);
  },
  gadyuka(K) { // ракетный фрегат: плоская «змеиная голова», пусковые блоки по бортам, двойной хвост
    K.loft([[-1.0, 0.18, 0.1], [-0.4, 0.34, 0.14], [0.35, 0.3, 0.12, 0.01], [0.85, 0.12, 0.06], [1.05, 0.01, 0.01]], 'flat');
    K.mirror(sd => {
      K.box(0.14, 0.12, 0.55, 0.36 * sd, 0.02, 0.05, K.D);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) K.trim(0.035, 0.03, 0.01, (0.31 + j * 0.09) * sd, 0.02 + (i - 1) * 0.035, 0.33, 0xffa040, 2.6);
      K.fin(0.12 * sd, 0.08, -0.8, 0.28, 0.32, 0.25, 0.02, K.M, -0.4 * sd);
      K.eng(0.12 * sd, 0, -1.03, 0.1);
    });
    K.canopy(0, 0.1, 0.3, 0.08, 0.04, 0.2);
    K.lights([[0.45, 0, -0.3], [-0.45, 0, -0.3]], 0xff7020);
  },
  vihr(K) { // эсминец: длинный узкий корпус, раздвоенный нос, ряд из шести башен по хребту
    K.loft([[-1.05, 0.2, 0.18], [-0.6, 0.26, 0.22, 0.02], [0.4, 0.24, 0.2, 0.02], [0.8, 0.16, 0.12]], 'keel');
    K.mirror(sd => K.loft([[0.7, 0.07, 0.1, 0, 0.1 * sd], [1.1, 0.05, 0.07, -0.01, 0.12 * sd], [1.35, 0.01, 0.02, -0.03, 0.08 * sd]], 'diamond'));
    K.loft([[-0.8, 0.12, 0.06, 0.2], [0.5, 0.1, 0.05, 0.19]], 'flat', K.D);
    for (let i = 0; i < 6; i++) K.turret((i % 2 ? 1 : -1) * 0.1, 0.23, 0.45 - i * 0.22, 0.075);
    K.box(0.14, 0.14, 0.2, 0, 0.3, -0.75); K.canopy(0, 0.36, -0.68, 0.08, 0.04, 0.08);
    K.mirror(sd => { K.wing(0.2, -0.04, -0.7, 0.35, 0.35, 0.2, 0.03, sd, 0.1); K.eng(0.14 * sd, -0.02, -1.08, 0.09); });
    K.eng(0, 0.05, -1.1, 0.11);
    K.trim(0.015, 0.015, 1.2, 0.2, 0, -0.1, 0x60c0ff, 1.5); K.trim(0.015, 0.015, 1.2, -0.2, 0, -0.1, 0x60c0ff, 1.5);
    K.lights([[0.55, -0.04, -0.6], [-0.55, -0.04, -0.6]], 0xff2020);
  },
  tyagach(K) { // транспорт: рубка, хребет-ферма, два ряда контейнеров, двигательный блок
    K.loft([[0.65, 0.3, 0.26], [0.9, 0.28, 0.24, 0.02], [1.15, 0.12, 0.1]], 'box');
    K.canopy(0, 0.16, 1.0, 0.18, 0.06, 0.12);
    K.box(0.08, 0.08, 1.4, 0, 0, -0.05, K.D);
    const cols = [0x8a5a2a, 0x3f6a7a, 0x7a7a40, 0x6a3a3a].map(c => pbrMat(c, 'station'));
    for (let i = 0; i < 4; i++) K.mirror(sd => K.box(0.26, 0.26, 0.3, 0.16 * sd, 0, 0.45 - i * 0.33, cols[(i + (sd > 0 ? 0 : 2)) % 4]));
    K.loft([[-1.05, 0.34, 0.24], [-0.85, 0.38, 0.28], [-0.7, 0.3, 0.22]], 'box');
    K.mirror(sd => { K.eng(0.18 * sd, 0.08, -1.12, 0.1); K.eng(0.18 * sd, -0.1, -1.12, 0.1); K.fin(0.3 * sd, 0.1, -0.85, 0.25, 0.25, 0.1, 0.02, K.M, -0.3 * sd); });
    K.lights([[0.45, 0, -0.9], [-0.45, 0, -0.9], [0, 0.3, 0.95]], 0x40ff60);
  },
  burlak(K) { // шахтёрская баржа: широкий плоский корпус, три стреловых бура, купол рудного трюма
    K.loft([[-1.0, 0.5, 0.2], [-0.6, 0.62, 0.26, 0.02], [0.4, 0.6, 0.24, 0.02], [0.75, 0.42, 0.18], [0.9, 0.25, 0.1]], 'flat');
    add2(K, new THREE.SphereGeometry(K.s(0.38), 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), K.M, 0, 0.1, -0.2, 1, 0.55, 1.2);
    K.trim(0.8, 0.012, 0.012, 0, 0.12, -0.2, 0xffb040, 1.4);
    for (const x of [-0.35, 0, 0.35]) {
      armSegment(K.g, [K.s(x), K.s(0.05), K.s(0.6)], [K.s(x * 1.2), K.s(0.12), K.s(1.0)], K.s(0.035), K.D);
      armSegment(K.g, [K.s(x * 1.2), K.s(0.12), K.s(1.0)], [K.s(x), K.s(-0.02), K.s(1.3)], K.s(0.028), K.D);
      K.trim(0.06, 0.06, 0.06, x, -0.02, 1.32, 0x80ff90, 3);
    }
    K.box(0.22, 0.14, 0.2, 0.32, 0.25, -0.65); K.canopy(0.32, 0.31, -0.58, 0.09, 0.04, 0.06);
    K.mirror(sd => { K.eng(0.3 * sd, 0, -1.07, 0.12); K.eng(0.48 * sd, 0, -1.02, 0.08); });
    K.greeb(26, 1.0, 0.14, 1.4);
    K.lights([[0.62, 0, 0.4], [-0.62, 0, 0.4]], 0xffa020);
  },
  strazh(K) { // крейсер: слоистый клин, надстройка-рубка, бортовые спонсоны с орудиями
    K.loft([[-1.0, 0.3, 0.22], [-0.5, 0.42, 0.28, 0.02], [0.3, 0.36, 0.24, 0.03], [0.8, 0.16, 0.12], [1.1, 0.02, 0.03]], 'wedge');
    K.loft([[-0.8, 0.22, 0.1, 0.22], [0.2, 0.2, 0.09, 0.24], [0.5, 0.03, 0.03, 0.2]], 'wedge', K.D);
    K.box(0.18, 0.16, 0.22, 0, 0.38, -0.45); K.canopy(0, 0.44, -0.36, 0.1, 0.045, 0.08);
    K.mirror(sd => {
      K.loft([[-0.7, 0.08, 0.1, 0, 0.42 * sd], [0.3, 0.09, 0.1, 0, 0.44 * sd], [0.55, 0.03, 0.05, 0, 0.4 * sd]], 'hex');
      K.turret(0.44 * sd, 0.1, 0.15, 0.08); K.turret(0.44 * sd, 0.1, -0.25, 0.08);
      K.eng(0.42 * sd, 0, -0.8, 0.08);
      K.trim(0.01, 0.015, 0.9, 0.36 * sd, 0.05, -0.1, 0x60c0ff, 1.6);
    });
    K.turret(0, 0.3, 0.2, 0.09);
    K.eng(0, 0, -1.07, 0.13); K.mirror(sd => K.eng(0.16 * sd, 0, -1.05, 0.09));
    K.windows(0.36, 0.06, -0.2, 0.6, 0.04, 1); K.windows(0.36, 0.06, -0.2, 0.6, 0.04, -1);
    K.lights([[0.55, 0, 0.5], [-0.55, 0, 0.5]], 0xff2020);
  },
  burya(K) { // ракетный крейсер: широкий наконечник стрелы и два ракетных блока на выносных фермах
    K.loft([[-1.0, 0.24, 0.2], [-0.4, 0.5, 0.22, 0.02], [0.3, 0.42, 0.18, 0.02], [0.9, 0.1, 0.08], [1.1, 0.01, 0.01]], 'flat');
    K.mirror(sd => {
      K.rod([0.3 * sd, 0, -0.1], [0.62 * sd, 0, -0.1], 0.03); K.rod([0.3 * sd, 0, -0.45], [0.62 * sd, 0, -0.45], 0.03);
      K.loft([[-0.7, 0.14, 0.14, 0, 0.66 * sd], [0.25, 0.15, 0.15, 0, 0.66 * sd], [0.45, 0.06, 0.07, 0, 0.66 * sd]], 'box', K.D);
      for (let i = 0; i < 5; i++) K.trim(0.24, 0.015, 0.06, 0.66 * sd, 0.15, 0.15 - i * 0.16, 0xff8030, 2.2); // люки ракетных шахт
      K.eng(0.66 * sd, 0, -0.75, 0.09);
      K.eng(0.14 * sd, 0, -1.05, 0.11);
    });
    K.loft([[-0.6, 0.14, 0.08, 0.2], [0.2, 0.12, 0.07, 0.21], [0.45, 0.02, 0.02, 0.17]], 'wedge', K.D);
    K.canopy(0, 0.25, 0.05, 0.08, 0.04, 0.12);
    K.lights([[0.8, 0, 0.3], [-0.8, 0, 0.3]], 0xff7020);
  },
  piligrim(K) { // дроновый крейсер: обтекаемый корпус с открытым светящимся ангаром снизу
    K.loft([[-1.0, 0.26, 0.24], [-0.5, 0.42, 0.34, 0.02], [0.3, 0.4, 0.3, 0.04], [0.85, 0.2, 0.16], [1.1, 0.04, 0.05]], 'keel');
    K.trim(0.26, 0.008, 0.5, 0, -0.335, -0.05, 0x3a5a90, 0.8); // проём ангара (утоплен в днище)
    K.mirror(sd => {
      for (let i = 0; i < 4; i++) K.trim(0.01, 0.06, 0.1, 0.4 * sd, -0.05, 0.4 - i * 0.25, 0x80d0ff, 2.4); // люки пусковых
      K.loft([[-0.9, 0.08, 0.12, 0.02, 0.35 * sd], [-0.2, 0.1, 0.14, 0.05, 0.4 * sd], [0.3, 0.04, 0.06, 0.03, 0.36 * sd]], 'hex');
      K.eng(0.36 * sd, 0.02, -0.95, 0.09);
    });
    K.box(0.18, 0.14, 0.24, 0, 0.36, -0.4); K.canopy(0, 0.42, -0.3, 0.09, 0.04, 0.08);
    K.rod([0, 0.42, -0.5], [0, 0.65, -0.55], 0.01); K.dish(0, 0.66, -0.55, 0.11, 1);
    K.eng(0, 0, -1.07, 0.13);
    K.lights([[0.46, 0, 0.3], [-0.46, 0, 0.3]], 0x80d0ff);
  },
  molot(K) { // линейный крейсер: «молот» — массивный носовой блок с четырьмя башнями
    K.loft([[-1.0, 0.28, 0.24], [-0.4, 0.32, 0.26, 0.02], [0.2, 0.3, 0.24, 0.02]], 'hex');
    K.loft([[0.15, 0.62, 0.22, 0.02], [0.55, 0.66, 0.24, 0.04], [0.95, 0.5, 0.16], [1.12, 0.3, 0.06, -0.02]], 'flat');
    for (const [x, z] of [[-0.35, 0.65], [0.35, 0.65], [-0.18, 0.35], [0.18, 0.35]]) K.turret(x, 0.27, z, 0.1);
    K.box(0.2, 0.2, 0.26, 0, 0.36, -0.4); K.canopy(0, 0.44, -0.3, 0.11, 0.05, 0.1);
    K.mirror(sd => {
      K.loft([[-0.95, 0.1, 0.16, 0, 0.36 * sd], [-0.3, 0.12, 0.18, 0, 0.38 * sd], [0.1, 0.05, 0.08, 0, 0.32 * sd]], 'hex');
      K.eng(0.36 * sd, 0, -1.02, 0.12);
      K.trim(0.01, 0.02, 0.7, 0.66 * sd, 0.02, 0.6, 0xff6040, 1.6);
      K.windows(0.31, 0.02, -0.4, 0.8, 0.05, sd);
    });
    K.eng(0, 0, -1.08, 0.15);
    K.greeb(20, 0.5, 0.22, 1.2, -0.3);
    K.lights([[0.7, 0, 0.6], [-0.7, 0, 0.6]], 0xff2020);
  },
  citadel(K) { // линкор: длинный киль, ярусы палуб, рубка-башня, восемь башен, бортовая броня
    K.loft([[-1.05, 0.34, 0.3], [-0.6, 0.44, 0.36, 0.02], [0.4, 0.42, 0.34, 0.03], [0.85, 0.26, 0.22], [1.15, 0.06, 0.06, -0.02]], 'keel');
    K.loft([[-0.8, 0.3, 0.12, 0.3], [0.4, 0.28, 0.12, 0.32], [0.7, 0.06, 0.05, 0.28]], 'flat', K.D);
    K.loft([[-0.7, 0.16, 0.12, 0.45], [-0.2, 0.15, 0.12, 0.46], [0.0, 0.04, 0.05, 0.43]], 'wedge');
    K.box(0.14, 0.2, 0.16, 0, 0.62, -0.55); K.canopy(0, 0.68, -0.47, 0.08, 0.035, 0.06);
    for (let i = 0; i < 4; i++) K.mirror(sd => K.turret(0.2 * sd, 0.43, 0.55 - i * 0.28, 0.085));
    K.mirror(sd => {
      for (let i = 0; i < 4; i++) K.box(0.05, 0.22, 0.3, 0.44 * sd, -0.02, 0.5 - i * 0.34);
      K.windows(0.47, 0.05, -0.1, 1.2, 0.05, sd, true);
      K.eng(0.26 * sd, 0.05, -1.12, 0.11); K.eng(0.26 * sd, -0.15, -1.1, 0.09);
    });
    K.eng(0, 0, -1.15, 0.15);
    K.greeb(36, 0.5, 0.36, 1.4, -0.1);
    K.lights([[0.55, 0, 0.6], [-0.55, 0, 0.6], [0, 0.75, -0.55]], 0xff2020);
  },
  leviafan(K) { // эксгуматор: широкий промышленный корпус, две длинные буровые стрелы с суставами
    K.loft([[-1.0, 0.42, 0.26], [-0.4, 0.5, 0.32, 0.02], [0.3, 0.46, 0.28, 0.02], [0.6, 0.3, 0.2]], 'box');
    K.loft([[-0.7, 0.3, 0.14, 0.3], [0.1, 0.28, 0.12, 0.32], [0.3, 0.1, 0.05, 0.28]], 'wedge', K.D);
    K.mirror(sd => {
      const base = [0.3 * sd, 0.1, 0.45], j1 = [0.62 * sd, 0.32, 0.85], j2 = [0.48 * sd, 0.05, 1.35];
      armSegment(K.g, base.map(K.s), j1.map(K.s), K.s(0.05), K.D); armSegment(K.g, j1.map(K.s), j2.map(K.s), K.s(0.04), K.D);
      K.box(0.12, 0.12, 0.12, j1[0], j1[1], j1[2], K.M);
      K.trim(0.08, 0.08, 0.08, j2[0], j2[1], j2[2], 0x40ffd0, 3);
      K.eng(0.32 * sd, 0, -1.07, 0.13);
      K.windows(0.5, 0.05, -0.2, 0.7, 0.05, sd);
    });
    K.box(0.2, 0.18, 0.24, -0.25, 0.48, -0.45); K.canopy(-0.25, 0.53, -0.36, 0.09, 0.04, 0.08);
    K.greeb(28, 0.8, 0.33, 1.3, -0.2);
    K.lights([[0.5, 0, 0.6], [-0.5, 0, 0.6]], 0xffa020);
  },
  kit(K) { // грузовоз: длинный хребет с тремя кольцами контейнеров и маленькой рубкой
    K.loft([[0.8, 0.3, 0.26], [1.0, 0.28, 0.24, 0.02], [1.15, 0.1, 0.1]], 'box');
    K.canopy(0, 0.16, 1.03, 0.16, 0.05, 0.08);
    K.box(0.12, 0.12, 1.8, 0, 0, -0.1, K.D);
    const cols = [0x8a5a2a, 0x3f6a7a, 0x7a7a40, 0x6a3a3a, 0x4a4a52].map(c => pbrMat(c, 'station'));
    for (let ring = 0; ring < 3; ring++) for (let a = 0; a < 8; a++) {
      const ang = a * Math.PI / 4, c = add2(K, rbox(K.s(0.22), K.s(0.22), K.s(0.4)), cols[(a + ring) % 5], Math.cos(ang) * 0.27, Math.sin(ang) * 0.27, 0.55 - ring * 0.5);
      c.rotation.z = ang;
    }
    K.loft([[-1.1, 0.42, 0.32], [-0.8, 0.46, 0.36], [-0.6, 0.3, 0.24]], 'box');
    K.mirror(sd => { K.eng(0.22 * sd, 0.12, -1.18, 0.12); K.eng(0.22 * sd, -0.14, -1.18, 0.12); });
    K.lights([[0.45, 0, -0.9], [-0.45, 0, -0.9], [0, 0.4, -0.85]], 0x40ff60);
  },
  bastion(K) { // линкор обороны: широкий «крепостной» корпус, купола щитовых излучателей, плоская палуба с башнями
    K.loft([[-1.0, 0.5, 0.26], [-0.5, 0.62, 0.32, 0.02], [0.4, 0.6, 0.3, 0.02], [0.9, 0.36, 0.2], [1.1, 0.1, 0.08]], 'box');
    K.loft([[-0.8, 0.46, 0.1, 0.32], [0.6, 0.44, 0.1, 0.32]], 'flat', K.D);
    for (const [x, z] of [[-0.3, 0.45], [0.3, 0.45], [0, 0.1], [-0.3, -0.25], [0.3, -0.25], [0, -0.6]]) K.turret(x, 0.42, z, 0.09);
    K.mirror(sd => {
      add2(K, new THREE.SphereGeometry(K.s(0.14), 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), glowMat(0x70a8ff, 1.3), 0.55 * sd, 0.3, 0.05);
      add2(K, new THREE.TorusGeometry(K.s(0.14), K.s(0.015), 8, 32), K.D, 0.55 * sd, 0.3, 0.05).rotation.x = Math.PI / 2;
      for (let i = 0; i < 3; i++) K.box(0.06, 0.34, 0.4, 0.62 * sd, -0.02, 0.5 - i * 0.45);
      K.eng(0.32 * sd, 0, -1.07, 0.12); K.eng(0.52 * sd, 0, -1.02, 0.09);
    });
    K.box(0.2, 0.26, 0.24, 0, 0.55, -0.85); K.canopy(0, 0.62, -0.75, 0.1, 0.04, 0.07);
    K.greeb(30, 0.8, 0.37, 1.4);
    K.lights([[0.66, 0, 0.6], [-0.66, 0, 0.6]], 0x70a8ff);
  },
  matka(K) { // авианосец: огромная плоская палуба с разметкой, боковые ангары, островная надстройка
    K.loft([[-1.0, 0.56, 0.26], [-0.6, 0.66, 0.3, 0.02], [0.6, 0.64, 0.28, 0.02], [1.0, 0.4, 0.2], [1.15, 0.1, 0.08]], 'flat');
    K.box(1.1, 0.03, 1.8, 0, 0.29, 0, K.D);
    for (let i = 0; i < 9; i++) K.trim(0.9, 0.006, 0.025, 0, 0.31, 0.8 - i * 0.2, 0x9fe060, 1.3);
    K.trim(0.02, 0.006, 1.7, 0, 0.312, 0, 0xffd060, 1.6);
    K.box(0.16, 0.36, 0.5, 0.45, 0.52, -0.3); K.box(0.12, 0.12, 0.2, 0.45, 0.76, -0.25); K.canopy(0.45, 0.66, -0.06, 0.07, 0.05, 0.05);
    K.rod([0.45, 0.82, -0.3], [0.45, 1.0, -0.32], 0.01); K.dish(0.45, 1.0, -0.32, 0.08, 1);
    K.mirror(sd => {
      for (let i = 0; i < 4; i++) K.trim(0.01, 0.1, 0.2, 0.66 * sd, 0.02, 0.6 - i * 0.4, 0x80c0ff, 1.6); // проёмы ангаров
      K.eng(0.3 * sd, 0, -1.07, 0.13); K.eng(0.52 * sd, 0, -1.04, 0.1);
    });
    K.greeb(24, 1.0, -0.15, 1.7);
    K.lights([[0.7, 0.3, 0.9], [-0.7, 0.3, 0.9]], 0x9fe060);
  },
  begemot(K) { // индустриальный дредноут: носовая «пасть» плавильни, трубы, конвейерные галереи
    K.loft([[-1.0, 0.5, 0.36], [-0.5, 0.6, 0.42, 0.02], [0.4, 0.62, 0.42, 0.02], [0.75, 0.56, 0.38]], 'box');
    const maw = add2(K, new THREE.TorusGeometry(K.s(0.36), K.s(0.09), 12, 40), K.D, 0, 0, 0.85);
    add2(K, new THREE.CircleGeometry(K.s(0.3), 32), glowMat(0xff7020, 2.2), 0, 0, 0.84);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; const t = add2(K, new THREE.ConeGeometry(K.s(0.04), K.s(0.22), 6), K.D, Math.cos(a) * 0.36, Math.sin(a) * 0.36, 1.0); t.rotation.x = Math.PI / 2; }
    for (const [x, z] of [[-0.3, -0.3], [0, -0.4], [0.3, -0.3]]) {
      add2(K, new THREE.CylinderGeometry(K.s(0.06), K.s(0.08), K.s(0.5), 12), K.D, x, 0.6, z);
      add2(K, new THREE.CircleGeometry(K.s(0.05), 12), glowMat(0xff8030, 2), x, 0.86, z).rotation.x = -Math.PI / 2;
    }
    K.mirror(sd => {
      K.box(0.16, 0.16, 1.4, 0.66 * sd, 0.12, -0.1);
      for (let i = 0; i < 7; i++) K.trim(0.01, 0.06, 0.1, 0.745 * sd, 0.12, 0.5 - i * 0.2, 0xffa040, 2);
      K.eng(0.32 * sd, 0.12, -1.07, 0.14); K.eng(0.32 * sd, -0.18, -1.07, 0.14);
      K.windows(0.61, -0.15, -0.1, 1.1, 0.06, sd, true);
    });
    K.greeb(40, 1.0, 0.43, 1.4, -0.1);
    K.lights([[0.75, 0.3, 0.6], [-0.75, 0.3, 0.6]], 0xffa020);
  },
  flagman(K) { // флагман звена: длинный стремительный корпус, крылья-пилоны, командная башня, лётная палуба
    K.loft([[-1.05, 0.3, 0.24], [-0.5, 0.42, 0.3, 0.02], [0.4, 0.36, 0.26, 0.03], [0.95, 0.14, 0.1], [1.25, 0.02, 0.02]], 'wedge');
    K.loft([[-0.75, 0.2, 0.12, 0.3], [0.2, 0.18, 0.1, 0.32], [0.55, 0.03, 0.03, 0.27]], 'wedge', K.D);
    K.loft([[-0.65, 0.1, 0.18, 0.5], [-0.35, 0.09, 0.16, 0.52], [-0.2, 0.03, 0.06, 0.48]], 'blade');
    K.canopy(0, 0.58, -0.36, 0.06, 0.03, 0.06);
    K.mirror(sd => {
      K.wing(0.3, -0.02, -0.5, 0.65, 0.7, 0.55, 0.05, sd, -0.1);
      K.loft([[-0.9, 0.08, 0.1, -0.12, 0.85 * sd], [-0.2, 0.09, 0.1, -0.12, 0.85 * sd], [0.1, 0.03, 0.04, -0.12, 0.82 * sd]], 'hex');
      K.eng(0.85 * sd, -0.12, -0.97, 0.08);
      for (let i = 0; i < 4; i++) K.trim(0.01, 0.05, 0.12, 0.36 * sd, -0.05, 0.4 - i * 0.24, 0x80d0ff, 2.2);
      K.turret(0.2 * sd, 0.36, 0.3, 0.08); K.eng(0.18 * sd, 0, -1.1, 0.12);
    });
    K.eng(0, 0.05, -1.12, 0.15);
    K.windows(0.38, 0.05, -0.1, 1.0, 0.04, 1, true); K.windows(0.38, 0.05, -0.1, 1.0, 0.04, -1, true);
    K.lights([[1.0, -0.05, -0.6], [-1.0, -0.05, -0.6], [0, 0.66, -0.4]], 0x80d0ff);
  },

  // ===================== Консорциум: «соборные» корпуса слоновой кости с золотом =====================
  merkuriy(K) { // курьер: высокая узкая игла, золотой гребень, две гондолы
    K.loft([[-1.0, 0.16, 0.2], [-0.5, 0.2, 0.26, 0.02], [0.3, 0.16, 0.22, 0.02], [0.9, 0.05, 0.08], [1.2, 0.005, 0.01]], 'cath');
    K.box(0.02, 0.05, 1.5, 0, 0.27, -0.05, K.G);
    K.mirror(sd => {
      K.loft([[-0.95, 0.06, 0.07, -0.08, 0.3 * sd], [-0.2, 0.07, 0.08, -0.08, 0.32 * sd], [0.25, 0.02, 0.03, -0.08, 0.3 * sd]], 'round', K.M, true);
      K.rod([0.12 * sd, -0.05, -0.3], [0.3 * sd, -0.08, -0.3], 0.015, K.G);
      K.eng(0.3 * sd, -0.08, -1.0, 0.07);
      K.wing(0.12, 0.05, -0.35, 0.35, 0.4, 0.3, 0.02, sd, 0.5, K.G);
    });
    K.canopy(0, 0.2, 0.35, 0.06, 0.06, 0.18);
    K.eng(0, 0, -1.05, 0.1);
    K.lights([[0.38, -0.08, -0.6], [-0.38, -0.08, -0.6]], 0xffe0a0);
  },
  prorab(K) { // промышленный эсминец: соборный корпус, золотые захваты спереди, боковые рудные капсулы
    K.loft([[-1.0, 0.26, 0.26], [-0.4, 0.34, 0.34, 0.03], [0.4, 0.3, 0.3, 0.03], [0.75, 0.18, 0.2]], 'cath');
    K.mirror(sd => {
      armSegment(K.g, [K.s(0.2 * sd), 0, K.s(0.6)], [K.s(0.42 * sd), K.s(0.1), K.s(0.95)], K.s(0.04), K.G);
      armSegment(K.g, [K.s(0.42 * sd), K.s(0.1), K.s(0.95)], [K.s(0.22 * sd), K.s(0.0), K.s(1.25)], K.s(0.03), K.G);
      K.trim(0.05, 0.05, 0.05, 0.22 * sd, 0, 1.27, 0x80ff90, 3);
      K.loft([[-0.8, 0.1, 0.12, -0.05, 0.4 * sd], [0.1, 0.12, 0.14, -0.05, 0.42 * sd], [0.35, 0.05, 0.06, -0.05, 0.38 * sd]], 'round', K.M, true);
      K.eng(0.4 * sd, -0.05, -0.9, 0.08);
    });
    K.box(0.03, 0.06, 1.2, 0, 0.34, -0.1, K.G);
    K.box(0.16, 0.14, 0.18, 0, 0.36, -0.45); K.canopy(0, 0.41, -0.37, 0.08, 0.04, 0.06);
    K.eng(0, 0, -1.05, 0.12);
    K.lights([[0.5, 0, 0.2], [-0.5, 0, 0.2]], 0xffe0a0);
  },
  argus(K) { // крейсер охраны конвоев: высокий корпус, контрфорсы по бортам и купол-излучатель в золотом кольце
    K.loft([[-1.0, 0.28, 0.3], [-0.4, 0.38, 0.4, 0.03], [0.4, 0.34, 0.36, 0.03], [0.9, 0.12, 0.14], [1.15, 0.01, 0.02]], 'cath');
    add2(K, new THREE.SphereGeometry(K.s(0.22), 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), glowMat(0xa8dcff, 1.2), 0, 0.36, -0.1);
    const halo = add2(K, new THREE.TorusGeometry(K.s(0.3), K.s(0.02), 8, 48), K.G, 0, 0.4, -0.1); halo.rotation.x = Math.PI / 2; halo.userData.spin = ['z', 0.4];
    K.mirror(sd => {
      for (let i = 0; i < 3; i++) { const z = 0.45 - i * 0.45; K.loft([[z - 0.12, 0.02, 0.2, 0.05, 0.36 * sd], [z + 0.12, 0.02, 0.14, 0.05, 0.4 * sd]], 'blade', K.G); }
      K.turret(0.24 * sd, 0.24, 0.5, 0.07); K.turret(0.24 * sd, 0.24, -0.55, 0.07);
      K.eng(0.18 * sd, 0, -1.05, 0.1);
      K.windows(0.34, -0.05, 0, 0.9, 0.04, sd);
    });
    K.eng(0, 0.1, -1.08, 0.11);
    K.lights([[0.45, 0, 0.5], [-0.45, 0, 0.5]], 0xffe0a0);
  },
  senator(K) { // флагман Консорциума: «собор» — центральный неф с шпилями-башнями и два боковых корпуса на контрфорсах
    K.loft([[-1.05, 0.26, 0.3], [-0.6, 0.32, 0.4, 0.04], [0.5, 0.3, 0.38, 0.04], [0.95, 0.12, 0.16], [1.2, 0.01, 0.02]], 'cath');
    K.mirror(sd => {
      K.loft([[-0.9, 0.14, 0.18, -0.08, 0.55 * sd], [0.3, 0.15, 0.2, -0.08, 0.56 * sd], [0.7, 0.06, 0.08, -0.08, 0.52 * sd]], 'cath');
      for (let i = 0; i < 4; i++) K.loft([[0.35 - i * 0.38 - 0.06, 0.2, 0.025, 0.05, 0.36 * sd], [0.35 - i * 0.38 + 0.06, 0.2, 0.02, 0.0, 0.38 * sd]], 'flat', K.G); // контрфорсы
      for (let i = 0; i < 4; i++) K.turret(0.55 * sd, 0.1, 0.45 - i * 0.32, 0.07);
      K.windows(0.69, -0.08, -0.1, 1.0, 0.05, sd, true);
      K.eng(0.55 * sd, -0.08, -1.0, 0.1); K.eng(0.16 * sd, 0, -1.1, 0.12);
    });
    for (const [z, h] of [[-0.55, 0.42], [-0.25, 0.32], [0.05, 0.25]]) { // шпили-башни
      K.loft([[z - 0.08, 0.08, 0.02, 0.36], [z, 0.07, h, 0.36 + h / 2], [z + 0.08, 0.06, 0.02, 0.36]], 'blade');
      add2(K, new THREE.ConeGeometry(K.s(0.025), K.s(0.2), 8), K.G, 0, 0.36 + h + 0.08, z);
    }
    K.box(0.03, 0.05, 1.9, 0, 0.42, 0, K.G);
    K.canopy(0, 0.48, -0.75, 0.06, 0.03, 0.06);
    K.lights([[0.7, 0, 0.6], [-0.7, 0, 0.6], [0, 1.0, -0.55]], 0xffe0a0);
  },

  // ===================== Лига: ржавый индустриальный стиль — фермы, асимметрия, лопасти =====================
  brodyaga(K) { // колониальный фрегат: смещённый корпус, контейнер на брюхе, ферма и высокий хвостовой киль
    const R2 = pbrMat(0x7a4a2c, 'liga');
    K.loft([[-0.95, 0.18, 0.18, 0, 0.06], [-0.3, 0.24, 0.22, 0.02, 0.06], [0.4, 0.2, 0.18, 0.02, 0.04], [0.8, 0.08, 0.08, 0, 0.02]], 'hex');
    K.box(0.28, 0.2, 0.5, -0.12, -0.22, -0.1, R2);
    K.truss([-0.3, 0.05, 0.4], [-0.3, 0.05, -0.6], 0.01, K.D, 5, 0.05);
    K.box(0.12, 0.12, 0.2, -0.3, 0.05, 0.5, R2);
    K.loft([[-0.95, 0.02, 0.02, 0.15], [-0.65, 0.025, 0.5, 0.45], [-0.45, 0.02, 0.02, 0.2]], 'blade', R2);
    K.wing(0.2, -0.05, -0.4, 0.35, 0.3, 0.1, 0.03, 1, 0.2); K.wing(0.1, -0.05, -0.2, 0.3, 0.25, 0.15, 0.03, -1, -0.3, R2);
    K.canopy(0.06, 0.18, 0.3, 0.08, 0.05, 0.14);
    K.eng(0.06, 0, -1.0, 0.12); K.eng(-0.3, 0.05, -0.68, 0.07);
    K.trim(0.2, 0.02, 0.02, -0.12, -0.11, 0.15, 0xffa020, 1.6);
    K.lights([[0.45, 0, -0.4], [-0.38, 0.05, 0.55]], 0xffa020);
  },
  pastuh(K) { // дроновый эсминец: открытая рама-ангар на ферме, стойки с дронами, рубка сбоку
    const R2 = pbrMat(0x7a4a2c, 'liga');
    K.box(0.1, 0.1, 1.9, 0, 0, -0.05, K.D);
    K.mirror(sd => { K.truss([0.32 * sd, 0, 0.7], [0.32 * sd, 0, -0.75], 0.012, K.D, 7, 0.12); });
    for (const z of [0.6, 0.0, -0.6]) { K.box(0.75, 0.04, 0.05, 0, 0.12, z, K.D); K.box(0.75, 0.04, 0.05, 0, -0.12, z, K.D); }
    for (let i = 0; i < 6; i++) K.mirror(sd => K.trim(0.1, 0.05, 0.12, 0.18 * sd, (i % 2 ? 0.06 : -0.06), 0.45 - Math.floor(i / 2) * 0.4, 0xffb060, 1.4)); // дроны в стойках
    K.loft([[0.65, 0.2, 0.18, 0.05, 0.42], [0.95, 0.16, 0.16, 0.05, 0.44], [1.15, 0.05, 0.06, 0.03, 0.4]], 'hex', R2);
    K.canopy(0.42, 0.18, 0.95, 0.08, 0.05, 0.1);
    K.box(0.36, 0.3, 0.3, 0, 0, -0.95, R2);
    K.loft([[-1.0, 0.02, 0.02, 0.2], [-0.8, 0.02, 0.4, 0.45], [-0.6, 0.02, 0.02, 0.2]], 'blade', R2);
    K.mirror(sd => K.eng(0.12 * sd, 0, -1.15, 0.1));
    K.lights([[0.4, 0.15, 0.7], [-0.4, 0.15, 0.7]], 0xffa020);
  },
  kovcheg(K) { // колониальный транспорт: хребет-ферма, жилое кольцо, связки модулей разного цвета, солнечные паруса
    const cols = [0x8a5a2a, 0x4a6a7a, 0x8a7a40, 0x7a4a2c].map(c => pbrMat(c, 'liga'));
    K.box(0.12, 0.12, 2.0, 0, 0, 0, K.D);
    K.truss([0, 0.14, 0.9], [0, 0.14, -0.9], 0.01, K.D, 8, 0.04);
    K.loft([[0.85, 0.24, 0.2], [1.05, 0.22, 0.18, 0.02], [1.2, 0.08, 0.08]], 'hex', cols[0]);
    K.canopy(0, 0.1, 1.08, 0.12, 0.05, 0.08);
    const r = seeded(17);
    for (let i = 0; i < 9; i++) { const a = r() * Math.PI * 2, z = 0.35 - i * 0.12; const c = add2(K, rbox(K.s(0.2 + r() * 0.1), K.s(0.18), K.s(0.12)), cols[i % 4], Math.cos(a) * 0.22, Math.sin(a) * 0.22, z); c.rotation.z = a; }
    const hab = new THREE.Group(); hab.position.z = K.s(0.65); hab.userData.spin = ['z', 0.25];
    hab.add(new THREE.Mesh(new THREE.TorusGeometry(K.s(0.55), K.s(0.07), 14, 72), K.M));
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; hab.add(rod([Math.cos(a) * K.s(0.08), Math.sin(a) * K.s(0.08), 0], [Math.cos(a) * K.s(0.5), Math.sin(a) * K.s(0.5), 0], K.s(0.02), K.D)); }
    K.g.add(hab);
    const solar = cachedMat('solarDS', () => new THREE.MeshStandardMaterial({ map: sharedTextures().solar, metalness: 0.35, roughness: 0.4, side: THREE.DoubleSide }));
    K.mirror(sd => { K.rod([0.1 * sd, 0, -0.5], [0.75 * sd, 0, -0.5], 0.015); add2(K, new THREE.PlaneGeometry(K.s(0.5), K.s(0.32)), solar, 0.95 * sd, 0, -0.5).rotation.x = -Math.PI / 2; });
    K.loft([[-1.1, 0.3, 0.3], [-0.85, 0.34, 0.34], [-0.7, 0.2, 0.2]], 'hex', cols[3]);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; K.eng(Math.cos(a) * 0.18, Math.sin(a) * 0.18, -1.17, 0.07); }
    K.turret(0, 0.2, 1.0, 0.07); K.turret(0, 0.36, -0.9, 0.07);
    K.lights([[0.62, 0, 0.65], [-0.62, 0, 0.65]], 0xffa020);
  },
  taran(K) { // штурмовой крейсер: тяжёлый клин с тараном, наслоенная асимметричная броня и лопасти
    const R2 = pbrMat(0x7a4a2c, 'liga');
    K.loft([[-1.0, 0.32, 0.26], [-0.4, 0.42, 0.3, 0.02], [0.4, 0.36, 0.26, 0.02], [0.8, 0.2, 0.16], [1.0, 0.1, 0.08]], 'hex');
    K.loft([[0.9, 0.16, 0.12], [1.15, 0.08, 0.06], [1.45, 0.01, 0.01]], 'diamond', K.D);
    const r = seeded(31);
    K.mirror(sd => {
      for (let k = 0; k < 4; k++) K.box(0.07, 0.28 + r() * 0.08, 0.36, (0.42 + k * 0.02) * sd, (r() - 0.5) * 0.06, 0.45 - k * 0.4, k % 2 ? R2 : K.M);
      gatling(K.g, K.s(0.25 * sd), K.s(0.3), K.s(0.35), K.s(0.1), K.M, K.D);
      K.eng(0.3 * sd, 0, -1.06, 0.13);
    });
    K.loft([[-0.9, 0.02, 0.02, 0.25], [-0.55, 0.02, 0.55, 0.55], [-0.3, 0.02, 0.02, 0.25]], 'blade', R2);
    K.loft([[-0.6, 0.02, 0.02, 0.25, 0.15], [-0.35, 0.02, 0.35, 0.45, 0.15], [-0.15, 0.02, 0.02, 0.25, 0.15]], 'blade', K.M);
    K.box(0.4, 0.14, 0.5, -0.06, 0.28, -0.3, R2); K.canopy(-0.06, 0.35, -0.05, 0.1, 0.04, 0.06);
    for (let i = 0; i < 5; i++) K.trim(0.07, 0.02, 0.1, -0.24 + i * 0.09, 0.355, -0.5, 0xd8b020, 1.3);
    K.eng(0, 0.06, -1.1, 0.15);
    K.lights([[0.5, 0, 0.4], [-0.5, 0, 0.4]], 0xff7020);
  },

  // ===================== Орден Предела: гладкие органические корпуса и кристаллы =====================
  iskatel(K) { // исследовательский фрегат: капля, лепестки-крылья, кольцо-резонатор
    { const H = [[-1.0, 0.1, 0.1], [-0.6, 0.24, 0.2], [0.0, 0.27, 0.22, 0.02], [0.6, 0.16, 0.13], [1.15, 0.01, 0.01]]; K.seam(H, 'top'); K.seam(H, 'side'); }
    K.loft([[-1.0, 0.1, 0.1], [-0.6, 0.24, 0.2], [0.0, 0.27, 0.22, 0.02], [0.6, 0.16, 0.13], [1.15, 0.01, 0.01]], 'round', K.M, true);
    K.mirror(sd => { K.loft([[-0.75, 0.02, 0.02, 0.05, 0.12 * sd], [-0.35, 0.06, 0.03, 0.06, 0.45 * sd], [0.05, 0.02, 0.015, 0.03, 0.28 * sd]], 'round', K.M, true); });
    K.loft([[-0.7, 0.015, 0.02, 0.12], [-0.4, 0.03, 0.3, 0.32], [-0.1, 0.015, 0.02, 0.15]], 'round', K.M, true);
    const halo = add2(K, new THREE.TorusGeometry(K.s(0.42), K.s(0.018), 10, 80), K.C, 0, 0, -0.15); halo.userData.spin = ['z', 0.6];
    const tip = add2(K, new THREE.OctahedronGeometry(K.s(0.05)), K.C, 0, 0, 1.25); tip.scale.set(0.7, 0.7, 1.8); tip.userData.spin = ['z', 1.5];
    K.canopy(0, 0.13, 0.35, 0.08, 0.05, 0.18);
    K.eng(0, 0, -1.02, 0.11);
    K.lights([[0, 0.45, -0.15]], 0xc090ff);
  },
  prizma(K) { // лучевой фрегат: два изогнутых «рога» и парящий между ними кристалл-фокусатор
    K.mirror(sd => K.seam([[-0.6, 0.08, 0.08, 0, 0.18 * sd], [-0.1, 0.1, 0.09, 0, 0.3 * sd], [0.5, 0.07, 0.07, 0, 0.3 * sd], [0.95, 0.02, 0.02, 0, 0.2 * sd]], 'top'));
    K.loft([[-1.0, 0.14, 0.1], [-0.5, 0.26, 0.15], [-0.1, 0.22, 0.12], [0.1, 0.08, 0.06]], 'round', K.M, true);
    K.mirror(sd => K.loft([[-0.6, 0.08, 0.08, 0, 0.18 * sd], [-0.1, 0.1, 0.09, 0, 0.3 * sd], [0.5, 0.07, 0.07, 0, 0.3 * sd], [0.95, 0.02, 0.02, 0, 0.2 * sd]], 'round', K.M, true));
    const pr = add2(K, new THREE.OctahedronGeometry(K.s(0.14)), K.C, 0, 0, 0.45); pr.scale.set(0.6, 0.6, 2.2); pr.userData.spin = ['z', 0.9];
    add2(K, new THREE.TorusGeometry(K.s(0.18), K.s(0.01), 8, 48), glowMat(0xa070ff, 2), 0, 0, 0.45);
    K.mirror(sd => { add2(K, new THREE.SphereGeometry(K.s(0.03), 12, 8), glowMat(0xc090ff, 3), 0.21 * sd, 0, 0.93); K.eng(0.28 * sd, 0, -0.65, 0.07); });
    K.canopy(0, 0.1, -0.35, 0.07, 0.04, 0.14);
    K.eng(0, 0, -1.02, 0.09);
  },
  orakul(K) { // крейсер поддержки: «семя» с тремя дугами-антеннами и светящимися узлами
    { const H = [[-0.8, 0.12, 0.12], [-0.45, 0.36, 0.32], [0.1, 0.42, 0.36, 0.02], [0.55, 0.26, 0.22], [0.85, 0.04, 0.04]]; K.seam(H, 'top'); K.seam(H, 'side'); K.seam(H, 'bottom'); }
    K.loft([[-0.8, 0.12, 0.12], [-0.45, 0.36, 0.32], [0.1, 0.42, 0.36, 0.02], [0.55, 0.26, 0.22], [0.85, 0.04, 0.04]], 'round', K.M, true);
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Group(); w.rotation.z = i * Math.PI * 2 / 3;
      const arc = new THREE.Mesh(new THREE.TorusGeometry(K.s(0.72), K.s(0.03), 10, 64, Math.PI * 0.9), K.M); arc.rotation.set(0, Math.PI / 2, Math.PI * 0.05); w.add(arc);
      const node = new THREE.Mesh(new THREE.OctahedronGeometry(K.s(0.06)), K.C); node.position.set(0, K.s(0.72), 0); w.add(node);
      K.g.add(w);
    }
    const top = add2(K, new THREE.OctahedronGeometry(K.s(0.12)), K.C, 0, 0.45, 0); top.scale.set(0.6, 1.7, 0.6); top.userData.spin = ['y', 0.7];
    add2(K, new THREE.SphereGeometry(K.s(0.07), 20, 12), glowMat(0xc090ff, 2.6), 0, 0, 0.84);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; K.loft([[-0.85, 0.03, 0.03, Math.sin(a) * 0.2, Math.cos(a) * 0.22], [-0.6, 0.07, 0.07, Math.sin(a) * 0.24, Math.cos(a) * 0.27], [-0.35, 0.03, 0.03, Math.sin(a) * 0.2, Math.cos(a) * 0.22]], 'round', K.M, true); }
    K.mirror(sd => K.eng(0.12 * sd, 0, -0.85, 0.09));
    K.lights([[0.4, 0, 0, 0.02], [-0.4, 0, 0, 0.02]], 0xc090ff);
  },
  relikvariy(K) { // линкор Предтеч: длинный гладкий корпус, кристаллический гребень, два кольца-резонатора
    { const H = [[-1.05, 0.18, 0.14], [-0.6, 0.36, 0.24, 0.02], [0.1, 0.4, 0.26, 0.02], [0.6, 0.28, 0.18], [1.2, 0.02, 0.02]]; K.seam(H, 'side'); K.seam(H, 'bottom'); }
    K.loft([[-1.05, 0.18, 0.14], [-0.6, 0.36, 0.24, 0.02], [0.1, 0.4, 0.26, 0.02], [0.6, 0.28, 0.18], [1.2, 0.02, 0.02]], 'round', K.M, true);
    K.loft([[-0.8, 0.12, 0.08, -0.18], [-0.2, 0.22, 0.12, -0.2], [0.4, 0.1, 0.06, -0.16]], 'round', K.M, true);
    for (let i = 0; i < 7; i++) { const k = 1 - Math.abs(i - 2.5) / 4.5; const c = add2(K, new THREE.OctahedronGeometry(K.s(0.08 * (0.6 + k))), K.C, 0, 0.24 + 0.06 * k, 0.55 - i * 0.18); c.scale.set(0.45, 1.9, 0.9); }
    for (const [z, sp] of [[-0.55, 0.35], [-0.78, -0.5]]) { const h = add2(K, new THREE.TorusGeometry(K.s(0.46), K.s(0.022), 10, 96), K.C, 0, 0, z); h.userData.spin = ['z', sp]; }
    K.mirror(sd => {
      K.loft([[-0.75, 0.04, 0.05, -0.04, 0.3 * sd], [-0.2, 0.12, 0.08, -0.04, 0.5 * sd], [0.35, 0.05, 0.04, -0.04, 0.38 * sd]], 'round', K.M, true);
      for (let i = 0; i < 6; i++) K.trim(0.012, 0.03, 0.06, 0.4 * sd, 0.03, 0.45 - i * 0.1, 0xb070ff, 2.4);
      K.eng(0.45 * sd, -0.04, -0.75, 0.08);
    });
    for (const x of [-0.13, 0, 0.13]) K.eng(x, 0, -1.08, 0.09);
    K.lights([[0.55, -0.04, 0.2], [-0.55, -0.04, 0.2]], 0xc090ff);
  }
};
// вспомогательная: добавить готовую геометрию в долях R
function add2(K, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) { const m = new THREE.Mesh(geo, mat); m.position.set(K.s(x), K.s(y), K.s(z)); m.scale.set(sx, sy, sz); K.g.add(m); return m; }

function buildShip(type, color, faction) {
  const g = new THREE.Group();
  const DF = DESIGN_FAC[type], own = DF && faction !== 'pirate' && faction !== 'guard'; // фракционный корабль в своей окраске
  const LK = LOOK || {}, custom = LK.accent != null || LK.second != null;
  const M = own ? pbrMat(color, DF, {}, LK.accent, LK.second) : custom ? pbrMat(color, faction, {}, LK.accent, LK.second) : hullMat(color, faction), D = darkMetal();
  const eng = LK.engine != null ? LK.engine : own ? FAC_ENGINE[DF] : faction === 'pirate' ? 0xff3a1a : faction === 'guard' ? 0x9fd0ff : 0x40b8ff;
  const R = SHIP_BASE_R[type] || 50;
  const add = (geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); return m; };
  if (DESIGN[type]) DESIGN[type](shipKit(g, R, M, D, eng, faction, add));
  else switch (type) {
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
    case 'gadyuka': {
      // ракетный фрегат: стреловидный корпус, две ракетные кассеты по бортам, длинный нос с сенсором
      fighterBase(g, R, M, D, eng, { guns: 0, long: 1.15 });
      const pod = pbrMat(0x343a30, 'dark');
      for (const sd of [1, -1]) {
        add(rbox(R * 0.22, R * 0.16, R * 0.75), pod, sd * R * 0.48, R * 0.04, -R * 0.1);
        for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) add(new THREE.CylinderGeometry(R * 0.035, R * 0.035, R * 0.02, 8), glowMat(0xffa040, 1.6), sd * R * (0.42 + c * 0.06), R * (0.0 + r * 0.07), R * 0.28).rotation.x = Math.PI / 2;
      }
      add(new THREE.SphereGeometry(R * 0.06, 12, 8), glowMat(0x80ff80, 3), 0, R * 0.05, R * 1.7);
      break;
    }
    case 'burya': {
      // ракетный крейсер: массивный клиновидный корпус, вертикальные пусковые шахты на хребте, рубка
      add(lathe(R * 2.1, R * 0.42, [[0, 0.7], [0.15, 1], [0.6, 0.95], [0.85, 0.6], [1, 0.1]], 8), M, 0, 0, 0, 1.5, 0.6, 1);
      add(rbox(R * 0.7, R * 0.28, R * 1.1), M, 0, R * 0.22, -R * 0.15);
      for (let i = 0; i < 6; i++) for (const sd of [1, -1]) {
        add(rbox(R * 0.14, R * 0.08, R * 0.14), D, sd * R * 0.2, R * 0.4, R * (0.25 - i * 0.15));
        add(new THREE.CircleGeometry(R * 0.04, 10), glowMat(0xff7030, 1.8), sd * R * 0.2, R * 0.441, R * (0.25 - i * 0.15)).rotation.x = -Math.PI / 2;
      }
      add(rbox(R * 0.3, R * 0.25, R * 0.3), M, 0, R * 0.48, -R * 0.65);
      add(rbox(R * 0.32, R * 0.03, R * 0.1), glowMat(0xffd9a0, 1.4), 0, R * 0.5, -R * 0.5);
      for (const sd of [1, -1]) { add(lathe(R * 1.0, R * 0.17, [[0, 0.7], [0.15, 1], [0.8, 1], [1, 0.4]], 14), M, sd * R * 0.62, -R * 0.05, -R * 0.45); addEngine(g, sd * R * 0.62, -R * 0.05, -R * 0.97, R * 0.14, eng); }
      addEngine(g, 0, R * 0.05, -R * 1.05, R * 0.18, eng);
      greebles(g, R, 40, D, [R * 0.9, R * 0.2, R * 1.4]);
      addLights(g, [[R * 0.85, 0, -R * 0.2, R * 0.025], [-R * 0.85, 0, -R * 0.2, R * 0.025]], 0xff3020);
      break;
    }
    case 'bastion': {
      // линкор обороны: широкий бронированный корпус, щитовые пластины-«крылья», купола ПРО, ангар турелей
      add(rbox(R * 0.9, R * 0.4, R * 1.9), M, 0, 0, 0);
      add(rbox(R * 0.7, R * 0.32, R * 0.5), M, 0, -R * 0.03, R * 1.1).rotation.x = -0.12;
      for (const sd of [1, -1]) {
        const plate = add(rbox(R * 0.06, R * 0.42, R * 1.2), pbrMat(0x5a6068, 'dark'), sd * R * 0.56, R * 0.02, R * 0.1); plate.rotation.z = sd * 0.45;
        for (const z of [0.6, 0, -0.6]) { add(new THREE.SphereGeometry(R * 0.11, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glassMat(), sd * R * 0.3, R * 0.2, R * z); }
      }
      add(rbox(R * 0.5, R * 0.2, R * 0.8), M, 0, R * 0.3, -R * 0.2);
      add(rbox(R * 0.4, R * 0.12, R * 0.05), glowMat(0x60d0ff, 1.6), 0, -R * 0.15, R * 0.96);
      for (let i = 0; i < 3; i++) for (const sd of [1, -1]) addTurret(g, sd * R * 0.22, R * 0.2, R * (0.7 - i * 0.45), R * 0.13, D);
      add(rbox(R * 1.0, R * 0.55, R * 0.3), M, 0, 0, -R * 1.05);
      for (const [x, y] of [[0.3, 0.12], [-0.3, 0.12], [0.3, -0.12], [-0.3, -0.12], [0, 0]]) addEngine(g, R * x, R * y, -R * 1.22, R * 0.11, eng);
      greebles(g, R, 70, D, [R * 0.8, R * 0.22, R * 1.7]);
      addLights(g, [[R * 0.7, R * 0.4, R * 0.7, R * 0.015], [-R * 0.7, R * 0.4, R * 0.7, R * 0.015], [0, R * 0.45, -R * 0.2, R * 0.015]], 0x60c0ff);
      break;
    }
    case 'matka': {
      // авианосец: длинная плоская палуба, ангарные проёмы с тёплым светом, островная надстройка
      add(rbox(R * 0.75, R * 0.22, R * 2.1), M, 0, 0, 0);
      add(rbox(R * 0.5, R * 0.3, R * 1.6), M, 0, -R * 0.22, -R * 0.1);
      const bay = glowMat(0xffb070, 1.3);
      for (const sd of [1, -1]) for (let i = 0; i < 5; i++) add(new THREE.PlaneGeometry(R * 0.26, R * 0.14), bay, sd * R * 0.376, -R * 0.02, R * (0.7 - i * 0.35)).rotation.y = sd * Math.PI / 2;
      add(rbox(R * 0.18, R * 0.4, R * 0.45), M, R * 0.25, R * 0.3, -R * 0.35);
      add(rbox(R * 0.2, R * 0.05, R * 0.3), glowMat(0xffd9a0, 1.4), R * 0.25, R * 0.42, -R * 0.3);
      for (let i = 0; i < 9; i++) add(rbox(R * 0.02, R * 0.005, R * 0.1), glowMat(0x60ff90, 2), 0, R * 0.115, R * (0.9 - i * 0.2));
      add(rbox(R * 0.85, R * 0.45, R * 0.3), M, 0, -R * 0.05, -R * 1.15);
      for (const [x, y] of [[0.28, 0.1], [-0.28, 0.1], [0.28, -0.16], [-0.28, -0.16]]) addEngine(g, R * x, R * y, -R * 1.32, R * 0.11, eng);
      greebles(g, R, 60, D, [R * 0.7, R * 0.14, R * 1.9]);
      addLights(g, [[R * 0.4, R * 0.12, R * 1.0, R * 0.015], [-R * 0.4, R * 0.12, R * 1.0, R * 0.015]], 0xff3020);
      break;
    }
    case 'flagman': {
      // флагман звена: стреловидный корпус-клин, две бортовые лётные палубы с посадочными огнями,
      // высокая командная башня с мостиком, ремонтный док под килем
      add(lathe(R * 2.4, R * 0.42, [[0, 0.3], [0.12, 0.75], [0.4, 1], [0.75, 0.95], [0.92, 0.7], [1, 0.25]], 8), M, 0, 0, 0, 1.15, 0.55, 1);
      for (const sd of [1, -1]) {
        const deck = add(rbox(R * 0.34, R * 0.1, R * 1.75), M, sd * R * 0.62, -R * 0.04, -R * 0.1);
        deck.rotation.y = -sd * 0.06;
        add(rbox(R * 0.3, R * 0.02, R * 1.6), D, sd * R * 0.62, R * 0.02, -R * 0.1);
        for (let i = 0; i < 8; i++) add(rbox(R * 0.03, R * 0.01, R * 0.06), glowMat(0x60ff90, 2.2), sd * R * 0.62, R * 0.035, R * (0.65 - i * 0.2));
        add(new THREE.PlaneGeometry(R * 0.26, R * 0.09), glowMat(0xffb070, 1.4), sd * R * 0.62, -R * 0.04, R * 0.78);
        add(rbox(R * 0.06, R * 0.22, R * 0.9), D, sd * R * 0.42, R * 0.02, -R * 0.3);
      }
      add(rbox(R * 0.22, R * 0.55, R * 0.42), M, 0, R * 0.38, -R * 0.42);
      add(rbox(R * 0.34, R * 0.12, R * 0.22), M, 0, R * 0.68, -R * 0.36);
      add(rbox(R * 0.32, R * 0.035, R * 0.05), glowMat(0x9fd8ff, 2), 0, R * 0.7, -R * 0.24);
      add(new THREE.CylinderGeometry(R * 0.012, R * 0.012, R * 0.4, 6), D, R * 0.08, R * 0.92, -R * 0.42);
      add(new THREE.CylinderGeometry(R * 0.008, R * 0.008, R * 0.28, 6), D, -R * 0.06, R * 0.86, -R * 0.46);
      add(rbox(R * 0.4, R * 0.16, R * 0.7), D, 0, -R * 0.3, -R * 0.2);
      add(new THREE.TorusGeometry(R * 0.16, R * 0.02, 8, 32), glowMat(0x70ffc0, 1.8), 0, -R * 0.39, -R * 0.2).rotation.x = Math.PI / 2;
      for (const [x, z] of [[0.24, 0.55], [-0.24, 0.55], [0.18, 0.15], [-0.18, 0.15]]) addTurret(g, R * x, R * 0.2, R * z, R * 0.05, D);
      add(rbox(R * 0.95, R * 0.4, R * 0.28), M, 0, 0, -R * 1.18);
      for (const [x, y] of [[0.3, 0.08], [-0.3, 0.08], [0.3, -0.12], [-0.3, -0.12], [0, -0.02]]) addEngine(g, R * x, R * y, -R * 1.34, R * 0.11, eng);
      greebles(g, R, 70, D, [R * 0.8, R * 0.16, R * 1.9]);
      addLights(g, [[R * 0.8, -R * 0.04, R * 0.8, R * 0.016], [-R * 0.8, -R * 0.04, R * 0.8, R * 0.016], [0, R * 1.12, -R * 0.42, R * 0.02]], 0xff3020);
      break;
    }
    case 'fortress': {
      // пиратская крепость: шипастое тёмное кольцо, центральная башня с красным оком, орудийные башни
      const PM = pbrMat(0x3a2a28, 'pirate');
      add(new THREE.TorusGeometry(R * 0.7, R * 0.09, 12, 64), PM, 0, 0, 0).rotation.x = Math.PI / 2;
      add(lathe(R * 1.4, R * 0.25, [[0, 0.3], [0.2, 1], [0.6, 0.8], [0.9, 0.4], [1, 0.1]], 8), PM, 0, 0, 0).rotation.x = -Math.PI / 2;
      add(new THREE.SphereGeometry(R * 0.08, 16, 12), glowMat(0xff2010, 4), 0, R * 0.42, 0);
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        const sp = add(new THREE.ConeGeometry(R * 0.03, R * 0.35, 6), D, Math.cos(a) * R * 0.78, 0, Math.sin(a) * R * 0.78);
        sp.rotation.z = -Math.PI / 2; sp.rotation.y = -a;
        if (i % 2 === 0) addTurret(g, Math.cos(a) * R * 0.7, R * 0.09, Math.sin(a) * R * 0.7, R * 0.05, D);
      }
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; add(new THREE.CylinderGeometry(R * 0.012, R * 0.012, R * 0.7, 6), D, Math.cos(a) * R * 0.35, 0, Math.sin(a) * R * 0.35).rotation.z = Math.PI / 2; }
      addLights(g, Array.from({ length: 16 }, (_, i) => [Math.cos(i / 16 * Math.PI * 2) * R * 0.82, 0, Math.sin(i / 16 * Math.PI * 2) * R * 0.82, R * 0.012]), 0xff2a10);
      break;
    }
    case 'begemot': {
      // SC-02 «Бегемот»: длинный индустриальный корпус, два спиральных бура на носу,
      // литейный цех с трубами и дымом в середине, кормовой блок с восемью двигателями
      const soot = pbrMat(0x2c2e31, 'dark'), rust = pbrMat(0x5a3a22, 'dark');
      // нижний хребет и носовая секция
      add(rbox(R * 0.62, R * 0.36, R * 1.5), M, 0, -R * 0.05, R * 0.25);
      add(rbox(R * 0.5, R * 0.3, R * 0.5), M, 0, R * 0.12, R * 0.62).rotation.x = 0.12;
      add(rbox(R * 0.2, R * 0.12, R * 0.22), M, 0, R * 0.3, R * 0.55);
      const win = new THREE.Mesh(rbox(R * 0.22, R * 0.03, R * 0.16), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: sharedTextures().windowsDense, emissiveIntensity: 1.4 }));
      win.position.set(0, R * 0.36, R * 0.55); g.add(win);
      // полосы-предупреждения на носу
      const warn = glowMat(0xc06a20, 0.9);
      for (const sd of [1, -1]) add(rbox(R * 0.005, R * 0.08, R * 0.16), warn, sd * R * 0.315, R * 0.0, R * 0.62);
      // два гигантских спиральных бура
      const drillProf = [];
      for (let i = 0; i <= 24; i++) { const t = i / 24; drillProf.push([t, (1 - t * 0.92) * (i % 2 ? 0.86 : 1)]); }
      drillProf.push([1.02, 0.01]);
      for (const sd of [1, -1]) {
        add(new THREE.CylinderGeometry(R * 0.19, R * 0.21, R * 0.25, 20), soot, sd * R * 0.2, -R * 0.12, R * 1.05).rotation.x = Math.PI / 2;
        const drill = add(lathe(R * 0.9, R * 0.19, drillProf, 14), soot, sd * R * 0.2, -R * 0.12, R * 1.6);
        drill.userData.spin = ['z', 1.5 * sd];
      }
      // литейный цех: блоки, баки, трубопроводы
      const r = seeded(4200);
      for (let i = 0; i < 26; i++) {
        const w = R * (0.08 + r() * 0.16), h = R * (0.08 + r() * 0.22), d = R * (0.08 + r() * 0.2);
        add(rbox(w, h, d), r() < 0.3 ? rust : M, (r() - 0.5) * R * 0.6, R * 0.13 + h / 2, -R * (0.05 + r() * 0.85));
      }
      for (let i = 0; i < 10; i++) {
        const tank = add(new THREE.CylinderGeometry(R * 0.06, R * 0.06, R * 0.22, 14), r() < 0.5 ? rust : soot, (r() < 0.5 ? 1 : -1) * R * 0.34, R * (0.02 + r() * 0.15), -R * (0.1 + r() * 0.8));
        tank.rotation.x = Math.PI / 2;
      }
      for (const sd of [1, -1]) for (const y of [0.1, -0.05, -0.18]) add(new THREE.CylinderGeometry(R * 0.018, R * 0.018, R * 1.9, 8), rust, sd * R * 0.33, R * y, -R * 0.05).rotation.x = Math.PI / 2;
      // дымовые трубы с раскалёнными жерлами и клубами дыма
      const smokeMat = new THREE.MeshBasicMaterial({ color: 0x4a4440, transparent: true, opacity: 0.35, depthWrite: false });
      for (let i = 0; i < 9; i++) {
        const x = (r() - 0.5) * R * 0.45, z = -R * (0.1 + r() * 0.75), h = R * (0.25 + r() * 0.3);
        add(new THREE.CylinderGeometry(R * 0.025, R * 0.03, h, 10), soot, x, R * 0.15 + h / 2, z);
        add(new THREE.CylinderGeometry(R * 0.022, R * 0.022, R * 0.01, 10), glowMat(0xff6a20, 3), x, R * 0.15 + h, z);
        for (let k = 0; k < 3; k++) {
          const puff = add(new THREE.SphereGeometry(R * 0.04, 8, 6), smokeMat, x, R * 0.15 + h, z);
          puff.userData.smoke = { y0: R * 0.15 + h, phase: k / 3 + r() * 0.1, rise: R * 0.35, s: R * 0.04 };
        }
      }
      // кормовой блок и восемь ионных двигателей
      add(rbox(R * 0.8, R * 0.62, R * 0.35), M, 0, R * 0.05, -R * 1.05);
      for (const sd of [1, -1]) {
        add(new THREE.CylinderGeometry(R * 0.16, R * 0.16, R * 0.35, 20), soot, sd * R * 0.46, R * 0.05, -R * 1.0).rotation.x = Math.PI / 2;
        add(new THREE.CircleGeometry(R * 0.05, 16), glowMat(0xff7030, 3), sd * R * 0.62, R * 0.05, -R * 1.0).rotation.y = sd * Math.PI / 2;
      }
      for (const [x, y] of [[0.3, 0.2], [0.1, 0.2], [-0.1, 0.2], [-0.3, 0.2], [0.3, -0.1], [0.1, -0.1], [-0.1, -0.1], [-0.3, -0.1]]) addEngine(g, R * x, R * y, -R * 1.25, R * 0.08, eng);
      // пристыкованные тендеры SC-03 под брюхом
      for (const [x, z] of [[0.18, -0.4], [-0.15, -0.65]]) {
        const t = new THREE.Group();
        t.add(new THREE.Mesh(rbox(R * 0.05, R * 0.03, R * 0.16), M));
        const w = new THREE.Mesh(rbox(R * 0.14, R * 0.008, R * 0.05), D); w.position.z = -R * 0.03; t.add(w);
        t.position.set(R * x, -R * 0.3, R * z); g.add(t);
      }
      greebles(g, R, 60, D, [R * 0.6, R * 0.18, R * 1.8]);
      addLights(g, [[R * 0.32, R * 0.15, R * 0.85, R * 0.012], [-R * 0.32, R * 0.15, R * 0.85, R * 0.012], [R * 0.42, R * 0.38, -R * 1.0, R * 0.012], [-R * 0.42, R * 0.38, -R * 1.0, R * 0.012]], 0xffa030);
      break;
    }
    case 'pbase': {
      // пиратская база: выдолбленный астероид, обвешанный фермами, кольцом с башнями и ангарами; купол щита при обороне
      const PM = pbrMat(0x3a2a28, 'pirate');
      const rock = asteroidModel(R * 0.62, 5, 'pbase_rock'); delete rock.userData.spin; g.add(rock);
      const ring = add(new THREE.TorusGeometry(R * 0.82, R * 0.045, 10, 64), PM); ring.rotation.x = Math.PI / 2 + 0.18;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.3, x = Math.cos(a) * R * 0.82, z = Math.sin(a) * R * 0.82;
        g.add(rod([x * 0.5, 0, z * 0.5], [x, -Math.sin(a) * R * 0.15, z], R * 0.02, D));
      }
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; addTurret(g, Math.cos(a) * R * 0.82, Math.sin(a) * R * 0.82 * Math.sin(-0.18) + R * 0.05, Math.sin(a) * R * 0.82, R * 0.06, D); }
      // ангары с красными воротами
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3 + 0.5, hx = Math.cos(a) * R * 0.5, hz = Math.sin(a) * R * 0.5;
        const hang = add(rbox(R * 0.22, R * 0.16, R * 0.3), PM, hx, R * 0.1, hz); hang.rotation.y = -a + Math.PI / 2;
        const door = add(rbox(R * 0.16, R * 0.1, R * 0.01), glowMat(0xff3010, 2.2), hx + Math.cos(a) * R * 0.15, R * 0.1, hz + Math.sin(a) * R * 0.15); door.rotation.y = -a + Math.PI / 2;
      }
      // шпиль с антеннами
      add(new THREE.CylinderGeometry(R * 0.015, R * 0.03, R * 0.7, 8), D, 0, R * 0.75, 0);
      add(new THREE.ConeGeometry(R * 0.05, R * 0.15, 8), PM, 0, R * 1.15, 0);
      for (const y of [0.85, 0.98]) add(new THREE.TorusGeometry(R * 0.08, R * 0.006, 6, 24), D, 0, R * y, 0).rotation.x = Math.PI / 2;
      add(new THREE.SphereGeometry(R * 0.05, 16, 12), glowMat(0xff2010, 4), 0, R * 0.62, 0);
      addLights(g, [...Array.from({ length: 12 }, (_, i) => [Math.cos(i / 12 * Math.PI * 2) * R * 0.86, 0, Math.sin(i / 12 * Math.PI * 2) * R * 0.86, R * 0.012]), [0, R * 1.24, 0, R * 0.02]], 0xff2a10);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(R * 1.25, 48, 24), fresnelMaterial(0xff5a30, 2.6, 0.6, false));
      dome.userData.dome = true; dome.visible = false; g.add(dome);
      break;
    }
    case 'pdrone': case 'pdrone_h': {
      // пиратские дроны: тёмно-красные, шипастые, с красным «глазом»
      const heavy = type === 'pdrone_h', PM = pbrMat(0x4a2624, 'pirate');
      if (heavy) {
        add(new THREE.CylinderGeometry(R * 0.5, R * 0.6, R * 1.3, 6), PM).rotation.x = Math.PI / 2;
        for (const sx of [-1, 1]) { add(rbox(R * 0.12, R * 0.6, R * 1.0), D, sx * R * 0.6, 0, -R * 0.1); addEngine(g, sx * R * 0.3, 0, -R * 0.75, R * 0.14, eng, 0.7); }
        add(new THREE.CylinderGeometry(R * 0.07, R * 0.1, R * 0.9, 10), D, 0, R * 0.25, R * 0.75).rotation.x = Math.PI / 2;
        add(rbox(R * 0.5, R * 0.07, R * 0.05), glowMat(0xff2010, 4), 0, R * 0.05, R * 0.66);
      } else {
        add(new THREE.SphereGeometry(R * 0.5, 16, 12), PM, 0, 0, 0, 0.9, 0.7, 1.3);
        for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const sp = add(new THREE.ConeGeometry(R * 0.08, R * 0.9, 6), D, Math.cos(a) * R * 0.35, Math.sin(a) * R * 0.35, R * 0.5); sp.rotation.x = Math.PI / 2; }
        add(new THREE.SphereGeometry(R * 0.16, 12, 8), glowMat(0xff2010, 4), 0, 0, R * 0.62);
        addEngine(g, 0, 0, -R * 0.65, R * 0.2, eng, 0.6);
      }
      break;
    }

    // ===== Консорциум Арктура: обтекаемые корпуса слоновой кости, золотая отделка, голубые дюзы =====
    case 'merkuriy': {
      add(lathe(R * 2.3, R * 0.24, [[0, 0.55], [0.08, 0.85], [0.35, 1], [0.7, 0.8], [0.9, 0.4], [1, 0.03]], 24), M, 0, 0, 0, 1, 0.75, 1);
      add(new THREE.SphereGeometry(R * 0.12, 20, 12), glassMat(), 0, R * 0.13, R * 0.55, 0.8, 0.5, 2.2);
      const w = wingGeo(R * 0.72, R * 0.55, R * 0.42, R * 0.03);
      add(w, M, R * 0.15, -R * 0.04, -R * 0.32); add(w, M, -R * 0.15, -R * 0.04, -R * 0.32, -1);
      for (const sd of [1, -1]) {
        add(rbox(R * 0.03, R * 0.32, R * 0.36), M, sd * R * 0.17, R * 0.18, -R * 0.76).rotation.z = -sd * 0.25;
        add(rbox(R * 0.012, R * 0.02, R * 1.15), goldMat(), sd * R * 0.235, R * 0.02, R * 0.05); // золотой молдинг
        add(lathe(R * 0.45, R * 0.06, [[0, 0.7], [0.2, 1], [0.85, 1], [1, 0.5]], 14), D, sd * R * 0.34, -R * 0.03, -R * 0.62);
        addEngine(g, sd * R * 0.34, -R * 0.03, -R * 0.86, R * 0.05, eng, 0.8);
      }
      add(lathe(R * 1.05, R * 0.16, [[0, 0.5], [0.12, 1], [0.88, 1], [1, 0.5]], 20), M, 0, -R * 0.23, -R * 0.1); // грузовая капсула
      addEngine(g, 0, 0, -R * 1.17, R * 0.16, eng);
      addLights(g, [[R * 0.86, -R * 0.04, -R * 0.62, R * 0.022], [-R * 0.86, -R * 0.04, -R * 0.62, R * 0.022]], 0xffd070);
      break;
    }
    case 'prorab': {
      add(lathe(R * 1.7, R * 0.42, [[0, 0.75], [0.1, 0.95], [0.55, 1], [0.8, 0.9], [1, 0.55]], 22), M, 0, 0, -R * 0.1, 1.15, 0.8, 1);
      add(rbox(R * 0.46, R * 0.2, R * 0.42), M, 0, R * 0.38, -R * 0.2);
      add(rbox(R * 0.36, R * 0.05, R * 0.03), glowMat(0xffe0a8, 1.5), 0, R * 0.42, R * 0.015);
      const ring = add(new THREE.TorusGeometry(R * 0.44, R * 0.018, 8, 64), goldMat(), 0, 0, R * 0.3); ring.scale.set(1.15, 0.8, 1);
      for (const sd of [1, -1]) {
        // передние захваты с бурами
        const a = [sd * R * 0.24, -R * 0.02, R * 0.68], b = [sd * R * 0.44, -R * 0.06, R * 1.08], c = [sd * R * 0.24, -R * 0.1, R * 1.36];
        armSegment(g, a, b, R * 0.05, D); armSegment(g, b, c, R * 0.045, D);
        add(new THREE.SphereGeometry(R * 0.06, 12, 8), goldMat(), ...b);
        const tip = add(new THREE.OctahedronGeometry(R * 0.06), glowMat(0x70ffa0, 3), c[0], c[1], c[2] + R * 0.05); tip.userData.spin = ['z', 4 * sd];
        // боковые капсулы для руды
        for (const y of [1, -1]) add(lathe(R * 0.72, R * 0.14, [[0, 0.45], [0.15, 1], [0.85, 1], [1, 0.45]], 18), M, sd * R * 0.6, y * R * 0.13, -R * 0.15);
        add(lathe(R * 0.5, R * 0.14, [[0, 0.8], [0.2, 1], [0.85, 0.95], [1, 0.6]], 16), D, sd * R * 0.24, 0, -R * 0.88);
        addEngine(g, sd * R * 0.24, 0, -R * 1.12, R * 0.12, eng);
      }
      armSegment(g, [0, R * 0.46, R * 0.05], [0, R * 0.74, R * 0.62], R * 0.03, D); // кран
      add(rbox(R * 0.1, R * 0.1, R * 0.08), goldMat(), 0, R * 0.68, R * 0.66);
      greebles(g, R, 26, D, [R * 0.7, R * 0.33, R * 0.9]);
      addLights(g, [[R * 0.78, 0, -R * 0.1, R * 0.025], [-R * 0.78, 0, -R * 0.1, R * 0.025]], 0xffc040);
      break;
    }
    case 'argus': {
      add(lathe(R * 2.0, R * 0.36, [[0, 0.7], [0.12, 1], [0.6, 0.95], [0.85, 0.65], [1, 0.1]], 26), M, 0, 0, 0, 1.4, 0.6, 1);
      // купол-излучатель щита
      add(new THREE.SphereGeometry(R * 0.32, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2), M, 0, R * 0.17, -R * 0.12, 1, 0.55, 1.25);
      add(new THREE.TorusGeometry(R * 0.33, R * 0.018, 8, 72), glowMat(0xbfe6ff, 2.2), 0, R * 0.18, -R * 0.12, 1, 1.25, 1).rotation.x = Math.PI / 2;
      add(new THREE.SphereGeometry(R * 0.05, 16, 10), glowMat(0xd8f0ff, 3.5), 0, R * 0.36, -R * 0.12);
      for (const sd of [1, -1]) {
        add(rbox(R * 0.48, R * 0.04, R * 0.3), M, sd * R * 0.48, -R * 0.03, -R * 0.32);
        add(lathe(R * 1.05, R * 0.12, [[0, 0.7], [0.15, 1], [0.8, 1], [1, 0.45]], 18), M, sd * R * 0.76, -R * 0.04, -R * 0.36);
        add(rbox(R * 0.012, R * 0.02, R * 0.9), goldMat(), sd * R * 0.88, -R * 0.04, -R * 0.36);
        addEngine(g, sd * R * 0.76, -R * 0.04, -R * 0.92, R * 0.1, eng);
        add(rbox(R * 0.015, R * 0.02, R * 1.3), goldMat(), sd * R * 0.5, R * 0.02, R * 0.1);
      }
      for (const [x, z] of [[0.24, 0.45], [-0.24, 0.45], [0.3, -0.48], [-0.3, -0.48]]) addTurret(g, R * x, R * 0.18, R * z, R * 0.11, D);
      addEngine(g, 0, 0, -R * 1.02, R * 0.17, eng);
      greebles(g, R, 24, D, [R * 0.8, R * 0.18, R * 1.2]);
      addLights(g, [[R * 0.9, -R * 0.04, R * 0.15, R * 0.025], [-R * 0.9, -R * 0.04, R * 0.15, R * 0.025]], 0xffd070);
      break;
    }
    case 'senator': {
      add(lathe(R * 2.1, R * 0.3, [[0, 0.8], [0.1, 1], [0.5, 0.9], [0.8, 0.55], [1, 0.04]], 36), M, 0, 0, 0, 1.5, 0.55, 1);
      add(rbox(R * 0.35, R * 0.18, R * 1.4), M, 0, -R * 0.15, -R * 0.1);
      const winMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: sharedTextures().windowsDense, emissiveIntensity: 1.5, metalness: 0.5 });
      [[0.55, 0.17, -0.22, 0.8], [0.4, 0.29, -0.3, 0.55], [0.26, 0.41, -0.36, 0.32]].forEach(([w, y, z, d]) => {
        add(rbox(R * w, R * 0.12, R * d), M, 0, R * y, R * z);
        add(rbox(R * w * 1.01, R * 0.03, R * d * 0.8), winMat, 0, R * (y + 0.02), R * z);
      });
      add(new THREE.CylinderGeometry(R * 0.008, R * 0.02, R * 0.3, 8), D, 0, R * 0.6, -R * 0.38);
      add(new THREE.SphereGeometry(R * 0.025, 12, 8), goldMat(), 0, R * 0.76, -R * 0.38);
      for (const sd of [1, -1]) {
        add(rbox(R * 0.3, R * 0.11, R * 0.9), M, sd * R * 0.56, -R * 0.02, -R * 0.38);
        for (const dy of [0.03, -0.07]) addEngine(g, sd * R * 0.56, R * dy, -R * 0.85, R * 0.06, eng);
        add(rbox(R * 0.012, R * 0.018, R * 1.6), goldMat(), sd * R * 0.42, R * 0.03, R * 0.15);
        add(rbox(R * 0.32, R * 0.01, R * 0.02), goldMat(), sd * R * 0.56, R * 0.04, R * 0.07);
      }
      for (const [x, z] of [[0.2, 0.55], [-0.2, 0.55], [0.28, 0.25], [-0.28, 0.25], [0.18, -0.68], [-0.18, -0.68]]) addTurret(g, R * x, R * 0.12, R * z, R * 0.075, D);
      for (const x of [-0.18, 0, 0.18]) addEngine(g, R * x, -R * 0.03, -R * 1.07, R * 0.1, eng);
      greebles(g, R, 60, D, [R * 0.9, R * 0.12, R * 1.5]);
      addLights(g, [[R * 0.72, 0, -R * 0.3, R * 0.012], [-R * 0.72, 0, -R * 0.3, R * 0.012], [0, R * 0.78, -R * 0.38, R * 0.01]], 0xffd070);
      break;
    }

    // ===== Пограничная Лига: модульные коробки, фермы и контейнеры, оранжевые дюзы =====
    case 'brodyaga': {
      const crate = pbrMat(0x9a5a2a, 'liga');
      add(rbox(R * 0.45, R * 0.36, R * 0.5), M, 0, R * 0.05, R * 0.55);
      add(rbox(R * 0.36, R * 0.1, R * 0.03), glassMat(), 0, R * 0.12, R * 0.81);
      for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(rod([x * R * 0.12, y * R * 0.12, R * 0.32], [x * R * 0.12, y * R * 0.12, -R * 0.7], R * 0.022, D));
      for (const z of [0.15, -0.25, -0.62]) { g.add(rod([R * 0.12, R * 0.12, R * z], [-R * 0.12, -R * 0.12, R * z], R * 0.016, D)); g.add(rod([-R * 0.12, R * 0.12, R * z], [R * 0.12, -R * 0.12, R * z], R * 0.016, D)); }
      add(rbox(R * 0.42, R * 0.42, R * 0.62), crate, 0, -R * 0.06, -R * 0.15);
      for (const sd of [1, -1]) {
        add(lathe(R * 0.55, R * 0.12, [[0, 0.8], [0.2, 1], [0.8, 1], [1, 0.65]], 12), D, sd * R * 0.33, 0, -R * 0.62);
        g.add(rod([sd * R * 0.12, 0, -R * 0.55], [sd * R * 0.26, 0, -R * 0.6], R * 0.03, D));
        addEngine(g, sd * R * 0.33, 0, -R * 0.92, R * 0.1, eng);
      }
      // бур только справа — корабль собран «на коленке»
      const a = [R * 0.22, -R * 0.12, R * 0.4], b = [R * 0.44, -R * 0.26, R * 0.72], c = [R * 0.34, -R * 0.32, R * 1.0];
      armSegment(g, a, b, R * 0.04, D); armSegment(g, b, c, R * 0.035, D);
      const tip = add(new THREE.OctahedronGeometry(R * 0.05), glowMat(0xffd080, 3), c[0], c[1], c[2] + R * 0.04); tip.userData.spin = ['z', 4];
      g.add(rod([-R * 0.15, R * 0.22, R * 0.5], [-R * 0.2, R * 0.62, R * 0.4], R * 0.012, D));
      add(new THREE.SphereGeometry(R * 0.09, 14, 6, 0, Math.PI * 2, 0, 0.9), D, -R * 0.2, R * 0.6, R * 0.4).rotation.x = -0.6;
      addLights(g, [[R * 0.25, R * 0.25, R * 0.6, R * 0.02], [-R * 0.25, R * 0.25, R * 0.6, R * 0.02]], 0xffa020);
      break;
    }
    case 'pastuh': {
      add(rbox(R * 1.0, R * 0.25, R * 1.5), M);
      add(rbox(R * 0.7, R * 0.08, R * 1.1), M, 0, R * 0.15, -R * 0.15);
      const bayGlow = glowMat(0xffb060, 1.4);
      for (const sd of [1, -1]) {
        for (const z of [0.4, 0, -0.4]) add(new THREE.PlaneGeometry(R * 0.28, R * 0.15), bayGlow, sd * R * 0.505, 0, R * z).rotation.y = sd * Math.PI / 2;
        add(rbox(R * 0.2, R * 0.18, R * 1.15), M, sd * R * 0.88, -R * 0.06, -R * 0.12);
        for (const z of [0.35, -0.1, -0.55]) g.add(rod([sd * R * 0.5, -R * 0.04, R * z], [sd * R * 0.78, -R * 0.06, R * z], R * 0.025, D));
        addEngine(g, sd * R * 0.88, -R * 0.06, -R * 0.75, R * 0.08, eng);
      }
      add(rbox(R * 0.3, R * 0.3, R * 0.3), M, 0, R * 0.3, R * 0.45);
      add(rbox(R * 0.31, R * 0.06, R * 0.2), glassMat(), 0, R * 0.36, R * 0.52);
      g.add(rod([0, R * 0.45, R * 0.4], [0, R * 0.72, R * 0.35], R * 0.015, D));
      const dish = add(new THREE.SphereGeometry(R * 0.16, 20, 6, 0, Math.PI * 2, 0, 0.8), D, 0, R * 0.74, R * 0.35); dish.rotation.x = -1.2; dish.userData.spin = ['y', 0.8];
      for (const x of [-0.28, 0.28]) addEngine(g, R * x, 0, -R * 0.78, R * 0.1, eng);
      for (let i = 0; i < 6; i++) add(rbox(R * 0.5, R * 0.012, R * 0.04), glowMat(0xd8b020, 1.2), 0, R * 0.126, R * (0.7 - i * 0.05)); // разметка палубы
      greebles(g, R, 22, D, [R * 0.9, R * 0.13, R * 1.3]);
      addLights(g, [[R * 0.98, -R * 0.06, R * 0.42, R * 0.025], [-R * 0.98, -R * 0.06, R * 0.42, R * 0.025]], 0xffa020);
      break;
    }
    case 'kovcheg': {
      add(rbox(R * 0.12, R * 0.12, R * 2.0), D);
      for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(rod([x * R * 0.1, y * R * 0.1, R * 0.95], [x * R * 0.1, y * R * 0.1, -R * 0.9], R * 0.012, D));
      add(rbox(R * 0.42, R * 0.32, R * 0.36), M, 0, 0, R * 1.05);
      add(rbox(R * 0.43, R * 0.06, R * 0.2), glassMat(), 0, R * 0.08, R * 1.15);
      const crates = [0x9a5a2a, 0x4a6a7a, 0x8a7a40].map(c => pbrMat(c, 'liga'));
      const r = seeded(17);
      for (let i = 0; i < 3; i++) for (let a = 0; a < 6; a++) {
        const ang = a * Math.PI / 3;
        const box = add(rbox(R * 0.2, R * 0.2, R * 0.34), crates[Math.floor(r() * 3)], Math.cos(ang) * R * 0.25, Math.sin(ang) * R * 0.25, R * (0.15 - i * 0.38));
        box.rotation.z = ang;
      }
      // вращающееся жилое кольцо со спицами
      const hab = new THREE.Group(); hab.position.z = R * 0.6; hab.userData.spin = ['z', 0.25];
      hab.add(new THREE.Mesh(new THREE.TorusGeometry(R * 0.55, R * 0.07, 14, 72), M));
      const habWin = new THREE.Mesh(new THREE.TorusGeometry(R * 0.55, R * 0.072, 4, 72, Math.PI * 2), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: sharedTextures().windows, emissiveIntensity: 1.2, metalness: 0.4, roughness: 0.6 }));
      habWin.scale.set(1, 1, 0.35); hab.add(habWin);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; hab.add(rod([Math.cos(a) * R * 0.08, Math.sin(a) * R * 0.08, 0], [Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, 0], R * 0.02, D)); }
      g.add(hab);
      const solar = new THREE.MeshStandardMaterial({ map: sharedTextures().solar, metalness: 0.35, roughness: 0.4, side: THREE.DoubleSide });
      for (const sd of [1, -1]) { g.add(rod([sd * R * 0.12, 0, R * 0.95], [sd * R * 0.7, 0, R * 0.95], R * 0.015, D)); add(new THREE.PlaneGeometry(R * 0.5, R * 0.3), solar, sd * R * 0.95, 0, R * 0.95).rotation.x = -Math.PI / 2; }
      add(rbox(R * 0.5, R * 0.5, R * 0.3), M, 0, 0, -R * 0.98);
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; addEngine(g, Math.cos(a) * R * 0.17, Math.sin(a) * R * 0.17, -R * 1.16, R * 0.07, eng); }
      addTurret(g, 0, R * 0.17, R * 1.0, R * 0.07, D); addTurret(g, 0, R * 0.26, -R * 0.95, R * 0.07, D);
      addLights(g, [[R * 0.62, 0, R * 0.6, R * 0.015], [-R * 0.62, 0, R * 0.6, R * 0.015]], 0xffa020);
      break;
    }
    case 'taran': {
      const hull = add(lathe(R * 2.0, R * 0.4, [[0, 0.8], [0.3, 1], [0.75, 0.72], [1, 0.18]], 4), M, 0, 0, 0, 1.5, 0.62, 1); hull.rotation.z = Math.PI / 4;
      const ram = add(new THREE.ConeGeometry(R * 0.22, R * 0.75, 4), D, 0, 0, R * 1.2); ram.rotation.x = Math.PI / 2;
      for (const sd of [1, -1]) {
        add(new THREE.ConeGeometry(R * 0.05, R * 0.35, 4), D, sd * R * 0.24, 0, R * 1.0).rotation.x = Math.PI / 2;
        // накладные броневые плиты в несколько слоёв
        for (let k = 0; k < 3; k++) add(rbox(R * 0.08, R * 0.3, R * 0.42), M, sd * R * (0.44 + k * 0.03), 0, R * (0.35 - k * 0.42)).rotation.y = sd * 0.08;
        gatling(g, sd * R * 0.22, R * 0.27, R * 0.35, R * 0.11, M, D);
        add(lathe(R * 0.55, R * 0.16, [[0, 0.9], [0.2, 1], [0.8, 0.95], [1, 0.7]], 12), D, sd * R * 0.32, 0, -R * 0.88);
        addEngine(g, sd * R * 0.32, 0, -R * 1.16, R * 0.13, eng);
      }
      add(rbox(R * 0.5, R * 0.16, R * 0.9), M, 0, R * 0.22, -R * 0.25);
      add(rbox(R * 0.3, R * 0.05, R * 0.15), glassMat(), 0, R * 0.31, R * 0.05);
      addEngine(g, 0, R * 0.05, -R * 1.1, R * 0.15, eng);
      for (let i = 0; i < 5; i++) add(rbox(R * 0.06, R * 0.02, R * 0.12), glowMat(0xd8b020, 1.3), R * (-0.2 + i * 0.1), R * 0.305, -R * 0.65); // полосы опасности
      addLights(g, [[R * 0.5, 0, R * 0.4, R * 0.025], [-R * 0.5, 0, R * 0.4, R * 0.025]], 0xff7020);
      break;
    }

    // ===== Орден Предела: плавные «живые» корпуса, кристаллы и кольца фиолетового света =====
    case 'iskatel': {
      add(lathe(R * 2.0, R * 0.26, [[0, 0.3], [0.15, 0.75], [0.4, 1], [0.7, 0.8], [0.92, 0.35], [1, 0.02]], 32), M, 0, 0, 0, 1, 0.8, 1);
      const halo = add(new THREE.TorusGeometry(R * 0.5, R * 0.022, 10, 80), crystalMat(), 0, 0, -R * 0.12); halo.userData.spin = ['z', 0.6];
      for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + Math.PI / 2; g.add(rod([Math.cos(a) * R * 0.18, Math.sin(a) * R * 0.15, -R * 0.12], [Math.cos(a) * R * 0.49, Math.sin(a) * R * 0.49, -R * 0.12], R * 0.012, D)); }
      add(new THREE.CylinderGeometry(R * 0.008, R * 0.02, R * 0.5, 8), D, 0, 0, R * 1.2).rotation.x = Math.PI / 2;
      const tipC = add(new THREE.OctahedronGeometry(R * 0.06), crystalMat(), 0, 0, R * 1.48, 0.7, 0.7, 1.8); tipC.userData.spin = ['z', 1.5];
      for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 - Math.PI / 2; const f = add(rbox(R * 0.02, R * 0.3, R * 0.4), M, Math.cos(a) * R * 0.22, Math.sin(a) * R * 0.22, -R * 0.72); f.rotation.z = a - Math.PI / 2; f.rotation.x = -0.35; }
      add(new THREE.SphereGeometry(R * 0.1, 20, 12), glassMat(), 0, R * 0.14, R * 0.38, 0.8, 0.55, 1.8);
      addEngine(g, 0, 0, -R * 1.02, R * 0.13, eng);
      addLights(g, [[0, R * 0.5, -R * 0.12, R * 0.02]], 0xc090ff);
      break;
    }
    case 'prizma': {
      for (const sd of [1, -1]) {
        const prong = add(lathe(R * 1.8, R * 0.12, [[0, 0.7], [0.2, 1], [0.6, 0.85], [0.9, 0.4], [1, 0.03]], 20), M, sd * R * 0.3, 0, R * 0.05, 1, 0.8, 1);
        prong.rotation.y = -sd * 0.07;
        add(new THREE.SphereGeometry(R * 0.035, 12, 8), glowMat(0xc090ff, 3), sd * R * 0.24, 0, R * 0.98);
        add(rbox(R * 0.02, R * 0.22, R * 0.36), M, sd * R * 0.32, R * 0.12, -R * 0.62).rotation.z = -sd * 0.3;
        addEngine(g, sd * R * 0.3, 0, -R * 0.88, R * 0.09, eng);
      }
      add(lathe(R * 0.9, R * 0.22, [[0, 0.6], [0.3, 1], [0.8, 0.9], [1, 0.4]], 24), M, 0, 0, -R * 0.45, 1.5, 0.6, 1);
      add(new THREE.SphereGeometry(R * 0.09, 18, 10), glassMat(), 0, R * 0.1, -R * 0.2, 0.9, 0.55, 1.6);
      const prism = add(new THREE.OctahedronGeometry(R * 0.16), crystalMat(), 0, 0, R * 0.42, 0.65, 0.65, 2.4); prism.userData.spin = ['z', 0.9];
      add(new THREE.TorusGeometry(R * 0.2, R * 0.012, 8, 48), glowMat(0xa070ff, 2), 0, 0, R * 0.42);
      break;
    }
    case 'orakul': {
      add(new THREE.SphereGeometry(R * 0.38, 40, 28), M, 0, 0, 0, 1, 0.85, 1.35);
      for (let i = 0; i < 3; i++) {
        const w = new THREE.Group(); w.rotation.z = i * Math.PI * 2 / 3;
        const arc = new THREE.Mesh(new THREE.TorusGeometry(R * 0.78, R * 0.035, 10, 64, Math.PI * 0.9), M); arc.rotation.set(0, Math.PI / 2, Math.PI * 0.05); w.add(arc);
        const node = new THREE.Mesh(new THREE.OctahedronGeometry(R * 0.06), crystalMat()); node.position.set(0, R * 0.78, 0); w.add(node);
        g.add(w);
      }
      const top = add(new THREE.OctahedronGeometry(R * 0.14), crystalMat(), 0, R * 0.52, 0, 0.6, 1.7, 0.6); top.userData.spin = ['y', 0.7];
      add(new THREE.SphereGeometry(R * 0.08, 20, 12), glowMat(0xc090ff, 2.6), 0, 0, R * 0.52);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; add(lathe(R * 0.45, R * 0.08, [[0, 0.5], [0.3, 1], [0.8, 0.9], [1, 0.3]], 14), M, Math.cos(a) * R * 0.32, Math.sin(a) * R * 0.28, -R * 0.45); }
      for (const sd of [1, -1]) addEngine(g, sd * R * 0.15, 0, -R * 0.62, R * 0.1, eng);
      addLights(g, [[R * 0.4, 0, 0, R * 0.02], [-R * 0.4, 0, 0, R * 0.02]], 0xc090ff);
      break;
    }
    case 'relikvariy': {
      add(lathe(R * 2.1, R * 0.32, [[0, 0.5], [0.1, 0.9], [0.3, 1], [0.5, 0.85], [0.65, 0.95], [0.85, 0.6], [1, 0.05]], 44), M, 0, 0, 0, 1.25, 0.7, 1);
      add(lathe(R * 1.3, R * 0.16, [[0, 0.5], [0.3, 1], [0.8, 0.8], [1, 0.1]], 28), M, 0, -R * 0.2, -R * 0.15, 1.4, 0.7, 1);
      // кристаллический гребень на спине
      for (let i = 0; i < 7; i++) { const k = 1 - Math.abs(i - 2.5) / 4.5; add(new THREE.OctahedronGeometry(R * 0.08 * (0.6 + k)), crystalMat(), 0, R * (0.24 + 0.06 * k), R * (0.55 - i * 0.18), 0.45, 1.9, 0.9); }
      for (const [z, sp] of [[-0.55, 0.35], [-0.78, -0.5]]) { const h = add(new THREE.TorusGeometry(R * 0.48, R * 0.025, 10, 96), crystalMat(), 0, 0, R * z); h.userData.spin = ['z', sp]; }
      for (const sd of [1, -1]) {
        add(lathe(R * 1.0, R * 0.12, [[0, 0.4], [0.3, 1], [0.8, 0.9], [1, 0.15]], 20), M, sd * R * 0.48, -R * 0.04, -R * 0.2, 1, 0.6, 1).rotation.y = sd * 0.06;
        for (let i = 0; i < 6; i++) add(rbox(R * 0.012, R * 0.035, R * 0.06), glowMat(0xb070ff, 2.4), sd * R * 0.395, R * 0.02, R * (0.45 - i * 0.1)); // ракетные порты
        addEngine(g, sd * R * 0.48, -R * 0.04, -R * 0.72, R * 0.08, eng);
      }
      for (const x of [-0.14, 0, 0.14]) addEngine(g, R * x, 0, -R * 1.06, R * 0.1, eng);
      greebles(g, R, 30, D, [R * 0.6, R * 0.12, R * 1.2]);
      addLights(g, [[R * 0.6, -R * 0.04, R * 0.2, R * 0.012], [-R * 0.6, -R * 0.04, R * 0.2, R * 0.012]], 0xc090ff);
      break;
    }
    // ===== Корабли вольных гильдий =====
    case 'kometa': { // гоночная игла с «усами»-стабилизаторами и огромной дюзой
      shipKit(g, R, M, D, eng, faction, add).loft([[-1.2, 0.2, 0.15], [-0.9, 0.24, 0.17, 0.01], [-0.2, 0.18, 0.14, 0.02], [0.6, 0.08, 0.08], [1.4, 0.005, 0.005]], 'diamond');
      add(new THREE.SphereGeometry(R * 0.11, 18, 10), glassMat(), 0, R * 0.12, R * 0.45, 0.8, 0.6, 2.4);
      const w = wingGeo(R * 0.7, R * 0.55, R * 0.45, R * 0.03);
      add(w, M, R * 0.12, -R * 0.03, -R * 0.55); const w2 = add(w, M, -R * 0.12, -R * 0.03, -R * 0.55); w2.scale.x = -1;
      for (const sd of [1, -1]) {
        g.add(rod([sd * R * 0.12, R * 0.04, R * 0.6], [sd * R * 0.75, R * 0.22, R * 1.35], R * 0.018, D)); // усы
        add(new THREE.SphereGeometry(R * 0.035, 10, 8), glowMat(0xffd060, 3), sd * R * 0.75, R * 0.22, R * 1.35);
        add(rbox(R * 0.02, R * 0.32, R * 0.3), M, sd * R * 0.2, R * 0.16, -R * 0.85).rotation.z = -sd * 0.35;
      }
      for (let i = 0; i < 9; i++) add(rbox(R * 0.05, R * 0.012, R * 0.12), glowMat(0xffc040, 1.6), 0, R * 0.17 - i * R * 0.002, R * (0.25 - i * 0.14)); // гоночная полоса
      add(lathe(R * 0.5, R * 0.26, [[0, 1], [0.6, 0.9], [1, 0.55]], 24), D, 0, 0, -R * 1.1);
      addEngine(g, 0, 0, -R * 1.38, R * 0.24, eng, 1.5);
      addLights(g, [[R * 0.7, -R * 0.03, -R * 0.75, R * 0.02], [-R * 0.7, -R * 0.03, -R * 0.75, R * 0.02]], 0xffd060);
      break;
    }
    case 'meduza': { // газовая баржа: светящийся купол-коллектор и щупы-заборники
      add(rbox(R * 1.1, R * 0.28, R * 1.6), M, 0, -R * 0.15, 0);
      add(rbox(R * 0.5, R * 0.22, R * 0.4), M, 0, -R * 0.05, R * 0.85);
      add(rbox(R * 0.51, R * 0.07, R * 0.16), glassMat(), 0, R * 0.02, R * 0.97);
      const domeMat = new THREE.MeshPhysicalMaterial({ color: 0x9fe8ff, emissive: 0x3ab8e0, emissiveIntensity: 0.9, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide });
      domeMat.userData.owned = true;
      add(new THREE.SphereGeometry(R * 0.62, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2), domeMat, 0, R * 0.0, -R * 0.1, 1, 0.75, 1.15);
      const core = add(new THREE.IcosahedronGeometry(R * 0.16, 1), glowMat(0x80e8ff, 2.4), 0, R * 0.18, -R * 0.1); core.userData.spin = ['y', 0.5];
      add(new THREE.TorusGeometry(R * 0.62, R * 0.03, 8, 64), D, 0, 0, -R * 0.1).rotation.x = Math.PI / 2;
      // щупы: тонкие изогнутые цепочки с огоньками
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2, x0 = Math.cos(a) * R * 0.45, z0 = -R * 0.1 + Math.sin(a) * R * 0.55;
        let p = [x0, -R * 0.28, z0];
        for (let k = 1; k <= 3; k++) { const q = [x0 * (1 + k * 0.12), -R * (0.28 + k * 0.22), z0 - k * R * 0.12]; g.add(rod(p, q, R * 0.014 * (1.2 - k * 0.25), D)); p = q; }
        add(new THREE.SphereGeometry(R * 0.03, 8, 6), glowMat(0x80f0ff, 3), p[0], p[1], p[2]);
      }
      for (const sd of [1, -1]) { add(rbox(R * 0.2, R * 0.2, R * 0.5), D, sd * R * 0.55, -R * 0.12, -R * 0.75); addEngine(g, sd * R * 0.55, -R * 0.12, -R * 1.02, R * 0.09, eng); }
      greebles(g, R, 18, D, [R * 1.0, -R * 0.02, R * 1.4]);
      addLights(g, [[R * 0.56, -R * 0.15, R * 0.6, R * 0.02], [-R * 0.56, -R * 0.15, R * 0.6, R * 0.02]], 0x80f0ff);
      break;
    }
    case 'peleng': { // разведчик Бюро: четыре антенны-лепестка и кассета зондов
      shipKit(g, R, M, D, eng, faction, add).loft([[-0.95, 0.14, 0.13], [-0.5, 0.24, 0.2, 0.02], [0.2, 0.22, 0.19, 0.02], [0.7, 0.1, 0.09], [0.95, 0.02, 0.02]], 'hex');
      add(new THREE.SphereGeometry(R * 0.1, 16, 10), glassMat(), 0, R * 0.14, R * 0.4, 0.8, 0.55, 1.8);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4, cx = Math.cos(a), cy = Math.sin(a);
        const petal = add(rbox(R * 0.015, R * 0.5, R * 0.18), M, cx * R * 0.38, cy * R * 0.38, R * 0.55);
        petal.rotation.z = a - Math.PI / 2; petal.rotation.x = 0.25;
        add(new THREE.SphereGeometry(R * 0.035, 10, 8), glowMat(0x70d0ff, 3), cx * R * 0.62, cy * R * 0.62, R * 0.6);
      }
      g.add(rod([0, R * 0.2, -R * 0.1], [0, R * 0.48, -R * 0.15], R * 0.015, D));
      const dish = add(new THREE.SphereGeometry(R * 0.15, 20, 6, 0, Math.PI * 2, 0, 0.8), D, 0, R * 0.5, -R * 0.15); dish.rotation.x = -1.2; dish.userData.spin = ['y', 1.2];
      const cas = new THREE.Group(); cas.position.z = -R * 0.6; cas.userData.spin = ['z', 0.8];
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; const c = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.04, R * 0.04, R * 0.3, 10), D); c.rotation.x = Math.PI / 2; c.position.set(Math.cos(a) * R * 0.22, Math.sin(a) * R * 0.22, 0); cas.add(c); const tip = new THREE.Mesh(new THREE.SphereGeometry(R * 0.025, 8, 6), glowMat(0x70d0ff, 2.5)); tip.position.set(Math.cos(a) * R * 0.22, Math.sin(a) * R * 0.22, R * 0.16); cas.add(tip); }
      g.add(cas);
      addEngine(g, 0, 0, -R * 0.98, R * 0.13, eng);
      addLights(g, [[R * 0.3, 0, -R * 0.3, R * 0.02], [-R * 0.3, 0, -R * 0.3, R * 0.02]], 0x70d0ff);
      break;
    }
    case 'avrora': { // белый лайнер с панорамной палубой и рядами иллюминаторов
      const W = porcelainMat();
      shipKit(g, R, M, D, eng, faction, add).loft([[-1.15, 0.28, 0.2], [-0.95, 0.4, 0.26], [0.0, 0.43, 0.28, 0.01], [0.7, 0.36, 0.22], [1.0, 0.18, 0.12, -0.02], [1.15, 0.02, 0.02, -0.04]], 'round', W, true);
      const winMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff0d0, emissiveMap: sharedTextures().windowsDense, emissiveIntensity: 1.3, metalness: 0.3, roughness: 0.5 });
      winMat.userData.owned = true;
      for (const sd of [1, -1]) { const strip = add(new THREE.PlaneGeometry(R * 1.6, R * 0.1), winMat, sd * R * 0.4, R * 0.02, R * 0.05); strip.rotation.y = sd * Math.PI / 2; }
      add(new THREE.SphereGeometry(R * 0.3, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), glassMat(), 0, R * 0.2, R * 0.2, 1, 0.45, 2.2); // панорамная палуба
      add(rbox(R * 0.5, R * 0.05, R * 1.1), goldMat(), 0, R * 0.22, R * 0.1, 1, 1, 1).scale.set(1.25, 0.4, 1);
      for (const sd of [1, -1]) {
        const fin = add(wingGeo(R * 0.45, R * 0.5, R * 0.35, R * 0.03), W, sd * R * 0.35, -R * 0.05, -R * 0.65); if (sd < 0) fin.scale.x = -1;
        add(lathe(R * 0.6, R * 0.13, [[0, 0.8], [0.3, 1], [0.9, 0.9], [1, 0.4]], 18), W, sd * R * 0.42, -R * 0.08, -R * 0.75);
        addEngine(g, sd * R * 0.42, -R * 0.08, -R * 1.07, R * 0.11, eng);
      }
      const tail = add(rbox(R * 0.03, R * 0.42, R * 0.45), W, 0, R * 0.38, -R * 0.75); tail.rotation.x = -0.35;
      add(new THREE.SphereGeometry(R * 0.06, 12, 8), glowMat(0xffd080, 3), 0, R * 0.58, -R * 0.9);
      addEngine(g, 0, 0, -R * 1.18, R * 0.15, eng);
      addLights(g, [[R * 0.43, 0, R * 0.9, R * 0.02], [-R * 0.43, 0, R * 0.9, R * 0.02]], 0x40ff60);
      break;
    }
    case 'gonchaya': { // охотник за головами: сенсорная «морда», клетка-захват на брюхе
      { const K = shipKit(g, R, M, D, eng, faction, add); K.loft([[-1.0, 0.36, 0.2], [-0.4, 0.5, 0.24, 0.02], [0.4, 0.44, 0.22, 0.02], [0.95, 0.18, 0.12]], 'wedge'); K.loft([[-0.8, 0.2, 0.08, 0.2], [0.3, 0.18, 0.07, 0.21], [0.6, 0.03, 0.03, 0.17]], 'wedge', D); }
      const snout = add(new THREE.ConeGeometry(R * 0.2, R * 0.55, 6), D, 0, 0, R * 1.18); snout.rotation.x = Math.PI / 2;
      for (const sd of [1, -1]) add(new THREE.SphereGeometry(R * 0.045, 12, 8), glowMat(0xff3020, 3.2), sd * R * 0.11, R * 0.07, R * 1.05);
      // захват-клетка
      const cage = new THREE.Group(); cage.position.set(0, -R * 0.32, R * 0.15);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const b = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.012, R * 0.012, R * 0.5, 6), D); b.rotation.x = Math.PI / 2; b.position.set(Math.cos(a) * R * 0.17, Math.sin(a) * R * 0.12, 0); cage.add(b); }
      for (const z of [-0.25, 0, 0.25]) { const r = new THREE.Mesh(new THREE.TorusGeometry(R * 0.17, R * 0.014, 6, 24), D); r.position.z = R * z; r.scale.y = 0.7; cage.add(r); }
      g.add(cage);
      for (const sd of [1, -1]) {
        g.add(rod([sd * R * 0.3, -R * 0.05, R * 0.75], [sd * R * 0.45, -R * 0.12, R * 1.15], R * 0.03, D)); // клешни
        add(new THREE.ConeGeometry(R * 0.04, R * 0.18, 6), D, sd * R * 0.42, -R * 0.12, R * 1.25).rotation.x = Math.PI / 2;
        gatling(g, sd * R * 0.35, R * 0.2, R * 0.2, R * 0.1, M, D);
        add(lathe(R * 0.6, R * 0.15, [[0, 0.9], [0.2, 1], [0.8, 0.95], [1, 0.6]], 12), D, sd * R * 0.3, 0, -R * 0.85);
        addEngine(g, sd * R * 0.3, 0, -R * 1.16, R * 0.12, eng);
      }
      add(rbox(R * 0.28, R * 0.06, R * 0.18), glassMat(), 0, R * 0.24, R * 0.45);
      for (let i = 0; i < 4; i++) add(rbox(R * 0.5, R * 0.015, R * 0.05), glowMat(0xff5030, 1.2), 0, R * 0.22, R * (-0.1 - i * 0.12));
      addLights(g, [[R * 0.55, 0, 0, R * 0.025], [-R * 0.55, 0, 0, R * 0.025]], 0xff3020);
      break;
    }
    case 'burevestnik': { // штормовой крейсер: крылья-чайка и громоотводы-гребни
      shipKit(g, R, M, D, eng, faction, add).loft([[-1.0, 0.22, 0.16], [-0.5, 0.34, 0.22, 0.02], [0.3, 0.3, 0.2, 0.02], [0.8, 0.12, 0.1], [1.05, 0.01, 0.02]], 'keel');
      for (const sd of [1, -1]) {
        const inner = add(wingGeo(R * 0.55, R * 0.7, R * 0.25, R * 0.05), M, sd * R * 0.2, 0, -R * 0.1); inner.rotation.z = sd * 0.3; if (sd < 0) inner.scale.x = -1;
        const outer = add(wingGeo(R * 0.6, R * 0.5, R * 0.45, R * 0.04), M, sd * R * 0.7, R * 0.16, -R * 0.2); outer.rotation.z = -sd * 0.25; if (sd < 0) outer.scale.x = -1;
        add(new THREE.ConeGeometry(R * 0.02, R * 0.3, 6), D, sd * R * 1.28, R * 0.05, -R * 0.4);
        add(new THREE.SphereGeometry(R * 0.03, 8, 6), glowMat(0x70b8ff, 3.5), sd * R * 1.28, R * 0.2, -R * 0.4);
        addEngine(g, sd * R * 0.2, -R * 0.03, -R * 1.02, R * 0.11, eng);
      }
      for (let i = 0; i < 5; i++) { // громоотводы на хребте
        const z = R * (0.5 - i * 0.28), h = R * (0.22 + (i % 2) * 0.08);
        add(new THREE.ConeGeometry(R * 0.025, h, 6), D, 0, R * 0.2 + h / 2, z);
        add(new THREE.SphereGeometry(R * 0.022, 8, 6), glowMat(0x80c8ff, 3.5), 0, R * 0.2 + h, z);
      }
      add(new THREE.SphereGeometry(R * 0.09, 16, 10), glassMat(), 0, R * 0.13, R * 0.55, 1, 0.6, 1.8);
      addLights(g, [[0, -R * 0.2, R * 0.2, R * 0.02]], 0x80c8ff);
      break;
    }
    case 'veche': { // штабной крейсер: купол зала совета, колокол, палуба эскорта
      add(rbox(R * 1.0, R * 0.36, R * 2.0), M, 0, 0, 0);
      add(rbox(R * 0.8, R * 0.06, R * 1.2), D, 0, -R * 0.2, -R * 0.2);
      add(new THREE.SphereGeometry(R * 0.32, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), glassMat(), 0, R * 0.18, R * 0.45, 1, 0.75, 1);
      add(new THREE.TorusGeometry(R * 0.32, R * 0.025, 8, 48), goldMat(), 0, R * 0.18, R * 0.45).rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(R * 0.012, R * 0.012, R * 0.3, 6), D, 0, R * 0.48, R * 0.45);
      const bell = add(lathe(R * 0.16, R * 0.08, [[0, 1], [0.4, 0.75], [0.9, 0.45], [1, 0.2]], 18), goldMat(), 0, R * 0.6, R * 0.45); bell.rotation.x = -Math.PI / 2;
      // лётная палуба эскорта сзади сверху
      add(rbox(R * 0.7, R * 0.05, R * 0.9), M, 0, R * 0.21, -R * 0.45);
      for (let i = 0; i < 6; i++) add(rbox(R * 0.6, R * 0.012, R * 0.035), glowMat(0x9fe060, 1.4), 0, R * 0.24, R * (-0.1 - i * 0.13));
      for (const sd of [1, -1]) {
        g.add(rod([sd * R * 0.45, R * 0.18, R * 0.85], [sd * R * 0.6, R * 0.6, R * 0.8], R * 0.015, D)); // антенны
        add(new THREE.SphereGeometry(R * 0.025, 8, 6), glowMat(0xffd060, 3), sd * R * 0.6, R * 0.6, R * 0.8);
        addTurret(g, sd * R * 0.35, R * 0.2, R * 0.85, R * 0.08, D);
        add(rbox(R * 0.22, R * 0.26, R * 0.5), D, sd * R * 0.42, -R * 0.02, -R * 1.1);
        for (const y of [0.05, -0.08]) addEngine(g, sd * R * 0.42, R * y, -R * 1.37, R * 0.07, eng);
      }
      greebles(g, R, 26, D, [R * 0.9, R * 0.18, R * 1.8]);
      addLights(g, [[R * 0.52, 0, R * 0.95, R * 0.02], [-R * 0.52, 0, R * 0.95, R * 0.02]], 0xffd060);
      break;
    }
    case 'porog': { // дредноут Порога: тёмная броня, кристаллические жилы и пылающее ядро Архонта
      { const K = shipKit(g, R, M, D, eng, faction, add); K.loft([[-1.1, 0.4, 0.22], [-0.7, 0.52, 0.28, 0.02], [0.2, 0.5, 0.26, 0.02], [0.7, 0.32, 0.18], [1.05, 0.08, 0.06]], 'wedge');
        K.loft([[-0.9, 0.26, 0.1, 0.24], [0.1, 0.24, 0.1, 0.26], [0.4, 0.04, 0.04, 0.22]], 'flat', D); }
      const coreG = new THREE.Group(); coreG.position.set(0, R * 0.36, R * 0.55);
      add(new THREE.CylinderGeometry(R * 0.2, R * 0.26, R * 0.12, 8), D, 0, R * 0.2, R * 0.55);
      const coreM = new THREE.Mesh(new THREE.IcosahedronGeometry(R * 0.16, 1), glowMat(0xff70d0, 3)); coreM.userData.spin = ['y', 0.6]; coreG.add(coreM);
      for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(R * 0.24, R * 0.012, 6, 48), goldMat()); r.rotation.set(i * 1.05, i * 0.7, 0); r.userData.spin = [['x', 'y', 'z'][i], 0.4 + i * 0.2]; coreG.add(r); }
      g.add(coreG);
      const vein = crystalMat();
      for (const sd of [1, -1]) {
        for (let i = 0; i < 6; i++) add(rbox(R * 0.02, R * 0.02, R * 0.32), vein, sd * R * (0.42 - i * 0.025), R * (0.06 - i * 0.008), R * (0.75 - i * 0.3)).rotation.y = sd * 0.08; // жилы
        for (const z of [0.55, 0.15, -0.25]) addTurret(g, sd * R * 0.3, R * 0.2, R * z, R * 0.075, D);
        add(rbox(R * 0.12, R * 0.4, R * 0.7), M, sd * R * 0.58, 0, -R * 0.35).rotation.y = sd * 0.06;
        addEngine(g, sd * R * 0.58, R * 0.05, -R * 0.74, R * 0.1, eng); addEngine(g, sd * R * 0.58, -R * 0.12, -R * 0.74, R * 0.1, eng);
      }
      for (let i = 0; i < 5; i++) { const k = 1 - Math.abs(i - 2) / 3; add(new THREE.OctahedronGeometry(R * 0.06 * (0.6 + k)), vein, 0, R * (0.38 + 0.05 * k), R * (0.2 - i * 0.2), 0.5, 1.8, 0.8); }
      add(new THREE.ConeGeometry(R * 0.12, R * 0.6, 4), D, 0, 0, R * 1.35).rotation.x = Math.PI / 2;
      for (const x of [-0.16, 0, 0.16]) addEngine(g, R * x, 0, -R * 1.12, R * 0.12, eng);
      greebles(g, R, 34, D, [R * 0.8, R * 0.18, R * 1.6]);
      addLights(g, [[R * 0.66, 0, R * 0.2, R * 0.015], [-R * 0.66, 0, R * 0.2, R * 0.015]], 0xff70d0);
      break;
    }
    // ===== «Серафим» — по концепт-арту пилота (см. buildSerafim) =====
    case 'serafim': { buildSerafim(g, R); break; }
    // ===== Колосс Предтеч — босс мирового события: фарфоровый шпиль, золотые кольца, кристаллическое ядро =====
    case 'colossus': {
      const W = porcelainMat(), G = goldMat(), C = crystalMat(), K = glowMat(0xbfe0ff, 3.2);
      add(lathe(R * 2.0, R * 0.32, [[0, 0.05], [0.12, 0.5], [0.3, 0.9], [0.5, 1], [0.7, 0.85], [0.88, 0.45], [1, 0.03]], 48), W, 0, -R * 1.0, 0).rotation.x = -Math.PI / 2;
      const core = add(new THREE.IcosahedronGeometry(R * 0.28, 1), K, 0, 0, 0); core.userData.spin = ['y', 0.35];
      add(new THREE.IcosahedronGeometry(R * 0.36, 0), C, 0, 0, 0).material = C;
      [[R * 0.95, 0.012, 0.05], [R * 1.25, 0.01, -0.035], [R * 1.55, 0.008, 0.022]].forEach(([rad, th, sp], i) => {
        const ring = add(new THREE.TorusGeometry(rad, R * th * 2.2, 10, 120), G, 0, R * (i - 1) * 0.12, 0);
        ring.rotation.x = Math.PI / 2 + (i - 1) * 0.35; ring.userData.spin = [i === 1 ? 'y' : 'z', sp * 6];
      });
      for (let i = 0; i < 6; i++) { // пилоны с кристаллами — «лапы» машины
        const a = i * Math.PI / 3, x = Math.cos(a) * R * 0.75, z = Math.sin(a) * R * 0.75;
        const arm = add(new THREE.CylinderGeometry(R * 0.035, R * 0.06, R * 0.9, 10), W, x, -R * 0.35, z); arm.lookAt(x * 2, -R * 1.2, z * 2); arm.rotateX(Math.PI / 2);
        const cr = add(new THREE.OctahedronGeometry(R * 0.11), C, x * 1.55, -R * 0.75, z * 1.55); cr.scale.set(0.6, 1.8, 0.6); cr.userData.spin = ['y', 0.8 + i * 0.1];
      }
      add(new THREE.ConeGeometry(R * 0.12, R * 0.9, 24), W, 0, R * 0.95, 0);
      add(new THREE.OctahedronGeometry(R * 0.08), K, 0, R * 1.45, 0).userData.spin = ['y', 1.2];
      const dome = add(new THREE.SphereGeometry(R * 1.7, 48, 32), new THREE.MeshBasicMaterial({ color: 0x9a70ff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }), 0, 0, 0);
      dome.userData.dome = true;
      addLights(g, [[R * 1.55, 0, 0, R * 0.02], [-R * 1.55, 0, 0, R * 0.02], [0, R * 1.45, 0, R * 0.03]], 0xbfe0ff);
      break;
    }
    case 'wb_gen': {
      const W = porcelainMat(), C = crystalMat();
      add(new THREE.CylinderGeometry(R * 0.25, R * 0.45, R * 0.5, 8), W, 0, -R * 0.55, 0);
      const ob = add(new THREE.OctahedronGeometry(R * 0.5), C, 0, R * 0.25, 0); ob.scale.set(0.55, 1.6, 0.55); ob.userData.spin = ['y', 0.9];
      const ring = add(new THREE.TorusGeometry(R * 0.6, R * 0.03, 8, 64), goldMat(), 0, R * 0.2, 0); ring.rotation.x = Math.PI / 2.3; ring.userData.spin = ['z', 1.4];
      add(new THREE.SphereGeometry(R * 0.16, 16, 12), glowMat(0xc0a0ff, 3), 0, R * 0.25, 0);
      break;
    }
    default: add(new THREE.SphereGeometry(R * 0.5, 16, 12), M);
  }
  if (LK.emblem) addEmblem(g, R, LK.emblem, LK.emc);
  if (faction === 'pirate' && type !== 'pbase' && type !== 'pdrone' && type !== 'pdrone_h' && type !== 'colossus' && type !== 'wb_gen') { // шипы на пиратских кораблях
    const r = seeded(type.length * 31);
    for (let i = 0; i < 8; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(R * 0.04, R * 0.35, 6), D);
      const a = r() * Math.PI * 2;
      sp.position.set(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.2, (r() - 0.5) * R);
      sp.rotation.set(0, 0, a - Math.PI / 2); g.add(sp);
    }
  }
  applyBoxUV(g, R * 0.42, true);
  return g;
}

// Стержень между двумя точками (стойки, опоры)
function rod(a, b, r, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

// Дроны по классам (размер R — настоящий, в метрах): лёгкие — дротики, средние — с орудийными подвесами,
// тяжёлые — бронированные коробки, стационарные — орудие на треноге, бастион — шестигранная крепость со щитом,
// штурмовой — маленький линкор, ремонтный — сфера с кольцом, шахтёрский — с буром
function droneModel(item, def = {}) {
  const key = 'drone:' + item;
  if (!shipCache.has(key)) {
    const g = new THREE.Group();
    const cls = def.cls || (item === 'drone_mine' ? 'mining' : 'light');
    const R = def.r || 6, col = def.color || 0xff9040;
    const M = hullMat({ mining: 0xc8a050, support: 0xdde8e4, bastion: 0x8a8670, super: 0x6c4c56, heavy: 0x707a86, sentry: 0x7c8aa0 }[cls] || 0x8a96a4, 'player');
    const D = darkMetal();
    const eye = (x, y, z, r) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), glowMat(col, 4)); m.position.set(x, y, z); g.add(m); };
    if (cls === 'light' || cls === 'medium') {
      const body = new THREE.Mesh(new THREE.SphereGeometry(R * 0.55, 20, 14), M); body.scale.set(cls === 'light' ? 0.8 : 1, 0.8, 1.4); g.add(body);
      const nf = cls === 'light' ? 3 : 4;
      for (let i = 0; i < nf; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(R * 0.08, R * 0.9, R * 0.8), D);
        fin.rotation.z = i * Math.PI * 2 / nf; fin.translateY(R * 0.55); g.add(fin);
      }
      if (cls === 'medium') for (const sx of [-1, 1]) {
        const pod = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.1, R * 0.12, R * 1.1, 10), D);
        pod.rotation.x = Math.PI / 2; pod.position.set(sx * R * 0.62, -R * 0.1, R * 0.25); g.add(pod);
      }
      eye(0, 0, R * 0.75, R * 0.18);
      addEngine(g, 0, 0, -R * 0.8, R * 0.2, 0x60c0ff, 0.6);
    } else if (cls === 'heavy') {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(R * 0.9, R * 0.55, R * 1.5), M));
      const nose = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.32, R * 0.45, R * 0.4, 6), D); nose.rotation.x = Math.PI / 2; nose.position.z = R * 0.9; g.add(nose);
      for (const sx of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(R * 0.14, R * 0.72, R * 1.25), D); plate.position.set(sx * R * 0.52, 0, -R * 0.05); g.add(plate);
        const gun = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.07, R * 0.09, R * 1.1, 10), D); gun.rotation.x = Math.PI / 2; gun.position.set(sx * R * 0.24, R * 0.34, R * 0.6); g.add(gun);
        addEngine(g, sx * R * 0.26, 0, -R * 0.82, R * 0.16, 0xff8050, 0.7);
      }
      const visor = new THREE.Mesh(new THREE.BoxGeometry(R * 0.5, R * 0.08, R * 0.06), glowMat(col, 4)); visor.position.set(0, R * 0.12, R * 1.1); g.add(visor);
    } else if (cls === 'sentry') {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.45, 24, 16), M));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.6, R * 0.07, 8, 32), D); ring.rotation.x = Math.PI / 2; g.add(ring);
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3;
        g.add(rod([Math.cos(a) * R * 0.5, -R * 0.1, Math.sin(a) * R * 0.5], [Math.cos(a) * R * 1.05, -R * 1.0, Math.sin(a) * R * 1.05], R * 0.06, D));
        const foot = new THREE.Mesh(new THREE.SphereGeometry(R * 0.1, 10, 8), glowMat(col, 2)); foot.position.set(Math.cos(a) * R * 1.05, -R * 1.0, Math.sin(a) * R * 1.05); g.add(foot);
      }
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.08, R * 0.12, R * 1.7, 12), D); barrel.rotation.x = Math.PI / 2; barrel.position.z = R * 0.9; g.add(barrel);
      const brake = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.15, R * 0.15, R * 0.22, 12), D); brake.rotation.x = Math.PI / 2; brake.position.z = R * 1.7; g.add(brake);
      eye(0, R * 0.2, R * 0.38, R * 0.1);
      addLights(g, [[0, R * 0.47, 0, R * 0.05]], col);
    } else if (cls === 'bastion') {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.7, R * 0.7, R * 0.9, 6), M));
      for (const sy of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(sy > 0 ? R * 0.42 : R * 0.7, sy > 0 ? R * 0.7 : R * 0.42, R * 0.26, 6), D); cap.position.y = sy * R * 0.58; g.add(cap);
      }
      const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.725, R * 0.725, R * 0.07, 6, 1, true), glowMat(col, 3)); g.add(band);
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + Math.PI / 6, plate = new THREE.Mesh(new THREE.BoxGeometry(R * 0.55, R * 0.32, R * 0.09), D);
        for (const py of [-0.24, 0.24]) { const pl = plate.clone(); pl.position.set(Math.cos(a) * R * 0.66, py * R, Math.sin(a) * R * 0.66); pl.rotation.y = -a + Math.PI / 2; g.add(pl); }
      }
      for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; addTurret(g, Math.cos(a) * R * 0.32, R * 0.72, Math.sin(a) * R * 0.32, R * 0.2, D); }
      addLights(g, [[R * 0.7, 0, 0, R * 0.04], [-R * 0.7, 0, 0, R * 0.04], [0, R * 0.72, 0, R * 0.05]], col);
      const shield = new THREE.Mesh(new THREE.SphereGeometry(R * 1.3, 32, 20), fresnelMaterial(0xffd860, 2.4, 0.8, false)); g.add(shield);
    } else if (cls === 'super') {
      const hull = new THREE.Mesh(lathe(R * 2.0, R * 0.5, [[0, 0.55], [0.12, 0.85], [0.62, 0.8], [0.86, 0.5], [1, 0.12]], 6), M); g.add(hull);
      const spine = new THREE.Mesh(new THREE.BoxGeometry(R * 0.18, R * 0.25, R * 1.5), D); spine.position.set(0, R * 0.42, -R * 0.1); g.add(spine);
      for (const sx of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(R * 0.12, R * 0.5, R * 1.3), D); plate.position.set(sx * R * 0.45, -R * 0.02, -R * 0.05); plate.rotation.z = sx * 0.12; g.add(plate);
        addTurret(g, sx * R * 0.3, R * 0.33, R * 0.25, R * 0.16, D);
      }
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.07, R * 0.1, R * 1.2, 12), D); cannon.rotation.x = Math.PI / 2; cannon.position.set(0, R * 0.12, R * 1.15); g.add(cannon);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(R * 0.4, R * 0.06, R * 0.05), glowMat(col, 4)); visor.position.set(0, R * 0.25, R * 0.72); g.add(visor);
      for (const [x, y] of [[0, 0], [-R * 0.3, -R * 0.12], [R * 0.3, -R * 0.12]]) addEngine(g, x, y, -R * 1.02, R * 0.16, 0xff6070, 0.8);
      addLights(g, [[R * 0.5, 0, -R * 0.6, R * 0.03], [-R * 0.5, 0, -R * 0.6, R * 0.03]], col);
    } else if (cls === 'support') {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.5, 20, 14), M));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.78, R * 0.06, 8, 36), glowMat(col, 2.2)); ring.userData.spin = ['z', 1.5]; g.add(ring);
      for (const [w, h] of [[R * 0.42, R * 0.12], [R * 0.12, R * 0.42]]) { const c = new THREE.Mesh(new THREE.BoxGeometry(w, h, R * 0.05), glowMat(col, 3.5)); c.position.z = R * 0.5; g.add(c); }
      addEngine(g, 0, 0, -R * 0.55, R * 0.18, 0x60ffc0, 0.5);
    } else { // шахтёрский
      const body = new THREE.Mesh(new THREE.SphereGeometry(R * 0.55, 18, 12), M); body.scale.set(1, 0.85, 1.25); g.add(body);
      const drill = new THREE.Mesh(new THREE.ConeGeometry(R * 0.28, R * 0.85, 12), D); drill.rotation.x = Math.PI / 2; drill.position.z = R * 1.0; drill.userData.spin = ['y', 9]; g.add(drill);
      if (R > 8) for (const sx of [-1, 1]) { const bin = new THREE.Mesh(new THREE.BoxGeometry(R * 0.3, R * 0.4, R * 0.7), D); bin.position.set(sx * R * 0.6, -R * 0.1, -R * 0.1); g.add(bin); }
      eye(0, R * 0.3, R * 0.45, R * 0.12);
      addEngine(g, 0, 0, -R * 0.7, R * 0.2, 0x60c0ff, 0.6);
    }
    shipCache.set(key, g);
  }
  return shipCache.get(key).clone();
}

// внешний вид корабля игрока: второй цвет ливреи, цвет полос, цвет пламени двигателей, герб на корпусе
let LOOK = null;
const lookKey = (l) => l ? [l.second, l.accent, l.engine, l.emblem, l.emc].map(v => v == null ? '' : v).join('|') : '';
function addEmblem(g, R, ch, color) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const col = '#' + ((color == null ? 0xffffff : color) >>> 0).toString(16).padStart(6, '0');
  x.beginPath(); x.arc(64, 64, 56, 0, 7); x.fillStyle = 'rgba(10,14,20,0.55)'; x.fill(); x.lineWidth = 7; x.strokeStyle = col; x.stroke();
  x.fillStyle = col; x.font = '700 70px "Segoe UI Symbol", "Noto Sans Symbols 2", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ch, 64, 70);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.6, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -4, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 });
  mat.userData.owned = true;
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g), size = Math.min(R * 0.55, (box.max.x - box.min.x) * 0.4);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  top.rotation.x = -Math.PI / 2; top.position.set(0, box.max.y * 0.92 + R * 0.01, (box.min.z + box.max.z) / 2 - R * 0.15); top.renderOrder = 3; g.add(top);
  for (const sd of [1, -1]) { // и по бортам
    const side = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.7, size * 0.7), mat);
    side.rotation.y = sd * Math.PI / 2; side.position.set(sd * box.max.x * 0.9, 0, (box.min.z + box.max.z) / 2 - R * 0.2); side.renderOrder = 3; g.add(side);
  }
}
function shipModel(type, color, radius, faction, look) {
  if (type === 'archon') type = 'colossus'; // Архонт Края — та же машина Предтеч, крупнее
  const key = type + color + faction + lookKey(look);
  if (!shipCache.has(key)) { LOOK = look || null; try { shipCache.set(key, buildShip(type, color, faction)); } finally { LOOK = null; } }
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
    if (o.userData.smoke) { // клубы дыма поднимаются и расширяются
      const sm = o.userData.smoke, k = (time * 0.35 + sm.phase) % 1;
      o.position.y = sm.y0 + k * sm.rise; o.scale.setScalar(0.6 + k * 2.6);
    }
  });
}

// ======================================================================
// Астероиды
// ======================================================================
const astGeoCache = [];
function asteroidGeo(variant, detail = 24) {
  const ck = variant + ':' + detail;
  if (astGeoCache[ck]) return astGeoCache[ck];
  const n = makeNoise(variant * 977 + 13), n2 = makeNoise(variant * 31 + 7);
  let geo = new THREE.IcosahedronGeometry(1, detail);
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
    let h = 1 + 0.34 * fbm(n, v.x * 1.3, v.y * 1.3, v.z * 1.3, 5) + 0.07 * ridged(n2, v.x * 4, v.y * 4, v.z * 4, 3) + 0.018 * fbm(n2, v.x * 9, v.y * 9, v.z * 9, 3);
    for (const [c, rad, depth] of craters) {
      const d = v.distanceTo(c);
      if (d < rad) { const k = d / rad; h -= depth * (1 - k * k) - (k > 0.75 ? depth * 0.6 * (1 - Math.abs(k - 0.87) * 8) : 0); }
    }
    pos.setXYZ(i, v.x * h * stretch[0], v.y * h * stretch[1], v.z * h * stretch[2]);
    const shade = 0.62 + 0.25 * fbm(n2, v.x * 3, v.y * 3, v.z * 3, 3) + (h - 1) * 0.3;
    const vein = smooth(0.66, 0.74, ridged(n, v.x * 2.2 + 5, v.y * 2.2, v.z * 2.2, 3));
    colors.set([shade, shade, vein], i * 3); // b-канал временно хранит прожилки руды
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  astGeoCache[ck] = geo;
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
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * (0.74 + 0.36 * fbm3(vObjP * 6.0) + 0.12 * fbm3(vObjP * 31.0)), opacity );')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  { // градиент шума в пространстве объекта → возмущение нормали (без экранных производных)
    // два слоя: крупные бугры и мелкая «щебёнка» — камень не похож на гладкий пластилин
    vec3 q = vObjP * 7.0; float e = 0.03; float h0 = fbm3(q);
    vec3 g = vec3(fbm3(q + vec3(e, 0.0, 0.0)) - h0, fbm3(q + vec3(0.0, e, 0.0)) - h0, fbm3(q + vec3(0.0, 0.0, e)) - h0) / e;
    vec3 q2 = vObjP * 34.0; float h1 = fbm3(q2);
    vec3 g2 = vec3(fbm3(q2 + vec3(e, 0.0, 0.0)) - h1, fbm3(q2 + vec3(0.0, e, 0.0)) - h1, fbm3(q2 + vec3(0.0, 0.0, e)) - h1) / e;
    normal = normalize(normal - mat3(vNM0, vNM1, vNM2) * (g * 0.1 + g2 * 0.03)); }`);
  };
}

const ORE_LOOK = {
  // альбедо настоящего камня в космосе низкое (0,1–0,25): светлые астероиды на солнце выгорали в белые пятна
  ore_ferit: { rock: [0.11, 0.11, 0.115], vein: [0.3, 0.31, 0.34] },
  ore_korundit: { rock: [0.14, 0.1, 0.075], vein: [0.85, 0.42, 0.15] },
  ore_arkselit: { rock: [0.09, 0.1, 0.125], vein: [0.25, 0.65, 0.95] },
  ore_nullium: { rock: [0.085, 0.07, 0.1], vein: [0.7, 0.25, 0.95] },
  pbase_rock: { rock: [0.2, 0.17, 0.16], vein: [0.5, 0.2, 0.12] },
  rel_ioncrystal: { rock: [0.05, 0.065, 0.1], vein: [0.35, 0.95, 1.2] } // ионный шторм: тёмный камень с голубыми прожилками // скала пиратской базы
};
const astMatCache = new Map();
// Астероид с уровнями детализации (LOD): вблизи — плотная сетка, вдали — грубее; переходы на расстояниях,
// где разница меньше пикселя. Окраска вершин одна и та же функция от точки — смена уровня незаметна.
function asteroidModel(radius, seed, ore) {
  const variant = seed % 8;
  // detail у IcosahedronGeometry — число делений ребра: 24 → 12 500 треугольников вблизи (было 5 → 720, «комки»)
  const near = { low: 10, med: 16, high: 24, ultra: 36 }[texLevel] || 24;
  const levels = [[near, 0], [Math.max(6, near >> 2), 22], [3, 70]];
  const look = ORE_LOOK[ore] || ORE_LOOK.ore_ferit;
  const lod = new THREE.LOD();
  for (const [detail, d] of levels) {
    const key = ore + variant + ':' + detail;
    if (!astMatCache.has(key)) {
      const geo = asteroidGeo(variant, detail).clone();
      const c = geo.attributes.color;
      for (let i = 0; i < c.count; i++) {
        const s0 = c.getX(i), vein = c.getZ(i);
        c.setXYZ(i, lerp(look.rock[0] * s0, look.vein[0], vein), lerp(look.rock[1] * s0, look.vein[1], vein), lerp(look.rock[2] * s0, look.vein[2], vein));
      }
      let mat = astMatCache.get('mat:' + ore);
      if (!mat) { mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.08, flatShading: false, envMapIntensity: 0.4 }); rockDetail(mat); astMatCache.set('mat:' + ore, mat); }
      astMatCache.set(key, { geo, mat });
    }
    const { geo, mat } = astMatCache.get(key);
    lod.addLevel(new THREE.Mesh(geo, mat), d * radius * distK());
  }
  const r = seeded(seed);
  lod.rotation.set(r() * 6, r() * 6, r() * 6);
  lod.scale.setScalar(radius);
  lod.userData.spin = (r() - 0.5) * 0.04;
  return lod;
}

// ======================================================================
// Станции и врата
// ======================================================================
function stationModel(style) {
  if (style === 4) return solarStationModel();
  if (style === 5) return hubStationModel();
  if (style === 6) return defenseStationModel();
  const T = sharedTextures();
  const g = new THREE.Group();
  const tint = [0xb8c0c8, 0xc8b8a0, 0xa8b8a8, 0xc89060][style || 0];
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
  if (style === 3) {
    // завод игрока: резервуары с рудой, трубы и светящиеся плавильни
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(380, 380, 1500, 20), pbrMat(0x8a6a48, 'dark'));
      tank.position.set(Math.cos(a) * 3300, -700, Math.sin(a) * 3300); g.add(tank);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(390, 40, 6, 24), glowMat(0xff8030, 2.2));
      ring.rotation.x = Math.PI / 2; ring.position.set(Math.cos(a) * 3300, -300, Math.sin(a) * 3300); g.add(ring);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 1400, 8), D);
      pipe.rotation.z = Math.PI / 2; pipe.rotation.y = -a; pipe.position.set(Math.cos(a) * 2600, -700, Math.sin(a) * 2600); g.add(pipe);
    }
    const furnace = new THREE.Mesh(new THREE.SphereGeometry(650, 24, 16), glowMat(0xff6020, 1.6));
    furnace.position.y = -2300; g.add(furnace);
  }
  applyBoxUV(g, 450, false);
  g.userData.spinY = 0.012;
  return g;
}

// Солнечная электростанция игрока: ядро-накопитель, длинные фермы с огромными крыльями панелей,
// параболический коллектор и светящиеся банки энергоячеек
function solarStationModel() {
  const T = sharedTextures(), g = new THREE.Group();
  const M = pbrMat(0xb8c4d0, 'station'), D = darkMetal();
  const panel = new THREE.MeshStandardMaterial({ map: T.solar, metalness: 0.9, roughness: 0.22, color: 0x7f9cd8, emissive: 0x0a1a40, emissiveIntensity: 0.6 });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(700, 700, 2600, 24), M); g.add(core);
  for (const y of [1500, -1500]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(700, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M); cap.position.y = y; if (y < 0) cap.rotation.x = Math.PI; g.add(cap); }
  // банки энергоячеек — светящиеся кольца
  for (const y of [-800, -300, 200, 700]) { const r = new THREE.Mesh(new THREE.TorusGeometry(760, 70, 8, 40), glowMat(0x40e0ff, 2.6)); r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r); }
  // фермы и крылья панелей, медленно поворачиваются к звезде
  const wings = new THREE.Group();
  for (const sd of [1, -1]) {
    const truss = new THREE.Mesh(new THREE.BoxGeometry(9000, 120, 120), D); truss.position.x = sd * 5200; wings.add(truss);
    for (let k = 0; k < 5; k++) for (const z of [1, -1]) {
      const pnl = new THREE.Mesh(new THREE.BoxGeometry(1500, 30, 2300), panel);
      pnl.position.set(sd * (1500 + k * 1700), 0, z * 1300); wings.add(pnl);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1520, 50, 40), D); frame.position.set(sd * (1500 + k * 1700), 0, z * 2450); wings.add(frame);
    }
  }
  wings.userData.spin = ['x', 0.05];
  g.add(wings);
  // параболический коллектор сверху
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 12, 0, Math.PI * 2, 0, 0.7), M); dish.position.y = 3000; dish.rotation.x = Math.PI; g.add(dish);
  const focus = new THREE.Mesh(new THREE.SphereGeometry(180, 16, 12), glowMat(0xfff0a0, 4)); focus.position.y = 3600; g.add(focus);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 900, 6), D); mast.position.y = 3150; g.add(mast);
  const dock = new THREE.Mesh(new THREE.TorusGeometry(520, 40, 8, 40), glowMat(0x60c8ff, 2.5)); dock.rotation.x = Math.PI / 2; dock.position.y = -2300; g.add(dock);
  addLights(g, [[9700, 0, 0, 60], [-9700, 0, 0, 60], [0, 3700, 0, 70], [0, -2300, 0, 60]], 0xff4030);
  greebles(g, 1600, 60, D, [1200, 2400, 1200]);
  applyBoxUV(g, 450, false);
  g.userData.spinY = 0.004;
  return g;
}

// Транспортный хаб: большое стыковочное кольцо, причальные стрелы с огнями и штабели контейнеров
function hubStationModel() {
  const T = sharedTextures(), g = new THREE.Group();
  const M = pbrMat(0xc0b8a8, 'station'), D = darkMetal();
  const winMat = new THREE.MeshStandardMaterial({ color: 0xc0b8a8, map: T.hull, metalness: 0.6, roughness: 0.5, emissive: 0xffffff, emissiveMap: T.windows, emissiveIntensity: 2 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3600, 260, 16, 120), M); ring.rotation.x = Math.PI / 2; g.add(ring);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(3600, 300, 8, 120, Math.PI * 2), winMat); inner.rotation.x = Math.PI / 2; inner.scale.set(0.93, 0.93, 0.5); g.add(inner);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(900, 1100, 2200, 8), M); g.add(core);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(300, 500, 2400, 8), M); tower.position.y = 2200; g.add(tower);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(160, 12, 8), glowMat(0xffc040, 4)); beacon.position.y = 3500; g.add(beacon);
  const cols = [0x8a3a2a, 0x3a5a7a, 0x9a8a50, 0x5a6a5a, 0xa06030, 0x5a4a7a];
  const r = seeded(77);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    // спица к кольцу
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(2600, 160, 160), D); spoke.position.set(Math.cos(a) * 2300, 0, Math.sin(a) * 2300); spoke.rotation.y = -a; g.add(spoke);
    // причальная стрела наружу с огнями
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1800, 90, 260), M); arm.position.set(Math.cos(a) * 4700, 0, Math.sin(a) * 4700); arm.rotation.y = -a; g.add(arm);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(70, 8, 6), glowMat(i % 2 ? 0x50ff90 : 0xff5040, 4)); lamp.position.set(Math.cos(a) * 5600, 0, Math.sin(a) * 5600); g.add(lamp);
    // штабели контейнеров на кольце
    for (let k = 0; k < 6; k++) {
      const c = new THREE.Mesh(rbox(380, 300, 700), new THREE.MeshStandardMaterial({ color: cols[Math.floor(r() * cols.length)], map: T.hull, metalness: 0.4, roughness: 0.7 }));
      const aa = a + 0.18 + (k % 3) * 0.1;
      c.position.set(Math.cos(aa) * 3600, 380 + Math.floor(k / 3) * 320, Math.sin(aa) * 3600); c.rotation.y = -aa; g.add(c);
    }
  }
  const dock = new THREE.Mesh(new THREE.TorusGeometry(700, 50, 8, 48), glowMat(0xffb040, 2.4)); dock.rotation.x = Math.PI / 2; dock.position.y = -1200; g.add(dock);
  greebles(g, 2400, 80, D, [1600, 900, 1600]);
  applyBoxUV(g, 450, false);
  g.userData.spinY = 0.01;
  return g;
}

// Оборонная платформа: бронированный диск, четыре орудийные башни, купол ПРО и прожекторы
function defenseStationModel() {
  const g = new THREE.Group(), M = pbrMat(0x7a8490, 'station'), D = darkMetal();
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(2200, 2600, 700, 8), M); g.add(disk);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1400, 2000, 400, 8), M); top.position.y = 550; g.add(top);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(700, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x60c8ff, transparent: true, opacity: 0.35, emissive: 0x2080c0, emissiveIntensity: 0.8 }));
  dome.position.y = 750; g.add(dome);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(300, 380, 600, 10), M); tw.position.set(Math.cos(a) * 1900, 600, Math.sin(a) * 1900); g.add(tw);
    addTurret(g, Math.cos(a) * 1900, 950, Math.sin(a) * 1900, 380, D);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2650, 60, 8, 64), glowMat(0x60c0ff, 2)); ring.rotation.x = Math.PI / 2; g.add(ring);
  addLights(g, Array.from({ length: 8 }, (_, i) => [Math.cos(i / 8 * Math.PI * 2) * 2700, 0, Math.sin(i / 8 * Math.PI * 2) * 2700, 50]), 0xff4030);
  greebles(g, 2400, 60, D, [2600, 300, 2600]);
  applyBoxUV(g, 450, false);
  g.userData.spinY = 0.006;
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
  applyBoxUV(g, 450, false);
  g.add(disk);
  return g;
}

// Червоточина: вихрь фиолетового света без конструкций, по краю — тонкое кольцо искажения
function wormholeModel() {
  const g = new THREE.Group();
  const disk = new THREE.Mesh(new THREE.CircleGeometry(2400, 96), logShader({
    uniforms: { time: GU.time },
    vertex: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); /*LOGDEPTH*/ }`,
    fragment: `uniform float time; varying vec2 vUv;
      void main(){ /*LOGDEPTH*/ vec2 p = vUv * 2.0 - 1.0; float r = length(p); float a = atan(p.y, p.x);
        float sw = fbm3(vec3(cos(a * 2.0 + r * 7.0 - time * 0.9) * 2.0, sin(a * 2.0 + r * 7.0 - time * 0.9) * 2.0, r * 4.0 - time * 0.4));
        float edge = smoothstep(1.0, 0.7, r), core = smoothstep(0.35, 0.0, r);
        vec3 col = mix(vec3(0.35, 0.05, 0.8), vec3(1.0, 0.45, 1.0), sw) * (0.2 + 1.1 * pow(sw, 2.0)) * edge;
        col = mix(col, vec3(0.02, 0.0, 0.05), core * 0.9) + vec3(0.8, 0.5, 1.0) * pow(r, 8.0) * edge * 2.0;
        gl_FragColor = vec4(col, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  }));
  g.add(disk);
  g.add(new THREE.Mesh(new THREE.TorusGeometry(2420, 24, 8, 128), glowMat(0xc070ff, 3)));
  return g;
}

// Ракета: корпус, стабилизаторы, светящийся факел двигателя; торпеда крупнее
function missileModel(color, torp) {
  const key = 'missile:' + color + ':' + (torp ? 1 : 0);
  if (!shipCache.has(key)) {
    const g = new THREE.Group(), R = torp ? 14 : 7;
    const M = pbrMat(0x9aa0a8, 'dark');
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.35, R * 0.35, R * 3, 10), M); body.rotation.x = Math.PI / 2; g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(R * 0.35, R * 0.9, 10), glowMat(color, 1.5)); nose.rotation.x = Math.PI / 2; nose.position.z = R * 1.9; g.add(nose);
    for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(R * 0.06, R * 0.9, R * 0.6), darkMetal()); f.rotation.z = i * Math.PI / 2; f.translateY(R * 0.45); f.position.z = -R * 1.2; g.add(f); }
    addEngine(g, 0, 0, -R * 1.6, R * 0.3, color, 1.6);
    shipCache.set(key, g);
  }
  return shipCache.get(key).clone();
}
// Развёртываемая турель: опорная платформа, вращающаяся башня со спаренными стволами, огни
function turretModel() {
  const key = 'turret';
  if (!shipCache.has(key)) {
    const g = new THREE.Group(), R = 45;
    const M = pbrMat(0x6a7480, 'player'), D = darkMetal();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.9, R * 1.1, R * 0.5, 8), M); g.add(base);
    for (let i = 0; i < 3; i++) { const leg = new THREE.Mesh(new THREE.BoxGeometry(R * 0.15, R * 0.15, R * 1.6), D); leg.rotation.y = i * Math.PI * 2 / 3; leg.translateZ(R * 0.9); leg.position.y = -R * 0.2; g.add(leg); }
    const head = new THREE.Group();
    head.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.55, 16, 10), M));
    for (const sd of [1, -1]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.08, R * 0.1, R * 1.6, 8), D); b.rotation.x = Math.PI / 2; b.position.set(sd * R * 0.22, 0, R * 0.9); head.add(b); }
    head.position.y = R * 0.6; g.add(head); g.userData.head = head;
    addLights(g, [[R, 0, 0, R * 0.08], [-R, 0, 0, R * 0.08]], 0x60d0ff);
    shipCache.set(key, g);
  }
  const o = shipCache.get(key).clone();
  o.userData.head = o.children.find(c => c.type === 'Group');
  return o;
}

function wreckModel(radius) {
  const g = new THREE.Group();
  const D = darkMetal();
  const burnt = new THREE.MeshStandardMaterial({ color: 0x302820, map: sharedTextures().hull, metalness: 0.6, roughness: 0.85 });
  g.userData.owned = true; burnt.userData.owned = true; // свои геометрии и материалы — освобождаются при удалении обломка
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(radius * (0.2 + Math.random() * 0.8), radius * (0.05 + Math.random() * 0.2), radius * (0.15 + Math.random() * 0.6)), i % 2 ? D : burnt);
    b.position.set((Math.random() - 0.5) * radius * 1.5, (Math.random() - 0.5) * radius * 0.6, (Math.random() - 0.5) * radius * 1.5);
    b.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); g.add(b);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sharedTextures().glow, color: new THREE.Color(0xff7020).multiplyScalar(2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
  s.material.userData.owned = true;
  s.scale.setScalar(radius * 1.2); g.add(s); g.userData.flicker = s;
  return g;
}

// ======================================================================
// Небесные тела
// ======================================================================
// Объекты аномалий Предтеч: хранилище (монолит в кристаллической оправе, вращающиеся кольца; запечатано — фиолетовое
// свечение, вскрыто — золотое) и тайник с артефактом (золотой ларец с кристаллом)
function relicModel(kind, r) {
  const key = 'relic:' + kind;
  if (!shipCache.has(key)) {
    const g = new THREE.Group(), R = kind === 'cache' ? 60 : 160, open = kind !== 'vault';
    const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
    if (kind === 'cache') {
      add(rbox(R * 0.9, R * 0.55, R * 0.6), goldMat());
      add(rbox(R * 0.95, R * 0.12, R * 0.65), chromeMat(), 0, R * 0.3, 0);
      add(new THREE.OctahedronGeometry(R * 0.22), crystalMat(), 0, R * 0.62, 0).userData.spin = ['y', 1.2];
    } else {
      add(new THREE.OctahedronGeometry(R * 0.6), chromeMat(), 0, 0, 0).scale.set(0.8, 1.7, 0.8);
      for (const k of [-1, 1]) add(new THREE.OctahedronGeometry(R * 0.2), crystalMat(), 0, k * R * 1.25, 0).scale.set(0.5, 1.4, 0.5);
      for (const [rr, ax, sp] of [[0.95, 'y', 0.3], [1.15, 'x', -0.2], [1.3, 'z', 0.15]]) {
        const ring = add(new THREE.TorusGeometry(R * rr, R * 0.03, 10, 96), open ? goldMat() : chromeMat());
        ring.rotation.x = Math.PI / 2; ring.userData.spin = [ax, sp];
      }
      add(new THREE.TorusGeometry(R * 0.62, R * 0.012, 8, 96), glowMat(open ? 0xffd890 : 0xb47cff, 2.5)).rotation.x = Math.PI / 2;
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sharedTextures().glow, color: new THREE.Color(open ? 0xffd080 : 0xa070ff).multiplyScalar(1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    glow.scale.setScalar(R * (kind === 'cache' ? 3 : 4)); glow.userData.relicGlow = true; g.add(glow);
    shipCache.set(key, g);
  }
  const o = shipCache.get(key).clone();
  o.scale.setScalar(r / (kind === 'cache' ? 60 : 160) * (kind === 'cache' ? 1 : 0.8));
  o.traverse(c => { if (c.userData.relicGlow) o.userData.flicker = c; });
  return o;
}

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
uniform int ptype; uniform float seed; uniform vec3 sunDir; uniform vec3 tint; uniform vec3 sunDir2; uniform vec3 sunCol2;
varying vec3 vP; varying vec3 vWN;
float ridge(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * (1.0 - abs(vnoise(p) * 2.0 - 1.0)); p *= 2.1; a *= 0.5; } return s; }
float fbm8(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 9; i++) { s += a * vnoise(p); p = p * 2.02 + 0.37; a *= 0.5; } return s; }
float fbm6(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = p * 2.02 + 0.37; a *= 0.5; } return s; }
varying mat3 vRot;
vec3 chash(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
// Кратер: в ячейке сетки не больше одного и целиком внутри неё — проверяем только свою ячейку.
// Возвращает градиент высоты (xyz) и высоту (w); производная профиля аналитическая — без лишних выборок.
vec4 crater(vec3 p, float f, float amp){
  vec3 c = floor(p * f); vec3 r = chash(c + seed * 0.37);
  if (r.x > 0.6) return vec4(0.0);
  vec3 ctr = (c + 0.3 + r * 0.4) / f; float R = (0.06 + r.y * 0.11) / f;
  vec3 d = p - ctr; float dist = max(length(d), 1e-5); float k = dist / R;
  if (k > 1.7) return vec4(0.0);
  float bowl = k < 1.0 ? k * k - 1.0 : 0.0, dbowl = k < 1.0 ? 2.0 * k : 0.0;
  float t = (k - 1.0) / 0.24, rim = 0.32 * exp(-t * t), drim = rim * (-2.0 * t / 0.24);
  return vec4(amp * (dbowl + drim) * d / dist, amp * R * (bowl + rim));
}
void main(){
  /*LOGDEPTH*/
  vec3 p = normalize(vP);
  vec3 q = p * 2.2 + seed;
  vec3 col; vec3 em = vec3(0.0);
  vec3 warp = fbm3(q * 0.8) * 0.6 * vec3(1.0);
  float h = fbm8(q + warp);
  // рельеф для освещения: градиент высоты по трём соседним выборкам (горы, хребты) + кратеры
  float bumpK = ptype == 0 ? 1.0 : ptype == 5 ? 0.6 : ptype == 3 ? 0.8 : ptype == 2 ? 0.45 : ptype == 4 ? 0.7 : 0.0;
  vec3 grad = vec3(0.0); float crH = 0.0;
  if (bumpK > 0.0) {
    float e = 0.004, h0 = fbm6(q + warp);
    grad = vec3(fbm6(q + warp + vec3(e, 0.0, 0.0)) - h0, fbm6(q + warp + vec3(0.0, e, 0.0)) - h0, fbm6(q + warp + vec3(0.0, 0.0, e)) - h0) / e * 2.2 * 0.05;
    if (ptype == 0 || ptype == 2 || ptype == 5) {
      vec4 c1 = crater(p, 7.0, 1.0), c2 = crater(p, 19.0, 1.0), c3 = crater(p, 53.0, 1.0);
      float ck = ptype == 0 ? 1.0 : 0.45;
      grad += (c1.xyz * 0.22 + c2.xyz * 0.18 + c3.xyz * 0.14) * ck; crH = (c1.w * 7.0 + c2.w * 19.0 + c3.w * 53.0) * ck;
    }
  }
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
    col = mix(vec3(0.12, 0.115, 0.11), vec3(0.32, 0.305, 0.285), smoothstep(0.3, 0.7, h));
    col = mix(col, vec3(0.42, 0.4, 0.38), smoothstep(0.7, 0.85, r) * 0.45);
    col *= 1.0 + clamp(crH * 0.6, -0.25, 0.2);
  }
  col *= tint;
  vec3 n = normalize(vWN);
  float d = dot(n, sunDir);
  // нормаль с рельефом: градиент высоты проецируем на касательную плоскость и поворачиваем в мир
  vec3 gt = grad - p * dot(grad, p);
  if (ptype == 4) gt *= smoothstep(0.52, 0.56, h); // море гладкое
  vec3 nb = normalize(vRot * normalize(p - gt * bumpK));
  // свет по рельефу, но ночная сторона остаётся тёмной (терминатор — по геометрической нормали)
  float light = clamp(dot(nb, sunDir) * 1.05, 0.0, 1.0) * smoothstep(-0.08, 0.12, d);
  float light2 = clamp(dot(nb, sunDir2) * 1.05, 0.0, 1.0) * smoothstep(-0.08, 0.12, dot(n, sunDir2)); // вторая звезда двойной системы
  float spec = (ptype == 4) ? pow(max(0.0, d), 30.0) * (1.0 - smoothstep(0.52, 0.535, h)) * 0.4 : 0.0;
  float dn = max(d, length(sunCol2) > 0.05 ? dot(n, sunDir2) : -1.0); // ночь — где не светит ни одна звезда
  vec3 c = col * (light * 1.15 + sunCol2 * light2 * 1.15) + vec3(1.0, 0.95, 0.85) * spec + col * 0.012 + em * (1.0 - smoothstep(-0.15, 0.15, dn));
  gl_FragColor = vec4(c, 1.0);
}`;

const CLOUD_FRAG = `
uniform float seed; uniform vec3 sunDir; uniform float time; uniform float amount; uniform vec3 sunDir2; uniform vec3 sunCol2;
varying vec3 vP; varying vec3 vWN;
void main(){
  /*LOGDEPTH*/
  vec3 p = normalize(vP);
  vec3 q = p * 3.0 + seed + vec3(time * 0.004, 0.0, 0.0);
  float w = fbm3(q * 0.7);
  float c = smoothstep(0.5 - amount * 0.1, 0.78, fbm3(q + w * 1.2) * 0.7 + fbm3(q * 4.0) * 0.3);
  float d = dot(normalize(vWN), sunDir);
  float light = clamp(d * 1.2 + 0.1, 0.0, 1.0);
  float light2 = clamp(dot(normalize(vWN), sunDir2) * 1.2 + 0.1, 0.0, 1.0);
  gl_FragColor = vec4(vec3(1.0, 0.98, 0.95) * light * 1.2 + sunCol2 * light2 * 1.2, c * 0.85 * amount);
}`;

const PLANET_VERT = `varying vec3 vP; varying vec3 vWN; varying mat3 vRot;
  void main(){ vP = position; vWN = normalize(mat3(modelMatrix) * normal);
    vRot = mat3(normalize(modelMatrix[0].xyz), normalize(modelMatrix[1].xyz), normalize(modelMatrix[2].xyz)); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); /*LOGDEPTH*/ }`;

function planetModel(c) {
  const g = new THREE.Group();
  const look = PLANET_LOOK[c.ptype] || PLANET_LOOK['Каменистая'];
  const seed = c.hue * 100;
  const r = seeded(Math.floor(c.hue * 1e6) + 3);
  const sunDir = { value: new THREE.Vector3(1, 0, 0) };
  const sunDir2 = { value: new THREE.Vector3(0, 1, 0) }, sunCol2 = { value: new THREE.Vector3(0, 0, 0) };
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), logShader({
    uniforms: { ptype: { value: PTYPE_ID[c.ptype] || 0 }, seed: { value: seed }, sunDir, sunDir2, sunCol2,
      tint: { value: new THREE.Vector3(0.9 + r() * 0.2, 0.9 + r() * 0.2, 0.9 + r() * 0.2) } },
    vertex: PLANET_VERT, fragment: PLANET_FRAG
  }));
  g.add(body);
  const cloudy = { 'Океаническая': 1, 'Каменистая': 0.45, 'Ледяная': 0.4 }[c.ptype];
  let clouds = null;
  if (cloudy) {
    clouds = new THREE.Mesh(new THREE.SphereGeometry(1.01, 128, 64), logShader({
      uniforms: { seed: { value: seed + 17 }, sunDir, sunDir2, sunCol2, time: GU.time, amount: { value: cloudy } },
      vertex: PLANET_VERT, fragment: CLOUD_FRAG, transparent: true, depthWrite: false
    }));
    g.add(clouds);
  }
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.02, 96, 48), fresnelMaterial(look.atmo, 4.5, look.atmoK * 1.3, true));
  atmo.material.uniforms.sunDir = sunDir;
  atmo.material.uniforms.sunset.value = c.ptype === 'Газовый гигант' || c.ptype === 'Лавовая' ? 0.4 : 1;
  g.add(atmo);
  // кольца: у газовых гигантов часто, у ледяных иногда; в кольцах видна тень планеты
  const ringChance = c.ptype === 'Газовый гигант' ? 0.7 : c.ptype === 'Ледяная' ? 0.25 : 0;
  let ring = null;
  if (r() < ringChance) {
    const inner = 1.35 + r() * 0.2, outer = inner + 0.7 + r() * 0.9;
    const rc = c.ptype === 'Ледяная' ? [0.75, 0.85, 0.95] : [0.85, 0.74, 0.58];
    ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 192, 1), logShader({
      uniforms: { sunDir, sunDir2, sunCol2, inner: { value: inner }, outer: { value: outer }, seed: { value: seed }, rcol: { value: new THREE.Vector3(...rc) } },
      vertex: `varying vec3 vL; varying vec3 vW; varying vec3 vC; varying float vR;
        void main(){ vL = position; vW = (modelMatrix * vec4(position, 1.0)).xyz; vC = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vR = length(modelMatrix[0].xyz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); /*LOGDEPTH*/ }`,
      fragment: `uniform vec3 sunDir; uniform vec3 sunDir2; uniform vec3 sunCol2; uniform float inner, outer, seed; uniform vec3 rcol;
        varying vec3 vL; varying vec3 vW; varying vec3 vC; varying float vR;
        void main(){ /*LOGDEPTH*/
          float rr = length(vL.xy), t = (rr - inner) / (outer - inner);
          float bands = vnoise(vec3(rr * 38.0, seed, 0.0)) * 0.6 + vnoise(vec3(rr * 130.0, seed * 2.0, 1.0)) * 0.4;
          float gap = smoothstep(0.02, 0.05, abs(t - 0.62)) * smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.9, t);
          float a = clamp(bands * 1.2 - 0.15, 0.0, 1.0) * gap * 0.85;
          // тень планеты на кольцах: луч к звезде пересекает шар планеты
          vec3 toC = vC - vW; float tt = dot(toC, sunDir); float dd = length(toC - sunDir * tt);
          float shadow = (tt > 0.0 && dd < vR) ? 0.08 : 1.0;
          vec3 c = rcol * (0.35 + 0.9 * bands) * (shadow * 1.1 + sunCol2 * 0.8) + vec3(0.02);
          gl_FragColor = vec4(c * 1.2, a); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide
    }));
    ring.rotation.x = Math.PI / 2 + (r() - 0.5) * 0.3;
    g.add(ring);
  }
  g.userData = { unit: true, body, clouds, atmo, sunDir, sunDir2, sunCol2, ring };
  g.rotation.z = 0.2 + c.hue * 0.3;
  return g;
}

// Чёрная дыра: тёмный горизонт событий, вращающийся аккреционный диск, светящееся кольцо фотонов
function blackHoleModel() {
  const g = new THREE.Group();
  const T = sharedTextures();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshBasicMaterial({ color: 0x000000 })));
  const ring = new THREE.Mesh(new THREE.SphereGeometry(1.06, 64, 32), fresnelMaterial(0xffc890, 6, 3, false));
  g.add(ring);
  const disk = new THREE.Mesh(new THREE.RingGeometry(1.4, 6, 128, 4), logShader({
    uniforms: { time: GU.time },
    vertex: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); /*LOGDEPTH*/ }`,
    fragment: `uniform float time; varying vec2 vP;
      void main(){ /*LOGDEPTH*/ float r = length(vP); float a = atan(vP.y, vP.x);
        float sw = fbm3(vec3(cos(a - time * 0.25 + r * 1.5) * 2.0, sin(a - time * 0.25 + r * 1.5) * 2.0, r * 1.2));
        float k = smoothstep(6.0, 1.6, r) * smoothstep(1.4, 1.7, r);
        vec3 hot = mix(vec3(4.0, 2.4, 1.2), vec3(1.6, 0.6, 2.6), smoothstep(1.6, 5.0, r));
        gl_FragColor = vec4(hot * k * (0.3 + 1.2 * sw * sw), 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  }));
  disk.rotation.x = Math.PI / 2 - 0.25;
  g.add(disk);
  // «линзированная» часть диска над и под тенью
  const halo = disk.clone(); halo.rotation.x = 0.15; halo.scale.setScalar(0.6); g.add(halo);
  for (const [s, c, k] of [[9, 0xd0a0ff, 0.35], [26, 0x8040ff, 0.12]]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: new THREE.Color(c).multiplyScalar(k), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
    sp.scale.setScalar(s); g.add(sp);
  }
  g.userData.unit = true;
  g.userData.spinY = 0.02;
  return g;
}

// Облик звёзд: цвета поверхности (тёмные пятна → яркие), корона, свет на сцене
const STAR_LOOK = {
  yellow: { a: [4.0, 1.6, 0.5], b: [6.0, 4.5, 2.6], corona: 0xffb060, glow: [0xffe0b0, 0xffa050, 0xff8040], light: 0xfff1dc, power: 3.2 },
  white:  { a: [2.4, 2.5, 3.0], b: [3.6, 3.7, 4.2], corona: 0xd0e0ff, glow: [0xb0c0e0, 0x8098d0, 0x6070c0], light: 0xeef4ff, power: 3.0, k: 0.6 },
  blue:   { a: [0.6, 1.2, 3.2], b: [1.6, 2.6, 4.6], corona: 0x6aa0ff, glow: [0x6080d0, 0x4060c0, 0x3040b0], light: 0xbcd4ff, power: 3.6, k: 0.55 },
  orange: { a: [3.2, 0.8, 0.12], b: [4.4, 2.0, 0.6], corona: 0xff8a40, glow: [0xd08850, 0xc06030, 0xa04018], light: 0xffd2a0, power: 3.0, k: 0.7 },
  red:    { a: [3.0, 0.4, 0.1], b: [5.0, 1.6, 0.6], corona: 0xff4a30, glow: [0xff9070, 0xff4030, 0xc02020], light: 0xff9c78, power: 2.5 },
  blackhole: { light: 0xc8a0ff, power: 1.6 }
};

function sunModel(star = 'yellow') {
  const L = STAR_LOOK[star] || STAR_LOOK.yellow;
  const g = new THREE.Group();
  const T = sharedTextures();
  const surface = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), logShader({
    uniforms: { time: GU.time },
    vertex: `varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; /*LOGDEPTH*/ }`,
    fragment: `uniform float time; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){ /*LOGDEPTH*/ float n = fbm3(vP * 6.0 + vec3(time * 0.05)); float n2 = fbm3(vP * 22.0 - vec3(time * 0.1));
        float limb = pow(max(dot(vN, vV), 0.0), 0.45);
        vec3 col = mix(vec3(${L.a.join(',')}), vec3(${L.b.join(',')}), n * 0.7 + n2 * 0.5) * (0.55 + 0.45 * limb);
        gl_FragColor = vec4(col, 1.0); }`
  }));
  g.add(surface);
  const corona = new THREE.Mesh(new THREE.SphereGeometry(1.15, 64, 32), fresnelMaterial(L.corona, 1.6, 2.5, false));
  g.add(corona);
  // корона с протуберанцами и лучами: плоскость, всегда повёрнутая к камере (размер — 7 радиусов звезды)
  const crown = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), logShader({
    uniforms: { time: GU.time, col: { value: new THREE.Color(L.corona) }, seed: { value: Math.random() * 100 } },
    vertex: `varying vec2 vQ; void main(){ vQ = position.xy * 7.0; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float s = length(modelMatrix[0].xyz); mv.xy += position.xy * 7.0 * s; gl_Position = projectionMatrix * mv; /*LOGDEPTH*/ }`,
    fragment: `uniform float time, seed; uniform vec3 col; varying vec2 vQ;
      void main(){ /*LOGDEPTH*/
        float r = length(vQ); if (r < 0.97) discard;
        float a = atan(vQ.y, vQ.x);
        float n = fbm3(vec3(cos(a) * 2.5 + seed, sin(a) * 2.5, r * 0.35 - time * 0.06));
        float streak = pow(fbm3(vec3(cos(a) * 9.0, sin(a) * 9.0, seed + time * 0.03)), 3.0) * 4.0;
        float fall = exp(-(r - 1.0) * (3.4 - streak * 1.5)) * smoothstep(7.0, 4.0, r);
        float glow = fall * (0.5 + n * 0.9 + streak);
        gl_FragColor = vec4(col * glow * 0.85, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
  }));
  crown.frustumCulled = false;
  g.add(crown);
  for (const [s, c, k0] of [[5, L.glow[0], 1.6], [14, L.glow[1], 0.7], [40, L.glow[2], 0.25]]) {
    const k = k0 * (L.k || 1);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: new THREE.Color(c).multiplyScalar(k), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
    sp.scale.setScalar(s); g.add(sp);
  }
  g.userData.unit = true;
  return g;
}

// ======================================================================
// Инициализация
// ======================================================================
let contextLost = false, onLost = null, onRestored = null;
export function onContext(lost, restored) { onLost = lost; onRestored = restored; }
export function isContextLost() { return contextLost; }
export function init(canvas) {
  // сглаживание делает композитор (MSAA в его буферах, SMAA/FXAA проходами): MSAA холста при этом
  // только тратил бы видеопамять — на 4K это сотни мегабайт
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  // без синхронной проверки журнала шейдеров: она заставляет ждать конца компиляции каждой программы (≈1,4 с подвисания при входе); для отладки — ?shaders
  renderer.debug.checkShaderErrors = /[?&]shaders/.test(location.search);
  renderer.info.autoReset = false;
  renderer.setPixelRatio(pixelRatio());
  // нейтральная тональная кривая (Khronos PBR Neutral): цвета красок остаются своими, а яркие места
  // мягко сжимаются, а не выгорают в белое, как у ACES (синий корпус не уходит в фиолетовый)
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = SPACE_EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  pmrem = new THREE.PMREMGenerator(renderer);
  sharedTextures();
  camera = new THREE.PerspectiveCamera(60, 1, 1, 5e9);
  ambient = new THREE.AmbientLight(0x8090b0, 0.42);
  // небо и «земля» космоса: мягкая подсветка сверху холодным, снизу тёплым — корабль читается с любой стороны
  scene.add(new THREE.HemisphereLight(0xa8bcff, 0x3a3026, 0.45));
  scene.add(ambient);
  scene.environmentIntensity = 0.95;
  sunLight = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.02;
  // слабый холодный контровой свет с теневой стороны, чтобы силуэты читались
  rimLight = new THREE.DirectionalLight(0x7090ff, 1.1);
  scene.add(rimLight);
  // вторая звезда двойной системы: свой цвет света, без теней
  sunLight2 = new THREE.DirectionalLight(0xffffff, 0);
  scene.add(sunLight2, sunLight2.target);
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

  // сглаживание MSAA прямо в буфере постобработки (иначе после постэффектов края «лесенкой»)
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 0 }));
  composer.addPass(new RenderPass(scene, camera));
  // звёзды в кадре: «божественные» лучи (радиальное размытие ярких пикселей — силуэты кораблей режут свет),
  // ореол с анаморфной полосой и блики объектива; видимость звезды проверяется по яркости её центра на экране
  godRays = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, l0: { value: new THREE.Vector3() }, l1: { value: new THREE.Vector3() },
      c0: { value: new THREE.Color() }, c1: { value: new THREE.Color() }, aspect: { value: 1 }, rays: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 l0, l1; uniform vec3 c0, c1; uniform float aspect, rays; varying vec2 vUv;
      float lum(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }
      float vis(vec2 p){ vec2 e = vec2(0.003 / aspect, 0.003);
        float v = lum(texture2D(tDiffuse, p).rgb) + lum(texture2D(tDiffuse, p + e).rgb) + lum(texture2D(tDiffuse, p - e).rgb)
          + lum(texture2D(tDiffuse, p + vec2(e.x, -e.y)).rgb) + lum(texture2D(tDiffuse, p - vec2(e.x, -e.y)).rgb);
        float edge = min(min(p.x, p.y), min(1.0 - p.x, 1.0 - p.y));
        return smoothstep(2.5, 7.0, v) * smoothstep(0.0, 0.03, edge); }
      float disc(vec2 p, float r){ return smoothstep(r, r * 0.55, length(p)); }
      float ring(vec2 p, float r){ return smoothstep(r * 0.14, 0.0, abs(length(p) - r)); }
      vec3 star(vec3 L, vec3 col){
        if (L.z <= 0.001) return vec3(0.0);
        vec3 o = vec3(0.0);
        if (rays > 0.5) {
          vec2 delta = (L.xy - vUv) / 30.0; vec2 uv = vUv; float decay = 1.0; float acc = 0.0;
          for (int i = 0; i < 30; i++) { uv += delta; acc += max(lum(texture2D(tDiffuse, uv).rgb) - 1.2, 0.0) * decay; decay *= 0.94; }
          o += col * acc * 0.04 * L.z / (1.0 + length((vUv - L.xy) * vec2(aspect, 1.0)) * 2.2);
        }
        float v = vis(L.xy) * L.z;
        if (v > 0.002) {
          vec2 a = vec2(aspect, 1.0), d = (vUv - L.xy) * a, ax = vec2(0.5) - L.xy;
          float r = length(d);
          o += col * v * (0.22 * exp(-r * 10.0) + 0.05 * exp(-abs(d.y) * 300.0) * exp(-abs(d.x) * 5.0));
          // блики объектива — едва заметные: яркие кольца поверх кораблей выглядели как мусор на экране
          o += v * (vec3(0.2, 0.35, 0.8) * 0.035 * disc((vUv - L.xy - ax * 0.55) * a, 0.028)
            + vec3(0.8, 0.45, 0.2) * 0.022 * disc((vUv - L.xy - ax * 0.85) * a, 0.05)
            + vec3(0.6, 0.35, 0.9) * 0.025 * disc((vUv - L.xy - ax * 1.6) * a, 0.018));
        }
        return o;
      }
      void main(){ vec4 c = texture2D(tDiffuse, vUv); c.rgb += star(l0, c0) + star(l1, c1);
        // защита: NaN/бесконечность из любого шейдера иначе размазывается свечением на весь экран (чёрный экран)
        if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.0);
        gl_FragColor = vec4(clamp(c.rgb, 0.0, 48.0), 1.0); }`
  });
  composer.addPass(godRays);
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // размытие в движении (по умолчанию выключено)
  afterimage = new AfterimagePass(0.72); afterimage.enabled = false; composer.addPass(afterimage);
  grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
      void main(){
        vec2 d = vUv - 0.5;
        vec4 c = texture2D(tDiffuse, vUv);
        float v = smoothstep(0.95, 0.3, length(d * vec2(1.0, 0.85)));
        c.rgb *= mix(0.8, 1.0, v); // мягкая виньетка
        // неподвижный дизеринг ±1/255: убирает полосы на градиентах неба, не мерцает и не «шумит»
        float n1 = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        float n2 = fract(sin(dot(gl_FragCoord.xy + 19.19, vec2(39.3468, 11.135))) * 24634.6345);
        c.rgb += (n1 + n2 - 1.0) / 255.0;
        gl_FragColor = vec4(c.rgb, 1.0);
      }`
  });
  composer.addPass(grade);
  // сглаживание после тонального отображения: SMAA (края и мелкие детали) или FXAA (самое дешёвое)
  smaa = new SMAAPass(innerWidth, innerHeight); smaa.enabled = false; composer.addPass(smaa);
  fxaa = new ShaderPass(FXAAShader); fxaa.enabled = false; composer.addPass(fxaa);

  buildSky('lobby', 1);
  // потеря WebGL-контекста (нехватка видеопамяти, сон ноутбука, смена GPU): не даём экрану остаться чёрным
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; if (onLost) onLost(); });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    skyRT = null; if (skyDome) { scene.remove(skyDome); skyDome = null; }
    buildSky(...lastSky); // содержимое целей рендера пропадает — небо и карту окружения строим заново
    resize();
    if (onRestored) onRestored();
  });
  resize();
  addEventListener('resize', resize);
}

function pixelRatio() {
  const want = Math.min(4, (devicePixelRatio || 1) * (gfx.scale || 1));
  return Math.max(0.5, Math.min(want, Math.sqrt(PIXEL_BUDGET / Math.max(1, innerWidth * innerHeight))));
}
function resize() {
  // буфер WebGL = размер окна × devicePixelRatio × масштаб рендера: по умолчанию пиксель в пиксель, без растяжения,
  // но не больше бюджета пикселей (на телефоне с плотностью 3 полный кадр — это 3,5 Мп и сотни МБ буферов)
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  const pr = renderer.getPixelRatio();
  if (fxaa) fxaa.material.uniforms.resolution.value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}

// ======================================================================
// Система
// ======================================================================
export function setSystem(sys) {
  for (const { obj } of celMeshes.values()) celGroup.remove(obj);
  celMeshes.clear();
  for (const id of [...entMeshes.keys()]) removeEnt(id);
  buildSky(sys.id, sys.sec, sys.region);
  const sun = sys.celestials.find(c => c.kind === 'sun' && !c.companion) || sys.celestials.find(c => c.kind === 'sun');
  curSuns = { a: sun || null, b: sys.celestials.find(c => c.kind === 'sun' && c.companion) || null };
  sunLight.color.set(STAR_LOOK[(sun && sun.star) || 'yellow'].light);
  sunLight.intensity = STAR_LOOK[(sun && sun.star) || 'yellow'].power * 1.35; // солнце ярче рассеянного света — тени остаются заметными
  sunLight2.color.set(curSuns.b ? STAR_LOOK[curSuns.b.star].light : 0xffffff);
  for (const c of sys.celestials) {
    let obj = null;
    if (c.kind === 'sun') obj = c.star === 'blackhole' ? blackHoleModel() : sunModel(c.star);
    else if (c.kind === 'planet') obj = planetModel(c);
    else if (c.kind === 'station') obj = stationModel(c.style);
    else if (c.kind === 'gate') obj = c.wh ? wormholeModel() : gateModel();
    if (!obj) continue;
    celGroup.add(obj);
    celMeshes.set(c.id, { obj, data: c });
  }
}
// червоточина появилась или исчезла, пока пилот в системе: меняем только её
export function syncCelestials(sys) {
  const want = new Set(sys.celestials.map(c => c.id));
  for (const [id, { obj }] of [...celMeshes]) if (!want.has(id)) { celGroup.remove(obj); celMeshes.delete(id); }
  for (const c of sys.celestials) {
    if (celMeshes.has(c.id) || c.kind !== 'gate') continue;
    const obj = c.wh ? wormholeModel() : gateModel();
    celGroup.add(obj); celMeshes.set(c.id, { obj, data: c });
  }
}

// ======================================================================
// Сущности
// ======================================================================
function makeEnt(e, data) {
  let obj;
  if (e.k === 's') {
    const t = data.ships[e.st];
    const faction = e.gd ? 'guard' : e.rl ? 'relic' : e.npc ? 'pirate' : 'player'; // rl — хранители аномалий Предтеч
    const col = e.gd ? 0xd8e4f0 : e.rl ? 0x2a2438 : e.npc ? 0x4a3a38 : e.pc != null ? e.pc : t.color; // pc — покраска корабля друга
    obj = shipModel(e.st, col, e.r || t.radius, faction);
  } else if (e.k === 'd') obj = droneModel(e.item, data.drones[e.item]);
  else if (e.k === 'a') obj = e.ore && e.ore.startsWith('gas_') ? gasCloudModel(e.r, e.sd, e.ore) : asteroidModel(e.r, e.sd, e.ore);
  else if (e.k === 'w') obj = e.rv ? relicModel(e.rv, e.r || 120) : wreckModel(e.r || 60);
  else if (e.k === 'm') obj = missileModel(e.c || 0xffa040, e.tp);
  else if (e.k === 't') obj = turretModel();
  else return null;
  entGroup.add(obj);
  const rec = { obj, kind: e.k, seen: 0, rv: e.rv };
  entMeshes.set(e.id, rec);
  return rec;
}
function removeEnt(id) {
  const r = entMeshes.get(id);
  if (!r) return;
  entGroup.remove(r.obj);
  entMeshes.delete(id);
  // общие (кэшированные) модели не трогаем; уникальные — освобождаем, иначе видеопамять растёт весь сеанс
  if (r.obj.userData.owned) r.obj.traverse(o => {
    if (o.isMesh && !o.isSprite) o.geometry.dispose();
    if (o.material && o.material.userData.owned) o.material.dispose();
  });
}

let myShip = null, myShipType = null;
export function setMyShip(type, data, paint, look) {
  const key = type && type + ':' + (paint == null ? '' : paint) + ':' + lookKey(look);
  if (myShip && myShipType === key) return;
  if (myShip) entGroup.remove(myShip);
  myShipType = key;
  if (!type) { myShip = null; return; }
  const t = data.ships[type];
  myShip = shipModel(type, paint == null ? t.color : paint, t.radius, 'player', look);
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
// Газовое облако: несколько мягких светящихся клубов (спрайты), медленно вращаются
let gasTex = null;
function gasCloudModel(radius, seed, ore) {
  if (!gasTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); gasTex = new THREE.CanvasTexture(c);
  }
  const col = ore === 'gas_plasma' ? new THREE.Color(1.4, 0.55, 1.1) : new THREE.Color(0.55, 1.2, 1.5);
  const grp = new THREE.Group(); let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 7; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: gasTex, color: col, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }));
    const k = radius * (1.2 + r() * 1.4); sp.scale.set(k, k, 1); sp.position.set((r() - 0.5) * radius * 1.6, (r() - 0.5) * radius * 0.8, (r() - 0.5) * radius * 1.6);
    grp.add(sp);
  }
  grp.userData.spin = 0.02;
  return grp;
}
// Кольца-ворота гоночной трассы: следующие — яркие, пройденные гаснут
let raceGroup = null, raceData = null;
export function setRace(cps, next) {
  raceData = cps && cps.length ? { cps, next } : null;
  if (raceGroup) { scene.remove(raceGroup); raceGroup = null; }
  if (!raceData) return;
  raceGroup = new THREE.Group();
  cps.forEach((p, i) => {
    const on = i === next, done = i < next;
    const m = new THREE.Mesh(new THREE.TorusGeometry(1500, on ? 70 : 40, 8, 64), glowMat(done ? 0x304050 : on ? 0xffd040 : 0x40c8ff, on ? 3 : 1.4));
    m.userData.p = p; m.visible = !done; raceGroup.add(m);
  });
  scene.add(raceGroup);
}
function updateRace(view) {
  if (!raceGroup) return;
  const o = view.origin;
  raceGroup.visible = !view.docked;
  raceGroup.children.forEach((m, i) => {
    const p = m.userData.p; m.position.set(p[0] - o[0], p[1] - o[1], p[2] - o[2]);
    const q = raceData.cps[i + 1] || raceData.cps[i - 1] || p; m.lookAt(q[0] - o[0], q[1] - o[1], q[2] - o[2]);
  });
}

// Кольца дальности вокруг своего корабля: тонкий пунктир в плоскости системы и подписи в км.
// Неяркие и не перекрывают обзор; подписи всегда сбоку от корабля (со стороны правого края экрана).
const RING_KM = [5, 10, 15, 20, 50, 100];
let rangeRings = null;
function makeRangeRings() {
  const g = new THREE.Group(); g.userData.labels = [];
  for (const km of RING_KM) {
    const r = km * 1000, N = km >= 50 ? 256 : 160, pts = [];
    for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    const far = km >= 50;
    const mat = new THREE.LineDashedMaterial({ color: far ? 0x6f9fc0 : 0x9fd8ff, transparent: true, opacity: far ? 0.16 : 0.22, dashSize: r * 0.018, gapSize: r * 0.012, depthWrite: false, fog: false, toneMapped: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    line.computeLineDistances(); line.renderOrder = 2; line.frustumCulled = false; g.add(line);
    const c = document.createElement('canvas'); c.width = 160; c.height = 56;
    const x = c.getContext('2d'); x.font = '600 28px Segoe UI, Inter, sans-serif'; x.textAlign = 'center'; x.lineWidth = 5;
    x.strokeStyle = 'rgba(0,8,20,0.65)'; x.fillStyle = far ? 'rgba(150,195,225,0.8)' : 'rgba(180,228,255,0.85)';
    const txt = km + ' км'; x.strokeText(txt, 80, 38); x.fillText(txt, 80, 38);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false, opacity: 0.85, toneMapped: false, fog: false }));
    sp.scale.set(0.13, 0.045, 1); sp.renderOrder = 3; sp.userData.r = r; g.add(sp); g.userData.labels.push(sp);
  }
  return g;
}
function updateRangeRings(view) {
  const on = !!view.rings && !view.docked;
  if (!on) { if (rangeRings) rangeRings.visible = false; return; }
  if (!rangeRings) { rangeRings = makeRangeRings(); scene.add(rangeRings); }
  rangeRings.visible = true;
  // подпись каждого кольца — в видимой его части, ближе к правому нижнему краю экрана (там меньше всего интерфейса)
  camera.updateMatrixWorld();
  const placed = [];
  for (const sp of rangeRings.userData.labels) {
    let best = null, bs = -1e9, bx = 0, by = 0;
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2;
      tmpV.set(Math.cos(a) * sp.userData.r, 0, Math.sin(a) * sp.userData.r).project(camera);
      if (tmpV.z > 1 || Math.abs(tmpV.x) > 0.82 || tmpV.y < -0.7 || tmpV.y > 0.75) continue;
      if (placed.some(([px, py]) => Math.abs(px - tmpV.x) < 0.16 && Math.abs(py - tmpV.y) < 0.06)) continue; // не налезать на соседнюю подпись
      const sc = tmpV.x * 0.8 - tmpV.y * 0.6;
      if (sc > bs) { bs = sc; best = a; bx = tmpV.x; by = tmpV.y; }
    }
    if (best !== null) placed.push([bx, by]);
    sp.visible = best !== null;
    if (best !== null) sp.position.set(Math.cos(best) * sp.userData.r, 0, Math.sin(best) * sp.userData.r);
  }
}

export function frame(view, dt, time) {
  renderer.info.reset(); // счётчики за весь кадр (все проходы композитора), для оверлея производительности
  if (contextLost) return;
  GU.time.value = time;
  grade.uniforms.time.value = time % 100;
  const origin = view.origin;

  cam.dist += (cam.target - cam.dist) * (1 - Math.exp(-dt * 8)); // экспоненциально — не зависит от частоты кадров
  const cp = Math.cos(cam.pitch);
  camera.position.set(Math.sin(cam.yaw) * cp * cam.dist, Math.sin(cam.pitch) * cam.dist, Math.cos(cam.yaw) * cp * cam.dist);
  camera.lookAt(0, 0, 0);
  // тряска камеры (попадания, взрывы рядом): затухает экспоненциально, сила — из настроек
  if (shakeAmp > 0.002) {
    const k = shakeAmp * cam.dist * 0.012;
    camera.position.x += (Math.random() - 0.5) * k; camera.position.y += (Math.random() - 0.5) * k; camera.position.z += (Math.random() - 0.5) * k;
    shakeAmp *= Math.exp(-dt * 7);
  }
  camera.near = Math.max(0.5, cam.dist * 0.01);
  camera.updateProjectionMatrix();
  if (starField) starField.position.copy(camera.position);
  if (skyDome) skyDome.position.copy(camera.position);

  updateRangeRings(view);
  updateRace(view);
  if (view.docked) { godRays.uniforms.l0.value.z = godRays.uniforms.l1.value.z = 0; stationFrame(view, dt, time); return; }
  if (stationView) { scene.remove(stationView); stationView = null; celGroup.visible = entGroup.visible = true; dust.visible = true; }

  // направление на звезду
  const A = curSuns.a ? curSuns.a.pos : [0, 0, 0];
  const sunRel = [A[0] - origin[0], A[1] - origin[1], A[2] - origin[2]];
  const sl = Math.hypot(...sunRel) || 1;
  const sunDir = tmpV2.set(sunRel[0] / sl, sunRel[1] / sl, sunRel[2] / sl);
  sunLight.position.copy(sunDir).multiplyScalar(1e5);
  sunLight.target.position.set(0, 0, 0);
  // вторая звезда: сила света по закону обратных квадратов относительно основной
  const lookA = STAR_LOOK[(curSuns.a && curSuns.a.star) || 'yellow'];
  const lookB = curSuns.b ? STAR_LOOK[curSuns.b.star] : null;
  if (lookB) {
    const B = curSuns.b.pos, rb = [B[0] - origin[0], B[1] - origin[1], B[2] - origin[2]], db = Math.hypot(...rb) || 1;
    sunLight2.position.set(rb[0] / db, rb[1] / db, rb[2] / db).multiplyScalar(1e5);
    sunLight2.target.position.set(0, 0, 0);
    sunLight2.intensity = lookB.power * Math.min(1.1, Math.pow(sl / db, 2)) * 0.85;
  } else sunLight2.intensity = 0;
  rimLight.position.copy(sunDir).multiplyScalar(-1e5).add(tmpV.set(0, 3e4, 0));
  // данных своего корабля может не быть мгновение (стыковка, прыжок, восстановление связи) — тогда его не рисуем
  if (myShip) myShip.visible = !!view.me;
  if (myShip && view.me) {
    const R = view.data.ships[view.me.st].radius * 3;
    const sc = sunLight.shadow.camera;
    if (sc.right !== R) { sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1e5 - R * 2; sc.far = 1e5 + R * 2; sc.updateProjectionMatrix(); }
  }

  const rays = [];
  for (const { obj, data } of celMeshes.values()) {
    const rel = [data.pos[0] - origin[0], data.pos[1] - origin[1], data.pos[2] - origin[2]];
    // далёкие звёзды рисуются крупнее (до ×3), чтобы их было видно; вблизи — в настоящий размер
    const boost = data.kind === 'sun' ? Math.min(3, Math.max(1, Math.hypot(...rel) / (data.radius * 400))) : 1;
    placeFar(obj, rel, data.radius * boost, obj.userData.unit);
    if (data.kind === 'sun' && data.star !== 'blackhole') {
      tmpV.copy(obj.position).project(camera);
      if (tmpV.z < 1) { const w = Math.max(0, Math.min(1, 1.35 - Math.max(Math.abs(tmpV.x), Math.abs(tmpV.y)))); if (w > 0) rays.push({ x: tmpV.x * 0.5 + 0.5, y: tmpV.y * 0.5 + 0.5, w: w * (data.companion ? 0.75 : 1), c: STAR_LOOK[data.star].corona }); }
    }
    if (obj.userData.spinY) obj.rotation.y += obj.userData.spinY * dt;
    if (data.kind === 'gate') {
      tmpV.set(-data.pos[0], -data.pos[1], -data.pos[2]).normalize().add(obj.position);
      obj.lookAt(tmpV);
    } else if (data.kind === 'planet') {
      obj.userData.body.rotation.y += dt * 0.004;
      if (obj.userData.clouds) obj.userData.clouds.rotation.y += dt * 0.005;
      // направление на солнце от планеты (освещение поверхности, облаков и атмосферы)
      obj.userData.sunDir.value.set(A[0] - data.pos[0], A[1] - data.pos[1], A[2] - data.pos[2]).normalize();
      if (lookB) {
        const B = curSuns.b.pos;
        const dA = Math.hypot(A[0] - data.pos[0], A[1] - data.pos[1], A[2] - data.pos[2]), dB = Math.hypot(B[0] - data.pos[0], B[1] - data.pos[1], B[2] - data.pos[2]) || 1;
        obj.userData.sunDir2.value.set(B[0] - data.pos[0], B[1] - data.pos[1], B[2] - data.pos[2]).normalize();
        const k = Math.min(1.1, Math.pow(dA / dB, 2) * lookB.power / lookA.power) * 0.8;
        const lc = new THREE.Color(lookB.light);
        obj.userData.sunCol2.value.set(lc.r * k, lc.g * k, lc.b * k);
      } else obj.userData.sunCol2.value.set(0, 0, 0);
    }
    setEngines(obj, 0, time);
  }

  // лучи: до двух звёзд на экране
  godRays.uniforms.aspect.value = innerWidth / innerHeight;
  for (let i = 0; i < 2; i++) {
    const L = godRays.uniforms['l' + i].value, r = rays[i];
    if (r) { L.set(r.x, r.y, r.w); godRays.uniforms['c' + i].value.set(r.c); } else L.set(0, 0, 0);
  }
  if (myShip && view.me) {
    myShip.position.set(0, 0, 0);
    const h = view.me.h;
    tmpV.set(h[0], h[1], h[2]);
    if (tmpV.lengthSq() > 0.01) myShip.lookAt(tmpV);
    // крен: корабль наклоняется в повороте (рыскание) и по командам Q/E в ручном режиме
    const prevH = myShip.userData.prevH || [h[0], h[1], h[2]];
    const yawRate = (prevH[2] * h[0] - prevH[0] * h[2]) / Math.max(dt, 0.001);
    myShip.userData.prevH = [h[0], h[1], h[2]];
    const wantBank = Math.max(-0.6, Math.min(0.6, -yawRate * 1.5)) + (view.roll || 0);
    myShip.userData.bank = (myShip.userData.bank || 0) + (wantBank - (myShip.userData.bank || 0)) * (1 - Math.exp(-dt * 3));
    myShip.rotateZ(myShip.userData.bank);
    const sf = Math.hypot(...view.me.v) / (view.me.max.spd || 1);
    setEngines(myShip, sf, time);
    if (quality !== 'low') updateTrail('me', origin, view.me.h, view.data.ships[view.me.st].radius, sf, (view.myLook && view.myLook.engine != null) ? view.myLook.engine : 0x3aa8ff, origin, time, !!view.me.warp);
    const mx = view.me.max || {};
    damageFx(myShip, view.me.st, mx.ar ? view.me.ar / mx.ar : 1, mx.hu ? view.me.hu / mx.hu : 1, time);
  }

  for (const rec of entMeshes.values()) rec.seen = 0;
  for (const e of view.ents.values()) {
    let rec = entMeshes.get(e.id);
    if (rec && e.k === 'w' && rec.rv !== e.rv) { removeEnt(e.id); rec = null; } // хранилище вскрыто — меняем облик
    rec = rec || makeEnt(e, view.data);
    if (!rec) continue;
    rec.seen = 1;
    const rel = [e.dp[0] - origin[0], e.dp[1] - origin[1], e.dp[2] - origin[2]];
    rec.obj.position.set(rel[0], rel[1], rel[2]);
    if (e.k === 's') {
      const eh = e.dh || e.h;
      if (eh) { tmpV.set(rel[0] + eh[0], rel[1] + eh[1], rel[2] + eh[2]); rec.obj.lookAt(tmpV); }
      rec.obj.visible = !e.w || Math.hypot(...rel) < 2e6;
      const t = view.data.ships[e.st];
      const sf = e.v ? Math.hypot(...e.v) / (t ? t.maxSpeed : 300) : 0;
      setEngines(rec.obj, sf, time);
      if (e.st !== 'pbase' && e.st !== 'fortress' && Math.hypot(...rel) < 40000 * distK()) damageFx(rec.obj, e.st, e.ar == null ? 1 : e.ar, e.hu == null ? 1 : e.hu, time);
      if (e.pbs) { if (!rec.dome) rec.obj.traverse(o => { if (o.userData.dome) rec.dome = o; }); if (rec.dome) rec.dome.visible = e.pbs === 'waves'; } // щит пиратской базы
      if (quality !== 'low' && eh && Math.hypot(...rel) < (gfx.fx === 'high' ? 60000 : 20000) * distK()) updateTrail(e.id, e.dp, eh, e.r || 50, sf, e.npc ? 0xff4020 : e.gd ? 0x9fd0ff : 0x3aa8ff, origin, time, !!e.w);
    } else if (e.k === 'd') {
      if (e.v && Math.hypot(...e.v) > 1) { tmpV.set(rel[0] + e.v[0], rel[1] + e.v[1], rel[2] + e.v[2]); rec.obj.lookAt(tmpV); }
      setEngines(rec.obj, 1, time);
    } else if (e.k === 'm') {
      if (e.v && Math.hypot(...e.v) > 1) { tmpV.set(rel[0] + e.v[0], rel[1] + e.v[1], rel[2] + e.v[2]); rec.obj.lookAt(tmpV); }
      setEngines(rec.obj, 1.2, time);
      if (quality !== 'low' && Math.hypot(...rel) < 80000 * distK()) updateTrail(e.id, e.dp, e.dh || e.h || [0, 0, 1], e.tp ? 14 : 8, 1, e.c || 0xffa040, origin, time, false);
    } else if (e.k === 't') { const head = rec.obj.userData.head; if (head) head.rotation.y = time * 0.6; setEngines(rec.obj, 0.2, time); }
    else if (e.k === 'a') rec.obj.rotation.y += rec.obj.userData.spin * dt;
    else if (e.k === 'w') { const fl = rec.obj.userData.flicker; if (fl && fl.material) fl.material.opacity = e.rv ? 0.75 + 0.25 * Math.sin(time * 3) : 0.5 + 0.5 * Math.random(); if (e.rv) setEngines(rec.obj, 0.2, time); }
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
  const dkey = view.dockedShip && view.dockedShip + ':' + (view.dockedPaint == null ? '' : view.dockedPaint) + ':' + lookKey(view.dockedLook);
  if (view.dockedShip && stationView.userData.shipType !== dkey) {
    if (stationView.userData.ship) stationView.remove(stationView.userData.ship);
    const t = view.data.ships[view.dockedShip];
    const sh = shipModel(view.dockedShip, view.dockedPaint == null ? t.color : view.dockedPaint, 900, 'player', view.dockedLook);
    sh.position.set(2200, -1200, 5200);
    stationView.add(sh); stationView.userData.ship = sh; stationView.userData.shipType = dkey;
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
  if (view.me && id === view.me.id) return new THREE.Vector3(0, 0, 0);
  const e = view.ents.get(id);
  if (!e) return null;
  return new THREE.Vector3(e.dp[0] - origin[0], e.dp[1] - origin[1], e.dp[2] - origin[2]);
}
function entRadius(view, id) {
  if (view.me && id === view.me.id) return view.data.ships[view.me.st].radius;
  const e = view.ents.get(id);
  return e ? (e.r || 50) : 50;
}
function sprite(color, k = 2) {
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: new THREE.Color(color).multiplyScalar(k), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
}
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);

// Молнии лентами: все разряды кадра — одна сетка из четырёхугольников, развёрнутых к камере (один вызов отрисовки)
let BOLT_TEX = null;
function boltTexture() {
  if (BOLT_TEX) return BOLT_TEX;
  BOLT_TEX = canvasTex(64, 4, (g, W, H) => {
    const img = g.createImageData(W, H);
    for (let x = 0; x < W; x++) { const d = (x + 0.5) / W - 0.5, a = Math.min(1, Math.exp(-((d / 0.2) ** 2)) * 0.55 + Math.exp(-((d / 0.06) ** 2)));
      for (let y = 0; y < H; y++) { const i = (y * W + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255; } }
    g.putImageData(img, 0, 0);
  });
  return BOLT_TEX;
}
function boltMesh(maxSeg) {
  const geo = new THREE.BufferGeometry(), idx = new Uint32Array(maxSeg * 6), uv = new Float32Array(maxSeg * 8);
  for (let s = 0; s < maxSeg; s++) { const b = s * 4; idx.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], s * 6); uv.set([0, 0, 1, 0, 0, 1, 1, 1], s * 8); }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxSeg * 12), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxSeg * 12), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: boltTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  return { mesh, max: maxSeg };
}
const _bv = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
// list: [{ pts: [Vector3…], w, c: [r, g, b] }] — точки уже в координатах сцены
function writeBolts(b, list) {
  const P = b.mesh.geometry.attributes.position.array, Cc = b.mesh.geometry.attributes.color.array;
  let n = 0;
  for (const bolt of list) for (let i = 0; i + 1 < bolt.pts.length && n < b.max; i++) {
    const p0 = bolt.pts[i], p1 = bolt.pts[i + 1];
    const d = _bv[0].subVectors(p1, p0), mid = _bv[1].addVectors(p0, p1).multiplyScalar(0.5), view = _bv[2].subVectors(camera.position, mid);
    const side = _bv[3].crossVectors(d, view); const L = side.length(); if (L < 1e-6) continue; side.multiplyScalar(bolt.w / L);
    const o = n * 12;
    P[o] = p0.x - side.x; P[o + 1] = p0.y - side.y; P[o + 2] = p0.z - side.z; P[o + 3] = p0.x + side.x; P[o + 4] = p0.y + side.y; P[o + 5] = p0.z + side.z;
    P[o + 6] = p1.x - side.x; P[o + 7] = p1.y - side.y; P[o + 8] = p1.z - side.z; P[o + 9] = p1.x + side.x; P[o + 10] = p1.y + side.y; P[o + 11] = p1.z + side.z;
    for (let k = 0; k < 4; k++) { Cc[o + k * 3] = bolt.c[0]; Cc[o + k * 3 + 1] = bolt.c[1]; Cc[o + k * 3 + 2] = bolt.c[2]; }
    n++;
  }
  b.mesh.geometry.setDrawRange(0, n * 6);
  b.mesh.geometry.attributes.position.needsUpdate = true; b.mesh.geometry.attributes.color.needsUpdate = true;
}
// ломаная молния между a и b с ответвлениями
function jagged(a, b, amp, n = 9) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, k = i === 0 || i === n ? 0 : Math.sin(Math.PI * t) * amp;
    pts.push(a.clone().lerp(b, t).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 * k)));
  }
  return pts;
}
const GOLD_BOLT = [3.2, 2.5, 1.2], BLUE_BOLT = [1.9, 2.5, 3.4], WHITE_BOLT = [3.4, 3.3, 3.0];
// молнии по кораблю в его собственных координатах: между точками крыльев, колец и корпуса, с отростками
function seraphAura(pts, R, k) {
  const out = [], n = Math.round(26 - 12 * k), V = (p) => new THREE.Vector3(p[0], p[1], p[2]);
  for (let i = 0; i < n; i++) {
    const a = V(pts[(Math.random() * pts.length) | 0]);
    let b = null;
    for (let tries = 0; tries < 6 && !b; tries++) { const c = V(pts[(Math.random() * pts.length) | 0]), d = a.distanceTo(c); if (d > R * 0.12 && d < R * 0.9) b = c; }
    if (!b || Math.random() < 0.35) b = a.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(R * (0.6 + Math.random() * 0.9))); // разряд срывается в космос
    const d = a.distanceTo(b), main = jagged(a, b, d * 0.14, 8 + ((Math.random() * 5) | 0)), col = Math.random() < 0.55 ? GOLD_BOLT : BLUE_BOLT;
    out.push({ pts: main, w: R * (0.014 + Math.random() * 0.014), c: col });
    if (Math.random() < 0.6) { const s = main[2 + ((Math.random() * 4) | 0)]; out.push({ pts: jagged(s, s.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(d * 0.6)), d * 0.08, 5), w: R * 0.009, c: col }); }
  }
  return out;
}
function seraphDischarge(obj, fx, view) {
  const bolts = boltMesh(1400); fxGroup.add(bolts.mesh);
  const mk = (c, op) => { const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false })); m.renderOrder = 6; fxGroup.add(m); return m; };
  const glow = mk(new THREE.Color(1, 0.82, 0.5).multiplyScalar(2.2), 0.5), core = mk(new THREE.Color(1, 0.98, 0.92).multiplyScalar(4.5), 1);
  const muzzle = sprite(0xcfe4ff, 6), spr = sprite(0xffd890, 4); muzzle.material.depthTest = spr.material.depthTest = false; muzzle.renderOrder = spr.renderOrder = 7; fxGroup.add(muzzle, spr);
  fxList.push({ kind: 'seraph', obj, to: fx.to, bolts, glow, core, muzzle, sprite: spr, t: 0, dur: 1.5, nextJag: 0, aura: null, beamJag: null });
  if (fx.hit) spark(fx.color, fx.to, entRadius(view, fx.to));
  SERAPH.charge = 1;
}

export function addFx(fx, view) {
  const origin = view.origin;
  if (fx.k === 'beam' && fx.arc && fx.main) {
    // залп «Серафима»: луч из сердца-реактора и молнии по всему кораблю
    const obj = view.me && fx.from === view.me.id ? myShip : (entMeshes.get(fx.from) || {}).obj;
    if (obj && obj.userData.arcPts) { seraphDischarge(obj, fx, view); return; }
  }
  if (fx.k === 'beam' && fx.arc) {
    // «Копьё Зари»: ломаная молния из сегментов, каждый кадр меняет форму; общие материалы на весь разряд
    const col = new THREE.Color(fx.color || 0xffe0a0);
    const gm = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const cm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).lerp(col, 0.3).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const segs = [];
    for (let i = 0; i < 12; i++) { const g = new THREE.Mesh(beamGeo, gm), c = new THREE.Mesh(beamGeo, cm); fxGroup.add(g, c); segs.push([g, c]); }
    const muzzle = sprite(col, 4); fxGroup.add(muzzle);
    fxList.push({ kind: 'arc', segs, gm, cm, muzzle, from: fx.from, to: fx.to, t: 0, dur: fx.dur || 0.7, w: fx.main ? 1.6 : 1, nextJag: 0, jag: null });
    if (fx.hit) spark(fx.color, fx.to, entRadius(view, fx.to));
    return;
  }
  if (fx.k === 'beam' || fx.k === 'mine') {
    const col = new THREE.Color(fx.color || 0xff4040);
    const glow = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const core = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).lerp(col, 0.4).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    fxGroup.add(glow, core);
    const muzzle = sprite(col, 3); fxGroup.add(muzzle);
    const miss = fx.hit === false ? new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(entRadius(view, fx.to) * 8) : null;
    fxList.push({ glow, core, muzzle, from: fx.from, to: fx.to, fromPos: fx.fromPos, t: 0, dur: fx.dur || 1, kind: fx.k, miss });
    if (fx.hit) {
      const p = entRel(view, fx.to, origin);
      if (p) {
        spark(fx.color, fx.to, entRadius(view, fx.to));
        const tgt = view.ents.get(fx.to);
        const shieldUp = view.me && fx.to === view.me.id ? view.me.sh > view.me.max.sh * 0.03 : tgt && tgt.sh > 0.03;
        if (fx.k === 'beam' && shieldUp) shieldFlash(fx.to, entRadius(view, fx.to));
        else if (fx.k === 'beam' && quality !== 'low') hullSparks(fx.to, entRadius(view, fx.to), fx.color);
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

// Искры по броне: короткий веер раскалённых осколков, когда щит уже пробит
function hullSparks(id, r, color) {
  const N = 26, pp = new Float32Array(N * 3), vel = [];
  for (let i = 0; i < N; i++) vel.push(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(r * (1 + Math.random() * 3)));
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  const sparks = new THREE.Points(pg, new THREE.PointsMaterial({ color: new THREE.Color(0xffb060).lerp(new THREE.Color(color || 0xffb060), 0.25).multiplyScalar(3), size: 2.5, sizeAttenuation: false, map: TEX.glowHard, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  sparks.frustumCulled = false; fxGroup.add(sparks);
  const off = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(r * 0.7);
  fxList.push({ kind: 'hsp', follow: id, sparks, vel, off, t: 0, dur: 0.7 });
}
// Повреждения: дым из пробоин (броня почти сбита или корпус задет) и огонь, когда корпус ниже половины
function damageFx(obj, type, ar, hu, time) {
  let d = obj.userData.dmg;
  const want = quality !== 'low' && (hu < 0.9 || ar < 0.3);
  if (!want) { if (d) d.g.visible = false; return; }
  const R = SHIP_BASE_R[type === 'archon' ? 'colossus' : type] || 50;
  if (!d) {
    const g = new THREE.Group(); obj.add(g);
    const puffs = [];
    for (let i = 0; i < 6; i++) { const m = new THREE.SpriteMaterial({ map: TEX.glow, color: 0x5d5d60, transparent: true, depthWrite: false, opacity: 0 }); m.userData.owned = true; const sp = new THREE.Sprite(m); g.add(sp); puffs.push(sp); }
    const fm = new THREE.SpriteMaterial({ map: TEX.glow, color: new THREE.Color(0xff6a18).multiplyScalar(2.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }); fm.userData.owned = true;
    const fire = new THREE.Sprite(fm); g.add(fire);
    d = obj.userData.dmg = { g, puffs, fire, seed: Math.random() * 10, spot: [(Math.random() - 0.5) * R * 0.7, R * 0.12, (Math.random() - 0.3) * R * 0.8] };
  }
  d.g.visible = true;
  const sev = Math.min(1, (1 - hu) * 1.6 + (ar < 0.3 ? 0.35 : 0)), heavy = hu < 0.5;
  d.puffs.forEach((sp, i) => {
    const k = (time * 0.55 + i / d.puffs.length + d.seed) % 1;
    sp.position.set(d.spot[0] + k * R * 0.1, d.spot[1] + k * R * 0.5, d.spot[2] - k * R * 1.3);
    sp.scale.setScalar(R * (0.12 + k * 0.6) * (0.6 + sev));
    sp.material.opacity = (1 - k) * 0.5 * sev;
  });
  d.fire.visible = heavy;
  if (heavy) { d.fire.position.set(d.spot[0], d.spot[1], d.spot[2]); d.fire.scale.setScalar(R * (0.16 + 0.07 * Math.sin(time * 23 + d.seed))); d.fire.material.opacity = 0.65 + 0.35 * Math.random(); }
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

let flashK = 1; // вспышки взрывов можно приглушить в настройках
export function setFlash(on) { flashK = on ? 1 : 0.2; }
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
  if (f.bolts) { fxGroup.remove(f.bolts.mesh); f.bolts.mesh.geometry.dispose(); f.bolts.mesh.material.dispose(); }
  if (f.segs) { for (const [g, c] of f.segs) fxGroup.remove(g, c); f.gm.dispose(); f.cm.dispose(); }
  for (const k of ['glow', 'core', 'muzzle', 'sprite', 'ring', 'shield', 'flash', 'sparks', 'wave']) if (f[k]) { fxGroup.remove(f[k]); if (f[k].material) f[k].material.dispose(); if (f[k].geometry && f[k].geometry !== beamGeo) f[k].geometry.dispose(); }
  if (f.parts) for (const p of f.parts) { fxGroup.remove(p.s); p.s.material.dispose(); }
  if (f.debris) for (const d of f.debris) { fxGroup.remove(d.d); d.d.geometry.dispose(); }
}

function updateFx(view, dt, origin) {
  if (SERAPH.panel) { // после залпа филигрань крыльев и реактор «Серафима» вспыхивают и плавно гаснут
    SERAPH.charge = Math.max(0, SERAPH.charge - dt * 0.8);
    const c = SERAPH.charge;
    SERAPH.panel.emissiveIntensity = 1.7 + c * 4 * (0.8 + 0.2 * Math.random());
    SERAPH.core.color.setRGB(0.95, 0.98, 1).multiplyScalar(5 + c * 6);
    SERAPH.burst.color.setRGB(0.7, 0.85, 1).multiplyScalar(3 + c * 5);
  }
  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i];
    f.t += dt;
    const k = f.t / f.dur;
    if (k >= 1) { disposeFx(f); fxList.splice(i, 1); continue; }
    if (f.kind === 'seraph') {
      const obj = f.obj;
      if (!obj.parent) { f.t = f.dur; continue; } // корабль исчез (варп, гибель)
      obj.updateMatrixWorld();
      const sc = obj.matrixWorld.getMaxScaleOnAxis(), R = 600, Rw = R * sc;
      const core = new THREE.Vector3(...obj.userData.core).applyMatrix4(obj.matrixWorld), tgt = entRel(view, f.to, origin);
      const kb = f.t / 0.95, fadeB = kb < 1 ? Math.pow(1 - kb, 0.8) : 0, fade = Math.pow(1 - k, 1.3);
      // толстый луч из реактора к цели
      if (tgt && fadeB > 0) {
        const mid = core.clone().add(tgt).multiplyScalar(0.5), d = core.distanceTo(tgt), w = Rw * 0.022 * (0.85 + 0.3 * Math.random());
        for (const [m, ww, op] of [[f.glow, w * 4.2, 0.45], [f.core, w, 1]]) { m.visible = true; m.position.copy(mid); m.lookAt(tgt); m.rotateX(Math.PI / 2); m.scale.set(ww, d, ww); m.material.opacity = fadeB * op; }
      } else { f.glow.visible = f.core.visible = false; }
      f.muzzle.position.copy(core); f.muzzle.scale.setScalar(Rw * (0.6 + 0.15 * Math.random()) * (0.4 + fade)); f.muzzle.material.opacity = fade;
      if (tgt) { f.sprite.position.copy(tgt); f.sprite.scale.setScalar(Rw * 0.5 * (0.6 + Math.random() * 0.5)); f.sprite.material.opacity = fadeB; }
      // излом молний обновляется 20 раз в секунду
      if (f.t >= f.nextJag) {
        f.nextJag = f.t + 0.05;
        f.aura = seraphAura(obj.userData.arcPts, R, k);
        f.beamJag = tgt && fadeB > 0.05 ? [0, 1, 2, 3].map(() => jagged(core, tgt, Math.min(core.distanceTo(tgt) * 0.04, Rw * 0.35), 14)) : [];
      }
      const list = f.aura.map(b => ({ pts: b.pts.map(p => p.clone().applyMatrix4(obj.matrixWorld)), w: b.w * sc * (0.7 + fade * 0.6), c: b.c.map(x => x * (0.35 + 0.65 * fade)) }));
      for (const pts of f.beamJag) list.push({ pts, w: Rw * 0.014, c: (Math.random() < 0.5 ? GOLD_BOLT : WHITE_BOLT).map(x => x * fadeB) });
      writeBolts(f.bolts, list);
      continue;
    }
    if (f.kind === 'arc') {
      const a = entRel(view, f.from, origin), b = entRel(view, f.to, origin);
      if (!a || !b) { f.t = f.dur; continue; }
      const d = a.distanceTo(b), n = f.segs.length, dir = b.clone().sub(a).normalize();
      // излом обновляется 25 раз в секунду — молния «дрожит», но не мельтешит каждый кадр
      if (!f.jag || f.t >= f.nextJag) {
        f.nextJag = f.t + 0.04;
        const u = new THREE.Vector3(0, 1, 0).cross(dir); if (u.lengthSq() < 1e-4) u.set(1, 0, 0); u.normalize();
        const v = dir.clone().cross(u);
        f.jag = Array.from({ length: n + 1 }, (_, i) => { const e = i === 0 || i === n ? 0 : (Math.random() - 0.5) * d * 0.09 * Math.sin(Math.PI * i / n);
          const e2 = i === 0 || i === n ? 0 : (Math.random() - 0.5) * d * 0.09 * Math.sin(Math.PI * i / n); return [i / n, e, e2]; });
        f.u = u; f.v = v;
      }
      const pts = f.jag.map(([t, e, e2]) => a.clone().lerp(b, t).addScaledVector(f.u, e).addScaledVector(f.v, e2));
      const w = Math.max(0.5, cam.dist * 0.0014) * f.w, fade = Math.pow(1 - k, 1.2) * (0.75 + 0.25 * Math.random());
      for (let j = 0; j < n; j++) {
        const p0 = pts[j], p1 = pts[j + 1], mid = p0.clone().add(p1).multiplyScalar(0.5), L = p0.distanceTo(p1);
        for (const [m, ww] of [[f.segs[j][0], w * 3], [f.segs[j][1], w * 0.6]]) { m.position.copy(mid); m.lookAt(p1); m.rotateX(Math.PI / 2); m.scale.set(ww, L, ww); }
      }
      f.gm.opacity = fade * 0.45; f.cm.opacity = fade;
      f.muzzle.position.copy(b); f.muzzle.scale.setScalar(w * 18); f.muzzle.material.opacity = fade * 0.8;
      continue;
    }
    if (f.glow) {
      // выстрел со станции (оборонная платформа, крепость) задаётся абсолютной точкой
      const a = entRel(view, f.from, origin) || (f.fromPos ? new THREE.Vector3(f.fromPos[0] - origin[0], f.fromPos[1] - origin[1], f.fromPos[2] - origin[2]) : null), b = entRel(view, f.to, origin);
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
      f.flash.position.copy(c); f.flash.scale.setScalar(s * (2 + k * 8)); f.flash.material.opacity = Math.max(0, 1 - k * 4) * flashK;
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
    } else if (f.kind === 'hsp') {
      const p = entRel(view, f.follow, origin);
      if (p) {
        p.add(f.off); const arr = f.sparks.geometry.attributes.position.array, tt = f.t;
        for (let j = 0; j < f.vel.length; j++) { const v = f.vel[j]; arr[j * 3] = p.x + v.x * tt; arr[j * 3 + 1] = p.y + v.y * tt; arr[j * 3 + 2] = p.z + v.z * tt; }
        f.sparks.geometry.attributes.position.needsUpdate = true;
      }
      f.sparks.material.opacity = Math.pow(1 - k, 1.5);
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
  m.opacity += (target - m.opacity) * (1 - Math.exp(-dt * 3));
  const fov0 = gfx.fov || 60;
  camera.fov += ((target ? fov0 + 18 : fov0) - camera.fov) * (1 - Math.exp(-dt * 2.5));
  camera.updateProjectionMatrix();
  bloom.strength = (gfx.bloom || 0) * (1 + m.opacity * 0.7);
  if (m.opacity < 0.01) { warpLines.visible = false; return; }
  if (!view.me) { warpLines.visible = false; return; }
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

// Портрет корабля для магазина: корабль крупным планом на фоне текущего неба (используется инструментами сборки)
export function shipPortrait(type, w = 960, h = 523) {
  const ps = new THREE.Scene();
  // фон: тёмная туманность и звёзды
  const bg = document.createElement('canvas'); bg.width = w; bg.height = h;
  const c = bg.getContext('2d'), rr = seeded(type.length * 131);
  const grd = c.createRadialGradient(w * 0.62, h * 0.4, 10, w * 0.6, h * 0.45, w * 0.75);
  grd.addColorStop(0, '#1c2a4a'); grd.addColorStop(0.45, '#0c1428'); grd.addColorStop(1, '#03050b');
  c.fillStyle = grd; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 22; i++) { const x = rr() * w, y = rr() * h, g2 = c.createRadialGradient(x, y, 0, x, y, 60 + rr() * 160); g2.addColorStop(0, `rgba(${80 + rr() * 80},${60 + rr() * 60},${140 + rr() * 90},0.10)`); g2.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g2; c.fillRect(0, 0, w, h); }
  for (let i = 0; i < 700; i++) { const b = rr(); c.fillStyle = `rgba(255,255,255,${0.2 + b * 0.8})`; c.fillRect(rr() * w, rr() * h, b > 0.97 ? 2 : 1, b > 0.97 ? 2 : 1); }
  const bgTex = new THREE.CanvasTexture(bg); bgTex.colorSpace = THREE.SRGBColorSpace;
  ps.background = bgTex; ps.environment = scene.environment; ps.environmentIntensity = 0.9;
  const t = SHIP_BASE_R[type] || 50;
  const m = shipModel(type, 0x5a6068, t, 'player');
  ps.add(m);
  setEngines(m, 0.9, 1);
  // кадрирование по габаритам модели
  const box = new THREE.Box3().setFromObject(m), ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
  const key = new THREE.DirectionalLight(0xfff1dc, 3.6); key.position.set(-size * 2, size * 1.6, size * 1.8); ps.add(key);
  const rim = new THREE.DirectionalLight(0x6f8cff, 2.2); rim.position.set(size * 2, size * 0.4, -size * 2.2); ps.add(rim);
  ps.add(new THREE.AmbientLight(0x9aa6c0, 0.55));
  const cam = new THREE.PerspectiveCamera(30, w / h, size * 0.01, size * 100);
  const dir = new THREE.Vector3(1.0, 0.42, 1.05).normalize();
  cam.position.copy(ctr).addScaledVector(dir, size * 1.25); cam.lookAt(ctr);
  const prev = renderer.getSize(new THREE.Vector2()), exp = renderer.toneMappingExposure;
  renderer.setSize(w, h, false); renderer.toneMappingExposure = 1.35;
  renderer.render(ps, cam);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.9);
  renderer.setSize(prev.x, prev.y, false); renderer.toneMappingExposure = exp;
  bgTex.dispose();
  return url;
}

// ---------- Единая серия фото кораблей ----------
// Один фон (галактика, туманность, планета), один свет и ракурс, одна окраска «оружейный металл».
// Различия — по силе и назначению: класс мощи (I–V) задаёт размер в кадре и ракурс (тяжёлые снимаются снизу
// и заполняют кадр), назначение — цвет контрового света (боевые — алый, добыча — янтарь, перевозка — зелёный,
// разведка — голубой, носители дронов — фиолетовый).
const PHOTO_ROLE = { combat: 0xff6a50, carrier: 0xb070ff, mining: 0xffa838, transport: 0x50d888, explore: 0x50c0ff };
let photoBg = null;
function photoBackdrop(w, h) {
  if (photoBg && photoBg.width === w && photoBg.height === h) return photoBg;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d'), rr = seeded(4242);
  const base = c.createLinearGradient(0, 0, w, h); base.addColorStop(0, '#070b18'); base.addColorStop(1, '#020308');
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  // туманность
  for (let i = 0; i < 30; i++) {
    const x = rr() * w, y = rr() * h * 0.8, r = (0.1 + rr() * 0.3) * w;
    const g = c.createRadialGradient(x, y, 0, x, y, r), warm = rr() < 0.3;
    g.addColorStop(0, warm ? `rgba(150,80,120,${0.05 + rr() * 0.05})` : `rgba(${50 + rr() * 50},${70 + rr() * 60},${150 + rr() * 80},${0.05 + rr() * 0.06})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }
  // спиральная галактика слева сверху
  const gx = w * 0.3, gy = h * 0.3, tilt = -0.35;
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4200; i++) {
    const arm = i % 2, t = Math.pow(rr(), 0.7) * 3.4, a = t * 2.2 + arm * Math.PI + (rr() - 0.5) * (0.35 + t * 0.12);
    const r = (4 + t * w * 0.055) * (0.9 + rr() * 0.2);
    let x = Math.cos(a) * r * 1.5, y = Math.sin(a) * r * 0.5;
    const X = gx + x * Math.cos(tilt) - y * Math.sin(tilt), Y = gy + x * Math.sin(tilt) + y * Math.cos(tilt);
    const al = Math.max(0, 0.5 - t * 0.12) * (0.4 + rr() * 0.6), blue = t > 1;
    c.fillStyle = blue ? `rgba(150,180,255,${al})` : `rgba(255,225,190,${al})`;
    c.fillRect(X, Y, 1.3, 1.3);
  }
  const core = c.createRadialGradient(gx, gy, 0, gx, gy, w * 0.07);
  core.addColorStop(0, 'rgba(255,235,210,0.8)'); core.addColorStop(0.3, 'rgba(200,180,255,0.25)'); core.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = core; c.fillRect(0, 0, w, h);
  // звёзды
  for (let i = 0; i < 1100; i++) {
    const b = rr(), x = rr() * w, y = rr() * h;
    c.fillStyle = `rgba(${200 + rr() * 55},${210 + rr() * 45},255,${0.15 + b * 0.75})`;
    c.fillRect(x, y, b > 0.985 ? 2 : 1, b > 0.985 ? 2 : 1);
    if (b > 0.995) { const g = c.createRadialGradient(x, y, 0, x, y, 9); g.addColorStop(0, 'rgba(200,220,255,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x - 9, y - 9, 18, 18); }
  }
  c.globalCompositeOperation = 'source-over';
  // планета справа сверху, освещена слева
  const px = w * 0.97, py = -h * 0.02, pr = h * 0.42;
  c.save(); c.beginPath(); c.arc(px, py, pr, 0, Math.PI * 2); c.clip();
  const pg = c.createLinearGradient(px - pr, py, px + pr * 0.4, py + pr * 0.6);
  pg.addColorStop(0, '#c9d6e6'); pg.addColorStop(0.25, '#7b8fa8'); pg.addColorStop(0.55, '#1c2433'); pg.addColorStop(1, '#05070b');
  c.fillStyle = pg; c.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  for (let i = 0; i < 9; i++) { c.fillStyle = `rgba(255,255,255,${0.03 + rr() * 0.05})`; c.fillRect(px - pr, py - pr + rr() * pr * 2, pr * 2, 2 + rr() * pr * 0.06); }
  c.restore();
  c.globalCompositeOperation = 'lighter';
  const atm = c.createRadialGradient(px, py, pr * 0.97, px, py, pr * 1.08);
  atm.addColorStop(0, 'rgba(120,170,255,0.55)'); atm.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = atm; c.fillRect(px - pr * 1.2, py - pr * 1.2, pr * 2.4, pr * 2.4);
  c.globalCompositeOperation = 'source-over';
  photoBg = cv;
  return cv;
}

// Осмотр модели со всех сторон: спереди, сзади, слева, сверху, снизу и в три четверти (инструмент проверки моделей)
export function shipTurntable(type, info = {}, tw = 320, th = 200) {
  const ps = new THREE.Scene(); ps.background = new THREE.Color(0x1c2128); ps.environment = scene.environment; ps.environmentIntensity = 0.8;
  const m = shipModel(type, info.unique ? info.color : 0x6a7280, SHIP_BASE_R[type] || 50, 'player'); ps.add(m); setEngines(m, 0.6, 1); m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m), ctr = box.getCenter(new THREE.Vector3()), rad = box.getSize(new THREE.Vector3()).length() / 2;
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-rad, rad * 2, rad * 1.5); ps.add(key);
  const fill = new THREE.DirectionalLight(0xb0c8ff, 0.9); fill.position.set(rad * 2, -rad * 0.5, -rad); ps.add(fill);
  ps.add(new THREE.AmbientLight(0x9098a8, 0.6));
  const views = [['спереди', [0, 0.15, 1]], ['сзади', [0, 0.2, -1]], ['слева', [-1, 0.05, 0.001]], ['сверху', [0.001, 1, 0.02]], ['снизу', [0.001, -1, 0.02]], ['3/4', [-0.8, 0.45, 0.7]]];
  const out = document.createElement('canvas'); out.width = tw * 6; out.height = th; const c = out.getContext('2d');
  const prev = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
  renderer.setPixelRatio(1); renderer.setSize(tw, th, false);
  views.forEach(([name, d], i) => {
    const cam = new THREE.PerspectiveCamera(30, tw / th, rad * 0.01, rad * 100), dir = new THREE.Vector3(...d).normalize();
    cam.position.copy(ctr).addScaledVector(dir, rad / Math.tan(THREE.MathUtils.degToRad(15)) * 1.05); cam.lookAt(ctr); cam.updateMatrixWorld(true);
    renderer.render(ps, cam); c.drawImage(renderer.domElement, i * tw, 0, tw, th);
    c.fillStyle = '#9fb4c8'; c.font = '13px sans-serif'; c.fillText((i === 0 ? type + ' · ' : '') + name, i * tw + 6, 16);
  });
  renderer.setPixelRatio(pr); renderer.setSize(prev.x, prev.y, false);
  ps.remove(m); bgDispose(ps);
  return out.toDataURL('image/jpeg', 0.85);
}
function bgDispose() {}
export function shipPhoto(type, info = {}, w = 800, h = 450) {
  const role = info.role || 'explore', tier = Math.max(1, Math.min(5, info.tier || 1));
  const ps = new THREE.Scene();
  const bgTex = new THREE.CanvasTexture(photoBackdrop(w, h)); bgTex.colorSpace = THREE.SRGBColorSpace;
  ps.background = bgTex; ps.environment = scene.environment; ps.environmentIntensity = 0.75;
  // единая серия — одна серая окраска; уникальный корабль снимается в собственной белой ливрее
  const m = shipModel(type, info.unique ? info.color : 0x4a5058, SHIP_BASE_R[type] || 50, 'player');
  ps.add(m);
  setEngines(m, 1.0, 1);
  m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m), ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const rad = size.length() / 2;
  // свет: холодный ключевой со стороны галактики, контровой цвета назначения, тёплый отсвет планеты
  const key = new THREE.DirectionalLight(0xe4ecff, 2.6); key.position.set(-rad * 2, rad * 2.2, rad * 1.2); ps.add(key);
  const rim = new THREE.DirectionalLight(PHOTO_ROLE[role] || 0x80a0ff, 1.5); rim.position.set(rad * 1.6, rad * 0.15, -rad * 2.6); ps.add(rim);
  const warm = new THREE.DirectionalLight(0xffc890, 0.7); warm.position.set(rad * 2, rad * 1.5, rad * 2); ps.add(warm);
  ps.add(new THREE.AmbientLight(0x8090b0, 0.4));
  // ракурс и кадр по классу мощи: лёгкие — сверху и с запасом места, тяжёлые — снизу и во весь кадр
  const elev = info.unique ? 0.8 : 0.42 - (tier - 1) * 0.12, fill = [0.5, 0.6, 0.68, 0.76, 0.84][tier - 1];
  const cam = new THREE.PerspectiveCamera(30, w / h, rad * 0.01, rad * 100);
  const halfW = Math.tan(THREE.MathUtils.degToRad(15)) * (w / h);
  const dist = rad / (fill * halfW);
  const dir = new THREE.Vector3(-1, elev, 0.62).normalize();
  cam.position.copy(ctr).addScaledVector(dir, dist);
  cam.lookAt(ctr.clone().add(new THREE.Vector3(0, 0, -rad * 0.3 * (1 - fill))));
  cam.updateMatrixWorld(true);
  const prev = renderer.getSize(new THREE.Vector2()), exp = renderer.toneMappingExposure, pr = renderer.getPixelRatio();
  renderer.setPixelRatio(1); renderer.setSize(w, h, false); renderer.toneMappingExposure = 1.15;
  renderer.render(ps, cam);
  // постобработка на 2D-холсте: свечение ярких мест, следы двигателей, виньетка
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const c = out.getContext('2d');
  c.drawImage(renderer.domElement, 0, 0, w, h);
  c.globalCompositeOperation = 'lighter';
  c.filter = 'brightness(0.55) contrast(3.2) blur(10px)'; c.globalAlpha = 0.55; c.drawImage(renderer.domElement, 0, 0, w, h);
  c.filter = 'none'; c.globalAlpha = 1;
  const engines = [];
  m.traverse(o => { if (o.userData.plume) engines.push(o.getWorldPosition(new THREE.Vector3())); });
  const toScr = (v) => { const p = v.clone().project(cam); return [(p.x * 0.5 + 0.5) * w, (-p.y * 0.5 + 0.5) * h]; };
  const back = new THREE.Vector3(0, 0, -1).applyQuaternion(m.quaternion);
  for (const ep of engines.slice(0, 10)) {
    const [x0, y0] = toScr(ep), [x1, y1] = toScr(ep.clone().addScaledVector(back, rad * 3));
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, len = w * (0.25 + tier * 0.04);
    const ex = x0 + dx / L * len, ey = y0 + dy / L * len;
    for (const [wid, al] of [[7, 0.18], [3, 0.35], [1.2, 0.8]]) {
      const g = c.createLinearGradient(x0, y0, ex, ey);
      g.addColorStop(0, `rgba(190,225,255,${al})`); g.addColorStop(0.35, `rgba(110,170,255,${al * 0.5})`); g.addColorStop(1, 'rgba(60,100,255,0)');
      c.strokeStyle = g; c.lineWidth = wid * (0.6 + tier * 0.15); c.lineCap = 'round';
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(ex, ey); c.stroke();
    }
  }
  // подсветка снизу — цвет назначения корабля
  const rc = new THREE.Color(PHOTO_ROLE[role] || 0x80a0ff), band = c.createLinearGradient(0, h, 0, h * 0.62);
  band.addColorStop(0, `rgba(${rc.r * 255 | 0},${rc.g * 255 | 0},${rc.b * 255 | 0},0.22)`); band.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = band; c.fillRect(0, h * 0.62, w, h * 0.38);
  c.globalCompositeOperation = 'source-over';
  const vg = c.createRadialGradient(w * 0.55, h * 0.5, h * 0.35, w * 0.5, h * 0.5, w * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = vg; c.fillRect(0, 0, w, h);
  const url = out.toDataURL('image/jpeg', 0.86);
  renderer.setPixelRatio(pr); renderer.setSize(prev.x, prev.y, false); renderer.toneMappingExposure = exp;
  bgTex.dispose();
  return url;
}

// ---------- для мира поверхности планет (surface.js) ----------
// Отрисовать другую сцену через общий конвейер постэффектов (свечение, цветокоррекция)
export function renderOther(sc, cam) {
  renderer.info.reset();
  if (contextLost) return;
  const rp = composer.passes[0], s0 = rp.scene, c0 = rp.camera;
  godRays.uniforms.l0.value.z = godRays.uniforms.l1.value.z = 0; // проход остаётся — он же защищает от NaN
  rp.scene = sc; rp.camera = cam;
  composer.render();
  rp.scene = s0; rp.camera = c0;
}
export function getRenderer() { return renderer; }
export const SPACE_EXPOSURE = 1.2;
export function setExposure(k) { if (renderer) renderer.toneMappingExposure = k; }
export function getQuality() { return quality; }
export function envMap() { return scene.environment; }
// Корабль, стоящий на поверхности: модель в «посадочном» масштабе (капитальные корабли не закрывают полнеба)
export function landedShip(type, color) {
  const base = SHIP_BASE_R[type] || 50, r = Math.min(18, 8 + Math.sqrt(base) * 0.8);
  return shipModel(type, color, r, 'player');
}
export function starLook(k) { return STAR_LOOK[k] || STAR_LOOK.yellow; }

// Для отладки рендера из консоли браузера
// снимок для фоторежима: кадр рисуется и сразу читается (буфер холста не сохраняется между кадрами)
export function snapshot() { try { composer.render(); return renderer.domElement.toDataURL('image/jpeg', 0.92); } catch (e) { return null; } }
export function debugScene() { return { scene, camera, celGroup, renderer, THREE }; }
