// Витрина всех орудий (тип × уровень) для проверки моделей: node tools/build-standalone.js && node tools/weapons-sheet.js [файл.jpg]
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
(async () => {
  const OUT = process.argv[2] || path.join(ROOT, 'dist/weapons.jpg');
  const page = path.join(ROOT, 'dist/.wpn-studio.html');
  fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"></head><body>' + fs.readFileSync(path.join(ROOT, 'dist/void-frontier.html'), 'utf8') + '</body></html>');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + page);
    await p.fill('#lg-name', 'Оружейная'); await p.fill('#lg-pass', 'studio'); await p.click('#lg-go');
    await p.waitForFunction(() => window.__VF_WSHEET && !document.querySelector('#ui').classList.contains('hidden'), null, { timeout: 60000 });
    await p.waitForTimeout(1500);
    const url = await p.evaluate(() => window.__VF_WSHEET());
    fs.writeFileSync(OUT, Buffer.from(url.split(',')[1], 'base64'));
    console.log('готово:', OUT, errs.length ? 'ошибки: ' + errs.join('; ') : '');
  } finally { await browser.close(); fs.unlinkSync(page); }
})();
