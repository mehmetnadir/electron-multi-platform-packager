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

  function makeResolver(pathMod, realFs, WORK, BASE) {
    function rel(p) {
      if (typeof p !== 'string' || !p) return null;
      if (/^file:/i.test(p)) return null;
      if (pathMod.isAbsolute(p)) {
        var r = pathMod.relative(BASE, p);
        if (r && !r.startsWith('..') && !pathMod.isAbsolute(r)) return r;
        var w = pathMod.relative(WORK, p);
        if (w && !w.startsWith('..') && !pathMod.isAbsolute(w)) return w;
        // Uygulama getFilePath("/classlibraries/ImWin32.dll") gibi KÖK-mutlak yollar üretir
        // (exe yolu boş → join("", "/x") = "/x"). Gerçek kök dizini değilse (/Users, /Applications,
        // /private...) paket-göreli say. Gerçek sistem yolu ise dokunma.
        var first = p.split('/').filter(Boolean)[0];
        var rootExists = false;
        try { rootExists = !!first && realFs.existsSync('/' + first); } catch (e) {}
        if (first && !rootExists) return p.replace(/^\/+/, '');
        return null;
      }
      return p.replace(/^\.\//, '');
    }
    function ensureDir(p) { try { realFs.mkdirSync(pathMod.dirname(p), { recursive: true }); } catch (e) {} }
    function toWork(p) { var r = rel(p); if (r == null) return p; var w = pathMod.join(WORK, r); ensureDir(w); return w; }
    function toRead(p) {
      var r = rel(p); if (r == null) return p;
      var w = pathMod.join(WORK, r);
      try { if (realFs.existsSync(w)) return w; } catch (e) {}
      return pathMod.join(BASE, r);
    }
    return { rel: rel, toWork: toWork, toRead: toRead };
  }

  function createShim(realFs, pathMod, WORK, BASE) {
    var R = makeResolver(pathMod, realFs, WORK, BASE);
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
        var r = R.rel(p); if (r == null) return v.call(realFs, p, opts);
        var seen = {}, out = [];
        [pathMod.join(WORK, r), pathMod.join(BASE, r)].forEach(function (d) {
          var list = []; try { list = v.call(realFs, d, opts); } catch (e) {}
          list.forEach(function (ent) { var name = typeof ent === 'string' ? ent : ent.name; if (!seen[name]) { seen[name] = 1; out.push(ent); } });
        });
        if (!out.length) return v.call(realFs, pathMod.join(BASE, r), opts); // ENOENT'i gerçek fs fırlatsın
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
        else sp[k] = function () { var a = Array.prototype.slice.call(arguments); if (typeof a[0] === 'string') a[0] = R.toRead(a[0]); return v.apply(P, a); };
      });
      shim.promises = sp;
    }
    shim.__empp = { WORK: WORK, BASE: BASE };
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

  function install(win) {
    try {
      if (!win || typeof win.require !== 'function') return null; // web/Capacitor: shim gereksiz
      if (win.__emppFsShim) return win.__emppFsShim;
      var realRequire = win.require;
      var pathMod = realRequire('path');
      var realFs = realRequire('fs');
      var proc = (typeof process !== 'undefined') ? process : null;
      if (proc && proc.platform === 'win32') return null; // Windows'ta CWD kurulum dizini — dokunma
      var BASE = (typeof __dirname === 'string' && __dirname) ? __dirname : pathMod.dirname((win.location && win.location.pathname) || '/');
      var WORK = (proc && proc.env && proc.env.EMPP_WORK_DIR) || null;
      if (!WORK) {
        var home = (proc && proc.env && (proc.env.HOME || proc.env.USERPROFILE)) || '';
        WORK = pathMod.join(home, '.empp-work');
      }
      var shim = createShim(realFs, pathMod, WORK, BASE);
      win.require = function (name) { return name === 'fs' ? shim : realRequire.apply(this, arguments); };
      installFetch(win, realFs, pathMod, WORK, BASE);
      Object.keys(realRequire).forEach(function (k) { try { win.require[k] = realRequire[k]; } catch (e) {} });
      win.__emppFsShim = shim;
      return shim;
    } catch (e) {
      try { console.warn('[empp-fs-shim] kurulamadı:', e && e.message); } catch (_) {}
      return null;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createShim, makeResolver, install, installFetch, workPathForUrl };
  if (isRenderer) install(window);
})();
