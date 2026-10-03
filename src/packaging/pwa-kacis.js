'use strict';

// PWA / Service Worker şablonlarında değerleri üretilen JS'e güvenle gömme yardımcıları.
// Gerekçe: dosya adı ya da uygulama adı tek tırnak, ters bölü, satır sonu veya `*/`
// içerince çıplak gömme sw.js'i sözdizimi hatasına düşürüp PWA'yı çökertiyordu.

const SATIR_SONU = /[\r\n\u2028\u2029]+/g;

// JS string literal'i (çift tırnaklı, JSON uyumlu); U+2028/2029 da kaçırılır.
function jsStr(v) {
  return JSON.stringify(String(v))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Dizi olarak gömme (köşeli parantezli).
function jsDizi(arr) {
  return JSON.stringify(arr.map(String), null, 2)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Köşeli parantezsiz eleman listesi (şablonda `[ {{LISTE}} ]` biçimi için).
function jsDiziElemanlari(arr) {
  return arr.map((f) => '  ' + jsStr(f)).join(',\n');
}

// Yorum satırına gömme: satır sonu ve yorum kapatan `*/` temizlenir.
function jsYorum(v) {
  return String(v).replace(SATIR_SONU, ' ').replace(/\*\//g, '* /');
}

// HTML metin/öznitelik bağlamı için kaçış.
function htmlKacis(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Üretilen JS içindeki şablon literal'ine (`...`) gömülecek metin için kaçış.
function jsSablonMetni(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

// Bağlamı bilinmeyen yer tutucu (string ya da yorum içi): her iki bağlamda da güvenli.
function jsBaglamsiz(v) {
  return jsStr(v)
    .slice(1, -1)
    .replace(/'/g, "\\'")
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/\*\//g, '*\\/');
}

// sw-template.js yer tutucularını doldurur. Fonksiyon yerine-koyma kullanılır:
// değerdeki `$&` / `$'` gibi diziler String.replace tarafından yorumlanmasın.
function swSablonDoldur(sablon, { appName, appVersion, cacheName, cachePrefix, dosyalar }) {
  return sablon
    .replace(/{{APP_NAME}}/g, () => jsBaglamsiz(appName))
    .replace(/{{APP_VERSION}}/g, () => jsBaglamsiz(appVersion))
    .replace(/{{CACHE_NAME}}/g, () => jsBaglamsiz(cacheName))
    .replace(/{{CACHE_PREFIX}}/g, () => jsBaglamsiz(cachePrefix))
    .replace('{{CRITICAL_FILES_LIST}}', () => jsDiziElemanlari(dosyalar));
}

module.exports = { htmlKacis, jsSablonMetni, jsStr, jsDizi, jsDiziElemanlari, jsYorum, jsBaglamsiz, swSablonDoldur };
