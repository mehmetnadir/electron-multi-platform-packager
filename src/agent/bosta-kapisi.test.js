'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bostaSureCoz, bostaKarari, bostaKapisiUygula, bostaIzleyicisiKur } = require('./bosta-kapisi');

test('bostaSureCoz: ioreg HIDIdleTime ns → sn', () => {
  assert.equal(bostaSureCoz('    | |   "HIDIdleTime" = 734000000000\n'), 734);
  assert.equal(bostaSureCoz('çıktı yok'), null);
});

test('bostaKarari: etkin kullanıcı → meşgul; 10 dk boşta + düşük yük → serbest', () => {
  assert.equal(bostaKarari({ bostaSn: 5, yuk1: 1, cekirdek: 12 }).durum, 'mesgul');
  assert.equal(bostaKarari({ bostaSn: 700, yuk1: 2, cekirdek: 12 }).durum, 'serbest');
});

test('bostaKarari: boşta ama makine yüklü → meşgul', () => {
  const k = bostaKarari({ bostaSn: 900, yuk1: 11, cekirdek: 12 });
  assert.equal(k.durum, 'mesgul');
  assert.match(k.sebep, /yüklü/);
});

test('bostaKarari: ara bölge önceki kararı korur (histerezis)', () => {
  assert.equal(bostaKarari({ bostaSn: 300, yuk1: 1, cekirdek: 12, onceki: 'serbest' }).durum, 'serbest');
  assert.equal(bostaKarari({ bostaSn: 300, yuk1: 1, cekirdek: 12, onceki: 'mesgul' }).durum, 'mesgul');
  assert.equal(bostaKarari({ bostaSn: 300, yuk1: 1, cekirdek: 12 }).durum, 'mesgul', 'ilk ölçüm ara bölgede: güvenli taraf');
});

test('bostaKarari: ölçülemezse engellemez', () => {
  assert.equal(bostaKarari({ bostaSn: null, yuk1: 1, cekirdek: 12 }).durum, 'serbest');
});

test('bostaKapisiUygula: meşgulken mac/android düşer, kaynak/pardus kalır', () => {
  const caps = ['mac', 'android', 'kaynak-r2', 'kaynak-kur', 'pardus'];
  assert.deepEqual(bostaKapisiUygula(caps, 'mesgul'), ['kaynak-r2', 'kaynak-kur', 'pardus']);
  assert.deepEqual(bostaKapisiUygula(caps, 'serbest'), caps);
});

test('izleyici: geçişte süren işin önceliği iner/açılır; bayrak, kapatma anahtarı, darwin dışı', () => {
  let bosta = 5;
  let t = 0;
  const cagrilar = [];
  const cp = {
    execFileSync: (k, a) => {
      if (k === 'ioreg') return `"HIDIdleTime" = ${bosta * 1e9}`;
      if (k === 'pgrep') return '111\n222\n';
      if (k === 'taskpolicy') { cagrilar.push(a.join(' ')); return ''; }
      return '';
    },
  };
  const os = { loadavg: () => [1, 1, 1], cpus: () => new Array(12), homedir: () => '/x' };
  const fs = { existsSync: () => false };
  const iz = bostaIzleyicisiKur({ cp, os, fs, simdi: () => t, env: {}, platform: 'darwin' });
  assert.equal(iz.durum().durum, 'mesgul');
  assert.deepEqual(cagrilar, ['-b -p 111', '-b -p 222']);
  bosta = 900;
  t = 31000;
  assert.equal(iz.durum().durum, 'serbest');
  assert.deepEqual(cagrilar.slice(2), ['-B -p 111', '-B -p 222']);

  const bayrakli = bostaIzleyicisiKur({ cp, os, fs: { existsSync: () => true }, env: {}, platform: 'darwin' });
  assert.equal(bayrakli.durum().durum, 'serbest');
  const kapali = bostaIzleyicisiKur({ cp, os, fs, env: { EMPP_BOSTA_KAPISI: '0' }, platform: 'darwin' });
  assert.equal(kapali.durum().durum, 'serbest');
  const linux = bostaIzleyicisiKur({ cp, os, fs, env: {}, platform: 'linux' });
  assert.equal(linux.durum().durum, 'serbest');
});
