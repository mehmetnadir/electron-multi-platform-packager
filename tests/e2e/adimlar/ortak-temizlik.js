'use strict';
/**
 * T4 — ortak temizlik DMG/APK paketinin İÇİNDE uygulanmış mı (f63500c + O2):
 *   paket-disi  src/packaging/paket-disi-liste.js maddesine takılan girdi yok (node_modules, kök
 *               temp/uploads/build, …/temp/data/storage.im, _ önekli kök dizin) — TEK KAYNAK modülün
 *               kendi `dislayanMadde`'siyle ölçülür (liste kopyalanmaz)
 *   olu-motor   her alt-kitap (bookN/) kökünde tek <20-hex>.main.js (olu-motor-temizligi.js: index'ten
 *               ulaşılmayan webpack çıktıları atılır; sm4 öncesi kitap başına 13). Tek kitap paketinde
 *               alt-kitap yoksa kapsam dışı (temizlik alt-kitap köklerine uygulanır).
 * Ölçüm paket-denetle'nin içerik listesinden (icerik-ac → olcum.temizlik); paket açılamadıysa ÖLÇÜLEMEDİ.
 */
const O = require('./ortak');
const K = require('./kesif');

const { DURUM } = O;
const T4_AILELER = new Set(['dmg', 'apk', 'zip']);

function icerikSatiri(s) {
  return (s.satirlar || []).find((r) => r.adim === 'paket-denetle/icerik-ac') || null;
}

module.exports = {
  ad: 'ortak-temizlik',
  testler: ['T4'],
  hazir: true,
  yazar: false,
  agir: false,
  paketIster: true,
  olcut:
    'DMG/APK içinde paket-dışı liste (paket-disi-liste.js) maddesi yok · ölü motor temizliği: ' +
    'her alt-kitap kökünde tek <20-hex>.main.js (f63500c, O2)',
  bekliyor: null,
  async kos(b) {
    const uygun = (b.paketSonuclari || []).filter((s) => s.ozet && T4_AILELER.has(s.ozet.aile));
    if (!uygun.length) {
      const sebep = b.girdiArguman
        ? 'girdi yok: T4 için DMG/APK verilmedi (--paket / --url)'
        : K.girdiYokSebebi(b.kesif, ['mac', 'android'], 'DMG/APK');
      return [O.sonuc(b.test, this.ad, DURUM.OLCULEMEDI, { olcum: { sebep } })];
    }
    const cikti = [];
    for (const s of uygun) {
      const girdi = s.girdi.deger;
      const ac = icerikSatiri(s);
      const tz = ac && ac.durum === DURUM.GECTI && ac.kanit.olcum ? ac.kanit.olcum.temizlik : null;
      if (!tz) {
        const sebep = ac
          ? `paket içeriği ölçülmedi: ${(ac.kanit.olcum && ac.kanit.olcum.sebep) || ac.durum}`
          : 'paket içeriği açılmadı (kaynak/aile aşamasında durdu)';
        cikti.push(
          O.sonuc(b.test, `${this.ad}/paket-disi`, DURUM.OLCULEMEDI, { olcum: { girdi, sebep } }),
        );
        continue;
      }
      const pd = tz.paket_disi;
      cikti.push(
        O.sonuc(b.test, `${this.ad}/paket-disi`, pd.sayi ? DURUM.KALDI : DURUM.GECTI, {
          olcum: {
            girdi,
            platform: tz.platform,
            ...(pd.sayi
              ? {
                  sebep: `pakete girmemesi gereken ${pd.sayi} girdi: ${JSON.stringify(pd.maddeler)} — ör. ${pd.ornek.slice(0, 3).join(', ')}`,
                }
              : { ayrinti: 'paket-dışı liste maddesi yok' }),
          },
        }),
      );
      const dizinler = Object.entries(tz.olu_motor || {});
      if (!dizinler.length) continue; // tek kitap: alt-kitap yok → kapsam dışı (satır üretilmez)
      const fazla = dizinler.filter(([, n]) => n > 1);
      cikti.push(
        O.sonuc(b.test, `${this.ad}/olu-motor`, fazla.length ? DURUM.KALDI : DURUM.GECTI, {
          olcum: {
            girdi,
            ...(fazla.length
              ? {
                  sebep: `ölü motor temizlenmemiş: ${fazla.map(([d, n]) => `${d} ${n} main.js`).join(', ')}`,
                }
              : { ayrinti: `${dizinler.length} alt-kitapta tek main.js` }),
          },
        }),
      );
    }
    return cikti;
  },
};
