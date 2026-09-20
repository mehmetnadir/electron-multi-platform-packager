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
  const routeBody = src.slice(routeStart, routeStart + 400);
  assert.match(routeBody, /commit:\s*GIT_COMMIT/, 'health JSON commit alanı içermeli');
  assert.match(routeBody, /startedAt:\s*STARTED_AT/, 'health JSON startedAt alanı içermeli');
  assert.match(src, /require\(['"]\.\/git-commit['"]\)/, 'app.js getGitCommit yardımcısını kullanmalı (kopya kod yazma)');
});
