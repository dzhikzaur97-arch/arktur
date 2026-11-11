// Публичные сборки игры для разных площадок. Игра одна и та же (одиночная сборка: вселенная работает в браузере),
// различаются только обёртка страницы и настройки платформы (window.VF_PLATFORM):
//   web        → dist/site                 сайт (GitHub Pages): PWA, офлайн-кэш, установка на телефон
//   itch       → dist/targets/itch         itch.io HTML5: всё в корне архива, относительные пути, работает в iframe
//   crazygames → dist/targets/crazygames   CrazyGames Basic Launch: без SDK и рекламы, английский по умолчанию
//   poki       → dist/targets/poki         Poki (первая заявка): английский, без свободного чата; Poki SDK — после принятия
//   yandex     → dist/targets/yandex       Яндекс Игры: /sdk.js, язык из SDK, LoadingAPI, пауза от платформы
//   desktop    → dist/targets/desktop      файлы для Electron-приложения (desktop/), без сети
// Запуск: node tools/build-public.js [--target=web|itch|crazygames|poki|yandex|desktop|all] [--skip-standalone]
// Без параметров — только web (как раньше). Архивы и проверка лимитов площадок — tools/build-release.js.
// Функции, работающие только на claude.ai (Claude: живые NPC, помощник, облако, друзья), во всех этих сборках выключены.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const CFG = { author: process.env.VF_AUTHOR || 'Salamov Rustam', title: 'ARKTUR: Космический рубеж', titleEn: 'ARKTUR: Space Frontier', short: 'ARKTUR',
  desc: 'Космическая песочница: добыча, торговля, бои, войны фракций, планеты и тайны Предтеч. Бесплатно, без рекламы, работает без интернета.',
  descEn: 'Single-player space sandbox: mining, trading, combat, faction wars, planets and Precursor mysteries. Free, no ads, works offline.' };
const THREE_VER = require(path.join(ROOT, 'node_modules/three/package.json')).version;
const THREE_FILES = require('./three-files.js');
const MUSIC_DIR = path.join(ROOT, 'public/audio/music');
const MUSIC = fs.existsSync(MUSIC_DIR) ? Object.fromEntries(fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith('.mp3')).map(f => [f.slice(0, -4), f])) : {}; // файлы three.js, которые нужны игре (с зависимостями эффектов)

// Настройки площадок. lang — язык по умолчанию (выбор игрока в настройках важнее); noChat — без свободного чата
// (сообщения игры остаются); noFullscreen — без своей кнопки «Во весь экран» (у портала своя); noExternal — без внешних ссылок;
// pauseOnBlur — пауза игры и звука, когда вкладка/окно не в фокусе; noAI — Claude не вызывается никогда.
const TARGETS = {
  web:        { out: 'dist/site', pwa: true, privacy: 'web' },
  itch:       { out: 'dist/targets/itch', noChat: true, privacy: 'itch' },
  crazygames: { out: 'dist/targets/crazygames', lang: 'en', noChat: true, noFullscreen: true, noExternal: true, pauseOnBlur: true, privacy: 'crazygames' },
  poki:       { out: 'dist/targets/poki', lang: 'en', noChat: true, noFullscreen: true, noExternal: true, pauseOnBlur: true, privacy: 'poki' },
  yandex:     { out: 'dist/targets/yandex', yandex: true, noChat: true, noFullscreen: true, noExternal: true, pauseOnBlur: true, privacy: 'yandex' },
  desktop:    { out: 'dist/targets/desktop', noExternal: true, icons: true, privacy: 'desktop' }
};

const args = process.argv.slice(2);
const argTarget = (args.find(a => a.startsWith('--target=')) || '--target=web').slice(9);
const ids = argTarget === 'all' ? Object.keys(TARGETS) : argTarget.split(',');
for (const id of ids) if (!TARGETS[id]) throw new Error('неизвестная цель сборки: ' + id);

// 1) обычная одиночная сборка (один раз на все цели)
if (!args.includes('--skip-standalone')) execFileSync(process.execPath, [path.join(__dirname, 'build-standalone.js')], { stdio: 'inherit' });
const STANDALONE = fs.readFileSync(path.join(ROOT, 'dist/void-frontier.html'), 'utf8');
// three.js — из соседней папки, не из интернета
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VER}/`;
if (!STANDALONE.includes(CDN)) throw new Error('не найдена ссылка на three.js в сборке');
const PAGE = STANDALONE.split(CDN).join('./vendor/three/'); // в карте импортов путь обязан начинаться с ./
if (/https?:\/\/(?!threejs\.org)/.test(PAGE.replace(/<!--[\s\S]*?-->/g, '').match(/<script type="importmap">[\s\S]*?<\/script>/)[0])) throw new Error('в карте импортов остался внешний адрес');

// иконки — один раз
const ICONS = path.join(ROOT, 'dist/.icons');
if (!fs.existsSync(path.join(ICONS, 'icon-512.png'))) { fs.mkdirSync(ICONS, { recursive: true }); execFileSync(PY, [path.join(__dirname, 'make-icons.py'), ICONS], { stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } }); }

const CSP_BASE = {
  'default-src': ["'self'"], 'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'], 'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'], 'media-src': ["'self'", 'data:', 'blob:'], 'font-src': ["'self'", 'data:'], 'connect-src': ["'self'", 'data:', 'blob:'],
  'worker-src': ["'self'", 'blob:'], 'manifest-src': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'self'"], 'form-action': ["'none'"]
};
// Яндекс SDK подключается как /sdk.js с домена игры и догружает свои части с доменов Яндекса (разные национальные зоны).
// Скрипты — только с доменов Яндекса; соединения, фреймы и картинки SDK — по https.
const YA_HOSTS = ['https://yandex.ru', 'https://*.yandex.ru', 'https://yandex.com', 'https://*.yandex.com', 'https://*.yandex.com.tr', 'https://*.yandex.kz',
  'https://*.yandex.by', 'https://*.yandex.uz', 'https://*.yandex.net', 'https://yastatic.net', 'https://*.yastatic.net', 'https://*.yandex-team.ru'];
function csp(t) {
  const c = JSON.parse(JSON.stringify(CSP_BASE));
  if (t.pwa) c['connect-src'].push('wss:', 'ws:'); // сайт может подключаться к онлайн-серверу игры
  if (t.yandex) {
    c['script-src'].push(...YA_HOSTS); c['connect-src'].push('https:', 'wss:'); c['img-src'].push('https:'); c['style-src'].push('https:');
    c['font-src'].push('https:'); c['frame-src'] = ["'self'", 'https:']; c['media-src'].push('https:');
  }
  return Object.entries(c).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

// Политика конфиденциальности: общая часть + что делает площадка. Внутри игровых архивов — без гиперссылок (порталы их не любят).
// Политика конфиденциальности по площадкам. Один источник текста: отдельная страница privacy.html и окно внутри игры
// (window.VF_PRIVACY — ссылка на экране входа и кнопка в «Помощь → Об игре»). Без гиперссылок: порталы их не любят.
const AI_RU = `Игру создали ${CFG.author} и Claude — ИИ-ассистент компании Anthropic, с помощью которого написан код игры. Эта версия игры к Claude и другим ИИ-сервисам не подключается.`;
const AI_EN = `The game was made by ${CFG.author} together with Claude, Anthropic's AI assistant, which helped write the game's code. This version of the game does not connect to Claude or any other AI service.`;
const LOCAL_RU = ['Прогресс, настройки и сохранения хранятся <b>в хранилище браузера на вашем устройстве</b>. Их можно выгрузить в файл и загрузить обратно в меню «Сохранения».',
  'Имя пилота и пароль, которые вы вводите в игре, нужны только чтобы разделять пилотов на этом устройстве, и игрой никуда не передаются.'];
const LOCAL_EN = ['Progress, settings and saves are stored <b>in your browser storage on your device</b>. You can export them to a file and import them back in the Saves menu.',
  'The pilot name and password you enter in the game only separate pilots on this device and are not sent anywhere by the game.'];
const NODATA_RU = 'Игра бесплатная. В ней <b>нет рекламы, покупок, аналитики и сторонних трекеров</b>, и сама игра <b>не собирает и не отправляет</b> данные.';
const NODATA_EN = 'The game is free. It has <b>no ads, purchases, analytics or third-party trackers</b>, and the game itself <b>collects and sends no data</b>.';
const PRIV = {
  web: { ru: [NODATA_RU, ...LOCAL_RU, 'Сайт игры размещён на GitHub Pages. GitHub, как любой хостинг, может записывать технические данные запросов (например, IP-адрес) по своей политике конфиденциальности.', 'Кнопка «Отправить на GitHub» в окне «Сообщить о проблеме» открывает страницу отзывов игры на GitHub с текстом отчёта (модель устройства и видеокарты, последние ошибки игры, имя пилота и место в игре). Отправлять ли его, решаете вы; отправленный отзыв виден всем, а GitHub обрабатывает данные по своей политике конфиденциальности.'],
         en: [NODATA_EN, ...LOCAL_EN, 'The game website is hosted on GitHub Pages. Like any host, GitHub may log technical request data (such as IP addresses) under its own privacy policy.', 'The «Send to GitHub» button in the «Report a problem» window opens the game feedback page on GitHub with the report text (device and GPU model, recent game errors, pilot name and in-game location). Whether to submit it is up to you; submitted feedback is public, and GitHub processes data under its own privacy policy.'] },
  itch: { ru: [NODATA_RU, ...LOCAL_RU, 'Игра размещена на itch.io. Сайт itch.io обрабатывает данные посетителей по своей политике конфиденциальности; сама игра ему ничего не передаёт.', 'Кнопка «Отправить на GitHub» в окне «Сообщить о проблеме» открывает страницу отзывов игры на GitHub с текстом отчёта (модель устройства и видеокарты, последние ошибки игры, имя пилота и место в игре). Отправлять ли его, решаете вы; отправленный отзыв виден всем, а GitHub обрабатывает данные по своей политике конфиденциальности.'],
          en: [NODATA_EN, ...LOCAL_EN, 'The game is hosted on itch.io. itch.io processes visitor data under its own privacy policy; the game itself sends it nothing.', 'The «Send to GitHub» button in the «Report a problem» window opens the game feedback page on GitHub with the report text (device and GPU model, recent game errors, pilot name and in-game location). Whether to submit it is up to you; submitted feedback is public, and GitHub processes data under its own privacy policy.'] },
  crazygames: { ru: [NODATA_RU, ...LOCAL_RU, 'Игра размещена на CrazyGames. Портал обрабатывает данные посетителей по своей политике конфиденциальности. Игра не подключает SDK портала, не показывает рекламу и ничего порталу не передаёт.'],
                en: [NODATA_EN, ...LOCAL_EN, 'The game is hosted on CrazyGames. The portal processes visitor data under its own privacy policy. The game does not include the portal SDK, shows no ads and sends the portal nothing.'] },
  poki: { ru: [NODATA_RU, ...LOCAL_RU, 'Игра размещается на Poki. Портал обрабатывает данные посетителей по своей политике конфиденциальности. Эта сборка не подключает SDK портала и ничего ему не передаёт.'],
          en: [NODATA_EN, ...LOCAL_EN, 'The game is hosted on Poki. The portal processes visitor data under its own privacy policy. This build does not include the portal SDK and sends the portal nothing.'] },
  // Яндекс: игра подключает SDK платформы — честно перечисляем, что уходит платформе; не обещаем «никаких данных и аналитики»
  yandex: {
    ru: ['Игра бесплатная. <b>Сама игра не показывает рекламу и не продаёт покупки.</b> Платформа Яндекс Игры может показывать собственный контент, в том числе рекламу при запуске, по своим правилам.',
      'Игра работает на платформе Яндекс Игры и подключает <b>Yandex Games SDK</b>. Через SDK игра сообщает платформе: что игра загрузилась и готова (LoadingAPI.ready); когда игровой процесс идёт и когда остановлен — пауза, меню, сворачивание вкладки (GameplayAPI start/stop). Из SDK игра получает язык интерфейса и сигналы паузы платформы.',
      'Яндекс как платформа собирает и обрабатывает данные — например, технические данные устройства и браузера, IP-адрес, статистику запусков и времени в игре — по <b>своим правилам и политике конфиденциальности</b>. Разработчик игры может видеть в консоли Яндекс Игр обобщённую статистику игры, которую формирует платформа.',
      'Игра не запрашивает вход в аккаунт Яндекса, не использует облачные сохранения Яндекса и не передаёт свои сохранения ни Яндексу, ни разработчику.',
      ...LOCAL_RU,
      'Вопросы о данных платформы — к Яндексу; вопросы об игре — через страницу игры на Яндекс Играх.'],
    en: ['The game is free. <b>The game itself shows no ads and sells nothing.</b> The Yandex Games platform may show its own content, including an ad at launch, under its own rules.',
      'The game runs on Yandex Games and includes the <b>Yandex Games SDK</b>. Through the SDK the game tells the platform: that it has loaded and is ready (LoadingAPI.ready); when gameplay is running and when it is stopped — pause, menu, tab hidden (GameplayAPI start/stop). From the SDK the game receives the interface language and the platform pause signals.',
      'As a platform, Yandex collects and processes data — such as technical device and browser data, IP address, launch and play-time statistics — under <b>its own rules and privacy policy</b>. The game developer may see aggregated game statistics produced by the platform in the Yandex Games console.',
      'The game does not ask for a Yandex login, does not use Yandex cloud saves and does not send its saves to Yandex or to the developer.',
      ...LOCAL_EN,
      'Questions about platform data — to Yandex; questions about the game — via the game page on Yandex Games.'] },
  desktop: { ru: [NODATA_RU, 'Приложение для Windows работает без интернета: оно не устанавливает сетевых соединений. Сохранения хранятся в папке данных приложения на вашем компьютере (%APPDATA%\\ARKTUR); удалить их можно, удалив приложение и эту папку.', 'Имя пилота и пароль, которые вы вводите в игре, нужны только чтобы разделять пилотов на этом компьютере, и никуда не передаются.', 'Кнопка «Отправить на GitHub» в окне «Сообщить о проблеме» открывает страницу отзывов игры на GitHub с текстом отчёта (модель устройства и видеокарты, последние ошибки игры, имя пилота и место в игре). Отправлять ли его, решаете вы; отправленный отзыв виден всем, а GitHub обрабатывает данные по своей политике конфиденциальности.'],
             en: [NODATA_EN, 'The Windows app works offline: it makes no network connections. Saves are kept in the app data folder on your computer (%APPDATA%\\ARKTUR); remove them by uninstalling the app and deleting that folder.', 'The pilot name and password you enter in the game only separate pilots on this computer and are never sent anywhere.', 'The «Send to GitHub» button in the «Report a problem» window opens the game feedback page on GitHub with the report text (device and GPU model, recent game errors, pilot name and in-game location). Whether to submit it is up to you; submitted feedback is public, and GitHub processes data under its own privacy policy.'] }
};
const privFragment = (kind, lang) => '<ul>' + [...PRIV[kind][lang], lang === 'ru' ? AI_RU : AI_EN].map(x => `<li>${x}</li>`).join('\n') + '</ul>';
function privacyHtml(kind, back) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${CFG.title} — конфиденциальность / privacy</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px;background:#06101e;color:#d8e4f0}a{color:#7fd0ff}h1{font-size:24px}h2{font-size:19px;margin-top:28px}</style></head><body>
<h1>Политика конфиденциальности ${CFG.title}</h1>
${privFragment(kind, 'ru')}
<h2>Privacy policy — ${CFG.titleEn}</h2>
${privFragment(kind, 'en')}
${back ? '<p><a href="./">← Вернуться в игру / Back to the game</a></p>' : ''}
</body></html>
`;
}
const LICENSE_TEXT = `MIT License

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
`;

// Яндекс: игра запускается только после YaGames.init() — язык берётся из SDK до того, как словарь выберет язык.
// Все скрипты игры лежат в странице «спящими» (type="text/vf-defer") и оживают по очереди после инициализации.
function deferScripts(page) {
  return page
    .replace(/<script type="importmap">/g, '<script type="text/vf-defer" data-t="importmap">')
    .replace(/<script type="module">/g, '<script type="text/vf-defer" data-t="module">')
    .replace(/<script>/g, '<script type="text/vf-defer">');
}
const YANDEX_BOOT = `<script>
// Яндекс Игры: SDK → язык → запуск игры → LoadingAPI.ready, когда игра готова; пауза и GameplayAPI — по сигналам платформы и игры.
// Игра НЕ запускается без SDK: если инициализация затянулась (>10 с), показываем «Подключаемся…» с кнопкой «Повторить»,
// но продолжаем ждать — поздний успешный YaGames.init() запускает игру. Без SDK — только по явному тестовому флагу ?vfLocalTest=1.
(function () {
  'use strict';
  var RU = { ru: 1, be: 1, uk: 1, kk: 1, uz: 1 };
  var TEST = /[?&]vfLocalTest=1(&|$)/.test(location.search);
  var ru = /^(ru|be|uk|kk|uz)/i.test(navigator.language || '');
  var pend = window.__vfPausePending = window.__vfPausePending || {};
  var started = false;
  function setPause(on) { pend.platform = on; if (window.VF_PAUSE) window.VF_PAUSE.set('platform', on); }
  function overlay(kind) {
    var el = document.getElementById('ya-wait');
    if (!el) {
      el = document.createElement('div'); el.id = 'ya-wait';
      el.setAttribute('style', 'position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:rgba(2,4,10,.92);color:#d8e4f0;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px');
      document.body.appendChild(el);
    }
    var msg = kind === 'slow' ? (ru ? 'Подключаемся к Яндекс Играм… Это занимает больше обычного.' : 'Connecting to Yandex Games… This is taking longer than usual.')
      : kind === 'error' ? (ru ? 'Не удалось подключиться к Яндекс Играм.' : 'Could not connect to Yandex Games.')
      : (ru ? 'Не загрузился Yandex Games SDK.' : 'Yandex Games SDK did not load.');
    el.innerHTML = '<div><p id="ya-wait-msg"></p><button id="ya-retry" style="font:inherit;padding:8px 20px;margin-top:8px;background:#0b2233;color:#bfe9ff;border:1px solid #5fc8e8;border-radius:3px;cursor:pointer"></button></div>';
    el.querySelector('#ya-wait-msg').textContent = msg;
    var b = el.querySelector('#ya-retry'); b.textContent = ru ? 'Повторить' : 'Retry'; b.onclick = function () { location.reload(); };
    el.setAttribute('data-kind', kind);
  }
  function hideOverlay() { var el = document.getElementById('ya-wait'); if (el) el.parentNode.removeChild(el); }
  function start() {
    var sl = document.querySelectorAll('script[type="text/vf-defer"]');
    for (var i = 0; i < sl.length; i++) {
      var o = sl[i], n = document.createElement('script');
      if (o.getAttribute('data-t')) n.type = o.getAttribute('data-t');
      n.textContent = o.textContent;
      o.parentNode.replaceChild(n, o);
    }
  }
  function wire(ysdk) {
    var F = ysdk.features || {}, ready = false, inGame = false, playing = false;
    function onReady() { if (ready) return; ready = true; try { F.LoadingAPI && F.LoadingAPI.ready(); } catch (e) {} }
    if (window.VF_GAME_READY) onReady(); else addEventListener('vf-ready', onReady);
    // разметка геймплея: идёт, когда пилот в игре и нет паузы (ни игрока, ни платформы, ни потери фокуса)
    function sync() {
      var want = inGame && !(window.VF_PAUSE && window.VF_PAUSE.paused());
      if (want === playing || !F.GameplayAPI) return;
      playing = want;
      try { want ? F.GameplayAPI.start() : F.GameplayAPI.stop(); } catch (e) {}
    }
    addEventListener('vf-session', function (e) { inGame = !!(e.detail && e.detail.on); sync(); });
    addEventListener('vf-pause', sync);
    try { ysdk.on('game_api_pause', function () { setPause(true); }); ysdk.on('game_api_resume', function () { setPause(false); }); } catch (e) {}
  }
  function go(ysdk) {
    if (started) return; started = true;
    hideOverlay();
    var lang = null;
    try { lang = ysdk && ysdk.environment && ysdk.environment.i18n && ysdk.environment.i18n.lang; } catch (e) {}
    window.VF_PLATFORM.lang = lang ? (RU[String(lang).toLowerCase()] ? 'ru' : 'en') : null;
    window.VF_PLATFORM.sdkLang = lang || null;
    if (ysdk) { window.VF_YSDK = ysdk; wire(ysdk); }
    start();
  }
  if (window.YaGames && YaGames.init) {
    YaGames.init().then(go, function (e) { console.warn('Yandex SDK: init отклонён', e); if (!started) overlay('error'); });
    setTimeout(function () { if (!started) overlay('slow'); }, 10000); // не запускаем без SDK — ждём дальше, но даём «Повторить»
  } else if (TEST) { console.warn('Yandex SDK не найден: локальная проверка (?vfLocalTest=1) — запуск без SDK'); go(null); }
  else overlay('missing');
})();
</script>`;

function head(id, t) {
  const plat = { id, noAI: true, ...(t.lang ? { lang: t.lang } : {}), ...(t.noChat ? { noChat: true } : {}), ...(t.noFullscreen ? { noFullscreen: true } : {}),
    ...(t.noExternal ? { noExternal: true } : {}), ...(t.pauseOnBlur ? { pauseOnBlur: true } : {}) };
  const en = t.lang === 'en';
  return `<!doctype html>
<html lang="${en ? 'en' : 'ru'}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp(t)}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="${en ? CFG.descEn : CFG.desc}">
<meta name="theme-color" content="#060c18">
${t.pwa ? `<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${CFG.short}">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
` : ''}${t.icons ? '<link rel="icon" href="icons/icon-192.png">\n' : ''}<meta name="author" content="${CFG.author} и Claude">
<style>html,body{margin:0;padding:0;background:#02040a;height:100%;overflow:hidden}</style>
<script>window.VF_EDITION = 'public'; window.VF_AUTHOR = ${JSON.stringify(CFG.author)}; window.VF_PLATFORM = ${JSON.stringify(plat)}; window.VF_MUSIC = ${JSON.stringify(Object.keys(MUSIC).length ? { base: 'audio/music/', tracks: MUSIC } : null)}; window.VF_PRIVACY = ${JSON.stringify({ ru: privFragment(t.privacy, 'ru'), en: privFragment(t.privacy, 'en') }).replace(/</g, '\\u003c')};</script>
${t.yandex ? '<script src="/sdk.js"></script>\n' : ''}</head>
<body>
<div id="vf-splash" style="position:fixed;inset:0;z-index:500;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#02040a;color:#d8e4f0;font:15px/1.5 system-ui,sans-serif">
<div style="font-size:34px;letter-spacing:8px;font-weight:300">ARK<b style="color:#5fc8e8;font-weight:600">TUR</b></div>
<div style="margin:6px 0 18px;letter-spacing:4px;font-size:12px;color:#5fc8e8;text-transform:uppercase">${en ? 'Space Frontier' : 'Космический рубеж'}</div>
<div style="width:220px;height:3px;background:#0b2233;overflow:hidden;border-radius:2px"><div style="width:40%;height:100%;background:#5fc8e8;animation:vfld 1.2s ease-in-out infinite"></div></div>
<div style="margin-top:12px;color:#7d93a8;font-size:13px">${en ? 'Loading… (about 3.5 MB, first launch only)' : 'Загрузка… / Loading… (≈ 3,5 МБ, только при первом запуске)'}</div>
<style>@keyframes vfld{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}</style></div>
`;
}

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const built = {};
for (const id of ids) {
  const t = TARGETS[id], OUT = path.join(ROOT, t.out);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of THREE_FILES) {
    const to = path.join(OUT, 'vendor/three', f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'node_modules/three', f), to);
  }
  if (Object.keys(MUSIC).length) fs.cpSync(MUSIC_DIR, path.join(OUT, 'audio/music'), { recursive: true }); // музыка — отдельными файлами (лимит на файл у порталов)
  if (t.pwa || t.icons) { fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true }); for (const f of fs.readdirSync(ICONS)) fs.copyFileSync(path.join(ICONS, f), path.join(OUT, 'icons', f)); }
  let page = PAGE;
  if (t.yandex) page = deferScripts(page) + '\n' + YANDEX_BOOT;
  const sw = t.pwa ? `<script>
// офлайн-кэш и установка; новая версия подхватывается при следующем запуске
if ('serviceWorker' in navigator && location.protocol !== 'file:') addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
</script>
` : '';
  const html = head(id, t) + page + '\n' + sw + '<script>(function(){var s=document.getElementById("vf-splash");if(s)s.parentNode.removeChild(s);})();</script>\n</body>\n</html>\n';
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  fs.writeFileSync(path.join(OUT, 'privacy.html'), privacyHtml(t.privacy, true));
  fs.writeFileSync(path.join(OUT, 'LICENSE'), LICENSE_TEXT);
  if (t.pwa) buildPwaExtras(OUT, html);
  built[id] = { out: t.out, html: fs.statSync(path.join(OUT, 'index.html')).size };
  console.log(`${id}: ${t.out}/index.html ${(built[id].html / 1024).toFixed(0)} КБ`);
}

// Только сайт: манифест, офлайн-кэш, README для репозитория, подтверждение для Google Play
function buildPwaExtras(OUT, html) {
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
  // офлайн-кэш: список файлов с версией (меняется при каждой сборке — так игроки получают обновления)
  const files = ['./', 'index.html', 'manifest.webmanifest', 'privacy.html', ...fs.readdirSync(path.join(OUT, 'icons')).map(f => 'icons/' + f),
    ...THREE_FILES.filter(f => f.endsWith('.js')).map(f => 'vendor/three/' + f)];
  const ver = sha(html);
  fs.writeFileSync(path.join(OUT, 'sw.js'), `// офлайн-кэш ARKTUR, версия ${ver}
const CACHE = 'vf-${ver}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// сначала сеть для страницы (чтобы обновления приходили), без сети — из кэша; остальное — из кэша
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const page = e.request.mode === 'navigate';
  // музыка кэшируется при первом прослушивании (не грузим 14 МБ заранее)
  if (/\/audio\//.test(new URL(e.request.url).pathname)) { e.respondWith(caches.open(CACHE + '-audio').then(c => c.match(e.request).then(r => r || fetch(e.request).then(n => { if (n.ok && n.status === 200) c.put(e.request, n.clone()); return n; })))); return; }
  e.respondWith(page
    ? fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); return r; }).catch(() => caches.match('index.html'))
    : caches.match(e.request).then(r => r || fetch(e.request)));
});
`);
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  // подтверждение сайта для приложения в Google Play (см. publish/google-play/README.md)
  const links = path.join(ROOT, 'publish/google-play/assetlinks.json');
  if (fs.existsSync(links)) { fs.mkdirSync(path.join(OUT, '.well-known'), { recursive: true }); fs.copyFileSync(links, path.join(OUT, '.well-known/assetlinks.json')); }
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
  console.log(`web: версия кэша ${ver}`);
}

module.exports = { TARGETS, THREE_FILES, CFG, built };
