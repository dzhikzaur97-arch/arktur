// Метки (закладки): пилот ставит точку в космосе — там, где летит, или на карте системы —
// и потом варпает к ней на любую дистанцию. Метки хранятся у пилота, до 30 штук.
'use strict';
const MARKS = { max: 30, maxDist: 80 * 1.496e11 };
const uid = () => Math.random().toString(36).slice(2, 9);

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseFind = P.findTarget, baseLogin = P.login;

  P.marksSend = function (s) { s.send({ t: 'marks', list: (s.player.marks || []).filter(m => this.U.systems[m.sys]) }); };
  P.c_marks = function (s) { this.marksSend(s); };
  P.c_markAdd = function (s, m, p, e) {
    const sys = e ? e.sys : this.playerSys(p);
    if (!sys || !this.U.systems[sys]) return;
    p.marks = p.marks || [];
    if (p.marks.length >= MARKS.max) return this.notify(s, `Меток не больше ${MARKS.max} — удалите старые`, 'warn');
    let pos;
    if (Array.isArray(m.pos) && m.pos.length === 3 && m.pos.every(Number.isFinite)) {
      const sun = this.U.systems[sys].celestials[0].pos;
      if (Math.hypot(m.pos[0] - sun[0], m.pos[2] - sun[2]) > MARKS.maxDist) return this.notify(s, 'Слишком далеко от звезды', 'warn');
      pos = m.pos.map(v => Math.round(v));
    } else if (e && !e.warp) pos = e.pos.map(v => Math.round(v));
    else return this.notify(s, 'Метку можно поставить в космосе (не в варпе) или на карте системы', 'warn');
    const n = p.marks.filter(x => x.sys === sys).length + 1;
    const name = String(m.name || '').replace(/[<>]/g, '').trim().slice(0, 30) || `Метка ${n} · ${this.U.byId[sys].name}`;
    const mk = { id: 'mk_' + uid(), sys, name, pos };
    p.marks.push(mk);
    this.notify(s, `📍 Метка «${mk.name}» поставлена`, 'good');
    this.marksSend(s); this.save();
    if (m.warp !== undefined && e && !e.warp) this.c_warp(s, { id: mk.id, range: m.warp }, p, e);
  };
  P.c_markDel = function (s, m, p) {
    p.marks = (p.marks || []).filter(x => x.id !== m.id);
    this.marksSend(s); this.save();
  };
  // цель варпа по метке
  P.findTarget = function (e, id) {
    if (typeof id === 'string' && id.startsWith('mk_') && e && e.session) {
      const mk = (e.session.player.marks || []).find(x => x.id === id && x.sys === e.sys);
      return mk ? { id: mk.id, kind: 'mark', name: mk.name, pos: mk.pos, radius: 0, landing: 1, sys: mk.sys } : null;
    }
    return baseFind.call(this, e, id);
  };
  P.login = function (sess, name, pass) {
    const r = baseLogin.call(this, sess, name, pass);
    if (sess.player) this.marksSend(sess);
    return r;
  };
};
