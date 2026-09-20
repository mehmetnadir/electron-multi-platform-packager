'use strict';

/**
 * 2026-09-08 kusuru: paketleyici (src/server/app.js) bir job'ı `status=completed`
 * olarak bitirdi ama platform sonucunda hata vardı (Android: "Gradle build failed:
 * assembleDebug ... Java heap space"). Ajan (runner.js) bunu görmeden artifact
 * indirmeye gitti, curl 404 (exit 22) ile düştü ve DB'ye giden last_error
 * "artifact download failed: curl exit 22 (404 ...)" oldu — gerçek neden hiçbir
 * yere yazılmadı, teşhis 20 dk sürdü.
 *
 * packagerResultOf() bu kararı IO'suz test edilebilir kılar: packagerPoll() artifact
 * indirmeye gitmeden ÖNCE bunu çağırır (bkz. runner.js packagerPoll).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { packagerResultOf, clipPackagerError } = require('./runner-helpers');

// Gerçekçi, uzun (>1500 karakter) Gradle "What went wrong" hatası — 45695/2026-09-08
// sahne örneğine benzer şekilde başlıkla başlar, gövdesi çok satırlıdır.
function gradleHeapError() {
  const filler = 'stack frame detail line that pads the message out to a realistic length\n'.repeat(30);
  return (
    'Android APK üretilemedi: Capacitor build başarısız: Gradle build failed: assembleDebug\n' +
    filler +
    'FAILURE: Build failed with an exception.\n\n' +
    '* What went wrong:\n' +
    'Execution failed for task \':app:assembleDebug\'.\n' +
    '> java.lang.OutOfMemoryError: Java heap space\n' +
    '    at org.gradle.internal.dispatch.ReflectionDispatch.dispatch\n' +
    '    at com.android.build.gradle.tasks.Dex2Task.doTaskAction\n' +
    '    at org.gradle.api.internal.tasks.execution.ExecuteActionsTaskExecuter\n' +
    '* Try:\n> Run with --stacktrace option to get the stack trace.\n' +
    filler
  );
}

test('packagerResultOf (a): platform error var -> failed, mesaj Gradle "What went wrong" bloğunu içeriyor', () => {
  const rawError = gradleHeapError();
  assert.ok(rawError.length > 1500, 'test verisi gerçekçi olsun diye 1500+ karakter olmalı');

  const body = {
    success: true,
    jobId: 'job-1',
    job: {
      status: 'completed', // paketleyici dış try/catch'i fırlatmadı — bug tam burada
      results: {
        android: { success: false, error: rawError },
      },
    },
  };

  const verdict = packagerResultOf(body, 'android');
  assert.equal(verdict.ok, false);
  assert.ok(verdict.message.length <= 1500, 'mesaj 1500 karakteri aşmamalı');
  assert.ok(verdict.message.includes('What went wrong'), 'Gradle "What went wrong" başlığı kaybolmamalı');
  assert.ok(verdict.message.includes('Java heap space'), 'gerçek neden (heap space) korunmalı');
  assert.ok(verdict.message.includes('OutOfMemoryError'), '"What went wrong" sonrası satırlar (en az 6) korunmalı');
});

test('packagerResultOf (b): packages/results boş + error yok -> failed "paket üretilmedi"', () => {
  // job.results hiç yok (platform hiç işlenmemiş gibi) — packages/artifact yok, error da yok.
  const bodyNoResults = { success: true, jobId: 'job-2', job: { status: 'completed' } };
  const v1 = packagerResultOf(bodyNoResults, 'macos');
  assert.equal(v1.ok, false);
  assert.match(v1.message, /paket üretilmedi/);
  assert.match(v1.message, /macos/);

  // job.results[platform] var ama success:false ve error alanı da yok.
  const bodyEmptyResult = {
    success: true,
    jobId: 'job-3',
    job: { status: 'completed', results: { macos: { success: false } } },
  };
  const v2 = packagerResultOf(bodyEmptyResult, 'macos');
  assert.equal(v2.ok, false);
  assert.match(v2.message, /paket üretilmedi/);
});

test('packagerResultOf (c): başarılı sonuç -> indirmeye devam (ok:true)', () => {
  const body = {
    success: true,
    jobId: 'job-4',
    job: {
      status: 'completed',
      results: { android: { success: true, path: '/tmp/output/app.apk' } },
    },
  };
  const verdict = packagerResultOf(body, 'android');
  assert.deepEqual(verdict, { ok: true });
});

test('packagerResultOf: mevcut davranışı bozmaz — farklı platform istenmişse o platforma bakar', () => {
  // Job iki platform içerse de (linux paketleyicide desteklenir) ajan HER ZAMAN
  // tek platform ister; kontrol o platforma özgü olmalı, başka platformun
  // başarısı/başarısızlığı karar etkilememeli.
  const body = {
    job: {
      status: 'completed',
      results: {
        linux: { success: false, error: 'ilgisiz hata' },
        android: { success: true, path: '/tmp/a.apk' },
      },
    },
  };
  assert.deepEqual(packagerResultOf(body, 'android'), { ok: true });
});

test('clipPackagerError: 1500 altı değişmeden kalır', () => {
  const short = 'Android APK üretilemedi: basit hata';
  assert.equal(clipPackagerError(short), short);
});

test('clipPackagerError: marker yoksa düz slice(0,1500)', () => {
  const raw = 'x'.repeat(3000);
  const clipped = clipPackagerError(raw);
  assert.equal(clipped.length, 1500);
  assert.equal(clipped, 'x'.repeat(1500));
});

test('clipPackagerError: marker varsa "What went wrong" + sonraki 6 satır korunur (uzunluk sınırı içinde)', () => {
  const clipped = clipPackagerError(gradleHeapError(), 1500);
  assert.ok(clipped.length <= 1500);
  assert.ok(clipped.includes('What went wrong'));
  assert.ok(clipped.includes('Java heap space'));
});

// ---------------------------------------------------------------------------
// Sentinel: packagerPoll indirmeye gitmeden ÖNCE packagerResultOf'u çağırmalı.
// Kaynağı okuyup pattern'i doğruluyoruz — axios/network mock gerektirmeden
// gerçek kablolamanın (wiring) regresyona uğramadığını kilitler.
// ---------------------------------------------------------------------------
test('runner: packagerPoll, completed durumunda indirmeye gitmeden packagerResultOf ile doğrular (sentinel, 2026-09-08)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'runner.js'), 'utf8');
  const pollFnMatch = src.match(/async function packagerPoll\([\s\S]*?\n}\n/);
  assert.ok(pollFnMatch, 'packagerPoll fonksiyonu bulunamadı');
  const pollFn = pollFnMatch[0];
  assert.ok(pollFn.includes('packagerResultOf('), 'packagerPoll packagerResultOf ile doğrulamalı');
  assert.ok(/packagerResultOf\([\s\S]*?verdict\.ok/.test(pollFn), 'verdict.ok kontrolü olmalı');
  // downloadArtifact/packagerDownload çağrısı packagerPoll İÇİNDE olmamalı — indirme
  // sadece poll tamamlandıktan (ve doğrulandıktan) SONRA, çağıran tarafta yapılır.
  assert.ok(!pollFn.includes('packagerDownload('), 'packagerPoll indirmeye gitmemeli');
});
