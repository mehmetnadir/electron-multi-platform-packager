'use strict';

/**
 * Kabuk eki (Seçenek B) — SAF modül. Mac ek üretir, ProBook uygular; ikisi de bu JS'i kullanır.
 * Tasarım: `~/.empp-agent/arastirma/set-kabuk-0510/kabuk-eki-tasarim.md` §2, §3, §5 Parça A.
 *
 * - `girdiParmakIzi`: Swift'e giden girdinin kanonik JSON sha256'sı (anahtar sırasından bağımsız).
 * - `ekPaketle` / `ekAc`: kendi zip yazıcısı/okuyucusu (node zlib deflateRaw; dış `zip` YOK).
 *   Tarih alanları sabit (1980-01-01) → aynı girdi bayt-aynı zip.
 * - `ekGetir` / `sonOku`: CDN okuma; `getir(url)→{status, buffer}` enjekte edilir. FIRLATMAZ.
 *
 * Yol beyaz listesi varsayılanı `set-kabuk-tazele.js` `kabukDosyasiMi`'dir (döngüsel require'a
 * karşı TEMBEL yüklenir; o dosya bu modülü require edebilir).
 */

const crypto = require('crypto');
const zlib = require('zlib');

const SOZLESME = 1;
const MANIFEST_ADI = 'kabuk-ek.json';
const VARSAYILAN_TAVAN = 2 * 1024 * 1024;
/**
 * Yükleme anındaki tavan (bilgi amaçlı). Denetim için TEK KAYNAK `tavanAl()`'dır: env'i her
 * çağrıda okur ve `{tavan}` seçeneğini tanır. Bu sabite güvenen çağıran env değişimini görmez.
 */
const EK_TAVAN_BAYT = Number(process.env.EMPP_KABUK_EK_TAVAN || VARSAYILAN_TAVAN);
const CDN_TABAN = (process.env.EMPP_KABUK_EK_CDN || 'https://cdn.ydspublishing.com')
  .replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/126.0 Safari/537.36';
const GETIR_SURESI_MS = 30000;
const HATA_KODLARI = new Set(['yok', 'bayat', 'bozuk', 'tavan', 'yol']);

class EkHatasi extends Error {
  /** @param {'yok'|'bayat'|'bozuk'|'tavan'|'yol'} kod @param {string} mesaj */
  constructor(kod, mesaj) {
    super(mesaj || kod);
    this.name = 'EkHatasi';
    this.kod = HATA_KODLARI.has(kod) ? kod : 'bozuk';
  }
}

/** Geçerli tavan — TEK KAYNAK (çağrı anında env okunur; `{tavan}` seçeneği önceliklidir). */
function tavanAl(o = {}) {
  if (Number.isFinite(o.tavan) && o.tavan > 0) return o.tavan;
  const n = Number(process.env.EMPP_KABUK_EK_TAVAN || VARSAYILAN_TAVAN);
  return Number.isFinite(n) && n > 0 ? n : VARSAYILAN_TAVAN;
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/i;

/** Kanonik JSON: nesne anahtarları sıralı (özyinelemeli), dizi sırası korunur. SAF. */
function kanonikJson(v) {
  if (v === null || typeof v !== 'object') {
    const s = JSON.stringify(v);
    return s === undefined ? 'null' : s;
  }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return JSON.stringify(sha256(v));
  if (typeof v.toJSON === 'function') return kanonikJson(v.toJSON());
  if (Array.isArray(v)) {
    return `[${v.map((x) => (x === undefined ? 'null' : kanonikJson(x))).join(',')}]`;
  }
  if (v instanceof Map) return kanonikJson(Object.fromEntries(v));
  const anahtarlar = Object.keys(v)
    .filter((k) => v[k] !== undefined && typeof v[k] !== 'function').sort();
  return `{${anahtarlar.map((k) => `${JSON.stringify(k)}:${kanonikJson(v[k])}`).join(',')}}`;
}

/** Map/obje ad→(Buffer | sha256 hex) → {ad: sha256} (sıralı anahtar kanonikte gelir). */
function shaHaritasi(h, alan) {
  const g = h instanceof Map ? [...h] : Object.entries(h || {});
  const c = {};
  for (const [ad, v] of g) {
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) c[String(ad)] = sha256(v);
    else if (typeof v === 'string' && HEX64.test(v)) c[String(ad)] = v.toLowerCase();
    else throw new TypeError(`${alan}.${ad}: Buffer ya da sha256 hex bekleniyor`);
  }
  return c;
}

/**
 * Girdi parmak izi (girdiSha). SAF.
 * @param {{kip: string, girdi: object, kapaklar: Map|object, a1Girdi?: Map|object|null}} o
 * @returns {string} sha256 hex
 */
function girdiParmakIzi({ kip, girdi, kapaklar, a1Girdi = null }) {
  if (typeof kip !== 'string' || !kip) throw new TypeError('kip gerekli');
  if (!girdi || typeof girdi !== 'object') throw new TypeError('girdi nesne olmalı');
  const govde = {
    sozlesme: SOZLESME,
    kip,
    girdi,
    kapaklar: shaHaritasi(kapaklar, 'kapaklar'),
    a1Girdi: a1Girdi == null ? null : shaHaritasi(a1Girdi, 'a1Girdi'),
  };
  return sha256(Buffer.from(kanonikJson(govde), 'utf8'));
}

// ── Yol güvenliği ───────────────────────────────────────────────────────────────────────────

/** Klasör listesi verilmediğinde `images/<klasör>.png|jpg` kuralı için güvenli ad kümesi. */
const GUVENLI_AD = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const herGuvenliAd = {
  has: (ad) => typeof ad === 'string' && GUVENLI_AD.test(ad) && !ad.includes('..'),
};

function varsayilanBeyazListe(klasorler) {
  // Tembel: set-kabuk-tazele.js bu modülü require ederse döngü yükleme anında kırılmasın.
  const { kabukDosyasiMi } = require('./set-kabuk-tazele');
  if (typeof kabukDosyasiMi !== 'function') throw new Error('kabukDosyasiMi bulunamadı');
  const k = klasorler == null ? herGuvenliAd
    : (klasorler instanceof Set ? klasorler : new Set([...klasorler].map(String)));
  return (yol) => kabukDosyasiMi(yol, k);
}

/** Yol biçim denetimi; ihlalde EkHatasi('yol'). SAF. */
function yolDenetle(yol, beyazListe) {
  if (typeof yol !== 'string' || !yol) throw new EkHatasi('yol', 'boş yol');
  if (yol.includes('\\')) throw new EkHatasi('yol', `ters bölü: ${yol}`);
  if (yol.startsWith('/') || /^[A-Za-z]:/.test(yol)) {
    throw new EkHatasi('yol', `mutlak yol: ${yol}`);
  }
  if (yol.includes('\0')) throw new EkHatasi('yol', 'NUL içeren yol');
  const parcalar = yol.split('/');
  if (parcalar.some((p) => p === '' || p === '.' || p === '..')) {
    throw new EkHatasi('yol', `geçersiz segment: ${yol}`);
  }
  if (parcalar[0].startsWith('_')) throw new EkHatasi('yol', `_ önekli kök: ${yol}`);
  if (yol === MANIFEST_ADI) throw new EkHatasi('yol', `ayrılmış ad: ${yol}`);
  if (beyazListe && !beyazListe(yol)) throw new EkHatasi('yol', `beyaz liste dışı: ${yol}`);
}

function beyazListeSec(o = {}) {
  if (typeof o.beyazListe === 'function') return o.beyazListe;
  return varsayilanBeyazListe(o.klasorler);
}

// ── Manifest ────────────────────────────────────────────────────────────────────────────────

/**
 * Manifest kurar. SAF (yalnız `uretildi` saatten gelir; test için verilebilir).
 * @returns {object} {sozlesme, bookId, kisaKod, kip, girdiSha, webzSettingsSha, tabanSurum,
 *   tabanSha256, arac, uretildi, dosyalar: [{yol, sha256, boyut}] yol sıralı, toplamBayt}
 */
function manifestKur({
  bookId, kisaKod = null, kip, girdiSha, webzSettingsSha = null, tabanSurum = null,
  tabanSha256 = null, arac = null, dosyalar, uretildi = null,
}) {
  if (bookId == null || String(bookId) === '') throw new TypeError('bookId gerekli');
  if (typeof kip !== 'string' || !kip) throw new TypeError('kip gerekli');
  if (typeof girdiSha !== 'string' || !HEX64.test(girdiSha)) {
    throw new TypeError('girdiSha sha256 hex olmalı');
  }
  if (!(dosyalar instanceof Map)) throw new TypeError('dosyalar Map<yol,Buffer> olmalı');
  const liste = [...dosyalar].map(([yol, b]) => {
    if (!Buffer.isBuffer(b)) throw new TypeError(`dosyalar.${yol}: Buffer bekleniyor`);
    return { yol: String(yol), sha256: sha256(b), boyut: b.length };
  }).sort((a, b) => (a.yol < b.yol ? -1 : a.yol > b.yol ? 1 : 0));
  return {
    sozlesme: SOZLESME,
    bookId: String(bookId),
    kisaKod: kisaKod == null ? null : String(kisaKod),
    kip,
    girdiSha: girdiSha.toLowerCase(),
    webzSettingsSha,
    tabanSurum,
    tabanSha256,
    arac: arac ? { kaynak: arac.kaynak ?? null, sha256: arac.sha256 ?? null } : null,
    uretildi: uretildi || new Date().toISOString(),
    dosyalar: liste,
    toplamBayt: liste.reduce((t, d) => t + d.boyut, 0),
  };
}

// ── Zip yazıcı / okuyucu (deterministik, ZIP64 yok) ─────────────────────────────────────────

const DOS_SAAT = 0; // 00:00:00
const DOS_TARIH = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const UTF8_BAYRAGI = 0x0800;

/** Girdiler [{ad, veri}] → zip Buffer. Sıra korunur. SAF. */
function zipYaz(girdiler) {
  const yerel = [];
  const merkez = [];
  let ofset = 0;
  for (const { ad, veri } of girdiler) {
    const adB = Buffer.from(ad, 'utf8');
    const crc = zlib.crc32(veri) >>> 0;
    const sik = zlib.deflateRawSync(veri, { level: 9 });
    const yontem = sik.length < veri.length ? 8 : 0;
    const govde = yontem === 8 ? sik : veri;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(UTF8_BAYRAGI, 6);
    lh.writeUInt16LE(yontem, 8);
    lh.writeUInt16LE(DOS_SAAT, 10);
    lh.writeUInt16LE(DOS_TARIH, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(govde.length, 18);
    lh.writeUInt32LE(veri.length, 22);
    lh.writeUInt16LE(adB.length, 26);
    lh.writeUInt16LE(0, 28);
    yerel.push(lh, adB, govde);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0x0314, 4); // Unix, 2.0
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(UTF8_BAYRAGI, 8);
    ch.writeUInt16LE(yontem, 10);
    ch.writeUInt16LE(DOS_SAAT, 12);
    ch.writeUInt16LE(DOS_TARIH, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(govde.length, 20);
    ch.writeUInt32LE(veri.length, 24);
    ch.writeUInt16LE(adB.length, 28);
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    ch.writeUInt32LE(ofset, 42);
    merkez.push(ch, adB);
    ofset += lh.length + adB.length + govde.length;
  }
  const md = Buffer.concat(merkez);
  const son = Buffer.alloc(22);
  son.writeUInt32LE(0x06054b50, 0);
  son.writeUInt16LE(girdiler.length, 8);
  son.writeUInt16LE(girdiler.length, 10);
  son.writeUInt32LE(md.length, 12);
  son.writeUInt32LE(ofset, 16);
  return Buffer.concat([...yerel, md, son]);
}

/** Zip girdi sayısı tavanı (kabuk ~20 dosya; bomba/merkez dizin şişirmesine karşı). */
const GIRDI_TAVANI = 512;

/**
 * Zip Buffer → Map<ad, Buffer>. Biçim/CRC/çift ad hatası → EkHatasi('bozuk'). SAF.
 * Şişirmeden ÖNCE (zip bombası): girdi sayısı ≤ 512, tek girdi açık boyu ≤ 4×tavan, açık boy
 * toplamı ≤ 8×tavan, her yerel başlık ofseti tekil, veri aralıkları çakışmaz.
 * @param {Buffer} buf @param {{tavan?: number}} [o]
 */
function zipOku(buf, o = {}) {
  const bozuk = (m) => new EkHatasi('bozuk', `zip bozuk: ${m}`);
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw bozuk('çok kısa');
  const tavan = tavanAl(o);
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  }
  if (e < 0) throw bozuk('merkez dizin sonu yok');
  const adet = buf.readUInt16LE(e + 10);
  const mdBoy = buf.readUInt32LE(e + 12);
  const mdOfs = buf.readUInt32LE(e + 16);
  if (adet === 0xffff || mdOfs === 0xffffffff) throw bozuk('ZIP64 desteklenmez');
  if (adet > GIRDI_TAVANI) throw bozuk(`girdi sayısı ${adet} > ${GIRDI_TAVANI}`);
  if (mdOfs + mdBoy > e) throw bozuk('merkez dizin taşıyor');
  // 1. geçiş: yalnız başlıklar (şişirme YOK).
  const girdiler = [];
  const adlar = new Set();
  const ofsetler = new Set();
  let acikToplam = 0;
  let p = mdOfs;
  for (let n = 0; n < adet; n++) {
    if (p + 46 > mdOfs + mdBoy || buf.readUInt32LE(p) !== 0x02014b50) throw bozuk('merkez başlık');
    const bayrak = buf.readUInt16LE(p + 8);
    const yontem = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const sikBoy = buf.readUInt32LE(p + 20);
    const acikBoy = buf.readUInt32LE(p + 24);
    const adBoy = buf.readUInt16LE(p + 28);
    const ekBoy = buf.readUInt16LE(p + 30);
    const yorumBoy = buf.readUInt16LE(p + 32);
    const lhOfs = buf.readUInt32LE(p + 42);
    if (p + 46 + adBoy > mdOfs + mdBoy) throw bozuk('merkez başlık adı taşıyor');
    const ad = buf.subarray(p + 46, p + 46 + adBoy).toString('utf8');
    p += 46 + adBoy + ekBoy + yorumBoy;
    if (bayrak & 0x1) throw bozuk(`şifreli girdi: ${ad}`);
    if (yontem !== 0 && yontem !== 8) throw bozuk(`desteklenmeyen yöntem ${yontem}: ${ad}`);
    if (adlar.has(ad)) throw bozuk(`çift girdi: ${ad}`);
    adlar.add(ad);
    if (ofsetler.has(lhOfs)) throw bozuk(`aynı yerel başlığa işaret eden girdi: ${ad}`);
    ofsetler.add(lhOfs);
    if (acikBoy > tavan * 4) throw bozuk(`açık boy ${acikBoy} > 4×tavan: ${ad}`);
    acikToplam += acikBoy;
    if (acikToplam > tavan * 8) throw bozuk(`açık boy toplamı ${acikToplam} > 8×tavan`);
    if (yontem === 0 && sikBoy !== acikBoy) throw bozuk(`saklı girdi boyu uyuşmuyor: ${ad}`);
    if (lhOfs + 30 > mdOfs || buf.readUInt32LE(lhOfs) !== 0x04034b50) {
      throw bozuk(`yerel başlık: ${ad}`);
    }
    const vOfs = lhOfs + 30 + buf.readUInt16LE(lhOfs + 26) + buf.readUInt16LE(lhOfs + 28);
    if (vOfs + sikBoy > mdOfs) throw bozuk(`veri taşıyor: ${ad}`);
    girdiler.push({ ad, yontem, crc, sikBoy, acikBoy, lhOfs, vOfs });
  }
  // Veri aralıkları [yerel başlık, veri sonu) çakışmamalı.
  const sirali = [...girdiler].sort((a, b) => a.lhOfs - b.lhOfs);
  for (let i = 1; i < sirali.length; i++) {
    const once = sirali[i - 1];
    if (once.vOfs + once.sikBoy > sirali[i].lhOfs) {
      throw bozuk(`çakışan girdiler: ${once.ad} / ${sirali[i].ad}`);
    }
  }
  // 2. geçiş: şişirme (her girdi beyan edilen boyla sınırlı).
  const c = new Map();
  for (const g of girdiler) {
    const ham = buf.subarray(g.vOfs, g.vOfs + g.sikBoy);
    let veri;
    if (g.yontem === 0) veri = Buffer.from(ham);
    else {
      try {
        veri = zlib.inflateRawSync(ham, { maxOutputLength: Math.max(g.acikBoy, 1) });
      } catch (err) {
        throw bozuk(`açılamadı: ${g.ad} (${String(err && err.message).slice(0, 60)})`);
      }
    }
    if (veri.length !== g.acikBoy) throw bozuk(`boyut uyuşmuyor: ${g.ad}`);
    if ((zlib.crc32(veri) >>> 0) !== g.crc) throw bozuk(`CRC uyuşmuyor: ${g.ad}`);
    c.set(g.ad, veri);
  }
  return c;
}

// ── Paketle / Aç ────────────────────────────────────────────────────────────────────────────

/** Manifest listesi ile Map kümesini + sha/boyutu kıyaslar; fark → EkHatasi('bozuk'). */
function kumeDenetle(manifest, dosyalar) {
  const liste = Array.isArray(manifest.dosyalar) ? manifest.dosyalar : null;
  if (!liste) throw new EkHatasi('bozuk', 'manifest dosya listesi yok');
  const mYollar = new Set();
  let toplam = 0;
  for (const d of liste) {
    if (!d || typeof d.yol !== 'string') throw new EkHatasi('bozuk', 'manifest girdisi geçersiz');
    if (mYollar.has(d.yol)) throw new EkHatasi('bozuk', `manifestte çift yol: ${d.yol}`);
    mYollar.add(d.yol);
    const v = dosyalar.get(d.yol);
    if (!v) throw new EkHatasi('bozuk', `manifestteki dosya zipte yok: ${d.yol}`);
    if (v.length !== d.boyut) throw new EkHatasi('bozuk', `boyut uyuşmuyor: ${d.yol}`);
    if (sha256(v) !== String(d.sha256).toLowerCase()) {
      throw new EkHatasi('bozuk', `sha256 uyuşmuyor: ${d.yol}`);
    }
    toplam += v.length;
  }
  const fazla = [...dosyalar.keys()].filter((y) => !mYollar.has(y));
  if (fazla.length) {
    throw new EkHatasi('bozuk', `manifestte olmayan dosya: ${fazla.slice(0, 3).join(', ')}`);
  }
  if (manifest.toplamBayt !== undefined && manifest.toplamBayt !== toplam) {
    throw new EkHatasi('bozuk', `toplamBayt uyuşmuyor (${manifest.toplamBayt} ≠ ${toplam})`);
  }
}

/**
 * Ek zip'i üretir. Aynı manifest + dosyalar → bayt-aynı Buffer.
 * @param {{manifest: object, dosyalar: Map<string, Buffer>}} o
 * @param {{beyazListe?: (yol: string) => boolean, klasorler?: Iterable<string>,
 *   tavan?: number}} [s]
 * @returns {Buffer}
 */
function ekPaketle({ manifest, dosyalar }, s = {}) {
  if (!manifest || typeof manifest !== 'object') throw new TypeError('manifest gerekli');
  if (!(dosyalar instanceof Map)) throw new TypeError('dosyalar Map<yol,Buffer> olmalı');
  const bl = beyazListeSec(s);
  for (const y of dosyalar.keys()) yolDenetle(y, bl);
  kumeDenetle(manifest, dosyalar);
  const yollar = [...dosyalar.keys()].sort();
  const zip = zipYaz([
    { ad: MANIFEST_ADI, veri: Buffer.from(kanonikJson(manifest), 'utf8') },
    ...yollar.map((ad) => ({ ad, veri: dosyalar.get(ad) })),
  ]);
  const tavan = tavanAl(s);
  if (zip.length > tavan) throw new EkHatasi('tavan', `ek ${zip.length} bayt > tavan ${tavan}`);
  return zip;
}

/**
 * Ek zip'ini açar ve doğrular (tasarım §3 madde 1-3).
 * @param {Buffer} buf
 * @param {{bookId: string|number, girdiSha: string, kip: string,
 *   beyazListe?: (yol: string) => boolean, klasorler?: Iterable<string>, tavan?: number}} b
 * @returns {{manifest: object, dosyalar: Map<string, Buffer>}}
 */
function ekAc(buf, b = {}) {
  if (!Buffer.isBuffer(buf)) throw new EkHatasi('bozuk', 'Buffer bekleniyor');
  const tavan = tavanAl(b);
  if (buf.length > tavan) throw new EkHatasi('tavan', `ek ${buf.length} bayt > tavan ${tavan}`);
  const girdiler = zipOku(buf, { tavan });
  const mHam = girdiler.get(MANIFEST_ADI);
  if (!mHam) throw new EkHatasi('bozuk', `${MANIFEST_ADI} yok`);
  let manifest;
  try { manifest = JSON.parse(mHam.toString('utf8')); } catch (_) {
    throw new EkHatasi('bozuk', `${MANIFEST_ADI} JSON değil`);
  }
  if (!manifest || typeof manifest !== 'object') {
    throw new EkHatasi('bozuk', 'manifest nesne değil');
  }
  if (manifest.sozlesme !== SOZLESME) {
    throw new EkHatasi('bayat', `sözleşme ${manifest.sozlesme} ≠ ${SOZLESME}`);
  }
  if (String(manifest.bookId) !== String(b.bookId)) {
    throw new EkHatasi('bayat', `bookId ${manifest.bookId} ≠ ${b.bookId}`);
  }
  if (String(manifest.girdiSha || '').toLowerCase() !== String(b.girdiSha || '').toLowerCase()) {
    throw new EkHatasi('bayat', `girdiSha uyuşmuyor (${String(manifest.girdiSha).slice(0, 12)})`);
  }
  if (manifest.kip !== b.kip) throw new EkHatasi('bayat', `kip ${manifest.kip} ≠ ${b.kip}`);
  girdiler.delete(MANIFEST_ADI);
  const bl = beyazListeSec(b);
  for (const y of girdiler.keys()) yolDenetle(y, bl);
  for (const d of Array.isArray(manifest.dosyalar) ? manifest.dosyalar : []) {
    yolDenetle(d && d.yol, bl);
  }
  kumeDenetle(manifest, girdiler);
  return { manifest, dosyalar: girdiler };
}

// ── İmza (ed25519) ──────────────────────────────────────────────────────────────────────────

function anahtarNesnesi(anahtar, ozel) {
  if (anahtar && typeof anahtar === 'object' && anahtar.asymmetricKeyType) return anahtar;
  return ozel ? crypto.createPrivateKey(anahtar) : crypto.createPublicKey(anahtar);
}

/**
 * Ek zip'ini imzalar (Mac). ed25519 dışı anahtar → TypeError.
 * @param {Buffer} buf @param {string|crypto.KeyObject} ozelAnahtarPem @returns {string} base64
 */
function ekImzala(buf, ozelAnahtarPem) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('Buffer bekleniyor');
  const k = anahtarNesnesi(ozelAnahtarPem, true);
  if (k.asymmetricKeyType !== 'ed25519') throw new TypeError('ed25519 özel anahtar bekleniyor');
  return crypto.sign(null, buf, k).toString('base64');
}

/**
 * İmzayı doğrular (ProBook). Geçersiz girdi/anahtar → false. FIRLATMAZ.
 * @param {Buffer} buf @param {string} imzaB64 @param {string|crypto.KeyObject} acikAnahtarPem
 * @returns {boolean}
 */
function ekImzaDogrula(buf, imzaB64, acikAnahtarPem) {
  try {
    if (!Buffer.isBuffer(buf) || typeof imzaB64 !== 'string') return false;
    const temiz = imzaB64.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(temiz)) return false;
    const imza = Buffer.from(temiz, 'base64');
    if (imza.length !== 64) return false;
    const k = anahtarNesnesi(acikAnahtarPem, false);
    if (k.asymmetricKeyType !== 'ed25519') return false;
    return crypto.verify(null, buf, k, imza);
  } catch (_) {
    return false;
  }
}

// ── R2 anahtarları / CDN ────────────────────────────────────────────────────────────────────

const ID_DESENI = /^[A-Za-z0-9_-]+$/;
function idDenetle(bookId) {
  const s = String(bookId ?? '');
  if (!ID_DESENI.test(s)) throw new TypeError(`geçersiz bookId: ${s}`);
  return s;
}
function shaDenetle(sha) {
  const s = String(sha ?? '').toLowerCase();
  if (!HEX64.test(s)) throw new TypeError('sha sha256 hex olmalı');
  return s;
}

const ekAnahtari = (bookId, sha) => `kabuk-ek/${idDenetle(bookId)}/${shaDenetle(sha)}.zip`;
const imzaAnahtari = (bookId, sha) => `kabuk-ek/${idDenetle(bookId)}/${shaDenetle(sha)}.imza`;
const retAnahtari = (bookId, sha) => `kabuk-ek/${idDenetle(bookId)}/${shaDenetle(sha)}.ret.json`;
const sonAnahtari = (bookId) => `kabuk-ek/${idDenetle(bookId)}/son.json`;

// Hepsi önbellek kırıcılı (`?t=<ms>`): CDN'de önbelleğe girmiş eski 404 yeni yüklemeyi gizlemesin.
const ekUrl = (bookId, sha, simdi = Date.now()) =>
  `${CDN_TABAN}/${ekAnahtari(bookId, sha)}?t=${simdi}`;
const imzaUrl = (bookId, sha, simdi = Date.now()) =>
  `${CDN_TABAN}/${imzaAnahtari(bookId, sha)}?t=${simdi}`;
const retUrl = (bookId, sha, simdi = Date.now()) =>
  `${CDN_TABAN}/${retAnahtari(bookId, sha)}?t=${simdi}`;
const sonUrl = (bookId, simdi = Date.now()) => `${CDN_TABAN}/${sonAnahtari(bookId)}?t=${simdi}`;

/**
 * Varsayılan getir: global fetch + tarayıcı UA + 30 sn. Ağ hatasında fırlatır.
 * `tavan` verilirse ve `content-length` onu aşıyorsa gövde OKUNMAZ (bellek), `tavanAsimi` döner.
 */
async function varsayilanGetir(url, { tavan = null } = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(GETIR_SURESI_MS),
    redirect: 'follow',
  });
  const uzunluk = Number(r.headers && r.headers.get ? r.headers.get('content-length') : NaN);
  if (r.status === 200 && tavan != null && Number.isFinite(uzunluk) && uzunluk > tavan) {
    try { if (r.body && r.body.cancel) await r.body.cancel(); } catch (_) { /* yok sayılır */ }
    return { status: r.status, buffer: Buffer.alloc(0), tavanAsimi: uzunluk };
  }
  const buffer = r.status === 200 ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
  return { status: r.status, buffer };
}

const hataMetni = (e) => String((e && e.message) || e).slice(0, 200);

/**
 * CDN'den eki alır, İMZAYI doğrular, sonra ayrıştırır. FIRLATMAZ.
 * Sıra: zip GET → 200 ise `acikAnahtar` şart → tavan → `.imza` GET → imza doğrula → `ekAc`.
 * İmzasız / geçersiz imzalı zip ayrıştırılmaz. 404 → yok (ya da ret); 403 ve diğerleri → ağ
 * hatası (bot kapısı "yok" sanılmasın).
 * @param {{bookId: string|number, girdiSha: string, kip: string,
 *   acikAnahtar?: string|crypto.KeyObject,
 *   getir?: (url: string) => Promise<{status: number, buffer: Buffer}>,
 *   beyazListe?: Function, klasorler?: Iterable<string>, tavan?: number}} o
 * @returns {Promise<{durum: 'var', manifest: object, dosyalar: Map<string, Buffer>}
 *   | {durum: 'yok'} | {durum: 'ret', neden: string}
 *   | {durum: 'hata', kod: string, mesaj: string}>}
 *   kod: 'ag' | 'imza' | 'imza-anahtari-yok' | EkHatasi kodu
 */
async function ekGetir({ bookId, girdiSha, kip, acikAnahtar, getir = varsayilanGetir, ...s }) {
  const hata = (kod, mesaj) => ({ durum: 'hata', kod, mesaj });
  let url;
  try { url = ekUrl(bookId, girdiSha); } catch (e) { return hata('yol', hataMetni(e)); }
  const tavan = tavanAl(s);
  let r;
  // Tavan getiriciye de verilir: content-length aşarsa gövde hiç okunmaz (bellek).
  try { r = await getir(url, { tavan }); } catch (e) { return hata('ag', hataMetni(e)); }
  const status = r && r.status;
  if (status === 200) {
    if (r.tavanAsimi != null) return hata('tavan', `ek ${r.tavanAsimi} bayt (content-length) > tavan ${tavan}`);
    if (!acikAnahtar) return hata('imza-anahtari-yok', 'ek imza açık anahtarı verilmedi');
    const buf = r.buffer;
    if (!Buffer.isBuffer(buf)) return hata('bozuk', 'gövde Buffer değil');
    if (buf.length > tavan) return hata('tavan', `ek ${buf.length} bayt > tavan ${tavan}`);
    let ri;
    try { ri = await getir(imzaUrl(bookId, girdiSha)); } catch (e) {
      return hata('ag', `imza okunamadı: ${hataMetni(e)}`);
    }
    if (!ri || ri.status === 404) return hata('imza', 'imza dosyası yok');
    if (ri.status !== 200) return hata('ag', `imza HTTP ${ri.status}`);
    const imza = Buffer.from(ri.buffer || '').toString('utf8');
    if (!ekImzaDogrula(buf, imza, acikAnahtar)) return hata('imza', 'imza geçersiz');
    try {
      const { manifest, dosyalar } = ekAc(buf, { bookId, girdiSha, kip, ...s });
      return { durum: 'var', manifest, dosyalar };
    } catch (e) {
      return hata(e instanceof EkHatasi ? e.kod : 'bozuk', hataMetni(e));
    }
  }
  if (status !== 404) return hata('ag', `HTTP ${status} (${url})`);
  // Ek yok → kalıcı ret işareti var mı?
  let rr;
  try { rr = await getir(retUrl(bookId, girdiSha)); } catch (e) {
    return hata('ag', `ret işareti okunamadı: ${hataMetni(e)}`);
  }
  if (rr && rr.status === 200) {
    let neden = 'ret işareti (neden okunamadı)';
    try {
      const j = JSON.parse(Buffer.from(rr.buffer || '').toString('utf8'));
      if (j && j.neden) neden = String(j.neden);
    } catch (_) { /* gövde bozuk: ret yine geçerli, neden bilinmiyor */ }
    return { durum: 'ret', neden };
  }
  if (!rr || rr.status !== 404) return hata('ag', `ret işareti HTTP ${rr && rr.status}`);
  return { durum: 'yok' };
}

/** `son.json`'u okur; yok/ağ hatası/bozuk → null. FIRLATMAZ. */
async function sonOku({ bookId, getir = varsayilanGetir }) {
  try {
    const r = await getir(sonUrl(bookId));
    if (!r || r.status !== 200) return null;
    const j = JSON.parse(Buffer.from(r.buffer || '').toString('utf8'));
    return j && typeof j === 'object' ? j : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  EK_TAVAN_BAYT, SOZLESME, MANIFEST_ADI, CDN_TABAN, GIRDI_TAVANI, EkHatasi, tavanAl,
  kanonikJson, girdiParmakIzi, manifestKur, ekPaketle, ekAc, yolDenetle,
  ekImzala, ekImzaDogrula,
  ekAnahtari, imzaAnahtari, retAnahtari, sonAnahtari, ekUrl, imzaUrl, retUrl, sonUrl,
  ekGetir, sonOku, zipYaz, zipOku, varsayilanGetir,
};
