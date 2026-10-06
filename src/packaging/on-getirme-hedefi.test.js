'use strict';
/**
 * Madde 10 REGRESYONU (2026-10-06, 45478 / 45480 kasada düştü): A1 tek motorlu sette
 * enjeksiyon `kapak/index.html`e yazıyor, Windows statik kapısı kök sf425 kabuğunda arıyordu.
 * Bu dosya iki tüketicinin (enjeksiyon + kapı) AYNI tanımı kullandığını uçtan uca kanıtlar:
 * gerçek `paketeUygula` → gerçek kapı ölçümü (`agactanTopla`, iki kap: resources/app ve
 * app.asar) → `maddeOnIsitma`. Mock yok.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const A1 = require('./a1-duzen');
const H = require('./on-getirme-hedefi');
const onGetirme = require('./sayfa-on-getirme');
const K = require('../../scripts/windows-paket-kapisi');

const MOTOR = '<!doctype html><html><head><meta charset="UTF-8"/><script src="app.config.js"></script>'
  + '<script defer="defer" src="./bd0c1a4f650802c98ebf.main.js"></script></head><body></body></html>';
const KABUK = '<html><head><title>Set</title></head><body><script src="scripts/language-set.js"></script>'
  + '</body></html>';
const CONFIG = 'const AppConfig = { setBook: { enable: true } };\n';

function yaz(kok, rel, icerik) {
  const t = path.join(kok, ...rel.split('/'));
  fs.mkdirSync(path.dirname(t), { recursive: true });
  fs.writeFileSync(t, icerik);
}

/** Windows paketinin açılmış hâli: `<kok>/resources/app/` altında uygulama. */
function paketKabi() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'madde10-'));
  const app = path.join(kok, 'resources', 'app');
  fs.mkdirSync(app, { recursive: true });
  return { kok, app };
}

/** A1 düzeni (45478 gibi): kök sf425 kabuğu + `kapak/index.html` motor + kökte motor dosyaları. */
function a1Uygulama(app, { sayfa = 5 } = {}) {
  yaz(app, 'index.html', KABUK);
  yaz(app, 'kapak/index.html', A1.baslikEkle(MOTOR));
  yaz(app, 'classlibraries/ImWin32.dll', 'menü');
  yaz(app, 'app.config.js', CONFIG);
  for (const id of ['25861', '25862']) {
    for (let i = 1; i <= sayfa; i++) yaz(app, `assets/${id}/pages/${i}.png`, 'x');
  }
}

/** bookN düzeni (45550 gibi): kök SET menüsü (app.config.js yok) + book1..n tam motor. */
function bookNUygulama(app, n = 3) {
  yaz(app, 'index.html', KABUK);
  for (let b = 1; b <= n; b++) {
    yaz(app, `book${b}/index.html`, MOTOR);
    yaz(app, `book${b}/app.config.js`, CONFIG);
    yaz(app, `book${b}/classlibraries/ImWin32.dll`, 'menü');
    for (let i = 1; i <= 4; i++) yaz(app, `book${b}/assets/${70000 + b}/pages/${i}.png`, 'x');
  }
}

/**
 * `@electron/asar` 3.2.18 `createPackage` yazma akışı KAPANMADAN çözülür (`return out.end()`).
 * Yük altında (tam test koşusu) arşiv yarım okunur — ölçüldü 06.10, 1/2 koşuda düştü. Arşiv
 * beklenen boyuta (8 + başlık + dosya baytları) ulaşana kadar beklenir; ulaşmazsa test düşer.
 */
async function asarYaz(app, hedef) {
  const toplam = K.agacYollari(app).reduce((a, y) => a + fs.statSync(path.join(app, ...y.split('/'))).size, 0);
  await asar.createPackage(app, hedef);
  for (let i = 0; i < 200; i++) {
    try {
      const { headerSize } = asar.getRawHeader(hedef);
      if (fs.statSync(hedef).size >= 8 + headerSize + toplam) return;
    } catch (e) { /* başlık henüz yazılmadı */ }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`app.asar 2 sn içinde tamamlanmadı (${hedef})`);
}

function madde10(kok) {
  const t = K.agactanTopla(kok, { ornekAdet: 2 });
  return { olcum: t.onGetirme, m: K.maddeOnIsitma(t.onGetirme) };
}

const oku = (app, rel) => fs.readFileSync(path.join(app, ...rel.split('/')), 'utf8');

// --- saf tanım ---

test('kitapKokleri: kapı yeniden dışa aktarır, tanım TEK (aynı fonksiyon nesnesi)', () => {
  assert.equal(K.kitapKokleri, H.kitapKokleri);
  assert.deepEqual(H.kitapKokleri(['index.html', 'app.config.js', 'kapak/index.html']), ['']);
  assert.deepEqual(H.kitapKokleri(['index.html', 'book1/index.html', 'book1/app.config.js',
    'book1/htmletk/index.html']), ['book1']);
});

test('a1YollardanMi: a1-duzen.a1Durumu ile aynı ölçüt (işaret + ImWin32 + app.config.js)', () => {
  const yollar = ['index.html', 'kapak/index.html', 'classlibraries/ImWin32.dll', 'app.config.js'];
  const isaretli = A1.baslikEkle(MOTOR);
  assert.equal(H.a1YollardanMi(yollar, isaretli), true);
  assert.equal(H.a1YollardanMi(yollar, MOTOR), false, 'işaretsiz kapak A1 değil');
  assert.equal(H.a1YollardanMi(yollar, null), false, 'okunamayan kapak A1 değil');
  assert.equal(H.a1YollardanMi(yollar.filter((y) => !y.includes('ImWin32')), isaretli), false);
  // Gerçek dizinde I/O sürümüyle aynı karar.
  const { app } = paketKabi();
  a1Uygulama(app);
  assert.equal(A1.a1DuzeniMi(app), H.a1YollardanMi(K.agacYollari(app), oku(app, 'kapak/index.html')));
});

test('onGetirmeSayfasi: A1 kökü → kapak/index.html; bookN ve A1 olmayan kök → kendi index.html', () => {
  assert.equal(H.onGetirmeSayfasi('', true), 'kapak/index.html');
  assert.equal(H.onGetirmeSayfasi('', false), 'index.html');
  assert.equal(H.onGetirmeSayfasi('book2', false), 'book2/index.html');
  assert.equal(H.onGetirmeSayfasi('book2', true), 'book2/index.html');
});

// --- A1 regresyonu (45478 / 45480) ---

test('A1 (45478 düzeni): enjeksiyon kapak/index.html\'e girer → madde 10 GEÇER (resources/app)', async () => {
  const { kok, app } = paketKabi();
  a1Uygulama(app);
  const r = await onGetirme.paketeUygula(app);
  assert.deepEqual(r.map((x) => [x.kitap, x.sayfa, x.sebep]), [['kapak', 10, 'enjekte-edildi']]);
  assert.ok(oku(app, 'kapak/index.html').includes(onGetirme.ISARET), 'betik motor sayfasında');
  assert.ok(!oku(app, 'index.html').includes(onGetirme.ISARET), 'kök kabuğa betik GİRMEZ');
  const { olcum, m } = madde10(kok);
  assert.deepEqual(olcum.hedefler, [{ kok: '', sayfa: 'kapak/index.html' }]);
  assert.equal(olcum.a1, true);
  assert.equal(m.durum, 'PASS', m.detay);
  assert.match(m.detay, /A1: kapak\/index\.html/);
});

test('A1: aynı ağaç app.asar içinde de GEÇER (Windows paketinin gerçek kabı)', async () => {
  const { kok, app } = paketKabi();
  a1Uygulama(app);
  await onGetirme.paketeUygula(app);
  await asarYaz(app, path.join(kok, 'resources', 'app.asar'));
  fs.renameSync(app, path.join(kok, 'app-acik-yedek'));
  const t = K.agactanTopla(kok, { ornekAdet: 2 });
  assert.equal(t.icerikKabi, 'app.asar');
  const m = K.maddeOnIsitma(t.onGetirme);
  assert.equal(m.durum, 'PASS', m.detay);
});

test('A1: betik HİÇ enjekte edilmemişse madde 10 FAIL KALIR (fail-closed) ve aranan sayfayı söyler', () => {
  const { kok, app } = paketKabi();
  a1Uygulama(app);
  const { m } = madde10(kok);
  assert.equal(m.durum, 'FAIL');
  assert.match(m.detay, /HİÇBİRİNDE "EMPP_ON_GETIRME" yok/);
  assert.match(m.detay, /aranan: kapak\/index\.html/);
});

test('A1: işaret yalnız KÖK KABUKTAYSA (yanlış sayfa) madde 10 FAIL — kabuk sayfa ısıtmaz', () => {
  const { kok, app } = paketKabi();
  a1Uygulama(app);
  yaz(app, 'index.html', KABUK.replace('</body>', '<script>/*EMPP_ON_GETIRME*/</script></body>'));
  const { m } = madde10(kok);
  assert.equal(m.durum, 'FAIL', m.detay);
});

test('A1 işareti kaybolmuş kapak (A1 değil sayılır) → kök index.html aranır, kabukta işaret yok → FAIL', () => {
  const { kok, app } = paketKabi();
  a1Uygulama(app);
  yaz(app, 'kapak/index.html', MOTOR.replace('</body>', '<script>/*EMPP_ON_GETIRME*/</script></body>'));
  const { olcum, m } = madde10(kok);
  assert.equal(olcum.a1, false);
  assert.equal(m.durum, 'FAIL', 'işaretsiz kapak A1 kanıtı değil — kapı geçirmez');
});

// --- bookN gerilemesizlik (45550 / 45538 / 11811) ---

test('bookN (45550 düzeni): her bookN/index.html enjekte → madde 10 GEÇER; kök menü kitap kökü değil', async () => {
  const { kok, app } = paketKabi();
  bookNUygulama(app, 3);
  const r = await onGetirme.paketeUygula(app);
  assert.deepEqual(r.map((x) => [x.kitap, x.sayfa]), [['book1', 4], ['book2', 4], ['book3', 4]]);
  assert.ok(!oku(app, 'index.html').includes(onGetirme.ISARET), 'SET menüsü yamalanmaz');
  const { olcum, m } = madde10(kok);
  assert.deepEqual(olcum.hedefler.map((h) => h.sayfa),
    ['book1/index.html', 'book2/index.html', 'book3/index.html']);
  assert.equal(olcum.a1, false);
  assert.equal(m.durum, 'PASS', m.detay);
  assert.doesNotMatch(m.detay, /A1:/);
});

test('bookN: bir kardeş atlanırsa KARDEŞ KÖR NOKTASI FAIL kalır', async () => {
  const { kok, app } = paketKabi();
  bookNUygulama(app, 3);
  await onGetirme.paketeUygula(app);
  yaz(app, 'book2/index.html', MOTOR);
  const { m } = madde10(kok);
  assert.equal(m.durum, 'FAIL');
  assert.match(m.detay, /KARDEŞ KÖR NOKTASI.*book2.*aranan: book2\/index\.html/);
});

test('tek kitap (A1 değil): kök index.html hedef → enjekte + GEÇER', async () => {
  const { kok, app } = paketKabi();
  yaz(app, 'index.html', MOTOR);
  yaz(app, 'app.config.js', CONFIG);
  for (let i = 1; i <= 3; i++) yaz(app, `assets/1/pages/${i}.png`, 'x');
  const r = await onGetirme.paketeUygula(app);
  assert.deepEqual(r.map((x) => x.kitap), ['(kök)']);
  assert.equal(madde10(kok).m.durum, 'PASS');
});

// --- SÖZLEŞME: enjeksiyonun yazdığı sayfa kümesi = kapının aradığı sayfa kümesi ---

test('SÖZLEŞME: üç düzende enjekte edilen sayfalar = kapının hedef sayfaları', async () => {
  const duzenler = {
    a1: (app) => a1Uygulama(app),
    bookN: (app) => bookNUygulama(app, 2),
    tek: (app) => { yaz(app, 'index.html', MOTOR); yaz(app, 'app.config.js', CONFIG); yaz(app, 'assets/1/pages/1.png', 'x'); },
  };
  for (const [ad, kur] of Object.entries(duzenler)) {
    const { kok, app } = paketKabi();
    kur(app);
    await onGetirme.paketeUygula(app);
    const isaretli = K.agacYollari(app)
      .filter((y) => /\.html$/i.test(y) && oku(app, y).includes(onGetirme.ISARET)).sort();
    const { olcum } = madde10(kok);
    assert.deepEqual(isaretli, olcum.hedefler.map((h) => h.sayfa).sort(), ad);
  }
});
