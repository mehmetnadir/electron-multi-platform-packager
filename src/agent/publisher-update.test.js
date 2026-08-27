'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { applyPublisherUpdate, isNewer, latestLocalUpdate, companyIdFrom } = require('./publisher-update');

function fixture() {
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-build-'));
  fs.writeFileSync(path.join(build, 'kurum.txt'), '60\r\n');
  fs.writeFileSync(path.join(build, 'version.txt'), '1.11.5');
  fs.writeFileSync(path.join(build, 'app.config.js'), '// eski');
  fs.writeFileSync(path.join(build, 'old.main.js'), 'old');
  const updRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-upd-'));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-updsrc-'));
  fs.writeFileSync(path.join(src, 'app.config.js'), '// yeni');
  fs.writeFileSync(path.join(src, 'new.main.js'), 'new');
  fs.writeFileSync(path.join(src, 'version.txt'), '1.13.1.3');
  fs.mkdirSync(path.join(updRoot, '060'), { recursive: true });
  for (const v of ['1.12.0', '1.13.1.3']) spawnSync('zip', ['-q', '-r', path.join(updRoot, '060', v + '.zip'), '.'], { cwd: src });
  return { build, updRoot };
}

test('kurum.txt "60" → "060"; sürüm karşılaştırma electron.js ile aynı', () => {
  const { build } = fixture();
  assert.strictEqual(companyIdFrom(build), '060');
  assert.strictEqual(isNewer('1.11.5', '1.12.0'), true);
  assert.strictEqual(isNewer('1.12.0', '1.11.5'), false);
  assert.strictEqual(isNewer('1.11.5', '1.13.1.3'), true, '4 parçalı sürüm → güncelle (yayıncı davranışı)');
  assert.strictEqual(isNewer('1.13.1.3', '1.13.1.3'), false);
});

test('en yeni yerel zip seçilir ve build üstüne uygulanır, version.txt güncellenir', () => {
  const { build, updRoot } = fixture();
  assert.strictEqual(latestLocalUpdate('060', updRoot).version, '1.13.1.3');
  const r = applyPublisherUpdate(build, { updateDir: updRoot });
  assert.deepStrictEqual([r.applied, r.from, r.to], [true, '1.11.5', '1.13.1.3']);
  assert.strictEqual(fs.readFileSync(path.join(build, 'app.config.js'), 'utf8'), '// yeni');
  assert.ok(fs.existsSync(path.join(build, 'new.main.js')) && fs.existsSync(path.join(build, 'old.main.js')));
  assert.strictEqual(fs.readFileSync(path.join(build, 'version.txt'), 'utf8'), '1.13.1.3');
  const again = applyPublisherUpdate(build, { updateDir: updRoot });
  assert.strictEqual(again.applied, false); assert.strictEqual(again.reason, 'zaten güncel');
});

test('güncelleme dizini/kurum yoksa dokunmaz', () => {
  const { build } = fixture();
  const r = applyPublisherUpdate(build, { updateDir: path.join(os.tmpdir(), 'yok-' + Date.now()) });
  assert.strictEqual(r.applied, false);
  fs.unlinkSync(path.join(build, 'kurum.txt'));
  assert.strictEqual(applyPublisherUpdate(build, { updateDir: '/nonexistent' }).companyId, null);
});
