'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('./g-surum');

test('coz: G3 biçimi 2.<panel>.<sayaç>', () => {
  assert.deepEqual(s.coz('2.51.4'), { ana: 2, panel: 51, sayac: 4 });
  assert.deepEqual(s.coz(' 2.0.0 '), { ana: 2, panel: 0, sayac: 0 });
  for (const kotu of ['1.51.4', '2.51', '2.051.1', '2.51.04', '2.51.4.1', 'v2.51.4', '', null, 2.5, 'a'.repeat(64)]) {
    assert.equal(s.coz(kotu), null, String(kotu));
  }
});

test('kiyasla: sayısal (2.51.10 > 2.51.9), panel önce', () => {
  assert.equal(s.kiyasla('2.51.10', '2.51.9'), 1);
  assert.equal(s.kiyasla('2.51.9', '2.51.10'), -1);
  assert.equal(s.kiyasla('2.52.1', '2.51.99'), 1);
  assert.equal(s.kiyasla('2.51.4', '2.51.4'), 0);
  assert.throws(() => s.kiyasla('1.0.0', '2.51.4'), /G3/);
});

test('enBuyuk: biçim dışılar (içerik-hash sürümleri) yok sayılır', () => {
  assert.equal(s.enBuyuk(['2.51.3', 'a'.repeat(64), '2.51.10', null, '2.50.99']), '2.51.10');
  assert.equal(s.enBuyuk(['a'.repeat(64)]), null);
  assert.equal(s.enBuyuk([]), null);
});

test('panelKoduCoz: sayı ya da kitap adındaki son vNN', () => {
  assert.equal(s.panelKoduCoz(51), 51);
  assert.equal(s.panelKoduCoz('51'), 51);
  assert.equal(s.panelKoduCoz('SM2-MMv51'), 51);
  assert.equal(s.panelKoduCoz('SM4-v50.exe'), 50);
  assert.equal(s.panelKoduCoz('ad-v3-v12'), 12);
  assert.equal(s.panelKoduCoz('ad'), null);
  assert.equal(s.panelKoduCoz(-1), null);
});

test('sonraki: aynı panel sayaç+1, büyük panel 1, küçük panel HATA', () => {
  assert.equal(s.sonraki(51, null), '2.51.1');
  assert.equal(s.sonraki(51, '2.51.3'), '2.51.4');
  assert.equal(s.sonraki('SM2-MMv52', '2.51.9'), '2.52.1');
  assert.throws(() => s.sonraki(50, '2.51.3'), /geri gidiyor/);
  assert.throws(() => s.sonraki('yok', null), /çözülemedi/);
});

test('monotonDenetle: eşit ya da küçük sürüm RED, biçim dışı RED', () => {
  assert.equal(s.monotonDenetle('2.51.4', ['2.51.3', '2.50.9']), '2.51.3');
  assert.equal(s.monotonDenetle('2.51.1', []), null);
  assert.throws(() => s.monotonDenetle('2.51.3', ['2.51.3']), /monoton değil/);
  assert.throws(() => s.monotonDenetle('2.51.2', ['2.51.3']), /monoton değil/);
  assert.throws(() => s.monotonDenetle('abc', []), /G3/);
});
