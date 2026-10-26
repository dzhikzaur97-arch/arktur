// Автоигра: собственный корабль игрока играет сам — тем же «мозгом», что и ИИ-ученики
// (копает, охотится, торгует, улучшает модули). Опыт стартует с самого опытного ученика и дальше
// накапливается свой (p.autoMem). Любая ручная команда полёта или боя возвращает управление пилоту.
// Осторожный режим (по умолчанию): только безопасные сектора и без крупных покупок.
'use strict';
const crypto = require('crypto');
const { ACTIONS } = require('./bot');

const MANUAL = new Set(['warp', 'dock', 'approach', 'orbit', 'keep', 'dir', 'stop', 'manual', 'autopilot', 'jump', 'undock', 'module', 'lock', 'speed', 'board', 'droneEngage', 'loot', 'land']);
const MODES = { auto: 'сам решает, чем заняться', mine: 'добыча руды', hunt: 'охота на пиратов', trade: 'торговля энергоячейками' };
const SAFE = { mine: ['hi', 'mid'], hunt: ['calm', 'edge'], trade: ['border', 'low'] };

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseHandle = P.handle, baseFeasible = P.botFeasible, baseSubChoose = P.botSubChoose;

  // ручная команда пилота выключает автоигру
  P.handle = function (sess, msg) {
    if (sess.auto && !sess._botActing && msg && MANUAL.has(msg.t) && !(msg.t === 'manual' && !msg.on)) this.autoStop(sess, 'Автоигра выключена: вы взяли управление');
    return baseHandle.call(this, sess, msg);
  };

  // выбранное занятие; в осторожном режиме — без покупки кораблей и станций
  P.botFeasible = function (bot) {
    const out = baseFeasible.call(this, bot);
    if (!bot.human) return out;
    if (bot.mode !== 'auto') return out.includes(bot.mode) ? [bot.mode] : ['mine'];
    return out.filter(a => bot.bold || (a !== 'ship' && a !== 'solar'));
  };
  // в осторожном режиме — только безопасные сектора
  P.botSubChoose = function (bot, kind) {
    const k = baseSubChoose.call(this, bot, kind);
    const safe = bot.human && !bot.bold && SAFE[kind];
    if (!safe || safe.includes(k)) return k;
    const sub = bot.mem.sub[kind];
    return safe.reduce((b, x) => ((sub[x] || {}).q || 0) > ((sub[b] || {}).q || 0) ? x : b, safe[0]);
  };

  P.c_autoplay = function (s, m, p) {
    if (s.isBot) return;
    if (m.on === false) {
      if (s.ent && !s.ent.warp && s.ent.cmd.type !== 'manual') { s.ent.cmd = { type: 'stop' }; s.ent.autopilot = null; }
      return this.autoStop(s, 'Автоигра выключена');
    }
    const mode = MODES[m.mode] ? m.mode : (s.auto && s.auto.mode) || p.autoMode || 'auto';
    const bold = m.bold !== undefined ? !!m.bold : s.auto ? s.auto.bold : !!p.autoBold;
    p.autoMode = mode; p.autoBold = bold;
    if (s.auto) {
      if (s.auto.mode !== mode) { s.auto.opt = null; this.botLog(s.auto, 'Новое задание: ' + MODES[mode]); }
      s.auto.mode = mode; s.auto.bold = bold;
      return this.autoSend(s);
    }
    if (!p.autoMem) {
      // опыт берём у самого опытного ИИ-ученика
      const [srcName, src] = Object.entries(this.db.bots || {}).sort((a, b) => b[1].episodes - a[1].episodes)[0] || [];
      p.autoMem = { Q: src ? JSON.parse(JSON.stringify(src.Q)) : {}, sub: src ? JSON.parse(JSON.stringify(src.sub)) : {},
        episodes: 0, history: [], log: [], worth: [], from: src ? srcName : null, pass: crypto.randomBytes(4).toString('hex') };
    }
    const bot = { name: p.name, mem: p.autoMem, sess: s, opt: null, nextStep: this.now + 300, inbox: [], human: true, mode, bold };
    s.auto = bot;
    if (!s._sendRaw) {
      s._sendRaw = s.send;
      s.send = (msg) => {
        if (s.auto && (msg.t === 'note' || msg.t === 'destroyed')) { s.auto.inbox.push(msg); if (s.auto.inbox.length > 30) s.auto.inbox.shift(); }
        s._sendRaw.call(s, msg);
      };
    }
    this.botLog(bot, `Автоигра включена: ${MODES[mode]}${bold ? ', смелый режим' : ''}`);
    this.notify(s, `🤖 Автоигра включена — ${MODES[mode]}. Любая ваша команда полёта вернёт управление.`, 'good');
    this.autoSend(s);
  };

  P.autoStop = function (s, why) {
    if (!s.auto) return;
    s.auto = null;
    this.notify(s, why, 'info');
    s.send({ t: 'auto', on: false });
  };

  P.autoSend = function (s) {
    const bot = s.auto;
    if (!bot) return;
    bot.sentAt = this.now;
    const o = bot.opt;
    s.send({ t: 'auto', on: true, mode: bot.mode, bold: bot.bold, episodes: bot.mem.episodes, from: bot.mem.from,
      doing: o ? { a: ACTIONS[o.a].name, aKey: o.a, phase: o.phase, band: o.band || null, secs: Math.round((this.now - o.t0) / 1000) } : null,
      log: bot.mem.log.slice(0, 5).map(x => x.text) });
  };

  // осторожность: шахтёр и торговец уходят на станцию, как только пират берёт их в цель;
  // охотник отступает раньше, чем ИИ-ученик (броня ниже 35%)
  P.autoDanger = function (s, bot) {
    const e = s.ent, o = bot.opt;
    if (!e || e.warp || !o || o.phase === 'return' || o.phase === 'sell' || o.phase === 'start') return;
    let flee = null;
    if (o.a === 'hunt') { if (o.phase === 'fight' && e.armor < e.stats.armor * 0.35) flee = 'броня ниже 35% — отступаю'; }
    else {
      const hunted = this.now - (e.lastHitAt || 0) < 4000;
      let near = false;
      for (const x of this.ents.values()) if (x.npc && !x.guardian && x.sys === e.sys && !x.warp && x.npcTarget === e.id && Math.hypot(x.pos[0] - e.pos[0], x.pos[1] - e.pos[1], x.pos[2] - e.pos[2]) < 60000) { near = true; break; }
      if (hunted || near) flee = 'пираты рядом — ухожу на станцию';
    }
    if (!flee) return;
    o.phase = 'return';
    this.botLog(bot, flee[0].toUpperCase() + flee.slice(1));
    this.notify(s, '🤖 Автоигра: ' + flee, 'warn');
  };

  // ход автоигры — раз в секунду, из медленного тика
  P.autoTick = function () {
    for (const s of this.sessions) {
      const bot = s.auto;
      if (!bot || !s.player || this.now < bot.nextStep) continue;
      bot.nextStep = this.now + 1000;
      const dead = bot.inbox.some(m => m.t === 'destroyed');
      this.autoDanger(s, bot);
      s._botActing = true; s.isBot = true; // свои команды бота не считаются ручными и не упираются в лимит частоты
      try { this.botStep(bot); } catch (err) { this.botLog(bot, 'Сбой логики: ' + err.message); bot.opt = null; }
      finally { s._botActing = false; s.isBot = false; }
      if (dead) { this.autoStop(s, '⚠ Автоигра остановлена: корабль уничтожен. Включите снова, когда будете готовы.'); continue; }
      if (this.now - (bot.sentAt || 0) >= 2000) this.autoSend(s);
    }
  };
};
module.exports.MODES = MODES;
