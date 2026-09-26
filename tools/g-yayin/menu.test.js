'use strict';

/**
 * G MENÜ (`menu.js`) — `--ekle`/`--cikar` kurulu SET menüsüne yansır. İki biçim:
 *   Web-Z  gerçek paketteki biçimle (Üretim Masası `WebZTemaUretici` çıktısı: `" : "` ayraçlı,
 *          `\/` kaçışlı JSON; yama `window.__setSettings = {…};`) — yama bir VM'de ÇALIŞTIRILIR,
 *          temanın okuyacağı `window.__setSettings.books` doğrudan sınanır.
 *   K17    GERÇEK paketleyici (`set-menu.js` `ensureSetMenu`) çıktısıyla: G ile eklenen/çıkarılan
 *          menü, paketleyicinin o kitap kümesi için ürettiği menünün BAYT BAYT aynısı olmalı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const menu = require('./menu');
const { ensureSetMenu, MENU_ISARETI } = require('../../src/packaging/set-menu');

/* ------------------------------------------------------------------ Web-Z fikstürü */

/** Swift `JSONSerialization` `.prettyPrinted, .sortedKeys` benzeri: `" : "` ve `\/`. */
function swiftJson(v) {
  return JSON.stringify(v, null, 2).replace(/": /g, '" : ').replace(/\//g, '\\/');
}

function webzAyarlar(kitaplar) {
  const books = {};
  kitaplar.forEach(([d, id, ad], i) => {
    books[d] = {
      assetId: id,
      contentType: 'book',
      coverUrl: `images/${d}.png`,
      displayOrder: i,
      title: ad,
    };
  });
  return {
    bookCount: kitaplar.length,
    books,
    contentVersion: null,
    extraMaterials: [],
    features: [{ clickable: true, contentUrl: 'features/voiced.html', id: 'voiced', title: 'Ses' }],
    materials: { audio: false },
    publisherName: '',
    setTitle: 'Super Monsters 2 Set',
    updates: { enabled: false },
  };
}

/** `WebZTemaUretici.yamaBetigi` iskeletinin kısaltılmış AYNISI (sıralama + fetch sarmalayıcı). */
function yamaMetni(ayarlar) {
  return `/* Üretim Masası — çevrimdışı yaması. */
(function () {
  "use strict";

  window.__setSettings = ${swiftJson(ayarlar)};
  window.__setLanguages = {"tr":{}};
  window.__setFeatures = {};
  window.__cevrimdisi = true;

  if (window.__setSettings && window.__setSettings.books) {
    var __hamKitaplar = window.__setSettings.books;
    var __anahtarlar = Object.keys(__hamKitaplar).sort(function (a, b) {
      return __hamKitaplar[a].displayOrder - __hamKitaplar[b].displayOrder;
    });
    var __diziliKitaplar = {};
    for (var __i = 0; __i < __anahtarlar.length; __i++) {
      __diziliKitaplar[__anahtarlar[__i]] = __hamKitaplar[__anahtarlar[__i]];
    }
    window.__setSettings.books = __diziliKitaplar;
  }
  window.fetch = function () { return JSON.stringify(window.__setSettings); };
})();
`;
}

const WEBZ_INDEX =
  '<!DOCTYPE html>\n<html><head><script src="empp-fs-shim.js"></script></head><body>\n' +
  '    <script src="scripts/xmlParser.js"></script>\n' +
  '    <script src="scripts/cevrimdisi-yama.js"></script>\n' +
  '    <script src="scripts/language-set.js"></script>\n</body></html>\n';

const UC_KITAP = [
  ['book1', '58336', "Student's Book"],
  ['book2', '73456', 'Activity Book'],
  ['book3', '58237', 'Skills & Test Book'],
];

function masaTanimi(kitaplar) {
  return swiftJson({
    kitaplar: kitaplar.map(([d, id, ad]) => ({
      ad,
      assetId: id,
      dugmeGorseliVarMi: false,
      grup: '',
      id: `ID-${d}`,
      kapakVarMi: true,
      klasor: d,
      klasorElleYazildi: false,
    })),
    setAdi: 'Super Monsters 2 Set',
    tema: 'webZSf425',
  });
}

function webzTabanlar(kitaplar = UC_KITAP) {
  const a = webzAyarlar(kitaplar);
  return new Map([
    ['index.html', WEBZ_INDEX],
    ['scripts/cevrimdisi-yama.js', yamaMetni(a)],
    ['config/settings.json', swiftJson(a)],
    ['set-menu.json', masaTanimi(kitaplar)],
  ]);
}

/** Yamayı temanın göreceği gibi çalıştırır → `window.__setSettings`. */
function yamayiCalistir(metin) {
  const window = {};
  vm.runInNewContext(metin, { window });
  // VM nesnesi başka bir "realm"den gelir; kıyas için düz veriye çevrilir.
  return JSON.parse(JSON.stringify(window.__setSettings));
}

const KITAP4 = menu.kitapBilgisi(
  'book4',
  ['index.html', 'assets/59999/data/BookContent.xml', 'assets/59999/thumbs/1.jpg', 'sayfa/1.txt'],
  { 59999: '<Book pdfUrl="pdf/SUPER-MONSTERS-2-WORKBOOK.pdf"/>' },
  null,
);

/* ------------------------------------------------------------------ biçim tanıma */

test('bicimTani: Web-Z ve K17 sade tanınır; yayıncı K17 (assets2), özel menü, K17 main yok RED', () => {
  assert.equal(menu.bicimTani(WEBZ_INDEX), 'webz');
  assert.equal(menu.bicimTani(`${MENU_ISARETI}\n<html><body><main>\n</main></body></html>`), 'k17');
  assert.throws(
    () => menu.bicimTani(`${MENU_ISARETI}\n<div class="book-buttons"></div><main></main>`),
    /yayıncı tasarımlı K17/,
  );
  assert.throws(() => menu.bicimTani(`${MENU_ISARETI}\n<body></body>`), /<main> bölümü yok/);
  assert.throws(
    () => menu.bicimTani('<html><body><a href="book1/index.html">Flashy</a></body></html>'),
    /menü biçimi tanınmadı/,
  );
  assert.throws(() => menu.menuGuncelle({ tabanlar: new Map(), cikar: ['book1'] }), /menü tabanı yok/);
});

test('kitapBilgisi: ad önceliği --baslik > BookContent pdfUrl > yok; assetId tek dizin; kapak sırası', () => {
  assert.deepEqual(
    [KITAP4.assetId, KITAP4.kapak, KITAP4.ad, KITAP4.baslikVerildi],
    ['59999', 'book4/assets/59999/thumbs/1.jpg', 'Super Monsters 2 Workbook', false],
  );
  const b = menu.kitapBilgisi('book4', ['assets/1/data/BookContent.xml', 'assets/1/pages/1.png'], {
    1: '<Book pdfUrl="pdf/15792.pdf"/>',
  }, '  Yeni Ad ');
  assert.deepEqual([b.ad, b.kapak, b.baslikVerildi], ['Yeni Ad', 'book4/assets/1/pages/1.png', true]);
  const sayisal = menu.kitapBilgisi('book4', ['assets/1/data/BookContent.xml'], {
    1: '<Book pdfUrl="pdf/15792.pdf"/>',
  });
  assert.equal(sayisal.ad, null, 'sayısal PDF adı kimliktir, ad değil (73768)');
  assert.equal(sayisal.kapak, null);
  const iki = menu.kitapBilgisi('book4', ['assets/1/BookContent.xml', 'assets/2/data/BookContent.xml']);
  assert.equal(iki.assetId, null);
  assert.match(iki.assetIdSebep, /birden çok kitap kimliği \(1, 2\)/);
  assert.match(menu.kitapBilgisi('book4', ['index.html']).assetIdSebep, /BookContent\.xml yok/);
});

/* ------------------------------------------------------------------ Web-Z */

test('Web-Z: ekle book4 + cikar book3 → yama, settings.json ve set-menu.json birlikte güncellenir', () => {
  const r = menu.menuGuncelle({
    tabanlar: webzTabanlar(),
    ekle: { book4: KITAP4 },
    cikar: ['book3'],
  });
  assert.equal(r.bicim, 'webz');
  assert.deepEqual(r.kitaplar, { book3: 'cikarildi', book4: 'eklendi' });
  assert.deepEqual([...r.dosyalar.keys()].sort(), [
    'config/settings.json',
    'scripts/cevrimdisi-yama.js',
    'set-menu.json',
  ]);
  // Temanın OKUYACAĞI nesne: yama gerçekten çalıştırılır (sıralama bloğu dahil).
  const w = yamayiCalistir(r.dosyalar.get('scripts/cevrimdisi-yama.js').toString('utf8'));
  assert.deepEqual(Object.keys(w.books), ['book1', 'book2', 'book4']);
  assert.deepEqual(w.books.book4, {
    assetId: '59999',
    contentType: 'book',
    coverUrl: 'book4/assets/59999/thumbs/1.jpg',
    displayOrder: 2, // çıkarılan book3'ün ardından: kalanların en büyüğü + 1
    title: 'Super Monsters 2 Workbook',
  });
  assert.equal(w.bookCount, 3, 'bookCount kart sayısına eşit (tema slice eder)');
  assert.equal(w.setTitle, 'Super Monsters 2 Set', 'kitap dışı alanlar korunur');
  assert.equal(w.features.length, 1);
  const a = JSON.parse(r.dosyalar.get('config/settings.json').toString('utf8'));
  assert.deepEqual(a.books, w.books, 'iki kopya aynı');
  assert.equal(a.bookCount, 3);
  const t = JSON.parse(r.dosyalar.get('set-menu.json').toString('utf8'));
  assert.deepEqual(t.kitaplar.map((k) => [k.klasor, k.assetId, k.ad]), [
    ['book1', '58336', "Student's Book"],
    ['book2', '73456', 'Activity Book'],
    ['book4', '59999', 'Super Monsters 2 Workbook'],
  ]);
  assert.equal(t.kitaplar[2].id, menu.kararliKimlik('book4', '59999'));
  assert.match(t.kitaplar[2].id, /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-8[0-9A-F]{3}-[0-9A-F]{12}$/);
  assert.equal(t.tema, 'webZSf425');
  // Yamanın çevresi (fetch sarmalayıcı, sıralama) bayt bayt korunur.
  const once = webzTabanlar().get('scripts/cevrimdisi-yama.js');
  const sonra = r.dosyalar.get('scripts/cevrimdisi-yama.js').toString('utf8');
  assert.equal(sonra.split('window.__setSettings = ')[0], once.split('window.__setSettings = ')[0]);
  assert.equal(sonra.slice(sonra.indexOf(';\n  window.__setLanguages')),
    once.slice(once.indexOf(';\n  window.__setLanguages')));
});

test('Web-Z: idempotent — aynı ekle/cikar ikinci kez hiçbir dosyayı değiştirmez', () => {
  const r1 = menu.menuGuncelle({ tabanlar: webzTabanlar(), ekle: { book4: KITAP4 }, cikar: ['book3'] });
  const t2 = new Map(webzTabanlar());
  for (const [y, v] of r1.dosyalar) t2.set(y, v);
  const r2 = menu.menuGuncelle({ tabanlar: t2, ekle: { book4: KITAP4 }, cikar: ['book3'] });
  assert.equal(r2.dosyalar.size, 0);
  assert.deepEqual(r2.kitaplar, { book3: 'zaten-yok', book4: 'zaten-var' });
  // Yalnız --baslik değişirse kart güncellenir (displayOrder korunur).
  const yeniAd = { ...KITAP4, ad: 'Workbook 2', baslikVerildi: true };
  const r3 = menu.menuGuncelle({ tabanlar: t2, ekle: { book4: yeniAd } });
  assert.deepEqual(r3.kitaplar, { book4: 'guncellendi' });
  const w = yamayiCalistir(r3.dosyalar.get('scripts/cevrimdisi-yama.js').toString('utf8'));
  assert.deepEqual([w.books.book4.title, w.books.book4.displayOrder], ['Workbook 2', 2]);
});

test('Web-Z: tek kopya (yalnız yama ya da yalnız settings.json) de düzenlenir; hiçbiri yoksa RED', () => {
  const yalnizYama = new Map(webzTabanlar());
  yalnizYama.delete('config/settings.json');
  yalnizYama.delete('set-menu.json');
  const r = menu.menuGuncelle({ tabanlar: yalnizYama, cikar: ['book2'] });
  assert.deepEqual([...r.dosyalar.keys()], ['scripts/cevrimdisi-yama.js']);
  const yalnizAyar = new Map(webzTabanlar());
  yalnizAyar.delete('scripts/cevrimdisi-yama.js');
  const r2 = menu.menuGuncelle({ tabanlar: yalnizAyar, cikar: ['book2'] });
  assert.deepEqual([...r2.dosyalar.keys()].sort(), ['config/settings.json', 'set-menu.json']);
  const hic = new Map([['index.html', WEBZ_INDEX]]);
  assert.throws(() => menu.menuGuncelle({ tabanlar: hic, cikar: ['book2'] }), /--menu-taban/);
});

test('Web-Z RED: kopyalar ayrışmış, assetId yok/belirsiz, kapak yok, bozuk yama', () => {
  const ayrisik = new Map(webzTabanlar());
  ayrisik.set('config/settings.json', swiftJson(webzAyarlar(UC_KITAP.slice(0, 2))));
  assert.throws(() => menu.menuGuncelle({ tabanlar: ayrisik, cikar: ['book1'] }), /ayrışmış/);
  const kimliksiz = menu.kitapBilgisi('book4', ['index.html', 'assets/9/thumbs/1.jpg']);
  assert.throws(
    () => menu.menuGuncelle({ tabanlar: webzTabanlar(), ekle: { book4: kimliksiz } }),
    /assetId\) ister.*BookContent\.xml yok/,
  );
  const kapaksiz = menu.kitapBilgisi('book4', ['assets/9/data/BookContent.xml']);
  assert.throws(
    () => menu.menuGuncelle({ tabanlar: webzTabanlar(), ekle: { book4: kapaksiz } }),
    /menü kapağı yok/,
  );
  const bozuk = new Map(webzTabanlar());
  bozuk.set('scripts/cevrimdisi-yama.js', 'window.__setSettings = {"books": ;');
  assert.throws(() => menu.menuGuncelle({ tabanlar: bozuk, cikar: ['book1'] }), /biçim tanınmadı/);
  const cift = new Map(webzTabanlar());
  cift.set('scripts/cevrimdisi-yama.js', `${yamaMetni(webzAyarlar(UC_KITAP))}\nwindow.__setSettings = {};`);
  assert.throws(() => menu.menuGuncelle({ tabanlar: cift, cikar: ['book1'] }), /2 kez var/);
});

/* ------------------------------------------------------------------ K17 (gerçek paketleyiciyle) */

const MOTOR_INDEX =
  '<!doctype html><html><head><script src="app.config.js"></script></head><body>' +
  '<script defer="defer" src="./a8f43f74c72b65a3dd05.main.js"></script></body></html>';

/** Paketleyicinin kendi `ensureSetMenu`'süyle üretilen K17 kök menüsü (verilen kitap kümesi). */
async function paketleyiciMenusu(kitaplar) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'g-menu-k17-'));
  for (const i of kitaplar) {
    const b = path.join(kok, `book${i}`);
    const id = String(58000 + i);
    fs.mkdirSync(path.join(b, 'assets', id, 'thumbs'), { recursive: true });
    fs.mkdirSync(path.join(b, 'assets', id, 'data'), { recursive: true });
    fs.writeFileSync(path.join(b, 'index.html'), MOTOR_INDEX);
    fs.writeFileSync(path.join(b, 'app.config.js'), 'const AppConfig = {};');
    fs.writeFileSync(path.join(b, 'assets', id, 'thumbs', '1.jpg'), 'jpg');
    fs.writeFileSync(
      path.join(b, 'assets', id, 'data', 'BookContent.xml'),
      `<Book pdfUrl="pdf/SHALL-WE-5-BOOK-${i}-2025.pdf" />`,
    );
  }
  fs.writeFileSync(path.join(kok, 'index.html'), MOTOR_INDEX);
  const r = await ensureSetMenu(kok, { force: true, appName: 'Shall We 5 Set' });
  assert.equal(r.mode, 'sade');
  return fs.readFileSync(path.join(kok, 'index.html'), 'utf8');
}

function k17Bilgi(i) {
  const id = String(58000 + i);
  return menu.kitapBilgisi(
    `book${i}`,
    ['index.html', 'app.config.js', `assets/${id}/thumbs/1.jpg`, `assets/${id}/data/BookContent.xml`],
    { [id]: `<Book pdfUrl="pdf/SHALL-WE-5-BOOK-${i}-2025.pdf" />` },
  );
}

test('K17: G ile eklenen/çıkarılan menü, paketleyicinin o küme için ürettiğinin BAYT BAYT aynısı', async () => {
  const uc = await paketleyiciMenusu([1, 2, 3]);
  const r = menu.menuGuncelle({ tabanlar: new Map([['index.html', uc]]), ekle: { book4: k17Bilgi(4) } });
  assert.equal(r.bicim, 'k17');
  assert.deepEqual(r.kitaplar, { book4: 'eklendi' });
  assert.equal(r.dosyalar.get('index.html').toString('utf8'), await paketleyiciMenusu([1, 2, 3, 4]));

  const r2 = menu.menuGuncelle({ tabanlar: new Map([['index.html', uc]]), cikar: ['book2'] });
  assert.equal(r2.dosyalar.get('index.html').toString('utf8'), await paketleyiciMenusu([1, 3]));

  // Araya ekleme: kitap numarası sırası korunur (book2 geri eklenir → 1,2,3).
  const r3 = menu.menuGuncelle({
    tabanlar: new Map([['index.html', await paketleyiciMenusu([1, 3])]]),
    ekle: { book2: k17Bilgi(2) },
  });
  assert.equal(r3.dosyalar.get('index.html').toString('utf8'), uc);

  // İdempotent: zaten var / zaten yok → dosya değişmez.
  const r4 = menu.menuGuncelle({
    tabanlar: new Map([['index.html', uc]]),
    ekle: { book3: k17Bilgi(3) },
    cikar: ['book9'],
  });
  assert.equal(r4.dosyalar.size, 0);
  assert.deepEqual(r4.kitaplar, { book3: 'zaten-var', book9: 'zaten-yok' });
});

test('K17: kartsız menüye ilk kart </main> önüne girer; ad yoksa mevcut ad, o da yoksa "Kitap N"', () => {
  const bos = `${MENU_ISARETI}\n<html><body>\n  <main>\n  </main>\n</body></html>\n`;
  const b = menu.kitapBilgisi('book4', ['index.html']);
  const r = menu.menuGuncelle({ tabanlar: new Map([['index.html', bos]]), ekle: { book4: b } });
  assert.equal(
    r.dosyalar.get('index.html').toString('utf8'),
    `${MENU_ISARETI}\n<html><body>\n  <main>\n` +
      '      <a class="kart" href="book4/index.html"><div class="yok">1</div><span>Kitap 1</span></a>\n' +
      '  </main>\n</body></html>\n',
  );
  const adli = r.dosyalar.get('index.html').toString('utf8').replace('Kitap 1', 'Tom &amp; Jerry');
  const r2 = menu.menuGuncelle({ tabanlar: new Map([['index.html', adli]]), ekle: { book4: b } });
  assert.equal(r2.dosyalar.size, 0, 'mevcut ad korunur (kaçış çözülüp yeniden kaçırılır)');
});
