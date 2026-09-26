'use strict';
/**
 * Henüz bağlanmamış YAZAN adımlar için tek kalıp (bugün: t5-tetik, g-uygula). Adım ne ölçeceğini
 * (`olcut`) ve neyi beklediğini (`bekliyor`) raporda SÖYLER — sessiz atlama yok, sahte GEÇTİ yok.
 * `yazar: true` adımlar (tetik, yayın) kuru koşuda ve demo kitap (74390) dışında HİÇ koşmaz; kuru
 * koşuda satırın ilk gerekçesi "kuru koşu"dur (gerçek engel), `bekliyor` ikinci sırada durur.
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
        if (t.yazar && baglam.kuru) ek = { kuru: 'kuru koşu (E2E_KURU=1) — yazma/tetik ATILMADI' };
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
