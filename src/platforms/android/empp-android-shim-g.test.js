'use strict';
// G (2026-09-26): shim, G istemcisini YALNIZ EmppG yerel eklentisi varsa, gecikmeli, üst pencerede,
// sayfa başına bir kez yükler. Eklentisiz pakette hiç istek atılmaz (konsol 404 gürültüsü yok).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function sahtePencere({ eklenti = true, iframe = false } = {}) {
  const zamanlayicilar = [];
  const eklenenler = [];
  const store = new Map();
  const win = {
    document: {
      head: { appendChild: (el) => { eklenenler.push(el); return el; } },
      createElement: (ad) => ({ tagName: String(ad).toUpperCase() }),
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k), key: (i) => Array.from(store.keys())[i], get length() { return store.size; },
    },
    location: { origin: 'https://localhost', pathname: '/index.html' },
    setTimeout: (fn, ms) => { zamanlayicilar.push({ fn, ms }); return zamanlayicilar.length; },
    setInterval: () => 0,
    addEventListener: () => {},
    fetch: async () => ({ ok: true }),
    Capacitor: { isPluginAvailable: (ad) => eklenti && ad === 'EmppG' },
  };
  win.top = iframe ? {} : win;
  return { win, zamanlayicilar, eklenenler };
}

function yukle(win) {
  const src = fs.readFileSync(path.join(__dirname, 'empp-android-shim.js'), 'utf8');
  const m = { exports: {} };
  new Function('module', 'window', 'btoa', 'atob', 'TextDecoder', src)(m, win,
    (s) => Buffer.from(s, 'binary').toString('base64'), (s) => Buffer.from(s, 'base64').toString('binary'), TextDecoder);
  return m.exports;
}

test('G: eklenti varsa 10 sn sonra /empp-g-istemci.js yüklenir, tek sefer', () => {
  const { win, zamanlayicilar, eklenenler } = sahtePencere();
  const m = yukle(win);
  assert.strictEqual(m._internals.G_GECIKME, 10000);
  const z = zamanlayicilar.filter((x) => x.ms === m._internals.G_GECIKME);
  assert.strictEqual(z.length, 1, 'G zamanlayıcısı kurulmadı');
  assert.strictEqual(eklenenler.length, 0, 'açılışta (gecikmeden önce) hiçbir şey yüklenmemeli');
  z[0].fn();
  assert.strictEqual(eklenenler.length, 1);
  assert.strictEqual(eklenenler[0].tagName, 'SCRIPT');
  assert.strictEqual(eklenenler[0].src, '/empp-g-istemci.js', 'mutlak kök yolu (kitap sayfasından da kök istemci)');
  assert.strictEqual(eklenenler[0].async, true);
  assert.strictEqual(m._internals.gYukle(), false, 'ikinci çağrı yüklememeli');
  assert.strictEqual(eklenenler.length, 1);
});

test('G: eklenti yoksa hiçbir istek atılmaz', () => {
  const { win, zamanlayicilar, eklenenler } = sahtePencere({ eklenti: false });
  const m = yukle(win);
  zamanlayicilar.filter((x) => x.ms === m._internals.G_GECIKME).forEach((x) => x.fn());
  assert.strictEqual(eklenenler.length, 0);
});

test('G: iframe içinde kurulmaz', () => {
  const { win, zamanlayicilar } = sahtePencere({ iframe: true });
  const m = yukle(win);
  assert.strictEqual(zamanlayicilar.filter((x) => x.ms === m._internals.G_GECIKME).length, 0);
});

test('G: Capacitor.Plugins yolu da tanınır (isPluginAvailable yoksa)', () => {
  const { win, zamanlayicilar, eklenenler } = sahtePencere();
  win.Capacitor = { Plugins: { EmppG: {} } };
  const m = yukle(win);
  zamanlayicilar.filter((x) => x.ms === m._internals.G_GECIKME).forEach((x) => x.fn());
  assert.strictEqual(eklenenler.length, 1);
});
