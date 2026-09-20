'use strict';

/**
 * AÇILIŞ ÇAKMASI YAMASI — `show:false` + `ready-to-show` + emniyet zamanlayıcısı.
 *
 * NEDEN (2026-09-18, ölçüldü): üretilen kitap şablonunda pencere doğrudan
 * `fullscreen:true` ile açılıyor; `show:false`/`ready-to-show` yok. Eski makinede
 * (HDD, 2. nesil i5) boş/beyaz pencere saniyelerce duruyor, öğretmen "açılmadı"
 * sanıp ikinci kez tıklıyor. Paketleyicinin KENDİ arayüzü bunu doğru yapıyor
 * (src/main.js), ürettiği kitap yapmıyordu.
 *
 * GÜVENLİK: `show:false` TEK BAŞINA katastrofiktir — `ready-to-show` hiç gelmezse
 * pencere HİÇ görünmez (K18 kabul kapısı sınıfı arıza). Bu yüzden üç parça ATOMİK
 * uygulanır ya da hiçbiri uygulanmaz.
 */

const ISARET = 'EMPP_READY_TO_SHOW';
// 1) Bildirimle birlikte:  const/let/var win = new BrowserWindow({
const PENCERE_REGEX = /(?:const|let|var)\s+(\w+)\s*=\s*new BrowserWindow\(\{/;
// 2) K19 (2026-09-19, sm4 saha kanıtı): yayıncı kabuğu değişkeni ÖNCE bildirip
//    SONRA atıyor (`let mainWindow;` … `mainWindow = new BrowserWindow({`).
//    Tek kalıpla arayınca yama "pencere-degiskeni-yok" deyip SESSİZCE atlanıyordu.
//    Lookbehind `.`/kelime karakterini eler → `obj.win = new BrowserWindow({` gibi
//    üye atamaları YAKALANMAZ (enjekte edeceğimiz `win.once(...)` yanlış olurdu).
const PENCERE_ATAMA_REGEX = /(?<![.\w$])(\w+)\s*=\s*new BrowserWindow\(\{/;
const EMNIYET_MS = 8000;

/**
 * @param {string} icerik main.js kaynağı
 * @returns {{icerik: string, uygulandi: boolean, sebep: string, pencere: string|null}}
 */
function readyToShowEkle(icerik) {
  const giris = String(icerik == null ? '' : icerik);
  const yok = (sebep) => ({ icerik: giris, uygulandi: false, sebep, pencere: null });

  if (giris.includes(ISARET)) return yok('zaten-var');

  // Önce bildirimli kalıp; yoksa "önce bildir, sonra ata" kalıbı. Seçilen kalıp
  // hem tespitte hem değiştirmede AYNI olmalı.
  let kalip = PENCERE_REGEX;
  let pm = giris.match(kalip);
  if (!pm) {
    pm = giris.match(PENCERE_ATAMA_REGEX);
    // Atama kalıbında değişkenin GERÇEKTEN bildirilmiş olmasını şart koş —
    // aksi halde global sızıntısına yama yazmış oluruz.
    if (pm && new RegExp(`(?:const|let|var)\\s+${pm[1]}\\b`).test(giris)) {
      kalip = PENCERE_ATAMA_REGEX;
    } else {
      pm = null;
    }
  }
  if (!pm) return yok('pencere-degiskeni-yok');
  const ad = pm[1];

  // `show:` zaten varsa yayıncının kararına DOKUNMA.
  if (/\bshow\s*:/.test(giris)) return yok('show-zaten-tanimli');

  const yukleRegex = new RegExp(`\\b${ad}\\.(?:loadFile|loadURL)\\s*\\(`);
  if (!yukleRegex.test(giris)) return yok('yukleme-cagrisi-yok');

  // NOT: satır sonu `//` yorumu KULLANILMAZ — yayıncı kodu BrowserWindow'u tek satırda
  // yazdığında (`new BrowserWindow({ width: 1200, fullscreen: true });`) yorum satırın
  // kalanını yutar ve süslü parantezler dengesiz kalır. Blok yorum her iki yazımda güvenli.
  let m = giris.replace(kalip, (tam) => `${tam} /* ${ISARET} */ show: false,`);

  const enjekte =
    `  // ${ISARET}: ilk kare hazır olunca göster (beyaz ekran çakmasını önler)\n` +
    `  ${ad}.once('ready-to-show', () => { try { ${ad}.show(); } catch (e) {} });\n` +
    `  // Emniyet: ready-to-show hiç gelmezse pencere yine de açılsın\n` +
    `  setTimeout(() => {\n` +
    `    try { if (!${ad}.isDestroyed() && !${ad}.isVisible()) ${ad}.show(); } catch (e) {}\n` +
    `  }, ${EMNIYET_MS});\n`;

  m = m.replace(yukleRegex, (tam) => `${enjekte}  ${tam}`);

  return { icerik: m, uygulandi: true, sebep: 'uygulandi', pencere: ad };
}

module.exports = { readyToShowEkle, ISARET, EMNIYET_MS, PENCERE_REGEX, PENCERE_ATAMA_REGEX };
