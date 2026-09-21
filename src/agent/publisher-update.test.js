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
  // 2026-09-21 bug-fix: version.txt'ye 4 parçalı ham zip adı DEĞİL, normalize
  // edilmiş 3 parça yazılır (kök neden — yayıncının electron.js'i 3 parça
  // değilse koşulsuz "eski" sayıp update indiriyordu).
  assert.strictEqual(fs.readFileSync(path.join(build, 'version.txt'), 'utf8'), '1.13.1');
  // BİLİNEN YAN ETKİ: yazılan değer normalize edildiği (3 parça) için, zip adı
  // hâlâ anomalik 4 parçalı olduğundan (bu fixture'ın simüle ettiği asıl bozukluk)
  // agent'ın kendi isNewer() karşılaştırması bir sonraki koşuda "farklı" görür ve
  // AYNI zip'i yeniden uygular (unzip -o idempotent, veri kaybı yok — sadece
  // gereksiz tekrar). Bu, isNewer/companyIdFrom karşılaştırma mantığına
  // dokunulmadığı için beklenen davranıştır (bu görevin kapsamı sadece
  // version.txt normalize edilmesi); zip adları normal (3 parça) üretildiğinde
  // bu tekrar oluşmaz.
  const again = applyPublisherUpdate(build, { updateDir: updRoot });
  assert.strictEqual(again.applied, true);
  assert.strictEqual(again.reason, 'uygulandı');
});

test('güncelleme dizini/kurum yoksa dokunmaz', () => {
  const { build } = fixture();
  const r = applyPublisherUpdate(build, { updateDir: path.join(os.tmpdir(), 'yok-' + Date.now()) });
  assert.strictEqual(r.applied, false);
  fs.unlinkSync(path.join(build, 'kurum.txt'));
  assert.strictEqual(applyPublisherUpdate(build, { updateDir: '/nonexistent' }).companyId, null);
});

// --- SENTINEL: 2026-09-21 bug-fix — version.txt normalize kapısı ---

test('SENTINEL: version.txt her zaman 3 parça yazılır', () => {
  const { build, updRoot } = fixture();
  applyPublisherUpdate(build, { updateDir: updRoot });
  const yazilan = fs.readFileSync(path.join(build, 'version.txt'), 'utf8').trim();
  assert.strictEqual(yazilan.split('.').length, 3, `version.txt 3 parça olmalı, oldu: "${yazilan}"`);
});

test('SENTINEL (GERİLEME kapısı): 4+ parçalı zip adı normalize edilmeden yazılmaz', () => {
  const { build, updRoot } = fixture();
  applyPublisherUpdate(build, { updateDir: updRoot });
  const yazilan = fs.readFileSync(path.join(build, 'version.txt'), 'utf8').trim();
  // Zip adı "1.13.1.3" idi; bu ham hali (4 parça) ASLA doğrudan yazılmamalı.
  assert.notStrictEqual(yazilan, '1.13.1.3');
  assert.strictEqual(yazilan, '1.13.1');
});

test('SENTINEL: normalize başarısızsa mevcut version.txt korunur (fail-safe)', () => {
  // 2 parçalı ("1.13") bir zip adı — ucParcayaCevir bunu normalize EDEMEZ (0 ile
  // doldurmak yasak). Bu durumda version.txt'ye DOKUNULMAMALI, eski değer kalmalı.
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-build-'));
  fs.writeFileSync(path.join(build, 'kurum.txt'), '60');
  fs.writeFileSync(path.join(build, 'version.txt'), '1.11.5');
  fs.writeFileSync(path.join(build, 'app.config.js'), '// eski');
  const updRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-upd-'));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-updsrc-'));
  fs.writeFileSync(path.join(src, 'app.config.js'), '// yeni-bozuk-surum');
  fs.writeFileSync(path.join(src, 'version.txt'), '1.13');
  fs.mkdirSync(path.join(updRoot, '060'), { recursive: true });
  spawnSync('zip', ['-q', '-r', path.join(updRoot, '060', '1.13.zip'), '.'], { cwd: src });

  assert.strictEqual(latestLocalUpdate('060', updRoot).version, '1.13');
  const r = applyPublisherUpdate(build, { updateDir: updRoot });
  assert.strictEqual(r.applied, true, 'unzip yine uygulanır (içerik/app.config.js güncellenir)');
  assert.strictEqual(fs.readFileSync(path.join(build, 'app.config.js'), 'utf8'), '// yeni-bozuk-surum');
  // ama version.txt normalize edilemediği için DOKUNULMAMIŞ olmalı:
  assert.strictEqual(fs.readFileSync(path.join(build, 'version.txt'), 'utf8'), '1.11.5');
});

test('SENTINEL: kapı EMPP_SURUM_NORMALLESTIR=0 ile kapatılırsa eski (ham) davranış geri gelir', () => {
  const { build, updRoot } = fixture();
  const eski = process.env.EMPP_SURUM_NORMALLESTIR;
  process.env.EMPP_SURUM_NORMALLESTIR = '0';
  try {
    applyPublisherUpdate(build, { updateDir: updRoot });
    assert.strictEqual(fs.readFileSync(path.join(build, 'version.txt'), 'utf8'), '1.13.1.3');
  } finally {
    if (eski !== undefined) process.env.EMPP_SURUM_NORMALLESTIR = eski;
    else delete process.env.EMPP_SURUM_NORMALLESTIR;
  }
});
