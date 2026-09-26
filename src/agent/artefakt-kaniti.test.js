'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { artefaktOzeti } = require('./artefakt-kaniti');

test('artefaktOzeti: küçük dosyada sha256 + boyut node:crypto ile birebir eşleşir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artefakt-kaniti-'));
  const dosya = path.join(dir, 'sahte.apk');
  const icerik = Buffer.from('sahte artefakt içeriği — yükleme kanıtı 12345');
  fs.writeFileSync(dosya, icerik);
  try {
    const oz = await artefaktOzeti(dosya);
    assert.strictEqual(oz.sha256, crypto.createHash('sha256').update(icerik).digest('hex'));
    assert.strictEqual(oz.boyut, icerik.length);
    assert.match(oz.sha256, /^[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('artefaktOzeti: highWaterMark (8MB) üstü çok parçalı dosyada da doğru birleşir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artefakt-kaniti-buyuk-'));
  const dosya = path.join(dir, 'sahte-buyuk.dmg');
  // 8<<20 highWaterMark'ı ~2.5 kez aşacak kadar rastgele içerik — parça sınırında
  // hash yalnız ilk/son parçadan hesaplanırsa (akış bağlama hatası) bu test yakalar.
  const icerik = crypto.randomBytes(20 * 1024 * 1024 + 777);
  fs.writeFileSync(dosya, icerik);
  try {
    const oz = await artefaktOzeti(dosya);
    assert.strictEqual(oz.sha256, crypto.createHash('sha256').update(icerik).digest('hex'));
    assert.strictEqual(oz.boyut, icerik.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('artefaktOzeti: boş dosyada da tanımlı sha256 (node crypto boş-girdi özeti) döner', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artefakt-kaniti-bos-'));
  const dosya = path.join(dir, 'bos.bin');
  fs.writeFileSync(dosya, Buffer.alloc(0));
  try {
    const oz = await artefaktOzeti(dosya);
    assert.strictEqual(oz.boyut, 0);
    assert.strictEqual(oz.sha256, crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('artefaktOzeti: olmayan dosyada reddeder — sessizce yutmaz', async () => {
  await assert.rejects(
    () => artefaktOzeti(path.join(os.tmpdir(), 'yok-boyle-bir-dosya-artefakt-kaniti-testi.bin')),
    /ENOENT/,
  );
});
