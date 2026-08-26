'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { macSigningConfig, ENTITLEMENTS } = require('./mac-signing');

test('kimlik varsa Developer ID + hardened runtime + entitlements', () => {
  const c = macSigningConfig({ APPLE_SIGN_IDENTITY: 'Developer ID Application: X (TEAM)' }, { warn() {} });
  assert.strictEqual(c.identity, 'Developer ID Application: X (TEAM)');
  assert.strictEqual(c.hardenedRuntime, true);
  assert.strictEqual(c.entitlements, ENTITLEMENTS);
  assert.strictEqual(c.notarize, false);
  assert.ok(fs.existsSync(ENTITLEMENTS), 'entitlements dosyası repoda olmalı');
});

test('kimlik yoksa ad-hoc (identity:null) + uyarı', () => {
  let warned = '';
  const c = macSigningConfig({}, { warn: (m) => { warned = m; } });
  assert.strictEqual(c.identity, null);
  assert.strictEqual(c.hardenedRuntime, false);
  assert.match(warned, /APPLE_SIGN_IDENTITY/);
});

test('canlı derleme yolu (packagingService) ad-hoc identity:null sabitini taşımıyor', () => {
  // Regresyon 2026-08-26: MacOSPackagingService düzeltildi ama /api/package bu dosyadan
  // geçiyordu; dmg yine ad-hoc çıktı. Sabit `identity: null` bir daha geri gelmesin.
  const src = fs.readFileSync(path.join(__dirname, '../../packaging/packagingService.js'), 'utf8');
  assert.ok(!/^\s*identity:\s*null/m.test(src), 'packagingService.js identity:null içermemeli');
  assert.ok(src.includes('macSigningConfig('), 'packagingService.js macSigningConfig kullanmalı');
});
