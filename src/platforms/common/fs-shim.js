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

  /**
   * A1 KAPAK SÜZME (2026-10-05, deneme — arastirma/set-kabuk-0510/a1-deneme-sonuc.md).
   * 11-12 tek motorlu setlerde sf425 kabuğu motoru `?kapak=<ID>` ile açar. Motor kitap listesini
   * `classlibraries/ImWin32.dll` menüsünden kurar; menüde TEK kapak varsa `oneBook` yolundan
   * kapağı doğrudan açar ve `defaultPageNo` çalışır. Shim:
   *   • OKUMA (fetch + fs.readFile*): menüyü kapağa süzer (yalnız o kapağı taşıyan Group/Tab/cover);
   *   • YAZMA (fs.writeFile*): motor tek kapaklı menüyü geri yazınca `<main>` niteliklerini
   *     (aktivasyon anahtarı `key` burada) ve kapak ögesini ASIL menüye birleştirir.
   * Sonuç: anahtar set başına tek kalır. `?kapak` yoksa davranış BİREBİR eski.
   * Motor her açılışta menüyü geri yazar (6395 `v` → `E(r)`), birleştirme her açılışta çalışır.
   * YAZMA KAPISI (13b5bfd incelemesi): yazılan menü asıldan DARSA (alt küme/başka kimlik/0 kapak),
   * çözülemiyorsa ya da yazım hata verirse yazma ATLANIR; asıl yerinde kalır, geçici dosya silinir.
   * BİLİNEN SINIRLAR (ölçülmedi, a1-deneme-sonuc.md §3):
   *   k6 — çevrimiçi aktivasyon `UserNewKeySet`'e `kitapId = module.covers[0].id` gider; süzülmüş
   *        menüde bu açılan kapaktır (setin ilk kitabı değil). Sunucu kodu kitaba bağlıysa red olabilir.
   *   k7 — `GetPackageBooks` kitap listesi dönerse motor menüyü sunucudan yeniden kurar → `oneBook`
   *        yok, kitap seçme ekranı (çökme yok; tam menü yazması "aynen" kararıyla geçer).
   */
  var IMWIN_BICIM = [[127, 17], [27, 5]];
  var IMWIN_RE = /(^|[\\/])classlibraries[\\/]ImWin32\.dll$/i;
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
  function ogeRe(ad) { return new RegExp('<' + ad + '\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/' + ad + '>)', 'g'); }
  function kapakIdleri(s) {
    var l = [], m, re = ogeRe('cover');
    while ((m = re.exec(s))) { var k = /^<cover\b[^>]*?\sID="([^"]*)"/.exec(m[0]); if (k) l.push(k[1]); }
    return l;
  }
  function tekil(l) { var o = []; for (var i = 0; i < l.length; i++) if (o.indexOf(l[i]) === -1) o.push(l[i]); return o; }
  /** `?kapak=<1-12 hane>` (tam değer; baştaki sıfırlar atılır, 0 geçersiz). */
  function kapakOku(search) {
    var m = /[?&]kapak=(\d{1,12})(?=&|#|$)/.exec(String(search || ''));
    if (!m) return null;
    var id = m[1].replace(/^0+/, '');
    return id ? id : null;
  }
  /** İçerik/anahtar basmadan uyarı (Silent Catch Gate): yalnız hata kodu/adı. */
  function kapakUyar(ne, e) {
    try { console.warn('[empp-fs-shim] kapak ' + ne, (e && (e.code || e.name)) || e || ''); } catch (_) {}
  }
  var TUT = '\u0001'; // süzmede tutulan kapak ögesinin geçici işareti (XML'de geçmez)
  /**
   * Menüyü TEK kapağa süzer: kapağı taşıyan İLK Group, onun içinde İLK Tab, onun içinde İLK kapak
   * ögesi kalır (aynı kimlik "Tümü" + ders sekmesinde yinelenebilir). Group dışındaki Tab/cover
   * atılır (motor yalnız main.Group[].Tab[].cover[] okur). Kapak Group>Tab içinde yoksa ya da
   * sonuçta tam bir kapak kalmazsa null (süzme yapılmaz, menü olduğu gibi gider).
   */
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
  /** `<main …>` açılış etiketindeki `key` değeri ('' = boş ya da yok). SAF. */
  function mainKey(xml) {
    var m = /<main\b[^>]*>/.exec(String(xml));
    var k = m && /\skey="([^"]*)"/.exec(m[0]);
    return k ? k[1] : '';
  }
  /** Yalnız `<main …>` etiketindeki `key`i değiştirir (yoksa ekler); gerisi bayt-aynı. SAF. */
  function keyYaz(xml, key) {
    return String(xml).replace(/<main\b[^>]*>/, function (etiket) {
      return /\skey="[^"]*"/.test(etiket)
        ? etiket.replace(/\skey="[^"]*"/, function () { return ' key="' + key + '"'; })
        : etiket.replace(/^<main\b/, function (m0) { return m0 + ' key="' + key + '"'; });
    });
  }
  function kumeEsit(a, b) {
    a = tekil(a); b = tekil(b);
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) === -1) return false;
    return true;
  }
  /**
   * Motorun yazdığı TEK kapaklı menüyü asıl menüye birleştirir: `<main …>` açılış etiketi ve
   * kapak ögesi yazılandan, gerisi (diğer kapaklar, Group/Tab) asıldan; asılda yinelenen aynı
   * kimlikli ögelerin hepsi güncellenir. Boş `key` dolu `key`'i EZMEZ. Yazılan menü tek kapaklı
   * ve o kapak değilse ya da birleşim kapak kümesini koruyamıyorsa null.
   */
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
      // Boş anahtar dolu anahtarı EZMEZ: anahtarsız açılmış ikinci pencere bellekteki boş
      // `key`'i geri yazınca ilk pencerede girilen kod silinmesin. Motor main.key'i hiç boşaltmaz.
      var eskiKey = mainKey(asil);
      if (eskiKey && !mainKey(etiket)) etiket = keyYaz(etiket, eskiKey);
      out = out.replace(/<main\b[^>]*>/, function () { return etiket; });
    }
    out = out.replace(ogeRe('cover'), function (c) { return kapakIdleri(c)[0] === kapak ? kapakYeni : c; });
    return kumeEsit(kapakIdleri(out), asilIdler) ? out : null;
  }
  /** fs'e verilen veri (string/Buffer/Uint8Array) → metin. */
  function metneCevir(veri) {
    if (typeof veri === 'string') return veri;
    if (veri && typeof veri === 'object' && typeof veri.byteLength === 'number' && typeof Buffer !== 'undefined') {
      return Buffer.from(veri.buffer || veri, veri.byteOffset || 0, veri.byteLength).toString('utf8');
    }
    return String(veri);
  }
  /**
   * Kapak kipinde ImWin32 yazma KARARI. SAF.
   * @returns {{tur: 'birlesik', metin: string}|{tur: 'aynen'}|{tur: 'reddet', neden: string}}
   *   aynen   = yazılan menü asılın BÜTÜN kapaklarını taşıyor (ör. motor menüyü sunucudan kurdu);
   *   reddet  = yazılan asıldan DAR (alt küme / başka kimlik / 0 kapak), çözülemiyor ya da asıl
   *             okunamıyor → yazma ATLANIR, asıl menü yerinde kalır (fail-closed).
   */
  function yazmaKarari(asilHam, veri, kapak) {
    var y = imwinCoz(metneCevir(veri));
    if (!y) return { tur: 'reddet', neden: 'yazılan menü çözülemedi' };
    var a = asilHam == null ? null : imwinCoz(asilHam);
    if (!a) return { tur: 'reddet', neden: 'asıl menü okunamadı' };
    var yIds = tekil(kapakIdleri(y.xml)), aIds = tekil(kapakIdleri(a.xml));
    var yKey = mainKey(y.xml), aKey = mainKey(a.xml);
    // Ö2a (inceleme 05.10): reddedilen yazmada motorun yeni girdiği anahtar kaybolmasın — menünün
    // gerisi asıldan kalır, YALNIZ `<main key>` asıla taşınır.
    var red = function (neden) {
      if (yKey && yKey !== aKey) {
        return { tur: 'birlesik', metin: imwinYaz(keyYaz(a.xml, yKey), 27, 5), neden: neden + ' — yalnız anahtar taşındı' };
      }
      return { tur: 'reddet', neden: neden };
    };
    if (yIds.length === 1 && yIds[0] === String(kapak)) {
      var b = menuBirlestir(a.xml, y.xml, kapak);
      return b == null ? red('birleşim kapak kümesini korumadı')
        : { tur: 'birlesik', metin: imwinYaz(b, 27, 5) }; // motorun yazıcısı (6395 `E`) biçimi
    }
    for (var i = 0; i < aIds.length; i++) {
      if (yIds.indexOf(aIds[i]) === -1) return red('yazılan menü asıldan dar');
    }
    // Ö2b: tam menü yazmasında da boş anahtar dolu anahtarı EZMEZ (menü yazılandan, anahtar asıldan).
    if (aKey && !yKey) return { tur: 'birlesik', metin: imwinYaz(keyYaz(y.xml, aKey), y.n, y.r) };
    return { tur: 'aynen' };
  }

  var KILIT_DENEME = 40, KILIT_BEKLE_MS = 5, KILIT_BAYAT_MS = 5000;
  // k2 (inceleme 05.10): Windows'ta hedefi başka süreç (antivirüs, dizinleyici, ikinci pencere)
  // kısa süre açık tutarsa rename EPERM/EBUSY/EACCES verir; kısa aralıkla yeniden denenir.
  var RENAME_DENEME = 5, RENAME_BEKLE_MS = 20;
  function renameDene(realFs, kaynak, hedef) {
    for (var i = 1; ; i++) {
      try { realFs.renameSync(kaynak, hedef); return; } catch (e) {
        if (i >= RENAME_DENEME || !e || (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES')) throw e;
        bekleMs(RENAME_BEKLE_MS);
      }
    }
  }
  function bekleMs(ms) { var son = Date.now() + ms; while (Date.now() < son) { /* kısa eşzamanlı bekleme */ } }

  /**
   * Kapak kipinde ImWin32 okuma/yazma kancası. Yazma: kısa kilit (`ImWin32.dll.lock`, wx) altında
   * asıl taze okunur → karar → geçici dosya + rename. Her hata yazmayı ATLATIR, geçici dosya
   * silinir, asıl yerinde kalır (eski "aynen yaz" yoluna DÜŞÜLMEZ — 13b5bfd incelemesi K1).
   */
  function kapakKancasi(shim, realFs, pathMod, R, KAPAK) {
    var P = shim.promises;
    var imwinMi = function (p) { var r = R.rel(p); return r != null && IMWIN_RE.test(String(r).replace(/\\/g, '/')); };
    var kodlamaVar = function (o) { return typeof o === 'string' || !!(o && typeof o === 'object' && o.encoding); };
    var suzulmus = function (p) {
      var ham = realFs.readFileSync(R.toRead(p), 'utf8');
      var c = imwinCoz(ham); if (!c) return null;
      var s = menuSuz(c.xml, KAPAK); if (s == null) return null;
      return imwinYaz(s, c.n, c.r);
    };
    /** @returns {'yazildi'|'aynen'|'atlandi'} — 'aynen' ise çağıran eski yazma yolunu kullanır. */
    var kapakYaz = function (p, veri) {
      var hedef = R.toWork(p);
      var kilit = hedef + '.lock';
      var fd = null;
      for (var i = 0; i < KILIT_DENEME && fd == null; i++) {
        try { fd = realFs.openSync(kilit, 'wx'); } catch (e) {
          if (!e || e.code !== 'EEXIST') { kapakUyar('kilit', e); return 'atlandi'; }
          try { if (Date.now() - realFs.statSync(kilit).mtimeMs > KILIT_BAYAT_MS) realFs.unlinkSync(kilit); } catch (_) { /* yarış: başkası sildi */ }
          bekleMs(KILIT_BEKLE_MS);
        }
      }
      if (fd == null) { kapakUyar('kilit alınamadı', { code: 'EEXIST' }); return 'atlandi'; }
      var gecici = null;
      try {
        var asilHam = null;
        try { asilHam = realFs.readFileSync(R.toRead(p), 'utf8'); } catch (e) { kapakUyar('asıl okunamadı', e); }
        var k = yazmaKarari(asilHam, veri, KAPAK);
        if (k.tur === 'aynen') return 'aynen';
        if (k.tur === 'reddet') { kapakUyar('yazma reddedildi: ' + k.neden); return 'atlandi'; }
        gecici = hedef + '.empp-' + ((typeof process !== 'undefined' && process.pid) || 0) + '-' + Math.random().toString(36).slice(2);
        realFs.writeFileSync(gecici, k.metin, 'utf8');
        renameDene(realFs, gecici, hedef);
        gecici = null;
        return 'yazildi';
      } catch (e) {
        kapakUyar('yazılamadı', e);
        return 'atlandi';
      } finally {
        if (gecici) { try { realFs.unlinkSync(gecici); } catch (e) { kapakUyar('geçici silinemedi', e); } }
        try { realFs.closeSync(fd); } catch (e) { kapakUyar('kilit kapanmadı', e); }
        try { realFs.unlinkSync(kilit); } catch (e) { kapakUyar('kilit silinemedi', e); }
      }
    };
    var rS = shim.readFileSync, rA = shim.readFile, wS = shim.writeFileSync, wA = shim.writeFile;
    shim.readFileSync = function (p, o) {
      if (imwinMi(p)) {
        try { var s = suzulmus(p); if (s != null) return kodlamaVar(o) ? s : Buffer.from(s, 'utf8'); } catch (e) { kapakUyar('okuma', e); }
      }
      return rS.apply(this, arguments);
    };
    shim.readFile = function (p, o, cb) {
      if (typeof o === 'function') { cb = o; o = undefined; }
      if (imwinMi(p) && typeof cb === 'function') {
        try {
          var s = suzulmus(p);
          if (s != null) { var v = kodlamaVar(o) ? s : Buffer.from(s, 'utf8'); setTimeout(function () { cb(null, v); }, 0); return; }
        } catch (e) { kapakUyar('okuma', e); }
      }
      return o === undefined ? rA.call(this, p, cb) : rA.call(this, p, o, cb);
    };
    shim.writeFileSync = function (p, veri) {
      if (imwinMi(p) && kapakYaz(p, veri) !== 'aynen') return undefined;
      return wS.apply(this, arguments);
    };
    shim.writeFile = function (p, veri) {
      var cb = arguments[arguments.length - 1];
      if (imwinMi(p) && typeof cb === 'function' && kapakYaz(p, veri) !== 'aynen') {
        setTimeout(function () { cb(null); }, 0);
        return undefined;
      }
      return wA.apply(this, arguments);
    };
    if (P) {
      var prF = P.readFile, pwF = P.writeFile;
      P.readFile = function (p, o) {
        if (imwinMi(p)) {
          try { var s = suzulmus(p); if (s != null) return Promise.resolve(kodlamaVar(o) ? s : Buffer.from(s, 'utf8')); } catch (e) { kapakUyar('okuma', e); }
        }
        return prF.apply(P, arguments);
      };
      P.writeFile = function (p, veri) {
        if (imwinMi(p) && kapakYaz(p, veri) !== 'aynen') return Promise.resolve();
        return pwF.apply(P, arguments);
      };
    }
    return { suzulmus: suzulmus };
  }

  function createShim(realFs, pathMod, WORK, BASE, ORTU, KAPAK) {
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
    shim.__empp = { WORK: WORK, BASE: BASE, ORTU: ORTU || null, KAPAK: KAPAK || null };
    if (KAPAK) shim.__empp.kapak = kapakKancasi(shim, realFs, pathMod, R, String(KAPAK));
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

  /** A1: `?kapak` kipinde ImWin32.dll fetch'i süzülmüş menüyle cevaplanır (motor menüyü fetch ile okur). */
  // Bozuk % dizisi (URIError) ya da beklenmeyen girdi → null: kapak kipinde fetch ÇÖKMEZ (Ö2).
  function kapakFetchYolu(url, pathMod, realFs, WORK, BASE) {
    try {
      if (typeof url !== 'string' || !url) return null;
      var u = url.split(/[?#]/)[0];
      if (/^(https?|data|blob|ws|wss):/i.test(u)) return null;
      var rel = /^file:/i.test(u)
        ? pathMod.relative(BASE, decodeURIComponent(u.replace(/^file:\/\//i, '')).replace(/^\/([a-zA-Z]:[\\/])/, '$1'))
        : decodeURIComponent(u).replace(/^\.\//, '').replace(/^\/+/, '');
      if (!rel || rel.startsWith('..') || !IMWIN_RE.test(rel.replace(/\\/g, '/'))) return null;
      return rel;
    } catch (e) { return null; }
  }

  function installFetch(win, realFs, pathMod, WORK, BASE, KAPAK, ORTU) {
    var realFetch = win.fetch;
    if (typeof realFetch !== 'function' || realFetch.__empp) return;
    // Kapak kipi okuması fs okumasıyla AYNI çözücüyü kullanır (WORK → örtü → paket).
    var kapakR = KAPAK ? makeResolver(pathMod, realFs, WORK, BASE, ORTU || null) : null;
    var wrapped = function (input, init) {
      var url = (input && typeof input === 'object' && 'url' in input) ? input.url : input;
      if (KAPAK) {
        var kr = kapakFetchYolu(url, pathMod, realFs, WORK, BASE);
        if (kr) {
          try {
            var ham = realFs.readFileSync(kapakR.toRead(kr), 'utf8');
            var c = imwinCoz(ham), s = c ? menuSuz(c.xml, String(KAPAK)) : null;
            if (s != null) {
              return Promise.resolve(new win.Response(imwinYaz(s, c.n, c.r), { status: 200,
                headers: { 'Content-Type': 'application/octet-stream', 'X-EMPP-Source': 'kapak' } }));
            }
          } catch (e) { kapakUyar('fetch', e); /* düş: süzmesiz yol */ }
        }
      }
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
      // A1 (2026-10-05): sf425 kabuğu tek motoru `?kapak=<ID>` ile açar → menü o kapağa süzülür.
      var KAPAK = kapakOku(win.location && win.location.search);
      var shim = createShim(realFs, pathMod, WORK, BASE, ORTU, KAPAK);
      win.require = function (name) { return name === 'fs' ? shim : realRequire.apply(this, arguments); };
      installFetch(win, realFs, pathMod, WORK, BASE, KAPAK, ORTU);
      Object.keys(realRequire).forEach(function (k) { try { win.require[k] = realRequire[k]; } catch (e) {} });
      win.__emppFsShim = shim;
      icerikKancasi(win, realRequire, realFs, pathMod, makeResolver(pathMod, realFs, WORK, BASE, ORTU), WORK, kok);
      return shim;
    } catch (e) {
      try { console.warn('[empp-fs-shim] kurulamadı:', e && e.message); } catch (_) {}
      return null;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createShim, makeResolver, install, installFetch, workPathForUrl, icerikKancasi, kokBul, ortuOkuyucu,
    imwinCoz, imwinYaz, menuSuz, menuBirlestir, kapakOku, kapakIdleri, yazmaKarari, kapakFetchYolu };
  if (isRenderer) install(window);
})();
