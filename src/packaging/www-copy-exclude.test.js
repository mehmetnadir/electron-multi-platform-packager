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
const { createWwwCopyFilter, EXCLUDED_SEGMENTS } = require('./www-copy-exclude');

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

test('EXCLUDED_SEGMENTS node_modules ve .git icerir', () => {
  assert.ok(EXCLUDED_SEGMENTS.has('node_modules'));
  assert.ok(EXCLUDED_SEGMENTS.has('.git'));
});

// --- Kaynak-sentinel: iki gercek cagri noktasinda filtre fiilen kullaniliyor mu? ---
test('kaynak-sentinel: packageAndroid webapp kopyasi filtre kullanir', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.match(
    src,
    /await fs\.copy\(workingPath, webAppPath, \{ filter: createWwwCopyFilter\(workingPath\) \}\)/
  );
});

test('kaynak-sentinel: initializeCapacitorProject www kopyasi filtre kullanir', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.match(
    src,
    /await fs\.copy\(workingPath, wwwPath, \{ filter: createWwwCopyFilter\(workingPath\) \}\)/
  );
});
