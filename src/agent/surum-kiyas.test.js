'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  KANONIK_PARCA,
  parcalara,
  kanoniklestir,
  kiyasla,
  ayniSurumMu,
  dahaYeniMi,
} = require('./surum-kiyas');

// ─── REGRESYON ÇEKİRDEĞİ ────────────────────────────────────────────────────
// Bu üç test, düzeltme etkinleştiğinde her işte ~1 GB yeniden indirmeye yol
// açacak regresyonun bekçisidir. Biri düşerse önbellek her işte bayat sayılır.

test('REGRESYON: 1.13.1 (normalleştirilmiş) ile 1.13.1.3 (zip adı) AYNI sürümdür', () => {
  assert.strictEqual(ayniSurumMu('1.13.1', '1.13.1.3'), true);
  assert.strictEqual(ayniSurumMu('1.13.1.3', '1.13.1'), true);
});

test('REGRESYON: 1.13.1 vs 1.13.1.3 "daha yeni" DEĞİLDİR (cache STALE olmamalı)', () => {
  assert.strictEqual(dahaYeniMi('1.13.1', '1.13.1.3'), false);
  assert.strictEqual(dahaYeniMi('1.13.1.3', '1.13.1'), false);
});

test('REGRESYON: normalleştirme eşdeğerliği 5 parçada da geçerli (1.13.1.3.7 ≡ 1.13.1)', () => {
  assert.strictEqual(ayniSurumMu('1.13.1', '1.13.1.3.7'), true);
  assert.strictEqual(dahaYeniMi('1.13.1', '1.13.1.3.7'), false);
});

// ─── GERÇEK İLERLEME HÂLÂ YAKALANMALI ───────────────────────────────────────

test('1.13.1 → 1.13.2 daha yenidir (patch ilerlemesi kaçmamalı)', () => {
  assert.strictEqual(dahaYeniMi('1.13.1', '1.13.2'), true);
  assert.strictEqual(ayniSurumMu('1.13.1', '1.13.2'), false);
});

test('1.13.1 vs 1.13.1 aynıdır, daha yeni değildir', () => {
  assert.strictEqual(ayniSurumMu('1.13.1', '1.13.1'), true);
  assert.strictEqual(dahaYeniMi('1.13.1', '1.13.1'), false);
});

test('4 parçalı mevcut, 3 parçalı YENİ aday: 1.13.1.3 → 1.14.0 daha yenidir', () => {
  assert.strictEqual(dahaYeniMi('1.13.1.3', '1.14.0'), true);
});

test('geri gidiş daha yeni sayılmaz (1.13.2 → 1.13.1)', () => {
  assert.strictEqual(dahaYeniMi('1.13.2', '1.13.1'), false);
  assert.strictEqual(dahaYeniMi('1.14.0', '1.13.1.3'), false);
});

test('major/minor ilerlemesi yakalanır', () => {
  assert.strictEqual(dahaYeniMi('1.13.1', '2.0.0'), true);
  assert.strictEqual(dahaYeniMi('1.13.1', '1.14.0'), true);
  assert.strictEqual(dahaYeniMi('2.0.0', '1.99.99'), false);
});

// ─── KLASİK TUZAK: SAYISAL KIYAS, STRING DEĞİL ──────────────────────────────

test('TUZAK: 1.9.0 → 1.10.0 daha yenidir (string kıyasta "10" < "9" olurdu)', () => {
  assert.strictEqual(dahaYeniMi('1.9.0', '1.10.0'), true);
  assert.strictEqual(dahaYeniMi('1.10.0', '1.9.0'), false);
  assert.strictEqual(kiyasla('1.9.0', '1.10.0'), -1);
});

test('TUZAK: 1.2.9 → 1.2.10 ve 9.0.0 → 10.0.0 sayısal kıyaslanır', () => {
  assert.strictEqual(dahaYeniMi('1.2.9', '1.2.10'), true);
  assert.strictEqual(dahaYeniMi('9.0.0', '10.0.0'), true);
});

test('TUZAK: baştaki sıfırlar sürümü değiştirmez (1.09.0 ≡ 1.9.0)', () => {
  assert.strictEqual(ayniSurumMu('1.09.0', '1.9.0'), true);
  assert.strictEqual(dahaYeniMi('1.09.0', '1.9.0'), false);
  assert.strictEqual(dahaYeniMi('01.13.001', '1.13.1'), false);
  assert.deepStrictEqual(parcalara('1.09.0'), [1, 9, 0]);
});

test('TUZAK: baştaki sıfırlar sekizlik (octal) olarak yorumlanmaz (010 = 10)', () => {
  assert.deepStrictEqual(parcalara('1.010.0'), [1, 10, 0]);
  assert.strictEqual(dahaYeniMi('1.9.0', '1.010.0'), true);
});

// ─── 4-PARÇA vs 4-PARÇA: ESKİ DAVRANIŞ KORUNUR ──────────────────────────────

test('4v4: aynı parça sayısında tam derinlikte kıyas yapılır', () => {
  assert.strictEqual(dahaYeniMi('1.13.1.3', '1.13.1.4'), true);
  assert.strictEqual(dahaYeniMi('1.13.1.4', '1.13.1.3'), false);
  assert.strictEqual(ayniSurumMu('1.13.1.3', '1.13.1.3'), true);
});

// ─── FAIL-SAFE: BELİRSİZ GİRDİDE ASLA "DAHA YENİ" DEME ──────────────────────

test('FAIL-SAFE: undefined / null girdide daha yeni denmez', () => {
  assert.strictEqual(dahaYeniMi(undefined, '1.13.1'), false);
  assert.strictEqual(dahaYeniMi('1.13.1', undefined), false);
  assert.strictEqual(dahaYeniMi(null, null), false);
  assert.strictEqual(ayniSurumMu(undefined, undefined), false);
  assert.strictEqual(ayniSurumMu(null, '1.13.1'), false);
});

test('FAIL-SAFE: boş / sadece boşluk girdide daha yeni denmez', () => {
  assert.strictEqual(dahaYeniMi('', '1.13.1'), false);
  assert.strictEqual(dahaYeniMi('   ', '1.13.1'), false);
  assert.strictEqual(dahaYeniMi('1.13.1', ''), false);
  assert.strictEqual(ayniSurumMu('', ''), false);
});

test('FAIL-SAFE: bozuk / sayısal olmayan girdide daha yeni denmez', () => {
  for (const bozuk of ['abc', 'v1.13.1', '1.13.1-beta', '1..2', '1.', '.1.2', '-1.2.3', '1.2.x', '1.2.3 4']) {
    assert.strictEqual(dahaYeniMi(bozuk, '9.9.9'), false, `dahaYeniMi(${JSON.stringify(bozuk)}, '9.9.9')`);
    assert.strictEqual(dahaYeniMi('1.0.0', bozuk), false, `dahaYeniMi('1.0.0', ${JSON.stringify(bozuk)})`);
    assert.strictEqual(ayniSurumMu(bozuk, bozuk), false, `ayniSurumMu(${JSON.stringify(bozuk)})`);
  }
});

test('FAIL-SAFE: string olmayan tipler (number/array/object) reddedilir', () => {
  // JS deposu — çağıran tip garantisi vermez; sayı gelirse tahmin üretmeyiz.
  for (const girdi of [1, 1.13, [1, 13, 1], { v: '1.13.1' }, true, NaN]) {
    assert.strictEqual(parcalara(girdi), null);
    assert.strictEqual(dahaYeniMi(girdi, '1.13.1'), false);
  }
});

test('kiyasla belirsiz girdide null döner ("bilmiyorum" ≠ "eşit")', () => {
  assert.strictEqual(kiyasla('abc', '1.13.1'), null);
  assert.strictEqual(kiyasla(undefined, undefined), null);
  assert.notStrictEqual(kiyasla('abc', '1.13.1'), 0);
});

// ─── PARÇALARA / KANONİKLEŞTİR ──────────────────────────────────────────────

test('parcalara temel ayrıştırma ve trim davranışı', () => {
  assert.deepStrictEqual(parcalara('1.13.1'), [1, 13, 1]);
  assert.deepStrictEqual(parcalara('1.13.1.3'), [1, 13, 1, 3]);
  assert.deepStrictEqual(parcalara('  1.13.1\n'), [1, 13, 1]);
  assert.deepStrictEqual(parcalara('1'), [1]);
});

test('kanoniklestir 3 parçaya kırpar / 0 ile doldurur', () => {
  assert.strictEqual(KANONIK_PARCA, 3);
  assert.deepStrictEqual(kanoniklestir([1, 13, 1, 3]), [1, 13, 1]);
  assert.deepStrictEqual(kanoniklestir([1]), [1, 0, 0]);
  assert.deepStrictEqual(kanoniklestir([1, 13]), [1, 13, 0]);
  assert.deepStrictEqual(kanoniklestir([1, 13, 1]), [1, 13, 1]);
});

// ─── MEVCUT DAVRANIŞ KORUMASI: version.txt okunamayınca '1' ─────────────────

test('version.txt okunamayınca kullanılan "1" varsayılanı hâlâ güncelleme tetikler', () => {
  // runner.js:355 — read('version.txt') || '1'
  assert.strictEqual(dahaYeniMi('1', '1.13.1.3'), true);
  assert.strictEqual(dahaYeniMi('1', '1.13.1'), true);
});

// ─── İÇ TUTARLILIK ──────────────────────────────────────────────────────────

test('trikotomi: ayrıştırılabilir her çiftte tam olarak biri doğrudur', () => {
  const surumler = ['1', '1.0.0', '1.9.0', '1.10.0', '1.13.1', '1.13.1.3', '1.13.1.4', '1.13.2', '2.0.0'];
  for (const a of surumler) {
    for (const b of surumler) {
      const dogru = [dahaYeniMi(a, b), dahaYeniMi(b, a), ayniSurumMu(a, b)].filter(Boolean).length;
      assert.strictEqual(dogru, 1, `${a} ↔ ${b} — tam olarak 1 bağıntı doğru olmalı, ${dogru} bulundu`);
    }
  }
});

test('simetri: ayniSurumMu argüman sırasından bağımsızdır', () => {
  const ciftler = [['1.13.1', '1.13.1.3'], ['1.09.0', '1.9.0'], ['1', '1.0.0'], ['1.13.1', '1.13.2'], ['abc', '1.13.1']];
  for (const [a, b] of ciftler) {
    assert.strictEqual(ayniSurumMu(a, b), ayniSurumMu(b, a), `${a} ↔ ${b}`);
  }
});

test('saf modül: fs / ağ bağımlılığı yok', () => {
  const kaynak = require('fs').readFileSync(require('path').join(__dirname, 'surum-kiyas.js'), 'utf8');
  assert.strictEqual(/require\(['"](fs|path|child_process|http|https|axios)['"]\)/.test(kaynak), false);
});
