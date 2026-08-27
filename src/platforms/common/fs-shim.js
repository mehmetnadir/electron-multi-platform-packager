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
  var isNode = typeof module !== 'undefined' && module.exports;

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
        return null; // paket dışı mutlak yol: dokunma
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
      Object.keys(realRequire).forEach(function (k) { try { win.require[k] = realRequire[k]; } catch (e) {} });
      win.__emppFsShim = shim;
      return shim;
    } catch (e) {
      try { console.warn('[empp-fs-shim] kurulamadı:', e && e.message); } catch (_) {}
      return null;
    }
  }

  if (isNode) module.exports = { createShim, makeResolver, install };
  else install(typeof window !== 'undefined' ? window : null);
})();
