'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { arsivKaynagi, arsivKoku } = require('./kaynak-arsivi');

function kur(icerik = 'zip-icerigi', kayitEk = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'kaynak-arsivi-'));
  const dizin = path.join(kok, '45482');
  fs.mkdirSync(dizin);
  fs.writeFileSync(path.join(dizin, 'build.zip'), icerik);
  const md5 = crypto.createHash('md5').update(icerik).digest('hex');
  const kayit = { dosya: 'build.zip', md5, boyut: Buffer.byteLength(icerik), etiket: 'uretim-masasi-20260925', ...kayitEk };
  fs.writeFileSync(path.join(dizin, 'kaynak.json'), JSON.stringify(kayit));
  return { kok, dizin, md5 };
}

test('kayıt yoksa null — runner İmpark exe yoluna devam eder', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'kaynak-arsivi-'));
  assert.equal(await arsivKaynagi(45482, { kok }), null);
});

test('geçerli kayıt: zip yolu, md5 ve arşive özgü srcVersion döner', async () => {
  const { kok, dizin, md5 } = kur();
  const r = await arsivKaynagi(45482, { kok });
  assert.equal(r.zip, path.join(dizin, 'build.zip'));
  assert.equal(r.md5, md5);
  assert.equal(r.srcVersion, `arsiv-${md5.slice(0, 12)}`);
  assert.equal(r.etiket, 'uretim-masasi-20260925');
  assert.ok(fs.existsSync(path.join(dizin, '.md5-dogrulandi')), 'md5 damgası yazılmalı');
});

test('GERİLEME: kayıt var ama zip yoksa HATA — eski kaynağa sessizce düşmez', async () => {
  const { kok, dizin } = kur();
  fs.renameSync(path.join(dizin, 'build.zip'), path.join(dizin, 'baska.zip'));
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /zip yok/);
});

test('boyut tutmuyorsa HATA', async () => {
  const { kok } = kur('abc', { boyut: 999 });
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /boyut tutmuyor/);
});

test('md5 tutmuyorsa HATA ve damga yazılmaz', async () => {
  const { kok, dizin } = kur('abc', { md5: '0'.repeat(32) });
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /md5 tutmuyor/);
  assert.ok(!fs.existsSync(path.join(dizin, '.md5-dogrulandi')));
});

test('dosya alanı yol taşıyamaz (arşiv dışına çıkma yok)', async () => {
  const { kok } = kur('abc', { dosya: '../build.zip' });
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /dosya alanı geçersiz/);
});

test('içerik değişince (aynı boyut, yeni mtime) md5 yeniden hesaplanır', async () => {
  const { kok, dizin } = kur('abc');
  await arsivKaynagi(45482, { kok });
  const zip = path.join(dizin, 'build.zip');
  fs.writeFileSync(zip, 'xyz');
  const ileri = new Date(Date.now() + 5000);
  fs.utimesSync(zip, ileri, ileri);
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /md5 tutmuyor/);
});

test('arsivKoku: EMPP_KAYNAK_ARSIVI önceliklidir', () => {
  assert.equal(arsivKoku({ EMPP_KAYNAK_ARSIVI: '/x/y' }), '/x/y');
  assert.match(arsivKoku({}), /\.empp-agent\/kaynak-arsivi$/);
});
