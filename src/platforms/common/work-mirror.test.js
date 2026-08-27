'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildWorkMirror, activate } = require('./work-mirror');

function fakeBuild() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-build-'));
  fs.mkdirSync(path.join(root, 'assets/book1/data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets/book1/pages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<html>');
  fs.writeFileSync(path.join(root, 'assets/book1/data/BookContent.xml'), '<Book/>');
  fs.writeFileSync(path.join(root, 'assets/book1/pages/1.png'), 'png');
  return root;
}

test('ayna: dizinler gerçek, dosyalar symlink; yazılan dosya kaynağa değil aynaya gider', () => {
  const src = fakeBuild();
  const dst = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'empp-ud-')), 'work');
  buildWorkMirror(src, dst, '1.0.0');
  assert.ok(fs.lstatSync(path.join(dst, 'index.html')).isSymbolicLink());
  assert.ok(fs.lstatSync(path.join(dst, 'assets/book1/data')).isDirectory());
  assert.ok(fs.lstatSync(path.join(dst, 'assets/book1/data/BookContent.xml')).isSymbolicLink());
  assert.strictEqual(fs.readFileSync(path.join(dst, 'assets/book1/data/BookContent.xml'), 'utf8'), '<Book/>');
  fs.writeFileSync(path.join(dst, 'assets/book1/imKeys.dll'), 'key');
  assert.ok(!fs.existsSync(path.join(src, 'assets/book1/imKeys.dll')), 'kaynak .app değişmemeli');
});

test('sürüm değişince ayna yenilenir, aynı sürümde yazılanlar korunur', () => {
  const src = fakeBuild();
  const dst = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'empp-ud-')), 'work');
  buildWorkMirror(src, dst, '1.0.0');
  fs.writeFileSync(path.join(dst, 'assets/book1/imKeys.dll'), 'key');
  buildWorkMirror(src, dst, '1.0.0');
  assert.ok(fs.existsSync(path.join(dst, 'assets/book1/imKeys.dll')), 'aynı sürümde anahtar kalmalı');
  buildWorkMirror(src, dst, '2.0.0');
  assert.ok(!fs.existsSync(path.join(dst, 'assets/book1/imKeys.dll')), 'yeni sürümde ayna sıfırlanır');
  assert.ok(fs.existsSync(path.join(dst, 'index.html')));
});

test('activate: chdir aynaya; win32 dışı; hata halinde null', () => {
  const src = fakeBuild();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-ud-'));
  const cwd = process.cwd();
  const app = { getPath: () => ud, getVersion: () => '1.0.0' };
  if (process.platform !== 'win32') {
    const m = activate(app, src);
    assert.strictEqual(m, path.join(ud, 'work'));
    assert.strictEqual(fs.realpathSync(process.cwd()), fs.realpathSync(m));
    process.chdir(cwd);
  }
  assert.strictEqual(activate({ getPath: () => { throw new Error('x'); }, getVersion: () => '1' }, src), null);
});

test('packagingService: mac config asar:false ve work-mirror enjeksiyonu (sentinel)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../packaging/packagingService.js'), 'utf8');
  assert.ok(/asar: false,\s*\n\s*mac: \{/.test(src), 'mac config asar:false olmalı');
  assert.ok(src.includes("require('./empp-work-mirror').activate(app, __dirname)"));
});
