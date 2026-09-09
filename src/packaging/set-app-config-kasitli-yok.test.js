'use strict';
// K1 (2026-09-09, geri alındı) — KASITLI YOK sentinel.
//
// NEDEN bu test var: K1 turunda SET kökünde eksik `app.config.js`'i
// `set_app.config`'ten üreten bir modül (`ensureSetAppConfig`) yazılmış ve
// `startPackaging()`'e bağlanmıştı. Nadir kararı ("build klasöründe ne varsa
// aynen paketlensin" — set menüsünü/konfigini paketleyici ÜRETMEYECEK) ile bu
// TERSİNE ÇEVRİLDİ: kod `_graveyard/2026-09-09-set-app-config/` altına taşındı
// (bkz. NEDEN.md), `packagingService.js`'teki çağrı kaldırıldı.
//
// BELİRTİ (eğer birisi bu kararı bilmeden K1'i "iyi niyetle" geri getirirse):
// paketleyici artık yayıncının SIZI hiç görmediği bir `app.config.js`/set menüsü
// üretmeye başlar — bu, Nadir'in açık kararının SESSİZCE ihlalidir (hata
// vermez, davranış sapması olarak fark edilir).
//
// KANIT: `asis_59480.apk` (K1 geri alındıktan SONRA üretilen proof APK) —
// `assets/public/app.config.js` YOK, `assets2/styles.css` VAR (yayıncının kendi
// özel index.html'i birebir korunmuş).
//
// Bu dosya iki şeyi doğrular:
//   1. Kaynak-sentinel: packagingService.js içinde `app.config.js` YAZAN hiçbir
//      kod yok (ensureSetAppConfig require'ı da dahil kalıcı olarak kaldırılmış).
//   2. Davranışsal: gerçek üretim sırasıyla AYNI iki adımı (fs.copy + ardından
//      ensureSetBookHomeButton — startPackaging()'in ortak ön-fanout bloğu, bkz.
//      packagingService.js satır ~398-421) SET kökünde app.config.js OLMAYAN bir
//      sahte build üzerinde çalıştırıp kökte hâlâ dosya OLUŞMADIĞINI kanıtlar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { ensureSetBookHomeButton } = require('./set-book-home-button');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'set-app-config-kasitli-yok-test-'));
}

async function buildFakeSetWithoutRootConfig() {
  const buildPath = tempDir();
  // Kok: app.config.js YOK (K1 vakasi, kitap 45538 gibi) - sadece SET'e ozgu
  // yayinci dosyalari (set_app.config, old_app.config.js) olabilir.
  await fs.writeFile(path.join(buildPath, 'set_app.config'), 'appName=Set Menu\n');
  await fs.writeFile(path.join(buildPath, 'index.html'), '<html><body>set menu</body></html>');
  for (const book of ['book1', 'book2']) {
    await fs.ensureDir(path.join(buildPath, book));
    await fs.writeFile(
      path.join(buildPath, book, 'app.config.js'),
      "const AppConfig = { setBook: { enable: false } };\n"
    );
  }
  return buildPath;
}

test('GERİLEME/KASITLI YOK: SET kökünde app.config.js yoksa paketleyici ÜRETMEZ (Nadir kararı)', async () => {
  const buildPath = await buildFakeSetWithoutRootConfig();
  const workingPath = tempDir();

  // startPackaging()'in ortak on-fanout blogundaki GERCEK iki adim, AYNI sirayla:
  await fs.copy(buildPath, workingPath);
  await ensureSetBookHomeButton(workingPath);

  assert.strictEqual(
    fs.existsSync(path.join(workingPath, 'app.config.js')),
    false,
    'paketleyici kokte app.config.js UretMEMELI - yayincinin build klasoru aynen kalmali'
  );
  // set_app.config / index.html birebir kopyalanmis olmali (aynen paketleme).
  assert.ok(fs.existsSync(path.join(workingPath, 'set_app.config')));
  assert.ok(fs.existsSync(path.join(workingPath, 'index.html')));
  // bookN icindeki setBook.enable K5 tarafindan true'ya cevrilmis olabilir (ayri
  // kusur, bu testin konusu degil) ama KOKTE hala hicbir app.config.js yok.
  assert.strictEqual(fs.existsSync(path.join(workingPath, 'app.config.js')), false);
});

test('kaynak-sentinel: packagingService.js icinde app.config.js YAZAN kod YOK (ensureSetAppConfig kalici olarak kaldirildi)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.doesNotMatch(src, /ensureSetAppConfig/, 'K1 geri alindi - bu isim bir daha require/cagri EDİLMEMELI');
  // "app.config.js" gecen her satir YALNIZCA OKUMA/log/yorum olmali - writeFile/
  // writeJson ile YAZMA hedefi OLMAMALI.
  const writeTargetingAppConfig = /(writeFile|writeJson|createWriteStream|outputFile)\s*\([^)]*app\.config\.js/;
  assert.doesNotMatch(src, writeTargetingAppConfig, 'app.config.js YAZAN kod bulundu - Nadir kararini ihlal ediyor');
});

test('kaynak-sentinel: graveyard NEDEN.md [STATE: ARCHIVED] olarak isaretli (Librarian protokolu)', () => {
  const nedenPath = path.join(__dirname, '..', '..', '_graveyard', '2026-09-09-set-app-config', 'NEDEN.md');
  assert.ok(fs.existsSync(nedenPath), 'NEDEN.md _graveyard altinda olmali');
  const content = fs.readFileSync(nedenPath, 'utf8');
  assert.match(content, /\[STATE: ARCHIVED\]/);
});
