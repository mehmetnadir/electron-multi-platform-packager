'use strict';
/**
 * T1/T2 — CDN nesnesi = üretilen paket mi (srv21 işçisi ezmemiş)?
 *
 * Kanıt sırası (ilk tutan karar verir):
 *   1. TAM md5: CDN md5'i (`--indir` ya da TEK PARÇA ETag) ↔ üretilen md5 (`--uretilen-md5`)
 *   2. R2 üst verisi: HEAD `x-amz-meta-sha256|md5` ↔ `--uretilen-sha256|md5`
 *   3. KISMİ EŞLİK: aynı aileden yerel üretilen paket (`--paket`) ile boyut + ilk/son N MB md5
 *      (N = min(4 MB, boyut/4); CDN tarafı HTTP Range) — tutarsa SARI (tam md5 değil), tutmazsa KALDI
 *   4. Yalnız boyut: `--uretilen-boyut` (yükleme kanıtı / DB `file_size_bytes`) — eşitse SARI, değilse KALDI
 *   5. Hiçbiri yoksa ÖLÇÜLEMEDİ (neden yazılır)
 * Çok parçalı ETag (`…-N`) md5 DEĞİLDİR; asla md5 gibi kıyaslanmaz.
 */
const O = require('./ortak');

const ETAG_MD5 = /^"?([0-9a-f]{32})"?$/i;
const MB = (n) => `${(n / 1048576).toFixed(n % 1048576 ? 1 : 0)} MB`;

function cdnMd5(sonuc) {
  const oz = (sonuc && sonuc.ozet) || {};
  if (oz.md5) return { md5: oz.md5, kaynak: 'tam indirme' };
  const m = ETAG_MD5.exec(String(oz.etag || ''));
  if (m) return { md5: m[1].toLowerCase(), kaynak: 'ETag (tek parça yükleme)' };
  return {
    md5: null,
    kaynak: oz.etag ? `ETag çok parçalı (${oz.etag}) — md5 değil` : 'ETag yok',
  };
}

/** Karar. SAF (testler doğrudan çağırır). */
function kiyasla(uzak, yerel, bek = {}) {
  const c = cdnMd5(uzak);
  const oz = uzak.ozet || {};
  const olcum = {
    girdi: uzak.girdi.deger,
    cdn_boyut: oz.boyut != null ? oz.boyut : null,
    cdn_md5: c.md5,
    kaynak: c.kaynak,
    uretilen_md5: bek.uretilen_md5 || null,
  };
  // 1) tam md5
  if (c.md5 && bek.uretilen_md5) {
    const tut = c.md5 === String(bek.uretilen_md5).toLowerCase();
    return { durum: tut ? O.DURUM.GECTI : O.DURUM.KALDI, olcum: { ...olcum, sinif: 'tam-md5' } };
  }
  // 2) R2 üst verisi
  const meta = oz.meta || {};
  for (const [alan, ref] of [
    ['sha256', bek.uretilen_sha256],
    ['md5', bek.uretilen_md5],
  ]) {
    if (meta[alan] && ref) {
      const tut = meta[alan].toLowerCase() === String(ref).toLowerCase();
      return {
        durum: tut ? O.DURUM.GECTI : O.DURUM.KALDI,
        olcum: { ...olcum, sinif: `r2-meta-${alan}`, cdn_meta: meta[alan], uretilen: ref },
      };
    }
  }
  // 3) kısmi eşlik — yerel üretilen paketle
  const ua = oz.aralik;
  const ya = yerel && yerel.ozet ? yerel.ozet.aralik : null;
  if (ua && ya && !ua.hata && !ya.hata) {
    const o = {
      ...olcum,
      sinif: 'kismi-eslik',
      uretilen_paket: yerel.girdi.deger,
      uretilen_boyut: ya.boyut,
    };
    if (ua.boyut !== ya.boyut) {
      return {
        durum: O.DURUM.KALDI,
        olcum: {
          ...o,
          sebep: `boyut farklı: CDN ${ua.boyut} B ≠ üretilen ${ya.boyut} B — CDN'deki bu paket değil`,
        },
      };
    }
    const farkli = ['bas_md5', 'son_md5'].filter((k) => ua[k] !== ya[k]);
    if (ua.pencere !== ya.pencere || farkli.length) {
      return {
        durum: O.DURUM.KALDI,
        olcum: {
          ...o,
          sebep: `aynı boyut ama ${farkli.join(', ') || 'pencere'} farklı — içerik başka`,
        },
      };
    }
    return {
      durum: O.DURUM.SARI,
      olcum: {
        ...o,
        pencere: ua.pencere,
        sebep: `kısmi eşlik: boyut + ilk/son ${MB(ua.pencere)} md5 aynı (tam md5 değil — --indir ile kesinleşir)`,
      },
    };
  }
  // 4) yalnız boyut
  if (bek.uretilen_boyut != null && oz.boyut != null) {
    const ref = Number(bek.uretilen_boyut);
    if (ref !== oz.boyut) {
      return {
        durum: O.DURUM.KALDI,
        olcum: {
          ...olcum,
          sinif: 'boyut',
          uretilen_boyut: ref,
          sebep: `boyut farklı: CDN ${oz.boyut} B ≠ yükleme kanıtı ${ref} B`,
        },
      };
    }
    return {
      durum: O.DURUM.SARI,
      olcum: {
        ...olcum,
        sinif: 'boyut',
        uretilen_boyut: ref,
        sebep: 'yalnız boyut eşleşti (içerik kıyaslanmadı)',
      },
    };
  }
  // 5) ölçülemedi
  const sebep = !c.md5
    ? `CDN md5 ölçülemedi: ${c.kaynak}; kısmi eşlik için aynı aileden üretilen paket (--paket) ya da --uretilen-boyut gerekir`
    : 'üretilen md5 bilinmiyor (iş kaydı bağlanmadı; --uretilen-md5)';
  return { durum: O.DURUM.OLCULEMEDI, olcum: { ...olcum, sebep } };
}

module.exports = {
  ad: 'cdn-md5-kiyas',
  testler: ['T1', 'T2'],
  hazir: true,
  yazar: false,
  agir: false,
  olcut:
    "CDN nesnesi = runner'ın ürettiği paket: tam md5 / R2 üst verisi; yoksa kısmi eşlik " +
    '(boyut + ilk/son 4 MB md5, SARI) ya da yalnız boyut (SARI)',
  bekliyor: null,
  cdnMd5,
  kiyasla,
  async kos(baglam) {
    const uygun = (baglam.paketSonuclari || []).filter((s) => baglam.testeUygun(s));
    const uzak = uygun.filter((s) => s.girdi.tur === 'url');
    const yerel = uygun.filter((s) => s.girdi.tur === 'paket' && s.ozet && s.ozet.aralik);
    if (!uzak.length) {
      return [
        O.sonuc(baglam.test, this.ad, O.DURUM.OLCULEMEDI, {
          olcum: { sebep: `girdi yok: ${baglam.test} için CDN URL'si verilmedi (--url)` },
        }),
      ];
    }
    return uzak.map((s) => {
      const es = yerel.find((y) => y.ozet.aile === s.ozet.aile) || null;
      const k = kiyasla(s, es, baglam.beklenen || {});
      return O.sonuc(baglam.test, this.ad, k.durum, { olcum: k.olcum });
    });
  },
};
