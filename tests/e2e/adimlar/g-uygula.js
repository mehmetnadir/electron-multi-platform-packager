'use strict';
// T4 — G: 74390 için yeni index sürümlü imzalı manifest yayınlanınca istemci uygular.
const { iskeletAdim } = require('./iskelet');

module.exports = iskeletAdim({
  ad: 'g-uygula',
  testler: ['T4'],
  yazar: true,
  olcut:
    'mac: userData örtüsü + imzalı .app gövdesi dokunulmamış (codesign --verify --deep --strict rc=0) · ' +
    'Android: files/empp-g/durum.txt yeni sha · Pardus: kurulum dizini',
  bekliyor:
    "Onay: 74390 G manifestleri (yukle kapısı beyaz liste) · g-electron / g-yayin dalları agent-mode'a birleşmedi",
});
