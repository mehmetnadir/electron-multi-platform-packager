'use strict';
/**
 * K4 güncellik katmanı — saf karar fonksiyonları + SAHTE CDP sunucusuyla uçtan uca (ağ yok,
 * Electron yok, emülatör yok). Sahte sunucu gerçek TCP + WebSocket çerçeveleriyle konuşur;
 * cdp-kitap-ac.js `ana` süreç içinde koşar (ProBook E6/E7 ile aynı kod yolu).
 *
 * Mutasyon kanıtı: k4Karari'yi sabit GEÇTİ döndürecek biçimde bozunca "DOLU → GÜNCEL-DEĞİL",
 * "örtü: Vs > paket → GÜNCEL-DEĞİL", "CDP kurulamadı → engelleyen ÖLÇÜLEMEDİ" testleri kırılır.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const K = require('./k4-guncellik');
const I = require('./cdp-istemci');
const C = require('../pardus/cdp-kitap-ac');
const O = require('./olcutler');
const ig = require('../../src/runtime/icerik-guncelleme');

const GURL = (v) => `https://akillitahta.ydspublishing.com/TestlerMobil/GetKitapGuncellemeBilgi?id=44187&setMi=0&versiyon=${v}`;
const DOLU = JSON.stringify({ Success: true, Data: 'https://cdn.x/ZKitapZipH/44187-36.zip', Vs: 36 });
const BOS = (vs) => JSON.stringify({ Success: true, Data: '', Vs: vs });
const KOK = '/tmp/k4-sahte/Kitap.app/Contents/Resources/app.asar';
const kanitDizini = () => fs.mkdtempSync(path.join(os.tmpdir(), 'k4-kanit-'));

// --- Saf karar ---------------------------------------------------------------------------------

const cevap = (durum, ek = {}) => ({ id: '44187', versiyon: '33', setMi: '0', vs: '36', data: '', durum, ...ek });

test('k4Karari: E7 DOLU → GÜNCEL-DEĞİL (kod 3, öneri taşır)', () => {
  const k = K.k4Karari({
    olcum: {
      e6: { durum: 'GECTI' },
      e7: { durum: 'DOLU', ayrinti: '44187 v33 < İmpark v36', oneri: 'kaynak S1 ile yenilenmeli (ZKitapZipH/44187-36.zip)' },
      cevaplar: [cevap('DOLU', { data: 'https://cdn.x/ZKitapZipH/44187-36.zip' })],
    },
    paketSurumleri: { 44187: 33 },
  });
  assert.equal(k.durum, 'GUNCEL_DEGIL');
  assert.equal(k.kod, 3);
  assert.match(k.sebep, /44187 v33 < İmpark v36/);
  assert.match(k.oneri, /ZKitapZipH\/44187-36\.zip/);
});

test('k4Karari: E7 BOS ve Vs = paket → GEÇTİ (kod 0)', () => {
  const k = K.k4Karari({
    olcum: { e6: { durum: 'GECTI' }, e7: { durum: 'BOS', ayrinti: '44187 v33 güncel (Vs=33)' }, cevaplar: [cevap('BOS', { vs: '33' })] },
    paketSurumleri: { 44187: 33 },
  });
  assert.equal(k.durum, 'GECTI');
  assert.equal(k.kod, 0);
  assert.deepEqual(k.notlar, []);
});

test('k4Karari: örtü tuzağı — motor v36 sordu (Data boş) ama pakette v33, İmpark v36 → GÜNCEL-DEĞİL', () => {
  const k = K.k4Karari({
    olcum: { e6: { durum: 'GECTI' }, e7: { durum: 'BOS', ayrinti: '44187 v36 güncel' }, cevaplar: [cevap('BOS', { versiyon: '36', vs: '36' })] },
    paketSurumleri: { 44187: 33 },
  });
  assert.equal(k.durum, 'GUNCEL_DEGIL');
  assert.equal(k.kod, 3);
  assert.match(k.sebep, /44187 paket v33 < İmpark v36 \(motor v36 sordu, Data boş\)/);
  assert.match(k.oneri, /ZKitapZipH\/44187-36\.zip/);
  assert.ok(k.notlar.some((n) => /v36 sordu, pakette v33/.test(n)), k.notlar.join());
});

test('k4Karari: İmpark geri alınmış (Vs < paket) → GEÇTİ + UYARI notu (RED değil, E4 kuralı)', () => {
  const k = K.k4Karari({
    olcum: { e6: { durum: 'GECTI' }, e7: { durum: 'BOS', ayrinti: 'x' }, cevaplar: [cevap('BOS', { versiyon: '9', vs: '8' })] },
    paketSurumleri: { 44187: 9 },
  });
  assert.equal(k.durum, 'GECTI');
  assert.ok(k.notlar.some((n) => /UYARI İmpark v8 < paket v9/.test(n)));
});

test('k4Karari: soru görülmedi (YOK) → ÖLÇÜLEMEDİ kod 4, ENGELLEMEZ (Pardus: E7 YOK karar değiştirmez)', () => {
  const k = K.k4Karari({ olcum: { e6: { durum: 'GECTI', sebep: 'kok-okuyucu' }, e7: { durum: 'YOK', ayrinti: '-' }, cevaplar: [] } });
  assert.equal(k.durum, 'OLCULEMEDI');
  assert.equal(k.kod, 4);
  assert.equal(k.engeller, false);
  assert.match(k.sebep, /sormadı/);
});

test('k4Karari: CDP kurulamadı (E6 ÖLÇÜLEMEDİ, cevap yok) → ÖLÇÜLEMEDİ ENGELLER (Pardus: rc 4)', () => {
  const k = K.k4Karari({ olcum: { e6: { durum: 'OLCULEMEDI', sebep: 'CDP bağlanamadı' }, e7: { durum: 'OLCULEMEDI' }, cevaplar: [] } });
  assert.equal(k.durum, 'OLCULEMEDI');
  assert.equal(k.engeller, true);
  assert.match(k.sebep, /CDP ölçümü kurulamadı: CDP bağlanamadı/);
});

test('k4Karari: E8 — profil boş değil → ÖLÇÜLEMEDİ ENGELLER, ölçüm DOLU olsa bile GEÇTİ/karar yok', () => {
  const k = K.k4Karari({ olcum: { e7: { durum: 'BOS' }, cevaplar: [cevap('BOS', { vs: '33' })] }, profilBos: false });
  assert.equal(k.durum, 'OLCULEMEDI');
  assert.equal(k.engeller, true);
  assert.match(k.sebep, /E8/);
});

test('k4Karari: aktivasyonlu seri, soru yok → ÖLÇÜLEMEDİ; yalnız KABUL_AKTIVASYON_OLCULEMEDI=1 ile engeller', () => {
  const olcum = { e6: { durum: 'RED', sebep: 'okuyucu çizmedi' }, e7: { durum: 'YOK' }, cevaplar: [] };
  assert.equal(K.k4Karari({ olcum, aktivasyon: true }).engeller, false);
  assert.equal(K.k4Karari({ olcum, aktivasyon: true, aktivasyonOlculemedi: true }).engeller, true);
  // Aktivasyonlu seride de soru yakalandıysa karar sorudan: DOLU → GÜNCEL-DEĞİL.
  const d = K.k4Karari({ olcum: { e7: { durum: 'DOLU' }, cevaplar: [cevap('DOLU')] }, aktivasyon: true });
  assert.equal(d.durum, 'GUNCEL_DEGIL');
});

test('k4Birlestir: GÜNCEL-DEĞİL baskın; sonra GEÇTİ; hepsi ölçülemediyse biri engelliyorsa engeller', () => {
  const g = { durum: 'GECTI', kod: 0, sebep: 'e', notlar: [], engeller: false, kaynak: 'electron' };
  const d = { durum: 'GUNCEL_DEGIL', kod: 3, sebep: 'd', notlar: [], engeller: false, kaynak: 'cihaz' };
  const o1 = { durum: 'OLCULEMEDI', kod: 4, sebep: 'o1', notlar: [], engeller: true, kaynak: 'electron' };
  const o2 = { durum: 'OLCULEMEDI', kod: 4, sebep: 'o2', notlar: [], engeller: false, kaynak: 'cihaz' };
  assert.equal(K.k4Birlestir(g, d).durum, 'GUNCEL_DEGIL');
  assert.equal(K.k4Birlestir(o2, g).durum, 'GECTI');
  assert.ok(K.k4Birlestir(o2, g).notlar.some((n) => /cihaz: ÖLÇÜLEMEDİ — o2/.test(n)));
  const b = K.k4Birlestir(o1, o2);
  assert.equal(b.durum, 'OLCULEMEDI');
  assert.equal(b.engeller, true);
  assert.equal(K.k4Birlestir(o2, { ...o2, kaynak: 'electron' }).engeller, false);
  assert.equal(K.k4Birlestir(), null);
});

test('genelKararK4: RED > GÜNCEL-DEĞİL > engelleyen ÖLÇÜLEMEDİ > diğerleri; ATLANDI karar değiştirmez', () => {
  const k = (durum, engeller = false) => ({ durum, engeller });
  assert.equal(K.genelKararK4('RED', k('GUNCEL_DEGIL')), 'RED');
  assert.equal(K.genelKararK4('GECTI', k('GUNCEL_DEGIL')), 'GUNCEL_DEGIL');
  assert.equal(K.genelKararK4('OLCULEMEDI', k('GUNCEL_DEGIL')), 'GUNCEL_DEGIL');
  assert.equal(K.genelKararK4('GECTI', k('OLCULEMEDI', true)), 'OLCULEMEDI');
  assert.equal(K.genelKararK4('GECTI', k('OLCULEMEDI', false)), 'GECTI');
  assert.equal(K.genelKararK4('GECTI', k('GECTI')), 'GECTI');
  assert.equal(K.genelKararK4('OLCULEMEDI', k('GECTI')), 'OLCULEMEDI');
  assert.equal(K.genelKararK4('GECTI', k('ATLANDI')), 'GECTI');
});

test('k4CikisKodu: K4 açık → kabul-karar.sh sözlüğü (0/1/3 GÜNCEL-DEĞİL/4); kapalı → eski (ÖLÇÜLEMEDİ 3)', () => {
  assert.deepEqual(['GECTI', 'RED', 'GUNCEL_DEGIL', 'OLCULEMEDI', '???'].map((d) => K.k4CikisKodu(d, true, O.cikisKodu)), [0, 1, 3, 4, 4]);
  assert.deepEqual(['GECTI', 'RED', 'OLCULEMEDI'].map((d) => K.k4CikisKodu(d, false, O.cikisKodu)), [0, 1, 3]);
  assert.equal(K.k4Etkin({ env: {} }), false, 'varsayılan KAPALI');
  assert.equal(K.k4Etkin({ env: { KABUL_K4: '1' } }), true);
  assert.equal(K.k4Etkin({ env: { KABUL_K4: '0' }, bayrak: true }), true);
});

test('webviewSoketiSec / cdpSatirlariCoz / desenleHedefSec / kayitlariBirlestir (saf)', () => {
  const unix = '00000000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_4242\n'
    + '00000000: 00000002 00000000 00010000 0001 01 12346 @webview_devtools_remote_999\n';
  assert.equal(K.webviewSoketiSec(unix, '4242'), 'webview_devtools_remote_4242');
  assert.equal(K.webviewSoketiSec(unix, '42'), null, 'başka pid\'in soketi seçilmemeli');
  assert.deepEqual(K.cdpSatirlariCoz(['E6=GECTI', 'x', 'E7_AYRINTI=a=b']), { E6: 'GECTI', E7_AYRINTI: 'a=b' });
  const h = C.desenleHedefSec([
    { type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://a' },
    { type: 'page', url: 'https://localhost/index.html', webSocketDebuggerUrl: 'ws://b' },
  ], K.ANDROID_HEDEF_DESENI);
  assert.equal(h.hedef.webSocketDebuggerUrl, 'ws://b');
  const ag = [{ url: 'u1', govde: 'g' }];
  assert.equal(C.kayitlariBirlestir(ag, [{ url: 'u1', govde: 'g' }, { url: 'u2', govde: 'x' }, { url: 'u2', govde: 'x' }]).length, 2);
});

test('paketSurumleriOku: SET her bookN menüsünü motorun çözücüsüyle okur; bozuk menü "okunamayan"', () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'k4-paket-'));
  const yaz = (rel, xml) => {
    fs.mkdirSync(path.dirname(path.join(kok, rel)), { recursive: true });
    fs.writeFileSync(path.join(kok, rel), xml === null ? 'bozuk' : ig.menuKodla(xml, () => 0.5));
  };
  yaz('book1/classlibraries/ImWin32.dll', '<main><cover ID="44187" version="33" URL=""/><cover ID="0" version=""/></main>');
  yaz('book2/classlibraries/ImWin32.dll', '<main><cover ID="44188" version="12"/></main>');
  yaz('book3/classlibraries/ImWin32.dll', null);
  const r = K.paketSurumleriOku(kok, false, ['book1', 'book2', 'book3']);
  assert.deepEqual(r.surumler, { 44187: 33, 44188: 12 });
  assert.deepEqual(r.okunamayan, ['book3/classlibraries/ImWin32.dll']);
  const tek = K.paketSurumleriOku(path.join(kok, 'book2'), false, []);
  assert.deepEqual(tek.surumler, { 44188: 12 });
});

test('kaydedici: sonradan atanan fetch (CapacitorHttp) de sarılır; güncelleme cevabı sessionStorage\'a düşer', async () => {
  const depo = {};
  const cevapVer = (govde) => async () => ({ status: 200, clone() { return { text: async () => govde }; } });
  const baglam = {
    URL, JSON, String, Promise, setTimeout,
    location: { href: 'https://localhost/book1/index.html' },
    sessionStorage: { getItem: (k) => (k in depo ? depo[k] : null), setItem: (k, v) => { depo[k] = String(v); } },
    fetch: cevapVer('ilk'),
    XMLHttpRequest: function XHR() {},
  };
  baglam.XMLHttpRequest.prototype.open = function open() {};
  baglam.XMLHttpRequest.prototype.send = function send() {};
  baglam.window = baglam;
  vm.createContext(baglam);
  vm.runInContext(C.KAYDEDICI_KAYNAK, baglam);
  vm.runInContext(C.KAYDEDICI_KAYNAK, baglam); // ikinci kurulum no-op
  baglam.window.fetch = cevapVer(DOLU); // Capacitor köprüsü fetch'i SONRADAN değiştirir
  await vm.runInContext(`fetch(${JSON.stringify(GURL(33))}).then(() => fetch('/assets/x.json'))`, baglam);
  await new Promise((r) => setTimeout(r, 20));
  const kayit = JSON.parse(depo[C.KAYDEDICI_ANAHTAR] || '[]');
  assert.equal(kayit.length, 1, 'yalnız güncelleme ucu kaydedilmeli');
  assert.equal(kayit[0].url, GURL(33));
  assert.equal(kayit[0].govde, DOLU);
  assert.equal(C.guncellemeCevabiCoz(kayit[0]).durum, 'DOLU');
});

// --- Sahte CDP sunucusu -------------------------------------------------------------------------

/**
 * @param {{url:string, guncelleme?:'yenilemede'|null, govde?:string, kayit?:object[]}} o
 *   guncelleme 'yenilemede': Page.reload sonrası Network olayları + gövde. kayit: kaydedici içeriği.
 */
async function sahteCdp(o) {
  const k = { alinan: [], betikler: [], yenileme: 0, soketler: new Set() };
  const yoklama = () => ({
    url: o.url, baslik: 'Akıllı Tahta Uygulaması', kartlar: [], kapaklar: [], yukleniyor: [],
    sayfaGorseli: 2, tuval: 1, arkaPlanSayfa: 0, kartSayisi: 0,
  });
  let gonder = () => {};
  const cevapla = (m) => {
    const p = m.params || {};
    switch (m.method) {
      case 'Runtime.evaluate': {
        const e = String(p.expression || '');
        if (e.includes('function domYokla')) return { result: { type: 'object', value: yoklama() } };
        if (e === 'location.href') return { result: { type: 'string', value: o.url } };
        if (e.includes('sessionStorage.getItem')) return { result: { type: 'string', value: JSON.stringify(o.kayit || []) } };
        if (e.includes('outerHTML')) return { result: { type: 'string', value: '<html></html>' } };
        return { result: { type: 'undefined' } };
      }
      case 'Page.addScriptToEvaluateOnNewDocument':
        k.betikler.push(p.source || '');
        return { identifier: '1' };
      case 'Page.reload':
        k.yenileme += 1;
        if (o.guncelleme === 'yenilemede') {
          setTimeout(() => {
            gonder({ method: 'Network.requestWillBeSent', params: { requestId: 'r1', type: 'Fetch', request: { url: o.gurl, method: 'GET' } } });
            gonder({ method: 'Network.responseReceived', params: { requestId: 'r1', type: 'Fetch', response: { url: o.gurl, status: 200 } } });
            gonder({ method: 'Network.loadingFinished', params: { requestId: 'r1' } });
          }, 20);
        }
        return {};
      case 'Network.getResponseBody':
        return { body: o.govde, base64Encoded: false };
      case 'Page.captureScreenshot':
        return { data: Buffer.from('png').toString('base64') };
      default:
        return {};
    }
  };
  const sunucu = http.createServer((istek, yanit) => {
    if (istek.url === '/json/list') {
      const ws = `ws://127.0.0.1:${sunucu.address().port}/devtools/page/`;
      yanit.setHeader('Content-Type', 'application/json');
      yanit.end(JSON.stringify([
        { type: 'page', url: 'about:blank', webSocketDebuggerUrl: `${ws}bos` },
        { type: 'page', url: o.url, webSocketDebuggerUrl: `${ws}hedef` },
      ]));
      return;
    }
    yanit.statusCode = 404;
    yanit.end();
  });
  sunucu.on('upgrade', (istek, soket) => {
    k.soketler.add(soket);
    soket.on('close', () => k.soketler.delete(soket));
    k.yol = istek.url;
    soket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n`
      + `Sec-WebSocket-Accept: ${I.kabulAnahtari(istek.headers['sec-websocket-key'])}\r\n\r\n`);
    gonder = (nesne) => { if (!soket.destroyed) soket.write(I.cerceveKodla(1, Buffer.from(JSON.stringify(nesne)), { maske: null })); };
    let tampon = Buffer.alloc(0);
    soket.on('data', (d) => {
      tampon = Buffer.concat([tampon, d]);
      const { cerceveler, kalan } = I.cerceveCoz(tampon);
      tampon = Buffer.from(kalan);
      for (const c of cerceveler) {
        if (c.opcode === 8) { soket.end(); continue; }
        if (c.opcode !== 1) continue;
        const m = JSON.parse(c.yuk.toString('utf8'));
        k.alinan.push(m.method);
        gonder({ id: m.id, result: cevapla(m) });
      }
    });
  });
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  k.port = sunucu.address().port;
  k.kapat = () => new Promise((r) => { for (const s of k.soketler) s.destroy(); sunucu.close(() => r()); });
  return k;
}

const kisaSure = {
  kitapSn: 2, e7Sn: 1, baglanSn: 2, menuSn: 2, cdpToplamSn: 25, cdpEkArg: ['--aralik-ms', '40', '--gezinme-sn', '1'],
};

function sahteBaslat(kayit) {
  return (arg) => {
    kayit.push(arg);
    return { pid: 0, durdur: async () => ({ kod: 0 }) };
  };
}

async function electronOlc(o, ek = {}) {
  const t = await sahteCdp({ url: `file://${KOK}/index.html`, gurl: GURL(33), ...o });
  const baslatilan = [];
  try {
    const kanit = kanitDizini();
    const olcum = await K.electronK4Olc({
      ...kisaSure, girisYolu: `${KOK}/index.html`, kurulumKoku: KOK, kanit, calisma: kanit,
      cdpPort: ek.cdpPort || t.port, baslat: sahteBaslat(baslatilan), ...ek,
    });
    return { t, olcum, baslatilan };
  } finally { await t.kapat(); }
}

test('electron K4 (sahte CDP): tek kitap, yeniden yüklemede soru → Data DOLU → GÜNCEL-DEĞİL', async () => {
  const { t, olcum, baslatilan } = await electronOlc({ guncelleme: 'yenilemede', govde: DOLU });
  assert.equal(olcum.e6.durum, 'GECTI', JSON.stringify(olcum.e6));
  assert.equal(olcum.e7.durum, 'DOLU');
  assert.equal(olcum.cevaplar.length, 1);
  assert.equal(olcum.cevaplar[0].id, '44187');
  assert.equal(t.yol, '/devtools/page/hedef', 'kurulum kökündeki file: sayfası seçilmeli');
  assert.ok(t.yenileme >= 1, 'tek kitapta sayfa bir kez yeniden yüklenmeli (soru açılışta sorulur)');
  assert.equal(t.betikler.length, 0, 'Electron yolunda kaydedici YOK (ProBook ile aynı akış)');
  // Harness girdisi: K4 kipi, ağ açık, ayrı boş profil, 3000 değil.
  const g = baslatilan[0].girdi;
  assert.equal(g.k4, true);
  assert.equal(g.agKapali, false);
  assert.notEqual(g.cdpPort, 3000);
  assert.ok(g.profilDizin.includes('k4-profil-'), g.profilDizin);
  assert.equal(olcum.profilBos, true);
  const k = K.k4Karari({ olcum, paketSurumleri: { 44187: 33 } });
  assert.equal(k.durum, 'GUNCEL_DEGIL');
  assert.equal(k.kod, 3);
});

test('electron K4 (sahte CDP): Data boş, Vs = paket → GEÇTİ', async () => {
  const { olcum } = await electronOlc({ guncelleme: 'yenilemede', govde: BOS(33) });
  assert.equal(olcum.e7.durum, 'BOS');
  assert.equal(K.k4Karari({ olcum, paketSurumleri: { 44187: 33 } }).durum, 'GECTI');
});

test('electron K4 (sahte CDP): soru hiç sorulmadı → E7 YOK → ÖLÇÜLEMEDİ, engellemez', async () => {
  const { olcum } = await electronOlc({ guncelleme: null });
  assert.equal(olcum.e7.durum, 'YOK');
  const k = K.k4Karari({ olcum });
  assert.equal(k.durum, 'OLCULEMEDI');
  assert.equal(k.engeller, false);
});

test('electron K4: CDP portunda kimse yok → E6 ÖLÇÜLEMEDİ → engelleyen ÖLÇÜLEMEDİ (sahte yeşil yok)', async () => {
  const bos = await K.bosPortBul(9937);
  const { olcum } = await electronOlc({}, { cdpPort: bos });
  assert.equal(olcum.e6.durum, 'OLCULEMEDI');
  const k = K.k4Karari({ olcum });
  assert.equal(k.durum, 'OLCULEMEDI');
  assert.equal(k.engeller, true);
});

test('electron K4: profil dizini doluysa harness HİÇ başlamaz → E8 ÖLÇÜLEMEDİ', async () => {
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'k4-dolu-'));
  fs.writeFileSync(path.join(profil, 'eski-indirme.zip'), 'x');
  const { olcum, baslatilan } = await electronOlc({}, { profil });
  assert.equal(baslatilan.length, 0);
  assert.equal(olcum.profilBos, false);
  assert.equal(K.k4Karari({ olcum, profilBos: olcum.profilBos }).engeller, true);
});

// --- Android cihaz (sahte adb + sahte WebView CDP) ---------------------------------------------

function sahteAdb({ pid = '4242', soketVar = true, forwardRc = 0 } = {}) {
  const cagrilar = [];
  const adbKos = (argumanlar) => {
    cagrilar.push(argumanlar.join(' '));
    if (argumanlar[1] === 'pidof') return { status: pid ? 0 : 1, stdout: pid ? `${pid}\n` : '' };
    if (argumanlar[2] === '/proc/net/unix') {
      return { status: 0, stdout: soketVar ? `0: 00000002 0 1 @webview_devtools_remote_${pid}\n` : '0: 00000002 0 1 @chrome_devtools_remote\n' };
    }
    if (argumanlar[0] === 'forward') return { status: argumanlar[1] === '--remove' ? 0 : forwardRc, stdout: '', stderr: forwardRc ? 'hata' : '' };
    return { status: 0, stdout: '' };
  };
  return { adbKos, cagrilar };
}

test('cihaz K4 (sahte WebView): Network görmez, kaydedici DOLU yakalar → GÜNCEL-DEĞİL; forward kaldırılır', async () => {
  const t = await sahteCdp({
    url: 'https://localhost/index.html', guncelleme: null,
    kayit: [{ url: GURL(33), http: 200, govde: DOLU, kanal: 'fetch' }],
  });
  const a = sahteAdb();
  try {
    const olcum = await K.cihazK4Olc({ ...kisaSure, adbKos: a.adbKos, paket: 'com.yds.kitap', kanitDizin: kanitDizini(), cdpPort: t.port });
    assert.equal(olcum.soket, 'webview_devtools_remote_4242');
    assert.ok(a.cagrilar.includes(`forward tcp:${t.port} localabstract:webview_devtools_remote_4242`), a.cagrilar.join(' | '));
    assert.ok(a.cagrilar.includes(`forward --remove tcp:${t.port}`), 'forward temizlenmeli');
    assert.equal(t.betikler.length, 1, 'belge-başı kaydedici kurulmalı');
    assert.match(t.betikler[0], /GetKitapGuncellemeBilgi/);
    assert.ok(t.yenileme >= 1);
    assert.equal(olcum.e7.durum, 'DOLU', JSON.stringify(olcum.e7));
    const k = K.k4Karari({ olcum, paketSurumleri: { 44187: 33 }, kaynak: 'cihaz' });
    assert.equal(k.durum, 'GUNCEL_DEGIL');
  } finally { await t.kapat(); }
});

test('cihaz K4: WebView hata ayıklama soketi yok → ÖLÇÜLEMEDİ + gerekçe, forward denenmez', async () => {
  const a = sahteAdb({ soketVar: false });
  const olcum = await K.cihazK4Olc({ ...kisaSure, adbKos: a.adbKos, paket: 'com.yds.kitap', kanitDizin: kanitDizini() });
  assert.equal(olcum.e6.durum, 'OLCULEMEDI');
  assert.match(olcum.e6.sebep, /WebView hata ayıklama soketi yok/);
  assert.ok(!a.cagrilar.some((c) => c.startsWith('forward')));
  const b = sahteAdb({ pid: '' });
  assert.match((await K.cihazK4Olc({ adbKos: b.adbKos, paket: 'p', kanitDizin: kanitDizini() })).e6.sebep, /uygulama süreci yok/);
});

// --- Bağlantı nöbetçileri (canlı yol kilitleri) ------------------------------------------------

test('nöbetçi: harness K4 kipi CDP portunu yalnız K4\'te açar, zip indirmesini keser; CLI K4\'ü bayrakla koşar', () => {
  const main = fs.readFileSync(path.join(__dirname, 'kosum', 'main.js'), 'utf8');
  assert.match(main, /if \(K4 && Number\(G\.cdpPort\) > 0\) app\.commandLine\.appendSwitch\('remote-debugging-port'/);
  assert.match(main, /K4_INDIRME_DESENI = \/\\\/ZKitapZipH\?\\\/\|\\\.zip/);
  const cli = fs.readFileSync(path.join(__dirname, 'basliksiz-kabul.js'), 'utf8');
  assert.match(cli, /const k4Acik = K4\.k4Etkin\(\{ bayrak: s\.k4 \}\);/);
  assert.match(cli, /if \(k4Acik\) \{\n\s+paketSurum = K4\.paketSurumleriOku/);
  assert.match(cli, /return \{ kod: K4\.k4CikisKodu\(genel, k4Acik, O\.cikisKodu\), rapor \};/);
  assert.match(cli, /say\(`GUNCEL-DEGIL: \$\{rapor\.k4\.sebep\}`\);/);
  const cihaz = fs.readFileSync(path.join(__dirname, 'android-cihaz.js'), 'utf8');
  const kanca = cihaz.indexOf("typeof p.k4Olc === 'function'");
  assert.ok(kanca > 0 && kanca < cihaz.indexOf("['uninstall', paketBilgi.paket]"), 'K4 kancası kaldırmadan ÖNCE');
});

test('guncellikKatmani: uçtan uca okuyucusu için katman sözlüğü — GÜNCEL-DEĞİL → RED "güncel değil", ATLANDI → katman yok', () => {
  const gd = K.guncellikKatmani({ durum: 'GUNCEL_DEGIL', kod: 3, sebep: 'E7 72379 v12 < İmpark v19', notlar: [], engeller: false });
  assert.equal(gd.durum, 'RED');
  assert.equal(gd.k4Durum, 'GUNCEL_DEGIL');
  assert.equal(gd.kod, 3);
  assert.deepEqual(gd.sebepler, ['güncel değil: E7 72379 v12 < İmpark v19']);
  const g = K.guncellikKatmani({ durum: 'GECTI', kod: 0, sebep: 'E7 58336 v17 güncel', notlar: [] });
  assert.equal(g.durum, 'GECTI');
  assert.deepEqual(g.sebepler, []);
  assert.equal(g.ozet, 'E7 58336 v17 güncel');
  assert.equal(K.guncellikKatmani({ durum: 'OLCULEMEDI', kod: 4, sebep: 's', engeller: true }).durum, 'OLCULEMEDI');
  assert.equal(K.guncellikKatmani({ durum: 'ATLANDI' }), null);
  // Genel karar katman listesinden değil genelKararK4'ten: nöbetçi.
  const cli = fs.readFileSync(path.join(__dirname, 'basliksiz-kabul.js'), 'utf8');
  const genelYeri = cli.indexOf('const genel = k4Acik ? K4.genelKararK4(O.genelKarar(katmanListesi), rapor.k4)');
  assert.ok(genelYeri > 0 && genelYeri < cli.indexOf('rapor.katmanlar.guncellik = guncellik'),
    'guncellik katmanı genel karardan SONRA eklenmeli (listeye girmez)');
});
