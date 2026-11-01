// Корабли вольных гильдий: восемь машин независимых верфей, каждая — под своё ремесло.
// Продаются на любой станции (кроме «Порога» — его собирают только для тех, кто победил Архонта Края).
// Особые способности: гонки, газ, зонды, пассажиры, награды за головы, погода, корпорация и флот, бой с боссами.
'use strict';
const { SHIPS, NPCS, incomeOf } = require('./data');

const GUILD_SHIPS = {
  kometa: {
    name: 'Комета', cls: 'Гоночный перехватчик', price: 95000, color: 0xe8e2d4, guild: 'Гоночная лига Арктура',
    maxSpeed: 720, align: 1.5, warpSpeed: 8, sig: 26, radius: 34,
    shield: 380, armor: 260, hull: 300, cap: 420, capRegen: 12,
    cargo: 80, slots: { high: 1, mid: 3, low: 2 }, maxLocks: 2, lockRange: 25000, lockTime: 1.5,
    bonus: { speed: 0.12 }, raceBonus: 0.6, role: 'explore', tier: 1,
    desc: 'Самый быстрый корабль галактики: 720 м/с (+12%), разворот за 1,5 с. Призы за гонки +60%. Почти без брони и трюма.',
    lore: 'Лига проводит гонки над кольцами Арктура уже сорок лет. «Комету» строят вручную, по одной в месяц: корпус-игла из вспененного титана, два «уса»-стабилизатора и движок, который пилоты называют «кипятильником». Победителю сезона дарят «Комету» с золотым носом — пока что их три на всю галактику.'
  },
  meduza: {
    name: 'Медуза', cls: 'Газовая баржа', price: 280000, color: 0x7fa6b8, guild: 'Газовые артели Пограничья',
    maxSpeed: 170, align: 7, warpSpeed: 2.5, sig: 160, radius: 110,
    shield: 1800, armor: 1100, hull: 1400, cap: 900, capRegen: 16,
    cargo: 6500, slots: { high: 4, mid: 2, low: 2 }, maxLocks: 3, lockRange: 25000, lockTime: 3,
    bonus: { mining: 0.2 }, gasBonus: 0.8, role: 'mining', tier: 2,
    desc: 'Баржа для газовых облаков: сбор газа +80%, руды +20%, трюм 6 500 м³, четыре порта под сборщики.',
    lore: 'Артельщики Пограничья десятилетиями черпали газ самодельными ковшами, пока кто-то не подвесил под баржу купол-коллектор с длинными щупами-заборниками. Издалека она и правда похожа на медузу: полупрозрачный купол светится от гелия-3, а щупы колышутся в облаке. Говорят, в шторм артельщики спят прямо внутри купола — там теплее.'
  },
  peleng: {
    name: 'Пеленг', cls: 'Зондовый разведчик', price: 230000, color: 0x4b5a6e, guild: 'Бюро дальней картографии',
    maxSpeed: 420, align: 2.2, warpSpeed: 9, sig: 30, radius: 42,
    shield: 650, armor: 450, hull: 500, cap: 700, capRegen: 16,
    cargo: 300, slots: { high: 1, mid: 4, low: 2 }, maxLocks: 3, lockRange: 55000, lockTime: 1.4,
    bonus: { scan: 1.5 }, probeBonus: true, role: 'explore', tier: 2,
    desc: 'Лучший охотник за скрытыми сигналами: зонды засчитывают находку с 0,45 а.е., сканируют вдвое чаще; сканер +150%.',
    lore: 'Бюро — горстка картографов, которые продают карты всем сторонам и никому не присягают. «Пеленг» несёт четыре складные антенны-лепестка и кассету зондов, которые раскрываются звездой вокруг корабля. Половина известных тайников Предтеч найдена именно «Пеленгами» — и Бюро получает процент с каждой находки.'
  },
  avrora: {
    name: 'Аврора', cls: 'Пассажирский лайнер', price: 900000, color: 0xf2efe8, guild: 'Круизные линии «Аврора»',
    maxSpeed: 260, align: 6, warpSpeed: 4, sig: 220, radius: 160,
    shield: 4200, armor: 2200, hull: 3000, cap: 1600, capRegen: 20,
    cargo: 3500, slots: { high: 2, mid: 4, low: 3 }, maxLocks: 3, lockRange: 35000, lockTime: 3,
    bonus: { cargo: 0.2 }, taxiBonus: 0.4, role: 'transport', tier: 3,
    desc: 'Лайнер для пассажиров и срочных грузов: награда за такие заказы +40%, пираты вдвое реже устраивают засады, варп 4 а.е./с.',
    lore: 'Белоснежные лайнеры «Авроры» возят дипломатов, туристов и всех, кто готов платить за панорамную палубу. Компания гордится, что за двадцать лет не потеряла ни одного пассажира — пиратские банды знают: за «Аврору» Консорциум и Лига мстят вместе. Для вольных пилотов компания продаёт списанные корпуса — с той же палубой и той же репутацией.'
  },
  gonchaya: {
    name: 'Гончая', cls: 'Корабль охотника за головами', price: 820000, color: 0x3a3330, guild: 'Гильдия охотников за головами',
    maxSpeed: 360, align: 4, warpSpeed: 4.5, sig: 95, radius: 90,
    shield: 2400, armor: 3000, hull: 2400, cap: 1500, capRegen: 22,
    cargo: 400, slots: { high: 5, mid: 4, low: 3 }, maxLocks: 4, lockRange: 55000, lockTime: 2,
    bonus: { damage: 0.2, speed: 0.1 }, bountyBonus: 0.5, role: 'combat', tier: 3,
    desc: 'Охотник за главарями: награды за главарей с доски розыска +50%, за обычных пиратов +25%. +20% урона, +10% скорости.',
    lore: 'Первую «Гончую» Гильдия собрала из трофейного пиратского крейсера: отпилили шипы, поставили сенсорную «морду» и клетку-захват на брюхе. Теперь их строят с нуля, но клетку оставили — по традиции в неё сажают пойманного главаря, если его сдают живым. Главари Скверны узнают силуэт «Гончей» издалека и, говорят, начинают торговаться ещё до первого выстрела.'
  },
  burevestnik: {
    name: 'Буревестник', cls: 'Штормовой крейсер', price: 420000, color: 0x2f4a5c, guild: 'Метеослужба Пограничья',
    maxSpeed: 300, align: 4.5, warpSpeed: 4, sig: 100, radius: 85,
    shield: 2600, armor: 1900, hull: 2000, cap: 1400, capRegen: 22,
    cargo: 600, slots: { high: 4, mid: 4, low: 3 }, maxLocks: 4, lockRange: 50000, lockTime: 2.2,
    bonus: { damage: 0.1 }, stormproof: true, role: 'combat', tier: 2,
    desc: 'Не боится космической погоды: никаких штрафов от штормов, бурь и туманностей, а во время непогоды +20% урона и +15% скорости.',
    lore: 'Метеослужба отправляет «Буревестники» туда, откуда бегут все остальные: в ионные штормы, к вспыхивающим звёздам, в магнитные бури. Экранированный корпус с громоотводами-гребнями собирает разряды и сбрасывает их в накопитель. Пилоты службы шутят, что их корабль «питается плохой погодой» — и в бурю действительно стреляет злее.'
  },
  veche: {
    name: 'Вече', cls: 'Штабной крейсер корпорации', price: 3400000, color: 0x5a4a32, guild: 'Ассоциация вольных корпораций',
    maxSpeed: 190, align: 8, warpSpeed: 2.6, sig: 260, radius: 170,
    shield: 7000, armor: 7000, hull: 6500, cap: 3200, capRegen: 40,
    cargo: 1500, slots: { high: 5, mid: 6, low: 4 }, maxLocks: 7, lockRange: 80000, lockTime: 3.5,
    bonus: { damage: 0.1, drones: 0.2 }, corpHQ: true, role: 'carrier', tier: 4,
    desc: 'Штаб корпорации: пока «Вече» у вас в ангаре или под вами, доход корпорации +30%, во флоте эскорта +1 место, а эскорт рядом с «Вече» крепче и бьёт сильнее на 25%.',
    lore: 'Слово «вече» в Пограничье означает общее собрание — именно так вольные корпорации решают свои дела. Ассоциация строит для них плавучие штабы: зал совета под куполом, антенны дальней связи, лётная палуба для эскорта. На борту каждого «Вече» висит колокол — в него бьют, когда корпорация принимает решение.'
  },
  porog: {
    name: 'Порог', cls: 'Дредноут Порога', price: 14000000, color: 0x2a2436, guild: 'Верфь у Врат за Край',
    maxSpeed: 110, align: 13, warpSpeed: 2, sig: 480, radius: 320,
    shield: 20000, armor: 20000, hull: 18000, cap: 8000, capRegen: 80,
    cargo: 1500, slots: { high: 8, mid: 6, low: 5 }, maxLocks: 8, lockRange: 95000, lockTime: 4,
    bonus: { damage: 0.3, pd: 0.4 }, bossBonus: 0.5, role: 'combat', tier: 5,
    needStat: { stat: 'archon', n: 1, text: 'только для победителей Архонта Края' },
    desc: 'Дредноут из обломков Архонта: +30% урона, а по боссам (Архонт, Колосс, дредноуты событий, главари розыска) — ещё +50%. Продаётся только тем, кто победил Архонта Края.',
    lore: 'Когда первый Архонт пал, из его тайника достали ядро, которое не остывало неделями. Инженеры, осевшие у Врат, вплавили его в корпус нового дредноута — и назвали корабль «Порогом», потому что дальше Врат человечество пока не ходило. Кристаллические жилы на броне медленно пульсируют в такт с Вратами; пилоты клянутся, что «Порог» чувствует Архонта раньше сенсоров.'
  }
};
for (const [id, t] of Object.entries(GUILD_SHIPS)) SHIPS[id] = t;
SHIPS.veche.droneBay = 150; SHIPS.veche.maxDrones = 5;
SHIPS.porog.droneBay = 100; SHIPS.porog.maxDrones = 5;

module.exports = function install(Game) {
  const P = Game.prototype;
  const baseBuy = P.c_buy, baseCalc = P.calcStats;
  const T = (p) => (p && p.ship && SHIPS[p.ship.type]) || {};
  P.shipFlag = function (p, flag) { return T(p)[flag]; };
  // «Порог» — только для победителей Архонта
  P.c_buy = function (s, m, p) {
    const t = SHIPS[m.item];
    if (t && t.needStat && ((p.stats || {})[t.needStat.stat] || 0) < t.needStat.n) return this.notify(s, `«${t.name}»: ${t.needStat.text}`, 'warn');
    return baseBuy.call(this, s, m, p);
  };
  // газовая баржа: сбор газа
  P.calcStats = function (p, ship) {
    const r = baseCalc.call(this, p, ship);
    const t = ship && SHIPS[ship.type];
    if (t && t.gasBonus) r.gasMul = (r.gasMul || 1) * (1 + t.gasBonus);
    return r;
  };
  // штаб корпорации: корабль есть у пилота (под ним или в любом ангаре)
  P.hasHQ = function (p) { if (!p) return false; return !!((SHIPS[p.ship.type] || {}).corpHQ || Object.values(p.hangars || {}).some(h => h.ships.some(x => SHIPS[x.type] && SHIPS[x.type].corpHQ))); };
  // «Порог»: урон по боссам
  const baseApply = P.applyDamage, baseDestroy = P.destroyShip;
  P.applyDamage = function (t, dmg, src, ...rest) {
    if (t && src && src.owner && (t.wboss || t.wantedId)) { const b = (SHIPS[src.shipType] || {}).bossBonus; if (b) dmg *= 1 + b; }
    return baseApply.call(this, t, dmg, src, ...rest);
  };
  // «Гончая»: +25% к награде за обычных пиратов (за главарей розыска — в world.js)
  P.destroyShip = function (t, killer) {
    const extra = killer && killer.owner && t && t.npc && !t.wantedId && (SHIPS[killer.shipType] || {}).bountyBonus && NPCS[t.npc]
      ? Math.round(NPCS[t.npc].bounty * (t.bountyMul || 1) * incomeOf(t.sys) * 0.25) : 0;
    const r = baseDestroy.call(this, t, killer);
    if (extra > 0) { const p = this.db.players[killer.owner]; if (p) { p.credits += extra; const s = killer.session; if (s) this.notify(s, `Гильдия охотников: надбавка +${extra.toLocaleString('ru-RU')} CR`, 'good'); } }
    return r;
  };
};
module.exports.GUILD_SHIPS = GUILD_SHIPS;
