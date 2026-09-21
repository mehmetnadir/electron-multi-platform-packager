'use strict';

/**
 * Sayfa WebP kapısı AÇIKKEN üretim başında basılan GÖRÜNÜR uyarı.
 *
 * NEDEN (2026-09-21, ölçüldü): `EMPP_SAYFA_WEBP=1`, ProBook kabul kapısından
 * (sayfa + büyüteç + canvas) hiç geçmemiş bir özelliği sessizce üretime karıştırdı —
 * elle başlatılmış bir test süreci bu env değişkeniyle ayakta kaldı, hiçbir günlüğe
 * "webp açık" yazmadan port 3001'i devraldı ve 14 örnekten 11'i sessizce WebP'ye
 * döndü. Sessiz açık kapı arızanın ta kendisiydi — bundan sonra kapı her açık
 * bulunduğunda bunu SÖYLER, susmaz.
 *
 * Saf fonksiyon: yan etkisi yok, günlüğe YAZMAZ — çağıran (`sayfa-webp.js`) kendi
 * mevcut `log` deseniyle basar.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string> | null | undefined} env
 * @returns {string|null} kapı kapalıysa `null`, açıksa uyarı metni
 */
function uyariMetni(env) {
  if (!env || env.EMPP_SAYFA_WEBP !== '1') return null;
  return 'UYARI: sayfa WebP dönüşümü AÇIK (EMPP_SAYFA_WEBP=1) — ProBook kabul kapısından ' +
    'geçmemiş bir özellik üretime karışıyor';
}

module.exports = { uyariMetni };
