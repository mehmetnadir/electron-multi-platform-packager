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

/** Eşik = çekirdek sayısı × VARSAYILAN_KAT (env `EMPP_KABUL_YUK_ESIGI` ile ezilebilir). */
const VARSAYILAN_KAT = 3;

/** Cihaz katmanının bilinen "altyapı" (host yükü) RED imzaları. Saf. */
const ALTYAPI_IMZALARI = [
  /uygulama süreci kapandı/,
  /ekran görüntüsü alınamadı/,
  /CDP hatası:.*\bms içinde cevap yok/,
];

/** Yük eşiği: env `EMPP_KABUL_YUK_ESIGI` > 0 ise o, yoksa çekirdek sayısı×3. Saf. */
function esikHesapla(cpuSayisi = os.cpus().length) {
  const env = Number(process.env.EMPP_KABUL_YUK_ESIGI);
  if (Number.isFinite(env) && env > 0) return env;
  return Math.max(1, cpuSayisi) * VARSAYILAN_KAT;
}

/** 1 dakikalık yük ortalaması. `yukOlc` testte sahte diziler döner (varsayılan `os.loadavg`). */
function birDkYuk(yukOlc) {
  const olc = yukOlc || (() => os.loadavg());
  const sonuc = olc();
  return Array.isArray(sonuc) ? sonuc[0] : Number(sonuc);
}

/**
 * ÖN KAPI: emülatör açılmadan önce yük eşiğin altına düşene kadar bekler.
 * @param {{esik?:number, araSn?:number, azamiSn?:number, yukOlc?:Function, bekle?:Function, log?:Function}} p
 * @returns {Promise<{gecti:boolean, esik:number, ornekler:number[], sonYuk:number, beklenenSn:number}>}
 */
async function onKapiBekle(p = {}) {
  const esik = p.esik === undefined || p.esik === null ? esikHesapla() : p.esik;
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
 * yeniden değerlendirir. Saf.
 * @param {{sebepler?:string[], yukOrnekleri?:number[], esik?:number}} p
 * @returns {{ortulenMi:boolean, esikAsildiMi:boolean, enYuksekYuk:number|null, esik:number}}
 */
function sonSiniflandirma(p = {}) {
  const sebepler = p.sebepler || [];
  const yukOrnekleri = p.yukOrnekleri || [];
  const esik = p.esik === undefined || p.esik === null ? esikHesapla() : p.esik;
  const enYuksek = yukOrnekleri.length ? Math.max(...yukOrnekleri) : null;
  const esikAsildiMi = enYuksek !== null && enYuksek > esik;
  const hepsiAltyapi = sebepler.length > 0 && sebepler.every(altyapiImzasiMi);
  return {
    ortulenMi: esikAsildiMi && hepsiAltyapi, esikAsildiMi, enYuksekYuk: enYuksek, esik,
  };
}

module.exports = {
  VARSAYILAN_KAT,
  ALTYAPI_IMZALARI,
  esikHesapla,
  birDkYuk,
  onKapiBekle,
  altyapiImzasiMi,
  sonSiniflandirma,
};
