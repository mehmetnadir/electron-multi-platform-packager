'use strict';

/**
 * Uçtan uca testin İSTEMCİ süreci: pakette koşan güncelleyiciyi GERÇEK varsayılan taşıma
 * (Node https + sistem kök sertifikaları + NODE_EXTRA_CA_CERTS) ile çalıştırır ve raporu
 * stdout'a JSON basar. Pakete KOPYALANMAZ.
 *   node kitap-guncelleyici-ortu.e2e-istemci.js '<{"kok","ortuKoku","taban"}>'
 */
const kg = require('./kitap-guncelleyici');

(async () => {
  const g = JSON.parse(process.argv[2]);
  const r = await kg.guncellemeyiBaslat({
    kok: g.kok,
    gunluk: () => {},
    env: { EMPP_GUNCELLEME_TABANI: g.taban, [kg.ORTU_ENV]: g.ortuKoku, EMPP_GUNCELLEME_ZAMAN_ASIMI: '8000' },
  });
  process.stdout.write(JSON.stringify(r));
})();
