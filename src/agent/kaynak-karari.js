'use strict';

/**
 * KAYNAK KARARI — exe'siz sözleşme (Nadir 01.10.2026, ONAYLI).
 *
 * Sözleşme: book-update `.claude/docs/exesiz-kaynak-sozlesmesi.md` — "İmpark exe'si HİÇBİR
 * koşulda indirilmez (ne Windows aktarımı ne paket kaynağı)". Runner'ın kaynağı TEK yerden,
 * bu SAF fonksiyondan seçilir; sıra:
 *
 *   0. R2 (Dalga B, sözleşme §5): claim `kaynakTuru` `r2-al` → hazır build R2'den, olduğu gibi;
 *      `r2-kur` → bu ajan kurar (taban R2/arşiv + merdiven + set eki) ve R2'ye yazar. `r2Karari`.
 *      Bu türlerde `downloadUrl` hiç manuel sayılmaz.
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

const { girisleriTemizle } = require('./icerik-kapisi');

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

/** Dalga B R2 türleri (`r2-kur` / `r2-al`) — build R2'nin `kaynak/<setId>/<sürüm>/build.zip`'idir. */
const R2_TURLERI = Object.freeze(['r2-kur', 'r2-al']);
const r2TuruMu = (job) => R2_TURLERI.includes(kaynakTuruOku(job));

/**
 * İşin MANUEL kaynak URL'si; manuel değilse null. SAF.
 * @param {{downloadUrl?: string, kaynakTuru?: string}} job
 * @returns {string|null}
 */
function manuelKaynakUrl(job) {
  if (!job || typeof job !== 'object') return null;
  const url = typeof job.downloadUrl === 'string' ? job.downloadUrl.trim() : '';
  if (!url || exeYoluMu(url)) return null;
  const tur = kaynakTuruOku(job);
  // R2 türlerinde `downloadUrl` YOKTUR (sözleşme); olsa bile manuel sayılmaz — kaynak R2 build'idir.
  if (R2_TURLERI.includes(tur)) return null;
  if (tur === 'manuel') return url;
  // Sunucu sözleşmesi (book-update ajan-kaynak-turu.ts nextJobKaynakSemasi): 'arsiv-gerekli'
  // claim'inde manuel kaynak YOKTUR — adres (olsa bile) indirilmez.
  if (tur === 'arsiv-gerekli') return null;
  const yol = yolKismi(url);
  return MANUEL_YOL_ISARETLERI.some((i) => yol.includes(i)) ? url : null;
}

/**
 * Kaynak kararı. SAF — I/O yok.
 * @param {{ job: object, arsiv?: object|null }} p  arsiv: `arsivKaynagi` dönüşü (yoksa null)
 * R2 türleri (`r2-al` / `r2-kur`) `r2Karari`'na gider (aşağıda).
 * @returns {{ tur: 'manuel', url: string, merdiven: false, setEki: false }
 *   | { tur: 'arsiv', arsiv: object, merdiven: true, setEki: true }
 *   | { tur: 'yok', sebep: string, merdiven: false, setEki: false }}
 *   merdiven/setEki: bu kaynakta içerik merdiveni / set üyeliği eki UYGULANABİLİR Mİ (kendi
 *   bayrakları ayrıca açık olmalı — bu alan yalnız kaynağın izin verip vermediğini söyler).
 */
function kaynakKarari({ job, arsiv = null, uretec = false } = {}) {
  if (r2TuruMu(job)) return r2Karari(job, arsiv, uretec);
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

const SURUM_RE = /^2\.\d+\.\d+$/;
const SHA_RE = /^[0-9a-f]{64}$/;

/**
 * Dalga B (B4) — `r2-al` / `r2-kur` kararı. SAF.
 *   r2-al   : hazır build `kaynakUrl`'den (imzalı GET) indirilir, sha256 + boyut doğrulanır,
 *             OLDUĞU GİBİ kullanılır — merdiven ve set eki YOK (merdiven/setEki false).
 *   r2-kur  : build BU ajan kurar. Taban: `tabanUrl` (önceki geçerli R2 build) varsa o, yoksa Mac
 *             kaynak arşivi; üstüne merdiven + set eki (mevcut zincir), sonra yazma kapısı → R2.
 *             Taban yoksa `uretec` açıkken taban 'uretec' (index üreteci kurar), kapalıyken 'yok' (§6a BEKLER) — `r2Kur: true` çağırana kurma kilidini bıraktırır.
 *   gecersiz: claim sözleşme dışı (`job.kaynakGecersiz`, parseNextJob doldurur) ya da zorunlu alan
 *             eksik — hiçbir şey indirilmez, iş görünür hatayla düşer.
 */
function r2Karari(job, arsiv, uretec = false) {
  const tur = kaynakTuruOku(job);
  const gecersiz = (neden) => ({
    tur: 'gecersiz', sebep: `claim sözleşme dışı (${tur}): ${neden}`, merdiven: false, setEki: false,
    r2Kur: tur === 'r2-kur',
  });
  if (job.kaynakGecersiz) return gecersiz(job.kaynakGecersiz);
  const surum = job.kaynakSurumu;
  if (typeof surum !== 'string' || !SURUM_RE.test(surum)) return gecersiz('kaynakSurumu yok/biçim dışı');
  if (tur === 'r2-al') {
    const url = typeof job.kaynakUrl === 'string' ? job.kaynakUrl : '';
    if (!url || exeYoluMu(url)) return gecersiz('kaynakUrl yok ya da .exe');
    if (!SHA_RE.test(String(job.kaynakSha256 || ''))) return gecersiz('kaynakSha256 yok');
    if (!Number.isSafeInteger(job.kaynakBoyut) || job.kaynakBoyut <= 0) return gecersiz('kaynakBoyut yok');
    return {
      tur: 'r2-al', url, sha256: job.kaynakSha256, boyut: job.kaynakBoyut, surum, merdiven: false, setEki: false,
    };
  }
  const ortak = { tur: 'r2-kur', surum, kurulumBitis: job.kurulumBitis || null, merdiven: true, setEki: true };
  if (job.tabanUrl) {
    if (exeYoluMu(job.tabanUrl)) return gecersiz('tabanUrl .exe');
    if (!SHA_RE.test(String(job.tabanSha256 || ''))) return gecersiz('tabanUrl var, tabanSha256 yok');
    return { ...ortak, taban: { tur: 'r2', url: job.tabanUrl, sha256: job.tabanSha256 } };
  }
  const isSet = job && (job.setKimligi != null || (typeof job.setListesi === 'string' && job.setListesi.includes('|')));
  if (arsiv && typeof arsiv === 'object' && arsiv.zip) {
    if (arsiv.iceriksiz && isSet && uretec) {
      // arsiv içeriksiz ve set ise üretece düşer
    } else {
      return { ...ortak, taban: { tur: 'arsiv', arsiv } };
    }
  }
  // INDEX ÜRETECİ (02.10, şef kararı): taban yoksa build'i üreteç kurar (Web-Z listesi + ZKitapZipH +
  // aynı kurumun arşiv motoru) — r2-kur'un kaynak adımı; zincirin kalanı aynen. Kapalıysa §6a BEKLER.
  if (uretec) return { ...ortak, taban: { tur: 'uretec' } };
  return {
    tur: 'yok', sebep: `${KAYNAK_YOK_SEBEBI} (r2-kur: taban yok — tabanUrl yok, arşivde kayıt yok)`,
    merdiven: false, setEki: false, r2Kur: true,
  };
}

/**
 * Bu iş için Mac kaynak arşivi (doğrulamalı `arsivKaynagi`) OKUNUR mu? Manuel işte, `r2-al`'de
 * (arşiv orada önbellektir, `r2Onbellek` ile ayrı okunur) ve `tabanUrl`'li `r2-kur`'da OKUNMAZ —
 * bozuk bir arşiv kaydı bu kaynakları düşürmesin. SAF.
 */
function arsivOkunurMu(job) {
  if (manuelKaynakUrl(job)) return false;
  const tur = kaynakTuruOku(job);
  if (tur === 'r2-al') return false;
  if (tur === 'r2-kur' && job && job.tabanUrl) return false;
  return true;
}

/**
 * Manuel zip'in giriş listesinden biçim kararı. SAF. Finder artıkları (`__MACOSX/`, `._*`,
 * `.DS_Store`) karara girmez (icerik-kapisi `girisleriTemizle`).
 *   'kok'          : zip kökü doğrudan build'dir (sözleşme M1 — varsayılan; SFX DEĞİL, unrar/7z ile
 *                    `resources/app/build` ARANMAZ).
 *   'eski-kurulum' : içinde `resources/app/build/` olan Windows kurulum ağacı (eski 59480 tipi
 *                    Set menüsü zip'i) — açılıp o dizin build.zip yapılır (bugünkü çıkarma yolu
 *                    `findBuildDir` ile uyum).
 *   'sarmalayici'  : kökte build yok, tüm girişler TEK klasör altında (Finder ile klasör sıkıştırma)
 *                    — açılıp o klasör build.zip yapılır.
 * `temizle`: zip'te macOS artığı var — 'kok' olsa bile açılıp artıksız yeniden paketlenir.
 * @param {string[]} girisler zip giriş adları
 * @returns {{ bicim: 'kok'|'eski-kurulum'|'sarmalayici', temizle: boolean, kokKlasor?: string }}
 */
function manuelZipBicimi(girisler) {
  const ham = Array.isArray(girisler) ? girisler.map((g) => String(g).replace(/\\/g, '/')).filter(Boolean) : [];
  const liste = girisleriTemizle(ham);
  const temizle = liste.length !== ham.length;
  if (liste.some((g) => /(^|\/)resources\/app\/build\//.test(g))) return { bicim: 'eski-kurulum', temizle };
  const kokler = new Set(liste.map((g) => g.split('/')[0]).filter(Boolean));
  const kokteBuild = liste.some((g) => /^(index\.html$|assets\/|book\d+\/)/i.test(g));
  if (!kokteBuild && kokler.size === 1 && liste.some((g) => g.includes('/'))) {
    return { bicim: 'sarmalayici', temizle, kokKlasor: [...kokler][0] };
  }
  return { bicim: 'kok', temizle };
}

module.exports = {
  R2_TURLERI,
  r2TuruMu,
  arsivOkunurMu,
  KAYNAK_YOK_SEBEBI,
  EXE_KAYNAGI_KAPALI,
  MANUEL_YOL_ISARETLERI,
  manuelKaynakUrl,
  kaynakKarari,
  manuelZipBicimi,
  exeYoluMu,
};
