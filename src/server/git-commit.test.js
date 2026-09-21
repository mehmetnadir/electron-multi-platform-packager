'use strict';
// K13 (2026-09-09) — getGitCommit() + /api/health'e commit/startedAt eklenmesi.
// Bu depo GERÇEK bir git repo olduğu için burada gerçek `git rev-parse` ile
// çalıştırılır (mock yok) — asıl kanıt gerçek komutun gerçek bir kısa hash
// döndürmesidir, bu depoda çalışan `git`e bağımlı sahte bir stub değil.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const { getGitCommit } = require('./git-commit');

const REPO_ROOT = path.join(__dirname, '..', '..');

test('getGitCommit: gerçek repoda kısa hash döner (git rev-parse --short HEAD ile aynı)', () => {
  const expected = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT }).toString().trim();
  const got = getGitCommit(REPO_ROOT);
  assert.strictEqual(got, expected);
  assert.match(got, /^[0-9a-f]{4,}$/, 'kısa hash hex olmalı');
});

test('getGitCommit: git repo OLMAYAN bir dizinde çökmez, "bilinmiyor" döner', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'git-commit-test-'));
  try {
    const got = getGitCommit(tmp);
    assert.strictEqual(got, 'bilinmiyor');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('GERİLEME: getGitCommit var olmayan bir cwd ile fırlatmaz (health endpoint çökmemeli)', () => {
  assert.doesNotThrow(() => {
    const got = getGitCommit(path.join(REPO_ROOT, 'bu-dizin-hic-yok-12345'));
    assert.strictEqual(typeof got, 'string');
  });
});

test('kaynak-sentinel: app.js /api/health commit + startedAt alanlarını döndürür', () => {
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const routeStart = src.indexOf("app.get('/api/health'");
  assert.notStrictEqual(routeStart, -1, '/api/health route bulunmalı');
  // Pencere 400→700: K-saglik-kimligi (2026-09-21) route'a pid/kapilar yorumu +
  // alanları ekledi, commit/startedAt eski pencerenin dışına kaydı.
  const routeBody = src.slice(routeStart, routeStart + 700);
  assert.match(routeBody, /commit:\s*GIT_COMMIT/, 'health JSON commit alanı içermeli');
  assert.match(routeBody, /startedAt:\s*STARTED_AT/, 'health JSON startedAt alanı içermeli');
  assert.match(src, /require\(['"]\.\/git-commit['"]\)/, 'app.js getGitCommit yardımcısını kullanmalı (kopya kod yazma)');
});

// K-saglik-kimligi (2026-09-21, kaçak paketleyici arızası) — sağlık ucu artık pid +
// kapilar (kapı bayraklarının açık/kapalı durumu) da döner. Bu iki sentinel, hem alanın
// VARLIĞINI hem de ham env değerinin DIŞARI TAŞINMADIĞINI (yalnız boolean) kilitler.
test('kaynak-sentinel: app.js /api/health pid + kapilar alanlarını döndürür', () => {
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const routeStart = src.indexOf("app.get('/api/health'");
  assert.notStrictEqual(routeStart, -1, '/api/health route bulunmalı');
  const routeBody = src.slice(routeStart, routeStart + 700);
  assert.match(routeBody, /pid:\s*process\.pid/, 'health JSON pid alanı içermeli');
  assert.match(routeBody, /kapilar:\s*kapilariOku\(process\.env\)/,
    'health JSON kapilar alanını saglik-kimligi.js üzerinden üretmeli (kopya mantık yazma)');
  assert.match(src, /require\(['"]\.\/saglik-kimligi['"]\)/,
    'app.js kapilariOku yardımcısını kullanmalı');
});

test('sentinel: /api/health route ham EMPP_ env değerini DOĞRUDAN basmaz (yalnız boolean)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const routeStart = src.indexOf("app.get('/api/health'");
  const routeEnd = src.indexOf('});', routeStart) + 3;
  const routeBody = src.slice(routeStart, routeEnd);
  // Route'un KENDİSİ hiçbir EMPP_ bayrağını okumamalı — kapı kararı tamamen
  // saglik-kimligi.js'e devredilmiş olmalı (drift/sızıntı riski oradan taşınmasın).
  assert.doesNotMatch(routeBody, /process\.env\.EMPP_/,
    'route ham EMPP_ env değeri okumamalı, kapilariOku() delege etmeli');
});
