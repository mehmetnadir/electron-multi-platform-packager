'use strict';

/**
 * İMPARK KİTAP İÇERİK GÜNCELLEMESİ (kanal K) — PAKETLEME ANI ENJEKSİYONU.
 *
 * Plan: `.claude/docs/tek-kabuk-ve-guncelleme-plani-2026-09-24.md` §Faz 2.
 * Tespit: GUNCELLEME-TESPIT (2026-09-24) c1–c6 — motor `window.require("adm-zip")` ile açıyor,
 * pakette adm-zip YOK, hata yutuluyor, menü sürümü yine de ilerliyor (sahte "Kitap Güncellendi").
 *
 * Bu modülün pakete yaptığı dört şey (hepsi `paketeUygula`):
 *   1) `empp-vendor/adm-zip/` — saf JS, bağımlılıksız; depodaki sürüm birebir kopyalanır.
 *      node_modules'e KONMAZ ve package.json `dependencies`'ine YAZILMAZ (REGRESYON 2026-09-24,
 *      73768 mac 1.0.2): bağımlılık yazılınca electron-builder 26 düğüm modüllerini
 *      `npm list --json --long` çıktısındaki `path`'ten toplar; npm 11 (@npmcli/redact) UUID
 *      görünümlü yol parçalarını üç yıldızla maskeler → iş dizini `temp/<uuid>/app` olduğu için
 *      toplanan yol `temp/<üç yıldız>/app/node_modules/adm-zip` olur → ENOENT scandir, mac
 *      derlemesi düşer (UUID'siz yolda ölçümde geçiyordu, o yüzden görülmedi). Bağımlılıksız
 *      `node_modules/adm-zip` ise electron-builder tarafından hiç kopyalanmaz (ölçüldü: asar'da 0 girdi). Satıcı dizini
 *      `files`'taki tümünü-al deseniyle her platformda asar'a girer; renderer parçası
 *      `window.require('adm-zip')`'i buradan çözer (Windows dahil — sözleşme G1, 2026-09-26).
 *      packagingService'teki "node_modules/adm-zip" `files` istisnası artık ETKİSİZ (zararsız).
 *   2) `empp-icerik-guncelleme.js` — çalışma anı modülü (`src/runtime/icerik-guncelleme.js`):
 *      renderer parçasını fs-shim kurar, ana süreç parçasını (3) çağırır.
 *   3) Ana süreç bloğu (giriş dosyasının SONUNA): WORK↔paket menü uzlaşması + `file:` örtüsü.
 *      Enjeksiyon yeri ana süreçtir (kitap-guncelleme-sozlesmesi "Enjeksiyon yeri — ANA SÜREÇ").
 *   4) KANAL Ş KAPALI — yayıncının kabuk/motor zip kanalı (`checkForUpdates` →
 *      sorucoz.tv/.../Update/<sürüm>.zip → `app.config.js` bulunan HER dizine açar: index.html +
 *      kök motor). adm-zip pakete girince bu kanal CANLANIRDI ve bizim enjekte ettiğimiz
 *      index.html'leri (fs-shim, ağ politikası, subBook) ezerdi. Karar (player-guncelle §1c):
 *      motor kanoniktir; kabuk yalnız SET kanalıyla gider. Tek satırlık no-op.
 *
 * DİSİPLİN (guncelleyici-enjekte.js ile aynı):
 *   • ATOMİK — adm-zip ve modül kopyalanamazsa ana süreç bloğu KONMAZ.
 *   • İDEMPOTENT — işaretler varsa dokunulmaz.
 *   • Blok `EMPP_WORK_DIR` literalini İÇERMEZ: packagingService main.js'te bu literali görünce
 *     kendi WORK enjeksiyonunu atlıyor (`!mainJsContent.includes('EMPP_WORK_DIR')`).
 */

const path = require('path');
const fs = require('fs-extra');
const { kapiAcikMi } = require('./platform-kapisi');

const ISARET = 'EMPP_ICERIK_GUNCELLEME';
const KANAL_S_ISARET = 'EMPP_KANAL_S_KAPALI';
const MODUL_ADI = 'empp-icerik-guncelleme.js';
const KAYNAK_MODUL = path.join(__dirname, '..', 'runtime', 'icerik-guncelleme.js');
// Glob YAZILMAZ (`/**` yok): electron-builder nokta/sihir içermeyen desene `/**/*`'ı kendisi
// ekler (app-builder-lib fileMatcher.computeParsedPatterns — `!node_modules` da böyle çalışır).
// `/*` içeren desen, kaynağı `/\*…\*/` ile yorumsuzlaştıran sentinel testleri
// (linux-deb-opsiyonel.test.js) sessizce körleştiriyordu — ölçüldü 2026-09-24.
const ADM_ZIP_FILES_ISTISNASI = 'node_modules/adm-zip';
/** adm-zip'in pakette durduğu yer — node_modules DIŞI (npm/electron-builder toplayıcısına girmez). */
const VENDOR_DIZIN = 'empp-vendor';
const ADM_ZIP_GORELI = VENDOR_DIZIN + '/adm-zip';
const GIRIS_ADLARI = ['electron.js', 'main.js'];
/** Kanal Ş'nin yaşadığı dosyalar: giriş + motorun `electronUpdate.js` → `electron.js` takası. */
const KANAL_S_ADLARI = ['electron.js', 'main.js', 'electronUpdate.js'];

const CAPA_RE = /require\(\s*["']electron["']\s*\)/;
// Tanınan biçimler: `checkForUpdates = async () => {` (const/let/var ya da virgül listesi, boşluksuz
// minify dahil), `checkForUpdates = async function () {`, `[async] function checkForUpdates() {`.
// Tanınmayan biçim (ör. adı değiştirilmiş minify) → kanal KAPATILAMAZ → paketeUygula adm-zip'i
// KOYMAZ (kanalSTehlikeli). Kapatılamayan kanalı adm-zip ile canlandırmak yasak.
const KANAL_S_RE = /(\bcheckForUpdates\s*=\s*(?:async\s*)?(?:function\s*\w*\s*)?\(\s*\)\s*(?:=>\s*)?\{|(?:async\s+)?function\s+checkForUpdates\s*\(\s*\)\s*\{)/;
/** Kanal Ş izi: adm-zip ya da checkForUpdates geçen ama kapatma işareti taşımayan dosya. */
const KANAL_S_IZ_RE = /adm-zip|\bcheckForUpdates\b/;
const DURUM_ADI = 'empp-icerik-durum.json';

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

/** Kapatma sonrası hâlâ kanal Ş izi taşıyor mu (adm-zip konursa kanal canlanır)? */
function kanalSTehlikeli(icerik) {
  const s = String(icerik == null ? '' : icerik);
  return KANAL_S_IZ_RE.test(s) && !s.includes(KANAL_S_ISARET);
}

function admZipKaynagi() {
  return path.dirname(require.resolve('adm-zip/package.json'));
}

/** Paketin package.json `dependencies`'ine girecek kayıt (depodaki birebir sürüm). */
function paketBagimliliklari(kaynak = admZipKaynagi()) {
  const surum = fs.readJsonSync(path.join(kaynak, 'package.json')).version;
  return { 'adm-zip': surum };
}

/**
 * Kanal Ş'yi kapatır: `checkForUpdates` gövdesinin başına tek satır `return;`.
 * Saf dönüşüm. @returns {{icerik:string, uygulandi:boolean, sebep:string}}
 */
function kanalSKapat(icerik) {
  const giris = String(icerik == null ? '' : icerik);
  if (giris.includes(KANAL_S_ISARET)) return { icerik: giris, uygulandi: false, sebep: 'zaten-kapali' };
  if (!KANAL_S_RE.test(giris)) return { icerik: giris, uygulandi: false, sebep: 'kalip-yok' };
  const cikti = giris.replace(KANAL_S_RE, (bas) => `${bas} return; /* ${KANAL_S_ISARET}: yayıncı `
    + 'kabuk/motor zip kanalı (Ş) bilinçli kapalı — motor kanoniktir, kabuk SET kanalıyla gider '
    + '(player-guncelle §1c; src/packaging/icerik-guncelleme.js) */');
  return { icerik: cikti, uygulandi: true, sebep: 'kapatildi' };
}

/** Ana süreç bloğu. Tamamı try/catch: modül yoksa/patlarsa uygulama normal açılır. */
function blokUret() {
  return `
/* ${ISARET}: İmpark kitap içerik kanalı (K) — WORK↔paket menü uzlaşması + file: örtüsü */
try {
  (function () {
    var __emppIcerik = require('./${MODUL_ADI}');
    __emppIcerik.anaSurecKur({ electron: require('electron'), kok: __dirname });
  })();
} catch (e) { try { console.warn('[empp-icerik] ana süreç kurulamadı:', e && e.message); } catch (_) {} }
`;
}

/** Saf dönüşüm. @returns {{icerik:string, uygulandi:boolean, sebep:string}} */
function anaSurecEnjekteEt(icerik) {
  const giris = String(icerik == null ? '' : icerik);
  if (giris.includes(ISARET)) return { icerik: giris, uygulandi: false, sebep: 'zaten-yamali' };
  if (!CAPA_RE.test(giris)) return { icerik: giris, uygulandi: false, sebep: 'capa-yok' };
  const ayirici = giris.endsWith('\n') ? '' : '\n';
  return { icerik: giris + ayirici + blokUret(), uygulandi: true, sebep: 'enjekte-edildi' };
}

async function dosyaDonustur(dosya, fn) {
  if (!(await fs.pathExists(dosya))) return null;
  const mevcut = await fs.readFile(dosya, 'utf8');
  const r = fn(mevcut);
  if (r.uygulandi) await fs.writeFile(dosya, r.icerik, 'utf8');
  return r;
}

/**
 * package.json'da adm-zip bağımlılığı VARSA ve node_modules/adm-zip YOKSA siler (electron-builder
 * npm toplayıcısı onu arar, bulamaz, derleme düşer). Yayıncı kendi node_modules/adm-zip'ini
 * getirmişse dokunulmaz. @returns {Promise<boolean>} silindi mi
 */
async function bagimlilikGeriAl(paketKoku, log = () => {}) {
  const pj = path.join(paketKoku, 'package.json');
  if (!(await fs.pathExists(pj))) return false;
  const j = await fs.readJson(pj);
  if (!j.dependencies || !Object.prototype.hasOwnProperty.call(j.dependencies, 'adm-zip')) return false;
  if (await fs.pathExists(path.join(paketKoku, 'node_modules', 'adm-zip', 'package.json'))) return false;
  delete j.dependencies['adm-zip'];
  await fs.writeJson(pj, j, { spaces: 2 });
  log('   package.json: node_modules karşılığı olmayan adm-zip bağımlılığı kaldırıldı');
  return true;
}

/**
 * KANAL Ş'Yİ PAKETTE KAPATIR — kök + birinci düzey alt dizinlerdeki electron.js/main.js/
 * electronUpdate.js. `paketeUygula`nın ilk adımıdır; ayrıca Windows paketinde içerik kapısı
 * (EMPP_ICERIK_GUNCELLEME) KAPALI olsa bile tek başına çağrılır (sözleşme G5, 2026-09-26:
 * "Ş pakette KAPALI" — `main.js` adm-zip require patlaması ve `setAppVersion`'ın version.txt'yi
 * sunucu değerine çekmesi durur).
 * @returns {Promise<{kanalS:Array, kanalSAcik:string[]}>}
 */
async function kanalSPaketeUygula(paketKoku, { log = () => {} } = {}) {
  const sonuc = { kanalS: [], kanalSAcik: [] };
  const adaylar = KANAL_S_ADLARI.map((ad) => path.join(paketKoku, ad));
  for (const ad of await fs.readdir(paketKoku)) {
    const tam = path.join(paketKoku, ad);
    let d;
    try { d = await fs.stat(tam); } catch (e) { continue; }
    if (!d.isDirectory() || ad === 'node_modules' || ad === VENDOR_DIZIN) continue;
    for (const g of KANAL_S_ADLARI) adaylar.push(path.join(tam, g));
  }
  for (const dosya of adaylar) {
    const r = await dosyaDonustur(dosya, kanalSKapat);
    if (!r) continue;
    const rel = path.relative(paketKoku, dosya);
    sonuc.kanalS.push({ dosya: rel, uygulandi: r.uygulandi, sebep: r.sebep });
    if (kanalSTehlikeli(r.icerik)) sonuc.kanalSAcik.push(rel);
  }
  log(`   kanal Ş: ${sonuc.kanalS.filter((x) => x.uygulandi).length} dosyada kapatıldı`);
  return sonuc;
}

/**
 * Pakete uygular. prepareElectronFiles'tan SONRA çağrılmalı (package.json + main.js hazır;
 * o adımın `npm install`'ı node_modules'ümüze dokunmasın).
 * @returns {Promise<{kanalS:Array, admZip:boolean, modul:boolean, anaSurec:Array}>}
 */
async function paketeUygula(paketKoku, { log = () => {}, admZipKaynak, kaynakModul } = {}) {
  const sonuc = {
    kanalS: [], kanalSAcik: [], admZip: false, modul: false, anaSurec: [], hata: null,
  };

  // 4) Kanal Ş — kök + birinci düzey alt dizinler (bookN/electron.js kopyaları).
  const s = await kanalSPaketeUygula(paketKoku, { log });
  sonuc.kanalS = s.kanalS;
  sonuc.kanalSAcik = s.kanalSAcik;

  // ATOMİK KAPI (kanal Ş dahil): kanal kapatılamadıysa adm-zip KONMAZ — yoksa yayıncının kabuk
  // zip'i bizim index.html'lerimizi ezer. Kitap içerik güncellemesi bu pakette çalışmaz; bu
  // sessiz değil: log + durum dosyası + dönüş değeri.
  if (sonuc.kanalSAcik.length) {
    sonuc.hata = `kanal-s-kapatilamadi: ${sonuc.kanalSAcik.join(', ')}`;
    log(`   ⛔ içerik güncelleme KAPALI — kanal Ş kapatılamadı (${sonuc.kanalSAcik.join(', ')}); adm-zip konmadı`);
    await durumYaz(paketKoku, sonuc, log);
    return sonuc;
  }

  // 1) adm-zip
  const hedef = path.join(paketKoku, VENDOR_DIZIN, 'adm-zip');
  let kaynak = null;
  try {
    kaynak = admZipKaynak || admZipKaynagi();
    await fs.copy(kaynak, hedef, { dereference: true });
    sonuc.admZip = await fs.pathExists(path.join(hedef, 'adm-zip.js'));
    if (!sonuc.admZip) sonuc.hata = `adm-zip kopyası eksik: ${kaynak}`;
  } catch (e) {
    sonuc.hata = `adm-zip yok: ${e.message}`;
  }
  if (!sonuc.admZip) log(`   ⛔ içerik güncelleme KAPALI — ${sonuc.hata}`);
  // package.json'a adm-zip bağımlılığı YAZILMAZ (başlıktaki regresyon); eski bir koşudan kalmışsa
  // geri alınır — bağımlılık + eksik node_modules = electron-builder ENOENT.
  try { await bagimlilikGeriAl(paketKoku, log); } catch (e) {
    log(`   ⚠️ package.json adm-zip bağımlılığı geri alınamadı: ${e.message}`);
  }

  // 2) çalışma anı modülü
  try {
    await fs.copy(kaynakModul || KAYNAK_MODUL, path.join(paketKoku, MODUL_ADI));
    sonuc.modul = true;
  } catch (e) {
    sonuc.hata = `${MODUL_ADI} kopyalanamadı: ${e.message}`;
    log(`   ⛔ ${sonuc.hata}`);
  }

  // 3) ana süreç bloğu — ATOMİK: adm-zip + modül yoksa konmaz.
  if (sonuc.admZip && sonuc.modul) {
    for (const ad of GIRIS_ADLARI) {
      const dosya = path.join(paketKoku, ad);
      const r = await dosyaDonustur(dosya, anaSurecEnjekteEt);
      if (r) sonuc.anaSurec.push({ dosya: ad, uygulandi: r.uygulandi, sebep: r.sebep });
    }
  }
  log(`   içerik güncelleme: adm-zip=${sonuc.admZip} modül=${sonuc.modul} `
    + `ana-süreç=${sonuc.anaSurec.filter((x) => x.uygulandi).map((x) => x.dosya).join(',') || '-'}`);
  await durumYaz(paketKoku, sonuc, log);
  return sonuc;
}

/** Pakete görünür durum kaydı (sahada "bu pakette içerik güncellemesi var mı?" sorusu için). */
async function durumYaz(paketKoku, sonuc, log) {
  const masaustu = !!(sonuc.admZip && sonuc.modul && sonuc.anaSurec.some((x) => x.uygulandi || x.sebep === 'zaten-yamali'));
  // Tek dosya tüm platform çıktılarına ortak workingPath'ten girer (paketeUygula platform
  // ayrımından önce koşar) → etkinlik PLATFORM BAŞINA yazılır (review2 Y-C). WINDOWS 2026-09-26'dan
  // beri KAPSAMDA (sözleşme G1): adm-zip `empp-vendor/`de, `files`'taki "**/*" deseniyle Windows
  // paketine de girer; fs-shim ve ana süreç parçası win32'de artık dönmüyor, K userData/work'e açılır.
  // Android kendi K8 yolunu kullanıyor (bu modül değil).
  const etkin = { macos: masaustu, linux: masaustu, windows: masaustu, android: false };
  try {
    await fs.writeJson(path.join(paketKoku, DURUM_ADI), {
      etkin, not: 'windows: userData/work (sözleşme G1, VM\'de ölçülecek); android: kendi K8 açıcısı, bu modül değil',
      hata: sonuc.hata, admZip: sonuc.admZip, modul: sonuc.modul,
      kanalSKapali: sonuc.kanalS.filter((x) => x.uygulandi || x.sebep === 'zaten-kapali').map((x) => x.dosya),
      kanalSAcik: sonuc.kanalSAcik, zaman: new Date().toISOString(),
    }, { spaces: 2 });
  } catch (e) { log(`   ⚠️ ${DURUM_ADI} yazılamadı: ${e.message}`); }
}

module.exports = {
  ISARET, KANAL_S_ISARET, MODUL_ADI, KAYNAK_MODUL, ADM_ZIP_FILES_ISTISNASI, DURUM_ADI, VENDOR_DIZIN, ADM_ZIP_GORELI, bagimlilikGeriAl,
  acikMi, admZipKaynagi, kanalSTehlikeli, paketBagimliliklari, kanalSKapat, blokUret, anaSurecEnjekteEt,
  kanalSPaketeUygula, paketeUygula,
};
