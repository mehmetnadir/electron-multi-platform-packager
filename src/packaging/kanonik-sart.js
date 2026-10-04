'use strict';

/**
 * KANONİK ŞARTI (2026-10-04, Nadir: "Windows paketi en güncel formatımızda mı üretiliyor?" → HAYIR).
 * Kasada `~/.empp-agent/kabuk` ve `motor` yoktu; paketleyici "kanonik YOK" diye log basıp paketi
 * ESKİ okuyucu kabuğuyla (1.11.5, kanonik 1.13.3) çıkardı; kabul bunu ancak sonradan reddetti.
 *
 * ŞART NE ZAMAN AKTİF (`sartAktifMi`):
 *   - `EMPP_KANONIK_SART=0`  → KAPALI (acil kapatma; eski "uyar, devam et" davranışı).
 *   - `EMPP_KANONIK_SART=1`  → HER ZAMAN aktif (UI dahil).
 *   - ayarsız               → yalnız ÜRETİM İŞİNDE (`jobInfo.kanonikSart === true`): runner'ın
 *     `/api/package` isteği ve Pardus betiklerinin `jobInfoKur`'u bu bayrağı koyar.
 *   Gerekçe: ajan/üretim kipinde çıktı müşteriye gider, sessiz eski format = teslim edilmemiş
 *   iş. Elle UI kullanımı (geliştirici makinesi, deneme paketi) kanonik kurulu olmayabilir;
 *   orada paket yine çıkar ama uyarı log'a düşer (davranış değişmez).
 * "Kanonik VAR ama paket zaten güncel" sorun değildir: yalnız kanonik YÜKLENEMEZSE
 * (`durum: 'bilinmiyor'`) düşer.
 */

const path = require('path');

class KanonikYokHatasi extends Error {
  constructor(mesaj) {
    super(mesaj);
    this.name = 'KanonikYokHatasi';
  }
}

function sartAktifMi(jobInfo, env = process.env) {
  const v = env && env.EMPP_KANONIK_SART;
  if (v === '0') return false;
  if (v === '1') return true;
  return !!(jobInfo && jobInfo.kanonikSart === true);
}

/**
 * Kanonik yüklenemediyse (damga.durum === 'bilinmiyor') ve şart aktifse fırlatır.
 * @param {'kabuk'|'motor'} ad
 * @param {{durum?:string}|null} damga
 */
function sartiUygula(ad, damga, jobInfo, env = process.env) {
  if (!damga || damga.durum !== 'bilinmiyor') return;
  if (!sartAktifMi(jobInfo, env)) return;
  const etiket = ad === 'kabuk' ? 'okuyucu kabuğu' : 'motor';
  throw new KanonikYokHatasi(
    `${etiket} kanoniği yok (~/.empp-agent/${ad}) — eski formatla paket üretilmez`);
}

/**
 * kanonik.json içindeki `dizin` değerini TAŞINABİLİR çözer: göreliyse kanonik.json'un dizinine
 * göre; mutlaksa var olana bakılır, yoksa AYNI ADLI yerel alt dizine (`<jsonDizini>/<ad>`) düşülür.
 * @returns {Promise<string>} çözülen yol (hiçbiri yoksa ilk aday — çağıran okuyunca null döner)
 */
async function dizinCoz(kanonikJsonYolu, kayitliDizin, varMi) {
  const kok = path.dirname(path.resolve(kanonikJsonYolu));
  const adaylar = path.isAbsolute(kayitliDizin)
    ? [kayitliDizin, path.join(kok, path.basename(kayitliDizin))]
    : [path.resolve(kok, kayitliDizin)];
  for (const a of adaylar) if (await varMi(a)) return a;
  return adaylar[adaylar.length - 1];
}

module.exports = { KanonikYokHatasi, sartAktifMi, sartiUygula, dizinCoz };
