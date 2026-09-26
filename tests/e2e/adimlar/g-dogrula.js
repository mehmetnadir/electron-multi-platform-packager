'use strict';
/**
 * T4 — G: canlı uçtaki (CDN) imzalı manifest istemcinin göreceği gibi geçerli mi (salt okuma).
 * `tools/g-yayin/yayinla.js dogrula --uzak <taban>` ile AYNI fonksiyon (uzakDogrula): üretim açık
 * anahtarıyla imza, kanal/kimlik/sürüm, surum.json eşliği, her dosya/<yol> sha256+boyut. Yalnız GET.
 * Manifest hiç yayınlanmadıysa (surum.json 404) ÖLÇÜLEMEDİ: ilk yayın yazan adımdır
 * (`yayinla.js e2e <id> --onayli`), kuru koşuda ve onaysız atılmaz.
 */
const O = require('./ortak');
const Y = require('../../../tools/g-yayin/yayinla');
const anahtar = require('../../../tools/g-yayin/anahtar');

const { DURUM } = O;

module.exports = {
  ad: 'g-dogrula',
  testler: ['T4'],
  hazir: true,
  yazar: false,
  agir: false,
  olcut:
    'canlı G ucu <taban>/set/<id>/: surum.json + manifest.json + .sig üretim anahtarıyla doğrulanır, ' +
    'kabuk dosyaları sha256/boyut tutar (yayinla.js dogrula --uzak)',
  bekliyor: null,
  async kos(b) {
    const taban = (b.beklenen && b.beklenen.taban) || O.VARSAYILAN_TABAN;
    const komut = `node tools/g-yayin/yayinla.js dogrula --uzak ${taban} --set-kimligi ${b.kitap}`;
    if (b.ag === false && !b.gUzakDogrula) {
      return [
        O.sonuc(b.test, this.ad, DURUM.OLCULEMEDI, {
          komut,
          olcum: { sebep: 'ağ ölçümü kapalı (EMPP_E2E_AG=0)' },
        }),
      ];
    }
    const dogrula = b.gUzakDogrula || Y.uzakDogrula;
    const u = await dogrula({ taban, setKimligi: b.kitap, acik: anahtar.URETIM_ACIK_ANAHTAR });
    const olcum = { taban, surum: u.surum || null, dosya: u.dosya || 0, kitaplar: u.kitaplar || 0 };
    if (u.gecti) return [O.sonuc(b.test, this.ad, DURUM.GECTI, { komut, olcum })];
    const yok = (u.hatalar || []).find((h) => /^HTTP 404: .*\/surum\.json$/.test(h));
    if (yok) {
      return [
        O.sonuc(b.test, this.ad, DURUM.OLCULEMEDI, {
          komut,
          olcum: {
            ...olcum,
            sebep:
              `canlıda ${b.kitap} G manifesti yok (${yok}) — ilk yayın yazan adım: ` +
              `yayinla.js e2e ${b.kitap} --onayli (onay: 74390 G manifestleri, açık karar 4)`,
          },
        }),
      ];
    }
    return [
      O.sonuc(b.test, this.ad, DURUM.KALDI, {
        komut,
        olcum: { ...olcum, sebep: (u.hatalar || []).join('; ').slice(0, 300) },
      }),
    ];
  },
};
