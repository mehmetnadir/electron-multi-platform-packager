'use strict';

/**
 * KAYNAK R2 — exe'siz kaynak Dalga B / B4: runner'ın `r2-kur` / `r2-al` yolları.
 * Sözleşme: book-update `.claude/docs/exesiz-kaynak-sozlesmesi.md` §3, §5; plan
 * `exesiz-dalga-b-plani.md` (B4). Claim şekli: book-update `services/api/src/lib/ajan-kaynak-turu.ts`
 * `nextJobKaynakSemasi` (zod) — ortak fikstür `fixtures/claim-kaynak-ornekleri.json` (KAYNAK.md).
 *
 * Bu modül BAĞIMLILIKSIZDIR (yalnız node çekirdeği): runner-helpers `parseNextJob` claim
 * doğrulamasını buradan alır; runner.js uç istemcisini ve r2-kur yayın akışını. I/O (HTTP,
 * parça yükleme, özet, kapı) çağırandan ENJEKTE edilir — testler sahte uçla koşar.
 *
 *   claimKaynakDogrula   zod şemasının düz JS ikizi (fikstürdeki her örnek iki tarafta aynı sonuç)
 *   kaynakKurEkle        `kaynak-kur` yeteneği YALNIZ yüksek bantta (ofis ya da serbest bayrağı)
 *   kaynakR2Ekle         `kaynak-r2` yeteneği HER ZAMAN (bu runner r2-al/r2-kur claim'ini anlar)
 *   merdivenKaniti       merdiven + set eki raporundan {vsler, icerikSurumleri}
 *   r2OzetDogrula        r2-al: indirilen build'in boyut + sha256'sı claim'le birebir
 *   kaynakUcIstemcisi    B2 uçları (presign-multipart / tamamla / birak) — TEK YER
 *   r2KurYayinla         kapı → presign → yükle → tamamla; her başarısızlıkta `birak`
 */

const KAYNAK_TURLERI = Object.freeze(['manuel', 'arsiv-gerekli', 'r2-kur', 'r2-al']);
const KAYNAK_SURUM_DESENI = /^2\.\d+\.\d+$/;
const SHA256_DESENI = /^[0-9a-f]{64}$/;
const KAYNAK_GET_OMRU_TAVANI_SN = 6 * 60 * 60;
const R2_S3_HOST_DESENI = /^[a-z0-9][a-z0-9.-]*\.r2\.cloudflarestorage\.com$/;
const IMPARK_HOST_DESENI = /(^|\.)yayincilik\.net$/i;
const KAYNAK_YOLU_DESENI = /^(?:\/[a-z0-9][a-z0-9.-]*)?\/kaynak\/([A-Za-z0-9_-]{1,64})\/(2\.\d+\.\d+)\/build\.zip$/;
// zod 3 `z.string().datetime({ offset: true })`: saniye zorunlu, kesir serbest, Z ya da ±hh[:mm].
const ISO_ZAMAN_DESENI = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$/;

const KAYNAK_KUR_YETENEGI = 'kaynak-kur';
// Sunucu `r2-al`'ı YALNIZ bunu bildiren ajana verir (inceleme E1): eski runner r2 claim'ini anlamaz.
const KAYNAK_R2_YETENEGI = 'kaynak-r2';
const R2_ISARETI = '[kaynak-r2]';

/* ───────────────────────────── Claim doğrulama (SAF) ───────────────────────────── */

const imparkAdresiMi = (u) => /\/(Uploads|Cozumler)\//i.test(u);

/** WHATWG href'i ham dizgiyle birebir mi (ters eğik çizgi / boşluk / kontrol karakteri yok). */
function kanonikUrlMi(u) {
  if (typeof u !== 'string' || /[\\\s\x00-\x1f\x7f]/.test(u)) return false;
  try { return new URL(u).href === u; } catch (_) { return false; }
}

/**
 * İmzalı R2 GET (`kaynak/<setId>/<sürüm>/build.zip`, SigV4, ≤6 sa) → {setId, surum}; değilse null.
 * book-update `imzaliKaynakUrlCoz` ile birebir.
 */
function imzaliKaynakUrlCoz(u) {
  if (!kanonikUrlMi(u)) return null;
  const url = new URL(u);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (IMPARK_HOST_DESENI.test(url.hostname) || !R2_S3_HOST_DESENI.test(url.hostname)) return null;
  if (/\.exe$/i.test(url.pathname) || imparkAdresiMi(url.pathname)) return null;
  const q = url.searchParams;
  if (q.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256') return null;
  if (!q.get('X-Amz-Credential') || !q.get('X-Amz-Date')) return null;
  if (!SHA256_DESENI.test(q.get('X-Amz-Signature') || '')) return null;
  const omur = Number(q.get('X-Amz-Expires'));
  if (!Number.isSafeInteger(omur) || omur < 1 || omur > KAYNAK_GET_OMRU_TAVANI_SN) return null;
  const m = KAYNAK_YOLU_DESENI.exec(url.pathname);
  return m ? { setId: m[1], surum: m[2] } : null;
}

/** book-update `isManualSourceUrl` (argümansız: yalnız yol kuralı). */
function manuelYoluMu(u) {
  if (typeof u !== 'string' || !u) return false;
  let yol;
  try { yol = new URL(u).pathname; } catch (_) { yol = u.split(/[?#]/)[0]; }
  return /\/(sources|kaynak)\//.test(yol);
}

const zamanGecerli = (s) => typeof s === 'string' && ISO_ZAMAN_DESENI.test(s) && !Number.isNaN(Date.parse(s));
const surumGecerli = (s) => typeof s === 'string' && KAYNAK_SURUM_DESENI.test(s);
const shaGecerli = (s) => typeof s === 'string' && SHA256_DESENI.test(s);

/**
 * Claim yanıtının KAYNAK alanları sözleşmeye uyuyor mu (zod `nextJobKaynakSemasi` ikizi). SAF.
 * @param {object} c ham claim (parseNextJob'a gelen gövde — downloadUrl '' ile doldurulmamış)
 * @returns {{gecerli: true} | {gecerli: false, neden: string}}
 */
function claimKaynakDogrula(c) {
  const ret = (neden) => ({ gecerli: false, neden });
  if (!c || typeof c !== 'object') return ret('claim nesne değil');
  const tur = c.kaynakTuru;
  if (!KAYNAK_TURLERI.includes(tur)) return ret(`kaynakTuru dört değerden biri olmalı (${String(tur)})`);
  if (tur === 'manuel') {
    if (typeof c.downloadUrl !== 'string') return ret("manuel'de downloadUrl zorunlu");
    if (!manuelYoluMu(c.downloadUrl)) return ret('manuel kaynak /sources/ ya da /kaynak/ olmalı');
    if (imparkAdresiMi(c.downloadUrl)) return ret('manuel kaynak İmpark adresi olamaz');
    return { gecerli: true };
  }
  if (c.downloadUrl !== undefined) return ret(`${tur} yanıtında downloadUrl OLMAZ`);
  if (tur === 'arsiv-gerekli') {
    if (c.bilgiUrl !== undefined && c.bilgiUrl !== null && typeof c.bilgiUrl !== 'string') {
      return ret('bilgiUrl dize olmalı');
    }
    return { gecerli: true };
  }
  if (!surumGecerli(c.kaynakSurumu)) return ret('kaynakSurumu 2.<panel kodu>.<sayaç> olmalı');
  if (tur === 'r2-kur') {
    if (!zamanGecerli(c.kurulumBitis)) return ret('kurulumBitis zorunlu (ISO, saat dilimli)');
    if (c.tabanUrl !== undefined && !imzaliKaynakUrlCoz(c.tabanUrl)) return ret('tabanUrl imzalı R2 GET olmalı');
    if (c.tabanSha256 !== undefined && !shaGecerli(c.tabanSha256)) return ret('tabanSha256 64 küçük onaltılık olmalı');
    if ((c.tabanUrl === undefined) !== (c.tabanSha256 === undefined)) return ret('tabanUrl ve tabanSha256 birlikte gelir');
    return { gecerli: true };
  }
  // r2-al
  const yol = imzaliKaynakUrlCoz(c.kaynakUrl);
  if (!yol) return ret('kaynakUrl imzalı R2 GET olmalı (kaynak/<setId>/<sürüm>/build.zip, ≤6 sa); İmpark/.exe/public adres olamaz');
  if (!shaGecerli(c.kaynakSha256)) return ret('kaynakSha256 zorunlu (64 küçük onaltılık)');
  if (!Number.isSafeInteger(c.kaynakBoyut) || c.kaynakBoyut <= 0) return ret('kaynakBoyut pozitif tam sayı olmalı');
  if (yol.surum !== c.kaynakSurumu) return ret(`kaynakUrl sürümü (${yol.surum}) kaynakSurumu (${c.kaynakSurumu}) değil`);
  return { gecerli: true };
}

/* ───────────────────────────── Yetenek (SAF) ───────────────────────────── */

/**
 * `kaynak-kur` (build'i kurup R2'ye 1–3 GB yükleme) YALNIZ yüksek bantta: ofis ağı ya da
 * `kaynak-kur-serbest.istek` bayrağı (macOS kuralıyla aynı desen). `acik=false` acil kapatma.
 */
function kaynakKurIzinli({ acik = true, ofiste = false, serbest = false } = {}) {
  return acik !== false && (ofiste === true || serbest === true);
}

/** caps'e `kaynak-kur` ekler (izinliyse, yoksa); girdi dizisi değişmez. */
/**
 * caps'e `kaynak-r2` ekler — KONUMDAN BAĞIMSIZ, her zaman (r2-al indirmesi her bantta yapılır;
 * yalnız 1–3 GB YÜKLEME olan `kaynak-kur` banda bağlıdır). Girdi dizisi değişmez, tekrar eklemez.
 */
function kaynakR2Ekle(caps) {
  const liste = Array.isArray(caps) ? caps.filter((c) => c !== KAYNAK_R2_YETENEGI) : [];
  return [...liste, KAYNAK_R2_YETENEGI];
}

function kaynakKurEkle(caps, durum) {
  const liste = Array.isArray(caps) ? caps.filter((c) => c !== KAYNAK_KUR_YETENEGI) : [];
  return kaynakKurIzinli(durum) ? [...liste, KAYNAK_KUR_YETENEGI] : liste;
}

/* ───────────────────────────── Merdiven kanıtı (SAF) ───────────────────────────── */

const SURUM_OLCULDU = new Set(['GUNCEL', 'GERIDE']);

function kitapSirasi(kitap) {
  if (kitap === '.' || kitap === '' || kitap == null) return 1;
  const m = /^book(\d+)$/i.exec(String(kitap).replace(/\/+$/, ''));
  return m ? Number(m[1]) : null;
}

/**
 * Merdiven (`icerikMerdiveni` dönüşü: `satirlar[{kitap, id, durum, vs}]`) + set eki raporu
 * (`eklenen[{dizin, id, vs}]`) → `vsler` ({n: vs}, yazma kapısının `kitaplar[].vs`'i) ve
 * `/result` için `icerikSurumleri` [{id, vs}]. Yalnız ÖLÇÜLMÜŞ (GUNCEL/GERIDE) sürümler girer.
 */
function merdivenKaniti({ merdiven = null, setEki = null } = {}) {
  const vsler = {};
  const icerik = new Map();
  const ekle = (n, id, vs) => {
    if (!Number.isSafeInteger(vs) || vs < 0 || id == null || String(id) === '') return;
    if (n != null && vsler[n] == null) vsler[n] = vs;
    if (!icerik.has(String(id))) icerik.set(String(id), vs);
  };
  for (const s of (merdiven && Array.isArray(merdiven.satirlar) ? merdiven.satirlar : [])) {
    if (s && SURUM_OLCULDU.has(s.durum)) ekle(kitapSirasi(s.kitap), s.id, Number(s.vs));
  }
  for (const e of (setEki && Array.isArray(setEki.eklenen) ? setEki.eklenen : [])) {
    if (e) ekle(kitapSirasi(e.dizin), e.id, Number(e.vs));
  }
  return { vsler, icerikSurumleri: [...icerik].map(([id, vs]) => ({ id, vs })) };
}

/** Yazma kapısı `kitaplar` → `tamamla` gövdesi (`vs`/`id` yoksa null — B1 `kitapKanitiSemasi`). */
function tamamlaKitaplari(kitaplar) {
  return (Array.isArray(kitaplar) ? kitaplar : []).map((k) => ({
    n: k.n,
    id: k.id == null ? null : String(k.id),
    vs: Number.isSafeInteger(k.vs) ? k.vs : null,
    icerik: k.icerik === true,
    kapak: k.kapak === true,
  }));
}

/**
 * Yazma kapısı `webzVarliklari` → `tamamla` gövdesi (02.10, 45550): listedeki İmpark-dışı Web-Z
 * varlıkları (Games/Videos) — `{n, id, yol: 'config'|'ad'|'link', icerik, kapak}`. Sunucu liste kimliğini
 * `kitaplar ∪ webzVarliklari` içinde arar; alanı tanımayan (eski) sunucu yok sayar.
 * `yol: 'link'` = index üretecinin link kartına çevirdiği liste öğesi (zip'i yok; build'de kitap değil).
 */
function tamamlaWebzVarliklari(liste) {
  return (Array.isArray(liste) ? liste : [])
    .filter((w) => w && Number.isSafeInteger(w.n) && w.n >= 1 && w.id != null && String(w.id) !== '')
    .map((w) => ({
      n: w.n,
      id: String(w.id),
      yol: w.yol === 'ad' || w.yol === 'link' ? w.yol : 'config',
      icerik: w.icerik === true,
      kapak: w.kapak === true,
    }));
}

/* ───────────────────────────── Hata sınıfı ───────────────────────────── */

/**
 * `gecici=true`: ağ / 5xx / kilit çekişmesi — failed YAZILMAZ, kira bırakılır.
 * `gecici=false`: kapı reddi, sözleşme dışı yanıt, sha uyuşmazlığı — failed + bildirim.
 * Mesajlar `isTransientNetworkError` desenlerine BİLEREK uymaz (sınıf alanla taşınır).
 */
class KaynakR2Hatasi extends Error {
  constructor(mesaj, { gecici = false, nedenler = [], nedenKodlari = [] } = {}) {
    super(`${R2_ISARETI} ${mesaj}`);
    this.name = 'KaynakR2Hatasi';
    this.gecici = gecici;
    this.nedenler = nedenler;
    this.nedenKodlari = nedenKodlari;
  }
}

/**
 * r2-al: indirilen dosyanın özeti claim'le birebir mi. Uymazsa KALICI hata (yanlış nesne ya da
 * bozuk aktarım; paket bu build'den ÜRETİLMEZ).
 * @param {{sha256: string, boyut: number}} oz
 * @param {{sha256: string, boyut?: number|null}} beklenen
 */
function r2OzetDogrula(oz, beklenen) {
  if (beklenen.boyut != null && oz.boyut !== beklenen.boyut) {
    throw new KaynakR2Hatasi(`build boyutu tutmuyor (${oz.boyut} ≠ claim ${beklenen.boyut}) — kullanılmadı`);
  }
  if (oz.sha256 !== beklenen.sha256) {
    throw new KaynakR2Hatasi(`build sha256 tutmuyor (${oz.sha256} ≠ claim ${beklenen.sha256}) — kullanılmadı`);
  }
  return true;
}

/* ───────────────────────────── Uç istemcisi (B2) ───────────────────────────── */

/**
 * B2 ajan uçları — biçim bu TEK yerde (B2 sözleşmesi netleşince yalnız burası değişir).
 * VARSAYIM (mevcut `result/presign-multipart` + `result/complete-multipart` istemci kalıbı):
 *   POST agents/:id/kaynak/presign-multipart {bookId, platform, surum, partCount}
 *     → 200 {uploadId, r2ObjectKey, contentType?, urls:[{partNumber, url}]}
 *   POST agents/:id/kaynak/tamamla {bookId, platform, surum, sha256, boyut, kitaplar,
 *     webzVarliklari? (yalnız doluysa), uploadId, r2ObjectKey, parts:[{partNumber, etag}]}
 *     → 200 | 409 {nedenler:[...]}
 *   POST agents/:id/kaynak/birak {bookId, platform, surum, sebep, uploadId?, nedenler?, nedenKodlari?} → 200
 *     (yerel kapı reddinde sebep:'kapi-reddi' + nedenler + nedenKodlari)
 * @param {{ istek: (yol: string, govde: object) => Promise<{status: number, data: any}>,
 *   sleep?: (ms: number) => Promise<void>, warn?: Function, deneme?: number, bekleMs?: number }} o
 *   `istek` göreli yolu (`kaynak/tamamla`) ajan köküne bağlar, ağ hatasında {status: 0} döner.
 */
function kaynakUcIstemcisi({
  istek, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), warn = () => {},
  deneme = Number(process.env.EMPP_KAYNAK_UC_DENEME || 6),
  bekleMs = Number(process.env.EMPP_KAYNAK_UC_BEKLE_MS || 15000),
} = {}) {
  const guvenli = async (yol, govde) => {
    try { return await istek(yol, govde); } catch (e) { return { status: 0, data: { error: String(e && e.message || e) } }; }
  };
  /** 5xx / ağ (0) → artan bekleyişle yeniden; son yanıt döner. */
  const dene = async (yol, govde) => {
    let r = null;
    for (let i = 1; i <= deneme; i++) {
      // eslint-disable-next-line no-await-in-loop
      r = await guvenli(yol, govde);
      if (!(r.status >= 500 || r.status === 0)) return r;
      if (i < deneme) {
        const b = Math.min(bekleMs * i, 60000);
        warn(`${R2_ISARETI} ${yol} HTTP ${r.status} (deneme ${i}/${deneme}) — ${b / 1000} sn sonra tekrar`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(b);
      }
    }
    return r;
  };
  const ozet = (d) => JSON.stringify(d === undefined ? null : d).slice(0, 300);

  return {
    async presignMultipart({ bookId, platform, surum, partCount }) {
      const r = await dene('kaynak/presign-multipart', { bookId, platform, surum, partCount });
      if (r.status === 200 && r.data && r.data.uploadId && Array.isArray(r.data.urls) && r.data.urls.length) {
        return r.data;
      }
      // 409: kurma kilidi bizde değil / çekişme — başka ajan kuruyor olabilir → geçici.
      const gecici = r.status >= 500 || r.status === 0 || r.status === 409;
      throw new KaynakR2Hatasi(`presign-multipart reddedildi: HTTP ${r.status} ${ozet(r.data)}`, { gecici });
    },
    /** 409 gövdesi (B2): `{nedenler: string[], nedenKodlari: string[]}`.
     * @returns {Promise<{durum: 'tamam', veri: any} | {durum: 'red', nedenler: string[], nedenKodlari: string[]}>} */
    async tamamla(govde) {
      const r = await dene('kaynak/tamamla', govde);
      if (r.status === 200) return { durum: 'tamam', veri: r.data };
      if (r.status === 409 && r.data && Array.isArray(r.data.nedenler)) {
        const kodlar = Array.isArray(r.data.nedenKodlari) ? r.data.nedenKodlari.map(String) : [];
        return { durum: 'red', nedenler: r.data.nedenler.map(String), nedenKodlari: kodlar };
      }
      // 409 nedenler'siz (ör. lease_not_held) ya da 5xx/ağ → geçici; diğer 4xx → kalıcı.
      const gecici = r.status >= 500 || r.status === 0 || r.status === 409;
      throw new KaynakR2Hatasi(`tamamla yanıtı beklenmedik: HTTP ${r.status} ${ozet(r.data)}`, { gecici });
    },
    /** FIRLATMAZ. 409 = kilit bu ajanda değil (sunucu zaten bırakmış ya da süresi dolup başka ajana
     * geçmiş) — yalnız uyarı, hata DEĞİL. @returns {Promise<boolean>} */
    async birak({ bookId, platform, surum, sebep, uploadId, nedenler, nedenKodlari }) {
      const liste = (a) => (Array.isArray(a) ? a.map((x) => String(x).slice(0, 300)).slice(0, 20) : null);
      const nd = liste(nedenler);
      const nk = liste(nedenKodlari);
      const r = await dene('kaynak/birak', {
        bookId, platform, surum, sebep: String(sebep || '').slice(0, 300), ...(uploadId ? { uploadId } : {}),
        // Yerel kapı reddi (sebep 'kapi-reddi'): sunucu kaynak_kur_ret_at yazsın, aynı sete hemen yeni r2-kur vermesin.
        ...(nd ? { nedenler: nd } : {}), ...(nk ? { nedenKodlari: nk } : {}),
      });
      if (r.status === 200) return true;
      warn(r.status === 409
        ? `${R2_ISARETI} kaynak/birak HTTP 409 — kilit bu ajanda değil (sunucu bırakmış): ${bookId} ${surum}`
        : `${R2_ISARETI} kaynak/birak HTTP ${r.status} — kilit kurulumBitis'te düşer: ${bookId} ${surum}`);
      return false;
    },
  };
}

/* ───────────────────────────── r2-kur yayın akışı ───────────────────────────── */

/**
 * Kurulmuş build'i (`zipYolu`) R2'ye yazar: yazma kapısı (B5) → kilit süresi → özet → presign →
 * parça yükleme → tamamla. Herhangi bir adım düşerse `birak` ÇAĞRILIR ve KaynakR2Hatasi fırlar:
 * kapı reddi / 409 nedenler / diğer 4xx → kalıcı (paket ÜRETİLMEZ, failed + bildirim);
 * ağ / 5xx / kilit süresi → geçici (failed yazılmaz, kira bırakılır).
 * @param {{ job: object, zipYolu: string, setListesi?: string|null, oncekiBoyut?: number|null,
 *   vsler?: Record<number, number>, istemci: ReturnType<typeof kaynakUcIstemcisi>,
 *   kapi: Function, ozet: (zip: string) => Promise<{sha256: string, boyut: number}>,
 *   parcalariYukle: (zip: string, boyut: number, parcaBoyutu: number, urls: any[], contentType?: string)
 *     => Promise<Array<{partNumber: number, etag: string}>>,
 *   parcaBoyutu?: number, simdi?: number, log?: Function, tamamlaEki?: object }} o
 *   `tamamlaEki`: gövdeye eklenen alanlar (ör. üreteç özeti `uretec`).
 *   `gecerliSha256` + `gecerliSurum`: setin mevcut GEÇERLİ kaynak sürümü (claim `tabanUrl`/`tabanSha256`).
 *   İkisi de biliniyorsa ve kurulan build'in sha256'sı gecerliSha256'ya eşitse: R2'ye yükleme YOK, yeni
 *   sürüm kaydı YOK (kilit `birak` ile bırakılır); dönüş `{degismedi: true, surum: gecerliSurum}`.
 *   Biri bilinmiyorsa davranış değişmez (fail-safe: yeni sürüm kurulur).
 * @returns {Promise<{surum: string, sha256: string, boyut: number, kitaplar: object[], r2ObjectKey: string,
 *   ozet: object}>} `ozet` = `ozet()` dönüşü (md5 dahil — arşive yazım yeniden okumasın)
 */
async function r2KurYayinla({
  job, zipYolu, setListesi = null, oncekiBoyut = null, oncekiEnvanter = null, vsler = {}, istemci, kapi, ozet,
  parcalariYukle, parcaBoyutu = 64 * 1024 * 1024, simdi = Date.now(), log = () => {}, tamamlaEki = {},
  ekWebzVarliklari = [], gecerliSha256 = null, gecerliSurum = null,
}) {
  const surum = job.kaynakSurumu;
  const kimlik = { bookId: job.bookId, platform: job.platform, surum };
  let uploadId;
  const birakVeFirlat = async (hata, ek = {}) => {
    await istemci.birak({ ...kimlik, sebep: hata.message, uploadId, ...ek });
    throw hata;
  };

  const k = kapi({ zipYolu, setListesi, oncekiBoyut, oncekiEnvanter, tur: 'otomatik', vsler });
  if (!k.gecti) {
    return birakVeFirlat(
      new KaynakR2Hatasi(`yazma kapısı RED — R2'ye yazılmadı, eski sürüm geçerli kalır: ${k.nedenler.join(' | ')}`, { nedenler: k.nedenler }),
      { sebep: 'kapi-reddi', nedenler: k.nedenler, nedenKodlari: Array.isArray(k.nedenKodlari) ? k.nedenKodlari : [] },
    );
  }
  const bitis = Date.parse(job.kurulumBitis);
  if (Number.isFinite(bitis) && bitis <= simdi) {
    return birakVeFirlat(new KaynakR2Hatasi(`kurulum kilidi süresi doldu (${job.kurulumBitis}) — yükleme başlatılmadı`, { gecici: true }));
  }
  let oz;
  let parts;
  let basla;
  try {
    oz = await ozet(zipYolu);
    if (gecerliSha256 && gecerliSurum && oz.sha256 === gecerliSha256) {
      // İçerik değişmedi (03.10 72380: 2.0.11 ve 2.0.12 aynı sha, 0,27 GB boşuna yükleme).
      log(`${R2_ISARETI} r2-kur ${job.bookId}: içerik değişmedi (sha256 ${oz.sha256}) — mevcut ${gecerliSurum} kullanılıyor`);
      await istemci.birak({ ...kimlik, sebep: `icerik-degismedi (sha256 ${oz.sha256}) — mevcut ${gecerliSurum} geçerli` });
      return {
        degismedi: true, surum: gecerliSurum, sha256: oz.sha256, boyut: oz.boyut,
        kitaplar: tamamlaKitaplari(k.kitaplar), r2ObjectKey: null, ozet: oz,
      };
    }
    const partCount = Math.max(1, Math.ceil(oz.boyut / parcaBoyutu));
    basla = await istemci.presignMultipart({ ...kimlik, partCount });
    ({ uploadId } = basla);
    log(`${R2_ISARETI} r2-kur ${job.bookId} ${surum}: ${(oz.boyut / 1e9).toFixed(2)} GB, ${partCount} parça → ${basla.r2ObjectKey}`);
    parts = await parcalariYukle(zipYolu, oz.boyut, parcaBoyutu, basla.urls, basla.contentType);
  } catch (e) {
    if (e instanceof KaynakR2Hatasi) return birakVeFirlat(e);
    return birakVeFirlat(new KaynakR2Hatasi(`yükleme düştü: ${String(e && e.message || e).slice(0, 300)}`, { gecici: true }));
  }
  const kitaplar = tamamlaKitaplari(k.kitaplar);
  // Yazma kapısının eşledikleri + üretecin link kartları (aynı kimlik iki kez gitmez; kapınınki önce).
  const webzVarliklari = tamamlaWebzVarliklari([...(k.webzVarliklari || []), ...(ekWebzVarliklari || [])])
    .filter((w, i, a) => a.findIndex((x) => x.id === w.id) === i);
  if (Array.isArray(k.notlar) && k.notlar.length) {
    log(`${R2_ISARETI} yazma kapısı notları ${job.bookId} ${surum}: ${k.notlar.join(' | ')}`);
  }
  let t;
  try {
    t = await istemci.tamamla({
      ...kimlik, sha256: oz.sha256, boyut: oz.boyut, kitaplar,
      ...(webzVarliklari.length ? { webzVarliklari } : {}),
      ...(k.boyutGerekce ? { boyutGerekce: k.boyutGerekce } : {}),
      uploadId, r2ObjectKey: basla.r2ObjectKey, parts, ...tamamlaEki,
    });
  } catch (e) {
    return birakVeFirlat(e instanceof KaynakR2Hatasi ? e
      : new KaynakR2Hatasi(`tamamla düştü: ${String(e && e.message || e).slice(0, 300)}`, { gecici: true }));
  }
  if (t.durum === 'red') {
    const kodlar = t.nedenKodlari && t.nedenKodlari.length ? ` [${t.nedenKodlari.join(', ')}]` : '';
    // Sunucu kapı reddinde kilidi AYNI istekte bırakır ve reddi yazar (Ö4) → ayrıca birak YOK
    // (saha 02.10 59480: ikinci birak 409 kilit_yok döndü, "kilit asılı" diye yanlış okundu).
    log(`${R2_ISARETI} r2-kur ${job.bookId} ${surum}: sunucu kapısı reddetti — kilit sunucuda bırakıldı`);
    throw new KaynakR2Hatasi(`sunucu kapısı RED (HTTP 409)${kodlar} — build yüklendi ama geçerli sayılmadı, paket üretilmez: ${t.nedenler.join(' | ')}`, { nedenler: t.nedenler, nedenKodlari: t.nedenKodlari || [] });
  }
  log(`${R2_ISARETI} r2-kur ${job.bookId} ${surum}: tamamlandı (sha256 ${oz.sha256}, ${kitaplar.length} kitap)`);
  return {
    surum, sha256: oz.sha256, boyut: oz.boyut, kitaplar, r2ObjectKey: basla.r2ObjectKey, ozet: oz,
  };
}

module.exports = {
  KAYNAK_TURLERI, KAYNAK_KUR_YETENEGI, KAYNAK_R2_YETENEGI, R2_ISARETI, KAYNAK_GET_OMRU_TAVANI_SN,
  imzaliKaynakUrlCoz, claimKaynakDogrula, kanonikUrlMi,
  kaynakKurIzinli, kaynakKurEkle, kaynakR2Ekle,
  merdivenKaniti, tamamlaKitaplari, tamamlaWebzVarliklari,
  KaynakR2Hatasi, r2OzetDogrula, surumGecerli,
  kaynakUcIstemcisi, r2KurYayinla,
};
