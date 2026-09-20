'use strict';

/**
 * K20 — ANA EKRAN (setBook) YOLU YAMASI: Windows'ta beyaz ekranı onarır.
 *
 * SAHA ARIZASI (2026-09-19, Nadir): SET paketinde kitap açıkken alt bardaki "ana ekran"
 * butonuna basınca kök menüye dönmesi gerekirken BEYAZ EKRANDA kalınıyor.
 *
 * KÖK NEDEN (ölçüldü): motor `getParentPath()`'i bir URL üzerinde `path.join` ile
 * hesaplıyor —
 *     path.join(path.dirname(window.location.href), "../")
 * ve çağıran `window.location.href = getParentPath() + "/index.html"` diyor.
 * `path` platforma göre davranır:
 *   Windows : ".\\file:\\C:\\…\\app.asar\\/index.html"   → GEÇERSİZ adres, beyaz ekran
 *   Linux/mac: "file:/opt/…/app.asar//index.html"        → Chromium kabul eder, ÇALIŞIR
 * Bu yüzden arıza yalnız Windows'ta görünür; Pardus ve mac paketlerinde gizli kalmış.
 *
 * ÇÖZÜM: yol hesabı `path` yerine `URL` ile yapılır — platformdan bağımsız, her zaman
 * geçerli bir file: adresi üretir. Sondaki `/` atılır çünkü çağıran kendisi "/index.html"
 * ekliyor (aksi hâlde çift eğik çizgi kalır).
 *
 * Aynı yardımcı `externalbutton` tarafından da kullanılıyor; düzeltme onu da onarır.
 */

const path = require('path');
const fs = require('fs-extra');

const ISARET = 'EMPP_ANA_EKRAN_YOLU';

// `s.join(s.dirname(window.location.href),"../")` — join ve dirname AYNI değişkenden
// gelmeli (geri referans \1). Küçültülmüş kodda boşluk/tırnak değişebilir.
const HATALI_RE = /(\w+)\.join\(\1\.dirname\(window\.location\.href\)\s*,\s*["']\.\.\/["']\)/g;

const DOGRU = 'new URL("..",window.location.href).href.replace(/\\/$/,"")';

/** Saf dönüşüm: içeriği düzeltir, kaç değişiklik yapıldığını söyler. */
function icerigiDuzelt(icerik) {
  const giris = String(icerik == null ? '' : icerik);
  if (giris.includes(ISARET)) return { icerik: giris, adet: 0, sebep: 'zaten-yamali' };
  HATALI_RE.lastIndex = 0;
  const adet = (giris.match(HATALI_RE) || []).length;
  if (adet === 0) return { icerik: giris, adet: 0, sebep: 'kalip-yok' };
  HATALI_RE.lastIndex = 0;
  const cikti = giris.replace(HATALI_RE, `/*${ISARET}*/${DOGRU}`);
  return { icerik: cikti, adet, sebep: 'duzeltildi' };
}

/** Tek dosyayı yerinde düzeltir (atomik: geçici dosya + rename). */
async function dosyayiDuzelt(yol) {
  let ham;
  try { ham = await fs.readFile(yol, 'utf8'); } catch (e) { return 0; }
  const r = icerigiDuzelt(ham);
  if (r.adet === 0) return 0;
  const gecici = yol + '.empp-tmp';
  await fs.writeFile(gecici, r.icerik, 'utf8');
  await fs.rename(gecici, yol);
  return r.adet;
}

/** Paket kökü + alt-kitaplardaki .js dosyalarını tarar. */
async function paketiDuzelt(kokDizin, opts = {}) {
  const log = opts.log || (() => {});
  const dizinler = [kokDizin];
  for (const ad of await fs.readdir(kokDizin)) {
    const p = path.join(kokDizin, ad);
    try { if (/^book\d+$/i.test(ad) && (await fs.stat(p)).isDirectory()) dizinler.push(p); }
    catch (e) { /* atla */ }
  }
  let toplamDosya = 0; let toplamAdet = 0;
  for (const d of dizinler) {
    let girdiler;
    try { girdiler = await fs.readdir(d); } catch (e) { continue; }
    for (const f of girdiler) {
      if (!/\.js$/i.test(f)) continue;
      const n = await dosyayiDuzelt(path.join(d, f));
      if (n > 0) { toplamDosya += 1; toplamAdet += n; }
    }
  }
  if (toplamAdet > 0) log(`🏠 ana ekran yolu (K20): ${toplamDosya} dosyada ${toplamAdet} düzeltme`);
  else log('🏠 ana ekran yolu (K20): hatalı kalıp bulunamadı — NO-OP');
  return { toplamDosya, toplamAdet };
}

module.exports = { icerigiDuzelt, dosyayiDuzelt, paketiDuzelt, ISARET, HATALI_RE, DOGRU };
