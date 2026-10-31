// Снимки экрана телефона для Google Play (1080×1920) на русском и английском.
// Запуск: node tools/build-public.js && node tools/make-store-shots.js  →  publish/google-play/store/screens-{en,ru}/
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..'), SITE = path.join(ROOT, 'dist/site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  let f = path.join(SITE, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html';
  if (!f.startsWith(SITE) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0);
(async () => {
  const url = `http://localhost:${srv.address().port}/`;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const lang of ['en', 'ru']) {
    const out = path.join(ROOT, 'publish/google-play/store/screens-' + lang); fs.mkdirSync(out, { recursive: true });
    const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    await p.addInitScript((l) => { try { localStorage.setItem('vf-lang', l); localStorage.setItem('vf-intro', '1'); localStorage.setItem('vf-welcome', '1'); localStorage.setItem('vf-tut', JSON.stringify({ allTabs: true, hidden: true, careerHidden: true, done: {} })); localStorage.setItem('vf-cfg', JSON.stringify({ autoQ: false, quality: 'high' })); } catch {} }, lang);
    const shot = async (name) => { await p.evaluate(() => { document.querySelectorAll('.note,.ach-pop,#toasts *').forEach(n => n.remove()); const m = document.querySelector('#modal'); if (m) m.classList.add('hidden'); }); await p.waitForTimeout(800); await p.screenshot({ path: path.join(out, name + '.png'), timeout: 180000 }); console.log(lang, name); };
    await p.goto(url); await p.waitForTimeout(5000);
    await p.fill('#lg-name', lang === 'en' ? 'Nova' : 'Нова'); await p.fill('#lg-pass', 'store'); await p.click('#lg-go'); await p.waitForTimeout(6000);
    const G = 'window.__VF_GAME', me = `[...${G}.sessions].find(x => !x.isBot)`;
    await p.evaluate(`(() => { const s = ${me}; s.player.credits = 12e6; s.player.ship.type = 'flagman'; ${G}.sendProfile(s); })()`);
    await p.waitForTimeout(1500);
    await shot('1-station');
    // напарники
    await p.evaluate(`(() => { const s = ${me}; for (let i = 0; i < 3; i++) { const c = ${G}.wingCandidates(s.docked)[i]; ${G}.handle(s, { t: 'wingHire', id: c.id }); } })()`);
    await p.evaluate(() => document.querySelector('#st-tabs [data-tab=wing]').click()); await p.waitForTimeout(2000);
    await p.evaluate(() => { const b = document.querySelector('[data-a=wingOpen]'); if (b) b.click(); }); await p.waitForTimeout(1200);
    await shot('2-wingmen');
    // космос с напарниками
    await p.evaluate(() => document.querySelector('#st-undock').click()); await p.waitForTimeout(9000);
    await shot('3-space');
    // карта с червоточиной
    await p.evaluate(`(() => { ${G}.whOpen('eho'); })()`); await p.waitForTimeout(1000);
    await p.evaluate(() => document.querySelector('#mbar [data-m=menu]') && 0); await p.keyboard.press('KeyM'); await p.waitForTimeout(2500);
    await shot('4-map');
    await p.keyboard.press('KeyM'); await p.waitForTimeout(800);
    await ctx.close();
  }
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
