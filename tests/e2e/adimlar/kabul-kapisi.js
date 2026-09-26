'use strict';
// T2/T3/T4 — başsız kabulde K3 (kitap açılır, içerik ölçütü) ve K4 (G + İmpark içerik güncelliği).
// K1/K2'nin paket-içi (statik) hali paket-statik.js'te; burası kurulu uygulamadaki ölçüm.
const { iskeletAdim } = require('./iskelet');

module.exports = iskeletAdim({
  ad: 'kabul-kapisi',
  testler: ['T2', 'T3', 'T4'],
  altlar: ['K3', 'K4'],
  agir: true,
  olcut:
    'K3 ilk kitaba girilir, içerik ölçütü geçer · K4 G manifesti ve İmpark içerik kanalı sorulur: ' +
    'kurulu sürümden yenisi varsa RED "güncel değil" + yeniden kuyruk',
  bekliyor:
    'probook-kabul.sh yalnız kurulum+pencere+piksel (:363-367), içerik doğrulanmıyor (:386) · ' +
    "Windows'ta K3-K4 açık karar 1",
});
