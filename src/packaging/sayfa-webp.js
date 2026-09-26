'use strict';

/**
 * SAYFA GÖRSELLERİ → WebP (dosya adı `.png` KALIR)
 *
 * NEDEN (2026-09-18, ölçüldü): paketlerin %91'i `resources/app.asar`, onun da %97'si
 * `assets/` — yani sayfa görselleri. Sayfalar 1659×2340 8-bit RGB PNG. 40 sayfalık
 * temsili örneklemde WebP q82 **%52** boyut veriyor ve gözle özgünden ayırt edilemiyor
 * (PNG8 256 renk benzer boyut veriyor ama gradyanlarda bantlanma üretiyor — kullanılmaz).
 *
 * NEDEN VARSAYILAN KİP `kayipsiz`'E DÖNDÜ (2026-09-22, yeniden ölçüldü — Nadir q82'de
 * pikselleşme GÖRDÜ): 25 sayfalık örnekte kayıplı q82'nin en kötü sayfası **32,4 dB
 * PSNR** veriyor — bu görülen pikselleşmenin kanıtı. Kayıpsız WebP (sharp
 * `{lossless:true}`, effort varsayılan 4) aynı 25 sayfanın 25'inde de decode-edilmiş
 * piksel çıktısını özgünle **bayt-eşit** (PSNR sonsuz) üretiyor ve paketi yine **%47**
 * küçültüyor (effort 6'ya geçmeye değmez: daha büyük + %18 daha yavaş çıktı verdi).
 * near-lossless q60 ara nokta: en kötü PSNR 52,5 dB (q82'den ~20 dB daha temiz), %58
 * küçülme. Detay ölçüm: `WEBP-KAYIPSIZ-OLCUMU.md`. Bu yüzden **varsayılan kip artık
 * `kayipsiz`**; kayıplı (eski davranış, en yüksek küçülme ama pikselleşme riski)
 * yalnız açık env talebiyle seçilir.
 *
 * KİPLER (`EMPP_SAYFA_WEBP_KIP`, geçersiz/tanımsız değer → `kayipsiz` + görünür UYARI):
 *   - `kayipsiz` (VARSAYILAN) — sharp `{lossless:true}`. Bayt-eşit piksel, ~%47 küçülme.
 *   - `yakin`    — `{nearLossless:true, quality:N}` (N=`EMPP_SAYFA_WEBP_KALITE`,
 *                  varsayılan 60). En kötü PSNR 52,5 dB (q60), ~%58 küçülme.
 *   - `kayipli`  — eski davranış, `{quality:82}`. En büyük küçülme (~%85) ama en kötü
 *                  PSNR 32,4 dB — bildirilen pikselleşme buradan geliyordu.
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
const { kapiAcikMi } = require('./platform-kapisi');
const onbellek = require('./webp-onbellek');

const MOD1_N = 100;
const PNG_IMZA = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const PNG_IMZA_SIFRELI = Buffer.from([0x77, 0xb0, 0xb2, 0xb9]); // (256 − x) & 0xFF
const VARSAYILAN_KALITE = 82; // yalnız kip='kayipli'
const VARSAYILAN_YAKIN_KALITE = 60; // yalnız kip='yakin'
const KIP_KAYIPSIZ = 'kayipsiz';
const KIP_YAKIN = 'yakin';
const KIP_KAYIPLI = 'kayipli';
const GECERLI_KIPLER = [KIP_KAYIPSIZ, KIP_YAKIN, KIP_KAYIPLI];
const VARSAYILAN_KIP = KIP_KAYIPSIZ;
const ESZAMANLI = 4;

/**
 * `EMPP_SAYFA_WEBP_KIP`'i çözer. Tanımsız/geçersiz değer sessizce değil, UYARI ile
 * `kayipsiz`'e düşer.
 * @returns {{kip: 'kayipsiz'|'yakin'|'kayipli', uyari: string|null}}
 */
function kipCoz(env = process.env) {
  const ham = env && env.EMPP_SAYFA_WEBP_KIP;
  if (!ham) return { kip: VARSAYILAN_KIP, uyari: null };
  if (GECERLI_KIPLER.includes(ham)) return { kip: ham, uyari: null };
  return {
    kip: VARSAYILAN_KIP,
    uyari: `UYARI: EMPP_SAYFA_WEBP_KIP="${ham}" geçersiz (kayipsiz|yakin|kayipli) — ` +
      `varsayılan '${VARSAYILAN_KIP}' kullanılıyor.`,
  };
}

/** kip → sharp `.webp()` seçenek nesnesi. */
function sharpSecenekleri(kip, { yakinKalite = VARSAYILAN_YAKIN_KALITE, kayipliKalite = VARSAYILAN_KALITE } = {}) {
  if (kip === KIP_KAYIPSIZ) return { lossless: true };
  if (kip === KIP_YAKIN) return { nearLossless: true, quality: yakinKalite };
  return { quality: kayipliKalite }; // kip === KIP_KAYIPLI
}

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
 * @param {Buffer} buf
 * @param {{kip?: string, kalite?: number, sharpFn?: Function, log?: Function,
 *   onbellek?: {acik: boolean, dizin?: string|null, tavanGb?: number},
 *   onbellekSayac?: {isabet: number, iska: number, yazilan: number}}} [opts]
 *   `kip` verilmezse `EMPP_SAYFA_WEBP_KIP` env'inden çözülür (varsayılan `kayipsiz`).
 *   `kalite` yalnız `yakin`/`kayipli` kiplerinde etkilidir (yakin varsayılanı
 *   `EMPP_SAYFA_WEBP_KALITE` env'inden, yoksa 60; kayipli varsayılanı 82).
 *   `onbellek` verilmezse KAPALI sayılır — çevreden otomatik açılmaz, açan tek
 *   yer `klasoruDonustur` (bkz. `webp-onbellek.js`); böylece bu fonksiyonu tek
 *   başına çağıran testler/kod yanlışlıkla gerçek önbellek dizinine dokunmaz.
 * @returns {Promise<{cikti: Buffer, donusturuldu: boolean, sebep: string, kip: string, onbellek?: string}>}
 */
async function bufferiDonustur(buf, opts = {}) {
  const { sharpFn, log = () => {} } = opts;
  const durum = pngDurumu(buf);
  const { kip, uyari } = opts.kip ? { kip: opts.kip, uyari: null } : kipCoz(process.env);
  if (uyari) log(uyari);
  if (durum === 'bilinmiyor') return { cikti: buf, donusturuldu: false, sebep: 'png-degil', kip };

  const onbellekAyar = opts.onbellek || { acik: false };
  const onbellekSayac = opts.onbellekSayac;
  let onbellekAnahtar = null;
  if (onbellekAyar.acik) {
    onbellekAnahtar = onbellek.anahtarHesapla(buf, kip);
    const bulunan = await onbellek.oku(onbellekAyar.dizin, onbellekAnahtar, {
      sifreliMi: durum === 'sifreli',
      mod1Fn: mod1,
    });
    if (bulunan) {
      if (onbellekSayac) onbellekSayac.isabet++;
      if (bulunan.tur === 'ozgun') {
        return { cikti: buf, donusturuldu: false, sebep: 'kucultmedi', kip, onbellek: 'isabet' };
      }
      return { cikti: bulunan.cikti, donusturuldu: true, sebep: 'tamam', kip, onbellek: 'isabet' };
    }
    if (onbellekSayac) onbellekSayac.iska++;
  }

  const duz = durum === 'sifreli' ? mod1(buf) : buf;

  const yakinKaliteVarsayilan = Number(process.env.EMPP_SAYFA_WEBP_KALITE) || VARSAYILAN_YAKIN_KALITE;
  const kalite = opts.kalite !== undefined ? opts.kalite : undefined;
  const secenek = sharpSecenekleri(kip, {
    yakinKalite: kalite !== undefined ? kalite : yakinKaliteVarsayilan,
    kayipliKalite: kalite !== undefined ? kalite : VARSAYILAN_KALITE,
  });

  let webp;
  try {
    const sharp = sharpFn || require('sharp');
    webp = await sharp(duz).webp(secenek).toBuffer();
  } catch (e) {
    // Kodlama hatası ÖNBELLEĞE YAZILMAZ — geçici/ortamsal olabilir, her seferinde tekrar denenmeli.
    return { cikti: buf, donusturuldu: false, sebep: 'kodlama-hatasi:' + e.message, kip };
  }

  if (!webp || webp.length >= duz.length) {
    if (onbellekAyar.acik) {
      try {
        await onbellek.yaz(onbellekAyar.dizin, onbellekAnahtar, { tur: 'ozgun' });
        if (onbellekSayac) onbellekSayac.yazilan++;
      } catch (_) { /* önbellek yazma hatası üretim akışını durdurmamalı */ }
    }
    return { cikti: buf, donusturuldu: false, sebep: 'kucultmedi', kip, onbellek: onbellekAyar.acik ? 'iska' : undefined };
  }

  // Geri okuma: çıktının gerçekten çözülebildiğini doğrula (sessiz bozuk dosya yasak).
  try {
    const sharp = sharpFn || require('sharp');
    const ust = await sharp(webp).metadata();
    if (!ust || !ust.width || !ust.height) {
      return { cikti: buf, donusturuldu: false, sebep: 'dogrulama-basarisiz', kip };
    }
  } catch (e) {
    // Doğrulama hatası da ÖNBELLEĞE YAZILMAZ — aynı sebepten.
    return { cikti: buf, donusturuldu: false, sebep: 'dogrulama-hatasi:' + e.message, kip };
  }

  const cikti = durum === 'sifreli' ? mod1(webp) : webp;

  if (onbellekAyar.acik) {
    try {
      await onbellek.yaz(onbellekAyar.dizin, onbellekAnahtar, { tur: 'webp', cikti });
      if (onbellekSayac) onbellekSayac.yazilan++;
    } catch (_) { /* önbellek yazma hatası üretim akışını durdurmamalı */ }
  }

  return { cikti, donusturuldu: true, sebep: 'tamam', kip, onbellek: onbellekAyar.acik ? 'iska' : undefined };
}

/**
 * Bir uygulama dizinindeki TÜM sayfa görsellerini dönüştürür.
 * Dosya adları DEĞİŞMEZ. Yazma atomiktir (geçici dosya + rename).
 * @param {string} kokDizin
 * @param {{kip?: string, kalite?: number, kuru?: boolean, log?: Function, sharpFn?: Function,
 *   onbellek?: {acik: boolean, dizin?: string|null, tavanGb?: number}}} [opts]
 *   `kip` verilmezse `EMPP_SAYFA_WEBP_KIP` env'inden çözülür (varsayılan `kayipsiz`).
 *   `onbellek` verilmezse `EMPP_WEBP_ONBELLEK`/`EMPP_WEBP_ONBELLEK_GB` env'inden
 *   çözülür (varsayılan açık, `~/.empp-agent/webp-onbellek`, tavan 30 GB —
 *   bkz. `webp-onbellek.js`).
 */
async function klasoruDonustur(kokDizin, opts = {}) {
  const { kalite, kuru = false, log = () => {}, sharpFn } = opts;

  const { kip, uyari: kipUyarisi } = opts.kip ? { kip: opts.kip, uyari: null } : kipCoz(process.env);
  if (kipUyarisi) log(kipUyarisi);

  // Sessiz açık kapı arızanın ta kendisiydi (2026-09-21) — kapı açıkken burası,
  // paketleme başında, HER ZAMAN görünür bir uyarı basar.
  const uyari = uyariMetni(process.env);
  if (uyari) log(uyari);

  const onbellekAyar = opts.onbellek || onbellek.ayarlariCoz(process.env);
  const onbellekSayac = { isabet: 0, iska: 0, yazilan: 0 };

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

    const r = await bufferiDonustur(buf, { kip, kalite, sharpFn, onbellek: onbellekAyar, onbellekSayac });
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
  log(`[sayfa-webp] kip=${kip} 🖼️  Sayfa WebP: ${ist.donusturulen}/${ist.bakilan} dönüştürüldü, ` +
      `${(ist.oncekiBayt / 1048576).toFixed(0)} MB → ${(ist.sonrakiBayt / 1048576).toFixed(0)} MB ` +
      `(kazanç ${(kazanc / 1048576).toFixed(0)} MB)`);

  log(`webp-onbellek isabet=${onbellekSayac.isabet} ıska=${onbellekSayac.iska} yazılan=${onbellekSayac.yazilan}`);

  if (onbellekAyar.acik && onbellekSayac.yazilan > 0) {
    try {
      const budama = await onbellek.budaGerekirse(onbellekAyar.dizin, onbellekAyar.tavanGb);
      if (budama.silinen > 0) {
        log(`[webp-onbellek] tavan aşıldı: ${budama.silinen} eski girdi silindi ` +
            `(${(budama.oncekiToplamBayt / 1073741824).toFixed(2)} GB → ` +
            `${(budama.sonrakiToplamBayt / 1073741824).toFixed(2)} GB)`);
      }
    } catch (_) { /* budama başarısız olsa da paketleme durmaz */ }
  }

  ist.onbellek = onbellekSayac;
  return ist;
}

/**
 * Kapı: varsayılan KAPALI; `1` her platformda açar. Platform listesi (`windows`,
 * `windows,macos`) yalnız işin platformlarının HEPSİ listedeyse açar —
 * `./platform-kapisi.js` (2026-09-26, Windows sözleşmesi madde 5: kayıpsız WebP).
 * @param {Object} [env]
 * @param {string[]} [platforms] işin platformları (`jobInfo.platforms`)
 * @param {{uyar?: function(string): void}} [secenek]
 */
function acikMi(env = process.env, platforms, secenek) {
  return kapiAcikMi('EMPP_SAYFA_WEBP', env, platforms, false, secenek);
}

module.exports = {
  mod1, pngDurumu, sayfaGorseliMi, bufferiDonustur, klasoruDonustur, acikMi,
  kipCoz, sharpSecenekleri,
  MOD1_N, VARSAYILAN_KALITE, VARSAYILAN_YAKIN_KALITE,
  KIP_KAYIPSIZ, KIP_YAKIN, KIP_KAYIPLI, VARSAYILAN_KIP,
};
