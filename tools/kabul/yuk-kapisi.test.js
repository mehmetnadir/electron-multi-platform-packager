'use strict';
/**
 * yuk-kapisi.js — 27.09 45482 (load avg 138/142/101) dersi: Mac aşırı yüklüyken cihaz
 * katmanının "uygulama süreci kapandı" / "ekran görüntüsü alınamadı" / CDP zaman aşımı
 * RED'leri paket kusuru DEĞİL, host yükü sayılmalı. Saf fonksiyon testleri — emülatör/adb
 * KOŞMAZ, `yukOlc`/`bekle` sahte enjekte edilir.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const YK = require('./yuk-kapisi');

test('esikHesapla: varsayılan çekirdek×3', () => {
  assert.equal(YK.esikHesapla(4), 12);
  assert.equal(YK.esikHesapla(8), 24);
});

test('esikHesapla: EMPP_KABUL_YUK_ESIGI env ile ezilebilir', () => {
  const onceki = process.env.EMPP_KABUL_YUK_ESIGI;
  process.env.EMPP_KABUL_YUK_ESIGI = '50';
  try {
    assert.equal(YK.esikHesapla(4), 50);
  } finally {
    if (onceki === undefined) delete process.env.EMPP_KABUL_YUK_ESIGI; else process.env.EMPP_KABUL_YUK_ESIGI = onceki;
  }
});

test('altyapiImzasiMi: bilinen üç imza eşleşir', () => {
  assert.equal(YK.altyapiImzasiMi('cihaz okuyucu: uygulama süreci kapandı'), true);
  assert.equal(YK.altyapiImzasiMi('cihaz menü: ekran görüntüsü alınamadı'), true);
  assert.equal(YK.altyapiImzasiMi('CDP hatası: Network.enable: 10000 ms içinde cevap yok'), true);
});

test('altyapiImzasiMi (mutasyon): bilinmeyen sebep eşleşmez', () => {
  assert.equal(YK.altyapiImzasiMi('cihaz menü: menü kartı 2 ≠ beklenen 4'), false);
  assert.equal(YK.altyapiImzasiMi(''), false);
  assert.equal(YK.altyapiImzasiMi(undefined), false);
});

// --- ÖN KAPI -----------------------------------------------------------------------------

test('onKapiBekle: yük yüksek ve düşmüyor → eşik aşıldı, gecti=false (emülatör hiç açılmamalı)', async () => {
  const gunluk = [];
  const r = await YK.onKapiBekle({
    esik: 48,
    araSn: 0,
    azamiSn: 0.05, // gerçek duvar saati: birkaç iterasyonda dolar
    yukOlc: () => [150],
    bekle: () => Promise.resolve(),
    log: (s) => gunluk.push(s),
  });
  assert.equal(r.gecti, false);
  assert.equal(r.sonYuk, 150);
  assert.ok(r.ornekler.every((v) => v === 150));
  assert.ok(gunluk.some((s) => /eşik.*düşmedi/.test(s)));
});

test('onKapiBekle: yük önce yüksek sonra düşüyor → gecti=true, kabul koşabilir', async () => {
  let cagri = 0;
  const r = await YK.onKapiBekle({
    esik: 48,
    araSn: 0,
    azamiSn: 5,
    yukOlc: () => {
      cagri += 1;
      return cagri === 1 ? [150] : [10];
    },
    bekle: () => Promise.resolve(),
  });
  assert.equal(r.gecti, true);
  assert.equal(r.sonYuk, 10);
  assert.deepEqual(r.ornekler, [150, 10]);
});

test('onKapiBekle: yük başından beri düşük → tek örnek, hiç beklemeden geçer', async () => {
  let bekleCagrisi = 0;
  const r = await YK.onKapiBekle({
    esik: 48,
    yukOlc: () => [5],
    bekle: () => { bekleCagrisi += 1; return Promise.resolve(); },
  });
  assert.equal(r.gecti, true);
  assert.equal(r.ornekler.length, 1);
  assert.equal(bekleCagrisi, 0);
});

test('onKapiBekle: esik verilmezse esikHesapla kullanılır (env)', async () => {
  const onceki = process.env.EMPP_KABUL_YUK_ESIGI;
  process.env.EMPP_KABUL_YUK_ESIGI = '9';
  try {
    const r = await YK.onKapiBekle({ yukOlc: () => [10], bekle: () => Promise.resolve(), azamiSn: 0.02, araSn: 0 });
    assert.equal(r.esik, 9);
    assert.equal(r.gecti, false);
  } finally {
    if (onceki === undefined) delete process.env.EMPP_KABUL_YUK_ESIGI; else process.env.EMPP_KABUL_YUK_ESIGI = onceki;
  }
});

// --- SON SINIFLANDIRMA ---------------------------------------------------------------------

test('sonSiniflandirma: yük yüksekken süreç ölümü → ÖLÇÜLEMEDİ (ortulenMi=true)', () => {
  const r = YK.sonSiniflandirma({
    sebepler: ['cihaz okuyucu: uygulama süreci kapandı'],
    yukOrnekleri: [20, 150, 30],
    esik: 48,
  });
  assert.equal(r.ortulenMi, true);
  assert.equal(r.esikAsildiMi, true);
  assert.equal(r.enYuksekYuk, 150);
});

test('sonSiniflandirma (mutasyon): yük normalken AYNI süreç ölümü sebebi → RED kalır (ortulenMi=false)', () => {
  // Bu test `esikAsildiMi` dalı kaldırılırsa (yalnız hepsiAltyapi'ye bakılırsa) DÜŞER —
  // yük normal olduğu için override devreye GİRMEMELİ, gerçek çökme yakalanmaya devam etmeli.
  const r = YK.sonSiniflandirma({
    sebepler: ['cihaz okuyucu: uygulama süreci kapandı'],
    yukOrnekleri: [10, 12, 15],
    esik: 48,
  });
  assert.equal(r.ortulenMi, false);
  assert.equal(r.esikAsildiMi, false);
});

test('sonSiniflandirma: ekran görüntüsü + CDP zaman aşımı birlikte, yük yüksek → ÖLÇÜLEMEDİ', () => {
  const r = YK.sonSiniflandirma({
    sebepler: [
      'cihaz okuyucu: ekran görüntüsü alınamadı',
      'CDP hatası: Network.enable: 10000 ms içinde cevap yok',
    ],
    yukOrnekleri: [138, 142, 101],
    esik: 30,
  });
  assert.equal(r.ortulenMi, true);
});

test('sonSiniflandirma: bilinmeyen bir sebep karışırsa (yük yüksek olsa da) override devreye GİRMEZ', () => {
  const r = YK.sonSiniflandirma({
    sebepler: [
      'cihaz okuyucu: uygulama süreci kapandı',
      'cihaz menü: menü kartı 2 ≠ beklenen 4',
    ],
    yukOrnekleri: [150],
    esik: 30,
  });
  assert.equal(r.ortulenMi, false);
});

test('sonSiniflandirma: sebepler boşsa ortulenMi=false (GEÇTİ durumunda çağrılırsa etkisiz)', () => {
  const r = YK.sonSiniflandirma({ sebepler: [], yukOrnekleri: [150], esik: 30 });
  assert.equal(r.ortulenMi, false);
});

test('birDkYuk: os.loadavg şeklinde dizi döndüren enjeksiyonun ilk elemanını alır', () => {
  assert.equal(YK.birDkYuk(() => [42, 30, 20]), 42);
});
