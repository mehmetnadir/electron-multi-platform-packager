'use strict';
/** A1 düzeni tek kaynağı: başlık, shim sırası, kapak sayfası denetimi, düzen algılama. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('./a1-duzen');
const { findSubBookDirs } = require('./sub-book-dirs');

const MOTOR = '<!doctype html><html><head><meta charset="UTF-8"/><script src="app.config.js"></script>'
  + '<script defer="defer" src="./bd0c1a4f650802c98ebf.main.js"></script></head><body></body></html>';

test('baslikEkle: <head> hemen ardına <base> + kök betiği; idempotent; çıkarınca kaynak aynen', () => {
  const k = A.baslikEkle(MOTOR);
  assert.ok(k.startsWith('<!doctype html><html><head><base href="../"><script data-empp-a1-kok>'));
  assert.equal(A.baslikEkle(k), k);
  assert.equal(A.baslikCikar(k), MOTOR);
  assert.ok(A.baslikEkle('<p>x</p>').startsWith(A.A1_BASLIK));
});

test('baslikEkle: sayfada zaten <base> varsa HATA (sessiz bozma yok)', () => {
  assert.throws(() => A.baslikEkle('<html><head><base href="/x/"></head></html>'), /zaten <base>/);
});

test('shimEkle: kök betiğinin HEMEN ardına, idempotent; A1 değilse null', () => {
  const k = A.shimEkle(A.baslikEkle(MOTOR), 'empp-fs-shim.js');
  assert.ok(k.includes(`${A.A1_KOK_BETIGI}<script src="empp-fs-shim.js"></script><meta`));
  assert.equal(A.shimEkle(k, 'empp-fs-shim.js'), k);
  const iki = A.shimEkle(k, 'empp-android-shim.js');
  assert.ok(iki.indexOf('empp-android-shim.js') < iki.indexOf('empp-fs-shim.js'), 'her shim işaretin ardına girer');
  assert.equal(A.shimEkle(MOTOR, 'empp-fs-shim.js'), null);
});

test('kapakDenetle: doğru sayfa (shim\'li/shim\'siz) uygun', () => {
  const k = A.baslikEkle(MOTOR);
  assert.deepEqual(A.kapakDenetle(k), []);
  assert.deepEqual(A.kapakDenetle(A.shimEkle(k, 'empp-fs-shim.js')), []);
});

test('kapakDenetle: başlıksız, shim önce, motor değil, yok → ihlal', () => {
  assert.match(A.kapakDenetle(MOTOR).join('\n'), /başlamıyor/);
  const once = A.baslikEkle(MOTOR).replace('<head>', '<head><script src="empp-fs-shim.js"></script>');
  assert.match(A.kapakDenetle(once).join('\n'), /başlamıyor|önce/);
  assert.match(A.kapakDenetle(A.baslikEkle('<html><head></head><body>kabuk</body></html>')).join('\n'), /motor sayfası değil/);
  assert.deepEqual(A.kapakDenetle(null), ['kapak/index.html yok']);
  const ikiBase = A.baslikEkle(MOTOR).replace('</head>', '<base href="/"></head>');
  assert.match(A.kapakDenetle(ikiBase).join('\n'), /tam bir <base>/);
});

function a1Kok({ isaret = true, menu = true, config = true } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-duzen-'));
  fs.mkdirSync(path.join(d, 'kapak'));
  fs.mkdirSync(path.join(d, 'classlibraries'));
  fs.writeFileSync(path.join(d, 'index.html'), '<script src="scripts/language-set.js"></script>');
  fs.writeFileSync(path.join(d, 'kapak/index.html'), isaret ? A.baslikEkle(MOTOR) : MOTOR);
  if (menu) fs.writeFileSync(path.join(d, 'classlibraries/ImWin32.dll'), 'x');
  if (config) fs.writeFileSync(path.join(d, 'app.config.js'), 'var AppConfig={setBook:{enable:false}}');
  return d;
}

test('a1DuzeniMi: işaretli kapak + kök menü + kök app.config.js → true; biri eksikse false', () => {
  assert.equal(A.a1DuzeniMi(a1Kok()), true);
  assert.equal(A.a1DuzeniMi(a1Kok({ isaret: false })), false);
  assert.equal(A.a1DuzeniMi(a1Kok({ menu: false })), false);
  assert.equal(A.a1DuzeniMi(a1Kok({ config: false })), false);
  assert.equal(A.a1DuzeniMi('/yok/dizin'), false);
});

test('A1 düzeninde kapak/ alt kitap SAYILMAZ (WORK tek kalır, __emppSubBook yazılmaz)', async () => {
  assert.deepEqual(await findSubBookDirs(a1Kok(), { maxDepth: 2 }), []);
});
