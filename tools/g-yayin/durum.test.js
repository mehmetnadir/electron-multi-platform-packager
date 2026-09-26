'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const d = require('./durum');

const oz = (c) => ({ sha256: c.repeat(64), boyut: 10 });
const M = d.MOTOR_DOSYA_ADI;

test('sentinel: motor dosya adı motor-surumu.js ile aynı (tek kaynak kayması yok)', () => {
  const kaynak = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'packaging', 'motor-surumu.js'),
    'utf8',
  );
  assert.match(kaynak, new RegExp(`const MOTOR_DOSYA_ADI = '${M.replace('.', '\\.')}'`));
});

test('gYoluMu: yalnız index.html ve bookN/43e23…js', () => {
  assert.equal(d.gYoluMu('index.html'), true);
  assert.equal(d.gYoluMu(`book12/${M}`), true);
  for (const y of [
    'assets2/a.png',
    `book1/x/${M}`,
    `kitap1/${M}`,
    'book1/index.html',
    M,
    '../index.html',
  ]) {
    assert.equal(d.gYoluMu(y), false, y);
  }
});

test('ilk yayın: index + motor + ekle + çıkar', () => {
  const r = d.birlestir(null, {
    index: oz('a'),
    motorlar: { book2: oz('b') },
    ekle: { book4: { ...oz('c'), kaynak: 'https://x/k.zip' } },
    cikar: ['book3'],
  });
  assert.deepEqual(
    r.kabuk.map((g) => g.yol),
    [`book2/${M}`, 'index.html'],
  );
  assert.deepEqual(r.kitaplar, [
    { dizin: 'book3', durum: 'cikar' },
    { dizin: 'book4', durum: 'ekle', kaynak: 'https://x/k.zip', sha256: 'c'.repeat(64), boyut: 10 },
  ]);
  assert.deepEqual(r.ozet.degisenKabuk, [`book2/${M}`, 'index.html']);
});

test('birikimli: önceki durum taşınır, yalnız değişen "değişen" sayılır', () => {
  const onceki = d.birlestir(null, {
    index: oz('a'),
    motorlar: { book2: oz('b') },
    ekle: { book4: { ...oz('c'), kaynak: 'https://x/k.zip' } },
    cikar: ['book3'],
  });
  const r = d.birlestir(
    { kabuk: onceki.kabuk, kitaplar: onceki.kitaplar },
    { motorlar: { book1: oz('d') } },
  );
  assert.deepEqual(
    r.kabuk.map((g) => g.yol),
    [`book1/${M}`, `book2/${M}`, 'index.html'],
  );
  assert.equal(
    r.kitaplar.length,
    2,
    'ekle + çıkar kararları sonraki sürümlerde de durur (atlayan istemci)',
  );
  assert.deepEqual(r.ozet.degisenKabuk, [`book1/${M}`]);
  assert.deepEqual(r.ozet.tasinanKabuk, [`book2/${M}`, 'index.html']);
  assert.deepEqual(r.ozet.degisenKitap, []);
});

test('çıkarılan kitabın motor girdisi düşer; yeniden eklenen kitabın eski motoru onu ezmez', () => {
  const onceki = {
    kabuk: [
      { yol: `book2/${M}`, ...oz('b') },
      { yol: 'index.html', ...oz('a') },
    ],
    kitaplar: [],
  };
  const r1 = d.birlestir(onceki, { cikar: ['book2'] });
  assert.deepEqual(
    r1.kabuk.map((g) => g.yol),
    ['index.html'],
  );
  assert.deepEqual(r1.ozet.dusenKabuk, [`book2/${M}`]);
  const r2 = d.birlestir(onceki, { ekle: { book2: { ...oz('e'), kaynak: 'https://x/b2.zip' } } });
  assert.deepEqual(
    r2.kabuk.map((g) => g.yol),
    ['index.html'],
  );
  const r3 = d.birlestir(onceki, {
    ekle: { book2: { ...oz('e'), kaynak: 'https://x/b2.zip' } },
    motorlar: { book2: oz('f') },
  });
  assert.deepEqual(r3.kabuk.find((g) => g.yol === `book2/${M}`).sha256, 'f'.repeat(64));
});

test('çelişki ve boş değişiklik RED', () => {
  assert.throws(() => d.birlestir(null, {}), /değişiklik yok/);
  assert.throws(
    () =>
      d.birlestir(null, { ekle: { book1: { ...oz('a'), kaynak: 'https://x' } }, cikar: ['book1'] }),
    /hem ekleniyor hem çıkarılıyor/,
  );
  assert.throws(
    () => d.birlestir(null, { motorlar: { book1: oz('a') }, cikar: ['book1'] }),
    /motoru güncellenemez/,
  );
  assert.throws(() => d.birlestir(null, { motorlar: { kitap1: oz('a') } }), /book<N>/);
  assert.throws(() => d.birlestir(null, { cikar: ['../book1'] }), /book<N>/);
  const onceki = { kabuk: [{ yol: 'index.html', ...oz('a') }], kitaplar: [] };
  assert.throws(() => d.birlestir(onceki, { index: oz('a') }), /aynı içerik/);
});

test('dosyaGirdisiGecerliMi / dosyalarGecerliMi: yol kaçışı ve bozuk özet RED', () => {
  const iyi = { yol: 'index.html', ...oz('a') };
  assert.equal(d.dosyaGirdisiGecerliMi(iyi), true);
  for (const kotu of [
    { yol: '../kacis.txt', ...oz('a') },
    { yol: '/mutlak.txt', ...oz('a') },
    { yol: 'a/../../b.txt', ...oz('a') },
    { yol: '', ...oz('a') },
    { yol: 'a.txt', sha256: 'kısa', boyut: 1 },
    { yol: 'a.txt', sha256: 'a'.repeat(64), boyut: -1 },
    null,
    undefined,
  ]) {
    assert.equal(d.dosyaGirdisiGecerliMi(kotu), false, JSON.stringify(kotu));
  }
  assert.equal(d.dosyalarGecerliMi([iyi]), true);
  assert.equal(d.dosyalarGecerliMi([]), false, 'boş liste RED');
  assert.equal(d.dosyalarGecerliMi(null), false);
  assert.equal(d.dosyalarGecerliMi([iyi, { yol: '../kacis.txt', ...oz('a') }]), false);
});

test('birlestir: ekle girdisine dosyalar[] taşınır; bozuksa RED; sonraki sürümde de durur', () => {
  const dosyalar = [
    { yol: 'index.html', ...oz('e') },
    { yol: 'assets/a.png', ...oz('f') },
  ];
  const r = d.birlestir(null, {
    index: oz('a'),
    ekle: { book4: { ...oz('c'), kaynak: 'https://x/k.zip', dosyalar } },
  });
  assert.deepEqual(r.kitaplar.find((k) => k.dizin === 'book4').dosyalar, dosyalar);

  assert.throws(
    () =>
      d.birlestir(null, {
        index: oz('b'),
        ekle: {
          book5: {
            ...oz('c'),
            kaynak: 'https://x/k5.zip',
            dosyalar: [{ yol: '../k.txt', ...oz('x') }],
          },
        },
      }),
    /dosyalar listesi bozuk/,
  );

  // Birikimli: dosyalar'lı önceki kitap girdisi sonraki sürüme de taşınır (atlayan istemci).
  const r2 = d.birlestir({ kabuk: r.kabuk, kitaplar: r.kitaplar }, { motorlar: { book1: oz('d') } });
  assert.deepEqual(r2.kitaplar.find((k) => k.dizin === 'book4').dosyalar, dosyalar);
});

test('oncekiDurum: önceki manifestteki bozuk/kaçış yollu dosyalar[] RED (sessiz taşıma yok)', () => {
  const oncekiBozuk = {
    kabuk: [],
    kitaplar: [
      {
        dizin: 'book4',
        durum: 'ekle',
        kaynak: 'https://x/k.zip',
        ...oz('c'),
        dosyalar: [{ yol: '../kacis.txt', ...oz('a') }],
      },
    ],
  };
  assert.throws(() => d.birlestir(oncekiBozuk, { index: oz('b') }), /bozuk kitap girdisi/);

  // dosyalar alanı hiç YOKSA (eski manifest) sorunsuz taşınır — geriye uyumluluk.
  const oncekiEski = {
    kabuk: [],
    kitaplar: [{ dizin: 'book4', durum: 'ekle', kaynak: 'https://x/k.zip', ...oz('c') }],
  };
  const r = d.birlestir(oncekiEski, { index: oz('b') });
  const b4 = r.kitaplar.find((k) => k.dizin === 'book4');
  assert.equal(b4.dosyalar, undefined);
});

test('önceki manifestte G kapsamı dışı yol RED (sessiz taşıma yok)', () => {
  assert.throws(
    () =>
      d.birlestir(
        { kabuk: [{ yol: 'assets2/x.png', ...oz('a') }], kitaplar: [] },
        { index: oz('b') },
      ),
    /kapsamı dışında/,
  );
  assert.throws(
    () =>
      d.birlestir({ kabuk: [], kitaplar: [{ dizin: 'book1', durum: 'ekle' }] }, { index: oz('b') }),
    /bozuk kitap/,
  );
});
