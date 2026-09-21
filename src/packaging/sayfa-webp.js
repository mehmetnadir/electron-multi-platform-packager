'use strict';

/**
 * SAYFA GÖRSELLERİ → WebP (dosya adı `.png` KALIR)
 *
 * NEDEN (2026-09-18, ölçüldü): paketlerin %91'i `resources/app.asar`, onun da %97'si
 * `assets/` — yani sayfa görselleri. Sayfalar 1659×2340 8-bit RGB PNG. 40 sayfalık
 * temsili örneklemde WebP q82 **%52** boyut veriyor ve gözle özgünden ayırt edilemiyor
 * (PNG8 256 renk benzer boyut veriyor ama gradyanlarda bantlanma üretiyor — kullanılmaz).
 *
 * NEDEN ADI DEĞİŞMİYOR: motor sayfa yolunu sabit uzantıyla kuruyor
 * (`kitapDosyalar/{bookId}/pages/{imageName}.png`). Ama Chromium `<img>` için uzantıya
 * DEĞİL içeriğe bakar (content sniffing) — ölçüldü (Chrome headless, file://):
 * WebP baytları `sayfa.png` adlı dosyada `naturalWidth=1659` olarak yüklendi.
 * Böylece yayıncının motoruna hiç dokunmadan paket küçülüyor.
 *
 * ŞİFRELEME: varlıklar mod1 ile şifreli — `c = (256 − p) & 0xFF`, involutif, yalnız
 * ilk N bayt (`yayincilikadm/impark_crypto.py`; `.png` için N = DEFAULT_N = 100).
 *
 * KAPI: varsayılan KAPALI (`EMPP_SAYFA_WEBP=1` ile açılır). ProBook kabul kapısından
 * (sayfa + büyüteç + canvas yolu) geçmeden üretimde açılmaz.
 */

const fs = require('fs-extra');
const path = require('path');
const { uyariMetni } = require('./webp-kapi-uyarisi');

const MOD1_N = 100;
const PNG_IMZA = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const PNG_IMZA_SIFRELI = Buffer.from([0x77, 0xb0, 0xb2, 0xb9]); // (256 − x) & 0xFF
const VARSAYILAN_KALITE = 82;
const ESZAMANLI = 4;

/** mod1: ilk n baytı (256 − x) ile çevir. İnvolutif — iki kez uygulanınca özgün döner. */
function mod1(buf, n = MOD1_N) {
  const out = Buffer.from(buf);
  const sinir = Math.min(n, out.length);
  for (let i = 0; i < sinir; i++) out[i] = (256 - out[i]) & 0xff;
  return out;
}

/** @returns {'duz'|'sifreli'|'bilinmiyor'} */
function pngDurumu(buf) {
  if (!buf || buf.length < 4) return 'bilinmiyor';
  if (buf.subarray(0, 4).equals(PNG_IMZA)) return 'duz';
  if (buf.subarray(0, 4).equals(PNG_IMZA_SIFRELI)) return 'sifreli';
  return 'bilinmiyor';
}

/** `…/assets/<kitap>/pages/<ad>.png` mi? Yalnız sayfa görsellerine dokunulur. */
function sayfaGorseliMi(goreliYol) {
  return /(^|[\\/])assets[\\/][^\\/]+[\\/]pages[\\/][^\\/]+\.png$/i.test(goreliYol);
}

/**
 * Tek dosyayı dönüştür. Küçülmüyorsa ÖZGÜNÜ döndürür (paketi büyütmek yasak).
 * @returns {Promise<{cikti: Buffer, donusturuldu: boolean, sebep: string}>}
 */
async function bufferiDonustur(buf, { kalite = VARSAYILAN_KALITE, sharpFn } = {}) {
  const durum = pngDurumu(buf);
  if (durum === 'bilinmiyor') return { cikti: buf, donusturuldu: false, sebep: 'png-degil' };

  const duz = durum === 'sifreli' ? mod1(buf) : buf;

  let webp;
  try {
    const sharp = sharpFn || require('sharp');
    webp = await sharp(duz).webp({ quality: kalite }).toBuffer();
  } catch (e) {
    return { cikti: buf, donusturuldu: false, sebep: 'kodlama-hatasi:' + e.message };
  }

  if (!webp || webp.length >= duz.length) {
    return { cikti: buf, donusturuldu: false, sebep: 'kucultmedi' };
  }

  // Geri okuma: çıktının gerçekten çözülebildiğini doğrula (sessiz bozuk dosya yasak).
  try {
    const sharp = sharpFn || require('sharp');
    const ust = await sharp(webp).metadata();
    if (!ust || !ust.width || !ust.height) {
      return { cikti: buf, donusturuldu: false, sebep: 'dogrulama-basarisiz' };
    }
  } catch (e) {
    return { cikti: buf, donusturuldu: false, sebep: 'dogrulama-hatasi:' + e.message };
  }

  const cikti = durum === 'sifreli' ? mod1(webp) : webp;
  return { cikti, donusturuldu: true, sebep: 'tamam' };
}

/**
 * Bir uygulama dizinindeki TÜM sayfa görsellerini dönüştürür.
 * Dosya adları DEĞİŞMEZ. Yazma atomiktir (geçici dosya + rename).
 */
async function klasoruDonustur(kokDizin, opts = {}) {
  const { kalite = VARSAYILAN_KALITE, kuru = false, log = () => {} } = opts;

  // Sessiz açık kapı arızanın ta kendisiydi (2026-09-21) — kapı açıkken burası,
  // paketleme başında, HER ZAMAN görünür bir uyarı basar.
  const uyari = uyariMetni(process.env);
  if (uyari) log(uyari);

  const ist = { bakilan: 0, donusturulen: 0, atlanan: 0, hata: 0, oncekiBayt: 0, sonrakiBayt: 0, sebepler: {} };

  const adaylar = [];
  async function gez(dizin) {
    let girdiler;
    try { girdiler = await fs.readdir(dizin, { withFileTypes: true }); } catch (e) { return; }
    for (const g of girdiler) {
      const tam = path.join(dizin, g.name);
      if (g.isDirectory()) await gez(tam);
      else if (sayfaGorseliMi(path.relative(kokDizin, tam))) adaylar.push(tam);
    }
  }
  await gez(kokDizin);

  const isle = async (tam) => {
    ist.bakilan++;
    let buf;
    try { buf = await fs.readFile(tam); } catch (e) { ist.hata++; return; }
    ist.oncekiBayt += buf.length;

    const r = await bufferiDonustur(buf, { kalite });
    if (!r.donusturuldu) {
      ist.atlanan++;
      ist.sebepler[r.sebep] = (ist.sebepler[r.sebep] || 0) + 1;
      ist.sonrakiBayt += buf.length;
      return;
    }
    ist.sonrakiBayt += r.cikti.length;
    if (kuru) { ist.donusturulen++; return; }

    const gecici = tam + '.webp-gecici';
    try {
      await fs.writeFile(gecici, r.cikti);
      await fs.rename(gecici, tam);   // atomik — yarım dosya kalmaz
      ist.donusturulen++;
    } catch (e) {
      ist.hata++;
      try { await fs.remove(gecici); } catch (_) {}
    }
  };

  for (let i = 0; i < adaylar.length; i += ESZAMANLI) {
    await Promise.all(adaylar.slice(i, i + ESZAMANLI).map(isle));
  }

  const kazanc = ist.oncekiBayt - ist.sonrakiBayt;
  log(`🖼️  Sayfa WebP: ${ist.donusturulen}/${ist.bakilan} dönüştürüldü, ` +
      `${(ist.oncekiBayt / 1048576).toFixed(0)} MB → ${(ist.sonrakiBayt / 1048576).toFixed(0)} MB ` +
      `(kazanç ${(kazanc / 1048576).toFixed(0)} MB)`);
  return ist;
}

/** Kapı: üretimde yalnız EMPP_SAYFA_WEBP=1 ile açılır. */
function acikMi(env = process.env) {
  return env.EMPP_SAYFA_WEBP === '1';
}

module.exports = {
  mod1, pngDurumu, sayfaGorseliMi, bufferiDonustur, klasoruDonustur, acikMi,
  MOD1_N, VARSAYILAN_KALITE,
};
