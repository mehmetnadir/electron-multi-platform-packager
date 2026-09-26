'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createShim, makeResolver, install, installFetch, workPathForUrl } = require('./fs-shim');

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
  // 2026-09-26 (sözleşme G1/G2): shim Windows'ta da kurulur — win32 istisnası kalktı.
  assert.ok(shim && shim.__empp.WORK.endsWith('empp-w'));
  assert.strictEqual(win.require('fs'), shim);
  assert.strictEqual(win.require('path'), path);
});

// --- K9 (2026-09-09, Pardus/.impark kaniti): window.__emppSubBook WORK'u onekler ---
test('K9 (a) window.__emppSubBook="book1" -> WORK = WORK_ROOT/book1', () => {
  if (process.platform === 'win32') return;
  const win = { require: (n) => require(n), location: { pathname: '/tmp/x/index.html' }, __emppSubBook: 'book1' };
  const prevEnv = process.env.EMPP_WORK_DIR; process.env.EMPP_WORK_DIR = path.join(os.tmpdir(), 'empp-w9');
  const shim = install(win);
  process.env.EMPP_WORK_DIR = prevEnv;
  assert.ok(shim, 'shim kurulmali');
  assert.strictEqual(shim.__empp.WORK, path.join(os.tmpdir(), 'empp-w9', 'book1'));
});

test('K9 (b) derinlik-2 window.__emppSubBook="sets/a" -> WORK = WORK_ROOT/sets/a', () => {
  if (process.platform === 'win32') return;
  const win = { require: (n) => require(n), location: { pathname: '/tmp/x/index.html' }, __emppSubBook: 'sets/a' };
  const prevEnv = process.env.EMPP_WORK_DIR; process.env.EMPP_WORK_DIR = path.join(os.tmpdir(), 'empp-w9b');
  const shim = install(win);
  process.env.EMPP_WORK_DIR = prevEnv;
  assert.strictEqual(shim.__empp.WORK, path.join(os.tmpdir(), 'empp-w9b', 'sets', 'a'));
});

test('K9 (c) __emppSubBook YOKSA (kok) WORK = WORK_ROOT, eski davranisla BIREBIR ayni (regresyon)', () => {
  if (process.platform === 'win32') return;
  const win = { require: (n) => require(n), location: { pathname: '/tmp/x/index.html' } }; // __emppSubBook YOK
  const prevEnv = process.env.EMPP_WORK_DIR; process.env.EMPP_WORK_DIR = path.join(os.tmpdir(), 'empp-w9c');
  const shim = install(win);
  process.env.EMPP_WORK_DIR = prevEnv;
  assert.strictEqual(shim.__empp.WORK, path.join(os.tmpdir(), 'empp-w9c'), 'kok icin onek EKLENMEMELI');
});

test('K9 (d) book1 ve book3 GERCEKTEN farkli WORK dizinlerine yazar (carpisma yok)', () => {
  if (process.platform === 'win32') return;
  const workRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'empp-w9d-')), 'work');
  const prevEnv = process.env.EMPP_WORK_DIR; process.env.EMPP_WORK_DIR = workRoot;

  const winBook1 = { require: (n) => require(n), location: { pathname: '/tmp/x/index.html' }, __emppSubBook: 'book1' };
  const shimBook1 = install(winBook1);
  const winBook3 = { require: (n) => require(n), location: { pathname: '/tmp/x/index.html' }, __emppSubBook: 'book3' };
  const shimBook3 = install(winBook3);
  process.env.EMPP_WORK_DIR = prevEnv;

  shimBook1.writeFileSync('temp/data/storage.im', 'book1-durumu');
  shimBook3.writeFileSync('temp/data/storage.im', 'book3-durumu');

  assert.strictEqual(fs.readFileSync(path.join(workRoot, 'book1', 'temp', 'data', 'storage.im'), 'utf8'), 'book1-durumu');
  assert.strictEqual(fs.readFileSync(path.join(workRoot, 'book3', 'temp', 'data', 'storage.im'), 'utf8'), 'book3-durumu');
  assert.notStrictEqual(shimBook1.readFileSync('temp/data/storage.im', 'utf8'), shimBook3.readFileSync('temp/data/storage.im', 'utf8'));
});

// --- Mutasyon kaniti ---
test('GERİLEME: __emppSubBook onekleme kaldirilirsa book1/book3 AYNI WORK dosyasini paylasir', () => {
  if (process.platform === 'win32') return;
  // Bozuk (K9-oncesi) formul: WORK HER ZAMAN WORK_ROOT, subBook onemsenmez.
  const oldWork = (workRoot) => workRoot;
  const workRoot = path.join(os.tmpdir(), 'empp-w9-mutasyon');
  assert.strictEqual(oldWork(workRoot), oldWork(workRoot), 'eski formulde book1/book3 AYNI WORK yolunu paylasiyordu (kanitin gucu)');

  // Gercek (duzeltilmis) davranis bunun onune gecer:
  const prevEnv = process.env.EMPP_WORK_DIR; process.env.EMPP_WORK_DIR = workRoot;
  const shimBook1 = install({ require: (n) => require(n), location: { pathname: '/tmp/x/index.html' }, __emppSubBook: 'book1' });
  const shimBook3 = install({ require: (n) => require(n), location: { pathname: '/tmp/x/index.html' }, __emppSubBook: 'book3' });
  process.env.EMPP_WORK_DIR = prevEnv;
  assert.notStrictEqual(shimBook1.__empp.WORK, shimBook3.__empp.WORK);
});

test('packagingService: shim index.html\'e enjekte edilir, main EMPP_WORK_DIR verir, asar mac/Linux/Android\'da AÇIK kalır — Windows hariç (sentinel)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../packaging/packagingService.js'), 'utf8');
  assert.ok(src.includes('empp-fs-shim.js'));
  assert.ok(src.includes("process.env.EMPP_WORK_DIR"));
  assert.ok(src.includes('EMPP_QUIT_ON_CLOSE'), 'macOS pencere kapanınca çıkış enjeksiyonu');
  // ASAR SENTİNELİ — KAPSAM DARALTILDI (2026-09-21).
  //
  // ESKİ HALİ: tüm dosyada `asar: false` literali arıyordu. Gerekçesi macOS
  // `codesign`'dır ve HÂLÂ GEÇERLİDİR: codesign .app içindeki HER dosyayı
  // `CodeResources`'a mühürler, 10 bin dosyalık açık ağacın imzalanması saatler
  // sürer. Ama bu ceza Windows'ta YOKTUR — NSIS kurulum exe'si TEK PARÇA imzalanır.
  // Windows'ta asar bir de zarar veriyordu: `app.asar` bir DOSYA olduğu için SET
  // güncelleme kanalının her yazması ENOTDIR veriyor ve `asarUnpack` bunu çözmüyor
  // (asar başlığı bir indekstir → kanaldan KİTAP EKLENEMİYOR).
  //
  // Bu yüzden sentinel artık DOSYANIN TAMAMINI değil, mac/Linux/Android platform
  // bloklarını tarar; Windows bloğu bilerek dışarıdadır (kendi kapısı ve testleri
  // var: src/packaging/windows-asarsiz.js + windows-asarsiz.test.js).
  //
  // Aynı anda GÜÇLENDİ: yalnız `asar: false` literalini değil, o bloklardaki HER
  // `asar:` anahtarını reddeder — `asar: 0`, `asar: gizliBayrak()` gibi bir yazım
  // eski sentineli sessizce atlatabiliyordu.
  {
    const isaretler = ['async packageWindows(', 'async packageMacOS(',
      'async packageLinux(', 'async packageAndroid('];
    const ofset = isaretler.map((im) => {
      const i = src.indexOf(im);
      assert.notStrictEqual(i, -1, `asar sentineli köreldi: "${im}" kaynakta yok`);
      return i;
    });
    for (let k = 1; k < ofset.length; k++) {
      assert.ok(ofset[k] > ofset[k - 1], 'platform fonksiyonlarının kaynak sırası değişmiş');
    }
    const winBlok = src.slice(ofset[0], ofset[1]);
    const macLinuxAndroid = src.slice(ofset[1]);
    assert.ok(!/\basar\s*:/.test(macLinuxAndroid),
      'mac/Linux/Android config\'ine asar anahtarı sızmış (10k dosya imzası saatler sürer)');
    assert.match(winBlok, /asar:\s*windowsAsarsiz\.asarSecenegi\(\)/,
      'Windows bloğu asar kararını kapıdan almıyor — düzen değişikliği pakete geçmez');
  }
  assert.ok(!/\} else \{\s*\n\s*\/\/ Mevcut main\.js/.test(src), 'main.js düzenleme bloğu else dalında kalmamalı (electron.js kopyalanınca atlanıyordu)');
});

test('kök-mutlak sahte yollar (/classlibraries/...) paket-göreli sayılır; gerçek kök (/Users) dokunulmaz', () => {
  const { base, work, shim } = fixture();
  const R = makeResolver(path, fs, work, base);
  assert.strictEqual(R.rel('/classlibraries/ImWin32.dll'), 'classlibraries/ImWin32.dll');
  assert.strictEqual(R.rel('/Users/x/y.txt'), null);
  shim.writeFileSync('/classlibraries/ImWin32.dll', '<keys/>');
  assert.ok(fs.existsSync(path.join(work, 'classlibraries/ImWin32.dll')));
  assert.strictEqual(shim.readFileSync('/classlibraries/ImWin32.dll', 'utf8'), '<keys/>');
});

test('readdir: work + paket birleşimi, tekrarsız', () => {
  const { work, shim } = fixture();
  shim.writeFileSync('assets/book2/imKeys.dll', 'k');
  assert.deepStrictEqual(shim.readdirSync('assets').sort(), ['book1', 'book2']);
  assert.deepStrictEqual(shim.readdirSync('assets/book1').sort(), ['data']);
  assert.throws(() => shim.readdirSync('assets/yok'));
  shim.readdir('assets', (err, list) => { assert.ifError(err); assert.strictEqual(list.length, 2); });
});

test('fetch: work\'te varsa oradan servis, yoksa gerçek fetch (anahtar deposu ImWin32.dll)', async () => {
  const { base, work, shim } = fixture();
  shim.writeFileSync('/classlibraries/ImWin32.dll', 'ENCRYPTED-KEYS');
  const calls = [];
  const win = { fetch: (u) => { calls.push(u); return Promise.resolve({ status: 200, real: true }); }, Response: class { constructor(body, init) { this.body = body; this.status = init.status; this.headers = init.headers; } } };
  installFetch(win, fs, path, work, base);
  const r = await win.fetch('classlibraries/ImWin32.dll');
  assert.strictEqual(r.status, 200); assert.strictEqual(r.headers['X-EMPP-Source'], 'work');
  assert.strictEqual(Buffer.from(r.body).toString(), 'ENCRYPTED-KEYS');
  const r2 = await win.fetch('assets/book1/data/BookContent.xml'); // work'te yok → gerçek fetch
  assert.strictEqual(r2.real, true);
  const r3 = await win.fetch('https://sorucoz.tv/x'); assert.strictEqual(r3.real, true);
  assert.deepStrictEqual(calls, ['assets/book1/data/BookContent.xml', 'https://sorucoz.tv/x']);
  assert.strictEqual(workPathForUrl('file://' + base + '/classlibraries/ImWin32.dll', path, fs, work, base), path.join(work, 'classlibraries/ImWin32.dll'));
});

// ---------------------------------------------------------------------------
// WINDOWS (2026-09-26, Windows paketleme sözleşmesi G1/G2) — shim Windows'ta ETKİN.
// Windows yolları `path.win32` + sahte fs ile ölçülür (Mac'te gerçek C:\ yok).
// ---------------------------------------------------------------------------
function winFs(varOlan = []) {
  const kume = new Set(varOlan.map((y) => y.toLowerCase()));
  return {
    existsSync: (y) => kume.has(String(y).toLowerCase()),
    statSync: () => ({ isFile: () => true }),
    mkdirSync: () => {},
  };
}

test('WINDOWS rel: BASE içi sürücü harfli yol göreli olur, WORK\'e yönlenir', () => {
  const BASE = 'C:\\Users\\ogr\\AppData\\Local\\Programs\\kitap\\resources\\app\\book1';
  const WORK = 'C:\\Users\\ogr\\AppData\\Roaming\\kitap\\work\\book1';
  const R = makeResolver(path.win32, winFs(), WORK, BASE);
  assert.strictEqual(R.rel(BASE + '\\classlibraries\\ImWin32.dll'), 'classlibraries\\ImWin32.dll');
  assert.strictEqual(R.toWork(BASE + '\\temp\\data\\storage.im'),
    WORK + '\\temp\\data\\storage.im');
  // Harf büyüklüğü farkı Windows'ta aynı yoldur.
  assert.strictEqual(R.rel(BASE.toUpperCase() + '\\imKeys.dll'), 'imKeys.dll');
});

test('WINDOWS rel: BASE/WORK dışı sürücü harfli ve UNC yol GERÇEK sistem yoludur — dokunulmaz', () => {
  const BASE = 'C:\\P\\app\\book1';
  const WORK = 'C:\\U\\work\\book1';
  const R = makeResolver(path.win32, winFs(), WORK, BASE);
  assert.strictEqual(R.rel('C:\\Users\\ogr\\Desktop\\a.pdf'), null, 'masaüstü dosyası WORK\'e kaçmamalı');
  assert.strictEqual(R.rel('D:\\yedek\\x.txt'), null, 'başka sürücü');
  assert.strictEqual(R.rel('\\\\sunucu\\paylasim\\x.txt'), null, 'UNC');
  assert.strictEqual(R.toWork('C:\\Users\\ogr\\Desktop\\a.pdf'), 'C:\\Users\\ogr\\Desktop\\a.pdf');
});

test('WINDOWS rel: sürücüsüz kök-mutlak sahte yol (\\classlibraries\\x) paket-göreli sayılır', () => {
  const R = makeResolver(path.win32, winFs(), 'C:\\U\\work', 'C:\\P\\app');
  assert.strictEqual(R.rel('/classlibraries/ImWin32.dll'), 'classlibraries/ImWin32.dll');
  assert.strictEqual(R.rel('\\temp\\data\\storage.im'), 'temp\\data\\storage.im');
  assert.strictEqual(R.rel('.\\temp\\a.txt'), 'temp\\a.txt');
});

test('WINDOWS workPathForUrl: file:///C:/… adresi BASE\'e göre çözülür, WORK kopyası servis edilir', () => {
  const BASE = 'C:\\P\\app\\book1';
  const WORK = 'C:\\U\\work\\book1';
  const hedef = WORK + '\\classlibraries\\ImWin32.dll';
  const f = winFs([hedef]);
  assert.strictEqual(
    workPathForUrl('file:///C:/P/app/book1/classlibraries/ImWin32.dll', path.win32, f, WORK, BASE), hedef);
  assert.strictEqual(
    workPathForUrl('file:///C:/P/app/book1/yok.txt', path.win32, f, WORK, BASE), null);
  assert.strictEqual(
    workPathForUrl('file:///D:/baska/classlibraries/ImWin32.dll', path.win32, f, WORK, BASE), null);
});

test('WINDOWS install: win32 sürecinde shim KURULUR, WORK = EMPP_WORK_DIR/<alt-kitap> (G1/G2)', () => {
  const kaynak = fs.readFileSync(require.resolve('./fs-shim.js'), 'utf8');
  assert.ok(!/platform\s*===\s*'win32'\)\s*return null/.test(kaynak), 'win32 erken dönüşü geri gelmiş');
  assert.ok(kaynak.includes('EMPP_FS_SHIM_WINDOWS_ETKIN'), 'kapının aradığı işaret yok');
  const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-win-base-'));
  const workKok = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-win-work-'));
  const mod = { exports: {} };
  const proc = { platform: 'win32', env: { EMPP_WORK_DIR: workKok } };
  new Function('module', 'exports', 'require', '__dirname', 'process', kaynak)(mod, mod.exports, require, BASE, proc);
  const win = { require: (n) => require(n), __emppSubBook: 'book2' };
  const shim = mod.exports.install(win);
  assert.ok(shim, 'win32\'de shim null döndü');
  assert.strictEqual(shim.__empp.WORK, path.join(workKok, 'book2'));
  win.require('fs').writeFileSync(path.join(BASE, 'temp', 'data', 'storage.im'), 'veri');
  assert.ok(fs.existsSync(path.join(workKok, 'book2', 'temp', 'data', 'storage.im')), 'yazma WORK\'e gitmedi');
  assert.ok(!fs.existsSync(path.join(BASE, 'temp', 'data', 'storage.im')), 'kurulum dizinine yazıldı');
});
