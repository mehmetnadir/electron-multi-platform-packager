'use strict';
/**
 * İMPARK İÇERİK KANALI (K) — salt okuma. Motorun kendi sorduğu uç (bkz. tools/pardus/cdp-kitap-ac.js
 * E7, src/agent/icerik-merdiven.js S0): `GetKitapGuncellemeBilgi?id=<ID>&setMi=0&versiyon=0`
 * kitabın İmpark'taki güncel içerik sürümünü (`Vs`) ve arşivini (`Data` = ZKitapZipH/<ID>-<Vs>.zip)
 * döner. Arşivin `Last-Modified` başlığı içeriğin İmpark'ta değiştiği an sayılır (T5 kıyas zamanı).
 * Yalnız GET/HEAD; hiçbir şey yazmaz. `istek` enjekte edilebilir (testler ağ kullanmaz).
 */
const { istek: varsayilanIstek } = require('./okuyucu');

const IMPARK_UC =
  process.env.EMPP_E2E_IMPARK_UC || 'https://www.sorucoz.tv/TestlerMobil/GetKitapGuncellemeBilgi';

/**
 * @returns {Promise<{durum:'tamam', vs:number, data:string, boyut:number|null,
 *   sonDegisiklik:number|null, uc:string} | {durum:'hata', sebep:string, uc:string}>}
 */
async function guncellemeBilgisi(kitap, { istek = varsayilanIstek, uc = IMPARK_UC } = {}) {
  const adres = `${uc}?id=${encodeURIComponent(kitap)}&setMi=0&versiyon=0`;
  let r;
  try {
    r = await istek(adres, { zamanAsimiMs: 30000, azami: 64 * 1024 });
  } catch (e) {
    return { durum: 'hata', sebep: `İmpark ucu erişilemedi: ${e.message}`, uc: adres };
  }
  if (r.status !== 200) return { durum: 'hata', sebep: `İmpark ucu HTTP ${r.status}`, uc: adres };
  let j;
  try {
    j = JSON.parse(Buffer.from(r.govde).toString('utf8'));
  } catch (_) {
    return { durum: 'hata', sebep: 'İmpark cevabı JSON değil', uc: adres };
  }
  if (!j || j.Success === false)
    return { durum: 'hata', sebep: `İmpark Success=false: ${j && j.Message}`, uc: adres };
  const data = j.Data ? String(j.Data).trim() : '';
  const vs = Number(j.Vs);
  if (!data || !Number.isFinite(vs))
    return {
      durum: 'hata',
      sebep: `İmpark'ta ${kitap} için içerik arşivi yok (Data boş, Vs=${j.Vs})`,
      uc: adres,
    };
  let boyut = null;
  let sonDegisiklik = null;
  try {
    const h = await istek(data, { method: 'HEAD', zamanAsimiMs: 30000 });
    if (h.status !== 200)
      return { durum: 'hata', sebep: `içerik arşivi HTTP ${h.status}: ${data}`, uc: adres };
    boyut = h.headers['content-length'] != null ? Number(h.headers['content-length']) : null;
    const lm = Date.parse(h.headers['last-modified'] || '');
    sonDegisiklik = Number.isFinite(lm) ? lm : null;
  } catch (e) {
    return { durum: 'hata', sebep: `içerik arşivi HEAD: ${e.message}`, uc: adres };
  }
  return { durum: 'tamam', vs, data, boyut, sonDegisiklik, uc: adres };
}

/** Bir koşuda bir kez sorulur (T4 k-icerik + T5 adımları aynı cevabı kullanır). */
function onbellekli(baglam) {
  const p = baglam.paylasim || (baglam.paylasim = {});
  if (!p.imparkBilgisi) {
    p.imparkBilgisi = guncellemeBilgisi(baglam.kitap, { istek: baglam.istek || undefined });
  }
  return p.imparkBilgisi;
}

module.exports = { IMPARK_UC, guncellemeBilgisi, onbellekli };
