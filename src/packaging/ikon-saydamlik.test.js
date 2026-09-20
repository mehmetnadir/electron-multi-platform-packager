'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { acikMi, saydamlastir } = require('./ikon-saydamlik');

function tuval(genislik, yukseklik, renk = [255, 255, 255, 255]) {
  const b = Buffer.alloc(genislik * yukseklik * 4);
  for (let i = 0; i < b.length; i += 4) {
    b[i] = renk[0]; b[i + 1] = renk[1]; b[i + 2] = renk[2]; b[i + 3] = renk[3];
  }
  return b;
}

function kutuBoya(b, genislik, x0, y0, x1, y1, renk) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * genislik + x) * 4;
      b[i] = renk[0]; b[i + 1] = renk[1]; b[i + 2] = renk[2]; b[i + 3] = renk[3];
    }
  }
}

function alfa(b, genislik, x, y) {
  return b[(y * genislik + x) * 4 + 3];
}

test('kapi: bayrak 0 ise kapatir, tanimsizsa acik birakir', () => {
  assert.strictEqual(acikMi({}), true);
  assert.strictEqual(acikMi({ EMPP_IKON_SAYDAM: '1' }), true);
  assert.strictEqual(acikMi({ EMPP_IKON_SAYDAM: '0' }), false);
});

test('beyaz cerceve saydamlasir, logo govdesi opak kalir', () => {
  const G = 64;
  const b = tuval(G, G);
  kutuBoya(b, G, 16, 16, 47, 47, [20, 20, 20, 255]);

  const s = saydamlastir(b, G, G);
  assert.strictEqual(s.degisti, true);
  assert.strictEqual(s.sebep, 'temizlendi');
  assert.deepStrictEqual(s.zemin, [255, 255, 255]);

  assert.strictEqual(alfa(b, G, 0, 0), 0, 'kose saydam olmali');
  assert.strictEqual(alfa(b, G, 8, 32), 0, 'kenar bant saydam olmali');
  assert.strictEqual(alfa(b, G, 32, 32), 255, 'logo govdesi opak kalmali');
});

test('logonun ICINDEKI beyaz (kenara bagli degil) korunur', () => {
  const G = 64;
  const b = tuval(G, G);
  kutuBoya(b, G, 12, 12, 51, 51, [20, 20, 20, 255]);
  // govdenin ortasinda beyaz bir delik (harf ici / goz)
  kutuBoya(b, G, 28, 28, 35, 35, [255, 255, 255, 255]);

  const s = saydamlastir(b, G, G);
  assert.strictEqual(s.degisti, true);
  assert.strictEqual(alfa(b, G, 31, 31), 255, 'ic beyaz saydamlasmamali');
  assert.strictEqual(alfa(b, G, 1, 1), 0, 'dis beyaz saydamlasmali');
});

test('zaten saydamligi olan gorsele dokunulmaz', () => {
  const G = 32;
  const b = tuval(G, G, [255, 255, 255, 0]);
  kutuBoya(b, G, 8, 8, 23, 23, [10, 10, 10, 255]);

  const s = saydamlastir(b, G, G);
  assert.strictEqual(s.degisti, false);
  assert.strictEqual(s.sebep, 'zaten-saydam');
});

test('koseler birbirinden farkliysa (degrade/fotograf) dokunulmaz', () => {
  const G = 32;
  const b = tuval(G, G);
  // sag alt koseyi belirgin koyu yap
  kutuBoya(b, G, 31, 31, 31, 31, [10, 10, 10, 255]);

  const s = saydamlastir(b, G, G);
  assert.strictEqual(s.degisti, false);
  assert.strictEqual(s.sebep, 'kose-tutarsiz');
});

test('duz renk gorsel tamamen silinmez', () => {
  const G = 32;
  const b = tuval(G, G);

  const s = saydamlastir(b, G, G);
  assert.strictEqual(s.degisti, false);
  assert.strictEqual(s.sebep, 'neredeyse-tamami');
  assert.strictEqual(alfa(b, G, 0, 0), 255, 'dokunulmamis olmali');
});

test('kenarda kayda deger kutu yoksa dokunulmaz', () => {
  const G = 64;
  const b = tuval(G, G, [20, 20, 20, 255]);
  // yalnizca dort kosede 2x2 beyaz leke: koseler tutarli ama silinecek alan ihmal edilebilir
  for (const [x, y] of [[0, 0], [G - 2, 0], [0, G - 2], [G - 2, G - 2]]) {
    kutuBoya(b, G, x, y, x + 1, y + 1, [255, 255, 255, 255]);
  }

  const s = saydamlastir(b, G, G);
  assert.strictEqual(s.degisti, false);
  assert.strictEqual(s.sebep, 'kayda-deger-degil');
});

test('yumusatma: zemine yakin kenar pikseli kismi alfa alir', () => {
  const G = 32;
  const b = tuval(G, G);
  kutuBoya(b, G, 8, 8, 23, 23, [20, 20, 20, 255]);
  // govde kenarinda ara ton (anti-alias artigi): zemine yakin ama tolerans disi
  kutuBoya(b, G, 8, 15, 8, 15, [215, 215, 215, 255]);

  const s = saydamlastir(b, G, G);
  assert.strictEqual(s.degisti, true);
  const a = alfa(b, G, 8, 15);
  assert.ok(a > 0 && a < 255, `ara ton kismi alfa almali, olculen: ${a}`);
});

test('gecersiz tampon sessizce reddedilir', () => {
  const s = saydamlastir(Buffer.alloc(10), 32, 32);
  assert.strictEqual(s.degisti, false);
  assert.strictEqual(s.sebep, 'gecersiz-tampon');
});

test('SENTINEL: canli paketleme yolu saydamlastirmayi cagiriyor', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.ok(
    kaynak.includes("require('./ikon-saydamlik')"),
    'packagingService.js ikon-saydamlik modulunu require etmeli'
  );
  assert.ok(
    kaynak.includes('async hazirlaSaydamLogo('),
    'hazirlaSaydamLogo yardimcisi kaldirilmis'
  );
  const cagri = (kaynak.match(/this\.hazirlaSaydamLogo\(/g) || []).length;
  assert.strictEqual(
    cagri, 3,
    `windows + linux + macOS ikon yollarinin ucunde de cagri olmali, bulunan: ${cagri}`
  );
});
