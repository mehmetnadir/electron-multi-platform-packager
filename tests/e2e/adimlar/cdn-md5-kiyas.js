'use strict';
/**
 * T1/T2 — CDN md5 = üretilen md5 (srv21 işçisi ezmemiş).
 * CDN md5 kaynağı: `--indir` ile indirilen dosyanın md5'i ya da TEK PARÇA yüklemenin ETag'i
 * (çok parçalı ETag `…-N` md5 DEĞİLDİR → ölçülemedi). Üretilen md5 iş kaydından gelir
 * (runner-is-kaydi bağlanınca); şimdilik `--uretilen-md5` ile verilir.
 */
const O = require('./ortak');

const ETAG_MD5 = /^"?([0-9a-f]{32})"?$/i;

function cdnMd5(sonuc) {
  const oz = (sonuc && sonuc.ozet) || {};
  if (oz.md5) return { md5: oz.md5, kaynak: 'tam indirme' };
  const m = ETAG_MD5.exec(String(oz.etag || ''));
  if (m) return { md5: m[1].toLowerCase(), kaynak: 'ETag (tek parça yükleme)' };
  return { md5: null, kaynak: oz.etag ? `ETag çok parçalı (${oz.etag}) — md5 değil` : 'ETag yok' };
}

module.exports = {
  ad: 'cdn-md5-kiyas',
  testler: ['T1', 'T2'],
  hazir: true,
  yazar: false,
  agir: false,
  olcut: "CDN nesnesinin md5'i = runner'ın ürettiği paketin md5'i",
  bekliyor: null,
  cdnMd5,
  async kos(baglam) {
    const uzak = (baglam.paketSonuclari || []).filter(
      (s) => s.girdi.tur === 'url' && baglam.testeUygun(s),
    );
    if (!uzak.length) {
      return [
        O.sonuc(baglam.test, this.ad, O.DURUM.OLCULEMEDI, {
          olcum: { sebep: `girdi yok: ${baglam.test} için CDN URL'si verilmedi (--url)` },
        }),
      ];
    }
    return uzak.map((s) => {
      const c = cdnMd5(s);
      const bek = baglam.beklenen.uretilen_md5 || null;
      const olcum = { girdi: s.girdi.deger, cdn_md5: c.md5, kaynak: c.kaynak, uretilen_md5: bek };
      if (!c.md5)
        return O.sonuc(baglam.test, this.ad, O.DURUM.OLCULEMEDI, {
          olcum: {
            ...olcum,
            sebep: `CDN md5 ölçülemedi: ${c.kaynak} (--indir ile tam indirme gerekir)`,
          },
        });
      if (!bek)
        return O.sonuc(baglam.test, this.ad, O.DURUM.OLCULEMEDI, {
          olcum: {
            ...olcum,
            sebep: 'üretilen md5 bilinmiyor (iş kaydı bağlanmadı; --uretilen-md5)',
          },
        });
      return O.sonuc(
        baglam.test,
        this.ad,
        c.md5 === bek.toLowerCase() ? O.DURUM.GECTI : O.DURUM.KALDI,
        { olcum },
      );
    });
  },
};
