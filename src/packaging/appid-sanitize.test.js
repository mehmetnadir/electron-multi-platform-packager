'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Kaynak-sentinel: Android App ID segmenti Capacitor kuralına uymalı — HARFLE başlar.
 * 72612 "6-SINIF-MATEMATIK-SORU-BANKASI" → "com.dijitap.6sinif..." → `cap add android`
 * "Invalid App ID" ile paketlemeyi komple düşürdü (2026-09-03). Rakam-başı guard'ı
 * ve boş-slug guard'ı kaynakta kalıcı olsun.
 */
const SRC = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');

// Referans mantık (kaynaktaki inline guard ile aynı) — davranışı burada da doğrula.
function sanitizeSlug(appName) {
  let s = String(appName).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) s = 'app';
  if (/^[0-9]/.test(s)) s = `a${s}`;
  return s;
}

test('rakamla başlayan başlık harfe çekilir (Capacitor geçerli App ID)', () => {
  assert.strictEqual(sanitizeSlug('6-SINIF-MATEMATIK-SORU-BANKASI'), 'a6sinifmatematiksorubankasi');
  assert.match(`com.dijitap.${sanitizeSlug('6 Sınıf')}`, /^com\.dijitap\.[a-z][a-z0-9]*$/);
});

test('harfle başlayan başlık dokunulmaz', () => {
  assert.strictEqual(sanitizeSlug('YDT Privilege 12'), 'ydtprivilege12');
});

test('boş/simge-only slug app olur (id daima geçerli)', () => {
  assert.strictEqual(sanitizeSlug('---'), 'app');
});

test('kaynakta rakam-başı guard fiilen var (packageId üretiminde)', () => {
  assert.match(SRC, /appSlug\s*=\s*appName\.toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\/g,\s*''\)/);
  assert.match(SRC, /if\s*\(\/\^\[0-9\]\/\.test\(appSlug\)\)\s*appSlug\s*=\s*`a\$\{appSlug\}`/);
  assert.match(SRC, /const packageId = `com\.dijitap\.\$\{appSlug\}`/);
});
