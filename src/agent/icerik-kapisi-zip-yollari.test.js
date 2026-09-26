'use strict';

/**
 * İÇERİKSİZ KAYNAK KAPISI — ZIP YOLU (2026-09-26, entegrasyon bulgusu).
 *
 * Dizin tabanlı kapı (icerik-kapisi.test.js, T1) yalnız TAZE İNDİRME dalında çalışıyordu.
 * Kaynak arşivi (`arsivKaynagi`) ve kaynak önbelleği HIT'i (`cachedZip`) zip'i HİÇ AÇMADAN
 * doğrudan paketleyiciye taşıyordu — bu iki yolda kapı hiç devreye girmiyordu. Bu dosya
 * `girisListesindenDegerlendir`/`icerikKapisiDenetleZip`'i (1) gerçek küçük zip fikstürleriyle
 * ve (2) gerçek `processJob` üzerinden arşiv/HIT yollarının kapıdan geçtiğini kanıtlar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
const { CONFIG, processJob } = require('./runner.js');
const {
  yolListesiTara, girisListesindenDegerlendir, zipGirisAdlariniOku, icerikKapisiDenetleZip,
} = require('./icerik-kapisi');

// ---------------------------------------------------------------------------
// Gerçek küçük zip fikstürleri (11845/45550/45551 tarzı + tek kitap + SET + sarmalayıcı)
// ---------------------------------------------------------------------------

function zipYaz(girisler) {
  const zip = new AdmZip();
  for (const [ad, icerik] of Object.entries(girisler)) {
    zip.addFile(ad, Buffer.from(icerik));
  }
  const dosya = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-kapisi-zip-')), 'build.zip');
  zip.writeZip(dosya);
  return dosya;
}

/** 11845/45550/45551 tarzı — yalnız motor: assets/ yok, bookN/ yok. */
const MOTOR_ONLY = () => zipYaz({
  'index.html': '<html><body>motor</body></html>',
  'app.config.js': 'module.exports = {};',
  'core/x.png': 'binary-ish',
  'classlibraries/ImWin32.dll': 'fake-dll',
});

/** Tek kitap — kökte assets/<id>/. */
const TEK_KITAP = () => zipYaz({
  'index.html': '<html></html>',
  'assets/72378/thumbs/1.jpg': 'jpg',
});

/** SET — kökte book1/, book2/. */
const SET_KITAP = () => zipYaz({
  'book1/app.config.js': 'module.exports = {};',
  'book2/app.config.js': 'module.exports = {};',
});

/** Sarmalayıcı klasörlü tek kitap — extractSfx'in ekleyebileceği tek üst dizin. */
const SARMALAYICI_TEK_KITAP = () => zipYaz({
  'SM3-v49/index.html': '<html></html>',
  'SM3-v49/assets/72378/thumbs/1.jpg': 'jpg',
});

/** Sarmalayıcı klasörlü ama İÇİ de içeriksiz — motor kopyası sarmalayıcı altında. */
const SARMALAYICI_MOTOR_ONLY = () => zipYaz({
  'wrap/index.html': '<html></html>',
  'wrap/app.config.js': 'module.exports = {};',
});

// ---------------------------------------------------------------------------
// Saf fonksiyonlar — girisListesindenDegerlendir / yolListesiTara
// ---------------------------------------------------------------------------

test('yolListesiTara: kök seviyede assets/bookN tespiti', () => {
  assert.deepEqual(yolListesiTara(['assets/1/a.jpg', 'index.html']), { hasAssets: true, hasBookN: false });
  assert.deepEqual(yolListesiTara(['book1/app.config.js']), { hasAssets: false, hasBookN: true });
  assert.deepEqual(yolListesiTara(['index.html', 'core/x.png']), { hasAssets: false, hasBookN: false });
});

test('girisListesindenDegerlendir: motor-only girdiler RED verir', () => {
  const r = girisListesindenDegerlendir(['index.html', 'app.config.js', 'core/x.png'], { kaynakAdi: 'SM3-v49.exe' });
  assert.equal(r.gecti, false);
  assert.match(r.sebep, /^\[kaynak-iceriksiz\]/);
});

test('girisListesindenDegerlendir: tek kitap (assets/) GEÇER', () => {
  const r = girisListesindenDegerlendir(['index.html', 'assets/72378/thumbs/1.jpg']);
  assert.equal(r.gecti, true);
});

test('girisListesindenDegerlendir: SET (bookN/) GEÇER', () => {
  const r = girisListesindenDegerlendir(['book1/app.config.js', 'book2/app.config.js']);
  assert.equal(r.gecti, true);
});

test('girisListesindenDegerlendir: TEK sarmalayıcı klasör altında assets/ varsa bir seviye inip GEÇER', () => {
  const r = girisListesindenDegerlendir(['SM3-v49/index.html', 'SM3-v49/assets/72378/thumbs/1.jpg']);
  assert.equal(r.gecti, true);
});

test('girisListesindenDegerlendir: sarmalayıcı altı da içeriksizse RED kalır', () => {
  const r = girisListesindenDegerlendir(['wrap/index.html', 'wrap/app.config.js']);
  assert.equal(r.gecti, false);
});

test('girisListesindenDegerlendir: BİRDEN ÇOK kök segment varsa sarmalayıcı denenmez (gerçek kök)', () => {
  // İki farklı kök segment (assets YOK, bookN YOK) — sarmalayıcı sezgisi yanlış tetiklenmemeli.
  const r = girisListesindenDegerlendir(['index.html', 'core/x.png']);
  assert.equal(r.gecti, false);
});

// ---------------------------------------------------------------------------
// Gerçek zip dosyaları — zipGirisAdlariniOku / icerikKapisiDenetleZip
// ---------------------------------------------------------------------------

test('zipGirisAdlariniOku: gerçek zip dosyasının giriş adlarını döner', () => {
  const girisler = zipGirisAdlariniOku(TEK_KITAP());
  assert.ok(girisler.includes('assets/72378/thumbs/1.jpg'), girisler.join(','));
});

test('GERİLEME: motor-only gerçek zip → RED (11845/45550/45551 sınıfı)', async () => {
  const sonuc = await icerikKapisiDenetleZip(MOTOR_ONLY(), { kaynakAdi: 'SM3-v49.exe' });
  assert.equal(sonuc.gecti, false);
  assert.match(sonuc.sebep, /\[kaynak-iceriksiz\]/);
});

test('tek kitap gerçek zip → GEÇER', async () => {
  const sonuc = await icerikKapisiDenetleZip(TEK_KITAP());
  assert.equal(sonuc.gecti, true);
});

test('SET gerçek zip → GEÇER', async () => {
  const sonuc = await icerikKapisiDenetleZip(SET_KITAP());
  assert.equal(sonuc.gecti, true);
});

test('sarmalayıcı klasörlü tek kitap gerçek zip → GEÇER', async () => {
  const sonuc = await icerikKapisiDenetleZip(SARMALAYICI_TEK_KITAP());
  assert.equal(sonuc.gecti, true);
});

test('icerikKapisiDenetleZip: bozuk/olmayan zip içeriksiz SAYILIR (fırlatmaz)', async () => {
  const yok = path.join(os.tmpdir(), 'olmayan-' + Date.now() + '.zip');
  const sonuc = await icerikKapisiDenetleZip(yok);
  assert.equal(sonuc.gecti, false);
});

test('icerikKapisiDenetleZip: EMPP_ICERIK_KAPISI=0 iken motor-only zip bile GEÇER + log satırı', async () => {
  const loglar = [];
  const sonuc = await icerikKapisiDenetleZip(MOTOR_ONLY(), {
    env: { EMPP_ICERIK_KAPISI: '0' },
    log: (s) => loglar.push(s),
  });
  assert.equal(sonuc.gecti, true);
  assert.ok(loglar.some((s) => s.includes('icerik-kapisi KAPALI (env)')));
});

// ---------------------------------------------------------------------------
// Runner düzeyinde — gerçek processJob, arşiv VE önbellek HIT yolları (2026-09-26)
// ---------------------------------------------------------------------------

/** Köprü presigned URL'si — next-job'un Mac ajanına verdiği biçim. */
function kopruUrl(bookId, ad) {
  return `https://acc.r2.cloudflarestorage.com/akillitahtalar/${bookId}/${ad}`
    + `?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=${crypto.randomBytes(8).toString('hex')}`;
}

/** Sahte paketleyici: her isteği sayar, 500 döner (iş hızlıca düşsün). */
async function sahtePaketleyici() {
  const istekler = [];
  const sunucu = http.createServer((req, res) => {
    istekler.push(req.url);
    req.resume();
    req.on('end', () => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${sunucu.address().port}`;
  return { istekler, url, kapat: () => sunucu.close() };
}

/** Arşiv kökü + gerçek zip buffer'lı kitap kaydı kurar (BAYAT gate: impark_kaynagi verilmez). */
function arsivKur(bookId, zipDosyaYolu) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-kapisi-zip-arsiv-'));
  const dizin = path.join(kok, String(bookId));
  fs.mkdirSync(dizin);
  const icerik = fs.readFileSync(zipDosyaYolu);
  fs.copyFileSync(zipDosyaYolu, path.join(dizin, 'build.zip'));
  const md5 = crypto.createHash('md5').update(icerik).digest('hex');
  fs.writeFileSync(path.join(dizin, 'kaynak.json'), JSON.stringify({
    dosya: 'build.zip', md5, boyut: icerik.length, etiket: 'test',
  }));
  return kok;
}

/** processJob'u yalıtılmış ortamda koşturur (arşiv VE/YA DA önbellek HIT ortamı hazır). */
async function isKostur({ arsivKok, onbellekKok, bookId, kaynakAdi }) {
  const paketleyici = await sahtePaketleyici();
  const eski = {
    arsiv: process.env.EMPP_KAYNAK_ARSIVI,
    cache: process.env.EMPP_SOURCE_CACHE,
    packagerApi: CONFIG.packagerApi,
  };
  const loglar = [];
  const orjLog = console.log;
  const orjWarn = console.warn;
  process.env.EMPP_KAYNAK_ARSIVI = arsivKok || fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-kapisi-zip-bos-arsiv-'));
  process.env.EMPP_SOURCE_CACHE = onbellekKok || fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-kapisi-zip-cache-'));
  CONFIG.packagerApi = paketleyici.url;
  console.log = (...a) => loglar.push(a.join(' '));
  console.warn = (...a) => loglar.push(a.join(' '));
  let hata = null;
  try {
    await processJob({ agentId: 'test', token: 'x' }, {
      bookId: String(bookId), platform: 'android', downloadUrl: kopruUrl(bookId, kaynakAdi),
      bookTitle: 'Test Kitap', publisherName: 'YDS Publishing',
    });
  } catch (e) {
    hata = e;
  } finally {
    console.log = orjLog;
    console.warn = orjWarn;
    CONFIG.packagerApi = eski.packagerApi;
    for (const [k, v] of [['EMPP_KAYNAK_ARSIVI', eski.arsiv], ['EMPP_SOURCE_CACHE', eski.cache]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    paketleyici.kapat();
  }
  return { hata, loglar: loglar.join('\n'), istekler: paketleyici.istekler };
}

test('GERİLEME: arşiv yolunda içeriksiz zip [kaynak-iceriksiz] ile düşer, paketleyiciye HİÇ gidilmez', async () => {
  const arsivKok = arsivKur(11845, MOTOR_ONLY());
  const r = await isKostur({ arsivKok, bookId: 11845, kaynakAdi: 'SM3-v49.exe' });
  assert.ok(r.hata, 'iş düşmeliydi');
  assert.match(r.hata.message, /^\[kaynak-iceriksiz\]/, r.hata.message);
  assert.deepEqual(r.istekler, [], 'içeriksiz arşiv zip\'i paketleyiciye HİÇ gitmemeli');
  assert.match(r.loglar, /kaynak ARŞİVDEN/, 'arşiv yolu kullanıldığı loglanmalı (indirme değil)');
});

test('arşiv yolunda İÇERİKLİ (tek kitap) zip kapıdan GEÇER, paketleyiciye gider', async () => {
  const arsivKok = arsivKur(72378, TEK_KITAP());
  const r = await isKostur({ arsivKok, bookId: 72378, kaynakAdi: 'Lingoland-Grade-2.exe' });
  assert.deepEqual(r.istekler, ['/api/upload-build'], 'içerikli arşiv zip\'i paketleyiciye gitmeli');
  assert.match(r.hata.message, /packager upload-build failed: HTTP 500/, 'sahte paketleyici 500 (kapı GEÇTİ, üretim orada düştü)');
});

test('GERİLEME: kaynak önbelleği HIT yolunda içeriksiz zip [kaynak-iceriksiz] ile düşer', async () => {
  const onbellekKok = fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-kapisi-zip-cache-hit-'));
  const bookId = 45550;
  const kaynakAdi = 'ShallWe6-v25.exe'; // srcVersionTuret bunu URL'nin son parçasından türetir
  const hedefDizin = path.join(onbellekKok, String(bookId), kaynakAdi);
  fs.mkdirSync(hedefDizin, { recursive: true });
  fs.copyFileSync(MOTOR_ONLY(), path.join(hedefDizin, 'build.zip'));

  const r = await isKostur({ onbellekKok, bookId, kaynakAdi });
  assert.ok(r.hata, 'iş düşmeliydi');
  assert.match(r.hata.message, /^\[kaynak-iceriksiz\]/, r.hata.message);
  assert.deepEqual(r.istekler, [], 'içeriksiz önbellek zip\'i paketleyiciye HİÇ gitmemeli');
  assert.match(r.loglar, /source cache HIT/, 'önbellek yolu kullanıldığı loglanmalı (indirme değil)');
});

test('kaynak önbelleği HIT yolunda İÇERİKLİ (SET) zip kapıdan GEÇER', async () => {
  const onbellekKok = fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-kapisi-zip-cache-hit-ok-'));
  const bookId = 45538;
  const kaynakAdi = 'EnglishUp5-24-v45.exe';
  const hedefDizin = path.join(onbellekKok, String(bookId), kaynakAdi);
  fs.mkdirSync(hedefDizin, { recursive: true });
  fs.copyFileSync(SET_KITAP(), path.join(hedefDizin, 'build.zip'));

  const r = await isKostur({ onbellekKok, bookId, kaynakAdi });
  assert.deepEqual(r.istekler, ['/api/upload-build']);
  assert.match(r.hata.message, /packager upload-build failed: HTTP 500/);
});

// ---------------------------------------------------------------------------
// Kaynak konumu (2026-09-26): kapı, MERDİVEN'den ÖNCE ve MISS dalındaki dizin
// denetiminin AYRI/EK bir çağrı olduğunu doğrular — kaynak-pozisyon testi.
// ---------------------------------------------------------------------------

test("ZIP kapısı runner.js'te if(cacheHit) altında, İÇERİK MERDİVENİ'nden ÖNCE çağrılır", () => {
  const merdivenIdx = SRC.indexOf("// İÇERİK MERDİVENİ (S0 + S1)");
  const zipKapisiIdx = SRC.indexOf('icerikKapisiDenetleZip(zipPath');
  const dizinKapisiIdx = SRC.indexOf('icerikKapisiDenetle(buildDir');
  assert.ok(zipKapisiIdx > 0 && merdivenIdx > 0 && zipKapisiIdx < merdivenIdx,
    'zip kapısı merdivenden ÖNCE olmalı');
  assert.ok(dizinKapisiIdx > 0 && dizinKapisiIdx < zipKapisiIdx,
    'dizin kapısı (MISS dalı) ayrı ve zip kapısından önce kalmalı — kaldırılmamış olmalı');
});
