'use strict';
/**
 * Küçük görsel onarımı (06.10, 11845 book4: 10 sayfa, 1 şifreli thumb → kasa kabulü KALDI).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const T = require('./thumbs-onar');
const M = require('./icerik-merdiven');

let sharp = null;
try { sharp = require('sharp'); } catch (_) { /* yok */ }
let zipVar = true;
try { execFileSync('zip', ['-v'], { stdio: 'ignore' }); } catch (_) { zipVar = false; }

async function png(r, g, b) {
  return sharp({ create: { width: 400, height: 500, channels: 3, background: { r, g, b } } }).png().toBuffer();
}

test('mod1Cevir involütif; sayfaGorseli şifreli png\'yi çözer, bozuk bayta null', async (t) => {
  if (!sharp) return t.skip('sharp yok');
  const p = await png(10, 20, 30);
  const sifreli = T.mod1Cevir(p);
  assert.ok(!T.gorselMi(sifreli));
  assert.ok(T.mod1Cevir(sifreli).equals(p));
  assert.ok(T.sayfaGorseli(sifreli).equals(p));
  assert.ok(T.sayfaGorseli(p).equals(p));
  assert.equal(T.sayfaGorseli(Buffer.alloc(200, 7)), null);
});

test('onarimPlani: thumb sayısı sayfa sayısına eşitse grup atlanır, eksikse grubun tamamı', () => {
  const d = new Map();
  const ekle = (ad) => d.set(ad, { ad, dizin: false });
  for (let i = 1; i <= 3; i++) { ekle(`book1/assets/7/pages/${i}.png`); ekle(`book1/assets/7/thumbs/${i}.jpg`); }
  for (let i = 1; i <= 3; i++) ekle(`book2/assets/9/pages/${i}.png`);
  ekle('book2/assets/9/thumbs/1.jpg');
  const p = T.onarimPlani(d);
  assert.deepEqual([...new Set(p.map((x) => x.grup))], ['book2/assets/9/']);
  assert.equal(p.length, 3);
  assert.deepEqual(p.map((x) => x.mevcut), [true, false, false]);
});

test('thumbsOnar: şifreli sayfalardan thumb üretir, eski şifreli thumb\'ı değiştirir, diğer girdiler aynen', async (t) => {
  if (!sharp || !zipVar) return t.skip('sharp/zip yok');
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbs-onar-'));
  const yaz = (rel, v) => { fs.mkdirSync(path.dirname(path.join(kok, rel)), { recursive: true }); fs.writeFileSync(path.join(kok, rel), v); };
  const sayfalar = [];
  for (let i = 1; i <= 4; i++) {
    const s = T.mod1Cevir(await png(i * 40, 50, 60));
    sayfalar.push(s);
    yaz(`book4/assets/11840/pages/${i}.png`, s);
  }
  yaz('book4/assets/11840/thumbs/1.jpg', sayfalar[0]); // şifreli kopya (11845 kalıbı)
  yaz('book5/assets/1/pages/1.png', await png(1, 2, 3));
  yaz('book5/assets/1/thumbs/1.jpg', await png(1, 2, 3));
  yaz('index.html', '<html></html>');
  const zip = path.join(kok, 'build.zip');
  execFileSync('zip', ['-q', '-r', zip, 'book4', 'book5', 'index.html'], { cwd: kok });
  const once = M.zipDizini(zip);
  const r = await T.thumbsOnar({ zip });
  assert.equal(r.durum, 'uygulandi');
  assert.equal(r.onarilan, 4);
  const sonra = M.zipDizini(zip);
  for (let i = 1; i <= 4; i++) {
    const b = M.zipGirdiOku(zip, sonra.get(`book4/assets/11840/thumbs/${i}.jpg`));
    assert.ok(T.gorselMi(b), `thumb ${i} görsel`);
    assert.equal((await sharp(b).metadata()).format, 'jpeg');
  }
  for (const ad of ['index.html', 'book5/assets/1/thumbs/1.jpg', 'book4/assets/11840/pages/2.png']) {
    assert.equal(sonra.get(ad).crc, once.get(ad).crc, ad);
  }
  execFileSync('unzip', ['-tq', zip]); // sistem açıcısı zip'i geçerli görür
  const iki = await T.thumbsOnar({ zip });
  assert.equal(iki.durum, 'atlandi', 'ikinci koşu idempotent');
});

test('74405 kalıbı: thumb sayısı tam ama hepsi şifreli → çözülerek düz yazılır', async (t) => {
  if (!sharp || !zipVar) return t.skip('sharp/zip yok');
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbs-sifreli-'));
  const yaz = (rel, v) => { fs.mkdirSync(path.dirname(path.join(kok, rel)), { recursive: true }); fs.writeFileSync(path.join(kok, rel), v); };
  const jpg = await sharp({ create: { width: 100, height: 120, channels: 3, background: { r: 9, g: 99, b: 199 } } }).jpeg().toBuffer();
  for (let i = 1; i <= 3; i++) {
    yaz(`book1/assets/70167/pages/${i}.png`, T.mod1Cevir(await png(i, 2, 3)));
    yaz(`book1/assets/70167/thumbs/${i}.jpg`, T.mod1Cevir(jpg));
  }
  const zip = path.join(kok, 'build.zip');
  execFileSync('zip', ['-q', '-r', zip, 'book1'], { cwd: kok });
  const r = await T.thumbsOnar({ zip });
  assert.equal(r.onarilan, 3);
  const sonra = M.zipDizini(zip);
  assert.ok(M.zipGirdiOku(zip, sonra.get('book1/assets/70167/thumbs/2.jpg')).equals(jpg), 'şifre çözülmüş özgün thumb');
  assert.equal((await T.thumbsOnar({ zip })).durum, 'atlandi');
});
