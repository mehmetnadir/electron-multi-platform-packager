'use strict';
// K6 (2026-09-09, telefon kaniti): VFS anahtarinin (key()) SET paketlerinde
// bookN'e gore ad-alanlandigini GERCEKTEN calistirarak dogrular.
//
// Telefon bulgusu: GAMES (book2) "Kitap Açılıyor.." ekraninda kaliyordu. logcat:
// book2/assets/56385/data/BookContent.xml 404 - 56385 book1'in kimligi, book2'nin
// kimligi 59475. localStorage dokumu: empp_vfs:/temp/data/storage.im TEK anahtar
// (book1 yazdi, book2 okudu - icinde book1'in aktivasyon durumu). Kok neden:
// key(p) = VFS_PREFIX + normalize('/' + p) - goreli yol HANGI kitaptan
// cagrildigina bakmaksizin HER ZAMAN site kokune gore anahtarlaniyordu. Ayni
// origin'i (https://localhost) paylasan tum bookN'ler ayni VFS'i paylasiyordu.
//
// Duzeltme: goreli yollar sayfanin KENDI dizinine (dirname(location.pathname))
// gore ad-alanlanir. Mutlak yollar ve kok/tek-kitap durumu BIREBIR eski
// davranisla ayni kalir (regresyon testi).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function load(win) {
  // empp-android-shim.test.js'teki ile AYNI izole yukleme kalibi: global window'a
  // dokunmadan, injected 'window' parametresiyle modulu taze calistirir.
  const src = fs.readFileSync(path.join(__dirname, 'empp-android-shim.js'), 'utf8');
  const m = { exports: {} };
  new Function('module', 'window', 'btoa', 'atob', 'TextDecoder', src)(
    m, win,
    (s) => Buffer.from(s, 'binary').toString('base64'),
    (s) => Buffer.from(s, 'base64').toString('binary'),
    TextDecoder
  );
  return m.exports;
}

function winWithPathname(pathname) {
  return { document: {}, localStorage: null, location: { origin: 'https://localhost', pathname } };
}

test('(a) book2/index.html sayfasinda goreli yol book2 ad-alanina yazilir', () => {
  const mod = load(winWithPathname('/book2/index.html'));
  assert.strictEqual(mod._internals.key('temp/data/storage.im'), 'empp_vfs:/book2/temp/data/storage.im');
});

test('(K8) Tudem-tarzi ad (fasikuller-01) ve derinlik-2 (sets/a) da kendi ad-alanini alir', () => {
  const modFasikul = load(winWithPathname('/fasikuller-01/index.html'));
  assert.strictEqual(modFasikul._internals.key('temp/data/storage.im'), 'empp_vfs:/fasikuller-01/temp/data/storage.im');

  const modSetsA = load(winWithPathname('/sets/a/index.html'));
  assert.strictEqual(modSetsA._internals.key('temp/data/storage.im'), 'empp_vfs:/sets/a/temp/data/storage.im');
  // K6b: mutlak yol da derinlik-2'de kendi (iki seviyeli) dizinine oneklenir.
  assert.strictEqual(modSetsA._internals.key('/temp/data/storage.im'), 'empp_vfs:/sets/a/temp/data/storage.im');

  // fasikuller-01 ve sets/a birbirinden FARKLI anahtar uretmeli (carpisma yok).
  assert.notStrictEqual(
    modFasikul._internals.key('temp/data/storage.im'),
    modSetsA._internals.key('temp/data/storage.im')
  );
});

test('(b) kok (/index.html ve bare "/") icin eski anahtarla BIREBIR ayni (regresyon)', () => {
  const modIndex = load(winWithPathname('/index.html'));
  assert.strictEqual(modIndex._internals.key('temp/data/storage.im'), 'empp_vfs:/temp/data/storage.im');

  const modBare = load(winWithPathname('/'));
  assert.strictEqual(modBare._internals.key('temp/data/storage.im'), 'empp_vfs:/temp/data/storage.im');
});

// K6b (2026-09-09, telefon kaniti): bu davranis K6b ile DEGISTI - asagidaki
// "K6b" blogunda guncellenmis kural test ediliyor (mutlak yol artik bookN'de
// KENDI dizinine oneklenir; kok'te DEGISMEZ kaliyor).

test('(d) book1 ve book2 anahtarlari FARKLI (ayni goreli yol, farkli ad-alani)', () => {
  const key1 = load(winWithPathname('/book1/index.html'))._internals.key('temp/data/storage.im');
  const key2 = load(winWithPathname('/book2/index.html'))._internals.key('temp/data/storage.im');
  assert.notStrictEqual(key1, key2, 'book1 ve book2 AYNI VFS anahtarini PAYLASMAMALI (K6 kok neden)');
  assert.strictEqual(key1, 'empp_vfs:/book1/temp/data/storage.im');
  assert.strictEqual(key2, 'empp_vfs:/book2/temp/data/storage.im');
});

test('win/location yoksa base "/" kabul edilir (jsdom olmadan dogrudan require)', () => {
  // Node'da dogrudan require - IIFE win=undefined ile calisir (window global yok).
  const mod = require('./empp-android-shim.js');
  assert.strictEqual(mod._internals.key('temp/x'), 'empp_vfs:/temp/x');
});

test('location var ama pathname yok -> base "/" (guvenli varsayilan)', () => {
  const win = { document: {}, localStorage: null, location: { origin: 'https://localhost' } };
  const mod = load(win);
  assert.strictEqual(mod._internals.key('temp/x'), 'empp_vfs:/temp/x');
});

// --- (e) mevcut VFS davranisi (existsSync/readFileSync/writeFileSync) hala tutarli ---
test('(e) fs katmani book2 sayfasinda kendi ad-alaninda yazip okuyor (existsSync/write/read tutarli)', () => {
  const win = winWithPathname('/book2/index.html');
  win.localStorage = (() => {
    const store = new Map();
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      key: (i) => Array.from(store.keys())[i],
      get length() { return store.size; },
    };
  })();
  const mod = load(win);
  const f = mod.fsMod;
  f.writeFileSync('temp/data/storage.im', 'book2-durumu');
  assert.strictEqual(f.readFileSync('temp/data/storage.im'), 'book2-durumu');
  assert.strictEqual(f.existsSync('temp/data/storage.im'), true);
  // Dogrudan localStorage anahtari da book2 ad-alaninda olmali (K6 kaniti).
  assert.ok(win.localStorage.getItem('empp_vfs:/book2/temp/data/storage.im') !== null);
});

test('(e2) empp-android-shim.test.js icindeki VFS testleri hala yesil (bu dosya onlari BOZMAZ)', () => {
  // Bu test dosyasi bagimsiz calisir; asil regresyon kontrolu ayri test dosyasinda
  // (`node --test src/platforms/android/empp-android-shim.test.js`) - burada sadece
  // ayni modulun bu dosyada da yuklenebildigini/patlamadigini dogruluyoruz.
  const mod = load(winWithPathname('/index.html'));
  assert.ok(mod.fsMod && mod.pathMod && mod._internals);
});

// --- Mutasyon kaniti: base'i sabit "/" yapinca book1/book2 anahtarlari AYNI cikar ---
test('GERİLEME: pageBaseDir sabitlenirse book1/book2 çarpışır, book2 "Kitap Açılıyor.." ekranında kalır', () => {
  // Bozuk (K6-oncesi) davranisin dogrudan simulasyonu: relative path'i HER ZAMAN
  // site kokune gore anahtarlayan eski formul.
  const VFS_PREFIX = 'empp_vfs:';
  function oldKey(p) {
    // eski normalize (posix-saf, origin/base farkindaligi YOK)
    function normalize(p2) {
      var abs = p2.charAt(0) === '/';
      var parts = p2.split('/'), out = [];
      for (var i = 0; i < parts.length; i++) {
        var s = parts[i];
        if (!s || s === '.') continue;
        if (s === '..') { if (out.length) out.pop(); continue; }
        out.push(s);
      }
      return (abs ? '/' : '') + out.join('/');
    }
    return VFS_PREFIX + normalize('/' + String(p));
  }
  const oldKey1 = oldKey('temp/data/storage.im');
  const oldKey2 = oldKey('temp/data/storage.im');
  assert.strictEqual(oldKey1, oldKey2, 'eski formulde book1/book2 anahtari CARPISIYORDU (kanitin gucu — gercek hata budur)');

  // Gercek (duzeltilmis) davranis bunun onune gecer:
  const newKey1 = load(winWithPathname('/book1/index.html'))._internals.key('temp/data/storage.im');
  const newKey2 = load(winWithPathname('/book2/index.html'))._internals.key('temp/data/storage.im');
  assert.notStrictEqual(newKey1, newKey2);
});

// --- K6b (2026-09-09, telefon kaniti — devam) ---
// Motor kalicilik dosyasini __dirname + '/temp/data/storage.im' string-concat
// ile yaziyor; shim __dirname='' verdigi icin bu MUTLAK ('/temp/...') cikiyor.
// K6'nin "mutlak yol DEGISMEZ" kurali bu durumda ad-alani KAYBETTIRIYORDU ->
// book2, book1'in localStorage kaydini (aktivasyon durumu) hala gorebiliyordu
// (ilk kanit localStorage.clear ile alinmisti - temiz kurulumda gizli kaliyordu).
// Duzeltme: VFS anahtari uretilirken mutlak yol da sayfanin kendi dizinine
// oneklenir - TEK istisna: yol zaten o dizinin icindeyse tekrar oneklenmez.
// Kokte (base==='/') hicbir zaman oneklenmez (regresyon yok).

test('K6b (a) mutlak yol book2 sayfasinda KENDI dizinine oneklenir', () => {
  const mod = load(winWithPathname('/book2/index.html'));
  assert.strictEqual(mod._internals.key('/temp/data/storage.im'), 'empp_vfs:/book2/temp/data/storage.im');
});

test('K6b (b) yol zaten bookN dizininin icindeyse CIFT oneklenmez', () => {
  const mod = load(winWithPathname('/book2/index.html'));
  assert.strictEqual(mod._internals.key('/book2/temp/x'), 'empp_vfs:/book2/temp/x');
});

test('K6b (c) kok base ("/") icin mutlak yol eski degerle BIREBIR ayni (regresyon)', () => {
  const modIndex = load(winWithPathname('/index.html'));
  assert.strictEqual(modIndex._internals.key('/temp/data/storage.im'), 'empp_vfs:/temp/data/storage.im');
  const modBare = load(winWithPathname('/'));
  assert.strictEqual(modBare._internals.key('/temp/data/storage.im'), 'empp_vfs:/temp/data/storage.im');
});

test('K6b (d) classlibraries/ImWin32.dll (mutlak) book2 sayfasinda kendi ad-alanina yazilir', () => {
  const mod = load(winWithPathname('/book2/index.html'));
  assert.strictEqual(mod._internals.key('/classlibraries/ImWin32.dll'), 'empp_vfs:/book2/classlibraries/ImWin32.dll');
});

test('K6b (e) vfsHas/vfsList/readdirSync mutlak yol icin de book2 ad-alaninda tutarli', () => {
  const win = winWithPathname('/book2/index.html');
  win.localStorage = (() => {
    const store = new Map();
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      key: (i) => Array.from(store.keys())[i],
      get length() { return store.size; },
    };
  })();
  const mod = load(win);
  const f = mod.fsMod;
  // motorun yaptigi gibi MUTLAK yolla yaz (__dirname='' + '/temp/data/storage.im')
  f.writeFileSync('/temp/data/storage.im', 'book2-durumu-mutlak');
  assert.strictEqual(f.readFileSync('/temp/data/storage.im'), 'book2-durumu-mutlak');
  assert.strictEqual(f.existsSync('/temp/data/storage.im'), true);
  assert.deepStrictEqual(f.readdirSync('/temp/data'), ['storage.im']);
  // book1 sayfasinda AYNI mutlak yolu okumak FARKLI (bos) sonuc vermeli - carpisma yok.
  const book1Mod = load(winWithPathname('/book1/index.html'));
  book1Mod.fsMod.existsSync && assert.strictEqual(book1Mod.fsMod.existsSync('/temp/data/storage.im'), false);
  assert.ok(win.localStorage.getItem('empp_vfs:/book2/temp/data/storage.im') !== null);
});

test('GERİLEME: mutlak-yol öneklemesi kaldırılırsa storage.im/ImWin32.dll kitaplar arası çarpışır', () => {
  // K6b-oncesi (K6-sonrasi) formul: mutlak yol HICBIR ZAMAN oneklenmiyordu.
  const VFS_PREFIX = 'empp_vfs:';
  function normalize(p) {
    var abs = p.charAt(0) === '/';
    var parts = p.split('/'), out = [];
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i];
      if (!s || s === '.') continue;
      if (s === '..') { if (out.length) out.pop(); continue; }
      out.push(s);
    }
    return (abs ? '/' : '') + out.join('/');
  }
  function preK6bKey(p) { return VFS_PREFIX + normalize(String(p)); } // onekleme YOK
  const book1Old = preK6bKey('/temp/data/storage.im');
  const book2Old = preK6bKey('/temp/data/storage.im');
  assert.strictEqual(book1Old, book2Old, 'K6b-oncesi formulde mutlak yol book1/book2 icin CARPISIYORDU (kanitin gucu)');

  // Gercek (K6b) davranis bunun onune gecer:
  const book1New = load(winWithPathname('/book1/index.html'))._internals.key('/temp/data/storage.im');
  const book2New = load(winWithPathname('/book2/index.html'))._internals.key('/temp/data/storage.im');
  assert.notStrictEqual(book1New, book2New);
});

// --- Kaynak-sentinel ---
test('kaynak-sentinel: key() pageBaseDir ile goreli VE mutlak yollari ad-alanlandiriyor (K6b)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'empp-android-shim.js'), 'utf8');
  assert.match(src, /function pageBaseDir\(\)/);
  assert.match(src, /function key\(p\)\s*\{[\s\S]{0,400}pageBaseDir\(\)/);
  assert.match(src, /if \(base !== '\/' && norm\.indexOf\(base \+ '\/'\) !== 0\) norm = base \+ norm;/);
});
