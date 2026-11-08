// Публичная устанавливаемая версия (PWA) для бесплатной публикации, например на GitHub Pages.
// Запуск: node tools/build-public.js  →  dist/site/
//  · игра целиком в index.html (как одиночная сборка), но three.js лежит рядом в vendor/ — без интернета работает;
//  · manifest.webmanifest + иконки — «Установить приложение» на Android, «На экран Домой» на iPhone;
//  · sw.js — офлайн-кэш и обновление при следующем запуске;
//  · privacy.html — политика конфиденциальности (игра ничего не собирает).
// Функции, работающие только на claude.ai (живые NPC, помощник, облако, друзья), в этой версии скрыты.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist/site');
const CFG = { author: process.env.VF_AUTHOR || 'Salamov Rustam', title: 'ARKTUR: Космический рубеж', short: 'ARKTUR',
  desc: 'Космическая песочница: добыча, торговля, бои, войны фракций, планеты и тайны Предтеч. Бесплатно, без рекламы, работает без интернета.' };
const THREE_VER = require(path.join(ROOT, 'node_modules/three/package.json')).version;
// файлы three.js, которые нужны игре (с зависимостями эффектов)
const THREE_FILES = ['build/three.module.js', 'LICENSE',
  ...['EffectComposer', 'MaskPass', 'Pass', 'ShaderPass', 'RenderPass', 'OutputPass', 'SMAAPass', 'UnrealBloomPass', 'AfterimagePass'].map(f => `examples/jsm/postprocessing/${f}.js`),
  ...['AfterimageShader', 'CopyShader', 'LuminosityHighPassShader', 'OutputShader', 'SMAAShader', 'FXAAShader'].map(f => `examples/jsm/shaders/${f}.js`),
  'examples/jsm/geometries/RoundedBoxGeometry.js', 'examples/jsm/utils/BufferGeometryUtils.js', 'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/libs/fflate.module.js'];

// 1) обычная одиночная сборка
execFileSync(process.execPath, [path.join(__dirname, 'build-standalone.js')], { stdio: 'inherit' });
let page = fs.readFileSync(path.join(ROOT, 'dist/void-frontier.html'), 'utf8');

// 2) three.js — из соседней папки, не из интернета
const cdn = `https://cdn.jsdelivr.net/npm/three@${THREE_VER}/`;
if (!page.includes(cdn)) throw new Error('не найдена ссылка на three.js в сборке');
page = page.split(cdn).join('./vendor/three/'); // в карте импортов путь обязан начинаться с ./

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
for (const f of THREE_FILES) {
  const to = path.join(OUT, 'vendor/three', f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'node_modules/three', f), to);
}

// 3) иконки
execFileSync('python3', [path.join(__dirname, 'make-icons.py'), path.join(OUT, 'icons')], { stdio: 'inherit' });

// 4) страница
const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob: wss: ws:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="${CFG.desc}">
<meta name="theme-color" content="#060c18">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${CFG.short}">
<meta name="author" content="${CFG.author} и Claude">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<style>html,body{margin:0;padding:0;background:#02040a;height:100%;overflow:hidden}</style>
<script>window.VF_EDITION = 'public'; window.VF_AUTHOR = ${JSON.stringify(CFG.author)};</script>
</head>
<body>
${page}
<script>
// офлайн-кэш и установка; новая версия подхватывается при следующем запуске
if ('serviceWorker' in navigator && location.protocol !== 'file:') addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);

// 5) описание приложения
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify({
  id: './', name: CFG.title, short_name: CFG.short, description: CFG.desc, lang: 'ru', dir: 'ltr',
  start_url: './', scope: './', display: 'fullscreen', display_override: ['fullscreen', 'standalone'], orientation: 'any',
  background_color: '#02040a', theme_color: '#060c18', categories: ['games'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2));

// 6) политика конфиденциальности
fs.writeFileSync(path.join(OUT, 'privacy.html'), `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${CFG.title} — конфиденциальность</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px;background:#06101e;color:#d8e4f0}a{color:#7fd0ff}h1{font-size:24px}</style></head><body>
<h1>Политика конфиденциальности ${CFG.title}</h1>
<p>${CFG.title} — бесплатная игра. Её создали ${CFG.author} и Claude (ИИ-ассистент Anthropic).</p>
<ul>
<li>Игра <b>не собирает и не отправляет</b> никаких данных: нет аналитики, рекламы, учётных записей на сервере и сторонних трекеров.</li>
<li>Прогресс, настройки и сохранения хранятся <b>только на вашем устройстве</b> (в хранилище браузера). Их можно выгрузить в файл и загрузить обратно в меню «Сохранения».</li>
<li>Имя пилота и пароль, которые вы вводите, нужны только для разделения пилотов на этом устройстве и никуда не передаются.</li>
<li>Удалить все данные игры можно, очистив данные сайта в настройках браузера или удалив приложение.</li>
</ul>
<p><a href="./">← Вернуться в игру</a></p>
</body></html>
`);

// 7) офлайн-кэш: список файлов с версией (меняется при каждой сборке — так игроки получают обновления)
const files = ['./', 'index.html', 'manifest.webmanifest', 'privacy.html', ...fs.readdirSync(path.join(OUT, 'icons')).map(f => 'icons/' + f),
  ...THREE_FILES.filter(f => f.endsWith('.js')).map(f => 'vendor/three/' + f)];
const ver = crypto.createHash('sha1').update(html).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(OUT, 'sw.js'), `// офлайн-кэш ARKTUR, версия ${ver}
const CACHE = 'vf-${ver}';
const FILES = ${JSON.stringify(files)};
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
`);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
// подтверждение сайта для приложения в Google Play (см. publish/google-play/README.md)
const links = path.join(ROOT, 'publish/google-play/assetlinks.json');
if (fs.existsSync(links)) { fs.mkdirSync(path.join(OUT, '.well-known'), { recursive: true }); fs.copyFileSync(links, path.join(OUT, '.well-known/assetlinks.json')); console.log('assetlinks.json добавлен в .well-known/'); }
// 8) README для репозитория и лицензия
fs.writeFileSync(path.join(OUT, 'README.md'), `# ${CFG.title}

${CFG.desc}

**Создатели игры: ${CFG.author} и Claude** (ИИ-ассистент Anthropic) — вместе, от первой строчки до последней.

## Как установить
- **Android (Chrome):** откройте страницу игры → меню ⋮ → «Установить приложение» (или «Добавить на главный экран»).
- **iPhone / iPad (Safari):** откройте страницу → кнопка «Поделиться» → «На экран Домой».
- **Компьютер (Chrome, Edge):** значок установки в адресной строке — или просто играйте в браузере.

Языки: **русский и английский** (переключатель на экране входа).

После первого запуска игра работает **без интернета**. Сохранения хранятся на вашем устройстве; их можно выгрузить в файл в меню «Сохранения».

## Что в игре
Полёт и бои в духе EVE Online, добыча и торговля, 30+ кораблей, производство по чертежам, война трёх фракций за системы,
напарники, мировые события с боссами, аномалии Предтеч, посадка на планеты, две сюжетные кампании, карьера пилота и достижения.

Игра бесплатная, без рекламы и покупок, и не собирает никаких данных — см. [политику конфиденциальности](privacy.html).

## Технологии
3D-графика — [three.js](https://threejs.org) (лицензия MIT). Вся вселенная, корабли и планеты генерируются кодом.
`);
fs.writeFileSync(path.join(OUT, 'LICENSE'), `MIT License

Copyright (c) ${new Date().getFullYear()} ${CFG.author} и Claude (Anthropic)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`);
const size = (p) => fs.statSync(path.join(OUT, p)).size;
console.log(`dist/site готов: index.html ${(size('index.html') / 1024).toFixed(0)} КБ, three.js ${(size('vendor/three/build/three.module.js') / 1024).toFixed(0)} КБ, версия кэша ${ver}`);
