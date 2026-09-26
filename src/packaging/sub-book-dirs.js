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

/**
 * `findSubBookDirs`'in ARŞİV (asar/zip listPackage tarzı) ikizi — GERÇEK bir dizin
 * yoksa (örn. `@electron/asar` `listPackage()` bütün arşivi ZATEN düz, tekrarlı bir
 * yol dizisi olarak döndürür) `fs.readdir` çağrılamaz. Aynı K8 kuralını (motor imzası:
 * kök-göreli bir dizinin kendi `index.html` VE `app.config.js` dosyalarına BİRLİKTE
 * sahip olması, bulunan dizinin İÇİNE inilmemesi, `SKIP_DIR_NAMES` hiç aday sayılmaması)
 * salt dizi işlemleriyle uygular. Tüketici: `tools/kabul/paket-cikar.js` `kokEnvanteri()`
 * (asar-modu) — dizin modu ise gerçek fs kullandığından burada AYNI algoritma dosya
 * listesi üstünden tekrarlanır (bkz. çağıran taraf).
 *
 * BOZARSAN: ad desenine (`^book\d+$`) dönersen `sub-book-dirs.test.js`'teki K8
 * regresyon testi VE `tools/kabul/yardimcilar.test.js`'teki eşdeğer test kırılır.
 *
 * @param {string[]} allRelPaths kök-göreli, POSIX ayraçlı dosya (ve/veya dizin) yolları
 *   — asar `listPackage()` çıktısı gibi TÜM ağacı düz listeleyen bir kaynak.
 * @param {{ maxDepth?: number }} [opts] `findSubBookDirs` ile aynı anlam.
 * @returns {string[]} sıralı, kök-göreli motor-imzalı dizin yolları
 */
function findEngineDirsInPathList(allRelPaths, opts = {}) {
  const maxDepth = opts.maxDepth != null ? opts.maxDepth : 2;
  const dosyalar = new Set(
    (allRelPaths || []).map((p) => String(p).replace(/\\/g, '/').replace(/^\/+/, '')).filter(Boolean),
  );

  // 1) Kök hariç, en fazla maxDepth seviye derinlikteki TÜM dizin adaylarını topla
  //    (bir dosyanın üst yol parçalarından türetilir — gerçek readdir yok).
  const adaylar = new Set();
  for (const p of dosyalar) {
    const parcalar = p.split('/');
    const derinlikSiniri = Math.min(maxDepth, parcalar.length - 1);
    for (let d = 1; d <= derinlikSiniri; d += 1) adaylar.add(parcalar.slice(0, d).join('/'));
  }

  // 2) SKIP_DIR_NAMES'te geçen HERHANGİ bir yol parçasını taşıyan adayı ele — gerçek
  //    walk() bu dizinlerin İÇİNE hiç inmediği için onların altındaki hiçbir şey aday
  //    OLAMAZ.
  const gecerliAdaylar = [...adaylar].filter(
    (d) => !d.split('/').some((parca) => SKIP_DIR_NAMES.has(parca)),
  );

  // 3) Motor imzası: aday/index.html VE aday/app.config.js birlikte var mı?
  const imzali = gecerliAdaylar.filter(
    (d) => dosyalar.has(`${d}/index.html`) && dosyalar.has(`${d}/app.config.js`),
  );

  // 4) Bulunan bir dizinin İÇİNE inilmez — kendisinden daha derin, onu önek olarak
  //    taşıyan başka bir "bulunan" varsa (kitabın kendi core/assets'i içinde tesadüfen
  //    aynı ikili bulunsa bile) o iç sonuç ELENİR.
  const sonuc = imzali.filter(
    (d) => !imzali.some((digeri) => digeri !== d && d.startsWith(`${digeri}/`)),
  );
  sonuc.sort();
  return sonuc;
}

module.exports = {
  findSubBookDirs, findEngineDirsInPathList, hasEngineSignature, SKIP_DIR_NAMES,
};
