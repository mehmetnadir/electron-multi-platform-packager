'use strict';

/**
 * K27 — ÜÇÜNCÜ AÇILIŞ GÖSTERGESİ KALDIRILIR ("Kitap Açılıyor..").
 *
 * NADİR (2026-09-20): "3 nokta geliyor, logo splash geliyor, bunlar yetmiyormuş gibi
 * bir de 'kitap açılıyor' diye bir yazı geliyor… ölme eşşeğim ölme." Kararı: **kalksın,
 * gerek yok; hemen açılmalı.**
 *
 * ÖLÇÜLEN KOD (tek kitaplık paket yolu, küçültülmüş bundle):
 *
 *   var j = function (e) {
 *     var t = e.loadBook, r = useSelector(...);
 *     useEffect(function () {                       // 1) normal yol
 *       if (r.module?.oneBook != null) {
 *         var n = r.module.covers[0], a = r.module.checkUpdates[r.module.oneBook];
 *         a?.status === JF.PENDING ? (indir…).finally(function(){ t(n) })
 *                                  : a?.status === JF.NONE && t(n);
 *       }
 *     }, [r.module.checkUpdates]);
 *     useEffect(function () {                       // 2) GÜVENCE
 *       return m || (window.t1 = setTimeout(function(){ t(r.module.covers[0]) }, 5e3)),
 *              function(){ return clearTimeout(window.t1) };
 *     }, [m]);
 *     return <div><p>{m ? "Kitap Güncelleniyor %"+g : "Kitap Açılıyor.."}</p><BarLoader/></div>;
 *   };
 *
 * Yani kitap, güncelleme sorgusu bir sonuca bağlanana kadar AÇILMIYOR; o sürede ekranda
 * "Kitap Açılıyor.." yazısı duruyor, bağlanmazsa 5 sn'lik güvence açıyor. K25b sorguya
 * 2,5 sn bütçe koydu — yani yazının ömrü 2,5 sn'ye indi ama YAZI DURUYOR.
 *
 * BU YAMA İKİ ŞEY YAPAR:
 *   1) Güvence gecikmesini 5000 ms → 0 ms yapar: bileşen ilk çizildiği anda kitap açılır.
 *   2) "Kitap Açılıyor.." metnini boşaltır — bir kare bile görünmesin.
 *
 * GÜNCELLEME İPTAL EDİLMEZ: güncelleme BEKLEYEN durumdaysa (`PENDING`) ilk etki
 * `m`'i true yapar, ikinci etkinin temizliği 0 ms'lik zamanlayıcıyı iptal eder ve ekranda
 * "Kitap Güncelleniyor %N" yazısı KALIR — bilgilendirici olan tek gösterge korunur.
 * Güncelleme sonrası zaten `finally` içinde `loadBook` yeniden çağrılıyor (Nadir'in
 * istediği "sayfa yenilensin / göz kırpsın" davranışı buradan geliyor).
 */

const path = require('path');
const fs = require('fs-extra');

const ISARET = 'EMPP_ACILIS_GOSTERGE';
const VARSAYILAN_GECIKME_MS = 0;

/** Kapı: varsayılan AÇIK. Kapatmak için EMPP_ACILIS_GOSTERGE=0. */
function acikMi(env = process.env) {
  return env.EMPP_ACILIS_GOSTERGE !== '0';
}

/** Gecikme: EMPP_ACILIS_GECIKME_MS (>=0). Geçersizse 0. */
function gecikme(env = process.env) {
  const n = Number(env.EMPP_ACILIS_GECIKME_MS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : VARSAYILAN_GECIKME_MS;
}

// 1) Güvence zamanlayıcısı. `window.t1` + `covers[0]` ikilisi bu bileşene özgüdür;
//    salt `setTimeout(...,5e3)` aramak paketin başka yerlerindeki zamanlayıcıları vurur.
const GUVENCE_RE =
  /window\.t1\s*=\s*setTimeout\(\(function\(\)\{(\w+)\((\w+)\.module\.covers\[0\]\)\}\),\s*5e3\)/g;

// 2) Metin. Çapası "Kitap Güncelleniyor" üçlü işlecidir: yalnız bu ekranın
//    "açılıyor" dalı boşaltılır, metin başka yerde geçiyorsa DOKUNULMAZ.
//
//    İKİ SÜRÜM VAR (sm4 paketinde ölçüldü, 22 paketin 20'si + 2'si):
//      yeni: m?"Kitap Güncelleniyor %".concat(g):"Kitap Açılıyor.."   (güvenceli)
//      eski: m?"Kitap Güncelleniyor":"Kitap Açılıyor.."                (GÜVENCESİZ —
//            bu sürümde window.t1 zamanlayıcısı hiç yok; kitabı yalnız güncelleme
//            sorgusunun sonucu açıyor, onu da K25b 2,5 sn'ye bağladı)
const METIN_RE = /("Kitap Güncelleniyor(?:\s*%"\.concat\(\w+\)|"))\s*:\s*"Kitap Açılıyor\.\."/g;

/**
 * Saf dönüşüm. Dosya sistemine dokunmaz.
 * @returns {{icerik:string, uygulandi:boolean, sebep:string, guvence:number, metin:number}}
 */
function icerigiDuzelt(icerik, { gecikmeMs } = {}) {
  const giris = String(icerik == null ? '' : icerik);
  if (giris.includes(ISARET)) {
    return { icerik: giris, uygulandi: false, sebep: 'zaten-yamali', guvence: 0, metin: 0 };
  }
  const ms = Number.isFinite(gecikmeMs) && gecikmeMs >= 0
    ? Math.floor(gecikmeMs) : VARSAYILAN_GECIKME_MS;

  let guvence = 0;
  let cikti = giris.replace(GUVENCE_RE, (tam, yukle, durum) => {
    guvence += 1;
    return `window.t1=setTimeout((function(){/*${ISARET}*/${yukle}(${durum}.module.covers[0])}),${ms})`;
  });

  let metin = 0;
  cikti = cikti.replace(METIN_RE, (tam, guncelleniyor) => {
    metin += 1;
    return `${guncelleniyor}:""/*${ISARET}*/`;
  });

  if (guvence === 0 && metin === 0) {
    return { icerik: giris, uygulandi: false, sebep: 'kalip-yok', guvence: 0, metin: 0 };
  }
  return { icerik: cikti, uygulandi: true, sebep: 'duzeltildi', guvence, metin };
}

/** Bir paket ağacındaki (kök + bir seviye alt dizin) js paketlerini düzeltir. */
async function paketeUygula(paketKoku, { log = () => {}, gecikmeMs } = {}) {
  const sonuc = [];
  const dizinler = [paketKoku];
  for (const ad of await fs.readdir(paketKoku)) {
    const tam = path.join(paketKoku, ad);
    if ((await fs.stat(tam)).isDirectory()) dizinler.push(tam);
  }
  for (const dizin of dizinler) {
    let dosya = 0;
    let guvence = 0;
    let metin = 0;
    for (const ad of await fs.readdir(dizin)) {
      if (!ad.endsWith('.js')) continue;
      const tam = path.join(dizin, ad);
      if (!(await fs.stat(tam)).isFile()) continue;
      const mevcut = await fs.readFile(tam, 'utf8');
      // Hızlı eleme: paketlerin büyük çoğunluğunda bu ekran hiç yok.
      if (!mevcut.includes('Kitap Açılıyor') && !mevcut.includes('window.t1')) continue;
      const r = icerigiDuzelt(mevcut, { gecikmeMs });
      if (!r.uygulandi) continue;
      await fs.writeFile(tam, r.icerik, 'utf8');
      dosya += 1; guvence += r.guvence; metin += r.metin;
    }
    if (dosya) {
      const ad = path.relative(paketKoku, dizin) || '.';
      sonuc.push({ dizin: ad, dosya, guvence, metin });
      log(`   açılış göstergesi: ${ad} — ${dosya} paket, ${guvence} güvence, ${metin} metin`);
    }
  }
  return sonuc;
}

module.exports = {
  ISARET, acikMi, gecikme, icerigiDuzelt, paketeUygula, VARSAYILAN_GECIKME_MS,
};
