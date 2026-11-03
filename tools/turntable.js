// Осмотр моделей кораблей со всех сторон (6 ракурсов в строку): node tools/build-standalone.js && node tools/turntable.js [папка] [корабль,…]
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { SHIPS } = require('../server/data'); require('../server/newships'); require('../server/mega');
const ROOT = path.join(__dirname, '..');
(async () => {
  const OUT = process.argv[2] || path.join(ROOT, 'dist/turntable'), only = process.argv[3] ? process.argv[3].split(',') : null;
  const types = Object.keys(SHIPS).filter(t => SHIPS[t].role && (!only || only.includes(t)));
  const page = path.join(ROOT, 'dist/.turn-studio.html');
  fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"></head><body>' + fs.readFileSync(path.join(ROOT, 'dist/void-frontier.html'), 'utf8') + '</body></html>');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + page);
    await p.fill('#lg-name', 'Осмотр'); await p.fill('#lg-pass', 'studio'); await p.click('#lg-go');
    await p.waitForFunction(() => window.__VF_TURN && !document.querySelector('#ui').classList.contains('hidden'), null, { timeout: 60000 });
    await p.waitForTimeout(2000);
    fs.mkdirSync(OUT, { recursive: true });
    // WPN=1 — с полным набором оружия во всех верхних слотах (разные типы по кругу)
    const KINDS = [{ kind: 'weapon', fam: 'pl', lv: 5, color: 0xff6040 }, { kind: 'weapon', fam: 'rg', lv: 3, color: 0x60c0ff }, { kind: 'weapon', fam: 'ac', lv: 1 }, { kind: 'launcher', lv: 2 }, { kind: 'weapon', fam: 'pt', lv: 4, color: 0x60ffd0 }, { kind: 'weapon', fam: 'ion', lv: 2, color: 0xa080ff }, { kind: 'miner', lv: 1 }];
    for (const t of types) { const wpn = process.env.WPN ? Array.from({ length: SHIPS[t].slots.high }, (_, i) => KINDS[i % KINDS.length]) : null;
      const TW = +process.env.TW || 320, TH = Math.round(TW / 1.6); const url = await p.evaluate(([t, w, a, b]) => window.__VF_TURN(t, w, a, b), [t, wpn, TW, TH]); fs.writeFileSync(path.join(OUT, t + '.jpg'), Buffer.from(url.split(',')[1], 'base64')); }
    if (process.env.WPN) console.log('орудия (встало/нужно):', JSON.stringify(await p.evaluate(() => window.__VF_WPN_N)));
    console.log('готово:', types.length, errs.length ? 'ошибки: ' + errs.join('; ') : '');
  } finally { await browser.close(); fs.unlinkSync(page); }
})();
