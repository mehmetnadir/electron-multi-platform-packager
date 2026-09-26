'use strict';
// Android/Capacitor `www` kopyasinin node_modules/electron'u DISLADIGINI gercek bir
// sahte dizin agacinda fs-extra copy CALISTIRARAK dogrular (2026-09-09, kitap 45538
// yapisal kiyas: Mac APK 1.62 GB / srv21 1.44 GB, 318 dosya farkinin tamami
// assets/public/node_modules/electron/**).
//
// Kok neden: prepareElectronFiles() workingPath kokune `npm install --only=dev`
// ile node_modules/electron kurar (masaustu electron-builder hatti icin gerekli).
// Android hatti bu AYNI workingPath'i www'ye FILTRESIZ kopyaliyordu.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { createWwwCopyFilter } = require('./www-copy-exclude');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'www-copy-exclude-test-'));
}

async function buildFakeWorkingPath() {
  const src = tempDir();
  // Gercek web build iceriği
  await fs.ensureDir(path.join(src, 'core'));
  await fs.writeFile(path.join(src, 'index.html'), '<html></html>');
  await fs.writeFile(path.join(src, 'app.config.js'), 'const AppConfig = {};');
  await fs.writeFile(path.join(src, 'core', 'logo.png'), 'PNGDATA');
  // prepareElectronFiles'in kurdugu node_modules/electron (sizinti kaynagi)
  await fs.ensureDir(path.join(src, 'node_modules', 'electron', 'dist'));
  await fs.ensureDir(path.join(src, 'node_modules', '.bin'));
  await fs.writeFile(path.join(src, 'node_modules', 'electron', 'package.json'), '{}');
  await fs.writeFile(path.join(src, 'node_modules', 'electron', 'dist', 'Electron.app'), 'BINARY');
  await fs.writeFile(path.join(src, 'node_modules', '.bin', 'electron'), '#!/bin/sh');
  return src;
}

test('node_modules/electron www kopyasina GECMEZ, diger dosyalar GECER', async () => {
  const src = await buildFakeWorkingPath();
  const dest = tempDir();
  const wwwPath = path.join(dest, 'www');

  await fs.copy(src, wwwPath, { filter: createWwwCopyFilter(src) });

  // Gercek web icerigi kopyalanmali.
  assert.ok(fs.existsSync(path.join(wwwPath, 'index.html')));
  assert.ok(fs.existsSync(path.join(wwwPath, 'app.config.js')));
  assert.ok(fs.existsSync(path.join(wwwPath, 'core', 'logo.png')));

  // node_modules HICBIR sekilde www agacina gecmemeli.
  assert.ok(!fs.existsSync(path.join(wwwPath, 'node_modules')), 'node_modules klasoru hic olusmamali');
  assert.ok(!fs.existsSync(path.join(wwwPath, 'node_modules', 'electron', 'dist', 'Electron.app')));
});

test('.git de disarida kalir (tutarlilik icin ayni filtre)', async () => {
  const src = tempDir();
  await fs.ensureDir(path.join(src, '.git'));
  await fs.writeFile(path.join(src, '.git', 'HEAD'), 'ref: refs/heads/main');
  await fs.writeFile(path.join(src, 'index.html'), '<html></html>');
  const dest = tempDir();
  const wwwPath = path.join(dest, 'www');

  await fs.copy(src, wwwPath, { filter: createWwwCopyFilter(src) });

  assert.ok(fs.existsSync(path.join(wwwPath, 'index.html')));
  assert.ok(!fs.existsSync(path.join(wwwPath, '.git')));
});

test('derinlerdeki node_modules de yakalanir (yalniz kok degil)', async () => {
  const src = tempDir();
  await fs.ensureDir(path.join(src, 'book1', 'node_modules', 'foo'));
  await fs.writeFile(path.join(src, 'book1', 'node_modules', 'foo', 'x.js'), 'x');
  await fs.writeFile(path.join(src, 'book1', 'app.config.js'), 'const AppConfig = {};');
  const dest = tempDir();
  const wwwPath = path.join(dest, 'www');

  await fs.copy(src, wwwPath, { filter: createWwwCopyFilter(src) });

  assert.ok(fs.existsSync(path.join(wwwPath, 'book1', 'app.config.js')));
  assert.ok(!fs.existsSync(path.join(wwwPath, 'book1', 'node_modules')));
});

// --- Mutasyon kaniti: filtreyi devre disi birak, sizintinin GERI GELDIGINI goster ---
test('GERİLEME: filtre kaldırılırsa node_modules/electron APK\'ya sızar (assets/public şişer)', async () => {
  const src = await buildFakeWorkingPath();
  const dest = tempDir();
  const wwwPath = path.join(dest, 'www');

  await fs.copy(src, wwwPath); // filter YOK - eski (bozuk) davranis

  assert.ok(
    fs.existsSync(path.join(wwwPath, 'node_modules', 'electron', 'dist', 'Electron.app')),
    'filtre kaldirilinca sizinti gercekten geri gelmeli (testin gucunun kaniti)'
  );
});

// --- Windows politikası Android'de (Nadir, 2026-09-26): liste `paket-disi-liste.js` ---
// Gerçek fs.copy ile: Windows `files` dizisinin dışladığı her şey APK'nın `www`'sine de
// GİRMEZ; kitap içeriği (assets, bookN/index.html, bookN içindeki build/ ve temp/'in
// storage.im DIŞI dosyaları) GİRER.
async function windowsPolitikasiAgaci() {
  const src = tempDir();
  const dosyalar = {
    'index.html': '<html></html>',
    'assets/56385/pages/1.png': 'PNG',
    'book1/index.html': '<html></html>',
    'book1/temp/data/storage.im': 'YAYINCI-KULLANICI-VERISI',
    'book2/temp/data/storage.im': 'YAYINCI-KULLANICI-VERISI',
    'book1/temp/data/diger.json': '{}',
    'book1/build/motor.js': 'x',
    'temp/data/storage.im': 'KOK-KULLANICI-VERISI',
    'temp/job1/windows/win-ia32-unpacked/x.dll': 'BIN',
    'uploads/s1/build.zip': 'ZIP',
    'build/installer.nsh': 'NSIS',
    'build/icon.ico': 'ICO',
    '_eski/index-2026-09-25.html': '<html></html>',
    '_kok.js': 'x',
  };
  for (const [f, v] of Object.entries(dosyalar)) await fs.outputFile(path.join(src, f), v);
  return src;
}

test('GERİLEME: Android süzgeci storage.im, kök temp/uploads/build ve _eski/\'yi dışlar; içerik geçer', async () => {
  const src = await windowsPolitikasiAgaci();
  const wwwPath = path.join(tempDir(), 'www');
  await fs.copy(src, wwwPath, { filter: createWwwCopyFilter(src) });
  const var_ = (f) => fs.existsSync(path.join(wwwPath, f));

  for (const f of ['book1/temp/data/storage.im', 'book2/temp/data/storage.im', 'temp', 'uploads',
    'build', '_eski']) {
    assert.ok(!var_(f), `${f} APK www'sine sızdı (Windows politikası Android'de uygulanmıyor)`);
  }
  for (const f of ['index.html', 'assets/56385/pages/1.png', 'book1/index.html',
    'book1/temp/data/diger.json', 'book1/build/motor.js', '_kok.js']) {
    assert.ok(var_(f), `${f} yanlışlıkla dışlandı (dışlama fazla geniş)`);
  }
});

test('GERİLEME (testin gücü): süzgeçsiz kopyada aynı ağaç storage.im/temp/build\'i TAŞIR', async () => {
  const src = await windowsPolitikasiAgaci();
  const wwwPath = path.join(tempDir(), 'www');
  await fs.copy(src, wwwPath);
  for (const f of ['book1/temp/data/storage.im', 'temp', 'uploads', 'build', '_eski']) {
    assert.ok(fs.existsSync(path.join(wwwPath, f)), `${f}: sahte ağaç kurulamadı`);
  }
});

// --- Kaynak-sentinel: iki gercek cagri noktasinda filtre fiilen kullaniliyor mu? ---
// NOT (2026-09-26): liste `paket-disi-liste.js`'e taşındı; `createWwwCopyFilter` kök "_"
// dışlamasını da içerir, iki çağrı noktası başka süzgeçle VE'lemez. Sözleşme testi:
// `paket-disi-liste.test.js`.
test('kaynak-sentinel: packageAndroid webapp kopyasi filtre kullanir', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const i = src.indexOf('await fs.copy(workingPath, webAppPath,');
  assert.notStrictEqual(i, -1, 'packageAndroid fs.copy çağrısı bulunamadı');
  const blok = src.slice(i, src.indexOf('});', i) + 3);
  assert.match(blok, /createWwwCopyFilter\(workingPath\)/, 'node_modules dışlaması kaybolmuş');
});

test('kaynak-sentinel: initializeCapacitorProject www kopyasi filtre kullanir', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const i = src.indexOf('await fs.copy(workingPath, wwwPath,');
  assert.notStrictEqual(i, -1, 'initializeCapacitorProject fs.copy çağrısı bulunamadı');
  const blok = src.slice(i, src.indexOf('});', i) + 3);
  assert.match(blok, /createWwwCopyFilter\(workingPath\)/, 'node_modules dışlaması kaybolmuş');
});
