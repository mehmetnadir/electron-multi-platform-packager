'use strict';

/**
 * Açılış zamanlama günlüğü testleri — gerçek dosya sistemi (mkdtemp), sahte
 * electron nesneleri (EventEmitter). Pencere/renderer açılmaz.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const z = require('./acilis-zamanlama');

function gecici() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'empp-zaman-'));
}

function sahteElectron(kok, { menuSonucu = 'bookSetContainer:3' } = {}) {
  const app = new EventEmitter();
  app.getPath = (ad) => { assert.strictEqual(ad, 'userData'); return kok; };
  app.getVersion = () => '2.51.0';
  const pencere = new EventEmitter();
  pencere.webContents = new EventEmitter();
  pencere.webContents.getURL = () => 'file:///C:/Users/x/AppData/Local/Programs/sm2/resources/app/index.html';
  pencere.webContents.kod = null;
  pencere.webContents.executeJavaScript = (kod) => { pencere.webContents.kod = kod; return Promise.resolve(menuSonucu); };
  return { app, pencere };
}

function satirlar(dosya) {
  return fs.readFileSync(dosya, 'utf8').split('\n').filter(Boolean);
}

test('satirUret: ISO UTC + [uygulama] + süreç başından ms + evre | ayrıntı; satır sonu kaçışı', () => {
  const s = z.satirUret({ an: Date.UTC(2026, 8, 26, 10, 0, 1, 500), baslangic: Date.UTC(2026, 8, 26, 10, 0, 0, 0), evre: 'app ready', ayrinti: 'a\nb' });
  assert.strictEqual(s, '2026-09-26T10:00:01.500Z [uygulama] +1500ms app ready | a b\n');
});

test('mimariOzeti: process.arch + os.arch + PROCESSOR_ARCHITECTURE + PROCESSOR_ARCHITEW6432 hepsi yazılır', () => {
  const o = z.mimariOzeti({ PROCESSOR_ARCHITECTURE: 'x86', PROCESSOR_ARCHITEW6432: 'ARM64' },
    { arch: 'ia32', platform: 'win32' },
    { arch: () => 'ia32', cpus: () => [{ model: 'Apple Silicon' }, {}], totalmem: () => 8 * 1024 ** 3, release: () => '10.0.22631' });
  for (const p of ['process.arch=ia32', 'os.arch=ia32', 'PROCESSOR_ARCHITECTURE=x86', 'PROCESSOR_ARCHITEW6432=ARM64', 'cpu=Apple Silicon x2', 'bellek=8192 MB']) {
    assert.ok(o.includes(p), `${p} yok: ${o}`);
  }
  assert.ok(z.mimariOzeti({}, { arch: 'x64', platform: 'win32' }, os).includes('PROCESSOR_ARCHITEW6432=-'));
});

test('baslat: süreç başladı → mimari → app ready → pencere oluştu → did-finish-load → ready-to-show → gösterildi → menü çizildi', async () => {
  z._sifirla();
  const kok = gecici();
  const { app, pencere } = sahteElectron(kok);
  const g = z.baslat({ electron: { app }, env: { PROCESSOR_ARCHITECTURE: 'x86', PROCESSOR_ARCHITEW6432: 'ARM64' } });
  assert.strictEqual(g.dosya, path.join(kok, 'acilis-zamanlama.log'));
  app.emit('ready');
  app.emit('browser-window-created', {}, pencere);
  pencere.webContents.emit('did-finish-load');
  pencere.emit('ready-to-show');
  pencere.emit('show');
  await new Promise((r) => setImmediate(r));
  const s = satirlar(g.dosya);
  const evreler = s.map((x) => x.replace(/^\S+ \[uygulama\] \+\d+ms /, '').split(' | ')[0]);
  assert.deepStrictEqual(evreler, ['süreç başladı', 'mimari', 'ana betik yüklendi', 'app ready',
    'pencere oluştu', 'did-finish-load', 'ready-to-show', 'gösterildi', 'menü çizildi']);
  assert.ok(s[0].includes('sürüm 2.51.0'));
  assert.ok(s[1].includes('PROCESSOR_ARCHITEW6432=ARM64'));
  assert.ok(s[5].endsWith('pencere 1 index.html'), s[5]);
  assert.ok(s[8].endsWith('bookSetContainer:3'));
  assert.ok(pencere.webContents.kod.includes('bookSetContainer'));
  // ikinci çağrı idempotent — ikinci başlık yazılmaz
  z.baslat({ electron: { app } });
  assert.strictEqual(satirlar(g.dosya).length, 9);
  // modül düzeyi yaz() aynı dosyaya
  assert.strictEqual(z.yaz('impark', 'deneme'), true);
  assert.ok(satirlar(g.dosya)[9].includes('impark | deneme'));
  z._sifirla();
});

test('baslat: menü 120 sn çizilmezse "menü çizilmedi" yazar; ikinci did-finish-load menüyü yeniden ölçmez', async () => {
  z._sifirla();
  const kok = gecici();
  const { app, pencere } = sahteElectron(kok, { menuSonucu: 'zaman-asimi' });
  const g = z.baslat({ electron: { app }, env: {} });
  app.emit('browser-window-created', {}, pencere);
  pencere.webContents.emit('did-finish-load');
  pencere.webContents.kod = null;
  pencere.webContents.emit('did-finish-load');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(pencere.webContents.kod, null);
  const s = satirlar(g.dosya).join('\n');
  assert.match(s, /menü çizilmedi \(120 sn\)/);
  z._sifirla();
});

test('gunlukcuKur: userData yazılamazsa sessizce vazgeçer (açılışı düşürmez)', () => {
  const app = { getPath: () => { throw new Error('yok'); } };
  const g = z.gunlukcuKur({ app });
  assert.strictEqual(g.dosya, null);
  assert.strictEqual(g.yaz('x'), false);
});

test('gunlukcuKur: AZAMI_BOYUT aşılınca .1 olarak döndürür', () => {
  const kok = gecici();
  fs.writeFileSync(path.join(kok, z.DOSYA_ADI), Buffer.alloc(z.AZAMI_BOYUT + 1, 65));
  const g = z.gunlukcuKur({ app: { getPath: () => kok } });
  g.yaz('yeni');
  assert.ok(fs.existsSync(path.join(kok, z.DOSYA_ADI + '.1')));
  assert.strictEqual(satirlar(g.dosya).length, 1);
});

test('menuBekleyiciKodu: gerçek JS; #bookSetContainer dolunca sayıyla, boşken zaman aşımıyla çözülür', async () => {
  function calistir(cocukSayisi, zamanAsimi) {
    const kap = { children: { length: cocukSayisi } };
    const ctx = {
      document: { getElementById: (id) => (id === 'bookSetContainer' ? kap : null), documentElement: {}, body: { children: { length: 1 } } },
      MutationObserver: class { observe() {} disconnect() {} },
      requestAnimationFrame: (f) => setImmediate(f),
      setTimeout,
      Promise,
    };
    return vm.runInNewContext(z.menuBekleyiciKodu(zamanAsimi), ctx);
  }
  assert.strictEqual(await calistir(3, 1000), 'bookSetContainer:3');
  assert.strictEqual(await calistir(0, 5), 'zaman-asimi');
});
