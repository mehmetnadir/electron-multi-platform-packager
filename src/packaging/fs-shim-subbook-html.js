'use strict';
/**
 * Alt-kitap sayfasına (`bookN/index.html`) fs-shim etiketlerini enjekte eden SAF fonksiyon —
 * TEK KAYNAK. İki kullanıcısı var, ikisi de BUNU çağırır (kopya kural yok):
 *   1) Paketleyici — `fs-shim-subbook-inject.js` `injectFsShimIntoSubBooks` (paketleme anı, K9).
 *   2) G yayın aracı — `tools/g-yayin/yayinla.js` `kitapArsiviHazirla` (G ile EKLENEN kitabın
 *      arşivi, 2026-09-26).
 *
 * NEDEN (2): mac/Pardus örtüsünde (ve Windows yerinde uygulamada) G ile eklenen kitap
 * paketleme anında pakette YOKTU, dolayısıyla `bookN/index.html`'i shim almamıştı. Kitap
 * okuyucusu dosyalarını renderer'da `window.require('fs')` ile okur (BookContent.xml, kapak
 * readdir, imKeys.dll); shim yüklenmeyince okuma örtüden (9529d11, WORK → ÖRTÜ → paket)
 * geçmez → ENOENT, yazma da salt-okunur pakete gider. Arşivdeki index.html paketleyicinin
 * koyacağı etiketin AYNISINI, aynı yerde taşımalı.
 *
 * Enjekte edilenler (K9 — ayrıntı `fs-shim-subbook-inject.js`):
 *   - `<script>window.__emppSubBook="<relBookDir>";</script>` — WORK ad-alanı (K6 çarpışması).
 *   - `<script src="../empp-fs-shim.js"></script>` — derinliğe göre GÖRELİ; shim tek kopya kökte.
 * İDEMPOTENT: her parça ayrı denetlenir; ikisi de varsa HTML'e dokunulmaz (`changed:false`).
 *
 * Bağımlılık YOK (stdlib bile) — g-yayin "Node stdlib dışında bağımlılık yok" kuralına uyar.
 * BOZARSAN: `fs-shim-subbook-html.test.js`, `fs-shim-subbook-inject.test.js` ve
 * `tools/g-yayin/yayinla.test.js`'teki fs-shim testleri kırılır.
 */

const FS_SHIM_FILE = 'empp-fs-shim.js';
const SUB_BOOK_VAR = 'window.__emppSubBook';
const SUB_BOOK_VALUE_RE = /window\.__emppSubBook\s*=\s*("(?:[^"\\]|\\.)*")/;

/** Sayfada zaten yazılı `__emppSubBook` değeri; yoksa ya da okunamıyorsa null. */
function existingSubBook(html) {
  const m = SUB_BOOK_VALUE_RE.exec(String(html));
  if (!m) return null;
  try {
    const v = JSON.parse(m[1]);
    return typeof v === 'string' ? v : null;
  } catch (e) {
    return null;
  }
}

/**
 * @param {string} html - alt-kitap sayfasının içeriği
 * @param {string} relBookDir - uygulama köküne göre alt-kitap dizini ('book4', 'sets/a')
 * @returns {{ html: string, changed: boolean, relShimSrc: string, existingSubBook: string|null }}
 */
function injectFsShimIntoSubBookHtml(html, relBookDir) {
  const src = String(html);
  const dir = String(relBookDir);
  const depth = dir.split('/').length;
  const relShimSrc = '../'.repeat(depth) + FS_SHIM_FILE;
  const subBookVar = `<script>${SUB_BOOK_VAR}=${JSON.stringify(dir)};</script>`;
  const shimTag = `<script src="${relShimSrc}"></script>`;
  const mevcut = existingSubBook(src);

  let toInject = '';
  if (!src.includes(SUB_BOOK_VAR)) toInject += subBookVar;
  if (!src.includes(FS_SHIM_FILE)) toInject += (toInject ? '\n' : '') + shimTag;

  if (!toInject) return { html: src, changed: false, relShimSrc, existingSubBook: mevcut };

  const out = src.includes('<head>')
    ? src.replace('<head>', () => '<head>' + toInject)
    : toInject + src;
  return { html: out, changed: true, relShimSrc, existingSubBook: mevcut };
}

module.exports = { FS_SHIM_FILE, SUB_BOOK_VAR, existingSubBook, injectFsShimIntoSubBookHtml };
