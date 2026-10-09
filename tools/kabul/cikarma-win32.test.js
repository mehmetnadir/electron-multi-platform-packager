'use strict';
/**
 * Windows kasa (unzip/7z yok, tar.exe var) APK/ZIP çıkarma testleri.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { zipAcmaKomutu, zipPaketiAc } = require('./paket-cikar');

const geciciDizin = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `bk-win32-zip-${ad}-`));

test('zipAcmaKomutu: 1. unzip var (her platformda unzip seçilir)', () => {
  const k1 = zipAcmaKomutu({ platform: 'win32', unzipVar: true });
  assert.ok(k1);
  assert.equal(k1.komut, 'unzip');

  const k2 = zipAcmaKomutu({ platform: 'darwin', unzipVar: true });
  assert.ok(k2);
  assert.equal(k2.komut, 'unzip');

  const k3 = zipAcmaKomutu({ platform: 'linux', unzipVar: true });
  assert.ok(k3);
  assert.equal(k3.komut, 'unzip');
});

test('zipAcmaKomutu: 2. win32 unzip yok → tar seçilir', () => {
  const k = zipAcmaKomutu({ platform: 'win32', unzipVar: false });
  assert.ok(k);
  assert.equal(k.komut, 'tar');
});

test('zipAcmaKomutu: 3. darwin/linux unzip yok → null döner', () => {
  assert.equal(zipAcmaKomutu({ platform: 'darwin', unzipVar: false }), null);
  assert.equal(zipAcmaKomutu({ platform: 'linux', unzipVar: false }), null);
});

test('zipAcmaKomutu: 4. arg üretimi (unzip vs tar bağımsız değişkenleri)', () => {
  const unzipSecim = zipAcmaKomutu({ platform: 'darwin', unzipVar: true });
  assert.deepEqual(unzipSecim.arg('ornek.zip', '/hedef/dizin'), ['-q', '-o', 'ornek.zip', '-d', '/hedef/dizin']);

  const tarSecim = zipAcmaKomutu({ platform: 'win32', unzipVar: false });
  assert.deepEqual(tarSecim.arg('ornek.zip', '/hedef/dizin'), ['-xf', 'ornek.zip', '-C', '/hedef/dizin']);
});

test('gerçek fikstür zip extraction (tar -xf ile açılıp dosya sayısı eşleşir)', (t) => {
  const zipVar = spawnSync('zip', ['-v']);
  if (!zipVar || zipVar.status !== 0) {
    t.skip('zip komutu bulunamadı, fikstür testi atlanıyor');
    return;
  }

  const kokDizin = geciciDizin('fikstur');
  const kaynakDizin = path.join(kokDizin, 'kaynak');
  const zipYolu = path.join(kokDizin, 'test-fikstur.zip');
  const hedefDizin = path.join(kokDizin, 'var-olmayan-hedef', 'cikartma');

  try {
    fs.mkdirSync(path.join(kaynakDizin, 'alt'), { recursive: true });
    fs.writeFileSync(path.join(kaynakDizin, 'dosya1.txt'), 'merhaba 1');
    fs.writeFileSync(path.join(kaynakDizin, 'alt', 'dosya2.txt'), 'merhaba 2');

    const zipRes = spawnSync('zip', ['-r', zipYolu, '.'], { cwd: kaynakDizin });
    assert.equal(zipRes.status, 0, 'zip fikstürü oluşturulamadı');

    // win32 + unzip yok simülasyonu (tar -xf kullanılır)
    zipPaketiAc(zipYolu, hedefDizin, { platform: 'win32', unzipVar: false });

    // Dosya sayısını ve içeriği doğrula
    const dosyalar = [];
    const tara = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const tamYol = path.join(d, e.name);
        if (e.isDirectory()) tara(tamYol);
        else if (e.isFile()) dosyalar.push(tamYol);
      }
    };
    tara(hedefDizin);

    assert.equal(dosyalar.length, 2, 'çıkarılan dosya sayısı eşleşmedi');
    assert.ok(fs.existsSync(path.join(hedefDizin, 'dosya1.txt')));
    assert.ok(fs.existsSync(path.join(hedefDizin, 'alt', 'dosya2.txt')));
  } finally {
    fs.rmSync(kokDizin, { recursive: true, force: true });
  }
});
