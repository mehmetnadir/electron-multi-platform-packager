'use strict';

/**
 * ARTEFAKT KANITI (2026-09-26): üretilen paketin (apk/dmg/impark/exe) sha256'sını VE
 * bayt sayısını R2'ye yüklemeden ÖNCE, belleği şişirmeden akışla hesaplar — 1+ GB
 * artefaktlarda tek okuma geçişi (highWaterMark 8MB, dosya belleğe alınmaz). Sonuç
 * `/result` başarı gövdesine `fileSha256` + `fileSizeBytes` olarak eklenir (bkz.
 * runner.js `postResultSuccess`); book-update bunu `pipeline_platform_summaries`e
 * yazar, `tests/e2e/paket-denetle.js` CDN nesnesinin gerçek sha256/boyutuyla
 * karşılaştırıp "CDN'deki paket bizim ürettiğimiz mi" (T2) sorusunu cevaplar.
 *
 * Bilerek dar kapsamlı: yalnız sha256 + boyut. `windows-serit.js`teki `ozetHesapla`
 * ayrıca md5 de hesaplıyor — o Windows imza zincirine özel (imzalı/imzasız kopya
 * bayt-bayt eşitlik kontrolü); genel artefakt kanıtında gereksiz iş.
 *
 * Hata davranışı: dosya okunamazsa (silindi, izin, bozuk yol) reddeder — ÇAĞIRAN
 * bunu yutmaz, loglar ve kanıtsız yüklemeye devam eder (bkz. runner.js). Burada
 * sessiz bir catch YOK; hata olduğu gibi yukarı taşınır.
 */

const fs = require('fs');
const crypto = require('crypto');

/**
 * @param {string} dosyaYolu
 * @returns {Promise<{sha256: string, boyut: number}>}
 */
function artefaktOzeti(dosyaYolu) {
  return new Promise((resolve, reject) => {
    const sha = crypto.createHash('sha256');
    let boyut = 0;
    fs.createReadStream(dosyaYolu, { highWaterMark: 8 << 20 })
      .on('data', (parca) => { sha.update(parca); boyut += parca.length; })
      .on('error', reject)
      .on('end', () => resolve({ sha256: sha.digest('hex'), boyut }));
  });
}

module.exports = { artefaktOzeti };
