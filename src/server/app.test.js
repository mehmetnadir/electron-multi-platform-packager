'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Kaynak-sentinel testleri. app.js electron/express/socket.io yükler; server'ı
 * ayağa kaldırmadan sözleşmeyi kilitleriz. Korunan hata: agent modunda paketleyici
 * output klasörünü silmiyordu → ~/.electron-packager-tool/config/output 98 GB'a
 * şişti (2026-08-30). Kök neden: `delete-job` outputPath'i yalnız body'den okuyordu,
 * ajan body göndermiyordu; backstop olmadığı için restart'ta job kaydı uçunca kalıcı sızıntı.
 */
const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

test('delete-job outputPath yoksa job kaydından (packagingJobs) çözer', () => {
  const route = SRC.slice(SRC.indexOf("app.delete('/api/delete-job/:jobId'"),
    SRC.indexOf("app.delete('/api/delete-jobs'"));
  // Body outputPath VEYA job kaydı — ajanın body'siz çağrısı da output'u siler.
  // Kimlikten bağımsız: hem packagingJobs hem queueService (otoriter) denenir.
  assert.match(route, /packagingJobs\.get\(jobId\)/);
  assert.match(route, /queueService\.getPackagingStatus\(jobId\)/);
  assert.match(route, /bodyOutputPath \|\| jobOutputPath/);
  assert.match(route, /safeRemoveOutputDir\(bodyOutputPath \|\| jobOutputPath\)/);
});

test('sweepStaleOutputs: yaş-tabanlı (mtime) backstop, TTL env ile ayarlı', () => {
  const fn = SRC.slice(SRC.indexOf('async function sweepStaleOutputs'),
    SRC.indexOf('async function safeRemoveOutputDir'));
  assert.match(fn, /getOutputDir\(\)/);            // yalnız yapılandırılmış output dizini
  assert.match(fn, /mtimeMs >= cutoff/);           // atime değil mtime (2026-08-18 dersi)
  assert.match(fn, /OUTPUT_TTL_HOURS/);            // eşik parametrik
  assert.match(fn, /fs\.remove\(dir\)/);
  // Başlangıçta + saatlik tetiklenir (tek seferlik değil).
  assert.match(SRC, /sweepStaleOutputs\(\);\s*\n\s*setInterval\(sweepStaleOutputs/);
});

test('OUTPUT_TTL_HOURS varsayılan 72s (R2 yüklemesi dakikalar — geniş güven payı)', () => {
  assert.match(SRC, /OUTPUT_TTL_HOURS\s*=\s*Number\(process\.env\.OUTPUT_TTL_HOURS\s*\|\|\s*72\)/);
});
