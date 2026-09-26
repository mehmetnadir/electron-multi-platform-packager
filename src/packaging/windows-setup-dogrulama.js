'use strict';

/**
 * WINDOWS SETUP.EXE TESLİM DOĞRULAMASI (Windows sözleşmesi, "Üretimi etkilemeyen
 * açık işler" madde 2 — 2026-09-26).
 *
 * BELİRTİ (Nadir): makensis/electron-builder BAŞARISIZ olduğunda, çıktı
 * dizininde ÖNCEKİ bir derlemeden kalma bir `*-Setup.exe` duruyorsa
 * `packageWindows()` işi "başarılı" sayıp bu ESKİ dosyayı teslim ediyordu.
 *
 * KÖK NEDEN — iki katman:
 *   1) `runElectronBuilder()` yalnız Windows'ta, sıfır-dışı çıkışta "çıktı
 *      dizininde HERHANGİ bir *Setup.exe var mı?" diye bakıp varsa başarı
 *      sayıyordu (updateInfoBuilder'ın zararsız bir hatasını tolere etmek
 *      için yazılmıştı) — ama bu kontrol dosyanın BU derlemede üretildiğini
 *      hiç doğrulamıyordu.
 *   2) Başarı (exit 0) durumunda da bulunan installer'ın GERÇEKTEN bu
 *      derlemede üretildiği (taze mtime, beklenen ad) hiç doğrulanmıyordu.
 *
 * ÇÖZÜM:
 *   (a) `runElectronBuilder` artık Windows için de sıfır-dışı çıkışta
 *       KOŞULSUZ reddeder (bkz. packagingService.js `runElectronBuilder`,
 *       win-özel "eski Setup.exe varsa kabul et" dalı KALDIRILDI).
 *   (b) Derleme BAŞLAMADAN önce `eskiCiktiyiKenaraAl()` çıktı dizininde
 *       duran her `.exe`'yi (varsa) SİLMEDEN `.eski-<ts>` sonekiyle kenara
 *       alır — böylece "dosya var mı" araması artık yalnız BU derlemenin
 *       ürettiği dosyayı görebilir.
 *   (c) Derleme bittiğinde bulunan installer `dogrula()` ile mtime'ı bu
 *       derlemenin başlangıcından yeni mi VE adı beklenen
 *       `${appName}-${appVersion}-Setup.exe` (electron-builder'ın kendi
 *       `artifactName` şablonuyla BİREBİR, bkz. packagingService.js
 *       `packageWindows` → `nsis.artifactName`) mi diye kontrol eder.
 *       Tutmazsa anlaşılır Türkçe hata fırlatılır, eski dosya SİLİNMEZ.
 *
 * NOT (sürüm deseni): sözleşme madde 1 üretim sürümünü `2.<panel kodu>.
 * <paket sayacı>` olarak tanımlar, ama `surum-turet.js` açık sürüm
 * verilmediğinde `1.<hash>.<hash>` türetir (bkz. o dosyanın başlığı) — o
 * yüzden burada sabit bir `^2\.` deseni ZORLANMAZ; doğrulama yalnız dosya
 * adının BU derlemeye verilen `appVersion` ile BİREBİR eşleştiğini ister.
 * Sürüm biçiminin kendisi `surum-turet.js`'in sorumluluğu ve testleri onda.
 */

const fs = require('fs-extra');
const path = require('path');

// Dosya sistemi/kopyalama akışlarında mtime bazen 1-2 sn yuvarlanabilir —
// gerçek bir ESKİ dosyayla karışmasın diye küçük bir tolerans.
const MTIME_TOLERANS_MS = 2000;

/** electron-builder `nsis.artifactName` şablonuyla (packagingService.js
 * `packageWindows`: `${productName}-${version}-Setup.${ext}`, productName=appName,
 * version=appVersion, ext=exe) BİREBİR aynı üretim — iki taraf ayrışırsa bu
 * fonksiyonu güncelle, kopya sabit yazma. */
function beklenenDosyaAdi(appName, appVersion) {
  return `${appName}-${appVersion}-Setup.exe`;
}

/**
 * Derleme BAŞLAMADAN ÖNCE çağrılır. `outputPath` içinde duran her `.exe`'yi
 * (önceki iş/deneme kalıntısı olabilir) SİLMEDEN `.eski-<ts>` sonekiyle
 * kenara alır. Dizin yoksa ya da içinde `.exe` yoksa no-op, boş dizi döner.
 * @returns {Promise<Array<{dosya:string, hedef:string}>>}
 */
async function eskiCiktiyiKenaraAl(outputPath) {
  if (!(await fs.pathExists(outputPath))) return [];
  const girdiler = await fs.readdir(outputPath);
  const tasinanlar = [];
  for (const dosya of girdiler) {
    if (!dosya.toLowerCase().endsWith('.exe')) continue;
    const kaynak = path.join(outputPath, dosya);
    const hedef = path.join(outputPath, `${dosya}.eski-${Date.now()}`);
    try {
      await fs.move(kaynak, hedef);
      tasinanlar.push({ dosya, hedef });
      console.log(`📦 Önceki derlemeden kalma Windows installer kenara alındı: ${dosya} -> ${path.basename(hedef)}`);
    } catch (e) {
      console.warn(`⚠️ Önceki Windows installer kenara alınamadı (${dosya}): ${e.message}`);
    }
  }
  return tasinanlar;
}

/**
 * Bulunan installer'ın GERÇEKTEN bu derlemede üretildiğini doğrular.
 * @param {string} installerPath - bulunan `.exe`'nin TAM yolu
 * @param {string} appName
 * @param {string} appVersion
 * @param {number} derlemeBaslangici - `Date.now()` (ms), electron-builder
 *   çağrılmadan HEMEN önce alınmış olmalı
 * @returns {Promise<{tamam:true}|{tamam:false, hata:string}>}
 */
async function dogrula(installerPath, appName, appVersion, derlemeBaslangici) {
  let stat;
  try {
    stat = await fs.stat(installerPath);
  } catch (e) {
    return {
      tamam: false,
      hata: `Windows installer dosyasına erişilemedi: "${installerPath}" (${e.message}).`,
    };
  }

  const dosyaAdi = path.basename(installerPath);
  const beklenen = beklenenDosyaAdi(appName, appVersion);
  if (dosyaAdi !== beklenen) {
    return {
      tamam: false,
      hata: `Windows installer adı beklenen sürümü taşımıyor: "${dosyaAdi}" (beklenen "${beklenen}"). ` +
        'Muhtemelen önceki bir derlemeden kalma farklı adlı bir dosya teslim edilmek üzereydi.',
    };
  }

  if (stat.mtimeMs < derlemeBaslangici - MTIME_TOLERANS_MS) {
    const yasSaniye = Math.round((derlemeBaslangici - stat.mtimeMs) / 1000);
    return {
      tamam: false,
      hata: `Windows installer bu derlemeden ÖNCE üretilmiş görünüyor ("${dosyaAdi}", bu derlemenin ` +
        `başlangıcından ~${yasSaniye} sn eski). makensis/electron-builder bu derlemede yeni bir ` +
        `Setup.exe üretmemiş olabilir — eski dosya silinmedi, "${installerPath}" elle kontrol edilmeli.`,
    };
  }

  return { tamam: true };
}

module.exports = { beklenenDosyaAdi, eskiCiktiyiKenaraAl, dogrula, MTIME_TOLERANS_MS };
