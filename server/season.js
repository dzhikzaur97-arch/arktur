// Сезоны: каждый календарный месяц — новый сезон со своими очками и наградами.
// Очки идут за всё, что пилот делает в игре: пиратов, добычу, торговлю, производство, фронт, боссов.
// Четыре порога (Бронза, Серебро, Золото, Легенда) — награду за каждый порог забирают в окне «Карьера».
// В таблице сезона — лучшие пилоты месяца.
'use strict';
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const SEASON = {
  w: { npcKills: 3, mined: 0.01, tradeEarned: 1 / 20000, built: 2, medals: 5, wevents: 50, archon: 200, wingKills: 1, refined: 0.002, shipChains: 40 },
  tiers: [
    { id: 'bronze', name: 'Бронза', pts: 100, cr: 2000000, items: {} },
    { id: 'silver', name: 'Серебро', pts: 400, cr: 6000000, items: { comp_core: 4, comp_chip: 4 } },
    { id: 'gold', name: 'Золото', pts: 1000, cr: 15000000, items: { mat_xcore: 20 }, rare: 1 },
    { id: 'legend', name: 'Легенда', pts: 2500, cr: 40000000, items: { ev_core: 2 }, rare: 2, title: true }
  ]
};
const seasonId = (t) => { const d = new Date(t); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const seasonName = (id) => { const [y, m] = id.split('-'); return `Сезон «${MONTHS[+m - 1]} ${y}»`; };

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick;

  const ss = (g, p) => {
    const id = seasonId(g.now);
    if (!p.season || p.season.id !== id) {
      // прошлый сезон — в историю
      if (p.season && p.season.pts > 0) { p.seasonHist = (p.seasonHist || []).concat([{ id: p.season.id, pts: Math.round(p.season.pts) }]).slice(-12); }
      p.season = { id, pts: 0, claimed: [], last: { ...Object.fromEntries(Object.keys(SEASON.w).map(k => [k, (p.stats && p.stats[k]) || 0])) } };
    }
    return p.season;
  };
  const accrue = (g, p) => {
    const S = ss(g, p);
    for (const [k, w] of Object.entries(SEASON.w)) {
      const v = (p.stats && p.stats[k]) || 0, d = v - (S.last[k] || 0);
      if (d > 0) S.pts += d * w;
      S.last[k] = v;
    }
  };
  P.seasonView = function (p) {
    accrue(this, p);
    const S = p.season, end = new Date(this.now); end.setUTCMonth(end.getUTCMonth() + 1, 1); end.setUTCHours(0, 0, 0, 0);
    const top = Object.values(this.db.players).filter(x => x.season && x.season.id === S.id && x.season.pts >= 1).sort((a, b) => b.season.pts - a.season.pts).slice(0, 10).map(x => ({ name: x.name, pts: Math.round(x.season.pts) }));
    return { t: 'season', id: S.id, name: seasonName(S.id), pts: Math.round(S.pts), left: end.getTime() - this.now, tiers: SEASON.tiers.map(t => ({ ...t, got: S.claimed.includes(t.id) })), top, w: SEASON.w, hist: p.seasonHist || [] };
  };
  P.c_seasonInfo = function (s, m, p) { s.send(this.seasonView(p)); };
  P.c_seasonClaim = function (s, m, p) {
    accrue(this, p);
    const S = p.season, T = SEASON.tiers.find(t => t.id === m.id);
    if (!T || S.claimed.includes(T.id)) return;
    if (S.pts < T.pts) return this.notify(s, `Нужно ${T.pts} очков сезона (сейчас ${Math.floor(S.pts)})`, 'warn');
    S.claimed.push(T.id);
    p.credits += T.cr;
    const h = this.hangar(p, p.home).items;
    for (const [it, q] of Object.entries(T.items)) h[it] = (h[it] || 0) + q;
    for (let i = 0; i < (T.rare || 0); i++) { const bp = this.rareBlueprint && this.rareBlueprint(); if (bp) h[bp] = (h[bp] || 0) + 1; }
    if (T.title) { p.stats.seasonLegend = (p.stats.seasonLegend || 0) + 1; }
    this.notify(s, `🏅 ${seasonName(S.id)}: награда «${T.name}» — ${fmt(T.cr)} CR${Object.keys(T.items).length || T.rare ? ', предметы — в ангаре домашней станции' : ''}`, 'good');
    this.sendProfile(s); s.send(this.seasonView(p)); this.save();
  };
  P.slowTick = function () {
    const r = baseSlow.apply(this, arguments);
    if (!this._seaAt || this.now - this._seaAt > 10000) { this._seaAt = this.now; for (const s of this.sessions) if (s.player && !s.isBot) accrue(this, s.player); }
    return r;
  };
};
module.exports.SEASON = SEASON;
