'use strict';

/**
 * SET GÜNCELLEYİCİ ENJEKSİYONU — paketleme anında ana sürece çağrı eker.
 *
 * Sözleşme: `.claude/docs/kitap-guncelleme-sozlesmesi.md`
 * Çalışma anı modülü: `src/runtime/kitap-guncelleyici.js` (pakete kopyalanır).
 *
 * DİSİPLİN (acilis-yamasi.js / sayfa-on-getirme.js ile AYNI):
 *   • ATOMİK — çapa (`app.whenReady()`) yoksa HİÇ yama konmaz ve modül de
 *     kopyalanmaz. Yarım yama = açılışta `require` patlaması riski.
 *   • İDEMPOTENT — işaret varsa dosyaya dokunulmaz; iki kez koşmak çift
 *     enjeksiyon üretmez (paketleyici `electron.js`'i sonradan `main.js` olarak
 *     kopyalıyor; ikinci turda işaret zaten kopyada durur).
 *   • AÇILIŞI BLOKLAMAZ — çağrı `app.whenReady()` zincirinin SONUNA eklenir
 *     (pencereyi açan `.then` bizden önce kayıtlıdır, sırayla koşar) ve üstüne
 *     `setTimeout` ile ötelenir. Ateşle-unut; `catch` ile yutulur.
 *
 * ÖRTÜ (mac + Pardus, 2026-09-26): blok ayrıca main.js YÜKLENİRKEN (senkron) modülün
 * `ortuSunucusunuKur`'unu çağırır — imzalı `.app` / `app.asar` gövdesi salt-okunur olduğu için
 * güncel dosyalar yazılabilir bir örtüden `file:` kancasıyla sunulur ve kanca pencere
 * yüklenmeden (`ready` anında) kurulmalıdır. Windows'ta (yerinde kip) ve örtü yokken bu çağrı
 * hiçbir şey yapmaz; güncelleme akışı yine ötelenmiş ateşle-unut koşar.
 *
 * NEDEN sona ekleniyor: `createWindow()` çağrısının kendisini yeniden yazmak
 * (acilis-guncelleme-oteleme.js'in yaptığı) burada gereksiz risk. Dosyanın
 * sonuna eklenen bağımsız blok yayıncı kodunun hiçbir ifadesine dokunmaz.
 */

const path = require('path');
const fs = require('fs-extra');
const { kapiAcikMi } = require('./platform-kapisi');

const ISARET = 'EMPP_SET_GUNCELLEME';
/** Çalışma anı modülünün pakete kopyalanacağı ad (girişin yanına). */
const MODUL_ADI = 'empp-set-guncelleyici.js';
/** Kaynak modül — bu depodaki tek doğru kopya. */
const KAYNAK_MODUL = path.join(__dirname, '..', 'runtime', 'kitap-guncelleyici.js');
/** Paketleyicinin giriş dosyası adları (acilis-guncelleme-oteleme ile aynı). */
const GIRIS_ADLARI = ['electron.js', 'main.js'];
/** Pencere açıldıktan SONRA beklenecek süre (ön-getirme 4 sn'de başlar). */
const VARSAYILAN_GECIKME_MS = 6000;

/** Çapa: dosya gerçekten bir Electron ana süreci mi? */
const CAPA_RE = /\bapp\s*\.\s*whenReady\s*\(\s*\)/;

/**
 * Kapı: varsayılan AÇIK; `0` kapatır, `1` her platformda açar. Platform listesi
 * (`windows`, `windows,macos`) yalnız işin platformlarının HEPSİ listedeyse açar —
 * `./platform-kapisi.js` (2026-09-26, Windows sözleşmesi yalnız Windows'u onayladı).
 * @param {Object} [env]
 * @param {string[]} [platforms] işin platformları (`jobInfo.platforms`)
 * @param {{uyar?: function(string): void}} [secenek]
 */
function acikMi(env = process.env, platforms, secenek) {
  return kapiAcikMi(ISARET, env, platforms, true, secenek);
}

/**
 * Enjekte edilecek blok. Saf fonksiyon.
 * Tamamı try/catch içinde: modül yoksa, electron yüklenmezse, güncelleyici
 * patlarsa bile uygulama normal açılır.
 */
function blokUret(gecikmeMs = VARSAYILAN_GECIKME_MS) {
  const gecikme = Number.isFinite(gecikmeMs) && gecikmeMs >= 0
    ? Math.floor(gecikmeMs) : VARSAYILAN_GECIKME_MS;
  return `
/* ${ISARET}: set güncelleyici — pencere açıldıktan SONRA, ötelenmiş, ateşle-unut */
try {
  (function () {
    var __emppElectron = require('electron');
    var __emppApp = __emppElectron.app;
    if (!__emppApp || typeof __emppApp.whenReady !== 'function') return;
    /* Örtü (mac + Pardus): imzası doğrulanmış güncel dosyalar paketin önünde sunulur;
       kurulum ready anında, pencere yüklenmeden. Windows'ta ve örtü yokken hiçbir şey yapmaz. */
    try { require('./${MODUL_ADI}').ortuSunucusunuKur({ electron: __emppElectron, kok: __dirname }); } catch (e) {}
    __emppApp.whenReady().then(function () {
      setTimeout(function () {
        try {
          var __emppGunc = require('./${MODUL_ADI}');
          Promise.resolve(__emppGunc.guncellemeyiBaslat({ kok: __dirname, electron: __emppElectron }))
            .catch(function () {});
        } catch (e) {}
      }, ${gecikme});
    }).catch(function () {});
  })();
} catch (e) {}
`;
}

/**
 * Saf dönüşüm — dosya sistemine dokunmaz.
 * @returns {{icerik:string, uygulandi:boolean, sebep:string}}
 */
function icerigeEnjekteEt(icerik, { gecikmeMs } = {}) {
  const giris = String(icerik == null ? '' : icerik);
  if (giris.includes(ISARET)) {
    return { icerik: giris, uygulandi: false, sebep: 'zaten-yamali' };
  }
  if (!CAPA_RE.test(giris)) {
    // ÇAPA YOK → HİÇ yama konmaz (atomik).
    return { icerik: giris, uygulandi: false, sebep: 'capa-yok' };
  }
  const ek = blokUret(gecikmeMs);
  const ayirici = giris.endsWith('\n') ? '' : '\n';
  return { icerik: giris + ayirici + ek, uygulandi: true, sebep: 'enjekte-edildi' };
}

/** Bir dizinde yamalanabilir giriş dosyalarını listeler. */
function girisAdaylari(paketKoku) {
  return GIRIS_ADLARI.map((ad) => path.join(paketKoku, ad));
}

/**
 * Pakete uygular.
 *  1) Giriş dosyasını yamalar (çapa varsa).
 *  2) YAMA TUTTUYSA çalışma anı modülünü girişin yanına kopyalar.
 * Sıra bilinçli: yama tutmadıysa pakete yetim modül bırakılmaz.
 *
 * @returns {Promise<Array<{dosya:string, uygulandi:boolean, sebep:string, modul:boolean}>>}
 */
async function paketeUygula(paketKoku, { log = () => {}, gecikmeMs, kaynakModul } = {}) {
  const sonuc = [];
  const kaynak = kaynakModul || KAYNAK_MODUL;

  const adaylar = girisAdaylari(paketKoku);
  for (const ad of await fs.readdir(paketKoku)) {
    const tam = path.join(paketKoku, ad);
    let d;
    try { d = await fs.stat(tam); } catch (e) { continue; }
    if (!d.isDirectory()) continue;
    for (const g of girisAdaylari(tam)) adaylar.push(g);
  }

  for (const dosya of adaylar) {
    if (!(await fs.pathExists(dosya))) continue;
    const mevcut = await fs.readFile(dosya, 'utf8');
    const r = icerigeEnjekteEt(mevcut, { gecikmeMs });
    let modul = false;
    if (r.uygulandi) {
      await fs.writeFile(dosya, r.icerik, 'utf8');
      try {
        await fs.copy(kaynak, path.join(path.dirname(dosya), MODUL_ADI), { overwrite: true });
        modul = true;
      } catch (e) {
        modul = false;
      }
    }
    const goreli = path.relative(paketKoku, dosya) || path.basename(dosya);
    sonuc.push({ dosya: goreli, uygulandi: r.uygulandi, sebep: r.sebep, modul });
    log(`   set güncelleyici: ${goreli} — ${r.sebep}${r.uygulandi ? (modul ? ' (+modül)' : ' (MODÜL KOPYALANAMADI)') : ''}`);
  }
  return sonuc;
}

module.exports = {
  ISARET,
  MODUL_ADI,
  KAYNAK_MODUL,
  GIRIS_ADLARI,
  VARSAYILAN_GECIKME_MS,
  CAPA_RE,
  acikMi,
  blokUret,
  icerigeEnjekteEt,
  girisAdaylari,
  paketeUygula,
};
