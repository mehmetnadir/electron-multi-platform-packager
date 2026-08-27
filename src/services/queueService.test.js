'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('queue-empty temizliği tamamlanmış işlerin temp çıktısını korur (sentinel, 2026-08-27)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'queueService.js'), 'utf8');
  assert.ok(!/await fs\.emptyDir\(tempPath\)/.test(src), 'temp toptan boşaltılmamalı — ajan indirmeden çıktı silinir');
  assert.ok(/protectedIds/.test(src) && /job\.status === 'completed'/.test(src));
});
