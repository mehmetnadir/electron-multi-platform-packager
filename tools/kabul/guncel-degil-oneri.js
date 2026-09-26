'use strict';
/**
 * GÜNCEL-DEĞİL "yeniden kuyruk önerisi" metni — TEK KAYNAK (Nadir 26.09).
 *
 * NEDEN: aynı metin üç ayrı yerde kopyalanmıştı — tools/pardus/cdp-kitap-ac.js (E7Özetle),
 * tools/kabul/set-guncellik.js (SET_TUM) ve tools/kabul/k4-guncellik.js (K4 örtü karşılaştırması).
 * Fan-out sapması riski: biri güncellenip ötekiler unutulabilir (bkz. gate-system.md "Görünürlük
 * Gate" §2 — aynı olayı N çağıran ayrı ayrı listelemek). Kaynak: içerik merdiveni canlıya
 * alındıktan (EMPP_ARSIV_MERDIVEN=1, src/agent/icerik-merdiven.js S0/S1) sonra eski metin bayat
 * kaldı: "aynı kaynakla yeniden üretim aynı sonucu verir" diyordu, oysa merdiven açıkken S1 AYNI
 * build zip'ten İmpark'ın YENİ sürümünü üretir — bir sonraki kuyruk denemesi farklı sonuç verir.
 * Rapor: ~/.empp-agent/arastirma/guncel-degil-yeniden-kuyruk-onerisi-20260926.md §1, §6.
 *
 * Karar sözlüğü / karar mantığı DEĞİŞMEDİ — yalnız bu metin, merdiven durumuna göre iki hâl:
 *   AÇIK (EMPP_ARSIV_MERDIVEN=1)   → yeniden kuyruk artık işe yarar (S1 yeni sürümü getirir);
 *                                     aynı kaynak + alt kitap sürümleriyle ikinci RED insan ister.
 *   KAPALI (varsayılan)             → eski metin birebir korunur (davranış aynı).
 *
 * `merdivenAcik` src/agent/icerik-merdiven.js'in AYNISI — env okuma tek yerde, burada
 * tekrarlanmadı.
 */
const { merdivenAcik } = require('../../src/agent/icerik-merdiven');

/**
 * @param {Array<string>} zipYollari  "ZKitapZipH/<id>-<vs>.zip" biçiminde gösterilecek liste
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} kabul kararına eklenecek `oneri` metni
 */
function guncelDegilOneri(zipYollari = [], env = process.env) {
  const zipler = (zipYollari || []).filter(Boolean).join(', ');
  const govde = `kaynak S1 ile yenilenmeli (${zipler}); `;
  if (merdivenAcik(env)) {
    return `${govde}merdiven açık: ≥10 dk sonra yeniden kuyruğa almak yeter (S1 aynı build zip'ten `
      + `İmpark'ın yeni sürümünü getirir); aynı kaynak + alt kitap sürümleriyle ikinci RED → insan kararı`;
  }
  return `${govde}yeni build zip arşive girince yeniden kuyruğa al (İmpark web katmanı gecikmeli: Vs `
    + `tazeyse ≥10 dk sonra); aynı kaynakla yeniden üretim aynı sonucu verir`;
}

module.exports = { guncelDegilOneri };
