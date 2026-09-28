const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { insaHataMesaji } = require('./insaHataMesaji');

describe('insaHataMesaji', () => {
  test('(a) detaysız -> tam eski metin', () => {
    const res1 = insaHataMesaji('mac', 1, '', '');
    assert.equal(res1, 'Electron Builder mac build failed (exit code 1)');

    const res2 = insaHataMesaji('win', 2, null, null);
    assert.equal(res2, 'Electron Builder win build failed (exit code 2)');
  });

  test('(b) uzun çıktı -> son 800 karakter + önek korunur', () => {
    const longOutput = 'A'.repeat(1200) + 'SON_SATIR_SONUCU';
    const res = insaHataMesaji('mac', 1, longOutput, '');
    const prefix = 'Electron Builder mac build failed (exit code 1) — ';
    assert.ok(res.startsWith(prefix));
    const detay = res.slice(prefix.length);
    assert.equal(detay.length, 800);
    assert.ok(detay.endsWith('SON_SATIR_SONUCU'));
  });

  test('(c) ANSI temizlenir', () => {
    const ansiOutput = '\x1b[31mHata olustu\x1b[0m\n\x1b[1;32mDevam ediyor\x1b[0m';
    const res = insaHataMesaji('mac', 1, ansiOutput, '');
    assert.equal(res, 'Electron Builder mac build failed (exit code 1) — Hata olustu\nDevam ediyor');
    assert.ok(!res.includes('\x1b'));
  });

  test("(d) 'CSC_KEY_PASSWORD=abc123' -> abc123 görünmez", () => {
    const secretOutput = 'Derleme hatası\nCSC_KEY_PASSWORD=abc123\nAPPLE_ID_PASSWORD: secretPass';
    const res = insaHataMesaji('mac', 1, secretOutput, '');
    assert.ok(!res.includes('abc123'));
    assert.ok(!res.includes('secretPass'));
    assert.ok(res.includes('CSC_KEY_PASSWORD=***'));
    assert.ok(res.includes('APPLE_ID_PASSWORD: ***'));
  });

  test('(e) errorOutput boşsa output kullanılır', () => {
    const res = insaHataMesaji('linux', 3, '', 'stdout log hatasi');
    assert.equal(res, 'Electron Builder linux build failed (exit code 3) — stdout log hatasi');
  });
});
