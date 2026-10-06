'use strict';

/**
 * İMZALI SON SÜRÜM ARŞİVİ (Nadir 06.10 10:00): "İşini bitirdiğin, hazır ettiğin ve imzaladığın exe
 * dosyalarını Windows kasa'nın D sürücüsünde bir klasör altında tut. Hep en son sürümü tut. Önceki
 * sürümleri sil." Kural: C'de üretilir, arşiv D'de durur.
 *
 * Yerleşim (kök `EMPP_IMZALI_ARSIV_KOKU`, win32 varsayılanı `D:\empp-imzali-son`):
 *   <kök>\<Set adı>.exe                    yayınlanan imzalı kopya (yalnız en son sürüm)
 *   <kök>\<bookId>\son.json                bookId, baslik, surum, exe, exeYolu, sha256, boyut...
 *
 * Akış: geçici ada kopyala → sha256 doğrula → hedef ada `rename` → son.json → ESKİ SÜRÜM TEMİZLİĞİ:
 * aynı bookId'nin önceki son.json'undaki exe adı (yeni addan farklıysa) kökte düz dosya ise silinir;
 * ayrıca <kök>\<bookId>\ içinde kalmış eski *.exe'ler silinir (geçiş dönemi). Başka setlere dokunulmaz.
 * Sha uyuşmazsa ya da kopya düşerse eski sürüm SİLİNMEZ (fail-safe).
 *
 * Bu adım yayını ASLA başarısız saymaz: `arsivle` fırlatmaz, sonucu döner; hata uyarı logu +
 * `bildir bekci` tek satır. Birim (D:) yoksa atlanır — C:'ye yedek yazılmaz.
 * win32 dışında varsayılan kök YOK (Mac runner'ı yazmaz); `EMPP_IMZALI_ARSIV_KOKU=0` kapatır.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const VARSAYILAN_KOK_WIN = 'D:\\empp-imzali-son';
const SON_JSON = 'son.json';
const GECICI_EKI = '.yaziliyor-';

/** Arşiv kökü. null = arşiv kapalı. Saf. */
function arsivKoku(env = process.env, platform = process.platform) {
  const v = env.EMPP_IMZALI_ARSIV_KOKU;
  if (v === '0') return null;
  if (v) return v;
  return platform === 'win32' ? VARSAYILAN_KOK_WIN : null;
}

/** bookId yalnız rakam (yol enjeksiyonu reddi). Saf. */
function bookIdGecerli(id) {
  return /^\d{1,12}$/.test(String(id == null ? '' : id));
}

/** Özgün Setup adı: yalın dosya adı, .exe uzantılı, ayırıcı/üst dizin/sürücü yok. Saf. */
function exeAdiGecerli(ad) {
  const s = String(ad == null ? '' : ad);
  if (!s.toLowerCase().endsWith('.exe')) return false;
  if (s.includes('..') || s.includes('/') || s.includes('\\') || s.includes(':')) return false;
  if (s.startsWith('.') || /^\s/.test(s) || /[ .]\.exe$/i.test(s)) return false;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s)) return false;
  return s.length > 4 && /^[^/\\:*?"<>|\x00-\x1F]{1,250}$/.test(s);
}

/** `p` gerçekten `kok`'un altında mı (eşit değil)? Saf. */
function altindaMi(kok, p) {
  const r = path.relative(kok, p);
  return Boolean(r) && !r.startsWith('..') && !path.isAbsolute(r);
}

function sha256Hesapla(dosya) {
  return new Promise((coz, red) => {
    const h = crypto.createHash('sha256');
    let boyut = 0;
    fs.createReadStream(dosya, { highWaterMark: 8 << 20 })
      .on('data', (d) => { h.update(d); boyut += d.length; })
      .on('error', red)
      .on('end', () => coz({ sha256: h.digest('hex'), boyut }));
  });
}

async function lstatVeyaNull(p) {
  try { return await fsp.lstat(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

/** Dizini yoksa açar (özyinelemesiz); bağ/junction ya da dizin olmayan girdi → fırlatır. */
async function dizinHazirla(d) {
  let st = await lstatVeyaNull(d);
  if (!st) {
    try { await fsp.mkdir(d); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    st = await fsp.lstat(d);
  }
  if (st.isSymbolicLink()) throw new Error(`arşiv dizini bağ/junction — izlenmez: ${d}`);
  if (!st.isDirectory()) throw new Error(`arşiv yolu dizin değil: ${d}`);
}

async function jsonYaz(yol, veri) {
  const gecici = `${yol}.tmp-${process.pid}`;
  await fsp.writeFile(gecici, `${JSON.stringify(veri, null, 2)}\n`);
  await fsp.rename(gecici, yol);
}

async function sonOku(klasor) {
  try { return JSON.parse(await fsp.readFile(path.join(klasor, SON_JSON), 'utf8')); } catch (_) { return null; }
}

/** Kökteki BAŞKA bookId klasörlerinin son.json'unda kayıtlı exe adları (win32'de küçük harf). */
async function baskaSetExeleri(kok, bookId) {
  const kume = new Set();
  const win = process.platform === 'win32';
  try {
    for (const g of await fsp.readdir(kok, { withFileTypes: true })) {
      if (!g.isDirectory() || g.name === bookId) continue;
      const s = await sonOku(path.join(kok, g.name));
      if (!s) continue;
      for (const a of [s.exeYolu, s.exe]) {
        if (typeof a !== 'string' || !a) continue;
        const y = win ? path.win32.basename(a) : path.basename(a);
        kume.add(win ? y.toLowerCase() : y);
      }
    }
  } catch (_) { /* kök yok: çakışma yok */ }
  return kume;
}

/**
 * Klasördeki ESKİ sürümleri siler:
 * 1. `klasor` (<kök>\\<bookId>) içindeki tüm `.exe` ve yarım kopyaları temizler (geçiş).
 * 2. `kok` içindeki `eskiExeAd`'ı (yeniExeAd'dan farklıysa) siler.
 * @returns {Promise<{silinen:string[], atlanan:string[]}>}
 */
async function eskileriSil(kok, klasor, eskiExeAd, yeniExeAd, log = () => {}, platform = process.platform) {
  const silinen = [];
  const atlanan = [];
  const win = platform === 'win32';
  
  try {
    const girdiler = await fsp.readdir(klasor, { withFileTypes: true });
    for (const g of girdiler) {
      const ad = g.name;
      const exe = ad.toLowerCase().endsWith('.exe');
      const gecici = ad.startsWith('.') && ad.includes(GECICI_EKI);
      if (!exe && !gecici) continue;
      const p = path.join(klasor, ad);
      if (path.dirname(p) !== klasor || !altindaMi(klasor, p)) { atlanan.push(ad); continue; }
      const st = await lstatVeyaNull(p);
      if (!st || st.isSymbolicLink() || !st.isFile()) { atlanan.push(ad); continue; }
      try { await fsp.unlink(p); silinen.push(ad); } catch (e) { atlanan.push(ad); log(`imzalı-arşiv: UYARI eski sürüm silinemedi (${ad}): ${e.message}`); }
    }
  } catch (e) { /* atla */ }

  const yalinYeni = win ? path.win32.basename(yeniExeAd) : path.basename(yeniExeAd);
  const yalinEski = eskiExeAd ? (win ? path.win32.basename(eskiExeAd) : path.basename(eskiExeAd)) : null;

  try {
    const kokGirdiler = await fsp.readdir(kok, { withFileTypes: true });
    for (const g of kokGirdiler) {
      if (!g.isFile()) continue;
      const ad = g.name;
      const gecici = ad.startsWith('.') && ad.includes(GECICI_EKI);
      if (!gecici) continue;
      if (ad.startsWith(`.${yalinYeni}${GECICI_EKI}`) || (yalinEski && ad.startsWith(`.${yalinEski}${GECICI_EKI}`))) {
        const p = path.join(kok, ad);
        try { await fsp.unlink(p); silinen.push(ad); } catch (e) { atlanan.push(ad); }
      }
    }
  } catch (e) { /* atla */ }

  if (eskiExeAd) {
    const ayniMi = win ? yalinYeni.toLowerCase() === yalinEski.toLowerCase() : yalinYeni === yalinEski;
    if (!ayniMi) {
      const p = path.join(kok, yalinEski);
      if (path.dirname(p) === kok && altindaMi(kok, p)) {
        const st = await lstatVeyaNull(p);
        if (st && !st.isSymbolicLink() && st.isFile()) {
          try { await fsp.unlink(p); silinen.push(yalinEski); } catch (e) { atlanan.push(yalinEski); log(`imzalı-arşiv: UYARI eski sürüm silinemedi (${yalinEski}): ${e.message}`); }
        }
      }
    }
  }
  return { silinen, atlanan };
}

/** `bildir bekci` tek satır — kasada ikili yoksa yalnız log. Asla fırlatmaz. */
function varsayilanBildir({ ikili, komutKos, log = () => {} } = {}) {
  return async (mesaj) => {
    try {
      if (process.env.EMPP_BILDIRIM === '0') return;
      const yol = ikili || process.env.EMPP_BILDIR_IKILI || path.join(os.homedir(), '.local', 'bin', 'bildir');
      if (!fs.existsSync(yol)) { log(`imzalı-arşiv: bildir yok (${yol}) — yalnız log: ${mesaj}`); return; }
      const { ikiliKomutu } = require('./bildir-ikili');
      const [bk, ba] = ikiliKomutu(yol, ['bekci', mesaj, '-b', 'İmzalı arşiv', '-p', 'normal', '-e', 'warning']);
      const kos = komutKos || require('./windows-serit').komutKos;
      const r = await kos([bk, ...ba], { zamanAsimiMs: 20000 });
      if (r.kod !== 0) log(`imzalı-arşiv: bildirim GÖNDERİLEMEDİ (çıkış ${r.kod}): ${mesaj}`);
    } catch (e) { log(`imzalı-arşiv: bildirim hatası: ${e.message}`); }
  };
}

/**
 * İmzalı exe'yi `<kök>\<bookId>\`'ye son sürüm olarak koyar. ASLA fırlatmaz.
 * @param {object} o
 * @param {string} o.kaynak            imzalı exe (yerel, doğrulanmış kopya)
 * @param {string|number} o.bookId
 * @param {string} o.exeAdi            özgün Setup adı (arşivdeki ad)
 * @param {string} [o.beklenenSha256]  imza doğrulamasının sha256'sı; yoksa kaynaktan hesaplanır
 * @param {object} [o.meta]            baslik, surum, imzaZamani, yayinZamani, r2Anahtari
 * @param {string|null} [o.kok]        arşiv kökü (varsayılan `arsivKoku()`)
 * @param {boolean} [o.eskiyseAtla]    son.json'daki yayinZamani aynı/daha yeniyse dokunma (geri doldurma)
 * @param {boolean} [o.kuru]           yalnız karar; yazma/silme yok
 * @param {Function} [o.log]
 * @param {Function} [o.bildir]        `async (mesaj)` — yalnız hata durumunda çağrılır
 * @returns {Promise<{durum:'arsivlendi'|'atlandi'|'hata'|'kuru', sebep?:string, hedef?:string, silinen?:string[]}>}
 */
async function arsivle(o) {
  const log = o.log || (() => {});
  const bildir = o.bildir || varsayilanBildir({ log });
  const kok = o.kok === undefined ? arsivKoku() : o.kok;
  const etiket = String(o.bookId).slice(0, 40);
  const hata = async (sebep) => {
    log(`imzalı-arşiv: UYARI ${etiket} arşivlenemedi (yayın etkilenmedi, eski sürüm yerinde): ${sebep}`);
    try {
      await bildir(`İmzalı arşiv ${etiket}: ${String(sebep).slice(0, 200)} — yayın tamam, eski sürüm D'de kaldı`);
    } catch (_) { /* bildirim yayını etkilemez */ }
    return { durum: 'hata', sebep };
  };
  try {
    if (!kok) return { durum: 'atlandi', sebep: 'arşiv kökü yok (win32 dışı ya da EMPP_IMZALI_ARSIV_KOKU=0)' };
    if (!bookIdGecerli(o.bookId)) return await hata(`bookId geçersiz (yalnız rakam): ${JSON.stringify(String(o.bookId)).slice(0, 60)}`);
    if (!exeAdiGecerli(o.exeAdi)) return await hata(`exe adı geçersiz: ${JSON.stringify(String(o.exeAdi)).slice(0, 120)}`);
    if (!path.isAbsolute(kok)) return await hata(`arşiv kökü mutlak değil: ${kok}`);
    const kokTam = path.resolve(kok);
    const birim = path.dirname(kokTam);
    // Sürücü yok / medya yok / erişilemez (ENOENT, ENODEV, EIO, EPERM…) → atla; C:'ye yazılmaz.
    if (!(await fsp.stat(birim).then((st) => st.isDirectory(), () => false))) {
      log(`imzalı-arşiv: UYARI ${etiket} atlandı — birim/üst dizin yok ya da erişilemez: ${birim} (C:'ye yazılmaz)`);
      return { durum: 'atlandi', sebep: `birim yok: ${birim}` };
    }
    const kaynakSt = await fsp.stat(o.kaynak);
    const klasor = path.join(kokTam, String(o.bookId));

    const m = o.meta || {};
    const temizle = (t) => String(t == null ? '' : t)
      .replace(/[\\/:*?"<>|\x00-\x1F]/g, ' ').replace(/\s+/g, ' ').replace(/\.exe$/i, '')
      .replace(/^[\s.]+/, '').replace(/[\s.]+$/, '').slice(0, 150).trim();
    let govde = temizle(m.baslik);
    if (!govde) {
      govde = temizle(String(o.exeAdi).replace(/\.exe$/i, '').replace(/^runner-\d+-/i, '')
        .replace(/-\d+(?:\.\d+)*-Setup$/i, '').replace(/-/g, ' '));
    }
    if (!govde) govde = `Set ${o.bookId}`;
    let yeniAd = `${govde}.exe`;
    if (!exeAdiGecerli(yeniAd)) { govde = `Set ${o.bookId}`; yeniAd = `${govde}.exe`; }

    const win32 = process.platform === 'win32';
    const kiyas = (a) => (win32 ? String(a).toLowerCase() : String(a));
    const baskaSetler = await baskaSetExeleri(kokTam, String(o.bookId));
    if (baskaSetler.has(kiyas(yeniAd))) yeniAd = `${govde} (${o.bookId}).exe`;

    const hedef = path.join(kokTam, yeniAd);
    if (!altindaMi(kokTam, hedef) || path.dirname(hedef) !== kokTam) return await hata(`hedef kök dışında: ${hedef}`);

    const eskiSon = await sonOku(klasor);
    let eskiExeAd = eskiSon ? (eskiSon.exeYolu || eskiSon.exe) : null;
    // Eski ad başka bir setin güncel adıysa (kayıt bozuk/çakışma) ASLA silinmez.
    if (typeof eskiExeAd !== 'string') eskiExeAd = null;
    if (eskiExeAd && baskaSetler.has(kiyas(win32 ? path.win32.basename(eskiExeAd) : path.basename(eskiExeAd)))) eskiExeAd = null;

    if (o.eskiyseAtla && o.meta && o.meta.yayinZamani) {
      const mevcut = eskiSon && Date.parse(eskiSon.yayinZamani);
      if (mevcut && mevcut >= Date.parse(o.meta.yayinZamani)) {
        return { durum: 'atlandi', sebep: `arşivde aynı/yeni sürüm var (${eskiSon.surum || '-'}, ${eskiSon.yayinZamani})` };
      }
    }
    if (o.kuru) return { durum: 'kuru', hedef, sebep: `${kaynakSt.size} B kopyalanacak` };
    try {
      await dizinHazirla(kokTam);
      await dizinHazirla(klasor);
    } catch (e) {
      return await hata(`arşiv dizini açılamadı: ${e.message}`);
    }
    const gercekKok = await fsp.realpath(kokTam);
    const gercekKlasor = await fsp.realpath(klasor);
    if (!altindaMi(gercekKok, gercekKlasor)) return await hata(`klasör gerçek yolu kök dışında: ${gercekKlasor}`);

    const gecici = path.join(kokTam, `.${yeniAd}${GECICI_EKI}${process.pid}`);
    try {
      await fsp.copyFile(o.kaynak, gecici);
      const beklenen = String(o.beklenenSha256 || (await sha256Hesapla(o.kaynak)).sha256).toLowerCase();
      const kopya = await sha256Hesapla(gecici);
      if (kopya.sha256 !== beklenen || kopya.boyut !== kaynakSt.size) {
        throw new Error(`sha256 uyuşmadı (kopya ${kopya.sha256.slice(0, 12)}…/${kopya.boyut} B, `
          + `beklenen ${beklenen.slice(0, 12)}…/${kaynakSt.size} B)`);
      }
      await fsp.rename(gecici, hedef);
      const son = await fsp.lstat(hedef);
      if (!son.isFile() || son.size !== kopya.boyut) throw new Error(`yerleşen dosya boyutu ${son.size} ≠ ${kopya.boyut}`);
      await jsonYaz(path.join(klasor, SON_JSON), {
        bookId: String(o.bookId), baslik: m.baslik || null, surum: m.surum || null, 
        exe: yeniAd, exeYolu: yeniAd,
        sha256: kopya.sha256, boyut: kopya.boyut, imzaZamani: m.imzaZamani || null,
        yayinZamani: m.yayinZamani || null, r2Anahtari: m.r2Anahtari || null, arsivZamani: new Date().toISOString(),
      });
    } catch (e) {
      await fsp.unlink(gecici).catch(() => {});
      return await hata(`kopya: ${e.message}`);
    }
    const { silinen } = await eskileriSil(kokTam, klasor, eskiExeAd, yeniAd, log);
    log(`imzalı-arşiv: ${etiket} → ${hedef}${silinen.length ? ` (eski silindi: ${silinen.join(', ')})` : ''}`);
    return { durum: 'arsivlendi', hedef, silinen };
  } catch (e) {
    return hata(e && e.message ? e.message : String(e));
  }
}

module.exports = {
  VARSAYILAN_KOK_WIN, SON_JSON, GECICI_EKI,
  arsivKoku, bookIdGecerli, exeAdiGecerli, altindaMi, sha256Hesapla, eskileriSil, varsayilanBildir, arsivle, sonOku,
};
