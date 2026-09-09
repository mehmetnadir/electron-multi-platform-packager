'use strict';
// K9 (2026-09-09, Pardus/.impark kaniti) — `injectFsShimIntoSubBooks` GERCEKTEN
// dosya sistemiyle dogrular. Kanit: kitap 59480 .impark'ta PRACTICE BOOK "Kitap
// Guncelleniyor %10"da takildi, book3 loader'da takildi. Konsol:
//   ENOENT, book1/assets/56385/update.zip not found in .../app.asar (createWriteStream)
//   ENOENT book3/temp/data/storage.im not found in .../app.asar
// Kok neden: fs-shim.js yalniz kok index.html'e enjekte ediliyordu; alt-kitap
// sayfalarinin __dirname'i KENDI dizinleri oldugu icin (Electron renderer) shim
// hic devreye girmiyordu -> tum fs yazmalari salt-okunur app.asar'a gidiyordu.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { injectFsShimIntoSubBooks } = require('./fs-shim-subbook-inject');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fs-shim-subbook-test-'));
}

async function makeBookDir(root, relPath) {
  const abs = path.join(root, relPath);
  await fs.ensureDir(abs);
  await fs.writeFile(path.join(abs, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body>book</body></html>');
  await fs.writeFile(path.join(abs, 'app.config.js'), 'const AppConfig = {};');
}

test('(a) book1/index.html goreli src (../) + __emppSubBook alir', async () => {
  const root = tempDir();
  await makeBookDir(root, 'book1');

  const results = await injectFsShimIntoSubBooks(root);

  assert.deepStrictEqual(results, [{ book: 'book1', action: 'injected', relShimSrc: '../empp-fs-shim.js' }]);
  const html = fs.readFileSync(path.join(root, 'book1', 'index.html'), 'utf8');
  assert.match(html, /<script>window\.__emppSubBook="book1";<\/script>/);
  assert.match(html, /<script src="\.\.\/empp-fs-shim\.js"><\/script>/);
});

test('(b) derinlik-2 (sets/a) icin goreli src ../../ olur', async () => {
  const root = tempDir();
  await fs.ensureDir(path.join(root, 'sets')); // imza tasimiyor
  await makeBookDir(root, 'sets/a');

  const results = await injectFsShimIntoSubBooks(root);

  const r = results.find((x) => x.book === 'sets/a');
  assert.strictEqual(r.action, 'injected');
  assert.strictEqual(r.relShimSrc, '../../empp-fs-shim.js');
  const html = fs.readFileSync(path.join(root, 'sets', 'a', 'index.html'), 'utf8');
  assert.match(html, /<script>window\.__emppSubBook="sets\/a";<\/script>/);
  assert.match(html, /<script src="\.\.\/\.\.\/empp-fs-shim\.js"><\/script>/);
});

test('(c) Tudem-tarzi ad (fasikuller-01) da enjekte edilir (ad deseni degil imza)', async () => {
  const root = tempDir();
  await makeBookDir(root, 'fasikuller-01');

  const results = await injectFsShimIntoSubBooks(root);

  assert.strictEqual(results[0].book, 'fasikuller-01');
  assert.strictEqual(results[0].action, 'injected');
});

test('(d) ikinci calistirma idempotent: HTML sabit, tek script/tek degisken', async () => {
  const root = tempDir();
  await makeBookDir(root, 'book1');

  await injectFsShimIntoSubBooks(root);
  const first = fs.readFileSync(path.join(root, 'book1', 'index.html'), 'utf8');
  const secondResults = await injectFsShimIntoSubBooks(root);
  const second = fs.readFileSync(path.join(root, 'book1', 'index.html'), 'utf8');

  assert.strictEqual(first, second, 'ikinci calistirma HTML\'i degistirmemeli');
  assert.strictEqual(secondResults[0].action, 'already-injected');
  const shimCount = (second.match(/empp-fs-shim\.js/g) || []).length;
  assert.strictEqual(shimCount, 1, 'shim referansi TEK olmali (idempotent)');
  const varCount = (second.match(/__emppSubBook/g) || []).length;
  assert.strictEqual(varCount, 1, '__emppSubBook degiskeni TEK olmali (idempotent)');
});

test('(e) tek kitap kokunde (alt kitap yok) sonuc BOS, dosyaya dokunulmaz', async () => {
  const root = tempDir();
  await fs.writeFile(path.join(root, 'index.html'), '<html></html>');
  await fs.writeFile(path.join(root, 'app.config.js'), 'const AppConfig = {};');

  const results = await injectFsShimIntoSubBooks(root);

  assert.deepStrictEqual(results, []);
  const content = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.strictEqual(content, '<html></html>', 'kok index.html bu fonksiyonun sorumlulugunda degil');
});

test('(f) index.html eksik alt-kitapta no-index donuyor, hata firlatmiyor', async () => {
  const root = tempDir();
  await fs.ensureDir(path.join(root, 'book1'));
  await fs.writeFile(path.join(root, 'book1', 'app.config.js'), 'const AppConfig = {};');
  // index.html YOK -> findSubBookDirs bunu ZATEN alt-kitap saymaz (motor imzasi
  // eksik) - bu durumda sonuc BOS olmali, no-index dallanmasi PRATIKTE tetiklenmez
  // (savunma amaçlı, dosya calistirma arasinda silinirse diye).
  const results = await injectFsShimIntoSubBooks(root);
  assert.deepStrictEqual(results, []);
});

test('(g) Tudem olcegi (8 alt-kitap) HEPSI enjekte edilir - TAM sayi, "≥1" degil', async () => {
  const root = tempDir();
  for (let i = 1; i <= 8; i++) {
    await makeBookDir(root, 'fasikuller-' + String(i).padStart(2, '0'));
  }

  const results = await injectFsShimIntoSubBooks(root);

  assert.strictEqual(results.length, 8, 'findSubBookDirs 8 dizini de bulmali');
  const injectedCount = results.filter((r) => r.action === 'injected').length;
  assert.strictEqual(injectedCount, 8, 'HER 8 alt-kitap da injected olmali (yalnizca ilk degil)');
  for (let i = 1; i <= 8; i++) {
    const d = 'fasikuller-' + String(i).padStart(2, '0');
    const html = fs.readFileSync(path.join(root, d, 'index.html'), 'utf8');
    assert.ok(html.includes('empp-fs-shim.js'), `${d} shim referansi almali`);
    assert.match(html, new RegExp(`window\\.__emppSubBook="${d}"`));
  }
});

// --- K9d (2026-09-09, tudem-apk-batch domino kaniti) ---
test('GERİLEME: bir alt-kitabın index.html\'i EACCES verirse DİĞERLERİ yine de enjekte edilir (domino etkisi)', async () => {
  const root = tempDir();
  for (let i = 1; i <= 4; i++) {
    await makeBookDir(root, 'book' + i);
  }
  const book1Idx = path.join(root, 'book1', 'index.html');
  fs.chmodSync(book1Idx, 0o400);
  let results;
  try {
    results = await injectFsShimIntoSubBooks(root);
  } finally {
    fs.chmodSync(book1Idx, 0o644);
  }

  const book1Result = results.find((r) => r.book === 'book1');
  assert.strictEqual(book1Result.action, 'error', 'book1 EACCES ile basarisiz OLMALI (beklenen)');

  // book2/3/4 (book1'den SONRA islenen) domino ile durdurulmamali.
  for (const b of ['book2', 'book3', 'book4']) {
    const r = results.find((x) => x.book === b);
    assert.strictEqual(r.action, 'injected', `${b} book1'in hatasindan ETKILENMEMELI`);
    const html = fs.readFileSync(path.join(root, b, 'index.html'), 'utf8');
    assert.ok(html.includes('empp-fs-shim.js'), `${b} shim almali (domino YOK)`);
  }
});

// --- Mutasyon kaniti ---
test('GERİLEME: alt-kitap enjeksiyonu kaldırılırsa fs-shim yalnız kökte kalır (asar\'a yazma riski geri döner)', async () => {
  const root = tempDir();
  await makeBookDir(root, 'book1');

  // Bozuk (K9-oncesi) davranisin dogrudan simulasyonu: HICBIR enjeksiyon yapılmaz.
  const beforeHtml = fs.readFileSync(path.join(root, 'book1', 'index.html'), 'utf8');
  assert.ok(!beforeHtml.includes('empp-fs-shim.js'), 'enjeksiyondan ONCE shim yok (kanitin gucu)');

  // Gercek (duzeltilmis) davranis bunun onune gecer:
  await injectFsShimIntoSubBooks(root);
  const afterHtml = fs.readFileSync(path.join(root, 'book1', 'index.html'), 'utf8');
  assert.ok(afterHtml.includes('empp-fs-shim.js'), 'enjeksiyondan SONRA shim var');
});

// --- Kaynak-sentinel ---
test('kaynak-sentinel: packagingService.js prepareElectronFiles icinde injectFsShimIntoSubBooks cagirir', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.match(src, /injectFsShimIntoSubBooks\(appPath\)/);
  // Kok enjeksiyonundan (empp-fs-shim.js index.html'e enjekte edildi) SONRA cagrilmali.
  const rootIdx = src.indexOf("empp-fs-shim.js index.html\\'e enjekte edildi");
  const subBookIdx = src.indexOf('injectFsShimIntoSubBooks(appPath)');
  assert.notStrictEqual(rootIdx, -1);
  assert.notStrictEqual(subBookIdx, -1);
  assert.ok(subBookIdx > rootIdx, 'alt-kitap enjeksiyonu kok enjeksiyonundan SONRA calismali');
});

test('kaynak-sentinel (K9d): for dongusu icinde alt-kitaba OZEL try/catch var - domino korumasi', () => {
  const src = fs.readFileSync(path.join(__dirname, 'fs-shim-subbook-inject.js'), 'utf8');
  const forIdx = src.indexOf('for (const relBookDir of subBookDirs)');
  const tryIdx = src.indexOf('try {', forIdx);
  const catchIdx = src.indexOf("catch (bookErr)", forIdx);
  assert.notStrictEqual(forIdx, -1);
  assert.notStrictEqual(tryIdx, -1, 'for dongusu icinde bir try{ olmali');
  assert.notStrictEqual(catchIdx, -1, "catch (bookErr) olmali - tek kitabin hatasi digerlerini durdurmasin");
  assert.ok(tryIdx > forIdx && catchIdx > tryIdx);
});
