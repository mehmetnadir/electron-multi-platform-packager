'use strict';
/**
 * Ana süreç (paketin KENDİ main.js'i) denetimi.
 *
 * KÖR NOKTA (03.10, kasa ajanı şüphesi, dosya:satır kanıtlı): mac başsız kabulü Electron'u
 * `kosum/main.js` ile başlatır (basliksiz-kabul.js kosumCalistir) ve yalnız `<kök>/index.html`
 * yükler; paketin package.json "main" dosyası HİÇ yürütülmez. Paketin main.js'i SyntaxError
 * verse bile (Electron gerçek açılışta hata kutusunda bekler, pencere hiç açılmaz) koşum
 * GEÇTİ diyebilirdi. Bu denetim main.js'i yürütmeden DERLER (vm.Script, CommonJS sarmalı) ve
 * eksik/bozuk ise RED verir.
 *
 * Kapsam sınırı: yalnız sözdizimi + giriş dosyası varlığı. Çalışma zamanı hatası (eksik
 * require vb.) bu denetimin dışındadır. package.json yoksa ATLANDI (fikstür / android).
 * Android: APK'da Electron ana süreci yoktur (WebView), karşılığı cihaz katmanıdır → ATLANDI.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DURUM = Object.freeze({ GECTI: 'GECTI', RED: 'RED', ATLANDI: 'ATLANDI' });

/** Kaynak CommonJS olarak derlenir; çalıştırılmaz. Hata → mesaj, yoksa null. Saf. */
function derlemeHatasi(kaynak, ad) {
  const src = String(kaynak).replace(/^#!.*/, '');
  try {
    // eslint-disable-next-line no-new
    new vm.Script(`(function (exports, require, module, __filename, __dirname) {${src}\n})`, { filename: ad });
    return null;
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
}

/**
 * @param {(rel:string)=>(string|null)} oku  kök-göreli dosya okuyucu (yoksa null)
 * @param {{platform?:string}} [o]
 * @returns {{durum:string, sebepler:string[], giris:string|null}}
 */
function anaSurecKarari(oku, { platform = 'mac' } = {}) {
  if (platform === 'android') {
    return { durum: DURUM.ATLANDI, sebepler: ['android: Electron ana süreci yok (WebView)'], giris: null };
  }
  const pj = oku('package.json');
  if (pj === null) return { durum: DURUM.ATLANDI, sebepler: ['package.json yok'], giris: null };
  let main = 'index.js';
  try {
    const j = JSON.parse(pj);
    if (j && typeof j.main === 'string' && j.main) main = j.main;
    if (j && j.type === 'module') {
      return { durum: DURUM.ATLANDI, sebepler: ['type=module: derleme denetimi yok'], giris: main };
    }
  } catch (e) {
    return { durum: DURUM.RED, sebepler: [`package.json çözülemedi: ${e.message}`], giris: null };
  }
  const norm = path.posix.normalize(main.replace(/\\/g, '/').replace(/^\.\//, ''));
  const adaylar = path.posix.extname(norm) ? [norm] : [norm, `${norm}.js`, `${norm}/index.js`];
  for (const a of adaylar) {
    const kaynak = oku(a);
    if (kaynak === null) continue;
    const h = derlemeHatasi(kaynak, a);
    return h
      ? { durum: DURUM.RED, sebepler: [`ana süreç ${a} derlenmiyor (Electron hata kutusunda kalır): ${h}`], giris: a }
      : { durum: DURUM.GECTI, sebepler: [], giris: a };
  }
  return { durum: DURUM.RED, sebepler: [`package.json main "${main}" pakette yok`], giris: main };
}

/** Uygulama kökünden (dizin ya da asar) denetler. Saf değil (fs). */
function anaSurecDenetle(kok, asarMi, { platform = 'mac' } = {}) {
  let oku;
  if (asarMi) {
    // eslint-disable-next-line global-require
    const asar = require('@electron/asar');
    oku = (rel) => { try { return asar.extractFile(kok, rel).toString('utf8'); } catch (_) { return null; } };
  } else {
    oku = (rel) => { try { return fs.readFileSync(path.join(kok, rel), 'utf8'); } catch (_) { return null; } };
  }
  return anaSurecKarari(oku, { platform });
}

module.exports = { DURUM, derlemeHatasi, anaSurecKarari, anaSurecDenetle };
