'use strict';
/**
 * İmzalı kopyada ikinci kabul (06.10): imzasız kabul GEÇTİ + gövde eşit + Authenticode geçerli → atlanır.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { imzaliKabulGerekliMi } = require('./windows-serit');

const IMZALI = { imzaci: 'İm Park Bilişim', md5: 'x' };

test('imzasız kabul GEÇTİ + imza doğrulandı → ikinci kabul GEREKMEZ', () => {
  assert.equal(imzaliKabulGerekliMi({ kabulImzasiz: 'GECTI', imzali: IMZALI }, {}), false);
});

test('imzasız kabul kaydı yok / KALDI → tam kabul koşar', () => {
  assert.equal(imzaliKabulGerekliMi({ imzali: IMZALI }, {}), true);
  assert.equal(imzaliKabulGerekliMi({ kabulImzasiz: 'KALDI', imzali: IMZALI }, {}), true);
});

test('imza doğrulama kaydı yok → tam kabul koşar', () => {
  assert.equal(imzaliKabulGerekliMi({ kabulImzasiz: 'GECTI' }, {}), true);
  assert.equal(imzaliKabulGerekliMi({ kabulImzasiz: 'GECTI', imzali: {} }, {}), true);
});

test('EMPP_WIN_IMZALI_KABUL=1 → eski davranış (her zaman tam kabul)', () => {
  assert.equal(imzaliKabulGerekliMi({ kabulImzasiz: 'GECTI', imzali: IMZALI }, { EMPP_WIN_IMZALI_KABUL: '1' }), true);
});
