'use strict';

/**
 * SAYFA WEBP DÖNÜŞÜMÜ İÇİN İÇERİK-ADRESLİ ÖNBELLEK (2026-09-26)
 *
 * NEDEN: Windows SET derlemesi ~7400 sn ölçüldü, çoğu kayıpsız WebP kodlaması
 * (45549'da 26 dk'da ~50 sayfa, 554 sayfalık kitapta 2+ saat). İçerik merdiveni
 * yalnız DEĞİŞEN kitabı tazeliyor — ama aynı kitap yeniden derlendiğinde
 * DEĞİŞMEYEN sayfalar da her seferinde yeniden kodlanıyordu; yarıda kalan bir
 * işin çevirdiği sayfalar da bir SONRAKİ işte hiç kullanılamıyordu. Bu modül
 * girdi baytı + kip + kodlayıcı sürümüne göre anahtarlanan diskteki bir önbellek
 * sağlar: aynı sayfa ikinci kez görülünce sharp hiç çağrılmaz.
 *
 * ANAHTAR: sha256(girdi) + '-' + kip + '-' + sürüm damgası (sharp paket sürümü +
 * libvips sürümü + KOD_SURUMU sabiti). Kodlama mantığı (mod1, sharp seçenekleri,
 * doğrulama) değişirse `KOD_SURUMU` artırılmalı — eski önbellek kendiliğinden
 * ıskaya düşer, asla eski/yanlış üretilmiş bir bayt sessizce yeniden kullanılmaz.
 *
 * DEĞER: dosyanın ilk baytı işaret (`MARKER_OZGUN` | `MARKER_WEBP`), gerisi
 * payload. `MARKER_OZGUN` → "küçülmedi, özgünü kullan" kararı — payload YOK,
 * özgün baytlar zaten çağıranın elinde, tekrar saklamaya gerek yok. `MARKER_WEBP`
 * → payload NİHAİ çıktı baytları (mod1 uygulanmışsa şifreli haliyle —
 * `sayfa-webp.js`'in `bufferiDonustur` çıktısındaki `cikti` alanıyla birebir).
 *
 * YAZMA: geçici ad (aynı alt dizinde) + rename — atomik, yarım dosya kalmaz.
 * Eşzamanlı iki yazıcı aynı anahtara yazsa bile son `rename` kazanır; dosya HER
 * ZAMAN bütün bir öncekini ya da bütün bir sonrakini taşır, asla karışık/yarım
 * içerik olmaz.
 *
 * OKUMA: boyut>0 ve (marker=ozgun) ya da (marker=webp + payload gerçek WebP
 * imzası taşıyor — mod1'liyse ÇÖZÜLMÜŞ baytta aranır). Bozuksa `null` — çağıran
 * ıska sayıp yeniden çevirir ve üzerine yazar; asla bozuk çıktı döndürülmez.
 *
 * BUDAMA: toplam boyut `EMPP_WEBP_ONBELLEK_GB` tavanını aşarsa en eski ERİŞİLEN
 * (okuma/yazmada mtime tazelenir) dosyalardan başlanarak `fs.unlink` ile silinir.
 * Yalnız BU önbellek dizininin İÇİNDE çalışır — başka hiçbir yola dokunmaz.
 */

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const VARSAYILAN_TAVAN_GB = 30;
const KOD_SURUMU = 1; // mod1/bufferiDonustur çıktı biçimi değişince ARTIR

const MARKER_OZGUN = 0x4f; // 'O' — "küçülmedi, özgünü kullan" kararı
const MARKER_WEBP = 0x57; // 'W' — payload = nihai çıktı baytları

function varsayilanDizin() {
  return path.join(os.homedir(), '.empp-agent', 'webp-onbellek');
}

/**
 * `EMPP_WEBP_ONBELLEK` / `EMPP_WEBP_ONBELLEK_GB` env'ini çözer.
 * `EMPP_WEBP_ONBELLEK=0` → tamamen kapalı. Tanımsız → varsayılan dizin, açık.
 * Başka herhangi bir değer → o değer, dizin yolu olarak kullanılır.
 * @param {Object} [env]
 * @returns {{acik: boolean, dizin: string|null, tavanGb: number}}
 */
function ayarlariCoz(env = process.env) {
  const ham = env && env.EMPP_WEBP_ONBELLEK;
  if (ham === '0') return { acik: false, dizin: null, tavanGb: VARSAYILAN_TAVAN_GB };
  const dizin = ham || varsayilanDizin();
  const tavanGb = Number(env && env.EMPP_WEBP_ONBELLEK_GB) || VARSAYILAN_TAVAN_GB;
  return { acik: true, dizin, tavanGb };
}

let _damga = null;
/** sharp paket sürümü + libvips sürümü + KOD_SURUMU — dosya adı güvenli string. */
function surumDamgasi() {
  if (_damga) return _damga;
  let paket = 'bilinmiyor';
  let vips = 'bilinmiyor';
  try { paket = require('sharp/package.json').version; } catch (_) { /* sharp yoksa 'bilinmiyor' kalır */ }
  try {
    const sh = require('sharp');
    vips = (sh && sh.versions && sh.versions.vips) || 'bilinmiyor';
  } catch (_) { /* sharp yoksa 'bilinmiyor' kalır */ }
  _damga = `s${paket}-v${vips}-k${KOD_SURUMU}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  return _damga;
}

/**
 * Önbellek anahtarı: sha256(girdi baytları) + kip + sürüm damgası. `kip` ya da
 * sürüm damgası anahtardan çıkarılırsa ayar değişince eski (yanlış kipte
 * üretilmiş) önbellek yanlışlıkla isabet sayılır — bu yüzden ikisi de anahtarın
 * PARÇASI, yalnız yardımcı bilgi değil.
 * @param {Buffer} buf
 * @param {string} kip
 * @returns {string}
 */
function anahtarHesapla(buf, kip) {
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  return `${hash}-${kip}-${surumDamgasi()}`;
}

/** `<dizin>/<anahtarın ilk 2 karakteri>/<anahtar>` — sha256 önekiyle eşit dağılım. */
function dosyaYolu(dizin, anahtar) {
  return path.join(dizin, anahtar.slice(0, 2), anahtar);
}

/** RIFF....WEBP imzası mı? */
function webpImzaGecerliMi(buf) {
  return !!buf && buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP';
}

function dokunTazele(yol) {
  const simdi = new Date();
  fs.utimes(yol, simdi, simdi, () => {}); // en-iyi-çaba — hata önemsiz, isabet zaten gerçekleşti
}

/**
 * Önbellekten oku. Bozuksa (boş/kısa/bilinmeyen marker/geçersiz WebP imzası)
 * `null` döner — çağıran ıska sayıp yeniden çevirmeli, ASLA bozuk çıktı
 * kullanılmaz. Bulunursa mtime "erişildi" olarak tazelenir (budama sırası için).
 * @param {string} dizin
 * @param {string} anahtar
 * @param {{sifreliMi?: boolean, mod1Fn?: Function}} [opts] `sifreliMi` true ise
 *   payload `mod1Fn` ile çözülüp öyle doğrulanır (WebP imzası şifreli baytta
 *   değil, çözülmüş baytta aranır — mod1 involutif).
 * @returns {Promise<null|{tur:'ozgun'}|{tur:'webp', cikti: Buffer}>}
 */
async function oku(dizin, anahtar, { sifreliMi = false, mod1Fn } = {}) {
  const yol = dosyaYolu(dizin, anahtar);
  let veri;
  try { veri = await fs.readFile(yol); } catch (_) { return null; } // yok = ıska
  if (!veri || veri.length === 0) return null; // bozuk: boş dosya

  const marker = veri[0];
  if (marker === MARKER_OZGUN) {
    dokunTazele(yol);
    return { tur: 'ozgun' };
  }
  if (marker === MARKER_WEBP) {
    const payload = veri.subarray(1);
    if (payload.length === 0) return null; // bozuk: gövde yok
    const kontrolIcinBayt = sifreliMi && mod1Fn ? mod1Fn(payload) : payload;
    if (!webpImzaGecerliMi(kontrolIcinBayt)) return null; // bozuk: WebP imzası yok
    dokunTazele(yol);
    return { tur: 'webp', cikti: payload };
  }
  return null; // bilinmeyen marker = bozuk
}

/**
 * Atomik yaz: geçici ad (aynı alt dizinde) + rename. Bkz. modül başlığı —
 * eşzamanlı iki yazıcı çakışsa bile sonuç asla yarım/karışık olmaz.
 * @param {string} dizin
 * @param {string} anahtar
 * @param {{tur: 'ozgun'|'webp', cikti?: Buffer}} deger
 */
async function yaz(dizin, anahtar, { tur, cikti } = {}) {
  const hedef = dosyaYolu(dizin, anahtar);
  await fs.ensureDir(path.dirname(hedef));
  const gecici = `${hedef}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const marker = Buffer.from([tur === 'ozgun' ? MARKER_OZGUN : MARKER_WEBP]);
  const veri = tur === 'ozgun' ? marker : Buffer.concat([marker, cikti]);
  try {
    await fs.writeFile(gecici, veri);
    await fs.rename(gecici, hedef); // atomik — aynı dizin/aynı dosya sistemi
  } catch (e) {
    try { await fs.remove(gecici); } catch (_) { /* zaten yok olabilir */ }
    throw e;
  }
}

/** Önbellek dizinindeki tüm gerçek girdileri (yarım `.tmp-` dosyaları hariç) listeler. */
async function girdileriListele(dizin) {
  const sonuc = [];
  let altlar;
  try { altlar = await fs.readdir(dizin, { withFileTypes: true }); } catch (_) { return sonuc; }
  for (const alt of altlar) {
    if (!alt.isDirectory()) continue;
    const altYol = path.join(dizin, alt.name);
    let dosyalar;
    try { dosyalar = await fs.readdir(altYol, { withFileTypes: true }); } catch (_) { continue; }
    for (const d of dosyalar) {
      if (!d.isFile() || d.name.includes('.tmp-')) continue;
      const tam = path.join(altYol, d.name);
      try {
        const st = await fs.stat(tam);
        sonuc.push({ yol: tam, boyut: st.size, mtimeMs: st.mtimeMs });
      } catch (_) { /* stat sırasında silindiyse atla */ }
    }
  }
  return sonuc;
}

/**
 * Toplam boyut `tavanGb`'ı aşarsa en eski ERİŞİLEN (mtime) dosyalardan
 * başlayarak `fs.unlink` ile buda. Yalnız BU önbellek dizininin İÇİNDE çalışır.
 * @param {string} dizin
 * @param {number} [tavanGb]
 * @returns {Promise<{silinen:number, oncekiToplamBayt:number, sonrakiToplamBayt:number}>}
 */
async function budaGerekirse(dizin, tavanGb = VARSAYILAN_TAVAN_GB) {
  const tavanBayt = tavanGb * 1024 ** 3;
  const girdiler = await girdileriListele(dizin);
  const oncekiToplam = girdiler.reduce((a, g) => a + g.boyut, 0);
  if (oncekiToplam <= tavanBayt) {
    return { silinen: 0, oncekiToplamBayt: oncekiToplam, sonrakiToplamBayt: oncekiToplam };
  }

  girdiler.sort((a, b) => a.mtimeMs - b.mtimeMs); // en eski erişilen önce
  let toplam = oncekiToplam;
  let silinen = 0;
  for (const g of girdiler) {
    if (toplam <= tavanBayt) break;
    try {
      await fs.unlink(g.yol);
      toplam -= g.boyut;
      silinen++;
    } catch (_) { /* başka biri silmiş olabilir */ }
  }
  return { silinen, oncekiToplamBayt: oncekiToplam, sonrakiToplamBayt: toplam };
}

module.exports = {
  VARSAYILAN_TAVAN_GB, KOD_SURUMU, MARKER_OZGUN, MARKER_WEBP,
  varsayilanDizin, ayarlariCoz, surumDamgasi, anahtarHesapla, dosyaYolu,
  webpImzaGecerliMi, oku, yaz, budaGerekirse, girdileriListele,
};
