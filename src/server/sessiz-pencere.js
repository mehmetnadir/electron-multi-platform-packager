'use strict';

// "Sessiz pencere" karar modülü — SAF fonksiyonlar, İ/O YOK (ağ/dosya/süreç yok).
// Amaç: paketleyici kuyruğu (packagingRoutes /api/queue-statistics) gerçekten
// boşaldığında haber vermek için karar mantığını, ağdan ve zamanlamadan ayrı
// test edilebilir tutmak.
//
// Güvenlik ilkesi (Nadir'in beyanı, ölçülmüş bağlam): şüphede HER ZAMAN
// "meşgul" say. Yanlış "sakin" kararı uçuştaki bir build'i öldürür; yanlış
// "meşgul" kararı ise sadece bir sonraki ölçümü bir tur geciktirir. İki hata
// simetrik değil — bu yüzden her belirsiz/bozuk/eksik durumda meşgul kazanır.

/**
 * Bir değeri JSON string ise ayrıştırır (İ/O yok — sadece JSON.parse).
 * Ayrıştırılamazsa Symbol döner ki çağıran "bozuk" olduğunu ayırt edebilsin.
 */
const AYRISTIRMA_HATASI = Symbol('ayristirma-hatasi');

function belkiAyristir(deger) {
  if (typeof deger !== 'string') return deger;
  try {
    return JSON.parse(deger);
  } catch {
    return AYRISTIRMA_HATASI;
  }
}

/**
 * Bir nesnenin İÇİNDEKİ (kendisi dahil, iç içe ne kadar derin olursa olsun)
 * her `processing` anahtarının değerini toplar. Döngüsel referanslara karşı
 * korumalıdır.
 */
function tumProcessingDegerleriniTopla(kok) {
  const bulunanlar = [];
  const gorulenler = new Set();

  function gez(deger) {
    if (deger === null || deger === undefined) return;
    if (typeof deger !== 'object') return;
    if (gorulenler.has(deger)) return; // döngüsel referans koruması
    gorulenler.add(deger);

    if (Array.isArray(deger)) {
      for (const eleman of deger) gez(eleman);
      return;
    }

    for (const anahtar of Object.keys(deger)) {
      const altDeger = deger[anahtar];
      if (anahtar === 'processing') {
        bulunanlar.push(altDeger);
      }
      // NOT: `processing` anahtarının değeri de bir nesne olabilir teorik
      // olarak (bozuk cevap) — onun içine de bakılır, zarar vermez.
      gez(altDeger);
    }
  }

  gez(kok);
  return bulunanlar;
}

/**
 * Kuyruk istatistik cevabındaki HER `processing` alanına (iç içe nesneler
 * dahil — örn. statistics.packaging.processing, statistics.zip.processing)
 * bakar. Herhangi biri sayısal ve > 0 ise `true` (meşgul).
 *
 * Cevap yoksa / null ise / bozuk JSON string ise / obje değilse / hiçbir
 * `processing` alanı bulunamazsa / bulunan bir `processing` alanı sayısal
 * değilse → `true` döner (ŞÜPHEDE MEŞGUL SAY).
 *
 * @param {*} istatistik - /api/queue-statistics cevabı (parse edilmiş obje
 *   ya da ham JSON string — ikisi de kabul edilir).
 * @returns {boolean}
 */
function mesgulMu(istatistik) {
  const veri = belkiAyristir(istatistik);

  if (veri === AYRISTIRMA_HATASI) return true; // bozuk JSON → meşgul say
  if (veri === null || veri === undefined) return true; // cevap yok → meşgul say
  if (typeof veri !== 'object') return true; // sayı/boolean/vs. → meşgul say

  const bulunanlar = tumProcessingDegerleriniTopla(veri);

  if (bulunanlar.length === 0) return true; // hiç `processing` alanı yok → meşgul say

  for (const deger of bulunanlar) {
    if (typeof deger !== 'number' || Number.isNaN(deger)) return true; // bozuk alan → meşgul say
    if (deger > 0) return true; // gerçekten işleyen bir şey var → meşgul
  }

  return false; // her `processing` alanı sayısal ve 0 → sakin
}

/**
 * Kuyruk pencerenin AÇIK sayılması için gereken ardışık "sakin" ölçüm
 * sayısına ulaşılıp ulaşılmadığını söyler. Tek ölçüm iki iş arasındaki kısa
 * boşluğa denk gelebileceği için pencere ancak arka arkaya N kez sakin
 * görüldükten sonra açılır.
 *
 * @param {number} ardisikSakinSayisi - şu ana kadar art arda kaç kez sakin
 *   (mesgulMu === false) ölçüldüğü.
 * @param {number} [gerekliArdisik=3] - eşik. Geçersiz (sayı değil, NaN,
 *   0 veya negatif) verilirse 3'e düşer.
 * @returns {boolean}
 */
function pencereAcikMi(ardisikSakinSayisi, gerekliArdisik = 3) {
  const esik = (typeof gerekliArdisik === 'number' && !Number.isNaN(gerekliArdisik) && gerekliArdisik > 0)
    ? gerekliArdisik
    : 3;

  if (typeof ardisikSakinSayisi !== 'number' || Number.isNaN(ardisikSakinSayisi)) return false;

  return ardisikSakinSayisi >= esik;
}

function sayiyaCevir(deger, varsayilan) {
  return (typeof deger === 'number' && !Number.isNaN(deger)) ? deger : varsayilan;
}

function ustHarfeCevir(metin) {
  return metin.length === 0 ? metin : metin.charAt(0).toUpperCase() + metin.slice(1);
}

const KATEGORI_ADI_TR = {
  packaging: 'paketleme',
  zip: 'zip',
};

/**
 * Kuyruk istatistik cevabından insan-okunur TEK SATIRLIK bir özet üretir.
 * Örn: "paketleme 1 işliyor, 3 bitti, 6 slot boş; zip 0 işliyor, 4 bitti, 3 slot boş"
 *
 * Cevap bozuk/boş/beklenmeyen şekildeyse, çökmeden anlaşılır bir hata metni
 * döner (İ/O yok — sadece metin üretir).
 *
 * @param {*} istatistik - /api/queue-statistics cevabı (obje ya da JSON string).
 * @returns {string}
 */
function durumOzeti(istatistik) {
  const veri = belkiAyristir(istatistik);

  if (veri === AYRISTIRMA_HATASI) return 'kuyruk durumu okunamadı (bozuk JSON cevap)';
  if (veri === null || veri === undefined) return 'kuyruk durumu okunamadı (boş cevap)';
  if (typeof veri !== 'object') return 'kuyruk durumu okunamadı (geçersiz cevap şekli)';

  const statistics = (veri.statistics && typeof veri.statistics === 'object' && !Array.isArray(veri.statistics))
    ? veri.statistics
    : veri;

  const capacity = (statistics.capacity && typeof statistics.capacity === 'object' && !Array.isArray(statistics.capacity))
    ? statistics.capacity
    : {};

  const parcalar = [];

  for (const kategori of Object.keys(statistics)) {
    if (kategori === 'capacity') continue;
    const deger = statistics[kategori];
    if (deger === null || typeof deger !== 'object' || Array.isArray(deger)) continue;
    if (!('processing' in deger)) continue;

    const isliyor = sayiyaCevir(deger.processing, 0);
    const bitti = sayiyaCevir(deger.completed, 0);
    const ad = KATEGORI_ADI_TR[kategori] || kategori;

    let parca = `${ad} ${isliyor} işliyor, ${bitti} bitti`;

    const slotAnahtari = `available${ustHarfeCevir(kategori)}Slots`;
    if (typeof capacity[slotAnahtari] === 'number' && !Number.isNaN(capacity[slotAnahtari])) {
      parca += `, ${capacity[slotAnahtari]} slot boş`;
    }

    parcalar.push(parca);
  }

  if (parcalar.length === 0) return 'kuyruk durumu okunamadı (processing alanı bulunamadı)';

  return parcalar.join('; ');
}

module.exports = {
  mesgulMu,
  pencereAcikMi,
  durumOzeti,
};
