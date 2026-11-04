// Живой сектор: заклятые враги, хроника пилота и почёт в системах.
// Заклятый враг — пират с именем и памятью. Он появляется, когда сбивает пилота (или мстит за убитого «брата»),
// растёт в силе каждые 30 минут, сам устраивает засады в опасных системах, пишет в локальный чат,
// а пилот может вызвать его на бой с Доски сектора. За победу — крупная награда, трофей и запись в хронике.
// Почёт: пилот, который чистит систему от пиратов, получает скидку на покупки на её станциях.
'use strict';
const { SHIPS, NPCS } = require('./data');

const NEM = { max: 3, growMs: 30 * 60000, maxLv: 10, revenge: 0.1, ambushGap: 8 * 60000, ambushChance: 0.35, leaveMs: 150000 };
const FIRST = ['Кривой', 'Бешеный', 'Тихий', 'Ржавый', 'Чёрный', 'Хромой', 'Весёлый', 'Седой', 'Рыжий', 'Немой', 'Злой', 'Старый', 'Косой', 'Лысый'];
const LAST = ['Ворон', 'Шакал', 'Кнут', 'Гвоздь', 'Барон', 'Клык', 'Сыч', 'Бес', 'Мясник', 'Шрам', 'Лис', 'Удав', 'Шип', 'Крот'];
const TITLES = ['Мелкий налётчик', 'Налётчик', 'Головорез', 'Атаман', 'Гроза трасс', 'Вожак стаи', 'Пиратский барон', 'Тиран поясов', 'Король Скверны', 'Бич сектора'];
const TAUNT = {
  born: ['Я запомнил твой корабль, {p}. Ещё встретимся.', 'Ты убил моего брата, {p}. Теперь я приду за тобой.', 'Хорошо горишь, {p}. Прилетай ещё.'],
  ambush: ['Попался, {p}! Думал, я забыл?', 'Вот ты где, {p}. Давно тебя ищу.', '{p}, у меня для тебя подарок — полный залп.', 'Скучал, {p}? Я — да.'],
  win: ['Опять ты, {p}? Опять сгоришь.', 'Слабо, {p}. Я стал только сильнее.', 'Передавай привет страховщикам, {p}.'],
  flee: ['Сбежал, {p}? Ничего, я терпеливый.', 'Беги, {p}, беги. Я найду тебя.'],
  lose: ['Не может быть… Ты… победил…', 'Это ещё не конец, {p}… кха…']
};
const HONOR = { lv: [10, 40, 120], disc: [0.03, 0.06, 0.1], names: ['Знакомый', 'Уважаемый', 'Защитник системы'] };
const PIRATES = new Set(['raider', 'reaper', 'hunter', 'dreadlord', 'outlaw']);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const say = (t, p) => pick(TAUNT[t]).replace('{p}', p.name);
const npcOfLv = (lv) => lv <= 3 ? 'raider' : lv <= 6 ? 'reaper' : lv <= 8 ? 'hunter' : 'dreadlord';
const bountyOf = (n) => Math.round(80000 * Math.pow(n.lv, 1.5));
const honorLv = (pts) => HONOR.lv.filter(x => pts >= x).length;

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseDestroy = P.destroyShip, baseSlow = P.slowTick, baseBuy = P.c_buy, baseRemove = P.removeEntity;

  // ---------- хроника ----------
  P.chron = function (p, text) {
    if (!p) return;
    p.chronicle = p.chronicle || [];
    p.chronicle.unshift({ t: this.now, text });
    if (p.chronicle.length > 40) p.chronicle.length = 40;
  };
  const sessOf = (g, p) => { for (const s of g.sessions) if (s.player === p) return s; return null; };

  // ---------- заклятые враги ----------
  P.nemesisNew = function (p, from, why) {
    p.nemeses = p.nemeses || [];
    if (p.nemeses.length >= NEM.max) return null;
    const n = { id: 'nm_' + uid(), name: `${pick(FIRST)} ${pick(LAST)}`, lv: 1, born: this.now, grew: this.now, why, wins: 0,
      sys: from && from.sys || this.playerSys(p), nextAmbush: this.now + NEM.ambushGap, ent: null };
    p.nemeses.push(n);
    const s = sessOf(this, p);
    if (s) {
      s.send({ t: 'chat', ch: 'local', from: `☠ ${n.name}`, text: (why === 'revenge' ? TAUNT.born[1] : pick([TAUNT.born[0], TAUNT.born[2]])).replace('{p}', p.name) });
      this.notify(s, `☠ У вас появился заклятый враг: ${n.name}. Он будет искать вас в опасных системах — или вызовите его сами с Доски сектора`, 'warn');
    }
    this.chron(p, `Нажил заклятого врага: ${n.name} (${why === 'revenge' ? 'мстит за брата' : 'сбил вас'})`);
    return n;
  };
  P.nemesisSpawn = function (p, n, e, dist) {
    const type = npcOfLv(n.lv), a = Math.random() * Math.PI * 2, d = dist || 22000;
    const pos = [e.pos[0] + Math.cos(a) * d, e.pos[1] + (Math.random() - 0.5) * 2000, e.pos[2] + Math.sin(a) * d];
    const t = this.spawnNpc(type, e.sys, pos, { name: `${TITLES[n.lv - 1]} ${n.name}` });
    const k = 1 + 0.3 * n.lv;
    for (const x of ['shield', 'armor', 'hull']) { t.stats[x] = Math.round(t.stats[x] * k); t[x] = t.stats[x]; }
    t.nemesis = { owner: p.name, id: n.id }; t.bountyMul = 2 + n.lv; t.npcTarget = e.id; t.home = pos;
    n.ent = t.id; n.sys = e.sys; n.spawnAt = this.now; n.awayAt = 0;
    const s = sessOf(this, p);
    if (s) { s.send({ t: 'chat', ch: 'local', from: `☠ ${n.name}`, text: say('ambush', p) }); this.notify(s, `☠ Засада! ${TITLES[n.lv - 1]} ${n.name} (ур. ${n.lv}) идёт на вас`, 'warn'); }
    return t;
  };
  P.c_nemesisCall = function (s, m, p) {
    const n = (p.nemeses || []).find(x => x.id === m.id), e = s.ent;
    if (!n) return;
    if (!e || s.docked || e.warp) return this.notify(s, 'Вызвать врага на бой можно только в космосе, не в варпе', 'warn');
    if (n.ent && this.ents.get(n.ent)) return this.notify(s, `${n.name} уже рядом`, 'warn');
    s.send({ t: 'chat', ch: 'local', from: `☠ ${n.name}`, text: `Вызываешь меня, ${p.name}? Лечу.` });
    n.callAt = this.now + 12000;
  };
  P.nemesesView = function (p) {
    return (p.nemeses || []).map(n => ({ id: n.id, name: n.name, title: TITLES[n.lv - 1], lv: n.lv, why: n.why, wins: n.wins, sys: n.sys,
      sysName: (this.U.byId[n.sys] || {}).name || '', bounty: bountyOf(n), near: !!(n.ent && this.ents.get(n.ent)), ship: SHIPS[NPCS[npcOfLv(n.lv)].ship].name }));
  };

  P.destroyShip = function (t, killer) {
    const killerEnt = killer && this.ents.get(killer.id);
    const killerName = killerEnt && killerEnt.owner;
    // враг повержен
    if (t.nemesis) {
      const owner = this.db.players[t.nemesis.owner], n = owner && (owner.nemeses || []).find(x => x.id === t.nemesis.id);
      const r = baseDestroy.call(this, t, killer);
      if (n) {
        const winner = killerName ? this.db.players[killerName] : null;
        owner.nemeses = owner.nemeses.filter(x => x !== n);
        const prize = bountyOf(n);
        const who = winner || owner;
        if (winner) { winner.credits += prize; winner.stats.nemesisKills = (winner.stats.nemesisKills || 0) + 1; this.honorAdd(winner, t.sys, 15); }
        const ws = winner && sessOf(this, winner);
        if (ws) {
          ws.send({ t: 'chat', ch: 'local', from: `☠ ${n.name}`, text: say('lose', winner) });
          this.notify(ws, `🏆 Заклятый враг ${n.name} повержен! Награда ${fmt(prize)} CR и трофей в обломках`, 'good');
          this.sendProfile(ws);
        }
        const items = { salv_core: 1 + Math.floor(n.lv / 2) };
        if (n.lv >= 6 && this.rareBlueprint) { const bp = this.rareBlueprint(); if (bp) items[bp] = 1; }
        const wid = 'wr_' + uid(); this.ents.set(wid, { id: wid, type: 'wreck', sys: t.sys, pos: t.pos.slice(), vel: [0, 0, 0], radius: 120, name: `Трофей: ${n.name}`, items, expires: this.now + 30 * 60000 });
        this.chron(who, `Победил заклятого врага ${n.name} (ур. ${n.lv})`);
        if (n.lv >= 5) for (const x of this.sessions) x.send({ t: 'chat', ch: 'global', from: 'Новости галактики', text: `${who.name} покончил с пиратом «${n.name}» (${TITLES[n.lv - 1]})` });
        this.save();
      }
      return r;
    }
    const victim = !t.npc && t.owner && this.db.players[t.owner];
    const npcKiller = killerEnt && killerEnt.npc;
    const r = baseDestroy.call(this, t, killer);
    // пилота сбил пират: он становится заклятым врагом (или тот, кто уже враг, растёт)
    if (victim && npcKiller && !victim.bot) {
      if (killerEnt.nemesis && killerEnt.nemesis.owner === victim.name) {
        const n = (victim.nemeses || []).find(x => x.id === killerEnt.nemesis.id);
        if (n) { n.wins++; n.lv = Math.min(NEM.maxLv, n.lv + 1); n.nextAmbush = this.now + NEM.ambushGap * 2; const s = sessOf(this, victim); if (s) s.send({ t: 'chat', ch: 'local', from: `☠ ${n.name}`, text: say('win', victim) }); this.chron(victim, `Сбит заклятым врагом ${n.name} — он стал сильнее (ур. ${n.lv})`); }
      } else if (PIRATES.has(killerEnt.npc) && !killerEnt.pbase && !killerEnt.wboss) this.nemesisNew(victim, killerEnt, 'killed');
    }
    // пилот сбил пирата: почёт системы и иногда — «брат», который придёт мстить
    if (t.npc && killerName && PIRATES.has(t.npc)) {
      const kp = this.db.players[killerName];
      if (kp && !kp.bot) {
        this.honorAdd(kp, t.sys, t.pbase ? 25 : 1);
        if (!t.pbase && Math.random() < NEM.revenge && (kp.nemeses || []).length < NEM.max && this.U.byId[t.sys].sec < 0.7) this.nemesisNew(kp, t, 'revenge');
        if (t.pbase) this.chron(kp, `Уничтожил пиратскую базу в системе ${this.U.byId[t.sys].name}`);
      }
    }
    return r;
  };

  // засады, рост, уход врага, когда пилот улетел
  P.nemesisTick = function () {
    for (const s of this.sessions) {
      const p = s.player; if (!p || s.isBot || !p.nemeses || !p.nemeses.length) continue;
      const e = s.ent;
      for (const n of p.nemeses) {
        if (this.now - n.grew > NEM.growMs && n.lv < NEM.maxLv) {
          n.grew = this.now; n.lv++;
          this.notify(s, `☠ Ваш враг ${n.name} окреп: теперь он ${TITLES[n.lv - 1]} (ур. ${n.lv}). Награда за него — ${fmt(bountyOf(n))} CR`, 'warn');
        }
        const live = n.ent && this.ents.get(n.ent);
        if (n.ent && !live) n.ent = null;
        if (live) {
          if (!e || s.docked || e.sys !== live.sys) {
            n.awayAt = n.awayAt || this.now;
            if (this.now - n.awayAt > NEM.leaveMs) { baseRemove.call(this, live); n.ent = null; n.nextAmbush = this.now + NEM.ambushGap; s.send({ t: 'chat', ch: 'local', from: `☠ ${n.name}`, text: say('flee', p) }); }
          } else { n.awayAt = 0; if (!live.npcTarget) live.npcTarget = e.id; }
          continue;
        }
        if (!e || s.docked || e.warp) continue;
        if (n.callAt && this.now >= n.callAt) { n.callAt = 0; this.nemesisSpawn(p, n, e, 18000); continue; }
        const sec = this.U.byId[e.sys].sec;
        if (sec < 0.75 && this.now > n.nextAmbush) {
          n.nextAmbush = this.now + NEM.ambushGap;
          if (Math.random() < NEM.ambushChance + (sec < 0.3 ? 0.3 : 0)) this.nemesisSpawn(p, n, e);
        }
      }
    }
  };

  // ---------- почёт ----------
  P.honorAdd = function (p, sys, v) {
    p.honor = p.honor || {};
    const was = honorLv(p.honor[sys] || 0);
    p.honor[sys] = (p.honor[sys] || 0) + v;
    const now = honorLv(p.honor[sys]);
    if (now > was) {
      const s = sessOf(this, p), name = (this.U.byId[sys] || {}).name;
      if (s) this.notify(s, `🤝 Почёт в системе ${name}: «${HONOR.names[now - 1]}». Станции системы дают скидку ${Math.round(HONOR.disc[now - 1] * 100)}% на покупки`, 'good');
      this.chron(p, `Стал «${HONOR.names[now - 1]}» в системе ${name}`);
    }
  };
  P.honorDisc = function (p, stationId) {
    const c = this.U.celestials[stationId]; if (!c || !p.honor) return 0;
    const lv = honorLv(p.honor[c.sys] || 0);
    return lv ? HONOR.disc[lv - 1] : 0;
  };
  P.honorView = function (p, sysId) { const pts = (p.honor && p.honor[sysId]) || 0, lv = honorLv(pts); return { pts, lv, name: lv ? HONOR.names[lv - 1] : null, disc: lv ? HONOR.disc[lv - 1] : 0, next: HONOR.lv[lv] || null }; };
  if (baseBuy) P.c_buy = function (s, m, p) {
    const c0 = p.credits;
    const r = baseBuy.apply(this, arguments);
    const spent = c0 - p.credits, disc = s.docked ? this.honorDisc(p, s.docked) : 0;
    if (spent > 0 && disc > 0) { const back = Math.round(spent * disc); p.credits += back; this.notify(s, `🤝 Скидка почёта: −${fmt(back)} CR`, 'good'); this.sendProfile(s); }
    return r;
  };

  P.slowTick = function () {
    const r = baseSlow ? baseSlow.apply(this, arguments) : undefined;
    if (!this._nemAt || this.now - this._nemAt > 3000) { this._nemAt = this.now; this.nemesisTick(); }
    return r;
  };
  P.c_chronicle = function (s, m, p) { s.send({ t: 'chronicle', list: p.chronicle || [] }); };
};
module.exports.NEM = NEM;
module.exports.bountyOf = bountyOf;
