'use strict';

/** İmza tetik köprüsü (Mac): kasanın isteklerini sabit argv ile çalıştırır, birleştirir, reddeder, taşır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const K = require('./imza-tetik-koprusu');
const I = require('../../src/agent/imza-istek');

function yerelUzak(d) {
  const tasinan = [];
  return {
    tasinan,
    listele: () => fs.readdirSync(d).filter((a) => I.AD_DESENI.test(a)),
    oku: (ad) => fs.readFileSync(path.join(d, ad), 'utf8'),
    tasi: (ad, s) => { tasinan.push([ad, s]); fs.renameSync(path.join(d, ad), path.join(d, `${ad}.${s}`)); return true; },
  };
}

test('iki exe-create + bir exe-remove: create TEK kez çalışır, hepsi taşınır; argv sabit tablodan', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kopru-'));
  let t = Date.now();
  const simdi = () => (t += 10);
  await I.istekYaz(d, 'exe-remove', {}, { simdi });
  await I.istekYaz(d, 'exe-create', {}, { simdi });
  await I.istekYaz(d, 'exe-create', {}, { simdi });
  const kosulan = [];
  const uzak = yerelUzak(d);
  const o = await K.tur({ uzak, kos: async (a) => { kosulan.push(a.join(' ')); return { kod: 0 }; }, log: () => {} });
  assert.deepEqual(kosulan, [
    'yayincilikadm book exe-remove --windows --yes 66902',
    'yayincilikadm book exe-create 66902 --wait 0',
  ]);
  assert.equal(o.islenen, 3);
  assert.deepEqual(uzak.tasinan.map((x) => x[1]), ['tamam', 'tamam', 'birlesik-tamam']);
  assert.equal(uzak.listele().length, 0);
});

test('sahte/bayat istek çalıştırılmaz, "red" olarak taşınır; --kuru hiçbir şey çalıştırmaz/taşımaz', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kopru2-'));
  const eski = Date.now() - 7 * 3600 * 1000;
  fs.writeFileSync(path.join(d, `${eski}-exe-create-1.json`), JSON.stringify({ komut: 'exe-create' }));
  fs.writeFileSync(path.join(d, `${Date.now()}-exe-remove-2.json`), JSON.stringify({ komut: 'exe-create', argv: ['rm', '-rf', '/'] }));
  const kosulan = [];
  const kos = async (a) => { kosulan.push(a); return { kod: 0 }; };
  const kuru = await K.tur({ uzak: yerelUzak(d), kos, log: () => {}, kuru: true });
  assert.equal(kuru.reddedilen, 2);
  assert.equal(fs.readdirSync(d).length, 2, 'kuru: taşıma yok');
  const uzak = yerelUzak(d);
  const o = await K.tur({ uzak, kos, log: () => {} });
  assert.equal(o.reddedilen, 2);
  assert.deepEqual(kosulan, []);
  assert.deepEqual(uzak.tasinan.map((x) => x[1]), ['red', 'red']);
});

test('ssh uzak ucu: güvensiz ad ile komut kurulmaz', () => {
  const cagri = [];
  const u = K.sshUzak({ ssh: 'h', dizin: 'C:\\d' }, (...a) => { cagri.push(a); return { status: 0, stdout: '' }; });
  assert.throws(() => u.oku('a" & del x & ".json'), /güvensiz ad/);
  assert.throws(() => u.tasi('x.json', 'tamam'), /güvensiz ad/);
  assert.equal(cagri.length, 0);
});
