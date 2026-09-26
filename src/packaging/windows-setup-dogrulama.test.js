'use strict';

/**
 * `windows-setup-dogrulama.js` testleri — açık iş 2 (2026-09-26) katman (b) +
 * hazırlık adımı. Bkz. modülün başlığı için tam bağlam.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');

const mod = require('./windows-setup-dogrulama');

async function gecici() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'empp-wsd-'));
}

test('beklenenDosyaAdi: productName-version-Setup.exe, boşluklar korunur (electron-builder artifactName ile birebir)', () => {
  assert.strictEqual(
    mod.beklenenDosyaAdi('Super Monsters 4', '1.13.8'),
    'Super Monsters 4-1.13.8-Setup.exe'
  );
});

test('dogrula: taze mtime + beklenen ad -> tamam:true', async () => {
  const dizin = await gecici();
  const yol = path.join(dizin, 'X-1.0.0-Setup.exe');
  await fs.writeFile(yol, 'icerik');
  const derlemeBaslangici = Date.now() - 100; // dosya bundan sonra yazıldı
  const sonuc = await mod.dogrula(yol, 'X', '1.0.0', derlemeBaslangici);
  assert.deepStrictEqual(sonuc, { tamam: true });
});

test('GERİLEME: ESKİ dosya (mtime derleme başlangıcından ÖNCE) reddedilir — tam da bildirilen belirti', async () => {
  const dizin = await gecici();
  const yol = path.join(dizin, 'X-1.0.0-Setup.exe');
  await fs.writeFile(yol, 'icerik');
  // Dosyayı "eski" yap: mtime'ı 30 sn geriye çek.
  const eskiMs = Date.now() - 30000;
  await fs.utimes(yol, eskiMs / 1000, eskiMs / 1000);
  const derlemeBaslangici = Date.now(); // derleme dosyadan SONRA "başladı"
  const sonuc = await mod.dogrula(yol, 'X', '1.0.0', derlemeBaslangici);
  assert.strictEqual(sonuc.tamam, false);
  assert.match(sonuc.hata, /ÖNCE üretilmiş/);
  assert.match(sonuc.hata, /silinmedi/);
});

test('dogrula: yanlış ad (beklenen sürümü taşımıyor) reddedilir', async () => {
  const dizin = await gecici();
  const yol = path.join(dizin, 'X-0.0.1-Setup.exe'); // appVersion 1.0.0 bekleniyor
  await fs.writeFile(yol, 'icerik');
  const sonuc = await mod.dogrula(yol, 'X', '1.0.0', Date.now() - 100);
  assert.strictEqual(sonuc.tamam, false);
  assert.match(sonuc.hata, /beklenen sürümü taşımıyor/);
  assert.match(sonuc.hata, /X-1\.0\.0-Setup\.exe/);
});

test('dogrula: dosya yoksa erişim hatasıyla reddedilir', async () => {
  const dizin = await gecici();
  const yol = path.join(dizin, 'yok-Setup.exe');
  const sonuc = await mod.dogrula(yol, 'X', '1.0.0', Date.now());
  assert.strictEqual(sonuc.tamam, false);
  assert.match(sonuc.hata, /erişilemedi/);
});

test('dogrula: mtime toleransı — küçük negatif sapma (dosya sistemi yuvarlaması) kabul edilir', async () => {
  const dizin = await gecici();
  const yol = path.join(dizin, 'X-1.0.0-Setup.exe');
  await fs.writeFile(yol, 'icerik');
  const simdi = Date.now();
  // Dosya "derleme başlangıcından" 500 ms önce yazılmış GÖRÜNÜYOR (tolerans içinde).
  await fs.utimes(yol, (simdi - 500) / 1000, (simdi - 500) / 1000);
  const sonuc = await mod.dogrula(yol, 'X', '1.0.0', simdi);
  assert.strictEqual(sonuc.tamam, true);
});

test('MUTASYON KANITI (elle): mtime kontrolü kaldırılırsa yukarıdaki GERİLEME testi düşer', () => {
  // Bu test kod değişikliği gerektirmez — kanıt gerekçesini burada belgeler.
  // Mutasyon: `dogrula()` içindeki `if (stat.mtimeMs < derlemeBaslangici - MTIME_TOLERANS_MS)`
  // bloğu geçici olarak `if (false)` yapılıp yukarıdaki "GERİLEME: ESKİ dosya" testi
  // koşulduğunda `sonuc.tamam` `true` döner ve test AssertionError ile düşer — elle
  // doğrulandı (bkz. görev raporu), sonra geri alındı. Burada yalnız BELGELEME amaçlı
  // bir sentinel: fonksiyon kaynağında kontrolün hâlâ var olduğunu doğrular.
  const src = fs.readFileSync(path.join(__dirname, 'windows-setup-dogrulama.js'), 'utf8');
  assert.match(src, /stat\.mtimeMs < derlemeBaslangici - MTIME_TOLERANS_MS/,
    'mtime tazelik kontrolü kaynaktan kaldırılmış');
  assert.match(src, /dosyaAdi !== beklenen/, 'ad kontrolü kaynaktan kaldırılmış');
});

test('eskiCiktiyiKenaraAl: mevcut .exe SİLİNMEDEN .eski-<ts> sonekiyle kenara alınır', async () => {
  const dizin = await gecici();
  const yol = path.join(dizin, 'Eski-1.0.0-Setup.exe');
  await fs.writeFile(yol, 'eski-icerik');
  const sonuc = await mod.eskiCiktiyiKenaraAl(dizin);
  assert.strictEqual(sonuc.length, 1);
  assert.strictEqual(sonuc[0].dosya, 'Eski-1.0.0-Setup.exe');
  assert.strictEqual(await fs.pathExists(yol), false, 'eski dosya HÂLÂ eski adında duruyor (kenara alınmadı)');
  assert.strictEqual(await fs.pathExists(sonuc[0].hedef), true, 'kenara alınan dosya hedef yolda yok');
  assert.strictEqual((await fs.readFile(sonuc[0].hedef, 'utf8')), 'eski-icerik', 'içerik SİLİNMİŞ/bozulmuş — silme değil taşıma bekleniyordu');
});

test('eskiCiktiyiKenaraAl: .exe olmayan dosyalara dokunmaz', async () => {
  const dizin = await gecici();
  const yol = path.join(dizin, 'not-installer.txt');
  await fs.writeFile(yol, 'x');
  const sonuc = await mod.eskiCiktiyiKenaraAl(dizin);
  assert.strictEqual(sonuc.length, 0);
  assert.strictEqual(await fs.pathExists(yol), true);
});

test('eskiCiktiyiKenaraAl: dizin yoksa no-op (hata fırlatmaz)', async () => {
  const dizin = path.join(os.tmpdir(), 'empp-wsd-yok-' + Date.now());
  const sonuc = await mod.eskiCiktiyiKenaraAl(dizin);
  assert.deepStrictEqual(sonuc, []);
});
