'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Kaynak-sentinel: Pardus .impark üretim hattı (2026-09-04 saha onarımı).
 * Üretim pardus'u baştan beri kırıkmış — log'da 0 başarılı .impark. Dört kök neden:
 *   1) appimagetool her seferinde GitHub'dan indiriliyordu → düşünce spawn ENOENT →
 *      job sert çöküyordu. Kurulu /usr/local/bin/appimagetool kullanılmalı.
 *   2) spawn 'error' dinlenmiyordu → Node unhandled-error → status 'undefined'.
 *   3) imparkPath path.join ile GÖRELİ kalıyordu; cwd=outputPath ile mksquashfs
 *      "Could not create destination file" veriyordu → path.resolve şart.
 *   4) .impark results dizisine kaydedilmiyordu → /api/download ?type=impark 404.
 * Dördü de kaynakta kalıcı olsun; biri gerilerse .impark üretilemez.
 */
const SRC = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');

test('1) appimagetool önce sistemde kurulu binary (dış indirmeye bağımlı değil)', () => {
  assert.match(SRC, /appimagetoolPath\s*=\s*'\/usr\/local\/bin\/appimagetool'/);
  // İndirdiysek sil, sistem binary'sine dokunma:
  assert.match(SRC, /if\s*\(appimagetoolDownloaded\)\s*await fs\.remove\(appimagetoolPath\)/);
});

test('2) spawn error dinleyicisi var (unhandled-error/hard-crash önlenir)', () => {
  assert.match(SRC, /pack\.on\('error',\s*err\s*=>\s*reject\(err\)\)/);
});

test('3) imparkPath MUTLAK (path.resolve) — göreli olursa mksquashfs patlar', () => {
  assert.match(SRC, /const imparkPath = path\.resolve\(outputPath, imparkName\)/);
  assert.doesNotMatch(SRC, /const imparkPath = path\.join\(outputPath, imparkName\)/);
});

test('4) .impark results dizisine type:impark ile kaydedilir (download 404 önlenir)', () => {
  assert.match(SRC, /const imparkFile = files\.find\(file => file\.endsWith\('\.impark'\)\)/);
  assert.match(SRC, /type:\s*'impark'/);
});
