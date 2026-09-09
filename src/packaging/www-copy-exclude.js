'use strict';
/**
 * K2 — Android/Capacitor `www` (ve webapp) kopyası için ortak dışlama filtresi.
 *
 * NEDEN: `prepareElectronFiles()` (packagingService.js) her paketleme başında
 * `npm install --only=dev` çalıştırır, cwd=workingPath — bu, workingPath köküne
 * `node_modules/electron` yazar (masaüstü electron-builder hattı için gerekli).
 * Android hattında ise `workingPath` iki yerde HİÇBİR FİLTRE OLMADAN kopyalanıyordu:
 *   - packageAndroid(): fs.copy(workingPath, webAppPath)
 *   - initializeCapacitorProject(): fs.copy(workingPath, wwwPath)
 * wwwPath, Capacitor'ın `webDir: 'www'` ayarıyla APK'nın `assets/public/` klasörüne
 * gömülüyor.
 *
 * BELİRTİ: Mac APK 1.62 GB / srv21 (Linux derleme) 1.44 GB — 318 dosyalık fark
 * tamamı `assets/public/node_modules/electron/**` (Mac'te 678 MB, Linux'ta 250 MB,
 * Electron.app'in TAMAMI). electron-builder config'lerinde (windows/macos/linux,
 * `files: ["**\/*", "!node_modules", ...]`) bu dışlama zaten var; Android'in ham
 * fs.copy() çağrılarında YOKTU.
 *
 * KANIT: 2026-09-09, kitap 45538 "English Up 5 Set" — `fixed2_45538.apk` /
 * `asis_59480.apk` extraction+grep, `unzip -l` çıktısında 0 `node_modules` eşleşmesi
 * (bu kural her sonraki proof APK'da da (`shim_59480.apk`, `home_59480.apk`,
 * `vfs_59480.apk`, `vfs2_59480.apk`) tekrar doğrulandı).
 *
 * BOZARSAN: bu filtreyi (veya onu çağıran iki fs.copy noktasını) kaldırırsan
 * `www-copy-exclude.test.js` içindeki `GERİLEME: filtre kaldırılırsa node_modules/
 * electron APK'ya sızar (assets/public şişer)` testi kırılır.
 */
const path = require('path');

const EXCLUDED_SEGMENTS = new Set(['node_modules', '.git']);

/**
 * fs-extra `copy(src, dest, { filter })` için filtre üretir. `srcRoot`'a göre
 * herhangi bir yol segmenti EXCLUDED_SEGMENTS içindeyse o dosya/klasör (ve klasörse
 * altındaki her şey) kopyalanmaz.
 *
 * @param {string} srcRoot - kopyanın kök kaynağı (örn. workingPath)
 * @returns {(src: string) => boolean}
 */
function createWwwCopyFilter(srcRoot) {
  return (src) => {
    const rel = path.relative(srcRoot, src);
    if (!rel || rel === '.') return true; // kökün kendisi
    const segments = rel.split(path.sep);
    return !segments.some((seg) => EXCLUDED_SEGMENTS.has(seg));
  };
}

module.exports = { createWwwCopyFilter, EXCLUDED_SEGMENTS };
