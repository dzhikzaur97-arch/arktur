// Особые задания, которые сочиняет Claude (в браузере игрока, capability `sample`).
// Claude пишет сюжет, имена и диалоги и выбирает шаги из проверенного набора:
//   travel (прилететь в систему), site с act = reach | kill | hack | loot, dock (вернуться на станцию выдачи).
// Сервер проверяет всё: системы — в пределах 6 прыжков, враги — из списка, разрешённого для безопасности системы,
// длительность взлома 10–45 с, не больше 6 шагов; награду считает сам по шагам и доходу региона.
// Одновременно — одно особое задание. Тексты обрезаются, поэтому «сломать» игру через задание нельзя.
'use strict';
const crypto = require('crypto');
const { SYSTEMS, NPCS, ITEMS, incomeOf, AU } = require('./data');
const { route } = require('./universe');

const uid = () => crypto.randomBytes(6).toString('hex');
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const rnd = (a, b) => a + Math.random() * (b - a);
const str = (v, n) => String(v == null ? '' : v).replace(/[<>]/g, '').slice(0, n);

// враги по безопасности системы: что Claude может поставить на точку и сколько
const ENEMIES = (sec) => sec >= 0.5 ? { list: ['raider'], max: 3 } : sec > 0 ? { list: ['raider', 'reaper', 'hunter', 'corsair'], max: 4 } : { list: ['raider', 'reaper', 'hunter', 'corsair', 'warlord', 'shard'], max: 5 };
Object.assign(ITEMS, { q_cmcargo: { name: 'Особый груз', cat: 'Миссия', vol: 1, base: 0, quest: true } });

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseSlow = P.slowTick;

  // что Claude может использовать: системы рядом со станцией и враги для каждой
  P.c_cmOptions = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    const from = this.U.celestials[st].sys;
    const near = SYSTEMS.map(d => ({ id: d.id, name: d.name, sec: d.sec, r: route(this.U.neighbors, from, d.id) })).filter(x => x.r && x.r.length - 1 <= 6)
      .map(x => ({ id: x.id, name: x.name, sec: x.sec, jumps: x.r.length - 1, enemies: ENEMIES(x.sec).list, maxEnemies: ENEMIES(x.sec).max }));
    s.send({ t: 'cmOptions', station: st, stationName: this.U.celestials[st].name, sys: from, near, active: p.cmission ? this.cmView(p) : null });
  };

  // проверка и приём задания, которое написал Claude
  P.c_cmAccept = function (s, m, p) {
    const st = this.requireDocked(s); if (!st) return;
    if (p.cmission) return this.notify(s, 'Сначала завершите или отмените текущее особое задание', 'warn');
    const d = m.mission || {};
    const from = this.U.celestials[st].sys;
    const stages = [];
    let reward = 0, risk = 0;
    for (const raw of (Array.isArray(d.stages) ? d.stages : []).slice(0, 6)) {
      const def = SYSTEMS.find(x => x.id === raw.sys);
      if (raw.type === 'dock') continue; // возвращение добавляем сами
      if (!def) return this.notify(s, 'Задание отклонено: неизвестная система', 'warn');
      const r = route(this.U.neighbors, from, def.id);
      if (!r || r.length - 1 > 6) return this.notify(s, 'Задание отклонено: система слишком далеко', 'warn');
      const inc = incomeOf(def.id), jumps = r.length - 1;
      if (raw.type === 'travel') { stages.push({ type: 'travel', sys: def.id, text: str(raw.text, 120) || `Прыгните в систему ${def.name}` }); reward += 6000 * (1 + jumps) * inc; continue; }
      if (raw.type !== 'site') continue;
      const act = ['reach', 'kill', 'hack', 'loot'].includes(raw.act) ? raw.act : 'reach';
      const stg = { type: 'site', sys: def.id, site: str(raw.site, 40) || 'Точка задания', act, text: str(raw.text, 140) || 'Выполните задачу на точке' };
      if (act === 'kill') {
        const E = ENEMIES(def.sec);
        stg.enemies = (Array.isArray(raw.enemies) ? raw.enemies : []).filter(x => E.list.includes(x)).slice(0, E.max);
        if (!stg.enemies.length) stg.enemies = [E.list[0]];
        const b = stg.enemies.reduce((a, x) => a + NPCS[x].bounty, 0);
        reward += b * 0.8 * inc; risk += b;
      } else if (act === 'hack') { stg.secs = Math.max(10, Math.min(45, Math.round(+raw.secs || 20))); reward += 900 * stg.secs * inc; }
      else if (act === 'loot') reward += 25000 * inc;
      else reward += 12000 * inc;
      stages.push(stg);
    }
    if (!stages.length) return this.notify(s, 'Задание отклонено: в нём нет ни одного выполнимого шага', 'warn');
    stages.push({ type: 'dock', station: st, text: `Вернитесь на станцию «${this.U.celestials[st].name}»` });
    reward = Math.round(Math.min(900000, (reward + 15000) * 1.25) / 1000) * 1000;
    p.cmission = { id: uid(), title: str(d.title, 60) || 'Особое задание', giver: str(d.giver, 40) || 'Неизвестный заказчик', brief: (Array.isArray(d.brief) ? d.brief : [d.brief]).map(x => str(x, 300)).filter(Boolean).slice(0, 3),
      done: str(d.done, 300) || 'Дело сделано. Спасибо, пилот.', stages, i: 0, prog: 0, reward, from: st, started: this.now };
    this.notify(s, `✨ Особое задание «${p.cmission.title}» принято. Награда: ${fmt(reward)} CR`, 'good');
    this.cmBegin(s, p);
    this.c_cmOptions(s, m, p); this.save();
  };
  P.c_cmAbandon = function (s, m, p) {
    if (!p.cmission) return;
    this.cmClear(p); p.cmission = null;
    delete p.ship.cargo.q_cmcargo;
    this.notify(s, 'Особое задание отменено', 'info');
    if (s.docked) this.c_cmOptions(s, m, p); else s.send({ t: 'cmOptions', active: null });
    this.save();
  };

  P.cmView = function (p) {
    const c = p.cmission; if (!c) return null;
    const sg = c.stages[c.i] || {};
    let text = sg.text || '';
    if (sg.act === 'hack') text += ` — ${Math.min(100, Math.round(c.prog / sg.secs * 100))}%`;
    return { title: c.title, giver: c.giver, brief: c.brief, reward: c.reward, step: c.i + 1, steps: c.stages.length, text, sys: sg.sys || (sg.station && this.U.celestials[sg.station] ? this.U.celestials[sg.station].sys : null) };
  };
  P.cmSite = function (p) { return this.anoms ? [...this.anoms.values()].find(a => a.owner === p.name && a.kind === 'cmission') : null; };
  P.cmClear = function (p) {
    const a = this.cmSite(p); if (!a) return;
    this.anoms.delete(a.id);
    for (const e of [...this.ents.values()]) if (e.cmSite === a.id || e.storySite === a.id) this.removeEntity(e);
    for (const s of this.sessions) if (s.player === p) this.sendAnoms(s);
  };
  P.cmBegin = function (s, p) {
    const c = p.cmission, sg = c.stages[c.i];
    c.prog = 0;
    if (sg.type === 'site') {
      const a0 = this.cmSite(p);
      if (!a0 || a0.sys !== sg.sys || a0.name !== sg.site) {
        this.cmClear(p);
        if (!this.anoms) this.anoms = new Map();
        const ang = Math.random() * Math.PI * 2, r = (1.2 + Math.random() * 4) * AU;
        const a = { id: 'an_cm_' + uid(), sys: sg.sys, kind: 'cmission', owner: p.name, name: sg.site, radius: 0, landing: 8000,
          pos: [Math.cos(ang) * r, (Math.random() - 0.5) * 0.04 * r, Math.sin(ang) * r], sig: 1, created: this.now, expires: Infinity, triggered: true, npcs: new Set() };
        this.anoms.set(a.id, a);
        (p.known || (p.known = {}))[a.id] = true;
        this.sendAnoms(s);
      }
    }
    this.notify(s, `✨ ${c.title}: ${sg.text}`, 'info');
    s.send({ t: 'cmProgress', active: this.cmView(p) });
  };
  P.cmAdvance = function (s, p) {
    const c = p.cmission;
    c.i++;
    if (c.i >= c.stages.length) {
      p.credits += c.reward;
      p.stats.cmissions = (p.stats.cmissions || 0) + 1;
      this.cmClear(p); p.cmission = null;
      delete p.ship.cargo.q_cmcargo;
      this.notify(s, `✨ Особое задание выполнено! Награда: ${fmt(c.reward)} CR`, 'good');
      s.send({ t: 'dialog', kind: 'info', title: `Задание выполнено: ${c.title}`, from: c.giver, lines: [c.done], reward: `${fmt(c.reward)} CR` });
      s.send({ t: 'cmProgress', active: null });
      this.sendProfile(s); this.save();
      return;
    }
    this.cmBegin(s, p); this.save();
  };

  P.cmTick = function () {
    for (const s of this.sessions) {
      const p = s.player, c = p && p.cmission;
      if (!c) continue;
      const sg = c.stages[c.i], e = s.ent;
      if (sg.type === 'dock') { if (s.docked === sg.station) this.cmAdvance(s, p); continue; }
      if (sg.type === 'travel') { if (e && !e.warp && e.sys === sg.sys) this.cmAdvance(s, p); continue; }
      const a = this.cmSite(p);
      if (!a) { this.cmBegin(s, p); continue; }
      if (!e || e.warp || e.sys !== a.sys) continue;
      const d = dist(e.pos, a.pos);
      if (sg.act === 'reach') { if (d < 30000) this.cmAdvance(s, p); continue; }
      if (sg.act === 'kill') {
        if (a.spawnedFor !== c.i) {
          if (d > 150000) continue;
          a.spawnedFor = c.i;
          for (const type of this.diffEnemies(p, sg.enemies)) { const n = this.spawnStoryNpc(a, type); n.cmSite = a.id; }
          this.notify(s, `${a.name}: противник на сканере!`, 'bad');
          continue;
        }
        for (const id of [...a.npcs]) if (!this.ents.has(id)) a.npcs.delete(id);
        if (!a.npcs.size) this.cmAdvance(s, p);
        continue;
      }
      if (sg.act === 'hack') {
        if (d > 15000) continue;
        c.prog++;
        if (c.prog % 5 === 0) s.send({ t: 'cmProgress', active: this.cmView(p) });
        if (c.prog >= sg.secs) this.cmAdvance(s, p);
        continue;
      }
      if (sg.act === 'loot') {
        if ((p.ship.cargo.q_cmcargo || 0) > 0) { this.cmAdvance(s, p); continue; }
        if (d > 150000) continue;
        if (!a.lootId || !this.ents.has(a.lootId)) {
          const w = { id: 'wr_' + uid(), type: 'wreck', sys: a.sys, pos: add(a.pos, [rnd(-4000, 4000), rnd(-800, 800), rnd(-4000, 4000)]), vel: [0, 0, 0],
            radius: 120, name: `Тайник: ${a.name}`, items: { q_cmcargo: 1 }, expires: this.now + 3600000, owner: p.name, cmSite: a.id };
          this.ents.set(w.id, w); a.lootId = w.id;
          this.notify(s, `${a.name}: тайник на сканере — подлетите и обыщите его`, 'info');
        }
      }
    }
  };
  P.slowTick = function () {
    baseSlow.call(this);
    this.cmTick();
  };
};
module.exports.ENEMIES = ENEMIES;
