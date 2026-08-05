'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Source sentinels for the runner's result-upload flow. The end-to-end path does
 * network + R2 IO (covered by manual e2e), so here we guard that the artifact is
 * delivered via the presigned R2 PUT (Cloudflare-bypass), NOT the old multipart
 * /result upload that 413'd on large (2GB+) APKs.
 */
const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');

test('postResultSuccess presigns then PUTs the artifact straight to R2 (throttled curl)', () => {
  // 1. asks the server for a presigned URL (re-presigned each attempt for reset-retry)
  assert.match(SRC, /agents\/\$\{auth\.agentId\}\/result\/presign/);
  // 2. uploads via curl --upload-file (NOT axios): the gateway resets a big axios PUT
  //    (ECONNRESET); a throttled curl PUT slips under the shaper and retries on reset.
  const fn = SRC.slice(SRC.indexOf('async function postResultSuccess'), SRC.indexOf('async function postResultFailure'));
  assert.match(fn, /run\('curl'/);
  assert.match(fn, /'--upload-file',\s*artifactPath/);      // sets Content-Length; PUT
  assert.match(fn, /'-X',\s*'PUT'/);
  assert.match(fn, /Content-Type: \$\{presigned\.contentType/); // signed header, verbatim
  assert.match(fn, /AGENT_UPLOAD_RATE/);                    // throttle under the reset
  assert.match(fn, /--limit-rate/);
  assert.doesNotMatch(fn, /axios\.put/);                    // axios PUT got ECONNRESET
  // `presigned` MUST be hoisted (let) above the retry loop — the result POST settles
  // the job from presigned.r2ObjectKey/publicUrl; declaring it `const` inside the loop
  // threw "presigned is not defined" AFTER a successful upload.
  assert.match(fn, /let presigned = null;/);
  assert.match(fn, /r2ObjectKey:\s*presigned\.r2ObjectKey/);
});

test('result is settled via JSON body with the returned key/url (Decision A)', () => {
  assert.match(SRC, /status:\s*['"]completed['"]/);
  assert.match(SRC, /r2ObjectKey:\s*presigned\.r2ObjectKey/);
  assert.match(SRC, /publicUrl:\s*presigned\.publicUrl/);
});

test('downloadFile: throttled fresh-fetch + archive-validity retry (inconsistent origin)', () => {
  assert.match(SRC, /run\('curl'/);
  assert.doesNotMatch(SRC, /'-C',\s*'-'/);        // NO resume: append-on-reset oversized the file
  assert.match(SRC, /--retry-all-errors/);
  assert.match(SRC, /--limit-rate/);              // throttle under the gateway reset
  // integrity: retry the WHOLE fetch until a VALID (listable) archive lands
  assert.match(SRC, /run\('7z',\s*\['l'/);
  assert.match(SRC, /Missing volume/);
  assert.match(SRC, /NOT a valid archive/);
});

test('downloadArtifact (LOCAL packager): no throttle, no 7z gate, ZIP64-safe unzip check', () => {
  // The built APK is a multi-GB ZIP64 archive with an APK Signing Block that p7zip's
  // `7z l` mis-parses as invalid — a false negative that looped the download forever.
  // Isolate the local-artifact fetch and assert it does NOT reuse the WAN hardening.
  const fn = SRC.slice(SRC.indexOf('async function downloadArtifact'), SRC.indexOf('async function packagerDownload'));
  assert.match(fn, /run\('curl'/);
  assert.doesNotMatch(fn, /--limit-rate/);        // localhost: no gateway shaper to dodge
  assert.doesNotMatch(fn, /run\('7z'/);           // 7z false-rejects large signed zip64 apks
  assert.match(fn, /\\\.\(apk\|zip\)\$/);          // zip-family only
  assert.match(fn, /run\('unzip',\s*\['-l'/);      // ZIP64-aware validity
  // packagerDownload delegates to the local-artifact path, not downloadFile
  assert.match(SRC, /async function packagerDownload[\s\S]*?downloadArtifact\(/);
});

test('heartbeat reports the in-flight job so the server extends its lease', () => {
  // Without this, a build slower than LEASE_MINUTES loses the lease mid-build.
  assert.match(SRC, /heldJobs:\s*currentJob\s*\?\s*\[currentJob\]\s*:\s*\[\]/);
  assert.match(SRC, /currentJob\s*=\s*\{\s*bookId:\s*job\.bookId,\s*platform:\s*job\.platform\s*\}/);
  assert.match(SRC, /currentJob\s*=\s*null/); // cleared when idle
});

test('source cache: reuse build.zip per (book, version) instead of re-downloading', () => {
  // shared cache root (overridable), keyed by bookId + source filename
  assert.match(SRC, /EMPP_SOURCE_CACHE/);
  assert.match(SRC, /cachedZip/);
  // cache HIT path copies the cached build.zip and SKIPS the download
  assert.match(SRC, /source cache HIT/);
  assert.match(SRC, /cacheHit\s*=\s*true/);
  // download only happens on MISS
  assert.match(SRC, /if\s*\(!cacheHit\)/);
  // populated atomically (tmp + rename)
  assert.match(SRC, /\.rename\(tmp,\s*cachedZip\)/);
});

test('looksLikeRealApk rejects the 45695 fake (web zip named .apk)', () => {
  const { looksLikeRealApk } = require('./runner.js');
  const fake = [
    '  1523  1981-01-01 01:01   webapp/index.html',
    '  9912  1981-01-01 01:01   webapp/js/app.js',
  ].join('\n');
  const verdict = looksLikeRealApk(fake);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.missing, ['AndroidManifest.xml', 'classes.dex']);
});

test('looksLikeRealApk accepts a Gradle-built APK listing', () => {
  const { looksLikeRealApk } = require('./runner.js');
  const real = [
    '  8192284  1981-01-01 01:01   classes.dex',
    '   198080  1981-01-01 01:01   classes2.dex',
    '     6048  1981-01-01 01:01   AndroidManifest.xml',
  ].join('\n');
  assert.equal(looksLikeRealApk(real).ok, true);
});

test('big artifacts go multipart; a stale single PUT never runs after it succeeds', () => {
  const fn = require('fs').readFileSync(require('path').join(__dirname, 'runner.js'), 'utf8');
  // 1.9GB tek parça PUT ~17 dk sürüp gateway resetiyle BAŞTAN başlıyordu (curl 56).
  assert.match(fn, /presign-multipart/);
  assert.match(fn, /complete-multipart/);
  assert.match(fn, /MULTIPART_THRESHOLD/);
  // Çok parçalı başarılıysa tek-parça döngüsü HİÇ çalışmamalı.
  assert.match(fn, /presigned === null && attempt <= MAX/);
});
