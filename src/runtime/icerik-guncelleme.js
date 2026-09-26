/* eslint-disable */
'use strict';

/**
 * İMPARK KİTAP İÇERİK GÜNCELLEMESİ (kanal K) — ÇALIŞMA ANI MODÜLÜ.
 *
 * Pakete `empp-icerik-guncelleme.js` adıyla kopyalanır (bkz.
 * `src/packaging/icerik-guncelleme.js`). Tek dosya, iki bağlam:
 *   • ANA SÜREÇ  → `anaSurecKur()`  : WORK menüsü ↔ paket menüsü uzlaşması (açılışta,
 *                                     pencereden önce) + `file:` protokol örtüsü
 *                                     (WORK kopyası BASE'in önünde: fetch/img/iframe/medya).
 *   • RENDERER   → `rendererKur()`  : fs-shim kurulduktan sonra çağrılır;
 *                                     `window.require('adm-zip')` açma hedefini WORK'e çevirir,
 *                                     açmayı doğrular, doğrulanmamış menü sürümü yazımını
 *                                     geri çevirir (sahte "Kitap Güncellendi" kapanır).
 *
 * KÖK NEDEN (GUNCELLEME-TESPIT 2026-09-24, ProBook ölçümü): motor `extractZipFiles`
 * içinde `window.require("adm-zip")` ile açıyor, hata `console.log` ile yutuluyor ve
 * reducer menü sürümünü yine de ilerletiyordu → sürüm yükseliyor, içerik eski kalıyor,
 * güncelleme bir daha teklif edilmiyor.
 *
 * DİSİPLİN: hiçbir fonksiyon uygulamayı düşürmez; her giriş noktası try/catch içinde.
 * Silme YOK: uzlaşmada geri çevrilen menü ve geçersiz kalan içerik `WORK/.empp-eski/`
 * altına TAŞINIR.
 */

var MENU_GORELI = 'classlibraries/ImWin32.dll';
var ISARET_ADI = '.empp-icerik.json';
var LOG_ADI = 'empp-icerik.log';
var ESKI_DIZIN = '.empp-eski';
var PAD_BAS = 27;
var PAD_SON = 27;
var PAD_ARA = 4;

// ─── Menü (ImWin32.dll) kodlama ──────────────────────────────────────────────
// Motorun kendi biçimi (main bundle, `E()`): 27 rastgele karakter + her karakterden sonra
// 4 rastgele karakter + 27 rastgele karakter. Rastgeleler 1..125 (ASCII) — dosya UTF-8
// yazıldığı için ÇÖZME dizgi (UTF-16 kod birimi) düzeyinde yapılır, bayt düzeyinde değil
// (bayt düzeyi "İmpark" gibi çok baytlı karakterlerde kayıyor — ölçüldü).

function menuCoz(veri) {
  var s = Buffer.isBuffer(veri) ? veri.toString('utf8') : String(veri == null ? '' : veri);
  if (/^\s*<\?xml|^\s*<main\b/.test(s)) return s; // zaten açık metin
  if (s.length < PAD_BAS + PAD_SON + 1) return null;
  var govde = s.slice(PAD_BAS, s.length - PAD_SON);
  var out = '';
  for (var i = 0; i < govde.length; i += PAD_ARA + 1) out += govde.charAt(i);
  return /<main\b/.test(out) ? out : null;
}

function menuKodla(xml, rastgele) {
  var rnd = typeof rastgele === 'function' ? rastgele : Math.random;
  var t = '';
  function doldur(n) { for (var k = 0; k < n; k++) t += String.fromCharCode(Math.floor(125 * rnd()) + 1); }
  doldur(PAD_BAS);
  for (var i = 0; i < xml.length; i++) { t += xml.charAt(i); doldur(PAD_ARA); }
  doldur(PAD_SON);
  return t;
}

function attrOku(etiket, ad) {
  var m = new RegExp('\\s' + ad + '="([^"]*)"').exec(etiket);
  return m ? m[1] : null;
}

function attrYaz(etiket, ad, deger) {
  var re = new RegExp('(\\s' + ad + '=")[^"]*(")');
  if (re.test(etiket)) return etiket.replace(re, function (_, a, b) { return a + deger + b; });
  return etiket.replace(/\s*\/?>$/, function (son) { return ' ' + ad + '="' + deger + '"' + son; });
}

/** @returns {Array<{ID:string, version:number|null, URL:string|null, etiket:string}>} */
function kapaklar(xml) {
  var out = [];
  var re = /<cover\b[^>]*>/g, m;
  while ((m = re.exec(String(xml || '')))) {
    var e = m[0];
    var v = attrOku(e, 'version');
    var n = v == null || v === '' ? null : Number(v);
    out.push({ ID: attrOku(e, 'ID'), version: Number.isFinite(n) ? n : null, URL: attrOku(e, 'URL'), etiket: e });
  }
  return out;
}

/** Bir kapağın version/URL alanlarını değiştirir (yalnız o etiketin içinde). */
function kapakAyarla(xml, id, alanlar) {
  var re = /<cover\b[^>]*>/g;
  return String(xml).replace(re, function (e) {
    if (attrOku(e, 'ID') !== String(id)) return e;
    var y = e;
    if (alanlar.version != null) y = attrYaz(y, 'version', String(alanlar.version));
    if (alanlar.URL != null) y = attrYaz(y, 'URL', String(alanlar.URL));
    return y;
  });
}

function mainAttrTasi(hedefXml, kaynakXml, adlar) {
  var km = /<main\b[^>]*>/.exec(kaynakXml);
  if (!km) return hedefXml;
  return String(hedefXml).replace(/<main\b[^>]*>/, function (e) {
    var y = e;
    adlar.forEach(function (ad) { var d = attrOku(km[0], ad); if (d != null) y = attrYaz(y, ad, d); });
    return y;
  });
}

/** Kapak etiketini başka bir etiketin TÜM alanlarıyla değiştirir; version/URL hedefte korunur. */
function kapakEtiketiTasi(xml, id, kaynakEtiket) {
  return String(xml).replace(/<cover\b[^>]*>/g, function (e) {
    if (attrOku(e, 'ID') !== String(id)) return e;
    var y = kaynakEtiket;
    ['version', 'URL'].forEach(function (ad) { var d = attrOku(e, ad); if (d != null) y = attrYaz(y, ad, d); });
    // Kendinden kapanan / açık etiket biçimi hedefteki gibi kalsın (alt öğeler bozulmasın).
    var hedefKapali = /\/>$/.test(e), kaynakKapali = /\/>$/.test(y);
    if (hedefKapali && !kaynakKapali) y = y.replace(/\s*>$/, '/>');
    if (!hedefKapali && kaynakKapali) y = y.replace(/\s*\/>$/, '>');
    return y;
  });
}

// ─── İşaretler ───────────────────────────────────────────────────────────────
// .empp-icerik.json    : açma doğrulandı (md5 + sürüm). Tek "içerik gerçekten açıldı" kanıtı.
// .empp-basarisiz.json : açma başarısız; yapısal hata (düzen/tavan) sayacı → tek yeniden deneme,
//                        sonra sürüm ilerlemesine izin (sonsuz 350 MB indirme döngüsü olmasın).

var BASARISIZ_ADI = '.empp-basarisiz.json';
var GECICI_DIZIN = '.empp-gecici';
var KILIT_ADI = '.empp-uzlasma.kilit';
var YAPISAL_DENEME = 2; // aynı yapısal hata 2. kez görülünce vazgeçilir
var VARSAYILAN_TAVAN_MB = 4096;
/** Paketleyicinin adm-zip'i koyduğu yer (paket kökü = bu modülün dizini; node_modules DIŞI —
 * gerekçe: src/packaging/icerik-guncelleme.js başlığı, 73768 mac regresyonu). */
var VENDOR_ADM_ZIP = 'empp-vendor/adm-zip';
var ESKI_BASARISIZ_TAVAN = 2; // kitap başına tutulan başarısız açma kenarı (Şef kararı)

function md5(fsMod, crypto, yolVeyaBuf) {
  var b = Buffer.isBuffer(yolVeyaBuf) ? yolVeyaBuf : fsMod.readFileSync(yolVeyaBuf);
  return crypto.createHash('md5').update(b).digest('hex');
}

function isaretOku(fsMod, pathMod, crypto, assetsDizini) {
  try {
    var j = JSON.parse(fsMod.readFileSync(pathMod.join(assetsDizini, ISARET_ADI), 'utf8'));
    var bc = pathMod.join(assetsDizini, 'data', 'BookContent.xml');
    if (!fsMod.existsSync(bc)) return null;
    if (j.bookContentMd5 && md5(fsMod, crypto, bc) !== j.bookContentMd5) return null;
    return j;
  } catch (e) { return null; }
}

function basarisizOku(fsMod, pathMod, assetsDizini) {
  try { return JSON.parse(fsMod.readFileSync(pathMod.join(assetsDizini, BASARISIZ_ADI), 'utf8')); } catch (e) { return null; }
}

// ─── UZLAŞMA KURALI (saf karar) ──────────────────────────────────────────────
/**
 * Kapak başına: vw = WORK menüsü sürümü, vb = paket menüsü sürümü, acilan = WORK'te
 * doğrulanmış açılmış içeriğin sürümü (işaret; yoksa null), vazgecilen = yapısal hatada
 * bilerek kabul edilmiş sürüm (yoksa null).
 *   vw <= vb                          → PAKET KAZANIR (vb)
 *   vw >  vb, acilan > vb             → WORK KALIR   (min(vw, acilan))
 *   vw >  vb, vazgecilen >= vw        → WORK KALIR   (yapısal hata, tek deneme sonrası vazgeçildi)
 *   vw >  vb, açılmış içerik yok/geri → PAKET KAZANIR (sahte ilerletme — içerik hiç açılmadı)
 * İçerik kenara alma: sonuç vb VE WORK'te açılmış içerik var VE (sürümü bilinmiyor ya da < vb)
 * → paketteki içerik daha yeni/eşit sayılır; WORK'teki kopya BASE'i gölgelemesin diye taşınır.
 * (`isaretVar` && acilan == null = açıldı ama menüye hiç işlenmedi: yarım oturum.)
 */
function kapakKarari(vw, vb, acilan, isaretVar, vazgecilen) {
  var b = vb == null ? 0 : vb;
  var w = vw == null ? 0 : vw;
  var sonuc, taraf;
  if (w <= b) { sonuc = b; taraf = 'paket'; }
  else if (acilan != null && acilan > b) { sonuc = Math.min(w, acilan); taraf = 'work'; }
  else if (vazgecilen != null && vazgecilen >= w) { sonuc = w; taraf = 'work-vazgecildi'; }
  else { sonuc = b; taraf = 'paket-sahte-ilerletme'; }
  var icerikVar = !!isaretVar || acilan != null;
  var icerikKenara = sonuc === b && icerikVar && (acilan == null || acilan < b);
  return { surum: sonuc, taraf: taraf, icerikKenara: icerikKenara };
}

/**
 * İki menüyü uzlaştırır (saf; dosya sistemine dokunmaz).
 * @param {(id:string)=>({surum:number|null}|null)} isaretBul  WORK'teki doğrulanmış işaret
 * @param {(id:string)=>number|null} [vazgecBul]  yapısal hatada kabul edilmiş sürüm
 * @param {(id:string)=>boolean} [icerikVarBul]  HAM varlık: işaret dosyası ya da data/BookContent.xml
 *   WORK'te duruyor mu (işaret GEÇERSİZ olsa bile — md5 tutmayan / birleştirme ortasında çöken
 *   içerik de BASE'i gölgeler, kenara alınmalı; review2 Y-A).
 * @returns {{xml:string, degisti:boolean, kararlar:Array, kenarayaAl:string[]}}
 */
function menuUzlastir(workXml, baseXml, isaretBul, vazgecBul, icerikVarBul) {
  var kw = kapaklar(workXml), kb = kapaklar(baseXml);
  var bMap = {}; kb.forEach(function (c) { bMap[c.ID] = c; });
  var wMap = {}; kw.forEach(function (c) { wMap[c.ID] = c; });
  var ayniKume = kw.length === kb.length && kw.every(function (c) { return !!bMap[c.ID]; });
  // Kapak kümesi farklıysa (eski çok kapaklı WORK menüsü) iskelet paketten gelir; <main>
  // etkinleştirme alanları ve eşleşen kapakların version/URL DIŞINDAKİ TÜM alanları WORK'ten
  // taşınır (anahtar/guId/kullanıcı durumu kaybolmasın).
  var xml = ayniKume ? workXml : mainAttrTasi(baseXml, workXml, ['activation', 'key', 'lisans']);
  var kararlar = [], kenarayaAl = [];
  kb.forEach(function (b) {
    var w = wMap[b.ID];
    if (!w) return;
    if (!ayniKume) xml = kapakEtiketiTasi(xml, b.ID, w.etiket);
    var isaret = isaretBul(b.ID);
    var sn = isaret && isaret.surum != null ? Number(isaret.surum) : NaN;
    var acilan = Number.isFinite(sn) ? sn : null;
    var vz = vazgecBul ? vazgecBul(b.ID) : null;
    var hamVar = icerikVarBul ? !!icerikVarBul(b.ID) : false;
    var k = kapakKarari(w.version, b.version, acilan, !!isaret || hamVar, vz);
    var kaynak = k.taraf === 'work' || k.taraf === 'work-vazgecildi' ? w : b;
    xml = kapakAyarla(xml, b.ID, { version: k.surum, URL: kaynak.URL });
    if (k.icerikKenara) kenarayaAl.push(b.ID);
    kararlar.push({ id: b.ID, work: w.version, paket: b.version, acilan: acilan, sonuc: k.surum, taraf: k.taraf });
  });
  return { xml: xml, degisti: xml !== workXml, kararlar: kararlar, kenarayaAl: kenarayaAl, ayniKume: ayniKume };
}

// ─── Ana süreç: uzlaşmayı diske uygula ───────────────────────────────────────

function menuDizinleri(fsMod, pathMod, baseKok) {
  var out = [];
  function bak(rel) {
    try { if (fsMod.existsSync(pathMod.join(baseKok, rel, MENU_GORELI))) out.push(rel); } catch (e) {}
  }
  bak('');
  var girdiler = [];
  try { girdiler = fsMod.readdirSync(baseKok); } catch (e) {}
  girdiler.forEach(function (ad) {
    if (/^(node_modules|assets|core|i18n|classlibraries)$/.test(ad) || ad.charAt(0) === '.') return;
    try { if (fsMod.statSync(pathMod.join(baseKok, ad)).isDirectory()) bak(ad); } catch (e) {}
  });
  return out;
}

/** Benzersiz damga: saniye + ms + pid (aynı saniyede iki süreç çakışmasın). */
function zamanDamgasi(simdi, pid) {
  var d = simdi instanceof Date ? simdi : new Date();
  var s = d.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.(\d{3})Z$/, '-$1');
  return s + '-' + (pid == null ? process.pid : pid);
}

/** Bir dizindeki içerik alt dizinlerini (kullanıcı verisi DOSYALARI hariç) hedefe taşır. */
function icerikTasi(fsMod, pathMod, kaynak, hedef, adlar) {
  var tasinan = [];
  adlar.forEach(function (ad) {
    if (!ad || ad.charAt(0) === '.' || ad === GECICI_DIZIN) return;
    var k = pathMod.join(kaynak, ad);
    var st; try { st = fsMod.statSync(k); } catch (e) { return; }
    if (!st.isDirectory()) return; // kök dosyalar (ör. flexibleItems.json) kullanıcı verisi olabilir
    fsMod.mkdirSync(hedef, { recursive: true });
    fsMod.renameSync(k, pathMod.join(hedef, ad));
    tasinan.push(ad);
  });
  return tasinan;
}

/**
 * Tek-örnek kilidi (O_EXCL). Canlı sahip varsa null döner (uzlaşma atlanır); sahibi ölmüş ya da
 * 10 dakikadan eski kilit bayat sayılır ve devralınır.
 */
function kilitAl(fsMod, pathMod, workKok, simdiMs) {
  var yol = pathMod.join(workKok, KILIT_ADI);
  fsMod.mkdirSync(workKok, { recursive: true });
  for (var deneme = 0; deneme < 2; deneme++) {
    try {
      var fd = fsMod.openSync(yol, 'wx');
      fsMod.writeSync(fd, JSON.stringify({ pid: process.pid, zaman: simdiMs || Date.now() }));
      fsMod.closeSync(fd);
      return { yol: yol, birak: function () { try { fsMod.unlinkSync(yol); } catch (e) {} } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      var j = null; try { j = JSON.parse(fsMod.readFileSync(yol, 'utf8')); } catch (er) {}
      var canli = false;
      if (j && j.pid && j.pid !== process.pid) { try { process.kill(j.pid, 0); canli = true; } catch (er) { canli = er.code === 'EPERM'; } }
      var eski = !j || !j.zaman || (Date.now() - j.zaman) > 10 * 60 * 1000;
      if (canli && !eski) return null;
      try { fsMod.renameSync(yol, yol + '.bayat-' + zamanDamgasi()); } catch (er) {}
    }
  }
  return null;
}

/**
 * Tüm kitap dizinlerinde WORK menüsünü paket menüsüyle uzlaştırır.
 * Silmez: eski menü ve geçersiz içerik `WORK/.empp-eski/<damga>/...` altına taşınır.
 */
function uzlastir(o) {
  var fsMod = o.fs || require('fs');
  var pathMod = o.path || require('path');
  var crypto = o.crypto || require('crypto');
  var log = o.log || function () {};
  var rastgele = o.rastgele;
  var damga = zamanDamgasi(o.simdi, o.pid);
  var rapor = [];
  var kilit = kilitAl(fsMod, pathMod, o.workKok);
  if (!kilit) { log('[empp-icerik] uzlaşma atlandı: başka bir örnek kilitli'); return [{ sebep: 'kilitli' }]; }
  try {
    menuDizinleri(fsMod, pathMod, o.baseKok).forEach(function (rel) {
      try {
        var wMenu = pathMod.join(o.workKok, rel, MENU_GORELI);
        if (!fsMod.existsSync(wMenu)) return;
        var wXml = menuCoz(fsMod.readFileSync(wMenu));
        var bXml = menuCoz(fsMod.readFileSync(pathMod.join(o.baseKok, rel, MENU_GORELI)));
        if (!wXml || !bXml) {
          rapor.push({ kitap: rel || '.', sebep: 'cozulemedi' });
          log('[empp-icerik] UYARI uzlaşma: menü çözülemedi ' + (rel || '.') + ' (dokunulmadı)');
          return;
        }
        var assetsW = function (id) { return pathMod.join(o.workKok, rel, 'assets', String(id)); };
        var sonuc = menuUzlastir(wXml, bXml,
          function (id) { return isaretOku(fsMod, pathMod, crypto, assetsW(id)); },
          function (id) { var b = basarisizOku(fsMod, pathMod, assetsW(id)); return b && b.vazgecilenSurum != null ? Number(b.vazgecilenSurum) : null; },
          function (id) {
            var a = assetsW(id);
            return fsMod.existsSync(pathMod.join(a, ISARET_ADI)) || fsMod.existsSync(pathMod.join(a, 'data', 'BookContent.xml'));
          });
        var eskiKok = pathMod.join(o.workKok, ESKI_DIZIN, damga, rel);
        if (sonuc.degisti) {
          fsMod.mkdirSync(pathMod.join(eskiKok, 'classlibraries'), { recursive: true });
          fsMod.copyFileSync(wMenu, pathMod.join(eskiKok, MENU_GORELI));
          fsMod.writeFileSync(wMenu, menuKodla(sonuc.xml, rastgele));
        }
        sonuc.kenarayaAl.forEach(function (id) {
          var kaynak = assetsW(id);
          var hedef = pathMod.join(eskiKok, 'assets', String(id));
          // Geçersiz işaretin de dizin listesi kullanılır (md5 tutmasa da hangi dizinlerin açıldığını bilir).
          var j = {}; try { j = JSON.parse(fsMod.readFileSync(pathMod.join(kaynak, ISARET_ADI), 'utf8')) || {}; } catch (e) {}
          var adlar = Array.isArray(j.dizinler) && j.dizinler.length ? j.dizinler : ['data', 'htmletk', 'pages', 'thumbs'];
          icerikTasi(fsMod, pathMod, kaynak, hedef, adlar);
          if (fsMod.existsSync(pathMod.join(kaynak, ISARET_ADI))) {
            fsMod.mkdirSync(hedef, { recursive: true });
            fsMod.renameSync(pathMod.join(kaynak, ISARET_ADI), pathMod.join(hedef, ISARET_ADI));
          }
        });
        rapor.push({ kitap: rel || '.', degisti: sonuc.degisti, kararlar: sonuc.kararlar, kenarayaAl: sonuc.kenarayaAl });
        if (sonuc.degisti || sonuc.kenarayaAl.length) {
          log('[empp-icerik] uzlaşma ' + (rel || '.') + ': ' + JSON.stringify(sonuc.kararlar)
            + (sonuc.kenarayaAl.length ? ' kenara: ' + sonuc.kenarayaAl.join(',') : ''));
        }
      } catch (e) {
        rapor.push({ kitap: rel || '.', hata: e && e.message });
        log('[empp-icerik] uzlaşma hatası ' + (rel || '.') + ': ' + (e && e.message));
      }
    });
  } finally { kilit.birak(); }
  return rapor;
}

// ─── Ana süreç: file: protokol örtüsü ────────────────────────────────────────

/**
 * İstenen dosya yolu için WORK'te bir kopya varsa onun yolunu döner, yoksa null.
 * Kapsam bilerek dar: yalnız `assets/` alt ağacı (kitap içeriği); geçici açma dizini asla.
 * Eşleme fs-shim `rel()` ile aynıdır: WORK_KOK/<BASE_KOK'a göreli yol>.
 */
function dosyaEsle(fsMod, pathMod, baseKok, workKok, istenen) {
  try {
    if (typeof istenen !== 'string' || !istenen) return null;
    var r = pathMod.relative(baseKok, istenen);
    if (!r || r.indexOf('..') === 0 || pathMod.isAbsolute(r)) return null;
    var parca = r.split(pathMod.sep);
    if (parca.indexOf('assets') === -1 || parca.indexOf(GECICI_DIZIN) !== -1) return null;
    var w = pathMod.join(workKok, r);
    return fsMod.existsSync(w) && fsMod.statSync(w).isFile() ? w : null;
  } catch (e) { return null; }
}

function dosyaUrlYolu(urlMod, adres) {
  try { return urlMod.fileURLToPath(String(adres).split('#')[0].split('?')[0]); } catch (e) { return null; }
}

function protokolKur(o) {
  var protocol = o.protocol, net = o.net;
  var fsMod = o.fs || require('fs'), pathMod = o.path || require('path'), urlMod = o.url || require('url');
  var log = o.log || function () {};
  var yontem = o.yontem || (typeof protocol.interceptFileProtocol === 'function' ? 'intercept' : 'handle');
  var sayac = { work: 0 };
  // PAYLAŞILAN ÖRTÜ ZİNCİRİ (2026-09-26, G kanalı mac + Pardus): Electron'da `file` şemasına
  // TEK kayıt yapılabilir. Pakette G örtüsü etkinse (`empp-set-guncelleyici.js` →
  // `global.__emppDosyaOrtusu`) K çözücüsü zincire ÖNCE (öncelik 10) eklenir, kaydı zincir
  // yapar; K'nin eşlemesi birebir aynıdır. Zincir YOKSA (Windows, G'siz paket, örtüsüz açılış)
  // aşağıdaki eski doğrudan kayıt HİÇ DEĞİŞMEDEN koşar.
  var kapsam = o.kapsam || (typeof global !== 'undefined' ? global : null);
  var zincir = kapsam && kapsam.__emppDosyaOrtusu;
  if (zincir && typeof zincir.ekle === 'function' && typeof zincir.kur === 'function') {
    zincir.ekle('icerik', 10, function (p) {
      var w = dosyaEsle(fsMod, pathMod, o.baseKok, o.workKok, p);
      if (w) { sayac.work += 1; if (sayac.work <= 20) log('[empp-icerik] örtü: ' + pathMod.relative(o.workKok, w)); }
      return w ? { yol: w } : null;
    });
    var zr = zincir.kur({ protocol: protocol, net: net, yontem: o.yontem, log: log });
    return { yontem: 'zincir-' + zr.yontem, sayac: sayac };
  }
  function esle(adres) {
    var p = dosyaUrlYolu(urlMod, adres);
    var w = p ? dosyaEsle(fsMod, pathMod, o.baseKok, o.workKok, p) : null;
    if (w) { sayac.work += 1; if (sayac.work <= 20) log('[empp-icerik] örtü: ' + pathMod.relative(o.workKok, w)); }
    return { yol: p, work: w };
  }
  if (yontem === 'intercept' && typeof protocol.interceptFileProtocol === 'function') {
    protocol.interceptFileProtocol('file', function (istek, cb) {
      var e = esle(istek.url);
      cb({ path: e.work || e.yol || '' });
    });
    return { yontem: 'intercept', sayac: sayac };
  }
  if (typeof protocol.handle === 'function' && net && typeof net.fetch === 'function') {
    protocol.handle('file', function (istek) {
      var e = esle(istek.url);
      var hedef = e.work ? urlMod.pathToFileURL(e.work).toString() : istek.url;
      return net.fetch(hedef, { method: istek.method, headers: istek.headers, bypassCustomProtocolHandlers: true });
    });
    return { yontem: 'handle', sayac: sayac };
  }
  return { yontem: 'yok', sayac: sayac };
}

function logYazici(fsMod, pathMod, workKok) {
  return function (satir) {
    try { console.log(satir); } catch (e) {}
    try {
      fsMod.mkdirSync(workKok, { recursive: true });
      fsMod.appendFileSync(pathMod.join(workKok, LOG_ADI), new Date().toISOString() + ' ' + satir + '\n');
    } catch (e) {}
  };
}

/** Ana süreç giriş noktası — enjekte edilen blok bunu çağırır. */
function anaSurecKur(o) {
  var electron = o.electron, app = electron && electron.app;
  var env = o.env || process.env;
  if (!app) return { durum: 'app-yok' };
  // Windows KAPSAMDA (2026-09-26, Windows paketleme sözleşmesi G1): K içeriği userData/work'e
  // açılır, kurulum dizinine yazılmaz; eskiden burada win32 için erken "kapsam dışı" dönüşü vardı.
  if (env.EMPP_ICERIK_GUNCELLEME === '0') return { durum: 'kapali' };
  var fsMod = require('fs'), pathMod = require('path');
  var workKok = env.EMPP_WORK_DIR || pathMod.join(app.getPath('userData'), 'work');
  // WORK tek kaynak: renderer ortamı ana süreçten miras aldığı için fs-shim aynı dizini görür
  // (paketleyicinin kendi enjeksiyonu düşse bile ~/.empp-work'e ayrışmasın).
  if (!env.EMPP_WORK_DIR) env.EMPP_WORK_DIR = workKok;
  var baseKok = o.kok;
  var log = logYazici(fsMod, pathMod, workKok);
  var rapor = [];
  try { rapor = uzlastir({ baseKok: baseKok, workKok: workKok, log: log }); } catch (e) { log('[empp-icerik] uzlaşma atlandı: ' + (e && e.message)); }
  var kur = function () {
    try {
      var r = protokolKur({ protocol: electron.protocol, net: electron.net, baseKok: baseKok, workKok: workKok, log: log, yontem: env.EMPP_ICERIK_PROTOKOL });
      log('[empp-icerik] file: örtüsü kuruldu (' + r.yontem + ')');
    } catch (e) { log('[empp-icerik] file: örtüsü kurulamadı: ' + (e && e.message)); }
  };
  // `ready` OLAYI whenReady() then'lerinden ÖNCE ateşlenir; `prepend` ile yayıncının kendi
  // `app.on('ready', createWindow)` dinleyicisinden de önce koşar → örtü loadURL'den önce kayıtlı.
  if (typeof app.isReady === 'function' && app.isReady()) kur();
  else if (typeof app.prependOnceListener === 'function') app.prependOnceListener('ready', kur);
  else app.once('ready', kur);
  return { durum: 'kuruldu', uzlasma: rapor, workKok: workKok };
}

// ─── Renderer: adm-zip hedefi + geçici açma + doğrulama + menü süzgeci ──────

function yapisalHata(mesaj) { var e = new Error(mesaj); e.yapisal = true; return e; }

/** Girdi adının diskteki (adm-zip'in sanitize ettiği) göreli karşılığı; dışarı taşan → null. */
function girdiGoreli(pathMod, ad) {
  var n = pathMod.posix.normalize('/' + String(ad).replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!n || n === '.' || n.indexOf('../') === 0) return null;
  return n.replace(/\/+$/, '');
}

/**
 * @param ctx {{ R, realFs, pathMod, crypto, WORK, log, dogrulanan:Object, tavanMb? }}
 * R = fs-shim çözümleyicisi (rel/toRead/toWork).
 */
function admZipSar(Gercek, ctx) {
  function Sarili(zipYolu, secenek) {
    var okunan = typeof zipYolu === 'string' ? ctx.R.toRead(zipYolu) : zipYolu;
    var z = secenek === undefined ? new Gercek(okunan) : new Gercek(okunan, secenek);
    var asil = z.extractAllTo;
    z.extractAllTo = function (hedef, uzerineYaz, izinKoru, cikti) {
      var r = typeof hedef === 'string' ? ctx.R.rel(hedef) : null;
      // Yalnız kitap içerik zip'i (hedef = assets/<id>) güvenli açma + doğrulamadan geçer. Motorun
      // aynı extractZipFiles'ı başka zip'ler için de çağırabilir (review2 Y-D): onları doğrulamasız
      // açmak BASE'i gölgeleyebilir, kitap zip'i gibi doğrulamak sahte "başarısız" yazar → RET, sesli log.
      if (r == null || !/(^|[\/\\])assets[\/\\][^\/\\]+$/.test(r)) {
        ctx.log('[empp-icerik] RET: kitap içerik zip\'i değil, açılmadı (hedef: ' + (r == null ? hedef : r) + ')');
        throw new Error('[empp-icerik] kitap dışı zip açılmadı: ' + (r == null ? hedef : r));
      }
      return guvenliAc(z, asil, ctx.pathMod.join(ctx.WORK, r), [uzerineYaz, izinKoru, cikti], ctx);
    };
    return z;
  }
  Sarili.__empp = true;
  Object.keys(Gercek).forEach(function (k) { try { Sarili[k] = Gercek[k]; } catch (e) {} });
  return Sarili;
}

/**
 * GEÇİCİ DİZİNE AÇ → DOĞRULA → HEDEFE TAŞI. Yarım/doğrulanamamış açma asla hedefte kalmaz
 * (hedef = WORK/assets/<id>, BASE'in önünde servis edilen yer). Başarısızlıkta geçici dizin
 * `WORK/.empp-eski/`ye taşınır (silme yok) ve hata fırlatılır (motor yutar; menü süzgeci
 * sürümü ilerletmez).
 */
function guvenliAc(z, asil, hedef, argumanlar, ctx) {
  var fsMod = ctx.realFs, pathMod = ctx.pathMod;
  var id = pathMod.basename(hedef);
  var gecici = pathMod.join(ctx.WORK, GECICI_DIZIN, id + '-' + zamanDamgasi());
  try {
    onKontrol(z, ctx);
    fsMod.mkdirSync(gecici, { recursive: true });
    asil.call(z, gecici, argumanlar[0], argumanlar[1], argumanlar[2]);
    var isaret = acmaDogrula(z, gecici, ctx);
    birlestir(fsMod, pathMod, gecici, hedef, ctx);
    isaret.id = id;
    isaret.zaman = new Date().toISOString();
    fsMod.writeFileSync(pathMod.join(hedef, ISARET_ADI), JSON.stringify(isaret));
    try { fsMod.renameSync(pathMod.join(hedef, BASARISIZ_ADI), pathMod.join(gecici, BASARISIZ_ADI)); } catch (e) {}
    ctx.dogrulanan[id] = { hedef: hedef, isaret: isaret };
    ctx.log('[empp-icerik] açıldı + doğrulandı: ' + id + ' (' + isaret.girdi + ' girdi, BookContent ' + isaret.bookContentMd5 + ')');
    geciciKaldir(fsMod, pathMod, gecici, ctx);
    return undefined;
  } catch (e) {
    // Oturumdaki önceki başarılı açma bu başarısızlığın sürümünü AKLAMAZ (Y14 testiyle bulundu).
    delete ctx.dogrulanan[id];
    ctx.log('[empp-icerik] AÇMA BAŞARISIZ ' + id + ': ' + (e && e.message));
    basarisizYaz(fsMod, pathMod, hedef, e, ctx);
    geciciKaldir(fsMod, pathMod, gecici, ctx);
    throw e;
  }
}

/** Geçici dizin boşsa kaldırılır (rmdir), doluysa .empp-eski'ye taşınır — dosya silinmez. */
function geciciKaldir(fsMod, pathMod, gecici, ctx) {
  try {
    if (!fsMod.existsSync(gecici)) return;
    var kalan = fsMod.readdirSync(gecici);
    if (!kalan.length) { fsMod.rmdirSync(gecici); return; }
    var eski = pathMod.join(ctx.WORK, ESKI_DIZIN, 'gecici-' + pathMod.basename(gecici));
    fsMod.mkdirSync(pathMod.dirname(eski), { recursive: true });
    fsMod.renameSync(gecici, eski);
    eskiBaskisiniBudar(fsMod, pathMod, ctx, pathMod.basename(gecici).replace(/-\d{8}-\d{6}-\d{3}-\d+$/, ''));
  } catch (e) { ctx.log('[empp-icerik] UYARI geçici dizin toparlanamadı: ' + gecici + ' — ' + (e && e.message)); }
}

/**
 * SAKLAMA (Şef kararı, review2 Y-B): başarısız açmaların kenarları (`gecici-<id>-*`, `yarim-<id>-*`)
 * kitap başına en fazla ESKI_BASARISIZ_TAVAN tutulur, daha eskisi SİLİNİR. Bunlar hiç sunulmamış,
 * yeniden indirilebilir geçici çıktımızdır — kullanıcı verisi değil. Doğrulanmış içeriğin
 * kenarları (uzlaşmanın `.empp-eski/<damga>/…` dizinleri) bu ada uymaz, ASLA silinmez.
 */
function eskiBaskisiniBudar(fsMod, pathMod, ctx, id) {
  try {
    var kok = pathMod.join(ctx.WORK, ESKI_DIZIN);
    var onekler = ['gecici-' + id + '-', 'yarim-' + id + '-'];
    var adaylar = fsMod.readdirSync(kok).filter(function (ad) {
      return onekler.some(function (o) { return ad.indexOf(o) === 0 && /^\d{8}-\d{6}-\d{3}-\d+$/.test(ad.slice(o.length)); });
    }).sort(function (a, b) { return a.replace(/^[a-z]+-[^-]+-/, '') < b.replace(/^[a-z]+-[^-]+-/, '') ? -1 : 1; });
    adaylar.slice(0, Math.max(0, adaylar.length - ESKI_BASARISIZ_TAVAN)).forEach(function (ad) {
      fsMod.rmSync(pathMod.join(kok, ad), { recursive: true, force: true });
      ctx.log('[empp-icerik] saklama: eski başarısız kenar silindi ' + ad);
    });
  } catch (e) { ctx.log('[empp-icerik] UYARI saklama budaması başarısız: ' + (e && e.message)); }
}

/** Açmadan önce: boyut tavanı (adm-zip tümünü belleğe alır; bomba/disk koruması). */
function onKontrol(z, ctx) {
  var tavan = (ctx.tavanMb || VARSAYILAN_TAVAN_MB) * 1024 * 1024;
  var toplam = 0;
  z.getEntries().forEach(function (g) { toplam += (g.header && g.header.size) || 0; });
  if (toplam > tavan) throw yapisalHata('[empp-icerik] zip açılmış boyutu tavanı aşıyor: ' + toplam + ' > ' + tavan);
}

/** Açma doğrulaması: BookContent.xml kökte + md5 zip'tekiyle eş + her girdi (sanitize adıyla) diskte. */
function acmaDogrula(z, dizin, ctx) {
  var fsMod = ctx.realFs, pathMod = ctx.pathMod;
  var bc = z.getEntry('data/BookContent.xml');
  if (!bc) throw yapisalHata('[empp-icerik] zip kökünde data/BookContent.xml yok (beklenmeyen düzen)');
  var zipMd5 = md5(fsMod, ctx.crypto, bc.getData());
  var diskYol = pathMod.join(dizin, 'data', 'BookContent.xml');
  if (!fsMod.existsSync(diskYol) || md5(fsMod, ctx.crypto, diskYol) !== zipMd5) {
    throw new Error('[empp-icerik] açma doğrulanamadı (BookContent md5)');
  }
  var eksik = [], dizinler = {}, girdiler = z.getEntries();
  girdiler.forEach(function (g) {
    var rel = girdiGoreli(pathMod, g.entryName);
    if (!rel) return;
    if (rel.indexOf('/') !== -1 || g.isDirectory) dizinler[rel.split('/')[0]] = 1;
    if (!g.isDirectory && !fsMod.existsSync(pathMod.join(dizin, rel))) eksik.push(rel);
  });
  if (eksik.length) throw new Error('[empp-icerik] açma eksik (' + eksik.length + ', ilk: ' + eksik[0] + ')');
  return { id: pathMod.basename(dizin).replace(/-\d{8}-\d{6}-\d{3}-\d+$/, ''), bookContentMd5: zipMd5, girdi: girdiler.length, dizinler: Object.keys(dizinler), surum: null };
}

/** Geçici dizindeki her dosyayı hedefe taşır (üzerine yazar — motorun overwrite=true anlamı). */
function birlestir(fsMod, pathMod, kaynak, hedef, ctx) {
  var tasinan = [];
  function yuru(rel) {
    fsMod.readdirSync(pathMod.join(kaynak, rel)).forEach(function (ad) {
      var r = rel ? pathMod.join(rel, ad) : ad;
      var k = pathMod.join(kaynak, r), h = pathMod.join(hedef, r);
      if (fsMod.statSync(k).isDirectory()) {
        var hs = null; try { hs = fsMod.statSync(h); } catch (e) {}
        if (!hs) { fsMod.mkdirSync(pathMod.dirname(h), { recursive: true }); fsMod.renameSync(k, h); tasinan.push(r); return; }
        yuru(r);
      } else {
        fsMod.mkdirSync(pathMod.dirname(h), { recursive: true });
        fsMod.renameSync(k, h);
        tasinan.push(r);
      }
    });
  }
  try { yuru(''); } catch (e) {
    // Yarım birleştirme BASE'i gölgelemesin: taşınan içerik dizinleri hemen kenara.
    ctx.log('[empp-icerik] BİRLEŞTİRME YARIM KALDI: ' + (e && e.message) + ' — taşınanlar kenara alınıyor');
    try {
      var ust = {}; tasinan.forEach(function (r) { ust[r.split(pathMod.sep)[0]] = 1; });
      icerikTasi(fsMod, pathMod, hedef, pathMod.join(ctx.WORK, ESKI_DIZIN, 'yarim-' + pathMod.basename(hedef) + '-' + zamanDamgasi()), Object.keys(ust));
      eskiBaskisiniBudar(fsMod, pathMod, ctx, pathMod.basename(hedef));
    } catch (er) { ctx.log('[empp-icerik] UYARI kenara alma başarısız: ' + (er && er.message)); }
    throw e;
  }
}

function basarisizYaz(fsMod, pathMod, hedef, hata, ctx) {
  try {
    fsMod.mkdirSync(hedef, { recursive: true });
    var onceki = basarisizOku(fsMod, pathMod, hedef) || {};
    var yapisal = !!(hata && hata.yapisal);
    var ayniSebep = onceki.sebep === (hata && hata.message);
    var j = {
      sebep: hata && hata.message, yapisal: yapisal,
      sayi: yapisal && ayniSebep ? (onceki.sayi || 0) + 1 : 1,
      zaman: new Date().toISOString(), vazgecilenSurum: onceki.vazgecilenSurum == null ? null : onceki.vazgecilenSurum,
    };
    fsMod.writeFileSync(pathMod.join(hedef, BASARISIZ_ADI), JSON.stringify(j));
  } catch (e) { ctx.log('[empp-icerik] UYARI başarısızlık kaydı yazılamadı: ' + (e && e.message)); }
}

/**
 * Menü yazma süzgeci: yeni içerikte sürümü ARTAN her kapak için açma bu oturumda
 * doğrulanmadıysa version/URL eski değerine geri çevrilir. İstisna: aynı YAPISAL hata
 * (düzen/tavan) YAPISAL_DENEME kez görüldüyse vazgeçilir, ilerlemeye izin verilir (sonsuz
 * indirme olmasın) ve bu yüksek sesle loglanır.
 * @returns {string|Buffer} yazılacak veri (değişiklik yoksa girdi aynen)
 */
function menuSuz(yeniVeri, eskiVeri, ctx) {
  var yeniXml = menuCoz(yeniVeri);
  if (!yeniXml) { ctx.log('[empp-icerik] UYARI menü süzgeci: yeni menü çözülemedi, süzülmeden yazılıyor'); return yeniVeri; }
  if (eskiVeri == null) return yeniVeri; // ilk yazım: kıyas yok
  var eskiXml = menuCoz(eskiVeri);
  if (!eskiXml) { ctx.log('[empp-icerik] UYARI menü süzgeci: mevcut menü çözülemedi, süzülmeden yazılıyor'); return yeniVeri; }
  var eski = {}; kapaklar(eskiXml).forEach(function (c) { eski[c.ID] = c; });
  var xml = yeniXml, degisti = false;
  kapaklar(yeniXml).forEach(function (c) {
    var e = eski[c.ID];
    if (!e || c.version == null || e.version == null || c.version <= e.version) return;
    var d = ctx.dogrulanan[c.ID];
    if (d) {
      try {
        d.isaret.surum = c.version;
        ctx.realFs.writeFileSync(ctx.pathMod.join(d.hedef, ISARET_ADI), JSON.stringify(d.isaret));
      } catch (er) { ctx.log('[empp-icerik] UYARI işarete sürüm yazılamadı: ' + (er && er.message)); }
      ctx.log('[empp-icerik] menü sürümü ilerledi (açma doğrulandı): ' + c.ID + ' v' + e.version + '→v' + c.version);
      delete ctx.dogrulanan[c.ID]; // tek kullanımlık: bir açma yalnız bir ilerlemeyi aklar
      return;
    }
    var b = ctx.basarisizBul ? ctx.basarisizBul(c.ID) : null;
    if (b && b.kayit && b.kayit.yapisal && b.kayit.sayi >= YAPISAL_DENEME) {
      try {
        b.kayit.vazgecilenSurum = c.version;
        ctx.realFs.writeFileSync(ctx.pathMod.join(b.dizin, BASARISIZ_ADI), JSON.stringify(b.kayit));
      } catch (er) {}
      ctx.log('[empp-icerik] VAZGEÇİLDİ: ' + c.ID + ' v' + e.version + '→v' + c.version + ' içerik AÇILMADI (yapısal hata '
        + b.kayit.sayi + ' kez: ' + b.kayit.sebep + ') — sonsuz indirme olmasın diye sürüm ilerletildi');
      return;
    }
    xml = kapakAyarla(xml, c.ID, { version: e.version, URL: e.URL });
    degisti = true;
    ctx.log('[empp-icerik] SAHTE İLERLETME ENGELLENDİ: ' + c.ID + ' v' + e.version + '→v' + c.version + ' (içerik açılmadı)');
  });
  if (!degisti) return yeniVeri;
  var kodlu = menuKodla(xml, ctx.rastgele);
  return Buffer.isBuffer(yeniVeri) ? Buffer.from(kodlu, 'utf8') : kodlu;
}

function menuYoluMu(R, p) {
  var r = R.rel(p);
  if (r == null && typeof p === 'string') r = p;
  return typeof r === 'string' && /(^|[\/\\])classlibraries[\/\\]ImWin32\.dll$/.test(r);
}

/**
 * fs sarmalayıcı: menüye giden yazma yolları süzülür. writeFile* → veri süzülür;
 * rename/copyFile → kaynak içeriği okunup süzülmüş hâli yazılır; createWriteStream/open(yazma)
 * süzülemez → yüksek sesle loglanır (motor bugün bunları menü için kullanmıyor — ölçüldü).
 */
function korumaliFs(fsNesnesi, ctx) {
  var k = {};
  Object.keys(fsNesnesi).forEach(function (a) { k[a] = fsNesnesi[a]; });
  function eskiOku(p) {
    try { return ctx.realFs.readFileSync(ctx.R.toRead(p)); } catch (e) { return null; }
  }
  function suz(p, veri) {
    try { return menuSuz(veri, eskiOku(p), ctx); } catch (e) {
      ctx.log('[empp-icerik] UYARI menü süzgeci hata verdi, süzülmeden yazılıyor: ' + (e && e.message));
      return veri;
    }
  }
  function yazmaSar(ad, hedefIndeks, kaynakOkunur) {
    if (typeof fsNesnesi[ad] !== 'function') return;
    k[ad] = function () {
      var a = Array.prototype.slice.call(arguments);
      if (menuYoluMu(ctx.R, a[hedefIndeks])) {
        if (!kaynakOkunur) a[1] = suz(a[0], a[1]);
        else {
          var kaynakVeri = null;
          try { kaynakVeri = ctx.realFs.readFileSync(ctx.R.toRead(a[0])); } catch (e) {}
          if (kaynakVeri != null) {
            var suzulmus = suz(a[1], kaynakVeri);
            if (suzulmus !== kaynakVeri) {
              ctx.log('[empp-icerik] ' + ad + ' → menü: süzülmüş içerik yazılıyor');
              // Kopya/taşıma yerine süzülmüş veriyi hedefe doğrudan yaz (kaynak aynen kalır).
              var sync = /Sync$/.test(ad);
              if (sync) { fsNesnesi.writeFileSync(a[1], suzulmus); return undefined; }
              var cb = a[a.length - 1];
              return fsNesnesi.writeFile(a[1], suzulmus, typeof cb === 'function' ? cb : function () {});
            }
          }
        }
      }
      return fsNesnesi[ad].apply(fsNesnesi, a);
    };
  }
  yazmaSar('writeFile', 0, false);
  yazmaSar('writeFileSync', 0, false);
  yazmaSar('rename', 1, true);
  yazmaSar('renameSync', 1, true);
  yazmaSar('copyFile', 1, true);
  yazmaSar('copyFileSync', 1, true);
  ['createWriteStream', 'open', 'openSync', 'appendFile', 'appendFileSync'].forEach(function (ad) {
    if (typeof fsNesnesi[ad] !== 'function') return;
    k[ad] = function (p, bayrak) {
      var yazma = ad === 'createWriteStream' || /^append/.test(ad) || /[wa+]/.test(String(bayrak || ''));
      if (yazma && menuYoluMu(ctx.R, p)) ctx.log('[empp-icerik] UYARI menüye süzülemeyen yol ile yazılıyor: ' + ad);
      return fsNesnesi[ad].apply(fsNesnesi, arguments);
    };
  });
  if (fsNesnesi.promises && typeof fsNesnesi.promises.writeFile === 'function') {
    var P = fsNesnesi.promises, kp = {};
    Object.keys(P).forEach(function (a) { kp[a] = P[a]; });
    kp.writeFile = function (p, veri) {
      var a = Array.prototype.slice.call(arguments);
      if (menuYoluMu(ctx.R, p)) a[1] = suz(p, veri);
      return P.writeFile.apply(P, a);
    };
    k.promises = kp;
  }
  k.__emppIcerik = true;
  return k;
}

/**
 * Renderer giriş noktası (fs-shim `install()` sonunda çağırır; 2026-09-26'dan beri Windows dahil).
 * @param win window
 * @param o {{ R, realFs, pathMod, WORK, realRequire?, fsNesnesi?, tavanMb? }}
 */
function rendererKur(win, o) {
  if (!win || typeof win.require !== 'function') return null;
  if (win.__emppIcerik) return win.__emppIcerik;
  var onceki = win.require;
  var realRequire = o.realRequire || onceki;
  var crypto = realRequire('crypto');
  var logDizin = o.logDizin || o.WORK;
  var ctx = {
    R: o.R, realFs: o.realFs, pathMod: o.pathMod, crypto: crypto, WORK: o.WORK,
    dogrulanan: {}, rastgele: o.rastgele, tavanMb: o.tavanMb,
    log: logYazici(o.realFs, o.pathMod, logDizin),
  };
  ctx.basarisizBul = function (id) {
    var dizin = o.pathMod.join(o.WORK, 'assets', String(id));
    var kayit = basarisizOku(o.realFs, o.pathMod, dizin);
    return kayit ? { dizin: dizin, kayit: kayit } : null;
  };
  var fsNesnesi = korumaliFs(o.fsNesnesi || onceki('fs'), ctx);
  var zipSinifi = null;
  // Satıcı dizini VARSA oradan (paketin kendi adm-zip'i), yoksa motorun kendi çözümü (eski paketler).
  var admZipYolu = o.admZipYolu !== undefined ? o.admZipYolu
    : (typeof __dirname === 'string' ? o.pathMod.join(__dirname, VENDOR_ADM_ZIP) : null);
  function gercekZip(self, args) {
    if (admZipYolu) {
      var varMi = false;
      try { varMi = o.realFs.existsSync(o.pathMod.join(admZipYolu, 'adm-zip.js')); } catch (e) { varMi = false; }
      if (varMi) return realRequire(admZipYolu);
    }
    return onceki.apply(self, args); // yoksa GERÇEK hata fırlar
  }
  win.require = function (ad) {
    if (ad === 'fs') return fsNesnesi;
    if (ad === 'adm-zip') {
      if (!zipSinifi) zipSinifi = admZipSar(gercekZip(this, arguments), ctx);
      return zipSinifi;
    }
    return onceki.apply(this, arguments);
  };
  Object.keys(onceki).forEach(function (k) { try { win.require[k] = onceki[k]; } catch (e) {} });
  win.__emppIcerik = ctx;
  return ctx;
}

module.exports = {
  MENU_GORELI: MENU_GORELI, ISARET_ADI: ISARET_ADI, ESKI_DIZIN: ESKI_DIZIN, LOG_ADI: LOG_ADI,
  BASARISIZ_ADI: BASARISIZ_ADI, ESKI_BASARISIZ_TAVAN: ESKI_BASARISIZ_TAVAN, VENDOR_ADM_ZIP: VENDOR_ADM_ZIP, GECICI_DIZIN: GECICI_DIZIN, KILIT_ADI: KILIT_ADI, YAPISAL_DENEME: YAPISAL_DENEME,
  menuCoz: menuCoz, menuKodla: menuKodla, kapaklar: kapaklar, kapakAyarla: kapakAyarla,
  kapakKarari: kapakKarari, menuUzlastir: menuUzlastir, uzlastir: uzlastir, menuDizinleri: menuDizinleri,
  kilitAl: kilitAl, zamanDamgasi: zamanDamgasi, girdiGoreli: girdiGoreli,
  dosyaEsle: dosyaEsle, protokolKur: protokolKur, anaSurecKur: anaSurecKur,
  admZipSar: admZipSar, acmaDogrula: acmaDogrula, menuSuz: menuSuz, korumaliFs: korumaliFs,
  rendererKur: rendererKur, isaretOku: isaretOku,
};
