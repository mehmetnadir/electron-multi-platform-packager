'use strict';

/**
 * SENTİNEL — postResultSuccess'in artefakt kanıtı (sha256+boyut) akışını R2'ye
 * yükleme öncesi hesapladığını, /result gövdesine koşullu eklediğini ve hesap
 * hatasında yüklemeyi sessizce yutmadan (warn ile) sürdürdüğünü kaynak metninden
 * doğrular. Gerçek hash hesabı `artefakt-kaniti.test.js`de node:crypto'ya karşı
 * ölçülüyor; burada yalnız runner.js'e DOĞRU YERDE, DOĞRU SIRAYLA bağlandığı
 * garanti edilir (network/R2 IO gerektiren tam akış manuel e2e — repo konvansiyonu,
 * bkz. runner.test.js üst yorumu).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
const FN = SRC.slice(SRC.indexOf('async function postResultSuccess'), SRC.indexOf('async function postResultFailure'));

test('runner.js artefakt-kaniti modülünü require eder', () => {
  assert.match(SRC, /require\(['"]\.\/artefakt-kaniti['"]\)/);
});

test('postResultSuccess: sha256 hesabı R2 yüklemesinden (curl PUT) ÖNCE yapılır', () => {
  const hesapIdx = FN.indexOf('artefaktOzeti(artifactPath)');
  const curlIdx = FN.indexOf("run('curl'");
  assert.ok(hesapIdx > -1, 'artefaktOzeti(artifactPath) çağrısı bulunamadı');
  assert.ok(curlIdx > -1, "run('curl' çağrısı bulunamadı");
  assert.ok(hesapIdx < curlIdx, 'hash hesabı upload çağrısından SONRA yapılıyor — sıra yanlış');
});

test('postResultSuccess: hash hesabı try/catch ile korunur — hata FIRLATILMAZ (upload durmaz)', () => {
  const tryIdx = FN.indexOf('try {\n    const oz = await artefaktOzeti');
  assert.ok(tryIdx > -1, 'artefaktOzeti çağrısı try bloğunda değil');
  // catch bloğu boş/silent değil — warn(...) ile loglanır (sessiz yutma yasak)
  const catchSlice = FN.slice(FN.indexOf('} catch (e) {', tryIdx), FN.indexOf('}', FN.indexOf('} catch (e) {', tryIdx) + 20) + 1);
  assert.match(catchSlice, /warn\(/, 'catch bloğu warn(...) çağırmıyor — sessiz yutma');
  assert.doesNotMatch(catchSlice, /^\s*\}\s*catch\s*\(e\)\s*\{\s*\}/, 'catch bloğu boş');
});

test('/result gövdesi kanıt alanlarını KOŞULLU ekler (hesap başarısızsa gönderilmez)', () => {
  assert.match(FN, /\.\.\.\(kanit \|\| \{\}\)/);
  // sabit/koşulsuz `fileSha256:` alanı YOK — yalnız spread üzerinden koşullu eklenir
  assert.doesNotMatch(FN, /fileSha256:\s*oz\.sha256,\n/);
});

test('kanit değişkeni null başlar, upload akışını (presigned/curl) GATE etmez', () => {
  const kanitIdx = FN.indexOf('let kanit = null;');
  const presignedIdx = FN.indexOf('let presigned = null;');
  assert.ok(kanitIdx > -1 && presignedIdx > -1);
  assert.ok(kanitIdx < presignedIdx);
  // ikisi arasında erken `return`/`throw` yok — hash hatası upload'u iptal etmiyor
  const arasi = FN.slice(kanitIdx, presignedIdx);
  assert.doesNotMatch(arasi, /\breturn\b/);
});
