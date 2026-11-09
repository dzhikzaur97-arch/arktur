// Запуск (Linux, нужен дисплей): xvfb-run -a node tools/tests/desktop.test.js <папка-для-снимков>   (после npm ci в desktop/)
// Смоук-тест приложения для ПК: настоящий desktop/main.js в Electron 45 (Linux, виртуальный дисплей).
const { _electron } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const DESK = require('path').join(__dirname, '../../desktop');
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'arktur-cfg-'));
const launch = () => _electron.launch({ executablePath: path.join(DESK, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', DESK], env: { ...process.env, XDG_CONFIG_HOME: cfg, ELECTRON_ENABLE_LOGGING: '0' }, timeout: 60000 });
const out = []; const ok = (c, m) => out.push((c ? '✓ ' : '✗ ') + m);
(async () => {
  let app = await launch();
  let w = await app.firstWindow();
  const reqs = [], errs = [];
  const watch = (w) => { w.on('request', r => reqs.push(r.url().slice(0, 80))); w.on('response', r => { if (r.status() >= 400) errs.push('HTTP ' + r.status() + ' ' + r.url().slice(0, 100)); }); w.on('pageerror', e => errs.push(e.message)); w.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); };
  watch(w);
  await w.waitForLoadState('domcontentloaded'); await w.waitForTimeout(4000);
  ok(w.url() === 'app://arktur/index.html', 'адрес игры app://arktur/index.html (' + w.url() + ')');
  const prefs = await app.evaluate(({ BrowserWindow }) => { const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(); return { n: p.nodeIntegration, c: p.contextIsolation, s: p.sandbox, ws: p.webSecurity }; });
  ok(prefs.n === false && prefs.c === true && prefs.s === true && prefs.ws === true, 'nodeIntegration=false, contextIsolation=true, sandbox=true, webSecurity=true ' + JSON.stringify(prefs));
  ok(await w.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined'), 'в странице нет require/process (Node недоступен)');
  ok(await w.evaluate(() => fetch('https://example.com/').then(() => false, () => true)), 'сетевой запрос наружу заблокирован');
  ok(await w.evaluate(() => window.open('https://example.com') === null), 'window.open запрещён');
  await w.evaluate(() => { try { location.href = 'https://example.com/'; } catch (e) {} }); await w.waitForTimeout(1500);
  ok(w.url().startsWith('app://arktur/'), 'переход на чужой адрес отменён');
  ok(await w.evaluate(() => fetch('app://arktur/../../etc/passwd').then(r => r.status !== 200, () => true)), 'выход за папку игры (../) не работает');
  // вход и игра
  await w.evaluate(() => { localStorage.setItem('vf-dev', '1'); localStorage.setItem('vf-intro', '1'); localStorage.setItem('vf-welcome', '1'); localStorage.setItem('vf-dream-asked', '1'); localStorage.setItem('vf-news', '999'); localStorage.setItem('vf-tut', JSON.stringify({ hidden: true, careerHidden: true, allTabs: true, done: { sell: 1, undock: 1, belt: 1, lock: 1 } })); });
  await w.reload(); await w.waitForTimeout(5000);
  await w.fill('#lg-name', 'Десктоп'); await w.fill('#lg-pass', '123'); await w.click('#lg-go'); await w.waitForTimeout(7000);
  await w.evaluate(() => document.querySelector('#modal').classList.add('hidden'));
  ok(await w.evaluate(() => !document.querySelector('#station').classList.contains('hidden')), 'вход: пилот в ангаре станции');
  await w.evaluate(() => window.__VF_DBG.send({ t: 'undock' })); await w.waitForTimeout(5000);
  ok(await w.evaluate(() => !!window.__VF_DBG.S.me && !window.__VF_DBG.S.docked), 'отстыковка: корабль в космосе');
  await w.evaluate(() => { document.querySelector('#modal').classList.add('hidden'); const x = document.getElementById('win-close'); if (x && !document.querySelector('#win').classList.contains('hidden')) x.click(); });
  await w.waitForTimeout(300); await w.keyboard.press('Escape'); await w.waitForTimeout(500);
  const p1 = await w.evaluate(() => ({ s: window.VF_PAUSE.sources(), p: window.VF_PAUSED }));
  await w.keyboard.press('Escape'); await w.waitForTimeout(500);
  const p2 = await w.evaluate(() => ({ s: window.VF_PAUSE.sources(), p: window.VF_PAUSED }));
  ok(p1.p === true && p1.s.includes('user') && p2.p === false, 'пауза по Esc и возврат ' + JSON.stringify([p1, p2]));
  await w.evaluate(() => { const G = window.__VF_GAME, s = [...G.sessions].find(x => !x.isBot); s.player.credits = 7654321; window.VF_SAVES.flush(); });
  await w.waitForTimeout(1500);
  await app.close();
  // повторный запуск: сохранение на месте
  app = await launch(); w = await app.firstWindow(); watch(w); await w.waitForTimeout(5000);
  await w.fill('#lg-name', 'Десктоп'); await w.fill('#lg-pass', '123'); await w.click('#lg-go'); await w.waitForTimeout(7000);
  const cr = await w.evaluate(() => { const G = window.__VF_GAME, s = [...G.sessions].find(x => !x.isBot); return s && Math.round(s.player.credits); });
  ok(cr >= 7654321 && cr < 7654321 + 500000, 'сохранение пережило перезапуск приложения (кредиты ' + cr + ')');
  ok(fs.existsSync(path.join(cfg, 'ARKTUR')), 'папка данных ARKTUR создана: ' + path.join(cfg, 'ARKTUR'));
  await w.screenshot({ path: process.argv[2] + '/desktop_run.png' });
  await app.close();
  const foreign = reqs.filter(u => !/^(app:\/\/arktur\/|data:|blob:)/.test(u));
  ok(!foreign.filter(u => !/example\.com/.test(u)).length, 'все запросы игры — только app://arktur, data:, blob: ' + (foreign.length ? '(попытки наружу из теста: ' + foreign.length + ')' : ''));
  const real = errs.filter(e => !/example\.com|ERR_BLOCKED|net::ERR|Failed to fetch|window\.open|etc\/passwd/i.test(e)); if (real.length === 1 && /Failed to load resource/.test(real[0]) && errs.some(e => /etc\/passwd/.test(e))) real.length = 0;
  ok(!real.length, 'ошибок страницы нет' + (real.length ? ': ' + real.slice(0, 3).join(' | ') : ''));
  console.log(out.join('\n'));
  process.exit(out.some(x => x.startsWith('✗')) ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.error('СБОЙ', e.message); process.exit(1); });
