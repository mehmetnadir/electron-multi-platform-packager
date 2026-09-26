'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Source sentinels for the runner's result-upload flow. The end-to-end path does
 * network + R2 IO (covered by manual e2e), so here we guard that the artifact is
 * delivered via the presigned R2 PUT (Cloudflare-bypass), NOT the old multipart
 * /result upload that 413'd on large (2GB+) APKs.
 */
const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');

test('postResultSuccess presigns then PUTs the artifact straight to R2 (throttled curl)', () => {
  // 1. asks the server for a presigned URL (re-presigned each attempt for reset-retry)
  assert.match(SRC, /agents\/\$\{auth\.agentId\}\/result\/presign/);
  // 2. uploads via curl --upload-file (NOT axios): the gateway resets a big axios PUT
  //    (ECONNRESET); a throttled curl PUT slips under the shaper and retries on reset.
  const fn = SRC.slice(SRC.indexOf('async function postResultSuccess'), SRC.indexOf('async function postResultFailure'));
  assert.match(fn, /run\('curl'/);
  assert.match(fn, /'--upload-file',\s*artifactPath/);      // sets Content-Length; PUT
  assert.match(fn, /'-X',\s*'PUT'/);
  assert.match(fn, /Content-Type: \$\{presigned\.contentType/); // signed header, verbatim
  assert.match(fn, /AGENT_UPLOAD_RATE/);                    // throttle under the reset
  assert.match(fn, /--limit-rate/);
  assert.doesNotMatch(fn, /axios\.put/);                    // axios PUT got ECONNRESET
  // `presigned` MUST be hoisted (let) above the retry loop — the result POST settles
  // the job from presigned.r2ObjectKey/publicUrl; declaring it `const` inside the loop
  // threw "presigned is not defined" AFTER a successful upload.
  assert.match(fn, /let presigned = null;/);
  assert.match(fn, /r2ObjectKey:\s*presigned\.r2ObjectKey/);
});

test('result is settled via JSON body with the returned key/url (Decision A)', () => {
  assert.match(SRC, /status:\s*['"]completed['"]/);
  assert.match(SRC, /r2ObjectKey:\s*presigned\.r2ObjectKey/);
  assert.match(SRC, /publicUrl:\s*presigned\.publicUrl/);
});

test('downloadFile: throttled fresh-fetch + archive-validity retry (inconsistent origin)', () => {
  assert.match(SRC, /run\('curl'/);
  assert.doesNotMatch(SRC, /'-C',\s*'-'/);        // NO resume: append-on-reset oversized the file
  assert.match(SRC, /--retry-all-errors/);
  assert.match(SRC, /--limit-rate/);              // throttle under the gateway reset
  // integrity: retry the WHOLE fetch until a VALID (listable) archive lands
  assert.match(SRC, /run\('7z',\s*\['l'/);
  assert.match(SRC, /Missing volume/);
  assert.match(SRC, /NOT a valid archive/);
});

// MUTASYON KAPANI (2026-09-15, ölçülmüş arıza): Mac uyuyup uyanınca TCP akışı ölür
// ama bağlantı KOPMAZ — curl sonsuza kadar bekler. 45485'in indirmesi 19.210.240
// baytta çakıldı, 40 dk tek bayt gelmedi, ajan kirayı uzatıp partiyi durdurdu.
// `--retry*` bunu yakalamaz: yeniden deneme için isteğin BİTMESİ gerekir.
test('downloadFile: durgun transfer kesilir (uyku sonrası sonsuz asılma kapanı)', () => {
  const fn = SRC.slice(SRC.indexOf('async function downloadFile'), SRC.indexOf('async function downloadArtifact'));
  assert.match(fn, /'--speed-limit',\s*'1024'/);
  assert.match(fn, /'--speed-time',\s*'120'/);
  // Eşik evdeki throttle'ın (4M) çok altında olmalı, yoksa yavaş hatta yanlış kesme yapar.
  const esik = Number((fn.match(/'--speed-limit',\s*'(\d+)'/) || [])[1]);
  assert.ok(esik > 0 && esik <= 64 * 1024, `eşik makul değil: ${esik}`);
  // `-C -` geri gelirse durgunluk kesmesi bozuk devam indirmesi üretir (eski yasağın sebebi).
  assert.doesNotMatch(fn, /'-C',\s*'-'/);
});

test('downloadArtifact (LOCAL packager): no throttle, no 7z gate, ZIP64-safe unzip check', () => {
  // The built APK is a multi-GB ZIP64 archive with an APK Signing Block that p7zip's
  // `7z l` mis-parses as invalid — a false negative that looped the download forever.
  // Isolate the local-artifact fetch and assert it does NOT reuse the WAN hardening.
  const fn = SRC.slice(SRC.indexOf('async function downloadArtifact'), SRC.indexOf('async function packagerDownload'));
  assert.match(fn, /run\('curl'/);
  assert.doesNotMatch(fn, /--limit-rate/);        // localhost: no gateway shaper to dodge
  assert.doesNotMatch(fn, /run\('7z'/);           // 7z false-rejects large signed zip64 apks
  assert.match(fn, /\\\.\(apk\|zip\)\$/);          // zip-family only
  assert.match(fn, /run\('unzip',\s*\['-l'/);      // ZIP64-aware validity
  // packagerDownload delegates to the local-artifact path, not downloadFile
  assert.match(SRC, /async function packagerDownload[\s\S]*?downloadArtifact\(/);
});

test('heartbeat reports the in-flight job so the server extends its lease', () => {
  // Without this, a build slower than LEASE_MINUTES loses the lease mid-build.
  assert.match(SRC, /heldJobs:\s*currentJob\s*\?\s*\[currentJob\]\s*:\s*\[\]/);
  assert.match(SRC, /currentJob\s*=\s*\{\s*bookId:\s*job\.bookId,\s*platform:\s*job\.platform\s*\}/);
  assert.match(SRC, /currentJob\s*=\s*null/); // cleared when idle
});

test('source cache: reuse build.zip per (book, version) instead of re-downloading', () => {
  // shared cache root (overridable), keyed by bookId + source filename
  assert.match(SRC, /EMPP_SOURCE_CACHE/);
  assert.match(SRC, /cachedZip/);
  // cache HIT path copies the cached build.zip and SKIPS the download
  assert.match(SRC, /source cache HIT/);
  assert.match(SRC, /cacheHit\s*=\s*true/);
  // download only happens on MISS
  assert.match(SRC, /if\s*\(!cacheHit\)/);
  // populated atomically (tmp + rename)
  assert.match(SRC, /\.rename\(tmp,\s*cachedZip\)/);
});

test('looksLikeRealApk rejects the 45695 fake (web zip named .apk)', () => {
  const { looksLikeRealApk } = require('./runner.js');
  const fake = [
    '  1523  1981-01-01 01:01   webapp/index.html',
    '  9912  1981-01-01 01:01   webapp/js/app.js',
  ].join('\n');
  const verdict = looksLikeRealApk(fake);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.missing, ['AndroidManifest.xml', 'classes.dex']);
});

test('looksLikeRealApk accepts a Gradle-built APK listing', () => {
  const { looksLikeRealApk } = require('./runner.js');
  const real = [
    '  8192284  1981-01-01 01:01   classes.dex',
    '   198080  1981-01-01 01:01   classes2.dex',
    '     6048  1981-01-01 01:01   AndroidManifest.xml',
  ].join('\n');
  assert.equal(looksLikeRealApk(real).ok, true);
});

test('big artifacts go multipart; a stale single PUT never runs after it succeeds', () => {
  const fn = require('fs').readFileSync(require('path').join(__dirname, 'runner.js'), 'utf8');
  // 1.9GB tek parça PUT ~17 dk sürüp gateway resetiyle BAŞTAN başlıyordu (curl 56).
  assert.match(fn, /presign-multipart/);
  assert.match(fn, /complete-multipart/);
  assert.match(fn, /MULTIPART_THRESHOLD/);
  // Çok parçalı başarılıysa tek-parça döngüsü HİÇ çalışmamalı.
  assert.match(fn, /presigned === null && attempt <= MAX/);
});

test('isValidArchiveOutput: SAĞLAM SFX kabul edilir — çıkış kodu ayırt edici değil', () => {
  const { isValidArchiveOutput } = require('./runner.js');
  // Saha kanıtı (2026-08-05): bilinen sağlam 1.52GB SFX'te `7z l` kod 2 +
  // "WARNING = Checksum error", `unrar l` kod 3 veriyor. Kod'a bakan kapı
  // HİÇBİR kitabı geçirmedi; içindeki "error" adlı dosyalar da reddettiriyordu.
  const saglam = [
    '    ..A....    173876  2025-10-20 00:15  resources/app/build/book4/assets/errors.js',
    '    ..A....    482032  2025-10-20 00:15  resources/app/build/book4/assets/XMLDOMErrorHandler.js',
    'Corrupt header is found',
  ].join('\n');
  assert.equal(isValidArchiveOutput(3, saglam, ''), true);
  assert.equal(isValidArchiveOutput(2, saglam, ''), true);
});

test('isValidArchiveOutput: KESİK indirme reddedilir (asıl arıza biçimimiz)', () => {
  const { isValidArchiveOutput } = require('./runner.js');
  const kesik = [
    '    ..A....    117570  2025-11-03 13:48  resources/app/build/book5/assets/y.png',
    'Unexpected end of archive',
  ].join('\n');
  assert.equal(isValidArchiveOutput(1, kesik, ''), false);
  assert.equal(isValidArchiveOutput(0, 'Can not open the file as archive', ''), false);
  assert.equal(isValidArchiveOutput(0, 'UNRAR 6.11 beta 1 freeware\n', ''), false);  // boş liste
});

// ---------------------------------------------------------------------------
// 2026-08-18: packager output birikmesi + cache TTL işareti
// ---------------------------------------------------------------------------

const http = require('node:http');
const os = require('node:os');
const fsp = require('node:fs/promises');
const { packagerReleaseJob, touchCacheEntry, CONFIG } = require('./runner.js');

/** Test süresince packager API'sini yerel bir sunucuya yönlendirir. */
async function withFakePackager(handler, fn) {
  const server = http.createServer(handler);
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const prev = CONFIG.packagerApi;
  CONFIG.packagerApi = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn();
  } finally {
    CONFIG.packagerApi = prev;
    await new Promise(res => server.close(res));
  }
}

test('R2 yüklemesi bittikten sonra packager output BIRAKILIR (118 GB birikmesinin fix i)', () => {
  // Sentinel: postResultSuccess'ten hemen sonra release çağrısı olmalı.
  const fn = SRC.slice(SRC.indexOf('await postResultSuccess(auth, job, artifactPath)'), SRC.indexOf("log('job done:'"));
  assert.match(fn, /packagerReleaseJob\(jobId\)/);
});

test('packagerReleaseJob doğru jobId ile DELETE atar ve 200 de true döner', async () => {
  let seen = null;
  const ok = await withFakePackager((req, res) => {
    seen = { method: req.method, url: req.url };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"success":true}');
  }, () => packagerReleaseJob('job-abc-123'));

  assert.strictEqual(ok, true);
  assert.strictEqual(seen.method, 'DELETE');
  assert.strictEqual(seen.url, '/api/delete-job/job-abc-123');
});

test('packagerReleaseJob 404 te (eski packager) FIRLATMAZ — iş başarılı kalır', async () => {
  const ok = await withFakePackager((req, res) => {
    res.writeHead(404); res.end('not found');
  }, () => packagerReleaseJob('job-x'));

  assert.strictEqual(ok, false); // temizlik olmadı ama hata da fırlamadı
});

test('packagerReleaseJob 500 de FIRLATMAZ — artifact zaten R2 de', async () => {
  const ok = await withFakePackager((req, res) => {
    res.writeHead(500); res.end('boom');
  }, () => packagerReleaseJob('job-y'));

  assert.strictEqual(ok, false);
});

test('packagerReleaseJob packager kapalıyken de FIRLATMAZ', async () => {
  const prev = CONFIG.packagerApi;
  CONFIG.packagerApi = 'http://127.0.0.1:1';   // kapalı port
  try {
    assert.strictEqual(await packagerReleaseJob('job-z'), false);
  } finally {
    CONFIG.packagerApi = prev;
  }
});

test('jobId yoksa boşuna istek atılmaz', async () => {
  let called = false;
  const ok = await withFakePackager((req, res) => { called = true; res.writeHead(200); res.end('{}'); },
    () => packagerReleaseJob(null));

  assert.strictEqual(ok, false);
  assert.strictEqual(called, false);
});

test('touchCacheEntry mtime i tazeler — TTL temizleyicisinin baktığı işaret', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cache-touch-'));
  try {
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000); // 30 gün önce
    await fsp.utimes(dir, old, old);
    assert.ok(Date.now() - (await fsp.stat(dir)).mtimeMs > 20 * 24 * 3600 * 1000);

    assert.strictEqual(await touchCacheEntry(dir), true);

    assert.ok(Date.now() - (await fsp.stat(dir)).mtimeMs < 5000); // tazelendi
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('touchCacheEntry olmayan dizinde FIRLATMAZ — üretim durmaz', async () => {
  assert.strictEqual(await touchCacheEntry('/tmp/kesinlikle-olmayan-dizin-38471'), false);
});

test('cache HIT te kullanım işareti konur (ölü cache taze görünmesin)', () => {
  const hit = SRC.slice(SRC.indexOf('source cache HIT'), SRC.indexOf('if (!cacheHit)'));
  assert.match(hit, /touchCacheEntry\(/);
  // atime a güvenilmediği gerekçesi kodda kayıtlı kalsın
  assert.match(hit, /atime kullanılamaz/);
});

test('eski sürüm cache leri budanır (yayıncı bump sonrası disk şişmesin)', () => {
  // Helper tanımlı ve keep-version dışındaki kardeş dizinleri recursive siliyor.
  const fn = SRC.slice(SRC.indexOf('async function pruneSiblingVersions'),
    SRC.indexOf('async function pruneSiblingVersions') + 700);
  assert.match(fn, /readdir\(bookDir/);
  assert.match(fn, /e\.name === keepVersion/);        // mevcut sürümü koru
  assert.match(fn, /fsp\.rm\([^)]*recursive: true, force: true/); // gerisini sil
  // Hem populate hem HIT sonrası çağrılıyor; keep = srcVersion, kök = bookId dizini.
  const calls = SRC.match(/pruneSiblingVersions\(path\.join\(cacheRoot, String\(job\.bookId\)\), srcVersion\)/g) || [];
  assert.ok(calls.length >= 2, `prune çağrısı populate+HIT te olmalı (bulundu: ${calls.length})`);
});

// ÇIKIŞ GÖZCÜSÜ (2026-09-13): ajan üretim işinin ortasında sessizce yeniden başladı
// ve HİÇBİR iz bırakmadı — hangi yoldan çıkıldığı ölçülemedi. Bu testler kancaların
// gerçekten kurulduğunu çivileme altına alır; kaldırılırsa kırılırlar.
test('installSignalHandlers: her çıkış yoluna iz bırakan kancaları kurar', () => {
  const olaylar = ['exit', 'SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'uncaughtException', 'unhandledRejection'];
  const oncekiler = new Map(olaylar.map((o) => [o, process.listeners(o).slice()]));
  try {
    for (const o of olaylar) process.removeAllListeners(o);
    require('./runner').installSignalHandlers();
    for (const o of olaylar) {
      assert.equal(process.listenerCount(o), 1, `${o} kancası kurulmadı`);
    }
  } finally {
    for (const o of olaylar) {
      process.removeAllListeners(o);
      for (const fn of oncekiler.get(o)) process.on(o, fn);
    }
  }
});

// ---------------------------------------------------------------------------
// SET güncelleme kanalı — Runner parçası (3/3, 2026-09-23).
// bkz. .claude/docs/kitap-guncelleme-sozlesmesi.md "Sunucu tarafı — TASARIM".
// ---------------------------------------------------------------------------
const { execFileSync } = require('node:child_process');
const { guncellemeSetiYukleVeDogrula, packagerStartPackage } = require('./runner.js');

/** `set/<setKimligi>/…` köküyle gerçek bir `guncelleme.tar.gz` fixture'ı üretir. */
async function guncellemeTarFixtureOlustur(setKimligi, icerikler) {
  const kok = await fsp.mkdtemp(path.join(os.tmpdir(), 'guncelleme-src-'));
  const setDir = path.join(kok, 'set', setKimligi);
  for (const [yol, icerik] of Object.entries(icerikler)) {
    const tamYol = path.join(setDir, yol);
    await fsp.mkdir(path.dirname(tamYol), { recursive: true });
    await fsp.writeFile(tamYol, icerik);
  }
  const tarPath = path.join(kok, 'guncelleme.tar.gz');
  execFileSync('tar', ['-czf', tarPath, '-C', kok, 'set']);
  return { tarPath, kok };
}

/** Test süresince packager (`packagerApi`) VE API (`apiBase`) ucunun İKİSİNİ de TEK sahte sunucuya yönlendirir. */
async function withFakeGuncellemeSunucusu(routeHandler, fn) {
  const server = http.createServer(routeHandler);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;
  const prevPackager = CONFIG.packagerApi;
  const prevApi = CONFIG.apiBase;
  CONFIG.packagerApi = base;
  CONFIG.apiBase = base;
  try {
    return await fn(base);
  } finally {
    CONFIG.packagerApi = prevPackager;
    CONFIG.apiBase = prevApi;
    await new Promise((res) => server.close(res));
  }
}

test('guncelleme: surum.json HER ZAMAN en son PUT edilir (sıra garantisi, sözleşme)', async () => {
  const setKimligi = '11811';
  const surum = 'surum-abc123';
  const { tarPath, kok } = await guncellemeTarFixtureOlustur(setKimligi, {
    'surum.json': JSON.stringify({ surum, uretim: '2026-09-23T00:00:00Z' }),
    'manifest.json': JSON.stringify({ surum, kabuk: [], kitaplar: [] }),
    'dosya/index.html': '<html></html>',
    'dosya/assets2/logo.png': 'PNGDATA',
  });
  const tarBody = await fsp.readFile(tarPath);
  const putSirasi = [];
  const auth = { agentId: 'ag-siralama', token: 'tok' };

  const ok = await withFakeGuncellemeSunucusu((req, res) => {
    const origin = `http://${req.headers.host}`;
    if (req.method === 'GET' && req.url === '/api/download/job-siralama/guncelleme') {
      res.writeHead(200, { 'Content-Type': 'application/gzip' });
      res.end(tarBody);
      return;
    }
    if (req.method === 'POST' && req.url === `/agents/${auth.agentId}/result/presign-guncelleme`) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const { dosyalar } = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          taban: `${origin}/taban`,
          dosyalar: dosyalar.map((d) => ({ yol: d.yol, uploadUrl: `${origin}/upload/${d.yol}`, r2ObjectKey: `guncelleme/set/${setKimligi}/${d.yol}` })),
        }));
      });
      return;
    }
    if (req.method === 'PUT' && req.url.startsWith('/upload/')) {
      putSirasi.push(req.url.slice('/upload/'.length));
      req.on('data', () => {});
      req.on('end', () => { res.writeHead(200); res.end(); });
      return;
    }
    if (req.method === 'GET' && req.url === `/taban/set/${setKimligi}/surum.json`) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ surum, uretim: '2026-09-23T00:00:00Z' }));
      return;
    }
    res.writeHead(404); res.end('not found');
  }, async (base) => {
    const job = { bookId: setKimligi, platform: 'windows', setKimligi, guncellemeTabani: `${base}/taban` };
    await guncellemeSetiYukleVeDogrula(auth, job, 'job-siralama');
    return true;
  }).finally(() => fsp.rm(kok, { recursive: true, force: true }).catch(() => {}));

  assert.strictEqual(ok, true);
  assert.strictEqual(putSirasi.length, 4);
  assert.strictEqual(putSirasi[putSirasi.length - 1], 'surum.json');       // EN SON
  assert.strictEqual(putSirasi[putSirasi.length - 2], 'manifest.json');   // ondan önce
  assert.ok(putSirasi.indexOf('dosya/index.html') < putSirasi.indexOf('manifest.json'));
  assert.ok(putSirasi.indexOf('dosya/assets2/logo.png') < putSirasi.indexOf('manifest.json'));
});

test('guncelleme: doğrulama eşleşmezse iş BAŞARISIZ sayılır (fırlatır — sessiz yutma yok)', async () => {
  const setKimligi = '22222';
  const uretilenSurum = 'uretilen-surum';
  const yayinlananSurum = 'BASKA-surum'; // kasıtlı eşleşmeyen
  const { tarPath, kok } = await guncellemeTarFixtureOlustur(setKimligi, {
    'surum.json': JSON.stringify({ surum: uretilenSurum }),
    'manifest.json': JSON.stringify({ surum: uretilenSurum, kabuk: [], kitaplar: [] }),
    'dosya/index.html': '<html></html>',
  });
  const tarBody = await fsp.readFile(tarPath);
  const auth = { agentId: 'ag-mismatch', token: 'tok' };

  let hataMesaji = null;
  await withFakeGuncellemeSunucusu((req, res) => {
    const origin = `http://${req.headers.host}`;
    if (req.method === 'GET' && req.url === '/api/download/job-mismatch/guncelleme') {
      res.writeHead(200); res.end(tarBody); return;
    }
    if (req.method === 'POST' && req.url === `/agents/${auth.agentId}/result/presign-guncelleme`) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const { dosyalar } = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ taban: `${origin}/taban`, dosyalar: dosyalar.map((d) => ({ yol: d.yol, uploadUrl: `${origin}/upload/${d.yol}` })) }));
      });
      return;
    }
    if (req.method === 'PUT' && req.url.startsWith('/upload/')) {
      req.on('data', () => {});
      req.on('end', () => { res.writeHead(200); res.end(); });
      return;
    }
    if (req.method === 'GET' && req.url === `/taban/set/${setKimligi}/surum.json`) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ surum: yayinlananSurum })); // YAYINLANAN üretilenle EŞLEŞMİYOR
      return;
    }
    res.writeHead(404); res.end('not found');
  }, async (base) => {
    const job = { bookId: setKimligi, platform: 'windows', setKimligi, guncellemeTabani: `${base}/taban` };
    try {
      await guncellemeSetiYukleVeDogrula(auth, job, 'job-mismatch');
    } catch (e) {
      hataMesaji = e.message;
    }
  }).finally(() => fsp.rm(kok, { recursive: true, force: true }).catch(() => {}));

  assert.ok(hataMesaji, 'eşleşmeyen sürüm sessizce yutulmamalı, fırlatmalı');
  assert.match(hataMesaji, /sürüm eşleşmedi/);
  assert.match(hataMesaji, new RegExp(uretilenSurum));
  assert.match(hataMesaji, new RegExp(yayinlananSurum));
});

test("guncelleme: packager 'guncelleme-paketi-yok' (404) — adım ATLANIR, iş BAŞARILI kalır (eski packager uyumu)", async () => {
  const auth = { agentId: 'ag-404', token: 'tok' };
  let putCagrildi = false;

  const ok = await withFakeGuncellemeSunucusu((req, res) => {
    if (req.method === 'GET' && req.url === '/api/download/job-404/guncelleme') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'guncelleme-paketi-yok' }));
      return;
    }
    if (req.method === 'PUT') putCagrildi = true;
    res.writeHead(404); res.end('not found');
  }, async (base) => {
    const job = { bookId: '33333', platform: 'windows', setKimligi: '33333', guncellemeTabani: `${base}/taban` };
    await guncellemeSetiYukleVeDogrula(auth, job, 'job-404'); // FIRLAMAMALI
    return true;
  });

  assert.strictEqual(ok, true);
  assert.strictEqual(putCagrildi, false);
});

test('guncelleme: claim guncellemeTabani taşımıyorsa adım sessizce ATLANIR (tahmin üretilmez)', async () => {
  // Ağa hiç çıkmamalı — presign/curl çağrısı olsaydı (127.0.0.1:1 kapalı port) hemen patlardı.
  const prevPackager = CONFIG.packagerApi;
  CONFIG.packagerApi = 'http://127.0.0.1:1';
  try {
    await guncellemeSetiYukleVeDogrula(
      { agentId: 'x', token: 'y' },
      { bookId: '1', platform: 'windows', setKimligi: '1' }, // guncellemeTabani YOK
      'job-yok',
    );
  } finally {
    CONFIG.packagerApi = prevPackager;
  }
});

test('guncelleme: jobId yoksa adım sessizce ATLANIR (pardus dalı gibi — packager job i olmayabilir)', async () => {
  await guncellemeSetiYukleVeDogrula(
    { agentId: 'x', token: 'y' },
    { bookId: '1', platform: 'windows', setKimligi: '1', guncellemeTabani: 'https://x/guncelleme' },
    null,
  );
});

test('processJob: guncelleme adımı postResultSuccess SONRASI, packagerReleaseJob ÖNCESİ çalışır (jobId silinmeden)', () => {
  const fn = SRC.slice(SRC.indexOf('await postResultSuccess(auth, job, artifactPath)'), SRC.indexOf('await packagerReleaseJob(jobId)'));
  assert.match(fn, /packagerPlatform === 'windows' && job\.setKimligi/);
  assert.match(fn, /guncellemeSetiYukleVeDogrula\(auth, job, jobId\)/);
});

test('packagerStartPackage: setKimligi + guncellemeTabani verilirse istek gövdesine eklenir', async () => {
  let alinan = null;
  const jobId = await withFakePackager((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      alinan = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobId: 'job-xyz' }));
    });
  }, () => packagerStartPackage('sess1', 'windows', 'App', '1.0.0', null, '11811', 'https://cdn.x/guncelleme'));

  assert.strictEqual(jobId, 'job-xyz');
  assert.strictEqual(alinan.setKimligi, '11811');
  assert.strictEqual(alinan.guncellemeTabani, 'https://cdn.x/guncelleme');
});

test('packagerStartPackage: setKimligi/guncellemeTabani verilmezse istek gövdesine hiç eklenmez', async () => {
  let alinan = null;
  await withFakePackager((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      alinan = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobId: 'job-abc' }));
    });
  }, () => packagerStartPackage('sess1', 'android', 'App', '1.0.0'));

  assert.strictEqual('setKimligi' in alinan, false);
  assert.strictEqual('guncellemeTabani' in alinan, false);
});
