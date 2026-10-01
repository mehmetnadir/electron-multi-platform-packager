'use strict';
// 2026-10-02 karantina: runner-helpers.js'ten çıkarıldı (üretimde çağıransız). Bkz. ../../OKU.md

/**
 * Kaynak cache'i (~/.empp-agent/cache, `<bookId>/<version>/build.zip`) bir toplam
 * bayt tavanını aşınca hangi girdilerin silineceğine karar verir (saf — IO yok).
 * `pruneSiblingVersions` yalnız AYNI kitabın eski sürümünü siler; bu fonksiyon
 * TÜM kitaplar arasında en eski kullanılanı (LRU) seçer — cache 2026-09-13'te
 * 35 GB'a ulaşınca eklendi.
 *
 * En eski `sonKullanim`'dan başlayarak toplam bayt tavanın ALTINA inene kadar
 * silinecekleri sırayla döndürür. `korunan: true` işaretli girdiler (üzerinde
 * çalışılan iş) asla listeye girmez — tavanı aşmaya devam etse bile atlanır.
 * `girdiler` mutasyona UĞRAMAZ (kopya üzerinde sıralanır).
 *
 * @param {Array<{yol:string, bayt?:number, sonKullanim?:number, korunan?:boolean}>} girdiler
 * @param {number} tavanBayt
 * @returns {Array<{yol:string, bayt:number, sonKullanim:number, korunan?:boolean}>}
 *   silme sırasıyla
 */
function lruSilinecekler(girdiler, tavanBayt) {
  const liste = Array.isArray(girdiler) ? girdiler : [];
  const tavan = Number.isFinite(tavanBayt) ? tavanBayt : 0;

  // Normalize edilmiş kopya — girdi dizisini/nesnelerini mutasyona uğratma.
  const normal = liste.map((g) => ({
    yol: g && g.yol,
    bayt: Number.isFinite(g && g.bayt) ? g.bayt : 0,
    sonKullanim: Number.isFinite(g && g.sonKullanim) ? g.sonKullanim : 0,
    korunan: !!(g && g.korunan),
  }));

  let toplam = normal.reduce((acc, g) => acc + g.bayt, 0);
  if (toplam <= tavan) return [];

  // En eskiden en yeniye sırala (kararlı: eşit sonKullanim'da girdi sırası korunur).
  const sirali = normal
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (a.g.sonKullanim - b.g.sonKullanim) || (a.i - b.i))
    .map((x) => x.g);

  const silinecekler = [];
  for (const girdi of sirali) {
    if (toplam <= tavan) break;
    if (girdi.korunan) continue;
    silinecekler.push(girdi);
    toplam -= girdi.bayt;
  }
  return silinecekler;
}

// ---------------------------------------------------------------------------
// Kaynak cache tavanı — BOYUT ORANTILI (2026-09-21, ölçümle) — aynı desen.
// ---------------------------------------------------------------------------
/**
 * Kaynak cache'inin (`<cacheRoot>/<bookId>/<srcVersion>/build.zip`) toplam bayt
 * TAVANINI, cache'teki EN BÜYÜK tek girdiye ORANTILI türetir.
 *
 * Neden: `EMPP_CACHE_CAP_GB` düz bir sabitti (run-agent.sh'ta 2) ve 2026-09-15'te
 * İLGİSİZ bir disk krizi için konmuştu (o gün 45504 pardus işi 15 GB boşken disk
 * kapısında düştü — bambaşka bir kapı, bambaşka bir sorun). Sabit tutulduğu için
 * içerik büyüyünce kırıldı: SM4 kaynağı v49→v50 arasında 14 MB'tan 1451 MB'a
 * çıktı (~100×) ve TEK BAŞINA 2 GB tavanın %72'sini yiyor. Ölçüm (agent.log
 * 07:25:16): SM4-v50 girdisi başarısız bir denemeden 12 dk sonra `cacheTavaniUygula`
 * tarafından tahliye edildi (o an başka bir kitabın job'u kendi bookId'sini
 * korurken 11811 korumasız kaldı) — yeniden deneme 1,45 GB'ı baştan indirmek
 * zorunda kaldı. Aynı hata sınıfı `pardusGerekliDiskGb` ile bu depoda zaten bir
 * kez çözülmüştü (2026-09-19); aynı desen izleniyor.
 *
 * İKİ YÖNLÜ SINIRLAMA:
 *   - ALT (oranlı): tavan `enBuyukGirdiBayt × kat` ve `tabanGb`'den büyük olanı
 *     alır — en büyük bilinen kaynak KENDİ BAŞINA tavanı dolduramaz.
 *   - ÜST (disk emniyeti): tavan, cache köküyle aynı bölümdeki boş alanın
 *     `ustSinirPayi` kesrini AŞMAZ — "içerik büyüdü, tavanı da büyüt" mantığı
 *     disk dolduracak kadar ileri gitmez (disk dolması üretim durdurur; bu,
 *     cache'in erken tahliyesinden DAHA KÖTÜdür, ama sınırsız büyüme ondan da
 *     kötüdür). Boş alan ölçülemezse üst sınır uygulanmaz.
 *
 * SAF fonksiyon — ölçüm (dizin taraması / `statfs`) çağırana aittir.
 *
 * @param {object} p
 * @param {number|null} p.enBuyukGirdiBayt Cache'teki en büyük tek girdinin
 *   (kitap/sürüm) toplam baytı; bilinmiyorsa/hiç girdi yoksa null.
 * @param {number|null} [p.bosGb] Cache köküyle aynı bölümdeki boş alan (GB);
 *   bilinmiyorsa null (üst sınır uygulanmaz).
 * @param {number} [p.kat] Orantı katsayısı (varsayılan 3 — en büyük kaynağın
 *   yanında birkaç eşzamanlı kitap/sürüm için pay; pardus'un derleme-genişlemesi
 *   5'inden bilerek FARKLI — burada zip'ler yan yana duruyor, açılmıyor).
 * @param {number} [p.tabanGb] Cache küçük/boşken bile korunan taban (varsayılan 5).
 * @param {number} [p.ustSinirPayi] Boş diskin en fazla bu kesri cache'e ayrılabilir
 *   (varsayılan 0.5).
 * @param {number|null} [p.elleGb] Açık override (`EMPP_CACHE_CAP_GB`); verilirse
 *   tek söz sahibi.
 * @returns {number} Tavan (GB, tam sayı, ≥ 0).
 */
function kaynakCacheTavaniGb({
  enBuyukGirdiBayt, bosGb = null, kat = 3, tabanGb = 5, ustSinirPayi = 0.5, elleGb = null,
} = {}) {
  if (Number.isFinite(elleGb) && elleGb > 0) return Math.ceil(elleGb);
  const taban = Number.isFinite(tabanGb) && tabanGb > 0 ? tabanGb : 5;

  let tavan = taban;
  if (Number.isFinite(enBuyukGirdiBayt)) {
    const k = Number.isFinite(kat) && kat > 0 ? kat : 3;
    // Sıfır/negatif girdi ayrıca elenmez: orantılı terim tabanın altına düşse
    // bile taban kazanır — ayrı bir koruma yazmak ölçülemeyen ölü dal üretirdi
    // (aynı desen ve gerekçe: `pardusGerekliDiskGb`).
    tavan = Math.max((enBuyukGirdiBayt / 1e9) * k, taban);
  }

  if (Number.isFinite(bosGb)) {
    const pay = Number.isFinite(ustSinirPayi) && ustSinirPayi > 0 ? ustSinirPayi : 0.5;
    tavan = Math.min(tavan, bosGb * pay);
  }

  return Math.ceil(Math.max(tavan, 0));
}

module.exports = { lruSilinecekler, kaynakCacheTavaniGb };
