'use strict';
// T5 — srv21 publisher-version-refresh (06:20) 74390'ı yeniden kuyruğa alıyor mu.
const { iskeletAdim } = require('./iskelet');

module.exports = iskeletAdim({
  ad: 't5-yeniden-kuyruk',
  testler: ['T5'],
  olcut:
    'publisher-version-refresh (06:20) 74390 işlerini yeniden kuyruğa alır, dört platform yeniden üretilir',
  bekliyor: '74390 pipeline satırı (onay) + salt-okuma kuyruk sorgusu bağlanmadı',
});
