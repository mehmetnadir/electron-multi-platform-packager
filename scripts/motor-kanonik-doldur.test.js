'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { surumUret, kanonikKur } = require('./motor-kanonik-doldur');

const T = new Date(2026, 8, 12, 19, 57);

test('surumUret: ilk derleme tarih sürümü alır', () => {
  assert.equal(surumUret(T, 'aaaaaaaaaaaa', null), '2026.9.12');
});

test('surumUret: aynı sha tekrar yazılırsa sürüm DEĞİŞMEZ (idempotent)', () => {
  const onceki = { sha12: 'aaaaaaaaaaaa', surum: '2026.9.12', surumler: {} };
  assert.equal(surumUret(new Date(2026, 8, 30), 'aaaaaaaaaaaa', onceki), '2026.9.12');
});

test('surumUret: aynı gün farklı sha → .N eki (kıyas yönü korunur)', () => {
  const onceki = { sha12: 'aaaaaaaaaaaa', surum: '2026.9.12', surumler: {} };
  assert.equal(surumUret(T, 'bbbbbbbbbbbb', onceki), '2026.9.12.1');
});

test('kanonikKur: önceki kanonik surumler haritasına eklenir', () => {
  const onceki = { sha12: 'aaaaaaaaaaaa', surum: '2026.9.12', surumler: { cccccccccccc: '2026.9.1' } };
  const g = kanonikKur({ sha12: 'bbbbbbbbbbbb', boyut: 1, surum: '2026.9.24', kaynak: 'x', onceki, zaman: 'z' });
  assert.deepEqual(g.surumler, {
    cccccccccccc: '2026.9.1', aaaaaaaaaaaa: '2026.9.12', bbbbbbbbbbbb: '2026.9.24',
  });
  assert.equal(g.sha12, 'bbbbbbbbbbbb');
});
