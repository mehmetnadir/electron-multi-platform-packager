'use strict';

/**
 * PLATFORM KAPSAMLI KAPI BAYRAKLARI — saf karar modülü (I/O yok; uyarı çağırana verilen
 * `uyar` ile basılır).
 *
 * NEDEN (2026-09-26, Windows paketleme sözleşmesi ONAYLI): kapı bayrakları GENELDİ — bir
 * bayrak açılınca mac, Pardus ve Android paketlerine de giriyordu. Onay yalnız Windows'u
 * kapsıyor; 25.09'da tam bu yüzden bir mac DMG'sine taslak modüller girdi ve geçersiz
 * sayıldı. Bu modül bayrağa platform kapsamı ekler.
 *
 * DEĞER BİÇİMİ (EMPP_ICERIK_GUNCELLEME, EMPP_SET_GUNCELLEME, EMPP_SAYFA_WEBP):
 *   tanımsız / boş  → bayrağın eski varsayılanı (değişmedi)
 *   `0`             → her platformda KAPALI
 *   `1`             → her platformda AÇIK
 *   başka her şey   → virgüllü platform listesi (`windows`, `windows,macos`; büyük/küçük harf
 *                     ve boşluk önemsiz). Kapı YALNIZ işin platformlarının HEPSİ listedeyse
 *                     açıktır. Neden hepsi: `paketeUygula` platform ayrımından ÖNCE ortak
 *                     `workingPath`'e uygulanıyor; karışık bir işte (windows+macos) açılırsa
 *                     mac çıktısına da sızar.
 * Tanınmayan ad (`win`, `mac`, `pardus`, `true`…) sessizce yok sayılmaz: görünür UYARI basılır
 * ve hiçbir işi eşlemez — şüphede KAPALI (yazım hatası tüm platformlarda açmasın).
 * İş bağlamı (platform dizisi) verilmeden sorulan kapsamlı kapı da KAPALI sayılır + UYARI.
 *
 * PLATFORM ADLARI: `packagingService.supportedPlatforms` ile BİREBİR (sözleşme testi:
 * platform-kapisi.test.js).
 */

const PLATFORMLAR = Object.freeze(['windows', 'macos', 'linux', 'android', 'pwa']);

/**
 * Ham bayrak değerini çözer. SAF.
 * @param {*} ham
 * @returns {{tip: 'varsayilan'|'kapali'|'acik'|'liste', platformlar: string[], bilinmeyen: string[]}}
 */
function degerCoz(ham) {
  const bos = { platformlar: [], bilinmeyen: [] };
  if (ham === undefined || ham === null) return { tip: 'varsayilan', ...bos };
  const s = String(ham).trim();
  if (s === '') return { tip: 'varsayilan', ...bos };
  if (s === '0') return { tip: 'kapali', ...bos };
  if (s === '1') return { tip: 'acik', ...bos };
  const parcalar = s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const platformlar = PLATFORMLAR.filter((p) => parcalar.includes(p));
  const bilinmeyen = [...new Set(parcalar.filter((p) => !PLATFORMLAR.includes(p)))];
  return { tip: 'liste', platformlar, bilinmeyen };
}

/**
 * Kapı bu iş için açık mı?
 * @param {string} ad bayrak adı (ör. 'EMPP_ICERIK_GUNCELLEME')
 * @param {Object} env ortam
 * @param {string[]|undefined} platforms işin platformları (`jobInfo.platforms`)
 * @param {boolean} varsayilanAcik bayrak tanımsızken kapı açık mı
 * @param {{uyar?: function(string): void}} [secenek]
 * @returns {boolean}
 */
function kapiAcikMi(ad, env, platforms, varsayilanAcik, { uyar = console.warn } = {}) {
  const e = (env && typeof env === 'object') ? env : {};
  const c = degerCoz(e[ad]);
  if (c.tip === 'varsayilan') return varsayilanAcik === true;
  if (c.tip === 'kapali') return false;
  if (c.tip === 'acik') return true;
  if (c.bilinmeyen.length) {
    uyar(`UYARI: ${ad} tanınmayan platform adı: ${c.bilinmeyen.join(', ')} — hiçbir işi `
      + `eşlemez (tanınanlar: ${PLATFORMLAR.join(', ')}); kapsam: ${c.platformlar.join(',') || 'yok'}`);
  }
  const is = Array.isArray(platforms) ? platforms : [];
  if (!is.length) {
    uyar(`UYARI: ${ad} platform kapsamlı (${c.platformlar.join(',') || 'yok'}) ama işin platformu `
      + 'verilmedi — kapı KAPALI sayıldı');
    return false;
  }
  return is.every((p) => c.platformlar.includes(p));
}

/**
 * Sağlık ucu (`/api/health` → `kapilar`) gösterimi. SAF, uyarı basmaz (her sağlık
 * sorgusunda günlük kirlenmesin). `0`/`1`/tanımsız → boolean (eski gösterim aynen);
 * kapsamlı değer → kanonik sıralı tanınan platform listesi dizgesi (`"windows"`,
 * `"windows,macos"`); tanınan ad yoksa `false` (hiçbir işte açılmaz). Ham değer taşınmaz:
 * dizgede yalnız sabit platform adları bulunur.
 * @returns {boolean|string}
 */
function kapiDurumu(ad, env, varsayilanAcik) {
  const e = (env && typeof env === 'object') ? env : {};
  const c = degerCoz(e[ad]);
  if (c.tip === 'varsayilan') return varsayilanAcik === true;
  if (c.tip === 'kapali') return false;
  if (c.tip === 'acik') return true;
  return c.platformlar.length ? c.platformlar.join(',') : false;
}

module.exports = { PLATFORMLAR, degerCoz, kapiAcikMi, kapiDurumu };
