/* eslint-disable */
/**
 * EMPP Android (Capacitor) Node-uyumluluk katmani — index.html'de ILK script (2026-08-28).
 *
 * Yayinci bundle'i masaustu modunda window.require('fs'|'path'|'os'|'electron'|'adm-zip'|'https')
 * bekler; Capacitor WebView'da yok -> modul 6791 (getFilePath) yuklenemez, sayfa gorselleri hic
 * istenmez, anahtar deposu okunamaz. Bu katman:
 *   - path: posix join/dirname/basename/extname/resolve
 *   - fs: sanal dosya sistemi (yazma -> localStorage 'empp_vfs:'), okuma -> once VFS, yoksa yerel
 *     asset (senkron XHR, orijinal WebView XHR'i — CapacitorHttp yamasini atlar); readdir -> paketleme
 *     aninda uretilen empp-manifest.json
 *   - os/electron/adm-zip/https: zararsiz stub'lar (guncelleme indirme akisi hata verip gecer)
 *   - fetch: VFS'te olan goreli yol oradan servis edilir (ImWin32.dll fetch ile okunuyor)
 *   - window.__dirname = '' -> getFilePath goreli yol uretir
 * Electron fs-shim'i (empp-fs-shim.js) window.__emppFsShim gorunce kendini kurmaz.
 */
(function (win) {
  var isBrowser = typeof win !== 'undefined' && typeof win.document !== 'undefined';
  var VFS_PREFIX = 'empp_vfs:';
  var storage = null;
  try { storage = isBrowser ? win.localStorage : null; } catch (e) { storage = null; }

  // ---- path (posix) ----
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
  // K4 — NEDEN: kitap motoru "ana sayfa" navigasyonunda
  // path.join(path.dirname(window.location.href), '../') gibi TAM URL'lerle
  // calisiyor. Posix-saf `normalize` ardisik '/'leri (segment ayiracidir sanip)
  // yutuyor -> 'https://localhost/book1/../' -> 'https:/localhost' (origin'in
  // '//'si bir tek '/' ye dusuyor) -> '/index.html' eklenince WHATWG bunu AYNI
  // semada goreli cozup 'https://localhost/localhost/index.html' uretiyor.
  // BELİRTİ: telefonda "ana sayfa" dugmesine basinca ERR_HTTP_RESPONSE_CODE_FAILURE
  // (WebView bos ekran). KANIT: 2026-09-09, kitap 59480 - `home_59480.apk` (ve
  // sonraki her proof APK) extraction'inda bu joinOriginAware kodu birebir mevcut.
  // `_buildWebViewRequireShim` (eski compat shim, packagingService.js) origin'i
  // (`^scheme://host`) ayirip kalan yolu posix normalize eden, origin'e donen yolda
  // SONDA SLASH BIRAKMAYAN bir P.join tasiyordu; tam shim bunu kaybetmisti. Ayni
  // algoritma burada REPLIKE edilir. Origin'siz girdiler (VFS anahtarlari, relUrl,
  // manifest eslemesi) icin davranis BIREBIR ayni kalir - asagidaki origin dali
  // yoksa eski koda dokunulmamis gibi dusup dogrudan `normalize` cagrilir.
  // BOZARSAN: bu fonksiyonu (veya origin-ayristirma dalini) kaldirirsan
  // `empp-android-shim-path.test.js`'teki `GERİLEME: origin ayrıştırma kaldırılırsa
  // "ana sayfa" ERR_HTTP_RESPONSE_CODE_FAILURE verir` ve (a)/(a-root)/(b)/(c)
  // testleri kirilir.
  var ORIGIN_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\/]*)/;
  function joinOriginAware(joined) {
    var m = ORIGIN_RE.exec(joined);
    if (!m) return normalize(joined) || '.';
    var origin = m[1];
    var rest = joined.slice(origin.length);
    var abs = rest.charAt(0) === '/';
    var segs = rest.split('/'), out = [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s === '' || s === '.') continue;
      if (s === '..') {
        if (out.length && out[out.length - 1] !== '..') out.pop();
        else if (!abs) out.push('..');
        continue;
      }
      out.push(s);
    }
    var body = out.join('/');
    // Origin'e donen yolda body bossa SONDA SLASH BIRAKMA (yoksa '/index.html'
    // eklenince '//index.html' olusur, Capacitor ham '..' gibi bunu da reddeder).
    return origin + (body ? '/' + body : '');
  }
  var pathMod = {
    sep: '/',
    join: function () { var a = []; for (var i = 0; i < arguments.length; i++) { var s = arguments[i]; if (s === undefined || s === null) s = ''; s = String(s); if (s) a.push(s); } return joinOriginAware(a.join('/')); },
    resolve: function () { return pathMod.join.apply(null, arguments); },
    dirname: function (p) { p = String(p); var i = p.lastIndexOf('/'); return i <= 0 ? (i === 0 ? '/' : '.') : p.slice(0, i); },
    basename: function (p, ext) { p = String(p); var b = p.slice(p.lastIndexOf('/') + 1); return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; },
    extname: function (p) { var b = pathMod.basename(p); var i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
    isAbsolute: function (p) { return String(p).charAt(0) === '/'; },
    relative: function (a, b) { return String(b).replace(String(a), '').replace(/^\/+/, ''); },
    normalize: normalize,
    posix: null
  };
  pathMod.posix = pathMod;

  // ---- VFS ----
  // K6 — NEDEN: SET paketlerinde her bookN AYNI origin'i (https://localhost)
  // paylasir. Eskiden `key(p)` goreli yollari HER ZAMAN site kokune gore
  // anahtarliyordu ('/temp/...') - hangi kitaptan cagrildigina BAKMAKSIZIN.
  // Electron'da her kitabin KENDI temp/ dizini var; bu ad-alani kaybediliyordu.
  // BELİRTİ: book1 aktivasyon/anahtar durumunu localStorage'a yazdi
  // ('empp_vfs:/temp/data/storage.im'), book2 AYNI anahtari okudu (kendi 56385
  // degil book1'in kimligini gordu) -> "Kitap Açılıyor.." ekraninda kaliyordu
  // (logcat: book2/assets/56385/data/BookContent.xml 404).
  // Duzeltme: goreli yollar (basinda '/' YOK) sayfanin kendi dizinine gore
  // ad-alanlanir (`dirname(location.pathname)`). Kokte tek kitapta base='/'
  // oldugu icin sonuc BIREBIR eski anahtarla ayni (regresyon yok, asagida test
  // edilir).
  // KANIT: 2026-09-09, kitap 59480 - `vfs_59480.apk` extraction'inda book2/
  // empp-android-shim.js icinde bu pageBaseDir/key() kodu birebir mevcut.
  // BOZARSAN: `empp-android-shim-vfs-key.test.js`'teki `GERİLEME: pageBaseDir
  // sabitlenirse book1/book2 çarpışır...` ve (a)/(b)/(d) testleri kirilir.
  function pageBaseDir() {
    try {
      var pn = (win && win.location && typeof win.location.pathname === 'string') ? win.location.pathname : '/';
      return pathMod.dirname(pn) || '/';
    } catch (e) { return '/'; }
  }
  // K6b — NEDEN: motor kalicilik dosyasini (`temp/data/storage.im`,
  // `classlibraries/ImWin32.dll`) `__dirname + '/...'` string-concat ile yaziyor;
  // shim `window.__dirname=''` verdigi icin bu MUTLAK ('/temp/...') cikiyor -> K6'nin
  // "mutlak yol DEGISMEZ" kuraliyla ad-alansiz kaliyor.
  // BELİRTİ: temiz kurulumda (localStorage.clear SONRASI) book1 -> menü -> book2
  // döngüsünde kitaplar arasi carpisma (book2 book1'in localStorage kaydini
  // goruyor) hala mumkundü — ilk K6 kanitinda gizli kaliyordu.
  // Duzeltme: mutlak yol da (VFS anahtari uretilirken) sayfanin kendi dizinine
  // oneklenir - TEK istisna: yol zaten o dizinin icindeyse (`base + '/'` ile
  // basliyorsa) tekrar oneklenmez. Kokte (base==='/') hicbir zaman oneklenmez ->
  // eski anahtarla BIREBIR ayni (regresyon yok). `relUrl` BILEREK DOKUNULMADI
  // (asset XHR yollarini '/book3/book3/...' yapardi - denendi, geri alindi).
  // KANIT: 2026-09-09, kitap 59480 - `vfs2_59480.apk` extraction'inda bu
  // onekleme kurali (`base !== '/' && norm.indexOf(base + '/') !== 0`) birebir
  // mevcut; telefonda 3 kitap (1/240, 59475 1/1, 59474 1/1) hepsi kendi kimligiyle
  // acildi.
  // BOZARSAN: `empp-android-shim-vfs-key.test.js`'teki `GERİLEME: mutlak-yol
  // öneklemesi kaldırılırsa storage.im/ImWin32.dll kitaplar arası çarpışır` ve
  // `K6b (a)/(d)/(e)` testleri + kaynak-sentinel kirilir.
  function key(p) {
    p = String(p);
    var base = pageBaseDir();
    var norm = normalize(p.charAt(0) === '/' ? p : base + '/' + p);
    if (base !== '/' && norm.indexOf(base + '/') !== 0) norm = base + norm;
    return VFS_PREFIX + norm;
  }
  // relUrl (XHR yolu) BILEREK DOKUNULMADI: tarayici zaten goreli URL'i sayfanin
  // kendi konumuna gore cozer (ayni ad-alani sorunu XHR icin zaten yok).
  function relUrl(p) { return normalize('/' + String(p)).replace(/^\/+/, ''); }
  function toText(data) {
    if (data == null) return '';
    if (typeof data === 'string') return data;
    if (data instanceof Uint8Array || (data && data.buffer instanceof ArrayBuffer)) {
      var u = data instanceof Uint8Array ? data : new Uint8Array(data.buffer);
      var s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
      return ' b64:' + btoa(s);
    }
    return String(data);
  }
  function fromStored(v, encoding) {
    if (v == null) return null;
    if (v.indexOf(' b64:') === 0) {
      var bin = atob(v.slice(5)); var u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return encoding ? new TextDecoder().decode(u) : u;
    }
    return v;
  }
  // CapacitorHttp XHR'ı yamalar ve SENKRON istekte status 0 döner; orijinal prototip
  // metodları window.CapacitorWebXMLHttpRequest.{open,send} olarak saklanır (constructor
  // değil!). Gerçek XHR üzerinde orijinal open/send çağrılınca senkron yerel okuma çalışır.
  function makeXhr() {
    if (!isBrowser || !win.XMLHttpRequest) return null;
    var x = new win.XMLHttpRequest();
    var o = win.CapacitorWebXMLHttpRequest;
    var open = (o && typeof o.open === 'function') ? o.open : x.open;
    var send = (o && typeof o.send === 'function') ? o.send : x.send;
    return { x: x, open: function (m, u, a) { return open.call(x, m, u, a); }, send: function (b) { return send.call(x, b); } };
  }
  function syncGet(url, asBinary) {
    var h = makeXhr(); if (!h) return null;
    try {
      var x = h.x; h.open('GET', url, false);
      if (asBinary && x.overrideMimeType) x.overrideMimeType('text/plain; charset=x-user-defined');
      h.send(null);
      if (x.status >= 200 && x.status < 300) {
        if (!asBinary) return x.responseText;
        var t = x.responseText, u = new Uint8Array(t.length);
        for (var i = 0; i < t.length; i++) u[i] = t.charCodeAt(i) & 0xff;
        return u;
      }
    } catch (e) { /* yok */ }
    return null;
  }
  function syncHead(url) {
    var h = makeXhr(); if (!h) return false;
    try { h.open('HEAD', url, false); h.send(null); return h.x.status >= 200 && h.x.status < 300; } catch (e) { return false; }
  }
  var manifest = null;
  function getManifest() {
    if (manifest) return manifest;
    var t = syncGet('empp-manifest.json', false);
    try { manifest = t ? JSON.parse(t) : {}; } catch (e) { manifest = {}; }
    return manifest;
  }
  function vfsHas(p) { try { return !!storage && storage.getItem(key(p)) !== null; } catch (e) { return false; } }
  function vfsDirHas(p) {
    if (!storage) return false;
    var pre = key(p).replace(/\/+$/, '') + '/';
    try { for (var i = 0; i < storage.length; i++) if (storage.key(i).indexOf(pre) === 0) return true; } catch (e) {}
    return false;
  }
  function vfsList(p) {
    var names = {};
    if (!storage) return [];
    var pre = key(p).replace(/\/+$/, '') + '/';
    try { for (var i = 0; i < storage.length; i++) { var k = storage.key(i); if (k.indexOf(pre) === 0) names[k.slice(pre.length).split('/')[0]] = 1; } } catch (e) {}
    return Object.keys(names);
  }
  function enoent(p) { var err = new Error('ENOENT: no such file or directory, ' + p); err.code = 'ENOENT'; return err; }
  var fsMod = {
    existsSync: function (p) {
      if (vfsHas(p) || vfsDirHas(p)) return true;
      var m = getManifest(); var rp = relUrl(p);
      if (m.dirs && m.dirs.indexOf(rp) !== -1) return true;
      if (m.files && m.files.indexOf(rp) !== -1) return true;
      if (/\.(dll|xml|json|txt|im|png|jpg|jpeg|svg)$/i.test(rp)) return syncHead(rp);
      return false;
    },
    readFileSync: function (p, enc) {
      var encoding = enc && typeof enc === 'object' ? enc.encoding : enc;
      var v = fromStored(storage ? storage.getItem(key(p)) : null, encoding);
      if (v !== null) return v;
      var t = syncGet(relUrl(p), !encoding);
      if (t === null) throw enoent(p);
      return t;
    },
    writeFileSync: function (p, data) { try { storage.setItem(key(p), toText(data)); } catch (e) { console.warn('[empp-android] writeFileSync', e && e.message); } },
    appendFileSync: function (p, data) { var cur = storage ? storage.getItem(key(p)) : null; fsMod.writeFileSync(p, (cur || '') + toText(data)); },
    writeFile: function (p, data, opts, cb) { if (typeof opts === 'function') cb = opts; fsMod.writeFileSync(p, data); if (cb) cb(null); },
    readFile: function (p, opts, cb) { if (typeof opts === 'function') { cb = opts; opts = null; } try { cb(null, fsMod.readFileSync(p, opts)); } catch (e) { cb(e); } },
    unlinkSync: function (p) { try { storage.removeItem(key(p)); } catch (e) {} },
    unlink: function (p, cb) { fsMod.unlinkSync(p); if (cb) cb(null); },
    rmSync: function (p) { fsMod.unlinkSync(p); },
    rm: function (p, o, cb) { if (typeof o === 'function') cb = o; fsMod.unlinkSync(p); if (cb) cb(null); },
    rmdirSync: function () {},
    mkdirSync: function () {},
    mkdir: function (p, o, cb) { if (typeof o === 'function') cb = o; if (cb) cb(null); },
    renameSync: function (a, b) { var v = storage.getItem(key(a)); if (v !== null) { storage.setItem(key(b), v); storage.removeItem(key(a)); } },
    rename: function (a, b, cb) { fsMod.renameSync(a, b); if (cb) cb(null); },
    copyFileSync: function (a, b) { try { storage.setItem(key(b), toText(fsMod.readFileSync(a))); } catch (e) {} },
    copyFile: function (a, b, cb) { fsMod.copyFileSync(a, b); if (cb) cb(null); },
    readdirSync: function (p, opts) {
      var m = getManifest(); var rp = relUrl(p);
      var base = (m.tree && m.tree[rp]) || []; var extra = vfsList(p); var all = base.slice();
      for (var i = 0; i < extra.length; i++) if (all.indexOf(extra[i]) === -1) all.push(extra[i]);
      if (opts && opts.withFileTypes) {
        return all.map(function (n) {
          var full = rp ? rp + '/' + n : n;
          var isDir = !!(m.tree && m.tree[full]) || !!(m.dirs && m.dirs.indexOf(full) !== -1);
          return { name: n, isDirectory: function () { return isDir; }, isFile: function () { return !isDir; } };
        });
      }
      return all;
    },
    readdir: function (p, o, cb) { if (typeof o === 'function') { cb = o; o = null; } try { cb(null, fsMod.readdirSync(p, o)); } catch (e) { cb(e); } },
    statSync: function (p) {
      var isDir = !vfsHas(p) && (vfsDirHas(p) || !!(getManifest().tree || {})[relUrl(p)]);
      return { isFile: function () { return !isDir; }, isDirectory: function () { return isDir; }, size: 0, mtime: new Date() };
    },
    lstatSync: function (p) { return fsMod.statSync(p); },
    createWriteStream: function (p) {
      var buf = ''; var h = {};
      return {
        write: function (d) { buf += toText(d); return true; },
        end: function (d) { if (d) buf += toText(d); fsMod.writeFileSync(p, buf); if (h.finish) h.finish(); },
        close: function () {},
        on: function (ev, fn) { h[ev] = fn; return this; },
        once: function (ev, fn) { h[ev] = fn; return this; }
      };
    },
    createReadStream: function () {
      return { on: function (ev, fn) { if (ev === 'error') setTimeout(function () { fn(new Error('not supported')); }, 0); return this; }, pipe: function () { return this; } };
    }
  };
  fsMod.promises = {
    readFile: function (p, o) { return new Promise(function (res, rej) { fsMod.readFile(p, o, function (e, d) { if (e) rej(e); else res(d); }); }); },
    writeFile: function (p, d) { fsMod.writeFileSync(p, d); return Promise.resolve(); }
  };

  var osMod = { networkInterfaces: function () { return {}; }, platform: function () { return 'android'; }, homedir: function () { return '/'; }, tmpdir: function () { return '/tmp'; }, EOL: '\n' };
  var electronMod = {
    shell: { openPath: function () { return Promise.resolve(''); }, openExternal: function (u) { try { win.open(u, '_blank'); } catch (e) {} return Promise.resolve(); } },
    ipcRenderer: { on: function () {}, send: function () {}, invoke: function () { return Promise.resolve(); } },
    remote: undefined,
    app: undefined
  };
  function AdmZip() {}
  AdmZip.prototype.extractAllTo = function () {};
  AdmZip.prototype.getEntries = function () { return []; };
  var httpsMod = {
    get: function (url, cb) {
      var h = {};
      setTimeout(function () { if (h.error) h.error(new Error('https.get not supported in WebView')); }, 0);
      return { on: function (ev, fn) { h[ev] = fn; return this; } };
    }
  };
  var modules = { fs: fsMod, path: pathMod, os: osMod, electron: electronMod, 'adm-zip': AdmZip, https: httpsMod, http: httpsMod };

  function requireFn(name) {
    if (modules[name]) return modules[name];
    var err = new Error("Cannot find module '" + name + "'"); err.code = 'MODULE_NOT_FOUND'; throw err;
  }

  function installFetch() {
    var real = win.fetch;
    if (typeof real !== 'function' || real.__emppAndroid) return;
    var wrapped = function (input, init) {
      try {
        var url = (input && typeof input === 'object' && 'url' in input) ? input.url : String(input);
        if (!/^(https?|data|blob):/i.test(url) || url.indexOf(win.location.origin) === 0) {
          var rel = url.replace(win.location.origin, '').split(/[?#]/)[0];
          if (vfsHas(rel)) {
            var v = fromStored(storage.getItem(key(rel)));
            return Promise.resolve(new win.Response(v, { status: 200, headers: { 'X-EMPP-Source': 'vfs' } }));
          }
        }
      } catch (e) { /* dus */ }
      return real.apply(this, arguments);
    };
    wrapped.__emppAndroid = true;
    win.fetch = wrapped;
  }

  // (2026-08-28, K3'ten ONCE) — NEDEN: CapacitorHttp, XMLHttpRequest.prototype.open/
  // send'i yamalar; SENKRON isteklerde status 0 döner (async isteklerde sorun yok).
  // BELİRTİ: telefonda yayıncı bundle'ı `pages2x/` var mı diye senkron HEAD atıp
  // `404 != status` diye bakıyor → 0 ≠ 404 → "var" sanıp retina klasörüne gidiyor →
  // gerçek 404 → sayfa boş.
  // Çözüm: sync (async=false) isteklerde orijinal open/send (CapacitorWebXMLHttpRequest)
  // kullanılır; async istekler Capacitor'ın yamalı yoluna bırakılır.
  // KANIT: her proof APK'da (fixed_45538.apk'tan vfs2_59480.apk'ya) bu kurucu-sarma
  // kodu birebir mevcut — hiçbir tur bunu geri almadı.
  // BOZARSAN: `empp-android-shim.test.js`'teki `CapacitorHttp yamalı XHR: orijinal
  // open/send (CapacitorWebXMLHttpRequest) kullanılır` ve `uygulamanın kendi senkron
  // XHR HEAD'i (pages2x kontrolü) gerçek statüyü görür` testleri kırılır.
  function installSyncXhr() {
    var Cap = win.XMLHttpRequest, o = win.CapacitorWebXMLHttpRequest;
    if (!Cap || Cap.__emppWrapped || !o || typeof o.open !== 'function' || typeof o.send !== 'function') return;
    // Capacitor window.XMLHttpRequest'i KURUCU düzeyinde sarar (örnekler başka prototipten gelir);
    // prototip yaması işe yaramaz. Kurucu sarılır, örneğe kendi open/send'i (own property) yazılır:
    // sync → orijinal (o.open/o.send), async → Capacitor'ın yamalı yolu.
    function EmppXHR() {
      var x = new Cap();
      var capOpen = x.open, capSend = x.send;
      Object.defineProperty(x, 'open', { configurable: true, writable: true, value: function (m, u, a) { x.__emppSync = (a === false); return (x.__emppSync ? o.open : capOpen).apply(x, arguments); } });
      Object.defineProperty(x, 'send', { configurable: true, writable: true, value: function () { return (x.__emppSync ? o.send : capSend).apply(x, arguments); } });
      return x;
    }
    EmppXHR.prototype = Cap.prototype;
    ['UNSENT', 'OPENED', 'HEADERS_RECEIVED', 'LOADING', 'DONE'].forEach(function (k, i) { EmppXHR[k] = i; });
    EmppXHR.__emppWrapped = true;
    win.XMLHttpRequest = EmppXHR;
  }

  function install() {
    if (!isBrowser) return null;
    if (typeof win.require === 'function' && !win.__emppAndroidShim) return null; // gercek Node (Electron) — dokunma
    win.__emppFsShim = win.__emppFsShim || { android: true }; // Electron fs-shim kurulmasin
    win.__emppAndroidShim = { fs: fsMod, path: pathMod, VFS_PREFIX: VFS_PREFIX };
    win.require = requireFn;
    if (typeof win.__dirname === 'undefined') win.__dirname = '';
    if (typeof win.process === 'undefined') win.process = { env: {}, platform: 'android', versions: {} };
    installFetch();
    installSyncXhr();
    return win.__emppAndroidShim;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { pathMod: pathMod, fsMod: fsMod, install: install, normalize: normalize, _internals: { key: key, relUrl: relUrl, toText: toText, fromStored: fromStored } };
  }
  if (isBrowser) install();
})(typeof window !== 'undefined' ? window : undefined);
