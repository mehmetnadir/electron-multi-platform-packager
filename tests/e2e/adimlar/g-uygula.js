'use strict';
// T4 — G: 74390 için yeni index sürümlü imzalı manifest yayınlanınca kurulu istemci uygular.
// YAZAR: yayın (`tools/g-yayin/yayinla.js e2e 74390 --onayli`) gerçek güncellemedir; canlı manifestin
// salt-okuma doğrulaması ayrı adım (g-dogrula.js) ve kuru koşuda da koşar.
const { iskeletAdim } = require('./iskelet');

module.exports = iskeletAdim({
  ad: 'g-uygula',
  testler: ['T4'],
  yazar: true,
  olcut:
    'mac: userData örtüsü + imzalı .app gövdesi dokunulmamış (codesign --verify --deep --strict rc=0) · ' +
    'Android: files/empp-g/durum.txt yeni sha · Pardus: kurulum dizini',
  bekliyor:
    'yayın + istemci ölçümü koşucuya bağlanmadı: yayinla.js e2e 74390 --onayli (açık karar 4: gece G ' +
    'yayını) ardından kurulu pakette örtü/sha okuma',
});
