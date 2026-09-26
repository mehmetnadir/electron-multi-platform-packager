'use strict';
// T5 — akşam tetiği: `yayincilikadm book e2e-guncelle 74390` (damgalı içerik İmpark'a). YAZAR: yalnız
// 74390, kuru koşuda atılmaz. Tetiğin SONUCU salt okumayla ölçülür: t5-yeniden-kuyruk (İmpark içerik
// sürümü değişince satırlar yeniden kuyruğa girdi mi) + t5-sabah-damga (paketlerde içerik sürümü).
const { iskeletAdim } = require('./iskelet');

module.exports = iskeletAdim({
  ad: 't5-tetik',
  testler: ['T5'],
  yazar: true,
  olcut:
    'yayincilikadm book e2e-guncelle 74390 damgalı içerik gönderir; gönderilen damga rapora yazılır',
  bekliyor:
    'tetik çağrısı koşucuya bağlanmadı (yayincilikadm book e2e-guncelle 74390 --json; damga alanı ' +
    'okunmuyor) · gece koşu saati açık karar 2',
});
