'use strict';
/**
 * K8 — Ad deseninden BAĞIMSIZ, motor-imzasına göre "alt kitap" dizini bulucu.
 *
 * NEDEN: K3/K5'in `^book\d*$` regex'i yalnız Nadir'in kendi ürettiği/test ettiği
 * SET'lerde (book1, book2, ...) çalışıyordu. Tudem ISO'ları (`~/Downloads/tudem/*.iso`)
 * SET yapısını `fasikuller-01/`, `fasikul1/`, `d1-portfolyo/`, `e1-matematik/`,
 * `okula-basladim/` gibi TAMAMEN farklı adlı klasörlerle kuruyor — her biri TAM
 * Impark motoru (kendi `index.html` + `app.config.js`, `setBook.enable:true`).
 * BELİRTİ: `^book\d*$` regex'i bu adları hiç YAKALAMAZ → bu klasörler K3'ün
 * shim/manifest enjeksiyonundan ve K5'in setBook.enable zorlamasından tamamen
 * ATLANIR → Android'de aynı "process is not defined"/boş sayfa (K3 öncesi hâl).
 * KANIT: `bsdtar -xOf Bloktest_Okuma_Yazma_2023.iso resources/app/build/fasikuller-01/index.html`
 * → `<script src="app.config.js">` + engine bundle; `app.config.js` satır 229-230
 * `setBook: { enable: true`.
 *
 * Çözüm: AD DESENİ kullanma — "alt kitap" = kök İÇİNDE, kendi `index.html` VE
 * `app.config.js` dosyalarına birlikte sahip bir dizin (motor imzası: her kitap
 * bu iki dosyayı taşır, adı ne olursa olsun). Bir alt-kitap BULUNAN dizinin
 * ALTINA tekrar İNİLMEZ (kitap içindeki `core/`, `assets/` bir "iç içe alt kitap"
 * sanılmaz). `SKIP_DIR_NAMES` (kitap-içi destek dizinleri) hiçbir zaman taranmaz
 * — hem performans hem yanlış-pozitif önleme.
 *
 * BOZARSAN: bu dosyayı kaldırıp `^book\d` regex'ine geri dönersen
 * `sub-book-dirs.test.js`'teki `GERİLEME: ad deseni regex'ine dönülürse fasikül
 * dizinleri hiç bulunamaz` testi kırılır.
 */
const fs = require('fs-extra');
const path = require('path');

// Kitap-içi destek dizinleri — asla alt-kitap ADAYI olarak değerlendirilmez,
// altına ASLA inilmez (motor bundle'ının kendi iç yapısı, SET yapısı değil).
const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', 'assets', 'assets2', 'core',
  'classlibraries', 'temp', 'i18n', 'icons', '_graveyard',
]);

async function hasEngineSignature(absDir) {
  const [hasIndex, hasConfig] = await Promise.all([
    fs.pathExists(path.join(absDir, 'index.html')),
    fs.pathExists(path.join(absDir, 'app.config.js')),
  ]);
  return hasIndex && hasConfig;
}

/**
 * `rootPath` İÇİNDE (kök hariç) `index.html` + `app.config.js` ikilisine birlikte
 * sahip her dizini bulur. Kök-göreli, POSIX ayraçlı ('/'), sıralı bir dizi döner.
 * Bir alt-kitap bulunduğu anda o dizinin İÇİNE inilmez. `maxDepth` (varsayılan 2)
 * köke göre en fazla kaç seviye aşağı bakılacağını sınırlar (`x/y/index.html`
 * gibi iç içe SET'ler için 2 yeterli — bkz. Tudem `d1-portfolyo` gibi düz + olası
 * derin gruplamalar).
 *
 * @param {string} rootPath
 * @param {{ maxDepth?: number }} [opts]
 * @returns {Promise<string[]>}
 */
async function findSubBookDirs(rootPath, opts = {}) {
  const maxDepth = opts.maxDepth != null ? opts.maxDepth : 2;
  const results = [];

  async function walk(absDir, relDir, depth) {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (e) {
      return; // okunamayan dizin - sessizce atla (paketleme durmasın)
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || SKIP_DIR_NAMES.has(ent.name)) continue;
      const childAbs = path.join(absDir, ent.name);
      const childRel = relDir ? `${relDir}/${ent.name}` : ent.name;

      if (await hasEngineSignature(childAbs)) {
        results.push(childRel);
        continue; // alt-kitabın İÇİNE inilmez (kendi core/assets'i tekrar taranmaz)
      }
      if (depth < maxDepth) {
        await walk(childAbs, childRel, depth + 1);
      }
    }
  }

  await walk(rootPath, '', 1);
  results.sort();
  return results;
}

module.exports = { findSubBookDirs, hasEngineSignature, SKIP_DIR_NAMES };
