'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createShim, makeResolver, install } = require('./fs-shim');

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-base-'));
  fs.mkdirSync(path.join(base, 'assets/book1/data'), { recursive: true });
  fs.writeFileSync(path.join(base, 'assets/book1/data/BookContent.xml'), '<Book/>');
  const work = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'empp-work-')), 'work');
  return { base, work, shim: createShim(fs, path, work, base) };
}

test('göreli yazma WORK altına gider, paket (BASE) değişmez', () => {
  const { base, work, shim } = fixture();
  shim.writeFileSync('assets/book1/imKeys.dll', 'KEY');
  assert.strictEqual(fs.readFileSync(path.join(work, 'assets/book1/imKeys.dll'), 'utf8'), 'KEY');
  assert.ok(!fs.existsSync(path.join(base, 'assets/book1/imKeys.dll')));
  assert.strictEqual(shim.existsSync('assets/book1/imKeys.dll'), true, 'yazılan dosya okunabilmeli');
});

test('okuma: WORK\'te yoksa BASE\'den; BASE içi mutlak yol da yönlendirilir', () => {
  const { base, shim } = fixture();
  assert.strictEqual(shim.readFileSync('assets/book1/data/BookContent.xml', 'utf8'), '<Book/>');
  assert.strictEqual(shim.existsSync('./assets/book1/data/BookContent.xml'), true);
  assert.strictEqual(shim.existsSync(path.join(base, 'assets/book1/data/BookContent.xml')), true);
  assert.strictEqual(shim.existsSync('assets/yok.txt'), false);
});

test('paket dışı mutlak yollar ve file: URL\'leri dokunulmaz; rename/copy hedefi WORK', () => {
  const { base, work, shim } = fixture();
  const R = makeResolver(path, fs, work, base);
  assert.strictEqual(R.rel('/etc/hosts'), null);
  assert.strictEqual(R.rel('file:///x/y'), null);
  shim.writeFileSync('assets/book1/tmp.txt', 'a');
  shim.renameSync('assets/book1/tmp.txt', 'assets/book1/final.txt');
  assert.ok(fs.existsSync(path.join(work, 'assets/book1/final.txt')));
  shim.copyFileSync('assets/book1/data/BookContent.xml', 'assets/book1/copy.xml');
  assert.ok(fs.existsSync(path.join(work, 'assets/book1/copy.xml')));
  assert.ok(!fs.existsSync(path.join(base, 'assets/book1/copy.xml')));
});

test('install: window.require yoksa (web/Capacitor) null; varsa fs sarılır, diğer modüller aynen', () => {
  assert.strictEqual(install({}), null);
  const win = { require: (n) => require(n), location: { pathname: '/tmp/x/index.html' } };
  const prevEnv = process.env.EMPP_WORK_DIR; process.env.EMPP_WORK_DIR = path.join(os.tmpdir(), 'empp-w');
  const shim = install(win);
  process.env.EMPP_WORK_DIR = prevEnv;
  if (process.platform === 'win32') { assert.strictEqual(shim, null); return; }
  assert.ok(shim && shim.__empp.WORK.endsWith('empp-w'));
  assert.strictEqual(win.require('fs'), shim);
  assert.strictEqual(win.require('path'), path);
});

test('packagingService: shim index.html\'e enjekte edilir, main EMPP_WORK_DIR verir, asar açılmaz (sentinel)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../packaging/packagingService.js'), 'utf8');
  assert.ok(src.includes('empp-fs-shim.js'));
  assert.ok(src.includes("process.env.EMPP_WORK_DIR"));
  assert.ok(!/asar: false/.test(src), 'asar kapatılmamalı (10k dosya imzası saatler sürer)');
  assert.ok(!/\} else \{\s*\n\s*\/\/ Mevcut main\.js/.test(src), 'main.js düzenleme bloğu else dalında kalmamalı (electron.js kopyalanınca atlanıyordu)');
});
