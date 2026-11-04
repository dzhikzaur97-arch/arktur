// Доска сектора: всё, чем можно заняться прямо сейчас в пределах 3 прыжков — одним списком,
// с дальностью, риском, наградой и путём пилота, к которому дело относится. Дела пути из мечты — сверху.
'use strict';
const { NPCS } = require('./data');
const { PATHS } = require('./paths');

const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const RELIC = { vault: 'Хранилище Предтеч', sentinel: 'Спящий страж', ionstorm: 'Ионный шторм', graveyard: 'Кладбище флота' };
const riskOf = (sec) => sec >= 0.6 ? 'низкий' : sec >= 0.3 ? 'средний' : sec > 0 ? 'высокий' : 'смертельный';

module.exports = function install(Game) {
  const P = Game.prototype;

  P.boardView = function (s, p) {
    const here = s.ent ? s.ent.sys : this.playerSys(p);
    const dist = { [here]: 0 }, q = [here];
    while (q.length) { const c = q.shift(); if (dist[c] >= 3) continue; for (const n of this.U.neighbors[c] || []) if (!(n in dist)) { dist[n] = dist[c] + 1; q.push(n); } }
    const items = [];
    const put = (o) => {
      if (!o.sys || !(o.sys in dist)) return;
      const d = this.U.byId[o.sys];
      items.push({ ...o, jumps: dist[o.sys], sysName: d.name, sec: +d.sec.toFixed(1), risk: riskOf(d.sec) });
    };
    // заклятые враги — вызов на бой
    if (this.nemesesView) for (const n of this.nemesesView(p)) {
      items.push({ id: n.id, kind: 'nemesis', path: 'hunter', icon: '☠', title: `Заклятый враг: ${n.title} ${n.name}`, desc: `Ур. ${n.lv}, ${n.ship}. ${n.why === 'revenge' ? 'Мстит за брата.' : 'Сбил вас.'} Сам устраивает засады в опасных системах.`,
        reward: `${fmt(n.bounty)} CR + трофей`, sys: here, jumps: 0, sysName: (this.U.byId[here] || {}).name, sec: +this.U.byId[here].sec.toFixed(1), risk: n.lv >= 6 ? 'высокий' : 'средний', act: n.near ? null : 'nemesis', actText: n.near ? 'Уже рядом!' : '⚔ Вызвать на бой' });
    }
    // сюжет
    try {
      const sv = this.storyView(p);
      if (sv && !sv.done && sv.text) put({ id: 'story', kind: 'story', path: 'hero', icon: '✦', title: `Сюжет: ${sv.title}`, desc: `Этап ${sv.stage}/${sv.stages}: ${sv.text}`, reward: 'репутация и CR', sys: sv.sys || here, act: sv.sys && sv.sys !== here ? 'route' : 'missions', actText: sv.sys && sv.sys !== here ? '» Проложить маршрут' : '☰ Открыть задание' });
    } catch (e) { /* сюжет не начат */ }
    // аномалии: базы пиратов, события, розыск, фронт, Предтечи, свои задания
    for (const sysId of Object.keys(dist)) {
      for (const a of this.knownAnoms(p, sysId)) {
        if (a.done) continue;
        const base = { id: a.id, target: a.id, sys: sysId, act: 'go' };
        if (a.kind === 'pbase') {
          const e = [...a.npcs].map(id => this.ents.get(id)).find(Boolean);
          if (!e) continue;
          put({ ...base, kind: 'pbase', path: 'hunter', icon: '☠', title: a.name, desc: `Пиратская база: 5 волн защитников${e.pb && e.pb.state !== 'idle' ? ' — бой уже идёт' : ''}.`, reward: `${fmt(this.pbaseReward(e))} CR` });
        } else if (a.kind === 'event') put({ ...base, kind: 'event', path: 'hero', icon: '!', title: a.name, desc: 'Событие в системе: помогите — или успейте забрать добычу.', reward: 'CR и добыча' });
        else if (a.kind === 'wevent') put({ ...base, kind: 'wevent', path: 'hero', icon: '☄', title: a.name, desc: 'Мировое событие: босс уровня сектора. Награда делится по урону.', reward: 'крупная, по урону' });
        else if (a.kind === 'front') put({ ...base, kind: 'front', path: 'hero', icon: '⚑', title: a.name, desc: 'Линия фронта войны фракций: сбивайте патрули противника.', reward: 'знаки отличия' });
        else if (a.kind === 'wanted') {
          const b = ((this.db.wanted || {}).bosses || []).find(x => 'an_wanted_' + x.id === a.id);
          put({ ...base, kind: 'wanted', path: 'hunter', icon: '☠', title: a.name, desc: b ? `Главарь с доски розыска, ур. ${b.lv}.` : 'Главарь с доски розыска.', reward: b ? `${fmt(this.wantedBounty(b))} CR` : 'награда за голову' });
        } else if (RELIC[a.kind]) put({ ...base, kind: 'relic', path: 'explorer', icon: '◈', title: a.name || RELIC[a.kind], desc: 'Аномалия Предтеч: тайник с артефактами под охраной.', reward: 'артефакты' });
        else if (a.kind === 'contract') put({ ...base, kind: 'contract', path: 'trader', icon: '☰', title: `Контракт: ${a.name}`, desc: 'Точка вашего контракта.', reward: 'по контракту' });
        else if (a.kind === 'story') put({ ...base, kind: 'storysite', path: 'hero', icon: '✦', title: `Сюжет: ${a.name}`, desc: 'Точка сюжетной миссии.', reward: 'по сюжету' });
        else if (a.kind === 'cmission') put({ ...base, kind: 'cmission', path: 'hero', icon: '✧', title: `Особое задание: ${a.name}`, desc: 'Точка особого задания.', reward: 'по заданию' });
      }
      // небесные тела с занятиями — только в своей и соседних системах, чтобы список не разрастался
      if (dist[sysId] > 1) continue;
      const sys = this.U.systems[sysId];
      for (const c of sys.celestials) {
        if (c.kind === 'race') put({ id: c.id, target: c.id, sys: sysId, act: 'go', kind: 'race', path: 'explorer', icon: '🏁', title: c.name, desc: 'Гоночная трасса: пройдите кольца на время.', reward: 'CR за время' });
        else if (c.kind === 'arena') put({ id: c.id, target: c.id, sys: sysId, act: 'go', kind: 'arena', path: 'hunter', icon: '⚔', title: c.name, desc: 'Арена: волны противников, ставка и выигрыш.', reward: 'выигрыш' });
        else if (c.kind === 'gasfield') put({ id: c.id, target: c.id, sys: sysId, act: 'go', kind: 'gas', path: 'industry', icon: '☁', title: c.name, desc: 'Газовое облако: нужен газовый сборщик.', reward: 'газ на продажу' });
      }
      if (dist[sysId] === 0 && sys.belts && sys.belts.length) {
        const b = sys.belts[0];
        put({ id: b.id, target: b.id, sys: sysId, act: 'go', kind: 'belt', path: 'industry', icon: '⁂', title: b.name || 'Пояс астероидов', desc: 'Руда на продажу и переработку. В опасных системах — пираты.', reward: 'руда' });
      }
    }
    // на станции: агенты и лучший торговый маршрут
    if (s.docked) {
      try { const n = this.missionBoard(s.docked).offers.length; if (n) items.push({ id: 'agents', kind: 'agents', path: 'trader', icon: '☰', title: `Агенты станции: ${n} заданий`, desc: 'Доставка, охота, добыча, пассажиры.', reward: 'CR и репутация', sys: here, jumps: 0, sysName: this.U.byId[here].name, sec: +this.U.byId[here].sec.toFixed(1), risk: 'разный', act: 'tab', tab: 'agents', actText: 'Открыть агентов' }); } catch (e) {}
      try {
        const tv = this.tradeView(s, p), r = tv.routes && tv.routes[0];
        if (r) items.push({ id: 'trade', kind: 'trade', path: 'trader', icon: '⚖', title: `Маршрут: ${r.name}`, desc: `Купить здесь по ${fmt(r.buy)} CR, продать на станции «${r.toName}» (${r.sysName}, ${r.jumps} пр.) по ${fmt(r.sell)} CR.`, reward: `≈${fmt(r.unit)} CR с единицы`, sys: here, jumps: 0, sysName: this.U.byId[here].name, sec: +this.U.byId[here].sec.toFixed(1), risk: 'по пути', act: 'tab', tab: 'trade', actText: 'Открыть торговлю' });
      } catch (e) {}
    }
    // ежедневные задания
    try { for (const t of this.dailyView(p).tasks) if (!t.done) items.push({ id: 'daily_' + t.text, kind: 'daily', path: null, icon: '☀', title: `Ежедневное: ${t.text}`, desc: `${fmt(t.prog)} / ${fmt(t.need)}`, reward: `${fmt(t.isk)} CR`, sys: here, jumps: 0, sysName: this.U.byId[here].name, sec: +this.U.byId[here].sec.toFixed(1), risk: '—', act: null }); } catch (e) {}
    const dream = p.dream;
    items.sort((a, b) => ((b.path === dream) - (a.path === dream)) || (a.kind === 'nemesis' ? -1 : b.kind === 'nemesis' ? 1 : 0) || a.jumps - b.jumps);
    return { t: 'board', here, dream, dreamName: dream && PATHS[dream] ? PATHS[dream].name : null, honor: this.honorView ? this.honorView(p, here) : null, items: items.slice(0, 40) };
  };
  P.c_board = function (s, m, p) { s.send(this.boardView(s, p)); };
};
