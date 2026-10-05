'use strict';
// K9 (2026-09-22): Wi-Fi'de (ücretlendirilmeyen bağlantı) kitap güncellemeleri kendiliğinden
// iner; mobil veride İNMEZ. Menü (ImWin32.dll) okunurken güncellenen sürüm işlenir ki motor
// bir daha yeşil bulut göstermesin.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { fsMod, _internals: I } = require('./empp-android-shim.js');

class SahteDepo {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
function sahteCaches() {
  const k = new Map();
  return { k, open: async (ad) => { if (!k.has(ad)) k.set(ad, new Map()); const m = k.get(ad);
    return { put: async (a, r) => m.set(a, Buffer.from(await r.arrayBuffer())),
      match: async (a) => (m.has(a) ? new Response(m.get(a)) : undefined), delete: async (a) => m.delete(a) }; } };
}
function kur() {
  I.ortam.caches = sahteCaches(); I.ortam.storage = new SahteDepo(); I.ortam.origin = 'https://localhost';
}
function zipTek(ad, veri) { // tek girdili stored zip
  const adB = Buffer.from(ad); const y = Buffer.alloc(30);
  y.writeUInt32LE(0x04034b50, 0); y.writeUInt32LE(veri.length, 18); y.writeUInt32LE(veri.length, 22); y.writeUInt16LE(adB.length, 26);
  const m = Buffer.alloc(46);
  m.writeUInt32LE(0x02014b50, 0); m.writeUInt32LE(veri.length, 20); m.writeUInt32LE(veri.length, 24); m.writeUInt16LE(adB.length, 28);
  const md = Buffer.concat([m, adB]); const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(1, 8); e.writeUInt16LE(1, 10); e.writeUInt32LE(md.length, 12);
  e.writeUInt32LE(30 + adB.length + veri.length, 16);
  return Buffer.concat([y, adB, veri, md, e]);
}
const cover = (id, v, kurulu) => `<cover ID="${id}" etkID="${id}" actName="Föy ${id} — İngilizce" ` +
  `xmlSource="assets/${id}/data/BookContent.xml" isDownloaded="${kurulu}" version="${v}" activation="false"/>`;
const MENU = `<main ID="74451" label="Yabancı Dil"><Group ID="1" label="6.SINIF"><Tab ID="2" label="DİM">` +
  cover(72858, 1, true) + cover(72859, 1, true) + cover(15415, 0, false) + `</Tab></Group></main>`;
const UC = 'https://besegitim.com/TestlerMobil/GetKitapGuncellemeBilgi?id={bookId}&setMi={isSet}&versiyon={version}';

test('ImWin32: çöz(yaz(x)) === x — iki biçimde de, Türkçe karakterle', () => {
  for (const [n, r] of [[127, 17], [27, 5]]) {
    const c = I.imwinCoz(I.imwinYaz(MENU, n, r));
    assert.ok(c, `biçim ${n}/${r} tanınmadı`);
    assert.strictEqual(c.xml, MENU); assert.strictEqual(c.n, n); assert.strictEqual(c.r, r);
  }
});

test('ImWin32 çözücü, paketin gerçek (Python imwin32.yaz) biçimiyle uyumlu', () => {
  // imwin32.py: dolgu(n) + her karakter + (r-1) dolgu + dolgu(n); dolgu 1..125
  const x = '<main><cover ID="1" version="2"/></main>';
  const d = (k) => String.fromCharCode(...Array.from({ length: k }, (_, i) => 1 + (i * 7) % 125));
  const ham = d(127) + [...x].map((ch) => ch + d(16)).join('') + d(127);
  assert.strictEqual(I.imwinCoz(ham).xml, x);
});

test('menü sürüm yaması: kayıt BÜYÜKSE işlenir, küçük/eşitse motorunki kalır', () => {
  const y = I.menuSurumYamasi(MENU, { 72858: 3, 72859: 1 });
  assert.match(y, /ID="72858"[^>]*version="3"/);
  assert.match(y, /ID="72859"[^>]*version="1"/);
  assert.strictEqual(I.menuSurumYamasi(MENU, { 72858: 0 }), MENU);
  assert.doesNotMatch(y, /etkID="72858"[^>]*version="3"[^>]*version/, 'çift version niteliği');
});

test('readFileSync(ImWin32.dll) kayıttaki sürümü menüye işler — motor yeşil bulut göstermez', () => {
  kur();
  I.surumYaz(72859, 2);
  const menu = I.menuDllYamasi(I.imwinYaz(MENU, 27, 5));
  const k = I.menuKitaplari(I.imwinCoz(menu).xml);
  assert.deepStrictEqual(k.map((x) => [x.id, x.surum]), [['72858', 1], ['72859', 2], ['15415', 0]]);
});

function bagimliliklar(ag, surumler, cagri) {
  return {
    agDurumu: async () => (typeof ag === 'function' ? ag() : ag),
    uc: UC, zorla: true,
    menuMetni: () => I.imwinYaz(MENU, 27, 5),
    jsonGetir: async (u) => { cagri.json.push(u); const id = /id=(\d+)/.exec(u)[1];
      return surumler[id] ? { Success: true, Data: `https://x/ZKitapZipH/${id}-${surumler[id]}.zip`, Vs: surumler[id] } : { Success: false }; },
    zipGetir: async (u) => { cagri.zip.push(u); return new Blob([zipTek('data/BookContent.xml', Buffer.from('<yeni/>'))]); },
  };
}

test('Wi-Fi (ölçülmeyen): yalnız sürümü ARTAN kurulu kitap iner; mavi (kurulu değil) otomatik İNMEZ', async () => {
  kur();
  const cagri = { json: [], zip: [] };
  const r = await I.otoGuncelle(bagimliliklar({ bagli: true, olculen: false, wifi: true },
    { 72858: 1, 72859: 2, 15415: 1 }, cagri));
  assert.deepStrictEqual(r.guncellendi, ['72859:1->2']);
  assert.strictEqual(cagri.json.length, 2, '15415 (kurulu değil) sorgulanmamalı');
  assert.ok(cagri.json[0].includes('versiyon=1'));
  assert.deepStrictEqual(cagri.zip, ['https://x/ZKitapZipH/72859-2.zip']);
  assert.strictEqual(fsMod.existsSync('assets/72859/data/BookContent.xml'), true);
  const menu = I.menuDllYamasi(I.imwinYaz(MENU, 27, 5));
  assert.match(I.imwinCoz(menu).xml, /ID="72859"[^>]*version="2"/, 'sürüm kalıcı değil');
});

test('GERİLEME: mobil veride (ölçülen) HİÇBİR ŞEY sorgulanmaz ve indirilmez', async () => {
  kur();
  const cagri = { json: [], zip: [] };
  const r = await I.otoGuncelle(bagimliliklar({ bagli: true, olculen: true, wifi: false }, { 72859: 2 }, cagri));
  assert.strictEqual(r.sebep, 'baglanti-uygun-degil');
  assert.deepStrictEqual([cagri.json.length, cagri.zip.length], [0, 0]);
});

test('paylaşımlı Wi-Fi (wifi ama ölçülen) de otomatik indirme yapmaz', async () => {
  kur();
  const cagri = { json: [], zip: [] };
  const r = await I.otoGuncelle(bagimliliklar({ bagli: true, olculen: true, wifi: true }, { 72859: 2 }, cagri));
  assert.strictEqual(r.sebep, 'baglanti-uygun-degil');
  assert.strictEqual(cagri.zip.length, 0);
});

test('eklenti yoksa (null) indirme yok — elle bulut yine çalışır', async () => {
  kur();
  const cagri = { json: [], zip: [] };
  const r = await I.otoGuncelle(bagimliliklar(null, { 72859: 2 }, cagri));
  assert.strictEqual(r.sebep, 'baglanti-uygun-degil');
  assert.strictEqual(cagri.json.length, 0);
});

test('indirmeden hemen önce bağlantı ölçülene döndüyse DURUR, tarama zamanı yazılmaz', async () => {
  kur();
  let n = 0;
  const cagri = { json: [], zip: [] };
  const ag = () => (n++ === 0 ? { bagli: true, olculen: false } : { bagli: true, olculen: true });
  const r = await I.otoGuncelle(bagimliliklar(ag, { 72858: 2, 72859: 2 }, cagri));
  assert.strictEqual(r.sebep, 'baglanti-degisti');
  assert.strictEqual(cagri.zip.length, 0);
  assert.strictEqual(I.ortam.storage.getItem('empp_oto_guncelleme_son'), null);
});

test('yakın zamanda taranmışsa tekrar taranmaz (her açılışta yüzlerce istek atılmaz)', async () => {
  kur();
  const cagri = { json: [], zip: [] };
  const d = bagimliliklar({ bagli: true, olculen: false }, {}, cagri);
  d.simdi = () => 1_000_000_000;
  await I.otoGuncelle(d);
  d.zorla = false; d.simdi = () => 1_000_000_000 + 60_000;
  const r = await I.otoGuncelle(d);
  assert.strictEqual(r.sebep, 'yakinda-tarandi');
});

test('tek kitabın hatası taramayı durdurmaz', async () => {
  kur();
  const cagri = { json: [], zip: [] };
  const d = bagimliliklar({ bagli: true, olculen: false }, { 72858: 2, 72859: 2 }, cagri);
  const asil = d.zipGetir;
  d.zipGetir = async (u) => { if (u.includes('72858')) throw new Error('HTTP 404'); return asil(u); };
  const r = await I.otoGuncelle(d);
  assert.deepStrictEqual(r.guncellendi, ['72859:1->2']);
  assert.strictEqual(r.hata.length, 1);
});

test('kaynak-sentinel: fs.readFileSync ImWin32.dll okumasını menuDllYamasi\'dan geçirir', () => {
  const src = require('node:fs').readFileSync(require.resolve('./empp-android-shim.js'), 'utf8');
  const rfs = src.slice(src.indexOf('readFileSync: function (p, enc)'), src.indexOf('writeFileSync: function'));
  // A1 (05.10): sürüm yaması kapak süzmesinden ÖNCE uygulanır (kapakSuzMetin(menuDllYamasi(v))).
  assert.match(rfs, /ImWin32\\\.dll\$\/i\.test\(String\(p\)\)\) v = (kapakSuzMetin\()?menuDllYamasi\(v\)/);
});

test('GERİLEME: motorun fetch(ImWin32.dll) okuması da sürüm yamasından geçer (telefonda 4 kart yeşil kalmıştı)', async () => {
  const fsN = require('node:fs'), pathN = require('node:path');
  const store = new Map();
  const win = { document: {}, location: { origin: 'https://localhost', pathname: '/index.html' },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i], get length() { return store.size; } },
    fetch: async () => ({ ok: true, status: 200, text: async () => I.imwinYaz(MENU, 127, 17) }),
    Response: class { constructor(b, i) { this.body = b; this.status = i.status; this.headers = i.headers; } } };
  const src = fsN.readFileSync(pathN.join(__dirname, 'empp-android-shim.js'), 'utf8');
  const m = { exports: {} };
  new Function('module', 'window', 'btoa', 'atob', 'TextDecoder', src)(m, win, btoa, atob, TextDecoder);
  // Kayıt yokken eski davranış (VFS/gerçek fetch aynen)
  const r0 = await win.fetch('classlibraries/ImWin32.dll');
  assert.notStrictEqual(r0.headers && r0.headers['X-EMPP-Source'], 'k9-menu');
  store.set('empp_surum', JSON.stringify({ 72859: 2 }));
  // APK'daki menü (gerçek fetch yolu)
  const r1 = await win.fetch('classlibraries/ImWin32.dll');
  assert.strictEqual(r1.headers['X-EMPP-Source'], 'k9-menu');
  assert.match(I.imwinCoz(r1.body).xml, /ID="72859"[^>]*version="2"/);
  // VFS'teki menü (motorun L5 ile yazdığı, 27/5 biçimi)
  win.require('fs').writeFileSync('/classlibraries/ImWin32.dll', I.imwinYaz(MENU, 27, 5));
  const r2 = await win.fetch('classlibraries/ImWin32.dll');
  const c2 = I.imwinCoz(r2.body);
  assert.strictEqual(c2.n, 27, 'biçim korunmalı');
  assert.match(c2.xml, /ID="72859"[^>]*version="2"/);
  assert.match(c2.xml, /ID="72858"[^>]*version="1"/);
});

// K10 (2026-09-22): tek kitap exe'si = motorun `oneBook` kipi (menüde tek kapak, `isDownloaded`
// niteliği YOK). Motor açılışta güncellemeyi kendisi indirir — yalnız sorgu cevabı 5 sn içinde
// gelirse. Telefonda ölçüldü: iki taraf birlikte indirince 153 MB iki kez indi; cevap 5,1 sn'de
// gelince de motor hiç indirmedi. Kural: motor başladıysa dokunma, başlamadıysa yedek ol.
const TEK_MENU = '<main activation="false" label="İmpark Eğitim" bookUpdate="true"><Group ID="0" label="">' +
  '<Tab ID="0" label=""><cover ID="74209" etkID="74209" source="assets/74209/cover.png" ' +
  'xmlSource="assets/74209/data/BookContent.xml" version="0" install="true" update="false"></cover>' +
  '</Tab></Group></main>';
function tekBagim(motor, cagri) {
  const d = bagimliliklar({ bagli: true, olculen: false }, { 74209: 1 }, cagri);
  d.menuMetni = () => I.imwinYaz(TEK_MENU, 27, 5);
  d.varMi = (y) => y === 'assets/74209/data/BookContent.xml';
  d.motorIndirdi = () => motor;
  return d;
}

test('K10 tek kitap: motor zip indirmeye BAŞLADIYSA oto-güncelleme sorgu atmaz (çift indirme yok)', async () => {
  kur();
  const cagri = { json: [], zip: [] };
  const r = await I.otoGuncelle(tekBagim(true, cagri));
  assert.strictEqual(r.sebep, 'tek-kitap-motor-guncelliyor');
  assert.deepStrictEqual([cagri.json.length, cagri.zip.length], [0, 0]);
});

test('K10 tek kitap: motor BAŞLAMADIYSA (geç cevap) yedek olarak iner; isDownloaded yokken dosyadan kurulu sayılır', async () => {
  kur();
  const cagri = { json: [], zip: [] };
  const r = await I.otoGuncelle(tekBagim(false, cagri));
  assert.deepStrictEqual(r.guncellendi, ['74209:0->1']);
  assert.match(I.imwinCoz(I.menuDllYamasi(I.imwinYaz(TEK_MENU, 27, 5))).xml, /ID="74209"[^>]*version="1"/);
});

test('K10: httpsGet bir ZKitapZip adresine giderse motor-indirdi bayrağı kalkar', () => {
  I.motorZipIndirmesi.basladi = false;
  I.httpsGet('https://x/Uploads/ZKitapZipH/74209-1.zip', () => {}, async () => new Response(''));
  assert.strictEqual(I.motorZipIndirmesi.basladi, true);
  I.motorZipIndirmesi.basladi = false;
});

test('K10 GERİLEME: paket menüsü (2+ kapak) taranmaya devam eder; isDownloaded="false" dosya olsa bile kurulu değil', async () => {
  kur();
  const cagri = { json: [], zip: [] };
  const d = bagimliliklar({ bagli: true, olculen: false }, { 72859: 2, 15415: 1 }, cagri);
  d.varMi = () => true;
  const r = await I.otoGuncelle(d);
  assert.deepStrictEqual(r.guncellendi, ['72859:1->2']);
  assert.ok(!cagri.json.some((u) => u.includes('id=15415')));
});
