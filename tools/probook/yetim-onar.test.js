'use strict';
// yetim-onar.sh — açılışta yetim kabul gizlemesini ve yetim iş dizinlerini onarır. Gerçek betik +
// gerçek probook-temizlik.sh, sahte $HOME altında.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BETIK = path.join(__dirname, 'yetim-onar.sh');
const ev = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yetim-onar-'));
const kos = (home, ek = {}) => spawnSync('bash', [BETIK], { encoding: 'utf8', env: { ...process.env, HOME: home, EMPP_SERIT_KOK: path.join(home, 'empp-serit'), KABUL_KILIT: '', ...ek }, timeout: 30000 });
const dizin = (...p) => { fs.mkdirSync(path.join(...p), { recursive: true }); return path.join(...p); };

test('manifestsiz gizli kurulum eski adına döner; yerinde dizin varsa EZİLMEZ', () => {
  const h = ev();
  dizin(h, 'DijiTap', 'DijiTap', 'Shall We 8 Set.kabulgizli-111');
  dizin(h, 'DijiTap', 'alan.com', 'Kitap.kabulgizli-222');
  dizin(h, 'DijiTap', 'alan.com', 'Kitap');
  const r = kos(h);
  assert.equal(r.status, 0);
  assert.ok(fs.existsSync(path.join(h, 'DijiTap', 'DijiTap', 'Shall We 8 Set')));
  assert.match(r.stdout, /geri konuldu: DijiTap\/Shall We 8 Set/);
  assert.ok(fs.existsSync(path.join(h, 'DijiTap', 'alan.com', 'Kitap.kabulgizli-222')), 'çakışmada gizli kopya kalır');
  assert.match(r.stdout, /CAKISMA: alan.com\/Kitap/);
});

test('manifestli yetim: test kurulumu kaldırılır, gizlenen geri konur, manifest biter', () => {
  const h = ev();
  dizin(h, 'DijiTap', 'DijiTap', 'Ogretmen Seti.kabulgizli-333');
  dizin(h, 'DijiTap', 'DijiTap', 'Test Paketi', 'x');
  fs.writeFileSync(path.join(h, '.kabul-333.manifest'), 'GIZLI DijiTap/Ogretmen Seti\nKURULUM DijiTap/Test Paketi\n');
  const r = kos(h, { PROBOOK_TEMIZLIK: path.join(__dirname, '..', 'pardus', 'probook-temizlik.sh') });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(h, 'DijiTap', 'DijiTap', 'Ogretmen Seti')));
  assert.equal(fs.existsSync(path.join(h, 'DijiTap', 'DijiTap', 'Test Paketi')), false);
  assert.equal(fs.existsSync(path.join(h, '.kabul-333.manifest')), false);
  assert.match(r.stdout, /yetim manifest: 333/);
});

test('kabul kilidi tazeyse (süren kabul) kabul tarafına dokunulmaz', () => {
  const h = ev();
  dizin(h, 'DijiTap', 'DijiTap', 'Set.kabulgizli-444');
  const kilit = path.join(h, '.kabul.lock');
  fs.writeFileSync(kilit, 'pid=1 damga=444 kaynak=mac zaman=1\n');
  const r = kos(h, { KABUL_KILIT: kilit });
  assert.equal(r.status, 0);
  assert.ok(fs.existsSync(path.join(h, 'DijiTap', 'DijiTap', 'Set.kabulgizli-444')));
  assert.match(r.stdout, /kabul kilidi taze/);
});

test('yetim iş dizinleri (empp-agent-*, app-*) kaldırılır; başka dosyaya dokunulmaz', () => {
  const h = ev();
  dizin(h, 'empp-serit', 'work', 'empp-agent-abc', 'pardus-out');
  dizin(h, 'empp-serit', 'work', 'app-XYZ');
  dizin(h, 'empp-serit', 'work', 'node-123');
  const r = kos(h);
  assert.equal(r.status, 0);
  assert.deepEqual(fs.readdirSync(path.join(h, 'empp-serit', 'work')), ['node-123']);
  assert.match(r.stdout, /yetim is dizini kaldiriliyor: work\/empp-agent-abc/);
});
