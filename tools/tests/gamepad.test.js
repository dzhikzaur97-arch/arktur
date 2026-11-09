// Запуск: node tools/tests/gamepad.test.js <папка с sa.html>   (sa.html = "<!doctype html>" + dist/void-frontier.html)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => {
    localStorage.setItem('vf-intro', '1'); localStorage.setItem('vf-welcome', '1'); localStorage.setItem('vf-dream-asked', '1'); localStorage.setItem('vf-news', '999');
    localStorage.setItem('vf-tut', JSON.stringify({ hidden: true, careerHidden: true, allTabs: true, done: { sell: 1, undock: 1, belt: 1, lock: 1 } }));
    const pad = { id: 'Test pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), timestamp: 0 };
    window.__pad = pad; navigator.getGamepads = () => [pad, null, null, null];
    window.__press = (i, on) => { pad.buttons[i] = { pressed: on, value: on ? 1 : 0 }; };
  });
  await p.goto('file://' + process.argv[2] + '/sa.html'); await p.waitForTimeout(3000);
  await p.fill('#lg-name', 'Геймпад'); await p.fill('#lg-pass', '123'); await p.click('#lg-go'); await p.waitForTimeout(6000);
  await p.evaluate(() => { document.querySelector('#modal').classList.add('hidden'); window.__VF_DBG.send({ t: 'undock' }); }); await p.waitForTimeout(5000);
  await p.evaluate(() => window.dispatchEvent(new Event('gamepadconnected')));
  const tap = async (i) => { await p.evaluate((i) => window.__press(i, true), i); await p.waitForTimeout(1500); await p.evaluate((i) => window.__press(i, false), i); await p.waitForTimeout(1500); };
  const st = () => p.evaluate(() => ({ man: !document.querySelector('#man-hud') || !document.querySelector('#man-hud').classList.contains('hidden'), yaw: window.__VF_CAM.yaw, map: !document.querySelector('#map').classList.contains('hidden'), esc: !document.querySelector('#escmenu').classList.contains('hidden'), locks: (window.__VF_DBG.S.me || {}).locks }));
  const s0 = await st();
  for (let k = 0; k < 4; k++) { await p.evaluate(() => { window.__pad.axes[2] = 0.9; }); await p.waitForTimeout(1000); console.log('yaw', await p.evaluate(() => [window.__VF_CAM.yaw.toFixed(3), navigator.getGamepads()[0].axes.join(), typeof requestAnimationFrame])); }
  await p.evaluate(() => { window.__pad.axes[2] = 0.9; }); await p.waitForTimeout(3000); await p.evaluate(() => { window.__pad.axes[2] = 0; });
  const s1 = await st(); console.log((s1.yaw !== s0.yaw ? '✓' : '✗') + ' правый стик поворачивает камеру', s0.yaw.toFixed(2), '→', s1.yaw.toFixed(2));
  await tap(3); const s2 = await st(); console.log((s2.map ? '✓' : '✗') + ' Y — карта открылась');
  await p.evaluate(() => document.querySelector('#map').classList.add('hidden')); await p.waitForTimeout(300); // карту закрываем напрямую — без гонки
  await tap(9); const s3 = await st(); console.log((s3.esc ? '✓' : '✗') + ' Start — меню и пауза');
  await tap(9); const s4 = await st(); console.log((!s4.esc ? '✓' : '✗') + ' Start ещё раз — меню закрылось');
  await tap(0); await p.waitForTimeout(500); const man1 = await p.evaluate(() => document.body.innerText.match(/ручн|manual/i) ? true : false);
  const hud = await p.evaluate(() => { const h = document.querySelector('#man-hud'); return h ? getComputedStyle(h).display !== 'none' && !h.classList.contains('hidden') : null; });
  console.log((hud ? '✓' : '✗') + ' A — ручной полёт включён (#man-hud ' + hud + ')');
  await p.evaluate(() => { window.__pad.axes[1] = -1; }); await p.waitForTimeout(2500);
  const v = await p.evaluate(() => Math.hypot(...window.__VF_DBG.S.me.v)); await p.evaluate(() => { window.__pad.axes[1] = 0; });
  console.log((v > 5 ? '✓' : '✗') + ' левый стик вперёд — корабль набирает ход (' + v.toFixed(0) + ' м/с)');
  console.log(errs.length ? 'ОШИБКИ: ' + errs.slice(0, 3).join(' | ') : 'ошибок нет');
  await b.close();
})();
