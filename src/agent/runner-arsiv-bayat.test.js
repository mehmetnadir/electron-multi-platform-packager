'use strict';

/**
 * Runner × kaynak arşivi — BAYAT ARŞİV KAPISI (2026-09-26).
 *
 * Nadir'in şartı: "İmpark'ta bir kitaba güncelleme atınca sistem otomatik o kitabın
 * paketlerini güncellemeli." srv21 `publisher-version-refresh.ts` İmpark sürümü artınca
 * kitabı yeniden kuyruğa alır. Arşivli sette runner bu işi ESKİ zip'ten üretirse güncelleme
 * sessizce kaybolur. Kapı: kaynak.json `impark_kaynagi` ≠ işin güncel İmpark kimliği
 * (`srcVersionTuret(job.downloadUrl)`) → iş görünür hatayla düşer, paketleyiciye gidilmez.
 *
 * Testler gerçek `processJob`'u koşturur. Paketleyici (3001) yerine yerel sahte bir HTTP
 * sunucusu kullanılır; canlı paketleyiciye asla istek gitmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
const { CONFIG, processJob } = require('./runner.js');
const { arsivKaynagi } = require('./kaynak-arsivi');
const {
  ertelenebilirKaynakHatasi, isTransientNetworkError, srcVersionTuret,
} = require('./runner-helpers');

const AYRAC = '// ---------------------------------------------------------------------------\n';
const PROCESS_JOB = SRC.slice(
  SRC.indexOf('async function processJob'),
  SRC.indexOf(`${AYRAC}// Main loops`),
);

/** Köprü presigned URL'si — next-job'un Mac ajanına verdiği biçim. */
function kopruUrl(bookId, ad) {
  return `https://acc.r2.cloudflarestorage.com/akillitahtalar/${bookId}/${ad}`
    + `?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=${crypto.randomBytes(8).toString('hex')}`;
}

/** Arşiv kökü + tek kitap kaydı kurar. */
function arsivKur(bookId, kayitEk = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'arsiv-bayat-'));
  const dizin = path.join(kok, String(bookId));
  fs.mkdirSync(dizin);
  const icerik = 'arsiv-build-zip';
  fs.writeFileSync(path.join(dizin, 'build.zip'), icerik);
  const md5 = crypto.createHash('md5').update(icerik).digest('hex');
  fs.writeFileSync(path.join(dizin, 'kaynak.json'), JSON.stringify({
    dosya: 'build.zip', md5, boyut: Buffer.byteLength(icerik), etiket: 'test', ...kayitEk,
  }));
  return { kok, dizin };
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

/** processJob'u yalıtılmış ortamda koşturur; console çıktısını ve paketleyici isteklerini döner. */
async function isKostur({ kok, bookId, kaynakAdi }) {
  const paketleyici = await sahtePaketleyici();
  const eski = {
    arsiv: process.env.EMPP_KAYNAK_ARSIVI,
    cache: process.env.EMPP_SOURCE_CACHE,
    packagerApi: CONFIG.packagerApi,
  };
  const loglar = [];
  const orjLog = console.log;
  const orjWarn = console.warn;
  process.env.EMPP_KAYNAK_ARSIVI = kok;
  process.env.EMPP_SOURCE_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'arsiv-bayat-cache-'));
  CONFIG.packagerApi = paketleyici.url;
  console.log = (...a) => loglar.push(a.join(' '));
  console.warn = (...a) => loglar.push(a.join(' '));
  let hata = null;
  try {
    await processJob({ agentId: 'test', token: 'x' }, {
      bookId: String(bookId), platform: 'android', downloadUrl: kopruUrl(bookId, kaynakAdi),
      bookTitle: 'Test Set', publisherName: 'YDS Publishing',
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

// ---------------------------------------------------------------------------
// Davranış — gerçek processJob
// ---------------------------------------------------------------------------

test('processJob: İmpark kaynağı değiştiyse BAYAT hatası, paketleyiciye HİÇ gidilmez', async () => {
  const { kok } = arsivKur(45482, { impark_kaynagi: 'ShallWe8-v47.exe' });
  const r = await isKostur({ kok, bookId: 45482, kaynakAdi: 'ShallWe8-v48.exe' });
  assert.ok(r.hata, 'iş düşmeliydi');
  assert.ok(r.hata.message.startsWith('kaynak arşivi BAYAT: İmpark kaynağı ShallWe8-v47.exe → '
    + 'ShallWe8-v48.exe; build zip yeniden üretilmeli'), r.hata.message);
  assert.deepEqual(r.istekler, [], 'bayat arşivden paket üretilmemeli');
  assert.doesNotMatch(r.loglar, /kaynak ARŞİVDEN/);
  assert.doesNotMatch(r.loglar, /downloading source exe/, 'İmpark exe\'sine sessizce düşülmemeli');
});

test('processJob: İmpark kaynağı aynıysa arşiv kullanılır, exe indirilmez', async () => {
  const { kok } = arsivKur(45482, { impark_kaynagi: 'ShallWe8-v47.exe' });
  const r = await isKostur({ kok, bookId: 45482, kaynakAdi: 'ShallWe8-v47.exe' });
  assert.match(r.loglar, /kaynak ARŞİVDEN/);
  assert.doesNotMatch(r.loglar, /downloading source exe/);
  assert.deepEqual(r.istekler, ['/api/upload-build'], 'arşiv zip\'i paketleyiciye gitmeli');
  assert.match(r.hata.message, /packager upload-build failed: HTTP 500/, 'sahte paketleyici 500');
});

test('processJob: kayıtta alan yoksa bugünkü davranış + tek uyarı', async () => {
  const { kok } = arsivKur(45483);
  const r = await isKostur({ kok, bookId: 45483, kaynakAdi: 'ShallWe9-v10.exe' });
  assert.match(r.loglar, /45483 kaydında impark_kaynagi yok/);
  assert.match(r.loglar, /kaynak ARŞİVDEN/);
  assert.deepEqual(r.istekler, ['/api/upload-build']);
  const r2 = await isKostur({ kok, bookId: 45483, kaynakAdi: 'ShallWe9-v10.exe' });
  assert.doesNotMatch(r2.loglar, /impark_kaynagi yok/, 'uyarı süreçte bir kez');
});

// ---------------------------------------------------------------------------
// Hata yolu — BAYAT hatası 'failed' + bildirim yoluna gider, ertelenmez
// ---------------------------------------------------------------------------

test('BAYAT hatası ertelenebilir ya da geçici SAYILMAZ (sessiz kira dönüşü yok)', async () => {
  const { kok } = arsivKur(45482, { impark_kaynagi: 'ShallWe8-v47.exe' });
  let hata = null;
  try {
    await arsivKaynagi(45482, { kok, imparkKaynagi: 'ShallWe8-v48.exe', uyar: () => {} });
  } catch (e) { hata = e; }
  assert.ok(hata);
  assert.equal(ertelenebilirKaynakHatasi(hata), false);
  assert.equal(isTransientNetworkError(hata), false);
});

test('ana döngü: düşen iş önce bildirim, sonra failed sonucu yazar', () => {
  const dongu = SRC.slice(SRC.indexOf('await processJob(auth, job);'));
  const bildirim = dongu.indexOf('bildirGonder({ basarili: false');
  const sonuc = dongu.indexOf('await postResultFailure(auth, job, e.message);');
  assert.ok(bildirim > 0 && sonuc > bildirim, 'catch yolu: bildirGonder → postResultFailure');
});

test('bildirGonder: başarısızlık `bildir paket … -p yuksek -e warning` üretir', () => {
  const fn = SRC.slice(
    SRC.indexOf('function bildirGonder'), SRC.indexOf('const AKTIVASYON_SERILERI'));
  assert.match(fn, /\['paket', govde,/);
  assert.match(fn, /'-p', basarili \? 'normal' : 'yuksek'/);
  assert.match(fn, /'-e', basarili \? 'white_check_mark' : 'warning'/);
});

// ---------------------------------------------------------------------------
// Kaynak metni — kıyas her iş için ve her şeyden önce yapılır
// ---------------------------------------------------------------------------

test('processJob: güncel İmpark kimliği = srcVersionTuret(job.downloadUrl), kıyasa verilir', () => {
  assert.match(PROCESS_JOB, /const imparkSrcVersion = srcVersionTuret\(job\.downloadUrl\);/);
  assert.match(PROCESS_JOB,
    new RegExp('const arsiv = await arsivKaynagi\\(job\\.bookId, '
      + '\\{ imparkKaynagi: imparkSrcVersion, uyar: warn \\}\\);'));
  assert.match(PROCESS_JOB, /const srcVersion = arsiv \? arsiv\.srcVersion : imparkSrcVersion;/);
});

test('processJob: arşiv kıyası indirme/devir/kopyalamadan ÖNCE', () => {
  const kiyas = PROCESS_JOB.indexOf('await arsivKaynagi(');
  assert.ok(kiyas > 0);
  const sonrakiler = ['hazirPardusPaketi(', 'kaynakBoyutuTahmin(', 'fsp.copyFile(arsiv.zip',
    'downloadFile('];
  for (const sonra of sonrakiler) {
    const i = PROCESS_JOB.indexOf(sonra);
    assert.ok(i > kiyas, `${sonra} arşiv kıyasından sonra gelmeli`);
  }
});

test('kimlik runner önbelleğiyle aynı: presigned imza kimliği değiştirmez', () => {
  assert.equal(srcVersionTuret(kopruUrl(45482, 'ShallWe8-v47.exe')), 'ShallWe8-v47.exe');
  assert.equal(srcVersionTuret(kopruUrl(45482, 'ShallWe8-v47.exe')),
    srcVersionTuret(kopruUrl(45482, 'ShallWe8-v47.exe')));
});
