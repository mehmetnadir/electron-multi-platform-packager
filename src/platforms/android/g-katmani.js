'use strict';
/**
 * G — Android uzaktan güncelleme istemcisini APK'ya kurar (2026-09-26).
 *
 * NEDEN: Nadir (26.09): "Tüm paketlerde bizim güncelleme istemcimiz (G kanalı) olacak." G ile
 * uzaktan değişenler: kök index.html (set menüsü), set bileşimi (eklenen/çıkarılan kitaplar),
 * her kitabın `bookN/43e23fce2b7009474555a77.js` motoru. Android'de APK assets SALT-OKUNURDUR;
 * yazılabilir "kurulum klasörü" uygulamanın kendi veri alanıdır (`filesDir/empp-g`).
 * Sözleşme: `.claude/docs/platform-kanallari-sozlesmesi.md` O3/O4 + "Android G katmanı".
 *
 * NE KURAR (hepsi ya da hiçbiri — yarım Java = Gradle düşer):
 *   www kökü   empp-g-istemci.js  politika: iki kademe, ed25519 imza, kapsam, plan
 *              empp-g-kabuk.js    `src/packaging/set-kabuk.js` BİREBİR (tarayıcı sarmalı) — kabuk
 *                                 tanımı TEK kaynak; kopya tanım yok
 *              empp-g-nacl.js     tweetnacl 1.0.3 `nacl.min.js` (değiştirilmeden; sha256 çivili)
 *   java       com/empp/g/EmppG{Katman,Rota,Plugin}.java — yazılabilir katman, RouteProcessor, köprü
 *   MainActivity  `super.onCreate`'ten ÖNCE eklenti kaydı + `bridgeBuilder.setRouteProcessor`
 *   (yalnız test) `EMPP_G_TEST_GUVEN_CA` verilirse: YALNIZ 127.0.0.1 için test CA'ya güvenen ağ
 *              güvenlik yapılandırması — yerel https uçtan uca sınaması için. Üretimde verilmez.
 *
 * KAPI: www kökünde `empp-set.json` varsa kurulur (o dosya `EMPP_SET_GUNCELLEME` kapısıyla,
 * platform kapsamlı yazılır — Windows'la AYNI tek kapı). Kimlik/anahtar yoksa istemci çalışma
 * anında "kapalı" der ve hiçbir istek atmaz.
 * BOZARSAN: `g-katmani.test.js` kırılır.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WWW = Object.freeze({
  istemci: 'empp-g-istemci.js',
  kabuk: 'empp-g-kabuk.js',
  nacl: 'empp-g-nacl.js',
  /** Paketin kendi sürümü → istemcinin MONOTON sürüm tabanı (EmppGPlugin.yapilandirma APK'dan okur). */
  paket: 'empp-g-paket.json',
});
const JAVA_DIZINI = ['com', 'empp', 'g'];
const JAVA_DOSYALARI = Object.freeze(['EmppGKatman.java', 'EmppGRota.java', 'EmppGPlugin.java']);
const KAYIT = 'registerPlugin(com.empp.g.EmppGPlugin.class);';
const ROTA = 'com.empp.g.EmppGRota.kur(this, bridgeBuilder);';
const TEST_AG = 'empp_g_test_ag';
const TEST_CA = 'empp_g_test_ca';
/** tweetnacl-1.0.3 `nacl.min.js` — npm tarball'ından (bütünlüğü doğrulanmış) birebir. */
const NACL_SHA256 = '973cc5733cc7432e30ee4682098f413094f494bccf76a567c23908c5035ddbbc';

const KAYNAK = {
  istemci: path.join(__dirname, 'empp-g-istemci.js'),
  setKabuk: path.join(__dirname, '..', '..', 'packaging', 'set-kabuk.js'),
  nacl: path.join(__dirname, 'vendor', 'tweetnacl-1.0.3', 'nacl.min.js'),
  java: path.join(__dirname, 'g-java', ...JAVA_DIZINI),
};

/** `set-kabuk.js`'i DEĞİŞTİRMEDEN tarayıcıda koşturan sarmal → `window.__emppSetKabuk`. Saf. */
function kabukSarmali(setKabukMetni) {
  return '/* EMPP G: src/packaging/set-kabuk.js — birebir, tarayıcı sarmalı (paketleme anında) */\n'
    + '(function (w) {\nvar module = { exports: {} }; var exports = module.exports;\n'
    + String(setKabukMetni)
    + '\n;w.__emppSetKabuk = module.exports;\n})(typeof window !== \'undefined\' ? window : this);\n';
}

function sha256(veri) {
  return crypto.createHash('sha256').update(veri).digest('hex');
}

/**
 * www köküne yazılacak üç dosya (bellekte). nacl sha256'sı tutmazsa ATAR.
 * `kaynaklar` çağırandan (packagingService) gelir: varlık yolu `src/platforms` DIŞINDAN
 * anılmalı ki ölü yol kapısı (`olu-yol-kapisi.js`) onları canlı saysın — shim'le aynı desen.
 */
function wwwDosyalari(kaynaklar = {}) {
  const k = { ...KAYNAK, ...kaynaklar };
  const nacl = fs.readFileSync(k.nacl);
  if (sha256(nacl) !== NACL_SHA256) throw new Error('G: gömülü tweetnacl değişmiş (sha256 tutmadı)');
  return {
    [WWW.istemci]: fs.readFileSync(k.istemci, 'utf8'),
    [WWW.kabuk]: kabukSarmali(fs.readFileSync(KAYNAK.setKabuk, 'utf8')),
    [WWW.nacl]: nacl,
  };
}

/**
 * `empp-g-paket.json` gövdesi. Kök `empp-*` olduğu için G onu ASLA değiştiremez (platform
 * dosyası) ve eklenti onu örtüden değil APK varlığından okur. Sürüm yoksa `null` yazılır:
 * istemci o zaman yalnız son uygulanan G'ye kıyaslar (Electron'da `package.json` sürümünün eşi).
 */
function paketDosyasi(paketSurumu) {
  const s = (typeof paketSurumu === 'string' && paketSurumu.trim()) ? paketSurumu.trim() : null;
  return JSON.stringify({ surum: s }) + '\n';
}

function javaDosyalari() {
  const out = {};
  for (const ad of JAVA_DOSYALARI) out[ad] = fs.readFileSync(path.join(KAYNAK.java, ad), 'utf8');
  return out;
}

/** MainActivity: `super.onCreate`'ten ÖNCE eklenti kaydı + rota (Capacitor 3+ kuralı). Saf, idempotent. */
function mainActivityYamasi(src) {
  if (src.includes(KAYIT) && src.includes(ROTA)) return src;
  const yeni = src.replace(/(\n([ \t]*)super\.onCreate\(savedInstanceState\);)/,
    (tam, satir, girinti) => `\n${girinti}${KAYIT}\n${girinti}${ROTA}${satir}`);
  if (yeni === src) throw new Error('MainActivity: super.onCreate bulunamadı — EmppG kaydedilemedi');
  return yeni;
}

/** YALNIZ test derlemesi: 127.0.0.1 için test CA'ya güven (sistem CA'ları da kalır). Saf. */
function testAgYapilandirmasi() {
  return '<?xml version="1.0" encoding="utf-8"?>\n'
    + '<!-- EMPP G TEST: yalniz yerel uctan uca sinama derlemesi (EMPP_G_TEST_GUVEN_CA). URETIMDE YOK. -->\n'
    + '<network-security-config>\n'
    + '    <domain-config>\n'
    + '        <domain includeSubdomains="false">127.0.0.1</domain>\n'
    + '        <trust-anchors>\n'
    + `            <certificates src="@raw/${TEST_CA}" />\n`
    + '            <certificates src="system" />\n'
    + '        </trust-anchors>\n'
    + '    </domain-config>\n'
    + '</network-security-config>\n';
}

function manifestTestYamasi(xml) {
  if (xml.includes(`@xml/${TEST_AG}`)) return xml;
  if (/android:networkSecurityConfig=/.test(xml)) {
    throw new Error('AndroidManifest: başka networkSecurityConfig var — test güveni eklenmedi');
  }
  const yeni = xml.replace(/<application\b/, `<application android:networkSecurityConfig="@xml/${TEST_AG}"`);
  if (yeni === xml) throw new Error('AndroidManifest: <application> bulunamadı');
  return yeni;
}

function acikMi(wwwPath) {
  return fs.existsSync(path.join(wwwPath, 'empp-set.json'));
}

/**
 * Monoton tabanın paket sürümü (2026-09-26, madde 3). Claim `surum`u (G3) paketleyicide
 * `empp-set.json` `surum` alanına yazılır; Android'de taban da odur. `paketSurumu` (appVersion,
 * Capacitor versionName) DEĞİŞMEZ — ayrı karar. İkisi de G3 ise büyüğü; set'te geçerli sürüm yoksa
 * bugünkü davranış (appVersion; G3 değilse istemci kıyasa sokmaz). Saf okuma, yazmaz.
 * @returns {{surum: string|null, kaynak: 'set'|'paket'|'yok'}}
 */
function paketSurumuSec(wwwPath, paketSurumu) {
  const kg = require('../../runtime/kitap-guncelleyici');
  let setSurumu = null;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(wwwPath, 'empp-set.json'), 'utf8'));
    if (s && kg.gSurumCoz(s.surum)) setSurumu = String(s.surum).trim();
  } catch (e) { setSurumu = null; }
  const p = (typeof paketSurumu === 'string' && paketSurumu.trim()) ? paketSurumu.trim() : null;
  if (setSurumu) {
    const en = kg.enBuyukGSurum([setSurumu, p]);
    return { surum: en, kaynak: en === setSurumu ? 'set' : 'paket' };
  }
  return { surum: p, kaynak: p ? 'paket' : 'yok' };
}

async function mainActivityBul(dizin) {
  let girdiler = [];
  try { girdiler = await fs.promises.readdir(dizin, { withFileTypes: true }); } catch (e) { return null; }
  for (const g of girdiler) {
    const tam = path.join(dizin, g.name);
    if (g.isDirectory()) {
      const f = await mainActivityBul(tam);
      if (f) return f;
    } else if (g.name === 'MainActivity.java') return tam;
  }
  return null;
}

/**
 * Kurulum. Önce HER ŞEY bellekte hazırlanır; biri tutmazsa HİÇBİRİ yazılmaz.
 * @returns {Promise<{kuruldu:boolean, sebep:string, test:boolean}>}
 */
async function kur(webAppPath, wwwPath, { log = () => {}, testCaYolu = null, kaynaklar = {}, paketSurumu = null } = {}) {
  if (!acikMi(wwwPath)) {
    return { kuruldu: false, sebep: 'empp-set.json yok (EMPP_SET_GUNCELLEME bu iş için kapalı)', test: false };
  }
  const main = path.join(webAppPath, 'android', 'app', 'src', 'main');
  const ma = await mainActivityBul(path.join(main, 'java'));
  if (!ma) return { kuruldu: false, sebep: 'MainActivity.java yok', test: false };

  const ps = paketSurumuSec(wwwPath, paketSurumu);
  if (ps.kaynak !== 'set') {
    log(`⚠️ G: empp-set.json'da claim surum'u (G3) yok — Android monoton tabanı ${ps.surum || 'YOK'} `
      + '(pakete gömülü içerikten eski bir G manifesti tabansız kalabilir)');
  }
  const www = { ...wwwDosyalari(kaynaklar), [WWW.paket]: paketDosyasi(ps.surum) };
  const java = javaDosyalari();
  const yeniMa = mainActivityYamasi(await fs.promises.readFile(ma, 'utf8'));
  let test = null;
  if (testCaYolu) {
    const ca = await fs.promises.readFile(testCaYolu, 'utf8');
    if (!/-----BEGIN CERTIFICATE-----/.test(ca)) throw new Error('EMPP_G_TEST_GUVEN_CA bir PEM sertifikası değil');
    const manifestYolu = path.join(main, 'AndroidManifest.xml');
    test = {
      ca,
      manifestYolu,
      manifest: manifestTestYamasi(await fs.promises.readFile(manifestYolu, 'utf8')),
    };
  }

  const javaHedef = path.join(main, 'java', ...JAVA_DIZINI);
  await fs.promises.mkdir(javaHedef, { recursive: true });
  for (const [ad, metin] of Object.entries(java)) await fs.promises.writeFile(path.join(javaHedef, ad), metin);
  await fs.promises.writeFile(ma, yeniMa);
  for (const [ad, icerik] of Object.entries(www)) await fs.promises.writeFile(path.join(wwwPath, ad), icerik);
  if (test) {
    await fs.promises.mkdir(path.join(main, 'res', 'xml'), { recursive: true });
    await fs.promises.mkdir(path.join(main, 'res', 'raw'), { recursive: true });
    await fs.promises.writeFile(path.join(main, 'res', 'xml', `${TEST_AG}.xml`), testAgYapilandirmasi());
    await fs.promises.writeFile(path.join(main, 'res', 'raw', `${TEST_CA}.pem`), test.ca);
    await fs.promises.writeFile(test.manifestYolu, test.manifest);
    log('⚠️ G TEST DERLEMESİ: 127.0.0.1 için test CA güveni eklendi (EMPP_G_TEST_GUVEN_CA) — üretime ÇIKMAZ');
  }
  log(`✅ G: Android güncelleme istemcisi kuruldu (${Object.keys(www).join(', ')} + ${JAVA_DOSYALARI.length} Java)`);
  return { kuruldu: true, sebep: 'kuruldu', test: !!test };
}

module.exports = {
  WWW, JAVA_DOSYALARI, KAYIT, ROTA, TEST_AG, TEST_CA, NACL_SHA256, KAYNAK,
  kabukSarmali, wwwDosyalari, paketDosyasi, javaDosyalari, mainActivityYamasi, testAgYapilandirmasi,
  manifestTestYamasi, acikMi, paketSurumuSec, kur,
};
