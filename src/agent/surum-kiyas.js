'use strict';

/**
 * @fileoverview Sürüm Kıyaslama Modülü — SAF (fs/ağ/IO yok).
 *
 * NEDEN VAR (2026-09-21, regresyon önleme):
 * `surum-normallestir.js` + `publisher-update.js` düzeltmesi `version.txt`'i
 * 3 parçaya normalleştiriyor ("1.13.1.3" → "1.13.1"). Bu düzeltme ETKİN
 * OLDUĞUNDA, `runner.js` içindeki kaynak önbelleği bayatlık kontrolü
 * (`cachedZipIsStale`) şu kıyası yapar:
 *
 *     isNewer('1.13.1', '1.13.1.3')   // publisher-update.js:29-33
 *
 * Eski `isNewer` "iki taraf da 3 parça DEĞİLSE string olarak farklıysa YENİ"
 * der. 3 ≠ 4 olduğu için karşılaştırma string'e düşer, "1.13.1" !== "1.13.1.3"
 * → **her işte `source cache STALE`** → her işte ~1 GB kaynak yeniden indirilir
 * ve çıkarılır. Yani müşterinin 350 MB'lık tekrar indirmesini keserken kendi
 * paketleme hattımıza her işte 1 GB bindirmiş oluruz.
 *
 * TEMEL KURAL: **Normalleştirme sürümü DEĞİŞTİRMEZ, yalnız biçimini düzeltir.**
 * Dolayısıyla 4 parçalı bir sürüm ile onun 3 parçalı normalleştirilmiş hâli
 * AYNI sürümdür: `1.13.1.3` ≡ `1.13.1`.
 *
 * İKİ KIYAS KİPİ (bilinçli):
 *  1. **Aynı parça sayısı** → tüm parçalar sayısal kıyaslanır. Bu, düzeltme
 *     öncesi dünyayı (4-parça vs 4-parça: "1.13.1.3" vs "1.13.1.4") olduğu
 *     gibi korur; 4. parçadaki gerçek bir ilerleme hâlâ "daha yeni" sayılır.
 *  2. **Farklı parça sayısı** → yalnız KANONİK ilk 3 parça kıyaslanır (eksikse
 *     0 ile tamamlanır). Normalleştirme 3 parçaya kırptığı için 3. parçadan
 *     sonrasını karşılaştırmak, var olmayan bir bilgiye dayanmak demektir.
 *
 * KABUL EDİLEN BEDEL: `1.13.1.3` ile `1.13.1.5` de aynı sayılır (ikisinin de
 * kanonik hâli `1.13.1`). Bu bir kayıp değil, normalleştirmenin doğal sonucu —
 * `version.txt` zaten `1.13.1` yazdığı için paketleyicinin elinde o 4. parçayı
 * ayırt edecek bilgi YOKTUR. Belirsizlikte yön, tahmin üretmek değil
 * fail-safe'tir: yeniden indirme değil, önbelleği koru.
 *
 * FAIL-SAFE: Ayrıştırılamayan (undefined/null/boş/harf içeren/negatif) girdide
 * ASLA "daha yeni" denmez — `dahaYeniMi` false, `ayniSurumMu` false döner.
 * Sessiz bir tahmin, 1 GB'lık bir yeniden indirmeden daha pahalıdır.
 *
 * TİP BELİRSİZLİĞİ (bu depo TS değil, JS): girdiler dış dünyadan gelir —
 * `unzip -p version.txt` çıktısı (string, boş olabilir), zip dosya adı
 * (string) veya hiç okunamamış bir değer (undefined). Bu yüzden her genel
 * fonksiyon `unknown` kabul eder ve `typeof` ile daraltır; çağıranın tip
 * garantisi verdiği varsayılmaz.
 */

/** Kanonik kıyas derinliği — normalleştirme 3 parçaya kırpar. */
const KANONIK_PARCA = 3;

/**
 * Ham sürüm girdisini sayı dizisine çevirir.
 *
 * Kabul: yalnız string; trim edilir; her parça `^\d+$` olmalı (baştaki sıfırlar
 * serbest — "1.09.0" → [1, 9, 0], yani sayısal kıyaslanır, string değil).
 * Reddeder: string olmayan (undefined/null/number/object), boş, boş parçalı
 * ("1..2", "1."), harf/işaret içeren ("v1.2.3", "1.2.3-beta", "-1.2.3").
 *
 * @param {unknown} ham - Ayrıştırılacak ham sürüm girdisi.
 * @returns {number[]|null} Sayı dizisi; ayrıştırılamazsa null.
 */
function parcalara(ham) {
  if (typeof ham !== 'string') return null;
  const temiz = ham.trim();
  if (!temiz) return null;
  const parcalar = temiz.split('.');
  const sayilar = [];
  for (let i = 0; i < parcalar.length; i++) {
    if (!/^\d+$/.test(parcalar[i])) return null;
    const n = parseInt(parcalar[i], 10);
    if (!Number.isFinite(n)) return null;
    sayilar.push(n);
  }
  return sayilar;
}

/**
 * Diziyi kanonik derinliğe (3) getirir: fazlasını atar, eksiğini 0'la doldurur.
 *
 * @param {number[]} parcalar
 * @returns {number[]}
 */
function kanoniklestir(parcalar) {
  const sonuc = parcalar.slice(0, KANONIK_PARCA);
  while (sonuc.length < KANONIK_PARCA) sonuc.push(0);
  return sonuc;
}

/**
 * İki sürümü kıyaslar.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number|null} a<b ise -1, a>b ise 1, eşitse 0; taraflardan biri
 *   ayrıştırılamazsa null (karar verilemez — çağıran fail-safe davranmalı).
 */
function kiyasla(a, b) {
  const pa = parcalara(a);
  const pb = parcalara(b);
  if (pa === null || pb === null) return null;

  // Kip 1: aynı parça sayısı → tam derinlikte kıyas (4v4 davranışı korunur).
  // Kip 2: farklı parça sayısı → yalnız kanonik ilk 3 parça (normalleştirme
  //        eşdeğerliği: "1.13.1.3" ≡ "1.13.1").
  const sol = pa.length === pb.length ? pa : kanoniklestir(pa);
  const sag = pa.length === pb.length ? pb : kanoniklestir(pb);

  for (let i = 0; i < sol.length; i++) {
    if (sol[i] < sag[i]) return -1;
    if (sol[i] > sag[i]) return 1;
  }
  return 0;
}

/**
 * İki sürüm aynı sürüm mü? (`1.13.1.3` ≡ `1.13.1` → true)
 *
 * Ayrıştırılamayan girdide false döner — "bilmiyorum" ile "aynı" karıştırılmaz.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function ayniSurumMu(a, b) {
  return kiyasla(a, b) === 0;
}

/**
 * `aday`, `mevcut`'tan kesin olarak daha yeni mi?
 *
 * FAIL-SAFE: eşitlikte, geri gidişte ve ayrıştırılamayan girdide false.
 * "Emin değilsem yeni deme" — yanlış true, her işte ~1 GB yeniden indirme
 * demektir.
 *
 * @param {unknown} mevcut - Elimizdeki sürüm (ör. önbellekteki version.txt).
 * @param {unknown} aday - Karşılaştırılan sürüm (ör. yerel güncelleme zip adı).
 * @returns {boolean}
 */
function dahaYeniMi(mevcut, aday) {
  return kiyasla(mevcut, aday) === -1;
}

module.exports = {
  KANONIK_PARCA,
  parcalara,
  kanoniklestir,
  kiyasla,
  ayniSurumMu,
  dahaYeniMi,
};
