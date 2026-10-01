'use strict';

/**
 * Runner × kaynak arşivi — İMPARK EXE ADI YALNIZ BİLGİ (Nadir 27.09).
 *
 * 26.09'daki "bayat arşiv kapısı" kaynak.json `impark_kaynagi` ≠ işin exe adı
 * (`srcVersionTuret(job.downloadUrl)`) olunca işi düşürüyordu. Nadir 27.09: "v47 → v51 gibi isim
 * güncellemesi metodu çok kırılgan (insanlar unutabiliyor), kullanmak istemiyorum." Ad İmpark
 * `S_TestKitaplar.Adi` alanından gelir (elle yazılır, aktivasyon/lisans değişikliğinde de artar);
 * 45482 android bu kapıda düştü, oysa içerik merdiveni aynı işte alt kitapları zaten güncelliyordu.
 * Artık: ad farkı tek BİLGİ satırıdır, iş SÜRER; güncellik içerik merdiveni S0/S1 ve kabul
 * K4/SET_TUM'dan ölçülür. Merdiven KAPALIYKEN de ad kıyası yoktur (gerekçe kaynak-arsivi.js).
 *
 * Testler gerçek `processJob`'u koşturur. Paketleyici (3001) yerine yerel sahte bir HTTP
 * sunucusu kullanılır; canlı paketleyiciye asla istek gitmez.
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
const { srcVersionTuret } = require('./runner-helpers');

YALITIM.configUygula(CONFIG);
after(() => YALITIM.temizle());

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

/**
 * Arşiv kökü + tek kitap kaydı kurar. build.zip GERÇEK bir zip'tir (assets/ içerir) —
 * 2026-09-26 içeriksiz-kaynak-kapısı (ZIP yolu) bu içeriği okuyup GEÇER demek zorunda;
 * düz bir metin dosyası artık (haklı olarak) [kaynak-iceriksiz] ile RED verir.
 */
function arsivKur(bookId, kayitEk = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'arsiv-ad-bilgi-'));
  const dizin = path.join(kok, String(bookId));
  fs.mkdirSync(dizin);
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from('<html></html>'));
  zip.addFile(`assets/${bookId}/thumbs/1.jpg`, Buffer.from('arsiv-build-zip'));
  const icerik = zip.toBuffer();
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
async function isKostur({ kok, bookId, kaynakAdi, merdiven = '0' }) {
  const paketleyici = await sahtePaketleyici();
  const eski = {
    arsiv: process.env.EMPP_KAYNAK_ARSIVI,
    cache: process.env.EMPP_SOURCE_CACHE,
    merdiven: process.env.EMPP_ARSIV_MERDIVEN,
    packagerApi: CONFIG.packagerApi,
  };
  const loglar = [];
  const orjLog = console.log;
  const orjWarn = console.warn;
  process.env.EMPP_KAYNAK_ARSIVI = kok;
  process.env.EMPP_SOURCE_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'arsiv-ad-bilgi-cache-'));
  process.env.EMPP_ARSIV_MERDIVEN = merdiven;
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
    for (const [k, v] of [['EMPP_KAYNAK_ARSIVI', eski.arsiv], ['EMPP_SOURCE_CACHE', eski.cache],
      ['EMPP_ARSIV_MERDIVEN', eski.merdiven]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    paketleyici.kapat();
  }
  return { hata, loglar: loglar.join('\n'), istekler: paketleyici.istekler };
}

// ---------------------------------------------------------------------------
// Davranış — gerçek processJob (merdiven KAPALI: ad kıyası yine yok, arşiv olduğu gibi gider)
// ---------------------------------------------------------------------------

const AD_NOTU = 'kaynak arşivi 45482: İmpark exe adı değişti (bilgi) — ShallWe8-v47.exe → '
  + 'ShallWe8-v51.exe; güncellik içerik merdiveninden ölçülür';

test('processJob: exe adı değişti (v47 → v51) — iş DÜŞMEZ, bilgi satırı + arşiv paketleyiciye gider', async () => {
  const { kok } = arsivKur(45482, { impark_kaynagi: 'ShallWe8-v47.exe' });
  const r = await isKostur({ kok, bookId: 45482, kaynakAdi: 'ShallWe8-v51.exe' });
  assert.ok(r.loglar.includes(AD_NOTU), r.loglar);
  assert.match(r.loglar, /kaynak ARŞİVDEN/);
  assert.doesNotMatch(r.loglar, /downloading source exe/, 'İmpark exe\'si indirilmemeli');
  assert.deepEqual(r.istekler, ['/api/upload-build'], 'arşiv zip\'i paketleyiciye gitmeli');
  assert.match(r.hata.message, /packager upload-build failed: HTTP 500/, 'yalnız sahte paketleyici 500');
  assert.doesNotMatch(r.hata.message, /BAYAT|yeniden üretilmeli/);
});

test('processJob: exe adı aynıysa bilgi satırı yok, arşiv kullanılır', async () => {
  const { kok } = arsivKur(45482, { impark_kaynagi: 'ShallWe8-v47.exe' });
  const r = await isKostur({ kok, bookId: 45482, kaynakAdi: 'ShallWe8-v47.exe' });
  assert.match(r.loglar, /kaynak ARŞİVDEN/);
  assert.doesNotMatch(r.loglar, /exe adı değişti/);
  assert.deepEqual(r.istekler, ['/api/upload-build']);
});

test('processJob: kayıtta alan yoksa uyarı/not yok, arşiv kullanılır', async () => {
  const { kok } = arsivKur(45483);
  const r = await isKostur({ kok, bookId: 45483, kaynakAdi: 'ShallWe9-v10.exe' });
  assert.doesNotMatch(r.loglar, /impark_kaynagi|exe adı değişti|ALGILANAMAZ/);
  assert.match(r.loglar, /kaynak ARŞİVDEN/);
  assert.deepEqual(r.istekler, ['/api/upload-build']);
});

// ---------------------------------------------------------------------------
// Hata yolu — düşen iş (içerik güncelliği: kabul "güncel değil", merdiven "ÖLÇÜLEMEDİ" dahil)
// önce bildirim, sonra `failed`. 26.09 BAYAT testlerinden devralındı; kapıdan bağımsız pin.
// ---------------------------------------------------------------------------

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
// Kaynak metni — exe adı yalnız bilgi için arşive verilir; kaynak seçimi değişmedi
// ---------------------------------------------------------------------------

test('processJob: exe kimliği = srcVersionTuret(job.downloadUrl), arşive YALNIZ bilgi için verilir', () => {
  // Exe'siz sözleşme (01.10): downloadUrl'süz işte kimlik boş (bilgi notu yok); srcVersion exe
  // adından DEĞİL kaynağın kendisinden (arşiv md5 / manuel adres) türer.
  assert.match(PROCESS_JOB, /const imparkSrcVersion = job\.downloadUrl \? srcVersionTuret\(job\.downloadUrl\) : '';/);
  assert.match(PROCESS_JOB,
    new RegExp(': await arsivKaynagi\\(job\\.bookId, '
      + '\\{ imparkKaynagi: imparkSrcVersion, bilgi: log \\}\\);'));
  assert.match(PROCESS_JOB,
    /const srcVersion = kaynak\.tur === 'arsiv' \? arsiv\.srcVersion : `manuel-\$\{srcVersionTuret\(kaynak\.url\)\}`;/);
  assert.equal((PROCESS_JOB.match(/imparkSrcVersion/g) || []).length, 2, 'exe kimliği başka yerde kullanılmamalı');
});

test('processJob: arşiv okuması indirme/devir/kopyalamadan ÖNCE', () => {
  const okuma = PROCESS_JOB.indexOf('await arsivKaynagi(');
  assert.ok(okuma > 0);
  const sonrakiler = ['kaynakKarari(', 'kaynakBoyutuTahmin(', 'fsp.copyFile(arsiv.zip',
    'manuelBuildHazirla('];
  for (const sonra of sonrakiler) {
    const i = PROCESS_JOB.indexOf(sonra);
    assert.ok(i > okuma, `${sonra} arşiv okumasından sonra gelmeli`);
  }
});

test('kimlik runner önbelleğiyle aynı: presigned imza kimliği değiştirmez', () => {
  assert.equal(srcVersionTuret(kopruUrl(45482, 'ShallWe8-v47.exe')), 'ShallWe8-v47.exe');
  assert.equal(srcVersionTuret(kopruUrl(45482, 'ShallWe8-v47.exe')),
    srcVersionTuret(kopruUrl(45482, 'ShallWe8-v47.exe')));
});
