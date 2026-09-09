'use strict';
/**
 * K5 — SET paketlerinde her bookN/app.config.js'te `setBook.enable` false ise
 * true'ya çevirir.
 *
 * NEDEN: `setBook.enable` (main.js) kitap İÇİNDEN köke ("ana sayfa") dönüş
 * butonunun görünürlüğünü kontrol eder; yayıncı bazı bookN dosyalarında bunu
 * unutup `false` bırakabilir.
 * BELİRTİ: telefonda kitaba girince "ana sayfa" butonu hiç çıkmıyor — kullanıcı
 * sete geri dönemiyor.
 * KANIT: 2026-09-09, kitap 59480 "Flashy Grade 8 Set" — book1/book2'de
 * `setBook.enable: true` ama book3'te `false` (aynı kaynak dosyada üç kitaptan
 * biri unutulmuş). `vfs_59480.apk`/`vfs2_59480.apk` extraction'ında book3/
 * app.config.js'te `enable: true` olarak paketlendiği doğrulandı.
 *
 * Bu modül PLATFORMDAN BAĞIMSIZDIR — Android/Mac/Windows/Linux hepsi AYNI
 * workingPath'i (kaynak `build/` kökü) işler; tek ortak yerden (platform
 * dallanmasından ÖNCE) çağrılır, fan-out yok.
 *
 * Ayrıştırma: AppConfig'i eval ETMEZ (dosya `const AppConfig = {...}` + yorumlar
 * içerir, güvenli değil). Sadece `setBook: { ... }` bloğunun sınırlarını parantez
 * sayarak bulur, blok İÇİNDEKİ ilk `enable: false`'u `enable: true`'ya çevirir —
 * dosyadaki diğer `enable:` alanları (`bookModule.enable`, `externalbutton.enable`,
 * `exam.enable`) ve tüm yorumlar BİREBİR korunur.
 *
 * BOZARSAN: blok-sınırı algısını (parantez sayma) kaldırıp naif "dosya genelinde
 * ilk enable:false" regex'ine dönersen `set-book-home-button.test.js`'teki
 * `GERİLEME: blok sınırı kaldırılırsa naif regex bookModule.enable'i de bozar
 * (DLL aktivasyonu çöker)` testi kırılır.
 */
const fs = require('fs-extra');
const path = require('path');
const { findSubBookDirs } = require('./sub-book-dirs');

const APP_CONFIG_NAME = 'app.config.js';
// K8 (2026-09-09, Tudem kaniti): eskiden burada bookDirs ad deseniyle (`^book\d+$`)
// bulunuyordu — Tudem'in `fasikuller-01/`, `okula-basladim/` gibi adlari hic
// yakalanmiyordu. Artik `findSubBookDirs` (motor imzasi: index.html+app.config.js)
// kullanilir; BOOK_DIR_RE geriye-uyumluluk icin (dis kod referans ediyor olabilir)
// DEGERI DEGISMEDEN birakildi ama artik TARAMADA KULLANILMIYOR.
const BOOK_DIR_RE = /^book\d+$/i;

/**
 * `setBook: { ... }` bloğunun `{`/`}` sınırlarını (parantez sayarak, iç içe nesne
 * güvenli) bulur. Bulunamazsa null.
 * @returns {{ blockInnerStart: number, blockInnerEnd: number } | null}
 */
function findSetBookBlock(content) {
  const keyMatch = /setBook\s*:\s*\{/.exec(content);
  if (!keyMatch) return null;
  const braceStart = content.indexOf('{', keyMatch.index);
  let depth = 0;
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) return { blockInnerStart: braceStart + 1, blockInnerEnd: i };
    }
  }
  return null; // dengesiz parantez — dokunma
}

/**
 * @param {string} content - app.config.js tam içeriği
 * @returns {{ action: 'patched'|'already-true'|'no-setbook-block'|'no-enable-field', content: string }}
 */
function ensureSetBookEnabledInContent(content) {
  const block = findSetBookBlock(content);
  if (!block) return { action: 'no-setbook-block', content };

  const inner = content.slice(block.blockInnerStart, block.blockInnerEnd);
  const falseMatch = /enable\s*:\s*false/.exec(inner);
  if (falseMatch) {
    const patchedInner =
      inner.slice(0, falseMatch.index) +
      inner.slice(falseMatch.index, falseMatch.index + falseMatch[0].length).replace(/false$/, 'true') +
      inner.slice(falseMatch.index + falseMatch[0].length);
    const patched =
      content.slice(0, block.blockInnerStart) + patchedInner + content.slice(block.blockInnerEnd);
    return { action: 'patched', content: patched };
  }

  const trueMatch = /enable\s*:\s*true/.exec(inner);
  if (trueMatch) return { action: 'already-true', content };

  return { action: 'no-enable-field', content };
}

/**
 * @param {string} rootPath - web build kökü (workingPath) — platformdan önce, TEK SEFER çağrılır.
 * @returns {Promise<{ isSet: boolean, books: Array<{ book: string, action: string, path: string }> }>}
 */
async function ensureSetBookHomeButton(rootPath) {
  const bookDirs = await findSubBookDirs(rootPath, { maxDepth: 2 }).catch(() => []);

  if (bookDirs.length === 0) {
    return { isSet: false, books: [] };
  }

  const results = [];
  for (const book of bookDirs) {
    // K9e (2026-09-09, K9b/K9d ile AYNI desen) — NEDEN: bu döngü de try/catch'siz
    // idi; bir kitabın app.config.js'i EACCES/ENOENT verirse TÜM fonksiyon
    // (results dahil) çağırana fırlar, kalan alt-kitaplar setBook.enable=true
    // yamasını hiç ALMAZ. Pratikte K9c (`ensureWritableTree`) bu adımdan ÖNCE
    // çalıştığı için risk zaten düşük, ama savunma amaçlı (defense-in-depth,
    // her öğe kendi hatasından sorumlu) burada da izole edildi.
    try {
      const cfgPath = path.join(rootPath, book, APP_CONFIG_NAME);
      if (!(await fs.pathExists(cfgPath))) {
        results.push({ book, action: 'no-config-file', path: cfgPath });
        continue;
      }
      const original = await fs.readFile(cfgPath, 'utf8');
      const { action, content: patched } = ensureSetBookEnabledInContent(original);
      if (action === 'patched') {
        await fs.writeFile(cfgPath, patched);
      }
      // 'already-true' / 'no-setbook-block' / 'no-enable-field' → dosyaya YAZILMAZ
      // (idempotent — mtime değişmez).
      results.push({ book, action, path: cfgPath });
    } catch (bookErr) {
      results.push({ book, action: 'error', error: bookErr.message, path: path.join(rootPath, book, APP_CONFIG_NAME) });
    }
  }

  return { isSet: true, books: results };
}

module.exports = {
  ensureSetBookHomeButton,
  ensureSetBookEnabledInContent,
  findSetBookBlock,
  APP_CONFIG_NAME,
  BOOK_DIR_RE,
};
