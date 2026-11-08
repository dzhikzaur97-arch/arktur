// Запуск: node tools/tests/yandex-review.test.js   (после node tools/build-release.js)
// Целевые тесты исправлений Яндекс-сборки: поздний SDK, звук и речь на паузе, ручная пауза, политика внутри игры.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').join(__dirname, '../../dist/targets/yandex');
const R = []; const ok = (c, m) => { R.push(c); console.log((c ? '✓ ' : '✗ ') + m); };
function mockSdk(o) { // o.delay — мс до ответа init; o.never — не ответит никогда; o.none — /sdk.js пустой; o.lang
  if (o.none) return '/* sdk недоступен */';
  return `(function(){var h={},L=window.__ya={log:[],fire:function(e){h[e]&&h[e]()}};
  function log(x){L.log.push([x, Date.now(), !!window.VF_GAME_READY])}
  var ysdk={environment:{i18n:{lang:${JSON.stringify(o.lang || 'ru')}}},features:{LoadingAPI:{ready:function(){log('ready')}},GameplayAPI:{start:function(){log('start')},stop:function(){log('stop')}}},on:function(e,cb){h[e]=cb},off:function(){}};
  window.YaGames={init:function(){log('init');return new Promise(function(r){${o.never ? '' : `setTimeout(function(){log('init-done');r(ysdk)},${o.delay || 300})`}})}};})();`;
}
let port = 9500;
async function run(o, fn) {
  const p0 = port++;
  const srv = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    if (u === '/sdk.js') { r.writeHead(200, { 'Content-Type': 'text/javascript' }); return r.end(mockSdk(o)); }
    const f = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); r.end(fs.readFileSync(f));
  }).listen(p0);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
  await ctx.addInitScript(() => {
    localStorage.setItem('vf-intro', '1'); localStorage.setItem('vf-welcome', '1'); localStorage.setItem('vf-dream-asked', '1'); localStorage.setItem('vf-news', '999');
    localStorage.setItem('vf-tut', JSON.stringify({ hidden: true, careerHidden: true, allTabs: true, done: { sell: 1, undock: 1, belt: 1, lock: 1 } }));
    // наблюдатель за речью: какие вызовы speechSynthesis делает игра; «говорит» — по флагу теста
    const sy = window.speechSynthesis; window.__sp = []; window.__speaking = false;
    if (sy) { for (const m of ['speak', 'pause', 'resume', 'cancel']) { const f = sy[m].bind(sy); sy[m] = (...a) => { window.__sp.push(m); return f(...a); }; }
      Object.defineProperty(sy, 'speaking', { get: () => window.__speaking, configurable: true }); }
  });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  try { await fn(page, `http://127.0.0.1:${p0}/index.html${o.query || ''}`, errs); } catch (e) { ok(false, 'сбой сценария: ' + e.message.split('\n')[0]); }
  await b.close(); srv.close();
}
const started = (p) => p.evaluate(() => typeof window.VF_LANG !== 'undefined');
const ov = (p) => p.evaluate(() => { const e = document.getElementById('ya-wait'); return e ? e.getAttribute('data-kind') : null; });
async function login(p) { await p.waitForFunction(() => window.VF_GAME_READY === true, null, { timeout: 90000 }); await p.fill('#lg-name', 'Проверка'); await p.fill('#lg-pass', '123456'); await p.click('#lg-go'); await p.waitForTimeout(7000); }
const st = (p) => p.evaluate(() => ({ s: window.VF_PAUSE.sources(), p: window.VF_PAUSED, au: window.VF_PAUSE.audio(), menu: !document.querySelector('#escmenu').classList.contains('hidden') }));

(async () => {
  console.log('== 1. SDK отвечает через 14 с (дольше 10 с) — поздний ответ запускает игру');
  await run({ delay: 14000, lang: 'en' }, async (p, url) => {
    await p.goto(url); await p.waitForTimeout(5000);
    ok(!(await started(p)) && !(await ov(p)), 'через 5 с: игра ещё не запущена, экрана ожидания нет');
    await p.waitForTimeout(6500);
    ok(!(await started(p)) && (await ov(p)) === 'slow', 'через 11,5 с: игра НЕ запущена без SDK, показано «Подключаемся…» с кнопкой «Повторить»');
    ok(await p.evaluate(() => !!document.querySelector('#ya-retry')), 'кнопка «Повторить» есть');
    await p.waitForTimeout(5000);
    ok(await started(p) && !(await ov(p)), 'через 16,5 с: поздний YaGames.init() запустил игру, экран ожидания убран');
    ok(await p.evaluate(() => window.VF_LANG) === 'en', 'язык взят из позднего SDK (en)');
    await p.waitForFunction(() => window.__ya.log.some(x => x[0] === 'ready'), null, { timeout: 90000 });
    const rd = await p.evaluate(() => window.__ya.log.filter(x => x[0] === 'ready'));
    ok(rd.length === 1 && rd[0][2] === true, 'LoadingAPI.ready() один раз и после загрузки игры');
  });
  console.log('\n== 2. SDK не отвечает вообще / /sdk.js пустой');
  await run({ never: true }, async (p, url) => { await p.goto(url); await p.waitForTimeout(12000); ok(!(await started(p)) && (await ov(p)) === 'slow', 'init не ответил: игра не запускается сама, ждём с «Повторить»'); });
  await run({ none: true }, async (p, url) => { await p.goto(url); await p.waitForTimeout(3000); ok(!(await started(p)) && (await ov(p)) === 'missing', 'нет YaGames: игра не запускается, сообщение и «Повторить»'); });
  await run({ none: true, query: '?vfLocalTest=1' }, async (p, url) => { await p.goto(url); await p.waitForTimeout(4000); ok(await started(p) && !(await ov(p)), 'тестовый флаг ?vfLocalTest=1: локальный запуск без SDK'); });

  console.log('\n== 3. Звук впервые включается, когда игра уже на паузе платформы');
  await run({ lang: 'ru' }, async (p, url, errs) => {
    await p.goto(url); await p.waitForFunction(() => window.VF_GAME_READY === true, null, { timeout: 90000 });
    ok(await p.evaluate(() => window.VF_PAUSE.audio()) === 'none', 'до входа звука ещё нет (AudioContext не создан)');
    await p.evaluate(() => window.__ya.fire('game_api_pause'));
    await login(p);
    const a = await st(p);
    ok(a.au === 'suspended' && a.s.includes('platform'), 'после входа на паузе: новый AudioContext сразу приостановлен ' + JSON.stringify(a));
    await p.evaluate(() => window.__ya.fire('game_api_resume')); await p.waitForTimeout(500);
    ok((await st(p)).au === 'running', 'game_api_resume: звук пошёл');

    console.log('\n== 4. Озвучка реплик (speechSynthesis) на blur и паузе SDK');
    const voice0 = await p.evaluate(() => (JSON.parse(localStorage.getItem('vf-cfg') || '{}')).voice);
    await p.evaluate(() => { window.__sp.length = 0; window.__VF_DBG = window.__VF_DBG; });
    await p.evaluate(() => window.__VF_DBG.speak('Проверка связи', 'agent'));
    ok(await p.evaluate(() => window.__sp.includes('speak')), 'без паузы реплика звучит (speechSynthesis.speak)');
    await p.evaluate(() => { window.__speaking = true; window.__sp.length = 0; window.dispatchEvent(new Event('blur')); });
    await p.waitForTimeout(300);
    ok(await p.evaluate(() => window.__sp.includes('pause')), 'blur: идущая реплика приостановлена (speechSynthesis.pause)');
    await p.evaluate(() => { window.__sp.length = 0; window.__VF_DBG.speak('Новая реплика', 'agent'); });
    ok(await p.evaluate(() => !window.__sp.includes('speak')), 'blur: новая реплика не начинается');
    await p.evaluate(() => { window.dispatchEvent(new Event('focus')); }); await p.waitForTimeout(300);
    ok(await p.evaluate(() => window.__sp.includes('resume')), 'focus: реплика продолжилась (speechSynthesis.resume)');
    await p.evaluate(() => { window.__sp.length = 0; window.__ya.fire('game_api_pause'); }); await p.waitForTimeout(300);
    ok(await p.evaluate(() => window.__sp.includes('pause')), 'game_api_pause: реплика приостановлена');
    await p.evaluate(() => { window.__sp.length = 0; window.__VF_DBG.speak('Ещё реплика', 'leader'); });
    ok(await p.evaluate(() => !window.__sp.includes('speak')), 'game_api_pause: новая реплика не начинается');
    await p.evaluate(() => { window.__ya.fire('game_api_resume'); window.__speaking = false; }); await p.waitForTimeout(300);
    ok(await p.evaluate(() => window.__sp.includes('resume')), 'game_api_resume: речь продолжена');
    const voice1 = await p.evaluate(() => (JSON.parse(localStorage.getItem('vf-cfg') || '{}')).voice);
    ok(voice0 === voice1 && voice1 !== false, `настройка «Озвучка» игрока не изменилась (${voice0} → ${voice1})`);

    console.log('\n== 5. Ручное меню Esc не снимается платформой');
    await p.evaluate(() => { document.querySelector('#modal').classList.add('hidden'); const x = document.getElementById('win-close'); if (x && !document.querySelector('#win').classList.contains('hidden')) x.click(); });
    await p.waitForTimeout(300); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    ok((await st(p)).menu === true, 'меню Esc открыто игроком');
    await p.evaluate(() => window.__ya.fire('game_api_pause')); await p.evaluate(() => window.__ya.fire('game_api_resume'));
    await p.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); }); await p.waitForTimeout(400);
    const e = await st(p);
    ok(e.p === true && e.menu === true && e.s.join() === 'user', 'после pause/resume платформы и blur/focus меню Esc открыто, игра на паузе ' + JSON.stringify(e));
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    ok((await st(p)).p === false, 'игрок закрыл меню — пауза снята');

    console.log('\n== 6. Политика конфиденциальности внутри игры');
    await p.evaluate(() => { const b = [...document.querySelectorAll('#ui [data-win=help], #ui button')].find(x => x.dataset && x.dataset.win === 'help'); if (b) b.click(); });
    await p.waitForTimeout(800);
    const hasBtn = await p.evaluate(() => !!document.querySelector('#win-body [data-a=privacy]'));
    if (hasBtn) await p.click('#win-body [data-a=privacy]'); // настоящее нажатие (кнопки игры реагируют на pointerdown)
    await p.waitForTimeout(400);
    const txt = await p.evaluate(() => { const o = document.getElementById('privacy-ov'); return o && getComputedStyle(o).display !== 'none' ? o.innerText : ''; });
    ok(hasBtn, 'в игре: «Помощь → Об игре» — кнопка «Политика конфиденциальности»');
    ok(/LoadingAPI/.test(txt) && /GameplayAPI/.test(txt) && /Яндекс/.test(txt) && /статистик/.test(txt) && !/нет рекламы, покупок, аналитики/.test(txt), 'окно политики внутри игры: про SDK ready, разметку геймплея, данные и статистику платформы; без обещания «никакой аналитики»');
    await p.click('#privacy-ov .pv-foot [data-pv-close]'); await p.waitForTimeout(300);
    ok(await p.evaluate(() => !document.getElementById('privacy-ov')), 'окно политики закрывается');
    ok(!errs.length, 'ошибок страницы нет' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
  });
  await run({ lang: 'en' }, async (p, url) => {
    await p.goto(url); await p.waitForFunction(() => window.VF_GAME_READY === true, null, { timeout: 90000 });
    ok(await p.evaluate(() => !!document.getElementById('lg-privacy')), 'экран входа: ссылка на политику конфиденциальности');
    await p.click('#lg-privacy'); await p.waitForTimeout(400);
    const t = await p.evaluate(() => document.getElementById('privacy-ov').innerText);
    ok(/Privacy policy/.test(t) && /GameplayAPI/.test(t) && /aggregated game statistics/.test(t), 'на экране входа (язык SDK en) политика открывается по-английски');
  });
  const bad = R.filter(x => !x).length;
  console.log(`\nИТОГО: ${R.length - bad}/${R.length}`);
  process.exit(bad ? 1 : 0);
})();
