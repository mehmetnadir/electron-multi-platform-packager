'use strict';
// T1 — üretim işi runner'da (build_method=build). Salt-okuma pipeline sorgusu bağlanınca doldurulur.
const { iskeletAdim } = require('./iskelet');

module.exports = iskeletAdim({
  ad: 'runner-is-kaydi',
  testler: ['T1'],
  olcut: "Windows üretim işi runner'da, build_method=build; iş kaydında üretilen md5",
  bekliyor:
    "Onay: 74390'ı tüm platformlarla pipeline'a ekleme (26.09: pipeline satırı YOK) · " +
    'srv21 işçi düzeltmesi 96860dd deploy',
});
