'use strict';
// T4 — ortak temizlik (paket-dışı liste, ölü motor) paketleme raporunda görünüyor mu.
const { iskeletAdim } = require('./iskelet');

module.exports = iskeletAdim({
  ad: 'ortak-temizlik',
  testler: ['T4'],
  olcut: 'DMG/APK paketleme raporunda paket-dışı liste ve ölü motor temizliği uygulanmış (f63500c)',
  bekliyor: '74390 DMG/APK üretimi (pipeline onayı) + paketleme raporundan okuma bağlanmadı',
});
