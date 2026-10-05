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
const { PNG, ESKI_INDEX, sahteIkili, sahteGetir, tekMotorMenu } = require('./fikstur/set-kabuk-sahte');
const A1 = require('../packaging/a1-duzen');
const MOTOR_INDEX = '<html><body><script src="./a8f43f74c72b65a3dd05.main.js"></script></body></html>';
const MOTOR_INDEX_HEAD = '<!doctype html><html><head><meta charset="UTF-8"/><script src="app.config.js"></script>'
  + '<script defer="defer" src="./bd0c1a4f650802c98ebf.main.js"></script></head><body></body></html>';
const TEK_IDLER = ['25861', '25862', '34333'];
/** Tek motorlu set Web-Z ayarı: sıra menüden farklı (Web-Z sırası kazanır), bir link. */
const WEBZ_TEK = {
  setTitle: 'Power Grade 11', books: {
    book1: { assetId: '34333', title: 'Grammar Pack', contentType: 'book', group: 'Books' },
    book2: { assetId: '25861', title: 'Grammar Book', contentType: 'book', group: 'Books' },
    book3: { assetId: '25862', title: 'Kitap 2', contentType: 'book', group: 'Books' },
    link4: { assetId: '', title: 'Worksheet', contentType: 'link', type: 'link', url: 'https://example.com/w/' },
  },
};
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
function buildZip({ kokIndex = ESKI_INDEX, tekMotor = false, sarma = '', cift = false } = {}) {
  const z = new AdmZip();
  const ekle = (ad, veri) => z.addFile(`${sarma}${ad}`, Buffer.from(veri));
  ekle('electron.js', 'require("electron");');
  if (tekMotor) {
    // 11-12 tek motorlu kök: motor index.html + kök menü (3 kapak) + assets/<id> (45485 düzeni).
    ekle('index.html', typeof tekMotor === 'string' ? tekMotor : MOTOR_INDEX_HEAD);
    ekle('app.config.js', 'var AppConfig = { setBook: { enable: true } };');
    ekle('bd0c1a4f650802c98ebf.main.js', '/* motor */');
    ekle('classlibraries/ImWin32.dll', tekMotorMenu(TEK_IDLER));
    for (const id of TEK_IDLER) {
      ekle(`assets/${id}/data/BookContent.xml`, `<Book kitapId="${id}"/>`);
      ekle(`assets/${id}/pages/1.png`, `sayfa-${id}`);
      ekle(`assets/${id}/thumbs/1.jpg`, `kapak-${id}`);
      ekle(`assets/${id}/imKeys.dll`, 'liste');
    }
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
  kitap('book3', cift ? '111' : '222');
  kitap('book4', 'Grade-6-Games');
  return z.toBuffer();
}

async function kostur({
  zip = buildZip(), ayar = WEBZ, kapakYok, mod = '', job = {}, platform = 'darwin', status, aracSuresiMs,
} = {}) {
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
      zip: zipYolu, calisma: d, ikili, platform, getir: w.getir, aracSuresiMs,
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

test('uygunluk: sf425 kök + bookN uygun; motor kopyası kök + bookN uygun; tek motor → A1 kipi', () => {
  const adlar = new Set(['index.html', 'book1/index.html', 'book2/index.html']);
  assert.equal(S.uygunluk({ adlar, kokIndexHtml: ESKI_INDEX }).kokTuru, 'sf425');
  assert.deepEqual(S.uygunluk({ adlar, kokIndexHtml: ESKI_INDEX }).bookNler, ['book1', 'book2']);
  assert.equal(S.uygunluk({ adlar, kokIndexHtml: MOTOR_INDEX }).kokTuru, 'motor-kopyasi');
  assert.equal(S.uygunluk({ adlar, kokIndexHtml: MOTOR_INDEX }).kip, undefined, 'bookN sette A1 yok');
  const tekAdlar = new Set(['index.html', 'classlibraries/ImWin32.dll']);
  const tek = S.uygunluk({ adlar: tekAdlar, kokIndexHtml: MOTOR_INDEX });
  assert.deepEqual([tek.uygun, tek.kip, tek.kokTuru, tek.motorKaynagi], [true, 'a1', 'tek-motor', 'index.html']);
  // Zaten A1: kök sf425 kabuğu + kapak/index.html → motor sayfası yeniden yazılmaz.
  const a1Adlar = new Set([...tekAdlar, 'kapak/index.html']);
  const zaten = S.uygunluk({ adlar: a1Adlar, kokIndexHtml: ESKI_INDEX });
  assert.deepEqual([zaten.uygun, zaten.kip, zaten.kokTuru, zaten.motorKaynagi], [true, 'a1', 'a1', 'kapak/index.html']);
  assert.equal(S.uygunluk({ adlar: a1Adlar, kokIndexHtml: MOTOR_INDEX }).uygun, false, 'kapak var ama kök kabuk değil');
  assert.match(S.uygunluk({ adlar: tekAdlar, kokIndexHtml: '<html>yayıncı</html>' }).neden, /motor sayfası değil/);
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

test('ikinci koşu: kabuk zaten güncel → GÜNCEL, zip bayt-aynı (yeni R2 sürümü açtırmaz)', async () => {
  const ilk = await kostur();
  assert.equal(ilk.r.durum, 'uygulandi', ilk.r.neden);
  const ikinci = await kostur({ zip: ilk.sonra });
  assert.equal(ikinci.r.durum, 'guncel', ikinci.r.neden);
  assert.ok(ikinci.once.equals(ikinci.sonra), 'zip değişmemeli');
  assert.ok(ikinci.loglar.some((l) => l.startsWith('[set-kabuk] GÜNCEL')), ikinci.loglar.join('\n'));
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

// ─── A1 (11-12 tek motorlu set, 05.10) ─────────────────────────────────────────────────────

const zipMetin = (z, ad) => { const e = z.getEntry(ad); return e ? e.getData().toString('utf8') : null; };

test('eslemeKur tek-motor: klasör kapak-<id>, her kitap kapak = assetId, Web-Z sırası', () => {
  const kapi = { kitaplar: TEK_IDLER.map((id, i) => ({ n: i + 1, id })) };
  const e = S.eslemeKur({ liste: S.webzListesi(WEBZ_TEK), kapi, setAdi: 'P', kip: S.KIP_TEK_MOTOR });
  assert.deepEqual(e.eksik, []);
  assert.deepEqual(e.girdi.kitaplar.map((k) => k.klasor), ['kapak-34333', 'kapak-25861', 'kapak-25862', 'link4']);
  assert.deepEqual(e.girdi.kitaplar.slice(0, 3).map((k) => k.kapak), ['34333', '25861', '25862']);
  assert.equal(e.girdi.kitaplar[3].kapak, undefined, 'link kapak taşımaz');
});

test('A1 UYGULANDI: kök = sf425 kabuğu, motor → kapak/index.html (başlıklı), motor dosyaları bayt-aynı', async () => {
  const { r, zipYolu, once, d } = await kostur({ zip: buildZip({ tekMotor: true }), ayar: WEBZ_TEK });
  assert.equal(r.durum, 'uygulandi', r.neden);
  assert.equal(r.kip, 'a1');
  const z = new AdmZip(zipYolu);
  const kapak = zipMetin(z, 'kapak/index.html');
  assert.equal(kapak, A1.baslikEkle(MOTOR_INDEX_HEAD));
  assert.deepEqual(A1.kapakDenetle(kapak), []);
  assert.match(zipMetin(z, 'index.html'), /scripts\/language-set\.js/);
  assert.match(zipMetin(z, 'scripts/language-set.js'), /kapak\/index\.html\?kapak=/);
  const m = menu(zipYolu);
  assert.deepEqual(m.map(([k]) => k), ['kapak-34333', 'kapak-25861', 'kapak-25862', 'link4']);
  for (const [, b] of m.slice(0, 3)) { assert.equal(b.kapak, b.assetId); assert.equal(b.path, '.'); }
  // Motor dosyaları (kök menü, assets, app.config.js, bundle) bayt-aynı.
  const zOnce = new AdmZip(once);
  for (const g of zOnce.getEntries().filter((e) => e.entryName !== 'index.html')) {
    assert.deepEqual(z.getEntry(g.entryName).getData(), g.getData(), g.entryName);
  }
  // İkili --kip tek-motor ile çağrıldı; girdi kip + motorSayfasi + kapak taşır.
  const cagri = JSON.parse(fs.readFileSync(path.join(d, 'cagri.log'), 'utf8').trim());
  assert.equal(cagri.kip, 'tek-motor');
  assert.equal(cagri.g.kip, 'tek-motor');
  assert.equal(cagri.g.motorSayfasi, 'kapak/index.html');
  assert.equal(cagri.g.kitaplar[0].kapak, '34333');
});

test('A1 ikinci koşu: zaten A1 → GÜNCEL, motor sayfası yeniden yazılmaz, zip bayt-aynı', async () => {
  const ilk = await kostur({ zip: buildZip({ tekMotor: true }), ayar: WEBZ_TEK });
  assert.equal(ilk.r.durum, 'uygulandi', ilk.r.neden);
  const ikinci = await kostur({ zip: ilk.sonra, ayar: WEBZ_TEK });
  assert.equal(ikinci.r.durum, 'guncel', ikinci.r.neden);
  assert.equal(ikinci.r.kokTuru, 'a1');
  assert.ok(ikinci.once.equals(ikinci.sonra));
});

test('A1 ATLANDI: eski ikili --kip\'i tanımaz → iş kopyası bayt-aynı, log "A1 atlandı … eski düzen korundu"', async () => {
  const { r, once, sonra, loglar } = await kostur({ zip: buildZip({ tekMotor: true }), ayar: WEBZ_TEK, mod: 'kipsiz' });
  assert.equal(r.durum, 'atlandi');
  assert.match(r.neden, /^A1 atlandı — webz-kabuk-uret tek-motor kipini tanımıyor ya da başarısız \(çıkış 2\)/);
  assert.match(r.neden, /eski düzen korundu/);
  assert.ok(once.equals(sonra), 'yarım düzen üretilmez');
  assert.ok(loglar.some((l) => l.startsWith('[set-kabuk] ATLANDI — A1 atlandı')), loglar.join('\n'));
});

for (const [mod, beklenen] of [
  ['kipi-yoksay', /kart imzası yok/],
  ['a1-imzasiz', /kart imzası yok/],
  ['a1-yolsuz', /path undefined ≠ \./],
  ['a1-kapak', /kapak 1 ≠ assetId 34333/],
]) {
  test(`A1 kapı RED (${mod}): iş kopyası DEĞİŞMEDİ`, async () => {
    const { r, once, sonra } = await kostur({ zip: buildZip({ tekMotor: true }), ayar: WEBZ_TEK, mod });
    assert.equal(r.durum, 'atlandi');
    assert.match(r.neden, /^A1 atlandı — kapı RED/);
    assert.ok(r.ihlal.some((i) => beklenen.test(i)), r.ihlal.join('\n'));
    assert.ok(once.equals(sonra));
  });
}

for (const [mod, beklenen] of [
  ['a1-kapak-yaz', /ikili girdi dosyasını değiştirdi: kapak\/index\.html/],
  ['a1-menu-yaz', /ikili girdi dosyasını değiştirdi: classlibraries\/ImWin32\.dll/],
  ['a1-kapak-ek', /ikili kapak\/ altına yazdı: kapak\/ek\.js/],
]) {
  test(`A1 (${mod}): ikili girdiyi değiştirir / kapak/ altına yazarsa → ATLANDI, iş kopyası DEĞİŞMEDİ`, async () => {
    const { r, once, sonra } = await kostur({ zip: buildZip({ tekMotor: true }), ayar: WEBZ_TEK, mod });
    assert.equal(r.durum, 'atlandi');
    assert.match(r.neden, beklenen);
    assert.ok(once.equals(sonra));
  });
}

test('A1 Swift arayüzü: motor sayfası + menü + assets/<id> gölgede ikiliden ÖNCE; kök index gölgede YOK', async () => {
  // Sahte ikili gerçek araç gibi kapak/index.html, ImWin32.dll ya da assets/<id> yoksa çıkış 1 verir;
  // kökte index.html varsa _eski/'ye taşır. UYGULANDI = girdiler hazırdı.
  const { r, zipYolu, d } = await kostur({ zip: buildZip({ tekMotor: true }), ayar: WEBZ_TEK, mod: 'a1-eski-yaz' });
  assert.equal(r.durum, 'uygulandi', r.neden);
  const adlar = new AdmZip(zipYolu).getEntries().map((e) => e.entryName);
  assert.ok(!adlar.some((a) => a.startsWith('_eski')), `_eski/ zip'e girmez: ${adlar.filter((a) => a.startsWith('_'))}`);
  const cagri = JSON.parse(fs.readFileSync(path.join(d, 'cagri.log'), 'utf8').trim());
  assert.deepEqual(cagri.g.kitaplar.filter((k) => k.kapak).map((k) => k.kapak), ['34333', '25861', '25862']);
});

test('A1: gölgede motor sayfası yoksa (araç durur) → ATLANDI; sahte ikili sözleşmeyi zorlar', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-sozlesme-'));
  const ikili = sahteIkili(d);
  fs.mkdirSync(path.join(d, 'g'));
  fs.mkdirSync(path.join(d, 'kok'));
  fs.writeFileSync(path.join(d, 'g', 'girdi.json'), JSON.stringify({ setTitle: 'S', kitaplar: [{ klasor: 'kapak-1', kapak: '1', assetId: '1' }] }));
  const r = require('node:child_process').spawnSync(ikili, ['--kip', 'tek-motor', path.join(d, 'kok'), path.join(d, 'g', 'girdi.json'), d]);
  assert.equal(r.status, 1);
  assert.match(String(r.stderr), /kapak\/index\.html kökte YOK/);
});

test('A1: motor sayfasında zaten <base> varsa → ATLANDI (sessiz bozma yok)', async () => {
  const motor = MOTOR_INDEX_HEAD.replace('<head>', '<head><base href="/">');
  const { r, once, sonra } = await kostur({ zip: buildZip({ tekMotor: motor }), ayar: WEBZ_TEK });
  assert.match(r.neden, /zaten <base> var/);
  assert.ok(once.equals(sonra));
});

test('A1: Web-Z üyesi kök menüde yok → eşlenemez, ATLANDI, Web-Z kapakları istenmez', async () => {
  const ayar = { ...WEBZ_TEK, books: { ...WEBZ_TEK.books, book5: { assetId: '99999', title: 'Yok' } } };
  const { r, once, sonra, istekler } = await kostur({ zip: buildZip({ tekMotor: true }), ayar });
  assert.match(r.neden, /^A1 atlandı — eşlenemeyen Web-Z üyesi: book5/);
  assert.equal(istekler.length, 1);
  assert.ok(once.equals(sonra));
});

test('kapiDenetle A1: kapak sayfası kaynak motordan farklıysa RED', () => {
  const ihlal = S.kapiDenetle({
    once: new Map(), sonra: new Map(), onEk: '', yazilan: ['kapak/index.html'], beklenen: { kitaplar: [] },
    kip: 'a1', motorKaynagi: MOTOR_INDEX_HEAD,
    metin: { kapak: A1.baslikEkle(MOTOR_INDEX_HEAD.replace('<body>', '<body>değişti')), dil: S.A1_KART_IMZASI },
  });
  assert.ok(ihlal.some((i) => /başlık dışında kaynak motor sayfasından farklı/.test(i)), ihlal.join('\n'));
  assert.ok(!ihlal.some((i) => /beklenmeyen kabuk dosyası: kapak/.test(i)), 'kapak/index.html A1\'de izinli');
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

// ─── reviewer düzeltmeleri (05.10) ─────────────────────────────────────────────────────────

/** Anahtar sırası ile displayOrder ÇELİŞİR: displayOrder kazanır (Swift webZAyari kuralı). */
const WEBZ_SIRALI = {
  setTitle: 'S', books: {
    book1: { assetId: '111', title: 'Reference Book', contentType: 'book', displayOrder: 2 },
    book2: { assetId: '222', title: 'Workbook', contentType: 'book', displayOrder: 0 },
    book3: { assetId: '333', title: 'Test Book', contentType: 'book', displayOrder: 3 },
    book4: { assetId: '666', title: 'Games', contentType: 'games', displayOrder: 1 },
    link5: { assetId: '', title: 'Worksheet', type: 'link', url: URL_W, displayOrder: 4 },
  },
};

test('webzListesi: bütün üyelerde displayOrder varsa ona göre (anahtar sırası değil)', () => {
  assert.deepEqual(S.webzListesi(WEBZ_SIRALI).map((g) => g.anahtar), ['book2', 'book4', 'book1', 'book3', 'link5']);
  // Biri eksikse JSON anahtar sırası.
  const eksik = JSON.parse(JSON.stringify(WEBZ_SIRALI));
  delete eksik.books.book3.displayOrder;
  assert.deepEqual(S.webzListesi(eksik).map((g) => g.anahtar), ['book1', 'book2', 'book3', 'book4', 'link5']);
  // Eşitlikte kararlı (JSON anahtar sırası).
  const esit = { books: { b2: { assetId: '2', displayOrder: 0 }, b1: { assetId: '1', displayOrder: 0 } } };
  assert.deepEqual(S.webzListesi(esit).map((g) => g.anahtar), ['b2', 'b1']);
});

test('uçtan uca: displayOrder sırası menüye ve ikili girdisine taşınır', async () => {
  const { r, zipYolu } = await kostur({ ayar: WEBZ_SIRALI });
  assert.equal(r.durum, 'uygulandi', r.neden);
  // book2(222)→build book3, book4(666)→book4, book1(111)→book1, book3(333)→book2.
  assert.deepEqual(r.kitaplar, ['book3', 'book4', 'book1', 'book2', 'link5']);
  assert.deepEqual(menu(zipYolu).map(([k]) => k), ['book3', 'book4', 'book1', 'book2', 'link5']);
});

test('eslemeKur: aynı assetId iki klasörde → çakışma, girdi yok', () => {
  const e = S.eslemeKur({
    liste: S.webzListesi(WEBZ), setAdi: 'S',
    kapi: { kitaplar: [{ n: 1, id: '111' }, { n: 2, id: '333' }, { n: 3, id: '111' }], webzVarliklari: [] },
  });
  assert.equal(e.girdi, null);
  assert.ok(e.eksik.includes('çakışma: assetId 111 birden çok klasörde (book1, book3)'), e.eksik.join('\n'));
});

test('uçtan uca: aynı assetId iki klasörde → ATLANDI (çakışma), iş kopyası bayt-aynı', async () => {
  const { r, once, sonra } = await kostur({ zip: buildZip({ cift: true }) });
  assert.equal(r.durum, 'atlandi');
  assert.match(r.neden, /çakışma: assetId 111 birden çok klasörde \(book1, book3\)/);
  assert.ok(once.equals(sonra));
});

for (const [mod, beklenen] of [['electron', 'electron.js'], ['assets', 'assets/111/data/BookContent.xml']]) {
  test(`kapı RED (beyaz liste, ${mod}): ikili kabuk dışı kök dosyası yazarsa iş kopyası DEĞİŞMEDİ`, async () => {
    const { r, once, sonra } = await kostur({ mod });
    assert.equal(r.durum, 'atlandi');
    assert.ok(r.ihlal.includes(`beklenmeyen kabuk dosyası: ${beklenen}`), (r.ihlal || [r.neden]).join('\n'));
    assert.ok(once.equals(sonra));
  });
}

test('kabukDosyasiMi: kabuk dosyaları ve klasör kapakları kabul, diğerleri RED', () => {
  const k = new Set(['book1', 'book3']);
  for (const y of ['index.html', 'config/settings.json', 'scripts/language-set.js', 'features/voiced.html',
    'images/book3.png', 'images/book1.jpg', 'set-menu.json']) assert.equal(S.kabukDosyasiMi(y, k), true, y);
  for (const y of ['electron.js', 'package.json', 'assets/1/a.js', 'images/book9.png', 'classlibraries/ImWin32.dll',
    'scripts/yeni.js']) assert.equal(S.kabukDosyasiMi(y, k), false, y);
});

test('zaman aşımı: asılı ikili SIGKILL ile öldürülür, adım ATLANDI, iş kopyası bayt-aynı', async () => {
  const { r, once, sonra, d } = await kostur({ mod: 'uyu', aracSuresiMs: 2000 });
  assert.equal(r.durum, 'atlandi');
  assert.match(r.neden, /çıkış -2: zaman aşımı \(2000 ms\), süreç öldürüldü/);
  assert.ok(once.equals(sonra));
  // Yük altında sahte ikili (node) PID yazmadan öldürülmüş olabilir; yazdıysa ölü olmalı.
  const pidYolu = path.join(d, 'ikili.pid');
  if (fs.existsSync(pidYolu)) {
    assert.throws(() => process.kill(Number(fs.readFileSync(pidYolu, 'utf8')), 0), /ESRCH/, 'ikili süreç hâlâ yaşıyor');
  }
});

test('ikiliKostur: süre dolunca süreç SIGKILL ile ölür (code -2, PID yok)', async () => {
  const r = await S.ikiliKostur('/bin/sleep', ['30'], { zamanAsimiMs: 300 });
  assert.equal(r.code, -2);
  assert.match(r.stderr, /zaman aşımı \(300 ms\), süreç öldürüldü/);
  assert.throws(() => process.kill(r.pid, 0), /ESRCH/, 'süreç hâlâ yaşıyor');
  const ok = await S.ikiliKostur('/bin/echo', ['tamam']);
  assert.equal(ok.code, 0);
  assert.equal(ok.stdout.trim(), 'tamam');
});

test('kapak isteği: Web-Z anahtarı URL kodlanır', async () => {
  const ayar = JSON.parse(JSON.stringify(WEBZ));
  ayar.books = { 'kitap 1': ayar.books.book1, ...Object.fromEntries(Object.entries(ayar.books).slice(1)) };
  const { r, istekler } = await kostur({ ayar });
  assert.equal(r.durum, 'uygulandi', r.neden);
  assert.ok(istekler.some((u) => u.includes('/images/kitap%201.png?a=111')), istekler.join('\n'));
});

