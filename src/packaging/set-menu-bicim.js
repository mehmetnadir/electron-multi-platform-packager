'use strict';
/**
 * SET menüsünün BİÇİM kuralları — SAF, bağımlılıksız (stdlib bile yok) TEK KAYNAK.
 *
 * İki kullanıcısı var, ikisi de BUNU çağırır (kopya kural yok):
 *   1) Paketleyici — `set-menu.js` (K17): kökte menü yoksa sade menüyü üretir.
 *   2) G yayın aracı — `tools/g-yayin/menu.js` (2026-09-26): `--ekle`/`--cikar` kurulu
 *      paketin menüsüne yansır. K17 kartı paketleyicinin yazdığı satırın AYNISI olmalı;
 *      aksi hâlde G ile eklenen kart paketlenmiş karttan farklı görünür.
 *
 * NEDEN AYRI MODÜL: `set-menu.js` `fs-extra` çeker; G yayın aracı "Node stdlib dışında
 * bağımlılık yok" kuralına bağlı (`fs-shim-subbook-html.js` ile aynı gerekçe).
 * BOZARSAN: `set-menu.test.js` (üretim) ve `tools/g-yayin/menu.test.js` (G) kırılır.
 */

/** Paketleyicinin ürettiği menünün imzası — idempotentlik ve biçim tanıma bunu arar. */
const MENU_ISARETI = '<!-- empp-set-menu v1 -->';

/**
 * Kitabın kapağı olarak denenen dosyalar, `assets/<id>/` altında, BU SIRAYLA
 * (2026-09-17 sf425: `thumbs/1.jpg` kitabın kendi küçük kapağı).
 */
const KAPAK_ADAYLARI = Object.freeze([
  'thumbs/1.jpg', 'thumbs/1.png', 'pages/1.png', 'pages/1.jpg',
]);

function kacis(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Kök index.html bir Web-Z kabuğu mu? İki üretici: masaüstü (Üretim Masası `WebZTemaUretici`,
 * sf425 — `scripts/language-set.js`) ve runner'ın tema kabuğu (`src/agent/webz-tema-kabuk.js`,
 * ör. Flashy `web-proxy-modern` — `<meta name="empp-webz-tema">`, 2026-10-02). İkisi de aynı
 * menü sözleşmesini taşır (`scripts/cevrimdisi-yama.js` tek `__setSettings` + settings.json).
 */
function webZKabukIndexiMi(html) {
  return typeof html === 'string'
    && (html.includes('scripts/language-set.js') || html.includes('name="empp-webz-tema"'));
}

/**
 * Sade menünün (assets2 yok) TEK kart satırı.
 * @param {{dir:string, ad:string, kapak?:string|null}} k
 * @param {number} i  kartın sıradaki yeri (0 tabanlı) — kapak yoksa yer tutucuda i+1 yazar
 */
function sadeKartHtml(k, i) {
  const gorsel = k.kapak
    ? `<img src="${kacis(k.kapak)}" alt="${kacis(k.ad)}">`
    : `<div class="yok">${i + 1}</div>`;
  return `      <a class="kart" href="${kacis(k.dir)}/index.html">${gorsel}` +
    `<span>${kacis(k.ad)}</span></a>`;
}

/**
 * Kitap adını `BookContent.xml`'in BAŞINDAKİ `pdfUrl`'den çıkarır; bulamazsa null.
 * NEDEN: yayıncının kendi `BookContent.xml`'inde `pdfUrl="pdf/SHALL-WE-5-REFERENCE-BOOK-2025.pdf"`
 * duruyor (2026-09-17, sf425). YDS PDF'leri sayısal adlı (`pdf/15792.pdf`) — bu bir ad değil
 * kimliktir; kimliği ad diye basmak 73768'de kartlara "15792" yazdırdı (2026-09-24) → null.
 * @param {string} bas  dosyanın başı (çağıran ilk 8 KB'ı verir)
 */
function kitapAdiBookContenttan(bas) {
  const m = /pdfUrl="[^"]*?\/?([^"/]+)\.pdf"/i.exec(String(bas == null ? '' : bas));
  if (!m) return null;
  const ad = m[1].replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!ad || /^[\d\s]+$/.test(ad)) return null;
  return ad.split(' ')
    .map((k) => (/^\d+$/.test(k) ? k : k.charAt(0) + k.slice(1).toLowerCase()))
    .join(' ');
}

module.exports = {
  MENU_ISARETI, KAPAK_ADAYLARI, kacis, webZKabukIndexiMi, sadeKartHtml, kitapAdiBookContenttan,
};
