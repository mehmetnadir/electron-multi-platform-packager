'use strict';

/**
 * İZLEYİCİ KURTARMA — gözcünün SAF karar katmanı.
 *
 * NEDEN VAR (ölçüldü, 2026-09-21):
 *   `windows-kasa` izleyicisinin ana döngüsü `komut` dalında asıldı. Kalp atışı AYRI
 *   işte koştuğu için host `{"durum":"ayakta","yasSn":4}` gördü ve `hazir` ÇIKIŞ KODU 0
 *   (yeşil) döndürdü. Oysa 10:21'de alınan görev sonuç yazmadı ve 10:23:41'de kuyruğa
 *   yazılan görev 11:01'de HÂLÂ alınmamıştı — yani şerit 40 dakikadır kilitliydi.
 *   Kurtarmanın tek yolu Nadir'in fiziksel olarak makinedeki PowerShell penceresine
 *   gidip Ctrl+C basmasıydı: SSH(22) ve WinRM(5985/5986) KAPALI, RDP odak çalıyor,
 *   SMB yalnız dosya taşıyor. Yani UZAKTAN KURTARMA YOLU YOKTU.
 *
 * ÇÖZÜMÜN ŞEKLİ: köprü PULL modelidir (guest host'a gider, host guest'e gidemez).
 * Bu yüzden kurtarıcı da makinenin İÇİNDE yaşamalı ve kendisi yoklamalı. Gözcü
 * (`tools/windows/vm-gozcu.ps1`) yalnız üç şey yapar: yerel damga dosyasını okur,
 * bu modülün kararını uygular, süreç ağacını öldürüp izleyiciyi yeniden başlatır.
 * KEYFÎ KOMUT ÇALIŞTIRMAZ — asılma sınıfına yapısal olarak giremez.
 *
 * BAĞIMLILIK (açıkça yazılıyor): karar, ana döngünün bastığı İLERLEME DAMGASINI
 * (`$env:LOCALAPPDATA\vm-kapi\dongu.json` → `sonDonguDamgasi`/`donguDurumu`/
 * `donguZamanAsimiSn`) girdi alır. O damgayı `izleyici-zaman-asimi` ajanının
 * `tools/windows/vm-izleyici.ps1` üzerindeki çalışması üretir. Damga YOKSA bu modül
 * "iyi" demez, `elle` der (ölçüm 2026-09-21: windows-kasa'nın kalp dosyası 24 bayt
 * çıplak ISO = ESKİ sürüm, `serit: "bilinmiyor"`). Yani gözcü, o iş makineye
 * inmeden KÖRDÜR ve bunu bildirir.
 *
 * Bu modül dosya sistemine, ağa ve sürece DOKUNMAZ; yalnız karar üretir.
 */

// ——— EŞİKLER ————————————————————————————————————————————————————————————
// Host tarafı (src/windows/vm-kapi-karar.js) aynı olguyu TEŞHİS için ölçer; burada
// aynı olgu MÜDAHALE için ölçülür. İki taraf ayrışırsa host "tıkalı" derken gözcü
// susar (ya da tersi) — bu yüzden değerler bilerek birebir aynıdır ve
// `izleyici-kurtarma.test.js` içinde bir SAPMA BEKÇİSİ testi ikisini kıyaslar.
const BOS_AZAMI_SN = 60;           // boştaki döngü ~5 sn'de bir damga basar; 60 sn = 12 kaçırılmış tur
const TAVAN_PAYI_SN = 60;          // görev tavanı + bu pay da aşıldıysa guest zaman aşımı DA tutmamış
const VARSAYILAN_TAVAN_SN = 900;   // görev kendi tavanını bildirmediyse (eski gövde)

// ——— FREN: BEKÇİ KENDİSİ ARIZA OLMASIN ——————————————————————————————————
// Anı `kapatilan-bekci-kaza-degil`: frensiz bir autoFix günde 288 restart üretti ve
// bekçinin kendisi kapatıldı. Bu yüzden iki fren var: ardışık müdahaleler arası
// SOĞUMA ve saat başına TAVAN. Tavan dolduğunda gözcü susmaz — `elle` der, yani
// "burada benim çözemeyeceğim bir arıza var, insana söyle".
const SOGUMA_SN = 120;             // bir müdahaleden sonra en az bu kadar bekle
const SAATLIK_TAVAN = 3;           // son 1 saatte bu kadar müdahale olduysa dur, insana bırak
const PENCERE_SN = 3600;

/** Sayı mı (sonlu)? */
function sayiMi(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Son `PENCERE_SN` saniye içindeki müdahale sayısı.
 * @param {number[]} gecmis müdahale damgaları (ms)
 * @param {number} simdiMs
 */
function sonPenceredekiMudahale(gecmis, simdiMs, pencereSn = PENCERE_SN) {
  if (!Array.isArray(gecmis)) return 0;
  const sinir = simdiMs - pencereSn * 1000;
  return gecmis.filter((t) => sayiMi(t) && t > sinir).length;
}

/**
 * KURTARMA KARARI.
 *
 * Girdi (`olcum`):
 *   simdiMs        {number}            şimdi (ms)
 *   izleyiciVar    {boolean}           izleyici süreci bulunuyor mu (CIM taraması)
 *   damgaMs        {number|null}       dongu.json → sonDonguDamgasi (ms), yoksa null
 *   durum          {'bos'|'calisiyor'} döngünün son bildirdiği hal
 *   zamanAsimiSn   {number|null}       o an koşan görevin KENDİ tavanı
 *   uzakTetik      {string|null}       host'un yazdığı yeniden-başlat damgası (nonce)
 *   gorulenTetik   {string|null}       gözcünün en son gördüğü damga
 *   mudahaleGecmisi{number[]}          önceki müdahalelerin damgaları (ms)
 *   ilkTur         {boolean}           gözcünün ilk turu mu (nonce TOHUMLANIR, tetiklemez)
 *
 * Çıktı: { karar, sebep, tetik?, yasSn?, yeniTetik? }
 *   'bekle'          → her şey yolunda ya da fren devrede
 *   'basla'          → izleyici süreci YOK, öldürmeden başlat
 *   'yeniden-baslat' → süreç ağacını öldür + yeniden başlat
 *   'elle'           → gözcü çözemez; insana bildir (kör kalma ya da fren tavanı)
 */
function kurtarmaKarari(olcum, ayar = {}) {
  const o = olcum || {};
  const simdiMs = sayiMi(o.simdiMs) ? o.simdiMs : NaN;
  if (!sayiMi(simdiMs)) {
    return { karar: 'elle', sebep: 'ölçüm alınamadı: şimdi damgası yok' };
  }
  const bosAzami = sayiMi(ayar.bosAzamiSn) ? ayar.bosAzamiSn : BOS_AZAMI_SN;
  const pay = sayiMi(ayar.tavanPayiSn) ? ayar.tavanPayiSn : TAVAN_PAYI_SN;
  const varsayilanTavan = sayiMi(ayar.varsayilanTavanSn) ? ayar.varsayilanTavanSn : VARSAYILAN_TAVAN_SN;
  const sogumaSn = sayiMi(ayar.sogumaSn) ? ayar.sogumaSn : SOGUMA_SN;
  const saatlikTavan = sayiMi(ayar.saatlikTavan) ? ayar.saatlikTavan : SAATLIK_TAVAN;

  const gecmis = Array.isArray(o.mudahaleGecmisi) ? o.mudahaleGecmisi : [];
  const sonMudahale = gecmis.filter(sayiMi).reduce((a, b) => (b > a ? b : a), -Infinity);
  const penceredeki = sonPenceredekiMudahale(gecmis, simdiMs, ayar.pencereSn);

  // (1) UZAKTAN TETİK — operatörün açık talebi. İki freni de AŞAR: Nadir bir kez
  // damgayı değiştirdiyse müdahaleyi istiyordur. Fakat İLK TUR'da yalnız TOHUMLANIR:
  // gözcü her açılışında eski damgayı "yeni" sayıp gereksiz restart atmasın.
  const uzak = o.uzakTetik == null ? null : String(o.uzakTetik).trim();
  const gorulen = o.gorulenTetik == null ? null : String(o.gorulenTetik).trim();
  if (uzak && uzak !== gorulen) {
    if (o.ilkTur) {
      return { karar: 'bekle', sebep: 'ilk tur: uzak tetik tohumlandı, müdahale yok', yeniTetik: uzak };
    }
    return { karar: 'yeniden-baslat', tetik: 'uzak', sebep: 'host uzaktan yeniden başlatma istedi', yeniTetik: uzak };
  }

  // (2) SAATLİK TAVAN — bekçinin kendisi arıza üretmesin (frensiz autoFix dersi).
  if (penceredeki >= saatlikTavan) {
    return {
      karar: 'elle',
      sebep: `son 1 saatte ${penceredeki} müdahale yapıldı (tavan ${saatlikTavan}) — ` +
        'tekrar eden arıza, gözcü durdu; insan bakmalı',
    };
  }

  // (3) SOĞUMA — art arda öldürme yarışı olmasın; yeni izleyici ayağa kalksın.
  if (sayiMi(sonMudahale) && simdiMs - sonMudahale < sogumaSn * 1000) {
    const kalanSn = Math.ceil((sogumaSn * 1000 - (simdiMs - sonMudahale)) / 1000);
    return { karar: 'bekle', sebep: `soğuma: son müdahaleden sonra ${kalanSn} sn daha beklenecek` };
  }

  // (4) SÜREÇ YOK — pencere kapanmış / çökmüş. Öldürecek bir şey yok, sadece BAŞLAT.
  if (!o.izleyiciVar) {
    return { karar: 'basla', sebep: 'izleyici süreci bulunamadı (pencere kapandı ya da çöktü)' };
  }

  // (5) DAMGA YOK — izleyici ayakta ama ilerleme bildirmiyor: ESKİ sürüm. Burada
  // "iyi" demek 2026-09-21 arızasının aynısını tekrarlamaktır. Şüphede DAİMA bildir.
  if (!sayiMi(o.damgaMs)) {
    return {
      karar: 'elle',
      sebep: 'ilerleme damgası yok — izleyici ESKİ sürüm, gözcü kör; ' +
        'önce vm-izleyici.ps1 yükseltilmeli (tools/windows/YUKSELTME.md)',
    };
  }

  const yasSn = Math.max(0, Math.floor((simdiMs - o.damgaMs) / 1000));

  // (6) GÖREV İÇİNDE ve görevin KENDİ tavanı + pay da aşılmış → guest zaman aşımı
  // TUTMAMIŞ demektir (asılan çağrı tavanı hiç görmeyen bir dalda). Müdahale şart.
  if (o.durum === 'calisiyor') {
    const tavan = (sayiMi(o.zamanAsimiSn) && o.zamanAsimiSn > 0 ? o.zamanAsimiSn : varsayilanTavan) + pay;
    if (yasSn > tavan) {
      return {
        karar: 'yeniden-baslat', tetik: 'gorev-tavani', yasSn,
        sebep: `görev ${o.gorev || '?'} ${yasSn} sn'dir ilerlemiyor (tavan+pay ${tavan} sn) — ` +
          'zaman aşımı tutmamış',
      };
    }
    return { karar: 'bekle', sebep: `görev sürüyor (${yasSn} sn, tavan+pay ${tavan} sn)`, yasSn };
  }

  // (7) BOŞTA ama damga bayat → döngü görev almadan bir yerde asılı.
  if (yasSn > bosAzami) {
    return {
      karar: 'yeniden-baslat', tetik: 'bos-serit', yasSn,
      sebep: `döngü boşta görünüyor ama ${yasSn} sn'dir damga basmıyor (eşik ${bosAzami} sn)`,
    };
  }

  return { karar: 'bekle', sebep: `şerit akıyor (${yasSn} sn)`, yasSn };
}


/**
 * UZAKTAN TETİK DAMGASI — host bunu `~/vm-kapi/yeniden-baslat-<makine>.txt`
 * içine yazar, gözcü köprünün `dosya` ucundan çeker. SIR DEĞİLDİR: yalnız
 * "değişti mi" diye bakılan bir sayaçtır; yetki tailnet üyeliği + 24 hex yol
 * belirtecinde durur. Aynı saniyede iki kez basılsa bile rastgele son ek
 * sayesinde yeni bir değer üretir — yoksa ikinci istek sessizce yutulurdu.
 */
function tetikDamgasi(simdiMs, rastgele) {
  const t = Number.isFinite(simdiMs) ? simdiMs : Date.now();
  const r = Number.isFinite(rastgele) ? rastgele : Math.random();
  const sonEk = String(Math.floor(r * 10000)).padStart(4, '0');
  return `${new Date(t).toISOString().replace(/[-:.]/g, '').slice(0, 15)}-${sonEk}`;
}

module.exports = {
  kurtarmaKarari, tetikDamgasi,
  sonPenceredekiMudahale,
  BOS_AZAMI_SN, TAVAN_PAYI_SN, VARSAYILAN_TAVAN_SN,
  SOGUMA_SN, SAATLIK_TAVAN, PENCERE_SN,
};
