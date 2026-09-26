'use strict';

/**
 * WINDOWS'TA asar KAPALI — kapı testleri.
 *
 * Kapının iki yüzü ayrı ayrı çivilenir:
 *   (a) DAVRANIŞ — `acikMi`/`asarSecenegi` env'e göre ne döner (varsayılan AÇIK,
 *       yalnız "0" kapatır, geri dönüş yolu gerçekten çalışır).
 *   (b) BAĞLANTI — canlı Windows config'i bu kapıyı GERÇEKTEN çağırıyor mu, ve
 *       mac/dmg + linux config'leri bu anahtara DOKUNMUYOR mu (kaynak-sentinel).
 *
 * (b) neden kaynak-sentinel: `packageWindows()` disk I/O, ikon dönüştürme ve
 * electron-builder çağırıyor; config nesnesi saf bir fonksiyondan dönmüyor. Bu
 * yüzden config bloğunun kendisi METİN olarak ölçülür — "config'in beyan etmesi ≠
 * çıktının taşıması" kuralı gereği ÜRETİLMİŞ PAKETİN ölçümü ayrıca
 * `scripts/windows-paket-kapisi.js` madde 12'nin işidir.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const kapi = require('./windows-asarsiz');
const sentinel = require('./paket-disi-liste-sentinel');

const CANLI = path.join(__dirname, 'packagingService.js');

/**
 * `packagingService.js` kaynağını platform fonksiyonlarına böler. Sınır işaretleri
 * BULUNAMAZSA test yüksek sesle düşer — fonksiyon yeniden adlandırılırsa sentinel
 * sessizce körelmesin diye.
 */
function platformBloklari() {
  const src = fs.readFileSync(CANLI, 'utf8');
  const isaretler = [
    ['windows', 'async packageWindows('],
    ['macos', 'async packageMacOS('],
    ['linux', 'async packageLinux('],
    ['android', 'async packageAndroid('],
  ];
  const ofsetler = isaretler.map(([ad, isaret]) => {
    const i = src.indexOf(isaret);
    assert.notStrictEqual(i, -1, `sentinel köreldi: "${isaret}" kaynakta yok`);
    return { ad, i };
  });
  // Sıra bozulursa dilimleme yanlış blok üretir — onu da ölç.
  for (let k = 1; k < ofsetler.length; k++) {
    assert.ok(ofsetler[k].i > ofsetler[k - 1].i,
      `platform fonksiyonlarının kaynak sırası değişmiş (${ofsetler[k - 1].ad} → ${ofsetler[k].ad})`);
  }
  const blok = {};
  for (let k = 0; k < ofsetler.length; k++) {
    const son = k + 1 < ofsetler.length ? ofsetler[k + 1].i : src.length;
    blok[ofsetler[k].ad] = src.slice(ofsetler[k].i, son);
  }
  return blok;
}

// ---------------------------------------------------------------------------
// (a) Davranış
// ---------------------------------------------------------------------------

test('A1 · varsayılan AÇIK: env yokken kapı açık, asar seçeneği false', () => {
  assert.strictEqual(kapi.acikMi({}), true);
  assert.strictEqual(kapi.asarSecenegi({}), false);
});

test('A2 · GERİ DÖNÜŞ: EMPP_WINDOWS_ASARSIZ=0 kapıyı kapatır, asar true döner', () => {
  const env = { EMPP_WINDOWS_ASARSIZ: '0' };
  assert.strictEqual(kapi.acikMi(env), false);
  assert.strictEqual(kapi.asarSecenegi(env), true,
    'geri dönüş yolu yoksa paket düzeni değişikliği tek yönlüdür — yasak');
});

test('A3 · yalnız tam "0" kapatır; "1"/""/"false"/" 0"/"00" kapıyı AÇIK bırakır', () => {
  for (const v of ['1', '', 'false', ' 0', '00', 'hayir', 'true']) {
    assert.strictEqual(kapi.acikMi({ EMPP_WINDOWS_ASARSIZ: v }), true,
      `EMPP_WINDOWS_ASARSIZ=${JSON.stringify(v)} kapıyı kapatmamalı`);
  }
  // Sayısal 0 da string "0" DEĞİLDİR (String() ile normalleştirilir → kapatır).
  assert.strictEqual(kapi.acikMi({ EMPP_WINDOWS_ASARSIZ: 0 }), false,
    'process.env her zaman string verir; sayısal 0 yalnız testten gelir ve "0" ile aynı okunur');
});

test('A4 · env undefined/null/dizi verilse çökmez, varsayılana döner', () => {
  assert.strictEqual(kapi.acikMi(null), true);
  assert.strictEqual(kapi.acikMi(undefined), true);
  assert.strictEqual(kapi.asarSecenegi(null), false);
});

test('A5 · dönen değer BOOLEAN — undefined bırakıp electron-builder varsayılanına düşmez', () => {
  assert.strictEqual(typeof kapi.asarSecenegi({}), 'boolean');
  assert.strictEqual(typeof kapi.asarSecenegi({ EMPP_WINDOWS_ASARSIZ: '0' }), 'boolean');
  assert.strictEqual(kapi.ISARET, 'EMPP_WINDOWS_ASARSIZ');
});

// ---------------------------------------------------------------------------
// (b) Bağlantı — canlı config
// ---------------------------------------------------------------------------

test('B1 · CANLI YOL: packageWindows() config\'i asar değerini kapıdan alır', () => {
  const { windows } = platformBloklari();
  assert.match(windows, /asar:\s*windowsAsarsiz\.asarSecenegi\(\)/,
    'canlı Windows config\'i asar anahtarını kapıdan almıyor — değişiklik pakete geçmez');
  const src = fs.readFileSync(CANLI, 'utf8');
  assert.match(src, /require\(['"]\.\/windows-asarsiz['"]\)/,
    'packagingService.js kapı modülünü require etmiyor (kopya mantık riski)');
});

test('B2 · MAC HATTI DEĞİŞMEDİ: packageMacOS() bloğunda hiçbir asar anahtarı YOK', () => {
  const { macos } = platformBloklari();
  // codesign .app içindeki HER dosyayı CodeResources'a mühürler; 10 bin dosyalık
  // açık ağaç imzalaması saatler sürer. mac'te asar AÇIK kalmalı — yani config
  // bu anahtara HİÇ dokunmamalı (electron-builder varsayılanı true).
  assert.ok(!/\basar\s*:/.test(macos),
    'macOS config\'ine asar anahtarı sızmış — 10k dosya imzası saatler sürer');
  assert.ok(!/windowsAsarsiz/.test(macos),
    'macOS bloğu Windows kapısını çağırıyor — hatlar karışmış');
  assert.match(macos, /mac:\s*\{/, 'sentinel yanlış bloğu ölçüyor (mac config bulunamadı)');
});

test('B3 · LINUX/ANDROID HATTI DEĞİŞMEDİ: asar anahtarı yok', () => {
  const { linux, android } = platformBloklari();
  assert.ok(!/\basar\s*:/.test(linux), 'Linux (AppImage/.impark) config\'ine asar sızmış');
  assert.ok(!/windowsAsarsiz/.test(linux), 'Linux bloğu Windows kapısını çağırıyor');
  assert.ok(!/\basar\s*:/.test(android), 'Android config\'ine asar sızmış');
});

test('B3b · `build/` PAKETE GİRMEZ: Windows files listesi "!build" taşır', () => {
  const { windows } = platformBloklari();
  // NEDEN (2026-09-21, ölçümle): `asar: false` ile `workingPath/build/` aynen
  // `resources/app/build/` olarak paketleniyor (electron-builder onu buildResources
  // sayıp dışlamadı — ÖLÇÜLDÜ, beyan değil). İçi NSIS artefaktı (installer.nsh,
  // installerHeader.bmp, logo). Yayıncı motorunda gömülü
  // `path.dirname(exe) + "/resources/app/build"` sabiti bugün ÖLÜ (184 dosyada
  // yalnız tanım, çağıran sıfır; Electron 27.3.11 + @electron/remote yok → "" dönerdi)
  // ama bu düzen o yolu "yok"tan "VAR AMA YANLIŞ İÇERİK"e çeviriyordu. Dışlama o
  // sessiz-yanlış-dal yüzeyini kapatır.
  // 2026-09-26: liste `paket-disi-liste.js`'e taşındı; canlı dizi tek okuyucuyla çözülür.
  assert.ok(sentinel.canliFilesDesenleri('windows').includes('!build'),
    'build/ dışlanmamış — NSIS artefaktları resources/app/build olarak paketlenir');
  // Kayıp olmadığının kanıtı: NSIS bu dosyaları workingPath'ten okur, paketten değil.
  assert.match(windows, /include:\s*path\.resolve\(workingPath,\s*["']build\/installer\.nsh["']\)/,
    'nsis.include workingPath\'ten okumuyorsa dışlama NSIS üretimini kırar');
  assert.match(windows, /installerHeader:\s*path\.resolve\(workingPath,/);
  assert.match(windows, /installerSidebar:\s*path\.resolve\(workingPath,/);
});

test('B3c · `build/` DIŞLAMASI DÖRT PLATFORMDA (Nadir 2026-09-26; eskiden "yalnız Windows")', () => {
  // KARAR DEĞİŞTİ (2026-09-26, Nadir: "windows paketinde uyguladığımız gereksizleri atma
  // politikasını onlarda da uygulamalıyız"). mac/Linux'ta güvenli olduğu ölçüldü:
  // electron-builder buildResources'ı diskten okur (`platformPackager.getResource`,
  // `macPackager` entitlements → `path.join(buildResourcesDir, …)`), `files` deseninden
  // bağımsız; mac entitlements/ikon/dmg arka planı `build/` dışından mutlak yolla gelir.
  // Android kopyası da aynı listeden (bkz. paket-disi-liste.test.js).
  for (const p of ['macos', 'linux']) {
    assert.ok(sentinel.canliFilesDesenleri(p).includes('!build'),
      `${p} files listesinde "!build" yok — Windows politikası uygulanmıyor`);
  }
});

test('B3d · DAVRANIŞ: canlı files listesi electron-builder\'ın KENDİ eleyicisinde build/ ağacını dışlar', () => {
  // Bu test bir MODEL değil: `app-builder-lib`in üretimde kullandığı `FileMatcher`
  // sınıfı doğrudan çağrılır. Desenler de elle yazılmaz — CANLI Windows config\'inden
  // okunur (yayılımlar `paket-disi-liste-sentinel.js` ile çözülür); config değişirse
  // test onunla birlikte değişir.
  const desenler = sentinel.canliFilesDesenleri('windows');
  assert.ok(desenler.includes('**/*'), `desenler okunamadı: ${JSON.stringify(desenler)}`);

  const { FileMatcher } = require('app-builder-lib/out/fileMatcher');
  const ele = new FileMatcher('/kaynak', '/hedef', (x) => x, desenler).createFilter();
  const dosya = { isFile: () => true, isDirectory: () => false };
  const dizin = { isFile: () => false, isDirectory: () => true };

  // build/ ve altındaki NSIS artefaktları DIŞARIDA — `resources/app/build` oluşmaz.
  assert.strictEqual(ele('/kaynak/build', dizin), false, 'build/ dizini pakete giriyor');
  assert.strictEqual(ele('/kaynak/build/installer.nsh', dosya), false);
  assert.strictEqual(ele('/kaynak/build/installerHeader.bmp', dosya), false);

  // Gerçek içerik İÇERİDE — dışlama fazla geniş değil (pozitif kontrol).
  assert.strictEqual(ele('/kaynak/package.json', dosya), true);
  assert.strictEqual(ele('/kaynak/version.txt', dosya), true);
  assert.strictEqual(ele('/kaynak/book1/index.html', dosya), true);
  assert.strictEqual(ele('/kaynak/book1/assets/56385/pages/1.png', dosya), true);

  // Eski dışlamalar da yerinde (gerileme freni).
  assert.strictEqual(ele('/kaynak/temp/x', dosya), false);
  assert.strictEqual(ele('/kaynak/uploads/y', dosya), false);
  assert.strictEqual(ele('/kaynak/node_modules/a/b.js', dosya), false);
});

test('B4 · KARANTİNADAKİ YOL HİZALI: WindowsPackagingService (require EDİLMİYOR) aynı kapıyı taşır', () => {
  // 2026-09-21: dosya ÖLÇÜLDÜ, kanıtlandı ve `src/platforms/windows/` dışına,
  // `_graveyard/2026-09-21-platforms/windows/`'a taşındı (bkz. o dizindeki OKU.md).
  // Taşınsa da içeriği hâlâ zehirli kalıp taşıyabilir — biri onu geri getirirse
  // aynı asar hatası sessizce geri gelmesin diye arşivlenmiş kopya da izlenir.
  const p = path.join(__dirname, '..', '..', '_graveyard', '2026-09-21-platforms', 'windows', 'WindowsPackagingService.js');
  const src = fs.readFileSync(p, 'utf8');
  assert.match(src, /asar:\s*windowsAsarsiz\.asarSecenegi\(\)/,
    'karantinadaki Windows servisi canlıya bağlanırsa sessizce asar\'lı paket üretir');
  assert.match(src, /ÖLÜ YOL UYARISI/,
    'dosyanın ölü olduğu yazılı değilse okuyan onu canlı sanır');
});
