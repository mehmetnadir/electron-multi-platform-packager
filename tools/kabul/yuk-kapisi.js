'use strict';
/**
 * ANDROID BAŞSIZ KABUL — YÜK KAPISI (27.09 45482, load avg 138/142/101, `sysctl vm.loadavg`).
 *
 * Mac aşırı yüklüyken (başka oturumların agy filoları, pytest, `bfs /`, dev `grep -r`) cihaz
 * katmanı ALTYAPI belirtileriyle RED verebiliyor — paketin kusuru değil, o an host'un
 * kaldıramadığı yük:
 *   - "uygulama süreci kapandı" (pidof boş — sistem OOM/zamanlayıcı baskısı)
 *   - "ekran görüntüsü alınamadı" (screencap zaman aşımına uğradı/bozuk döndü)
 *   - CDP `Network.enable: 10000 ms içinde cevap yok` (webview_devtools_remote soketi yanıt vermedi)
 * Aynı sınıfın önceki örneği 72379 (emülatörün KENDİ sistem ANR'si, `sistemAnrMi` ile
 * ÖLÇÜLEMEDİ'ye çevriliyor) — bu dosya FARKLI bir imza kümesini (süreç ölümü + CDP zaman
 * aşımı) aynı gerekçeyle (host yükü) ele alır.
 *
 * İKİ AYRI EŞİK (27.09 koordinatör düzeltmesi — ölçümle): aynı gün 15:49–19:04 UTC arası
 * 10 android kabulü yük ~100–130 iken GEÇTİ; çekirdek×3 (10 çekirdekte 30) hem ön kapıyı hem
 * son sınıflandırmayı bu ARALIĞIN İÇİNDE tetikleyip hattı durdururdu. Tek eşik yanlıştı:
 *   - ÖN KAPI (`onKapiEsigiHesapla`, env `EMPP_KABUL_ON_KAPI_ESIGI`, varsayılan çekirdek×12):
 *     YÜKSEK tutulur — yalnız AŞIRI UÇTA (45482: 138-142) emülatörü hiç açmadan erteler.
 *     Normal-yoğun (100-130) dönemde işi DURDURMAMALI.
 *   - SON SINIFLANDIRMA (`sonSinifEsigiHesapla`, env `EMPP_KABUL_YUK_ESIGI`, varsayılan
 *     çekirdek×6): DÜŞÜK tutulur — yalnız cihaz katmanının TÜM sebepleri bilinen altyapı
 *     imzasıyken devreye girer ve RED'i ÖLÇÜLEMEDİ'ye çevirir (yayınlamaz, ertelenir);
 *     GEÇTİ sonuçları hiç etkilemez (sebepler boşsa zaten çağrılmaz) — düşük tutmak güvenli.
 *
 * İki kapı:
 *   1) ÖN KAPI (`onKapiBekle`): emülatör açılmadan önce yük eşiğin altına düşene kadar
 *      (azami `azamiSn`, varsayılan 600) beklenir; düşmezse iş ÖLÇÜLEMEDİ ile ertelenir —
 *      emülatör HİÇ AÇILMAZ.
 *   2) SON SINIFLANDIRMA (`sonSiniflandirma`): kabul boyunca örneklenen yük dizisindeki en
 *      yüksek değer eşiği aştıysa VE cihaz katmanının TÜM sebepleri bilinen altyapı
 *      imzalarındaysa sonuç RED'den ÖLÇÜLEMEDİ'ye çevrilir. Yük NORMALKEN aynı imzalar
 *      gerçek RED kalır — 72379 dersi (sahte ÖLÇÜLEMEDİ'ye kaçış da yasak) burada da geçerli:
 *      bilinmeyen/başka bir sebep karışırsa (ör. menü kartı sayısı yanlış) override devreye
 *      GİRMEZ, paket kusuru olasılığı saklı tutulur.
 *
 * Tamamı saf fonksiyon; zaman/yük ölçümü test için enjekte edilebilir (`yukOlc`, `bekle`).
 */
const os = require('os');

const ON_KAPI_ENV = 'EMPP_KABUL_ON_KAPI_ESIGI';
const ON_KAPI_KAT = 12;
const SON_SINIF_ENV = 'EMPP_KABUL_YUK_ESIGI';
const SON_SINIF_KAT = 6;
/**
 * ORTALAMA eşiği (30.09, koordinatör isteği: "tepe örneğini de değerlendir, ortalama VE
 * tepe"). `sonSiniflandirma` eskiden yalnız TEK bir örneğin (en yüksek/tepe) eşiği aşmasına
 * bakıyordu — sürekli-ama-tepe-yapmayan bir yük (ör. 6 örneğin hepsi 35-59 aralığında,
 * hiçbiri tek başına tepe eşiğini (varsayılan ×6) aşmıyor ama ORTALAMA sürekli yüksek)
 * yakalanamazdı. DÜŞÜK tutulur (varsayılan ×4, tepe ×6'dan küçük) — ortalamanın tepeyi
 * AŞAMAYACAĞI matematiksel gerçeği nedeniyle (ortalama ≤ tepe, her zaman) ortalama eşiği
 * tepe eşiğine eşit ya da yüksek olsaydı bu kontrol hiçbir zaman EK bir pozitif üretmezdi.
 */
const SON_SINIF_ORTALAMA_ENV = 'EMPP_KABUL_YUK_ESIGI_ORTALAMA';
const SON_SINIF_ORTALAMA_KAT = 4;

/** Cihaz katmanının bilinen "altyapı" (host yükü) RED imzaları. Saf. */
const ALTYAPI_IMZALARI = [
  /uygulama süreci kapandı/,
  /ekran görüntüsü alınamadı/,
  /CDP hatası:.*\bms içinde cevap yok/,
];

/** `envAdi` > 0 ise o, yoksa çekirdek sayısı × `kat`. Saf. */
function esikOku(envAdi, kat, cpuSayisi = os.cpus().length) {
  const env = Number(process.env[envAdi]);
  if (Number.isFinite(env) && env > 0) return env;
  return Math.max(1, cpuSayisi) * kat;
}

/** Ön kapı eşiği: `EMPP_KABUL_ON_KAPI_ESIGI` (varsayılan çekirdek×12 — yalnız aşırı uçta durdurur). Saf. */
function onKapiEsigiHesapla(cpuSayisi) { return esikOku(ON_KAPI_ENV, ON_KAPI_KAT, cpuSayisi); }

/** Son sınıflandırma eşiği: `EMPP_KABUL_YUK_ESIGI` (varsayılan çekirdek×6 — düşük, güvenli). Saf. */
function sonSinifEsigiHesapla(cpuSayisi) { return esikOku(SON_SINIF_ENV, SON_SINIF_KAT, cpuSayisi); }

/** Son sınıflandırma ORTALAMA eşiği: `EMPP_KABUL_YUK_ESIGI_ORTALAMA` (varsayılan çekirdek×4). Saf. */
function sonSinifOrtalamaEsigiHesapla(cpuSayisi) { return esikOku(SON_SINIF_ORTALAMA_ENV, SON_SINIF_ORTALAMA_KAT, cpuSayisi); }

/** 1 dakikalık yük ortalaması. `yukOlc` testte sahte diziler döner (varsayılan `os.loadavg`). */
function birDkYuk(yukOlc) {
  const olc = yukOlc || (() => os.loadavg());
  const sonuc = olc();
  return Array.isArray(sonuc) ? sonuc[0] : Number(sonuc);
}

/**
 * ÖN KAPI: emülatör açılmadan önce yük eşiğin altına düşene kadar bekler.
 * @param {{esik?:number, araSn?:number, azamiSn?:number, yukOlc?:Function, bekle?:Function, log?:Function}} p
 *   `esik` verilmezse `onKapiEsigiHesapla()` kullanılır.
 * @returns {Promise<{gecti:boolean, esik:number, ornekler:number[], sonYuk:number, beklenenSn:number}>}
 */
async function onKapiBekle(p = {}) {
  const esik = p.esik === undefined || p.esik === null ? onKapiEsigiHesapla() : p.esik;
  const araSn = p.araSn === undefined ? 30 : p.araSn;
  const azamiSn = p.azamiSn === undefined ? 600 : p.azamiSn;
  const log = p.log || (() => {});
  const bekleyici = p.bekle || ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  const ornekler = [];
  const bas = Date.now();
  let son = birDkYuk(p.yukOlc);
  ornekler.push(son);
  log(`yük kapısı: 1dk=${son.toFixed(1)} eşik=${esik.toFixed(1)} ${son <= esik ? 'geçti' : 'bekleniyor'}`);
  while (son > esik && (Date.now() - bas) / 1000 < azamiSn) {
    // eslint-disable-next-line no-await-in-loop
    await bekleyici(araSn * 1000);
    son = birDkYuk(p.yukOlc);
    ornekler.push(son);
    log(`yük kapısı: 1dk=${son.toFixed(1)} eşik=${esik.toFixed(1)} ${son <= esik ? 'geçti' : 'bekleniyor'}`);
  }
  const gecti = son <= esik;
  const beklenenSn = Math.round((Date.now() - bas) / 1000);
  if (!gecti) log(`yük kapısı: eşik ${azamiSn} sn içinde düşmedi (${beklenenSn} sn) — kabul ertelendi`);
  return {
    gecti, esik, ornekler, sonYuk: son, beklenenSn,
  };
}

/** Bir sebep metni bilinen altyapı (host yükü) imzalarından biriyle mi eşleşiyor. Saf. */
function altyapiImzasiMi(sebep) {
  return ALTYAPI_IMZALARI.some((re) => re.test(String(sebep || '')));
}

/**
 * SON SINIFLANDIRMA: cihaz katmanı sebeplerini kabul boyunca örneklenen yük dizisine göre
 * yeniden değerlendirir. İKİ ayrı kriter değerlendirilir (30.09: "ortalama VE tepe") —
 * TEPE (`enYuksekYuk`, tek örneğin en yükseği, eşik `esik`) YA DA ORTALAMA (`ortalamaYuk`,
 * eşik `ortalamaEsik`, varsayılan daha düşük) eşiği aşarsa `esikAsildiMi` true olur; ikisi de
 * mevcut `hepsiAltyapi` şartıyla birlikte değerlendirilir — davranış/isimler geriye dönük
 * uyumlu (`esikAsildiMi`/`enYuksekYuk`/`esik` aynı anlamda kalır), yalnız EK alanlar eklendi. Saf.
 * @param {{sebepler?:string[], yukOrnekleri?:number[], esik?:number, ortalamaEsik?:number}} p
 *   `esik` verilmezse `sonSinifEsigiHesapla()`, `ortalamaEsik` verilmezse
 *   `sonSinifOrtalamaEsigiHesapla()` kullanılır.
 * @returns {{ortulenMi:boolean, esikAsildiMi:boolean, tepeAsildiMi:boolean, ortalamaAsildiMi:boolean,
 *            enYuksekYuk:number|null, ortalamaYuk:number|null, esik:number, ortalamaEsik:number}}
 */
function sonSiniflandirma(p = {}) {
  const sebepler = p.sebepler || [];
  const yukOrnekleri = p.yukOrnekleri || [];
  const esik = p.esik === undefined || p.esik === null ? sonSinifEsigiHesapla() : p.esik;
  const ortalamaEsik = p.ortalamaEsik === undefined || p.ortalamaEsik === null
    ? sonSinifOrtalamaEsigiHesapla() : p.ortalamaEsik;
  const enYuksek = yukOrnekleri.length ? Math.max(...yukOrnekleri) : null;
  const ortalama = yukOrnekleri.length
    ? Number((yukOrnekleri.reduce((a, b) => a + b, 0) / yukOrnekleri.length).toFixed(2)) : null;
  const tepeAsildiMi = enYuksek !== null && enYuksek > esik;
  const ortalamaAsildiMi = ortalama !== null && ortalama > ortalamaEsik;
  const esikAsildiMi = tepeAsildiMi || ortalamaAsildiMi;
  const hepsiAltyapi = sebepler.length > 0 && sebepler.every(altyapiImzasiMi);
  return {
    ortulenMi: esikAsildiMi && hepsiAltyapi,
    esikAsildiMi,
    tepeAsildiMi,
    ortalamaAsildiMi,
    enYuksekYuk: enYuksek,
    ortalamaYuk: ortalama,
    esik,
    ortalamaEsik,
  };
}

/**
 * Etiketli yük örneklerinden ({asama,yuk} ya da düz sayı) özet: en yüksek + ortalama.
 * kosum.json kalibrasyonu için (koordinatör 27.09: "bir hafta sonra eşiği bu veriyle
 * kalibre edeceğiz"). Saf.
 * @param {Array<number|{yuk:number}>} yukKayit
 * @returns {{enYuksek:number|null, ortalama:number|null, adet:number}}
 */
function yukOzeti(yukKayit = []) {
  const sayilar = yukKayit
    .map((o) => (typeof o === 'number' ? o : o && o.yuk))
    .filter((v) => Number.isFinite(v));
  if (!sayilar.length) return { enYuksek: null, ortalama: null, adet: 0 };
  const toplam = sayilar.reduce((a, b) => a + b, 0);
  return {
    enYuksek: Math.max(...sayilar),
    ortalama: Number((toplam / sayilar.length).toFixed(1)),
    adet: sayilar.length,
  };
}

module.exports = {
  ON_KAPI_ENV,
  ON_KAPI_KAT,
  SON_SINIF_ENV,
  SON_SINIF_KAT,
  SON_SINIF_ORTALAMA_ENV,
  SON_SINIF_ORTALAMA_KAT,
  ALTYAPI_IMZALARI,
  esikOku,
  onKapiEsigiHesapla,
  sonSinifEsigiHesapla,
  sonSinifOrtalamaEsigiHesapla,
  birDkYuk,
  onKapiBekle,
  altyapiImzasiMi,
  sonSiniflandirma,
  yukOzeti,
};
