'use strict';
// Gözcü betiği testleri — GERÇEK HTTP'YE GİTMEZ (istatistikGetir enjekte edilir).
// Ölçülü not: --bir-kez modu process.exit ÇAĞIRMAZ (test edilebilirlik için),
// exit kodu birKezCalistir'in döndürdüğü `kod` alanından okunur — asıl CLI
// (require.main === module bloğu) bu kodu process.exit'e verir.
const test = require('node:test');
const assert = require('node:assert');
const { argvAyristir, birKezCalistir, birOlcumYap, VARSAYILAN_URL, VARSAYILAN_ARALIK_SN, VARSAYILAN_GEREKLI } = require('./sessiz-pencere-gozcusu');

function sahteGetirSakin() {
  return async () => ({
    hata: false,
    veri: JSON.stringify({ statistics: { packaging: { processing: 0, completed: 4 }, capacity: { availablePackagingSlots: 6 } } }),
  });
}

function sahteGetirMesgul() {
  return async () => ({
    hata: false,
    veri: JSON.stringify({ statistics: { packaging: { processing: 1, completed: 3 }, capacity: { availablePackagingSlots: 6 } } }),
  });
}

function sahteGetirAgHatasi() {
  return async () => ({ hata: true, sebep: 'ECONNREFUSED (test)' });
}

test('argvAyristir: argüman verilmezse varsayılanları kullanır', () => {
  const s = argvAyristir([]);
  assert.strictEqual(s.aralikSn, VARSAYILAN_ARALIK_SN);
  assert.strictEqual(s.gerekli, VARSAYILAN_GEREKLI);
  assert.strictEqual(s.birKez, false);
  assert.strictEqual(s.jobId, null);
  assert.strictEqual(s.url, VARSAYILAN_URL);
});

test('argvAyristir: --aralik, --gerekli, --bir-kez, --job-id, --url doğru ayrıştırılır', () => {
  const s = argvAyristir(['--aralik', '30', '--gerekli', '5', '--bir-kez', '--job-id', 'd4100a93-abc', '--url', 'http://127.0.0.1:9999/x']);
  assert.strictEqual(s.aralikSn, 30);
  assert.strictEqual(s.gerekli, 5);
  assert.strictEqual(s.birKez, true);
  assert.strictEqual(s.jobId, 'd4100a93-abc');
  assert.strictEqual(s.url, 'http://127.0.0.1:9999/x');
});

test('argvAyristir: geçersiz --aralik/--gerekli (sayı değil, negatif) varsayılana düşer', () => {
  const s = argvAyristir(['--aralik', 'abc', '--gerekli', '-5']);
  assert.strictEqual(s.aralikSn, VARSAYILAN_ARALIK_SN);
  assert.strictEqual(s.gerekli, VARSAYILAN_GEREKLI);
});

test('birOlcumYap: enjekte edilen istatistikGetir kullanılır, gerçek ağa gidilmez', async () => {
  let cagrildiMi = false;
  const sahte = async (url, zaman) => { cagrildiMi = true; return { hata: false, veri: JSON.stringify({ statistics: { packaging: { processing: 0 } } }) }; };
  const olcum = await birOlcumYap({ url: 'http://sahte.test', zamanAsimiMs: 1000, istatistikGetir: sahte });
  assert.strictEqual(cagrildiMi, true);
  assert.strictEqual(olcum.meşgul, false);
});

test('birKezCalistir: kuyruk sakinse çıkış kodu 0', async () => {
  const { kod, mesaj } = await birKezCalistir({ istatistikGetir: sahteGetirSakin() });
  assert.strictEqual(kod, 0);
  assert.match(mesaj, /SESSİZ PENCERE/);
});

test('birKezCalistir: kuyruk meşgulse çıkış kodu 1', async () => {
  const { kod, mesaj } = await birKezCalistir({ istatistikGetir: sahteGetirMesgul() });
  assert.strictEqual(kod, 1);
  assert.match(mesaj, /MEŞGUL/);
});

test('birKezCalistir: uç ağ hatası verirse meşgul say → çıkış kodu 1', async () => {
  const { kod, mesaj } = await birKezCalistir({ istatistikGetir: sahteGetirAgHatasi() });
  assert.strictEqual(kod, 1);
  assert.match(mesaj, /MEŞGUL/);
});

test('birKezCalistir: jobId verilirse mesajda görünür', async () => {
  const { mesaj } = await birKezCalistir({ istatistikGetir: sahteGetirMesgul(), jobId: 'd4100a93-xyz' });
  assert.match(mesaj, /d4100a93-xyz/);
});

test('birKezCalistir: jobId verilmezse mesajda "jobId:" geçmez', async () => {
  const { mesaj } = await birKezCalistir({ istatistikGetir: sahteGetirSakin() });
  assert.doesNotMatch(mesaj, /jobId:/);
});
