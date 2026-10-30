// Живые разговоры с NPC (сами ответы пишет Claude в браузере игрока — capability `sample` на claude.ai).
// Сервер здесь — арбитр: хранит память разговоров и проверяет всё, что влияет на игру.
//  · Торг с агентом: прибавка к награде за задание не больше 5% + репутация/5 (до 15%), один раз на задание.
//  · Выкуп у пирата: цена не ниже минимальной (60% награды за его голову), пират уходит в прыжок.
// Так никакие слова в чате не заставят пирата отпустить за 1 CR или агента — удвоить плату.
'use strict';
const { NPCS, incomeOf } = require('./data');
const story = require('./story');

const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const MEM = { turns: 10, chars: 500, keys: 40 };

module.exports = function install(Game) {
  const P = Game.prototype;

  // память: последние реплики каждого собеседника (ключ — «agent:<станция>», «leader:<фракция>», «pirate:<имя>»)
  P.c_npcMem = function (s, m, p) {
    const key = String(m.key || '').slice(0, 80);
    if (!key) return;
    const mem = p.npcMem || (p.npcMem = {});
    if (Array.isArray(m.turns)) {
      mem[key] = m.turns.filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
        .slice(-MEM.turns).map(t => ({ role: t.role, content: t.content.slice(0, MEM.chars) }));
      const keys = Object.keys(mem);
      if (keys.length > MEM.keys) for (const k of keys.slice(0, keys.length - MEM.keys)) delete mem[k];
      this.save();
      return;
    }
    s.send({ t: 'npcMem', key, turns: mem[key] || [], agentDeals: p.npcDeals || 0 });
  };

  P.bargainCap = function (p, stationId) {
    this.storyOf(p);
    const fac = story.factionOfSys(this.U.celestials[stationId].sys);
    return Math.max(0, Math.min(15, 5 + Math.floor((p.rep[fac] || 0) / 5)));
  };
  P.c_npcBargain = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const b = this.missionBoard(st), o = b.offers.find(x => x.id === m.id);
    if (!o) return this.notify(s, 'Этого задания уже нет', 'warn');
    if (o.bargained) return this.notify(s, 'Об этом задании уже договорились', 'warn');
    const cap = this.bargainCap(p, st), pct = Math.max(0, Math.min(cap, Math.round(+m.pct || 0)));
    o.bargained = true;
    if (!pct) { this.notify(s, 'Агент не уступил — награда прежняя', 'info'); return this.c_agents(s, m, p); }
    const before = o.reward;
    o.reward = Math.round(o.reward * (1 + pct / 100));
    p.npcDeals = (p.npcDeals || 0) + 1;
    this.notify(s, `Договорились: награда за «${o.title}» +${pct}% (${fmt(before)} → ${fmt(o.reward)} CR)`, 'good');
    this.c_agents(s, m, p);
  };

  // пират, с которым можно договориться: обычный NPC-пират рядом, не база, не босс, не сюжетный
  P.ransomTarget = function (s, id) {
    const e = s.ent, t = this.ents.get(id);
    if (!e || !t || t.type !== 'ship' || !t.npc || !NPCS[t.npc]) return null;
    if (t.pbase || t.wboss || t.storySite || t.fortress || t.relicGuard || t.guardian) return null;
    if (t.sys !== e.sys || dist(t.pos, e.pos) > 150000) return null;
    return t;
  };
  P.ransomFloor = function (t) { return Math.max(5000, Math.round(NPCS[t.npc].bounty * 0.6 * incomeOf(t.sys))); };
  P.c_ransomInfo = function (s, m, p) {
    const t = this.ransomTarget(s, m.id);
    if (!t) return s.send({ t: 'ransomInfo', id: m.id, ok: false, why: 'С этим кораблём не договориться — он слишком далеко или это не обычный пират' });
    s.send({ t: 'ransomInfo', id: t.id, ok: true, name: t.name, kind: NPCS[t.npc].name, floor: this.ransomFloor(t), bounty: Math.round(NPCS[t.npc].bounty * incomeOf(t.sys)),
      hostile: t.npcTarget === s.ent.id, hp: +((t.shield + t.armor + t.hull) / (t.stats.shield + t.stats.armor + t.stats.hull)).toFixed(2) });
  };
  P.c_ransom = function (s, m, p) {
    const t = this.ransomTarget(s, m.id);
    if (!t) return this.notify(s, 'Пират уже не на связи', 'warn');
    const price = Math.round(+m.price || 0), floor = this.ransomFloor(t);
    if (price < floor) return this.notify(s, `${t.name}: «Мало. Не меньше ${fmt(floor)} CR — или прощайся с кораблём.»`, 'bad');
    if (p.credits < price) return this.notify(s, 'Недостаточно CR', 'warn');
    p.credits -= price;
    // пират и его группа уходят в прыжок
    const group = this.groupKey(t);
    const leaving = [...this.ents.values()].filter(x => x === t || (group && x.npc && this.groupKey(x) === group && x.sys === t.sys && dist(x.pos, t.pos) < 60000 && this.ransomTarget(s, x.id)));
    for (const x of leaving) {
      this.fxSys(x.sys, x.pos, { k: 'jump', pos: x.pos });
      if (x.belt && this.beltState[x.belt]) this.beltState[x.belt].npcs.delete(x.id);
      this.removeEntity(x);
    }
    this.broadcastSys(t.sys, { t: 'chat', ch: 'local', from: t.name, text: 'Деньги получены. Живи пока — и не попадайся мне снова.' });
    this.notify(s, `Выкуп ${fmt(price)} CR уплачен — пираты ушли в прыжок (${leaving.length})`, 'info');
    p.stats.ransoms = (p.stats.ransoms || 0) + 1;
    this.sendProfile(s); this.save();
  };
};
module.exports.MEM = MEM;
