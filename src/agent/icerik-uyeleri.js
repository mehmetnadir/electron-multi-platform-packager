'use strict';

/**
 * PAKET İÇERİK ÜYELERİ (05.10): paketleyiciye giden SON build zip'inin menüsünden "pakete hangi
 * İmpark kitabı hangi içerik sürümüyle girdi" listesi — `/result` gövdesine `icerikUyeleri`
 * ([{id, vs, kitap}]) + `icerikUyeleriKaynak: "menu"` olarak yazılır; sunucu "paketin içindeki
 * sürüm ↔ İmpark DB" karşılaştırmasını bununla yapar.
 *
 * Tek kaynak: menü konumları `icerik-merdiven.menuKonumlari`, çözme/kapak `runtime/icerik-guncelleme`.
 * Saf okuma; hiçbir koşulda FIRLATMAZ (ölçüm paketi durdurmaz). Ölçülemezse alan gövdeye girmez.
 */

const ig = require('../runtime/icerik-guncelleme');
const merdiven = require('./icerik-merdiven');

/** Sözleşme tavanı: gövdede en çok bu kadar öğe. */
const TAVAN = 500;
const KAYNAK = 'menu';

/**
 * @param {string} zipYolu
 * @returns {{uyeler: Array<{id:string, vs:number, kitap:string}>, atlanan:number, menuSayisi:number,
 *            hata?:string}}
 */
function zipIcerikUyeleri(zipYolu) {
  try {
    const dizin = merdiven.zipDizini(zipYolu);
    const { konumlar } = merdiven.menuKonumlari(dizin.keys());
    const gorulen = new Set();
    const uyeler = [];
    let atlanan = 0;
    for (const { kitap, kok } of konumlar) {
      const ad = `${kok}${ig.MENU_GORELI}`;
      let xml = null;
      try { xml = ig.menuCoz(merdiven.zipGirdiOku(zipYolu, dizin.get(ad))); } catch (_) { xml = null; }
      if (!xml) return { uyeler: [], atlanan: 0, menuSayisi: konumlar.length, hata: `menü çözülemedi: ${ad}` };
      for (const c of ig.kapaklar(xml)) {
        const vs = c.version;
        // İçeriği zip'te olmayan kapak pakete girmemiştir (xmlSource yok ya da dosyası yok):
        // üye sayılmaz.
        const xs = (/\sxmlSource="([^"]*)"/.exec(c.etiket) || [])[1];
        const icerikVar = Boolean(xs) && dizin.has(`${kok}${xs.replace(/^\/+/, '')}`);
        // Kimlik İmpark kitabı değilse (0/boş/sayısal değil), version yoksa/tam sayı ≥0 değilse: atla.
        if (!icerikVar || !merdiven.imparkKimligiMi(c.ID) || vs == null || !Number.isInteger(vs)
          || vs < 0 || gorulen.has(c.ID) || uyeler.length >= TAVAN) {
          atlanan += 1;
          continue;
        }
        gorulen.add(c.ID);
        uyeler.push({ id: String(c.ID), vs, kitap });
      }
    }
    return { uyeler, atlanan, menuSayisi: konumlar.length };
  } catch (e) {
    return { uyeler: [], atlanan: 0, menuSayisi: 0, hata: String((e && e.message) || e) };
  }
}

/** `/result` gövdesine yayılacak alanlar; ölçüm yok/boşsa `{}` (boş dizi ASLA gönderilmez). */
function govdeAlanlari(sonuc) {
  const u = sonuc && Array.isArray(sonuc.uyeler) ? sonuc.uyeler : [];
  return u.length ? { icerikUyeleri: u, icerikUyeleriKaynak: KAYNAK } : {};
}

module.exports = { zipIcerikUyeleri, govdeAlanlari, TAVAN, KAYNAK };
