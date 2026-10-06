'use strict';
/**
 * MENÜ KAPAK KAPISI testleri (2026-10-06, 59835 Teacher's Pack/Worksheets kırık kapak olayı).
 * Fixture'lar 59835 Windows exe (2.51.2) menüsünün birebir biçimidir: link kartında coverUrl yok,
 * kabuk images/book1.png'ye düşer, dosya pakette yok → RED.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const K = require('./menu-kapak');

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]);

function books({ linkKapak = null, kitapKapak = 'thumbs' } = {}) {
  const kapak = (d, id) => (kitapKapak === 'thumbs' ? `${d}/assets/${id}/thumbs/1.jpg` : undefined);
  return {
    book1: { assetId: '58336', contentType: 'book', coverUrl: kapak('book1', '58336'), displayOrder: 0, title: "Student's Book" },
    book2: { assetId: '73456', contentType: 'book', coverUrl: kapak('book2', '73456'), displayOrder: 1, title: 'Activity Book' },
    link4: {
      contentType: 'link', displayOrder: 3, title: "Teacher's Pack", type: 'link', url: 'https://ornek.test/tp.pdf',
      ...(linkKapak ? { coverUrl: linkKapak } : {}),
    },
  };
}

function paket({ b, dosyalar = {}, yama = true, ayar = true }) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-kapak-'));
  const yaz = (rel, v) => {
    fs.mkdirSync(path.dirname(path.join(kok, rel)), { recursive: true });
    fs.writeFileSync(path.join(kok, rel), v);
  };
  const ayarlar = { bookCount: Object.keys(b).length, books: b, setTitle: 'Super Monsters 2 Set' };
  if (ayar) yaz('config/settings.json', JSON.stringify(ayarlar, null, 2));
  if (yama) {
    yaz('scripts/cevrimdisi-yama.js', `(function () {\n  window.__setSettings = ${JSON.stringify(ayarlar, null, 2)};\n`
      + '  var x = window.__setSettings.books;\n})();\n');
  }
  yaz('book1/assets/58336/thumbs/1.jpg', JPG);
  yaz('book2/assets/73456/thumbs/1.jpg', JPG);
  for (const [rel, v] of Object.entries(dosyalar)) yaz(rel, v);
  return kok;
}

test('59835 kalıbı: coverUrl\'süz link → kabuk images/book1.png, dosya yok → RED (yama + settings)', () => {
  const s = K.menuKapakOlcKok(paket({ b: books() }));
  assert.equal(s.durum, K.DURUM.RED);
  const sorunlu = s.kartlar.filter((k) => k.sorun);
  assert.deepEqual(sorunlu.map((k) => `${k.anahtar}@${k.kaynak}`).sort(),
    ['link4@config/settings.json', 'link4@scripts/cevrimdisi-yama.js']);
  assert.match(sorunlu[0].sorun, /pakette yok: images\/book1\.png/);
});

test('tam paket: link kendi kapağıyla → GEÇTİ', () => {
  const s = K.menuKapakOlcKok(paket({
    b: books({ linkKapak: 'images/kapak-link4.jpg' }), dosyalar: { 'images/kapak-link4.jpg': JPG },
  }));
  assert.equal(s.durum, K.DURUM.GECTI, s.sebepler.join(' | '));
  assert.equal(new Set(s.kartlar.map((k) => k.anahtar)).size, 3);
});

test('kabuk yedek kuralı: images/book1.png pakette varsa coverUrl\'süz link GEÇER (Z2 kabuğu)', () => {
  const s = K.menuKapakOlcKok(paket({ b: books(), dosyalar: { 'images/book1.png': JPG } }));
  assert.equal(s.durum, K.DURUM.GECTI);
  assert.equal(s.kartlar.find((k) => k.anahtar === 'link4').yedekKapak, true);
});

test('9 baytlık 404 gövdesi kapak değildir → RED', () => {
  const s = K.menuKapakOlcKok(paket({
    b: books({ linkKapak: 'images/l.png' }), dosyalar: { 'images/l.png': Buffer.from('Not Found') },
  }));
  assert.equal(s.durum, K.DURUM.RED);
  assert.match(s.sebepler[0], /9 bayt/);
});

test('uzak kapak çevrimdışı kırıktır → RED; data: kapak > 1 KB → GEÇTİ', () => {
  const uzak = K.menuKapakOlcKok(paket({ b: books({ linkKapak: 'https://cdn.test/k.jpg' }) }));
  assert.equal(uzak.durum, K.DURUM.RED);
  const data = K.menuKapakOlcKok(paket({ b: books({ linkKapak: `data:image/jpeg;base64,${JPG.toString('base64')}` }) }));
  assert.equal(data.durum, K.DURUM.GECTI);
});

test('kitap kartı coverUrl\'süz → images/<anahtar>.png aranır; ?a= sorgusu yok sayılır', () => {
  assert.equal(K.kapakYolu('book3', { assetId: '1' }, {}), 'images/book3.png');
  assert.equal(K.adresSinifi('images/book3.png?a=58237').yol, 'images/book3.png');
  const s = K.menuKapakOlcKok(paket({ b: books({ linkKapak: 'images/kapak-link4.jpg', kitapKapak: 'yok' }),
    dosyalar: { 'images/kapak-link4.jpg': JPG, 'images/book1.png': JPG } }));
  assert.equal(s.durum, K.DURUM.RED);
  assert.ok(s.sebepler.some((x) => /book2 .*images\/book2\.png/.test(x)));
});

test('assetId\'siz kitap kartı kabukta çizilmez → ölçülmez', () => {
  assert.deepEqual(K.cizilenKartlar({ a: { title: 'x' }, l: { type: 'link' }, b: { assetId: '5' } }), ['l', 'b']);
});

test('menü verisi yok → ATLANDI; okunamayan yama → ÖLÇÜLEMEDİ (GEÇTİ\'ye düşmez)', () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-kapak-bos-'));
  assert.equal(K.menuKapakOlcKok(kok).durum, K.DURUM.ATLANDI);
  fs.mkdirSync(path.join(kok, 'scripts'));
  fs.writeFileSync(path.join(kok, 'scripts/cevrimdisi-yama.js'), 'window.__setSettings = bozuk;');
  assert.equal(K.menuKapakOlcKok(kok).durum, K.DURUM.OLCULEMEDI);
});

test('yer tutucu SVG GEÇER ama UYARI verir', () => {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${K.YER_TUTUCU_IMZASI}="1">${' '.repeat(1200)}</svg>`);
  const s = K.menuKapakOlcKok(paket({ b: books({ linkKapak: 'images/kapak-link4.svg' }), dosyalar: { 'images/kapak-link4.svg': svg } }));
  assert.equal(s.durum, K.DURUM.GECTI);
  assert.equal(s.uyarilar.length, 2);
  assert.match(K.ozetSatiri(s), /UYARI/);
});

test('yamaAyarlari: dizgi içindeki süslü parantez sınırı bozmaz', () => {
  const a = K.yamaAyarlari('x; window.__setSettings = {"books":{"b":{"title":"a } b"}}};\nvar y = {};');
  assert.equal(a.books.b.title, 'a } b');
});

test('ATLANAN ÜYE (Nadir 06.10): atlanan kitabın kartı settings/yamada yok (book numarası boşluklu) → kapak kapısı GEÇTİ', () => {
  // books(): book1, book2, link4 — book3 (atlanan üye) hiç yok; kapı bunu eksik saymaz.
  const s = K.menuKapakOlcKok(paket({
    b: books({ linkKapak: 'images/link4.png' }), dosyalar: { 'images/link4.png': JPG },
  }));
  assert.equal(s.durum, K.DURUM.GECTI, JSON.stringify(s.sebepler));
  assert.ok(!s.kartlar.some((k) => k.anahtar === 'book3'));
});

test('ATLANAN ÜYE manifesti (empp-uretec.json): kapak kapısı listeyi sonuca + özet NOT\'una taşır; manifest yoksa alan yok', () => {
  const manifest = JSON.stringify({ atlananUyeler: [{ kitapId: '14835', ad: 'Old Man', sebep: "İmpark'ta içerik yok (Data boş)" }] });
  const s = K.menuKapakOlcKok(paket({
    b: books({ linkKapak: 'images/link4.png' }), dosyalar: { 'images/link4.png': JPG, 'empp-uretec.json': manifest },
  }));
  assert.equal(s.durum, K.DURUM.GECTI, JSON.stringify(s.sebepler));
  assert.deepEqual(s.atlananUyeler.map((a) => a.kitapId), ['14835']);
  assert.match(K.ozetSatiri(s), /NOT: atlanan üye \(manifest, beklenenden düşüldü\): 14835 "Old Man"/);
  const bozuk = K.menuKapakOlcKok(paket({
    b: books({ linkKapak: 'images/link4.png' }), dosyalar: { 'images/link4.png': JPG, 'empp-uretec.json': '{bozuk' },
  }));
  assert.equal(bozuk.atlananUyeler, undefined, 'bozuk manifest = liste yok (eski davranış)');
});
