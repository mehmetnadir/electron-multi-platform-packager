'use strict';

/**
 * PANEL MENÜ HİZALAMA (05.10) — gerçek 45449 verisiyle.
 * Fikstür `fikstur/panel-45449/`: panelin GetPackageBooks cevabı (yalnız kullanılan alanlar) +
 * 45449 build'inin çözülmüş kök menüsü. İçerik dosyaları yer tutucu. Panele, İmpark'a, CDN'e
 * istek GİTMEZ (panelGetir/getir/indir/resimIndir sahte); her şey os.tmpdir() altında.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const P = require('./panel-menu-hizala');
const M = require('./icerik-merdiven');
const ig = require('../runtime/icerik-guncelleme');
const imk = require('./imkeys');

const FIKSTUR = path.join(__dirname, 'fikstur', 'panel-45449');
const PANEL_GOVDE = fs.readFileSync(path.join(FIKSTUR, 'pb-45449.json'), 'utf8');
const MENU_XML = fs.readFileSync(path.join(FIKSTUR, 'imwin32-coz.xml'), 'utf8');
const YENI = { 73010: 1, 73147: 1 };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `panel-menu-${ad}-`));
const panel = () => P.panelCevabiYorumla({ status: 200, govde: PANEL_GOVDE });
const eskiIdler = () => [...MENU_XML.matchAll(/<cover\b[^>]*\sID="(\d+)"/g)].map((m) => m[1]);
const attr = (e, a) => (new RegExp(`\\s${a}="([^"]*)"`).exec(e) || [])[1];

function yaz(kok, rel, veri) {
  const p = path.join(kok, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, veri);
}

function zipla(dizin, cikti) {
  execFileSync('zip', ['-q', '-r', '-D', '-X', cikti, '.'], { cwd: dizin });
  return cikti;
}

function kitapDizini(kok, id) {
  yaz(kok, `assets/${id}/data/BookContent.xml`, `<Book kitapId="${id}"></Book>`);
  yaz(kok, `assets/${id}/thumbs/1.jpg`, `kapak-${id}`);
  yaz(kok, `assets/${id}/pages/1.png`, `sayfa-${id}`);
}

/**
 * Sahte 45449 build zip'i + İmpark arşivleri.
 * @param {{xml?: string, imKeys?: boolean, kitapEkle?: Function}} s
 */
function ortam({ xml = MENU_XML, imKeys = true, kitapEkle, appConfigEk = '' } = {}) {
  const d = tmp('ortam');
  const kok = path.join(d, 'build');
  yaz(kok, 'classlibraries/ImWin32.dll', ig.menuKodla(xml, () => 0.5, ig.BICIM_ESKI));
  yaz(kok, 'app.config.js', `const AppConfig = { ${appConfigEk}updateBookEndPoint: "https://www.`
    + 'sorucoz.tv/TestlerMobil/GetKitapGuncellemeBilgi?id={bookId}&setMi={isSet}&versiyon={version}" };\n');
  yaz(kok, 'index.html', '<html></html>');
  for (const id of eskiIdler()) kitapDizini(kok, id);
  if (imKeys) yaz(kok, 'assets/31456/imKeys.dll', imk.imKeysBicimle(['KOD11', 'KOD22']));
  if (kitapEkle) kitapEkle(kok);
  const zip = zipla(kok, path.join(d, 'build.zip'));
  const arsivler = {};
  for (const [id, vs] of Object.entries(YENI)) {
    const a = path.join(d, `ark-${id}`);
    kitapDizini(a, 'x');
    fs.renameSync(path.join(a, 'assets', 'x'), path.join(a, 'k'));
    arsivler[id] = zipla(path.join(a, 'k'), path.join(d, `${id}-${vs}.zip`));
  }
  const calisma = path.join(d, 'is');
  fs.mkdirSync(calisma);
  const sayac = { panel: 0, teklif: [], indir: [], resim: [] };
  return {
    d, zip, calisma, sayac,
    ortak: {
      zip, calisma, bookId: '45449', platform: 'test', onbellek: path.join(d, 'onbellek'),
      kanitDizini: path.join(d, 'kanit'), bekle: async () => {},
      panelGetir: async (url) => {
        sayac.panel += 1;
        assert.match(url, /GetPackageBooks\?id=45449$/);
        return { status: 200, govde: PANEL_GOVDE };
      },
      getir: async (url) => {
        sayac.teklif.push(url);
        const id = /[?&]id=(\d+)/.exec(url)[1];
        if (!YENI[id]) return { status: 200, govde: '{"Success":true,"Data":"","Vs":0}' };
        const data = `https://akillitahta.ydspublishing.com/Uploads/ZKitapZipH/${id}-${YENI[id]}.zip`;
        return { status: 200, govde: JSON.stringify({ Success: true, Data: data, Vs: YENI[id] }) };
      },
      indir: async (url, hedef) => {
        sayac.indir.push(url);
        fs.copyFileSync(arsivler[/ZKitapZipH\/(\d+)-/.exec(url)[1]], hedef);
      },
      resimIndir: async (url, hedef) => {
        sayac.resim.push(url);
        fs.mkdirSync(path.dirname(hedef), { recursive: true });
        fs.writeFileSync(hedef, PNG);
      },
    },
  };
}

function zipMenu(zip) {
  const dz = M.zipDizini(zip);
  const ham = M.zipGirdiOku(zip, dz.get('classlibraries/ImWin32.dll'));
  return { dz, ham, xml: ig.menuCoz(ham) };
}

// ─── Saf ────────────────────────────────────────────────────────────────────────────────────

test('panel cevabı: 45449 → 30 üye, Group 683, sekme sırası okuyucunun ilk görülme sırası', () => {
  const p = panel();
  assert.equal(p.durum, P.DURUM.TAMAM);
  assert.equal(p.books.length, 30);
  assert.deepEqual([...new Set(p.books.map((b) => b.groupId))], ['683']);
  assert.deepEqual([...new Set(p.books.map((b) => b.tabId))], ['4294', '1419', '1421', '1420', '1422']);
  assert.deepEqual(p.books.slice(0, 2).map((b) => b.id), ['73010', '73147']);
  assert.equal(p.books[2].fixName, '31456');
});

test('panel cevabı: ağ/5xx/429 → ÖLÇÜLEMEDİ; 4xx/JSON-dışı 200/yönlendirme → UC_YOK; Books boş → BOŞ', () => {
  const d = (c) => P.panelCevabiYorumla(c).durum;
  assert.equal(d({ status: 500, govde: 'x' }), P.DURUM.OLCULEMEDI);
  assert.equal(d({ status: 429, govde: 'x' }), P.DURUM.OLCULEMEDI);
  assert.equal(d({ hata: 'zaman aşımı (20 sn)' }), P.DURUM.OLCULEMEDI);
  assert.equal(d({ status: 403, govde: '<!DOCTYPE html>Just a moment' }), P.DURUM.UC_YOK);
  assert.equal(d({ status: 404, govde: 'yok' }), P.DURUM.UC_YOK);
  assert.equal(d({ status: 200, govde: '<html>' }), P.DURUM.UC_YOK);
  assert.equal(d({ ucYok: 'başka alana yönlendirme (https://x)' }), P.DURUM.UC_YOK);
  const bos = P.panelCevabiYorumla({
    status: 200, govde: '{"Books":null,"status":false,"statusMessage":"Kitap bulunamadı"}',
  });
  assert.equal(bos.durum, P.DURUM.BOS);
  assert.match(bos.neden, /Books boş \(Kitap bulunamadı\)/);
  assert.equal(d({ status: 200, govde: '{"Books":[]}' }), P.DURUM.BOS);
});

test('panel cevabı: güvensiz FixName / bozuk Id → BOZUK (fırlatmaz)', () => {
  const j = JSON.parse(PANEL_GOVDE);
  j.Books[0].FixName = '../kok';
  const r1 = P.panelCevabiYorumla({ status: 200, govde: JSON.stringify(j) });
  assert.equal(r1.durum, P.DURUM.BOZUK);
  assert.match(r1.neden, /FixName güvensiz/);
  j.Books[0].FixName = '73010';
  j.Books[1].Id = 'abc';
  assert.match(P.panelCevabiYorumla({ status: 200, govde: JSON.stringify(j) }).neden, /Id geçersiz/);
});

test('panelSor: ölçülemedi 3 kez denenir, meşru boş bir kez', async () => {
  let n = 0;
  const y = await P.panelSor('u', { getir: async () => { n += 1; return { status: 502 }; },
    bekle: async () => {} });
  assert.equal(y.durum, P.DURUM.OLCULEMEDI);
  assert.equal(n, 3);
  n = 0;
  const cevaplar = [{ hata: 'bağlantı kurulamadı' }, { status: 200, govde: PANEL_GOVDE }];
  const y2 = await P.panelSor('u', { getir: async () => cevaplar[n++], bekle: async () => {} });
  assert.equal(y2.durum, P.DURUM.TAMAM);
  assert.equal(y2.deneme, 2);
  n = 0;
  await P.panelSor('u', { getir: async () => { n += 1; return { status: 200, govde: '{"Books":[]}' }; } });
  assert.equal(n, 1);
});

test('okuyucu h() — paket menüsü bugün: 28 yeşil (v1), 2 mavi (v0)', () => {
  const { books } = panel();
  const var_ = new Set(eskiIdler().map((id) => `assets/${id}/data/BookContent.xml`));
  const varMi = (a) => var_.has(a);
  assert.equal(P.hSimule(MENU_XML, 683, 1419, 31456), undefined);
  const s = books.map((b) => P.okuyucuSurumu(MENU_XML, b, varMi));
  assert.equal(s.filter((v) => v === 0).length, 2);
  assert.equal(s.filter((v) => v === 1).length, 28);
  assert.deepEqual(P.eksikUyeler(MENU_XML, books, varMi).map((e) => e.book.id), ['73010', '73147']);
});

test('menuHizala: h(683,1419,31456) → v10; her üye okuyucuda paketteki sürümle; main bayt-aynı', () => {
  const { books } = panel();
  const yeniler = new Map([
    ['73010', { vs: 1, url: 'https://x/Uploads/ZKitapZipH/73010-1.zip' }],
    ['73147', { vs: 1, url: 'https://x/Uploads/ZKitapZipH/73147-1.zip' }],
  ]);
  const h = P.menuHizala(MENU_XML, books, yeniler);
  assert.equal(P.hSimule(h.xml, 683, 1419, 31456), '10');
  assert.equal(P.hSimule(h.xml, 683, 1422, 56281), '3');
  assert.equal(P.hSimule(h.xml, 683, 4294, 73010), '1');
  assert.deepEqual(h.eklenen, ['73010', '73147']);
  assert.deepEqual(h.cikarilan.sort(), ['61633', '61635']);
  assert.equal(h.tasinan.length, 28);
  assert.equal(/<main\b[^>]*>/.exec(h.xml)[0], /<main\b[^>]*>/.exec(MENU_XML)[0]);
  // Kapak sırası = panel sırası; Group/Tab etiketleri panelden.
  assert.deepEqual(P.kapakSirasi(h.xml).map((c) => c.id), books.map((b) => b.id));
  assert.match(h.xml, /<Group ID="683" label="Impact 12"><Tab ID="4294" label="Çıkmış Sorular">/);
  // Eski kapak öznitelikleri korunur; tabID panelden.
  const c = P.kapakSirasi(h.xml).find((k) => k.id === '31456').etiket;
  const o = /<cover\b[^>]*\sID="31456"[^>]*>/.exec(MENU_XML)[0];
  for (const a of ['ustBar', 'arkaPlan', 'URL', 'corpID', 'source', 'version', 'activation']) {
    assert.equal(attr(c, a), attr(o, a), a);
  }
  assert.equal(attr(c, 'tabID'), '1419');
  // Yeni kapak: kendi yolları, indirilen sürüm.
  const y = P.kapakSirasi(h.xml)[0].etiket;
  assert.equal(attr(y, 'xmlSource'), 'assets/73010/data/BookContent.xml');
  assert.equal(attr(y, 'ustBar'), 'assets/73010/skins/ustBar.swf');
  assert.equal(attr(y, 'version'), '1');
  assert.equal(attr(y, 'tabID'), '4294');
  // Okuyucu simülasyonu: içerik varsa h() sürümü (yeşil/mavi yok).
  const var_ = new Set(books.map((b) => `assets/${b.fixName}/data/BookContent.xml`));
  for (const b of books) {
    const v = P.okuyucuSurumu(h.xml, b, (a) => var_.has(a));
    assert.ok(v > 0 && v === Number(P.hSimule(h.xml, b.groupId, b.tabId, b.id)), b.id);
  }
});

test('menuHizala: panel üyesi ne eski menüde ne indirilenlerde → hata', () => {
  assert.throws(() => P.menuHizala(MENU_XML, panel().books), /73010 ne eski menüde/);
});

test('kapı: eksik içerik / panel dışı kapak / ilk kapak imKeys → ihlal', () => {
  const { books } = panel();
  const yeniler = new Map([['73010', { vs: 1, url: 'u' }], ['73147', { vs: 1, url: 'u' }]]);
  const h = P.menuHizala(MENU_XML, books, yeniler);
  const main = /<main\b[^>]*>/.exec(MENU_XML)[0];
  const tam = new Set(books.map((b) => `assets/${b.fixName}/data/BookContent.xml`));
  assert.deepEqual(P.hizalamaKapisi({ xml: h.xml, books, varMi: (a) => tam.has(a), beklenenMain: main }), []);
  const eksik = P.hizalamaKapisi({
    xml: h.xml, books, beklenenMain: main,
    varMi: (a) => tam.has(a) && !a.startsWith('assets/73147/'),
  });
  assert.ok(eksik.some((s) => /73147: assets\/73147\/data\/BookContent\.xml yok/.test(s)), eksik.join('|'));
  const eski = P.hizalamaKapisi({ xml: MENU_XML, books, varMi: () => true, beklenenMain: main });
  assert.ok(eski.some((s) => /h\(683,1419,31456\) menüde yok/.test(s)));
  assert.ok(eski.some((s) => /panel dışı kapak: 61635/.test(s)));
  const imk1 = P.hizalamaKapisi({
    xml: h.xml, books, varMi: (a) => tam.has(a), beklenenMain: main,
    ilkImKeysGerekli: true, imKeysDolu: () => false,
  });
  assert.ok(imk1.some((s) => /ilk kapak imKeys/.test(s)));
});

// ─── IO ─────────────────────────────────────────────────────────────────────────────────────

test('uçtan uca: 2 üye eklenir, 28 taşınır, 2 çıkar; kapı geçer; eski girdiler bayt-aynı', async () => {
  const o = ortam();
  const onceDz = M.zipDizini(o.zip);
  const r = await P.panelMenuHizala({ ...o.ortak });
  assert.match(r.sonuc, /^UYGULANDI/);
  assert.deepEqual(r.eklenen, ['73010', '73147']);
  assert.equal(r.tasinan.length, 28);
  assert.deepEqual(r.cikarilan.sort(), ['61633', '61635']);
  assert.equal(o.sayac.panel, 1);
  assert.equal(o.sayac.teklif.length, 2);
  assert.match(o.sayac.teklif[0], /GetKitapGuncellemeBilgi\?id=73010&setMi=0&versiyon=0$/);
  assert.equal(o.sayac.resim.length, 30); // her üyenin panel kapak görseli
  const { dz, ham, xml } = zipMenu(o.zip);
  assert.deepEqual(ig.menuBicimi(ham), { bas: 27, ara: 4, son: 27 }); // kaynağın biçimi korunur
  assert.equal(P.hSimule(xml, 683, 1419, 31456), '10');
  assert.ok(dz.has('assets/73010/data/BookContent.xml'));
  assert.ok(dz.has('assets/73147/pages/1.png'));
  assert.ok(dz.has('assets/73010/f128f76d-8229-4075-baf3-591fd4f18ba7.png'));
  assert.ok(dz.has('assets/61633/data/BookContent.xml'), 'panelde olmayanın içeriği silinmez');
  // İlk kapak artık 73010 → set diyaloğunun okuduğu imKeys oraya kopyalandı.
  const ilk = M.zipGirdiOku(o.zip, dz.get('assets/73010/imKeys.dll'));
  assert.deepEqual(imk.imKeysCoz(ilk), ['KOD11', 'KOD22']);
  assert.equal(dz.has('assets/73147/imKeys.dll'), false, 'anahtarsız yeni üyeye kopya YOK (imKeys adımının işi)');
  assert.deepEqual(r.imKeysKopya, ['assets/73010/imKeys.dll']);
  for (const [ad, g] of onceDz) {
    if (ad === 'classlibraries/ImWin32.dll') continue;
    assert.equal(dz.get(ad).crc, g.crc, ad);
  }
  for (const ad of dz.keys()) {
    assert.ok(onceDz.has(ad) || /^assets\/(73010|73147|\d+\/[0-9a-f-]+\.(png|jpg)$)/.test(ad), ad);
  }
  assert.ok(fs.existsSync(r.kanit));
  assert.equal(fs.existsSync(`${o.zip}.panel-menu-aday`), false);
});

test('ikinci koşu: zaten hizalı → zip bayt-aynı, indirme yok', async () => {
  const o = ortam();
  await P.panelMenuHizala({ ...o.ortak });
  const md = md5(fs.readFileSync(o.zip));
  o.sayac.teklif.length = 0;
  o.sayac.resim.length = 0;
  const r = await P.panelMenuHizala({ ...o.ortak });
  assert.match(r.sonuc, /zaten hizalı/);
  assert.equal(md5(fs.readFileSync(o.zip)), md);
  assert.equal(o.sayac.teklif.length, 0);
  assert.equal(o.sayac.resim.length, 0);
});

test('key/activation korunur: main ve kapak key öznitelikleri aynen, yeni kapakta key boş', async () => {
  const xml = MENU_XML.replace(/(<main\b[^>]*\s)key=""/, '$1key="SETKEY9"')
    .replace(/(<cover\b[^>]*\sID="31456"[^>]*?)(\s*>)/, '$1 key="KAPAKKEY1"$2');
  const o = ortam({ xml });
  await P.panelMenuHizala({ ...o.ortak });
  const yeni = zipMenu(o.zip).xml;
  assert.equal(/<main\b[^>]*>/.exec(yeni)[0], /<main\b[^>]*>/.exec(xml)[0]);
  assert.match(/<main\b[^>]*>/.exec(yeni)[0], /activation="true" key="SETKEY9"/);
  const c = P.kapakSirasi(yeni).find((k) => k.id === '31456').etiket;
  assert.equal(attr(c, 'key'), 'KAPAKKEY1');
  assert.equal(attr(P.kapakSirasi(yeni)[0].etiket, 'key'), '');
});

test('eksik üye İmpark\'ta içeriksiz → görünür hata, iş kopyası değişmez', async () => {
  const o = ortam();
  const md = md5(fs.readFileSync(o.zip));
  const getir = async (url) => (/id=73147/.test(url)
    ? { status: 200, govde: '{"Success":true,"Data":"","Vs":0}' } : o.ortak.getir(url));
  await assert.rejects(P.panelMenuHizala({ ...o.ortak, getir }),
    /PANEL MENÜ HİZALAMA: panel üyesi 73147 .*içeriksiz/);
  assert.equal(md5(fs.readFileSync(o.zip)), md);
});

test('kapı adayda düşer (zip içeriği yazamadı) → hata, iş kopyası değişmez, aday kalmaz', async () => {
  const o = ortam();
  const md = md5(fs.readFileSync(o.zip));
  // Bozuk yazıcı: yalnız menüyü yazar, yeni üyelerin içeriğini atlar.
  const zipKomutu = (cmd, args, opt) => M.komut(cmd, args.filter((a) => a !== 'assets'), opt);
  await assert.rejects(P.panelMenuHizala({ ...o.ortak, zipKomutu }),
    /KAPI RED .*73010: assets\/73010\/data\/BookContent\.xml yok/);
  assert.equal(md5(fs.readFileSync(o.zip)), md);
  assert.equal(fs.existsSync(`${o.zip}.panel-menu-aday`), false);
});

test('bookN menülü set → no-op, panele hiç sorulmaz', async () => {
  const o = ortam({
    kitapEkle: (kok) => yaz(kok, 'book1/classlibraries/ImWin32.dll', 'x'),
  });
  const md = md5(fs.readFileSync(o.zip));
  const r = await P.panelMenuHizala({ ...o.ortak });
  assert.match(r.sonuc, /bookN menülü set/);
  assert.equal(o.sayac.panel, 0);
  assert.equal(md5(fs.readFileSync(o.zip)), md);
});

test('panel ölçülemedi (500 / 429 / ağ) → GEÇİCİ hata + kanıt, iş kopyası değişmez', async () => {
  for (const cevap of [{ status: 500, govde: 'err' }, { hata: 'bağlantı kurulamadı' },
    { status: 429, govde: 'yavaş' }]) {
    const o = ortam();
    const md = md5(fs.readFileSync(o.zip));
    let n = 0;
    const e = await P.panelMenuHizala({ ...o.ortak, panelGetir: async () => { n += 1; return cevap; } })
      .then(() => null, (x) => x);
    assert.ok(e, 'fırlatmalı');
    assert.equal(e.gecici, true);
    assert.match(e.message, /panel listesi ölçülemedi .*iş ertelendi/);
    assert.equal(n, 3, '3 deneme');
    assert.equal(md5(fs.readFileSync(o.zip)), md);
    assert.equal(o.sayac.teklif.length, 0);
    const k = fs.readdirSync(path.join(o.d, 'kanit'));
    assert.equal(k.length, 1);
    assert.match(JSON.parse(fs.readFileSync(path.join(o.d, 'kanit', k[0]), 'utf8')).sonuc, /ÖLÇÜLEMEDİ/);
  }
});

test('panel listesi meşru boş → no-op, iş kopyası değişmez', async () => {
  const o = ortam();
  const md = md5(fs.readFileSync(o.zip));
  const r = await P.panelMenuHizala({
    ...o.ortak, panelGetir: async () => ({ status: 200, govde: '{"Books":null,"statusMessage":"Kitap bulunamadı"}' }),
  });
  assert.match(r.sonuc, /panel listesi boş \(Books boş \(Kitap bulunamadı\)\)/);
  assert.equal(md5(fs.readFileSync(o.zip)), md);
});

test('bozuk panel satırı / beklenmeyen menü yapısı → iş düşmez: dokunulmadı + uyarı + kanıt', async () => {
  const j = JSON.parse(PANEL_GOVDE);
  j.Books[3].FixName = '../x';
  const durumlar = [
    { ad: 'bozuk satır', o: ortam(), panelGetir: async () => ({ status: 200, govde: JSON.stringify(j) }),
      re: /panel satırı bozuk/ },
    { ad: 'menü yapısı', o: ortam({ xml: MENU_XML.replace('</Group>', '</Group><Extra/>') }),
      re: /menü yapısı beklenmedik/ },
  ];
  for (const d of durumlar) {
    const md = md5(fs.readFileSync(d.o.zip));
    const uyari = [];
    const r = await P.panelMenuHizala({
      ...d.o.ortak, ...(d.panelGetir ? { panelGetir: d.panelGetir } : {}), warn: (x) => uyari.push(x),
    });
    assert.match(r.sonuc, d.re, d.ad);
    assert.ok(uyari.some((x) => d.re.test(x)), d.ad);
    assert.ok(r.kanit && fs.existsSync(r.kanit), d.ad);
    assert.equal(md5(fs.readFileSync(d.o.zip)), md, d.ad);
    assert.equal(d.o.sayac.teklif.length, 0, d.ad);
  }
});

test('eksik üye teklifi ölçülemedi / indirme ağ hatası → GEÇİCİ; iş kopyası değişmez', async () => {
  const o = ortam();
  const md = md5(fs.readFileSync(o.zip));
  const e1 = await P.panelMenuHizala({ ...o.ortak, getir: async () => ({ status: 503, govde: '' }) })
    .then(() => null, (x) => x);
  assert.equal(e1.gecici, true);
  assert.match(e1.message, /73010 .*İmpark ölçülemedi: HTTP 503 — iş ertelendi/);
  const o2 = ortam();
  const e2 = await P.panelMenuHizala({
    ...o2.ortak, indir: async (u) => { throw new Error(`indirilemedi (indirme kodu 28): ${u}`); },
  }).then(() => null, (x) => x);
  assert.equal(e2.gecici, true);
  assert.match(e2.message, /73010 indirilemedi/);
  assert.equal(md5(fs.readFileSync(o.zip)), md);
});

test('panel adayları paketten: baseEndpointUrl > kapak URL alanı; sorucoz/localhost aday değil', () => {
  const xml = '<main ID="1"><Group ID="1"><Tab ID="1"><cover ID="5" URL="https://icerik.ornek.net/'
    + 'Uploads/ZKitapZipH/5-1.zip"></cover></Tab></Group></main>';
  const a = P.panelAdaylari({ setId: '1', appConfig: 'baseEndpointUrl: "https://yayinci.ornek.com",',
    menuXml: xml, env: {} });
  assert.deepEqual(a.map((x) => x.url), [
    'https://yayinci.ornek.com/MobilService/GetPackageBooks?id=1',
    'https://icerik.ornek.net/MobilService/GetPackageBooks?id=1',
  ]);
  assert.equal(a[0].kaynak, 'app.config.js baseEndpointUrl');
  const b = P.panelAdaylari({ setId: '1', appConfig: "baseEndpointUrl: 'https://www.sorucoz.tv'",
    menuXml: '<main/>', env: {} });
  assert.deepEqual(b, []);
  // 45449: baseEndpointUrl yok → menü kapaklarının İmpark içerik alanı.
  assert.deepEqual(P.panelAdaylari({ setId: '45449', appConfig: '', menuXml: MENU_XML, env: {} })
    .map((x) => x.url), ['https://akillitahta.ydspublishing.com/MobilService/GetPackageBooks?id=45449']);
  const c = P.panelAdaylari({ setId: '7', appConfig: 'baseEndpointUrl: "https://y.com"', menuXml: xml,
    env: { EMPP_PANEL_PAKET_URL: 'https://a/b?id={BOOK_ID}' } });
  assert.deepEqual(c.map((x) => x.url), ['https://a/b?id=7'], 'env yalnız üstüne yazar');
});

test('uçtan uca: baseEndpointUrl paketten okunur ve panel ona sorulur', async () => {
  const o = ortam({ appConfigEk: 'baseEndpointUrl: "https://yayinci.ornek.com", ' });
  const sorulan = [];
  const r = await P.panelMenuHizala({
    ...o.ortak, panelGetir: async (u) => { sorulan.push(u); return { status: 200, govde: PANEL_GOVDE }; },
  });
  assert.match(r.sonuc, /^UYGULANDI/);
  assert.deepEqual(sorulan, ['https://yayinci.ornek.com/MobilService/GetPackageBooks?id=45449']);
});

test('panel tabanı türetilemiyor → no-op + uyarı, panele sorulmaz', async () => {
  const xml = MENU_XML.replace(/URL="https:\/\/akillitahta\.ydspublishing\.com/g, 'URL="http://x');
  const o = ortam({ xml });
  const md = md5(fs.readFileSync(o.zip));
  const uyari = [];
  const r = await P.panelMenuHizala({ ...o.ortak, warn: (x) => uyari.push(x) });
  assert.match(r.sonuc, /panel tabanı yok/);
  assert.equal(o.sayac.panel, 0);
  assert.ok(uyari.some((x) => /panel tabanı paketten türetilemedi/.test(x)));
  assert.equal(md5(fs.readFileSync(o.zip)), md);
});

test('kapak görseli inmezse uyarı; hizalama yine uygulanır', async () => {
  const o = ortam();
  const uyari = [];
  const r = await P.panelMenuHizala({
    ...o.ortak, resimIndir: async () => { throw new Error('HTTP 404'); }, warn: (s) => uyari.push(s),
  });
  assert.match(r.sonuc, /^UYGULANDI/);
  assert.equal(r.resim.hata, 30);
  assert.ok(uyari.some((s) => /kapak görseli inmedi/.test(s)));
});

test('kapak görseli süre bütçesi dolunca kalanlar atlanır, uyarı; hizalama yine uygulanır', async () => {
  const o = ortam();
  let t = 0;
  const uyari = [];
  const r = await P.panelMenuHizala({
    ...o.ortak, resimButcesiMs: 5, simdi: () => t, warn: (x) => uyari.push(x),
    resimIndir: async (u, h) => { t += 3; return o.ortak.resimIndir(u, h); },
  });
  assert.match(r.sonuc, /^UYGULANDI/);
  assert.equal(r.resim.indirilen, 2);
  assert.equal(r.resim.butceAsildi, 28);
  assert.ok(uyari.some((x) => /süre bütçesi doldu: 28/.test(x)));
});

test('kapı: taşınan kapağın key/activation değişirse ve xmlSource FixName dışıysa ihlal', () => {
  const { books } = panel();
  const yeniler = new Map([['73010', { vs: 1, url: 'u' }], ['73147', { vs: 1, url: 'u' }]]);
  const h = P.menuHizala(MENU_XML, books, yeniler);
  const main = /<main\b[^>]*>/.exec(MENU_XML)[0];
  const tam = new Set(books.map((b) => `assets/${b.fixName}/data/BookContent.xml`));
  tam.add('assets/baska/data/BookContent.xml');
  const ortak = { books, varMi: (a) => tam.has(a), beklenenMain: main, eskiXml: MENU_XML };
  assert.deepEqual(P.hizalamaKapisi({ ...ortak, xml: h.xml }), []);
  const bozuk = h.xml.replace(/(<cover\b[^>]*\sID="31460"[^>]*\s)activation="false"/, '$1activation="true"')
    .replace(/(<cover\b[^>]*\sID="31459"[^>]*\s)xmlSource="[^"]*"/, '$1xmlSource="assets/baska/data/BookContent.xml"');
  const ihlal = P.hizalamaKapisi({ ...ortak, xml: bozuk });
  assert.ok(ihlal.some((x) => /31460: activation eski menüyle aynı değil/.test(x)), ihlal.join('|'));
  assert.ok(ihlal.some((x) => /31459: xmlSource assets\/baska/.test(x)), ihlal.join('|'));
});

test('menuHizala: eski kapağın xmlSource\'u FixName dışındaysa assets/<FixName>/ olarak yazılır', () => {
  const xml = MENU_XML.replace('xmlSource="assets/31456/data/BookContent.xml"',
    'xmlSource="/assets/31456/data/BookContent.xml"');
  const yeniler = new Map([['73010', { vs: 1, url: 'u' }], ['73147', { vs: 1, url: 'u' }]]);
  const h = P.menuHizala(xml, panel().books, yeniler);
  const c = P.kapakSirasi(h.xml).find((k) => k.id === '31456').etiket;
  assert.equal(attr(c, 'xmlSource'), 'assets/31456/data/BookContent.xml');
});

test('yazma izni: yalnız assets/<izinli>/** ve kök menü', () => {
  const izin = new Set(['73010']);
  assert.equal(P.yazmaIzinli('assets/73010/data/BookContent.xml', izin), true);
  assert.equal(P.yazmaIzinli('classlibraries/ImWin32.dll', izin), true);
  assert.equal(P.yazmaIzinli('assets/31456/data/BookContent.xml', izin), false);
  assert.equal(P.yazmaIzinli('index.html', izin), false);
  assert.equal(P.yazmaIzinli('assets/73010/../x', izin), false);
});

test('runner sırası: merdiven → set eki → taban kapsama → panel hizalama → imKeys → menü başlığı → üyeler', () => {
  const s2 = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  const yer = (x) => s2.indexOf(x);
  const sira = [
    'await kaynakAdim.merdiven({', 'await setEkiUygula();', 'TABAN KAPSAMA',
    'await kaynakAdim.panelMenuHizala({', 'await kaynakAdim.imKeys({', 'await kaynakAdim.menuBasligi({',
    'icerikUyeleri.zipIcerikUyeleri(zipPath)',
  ].map(yer);
  assert.ok(sira.every((v, i) => v > 0 && (i === 0 || v > sira[i - 1])), sira.join(' '));
  assert.match(s2, /panelMenuHizala: \(o\) => panelMenu\.panelMenuHizala\(/);
  assert.match(s2, /if \(kaynak\.tur === 'manuel'\) return \{ pm: null \};\n\s+try \{\n\s+const pm = await kaynakAdim\.panelMenuHizala/);
  assert.match(s2, /setListesi: kapiSetListesi,/);
});

test('panel ucu YOK (CF 403 / 404 / JSON-dışı 200, bütün adaylarda) → dokunulmadı + uyarı + kanıt, iş sürer', async () => {
  for (const cevap of [{ status: 403, govde: '<!DOCTYPE html><title>Just a moment...</title>' },
    { status: 404, govde: 'yok' }, { status: 200, govde: '<html>bakım</html>' }]) {
    const o = ortam();
    const md = md5(fs.readFileSync(o.zip));
    let n = 0;
    const r = await P.panelMenuHizala({ ...o.ortak, panelGetir: async () => { n += 1; return cevap; } });
    assert.match(r.sonuc, /dokunulmadı: panel ucu yok/);
    assert.equal(r.hizali, undefined, 'panel listesi kapıya gitmez');
    assert.equal(n, 1, 'kalıcı hata yeniden denenmez');
    assert.ok(r.kanit && fs.existsSync(r.kanit));
    assert.equal(md5(fs.readFileSync(o.zip)), md);
  }
});

test('panel ucu YOK ilk adayda → sıradaki aday kaynağa geçer', async () => {
  const o = ortam({ appConfigEk: 'baseEndpointUrl: "https://yayinci.ornek.com", ' });
  const sorulan = [];
  const r = await P.panelMenuHizala({
    ...o.ortak,
    panelGetir: async (u) => {
      sorulan.push(u);
      return /yayinci\.ornek\.com/.test(u) ? { status: 404, govde: 'yok' } : { status: 200, govde: PANEL_GOVDE };
    },
  });
  assert.match(r.sonuc, /^UYGULANDI/);
  assert.deepEqual(sorulan.map((u) => new URL(u).host), ['yayinci.ornek.com', 'akillitahta.ydspublishing.com']);
});

test('tutarlılık: panel ile menünün ortak kimliği yok ya da yarıdan çoğu çıkacak → dokunulmadı', async () => {
  const j = JSON.parse(PANEL_GOVDE);
  const yabanci = { ...j, Books: j.Books.slice(0, 3).map((b, i) => ({ ...b, Id: 90000 + i, FixName: String(90000 + i) })) };
  const yarim = { ...j, Books: j.Books.slice(0, 12) }; // 2 yeni + 10 eski → 30 eskiden 20'si çıkardı
  for (const [panelJ, re] of [[yabanci, /ortak kimliği yok/], [yarim, /30 kapaktan 20 tanesi çıkacaktı/]]) {
    const o = ortam();
    const md = md5(fs.readFileSync(o.zip));
    const r = await P.panelMenuHizala({
      ...o.ortak, panelGetir: async () => ({ status: 200, govde: JSON.stringify(panelJ) }),
    });
    assert.match(r.sonuc, re);
    assert.equal(r.hizali, undefined, 'panel listesi kapıya gitmez');
    assert.equal(o.sayac.teklif.length, 0);
    assert.equal(md5(fs.readFileSync(o.zip)), md);
  }
});

test('panel cevabı: aynı FixName iki farklı Id → BOZUK', () => {
  const j = JSON.parse(PANEL_GOVDE);
  j.Books[1].FixName = j.Books[0].FixName;
  const r = P.panelCevabiYorumla({ status: 200, govde: JSON.stringify(j) });
  assert.equal(r.durum, P.DURUM.BOZUK);
  assert.match(r.neden, /FixName 73010 hem 73010 hem 73147/);
});

test('taban adayı: IP literal, özel ağ, localhost, kullanıcı@host ve port reddedilir', () => {
  for (const u of ['https://10.0.0.21/x', 'https://172.16.1.1/x', 'https://192.168.1.5/x',
    'https://169.254.1.1/x', 'https://0.0.0.0/x', 'https://[::1]/x', 'https://8.8.8.8/x',
    'https://localhost/x', 'https://a@icerik.ornek.net/x', 'https://icerik.ornek.net:8443/x',
    'https://www.sorucoz.tv/x', 'ftp://icerik.ornek.net/x']) {
    assert.equal(P.tabanHostu(u), null, u);
  }
  assert.deepEqual(P.tabanHostu('https://icerik.ornek.net/Uploads/a.zip'),
    { sema: 'https', host: 'icerik.ornek.net' });
  const xml = '<main ID="1"><Group ID="1"><Tab ID="1"><cover ID="5" URL="https://u@kotu.net/a.zip">'
    + '</cover><cover ID="6" URL="https://192.168.1.9/a.zip"></cover></Tab></Group></main>';
  assert.deepEqual(P.panelAdaylari({ setId: '1', appConfig: 'baseEndpointUrl: "https://10.1.1.1"',
    menuXml: xml, env: {} }), []);
});

test('resimAdi: yalnız png/jpg/jpeg/webp/gif uzantılı güvenli ad', () => {
  assert.equal(P.resimAdi('/Uploads/Resim/a-b.png'), 'a-b.png');
  assert.equal(P.resimAdi('/Uploads/Resim/a.JPEG'), 'a.JPEG');
  assert.equal(P.resimAdi('/Uploads/Resim/a.html'), null);
  assert.equal(P.resimAdi('/Uploads/Resim/a'), null);
  assert.equal(P.resimAdi('/Diger/a.png'), null);
});

test('sembolik bağ taşıyan üye arşivi → hata, iş kopyası değişmez', async () => {
  const o = ortam();
  const md = md5(fs.readFileSync(o.zip));
  const d = tmp('bag');
  kitapDizini(d, 'x');
  fs.symlinkSync('/etc', path.join(d, 'assets', 'x', 'kacak'));
  const bagli = path.join(d, 'bagli.zip');
  execFileSync('zip', ['-q', '-r', '-y', bagli, '.'], { cwd: path.join(d, 'assets', 'x') });
  await assert.rejects(P.panelMenuHizala({ ...o.ortak, indir: async (u, h) => fs.copyFileSync(bagli, h) }));
  assert.equal(md5(fs.readFileSync(o.zip)), md);
});

test('set listesi: hizalanınca panel listesi (id | ad) + claim farkı rapora ve kanıta girer', async () => {
  const o = ortam();
  const claim = JSON.parse(PANEL_GOVDE).Books.filter((b) => !['73010', '73147'].includes(String(b.Id)))
    .map((b) => `${b.Id} | ${b.Adi}`).concat(['61633 | Eski 1', '61635 | Eski 2']).join('\n');
  const r = await P.panelMenuHizala({ ...o.ortak, claimListesi: claim });
  assert.equal(r.hizali, true);
  assert.equal(r.listeKaynagi, 'panel');
  assert.deepEqual(r.setListesiPanelFarki, {
    claimVar: true, listeFazla: ['61633', '61635'], panelYeni: ['73010', '73147'],
  });
  const satir = r.panelSetListesi.split('\n');
  assert.equal(satir.length, 30);
  assert.equal(satir[0], '73010 | Yıllara Göre YDT 6-12 Çıkmış Sorular - 2026');
  const kanit = JSON.parse(fs.readFileSync(r.kanit, 'utf8'));
  assert.deepEqual(kanit.setListesiPanelFarki.listeFazla, ['61633', '61635']);
  // İkinci koşu (zaten hizalı) da panel listesini verir.
  const r2 = await P.panelMenuHizala({ ...o.ortak, claimListesi: null });
  assert.match(r2.sonuc, /zaten hizalı/);
  assert.equal(r2.hizali, true);
  assert.equal(r2.setListesiPanelFarki.claimVar, false);
});

test('kokIcerikVarMi: panel hizalamasının çıkardığı üyenin içeriği kökte durur', async () => {
  const o = ortam();
  await P.panelMenuHizala({ ...o.ortak });
  assert.equal(P.kokIcerikVarMi(o.zip, '61633'), true);
  assert.equal(P.kokIcerikVarMi(o.zip, '12345'), false);
});

test('ekleme tavanı: yeni üye sayısı max(3, eski × 0,5)\'i aşarsa TUTARSIZ — dokunulmaz', async () => {
  const j = JSON.parse(PANEL_GOVDE);
  const ek = Array.from({ length: 14 }, (_, i) => ({ ...j.Books[0], Id: 80000 + i, FixName: String(80000 + i) }));
  const o = ortam();
  const md = md5(fs.readFileSync(o.zip));
  const uyari = [];
  const r = await P.panelMenuHizala({
    ...o.ortak, warn: (x) => uyari.push(x),
    panelGetir: async () => ({ status: 200, govde: JSON.stringify({ ...j, Books: j.Books.concat(ek) }) }),
  });
  assert.equal(P.eklemeTavani(30), 15);
  assert.equal(P.eklemeTavani(1), 3);
  assert.match(r.sonuc, /16 yeni üye eklenecekti \(tavan 15; eski 30 kapak\)/);
  assert.equal(r.durum, 'TUTARSIZ');
  assert.equal(r.hizali, undefined, 'panel listesi kapıya gitmez');
  assert.equal(o.sayac.teklif.length, 0);
  assert.equal(md5(fs.readFileSync(o.zip)), md);
});

test('ekleme tavanı: claim listesine göre panel çok yeni üye taşıyorsa UYARI (hizalama yine uygulanır)', async () => {
  const o = ortam();
  const uyari = [];
  const claim = JSON.parse(PANEL_GOVDE).Books.slice(0, 10).map((b) => `${b.Id} | ${b.Adi}`).join('\n');
  const r = await P.panelMenuHizala({ ...o.ortak, claimListesi: claim, warn: (x) => uyari.push(x) });
  assert.match(r.sonuc, /^UYGULANDI/);
  assert.ok(uyari.some((x) => /UYARI: panel claim listesine göre 20 yeni üye taşıyor \(tavan 15\)/.test(x)),
    uyari.join('|'));
});
