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
 *   - cevrimici yoklamasi (KAPI, varsayilan KAPALI): motorun no-cors HEAD canlilik yoklamasi
 *     WebView/kopru yerine yerel CapacitorHttp eklentisiyle GET olarak sorulur (bkz. installFetch)
 * Electron fs-shim'i (empp-fs-shim.js) window.__emppFsShim gorunce kendini kurmaz.
 */
(function (win) {
  var isBrowser = typeof win !== 'undefined' && typeof win.document !== 'undefined';
  var VFS_PREFIX = 'empp_vfs:';
  var storage = null;
  try { storage = isBrowser ? win.localStorage : null; } catch (e) { storage = null; }

  // CEVRIMICI YOKLAMASI — NEDEN (2026-09-26, webview-ag bulgusu, paket 74451): Impark motoru
  // acilista BIR KEZ `fetch(AppConfig.baseEndpointUrl, {method:'HEAD', mode:'no-cors'})` atar;
  // soz tutulursa window.isOnline=true, reddedilirse false ve sonraki HER http fetch'i
  // "Network is offline" ile keser (guncelleme sorusu GetKitapGuncellemeBilgi, cevrimici
  // aktivasyon, IsZKitapKurumAktif, cozum/konu linkleri, bizim oto-guncelleme taramamiz).
  // Yayinci koku (besegitim.com, mec.yayincilik.net, sorucoz.tv) tarayici benzeri istege
  // Cloudflare challenge 403 doner ve `Cross-Origin-Resource-Policy: same-origin` tasir. Iki yol da
  // duser (emulatorde olculdu 26.09): (1) CapacitorHttp koprusu (_capacitor_http_interceptor_,
  // HttpURLConnection + WebView UA) govdesiz HEAD 403'te getInputStream FileNotFoundException ->
  // fetch reddi; (2) WebView'in yamasiz fetch'i (CapacitorWebFetch) no-cors cevabi CORP yuzunden
  // ag hatasina cevirir. Electron'da webSecurity:false -> CORS/CORP denetimi yok -> 403 opak
  // cevapla COZULUR, bu yuzden masaustu etkilenmez.
  // COZUM: yalniz `mode:'no-cors'` + HEAD + dis http(s) istegi (motorun canlilik yoklamasi) yerel
  // CapacitorHttp eklentisine GET olarak, WebView basliklari OLMADAN sorulur: HERHANGI bir HTTP
  // cevabi (403 dahil, govdeli) -> cozulur (cevrimici); ag hatasi / navigator.onLine=false ->
  // reddedilir (cevrimdisi). Electron'la ayni anlam. Motorun `timeout`u (5 sn) baglanti+okuma
  // sinirina cevrilir (tarayici yok sayar; ust duzey await acilisi kilitlemesin).
  // Aktivasyon/API istekleri (cors GET/POST) CapacitorHttp koprusunde KALIR.
  // KAPI: varsayilan KAPALI. Paketleyici EMPP_ANDROID_CEVRIMICI=1 ile derlerken asagidaki satiri
  // `true` yapar (cevrimici-yoklama.js shimMetni — satir METNI birebir eslesir, degistirme).
  // BOZARSAN: empp-android-shim-cevrimici.test.js kirilir.
  var CEVRIMICI_YOKLAMA = false; // EMPP_ANDROID_CEVRIMICI
  function cevrimiciYoklamaMi(input, init, origin) {
    var istek = (input && typeof input === 'object') ? input : null;
    var url = istek && 'url' in istek ? String(istek.url) : String(input);
    var yontem = String((init && init.method) || (istek && istek.method) || 'GET').toUpperCase();
    var kip = String((init && init.mode) || (istek && istek.mode) || '').toLowerCase();
    return kip === 'no-cors' && yontem === 'HEAD' && /^https?:\/\//i.test(url)
      && !(origin && url.indexOf(origin) === 0);
  }
  function yerelHttp(C) {
    if (C && typeof C.nativePromise === 'function') return function (o) { return C.nativePromise('CapacitorHttp', 'request', o); };
    var P = C && C.Plugins && C.Plugins.CapacitorHttp;
    if (P && typeof P.request === 'function') return function (o) { return P.request(o); };
    return null;
  }
  // Donus: Promise<Response> ya da (eklenti yoksa) null -> cagiran eski yola duser.
  function cevrimiciYokla(input, init) {
    var iste = yerelHttp(isBrowser ? win.Capacitor : null);
    if (!iste) return null;
    var url = (input && typeof input === 'object' && 'url' in input) ? String(input.url) : String(input);
    try { console.log('[empp-android] cevrimici yoklamasi yerel GET ile (kopru/WebView disi): ' + url); } catch (e) {}
    if (win.navigator && win.navigator.onLine === false) return Promise.reject(new TypeError('Failed to fetch'));
    var o = { url: url, method: 'GET', headers: {} };
    var sure = Number(init && init.timeout);
    if (sure > 0) { o.connectTimeout = sure; o.readTimeout = sure; }
    return Promise.resolve().then(function () { return iste(o); }).then(function (r) {
      var st = Number(r && r.status);
      try { console.log('[empp-android] cevrimici yoklamasi: HTTP ' + st + ' -> cevrimici'); } catch (e) {}
      return new win.Response(null, { status: st >= 200 && st <= 599 ? st : 200 });
    }, function (e) {
      try { console.log('[empp-android] cevrimici yoklamasi: ag hatasi -> cevrimdisi (' + ((e && e.message) || e) + ')'); } catch (x) {}
      throw new TypeError('Failed to fetch');
    });
  }

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
    // K8: motor zip'i `path.parse(zipYolu).dir` altina acar; parse yoktu -> TypeError.
    parse: function (p) {
      p = String(p);
      var d = pathMod.dirname(p), b = pathMod.basename(p), e = pathMod.extname(p);
      return { root: p.charAt(0) === '/' ? '/' : '', dir: d === '.' ? '' : d, base: b, ext: e,
        name: e ? b.slice(0, -e.length) : b };
    },
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
      if (indirilmis(mutlakYol(p))) return true; // K8: indirilen kitap
      var m = getManifest(); var rp = relUrl(p);
      if (m.dirs && m.dirs.indexOf(rp) !== -1) return true;
      if (m.files && m.files.indexOf(rp) !== -1) return true;
      if (/\.(dll|xml|json|txt|im|png|jpg|jpeg|svg)$/i.test(rp)) return syncHead(rp);
      return false;
    },
    readFileSync: function (p, enc) {
      var encoding = enc && typeof enc === 'object' ? enc.encoding : enc;
      var v = fromStored(storage ? storage.getItem(key(p)) : null, encoding);
      if (v === null) v = syncGet(relUrl(p), !encoding);
      if (v === null) throw enoent(p);
      // K9: arka planda guncellenen kitabin surumu menuye islenir.
      if (typeof v === 'string' && /ImWin32\.dll$/i.test(String(p))) v = kapakSuzMetin(menuDllYamasi(v));
      // A1: kodlamasız okuma (bayt) da süzülür.
      else if (KAPAK && imwinYoluMu(p) && v && typeof v === 'object' && typeof TextEncoder !== 'undefined') {
        var sz = kapakSuzMetin(menuDllYamasi(metneCevir(v)));
        v = new TextEncoder().encode(sz);
      }
      return v;
    },
    writeFileSync: function (p, data) {
      // A1: kapak kipinde ImWin32 yazması birleştirilir ya da (dar/çözülemez) ATLANIR — aynen yazılmaz.
      if (KAPAK && imwinYoluMu(p) && kapakYaz(p, data) !== 'aynen') return;
      try { storage.setItem(key(p), toText(data)); } catch (e) { console.warn('[empp-android] writeFileSync', e && e.message); }
    },
    appendFileSync: function (p, data) { var cur = storage ? storage.getItem(key(p)) : null; fsMod.writeFileSync(p, (cur || '') + toText(data)); },
    writeFile: function (p, data, opts, cb) { if (typeof opts === 'function') cb = opts; fsMod.writeFileSync(p, data); if (cb) cb(null); },
    readFile: function (p, opts, cb) { if (typeof opts === 'function') { cb = opts; opts = null; } try { cb(null, fsMod.readFileSync(p, opts)); } catch (e) { cb(e); } },
    unlinkSync: function (p) { delete bellekDosyalari[yolAnahtari(p)]; try { storage.removeItem(key(p)); } catch (e) {} },
    unlink: function (p, cb) { fsMod.unlinkSync(p); if (cb) cb(null); },
    rmSync: function (p) { fsMod.unlinkSync(p); },
    rm: function (p, o, cb) { if (typeof o === 'function') cb = o; fsMod.unlinkSync(p); if (cb) cb(null); },
    rmdirSync: function () {},
    // K8: motorun readFile'i once `fs.open(p,'a+',cb)` cagiriyor ("a.open is not a function").
    open: function (p, f, m, cb) { cb = [f, m, cb].filter(function (x) { return typeof x === 'function'; })[0]; if (cb) cb(null, 3); },
    close: function (fd, cb) { if (typeof cb === 'function') cb(null); },
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
    // K8: parcalar ikili olarak toplanir; zip/buyuk ikili localStorage'a DEGIL bellege
    // (Blob) gider — 10-60 MB'lik kitap zip'i localStorage'a sigmaz.
    createWriteStream: function (p) {
      var parcalar = []; var h = {}; var bitti = false;
      var ws = {
        write: function (d) { if (d != null) parcalar.push(d); return true; },
        end: function (d) {
          if (bitti) return; bitti = true;
          if (d != null) parcalar.push(d);
          try { akisDosyasiYaz(p, parcalar); } catch (e) { if (h.error) { h.error(e); return; } }
          if (h.finish) h.finish();
          if (h.close) h.close();
        },
        close: function () {},
        on: function (ev, fn) { h[ev] = fn; return ws; },
        once: function (ev, fn) { h[ev] = fn; return ws; }
      };
      return ws;
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
  // K8 — NEDEN (2026-09-22): kitap kartindaki mavi (indir) / yesil (guncelle) bulut
  // %0'da takili kaliyordu. Motorun indirme zinciri masaustu Node API'si ister:
  // `https.get(url, res => res.on('data') + res.pipe(fs.createWriteStream(zip)))`
  // -> `new AdmZip(zip).extractAllTo(path.parse(zip).dir)` -> `fs.unlinkSync(zip)`.
  // Burada https bir saplamaydi (hemen 'https.get not supported in WebView' hatasi),
  // AdmZip hicbir sey yapmiyordu, path.parse yoktu; motor hatayi yakalamadigi icin
  // kart "indiriliyor %0"da kaliyordu.
  // KANIT: BES Yabanci Dil (paket 74451) logcat; sunucu tarafi saglam —
  // GetKitapGuncellemeBilgi 200, ZKitapZipH/70465-1.zip 10,5 MB, CORS '*'.
  // Cozum: https.get gercek fetch akisi (ilerleme 'data' olaylariyla gelir); zip
  // bellekte (Blob) toplanir, merkez dizinden okunup DecompressionStream('deflate-raw')
  // ile acilir, her dosya Cache Storage'a kitabin KENDI adresiyle yazilir
  // ('https://localhost/assets/<id>/pages/1.png'). Indirilen dosya listesi localStorage'da
  // kucuk bir dizin olarak tutulur (existsSync senkron cevap verebilsin). fetch ve <img>
  // indirilmis dosyayi APK'daki kopyanin ONUNE koyar; yoksa APK kopyasi okunur.
  // Guncellemede once dizin silinir (okuma APK'ya duser), eski girdiler temizlenir,
  // yenileri yazilir, dizin EN SON yazilir — yarim acilan kitap asla "var" gorunmez.
  // BOZARSAN: `empp-android-shim-indirme.test.js` kirilir.
  var KITAP_CACHE = 'empp-kitap-v1';
  var INDIRILEN_ONEK = 'empp_indirilen:';
  var ZIP_BELLEK_ESIGI = 1024 * 1024;
  var bellekDosyalari = {};
  var ortam = {
    caches: null,
    storage: storage,
    origin: (isBrowser && win.location && win.location.origin) || 'https://localhost'
  };
  var indirilenOnbellek = null;

  function yolAnahtari(p) { return normalize('/' + String(p)); }
  function cozUrl(u) { try { return decodeURI(u); } catch (e) { return u; } }
  // Yerel yolu sayfa kokune gore mutlak yola cevirir; baska host / data / blob -> null.
  function mutlakYol(p) {
    if (p == null) return null;
    p = String(p).split(/[?#]/)[0];
    var o = ortam.origin;
    if (o && p.indexOf(o + '/') === 0) p = p.slice(o.length);
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p) || p.indexOf('//') === 0) return null;
    return p.charAt(0) === '/' ? normalize(p) : normalize(pageBaseDir() + '/' + p);
  }
  function cachesAl() { return ortam.caches || (isBrowser && win.caches) || null; }
  function indirilenler() {
    if (indirilenOnbellek) return indirilenOnbellek;
    var m = {}, st = ortam.storage;
    try {
      for (var i = 0; st && i < st.length; i++) {
        var k = st.key(i);
        if (k && k.indexOf(INDIRILEN_ONEK) === 0) m[k.slice(INDIRILEN_ONEK.length)] = JSON.parse(st.getItem(k)) || [];
      }
    } catch (e) { /* bozuk dizin -> APK kopyasi okunur */ }
    indirilenOnbellek = m;
    return m;
  }
  function indirilenYaz(dizin, adlar) {
    indirilenOnbellek = null;
    var st = ortam.storage; if (!st) return;
    if (adlar) st.setItem(INDIRILEN_ONEK + dizin, JSON.stringify(adlar));
    else st.removeItem(INDIRILEN_ONEK + dizin);
  }
  // 'dosya' | 'dizin' | false
  function indirilmis(yol) {
    if (!yol) return false;
    var m = indirilenler();
    for (var d in m) {
      if (yol === d) return 'dizin';
      if (yol.indexOf(d + '/') !== 0) continue;
      var geri = yol.slice(d.length + 1), l = m[d];
      if (l.indexOf(geri) !== -1) return 'dosya';
      for (var i = 0; i < l.length; i++) if (l[i].indexOf(geri + '/') === 0) return 'dizin';
    }
    return false;
  }
  function indirilenYanit(yol) {
    var c = cachesAl();
    if (!c) return Promise.resolve(null);
    return c.open(KITAP_CACHE)
      .then(function (k) { return k.match(ortam.origin + yol); })
      .then(function (r) { return r || null; }, function () { return null; });
  }
  function imgIndirilen(el) {
    var src = el.getAttribute('src');
    if (!src || el.__emppKaynak === src) return;
    var y = mutlakYol(src);
    if (!y || indirilmis(y) !== 'dosya') return;
    el.__emppKaynak = src;
    indirilenYanit(y).then(function (r) { return r && r.blob(); }).then(function (b) {
      if (!b || el.getAttribute('src') !== src) return;
      var u = win.URL.createObjectURL(b);
      el.__emppKaynak = u;
      el.setAttribute('src', u);
    }).catch(function () {});
  }

  function parcaBayt(d) {
    if (d instanceof Uint8Array) return d;
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    if (d && d.buffer instanceof ArrayBuffer) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    return new TextEncoder().encode(String(d));
  }
  function akisDosyasiYaz(p, parcalar) {
    var metin = parcalar.every(function (x) { return typeof x === 'string'; });
    if (metin) { fsMod.writeFileSync(p, parcalar.join('')); return; }
    var baytlar = parcalar.map(parcaBayt), top = 0;
    for (var i = 0; i < baytlar.length; i++) top += baytlar[i].length;
    if (/\.zip$/i.test(String(p)) || top > ZIP_BELLEK_ESIGI) {
      bellekDosyalari[yolAnahtari(p)] = new Blob(baytlar);
      return;
    }
    var u = new Uint8Array(top), o = 0;
    for (var j = 0; j < baytlar.length; j++) { u.set(baytlar[j], o); o += baytlar[j].length; }
    fsMod.writeFileSync(p, u);
  }

  // Zip merkez dizini (zip64 yok — kitap zip'leri 4 GB'nin cok altinda).
  function zipGirdileri(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var eocd = -1;
    for (var i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 65535; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('zip: merkez dizin sonu bulunamadi');
    var adet = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true);
    var td = new TextDecoder(), out = [];
    for (var n = 0; n < adet; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip: merkez dizin bozuk');
      var bayrak = dv.getUint16(p + 8, true), yontem = dv.getUint16(p + 10, true);
      var sikisik = dv.getUint32(p + 20, true), boyut = dv.getUint32(p + 24, true);
      var adL = dv.getUint16(p + 28, true), ekL = dv.getUint16(p + 30, true), ymL = dv.getUint16(p + 32, true);
      var yerel = dv.getUint32(p + 42, true);
      var ad = td.decode(u8.subarray(p + 46, p + 46 + adL)).replace(/\\/g, '/');
      p += 46 + adL + ekL + ymL;
      if (/\/$/.test(ad)) continue; // dizin girdisi
      // Varsayilan RET: kok disina cikan / mutlak ad (zip-slip) atlanir.
      if (ad.charAt(0) === '/' || /(^|\/)\.\.(\/|$)/.test(ad) || /^[a-zA-Z]:/.test(ad)) continue;
      if (bayrak & 1) throw new Error('zip: sifreli girdi desteklenmez: ' + ad);
      if (dv.getUint32(yerel, true) !== 0x04034b50) throw new Error('zip: yerel baslik bozuk: ' + ad);
      var veriBas = yerel + 30 + dv.getUint16(yerel + 26, true) + dv.getUint16(yerel + 28, true);
      out.push({ ad: ad, yontem: yontem, sikisik: sikisik, boyut: boyut, veriBas: veriBas });
    }
    return out;
  }
  function zipGirdiAc(u8, g) {
    var ham = u8.subarray(g.veriBas, g.veriBas + g.sikisik);
    var sonuc;
    if (g.yontem === 0) sonuc = Promise.resolve(ham.slice());
    else if (g.yontem === 8) {
      var akis = new Blob([ham]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      sonuc = new Response(akis).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    } else return Promise.reject(new Error('zip: desteklenmeyen yontem ' + g.yontem + ': ' + g.ad));
    return sonuc.then(function (v) {
      if (v.length !== g.boyut) throw new Error('zip: boyut tutmadi ' + g.ad + ' ' + v.length + '/' + g.boyut);
      return v;
    });
  }
  var MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
    webp: 'image/webp', xml: 'application/xml', json: 'application/json', mp4: 'video/mp4', mp3: 'audio/mpeg',
    html: 'text/html', js: 'text/javascript', css: 'text/css', txt: 'text/plain' };
  function mimeOf(ad) { var e = pathMod.extname(ad).slice(1).toLowerCase(); return MIME[e] || 'application/octet-stream'; }

  // K9: motorun elle indirmesi ile oto-guncelleyici ayni anda acabilir -> tek kuyruk.
  var acmaKuyrugu = Promise.resolve();
  function kitapAc(blob, hedef) {
    var is = acmaKuyrugu.then(function () { return kitapAcAsil(blob, hedef); });
    acmaKuyrugu = is.catch(function () {});
    return is;
  }
  function kitapAcAsil(blob, hedef) {
    var c = cachesAl();
    if (!c) return Promise.reject(new Error('Cache Storage yok'));
    var dizin = mutlakYol(hedef);
    if (!dizin || dizin === '/') return Promise.reject(new Error('gecersiz hedef dizin: ' + hedef));
    var u8, girdiler, kasa;
    return blob.arrayBuffer().then(function (b) {
      u8 = new Uint8Array(b);
      girdiler = zipGirdileri(u8);
      if (!girdiler.length) throw new Error('zip bos');
      return c.open(KITAP_CACHE);
    }).then(function (k) {
      kasa = k;
      var eski = indirilenler()[dizin] || [];
      indirilenYaz(dizin, null); // okuma su andan itibaren APK kopyasina duser
      return eski.reduce(function (pr, ad) {
        return pr.then(function () { return kasa.delete(ortam.origin + dizin + '/' + ad); });
      }, Promise.resolve());
    }).then(function () {
      return girdiler.reduce(function (pr, g) {
        return pr.then(function () { return zipGirdiAc(u8, g); }).then(function (v) {
          return kasa.put(ortam.origin + dizin + '/' + g.ad, new Response(v, {
            status: 200, headers: { 'Content-Type': mimeOf(g.ad), 'Content-Length': String(v.length) } }));
        });
      }, Promise.resolve());
    }).then(function () {
      var adlar = girdiler.map(function (g) { return g.ad; });
      indirilenYaz(dizin, adlar);
      return adlar.length;
    });
  }

  function AdmZip(p) { this._yol = p; }
  AdmZip.prototype.extractAllTo = function (hedef) {
    var blob = bellekDosyalari[yolAnahtari(this._yol)];
    if (!blob) return Promise.reject(new Error('zip bellekte yok: ' + this._yol));
    return kitapAc(blob, hedef).then(function (n) {
      try { console.log('[empp-android] kitap acildi: ' + hedef + ' (' + n + ' dosya)'); } catch (e) {}
      return n;
    });
  };
  AdmZip.prototype.getEntries = function () { return []; };

  function varsayilanFetch() {
    // CapacitorWebFetch = WebView'in yamasiz fetch'i: govdeyi AKIS olarak verir (ilerleme).
    if (isBrowser && typeof win.CapacitorWebFetch === 'function') return win.CapacitorWebFetch.bind(win);
    if (isBrowser && typeof win.fetch === 'function') return win.fetch.bind(win);
    return typeof fetch === 'function' ? fetch : null;
  }
  // K10: motorun kendi kitap zip indirmesi basladi mi (tek kitapta cift indirmeyi onler).
  var motorZipIndirmesi = { basladi: false };
  function httpsGet(url, secenek, cb, fetchFn) {
    if (typeof secenek === 'function') { fetchFn = cb; cb = secenek; }
    if (/\/ZKitapZip/i.test(String(url))) motorZipIndirmesi.basladi = true;
    fetchFn = fetchFn || varsayilanFetch();
    var istekH = {};
    var istek = {
      on: function (ev, fn) { istekH[ev] = fn; return istek; },
      once: function (ev, fn) { istekH[ev] = fn; return istek; },
      end: function () { return istek; }, abort: function () {}, destroy: function () {}, setTimeout: function () { return istek; }
    };
    Promise.resolve().then(function () {
      if (!fetchFn) throw new Error('fetch yok');
      return fetchFn(String(url));
    }).then(function (y) {
      if (!y.ok) throw new Error('HTTP ' + y.status + ' ' + url);
      var resH = {}, hedefler = [], basliklar = {};
      y.headers.forEach(function (v, k) { basliklar[String(k).toLowerCase()] = v; });
      var res = {
        statusCode: y.status, headers: basliklar,
        on: function (ev, fn) { resH[ev] = fn; return res; },
        once: function (ev, fn) { resH[ev] = fn; return res; },
        pipe: function (ws) { hedefler.push(ws); return ws; },
        setEncoding: function () { return res; }, resume: function () { return res; }
      };
      if (cb) cb(res);
      function ver(u) { if (resH.data) resH.data(u); for (var i = 0; i < hedefler.length; i++) hedefler[i].write(u); }
      function bitir() { if (resH.end) resH.end(); for (var i = 0; i < hedefler.length; i++) hedefler[i].end(); }
      if (!y.body || typeof y.body.getReader !== 'function') {
        return y.arrayBuffer().then(function (b) { ver(new Uint8Array(b)); bitir(); });
      }
      var okuyucu = y.body.getReader();
      function oku() {
        return okuyucu.read().then(function (r) { if (r.done) return bitir(); ver(r.value); return oku(); });
      }
      return oku();
    }).catch(function (e) {
      try { console.error('[empp-android] indirme hatasi: ' + (e && e.message)); } catch (x) {}
      if (istekH.error) istekH.error(e);
    });
    return istek;
  }
  var httpsMod = { get: function (url, secenek, cb) { return httpsGet(url, secenek, cb); } };

  // K8: motor kurum/seri logosunu `Buffer.from(arrayBuffer)` ile yaziyor ("Buffer is not
  // defined"). Kucuk, isaretli bir yerine-koyma: isBuffer yalniz KENDI urettigini tanir,
  // boylece `typeof Buffer` bakan kutuphaneler duz Uint8Array'i Buffer sanmaz.
  var BufferShim = {
    from: function (x, enc) {
      var u = typeof x === 'string'
        ? (enc === 'base64' ? Uint8Array.from(atob(x), function (c) { return c.charCodeAt(0); }) : new TextEncoder().encode(x))
        : parcaBayt(x).slice();
      u.__emppBuffer = true;
      return u;
    },
    alloc: function (n) { var u = new Uint8Array(n); u.__emppBuffer = true; return u; },
    isBuffer: function (v) { return !!(v && v.__emppBuffer); }
  };
  function installBuffer() { if (isBrowser && typeof win.Buffer === 'undefined') win.Buffer = BufferShim; }

  // K9 — NEDEN (2026-09-22, Nadir): cihaz Wi-Fi'deyken (ucretlendirilmeyen baglanti)
  // kitap guncellemeleri (yesil bulut) kendiliginden insin; mobil veride inmesin.
  // Motor guncelleme kontrolunu YALNIZ ekrandaki sekmenin kartlari icin yapar, o yuzden
  // dugmeye tiklamak yetmez: guncelleyici menudeki (ImWin32.dll) TUM kurulu kitaplari
  // tarar, K8 yoluyla indirip acar, yeni surumu `empp_surum` kaydina yazar. Menu okunurken
  // (`fs.readFileSync(.../ImWin32.dll)`) kayittaki surum menuye islenir -> motor o kitap
  // icin bir daha yesil bulut gostermez. Motor kodu DEGISMEZ.
  // Baglanti bilgisi yerel EmppAg eklentisinden gelir (ag-bilgisi.js); eklenti yoksa ya
  // da baglanti olculuyorsa HICBIR SEY indirilmez. Mavi bulut (hic inmemis kitap) otomatik
  // DEGIL — cihazda yer kaplar, kullanici dokununca iner.
  // BOZARSAN: `empp-android-shim-oto.test.js` kirilir.
  var SURUM_ANAHTARI = 'empp_surum';
  var SON_TARAMA_ANAHTARI = 'empp_oto_guncelleme_son';
  var TARAMA_ARALIGI = 6 * 3600 * 1000;
  var IMWIN_BICIM = [[127, 17], [27, 5]];

  function surumlerOku() {
    try { return JSON.parse((ortam.storage && ortam.storage.getItem(SURUM_ANAHTARI)) || '{}') || {}; } catch (e) { return {}; }
  }
  function surumYaz(id, v) {
    var m = surumlerOku(); m[String(id)] = Number(v);
    try { ortam.storage.setItem(SURUM_ANAHTARI, JSON.stringify(m)); } catch (e) {}
  }
  function imwinCoz(t) {
    t = String(t);
    for (var i = 0; i < IMWIN_BICIM.length; i++) {
      var n = IMWIN_BICIM[i][0], r = IMWIN_BICIM[i][1];
      if (t.length > n && t.charAt(n) === '<' && t.charAt(t.length - (n + r)) === '>') {
        var out = [];
        for (var p = n; t.length - p > n; p += r) out.push(t.charAt(p));
        return { xml: out.join(''), n: n, r: r };
      }
    }
    return null;
  }
  function imwinYaz(xml, n, r) {
    function dolgu(k) { var s = ''; for (var i = 0; i < k; i++) s += String.fromCharCode(1 + Math.floor(Math.random() * 125)); return s; }
    var g = [];
    for (var i = 0; i < xml.length; i++) g.push(xml.charAt(i) + dolgu(r - 1));
    return dolgu(n) + g.join('') + dolgu(n);
  }
  // ─── A1 KAPAK SÜZME (2026-10-05) — masaüstü fs-shim.js ile AYNI kurallar (kopya; bu dosya APK'ya
  // tek başına girer, require edemez). Eşlik testi: `empp-android-shim-kapak.test.js` aynı vektörleri
  // iki uygulamaya da koşturur — biri değişirse test düşer.
  // sf425 kabuğu motoru `kapak/index.html?kapak=<ID>` ile açar: ImWin32 okuması TEK kapağa süzülür
  // (motor `oneBook` → kapak doğrudan açılır), motorun geri yazması asıl menüye birleştirilir
  // (anahtar set başına tek). Yazılan menü asıldan DARSA / çözülemiyorsa / asıl okunamıyorsa yazma
  // ATLANIR (asıl yerinde kalır). Boş `key` dolu `key`'i ezmez. VFS ad alanı: bütün kapaklar
  // `/kapak` sayfa dizinini paylaşır → tek anahtar deposu.
  function ogeRe(ad) { return new RegExp('<' + ad + '\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/' + ad + '>)', 'g'); }
  function kapakIdleri(s) {
    var l = [], m, re = ogeRe('cover');
    while ((m = re.exec(s))) { var k = /^<cover\b[^>]*?\sID="([^"]*)"/.exec(m[0]); if (k) l.push(k[1]); }
    return l;
  }
  function tekil(l) { var o = []; for (var i = 0; i < l.length; i++) if (o.indexOf(l[i]) === -1) o.push(l[i]); return o; }
  function kapakOku(search) {
    var m = /[?&]kapak=(\d{1,12})(?=&|#|$)/.exec(String(search || ''));
    if (!m) return null;
    var id = m[1].replace(/^0+/, '');
    return id ? id : null;
  }
  function kapakUyar(ne, e) {
    try { console.warn('[empp-android] kapak ' + ne, (e && (e.code || e.name)) || e || ''); } catch (_) {}
  }
  var TUT = '\u0001';
  function menuSuz(xml, kapak) {
    kapak = String(kapak);
    var tutuldu = false;
    var out = String(xml).replace(ogeRe('Group'), function (g) {
      if (tutuldu || kapakIdleri(g).indexOf(kapak) === -1) return '';
      var tabTut = false;
      var g2 = g.replace(ogeRe('Tab'), function (t) {
        if (tabTut || kapakIdleri(t).indexOf(kapak) === -1) return '';
        tabTut = true;
        var cTut = false;
        return t.replace(ogeRe('cover'), function (c) {
          if (cTut || kapakIdleri(c)[0] !== kapak) return '';
          cTut = true;
          return c.replace(/^<cover/, '<cover' + TUT);
        });
      });
      if (!tabTut) return '';
      tutuldu = true;
      return g2;
    });
    if (!tutuldu) return null;
    out = out.replace(ogeRe('Tab'), function (t) { return t.indexOf(TUT) === -1 ? '' : t; });
    out = out.replace(ogeRe('cover'), function (c) { return c.indexOf(TUT) === -1 ? '' : c; });
    out = out.split(TUT).join('');
    var ids = kapakIdleri(out);
    return ids.length === 1 && ids[0] === kapak ? out : null;
  }
  function kumeEsit(a, b) {
    a = tekil(a); b = tekil(b);
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) === -1) return false;
    return true;
  }
  function menuBirlestir(asil, yazilan, kapak) {
    kapak = String(kapak);
    var ids = tekil(kapakIdleri(yazilan));
    if (ids.length !== 1 || ids[0] !== kapak) return null;
    var asilIdler = kapakIdleri(asil);
    if (asilIdler.indexOf(kapak) === -1) return null;
    var mainYeni = /<main\b[^>]*>/.exec(yazilan);
    var kapakYeni = yazilan.match(ogeRe('cover'))[0];
    var out = asil;
    if (mainYeni) {
      var etiket = mainYeni[0];
      var eskiMain = /<main\b[^>]*>/.exec(asil);
      var eskiKey = eskiMain && /\skey="([^"]*)"/.exec(eskiMain[0]);
      var yeniKey = /\skey="([^"]*)"/.exec(etiket);
      if (eskiKey && eskiKey[1] && (!yeniKey || !yeniKey[1])) {
        etiket = yeniKey ? etiket.replace(/\skey="[^"]*"/, function () { return ' key="' + eskiKey[1] + '"'; })
          : etiket.replace(/^<main\b/, function (m0) { return m0 + ' key="' + eskiKey[1] + '"'; });
      }
      out = out.replace(/<main\b[^>]*>/, function () { return etiket; });
    }
    out = out.replace(ogeRe('cover'), function (c) { return kapakIdleri(c)[0] === kapak ? kapakYeni : c; });
    return kumeEsit(kapakIdleri(out), asilIdler) ? out : null;
  }
  function metneCevir(veri) {
    if (typeof veri === 'string') return veri;
    if (veri && typeof veri === 'object' && typeof veri.byteLength === 'number' && typeof TextDecoder !== 'undefined') {
      return new TextDecoder().decode(veri instanceof Uint8Array ? veri : new Uint8Array(veri.buffer || veri, veri.byteOffset || 0, veri.byteLength));
    }
    return String(veri);
  }
  function yazmaKarari(asilHam, veri, kapak) {
    var y = imwinCoz(metneCevir(veri));
    if (!y) return { tur: 'reddet', neden: 'yazılan menü çözülemedi' };
    var a = asilHam == null ? null : imwinCoz(asilHam);
    if (!a) return { tur: 'reddet', neden: 'asıl menü okunamadı' };
    var yIds = tekil(kapakIdleri(y.xml)), aIds = tekil(kapakIdleri(a.xml));
    if (yIds.length === 1 && yIds[0] === String(kapak)) {
      var b = menuBirlestir(a.xml, y.xml, kapak);
      return b == null ? { tur: 'reddet', neden: 'birleşim kapak kümesini korumadı' }
        : { tur: 'birlesik', metin: imwinYaz(b, 27, 5) };
    }
    for (var i = 0; i < aIds.length; i++) {
      if (yIds.indexOf(aIds[i]) === -1) return { tur: 'reddet', neden: 'yazılan menü asıldan dar' };
    }
    return { tur: 'aynen' };
  }
  var KAPAK = isBrowser ? kapakOku(win.location && win.location.search) : null;
  function imwinYoluMu(p) { return /ImWin32\.dll$/i.test(String(p).split(/[?#]/)[0]); }
  /** Kapak kipinde menü metnini süzer; süzülemezse metin aynen. */
  function kapakSuzMetin(t) {
    if (!KAPAK || typeof t !== 'string') return t;
    var c = imwinCoz(t); if (!c) return t;
    var s = menuSuz(c.xml, KAPAK);
    return s == null ? t : imwinYaz(s, c.n, c.r);
  }
  /** Menünün HAM (süzülmemiş) metni: önce VFS, yoksa paket. */
  function menuHamOku(p) {
    var v = storage ? fromStored(storage.getItem(key(p)), 'utf8') : null;
    if (v == null) v = syncGet(relUrl(p), false);
    return typeof v === 'string' ? v : null;
  }
  /** @returns {'yazildi'|'aynen'|'atlandi'} */
  function kapakYaz(p, data) {
    var asilHam = null;
    try { asilHam = menuHamOku(p); } catch (e) { kapakUyar('asıl okunamadı', e); }
    var k = yazmaKarari(asilHam, data, KAPAK);
    if (k.tur === 'aynen') return 'aynen';
    if (k.tur === 'reddet') { kapakUyar('yazma reddedildi: ' + k.neden); return 'atlandi'; }
    try { storage.setItem(key(p), k.metin); return 'yazildi'; } catch (e) { kapakUyar('yazılamadı', e); return 'atlandi'; }
  }

  function nitelik(etiket, ad) {
    var m = new RegExp('(?:^|\\s)' + ad + '="([^"]*)"').exec(etiket);
    return m ? m[1] : null;
  }
  // K10: tek kitap exe'sinin menusunde `isDownloaded` HIC YOK (kitaplik ekrani gosterilmedigi
  // icin motor yazmaz). Nitelik yoksa kitabin BookContent.xml'i var mi diye bakilir (`varMi`).
  function menuKitaplari(xml, varMi) {
    var l = [], re = /<cover\b[^>]*>/g, m;
    while ((m = re.exec(xml))) {
      var e = m[0], xs = nitelik(e, 'xmlSource') || '', isd = nitelik(e, 'isDownloaded');
      l.push({ id: nitelik(e, 'ID'), surum: Number(nitelik(e, 'version') || 0),
        kurulu: isd === 'true' || (isd === null && !!xs && typeof varMi === 'function' && !!varMi(xs)),
        dizin: xs.indexOf('/data/') > 0 ? xs.slice(0, xs.indexOf('/data/')) : null });
    }
    return l;
  }
  // Kayittaki surum menudekinden BUYUKSE menuye islenir (kucukse motorunki kazanir).
  function menuSurumYamasi(xml, surumler) {
    return xml.replace(/<cover\b[^>]*>/g, function (e) {
      var id = nitelik(e, 'ID'), kayit = surumler[id];
      if (kayit == null) return e;
      var su = Number(nitelik(e, 'version') || 0);
      if (!(Number(kayit) > su)) return e;
      return /(\s)version="[^"]*"/.test(e)
        ? e.replace(/(\s)version="[^"]*"/, '$1version="' + Number(kayit) + '"')
        : e.replace(/\s*\/?>$/, function (son) { return ' version="' + Number(kayit) + '"' + son; });
    });
  }
  function menuDllYamasi(metin) {
    var s = surumlerOku();
    if (!Object.keys(s).length || typeof metin !== 'string') return metin;
    var c = imwinCoz(metin);
    if (!c) return metin;
    var yeni = menuSurumYamasi(c.xml, s);
    return yeni === c.xml ? metin : imwinYaz(yeni, c.n, c.r);
  }
  function dllYolu() {
    try { if (typeof AppConfig !== 'undefined' && AppConfig.bookModule && AppConfig.bookModule.dll) return AppConfig.bookModule.dll; } catch (e) {}
    return 'classlibraries/ImWin32.dll';
  }
  function guncellemeUcu() {
    try { return AppConfig.xml.desktop.updateBookEndPoint || null; } catch (e) { return null; }
  }
  function agDurumu() {
    try {
      var C = isBrowser ? win.Capacitor : null;
      if (C && typeof C.nativePromise === 'function') return C.nativePromise('EmppAg', 'durum', {}).catch(function () { return null; });
      if (C && C.Plugins && C.Plugins.EmppAg) return C.Plugins.EmppAg.durum().catch(function () { return null; });
    } catch (e) {}
    return Promise.resolve(null);
  }
  function uygunBaglanti(d) { return !!(d && d.bagli === true && d.olculen === false); }
  function gunluk(s) { try { console.log('[empp-android] oto-guncelleme: ' + s); } catch (e) {} }

  // deps (testte enjekte): agDurumu, jsonGetir(url), zipGetir(url)->Blob, menuMetni(), simdi()
  function otoGuncelle(deps) {
    deps = deps || {};
    var ag = deps.agDurumu || agDurumu;
    var simdi = deps.simdi || function () { return Date.now(); };
    var jsonGetir = deps.jsonGetir || function (u) { return win.fetch(u).then(function (r) { return r.json(); }); };
    var zipGetir = deps.zipGetir || function (u) {
      return varsayilanFetch()(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); });
    };
    // A1: tarama BÜTÜN kitapları görmeli — süzülmemiş (ham) menü okunur.
    var menuMetni = deps.menuMetni || function () { return KAPAK ? menuDllYamasi(menuHamOku(dllYolu()) || '') : fsMod.readFileSync(dllYolu(), 'utf8'); };
    var uc = deps.uc || guncellemeUcu();
    var rapor = { tarandi: 0, guncellendi: [], hata: [], sebep: null };
    return ag().then(function (d) {
      if (!uygunBaglanti(d)) { rapor.sebep = 'baglanti-uygun-degil'; return rapor; }
      var son = Number((ortam.storage && ortam.storage.getItem(SON_TARAMA_ANAHTARI)) || 0);
      if (!deps.zorla && simdi() - son < TARAMA_ARALIGI) { rapor.sebep = 'yakinda-tarandi'; return rapor; }
      if (!uc) { rapor.sebep = 'guncelleme-ucu-yok'; return rapor; }
      var c = imwinCoz(menuMetni());
      if (!c) { rapor.sebep = 'menu-okunamadi'; return rapor; }
      // K10 (2026-09-22): TEK KITAP (menude tek kapak) motorun `oneBook` kipidir. Motor
      // acilista guncellemeyi KENDISI sorar ve varsa yukleme ekraniyla indirip acar (K8 yolu,
      // her baglantida). Burada da taramak ayni zip'i IKINCI kez indirir (telefonda olculdu:
      // 153 MB iki kez). Tek kitapta guncelleme motorundur; oto-guncelleme yalniz paket icindir.
      var varMi = deps.varMi || function (y) { try { return fsMod.existsSync(y); } catch (e) { return false; } };
      var tum = menuKitaplari(c.xml, varMi);
      // Motor oneBook'ta guncellemeyi acilista kendisi baslatir — ama yalniz sorgu cevabi
      // kitap acilmadan (5 sn zamanlayici) once gelirse. Yavas agda cevap gec gelir, kitap
      // guncellenmeden acilir (telefonda olculdu: cevap 5,1 sn'de geldi). Bu yuzden: motor bu
      // oturumda zip indirmeye BASLADIYSA dokunma; baslamadiysa yedek olarak biz indiririz.
      var motorIndirdi = deps.motorIndirdi || function () { return motorZipIndirmesi.basladi; };
      if (tum.length === 1 && motorIndirdi()) { rapor.sebep = 'tek-kitap-motor-guncelliyor'; return rapor; }
      var kitaplar = tum.filter(function (k) { return k.kurulu && k.id && k.dizin; });
      var yarida = false;
      return kitaplar.reduce(function (pr, k) {
        return pr.then(function () {
          if (yarida) return;
          rapor.tarandi++;
          var url = uc.replace('{bookId}', k.id).replace('{version}', k.surum).replace('{isSet}', '0');
          return jsonGetir(url).then(function (j) {
            if (!j || !j.Success || !j.Data || !(Number(j.Vs) > k.surum)) return;
            // Indirmeden hemen once baglantiyi YENIDEN sor: Wi-Fi'den cikildiysa dur.
            return ag().then(function (d2) {
              if (!uygunBaglanti(d2)) { yarida = true; rapor.sebep = 'baglanti-degisti'; return; }
              return zipGetir(j.Data).then(function (b) { return kitapAc(b, k.dizin); }).then(function () {
                surumYaz(k.id, j.Vs);
                rapor.guncellendi.push(k.id + ':' + k.surum + '->' + j.Vs);
                gunluk(k.id + ' ' + k.surum + ' -> ' + j.Vs);
              });
            });
          }).catch(function (e) { rapor.hata.push(k.id + ': ' + (e && e.message)); });
        });
      }, Promise.resolve()).then(function () {
        if (!yarida) { try { ortam.storage.setItem(SON_TARAMA_ANAHTARI, String(simdi())); } catch (e) {} }
        gunluk('tarandi=' + rapor.tarandi + ' guncellendi=' + rapor.guncellendi.length + ' hata=' + rapor.hata.length);
        return rapor;
      });
    });
  }
  var otoCalisiyor = false;
  function otoTetikle() {
    if (otoCalisiyor) return;
    otoCalisiyor = true;
    otoGuncelle().catch(function (e) { gunluk('hata ' + (e && e.message)); })
      .then(function () { otoCalisiyor = false; });
  }
  function installOtoGuncelleme() {
    if (!isBrowser || !win.setTimeout) return false;
    win.setTimeout(otoTetikle, 20000); // menu + motorun kendi kontrolu once otursun
    try { win.addEventListener('online', function () { win.setTimeout(otoTetikle, 5000); }); } catch (e) {}
    try { win.setInterval(otoTetikle, 15 * 60 * 1000); } catch (e) {}
    return true;
  }

  // G — NEDEN (2026-09-26, Nadir): "Tum paketlerde bizim guncelleme istemcimiz (G kanali) olacak."
  // Istemci ayri dosyadir (`/empp-g-istemci.js`, www koku) ve YALNIZ pakette EmppG yerel eklentisi
  // varsa yuklenir: sayfa acildiktan G_GECIKME ms sonra, ust pencerede, sayfa basina bir kez.
  // Acilisi bloklamaz; eklentisiz pakette hic istek atilmaz (konsolda 404 gurultusu olmaz).
  // Kitap sayfalarindaki shim kopyalari da ayni kokteki istemciyi yukler (mutlak yol).
  // BOZARSAN: `empp-android-shim-g.test.js` kirilir.
  var G_GECIKME = 10000;
  var G_ISTEMCI = '/empp-g-istemci.js';
  function gEklentisiVar() {
    try {
      var C = isBrowser ? win.Capacitor : null;
      if (!C) return false;
      if (typeof C.isPluginAvailable === 'function') return !!C.isPluginAvailable('EmppG');
      return !!(C.Plugins && C.Plugins.EmppG);
    } catch (e) { return false; }
  }
  function gYukle() {
    try {
      if (win.__emppGYuklendi || !gEklentisiVar()) return false;
      win.__emppGYuklendi = true;
      var s = win.document.createElement('script');
      s.src = G_ISTEMCI;
      s.async = true;
      (win.document.head || win.document.documentElement).appendChild(s);
      return true;
    } catch (e) { return false; }
  }
  function installG() {
    if (!isBrowser || !win.setTimeout || !win.document) return false;
    try { if (win.top && win.top !== win) return false; } catch (e) { return false; }
    win.setTimeout(gYukle, G_GECIKME);
    return true;
  }

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
        if (CEVRIMICI_YOKLAMA && cevrimiciYoklamaMi(input, init, win.location && win.location.origin)) {
          var yk = cevrimiciYokla(input, init);
          if (yk) return yk;
        }
        var url = (input && typeof input === 'object' && 'url' in input) ? input.url : String(input);
        if (!/^(https?|data|blob):/i.test(url) || url.indexOf(win.location.origin) === 0) {
          var rel = url.replace(win.location.origin, '').split(/[?#]/)[0];
          // K9: motor menuyu `fetch(bookModule.dll)` ile okur (kV) — arka planda guncellenen
          // kitabin surumu BURADA da menuye islenmeli; yalniz readFileSync'e koymak yetmedi
          // (telefonda olculdu: menu dogruyken 4 kart yine yesil bulut gosterdi).
          // A1: kapak kipinde menü fetch'i her zaman bu yoldan geçer ve tek kapağa süzülür.
          if (/ImWin32\.dll$/i.test(rel) && (KAPAK || Object.keys(surumlerOku()).length)) {
            var s9 = this, a9 = arguments;
            var ham = vfsHas(rel)
              ? Promise.resolve(fromStored(storage.getItem(key(rel)), 'utf8'))
              : real.apply(s9, a9).then(function (r) { return r && r.ok ? r.text() : null; });
            return ham.then(function (t) {
              if (typeof t !== 'string') return real.apply(s9, a9);
              return new win.Response(kapakSuzMetin(menuDllYamasi(t)), { status: 200, headers: { 'X-EMPP-Source': KAPAK ? 'kapak' : 'k9-menu' } });
            });
          }
          if (vfsHas(rel)) {
            var v = fromStored(storage.getItem(key(rel)));
            return Promise.resolve(new win.Response(v, { status: 200, headers: { 'X-EMPP-Source': 'vfs' } }));
          }
          // K8: indirilen/guncellenen kitap dosyasi APK'daki kopyanin ONUNE gecer.
          var iy = mutlakYol(cozUrl(rel));
          if (iy && indirilmis(iy) === 'dosya') {
            var self = this, args = arguments;
            return indirilenYanit(iy).then(function (r) { return r || real.apply(self, args); });
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

  // K7 — NEDEN (2026-09-22): panele bagli pakette (main/@ID = paket id) motor menuyu
  // `GetPackageBooks`'tan yeniden kurar ve kapagi `source = 'assets/<id>/' + remoteSource`
  // diye birlestirir; remoteSource '/' ile basladigi icin ('/Uploads/Resim/x.png')
  // yol CIFT SLASH tasir: 'assets/66357//Uploads/...'. Masaustunde (dosya sistemi) fark
  // etmez; Capacitor'in yerel sunucusu '//'yi BULAMAZ.
  // BELİRTİ: BES Yabanci Dil paketi (74451) telefonda TUM kapaklar bos kutu.
  // KANIT: ayni dosya CDP ile telefondan olculdu — '.../assets/66357//Uploads/...png'
  // -> 404, tek slash -> 200 (71.900 bayt). Dosya APK'daydi, adres bozuktu.
  // Cozum: yerel (orijin ya da goreli) adreslerde semadan sonraki ardisik '/' tek '/'
  // olur; style (url(...)) ve src izlenir. Orijin altinda '//' HER ZAMAN 404 verdigi
  // icin bu calisan hicbir adresi degistiremez. Baska host, data:, blob:, protokol-
  // goreli ('//x') ve sorgu/hash kismi DOKUNULMAZ.
  // BOZARSAN: `empp-android-shim-slash.test.js` kirilir.
  var SEMA_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)/;
  function slashTekle(u) {
    u = String(u);
    var m = SEMA_RE.exec(u);
    var bas = m ? m[1] : '';
    var geri = u.slice(bas.length);
    var i = geri.search(/[?#]/);
    var yol = i === -1 ? geri : geri.slice(0, i);
    var kuyruk = i === -1 ? '' : geri.slice(i);
    return bas + yol.replace(/\/{2,}/g, '/') + kuyruk;
  }
  function yerelMi(u, origin) {
    if (!u) return false;
    u = String(u);
    if (/^(data|blob|javascript):/i.test(u)) return false;
    if (SEMA_RE.test(u)) return !!origin && u.indexOf(origin + '/') === 0;
    if (u.indexOf('//') === 0) return false; // protokol-goreli = baska host
    return true;
  }
  function cssUrlDuzelt(deger, origin) {
    if (!deger || String(deger).indexOf('url(') === -1) return deger;
    return String(deger).replace(/url\((['"]?)([^'")]+)\1\)/g, function (tam, q, u) {
      if (!yerelMi(u, origin)) return tam;
      var y = slashTekle(u);
      return y === u ? tam : 'url(' + q + y + q + ')';
    });
  }
  function installSlashFix() {
    if (!win) return false;
    var d = win.document;
    if (!win.MutationObserver || !d || !d.documentElement) return false;
    var origin = win.location && win.location.origin;
    function elemDuzelt(el) {
      if (!el || el.nodeType !== 1 || !el.getAttribute) return;
      var st = el.getAttribute('style');
      if (st && st.indexOf('//') !== -1) {
        var y = cssUrlDuzelt(st, origin);
        if (y !== st) el.setAttribute('style', y);
      }
      var src = el.getAttribute('src');
      if (src && src.indexOf('//') !== -1 && yerelMi(src, origin)) {
        var s2 = slashTekle(src);
        if (s2 !== src) el.setAttribute('src', s2);
      }
      if (el.tagName === 'IMG') imgIndirilen(el); // K8
    }
    function agacDuzelt(kok) {
      elemDuzelt(kok);
      if (kok && kok.querySelectorAll) {
        var l = kok.querySelectorAll('[style*="//"],[src*="//"],img[src]');
        for (var i = 0; i < l.length; i++) elemDuzelt(l[i]);
      }
    }
    new win.MutationObserver(function (kayitlar) {
      for (var i = 0; i < kayitlar.length; i++) {
        var k = kayitlar[i];
        if (k.type === 'attributes') elemDuzelt(k.target);
        else for (var j = 0; j < k.addedNodes.length; j++) agacDuzelt(k.addedNodes[j]);
      }
    }).observe(d.documentElement, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['style', 'src'] });
    return true;
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
    installSlashFix();
    installBuffer();
    installOtoGuncelleme();
    installG();
    try { if (win.navigator && win.navigator.storage && win.navigator.storage.persist) win.navigator.storage.persist(); } catch (e) {}
    return win.__emppAndroidShim;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { pathMod: pathMod, fsMod: fsMod, install: install, normalize: normalize, _internals: { key: key, relUrl: relUrl, toText: toText, fromStored: fromStored, slashTekle: slashTekle, yerelMi: yerelMi, cssUrlDuzelt: cssUrlDuzelt, installSlashFix: installSlashFix,
    zipGirdileri: zipGirdileri, zipGirdiAc: zipGirdiAc, kitapAc: kitapAc, httpsGet: httpsGet, AdmZip: AdmZip,
    indirilmis: indirilmis, indirilenYanit: indirilenYanit, mutlakYol: mutlakYol, bellekDosyalari: bellekDosyalari,
    ortam: ortam, BufferShim: BufferShim,
    imwinCoz: imwinCoz, imwinYaz: imwinYaz, menuKitaplari: menuKitaplari, menuSurumYamasi: menuSurumYamasi,
    menuDllYamasi: menuDllYamasi, otoGuncelle: otoGuncelle, uygunBaglanti: uygunBaglanti, surumYaz: surumYaz, motorZipIndirmesi: motorZipIndirmesi,
    gYukle: gYukle, installG: installG, gEklentisiVar: gEklentisiVar, G_GECIKME: G_GECIKME, G_ISTEMCI: G_ISTEMCI,
    cevrimiciYoklamaMi: cevrimiciYoklamaMi, cevrimiciYokla: cevrimiciYokla, CEVRIMICI_YOKLAMA: CEVRIMICI_YOKLAMA,
    menuSuz: menuSuz, menuBirlestir: menuBirlestir, yazmaKarari: yazmaKarari, kapakOku: kapakOku, kapakIdleri: kapakIdleri,
    KAPAK: KAPAK, installFetch: installFetch } };
  }
  if (isBrowser) install();
})(typeof window !== 'undefined' ? window : undefined);
