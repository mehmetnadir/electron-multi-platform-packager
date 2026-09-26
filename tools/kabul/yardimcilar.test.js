'use strict';
/**
 * Başsız kabul kapısı — yardımcı modüllerin saf/yan etkisi küçük birim testleri:
 * paket-cikar (platform, kök, envanter), calisma-zamani (sürüm okuma, önbellek),
 * imza-denetimi (karar), android-cihaz (ayrıştırıcılar, kırpma, port, AVD), odak (örnekleyici).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('./paket-cikar');
const Z = require('./calisma-zamani');
const { imzaKarari } = require('./imza-denetimi');
const A = require('./android-cihaz');
const { odakIzleyici } = require('./odak');

const gecici = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `bk-yard-${ad}-`));

test('platformTahmin / platformNormalize', () => {
  assert.equal(P.platformTahmin('/a/b.dmg'), 'mac');
  assert.equal(P.platformTahmin('/a/b.APK'), 'android');
  assert.equal(P.platformTahmin('/a/b-Setup.exe'), 'windows');
  assert.equal(P.platformTahmin('/a/b.impark'), 'pardus');
  assert.equal(P.platformTahmin('/a/b.zip'), 'zip');
  assert.equal(P.platformTahmin('/a/b', true), 'dizin');
  assert.equal(P.platformTahmin('/a/b.txt'), null);
  assert.equal(P.platformNormalize('macos'), 'mac');
  assert.equal(P.platformNormalize('linux'), 'pardus');
  assert.equal(P.platformNormalize('android'), 'android');
});

test('uygulamaKokunuBul: asar > app/ > kök sırası; APK assets/public', () => {
  const d = gecici('kok');
  try {
    fs.mkdirSync(path.join(d, 'resources', 'app'), { recursive: true });
    fs.writeFileSync(path.join(d, 'resources', 'app', 'index.html'), 'x');
    assert.equal(P.uygulamaKokunuBul(d).kok, path.join(d, 'resources', 'app'));
    fs.writeFileSync(path.join(d, 'resources', 'app.asar'), 'asar');
    assert.deepEqual(P.uygulamaKokunuBul(d), { kok: path.join(d, 'resources', 'app.asar'), asar: true });
    const apk = gecici('apk');
    fs.mkdirSync(path.join(apk, 'assets', 'public'), { recursive: true });
    fs.writeFileSync(path.join(apk, 'assets', 'public', 'index.html'), 'x');
    assert.equal(P.uygulamaKokunuBul(apk).kok, path.join(apk, 'assets', 'public'));
    fs.rmSync(apk, { recursive: true, force: true });
    const bos = gecici('bos');
    assert.equal(P.uygulamaKokunuBul(bos), null);
    fs.rmSync(bos, { recursive: true, force: true });
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('kokEnvanteri: dizin ve asar ağacında AYNI sonuç (SET tanıma = bookN/app.config.js)', async () => {
  const d = gecici('env');
  try {
    fs.writeFileSync(path.join(d, 'index.html'), '<title>Set</title>');
    fs.writeFileSync(path.join(d, 'set-menu.json'), JSON.stringify({ kitaplar: [{ ad: 'A', grup: '' }] }));
    for (const b of ['book1', 'book2', 'book10']) {
      fs.mkdirSync(path.join(d, b));
      fs.writeFileSync(path.join(d, b, 'app.config.js'), '');
    }
    fs.mkdirSync(path.join(d, 'book3')); // app.config.js yok → sayılmaz
    const e1 = P.kokEnvanteri(d, false);
    assert.deepEqual(e1.kitapDizinleri, ['book1', 'book2', 'book10']);
    assert.equal(e1.setMi, true);
    assert.equal(e1.kokAppConfig, false);
    assert.equal(e1.setMenu.kitaplar[0].ad, 'A');
    // eslint-disable-next-line global-require
    const asar = require('@electron/asar');
    const hedef = path.join(gecici('asar'), 'app.asar');
    await asar.createPackage(d, hedef);
    const e2 = P.kokEnvanteri(hedef, true);
    assert.deepEqual(e2.kitapDizinleri, e1.kitapDizinleri);
    assert.equal(e2.indexHtml, e1.indexHtml);
    fs.rmSync(path.dirname(hedef), { recursive: true, force: true });
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('Electron sürümü: metinden, ikilide parça sınırına denk gelse de bulunur', () => {
  assert.equal(Z.surumMetindenAyikla('%s/%s Chrome/%s Electron/27.3.11'), '27.3.11');
  assert.equal(Z.surumMetindenAyikla('yok'), null);
  const d = gecici('ikili');
  try {
    const f = path.join(d, 'ikili');
    const PARCA = 8 * 1024 * 1024;
    const b = Buffer.alloc(PARCA + 1000, 0x41);
    Buffer.from('Electron/31.2.3').copy(b, PARCA - 6); // 8 MB sınırının üstüne biner
    fs.writeFileSync(f, b);
    assert.equal(Z.ikilidenSurum(f), '31.2.3');
    fs.writeFileSync(f, Buffer.alloc(1000, 0x42));
    assert.equal(Z.ikilidenSurum(f), null);
    fs.writeFileSync(path.join(d, 'version'), 'v27.3.11\n');
    assert.equal(Z.versionDosyasi(d), '27.3.11');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('onbellekZipBul: kökte ya da bir alt dizinde (electron/get düzeni)', () => {
  const d = gecici('onbellek');
  try {
    fs.mkdirSync(path.join(d, 'abc123'));
    fs.writeFileSync(path.join(d, 'abc123', 'electron-v27.3.11-darwin-arm64.zip'), '');
    assert.equal(Z.onbellekZipBul('27.3.11', 'arm64', [d]), path.join(d, 'abc123', 'electron-v27.3.11-darwin-arm64.zip'));
    assert.equal(Z.onbellekZipBul('27.3.11', 'x64', [d]), null);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('imzaKarari: noterli+zımbalı GEÇTİ; zımbasız / noter yok / codesign kırık RED', () => {
  const iyi = {
    codesign: { rc: 0, cikti: 'valid on disk\nsatisfies its Designated Requirement' },
    stapler: { rc: 0, cikti: 'The validate action worked!' },
    spctl: { rc: 0, cikti: 'x.dmg: accepted\nsource=Notarized Developer ID' },
  };
  assert.equal(imzaKarari(iyi).durum, 'GECTI');
  // 73768 bozuk DMG'nin GERÇEK çıktıları (2026-09-26):
  const bozuk = {
    ...iyi,
    stapler: { rc: 65, cikti: 'SM3-bozuk.dmg does not have a ticket stapled to it.' },
    spctl: { rc: 3, cikti: 'SM3-bozuk.dmg: rejected\nsource=Unnotarized Developer ID' },
  };
  const k = imzaKarari(bozuk);
  assert.equal(k.durum, 'RED');
  assert.equal(k.sebepler.length, 2);
  assert.equal(imzaKarari({ ...iyi, codesign: { rc: 1, cikti: 'a sealed resource is missing or invalid' } }).durum, 'RED');
  assert.equal(imzaKarari({ ...iyi, spctl: { rc: 0, cikti: 'accepted\nsource=Developer ID' } }).durum, 'RED', 'noterSİZ Developer ID yetmez');
  assert.equal(imzaKarari(null).durum, 'OLCULEMEDI');
});

test('android: badging, cihaz listesi, boş port, AVD adayları (TCDD_MITM asla)', () => {
  assert.deepEqual(A.badgingCoz("package: name='com.yds.sm3' versionCode='1'\nlaunchable-activity: name='com.yds.sm3.MainActivity'  label=''"),
    { paket: 'com.yds.sm3', etkinlik: 'com.yds.sm3.MainActivity' });
  assert.equal(A.badgingCoz("package: name='a.b'\napplication-label:'Super Monsters 3'\n").etiket, 'Super Monsters 3');
  assert.deepEqual(A.cihazlariCoz('List of devices attached\nemulator-5554\tdevice\nR58M\tunauthorized\n\n'),
    [{ seri: 'emulator-5554', durum: 'device' }, { seri: 'R58M', durum: 'unauthorized' }]);
  assert.equal(A.bosPortSec([]), 5584);
  assert.equal(A.bosPortSec([5584]), 5582);
  assert.equal(A.bosPortSec([5585]), 5582, 'adb portu (port+1) doluysa da atlanır');
  assert.deepEqual(A.avdAdaylari('TCDD_MITM'), []);
  assert.ok(!A.avdAdaylari().includes('TCDD_MITM'));
  assert.deepEqual(A.avdAdaylari('Pixel_8_Pro_API_35'), ['Pixel_8_Pro_API_35']);
});

test('android: ui dökümünden WebView sınırı, Web-Z kartları, yükleniyor metni', () => {
  const xml = '<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][2208,1840]">'
    + '<node class="android.webkit.WebView" text="" content-desc="" bounds="[0,80][2208,1760]" clickable="false">'
    + '<node class="android.widget.Button" text="" content-desc="Student&apos;s Book kitabını aç" bounds="[100,200][500,700]" clickable="true"/>'
    + '<node class="android.widget.Button" text="" content-desc="Activity Book kitabını aç" bounds="[600,200][1000,700]" clickable="true"/>'
    + '<node class="android.view.View" text="Activity Book" content-desc="" bounds="[600,720][1000,760]"/>'
    + '<node class="android.view.View" text="Yükleniyor..." content-desc="" bounds="[10,10][100,40]"/>'
    + '</node></node></hierarchy>';
  const d = A.uiDugumleri(xml);
  assert.equal(d.length, 6);
  assert.deepEqual(A.webViewSiniri(d), { x1: 0, y1: 80, x2: 2208, y2: 1760, alan: 2208 * 1680 });
  const k = A.cihazKartlari(d, ["Student's Book", 'Activity Book']);
  assert.equal(k.length, 2, 'aynı kitabın düğmesi + başlığı TEK kart');
  assert.deepEqual(k[0], { anahtar: "student's book", x: 300, y: 450 });
  assert.deepEqual(A.cihazYukleniyor(d), ['metin:Yükleniyor...']);
});

test('android: ham screencap başlığı (12/16 bayt) ve kırpma', () => {
  const g = 4; const h = 3;
  for (const baslik of [12, 16]) {
    const b = Buffer.alloc(baslik + g * h * 4);
    b.writeUInt32LE(g, 0); b.writeUInt32LE(h, 4); b.writeUInt32LE(1, 8);
    for (let i = 0; i < g * h; i += 1) b[baslik + i * 4] = i; // R = piksel sırası
    const e = A.hamEkranCoz(b);
    assert.equal(e.genislik, g);
    assert.equal(e.veri.length, g * h * 4);
    const k = A.kirp(e.veri, g, h, { x1: 1, y1: 1, x2: 3, y2: 3 });
    assert.equal(k.genislik, 2);
    assert.deepEqual([k.veri[0], k.veri[4], k.veri[8], k.veri[12]], [5, 6, 9, 10]);
  }
  assert.equal(A.hamEkranCoz(Buffer.alloc(20)), null);
});

test('odak örnekleyici: ayrı süreç, ana süreç meşgulken de örnekler', async () => {
  const d = gecici('odak');
  try {
    const z = odakIzleyici(100, path.join(d, 'o.jsonl'));
    const bas = Date.now();
    while (Date.now() - bas < 800) { /* ana süreci bilerek meşgul et */ }
    await new Promise((r) => setTimeout(r, 300));
    const r = await z.durdur();
    assert.ok(r.orneklemeSayisi >= 3, `örnek sayısı ${r.orneklemeSayisi}`);
    assert.ok(Array.isArray(r.ornekler));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('android: çok ekranlı cihazda etkin ekran kimliği; logcat "asset yok" = ERR_FILE_NOT_FOUND; PNG önündeki uyarı atılır', () => {
  const dumpsys = "mViewports=[DisplayViewport{type=INTERNAL, valid=true, isActive=true, displayId=0, uniqueId='local:4619827259835644672'},"
    + " DisplayViewport{type=INTERNAL, valid=true, isActive=false, displayId=3, uniqueId='local:4619827551948147201'}]";
  assert.equal(A.etkinEkranCoz(dumpsys), '4619827259835644672');
  assert.equal(A.etkinEkranCoz('tek ekran, viewport yok'), null);
  const k = A.logcatKonsol('09-26 11:13:27.131 E/Capacitor( 4871): Unable to open asset URL: https://localhost/app.config.js\n'
    + '09-26 11:13:36.668 E/Capacitor/Console( 4871): Msg: Uncaught (in promise) ReferenceError: AppConfig is not defined');
  assert.match(k[0].mesaj, /ERR_FILE_NOT_FOUND .*app\.config\.js/);
  assert.equal(k[1].seviye, 'error');
  const png = Buffer.concat([Buffer.from('[Warning] Multiple displays were found\n'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2])]);
  assert.deepEqual([...A.pngAyikla(png).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(A.pngAyikla(Buffer.from('yalnız metin')), null);
});

test('çalışma zamanı politikası: paketin sürümü yoksa odaksız kanıtlıya düşer; odak çalan işaretliyse atlanır; kanıtsız yedek izinsiz kullanılmaz', () => {
  const kok = gecici('zaman');
  try {
    const kur = (v) => {
      const d = path.join(kok, `electron-v${v}-darwin-arm64`);
      fs.mkdirSync(path.join(d, 'Electron.app', 'Contents', 'MacOS'), { recursive: true });
      fs.writeFileSync(path.join(d, 'Electron.app', 'Contents', 'MacOS', 'Electron'), '');
      fs.writeFileSync(path.join(d, '.empp-kabul-hazir.json'), '{}');
      return d;
    };
    const d27 = kur('27.3.11');
    const bos = gecici('bos-onbellek');
    const r = Z.calismaZamaniHazirla({ surum: '31.0.0', kok, mimari: 'arm64', onbellekler: [bos], kanitsizIzin: false });
    assert.equal(r.surum, '27.3.11');
    assert.equal(r.eslesti, false);
    assert.match(r.uyari, /v31\.0\.0 için odaksız çalışma zamanı yok/);
    const tam = Z.calismaZamaniHazirla({ surum: '27.3.11', kok, mimari: 'arm64', onbellekler: [bos], kanitsizIzin: false });
    assert.equal(tam.eslesti, true);
    assert.equal(tam.uyari, null);
    // Odak çaldığı ölçülen çalışma zamanı bir daha seçilmez; başka aday yoksa ÖLÇÜLEMEDİ (throw).
    assert.equal(Z.odakCaldiIsaretle(d27, { test: true }), true);
    assert.throws(() => Z.calismaZamaniHazirla({ surum: '27.3.11', kok, mimari: 'arm64', onbellekler: [bos], kanitsizIzin: false }),
      /odaksız Electron çalışma zamanı yok.*odak çaldı/);
    fs.rmSync(bos, { recursive: true, force: true });
  } finally { fs.rmSync(kok, { recursive: true, force: true }); }
});

test('android: sistem ANR diyaloğu (26.09 gerçek döküm) — başkasınınki kapatılır, bizimki beklenir', () => {
  const xml = '<hierarchy>'
    + '<node text="Messages isn\'t responding" resource-id="android:id/alertTitle" class="android.widget.TextView" package="android" bounds="[602,747][1606,818]" />'
    + '<node text="Close app" resource-id="android:id/aerr_close" class="android.widget.Button" package="android" clickable="true" bounds="[539,857][1669,983]" />'
    + '<node text="Wait" resource-id="android:id/aerr_wait" class="android.widget.Button" package="android" clickable="true" bounds="[539,983][1669,1109]" />'
    + '</hierarchy>';
  const d = A.uiDugumleri(xml);
  const yabanci = A.sistemDiyalogu(d, 'Super Monsters 3');
  assert.equal(yabanci.kendi, false);
  assert.equal(yabanci.dugmeAdi, 'aerr_close');
  assert.deepEqual(yabanci.dugme, { x: 1104, y: 920 });
  const kendi = A.sistemDiyalogu(A.uiDugumleri(xml.replace('Messages', 'Super Monsters 3')), 'Super Monsters 3');
  assert.equal(kendi.kendi, true);
  assert.equal(kendi.dugmeAdi, 'aerr_wait', 'kendi uygulamamızı asla kapatma');
  assert.equal(A.sistemDiyalogu(A.uiDugumleri('<node class="android.webkit.WebView" bounds="[0,0][10,10]" />'), 'x'), null);
});
