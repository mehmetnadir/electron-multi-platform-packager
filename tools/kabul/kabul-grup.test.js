'use strict';
/**
 * SET menü grup kartı tanıma testleri:
 *   • dom-yoklama grup aria-label / badge parsing
 *   • olcutler asamaKarari kitapKartSayisi kullanımı
 *   • android-cihaz cihazKartlari grup düğümü tanıma
 *   • Grupsuz kartlar için geriye uyumluluk
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { grupKitapSayisi } = require('./kosum/dom-yoklama');
const { asamaKarari, DURUM } = require('./olcutler');
const { cihazKartlari } = require('./android-cihaz');

test('(a) dom-yoklama: grup aria-label\'dan 4 kitap okunur', () => {
  const ariaLabel = 'Beyond English serisi, 4 kitap';
  const badgeText = '';
  const sayi = grupKitapSayisi(ariaLabel, badgeText);
  assert.equal(sayi, 4);
});

test('(b) dom-yoklama: badge metninden 4 kitap okunur', () => {
  const ariaLabel = 'Beyond English serisi';
  const badgeText = '4 kitap';
  const sayi = grupKitapSayisi(ariaLabel, badgeText);
  assert.equal(sayi, 4);
});

test('(c) asamaKarari: 1 grup kartı kitapKartSayisi 4, beklenen 4 → menü kartı sebebi YOK (MUTASYON kanıtı)', () => {
  const olcum = {
    baslik: 'SET Menü',
    kartSayisi: 1,
    kitapKartSayisi: 4,
    kartlar: [{ tip: 'webz-grup', kitapSayisi: 4 }],
    piksel: { sapma: 0.2, koyu: 0.5, renk: 5000 },
  };
  const beklenti = { asama: 'menu', setMi: true, beklenenKart: 4 };
  const sonuc = asamaKarari(olcum, beklenti);

  // olcutler'de kitapKartSayisi yerine kartSayisi (1) kullanılırsa kartSayisi (1) !== beklenen (4)
  // olacağından RED sebebi "menü kartı 1 ≠ beklenen 4" üretir ve test kırılır.
  assert.equal(sonuc.durum, DURUM.GECTI);
  assert.equal(sonuc.sebepler.length, 0);
  assert.ok(sonuc.notlar.some((n) => n.includes('menüde grup var')));
});

test('(d) asamaKarari: kitapKartSayisi 3 beklenen 4 → RED sebebi var', () => {
  const olcum = {
    baslik: 'SET Menü',
    kartSayisi: 1,
    kitapKartSayisi: 3,
    kartlar: [{ tip: 'webz-grup', kitapSayisi: 3 }],
    piksel: { sapma: 0.2, koyu: 0.5, renk: 5000 },
  };
  const beklenti = { asama: 'menu', setMi: true, beklenenKart: 4 };
  const sonuc = asamaKarari(olcum, beklenti);

  assert.equal(sonuc.durum, DURUM.RED);
  assert.ok(sonuc.sebepler.some((s) => /menü kartı 3 ≠ beklenen 4/.test(s)));
});

test('(e) cihazKartlari: düğümler [{aciklama:\'Beyond English serisi, 4 kitap\', sinir}] → 1 kart kitapSayisi 4', () => {
  const dugumler = [
    {
      aciklama: 'Beyond English serisi, 4 kitap',
      sinir: { x1: 10, y1: 10, x2: 200, y2: 300 },
    },
  ];
  const kartlar = cihazKartlari(dugumler);
  assert.equal(kartlar.length, 1);
  assert.equal(kartlar[0].anahtar, 'grup:beyond english');
  assert.equal(kartlar[0].kitapSayisi, 4);
});

test('(f) eski davranış: grupsuz 4 kart → kitapKartSayisi 4 ve asamaKarari GEÇTİ', () => {
  const olcum = {
    baslik: 'SET Menü',
    kartSayisi: 4,
    kitapKartSayisi: 4,
    kartlar: [
      { tip: 'webz', kitapSayisi: 1 },
      { tip: 'webz', kitapSayisi: 1 },
      { tip: 'webz', kitapSayisi: 1 },
      { tip: 'webz', kitapSayisi: 1 },
    ],
    piksel: { sapma: 0.2, koyu: 0.5, renk: 5000 },
  };
  const beklenti = { asama: 'menu', setMi: true, beklenenKart: 4 };
  const sonuc = asamaKarari(olcum, beklenti);

  assert.equal(sonuc.durum, DURUM.GECTI);
  assert.equal(sonuc.sebepler.length, 0);
  assert.equal(sonuc.notlar.length, 0);
});
