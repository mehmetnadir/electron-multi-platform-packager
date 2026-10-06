'use strict';
/**
 * Kapanışta kira bırakma (06.10, 11845 mac): SIGTERM 2 sn'de çıktı, kira 30 dk asılı kaldı ve
 * kur bekleyen Windows satırı da bekledi. Elde iş varsa kapanış kirayı bırakmalı.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { kapanisKirasiBirak } = require('./runner');

const AUTH = { agentId: 'a1', token: 't' };
const JOB = { bookId: '11845', platform: 'mac' };

test('elde iş + kimlik → kira bırakılır, sebep sinyali taşır', async () => {
  const cagri = [];
  const sonuc = await kapanisKirasiBirak('SIGTERM', {
    job: JOB, auth: AUTH, birak: async (a, j, s) => { cagri.push([a, j, s]); return true; },
  });
  assert.equal(sonuc, true);
  assert.equal(cagri.length, 1);
  assert.deepEqual(cagri[0][1], JOB);
  assert.match(cagri[0][2], /SIGTERM/);
});

test('elde iş yok ya da kimlik yok → null (bırakma çağrılmaz)', () => {
  let n = 0;
  const birak = async () => { n += 1; return true; };
  assert.equal(kapanisKirasiBirak('SIGTERM', { job: null, auth: AUTH, birak }), null);
  assert.equal(kapanisKirasiBirak('SIGTERM', { job: JOB, auth: null, birak }), null);
  assert.equal(n, 0);
});

test('bırakma fırlatırsa kapanış düşmez → false', async () => {
  const sonuc = await kapanisKirasiBirak('SIGINT', {
    job: JOB, auth: AUTH, birak: async () => { throw new Error('ağ'); },
  });
  assert.equal(sonuc, false);
});
