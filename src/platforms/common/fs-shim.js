/* eslint-disable */
/**
 * EMPP fs yönlendirme shim'i (renderer, 2026-08-27) — index.html'de ilk script.
 *
 * Yayıncı web uygulaması anahtar/temp dosyalarını `window.require('fs')` ile CWD'ye GÖRELİ
 * yollara yazar (remote modülü olmadığı için exe yolu boş). Windows'ta CWD = kurulum dizini
 * olduğundan çalışır; macOS/Linux'ta CWD "/" ve paket salt-okunur (asar) → anahtar
 * her açılışta yeniden sorulur. Bu shim `fs`'i sarar:
 *   • yazma işlemleri → WORK (userData/work) altına,
 *   • okuma işlemleri → önce WORK, yoksa BASE (paketteki build, asar dahil).
 * Paket dosyalarına dokunulmaz (imza bozulmaz), asar açılmaz (imza süresi uzamaz).
 */
(function () {
  // Renderer'da (nodeIntegration) `module` de tanımlıdır — bu yüzden ayrım `window/document` ile
  // yapılır; `module` varlığına bakmak shim'i sessizce devre dışı bırakıyordu (2026-08-27 canlı).
  var isRenderer = typeof window !== 'undefined' && typeof document !== 'undefined';
  var isNode = !isRenderer && typeof module !== 'undefined' && module.exports;

  var WRITE_ALL = ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync',
    'createWriteStream', 'unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'truncate', 'truncateSync',
    'utimes', 'utimesSync', 'chmod', 'chmodSync'];
  var WRITE_TWO = ['rename', 'renameSync']; // her iki yol da WORK
  var COPY = ['copyFile', 'copyFileSync']; // kaynak okuma, hedef WORK
  var OPEN = ['open', 'openSync']; // flag'e göre

  /**
   * ORTU (2026-09-26, G örtüsü — mac/Pardus): ana süreç G örtüsünü kurduysa (env
   * EMPP_G_ORTU_KOKU_ETKIN) paketteki G modülünden OKUYUCU alınır: paket yolu → imzalı örtü nesnesi.
   * YALNIZ OKUMA: WORK'te olmayan dosya paketten önce örtüde aranır; yazma yolu değişmez.
   * Ölçüm: kitap okuyucusu BookContent.xml / kapak / imKeys.dll'i renderer'da fs ile okur — G ile
   * EKLENEN kitap pakette yok, file: zinciri bu okumaları görmez. Örtü yoksa (Windows, eski paket,
   * env yok) ORTU = null ve davranış BİREBİR eskisi.
   */
  function makeResolver(pathMod, realFs, WORK, BASE, ORTU) {
    function rel(p) {
      if (typeof p !== 'string' || !p) return null;
      if (/^file:/i.test(p)) return null;
      if (pathMod.isAbsolute(p)) {
        var r = pathMod.relative(BASE, p);
        if (r && !r.startsWith('..') && !pathMod.isAbsolute(r)) return r;
        var w = pathMod.relative(WORK, p);
        if (w && !w.startsWith('..') && !pathMod.isAbsolute(w)) return w;
        // WINDOWS (2026-09-26, sözleşme G1/G2): sürücü harfli (C:\…) ya da UNC (\\sunucu\…) yol
        // BASE/WORK dışındaysa GERÇEK sistem yoludur — dokunulmaz. Eski kod bunu "/" ile bölüp
        // "kök-mutlak sahte yol" sanıyordu → WORK\C:\Users\… gibi bozuk hedef üretirdi.
        if (/^[a-zA-Z]:/.test(p) || /^[\\/]{2}/.test(p)) return null;
        // Uygulama getFilePath("/classlibraries/ImWin32.dll") gibi KÖK-mutlak yollar üretir
        // (exe yolu boş → join("", "/x") = "/x"). Gerçek kök dizini değilse (/Users, /Applications,
        // /private...) paket-göreli say. Gerçek sistem yolu ise dokunma.
        var first = p.split(/[\\/]/).filter(Boolean)[0];
        var rootExists = false;
        try { rootExists = !!first && realFs.existsSync('/' + first); } catch (e) {}
        if (first && !rootExists) return p.replace(/^[\\/]+/, '');
        return null;
      }
      return p.replace(/^\.[\\/]/, '');
    }
    function ensureDir(p) { try { realFs.mkdirSync(pathMod.dirname(p), { recursive: true }); } catch (e) {} }
    function toWork(p) { var r = rel(p); if (r == null) return p; var w = pathMod.join(WORK, r); ensureDir(w); return w; }
    function toRead(p) {
      var r = rel(p); if (r == null) return p;
      var w = pathMod.join(WORK, r);
      try { if (realFs.existsSync(w)) return w; } catch (e) {}
      var b = pathMod.join(BASE, r);
      if (ORTU) { try { var o = ORTU.yol(b); if (o) return o; } catch (e) {} }
      return b;
    }
    return { rel: rel, toWork: toWork, toRead: toRead };
  }

  function createShim(realFs, pathMod, WORK, BASE, ORTU) {
    var R = makeResolver(pathMod, realFs, WORK, BASE, ORTU);
    /** Örtünün getirdiği adı (Dirent isteniyorsa) dizin/dosya bilgisiyle sanal girdiye çevirir. */
    function sanal(ad, L, opts) {
      if (!(opts && typeof opts === 'object' && opts.withFileTypes)) return ad;
      var dz = !!(L && L.dizinMi(ad));
      return { name: ad, isFile: function () { return !dz; }, isDirectory: function () { return dz; },
        isSymbolicLink: function () { return false; } };
    }
    var shim = {};
    Object.keys(realFs).forEach(function (k) {
      var v = realFs[k];
      if (typeof v !== 'function') { shim[k] = v; return; }
      if (WRITE_ALL.indexOf(k) !== -1) shim[k] = function () { var a = Array.prototype.slice.call(arguments); a[0] = R.toWork(a[0]); return v.apply(realFs, a); };
      else if (WRITE_TWO.indexOf(k) !== -1) shim[k] = function () { var a = Array.prototype.slice.call(arguments); a[0] = R.toRead(a[0]); a[1] = R.toWork(a[1]); return v.apply(realFs, a); };
      else if (COPY.indexOf(k) !== -1) shim[k] = function () { var a = Array.prototype.slice.call(arguments); a[0] = R.toRead(a[0]); a[1] = R.toWork(a[1]); return v.apply(realFs, a); };
      else if (OPEN.indexOf(k) !== -1) shim[k] = function () { var a = Array.prototype.slice.call(arguments); var f = String(a[1] || 'r'); a[0] = /[wa+]/.test(f) ? R.toWork(a[0]) : R.toRead(a[0]); return v.apply(realFs, a); };
      else if (k === 'readdirSync') shim[k] = function (p, opts) {
        // Dizin listesi: work + paket BİRLEŞİMİ (yalnız work'e bakınca paket içerikleri kayboluyordu)
        var r = R.rel(p);
        // Örtü varken sayfanın KENDİ dizini (BASE) de birleşik listelenir (eklenen/gizli kitaplar).
        if (r == null && ORTU && typeof p === 'string' && pathMod.resolve(p) === pathMod.resolve(BASE)) r = '';
        if (r == null) return v.call(realFs, p, opts);
        var seen = {}, out = [];
        var ekle = function (list) {
          list.forEach(function (ent) { var name = typeof ent === 'string' ? ent : ent.name; if (!seen[name]) { seen[name] = 1; out.push(ent); } });
        };
        var oku = function (d) { try { return v.call(realFs, d, opts); } catch (e) { return []; } };
        ekle(oku(pathMod.join(WORK, r)));
        var bYol = pathMod.join(BASE, r);
        var L = null;
        if (ORTU) { try { L = ORTU.liste(bYol); } catch (e) { L = null; } }
        if (L && L.tam) {
          // G ile eklenen kitabın dizini: listesi TAMAMEN örtüden (pakette yok).
          ekle(L.adlar.map(function (ad) { return sanal(ad, L, opts); }));
          return out;
        }
        var taban = oku(bYol);
        if (L && L.cikar.length) {
          taban = taban.filter(function (ent) { var n = String(typeof ent === 'string' ? ent : ent.name).toLowerCase(); return L.cikar.indexOf(n) === -1; });
        }
        ekle(taban);
        if (L) ekle(L.adlar.map(function (ad) { return sanal(ad, L, opts); }));
        if (!out.length) return v.call(realFs, bYol, opts); // ENOENT'i gerçek fs fırlatsın
        return out;
      };
      else if (k === 'readdir') shim[k] = function (p, opts, cb) {
        if (typeof opts === 'function') { cb = opts; opts = undefined; }
        try { var res = shim.readdirSync(p, opts); if (cb) cb(null, res); } catch (e) { if (cb) cb(e); }
      };
      else shim[k] = function () { var a = Array.prototype.slice.call(arguments); if (typeof a[0] === 'string') a[0] = R.toRead(a[0]); return v.apply(realFs, a); };
    });
    if (realFs.promises) {
      var P = realFs.promises, sp = {};
      Object.keys(P).forEach(function (k) {
        var v = P[k]; if (typeof v !== 'function') { sp[k] = v; return; }
        if (WRITE_ALL.indexOf(k) !== -1) sp[k] = function () { var a = Array.prototype.slice.call(arguments); a[0] = R.toWork(a[0]); return v.apply(P, a); };
        else if (WRITE_TWO.indexOf(k) !== -1 || COPY.indexOf(k) !== -1) sp[k] = function () { var a = Array.prototype.slice.call(arguments); a[0] = R.toRead(a[0]); a[1] = R.toWork(a[1]); return v.apply(P, a); };
        else if (k === 'readdir' && ORTU) sp[k] = function (p, opts) {
          // Örtü varken promises.readdir de birleşik listeyi verir (tek dizine toRead eklenen
          // kitapta nesne deposunu listelerdi).
          return new Promise(function (coz, red) { try { coz(shim.readdirSync(p, opts)); } catch (e) { red(e); } });
        };
        else sp[k] = function () { var a = Array.prototype.slice.call(arguments); if (typeof a[0] === 'string') a[0] = R.toRead(a[0]); return v.apply(P, a); };
      });
      shim.promises = sp;
    }
    shim.__empp = { WORK: WORK, BASE: BASE, ORTU: ORTU || null };
    return shim;
  }

  /**
   * fetch() yönlendirmesi: uygulama anahtar deposunu (classlibraries/ImWin32.dll) fs ile YAZIP
   * fetch ile OKUYOR (Windows'ta aynı klasör). Göreli / paket-içi URL'ler önce WORK'te aranır;
   * varsa dosya oradan servis edilir, yoksa gerçek fetch. (2026-08-27 canlı: anahtar yazıldı ama
   * açılışta paketteki boş dosya okunup kod tekrar soruldu.)
   */
  function workPathForUrl(url, pathMod, realFs, WORK, BASE) {
    try {
      if (typeof url !== 'string' || !url) return null;
      var u = url.split(/[?#]/)[0];
      if (/^(https?|data|blob|ws|wss):/i.test(u)) return null;
      var rel = null;
      if (/^file:/i.test(u)) {
        var fsPath = decodeURIComponent(u.replace(/^file:\/\//i, ''));
        // Windows file URL'si: file:///C:/… → "/C:/…" — baştaki "/" sürücü harfinden önce atılır.
        if (/^\/[a-zA-Z]:[\\/]/.test(fsPath)) fsPath = fsPath.slice(1);
        var r = pathMod.relative(BASE, fsPath);
        if (r && !r.startsWith('..') && !pathMod.isAbsolute(r)) rel = r;
      } else {
        rel = decodeURIComponent(u).replace(/^\.\//, '').replace(/^\/+/, '');
      }
      if (!rel) return null;
      var w = pathMod.join(WORK, rel);
      return realFs.existsSync(w) && realFs.statSync(w).isFile() ? w : null;
    } catch (e) { return null; }
  }

  function installFetch(win, realFs, pathMod, WORK, BASE) {
    var realFetch = win.fetch;
    if (typeof realFetch !== 'function' || realFetch.__empp) return;
    var wrapped = function (input, init) {
      var url = (input && typeof input === 'object' && 'url' in input) ? input.url : input;
      var w = workPathForUrl(url, pathMod, realFs, WORK, BASE);
      if (w) {
        try {
          var buf = realFs.readFileSync(w);
          var body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
          return Promise.resolve(new win.Response(body, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'X-EMPP-Source': 'work' } }));
        } catch (e) { /* düş */ }
      }
      return realFetch.apply(this, arguments);
    };
    wrapped.__empp = true;
    win.fetch = wrapped;
  }

  /**
   * İçerik güncelleme kancası (Faz 2, 2026-09-24): paket kökünde `empp-icerik-guncelleme.js`
   * VARSA (paketleyici `src/packaging/icerik-guncelleme.js` koyar) renderer parçasını kurar:
   * `window.require('adm-zip')` açma hedefi WORK'e, açma doğrulaması, sahte sürüm ilerletme
   * süzgeci. Dosya YOKSA hiçbir şey değişmez (eski paketler birebir aynı davranır).
   * Windows'ta da çağrılır (2026-09-26, sözleşme G1).
   * `kok` = uygulama kökü (alt-kitap sayfasında BASE'in `__emppSubBook` kadar yukarısı).
   */
  function icerikKancasi(win, realRequire, realFs, pathMod, R, WORK, kok) {
    try {
      var modul = pathMod.join(kok, 'empp-icerik-guncelleme.js');
      if (!realFs.existsSync(modul)) return null;
      return realRequire(modul).rendererKur(win, { R: R, realFs: realFs, pathMod: pathMod, WORK: WORK, realRequire: realRequire });
    } catch (e) {
      try { console.warn('[empp-fs-shim] içerik kancası kurulamadı:', e && e.message); } catch (_) {}
      return null;
    }
  }

  /**
   * G örtüsü okuyucusu (renderer). Ana süreç kurmadıysa (env yok) ya da G modülü pakette yoksa null.
   * Ana sürecin yüklediği SÜRÜMLE aynı değilse de null (oturum ortasında uygulanan güncelleme).
   */
  function ortuOkuyucu(realRequire, realFs, pathMod, proc, kok) {
    try {
      var env = (proc && proc.env) || {};
      var ortuKoku = env.EMPP_G_ORTU_KOKU_ETKIN;
      if (!ortuKoku) return null;
      var modul = pathMod.join(kok, 'empp-set-guncelleyici.js');
      if (!realFs.existsSync(modul)) return null;
      var g = realRequire(modul);
      if (!g || typeof g.ortuFsOkuyucu !== 'function') return null;
      return g.ortuFsOkuyucu({ kok: kok, ortuKoku: ortuKoku, surum: env.EMPP_G_ORTU_SURUM_ETKIN || '', fsSenkron: realFs });
    } catch (e) {
      try { console.warn('[empp-fs-shim] G örtüsü okuyucusu kurulamadı:', e && e.message); } catch (_) {}
      return null;
    }
  }

  function kokBul(pathMod, BASE, subBook) {
    return subBook ? pathMod.resolve(BASE, subBook.split('/').map(function () { return '..'; }).join('/')) : BASE;
  }

  function install(win) {
    try {
      if (!win || typeof win.require !== 'function') return null; // web/Capacitor: shim gereksiz
      if (win.__emppFsShim) return win.__emppFsShim;
      var realRequire = win.require;
      var pathMod = realRequire('path');
      var realFs = realRequire('fs');
      var proc = (typeof process !== 'undefined') ? process : null;
      var BASE = (typeof __dirname === 'string' && __dirname) ? __dirname : pathMod.dirname((win.location && win.location.pathname) || '/');
      // EMPP_FS_SHIM_WINDOWS_ETKIN (2026-09-26, Windows paketleme sözleşmesi G1/G2): shim Windows'ta
      // da kurulur. Eskiden burada `win32 → return null` vardı: yayıncı motoru aktivasyonu
      // (classlibraries/ImWin32.dll, imKeys.dll), kullanıcı verisini (temp/data/storage.im) ve
      // İmpark içerik güncellemesini (assets/<id>) KURULUM DİZİNİNE yazıyordu; tam sürüm kurulumu
      // (`RMDir /r $INSTDIR`) hepsini siliyor, K kanalı da adm-zip olmadığı için açılamıyordu.
      // Artık yazmalar userData/work'e, okumalar önce WORK sonra paket — mac/Pardus ile aynı model.
      var WORK_ROOT = (proc && proc.env && proc.env.EMPP_WORK_DIR) || null;
      if (!WORK_ROOT) {
        var home = (proc && proc.env && (proc.env.HOME || proc.env.USERPROFILE)) || '';
        WORK_ROOT = pathMod.join(home, '.empp-work');
      }
      // K9 (2026-09-09, Pardus/.impark kaniti): SET alt-kitaplarinda BASE (=__dirname)
      // sayfanin KENDI dizinidir (örn. .../app.asar/book1) — ama eskiden WORK HER
      // ZAMAN tek bir kok dizindi; goreli yazmalar (rel() BASE'e gore hesaplaniyor,
      // "book1" segmentini KAYBEDIYOR) tum alt-kitaplar icin AYNI WORK/... yoluna
      // dusuyordu -> book1'in storage.im'ini book3 de goruyordu (K6 sinifi
      // carpisma). packagingService.js her alt-kitap sayfasina `window.__emppSubBook`
      // (kendi ad-alani, örn. 'book1') enjekte eder; burada WORK bununla onceklenir.
      // Kok sayfada bu degisken YOK -> WORK = WORK_ROOT, eski davranisla BIREBIR
      // ayni (regresyon yok, `fs-shim-subbook.test.js`'te test edilir).
      var subBook = (typeof win.__emppSubBook === 'string' && win.__emppSubBook) ? win.__emppSubBook : '';
      var WORK = subBook ? pathMod.join(WORK_ROOT, subBook) : WORK_ROOT;
      var kok = kokBul(pathMod, BASE, subBook);
      var ORTU = ortuOkuyucu(realRequire, realFs, pathMod, proc, kok);
      var shim = createShim(realFs, pathMod, WORK, BASE, ORTU);
      win.require = function (name) { return name === 'fs' ? shim : realRequire.apply(this, arguments); };
      installFetch(win, realFs, pathMod, WORK, BASE);
      Object.keys(realRequire).forEach(function (k) { try { win.require[k] = realRequire[k]; } catch (e) {} });
      win.__emppFsShim = shim;
      icerikKancasi(win, realRequire, realFs, pathMod, makeResolver(pathMod, realFs, WORK, BASE, ORTU), WORK, kok);
      return shim;
    } catch (e) {
      try { console.warn('[empp-fs-shim] kurulamadı:', e && e.message); } catch (_) {}
      return null;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createShim, makeResolver, install, installFetch, workPathForUrl, icerikKancasi, kokBul, ortuOkuyucu };
  if (isRenderer) install(window);
})();
