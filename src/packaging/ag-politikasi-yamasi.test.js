const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { paketeUygula, icerigeEnjekteEt, acikMi, DOSYA_ADI } = require('./ag-politikasi-yamasi.js');

async function gecici() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'agpol-'));
}

test('<head> varsa betik HEAD\'in hemen başına girer (motordan ÖNCE)', () => {
  const r = icerigeEnjekteEt('<html><head><script src="motor.js"></script></head></html>', DOSYA_ADI);
  assert.strictEqual(r.durum, 'enjekte');
  assert.ok(r.html.indexOf(DOSYA_ADI) < r.html.indexOf('motor.js'), 'politika motordan önce yüklenmeli');
});

test('<head> yoksa betik en başa konur', () => {
  const r = icerigeEnjekteEt('<div>x</div>', DOSYA_ADI);
  assert.strictEqual(r.durum, 'enjekte');
  assert.ok(r.html.startsWith('<script'));
});

test('GERİLEME: zaten enjekte edilmişse İKİNCİ kez eklenmez', () => {
  const bir = icerigeEnjekteEt('<html><head></head></html>', DOSYA_ADI);
  const iki = icerigeEnjekteEt(bir.html, DOSYA_ADI);
  assert.strictEqual(iki.durum, 'zaten-var');
  assert.strictEqual(iki.html.split(DOSYA_ADI).length - 1, 1);
});

test('kök + alt-kitaplara enjekte eder, alt-kitap GÖRELİ src alır (dosya kopyalanmaz)', async () => {
  const d = await gecici();
  await fs.writeFile(path.join(d, 'index.html'), '<html><head></head></html>');
  for (const b of ['book1', 'book2']) {
    await fs.ensureDir(path.join(d, b));
    await fs.writeFile(path.join(d, b, 'index.html'), '<html><head></head></html>');
  }
  const s = await paketeUygula(d);
  assert.strictEqual(s.kopyalandi, true);
  assert.deepStrictEqual(s.enjekte, ['(kök)', 'book1', 'book2']);
  assert.ok(await fs.pathExists(path.join(d, DOSYA_ADI)), 'politika dosyası kökte olmalı');
  assert.strictEqual(await fs.pathExists(path.join(d, 'book1', DOSYA_ADI)), false,
    'GERİLEME: alt-kitaba KOPYALANMAMALI (tek kopya + göreli src)');
  const alt = await fs.readFile(path.join(d, 'book1', 'index.html'), 'utf8');
  assert.ok(alt.includes('src="../' + DOSYA_ADI + '"'), 'alt-kitap göreli src almalı, gördüğüm: ' + alt);
  const kok = await fs.readFile(path.join(d, 'index.html'), 'utf8');
  assert.ok(kok.includes('src="' + DOSYA_ADI + '"') && !kok.includes('../'), 'kök göreli önek ALMAMALI');
  await fs.remove(d);
});

test('kopyalanan dosya gerçekten çalışır (kararVer dışa açık)', async () => {
  const d = await gecici();
  await fs.writeFile(path.join(d, 'index.html'), '<html><head></head></html>');
  await paketeUygula(d);
  const m = require(path.join(d, DOSYA_ADI));
  assert.strictEqual(m.kararVer('https://a.tld/x?id=undefined').eylem, 'engelle');
  await fs.remove(d);
});

test('book olmayan dizinler alt-kitap sayılmaz', async () => {
  const d = await gecici();
  await fs.writeFile(path.join(d, 'index.html'), '<html><head></head></html>');
  for (const ad of ['assets', 'core', 'bookshelf', 'classlibraries']) {
    await fs.ensureDir(path.join(d, ad));
    await fs.writeFile(path.join(d, ad, 'index.html'), '<html><head></head></html>');
  }
  const s = await paketeUygula(d);
  assert.deepStrictEqual(s.enjekte, ['(kök)']);
  await fs.remove(d);
});

test('GERİLEME: hiç index.html yoksa dosya bile kopyalanmaz (çöp bırakma)', async () => {
  const d = await gecici();
  const s = await paketeUygula(d);
  assert.strictEqual(s.kopyalandi, false);
  assert.strictEqual(s.sebep, 'index-yok');
  assert.strictEqual(await fs.pathExists(path.join(d, DOSYA_ADI)), false);
  await fs.remove(d);
});

test('kök index yok ama alt-kitap varsa yine çalışır', async () => {
  const d = await gecici();
  await fs.ensureDir(path.join(d, 'book1'));
  await fs.writeFile(path.join(d, 'book1', 'index.html'), '<html><head></head></html>');
  const s = await paketeUygula(d);
  assert.deepStrictEqual(s.enjekte, ['book1']);
  assert.deepStrictEqual(s.atlanan, [{ ad: '(kök)', sebep: 'index-yok' }]);
  await fs.remove(d);
});

test('GERİLEME: yazma atomik — geçici dosya bırakılmaz', async () => {
  const d = await gecici();
  await fs.writeFile(path.join(d, 'index.html'), '<html><head></head></html>');
  await paketeUygula(d);
  const kalan = (await fs.readdir(d)).filter((f) => f.endsWith('.empp-tmp'));
  assert.deepStrictEqual(kalan, []);
  await fs.remove(d);
});

test('kapı: varsayılan AÇIK, yalnız "0" kapatır', () => {
  assert.strictEqual(acikMi({}), true);
  assert.strictEqual(acikMi({ EMPP_AG_POLITIKASI: '1' }), true);
  assert.strictEqual(acikMi({ EMPP_AG_POLITIKASI: '0' }), false);
});
