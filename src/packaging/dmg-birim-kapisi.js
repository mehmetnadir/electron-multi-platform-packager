'use strict';

// DMG birim çakışması kapısı (2026-09-16, ölçülmüş arıza).
//
// KANIT: 72378 mac işi "Electron Builder mac build failed (exit code 1)" ile düştü.
// Gerçek sebep imza/lisans/kod değil, İSİM ÇAKIŞMASIYDI: electron-builder dmg'yi
// /Volumes/<dmg.title> altına bağlar. Nadir daha önce üretilmiş
// "Lingoland Grade 2 - Maarif Model - YDS Publishing (1).dmg" dosyasını Downloads'tan
// çift tıklayıp açmıştı; aynı ada sahip birim zaten bağlıydı. electron-builder
// "unmounting previous disk image" deyip `hdiutil detach -quiet` denedi, birim meşgul
// olduğu için rc=2 aldı, 5 kez yeniden denedi ve build'i düşürdü.
//
// Bu sınıf tekrarlanabilir: üretilen paketi incelemek DOĞAL bir davranıştır ve
// üretimi düşürmemelidir. Kapı build'den ÖNCE çakışan birimi serbest bırakır;
// bırakamazsa build'i başlatmadan ANLAŞILIR bir hata verir — electron-builder'ın
// beş tekrardan sonra verdiği "exit code 1" yerine.

const path = require('path');

const KOK = '/Volumes';

/**
 * electron-builder'ın dmg'yi bağlayacağı birim adını config'ten çıkarır.
 * dmg.title otoritedir; yoksa electron-builder "<productName> <version>" kullanır.
 * @returns {string|null} ad — belirlenemezse null (kapı sessizce atlanır)
 */
function birimAdi(config) {
  if (!config || typeof config !== 'object') return null;
  const baslik = config.dmg && typeof config.dmg.title === 'string' ? config.dmg.title.trim() : '';
  if (baslik) return baslik;
  const urun = typeof config.productName === 'string' ? config.productName.trim() : '';
  const surum = typeof config.buildVersion === 'string' ? config.buildVersion.trim()
    : (typeof config.version === 'string' ? config.version.trim() : '');
  if (!urun) return null;
  return surum ? `${urun} ${surum}` : urun;
}

/**
 * Birim adını /Volumes altındaki mutlak yola çevirir.
 * Yol ayırıcısı içeren ad (dizin dışına çıkma) reddedilir.
 */
function birimYolu(ad) {
  if (typeof ad !== 'string') return null;
  const temiz = ad.trim();
  if (!temiz || temiz.includes('/') || temiz === '.' || temiz === '..') return null;
  return path.join(KOK, temiz);
}

/**
 * Çakışan birimi serbest bırakır.
 *
 * @param {string} ad birim adı
 * @param {object} bagimliliklar
 *   varMi(yol) -> boolean            : birim bağlı mı
 *   ayir(yol, zorla) -> boolean      : hdiutil detach; başarılıysa true
 * @returns {{durum:'YOK'|'AYRILDI'|'ZORLA_AYRILDI'|'MESGUL'|'GECERSIZ', yol:string|null}}
 */
function serbestBirak(ad, bagimliliklar) {
  const yol = birimYolu(ad);
  if (!yol) return { durum: 'GECERSIZ', yol: null };
  if (!bagimliliklar.varMi(yol)) return { durum: 'YOK', yol };
  if (bagimliliklar.ayir(yol, false)) return { durum: 'AYRILDI', yol };
  // Meşgulse (Finder/Spotlight/mdworker tutuyor olabilir) zorla dene.
  if (bagimliliklar.ayir(yol, true)) return { durum: 'ZORLA_AYRILDI', yol };
  return { durum: 'MESGUL', yol };
}

/** Gerçek hdiutil ile çalışan varsayılan bağımlılıklar. */
function gercekBagimliliklar() {
  const fs = require('fs');
  const { execFileSync } = require('child_process');
  return {
    varMi: (yol) => {
      try { return fs.existsSync(yol); } catch { return false; }
    },
    ayir: (yol, zorla) => {
      const args = ['detach', yol];
      if (zorla) args.push('-force');
      try {
        execFileSync('hdiutil', args, { timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
        return true;
      } catch {
        return false;
      }
    }
  };
}

/**
 * Build öncesi kapı. Serbest bırakılamayan çakışma ATILIR — build'i başlatmak
 * boşuna 5 dakika harcamak ve anlaşılmaz bir "exit code 1" üretmek olur.
 */
function kapiyiUygula(config, { bagimliliklar = gercekBagimliliklar(), log = console.log } = {}) {
  const ad = birimAdi(config);
  if (!ad) return { durum: 'GECERSIZ', yol: null };
  const sonuc = serbestBirak(ad, bagimliliklar);
  if (sonuc.durum === 'AYRILDI' || sonuc.durum === 'ZORLA_AYRILDI') {
    log(`🔓 dmg birim çakışması giderildi (${sonuc.durum.toLowerCase()}): ${sonuc.yol}`);
  } else if (sonuc.durum === 'MESGUL') {
    throw new Error(
      `dmg birimi zaten bağlı ve serbest bırakılamadı: ${sonuc.yol} — ` +
      'aynı adlı bir .dmg açık olabilir; Finder\'dan çıkarıp yeniden deneyin'
    );
  }
  return sonuc;
}

module.exports = { birimAdi, birimYolu, serbestBirak, kapiyiUygula, gercekBagimliliklar, KOK };
