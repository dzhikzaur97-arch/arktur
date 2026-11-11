// Релизные архивы для площадок + проверка их лимитов. Запуск: node tools/build-release.js [--skip-standalone]
//   dist/release/arktur-<версия>-itch-html5.zip        itch.io «HTML5»: index.html и ресурсы в корне архива
//   dist/release/arktur-<версия>-itch-download.zip     itch.io «скачать»: один самодостаточный ARKTUR.html (открывается с диска)
//   dist/release/arktur-<версия>-crazygames.zip        CrazyGames Basic Launch
//   dist/release/arktur-<версия>-poki.zip              Poki (сборка для первой заявки)
//   dist/release/arktur-<версия>-yandex.zip            Яндекс Игры
//   dist/release/arktur-<версия>-web.zip               сайт (GitHub Pages)
//   desktop/app/                                       файлы игры для Electron-приложения (desktop/)
// Отчёт: dist/release/MANIFEST.json и SHA256SUMS.txt.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { zipDir, zipBuffers, listFiles } = require('./zip.js');

const ROOT = path.join(__dirname, '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/package.json'), 'utf8')).version; // одна версия на все площадки
const REL = path.join(ROOT, 'dist/release');
const MB = 1024 * 1024;

execFileSync(process.execPath, [path.join(__dirname, 'build-public.js'), '--target=all', ...process.argv.slice(2).filter(a => a === '--skip-standalone')], { stdio: 'inherit' });
const THREE_FILES = require('./three-files.js');

fs.rmSync(REL, { recursive: true, force: true });
fs.mkdirSync(REL, { recursive: true });
const report = { version: VERSION, built: new Date().toISOString(), archives: {}, checks: [] };
const check = (ok, what) => { report.checks.push({ ok, what }); console.log((ok ? '  ✓ ' : '  ✗ ') + what); if (!ok) process.exitCode = 1; };
const dirStats = (dir) => { const files = listFiles(dir); const sizes = files.map(f => fs.statSync(path.join(dir, f)).size); return { files: files.length, bytes: sizes.reduce((a, b) => a + b, 0), maxFile: Math.max(...sizes), list: files }; };
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const noExternalRefs = (dir) => {
  // ни одного обращения к внешним адресам в коде загрузки: importmap, src=, href= (ссылки в тексте лицензий не считаются)
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const bad = [...html.matchAll(/\b(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/g)].map(m => m[0]).filter(x => !/sdk\.js/.test(x));
  const im = (html.match(/<script type="(?:importmap|text\/vf-defer" data-t="importmap)">([\s\S]*?)<\/script>/) || [])[1] || '';
  return { bad, importmapExternal: /https?:\/\//.test(im) };
};

function pack(id, dir, name, limits) {
  const st = dirStats(dir), file = path.join(REL, `arktur-${VERSION}-${name}.zip`), z = zipDir(dir, file);
  report.archives[name] = { file: path.relative(ROOT, file).split(path.sep).join('/'), zipBytes: z.bytes, files: st.files, unpackedBytes: st.bytes, maxFileBytes: st.maxFile, sha256: sha256(file) };
  console.log(`${name}: ${(z.bytes / MB).toFixed(2)} МБ в архиве, ${st.files} файлов, распаковано ${(st.bytes / MB).toFixed(2)} МБ, крупнейший файл ${(st.maxFile / MB).toFixed(2)} МБ`);
  check(st.list.includes('index.html'), `${name}: index.html в корне архива`);
  if (limits.maxFile) check(st.maxFile <= limits.maxFile, `${name}: каждый файл ≤ ${(limits.maxFile / MB).toFixed(0)} МБ`);
  if (limits.total) check(st.bytes <= limits.total && z.bytes <= limits.total, `${name}: размер ≤ ${(limits.total / MB).toFixed(0)} МБ`);
  if (limits.files) check(st.files <= limits.files, `${name}: файлов ≤ ${limits.files}`);
  const ext = noExternalRefs(dir);
  check(!ext.bad.length && !ext.importmapExternal, `${name}: нет внешних src/href и CDN — все ресурсы локальные${ext.bad.length ? ' (' + ext.bad.join(', ') + ')' : ''}`);
  return file;
}

const T = (id) => path.join(ROOT, 'dist/targets', id);
pack('itch', T('itch'), 'itch-html5', { maxFile: 7 * MB, total: 500 * MB, files: 1000 });
pack('crazygames', T('crazygames'), 'crazygames', { total: 50 * MB, files: 1500 });
pack('poki', T('poki'), 'poki', { total: 50 * MB, files: 1500 });
pack('yandex', T('yandex'), 'yandex', { total: 100 * MB });
pack('web', path.join(ROOT, 'dist/site'), 'web', {});

// itch «скачать»: один файл со встроенным three.js (data: URL в карте импортов) — открывается двойным щелчком, без сервера.
{
  const spec = (f) => f === 'build/three.module.js' ? 'three' : 'three/addons/' + f.slice('examples/jsm/'.length);
  const js = THREE_FILES.filter(f => f.endsWith('.js')), have = new Set(js.map(spec)), map = {};
  for (const f of js) {
    let src = fs.readFileSync(path.join(ROOT, 'node_modules/three', f), 'utf8');
    src = src.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\2/g, (m, pre, q, rel) => {
      const s = spec(path.posix.normalize(path.posix.join(path.posix.dirname(f), rel)));
      if (!have.has(s)) throw new Error(`${f}: зависимость ${rel} не входит в сборку`);
      return pre + q + s + q;
    });
    map[spec(f)] = 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
  }
  let html = fs.readFileSync(path.join(T('itch'), 'index.html'), 'utf8');
  const im = /<script type="importmap">[\s\S]*?<\/script>/;
  if (!im.test(html)) throw new Error('нет карты импортов');
  html = html.replace(im, () => `<script type="importmap">${JSON.stringify({ imports: map })}</script>`).replace("script-src 'self'", "script-src 'self' data:");
  html = html.replace(/window\.VF_MUSIC = \{[^;]*\};/g, 'window.VF_MUSIC = null;'); // один файл — без папки музыки: играет синтезированная
  const readme = `ARKTUR: Космический рубеж / ARKTUR: Space Frontier — ${VERSION} (alpha)

RU: Откройте файл ARKTUR.html в браузере (Chrome, Edge, Firefox, Safari) — двойным щелчком. Интернет не нужен.
    Сохранения хранятся в браузере для этого файла: не переименовывайте и не перемещайте его, иначе браузер начнёт «новую» игру
    (перенести прогресс можно через меню «Сохранения» → выгрузить в файл / загрузить из файла).
EN: Open ARKTUR.html in your browser (Chrome, Edge, Firefox, Safari) by double-clicking it. No internet needed.
    Saves are kept by the browser for this file: do not rename or move it, or the browser will start a "new" game
    (move progress via the Saves menu → export to file / import from file).

Лицензии / Licenses: LICENSE (игра / game, MIT), THREE-LICENSE.txt (three.js, MIT).
`;
  const file = path.join(REL, `arktur-${VERSION}-itch-download.zip`);
  const buf = zipBuffers([{ name: 'ARKTUR.html', data: Buffer.from(html) }, { name: 'README.txt', data: Buffer.from(readme) },
    { name: 'LICENSE', data: fs.readFileSync(path.join(T('itch'), 'LICENSE')) }, { name: 'THREE-LICENSE.txt', data: fs.readFileSync(path.join(ROOT, 'node_modules/three/LICENSE')) },
    { name: 'privacy.html', data: fs.readFileSync(path.join(T('itch'), 'privacy.html')) }]);
  fs.writeFileSync(file, buf);
  fs.mkdirSync(path.join(ROOT, 'dist/targets/itch-download'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'dist/targets/itch-download/ARKTUR.html'), html); // для проверки открытием с диска
  report.archives['itch-download'] = { file: path.relative(ROOT, file).split(path.sep).join('/'), zipBytes: buf.length, files: 5, htmlBytes: Buffer.byteLength(html), sha256: sha256(file) };
  console.log(`itch-download: ${(buf.length / MB).toFixed(2)} МБ, ARKTUR.html ${(Buffer.byteLength(html) / MB).toFixed(2)} МБ`);
  check(!/https?:\/\/cdn|src="https?:/.test(html), 'itch-download: всё встроено, без сети');
}

// Electron: файлы игры → desktop/app
{
  const to = path.join(ROOT, 'desktop/app');
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(T('desktop'), to, { recursive: true });
  const st = dirStats(to);
  console.log(`desktop/app: ${st.files} файлов, ${(st.bytes / MB).toFixed(2)} МБ`);
  check(fs.existsSync(path.join(to, 'index.html')), 'desktop/app: игра скопирована для Electron');
}

fs.writeFileSync(path.join(REL, 'MANIFEST.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(REL, 'SHA256SUMS.txt'), Object.values(report.archives).map(a => `${a.sha256}  ${path.basename(a.file)}`).join('\n') + '\n');
console.log(process.exitCode ? 'ЕСТЬ НАРУШЕНИЯ ЛИМИТОВ — см. выше' : 'Все проверки пройдены. Архивы: dist/release/');
