'use strict';

/**
 * KANONİK SÜRÜM ÖZETİ — paketin içine damgalanan motor/kabuk sürümünü ajana taşır.
 *
 * Paketleyici `paket.json`'a `motorSurumu` (motor-surumu.js damgası) ve `kabukSurumu`
 * (okuyucu-kabugu.js damgası) yazar. Ajan paketi /result ile bildirirken bu dört alanı
 * sunucuya gönderir: `{motorSha12, motorDurum, kabukSurum, kabukDurum}`.
 *
 *   motorSha12  = damga.sha12 (kitap ana kopyalarının SON hâli; karışık/yoksa null)
 *   motorDurum  = damga.durum (guncel | karisik | bilinmiyor | motor-yok | hata)
 *   kabukSurum  = damga.kanonikSurum (pakete konan kanonik kabuk sürümü)
 *   kabukDurum  = damga.durum
 *
 * ASLA hata fırlatmaz: dosya yok / bozuk / alan eksikse ilgili alan null olur.
 */

const fsp = require('fs/promises');
const path = require('path');

/** @returns {{motorSha12:null,motorDurum:null,kabukSurum:null,kabukDurum:null}} */
function bosOzet() {
  return { motorSha12: null, motorDurum: null, kabukSurum: null, kabukDurum: null };
}

/** Boş olmayan string → kırpılmış, değilse null. */
function metin(v, azami) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, azami) : null;
}

/** Damga tek kayıt ya da liste olabilir; ilk nesne kaydı döner. */
function damgaKaydi(d) {
  if (Array.isArray(d)) return d.find((x) => x && typeof x === 'object') || null;
  return d && typeof d === 'object' ? d : null;
}

/**
 * paket.json gövdesinden (nesne) özet çıkarır. SAF, asla fırlatmaz.
 * @param {unknown} paketJson
 */
function ozetCikar(paketJson) {
  const ozet = bosOzet();
  try {
    const pj = paketJson && typeof paketJson === 'object' ? paketJson : {};
    const motor = damgaKaydi(pj.motorSurumu);
    if (motor) {
      ozet.motorSha12 = metin(motor.sha12, 12);
      ozet.motorDurum = metin(motor.durum, 32);
    }
    const kabuk = damgaKaydi(pj.kabukSurumu);
    if (kabuk) {
      ozet.kabukSurum = metin(kabuk.kanonikSurum, 32);
      ozet.kabukDurum = metin(kabuk.durum, 32);
    }
  } catch (_) { /* özet opsiyonel */ }
  return ozet;
}

/**
 * Paket kök dizinindeki paket.json'u okuyup özet döner. Dosya yok/bozuksa hepsi null.
 * @param {string} kokDizin
 */
async function paketJsondanOku(kokDizin) {
  try {
    const ham = await fsp.readFile(path.join(String(kokDizin), 'paket.json'), 'utf8');
    return ozetCikar(JSON.parse(ham));
  } catch (_) {
    return bosOzet();
  }
}

/**
 * /result gövdesine eklenecek alanlar: yalnız dolu (null olmayan) olanlar; özet yoksa `{}`.
 * @param {unknown} ozet
 */
function govdeAlanlari(ozet) {
  const out = {};
  if (!ozet || typeof ozet !== 'object') return out;
  for (const k of ['motorSha12', 'motorDurum', 'kabukSurum', 'kabukDurum']) {
    const v = metin(ozet[k], 32);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * Pardus yolu: paket.json konteyner içinde kalır (çıktıya yalnız .impark + raw/packager.log iner).
 * Paketleyicinin log'a bastığı iki satırdan aynı özeti çıkarır (SAF, asla fırlatmaz):
 *   `EMPP_MOTOR durum=guncel sha12=abcdef012345 kanonik=... surum=... degisen=N`
 *   `Okuyucu kabuğu: guncel, N kitap değişti (kanonik 1.13.3)`   ("YOK" → null)
 * @param {unknown} logMetni
 */
function logdanOzet(logMetni) {
  const ozet = bosOzet();
  try {
    const satirlar = String(logMetni || '').split(/\r?\n/);
    const motor = satirlar.filter((l) => /(^|\s)EMPP_MOTOR\s/.test(l)).pop();
    if (motor) {
      const o = {};
      for (const parca of motor.replace(/^.*?EMPP_MOTOR\s+/, '').trim().split(/\s+/)) {
        const i = parca.indexOf('=');
        if (i > 0) o[parca.slice(0, i)] = parca.slice(i + 1);
      }
      ozet.motorSha12 = o.sha12 && o.sha12 !== '-' ? metin(o.sha12, 12) : null;
      ozet.motorDurum = metin(o.durum, 32);
    }
    const kabuk = satirlar.filter((l) => /Okuyucu kabuğu:/.test(l)).pop();
    if (kabuk) {
      const govde = kabuk.replace(/^.*?Okuyucu kabuğu:\s*/, '');
      ozet.kabukDurum = metin(govde.split(',')[0], 32);
      const m = /\(kanonik\s+([^)\s]+)\)/.exec(govde);
      ozet.kabukSurum = m && m[1] !== 'YOK' ? metin(m[1], 32) : null;
    }
  } catch (_) { /* özet opsiyonel */ }
  return ozet;
}

module.exports = { bosOzet, ozetCikar, paketJsondanOku, logdanOzet, govdeAlanlari };
