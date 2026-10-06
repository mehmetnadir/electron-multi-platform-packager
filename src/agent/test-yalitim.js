'use strict';

/**
 * ORTAK TEST YALITIMI (2026-09-28, agent-test-borcu-20260928 — kök neden kapatma).
 *
 * Kök neden: src/agent/*.test.js dosyalarının çoğu `runner.js`'i require ederken CONFIG'in
 * gerçek `~/.empp-agent/*` yollarını hiç değiştirmiyordu — testler GERÇEK üretim dosyalarını
 * okuyor/yazıyordu. Kanıt (2026-09-28, aynı gece): `pardus-konteyner-kabul.log`'un 245
 * satırının 169'u (%69) test verisiyle kirlenmişti; bunlardan biri gerçek bir kitap ID'siyle
 * (45704) çakışıp `pardus-yeniden-kabul-kuyrugu.sh`'ın dry-run listesine YANLIŞ POZİTİF olarak
 * girdi (bkz. `~/.empp-agent/arastirma/probook-donus-plani-20260928.md`). Bu, aynı gece 16
 * kırmızı testin kök nedeniyle (gerçek `~/.empp-agent/pardus-konteyner-kabul.istek` bayrağının
 * test sürecine sızması) AYNI SINIFIN ikinci örneğiydi.
 *
 * Kullanım — HER test dosyasının EN BAŞINDA, `require('./runner')`'dan ÖNCE:
 *
 *   const { izoleOrtam } = require('./test-yalitim');
 *   const YALITIM = izoleOrtam();                 // env değişkenlerini SET EDER
 *   const runner = require('./runner.js');        // (veya: const { CONFIG, ... } = require(...))
 *   YALITIM.configUygula(runner.CONFIG);           // env'i OLMAYAN 3 alanı mutasyonla izole eder
 *   const { after } = require('node:test');
 *   after(() => YALITIM.temizle());                // env'i geri al + geçici dizini sil
 *
 * `izoleOrtam()` HER ÇAĞRIDA yeni bir geçici dizin açar ve şu env değişkenlerini ORAYA
 * yönlendirir (hepsi runner.js'in CONFIG'inde `process.env.X || <gerçek-yol>` biçiminde
 * ZATEN env-override edilebilir — runner.js'e dokunulmadı):
 *
 *   AGENT_TOKEN_FILE               ← CONFIG.tokenFile               (~/.empp-agent/token.json)
 *   EMPP_PARDUS_YEDEK_KABUL_BAYRAK ← CONFIG.pardusYedekKabulFlag     (…/pardus-konteyner-kabul.istek)
 *   EMPP_PARDUS_YEDEK_KABUL_KAYIT  ← CONFIG.pardusYedekKabulKayit    (…/pardus-konteyner-kabul.log)
 *   AGENT_RESTART_FLAG             ← CONFIG.restartFlag              (…/yeniden-baslat.istek)
 *   AGENT_PAUSE_FLAG               ← CONFIG.pauseFlag                (…/duraklat.istek)
 *   AGENT_LOWDATA_BIN              ← CONFIG.dusukVeriIkili           (…/dusuk-veri, ikili yolu)
 *   EMPP_KABUL_KANIT_KOK           ← tools/kabul/basliksiz-kabul.js `kanitKoku()` (…/kabul-kanit/)
 *   EMPP_BILDIR_IKILI              ← gerçek push bildirimi atan ikili (~/.local/bin/bildir)
 *   IMPARK_BUTUNLUK_PY             ← CONFIG.imparkButunlukPy (salt-okuma script yolu, yine de izole)
 *   EMPP_KAYNAK_YOK_DURUM          ← CONFIG.kaynakYokDurumDosyasi    (…/kaynak-yok-bildirim.json)
 *   EMPP_VM_KOK                    ← CONFIG.winKasaVmKok (~/vm-kapi — windows-kasa köprüsü; boş dizin =
 *                                    kalp yok = kasa ERİŞİLEMEZ, testler gerçek makineye iş YAZMAZ)
 *   EMPP_WIN_KASA_KILIT            ← CONFIG.winKasaKilit (…/windows-kasa-kabul.kilit)
 *   EMPP_WIN_HAZIR_KOK             ← CONFIG.winHazirKoku (…/windows-hazir — imza bekleyen paketler)
 *   EMPP_IMPARK_SMB_KOKU           ← icerik-yedek.js `smbKoku()` (~/Impark — üye kitap SMB yedeği; yok = bağlı değil)
 *
 * `configUygula(CONFIG)`: `macSerbestFlag`, `macDurdurFlag`, `dusukVeriYoksayFlag` alanlarının
 * CONFIG'te env-override'ı YOK (runner.js'te hardcoded `path.join(os.homedir(), ...)`) — bu
 * yüzden yalnız require SONRASI CONFIG nesnesi üzerinde MUTASYONLA izole edilebilirler.
 * runner.js zaten CONFIG'i module-level bir singleton olarak dışa veriyor ve başka testler de
 * (ör. `CONFIG.caps = [...]`) onu böyle mutasyona uğratıyor — aynı, zaten var olan kalıp.
 *
 * `temizle()`: env değişkenlerini ÖNCEKİ değerlerine döndürür (yoksa siler) ve geçici dizini
 * `fs.rmSync(..., {recursive:true, force:true})` ile kaldırır — bu SADECE bu fonksiyonun kendi
 * `mkdtemp` ile açtığı, `os.tmpdir()` altındaki İZOLE geçici dizindir; gerçek `~/.empp-agent`
 * hiçbir zaman silinmez/dokunulmaz.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ENV_ESLEME = {
  AGENT_TOKEN_FILE: 'token.json',
  EMPP_PARDUS_YEDEK_KABUL_BAYRAK: 'pardus-konteyner-kabul.istek',
  EMPP_PARDUS_YEDEK_KABUL_KAYIT: 'pardus-konteyner-kabul.log',
  AGENT_RESTART_FLAG: 'yeniden-baslat.istek',
  AGENT_PAUSE_FLAG: 'duraklat.istek',
  AGENT_LOWDATA_BIN: 'dusuk-veri-yok-boyle-bir-ikili',
  EMPP_KABUL_KANIT_KOK: 'kabul-kanit',
  EMPP_BILDIR_IKILI: 'yok-boyle-bir-bildir-ikili',
  IMPARK_BUTUNLUK_PY: 'yok-boyle-bir-impark-butunluk.py',
  EMPP_KAYNAK_YOK_DURUM: 'kaynak-yok-bildirim.json',
  EMPP_VM_KOK: 'vm-kapi',
  EMPP_WIN_KASA_KILIT: 'windows-kasa-kabul.kilit',
  EMPP_WIN_HAZIR_KOK: 'windows-hazir',
  // Hazır kayıt bayat kararı (windows-hazir gecerliKanonikOku): testler gerçek ~/.empp-agent kanonik.json'ını görmesin.
  EMPP_MOTOR_KANONIK: 'motor-kanonik-yok.json',
  EMPP_KABUK_KANONIK: 'kabuk-kanonik-yok.json',
  // Üye kitap yedeği (icerik-yedek.js): testler gerçek İmpark SMB bağlamasını (~/Impark) görmesin.
  EMPP_IMPARK_SMB_KOKU: 'impark-smb-yok',
  // İmzalı son sürüm arşivi (06.10, imzali-arsiv.js): kasada testler gerçek D:\empp-imzali-son'a yazmasın.
  EMPP_IMZALI_ARSIV_KOKU: 'imzali-son',
};

/**
 * @returns {{dir:string, configUygula:(CONFIG:object)=>void, temizle:()=>void}}
 */
function izoleOrtam() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-yalitim-'));
  const eskiEnv = {};
  for (const [env, dosyaAdi] of Object.entries(ENV_ESLEME)) {
    eskiEnv[env] = process.env[env];
    process.env[env] = path.join(dir, dosyaAdi);
  }

  // imKeys (güvenlik 02.10): runner testleri GERÇEK HasZKitapKey'e (internet) ve srv21 keypanel'ine
  // (ssh) gitmesin. Sahte = "hiçbir kitap anahtarlı değil" → imKeys yazılmaz, kapı geçer (bugünkü
  // davranış). Üretim kodunda env ile kapatma YOK; sahte yalnız bu test yardımcısından konur.
  // imKeys'i ölçen testler (imkeys.test.js, runner-imkeys.test.js) kendi bağımlılığını verir.
  const imKeysMod = require('./imkeys');
  const eskiImKeysBag = imKeysMod.varsayilanBagimliliklar;
  imKeysMod.varsayilanBagimliliklar = () => ({
    anahtarliMi: async () => false,
    kodCek: async () => { throw new Error('test-yalitim: keypanel çağrılmamalı'); },
  });

  // Panel menü hizalama (05.10): runner testleri GERÇEK panele (GetPackageBooks) gitmesin. Sahte =
  // meşru BOŞ liste → adım no-op (menü olduğu gibi). "Ölçülemedi" sahtesi OLMAZ: o geçici hatadır,
  // iş ertelenirdi. Ölçen testler (panel-menu-hizala*.test.js) kendi bağımlılığını verir.
  const panelMenuMod = require('./panel-menu-hizala');
  const eskiPanelMenuBag = panelMenuMod.varsayilanBagimliliklar;
  panelMenuMod.varsayilanBagimliliklar = () => ({
    panelGetir: async () => ({ status: 200, govde: '{"Books":null,"statusMessage":"test-yalitim"}' }),
  });

  let configUygulandi = null;
  return {
    dir,
    configUygula(CONFIG) {
      if (!CONFIG || typeof CONFIG !== 'object') return;
      configUygulandi = {
        macSerbestFlag: CONFIG.macSerbestFlag,
        macDurdurFlag: CONFIG.macDurdurFlag,
        dusukVeriYoksayFlag: CONFIG.dusukVeriYoksayFlag,
        androidSerbestFlag: CONFIG.androidSerbestFlag,
      };
      CONFIG.macSerbestFlag = path.join(dir, 'macos-serbest.istek');
      CONFIG.macDurdurFlag = path.join(dir, 'macos-durdur.istek');
      CONFIG.dusukVeriYoksayFlag = path.join(dir, 'dusuk-veri-yoksay.istek');
      // Android ev kuralı (05.10): yetenek listesini kıyaslayan testler makinenin konumuna bağlı
      // kalmasın diye yalıtık bayrak VAR sayılır (android her yerde açık). Kural saf fonksiyonda ölçülür.
      if ('androidSerbestFlag' in CONFIG) {
        CONFIG.androidSerbestFlag = path.join(dir, 'android-serbest.istek');
        fs.writeFileSync(CONFIG.androidSerbestFlag, '');
      }
      // Dalga B (B4): `kaynak-kur` rolü ofiste kendiliğinden bildirilir — yetenek listesini birebir
      // kıyaslayan testler makinenin konumuna bağlı kalmasın diye testlerde varsayılan KAPALI;
      // gerçek bayrak dosyası okunmaz. Ölçen test (kaynak-r2.test.js) açıkça açar.
      // `kaynak-r2` ise konumdan ve bayraktan BAĞIMSIZ her zaman bildirilir (inceleme E1) — yalıtılacak
      // bir girdisi yok; yetenek listesini birebir kıyaslayan testler onu beklenen listeye yazar.
      if ('kaynakKur' in CONFIG) CONFIG.kaynakKur = false;
      if ('kaynakKurSerbestFlag' in CONFIG) CONFIG.kaynakKurSerbestFlag = path.join(dir, 'kaynak-kur-serbest.istek');
    },
    temizle() {
      for (const [env, eski] of Object.entries(eskiEnv)) {
        if (eski === undefined) delete process.env[env]; else process.env[env] = eski;
      }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* zaten yok */ }
      imKeysMod.varsayilanBagimliliklar = eskiImKeysBag;
      panelMenuMod.varsayilanBagimliliklar = eskiPanelMenuBag;
      configUygulandi = null;
    },
  };
}

/**
 * NÖBETÇİ ALTYAPISI — GERÇEK `~/.empp-agent` yollarının anlık görüntüsü.
 *
 * `izoleOrtam()` env değişkenlerini geçici dizine yönlendirdiği için normal koşuda gerçek
 * yollara hiç dokunulmaz. Ama bu, yalıtımın KENDİSİNİN doğru çalıştığı varsayımına dayanır —
 * yeni bir test dosyası `izoleOrtam()`'ı çağırmayı UNUTURSA yalıtım sessizce devre dışı kalır.
 * `gercekYolYakala()` / `gercekYolFarkiVarMi()` bu varsayıma bağımlı OLMAYAN, bağımsız bir
 * güvenlik ağıdır: gerçek dosyaların mtime+boyutunu (ve kabul-kanit/ dizin giriş sayısını)
 * doğrudan `os.homedir()` üzerinden okur — hangi env değişkeninin kime yönlendirildiğinden
 * bağımsızdır. `test-yalitim-nobetci.test.js` bunu tüm takımın ÖNCESİ/SONRASI için kullanır.
 */
const GERCEK_KABUL_KANIT_DIR = path.join(os.homedir(), '.empp-agent', 'kabul-kanit');
const GERCEK_YOLLAR = {
  tokenFile: path.join(os.homedir(), '.empp-agent', 'token.json'),
  pardusYedekKabulFlag: path.join(os.homedir(), '.empp-agent', 'pardus-konteyner-kabul.istek'),
  pardusYedekKabulKayit: path.join(os.homedir(), '.empp-agent', 'pardus-konteyner-kabul.log'),
  restartFlag: path.join(os.homedir(), '.empp-agent', 'yeniden-baslat.istek'),
  pauseFlag: path.join(os.homedir(), '.empp-agent', 'duraklat.istek'),
  macSerbestFlag: path.join(os.homedir(), '.empp-agent', 'macos-serbest.istek'),
  macDurdurFlag: path.join(os.homedir(), '.empp-agent', 'macos-durdur.istek'),
  dusukVeriYoksayFlag: path.join(os.homedir(), '.empp-agent', 'dusuk-veri-yoksay.istek'),
  androidSerbestFlag: path.join(os.homedir(), '.empp-agent', 'android-serbest.istek'),
};

function dosyaImzasi(p) {
  try {
    const st = fs.statSync(p);
    return { var: true, mtimeMs: st.mtimeMs, size: st.size };
  } catch (_) {
    return { var: false };
  }
}

/** @returns {object} her gerçek yol + kabul-kanit giriş sayısı için anlık görüntü. */
function gercekYolYakala() {
  const goruntu = {};
  for (const [ad, p] of Object.entries(GERCEK_YOLLAR)) goruntu[ad] = dosyaImzasi(p);
  try {
    goruntu.kabulKanitGirisSayisi = fs.readdirSync(GERCEK_KABUL_KANIT_DIR).length;
  } catch (_) {
    goruntu.kabulKanitGirisSayisi = -1; // dizin yok
  }
  return goruntu;
}

/**
 * @param {object} once - gercekYolYakala() çıktısı
 * @param {object} sonra - gercekYolYakala() çıktısı
 * @returns {string[]} değişen alanların adları (boşsa fark yok)
 */
function gercekYolFarki(once, sonra) {
  const farklar = [];
  for (const ad of Object.keys(GERCEK_YOLLAR)) {
    const a = once[ad]; const b = sonra[ad];
    if (a.var !== b.var || a.mtimeMs !== b.mtimeMs || a.size !== b.size) farklar.push(ad);
  }
  if (once.kabulKanitGirisSayisi !== sonra.kabulKanitGirisSayisi) farklar.push('kabulKanitGirisSayisi');
  return farklar;
}

module.exports = { izoleOrtam, ENV_ESLEME, GERCEK_YOLLAR, gercekYolYakala, gercekYolFarki };
