'use strict';

/**
 * WINDOWS PAKETİNDE asar KAPALI — kapı modülü (saf, I/O YOK)
 *
 * NEDEN (2026-09-21, ölçümle — yalnız Windows):
 *  1) SET GÜNCELLEME KANALI DİSKE YAZIYOR. `app.asar` bir DOSYA'dır; içine bir
 *     yol açmaya çalışan her yazma `ENOTDIR` ile düşer. Kanal bugünkü düzende
 *     çalışamaz.
 *  2) `asarUnpack` YETMEZ. asar başlığı bir İNDEKS'tir: paketleme anında var olmayan
 *     bir dizin sonradan görünmez → kanaldan KİTAP EKLEME imkânsızdır. Nadir kanaldan
 *     açıkça kitap ekleme/çıkarma istedi.
 *  3) İçeriği `resources/icerik/` altına almak (B2) daha riskli: `findSubBookDirs`
 *     kökte `app.config.js` bulamayınca bir seviye iniyor, anahtarlar sessizce
 *     `icerik/book1` oluyor — HATA VERMEDEN manifest parmak izleri ve menü önekleri
 *     kayıyor. Ayrıca paket kapısı `resources/icerik` yolunu bilmiyor → sahte-yeşil.
 *  4) Maliyet ölçüldü: paket +24,4 MiB (+%1,98), kurulum +%44 (macOS ölçümü; Windows'ta
 *     Defender taraması bunu zaten taban yapıyor). Açılışta asar'ın ÖLÇÜLMÜŞ faydası YOK
 *     — içerik `require` edilmiyor, `file://` ile yükleniyor; asar başlığı ayrıştırma
 *     ~17-25 ms CEZA ekliyor.
 *
 * NEDEN YALNIZ WINDOWS: macOS'ta `codesign` .app içindeki HER dosyayı `CodeResources`'a
 * mühürler — 10 bin dosyalık açık ağaç imzalaması saatler sürer. Windows'ta kurulum
 * exe'si TEK PARÇA imzalandığı için aynı ceza yoktur. mac/DMG ve Linux hatları bu
 * kapının DIŞINDADIR (bkz. `src/platforms/common/fs-shim.test.js` sentinel testi).
 *
 * KAPI: varsayılan AÇIK (yani Windows'ta asar KAPALI). `EMPP_WINDOWS_ASARSIZ=0` ile
 * geri alınır — paket düzeni değişikliğinin geri dönüş yolu ortam değişkenidir,
 * yeni bir derleme değil. Yalnız tam olarak "0" kapatır; tanımsız/boş/başka değer
 * AÇIK sayılır (`guncelleyici-enjekte.js` ile BİREBİR aynı biçim).
 *
 * KİMLİK: bu kapı ÜRETİM DAVRANIŞINI (paket düzenini) değiştirir; bu yüzden
 * `src/server/saglik-kimligi.js` `kapilariOku()` listesinde YER ALIR — kapatılmış
 * kaçak bir süreç sağlık ucunda temiz kopyadan ayırt edilebilsin diye.
 */

const ISARET = 'EMPP_WINDOWS_ASARSIZ';

/**
 * Kapı açık mı? (açık = Windows paketinde asar KAPALI)
 * @param {NodeJS.ProcessEnv|Object} [env]
 * @returns {boolean}
 */
function acikMi(env = process.env) {
  const e = (env && typeof env === 'object') ? env : {};
  return String(e[ISARET] == null ? '' : e[ISARET]) !== '0';
}

/**
 * electron-builder `asar` seçeneğinin DEĞERİ. Kapı açıkken `false` (düz dosya ağacı),
 * kapalıyken `true` (electron-builder varsayılanıyla birebir aynı çıktı — geri dönüş).
 * @param {NodeJS.ProcessEnv|Object} [env]
 * @returns {boolean}
 */
function asarSecenegi(env = process.env) {
  return acikMi(env) ? false : true;
}

module.exports = { ISARET, acikMi, asarSecenegi };
