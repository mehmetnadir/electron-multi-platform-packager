'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Z = require('./calisma-zamani');

const gecici = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `bk-cz-win32-${ad}-`));

test('(a) win32 + mimari x64: gerçek zip açılır, hazirMi ikinci çağrıda önbelleği kullanır', () => {
  const kok = gecici('kok');
  const cacheKok = gecici('cache');
  const shaDir = path.join(cacheKok, 'a1b2c3d4e5f6');
  fs.mkdirSync(shaDir, { recursive: true });

  const icerikDizin = gecici('zip-icerik');
  fs.writeFileSync(path.join(icerikDizin, 'electron.exe'), 'exe-content');
  fs.writeFileSync(path.join(icerikDizin, 'version'), '27.3.11\n');

  const zipYolu = path.join(shaDir, 'electron-v27.3.11-win32-x64.zip');
  const rZip = spawnSync('zip', ['-qr', zipYolu, 'electron.exe', 'version'], { cwd: icerikDizin });
  assert.equal(rZip.status, 0, 'zip olusturulamadi');

  try {
    const r1 = Z.calismaZamaniHazirla({
      surum: '27.3.11',
      kok,
      mimari: 'x64',
      onbellekler: [cacheKok],
      platform: 'win32',
    });

    assert.ok(r1.ikili.endsWith('electron.exe'), `ikili path: ${r1.ikili}`);
    assert.ok(fs.existsSync(r1.ikili), 'ikili dosya mevcut olmali');
    assert.equal(r1.eslesti, true);
    assert.equal(r1.kaynak, zipYolu);
    assert.ok(fs.existsSync(path.join(r1.dizin, '.empp-kabul-hazir.json')), 'HAZIR_ISARETI var');

    // İkinci çağrı: zip yeniden açılmadan hazır dizinden döner (kaynak = hedef)
    const r2 = Z.calismaZamaniHazirla({
      surum: '27.3.11',
      kok,
      mimari: 'x64',
      onbellekler: [cacheKok],
      platform: 'win32',
    });
    assert.equal(r2.kaynak, r2.dizin, 'ikinci çağrıda kaynak = hedef olmalı');
    assert.equal(r2.eslesti, true);
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
    fs.rmSync(cacheKok, { recursive: true, force: true });
    fs.rmSync(icerikDizin, { recursive: true, force: true });
  }
});

test('(b) win32 zip yok ve kanitsizIzin false -> fırlatır; mesaj win32-x64 içerir, darwin içermez', () => {
  const kok = gecici('kok');
  const cacheKok = gecici('cache');
  try {
    assert.throws(
      () => Z.calismaZamaniHazirla({
        surum: '27.3.11',
        kok,
        mimari: 'x64',
        onbellekler: [cacheKok],
        platform: 'win32',
        kanitsizIzin: false,
      }),
      (err) => {
        assert.ok(err.message.includes('win32-x64'), 'mesaj win32-x64 içermeli');
        assert.ok(!err.message.includes('darwin'), 'mesaj darwin içermemeli');
        return true;
      }
    );
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
    fs.rmSync(cacheKok, { recursive: true, force: true });
  }
});

test('(c) win32 zip yok ama kanitsizIzin: true ve yedekDist dizininde electron.exe + version var', () => {
  const kok = gecici('kok');
  const cacheKok = gecici('cache');
  const yedekDist = gecici('dist');
  try {
    fs.writeFileSync(path.join(yedekDist, 'electron.exe'), 'exe');
    fs.writeFileSync(path.join(yedekDist, 'version'), '39.0.0');

    const r = Z.calismaZamaniHazirla({
      surum: '27.3.11',
      kok,
      mimari: 'x64',
      onbellekler: [cacheKok],
      yedekDist,
      kanitsizIzin: true,
      platform: 'win32',
    });

    assert.ok(r.uyari.includes('EMPP_KABUL_KANITSIZ_ZAMAN'), 'uyari EMPP_KABUL_KANITSIZ_ZAMAN içermeli');
    assert.ok(r.ikili.endsWith('electron.exe'), 'ikili electron.exe olmalı');
    assert.ok(fs.existsSync(r.ikili));
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
    fs.rmSync(cacheKok, { recursive: true, force: true });
    fs.rmSync(yedekDist, { recursive: true, force: true });
  }
});

test('(d) darwin gerileme: onbellekZipBul ve ikiliYolu darwin parametresi ile eski davranışı korur', () => {
  const cacheKok = gecici('cache');
  try {
    fs.writeFileSync(path.join(cacheKok, 'electron-v27.3.11-darwin-arm64.zip'), '');
    const found = Z.onbellekZipBul('27.3.11', 'arm64', [cacheKok], 'darwin');
    assert.equal(found, path.join(cacheKok, 'electron-v27.3.11-darwin-arm64.zip'));

    const ikili = Z.ikiliYolu('/some/dir', 'darwin');
    assert.ok(ikili.endsWith('Electron.app/Contents/MacOS/Electron'));
  } finally {
    fs.rmSync(cacheKok, { recursive: true, force: true });
  }
});

test('(e) win32 dalında yalnız tar komutu çağrılır (codesign / ditto vs. çağrılmaz)', () => {
  const kok = gecici('kok');
  const cacheKok = gecici('cache');
  const icerikDizin = gecici('zip-icerik');
  fs.writeFileSync(path.join(icerikDizin, 'electron.exe'), 'exe-content');
  fs.writeFileSync(path.join(icerikDizin, 'version'), '27.3.11\n');

  const zipYolu = path.join(cacheKok, 'electron-v27.3.11-win32-x64.zip');
  spawnSync('zip', ['-qr', zipYolu, 'electron.exe', 'version'], { cwd: icerikDizin });

  const cagrilanKomutlar = [];
  const fakeCalistir = (komut, args) => {
    cagrilanKomutlar.push(komut);
    const r = spawnSync(komut, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`${komut} basarisiz: ${r.stderr}`);
    return r;
  };

  try {
    Z.calismaZamaniHazirla({
      surum: '27.3.11',
      kok,
      mimari: 'x64',
      onbellekler: [cacheKok],
      platform: 'win32',
      calistir: fakeCalistir,
    });

    assert.deepEqual(cagrilanKomutlar, ['tar'], 'win32 hazirlama sirasinda tar disinda komut cagrilmamali');
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
    fs.rmSync(cacheKok, { recursive: true, force: true });
    fs.rmSync(icerikDizin, { recursive: true, force: true });
  }
});
