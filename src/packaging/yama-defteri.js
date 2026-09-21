'use strict';

/**
 * YAMA DEFTERİ — açılışta birkaç yüz baytlık bir defter (manifest) çekip,
 * yalnızca DEĞİŞEN küçük dosyaları indiren SAF mantık modülü.
 *
 * NE YAPMAZ: Gerçek HTTP/ağ çağrısını bu modül yapmaz — `getirFn` olarak
 * DIŞARIDAN enjekte edilir (kancayı başka bir modül/ajan yazar). Burada yalnız
 * karar (indirilecek mi?), doğrulama (defter geçerli mi? sha uyuyor mu?) ve
 * atomik yazım mantığı var. Testler ağa/gerçek fs'e dokunmadan koşar.
 *
 * SAHA ARIZASI / ÖLÇÜLMÜŞ TUZAKLAR:
 *   1) Açılış ekranındaki gecikmenin %91'i ağ bekleme kaynaklı; eski koddaki
 *      `timeout:5e3` hiçbir isteğe bağlanmamış ÖLÜ bir sabitti. Bu yüzden
 *      `defteriGetir` AÇILIŞI ASLA BLOKLAMAZ — gerçek bir `Promise.race` ile
 *      zaman aşımı kurulur (varsayılan 2500 ms), `.catch`'siz zincir YASAK;
 *      HER dal (zaman aşımı / reddedilme / geçersiz defter / başarı) throw
 *      etmeden, unhandled rejection bırakmadan bir sonuç nesnesi döner.
 *   2) Yayıncının kendi güncelleyicisi zaten açılışta koşup ~350 MB indiriyor
 *      (indiriyor ama uygulamayı AÇMIYOR, ~99 sn bekletiyor). Bu modül İKİNCİ
 *      bir bloklayıcı ağ yolu OLMAYACAK — birkaç KB'lik yama vaadi, büyük bir
 *      indirmeye dönüşmesin diye `azamiToplamBayt` bütçesi vardır ve aşılırsa
 *      liste BÜYÜTÜLMEZ, kesilir (`asildi:true`).
 *   3) Tazelik/güncellik kararı TEK yerde verilir (çift kaynak gölgelemesi
 *      YASAK) — bu modül kendi dışında başka bir "hangisi güncel" kararı
 *      üretmez; tüketici (kanca) bu modülün döndürdüğü karara güvenir.
 */

const crypto = require('crypto');

const VARSAYILAN_AZAMI_TOPLAM_BAYT = 5 * 1024 * 1024; // 5 MB
const VARSAYILAN_ZAMAN_ASIMI_MS = 2500;
const SHA256_HEX_REGEXP = /^[0-9a-fA-F]{64}$/;
const SURUCU_HARFI_REGEXP = /^[a-zA-Z]:/;

/**
 * Yolun güvenli olup olmadığını doğrular: `..` segmenti, mutlak yol (`/`, `\`
 * ile başlama), Windows sürücü harfi (`C:` gibi), NUL byte veya boş/string
 * olmayan değer reddedilir.
 * @param {unknown} yol
 * @returns {boolean}
 */
function yoluGuvenliMi(yol) {
  if (typeof yol !== 'string' || yol.length === 0) return false;
  if (yol.includes('\0')) return false;
  if (yol.startsWith('/') || yol.startsWith('\\')) return false;
  if (SURUCU_HARFI_REGEXP.test(yol)) return false;
  const segmentler = yol.split(/[/\\]/);
  if (segmentler.includes('..')) return false;
  return true;
}

/**
 * Ham yama defterini doğrular. Bir dosya kaydı bozuksa TÜM defter geçersiz —
 * kısmi kabul YOK. Bozuk JSON throw etmez, `gecerli:false` döner.
 * @param {string|object} ham
 * @returns {{gecerli: boolean, sebep: string, defter?: object}}
 */
function defteriDogrula(ham) {
  let defter = ham;
  if (typeof ham === 'string') {
    try {
      defter = JSON.parse(ham);
    } catch {
      return { gecerli: false, sebep: 'json-parse-hatasi' };
    }
  }

  if (!defter || typeof defter !== 'object' || Array.isArray(defter)) {
    return { gecerli: false, sebep: 'gecersiz-defter-bicimi' };
  }
  if (typeof defter.surum !== 'string' || defter.surum.trim() === '') {
    return { gecerli: false, sebep: 'gecersiz-surum' };
  }
  if (!Array.isArray(defter.dosyalar)) {
    return { gecerli: false, sebep: 'dosyalar-dizi-olmalidir' };
  }

  for (const dosya of defter.dosyalar) {
    if (!dosya || typeof dosya !== 'object' || Array.isArray(dosya)) {
      return { gecerli: false, sebep: 'gecersiz-dosya-kaydi' };
    }
    if (typeof dosya.yol !== 'string' || dosya.yol.trim() === '') {
      return { gecerli: false, sebep: 'gecersiz-dosya-yolu' };
    }
    if (typeof dosya.sha256 !== 'string' || !SHA256_HEX_REGEXP.test(dosya.sha256)) {
      return { gecerli: false, sebep: 'gecersiz-sha256' };
    }
    if (typeof dosya.bayt !== 'number' || !Number.isFinite(dosya.bayt) || dosya.bayt < 0) {
      return { gecerli: false, sebep: 'gecersiz-bayt' };
    }
  }

  return { gecerli: true, sebep: 'ok', defter };
}

/**
 * Defterdeki dosyalardan indirilmesi gerekenleri belirler: aynı sha256 yerelde
 * varsa atlanır; toplam bayt `azamiToplamBayt`'ı (varsayılan 5 MB) AŞACAKSA
 * liste büyütülmez, o dosyada kesilir (`asildi:true`). Güvensiz yollar listeye
 * hiç girmez (sessizce atlanır, `atlananSayisi`'na dahil edilmez).
 * @param {object} defter
 * @param {Map<string,string>} yereldeVarOlan
 * @param {{azamiToplamBayt?: number}} [secenekler]
 * @returns {{indirilecek: Array<{yol:string, sha256:string, bayt:number}>, asildi: boolean, atlananSayisi: number}}
 */
function indirilecekler(defter, yereldeVarOlan, secenekler = {}) {
  const sonuc = { indirilecek: [], asildi: false, atlananSayisi: 0 };
  if (!defter || !Array.isArray(defter.dosyalar)) return sonuc;

  const ayarlar = secenekler && typeof secenekler === 'object' ? secenekler : {};
  const azamiToplamBayt = typeof ayarlar.azamiToplamBayt === 'number' && ayarlar.azamiToplamBayt >= 0
    ? ayarlar.azamiToplamBayt
    : VARSAYILAN_AZAMI_TOPLAM_BAYT;

  let toplamBayt = 0;
  for (const dosya of defter.dosyalar) {
    if (!dosya || typeof dosya !== 'object') continue;
    if (!yoluGuvenliMi(dosya.yol)) continue; // güvensiz yol: sessizce atla

    const yerelSha = yereldeVarOlan instanceof Map ? yereldeVarOlan.get(dosya.yol) : undefined;
    if (typeof yerelSha === 'string' && typeof dosya.sha256 === 'string'
        && yerelSha.toLowerCase() === dosya.sha256.toLowerCase()) {
      sonuc.atlananSayisi += 1;
      continue;
    }

    const dosyaBayt = typeof dosya.bayt === 'number' ? dosya.bayt : 0;
    if (toplamBayt + dosyaBayt > azamiToplamBayt) {
      sonuc.asildi = true;
      break; // bütçeyi aşan dosyada KES — listeyi büyütme
    }
    toplamBayt += dosyaBayt;
    sonuc.indirilecek.push({ yol: dosya.yol, sha256: dosya.sha256, bayt: dosya.bayt });
  }
  return sonuc;
}

/**
 * Tamponu geçici bir dosyaya yazar, mümkünse fsync eder, sonra hedef ada
 * `rename` eder. Yarım yazılmış dosya hedef adda ASLA görünmez.
 * `fs` enjekte edilir (test double olabilir; fsync yoksa sessizce atlanır).
 * @param {object} fs
 * @param {string} hedefYol
 * @param {Buffer|Uint8Array|string} tampon
 * @returns {Promise<void>}
 */
async function atomikYaz(fs, hedefYol, tampon) {
  const fsp = (fs && fs.promises) ? fs.promises : fs;
  if (!fsp || typeof fsp.writeFile !== 'function' || typeof fsp.rename !== 'function') {
    throw new Error('gecersiz-dosya-sistemi-nesnesi');
  }

  const geciciYol = `${hedefYol}.tmp-${crypto.randomBytes(8).toString('hex')}`;
  try {
    await fsp.writeFile(geciciYol, tampon);

    if (typeof fsp.open === 'function') {
      let handle;
      try {
        handle = await fsp.open(geciciYol, 'r+');
        if (handle && typeof handle.sync === 'function') await handle.sync();
      } catch {
        // fsync desteklenmiyor/açılamıyorsa sessizce atla — yazım engellenmez
      } finally {
        if (handle && typeof handle.close === 'function') {
          try { await handle.close(); } catch { /* kapatma hatası yoksayılır */ }
        }
      }
    }

    await fsp.rename(geciciYol, hedefYol);
  } catch (hata) {
    if (typeof fsp.unlink === 'function') {
      try { await fsp.unlink(geciciYol); } catch { /* temizlik hatası yoksayılır */ }
    }
    throw hata;
  }
}

/**
 * İçeriğin sha256'sı beklenenle uyuşmuyorsa YAZMAZ. Uyuşuyorsa `atomikYaz`
 * çağırır.
 * @param {object} fs
 * @param {string} hedefYol
 * @param {Buffer|Uint8Array|string} icerikBuffer
 * @param {string} beklenenSha256
 * @returns {Promise<{yazildi: boolean, sebep: string}>}
 */
async function dogrulaVeYaz(fs, hedefYol, icerikBuffer, beklenenSha256) {
  if (icerikBuffer == null || typeof beklenenSha256 !== 'string') {
    return { yazildi: false, sebep: 'gecersiz-parametre' };
  }

  let hesaplananSha;
  try {
    hesaplananSha = crypto.createHash('sha256').update(icerikBuffer).digest('hex');
  } catch {
    return { yazildi: false, sebep: 'hash-hesaplama-hatasi' };
  }
  if (hesaplananSha.toLowerCase() !== beklenenSha256.toLowerCase()) {
    return { yazildi: false, sebep: 'sha-uyusmazligi' };
  }

  try {
    await atomikYaz(fs, hedefYol, icerikBuffer);
    return { yazildi: true, sebep: 'yazildi' };
  } catch {
    return { yazildi: false, sebep: 'yazma-hatasi' };
  }
}

/**
 * Yama defterini getirir. AÇILIŞI ASLA BLOKLAMAZ: `getirFn()` ile gerçek zaman
 * aşımı promise'i `Promise.race` ile yarıştırılır; hiçbir dal throw etmez /
 * unhandled rejection bırakmaz (getir promise'ine HER ZAMAN `.catch` takılır,
 * yarış zaman aşımıyla bitse de sonradan reddetse sessiz kalır).
 * @param {() => Promise<string|object>} getirFn
 * @param {{zamanAsimiMs?: number}} [secenekler]
 * @returns {Promise<{uygulandi: boolean, sebep: string, defter?: object}>}
 */
async function defteriGetir(getirFn, secenekler = {}) {
  if (typeof getirFn !== 'function') {
    return { uygulandi: false, sebep: 'gecersiz-getir-fonksiyonu' };
  }

  const ayarlar = secenekler && typeof secenekler === 'object' ? secenekler : {};
  const zamanAsimiMs = typeof ayarlar.zamanAsimiMs === 'number' && ayarlar.zamanAsimiMs >= 0
    ? ayarlar.zamanAsimiMs
    : VARSAYILAN_ZAMAN_ASIMI_MS;

  let zamanlayici;
  const zamanAsimiPromise = new Promise((resolve) => {
    zamanlayici = setTimeout(() => resolve({ tip: 'zaman-asimi' }), zamanAsimiMs);
    if (typeof zamanlayici.unref === 'function') zamanlayici.unref();
  });

  let getirPromise;
  try {
    getirPromise = Promise.resolve(getirFn())
      .then((veri) => ({ tip: 'veri', veri }))
      .catch(() => ({ tip: 'hata' })); // .catch'siz zincir YASAK — unhandled rejection bırakmaz
  } catch {
    clearTimeout(zamanlayici);
    return { uygulandi: false, sebep: 'getirme-hatasi' };
  }

  const yarisSonucu = await Promise.race([getirPromise, zamanAsimiPromise]);
  clearTimeout(zamanlayici);

  if (yarisSonucu.tip === 'zaman-asimi') {
    return { uygulandi: false, sebep: 'zaman-asimi' }; // sessiz düşer, açılış normal akışına döner
  }
  if (yarisSonucu.tip === 'hata') {
    return { uygulandi: false, sebep: 'getirme-hatasi' };
  }

  const dogrulama = defteriDogrula(yarisSonucu.veri);
  if (!dogrulama.gecerli) {
    return { uygulandi: false, sebep: dogrulama.sebep };
  }
  return { uygulandi: true, sebep: 'ok', defter: dogrulama.defter };
}

module.exports = {
  defteriDogrula,
  indirilecekler,
  yoluGuvenliMi,
  atomikYaz,
  dogrulaVeYaz,
  defteriGetir,
  VARSAYILAN_AZAMI_TOPLAM_BAYT,
  VARSAYILAN_ZAMAN_ASIMI_MS,
};
