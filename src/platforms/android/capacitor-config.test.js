'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
test('capacitor config: CapacitorHttp açık (yayıncı API CORS vermiyor — aktivasyon engelleniyordu, 2026-08-27)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../packaging/packagingService.js'), 'utf8');
  assert.ok(/plugins: \{ CapacitorHttp: \{ enabled: true \} \}/.test(src));
  assert.ok(/androidScheme: 'https'/.test(src));
  const alt = fs.readFileSync(path.join(__dirname, 'AndroidPackagingService.js'), 'utf8');
  assert.ok(/plugins: \{ CapacitorHttp: \{ enabled: true \} \}/.test(alt), 'AndroidPackagingService .ts config de CapacitorHttp taşımalı');
  const sr = fs.readFileSync(path.join(__dirname, '../../server/settingsRoutes.js'), 'utf8');
  assert.ok(!/^const \{ dialog \} = require\('electron'\);/m.test(sr), "settingsRoutes 'electron'ı koşulsuz require etmemeli (sunucuda yok)");
});
