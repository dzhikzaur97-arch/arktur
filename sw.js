// офлайн-кэш ARKTUR, версия 9314220fbe
const CACHE = 'vf-9314220fbe';
const FILES = ["./","index.html","manifest.webmanifest","privacy.html","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","vendor/three/build/three.module.js","vendor/three/examples/jsm/postprocessing/EffectComposer.js","vendor/three/examples/jsm/postprocessing/MaskPass.js","vendor/three/examples/jsm/postprocessing/Pass.js","vendor/three/examples/jsm/postprocessing/ShaderPass.js","vendor/three/examples/jsm/postprocessing/RenderPass.js","vendor/three/examples/jsm/postprocessing/OutputPass.js","vendor/three/examples/jsm/postprocessing/SMAAPass.js","vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js","vendor/three/examples/jsm/postprocessing/AfterimagePass.js","vendor/three/examples/jsm/shaders/AfterimageShader.js","vendor/three/examples/jsm/shaders/CopyShader.js","vendor/three/examples/jsm/shaders/LuminosityHighPassShader.js","vendor/three/examples/jsm/shaders/OutputShader.js","vendor/three/examples/jsm/shaders/SMAAShader.js","vendor/three/examples/jsm/shaders/FXAAShader.js","vendor/three/examples/jsm/geometries/RoundedBoxGeometry.js","vendor/three/examples/jsm/utils/BufferGeometryUtils.js","vendor/three/examples/jsm/loaders/GLTFLoader.js","vendor/three/examples/jsm/libs/fflate.module.js"];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// сначала сеть для страницы (чтобы обновления приходили), без сети — из кэша; остальное — из кэша
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const page = e.request.mode === 'navigate';
  e.respondWith(page
    ? fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); return r; }).catch(() => caches.match('index.html'))
    : caches.match(e.request).then(r => r || fetch(e.request)));
});
