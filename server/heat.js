// «Умный огонь» — переключатель защиты от перегрева (по умолчанию включён) и сведения о нагреве для советника.
'use strict';
module.exports = function install(Game) {
  const P = Game.prototype;
  P.c_heatGuard = function (s, m, p) {
    p.heatGuard = !!m.on;
    this.notify(s, p.heatGuard ? '🔥 Умный огонь включён: на 90% нагрева орудия делают паузу и не перегреваются' : 'Умный огонь выключен: следите за нагревом сами', 'info');
    this.sendProfile(s);
  };
};
