'use strict';

/**
 * KÖK INDEX DENETİMİ — agent.log KÖPRÜSÜ (2026-09-26).
 *
 * NEDEN: `kok-index-denetimi.js`'in `uyar` kipi sonucu bugüne kadar yalnız 3001
 * paketleyici sürecinin stdout'una `console.log` ile düşüyordu. Bu stdout Mac'te
 * `packager.log`'a gider ama `run-agent.sh` her başlatmada dosyayı `>` ile kesiyor
 * (bkz. `~/.empp-agent/arastirma/set-koku-ezilmis-kok-neden-20260926.md`) ve
 * Pardus'ta konteynerin `/out/raw/packager.log`'u iş bitince `work` dizini
 * silinirken kayboluyor. Sonuç: denetim hiç koşmamış GİBİ görünüyor — 0 satır.
 *
 * BU MODÜL denetimin sonucunu iki yoldan `runner.js`'in `log()`'una (agent.log'a
 * kalıcı yazan tek yer) TAŞIR — kipi DEĞİŞTİRMEZ, yalnız görünürlük kazandırır:
 *
 *   1. HTTP paketleyici yolu (mac/android/windows): `packagingService.js`
 *      sonucu `results.kokIndexDenetimi`'e yazar → bu, job durumuyla runner'a
 *      döner (`api/package-status/:jobId`) → `ozetSatiriKur` kitap+platform ekleyip
 *      tek satır kurar.
 *   2. Pardus (Docker) yolu: konteynerin stdout'u zaten `$OUT/raw/packager.log`'a
 *      `tee` ile yazılıyor (`tools/pardus/packager-entry.sh`); iş bitince runner bu
 *      dosyayı (silinmeden ÖNCE) okuyup `pardusLogundanCikar` ile denetim satırını
 *      çıkarır ve kendi `log()`'una basar — `dogrula/rapor.txt` ile AYNI desen.
 *
 * İkisi de SAF fonksiyondur (I/O yok) — testte sentetik girdiyle çağrılır.
 */

/** `packagingService.js`'in yazdığı `denetle()` özetinden TEK satır kurar. Saf. */
function ozetSatiriKur({ bookId, platform, mod, sonuc, detay } = {}) {
  if (!mod || !sonuc) return null;
  const kitapEtiketi = bookId === undefined || bookId === null || bookId === '' ? '?' : bookId;
  const platformEtiketi = platform || '?';
  return `🔍 Kök index denetimi (${mod}): ${sonuc} — ${detay || '-'} `
    + `[kitap ${kitapEtiketi}, platform ${platformEtiketi}]`;
}

/** `denetle()`'in kendi bastığı satırı (`🔍 Kök index denetimi (...): ... — ...`) yakalar. */
const KOK_INDEX_LOG_DESENI = /🔍 Kök index denetimi \([^)]*\): [^\n]*$/m;

/**
 * Pardus konteyner çıktısından (packager.log metni) kök index denetimi satırını çıkarır.
 * Satır yoksa (denetim kapalıysa, ya da metin boşsa) `null` döner. Saf.
 *
 * @param {string} metin packager.log tam içeriği
 * @returns {string|null}
 */
function pardusLogundanCikar(metin) {
  if (typeof metin !== 'string' || !metin) return null;
  const m = metin.match(KOK_INDEX_LOG_DESENI);
  return m ? m[0].trim() : null;
}

module.exports = { ozetSatiriKur, pardusLogundanCikar, KOK_INDEX_LOG_DESENI };
