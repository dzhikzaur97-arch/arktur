// Запуск: node tools/tests/music-protect.test.js   (после node tools/build-release.js)
// Музыка (треки по настроению, пауза) и сохранность прогресса (подсказка установки на iPhone, напоминание о копии) — сборка сайта.
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../../dist/site');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]), f = path.join(ROOT, u === '/' ? 'index.html' : u); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); }).listen(9611);
const R = []; const ok = (c, m) => { R.push(c); console.log((c ? '✓ ' : '✗ ') + m); };
const INIT = () => { localStorage.setItem('vf-dev', '1'); localStorage.setItem('vf-intro', '1'); localStorage.setItem('vf-welcome', '1'); localStorage.setItem('vf-dream-asked', '1'); localStorage.setItem('vf-news', '999');
  localStorage.setItem('vf-tut', JSON.stringify({ hidden: true, careerHidden: true, allTabs: true, done: { sell: 1, undock: 1, belt: 1, lock: 1 } })); };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  // ---------- музыка ----------
  let ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.addInitScript(INIT);
  let p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:9611/'); await p.waitForTimeout(3000);
  await p.fill('#lg-name', 'Музыка'); await p.fill('#lg-pass', '123'); await p.click('#lg-go'); await p.waitForTimeout(7000);
  const T = () => p.evaluate(() => window.__VF_DBG.tracks());
  let t = await T();
  ok(t.active && !t.failed && t.cur === 'station', 'вход: играет настоящий трек станции ' + JSON.stringify(t));
  const t0 = t.t[t.src.findIndex(x => /station/.test(x || ''))]; await p.waitForTimeout(2000); t = await T();
  ok(t.t[t.src.findIndex(x => /station/.test(x || ''))] > t0, 'трек идёт (время дорожки растёт)');
  await p.evaluate(() => { document.querySelector('#modal').classList.add('hidden'); window.__VF_DBG.send({ t: 'undock' }); }); await p.waitForTimeout(9000);
  t = await T(); ok(t.cur === 'explore' || t.cur === 'danger', 'в космосе: трек космоса/опасной системы (' + t.cur + ')');
  await p.evaluate(() => { window.__VF_DBG.S.fightUntil = Date.now() + 120000; }); await p.waitForTimeout(5000);
  t = await T(); ok(t.cur === 'combat', 'бой: трек боя (' + t.cur + ')');
  await p.evaluate(() => window.VF_PAUSE.set('platform', true)); await p.waitForTimeout(600);
  t = await T(); const ci = t.src.findIndex(x => /combat/.test(x || ''));
  ok(t.paused[ci] === true, 'пауза платформы: дорожка остановлена');
  await p.evaluate(() => window.VF_PAUSE.set('platform', false)); await p.waitForTimeout(600);
  t = await T(); ok(t.paused[ci] === false, 'пауза снята: дорожка продолжает');
  ok(!errs.length, 'ошибок страницы нет' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
  await ctx.close();
  // ---------- iPhone: подсказка установки и копия сохранения ----------
  ctx = await b.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', acceptDownloads: true }); await ctx.addInitScript(INIT);
  p = await ctx.newPage();
  await p.goto('http://127.0.0.1:9611/'); await p.waitForTimeout(3000);
  await p.fill('#lg-name', 'Айфон'); await p.fill('#lg-pass', '123'); await p.tap('#lg-go'); await p.waitForTimeout(7000);
  await p.evaluate(() => { document.querySelector('#modal').classList.add('hidden'); window.__VF_DBG.S.sessionStart = Date.now() - 6 * 60000; try { window.__VF_DBG.protectCheck(); } catch (e) { window.__perr = e.message; } });
  await p.waitForTimeout(500);
  let m = await p.evaluate(() => !document.querySelector('#modal').classList.contains('hidden') && document.querySelector('#modal-body').innerText);
  ok(/На экран/.test(m || ''), 'iPhone в Safari: подсказка «Поделиться → На экран „Домой“»');
  await p.evaluate(() => { document.querySelector('#modal').classList.add('hidden'); const st = JSON.parse(localStorage.getItem('vf-protect')); st.first = Date.now() - 4 * 864e5; st.installAsk = Date.now(); localStorage.setItem('vf-protect', JSON.stringify(st)); window.__VF_DBG.S.sessionStart = Date.now() - 11 * 60000; window.__VF_DBG.protectCheck(); });
  await p.waitForTimeout(500);
  m = await p.evaluate(() => !document.querySelector('#modal').classList.contains('hidden') && document.querySelector('#modal-body').innerText);
  ok(/Резервная копия/.test(m || ''), 'через 3 дня игры без копии: напоминание выгрузить копию');
  const dl = p.waitForEvent('download', { timeout: 15000 });
  await p.evaluate(() => { const b = [...document.querySelectorAll('#modal-body .btns button')].find(x => /Выгрузить/.test(x.textContent)); b.click(); });
  const d = await dl; const fp = await d.path(); const txt = fs.readFileSync(fp, 'utf8');
  ok(/^arktur-save-\d{4}-\d\d-\d\d\.json$/.test(d.suggestedFilename()) && /"players"/.test(txt), 'кнопка выгружает файл сохранения (' + d.suggestedFilename() + ', ' + txt.length + ' байт)');
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('vf-protect')));
  ok(st.lastBackup > Date.now() - 60000, 'время последней копии записано — напоминание не повторится раньше срока');
  await b.close(); srv.close();
  const bad = R.filter(x => !x).length; console.log(`ИТОГО: ${R.length - bad}/${R.length}`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error('СБОЙ', e); process.exit(2); });
