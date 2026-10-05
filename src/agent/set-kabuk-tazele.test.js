'use strict';

/**
 * sf425 kabuk tazeleme (Z2) — saf kararlar + uçtan uca adım (sahte ikili + sahte Web-Z).
 * Sahte ikili Üretim Masası `webz-kabuk-uret` sözleşmesini taklit eder: <kök> <girdi.json> <kapak>
 * alır, kökte sf425 dosyalarını yazar (yama `window.__setSettings` + `displayOrder`). `SAHTE_MOD`
 * ile bilerek bozuk çıktı üretir (kapının reddettiğini kanıtlamak için).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const S = require('./set-kabuk-tazele');
const M = require('./icerik-merdiven');

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `skt-${ad}-`));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(2000, 7)]);
const ESKI_INDEX = '<html><head><title>Akıllı Tahta</title></head><body>\n'
  + '    <script src="scripts/xmlParser.js"></script>\n'
  + '    <script src="scripts/cevrimdisi-yama.js"></script>\n'
  + '    <script src="scripts/language-set.js"></script>\n</body></html>';
const MOTOR_INDEX = '<html><body><script src="./a8f43f74c72b65a3dd05.main.js"></script></body></html>';
const URL_W = 'https://download.ydspublishing.com/worksheets/grade-6-worksheets/';

/** Web-Z ayarı (pilot 45550 biçimi): anahtar sırası = Web-Z sırası; book2/book3 build'de TAKASLI. */
const WEBZ = {
  publisherName: 'YDS Publishing', setTitle: 'Shall We?! 6 Set', bookCount: 5,
  books: {
    book1: { assetId: '111', title: 'Reference Book', contentType: 'book' },
    book2: { assetId: '222', title: 'Workbook', contentType: 'book' },
    book3: { assetId: '333', title: 'Test Book', contentType: 'book' },
    book4: { assetId: '666', title: 'Games', contentType: 'games' },
    link5: { assetId: '', title: 'Worksheet', contentType: 'link', type: 'link', url: URL_W },
  },
};

/** Eski sf425 kökü + bookN: book2=333, book3=222 (anahtar ≠ klasör), book4 Games (dizin ad, menü 666). */
function buildZip({ kokIndex = ESKI_INDEX, tekMotor = false, sarma = '' } = {}) {
  const z = new AdmZip();
  const ekle = (ad, veri) => z.addFile(`${sarma}${ad}`, Buffer.from(veri));
  ekle('electron.js', 'require("electron");');
  if (tekMotor) {
    ekle('index.html', MOTOR_INDEX);
    ekle('classlibraries/ImWin32.dll', 'menü');
    ekle('assets/111/data/BookContent.xml', '<Book/>');
    return z.toBuffer();
  }
  ekle('index.html', kokIndex);
  ekle('scripts/xmlParser.js', '/* eski */');
  ekle('scripts/language-set.js', '/* eski kabuk, imza yok */');
  const eskiMenu = {
    setTitle: 'Eski', books: {
      book1: { assetId: '111', title: 'Reference Book' }, book2: { assetId: '333', title: 'Test Book' },
      book3: { assetId: '222', title: 'Workbook' }, book4: { assetId: '666', title: 'Games' },
    },
  };
  ekle('scripts/cevrimdisi-yama.js', `window.__setSettings = ${JSON.stringify(eskiMenu)};\n`);
  ekle('config/settings.json', JSON.stringify(eskiMenu));
  const kitap = (d, id) => {
    ekle(`${d}/index.html`, `<html>${d}</html>`);
    ekle(`${d}/assets/${id}/data/BookContent.xml`, `<Book kitapId="${id}"/>`);
    ekle(`${d}/assets/${id}/pages/1.png`, `sayfa-${id}`);
    ekle(`${d}/assets/${id}/thumbs/1.jpg`, `kapak-${id}`);
  };
  kitap('book1', '111');
  kitap('book2', '333');
  kitap('book3', '222');
  kitap('book4', 'Grade-6-Games');
  return z.toBuffer();
}

/** Sahte `webz-kabuk-uret` (node betiği). Gerçek aracın çıktı biçimini taklit eder. */
function sahteIkili(dizin) {
  const yol = path.join(dizin, 'webz-kabuk-uret');
  fs.writeFileSync(yol, `#!${process.execPath}
const fs = require('fs'); const path = require('path');
const [kok, girdiYolu, kapak] = process.argv.slice(2);
const mod = process.env.SAHTE_MOD || '';
const g = JSON.parse(fs.readFileSync(girdiYolu, 'utf8'));
fs.appendFileSync(path.join(path.dirname(girdiYolu), '..', 'cagri.log'), JSON.stringify({ kok, g }) + '\\n');
if (mod === 'cikis1') { process.stderr.write('tema şartları eksik'); process.exit(1); }
const yaz = (ad, v) => { fs.mkdirSync(path.dirname(path.join(kok, ad)), { recursive: true }); fs.writeFileSync(path.join(kok, ad), v); };
const books = {};
let kitaplar = g.kitaplar;
if (mod === 'sira') kitaplar = [...kitaplar].reverse();
kitaplar.forEach((k, i) => {
  if (k.contentType === 'link') books[k.klasor] = { assetId: '', title: k.title, contentType: 'link', type: 'link', url: k.url, displayOrder: i };
  else books[k.klasor] = { assetId: mod === 'id' && i === 0 ? '999' : k.assetId, title: k.title, coverUrl: 'images/' + k.klasor + '.jpg',
    contentType: mod === 'tur' ? 'book' : (k.contentType || 'book'), displayOrder: i };
  if (k.contentType !== 'link') yaz('images/' + k.klasor + '.png', fs.readFileSync(path.join(kapak, 'kapak-' + k.klasor + '.png')));
});
const ayar = { setTitle: g.setTitle, books };
yaz('config/settings.json', JSON.stringify(ayar, null, 2));
yaz('scripts/cevrimdisi-yama.js', 'window.__setSettings = ' + JSON.stringify(ayar) + ';\\n/* set-ek:link-tikla */\\n');
yaz('scripts/language-set.js', mod === 'imzasiz' ? '/* eski */' : '(function sonrakiSatirDugmesi() {})();');
yaz('scripts/xmlParser.js', '/* yeni */');
yaz('styles/cevrimdisi.css', '/* css */');
yaz('index.html', ${JSON.stringify(ESKI_INDEX)}.replace('xmlParser.js', mod === 'ref' ? 'yok.js' : 'xmlParser.js'));
yaz('set-menu.json', '{}');
if (mod === 'bookn') yaz('book1/sizinti.js', 'x');
`);
  fs.chmodSync(yol, 0o755);
  return yol;
}

/** Sahte Web-Z: settings + kapaklar; `kapakYok` verilen anahtar 404. */
function sahteGetir({ ayar = WEBZ, kapakYok = null, status = 200 } = {}) {
  const istekler = [];
  const getir = async (url) => {
    istekler.push(url);
    if (url.endsWith('/config/settings.json')) return { status, govde: Buffer.from(JSON.stringify(ayar)) };
    const m = /\/images\/([^/?]+)\.png/.exec(url);
    if (m && m[1] !== kapakYok) return { status: 200, govde: PNG };
    return { status: 404, govde: Buffer.from('not found') };
  };
  return { getir, istekler };
}

async function kostur({ zip = buildZip(), ayar, kapakYok, mod = '', job = {}, platform = 'darwin', status } = {}) {
  const d = tmp('is');
  const zipYolu = path.join(d, 'build.zip');
  fs.writeFileSync(zipYolu, zip);
  const ikili = sahteIkili(d);
  const once = fs.readFileSync(zipYolu);
  const w = sahteGetir({ ayar, kapakYok, status });
  const loglar = [];
  const eskiMod = process.env.SAHTE_MOD;
  process.env.SAHTE_MOD = mod;
  try {
    const r = await S.kabukTazele({
      zip: zipYolu, calisma: d, ikili, platform, getir: w.getir,
      job: { bookId: '45550', kisaKod: 'tlk2k', ...job },
      log: (s) => loglar.push(s), warn: (s) => loglar.push(s),
    });
    return { r, zipYolu, once, sonra: fs.readFileSync(zipYolu), loglar, istekler: w.istekler, d };
  } finally {
    if (eskiMod === undefined) delete process.env.SAHTE_MOD; else process.env.SAHTE_MOD = eskiMod;
  }
}

const menu = (zipYolu) => {
  const z = new AdmZip(zipYolu);
  const ayar = JSON.parse(z.getEntry('config/settings.json').getData().toString());
  return Object.entries(ayar.books).sort((a, b) => a[1].displayOrder - b[1].displayOrder);
};

// ─── saf ────────────────────────────────────────────────────────────────────────────────────

test('acik: varsayılan KAPALI, yalnız "1" açar', () => {
  assert.equal(S.acik({}), false);
  assert.equal(S.acik({ EMPP_SET_KABUK_TAZELE: '0' }), false);
  assert.equal(S.acik({ EMPP_SET_KABUK_TAZELE: '1' }), true);
});

test('uygunluk: sf425 kök + bookN uygun; motor kopyası kök + bookN uygun; tek motor ATLANIR', () => {
  const adlar = new Set(['index.html', 'book1/index.html', 'book2/index.html']);
  assert.equal(S.uygunluk({ adlar, kokIndexHtml: ESKI_INDEX }).kokTuru, 'sf425');
  assert.deepEqual(S.uygunluk({ adlar, kokIndexHtml: ESKI_INDEX }).bookNler, ['book1', 'book2']);
  assert.equal(S.uygunluk({ adlar, kokIndexHtml: MOTOR_INDEX }).kokTuru, 'motor-kopyasi');
  const tek = S.uygunluk({ adlar: new Set(['index.html', 'classlibraries/ImWin32.dll']), kokIndexHtml: MOTOR_INDEX });
  assert.equal(tek.uygun, false);
  assert.equal(tek.neden, 'tek-motor: aktivasyon tasarımı bekliyor');
  // Flashy tema kabuğu (webz-tema-kabuk) ve yayıncı tasarımlı kök dokunulmaz.
  const flashy = '<meta name="empp-webz-tema" content="x"><script src="scripts/language-set.js"></script>';
  assert.equal(S.uygunluk({ adlar, kokIndexHtml: flashy }).uygun, false);
  assert.equal(S.uygunluk({ adlar, kokIndexHtml: '<html>yayıncı</html>' }).uygun, false);
});

test('eslemeKur: assetId ile klasör, Web-Z sırası korunur, link ve games taşınır', () => {
  const liste = S.webzListesi(WEBZ);
  const kapi = { kitaplar: [{ n: 1, id: '111' }, { n: 2, id: '333' }, { n: 3, id: '222' }],
    webzVarliklari: [{ n: 4, id: '666' }] };
  const e = S.eslemeKur({ liste, kapi, setAdi: 'S' });
  assert.deepEqual(e.eksik, []);
  assert.deepEqual(e.girdi.kitaplar.map((k) => k.klasor), ['book1', 'book3', 'book2', 'book4', 'link5']);
  assert.equal(e.girdi.kitaplar[3].contentType, 'games');
  assert.equal(e.girdi.kitaplar[4].url, URL_W);
  assert.ok(e.notlar.some((n) => n === 'book2 → book3 (assetId 222)'));
});

test('eslemeKur: build\'de olmayan üye → girdi yok (adım atlanır)', () => {
  const e = S.eslemeKur({ liste: S.webzListesi(WEBZ), kapi: { kitaplar: [{ n: 1, id: '111' }] }, setAdi: 'S' });
  assert.equal(e.girdi, null);
  assert.equal(e.eksik.length, 3);
});

test('kapakGecerli: 9 baytlık 404 gövdesi kapak değil; PNG/JPEG ≥1 KB kapak', () => {
  assert.equal(S.kapakGecerli(Buffer.from('not found')), false);
  assert.equal(S.kapakGecerli(PNG), true);
  assert.equal(S.kapakGecerli(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2000)])), true);
  assert.equal(S.kapakGecerli(Buffer.alloc(5000)), false);
});

// ─── uçtan uca (sahte ikili + sahte Web-Z) ─────────────────────────────────────────────────

test('UYGULANDI: kabuk yazılır, sıra Web-Z, klasörler aynı, bookN/** merkez dizinde aynı', async () => {
  const { r, zipYolu, once, istekler, d } = await kostur();
  assert.equal(r.durum, 'uygulandi', r.neden);
  assert.deepEqual(r.kitaplar, ['book1', 'book3', 'book2', 'book4', 'link5']);
  assert.deepEqual(menu(zipYolu).map(([k]) => k), ['book1', 'book3', 'book2', 'book4', 'link5']);
  assert.equal(menu(zipYolu)[3][1].contentType, 'games');
  const z = new AdmZip(zipYolu);
  assert.match(z.getEntry('scripts/language-set.js').getData().toString(), /sonrakiSatirDugmesi/);
  // bookN/** bayt-aynı (önce/sonra içerik kıyası).
  const zOnce = new AdmZip(once);
  for (const g of zOnce.getEntries().filter((e) => /^book\d+\//.test(e.entryName))) {
    assert.deepEqual(z.getEntry(g.entryName).getData(), g.getData(), g.entryName);
  }
  assert.equal(z.getEntries().filter((e) => /^book\d+\//.test(e.entryName)).length,
    zOnce.getEntries().filter((e) => /^book\d+\//.test(e.entryName)).length);
  // Web-Z istekleri: settings + 4 kapak (Web-Z anahtarıyla), link kapağı istenmez.
  assert.equal(istekler.length, 5);
  assert.ok(istekler.some((u) => u.includes('/go/tlk2k/web-stream/images/book2.png?a=222')));
  // İkiliye giden girdi: açık klasör + sıra; Web-Z anahtarı alanı sızmaz.
  const cagri = JSON.parse(fs.readFileSync(path.join(d, 'cagri.log'), 'utf8').trim());
  assert.equal(cagri.g.kitaplar[1].klasor, 'book3');
  assert.equal(cagri.g.kitaplar[1].anahtar, undefined);
  // Sahne temizlenir, aday kalmaz.
  assert.deepEqual(fs.readdirSync(d).filter((a) => a.startsWith('set-kabuk-') || a.endsWith('.kabuk-aday')), []);
});

test('sarmalayıcı klasörlü zip: kabuk aynı önekle yazılır', async () => {
  const { r, zipYolu } = await kostur({ zip: buildZip({ sarma: 'SET/' }) });
  assert.equal(r.durum, 'uygulandi', r.neden);
  const z = new AdmZip(zipYolu);
  assert.match(z.getEntry('SET/scripts/language-set.js').getData().toString(), /sonrakiSatirDugmesi/);
  assert.equal(z.getEntry('scripts/language-set.js'), null);
});

test('motor kopyası kök + bookN: kabuk kurulur', async () => {
  const { r } = await kostur({ zip: buildZip({ kokIndex: MOTOR_INDEX }) });
  assert.equal(r.durum, 'uygulandi', r.neden);
  assert.equal(r.kokTuru, 'motor-kopyasi');
});

for (const [ad, ayar] of [
  ['tek motor (11-12)', { zip: buildZip({ tekMotor: true }) }],
  ['Mac değil', { platform: 'linux' }],
  ['kisaKod yok', { job: { kisaKod: '' } }],
  ['Web-Z 403', { status: 403 }],
  ['kapak 404', { kapakYok: 'book3' }],
  ['ikili çıkış 1', { mod: 'cikis1' }],
]) {
  test(`ATLANDI (${ad}): iş kopyası bayt-aynı, hata fırlatılmaz`, async () => {
    const { r, once, sonra, loglar } = await kostur(ayar);
    assert.equal(r.durum, 'atlandi');
    assert.ok(r.neden);
    assert.ok(once.equals(sonra), 'iş kopyası değişmemeli');
    assert.ok(loglar.some((l) => l.startsWith('[set-kabuk] ATLANDI')), loglar.join('\n'));
  });
}

test('tek motor: log nedeni "tek-motor: aktivasyon tasarımı bekliyor"', async () => {
  const { r, istekler } = await kostur({ zip: buildZip({ tekMotor: true }) });
  assert.equal(r.neden, 'tek-motor: aktivasyon tasarımı bekliyor');
  assert.equal(istekler.length, 0, 'uygun olmayan sette Web-Z\'ye gidilmez');
});

test('eşlenemeyen Web-Z üyesi (build\'de yok) → ATLANDI', async () => {
  const ayar = { ...WEBZ, books: { ...WEBZ.books, book6: { assetId: '3114', title: 'Eksik' } } };
  const { r, once, sonra } = await kostur({ ayar });
  assert.equal(r.durum, 'atlandi');
  assert.match(r.neden, /eşlenemeyen Web-Z üyesi: book6 \(Eksik, assetId 3114\)/);
  assert.ok(once.equals(sonra));
});

for (const [mod, beklenen] of [
  ['imzasiz', /sonrakiSatirDugmesi yok/],
  ['sira', /menü sırası/],
  ['id', /menü assetId kümesi/],
  ['tur', /contentType book ≠ Web-Z games/],
  ['ref', /yerel başvurusu zip'te yok: scripts\/yok\.js/],
]) {
  test(`kapı RED (${mod}): iş kopyası DEĞİŞMEDİ`, async () => {
    const { r, once, sonra } = await kostur({ mod });
    assert.equal(r.durum, 'atlandi');
    assert.match(r.neden, /kapı RED/);
    assert.ok(r.ihlal.some((i) => beklenen.test(i)), r.ihlal.join('\n'));
    assert.ok(once.equals(sonra), 'iş kopyası değişmemeli');
  });
}

test('ikili bookN altına yazarsa → ATLANDI, iş kopyası DEĞİŞMEDİ', async () => {
  const { r, once, sonra } = await kostur({ mod: 'bookn' });
  assert.equal(r.durum, 'atlandi');
  assert.match(r.neden, /ikili bookN altına yazdı: book1\/sizinti\.js/);
  assert.ok(once.equals(sonra));
});

test('kapiDenetle: bookN altına yeni girdi eklenirse RED', () => {
  const sonra = new Map([['book1/yeni.js', { ad: 'book1/yeni.js', crc: 1, boyut: 1, sikisik: 1 }]]);
  const ihlal = S.kapiDenetle({ once: new Map(), sonra, onEk: '', yazilan: [], beklenen: { kitaplar: [] }, metin: {} });
  assert.ok(ihlal.includes('bookN altına eklendi: book1/yeni.js'), ihlal.join('\n'));
});

test('kapiDenetle: bookN girdisi değişirse (crc) RED', () => {
  const once = new Map([['book1/a.js', { ad: 'book1/a.js', crc: 1, boyut: 1, sikisik: 1 }]]);
  const sonra = new Map([['book1/a.js', { ad: 'book1/a.js', crc: 2, boyut: 1, sikisik: 1 }]]);
  const ihlal = S.kapiDenetle({ once, sonra, onEk: '', yazilan: [], beklenen: { kitaplar: [] }, metin: {} });
  assert.ok(ihlal.includes('değişti: book1/a.js'), ihlal.join('\n'));
});

test('zip merkez dizini okunabilir kalır (M.zipDizini)', async () => {
  const { zipYolu } = await kostur();
  assert.ok(M.zipDizini(zipYolu).size > 10);
});
