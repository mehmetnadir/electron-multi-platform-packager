'use strict';
/**
 * T1 — Windows üretim işi runner'da mı (build_method=build) + runner iş kanıtında üretilen md5.
 * Salt okuma: pipeline satırı (kesif.js) + ~/.empp-agent/windows-kanit/<id>/<surum>.json
 * (src/agent/windows-serit.js kanitYaz) + canlı şerit bayrakları (run-agent.sh, yalnız ad listesi).
 */
const O = require('./ortak');
const K = require('./kesif');

const { DURUM } = O;
const TAMAM_DURUMLAR = new Set(['imzali-dogrulandi', 'yayinlandi']);

/** Canlı Windows şeridi açık mı — kanıta not düşülür (karar değil). */
function seritNotu(kapilar) {
  if (!kapilar) return null;
  if (kapilar.hata) return `canlı şerit bayrakları okunamadı (${kapilar.dosya}): ${kapilar.hata}`;
  const d = kapilar.degerler;
  const acik = d.EMPP_RUNNER_WINDOWS === '1' && K.listede(d.AGENT_CAPS, 'windows');
  return (
    `canlı Windows şeridi ${acik ? 'AÇIK' : 'KAPALI'} ` +
    `(EMPP_RUNNER_WINDOWS=${d.EMPP_RUNNER_WINDOWS || '-'}, AGENT_CAPS=${d.AGENT_CAPS || '-'})`
  );
}

module.exports = {
  ad: 'runner-is-kaydi',
  testler: ['T1'],
  hazir: true,
  yazar: false,
  agir: false,
  olcut:
    'pipeline windows satırı build_method=build (runner üretimi, İmpark passthrough değil); runner ' +
    "iş kanıtında (windows-kanit/<id>/<surum>.json) imzalı paketin md5'i",
  bekliyor: null,
  seritNotu,
  async kos(b) {
    const not = seritNotu(b.kapilar);
    const satir = (durum, olcum, dosya) =>
      O.sonuc(b.test, this.ad, durum, { ...(dosya ? { dosya } : {}), olcum: { ...olcum, not } });
    const yok = K.satirYokSebebi(b.kesif, 'windows');
    if (yok) return [satir(DURUM.OLCULEMEDI, { sebep: yok })];
    const s = K.platformSatiri(b.kesif, 'windows');
    const temel = {
      status: s.status,
      build_method: s.build_method,
      r2_object_key: s.r2_object_key,
      last_run_at: s.last_run_at,
    };
    if (s.build_method !== 'build') {
      return [
        satir(DURUM.KALDI, {
          ...temel,
          sebep:
            `build_method=${s.build_method || 'NULL'} — Windows paketi runner'da üretilmedi ` +
            "(passthrough: İmpark'ın exe'si)",
        }),
      ];
    }
    const wk = b.windowsKaniti || K.windowsKaniti(b.kitap);
    if (!wk.kanit)
      return [
        satir(DURUM.SARI, {
          ...temel,
          sebep: `build_method=build ama iş kanıtı yok (${wk.dizin})`,
        }),
      ];
    const k = wk.kanit;
    const md5 = k.imzali && k.imzali.md5;
    if (!md5 || !TAMAM_DURUMLAR.has(k.durum)) {
      return [
        satir(
          DURUM.SARI,
          {
            ...temel,
            sebep: `iş kanıtı eksik: durum=${k.durum || '?'}, imzalı md5 ${md5 ? 'var' : 'yok'}`,
          },
          wk.yol,
        ),
      ];
    }
    return [
      satir(
        DURUM.GECTI,
        {
          ...temel,
          md5,
          surum: k.surum || null,
          imzaci: k.imzali.imzaci || null,
          kanit_durumu: k.durum,
        },
        wk.yol,
      ),
    ];
  },
};
