'use strict';

/**
 * runner.js Windows uyumu (windows-kasa ajanı, 2026-10-02) — kaynak-sentinel.
 * Windows `route` BSD sözdizimini bilmez: her nabızda kullanım metnini agent.log'a döküyordu (ölçüldü).
 * macOS/Linux dalı (agGecidiKomutu → FortiGate eşleşmesi) AYNEN kalmalı.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
const govde = SRC.slice(SRC.indexOf('function ofisteMi()'), SRC.indexOf('let _dusukVeri'));

test('ofisteMi: win32 dalı route çağrısından ÖNCE ve AGENT_OFISTE ayarından', () => {
  const win = govde.indexOf("process.platform === 'win32'");
  const route = govde.indexOf('agGecidiKomutu()');
  assert.ok(win > 0 && route > win, 'win32 kontrolü route çağrısından önce olmalı');
  assert.match(govde, /ofiste = process\.env\.AGENT_OFISTE === '1';/);
});

test('ofisteMi: macOS/Linux dalı değişmedi (agGecidiKomutu + ofisGw)', () => {
  assert.match(govde, /const \[komut, argv\] = agGecidiKomutu\(\);/);
  assert.match(govde, /agGecidiAyikla\(out\) === CONFIG\.ofisGw/);
});
