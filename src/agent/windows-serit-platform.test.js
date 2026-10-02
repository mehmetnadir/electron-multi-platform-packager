'use strict';

/**
 * Windows şeridinin platform uyumu (windows-kasa ajanı, 2026-10-02): runner kasa'da (win32) koşarken
 * yuva probu `ping -c` / `/bin/test` kullanamaz. macOS komutları AYNEN kalmalı.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./windows-serit');

const cfg = { winImzaYuvaSunucu: '172.17.2.21', winImzaYuvaKoku: '/Users/x/Impark/Storage7/KitapTekExe' };

test('yuva probu macOS: ping -c 1 -W 2000 + /bin/test -d (değişmedi)', () => {
  assert.deepEqual(W.yuvaProbKomutlari(cfg, 'darwin', '/node'), [
    ['ping', '-c', '1', '-W', '2000', '172.17.2.21'],
    ['/bin/test', '-d', cfg.winImzaYuvaKoku],
  ]);
});

test('yuva probu Windows: ping -n 1 -w 2000 + node statSync (bash/test yok)', () => {
  const k = W.yuvaProbKomutlari({ ...cfg, winImzaYuvaKoku: '\\\\172.17.2.21\\yuva' }, 'win32', 'D:\\node.exe');
  assert.deepEqual(k[0], ['ping', '-n', '1', '-w', '2000', '172.17.2.21']);
  assert.equal(k[1][0], 'D:\\node.exe');
  assert.equal(k[1][1], '-e');
  assert.equal(k[1][3], '\\\\172.17.2.21\\yuva');
});

test('yuva probu: sunucu boşsa ping atlanır', () => {
  assert.equal(W.yuvaProbKomutlari({ ...cfg, winImzaYuvaSunucu: '' }, 'win32', 'n').length, 1);
});

test('Windows dizin probu gerçekten çalışır: var olan dizin 0, olmayan ≠0 (bu makinenin node\'u ile)', async () => {
  const [, prob] = W.yuvaProbKomutlari({ ...cfg, winImzaYuvaKoku: __dirname }, 'win32', process.execPath);
  assert.equal((await W.komutKos(prob, { zamanAsimiMs: 8000 })).kod, 0);
  const [, yok] = W.yuvaProbKomutlari({ ...cfg, winImzaYuvaKoku: `${__dirname}/yok-boyle-dizin` }, 'win32', process.execPath);
  assert.notEqual((await W.komutKos(yok, { zamanAsimiMs: 8000 })).kod, 0);
});
