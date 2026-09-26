'use strict';
/**
 * T5 — İmpark'ta içerik değişince otomasyon kitabı kendisi yeniden kuyruğa alıyor mu (salt okuma).
 *   L  = İmpark içerik arşivinin (ZKitapZipH/<id>-<Vs>.zip) Last-Modified'ı — içeriğin değiştiği an
 *   C  = L'den sonraki ilk publisher-version-refresh koşusu (srv21 cron 06:20, Europe/Istanbul)
 *   ölçüt: şimdi ≥ C ise dört paket platformunun (windows/mac/android/pardus) last_queued_at ≥ L.
 * Tetiği kim attığından bağımsızdır (gece t5-tetik, Nadir'in elle e2e-guncelle'si, yayıncı yüklemesi).
 */
const O = require('./ortak');
const K = require('./kesif');
const I = require('./impark');

const { DURUM } = O;
const CRON = process.env.EMPP_E2E_YENILEME_CRON || '06:20';
const TZ_DK = 180; // Europe/Istanbul, 2016'dan beri sabit UTC+3

/** L'den SONRAKİ ilk cron anı (ms). Saf. */
function sonrakiCron(lMs, cron = CRON, tzDk = TZ_DK) {
  const [ss, dd] = cron.split(':').map(Number);
  const yerel = new Date(lMs + tzDk * 60000);
  let c =
    Date.UTC(yerel.getUTCFullYear(), yerel.getUTCMonth(), yerel.getUTCDate(), ss, dd) -
    tzDk * 60000;
  if (c <= lMs) c += 24 * 3600 * 1000;
  return c;
}

module.exports = {
  ad: 't5-yeniden-kuyruk',
  testler: ['T5'],
  hazir: true,
  yazar: false,
  agir: false,
  sonrakiCron,
  olcut:
    'İmpark içerik arşivi değişince (Last-Modified = L) publisher-version-refresh (06:20) sonraki ' +
    'koşusunda dört platform satırını yeniden kuyruğa alır: last_queued_at ≥ L',
  bekliyor: null,
  async kos(b) {
    const satir = (durum, olcum) => O.sonuc(b.test, this.ad, durum, { olcum });
    if (!b.kesif || b.kesif.durum !== 'tamam')
      return [
        satir(DURUM.OLCULEMEDI, { sebep: b.kesif ? b.kesif.sebep : 'girdi keşfi yapılmadı' }),
      ];
    if (b.ag === false && !b.istek)
      return [satir(DURUM.OLCULEMEDI, { sebep: 'ağ ölçümü kapalı (EMPP_E2E_AG=0)' })];
    const bilgi = await I.onbellekli(b);
    if (bilgi.durum !== 'tamam') return [satir(DURUM.OLCULEMEDI, { sebep: bilgi.sebep })];
    if (bilgi.sonDegisiklik == null)
      return [
        satir(DURUM.OLCULEMEDI, { sebep: `içerik arşivinde Last-Modified yok (${bilgi.data})` }),
      ];
    const L = bilgi.sonDegisiklik;
    const C = sonrakiCron(L);
    const simdi = b.simdi || Date.now();
    const temel = {
      vs: bilgi.vs,
      icerik_degisti: new Date(L).toISOString(),
      cron: new Date(C).toISOString(),
    };
    if (simdi < C) {
      return [
        satir(DURUM.OLCULEMEDI, {
          ...temel,
          sebep:
            `İmpark içeriği v${bilgi.vs} ${temel.icerik_degisti}'de değişti; yeniden kuyruk ilk ` +
            `publisher-version-refresh koşusunda (${temel.cron}) beklenir — henüz gelmedi`,
        }),
      ];
    }
    const durumlar = K.PAKET_PLATFORMLARI.map((pl) => {
      const s = K.platformSatiri(b.kesif, pl);
      const q = s ? K.dbZamani(s.last_queued_at) : null;
      return {
        platform: pl,
        last_queued_at: s ? s.last_queued_at : null,
        tamam: !!(q && q >= L),
        satir: !!s,
      };
    });
    const eksik = durumlar.filter((d) => !d.tamam);
    if (!eksik.length) return [satir(DURUM.GECTI, { ...temel, platformlar: durumlar })];
    return [
      satir(DURUM.KALDI, {
        ...temel,
        platformlar: durumlar,
        sebep:
          `içerik değişiminden (${temel.icerik_degisti}) sonra yeniden kuyruğa girmeyen: ` +
          eksik
            .map(
              (d) =>
                `${d.platform}${d.satir ? ` (last_queued_at ${d.last_queued_at || 'yok'})` : ' (satır yok)'}`,
            )
            .join(', '),
      }),
    ];
  },
};
