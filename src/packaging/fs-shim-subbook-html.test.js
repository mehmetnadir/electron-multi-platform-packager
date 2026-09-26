'use strict';
// Alt-kitap fs-shim etiketi — SAF tek kaynak (`fs-shim-subbook-html.js`). Paketleyici
// (`injectFsShimIntoSubBooks`) ve G yayın aracı (`tools/g-yayin/yayinla.js`) aynı fonksiyonu
// çağırır; bu dosya biçimi, idempotentliği ve paketleyicinin diskte ürettiğiyle BİREBİR
// eşliği çiviler (G ile eklenen kitap paketlenmiş kitapla aynı sayfayı taşımalı).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  FS_SHIM_FILE,
  existingSubBook,
  injectFsShimIntoSubBookHtml,
} = require('./fs-shim-subbook-html');
const { injectFsShimIntoSubBooks } = require('./fs-shim-subbook-inject');

const SAYFA = '<!doctype html><html><head><meta charset="utf-8"></head><body>kitap</body></html>';

test('book4: iki etiket <head> hemen ardına, göreli ../empp-fs-shim.js', () => {
  const r = injectFsShimIntoSubBookHtml(SAYFA, 'book4');
  assert.equal(r.changed, true);
  assert.equal(r.relShimSrc, '../empp-fs-shim.js');
  assert.equal(
    r.html,
    '<!doctype html><html><head><script>window.__emppSubBook="book4";</script>\n' +
      '<script src="../empp-fs-shim.js"></script><meta charset="utf-8"></head><body>kitap</body></html>',
  );
  assert.equal(FS_SHIM_FILE, 'empp-fs-shim.js');
});

test('derinlik-2 (sets/a) → ../../; <head> yoksa başa eklenir', () => {
  const r = injectFsShimIntoSubBookHtml('<html><body>x</body></html>', 'sets/a');
  assert.equal(r.relShimSrc, '../../empp-fs-shim.js');
  assert.ok(r.html.startsWith('<script>window.__emppSubBook="sets/a";</script>\n<script src="../../empp-fs-shim.js"></script><html>'));
});

test('idempotent: ikinci çağrı değiştirmez; parça parça eksik olan tamamlanır', () => {
  const bir = injectFsShimIntoSubBookHtml(SAYFA, 'book4');
  const iki = injectFsShimIntoSubBookHtml(bir.html, 'book4');
  assert.equal(iki.changed, false);
  assert.equal(iki.html, bir.html);
  assert.equal(iki.existingSubBook, 'book4');
  // Yalnız shim etiketi varsa yalnız değişken eklenir.
  const yarim = SAYFA.replace('<head>', '<head><script src="../empp-fs-shim.js"></script>');
  const t = injectFsShimIntoSubBookHtml(yarim, 'book4');
  assert.equal(t.changed, true);
  assert.equal(t.html.split(FS_SHIM_FILE).length - 1, 1);
  assert.ok(t.html.includes('window.__emppSubBook="book4"'));
});

test('existingSubBook: yazılı değeri okur; yoksa null; `$` desenleri güvenli', () => {
  assert.equal(existingSubBook('<script>window.__emppSubBook="book2";</script>'), 'book2');
  assert.equal(existingSubBook('<script>window.__emppSubBook = "a\\"b";</script>'), 'a"b');
  assert.equal(existingSubBook(SAYFA), null);
  const r = injectFsShimIntoSubBookHtml(SAYFA, "x$&y$'z");
  assert.ok(r.html.includes('window.__emppSubBook="x$&y$\'z"'), r.html);
});

test('paketleyiciyle BİREBİR: injectFsShimIntoSubBooks diskte aynı baytı yazar', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-shim-html-'));
  for (const d of ['book1', 'sets/a']) {
    fs.mkdirSync(path.join(kok, d), { recursive: true });
    fs.writeFileSync(path.join(kok, d, 'index.html'), SAYFA);
    fs.writeFileSync(path.join(kok, d, 'app.config.js'), 'const AppConfig = {};');
  }
  const sonuc = await injectFsShimIntoSubBooks(kok);
  assert.deepEqual(sonuc.map((r) => r.action).sort(), ['injected', 'injected']);
  for (const d of ['book1', 'sets/a']) {
    assert.equal(
      fs.readFileSync(path.join(kok, d, 'index.html'), 'utf8'),
      injectFsShimIntoSubBookHtml(SAYFA, d).html,
      d,
    );
  }
});
