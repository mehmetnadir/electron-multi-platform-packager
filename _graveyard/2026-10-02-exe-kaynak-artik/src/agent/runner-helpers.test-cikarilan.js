'use strict';
// 2026-10-02 karantina: runner-helpers.test.js'ten çıkarılan lruSilinecekler testleri.
const test = require('node:test');
const assert = require('node:assert');
const { lruSilinecekler } = require('./runner-helpers-cikarilan');


const GB = 1024 ** 3;

test('lruSilinecekler: tavan altında -> []', () => {
  const girdiler = [
    { yol: '/cache/1/v1', bayt: 5 * GB, sonKullanim: 100 },
    { yol: '/cache/2/v1', bayt: 4 * GB, sonKullanim: 200 },
  ];
  assert.deepEqual(lruSilinecekler(girdiler, 20 * GB), []);
});

test('lruSilinecekler: en eskiden başlar, tavan altına inince durur — en yeni listede YOK', () => {
  const girdiler = [
    { yol: '/cache/A', bayt: 10 * GB, sonKullanim: 100 },
    { yol: '/cache/B', bayt: 10 * GB, sonKullanim: 200 },
    { yol: '/cache/C', bayt: 10 * GB, sonKullanim: 300 },
    { yol: '/cache/D', bayt: 10 * GB, sonKullanim: 400 },
  ];
  const sonuc = lruSilinecekler(girdiler, 25 * GB); // toplam 40GB, tavan 25GB -> 15GB düşmeli
  assert.deepEqual(sonuc.map((g) => g.yol), ['/cache/A', '/cache/B']);
  // GERİLEME kapısı: en yeni (D) veya bir önceki (C) YANLIŞLIKLA silinmemeli.
  assert.ok(!sonuc.some((g) => g.yol === '/cache/C'), 'C (2. en yeni) listede OLMAMALI');
  assert.ok(!sonuc.some((g) => g.yol === '/cache/D'), 'D (en yeni) listede OLMAMALI');
  // Hepsi silinmiş olmamalı — "tavana ininceye kadar dur" işliyor.
  assert.ok(sonuc.length < girdiler.length, 'tüm girdiler silinmemeli, yalnız gereken kadarı');
});

test('lruSilinecekler: korunan girdi en eski olsa da atlanır, sıradaki silinir', () => {
  const girdiler = [
    { yol: '/cache/A-korunan', bayt: 10 * GB, sonKullanim: 100, korunan: true },
    { yol: '/cache/B', bayt: 10 * GB, sonKullanim: 200 },
    { yol: '/cache/C', bayt: 10 * GB, sonKullanim: 300 },
  ];
  const sonuc = lruSilinecekler(girdiler, 15 * GB); // toplam 30GB, tavan 15GB
  assert.deepEqual(sonuc.map((g) => g.yol), ['/cache/B', '/cache/C']);
  assert.ok(!sonuc.some((g) => g.yol === '/cache/A-korunan'), 'korunan girdi ASLA listelenmemeli');
});

test('lruSilinecekler: sonKullanim eksik girdi 0 sayılır (en eski kabul edilir)', () => {
  const girdiler = [
    { yol: '/cache/X', bayt: 10 * GB, sonKullanim: 500 },
    { yol: '/cache/Y-eksik', bayt: 10 * GB }, // sonKullanim yok -> 0
    { yol: '/cache/Z', bayt: 10 * GB, sonKullanim: 1000 },
  ];
  const sonuc = lruSilinecekler(girdiler, 15 * GB); // toplam 30GB, tavan 15GB
  assert.deepEqual(sonuc.map((g) => g.yol), ['/cache/Y-eksik', '/cache/X']);
  assert.ok(!sonuc.some((g) => g.yol === '/cache/Z'), 'en yeni (Z) silinmemeli');
});

test('lruSilinecekler: girdi dizisi ve nesneleri mutasyona uğramaz', () => {
  const girdiler = [
    { yol: '/cache/A', bayt: 10 * GB, sonKullanim: 100 },
    { yol: '/cache/B', bayt: 10 * GB, sonKullanim: 200 },
  ];
  const kopya = JSON.parse(JSON.stringify(girdiler));
  lruSilinecekler(girdiler, 5 * GB);
  assert.deepEqual(girdiler, kopya);
});
