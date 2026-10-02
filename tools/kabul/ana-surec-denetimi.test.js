'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { anaSurecKarari, anaSurecDenetle, derlemeHatasi } = require('./ana-surec-denetimi');

const dosyalar = (d) => (rel) => (Object.prototype.hasOwnProperty.call(d, rel) ? d[rel] : null);
const PJ = JSON.stringify({ name: 'x', main: 'main.js' });
const IYI = "const { app } = require('electron');\napp.whenReady().then(() => {});\n";
// 03.10 yedek main.js şablonu tuzağı: şablon dizgesinde '\n' gerçek satır sonuna dönüşmüş.
const KIRIK = "const s = 'a\nb';\napp.on(;\n";

test('iyi main.js → GEÇTİ', () => {
  const k = anaSurecKarari(dosyalar({ 'package.json': PJ, 'main.js': IYI }));
  assert.equal(k.durum, 'GECTI');
});

test('SyntaxError main.js → RED (mutasyon: kör nokta)', () => {
  const k = anaSurecKarari(dosyalar({ 'package.json': PJ, 'main.js': KIRIK }));
  assert.equal(k.durum, 'RED');
  assert.match(k.sebepler[0], /derlenmiyor.*SyntaxError/);
});

test('main eksik → RED; package.json yok → ATLANDI; android → ATLANDI', () => {
  assert.equal(anaSurecKarari(dosyalar({ 'package.json': PJ })).durum, 'RED');
  assert.equal(anaSurecKarari(dosyalar({})).durum, 'ATLANDI');
  assert.equal(anaSurecKarari(dosyalar({ 'package.json': PJ, 'main.js': KIRIK }), { platform: 'android' }).durum, 'ATLANDI');
});

test('main uzantısız / shebang / bozuk package.json', () => {
  const pj = JSON.stringify({ main: './ana' });
  assert.equal(anaSurecKarari(dosyalar({ 'package.json': pj, 'ana.js': `#!/usr/bin/env node\n${IYI}` })).durum, 'GECTI');
  assert.equal(anaSurecKarari(dosyalar({ 'package.json': '{bozuk' })).durum, 'RED');
});

test('derlemeHatasi: kökte return geçerli (CommonJS sarmalı)', () => {
  assert.equal(derlemeHatasi('return 1;', 'a.js'), null);
});

test('dizin kökünden gerçek dosya', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ana-surec-'));
  fs.writeFileSync(path.join(d, 'package.json'), PJ);
  fs.writeFileSync(path.join(d, 'main.js'), KIRIK);
  assert.equal(anaSurecDenetle(d, false).durum, 'RED');
  fs.writeFileSync(path.join(d, 'main.js'), IYI);
  assert.equal(anaSurecDenetle(d, false).durum, 'GECTI');
});
