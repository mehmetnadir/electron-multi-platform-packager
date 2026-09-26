'use strict';

/**
 * SET GÜNCELLEYİCİ — kurulu paketin İÇİNDE, Electron ana sürecinde koşar.
 *
 * Sözleşme: `.claude/docs/kitap-guncelleme-sozlesmesi.md` (2026-09-21 düzeltmesi)
 *
 * NE GÜNCELLENİR: setin **kabuğu** (uygulamanın açılması için gereken her şey —
 * tanım TEK kaynakta: `src/packaging/set-kabuk.js`; kök dosyaları + beyaz listedeki
 * kök dizinler, `_` ile başlayan yedek dizinler HARİÇ) ve setin **üyeliği** (kitap eklendi / çıkarıldı). Kitapların İÇERİĞİ bu kanaldan
 * güncellenmez — her kitap kendi ucundan bakımını sürdürür.
 *
 * İKİ KADEME (ağ ekonomisi):
 *   1) `surum.json` (birkaç yüz bayt) — yerel damga ile aynıysa BURADA DURULUR,
 *      manifest hiç indirilmez.
 *   2) `manifest.json` — `kabuk[]` içinden yalnız sha256'sı yerelden farklı
 *      dosyalar, `kitaplar[]` içinden yalnız ekle/çıkar kararları uygulanır.
 *
 * SIRA ZORUNLU (sözleşme §5): **önce kitap verisi, sonra kabuk.** Ters sırada
 * menü henüz yerinde olmayan bir kitabı gösterir. Üyelik adımlarından biri bile
 * başarısızsa kabuğa HİÇ DOKUNULMAZ ve yapılan üyelik hamleleri GERİ ALINIR —
 * böylece ne hayalet menü maddesi ne de yarım inmiş kitap kalır.
 *
 * TASARIM KARARLARI (ihlali arıza sayılır):
 *   • Node stdlib dışında bağımlılık YOK (bu dosya pakete olduğu gibi kopyalanır).
 *   • Ağ ve fs DIŞARIDAN enjekte edilebilir (`getir`, `arsiviIndir`, `fs`) — ama
 *     varsayılanları gerçek `http/https` ve gerçek `fs.promises`'tır. Testlerin bir
 *     kısmı GERÇEK HTTP sunucusu + GERÇEK geçici dizinle koşar; taşıma katmanı
 *     mock'la gizlenmez.
 *   • Hiçbir istisna dışarı sızmaz. 404 / ağ hatası / bozuk JSON / zaman aşımı →
 *     güncelleme atlanır, uygulama normal açılır.
 *   • Atomik yazım: geçici ada indir → boyut + sha256 doğrula → `rename`.
 *     Doğrulama tutmazsa HEDEFE DOKUNULMAZ.
 *   • Varsayılan RET: `yol`/`dizin` `..` içeriyorsa, mutlaksa, kök dışına
 *     çıkıyorsa, sha256/boyut alanı eksik-bozuksa → o öğe atlanır.
 *   • `setKimligi` yoksa kanal HİÇ çalışmaz ve GÜNLÜĞE yazılır. Sessiz atlama yasak.
 *   • Üyelik silmesi `EMPP_GUNCELLEME_SILME` kapısına TABİ DEĞİLDİR (karar
 *     manifestten açıkça gelir). O kapı yalnız kabuk artıkları içindir.
 *
 * İMZA (sözleşme G4, 2026-09-26): `manifest.json` ed25519 ile İMZALI olmalıdır. İmza
 * `manifest.json.sig` ucunda, manifestin HAM baytları üzerinde, base64 metin olarak durur.
 * Açık anahtar pakete gömülüdür (`empp-set.json` → `imza: {alg:'ed25519', acikAnahtar:<SPKI DER
 * base64>}`). Anahtar yoksa/bozuksa kanal HİÇ istek yapmaz; imzasız ya da imzası tutmayan manifest
 * reddedilir. Taban ve üyelik arşivi adresleri yalnız `https:` olabilir (tek istisna: yerel sınama
 * için 127.0.0.1/localhost/::1 üzerinde `http:` — sahada loopback'te sunucu yoktur).
 * `surum.json` imzasızdır: yalnız TETİKTİR, hiçbir dosya ondan yazılmaz.
 *
 * AÇIK MADDE: kitap arşivi diske AKIŞLA iner (`arsiviIndir`), ama arşivi açarken
 * dosya bellekte tutulur (`arsivCoz`). Çok büyük arşivlerde akışlı açma gerekirse
 * `arsivCoz` enjekte edilebilir — çekirdek değişmeden.
 */

const crypto = require('crypto');
const zlib = require('zlib');
const nodePath = require('path');

const ISARET = 'EMPP_SET_GUNCELLEME';
const VARSAYILAN_ZAMAN_ASIMI = 15000;
const VARSAYILAN_SET_ADI = 'empp-set.json';
const DAMGA_ADI = '.empp-set-guncelleme.json';
const GECICI_UZANTI = '.indirme';
const SILINECEK_UZANTI = '.empp-silinecek';
const GECICI_DIZIN = '.empp-gecici';
/** Kabuk dosyası üst sınırı — kabuk küçüktür, büyük gövde bozuk uç işaretidir. */
const KABUK_TAVANI = 64 * 1024 * 1024;
const SHA256_RE = /^[0-9a-f]{64}$/i;
/** Manifest imzasının ucu: `<kimlikKoku>/manifest.json` + bu uzantı (sözleşme G4). */
const IMZA_UZANTI = '.sig';
const IMZA_ALG = 'ed25519';
/** `http:`'nin kabul edildiği TEK yer: yerel sınama ucu (sahada loopback'te sunucu yok). */
const YEREL_HOSTLAR = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/* ------------------------------------------------------------------ kapılar */

/** `EMPP_SET_GUNCELLEME` — varsayılan AÇIK, kapatmak için `0`. */
function acikMi(env = process.env) {
  return String(env[ISARET] == null ? '' : env[ISARET]) !== '0';
}

/** `EMPP_GUNCELLEME_SILME` — varsayılan KAPALI. YALNIZ kabuk artıkları için. */
function silmeAcikMi(env = process.env) {
  return String(env.EMPP_GUNCELLEME_SILME == null ? '' : env.EMPP_GUNCELLEME_SILME) === '1';
}

/** `EMPP_GUNCELLEME_ZAMAN_ASIMI` — varsayılan 15000 ms. */
function zamanAsimiCoz(env = process.env) {
  const ham = Number(env.EMPP_GUNCELLEME_ZAMAN_ASIMI);
  return Number.isFinite(ham) && ham > 0 ? Math.floor(ham) : VARSAYILAN_ZAMAN_ASIMI;
}

/** `EMPP_GUNCELLEME_TABANI` env'i pakete gömülü tabanı EZER. */
function tabaniCoz(env = process.env, gomulu = '') {
  const e = env.EMPP_GUNCELLEME_TABANI;
  const secilen = (typeof e === 'string' && e.trim()) ? e.trim() : String(gomulu || '').trim();
  return secilen.replace(/\/+$/, '');
}

/* -------------------------------------------------------------- yol güvenliği */

/**
 * Uzaktan gelen göreli yol güvenli mi? Varsayılan RET.
 * Reddedilenler: boş, `\0`, mutlak (posix `/` veya Windows `C:`), herhangi bir
 * segmenti `..` / `.` / boş olan yollar.
 */
function yolGuvenliMi(yol) {
  if (typeof yol !== 'string') return false;
  const ham = yol.trim();
  if (!ham) return false;
  if (ham.indexOf('\0') !== -1) return false;
  const n = ham.replace(/\\/g, '/');
  if (n.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(n)) return false;
  for (const p of n.split('/')) {
    if (p === '' || p === '.' || p === '..') return false;
  }
  return true;
}

/** Kök + göreli yol → mutlak hedef. Kök dışına çıkıyorsa `null` (çift koruma). */
function hedefYoluCoz(kok, yol) {
  if (!yolGuvenliMi(yol)) return null;
  const k = nodePath.resolve(kok);
  const hedef = nodePath.resolve(k, yol.replace(/\\/g, '/'));
  if (hedef === k) return null;
  if (!hedef.startsWith(k + nodePath.sep)) return null;
  return hedef;
}

function sha256(veri) {
  return crypto.createHash('sha256').update(veri).digest('hex');
}

/* ------------------------------------------------------ imza + taşıma (G4) */

/**
 * Uzak adres güvenli mi? `https:` → evet. `http:` yalnız yerel sınama ucunda
 * (127.0.0.1 / localhost / ::1). Diğer her şey (http, ftp, file, bozuk) → HAYIR.
 */
function adresGuvenliMi(adres) {
  try {
    const u = new URL(String(adres));
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:') return YEREL_HOSTLAR.has(u.hostname);
    return false;
  } catch (e) { return false; }
}

/** Gömülü açık anahtarı (SPKI DER, base64) çözer; ed25519 değilse/bozuksa `null`. */
function acikAnahtarCoz(b64) {
  try {
    if (typeof b64 !== 'string' || !b64.trim()) return null;
    const k = crypto.createPublicKey({ key: Buffer.from(b64.trim(), 'base64'), format: 'der', type: 'spki' });
    return k.asymmetricKeyType === IMZA_ALG ? k : null;
  } catch (e) { return null; }
}

/**
 * Manifestin HAM baytları üzerindeki ed25519 imzası tutuyor mu? Saf; istisna fırlatmaz.
 * @param {Buffer|string} govde  manifest.json baytları (JSON'a çevrilmeden ÖNCE)
 * @param {string} imzaMetni     manifest.json.sig içeriği (base64, 64 bayt imza)
 * @param {string} acikAnahtarB64 pakete gömülü SPKI DER base64
 */
function manifestImzasiGecerliMi(govde, imzaMetni, acikAnahtarB64) {
  const k = acikAnahtarCoz(acikAnahtarB64);
  if (!k) return false;
  const temiz = String(imzaMetni == null ? '' : imzaMetni).trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(temiz)) return false;
  const imza = Buffer.from(temiz, 'base64');
  if (imza.length !== 64) return false;
  try { return crypto.verify(null, Buffer.from(govde), k, imza); } catch (e) { return false; }
}

/** Geçici dosya adı üretirken kullanılır — dizin adını zararsız hâle getirir. */
function adiSadelestir(ad) {
  return String(ad).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'ogeler';
}

/* ------------------------------------------------------- varsayılan bağımlılıklar */

/**
 * Gerçek HTTP/HTTPS getirici (JSON + kabuk dosyaları — küçük gövdeler).
 * Her istek zaman aşımlı; zaman aşımında bağlantı YIKILIR (süresiz askı yasak).
 * @returns {Promise<{durum:number, govde:Buffer}>}
 */
function varsayilanGetir(adres, { zamanAsimi = VARSAYILAN_ZAMAN_ASIMI } = {}) {
  return new Promise((coz, red) => {
    let istemci; let u;
    try {
      u = new URL(String(adres));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        red(new Error('desteklenmeyen-protokol')); return;
      }
      istemci = u.protocol === 'https:' ? require('https') : require('http');
    } catch (e) { red(new Error('gecersiz-adres')); return; }

    let bitti = false;
    const istek = istemci.get(u.toString(), { timeout: zamanAsimi }, (yanit) => {
      const parcalar = []; let boyut = 0;
      yanit.on('data', (p) => {
        boyut += p.length;
        if (boyut > KABUK_TAVANI) {
          if (!bitti) { bitti = true; try { istek.destroy(new Error('govde-tavani')); } catch (e) {} }
          return;
        }
        parcalar.push(p);
      });
      yanit.on('end', () => {
        if (bitti) return;
        bitti = true;
        coz({ durum: yanit.statusCode, govde: Buffer.concat(parcalar) });
      });
      yanit.on('error', (h) => { if (!bitti) { bitti = true; red(h); } });
    });
    istek.on('timeout', () => { try { istek.destroy(new Error('zaman-asimi')); } catch (e) {} });
    istek.on('error', (h) => { if (!bitti) { bitti = true; red(h); } });
  });
}

/**
 * Kitap arşivini DİSKE AKIŞLA indirir (yüzlerce MB olabilir — bellekte tutulmaz)
 * ve sha256'yı akarken hesaplar.
 * @returns {Promise<{durum:number, boyut:number, ozet:string}>}
 */
function varsayilanArsiviIndir(adres, hedefYolu, { zamanAsimi = VARSAYILAN_ZAMAN_ASIMI } = {}) {
  return new Promise((coz, red) => {
    const gercekFs = require('fs');
    let istemci; let u;
    try {
      u = new URL(String(adres));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        red(new Error('desteklenmeyen-protokol')); return;
      }
      istemci = u.protocol === 'https:' ? require('https') : require('http');
    } catch (e) { red(new Error('gecersiz-adres')); return; }

    let bitti = false;
    const bit = (fn, arg) => { if (!bitti) { bitti = true; fn(arg); } };
    const istek = istemci.get(u.toString(), { timeout: zamanAsimi }, (yanit) => {
      if (yanit.statusCode !== 200) {
        try { yanit.resume(); } catch (e) {}
        bit(coz, { durum: yanit.statusCode, boyut: 0, ozet: '' });
        return;
      }
      const ozetci = crypto.createHash('sha256');
      let boyut = 0;
      const akis = gercekFs.createWriteStream(hedefYolu);
      yanit.on('data', (p) => { boyut += p.length; ozetci.update(p); });
      yanit.on('error', (h) => { try { akis.destroy(); } catch (e) {} bit(red, h); });
      akis.on('error', (h) => bit(red, h));
      akis.on('finish', () => bit(coz, { durum: 200, boyut, ozet: ozetci.digest('hex') }));
      yanit.pipe(akis);
    });
    istek.on('timeout', () => { try { istek.destroy(new Error('zaman-asimi')); } catch (e) {} });
    istek.on('error', (h) => bit(red, h));
  });
}

/** Gerçek dosya sistemi — enjekte edilen `fs` verilmezse bu kullanılır. */
function varsayilanFs() {
  const f = require('fs').promises;
  return {
    readFile: (p) => f.readFile(p),
    writeFile: (p, v) => f.writeFile(p, v),
    rename: (a, b) => f.rename(a, b),
    unlink: (p) => f.unlink(p),
    mkdir: (p, o) => f.mkdir(p, o),
    stat: (p) => f.stat(p),
    readdir: (p) => f.readdir(p),
    rm: (p, o) => f.rm(p, o),
  };
}

/* ------------------------------------------------------------- ZIP çözücü */

/**
 * Asgari ZIP okuyucu — stdlib `zlib` üstünde. Yalnız method 0 (store) ve
 * 8 (deflate). Zip64 desteklenmez; karşılaşılırsa HATA (sessiz yanlış açma yok).
 * @returns {{yol:string, veri:Buffer}[]}
 */
function arsivCozVarsayilan(veri) {
  const b = Buffer.from(veri);
  // Merkezî dizin sonu (EOCD) imzasını sondan tara.
  let eocd = -1;
  const alt = Math.max(0, b.length - 66560);
  for (let i = b.length - 22; i >= alt; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('zip-eocd-yok');
  const adet = b.readUInt16LE(eocd + 10);
  const merkez = b.readUInt32LE(eocd + 16);
  if (merkez === 0xffffffff) throw new Error('zip64-desteklenmiyor');

  const cikti = [];
  let p = merkez;
  for (let i = 0; i < adet; i++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) throw new Error('zip-merkez-bozuk');
    const yontem = b.readUInt16LE(p + 10);
    const sikisik = b.readUInt32LE(p + 20);
    const acik = b.readUInt32LE(p + 24);
    const adUz = b.readUInt16LE(p + 28);
    const ekUz = b.readUInt16LE(p + 30);
    const yorumUz = b.readUInt16LE(p + 32);
    const yerel = b.readUInt32LE(p + 42);
    const ad = b.slice(p + 46, p + 46 + adUz).toString('utf8');
    p += 46 + adUz + ekUz + yorumUz;
    if (sikisik === 0xffffffff || acik === 0xffffffff || yerel === 0xffffffff) {
      throw new Error('zip64-desteklenmiyor');
    }
    if (ad.endsWith('/')) continue; // dizin girdisi
    if (b.readUInt32LE(yerel) !== 0x04034b50) throw new Error('zip-yerel-baslik-bozuk');
    const yAdUz = b.readUInt16LE(yerel + 26);
    const yEkUz = b.readUInt16LE(yerel + 28);
    const bas = yerel + 30 + yAdUz + yEkUz;
    const ham = b.slice(bas, bas + sikisik);
    let govde;
    if (yontem === 0) govde = Buffer.from(ham);
    else if (yontem === 8) govde = zlib.inflateRawSync(ham);
    else throw new Error('zip-yontem-' + yontem);
    cikti.push({ yol: ad, veri: govde });
  }
  return cikti;
}

/* --------------------------------------------------------------- yardımcılar */

/**
 * `empp-set.json` içeriğini tek biçime indirger.
 * `setKimligi` yoksa `null` KALIR (sessiz düşürme yasak — sözleşme).
 */
function setiNormalize(veri) {
  const n = (veri && typeof veri === 'object' && !Array.isArray(veri)) ? veri : {};
  const kimlik = (n.setKimligi == null || n.setKimligi === '') ? null : String(n.setKimligi);
  const dizi = (x) => (Array.isArray(x) ? x.filter((y) => typeof y === 'string' && y) : []);
  const imza = (n.imza && typeof n.imza === 'object') ? n.imza : {};
  return {
    setKimligi: kimlik,
    /** Pakete gömülü manifest doğrulama anahtarı (SPKI DER base64); yoksa '' → kanal kapalı. */
    imzaAnahtari: (imza.alg === IMZA_ALG && typeof imza.acikAnahtar === 'string') ? imza.acikAnahtar : '',
    taban: typeof n.taban === 'string' ? n.taban : '',
    damga: typeof n.damga === 'string' ? n.damga : '',
    sebep: typeof n.sebep === 'string' ? n.sebep : '',
    kabukDosyalari: dizi(n.kabukDosyalari),
    kitapDizinleri: dizi(n.kitapDizinleri),
  };
}

/** Manifest gövdesini doğrular. Eksik/bozuk alan → `null` (varsayılan RET). */
function manifestiDogrula(nesne) {
  if (!nesne || typeof nesne !== 'object' || Array.isArray(nesne)) return null;
  if (typeof nesne.surum !== 'string' || !nesne.surum.trim()) return null;
  if (!Array.isArray(nesne.kabuk)) return null;
  const kitaplar = Array.isArray(nesne.kitaplar) ? nesne.kitaplar : [];
  return { surum: nesne.surum.trim(), kabuk: nesne.kabuk, kitaplar };
}

/** Kabuk girdisi: `yol` + `sha256` + `boyut` tam ve biçimsel olarak geçerli mi? */
function kabukGirdisiGecerliMi(g) {
  if (!g || typeof g !== 'object') return false;
  if (typeof g.yol !== 'string' || !g.yol) return false;
  if (typeof g.sha256 !== 'string' || !SHA256_RE.test(g.sha256)) return false;
  if (!Number.isFinite(g.boyut) || g.boyut < 0) return false;
  return true;
}

/** Üyelik girdisi geçerli mi? `ekle` ayrıca `kaynak`+`sha256`+`boyut` ister. */
function uyelikGirdisiGecerliMi(g) {
  if (!g || typeof g !== 'object') return false;
  if (typeof g.dizin !== 'string' || !g.dizin) return false;
  if (g.durum !== 'ekle' && g.durum !== 'cikar') return false;
  if (g.durum === 'cikar') return true;
  if (typeof g.kaynak !== 'string' || !adresGuvenliMi(g.kaynak)) return false;
  if (typeof g.sha256 !== 'string' || !SHA256_RE.test(g.sha256)) return false;
  if (!Number.isFinite(g.boyut) || g.boyut < 0) return false;
  return true;
}

async function jsonGetir(getir, adres, zamanAsimi) {
  const y = await getir(adres, { zamanAsimi });
  if (!y || y.durum !== 200) {
    const e = new Error('durum-' + (y ? y.durum : 'yok'));
    e.durum = y ? y.durum : 0;
    throw e;
  }
  return JSON.parse(Buffer.from(y.govde).toString('utf8'));
}

async function varMi(fsm, yol) {
  try { await fsm.stat(yol); return true; } catch (e) { return false; }
}

async function damgayiOku(fsm, kok) {
  try {
    const ham = await fsm.readFile(nodePath.join(kok, DAMGA_ADI));
    const n = JSON.parse(Buffer.from(ham).toString('utf8'));
    return (n && typeof n.surum === 'string') ? n.surum : null;
  } catch (e) { return null; }
}

async function damgayiYaz(fsm, kok, surum) {
  try {
    await fsm.writeFile(nodePath.join(kok, DAMGA_ADI),
      Buffer.from(JSON.stringify({ surum, zaman: new Date().toISOString() }), 'utf8'));
    return true;
  } catch (e) { return false; }
}

/** Yereldeki dosyanın sha256'sı; okunamıyorsa `null`. */
async function yerelOzet(fsm, hedef) {
  try { return sha256(await fsm.readFile(hedef)); } catch (e) { return null; }
}

/** Ağacı göreli posix yol listesine çevirir. Okunamayan dal sessizce atlanır. */
async function agaciTara(fsm, kok, on = '') {
  let girdiler;
  try { girdiler = await fsm.readdir(on ? nodePath.join(kok, on) : kok); } catch (e) { return []; }
  const cikti = [];
  for (const ad of girdiler) {
    const gor = on ? on + '/' + ad : ad;
    let d;
    try { d = await fsm.stat(nodePath.join(kok, gor)); } catch (e) { continue; }
    if (d && typeof d.isDirectory === 'function' && d.isDirectory()) {
      for (const a of await agaciTara(fsm, kok, gor)) cikti.push(a);
    } else cikti.push(gor);
  }
  return cikti;
}

/**
 * Önceki çöken koşudan kalan `*.empp-silinecek` artıklarını toparlar.
 * Asıl ad boşsa GERİ ALINIR (menü hayalet madde göstermesin), doluysa artık atılır.
 */
async function artiklariTopla(fsm, kok, gunluk) {
  let girdiler;
  try { girdiler = await fsm.readdir(kok); } catch (e) { return 0; }
  let sayi = 0;
  for (const ad of girdiler) {
    if (!ad.endsWith(SILINECEK_UZANTI)) continue;
    const artik = nodePath.join(kok, ad);
    const asil = nodePath.join(kok, ad.slice(0, -SILINECEK_UZANTI.length));
    try {
      if (await varMi(fsm, asil)) {
        await fsm.rm(artik, { recursive: true, force: true });
        gunluk(`[${ISARET}] artık atıldı: ${ad}`);
      } else {
        await fsm.rename(artik, asil);
        gunluk(`[${ISARET}] yarım kalan çıkarma geri alındı: ${ad}`);
      }
      sayi += 1;
    } catch (e) {
      gunluk(`[${ISARET}] artık toparlanamadı: ${ad}`);
    }
  }
  return sayi;
}

/* ------------------------------------------------------------- ana akış */

/**
 * Tek bir SET'i günceller. **Hiçbir koşulda istisna fırlatmaz.**
 *
 * @param {object} p
 * @param {string}   p.taban        Uç nokta tabanı (sondaki `/` önemsiz).
 * @param {object}   p.set          `empp-set.json` içeriği (`setKimligi:null` → kanal kapalı).
 * @param {string}   p.kok          Paket kökü.
 * @param {Function} [p.getir]      `(adres,{zamanAsimi}) => {durum, govde}` — varsayılan gerçek http(s).
 * @param {Function} [p.arsiviIndir] `(adres, hedef, {zamanAsimi}) => {durum, boyut, ozet}` — akışlı.
 * @param {Function} [p.arsivCoz]   `(Buffer) => [{yol, veri}]` — varsayılan asgari ZIP.
 * @param {object}   [p.fs]         readFile/writeFile/rename/unlink/mkdir/stat/readdir/rm.
 * @param {Function} [p.gunluk]
 * @param {number}   [p.zamanAsimi]
 * @param {boolean}  [p.silmeAcik]  YALNIZ kabuk artıkları için.
 */
async function guncellemeyiCalistir(p) {
  const secenek = p || {};
  const gunluk = typeof secenek.gunluk === 'function' ? secenek.gunluk : () => {};
  const rapor = {
    setKimligi: null,
    taban: '',
    durum: 'atlandi',
    sebep: '',
    istek: 0,
    kabukIndirilen: 0,
    kabukAtlanan: 0,
    kabukSilinen: 0,
    eklenen: [],
    cikarilan: [],
    uyelikBasarisiz: 0,
    geciciAtilan: 0,
    artik: 0,
    /** Uygulanan hamlelerin SIRASI — `kitap-*` maddeleri `kabuk` maddelerinden ÖNCE gelir. */
    sira: [],
    hata: '',
  };

  try {
    const set = setiNormalize(secenek.set);
    rapor.setKimligi = set.setKimligi;

    if (set.setKimligi == null) {
      rapor.durum = 'kapali';
      rapor.sebep = 'set-kimligi-yok';
      gunluk(`[${ISARET}] set kimliği yok${set.sebep ? ' (' + set.sebep + ')' : ''}`
        + ' — kanal kapalı, hiçbir istek yapılmadı');
      return rapor;
    }

    const taban = String(secenek.taban == null ? '' : secenek.taban).trim().replace(/\/+$/, '');
    rapor.taban = taban;
    if (!taban) {
      rapor.sebep = 'taban-yok';
      gunluk(`[${ISARET}] taban adresi yok — güncelleme atlandı`);
      return rapor;
    }
    if (!adresGuvenliMi(taban)) {
      rapor.durum = 'kapali';
      rapor.sebep = 'taban-https-degil';
      gunluk(`[${ISARET}] taban https değil (${taban}) — kanal kapalı, hiçbir istek yapılmadı`);
      return rapor;
    }
    if (!acikAnahtarCoz(set.imzaAnahtari)) {
      rapor.durum = 'kapali';
      rapor.sebep = 'imza-anahtari-yok';
      gunluk(`[${ISARET}] pakette geçerli manifest imza anahtarı yok — kanal kapalı, `
        + 'hiçbir istek yapılmadı (imzasız manifest kabul edilmez)');
      return rapor;
    }
    const kok = String(secenek.kok == null ? '' : secenek.kok);
    if (!kok) {
      rapor.sebep = 'kok-yok';
      gunluk(`[${ISARET}] paket kökü yok — güncelleme atlandı`);
      return rapor;
    }

    const fsm = secenek.fs || varsayilanFs();
    const getir = typeof secenek.getir === 'function' ? secenek.getir : varsayilanGetir;
    const arsiviIndir = typeof secenek.arsiviIndir === 'function'
      ? secenek.arsiviIndir : varsayilanArsiviIndir;
    const arsivCoz = typeof secenek.arsivCoz === 'function' ? secenek.arsivCoz : arsivCozVarsayilan;
    const zamanAsimi = Number.isFinite(secenek.zamanAsimi) && secenek.zamanAsimi > 0
      ? Math.floor(secenek.zamanAsimi) : VARSAYILAN_ZAMAN_ASIMI;
    const silmeAcik = secenek.silmeAcik === true;
    const kimlikKoku = taban + '/set/' + encodeURIComponent(set.setKimligi);

    // 0) Önceki çöken koşunun artıkları.
    rapor.artik = await artiklariTopla(fsm, kok, gunluk);

    // 1) Kademe — surum.json
    let uzakSurum;
    try {
      rapor.istek += 1;
      const s = await jsonGetir(getir, kimlikKoku + '/surum.json', zamanAsimi);
      if (!s || typeof s.surum !== 'string' || !s.surum.trim()) throw new Error('surum-alani-yok');
      uzakSurum = s.surum.trim();
    } catch (e) {
      rapor.sebep = 'surum-alinamadi:' + (e && e.message ? e.message : 'bilinmeyen');
      gunluk(`[${ISARET}] sürüm alınamadı — ${rapor.sebep} (uygulama normal devam ediyor)`);
      return rapor;
    }

    const yerelSurum = await damgayiOku(fsm, kok);
    if (yerelSurum && yerelSurum === uzakSurum) {
      rapor.durum = 'guncel';
      rapor.sebep = 'surum-ayni';
      gunluk(`[${ISARET}] sürüm aynı (${uzakSurum.slice(0, 12)}…) — manifest indirilmedi`);
      return rapor;
    }

    // 2) Kademe — manifest.json
    let manifest;
    try {
      rapor.istek += 1;
      const my = await getir(kimlikKoku + '/manifest.json', { zamanAsimi });
      if (!my || my.durum !== 200) throw new Error('durum-' + (my ? my.durum : 'yok'));
      const ham = Buffer.from(my.govde || Buffer.alloc(0));
      rapor.istek += 1;
      let iy = null;
      try { iy = await getir(kimlikKoku + '/manifest.json' + IMZA_UZANTI, { zamanAsimi }); } catch (e) { iy = null; }
      if (!iy || iy.durum !== 200) throw new Error('manifest-imzasiz');
      if (!manifestImzasiGecerliMi(ham, Buffer.from(iy.govde || Buffer.alloc(0)).toString('utf8'),
        set.imzaAnahtari)) {
        throw new Error('manifest-imzasi-gecersiz');
      }
      manifest = manifestiDogrula(JSON.parse(ham.toString('utf8')));
      if (!manifest) throw new Error('manifest-gecersiz');
    } catch (e) {
      rapor.sebep = 'manifest-alinamadi:' + (e && e.message ? e.message : 'bilinmeyen');
      gunluk(`[${ISARET}] manifest alınamadı — ${rapor.sebep} (uygulama normal devam ediyor)`);
      return rapor;
    }

    /** Geri alma yığını — ters sırada koşar. */
    const geriAl = [];
    /** Kabuk temiz biterse kaldırılacak `.empp-silinecek` dizinleri. */
    const bekleyenSilme = [];
    const geciciKok = nodePath.join(kok, GECICI_DIZIN);

    const geriSar = async () => {
      for (let i = geriAl.length - 1; i >= 0; i--) {
        try { await geriAl[i](); } catch (e) {}
      }
    };
    const gecicileriTemizle = async () => {
      try { await fsm.rm(geciciKok, { recursive: true, force: true }); } catch (e) {}
    };

    // 3) ÜYELİK — kabuktan ÖNCE (sözleşme §5).
    for (const g of manifest.kitaplar) {
      if (!uyelikGirdisiGecerliMi(g)) {
        rapor.uyelikBasarisiz += 1;
        gunluk(`[${ISARET}] üyelik girdisi eksik/bozuk — reddedildi`);
        continue;
      }
      const hedefDizin = hedefYoluCoz(kok, g.dizin);
      if (!hedefDizin) {
        rapor.uyelikBasarisiz += 1;
        gunluk(`[${ISARET}] üyelik dizini kök dışına çıkıyor — reddedildi: ${g.dizin}`);
        continue;
      }

      if (g.durum === 'cikar') {
        // ATOMİK ÇIKARMA: önce `.empp-silinecek`e taşı; kaldırma kabuktan SONRA.
        if (!(await varMi(fsm, hedefDizin))) {
          rapor.cikarilan.push(g.dizin);
          rapor.sira.push({ tur: 'kitap-cikar', ad: g.dizin });
          continue;
        }
        const kenar = hedefDizin + SILINECEK_UZANTI;
        try {
          await fsm.rm(kenar, { recursive: true, force: true });
          await fsm.rename(hedefDizin, kenar);
          geriAl.push(() => fsm.rename(kenar, hedefDizin));
          bekleyenSilme.push(kenar);
          rapor.cikarilan.push(g.dizin);
          rapor.sira.push({ tur: 'kitap-cikar', ad: g.dizin });
          gunluk(`[${ISARET}] kitap çıkarılıyor: ${g.dizin}`);
        } catch (e) {
          rapor.uyelikBasarisiz += 1;
          gunluk(`[${ISARET}] kitap çıkarılamadı: ${g.dizin}`);
        }
        continue;
      }

      // EKLEME: indir → doğrula → geçici dizine aç → SONRA yerine taşı.
      const etiket = adiSadelestir(g.dizin);
      const arsiv = nodePath.join(geciciKok, etiket + '.arsiv' + GECICI_UZANTI);
      const acilan = nodePath.join(geciciKok, etiket + '.acilan');
      try {
        await fsm.mkdir(geciciKok, { recursive: true });
        await fsm.rm(acilan, { recursive: true, force: true });

        rapor.istek += 1;
        const ind = await arsiviIndir(g.kaynak, arsiv, { zamanAsimi });
        if (!ind || ind.durum !== 200) throw new Error('durum-' + (ind ? ind.durum : 'yok'));
        if (ind.boyut !== g.boyut) throw new Error('boyut-uyusmaz');
        if (String(ind.ozet).toLowerCase() !== g.sha256.toLowerCase()) throw new Error('sha256-uyusmaz');

        const girdiler = arsivCoz(await fsm.readFile(arsiv));
        for (const ge of girdiler) {
          const ic = hedefYoluCoz(acilan, ge && ge.yol);
          if (!ic) throw new Error('arsiv-yol-kacisi:' + (ge && ge.yol));
          await fsm.mkdir(nodePath.dirname(ic), { recursive: true });
          await fsm.writeFile(ic, Buffer.from(ge.veri));
        }
        try { await fsm.unlink(arsiv); rapor.geciciAtilan += 1; } catch (e) {}

        // Yerine koyma — eski sürüm varsa kenara alınır (kabuktan sonra kaldırılır).
        if (await varMi(fsm, hedefDizin)) {
          const kenar = hedefDizin + SILINECEK_UZANTI;
          await fsm.rm(kenar, { recursive: true, force: true });
          await fsm.rename(hedefDizin, kenar);
          geriAl.push(() => fsm.rename(kenar, hedefDizin));
          bekleyenSilme.push(kenar);
        }
        await fsm.rename(acilan, hedefDizin);
        geriAl.push(() => fsm.rename(hedefDizin, acilan));
        rapor.eklenen.push(g.dizin);
        rapor.sira.push({ tur: 'kitap-ekle', ad: g.dizin });
        gunluk(`[${ISARET}] kitap eklendi: ${g.dizin} (${ind.boyut} bayt)`);
      } catch (e) {
        // YARIM İNEN KİTAP MENÜYE GİRMEZ: çöp temizlenir, hedefe dokunulmaz.
        try { await fsm.unlink(arsiv); rapor.geciciAtilan += 1; } catch (e2) {}
        try { await fsm.rm(acilan, { recursive: true, force: true }); } catch (e2) {}
        rapor.uyelikBasarisiz += 1;
        gunluk(`[${ISARET}] kitap eklenemedi (${e && e.message}) — hedef korundu: ${g.dizin}`);
      }
    }

    // 4) Üyelikte tek bir arıza bile varsa KABUĞA DOKUNULMAZ ve hamleler geri alınır.
    if (rapor.uyelikBasarisiz > 0) {
      await geriSar();
      await gecicileriTemizle();
      rapor.durum = 'kismi';
      rapor.sebep = 'uyelik-eksik-kabuk-atlandi';
      rapor.eklenen = [];
      rapor.cikarilan = [];
      gunluk(`[${ISARET}] ${rapor.uyelikBasarisiz} üyelik hamlesi başarısız — `
        + 'kabuk güncellenmedi, hamleler geri alındı (menü bozulmadı)');
      return rapor;
    }

    // 5) KABUK — kitap verisi yerine konduktan SONRA.
    let kabukBasarisiz = 0;
    const kabukKumesi = [];
    for (const g of manifest.kabuk) {
      if (!kabukGirdisiGecerliMi(g)) {
        rapor.kabukAtlanan += 1; kabukBasarisiz += 1;
        gunluk(`[${ISARET}] kabuk girdisi eksik/bozuk — atlandı`);
        continue;
      }
      const hedef = hedefYoluCoz(kok, g.yol);
      if (!hedef) {
        rapor.kabukAtlanan += 1; kabukBasarisiz += 1;
        gunluk(`[${ISARET}] kabuk yolu kök dışına çıkıyor — atlandı: ${g.yol}`);
        continue;
      }
      kabukKumesi.push(g.yol.replace(/\\/g, '/'));

      const yerel = await yerelOzet(fsm, hedef);
      if (yerel && yerel.toLowerCase() === g.sha256.toLowerCase()) continue;

      const gecici = hedef + GECICI_UZANTI;
      let yanit;
      try {
        rapor.istek += 1;
        yanit = await getir(
          kimlikKoku + '/dosya/' + g.yol.split('/').map(encodeURIComponent).join('/'),
          { zamanAsimi });
      } catch (e) {
        rapor.kabukAtlanan += 1; kabukBasarisiz += 1;
        gunluk(`[${ISARET}] kabuk indirilemedi (${e && e.message}) — atlandı: ${g.yol}`);
        continue;
      }
      if (!yanit || yanit.durum !== 200) {
        rapor.kabukAtlanan += 1; kabukBasarisiz += 1;
        gunluk(`[${ISARET}] kabuk durum ${yanit ? yanit.durum : 'yok'} — atlandı: ${g.yol}`);
        continue;
      }

      const govde = Buffer.from(yanit.govde || Buffer.alloc(0));
      try {
        await fsm.mkdir(nodePath.dirname(hedef), { recursive: true });
        await fsm.writeFile(gecici, govde);
      } catch (e) {
        rapor.kabukAtlanan += 1; kabukBasarisiz += 1;
        gunluk(`[${ISARET}] geçici dosya yazılamadı — atlandı: ${g.yol}`);
        continue;
      }

      const boyutTutar = govde.length === g.boyut;
      const ozetTutar = sha256(govde).toLowerCase() === g.sha256.toLowerCase();
      if (!boyutTutar || !ozetTutar) {
        // KENDİ çöpümüz atılır; HEDEF DOSYAYA DOKUNULMAZ.
        try { await fsm.unlink(gecici); rapor.geciciAtilan += 1; } catch (e) {}
        rapor.kabukAtlanan += 1; kabukBasarisiz += 1;
        gunluk(`[${ISARET}] ${!boyutTutar ? 'boyut' : 'sha256'} uyuşmadı — `
          + `hedef korundu, atlandı: ${g.yol}`);
        continue;
      }

      try {
        await fsm.rename(gecici, hedef);
        rapor.kabukIndirilen += 1;
        rapor.sira.push({ tur: 'kabuk', ad: g.yol });
      } catch (e) {
        try { await fsm.unlink(gecici); rapor.geciciAtilan += 1; } catch (e2) {}
        rapor.kabukAtlanan += 1; kabukBasarisiz += 1;
        gunluk(`[${ISARET}] yerine taşınamadı — atlandı: ${g.yol}`);
      }
    }

    // 6) Kabukta arıza varsa üyelik hamleleri GERİ ALINIR (hayalet menü olmasın).
    if (kabukBasarisiz > 0) {
      await geriSar();
      await gecicileriTemizle();
      rapor.durum = 'kismi';
      rapor.sebep = kabukBasarisiz + '-kabuk-dosyasi-atlandi';
      rapor.eklenen = [];
      rapor.cikarilan = [];
      gunluk(`[${ISARET}] kabuk eksik (${kabukBasarisiz}) — üyelik hamleleri geri alındı, damga yazılmadı`);
      return rapor;
    }

    // 7) Kesinleştirme: kenara alınanlar artık kaldırılabilir.
    for (const kenar of bekleyenSilme) {
      try { await fsm.rm(kenar, { recursive: true, force: true }); } catch (e) {
        gunluk(`[${ISARET}] kenara alınan kaldırılamadı: ${kenar}`);
      }
    }
    await gecicileriTemizle();

    // 8) Kabuk artıkları — YALNIZ `EMPP_GUNCELLEME_SILME=1` ile.
    if (silmeAcik && kabukKumesi.length) {
      const dallar = new Set(kabukKumesi.map((y) => y.split('/')[0]));
      const kume = new Set(kabukKumesi);
      const korunan = new Set(set.kitapDizinleri);
      for (const gor of await agaciTara(fsm, kok)) {
        if (gor === DAMGA_ADI) continue;
        if (gor.endsWith(GECICI_UZANTI)) continue;
        const dal = gor.split('/')[0];
        if (korunan.has(dal)) continue;        // kitap dizinleri bu kapıya TABİ DEĞİL
        if (!dallar.has(dal)) continue;
        if (kume.has(gor)) continue;
        const hedef = hedefYoluCoz(kok, gor);
        if (!hedef) continue;
        try {
          await fsm.unlink(hedef);
          rapor.kabukSilinen += 1;
          gunluk(`[${ISARET}] kabuk artığı silindi: ${gor}`);
        } catch (e) { gunluk(`[${ISARET}] kabuk artığı silinemedi: ${gor}`); }
      }
    }

    await damgayiYaz(fsm, kok, manifest.surum);
    rapor.durum = 'guncellendi';
    rapor.sebep = 'tamam';
    gunluk(`[${ISARET}] güncellendi — kabuk ${rapor.kabukIndirilen}, `
      + `eklenen ${rapor.eklenen.length}, çıkarılan ${rapor.cikarilan.length}`);
  } catch (e) {
    rapor.hata = 'beklenmeyen:' + (e && e.message ? e.message : 'bilinmeyen');
    rapor.durum = 'atlandi';
    gunluk(`[${ISARET}] beklenmeyen hata — güncelleme atlandı (${rapor.hata})`);
  }
  return rapor;
}

/**
 * Pakete enjekte edilen çağrının girdiği kapı. `empp-set.json` okunur, env
 * kapıları uygulanır, akış çalıştırılır. **İstisna fırlatmaz.**
 */
async function guncellemeyiBaslat(p) {
  const secenek = p || {};
  const env = secenek.env || process.env;
  const gunluk = typeof secenek.gunluk === 'function'
    ? secenek.gunluk
    : (m) => { try { console.log(m); } catch (e) {} };
  const bos = (sebep) => ({
    setKimligi: null, taban: '', durum: 'atlandi', sebep, istek: 0,
    kabukIndirilen: 0, kabukAtlanan: 0, kabukSilinen: 0,
    eklenen: [], cikarilan: [], uyelikBasarisiz: 0, geciciAtilan: 0, artik: 0,
    sira: [], hata: '',
  });
  try {
    if (!acikMi(env)) {
      gunluk(`[${ISARET}] kapalı (${ISARET}=0) — güncelleme çalıştırılmadı`);
      return bos('kapali');
    }
    const kok = String(secenek.kok || __dirname);
    const fsm = secenek.fs || varsayilanFs();
    const setYolu = secenek.setYolu || nodePath.join(kok, VARSAYILAN_SET_ADI);

    let set;
    try {
      set = JSON.parse(Buffer.from(await fsm.readFile(setYolu)).toString('utf8'));
    } catch (e) {
      gunluk(`[${ISARET}] ${VARSAYILAN_SET_ADI} okunamadı — güncelleme atlandı`);
      return bos('set-dosyasi-yok');
    }

    return await guncellemeyiCalistir({
      taban: tabaniCoz(env, set && set.taban),
      set,
      kok,
      getir: secenek.getir,
      arsiviIndir: secenek.arsiviIndir,
      arsivCoz: secenek.arsivCoz,
      fs: fsm,
      gunluk,
      zamanAsimi: zamanAsimiCoz(env),
      silmeAcik: silmeAcikMi(env),
    });
  } catch (e) {
    gunluk(`[${ISARET}] başlatılamadı — uygulama normal devam ediyor`);
    return bos('baslatilamadi');
  }
}

module.exports = {
  ISARET,
  IMZA_UZANTI,
  IMZA_ALG,
  adresGuvenliMi,
  acikAnahtarCoz,
  manifestImzasiGecerliMi,
  VARSAYILAN_ZAMAN_ASIMI,
  VARSAYILAN_SET_ADI,
  DAMGA_ADI,
  GECICI_UZANTI,
  SILINECEK_UZANTI,
  GECICI_DIZIN,
  acikMi,
  silmeAcikMi,
  zamanAsimiCoz,
  tabaniCoz,
  yolGuvenliMi,
  hedefYoluCoz,
  sha256,
  adiSadelestir,
  varsayilanGetir,
  varsayilanArsiviIndir,
  varsayilanFs,
  arsivCozVarsayilan,
  setiNormalize,
  manifestiDogrula,
  kabukGirdisiGecerliMi,
  uyelikGirdisiGecerliMi,
  artiklariTopla,
  guncellemeyiCalistir,
  guncellemeyiBaslat,
};
