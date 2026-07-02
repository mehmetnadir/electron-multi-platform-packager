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

test('postResultSuccess presigns then PUTs the artifact straight to R2', () => {
  // 1. asks the server for a presigned URL
  assert.match(SRC, /agents\/\$\{auth\.agentId\}\/result\/presign/);
  // 2. uploads the file directly to the presigned R2 URL
  assert.match(SRC, /axios\.put\(presigned\.uploadUrl/);
  // 3. Content-Length is sent (R2 presigned PUT rejects chunked transfer)
  assert.match(SRC, /['"]Content-Length['"]:\s*size/);
});

test('result is settled via JSON body with the returned key/url (Decision A)', () => {
  assert.match(SRC, /status:\s*['"]completed['"]/);
  assert.match(SRC, /r2ObjectKey:\s*presigned\.r2ObjectKey/);
  assert.match(SRC, /publicUrl:\s*presigned\.publicUrl/);
});

test('downloadFile: throttled curl + size-verified retry (server serves inconsistent objects)', () => {
  assert.match(SRC, /run\('curl'/);
  assert.match(SRC, /'-C',\s*'-'/);              // resume from disk
  assert.match(SRC, /--retry-all-errors/);        // genuine reset -> resumed retry
  assert.match(SRC, /--limit-rate/);              // throttle under the gateway reset
  // integrity: retry the WHOLE fetch until body size == HEAD content-length
  assert.match(SRC, /content-length:\s*/i);
  assert.match(SRC, /size === expected/);
  assert.match(SRC, /server served a bad object/);
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
