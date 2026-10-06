'use strict';

/** Kapı geçici dizin temizliği — fs taklidiyle; gerçek kasa gerekmez. */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const K = require('./windows-paket-kapisi');

function sahteFs({ rmHata = null, dizinler = {} } = {}) {
  const f = { rmCagri: [], eklenen: [], chmod: [] };
  f.rmSync = (y, o) => { f.rmCagri.push({ y, o }); if (rmHata) throw rmHata; };
  f.appendFileSync = (y, v) => f.eklenen.push({ y, v });
  f.readdirSync = (y, o) => {
    if (o && o.withFileTypes) return [];
    return Object.keys(dizinler);
  };
  f.statSync = (y) => ({ isDirectory: () => true, mtimeMs: dizinler[path.basename(y)] });
  f.chmodSync = (y) => f.chmod.push(y);
  return f;
}
const hata = (kod) => Object.assign(new Error('x'), { code: kod });

test('geciciSil: maxRetries/retryDelay geçer', () => {
  const f = sahteFs();
  const r = K.geciciSil('/t/empp-kapi-a', { fsx: f, tmpKok: '/t' });
  assert.equal(r.ok, true);
  assert.deepEqual(f.rmCagri[0].o,
    { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

test('geciciSil: hata loglanır ve jsonl\'a yazılır, fırlatmaz', () => {
  const f = sahteFs({ rmHata: hata('EBUSY') });
  const log = [];
  const r = K.geciciSil('/t/empp-kapi-a', {
    fsx: f, tmpKok: '/t', yaz: (s) => log.push(s), platform: 'linux' });
  assert.equal(r.ok, false);
  assert.equal(r.kod, 'EBUSY');
  assert.match(log.join('\n'), /EBUSY.*empp-kapi-a/);
  assert.equal(f.eklenen.length, 1);
  assert.equal(f.eklenen[0].y, path.join('/t', '_temizlenemedi.jsonl'));
  const j = JSON.parse(f.eklenen[0].v);
  assert.equal(j.yol, '/t/empp-kapi-a');
  assert.equal(j.kod, 'EBUSY');
});

test('geciciSil: Windows\'ta ilk hatada salt-okunur açıp bir kez daha dener', () => {
  const f = sahteFs({ rmHata: hata('EPERM') });
  K.geciciSil('/t/empp-kapi-a', { fsx: f, tmpKok: '/t', platform: 'win32' });
  assert.equal(f.rmCagri.length, 2);
  const g = sahteFs({ rmHata: hata('EPERM') });
  K.geciciSil('/t/empp-kapi-a', { fsx: g, tmpKok: '/t', platform: 'linux' });
  assert.equal(g.rmCagri.length, 1);
});

test('ön adım: Windows dışında hiçbir şeye dokunmaz', () => {
  const f = sahteFs({ dizinler: { 'empp-kapi-eski': 0 } });
  const r = K.eskiKapiDizinleriniTemizle({ fsx: f, tmpKok: '/t', platform: 'darwin', simdi: 1e12 });
  assert.equal(f.rmCagri.length, 0);
  assert.deepEqual(r.silinen, []);
});

test('ön adım: yalnız önekli VE 24 sa+ eski dizini siler', () => {
  const simdi = 1e12;
  const f = sahteFs({ dizinler: {
    'empp-kapi-eski': simdi - 25 * 3600e3,
    'empp-kapi-yeni': simdi - 1 * 3600e3,
    'baska-eski': simdi - 99 * 3600e3,
    'empp-ajan-eski': simdi - 99 * 3600e3
  } });
  const r = K.eskiKapiDizinleriniTemizle({ fsx: f, tmpKok: '/t', platform: 'win32', simdi });
  assert.deepEqual(f.rmCagri.map((c) => path.basename(c.y)), ['empp-kapi-eski']);
  assert.equal(r.silinen.length, 1);
  assert.equal(r.atlanan, 1);
});

test('ön adım: silme hatası kapıyı düşürmez, jsonl\'a yazılır', () => {
  const simdi = 1e12;
  const f = sahteFs({ rmHata: hata('EBUSY'), dizinler: { 'empp-kapi-k': 0 } });
  const r = K.eskiKapiDizinleriniTemizle({ fsx: f, tmpKok: '/t', platform: 'win32', simdi });
  assert.equal(r.basarisiz.length, 1);
  assert.equal(f.eklenen.length, 1);
});
