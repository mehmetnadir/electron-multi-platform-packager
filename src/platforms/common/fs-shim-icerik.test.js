'use strict';
/**
 * fs-shim ↔ içerik güncelleme kancası (Faz 2). fs-shim.test.js'ten AYRI (o dosyada dondurulmuş
 * sentinel var). Gerçek `install()` sahte bir renderer penceresiyle koşturulur.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const shimMod = require('./fs-shim.js');

// Renderer'da BASE = sayfanın __dirname'i. Node'da modülün kendi __dirname'i sabit olduğundan
// fs-shim kaynağı istenen __dirname ile (Node modül sarmalayıcısıyla aynı imza) yüklenir.
function shimYukle(dirname, proc) {
  const kaynak = fs.readFileSync(require.resolve('./fs-shim.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', 'process', kaynak)(mod, mod.exports, require, dirname, proc);
  return mod.exports;
}
const icerik = require('../../runtime/icerik-guncelleme.js');

function ortam({ modulVar, subBook = 'book2', platform }) {
  const kok = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shim-icerik-')), 'app.asar');
  const BASE = subBook ? path.join(kok, subBook) : kok;
  fs.mkdirSync(BASE, { recursive: true });
  if (modulVar) fs.copyFileSync(require.resolve('../../runtime/icerik-guncelleme.js'), path.join(kok, 'empp-icerik-guncelleme.js'));
  const workKok = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-icerik-work-'));
  const win = { require: (ad) => require(ad) };
  if (subBook) win.__emppSubBook = subBook;
  const proc = { platform: platform || 'linux', env: { EMPP_WORK_DIR: workKok } };
  shimYukle(BASE, proc).install(win);
  return { win, kok, BASE, workKok };
}

test('kökBul: alt-kitap sayfasında uygulama kökü BASE\'in __emppSubBook kadar yukarısı', () => {
  assert.strictEqual(shimMod.kokBul(path, '/a/app.asar/book2', 'book2'), '/a/app.asar');
  assert.strictEqual(shimMod.kokBul(path, '/a/app.asar/x/book1', 'x/book1'), '/a/app.asar');
  assert.strictEqual(shimMod.kokBul(path, '/a/app.asar', ''), '/a/app.asar');
});

test('modül pakette YOKSA fs-shim davranışı birebir eski (adm-zip sarılmaz, __emppIcerik yok)', () => {
  const o = ortam({ modulVar: false });
  assert.ok(o.win.__emppFsShim, 'fs-shim kuruldu');
  assert.strictEqual(o.win.__emppIcerik, undefined);
  assert.strictEqual(o.win.require('adm-zip'), require('adm-zip'));
});

test('modül pakette VARSA: adm-zip sarılır, fs korumalı; WORK alt-kitap önekli', () => {
  const o = ortam({ modulVar: true });
  assert.ok(o.win.__emppIcerik);
  assert.strictEqual(o.win.__emppIcerik.WORK, path.join(o.workKok, 'book2'));
  assert.strictEqual(o.win.require('adm-zip').__empp, true);
  assert.strictEqual(o.win.require('fs').__emppIcerik, true);
  // yazma hâlâ fs-shim'den geçer (WORK'e)
  o.win.require('fs').writeFileSync(path.join(o.BASE, 'temp', 'a.txt'), 'x');
  assert.ok(fs.existsSync(path.join(o.workKok, 'book2', 'temp', 'a.txt')));
});

test('Windows: ne fs-shim ne içerik kancası kurulur (kapsam dışı — review #4)', () => {
  const o = ortam({ modulVar: true, platform: 'win32' });
  assert.strictEqual(o.win.__emppFsShim, undefined);
  assert.strictEqual(o.win.__emppIcerik, undefined);
  assert.strictEqual(o.win.require('adm-zip'), require('adm-zip'), 'adm-zip sarılmadı');
});
