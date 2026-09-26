'use strict';
/**
 * T2/T3/T4 — kurulu uygulamada K3 (ilk kitaba girilir, içerik ölçütü) ve K4 (güncellik sorusu).
 * K1/K2'nin paket-içi (statik) hali paket-statik.js'te; burası kabul kapısının KANITINDAN okur
 * (kabul-kaniti.js): pardus → agent.log ProBook kabul bloğu (E6/E7, KABUL_CDP=1) · mac/android/
 * windows → başsız kabul karar.json. Kapıyı yeniden koşmaz, ProBook'a kurulum yapmaz.
 */
const fs = require('fs');
const O = require('./ortak');
const K = require('./kesif');
const KK = require('./kabul-kaniti');

const { DURUM } = O;

/** Test → ölçülen platformlar (sözleşme: T2 Pardus kabulü, T3 hepsi, T4 DMG/APK). */
const PLATFORMLAR = Object.freeze({
  T2: ['pardus'],
  T3: ['pardus', 'mac', 'android', 'windows'],
  T4: ['mac', 'android'],
});
const WINDOWS_NOTU = "gerçek Windows'ta açma (K3-K4) yeri: açık karar 1 (Nadir)";

function agentLogOku(b) {
  const p = b.paylasim || {};
  if (!p.agentLog) {
    const yol = KK.agentLogYolu();
    try {
      p.agentLog = { yol, metin: fs.readFileSync(yol, 'utf8') };
    } catch (e) {
      p.agentLog = { yol, hata: e.code || e.message };
    }
  }
  return p.agentLog;
}

function kanitYokSebebi(b, platform, yer) {
  const s = K.satirYokSebebi(b.kesif, platform);
  return s ? `${s} — üretim + kabul koşmadı` : `kabul kanıtı yok (${yer})`;
}

function pardus(b, ad) {
  const log = agentLogOku(b);
  const satir = (alt, r, ek = {}) =>
    O.sonuc(b.test, `${ad}/${alt}/pardus`, r.durum, {
      olcum: {
        platform: 'pardus',
        ...ek,
        ...(r.durum === DURUM.GECTI ? { ayrinti: r.sebep } : { sebep: r.sebep }),
      },
    });
  if (log.hata) {
    const r = { durum: DURUM.OLCULEMEDI, sebep: `agent.log okunamadı (${log.yol}): ${log.hata}` };
    return [satir('K3', r), satir('K4', r)];
  }
  const blok = KK.pardusBlogu(log.metin, b.kitap);
  if (!blok) {
    const r = {
      durum: DURUM.OLCULEMEDI,
      sebep: kanitYokSebebi(b, 'pardus', `${log.yol}'da ${b.kitap} pardus işi yok`),
    };
    return [satir('K3', r), satir('K4', r)];
  }
  const ek = { kaynak: log.yol, is_sonu: blok.zaman, is_sonucu: blok.sonuc };
  if (!blok.kabulKostu) {
    const r = {
      durum: DURUM.OLCULEMEDI,
      sebep: `son ${b.kitap} pardus işinde ProBook kabulü koşmadı: ${blok.bitis.slice(-200)}`,
    };
    return [satir('K3', r, ek), satir('K4', r, ek)];
  }
  const o = KK.pardusOzet(blok.satirlar);
  return [satir('K3', KK.k3Pardus(o), ek), satir('K4', KK.k4Pardus(o), ek)];
}

function basliksiz(b, ad, platform) {
  const kk = KK.basliksizKanit(b.kitap, platform);
  const not = platform === 'windows' ? WINDOWS_NOTU : undefined;
  const satir = (alt, r) =>
    O.sonuc(b.test, `${ad}/${alt}/${platform}`, r.durum, {
      ...(kk.yol ? { dosya: kk.yol } : {}),
      olcum: {
        platform,
        ...(r.durum === DURUM.GECTI ? { ayrinti: r.sebep } : { sebep: r.sebep }),
        ...(not ? { not } : {}),
      },
    });
  if (!kk.karar) {
    const r = {
      durum: DURUM.OLCULEMEDI,
      sebep: kanitYokSebebi(b, platform, `${kk.kok}/${b.kitap}-${platform}-*/karar.json`),
    };
    return [satir('K3', r), satir('K4', r)];
  }
  return [satir('K3', KK.k3Basliksiz(kk.karar)), satir('K4', KK.k4Basliksiz(kk.karar))];
}

module.exports = {
  ad: 'kabul-kapisi',
  testler: ['T2', 'T3', 'T4'],
  hazir: true,
  yazar: false,
  agir: false,
  PLATFORMLAR,
  olcut:
    'K3 ilk kitaba girilir, içerik ölçütü geçer · K4 G manifesti ve İmpark içerik kanalı sorulur: ' +
    'kurulu sürümden yenisi varsa RED "güncel değil" — kabul kanıtından (pardus: agent.log E6/E7, ' +
    'mac/android/windows: başsız kabul karar.json)',
  bekliyor: null,
  async kos(b) {
    const cikti = [];
    for (const pl of PLATFORMLAR[b.test] || []) {
      if (pl === 'pardus') cikti.push(...pardus(b, this.ad));
      else cikti.push(...basliksiz(b, this.ad, pl));
    }
    return cikti;
  },
};
