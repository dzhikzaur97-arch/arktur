// Сквозная проверка игры в браузере: вход, все вкладки станции и окна меню, задания, напарники, вылет, пираты рядом и бой,
// обзор (каждый объект), карта и метки, зонды, тактика, дроны, сканер, ручное управление, автоигра, варп, прыжки.
// Собирает все ошибки страницы. Запуск: node tools/build-standalone.js && node tools/smoke-test.js ["iPhone 13" | desktop]
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-smoke-')), DEV = process.argv[2] || 'iPhone 13';
fs.writeFileSync(path.join(dir, 'sa.html'), '<!doctype html>' + fs.readFileSync(path.join(__dirname, '../dist/void-frontier.html'), 'utf8'));
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext(DEV === 'desktop' ? { viewport: { width: 1400, height: 860 } } : { ...devices[DEV] });
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('vf-intro', '1'); localStorage.setItem('vf-welcome', '1'); localStorage.setItem('vf-cfg', JSON.stringify({ quality: 'low' })); localStorage.setItem('vf-tut', JSON.stringify({ hidden: true, careerHidden: true, allTabs: true, done: { sell: 1, undock: 1, belt: 1, lock: 1 } })); } catch {} });
  const errs = []; let step = 'старт';
  p.on('pageerror', e => errs.push(`[${step}] ${e.message} :: ${(e.stack || '').split('\n').slice(1, 4).join(' | ')}`));
  p.on('console', m => { if (m.type() === 'error') errs.push(`[${step}] console: ${m.text().slice(0, 300)}`); });
  const W = (ms) => p.waitForTimeout(ms);
  const ev = (f, a) => p.evaluate(f, a).catch(e => errs.push(`[${step}] evaluate: ${e.message.slice(0, 200)}`));
  const closeModal = () => ev(() => { const m = document.querySelector('#modal'); if (m) m.classList.add('hidden'); });
  const click = (sel) => ev((s) => { const el = document.querySelector(s); if (el) el.click(); return !!el; }, sel);
  const clickAll = async (sel, max = 30, wait = 250) => { const n = await ev((s) => document.querySelectorAll(s).length, sel) || 0; for (let i = 0; i < Math.min(n, max); i++) { await ev(([s, i]) => { const el = document.querySelectorAll(s)[i]; if (el && !el.disabled) el.click(); }, [sel, i]); await W(wait); await closeModal(); } return n; };
  await p.goto('file://' + dir + '/sa.html'); await W(3000);
  await p.fill('#lg-name', 'Смоук' + Math.floor(Math.random() * 1e4)); await p.fill('#lg-pass', '123'); await p.click('#lg-go'); await W(6000);
  await closeModal();
  await ev(() => { const G = window.__VF_GAME, s = [...G.sessions].find(x => !x.isBot); s.player.credits = 9e9; for (const k of Object.keys(s.player.skills || {})) s.player.skills[k] = 5; G.sendProfile(s); });
  await W(800);
  // 1. станция: все вкладки и их внутренние переключатели
  const tabs = await ev(() => [...document.querySelectorAll('#st-tabs [data-tab]')].map(x => x.dataset.tab)) || [];
  for (const t of tabs) {
    step = 'станция/' + t; await click(`#st-tabs [data-tab="${t}"]`); await W(900); await closeModal();
    await clickAll('#st-body [data-a$="Tab"], #st-body [data-tab2], #st-body .tabs button', 8, 400);
  }
  // задания и напарники
  step = 'задания'; await click('#st-tabs [data-tab="agents"]'); await W(800); await clickAll('#st-body [data-a="accept"]', 3, 600);
  step = 'напарники'; await click('#st-tabs [data-tab="wing"]'); await W(1200); await clickAll('#st-body [data-a="wingHire"]', 2, 700);
  // 2. окна меню
  const wins = await ev(() => [...document.querySelectorAll('#neocom [data-win]')].map(x => x.dataset.win)) || [];
  for (const w of wins) {
    if (w === 'map') continue;
    step = 'окно/' + w; await click(`#neocom [data-win="${w}"]`); await W(1100); await closeModal();
    await clickAll('#win-body [data-a$="Tab"], #win-body [data-tab2], #win-body .tabs button', 8, 500);
    await click('#win-close'); await W(200);
  }
  // 3. вылет
  step = 'вылет'; await ev(() => window.__VF_DBG.send({ t: 'undock' })); await W(5000); await closeModal();
  step = 'пираты рядом'; await ev(() => { const G = window.__VF_GAME, s = [...G.sessions].find(x => !x.isBot), e = s.ent; for (let i = 0; i < 3; i++) { const a = i * 2.1; G.spawnNpc(['raider', 'reaper', 'corsair'][i], e.sys, [e.pos[0] + Math.cos(a) * 20000, e.pos[1], e.pos[2] + Math.sin(a) * 20000]); } });
  await W(12000);
  step = 'бой с пиратами'; await ev(() => { const D = window.__VF_DBG; const n = [...D.S.ents.values()].find(e => e.k === 's' && e.npc); if (n) { D.S.sel = n.id; D.act('lock', n.id); D.act('fight', n.id); } }); await W(15000);
  // обзор: каждая вкладка, каждый объект — выбор и кнопки действий (кроме опасных)
  const ovt = await ev(() => [...document.querySelectorAll('#ov-tabs span')].length) || 0;
  for (let i = 0; i < ovt; i++) {
    step = 'обзор/вкладка' + i; await ev((i) => document.querySelectorAll('#ov-tabs span')[i].click(), i); await W(700);
    const rows = await ev(() => document.querySelectorAll('#ov-list [data-id]').length) || 0;
    for (let r = 0; r < Math.min(rows, 12); r++) {
      step = `обзор/${i}/объект${r}`;
      await ev((r) => { const el = document.querySelectorAll('#ov-list [data-id]')[r]; if (el) el.click(); }, r); await W(500);
      await ev(() => { for (const bt of document.querySelectorAll('#sel-body button[data-a="info"], #sel-body button[data-a="lock"], #sel-body button[data-a="approach"]')) bt.click(); }); await W(400);
      await closeModal(); await click('#win-close');
    }
  }
  // 4. карта: открыть, щёлкнуть по точкам, метка, зонды
  step = 'карта'; await click('#neocom [data-win="map"]'); await W(1500);
  const box = await p.$('#map-canvas'); if (box) { const bb = await box.boundingBox(); for (let k = 0; k < 6; k++) { await p.mouse.click(bb.x + bb.width * (0.2 + 0.12 * k), bb.y + bb.height * (0.3 + 0.07 * k)); await W(500); } }
  await clickAll('#map-tabs button', 4, 800);
  await ev(() => { const b = document.querySelector('[data-mapact="mput"]'); if (b) b.click(); }); await W(800);
  await ev(() => { const b = document.querySelector('[data-mapact="pon"]'); if (b) b.click(); }); await W(800);
  await ev(() => { const b = document.querySelector('[data-mapact="poff"]'); if (b) b.click(); }); await W(500);
  await click('#map-close'); await W(800);
  // 5. тактика, дроны, напарники, ручное управление, сканер
  step = 'тактика'; await click('#b-tac'); await W(1500); await clickAll('.tac-top button', 4, 600);
  step = 'дроны'; await clickAll('#dr-body button', 8, 500);
  step = 'напарники-приказы'; await clickAll('#wing-body button', 8, 500);
  step = 'сканер'; await click('#b-scan'); await W(9000);
  step = 'ручное'; await click('#b-manual'); await W(2500); await click('#b-manual'); await W(800);
  // 6. автоигра — охота, 60 с, затем варп к заданию и прыжки
  step = 'автоигра'; await ev(() => window.__VF_DBG.send({ t: 'autoplay', on: true, mode: 'hunt', bold: true })); await W(60000);
  await ev(() => window.__VF_DBG.send({ t: 'autoplay', on: false })); await W(1500);
  step = 'варп к аномалии'; await ev(() => { const D = window.__VF_DBG, a = (D.S.anoms || [])[0]; if (a) D.act('warp', a.id); }); await W(15000);
  step = 'прыжок'; await ev(() => { const D = window.__VF_DBG, g = D.S.sys.celestials.find(c => c.kind === 'gate'); if (g) D.act('jump', g.id); }); await W(25000);
  await ev(() => { const D = window.__VF_DBG, g = D.S.sys.celestials.find(c => c.kind === 'gate'); if (g) D.act('jump', g.id); }); await W(25000);
  step = 'бой'; await ev(() => window.__VF_DBG.send({ t: 'autoplay', on: true, mode: 'auto', bold: true })); await W(45000);
  // 7. окна ещё раз в полёте
  for (const w of wins) { if (w === 'map') continue; step = 'полёт/окно/' + w; await click(`#neocom [data-win="${w}"]`); await W(700); await closeModal(); await click('#win-close'); }
  await p.screenshot({ path: dir + '/smoke_' + DEV.replace(/ /g, '_') + '.png', timeout: 90000 }).catch(() => {});
  const bad = await ev(() => window.__VF_BADPOS) || [];
  const fatal = await ev(() => { const e = document.getElementById('vf-fatal'); return e ? e.textContent : ''; });
  console.log('устройство:', DEV, '| вкладок станции:', tabs.length, '| окон:', wins.length, '| вкладок обзора:', ovt);
  console.log('ОШИБКИ:', errs.length ? '\n' + [...new Set(errs)].join('\n') : 'нет');
  console.log('БЕЗ КООРДИНАТ:', bad.length ? '\n' + bad.map(x => x.where + ' ← ' + x.st).join('\n') : 'нет');
  console.log('ОКНО ОШИБКИ:', fatal || 'нет');
  await b.close();
  if (errs.length || bad.length || fatal) process.exitCode = 1;
})();
