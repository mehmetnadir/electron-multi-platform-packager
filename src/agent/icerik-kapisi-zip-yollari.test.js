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
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

// TEST YALITIMI (2026-09-28, agent-test-borcu-20260928 — bkz. test-yalitim.js).
const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();

const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
const { CONFIG, processJob } = require('./runner.js');

YALITIM.configUygula(CONFIG);
after(() => YALITIM.temizle());
const {
  yolListesiTara, girisListesindenDegerlendir, zipGirisAdlariniOku, icerikKapisiDenetleZip,
  KAPI_ISARETI, OKUNAMADI_ISARETI, macosArtigiMi,
} = require('./icerik-kapisi');

/**
 * SEYREK (sparse) zip — >2 GiB'lık STORED girişi diskte yer kaplamadan (delik) kurar. Merkez dizin
 * gerçek; büyük girişin verisi sıfır (CRC 0 — `unzip -Z1` yalnız listeler, doğrulamaz). adm-zip bu
 * dosyada `ERR_FS_FILE_TOO_LARGE` fırlatır (inceleme 01.10, KRİTİK 1'in yeniden üretimi).
 */
function seyrekZip(girisler) {
  const yol = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-kapisi-seyrek-')), 'build.zip');
  const fd = fs.openSync(yol, 'w');
  let ofs = 0;
  const merkez = [];
  try {
    for (const g of girisler) {
      const ad = Buffer.from(g.ad, 'utf8');
      const boyut = g.veri ? g.veri.length : g.boyut;
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(10, 4); h.writeUInt16LE(0x800, 6);
      h.writeUInt32LE(boyut, 18); h.writeUInt32LE(boyut, 22); h.writeUInt16LE(ad.length, 26);
      fs.writeSync(fd, h, 0, 30, ofs); fs.writeSync(fd, ad, 0, ad.length, ofs + 30);
      if (g.veri) fs.writeSync(fd, g.veri, 0, g.veri.length, ofs + 30 + ad.length);
      merkez.push({ ad, boyut, ofs });
      ofs += 30 + ad.length + boyut;
    }
    const cdBas = ofs;
    for (const m of merkez) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(10, 6); c.writeUInt16LE(0x800, 8);
      c.writeUInt32LE(m.boyut, 20); c.writeUInt32LE(m.boyut, 24); c.writeUInt16LE(m.ad.length, 28);
      c.writeUInt32LE(m.ofs, 42);
      fs.writeSync(fd, c, 0, 46, ofs); fs.writeSync(fd, m.ad, 0, m.ad.length, ofs + 46);
      ofs += 46 + m.ad.length;
    }
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(merkez.length, 8); e.writeUInt16LE(merkez.length, 10);
    e.writeUInt32LE(ofs - cdBas, 12); e.writeUInt32LE(cdBas, 16);
    fs.writeSync(fd, e, 0, 22, ofs);
  } finally { fs.closeSync(fd); }
  return yol;
}
const IKI_GIB = 2 * 1024 * 1024 * 1024;

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

test('icerikKapisiDenetleZip: bozuk/olmayan zip AYRI sebeple düşer ([kaynak-okunamadi], içeriksiz DEĞİL; fırlatmaz)', async () => {
  const yok = path.join(os.tmpdir(), 'olmayan-' + Date.now() + '.zip');
  const sonuc = await icerikKapisiDenetleZip(yok, { kaynakAdi: 'x.zip' });
  assert.equal(sonuc.gecti, false);
  assert.ok(sonuc.sebep.startsWith(`${OKUNAMADI_ISARETI} zip giriş listesi okunamadı <x.zip>`), sonuc.sebep);
  assert.ok(!sonuc.sebep.includes(KAPI_ISARETI));
  const bozuk = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bozuk-zip-')), 'b.zip');
  fs.writeFileSync(bozuk, 'zip değil');
  assert.ok((await icerikKapisiDenetleZip(bozuk)).sebep.startsWith(OKUNAMADI_ISARETI));
});

test('icerikKapisiDenetleZip: listeleyici fırlatırsa okunamadı; boş/motor liste içeriksiz (iki teşhis ayrı)', async () => {
  const okunamadi = await icerikKapisiDenetleZip('/yok.zip', { listele: () => { throw new Error('unzip -Z1 rc=9'); } });
  assert.match(okunamadi.sebep, /^\[kaynak-okunamadi\] .*unzip -Z1 rc=9/);
  const iceriksiz = await icerikKapisiDenetleZip('/yok.zip', { listele: () => ['index.html', 'core/a.js'] });
  assert.ok(iceriksiz.sebep.startsWith(KAPI_ISARETI));
  assert.equal((await icerikKapisiDenetleZip('/yok.zip', { listele: () => ['assets/1/a.jpg'] })).gecti, true);
});

test('GERİLEME (KRİTİK 1): 2 GiB üstü (seyrek) zip — giriş listesi okunur, içerikli kaynak GEÇER', async () => {
  const yol = seyrekZip([
    { ad: 'index.html', veri: Buffer.from('<html></html>') },
    { ad: 'assets/45482/pages/buyuk.bin', boyut: IKI_GIB + 64 * 1024 * 1024 },
    { ad: 'assets/45482/thumbs/1.jpg', veri: Buffer.from('jpg') },
  ]);
  try {
    assert.ok(fs.statSync(yol).size > IKI_GIB, 'fikstür 2 GiB üstü olmalı');
    assert.throws(() => new AdmZip(yol), /ERR_FS_FILE_TOO_LARGE|greater than 2 GiB|too large/i,
      'adm-zip bu dosyayı okuyamaz (eski arızanın kendisi)');
    assert.deepEqual(zipGirisAdlariniOku(yol),
      ['index.html', 'assets/45482/pages/buyuk.bin', 'assets/45482/thumbs/1.jpg']);
    const sonuc = await icerikKapisiDenetleZip(yol, { kaynakAdi: 'arsiv:test' });
    assert.deepEqual(sonuc, { gecti: true, sebep: null });
  } finally { fs.rmSync(path.dirname(yol), { recursive: true, force: true }); }
});

// FINDER ZIP'İ (01.10): __MACOSX/ ve ._* girişleri içerik değildir — sarmalayıcı/kök kararına girmez.
test('macosArtigiMi: __MACOSX/, ._dosya ve .DS_Store artık; normal yollar değil', () => {
  for (const y of ['__MACOSX/', '__MACOSX/build/._index.html', 'build/._index.html', '._x', 'a/.DS_Store']) {
    assert.equal(macosArtigiMi(y), true, y);
  }
  for (const y of ['index.html', 'assets/1/a._b.jpg', 'book1/x.js', '__MACOSXfoo/a']) assert.equal(macosArtigiMi(y), false, y);
});

test('girisListesindenDegerlendir: Finder ile sıkıştırılmış sarmalayıcı + __MACOSX → GEÇER', () => {
  const r = girisListesindenDegerlendir(['build/', 'build/index.html', 'build/assets/45482/thumbs/1.jpg',
    '__MACOSX/', '__MACOSX/build/', '__MACOSX/build/._index.html']);
  assert.deepEqual(r, { gecti: true, sebep: null });
});

test('girisListesindenDegerlendir: yalnız __MACOSX altında içerik "varmış gibi" görünen motor-only zip → RED', () => {
  const r = girisListesindenDegerlendir(['index.html', 'core/a.js', '__MACOSX/assets/._1.jpg', '__MACOSX/book1/._x']);
  assert.equal(r.gecti, false);
  assert.ok(r.sebep.startsWith(KAPI_ISARETI));
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
// Runner düzeyinde — gerçek processJob, arşiv VE manuel build yolları (2026-09-26; exe'siz
// sözleşme 01.10: exe-türevi kaynak önbelleği HIT yolu kaldırıldı, yerine manuel build.zip)
// ---------------------------------------------------------------------------

/** Köprü presigned URL'si — next-job'un Mac ajanına verdiği biçim. */
function kopruUrl(bookId, ad) {
  return `https://acc.r2.cloudflarestorage.com/akillitahtalar/${bookId}/${ad}`
    + `?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Sahte paketleyici + API + manuel build sunucusu: /api/* ve /agents/* isteklerini sayar, 500 döner
 * (iş hızlıca düşsün); `dosyalar`daki yollar (manuel build.zip) 200 ile servis edilir.
 */
async function sahtePaketleyici(dosyalar = {}) {
  const istekler = [];
  const sunucu = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const yol = req.url.split('?')[0];
      if (dosyalar[yol]) { res.writeHead(200); return res.end(fs.readFileSync(dosyalar[yol])); }
      istekler.push(req.url);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end('{}');
    });
  });
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${sunucu.address().port}`;
  return { istekler, url, kapat: () => sunucu.close() };
}

/** Arşiv kökü + gerçek zip buffer'lı kitap kaydı kurar (impark_kaynagi yalnız bilgi; verilmez). */
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
async function isKostur({ arsivKok, onbellekKok, bookId, kaynakAdi, manuelZip }) {
  const manuelYol = `/sources/${bookId}/20261001-120000-build.zip`;
  const paketleyici = await sahtePaketleyici(manuelZip ? { [manuelYol]: manuelZip } : {});
  const eski = {
    arsiv: process.env.EMPP_KAYNAK_ARSIVI,
    cache: process.env.EMPP_SOURCE_CACHE,
    packagerApi: CONFIG.packagerApi,
    apiBase: CONFIG.apiBase,
  };
  const loglar = [];
  const orjLog = console.log;
  const orjWarn = console.warn;
  process.env.EMPP_KAYNAK_ARSIVI = arsivKok || fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-kapisi-zip-bos-arsiv-'));
  process.env.EMPP_SOURCE_CACHE = onbellekKok || fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-kapisi-zip-cache-'));
  CONFIG.packagerApi = paketleyici.url;
  CONFIG.apiBase = paketleyici.url; // kaynak yoksa /release yerel sahteye gider (canlıya ASLA)
  console.log = (...a) => loglar.push(a.join(' '));
  console.warn = (...a) => loglar.push(a.join(' '));
  let hata = null;
  try {
    await processJob({ agentId: 'test', token: 'x' }, {
      bookId: String(bookId), platform: 'android',
      downloadUrl: manuelZip ? `${paketleyici.url}${manuelYol}?X-Amz-Signature=abc` : kopruUrl(bookId, kaynakAdi),
      bookTitle: 'Test Kitap', publisherName: 'YDS Publishing',
    });
  } catch (e) {
    hata = e;
  } finally {
    console.log = orjLog;
    console.warn = orjWarn;
    CONFIG.packagerApi = eski.packagerApi;
    CONFIG.apiBase = eski.apiBase;
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

test('GERİLEME: manuel build yolunda içeriksiz zip [kaynak-iceriksiz] ile düşer, paketleyiciye gidilmez', async () => {
  const r = await isKostur({ bookId: 45550, manuelZip: MOTOR_ONLY() });
  assert.ok(r.hata, 'iş düşmeliydi');
  assert.match(r.hata.message, /^\[kaynak-iceriksiz\]/, r.hata.message);
  assert.deepEqual(r.istekler, [], 'içeriksiz manuel zip paketleyiciye HİÇ gitmemeli');
  assert.match(r.loglar, /kaynak MANUEL build\.zip/, 'manuel yol kullanıldığı loglanmalı');
});

test('manuel build yolunda İÇERİKLİ (SET) zip kapıdan GEÇER', async () => {
  const r = await isKostur({ bookId: 45538, manuelZip: SET_KITAP() });
  assert.deepEqual(r.istekler, ['/api/upload-build']);
  assert.match(r.hata.message, /packager upload-build failed: HTTP 500/);
});

test('EXE\'SİZ: exe-türevi kaynak önbelleği (EMPP_SOURCE_CACHE) artık OKUNMAZ — kaynak yok, kira bırakılır', async () => {
  const onbellekKok = fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-kapisi-zip-cache-hit-ok-'));
  const bookId = 45538;
  const kaynakAdi = 'EnglishUp5-24-v45.exe';
  const hedefDizin = path.join(onbellekKok, String(bookId), kaynakAdi);
  fs.mkdirSync(hedefDizin, { recursive: true });
  fs.copyFileSync(SET_KITAP(), path.join(hedefDizin, 'build.zip'));

  const r = await isKostur({ onbellekKok, bookId, kaynakAdi });
  assert.equal(r.hata, null, r.hata && r.hata.stack);
  assert.doesNotMatch(r.loglar, /source cache HIT/);
  assert.deepEqual(r.istekler, ['/agents/test/release'], 'yalnız kira bırakma; paketleyiciye gidilmez');
  assert.match(r.loglar, /\[kaynak-yok\] 45538 android/);
});

// ---------------------------------------------------------------------------
// Kaynak konumu (2026-09-26): kapı, MERDİVEN'den ÖNCE ve MISS dalındaki dizin
// denetiminin AYRI/EK bir çağrı olduğunu doğrular — kaynak-pozisyon testi.
// ---------------------------------------------------------------------------

test("ZIP kapısı runner.js'te HER kaynakta (arşiv + manuel) koşulsuz, İÇERİK MERDİVENİ'nden ÖNCE çağrılır", () => {
  const merdivenIdx = SRC.indexOf("// İÇERİK MERDİVENİ (S0 + S1)");
  const zipKapisiIdx = SRC.indexOf('const icerikZipSonuc = await icerikKapisiDenetleZip(zipPath');
  const arsivIdx = SRC.indexOf('await fsp.copyFile(arsiv.zip, zipPath');
  const manuelIdx = SRC.indexOf('await manuelBuildHazirla({');
  assert.ok(zipKapisiIdx > 0 && merdivenIdx > 0 && zipKapisiIdx < merdivenIdx,
    'zip kapısı merdivenden ÖNCE olmalı');
  assert.ok(arsivIdx > 0 && manuelIdx > 0 && arsivIdx < zipKapisiIdx && manuelIdx < zipKapisiIdx,
    'zip kapısı iki kaynak hazırlığından da SONRA olmalı');
  const onceki = SRC.slice(SRC.lastIndexOf('\n', zipKapisiIdx - 1), zipKapisiIdx);
  assert.match(onceki, /^\n {4}$/, 'kapı bir if bloğunun içinde olmamalı (koşulsuz)');
});
