// «Сон» пустых систем: сервер одиночной игры работает прямо во вкладке телефона, и каждый лишний пират —
// это расчёты ИИ и физики каждые 0,1 с. В системах, где больше 3 минут нет ни одного пилота в космосе,
// убираются временные NPC: пираты поясов (появятся снова, когда пилот прилетит), эскорт ИИ-пиратов,
// преступники. Пиратские базы, крепости, аномалии, сюжетные точки и мировые события не трогаются.
'use strict';

const SLEEP_AFTER = 3 * 60000, CHECK_EVERY = 10000;

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick;

  P.sleepTick = function () {
    if (this._sleepAt && this.now - this._sleepAt < CHECK_EVERY) return;
    this._sleepAt = this.now;
    const awake = new Set();
    for (const s of this.sessions) {
      if (s.ent) awake.add(s.ent.sys);
      else if (s.surf) awake.add(s.surf.sys);
    }
    const since = this._sysEmpty || (this._sysEmpty = {});
    for (const id of Object.keys(this.U.systems)) {
      if (awake.has(id)) delete since[id];
      else if (!since[id]) since[id] = this.now;
    }
    let removed = 0;
    for (const e of [...this.ents.values()]) {
      if (!e.npc || awake.has(e.sys) || !since[e.sys] || this.now - since[e.sys] < SLEEP_AFTER) continue;
      if (e.pbase || e.fortress || e.anom || e.storySite || e.wboss || e.guardian || e.relicGuard) continue;
      if (this.wev && this.wev.escort && this.wev.escort.has(e.id)) continue;
      if (!(e.belt || e.fleet || e.outlaw || e.npc === 'outlaw')) continue;
      if (e.belt && this.beltState[e.belt]) this.beltState[e.belt].npcs.delete(e.id); // пояс заселится заново при следующем визите
      this.removeEntity(e);
      removed++;
    }
    this.sleptTotal = (this.sleptTotal || 0) + removed;
  };

  P.slowTick = function () {
    baseSlow.call(this);
    this.sleepTick();
  };
};
module.exports.SLEEP_AFTER = SLEEP_AFTER;
