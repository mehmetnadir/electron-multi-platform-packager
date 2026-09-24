'use strict';

/**
 * İMPARK KİTAP İÇERİK GÜNCELLEMESİ (kanal K) — PAKETLEME ANI ENJEKSİYONU.
 *
 * Plan: `.claude/docs/tek-kabuk-ve-guncelleme-plani-2026-09-24.md` §Faz 2.
 * Tespit: GUNCELLEME-TESPIT (2026-09-24) c1–c6 — motor `window.require("adm-zip")` ile açıyor,
 * pakette adm-zip YOK, hata yutuluyor, menü sürümü yine de ilerliyor (sahte "Kitap Güncellendi").
 *
 * Bu modülün pakete yaptığı dört şey (hepsi `paketeUygula`):
 *   1) `node_modules/adm-zip/` — saf JS, bağımlılıksız; depodaki sürüm birebir kopyalanır ve
 *      paketin package.json `dependencies`'ine yazılır (electron-builder ancak böyle toplar).
 *      electron-builder `files` listesindeki `!node_modules` dışlaması `ADM_ZIP_FILES_ISTISNASI`
 *      ile delinmelidir — o değişiklik DONDURULMUŞ `packagingService.js`'te; yama dosyası ayrı.
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

const ISARET = 'EMPP_ICERIK_GUNCELLEME';
const KANAL_S_ISARET = 'EMPP_KANAL_S_KAPALI';
const MODUL_ADI = 'empp-icerik-guncelleme.js';
const KAYNAK_MODUL = path.join(__dirname, '..', 'runtime', 'icerik-guncelleme.js');
// Glob YAZILMAZ (`/**` yok): electron-builder nokta/sihir içermeyen desene `/**/*`'ı kendisi
// ekler (app-builder-lib fileMatcher.computeParsedPatterns — `!node_modules` da böyle çalışır).
// `/*` içeren desen, kaynağı `/\*…\*/` ile yorumsuzlaştıran sentinel testleri
// (linux-deb-opsiyonel.test.js) sessizce körleştiriyordu — ölçüldü 2026-09-24.
const ADM_ZIP_FILES_ISTISNASI = 'node_modules/adm-zip';
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

/** Kapı: varsayılan AÇIK. Kapatmak için EMPP_ICERIK_GUNCELLEME=0. */
function acikMi(env = process.env) {
  return String(env[ISARET] == null ? '' : env[ISARET]) !== '0';
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

/** Paketin package.json'una adm-zip bağımlılığını yazar (varsa). */
async function bagimlilikYaz(paketKoku, kaynak) {
  const pj = path.join(paketKoku, 'package.json');
  if (!(await fs.pathExists(pj))) return false;
  const j = await fs.readJson(pj);
  j.dependencies = { ...(j.dependencies || {}), ...paketBagimliliklari(kaynak) };
  await fs.writeJson(pj, j, { spaces: 2 });
  return true;
}

/**
 * Pakete uygular. prepareElectronFiles'tan SONRA çağrılmalı (package.json + main.js hazır;
 * o adımın `npm install`'ı node_modules'ümüze dokunmasın).
 * @returns {Promise<{kanalS:Array, admZip:boolean, modul:boolean, bagimlilik:boolean, anaSurec:Array}>}
 */
async function paketeUygula(paketKoku, { log = () => {}, admZipKaynak, kaynakModul } = {}) {
  const sonuc = {
    kanalS: [], kanalSAcik: [], admZip: false, modul: false, bagimlilik: false, anaSurec: [], hata: null,
  };

  // 4) Kanal Ş — kök + birinci düzey alt dizinler (bookN/electron.js kopyaları).
  const adaylar = KANAL_S_ADLARI.map((ad) => path.join(paketKoku, ad));
  for (const ad of await fs.readdir(paketKoku)) {
    const tam = path.join(paketKoku, ad);
    let d;
    try { d = await fs.stat(tam); } catch (e) { continue; }
    if (!d.isDirectory() || ad === 'node_modules') continue;
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
  const hedef = path.join(paketKoku, 'node_modules', 'adm-zip');
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
  if (sonuc.admZip) {
    try { sonuc.bagimlilik = await bagimlilikYaz(paketKoku, kaynak); } catch (e) {
      sonuc.hata = `package.json dependencies yazılamadı: ${e.message}`;
      log(`   ⚠️ ${sonuc.hata}`);
    }
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
  // ayrımından önce koşar) → etkinlik PLATFORM BAŞINA yazılır (review2 Y-C): Windows'ta adm-zip
  // `files` istisnası yok ve fs-shim/ana süreç parçası win32'de dönüyor; Android kendi K8 yolunu
  // kullanıyor (bu modül değil).
  const etkin = { macos: masaustu, linux: masaustu, windows: false, android: false };
  try {
    await fs.writeJson(path.join(paketKoku, DURUM_ADI), {
      etkin, not: 'windows: kapsam dışı (ölçülmedi); android: kendi K8 açıcısı, bu modül değil',
      hata: sonuc.hata, admZip: sonuc.admZip, modul: sonuc.modul,
      kanalSKapali: sonuc.kanalS.filter((x) => x.uygulandi || x.sebep === 'zaten-kapali').map((x) => x.dosya),
      kanalSAcik: sonuc.kanalSAcik, zaman: new Date().toISOString(),
    }, { spaces: 2 });
  } catch (e) { log(`   ⚠️ ${DURUM_ADI} yazılamadı: ${e.message}`); }
}

module.exports = {
  ISARET, KANAL_S_ISARET, MODUL_ADI, KAYNAK_MODUL, ADM_ZIP_FILES_ISTISNASI, DURUM_ADI,
  acikMi, admZipKaynagi, kanalSTehlikeli, paketBagimliliklari, kanalSKapat, blokUret, anaSurecEnjekteEt,
  paketeUygula,
};
