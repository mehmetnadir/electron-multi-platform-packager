'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ucParcayaCevir, yazilacakSurum, acikMi } = require('./surum-normallestir');

test('ucParcayaCevir: "1.13.1.3" -> "1.13.1" (4 parça -> ilk üç)', () => {
  assert.strictEqual(ucParcayaCevir('1.13.1.3'), '1.13.1');
});

test('ucParcayaCevir: "1.13.8" -> "1.13.8" (3 parça değişmez)', () => {
  assert.strictEqual(ucParcayaCevir('1.13.8'), '1.13.8');
});

test('ucParcayaCevir: "1.13" -> null (2 parça, 0 ile doldurulmaz)', () => {
  assert.strictEqual(ucParcayaCevir('1.13'), null);
});

test('ucParcayaCevir: "1" -> null (tek parça)', () => {
  assert.strictEqual(ucParcayaCevir('1'), null);
});

test('ucParcayaCevir: "" -> null (boş string)', () => {
  assert.strictEqual(ucParcayaCevir(''), null);
});

test('ucParcayaCevir: null -> null', () => {
  assert.strictEqual(ucParcayaCevir(null), null);
});

test('ucParcayaCevir: undefined -> null', () => {
  assert.strictEqual(ucParcayaCevir(undefined), null);
});

test('ucParcayaCevir: harf içeren "1.a.3" -> null', () => {
  assert.strictEqual(ucParcayaCevir('1.a.3'), null);
});

test('ucParcayaCevir: negatif "1.-2.3" -> null', () => {
  assert.strictEqual(ucParcayaCevir('1.-2.3'), null);
});

test('ucParcayaCevir: "\\r\\n 1.13.8 \\r\\n" -> "1.13.8" (boşluk/CRLF temizliği)', () => {
  assert.strictEqual(ucParcayaCevir('\r\n 1.13.8 \r\n'), '1.13.8');
});

test('ucParcayaCevir: "01.2.3" -> "01.2.3" (baştaki sıfırları korur)', () => {
  assert.strictEqual(ucParcayaCevir('01.2.3'), '01.2.3');
});

test('ucParcayaCevir: "1.2.3.4.5" -> "1.2.3" (3\'ten fazla parça durumunda ilk üç parça)', () => {
  assert.strictEqual(ucParcayaCevir('1.2.3.4.5'), '1.2.3');
});

test('ucParcayaCevir: "   " -> null (sadece boşluk içeren string)', () => {
  assert.strictEqual(ucParcayaCevir('   '), null);
});

test('ucParcayaCevir: string dışı tipler için null döner (sayı, nesne)', () => {
  assert.strictEqual(ucParcayaCevir(123), null);
  assert.strictEqual(ucParcayaCevir({}), null);
});

test('yazilacakSurum: ("1.13.1.3", "1.13.1.3") -> { deger: "1.13.1", sebep: "normallestirildi" } (gerçek vaka)', () => {
  const sonuc = yazilacakSurum('1.13.1.3', '1.13.1.3');
  assert.deepStrictEqual(sonuc, {
    deger: '1.13.1',
    sebep: 'normallestirildi'
  });
});

test('yazilacakSurum: ("1.13.8", "1.13.8") -> sebep: "zaten-uygun"', () => {
  const sonuc = yazilacakSurum('1.13.8', '1.13.8');
  assert.deepStrictEqual(sonuc, {
    deger: '1.13.8',
    sebep: 'zaten-uygun'
  });
});

test('yazilacakSurum: trimlenmiş eşitlikte de "zaten-uygun" döner', () => {
  const sonuc = yazilacakSurum('\r\n 1.13.8 \r\n', '1.13.8');
  assert.deepStrictEqual(sonuc, {
    deger: '1.13.8',
    sebep: 'zaten-uygun'
  });
});

test('yazilacakSurum: ("1.13", "1.11.5") -> { deger: null, sebep: "normallestirilemedi-korundu" } (fail-safe: mevcut korunur)', () => {
  const sonuc = yazilacakSurum('1.13', '1.11.5');
  assert.deepStrictEqual(sonuc, {
    deger: null,
    sebep: 'normallestirilemedi-korundu'
  });
});

test('yazilacakSurum: geçersiz girdi durumunda null ve "normallestirilemedi-korundu" döner', () => {
  const sonuc = yazilacakSurum(null, '1.11.5');
  assert.deepStrictEqual(sonuc, {
    deger: null,
    sebep: 'normallestirilemedi-korundu'
  });
});

test('acikMi: { EMPP_SURUM_NORMALLESTIR: "0" } -> false', () => {
  assert.strictEqual(acikMi({ EMPP_SURUM_NORMALLESTIR: '0' }), false);
});

test('acikMi: {} -> true (varsayılan açık)', () => {
  assert.strictEqual(acikMi({}), true);
});

test('acikMi: { EMPP_SURUM_NORMALLESTIR: "1" } -> true', () => {
  assert.strictEqual(acikMi({ EMPP_SURUM_NORMALLESTIR: '1' }), true);
});

test('acikMi: parametresiz çağrıda process.env fallback kullanarak çalışır', () => {
  const eskiDeger = process.env.EMPP_SURUM_NORMALLESTIR;
  try {
    delete process.env.EMPP_SURUM_NORMALLESTIR;
    assert.strictEqual(acikMi(), true);

    process.env.EMPP_SURUM_NORMALLESTIR = '0';
    assert.strictEqual(acikMi(), false);
  } finally {
    if (eskiDeger !== undefined) {
      process.env.EMPP_SURUM_NORMALLESTIR = eskiDeger;
    } else {
      delete process.env.EMPP_SURUM_NORMALLESTIR;
    }
  }
});
