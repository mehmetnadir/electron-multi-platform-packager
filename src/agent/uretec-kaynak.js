'use strict';

/**
 * ÜRETEÇ KAYNAĞI — r2-kur'un KAYNAK ADIMI (2026-10-02, şef kararı: "üreteç r2-kur'un kaynak adımıdır").
 * Kaynak arşivi ve önceki R2 build'i (tabanUrl) OLMAYAN setin build.zip'ini `index-ureteci.js` kurar;
 * runner sonra zinciri AYNEN sürdürür (içerik kapısı → merdiven → set eki → imKeys → yazma kapısı →
 * R2 → tamamla). Sözleşme: book-update `exesiz-kaynak-sozlesmesi.md` §K, §5, §6a.
 *
 * Bu modül runner'a üç şey verir:
 *   - `uretecAcik(env)`: `EMPP_INDEX_URETECI=0` ile kapanır (varsayılan AÇIK; kapalıyken eski §6a "BEKLER").
 *   - `kalipSec`: aynı KURUMUN (kurum.txt) arşivli build'i — tek kapaklı İmpark motoru taşıyan, en yeni.
 *   - `listeCoz`: claim `setListesi` > `EMPP_SET_LISTESI_DIZINI` dosyası > Worker'ın KV'den kurduğu
 *     `…/go/<kisaKod>/web-stream/config/settings.json` (DB'de liste boş setler: 45485/45487/45496).
 *   - `uretecKaynagi`: hepsini bağlar; ERTELENECEK durumlar (liste/kalıp/tema yok, kitap alınamadı)
 *     `gecici` hatadır → runner kirayı + kurma kilidini bırakır, `failed` YAZMAZ (§6a ile aynı ilke).
 *
 * YAYINCI TABLOSU (bilinçli dar): kurum ve tema yalnız ölçülmüş yayıncılar için. Flashy: kalıp
 * (arşivde Flashy build'i) ve tema (web-proxy-modern çevrimdışı kabuğu) YOK → `uretec-kalip-yok` /
 * `uretec-tema-yok` ile ERTELENİR; YDS kabuğuyla YAYINLANMAZ (şef kararı 02.10).
 */

const fs = require('fs');
const path = require('path');
const M = require('./icerik-merdiven');
const U = require('./index-ureteci');
const setEk = require('./set-uyelik-ek');

const ISARET = '[uretec]';
/** Yayıncı adı (küçük harf, tr) → { kurum, tema }. tema: 'kalip' = kalıbın Web-Z kökü (sf425). */
const YAYINCILAR = Object.freeze({
  'yds publishing': { kurum: '60', tema: 'kalip' },
});
const WORKER_KOKU = 'https://akillitahta.ndr.ist';

class UretecKaynakHatasi extends Error {
  /** @param {string} kod makine okur (`uretec-liste-yok` …)  @param {{gecici?: boolean}} [o] */
  constructor(kod, mesaj, { gecici = true } = {}) {
    super(`${ISARET} ${kod}: ${mesaj}`);
    this.kod = kod;
    this.gecici = gecici;
  }
}

function uretecAcik(env = process.env) {
  return String(env.EMPP_INDEX_URETECI == null ? '1' : env.EMPP_INDEX_URETECI) !== '0';
}

/** Yayıncı kaydı (yoksa null). SAF. */
function yayinciBul(ad) {
  const k = String(ad == null ? '' : ad).trim().toLocaleLowerCase('tr');
  return YAYINCILAR[k] || null;
}

/**
 * Arşivden kalıp: `<kok>/<set>/build.zip`, kalıbın kurum.txt'si istenen kurum, tek kapaklı İmpark
 * motoru var (`kalipOku`). Birden çoksa kaynak.json `yazilma` (yoksa zip mtime) en yeni. I/O: okuma.
 * @returns {{zip:string, set:string, kurum:string}|null}
 */
function kalipSec({ arsivKoku, kurum }) {
  let adaylar = [];
  try { adaylar = fs.readdirSync(arsivKoku, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch (_) { return null; }
  const uygun = [];
  for (const d of adaylar) {
    const zip = path.join(arsivKoku, d.name, 'build.zip');
    if (!fs.existsSync(zip)) continue;
    let k;
    try { k = U.kalipOku(zip); } catch (_) { continue; }
    if (String(k.kurum || '') !== String(kurum)) continue;
    let zaman = 0;
    try {
      const kj = JSON.parse(fs.readFileSync(path.join(arsivKoku, d.name, 'kaynak.json'), 'utf8'));
      zaman = Date.parse(kj.yazilma) || 0;
    } catch (_) { /* kayıt yok */ }
    if (!zaman) { try { zaman = fs.statSync(zip).mtimeMs; } catch (_) { zaman = 0; } }
    uygun.push({ zip, set: d.name, kurum: String(kurum), zaman, kabuk: k.kabuk });
  }
  uygun.sort((a, b) => b.zaman - a.zaman);
  return uygun[0] || null;
}

/**
 * Worker `config/settings.json` (KV'den kurulur) → panel listesi biçimi
 * (`assetId | başlık |  | contentType | grup`; link → `link:<url> | başlık`). Anahtar sırası korunur. SAF.
 */
function ayarlardanListe(ayar) {
  const books = ayar && ayar.books && typeof ayar.books === 'object' ? ayar.books : null;
  if (!books) return null;
  const satirlar = [];
  for (const b of Object.values(books)) {
    if (!b || typeof b !== 'object') continue;
    const temiz = (s) => String(s == null ? '' : s).replace(/[|\n\r]/g, ' ').trim();
    if (b.type === 'link' || b.url) {
      if (/^https?:\/\/\S+$/i.test(String(b.url || ''))) satirlar.push(`link:${b.url} | ${temiz(b.title) || 'Kısayol'}`);
      continue;
    }
    if (b.assetId == null || b.assetId === '') continue;
    satirlar.push(`${temiz(b.assetId)} | ${temiz(b.title)} |  | ${temiz(b.contentType)} | ${temiz(b.group)}`);
  }
  return satirlar.length ? satirlar.join('\n') : null;
}

/** Worker'dan settings.json (tarayıcı UA; webz alanı UA'sız 403). */
async function varsayilanAyarGetir(url) {
  const r = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
    signal: AbortSignal.timeout(20000),
  });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/**
 * Set listesi: claim > dosya yedeği > Worker KV (kisaKod varsa). Hiçbiri yoksa null.
 * @returns {Promise<{ham:string, kaynak:string}|null>}
 */
async function listeCoz({ job, env = process.env, ayarGetir = varsayilanAyarGetir, workerKoku = WORKER_KOKU }) {
  const c = setEk.setListesiCoz({ job, env });
  if (c) return c;
  const kod = job && job.kisaKod ? String(job.kisaKod).trim() : '';
  if (!/^[a-z0-9]{3,12}$/i.test(kod)) return null;
  const url = `${workerKoku}/go/${kod}/web-stream/config/settings.json`;
  const ham = ayarlardanListe(await ayarGetir(url));
  return ham ? { ham, kaynak: `kv:${kod}` } : null;
}

/** Zip'i olmayan oyun/çalışma kâğıdı için çevrimiçi Web-Z adresi (kisaKod varsa). SAF. */
function webzAdresiKur(job, workerKoku = WORKER_KOKU) {
  const kod = job && job.kisaKod ? String(job.kisaKod).trim() : '';
  if (!/^[a-z0-9]{3,12}$/i.test(kod)) return null;
  return (g) => (g && g.anahtar ? `${workerKoku}/go/${kod}/web-stream/${g.anahtar}/index.html` : null);
}

/**
 * Üreteç kaynağı: build.zip'i `zipPath`e kurar. Ertelenecek her durum `UretecKaynakHatasi(gecici)`.
 * @param {{job:object, zipPath:string, work:string, arsivKoku:string, log?:Function,
 *   anahtarliMi:(id:string)=>Promise<boolean>, env?:object, uret?:Function, listeCozFn?:Function,
 *   onbellek?:string, getir?:Function, indir?:Function}} o
 * @returns {Promise<{rapor:object, liste:{ham:string, kaynak:string}}>}
 */
async function uretecKaynagi(o) {
  const log = o.log || (() => {});
  const { job } = o;
  const liste = await (o.listeCozFn || listeCoz)({ job, env: o.env || process.env }).catch((e) => {
    throw new UretecKaynakHatasi('uretec-liste-yok', `Web-Z listesi okunamadı (${String(e && e.message || e).slice(0, 160)})`);
  });
  if (!liste) throw new UretecKaynakHatasi('uretec-liste-yok', 'Web-Z listesi yok (claim/dosya/KV)');
  const yay = yayinciBul(job.publisherName);
  if (!yay) {
    throw new UretecKaynakHatasi('uretec-kalip-yok', `yayıncı tablosunda yok: ${job.publisherName || '-'} (kurum/tema ölçülmedi)`);
  }
  const kalip = kalipSec({ arsivKoku: o.arsivKoku, kurum: yay.kurum });
  if (!kalip) throw new UretecKaynakHatasi('uretec-kalip-yok', `kurum ${yay.kurum} için arşivde motor kalıbı yok`);
  log(`${ISARET} ${job.bookId}: liste ${liste.kaynak}, kalıp ${kalip.set} (kurum ${kalip.kurum})`);
  let rapor;
  try {
    rapor = await (o.uret || U.uret)({
      setId: String(job.bookId), setAdi: job.bookTitle || '', listeHam: liste.ham, kalipZip: kalip.zip,
      cikti: o.zipPath, calisma: path.join(o.work, 'uretec'), duzen: U.DUZEN.OTOMATIK,
      aktivasyon: U.AKTIVASYON.OTOMATIK, anahtarliMi: o.anahtarliMi,
      kabuk: yay.tema === 'kalip' ? 'kalip' : null, webzAdresi: webzAdresiKur(job),
      onbellek: o.onbellek || M.icerikOnbellekKoku(), getir: o.getir, indir: o.indir, log,
    });
  } catch (e) {
    if (e instanceof U.UretecHatasi) {
      // Tema/kitap/liste/aktivasyon-düzen: ERTELE (§6a). Kalıp/menü/io: üreteç kusuru → kalıcı (görünür).
      const gecici = [U.KOD.TEMA_YOK, U.KOD.KITAP_EKSIK, U.KOD.LISTE_YOK, U.KOD.AKT_DUZEN].includes(e.kod);
      throw new UretecKaynakHatasi(e.kod === U.KOD.TEMA_YOK ? 'uretec-tema-yok' : `uretec-${e.kod}`, e.message, { gecici });
    }
    if (e && e.gecici) throw new UretecKaynakHatasi('uretec-ag', String(e.message || e).slice(0, 200));
    throw e;
  }
  return { rapor, liste };
}

module.exports = {
  ISARET, YAYINCILAR, WORKER_KOKU, UretecKaynakHatasi, uretecAcik, yayinciBul, kalipSec,
  ayarlardanListe, listeCoz, webzAdresiKur, uretecKaynagi,
};
