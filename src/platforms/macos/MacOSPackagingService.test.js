'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * macOS imza sözleşmesi (2026-08-26). Üretilen .app ad-hoc imzalıydı; Gatekeeper
 * "no usable signature" ile reddediyordu. Bu sentineller config'in Developer ID
 * kimliği + hardened runtime + entitlements ile kurulduğunu garanti eder.
 */
const SRC = fs.readFileSync(path.join(__dirname, 'MacOSPackagingService.js'), 'utf8');

test('kimlik env\'den alınıyor, hardenedRuntime açık, entitlements bağlı', () => {
  assert.match(SRC, /identity: process\.env\.APPLE_SIGN_IDENTITY/);
  assert.match(SRC, /hardenedRuntime: true/);
  assert.match(SRC, /entitlements: path\.resolve\(__dirname, 'resources\/entitlements\.mac\.plist'\)/);
  assert.match(SRC, /entitlementsInherit: /);
});

test('electron-builder notarize etmiyor (ajan notarytool ile yapar)', () => {
  assert.match(SRC, /notarize: false/);
});

test('kimlik yoksa uyarı loglanıyor (sessiz ad-hoc yok)', () => {
  assert.match(SRC, /APPLE_SIGN_IDENTITY yok — \.app ad-hoc imzalanacak/);
});

test('entitlements plist var ve Electron için gereken hakları içeriyor', () => {
  const p = path.join(__dirname, 'resources/entitlements.mac.plist');
  assert.ok(fs.existsSync(p), 'build/entitlements.mac.plist yok');
  const x = fs.readFileSync(p, 'utf8');
  for (const k of ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory', 'com.apple.security.cs.disable-library-validation']) {
    assert.ok(x.includes(k), k + ' eksik');
  }
});
