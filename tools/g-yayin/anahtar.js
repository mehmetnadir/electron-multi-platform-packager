'use strict';

/**
 * G YAYIN ANAHTARI — iki kaynak, tek imzalayıcı (sözleşme G4).
 *
 *   --anahtar-zinciri  ÜRETİM. Özel anahtar macOS Anahtar Zinciri'nde (servis
 *                      `empp-guncelleme-ed25519-uretim`, hesap `nadir`); değer PKCS8 PEM'in
 *                      base64 hâli. `/usr/bin/security` çocuk sürecinin stdout BORUSUNDAN
 *                      bu sürecin belleğine alınır; diske, günlüğe, hata metnine YAZILMAZ.
 *                      Türetilen açık anahtar üretim açık anahtarıyla eşleşmezse HATA.
 *   --anahtar-dosya    TEST. PEM dosyası (varsayılan `~/.empp-agent/test-guncelleme-ed25519.key`).
 *                      Dosyadaki anahtar ÜRETİM anahtarıysa RED — üretim anahtarı dosyada durmaz.
 *
 * Doğrulama TEK kaynaktan: istemcinin kendi `manifestImzasiGecerliMi` işlevi
 * (`src/runtime/kitap-guncelleyici.js`). İmzalayan ile doğrulayan ayrışamaz.
 *
 * Hata metinleri yalnız yol/servis adı/çıkış kodu taşır; anahtar baytı taşımaz.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const kg = require('../../src/runtime/kitap-guncelleyici');

/** Üretim açık anahtarı (SPKI DER, base64) — 26.09 üretildi. SIR DEĞİLDİR. */
const URETIM_ACIK_ANAHTAR = 'MCowBQYDK2VwAyEAkPKHFRPDIeuQqAa8kWELMl2+14Ga/WHrjfVHDeTR4H4=';
/** sha256(SPKI DER) — `31b8663b…2cf6`. */
const URETIM_PARMAK_IZI = '31b8663bf0202f7fca82595f8cabb4b46b348d60b4d6e47512836e5f721d2cf6';
const ANAHTAR_ZINCIRI = Object.freeze({ servis: 'empp-guncelleme-ed25519-uretim', hesap: 'nadir' });
const TEST_ANAHTAR_YOLU = path.join(os.homedir(), '.empp-agent', 'test-guncelleme-ed25519.key');
const GUVENLIK_ARACI = '/usr/bin/security';
const ZINCIR_ZAMAN_ASIMI_MS = 20000;

/** Özel ya da açık KeyObject → SPKI DER base64. */
function acikAnahtarB64(anahtar) {
  const acik = anahtar.type === 'public' ? anahtar : crypto.createPublicKey(anahtar);
  return acik.export({ type: 'spki', format: 'der' }).toString('base64');
}

/** sha256(SPKI DER) hex. */
function parmakIzi(acikB64) {
  return crypto.createHash('sha256').update(Buffer.from(String(acikB64), 'base64')).digest('hex');
}

function kisaIz(iz) {
  return `${iz.slice(0, 8)}…${iz.slice(-4)}`;
}

function ed25519OzelMi(k) {
  return !!k && k.type === 'private' && k.asymmetricKeyType === kg.IMZA_ALG;
}

/**
 * Test anahtarı dosyadan. Üretim anahtarı dosyadaysa RED.
 * @param {string} [yol] varsayılan TEST_ANAHTAR_YOLU
 * @param {{uretimAcik?:string}} [s] test enjeksiyonu (varsayılan üretim açık anahtarı)
 */
function dosyadanOku(yol, s = {}) {
  const uretimAcik = s.uretimAcik || URETIM_ACIK_ANAHTAR;
  const y = path.resolve(String(yol || TEST_ANAHTAR_YOLU));
  let k;
  try {
    k = crypto.createPrivateKey(fs.readFileSync(y));
  } catch (e) {
    throw new Error(`anahtar dosyası okunamadı ya da PEM değil: ${y}`);
  }
  if (!ed25519OzelMi(k)) throw new Error(`anahtar dosyası ed25519 özel anahtarı değil: ${y}`);
  if (acikAnahtarB64(k) === uretimAcik) {
    throw new Error('ÜRETİM anahtarı dosyada bulundu — üretim anahtarı yalnız Anahtar Zinciri\'nden '
      + 'okunur (--anahtar-zinciri); dosyayı Nadir\'e bildir');
  }
  return k;
}

/**
 * Varsayılan çalıştırıcı: `security find-generic-password -s <servis> -a <hesap> -w`.
 * stdout Buffer olarak döner (bellekte); çıktı hiçbir yere yazılmaz. Zaman aşımında
 * süreç öldürülür (izin penceresi açılmışsa sonsuz askı olmasın).
 */
function varsayilanCalistir(komut, argumanlar, { zamanAsimiMs = ZINCIR_ZAMAN_ASIMI_MS } = {}) {
  return new Promise((coz) => {
    let cocuk;
    try {
      cocuk = spawn(komut, argumanlar, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      coz({ kod: -1, stdout: Buffer.alloc(0), stderr: 'başlatılamadı', zamanAsimi: false });
      return;
    }
    const parcalar = [];
    let hata = '';
    let bitti = false;
    const sayac = setTimeout(() => {
      if (bitti) return;
      bitti = true;
      try { cocuk.kill('SIGKILL'); } catch (e) { /* zaten bitmiş */ }
      for (const p of parcalar) p.fill(0);
      coz({ kod: -1, stdout: Buffer.alloc(0), stderr: '', zamanAsimi: true });
    }, zamanAsimiMs);
    cocuk.stdout.on('data', (p) => parcalar.push(p));
    cocuk.stderr.on('data', (p) => { if (hata.length < 400) hata += p.toString('utf8'); });
    cocuk.on('error', () => {
      if (bitti) return;
      bitti = true; clearTimeout(sayac);
      coz({ kod: -1, stdout: Buffer.alloc(0), stderr: 'çalıştırılamadı', zamanAsimi: false });
    });
    cocuk.on('close', (kod) => {
      if (bitti) return;
      bitti = true; clearTimeout(sayac);
      const stdout = Buffer.concat(parcalar);
      for (const p of parcalar) p.fill(0);
      coz({ kod, stdout, stderr: hata.slice(0, 400), zamanAsimi: false });
    });
  });
}

/**
 * Üretim anahtarını Anahtar Zinciri'nden okur. Dönen KeyObject dışında hiçbir iz kalmaz
 * (ara Buffer'lar sıfırlanır). Açık anahtar üretim anahtarıyla eşleşmezse HATA.
 * @param {object} [s]
 * @param {Function} [s.calistir] test enjeksiyonu: `(komut, argumanlar, {zamanAsimiMs}) → {kod, stdout, stderr, zamanAsimi}`
 * @param {string} [s.beklenenAcik] eşleşmesi gereken açık anahtar (varsayılan üretim)
 */
async function anahtarZincirindenOku(s = {}) {
  const servis = s.servis || ANAHTAR_ZINCIRI.servis;
  const hesap = s.hesap || ANAHTAR_ZINCIRI.hesap;
  const calistir = typeof s.calistir === 'function' ? s.calistir : varsayilanCalistir;
  const beklenen = s.beklenenAcik === undefined ? URETIM_ACIK_ANAHTAR : s.beklenenAcik;

  const y = await calistir(GUVENLIK_ARACI,
    ['find-generic-password', '-s', servis, '-a', hesap, '-w'],
    { zamanAsimiMs: s.zamanAsimiMs || ZINCIR_ZAMAN_ASIMI_MS });
  const ham = Buffer.isBuffer(y && y.stdout) ? y.stdout : Buffer.alloc(0);
  try {
    if (y && y.zamanAsimi) {
      throw new Error(`Anahtar Zinciri yanıt vermedi (${servis}) — izin penceresi bekliyor olabilir`);
    }
    if (!y || y.kod !== 0) {
      const iz = String((y && y.stderr) || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      throw new Error(`Anahtar Zinciri kaydı okunamadı (servis ${servis}, hesap ${hesap}, `
        + `çıkış ${y ? y.kod : 'yok'}${iz ? ': ' + iz : ''})`);
    }
    let pem = null;
    let k = null;
    try {
      pem = Buffer.from(ham.toString('latin1').trim(), 'base64');
      k = crypto.createPrivateKey({ key: pem, format: 'pem' });
    } catch (e) {
      k = null;
    } finally {
      if (pem) pem.fill(0);
    }
    if (!ed25519OzelMi(k)) {
      throw new Error(`Anahtar Zinciri değeri base64(PKCS8 PEM) ed25519 özel anahtarı değil (${servis})`);
    }
    if (beklenen && acikAnahtarB64(k) !== beklenen) {
      throw new Error(`Anahtar Zinciri anahtarı beklenen açık anahtarla eşleşmiyor `
        + `(${kisaIz(parmakIzi(acikAnahtarB64(k)))} ≠ ${kisaIz(parmakIzi(beklenen))})`);
    }
    return k;
  } finally {
    ham.fill(0);
  }
}

/**
 * Kaynağı seçip anahtarı yükler.
 * @param {{zincir?:boolean, dosya?:string|true, calistir?:Function}} kaynak
 * @returns {Promise<{ozel: crypto.KeyObject, acik: string, parmakIzi: string, kaynak: string}>}
 */
async function anahtarYukle(kaynak = {}) {
  const zincir = !!kaynak.zincir;
  const dosyaVar = kaynak.dosya !== undefined && kaynak.dosya !== null && kaynak.dosya !== false;
  if (zincir === dosyaVar) {
    throw new Error('anahtar kaynağı tam olarak bir tane olmalı: --anahtar-zinciri (üretim) '
      + 'ya da --anahtar-dosya [yol] (test)');
  }
  let ozel;
  let etiket;
  if (zincir) {
    ozel = await anahtarZincirindenOku({ calistir: kaynak.calistir });
    etiket = 'anahtar-zinciri';
  } else {
    const yol = kaynak.dosya === true || kaynak.dosya === '' ? TEST_ANAHTAR_YOLU : kaynak.dosya;
    ozel = dosyadanOku(yol);
    etiket = 'dosya:' + path.resolve(String(yol));
  }
  const acik = acikAnahtarB64(ozel);
  return { ozel, acik, parmakIzi: parmakIzi(acik), kaynak: etiket };
}

/** Baytları imzalar (base64 metin); hemen istemcinin doğrulayıcısıyla sınar. */
function imzala(govde, ozel, acikB64) {
  const veri = Buffer.from(govde);
  const imza = crypto.sign(null, veri, ozel).toString('base64');
  const acik = acikB64 || acikAnahtarB64(ozel);
  if (!kg.manifestImzasiGecerliMi(veri, imza, acik)) throw new Error('imza öz-doğrulaması tutmadı');
  return imza;
}

/** İstemcinin doğrulayıcısı (tek kaynak). */
function dogrula(govde, imzaMetni, acikB64) {
  return kg.manifestImzasiGecerliMi(Buffer.from(govde), imzaMetni, acikB64);
}

/**
 * KURU İMZA — Anahtar Zinciri yolunu uçtan uca sınar: üretim anahtarını okur, bir test
 * gövdesini imzalar, gövdeyi ÜRETİM açık anahtarıyla doğrular. Hiçbir şey yazmaz/yayınlamaz.
 * @returns {Promise<{gecti:boolean, sebep:string}>}
 */
async function kuruImza(s = {}) {
  try {
    const ozel = await anahtarZincirindenOku({ calistir: s.calistir });
    const govde = Buffer.from(`empp-g-yayin kuru imza ${new Date().toISOString()} `
      + crypto.randomBytes(8).toString('hex'), 'utf8');
    const imza = crypto.sign(null, govde, ozel).toString('base64');
    if (!dogrula(govde, imza, URETIM_ACIK_ANAHTAR)) return { gecti: false, sebep: 'imza doğrulanmadı' };
    const bozuk = Buffer.concat([govde, Buffer.from('x')]);
    if (dogrula(bozuk, imza, URETIM_ACIK_ANAHTAR)) return { gecti: false, sebep: 'bozuk gövde de geçti' };
    return { gecti: true, sebep: '' };
  } catch (e) {
    return { gecti: false, sebep: e && e.message ? e.message : 'bilinmeyen' };
  }
}

module.exports = {
  URETIM_ACIK_ANAHTAR,
  URETIM_PARMAK_IZI,
  ANAHTAR_ZINCIRI,
  TEST_ANAHTAR_YOLU,
  GUVENLIK_ARACI,
  acikAnahtarB64,
  parmakIzi,
  kisaIz,
  dosyadanOku,
  varsayilanCalistir,
  anahtarZincirindenOku,
  anahtarYukle,
  imzala,
  dogrula,
  kuruImza,
};
