'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');
const { turet, acikSurumMu, icerikParmakIzi, VARSAYILAN_DAMGA } = require('./surum-turet');

// ---------------------------------------------------------------------------
// SÜRÜM TÜRETME (2026-09-22, Nadir onayı — ölçülen arıza)
//
// Ölçüm: `.sm4-k*-uret.js` üretim tetikleyicileri appVersion'ı HER ZAMAN
// '1.0.0' gönderiyordu; bu değer package.json'a yazılıp NSIS DisplayVersion
// olarak kaydediliyor, customInit "zaten kurulu VE aynı DisplayVersion" ise
// kurulumu atlayıp eski exe'yi açıyor. Yeni içerikli her paket bu tuzağa
// düşüyordu (Super Monsters 4, jobId ae2bf715, 2026-09-21).
//
// Bu testler mutasyonla kanıtlıdır: `acikSurumMu`'daki '1.0.0' özel durumunu
// veya `turet`teki dallanmayı bozarsan (örn. her zaman 'acik' dönerse, veya
// hash yerine sabit bir sürüm dönerse) aşağıdaki assertion'lar düşer.
// ---------------------------------------------------------------------------

async function gecici(icerik) {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-surum-'));
  for (const [rel, veri] of Object.entries(icerik)) {
    const tamYol = path.join(kok, rel);
    await fs.ensureDir(path.dirname(tamYol));
    await fs.writeFile(tamYol, veri);
  }
  return kok;
}

test('acikSurumMu: boş/null/undefined/1.0.0 kasıtlı DEĞİL sayılır', () => {
  assert.strictEqual(acikSurumMu(undefined), false);
  assert.strictEqual(acikSurumMu(null), false);
  assert.strictEqual(acikSurumMu(''), false);
  assert.strictEqual(acikSurumMu('   '), false);
  assert.strictEqual(acikSurumMu('1.0.0'), false);
  assert.strictEqual(acikSurumMu(VARSAYILAN_DAMGA), false);
});

test('acikSurumMu: 1.0.0 dışında herhangi bir değer kasıtlı sayılır', () => {
  assert.strictEqual(acikSurumMu('2.3.4'), true);
  assert.strictEqual(acikSurumMu('1.13.8'), true);
  assert.strictEqual(acikSurumMu('1.0.1'), true);
  assert.strictEqual(acikSurumMu(1), true); // '1' !== '1.0.0'
});

test('turet: çağıran açık sürüm verdiyse DOKUNULMAZ, içerik hiç okunmaz', async () => {
  const kok = await gecici({ 'a.txt': 'icerik-1' });
  const sonuc = turet('3.7.2', kok);
  assert.strictEqual(sonuc.surum, '3.7.2');
  assert.strictEqual(sonuc.kaynak, 'acik');
  await fs.remove(kok);
});

test('turet: appVersion verilmediyse (undefined) içerikten türetilir', async () => {
  const kok = await gecici({ 'a.txt': 'icerik-1' });
  const sonuc = turet(undefined, kok);
  assert.strictEqual(sonuc.kaynak, 'icerik-hash');
  assert.match(sonuc.surum, /^1\.\d+\.\d+$/);
  await fs.remove(kok);
});

test('turet: appVersion tam olarak 1.0.0 ise içerikten türetilir (ÖLÇÜLEN ARIZA)', async () => {
  const kok = await gecici({ 'a.txt': 'icerik-1', 'b/c.txt': 'başka içerik' });
  const sonuc = turet('1.0.0', kok);
  assert.strictEqual(sonuc.kaynak, 'icerik-hash');
  // Arızanın ta kendisi: türetilen sürüm asla sabit '1.0.0' OLMAMALI.
  assert.notStrictEqual(sonuc.surum, '1.0.0');
  await fs.remove(kok);
});

test('turet: AYNI içerik AYNI sürümü üretir (deterministik — customInit davranışı korunur)', async () => {
  const kok1 = await gecici({ 'index.html': '<html></html>', 'assets/x.js': 'var x=1;' });
  const kok2 = await gecici({ 'index.html': '<html></html>', 'assets/x.js': 'var x=1;' });
  const s1 = turet('1.0.0', kok1);
  const s2 = turet('1.0.0', kok2);
  assert.strictEqual(s1.surum, s2.surum, 'aynı yol+boyut kümesi farklı sürüm üretmemeli');
  await fs.remove(kok1);
  await fs.remove(kok2);
});

test('turet: FARKLI içerik (farklı boyut) FARKLI sürüm üretir', async () => {
  const kok1 = await gecici({ 'index.html': '<html></html>' });
  const kok2 = await gecici({ 'index.html': '<html>tamamen farklı ve daha uzun içerik</html>' });
  const s1 = turet(undefined, kok1);
  const s2 = turet(undefined, kok2);
  assert.notStrictEqual(s1.surum, s2.surum);
  await fs.remove(kok1);
  await fs.remove(kok2);
});

test('turet: sürüm her zaman semver-uyumlu (üç nokta-ayraçlı, negatif olmayan tam sayı)', async () => {
  const kok = await gecici({ 'set/index.html': 'x', 'set/book1/main.js': 'y'.repeat(500) });
  const sonuc = turet('', kok);
  const parcalar = sonuc.surum.split('.');
  assert.strictEqual(parcalar.length, 3);
  for (const p of parcalar) {
    assert.match(p, /^\d+$/, `parça sayısal olmalı: ${p}`);
  }
  await fs.remove(kok);
});

test('turet: AYNI BOYUTLU tek-bayt içerik değişimi FARKLI sürüm üretir '
  + '(Şef düzeltmesi 2026-09-22 — yol+boyut deliği kapandı)', async () => {
  // ÖLÇÜLEN İKİZ ARIZA: version.txt "1.13.8"→"1.13.9" veya index.html'de tek
  // karakter — ikisi de AYNI BOYUTTA. Yalnız yol+boyul kullanan eski parmak izi
  // bunu YAKALAYAMAZ, customInit yine "aynı sürüm" görüp kurulumu atlardı.
  const kok1 = await gecici({ 'version.txt': '1.13.8', 'index.html': '<p>X</p>' });
  const kok2 = await gecici({ 'version.txt': '1.13.9', 'index.html': '<p>X</p>' });
  assert.strictEqual(
    fs.statSync(path.join(kok1, 'version.txt')).size,
    fs.statSync(path.join(kok2, 'version.txt')).size,
    'test öncülü: iki dosya AYNI boyutta olmalı'
  );
  const s1 = turet(undefined, kok1);
  const s2 = turet(undefined, kok2);
  assert.notStrictEqual(s1.surum, s2.surum,
    'aynı boyutlu ama farklı İÇERİKLİ dosya farklı sürüm üretmeli — bu test, ' +
    'icerikParmakIzi içeriği okumayı bırakıp yalnız boyuta dönerse (mutasyon) DÜŞER.');
  await fs.remove(kok1);
  await fs.remove(kok2);
});

test('turet: eşik ÜSTÜ (>4MB) dosyada içerik değişse de boyut aynıysa sürüm AYNI kalır '
  + '(kasıtlı — büyük dosyada I/O maliyeti kabul edilemez)', async () => {
  const { ICERIK_ESIK_BAYT } = require('./surum-turet');
  const boyut = ICERIK_ESIK_BAYT + 1024;
  const kok1 = await gecici({});
  const kok2 = await gecici({});
  await fs.writeFile(path.join(kok1, 'video.mp4'), Buffer.alloc(boyut, 0xaa));
  await fs.writeFile(path.join(kok2, 'video.mp4'), Buffer.alloc(boyut, 0xbb));
  const s1 = turet(undefined, kok1);
  const s2 = turet(undefined, kok2);
  assert.strictEqual(s1.surum, s2.surum,
    'eşik üstü dosyalarda içerik okunmaz — bu, tasarımın kabul ettiği bilinen sınırdır');
  await fs.remove(kok1);
  await fs.remove(kok2);
});

test('turet: AYNI workingPath + paketleyici KAYNAĞINDA tek bayt değişikliği '
  + 'FARKLI sürüm üretir (Şef düzeltmesi 2026-09-22 — üçüncü kardeş arıza: '
  + 'aynı zip + değişmiş paketleyici kodu/kapısı → customInit yeni paketi de atlıyordu)', async () => {
  const kok = await gecici({ 'a.txt': 'sabit-icerik-degismedi' });
  // src/packaging/ altına GEÇİCİ bir dosya — jsDosyalariniTara onu da tarar
  // (üretim dosyalarına DOKUNULMAZ, kendi geçici dosyamızı ekleyip sonda sileriz).
  const gecici_dosya = path.join(__dirname, '.surum-turet-test-gecici.js');
  const icerikA = "module.exports = { deger: 0 };\n"; // 'A'
  const icerikB = "module.exports = { deger: 1 };\n"; // tek karakter farklı, AYNI uzunlukta
  assert.strictEqual(icerikA.length, icerikB.length, 'test öncülü: tek bayt farkı, aynı uzunluk');
  try {
    await fs.writeFile(gecici_dosya, icerikA);
    const s1 = turet(undefined, kok, {});
    await fs.writeFile(gecici_dosya, icerikB);
    const s2 = turet(undefined, kok, {});
    assert.notStrictEqual(s1.surum, s2.surum,
      'paketleyici KAYNAK KODU tek bayt değişince sürüm de değişmeli — ' +
      'paketleyiciKaynakParmakIzi devre dışı bırakılırsa (mutasyon) bu test DÜŞER.');
  } finally {
    await fs.remove(gecici_dosya);
    await fs.remove(kok);
  }
});

test('turet: AYNI workingPath + EMPP_SAYFA_WEBP 0→1 FARKLI sürüm üretir '
  + '(kapı bayrağı üretim davranışını değiştirir — parmak izine dahil olmalı)', async () => {
  const kok = await gecici({ 'a.txt': 'sabit-icerik-degismedi-2' });
  const s1 = turet(undefined, kok, { EMPP_SAYFA_WEBP: '0' });
  const s2 = turet(undefined, kok, { EMPP_SAYFA_WEBP: '1' });
  assert.notStrictEqual(s1.surum, s2.surum,
    'EMPP_SAYFA_WEBP 0→1 üretim davranışını (PNG↔WebP) değiştirir; sürüm de değişmeli — ' +
    'kapilarParmakIzi devre dışı bırakılırsa (mutasyon) bu test DÜŞER.');
  await fs.remove(kok);
});

test('icerikParmakIzi: boş/erişilemeyen dizin hata fırlatmadan sonuç döner', () => {
  const hash = icerikParmakIzi(path.join(os.tmpdir(), 'empp-surum-yok-' + Date.now()));
  assert.strictEqual(typeof hash, 'string');
  assert.strictEqual(hash.length, 64); // sha256 hex
});

test('turet: dosya taşınırsa (yeniden adlandırılırsa) sürüm değişir', async () => {
  const kok1 = await gecici({ 'kitap1.pdf': 'sabit-icerik-aaaa' });
  const kok2 = await gecici({ 'kitap2.pdf': 'sabit-icerik-aaaa' });
  const s1 = turet(undefined, kok1);
  const s2 = turet(undefined, kok2);
  assert.notStrictEqual(s1.surum, s2.surum, 'yol da parmak izine dahil olmalı');
  await fs.remove(kok1);
  await fs.remove(kok2);
});
