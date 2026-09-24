'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mainAdlari, parcaAdlari } = require('./kabuk-kanonik-doldur');

const H = (c) => c.repeat(20);

test('mainAdlari: index.html\'den main.js ve main.css', () => {
  const html = `<script defer="defer" src="./${H('a')}.main.js"></script><link href="./${H('b')}.main.css" rel="stylesheet">`;
  assert.deepEqual(mainAdlari(html), { js: `${H('a')}.main.js`, css: `${H('b')}.main.css` });
  assert.deepEqual(mainAdlari('<html></html>'), { js: null, css: null });
});

test('parcaAdlari: ilk harita js, sonraki css (webpack 5 sırası, 73768 ölçümü)', () => {
  const m = `a={0:"${H('1')}",923:"${H('2')}"};b={907:"${H('3')}"}`;
  assert.deepEqual(parcaAdlari(m), [`${H('1')}.0.js`, `${H('2')}.923.js`, `${H('3')}.907.css`]);
});

test('cekirdekBasvurulari: core/ varlıkları tekil+sıralı, .. reddedilir', () => {
  const { cekirdekBasvurulari } = require('./kabuk-kanonik-doldur');
  assert.deepEqual(cekirdekBasvurulari(['a="core/icons/B.svg";b="core/j.png";c="core/j.png"', 'core/../x.png']),
    ['core/icons/B.svg', 'core/j.png']);
});
