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

test('mapPlatform: unsupported -> null', () => {
  assert.equal(mapPlatform('windows'), null);
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

test('parseNextJob: 200 bare object (defensive) -> normalized', () => {
  const job = parseNextJob(200, { bookId: 'b1', platform: 'macos', downloadUrl: 'https://x/y.exe' });
  assert.equal(job.bookId, 'b1');
  assert.equal(job.platform, 'macos');
  assert.equal(job.buildMethod, undefined);
});

test('parseNextJob: missing required field -> null', () => {
  assert.equal(parseNextJob(200, { job: { bookId: 'b1', platform: 'android' } }), null); // no downloadUrl
  assert.equal(parseNextJob(200, { job: { platform: 'android', downloadUrl: 'u' } }), null); // no bookId
  assert.equal(parseNextJob(200, {}), null);
  assert.equal(parseNextJob(200, null), null);
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
  assert.equal(artifactExtension('windows'), '');
});

test('artifactContentType', () => {
  assert.equal(artifactContentType('android'), 'application/vnd.android.package-archive');
  assert.equal(artifactContentType('macos'), 'application/x-apple-diskimage');
  assert.equal(artifactContentType('pardus'), 'application/octet-stream');
  assert.equal(artifactContentType('windows'), 'application/octet-stream'); // bilinmeyen -> güvenli genel tip
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

test('runner: complete-multipart 5xx için yeniden deneme var (sentinel, 2026-08-27)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'runner.js'), 'utf8');
  require('node:assert').ok(/attempt <= 3[\s\S]{0,600}complete-multipart/.test(src), 'complete-multipart 3 deneme döngüsü olmalı');
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

test('agGecidiAyikla: route çıktısından geçit; yoksa null', () => {
  assert.equal(agGecidiAyikla('   route to: default\ndestination: default\n     gateway: 192.168.1.254\n  interface: en0'), '192.168.1.254');
  assert.equal(agGecidiAyikla('route: writing to routing socket: not in table'), null);
  assert.equal(agGecidiAyikla(''), null);
});
