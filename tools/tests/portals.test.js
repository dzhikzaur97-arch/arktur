// Запуск: node tools/tests/portals.test.js <папка-для-снимков> [iframe|yandex|plain]   (после node tools/build-release.js)
// Смоук-тесты портальных сборок: iframe на чужом сайте (itch / CrazyGames / Poki), Яндекс с имитацией SDK, сайт, однофайловая версия.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const DIST = require('path').join(__dirname, '../../dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
function serve(port, root, extra = {}) {
  const hits = [];
  const srv = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]); hits.push(u);
    if (extra[u]) { r.writeHead(200, { 'Content-Type': 'text/javascript' }); return r.end(extra[u]()); }
    const f = path.join(root, u === '/' ? 'index.html' : u);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
  }).listen(port);
  return { srv, hits };
}
const R = []; const ok = (c, m) => { R.push((c ? '✓ ' : '✗ ') + m); console.log((c ? '✓ ' : '✗ ') + m); };
const INIT = () => { localStorage.setItem('vf-dev', '1'); localStorage.setItem('vf-intro', '1'); localStorage.setItem('vf-welcome', '1'); localStorage.setItem('vf-dream-asked', '1');
  localStorage.setItem('vf-tut', JSON.stringify({ hidden: true, careerHidden: true, allTabs: true, done: { sell: 1, undock: 1, belt: 1, lock: 1 } })); };
async function browser() { return chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] }); }
function watch(page, label) {
  const st = { reqs: [], errs: [], bad: [] };
  page.on('request', r => st.reqs.push(r.url()));
  page.on('response', r => { if (r.status() >= 400) st.bad.push(r.status() + ' ' + r.url()); });
  page.on('pageerror', e => st.errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) st.errs.push(m.text().slice(0, 240)); });
  return st;
}
async function play(fr, name) { // fr — Frame или Page
  await fr.waitForSelector('#lg-name', { timeout: 60000 }); await fr.waitForTimeout(1500);
  await fr.fill('#lg-name', name); await fr.fill('#lg-pass', '123'); await fr.click('#lg-go'); await fr.waitForTimeout(7000);
  await fr.evaluate(() => document.querySelector('#modal').classList.add('hidden'));
}
const inStation = (fr) => fr.evaluate(() => !document.querySelector('#station').classList.contains('hidden'));
const undock = async (fr) => { await fr.evaluate(() => window.__VF_DBG.send({ t: 'undock' })); await fr.waitForTimeout(5000); return fr.evaluate(() => !!window.__VF_DBG.S.me && !window.__VF_DBG.S.docked); };
const simNow = (fr) => fr.evaluate(() => { const s = [...window.__VF_GAME.sessions].find(x => !x.isBot); return s && s.ent ? s.ent.pos.slice() : null; });
const foreign = (st, origins) => st.reqs.filter(u => !origins.some(o => u.startsWith(o)) && !/^(data|blob):/.test(u));

async function iframeTest(target, expectLang) {
  console.log(`\n== ${target}: внутри iframe на чужом сайте`);
  const host = serve(9101, '/nonexistent', {}); host.srv.removeAllListeners('request');
  host.srv.on('request', (q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(`<!doctype html><html><body style="margin:0;background:#222"><p id="out" tabindex="0" style="color:#fff">портал</p><iframe id="g" src="http://127.0.0.1:9102/index.html" style="width:1200px;height:700px;border:0" allow="fullscreen; autoplay"></iframe></body></html>`); });
  const game = serve(9102, path.join(DIST, 'targets', target));
  const b = await browser(), ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' }); // браузер на русском
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage(), st = watch(page, target);
  await page.goto('http://localhost:9101/'); await page.waitForTimeout(3000);
  const fr = page.frame({ url: /9102/ });
  ok(!!fr, `${target}: игра загрузилась в iframe с другого адреса`);
  ok(await fr.evaluate(() => window.VF_LANG) === expectLang, `${target}: язык по умолчанию ${expectLang} (${await fr.evaluate(() => window.VF_LANG)})`);
  ok(await fr.evaluate(() => getComputedStyle(document.querySelector('#chat-in')).display === 'none'), `${target}: поле свободного чата скрыто`);
  ok(await fr.evaluate(() => !navigator.serviceWorker || !navigator.serviceWorker.controller), `${target}: без service worker`);
  await play(fr, 'Портал');
  ok(await inStation(fr), `${target}: вход, пилот в ангаре`);
  // своя кнопка «Во весь экран» в настройках: у CrazyGames и Poki её нет
  const hasFs = await fr.evaluate(() => { window.__VF_DBG.S.setTab = 2; document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO', key: 'o', bubbles: true })); return new Promise(r => setTimeout(() => r(!!document.querySelector('#win-body [data-a=fullscreen]')), 600)); });
  const winOpen = await fr.evaluate(() => !document.querySelector('#win').classList.contains('hidden'));
  ok(winOpen && hasFs === (target === 'itch'), `${target}: настройки открываются; своя кнопка «Во весь экран» ${hasFs ? 'есть' : 'скрыта'}`);
  await fr.evaluate(() => document.querySelector('#win-close').click());
  ok(await undock(fr), `${target}: отстыковка, корабль в космосе`);
  // пауза при потере фокуса (только у порталов с pauseOnBlur)
  const pob = await fr.evaluate(() => !!(window.VF_PLATFORM && window.VF_PLATFORM.pauseOnBlur));
  if (pob) {
    await page.focus('#out'); await page.waitForTimeout(800);
    const a = await fr.evaluate(() => ({ s: window.VF_PAUSE.sources(), p: window.VF_PAUSED, au: window.VF_PAUSE.audio() }));
    const p0 = await simNow(fr); await page.waitForTimeout(2500); const p1 = await simNow(fr);
    await fr.click('#scene', { position: { x: 600, y: 400 } }).catch(() => {}); await fr.evaluate(() => window.focus()); await page.waitForTimeout(800);
    const c = await fr.evaluate(() => ({ s: window.VF_PAUSE.sources(), p: window.VF_PAUSED, au: window.VF_PAUSE.audio() }));
    ok(a.p && a.s.includes('blur') && JSON.stringify(p0) === JSON.stringify(p1) && c.p === false, `${target}: фокус ушёл — пауза (симуляция стоит, звук ${a.au}), вернулся — игра идёт ${JSON.stringify({ a, c })}`);
  }
  await fr.evaluate(() => { const s = [...window.__VF_GAME.sessions].find(x => !x.isBot); s.player.credits = 4321000; window.VF_SAVES.flush(); });
  await page.reload(); await page.waitForTimeout(3000);
  const fr2 = page.frame({ url: /9102/ }); await play(fr2, 'Портал');
  const cr = await fr2.evaluate(() => { const s = [...window.__VF_GAME.sessions].find(x => !x.isBot); return s && Math.round(s.player.credits); });
  ok(cr >= 4321000 && cr < 4821000, `${target}: сохранение и загрузка после перезагрузки (${cr})`);
  const f = foreign(st, ['http://localhost:9101', 'http://127.0.0.1:9102']);
  ok(!f.length, `${target}: нет запросов наружу (Claude/API/CDN)` + (f.length ? ': ' + f.slice(0, 3).join(', ') : ''));
  ok(!st.bad.length, `${target}: нет пропавших ресурсов (4xx/5xx)` + (st.bad.length ? ': ' + st.bad.slice(0, 3).join(', ') : ''));
  ok(!st.errs.length, `${target}: нет ошибок страницы и нарушений CSP` + (st.errs.length ? ': ' + st.errs.slice(0, 3).join(' | ') : ''));
  await fr2.screenshot ? 0 : 0; await page.screenshot({ path: `${process.argv[2]}/portal_${target}.png` });
  await b.close(); host.srv.close(); game.srv.close();
}

async function yandexTest(sdkLang, expectLang, full) {
  console.log(`\n== yandex: имитация SDK, язык платформы ${sdkLang}`);
  const MOCK = `(function(){var h={},L=window.__ya={log:[],fire:function(e){h[e]&&h[e]()}};
    function log(x){L.log.push([x, !!window.VF_GAME_READY, typeof window.VF_LANG])}
    var ysdk={environment:{i18n:{lang:${JSON.stringify(sdkLang)}}},features:{LoadingAPI:{ready:function(){log('ready')}},GameplayAPI:{start:function(){log('start')},stop:function(){log('stop')}}},on:function(e,cb){h[e]=cb},off:function(){}};
    window.YaGames={init:function(){log('init'); return new Promise(function(r){setTimeout(function(){log('init-done');r(ysdk)},400)})}};})();`;
  const game = serve(9103, path.join(DIST, 'targets/yandex'), { '/sdk.js': () => MOCK });
  const b = await browser(), ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage(), st = watch(page, 'yandex');
  await page.goto('http://127.0.0.1:9103/index.html'); await page.waitForTimeout(5000);
  const log0 = await page.evaluate(() => window.__ya.log);
  ok(log0[0] && log0[0][0] === 'init' && log0[0][2] === 'undefined', `yandex: YaGames.init() вызван до выбора языка игры (${JSON.stringify(log0[0])})`);
  ok(await page.evaluate(() => window.VF_LANG) === expectLang, `yandex: язык из ysdk.environment.i18n.lang=${sdkLang} → ${await page.evaluate(() => window.VF_LANG)}`);
  if (!full) { await b.close(); game.srv.close(); return; }
  await page.waitForFunction(() => window.__ya.log.some(x => x[0] === 'ready'), null, { timeout: 60000 });
  const rd = (await page.evaluate(() => window.__ya.log)).filter(x => x[0] === 'ready');
  ok(rd.length === 1 && rd[0][1] === true, `yandex: LoadingAPI.ready() один раз и только после загрузки игры (${JSON.stringify(rd)})`);
  await play(page, 'Яндекс');
  ok(await inStation(page), 'yandex: вход, пилот в ангаре');
  const L = () => page.evaluate(() => window.__ya.log.map(x => x[0]).filter(x => x === 'start' || x === 'stop').join(','));
  ok((await L()) === 'start', `yandex: GameplayAPI.start() при входе в игру (${await L()})`);
  ok(await undock(page), 'yandex: отстыковка, корабль в космосе');
  const S = () => page.evaluate(() => ({ s: window.VF_PAUSE.sources(), p: window.VF_PAUSED, au: window.VF_PAUSE.audio() }));
  // 1) платформа ставит паузу
  await page.evaluate(() => window.__ya.fire('game_api_pause')); await page.waitForTimeout(400);
  const a = await S(); const q0 = await simNow(page); await page.waitForTimeout(2500); const q1 = await simNow(page);
  ok(a.p && a.s.includes('platform') && a.au === 'suspended' && JSON.stringify(q0) === JSON.stringify(q1), `yandex: game_api_pause — симуляция стоит, звук приостановлен ${JSON.stringify(a)}`);
  // 2) поверх — игрок открывает меню (ручная пауза), платформа снимает свою
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.evaluate(() => window.__ya.fire('game_api_resume')); await page.waitForTimeout(400);
  const b2 = await S();
  ok(b2.p === true && b2.s.join() === 'user' && b2.au === 'running', `yandex: game_api_resume не снимает ручную паузу игрока, звук вернулся ${JSON.stringify(b2)}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  const c = await S(); const r0 = await simNow(page); await page.waitForTimeout(2000); const r1 = await simNow(page);
  ok(c.p === false && JSON.stringify(r0) !== JSON.stringify(r1), `yandex: игрок закрыл меню — игра идёт ${JSON.stringify(c)}`);
  // 3) наоборот: сначала пауза игрока, потом платформа ставит и снимает свою
  await page.keyboard.press('Escape'); await page.evaluate(() => window.__ya.fire('game_api_pause')); await page.evaluate(() => window.__ya.fire('game_api_resume')); await page.waitForTimeout(400);
  const d = await S();
  ok(d.p === true && d.s.join() === 'user', `yandex: пауза игрока сохраняется после pause/resume платформы ${JSON.stringify(d)}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // 4) blur / focus
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.waitForTimeout(300); const e1 = await S();
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(300); const e2 = await S();
  ok(e1.p && e1.s.includes('blur') && e1.au === 'suspended' && !e2.p && e2.au === 'running', `yandex: blur — пауза и тишина, focus — продолжение ${JSON.stringify([e1, e2])}`);
  ok((await L()).startsWith('start,stop,start,stop'), `yandex: GameplayAPI размечает паузы и возвраты (${await L()})`);
  await page.evaluate(() => { const s = [...window.__VF_GAME.sessions].find(x => !x.isBot); s.player.credits = 3333000; window.VF_SAVES.flush(); });
  await page.reload(); await page.waitForTimeout(5000); await play(page, 'Яндекс');
  const cr = await page.evaluate(() => { const s = [...window.__VF_GAME.sessions].find(x => !x.isBot); return s && Math.round(s.player.credits); });
  ok(cr >= 3333000 && cr < 3833000, `yandex: сохранение и загрузка после перезагрузки (${cr})`);
  const f = foreign(st, ['http://127.0.0.1:9103']);
  ok(!f.length, 'yandex: нет запросов наружу (кроме /sdk.js своего домена)' + (f.length ? ': ' + f.slice(0, 3).join(', ') : ''));
  ok(game.hits.includes('/sdk.js'), 'yandex: /sdk.js запрошен с корня домена игры');
  ok(!st.bad.length, 'yandex: нет пропавших ресурсов' + (st.bad.length ? ': ' + st.bad.slice(0, 3).join(', ') : ''));
  ok(!st.errs.length, 'yandex: нет ошибок и нарушений CSP' + (st.errs.length ? ': ' + st.errs.slice(0, 3).join(' | ') : ''));
  await b.close(); game.srv.close();
}

async function plainTests() {
  console.log('\n== сайт (web) и однофайловая версия для скачивания');
  const web = serve(9104, path.join(DIST, 'site'));
  let b = await browser(), ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.addInitScript(INIT);
  let page = await ctx.newPage(), st = watch(page, 'web');
  await page.goto('http://127.0.0.1:9104/'); await play(page, 'Сайт');
  ok(await inStation(page) && await undock(page), 'web: вход, ангар, отстыковка');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('#chat-in')).display !== 'none'), 'web: чат на сайте остаётся (как в v82)');
  ok(!foreign(st, ['http://127.0.0.1:9104']).length && !st.bad.length && !st.errs.length, 'web: без запросов наружу, 404 и ошибок' + JSON.stringify({ f: foreign(st, ['http://127.0.0.1:9104']).slice(0, 2), b: st.bad.slice(0, 2), e: st.errs.slice(0, 2) }));
  await b.close(); web.srv.close();
  b = await browser(); ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.addInitScript(INIT);
  page = await ctx.newPage(); st = watch(page, 'file');
  await page.goto('file://' + path.join(DIST, 'targets/itch-download/ARKTUR.html')); await play(page, 'Файл');
  ok(await inStation(page) && await undock(page), 'itch-download: ARKTUR.html открывается с диска (file://), вход и отстыковка');
  ok(!st.reqs.filter(u => !/^(file|data|blob):/.test(u)).length && !st.errs.length, 'itch-download: без сети и ошибок' + JSON.stringify({ r: st.reqs.filter(u => !/^(file|data|blob):/.test(u)).slice(0, 2), e: st.errs.slice(0, 2) }));
  await b.close();
}

(async () => {
  const only = process.argv[3];
  if (!only || only === 'iframe') { await iframeTest('crazygames', 'en'); await iframeTest('poki', 'en'); /* itch — по языку браузера; CrazyGames и Poki — английский даже в русском браузере */ await iframeTest('itch', 'ru'); }
  if (!only || only === 'yandex') { await yandexTest('en', 'en', true); await yandexTest('ru', 'ru', false); await yandexTest('tr', 'en', false); }
  if (!only || only === 'plain') await plainTests();
  const bad = R.filter(x => x.startsWith('✗'));
  console.log(`\nИТОГО: ${R.length - bad.length}/${R.length} проверок прошли`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('СБОЙ ТЕСТА', e); process.exit(2); });
