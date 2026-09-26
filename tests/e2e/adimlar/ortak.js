'use strict';
/**
 * Uçtan uca sağlık testi — ORTAK parçalar.
 * Sözleşme: `.claude/docs/uctan-uca-saglik-sozlesmesi.md` (T1-T5, K1-K4).
 *
 * Sonuç şeması (her adım bir ya da birkaç satır döner):
 *   {test, adim, durum: GECTI|KALDI|SARI|OLCULEMEDI, kanit: {dosya?|komut?|olcum?}, sure_ms}
 *
 * Durum anlamları:
 *   GECTI      ölçüldü, ölçüt tuttu
 *   KALDI      ölçüldü, ölçüt tutmadı (kanıt yazılır)
 *   SARI       ölçüldü ama tam değil (ör. imza dizini var, zincir doğrulanamadı; Mac'e düşme)
 *   OLCULEMEDI ölçüm yapılamadı (araç yok, girdi yok, adım henüz bağlanmadı) — "yok" DEMEK DEĞİL
 *
 * Bağımlılık: yalnız Node stdlib.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DURUM = Object.freeze({
  GECTI: 'GECTI',
  KALDI: 'KALDI',
  SARI: 'SARI',
  OLCULEMEDI: 'OLCULEMEDI',
});
/** Genel hüküm sırası: KALDI > OLCULEMEDI > SARI > GECTI (bilinmeyen, sarıdan kötüdür). */
const AGIRLIK = Object.freeze({ GECTI: 0, SARI: 1, OLCULEMEDI: 2, KALDI: 3 });

const MOTOR_ADI = '43e23fce2b7009474555a77.js';
/** sha256(SPKI DER) — üretim ed25519 açık anahtarı (tools/g-yayin/anahtar.js ile aynı). */
const URETIM_PARMAK_IZI = '31b8663bf0202f7fca82595f8cabb4b46b348d60b4d6e47512836e5f721d2cf6';
const VARSAYILAN_TABAN = 'https://cdn.ydspublishing.com/guncelleme';
const DEMO_KITAP = '74390';

/** Tek sonuç satırı. Bilinmeyen durum programcı hatasıdır → throw. */
function sonuc(test, adim, durum, kanit = {}, sureMs = 0) {
  if (!Object.prototype.hasOwnProperty.call(DURUM, durum)) {
    throw new Error(`bilinmeyen durum: ${durum}`);
  }
  return { test, adim, durum, kanit, sure_ms: Math.max(0, Math.round(sureMs)) };
}

/** Satır listesinin en kötü durumu; boş liste → OLCULEMEDI (hiç ölçüm yok = bilinmiyor). */
function enKotu(durumlar) {
  const l = (durumlar || []).filter(Boolean);
  if (!l.length) return DURUM.OLCULEMEDI;
  return l.reduce((a, b) => (AGIRLIK[b] > AGIRLIK[a] ? b : a), DURUM.GECTI);
}

function sayac(satirlar) {
  const s = { GECTI: 0, KALDI: 0, SARI: 0, OLCULEMEDI: 0 };
  for (const r of satirlar || []) s[r.durum] += 1;
  return s;
}

function md5(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Dosyanın md5'i, parça parça okunarak (bellek sabit). */
function md5Dosya(yol) {
  const h = crypto.createHash('md5');
  const fd = fs.openSync(yol, 'r');
  try {
    const tampon = Buffer.alloc(8 * 1024 * 1024);
    let n;
    // eslint-disable-next-line no-cond-assign
    while ((n = fs.readSync(fd, tampon, 0, tampon.length, null)) > 0)
      h.update(tampon.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

/**
 * Araç yolu. `ezme[ad]` verilmişse o kullanılır (`null` = "araç yok" benzetimi — testler için).
 * Yoksa PATH + Homebrew/yerel adayları denenir.
 */
function aracBul(ad, ezme = {}) {
  if (ezme && Object.prototype.hasOwnProperty.call(ezme, ad)) return ezme[ad];
  const adaylar = [`/opt/homebrew/bin/${ad}`, `/usr/local/bin/${ad}`, `/usr/bin/${ad}`];
  for (const a of adaylar) {
    try {
      if (fs.statSync(a).isFile()) return a;
    } catch (_) {
      /* yok */
    }
  }
  const r = spawnSync('/usr/bin/which', [ad], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/** spawnSync sarmalı: süre tavanı varsayılan 110 sn (ajan kuralı: tek çağrı ≤120 sn). */
function calistir(komut, argumanlar, secenek = {}) {
  return spawnSync(komut, argumanlar, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 110000,
    ...secenek,
  });
}

/** Yerel saatle `YYYYMMDD-HHMM`. */
function zamanDamgasi(t = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}`;
}

/** Rapor dizini: `EMPP_E2E_DIZIN` ya da `~/.empp-agent/e2e`. */
function raporDizini(env = process.env) {
  return env.EMPP_E2E_DIZIN || path.join(os.homedir(), '.empp-agent', 'e2e');
}

/** Paket açma çalışma dizini (her koşuda üzerine yazılır): `EMPP_E2E_CALISMA` ya da rapor/calisma. */
function calismaDizini(env = process.env) {
  return env.EMPP_E2E_CALISMA || path.join(raporDizini(env), 'calisma');
}

/**
 * Henüz bağlanmamış (onay/kod bekleyen) adımın satırı. Sessiz atlama yok: ne beklediği yazılır.
 */
function bekleyenSatir(test, tanim, ek = {}) {
  return sonuc(test, tanim.ad, DURUM.OLCULEMEDI, {
    olcum: { bekliyor: tanim.bekliyor, olcut: tanim.olcut, ...ek },
  });
}

module.exports = {
  DURUM,
  AGIRLIK,
  MOTOR_ADI,
  URETIM_PARMAK_IZI,
  VARSAYILAN_TABAN,
  DEMO_KITAP,
  sonuc,
  enKotu,
  sayac,
  md5,
  sha256,
  md5Dosya,
  aracBul,
  calistir,
  zamanDamgasi,
  raporDizini,
  calismaDizini,
  bekleyenSatir,
};
