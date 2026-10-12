'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { grupAdetCoz, kartSayisiHesapla } = require('./cdp-kitap-ac');

test('grup etiketinden 4 okunur', () => {
  const adet1 = grupAdetCoz('Fen Bilimleri serisi, 4 kitap', '', '');
  assert.equal(adet1, 4);

  const adet2 = grupAdetCoz('', '4 kitap', '');
  assert.equal(adet2, 4);

  const adet3 = grupAdetCoz('', '', 'Türkçe serisi\n4 kitap');
  assert.equal(adet3, 4);
});

test('1 grup + beklenen 4 -> sayım geçer', () => {
  const kartlar = [
    { tip: 'webz-grup', ariaLabel: 'Matematik serisi, 4 kitap', metin: '4 kitap' },
  ];
  const sayim = kartSayisiHesapla(kartlar);
  assert.equal(sayim, 4);

  const kartlarKarma = [
    { tip: 'webz-grup', ariaLabel: 'Matematik serisi, 4 kitap' },
    { tip: 'webz', metin: 'Kitap 5' },
  ];
  assert.equal(kartSayisiHesapla(kartlarKarma), 5);
});

test('grupsuz eski davranış aynı', () => {
  const kartlar = [
    { tip: 'webz', metin: 'Kitap 1' },
    { tip: 'webz', metin: 'Kitap 2' },
    { tip: 'webz', metin: 'Kitap 3' },
  ];
  const sayim = kartSayisiHesapla(kartlar);
  assert.equal(sayim, 3);
});
