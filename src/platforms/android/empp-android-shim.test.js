'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Tarayıcı ortamı taklidi: localStorage + senkron XHR (yerel asset) + document.
function fakeWindow(assets) {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => Array.from(store.keys())[i],
    get length() { return store.size; },
  };
  function XHR() { this.status = 0; this.responseText = ''; }
  XHR.prototype.open = function (m, url) { this.m = m; this.url = url; };
  XHR.prototype.overrideMimeType = function () {};
  XHR.prototype.send = function () {
    const body = assets[this.url];
    if (body === undefined) { this.status = 404; return; }
    this.status = 200; this.responseText = body;
  };
  const win = { document: {}, localStorage, XMLHttpRequest: XHR, location: { origin: 'https://localhost' }, fetch: async (u) => ({ status: 200, real: true, url: u }), Response: class { constructor(b, i) { this.body = b; this.status = i.status; this.headers = i.headers; } } };
  return win;
}

function load(win) {
  // Modülü izole yükle: global window'u geçici tanımla
  const src = fs.readFileSync(path.join(__dirname, 'empp-android-shim.js'), 'utf8');
  const m = { exports: {} };
  new Function('module', 'window', 'btoa', 'atob', 'TextDecoder', src)(m, win, (s) => Buffer.from(s, 'binary').toString('base64'), (s) => Buffer.from(s, 'base64').toString('binary'), TextDecoder);
  return m.exports;
}

test('path: posix join/dirname/basename; window.__dirname boş → göreli yollar', () => {
  const win = fakeWindow({});
  load(win);
  const p = win.require('path');
  assert.strictEqual(p.join('', '/classlibraries/ImWin32.dll'), '/classlibraries/ImWin32.dll');
  assert.strictEqual(p.join('assets', '33530', 'data/BookContent.xml'), 'assets/33530/data/BookContent.xml');
  assert.strictEqual(p.dirname('assets/33530/x.png'), 'assets/33530');
  assert.strictEqual(p.basename('a/b/c.dll'), 'c.dll');
  assert.strictEqual(win.__dirname, '');
  assert.ok(win.__emppFsShim && win.__emppFsShim.android, 'Electron fs-shim kurulmasın işareti');
});

test('fs: yerel asset okunur (XHR), yazılan VFS\'e gider, existsSync/readdir manifest+VFS', () => {
  const win = fakeWindow({
    'classlibraries/ImWin32.dll': 'ORIG-XML',
    'assets/33530/data/BookContent.xml': '<Book/>',
    'empp-manifest.json': JSON.stringify({ tree: { assets: ['33530', '33524'], '': ['assets', 'classlibraries'] }, dirs: ['assets', 'assets/33530', 'classlibraries'], files: [] }),
  });
  load(win);
  const f = win.require('fs');
  assert.strictEqual(f.readFileSync('/classlibraries/ImWin32.dll', 'utf8'), 'ORIG-XML');
  assert.strictEqual(f.existsSync('/classlibraries/ImWin32.dll'), true);
  assert.strictEqual(f.existsSync('assets/33530/imKeys.dll'), false);
  f.writeFileSync('/classlibraries/ImWin32.dll', 'NEW-XML');
  assert.strictEqual(f.readFileSync('/classlibraries/ImWin32.dll', 'utf8'), 'NEW-XML', 'VFS öncelikli');
  f.copyFileSync('/classlibraries/ImWin32.dll', '/classlibraries/ImWin32.dll.bak');
  assert.strictEqual(f.existsSync('/classlibraries/ImWin32.dll.bak'), true);
  assert.deepStrictEqual(f.readdirSync('/assets').sort(), ['33524', '33530']);
  f.writeFileSync('/temp/data/storage.im', 'ENC');
  assert.strictEqual(f.existsSync('/temp/data'), true, 'VFS içi dizin var sayılır');
  assert.throws(() => f.readFileSync('assets/yok.xml'), /ENOENT/);
});

test('fetch: VFS\'te olan göreli yol oradan, diğerleri gerçek fetch', async () => {
  const win = fakeWindow({ 'empp-manifest.json': '{}' });
  load(win);
  win.require('fs').writeFileSync('/classlibraries/ImWin32.dll', 'FROM-VFS');
  const r = await win.fetch('classlibraries/ImWin32.dll');
  assert.strictEqual(r.headers['X-EMPP-Source'], 'vfs');
  assert.strictEqual(r.body, 'FROM-VFS');
  const r2 = await win.fetch('https://akillitahta.ydspublishing.com/x');
  assert.strictEqual(r2.real, true);
  const r3 = await win.fetch('assets/33530/pages/12.png');
  assert.strictEqual(r3.real, true, 'VFS\'te olmayan yerel dosya gerçek fetch ile');
});

test('stub modüller: os.networkInterfaces boş, electron.remote yok, https.get error verir', async () => {
  const win = fakeWindow({});
  load(win);
  assert.deepStrictEqual(win.require('os').networkInterfaces(), {});
  assert.strictEqual(win.require('electron').remote, undefined);
  assert.throws(() => win.require('yok-modul'), /Cannot find module/);
  await new Promise((res) => { win.require('https').get('https://x', () => {}).on('error', (e) => { assert.ok(e); res(); }); });
});

test('CapacitorHttp yamalı XHR: orijinal open/send (CapacitorWebXMLHttpRequest) kullanılır', () => {
  const win = fakeWindow({ 'kurum.txt': '60' });
  const RealXHR = win.XMLHttpRequest;
  // Yamalı XHR: sync istekte status 0 (CapacitorHttp davranışı); orijinal metodlar ayrı objede
  function Patched() { this.status = 0; this.responseText = ''; }
  Patched.prototype.open = function () {}; Patched.prototype.send = function () { this.status = 0; };
  Patched.prototype.overrideMimeType = function () {};
  win.XMLHttpRequest = Patched;
  win.CapacitorWebXMLHttpRequest = { open: RealXHR.prototype.open, send: RealXHR.prototype.send };
  load(win);
  assert.strictEqual(win.require('fs').readFileSync('/kurum.txt', 'utf8'), '60');
});

test('uygulamanın kendi senkron XHR HEAD\'i (pages2x kontrolü) gerçek statüyü görür', () => {
  const win = fakeWindow({ 'assets/1/pages/1.png': 'PNG' });
  const RealXHR = win.XMLHttpRequest;
  function Patched() { this.status = 0; this.responseText = ''; }
  Patched.prototype.open = function () {}; Patched.prototype.send = function () { this.status = 0; };
  win.XMLHttpRequest = Patched;
  win.CapacitorWebXMLHttpRequest = { open: RealXHR.prototype.open, send: RealXHR.prototype.send };
  load(win);
  const x = new win.XMLHttpRequest(); x.open('HEAD', 'assets/1/pages2x/1.png', false); x.send();
  assert.strictEqual(x.status, 404, 'olmayan retina klasörü 404 olmalı (0 değil)');
  const y = new win.XMLHttpRequest(); y.open('HEAD', 'assets/1/pages/1.png', false); y.send();
  assert.strictEqual(y.status, 200);
  const z = new win.XMLHttpRequest(); z.open('GET', 'https://x', true); z.send();
  assert.strictEqual(z.status, 0, 'async istek yamalı (native) yolda kalır');
});

test('gerçek Node ortamında (window.require varsa) kurulmaz', () => {
  const win = fakeWindow({});
  win.require = () => 'node';
  load(win);
  assert.strictEqual(win.require('fs'), 'node');
});
