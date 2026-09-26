'use strict';
// T2 — Pardus üretim yeri ProBook mu; Mac Docker'a düştüyse SARI + "düşme: <neden>".
const { iskeletAdim } = require('./iskelet');

module.exports = iskeletAdim({
  ad: 'uretim-yeri',
  testler: ['T2'],
  olcut: "İş kaydında üretim yeri 'probook'; Mac'e düştüyse SARI ve rapora 'düşme: <neden>'",
  bekliyor:
    "Onay: ProBook kayıt sırrı (build_agents) · ProBook şeridi (420f21e) runner'a bağlı değil",
});
