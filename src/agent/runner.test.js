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
