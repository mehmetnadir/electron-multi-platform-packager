'use strict';

/**
 * PAKETE GİRMEYECEKLER — TEK KAYNAK, DÖRT PLATFORM (Nadir, 2026-09-26).
 *
 * > "diğer os'ların paketlerini üretirken windows paketinde uyguladığımız gereksizleri
 * > atma politikasını onlarda da uygulamalıyız."
 *
 * BELİRTİ (26.09 ölçümü): liste her platformda ELLE yazılmıştı ve ayrışmıştı —
 * Windows `files` dizisi `build/` ve `**\/temp/data/storage.im`'i dışlıyordu, macOS ve
 * Linux/Pardus dışlamıyordu; Android'in `www` kopyası yalnız `node_modules` + `.git`'i
 * dışlıyordu (kök `temp/`, `uploads/`, `build/`, `storage.im` APK'ya giriyordu).
 *
 * TEK TANIM: aşağıdaki `MADDELER`. İki tüketici biçimi AYNI maddelerden türetilir:
 *   · `elektronBuilderDesenleri(platform)` → windows/macos/linux `files` dizileri
 *     (electron-builder glob'ları; `packagingService.js` üç config'te de bunu yayar).
 *   · `fsKopyaFiltresi(srcRoot, platform)` → Android'in iki `fs.copy` çağrısı
 *     (`www-copy-exclude.js` → `createWwwCopyFilter` bunu sarar).
 * Kopya liste YASAK: bir platform kendi listesini yazarsa `paket-disi-liste.test.js`
 * sözleşme testi düşer (fan-out sapması, memory: `purge-listesi-iki-yerde`).
 *
 * PLATFORM MUAFİYETİ: bir madde bir platformda kırılma riski taşırsa o maddenin
 * `platformlar` alanından çıkarılır ve `muafiyet` alanına ÖLÇÜLMÜŞ gerekçesi yazılır.
 * 26.09 denetiminde muafiyet çıkmadı — her maddenin dört platformdaki kanıtı kendi
 * `gerekce` alanında.
 *
 * KAPSAM SINIRI — yalnız KÖK ya da tam desen:
 *   · `temp`, `uploads`, `build` yalnız KÖK segmentte eşleşir. `bookN/build/…`,
 *     `core/uploads/…`, `bookN/temp/…` (storage.im hariç) içerik olabilir, dokunulmaz.
 *   · `storage.im` yalnız `…/temp/data/storage.im` tam kuyruğuyla eşleşir.
 *
 * BİLİNEN, ÖLÇÜLMÜŞ İKİ BİÇİM FARKI (davranışı bu modül değiştirmez):
 *   · `node_modules` ve `.git`: Android süzgeci HER DERİNLİKTE dışlar (2026-09-09
 *     `www-copy-exclude.js` kararı). electron-builder'da iç içe olanları kendi
 *     varsayılanı dışlar (`app-builder-lib/out/fileMatcher.js` `getMainFileMatchers`:
 *     `!**\/node_modules/**`; `excludedNames` içinde `.git`) — sonuç aynı.
 *   · Kök `_x.js` gibi `_` önekli DOSYA: electron-builder `!_*` onu da dışlar
 *     (FileMatcher ile ölçüldü), Android süzgeci yalnız DİZİNLERİ dışlar
 *     (`kok-yedek-dizin-disla.js` sınırı). 26.09'da önbellekteki altı kaynakta
 *     (`~/.empp-agent/cache/*\/build.zip`) kökte `_` önekli girdi SIFIR.
 */

const path = require('path');
const kokYedekDizinDisla = require('./kok-yedek-dizin-disla');

const PLATFORMLAR = Object.freeze(['windows', 'macos', 'linux', 'android']);
const ELEKTRON_PLATFORMLARI = Object.freeze(['windows', 'macos', 'linux']);

/**
 * Her madde:
 *   ad          — kısa kimlik (test/rapor).
 *   desenler    — electron-builder `files` glob'ları (sıra korunur).
 *   yolEslesir  — (parcalar, { dizinMi }) → bool; `parcalar` kök-göreli yol segmentleri.
 *   platformlar — maddenin UYGULANDIĞI platformlar.
 *   gerekce     — neden dışlanır + platform güvenlik kanıtı.
 */
const MADDELER = Object.freeze([
  Object.freeze({
    ad: 'node_modules',
    desenler: Object.freeze(['!node_modules']),
    yolEslesir: (p) => p.includes('node_modules'),
    platformlar: PLATFORMLAR,
    gerekce: '`prepareElectronFiles` workingPath köküne `npm install` ile Electron kurar '
      + '(Mac APK 678 MB sızıntı, 2026-09-09). Uygulama bağımlılığı değil.',
  }),
  Object.freeze({
    ad: '.git',
    desenler: Object.freeze([]), // electron-builder `excludedNames` zaten dışlar
    yolEslesir: (p) => p.includes('.git'),
    platformlar: PLATFORMLAR,
    gerekce: 'Sürüm denetimi artığı; electron-builder varsayılanı zaten dışlar.',
  }),
  Object.freeze({
    ad: 'temp',
    desenler: Object.freeze(['!temp']),
    yolEslesir: (p) => p[0] === 'temp',
    platformlar: PLATFORMLAR,
    gerekce: 'Kök `temp/` iki şeydir: (a) göreli çıktı yolunda electron-builder\'ın KENDİ '
      + 'çıktısı (`app/temp/<job>/windows`, packagingService "Çıktı dosyasını bul"; bir '
      + 'ağaçta 1,8 GB — set-kabuk.js), (b) tek kitapta yayıncının kullanıcı verisi '
      + '(`temp/data/storage.im`). Motor dosyayı yoksa kendisi oluşturur.',
  }),
  Object.freeze({
    ad: 'uploads',
    desenler: Object.freeze(['!uploads']),
    yolEslesir: (p) => p[0] === 'uploads',
    platformlar: PLATFORMLAR,
    gerekce: 'Paketleyicinin yükleme dizini adı; motor yerel `uploads/` okumaz (tek '
      + 'geçiş uzak URL, 59835 `book1/electron.js`).',
  }),
  Object.freeze({
    ad: 'build',
    desenler: Object.freeze(['!build']),
    yolEslesir: (p) => p[0] === 'build',
    platformlar: PLATFORMLAR,
    gerekce: 'NSIS artefaktları (`createCustomInstallationFiles`, `getValidWindowsIcon`) '
      + 'buraya yazılır. electron-builder buildResources\'ı DİSKTEN okur (`readdir`/'
      + '`path.join(buildResourcesDir)`, files deseninden bağımsız); mac entitlements, '
      + 'ikon ve dmg arka planı `build/` dışından mutlak yolla gelir.',
  }),
  Object.freeze({
    ad: 'storage.im',
    desenler: Object.freeze(['!**/temp/data/storage.im']),
    yolEslesir: (p) => p.length >= 3
      && p[p.length - 3] === 'temp' && p[p.length - 2] === 'data'
      && p[p.length - 1] === 'storage.im',
    platformlar: PLATFORMLAR,
    gerekce: 'Windows sözleşmesi G2: yayıncının KENDİ makinesindeki kullanıcı verisi '
      + '(ayarlar, son sayfa, tur tamamlandı). Motor `existsSync||saveStorage({})` ile '
      + 'yoksa oluşturur; yazma mac/linux/windows\'ta fs-shim ile WORK\'e, Android\'de '
      + 'empp-android-shim VFS\'ine gider.',
  }),
  Object.freeze({
    ad: 'kok-yedek',
    desenler: Object.freeze(kokYedekDizinDisla.elektronBuilderDesenleri()),
    yolEslesir: (p, { dizinMi } = {}) => kokYedekDizinDisla.kokYedekDizinAdiMi(p[0])
      && (p.length > 1 || dizinMi === true),
    platformlar: PLATFORMLAR,
    gerekce: '`_` önekli kök yedek dizinleri (`_eski/`) — tanım `kok-yedek-dizin-disla.js`.',
  }),
]);

function platformDogrula(platform) {
  if (!PLATFORMLAR.includes(platform)) {
    throw new Error(`paket-disi-liste: bilinmeyen platform "${platform}" `
      + `(${PLATFORMLAR.join('/')})`);
  }
}

/** Platforma UYGULANAN maddeler (sıra korunur). */
function maddeler(platform) {
  platformDogrula(platform);
  return MADDELER.filter((m) => m.platformlar.includes(platform));
}

/**
 * electron-builder `files` dizisine YAYILACAK dışlama desenleri. Çağıran diziyi
 * `"**\/*"` ile başlatır; platforma özgü GERİ-ALMA desenleri (ör. mac/linux
 * `node_modules/adm-zip`) bu yayılımdan SONRA gelmelidir (electron-builder son
 * eşleşeni uygular).
 * @param {'windows'|'macos'|'linux'} platform
 * @returns {string[]}
 */
function elektronBuilderDesenleri(platform) {
  if (!ELEKTRON_PLATFORMLARI.includes(platform)) {
    throw new Error('paket-disi-liste: electron-builder desenleri yalnız '
      + `${ELEKTRON_PLATFORMLARI.join('/')} için`);
  }
  return maddeler(platform).flatMap((m) => m.desenler);
}

/**
 * Kök-göreli yol (POSIX ya da yerel ayraç) dışlanır mı? Saf — disk okumaz;
 * `_` kök dizin maddesi için tür bilgisi `dizinMi` ile verilir.
 * @param {string} rel
 * @param {'windows'|'macos'|'linux'|'android'} platform
 * @param {{dizinMi?: boolean}} [secenek]
 * @returns {string|null} dışlayan maddenin adı, dışlanmıyorsa null
 */
function dislayanMadde(rel, platform, secenek = {}) {
  const parcalar = String(rel || '').split(/[\\/]+/).filter((s) => s && s !== '.');
  if (parcalar.length === 0) return null;
  const m = maddeler(platform).find((x) => x.yolEslesir(parcalar, secenek));
  return m ? m.ad : null;
}

/**
 * `fs.copy(src, dest, { filter })` için yüklem. Kaynak kökün kendisi daima geçer.
 * Tür bilgisi yalnız gerektiğinde (tek segmentlik `_` önekli kök girdisi) diskten
 * okunur; stat başarısızsa YANLIŞ dışlama yapılmaz.
 * @param {string} srcRoot
 * @param {'android'|'windows'|'macos'|'linux'} [platform='android']
 * @returns {(src: string) => boolean}
 */
function fsKopyaFiltresi(srcRoot, platform = 'android') {
  platformDogrula(platform);
  const kokFiltresi = kokYedekDizinDisla.fsCopyFiltresi(srcRoot);
  const kokYedekVar = maddeler(platform).some((m) => m.ad === 'kok-yedek');
  const listeFiltresi = (src) => {
    const rel = path.relative(srcRoot, src);
    if (!rel || rel === '.') return true;
    // `_` kök maddesi aşağıda kok-yedek-dizin-disla'nın kendi (stat'lı) süzgecine
    // bırakılır; burada dizinMi verilmez → yalnız `_x/…` içerikleri eşleşir.
    return dislayanMadde(rel, platform) === null;
  };
  return kokYedekVar
    ? kokYedekDizinDisla.birlesikFiltre(listeFiltresi, kokFiltresi)
    : listeFiltresi;
}

module.exports = {
  PLATFORMLAR,
  MADDELER,
  maddeler,
  elektronBuilderDesenleri,
  dislayanMadde,
  fsKopyaFiltresi,
};
