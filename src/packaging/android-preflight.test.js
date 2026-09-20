'use strict';
// K14 (2026-09-09, Tudem 13 ISO batch dersi) — bkz. android-preflight.js NEDEN
// bloğu. Mac'te ~/.gradle/gradle.properties yoktu (Gradle varsayılan heap ile
// calisti), buyuk bir kitap Android build'inde OOM verdi. Bu preflight dosyayı
// DEĞİŞTİRMEZ, yalnız açık bir uyarı verir — 3 senaryo (dosya yok / 3g / 8g).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  checkAndroidGradleHeapPreflight,
  parseXmxToGb,
  MIN_RECOMMENDED_XMX_GB,
} = require('./android-preflight');

function fakeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'android-preflight-test-'));
}

function fakeLogger() {
  const warnings = [];
  return { warnings, warn: (msg) => warnings.push(msg), log: () => {} };
}

test('parseXmxToGb: g/m/k birimlerini doğru GB\'a çevirir', () => {
  assert.strictEqual(parseXmxToGb('-Xmx6g'), 6);
  assert.strictEqual(parseXmxToGb('-Xmx3g -XX:MaxMetaspaceSize=512m'), 3);
  assert.strictEqual(parseXmxToGb('-Xmx6144m'), 6);
  assert.strictEqual(parseXmxToGb(''), null);
  assert.strictEqual(parseXmxToGb(null), null);
  assert.strictEqual(parseXmxToGb('-Dsomething=true'), null);
});

test('senaryo 1: ~/.gradle/gradle.properties YOK — uyarır, dosyayı OLUŞTURMAZ', () => {
  const home = fakeHome();
  const logger = fakeLogger();
  const result = checkAndroidGradleHeapPreflight({ homeDir: home, logger });

  assert.strictEqual(result.exists, false);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.warned, true);
  assert.strictEqual(logger.warnings.length, 1);
  assert.match(logger.warnings[0], /YOK/);
  assert.match(logger.warnings[0], new RegExp(`Xmx${MIN_RECOMMENDED_XMX_GB}g`));
  // BOZARSAN kontrolü: dosya hâlâ yok olmalı (paketleyici KENDİ dosya oluşturmaz).
  assert.strictEqual(fs.existsSync(path.join(home, '.gradle', 'gradle.properties')), false);

  fs.rmSync(home, { recursive: true, force: true });
});

test('senaryo 2: Xmx3g (< önerilen 6g) — uyarır', () => {
  const home = fakeHome();
  fs.mkdirSync(path.join(home, '.gradle'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.gradle', 'gradle.properties'),
    'org.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=512m\n'
  );
  const logger = fakeLogger();
  const result = checkAndroidGradleHeapPreflight({ homeDir: home, logger });

  assert.strictEqual(result.exists, true);
  assert.strictEqual(result.xmxGb, 3);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.warned, true);
  assert.strictEqual(logger.warnings.length, 1);
  assert.match(logger.warnings[0], /Xmx3g/);
  assert.match(logger.warnings[0], /AZ/);

  fs.rmSync(home, { recursive: true, force: true });
});

test('senaryo 3: Xmx8g (>= önerilen 6g) — uyarı YOK', () => {
  const home = fakeHome();
  fs.mkdirSync(path.join(home, '.gradle'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.gradle', 'gradle.properties'),
    'org.gradle.jvmargs=-Xmx8g\n'
  );
  const logger = fakeLogger();
  const result = checkAndroidGradleHeapPreflight({ homeDir: home, logger });

  assert.strictEqual(result.exists, true);
  assert.strictEqual(result.xmxGb, 8);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.warned, false);
  assert.strictEqual(logger.warnings.length, 0, 'yeterli heap varken UYARI OLMAMALI');

  fs.rmSync(home, { recursive: true, force: true });
});

test('kaynak-sentinel: runGradleBuild build başlamadan ÖNCE preflight çağırır', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.match(src, /require\(['"]\.\/android-preflight['"]\)/);
  const fnStart = src.indexOf('async runGradleBuild(webAppPath, task)');
  assert.notStrictEqual(fnStart, -1);
  const spawnIdx = src.indexOf("spawn('./gradlew'", fnStart);
  const preflightIdx = src.indexOf('checkAndroidGradleHeapPreflight()', fnStart);
  assert.notStrictEqual(preflightIdx, -1, 'runGradleBuild preflight\'i çağırmalı');
  assert.ok(preflightIdx < spawnIdx, 'preflight gradle spawn\'ından ÖNCE çağrılmalı');
});
