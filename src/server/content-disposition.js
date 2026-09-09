'use strict';
// K11 (2026-09-09, tudem-apk-batch kanıtı) — Content-Disposition header'ının
// GÜVENLİ (Node'un http header doğrulamasını kırmayan) değerini üretir.
//
// NEDEN: Node'un `res.setHeader` doğrulaması header DEĞERLERİNİ yalnızca
// Latin-1 (ISO-8859-1, 0x00-0xFF) aralığına izin verir. Türkçe'nin
// dilekçesiz/noktasız harfleri (ı U+0131, İ U+0130, ğ/Ğ U+011F/U+011E,
// ş/Ş U+015F/U+015E) bu aralığın TAMAMEN DIŞINDA — ü/ö/ç gibi Batı Avrupa
// harfleri (Latin-1 içinde) sorun ÇIKARMAZ, yalnız bu 6 harf çıkarır.
// BELİRTİ: `UcanBalık60+_2023.iso`'dan üretilen APK'nın dosya adı
// `UcanBalık60+ 2023-v1.0.0.apk` — `/api/download/:jobId/:platform`
// `res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"')`
// yazarken Node `TypeError [ERR_INVALID_CHAR]: Invalid character in header
// content ["Content-Disposition"]` fırlatıyor, route'un try/catch'i bunu
// 500 + "Dosya indirme hatası: ..." olarak yakalıyor — dosya diskte SAĞLAM,
// yalnız indirme endpoint'i çöküyor.
// KANIT: 2026-09-09, tudem-apk-batch raporu — build başarılı, dosya ~2.96GB
// sağlam, ama /api/download 500 döndü; elle kopyalanarak teslim edildi.
//
// ÇÖZÜM: RFC 6266/5987 — ASCII fallback (Türkçe harfler Latince karşılıklarına
// çevrilir, kalan her şey Latin-1'e indirgenmeye çalışılır, hâlâ dışında
// kalanlar '_' olur) + `filename*=UTF-8''<percent-encoded>` (gerçek ad, RFC 5987
// destekleyen HER modern tarayıcı/indirme aracında dosya GERÇEK adıyla iner).
//
// BOZARSAN: `content-disposition.test.js`'teki GERİLEME testi kırılır.

const TR_MAP = {
  'ı': 'i', 'İ': 'I', 'ğ': 'g', 'Ğ': 'G', 'ş': 's', 'Ş': 'S',
  'ü': 'u', 'Ü': 'U', 'ö': 'o', 'Ö': 'O', 'ç': 'c', 'Ç': 'C',
};

function toAsciiFallback(fileName) {
  let out = '';
  for (const ch of String(fileName)) {
    if (TR_MAP[ch] !== undefined) {
      out += TR_MAP[ch];
    } else {
      out += ch;
    }
  }
  // Kalan aksanlı harfleri (é, à, ñ ...) NFKD ile ayrıştırıp aksan işaretini at.
  out = out.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  // Hâlâ ASCII yazdırılabilir aralık (0x20-0x7E) dışında kalan HER karakter
  // (emoji, diğer alfabeler...) '_' olur. Ayrıca quoted-string'i kıracak
  // " ve \ karakterleri de temizlenir.
  out = out.replace(/["\\]/g, '_').replace(/[^\x20-\x7E]/g, '_');
  return out;
}

/**
 * @param {string} fileName - gerçek (Unicode olabilecek) dosya adı.
 * @param {string} [disposition='attachment'] - 'attachment' veya 'inline'.
 * @returns {string} - `res.setHeader('Content-Disposition', ...)` için GÜVENLİ değer.
 */
function buildContentDisposition(fileName, disposition = 'attachment') {
  const asciiFallback = toAsciiFallback(fileName);
  const encoded = encodeURIComponent(String(fileName));
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

module.exports = { buildContentDisposition, toAsciiFallback };
