'use strict';
/**
 * ANDROID ÇEVRİMİÇİ YOKLAMASI — derleme anı kapısı (2026-09-26, webview-ag bulgusu, paket 74451).
 *
 * NEDEN: İmpark motoru açılışta bir kez `fetch(baseEndpointUrl, {method:'HEAD', mode:'no-cors'})`
 * ile `window.isOnline`ı hesaplar. Yayıncı kökü (besegitim.com, mec.yayincilik.net, sorucoz.tv)
 * Cloudflare challenge 403 + `Cross-Origin-Resource-Policy: same-origin` döner: CapacitorHttp köprüsü
 * gövdesiz HEAD 403'ü ağ hatasına çevirir, WebView'in kendi fetch'i de CORP yüzünden reddeder → ağ
 * varken isOnline=false → güncelleme sorusu ve çevrimiçi aktivasyon "Network is offline" ile kesilir
 * (Electron'da webSecurity:false, etkilenmez). Düzeltme `empp-android-shim.js` içinde (installFetch):
 * yalnız bu yoklama yerel CapacitorHttp eklentisine GET olarak sorulur (herhangi bir HTTP cevabı =
 * çevrimiçi, ağ hatası = çevrimdışı). Bu modül o düzeltmenin KAPISIDIR.
 *
 * KAPI: varsayılan KAPALI. `EMPP_ANDROID_CEVRIMICI=1` ile derlenen APK'da shim'deki kapı satırı
 * `true` yapılır. Kapalıyken shim BİREBİR kopyalanır (eski `fs.copy` davranışı, bayt bayt aynı).
 * Açıkken kapı satırı shim'de tam bir kez bulunamazsa `shimMetni` fırlatır; `shimKopyala` ise
 * shim'i DÜŞÜRMEZ (çağıranın catch'i shim'siz APK üretirdi): özgün shim'i koyar + `console.error`.
 * Satırın varlığı `cevrimici-yoklama.test.js` ile kilitli.
 */
const path = require('path');
const fs = require('fs-extra');

const SHIM_YOLU = path.join(__dirname, 'empp-android-shim.js');
const KAPI_SATIRI = 'var CEVRIMICI_YOKLAMA = false; // EMPP_ANDROID_CEVRIMICI';
const ACIK_SATIRI = 'var CEVRIMICI_YOKLAMA = true; // EMPP_ANDROID_CEVRIMICI=1';

/** Kapı açık mı? Yalnız tam `'1'` açar. Saf. */
function acikMi(env = process.env) {
  return String((env && env.EMPP_ANDROID_CEVRIMICI) || '') === '1';
}

/**
 * Shim metnini kapıya göre üretir. Saf.
 * @param {string} kaynak shim kaynağı
 * @param {boolean} acik
 * @returns {string}
 */
function shimMetni(kaynak, acik) {
  if (!acik) return kaynak;
  const adet = kaynak.split(KAPI_SATIRI).length - 1;
  if (adet !== 1) {
    throw new Error(`EMPP_ANDROID_CEVRIMICI=1 ama shim kapı satırı ${adet} kez bulundu (beklenen 1): ${KAPI_SATIRI}`);
  }
  return kaynak.replace(KAPI_SATIRI, ACIK_SATIRI);
}

/**
 * `empp-android-shim.js`'i hedefe koyar. Kapalıyken `fs.copy` (eski davranış), açıkken yazar.
 * @param {string} hedef
 * @param {{env?: object, kaynakYolu?: string, log?: Function}} [o]
 * @returns {Promise<{acik: boolean, hata?: string}>}
 */
async function shimKopyala(hedef, o = {}) {
  const kaynakYolu = o.kaynakYolu || SHIM_YOLU;
  const acik = acikMi(o.env || process.env);
  if (!acik) {
    await fs.copy(kaynakYolu, hedef);
    return { acik };
  }
  const kaynak = await fs.readFile(kaynakYolu, 'utf8');
  let metin;
  try {
    metin = shimMetni(kaynak, true);
  } catch (e) {
    console.error(`❌ ${e.message} — shim KAPALI kapıyla kondu: ${hedef}`);
    await fs.writeFile(hedef, kaynak);
    return { acik: false, hata: e.message };
  }
  await fs.writeFile(hedef, metin);
  (o.log || console.log)(`🌐 EMPP_ANDROID_CEVRIMICI=1 — shim çevrimiçi yoklaması açık: ${hedef}`);
  return { acik };
}

module.exports = { SHIM_YOLU, KAPI_SATIRI, ACIK_SATIRI, acikMi, shimMetni, shimKopyala };
