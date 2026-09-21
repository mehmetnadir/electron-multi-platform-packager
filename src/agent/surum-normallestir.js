'use strict';

/**
 * @fileoverview Sürüm Normalleştirme Modülü (Bug-Fix)
 *
 * Bu modül bir hata düzeltmesidir (bug-fix):
 * Yayıncı uygulaması version.txt içeriği 3 parçalı bir semver formatında
 * değilse (örneğin 4 parçalı "1.13.1.3" gibi) sürümü koşulsuz olarak "eski"
 * kabul etmekte ve her kontrolde yaklaşık 350MB boyutundaki güncelleme paketini
 * tekrar tekrar indirmektedir.
 *
 * Bu modül, sürüm bilgisini güvenli bir şekilde 3 parçaya (Major.Minor.Patch)
 * normalize eder; 3'ten az parçası olan veya geçersiz sürümlerde ise mevcut
 * version.txt içeriğini korumak üzere null sinyali döner.
 *
 * SAF modüldür: Dosya sistemi (fs), ağ veya I/O çağrısı içermez.
 */

/**
 * Verilen sürüm string'ini ayrıştırıp geçerliyse ilk 3 parçasını döner.
 *
 * @param {unknown} ham - Ayrıştırılacak ham sürüm girdisi
 * @returns {string|null} 3 parçalı sürüm string'i veya geçersizse null
 */
function ucParcayaCevir(ham) {
  if (typeof ham !== 'string') {
    return null;
  }

  const temiz = ham.trim();
  if (!temiz) {
    return null;
  }

  const parcalar = temiz.split('.');
  if (parcalar.length < 3) {
    return null;
  }

  const ilkUc = parcalar.slice(0, 3);
  for (let i = 0; i < ilkUc.length; i++) {
    if (!/^\d+$/.test(ilkUc[i])) {
      return null;
    }
  }

  return ilkUc.join('.');
}

/**
 * Zip adından gelen sürüm ile mevcut sürümü karşılaştırıp yazılacak sürüm sonucunu belirler.
 *
 * @param {unknown} zipAdindanGelen - Zip dosyasından elde edilen sürüm bilgisi
 * @param {unknown} [mevcutVersionTxt] - Mevcut version.txt içeriği (imza / gelecek kullanım için)
 * @returns {{ deger: string|null, sebep: 'zaten-uygun'|'normallestirildi'|'normallestirilemedi-korundu' }}
 */
function yazilacakSurum(zipAdindanGelen, mevcutVersionTxt) {
  const sonuc = ucParcayaCevir(zipAdindanGelen);

  if (sonuc !== null) {
    const hamTrim = typeof zipAdindanGelen === 'string' ? zipAdindanGelen.trim() : '';
    if (sonuc === hamTrim) {
      return { deger: sonuc, sebep: 'zaten-uygun' };
    }
    return { deger: sonuc, sebep: 'normallestirildi' };
  }

  return { deger: null, sebep: 'normallestirilemedi-korundu' };
}

/**
 * Sürüm normalleştirme özelliğinin aktif olup olmadığını kontrol eder.
 *
 * @param {Record<string, string|undefined>} [env=process.env] - Çevre değişkenleri nesnesi
 * @returns {boolean} Özellik açık ise true, '0' ile kapatılmışsa false
 */
function acikMi(env) {
  const hedefEnv = (env !== undefined && env !== null)
    ? env
    : (typeof process !== 'undefined' ? process.env : {});

  return hedefEnv.EMPP_SURUM_NORMALLESTIR !== '0';
}

module.exports = {
  ucParcayaCevir,
  yazilacakSurum,
  acikMi
};
