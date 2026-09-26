'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const z = require('./zip-yaz');
const kg = require('../../src/runtime/kitap-guncelleyici');

function gecici() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'g-zip-'));
}

test('crc32 bilinen değer', () => {
  assert.equal(z.crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('dizinden zip → istemcinin okuyucusu birebir açar (UTF-8 ad, stored + deflate)', () => {
  const d = gecici();
  const kok = path.join(d, 'book4');
  fs.mkdirSync(path.join(kok, 'sayfa'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'index.html'), '<html>' + 'x'.repeat(5000) + '</html>');
  fs.writeFileSync(path.join(kok, 'sayfa', 'ölçü.txt'), 'ç');
  fs.writeFileSync(path.join(kok, 'rastgele.bin'), require('crypto').randomBytes(2048));
  const hedef = path.join(d, 'k.zip');
  const r = z.zipYaz(hedef, z.dizindenGirdiler(kok));
  assert.equal(r.adet, 3);
  const acilan = kg.arsivCozVarsayilan(fs.readFileSync(hedef));
  const harita = Object.fromEntries(acilan.map((g) => [g.yol, g.veri]));
  assert.deepEqual(Object.keys(harita).sort(), ['index.html', 'rastgele.bin', 'sayfa/ölçü.txt']);
  assert.equal(harita['sayfa/ölçü.txt'].toString('utf8'), 'ç');
  assert.deepEqual(harita['rastgele.bin'], fs.readFileSync(path.join(kok, 'rastgele.bin')));
  assert.deepEqual(z.zipDenetle(hedef).yollar.sort(), [
    'index.html',
    'rastgele.bin',
    'sayfa/ölçü.txt',
  ]);
});

test('belirlenimci: aynı içerik aynı sha256', () => {
  const d = gecici();
  const g = [
    { yol: 'a.txt', veri: Buffer.from('a') },
    { yol: 'b/c.txt', veri: Buffer.from('c'.repeat(100)) },
  ];
  const r1 = z.zipYaz(path.join(d, '1.zip'), g);
  const r2 = z.zipYaz(path.join(d, '2.zip'), g);
  assert.equal(r1.sha256, r2.sha256);
});

test('zipDenetle: kaçış yolu, tek sarmal dizin, boş arşiv ve bozuk dosya RED', () => {
  const d = gecici();
  z.zipYaz(path.join(d, 'kacis.zip'), [
    { yol: 'index.html', veri: Buffer.from('x') },
    { yol: '../../kacti.txt', veri: Buffer.from('k') },
  ]);
  assert.throws(() => z.zipDenetle(path.join(d, 'kacis.zip')), /güvensiz yol/);
  z.zipYaz(path.join(d, 'sarmal.zip'), [
    { yol: 'book4/index.html', veri: Buffer.from('x') },
    { yol: 'book4/a/b.txt', veri: Buffer.from('y') },
  ]);
  assert.throws(() => z.zipDenetle(path.join(d, 'sarmal.zip')), /tek sarmal dizin/);
  z.zipYaz(path.join(d, 'bos.zip'), []);
  assert.throws(() => z.zipDenetle(path.join(d, 'bos.zip')), /boş/);
  fs.writeFileSync(path.join(d, 'bozuk.zip'), 'zip değil');
  assert.throws(() => z.zipDenetle(path.join(d, 'bozuk.zip')), /açılamadı/);
});

test('sembolik bağ içeren dizin RED (sessiz atlama yok)', () => {
  const d = gecici();
  fs.mkdirSync(path.join(d, 'k'));
  fs.writeFileSync(path.join(d, 'k', 'a.txt'), 'a');
  fs.symlinkSync('/etc/hosts', path.join(d, 'k', 'dis'));
  assert.throws(() => z.dizindenGirdiler(path.join(d, 'k')), /sembolik bağ/);
});

test('Zip64 sınırı: 65535 girdi RED (istemci açamaz)', () => {
  const d = gecici();
  const cok = { length: z.GIRDI_TAVAN };
  assert.throws(() => z.zipYaz(path.join(d, 'x.zip'), Object.assign([], cok)), /Zip64/);
  assert.equal(typeof zlib.inflateRawSync, 'function');
});
