'use strict';

/**
 * YAMA KATMANI — üretilen uygulamanın ANA SÜRECİNE dosya-protokolü (file://) kancası.
 *
 * NEDEN (2026-09-21, ölçüldü): Kullanıcı kurulu uygulamada birkaç KB'lik `index.html`
 * güncellemesinin paketi yeniden dağıtmadan gelmesini istiyor. `src/platforms/common/
 * fs-shim.js` (`installFetch`) BUNU `fetch()` için zaten yapıyor — göreli/paket-içi bir
 * URL için önce WORK'e (userData altı) bakıyor. Ama HTML NAVİGASYONU (ilk sayfa yükü,
 * `mainWindow.loadFile(...)`, iframe/alt-sayfa geçişleri) `fetch`'ten geçmez, doğrudan
 * `file://` üzerinden okunur — ve bu depoda `interceptFileProtocol`/`protocol.handle`/
 * `registerFileProtocol` kancası HİÇ YOK (grep: 0 sonuç, 2026-09-21). Bu modül o boşluğu
 * doldurur: main process'te `file` şemasını `protocol.handle` ile sarar, istenen dosya
 * `userData/<YAMA_DIZIN>/<göreli yol>` altında varsa ONU servis eder, yoksa normal
 * pakete düşer.
 *
 * ELECTRON PROTOKOL SEÇİMİ (yorumla sabitlendi, kod aynısını üretilen main.js'e de yazar):
 *   • `registerFileProtocol`/`interceptFileProtocol` Electron 25'te kullanımdan kaldırıldı,
 *     sonraki sürümlerde SİLİNDİ. Resmî karşılığı Request/Response tabanlı `protocol.handle`
 *     (hem yeni şema tanımlamak hem de `file` gibi YERLEŞİK şemayı override etmek için).
 *   • `file` Chromium'da zaten "standard + secure + privileged" YERLEŞİK şema olduğundan
 *     `protocol.registerSchemesAsPrivileged` GEREKMEZ — o yalnız YENİ custom şemalar
 *     (`app://` gibi) için gerekir. Tuzak tam olarak ORADA yaşar: custom şemada
 *     `supportFetchAPI`/`corsEnabled` unutulursa `<img>` (no-cors, gömülü kaynak) yine
 *     yüklenir ama `fetch()` CORS/origin kısıtından DÜŞER — "img geliyor, fetch düşüyor"
 *     yanlış-pozitifi budur. `file`ı override ettiğimiz için bu tuzağın DIŞINDAYIZ.
 *   • Handler içinde gerçek dosyayı servis ederken `net.fetch(url, { bypassCustomProtocolHandlers:
 *     true })` kullanılır — aksi halde `net.fetch('file://...')` KENDİ handler'ımıza yeniden
 *     girip SONSUZ DÖNGÜ üretir (Electron resmî uyarısı).
 *   • `protocol.handle` yalnız `app.whenReady()` ÇÖZÜLDÜKTEN SONRA çağrılabilir — bu yüzden
 *     kanca `app.whenReady().then(...)` içine, ve TEK KURAL: kendi `.then()` bloğumuz
 *     ÇAPANIN ÖNÜNE metinsel olarak eklenir. main.js henüz 'ready' ateşlemeden yüklendiği
 *     için tüm üst-seviye `.then()`/`app.on('ready', ...)` kayıtları senkron sırayla
 *     olur; Promise/EventEmitter kuralı kayıt SIRASINI korur → bizim kancamız ÇAPANIN
 *     (createWindow/loadFile'ı tetikleyen kod) DAİMA ÖNÜNDE ateşlenir.
 *
 * GÜVENLİK (acilis-yamasi.js ile AYNI disiplin): çapa (`app.whenReady()` / `app.on('ready',
 * ...)`) bulunamazsa HİÇBİR ŞEY eklenmez — yarım/yanlış yerde enjekte edilmiş bir protokol
 * kancası, hiç kanca olmamasından DAHA KÖTÜDÜR (sessizce yanlış dosyayı servis edebilir).
 *
 * TEK KARAR NOKTASI (kardeş verb körlüğü, bu depoda bir kez yanmıştık): protokol kancası
 * ile fs-shim'in fetch yönlendirmesi AYNI dizine bakmalı, yoksa bir yol yamalı diğeri
 * yamasız kalır. Dizin adı burada TEK sabitten (`YAMA_DIZIN`) üretilir ve üretilen kodun
 * içine de AYNI sabitten basılır (drift imkânsız — string iki kez elle yazılmaz).
 * fs-shim.js BİLEREK değiştirilmedi; bağlanma önerisi görev raporunda.
 */

const path = require('path');

const ISARET = 'EMPP_YAMA_KANCASI';
// YAMA dizini — userData/<YAMA_DIZIN>/<göreli yol>. fs-shim.js'in WORK'ü (userData/work)
// FARKLI bir amaca hizmet eder (yayıncının kendi anahtar/temp yazmaları); bu, Nadir'in
// hedefli hot-patch dizinidir. İkisinin karışmaması bilinçli bir tasarım kararı — bkz.
// modül başı yorum ve görev raporundaki bağlanma önerisi.
const YAMA_DIZIN = 'yama';

// Çapa: `app.whenReady()` çağrısı ya da `app.on('ready', ...)` kaydı. İkisi de main.js
// şablonlarında görülüyor (acilis-yamasi.js'in EMPP_WORK_DIR enjeksiyonu birincisini kullanır).
const ANKOR_REGEX = /(app\.whenReady\(\)|app\.on\(\s*['"`]ready['"`]\s*,)/;

/**
 * Kapı bayrağı — VARSAYILAN KAPALI. `EMPP_YAMA=1` ile açılır.
 * Gerekçe: canlı üretimi etkilemeden, bilinçli bir wiring adımıyla devreye alınacak.
 * @param {NodeJS.ProcessEnv} [env] verilmezse process.env kullanılır
 */
function acikMi(env) {
  const e = env || process.env;
  return !!e && e.EMPP_YAMA === '1';
}

/**
 * Bir dosya yolunun YAMA_KOK altında servis edilebilecek göreli bir yol olup olmadığını
 * çözer. `../` ile paket dışına kaçış REDDEDİLİR (null döner). Bu fonksiyonun kaynağı
 * (`.toString()`) üretilen main.js koduna DA gömülür — tek mantık, tek kaynak, çift bakım
 * yükü yok; burada test edilen davranış üretilen kodda da BİREBİR çalışır.
 *
 * @param {string} kokDizin paket kökü (main.js'in __dirname'i)
 * @param {string} dosyaYolu istenen mutlak dosya yolu
 * @returns {string|null} göreli yol (posix/win ayrımı path.relative'e göre) ya da null
 */
function yamaIcinGoreliYol(kokDizin, dosyaYolu) {
  const r = path.relative(kokDizin, dosyaYolu);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
  return r;
}

/**
 * Üretilen main.js'e enjekte edilecek JS metnini üretir. Saf string üretimi — dosya
 * okuma/yazma yapmaz (o iş `enjekteEt`'in çağıranındır, bu depodaki yerleşik disiplin).
 * @returns {string}
 */
function yamaKancasiKodu() {
  return `
  // ${ISARET} (EMPP_YAMA=1 ile açılır, src/packaging/yama-katmani.js üretti)
  // Dosya-protokolü (file://) navigasyonunu kancalar: userData/${YAMA_DIZIN}/<göreli yol>
  // altında bir yama VARSA paket kopyası yerine ONU servis eder. fs-shim.js'in fetch()
  // yönlendirmesiyle AYNI karar dizinine (${YAMA_DIZIN}) bakmalı — bkz. yama-katmani.js başı.
  app.whenReady().then(() => {
    try {
      const { protocol, net } = require('electron');
      const path = require('path');
      const fs = require('fs');
      const url = require('url');
      const YAMA_KOK = path.join(app.getPath('userData'), '${YAMA_DIZIN}');
      ${yamaIcinGoreliYol.toString()}
      protocol.handle('file', (request) => {
        try {
          const dosyaYolu = url.fileURLToPath(request.url);
          const gorece = yamaIcinGoreliYol(__dirname, dosyaYolu);
          if (gorece) {
            const yamaYolu = path.join(YAMA_KOK, gorece);
            if (fs.existsSync(yamaYolu) && fs.statSync(yamaYolu).isFile()) {
              return net.fetch(url.pathToFileURL(yamaYolu).toString(), { bypassCustomProtocolHandlers: true });
            }
          }
        } catch (e) { /* düş: normal dosyayı servis et */ }
        // Normal yola düş — kendi handler'ımıza yeniden GİRMESİN diye bypass şart
        // (aksi halde net.fetch('file://...') sonsuz döngü üretir).
        return net.fetch(request.url, { bypassCustomProtocolHandlers: true });
      });
    } catch (e) {
      try { console.warn('[empp-yama] protokol kancası kurulamadı:', e && e.message); } catch (_e2) {}
    }
  });
`;
}

/**
 * Yama kancasını main.js kaynağına ATOMİK olarak enjekte eder.
 *
 * @param {string} mainJsIcerigi
 * @returns {{icerik: string, degisti: boolean, sebep: string}}
 *   sebep: 'zaten-var' | 'capa-yok' | 'uygulandi'
 */
function enjekteEt(mainJsIcerigi) {
  const giris = String(mainJsIcerigi == null ? '' : mainJsIcerigi);
  const yok = (sebep) => ({ icerik: giris, degisti: false, sebep });

  if (giris.includes(ISARET)) return yok('zaten-var');

  if (!ANKOR_REGEX.test(giris)) return yok('capa-yok');

  const blok = yamaKancasiKodu();
  // Fonksiyon-replacer KULLANILIR (string replacer DEĞİL): blok içinde `$` geçebilir,
  // string replacer `$1`/`$&` gibi diziler için ÖZEL anlam verir (acilis-yamasi.js'teki
  // aynı disiplin).
  const icerik = giris.replace(ANKOR_REGEX, (tam) => `${blok}\n  ${tam}`);

  return { icerik, degisti: true, sebep: 'uygulandi' };
}

module.exports = {
  acikMi,
  yamaKancasiKodu,
  enjekteEt,
  yamaIcinGoreliYol,
  YAMA_DIZIN,
  ISARET,
  ANKOR_REGEX,
};
