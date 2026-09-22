'use strict';
// GERİLEME (K7, 2026-09-22): panele bağlı pakette kapak yolu ÇİFT SLASH taşır
// ('assets/66357//Uploads/...'); Capacitor yerel sunucusu 404 döner, kapak boş kalır.
// Telefonda ölçüldü: '//' → 404, tek slash → 200 (71.900 bayt).
const test = require('node:test');
const assert = require('node:assert');
const { _internals: I } = require('./empp-android-shim.js');

const O = 'https://localhost';

test('orijin altındaki çift slash teklenir, şemanın // su korunur', () => {
  assert.strictEqual(
    I.slashTekle('https://localhost/assets/66357//Uploads/BekleyenKitapPDF/covers/x.png'),
    'https://localhost/assets/66357/Uploads/BekleyenKitapPDF/covers/x.png');
});

test('göreli yoldaki çift slash teklenir (motorun asıl yazdığı biçim)', () => {
  assert.strictEqual(I.slashTekle('assets/66357//Uploads/Resim/a.png'), 'assets/66357/Uploads/Resim/a.png');
});

test('sorgu ve hash kısmına DOKUNULMAZ', () => {
  assert.strictEqual(I.slashTekle('https://localhost/a//b?u=https://x.com//y#p//q'),
    'https://localhost/a/b?u=https://x.com//y#p//q');
});

test('yerelMi: yalnız orijin ve göreli yollar yereldir', () => {
  assert.strictEqual(I.yerelMi('https://localhost/a//b', O), true);
  assert.strictEqual(I.yerelMi('assets/1//x.png', O), true);
  assert.strictEqual(I.yerelMi('https://www.besegitim.com/Uploads//x.png', O), false);
  assert.strictEqual(I.yerelMi('https://localhostevil.com/a//b', O), false, 'önek çakışması');
  assert.strictEqual(I.yerelMi('//cdn.x.com/a//b', O), false, 'protokol-göreli');
  assert.strictEqual(I.yerelMi('data:image/png;base64,AA//BB', O), false);
  assert.strictEqual(I.yerelMi('blob:https://localhost/x', O), false);
});

test('cssUrlDuzelt: yerel url() düzelir, başka host ve data: aynen kalır', () => {
  assert.strictEqual(
    I.cssUrlDuzelt('background-image: url("https://localhost/assets/1//Uploads/a.png"); color: red', O),
    'background-image: url("https://localhost/assets/1/Uploads/a.png"); color: red');
  assert.strictEqual(I.cssUrlDuzelt('background-image: url(assets/1//a.png)', O),
    'background-image: url(assets/1/a.png)');
  const baska = 'background-image: url("https://www.besegitim.com/Uploads//a.png")';
  assert.strictEqual(I.cssUrlDuzelt(baska, O), baska);
  const veri = 'background: url(data:image/png;base64,AA//BB)';
  assert.strictEqual(I.cssUrlDuzelt(veri, O), veri);
});

test('çift slash YOKSA değer aynen döner (gereksiz yazım → sonsuz MO döngüsü olmaz)', () => {
  const temiz = 'background-image: url("https://localhost/assets/1/Uploads/a.png")';
  assert.strictEqual(I.cssUrlDuzelt(temiz, O), temiz);
});

test('MutationObserver yoksa kurulum DÜŞMEZ (eski WebView / Node testleri)', () => {
  assert.strictEqual(I.installSlashFix(), false);
});
