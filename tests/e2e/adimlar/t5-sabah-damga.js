'use strict';
/**
 * T5 — sabah doğrulaması: yeni paketlerde kitabın içerik sürümü = İmpark'taki güncel sürüm (Vs).
 * Paket içi menü (classlibraries/ImWin32.dll) kapak `version`'ı paket-denetle'nin içerik okumasından
 * (icerik-ac → olcum.menu_kapaklar) gelir; Vs İmpark ucundan (impark.js). Salt okuma.
 */
const O = require('./ortak');
const K = require('./kesif');
const I = require('./impark');

const { DURUM } = O;

module.exports = {
  ad: 't5-sabah-damga',
  testler: ['T5'],
  hazir: true,
  yazar: false,
  agir: true,
  paketIster: true,
  olcut:
    "yeni paketlerde kitabın içerik sürümü (paket içi ImWin32.dll kapak version) = İmpark'taki güncel Vs",
  bekliyor: null,
  async kos(b) {
    const satir = (durum, olcum, ek = '') => O.sonuc(b.test, `${this.ad}${ek}`, durum, { olcum });
    const paketler = b.paketSonuclari || [];
    if (!paketler.length) {
      const sebep = b.girdiArguman
        ? 'girdi yok: paket verilmedi (--paket / --url)'
        : K.girdiYokSebebi(b.kesif, K.PAKET_PLATFORMLARI, 'paket');
      return [satir(DURUM.OLCULEMEDI, { sebep })];
    }
    if (b.ag === false && !b.istek)
      return [satir(DURUM.OLCULEMEDI, { sebep: 'ağ ölçümü kapalı (EMPP_E2E_AG=0)' })];
    const bilgi = await I.onbellekli(b);
    if (bilgi.durum !== 'tamam') return [satir(DURUM.OLCULEMEDI, { sebep: bilgi.sebep })];
    return paketler.map((p) => {
      const girdi = p.girdi.deger;
      const ek = `/${p.girdi.platform || (p.ozet && p.ozet.aile) || 'paket'}`;
      const ac = (p.satirlar || []).find((r) => r.adim === 'paket-denetle/icerik-ac');
      if (!ac || ac.durum !== DURUM.GECTI) {
        const neden = ac ? (ac.kanit.olcum && ac.kanit.olcum.sebep) || ac.durum : 'içerik açılmadı';
        return satir(
          DURUM.OLCULEMEDI,
          { girdi, vs: bilgi.vs, sebep: `paket içeriği okunmadı: ${neden}` },
          ek,
        );
      }
      const kap = ac.kanit.olcum.menu_kapaklar;
      if (kap === undefined)
        return satir(
          DURUM.OLCULEMEDI,
          { girdi, vs: bilgi.vs, sebep: 'pakette classlibraries/ImWin32.dll yok' },
          ek,
        );
      if (kap === null)
        return satir(
          DURUM.OLCULEMEDI,
          { girdi, vs: bilgi.vs, sebep: 'ImWin32.dll menüsü çözülemedi' },
          ek,
        );
      const k = kap.find((x) => String(x.ID) === String(b.kitap));
      if (!k || k.version == null)
        return satir(
          DURUM.OLCULEMEDI,
          {
            girdi,
            vs: bilgi.vs,
            sebep: `menüde ${b.kitap} kapağı/sürümü yok (${kap.length} kapak)`,
          },
          ek,
        );
      const olcum = { girdi, vs: bilgi.vs, paket_surumu: k.version };
      if (k.version === bilgi.vs)
        return satir(
          DURUM.GECTI,
          { ...olcum, ayrinti: `paket v${k.version} = İmpark v${bilgi.vs}` },
          ek,
        );
      if (k.version < bilgi.vs)
        return satir(
          DURUM.KALDI,
          { ...olcum, sebep: `paket v${k.version} < İmpark v${bilgi.vs} (güncel değil)` },
          ek,
        );
      return satir(
        DURUM.SARI,
        {
          ...olcum,
          sebep: `paket v${k.version} > İmpark v${bilgi.vs} (İmpark geri alınmış olabilir)`,
        },
        ek,
      );
    });
  },
};
