'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mapPlatform,
  backoffMs,
  parseNextJob,
  isTerminalStatus,
  packageStatusOf,
  artifactExtension,
  artifactContentType,
  joinUrl,
  addFileToZipRoot,
  restartRequested,
  pauseRequested,
  isTransientNetworkError,
  srcVersionTuret,
  agHatasiOzeti,
  guncellemeDosyalariniSirala,
  guncellemeIcerikTipi,
  tarListesiniAyristir,
} = require('./runner-helpers');

test('mapPlatform: android -> android', () => {
  assert.equal(mapPlatform('android'), 'android');
  assert.equal(mapPlatform('ANDROID'), 'android');
  assert.equal(mapPlatform(' android '), 'android');
});

test('mapPlatform: macos/mac -> macos', () => {
  assert.equal(mapPlatform('macos'), 'macos');
  assert.equal(mapPlatform('mac'), 'macos');
  assert.equal(mapPlatform('MacOS'), 'macos');
});

test('mapPlatform: pardus -> pardus (Docker + pardus-packager-build.sh dalı, 2026-09-10)', () => {
  assert.equal(mapPlatform('pardus'), 'pardus');
  assert.equal(mapPlatform('PARDUS'), 'pardus');
  assert.equal(mapPlatform(' pardus '), 'pardus');
});

// KAPI (2026-09-23, Şef/Nadir yetkisiyle): tetikleyici kararı (windows-set ayrı
// platform mı, yoksa 'windows' teslimini mi değiştirir — windows-paketleme-sozlesmesi.md
// "Tetikleyici — KARAR BEKLİYOR") verilmeden varsayılan AÇIK olamaz; yoksa runner'ı
// yeniden başlatan herkes boru hattındaki windows işlerini claim edip NSIS üretir.
test("mapPlatform: windows -> null (KAPI KAPALI, varsayılan — karar bekliyor)", () => {
  const onceki = process.env.EMPP_RUNNER_WINDOWS;
  delete process.env.EMPP_RUNNER_WINDOWS;
  try {
    assert.equal(mapPlatform('windows'), null);
    assert.equal(mapPlatform('WINDOWS'), null);
    assert.equal(mapPlatform(' windows '), null);
  } finally {
    if (onceki === undefined) delete process.env.EMPP_RUNNER_WINDOWS; else process.env.EMPP_RUNNER_WINDOWS = onceki;
  }
});

test('mapPlatform: windows -> windows YALNIZ EMPP_RUNNER_WINDOWS=1 iken (SET güncelleme kanalının kaynağı)', () => {
  const onceki = process.env.EMPP_RUNNER_WINDOWS;
  process.env.EMPP_RUNNER_WINDOWS = '1';
  try {
    assert.equal(mapPlatform('windows'), 'windows');
    assert.equal(mapPlatform('WINDOWS'), 'windows');
    assert.equal(mapPlatform(' windows '), 'windows');
  } finally {
    if (onceki === undefined) delete process.env.EMPP_RUNNER_WINDOWS; else process.env.EMPP_RUNNER_WINDOWS = onceki;
  }
});

test("mapPlatform: windows -> null EMPP_RUNNER_WINDOWS başka bir değerdeyken (yalnız '1' açar)", () => {
  const onceki = process.env.EMPP_RUNNER_WINDOWS;
  process.env.EMPP_RUNNER_WINDOWS = 'true';
  try {
    assert.equal(mapPlatform('windows'), null);
  } finally {
    if (onceki === undefined) delete process.env.EMPP_RUNNER_WINDOWS; else process.env.EMPP_RUNNER_WINDOWS = onceki;
  }
});

test('mapPlatform: unsupported -> null', () => {
  assert.equal(mapPlatform('linux'), null);
  assert.equal(mapPlatform(''), null);
  assert.equal(mapPlatform(undefined), null);
});

test('backoffMs: exponential, 0-based', () => {
  assert.equal(backoffMs(0, 1000, 30000), 1000);
  assert.equal(backoffMs(1, 1000, 30000), 2000);
  assert.equal(backoffMs(2, 1000, 30000), 4000);
  assert.equal(backoffMs(3, 1000, 30000), 8000);
});

test('backoffMs: capped at maxMs', () => {
  assert.equal(backoffMs(10, 1000, 30000), 30000);
  assert.equal(backoffMs(100, 1000, 30000), 30000);
});

test('backoffMs: negative/NaN attempt treated as 0', () => {
  assert.equal(backoffMs(-5, 1000, 30000), 1000);
  assert.equal(backoffMs(NaN, 1000, 30000), 1000);
});

test('parseNextJob: 204 -> null (no work)', () => {
  assert.equal(parseNextJob(204, undefined), null);
  assert.equal(parseNextJob(204, null), null);
});

test('parseNextJob: 200 with { job } -> normalized', () => {
  const job = parseNextJob(200, {
    job: { bookId: 12345, platform: 'android', downloadUrl: 'https://x/y.exe', buildMethod: 'build', bookTitle: 'T' },
  });
  assert.deepEqual(job, {
    bookId: '12345',
    platform: 'android',
    downloadUrl: 'https://x/y.exe',
    buildMethod: 'build',
    bookTitle: 'T',
  });
});

test('parseNextJob: claim G alanları (setKimligi, guncellemeTabani, surum) korunur', () => {
  const job = parseNextJob(200, {
    job: {
      bookId: 45482, platform: 'pardus', downloadUrl: 'https://x/y.exe',
      setKimligi: '45482', guncellemeTabani: 'https://cdn.ydspublishing.com/guncelleme', surum: '2.51.1',
    },
  });
  assert.equal(job.setKimligi, '45482');
  assert.equal(job.guncellemeTabani, 'https://cdn.ydspublishing.com/guncelleme');
  assert.equal(job.surum, '2.51.1', 'GERİLEME (26.09 21:17): surum düşerse pardus G\'siz üretilir');
  const yok = parseNextJob(200, {
    job: { bookId: 1, platform: 'android', downloadUrl: 'u', surumYok: 'panel kodu yok', guncellemeTabaniYok: 'r2 yok' },
  });
  assert.equal(yok.surum, undefined);
  assert.equal(yok.surumYok, 'panel kodu yok');
  assert.equal(yok.guncellemeTabaniYok, 'r2 yok');
});

test('parseNextJob: claim setListesi (panel set listesi, ham) AYNEN korunur; boşsa alan yok', () => {
  const ham = '45356 | Student Book | k1 | book\n45352 | Test Book\nlink:https://x | Site';
  const job = parseNextJob(200, { job: { bookId: 45550, platform: 'mac', downloadUrl: 'u', setListesi: ham } });
  assert.equal(job.setListesi, ham, 'GERİLEME (01.10 12:07 45550/mac): alan düşerse set eki atlanır');
  const setEk = require('./set-uyelik-ek');
  const coz = setEk.setListesiCoz({ job, env: {} });
  assert.equal(coz && coz.kaynak, 'claim');
  assert.equal(setEk.setListesiAyristir(coz.ham).length, 3);
  for (const bos of [undefined, null, '', '  \n ']) {
    const j = parseNextJob(200, { job: { bookId: 1, platform: 'pardus', downloadUrl: 'u', setListesi: bos } });
    assert.equal('setListesi' in j, false, `boş değer (${JSON.stringify(bos)}) alan üretmemeli`);
  }
});

test('parseNextJob: runner.js/windows-serit.js\'in okuduğu claim alanlarının hepsi ayrıştırıcıdan geçer', () => {
  const fs = require('fs');
  const path = require('path');
  const kaynak = ['runner.js', 'windows-serit.js', 'set-uyelik-ek.js', 'kaynak-karari.js']
    .map((d) => fs.readFileSync(path.join(__dirname, d), 'utf8')).join('\n');
  const okunan = new Set([...kaynak.matchAll(/\bjob\.([A-Za-z_]+)/g)].map((m) => m[1]));
  // Sunucunun (book-update next-job) claim'de gönderdiği alanlar.
  const tam = {
    bookId: 1, platform: 'pardus', downloadUrl: 'u', buildMethod: 'build', bookTitle: 't', publisherName: 'p',
    setKimligi: 's', guncellemeTabani: 'https://x', surum: '2.1.1', surumYok: 'a', guncellemeTabaniYok: 'b',
    setListesi: '45356 | Student Book\n45352 | Test Book', kaynakTuru: 'manuel', bilgiUrl: 'https://x/a.exe',
  };
  const cikan = parseNextJob(200, { job: tam });
  const eksik = [...okunan].filter((a) => a in tam && !(a in cikan));
  assert.deepEqual(eksik, [], `parseNextJob şu claim alanlarını düşürüyor: ${eksik.join(', ')}`);
  for (const a of ['surum', 'setKimligi', 'guncellemeTabani', 'setListesi', 'kaynakTuru', 'bilgiUrl']) assert.ok(okunan.has(a), `${a} runner'da okunmuyor mu?`);
});

test('parseNextJob: 200 bare object (defensive) -> normalized', () => {
  const job = parseNextJob(200, { bookId: 'b1', platform: 'macos', downloadUrl: 'https://x/y.exe' });
  assert.equal(job.bookId, 'b1');
  assert.equal(job.platform, 'macos');
  assert.equal(job.buildMethod, undefined);
});

test('parseNextJob: missing required field -> null', () => {
  assert.equal(parseNextJob(200, { job: { platform: 'android', downloadUrl: 'u' } }), null); // no bookId
  assert.equal(parseNextJob(200, { job: { bookId: 'b1', downloadUrl: 'u' } }), null); // no platform
  assert.equal(parseNextJob(200, {}), null);
  assert.equal(parseNextJob(200, null), null);
});

// EXE'SİZ SÖZLEŞME (Nadir 01.10): downloadUrl'süz iş SESSİZCE düşmez — bookId + platform yeter;
// kaynak kararı (arşiv / manuel / yok → kira bırak) kaynak-karari.js'te verilir.
test('parseNextJob: downloadUrl\'süz iş KABUL edilir (bookId + platform yeter), alan boş dize', () => {
  const j = parseNextJob(200, { job: { bookId: 45482, platform: 'android' } });
  assert.ok(j, 'downloadUrl yok diye iş düşmemeli');
  assert.equal(j.bookId, '45482');
  assert.equal(j.platform, 'android');
  assert.equal(j.downloadUrl, '');
  assert.equal('kaynakTuru' in j, false);
});

test('parseNextJob: claim kaynakTuru taşınır (kırpılmış); boşsa alan yok', () => {
  assert.equal(parseNextJob(200, { job: { bookId: 1, platform: 'mac', kaynakTuru: ' manuel ' } }).kaynakTuru, 'manuel');
  for (const bos of ['', '   ', null, 7]) {
    const j = parseNextJob(200, { job: { bookId: 1, platform: 'mac', kaynakTuru: bos } });
    assert.equal('kaynakTuru' in j, false, `boş/geçersiz kaynakTuru (${JSON.stringify(bos)}) alan üretmemeli`);
  }
});

// Sunucu sözleşmesi (book-update ajan-kaynak-turu.ts nextJobKaynakSemasi): 'arsiv-gerekli' claim'inde
// downloadUrl ALANI YOK, exe adresi yalnız BİLGİ olarak bilgiUrl'de.
test('parseNextJob: {kaynakTuru:"arsiv-gerekli", bilgiUrl, downloadUrl yok} claim kabul edilir, alanlar taşınır', () => {
  const bilgiUrl = 'https://acc.r2.cloudflarestorage.com/akillitahtalar/45472/YDT-Set-v62.exe?X-Amz-Signature=a';
  const j = parseNextJob(200, { job: { bookId: 45472, platform: 'pardus', kaynakTuru: 'arsiv-gerekli', bilgiUrl } });
  assert.ok(j);
  assert.equal(j.kaynakTuru, 'arsiv-gerekli');
  assert.equal(j.bilgiUrl, bilgiUrl);
  assert.equal(j.downloadUrl, '', 'indirilebilir alan boş kalır');
  const m = parseNextJob(200, { job: { bookId: 1, platform: 'mac', kaynakTuru: 'manuel',
    downloadUrl: 'https://r2/x/sources/1/a.zip' } });
  assert.equal(m.kaynakTuru, 'manuel');
  assert.equal('bilgiUrl' in m, false, 'bilgiUrl yoksa alan da yok');
  assert.equal('bilgiUrl' in parseNextJob(200, { job: { bookId: 1, platform: 'mac', bilgiUrl: '  ' } }), false);
});

test('parseNextJob: non-200/204 status -> null', () => {
  assert.equal(parseNextJob(500, { job: { bookId: 'b1', platform: 'android', downloadUrl: 'u' } }), null);
});

test('isTerminalStatus', () => {
  assert.equal(isTerminalStatus('completed'), true);
  assert.equal(isTerminalStatus('failed'), true);
  assert.equal(isTerminalStatus('COMPLETED'), true);
  assert.equal(isTerminalStatus('processing'), false);
  assert.equal(isTerminalStatus('queued'), false);
  assert.equal(isTerminalStatus('ready'), false);
  assert.equal(isTerminalStatus(''), false);
});

test('packageStatusOf: extracts job.status', () => {
  assert.equal(packageStatusOf({ success: true, jobId: 'j', job: { status: 'processing', progress: 40 } }), 'processing');
  assert.equal(packageStatusOf({ job: { status: 'COMPLETED' } }), 'completed');
  assert.equal(packageStatusOf({ job: null }), '');
  assert.equal(packageStatusOf(null), '');
  assert.equal(packageStatusOf({}), '');
});

test('artifactExtension', () => {
  assert.equal(artifactExtension('android'), '.apk');
  assert.equal(artifactExtension('macos'), '.dmg');
  assert.equal(artifactExtension('pardus'), '.impark');
  assert.equal(artifactExtension('windows'), '.exe');
  assert.equal(artifactExtension('linux'), ''); // gerçekten desteklenmeyen -> boş
});

test('artifactContentType', () => {
  assert.equal(artifactContentType('android'), 'application/vnd.android.package-archive');
  assert.equal(artifactContentType('macos'), 'application/x-apple-diskimage');
  assert.equal(artifactContentType('pardus'), 'application/octet-stream');
  assert.equal(artifactContentType('windows'), 'application/x-msdownload');
  assert.equal(artifactContentType('linux'), 'application/octet-stream'); // bilinmeyen -> güvenli genel tip
});

test('joinUrl: single slash', () => {
  assert.equal(joinUrl('https://api/v1', 'agents/x'), 'https://api/v1/agents/x');
  assert.equal(joinUrl('https://api/v1/', '/agents/x'), 'https://api/v1/agents/x');
});

test('pickLogoId: yayinci adina gore logo (bosluk/harf duyarsiz), yoksa null', () => {
  const { pickLogoId } = require('./runner-helpers');
  const logos = [
    { id: 'a', kurumId: 'flashypublishing', kurumAdi: 'Flashy Publishing' },
    { id: 'b', kurumId: 'ydspublishing', kurumAdi: 'YDS Publishing' },
  ];
  assert.strictEqual(pickLogoId(logos, 'YDS Publishing'), 'b');
  assert.strictEqual(pickLogoId(logos, 'yds publishing'), 'b');
  assert.strictEqual(pickLogoId(logos, 'Flashy ELT'), null);   // farkli yayinci adi -> uydurma yok
  assert.strictEqual(pickLogoId(logos, undefined), null);
  assert.strictEqual(pickLogoId(null, 'YDS Publishing'), null);
});

test('parseNextJob publisherName tasir', () => {
  const { parseNextJob } = require('./runner-helpers');
  const j = parseNextJob(200, { bookId: '1', platform: 'mac', downloadUrl: 'https://x/a.exe', publisherName: 'YDS Publishing' });
  assert.strictEqual(j.publisherName, 'YDS Publishing');
});

// SET güncelleme kanalı (2026-09-23): claim setKimligi + guncellemeTabani tasir.
test('parseNextJob: setKimligi + guncellemeTabani claim den gelirse tasinir', () => {
  const { parseNextJob } = require('./runner-helpers');
  const j = parseNextJob(200, {
    bookId: '11811', platform: 'windows', downloadUrl: 'https://x/a.exe',
    setKimligi: 11811, guncellemeTabani: 'https://cdn.ydspublishing.com/guncelleme',
  });
  assert.strictEqual(j.setKimligi, '11811'); // sayı bile gelse string e sabitlenir (kimlik, aritmetik degil)
  assert.strictEqual(j.guncellemeTabani, 'https://cdn.ydspublishing.com/guncelleme');
});

test('parseNextJob: setKimligi/guncellemeTabani yoksa alanlar hic tanimsiz kalir (tahmin uretilmez)', () => {
  const { parseNextJob } = require('./runner-helpers');
  const j = parseNextJob(200, { bookId: '2', platform: 'android', downloadUrl: 'https://x/b.exe' });
  assert.strictEqual('setKimligi' in j, false);
  assert.strictEqual('guncellemeTabani' in j, false);
});

// ---------------------------------------------------------------------------
// SET güncelleme kanalı — Runner parçası (3/3, 2026-09-23) saf yardımcılar.
// ---------------------------------------------------------------------------

test('guncellemeDosyalariniSirala: dosya/* -> manifest.json -> surum.json (sözleşme sırası)', () => {
  const girdi = ['surum.json', 'dosya/assets2/logo.png', 'manifest.json', 'dosya/index.html'];
  const sirali = guncellemeDosyalariniSirala(girdi);
  assert.deepEqual(sirali, ['dosya/assets2/logo.png', 'dosya/index.html', 'manifest.json', 'surum.json']);
});

test('guncellemeDosyalariniSirala: surum.json HER ZAMAN son indekste durur (rastgele sıralarda)', () => {
  // "Sıralamada surum.json'u öne alınca düşsün" mutasyon kontrolü: girdi kaç farklı
  // sırada verilirse verilsin, sonuçta surum.json her zaman en sonda olmalı.
  const kombinasyonlar = [
    ['surum.json', 'manifest.json', 'dosya/a.js'],
    ['dosya/a.js', 'surum.json', 'manifest.json'],
    ['manifest.json', 'surum.json', 'dosya/a.js'],
    ['dosya/b.css', 'dosya/a.js', 'manifest.json', 'surum.json'],
  ];
  for (const girdi of kombinasyonlar) {
    const sirali = guncellemeDosyalariniSirala(girdi);
    assert.strictEqual(sirali[sirali.length - 1], 'surum.json', `girdi=${JSON.stringify(girdi)}`);
    assert.strictEqual(sirali[sirali.length - 2], 'manifest.json', `girdi=${JSON.stringify(girdi)}`);
  }
});

test('guncellemeDosyalariniSirala: aynı kategori içinde girdi sırası korunur (kararlı sıralama)', () => {
  const girdi = ['dosya/c.js', 'dosya/a.js', 'dosya/b.js'];
  assert.deepEqual(guncellemeDosyalariniSirala(girdi), ['dosya/c.js', 'dosya/a.js', 'dosya/b.js']);
});

test('guncellemeDosyalariniSirala: {yol} nesneleriyle de çalışır, kimliği bozmaz', () => {
  const girdi = [{ yol: 'surum.json', boyut: 40 }, { yol: 'dosya/a.js', boyut: 10 }];
  const sirali = guncellemeDosyalariniSirala(girdi);
  assert.deepEqual(sirali.map((x) => x.yol), ['dosya/a.js', 'surum.json']);
  assert.strictEqual(sirali[0].boyut, 10);
});

test('guncellemeDosyalariniSirala: geçersiz girdi -> boş dizi (fırlamaz)', () => {
  assert.deepEqual(guncellemeDosyalariniSirala(null), []);
  assert.deepEqual(guncellemeDosyalariniSirala(undefined), []);
});

test('guncellemeIcerikTipi: bilinen uzantılar dogru MIME döner', () => {
  assert.equal(guncellemeIcerikTipi('index.html'), 'text/html');
  assert.equal(guncellemeIcerikTipi('manifest.json'), 'application/json');
  assert.equal(guncellemeIcerikTipi('dosya/assets2/app.JS'), 'application/javascript'); // büyük/küçük harf duyarsız
  assert.equal(guncellemeIcerikTipi('dosya/assets2/logo.png'), 'image/png');
  assert.equal(guncellemeIcerikTipi('dosya/favicon.ico'), 'image/x-icon');
  assert.equal(guncellemeIcerikTipi('dosya/font.woff2'), 'font/woff2');
});

test('guncellemeIcerikTipi: bilinmeyen/uzantısız -> application/octet-stream', () => {
  assert.equal(guncellemeIcerikTipi('dosya/gizli-dosya'), 'application/octet-stream');
  assert.equal(guncellemeIcerikTipi(''), 'application/octet-stream');
  assert.equal(guncellemeIcerikTipi(undefined), 'application/octet-stream');
});

test('tarListesiniAyristir: set/<id>/ kökünü göreli yola indirger, dizinleri eler', () => {
  const cikti = [
    'set/11811/',
    'set/11811/surum.json',
    'set/11811/manifest.json',
    'set/11811/dosya/',
    'set/11811/dosya/assets2/',
    'set/11811/dosya/assets2/logo.png',
    'set/11811/dosya/index.html',
  ].join('\n');
  const sonuc = tarListesiniAyristir(cikti, '11811');
  assert.deepEqual(sonuc, ['surum.json', 'manifest.json', 'dosya/assets2/logo.png', 'dosya/index.html']);
});

test('tarListesiniAyristir: farklı bir set kimliğinin dosyaları SESSİZCE elenir (kapsam dışı)', () => {
  const cikti = ['set/11811/surum.json', 'set/99999/surum.json'].join('\n');
  assert.deepEqual(tarListesiniAyristir(cikti, '11811'), ['surum.json']);
});

test('tarListesiniAyristir: yol güvenliği — .. ve mutlak yol RET edilir (varsayılan RET)', () => {
  const cikti = [
    'set/11811/surum.json',
    'set/11811/dosya/../../etc/passwd',
    'set/11811//etc/passwd',
    '../../etc/passwd',
  ].join('\n');
  const sonuc = tarListesiniAyristir(cikti, '11811');
  assert.deepEqual(sonuc, ['surum.json']);
});

test('tarListesiniAyristir: ./ öneki temizlenir, boş satırlar elenir', () => {
  const cikti = ['./set/11811/surum.json', '', '   ', 'set/11811/manifest.json'].join('\n');
  assert.deepEqual(tarListesiniAyristir(cikti, '11811'), ['surum.json', 'manifest.json']);
});

test('tarListesiniAyristir: setKimligi veya çıktı boşsa -> boş dizi', () => {
  assert.deepEqual(tarListesiniAyristir('set/1/surum.json', ''), []);
  assert.deepEqual(tarListesiniAyristir('', '11811'), []);
  assert.deepEqual(tarListesiniAyristir(null, '11811'), []);
});

test('runner: complete-multipart 5xx için yeniden deneme var (sentinel, 2026-08-27)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'runner.js'), 'utf8');
  require('node:assert').ok(/attempt <= COMPLETE_ATTEMPTS[\s\S]{0,600}complete-multipart/.test(src), 'complete-multipart COMPLETE_ATTEMPTS döngüsü olmalı');
  // 2026-09-15: 3×15 sn 502 dalgasını atlatamadı — en az 8 deneme, artan bekleyiş (tavan 60 sn).
  require('node:assert').match(src, /AGENT_COMPLETE_ATTEMPTS \|\| 8\)/);
  require('node:assert').match(src, /Math\.min\(15000 \* attempt, 60000\)/);
  require('node:assert').match(src, /AGENT_PRESIGN_ATTEMPTS \|\| 5\)/, 'presign-multipart de yeniden denenmeli');
});

test('runner: geçici ağ hatasında failed yazılmaz, parça yükleme 30 deneme (sentinel, 2026-08-27)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'runner.js'), 'utf8');
  const assert = require('node:assert');
  assert.ok(src.includes('isTransientNetworkError(e)') && src.includes('AGENT_UPLOAD_PART_ATTEMPTS'));
});

test('asciiAppName: Türkçe harfler ASCII, yasak karakter boşluk (45496 "YKS-DİL Dergi Seti" dersi)', () => {
  const { asciiAppName } = require('./runner-helpers');
  const assert = require('node:assert');
  assert.strictEqual(asciiAppName('YKS-DİL Dergi Seti'), 'YKS-DIL Dergi Seti');
  assert.strictEqual(asciiAppName('Shall We?! 5 Set / 2024'), 'Shall We 5 Set 2024');
  assert.strictEqual(asciiAppName('', 'book-1'), 'book-1');
});

test('addFileToZipRoot: dosya zip köküne yol bilgisi olmadan girer, ikinci ekleme ezer', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawnSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-root-'));
  const zipPath = path.join(dir, 'build.zip');
  fs.mkdirSync(path.join(dir, 'src', 'derin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'derin', 'a.js'), '1');
  assert.equal(spawnSync('zip', ['-q', '-r', zipPath, 'src'], { cwd: dir }).status, 0);
  const iconDir = path.join(dir, 'ikon', 'alt');
  fs.mkdirSync(iconDir, { recursive: true });
  fs.writeFileSync(path.join(iconDir, 'ico.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.deepEqual(addFileToZipRoot(zipPath, path.join(iconDir, 'ico.png')), { ok: true });
  const list = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).stdout.split('\n');
  assert.ok(list.includes('ico.png'), 'ico.png kökte olmalı: ' + list.join(','));
  assert.ok(!list.some((l) => l.startsWith('ikon/')), 'yol bilgisi taşınmamalı');
  fs.writeFileSync(path.join(iconDir, 'ico.png'), Buffer.from([1, 2, 3, 4, 5, 6]));
  assert.deepEqual(addFileToZipRoot(zipPath, path.join(iconDir, 'ico.png')), { ok: true });
  const size = spawnSync('unzip', ['-Zl', zipPath, 'ico.png'], { encoding: 'utf8' }).stdout;
  assert.match(size, /\b6\b/, 'ikinci ekleme eskisini ezmeli');
  assert.equal(addFileToZipRoot(zipPath, path.join(dir, 'yok.png')).ok, false);
});

test('restartRequested: bayrak yoksa false; varsa true döner ve dosyayı siler (tek kullanımlık)', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const flag = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rr-')), 'yeniden-baslat.istek');
  assert.equal(restartRequested(flag), false);
  fs.writeFileSync(flag, '');
  assert.equal(restartRequested(flag), true);
  assert.equal(fs.existsSync(flag), false, 'bayrak silinmeli');
  assert.equal(restartRequested(flag), false, 'ikinci okuma false');
});

test('pauseRequested: bayrak yoksa false; varsa true ve dosya SİLİNMEZ (kalıcı duraklatma)', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const flag = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pr-')), 'duraklat.istek');
  assert.equal(pauseRequested(flag), false);
  fs.writeFileSync(flag, '');
  assert.equal(pauseRequested(flag), true);
  assert.equal(fs.existsSync(flag), true, 'bayrak kalmalı');
  assert.equal(pauseRequested(flag), true, 'ikinci okuma da true');
  fs.unlinkSync(flag);
  assert.equal(pauseRequested(flag), false);
});

const { etkinYetenekler, agGecidiAyikla } = require('./runner-helpers');

test('etkinYetenekler: evde macos düşer, android/pardus kalır (Nadir kararı 2026-09-12)', () => {
  assert.deepEqual(etkinYetenekler(['android', 'macos', 'pardus'], { ofiste: false }), ['android', 'pardus']);
  assert.deepEqual(etkinYetenekler(['android', 'mac'], { ofiste: false }), ['android']);
});

test('etkinYetenekler: ofiste tam liste; girdi dizisi değişmez', () => {
  const caps = ['android', 'macos', 'pardus'];
  assert.deepEqual(etkinYetenekler(caps, { ofiste: true }), ['android', 'macos', 'pardus']);
  assert.deepEqual(caps, ['android', 'macos', 'pardus']);
});

test('etkinYetenekler: macos-serbest bayrağı evde de açar; macos-durdur ofiste de keser', () => {
  assert.deepEqual(etkinYetenekler(['android', 'macos'], { ofiste: false, macSerbest: true }), ['android', 'macos']);
  assert.deepEqual(etkinYetenekler(['android', 'macos'], { ofiste: true, macDurdur: true }), ['android']);
  assert.deepEqual(etkinYetenekler(['android', 'macos'], { ofiste: true, macSerbest: true, macDurdur: true }), ['android']);
});

// --- mac araç zinciri kapısı -------------------------------------------------
// 2026-09-16 arızası: Xcode 27.0 otomatik güncellemesi lisans onayını sıfırladı,
// xcrun+notarytool rc=69 vermeye başladı. Ajan bunu BİLMEDİĞİ için mac işi
// kiralamayı sürdürdü: 73768 ve 72378 için ~730 MB kaynak indirildi, build 35 sn'de
// düştü, satırlara sahte `failed` yazıldı, ve kurtarma insana kaldı (elle bayrak).
// Bu testler kapının hem DÜŞÜRDÜĞÜNÜ hem de KENDİLİĞİNDEN GERİ GELDİĞİNİ çiviler.

test('etkinYetenekler: araç zinciri bozuksa macos ofiste bile düşer (730 MB boşa indirme kapanı)', () => {
  assert.deepEqual(
    etkinYetenekler(['android', 'macos', 'pardus'], { ofiste: true, macAraci: false }),
    ['android', 'pardus'],
  );
  // macos-serbest bayrağı bile bozuk araç zincirini AŞAMAZ — imzasız/notersiz
  // paket üretmek, hiç üretmemekten kötüdür.
  assert.deepEqual(
    etkinYetenekler(['android', 'mac'], { ofiste: false, macSerbest: true, macAraci: false }),
    ['android'],
  );
});

test('etkinYetenekler: araç zinciri düzelince macos KENDİLİĞİNDEN geri gelir (elle bayrak gerekmez)', () => {
  assert.deepEqual(
    etkinYetenekler(['android', 'macos'], { ofiste: true, macAraci: true }),
    ['android', 'macos'],
  );
});

// MUTASYON KAPANI: `d.macAraci === false` yerine `!d.macAraci` yazılırsa, ölçüm
// yapmayan her çağıran (eski testler, başka giriş noktaları) mac'i sessizce kaybeder.
test('etkinYetenekler: macAraci ölçülmediyse (undefined) kapı engellemez', () => {
  assert.deepEqual(etkinYetenekler(['android', 'macos'], { ofiste: true }), ['android', 'macos']);
  assert.deepEqual(
    etkinYetenekler(['android', 'macos'], { ofiste: true, macAraci: undefined }),
    ['android', 'macos'],
  );
});

test('agGecidiAyikla: route çıktısından geçit; yoksa null', () => {
  assert.equal(agGecidiAyikla('   route to: default\ndestination: default\n     gateway: 192.168.1.254\n  interface: en0'), '192.168.1.254');
  assert.equal(agGecidiAyikla('route: writing to routing socket: not in table'), null);
  assert.equal(agGecidiAyikla(''), null);
});

const { dusukVeriAyristir } = require('./runner-helpers');

test('dusukVeriAyristir: constrained=1 → true, =0 → false (WiFi Düşük Veri Modu, Nadir 2026-09-13)', () => {
  assert.equal(dusukVeriAyristir('constrained=1 expensive=0 status=ok'), true);
  assert.equal(dusukVeriAyristir('constrained=0 expensive=1 status=ok'), false);
});

test('dusukVeriAyristir: okunamaz/boş/bozuk girdi → false (güvenli varsayılan, üretimi durdurma)', () => {
  assert.equal(dusukVeriAyristir(''), false);
  assert.equal(dusukVeriAyristir(null), false);
  assert.equal(dusukVeriAyristir(undefined), false);
  assert.equal(dusukVeriAyristir('status=err'), false);
  assert.equal(dusukVeriAyristir('constrained=x'), false);
});

const { lruSilinecekler } = require('./runner-helpers');

const GB = 1024 ** 3;

test('lruSilinecekler: tavan altında -> []', () => {
  const girdiler = [
    { yol: '/cache/1/v1', bayt: 5 * GB, sonKullanim: 100 },
    { yol: '/cache/2/v1', bayt: 4 * GB, sonKullanim: 200 },
  ];
  assert.deepEqual(lruSilinecekler(girdiler, 20 * GB), []);
});

test('lruSilinecekler: en eskiden başlar, tavan altına inince durur — en yeni listede YOK', () => {
  const girdiler = [
    { yol: '/cache/A', bayt: 10 * GB, sonKullanim: 100 },
    { yol: '/cache/B', bayt: 10 * GB, sonKullanim: 200 },
    { yol: '/cache/C', bayt: 10 * GB, sonKullanim: 300 },
    { yol: '/cache/D', bayt: 10 * GB, sonKullanim: 400 },
  ];
  const sonuc = lruSilinecekler(girdiler, 25 * GB); // toplam 40GB, tavan 25GB -> 15GB düşmeli
  assert.deepEqual(sonuc.map((g) => g.yol), ['/cache/A', '/cache/B']);
  // GERİLEME kapısı: en yeni (D) veya bir önceki (C) YANLIŞLIKLA silinmemeli.
  assert.ok(!sonuc.some((g) => g.yol === '/cache/C'), 'C (2. en yeni) listede OLMAMALI');
  assert.ok(!sonuc.some((g) => g.yol === '/cache/D'), 'D (en yeni) listede OLMAMALI');
  // Hepsi silinmiş olmamalı — "tavana ininceye kadar dur" işliyor.
  assert.ok(sonuc.length < girdiler.length, 'tüm girdiler silinmemeli, yalnız gereken kadarı');
});

test('lruSilinecekler: korunan girdi en eski olsa da atlanır, sıradaki silinir', () => {
  const girdiler = [
    { yol: '/cache/A-korunan', bayt: 10 * GB, sonKullanim: 100, korunan: true },
    { yol: '/cache/B', bayt: 10 * GB, sonKullanim: 200 },
    { yol: '/cache/C', bayt: 10 * GB, sonKullanim: 300 },
  ];
  const sonuc = lruSilinecekler(girdiler, 15 * GB); // toplam 30GB, tavan 15GB
  assert.deepEqual(sonuc.map((g) => g.yol), ['/cache/B', '/cache/C']);
  assert.ok(!sonuc.some((g) => g.yol === '/cache/A-korunan'), 'korunan girdi ASLA listelenmemeli');
});

test('lruSilinecekler: sonKullanim eksik girdi 0 sayılır (en eski kabul edilir)', () => {
  const girdiler = [
    { yol: '/cache/X', bayt: 10 * GB, sonKullanim: 500 },
    { yol: '/cache/Y-eksik', bayt: 10 * GB }, // sonKullanim yok -> 0
    { yol: '/cache/Z', bayt: 10 * GB, sonKullanim: 1000 },
  ];
  const sonuc = lruSilinecekler(girdiler, 15 * GB); // toplam 30GB, tavan 15GB
  assert.deepEqual(sonuc.map((g) => g.yol), ['/cache/Y-eksik', '/cache/X']);
  assert.ok(!sonuc.some((g) => g.yol === '/cache/Z'), 'en yeni (Z) silinmemeli');
});

test('lruSilinecekler: girdi dizisi ve nesneleri mutasyona uğramaz', () => {
  const girdiler = [
    { yol: '/cache/A', bayt: 10 * GB, sonKullanim: 100 },
    { yol: '/cache/B', bayt: 10 * GB, sonKullanim: 200 },
  ];
  const kopya = JSON.parse(JSON.stringify(girdiler));
  lruSilinecekler(girdiler, 5 * GB);
  assert.deepEqual(girdiler, kopya);
});

// --- isTransientNetworkError ------------------------------------------------
// 2026-09-13: ajan logunda `heartbeat failed: ` — iki nokta üst üsteden sonra mesaj BOŞ —
// böyle bir hata regex'e hiç uymadığı için kalıcı sayılıp iş boşuna düşüyordu. Boş/eksik
// mesajlı hatalar artık GEÇİCİ sayılır (yeniden denenir).

test('isTransientNetworkError: boş/eksik mesaj GEÇİCİ sayılır (2026-09-13 heartbeat kanıtı)', () => {
  assert.equal(isTransientNetworkError(new Error('')), true);
  assert.equal(isTransientNetworkError({}), true);            // .message'sız nesne
  assert.equal(isTransientNetworkError(undefined), true);
  assert.equal(isTransientNetworkError(null), true);
  assert.equal(isTransientNetworkError(''), true);             // boş string hata
});

test('isTransientNetworkError: bilinen geçici ağ desenleri true döner', () => {
  assert.equal(isTransientNetworkError(new Error('ECONNRESET')), true);
  assert.equal(isTransientNetworkError(new Error('connect ETIMEDOUT 1.2.3.4:443')), true);
  assert.equal(isTransientNetworkError(new Error('socket hang up')), true);
  assert.equal(isTransientNetworkError(new Error('EPIPE')), true);
  assert.equal(isTransientNetworkError(new Error('getaddrinfo ENOTFOUND api.example.com')), true);
  assert.equal(isTransientNetworkError(new Error('fetch failed')), true);
  assert.equal(isTransientNetworkError(new Error('presign-multipart failed: HTTP 503 {}')), true);
});

test('isTransientNetworkError: kalıcı iş hataları false döner (mutasyon kapanı — "hepsine true dön" burada kırılmalı)', () => {
  assert.equal(isTransientNetworkError(new Error('401 Unauthorized')), false);
  assert.equal(isTransientNetworkError(new Error('403 Forbidden')), false);
  assert.equal(isTransientNetworkError(new Error('invalid token')), false);
  assert.equal(isTransientNetworkError(new Error('resources/app/build not found in extracted package')), false);
});

test('isTransientNetworkError: string girdi de doğru çalışır', () => {
  assert.equal(isTransientNetworkError('ECONNRESET'), true);
  assert.equal(isTransientNetworkError('401 Unauthorized'), false);
  assert.equal(isTransientNetworkError('   '), true); // yalnız boşluk -> boş sayılır
});

// 2026-09-16 — ÖNCEKİ KARAR DEĞİŞTİ (kanıtla). `lease_not_held` eskiden "kalıcı iş
// hatası" sayılıyordu; ölçüm bunun yanlış olduğunu gösterdi:
//
//   dizüstü evden ofise taşınırken iki kez uyudu (10 + 28 dk), DNS ~55 dk çözmedi
//   → kalp atışı duramadı → kira doldu. 45480 pardus paketi DERLENDİ (bütünlük TAM,
//   696.6 MB), TÜM parçalar R2'ye yüklendi, yalnız son `complete-multipart` 409
//   lease_not_held aldı. Ajan satıra `failed` yazdı. Satır KİLİTLENMEDİ — API'nin
//   "agent lease expired - otomatik recovery" mekanizması onu `queued`'a geri
//   döndürdü. Kayıp, 3 dk derleme + 55 dk yükleme ve partiye düşen sahte hata.
//
// İki ayrı gerekçe aynı yeri gösteriyor:
//  1. Kira artık bizde DEĞİL — o satıra sonuç yazmak, sahibi olmadığımız bir kaydı
//     ezmektir (başka bir ajan onu çoktan almış olabilir).
//  2. Paketin kendisinde kusur YOK; engel geçiciydi (uyku/ağ). Kalıcı işaretlemek
//     sağlam bir işi sahte başarısızlık olarak raporlar.
// Doğru davranış diğer geçici hatalarla aynı: `failed` yazma, satır kira dolunca
// normal claim akışıyla yeniden dağıtılsın.
test('isTransientNetworkError: lease_not_held GEÇİCİ sayılır (uyku kirayı yakar, paket sağlam)', () => {
  assert.equal(isTransientNetworkError(new Error('lease_not_held')), true);
  assert.equal(
    isTransientNetworkError(new Error(
      'complete-multipart failed: HTTP 409 {"error":"lease_not_held","message":"Agent does not hold a lease for this job"}',
    )),
    true,
  );
});

// --- srcVersionTuret ---------------------------------------------------------
// 2026-09-13 ölçülmüş kusur: kaynak cache dizin adı (`<cacheRoot>/<bookId>/<srcVersion>/
// build.zip`) presigned R2/S3 URL'lerinde sorgu dizesinin TAMAMINDAN türüyordu (imza/
// tarih/süre dahil) — her presign'de değiştiği için cache asla HIT olmuyordu. Gerçek
// bozuk dizin adları: `45449/X-Amz-Algorithm_AWS4-HMAC-SHA256_X-Amz-Content-Sha256_...`.

test('srcVersionTuret: presigned R2/S3 URL -> imzasız, kararlı yol-sonu adı', () => {
  const url = 'https://acct.r2.cloudflarestorage.com/kitaplar/45449/English-Up-6-v47.exe'
    + '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD'
    + '&X-Amz-Credential=AKIAEXAMPLE%2F20260913%2Fauto%2Fs3%2Faws4_request'
    + '&X-Amz-Date=20260913T101500Z&X-Amz-Expires=3600'
    + '&X-Amz-Signature=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    + '&X-Amz-SignedHeaders=host';
  const ad = srcVersionTuret(url);
  assert.equal(ad, 'English-Up-6-v47.exe');
  assert.ok(!/X-Amz|Algorithm|Signature|Credential/i.test(ad), 'sorgu/imza sızmamalı');
});

test('srcVersionTuret: aynı URL iki kez cagrilinca aynı adı verir (saf fonksiyon)', () => {
  const url = 'https://x.example.com/a/b/c/45472/build.exe?X-Amz-Signature=abc123&X-Amz-Date=1';
  assert.equal(srcVersionTuret(url), srcVersionTuret(url));
});

test('srcVersionTuret: KÖK NEDENİN TA KENDİSİ — farklı imza + aynı yol -> AYNI ad', () => {
  // İki "ayrı" presign (farklı imza/tarih/süre) ama aynı R2 nesnesi (aynı yol).
  // Eski kod bu ikisi için FARKLI dizin üretiyordu (cache MISS garantisi) — bu test
  // o mutasyonu (sorgu dizesinin ada karışması) çiviler.
  const yol = 'https://acct.r2.cloudflarestorage.com/kitaplar/45496/SM3v10.exe';
  const url1 = `${yol}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260913T090000Z`
    + '&X-Amz-Expires=3600&X-Amz-Signature=1111111111111111111111111111111111111111'
    + '&X-Amz-SignedHeaders=host&X-Amz-Credential=AKIA1%2F20260913%2Fauto%2Fs3%2Faws4_request';
  const url2 = `${yol}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260913T113000Z`
    + '&X-Amz-Expires=900&X-Amz-Signature=2222222222222222222222222222222222222222'
    + '&X-Amz-SignedHeaders=host&X-Amz-Credential=AKIA2%2F20260913%2Fauto%2Fs3%2Faws4_request';
  assert.notEqual(url1, url2); // önce test kendi kendini kontrol etsin: girdiler gerçekten farklı
  assert.equal(srcVersionTuret(url1), srcVersionTuret(url2));
  assert.equal(srcVersionTuret(url1), 'SM3v10.exe');
});

test('srcVersionTuret: normal (sorgusuz) dosya adı DEĞİŞMEDEN korunur (geriye dönük HIT)', () => {
  assert.equal(
    srcVersionTuret('https://cdn.example.com/uploads/English-Up-6-v47.exe'),
    'English-Up-6-v47.exe',
  );
  assert.equal(
    srcVersionTuret('https://cdn.example.com/dl/SM2v10.exe'),
    'SM2v10.exe',
  );
});

test('srcVersionTuret: yol yoksa deterministik sha1 yedek üretir (imza içermez)', () => {
  const ad1 = srcVersionTuret('?X-Amz-Signature=abcabcabcabcabcabcabcabcabcabcabcabcabc');
  const ad2 = srcVersionTuret('?X-Amz-Signature=abcabcabcabcabcabcabcabcabcabcabcabcabc');
  assert.match(ad1, /^src-[a-f0-9]{16}$/);
  assert.equal(ad1, ad2); // deterministik
  assert.ok(!/Signature|Amz/i.test(ad1));
});

test('srcVersionTuret: yalnız noktalama (anlamsız) yol parçası -> sha1 yedek', () => {
  const ad = srcVersionTuret('https://cdn.example.com/kitaplar/45551/...');
  assert.match(ad, /^src-[a-f0-9]{16}$/);
});

test('srcVersionTuret: güvensiz karakterler dizin adı için temizlenir', () => {
  const ad = srcVersionTuret('https://cdn.example.com/dl/Kitap Adı (v2)!.exe');
  assert.equal(ad, 'Kitap_Ad___v2__.exe');
  assert.doesNotMatch(ad, /[ ()!]/);
});

test('srcVersionTuret: maxLen sinirini uygular (varsayilan 80)', () => {
  const uzunAd = 'a'.repeat(200) + '.exe';
  const ad = srcVersionTuret(`https://cdn.example.com/dl/${uzunAd}`);
  assert.equal(ad.length, 80);
});

test('srcVersionTuret: bos/eksik downloadUrl -> firlatmaz, deterministik yedek doner', () => {
  assert.equal(srcVersionTuret(''), srcVersionTuret(''));
  assert.match(srcVersionTuret(''), /^src-[a-f0-9]{16}$/);
  assert.equal(srcVersionTuret(undefined), srcVersionTuret(null));
});

// ---------------------------------------------------------------------------
// agHatasiOzeti — heartbeat/log kaynağı boş .message kusurunun (2026-09-13 ölçüm:
// 3930 heartbeat hatasının %52,4'ü boş mesajlıydı) düzeltmesi.
// ---------------------------------------------------------------------------

test('agHatasiOzeti: bos mesajli AggregateError -> alt hata kodlarinin HER IKISI de gecer', () => {
  const err = Object.assign(new Error(''), {
    name: 'AggregateError',
    errors: [{ code: 'ECONNREFUSED' }, { code: 'ENETUNREACH' }],
  });
  const ozet = agHatasiOzeti(err);
  // Bu iddia "sadece e.message dön" mutasyonunda KIRILMALI: e.message === '' olduğu için
  // öyle bir mutasyon boş string döner.
  assert.notEqual(ozet, '');
  assert.match(ozet, /ECONNREFUSED/);
  assert.match(ozet, /ENETUNREACH/);
  assert.equal(ozet, 'AggregateError: ECONNREFUSED, ENETUNREACH');
});

test('agHatasiOzeti: AggregateError alt hatalari benzersizlestirilir (tekrar eden kod tek gecer)', () => {
  const err = Object.assign(new Error(''), {
    errors: [{ code: 'ETIMEDOUT' }, { code: 'ETIMEDOUT' }, { message: 'ETIMEDOUT' }],
  });
  const ozet = agHatasiOzeti(err);
  const adet = ozet.split('ETIMEDOUT').length - 1;
  assert.equal(adet, 1);
});

test('agHatasiOzeti: bos mesaj + err.code -> code kullanilir', () => {
  const err = Object.assign(new Error(''), { code: 'ENOTFOUND' });
  assert.equal(agHatasiOzeti(err), 'ENOTFOUND');
});

test('agHatasiOzeti: normal mesajli hata -> mesaj aynen korunur', () => {
  const err = new Error('presign failed: HTTP 500 {"error":"internal"}');
  assert.equal(agHatasiOzeti(err), 'presign failed: HTTP 500 {"error":"internal"}');
});

test('agHatasiOzeti: err.message yok/bos ama err.cause.code var -> cause.code okunur', () => {
  const err = new Error('');
  err.cause = { code: 'ETIMEDOUT' };
  assert.equal(agHatasiOzeti(err), 'ETIMEDOUT');
});

test('agHatasiOzeti: err.cause.errors dizisinden de AggregateError alt hatalari okunur', () => {
  const err = new Error('');
  err.cause = { errors: [{ code: 'EHOSTUNREACH' }, { code: 'ENETUNREACH' }] };
  const ozet = agHatasiOzeti(err);
  assert.match(ozet, /EHOSTUNREACH/);
  assert.match(ozet, /ENETUNREACH/);
});

test('agHatasiOzeti: hicbir alan yoksa bilinmeyen hata doner', () => {
  assert.equal(agHatasiOzeti(new Error()), 'bilinmeyen hata');
  assert.equal(agHatasiOzeti({}), 'bilinmeyen hata');
});

test('agHatasiOzeti: string girdi kendisini kullanir', () => {
  assert.equal(agHatasiOzeti('ham hata metni'), 'ham hata metni');
});

test('agHatasiOzeti: bos string / null / undefined -> bilinmeyen hata', () => {
  assert.equal(agHatasiOzeti(''), 'bilinmeyen hata');
  assert.equal(agHatasiOzeti('   '), 'bilinmeyen hata');
  assert.equal(agHatasiOzeti(null), 'bilinmeyen hata');
  assert.equal(agHatasiOzeti(undefined), 'bilinmeyen hata');
});

test('agHatasiOzeti: cok satirli mesaj tek satira cevrilir', () => {
  const err = new Error('satir1\nsatir2\r\nsatir3\tsekmeli');
  const ozet = agHatasiOzeti(err);
  assert.doesNotMatch(ozet, /[\n\r]/);
  assert.equal(ozet, 'satir1 satir2 satir3 sekmeli');
});

test('agHatasiOzeti: cok uzun mesaj varsayilan 200 karaktere kirpilir', () => {
  const err = new Error('x'.repeat(500));
  const ozet = agHatasiOzeti(err);
  assert.equal(ozet.length, 200);
  assert.ok(ozet.endsWith('…'));
});

test('agHatasiOzeti: maxLen parametresi ile kirpma sinirini ozellestirir', () => {
  const err = new Error('y'.repeat(50));
  const ozet = agHatasiOzeti(err, 10);
  assert.equal(ozet.length, 10);
});

// --- NOTER KAPISI sınıflandırıcısı (2026-09-26, Şef ölçümü) ---
{
  const H = require('./runner-helpers');
  test('noterHatasiErtelenebilirMi: anahtarlık/ağ/zaman aşımı/5xx/CloudKit GEÇİCİ; Invalid/imza KALICI', () => {
    for (const m of [
      'Error: No Keychain password item found for profile: empp-notary',
      'security: SecKeychainSearchCopyNext: User interaction is not allowed.',
      'Error: The Internet connection appears to be offline.',
      'Error Domain=NSURLErrorDomain Code=-1001 "The request timed out."',
      'Error: HTTP status code: 503. Service Unavailable',
      'The timestamp service is not available.',
      'CloudKit query for x.dmg failed due to "Record not found".',
    ]) assert.equal(H.noterHatasiErtelenebilirMi(m), true, m);
    for (const m of [
      '  status: Invalid',
      '  status: Rejected',
      'x.dmg: The specified item could not be signed',
      'Error: HTTP status code: 401. Invalid credentials. Username or password is incorrect.',
      '',
    ]) assert.equal(H.noterHatasiErtelenebilirMi(m), false, m);
  });

  test('noterHatasiErtelenebilirMi: Apple reddi geçici işarete BASKIN (Invalid + timeout → kalıcı)', () => {
    assert.equal(H.noterHatasiErtelenebilirMi('request timed out\n  status: Invalid'), false);
  });

  test('noterIlkSatir: "Conducting pre-submission…" değil ilk HATA satırı seçilir', () => {
    const metin = 'Conducting pre-submission checks for artifact.dmg and initiating connection to the Apple notary service...\n'
      + 'Error: No Keychain password item found for profile: empp-notary\n';
    assert.equal(H.noterIlkSatir(metin), 'Error: No Keychain password item found for profile: empp-notary');
    assert.equal(H.noterIlkSatir('tek satır\nikinci'), 'tek satır');
    assert.equal(H.noterIlkSatir(''), '');
  });

  test('noterHatasi: metin biçimi + ertelenebilir işaret ana döngü sınıfına bağlanır', () => {
    const e = H.noterHatasi('notarytool', { code: 69, stdout: 'Conducting…\n', stderr: 'Error: No Keychain password item found for profile: empp-notary' });
    assert.match(e.message, /^noter onayı alınamadı — DMG yüklenmedi: Error: No Keychain password item found for profile: empp-notary \(notarytool, rc=69\) \[ertelenebilir-noter\]$/);
    assert.equal(H.ertelenebilirKaynakHatasi(e), true);
    const k = H.noterHatasi('notarytool', { code: 0, stdout: '  status: Invalid', stderr: '' });
    assert.equal(H.ertelenebilirKaynakHatasi(k), false);
    assert.ok(!k.message.includes(H.NOTER_KAPISI_ISARETI));
    assert.match(H.noterHatasi('stapler', { code: 65, stdout: '', stderr: '' }).message, /\(çıktı boş, rc=65\)/);
  });
}
