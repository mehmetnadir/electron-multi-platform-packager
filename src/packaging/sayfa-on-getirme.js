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
const { A1_MOTOR_SAYFASI } = require('./a1-duzen');
const hedef = require('./on-getirme-hedefi');

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
 * @param {{araMs?:number, baslangicMs?:number, kapakSuz?:boolean}} [secenekler]
 *   kapakSuz (A1): çalışma anında `?kapak=<ID>` okunur, yalnız `assets/<ID>/` sayfaları ısıtılır
 *   (tek motor sayfası yedi kitabın hepsini taşır; açık olan tek kitaptır).
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
  var SAYFALAR = ${JSON.stringify(liste)};${secenekler.kapakSuz ? `
  try {
    var KAPAK = (/[?&]kapak=(\\d{1,12})(?=&|#|$)/.exec(location.search || '') || [])[1];
    if (KAPAK) { KAPAK = String(Number(KAPAK)); SAYFALAR = SAYFALAR.filter(function(y){ return y.indexOf('assets/' + KAPAK + '/') === 0; }); }
  } catch(e){}` : ''}
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
 * Paket kökünün ilk iki katmanındaki hedef tanımına giren dosyaları kök-göreli listeler:
 * kök ve 1. seviye dizinlerin `index.html` / `app.config.js`'i + A1 kararının istediği kök
 * dosyaları. Kitap kökü ve hedef sayfa kararı `on-getirme-hedefi.js`'ten (kapıyla AYNI) gelir.
 */
async function hedefYollari(paketKoku) {
  const yollar = [];
  const dizinler = [''];
  for (const ad of await fs.readdir(paketKoku)) {
    if ((await fs.stat(path.join(paketKoku, ad))).isDirectory()) dizinler.push(ad);
  }
  for (const d of dizinler) {
    for (const dosya of ['index.html', 'app.config.js']) {
      const rel = d ? `${d}/${dosya}` : dosya;
      if (await fs.pathExists(path.join(paketKoku, ...rel.split('/')))) yollar.push(rel);
    }
  }
  for (const rel of hedef.A1_KOK_DOSYALARI) {
    if (!yollar.includes(rel) && await fs.pathExists(path.join(paketKoku, ...rel.split('/')))) {
      yollar.push(rel);
    }
  }
  return yollar;
}

/**
 * Pakete uygular: her KİTAP KÖKÜNÜN (index.html + app.config.js) hedef sayfasına ön-getirme
 * betiğini enjekte eder. SET paketinde her alt-kitap ayrı kitaptır ve kendi sayfa listesini alır.
 *
 * Kök ve hedef tanımı `on-getirme-hedefi.js` — Windows statik kapısı madde 10 ile AYNI kaynak
 * (2026-10-06, 45478/45480: enjeksiyon `kapak/index.html`e yazıyor, kapı kök kabuğa bakıyordu).
 * A1 (tek motorlu set, inceleme Ö4): kök index.html sf425 KABUĞUDUR (kitap açmaz); hedef motor
 * sayfası `kapak/index.html` (`<base href="../">` → yollar kök-göreli, Electron'da `__dirname`
 * köke çekilir). Kök sayfa listesi motor sayfasına kapak süzgeciyle girer.
 * @returns {Promise<{kitap:string, sayfa:number, sebep:string}[]>}
 */
async function paketeUygula(paketKoku, { log = () => {}, araMs, baslangicMs } = {}) {
  const sonuc = [];
  const yollar = await hedefYollari(paketKoku);
  let kapakHtml = null;
  try {
    kapakHtml = await fs.readFile(path.join(paketKoku, ...A1_MOTOR_SAYFASI.split('/')), 'utf8');
  } catch (e) {
    if (e && e.code !== 'ENOENT') log(`   ön-getirme: ${A1_MOTOR_SAYFASI} okunamadı (${e.code || e.message})`);
  }
  for (const { kok, sayfa: hedefSayfa, a1 } of hedef.onGetirmeHedefleri(yollar, kapakHtml)) {
    const kitapDizini = kok ? path.join(paketKoku, ...kok.split('/')) : paketKoku;
    const html = path.join(paketKoku, ...hedefSayfa.split('/'));
    const kitap = path.posix.dirname(hedefSayfa) === '.' ? '(kök)' : path.posix.dirname(hedefSayfa);
    if (!(await fs.pathExists(html))) {
      log(`   ön-getirme: ${kitap} — ${hedefSayfa} yok (enjekte EDİLMEDİ)`);
      continue;
    }
    const sayfalar = await sayfalariTopla(kitapDizini);
    if (!sayfalar.length) {
      log(`   ön-getirme: ${kitap} — sayfa görseli yok (enjekte EDİLMEDİ)`);
      continue;
    }
    const mevcut = await fs.readFile(html, 'utf8');
    const { icerik, uygulandi, sebep } = icerigeEnjekteEt(
      mevcut, betikUret(sayfalar, { araMs, baslangicMs, kapakSuz: a1 && !kok }));
    if (uygulandi) await fs.writeFile(html, icerik, 'utf8');
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
