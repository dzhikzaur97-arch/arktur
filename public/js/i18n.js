// Язык игры. Русский — исходный; английский подменяет текст на экране по словарю window.VF_EN (public/js/i18n-en.js):
//  · целые строки — точное совпадение; составные (с числами и именами) — по кускам с границами слов;
//  · единицы после чисел (м, км, с, ч, мин…) — отдельным правилом;
//  · оставшиеся русские слова (имена видов, позывные) — транслитерацией.
// Перевод применяется к тексту и подсказкам страницы (MutationObserver) и к надписям на canvas (карта, бортовые номера).
// Выбор языка: настройка «Язык» (localStorage vf-lang); по умолчанию в публичной версии — по языку браузера.
(function () {
  'use strict';
  const pick = () => {
    try { const s = localStorage.getItem('vf-lang'); if (s === 'ru' || s === 'en') return s; } catch {}
    if (window.VF_EDITION === 'public' && !/^(ru|uk|be|kk)/i.test(navigator.language || '')) return 'en';
    return 'ru';
  };
  const LANG = window.VF_LANG = pick();
  window.VF_SET_LANG = (l) => { try { localStorage.setItem('vf-lang', l); } catch {} location.reload(); };
  if (LANG !== 'en' || !window.VF_EN) { window.T = (s) => s; return; }
  document.documentElement.lang = 'en';

  const D = window.VF_EN, CY = /[А-Яа-яЁё]/, L = 'А-Яа-яЁё';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // куски для замены внутри строки: от длинных к коротким, не короче двух букв
  // куски для замены внутри строки — от длинных к коротким (один проход), не короче трёх букв (короткие — только имена с заглавной);
  // граница слова проверяется с той стороны, где кусок начинается или кончается буквой
  const isL = (c) => !!c && /[А-Яа-яЁё]/.test(c);
  const frags = Object.keys(D).filter(k => { const n = (k.match(/[А-Яа-яЁё]/g) || []).length; return n >= 3 || (n === 2 && /^[А-ЯЁ]/.test(k)); }).sort((a, b) => b.length - a.length);
  const FR = new RegExp(`(${frags.map(esc).join('|')})`, 'g');
  const fragReplace = (str) => str.replace(FR, (m, k, off) => (isL(k[0]) && isL(str[off - 1])) || (isL(k[k.length - 1]) && isL(str[off + k.length])) ? m : D[k]);
  // служебные слова и слова в другом регистре
  const SMALL = { и: 'and', в: 'in', во: 'in', на: 'on', с: 'with', со: 'with', за: 'for', из: 'from', по: 'by', к: 'to', от: 'from', у: 'at', о: 'about', об: 'about', не: 'not', до: 'to', или: 'or', но: 'but', же: '', ли: '', уже: 'already', ещё: 'more', там: 'there', здесь: 'here', всё: 'all', все: 'all',
    ур: 'lv', ед: 'u', шт: 'pcs', мин: 'min', км: 'km', сек: 's', макс: 'max', сред: 'mid', верх: 'high', ниж: 'low' };
  const word = (w) => { const lo = w.toLowerCase(), cap = lo.charAt(0).toUpperCase() + lo.slice(1);
    const t = D[w] ?? D[lo] ?? D[cap] ?? SMALL[lo];
    if (t === undefined) return translit(w);
    return w[0] !== lo[0] && t ? t.charAt(0).toUpperCase() + t.slice(1) : (D[w] === undefined && t ? t.charAt(0).toLowerCase() + t.slice(1) : t); };
  const UNIT = new RegExp(`(\\d)(\\s?)(м³|м\\/с|а\\.е\\.\\/с|а\\.е\\.|км|мин|ед\\.|шт\\.|м|с|ч)(?![${L}])`, 'g');
  const UNITS = { 'м³': 'm³', 'м/с': 'm/s', 'а.е./с': 'AU/s', 'а.е.': 'AU', 'км': 'km', 'мин': 'min', 'ед.': 'u.', 'шт.': 'pcs', 'м': 'm', 'с': 's', 'ч': 'h' };
  const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  const translit = (w) => w.replace(/[А-Яа-яЁё]/g, (c) => { const l = c.toLowerCase(), t = TR[l] ?? c; return c === l ? t : t.charAt(0).toUpperCase() + t.slice(1); });
  const pass = (x) => { const c = x.trim(); return (D[c] !== undefined ? x.replace(c, () => D[c]) : fragReplace(x)).replace(UNIT, (m, d, sp, u) => d + sp + UNITS[u]); };
  const cache = new Map();
  function T(s) {
    if (typeof s !== 'string' || !CY.test(s)) return s;
    const hit = cache.get(s); if (hit !== undefined) return hit;
    let out;
    const core = s.trim();
    if (D[core] !== undefined) out = s.replace(core, () => D[core]);
    else if (/[А-ЯЁ]{2}/.test(s) && s === s.toUpperCase()) {
      // надписи заглавными (подписи регионов на карте): переводим в обычном регистре и снова поднимаем
      const sc = s.toLowerCase().replace(/[а-яё]/, (c) => c.toUpperCase());
      const tc = s.toLowerCase().replace(/(^|[^а-яё])([а-яё])/g, (m, a, c) => a + c.toUpperCase());
      const left = (x) => (x.match(/[А-Яа-яЁё]/g) || []).length;
      const a1 = pass(sc), a2 = pass(tc);
      out = (left(a2) < left(a1) ? a2 : a1).replace(/[А-Яа-яЁё]+/g, word).toUpperCase();
    } else {
      out = pass(s);
      if (CY.test(out)) out = out.replace(/[А-Яа-яЁё]+/g, word);
    }
    if (cache.size > 6000) cache.clear();
    cache.set(s, out);
    return out;
  }
  window.T = T;

  // ---------- страница ----------
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1 };
  const keep = (n) => { const p = n.parentElement; return !p || SKIP[p.tagName] || p.closest('[data-notr]'); };
  const fixText = (n) => { const v = n.nodeValue; if (v && CY.test(v) && !keep(n)) { const t = T(v); if (t !== v) n.nodeValue = t; } };
  const fixEl = (el) => { for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v && CY.test(v)) el.setAttribute(a, T(v)); } };
  const walk = (root) => {
    if (root.nodeType === 3) return fixText(root);
    if (root.nodeType !== 1 || root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return;
    fixEl(root);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = it.nextNode(); n; n = it.nextNode()) {
      if (n.nodeType === 3) fixText(n);
      else fixEl(n);
    }
  };
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') fixText(m.target);
      else if (m.type === 'attributes') fixEl(m.target);
      else for (const n of m.addedNodes) walk(n);
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const first = () => walk(document.documentElement);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', first); else first();
  // ---------- canvas: карта, подписи, бортовые номера ----------
  const C2 = CanvasRenderingContext2D.prototype;
  for (const f of ['fillText', 'strokeText', 'measureText']) {
    const orig = C2[f];
    C2[f] = function (text, ...rest) { return orig.call(this, typeof text === 'string' ? T(text) : text, ...rest); };
  }
  // всплывающие окна браузера
  for (const f of ['alert', 'confirm', 'prompt']) { const o = window[f]; if (o) window[f] = (msg, ...r) => o.call(window, T(String(msg)), ...r); }
})();
