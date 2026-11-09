// Съёмка настоящих скриншотов и игровых видео ARKTUR для страниц площадок.
// Это не монтаж и не сгенерированные кадры: каждая картинка — кадр настоящей игры (собранная портальная версия в Chromium),
// сцены поставлены через отладочный доступ игры (выбор корабля, место в космосе, появление пиратов), дальше всё считает сама игра.
// Видео: виртуальные часы Playwright — игра идёт ровно на 1/fps секунды между кадрами, поэтому медленный программный рендер
// (без видеокарты) не делает видео рваным. Звука нет, курсора нет (headless), панелей браузера нет.
//
// node tools/media/capture.js <папка> shots <en|ru> [ширина] [высота]
// node tools/media/capture.js <папка> video <en|ru> <ширина> <высота> <fps> <сцена:секунды,...>   например flight:6.5,combat:7,mining:6
'use strict';
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const [OUT, MODE, LANG = 'en', W = '1920', H = '1080', FPS = '30', PLAN = 'flight:6.5,combat:7,mining:6'] = process.argv.slice(2);
const ROOT = path.join(__dirname, '../..');
// английская версия — сборка CrazyGames (английский по умолчанию), русская — itch (язык браузера ru-RU)
const BUILD = path.join(ROOT, 'dist/targets', LANG === 'en' ? 'crazygames' : 'itch');
const PORT = 9300 + Math.floor(Math.random() * 600);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png' };
http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]), f = path.join(BUILD, u === '/' ? 'index.html' : u);
  if (!f.startsWith(BUILD) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
}).listen(PORT);
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio'] });
  const ctx = await b.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1, locale: LANG === 'en' ? 'en-US' : 'ru-RU' });
  await ctx.addInitScript(() => {
    localStorage.setItem('vf-dev', '1'); localStorage.setItem('vf-intro', '1'); localStorage.setItem('vf-welcome', '1'); localStorage.setItem('vf-dream-asked', '1');
    localStorage.setItem('vf-news', '999');
    localStorage.setItem('vf-cfg', JSON.stringify({ quality: 'high', autoQ: false, fpsCap: 30, advisor: false }));
    localStorage.setItem('vf-tut', JSON.stringify({ hidden: true, careerHidden: true, allTabs: true, done: { sell: 1, undock: 1, belt: 1, lock: 1 } }));
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install(); await p.clock.resume(); // время идёт как обычно, пока ставим сцену
  const cdp = await ctx.newCDPSession(p);
  const shot = async (file, type = 'png') => {
    const { data } = await cdp.send('Page.captureScreenshot', type === 'png' ? { format: 'png' } : { format: 'jpeg', quality: 92 });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  };
  const wait = (ms) => p.waitForTimeout(ms);
  const G = (fn, arg) => p.evaluate(fn, arg);

  await p.goto(`http://127.0.0.1:${PORT}/`); await wait(4000);
  // всплывающие уведомления и обучение не попадают в кадр (остальной интерфейс — как у игрока)
  await p.addStyleTag({ content: '#notes, #tut, #advice, #modal { display: none !important; }' });
  // CLEAN=1 — «чистый кадр» для обложек: только сама сцена игры, без панелей интерфейса
  const clean = () => process.env.CLEAN === '1' && p.evaluate(() => document.querySelectorAll('#ui > *').forEach(x => { x.style.visibility = 'hidden'; }));
  await p.fill('#lg-name', LANG === 'en' ? 'Nova' : 'Нова'); await p.fill('#lg-pass', '123456'); await p.click('#lg-go'); await wait(8000);
  // пилот-ветеран: навыки и деньги, чтобы летать на любом корабле (как после долгой игры)
  await G(() => { const g = window.__VF_GAME, s = [...g.sessions].find(x => !x.isBot); for (const k of Object.keys(window.__VF_DBG.S.data.skills)) s.player.skills[k] = 5; s.player.credits = 48500000; g.sendProfile(s); });
  await wait(1500);

  const me = () => G(() => { const g = window.__VF_GAME; return [...g.sessions].find(x => !x.isBot); });
  async function dockAt(home) { // вернуться на станцию (если в космосе) — через смерть не надо: телепорт к станции и стыковка
    await G(() => { const g = window.__VF_GAME, s = [...g.sessions].find(x => !x.isBot); if (s.docked) return; const st = g.U.celestials[s.player.home]; s.ent.pos = [st.pos[0] + 3000, st.pos[1], st.pos[2] + 3000]; s.ent.vel = [0, 0, 0]; window.__VF_DBG.send({ t: 'dock', id: s.player.home }); });
    await wait(4000);
  }
  async function shipAndUndock(type) {
    await dockAt();
    await G((type) => { const g = window.__VF_GAME, s = [...g.sessions].find(x => !x.isBot); s.player.ship = g.newShip(type, false); g.sendProfile(s); window.__VF_DBG.send({ t: 'undock' }); }, type);
    await wait(6000);
  }
  const cam = (o) => G((o) => { const c = window.__VF_CAM; if (!c._d0) c._d0 = c.dist; Object.assign(c, o.yaw != null ? { yaw: o.yaw } : {}, o.pitch != null ? { pitch: o.pitch } : {}); if (o.k) c.dist = c._d0 * o.k; }, o);

  // ---------- сцены: ставятся в реальном времени, возвращают «шаг камеры» на кадр ----------
  const SCENES = {
    async hangar() { await dockAt(); await G(() => { window.__VF_GAME && 0; }); await wait(2500); return null; },
    async flight() {
      await shipAndUndock('kometa');
      // открытый космос в стороне от станции, полный ход к вратам — шлейфы из всех дюз
      await G(() => { const g = window.__VF_GAME, s = [...g.sessions].find(x => !x.isBot), e = s.ent; e.pos = [e.pos[0] + 6e5, e.pos[1] + 1.5e5, e.pos[2] - 4e5]; e.vel = [0, 0, 0]; e.invulnUntil = Date.now() + 36e5; });
      await wait(2500);
      await G(() => { const D = window.__VF_DBG, gt = D.S.sys.celestials.find(c => c.kind === 'gate'); D.act('approach', gt.id); });
      await wait(9000); await cam({ yaw: 2.4, pitch: 0.2, k: 0.36 });
      return { yaw: 0.0045 };
    },
    async combat() {
      await shipAndUndock('molot');
      await G(() => { const g = window.__VF_GAME, s = [...g.sessions].find(x => !x.isBot), e = s.ent; e.pos = [e.pos[0] - 5e5, e.pos[1] + 1e5, e.pos[2] + 7e5]; e.vel = [0, 0, 0]; e.invulnUntil = Date.now() + 36e5;
        for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.4; g.spawnNpc(['raider', 'reaper', 'corsair'][i], e.sys, [e.pos[0] + Math.cos(a) * 9000, e.pos[1] + 600 * i, e.pos[2] + Math.sin(a) * 9000]); } });
      await wait(3000);
      // захват ближайшего пирата, орбита и все орудия — дальше бой считает игра
      await G(() => { const D = window.__VF_DBG, S = D.S; const t = [...S.ents.values()].filter(o => o.k === 's' && o.npc).sort((a, b) => Math.hypot(...a.p.map((v, i) => v - S.me.p[i])) - Math.hypot(...b.p.map((v, i) => v - S.me.p[i])))[0]; if (!t) return; D.act('lock', t.id); D.act('orbit', t.id); window.__VF_TGT = t.id; });
      await wait(4000);
      await G(() => { const D = window.__VF_DBG, S = D.S; S.me.mods.forEach((m, i) => { if (m && ['weapon', 'launcher'].includes(S.data.modules[m.id].kind) && !m.a) D.send({ t: 'module', slot: i, target: window.__VF_TGT }); }); });
      await wait(6500); await cam({ yaw: 0.9, pitch: 0.26, k: 0.62 });
      return { yaw: -0.003 };
    },
    async mining() {
      await shipAndUndock('begemot');
      await G(() => { const g = window.__VF_GAME, s = [...g.sessions].find(x => !x.isBot), e = s.ent, b = g.U.systems[e.sys].belts[0]; e.pos = [b.pos[0] + 2500, b.pos[1] + 400, b.pos[2] - 2500]; e.vel = [0, 0, 0]; e.invulnUntil = Date.now() + 36e5; if (s.player.foundryOff) window.__VF_DBG.send({ t: 'foundry' }); });
      await wait(9000); await cam({ yaw: 3.6, pitch: 0.28, k: 0.75 });
      return { yaw: 0.0035 };
    },
    async map() { await G(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true }))); await wait(3500); return null; },
    async board() { await G(() => { const m = document.getElementById('map'); if (m) m.classList.add('hidden'); document.querySelector('[data-m=board]').click(); }); await wait(3500); return null; },
    async closeWin() { await G(() => { const x = document.getElementById('win-close'); if (x) x.click(); const m = document.getElementById('map'); if (m) m.classList.add('hidden'); }); await wait(800); return null; }
  };

  if (MODE === 'shots') {
    const list = process.env.SCENES ? process.env.SCENES.split(',').map(x => x.split(':')) : [['01-flight', 'flight'], ['02-combat', 'combat'], ['03-mining', 'mining'], ['04-map', 'map'], ['05-board', 'board'], ['06-hangar', 'hangar']];
    for (const [name, sc] of list) {
      if (sc !== 'board' && sc !== 'map') await SCENES.closeWin();
      log('сцена', sc); await SCENES[sc](); await clean(); await wait(300);
      await shot(path.join(OUT, `${LANG}-${name}.png`)); log('  →', `${LANG}-${name}.png`);
    }
  } else {
    // видео: каждая сцена ставится в реальном времени, потом часы останавливаются и кадры снимаются строго по 1/fps
    const fps = +FPS, step = 1000 / fps; let n = 0;
    for (const part of PLAN.split(',')) {
      const [sc, sec] = part.split(':'); log('сцена', sc, sec + ' с');
      await SCENES.closeWin(); const mv = await SCENES[sc]();
      const now = await G(() => Date.now()); await p.clock.pauseAt(now + 1500); // с запасом: пока идёт вызов, часы ещё бегут
      await p.clock.runFor(step); await shot(path.join(OUT, 'warm.jpg'), 'jpeg'); // первый кадр сцены дольше (шейдеры)
      const frames = Math.round(+sec * fps);
      for (let i = 0; i < frames; i++) {
        if (mv) await G((mv) => { const c = window.__VF_CAM; if (mv.yaw) c.yaw += mv.yaw; }, mv);
        await p.clock.runFor(step);
        await shot(path.join(OUT, `f${String(n++).padStart(5, '0')}.jpg`), 'jpeg');
        if (i % 30 === 0) log(`  кадр ${i}/${frames}`);
      }
      await p.clock.resume();
    }
    fs.rmSync(path.join(OUT, 'warm.jpg'), { force: true });
    log('кадров:', n);
  }
  log('ошибки страницы:', errs.length ? errs.slice(0, 3).join(' | ') : 'нет');
  await b.close(); process.exit(0);
})().catch(e => { console.error('СБОЙ', e); process.exit(1); });
