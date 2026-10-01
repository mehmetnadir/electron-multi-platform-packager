'use strict';
// KARANTİNA — ölü koda bağlı olduğu için canlı test dosyalarından çıkarılan testler (2026-10-01).
// Çalıştırılamaz (bağlam: runner.test.js / runner-pardus.test.js başlıkları). Kalıcı silme: 2026-11-30.

// ===== src/agent/runner.test.js (touchCacheEntry + pruneSiblingVersions testleri) =====
test('touchCacheEntry mtime i tazeler — TTL temizleyicisinin baktığı işaret', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cache-touch-'));
  try {
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000); // 30 gün önce
    await fsp.utimes(dir, old, old);
    assert.ok(Date.now() - (await fsp.stat(dir)).mtimeMs > 20 * 24 * 3600 * 1000);

    assert.strictEqual(await touchCacheEntry(dir), true);

    assert.ok(Date.now() - (await fsp.stat(dir)).mtimeMs < 5000); // tazelendi
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('touchCacheEntry olmayan dizinde FIRLATMAZ — üretim durmaz', async () => {
  assert.strictEqual(await touchCacheEntry('/tmp/kesinlikle-olmayan-dizin-38471'), false);
});

test('eski sürüm cache budayıcısı (yardımcı) kardeş dizinleri siler, mevcut sürümü korur', () => {
  // Yardımcı tanımlı kalır (exe'siz sözleşmeyle processJob artık çağırmıyor — yukarıdaki test).
  const fn = SRC.slice(SRC.indexOf('async function pruneSiblingVersions'),
    SRC.indexOf('async function pruneSiblingVersions') + 700);
  assert.match(fn, /readdir\(bookDir/);
  assert.match(fn, /e\.name === keepVersion/);        // mevcut sürümü koru
  assert.match(fn, /fsp\.rm\([^)]*recursive: true, force: true/); // gerisini sil
});


// ===== src/agent/runner-pardus.test.js (hazır-yol parçası, 'kapı HER İKİ yolda' testinin ilk yarısı) =====
test('GERİLEME: kapı HER İKİ yolda da (derleme + hazır paket) artifact kopyalandıktan SONRA koşar', () => {
  const fn = SRC.slice(SRC.indexOf('async function buildPardusArtifact'), SRC.indexOf('async function pardusKabulKapisi'));
  // Hazır (srv21) yolu: kopyala → kapı → return
  const hazirBas = fn.indexOf('const hazir = await hazirPardusPaketi');
  const hazirKopya = fn.indexOf('await fsp.copyFile(hazir.dosya, artifactPath)');
  const hazirKapi = fn.indexOf('await pardusKabulKapisi(artifactPath, outDir', hazirBas);
  assert.ok(hazirBas !== -1 && hazirKopya !== -1 && hazirKapi > hazirKopya, 'hazır yolda kapı kopyalamadan sonra olmalı');


// ===== src/agent/runner-pardus.test.js ('hazır paket kaynağı ANCAK kabul kapısından sonra silinir') =====
// Hazır kaynak SİLME sırası (2026-09-17, 45695 kaybı): kapı GEÇMEDEN silinirse,
// srv21'deki iş dizini de temizlenmiş olduğu için paket tamamen kaybolur.
test('hazır paket kaynağı ANCAK kabul kapısından sonra silinir', () => {
  const kaynak = require('fs').readFileSync(require('path').join(__dirname, 'runner.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const kapiIdx = kaynak.indexOf('await pardusKabulKapisi(artifactPath, outDir');
  const silIdx = kaynak.indexOf('await fsp.rm(hazir.dosya');
  assert.ok(kapiIdx > 0 && silIdx > 0, 'kapı/silme satırları bulunamadı');
  assert.ok(silIdx > kapiIdx, 'silme kapıdan SONRA olmalı');
});

