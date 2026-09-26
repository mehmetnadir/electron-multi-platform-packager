'use strict';
/**
 * T1-T4'ün STATİK ayağı: paket-denetle sonuçlarını testlere dağıtır (ölçüm bir kez yapılır).
 *   T1  Windows: NSIS ailesi bekler · imza · bütünlük · paket içi index/43e23 · G (istemci/anahtar/taban)
 *   T2  Pardus: AppImage + squashfs bütünlüğü
 *   T3  K1 (kök index) + K2 (ANA klasör 43e23) — paket içinden, her aileden (Windows'ta K1-K2 buradan)
 *   T4  DMG/APK: aile + bütünlük + G
 * Uygun girdi yoksa tek satır OLCULEMEDI ("girdi yok") — test sessizce yeşile dönmez.
 */
const O = require('./ortak');
const K = require('./kesif');

const PE_AILELERI = new Set(['nsis', 'sfx-rar5', 'sfx-rar4', 'pe-bilinmeyen']);
const T_AILE = {
  T1: {
    beklenen: 'nsis',
    uygun: (a) => PE_AILELERI.has(a),
    uzanti: /\.exe$/i,
    ad: 'Windows (NSIS)',
    platformlar: ['windows'],
  },
  T2: {
    beklenen: 'appimage',
    uygun: (a) => a === 'appimage' || a === 'elf-bilinmeyen',
    uzanti: /\.(impark|appimage)$/i,
    ad: 'Pardus (.impark)',
    platformlar: ['pardus'],
  },
  T4: {
    beklenen: null,
    uygun: (a) => a === 'dmg' || a === 'apk' || a === 'zip',
    uzanti: /\.(dmg|apk)$/i,
    ad: 'DMG/APK',
    platformlar: ['mac', 'android'],
  },
};
// 'db-kanit' (CDN nesnesi ↔ book-update DB file_sha256/boyut — "CDN'deki paket bizim ürettiğimiz
// mi?"): yalnız girdi kitap+platform taşıdığında (keşif) üretilir; T2 ve T4 raporuna da girer.
const T_ALTLAR = {
  T1: null, // hepsi
  T2: new Set(['kaynak', 'aile', 'butunluk', 'indir', 'db-kanit']),
  T4: new Set([
    'kaynak',
    'aile',
    'butunluk',
    'indir',
    'icerik-ac',
    'g-istemci',
    'g-anahtar',
    'g-taban',
    'db-kanit',
  ]),
};

const altAd = (adim) => String(adim).replace(/^paket-denetle\//, '');

/** Sonuç bu teste mi ait? Aile ölçüldüyse aileye, ölçülemediyse uzantıya bakılır. */
function testeUygun(test, sonuc) {
  if (test === 'T3') return true;
  const k = T_AILE[test];
  if (!k) return false;
  const aile = sonuc && sonuc.ozet ? sonuc.ozet.aile : null;
  if (aile) return k.uygun(aile);
  return k.uzanti.test(String(sonuc && sonuc.girdi ? sonuc.girdi.deger : ''));
}

function etiketle(satir, test, adim, girdi, ek = {}) {
  return {
    ...satir,
    test,
    adim,
    kanit: { ...satir.kanit, olcum: { ...(satir.kanit.olcum || {}), girdi, ...ek } },
  };
}

module.exports = {
  ad: 'paket-statik',
  testler: ['T1', 'T2', 'T3', 'T4'],
  hazir: true,
  yazar: false,
  agir: true,
  olcut:
    'paket-denetle: aile · bütünlük · Authenticode · paket içi kök index + ANA klasör 43e23 md5 · ' +
    'G istemcisi + üretim anahtar parmak izi + taban (T1/T2 CDN ölçütleri + K1/K2 paket-içi)',
  bekliyor: null,
  testeUygun,
  async kos(baglam) {
    const { test } = baglam;
    const uygun = (baglam.paketSonuclari || []).filter((s) => testeUygun(test, s));
    if (!uygun.length) {
      const ne = test === 'T3' ? 'herhangi bir paket' : T_AILE[test].ad;
      const sebep =
        baglam.girdiArguman || !baglam.kesif
          ? `girdi yok: ${test} için ${ne} verilmedi (--paket / --url)`
          : K.girdiYokSebebi(
              baglam.kesif,
              test === 'T3' ? K.PAKET_PLATFORMLARI : T_AILE[test].platformlar,
              `${test} için ${ne}`,
            );
      return [O.sonuc(test, this.ad, O.DURUM.OLCULEMEDI, { olcum: { sebep } })];
    }
    const cikti = [];
    for (const s of uygun) {
      const girdi = s.girdi.deger;
      if (test === 'T3') {
        const k = s.satirlar.filter((r) => ['index', '43e23'].includes(altAd(r.adim)));
        if (!k.length) {
          cikti.push(
            O.sonuc(test, 'K1-K2', O.DURUM.OLCULEMEDI, {
              olcum: { girdi, sebep: 'paket içeriği ölçülmedi (kaynak/aile aşamasında durdu)' },
            }),
          );
        }
        // K1/K2'nin nasıl ölçüldüğü (kök, araç, okunan bayt) kanıt olarak yanında durur
        const ac = s.satirlar.find(
          (r) => altAd(r.adim) === 'icerik-ac' && r.durum === O.DURUM.GECTI,
        );
        if (ac) cikti.push(etiketle(ac, test, 'K1-K2-icerik-ac', girdi));
        for (const r of k)
          cikti.push(etiketle(r, test, altAd(r.adim) === 'index' ? 'K1-index' : 'K2-43e23', girdi));
        continue;
      }
      const secili = T_ALTLAR[test];
      for (const r of s.satirlar) {
        const alt = altAd(r.adim);
        if (secili && !secili.has(alt)) continue;
        if (
          alt === 'aile' &&
          T_AILE[test].beklenen &&
          r.kanit.olcum &&
          r.kanit.olcum.aile !== T_AILE[test].beklenen
        ) {
          cikti.push(
            etiketle({ ...r, durum: O.DURUM.KALDI }, test, r.adim, girdi, {
              beklenen: T_AILE[test].beklenen,
              sebep: `${test} ${T_AILE[test].beklenen} bekler, bulunan: ${r.kanit.olcum.aile}`,
            }),
          );
          continue;
        }
        cikti.push(etiketle(r, test, r.adim, girdi));
      }
    }
    return cikti;
  },
};
