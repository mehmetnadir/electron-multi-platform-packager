'use strict';
// PLATFORM KAPSAMLI KAPI BAYRAKLARI (2026-09-26) — bkz. platform-kapisi.js başlığı.
// Windows sözleşmesi ONAYLI, onay yalnız Windows'u kapsıyor; 25.09'da genel bayrak yüzünden
// bir mac DMG'sine taslak modüller girdi. Bu testler kapsam kuralını kilitler.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PLATFORMLAR, degerCoz, kapiAcikMi, kapiDurumu } = require('./platform-kapisi');

const AD = 'EMPP_DENEME_KAPI';
function kayitci() {
  const satirlar = [];
  return { satirlar, secenek: { uyar: (s) => satirlar.push(s) } };
}

test('degerCoz: tanımsız/boş → varsayılan, 0 → kapalı, 1 → açık, diğer → liste', () => {
  assert.strictEqual(degerCoz(undefined).tip, 'varsayilan');
  assert.strictEqual(degerCoz(null).tip, 'varsayilan');
  assert.strictEqual(degerCoz('').tip, 'varsayilan');
  assert.strictEqual(degerCoz('  ').tip, 'varsayilan');
  assert.strictEqual(degerCoz('0').tip, 'kapali');
  assert.strictEqual(degerCoz(0).tip, 'kapali');
  assert.strictEqual(degerCoz('1').tip, 'acik');
  assert.deepStrictEqual(degerCoz(' Windows , macos ,'), {
    tip: 'liste', platformlar: ['windows', 'macos'], bilinmeyen: [],
  });
  // Kanonik sıra: girdi sırası değil PLATFORMLAR sırası (sağlık ucu karşılaştırması kararlı).
  assert.deepStrictEqual(degerCoz('macos,windows').platformlar, ['windows', 'macos']);
  assert.deepStrictEqual(degerCoz('windows,mac,win,mac').bilinmeyen, ['mac', 'win']);
});

test('kapiAcikMi: kapsamlı değer + yalnız windows işi → AÇIK', () => {
  const k = kayitci();
  assert.strictEqual(kapiAcikMi(AD, { [AD]: 'windows' }, ['windows'], true, k.secenek), true);
  assert.strictEqual(kapiAcikMi(AD, { [AD]: 'windows' }, ['windows'], false, k.secenek), true);
  assert.deepStrictEqual(k.satirlar, []);
});

test('kapiAcikMi: kapsamlı değer + yalnız macos işi → KAPALI', () => {
  for (const varsayilan of [true, false]) {
    assert.strictEqual(kapiAcikMi(AD, { [AD]: 'windows' }, ['macos'], varsayilan, kayitci().secenek), false);
  }
});

test('kapiAcikMi: kapsamlı değer + windows+macos karışık iş → KAPALI (ortak workingPath)', () => {
  assert.strictEqual(kapiAcikMi(AD, { [AD]: 'windows' }, ['windows', 'macos'], true, kayitci().secenek), false);
  assert.strictEqual(kapiAcikMi(AD, { [AD]: 'windows' }, ['macos', 'windows'], true, kayitci().secenek), false);
  // İki platform da listedeyse açık.
  assert.strictEqual(kapiAcikMi(AD, { [AD]: 'windows,macos' }, ['windows', 'macos'], false, kayitci().secenek), true);
});

test('kapiAcikMi: 0 → kapalı, 1 → açık, tanımsız → eski varsayılan (platformdan bağımsız)', () => {
  const k = kayitci();
  for (const is of [['windows'], ['macos'], ['linux', 'android'], undefined, []]) {
    assert.strictEqual(kapiAcikMi(AD, { [AD]: '0' }, is, true, k.secenek), false);
    assert.strictEqual(kapiAcikMi(AD, { [AD]: '1' }, is, false, k.secenek), true);
    assert.strictEqual(kapiAcikMi(AD, {}, is, true, k.secenek), true);
    assert.strictEqual(kapiAcikMi(AD, {}, is, false, k.secenek), false);
    assert.strictEqual(kapiAcikMi(AD, { [AD]: '' }, is, true, k.secenek), true);
  }
  assert.deepStrictEqual(k.satirlar, [], 'eski değerler uyarı basmamalı');
});

test('kapiAcikMi: bilinmeyen platform adı → görünür UYARI, hiçbir işi eşlemez', () => {
  const k = kayitci();
  assert.strictEqual(kapiAcikMi(AD, { [AD]: 'windows,mac' }, ['macos'], true, k.secenek), false);
  assert.strictEqual(k.satirlar.length, 1);
  assert.match(k.satirlar[0], /^UYARI: EMPP_DENEME_KAPI tanınmayan platform adı: mac /);
  // Tanınan ad hâlâ çalışır.
  assert.strictEqual(kapiAcikMi(AD, { [AD]: 'windows,mac' }, ['windows'], true, k.secenek), true);
  // Tek bilinmeyen ad (yazım hatası) tüm platformlarda KAPALI — varsayılan AÇIK bayrakta bile.
  const k2 = kayitci();
  for (const is of [['windows'], ['macos'], ['linux']]) {
    assert.strictEqual(kapiAcikMi(AD, { [AD]: 'win' }, is, true, k2.secenek), false);
  }
  assert.ok(k2.satirlar.every((s) => /tanınmayan platform adı: win /.test(s)), k2.satirlar.join('\n'));
});

test('kapiAcikMi: kapsamlı değer, iş platformu VERİLMEDİ → KAPALI + UYARI', () => {
  const k = kayitci();
  assert.strictEqual(kapiAcikMi(AD, { [AD]: 'windows' }, undefined, true, k.secenek), false);
  assert.strictEqual(kapiAcikMi(AD, { [AD]: 'windows' }, [], true, k.secenek), false);
  assert.strictEqual(k.satirlar.length, 2);
  assert.match(k.satirlar[0], /işin platformu verilmedi — kapı KAPALI/);
});

test('kapiAcikMi: varsayılan uyarı kanalı console.warn (sessiz yutma yok)', () => {
  const yedek = console.warn;
  const satirlar = [];
  console.warn = (s) => satirlar.push(String(s));
  try {
    kapiAcikMi(AD, { [AD]: 'pardus' }, ['linux'], true);
  } finally { console.warn = yedek; }
  assert.strictEqual(satirlar.length, 1);
  assert.match(satirlar[0], /pardus/);
});

test('kapiDurumu: 0/1/tanımsız boolean, kapsamlı değer kanonik dizge, tanınansız false', () => {
  assert.strictEqual(kapiDurumu(AD, {}, true), true);
  assert.strictEqual(kapiDurumu(AD, {}, false), false);
  assert.strictEqual(kapiDurumu(AD, { [AD]: '0' }, true), false);
  assert.strictEqual(kapiDurumu(AD, { [AD]: '1' }, false), true);
  assert.strictEqual(kapiDurumu(AD, { [AD]: 'windows' }, true), 'windows');
  assert.strictEqual(kapiDurumu(AD, { [AD]: ' MacOS,windows ' }, true), 'windows,macos');
  // Bilinmeyen ad dizgeye GİRMEZ (ham değer sızmaz), davranış tanınanlarla aynı.
  assert.strictEqual(kapiDurumu(AD, { [AD]: 'windows,gizli-deger' }, true), 'windows');
  assert.strictEqual(kapiDurumu(AD, { [AD]: 'win' }, true), false);
  assert.strictEqual(kapiDurumu(undefined, undefined, true), true);
});

test('SÖZLEŞME: PLATFORMLAR packagingService.supportedPlatforms ile BİREBİR', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const m = kaynak.match(/this\.supportedPlatforms\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'supportedPlatforms tanımı bulunamadı — sentinel köreldi');
  const liste = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.deepStrictEqual([...PLATFORMLAR], liste);
});
