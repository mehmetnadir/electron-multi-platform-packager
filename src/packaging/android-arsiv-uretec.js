/**
 * Android için Kitap Arşivi Üreteci ve Shim Uyarlama Modülü.
 *
 * Bu modül, Android paketi için kitap dizinine uygulanacak shim ve manifest
 * uyarlamalarını (empp-android-shim.js kopyalanması, empp-manifest.json üretimi,
 * viewport ve webview compat shim enjeksiyonu) gerçekleştirir ve zip arşivi üretir.
 */

const path = require('path');
const fs = require('fs-extra');
const archiver = require('archiver');
const { shimKopyala: androidShimKopyala } = require('../platforms/android/cevrimici-yoklama');

/**
 * WebView'de eksik olan window.require'ı Electron/Node stub'larıyla taklit eden script.
 * @returns {string} HTML script etiketi
 */
function buildWebViewRequireShim() {
  return `<script id="__webviewCompatShim">
(function(){
  if (typeof window.require === 'function') return;

  // path: join '..' ve '.' segmentlerini ÇÖZER. Capacitor asset loader ham URL'deki
  // '..'yi (path-traversal koruması) reddettiği için home nav'da çözülmüş yol şart.
  var P = {
    sep: '/',
    dirname: function(p){ p=String(p||''); var s=p.replace(/\\/+$/,''); var i=s.lastIndexOf('/'); return i<=0 ? '/' : s.slice(0,i); },
    basename: function(p){ p=String(p||''); return p.slice(p.lastIndexOf('/')+1); },
    extname: function(p){ var m=/\\.[^.\\/]+$/.exec(String(p||'')); return m?m[0]:''; },
    join: function(){
      var parts = Array.prototype.filter.call(arguments, function(x){ return x!=null && x!==''; });
      var joined = parts.join('/');
      var origin = '';
      var mm = /^([a-zA-Z][a-zA-Z0-9+.-]*:\\/\\/[^\\/]*)/.exec(joined);
      if (mm){ origin = mm[1]; joined = joined.slice(origin.length); }
      var abs = joined.charAt(0) === '/';
      var segs = joined.split('/');
      var out = [];
      for (var i=0;i<segs.length;i++){
        var s = segs[i];
        if (s==='' || s==='.') continue;
        if (s==='..'){ if(out.length && out[out.length-1]!=='..') out.pop(); else if(!abs) out.push('..'); continue; }
        out.push(s);
      }
      var body = out.join('/');
      // origin varsa köke çözülen yolda SONDA slash bırakma:
      // join('https://localhost/book1','../') -> 'https://localhost' (NOT 'https://localhost/').
      // Aksi halde SPA buna '/index.html' ekleyince '//index.html' oluşuyor (Capacitor reddediyor).
      var res = origin
        ? (body ? '/' + body : '')
        : ((abs ? '/' : '') + body);
      return origin + res;
    }
  };

  // fs: localStorage-destekli SANAL dosya sistemi. Kitabın electron-dosya tabanlı
  // kalıcılık katmanı (kalınan sayfa, settings, answers) şeffafça localStorage'a yazılır.
  var VFS_PREFIX = '__vfs__';
  var FS = {
    existsSync: function(p){ try{ return localStorage.getItem(VFS_PREFIX+p) !== null; }catch(e){ return false; } },
    readFileSync: function(p){ try{ return localStorage.getItem(VFS_PREFIX+p); }catch(e){ return null; } },
    writeFileSync: function(p, data){ try{ localStorage.setItem(VFS_PREFIX+p, String(data)); }catch(e){} },
    copyFileSync: function(a,b){ try{ var v=localStorage.getItem(VFS_PREFIX+a); if(v!==null) localStorage.setItem(VFS_PREFIX+b,v); }catch(e){} },
    unlinkSync: function(p){ try{ localStorage.removeItem(VFS_PREFIX+p); }catch(e){} },
    mkdirSync: function(){}, readdirSync: function(){ return []; }
  };

  var ELECTRON = {
    remote: { app: { quit:function(){}, getAppPath:function(){return ''; } } },
    shell: { openExternal:function(u){ try{ window.open(u,'_blank'); }catch(e){} } },
    ipcRenderer: { send:function(){}, on:function(){}, invoke:function(){return Promise.resolve();} }
  };

  window.require = function(m){
    if (m==='path') return P;
    if (m==='fs' || m==='fs-extra') return FS;
    if (m==='electron') return ELECTRON;
    return {};
  };
})();

// Navigasyon normalize: SPA home butonu URL'i string-concat ile kursa bile
// Capacitor asset loader'a ULAŞMADAN temizle. Capacitor ham '..' yolunu (path-traversal)
// reddeder; ayrıca kök /index.html bazı sürümlerde 404 döner ama kök '/' açılışta çalışır.
// Bu yüzden: '..'/'.' çöz + KÖK '/index.html' -> '/'. (book1/index.html gibi alt sayfalar dokunulmaz.)
(function(){
  function clean(u){
    try {
      var url = new URL(String(u), document.baseURI);
      // path'teki tekrarlı '/'leri tekille (ör. //index.html -> /index.html).
      // origin'deki protokol '//' etkilenmez (o pathname'de değil).
      url.pathname = url.pathname.replace(/\\/{2,}/g, '/');
      var abs = url.href;
      // KÖK /index.html -> / (açılışta çalışan kök). Alt sayfalar (book1/index.html) korunur.
      abs = abs.replace(/^(https?:\\/\\/[^\\/]+)\\/index\\.html(\\?|#|$)/, '$1/$2');
      return abs;
    } catch(e){ return u; }
  }
  try {
    var oa = window.location.assign.bind(window.location);
    window.location.assign = function(u){ return oa(clean(u)); };
  } catch(e){}
  try {
    var orp = window.location.replace.bind(window.location);
    window.location.replace = function(u){ return orp(clean(u)); };
  } catch(e){}
  try {
    var d = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (d && d.set){
      Object.defineProperty(window.location, 'href', {
        configurable: true,
        get: function(){ return d.get.call(window.location); },
        set: function(u){ d.set.call(window.location, clean(u)); }
      });
    }
  } catch(e){}
  try {
    document.addEventListener('click', function(ev){
      try {
        var a = ev.target && ev.target.closest && ev.target.closest('a[href]');
        if (a){ var h0 = a.getAttribute('href'); var c = clean(h0); if (c !== h0) a.setAttribute('href', c); }
      } catch(e){}
    }, true);
  } catch(e){}
})();
</script>`;
}

/**
 * Android manifesti üretir.
 * @param {string} rootPath Dizin yolu
 * @returns {Promise<{tree: Object, dirs: Array<string>}>}
 */
async function buildAndroidManifest(rootPath) {
  const tree = {}; const dirs = [];
  const listDir = async (rel) => {
    const abs = path.join(rootPath, rel);
    const ents = await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
    tree[rel] = ents.map((e) => e.name).filter((n) => n !== 'empp-manifest.json');
    for (const e of ents) if (e.isDirectory()) dirs.push(rel ? `${rel}/${e.name}` : e.name);
  };
  await listDir('');
  for (const top of ['assets', 'classlibraries', 'temp', 'core']) {
    if (await fs.pathExists(path.join(rootPath, top))) {
      await listDir(top);
      if (top === 'assets') {
        for (const id of tree.assets || []) {
          if ((await fs.stat(path.join(rootPath, 'assets', id)).catch(() => null))?.isDirectory()) {
            await listDir(`assets/${id}`);
          }
        }
      }
    }
  }
  return { tree, dirs };
}

/**
 * Kitap dizinini Android için uyarlar (empp-android-shim, empp-manifest.json, viewport, compat-shim).
 * index.html yoksa Error fırlatır — sessiz geçiş yok.
 *
 * @param {string} kitapDizini Kitap dizini (bookN)
 * @param {Object} [secenek] Seçenekler
 * @returns {Promise<{dosyalar: Array<string>, uyarilar: Array<string>}>}
 */
async function kitapDizininiAndroidIcinUyarla(kitapDizini, secenek = {}) {
  const idx = path.join(kitapDizini, 'index.html');
  if (!await fs.pathExists(idx)) {
    throw new Error(`Kitap dizininde index.html bulunamadı: ${kitapDizini}`);
  }

  const dosyalar = [];
  const uyarilar = [];

  // 1. empp-android-shim.js kopyalama (K3)
  const shimHedef = path.join(kitapDizini, 'empp-android-shim.js');
  const kaynakYolu = secenek.kaynakYolu || path.join(__dirname, '../platforms/android/empp-android-shim.js');
  await androidShimKopyala(shimHedef, { kaynakYolu });
  dosyalar.push(shimHedef);

  // 2. empp-manifest.json üretimi (K3)
  const bookManifest = await buildAndroidManifest(kitapDizini);
  const manifestHedef = path.join(kitapDizini, 'empp-manifest.json');
  await fs.writeJson(manifestHedef, bookManifest, { spaces: 0 });
  dosyalar.push(manifestHedef);

  // 3. index.html: viewport + android shim + require shim
  const viewportMeta = '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">';
  const androidShimTag = '<script src="empp-android-shim.js"></script>';
  const requireShim = secenek.requireShim || buildWebViewRequireShim();

  let html = await fs.readFile(idx, 'utf8');

  if (/<meta\s+name=["']viewport["'][^>]*>/i.test(html)) {
    html = html.replace(/<meta\s+name=["']viewport["'][^>]*>/i, viewportMeta);
  } else if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, viewportMeta + '</head>');
  }

  html = html.replace(/<script id="empp-app-mode">[\s\S]*?<\/script>/, '');

  let toInject = '';
  if (!html.includes('empp-android-shim.js')) toInject += androidShimTag;
  if (!html.includes('__webviewCompatShim')) toInject += (toInject ? '\n' : '') + requireShim;
  if (toInject) {
    html = html.replace(/<head[^>]*>/i, (m) => m + '\n' + toInject);
  }

  await fs.writeFile(idx, html);
  dosyalar.push(idx);

  // 4. bundle: window.isApp=true zorla (top-level .js dosyalarında)
  const files = await fs.readdir(kitapDizini, { withFileTypes: true });
  for (const f of files) {
    if (!f.isFile() || !f.name.endsWith('.js')) continue;
    const jsPath = path.join(kitapDizini, f.name);
    let js = await fs.readFile(jsPath, 'utf8');
    if (js.includes('window.isApp=Boolean(')) {
      js = js.split('window.isApp=Boolean(').join('window.isApp=true||Boolean(');
      await fs.writeFile(jsPath, js);
      dosyalar.push(jsPath);
    }
  }

  return { dosyalar, uyarilar };
}

/**
 * Kitap dizinini Android için uyarlayıp ZIP arşivi üretir.
 *
 * @param {string} kitapDizini Kaynak kitap dizini
 * @param {string} hedefZip Hedef ZIP dosyası yolu
 * @param {Object} [secenek] Seçenekler
 * @returns {Promise<{hedefZip: string, ok: boolean}>}
 */
async function androidArsiviUret(kitapDizini, hedefZip, secenek = {}) {
  await kitapDizininiAndroidIcinUyarla(kitapDizini, secenek);

  await fs.ensureDir(path.dirname(hedefZip));
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(hedefZip);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      resolve({ hedefZip, ok: true });
    });

    archive.on('error', (err) => reject(err));
    output.on('error', (err) => reject(err));

    archive.pipe(output);
    archive.directory(kitapDizini, false);
    archive.finalize();
  });
}

module.exports = {
  kitapDizininiAndroidIcinUyarla,
  androidArsiviUret,
  buildAndroidManifest,
  buildWebViewRequireShim,
};
