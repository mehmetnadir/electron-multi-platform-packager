'use strict';
// T5 — sabah doğrulaması: yeni paketlerde içerik damgası = gönderilen damga; arşiv setlerinde BAYAT görünür.
const { iskeletAdim } = require('./iskelet');

module.exports = iskeletAdim({
  ad: 't5-sabah-damga',
  testler: ['T5'],
  agir: true,
  olcut:
    'yeni paketlerde içerik damgası = akşam gönderilen damga · arşiv setinde sahte bump → iş BAYAT + bildirim',
  bekliyor: 't5-tetik + t5-yeniden-kuyruk bağlanınca',
});
