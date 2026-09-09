'use strict';
/**
 * K9 — SET paketlerinin alt-kitap sayfalarına (findSubBookDirs) `empp-fs-shim.js`
 * (Electron renderer fs yönlendirme shim'i) referansı + kendi ad-alanı enjekte eder.
 *
 * NEDEN: Electron renderer'da BASE (fs-shim.js `install()`'daki `__dirname`) her
 * SAYFANIN KENDİ dizinidir — kök `index.html` için `<appPath>`, `book1/index.html`
 * için `<appPath>/book1`. Shim yalnız KÖK index.html'e enjekte edildiği için
 * alt-kitabın `window.require('fs')` çağrıları GERÇEK (sarılmamış) `fs`'e düşüyordu
 * — tüm yazmalar salt-okunur `app.asar`'a gidiyordu.
 * BELİRTİ (Pardus/.impark, Docker sanal ekran, kitap 59480): PRACTICE BOOK
 * çevrimiçi "Kitap Güncelleniyor %10"da takıldı, book3 loader'da takıldı. Konsol:
 * `ENOENT, book1/assets/56385/update.zip not found in .../app.asar` (createWriteStream),
 * `ENOENT book3/temp/data/storage.im not found in .../app.asar`. `~/.config/<app>/work/`
 * hiç oluşmadı.
 * KANIT: 2026-09-09, kayıt `.../scratchpad/apk-test/pardus/` (console-book*.log, kareler).
 *
 * Çözüm: shim dosyası TEK KOPYA kökte kalır (kopyalanmaz) — her alt-kitap sayfasına
 * derinliğine göre GÖRELİ `<script src>` ('../', '../../') ile referans verilir;
 * Electron `file://` altında script src sayfanın KENDİ konumuna göre çözülür.
 * Ayrıca sayfanın ad-alanını (`relBookDir`) `window.__emppSubBook`'a yazan bir
 * inline script enjekte edilir — `fs-shim.js` `install()` bunu okuyup WORK
 * dizinini buna göre önekler (aksi halde K6 sınıfı çapraz-kitap çarpışması: book1
 * ile book3 AYNI `WORK/temp/data/storage.im`'i paylaşır). Kök sayfada bu değişken
 * YOK — WORK eski davranışla BİREBİR aynı kalır (regresyon yok).
 *
 * BOZARSAN: `fs-shim-subbook-inject.test.js`'teki GERİLEME testleri kırılır.
 */
const fs = require('fs-extra');
const path = require('path');
const { findSubBookDirs } = require('./sub-book-dirs');

/**
 * @param {string} appPath - Electron uygulamasının kök dizini (kök index.html'in
 *   yanındaki dizin; kök shim enjeksiyonu bu fonksiyonun DIŞINDA yapılır).
 * @returns {Promise<Array<{ book: string, action: 'injected'|'already-injected'|'no-index' }>>}
 */
async function injectFsShimIntoSubBooks(appPath) {
  const subBookDirs = await findSubBookDirs(appPath, { maxDepth: 2 });
  const results = [];

  for (const relBookDir of subBookDirs) {
    // K9d (2026-09-09, tudem-apk-batch/K9c ile AYNI sınıf) — NEDEN: bu döngü
    // hiçbir try/catch ile SARILMAMIŞTI; bir alt-kitabın index.html'i
    // okunamaz/yazılamaz olursa (EACCES, ENOENT) hata ÇAĞIRANA (prepareElectronFiles
        // tek genel catch'i) kadar fırlar ve `results` hiç dönmeden kalan TÜM
        // alt-kitaplar hiç işlenmeden bırakılır — packagingService.js'deki
        // normalizeBookViewerViewports'un AYNI domino kusuru (K9b). BOZARSAN:
        // `fs-shim-subbook-inject.test.js`'teki GERİLEME domino testi kırılır.
    try {
      const bookIndexPath = path.join(appPath, relBookDir, 'index.html');
      if (!(await fs.pathExists(bookIndexPath))) {
        results.push({ book: relBookDir, action: 'no-index' });
        continue;
      }
      let bookHtml = await fs.readFile(bookIndexPath, 'utf8');
      const depth = relBookDir.split('/').length;
      const relShimSrc = '../'.repeat(depth) + 'empp-fs-shim.js';
      const subBookVar = `<script>window.__emppSubBook=${JSON.stringify(relBookDir)};</script>`;
      const shimTag = `<script src="${relShimSrc}"></script>`;

      let toInject = '';
      if (!bookHtml.includes('window.__emppSubBook')) toInject += subBookVar;
      if (!bookHtml.includes('empp-fs-shim.js')) toInject += (toInject ? '\n' : '') + shimTag;

      if (!toInject) {
        results.push({ book: relBookDir, action: 'already-injected' });
        continue;
      }

      bookHtml = bookHtml.includes('<head>')
        ? bookHtml.replace('<head>', '<head>' + toInject)
        : toInject + bookHtml;
      await fs.writeFile(bookIndexPath, bookHtml);
      results.push({ book: relBookDir, action: 'injected', relShimSrc });
    } catch (bookErr) {
      results.push({ book: relBookDir, action: 'error', error: bookErr.message });
    }
  }

  return results;
}

module.exports = { injectFsShimIntoSubBooks };
