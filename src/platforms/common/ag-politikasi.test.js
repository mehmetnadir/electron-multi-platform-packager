const test = require('node:test');
const assert = require('node:assert');
const { kararVer, kur } = require('./ag-politikasi.js');

// ---------- kararVer: saf karar ----------

test('yerel/göreli istek her zaman geçer', () => {
  for (const u of ['assets/1/data/BookContent.xml', './core/logo.png', '/x/y.js',
                   'classlibraries/ImWin32.dll', 'blob:abc', 'data:image/png;base64,AA']) {
    assert.strictEqual(kararVer(u).eylem, 'gecir', u);
  }
});

test('GERİLEME: çıplak köke atılan prob zaman aşımına bağlanır (motorun kendi 5000 ms beyanı)', () => {
  for (const u of ['https://www.sorucoz.tv', 'https://www.sorucoz.tv/', 'http://ornek.tld/']) {
    const k = kararVer(u);
    assert.strictEqual(k.eylem, 'zamanasimi', u);
    assert.strictEqual(k.ms, 5000, u);
  }
});

test('GERİLEME: sorgusunda undefined DEĞERİ olan istek engellenir (sunucu determinist 500 veriyor)', () => {
  const k = kararVer('https://www.sorucoz.tv/MobilService/GetPackageBooks?id=undefined');
  assert.strictEqual(k.eylem, 'engelle');
  assert.strictEqual(k.sebep, 'tanimsiz-parametre');
});

test('null değeri de engellenir, büyük/küçük harf farketmez', () => {
  assert.strictEqual(kararVer('https://a.tld/x?id=NULL').eylem, 'engelle');
  assert.strictEqual(kararVer('https://a.tld/x?a=1&b=Undefined').eylem, 'engelle');
});

test('SINIR: "undefined" ADI ya da ALT DİZGİSİ engellemez — yalnız tam DEĞER', () => {
  // parametre ADI undefined ama degeri gecerli
  assert.strictEqual(kararVer('https://a.tld/x?undefined=5').eylem, 'gecir');
  // deger icinde gecen ama esit olmayan
  assert.strictEqual(kararVer('https://a.tld/x?id=undefined2').eylem, 'gecir');
  assert.strictEqual(kararVer('https://a.tld/x?id=notundefined').eylem, 'gecir');
  // yolda gecen
  assert.strictEqual(kararVer('https://a.tld/undefined/x?id=5').eylem, 'gecir');
});

test('gerçek ürün uçlarına DOKUNULMAZ (ürün kararı, ölçüm değil)', () => {
  const uclar = [
    'https://sorucoz.tv/TestlerMobil/HasZKitapKey?kitapId=45516',
    'https://sorucoz.tv/TestlerMobil/IsZKitapKurumAktif?kitapId=45516&zKitapId=0603008',
    'https://sorucoz.tv/TestlerMobil/GetKitapGuncellemeBilgi?id=45516&setMi=0&versiyon=9',
    'https://sorucoz.tv/TestlerMobil/IsCorrectZKitapKey?kitapId=45516&key=ABC&makineId=M1',
  ];
  for (const u of uclar) assert.strictEqual(kararVer(u).eylem, 'gecir', u);
});

test('diyez ve sorgu birlikte: yol çözümü şaşmaz', () => {
  // '/#/sayfa' = kokun kendisi + parca; parca sunucuya gitmez -> yine prob
  assert.strictEqual(kararVer('https://a.tld/#/sayfa').eylem, 'zamanasimi');
  assert.strictEqual(kararVer('https://a.tld#frag').eylem, 'zamanasimi'); // yol yok -> prob
});

test('bozuk girdi karar fonksiyonunu düşürmez', () => {
  for (const u of [null, undefined, 0, {}, []]) {
    assert.strictEqual(kararVer(u).eylem, 'gecir');
  }
});

// ---------- kur: sarmalama davranışı ----------

function sahtePencere(fetchUygulamasi) {
  const zamanlayicilar = new Map();
  let sonra = 1;
  return {
    fetch: fetchUygulamasi,
    document: {},
    AbortController: class { constructor() { this.signal = { iptal: false }; } abort() { this.signal.iptal = true; if (this.signal.dinleyici) this.signal.dinleyici(); } },
    setTimeout(fn, ms) { const id = sonra++; zamanlayicilar.set(id, { fn, ms }); return id; },
    clearTimeout(id) { zamanlayicilar.delete(id); },
    __zamanlayicilar: zamanlayicilar,
  };
}

test('engellenen istek AĞA ÇIKMAZ ve reject eder', async () => {
  let cagrildi = 0;
  const w = sahtePencere(async () => { cagrildi++; return { status: 200 }; });
  kur(w);
  await assert.rejects(() => w.fetch('https://a.tld/x?id=undefined'), /ag-politikasi/);
  assert.strictEqual(cagrildi, 0, 'engellenen istek gerçek fetch\'e gitmemeli');
});

test('normal istek dokunulmadan geçer ve aynı yanıtı döner', async () => {
  const beklenen = { status: 200, x: 1 };
  const w = sahtePencere(async () => beklenen);
  kur(w);
  assert.strictEqual(await w.fetch('https://a.tld/TestlerMobil/HasZKitapKey?kitapId=1'), beklenen);
});

test('GERİLEME: prob isteğine signal eklenir ve başarıda sayaç temizlenir', async () => {
  let gorulenAyar = null;
  const w = sahtePencere(async (g, a) => { gorulenAyar = a; return { status: 200 }; });
  kur(w);
  await w.fetch('https://a.tld', { method: 'HEAD', mode: 'no-cors' });
  assert.ok(gorulenAyar && gorulenAyar.signal, 'prob isteğine signal eklenmeli');
  assert.strictEqual(gorulenAyar.method, 'HEAD', 'çağıranın ayarları korunmalı');
  assert.strictEqual(gorulenAyar.mode, 'no-cors', 'çağıranın ayarları korunmalı');
  assert.strictEqual(w.__zamanlayicilar.size, 0, 'yanıt gelince sayaç temizlenmeli (sızıntı yok)');
});

test('GERİLEME: sayaç motorun beyan ettiği 5000 ms ile kurulur', async () => {
  let cozumle;
  const w = sahtePencere(() => new Promise((r) => { cozumle = r; }));
  kur(w);
  const s = w.fetch('https://a.tld');
  assert.strictEqual(w.__zamanlayicilar.size, 1);
  assert.strictEqual([...w.__zamanlayicilar.values()][0].ms, 5000);
  cozumle({ status: 200 });
  await s;
});

test('GERİLEME: çağıran KENDİ signal\'ini verdiyse üzerine yazılmaz', async () => {
  const benimSignal = { benim: true };
  let gorulenAyar = null;
  const w = sahtePencere(async (g, a) => { gorulenAyar = a; return { status: 200 }; });
  kur(w);
  await w.fetch('https://a.tld', { signal: benimSignal });
  assert.strictEqual(gorulenAyar.signal, benimSignal, 'çağıranın signal\'i sahibinindir');
  assert.strictEqual(w.__zamanlayicilar.size, 0, 'kendi signal\'i varken sayaç kurulmamalı');
});

test('hata durumunda da sayaç temizlenir', async () => {
  const w = sahtePencere(async () => { throw new Error('ağ düştü'); });
  kur(w);
  await assert.rejects(() => w.fetch('https://a.tld'));
  assert.strictEqual(w.__zamanlayicilar.size, 0);
});

test('GERİLEME: iki kez kurulmaz (çift sarmalama yok)', () => {
  const w = sahtePencere(async () => ({ status: 200 }));
  assert.strictEqual(kur(w), true);
  const ilk = w.fetch;
  assert.strictEqual(kur(w), false);
  assert.strictEqual(w.fetch, ilk);
});

test('AbortController yoksa prob dokunulmadan geçer (düşmez)', async () => {
  const w = sahtePencere(async () => ({ status: 200 }));
  w.AbortController = undefined;
  kur(w);
  assert.deepStrictEqual(await w.fetch('https://a.tld'), { status: 200 });
});

test('fetch yoksa kurulum sessizce başarısız olur', () => {
  assert.strictEqual(kur({ document: {} }), false);
  assert.strictEqual(kur(null), false);
});
