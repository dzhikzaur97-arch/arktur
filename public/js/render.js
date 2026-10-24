// 3D-рендер космоса на three.js. Плавающее начало координат: всё рисуется относительно корабля игрока.
import * as THREE from 'three';

const FAR_START = 1.5e6; // дальше этого расстояния объекты «сжимаются» с сохранением углового размера

let renderer, scene, camera, sunLight, skyTex;
let celGroup, entGroup, fxGroup, warpLines;
const celMeshes = new Map();   // id -> { obj, data }
const entMeshes = new Map();   // id -> { obj, kind, seen }
const fxList = [];
let stationView = null;

export const cam = { yaw: 0.6, pitch: 0.35, dist: 900, target: 900 };

// ---------- генераторы текстур ----------
function seeded(seed) {
  let a = seed >>> 0 || 1;
  return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return ((a >>> 0) % 100000) / 100000; };
}

function makeSky() {
  const W = 2048, H = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#010205'; g.fillRect(0, 0, W, H);
  const r = seeded(1337);
  // туманности
  const neb = [[200, 90, 160], [60, 120, 200], [180, 110, 60], [80, 40, 140], [40, 140, 150]];
  for (let i = 0; i < 70; i++) {
    const x = r() * W, y = H * (0.25 + r() * 0.5), rad = 80 + r() * 320;
    const col = neb[Math.floor(r() * neb.length)];
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(${col},${0.05 + r() * 0.07})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Млечный путь
  for (let i = 0; i < 9000; i++) {
    const x = r() * W, y = H / 2 + (r() + r() + r() - 1.5) * H * 0.18;
    g.fillStyle = `rgba(200,210,255,${r() * 0.18})`;
    g.fillRect(x, y, 1, 1);
  }
  for (let i = 0; i < 5000; i++) {
    const x = r() * W, y = r() * H, b = r();
    const s = b > 0.995 ? 2 : 1;
    g.fillStyle = `rgba(${200 + r() * 55},${200 + r() * 55},255,${0.3 + b * 0.7})`;
    g.fillRect(x, y, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function planetTexture(ptype, hue) {
  const W = 512, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = seeded(Math.floor(hue * 1e6) + 7);
  const palettes = {
    'Каменистая': [[120, 100, 80], [90, 80, 70], [150, 130, 110]],
    'Газовый гигант': [[200, 160, 110], [170, 120, 80], [230, 210, 170]],
    'Ледяная': [[190, 220, 235], [150, 190, 215], [230, 240, 250]],
    'Лавовая': [[60, 20, 10], [200, 70, 20], [30, 15, 10]],
    'Океаническая': [[30, 80, 150], [40, 120, 90], [20, 60, 120]],
    'Пустынная': [[200, 150, 90], [170, 120, 70], [220, 180, 120]]
  };
  const pal = palettes[ptype] || palettes['Каменистая'];
  const gas = ptype === 'Газовый гигант';
  for (let y = 0; y < H; y++) {
    const col = pal[Math.floor((Math.sin(y * (gas ? 0.12 : 0.04) + r() * (gas ? 0.3 : 2)) * 0.5 + 0.5) * 2.99)];
    g.fillStyle = `rgb(${col})`; g.fillRect(0, y, W, 1);
  }
  if (!gas) for (let i = 0; i < 600; i++) {
    const col = pal[Math.floor(r() * 3)];
    g.fillStyle = `rgba(${col},${0.3 + r() * 0.5})`;
    g.beginPath(); g.arc(r() * W, r() * H, 2 + r() * 24, 0, 7); g.fill();
  }
  if (ptype === 'Океаническая' || ptype === 'Ледяная') for (let i = 0; i < 150; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.25})`;
    g.fillRect(r() * W, r() * H, 20 + r() * 80, 2 + r() * 5);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(inner = 'rgba(255,240,200,1)', outer = 'rgba(255,160,60,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner); grd.addColorStop(0.2, inner.replace(/[\d.]+\)$/, '0.6)')); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let GLOW;

// ---------- модели ----------
function shipModel(type, color, radius, npc) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.45, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22282e, metalness: 0.7, roughness: 0.6, flatShading: true });
  const glowCol = npc ? 0xff4422 : 0x55ccff;
  const engMat = new THREE.MeshBasicMaterial({ color: glowCol });
  const R = radius;
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; };
  const engines = [];
  switch (type) {
    case 'burlak': case 'tyagach': {
      add(new THREE.BoxGeometry(R * 0.9, R * 0.6, R * 1.6), mat, 0, 0, 0);
      add(new THREE.BoxGeometry(R * 0.5, R * 0.35, R * 0.5), dark, 0, R * 0.45, R * 0.4);
      add(new THREE.CylinderGeometry(R * 0.25, R * 0.3, R * 0.8, 8), dark, R * 0.6, -R * 0.1, -R * 0.2, Math.PI / 2);
      add(new THREE.CylinderGeometry(R * 0.25, R * 0.3, R * 0.8, 8), dark, -R * 0.6, -R * 0.1, -R * 0.2, Math.PI / 2);
      if (type === 'burlak') add(new THREE.ConeGeometry(R * 0.3, R * 0.6, 6), dark, 0, -R * 0.3, R * 1.0, Math.PI / 2);
      engines.push([R * 0.6, -R * 0.1, -R * 0.65], [-R * 0.6, -R * 0.1, -R * 0.65]);
      break;
    }
    case 'strazh': case 'molot': {
      add(new THREE.ConeGeometry(R * 0.4, R * 2, 6), mat, 0, 0, R * 0.2, Math.PI / 2);
      add(new THREE.BoxGeometry(R * 1.8, R * 0.08, R * 0.7), mat, 0, 0, -R * 0.3);
      add(new THREE.BoxGeometry(R * 0.08, R * 0.7, R * 0.6), dark, 0, R * 0.3, -R * 0.5);
      add(new THREE.CylinderGeometry(R * 0.18, R * 0.22, R * 0.9, 8), dark, R * 0.8, 0, -R * 0.4, Math.PI / 2);
      add(new THREE.CylinderGeometry(R * 0.18, R * 0.22, R * 0.9, 8), dark, -R * 0.8, 0, -R * 0.4, Math.PI / 2);
      if (type === 'molot') {
        add(new THREE.BoxGeometry(R * 0.6, R * 0.5, R * 1.2), mat, 0, R * 0.2, -R * 0.2);
        add(new THREE.BoxGeometry(R * 1.2, R * 0.08, R * 0.5), dark, 0, R * 0.35, R * 0.1);
      }
      engines.push([R * 0.8, 0, -R * 0.85], [-R * 0.8, 0, -R * 0.85], [0, 0, -R * 0.8]);
      break;
    }
    default: {
      add(new THREE.ConeGeometry(R * 0.35, R * 1.8, 5), mat, 0, 0, R * 0.1, Math.PI / 2);
      add(new THREE.BoxGeometry(R * 1.4, R * 0.06, R * 0.5), type === 'klinok' ? dark : mat, 0, 0, -R * 0.4, 0, 0, 0);
      add(new THREE.BoxGeometry(R * 0.06, R * 0.5, R * 0.4), dark, 0, R * 0.25, -R * 0.55);
      if (type === 'klinok') {
        add(new THREE.BoxGeometry(R * 0.08, R * 0.08, R * 0.9), dark, R * 0.5, 0, 0);
        add(new THREE.BoxGeometry(R * 0.08, R * 0.08, R * 0.9), dark, -R * 0.5, 0, 0);
      }
      engines.push([0, 0, -R * 0.8]);
    }
  }
  for (const [x, y, z] of engines) {
    add(new THREE.CircleGeometry(R * 0.14, 10), engMat, x, y, z, 0, Math.PI);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: glowCol, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.set(x, y, z - R * 0.15); s.scale.setScalar(R * 0.8); s.userData.engine = true;
    g.add(s);
  }
  return g;
}

function asteroidModel(radius, seed, color) {
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const r = seeded(seed);
  const pos = geo.attributes.position;
  const offs = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(2)},${pos.getY(i).toFixed(2)},${pos.getZ(i).toFixed(2)}`;
    if (!offs.has(key)) offs.set(key, 0.7 + r() * 0.5);
    const k = offs.get(key);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.8, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.1, flatShading: true }));
  m.rotation.set(r() * 6, r() * 6, r() * 6);
  m.userData.spin = (r() - 0.5) * 0.05;
  return m;
}

function stationModel(style) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: [0x8a96a0, 0xa08a70, 0x7a8a7a][style || 0], metalness: 0.7, roughness: 0.4, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a3036, metalness: 0.8, roughness: 0.5 });
  const lights = new THREE.MeshBasicMaterial({ color: 0xffd890 });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(500, 700, 3000, 12), mat));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2200, 180, 8, 48), mat); ring.rotation.x = Math.PI / 2; g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1400, 90, 6, 40), dark); ring2.rotation.x = Math.PI / 2; ring2.position.y = 700; g.add(ring2);
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(2200, 80, 120), dark);
    sp.rotation.y = i * Math.PI / 3; sp.position.set(Math.cos(i * Math.PI / 3) * 1100, 0, -Math.sin(i * Math.PI / 3) * 1100);
    g.add(sp);
  }
  const top = new THREE.Mesh(new THREE.ConeGeometry(700, 1200, 12), mat); top.position.y = 2100; g.add(top);
  const bot = new THREE.Mesh(new THREE.SphereGeometry(800, 12, 8), dark); bot.position.y = -1600; g.add(bot);
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(30, 4, 3), lights);
    l.position.set(Math.cos(a) * 2200, (i % 2 ? 1 : -1) * 190, Math.sin(a) * 2200); g.add(l);
  }
  g.userData.spinY = 0.02;
  return g;
}

function gateModel() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8090a0, metalness: 0.8, roughness: 0.35, flatShading: true });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1500, 160, 8, 40), mat); g.add(ring);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(1350, 40), new THREE.MeshBasicMaterial({ color: 0x3080ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(inner); g.userData.inner = inner;
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const p = new THREE.Mesh(new THREE.BoxGeometry(300, 900, 300), mat);
    p.position.set(Math.cos(a) * 1750, Math.sin(a) * 1750, 0); p.rotation.z = a; g.add(p);
  }
  return g;
}

function wreckModel(radius) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x3a3430, metalness: 0.6, roughness: 0.8, flatShading: true });
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(radius * (0.3 + Math.random()), radius * 0.2, radius * (0.2 + Math.random() * 0.5)), m);
    b.position.set((Math.random() - 0.5) * radius, (Math.random() - 0.5) * radius * 0.5, (Math.random() - 0.5) * radius);
    b.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); g.add(b);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xff8030, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  s.scale.setScalar(radius * 1.5); g.add(s); g.userData.flicker = s;
  return g;
}

// ---------- инициализация ----------
export function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  scene = new THREE.Scene();
  GLOW = glowTexture();
  skyTex = makeSky();
  scene.background = skyTex;
  camera = new THREE.PerspectiveCamera(60, 1, 1, 5e9);
  scene.add(new THREE.AmbientLight(0x6a7488, 1.6));
  scene.add(new THREE.HemisphereLight(0x8090b0, 0x302820, 0.6));
  sunLight = new THREE.DirectionalLight(0xfff4e0, 2.6);
  scene.add(sunLight); scene.add(sunLight.target);
  celGroup = new THREE.Group(); entGroup = new THREE.Group(); fxGroup = new THREE.Group();
  scene.add(celGroup, entGroup, fxGroup);
  // линии варп-туннеля
  const n = 400, arr = new Float32Array(n * 6);
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  warpLines = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  warpLines.frustumCulled = false; warpLines.userData.seed = Array.from({ length: n }, () => [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random()]);
  scene.add(warpLines);
  resize();
  addEventListener('resize', resize);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}

// ---------- система ----------
export function setSystem(sys) {
  for (const { obj } of celMeshes.values()) celGroup.remove(obj);
  celMeshes.clear();
  for (const id of [...entMeshes.keys()]) removeEnt(id);
  for (const c of sys.celestials) {
    let obj = null;
    if (c.kind === 'sun') {
      obj = new THREE.Group();
      obj.add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff2d0 })));
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xffd8a0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      s.scale.setScalar(8); obj.add(s);
      obj.userData.unit = true;
    } else if (c.kind === 'planet') {
      obj = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshStandardMaterial({ map: planetTexture(c.ptype, c.hue), roughness: 0.9 }));
      obj.userData.unit = true;
      obj.rotation.z = 0.3;
    } else if (c.kind === 'station') obj = stationModel(c.style);
    else if (c.kind === 'gate') obj = gateModel();
    if (!obj) continue;
    celGroup.add(obj);
    celMeshes.set(c.id, { obj, data: c });
  }
}

// ---------- сущности ----------
function makeEnt(e, data) {
  let obj, kind = e.k;
  if (e.k === 's') {
    const t = data.ships[e.st];
    const col = e.gd ? 0x9fd0ff : e.npc ? 0x7a3a34 : t.color;
    obj = shipModel(e.st, col, e.r || t.radius, e.npc);
  } else if (e.k === 'a') {
    obj = asteroidModel(e.r, e.sd, data.items[e.ore].color || 0x888888);
  } else if (e.k === 'w') obj = wreckModel(e.r || 60);
  else return null;
  entGroup.add(obj);
  const rec = { obj, kind, seen: 0 };
  entMeshes.set(e.id, rec);
  return rec;
}
function removeEnt(id) {
  const r = entMeshes.get(id);
  if (!r) return;
  entGroup.remove(r.obj);
  r.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  entMeshes.delete(id);
}

let myShip = null, myShipType = null;
export function setMyShip(type, data) {
  if (myShip && myShipType === type) return;
  if (myShip) entGroup.remove(myShip);
  myShipType = type;
  if (!type) { myShip = null; return; }
  const t = data.ships[type];
  cam.target = cam.dist = t.radius * 14;
  myShip = shipModel(type, t.color, t.radius, false);
  entGroup.add(myShip);
}

const tmpV = new THREE.Vector3();
function placeFar(obj, rel, radius, isUnit) {
  // rel — относительная позиция (массив, double). Сжимаем далёкие объекты.
  const d = Math.hypot(rel[0], rel[1], rel[2]);
  let k = 1;
  if (d > FAR_START) { const rd = FAR_START * (1 + Math.log(d / FAR_START)); k = rd / d; }
  obj.position.set(rel[0] * k, rel[1] * k, rel[2] * k);
  if (isUnit) obj.scale.setScalar(radius * k);
  else obj.scale.setScalar(k);
}

// Кадр. view: { origin, me, ents(Map id->{...,dp(отобр. позиция)}), sys, data, warp, docked }
export function frame(view, dt, time) {
  const origin = view.origin;
  // камера
  cam.dist += (cam.target - cam.dist) * Math.min(1, dt * 8);
  const cp = Math.cos(cam.pitch);
  camera.position.set(Math.sin(cam.yaw) * cp * cam.dist, Math.sin(cam.pitch) * cam.dist, Math.cos(cam.yaw) * cp * cam.dist);
  camera.lookAt(0, 0, 0);
  camera.near = Math.max(1, cam.dist * 0.01);
  camera.updateProjectionMatrix();

  if (view.docked) { stationFrame(view, dt, time); return; }
  if (stationView) { scene.remove(stationView); stationView = null; celGroup.visible = true; entGroup.visible = true; }

  // солнце-свет
  const sunRel = [-origin[0], -origin[1], -origin[2]];
  const sl = Math.hypot(...sunRel) || 1;
  sunLight.position.set(sunRel[0] / sl * 1e5, sunRel[1] / sl * 1e5, sunRel[2] / sl * 1e5);
  sunLight.target.position.set(0, 0, 0);

  for (const [id, { obj, data }] of celMeshes) {
    const rel = [data.pos[0] - origin[0], data.pos[1] - origin[1], data.pos[2] - origin[2]];
    placeFar(obj, rel, data.radius, obj.userData.unit);
    if (obj.userData.spinY) obj.rotation.y += obj.userData.spinY * dt;
    if (data.kind === 'gate') {
      // врата смотрят на солнце
      tmpV.set(-data.pos[0], -data.pos[1], -data.pos[2]).normalize().add(obj.position);
      obj.lookAt(tmpV);
      obj.userData.inner.material.opacity = 0.15 + 0.08 * Math.sin(time * 2);
    }
    if (data.kind === 'planet') obj.rotation.y += dt * 0.003;
  }

  // свой корабль
  if (myShip) {
    myShip.position.set(0, 0, 0);
    const h = view.me.h;
    tmpV.set(h[0], h[1], h[2]);
    if (tmpV.lengthSq() > 0.01) myShip.lookAt(tmpV);
    myShip.visible = true;
    engineGlow(myShip, Math.hypot(...view.me.v) / (view.me.max.spd || 1), time);
  }

  // остальные
  for (const rec of entMeshes.values()) rec.seen = 0;
  for (const e of view.ents.values()) {
    let rec = entMeshes.get(e.id) || makeEnt(e, view.data);
    if (!rec) continue;
    rec.seen = 1;
    const rel = [e.dp[0] - origin[0], e.dp[1] - origin[1], e.dp[2] - origin[2]];
    rec.obj.position.set(rel[0], rel[1], rel[2]);
    if (e.k === 's') {
      if (e.h) { tmpV.set(rel[0] + e.h[0], rel[1] + e.h[1], rel[2] + e.h[2]); rec.obj.lookAt(tmpV); }
      rec.obj.visible = !e.w || Math.hypot(...rel) < 2e6;
      engineGlow(rec.obj, e.v ? Math.hypot(...e.v) / 300 : 0, time);
    } else if (e.k === 'a') {
      rec.obj.rotation.y += rec.obj.userData.spin * dt;
    } else if (e.k === 'w') {
      rec.obj.userData.flicker.material.opacity = 0.4 + 0.4 * Math.random();
    }
  }
  for (const [id, rec] of [...entMeshes]) if (!rec.seen) removeEnt(id);

  updateFx(view, dt, origin);
  updateWarp(view, dt);
  renderer.render(scene, camera);
}

function engineGlow(obj, frac, time) {
  const f = Math.min(1.2, Math.max(0.15, frac));
  obj.traverse(o => { if (o.userData.engine) o.material.opacity = f * (0.8 + 0.2 * Math.sin(time * 30 + o.id)); });
}

// ---------- вид станции (при стыковке) ----------
function stationFrame(view, dt, time) {
  if (!stationView) {
    stationView = new THREE.Group();
    const st = stationModel(view.docked.style || 0);
    stationView.add(st);
    stationView.userData.st = st;
    if (view.dockedShip) {
      const t = view.data.ships[view.dockedShip];
      const sh = shipModel(view.dockedShip, t.color, t.radius, false);
      sh.scale.setScalar(900 / t.radius);
      sh.position.set(0, -2400, 3600);
      stationView.add(sh); stationView.userData.ship = sh;
    }
    scene.add(stationView);
    celGroup.visible = false; entGroup.visible = false;
    sunLight.position.set(1, 0.6, 0.8).multiplyScalar(1e5);
  }
  if (view.dockedShip && stationView.userData.shipType !== view.dockedShip) {
    if (stationView.userData.ship) stationView.remove(stationView.userData.ship);
    const t = view.data.ships[view.dockedShip];
    const sh = shipModel(view.dockedShip, t.color, t.radius, false);
    sh.scale.setScalar(900 / t.radius); sh.position.set(0, -2400, 3600);
    stationView.add(sh); stationView.userData.ship = sh; stationView.userData.shipType = view.dockedShip;
  }
  stationView.userData.st.rotation.y += dt * 0.05;
  if (stationView.userData.ship) stationView.userData.ship.rotation.y = time * 0.15;
  camera.position.set(Math.sin(time * 0.03) * 12000, 2500, Math.cos(time * 0.03) * 12000);
  camera.lookAt(0, -500, 0);
  camera.near = 50; camera.updateProjectionMatrix();
  warpLines.material.opacity = 0;
  renderer.render(scene, camera);
}

// ---------- эффекты ----------
function entRel(view, id, origin) {
  if (id === view.me.id) return new THREE.Vector3(0, 0, 0);
  const e = view.ents.get(id);
  if (!e) return null;
  return new THREE.Vector3(e.dp[0] - origin[0], e.dp[1] - origin[1], e.dp[2] - origin[2]);
}

export function addFx(fx, view) {
  const origin = view.origin;
  if (fx.k === 'beam' || fx.k === 'mine') {
    const col = new THREE.Color(fx.color || 0xff4040);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    fxGroup.add(mesh);
    const miss = fx.hit === false ? new THREE.Vector3((Math.random() - 0.5) * 600, (Math.random() - 0.5) * 600, (Math.random() - 0.5) * 600) : null;
    fxList.push({ mesh, from: fx.from, to: fx.to, t: 0, dur: fx.dur || 1, kind: fx.k, miss });
    if (fx.hit) {
      const p = entRel(view, fx.to, origin);
      if (p) spark(p, fx.color, fx.to);
    }
  } else if (fx.k === 'boom') {
    const p = new THREE.Vector3(fx.pos[0] - origin[0], fx.pos[1] - origin[1], fx.pos[2] - origin[2]);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xffa040, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    s.position.copy(p); fxGroup.add(s);
    const ring = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), new THREE.MeshBasicMaterial({ color: 0xff7030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true }));
    ring.position.copy(p); fxGroup.add(ring);
    fxList.push({ sprite: s, ring, abs: fx.pos, t: 0, dur: 2.2, kind: 'boom', size: fx.size || 300 });
  } else if (fx.k === 'jump') {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0x60b0ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    fxGroup.add(s);
    fxList.push({ sprite: s, abs: fx.pos, t: 0, dur: 1.5, kind: 'flash', size: 6000 });
  }
}

function spark(p, color, id) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: color || 0xffaa66, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  fxGroup.add(s);
  fxList.push({ sprite: s, follow: id, t: 0, dur: 0.6, kind: 'spark', size: 120 });
}

function updateFx(view, dt, origin) {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i];
    f.t += dt;
    const k = f.t / f.dur;
    if (k >= 1) {
      if (f.mesh) { fxGroup.remove(f.mesh); f.mesh.geometry.dispose(); }
      if (f.sprite) fxGroup.remove(f.sprite);
      if (f.ring) fxGroup.remove(f.ring);
      fxList.splice(i, 1); continue;
    }
    if (f.mesh) {
      const a = entRel(view, f.from, origin), b = entRel(view, f.to, origin);
      if (!a || !b) { f.t = f.dur; continue; }
      if (f.miss) b.add(f.miss);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const d = a.distanceTo(b);
      f.mesh.position.copy(mid);
      f.mesh.lookAt(b); f.mesh.rotateX(Math.PI / 2);
      const w = Math.max(2, cam.dist * 0.0025) * (f.kind === 'mine' ? 1.4 + 0.4 * Math.sin(f.t * 12) : 1);
      f.mesh.scale.set(w, d, w);
      f.mesh.material.opacity = f.kind === 'mine' ? 0.6 : (1 - k) * 0.95;
    }
    if (f.kind === 'boom') {
      const p = [f.abs[0] - origin[0], f.abs[1] - origin[1], f.abs[2] - origin[2]];
      f.sprite.position.set(...p); f.ring.position.set(...p);
      f.sprite.scale.setScalar(f.size * (0.5 + k * 3)); f.sprite.material.opacity = 1 - k;
      f.ring.scale.setScalar(f.size * k * 4); f.ring.material.opacity = (1 - k) * 0.5;
    } else if (f.kind === 'flash') {
      f.sprite.position.set(f.abs[0] - origin[0], f.abs[1] - origin[1], f.abs[2] - origin[2]);
      f.sprite.scale.setScalar(f.size * (0.3 + k)); f.sprite.material.opacity = 1 - k;
    } else if (f.kind === 'spark') {
      const p = entRel(view, f.follow, origin);
      if (p) f.sprite.position.copy(p);
      f.sprite.scale.setScalar(Math.max(f.size, cam.dist * 0.04) * (1 + k)); f.sprite.material.opacity = 1 - k;
    }
  }
}

function updateWarp(view, dt) {
  const w = view.me && view.me.warp;
  const m = warpLines.material;
  const target = w && w.prog > 0.05 && w.prog < 0.95 ? 0.8 : 0;
  m.opacity += (target - m.opacity) * Math.min(1, dt * 4);
  camera.fov += ((target ? 75 : 60) - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
  if (m.opacity < 0.01) { warpLines.visible = false; return; }
  warpLines.visible = true;
  const v = view.me.v;
  const dir = new THREE.Vector3(v[0], v[1], v[2]).normalize();
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const s1 = new THREE.Vector3().crossVectors(dir, up).normalize();
  const s2 = new THREE.Vector3().crossVectors(dir, s1).normalize();
  const arr = warpLines.geometry.attributes.position.array;
  const R = cam.dist * 3, L = cam.dist * 30;
  warpLines.userData.seed.forEach((sd, i) => {
    sd[2] -= dt * 2.5; if (sd[2] < -1) sd[2] += 2;
    const base = s1.clone().multiplyScalar(sd[0] * R).add(s2.clone().multiplyScalar(sd[1] * R)).add(dir.clone().multiplyScalar(sd[2] * L));
    const tail = base.clone().add(dir.clone().multiplyScalar(-L * 0.08));
    arr.set([base.x, base.y, base.z, tail.x, tail.y, tail.z], i * 6);
  });
  warpLines.geometry.attributes.position.needsUpdate = true;
}

// ---------- утилиты для интерфейса ----------
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
