'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { surecGrubunuOldur } = require('./surec-oldur');

test('darwin: eksi PID ile SIGKILL (süreç grubu), taskkill çağrılmaz', () => {
  const cagri = [];
  const r = surecGrubunuOldur(4242, {
    platform: 'darwin', kill: (p, s) => cagri.push(['kill', p, s]), kos: () => cagri.push(['kos']),
  });
  assert.equal(r, true);
  assert.deepEqual(cagri, [['kill', -4242, 'SIGKILL']]);
});

test('win32: taskkill /PID <pid> /T /F; eksi PID kill HİÇ çağrılmaz (win32\'de fırlatır)', () => {
  const cagri = [];
  const r = surecGrubunuOldur(4242, {
    platform: 'win32',
    kill: () => { throw new Error('win32 eksi pid'); },
    kos: (k, a) => { cagri.push([k, ...a]); return { status: 0 }; },
  });
  assert.equal(r, true);
  assert.deepEqual(cagri, [['taskkill', '/PID', '4242', '/T', '/F']]);
});

test('hedef ölüyse (kill fırlatır / taskkill rc≠0) hata yutulur, false döner', () => {
  assert.equal(surecGrubunuOldur(1, { platform: 'darwin', kill: () => { throw new Error('ESRCH'); } }), false);
  assert.equal(surecGrubunuOldur(1, { platform: 'win32', kos: () => ({ status: 128 }) }), false);
  assert.equal(surecGrubunuOldur(0, { platform: 'win32' }), false);
});
