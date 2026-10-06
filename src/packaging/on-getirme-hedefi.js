'use strict';

/**
 * ÖN-GETİRME HEDEFİ — "kitap kökü" ve "işaretin yazılacağı sayfa" için TEK KAYNAK (2026-10-06).
 *
 * NEDEN: 45478 / 45480 (A1 tek motorlu set) Windows statik kapısında madde 10'da düştü:
 * "1 kitap kökünün HİÇBİRİNDE EMPP_ON_GETIRME yok". Enjeksiyon (Ö4, f41e603) A1'de betiği
 * motor sayfasına (`kapak/index.html`) yazıyordu; kapı ise kök `index.html`de (sf425
 * kabuğu) arıyordu. İki ayrı tanım ayrıştı; kapı sağlam paketi suçladı.
 * bookN setleri (45550, 45538, 11811) etkilenmedi: kök = `bookN/`, hedef = `bookN/index.html`.
 *
 * İki tüketicinin ORTAK tanımı (kopya tanım YASAK):
 *   - `src/packaging/sayfa-on-getirme.js` (enjekte eder)
 *   - `scripts/windows-paket-kapisi.js` madde 10 (çıktıyı ölçer)
 * Ayrışma olursa `on-getirme-hedefi.test.js` sözleşme testi düşer.
 *
 * BAĞIMLILIK: yalnız `./a1-duzen` (yükleme anında Node stdlib). Kapı stdlib-only kalır.
 */

const A1 = require('./a1-duzen');

/** A1 kararında kökte bulunması zorunlu dosyalar (`a1-duzen.a1Durumu` ile aynı). */
const A1_KOK_DOSYALARI = ['classlibraries/ImWin32.dll', 'app.config.js'];

/**
 * Kitap kökleri = `index.html` VE `app.config.js` birlikte duran dizinler. SAF.
 *
 * Motor imzasıyla bulunur, AD DESENİYLE DEĞİL (proje kanonu K17, `sub-book-dirs.js`).
 * SET'te book1..bookN'i verir; SET menü kökünü, `htmletk/` alt sayfalarını ve A1'in
 * `kapak/` dizinini (yalnız index.html taşır) dışarıda bırakır.
 * @param {string[]} yollar kök-göreli, '/' ayraçlı dosya yolları
 * @returns {string[]} kök-göreli dizinler ('' = uygulama kökü), sıralı
 */
function kitapKokleri(yollar) {
  const kume = new Set(Array.isArray(yollar) ? yollar : []);
  const dizin = (y) => (y.includes('/') ? y.slice(0, y.lastIndexOf('/')) : '');
  const kokler = [];
  for (const y of kume) {
    if (!/(^|\/)index\.html$/i.test(y)) continue;
    const d = dizin(y);
    if (kume.has(d ? `${d}/app.config.js` : 'app.config.js')) kokler.push(d);
  }
  return kokler.sort();
}

/**
 * Yol listesi + motor sayfası içeriğinden A1 kararı. `a1-duzen.a1Durumu` ile AYNI ölçüt:
 * A1 işaretli `kapak/index.html` + kökte `classlibraries/ImWin32.dll` ve `app.config.js`. SAF.
 * @param {string[]} yollar
 * @param {string|null} kapakHtml `kapak/index.html` içeriği (okunamadıysa null)
 */
function a1YollardanMi(yollar, kapakHtml) {
  const kume = new Set(Array.isArray(yollar) ? yollar : []);
  if (!kume.has(A1.A1_MOTOR_SAYFASI)) return false;
  if (typeof kapakHtml !== 'string' || !kapakHtml.includes(A1.A1_ISARET)) return false;
  return A1_KOK_DOSYALARI.every((y) => kume.has(y));
}

/**
 * Bir kitap kökünde ön-getirme işaretini taşıması gereken sayfa. SAF.
 * A1 düzeninde kök `index.html` sf425 kabuğudur (kitap açmaz); sayfaları ısıtan motor
 * sayfasıdır: `kapak/index.html`. Diğer her kökte `<kök>/index.html`.
 * @param {string} kok kök-göreli dizin ('' = uygulama kökü)
 * @param {boolean} a1 paket A1 düzeninde mi
 * @returns {string} kök-göreli sayfa yolu
 */
function onGetirmeSayfasi(kok, a1) {
  if (a1 && !kok) return A1.A1_MOTOR_SAYFASI;
  return kok ? `${kok}/index.html` : 'index.html';
}

/**
 * Pakette ön-getirme işaretini taşıması gereken bütün sayfalar. SAF.
 * @param {string[]} yollar kök-göreli dosya yolları
 * @param {string|null} kapakHtml `kapak/index.html` içeriği (yoksa/okunamadıysa null)
 * @returns {{kok: string, sayfa: string, a1: boolean}[]}
 */
function onGetirmeHedefleri(yollar, kapakHtml) {
  const a1 = a1YollardanMi(yollar, kapakHtml);
  return kitapKokleri(yollar).map((kok) => ({ kok, sayfa: onGetirmeSayfasi(kok, a1), a1 }));
}

module.exports = {
  A1_MOTOR_SAYFASI: A1.A1_MOTOR_SAYFASI, A1_KOK_DOSYALARI, kitapKokleri, a1YollardanMi, onGetirmeSayfasi, onGetirmeHedefleri,
};
