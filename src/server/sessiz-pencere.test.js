'use strict';
// Sessiz pencere karar modülü testleri — SAF fonksiyonlar, gerçek HTTP/ağ YOK.
// Bağlam: kaçak paketleyici süreci (127.0.0.1:3001) canlı bir build işlerken
// yanlış "sakin" kararı build'i öldürür — bu yüzden şüphede HER ZAMAN meşgul
// sayılması ayrı ayrı test edilir (bozuk JSON, null, alan yok, obje-değil...).
const test = require('node:test');
const assert = require('node:assert');
const { mesgulMu, pencereAcikMi, durumOzeti } = require('./sessiz-pencere');

// Gerçek /api/queue-statistics ölçümünden alınan şekil (2026-09-21, canlı ölçüm):
function gercekSekil({ packagingProcessing = 0, zipProcessing = 0 } = {}) {
  return {
    success: true,
    timestamp: '2026-09-21T07:06:33.107Z',
    statistics: {
      zip: { total: 4, processing: zipProcessing, queued: 0, completed: 4 - zipProcessing, failed: 0 },
      packaging: { total: 4, processing: packagingProcessing, ready: 0, waiting_for_zip: 0, completed: 4 - packagingProcessing, failed: 0 },
      capacity: { maxConcurrentZip: 3, maxConcurrentPackaging: 7, availableZipSlots: 3, availablePackagingSlots: 6 },
    },
  };
}

test('mesgulMu: iç içe (statistics.packaging.processing) > 0 → meşgul (true)', () => {
  assert.strictEqual(mesgulMu(gercekSekil({ packagingProcessing: 1 })), true);
});

test('mesgulMu: iç içe zip.processing > 0 → meşgul (true)', () => {
  assert.strictEqual(mesgulMu(gercekSekil({ zipProcessing: 2 })), true);
});

test('mesgulMu: gerçek şekilde HER processing alanı 0 → sakin (false)', () => {
  assert.strictEqual(mesgulMu(gercekSekil({ packagingProcessing: 0, zipProcessing: 0 })), false);
});

test('mesgulMu: en üst seviyede düz processing alanı > 0 → meşgul (true)', () => {
  assert.strictEqual(mesgulMu({ processing: 5 }), true);
});

test('mesgulMu: en üst seviyede düz processing alanı 0 → sakin (false)', () => {
  assert.strictEqual(mesgulMu({ processing: 0 }), false);
});

test('mesgulMu: bozuk JSON string → meşgul say (true)', () => {
  assert.strictEqual(mesgulMu('{ this is not valid json'), true);
});

test('mesgulMu: null cevap → meşgul say (true)', () => {
  assert.strictEqual(mesgulMu(null), true);
});

test('mesgulMu: undefined cevap → meşgul say (true)', () => {
  assert.strictEqual(mesgulMu(undefined), true);
});

test('mesgulMu: hiç processing alanı yok → meşgul say (true, şüphede meşgul)', () => {
  assert.strictEqual(mesgulMu({ success: true, statistics: { zip: { total: 4, completed: 4 } } }), true);
});

test('mesgulMu: obje olmayan girdi (sayı) → meşgul say (true)', () => {
  assert.strictEqual(mesgulMu(42), true);
});

test('mesgulMu: obje olmayan girdi (boolean) → meşgul say (true)', () => {
  assert.strictEqual(mesgulMu(true), true);
});

test('mesgulMu: boş obje {} → meşgul say (true, alan yok)', () => {
  assert.strictEqual(mesgulMu({}), true);
});

test('mesgulMu: processing değeri sayısal olmayan string ise → meşgul say (true)', () => {
  assert.strictEqual(mesgulMu({ statistics: { packaging: { processing: 'yok' } } }), true);
});

test('mesgulMu: processing değeri NaN ise → meşgul say (true)', () => {
  assert.strictEqual(mesgulMu({ statistics: { packaging: { processing: NaN } } }), true);
});

test('mesgulMu: dizi (array) içindeki iç içe processing > 0 da yakalanır → meşgul (true)', () => {
  const veri = { statistics: { jobs: [{ processing: 0 }, { processing: 3 }] } };
  assert.strictEqual(mesgulMu(veri), true);
});

test('mesgulMu: dizi içindeki tüm iç içe processing 0 → sakin (false)', () => {
  const veri = { statistics: { jobs: [{ processing: 0 }, { processing: 0 }] } };
  assert.strictEqual(mesgulMu(veri), false);
});

test('mesgulMu: çoklu processing alanı — biri >0 diğerleri 0 → meşgul (true)', () => {
  const veri = { statistics: { zip: { processing: 0 }, packaging: { processing: 0 }, extra: { processing: 1 } } };
  assert.strictEqual(mesgulMu(veri), true);
});

test('mesgulMu: çoklu processing alanı — hepsi 0 → sakin (false)', () => {
  const veri = { statistics: { zip: { processing: 0 }, packaging: { processing: 0 }, extra: { processing: 0 } } };
  assert.strictEqual(mesgulMu(veri), false);
});

test('mesgulMu: döngüsel referans çökmeden doğru sonuç verir (sakin)', () => {
  const veri = { statistics: { packaging: { processing: 0 } } };
  veri.kendisi = veri; // döngüsel referans
  assert.strictEqual(mesgulMu(veri), false);
});

test('mesgulMu: döngüsel referans + meşgul olan bir alan varsa yine meşgul döner', () => {
  const veri = { statistics: { packaging: { processing: 7 } } };
  veri.kendisi = veri; // döngüsel referans
  assert.strictEqual(mesgulMu(veri), true);
});

test('pencereAcikMi: 2 ardışık sakin ölçüm varsayılan eşikte (3) YETMEZ → false', () => {
  assert.strictEqual(pencereAcikMi(2), false);
});

test('pencereAcikMi: 3 ardışık sakin ölçüm varsayılan eşikte (3) YETER → true', () => {
  assert.strictEqual(pencereAcikMi(3), true);
});

test('pencereAcikMi: 3 üstü de açık sayılır (4 sakin, varsayılan eşik)', () => {
  assert.strictEqual(pencereAcikMi(4), true);
});

test('pencereAcikMi: özel eşik verildiğinde eşiğin altı yetmez', () => {
  assert.strictEqual(pencereAcikMi(4, 5), false);
});

test('pencereAcikMi: özel eşik verildiğinde eşiğe ulaşınca açılır', () => {
  assert.strictEqual(pencereAcikMi(5, 5), true);
});

test('pencereAcikMi: geçersiz eşik (0) verilirse varsayılan 3\'e düşer', () => {
  assert.strictEqual(pencereAcikMi(2, 0), false);
  assert.strictEqual(pencereAcikMi(3, 0), true);
});

test('pencereAcikMi: geçersiz eşik (negatif) verilirse varsayılan 3\'e düşer', () => {
  assert.strictEqual(pencereAcikMi(3, -1), true);
});

test('pencereAcikMi: geçersiz eşik (NaN) verilirse varsayılan 3\'e düşer', () => {
  assert.strictEqual(pencereAcikMi(3, NaN), true);
});

test('pencereAcikMi: sayaç sayı değilse (string/NaN) false döner', () => {
  assert.strictEqual(pencereAcikMi('3'), false);
  assert.strictEqual(pencereAcikMi(NaN), false);
});

test('durumOzeti: gerçek şekilde insan-okunur özet üretir (paketleme + zip)', () => {
  const ozet = durumOzeti(gercekSekil({ packagingProcessing: 1, zipProcessing: 0 }));
  assert.match(ozet, /paketleme 1 işliyor, 3 bitti, 6 slot boş/);
  assert.match(ozet, /zip 0 işliyor, 4 bitti, 3 slot boş/);
});

test('durumOzeti: her şey sakinken de doğru sayıları basar', () => {
  const ozet = durumOzeti(gercekSekil({ packagingProcessing: 0, zipProcessing: 0 }));
  assert.match(ozet, /paketleme 0 işliyor, 4 bitti/);
});

test('durumOzeti: bozuk JSON string için çökmeden hata metni döner', () => {
  const ozet = durumOzeti('{ bozuk');
  assert.match(ozet, /okunamadı/);
});

test('durumOzeti: null cevap için çökmeden hata metni döner', () => {
  const ozet = durumOzeti(null);
  assert.match(ozet, /okunamadı/);
});

test('durumOzeti: processing alanı hiç yoksa çökmeden hata metni döner', () => {
  const ozet = durumOzeti({ statistics: { zip: { total: 4, completed: 4 } } });
  assert.match(ozet, /okunamadı/);
});
