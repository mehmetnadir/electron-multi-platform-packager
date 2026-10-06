'use strict';

/**
 * İÇERİKSİZ ÜYE ATLAMA (Nadir 06.10: "14835'i atlayarak devam et — böyle durumda atla ve rapor et").
 *
 * Eskiden üreteç "ya hep ya hiç" çalışırdı: set üyelerinden biri hiçbir kaynakta yoksa build yazılmaz,
 * iş ertelenirdi (45479, 21 kitap, 14835: İmpark'ta içerik yok). Şimdi YALNIZ kesin "yok" kanıtı varsa
 * o üye atlanır: build'e girmez, menüden/listeden çıkar, rapor edilir; kalan üyelerle iş sürer.
 *
 * SINIF AYRIMI (tek kaynak — her çağıran buradan okur):
 *   KESİN YOK (atlanabilir)            İmpark teklifi HTTP 404 · İmpark `Data` boş · İmpark zip adresi
 *                                      HTTP 404 · yedek kaynak açıkça "yok" der (`kesin: true`).
 *   BELİRSİZ (ATLANMAZ, ertelenir)     ağ hatası · zaman aşımı · 5xx · JSON/Success bozuk · SMB bağlı
 *                                      değil · zip kurulamadı · yedek RED (içerik var ama kapıdan geçmedi)
 *                                      · yedek hatası · yedek kesin işareti taşımıyor.
 * Her kaynak kesin "yok" demeden atlama olmaz (tüm kaynaklar denendi + hepsi kesin).
 *
 * GÜVENLİK TAVANI: atlanan üye sayısı setin yarısından fazlaysa, set tek üyeliyse ya da kesin-yok
 * dışında bir eksik de varsa atlama YAPILMAZ (eski erteleme sürer) — yanlış kaynak sınıfı tüm seti
 * boşaltmasın.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ikiliKomutu } = require('./bildir-ikili');
const M = require('./icerik-merdiven');

const ISARET = '[uretec]';
/** Üretecin build'e yazdığı işaret dosyası (index-ureteci.js `URETEC_ISARETI` ile aynı ad). */
const URETEC_ISARETI = 'empp-uretec.json';
/** Setin bu orandan fazlası atlanamaz (yarısı DAHİL geçer). */
const TAVAN_ORANI = 0.5;

/** İmpark teklif cevabı kesin "bu kitap yok" mu (HTTP 404)? SAF. */
function imparkTeklif404mu(cevap) {
  return Boolean(cevap && !cevap.hata && cevap.status === 404);
}

/** İndirme hatası HTTP 404 taşıyor mu (`httpDurum` ya da curl "returned error: 404")? SAF. */
function indirme404mu(e) {
  if (!e) return false;
  if (e.httpDurum === 404) return true;
  return /returned error:\s*404\b/i.test(String(e.stderr || ''));
}

/**
 * Atlama kararı. SAF.
 * @param {{toplam:number, kesin:number, digerEksik:number}} o  toplam = setteki kitap-türü üye sayısı,
 *   kesin = kesin-yok üye sayısı, digerEksik = belirsiz sebepli eksik üye sayısı
 * @returns {{atla:boolean, sebep:string}}
 */
function atlamaKarari({ toplam, kesin, digerEksik }) {
  if (!(kesin > 0)) return { atla: false, sebep: 'kesin-yok üye yok' };
  if (digerEksik > 0) return { atla: false, sebep: `${digerEksik} üye belirsiz sebeple eksik (ertelenir)` };
  if (toplam <= 1) return { atla: false, sebep: 'set tek üyeli — atlanamaz' };
  if (kesin > toplam * TAVAN_ORANI) {
    return { atla: false, sebep: `tavan: ${kesin}/${toplam} üye atlanacaktı (> %${TAVAN_ORANI * 100})` };
  }
  return { atla: true, sebep: `${kesin}/${toplam} üye atlandı` };
}

/** Log satırı (sabit biçim — bekçiler bunu arar). SAF. */
function logSatiri(setId, { kitapId, ad, sebep }) {
  return `${ISARET} UYE ATLANDI ${setId}: ${kitapId} "${ad || '-'}" — ${sebep}`;
}

/** Bildirim metni. SAF. */
const bildirimMetni = (setAdi, ad, kitapId) => `${setAdi}: ${ad || kitapId} atlandı — İmpark'ta içerik yok`;

const yyyymmdd = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};
const guvenli = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);

function damgaDizini(env = process.env) {
  return env.EMPP_UYE_ATLA_BILDIRIM_DIZINI
    || path.join(os.homedir(), '.empp-agent', 'uye-atla-bildirim');
}

/**
 * Günde set×kitap başına 1 bildirim: damga dosyası yoksa yazar ve true döner; varsa false.
 * Dosya yazılamazsa true (bildirim kaybolmasın; en kötü tekrar eder). FIRLATMAZ.
 */
function damgaAl({ setId, kitapId, dizin, simdi = new Date() }) {
  try {
    fs.mkdirSync(dizin, { recursive: true });
    const dosya = path.join(dizin, `${guvenli(setId)}-${guvenli(kitapId)}-${yyyymmdd(simdi)}`);
    fs.writeFileSync(dosya, `${simdi.toISOString()}\n`, { flag: 'wx' });
    return true;
  } catch (e) {
    return !(e && e.code === 'EEXIST');
  }
}

/**
 * `bildir kosucu "<set>: <kitap> atlandı — İmpark'ta içerik yok" -p yuksek`. Günlük tekilleştirme
 * damgayla. FIRLATMAZ. @returns {boolean} bu çağrıda gönderildi mi
 */
function bildirimGonder({ setId, setAdi, kitapId, ad, env = process.env, simdi = new Date(), dizin,
  gonder = null, warn = () => {} }) {
  if (env.EMPP_BILDIRIM === '0') return false;
  if (!damgaAl({ setId, kitapId, dizin: dizin || damgaDizini(env), simdi })) return false;
  const args = ['kosucu', bildirimMetni(setAdi || setId, ad, kitapId), '-p', 'yuksek'];
  try {
    if (gonder) gonder(args);
    else {
      const ikili = env.EMPP_BILDIR_IKILI || path.join(os.homedir(), '.local', 'bin', 'bildir');
      const [komut, komutArgs] = ikiliKomutu(ikili, args);
      const ps = spawn(komut, komutArgs, { stdio: 'ignore', detached: true, timeout: 20000, windowsHide: true });
      ps.on('error', (e) => warn(`${ISARET} üye atlama bildirimi gönderilemedi: ${e.message}`));
      ps.unref();
    }
  } catch (e) {
    warn(`${ISARET} üye atlama bildirimi gönderilemedi: ${e.message}`);
  }
  return true;
}

/**
 * `/result` gövdesine giden rapor alanları: `{atlananUyeler, uyeAtlandiNotu}` ya da {} (liste boşsa).
 * Yeni DB sütunu YOK: sunucu bilinmeyen alanı atar; metin ajan günlüğü/sonuç notu için. SAF.
 * @param {Array<{kitapId:string, ad?:string, sebep?:string}>} liste
 */
function govdeAlanlari(liste) {
  const l = Array.isArray(liste) ? liste.filter((a) => a && a.kitapId != null) : [];
  if (!l.length) return {};
  const not = `${ISARET} UYE ATLANDI (${l.length}): `
    + l.map((a) => `${a.kitapId} "${a.ad || '-'}" — ${a.sebep || 'içerik yok'}`).join('; ');
  return { atlananUyeler: l, uyeAtlandiNotu: not.slice(0, 600) };
}

/**
 * Üreteç işaret metninden (`empp-uretec.json`, Buffer|string) `atlananUyeler` manifest alanı. Yoksa/
 * bozuksa []. SAF, FIRLATMAZ. Ajan (zip) ve kabul kapıları (dizin/asar — tools/kabul/atlanan-uyeler.js)
 * AYNI ayrıştırmayı kullanır.
 * @returns {Array<{kitapId:string, ad:string, sebep:string}>}
 */
function isaretAyristir(metin) {
  try {
    if (metin == null) return [];
    const j = JSON.parse(Buffer.isBuffer(metin) ? metin.toString('utf8') : String(metin));
    return (j && Array.isArray(j.atlananUyeler) ? j.atlananUyeler : [])
      .filter((a) => a && a.kitapId != null && String(a.kitapId).trim() !== '')
      .map((a) => ({ kitapId: String(a.kitapId), ad: String(a.ad || ''), sebep: String(a.sebep || '') }));
  } catch (_) { return []; }
}

/**
 * Build zip'indeki üreteç işaretinden `atlananUyeler` (yoksa/bozuksa []). FIRLATMAZ.
 * @returns {Array<{kitapId:string, ad:string, sebep:string}>}
 */
function zipIsaretindenOku(zipYolu, dizin = null) {
  try {
    const d = dizin || M.zipDizini(zipYolu);
    const g = d.get(URETEC_ISARETI);
    if (!g || g.dizin) return [];
    return isaretAyristir(M.zipGirdiOku(zipYolu, g));
  } catch (_) { return []; }
}

/** İki listeyi kitapId'ye göre birleştirir (ilk görülen kalır). SAF. */
function birlestir(...listeler) {
  const gorulen = new Map();
  for (const l of listeler) {
    for (const a of Array.isArray(l) ? l : []) {
      if (a && a.kitapId != null && !gorulen.has(String(a.kitapId))) gorulen.set(String(a.kitapId), a);
    }
  }
  return [...gorulen.values()];
}

module.exports = {
  govdeAlanlari, birlestir, zipIsaretindenOku, isaretAyristir, URETEC_ISARETI,
  ISARET, TAVAN_ORANI, imparkTeklif404mu, indirme404mu, atlamaKarari, logSatiri, bildirimMetni,
  damgaAl, bildirimGonder, damgaDizini,
};
