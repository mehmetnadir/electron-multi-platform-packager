'use strict';
/**
 * yuk-kapisi.js — 27.09 45482 (load avg 138/142/101) dersi: Mac aşırı yüklüyken cihaz
 * katmanının "uygulama süreci kapandı" / "ekran görüntüsü alınamadı" / CDP zaman aşımı
 * RED'leri paket kusuru DEĞİL, host yükü sayılmalı. Saf fonksiyon testleri — emülatör/adb
 * KOŞMAZ, `yukOlc`/`bekle` sahte enjekte edilir.
 *
 * İKİ AYRI EŞİK (27.09 koordinatör düzeltmesi — ölçümle, 10 çekirdekli Mac, aynı gün
 * 15:49-19:04 UTC 10 android kabulü yük ~100-130 iken GEÇTİ):
 *   - ön kapı (EMPP_KABUL_ON_KAPI_ESIGI) varsayılan çekirdek×12 — YÜKSEK, yalnız aşırı uçta
 *     (138-142) durdurur, 100-130 normal-yoğun aralığını durdurmaz.
 *   - son sınıflandırma (EMPP_KABUL_YUK_ESIGI) varsayılan çekirdek×6 — DÜŞÜK, güvenli
 *     (yalnız RED'i ÖLÇÜLEMEDİ'ye çevirir, GEÇTİ'yi hiç etkilemez).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const YK = require('./yuk-kapisi');

// --- EŞİK HESAPLARI ------------------------------------------------------------------------

test('onKapiEsigiHesapla: varsayılan çekirdek×12 (10 çekirdekte 120)', () => {
  assert.equal(YK.onKapiEsigiHesapla(10), 120);
  assert.equal(YK.onKapiEsigiHesapla(4), 48);
});

test('sonSinifEsigiHesapla: varsayılan çekirdek×6 (10 çekirdekte 60)', () => {
  assert.equal(YK.sonSinifEsigiHesapla(10), 60);
  assert.equal(YK.sonSinifEsigiHesapla(4), 24);
});

test('onKapiEsigiHesapla: EMPP_KABUL_ON_KAPI_ESIGI env ile ezilebilir (EMPP_KABUL_YUK_ESIGI\'den BAĞIMSIZ)', () => {
  const oncekiOn = process.env.EMPP_KABUL_ON_KAPI_ESIGI;
  const oncekiSon = process.env.EMPP_KABUL_YUK_ESIGI;
  process.env.EMPP_KABUL_ON_KAPI_ESIGI = '200';
  delete process.env.EMPP_KABUL_YUK_ESIGI;
  try {
    assert.equal(YK.onKapiEsigiHesapla(10), 200);
    assert.equal(YK.sonSinifEsigiHesapla(10), 60); // etkilenmedi — ayrı env değişkeni
  } finally {
    if (oncekiOn === undefined) delete process.env.EMPP_KABUL_ON_KAPI_ESIGI; else process.env.EMPP_KABUL_ON_KAPI_ESIGI = oncekiOn;
    if (oncekiSon === undefined) delete process.env.EMPP_KABUL_YUK_ESIGI; else process.env.EMPP_KABUL_YUK_ESIGI = oncekiSon;
  }
});

test('sonSinifEsigiHesapla: EMPP_KABUL_YUK_ESIGI env ile ezilebilir', () => {
  const onceki = process.env.EMPP_KABUL_YUK_ESIGI;
  process.env.EMPP_KABUL_YUK_ESIGI = '50';
  try {
    assert.equal(YK.sonSinifEsigiHesapla(10), 50);
  } finally {
    if (onceki === undefined) delete process.env.EMPP_KABUL_YUK_ESIGI; else process.env.EMPP_KABUL_YUK_ESIGI = onceki;
  }
});

test('esikOku: negatif/0/NaN env yok sayılır, hesaba dönülür', () => {
  const onceki = process.env.EMPP_KABUL_ON_KAPI_ESIGI;
  process.env.EMPP_KABUL_ON_KAPI_ESIGI = '0';
  try {
    assert.equal(YK.onKapiEsigiHesapla(10), 120);
  } finally {
    if (onceki === undefined) delete process.env.EMPP_KABUL_ON_KAPI_ESIGI; else process.env.EMPP_KABUL_ON_KAPI_ESIGI = onceki;
  }
});

// --- ALTYAPI İMZALARI -----------------------------------------------------------------------

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

// --- ÖN KAPI (yüksek eşik, ×12) --------------------------------------------------------------

test('onKapiBekle: yük yüksek ve düşmüyor (138-142, gerçek 45482 aralığı) → eşik (120) aşıldı, gecti=false', async () => {
  const gunluk = [];
  const r = await YK.onKapiBekle({
    esik: 120,
    araSn: 0,
    azamiSn: 0.05, // gerçek duvar saati: birkaç iterasyonda dolar
    yukOlc: () => [140],
    bekle: () => Promise.resolve(),
    log: (s) => gunluk.push(s),
  });
  assert.equal(r.gecti, false);
  assert.equal(r.sonYuk, 140);
  assert.ok(r.ornekler.every((v) => v === 140));
  assert.ok(gunluk.some((s) => /eşik.*düşmedi/.test(s)));
});

test('onKapiBekle: yük 100 (normal-yoğun, gerçek GEÇTİ aralığı 100-130) → varsayılan eşikte (120) HEMEN geçer', async () => {
  let bekleCagrisi = 0;
  const r = await YK.onKapiBekle({
    esik: YK.onKapiEsigiHesapla(10),
    yukOlc: () => [100],
    bekle: () => { bekleCagrisi += 1; return Promise.resolve(); },
  });
  assert.equal(r.gecti, true);
  assert.equal(bekleCagrisi, 0);
});

test('onKapiBekle: yük önce yüksek (140) sonra düşüyor (10) → gecti=true, kabul koşabilir', async () => {
  let cagri = 0;
  const r = await YK.onKapiBekle({
    esik: 120,
    araSn: 0,
    azamiSn: 5,
    yukOlc: () => {
      cagri += 1;
      return cagri === 1 ? [140] : [10];
    },
    bekle: () => Promise.resolve(),
  });
  assert.equal(r.gecti, true);
  assert.equal(r.sonYuk, 10);
  assert.deepEqual(r.ornekler, [140, 10]);
});

test('onKapiBekle: esik verilmezse onKapiEsigiHesapla (çekirdek×12) kullanılır (env)', async () => {
  const onceki = process.env.EMPP_KABUL_ON_KAPI_ESIGI;
  process.env.EMPP_KABUL_ON_KAPI_ESIGI = '9';
  try {
    const r = await YK.onKapiBekle({ yukOlc: () => [10], bekle: () => Promise.resolve(), azamiSn: 0.02, araSn: 0 });
    assert.equal(r.esik, 9);
    assert.equal(r.gecti, false);
  } finally {
    if (onceki === undefined) delete process.env.EMPP_KABUL_ON_KAPI_ESIGI; else process.env.EMPP_KABUL_ON_KAPI_ESIGI = onceki;
  }
});

// --- SON SINIFLANDIRMA (düşük eşik, ×6) -------------------------------------------------------

test('sonSiniflandirma: yük 100 (normal-yoğun GEÇTİ aralığı) + RED imzası → varsayılan eşikte (60) yine ÖLÇÜLEMEDİ (düşük eşik = güvenli tavan)', () => {
  // Not: bu senaryo normalde GEÇTİ üretir (sebepler boş); burada özellikle "RED + yük 100"
  // varsayımsal karışımını test ediyoruz — düşük eşik (60) 100'ü de aşıldı sayar (istenen: RED
  // yayınlamamak, ertelemek — güvenli taraf). Gerçek 45482 aralığı zaten 138-142.
  const r = YK.sonSiniflandirma({
    sebepler: ['cihaz okuyucu: uygulama süreci kapandı'],
    yukOrnekleri: [100],
    esik: YK.sonSinifEsigiHesapla(10),
  });
  assert.equal(r.ortulenMi, true);
});

test('sonSiniflandirma: yük yüksekken (138-142, gerçek 45482) süreç ölümü → ÖLÇÜLEMEDİ (ortulenMi=true)', () => {
  const r = YK.sonSiniflandirma({
    sebepler: ['cihaz okuyucu: uygulama süreci kapandı'],
    yukOrnekleri: [20, 142, 30],
    esik: 60,
  });
  assert.equal(r.ortulenMi, true);
  assert.equal(r.esikAsildiMi, true);
  assert.equal(r.enYuksekYuk, 142);
});

test('sonSiniflandirma (mutasyon): yük normalken (10-15) AYNI süreç ölümü sebebi → RED kalır (ortulenMi=false)', () => {
  // Bu test `esikAsildiMi` dalı kaldırılırsa (yalnız hepsiAltyapi'ye bakılırsa) DÜŞER —
  // yük normal olduğu için override devreye GİRMEMELİ, gerçek çökme yakalanmaya devam etmeli.
  const r = YK.sonSiniflandirma({
    sebepler: ['cihaz okuyucu: uygulama süreci kapandı'],
    yukOrnekleri: [10, 12, 15],
    esik: 60,
  });
  assert.equal(r.ortulenMi, false);
  assert.equal(r.esikAsildiMi, false);
});

test('sonSiniflandirma: ekran görüntüsü + CDP zaman aşımı birlikte, yük yüksek (138/142/101, tam kanıt aralığı) → ÖLÇÜLEMEDİ', () => {
  const r = YK.sonSiniflandirma({
    sebepler: [
      'cihaz okuyucu: ekran görüntüsü alınamadı',
      'CDP hatası: Network.enable: 10000 ms içinde cevap yok',
    ],
    yukOrnekleri: [138, 142, 101],
    esik: 60,
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
    esik: 60,
  });
  assert.equal(r.ortulenMi, false);
});

test('sonSiniflandirma: sebepler boşsa ortulenMi=false (GEÇTİ durumunda çağrılırsa etkisiz)', () => {
  const r = YK.sonSiniflandirma({ sebepler: [], yukOrnekleri: [150], esik: 60 });
  assert.equal(r.ortulenMi, false);
});

test('sonSiniflandirma: esik verilmezse sonSinifEsigiHesapla (çekirdek×6) kullanılır (env)', () => {
  const onceki = process.env.EMPP_KABUL_YUK_ESIGI;
  process.env.EMPP_KABUL_YUK_ESIGI = '40';
  try {
    const r = YK.sonSiniflandirma({ sebepler: ['cihaz okuyucu: uygulama süreci kapandı'], yukOrnekleri: [50] });
    assert.equal(r.esik, 40);
    assert.equal(r.ortulenMi, true);
  } finally {
    if (onceki === undefined) delete process.env.EMPP_KABUL_YUK_ESIGI; else process.env.EMPP_KABUL_YUK_ESIGI = onceki;
  }
});

// --- YÜK ÖZETİ (kalibrasyon için: en yüksek + ortalama) ---------------------------------------

test('yukOzeti: etiketli örneklerden en yüksek + ortalama hesaplar', () => {
  const kayit = [
    { asama: 'baslangic', yuk: 100 },
    { asama: 'acilis', yuk: 110 },
    { asama: 'karar', yuk: 90 },
  ];
  const o = YK.yukOzeti(kayit);
  assert.equal(o.enYuksek, 110);
  assert.equal(o.ortalama, 100);
  assert.equal(o.adet, 3);
});

test('yukOzeti: düz sayı dizisiyle de çalışır (geriye dönük)', () => {
  const o = YK.yukOzeti([10, 20, 30]);
  assert.equal(o.enYuksek, 30);
  assert.equal(o.ortalama, 20);
});

test('yukOzeti: boş dizi → null değerler, adet=0', () => {
  const o = YK.yukOzeti([]);
  assert.equal(o.enYuksek, null);
  assert.equal(o.ortalama, null);
  assert.equal(o.adet, 0);
});

test('birDkYuk: os.loadavg şeklinde dizi döndüren enjeksiyonun ilk elemanını alır', () => {
  assert.equal(YK.birDkYuk(() => [42, 30, 20]), 42);
});
