'use strict';
// AppRun'in calistirilabilir cozumleme mantigini GERCEKTEN KOSARAK dogrular.
//
// Saha dersi (2026-09-08): uretilen .impark'lar ilk acilista
// "Kurulum basarisiz! Executable bulunamadi: .../electron" veriyordu. Sebep:
// sablon yalniz zkitap / zkitap.bin / electron adlarina bakiyordu, oysa
// electron-builder ikiliyi productName'den turetiyor (or. "ucan-balik-36+").
// Bu test kalibi metinde ARAMAZ; fonksiyonu sablondan cikarip bash ile kosturur.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TEMPLATE = path.join(__dirname, 'apprun-template.sh');

function resolveExecutableIn(appPath) {
  const src = fs.readFileSync(TEMPLATE, 'utf8');
  const start = src.indexOf('resolve_executable() {');
  assert.notStrictEqual(start, -1, 'sablonda resolve_executable fonksiyonu yok');
  const end = src.indexOf('\n}', start);
  assert.notStrictEqual(end, -1, 'resolve_executable govdesi kapanmiyor');
  const fn = src.slice(start, end + 2);
  const script = `appPath=${JSON.stringify(appPath)}\n${fn}\nresolve_executable\n`;
  return execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim();
}

function kurulumKur(dosyalar) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apprun-test-'));
  for (const [ad, calistirilabilir] of Object.entries(dosyalar)) {
    const p = path.join(dir, ad);
    // Gercek ikililer ELF'tir; sablon ELF sihrine bakar (calistirilmaz, yalniz okunur).
    fs.writeFileSync(p, calistirilabilir ? '\x7fELF\x02\x01\x01' : 'veri');
    fs.chmodSync(p, calistirilabilir ? 0o755 : 0o644);
  }
  return dir;
}

// Gercek bir AppDir kokunun ozeti
const GERCEK_KOK = {
  'AppRun': true,
  'chrome-sandbox': true,
  'chrome_crashpad_handler': true,
  'libEGL.so': true,
  'libvulkan.so.1': true,
  'LICENSES.chromium.html': false,
  'resources.pak': false,
  // AppRun kurulum adimi `find -name "*.bin" | chmod +x` yapar: Electron'un veri
  // dosyalari da +x olur (sahada 2026-09-08: snapshot_blob.bin secildi, acilis dustu).
  'snapshot_blob.bin': true,
  'v8_context_snapshot.bin': true,
};

// .bin dosyalari ELF degil; kurulumKur onlari da ELF yazar — burada gercekci veri ile ez.
function binVerisiYap(dir) {
  for (const ad of ['snapshot_blob.bin', 'v8_context_snapshot.bin']) {
    const p = path.join(dir, ad);
    if (fs.existsSync(p)) { fs.writeFileSync(p, 'VEKTOR'); fs.chmodSync(p, 0o755); }
  }
  return dir;
}

test('urun adiyla paketlenen ikiliyi bulur (asil kusur)', () => {
  const dir = binVerisiYap(kurulumKur({ ...GERCEK_KOK, 'ucan-balik-36+': true }));
  assert.strictEqual(resolveExecutableIn(dir), path.join(dir, 'ucan-balik-36+'));
});

test('zkitap varsa onu tercih eder (geriye donuk uyum)', () => {
  const dir = kurulumKur({ ...GERCEK_KOK, 'zkitap': true, 'ucan-balik-36+': true });
  assert.strictEqual(resolveExecutableIn(dir), path.join(dir, 'zkitap'));
});

test('electron adini da tanir', () => {
  const dir = kurulumKur({ ...GERCEK_KOK, 'electron': true });
  assert.strictEqual(resolveExecutableIn(dir), path.join(dir, 'electron'));
});

test('.desktop adiyla ayni ikiliyi tercih eder (electron-builder executableName kurali)', () => {
  const dir = binVerisiYap(kurulumKur({ ...GERCEK_KOK, 'own-it-1-worbook': true, 'own-it-1-worbook.desktop': false }));
  assert.strictEqual(resolveExecutableIn(dir), path.join(dir, 'own-it-1-worbook'));
});

test('+x yapilmis snapshot_blob.bin / v8_context_snapshot.bin ASLA secilmez (saha 2026-09-08)', () => {
  const dir = binVerisiYap(kurulumKur({ ...GERCEK_KOK, 'zzz-urun': true })); // .desktop yok, ad alfabetik sonda
  assert.strictEqual(resolveExecutableIn(dir), path.join(dir, 'zzz-urun'));
});

test('kutuphane veya yardimci ikiliyi ASLA secmez', () => {
  const dir = binVerisiYap(kurulumKur(GERCEK_KOK));       // urun ikilisi yok
  const sonuc = resolveExecutableIn(dir);
  const ad = path.basename(sonuc);
  assert.ok(!ad.includes('.so'), `kutuphane secildi: ${ad}`);
  assert.notStrictEqual(ad, 'chrome-sandbox');
  assert.notStrictEqual(ad, 'chrome_crashpad_handler');
  assert.notStrictEqual(ad, 'AppRun');
  assert.ok(!ad.endsWith('.bin'), `veri dosyasi secildi: ${ad}`);
});
