'use strict';

/** yuvayiArsivle: çıkış 2/3'te 2 sn arayla en çok 3 deneme, çıktı loglanır (04.10 72378). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('./windows-serit');

function kur(kodlar) {
  const koku = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-arsiv-'));
  const cfg = {
    winImzaYuvaKoku: koku, winImzaKabuk: 'node', winImzaBetigi: 'x.js', yuvaArsivBeklemeMs: 0,
    winImzaIstekDizini: path.join(koku, 'istek'),
  };
  const loglar = [];
  const taslar = [];
  let n = 0;
  const kos = async () => {
    const kod = kodlar[Math.min(n, kodlar.length - 1)];
    n += 1;
    return { kod, cikti: '', hata: kod === 0 ? '' : 'dosya yok: /yuva/66902/windows.exe' };
  };
  const tasi = async (a, b) => { taslar.push([a, b]); };
  const calistir = () => W.yuvayiArsivle({
    exe: '/x/kitap.exe', cfg, log: (...a) => loglar.push(a.join(' ')), kos, tasi,
  });
  return { calistir, loglar, taslar, say: () => n };
}

test('[2,0]: ikinci denemede taşır, ilk denemenin "dosya yok" metni logda', async () => {
  const k = kur([2, 0]);
  await k.calistir();
  assert.equal(k.say(), 2);
  assert.equal(k.taslar.length, 1);
  assert.match(k.taslar[0][1], /_imzali[\\/]kitap\.exe$/);
  assert.ok(k.loglar.some((l) => /çıkış 2 \(deneme 1\/3\).*dosya yok/.test(l)));
});

test('[2,2,2]: 3 deneme, taşıma yok, uyarı + stderr loglanır, fırlatmaz', async () => {
  const k = kur([2, 2, 2]);
  await k.calistir();
  assert.equal(k.say(), 3);
  assert.equal(k.taslar.length, 0);
  assert.ok(k.loglar.some((l) => /deneme 3\/3.*dosya yok/.test(l)));
  assert.ok(k.loglar.some((l) => /_imzali\/'ye taşınmadı/.test(l)));
});

test('[4]: tek deneme, taşıma yok', async () => {
  const k = kur([4]);
  await k.calistir();
  assert.equal(k.say(), 1);
  assert.equal(k.taslar.length, 0);
});

test('[0]: tek deneme, taşır', async () => {
  const k = kur([0]);
  await k.calistir();
  assert.equal(k.say(), 1);
  assert.equal(k.taslar.length, 1);
});
