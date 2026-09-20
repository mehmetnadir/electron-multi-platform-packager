'use strict';

/**
 * AÇILIŞ GÜNCELLEME ÖTELEMESİ — pencere önce açılır, güncelleme kontrolü arkaya alınır.
 *
 * SAHA ARIZASI (2026-09-20 ölçüldü): yayıncı motorunun `electron.js`'i şöyle:
 *     app.whenReady().then(async () => {
 *       try { await checkForUpdates() } catch (err) {}
 *       createWindow();
 *     });
 * Yani `createWindow()` — SPLASH DAHİL HİÇBİR PENCERE — güncelleme sorgusu bitmeden
 * çağrılmıyor. Kullanıcı o süre boyunca BOMBOŞ EKRAN görür, uygulama açılmamış sanır.
 *
 * İki ayrı kusur:
 *  1) Sıra yanlış: ağ turu pencereden önce.
 *  2) `https.get` çağrılarında ZAMAN AŞIMI YOK. Sunucu bağlantıyı kabul edip yanıt
 *     vermezse (okul güvenlik duvarlarının klasik davranışı) `resolve()` hiç çağrılmaz
 *     ve uygulama SÜRESİZ pencere açmadan bekler. Ölçüm: sağlıklı ağda 0,54 sn;
 *     üst sınır yok.
 *
 * ÇÖZÜM (Nadir önceliği, 2026-09-20: "ötelenmiş güncelleme kontrolü önemli"):
 *   • `createWindow()` ÖNCE çağrılır — pencere anında açılır.
 *   • `checkForUpdates()` pencereden sonra, ateşle-unut olarak koşar.
 *   • Her `https.get` isteğine gerçek zaman aşımı takılır; dolarsa istek iptal edilip
 *     akış devam eder (güncelleme atlanır, uygulama açılır).
 *
 * Güncelleme İPTAL EDİLMEZ, yalnız açılışı bekletmekten çıkarılır.
 */

const path = require('path');
const fs = require('fs-extra');

const ISARET = 'EMPP_GUNCELLEME_OTELEME';
const VARSAYILAN_GECIKME_MS = 3000;
const VARSAYILAN_ZAMAN_ASIMI_MS = 15000;

/** Kapı: varsayılan AÇIK. Kapatmak için EMPP_GUNCELLEME_OTELEME=0. */
function acikMi(env = process.env) {
  return env.EMPP_GUNCELLEME_OTELEME !== '0';
}

// `await checkForUpdates()` + ardından `createWindow()` kalıbı. Küçültülmemiş
// kaynak; boşluk/yorum/noktalı virgül değişebilir diye esnek yazıldı.
const SIRA_RE = /try\s*\{\s*await\s+checkForUpdates\(\)\s*;?\s*\}\s*catch\s*\(\s*\w*\s*\)\s*\{\s*\}\s*;?\s*createWindow\(\)\s*;?/;

/** `http.get(` / `https.get(` çağrılarına zaman aşımı takar. */
const GET_RE = /(\b\w+)\.get\(\s*([^,]+?),\s*(\w+)\s*=>\s*\{/g;

/**
 * Saf dönüşüm. Dosya sistemine dokunmaz.
 * @returns {{icerik:string, uygulandi:boolean, sebep:string, zamanAsimi:number}}
 */
function icerigiDuzelt(icerik, { gecikmeMs, zamanAsimiMs } = {}) {
  const giris = String(icerik == null ? '' : icerik);
  if (giris.includes(ISARET)) {
    return { icerik: giris, uygulandi: false, sebep: 'zaten-yamali', zamanAsimi: 0 };
  }
  if (!SIRA_RE.test(giris)) {
    return { icerik: giris, uygulandi: false, sebep: 'kalip-yok', zamanAsimi: 0 };
  }
  const gecikme = Number.isFinite(gecikmeMs) && gecikmeMs >= 0
    ? Math.floor(gecikmeMs) : VARSAYILAN_GECIKME_MS;
  const asim = Number.isFinite(zamanAsimiMs) && zamanAsimiMs > 0
    ? Math.floor(zamanAsimiMs) : VARSAYILAN_ZAMAN_ASIMI_MS;

  // 1) Sırayı çevir: pencere önce, güncelleme sonra ve ateşle-unut.
  let cikti = giris.replace(SIRA_RE,
    `/*${ISARET}*/ createWindow();\n`
    + `  setTimeout(function(){ try { Promise.resolve(checkForUpdates()).catch(function(){}) } catch (e) {} }, ${gecikme});`);

  // 2) Ağ isteklerine gerçek zaman aşımı: yanıtsız sunucu artık güncellemeyi
  //    süresiz askıda bırakamaz (açılışı bekletmiyor olsa da kaynak sızdırırdı).
  let zamanAsimi = 0;
  cikti = cikti.replace(GET_RE, (tam, nesne, adres, yanit) => {
    zamanAsimi += 1;
    return `${nesne}.get(${adres}, { timeout: ${asim} }, ${yanit} => {`;
  });
  if (zamanAsimi > 0) {
    // `}).on("error",` -> `}).on("timeout", …).on("error",`
    // DİKKAT: `})` yakalanıp yeniden yazılmaz, yalnız araya girilir; ilk denemede
    // `})` iki kez üretilip dosya sözdizimsel olarak bozulmuştu (node --check yakaladı).
    cikti = cikti.replace(/(\}\))(\s*\.on\("error",)/g,
      `$1.on("timeout", function(){ try { this.destroy() } catch (e) {} })$2`);
  }
  return { icerik: cikti, uygulandi: true, sebep: 'duzeltildi', zamanAsimi };
}

// Paketleyici `electron.js`'i sonradan `main.js` olarak kopyalar (prepareElectronFiles).
// Bu yama ONDAN ÖNCE koştuğu için kopya da yamalı doğar; yine de kaynakta hazır bir
// `main.js` varsa o da düzeltilir — giriş dosyası hangisi olursa olsun yama tutar.
const GIRIS_ADLARI = ['electron.js', 'main.js'];

/** Paketteki açılış (electron.js / main.js) dosyalarını düzeltir. */
async function paketeUygula(paketKoku, { log = () => {}, gecikmeMs, zamanAsimiMs } = {}) {
  const sonuc = [];
  const adaylar = GIRIS_ADLARI.map((ad) => path.join(paketKoku, ad));
  for (const ad of await fs.readdir(paketKoku)) {
    const tam = path.join(paketKoku, ad);
    if (!(await fs.stat(tam)).isDirectory()) continue;
    for (const giris of GIRIS_ADLARI) adaylar.push(path.join(tam, giris));
  }
  for (const dosya of adaylar) {
    if (!(await fs.pathExists(dosya))) continue;
    const mevcut = await fs.readFile(dosya, 'utf8');
    const r = icerigiDuzelt(mevcut, { gecikmeMs, zamanAsimiMs });
    if (r.uygulandi) await fs.writeFile(dosya, r.icerik, 'utf8');
    const ad = path.relative(paketKoku, dosya);
    sonuc.push({ dosya: ad, uygulandi: r.uygulandi, sebep: r.sebep, zamanAsimi: r.zamanAsimi });
    log(`   güncelleme ötelemesi: ${ad} — ${r.sebep}${r.zamanAsimi ? ` (+${r.zamanAsimi} zaman aşımı)` : ''}`);
  }
  return sonuc;
}

module.exports = {
  ISARET, acikMi, icerigiDuzelt, paketeUygula, GIRIS_ADLARI,
  VARSAYILAN_GECIKME_MS, VARSAYILAN_ZAMAN_ASIMI_MS,
};
