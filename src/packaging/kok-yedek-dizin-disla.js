'use strict';

/**
 * KÖK YEDEK DİZİN DIŞLAMASI — TÜM PLATFORMLAR (Windows sözleşmesi, "Üretimi
 * etkilemeyen açık işler" madde 5 — 2026-09-26).
 *
 * BELİRTİ: kaynak build kökünde `_` ile başlayan yedek/arşiv dizinleri (ör.
 * SM2 zip'indeki `_eski/`) paketleme yoluna (electron-builder `files` —
 * windows/macOS/linux-pardus — ve Android'in `fs.copy`'si) HİÇ dışlanmadan
 * giriyordu: boyutu şişiriyor ve eski kabuğu (menü/motor sürümü) pakete
 * sızdırıyordu. `set-kabuk.js`'in GÜNCELLEME kanalı beyaz listesi bunları
 * zaten dışlıyordu (`YEDEK_DIZIN_DESENI`, kanal SET güncellemesinde hangi
 * dosyaların indirileceğine karar verir) ama İLK PAKETLEME (build'in kendisi,
 * bu dosya) TAMAMEN AYRI bir kod yoludur — o dışlamayı hiç görmüyordu.
 *
 * TEK TANIM: desen `set-kabuk.js`'in `YEDEK_DIZIN_DESENI`'nden (BİREBİR `/^_/`)
 * alınır, kopya regex YAZILMAZ — ayrışırlarsa `kok-yedek-dizin-disla.test.js`
 * içindeki sözleşme testi düşer (fan-out sapması, memory: `purge-listesi-iki-yerde`).
 *
 * SINIR: yalnız KÖK düzeyinde, yalnız DİZİN.
 *   · `bookN/_x` gibi kitap İÇİ `_` önekli dosya/dizinlere (motor dosyaları
 *     `_` ile başlayabilir) DOKUNULMAZ — her iki yardımcı da yalnız yolun
 *     İLK (kök) segmentine bakar.
 *   · Kökteki `_x.js` gibi bir DOSYA (dizin değil) dışlanmaz — yalnız dizinler
 *     hedeftir (`fsCopyFiltresi` kök segmentte `isDirectory()` doğrular).
 *
 * İKİ TÜKETİCİ BİÇİMİ (paketleme iki farklı kopyalama motoru kullanıyor):
 *   · electron-builder `files` dizisi (windows/macOS/linux-pardus, glob string)
 *     → `elektronBuilderDesenleri()`.
 *   · `fs.copy({filter})` (Android `packageAndroid`/`initializeCapacitorProject`)
 *     → `fsCopyFiltresi(srcRoot)`.
 */

const fs = require('fs');
const path = require('path');
const { YEDEK_DIZIN_DESENI } = require('./set-kabuk');

/** Bir KÖK dizin adı (yol değil, yalnız ad) yedek/arşiv mi? Saf. */
function kokYedekDizinAdiMi(ad) {
  return typeof ad === 'string' && YEDEK_DIZIN_DESENI.test(ad);
}

/**
 * electron-builder `files` dizisine EKLENECEK iki desen: kök girdisinin
 * kendisi + recursive içeriği.
 *
 * NEDEN İKİ AYRI DESEN: `_*` glob karakteri (`*`) taşıdığı için electron-builder
 * `FileMatcher` yalnız nokta/glob-karakteri İÇERMEYEN düz adlara (ör.
 * `node_modules`) otomatik `/**\/*` ekliyor (bkz. `app-builder-lib/out/fileMatcher.js`
 * `computeParsedPatterns`) — `_*` bu otomatik genişlemeyi ALMAZ, o yüzden içerik
 * deseni burada elle eklenir. İkisi de yalnız KÖK'e bağlıdır (minimatch, `**`
 * içermeyen tek segmentlik desen yalnız kök-göreli tam eşleşmeyi yakalar) —
 * `book1/_x` gibi iç içe yollarla eşleşmez.
 * @returns {string[]}
 */
function elektronBuilderDesenleri() {
  return ['!_*', '!_*/**/*'];
}

/**
 * `fs.copy(src, dest, { filter })` için filtre üretir. Yalnız yolun İLK
 * (kök) segmentine bakar — derinlik farketmez, karar İLK segmentte verilir:
 * `_eski/a/b.js` dışlanır (kök segmenti `_eski`), `book1/_x.js` dışlanmaz
 * (kök segmenti `book1`, `_` ile başlamıyor). Kök segmentin KENDİSİ (uzunluk
 * 1 — yani girdi doğrudan `srcRoot` altında) yalnız DİZİNSE dışlanır; aynı
 * adı taşıyan bir kök DOSYA (`_x.js`) dokunulmaz kalır.
 * @param {string} srcRoot
 * @returns {(src: string) => boolean}
 */
function fsCopyFiltresi(srcRoot) {
  return (src) => {
    const rel = path.relative(srcRoot, src);
    if (!rel || rel === '.') return true;
    const parcalar = rel.split(path.sep);
    const kok = parcalar[0];
    if (!kokYedekDizinAdiMi(kok)) return true;
    if (parcalar.length > 1) return false; // "_eski/..." içeriği — kök zaten dizin olmak zorunda
    try {
      return !fs.statSync(src).isDirectory();
    } catch {
      return true; // stat başarısızsa (ör. sembolik bağ koptu) YANLIŞ dışlama yapma
    }
  };
}

/** Birden çok `fs.copy` filtresini VE (AND) ile birleştirir — her ikisi de
 * true dönerse dosya kopyalanır. Saf; sıra önemsiz (kısa devre soldan sağa). */
function birlesikFiltre(...filtreler) {
  const gecerliler = filtreler.filter((f) => typeof f === 'function');
  return (src) => gecerliler.every((f) => f(src));
}

module.exports = {
  kokYedekDizinAdiMi,
  elektronBuilderDesenleri,
  fsCopyFiltresi,
  birlesikFiltre,
};
