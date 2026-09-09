'use strict';
// K9c (2026-09-09, tudem-apk-batch/coordinator K10 kanıtı) — `ensureWritableTree`
// gerçekten dosya sistemiyle doğrular.
//
// Olay zinciri: Bloktest_Okuma_Yazma_2023.iso (Tudem, gerçek) bsdtar ile
// çıkarıldığında TÜM index.html dosyaları 0400 (salt-okunur) kalıyor. K9b'nin
// per-alt-kitap try/catch'i "bir kitabın hatası diğerlerini durdurması" (domino)
// sorununu kapattı, ama kök nedeni (dosyaların gerçekten yazılamaz olması)
// çözmedi: gerçek ISO ağacında 27/27 alt-kitap `empp-android-shim.js` DOSYASINI
// aldı (fs.copy yeni dosya oluşturur, dizin-yazma izni yeter) ama 0/27 script
// tag aldı (var olan dosyaya yazma dosya-izni ister). Bu fonksiyon çalışma
// kopyasını (workingPath) `fs.copy(buildPath, workingPath)`'ten HEMEN SONRA
// sahibine yazılabilir yapar - böylece hiçbir sonraki adım izin sorunuyla
// karşılaşmaz. KANIT: bu testte aynı senaryo (0400 dosyalar) tekrarlanır.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { ensureWritableTree } = require('./ensure-writable');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-writable-test-'));
}

test('(a) salt-okunur (0400) dosya yazılabilir hale gelir', async () => {
  const root = tempDir();
  const f = path.join(root, 'index.html');
  await fs.writeFile(f, '<html></html>');
  fs.chmodSync(f, 0o400);

  await ensureWritableTree(root);

  // Artık yazılabilir olmalı (chmod EACCES vermeden gerçek yazma dener).
  await fs.writeFile(f, '<html>degisti</html>');
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '<html>degisti</html>');
});

test('(b) çok sayıda (8) alt-kitap dizini, HEPSİ yazılabilir hale gelir', async () => {
  const root = tempDir();
  for (let i = 1; i <= 8; i++) {
    const d = path.join(root, 'fasikuller-' + String(i).padStart(2, '0'));
    await fs.ensureDir(d);
    const f = path.join(d, 'index.html');
    await fs.writeFile(f, '<html></html>');
    fs.chmodSync(f, 0o400);
  }

  await ensureWritableTree(root);

  for (let i = 1; i <= 8; i++) {
    const f = path.join(root, 'fasikuller-' + String(i).padStart(2, '0'), 'index.html');
    // EACCES firlatmadan yazabiliyor olmali.
    await fs.writeFile(f, 'yazildi');
    assert.strictEqual(fs.readFileSync(f, 'utf8'), 'yazildi', `${f} hala salt-okunur kalmis olabilir`);
  }
});

test('(c) dönüş değeri düzeltilen dosya/dizin sayısını verir', async () => {
  const root = tempDir();
  const f1 = path.join(root, 'a.html');
  const f2 = path.join(root, 'b.html');
  await fs.writeFile(f1, 'x');
  await fs.writeFile(f2, 'y'); // bu zaten yazilabilir - fixed sayilmamali
  fs.chmodSync(f1, 0o400);

  const fixed = await ensureWritableTree(root);
  assert.ok(fixed >= 1, 'en az f1 icin bir duzeltme sayilmali');
});

test('(d) zaten yazılabilir bir ağaçta hiçbir şey bozulmaz (regresyon)', async () => {
  const root = tempDir();
  await fs.ensureDir(path.join(root, 'book1'));
  await fs.writeFile(path.join(root, 'book1', 'index.html'), '<html>orijinal</html>');

  await ensureWritableTree(root);

  assert.strictEqual(
    fs.readFileSync(path.join(root, 'book1', 'index.html'), 'utf8'),
    '<html>orijinal</html>',
    'icerik degismemeli, sadece izinler'
  );
});

test('(e) gerçek Bloktest ISO ağacı (varsa) - chmod öncesi/sonrası tam işleme kanıtı', async (t) => {
  const packagingService = require('./packagingService');
  const fixtureRoot = path.join(
    '/private/tmp/claude-501/-Users-nadir/006cff11-8d65-4460-944b-a19c21ec727c/scratchpad',
    'tudem-fixture', 'resources', 'app', 'build'
  );
  if (!fs.existsSync(fixtureRoot)) {
    t.skip('gercek Tudem ISO fixture bu makinede yok - atlaniyor');
    return;
  }
  const root = tempDir();
  fs.removeSync(root);
  fs.copySync(fixtureRoot, root); // mode korunur (kaynak 0400 -> kopya da 0400)

  await ensureWritableTree(root);
  await packagingService.normalizeBookViewerViewports(root);

  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'app.config.js')) && fs.existsSync(path.join(root, e.name, 'index.html')));
  assert.ok(dirs.length >= 25, `en az 25 alt-kitap bulunmali, bulunan: ${dirs.length}`);

  let taggedCount = 0;
  for (const d of dirs) {
    const html = fs.readFileSync(path.join(root, d.name, 'index.html'), 'utf8');
    if (html.includes('empp-android-shim.js')) taggedCount++;
  }
  assert.strictEqual(taggedCount, dirs.length, `ensureWritableTree SONRASI HER alt-kitap tag almali - ${taggedCount}/${dirs.length}`);
});

// --- Mutasyon kaniti ---
test('GERİLEME: ensureWritableTree çağrılmazsa gerçek ISO ağacında HİÇBİR alt-kitap tag almaz', async (t) => {
  const packagingService = require('./packagingService');
  const fixtureRoot = path.join(
    '/private/tmp/claude-501/-Users-nadir/006cff11-8d65-4460-944b-a19c21ec727c/scratchpad',
    'tudem-fixture', 'resources', 'app', 'build'
  );
  if (!fs.existsSync(fixtureRoot)) {
    t.skip('gercek Tudem ISO fixture bu makinede yok - atlaniyor');
    return;
  }
  const root = tempDir();
  fs.removeSync(root);
  fs.copySync(fixtureRoot, root); // mode korunur, ensureWritableTree ÇAĞRILMIYOR (kanıt için)

  await packagingService.normalizeBookViewerViewports(root);

  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, 'app.config.js')) && fs.existsSync(path.join(root, e.name, 'index.html')));
  let taggedCount = 0;
  for (const d of dirs) {
    const html = fs.readFileSync(path.join(root, d.name, 'index.html'), 'utf8');
    if (html.includes('empp-android-shim.js')) taggedCount++;
  }
  assert.strictEqual(taggedCount, 0, 'ensureWritableTree ATLANIRSA gercek ISO agacinda hicbir tag alinamaz (kanitin gucu)');
});

// --- Kaynak-sentinel ---
test('kaynak-sentinel: startPackaging fs.copy(buildPath, workingPath) SONRASINDA ensureWritableTree çağırır', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const copyIdx = src.indexOf('await fs.copy(buildPath, workingPath);');
  const ensureIdx = src.indexOf('await ensureWritableTree(workingPath);');
  assert.notStrictEqual(copyIdx, -1);
  assert.notStrictEqual(ensureIdx, -1);
  assert.ok(ensureIdx > copyIdx, 'ensureWritableTree fs.copy SONRASINDA cagrilmali');
});
