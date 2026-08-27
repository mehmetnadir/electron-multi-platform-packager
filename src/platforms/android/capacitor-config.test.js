'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
test('capacitor config: CapacitorHttp açık (yayıncı API CORS vermiyor — aktivasyon engelleniyordu, 2026-08-27)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../packaging/packagingService.js'), 'utf8');
  assert.ok(/plugins: \{ CapacitorHttp: \{ enabled: true \} \}/.test(src));
  assert.ok(/androidScheme: 'https'/.test(src));
});
