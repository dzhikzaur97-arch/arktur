// Список русских строк из кода, которых ещё нет в английском словаре public/js/i18n-en.js.
// Запуск: node tools/i18n-missing.js > missing.tsv  — затем добавьте переводы в словарь.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const CY = /[А-Яа-яЁё]/;
const files = [...fs.readdirSync(ROOT + '/server').filter(f => f.endsWith('.js')).map(f => 'server/' + f), 'public/js/main.js', 'public/js/surface.js', 'public/js/planetgen.js', 'public/js/render.js'];
const out = new Map(); // ключ → файл
const addKey = (k, f) => { k = k.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`'); for (let part of k.split(/<[^>]*>/)) { // HTML-теги в строке — отдельные куски текста
    for (let piece of part.split('\n')) { piece = piece.replace(/\s+/g, ' ').trim(); if (piece && CY.test(piece) && !out.has(piece)) out.set(piece, f); } } };
function scan(src, f) {
  let i = 0; const n = src.length;
  const readTemplate = () => { // i — после открывающей `
    let seg = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') { seg += src[i] + src[i + 1]; i += 2; continue; }
      if (c === '`') { i++; addKey(seg, f); return; }
      if (c === '$' && src[i + 1] === '{') { addKey(seg, f); seg = ''; i += 2; readCode(1); continue; }
      seg += c; i++;
    }
  };
  const readString = (q) => { let s = ''; while (i < n && src[i] !== q) { if (src[i] === '\\') { s += src[i] + src[i + 1]; i += 2; } else s += src[i++]; } i++; addKey(s, f); };
  const readCode = (depth) => { // до закрывающей } уровня depth (или до конца файла при depth=0)
    let prev = '';
    while (i < n) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) i = n; continue; }
      if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]/.test(prev)) { // регулярное выражение
        i++; let cls = false; while (i < n) { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; i++; } i++; while (/[a-z]/.test(src[i])) i++; prev = 'x'; continue; }
      if (c === '"' || c === "'") { i++; readString(c); prev = 'x'; continue; }
      if (c === '`') { i++; readTemplate(); prev = 'x'; continue; }
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) { i++; return; } }
      if (!/\s/.test(c)) prev = c;
      i++;
    }
  };
  readCode(-1e9);
}
for (const f of files) scan(fs.readFileSync(path.join(ROOT, f), 'utf8'), f);
// index.html: текстовые узлы и атрибуты
const html = fs.readFileSync(ROOT + '/public/index.html', 'utf8');
for (const m of html.matchAll(/>([^<>]+)</g)) addKey(m[1], 'index.html');
for (const m of html.matchAll(/(?:title|placeholder|aria-label)="([^"]+)"/g)) addKey(m[1], 'index.html');
global.window = {}; require(path.join(ROOT, 'public/js/i18n-en.js'));
const have = window.VF_EN;
const keys = [...out.keys()].filter(k => { const ti = k.match(/title="([^"]+)"/); k = ti && k.includes('">') ? ti[1].trim() : k.includes('">') ? k.slice(k.lastIndexOf('">') + 2).trim() : k.replace(/^[>"]+/, '').trim(); return !(k in have); });
for (const k of keys) console.log(out.get(k) + '\t' + k);
console.error(keys.length, 'строк без перевода (часть — служебные: подсказки Claude, комментарии шейдеров)');
