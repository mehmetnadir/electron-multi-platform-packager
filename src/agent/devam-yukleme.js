'use strict';

/**
 * DEVAM EDEN ÇOK PARÇALI YÜKLEME (02.10, Nadir kararı sözleşme §2c).
 *
 * Mac evdeyken yavaş hatta R2'ye yükler; ağ kopması, uyku ya da runner yeniden başlatması
 * yüklemeyi yarıda keserse KALDIĞI YERDEN sürmeli. Eskiden uploadId/ETag'ler yalnız bellekteydi:
 * süreç ölünce yeni claim yeni uploadId açıp TÜM parçaları baştan yolluyor, eski yarım yükleme
 * R2'de sahipsiz kalıyordu.
 *
 * Mekanizma:
 *  - Durum dosyası (DEVAM_DIZINI/<kapsam>-<kitap>-<platform>[-<sürüm>].json): uploadId, anahtar,
 *    parça boyutu, dosya sha256+boyut, tamamlanan parça ETag'leri. Her parçadan sonra atomik
 *    (tmp + rename) yazılır — süreç SIGKILL ile ölse de en fazla bir parça kaybolur.
 *  - Yeniden başlayınca AYNI dosya (boyut + sha + parça boyutu + parça sayısı) ve aynı anahtar için
 *    sunucudan `durum` (R2 ListParts + taze imzalı URL'ler) istenir; R2'de gerçekten duran parçalar
 *    atlanır, yalnız eksikler gider. ListParts YETKİLİDİR (yerel kayıt R2'de yoksa o parça yeniden gider).
 *  - Dosya değişmişse (başka sha) ya da kayıt `omurSaat`ten eskiyse eski yükleme R2'de iptal edilir
 *    (sahipsiz parça birikmesin) ve baştan başlanır.
 *  - Birleştirme başarıyla bitince ya da sunucu 4xx ile reddedince kayıt silinir; geçici hatada
 *    (ağ, 5xx, kapanış) kayıt KALIR — sonraki claim devam eder.
 *
 * Sunucu bağımlılığı bu modülde YOK: `istemci` enjekte edilir (paket yolu: `result/*` uçları;
 * kaynak-kur ileride `kaynak/*` uçlarıyla aynı çekirdeği kullanır).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const VARSAYILAN_DIZIN = path.join(os.homedir(), '.empp-agent', 'yuklemeler');
const VARSAYILAN_OMUR_SAAT = 24;

const dizinAl = () => process.env.EMPP_YUKLEME_DIZIN || VARSAYILAN_DIZIN;
const omurSaatAl = () => {
  const n = Number(process.env.EMPP_YUKLEME_OMUR_SAAT);
  return Number.isFinite(n) && n > 0 ? n : VARSAYILAN_OMUR_SAAT;
};

const temizAd = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);

/** İş kimliğinden durum dosyası yolu: `<dizin>/<kapsam>-<kitap>-<platform>[-<sürüm>].json`. */
function durumYolu({ kapsam = 'paket', bookId, platform, surum }, dizin = dizinAl()) {
  const ad = [kapsam, bookId, platform, surum].filter((x) => x !== undefined && x !== null && x !== '')
    .map(temizAd).join('-');
  return path.join(dizin, `${ad}.json`);
}

async function durumOku(yol) {
  let ham;
  try {
    ham = await fsp.readFile(yol, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
  try {
    const d = JSON.parse(ham);
    if (d && d.v === 1 && d.uploadId && d.r2ObjectKey && d.parcalar && typeof d.parcalar === 'object') return d;
  } catch (_) { /* bozuk kayıt = kayıt yok (eski yükleme iptal edilmez; süresi dolunca temizlenir) */ }
  return null;
}

/** Atomik yazım: tmp dosya + rename (kısmi/bozuk JSON bırakmaz; SIGKILL'e dayanıklı). */
async function durumYaz(yol, durum) {
  await fsp.mkdir(path.dirname(yol), { recursive: true });
  const tmp = `${yol}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ ...durum, guncelleme: Date.now() }, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, yol);
}

async function durumSil(yol) {
  await fsp.unlink(yol).catch(() => {});
}

/** Kayıt aynı dosya + aynı parçalama için mi? sha varsa sha, yoksa mtime kıyaslanır. */
function eslesir(d, { kapsam, size, sha256, mtimeMs, partSize, partCount }) {
  if (!d || d.kapsam !== kapsam || d.size !== size || d.partSize !== partSize || d.partCount !== partCount) return false;
  if (d.sha256 && sha256) return d.sha256 === sha256;
  return Boolean(d.mtimeMs) && d.mtimeMs === mtimeMs;
}

const beklesin = (ms) => new Promise((r) => setTimeout(r, ms));

/** Üstel geri çekilme (tavanlı). */
function ustelBekleme(deneme, tabanMs = 2000, tavanMs = 120000) {
  const a = Number.isFinite(deneme) && deneme > 0 ? Math.floor(deneme) : 0;
  return Math.min(tabanMs * Math.pow(2, a), tavanMs);
}

/**
 * ListParts yanıtını yerel beklentiyle süzer: yalnız numarası aralıkta, ETag'i olan ve BOYUTU
 * beklenen parça boyutuna eşit parçalar "hazır" sayılır (son parça kalan bayt kadar).
 */
function hazirParcalar(parcalar, size, partSize, partCount) {
  const hazir = {};
  for (const p of Array.isArray(parcalar) ? parcalar : []) {
    const n = Number(p && p.partNumber);
    if (!Number.isInteger(n) || n < 1 || n > partCount || !p.etag) continue;
    const beklenen = n < partCount ? partSize : size - partSize * (partCount - 1);
    if (p.size !== undefined && p.size !== null && Number(p.size) !== beklenen) continue;
    hazir[n] = String(p.etag);
  }
  return hazir;
}

async function iptalEt(istemci, durum, warn) {
  try {
    if (istemci.iptal) await istemci.iptal({ uploadId: durum.uploadId, r2ObjectKey: durum.r2ObjectKey });
  } catch (e) {
    warn(`eski yükleme iptal edilemedi (R2 sahipsiz parçayı kendi süresinde atar): ${e && e.message ? e.message : e}`);
  }
}

/**
 * Çok parçalı yüklemeyi (varsa kaldığı yerden) yürütür; BİRLEŞTİRMEYİ çağıran yapar.
 *
 * @param {object} o
 * @param {string} o.dosya
 * @param {number} o.size
 * @param {string|null} o.sha256        artefakt kanıtı / özet (yoksa mtime ile eşleşir)
 * @param {number} o.partSize
 * @param {{kapsam?: string, bookId: string, platform: string, surum?: string}} o.kimlik
 * @param {object} o.istemci            {baslat(partCount), durum({uploadId,r2ObjectKey,partCount}), iptal({uploadId,r2ObjectKey})}
 *   baslat → {uploadId, r2ObjectKey, contentType, urls} | null (sunucu desteklemiyor → null döner)
 *   durum  → {durum:'var', parcalar:[{partNumber,etag,size}], urls, contentType} | {durum:'yok'}
 * @param {Function} o.parcaYukleyici   (dosya,size,partSize,urls,contentType,{tamamlanan,kaydet,urlYenile}) → parts[]
 * @returns {Promise<null | {uploadId, r2ObjectKey, contentType, parts, durumYolu, devamEdildi: boolean, atlanan: number}>}
 */
async function cokParcaYukle({
  dosya, size, sha256 = null, partSize, kimlik, istemci, parcaYukleyici,
  dizin = dizinAl(), simdi = Date.now, log = () => {}, warn = () => {}, bekle = beklesin,
}) {
  const kapsam = kimlik.kapsam || 'paket';
  const partCount = Math.max(1, Math.ceil(size / partSize));
  let mtimeMs = 0;
  try { mtimeMs = Math.floor(fs.statSync(dosya).mtimeMs); } catch (_) { /* dosya yoksa parça okuması hata verir */ }
  const yol = durumYolu({ ...kimlik, kapsam }, dizin);
  const beklenen = { kapsam, size, sha256, mtimeMs, partSize, partCount };

  let durum = await durumOku(yol);
  let tamamlanan = {};
  let urls = null;
  let contentType;
  let devamEdildi = false;

  if (durum) {
    const yasSaat = (simdi() - (durum.guncelleme || 0)) / 3600e3;
    if (!eslesir(durum, beklenen)) {
      log(`devam kaydı başka dosyaya ait (boyut/sha/parçalama değişti) — eski yükleme iptal ediliyor: ${path.basename(yol)}`);
      await iptalEt(istemci, durum, warn);
      await durumSil(yol);
      durum = null;
    } else if (yasSaat > omurSaatAl()) {
      log(`devam kaydı ${yasSaat.toFixed(1)} sa eski (> ${omurSaatAl()} sa) — iptal edilip baştan: ${path.basename(yol)}`);
      await iptalEt(istemci, durum, warn);
      await durumSil(yol);
      durum = null;
    }
  }

  if (durum) {
    // Sunucudan R2 ListParts + taze URL. Geçici hata → birkaç kez dene, yine düşerse YUKARI fırlat
    // (kayıt kalır, sonraki claim sürer; sessizce yeni yükleme açıp eskisini sahipsiz BIRAKMA).
    let r = null;
    const DENEME = Number(process.env.AGENT_DEVAM_DURUM_DENEME || 4);
    for (let i = 0; i < DENEME; i++) {
      try {
        r = await istemci.durum({ uploadId: durum.uploadId, r2ObjectKey: durum.r2ObjectKey, partCount });
        break;
      } catch (e) {
        if (i === DENEME - 1) throw e;
        warn(`devam durumu alınamadı (${i + 1}/${DENEME}): ${e && e.message ? e.message : e}`);
        await bekle(ustelBekleme(i));
      }
    }
    if (r && r.durum === 'var') {
      tamamlanan = hazirParcalar(r.parcalar, size, partSize, partCount);
      urls = r.urls;
      contentType = r.contentType || durum.contentType;
      devamEdildi = true;
      log(`devam: ${Object.keys(tamamlanan).length}/${partCount} parça R2'de hazır — yalnız eksikler yüklenecek (${durum.r2ObjectKey})`);
    } else {
      log(`devam kaydının R2 yüklemesi yok (iptal/sona ermiş) — baştan başlanıyor: ${path.basename(yol)}`);
      await durumSil(yol);
      durum = null;
    }
  }

  if (!durum) {
    const basla = await istemci.baslat(partCount);
    if (!basla) return null; // eski sunucu → çağıran tek parça yola düşer
    durum = {
      v: 1, kapsam, bookId: kimlik.bookId, platform: kimlik.platform, surum: kimlik.surum || null,
      uploadId: basla.uploadId, r2ObjectKey: basla.r2ObjectKey, contentType: basla.contentType || null,
      size, sha256, mtimeMs, partSize, partCount, parcalar: {}, olusturma: simdi(),
    };
    await durumYaz(yol, durum);
    urls = basla.urls;
    contentType = basla.contentType;
  }
  durum.parcalar = { ...tamamlanan };
  await durumYaz(yol, durum);

  const kaydet = async (partNumber, etag) => {
    durum.parcalar[partNumber] = etag;
    await durumYaz(yol, durum);
  };
  const urlYenile = async () => {
    const r = await istemci.durum({ uploadId: durum.uploadId, r2ObjectKey: durum.r2ObjectKey, partCount });
    if (!r || r.durum !== 'var' || !Array.isArray(r.urls)) throw new Error('URL yenilenemedi: yükleme sunucuda yok');
    return r.urls;
  };

  const parts = await parcaYukleyici(dosya, size, partSize, urls, contentType, {
    tamamlanan: { ...durum.parcalar }, kaydet, urlYenile,
  });
  return {
    uploadId: durum.uploadId, r2ObjectKey: durum.r2ObjectKey, contentType, parts,
    durumYolu: yol, devamEdildi, atlanan: Object.keys(tamamlanan).length,
  };
}

/**
 * Süresi dolmuş (> omurSaat) kayıtları iptal edip siler — sahipsiz parça biriktirmez. Başka işe
 * ait kayıtlara dokunmaz (yalnız yaşa bakar). `iptalci(durum)` kayda göre sunucu çağrısı yapar;
 * başarısızsa kayıt yine silinir, R2 kendi süresinde atar.
 */
async function eskileriTemizle({ dizin = dizinAl(), simdi = Date.now, iptalci = null, warn = () => {} } = {}) {
  let adlar;
  try { adlar = await fsp.readdir(dizin); } catch (_) { return { silinen: 0 }; }
  let silinen = 0;
  for (const ad of adlar) {
    if (!ad.endsWith('.json')) continue;
    const yol = path.join(dizin, ad);
    const d = await durumOku(yol);
    if (!d) continue;
    if ((simdi() - (d.guncelleme || 0)) / 3600e3 <= omurSaatAl()) continue;
    if (iptalci) {
      try { await iptalci(d); } catch (e) { warn(`eski yükleme iptal edilemedi: ${e && e.message ? e.message : e}`); }
    }
    await durumSil(yol);
    silinen += 1;
  }
  return { silinen };
}

module.exports = {
  VARSAYILAN_DIZIN, durumYolu, durumOku, durumYaz, durumSil, eslesir, hazirParcalar,
  ustelBekleme, cokParcaYukle, eskileriTemizle, dizinAl,
};
