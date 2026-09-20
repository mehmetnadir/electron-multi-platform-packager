'use strict';

/**
 * SAYFA ÖN-GETİRME YAMASI — kitap açıldıktan sonra tüm sayfaları SIRAYLA ısıtır.
 *
 * NADİR TALEBİ (2026-09-20): "kitabı açtıktan sonra sıralı şekilde tüm sayfaları
 * ön getirme yapmalıyız… ön getirme kitabın sonraki sayfalarına istek göndermiş
 * gibi davransa yetecek."
 *
 * NEDEN (ölçüldü, 2026-09-20):
 *   • Sayfa dosyaları diskte gizli: `c = (256 − p) & 0xFF`, YALNIZ ilk 100 bayt
 *     (`impark_crypto.py`, DEFAULT_N=100). Çözme maliyeti 264 KB'lık sayfada
 *     0,0655 ms — yani sayfa geçişindeki beklemenin şifre çözmeden gelen payı
 *     ölçülebilir değil.
 *   • Bekleten şey: dosyayı ilk kez diskten okumak + 1872×2340 (4,38 megapiksel)
 *     görseli çözmek. Motorda komşu sayfayı hazırlayan HİÇBİR kod yok —
 *     oka basıldığı anda zincir sıfırdan başlıyor.
 *
 * YAKLAŞIM: sayfa listesi PAKETLEME ANINDA biliniyor (dosyaları biz sayıyoruz),
 * bu yüzden çalışma anında tahmin/gözlem gerekmiyor — liste betiğe gömülür.
 * Isıtma `fs.readFile` ile yapılır (pakette `nodeIntegration: true`); yoksa
 * `fetch` yedeği kullanılır. Baytlar okunup ATILIR: amaç işletim sisteminin
 * dosya önbelleğini doldurmak, JS belleğinde sayfa biriktirmek değil
 * (400 sayfa × 250 KB = 100 MB — tutulamaz).
 *
 * GÜVENLİK AĞI: her şey try/catch içinde ve ateşle-unut. Yama hiçbir koşulda
 * motorun kendi akışına karışmaz; `window.fetch` SARMALANMAZ — motor kendi
 * sarmalayıcısını sonradan kuruyor ve bizimkini ezerdi (2026-09-20 ölçümü).
 */

const path = require('path');
const fs = require('fs-extra');

const ISARET = 'EMPP_ON_GETIRME';
const VARSAYILAN_ARA_MS = 120;
const VARSAYILAN_BASLANGIC_MS = 4000;

/** Kapı: varsayılan AÇIK. Kapatmak için EMPP_ON_GETIRME=0. */
function acikMi(env = process.env) {
  return env.EMPP_ON_GETIRME !== '0';
}

/**
 * Enjekte edilecek betiği üretir. Saf fonksiyon — dosya sistemine dokunmaz.
 * @param {string[]} sayfalar kitap köküne göreli yollar, GÖRÜNTÜLENME SIRASINDA
 * @param {{araMs?:number, baslangicMs?:number}} [secenekler]
 */
function betikUret(sayfalar, secenekler = {}) {
  const liste = Array.isArray(sayfalar) ? sayfalar.filter((s) => typeof s === 'string' && s) : [];
  const araMs = Number.isFinite(secenekler.araMs) && secenekler.araMs >= 0
    ? Math.floor(secenekler.araMs) : VARSAYILAN_ARA_MS;
  const baslangicMs = Number.isFinite(secenekler.baslangicMs) && secenekler.baslangicMs >= 0
    ? Math.floor(secenekler.baslangicMs) : VARSAYILAN_BASLANGIC_MS;

  return `<script>/*${ISARET}*/
(function(){
  if (window.__${ISARET}__) return;
  window.__${ISARET}__ = true;
  var SAYFALAR = ${JSON.stringify(liste)};
  if (!SAYFALAR.length) return;
  var ARA = ${araMs}, BASLANGIC = ${baslangicMs};
  var okunan = 0, bayt = 0, basladi = 0;

  // Sekme arkaplandayken ısıtma yapma — kullanıcının işine disk/CPU çalmasın.
  function gorunur(){ try { return document.visibilityState !== 'hidden'; } catch(e){ return true; } }

  function nodeOku(yol){
    return new Promise(function(coz){
      try {
        var f = window.require('fs'), p = window.require('path');
        f.readFile(p.join(__dirname, yol), function(h, d){ coz(h ? 0 : (d ? d.length : 0)); });
      } catch(e){ coz(-1); }
    });
  }
  function agOku(yol){
    return new Promise(function(coz){
      try {
        fetch(yol).then(function(y){ return y.arrayBuffer(); })
          .then(function(b){ coz(b ? b.byteLength : 0); })
          .catch(function(){ coz(0); });
      } catch(e){ coz(0); }
    });
  }

  var nodeVar = null;
  function oku(yol){
    if (nodeVar === false) return agOku(yol);
    return nodeOku(yol).then(function(n){
      if (n === -1) { nodeVar = false; return agOku(yol); }
      nodeVar = true; return n;
    });
  }

  function sirayaDevam(i){
    if (i >= SAYFALAR.length) {
      try { console.log('[${ISARET}] bitti: ' + okunan + ' sayfa, ' +
        Math.round(bayt/1048576) + ' MB, ' + Math.round((Date.now()-basladi)/1000) + ' sn'); } catch(e){}
      return;
    }
    if (!gorunur()) { setTimeout(function(){ sirayaDevam(i); }, 1000); return; }
    oku(SAYFALAR[i]).then(function(n){
      if (n > 0) { okunan++; bayt += n; }
      setTimeout(function(){ sirayaDevam(i + 1); }, ARA);
    }).catch(function(){ setTimeout(function(){ sirayaDevam(i + 1); }, ARA); });
  }

  function basla(){
    basladi = Date.now();
    try { console.log('[${ISARET}] ' + SAYFALAR.length + ' sayfa sirayla isitilacak'); } catch(e){}
    sirayaDevam(0);
  }
  // Kitap arayüzü yerleşsin diye beklenir; açılış zincirine yük bindirmez.
  if (window.requestIdleCallback) {
    setTimeout(function(){ window.requestIdleCallback(basla, { timeout: 10000 }); }, BASLANGIC);
  } else {
    setTimeout(basla, BASLANGIC);
  }
})();
</script>`;
}

/** `…/assets/<kitap>/pages/<ad>.<uzanti>` yollarını SAYISAL sıraya dizer. */
function sayfalariSirala(yollar) {
  const sayi = (y) => {
    const m = /(\d+)\.[a-z0-9]+$/i.exec(y);
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
  };
  return [...yollar].sort((a, b) => {
    const fa = sayi(a); const fb = sayi(b);
    if (fa !== fb) return fa - fb;
    return a.localeCompare(b);
  });
}

/** index.html'e betiği enjekte eder. İnvolutif değil — işaret varsa dokunmaz. */
function icerigeEnjekteEt(html, betik) {
  const giris = String(html == null ? '' : html);
  if (giris.includes(ISARET)) return { icerik: giris, uygulandi: false, sebep: 'zaten-yamali' };
  if (!betik) return { icerik: giris, uygulandi: false, sebep: 'betik-bos' };
  const i = giris.lastIndexOf('</body>');
  if (i === -1) return { icerik: giris, uygulandi: false, sebep: 'body-yok' };
  return {
    icerik: giris.slice(0, i) + betik + '\n' + giris.slice(i),
    uygulandi: true,
    sebep: 'enjekte-edildi',
  };
}

/** Bir kitap dizinindeki sayfa görsellerini kitap köküne göreli olarak toplar. */
async function sayfalariTopla(kitapDizini) {
  const kok = path.join(kitapDizini, 'assets');
  if (!(await fs.pathExists(kok))) return [];
  const bulunan = [];
  for (const kitapId of await fs.readdir(kok)) {
    const sayfaDizini = path.join(kok, kitapId, 'pages');
    if (!(await fs.pathExists(sayfaDizini))) continue;
    for (const ad of await fs.readdir(sayfaDizini)) {
      if (!/\.(png|jpe?g|webp)$/i.test(ad)) continue;
      bulunan.push(path.posix.join('assets', kitapId, 'pages', ad));
    }
  }
  return sayfalariSirala(bulunan);
}

/**
 * Pakete uygular: her kitap dizininin index.html'ine ön-getirme betiğini enjekte eder.
 * SET paketinde her alt-kitap ayrı kitaptır ve kendi sayfa listesini alır.
 * @returns {Promise<{kitap:string, sayfa:number, sebep:string}[]>}
 */
async function paketeUygula(paketKoku, { log = () => {}, araMs, baslangicMs } = {}) {
  const sonuc = [];
  const adaylar = [paketKoku];
  for (const ad of await fs.readdir(paketKoku)) {
    const tam = path.join(paketKoku, ad);
    if ((await fs.stat(tam)).isDirectory()) adaylar.push(tam);
  }
  for (const dizin of adaylar) {
    const html = path.join(dizin, 'index.html');
    if (!(await fs.pathExists(html))) continue;
    const sayfalar = await sayfalariTopla(dizin);
    if (!sayfalar.length) continue;
    const mevcut = await fs.readFile(html, 'utf8');
    const { icerik, uygulandi, sebep } = icerigeEnjekteEt(
      mevcut, betikUret(sayfalar, { araMs, baslangicMs }));
    if (uygulandi) await fs.writeFile(html, icerik, 'utf8');
    const kitap = path.relative(paketKoku, dizin) || '(kök)';
    sonuc.push({ kitap, sayfa: sayfalar.length, sebep });
    log(`   ön-getirme: ${kitap} — ${sayfalar.length} sayfa (${sebep})`);
  }
  return sonuc;
}

module.exports = {
  ISARET, acikMi, betikUret, sayfalariSirala, icerigeEnjekteEt,
  sayfalariTopla, paketeUygula,
  VARSAYILAN_ARA_MS, VARSAYILAN_BASLANGIC_MS,
};
