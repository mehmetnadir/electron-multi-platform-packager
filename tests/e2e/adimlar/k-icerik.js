'use strict';
// T4 — K: İmpark içerik güncellemesi sonrası yeni içerik görünür.
const { iskeletAdim } = require('./iskelet');

module.exports = iskeletAdim({
  ad: 'k-icerik',
  testler: ['T4'],
  yazar: true,
  olcut: 'e2e-guncelle 74390 sonrası kurulu pakette yeni içerik damgası görünür',
  bekliyor: 'başsız kabulde K senaryosu yok · mac K kapısı KAPALI',
});
