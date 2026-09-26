'use strict';
/**
 * Henüz bağlanmamış adımlar için tek kalıp. Adım ne ölçeceğini (`olcut`) ve neyi beklediğini
 * (`bekliyor`: onay / kod) raporda SÖYLER — sessiz atlama yok, sahte GEÇTİ yok.
 * `yazar: true` adımlar (tetik, yayın) kuru koşuda ve demo kitap (74390) dışında HİÇ koşmaz.
 */
const O = require('./ortak');

function iskeletAdim(tanim) {
  const t = { yazar: false, agir: false, altlar: [null], ...tanim };
  return {
    ...t,
    hazir: false,
    async kos(baglam) {
      const satirlar = [];
      for (const alt of t.altlar) {
        const adim = alt ? `${t.ad}/${alt}` : t.ad;
        let ek = {};
        if (t.yazar && baglam.kuru) ek = { kuru: 'kuru koşu — yazma/tetik ATILMADI' };
        else if (t.yazar && String(baglam.kitap) !== O.DEMO_KITAP) {
          ek = {
            reddedildi: `yazan adım yalnız demo kitap ${O.DEMO_KITAP} ile koşar (verilen: ${baglam.kitap})`,
          };
        }
        satirlar.push(O.bekleyenSatir(baglam.test, { ...t, ad: adim }, ek));
      }
      return satirlar;
    },
  };
}

module.exports = { iskeletAdim };
