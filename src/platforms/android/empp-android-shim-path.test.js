'use strict';
// K4 (2026-09-09, telefon kaniti): pathMod.join'in origin-farkindaligini
// GERCEKTEN calistirarak dogrular. module.exports.pathMod dogrudan require
// edilir (window/browser mock GEREKMEZ - pathMod saf/stateless).
//
// Telefon bulgusu: "ana sayfa" butonu https://localhost/localhost/index.html
// (ERR_HTTP_RESPONSE_CODE_FAILURE) uretiyordu. Kok neden: book1 main.js
// `path.join(path.dirname(window.location.href), '../')` cagiriyor; posix-saf
// join ardisik '/'leri yutup origin'in '//'sini 'https:/localhost'e dusuruyordu
// -> '/index.html' eklenince WHATWG bunu AYNI semada goreli cozup
// 'https://localhost/localhost/index.html' uretiyordu. Eski compat shim'in
// P.join'i (packagingService.js _buildWebViewRequireShim) origin'i ayirip bu
// sorunu zaten cozmustu; tam shim (empp-android-shim.js) bunu kaybetmisti.
const test = require('node:test');
const assert = require('node:assert');
const { pathMod } = require('./empp-android-shim.js');

test('(a) join(dirname(book1/index.html), "../") === "https://localhost" (origin, slash YOK)', () => {
  const d = pathMod.dirname('https://localhost/book1/index.html');
  assert.strictEqual(d, 'https://localhost/book1');
  assert.strictEqual(pathMod.join(d, '../'), 'https://localhost');
});

test('(a-root) join(dirname(root index.html), "../") === "https://localhost" (kok icin de ayni)', () => {
  const d = pathMod.dirname('https://localhost/index.html');
  assert.strictEqual(d, 'https://localhost');
  assert.strictEqual(pathMod.join(d, '../'), 'https://localhost');
});

test('(b) + "/index.html" => "https://localhost/index.html" (clean() sonra "/"e cevirir, dokunulmadi)', () => {
  const d = pathMod.dirname('https://localhost/book1/index.html');
  const home = pathMod.join(d, '../');
  assert.strictEqual(home + '/index.html', 'https://localhost/index.html');
});

test('(c) join(origin+path, "assets", "x.png") === "https://localhost/book1/assets/x.png" (sonda slash yokken normal ekleme)', () => {
  assert.strictEqual(
    pathMod.join('https://localhost/book1', 'assets', 'x.png'),
    'https://localhost/book1/assets/x.png'
  );
});

// --- (d) REGRESYON: origin'siz girdilerde davranis BIREBIR ayni (K4 oncesi degerlerle sabitlenmis) ---
test('(d1) join("assets","56385","data/BookContent.xml") — regresyon', () => {
  assert.strictEqual(pathMod.join('assets', '56385', 'data/BookContent.xml'), 'assets/56385/data/BookContent.xml');
});

test('(d2) join("/a/b","../c") — regresyon', () => {
  assert.strictEqual(pathMod.join('/a/b', '../c'), '/a/c');
});

test('(d3) dirname("a/b/c.xml") — regresyon (dirname zaten origin-awareness gerektirmiyordu, degistirilmedi)', () => {
  assert.strictEqual(pathMod.dirname('a/b/c.xml'), 'a/b');
});

test('(d4) normalize("./a//b/../c") — regresyon (temel posix normalize dokunulmadi)', () => {
  assert.strictEqual(pathMod.normalize('./a//b/../c'), 'a/c');
});

test('(d5) join() bos/undefined argumanlarla eskisi gibi "." doner', () => {
  assert.strictEqual(pathMod.join(), '.');
  assert.strictEqual(pathMod.join('', null, undefined), '.');
});

test('(d6) VFS anahtar/relUrl uretimi (origin YOK) etkilenmedi — key() ve relUrl() halen normalize kullanir', () => {
  const { _internals } = require('./empp-android-shim.js');
  assert.strictEqual(_internals.relUrl('/classlibraries/ImWin32.dll'), 'classlibraries/ImWin32.dll');
  assert.strictEqual(_internals.relUrl('classlibraries/ImWin32.dll'), 'classlibraries/ImWin32.dll');
});

// --- Mutasyon kaniti: origin ayristirmasi kaldirilsa (a) KIRILMALI ---
test('GERİLEME: origin ayrıştırma kaldırılırsa "ana sayfa" ERR_HTTP_RESPONSE_CODE_FAILURE verir', () => {
  // Eski (K4-oncesi) davranisin dogrudan simulasyonu: pathMod.normalize (origin-farkinda
  // OLMAYAN, posix-saf fonksiyon) ile ayni girdiyi isleyip bozuk sonucun GERCEKTEN
  // uretildigini goster - boylece "duzeltme gercekten bir seyi degistirdi" kaniti var.
  const broken = pathMod.normalize('https://localhost/book1/../') || '.';
  assert.notStrictEqual(broken, 'https://localhost', 'origin-farkinda olmayan yol dogru sonucu ASLA uretemez (kanitin gucu)');
  assert.match(broken, /^https:\/localhost/, 'origin ayristirmasi yoksa "//" bir tek "/"ye duser (bozuk kalip, dogrulanan hata)');

  // Gercek (duzeltilmis) davranis bunun onune gecer:
  const fixed = pathMod.join(pathMod.dirname('https://localhost/book1/index.html'), '../');
  assert.strictEqual(fixed, 'https://localhost');
});

// --- Kaynak-sentinel ---
test('kaynak-sentinel: pathMod.join origin-farkinda joinOriginAware kullanir', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, 'empp-android-shim.js'), 'utf8');
  assert.match(src, /ORIGIN_RE\s*=\s*\/\^\(\[a-zA-Z\]/);
  assert.match(src, /function joinOriginAware\(joined\)/);
  assert.match(src, /joinOriginAware\(a\.join\('\/'\)\)/, 'pathMod.join joinOriginAware\'i cagirmali');
});
