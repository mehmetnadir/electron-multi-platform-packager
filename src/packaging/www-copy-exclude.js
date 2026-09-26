'use strict';
/**
 * K2 — Android/Capacitor `www` (ve webapp) kopyası için dışlama süzgeci.
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
 * Electron.app'in TAMAMI).
 *
 * KANIT: 2026-09-09, kitap 45538 "English Up 5 Set" — `fixed2_45538.apk` /
 * `asis_59480.apk` extraction+grep, `unzip -l` çıktısında 0 `node_modules` eşleşmesi.
 *
 * TEK KAYNAK (2026-09-26, Nadir: "windows paketinde uyguladığımız gereksizleri atma
 * politikasını onlarda da uygulamalıyız"): liste artık burada DEĞİL —
 * `paket-disi-liste.js`. Bu dosya yalnız Android'in `fs.copy` biçimine bağlayan
 * adaptördür; Windows/macOS/Linux `files` dizileri AYNI modülden türer. Kök `temp/`,
 * `uploads/`, `build/`, `**\/temp/data/storage.im` ve `_` önekli kök dizinler de
 * böylece APK'ya girmez.
 *
 * BOZARSAN: bu süzgeci (veya onu çağıran iki fs.copy noktasını) kaldırırsan
 * `www-copy-exclude.test.js` GERİLEME testleri kırılır.
 */
const paketDisiListe = require('./paket-disi-liste');

/**
 * fs-extra `copy(src, dest, { filter })` için Android süzgeci.
 * @param {string} srcRoot - kopyanın kök kaynağı (örn. workingPath)
 * @returns {(src: string) => boolean}
 */
function createWwwCopyFilter(srcRoot) {
  return paketDisiListe.fsKopyaFiltresi(srcRoot, 'android');
}

module.exports = { createWwwCopyFilter };
