'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mapPlatform,
  backoffMs,
  parseNextJob,
  isTerminalStatus,
  packageStatusOf,
  artifactExtension,
  joinUrl,
} = require('./runner-helpers');

test('mapPlatform: android -> android', () => {
  assert.equal(mapPlatform('android'), 'android');
  assert.equal(mapPlatform('ANDROID'), 'android');
  assert.equal(mapPlatform(' android '), 'android');
});

test('mapPlatform: macos/mac -> macos', () => {
  assert.equal(mapPlatform('macos'), 'macos');
  assert.equal(mapPlatform('mac'), 'macos');
  assert.equal(mapPlatform('MacOS'), 'macos');
});

test('mapPlatform: unsupported -> null', () => {
  assert.equal(mapPlatform('windows'), null);
  assert.equal(mapPlatform('linux'), null);
  assert.equal(mapPlatform('pardus'), null);
  assert.equal(mapPlatform(''), null);
  assert.equal(mapPlatform(undefined), null);
});

test('backoffMs: exponential, 0-based', () => {
  assert.equal(backoffMs(0, 1000, 30000), 1000);
  assert.equal(backoffMs(1, 1000, 30000), 2000);
  assert.equal(backoffMs(2, 1000, 30000), 4000);
  assert.equal(backoffMs(3, 1000, 30000), 8000);
});

test('backoffMs: capped at maxMs', () => {
  assert.equal(backoffMs(10, 1000, 30000), 30000);
  assert.equal(backoffMs(100, 1000, 30000), 30000);
});

test('backoffMs: negative/NaN attempt treated as 0', () => {
  assert.equal(backoffMs(-5, 1000, 30000), 1000);
  assert.equal(backoffMs(NaN, 1000, 30000), 1000);
});

test('parseNextJob: 204 -> null (no work)', () => {
  assert.equal(parseNextJob(204, undefined), null);
  assert.equal(parseNextJob(204, null), null);
});

test('parseNextJob: 200 with { job } -> normalized', () => {
  const job = parseNextJob(200, {
    job: { bookId: 12345, platform: 'android', downloadUrl: 'https://x/y.exe', buildMethod: 'build', bookTitle: 'T' },
  });
  assert.deepEqual(job, {
    bookId: '12345',
    platform: 'android',
    downloadUrl: 'https://x/y.exe',
    buildMethod: 'build',
    bookTitle: 'T',
  });
});

test('parseNextJob: 200 bare object (defensive) -> normalized', () => {
  const job = parseNextJob(200, { bookId: 'b1', platform: 'macos', downloadUrl: 'https://x/y.exe' });
  assert.equal(job.bookId, 'b1');
  assert.equal(job.platform, 'macos');
  assert.equal(job.buildMethod, undefined);
});

test('parseNextJob: missing required field -> null', () => {
  assert.equal(parseNextJob(200, { job: { bookId: 'b1', platform: 'android' } }), null); // no downloadUrl
  assert.equal(parseNextJob(200, { job: { platform: 'android', downloadUrl: 'u' } }), null); // no bookId
  assert.equal(parseNextJob(200, {}), null);
  assert.equal(parseNextJob(200, null), null);
});

test('parseNextJob: non-200/204 status -> null', () => {
  assert.equal(parseNextJob(500, { job: { bookId: 'b1', platform: 'android', downloadUrl: 'u' } }), null);
});

test('isTerminalStatus', () => {
  assert.equal(isTerminalStatus('completed'), true);
  assert.equal(isTerminalStatus('failed'), true);
  assert.equal(isTerminalStatus('COMPLETED'), true);
  assert.equal(isTerminalStatus('processing'), false);
  assert.equal(isTerminalStatus('queued'), false);
  assert.equal(isTerminalStatus('ready'), false);
  assert.equal(isTerminalStatus(''), false);
});

test('packageStatusOf: extracts job.status', () => {
  assert.equal(packageStatusOf({ success: true, jobId: 'j', job: { status: 'processing', progress: 40 } }), 'processing');
  assert.equal(packageStatusOf({ job: { status: 'COMPLETED' } }), 'completed');
  assert.equal(packageStatusOf({ job: null }), '');
  assert.equal(packageStatusOf(null), '');
  assert.equal(packageStatusOf({}), '');
});

test('artifactExtension', () => {
  assert.equal(artifactExtension('android'), '.apk');
  assert.equal(artifactExtension('macos'), '.dmg');
  assert.equal(artifactExtension('windows'), '');
});

test('joinUrl: single slash', () => {
  assert.equal(joinUrl('https://api/v1', 'agents/x'), 'https://api/v1/agents/x');
  assert.equal(joinUrl('https://api/v1/', '/agents/x'), 'https://api/v1/agents/x');
});
