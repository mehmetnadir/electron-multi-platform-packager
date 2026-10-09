'use strict';

/**
 * Android devralma bayrağı (android-durdur.istek) ↔ runner entegrasyonu (2026-10-09).
 * Hat bekçisi kasanın canlı olduğunu duyurmak için ~/.empp-agent/android-durdur.istek bayrağını koyar.
 * Ölçülen: bayrak dosyası varken Mac ajanı guncelYetenekler() çıktısından 'android'i düşürür, yokken korur.
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();

process.env.AGENT_CAPS = 'mac,android';
process.env.AGENT_OFISTE = '1';

const runner = require('./runner.js');
YALITIM.configUygula(runner.CONFIG);

const flagPath = path.join(YALITIM.dir, 'android-durdur.istek');
runner.CONFIG.androidDurdurFlag = flagPath;
runner.CONFIG.caps = ['mac', 'android'];

after(() => YALITIM.temizle());

test('runner: android-durdur.istek bayrağı varken guncelYetenekler android içermez, yokken içerir (09.10)', () => {
  // Bayrak yokken: 'android' var
  if (fs.existsSync(flagPath)) {
    fs.unlinkSync(flagPath);
  }
  const yeteneklerYokken = runner.guncelYetenekler();
  assert.ok(yeteneklerYokken.includes('android'), 'bayrak yokken android yeteneği listede olmalı');

  // Bayrak varken: 'android' yok
  fs.writeFileSync(flagPath, '');
  try {
    const yeteneklerVarken = runner.guncelYetenekler();
    assert.ok(!yeteneklerVarken.includes('android'), 'bayrak varken android yeteneği listeden düşmeli');
  } finally {
    if (fs.existsSync(flagPath)) {
      fs.unlinkSync(flagPath);
    }
  }
});
