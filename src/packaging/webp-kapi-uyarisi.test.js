'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { uyariMetni } = require('./webp-kapi-uyarisi');

test('kapı kapalı — env yok (undefined) → null', () => {
  assert.strictEqual(uyariMetni(undefined), null);
});

test('kapı kapalı — env null → null', () => {
  assert.strictEqual(uyariMetni(null), null);
});

test('kapı kapalı — boş env objesi → null', () => {
  assert.strictEqual(uyariMetni({}), null);
});

test('kapı kapalı — EMPP_SAYFA_WEBP="0" → null', () => {
  assert.strictEqual(uyariMetni({ EMPP_SAYFA_WEBP: '0' }), null);
});

test('kapı kapalı — EMPP_SAYFA_WEBP="true" (yanlış tip) → null', () => {
  assert.strictEqual(uyariMetni({ EMPP_SAYFA_WEBP: 'true' }), null);
});

test('kapı kapalı — EMPP_SAYFA_WEBP sayısal 1 (string değil) → null', () => {
  assert.strictEqual(uyariMetni({ EMPP_SAYFA_WEBP: 1 }), null);
});

test('kapı açık — EMPP_SAYFA_WEBP="1" → dizge döner (null değil)', () => {
  const sonuc = uyariMetni({ EMPP_SAYFA_WEBP: '1' });
  assert.strictEqual(typeof sonuc, 'string');
  assert.notStrictEqual(sonuc, null);
});

test('kapı açık — mesaj "UYARI" ile başlar ve env anahtarını adlandırır', () => {
  const sonuc = uyariMetni({ EMPP_SAYFA_WEBP: '1' });
  assert.match(sonuc, /^UYARI:/);
  assert.match(sonuc, /EMPP_SAYFA_WEBP=1/);
});

test('kapı açık — mesaj ProBook kabul kapısına atıf yapar', () => {
  const sonuc = uyariMetni({ EMPP_SAYFA_WEBP: '1' });
  assert.match(sonuc, /ProBook kabul kapısından/);
});

test('kapı açık — diğer env anahtarları mesajı etkilemez', () => {
  const sonuc = uyariMetni({ EMPP_SAYFA_WEBP: '1', PORT: '3001', NODE_ENV: 'production' });
  assert.match(sonuc, /^UYARI:/);
});

test('process.env üzerinden gerçek kullanım — açık', () => {
  const onceki = process.env.EMPP_SAYFA_WEBP;
  process.env.EMPP_SAYFA_WEBP = '1';
  try {
    assert.notStrictEqual(uyariMetni(process.env), null);
  } finally {
    if (onceki === undefined) delete process.env.EMPP_SAYFA_WEBP;
    else process.env.EMPP_SAYFA_WEBP = onceki;
  }
});

test('process.env üzerinden gerçek kullanım — kapalı (anahtar yok)', () => {
  const onceki = process.env.EMPP_SAYFA_WEBP;
  delete process.env.EMPP_SAYFA_WEBP;
  try {
    assert.strictEqual(uyariMetni(process.env), null);
  } finally {
    if (onceki !== undefined) process.env.EMPP_SAYFA_WEBP = onceki;
  }
});
