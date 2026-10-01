'use strict';

/**
 * KAYNAK KARARI — exe'siz sözleşme (Nadir 01.10.2026, ONAYLI).
 *
 * Sözleşme: book-update `.claude/docs/exesiz-kaynak-sozlesmesi.md` — "İmpark exe'si HİÇBİR
 * koşulda indirilmez (ne Windows aktarımı ne paket kaynağı)". Runner'ın kaynağı TEK yerden,
 * bu SAF fonksiyondan seçilir; sıra:
 *
 *   1. MANUEL build (sözleşme §7 M1): claim `kaynakTuru === 'manuel'` ya da `downloadUrl`
 *      yolunda `/sources/` (Set menüsü / "Yeni İş" yüklemesi, book-update
 *      `agent-source-upload.ts isManualSourceUrl`) veya `/kaynak/` (sözleşme §5 R2 yeri
 *      `kaynak/<setId>/<sürüm>/build.zip`). O URL'den build.zip İNDİRİLİR; build OLDUĞU GİBİ
 *      kullanılır — içerik merdiveni ve set üyeliği eki ATLANIR (M1: "İmpark'a kitap sürümü
 *      sorulmaz, merdiven/set eki uygulanmaz").
 *   2. ARŞİV: `kaynak-arsivi.js` kaydı varsa bugünkü davranış (arşiv + merdiven + set eki).
 *   3. YOK: hiçbir şey indirilmez → kira bırakılır (sunucu işi sona atar + ajan dışlama
 *      backoff'u), görünür bildirim, `failed` YAZILMAZ (sözleşme §6a "üretim BEKLER").
 *
 * Exe güvenliği: manuel URL'nin YOLU `.exe` ile bitiyorsa manuel SAYILMAZ (`/sources/` altında
 * bile) — o bir exe'dir; "hiçbir koşulda" kuralı yol adıyla delinemez. Eski 59480 tipi
 * "içinde Windows kurulum ağacı olan zip" manueldir (uzantı .zip); çıkarma runner'da.
 *
 * I/O YOK: arşiv kaydı çağıran tarafından (`arsivKaynagi`) okunup verilir. Manuel karar arşivden
 * ÖNCE verildiği için `manuelKaynakUrl(job)` ayrı dışa açıktır — manuel işte arşiv okunmaz
 * (bozuk bir arşiv kaydı manuel kaynağı düşürmesin).
 */

const KAYNAK_YOK_SEBEBI = 'build yok — exe\'siz sözleşme: arşiv/manuel kaynak gerekli';

/**
 * Exe ısıtma / exe girdili araçların KAPI metni (kaynak-isitici.js, isitici-dongu.js, local-build.js).
 * Modüller silinmedi; giriş noktalarında bu kapıyla devre dışıdır. Açan anahtar YOK (sözleşme
 * "hiçbir koşulda").
 */
const EXE_KAYNAGI_KAPALI = 'exe\'siz sözleşme (Nadir 01.10): İmpark exe\'si kaynak olarak indirilmez/kullanılmaz '
  + '— exe ısıtma/derleme KAPALI; kaynak = arşiv ya da manuel build.zip';

/** Manuel kaynak yol işaretleri (yol parçası olarak aranır, sorgu dizesinde DEĞİL). */
const MANUEL_YOL_ISARETLERI = ['/sources/', '/kaynak/'];

/** URL'nin sorgu/hash'siz yol kısmı (presigned imza `?X-Amz-...` yolu kirletmesin). */
function yolKismi(url) {
  return String(url == null ? '' : url).split(/[?#]/)[0];
}

/** Yol `.exe` ile mi bitiyor? (büyük/küçük harf duyarsız) */
function exeYoluMu(url) {
  return /\.exe$/i.test(yolKismi(url).replace(/\/+$/, ''));
}

function kaynakTuruOku(job) {
  return job && typeof job.kaynakTuru === 'string' ? job.kaynakTuru.trim().toLowerCase() : '';
}

/**
 * İşin MANUEL kaynak URL'si; manuel değilse null. SAF.
 * @param {{downloadUrl?: string, kaynakTuru?: string}} job
 * @returns {string|null}
 */
function manuelKaynakUrl(job) {
  if (!job || typeof job !== 'object') return null;
  const url = typeof job.downloadUrl === 'string' ? job.downloadUrl.trim() : '';
  if (!url || exeYoluMu(url)) return null;
  if (kaynakTuruOku(job) === 'manuel') return url;
  const yol = yolKismi(url);
  return MANUEL_YOL_ISARETLERI.some((i) => yol.includes(i)) ? url : null;
}

/**
 * Kaynak kararı. SAF — I/O yok.
 * @param {{ job: object, arsiv?: object|null }} p  arsiv: `arsivKaynagi` dönüşü (yoksa null)
 * @returns {{ tur: 'manuel', url: string, merdiven: false, setEki: false }
 *   | { tur: 'arsiv', arsiv: object, merdiven: true, setEki: true }
 *   | { tur: 'yok', sebep: string, merdiven: false, setEki: false }}
 *   merdiven/setEki: bu kaynakta içerik merdiveni / set üyeliği eki UYGULANABİLİR Mİ (kendi
 *   bayrakları ayrıca açık olmalı — bu alan yalnız kaynağın izin verip vermediğini söyler).
 */
function kaynakKarari({ job, arsiv = null } = {}) {
  const url = manuelKaynakUrl(job);
  if (url) return { tur: 'manuel', url, merdiven: false, setEki: false };
  if (arsiv && typeof arsiv === 'object' && arsiv.zip) {
    return { tur: 'arsiv', arsiv, merdiven: true, setEki: true };
  }
  const sebep = kaynakTuruOku(job) === 'manuel'
    ? `${KAYNAK_YOK_SEBEBI} (claim kaynakTuru=manuel ama geçerli build.zip adresi yok)`
    : KAYNAK_YOK_SEBEBI;
  return { tur: 'yok', sebep, merdiven: false, setEki: false };
}

/**
 * Manuel zip'in giriş listesinden biçim kararı. SAF.
 *   'kok'          : zip kökü doğrudan build'dir (sözleşme M1 — varsayılan; SFX DEĞİL, unrar/7z ile
 *                    `resources/app/build` ARANMAZ).
 *   'eski-kurulum' : içinde `resources/app/build/` olan Windows kurulum ağacı (eski 59480 tipi
 *                    Set menüsü zip'i) — açılıp o dizin build.zip yapılır (bugünkü çıkarma yolu
 *                    `findBuildDir` ile uyum).
 * @param {string[]} girisler zip giriş adları
 * @returns {'kok'|'eski-kurulum'}
 */
function manuelZipBicimi(girisler) {
  const liste = Array.isArray(girisler) ? girisler.map((g) => String(g).replace(/\\/g, '/')) : [];
  return liste.some((g) => /(^|\/)resources\/app\/build\//.test(g)) ? 'eski-kurulum' : 'kok';
}

module.exports = {
  KAYNAK_YOK_SEBEBI,
  EXE_KAYNAGI_KAPALI,
  MANUEL_YOL_ISARETLERI,
  manuelKaynakUrl,
  kaynakKarari,
  manuelZipBicimi,
  exeYoluMu,
};
