'use strict';
/**
 * ATLANAN ÜYELER — kabul kapılarının "beklenen kitap" kümesinden düşülecek set üyeleri (Nadir 06.10:
 * "14835'i atlayarak devam et — böyle durumda atla ve rapor et").
 *
 * Üreteç kesin "içerik yok" kanıtıyla (İmpark 404 / Data boş) atladığı üyeleri build köküne
 * `empp-uretec.json` → `atlananUyeler` manifest alanıyla yazar (src/agent/uye-atla.js; ayrıştırma
 * `isaretAyristir` TEK KAYNAK). Kapılar bu listeyi okur:
 *   - SET_TUM (set-guncellik.js): atlanan kimlik ölçüm satırlarından düşer, nota girer (Data boş
 *     İmpark'ta "güncel" görünür, 404 "ölçülemedi" — ikisi de yanıltıcı olurdu).
 *   - menu-icerik / menu-kapak: atlanan üye "eksik" sayılmaz, sonuçta `atlananUyeler` + nota girer.
 *     Kartı menüde KALMIŞ atlanan üye yine RED'dir (atlama kartı menüden çıkarmak zorunda; kapı kör değil).
 * Manifest yoksa liste boş → kapılar birebir eski davranış.
 */
const uyeAtla = require('../../src/agent/uye-atla');

const ISARET_DOSYASI = uyeAtla.URETEC_ISARETI;

/**
 * Paket kökünden (okuyucu.oku(rel) → Buffer|null) atlanan üyeler. FIRLATMAZ.
 * @param {{oku:(rel:string)=>(Buffer|string|null)}|null} okuyucu
 * @returns {Array<{kitapId:string, ad:string, sebep:string}>}
 */
function atlananUyelerOku(okuyucu) {
  if (!okuyucu || typeof okuyucu.oku !== 'function') return [];
  let v = null;
  try { v = okuyucu.oku(ISARET_DOSYASI); } catch (_) { v = null; }
  return uyeAtla.isaretAyristir(v);
}

/** Kimlik kümesi. SAF. */
const kume = (liste) => new Set((liste || []).map((a) => String(a.kitapId)));

/** Tek satır not (kapı günlüğü). Liste boşsa ''. SAF. */
function notSatiri(liste) {
  if (!liste || !liste.length) return '';
  return `atlanan üye (manifest, beklenenden düşüldü): ${liste
    .map((a) => `${a.kitapId}${a.ad ? ` "${a.ad}"` : ''}${a.sebep ? ` — ${a.sebep}` : ''}`).join('; ')}`;
}

module.exports = { ISARET_DOSYASI, atlananUyelerOku, kume, notSatiri };
