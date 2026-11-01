// Единая серия фото кораблей: рендерит 3D-модели игры в одном стиле (фон, свет, ракурс, окраска)
// и сохраняет в public/img/photos/<корабль>.jpg. Класс мощи задаёт размер в кадре, назначение — цвет контрового света.
// Нужен Playwright с Chromium. Запуск: node tools/build-standalone.js && node tools/make-photos.js [корабль,…]
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { SHIPS } = require('../server/data');
require('../server/newships'); // корабли вольных гильдий

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public/img/photos');

(async () => {
  const only = process.argv[2] ? process.argv[2].split(',') : null;
  const types = Object.keys(SHIPS).filter(t => SHIPS[t].role && (!only || only.includes(t)));
  // одиночная сборка без обёртки документа — оборачиваем во временный файл
  const page = path.join(ROOT, 'dist/.photo-studio.html');
  fs.writeFileSync(page, '<!doctype html><html><head><meta charset="utf-8"></head><body>' + fs.readFileSync(path.join(ROOT, 'dist/void-frontier.html'), 'utf8') + '</body></html>');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + page);
    await p.fill('#lg-name', 'Фотограф'); await p.fill('#lg-pass', 'studio'); await p.click('#lg-go');
    await p.waitForFunction(() => window.__VF_PHOTO && !document.querySelector('#ui').classList.contains('hidden'), null, { timeout: 60000 });
    await p.waitForTimeout(2500);
    fs.mkdirSync(OUT, { recursive: true });
    for (const t of types) {
      const url = await p.evaluate((t) => window.__VF_PHOTO(t), t);
      fs.writeFileSync(path.join(OUT, t + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
      console.log(`${t}: ${SHIPS[t].role}, класс ${SHIPS[t].tier}`);
    }
    if (errs.length) console.log('Ошибки страницы:', errs);
  } finally {
    await browser.close();
    fs.unlinkSync(page);
  }
})();
