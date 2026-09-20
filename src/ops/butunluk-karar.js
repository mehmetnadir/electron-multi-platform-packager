'use strict';
/**
 * R2 BÜTÜNLÜK KARARI — saf fonksiyon, ağ yok, saat yok.
 *
 * Neden var (2026-09-19, ölçülmüş vaka): 59834 (Shall We?! 5 Set - Maarif Model)
 * satırı `status: completed`, `lastResult: uploaded`, `lastRunAt 13:59:17Z` diyordu;
 * R2'deki nesnenin `last-modified` değeri ise 10:56:53Z idi — defter "yükledim"
 * derken nesne ÜÇ SAAT eskiydi ve Nadir eski yapıyı indirdi. `integrity_status`
 * kolonu zaten vardı ama üretimde ona yalnız 'unknown' yazılıyordu; 'healthy'
 * yazan hiçbir kod ve saatlik koşu YOKTU.
 *
 * Durumlar:
 *   tamam     — nesne var, boyutu makul, koşu damgasından yeni
 *   uretimde  — o an bir koşu sürüyor; nesnenin eski olması normaldir, ALARM YOK
 *   bayat     — koşu bitmiş görünüyor ama nesne o koşudan ESKİ (bugünkü hata)
 *   eksik     — nesne yok (404/403)
 *   bos       — nesne var ama içerik yok
 *   degisti   — koşu değişmediği hâlde parmak izi (etag) değişti: sessiz değişim
 *   olculemedi— HEAD başarısız (ağ/CDN); alarm değil, bir sonraki turda tekrar
 */

/** Koşu hâlâ sürüyor mu? Süren koşuda eski nesne beklenen durumdur. */
function kosuSuruyor(satir) {
  const durum = String(satir.status || '');
  if (durum === 'running' || durum === 'queued' || durum === 'leased') return true;
  // 'completed' göründüğü hâlde yeni bir koşu başlamış olabilir: ilerleme %100'ün
  // altındaysa ve faz bitiş fazı değilse satır bir koşunun ORTASINDADIR.
  const ilerleme = Number(satir.progress);
  const faz = String(satir.currentPhase || '');
  const araFaz = faz === 'downloading' || faz === 'building' || faz === 'uploading' || faz === 'packaging';
  if (araFaz && Number.isFinite(ilerleme) && ilerleme < 100) return true;
  return false;
}

/**
 * @param {object} p
 * @param {object} p.satir   jobs/summary platform satırı
 * @param {object|null} p.head { status, contentLength, etag, lastModified }  (lastModified: ms)
 * @param {object|null} p.onceki  bir önceki turun kaydı { etag, lastRunAt }
 * @param {number} p.toleransMs  nesne damgası ile koşu damgası arasında hoş görülen fark
 * @returns {{durum:string, sebep:string}}
 */
function butunlukKarari({ satir, head, onceki = null, toleransMs = 15 * 60 * 1000 } = {}) {
  if (!satir || !satir.r2ObjectKey) return { durum: 'atlandi', sebep: 'r2 anahtari yok' };
  if (String(satir.status) !== 'completed') {
    return { durum: 'atlandi', sebep: `durum=${satir.status}` };
  }
  if (!head) return { durum: 'olculemedi', sebep: 'HEAD yapilamadi' };
  if (head.status === 404 || head.status === 403) {
    return { durum: 'eksik', sebep: `HTTP ${head.status}` };
  }
  if (head.status !== 200) return { durum: 'olculemedi', sebep: `HTTP ${head.status}` };
  if (!(Number(head.contentLength) > 0)) return { durum: 'bos', sebep: 'content-length 0' };

  const kosu = Date.parse(satir.lastRunAt || '');
  const nesne = Number(head.lastModified);

  if (onceki && onceki.etag && head.etag && onceki.etag !== head.etag
      && onceki.lastRunAt && satir.lastRunAt && onceki.lastRunAt === satir.lastRunAt) {
    return { durum: 'degisti', sebep: 'kosu ayni ama etag degisti' };
  }

  if (kosuSuruyor(satir)) {
    return { durum: 'uretimde', sebep: `faz=${satir.currentPhase || '?'} ilerleme=${satir.progress ?? '?'}` };
  }

  if (Number.isFinite(kosu) && Number.isFinite(nesne) && nesne < kosu - toleransMs) {
    const farkDk = Math.round((kosu - nesne) / 60000);
    return { durum: 'bayat', sebep: `nesne kosudan ${farkDk} dk eski` };
  }

  return { durum: 'tamam', sebep: `${head.contentLength} bayt` };
}

/** Alarm üretilecek durumlar — 'uretimde' ve 'olculemedi' alarm DEĞİLDİR. */
const ALARMLI = new Set(['bayat', 'eksik', 'bos', 'degisti']);

module.exports = { butunlukKarari, kosuSuruyor, ALARMLI };
