'use strict';

/**
 * K26 — SABİT SPLASH BEKLEMESİNİ KALDIR ("ölme eşşeğim ölme", Nadir 2026-09-20).
 *
 * SAHA ÖLÇÜMÜ: kitap açılırken ÜÇ ayrı gösterge arka arkaya geliyor —
 *   1) 3 nokta      → `#loader-root.loading` + `.lds-ellipsis` (bookN/index.html),
 *                      React mount edilene kadar
 *   2) logo splash  → logo yüklendikten SONRA **sabit 1500 ms** beklenip LOADED'a geçiliyor
 *   3) "Kitap Açılıyor.." → güncelleme kararı beklenirken (K25 ile 2,5 sn'ye sınırlandı)
 *
 * Bu modül YALNIZ 2'yi hedefler — üçünün arasında tek SAF yapay bekleme odur:
 *
 *     useEffect(() => {
 *       durum === FR.IDLE && "loading" !== logoDurumu && setTimeout(() => ayarla(FR.LOADED), 1500)
 *     }, [...])
 *
 * Logo GÖRÜNTÜSÜ zaten yüklenmiş ("loading" değil), yani 1500 ms hiçbir işi beklemiyor;
 * markalı splash'ı zorla ekranda tutmak için konmuş. Gerçek iş (chunk yükleme, ImWin32.dll
 * okuma, anahtar denetimi) bu sırada zaten paralel koşuyor.
 *
 * ÇÖZÜM: bekleme süresi 0'a çekilir — çağrı aynı yoldan, aynı `setTimeout` ile gider
 * (React'ın efekt içi durum değiştirme semantiği korunur), yalnız yapay gecikme kalkar.
 * Süre `EMPP_SPLASH_MS` ile ayarlanabilir; markalı bir duraklama istenirse 600 verilir.
 *
 * 1 ve 3'e DOKUNULMAZ: 1 gerçek bir yükleme göstergesi, 3 ise K25'in süre bütçesiyle
 * zaten gerçek karara bağlandı.
 */

const path = require('path');
const fs = require('fs-extra');

const ISARET = 'EMPP_SPLASH';
const VARSAYILAN_MS = 0;

/** Kapı: varsayılan AÇIK. Kapatmak için EMPP_SPLASH_BEKLEMESI=0. */
function acikMi(env = process.env) {
  return env.EMPP_SPLASH_BEKLEMESI !== '0';
}

/** Ayarlanabilir süre: EMPP_SPLASH_MS (ms). Geçersizse varsayılan. */
function sure(env = process.env) {
  const n = Number(env.EMPP_SPLASH_MS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : VARSAYILAN_MS;
}

// `setTimeout((function(){ X(Y.FR.LOADED) }),1500)` — küçültücü yalnız tanımlayıcıları
// değiştiriyor. `FR.LOADED` çapası kalıbı benzerlerinden ayırır.
const SPLASH_RE =
  /setTimeout\(\(function\(\)\{(\w+)\((\w+)\.FR\.LOADED\)\}\),1500\)/g;

/**
 * Saf dönüşüm. Dosya sistemine dokunmaz.
 * @returns {{icerik:string, uygulandi:boolean, sebep:string, yama:number}}
 */
function icerigiDuzelt(icerik, { ms } = {}) {
  const giris = String(icerik == null ? '' : icerik);
  if (giris.includes(ISARET)) {
    return { icerik: giris, uygulandi: false, sebep: 'zaten-yamali', yama: 0 };
  }
  const gecikme = Number.isFinite(ms) && ms >= 0 ? Math.floor(ms) : VARSAYILAN_MS;
  let yama = 0;
  const cikti = giris.replace(SPLASH_RE, (tam, ayarla, sabit) => {
    yama += 1;
    return `setTimeout((function(){/*${ISARET}*/${ayarla}(${sabit}.FR.LOADED)}),${gecikme})`;
  });
  if (yama === 0) {
    return { icerik: giris, uygulandi: false, sebep: 'kalip-yok', yama: 0 };
  }
  return { icerik: cikti, uygulandi: true, sebep: 'duzeltildi', yama };
}

/** Paket ağacındaki (kök + bir seviye) js paketlerini düzeltir. */
async function paketeUygula(paketKoku, { log = () => {}, ms } = {}) {
  const sonuc = [];
  const dizinler = [paketKoku];
  for (const ad of await fs.readdir(paketKoku)) {
    const tam = path.join(paketKoku, ad);
    if ((await fs.stat(tam)).isDirectory()) dizinler.push(tam);
  }
  for (const dizin of dizinler) {
    let dosya = 0;
    let cagri = 0;
    for (const ad of await fs.readdir(dizin)) {
      if (!ad.endsWith('.js')) continue;
      const tam = path.join(dizin, ad);
      if (!(await fs.stat(tam)).isFile()) continue;
      const mevcut = await fs.readFile(tam, 'utf8');
      if (!mevcut.includes('FR.LOADED')) continue;   // hızlı eleme
      const r = icerigiDuzelt(mevcut, { ms });
      if (!r.uygulandi) continue;
      await fs.writeFile(tam, r.icerik, 'utf8');
      dosya += 1;
      cagri += r.yama;
    }
    if (dosya) {
      const ad = path.relative(paketKoku, dizin) || '.';
      sonuc.push({ dizin: ad, dosya, cagri });
      log(`   splash beklemesi: ${ad} — ${dosya} paket, ${cagri} bekleme kaldırıldı`);
    }
  }
  return sonuc;
}

module.exports = { ISARET, acikMi, sure, icerigiDuzelt, paketeUygula, VARSAYILAN_MS };
