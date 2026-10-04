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

test('taşıma komutu: islendi VARKEN de move koşar (04.10: if-gövdesi & move tuzağı)', () => {
  const k = K.tasiKomutu('C:\\d', '1791099197917-exe-create-1.json', 'tamam');
  assert.equal(k, 'mkdir "C:\\d\\islendi" 2>nul & move /y "C:\\d\\1791099197917-exe-create-1.json" "C:\\d\\islendi\\1791099197917-exe-create-1.json.tamam"');
  assert.doesNotMatch(k, /if not exist/i, 'cmd: "if not exist X mkdir X & move" → move IF gövdesinde kalır');
  const cagri = [];
  const u = K.sshUzak({ ssh: 'h', dizin: 'C:\\d' }, (...a) => { cagri.push(a); return { status: 0, stdout: '' }; });
  assert.equal(u.tasi('1791099197917-exe-create-1.json', 'tamam'), true);
  assert.equal(cagri[0][1][cagri[0][1].length - 1], k);
});

test('taşıma tutmazsa istek İKİNCİ KEZ çalıştırılmaz (defter); taşıma yeniden denenir, loglanır', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kopru3-'));
  await I.istekYaz(d, 'exe-create', {});
  const kosulan = [];
  const loglar = [];
  const islenmis = new Set();
  let isaret = 0;
  const bozukUzak = { ...yerelUzak(d), tasi: () => false };
  const kos = async (a) => { kosulan.push(a.join(' ')); return { kod: 0 }; };
  const o1 = await K.tur({ uzak: bozukUzak, kos, log: (m) => loglar.push(m), islenmis, isaretle: () => { isaret += 1; } });
  assert.equal(kosulan.length, 1);
  assert.equal(o1.tasinamayan, 1);
  assert.equal(isaret, 1);
  assert.ok(loglar.some((m) => /TAŞINAMADI/.test(m)));
  const o2 = await K.tur({ uzak: bozukUzak, kos, log: (m) => loglar.push(m), islenmis, isaretle: () => { isaret += 1; } });
  assert.equal(kosulan.length, 1, 'aynı istek ikinci turda yeniden çalıştı (04.10 döngüsü)');
  assert.equal(o2.tasinamayan, 1);
  const iyiUzak = yerelUzak(d);
  await K.tur({ uzak: iyiUzak, kos, log: () => {}, islenmis });
  assert.equal(kosulan.length, 1);
  assert.deepEqual(iyiUzak.tasinan.map((x) => x[1]), ['tamam-tekrar']);
  assert.equal(iyiUzak.listele().length, 0);
});

test('defter: diske yazılır/okunur, son 500 ad tutulur, bozuk dosya boş küme', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kopru4-'));
  const yol = path.join(d, 'alt', 'defter.json');
  assert.equal(K.defterOku(yol).size, 0);
  const s = new Set(Array.from({ length: 510 }, (_, i) => `a${i}`));
  K.defterYaz(yol, s);
  const g = K.defterOku(yol);
  assert.equal(g.size, 500);
  assert.ok(g.has('a509') && !g.has('a0'));
  fs.writeFileSync(yol, '{bozuk');
  assert.equal(K.defterOku(yol).size, 0);
});
