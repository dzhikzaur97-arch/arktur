// Управление большим звеном напарников: построения и группы.
//
// Построения (когда звено следует за вами и не занято боем или добычей):
//   «Карусель» — как раньше, кружат вокруг; «Клин» — ступенями позади по бокам; «Стена» — шеренгой рядом с вами;
//   «Охрана» — плотное кольцо в 1,5 км.
// Группы: каждый напарник в группе 1, 2 или 3 (по умолчанию бойцы — 1, шахтёры — 2, ремонтники — 3).
// Приказ можно дать всем сразу или только одной группе: например, бойцы атакуют, шахтёры копают, ремонтники держатся рядом.
'use strict';
const FORMS = { orbit: 'Карусель', wedge: 'Клин', wall: 'Стена', guard: 'Охрана' };
const DEF_GRP = { combat: 1, miner: 2, medic: 3 };
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseTick = P.wingShipTick, baseOrder = P.c_wingOrder, baseInfo = P.c_wingInfo, baseView = P.wingView;
  const grpOf = (w) => w.grp || DEF_GRP[w.role] || 1;

  P.wingView = function (p) {
    const v = baseView.apply(this, arguments);
    for (const x of v) { const w = (p.wing || []).find(y => y.id === x.id); if (w) x.grp = grpOf(w); }
    return v;
  };
  P.c_wingInfo = function (s, m, p) {
    const r = baseInfo.apply(this, arguments);
    s.send({ t: 'wingx', form: p.wingForm || 'orbit', forms: FORMS, orders: p.wingOrders || {} });
    return r;
  };
  P.c_wingOrder = function (s, m, p) {
    const g = +m.grp;
    if (g >= 1 && g <= 3) {
      const prev = p.wingOrder;
      const r = baseOrder.apply(this, arguments); // проверит приказ, точку и цель
      const now = p.wingOrder;
      p.wingOrder = prev || 'follow';
      p.wingOrders = p.wingOrders || {}; p.wingOrders[g] = now;
      s.send({ t: 'wingx', form: p.wingForm || 'orbit', forms: FORMS, orders: p.wingOrders });
      return r;
    }
    p.wingOrders = {}; // приказ всем — сбрасывает приказы групп
    return baseOrder.apply(this, arguments);
  };
  P.c_wingForm = function (s, m, p) {
    if (!FORMS[m.form]) return;
    p.wingForm = m.form;
    for (const w of p.wing || []) { const e = w.ent && this.ents.get(w.ent); if (e) e.nextThink = 0; }
    this.notify(s, `Звено: построение «${FORMS[m.form]}»`, 'info');
    s.send({ t: 'wingx', form: p.wingForm, forms: FORMS, orders: p.wingOrders || {} });
  };
  P.c_wingGrp = function (s, m, p) {
    const w = (p.wing || []).find(x => x.id === m.id); if (!w) return;
    const g = +m.grp; w.grp = g >= 1 && g <= 3 ? g : (grpOf(w) % 3) + 1;
    this.c_wingInfo(s, {}, p);
  };

  P.wingShipTick = function (e) {
    const p = this.db.players[e.wingOf], w = p && (p.wing || []).find(x => x.id === e.wingId);
    if (!p || !w) return baseTick.apply(this, arguments);
    const g = grpOf(w), go = p.wingOrders && p.wingOrders[g];
    const was = p.wingOrder;
    if (go) p.wingOrder = go;
    const think = this.now >= e.nextThink && !e.warp;
    const r = baseTick.apply(this, arguments);
    if (go) { if (p.wingOrder !== go) p.wingOrders[g] = p.wingOrder; p.wingOrder = was; } // базовый тик мог сбросить приказ (точка в другой системе)
    if (!think) return r;
    // построение вместо карусели
    const form = p.wingForm || 'orbit', s = [...this.sessions].find(x => x.player === p), oe = s && s.ent;
    if (form === 'orbit' || !oe || e.cmd.type !== 'orbit' || e.cmd.target !== oe.id) return r;
    const mates = (p.wing || []).filter(x => x.ent && this.ents.get(x.ent) && (p.wingOrders && p.wingOrders[grpOf(x)] || p.wingOrder || 'follow') === 'follow');
    const i = Math.max(0, mates.indexOf(w)), n = Math.max(1, mates.length);
    const sp = Math.hypot(...oe.vel);
    if (sp > 15) oe.headF = norm(oe.vel);
    const h = oe.headF || [0, 0, 1], up = [0, 1, 0];
    let rt = [h[1] * up[2] - h[2] * up[1], h[2] * up[0] - h[0] * up[2], h[0] * up[1] - h[1] * up[0]]; rt = norm(rt);
    let off;
    if (form === 'wedge') { const row = Math.floor(i / 2) + 1, sd = i % 2 ? 1 : -1; off = [-row * 1500, sd * row * 1200]; }
    else if (form === 'wall') off = [-500, (i - (n - 1) / 2) * 1400];
    else { const a = (i / n) * Math.PI * 2; off = [Math.cos(a) * 1500, Math.sin(a) * 1500]; }
    const slot = [0, 1, 2].map(k => oe.pos[k] + h[k] * off[0] + rt[k] * off[1]);
    const d3 = slot.map((v, k) => v - e.pos[k]), d = Math.hypot(...d3);
    const maxS = (e.stats && e.stats.maxSpeed) || 300;
    if (d < 300) { e.cmd = sp > 15 ? { type: 'dir', dir: h } : { type: 'stop' }; e.speedFrac = Math.min(1.2, sp / maxS); }
    else { e.cmd = { type: 'dir', dir: norm(d3) }; e.speedFrac = Math.min(1.6, Math.max(0.3, d / 3000 + sp / maxS)); }
    return r;
  };
};
module.exports.FORMS = FORMS;
