'use strict';

/**
 * book-update build-agent runner (PULL model) — macOS + Android (APK).
 *
 * This Mac is the build agent for `android` (APK) and `macos` (.dmg, signed). It
 * PULLs jobs from book-update's agent API, builds each via the LOCAL packager
 * HTTP service, then POSTs the artifact FILE back to book-update which uploads it
 * to R2 server-side (Decision B — R2 creds stay server-side).
 *
 * Loop per poll:
 *   1. GET  {API}/agents/{id}/next-job        (X-Agent-Token)  -> 204 sleep | 200 job
 *   2-3. KAYNAK (exe'siz sözleşme, Nadir 01.10 — İmpark exe'si HİÇBİR koşulda indirilmez):
 *      kaynak-karari.js → manuel build.zip (indir, olduğu gibi) | kaynak arşivi (+ merdiven + set eki)
 *      | yok → kira bırak (POST /release) + bildirim, failed YAZILMAZ
 *   4. build.zip -> POST {PACKAGER}/api/upload-build (sessionId)
 *      -> POST {PACKAGER}/api/package -> poll /api/package-status -> download artifact
 *   5. macos: codesign + notarytool + stapler — NOTER KAPISI (2026-09-26): herhangi biri
 *      düşerse DMG YÜKLENMEZ (geçici sınıf ertelenir; AGENT_NOTER_ZORUNLU=0 eski best-effort)
 *      windows (yalnız EMPP_RUNNER_WINDOWS=1): statik kapı + G → başsız kabul → İmpark imza yuvası
 *      → Authenticode doğrulama → kabul; yayına YALNIZ imzalı kopya gider (windows-serit.js)
 *   6. POST {API}/agents/{id}/result (multipart: file + fields) | on failure: status=failed
 * Heartbeat: POST {API}/agents/{id}/heartbeat every ~15s.
 *
 * Robust: one bad job never kills the loop; network errors back off; SIGTERM is graceful.
 * CommonJS — matches repo style.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const archiver = require('archiver');
const FormData = require('form-data');

const {
  mapPlatform,
  backoffMs,
  parseNextJob,
  isTerminalStatus,
  packageStatusOf,
  artifactExtension,
  joinUrl,
  pickLogoId, asciiAppName,
  packagerResultOf, addFileToZipRoot, restartRequested, pauseRequested, etkinYetenekler, isIsteyebilir, pardusKabulErisimUygula, agGecidiAyikla, agGecidiKomutu, dusukVeriAyristir,
  isTransientNetworkError, yoklamaYenidenDenenir, srcVersionTuret, agHatasiOzeti,
  pardusGerekliDiskGb, uretimKapisi, ertelenebilirKaynakHatasi, DISK_KAPISI_ISARETI,
  noterHatasi,
  probookErisilemezHatasi, PROBOOK_KAPISI_ISARETI, pardusKabulSinifi,
  pardusBetikEnv, claimGSurumu, pardusYedekKabulDurumu,
  curlNullAygiti,
} = require('./runner-helpers');
// Kalıcı kabul kanıtı kökü — başsız (android/mac/windows) kapı AYNI kökü kullanır
// (tools/kabul/basliksiz-kabul.js); Pardus da aynı adlandırma+kökle yazar (bkz. §DÜZELTME 2).
const { kanitAdi, kanitKoku } = require('../../tools/kabul/basliksiz-kabul');
const { denetle: imparkDenetle, ozet: imparkOzet } = require('./impark-butunluk');
const { basliksizKabulKapisi } = require('./basliksiz-kabul-kapisi');
const {
  seritDenetcisiKur, arsivEsleyici, olayBildirici, probookHostSec,
} = require('./serit-secimi');
const { hataOzeti } = require('./hata-ozeti');
const windowsSerit = require('./windows-serit');
const { ikiliKomutu } = require('./bildir-ikili');
const windowsKasaKabul = require('./windows-kasa-kabul');
const windowsHazir = require('./windows-hazir');
const imzaliArsiv = require('./imzali-arsiv');
// Disk kapısı → önce yer aç (Nadir 06.10). Modül nesnesi üzerinden çağrılır (testler yerAc'ı değiştirir).
const diskTemizlik = require('./disk-temizlik');
const {
  kaynakKarari, manuelZipBicimi, exeYoluMu, arsivOkunurMu,
} = require('./kaynak-karari');
const { artefaktOzeti } = require('./artefakt-kaniti');
const { govdeAlanlari: kanonikGovdeAlanlari, logdanOzet: kanonikLogdanOzet } = require('./kanonik-surum');
// Exe'siz kaynak Dalga B (B4): r2-kur / r2-al — uç istemcisi + yayın akışı tek modülde.
const kaynakR2 = require('./kaynak-r2');
const { yazmaKapisi, zipSayfaEnvanteri } = require('./yazma-kapisi');
// Çevrimdışı aktivasyon anahtarları (imKeys.dll) — güvenlik 02.10, bkz. imkeys.js başlığı.
const imKeys = require('./imkeys');
const icerikUyeleri = require('./icerik-uyeleri');
// Kök menülü tek-motor sette paket menüsü ↔ panel GetPackageBooks hizalaması (05.10).
const panelMenu = require('./panel-menu-hizala');

// ---------------------------------------------------------------------------
// Config (env). No secrets hardcoded.
// ---------------------------------------------------------------------------
const CONFIG = {
  apiBase: (process.env.BOOKUPDATE_API || 'https://akillitahta.ndr.ist/api/v1').replace(/\/+$/, ''),
  enrollSecret: process.env.AGENT_ENROLL_SECRET || '',
  packagerApi: (process.env.PACKAGER_API || 'http://127.0.0.1:3001').replace(/\/+$/, ''),
  caps: (process.env.AGENT_CAPS || 'android,macos,pardus')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean),
  tokenFile: process.env.AGENT_TOKEN_FILE || path.join(os.homedir(), '.empp-agent', 'token.json'),
  agentName: process.env.AGENT_NAME || os.hostname(),
  pollMs: Number(process.env.AGENT_POLL_MS || 10000),
  // Build'siz iş bırakıldıktan sonra kısa bekleme (inceleme 01.10): arşivli işler build'sizlerin
  // arkasında beklemesin; tekrar kiralamayı sunucunun dışlama backoff'u (10→60 dk) zaten keser.
  kaynakYokBeklemeMs: Number(process.env.AGENT_KAYNAK_YOK_BEKLEME_MS || 2000),
  heartbeatMs: Number(process.env.AGENT_HEARTBEAT_MS || 15000),
  // Heartbeat POST zaman aşımı (02.10): yükleme sırasında ev hattı doyunca 15 sn yetmiyordu.
  heartbeatTimeoutMs: Number(process.env.AGENT_HEARTBEAT_TIMEOUT_MS || 30000),
  // İlk heartbeat POST'u düşerse (Happy Eyeballs/DNS/timeout — çoğu geçici) bu kadar
  // bekleyip TEK seferlik hızlı bir daha denenir; o da düşerse tek satır loglanır.
  // Testler CONFIG.heartbeatRetryMs'i 0'a çekip gerçek zaman beklemeden koşabilir.
  heartbeatRetryMs: Number(process.env.AGENT_HEARTBEAT_RETRY_MS || 2500),
  packageTimeoutMs: Number(process.env.AGENT_PACKAGE_TIMEOUT_MS || 20 * 60 * 1000),
  // Paketleyici durum yoklama aralığı (localhost). Testler 0'a çeker.
  packagerPollMs: Number(process.env.AGENT_PACKAGER_POLL_MS || 5000),
  // macOS signing (all optional — signing is best-effort).
  signIdentity: process.env.APPLE_SIGN_IDENTITY || '',
  teamId: process.env.APPLE_TEAM_ID || '',
  notaryProfile: process.env.APPLE_NOTARY_PROFILE || '', // notarytool keychain profile name
  appleId: process.env.APPLE_ID || '',
  applePassword: process.env.APPLE_PASSWORD || '',
  // stapler RETRY (2026-09-21, ölçümle): notarytool --wait başarılı dönse bile Apple'ın
  // CloudKit ticket-delivery veritabanına yayılması az gecikmeli — ilk staple denemesi
  // "Record not found" (Error 65) ile düşebilir (bilinen yarış durumu, bkz. sign
  // AndNotarizeMac üstündeki not). Testler bu iki değeri küçültüp gerçek zaman
  // beklemeden koşar.
  stapleRetryMax: Number(process.env.AGENT_STAPLE_RETRY_MAX || 4),
  stapleRetryDelayMs: Number(process.env.AGENT_STAPLE_RETRY_DELAY_MS || 20000),
  // NOTER KAPISI (2026-09-26, Nadir onayı): noter onaysız DMG YÜKLENMEZ. '0' = eski
  // best-effort davranış (acil geri dönüş anahtarı; varsayılan AÇIK).
  noterZorunlu: process.env.AGENT_NOTER_ZORUNLU !== '0',
  // Pardus (.impark) — srv21'in packageLinux'ını Docker'da BİREBİR koşturan betik
  // (bkz. pardus-packager-build.sh header). Test'ler bu CONFIG alanlarını (packagerApi
  // gibi) doğrudan üzerine yazıp gerçek spawn ile fake bir betik/binfmt çalıştırır.
  pardusBuildScript: process.env.PARDUS_BUILD_SCRIPT
    || path.join(__dirname, '..', '..', 'tools', 'pardus', 'pardus-packager-build.sh'),
  pardusTimeoutMs: Number(process.env.AGENT_PARDUS_TIMEOUT_MS || 40 * 60 * 1000),
  // ProBook KABUL KAPISI (Nadir, 2026-09-17): üretilen .impark gerçek Pardus makinesinde
  // KURULUP AÇILMADAN yüklenmez. Kapalıysa (varsayılan) davranış eskisiyle birebir aynıdır.
  // srv21 (ya da başka bir şerit) ÖNCEDEN ürettiği .impark'ı buraya bırakır; ajan o işe
  // geldiğinde Docker derlemesini ATLAR, yalnız kabul kapısı + yükleme yapar (2026-09-17,
  // Nadir: "srv21'i kullanıp paralelliği yükseltebilirsin"). Dosya adı: <bookId>.impark
  // ve yanındaki <bookId>.json içinde {srcVersion} — kaynak sürümü tutmazsa KULLANILMAZ.
  pardusHazirDir: process.env.EMPP_PARDUS_HAZIR_DIR || '',
  // Exe'siz sözleşme (01.10): build'siz işlerin ÖZET bildirim durumu (son gönderim + bekleyenler).
  kaynakYokDurumDosyasi: process.env.EMPP_KAYNAK_YOK_DURUM
    || path.join(os.homedir(), '.empp-agent', 'kaynak-yok-bildirim.json'),
  // Kabuk eki (06.10): erteleme bildiriminin son gönderim zamanları (bookId|kod → ms).
  kabukErteleDurumDosyasi: process.env.EMPP_KABUK_ERTELE_DURUM
    || path.join(os.homedir(), '.empp-agent', 'kabuk-ertele-bildirim.json'),
  // Kabuk eki ön kontrol belleği (bookId → {uretildi, girdiSha, zaman}).
  kabukOnKontrolDosyasi: process.env.EMPP_KABUK_EK_ON_KONTROL
    || path.join(os.homedir(), '.empp-agent', 'kabuk-ek-on-kontrol.json'),
  pardusKabul: process.env.EMPP_PARDUS_KABUL === '1',
  pardusKabulScript: process.env.PARDUS_KABUL_SCRIPT
    || path.join(__dirname, '..', '..', 'tools', 'pardus', 'probook-kabul.sh'),
  pardusKabulTimeoutMs: Number(process.env.AGENT_PARDUS_KABUL_TIMEOUT_MS || 8 * 60 * 1000),
  // SÜRELİ KONTEYNER YEDEK KABUL (2026-09-27, Nadir: "ProBook elektrik kesintisiyle kapalı,
  // yarına kadar bu Mac'teki docker üzerinden fallback'i devreye al"). Bayrak dosyasının ilk
  // boş olmayan satırı bitiş ISO zaman damgasıdır — aktifken VE ProBook'a erişilemezken kabul
  // ProBook betiği yerine BU Mac'teki Docker konteyner kapısından (tools/pardus/konteyner-kabul.sh
  // → konteyner-kapi.sh, imaj pardus-kapi:3) yapılır. Süresi dolan bayrak SİLİNMEZ, yok sayılır;
  // yoksa davranış eskisiyle BİREBİR aynıdır.
  pardusYedekKabulFlag: process.env.EMPP_PARDUS_YEDEK_KABUL_BAYRAK
    || path.join(os.homedir(), '.empp-agent', 'pardus-konteyner-kabul.istek'),
  pardusKonteynerKabulScript: process.env.PARDUS_KONTEYNER_KABUL_SCRIPT
    || path.join(__dirname, '..', '..', 'tools', 'pardus', 'konteyner-kabul.sh'),
  // Konteyner kabul sonuçlarının (GECTI/RED/OLCULEMEDI) TSV kaydı — ProBook dönünce hangi
  // kitapların yeniden ProBook'ta kabul edilmesi gerektiğini bulmak için kullanılacak liste.
  pardusYedekKabulKayit: process.env.EMPP_PARDUS_YEDEK_KABUL_KAYIT
    || path.join(os.homedir(), '.empp-agent', 'pardus-konteyner-kabul.log'),
  // İşler arasında okunur; varsa runner temiz çıkar, launchd yeni kodla açar (bkz. restartRequested).
  restartFlag: process.env.AGENT_RESTART_FLAG || path.join(os.homedir(), '.empp-agent', 'yeniden-baslat.istek'),
  // Dosya durdukça yeni iş alınmaz (aynı anda tek build; harici üretim koşarken). Kaldıran çağırandır.
  pauseFlag: process.env.AGENT_PAUSE_FLAG || path.join(os.homedir(), '.empp-agent', 'duraklat.istek'),
  // macOS işi yalnız ofiste (noter yüklemesi ev hattını boğuyor — 2026-09-12). Bayraklar kalıcıdır.
  ofisGw: process.env.AGENT_OFIS_GW || '192.168.1.254',
  macSerbestFlag: path.join(os.homedir(), '.empp-agent', 'macos-serbest.istek'),
  macDurdurFlag: path.join(os.homedir(), '.empp-agent', 'macos-durdur.istek'),
  // Android de Mac'te yalnız ofiste (apk yüklemesi ~1,3 GB — Nadir 05.10). Bayrak kalıcıdır.
  androidSerbestFlag: path.join(os.homedir(), '.empp-agent', 'android-serbest.istek'),
  // `kaynak-kur` yeteneği (Dalga B, B4): build'i kurup R2'ye 1–3 GB yüklemek YALNIZ yüksek bantta —
  // ofis ağı ya da bu bayrak (macOS kuralıyla aynı desen). EMPP_KAYNAK_KUR=0 acil kapatma.
  kaynakKur: process.env.EMPP_KAYNAK_KUR !== '0',
  kaynakKurSerbestFlag: process.env.EMPP_KAYNAK_KUR_SERBEST_BAYRAK
    || path.join(os.homedir(), '.empp-agent', 'kaynak-kur-serbest.istek'),
  // WiFi Düşük Veri Modu'nda yükleme/iş alma duraklat (Nadir 2026-09-13). İkili: swift NWPath.isConstrained.
  dusukVeriIkili: process.env.AGENT_LOWDATA_BIN || path.join(os.homedir(), '.empp-agent', 'dusuk-veri'),
  dusukVeriYoksayFlag: path.join(os.homedir(), '.empp-agent', 'dusuk-veri-yoksay.istek'),
  dockerReadyTimeoutMs: Number(process.env.AGENT_DOCKER_READY_TIMEOUT_MS || 5 * 60 * 1000),
  dockerReadyPollMs: Number(process.env.AGENT_DOCKER_READY_POLL_MS || 75000),
  imparkButunlukPy: process.env.IMPARK_BUTUNLUK_PY
    || path.join(os.homedir(), '.claude', 'skills', 'pardus-yonetim', 'impark-butunluk.py'),
  // WINDOWS ŞERİDİ (2026-09-26): imza yuvası, kilit, kapı, kanıt ayarları — windows-serit.js.
  // Şerit yalnız EMPP_RUNNER_WINDOWS=1 ile açılır (mapPlatform); imza her koşulda zorunludur.
  ...windowsSerit.varsayilanAyarlar(),
};

const log = (...args) => console.log(new Date().toISOString(), '[agent]', ...args);
const warn = (...args) => console.warn(new Date().toISOString(), '[agent][warn]', ...args);
const errlog = (...args) => console.error(new Date().toISOString(), '[agent][error]', ...args);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let stopping = false;
// The job currently in flight ({bookId, platform}) — the heartbeat reports it as a
// heldJob so the server extends its lease. Without this, a build slower than the
// lease window (e.g. a 39-min download on a slow link) loses the lease mid-build
// and the job gets re-dispatched, wasting the work. Null when idle.
let currentJob = null;
// Sinyalle kapanışta kirayı bırakmak için (06.10, 11845 mac: SIGTERM 2 sn'de çıktı, kira 30 dk asılı kaldı).
let sonAuth = null;

// ---------------------------------------------------------------------------
// Small process helper.
// ---------------------------------------------------------------------------
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, opts);
    let stdout = '';
    let stderr = '';
    if (p.stdout) p.stdout.on('data', (d) => (stdout += d.toString()));
    if (p.stderr) p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('close', (code) => resolve({ code: code == null ? -1 : code, stdout, stderr }));
    p.on('error', (e) => resolve({ code: -1, stdout, stderr: String(e && e.message ? e.message : e) }));
  });
}

async function commandExists(cmd) {
  const res = await run('which', [cmd]);
  return res.code === 0 && res.stdout.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Enroll-or-load token.
// ---------------------------------------------------------------------------
async function loadToken() {
  try {
    const raw = await fsp.readFile(CONFIG.tokenFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.agentId && parsed.token) return parsed;
  } catch (_) {
    // not enrolled yet
  }
  return null;
}

async function saveToken(token) {
  await fsp.mkdir(path.dirname(CONFIG.tokenFile), { recursive: true });
  await fsp.writeFile(CONFIG.tokenFile, JSON.stringify(token, null, 2), { mode: 0o600 });
}

async function enroll() {
  if (!CONFIG.enrollSecret) {
    throw new Error('AGENT_ENROLL_SECRET is required to enroll (no token file present)');
  }
  log('enrolling as', CONFIG.agentName, 'caps:', CONFIG.caps.join(','));
  const res = await axios.post(
    joinUrl(CONFIG.apiBase, 'agents/enroll'),
    {
      secret: CONFIG.enrollSecret,
      name: CONFIG.agentName,
      hostname: os.hostname(),
      capabilities: CONFIG.caps,
    },
    { timeout: 30000, validateStatus: () => true },
  );
  if (res.status !== 201 || !res.data || !res.data.agentId || !res.data.token) {
    throw new Error(`enroll failed: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  const token = { agentId: res.data.agentId, token: res.data.token };
  await saveToken(token);
  log('enrolled, agentId:', token.agentId);
  return token;
}

async function enrollOrLoad() {
  const existing = await loadToken();
  if (existing) {
    log('loaded existing token, agentId:', existing.agentId);
    return existing;
  }
  return enroll();
}

// ---------------------------------------------------------------------------
// API calls (book-update agent API).
// ---------------------------------------------------------------------------
function agentHeaders(auth) {
  return { 'X-Agent-Token': auth.token };
}

// --- Konum + etkin yetenekler -------------------------------------------------------------
// Varsayılan ağ geçidi ofis FortiGate'i (192.168.1.254) ise ofisteyiz. 60 sn önbellek; hata = ofis değil.
let _konum = { t: 0, ofiste: false };
function ofisteMi() {
  const simdi = Date.now();
  if (simdi - _konum.t < 60000) return _konum.ofiste;
  let ofiste = false;
  if (process.platform === 'win32') {
    // windows-kasa (2026-10-02): Windows `route` BSD sözdizimini bilmez, her nabızda kullanım metnini
    // günlüğe döker. Konum sabit bir makinede ayardan gelir (AGENT_OFISTE=1); yoksa ofis değil.
    ofiste = process.env.AGENT_OFISTE === '1';
  } else {
    try {
      // macOS `route`, Linux (ProBook ajanı, 02.10) `ip route` — ikisi de agGecidiAyikla'dan geçer.
      const [komut, argv] = agGecidiKomutu();
      const out = require('child_process').execFileSync(komut, argv, { timeout: 3000, encoding: 'utf8' });
      ofiste = agGecidiAyikla(out) === CONFIG.ofisGw;
    } catch (e) { ofiste = false; }
  }
  _konum = { t: simdi, ofiste };
  return ofiste;
}
let _dusukVeri = { t: 0, aktif: false };
function dusukVeriModu() {
  // Override: yoksay bayrağı varsa asla duraklatma.
  if (pauseRequested(CONFIG.dusukVeriYoksayFlag)) return false;
  const simdi = Date.now();
  if (simdi - _dusukVeri.t < 60000) return _dusukVeri.aktif;
  let aktif = false;
  try {
    const out = require('child_process').execFileSync(CONFIG.dusukVeriIkili, [], { timeout: 8000, encoding: 'utf8' });
    aktif = dusukVeriAyristir(out);
  } catch (e) { aktif = false; } // ikili yok/hata = durdurma (güvenli varsayılan)
  _dusukVeri = { t: simdi, aktif };
  return aktif;
}

// Apple araç zinciri sağlık probu (5 dk önbellek).
//
// NEDEN VAR (2026-09-16, ölçülmüş arıza): Xcode 27.0 otomatik güncellemesi lisans
// onayını sıfırladı. O andan itibaren `xcrun`'a bağlı her şey rc=69 verdi —
// notarytool dahil, yani imza/noter zinciri komple öldü. Ajan bunu bilmediği için
// mac işi kiralamaya devam etti: 73768 ve 72378 için ~730 MB kaynak indirildi,
// electron-builder 35 saniyede düştü, satırlara sahte `failed` yazıldı. Kurtarma
// insana bağlıydı (elle `macos-durdur.istek`).
//
// Prob olarak `xcrun --find notarytool` seçildi: hem xcrun kapısını hem noter
// aracının varlığını tek çağrıda sınar ve ölçülen maliyeti ~0,1 sn (araç ayaktayken
// yalnız yol basar, aracı ÇALIŞTIRMAZ). Hata/zaman aşımı = BOZUK sayılır; yanlış
// pozitifin bedeli 5 dk mac beklemesi, yanlış negatifin bedeli 730 MB + sahte hata.
let _macArac = { t: 0, saglam: null, sebep: '' };
function macAraciSaglamMi() {
  const simdi = Date.now();
  if (_macArac.saglam !== null && simdi - _macArac.t < 300000) return _macArac.saglam;
  let saglam = false;
  let sebep = '';
  try {
    require('child_process').execFileSync('xcrun', ['--find', 'notarytool'], { timeout: 15000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    saglam = true;
  } catch (e) {
    // Lisans mesajı stderr'e düşer; sebebi SAKLA — arızanın adı log'da görünsün,
    // yoksa "mac neden durdu" sorusu yine elle kazı gerektirir.
    const ham = String((e && e.stderr) || (e && e.message) || '').trim();
    sebep = ham.split('\n')[0].slice(0, 200) || 'xcrun çalıştırılamadı';
  }
  if (_macArac.saglam !== saglam) {
    if (saglam) log('mac araç zinciri SAĞLAM (xcrun+notarytool) — macos yeteneği geri açılıyor');
    else errlog('mac araç zinciri BOZUK — macos yeteneği düşürüldü. Sebep:', sebep);
  }
  _macArac = { t: simdi, saglam, sebep };
  return saglam;
}

// PROBOOK ŞERİDİ (2026-09-26, plan karar 2): ProBook sağlıklıyken (nabız ≤10 dk, ajan ayakta,
// API erişilebilir, kaynak arşivi eşit, 43e23 motor kanoniği eşit, disk kapısı) Mac `pardus`
// yeteneğini DÜŞÜRÜR; değilse
// alır. Kod varsayılanı KAPALI (EMPP_PROBOOK_SERIT=1 ile açılır) → kapalıyken null, davranış aynı.
// Nabız ARKA PLANDA okunur (heartbeat beklemez); ilk karar main()'de ilk heartbeat'ten önce.
let seritDenetcisi = seritDenetcisiKur({
  env: process.env,
  caps: CONFIG.caps,
  log,
  olayBildir: olayBildirici({ env: process.env, log: warn }),
  arsivOzetiFn: () => require('./kaynak-arsivi').arsivOzeti().ozet,
  // Mac docker şeridinin kullandığı kanonik (EMPP_MOTOR_KANONIK ya da ~/.empp-agent/motor),
  // doğrulanmış sha12.
  motorSha12Fn: () => {
    const k = require('../packaging/motor-surumu').kanonikOzetEsz();
    return k ? k.sha12 : null;
  },
  arsivEsle: arsivEsleyici({
    betik: path.join(__dirname, '..', '..', 'tools', 'probook', 'arsiv-esle.sh'),
    host: probookHostSec(process.env),
    log,
  }),
});

// İmza yuvası erişilebilirliği (60 sn önbellek, arka planda ölçülür — heartbeat'i bekletmez).
// Ölçülmediyse false: windows ilan edilmez (yanlış negatifin bedeli 60 sn gecikme).
let _imzaYuvasi = { t: 0, erisilir: false, suruyor: false };
function imzaYuvasiDurumu() {
  if (!_imzaYuvasi.suruyor && Date.now() - _imzaYuvasi.t >= 60000) {
    _imzaYuvasi.suruyor = true;
    windowsSerit.imzaYuvasiErisilirMi(CONFIG)
      .then((erisilir) => { _imzaYuvasi = { t: Date.now(), erisilir, suruyor: false }; })
      .catch(() => { _imzaYuvasi = { t: Date.now(), erisilir: false, suruyor: false }; });
  }
  return _imzaYuvasi.erisilir;
}

// WINDOWS KABUL KAPISI BİLGİSİ (2026-10-02): Windows işinde kabul hangi kapıdan geçecek —
// windows-kasa (gerçek Windows, izleyici kalbi taze) mı, Mac başsız kabulü (yedek) mi? YALNIZ BİLGİ:
// yetenek ilanını DEĞİŞTİRMEZ (kasa düşükken de başsız yedek var, windows ilanı imza yuvasına bağlı
// kalır). Ölçüm ucuz (kalp dosyası okuma, süreç yok); değişince tek satır log atılır.
let _sonWinKabul = '';
function winKabulDurumu() {
  const e = windowsKasaKabul.kasaErisimi(CONFIG);
  const kapi = e.erisilir ? 'kasa' : 'basliksiz';
  const iz = `${kapi}|${e.erisilir ? '' : e.sebep.replace(/\d+ sn/g, 'N sn')}`;
  if (iz !== _sonWinKabul) {
    log(`windows: winKabul=${kapi} — ${e.sebep}`);
    _sonWinKabul = iz;
  }
  return kapi;
}

// PARDUS KABUL ERİŞİM KAPISI (2026-09-27): ProBook TCP 22'de yanıt veriyor mu? — imza yuvası
// ölçümüyle (imzaYuvasiDurumu) BİREBİR aynı kalıp: 60 sn önbellek, arka planda ölçülür, tek
// uçuş (`suruyor`), heartbeat'i BEKLETMEZ (senkron son değeri döner). Çocuk süreç (ssh/nc)
// KULLANILMAZ — yalnız `net.connect` + zaman aşımı. İlk çağrıda (henüz ölçülmedi) `undefined`
// döner; `pardusKabulErisimUygula` bunu "engelleme yok, bugünkü davranış" sayar.
let _probookErisim = { t: 0, erisilir: undefined, suruyor: false };
function probookErisimDurumu(host, port = 22) {
  if (!_probookErisim.suruyor && Date.now() - _probookErisim.t >= 60000) {
    _probookErisim.suruyor = true;
    const net = require('net');
    const gercekHost = String(host || '').split('@').pop();
    const soket = net.connect({ host: gercekHost, port, timeout: 5000 });
    let karar = false;
    const bitir = (erisilir) => {
      if (karar) return;
      karar = true;
      _probookErisim = { t: Date.now(), erisilir, suruyor: false };
      try { soket.destroy(); } catch (_) { /* zaten kapalı */ }
    };
    soket.once('connect', () => bitir(true));
    soket.once('timeout', () => bitir(false));
    soket.once('error', () => bitir(false));
  }
  return _probookErisim.erisilir;
}

// Kabul betiği PROBOOK_HOST'u okur; 'yerel' = kabul ProBook'un kendisinde (probookHostSec onu
// Tailscale varsayılanına çevirir, o yüzden burada ayrıca korunur).
function pardusKabulHostu() {
  return process.env.PROBOOK_HOST === 'yerel' ? 'yerel' : probookHostSec(process.env);
}

// SÜRELİ KONTEYNER YEDEK KABUL (2026-09-27) — bayrak dosyasını her çağrıda senkron ve ucuz
// okur (restart gerekmez); yorum saf fonksiyonda (pardusYedekKabulDurumu). Durum değiştiğinde
// (aktif↔pasif) TEK satır log atar, her çağrıda atmaz — başlangıç durumu 'pasif' varsayılır ki
// bayrak hiç kurulmamışken (yaygın durum) açılışta gereksiz log basılmasın.
let _yedekAktifSon = false;
function pardusYedekKabul() {
  let icerik = '';
  try { icerik = fs.readFileSync(CONFIG.pardusYedekKabulFlag, 'utf8'); } catch (_) { icerik = ''; }
  const durum = pardusYedekKabulDurumu(icerik, Date.now());
  if (durum.aktif !== _yedekAktifSon) {
    _yedekAktifSon = durum.aktif;
    if (durum.aktif) {
      log(`pardus: KONTEYNER YEDEK KABUL AKTİF — ${durum.bitis}'e kadar ProBook erişilemezse kabul bu Mac'teki Docker konteyner kapısından yapılır`);
    } else {
      log('pardus: konteyner yedek kabulü pasif' + (durum.sebep === 'suresi-doldu' ? ` (süresi doldu: ${durum.bitis})` : ''));
    }
  }
  return durum;
}

// Açılışta ilk ölçümü bekler (en çok sinirMs): ilk next-job 'ölçülmedi' ile pardus kiralamasın
// (27.09 12:34: açılıştan 1,4 sn sonra 60014 pardus kiralandı; ERİŞİLEMEZ kararı ancak 16 sn sonraki heartbeat'te devreye girdi).
async function probookErisimIlkOlcum(host, { sinirMs = 6000, port = 22 } = {}) {
  const bitis = Date.now() + sinirMs;
  let v = probookErisimDurumu(host, port);
  while (v === undefined && Date.now() < bitis) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50));
    v = probookErisimDurumu(host, port);
  }
  return v;
}

/** Platform (testler `_platformAyarla` ile Linux'u taklit eder). */
let _platform = process.platform;

/**
 * `kaynak-kur` yeteneğinin anlık girdisi (heartbeat ve r2-kur iş anı aynı karardan). DEĞİŞMEZ
 * (birleşik inceleme K1): Mac dışında kabuk tazeleme açık + kaynak 'ek' + açık anahtar yoksa
 * `acik` false — build eski kabukla kurulmaz (45551 2.51.3).
 */
function kaynakKurDurumu() {
  return {
    acik: CONFIG.kaynakKur && setKabuk.kaynakKurKabukKarari({ platform: _platform }).uygun,
    ofiste: ofisteMi(),
    serbest: pauseRequested(CONFIG.kaynakKurSerbestFlag),
  };
}

let _sonYetenek = '';
let _sonYetenekListesi = null; // son hesaplanan liste; siradakiIs iş isteme kapısı okur
function guncelYetenekler() {
  let caps = etkinYetenekler(CONFIG.caps, {
    ofiste: ofisteMi(),
    macSerbest: pauseRequested(CONFIG.macSerbestFlag),
    macDurdur: pauseRequested(CONFIG.macDurdurFlag),
    androidEvKurali: CONFIG.caps.some((c) => c === 'macos' || c === 'mac'),
    androidSerbest: pauseRequested(CONFIG.androidSerbestFlag),
    // Araç zinciri yalnız mac istenen durumlarda ölçülür — pardus/android koşarken
    // boşuna xcrun çağırmayalım.
    macAraci: CONFIG.caps.some((c) => c === 'macos' || c === 'mac') ? macAraciSaglamMi() : undefined,
    // Windows yalnız anahtar açıkken VE imza yuvası (İmpark VPN + Storage7) erişilirken ilan edilir:
    // aksi hâlde iş kiralanır, ~20 dk üretilir, imzada düşer. AGENT_CAPS'a windows eklemek ayrı karar.
    windowsAcik: process.env.EMPP_RUNNER_WINDOWS === '1',
    imzaYuvasi: CONFIG.caps.includes('windows') && process.env.EMPP_RUNNER_WINDOWS === '1'
      ? imzaYuvasiDurumu() : undefined,
    // İMZA BEKLİYOR (§2a, 02.10): hazır kuyruk açıkken yuva kapalı da olsa windows ilan edilir.
    imzaBekleme: CONFIG.winHazirAcik === true,
  });
  const winKabul = CONFIG.caps.includes('windows') && process.env.EMPP_RUNNER_WINDOWS === '1'
    ? winKabulDurumu() : undefined;
  if (seritDenetcisi) {
    seritDenetcisi.tazele().catch(() => {}); // kendini 60 sn'de bir kısar; beklenmez
    caps = seritDenetcisi.uygula(caps);
  }
  // PARDUS KABUL ERİŞİM KAPISI (2026-09-27): şerit denetçisinden SONRA çalışır — o ProBook'un
  // NABIZ sağlığına bakıp "pardus'u Mac mi alsın ProBook mi üretsin" kararını verir; bu kapı
  // ise ayrı bir soruyu cevaplar: "kabul betiği (ssh) ProBook'a şu an ULAŞABİLİYOR mu". Şerit
  // Mac'e pardus'u devretse bile (ör. nabız bayat) ProBook'a erişilemiyorsa kabul yine de
  // imkânsızdır — o yüzden son süzgeç burada, şeridin kararının ÜSTÜNE uygulanır.
  const pardusVar = CONFIG.caps.includes('pardus');
  const kabulHost = pardusKabulHostu();
  const probookErisimi = pardusVar && kabulHost !== 'yerel' ? probookErisimDurumu(kabulHost) : undefined;
  // KONTEYNER YEDEK KABUL (2026-09-27): pardusVar dışında hesaplamaya gerek yok.
  const yedek = pardusVar ? pardusYedekKabul() : { aktif: false };
  if (pardusVar) {
    caps = pardusKabulErisimUygula(caps, {
      kabulAcik: CONFIG.pardusKabul,
      kapiAcik: process.env.EMPP_PARDUS_KABUL_ERISIM !== '0', // acil kapatma: EMPP_PARDUS_KABUL_ERISIM=0
      host: kabulHost,
      erisilir: probookErisimi,
      yedekAktif: yedek.aktif,
    });
  }
  // KAYNAK-R2 (Dalga B, B4 / inceleme E1): bu runner r2-al/r2-kur claim'ini anlar — sunucu `r2-al`'ı
  // yalnız bunu bildiren ajana verir. Konumdan BAĞIMSIZ, her zaman bildirilir.
  caps = kaynakR2.kaynakR2Ekle(caps);
  // KAYNAK-KUR (Dalga B, B4): platform değil ROL — sunucu `r2-kur`u yalnız bunu bildiren ajana verir.
  // Evde bildirilmez (1–3 GB yükleme); ofiste ya da `kaynak-kur-serbest.istek` bayrağıyla.
  caps = kaynakR2.kaynakKurEkle(caps, kaynakKurDurumu());
  const imza = caps.join(',');
  if (imza !== _sonYetenek) {
    log('etkin yetenekler:', imza || '(yok)', '| ofiste=' + _konum.ofiste,
      '| macAraç=' + (_macArac.saglam === null ? 'ölçülmedi' : (_macArac.saglam ? 'sağlam' : 'BOZUK')),
      ...(seritDenetcisi ? ['| pardus şeridi=' + seritDenetcisi.ozet()] : []),
      ...(pardusVar ? ['| probook=' + (probookErisimi === true ? 'erişilir' : (probookErisimi === false ? 'ERİŞİLEMEZ' : 'ölçülmedi'))] : []),
      ...(pardusVar && yedek.aktif && caps.includes('pardus') ? ['| yedek=konteyner(' + yedek.bitis + ')'] : []),
      ...(winKabul ? ['| winKabul=' + winKabul] : []),
      '| tam:', CONFIG.caps.join(','));
    _sonYetenek = imza;
  }
  _sonYetenekListesi = caps;
  return caps;
}

// YETİM KİRA (2026-09-30, 45482/android 12:17Z): next-job 30 sn'de zaman aşımına uğrarsa
// sunucu satırı ÇOKTAN kiralamış olabilir. Her mantıksal istek bir `X-Istek-Id` taşır;
// yanıt ALINAMAZSA (ağ hatası/zaman aşımı/5xx) kimlik korunur ve sonraki deneme AYNI
// kimlikle sorar → sunucu aynı işi geri verir, yeni satır kiralamaz. Yalnız 200/204 alınınca
// kimlik tüketilir. Eski sunucu başlığı yok sayar (davranış eskisi gibi).
// SINIR (inceleme 30.09): sunucunun yavaş yolu her seferinde 30 sn'yi aşarsa aynı kimlik ajanı
// tek işe kilitlemesin — kimlik en çok ISTEK_KIMLIGI_DENEME denemede ya da ilk kullanımdan
// ISTEK_KIMLIGI_OMUR_MS sonra yenilenir (sunucu da kaydı 5 dk'dan sonra kabul etmez).
const ISTEK_KIMLIGI_DENEME = 3;
const ISTEK_KIMLIGI_OMUR_MS = 5 * 60 * 1000;
let _bekleyenIstekId = null;
let _istekDeneme = 0;
let _istekIlkMs = 0;

async function fetchNextJob(auth) {
  if (!_bekleyenIstekId || _istekDeneme >= ISTEK_KIMLIGI_DENEME
    || Date.now() - _istekIlkMs > ISTEK_KIMLIGI_OMUR_MS) {
    _bekleyenIstekId = require('crypto').randomUUID();
    _istekDeneme = 0;
    _istekIlkMs = Date.now();
  }
  _istekDeneme += 1;
  const res = await axios.get(joinUrl(CONFIG.apiBase, `agents/${auth.agentId}/next-job`), {
    headers: { ...agentHeaders(auth), 'X-Istek-Id': _bekleyenIstekId },
    timeout: 30000,
    validateStatus: () => true,
  });
  if (res.status === 200 || res.status === 204) _bekleyenIstekId = null;
  return parseNextJob(res.status, res.data);
}

/** KABUL KUYRUĞU (05.10) etkin mi: bayrak (EMPP_WIN_KABUL_KUYRUK=1) VE hazır kuyruk açık. */
function kabulKuyruguAcik() {
  return CONFIG.winKabulKuyrugu === true && CONFIG.winHazirAcik === true;
}

/**
 * Üretim kapısı (05.10): kabul kuyruğu açıkken claim'den ÖNCE. Kabul işçisinde sıra bekleyen kayıt
 * (işlenmekte olan sayılmaz) derinliğe ulaştıysa ya da üretim diski darsa yeni iş alınmaz; nabız sürer.
 * Kuyruk kapalıyken her zaman açık (eski davranış). @returns {Promise<{acik:boolean, sebep?:string}>}
 */
async function uretimKapisiDurumu() {
  if (!kabulKuyruguAcik()) return { acik: true };
  const liste = await windowsHazir.kabulListesi(CONFIG);
  let bosGb = diskBosGb(os.tmpdir());
  // DİSK DOLU → İŞİ DURDURMA, YER AÇ (Nadir 06.10): kapı kapanmadan önce temizlik bekçisi koşar
  // (en eski bizim dosyamızdan; yalnız kasa/ProBook, EMPP_DISK_TEMIZLIK=1). Sonra yeniden ölçülür.
  if (bosGb !== null && CONFIG.winUretMinBosGb > 0 && bosGb < CONFIG.winUretMinBosGb) {
    await diskTemizlik.yerAc({ gerekliGb: CONFIG.winUretMinBosGb, log, warn });
    bosGb = diskBosGb(os.tmpdir());
  }
  if (bosGb === null && !uretimKapisiDurumu._bosGbUyarisi) {
    warn(`üretim kapısı: ${os.tmpdir()} boş alanı ölçülemedi — disk ölçütü atlandı (yalnız kuyruk derinliği)`);
    uretimKapisiDurumu._bosGbUyarisi = true;
  }
  return uretimKapisi({
    kuyrukSayisi: liste.filter((g) => !g.isleniyor).length,
    derinlik: CONFIG.winKabulDerinlik,
    bosGb,
    minGb: CONFIG.winUretMinBosGb,
  });
}

/**
 * Ana döngünün iş alma adımı: üretim kapısı kapalıysa next-job ÇAĞRILMAZ.
 * @returns {Promise<{kapali:true, sebep:string}|{job:object|null}>}
 */
async function siradakiIs(auth) {
  // Platform yeteneği yoksa (evde Mac: yalnız kaynak-r2) iş isteme — sunucu eski CSV'yle kiralıyor.
  if (!isIsteyebilir(_sonYetenekListesi)) {
    return { kapali: true, sebep: 'iş alınabilir yetenek yok (' + (_sonYetenekListesi.join(',') || 'boş') + ')' };
  }
  const kapi = await uretimKapisiDurumu();
  if (!kapi.acik) return { kapali: true, sebep: kapi.sebep };
  return { job: await fetchNextJob(auth) };
}

/**
 * ERTELEME = KİRAYI AÇIKÇA BIRAK (2026-09-30). Ertelenebilir hatada (disk kapısı, başsız kabul
 * ÖLÇÜLEMEDİ, noter/ProBook geçici sınıfı) 'failed' YAZILMAZ; eskiden kira da bırakılmıyordu →
 * iş 30 dk kira dolana kadar asılı kalıyordu. Sunucu işi kuyruğun sonuna koyar, bu ajana bir
 * süre vermez, başka ajan hemen alabilir. FIRLATMAZ: eski sunucu (404) / ağ hatası → false,
 * kira eskisi gibi süre dolunca döner.
 * @returns {Promise<boolean>} kira bırakıldı mı
 */
async function releaseJob(auth, job, sebep, ek = {}) {
  return (await releaseJobYanit(auth, job, sebep, ek)).ok;
}

/**
 * `releaseJob`'un ayrıntılı hâli. `tutuldu` = sunucu `durum:'imza-bekliyor'`u TANIDI ve satırı kuyruğa
 * bırakmadan (running + kira sahibi + lease NULL) tuttu (yanıtta `tutuldu:true`). Eski sunucu alanı
 * yok sayar, satırı olağan bırakır → `ok:true, tutuldu:false` (runner eski davranışa düşer: iş yeniden
 * kiralanınca hazır kayıt devralınır). FIRLATMAZ.
 * @returns {Promise<{ok:boolean, tutuldu:boolean}>}
 */
async function releaseJobYanit(auth, job, sebep, ek = {}) {
  try {
    const res = await axios.post(
      joinUrl(CONFIG.apiBase, `agents/${auth.agentId}/release`),
      { bookId: job.bookId, platform: job.platform, sebep: String(sebep || '').slice(0, 300), ...ek },
      { headers: { ...agentHeaders(auth), 'Content-Type': 'application/json' }, timeout: 30000, validateStatus: () => true },
    );
    if (res.status === 200) return { ok: true, tutuldu: Boolean(res.data && res.data.tutuldu === true) };
    warn('kira bırakılamadı (HTTP', res.status + '), kira dolunca kuyruğa döner:', job.bookId, job.platform);
    return { ok: false, tutuldu: false };
  } catch (e) {
    warn('kira bırakılamadı (ağ):', job.bookId, job.platform, '-', agHatasiOzeti(e));
    return { ok: false, tutuldu: false };
  }
}

/**
 * heartbeat başarısız olunca eskiden hiç yeniden deneme YOKTU (fire-and-forget
 * setInterval) — sıradaki tık CONFIG.heartbeatMs (~15sn) sonra gelirdi. İlk POST
 * düşerse CONFIG.heartbeatRetryMs bekleyip TEK seferlik hızlı bir daha denenir
 * (gecikme CONFIG'ten okunur — testler CONFIG.heartbeatRetryMs'i 0'a çekip gerçek
 * zaman beklemeden koşabilir); o da düşerse tek satır loglanır (agHatasiOzeti —
 * boş `.message` taşıyan AggregateError artık `'bilinmeyen hata'` yerine gerçek
 * code/alt-hata bilgisini taşır). İkinci deneme başarılıysa hiç log yazılmaz.
 */
/**
 * Heartbeat'e ÖZEL https.Agent (02.10): yükleme sürerken kira yenileme (heartbeat) yüklemeyle aynı
 * bağlantı havuzunu/IPv6 yarışını paylaşmasın. `family: 4` — curl yükleme yolu da `-4` kullanır;
 * ev hattında IPv6/Happy-Eyeballs denemesi 15 sn'lik zaman aşımının kalemini yer. keepAlive kapalı:
 * uyku sonrası ölü soket yeniden kullanılmaz (her tık taze bağlantı).
 */
let _hbAjan = null;
function heartbeatAjani() {
  if (!_hbAjan) _hbAjan = new (require('https').Agent)({ keepAlive: false, family: 4 });
  return _hbAjan;
}

async function heartbeat(auth) {
  const postOnce = () => axios.post(
    joinUrl(CONFIG.apiBase, `agents/${auth.agentId}/heartbeat`),
    // capabilities: sunucu tarafı build_agents.capabilities'i güncel tutar (2026-09-10,
    // pardus eklendi) — enroll'da bir kez yazılıp sonra hiç tazelenmiyordu.
    { heldJobs: currentJob ? [currentJob] : [], capabilities: guncelYetenekler() },
    { headers: agentHeaders(auth), timeout: CONFIG.heartbeatTimeoutMs, validateStatus: () => true,
      httpsAgent: heartbeatAjani() },
  );
  try {
    await postOnce();
  } catch (e) {
    await sleep(CONFIG.heartbeatRetryMs);
    try {
      await postOnce();
    } catch (e2) {
      warn('heartbeat failed (retry too):', agHatasiOzeti(e2));
    }
  }
}

/** Ask the server for a presigned R2 PUT URL for this job's artifact. */
async function presignUpload(auth, job) {
  const res = await axios.post(
    joinUrl(CONFIG.apiBase, `agents/${auth.agentId}/result/presign`),
    { bookId: job.bookId, platform: job.platform },
    { headers: { ...agentHeaders(auth), 'Content-Type': 'application/json' }, timeout: 60000, validateStatus: () => true },
  );
  if (res.status !== 200 || !res.data || !res.data.uploadUrl) {
    throw new Error(`presign failed: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data; // { uploadUrl, r2ObjectKey, publicUrl, contentType }
}

/**
 * ÇOK-PARÇALI YÜKLEME — büyük artifact'ler için (2026-08-05).
 * Tek parça PUT, 1.9GB'lık APK'da ~17 dk sürüyor ve S21'in gateway'i bağlantıyı
 * resetleyince (curl 56) TÜM yükleme baştan başlıyordu. Parçalar kısa ömürlü
 * bağlantılar: reset olursa yalnız o parça yeniden gider.
 * Sunucu eski sürümdeyse (uç 404) çağıran taraf tek-parça yola düşer.
 */
const {
  arsivKaynagi, arsivKoku, ikiOzet, r2Onbellek, r2ArsiveYaz,
} = require('./kaynak-arsivi');
// INDEX ÜRETECİ (02.10): taban/arşiv yoksa r2-kur build'i üreteçle kurar (uretec-kaynak.js).
const uretecKaynak = require('./uretec-kaynak');
const indexUreteci = require('./index-ureteci');
const uyeAtla = require('./uye-atla');
const { icerikKapisiDenetleZip, zipGirisAdlariniOku } = require('./icerik-kapisi');
const { ozetSatiriKur: kokIndexOzetSatiriKur, pardusLogundanCikar } = require('../packaging/kok-index-log-koprusu');
// İÇERİK MERDİVENİ S0/S1 (2026-09-26): kitap içeriği İmpark'ın en son sürümüne — arşiv VE exe
// yolu tek fonksiyondan (EMPP_ARSIV_MERDIVEN=1, varsayılan kapalı). Ayrıntı: icerik-merdiven.js.
const { icerikMerdiveni, merdivenAcik } = require('./icerik-merdiven');
const setEk = require('./set-uyelik-ek');
// sf425 kabuk tazeleme (Z2, 05.10): r2-kur zincirinde set ekinden sonra, panelden önce.
const setKabuk = require('./set-kabuk-tazele');
// Menü kapak garantisi (06.10, 59835): her set kartının kapak dosyası build.zip'te.
const menuKapak = require('./menu-kapak-garanti');
const thumbsOnar = require('./thumbs-onar');
const devamYukleme = require('./devam-yukleme');


const MULTIPART_THRESHOLD = Number(process.env.AGENT_MULTIPART_THRESHOLD || 300 * 1024 * 1024);
const MULTIPART_PART_SIZE = Number(process.env.AGENT_MULTIPART_PART_SIZE || 64 * 1024 * 1024);

async function uploadMultipart(auth, job, artifactPath, size, sha256 = null) {
  const partSize = MULTIPART_PART_SIZE;
  const basliklar = () => ({ ...agentHeaders(auth), 'Content-Type': 'application/json' });
  const govde = (ek = {}) => ({ bookId: job.bookId, platform: job.platform, ...ek });
  const sunucuUc = (ad) => joinUrl(CONFIG.apiBase, `agents/${auth.agentId}/result/${ad}`);

  // presign-multipart: API/Cloudflare 502 dalgaları kısa sürüyor (2026-09-15: günde 15 geçici hata,
  // her biri 10-20 dk'lık derlemeyi baştan yaptırıyordu). 5xx/ağ hatasında bekleyip yeniden dene.
  const baslat = async (partCount) => {
    const PRESIGN_ATTEMPTS = Number(process.env.AGENT_PRESIGN_ATTEMPTS || 5);
    let start = null;
    for (let attempt = 1; attempt <= PRESIGN_ATTEMPTS; attempt++) {
      start = await axios.post(
        sunucuUc('presign-multipart'), govde({ partCount }),
        { headers: basliklar(), timeout: 120000, validateStatus: () => true },
      ).catch((err) => ({ status: 0, data: { error: err.message } }));
      if (!(start.status >= 500 || start.status === 0) || attempt === PRESIGN_ATTEMPTS) break;
      const bekle = Math.min(15000 * attempt, 60000);
      warn(`presign-multipart HTTP ${start.status} (deneme ${attempt}/${PRESIGN_ATTEMPTS}) — ${bekle / 1000} sn sonra tekrar`);
      await sleep(bekle);
    }
    if (start.status === 404) return null;             // eski sunucu → tek parça yola düş
    if (start.status !== 200 || !start.data?.uploadId) {
      throw new Error(`presign-multipart failed: HTTP ${start.status} ${JSON.stringify(start.data)}`);
    }
    return start.data;
  };
  // DEVAM (02.10): R2 ListParts + taze URL'ler. 404 (yükleme yok / eski sunucu) → baştan.
  const durum = async ({ uploadId, r2ObjectKey, partCount }) => {
    const r = await axios.post(
      sunucuUc('multipart-durum'), govde({ uploadId, r2ObjectKey, partCount }),
      { headers: basliklar(), timeout: 120000, validateStatus: () => true },
    );
    if (r.status === 404) return { durum: 'yok' };
    if (r.status !== 200 || !r.data || !Array.isArray(r.data.urls)) {
      throw new Error(`multipart-durum failed: HTTP ${r.status} ${JSON.stringify(r.data)}`);
    }
    return { durum: 'var', parcalar: r.data.parcalar || [], urls: r.data.urls, contentType: r.data.contentType };
  };
  const iptal = async ({ uploadId, r2ObjectKey, bookId, platform }) => {
    const r = await axios.post(
      sunucuUc('abort-multipart'), { ...govde({ uploadId, r2ObjectKey }), ...(bookId ? { bookId, platform } : {}) },
      { headers: basliklar(), timeout: 60000, validateStatus: () => true },
    );
    // 404: uç yok (eski sunucu) ya da yükleme zaten yok → yutulur; 409 (kira yok) çağırana uyarı olur.
    if (r.status !== 200 && r.status !== 404) throw new Error(`abort-multipart: HTTP ${r.status}`);
  };

  // Süresi dolmuş eski kayıtlar R2'de kapatılır (sahipsiz parça birikmesin); en iyi çaba.
  await devamYukleme.eskileriTemizle({
    iptalci: (d) => iptal({ uploadId: d.uploadId, r2ObjectKey: d.r2ObjectKey, bookId: d.bookId, platform: d.platform }),
    warn,
  }).catch((e) => warn('eski yükleme kayıtları temizlenemedi:', agHatasiOzeti(e)));

  const y = await devamYukleme.cokParcaYukle({
    dosya: artifactPath, size, sha256, partSize, kimlik: { kapsam: 'paket', bookId: job.bookId, platform: job.platform },
    istemci: { baslat, durum, iptal }, parcaYukleyici: parcalariYukle, log, warn,
  });
  if (!y) return null;
  const { uploadId, r2ObjectKey, parts } = y;
  log(`artifact R2'de ${y.devamEdildi ? `kaldığı yerden tamamlandı (${y.atlanan} parça atlandı)` : 'yüklendi'} (multipart: ${parts.length}×${(partSize / 1e6).toFixed(0)}MB)`, r2ObjectKey, `${(size / 1e9).toFixed(2)}GB`);

  // complete-multipart: R2/Cloudflare 5xx geçici olabiliyor (2026-08-27: 40 dk'lık noterli build
  // HTTP 502 ile kaybedildi; 2026-09-15: 3×15 sn yetmedi, 502 dalgası ~1 dk sürüyor). Parçalar
  // zaten yüklü ve imzalı URL'ler uzun ömürlü — bu çağrı 8 kez, artan bekleyişle denenir (~6 dk).
  const COMPLETE_ATTEMPTS = Number(process.env.AGENT_COMPLETE_ATTEMPTS || 8);
  let done = null;
  for (let attempt = 1; attempt <= COMPLETE_ATTEMPTS; attempt++) {
    done = await axios.post(
      sunucuUc('complete-multipart'), govde({ uploadId, r2ObjectKey, parts }),
      { headers: basliklar(), timeout: 120000, validateStatus: () => true },
    ).catch((err) => ({ status: 0, data: { error: err.message } }));
    if (done.status === 200) break;
    if (done.status >= 500 || done.status === 0) {
      const bekle = Math.min(15000 * attempt, 60000);
      warn(`complete-multipart HTTP ${done.status} (deneme ${attempt}/${COMPLETE_ATTEMPTS}) — ${attempt < COMPLETE_ATTEMPTS ? `${bekle / 1000} sn sonra tekrar` : 'vazgeçildi'}`);
      if (attempt < COMPLETE_ATTEMPTS) await sleep(bekle);
      continue;
    }
    break; // 4xx: tekrar anlamsız
  }
  if (!done || done.status !== 200) {
    // 4xx = sunucu bu yüklemeyi KABUL ETMİYOR (parça/ETag uyuşmazlığı, kira yok): kayıt devam ettirilemez →
    // R2'de kapat + kaydı sil. 5xx/ağ: parçalar duruyor, kayıt KALIR (sonraki claim yalnız birleştirir).
    if (done && done.status >= 400 && done.status < 500 && done.status !== 409) {
      await iptal({ uploadId, r2ObjectKey }).catch((e) => warn('abort-multipart:', agHatasiOzeti(e)));
      await devamYukleme.durumSil(y.durumYolu);
    }
    throw new Error(`complete-multipart failed: HTTP ${done && done.status} ${JSON.stringify(done && done.data)}`);
  }
  await devamYukleme.durumSil(y.durumYolu);
  log('artifact uploaded to R2 (multipart) — reporting result...');
  return { r2ObjectKey, publicUrl: done.data.publicUrl };
}

/** Yükleme hız sınırı: AGENT_UPLOAD_RATE (curl --limit-rate; örn. 4M). VARSAYILAN SINIRSIZ ('' = sınır yok). */
function yuklemeHizSiniri() {
  return process.env.AGENT_UPLOAD_RATE ?? '';
}

/**
 * curl'ün 403'ü "imza süresi doldu / geçersiz" anlamına gelen çıktısı (--fail: exit 22).
 * Bu durumda parça URL'leri sunucudan yeniden alınır.
 */
const curl403 = (res) => res.code === 22 && /\b403\b/.test(res.stderr || '');

/**
 * Presigned parça URL'lerine dosyayı parça parça PUT eder (dd + curl -4, parça başına 30 deneme).
 * Paket (`uploadMultipart`) ve kaynak build (`kaynak-r2.r2KurYayinla`) AYNI döngüyü kullanır.
 *
 * DEVAM (02.10): `secenek.tamamlanan` ({partNumber: etag}) verilen parçalar ATLANIR (R2'de zaten
 * var); her parça bitince `secenek.kaydet(partNumber, etag)` çağrılır (durum dosyası, devam-yukleme.js);
 * imza süresi dolarsa `secenek.urlYenile()` taze URL listesi döndürür. Parça başına üstel geri çekilme
 * (AGENT_UPLOAD_BACKOFF_MS taban, tavan 120 sn). curl: bağlantı 30 sn, durgunluk (60 sn <1 KB/s) kesilir
 * — uyku sonrası ölü TCP akışı sonsuza asılmaz, yeniden denenir.
 * @returns {Promise<Array<{partNumber: number, etag: string}>>} TÜM parçalar (atlananlar dahil)
 */
async function parcalariYukle(artifactPath, size, partSize, urls, contentType, secenek = {}) {
  const partCount = Math.ceil(size / partSize);
  const rate = yuklemeHizSiniri();
  const partFile = `${artifactPath}.part`;
  const tamamlanan = secenek.tamamlanan || {};
  const parts = [];
  const PART_ATTEMPTS = Number(process.env.AGENT_UPLOAD_PART_ATTEMPTS || 30);
  const TABAN = Number(process.env.AGENT_UPLOAD_BACKOFF_MS || 2000);
  let guncelUrls = urls;
  try {
    for (const { partNumber } of urls) {
      if (tamamlanan[partNumber]) { parts.push({ partNumber, etag: tamamlanan[partNumber] }); continue; }
      const offsetMB = ((partNumber - 1) * partSize) / (1024 * 1024);
      const countMB = Math.ceil(Math.min(partSize, size - (partNumber - 1) * partSize) / (1024 * 1024));
      let etag = null;
      // Kesinti dayanıklılığı: ev/yavaş hat ve gece koşusu — parça başına 30 deneme, üstel bekleme
      // (2 sn → tavan 120 sn). İmza 6 saatlik; 403 gelirse URL'ler sunucudan yenilenir.
      for (let attempt = 1; attempt <= PART_ATTEMPTS && !etag; attempt++) {
        if (stopping) throw new Error('shutting down');
        if (attempt > 1) await sleep(devamYukleme.ustelBekleme(attempt - 2, TABAN, 120000));
        const url = (guncelUrls.find((u) => u.partNumber === partNumber) || {}).url;
        await run('dd', [`if=${artifactPath}`, `of=${partFile}`, 'bs=1M', `skip=${offsetMB}`, `count=${countMB}`, 'status=none']);
        const res = await run('curl', [
          '-sS', '-4', '--fail', '-X', 'PUT', '-D', '-', '-o', curlNullAygiti(),
          '--connect-timeout', '30', '--speed-limit', '1024', '--speed-time', '60',
          '-H', `Content-Type: ${contentType || 'application/octet-stream'}`,
          '--upload-file', partFile,
          ...(rate ? ['--limit-rate', rate] : []),
          url,
        ]);
        if (res.code === 0) {
          const m = res.stdout.match(/^etag:\s*"?([^"\r\n]+)"?/im);
          if (m) etag = `"${m[1]}"`;
          else warn(`part ${partNumber}: ETag başlığı yok, yeniden denenecek`);
        } else {
          warn(`part ${partNumber} attempt ${attempt} failed: curl exit ${res.code} ${res.stderr.slice(-120)}`);
          if (curl403(res) && typeof secenek.urlYenile === 'function') {
            try {
              guncelUrls = await secenek.urlYenile();
              log(`  parça ${partNumber}: imza reddedildi (403) — URL'ler sunucudan yenilendi`);
            } catch (e) {
              warn(`URL yenilenemedi: ${agHatasiOzeti(e)}`);
            }
          }
        }
      }
      if (!etag) throw new Error(`part ${partNumber} could not be uploaded`);
      parts.push({ partNumber, etag });
      if (typeof secenek.kaydet === 'function') await secenek.kaydet(partNumber, etag);
      if (partNumber % 5 === 0 || partNumber === partCount) log(`  parça ${partNumber}/${partCount} yüklendi`);
    }
  } finally {
    await fsp.rm(partFile, { force: true }).catch(() => {});
  }
  return parts;
}

async function postResultSuccess(auth, job, artifactPath) {
  // Presigned R2 PUT: upload the (possibly multi-GB) artifact STRAIGHT to R2,
  // bypassing the Cloudflare edge body-size limit (~100MB) that 413s large APKs.
  // The server then settles the job from the JSON /result body (Decision A path).
  const size = fs.statSync(artifactPath).size;

  // ARTEFAKT KANITI (2026-09-26): R2'ye yüklemeden ÖNCE sha256+boyut akışla hesaplanır
  // (bkz. artefakt-kaniti.js — bellek şişirmeden, 1+ GB dosyalarda tek geçiş). Sonuç
  // `/result` gövdesine fileSha256/fileSizeBytes olarak eklenir; book-update DB'ye
  // yazar, `tests/e2e/paket-denetle.js` bunu CDN nesnesiyle karşılaştırıp "CDN'deki
  // paket bizim ürettiğimiz mi" (T2) sorusunu cevaplar. Hesap hatası (silinmiş/
  // okunamayan dosya) yüklemeyi DURDURMAZ — kanıtsız devam eder ama SESSİZCE
  // yutulmaz: warn ile loglanır ve alanlar gövdeye hiç eklenmez.
  let kanit = null;
  try {
    const oz = await artefaktOzeti(artifactPath);
    kanit = { fileSha256: oz.sha256, fileSizeBytes: oz.boyut };
    log(`artefakt kanıtı: sha256=${oz.sha256} boyut=${oz.boyut}`);
  } catch (e) {
    warn('artefakt sha256 hesaplanamadı — kanıtsız yüklenecek:', agHatasiOzeti(e));
  }

  // Upload via curl, NOT axios: S21's gateway RESETS large sustained HTTPS transfers
  // (a 3.15GB axios PUT died with ECONNRESET ~2 min in — the same shaper that resets
  // big downloads, now outbound). A steady --limit-rate slips under it; on a reset we
  // re-presign (1h expiry, but stay safe) and retry the whole PUT. curl --upload-file
  // sets Content-Length (R2 rejects chunked) and PUTs; the SIGNED Content-Type header
  // must be sent verbatim. Empty AGENT_UPLOAD_RATE disables the throttle.
  // Büyük artifact → çok parçalı (reset dayanıklı). Sunucu desteklemiyorsa null döner.
  let presigned = null;
  if (size >= MULTIPART_THRESHOLD) {
    presigned = await uploadMultipart(auth, job, artifactPath, size, kanit ? kanit.fileSha256 : null);
  }

  const rate = yuklemeHizSiniri();
  const retryMax = Math.max(3600, Math.floor(CONFIG.packageTimeoutMs / 1000));
  const MAX = Number(process.env.AGENT_UPLOAD_MAX_ATTEMPTS || 6);
  for (let attempt = 1; presigned === null && attempt <= MAX; attempt++) {
    if (stopping) throw new Error('shutting down');
    presigned = await presignUpload(auth, job); // fresh URL each attempt
    log(`uploading artifact to R2 (presigned${rate ? `, ${rate}` : ''})...`, presigned.r2ObjectKey, `${(size / 1e9).toFixed(2)}GB (attempt ${attempt})`);
    const res = await run('curl', [
      '-sS', '-4', '--fail', '-X', 'PUT',
      '-H', `Content-Type: ${presigned.contentType || 'application/octet-stream'}`,
      '--upload-file', artifactPath,
      '--retry', '2', '--retry-delay', '5', '--retry-all-errors',
      '--retry-max-time', String(retryMax),
      ...(rate ? ['--limit-rate', rate] : []),
      presigned.uploadUrl,
    ]);
    if (res.code === 0) {
      log(`artifact uploaded to R2 (attempt ${attempt}) — reporting result...`);
      break;
    }
    warn(`R2 PUT attempt ${attempt} failed: curl exit ${res.code} ${res.stderr.slice(-160)}`);
    if (attempt === MAX) throw new Error(`R2 PUT failed after ${MAX} attempts (last curl exit ${res.code})`);
    await sleep(backoffMs(attempt, 5000, 60000));
  }
  const res = await axios.post(
    joinUrl(CONFIG.apiBase, `agents/${auth.agentId}/result`),
    {
      bookId: job.bookId,
      platform: job.platform,
      status: 'completed',
      buildMethod: 'build',
      r2ObjectKey: presigned.r2ObjectKey,
      publicUrl: presigned.publicUrl,
      ...(kanit || {}),
      // KANONİK SÜRÜM (motor sha12/durum + kabuk sürüm/durum): paketleyici paket.json'a damgaladı,
      // poll sonucuyla job.kanonikSurum'a indi. Yoksa/boşsa alanlar HİÇ gönderilmez (sunucu null yazar).
      ...kanonikGovdeAlanlari(job.kanonikSurum),
      // PAKET İÇERİK ÜYELERİ (05.10): paketleyiciye giden son build zip'inin menüsünden [{id, vs, kitap}]
      // (processJob `job.icerikUyeleri`'ni doldurur). Ölçülemediyse alanlar HİÇ gönderilmez.
      ...icerikUyeleri.govdeAlanlari({ uyeler: job.icerikUyeleri }),
      // İÇERİK SÜRÜMLERİ (Dalga B, B4): paketin içerdiği kitap içerik sürümleri [{id, vs}] — merdiven
      // kanıtından (processJob `job.icerikSurumleri`'ni doldurur; claim alanı DEĞİL). Sunucu Dalga A/B
      // karşılaştırması için. Ölçüm yoksa (merdiven kapalı, manuel/r2-al) alan hiç gönderilmez.
      ...(Array.isArray(job.icerikSurumleri) && job.icerikSurumleri.length
        ? { icerikSurumleri: job.icerikSurumleri } : {}),
      // KAYNAK SÜRÜMÜ (Dalga B, B2 madde 6): claim'deki build sürümü gövdenin kökünde — sunucunun
      // bellek içi claim eşliği API yeniden başlayınca kaybolur; beyan varsa sürüm paritesi yine çalışır.
      ...(typeof job.kaynakSurumu === 'string' && job.kaynakSurumu ? { kaynakSurumu: job.kaynakSurumu } : {}),
      // SF425 KABUK TAZELEME özeti (Z2, 05.10): yalnız adım koştuysa {durum, neden}. Sunucu şeması
      // (zod, strict değil) bilinmeyen alanı atar; book-update kaydetmek isterse alan hazır.
      ...kabukTazelemeGovdesi(job.kabukTazeleme),
      // İÇERİKSİZ ÜYE ATLAMA (Nadir 06.10): atlanan üyeler + tek satır not (yeni DB sütunu yok; sunucu
      // bilinmeyen alanı atar, ajan günlüğü/sonuç notu için).
      ...uyeAtla.govdeAlanlari(job.atlananUyeler),
    },
    { headers: { ...agentHeaders(auth), 'Content-Type': 'application/json' }, timeout: 60000, validateStatus: () => true },
  );
  if (res.status !== 200) {
    throw new Error(`result(completed) rejected: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  // Sunucu kaynak paritesi: claim bayatsa tamamlanır AMA yeniden kuyruğa alınır → çağıran (imza bekçisi)
  // kaydı `yayinlandi` DEĞİL bayat saymalı (04.10).
  const yk = res.data && res.data.yenidenKuyruk;
  return { r2ObjectKey: presigned.r2ObjectKey, publicUrl: presigned.publicUrl, ...(yk ? { yenidenKuyruk: yk } : {}) };
}

/** /result gövdesinin kabuk tazeleme alanı: `{kabukTazeleme: {durum, neden}}` ya da {}. SAF. */
function kabukTazelemeGovdesi(o) {
  if (!o || typeof o !== 'object' || typeof o.durum !== 'string') return {};
  return { kabukTazeleme: { durum: o.durum, neden: o.neden == null ? null : String(o.neden).slice(0, 300) } };
}

async function postResultFailure(auth, job, errorMessage) {
  await postResultFailureYanit(auth, job, errorMessage);
}

/**
 * `postResultFailure`'ın sonucu bildiren hâli (05.10, kabul işçisi): sunucu kabul ettiyse (2xx) ok.
 * FIRLATMAZ. Kabul işçisi kaydı YALNIZ ok:true ise taşır (yoksa satır running + lease NULL kalırdı).
 * @returns {Promise<{ok:boolean, status:number|null}>}
 */
async function postResultFailureYanit(auth, job, errorMessage) {
  try {
    const res = await axios.post(
      joinUrl(CONFIG.apiBase, `agents/${auth.agentId}/result`),
      {
        bookId: job.bookId,
        platform: job.platform,
        status: 'failed',
        error: String(errorMessage).slice(0, 2000),
      },
      { headers: { ...agentHeaders(auth), 'Content-Type': 'application/json' }, timeout: 30000, validateStatus: () => true },
    );
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (e) {
    errlog('could not report failure for', job.bookId, job.platform, '-', agHatasiOzeti(e));
    return { ok: false, status: null };
  }
}

// ---------------------------------------------------------------------------
// Download + extract.
// ---------------------------------------------------------------------------
/**
 * Robust resumable download via `curl -C -` for an UNSTABLE link. S21's path to the
 * publisher truncates/resets large transfers; curl resumes from the bytes already on
 * disk (correct Range offset), retries every error, aborts stalls early to force a
 * retry, and stops EXACTLY at Content-Length — so it neither truncates nor oversizes.
 * (A hand-rolled axios resume mis-offset and produced oversized files on this link.)
 * The final byte count is asserted against the server total so a corrupt file never
 * reaches extraction. The slow link is paid once (then cached).
 */
async function downloadFile(url, destPath) {
  // EXE'SİZ SÖZLEŞME (Nadir 01.10): yolu .exe ile biten adres HİÇBİR koşulda indirilmez — son
  // emniyet (processJob bu fonksiyonu zaten çağırmaz; ısıtıcı kapıyla kapalı).
  if (exeYoluMu(url)) {
    throw new Error(`exe'siz sözleşme: İmpark exe'si indirilmez (${path.basename(String(url).split('?')[0])})`);
  }
  const retryMax = Math.max(3600, Math.floor(CONFIG.packageTimeoutMs / 1000));
  // Throttle: S21's gateway (10.0.0.2) resets LARGE/fast sustained HTTPS transfers
  // (0% packet loss, MTU 1500 ok — a session/shaper reset, not the link). A steady
  // modest rate (--limit-rate) slips under it. Empty AGENT_DOWNLOAD_RATE disables.
  const rate = process.env.AGENT_DOWNLOAD_RATE ?? '2M';
  const MAX = Number(process.env.AGENT_DOWNLOAD_MAX_ATTEMPTS || 12);

  // This URL is served INCONSISTENTLY: the SAME url intermittently returns the valid
  // ~1.42GB SFX OR a corrupt ~2.1GB object — and BOTH the HEAD and GET can agree on the
  // wrong size, so a byte-count check is not enough. The only reliable discriminator is
  // whether the download is a VALID archive (7z can list it; the bad one fails with
  // "Missing volume"). Retry the whole fetch until a listable archive lands, so a
  // corrupt object never reaches extraction/build.
  for (let attempt = 1; attempt <= MAX; attempt++) {
    if (stopping) throw new Error('shutting down');
    await fsp.rm(destPath, { force: true }).catch(() => {});
    // Steady throttled pass.
    // NO -C - : resume on this server appends the FULL file after a reset (origin
    // mis-answers the Range) → oversized/corrupt. Each attempt is a FRESH download;
    // the throttle prevents most resets, and an invalid result is caught + retried.
    //
    // DURGUNLUK KAPISI (2026-09-15, ölçüldü): Mac uykuya girip uyanınca TCP akışı
    // ölüyor ama bağlantı KOPMUYOR — curl sonsuza kadar bekliyor. Ölçüm: 45485'in
    // indirmesi 19:10'da başladı, iki uyku sonrası dosya 19.210.240 baytta ÇAKILDI,
    // 40 dk boyunca tek bayt gelmedi, ajan kirayı uzatıp partiyi durdurdu (pid 24960
    // elle öldürülünce hat açıldı). `--retry*` bunu yakalamaz: yeniden deneme için
    // isteğin BİTMESİ gerekir, asılı transfer hiç bitmez.
    // Eski yorum "--speed-time YASAK" diyordu; gerekçesi `-C -` ile bozuk devam
    // almaktı — `-C -` artık KULLANILMIYOR (her deneme sıfırdan), dolayısıyla yasak
    // düştü. 120 sn boyunca 1 KB/s altına inen transfer kesilir ve temiz yeniden
    // deneme başlar. Eşik, evdeki 4M kısıtın bile çok altında: yanlış kesme yapmaz.
    const res = await run('curl', [
      '-sS', '-4', '-L', '--fail',
      '--retry', '300', '--retry-delay', '3', '--retry-all-errors',
      '--retry-max-time', String(retryMax),
      '--speed-limit', '1024', '--speed-time', '120',
      ...(rate ? ['--limit-rate', rate] : []),
      '-o', destPath,
      url,
    ]);
    const size = (await fsp.stat(destPath).catch(() => ({ size: 0 }))).size;

    if (res.code !== 0 && size === 0) {
      warn(`download attempt ${attempt}: curl exit ${res.code}, empty — retrying`);
      await sleep(backoffMs(attempt, 3000, 30000));
      continue;
    }
    // Validate: is it a listable archive? (bad object → "Missing volume".)
    // unrar ile doğrula — çıkarımı da o yapıyor. Yoksa 7z'ye düş.
    const chk = (await commandExists('unrar'))
      ? await run('unrar', ['l', '-p-', destPath])
      : await run('7z', ['l', destPath]);
    if (isValidArchiveOutput(chk.code, chk.stdout, chk.stderr)) {
      log(`download ok: ${(size / 1e6).toFixed(0)}MB, valid archive (attempt ${attempt})`);
      return;
    }
    warn(`download attempt ${attempt}: ${(size / 1e6).toFixed(0)}MB but NOT a valid archive — server served a bad object, retrying`);
    await sleep(backoffMs(attempt, 3000, 30000));
  }
  throw new Error(`download failed after ${MAX} attempts (server kept serving a corrupt object)`);
}

/**
 * İndirilen SFX kaynağı GERÇEKTEN bozuk mu?
 *
 * İKİ KEZ YANLIŞ KURULDU (2026-08-05, ~10GB boşuna indirme + 4.5 saat):
 *   1. `/ERROR/i` deseni arşivin İÇİNDEKİ dosya adlarına takılıyordu
 *      (`errors.js`, `XMLDOMErrorHandler.js`).
 *   2. Araç yanlıştı: bu paketler WinRAR SFX; `7z l` onları "Type = PE" görüp
 *      "WARNING = Checksum error" ile ÇIKIŞ KODU 2 veriyor — bilinen SAĞLAM
 *      dosyada bile. Yani hiçbir kitap kapıdan geçemiyordu.
 *
 * Doğru ölçüt, çıkarımda kullanılan aracın (unrar) listesi:
 *   - kesik dosya  → "Unexpected end of archive"   (bizim gerçek arıza biçimimiz)
 *   - sağlam dosya → dosya tablosu listelenir
 * unrar'ın ÇIKIŞ KODU ayırt edici DEĞİL (sağlamda 3, kesikte 1) — kullanma.
 * Test için dışa açık.
 */
function isValidArchiveOutput(code, stdout, stderr) {
  const text = `${stdout}\n${stderr}`;
  // Kesinlikle bozuk: kesilmiş arşiv ya da hiç açılamayan dosya.
  const fatal = [
    /Unexpected end of archive/i,
    /Missing volume/i,
    /Can not open (the )?file as archive/i,
    /^\s*Cannot open/im,
    /is not RAR archive/i,
  ];
  if (fatal.some((re) => re.test(text))) return false;
  // Sağlamlık kanıtı: listede en az bir dosya satırı olmalı (unrar tablo satırı
  // ya da 7z listesi). Boş/anlamsız çıktı kabul edilmez.
  return /\.\.A\.\.\.\.|resources\/app|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text);
}

/** Extract a WinRAR SFX exe (unrar first, 7z fallback) — mirrors book-update extractor. */
async function extractSfx(filePath, outputDir) {
  await fsp.mkdir(outputDir, { recursive: true });
  if (await commandExists('unrar')) {
    const res = await run('unrar', ['x', '-o+', '-y', filePath, `${outputDir}/`]);
    if (res.code === 0) return;
    warn('unrar failed, trying 7z:', res.stderr.slice(-300));
  }
  if (await commandExists('7z')) {
    const res = await run('7z', ['x', '-y', `-o${outputDir}`, filePath]);
    if (res.code === 0) return;
    warn('7z failed:', res.stderr.slice(-300));
  } else if (await commandExists('7za')) {
    const res = await run('7za', ['x', '-y', `-o${outputDir}`, filePath]);
    if (res.code === 0) return;
    warn('7za failed:', res.stderr.slice(-300));
  }
  throw new Error('extraction failed: install `unrar` (brew install unrar) or `7z` (brew install p7zip) on the build agent');
}

/** Find the `resources/app/build` directory inside an extracted SFX tree. */
async function findBuildDir(root) {
  const direct = path.join(root, 'resources', 'app', 'build');
  try {
    const st = await fsp.stat(direct);
    if (st.isDirectory()) return direct;
  } catch (_) { /* fall through to recursive search */ }

  // Recursive search (extraction may add one wrapper dir).
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (full.endsWith(path.join('resources', 'app', 'build'))) return full;
      // Limit depth implicitly by tree shape; push children for breadth.
      stack.push(full);
    }
  }
  throw new Error('resources/app/build not found in extracted package');
}

/** Zip a directory's CONTENTS into outZip. */
function zipDir(srcDir, outZip) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outZip);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize();
  });
}

// ---------------------------------------------------------------------------
// LOCAL packager HTTP API.
// ---------------------------------------------------------------------------
async function packagerUploadBuild(zipPath, appName, appVersion) {
  const form = new FormData();
  // Packager expects the multipart field name `files` (array).
  form.append('files', fs.createReadStream(zipPath), path.basename(zipPath));
  if (appName) form.append('appName', appName);
  if (appVersion) form.append('appVersion', appVersion);
  const res = await axios.post(joinUrl(CONFIG.packagerApi, 'api/upload-build'), form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: CONFIG.packageTimeoutMs,
    validateStatus: () => true,
  });
  if (res.status !== 200 || !res.data || !res.data.sessionId) {
    throw new Error(`packager upload-build failed: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data.sessionId;
}

// Yayinciya gore logoId (paketleyicideki kayitli logolardan). Hata = logo yok, is surer.
async function packagerLogoIdFor(publisherName) {
  try {
    const res = await axios.get(joinUrl(CONFIG.packagerApi, 'api/logos'), { timeout: 15000, validateStatus: () => true });
    const id = res.status === 200 ? pickLogoId(res.data, publisherName) : null;
    if (id) log('logo:', publisherName, '->', id); else warn('logo bulunamadi, varsayilan ikon:', publisherName || '(yayinci yok)');
    return id;
  } catch (e) { warn('logo listesi alinamadi:', agHatasiOzeti(e)); return null; }
}

async function packagerStartPackage(sessionId, packagerPlatform, appName, appVersion, logoId, setKimligi, guncellemeTabani, surum) {
  const res = await axios.post(
    joinUrl(CONFIG.packagerApi, 'api/package'),
    {
      sessionId, platforms: [packagerPlatform], appName, appVersion,
      // Üretim ajanı işi: kanonik kabuk/motor yoksa paketleme DÜŞER (src/packaging/kanonik-sart.js).
      kanonikSart: true,
      ...(logoId ? { logoId } : {}),
      // SET güncelleme kanalı (2026-09-23): claim'den geldiyse packagingService'e
      // AYNI istekte iletilir — packager TÜM yamalardan sonra guncelleme paketini
      // (surum.json/manifest.json/dosya/…) bu jobId altında üretir (parça 1/3,
      // bkz. kitap-guncelleme-sozlesmesi.md). İkisi de yoksa alan hiç gönderilmez.
      ...(setKimligi ? { setKimligi } : {}),
      ...(guncellemeTabani ? { guncellemeTabani } : {}),
      // Paketin G sürümü (claim `surum`, G3; madde 3): empp-set.json → monoton taban.
      // appVersion'dan AYRI alan — electron-builder/Capacitor sürümü DEĞİŞMEZ.
      ...(surum ? { surum } : {}),
    },
    { timeout: 60000, validateStatus: () => true },
  );
  if (res.status !== 200 || !res.data || !res.data.jobId) {
    throw new Error(`packager package failed: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data.jobId;
}

async function packagerPoll(jobId, packagerPlatform) {
  const deadline = Date.now() + CONFIG.packageTimeoutMs;
  let ardisikHata = 0;
  while (Date.now() < deadline) {
    if (stopping) throw new Error('shutting down');
    let res;
    try {
      res = await axios.get(joinUrl(CONFIG.packagerApi, `api/package-status/${jobId}`), {
        timeout: 30000,
        validateStatus: () => true,
      });
      ardisikHata = 0;
    } catch (e) {
      // 27.09: tek bir takılan durum cevabı (makine yükü) işi `failed` yazdırıyordu —
      // paket o sırada başarıyla bitiyordu. Geçici hatada aynı yoklamada yeniden sor.
      ardisikHata += 1;
      if (!yoklamaYenidenDenenir(e, ardisikHata)) throw e;
      warn(`paketleyici durum yoklaması düştü (${ardisikHata}. ardışık, iş ${jobId}) — geçici, yeniden soruluyor:`,
        agHatasiOzeti(e));
      await sleep(CONFIG.packagerPollMs);
      continue;
    }
    if (res.status === 200) {
      const status = packageStatusOf(res.data);
      if (isTerminalStatus(status)) {
        if (status === 'failed') {
          const msg = (res.data && res.data.job && res.data.job.error) || 'packager reported failed';
          throw new Error(`packager job failed: ${msg}`);
        }
        // status === 'completed' — ama paketleyicide bu SADECE dış try/catch'in
        // fırlatmadığı anlamına gelir. Platform-bazlı build hatası packagingService
        // içinde KENDİ try/catch'inde yutulur ve job.results[platform] = {success:false,
        // error} olarak saklanır; job.status yine 'completed' kalır (2026-09-08 teşhis:
        // Android "Gradle build failed: ... Java heap space" tam olarak buradan sızdı).
        // İndirmeye HİÇ gitmeden bu platform için gerçekten paket olduğunu doğrula —
        // yoksa curl 404 (exit 22) gerçek nedeni gizler.
        const verdict = packagerResultOf(res.data, packagerPlatform);
        if (!verdict.ok) {
          throw new Error(`packager job completed without a usable package: ${verdict.message}`);
        }
        // job.results taşır (bkz. packagingService.js `results.kokIndexDenetimi`) — kök
        // index denetiminin 'uyar' sonucunu agent.log'a bastırmak için çağırana döner
        // (kok-index-log-koprusu.js). Var olan davranışa dokunmaz, yalnız ek bilgi taşır.
        return (res.data && res.data.job && res.data.job.results) || null; // completed + doğrulandı
      }
    }
    await sleep(CONFIG.packagerPollMs);
  }
  throw new Error('packager job timed out');
}

/**
 * Download the built artifact from the LOCAL packager. This is NOT the flaky publisher
 * source (WAN link, inconsistent bodies) — it's a localhost transfer of a file WE just
 * built, so it must NOT reuse downloadFile's WAN hardening:
 *   - NO --limit-rate throttle: localhost has no gateway shaper; throttling a multi-GB
 *     APK to 2MB/s wastes ~25 min per build for nothing.
 *   - NO `7z l` validity gate: a Gradle/Capacitor APK is a large ZIP64 archive with an
 *     APK Signing Block, which p7zip's `7z l` mis-parses and reports as "ERROR"/invalid
 *     — a FALSE negative that loops the download forever. Validate ZIP-family artifacts
 *     with `unzip -l` (ZIP64-aware) instead; for non-zip artifacts (.dmg) trust curl's
 *     completion (a truncated chunked stream makes curl exit non-zero) plus a size floor.
 */
/**
 * A `.apk` must be an INSTALLABLE Android package, not just a valid zip.
 * The packager used to fall back to zipping the web folder when the Gradle build
 * failed and return it as `.apk`; it passed every zip check and shipped to R2
 * (45695: 3.15GB of `webapp/` files, uninstallable). Gate on the two markers no
 * real APK can lack. Exported for tests.
 */
function looksLikeRealApk(unzipListing) {
  const missing = ['AndroidManifest.xml', 'classes.dex'].filter(marker => {
    const re = new RegExp(`(^|/|\\s)${marker.replace('.', '\\.')}\\s*$`, 'm');
    return !re.test(unzipListing);
  });
  return { ok: missing.length === 0, missing };
}

async function downloadArtifact(url, destPath) {
  await fsp.rm(destPath, { force: true }).catch(() => {});
  const res = await run('curl', [
    '-sS', '-4', '-L', '--fail',
    '--retry', '5', '--retry-delay', '2', '--retry-all-errors',
    '-o', destPath, url,
  ]);
  const size = (await fsp.stat(destPath).catch(() => ({ size: 0 }))).size;
  if (res.code !== 0) throw new Error(`artifact download failed: curl exit ${res.code} (${res.stderr.slice(-200)})`);
  if (size < 1_000_000) throw new Error(`artifact suspiciously small: ${size} bytes`);
  if (/\.(apk|zip)$/i.test(destPath)) {
    const chk = await run('unzip', ['-l', destPath]);
    if (chk.code !== 0) {
      throw new Error(`artifact not a valid zip (unzip -l exit ${chk.code}): ${chk.stderr.slice(-200)}`);
    }
    if (/\.apk$/i.test(destPath)) {
      const verdict = looksLikeRealApk(chk.stdout);
      if (!verdict.ok) {
        throw new Error(
          `NOT A REAL APK — missing ${verdict.missing.join(', ')}. The Capacitor/Gradle ` +
          'build almost certainly failed and a non-APK archive was produced. Refusing to ' +
          'upload: this file cannot be installed on a device.'
        );
      }
    }
  }
  log(`artifact downloaded: ${(size / 1e6).toFixed(0)}MB (valid)`);
}

/**
 * Bir önceki `packagerPoll` doğrulaması indirmeye izin verdikten SONRA paketleyici
 * durumu değişmişse (yarış durumu) diye ikinci savunma hattı: 404 (curl exit 22)
 * tek başına teşhis için yetersizdi (2026-09-08) — varsa paketleyicinin gerçek
 * hatasını mesaja ekle.
 */
async function packagerErrorSnapshot(jobId, packagerPlatform) {
  const res = await axios.get(joinUrl(CONFIG.packagerApi, `api/package-status/${jobId}`), {
    timeout: 15000,
    validateStatus: () => true,
  });
  if (res.status !== 200) return '';
  const verdict = packagerResultOf(res.data, packagerPlatform);
  return verdict.ok ? '' : verdict.message;
}

async function packagerDownload(jobId, packagerPlatform, destPath) {
  try {
    await downloadArtifact(joinUrl(CONFIG.packagerApi, `api/download/${jobId}/${packagerPlatform}`), destPath);
  } catch (e) {
    const extra = await packagerErrorSnapshot(jobId, packagerPlatform).catch(() => '');
    throw new Error(extra ? `${e.message} — packager: ${extra}` : e.message);
  }
}

/**
 * Paket R2'ye yüklendikten sonra packager'daki yerel kopyayı bırakır.
 *
 * Packager `DELETE /api/delete-job/:jobId` ile hem temp hem output klasörünü
 * siler, ama bunu çağıran kimse yoktu: her üretim output/ altında 1-3 GB
 * bırakıyor, hiç silinmiyordu (2026-08-18: 119 paket / 118 GB).
 *
 * Asla fırlatmaz — temizlik başarısız olsa bile iş BAŞARILI sayılır; artifact
 * zaten R2'de. Eski packager sürümünde uç yoksa (404) sessizce geçilir.
 */
async function packagerReleaseJob(jobId) {
  if (!jobId) return false;
  try {
    const res = await axios.delete(joinUrl(CONFIG.packagerApi, `api/delete-job/${jobId}`), {
      timeout: 60000,
      validateStatus: () => true
    });
    if (res.status === 200) {
      log('packager output released:', jobId);
      return true;
    }
    if (res.status === 404) {
      warn('packager delete-job desteklenmiyor (404) — output elde temizlenmeli');
      return false;
    }
    warn(`packager delete-job HTTP ${res.status} — output bırakılamadı`);
    return false;
  } catch (e) {
    warn('packager delete-job hatası (iş yine de başarılı):', agHatasiOzeti(e));
    return false;
  }
}

// ---------------------------------------------------------------------------
// SET güncelleme (G) kanalı: runner G set dosyalarını HİÇBİR YERE yüklemez (Şef kararı, Nadir
// onayı 2026-09-26). G manifestlerinin tek yazarı `g-yayin` aracıdır (tools/g-yayin/yayinla.js,
// Anahtar Zinciri imzası); paketleyicinin guncelleme.tar.gz'si `guncelleme/` yoluna yüklenirse G
// durumunu siler. Runner, g-yayin'in ilk manifesti (`--ilk`) için kök index.html'in yolu +
// sha256'sını ve paket sürümünü Windows iş kanıtına yazar (windows-serit.js). 2026-09-23 tarihli
// yükleme yolu (parça 3/3: tar indir → presign → PUT → surum.json doğrula) bu yüzden
// kaldırıldı; paketleyici setKimligi + guncellemeTabani'yi yine alır (G istemcisi pakete girer).
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// macOS signing + notarization — NOTER KAPISI (2026-09-26).
//
// Eskiden best-effort'tu: codesign/notarytool/stapler düşünce uyarı basıp onaysız
// DMG'yi R2'ye yüklüyordu (26.09 06:11/06:14 UTC — 59834 ve 73768 mac, "No Keychain
// password item found for profile: empp-notary"). Artık herhangi bir adım düşerse
// artifact YÜKLENMEZ; iş "noter onayı alınamadı — DMG yüklenmedi: <ilk satır>" ile
// düşer. Geçici sınıf (anahtarlık kilitli/öğe yok, ağ, zaman aşımı, 5xx, CloudKit
// yayılma yarışı) `[ertelenebilir-noter]` işareti taşır → ana döngü `failed` YAZMAZ,
// kira dolunca iş kuyruğa döner. Apple "Invalid"/ret ve imza hatası KALICIDIR.
// Sınıflandırma: runner-helpers.js `noterHatasi` (saf, testli).
// `AGENT_NOTER_ZORUNLU=0` eski best-effort davranışı geri getirir (acil anahtar).
// ---------------------------------------------------------------------------
function noterKapisi(asama, res, eskiUyari) {
  const e = noterHatasi(asama, res);
  if (!CONFIG.noterZorunlu) {
    warn(eskiUyari, agStapleCikti(res));
    return null;
  }
  warn(e.message);
  throw e;
}

async function signAndNotarizeMac(dmgPath) {
  if (!CONFIG.signIdentity) {
    return noterKapisi('yapilandirma', { code: null, stdout: 'APPLE_SIGN_IDENTITY tanımlı değil', stderr: '' },
      'APPLE_SIGN_IDENTITY not set — skipping codesign/notarize (dmg shipped unsigned)');
  }
  // codesign the .dmg.
  log('codesign:', dmgPath);
  const signArgs = ['--force', '--sign', CONFIG.signIdentity, '--timestamp'];
  if (CONFIG.teamId) signArgs.push('--options', 'runtime');
  signArgs.push(dmgPath);
  const sign = await run('codesign', signArgs);
  if (sign.code !== 0) {
    return noterKapisi('codesign', sign, 'codesign failed (continuing unsigned):');
  }

  // notarize: prefer a stored keychain profile; else Apple ID + app-specific password.
  let notaryArgs = null;
  if (CONFIG.notaryProfile) {
    notaryArgs = ['notarytool', 'submit', dmgPath, '--keychain-profile', CONFIG.notaryProfile, '--wait'];
  } else if (CONFIG.appleId && CONFIG.applePassword && CONFIG.teamId) {
    notaryArgs = [
      'notarytool', 'submit', dmgPath,
      '--apple-id', CONFIG.appleId,
      '--password', CONFIG.applePassword,
      '--team-id', CONFIG.teamId,
      '--wait',
    ];
  } else {
    return noterKapisi('yapilandirma', {
      code: null, stdout: 'notarytool kimliği yok (APPLE_NOTARY_PROFILE ya da APPLE_ID+APPLE_PASSWORD+APPLE_TEAM_ID)', stderr: '',
    }, 'no notarytool credentials (APPLE_NOTARY_PROFILE or APPLE_ID+APPLE_PASSWORD+APPLE_TEAM_ID) — skipping notarization');
  }
  log('notarytool submit:', dmgPath);
  const notar = await run('xcrun', notaryArgs);
  // `--wait` Apple "Invalid" sonucunda da rc=0 dönebilir — durum satırı ayrıca denetlenir.
  const notarCikti = `${notar.stdout || ''}\n${notar.stderr || ''}`;
  if (notar.code !== 0 || /status:\s*(Invalid|Rejected)\b/i.test(notarCikti)) {
    return noterKapisi('notarytool', notar, 'notarytool failed (continuing without staple):');
  }

  // STAPLE RETRY + GÖRÜNÜR HATA (2026-09-21, ölçümle — 8/8 mac işi 2026-09-18'den beri
  // ilk denemede düşüyordu, hepsi "stapler failed: " BOŞ mesajla):
  //
  // 1) BOŞ MESAJ SEBEBİ: `xcrun stapler` TÜM tanı çıktısını (CloudKit sorgusu, hata
  //    detayı) stdout'a yazar, stderr HER ZAMAN boştur — gerçek `xcrun stapler staple`
  //    ile doğrulandı. Eski kod yalnız `staple.stderr`yi okuyordu (Silent Catch Gate
  //    ihlali). Artık her iki akış da loglanır (agStapleCikti).
  // 2) GERÇEK ARIZA — YARIŞ DURUMU: notarytool --wait "Accepted" dönse bile Apple'ın
  //    CloudKit ticket-delivery veritabanına yayılması az gecikmelidir; ilk staple
  //    denemesi "CloudKit query ... failed due to Record not found" (Error 65) ile
  //    düşebilir. Dokümante edilmiş, Apple-taraflı bilinen davranış (Apple Developer
  //    Forums thread 115670/123806, electron/notarize#120) — kod/kimlik kusuru DEĞİL.
  //    Çözüm: kısa bekleyip yeniden dene (varsayılan 4 deneme, 20/40/60 sn artan bekleme).
  let staple = null;
  let stapleDeneme = 0;
  const maxDeneme = Math.max(1, CONFIG.stapleRetryMax);
  for (stapleDeneme = 1; stapleDeneme <= maxDeneme; stapleDeneme++) {
    staple = await run('xcrun', ['stapler', 'staple', dmgPath]);
    if (staple.code === 0) break;
    if (stapleDeneme < maxDeneme) {
      const gecikmeMs = CONFIG.stapleRetryDelayMs * stapleDeneme;
      warn(`stapler denemesi ${stapleDeneme}/${maxDeneme} başarısız (${gecikmeMs} ms sonra tekrar):`,
        agStapleCikti(staple));
      await sleep(gecikmeMs);
    }
  }
  if (!staple || staple.code !== 0) {
    // 2026-09-26: staple yapılamayan DMG de YÜKLENMEZ (Nadir kuralı). CloudKit yayılma
    // yarışı ("Record not found") geçici sınıftadır → iş ertelenir, `failed` yazılmaz.
    // Kapı kapalıysa (AGENT_NOTER_ZORUNLU=0) eski görünür işaretle devam edilir.
    return noterKapisi('stapler', staple,
      `${STAPLE_KAPISI_ISARETI} stapler ${maxDeneme} denemede de başarısız (paket NOTARIZE edildi, yalnız çevrimdışı ilk açılış riskli):`);
  }
  log('notarized + stapled:', dmgPath, stapleDeneme > 1 ? `(${stapleDeneme}. denemede)` : '');
}

/** stapler kapısı hatalarını ayıran işaret (mesaja gömülür; izleyici grep'ler). */
const STAPLE_KAPISI_ISARETI = '[stapler-basarisiz-notarize-tamam]';

/** `run()` sonucundan TEK satırlık, hem stdout hem stderr'i içeren özet (stapler
 * tüm tanı çıktısını stdout'a yazar — yalnız stderr okumak mesajı BOŞ gösterirdi). */
function agStapleCikti(res) {
  if (!res) return '(sonuç yok)';
  const parcalar = [res.stdout, res.stderr]
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim());
  if (!parcalar.length) return `(çıktı boş, rc=${res.code})`;
  return parcalar.join(' | ').slice(-500);
}

// ---------------------------------------------------------------------------
// Pardus (.impark) — NOT the local HTTP packager (3001). srv21's `packageLinux`
// is run BİREBİR (identical) inside a Docker container by pardus-packager-build.sh
// (idempotent image/volumes, single-build lock, disk gate, Rosetta+AppImage binfmt).
// See that script's header for the full contract this section relies on.
// ---------------------------------------------------------------------------

/**
 * Docker Desktop kapalıysa arka planda (odak çalmadan, `open -g -j`) açar, `docker
 * info` dönene kadar `dockerReadyPollMs` aralıkla yoklar. `dockerReadyTimeoutMs`
 * içinde hâlâ hazır değilse fırlatır — bu Nadir'in kararı: sunucuya (srv21) kaçış
 * YOK, sessiz düşürme YASAK, iş net bir sebeple 'failed' raporlanır.
 */
async function ensureDockerReady() {
  const already = await run('docker', ['info']);
  if (already.code === 0) return;
  log('pardus: docker hazır değil, arka planda açılıyor (odak çalmadan)...');
  await run('open', ['-g', '-j', '-a', 'Docker']);
  const deadline = Date.now() + CONFIG.dockerReadyTimeoutMs;
  while (Date.now() < deadline) {
    if (stopping) throw new Error('shutting down');
    await sleep(CONFIG.dockerReadyPollMs);
    const check = await run('docker', ['info']);
    if (check.code === 0) {
      log('pardus: docker hazır.');
      return;
    }
    log('pardus: docker henüz hazır değil, bekleniyor...');
  }
  throw new Error(`docker ${Math.round(CONFIG.dockerReadyTimeoutMs / 1000)}s içinde hazır olmadı — pardus build başlatılamadı`);
}

/**
 * Pardus (.impark) ikonu: HTTP paketleyicideki kayıtlı yayıncı logosunu indirip build.zip
 * köküne `ico.png` olarak ekler. Docker'daki packagingService.getValidLinuxIcon
 * `workingPath/ico.png`'yi okur; yayıncı zip'lerinde bu dosya yok (2026-09-12: tüm .impark'lar
 * Electron varsayılan ikonuyla çıkıyordu). Logo yoksa/alınamazsa iş SÜRER (varsayılan ikon, uyarı).
 */
async function injectPardusIcon(zipPath, publisherName, work) {
  const logoId = await packagerLogoIdFor(publisherName);
  if (!logoId) return false;
  try {
    const res = await axios.get(joinUrl(CONFIG.packagerApi, `api/logos/${logoId}/file`), {
      responseType: 'arraybuffer', timeout: 30000, validateStatus: () => true,
    });
    if (res.status !== 200 || !res.data || !res.data.length) {
      warn('pardus ikon: logo dosyası alınamadı (HTTP', res.status + '), varsayılan ikon');
      return false;
    }
    const png = path.join(work, 'ico.png');
    await fsp.writeFile(png, Buffer.from(res.data));
    const r = addFileToZipRoot(zipPath, png);
    if (!r.ok) { warn('pardus ikon: zip köküne eklenemedi, varsayılan ikon —', r.error); return false; }
    log('pardus ikon: zip köküne ico.png eklendi (logo', logoId + ')');
    return true;
  } catch (e) {
    warn('pardus ikon eklenemedi (varsayılan ikon):', agHatasiOzeti(e));
    return false;
  }
}

/**
 * pardus-packager-build.sh'ı `nice -n 10` ile, timeout korumalı çalıştırır. Betiğin
 * kendi stdout/stderr'ini (zaten `[HH:MM:SS] ...` biçiminde, kendi log dosyasına da
 * yazıyor) satır satır ajan log'una yansıtır — mevcut ilerleme-log stiliyle tutarlı.
 * Süre `pardusTimeoutMs`'i aşarsa süreç SIGKILL edilir ve timeout olarak işaretlenir.
 */
function runPardusScript(args, job) {
  return new Promise((resolve) => {
    // G açık anahtarı + claim'in G kimliği (setKimligi, guncellemeTabani, surum) betiğe —
    // oradan -e ile konteynerdeki paketleyiciye — doğrulanmış olarak geçer (2026-09-26).
    const pe = pardusBetikEnv(process.env, job);
    if (pe.sebep) log(`pardus: G açık anahtarı ${pe.sebep} — pakette G kanalı kapalı kalır`);
    if (pe.gSebepler.length) {
      warn(`pardus: claim G kimliği eksik/geçersiz (${pe.gSebepler.join(', ')}) — `
        + 'pakette G güncelleyici enjekte EDİLMEZ (sahte tabanlı paket üretilmez)');
    } else {
      log(`pardus: G kimliği set=${pe.gKimlik.setKimligi} surum=${pe.gKimlik.surum} taban=${pe.gKimlik.guncellemeTabani}`);
    }
    const p = spawn('nice', ['-n', '10', CONFIG.pardusBuildScript, ...args], { env: pe.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill('SIGKILL');
    }, CONFIG.pardusTimeoutMs);
    timer.unref?.();
    const pipe = (chunk, isErr) => {
      const text = chunk.toString();
      if (isErr) stderr += text; else stdout += text;
      for (const line of text.split('\n')) {
        if (line.trim()) log('  [pardus]', line);
      }
    };
    if (p.stdout) p.stdout.on('data', (d) => pipe(d, false));
    if (p.stderr) p.stderr.on('data', (d) => pipe(d, true));
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? -1 : (code == null ? -1 : code), stdout, stderr, timedOut });
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(e && e.message ? e.message : e), timedOut: false });
    });
  });
}

/**
 * ProBook kabul betiğini koşturur — kendi süreç GRUBUNDA.
 *
 * NEDEN kendi grubu: betik `ssh`/`scp`/`sleep` çocukları doğurur. spawn'ın `timeout`
 * seçeneği yalnız bash'i öldürür; çocuklar stdout borusunu açık tuttuğu için `close`
 * olayı gelmez ve kapı ASILI kalır (2026-09-17'de testle ölçüldü: 400 ms timeout,
 * 30 sn bekleme). `detached: true` + `kill(-pid)` bütün grubu keser; `exit` olayında
 * çözülür, `close` beklenmez.
 */
function runKabulBetigi(args, ekEnv = {}) {
  return new Promise((resolve) => {
    const p = spawn('bash', args, { detached: true, env: { ...process.env, ...ekEnv } });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const grubuOldur = () => {
      try { process.kill(-p.pid, 'SIGKILL'); } catch (_) { try { p.kill('SIGKILL'); } catch (__) { /* bitti */ } }
    };
    const timer = setTimeout(() => { timedOut = true; grubuOldur(); }, CONFIG.pardusKabulTimeoutMs);
    timer.unref?.();
    if (p.stdout) p.stdout.on('data', (d) => (stdout += d.toString()));
    if (p.stderr) p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('exit', (code) => {
      clearTimeout(timer);
      if (timedOut) grubuOldur();
      resolve({ code: timedOut ? -1 : (code == null ? -1 : code), stdout, stderr, timedOut });
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(e && e.message ? e.message : e), timedOut: false });
    });
  });
}

/**
 * .impark builds via the srv21-identical Docker path, verifies it is not truncated
 * (impark-butunluk.py, squashfs offset 193728), checks the doğrulama script's
 * rapor.txt for the AppRun/asar sentinel lines when that tool is available, then
 * places the finished artifact at `artifactPath` for the shared upload/result flow.
 */
async function buildPardusArtifact(zipPath, appName, appVersion, artifactPath, work, kimlik = {}) {
  const outDir = path.join(work, 'pardus-out');

  // Hazır paket devri KAPALI (exe'siz sözleşme): hazirPardusPaketi her zaman null döner; çağrı yalnız
  // yanlışlıkla açık EMPP_PARDUS_HAZIR_DIR için görünür uyarıyı korur. Eski devralma dalı:
  // _graveyard/2026-10-01-exe-kaynak/runner-fonksiyonlar.js
  await hazirPardusPaketi(kimlik);

  await ensureDockerReady();
  log('pardus: build başlıyor —', CONFIG.pardusBuildScript);
  const res = await runPardusScript([zipPath, appName, outDir, appVersion], kimlik);
  if (res.timedOut) {
    throw new Error(`pardus build ${Math.round(CONFIG.pardusTimeoutMs / 60000)} dk içinde bitmedi (timeout): ${CONFIG.pardusBuildScript}`);
  }
  if (res.code !== 0) {
    throw new Error(`pardus-packager-build.sh rc=${res.code}: ${(res.stderr || res.stdout).slice(-1500)}`);
  }

  const entries = await fsp.readdir(outDir).catch(() => []);
  const builtName = entries.find((f) => f.endsWith('.impark'));
  if (!builtName) throw new Error('pardus build bitti (rc=0) ama .impark üretilmedi');
  const builtPath = path.join(outDir, builtName);

  // Bütünlük: kesik squashfs paketi asla yüklenmez (offset 193728, bytes_used).
  //
  // 2026-09-16: bu denetim eskiden `/usr/bin/python3 impark-butunluk.py` ile
  // koşuyordu. Xcode güncellemesi lisans onayını sıfırlayınca o shim tek satır
  // Python çalıştırmadan rc=69 döndürmeye başladı ("You have not agreed to the
  // Xcode license agreements" — stderr'e, stdout BOŞ). Betik yalnız 0/1/2
  // döndürebildiği için 69 paketle ilgili değildi; yine de sapasağlam bir paket
  // (45480 Marvel Grade 11, zenity kapısı GEÇTİ, tüm asar denetimleri EVET)
  // "bütünlük denetiminden geçemedi" diye düştü. Üretim kapısı artık dış
  // yorumlayıcıya/lisansa/TCC iznine bağlı DEĞİL — saf Node bayt okuması.
  const integrity = imparkDenetle(builtPath);
  if (integrity.durum !== 'TAM') {
    throw new Error(`pardus paket bütünlük denetiminden geçemedi: ${imparkOzet(builtPath, integrity)}`);
  }
  log('pardus: bütünlük OK —', imparkOzet(builtPath, integrity));

  // Doğrulama raporu (AppRun + asar has satırları) — araç host'ta yoksa (silindiyse/
  // eksikse) script bunu zaten yutar (`|| log "dogrulama betigi hata verdi"`); burada
  // sadece kanıtı logla, build'i bu adım yüzünden DÜŞÜRME.
  const raporPath = path.join(outDir, 'dogrula', 'rapor.txt');
  const rapor = await fsp.readFile(raporPath, 'utf8').catch(() => '');
  if (rapor && /AppRun/.test(rapor) && /asar has/.test(rapor)) {
    log('pardus: dogrula raporu OK —', rapor.split('\n').filter(Boolean).join(' | '));
  } else {
    warn('pardus: dogrula/rapor.txt eksik veya AppRun/asar-has satırı yok (araç eksikse beklenir) —', raporPath);
  }

  // Kök index denetimi görünürlük köprüsü (2026-09-26) — konteynerin stdout'u zaten
  // `$OUT/raw/packager.log`'a `tee` ile yazılıyor (packager-entry.sh); `work` silinmeden
  // ÖNCE burada okunup agent.log'a taşınır. dogrula/rapor.txt ile AYNI desen.
  const packagerLogPath = path.join(outDir, 'raw', 'packager.log');
  const packagerLogMetni = await fsp.readFile(packagerLogPath, 'utf8').catch(() => '');
  const kokIndexSatiri = pardusLogundanCikar(packagerLogMetni);
  if (kokIndexSatiri) log(`pardus: ${kokIndexSatiri} [kitap ${kimlik.bookId || '?'}, platform pardus]`);
  // Kanonik motor/kabuk sürümü: paket.json konteynerde kaldığından packager.log damgalarından okunur
  // (kanonik-surum.js logdanOzet) → job.kanonikSurum → /result gövdesi. Hedef verilmediyse atlanır.
  if (kimlik.kanonikHedef && typeof kimlik.kanonikHedef === 'object') {
    kimlik.kanonikHedef.kanonikSurum = kanonikLogdanOzet(packagerLogMetni);
  }

  await fsp.copyFile(builtPath, artifactPath);
  const mb = ((await fsp.stat(artifactPath)).size / 1e6).toFixed(0);
  log(`pardus: impark hazır — ${artifactPath} (${mb}MB)`);

  await pardusKabulKapisi(artifactPath, outDir, appName, kimlik.bookId);
}

// KABUL KANITI KALICI (2026-09-27, 45479 pardus): pardusKabulKapisi'nin kanit dizini
// (`outDir/probook-kabul`) işin GEÇİCİ çalışma dizininin (`work`) altındadır ve iş bitince
// `fsp.rm(work, ...)` ile silinir — GEÇTİ de RED de olsa teşhis kanıtı (aktarim.txt,
// aktarim-*.err, ortam.txt) kayboluyordu (45479: boş sha256 ölçüm hatasını teşhis etmek
// için gereken kanıt hiç kalmamıştı). Başsız kapı (android/mac/windows) kanıtı zaten kalıcı
// `~/.empp-agent/kabul-kanit/<bookId>-<platform>-<damga>/` altına yazıyor (tools/kabul/
// basliksiz-kabul.js: kanitAdi/kanitKoku) — Pardus da AYNI kök + adlandırmayı kullanır.
// Yalnız KÜÇÜK kanıt dosyaları kopyalanır: .impark/.zip (paketin kendisi, GB mertebesinde)
// ve 50 MB üstü her şey ATLANIR. Kopyalama hatası (ör. kanitDir hiç oluşmadıysa) işi
// DÜŞÜRMEZ — yalnız uyarı loglanır.
const PARDUS_KANIT_ATLA_BOYUT = 50 * 1000 * 1000;
async function pardusKanitiKaliciyaKopyala(kanitDir, bookId) {
  try {
    const hedef = path.join(kanitKoku(), kanitAdi(bookId || 'bilinmiyor', 'pardus'));
    await fsp.mkdir(hedef, { recursive: true });
    await fsp.cp(kanitDir, hedef, {
      recursive: true,
      filter: (kaynakYolu) => {
        let st;
        try { st = fs.statSync(kaynakYolu); } catch (_) { return true; }
        if (st.isDirectory()) return true;
        if (/\.(impark|zip)$/i.test(kaynakYolu)) return false;
        return st.size <= PARDUS_KANIT_ATLA_BOYUT;
      },
    });
    log('pardus: kabul kanıtı kalıcı:', hedef);
  } catch (e) {
    warn('pardus: kabul kanıtı kalıcı dizine kopyalanamadı —', (e && e.message) || e);
  }
}

/**
 * ProBook kabul kapısı — "her yaptığını Pardus'ta aç, doğrulayıp öyle yükle"
 * (Nadir, 2026-09-17). 14 SET paketi aylarca beyaz ekran açtı; zenity + bütünlük +
 * asar denetimlerinin HEPSİ geçiyordu, çünkü hiçbiri uygulamayı AÇMIYORDU.
 * Kapı paketi gerçek ProBook'ta kurar, açar, süreç/pencere/piksel kanıtı toplar;
 * geçmezse HATA fırlatır → yükleme YOK. Hazır (srv21) paket de bu kapıdan geçer.
 */
async function pardusKabulKapisi(artifactPath, outDir, bookTitle, bookId) {
  if (!CONFIG.pardusKabul) return;
  const aktivasyon = aktivasyonBeklenir(bookTitle);
  const yedek = pardusYedekKabul();
  const kabulHost = pardusKabulHostu();
  // SÜRELİ KONTEYNER YEDEK KABUL (2026-09-27): yedek aktif VE ProBook'a erişilemez ÖLÇÜLDÜyse
  // ProBook betiğini HİÇ çağırma — doğrudan konteyner kapısına git. host==='yerel' iken (kabul
  // ProBook'un kendisinde koşuyor) erişilemezlik ölçümü anlamsızdır, yedek devreye GİRMEZ.
  if (yedek.aktif && kabulHost !== 'yerel') {
    const erisilir = await probookErisimIlkOlcum(kabulHost);
    if (erisilir === false) {
      log(`pardus: ProBook erişilemez (yedek ${yedek.bitis}'e kadar aktif) — ProBook betiği ATLANDI, KONTEYNER kapısına gidiliyor`);
      await konteynerKabulKapisi(artifactPath, outDir, aktivasyon, bookId, bookTitle, yedek);
      return;
    }
  }
  log('pardus: ProBook kabul kapısı başlıyor —', CONFIG.pardusKabulScript,
      aktivasyon ? '(aktivasyon kodlu seri — renk eşiği aranmaz)' : '');
  const kanitDir = path.join(outDir, 'probook-kabul');
  // KABUL_NODE: E6/E7 CDP istemcisi (tools/pardus/cdp-kitap-ac.js) ajanın KENDİ node'uyla koşar.
  const kabul = await runKabulBetigi([CONFIG.pardusKabulScript, artifactPath, kanitDir],
    { EMPP_AKTIVASYON_BEKLENIR: aktivasyon ? '1' : '0', KABUL_NODE: process.execPath });
  for (const satir of String(kabul.stdout || '').split('\n').filter(Boolean)) log('  [kabul]', satir);
  await pardusKanitiKaliciyaKopyala(kanitDir, bookId);
  if (kabul.code !== 0) {
    const cikti = String(kabul.stdout || kabul.stderr || '');
    const sebep = kabul.timedOut
      ? `kapı ${Math.round(CONFIG.pardusKabulTimeoutMs / 60000)} dk içinde bitmedi (ProBook yanıt vermiyor olabilir)`
      : cikti.split('\n').filter(Boolean).slice(-2).join(' | ');
    // ALTYAPI vs PAKET KUSURU (2026-09-21, ölçümle — disk kapısıyla AYNI ayrım):
    // ssh bağlantısı kurulamadı / ProBook'un kendi diski dolu / kapı zaman aşımına
    // uğradı → ProBook'a o an ERİŞİLEMEDİ, bu paketin kusuru DEĞİL. 45478 pardus
    // 03:41'de (muhtemelen makine uykuda) bu yüzden düştü, AYNI IP ile 12:50'de
    // 72378 pardus geçti — config/IP hatası değildi. Paketin içeriği/açılışıyla
    // ilgili RED (pencere açılmadı, içerik yok, motor kopyası hatası) bu sınıfa
    // GİRMEZ — K18 gerçek paket kusurudur, `failed` doğru sınıflandırmadır.
    // rc 3/4 (canlı yarı, 26.09): GÜNCEL-DEĞİL → failed + yeniden kuyruk önerisi (yüklenmez);
    // ÖLÇÜLEMEDİ → paket kusuru değil, failed YAZILMAZ (ProBook erişilemezliğiyle aynı yol).
    const sinif = pardusKabulSinifi(kabul);
    if (sinif && sinif.durum === 'GUNCEL_DEGIL') {
      throw new Error(`güncel değil: ${sinif.sebep} — yeniden üretilmeli; yeniden kuyruk önerisi: ${sinif.oneri || '-'}`);
    }
    if (sinif && sinif.durum === 'OLCULEMEDI') {
      throw new Error(`${PROBOOK_KAPISI_ISARETI} ProBook kabulü ÖLÇÜLEMEDİ (rc=4): ${sinif.sebep} — paket kusuru DEĞİL, iş ertelenmeli`);
    }
    if (probookErisilemezHatasi(cikti, kabul.timedOut)) {
      // SÜRELİ KONTEYNER YEDEK KABUL (2026-09-27): ProBook ölçümde erişilir görünmüş olsa
      // bile betik erişilemezlikle düşebilir (kısa kesinti, ölçüm-koşum arası yarış).
      // Yedek aktifken bu ERTELENMEZ — hemen konteyner kapısına düşülür.
      if (yedek.aktif && kabulHost !== 'yerel') {
        log(`pardus: ProBook'a erişilemedi (rc=${kabul.code}) — KONTEYNER yedek kabulüne düşülüyor (yedek ${yedek.bitis}'e kadar aktif)`);
        await konteynerKabulKapisi(artifactPath, outDir, aktivasyon, bookId, bookTitle, yedek);
        return;
      }
      throw new Error(
        `${PROBOOK_KAPISI_ISARETI} ProBook'a erişilemedi (rc=${kabul.code}): ${sebep} `
        + `— paket kusuru DEĞİL, iş ertelenmeli`,
      );
    }
    throw new Error(`pardus paketi ProBook kabul kapısından geçemedi (rc=${kabul.code}): ${sebep}`);
  }
  log('pardus: ProBook kabul kapısı GEÇTİ — kanıt:', kanitDir);
}

/**
 * SÜRELİ KONTEYNER YEDEK KABUL — kapı (2026-09-27, Nadir: "ProBook yarına kadar kapalı,
 * yedeği bu Mac'teki docker üzerinden devreye al"). ProBook'un YERİNE GEÇMEZ, geçici köprüdür:
 * `pardusKabulKapisi` yalnız yedek bayrağı AKTİFKEN ve ProBook'a erişilemediğinde buraya düşer.
 * Ölçütler ProBook kapısıyla BİREBİR aynıdır (tools/pardus/konteyner-kapi.sh, probook-kabul.sh
 * ile aynı eşikler) — konteyner-kabul.sh yalnız docker'ı sarmalar (docker info/imaj kapısı).
 *
 * Kod eşlemesi (konteyner-kabul.sh → konteyner-kapi.sh, tier-1):
 *   0 GEÇTİ         → yükle, TSV kaydına 'GECTI' yazılır.
 *   1 RED           → paket kusuru, `failed` YAZILIR (throw işaretsiz).
 *   2 / timeout     → kapı kusuru (docker yok/kapalı, imaj yok, betik asılı kaldı) — paket
 *                     kusuru DEĞİL, `PROBOOK_KAPISI_ISARETI` ile ertelenebilir sınıfa düşer.
 * Her sonuç `CONFIG.pardusYedekKabulKayit` dosyasına TSV satırı olarak eklenir — ProBook dönünce
 * hangi kitapların yeniden ProBook'ta kabul edilmesi gerektiğini bulmak için (yazma hatası işi
 * DÜŞÜRMEZ, yalnız uyarı loglanır).
 */
async function konteynerKabulKapisi(artifactPath, outDir, aktivasyon, bookId, bookTitle, yedek) {
  const kanitDir = path.join(outDir, 'konteyner-kabul');
  log('pardus: KONTEYNER yedek kabul kapısı başlıyor —', CONFIG.pardusKonteynerKabulScript,
      aktivasyon ? '(aktivasyon kodlu seri — renk eşiği aranmaz)' : '');
  const kabul = await runKabulBetigi([CONFIG.pardusKonteynerKabulScript, artifactPath, kanitDir],
    { KAPI_AKTIVASYON: aktivasyon ? '1' : '0' });
  for (const satir of String(kabul.stdout || '').split('\n').filter(Boolean)) log('  [kkabul]', satir);
  await pardusKanitiKaliciyaKopyala(kanitDir, bookId);
  const kaliciKanit = path.join(kanitKoku(), kanitAdi(bookId || 'bilinmiyor', 'pardus'));
  const zaman = new Date().toISOString();
  const paketAdi = path.basename(artifactPath);
  const kaydet = (sonuc) => pardusKonteynerKayitYaz([zaman, bookId || '', bookTitle || '', paketAdi, sonuc, kaliciKanit]);

  if (kabul.timedOut || kabul.code === 2) {
    const cikti = String(kabul.stdout || kabul.stderr || '');
    const sebep = kabul.timedOut
      ? `kapı ${Math.round(CONFIG.pardusKabulTimeoutMs / 60000)} dk içinde bitmedi`
      : cikti.split('\n').filter(Boolean).slice(-2).join(' | ');
    await kaydet('OLCULEMEDI');
    throw new Error(
      `${PROBOOK_KAPISI_ISARETI} konteyner kabulü ÖLÇÜLEMEDİ (rc=${kabul.timedOut ? 'timeout' : kabul.code}): `
      + `${sebep} — paket kusuru DEĞİL, iş ertelenmeli`,
    );
  }
  if (kabul.code !== 0) {
    const cikti = String(kabul.stdout || kabul.stderr || '');
    const sebep = cikti.split('\n').filter(Boolean).slice(-2).join(' | ');
    await kaydet('RED');
    throw new Error(`pardus paketi KONTEYNER kabul kapısından geçemedi (rc=${kabul.code}): ${sebep}`);
  }
  await kaydet('GECTI');
  log(`pardus: KONTEYNER yedek kabulü GEÇTİ (ProBook yerine; yedek ${yedek.bitis}'e kadar) — kanıt: ${kanitDir}`);
}

/** Konteyner yedek kabul sonucunu TSV satırı olarak ekler; yazma hatası işi DÜŞÜRMEZ. */
async function pardusKonteynerKayitYaz(parcalar) {
  try {
    await fsp.mkdir(path.dirname(CONFIG.pardusYedekKabulKayit), { recursive: true });
    await fsp.appendFile(CONFIG.pardusYedekKabulKayit, `${parcalar.join('\t')}\n`);
  } catch (e) {
    warn('pardus: konteyner yedek kabul kaydı yazılamadı —', (e && e.message) || e);
  }
}

/**
 * BAŞSIZ KABUL KAPISI (Nadir 2026-09-26: "bu bilgisayarda odak çalmadan bir kabul kapısı").
 * 26.09'da SET kökü ezilmiş 73768 mac/android paketleri kabulsüz R2'ye gitti; Pardus'u
 * yalnız ProBook yakaladı. Paket bu Mac'te görünmez Electron koşumunda (Android'de ek
 * olarak pencerisiz emülatörde) açılıp ölçülür. `EMPP_BASLIKSIZ_KABUL=1` ile açılır,
 * varsayılan KAPALI. Gövde ve sonuç sınıflaması `basliksiz-kabul-kapisi.js`'te:
 * RED → throw (failed), ÖLÇÜLEMEDİ → ertelenebilir işaretli throw (failed YAZILMAZ).
 */
async function basliksizKabul(artifactPath, packagerPlatform, job, work) {
  await basliksizKabulKapisi({
    artifactPath,
    platform: packagerPlatform,
    bookId: job.bookId,
    aktivasyon: aktivasyonBeklenir(job.bookTitle),
    calismaDizini: work,
    log,
  });
}

/** Verilen yolun bulunduğu birimde boş alan (GB, tam sayı); ölçülemezse null. */
function diskBosGb(yol) {
  try {
    const st = fs.statfsSync(yol);
    return Math.floor((st.bavail * st.bsize) / 1e9);
  } catch (_) {
    return null;
  }
}

/**
 * Kaynağın SIKIŞTIRILMIŞ boyutunu YALNIZ YERELDEN öğrenir (arşiv zip'i).
 *
 * EXE'SİZ SÖZLEŞME (Nadir 01.10): eskiden yerelde yoksa yayıncı bağlantısına (İmpark exe'si)
 * HEAD atılıyordu — kaldırıldı; uzak adrese HİÇBİR istek gitmez. Ölçülemezse `null` döner —
 * kapı o zaman yalnız tabana bakar; tahmin ÜRETİLMEZ.
 *
 * @param {{yerelZip?: string|null}} p
 * @returns {Promise<number|null>} bayt
 */
async function kaynakBoyutuTahmin({ yerelZip } = {}) {
  if (!yerelZip) return null;
  try {
    const st = await fsp.stat(yerelZip);
    if (st.size > 0) return st.size;
  } catch (_) { /* yerelde yok — ölçülemedi */ }
  return null;
}

/**
 * HAZIR PARDUS PAKETİ DEVRİ — KAPALI (exe'siz sözleşme, Nadir 01.10).
 *
 * srv21 şeridinin `EMPP_PARDUS_HAZIR_DIR`'e bıraktığı .impark İmpark exe'sinden üretiliyordu
 * (kaynak-arsivi.js başlığı); exe hiçbir koşulda kaynak olmadığı için bu paket de devralınmaz.
 * Fonksiyon imzası korunur (buildPardusArtifact çağırır); HER ZAMAN null döner, dizine bakmaz.
 * Dizin ayarlıysa süreç başına BİR KEZ görünür uyarı yazılır (yanlışlıkla açık env fark edilsin).
 * @returns {Promise<null>}
 */
let _hazirDizinUyarildi = false;
async function hazirPardusPaketi({ bookId } = {}) {
  if (CONFIG.pardusHazirDir && !_hazirDizinUyarildi) {
    _hazirDizinUyarildi = true;
    warn(`pardus: EMPP_PARDUS_HAZIR_DIR ayarlı (${CONFIG.pardusHazirDir}) ama hazır paket devri KAPALI `
      + `— exe'siz sözleşme (İmpark exe'sinden üretilmiş paket devralınmaz); ${bookId || '-'} derlenecek`);
  }
  return null;
}

/**
 * MANUEL build.zip indirme (exe'siz sözleşme §7 M1) — İmpark exe'si DEĞİL: elle yüklenmiş build
 * (R2 `sources/<bookId>/…zip` ya da `kaynak/<setId>/<sürüm>/build.zip`). Her deneme sıfırdan,
 * `--speed-limit` durgunluk kapısı, IPv4. Doğrulama ZIP'e göre (`unzip -Z1` en az bir giriş).
 * unrar/7z KULLANILMAZ (SFX değil). İnceleme düzeltmesi (01.10):
 *   - 4xx → HEMEN fırlatır, yeniden deneme YOK (adres/izin hatası; eskiden `--retry-all-errors`
 *     404'ü de bir saate kadar deniyordu). curl'ün kendi `--retry`'ı yalnız geçici sınıf (ağ, 5xx).
 *   - Tam inen ama geçerli zip olmayan içerik en çok MANUEL_GECERSIZ_MAX (2) kez denenir.
 *   - İçeriğin ilk 2 baytı `MZ` ise (Windows exe) HEMEN exe hatası — exe hiçbir koşulda kaynak değil.
 *   - Yol `.exe` ile bitiyorsa hiç indirmez.
 */
const MANUEL_GECERSIZ_MAX = 2;
async function manuelZipIndir(url, destPath, { etiket = 'manuel build' } = {}) {
  const ad = path.basename(String(url).split('?')[0]);
  if (exeYoluMu(url)) {
    throw new Error(`exe'siz sözleşme: manuel kaynak .exe olamaz — indirilmedi: ${ad}`);
  }
  const retryMax = Math.max(3600, Math.floor(CONFIG.packageTimeoutMs / 1000));
  const rate = process.env.AGENT_DOWNLOAD_RATE ?? '2M';
  const MAX = Number(process.env.AGENT_DOWNLOAD_MAX_ATTEMPTS || 12);
  let gecersiz = 0;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    if (stopping) throw new Error('shutting down');
    await fsp.rm(destPath, { force: true }).catch(() => {});
    const res = await run('curl', [
      '-sS', '-4', '-L', '--fail',
      '--retry', '300', '--retry-delay', '3', '--retry-connrefused',
      '--retry-max-time', String(retryMax),
      '--speed-limit', '1024', '--speed-time', '120',
      ...(rate ? ['--limit-rate', rate] : []),
      '-w', '%{http_code}',
      '-o', destPath,
      url,
    ]);
    const httpKodu = Number((String(res.stdout || '').match(/(\d{3})\s*$/) || [])[1] || 0);
    if (httpKodu >= 400 && httpKodu < 500) {
      throw new Error(`${etiket} HTTP ${httpKodu} — yeniden denenmez (adres/izin hatası): ${ad}`);
    }
    const size = (await fsp.stat(destPath).catch(() => ({ size: 0 }))).size;
    if (res.code !== 0) {
      // Ağ / 5xx / durgunluk: sıfırdan yeniden dene (yarım dosya geçersiz sayılmaz).
      warn(`${etiket} indirme ${attempt}: curl exit ${res.code} (HTTP ${httpKodu || '-'}, ${size} B) — yeniden deneniyor`);
      if (attempt < MAX) await sleep(backoffMs(attempt, 3000, 30000));
      continue;
    }
    let bas = Buffer.alloc(0);
    try {
      const fh = await fsp.open(destPath, 'r');
      try { bas = (await fh.read(Buffer.alloc(2), 0, 2, 0)).buffer; } finally { await fh.close(); }
    } catch (_) { /* okunamadı — aşağıda geçersiz sayılır */ }
    if (bas.length === 2 && bas.toString('latin1') === 'MZ') {
      throw new Error(`exe'siz sözleşme: manuel kaynak bir Windows exe'si (MZ) — kullanılmaz: ${ad}`);
    }
    const girisler = await zipGirisleri(destPath);
    if (girisler.length > 0) {
      log(`${etiket} indirildi: ${(size / 1e6).toFixed(0)}MB, geçerli zip (${girisler.length} giriş, deneme ${attempt})`);
      return;
    }
    gecersiz += 1;
    if (gecersiz >= MANUEL_GECERSIZ_MAX) {
      throw new Error(`${etiket} geçerli zip değil (${gecersiz} tam indirme, ${size} B) — vazgeçildi: ${ad}`);
    }
    warn(`${etiket} indirme ${attempt}: ${(size / 1e6).toFixed(0)}MB indi ama geçerli zip DEĞİL — bir kez daha`);
    if (attempt < MAX) await sleep(backoffMs(attempt, 3000, 30000));
  }
  // `agHatasi`: yalnız ağ/5xx/durgunluk tükenmesi (4xx, MZ, geçersiz zip KALICI). Manuel yolda bugünkü
  // davranış aynen (failed); R2 yolunda (r2IndirDogrula) geçici sayılır — R2 kalıcı yerdedir.
  const tukendi = new Error(`${etiket} indirilemedi: ${MAX} denemede ağ/sunucu hatası`);
  tukendi.agHatasi = true;
  throw tukendi;
}

/** Zip'in giriş adları (`unzip -Z1`, ZIP64; dosya belleğe alınmaz); okunamazsa boş dizi. */
async function zipGirisleri(zip) {
  try {
    return zipGirisAdlariniOku(zip);
  } catch (_) {
    return [];
  }
}

/**
 * Manuel build.zip'i iş kopyasına (`zipPath`) hazırlar (biçim: kaynak-karari `manuelZipBicimi`):
 *   'kok' (artıksız) — zip kökü DOĞRUDAN build'dir (sözleşme M1): olduğu gibi taşınır, açılmaz.
 *   'kok' + macOS artığı — açılır (artıklar hariç), kök yeniden paketlenir.
 *   'sarmalayici'    — Finder ile klasör sıkıştırma: açılır, tek klasör build.zip yapılır.
 *   'eski-kurulum'   — içinde `resources/app/build/` olan Windows kurulum ağacı (eski 59480 tipi):
 *                      bugünkü çıkarma yoluyla uyum — açılır, `findBuildDir`, `zipDir`. SFX açılmaz.
 * Hiçbir yolda yayıncı güncellemesi UYGULANMAZ (manuel build olduğu gibi kullanılır).
 * @returns {Promise<{bicim: string, temizle: boolean}>}
 */
async function manuelBuildHazirla({ url, zipPath, work, bookId }) {
  const indirilen = path.join(work, 'manuel-kaynak.zip');
  log(`kaynak MANUEL build.zip (${bookId}) — ${path.basename(String(url).split('?')[0])}; `
    + 'İmpark exe indirilmez, merdiven/set eki/yayıncı güncellemesi uygulanmaz (sözleşme M1)');
  await kaynakIndirme.manuelZipIndir(url, indirilen);
  const karar = manuelZipBicimi(await zipGirisleri(indirilen));
  if (karar.bicim === 'kok' && !karar.temizle) {
    await fsp.rename(indirilen, zipPath);
    log('manuel build: zip kökü doğrudan build — olduğu gibi kullanılıyor');
    return karar;
  }
  const acik = path.join(work, 'manuel-acik');
  await fsp.mkdir(acik, { recursive: true });
  const r = await run('unzip', ['-q', '-o', indirilen, '-x', '__MACOSX/*', '*/._*', '._*', '*.DS_Store',
    '-d', acik]);
  if (r.code !== 0 && r.code !== 1 && r.code !== 11) { // 1 = uyarı, 11 = dışlama deseni eşleşmedi
    throw new Error(`manuel build zip açılamadı (unzip ${r.code}): ${String(r.stderr || '').slice(-300)}`);
  }
  let buildDir = acik;
  if (karar.bicim === 'eski-kurulum') buildDir = await findBuildDir(acik);
  if (karar.bicim === 'sarmalayici') buildDir = path.join(acik, karar.kokKlasor);
  log(`manuel build: ${karar.bicim}${karar.temizle ? ' + macOS artıkları ayıklandı' : ''} — build dizini: `
    + `${path.relative(acik, buildDir) || '.'}`);
  await zipDir(buildDir, zipPath);
  await fsp.rm(acik, { recursive: true, force: true }).catch(() => {});
  await fsp.rm(indirilen, { force: true }).catch(() => {});
  return karar;
}

/**
 * Kaynak indirme uçları — processJob'daki HER uzak kaynak indirmesi bu nesneden geçer; testler
 * buraya casus (spy) koyup exe indirmenin HİÇ çağrılmadığını ölçer. `exeIndir` (= downloadFile)
 * processJob'da KULLANILMAZ — yalnız ölçülebilir olsun diye burada durur.
 */
const kaynakIndirme = {
  exeIndir: (...a) => downloadFile(...a),
  manuelZipIndir: (...a) => manuelZipIndir(...a),
  // Dalga B: imzalı R2 GET (r2-al kaynağı / r2-kur tabanı) — manuel indirme kurallarıyla AYNI
  // (curl -4, 4xx'te yeniden deneme yok, MZ/exe reddi, geçerli zip denetimi).
  r2Indir: (url, hedef) => manuelZipIndir(url, hedef, { etiket: 'R2 build' }),
};

/**
 * Kaynak ADIMLARI — merdiven ve set eki bu nesneden çağrılır; testler casus koyup `r2-al`'de
 * HİÇ çağrılmadıklarını ölçer (kaynak-r2.test.js).
 */
const kaynakAdim = {
  merdiven: (...a) => icerikMerdiveni(...a),
  setEki: (...a) => setEk.setUyelikEki(...a),
  // sf425 kabuk tazeleme (Z2): başsız Swift ikilisi; hiçbir hata fırlatmaz (adım atlanır).
  kabukTazele: (o) => setKabuk.kabukTazele(o),
  // Kabuk eki ön kontrolü (r2-kur, 'ek' kipi, taban indirilmeden): CDN son.json'da bu kitap var mı.
  kabukEkSonKontrol: (o) => setKabuk.ekSonKontrol(o),
  // imKeys: bağımlılıklar exports üzerinden çözülür (test-yalitim sahtesini koyabilsin; üretimde
  // kapatma anahtarı YOK — güvenlik kapısı env ile devre dışı bırakılamaz).
  imKeys: (o) => imKeys.imKeysAdimi({ ...o, bag: imKeys.varsayilanBagimliliklar() }),
  menuBasligi: (o) => imKeys.menuBasligiAdimi(o),
  // Menü kapak garantisi (06.10): kapaksız kart → panel listesi / Web-Z / thumbs / yer tutucu.
  menuKapak: (o) => menuKapak.menuKapakGaranti(o),
  // Panel menü hizalama: panel GET'i exports üzerinden (test-yalitim sahtesi internete çıkarmaz).
  panelMenuHizala: (o) => panelMenu.panelMenuHizala({ ...panelMenu.varsayilanBagimliliklar(), ...o }),
  // Üreteç (r2-kur kaynak adımı): anahtarlı mı sorusu okuyucunun kendi HasZKitapKey'i (imkeys).
  // (imKeys ile AYNI bağımlılık kaynağı: test-yalitim sahtesi burada da geçerli — internete çıkılmaz).
  uretec: (o) => uretecKaynak.uretecKaynagi({ anahtarliMi: imKeys.varsayilanBagimliliklar().anahtarliMi, ...o }),
  // r2-kur YAYIN (kapı → presign → yükle → tamamla): tek-set elle kurulum aracı
  // (tools/kaynak-kur/elle-kur.js) kuru kipte bunu kendi kapı-yalnız adımıyla değiştirir.
  r2KurYayinla: (o) => kaynakR2.r2KurYayinla(o),
};

/** Kaynak uç istemcisi (B2) — runner'ın axios + ajan başlığıyla; biçim kaynak-r2.js'te. */
function kaynakIstemcisi(auth) {
  return kaynakR2.kaynakUcIstemcisi({
    istek: (yol, govde) => axios.post(
      joinUrl(CONFIG.apiBase, `agents/${auth.agentId}/${yol}`),
      govde,
      { headers: { ...agentHeaders(auth), 'Content-Type': 'application/json' }, timeout: 120000, validateStatus: () => true },
    ),
    sleep,
    warn,
  });
}

/** İndirilen R2 build'ini claim özetiyle doğrular (boyut + sha256); uymazsa KALICI hata. */
async function r2IndirDogrula(url, hedef, { sha256, boyut = null }) {
  try {
    await kaynakIndirme.r2Indir(url, hedef);
  } catch (e) {
    // Ağ tükenmesi GEÇİCİ (koordinatör 01.10): build R2'de kalıcı durur; iş kırılmaz, ertelenir.
    if (e && e.agHatasi) throw new kaynakR2.KaynakR2Hatasi(e.message, { gecici: true });
    throw e;
  }
  const oz = await ikiOzet(hedef);
  kaynakR2.r2OzetDogrula(oz, { sha256, boyut });
  return oz;
}

/**
 * r2-al: geçerli build'i iş kopyasına (`zipPath`) koyar — önce arşiv önbelleği (r2Surum + sha256
 * aynıysa indirme YOK), ıskada imzalı GET → doğrula → arşivi tazele. Merdiven/set eki YOK.
 */
async function r2AlHazirla({ bookId, kaynak, zipPath, work }) {
  const onb = await r2Onbellek(bookId, {
    surum: kaynak.surum, sha256: kaynak.sha256, boyut: kaynak.boyut, bilgi: log,
  });
  if (onb) {
    await fsp.copyFile(onb.zip, zipPath, fs.constants.COPYFILE_FICLONE);
    log(`kaynak R2 ${kaynak.surum} ARŞİV ÖNBELLEĞİNDEN (sha256 ${kaynak.sha256.slice(0, 12)}…) — indirilmedi; `
      + 'olduğu gibi kullanılır (merdiven/set eki yok)');
    return { onbellek: true };
  }
  const indirilen = path.join(work, 'r2-kaynak.zip');
  log(`kaynak R2 ${kaynak.surum} (${bookId}) — imzalı GET, ${(kaynak.boyut / 1e6).toFixed(0)}MB; `
    + 'olduğu gibi kullanılır (merdiven/set eki yok)');
  const oz = await r2IndirDogrula(kaynak.url, indirilen, { sha256: kaynak.sha256, boyut: kaynak.boyut });
  await r2ArsiveYaz(bookId, indirilen, { surum: kaynak.surum, ...oz, uyari: warn });
  await fsp.rename(indirilen, zipPath);
  return { onbellek: false };
}

/** Önceki build (taban zip, henüz değiştirilmemiş iş kopyası) sayfa envanteri; okunamazsa null (kapı RED kalır). */
function oncekiEnvanterOku(zip) {
  try { return zipSayfaEnvanteri(zip); } catch (_) { return null; }
}

/**
 * r2-kur: TABANI iş kopyasına koyar — `tabanUrl` (önceki geçerli R2 build, sha doğrulanır) ya da
 * Mac arşivi. Dönüş `oncekiBoyut`: yazma kapısının %80 ölçütü için önceki geçerli build boyutu
 * (R2 tabanı ya da r2Surum'lu arşiv kaydı; elle yazılmış arşivde bilinmez → null).
 */
async function r2KurTabanHazirla({ bookId, kaynak, zipPath, work, job = null, uretecNeden = null }) {
  // ÜRETEÇ: build'i Web-Z listesi + ZKitapZipH + kurum motoruyla kurar. Ertelenecek her durum
  // (liste/kalıp/tema yok, kitap alınamadı, ağ) `gecici` → çağıranın catch'i r2Ertele (failed yok).
  const uretecleKur = async (neden) => {
    log(`kaynak r2-kur ${kaynak.surum} (${bookId}) — ${neden}: build index üreteciyle kuruluyor`);
    const { rapor, liste } = await kaynakAdim.uretec({ job, zipPath, work, arsivKoku: arsivKoku(), log });
    // Sonraki adımlar (set eki, yazma kapısı) AYNI listeyi görsün: kitap-dışı varlık link'e çevrilmiş hâli.
    job.setListesi = rapor.kapiListesi;
    job.uretecOzeti = { ...indexUreteci.uretecOzeti(rapor), liste: liste.kaynak };
    // Kesin "içerik yok" nedeniyle atlanan üyeler (Nadir 06.10): `/result` + `tamamla` özetine taşınır.
    job.atlananUyeler = uyeAtla.birlestir(job.atlananUyeler, rapor.atlananUyeler);
    // Link kartına çevrilen öğeler sunucu kapısına `webzVarliklari` (yol 'link') olarak bildirilir.
    job.uretecWebzVarliklari = indexUreteci.linkVarliklari(rapor);
    return { oncekiBoyut: null };
  };
  // Üreteç build'i / girişsiz build TABAN OLMAZ (03.10 saha 74430/59480): üreteç her seferinde koşar.
  // Taban claim'deki set listesini kapsamıyorsa: set ekinden SONRA processJob ölçer (uretecNeden ile
  // buraya döner) — set eki eksiği tamamlıyorsa elle yazılmış taban korunur (45482 saha, 03.10).
  const tabanAtla = (zip) => (uretecKaynak.uretecAcik() ? uretecKaynak.tabanUretecMi(zip) : { atla: false });
  if (uretecNeden) return uretecleKur(uretecNeden);
  if (kaynak.taban.tur === 'uretec') return uretecleKur('taban YOK');
  if (kaynak.taban.tur === 'r2') {
    const indirilen = path.join(work, 'r2-taban.zip');
    log(`kaynak r2-kur ${kaynak.surum} (${bookId}) — taban: önceki geçerli R2 build (imzalı GET)`);
    const oz = await r2IndirDogrula(kaynak.taban.url, indirilen, { sha256: kaynak.taban.sha256 });
    const d = tabanAtla(indirilen);
    if (d.atla) return uretecleKur(`R2 tabanı ATLANDI (${d.sebep})`);
    await fsp.rename(indirilen, zipPath);
    return { oncekiBoyut: oz.boyut, oncekiEnvanter: oncekiEnvanterOku(zipPath) };
  }
  const { arsiv } = kaynak.taban;
  const da = tabanAtla(arsiv.zip);
  if (da.atla) return uretecleKur(`arşiv tabanı ATLANDI (${da.sebep})`);
  await fsp.copyFile(arsiv.zip, zipPath, fs.constants.COPYFILE_FICLONE);
  log(`kaynak r2-kur ${kaynak.surum} (${bookId}) — taban: ARŞİV (${arsiv.etiket || '-'}, md5 ${arsiv.md5}`
    + `${arsiv.r2Surum ? `, R2 ${arsiv.r2Surum}` : ', elle yazılmış'})`);
  return { oncekiBoyut: arsiv.r2Surum ? arsiv.boyut : null, oncekiEnvanter: oncekiEnvanterOku(zipPath) };
}

/**
 * r2-kur: setin mevcut GEÇERLİ kaynak sürümünün kimliği — yalnız claim'in R2 tabanından (tabanUrl yolundaki
 * sürüm + tabanSha256) bilinir. Arşiv tabanında sha256 yok (md5) → bilinmez → {} (fail-safe, yeni sürüm kurulur).
 */
function r2GecerliSurumKimligi(kaynak) {
  if (!kaynak || !kaynak.taban || kaynak.taban.tur !== 'r2') return {};
  const yol = kaynakR2.imzaliKaynakUrlCoz(kaynak.taban.url);
  if (!yol || !kaynak.taban.sha256) return {};
  return { gecerliSha256: kaynak.taban.sha256, gecerliSurum: yol.surum };
}

/** (r2-kur ise) R2 kurma kilidini bırak + işin kirasını bırak (failed YAZILMAZ). @returns {Promise<{ertelendi: true, sebep: string}>} */
async function r2Ertele(auth, job, sebep, { kilitBirak = true } = {}) {
  currentJob = null; // nabız bırakılan kirayı tazelemesin (kaynakYokBekle ile aynı ders)
  if (kilitBirak) {
    await kaynakIstemcisi(auth).birak({ bookId: job.bookId, platform: job.platform, surum: job.kaynakSurumu, sebep });
  }
  const birakildi = await releaseJob(auth, job, sebep);
  warn(`${kaynakR2.R2_ISARETI} ${job.bookId} ${job.platform} ertelendi: ${sebep} — failed YAZILMADI, `
    + (birakildi ? 'kira BIRAKILDI' : 'kira bırakılamadı (süre dolunca kuyruğa döner)'));
  return { ertelendi: true, sebep };
}

// KAYNAK YOK — kira bırak + ÖZET bildirim (exe'siz sözleşme §6a; inceleme 01.10 "bildirim seli").
// Build'siz işler sunucuda sona atılıp tekrar kiralandıkça her bırakma ayrı bildirim üretmesin:
// bekleyen (kitap, platform) çiftleri küçük bir durum dosyasında birikir, en çok
// KAYNAK_YOK_OZET_ARALIK_MS'de (varsayılan 1 sa) BİR özet ("N iş build bekliyor: …") gider. Son
// gönderim zamanı dosyada durduğu için süreç yeniden başlayınca da sel olmaz. Log her seferinde.
const KAYNAK_YOK_ISARETI = '[kaynak-yok]';
const KAYNAK_YOK_OZET_ARALIK_MS = Number(process.env.EMPP_KAYNAK_YOK_BILDIRIM_ARALIK_MS || 3600 * 1000);
const KAYNAK_YOK_LISTE_TAVAN = 20;

function kaynakYokDurumOku() {
  try {
    const d = JSON.parse(fs.readFileSync(CONFIG.kaynakYokDurumDosyasi, 'utf8'));
    if (d && typeof d === 'object') {
      return { sonGonderimMs: Number(d.sonGonderimMs) || 0, bekleyen: d.bekleyen && typeof d.bekleyen === 'object' ? d.bekleyen : {} };
    }
  } catch (_) { /* yok/bozuk — sıfırdan */ }
  return { sonGonderimMs: 0, bekleyen: {} };
}

function kaynakYokDurumYaz(d) {
  try {
    fs.mkdirSync(path.dirname(CONFIG.kaynakYokDurumDosyasi), { recursive: true });
    const tmp = `${CONFIG.kaynakYokDurumDosyasi}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(d));
    fs.renameSync(tmp, CONFIG.kaynakYokDurumDosyasi);
  } catch (e) {
    warn('kaynak-yok durum dosyası yazılamadı (bildirim aralığı süreç içinde korunmaz):', e.message);
  }
}

/** Özet metni (SAF). */
function kaynakYokOzetMetni(bekleyenler) {
  const liste = bekleyenler.map((b) => `${b.bookId}/${b.platform}`).sort();
  const gorunen = liste.slice(0, KAYNAK_YOK_LISTE_TAVAN).join(', ');
  const kalan = liste.length > KAYNAK_YOK_LISTE_TAVAN ? ` … +${liste.length - KAYNAK_YOK_LISTE_TAVAN}` : '';
  return `${liste.length} iş build bekliyor: ${gorunen}${kalan}. Exe indirilmez — kaynak arşivine ya da `
    + 'manuel build.zip olarak eklenince üretim sürer.';
}

/**
 * Bekleyen işi durum dosyasına ekler; aralık dolduysa TEK özet bildirim gönderir ve listeyi sıfırlar.
 * @returns {boolean} bu çağrıda bildirim gönderildi mi
 */
function kaynakYokOzet({ bookId, bookTitle, platform, simdi = Date.now() }) {
  const d = kaynakYokDurumOku();
  d.bekleyen[`${bookId}|${platform}`] = { bookId: String(bookId), bookTitle: bookTitle || '', platform, sonMs: simdi };
  if (process.env.EMPP_BILDIRIM === '0' || simdi - d.sonGonderimMs < KAYNAK_YOK_OZET_ARALIK_MS) {
    kaynakYokDurumYaz(d);
    return false;
  }
  const bekleyenler = Object.values(d.bekleyen);
  const ikili = process.env.EMPP_BILDIR_IKILI || path.join(os.homedir(), '.local', 'bin', 'bildir');
  const args = ['kosucu', kaynakYokOzetMetni(bekleyenler), '-b', `⏸ ${bekleyenler.length} iş build bekliyor`,
    '-p', 'normal', '-e', 'pause_button'];
  try {
    const ps = spawn(ikili, args, { stdio: 'ignore', detached: true, timeout: 20000 });
    ps.on('error', (e) => warn('kaynak-yok özet bildirimi gönderilemedi:', e.message));
    ps.unref();
  } catch (e) {
    warn('kaynak-yok özet bildirimi gönderilemedi:', e.message);
  }
  kaynakYokDurumYaz({ sonGonderimMs: simdi, bekleyen: {} });
  return true;
}

// KABUK EKİ ERTELEME BİLDİRİMİ (06.10, kabuk-eki-tasarim.md §6 madde 2/4; birleşik inceleme D4):
// ProBook ('ek' kipi) eki bulamayınca iş ertelenir; sunucu işi hemen yeniden kiralayabilir.
// Bildirim `kaynakYokOzet` deseninde: bekleyen setler durum dosyasında bookId ANAHTARIYLA birikir (aynı set
// tekrar gelirse kaydı tazelenir), en çok KABUK_ERTELE_ARALIK_MS'de (varsayılan 1 sa) TEK özet
// ("N set kabuk eki bekliyor: …") gider. Son gönderim zamanı dosyada (yeniden başlatmada sel yok).
const KABUK_ERTELE_ARALIK_MS = Number(process.env.EMPP_KABUK_ERTELE_BILDIRIM_ARALIK_MS
  || 3600 * 1000);

/** Özet metni (SAF): Mac'te `ek-uret --set <id,…>` ile yeniden üretmeye yeter. */
function kabukErteleOzetMetni(bekleyenler) {
  const liste = [...bekleyenler].sort((a, b) => String(a.bookId).localeCompare(String(b.bookId)));
  const sha = (s) => String(s).slice(0, 12);
  // ek-sapma: iki sha yan yana (Mac/ProBook taban ayrışması teşhisi).
  const satir = liste.slice(0, KAYNAK_YOK_LISTE_TAVAN).map((b) => `${b.bookId} (${b.kod}`
    + `${b.macGirdiSha && b.girdiSha ? `, Mac ${sha(b.macGirdiSha)} ≠ ProBook ${sha(b.girdiSha)}`
      : b.girdiSha ? `, ${sha(b.girdiSha)}` : ''}`
    + `${b.kaynakSurumu ? `, ${b.kaynakSurumu}` : ''})`).join('; ');
  const fazla = liste.length - KAYNAK_YOK_LISTE_TAVAN;
  const kalan = fazla > 0 ? ` … +${fazla}` : '';
  return `${liste.length} set kabuk eki bekliyor: ${satir}${kalan}. `
    + `Mac: ek-uret --set ${liste.map((b) => b.bookId).join(',')}`;
}

/**
 * Bekleyen seti durum dosyasına ekler (anahtar bookId); aralık dolduysa TEK özet gönderir ve
 * listeyi sıfırlar.
 * @param {{bookId: string, kod: string, neden: string, girdiSha?: string|null,
 *   kaynakSurumu?: string, simdi?: number, gonder?: (args: string[]) => void}} o
 * @returns {boolean} bu çağrıda bildirim gönderildi mi
 */
function kabukErteleBildir({
  bookId, kod, neden, girdiSha = null, macGirdiSha = null, kaynakSurumu = '', simdi = Date.now(),
  gonder,
}) {
  const dosya = CONFIG.kabukErteleDurumDosyasi;
  let d = { sonGonderimMs: 0, bekleyen: {} };
  try {
    const o = JSON.parse(fs.readFileSync(dosya, 'utf8'));
    if (o && typeof o === 'object') {
      d = { sonGonderimMs: Number(o.sonGonderimMs) || 0,
        bekleyen: o.bekleyen && typeof o.bekleyen === 'object' ? o.bekleyen : {} };
    }
  } catch (_) { /* yok/bozuk — sıfırdan */ }
  const yaz = (v) => {
    try {
      fs.mkdirSync(path.dirname(dosya), { recursive: true });
      const tmp = `${dosya}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(v));
      fs.renameSync(tmp, dosya);
    } catch (e) {
      warn('kabuk erteleme durum dosyası yazılamadı:', e.message);
    }
  };
  d.bekleyen[String(bookId)] = {
    bookId: String(bookId), kod: String(kod || 'ertele'), neden: String(neden || '').slice(0, 200),
    girdiSha, macGirdiSha, kaynakSurumu: kaynakSurumu || '', sonMs: simdi,
  };
  if (process.env.EMPP_BILDIRIM === '0' || simdi - d.sonGonderimMs < KABUK_ERTELE_ARALIK_MS) {
    yaz(d);
    return false;
  }
  const bekleyenler = Object.values(d.bekleyen);
  const args = ['kosucu', kabukErteleOzetMetni(bekleyenler), '-b',
    `⏸ ${bekleyenler.length} set kabuk eki bekliyor`, '-p', 'normal', '-e', 'pause_button'];
  try {
    if (gonder) gonder(args);
    else {
      const ikili = process.env.EMPP_BILDIR_IKILI
        || path.join(os.homedir(), '.local', 'bin', 'bildir');
      const ps = spawn(ikili, args, { stdio: 'ignore', detached: true, timeout: 20000 });
      ps.on('error', (e) => warn('kabuk erteleme bildirimi gönderilemedi:', e.message));
      ps.unref();
    }
  } catch (e) {
    warn('kabuk erteleme bildirimi gönderilemedi:', e.message);
  }
  yaz({ sonGonderimMs: simdi, bekleyen: {} });
  return true;
}

// KABUK EKİ ÖN KONTROL BELLEĞİ (birleşik inceleme Ö3 + yeniden inceleme Önemli-1): kabuk adımı
// HER ertelemede o anki `son.json` kimliğini ({uretildi, girdiSha}; son.json yoksa ikisi null)
// yerel dosyaya yazar. Sonraki claim'de son.json DEĞİŞMEMİŞSE (liste boyundan bağımsız) taban
// İNDİRİLMEDEN ertelenir (1–3 GB boşa inmesin). Ömür nedene göre: eke bağlı (ek yok/bayat/bozuk/
// ret/imza/sapma/kapı RED) 24 sa; geçici (ağ/Web-Z/eşleme/claim) 2 sa. Başarıda kayıt silinir.
const KABUK_ON_KONTROL_OMUR_MS = Number(process.env.EMPP_KABUK_ON_KONTROL_OMUR_MS
  || 24 * 3600 * 1000);
const KABUK_ON_KONTROL_GECICI_OMUR_MS = Number(process.env.EMPP_KABUK_ON_KONTROL_GECICI_OMUR_MS
  || 2 * 3600 * 1000);
const KABUK_EKE_BAGLI = /^(ek-(yok|bayat|bozuk|ret|yol|tavan|imza|imza-anahtari-yok|sapma)|kapi-red)$/;

function kabukOnKontrolOku() {
  try {
    const d = JSON.parse(fs.readFileSync(CONFIG.kabukOnKontrolDosyasi, 'utf8'));
    return d && typeof d === 'object' ? d : {};
  } catch (_) { return {}; }
}

function kabukOnKontrolYaz(bookId, kayit) {
  const d = kabukOnKontrolOku();
  if (kayit) d[String(bookId)] = kayit; else delete d[String(bookId)];
  try {
    fs.mkdirSync(path.dirname(CONFIG.kabukOnKontrolDosyasi), { recursive: true });
    const tmp = `${CONFIG.kabukOnKontrolDosyasi}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(d));
    fs.renameSync(tmp, CONFIG.kabukOnKontrolDosyasi);
  } catch (e) {
    warn('kabuk ön kontrol durum dosyası yazılamadı:', e.message);
  }
}

/**
 * son.json kimliği önceki ertelemedekiyle aynı mı (kaydın kendi ömrü içinde). `son` null = son.json
 * yok; kayıt da null kimlik taşıyorsa "değişmedi" sayılır. SAF.
 */
function sonDegismedi(kayit, son, simdi = Date.now()) {
  if (!kayit) return false;
  const omur = Number(kayit.omurMs) || KABUK_ON_KONTROL_OMUR_MS;
  if (simdi - (Number(kayit.zaman) || 0) > omur) return false;
  const s = son || {};
  return String(kayit.uretildi ?? '') === String(s.uretildi ?? '')
    && String(kayit.girdiSha ?? '') === String(s.girdiSha ?? '');
}

/**
 * Build'i olmayan iş: HİÇBİR ŞEY indirilmez; kira açıkça bırakılır (sunucu işi kuyruğun sonuna
 * atar + ajan dışlama backoff'u), özet bildirime eklenir, `failed` YAZILMAZ.
 * @returns {Promise<boolean>} kira bırakıldı mı
 */
async function kaynakYokBekle(auth, job, sebep) {
  // Kirayı bırakmadan ÖNCE nabızdan düş: aradaki bir heartbeat `heldJobs` ile kirayı tazeleyip
  // bırakılan işi bu ajana geri bağlamasın (30.09 1aa-7 dersi; ertelenebilir dal da release'i
  // processJob'un finally'sinden SONRA çağırır).
  currentJob = null;
  const birakildi = await releaseJob(auth, job, sebep);
  warn(`${KAYNAK_YOK_ISARETI} ${job.bookId} ${job.platform}: ${sebep} — exe İNDİRİLMEDİ, failed YAZILMADI, `
    + (birakildi ? 'kira BIRAKILDI (kuyruğun sonunda)' : 'kira bırakılamadı (süre dolunca kuyruğa döner)'));
  kaynakYokOzet({ bookId: job.bookId, bookTitle: job.bookTitle, platform: job.platform });
  return birakildi;
}

// ---------------------------------------------------------------------------
// One job, end to end.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// TELEFON BİLDİRİMİ (ntfy, 2026-09-18 — Nadir talebi: "yapılan ve yapılamayan
// paketlerin bildirimleri bana gelsin"). Sessiz başarısızlık YASAK ama bildirim
// üretimi ASLA düşürmez: hata yalnız log'a yazılır. Kanal: `paket`.
// Kapatmak için EMPP_BILDIRIM=0.
// ---------------------------------------------------------------------------
function bildirGonder({ basarili, bookId, bookTitle = '', platform, ayrinti = '', boyutMb = null }) {
  if (process.env.EMPP_BILDIRIM === '0') return;
  const kitap = bookTitle && bookTitle !== bookId ? `${bookId} ${bookTitle}` : String(bookId);
  const ikili = process.env.EMPP_BILDIR_IKILI || path.join(os.homedir(), '.local', 'bin', 'bildir');
  const baslik = basarili ? `✅ ${platform} üretildi` : `❌ ${platform} ÜRETİLEMEDİ`;
  const govde = basarili
    ? `${kitap} — ${boyutMb ? boyutMb + ' MB, ' : ''}kapıdan geçti ve yüklendi`
    : `${kitap} — ${String(ayrinti || '').slice(0, 300)}`;
  const args = ['paket', govde, '-b', baslik, '-p', basarili ? 'normal' : 'yuksek',
    '-e', basarili ? 'white_check_mark' : 'warning'];
  try {
    const [komut, komutArgs] = ikiliKomutu(ikili, args);
    const ps = spawn(komut, komutArgs, { stdio: 'ignore', detached: true, timeout: 20000, windowsHide: true });
    ps.on('error', (e) => warn('bildirim gönderilemedi:', e.message));
    ps.unref();
  } catch (e) {
    warn('bildirim gönderilemedi:', e.message);
  }
}

// AKTİVASYON KODLU SERİLER (Nadir kuralı 2026-09-18): Privilege · Marvel · Impact ·
// Influence · Power ve YKS-DİL dergileri açılışta aktivasyon kodu ister — bu ARIZA DEĞİL,
// motorun çalıştığının kanıtıdır. ProBook kapısı bu kitaplarda renk-zenginliği eşiğini
// aramaz (diyalog az renk içerir); boş/beyaz ekran yine reddedilir.
// Defterdeki kalıcı kayıt: pipeline_book_summaries.notes → [aktivasyon-kodlu] (12 kitap).
const AKTIVASYON_SERILERI = /(privilege|marvel|impact|influence|power|ydt|yks)/i;
/** Bu kitapta aktivasyon ekranı BEKLENİR mi? */
function aktivasyonBeklenir(baslik) {
  return AKTIVASYON_SERILERI.test(String(baslik || ''));
}

/**
 * R2 hedef anahtarı (bilgi): kira bizdeyken presign sorulur, yükleme YAPILMAZ. Hazır kuyruk
 * manifest'ine yazılır; yayında anahtar yine presign yanıtından gelir. Asla fırlatmaz.
 */
async function r2HedefYoklama(auth, job) {
  try {
    const p = await presignUpload(auth, job);
    return { r2ObjectKey: p.r2ObjectKey || null, publicUrl: p.publicUrl || null, kaynak: 'presign (hazır anı, yükleme yok)' };
  } catch (e) {
    return { r2ObjectKey: null, kaynak: 'presign yanıt vermedi — yayın anında belirlenir', hata: agHatasiOzeti(e) };
  }
}

/**
 * "İmza bekliyor" bildirimi (§2a). YENİ sunucu (`imza-hold-20261002`) `durum:'imza-bekliyor'`u TUTAR:
 * satır running + kira sahibi bu ajan kalır, lease NULL (claim/stale-recovery görmez), completed
 * YAZILMAZ, müşteri eski dosyayı almaya devam eder; imza bekçisi aynı ajan jetonuyla `/result`
 * ile yayınlar. ESKİ sunucu alanı yok sayıp satırı kuyruğa bırakır (`tutuldu` yok) → bu hâlde iş
 * yeniden kiralanınca `hazirIsiDevral` hazır kaydı devralır (eski davranış, kayıp yok).
 * `currentJob` ÖNCE düşer: aradaki heartbeat `heldJobs` ile NULL lease'i 30 dk'ya tazeleyip tutmayı
 * bozmasın (1aa-7 dersi).
 * @returns {Promise<{ok:boolean, tutuldu:boolean}>}
 */
async function imzaBekliyorBildir(auth, job, hazirKayit, sebep) {
  currentJob = null;
  const r = await releaseJobYanit(auth, job,
    `[${windowsHazir.IMZA_BEKLIYOR_FAZI}] ${sebep || ''} — hazır: ${path.basename(hazirKayit.dizin)}`,
    { durum: windowsHazir.IMZA_BEKLIYOR_FAZI, hazir: path.basename(hazirKayit.dizin) });
  const durum = r.tutuldu ? 'sunucuda TUTULDU (kira bizde, kuyruğa dönmez; bekçi yayınlar)'
    : r.ok ? 'kira bırakıldı (eski sunucu: kuyruğa döndü, yeniden kiralanınca hazır kayıt devralınır)'
      : 'kira dolunca döner';
  warn(`windows: ${job.bookId} İMZA BEKLİYOR — failed YAZILMADI, ${durum}; R2'ye yazılmadı (${hazirKayit.dizin})`);
  return r;
}

/**
 * Hazır kuyrukta bekleyen paketi devral (aynı kitap + sürüm yeniden kiralandı): yuva açıksa imzala →
 * doğrula → imzalı kabul → yayınla → `yayinlandi/`'ye taşı; kapalıysa yeniden üretmeden imza-bekliyor.
 */
async function hazirIsiDevral(auth, job, winPlan, bekleyen, work) {
  // KABUL KUYRUĞU (05.10): kayıt kabul işçisinde bekliyor — YENİDEN ÜRETİLMEZ, kabul burada koşmaz;
  // sunucu tutması yenilenir (eski sunucu satırı kuyruğa bırakmıştı). Bayraktan BAĞIMSIZ: bayrak
  // kapatılsa da kalan kabul-bekliyor kayıtları işçi boşaltır.
  if (bekleyen.manifest && bekleyen.manifest.durum === windowsHazir.KABUL_BEKLIYOR) {
    log(`windows: ${job.bookId} ${winPlan.surum} zaten kabul kuyruğunda (${bekleyen.dizin}) — yeniden ÜRETİLMEDİ`);
    const r = await imzaBekliyorBildir(auth, job, bekleyen, `${windowsHazir.KABUL_KUYRUGU_ISARETI} imzasız kabul işçide bekliyor (yeniden kiralama)`);
    if (r.tutuldu) return { ertelendi: true, imzaBekliyor: true, kabulKuyrugu: true, sebep: 'kabul kuyruğunda' };
    return kabulSatirIciYedek(auth, job, winPlan, bekleyen.dizin, work);
  }
  const kip = await windowsSerit.imzaKipiSec(CONFIG);
  if (kip.kip !== 'yuva' || !(await windowsSerit.imzaYuvasiErisilirMi(CONFIG))) {
    log(`windows: ${job.bookId} ${winPlan.surum} zaten hazır kuyrukta (${bekleyen.dizin}) — yuva kapalı, yeniden ÜRETİLMEDİ`);
    await imzaBekliyorBildir(auth, job, bekleyen, kip.sebep);
    return { ertelendi: true, imzaBekliyor: true, sebep: kip.sebep };
  }
  // Kayıt kilidi: imza bekçisi aynı kaydı işliyorsa ikinci kez imzalanıp İKİ KEZ yayınlanmasın.
  const kayitKilidi = await windowsHazir.kayitKilidiDene(bekleyen.dizin);
  if (!kayitKilidi) {
    log(`windows: hazır kayıt (${bekleyen.dizin}) şu an imza bekçisinde — devralınmadı`);
    await imzaBekliyorBildir(auth, job, bekleyen, 'imza bekçisi bu paketi işliyor');
    return { ertelendi: true, imzaBekliyor: true, sebep: 'bekçi işliyor' };
  }
  try {
    return await hazirKaydiYayinla(auth, job, winPlan, bekleyen, work);
  } catch (e) {
    // İmza eşiği yeniden aşıldı: paket zaten hazır kayıtta — yeniden imza-bekliyor, iş düşmez.
    if (!windowsSerit.imzaEsigiMi(e)) throw e;
    warn(`windows: ${job.bookId} hazır paket imza eşiğinde yine tamamlanmadı — ${e.message}`);
    await imzaBekliyorBildir(auth, job, bekleyen, 'imza eşiği aşıldı (hazır paket devrinde)');
    return { ertelendi: true, imzaBekliyor: true, sebep: 'imza eşiği aşıldı' };
  } finally {
    await kayitKilidi();
  }
}

/**
 * KABUL KUYRUĞU YEDEĞİ (05.10 inceleme Ö2): sunucu imza-bekliyor tutmasını yapmadıysa (`tutuldu:false` —
 * eski sunucu satırı kuyruğa bıraktı ya da /release düştü) kuyruk bu iş için devre dışı kalır: imzasız
 * kabul burada, satır içi koşar. Yoksa eski sunucuda iş → kuyruk → yeniden kiralama → yine kuyruk döngüsü
 * olur. Kabul işçisiyle AYNI kayıt kilidi ve AYNI GEÇTİ işleyişi (`kabulGectiIsle`); GEÇTİ sonrası kayıt
 * imza-bekliyor olur ve bugünkü hazır kayıt yolu (`hazirIsiDevral`) devam eder. KALDI → `reddedildi/` +
 * fırlatır (ana döngü failed yazar, aynı metin); ÖLÇÜLEMEDİ → kayıt yerinde, fırlatır (ertelenebilir).
 */
async function kabulSatirIciYedek(auth, job, winPlan, kayitDizini, work) {
  warn(`windows: ${job.bookId} UYARI — sunucu imza-bekliyor TUTMADI (eski sunucu ya da /release düştü); `
    + 'kabul kuyruğu bu iş için devre dışı, imzasız kabul SATIR İÇİ koşuyor');
  currentJob = { bookId: job.bookId, platform: job.platform }; // kira hâlâ bizdeyse nabız tazelesin
  const kilit = await windowsHazir.kayitKilidiDene(kayitDizini);
  if (!kilit) {
    log(`windows: kayıt (${kayitDizini}) şu an kabul işçisinde — satır içi kabul yapılmadı`);
    currentJob = null;
    return { ertelendi: true, imzaBekliyor: true, kabulKuyrugu: true, sebep: 'kabul işçisi bu kaydı işliyor' };
  }
  try {
    const m = await windowsHazir.manifestOku(kayitDizini);
    if (!m || !m.exe) throw new Error(`[windows-serit] kabul kuyruğu kaydı okunamadı: ${kayitDizini}`);
    const giris = { dizin: kayitDizini, manifest: m, exeYolu: path.join(kayitDizini, m.exe) };
    if (m.durum === windowsHazir.KABUL_BEKLIYOR) {
      let k;
      try {
        k = await windowsSerit.kabulKos({
          exe: giris.exeYolu, job, work, cfg: CONFIG, log, aktivasyon: aktivasyonBeklenir(job.bookTitle), etiket: 'imzasiz', sleep,
        });
      } catch (e) {
        const mesaj = String((e && e.message) || e);
        if (!ertelenebilirKaynakHatasi(e) && /kabul kapısından geçemedi \((KALDI|RED)\)/.test(mesaj)) {
          await windowsHazir.sonuclandir(CONFIG, giris, 'reddedildi', { durum: 'red', sebep: mesaj, zamanRed: new Date().toISOString(), kabulIsleniyor: null });
        }
        throw e;
      }
      await windowsHazir.kabulGectiIsle(CONFIG, giris, k, log);
    }
  } finally {
    await kilit();
  }
  const guncel = await windowsHazir.hazirBul(CONFIG, job.bookId, winPlan.surum);
  if (!guncel || guncel.manifest.durum !== windowsHazir.IMZA_BEKLIYOR_FAZI) {
    currentJob = null;
    return { ertelendi: true, sebep: 'kabul kuyruğu kaydı satır içi kabulden sonra imza-bekliyor değil' };
  }
  return hazirIsiDevral(auth, job, winPlan, guncel, work);
}

/**
 * İmzalı son sürüm arşivi (Nadir 06.10, kasa D:) — imza bekçisiyle AYNI adım (`imzali-arsiv.js`).
 * win32 dışında kök yok → no-op. ASLA fırlatmaz; yayını etkilemez.
 */
async function imzaliSonArsivle(zincir, yayin, job, surum, exeAdi) {
  try {
    const iz = (zincir && zincir.kanit && zincir.kanit.imzali) || {};
    await imzaliArsiv.arsivle({
      kaynak: zincir.imzaliYol, bookId: job.bookId, exeAdi, beklenenSha256: iz.sha256 || null,
      meta: {
        baslik: job.bookTitle || null, surum, imzaZamani: iz.zamanDamgasi || null,
        yayinZamani: new Date().toISOString(), r2Anahtari: (yayin && yayin.r2ObjectKey) || null,
      },
      log: (s) => log(s), bildir: imzaliArsiv.varsayilanBildir({ log: (s) => warn(s) }),
    });
  } catch (e) { warn('windows: UYARI imzalı arşiv adımı:', e.message); }
}

async function hazirKaydiYayinla(auth, job, winPlan, bekleyen, work) {
  await windowsSerit.araclariDenetle(CONFIG, { yuva: true });
  log(`windows: hazır kuyruktaki paket devralındı (${bekleyen.dizin}) — imzalanıp yayınlanacak, yeniden üretim YOK`);
  let kanit = null;
  try { kanit = JSON.parse(await fsp.readFile(windowsSerit.kanitYolu(CONFIG, job.bookId, winPlan.surum), 'utf8')); } catch (_) { kanit = null; }
  const m = bekleyen.manifest;
  if (!kanit) {
    kanit = {
      bookId: String(job.bookId), bookTitle: job.bookTitle || null, surum: winPlan.surum, setKimligi: winPlan.setKimligi,
      imzasiz: { md5: m.md5, sha256: m.sha256, boyut: m.boyut }, kapi: m.kanit && m.kanit.kapi, kokIndex: m.kanit && m.kanit.kokIndex,
      kabulImzasiz: 'GECTI', kabulImzasizKapi: m.kabulKapi, kabulImzasizKanit: m.kabulKanit,
    };
  }
  kanit.hazirDizini = bekleyen.dizin;
  const zincir = await windowsSerit.imzaliYayinZinciri({
    imzasiz: bekleyen.exeYolu, job, work, cfg: CONFIG, log, sleep, aktivasyon: aktivasyonBeklenir(job.bookTitle), kanit,
    esikMs: CONFIG.winHazirAcik ? Number(CONFIG.winImzaEsikMs) || 0 : 0,
  });
  const yayin = await postResultSuccess(auth, job, zincir.imzaliYol);
  await windowsSerit.yayinKaniti(zincir, yayin, CONFIG, log);
  try {
    const s = await windowsHazir.sonuclandir(CONFIG, bekleyen, 'yayinlandi', {
      durum: 'yayinlandi', yayin: { r2ObjectKey: yayin.r2ObjectKey, publicUrl: yayin.publicUrl, zaman: new Date().toISOString(), yayinlayan: 'runner' },
      imzali: zincir.kanit.imzali,
    });
    log('windows: hazır paket yayınlandı →', s.dizin);
  } catch (e) { warn('windows: UYARI hazır kayıt yayinlandi/\'ye taşınamadı:', e.message); }
  await imzaliSonArsivle(zincir, yayin, job, winPlan.surum, m.exe);
  bildirGonder({ basarili: true, bookId: job.bookId, bookTitle: job.bookTitle, platform: job.platform, boyutMb: Math.round(m.boyut / 1e6) });
  return { yayinlandi: true };
}

/**
 * Hazır kaydın bayat kararı + (bayatsa) `bayat/`'a taşıma. Taşıma kayıt kilidiyle sarılır: bekçi aynı
 * kaydı işliyorsa dokunulmaz ("bekçi işliyor" yolu). @returns {Promise<{bayat:boolean, sonuc?:object}>}
 */
async function hazirBayatKontrol(auth, job, bekleyen, gecerliKaynakSurumu) {
  const gecerliKanonik = await windowsHazir.gecerliKanonikOku(CONFIG);
  const k = windowsHazir.bayatKarari(bekleyen.manifest, { gecerliKaynakSurumu, gecerliKanonik });
  if (k.bilinmiyor) warn(`windows: ${job.bookId} hazır kayıt bayat kıyası yapılamadı: ${k.bilinmiyor}`);
  if (!k.bayat) return { bayat: false };
  const kilit = await windowsHazir.kayitKilidiDene(bekleyen.dizin);
  if (!kilit) {
    log(`windows: hazır kayıt (${bekleyen.dizin}) şu an imza bekçisinde — bayat taşıması yapılmadı`);
    await imzaBekliyorBildir(auth, job, bekleyen, 'imza bekçisi bu paketi işliyor');
    return { bayat: true, sonuc: { ertelendi: true, imzaBekliyor: true, sebep: 'bekçi işliyor' } };
  }
  try {
    const b = await windowsHazir.bayatKenaraAl(CONFIG, bekleyen, k);
    warn(`windows: ${job.bookId} hazır kayıt BAYAT (${b.sebep}) — imza istenmedi, ${b.dizin}'e alındı; yeniden üretilecek`);
  } finally {
    await kilit();
  }
  return { bayat: true };
}

/**
 * İŞ DİZİNİ AÇ — disk tam doluyken de iş DURMAZ (inceleme Ö-A, 06.10). mkdtemp ENOSPC verirse önce disk
 * temizlik bekçisi (taban GB: pardus PARDUS_DISK_TABAN_GB, windows winUretMinBosGb), sonra BİR kez daha
 * denenir; yine ENOSPC ise iş ERTELENİR (DISK_KAPISI_ISARETI — failed yazılmaz, kira bırakılır).
 * @param {string} packagerPlatform
 * @param {{mkdtemp?:(p:string)=>Promise<string>, temizlik?:(o:object)=>Promise<object>}} [enjekte] testler için
 * @returns {Promise<string>} iş dizini
 */
async function isDiziniAc(packagerPlatform, { mkdtemp = (p) => fsp.mkdtemp(p), temizlik = (o) => diskTemizlik.yerAc(o) } = {}) {
  const onEk = path.join(os.tmpdir(), 'empp-agent-');
  try {
    return await mkdtemp(onEk);
  } catch (e) {
    if (!e || e.code !== 'ENOSPC') throw e;
    const taban = packagerPlatform === 'windows'
      ? (Number(CONFIG.winUretMinBosGb) || 15)
      : (Number(process.env.PARDUS_DISK_TABAN_GB) || 15);
    warn(`iş dizini açılamadı (ENOSPC, ${os.tmpdir()}) — disk temizliği (hedef ${taban} GB), sonra bir kez daha`);
    await temizlik({ gerekliGb: taban, log, warn, zorla: true });
  }
  try {
    return await mkdtemp(onEk);
  } catch (e) {
    if (e && e.code === 'ENOSPC') {
      throw new Error(`${DISK_KAPISI_ISARETI} iş dizini açılamadı (ENOSPC) — disk temizliği sonrası da yer yok; iş ertelendi`);
    }
    throw e;
  }
}

/** Arşiv zip'i içeriksiz (motor-only) ise `arsiv.iceriksiz = true`: kaynak kararı set + üreteçte üretece düşer. */
async function arsivIceriksizIsaretle(arsiv, bookId, log) {
  if (!arsiv || !arsiv.zip) return;
  const z = await icerikKapisiDenetleZip(arsiv.zip, { kaynakAdi: bookId, log });
  if (!z.gecti && String(z.sebep || '').startsWith('[kaynak-iceriksiz]')) arsiv.iceriksiz = true;
}

async function processJob(auth, job) {
  const packagerPlatform = mapPlatform(job.platform);
  if (!packagerPlatform) {
    throw new Error(`unsupported platform for this agent: ${job.platform}`);
  }
  log('job:', job.bookId, job.platform, '->', packagerPlatform);
  // Mark in-flight so the heartbeat keeps this job's lease alive during a long build.
  currentJob = { bookId: job.bookId, platform: job.platform };

  let work;
  try { work = await isDiziniAc(packagerPlatform); } catch (e) { currentJob = null; throw e; }
  // Sahip işareti (inceleme Ö6, 06.10): disk temizlik bekçisi sahibi canlı iş dizinini atlar.
  // Yazım yarım kalırsa (ENOSPC) dosya KALDIRILIR: boş/yarım işaret bekçide "yok" sayılır (K3).
  const sahipDosyasi = path.join(work, '.empp-sahip.pid');
  try { fs.writeFileSync(sahipDosyasi, String(process.pid)); } catch (e) {
    try { fs.rmSync(sahipDosyasi, { force: true }); } catch (_) { /* dizin de yoksa iş zaten düşer */ }
    warn(`iş dizini sahip işareti yazılamadı (${e.code || e.message}) — temizlik bekçisi yalnız yenilik kuralıyla korur`);
  }
  try {
    // WINDOWS ŞERİDİ ön koşulu (SAF) — kaynak İNDİRİLMEDEN (windows-serit.js): claim sürümü
    // 2.<panel kodu>.<paket sayacı> (sözleşme madde 1), kimlik = book_id, G tabanı https. Düşerse iş
    // görünür hatayla düşer (aşağıdaki catch: bekçi bildirimi). Araç/yuva denetimi (araclariDenetle)
    // KAYNAK KARARINDAN SONRA (inceleme 01.10): build yoksa windows işi araç eksikliğiyle failed
    // olmasın, kira bırakılsın.
    const winPlan = packagerPlatform === 'windows' ? windowsSerit.onKosul(job) : null;
    // HAZIR KUYRUK KISA DEVRESİ (§2a, 02.10): aynı kitap + sürüm zaten "imza bekliyor"sa YENİDEN
    // ÜRETİLMEZ — yuva açıksa o paket imzalanıp yayınlanır, kapalıysa iş yine imza-bekliyor bildirilir.
    // BAYAT KONTROLÜ (04.10, 72378/72379): hazır kayıt (a) sunucunun geçerli kaynağından eski kaynaktan ya da
    // (b) kanoniksiz/eski kanonik motor-kabukla üretilmişse imzaya/R2'ye GİTMEZ; `bayat/`'a alınır
    // (silinmez) ve iş yeni kaynakla üretilir. Geçerli kaynak sürümü = claim `r2-al` kaynakSurumu. `r2-kur`
    // claim'inde sürüm ancak kaynak kurulunca bilinir (içerik değişmediyse AYNI kalır, 72380) → karar
    // `hazirErtelenen` ile kurulumdan SONRAYA bırakılır.
    let hazirErtelenen = null;
    if (winPlan) {
      const bekleyen = await windowsHazir.hazirBul(CONFIG, job.bookId, winPlan.surum);
      const zaman = windowsHazir.bayatKararZamani(job);
      if (bekleyen && zaman.ertele) hazirErtelenen = bekleyen;
      else if (bekleyen) {
        const b = await hazirBayatKontrol(auth, job, bekleyen, zaman.kaynakSurumu);
        if (b.sonuc) return b.sonuc;
        if (!b.bayat) return await hazirIsiDevral(auth, job, winPlan, bekleyen, work);
      }
    }

    // 1-3. KAYNAK — EXE'SİZ SÖZLEŞME (Nadir 01.10, book-update exesiz-kaynak-sozlesmesi.md):
    //      İmpark exe'si HİÇBİR koşulda indirilmez (ne paket kaynağı ne önbellek ne HEAD ne hazır
    //      paket devri). Kaynak TEK fonksiyondan seçilir (kaynak-karari.js):
    //        manuel build.zip (claim kaynakTuru=manuel ya da /sources/ · /kaynak/ adresi) → olduğu gibi;
    //        kaynak arşivi (kaynak-arsivi.js) → arşiv + merdiven + set eki (bugünkü davranış);
    //        ikisi de yoksa → kira bırakılır + bildirim, failed YAZILMAZ (sözleşme §6a "üretim BEKLER").
    //      Manuel işte arşiv OKUNMAZ: bozuk bir arşiv kaydı manuel kaynağı düşürmesin. İşin exe adı
    //      arşive YALNIZ bilgi notu için verilir (27.09 ad kapısı kaldırıldı, kaynak-arsivi.js).
    // Sunucu 'arsiv-gerekli' claim'inde exe adresini yalnız BİLGİ olarak `bilgiUrl`de gönderir
    // (indirilebilir alanda durmaz); adın kaynağı odur, yoksa eski claim'lerin downloadUrl'i.
    const imparkBilgiUrl = job.bilgiUrl || job.downloadUrl || '';
    const imparkSrcVersion = imparkBilgiUrl ? srcVersionTuret(imparkBilgiUrl) : '';
    // Arşiv yalnız gerektiğinde okunur (kaynak-karari `arsivOkunurMu`): manuel işte, r2-al'de (arşiv
    // orada önbellek — `r2Onbellek` ayrı okur) ve tabanUrl'li r2-kur'da OKUNMAZ.
    const arsiv = !arsivOkunurMu(job) ? null
      : await arsivKaynagi(job.bookId, { imparkKaynagi: imparkSrcVersion, bilgi: log });
    await arsivIceriksizIsaretle(arsiv, job.bookId, log);
    const kaynak = kaynakKarari({ job, arsiv, uretec: uretecKaynak.uretecAcik() });
    // r2-kur kurulamıyor (taban yok / claim sözleşme dışı): kurma kilidini HEMEN bırak — sunucu
    // build'i başka ajana ya da sonraya verir; kilit kurulumBitis'e kadar asılı kalmasın.
    if (kaynak.r2Kur) {
      await kaynakIstemcisi(auth).birak({
        bookId: job.bookId, platform: job.platform, surum: job.kaynakSurumu, sebep: kaynak.sebep,
      });
    }
    // Sözleşme dışı R2 claim'i: hiçbir şey indirilmez, iş görünür hatayla düşer (failed + bildirim).
    if (kaynak.tur === 'gecersiz') {
      throw new Error(`${kaynakR2.R2_ISARETI} ${kaynak.sebep}`);
    }
    if (kaynak.tur === 'yok') {
      await kaynakYokBekle(auth, job, kaynak.sebep);
      return { ertelendi: true, sebep: kaynak.sebep };
    }
    // r2-kur YALNIZ yüksek bantta (heartbeat `kaynak-kur` ile aynı karar): yetenek evde bildirilmez;
    // bayat bir nabızla yine de gelirse 1–3 GB yükleme başlatılmaz, kilit ve kira bırakılır.
    // K1 değişmezi iş anında da: Mac dışında kabuğu kuramayan ajan build KURMAZ (bayat nabızla
    // gelen claim dahil); kilit + kira bırakılır, failed YOK.
    const kabukKarari = kaynak.tur === 'r2-kur'
      ? setKabuk.kaynakKurKabukKarari({ platform: _platform }) : null;
    if (kabukKarari && !kabukKarari.uygun) {
      return r2Ertele(auth, job, `${setKabuk.ISARET} ${kabukKarari.neden} — build kurulmadı`);
    }
    if (kaynak.tur === 'r2-kur' && !kaynakR2.kaynakKurIzinli(kaynakKurDurumu())) {
      return r2Ertele(auth, job, 'kaynak-kur bu konumda kapalı (ofis dışı, serbest bayrağı yok) — build kurulmadı');
    }
    // KABUK EKİ ÖN KONTROLÜ (06.10, kabuk-eki-tasarim.md §1): 'ek' kipinde (ProBook) set kabuğu
    // Mac'in yayınladığı ekten gelir. Uygunluk (bookN / tek motor) ancak taban açılınca bilinir;
    // tabandan önce bilinen tek işaret claim set listesidir. Liste ≥2 kitap diyorsa (set) ve CDN'de
    // bu kitabın `son.json`'u HİÇ yoksa taban İNDİRİLMEDEN ertelenir (1–3 GB boşa inmesin). Burada
    // yalnız "son.json var mı" sorulur; girdiSha eşleşmesi kabuk adımında. Liste yok/tek kitapsa ön
    // kontrol yapılmaz (tek kitap kalıcı ertelemede kalmasın); set çıkarsa kabuk adımı ertele döner.
    // Ö3: son.json önceki eke bağlı ertelemedekiyle AYNIYSA (Mac yeni ek üretmedi) yine indirilmez.
    // Önemli-1: son.json liste boyundan bağımsız sorulur (bellek beslenir); "son.json yok → ertele"
    // kuralı yalnız ≥2 kitaplı listede.
    let onSon = null;
    let onSorgulandi = false;
    if (kaynak.tur === 'r2-kur' && setKabuk.acik() && setKabuk.kabukKaynagiSec() === 'ek') {
      const liste = setEk.setListesiAyristir((setEk.setListesiCoz({ job }) || {}).ham || '');
      const set = liste.filter((g) => !g.link).length >= 2;
      const on = await kaynakAdim.kabukEkSonKontrol({ bookId: job.bookId });
      onSorgulandi = true;
      onSon = on && on.var ? on.son || null : null;
      const kayit = kabukOnKontrolOku()[String(job.bookId)];
      let neden = null;
      if (set && !(on && on.var)) {
        neden = `${setKabuk.ISARET} kabuk eki yok — ${(on && on.neden) || 'son.json okunamadı'}`;
      } else if (sonDegismedi(kayit, onSon)) {
        neden = `${setKabuk.ISARET} son.json önceki ertelemeden (${kayit.kod || '-'}) beri değişmedi `
          + `(${String((onSon || {}).girdiSha || '-').slice(0, 12)})`;
      }
      if (neden) {
        neden += '; taban İNDİRİLMEDİ';
        kabukErteleBildir({
          bookId: job.bookId, kod: 'on-kontrol', neden, kaynakSurumu: job.kaynakSurumu,
        });
        return r2Ertele(auth, job, neden, { kilitBirak: true });
      }
    }
    // İmza kipi (§2a): yuva erişilirse bugünkü zincir; erişilemezse (hazır kuyruk açıkken) paket yine
    // üretilir ve kabulden geçer, imzasız hâliyle hazır kuyruğa girer (yayın YOK).
    const winKip = winPlan ? await windowsSerit.imzaKipiSec(CONFIG) : null;
    if (winKip && winKip.kip === 'hazir') log(`windows: imza kipi HAZIR — ${winKip.sebep}; paket üretilip imza kuyruğunda bekletilecek`);
    if (winPlan) await windowsSerit.araclariDenetle(CONFIG, { yuva: winKip.kip === 'yuva' });
    // Pardus paketleyici kimliği (buildPardusArtifact) — exe adından DEĞİL, kaynağın kendisinden.
    const srcVersion = kaynak.tur === 'arsiv' ? arsiv.srcVersion : `manuel-${srcVersionTuret(kaynak.url)}`;
    // R2 build'inin kimliği sürümüdür (Dalga B): `r2-<sürüm>`; diğer kaynaklarda yukarıdaki.
    const r2Kaynak = kaynak.tur === 'r2-al' || kaynak.tur === 'r2-kur';
    let paketKaynakKimligi = r2Kaynak ? `r2-${kaynak.surum}` : srcVersion;
    const kaynakAdi = r2Kaynak ? `r2:${kaynak.surum}` : kaynak.tur === 'arsiv'
      ? `arsiv:${arsiv.etiket || arsiv.md5.slice(0, 12)}`
      : path.basename(String(kaynak.url).split('?')[0]) || undefined;
    const zipPath = path.join(work, 'build.zip');

    // ERKEN DİSK KAPISI (2026-09-18, ölçümle): pardus işi bu makinede derlenecek; kapı kaynak
    // indirilmeden/kopyalanmadan ÖNCE sorulur. BOYUT ORANTILI (2026-09-19): eşik kaynağın
    // sıkıştırılmış boyutundan türer (runner-helpers `pardusGerekliDiskGb`). Boyut YALNIZ yerelden
    // (arşiv zip'i) ölçülür — uzak adrese HEAD atılmaz (exe'siz sözleşme); manuelde taban eşik.
    // Kapı düşerse bu bir PAKET KUSURU DEĞİLDİR — `failed` yazılmaz, kira bırakılır.
    if (packagerPlatform === 'pardus') {
      // r2-al: boyut claim'den (kaynakBoyut); arşiv/r2-kur arşiv tabanı: yerel zip'ten.
      const kaynakBayt = kaynak.tur === 'r2-al' ? kaynak.boyut
        : await kaynakBoyutuTahmin({ yerelZip: arsiv ? arsiv.zip : null });
      const gerekliGb = pardusGerekliDiskGb({
        kaynakBayt,
        kat: Number(process.env.PARDUS_DISK_KAT || 5),
        tabanGb: Number(process.env.PARDUS_DISK_TABAN_GB || 15),
        elleGb: process.env.PARDUS_MIN_FREE_GB ? Number(process.env.PARDUS_MIN_FREE_GB) : null,
      });
      let bosGb = diskBosGb(os.tmpdir());
      const kaynakMb = kaynakBayt ? `${(kaynakBayt / 1e6).toFixed(0)} MB` : 'bilinmiyor';
      // DİSK DOLU → İŞİ DURDURMA, YER AÇ (Nadir 06.10): ProBook'ta önce temizlik bekçisi (en eski
      // bizim dosyamızdan), sonra yeniden ölç; kapı ancak temizlikten sonra hâlâ darsa erteler.
      // ÇALIŞAN İŞİN KAYNAĞI KORUNUR (inceleme K1, 06.10): bu işin arşiv dizini ve iş dizini --koru ile
      // verilir; temizlik sonrası arşiv zip'i yine de yoksa iş ERTELENİR (failed yazılmaz).
      if (bosGb !== null && bosGb < gerekliGb) {
        await diskTemizlik.yerAc({ gerekliGb, log, warn, koru: [work, ...(arsiv && arsiv.zip ? [path.dirname(arsiv.zip)] : [])] });
        bosGb = diskBosGb(os.tmpdir());
        if (arsiv && arsiv.zip && !fs.existsSync(arsiv.zip)) {
          throw new Error(`${DISK_KAPISI_ISARETI} disk temizliği sonrası kaynak arşivi yok (${arsiv.zip}); iş ertelendi`);
        }
      }
      if (bosGb !== null && bosGb < gerekliGb) {
        throw new Error(
          `${DISK_KAPISI_ISARETI} pardus disk kapısı — ${bosGb} GB boş < ${gerekliGb} GB gerekli `
          + `(kaynak ${kaynakMb}); kaynak İNDİRİLMEDİ, iş ertelendi, paket şeritte üretilmeli`,
        );
      }
      log(`pardus disk kapısı geçildi: ${bosGb} GB boş >= ${gerekliGb} GB gerekli (kaynak ${kaynakMb})`);
    }

    if (kaynak.tur === 'arsiv') {
      await fsp.copyFile(arsiv.zip, zipPath, fs.constants.COPYFILE_FICLONE);
      log(`kaynak ARŞİVDEN (${arsiv.etiket || '-'}, md5 ${arsiv.md5}, ${(arsiv.boyut / 1e6).toFixed(0)}MB)`
        + ' — İmpark exe indirilmedi, yayıncı güncellemesi uygulanmadı');
    }
    if (kaynak.tur === 'manuel') {
      await manuelBuildHazirla({ url: kaynak.url, zipPath, work, bookId: job.bookId });
    }
    // DALGA B (B4): r2-al → hazır build (önbellek ya da imzalı GET + sha256/boyut doğrulama), olduğu
    // gibi; r2-kur → taban (R2 önceki geçerli build ya da arşiv). Kalanı aşağıdaki zincir.
    let r2OncekiBoyut = null;
    let r2OncekiEnvanter = null;
    try {
      if (kaynak.tur === 'r2-al') {
        await r2AlHazirla({ bookId: job.bookId, kaynak, zipPath, work });
      }
      if (kaynak.tur === 'r2-kur') {
        const taban = await r2KurTabanHazirla({ bookId: job.bookId, kaynak, zipPath, work, job });
        r2OncekiBoyut = taban.oncekiBoyut;
        r2OncekiEnvanter = taban.oncekiEnvanter || null;
      }
    } catch (e) {
      // R2 indirmesi ağ hatasıyla tükendi → failed YAZILMAZ: (r2-kur ise kilit) + kira bırakılır.
      if (e && e.gecici) return r2Ertele(auth, job, e.message, { kilitBirak: kaynak.tur === 'r2-kur' });
      throw e;
    }

    // İÇERİKSİZ KAYNAK KAPISI — ZIP YOLU (2026-09-26): her kaynak (arşiv ve manuel) zip olarak gelir;
    // kökte `assets/` YOK ve hiç `bookN/` dizini YOK ise kaynak yalnız motordur (11845 SM3-v49.exe
    // dersi) — iş burada görünür hatayla düşer, R2'ye hiçbir şey yüklenmez. Merdivenden ÖNCE —
    // merdiven "içerik var" varsayımıyla ZKitapZipH indirir, içeriksiz bir kaynağı BÜYÜTMEMELİ.
    const icerikZipSonuc = await icerikKapisiDenetleZip(zipPath, { kaynakAdi, log });
    if (!icerikZipSonuc.gecti) {
      throw new Error(icerikZipSonuc.sebep);
    }

    // İÇERİK MERDİVENİ (S0 + S1) — yalnız ARŞİV kaynağında (manuel build olduğu gibi kullanılır,
    // sözleşme §7 M1). Yalnız İŞ KOPYASI (zipPath) değişir; ZKitapZipH önbelleği <ID>-<Vs> ile
    // anahtarlıdır. Ölçülemeyen ya da kimliği tutmayan kitapta iş görünür hatayla düşer.
    // r2-al de olduğu gibi kullanılır (Dalga B: build R2'de kurulmuş, merdiveni orada geçti).
    const olduguGibiAdi = kaynak.tur === 'r2-al' ? `R2 build ${kaynak.surum} (r2-al)` : 'manuel build';
    if (!kaynak.merdiven && merdivenAcik()) {
      log(`[merdiven] ${olduguGibiAdi} — içerik merdiveni ATLANDI (olduğu gibi kullanılır, sözleşme M1): ${job.bookId}`);
    }
    let merdivenSonuc = null;
    if (kaynak.merdiven && merdivenAcik()) {
      merdivenSonuc = await kaynakAdim.merdiven({
        zip: zipPath, calisma: work, bookId: job.bookId, platform: job.platform, log, warn,
      });
    }
    // SET ÜYELİĞİ bookN EKİ (2026-09-30, sözleşme "Yeni kurulumda eksik set kitabı"): yalnız ARŞİV
    // kaynağında (manuel build olduğu gibi kullanılır, sözleşme §7 M1). Merdivenden SONRA, üç
    // platformun paketleyicisinden ÖNCE. Hiçbir hata paketi DURDURMAZ (eksik-set-kitabi raporu);
    // iş kopyası ya kapıdan geçmiş yeni hâli ya aynen eskisidir (aday kopya + rename).
    if (!kaynak.setEki && setEk.ekAcik()) {
      log(`${setEk.ISARET} ${olduguGibiAdi} — set üyeliği eki ATLANDI (olduğu gibi kullanılır, sözleşme M1)`);
    }
    let setEkiRapor = null;
    const setEkiUygula = async () => {
      if (kaynak.setEki && setEk.ekAcik()) {
        const setListesi = setEk.setListesiCoz({ job });
        // else dalı BİLEREK yok: runner-pardus nöbetçisi processJob'daki ilk else'i pardus dalı sayar.
        if (!setListesi) {
          log(`${setEk.ISARET} set listesi yok (claim setListesi / EMPP_SET_LISTESI_DIZINI) — atlandı`);
        }
        if (setListesi) {
          try {
            setEkiRapor = await kaynakAdim.setEki({
              zip: zipPath, calisma: work, liste: setListesi.ham, listeKaynagi: setListesi.kaynak,
              bookId: job.bookId, platform: job.platform, log, warn,
            });
          } catch (e) {
            warn(`${setEk.ISARET} beklenmeyen hata, paket mevcut bileşimle: ${agHatasiOzeti(e)}`);
          }
        }
      }
    };
    await setEkiUygula();
    // SF425 KABUK TAZELEME (Z2, 05.10, set-kabuk-tazele.js; sözleşme "sf425 kabuk tazeleme"): yalnız
    // r2-kur, set ekinden SONRA, panelden ÖNCE. Bayrak kapalıysa (`EMPP_SET_KABUK_TAZELE`) hiç
    // çağrılmaz. Her hata adımı atlatır (iş kopyası aynen), iş DÜŞMEZ; özet `job.kabukTazeleme`.
    // 'ek' kipinde (ProBook) sonuç `ertele` olabilir → r2Ertele (kilit + kira bırakılır, failed
    // YOK): eski kabukla kaynak çıkmaz. Dönüş: ertelenecekse r2Ertele sonucu, yoksa null.
    const kabukUygula = async () => {
      if (kaynak.tur !== 'r2-kur' || !setKabuk.acik()) return null;
      const ekKipi = setKabuk.kabukKaynagiSec() === 'ek';
      try {
        job.kabukTazeleme = await kaynakAdim.kabukTazele({
          zip: zipPath, calisma: work, job, log, warn,
          ...(onSorgulandi ? { ekSon: onSon } : {}), // ek-sapma teşhisi ikinci GET'siz
        });
      } catch (e) {
        job.kabukTazeleme = {
          durum: ekKipi ? 'ertele' : 'atlandi', kod: 'hata', neden: `beklenmeyen hata: ${agHatasiOzeti(e)}`,
        };
        warn(`${setKabuk.ISARET} beklenmeyen hata, kabuk tazelenmedi: ${agHatasiOzeti(e)}`);
      }
      const k = job.kabukTazeleme;
      if (!k || k.durum !== 'ertele') {
        // ek uygulandı/güncel/atlandı: bellek temizlenir (varsa)
        if (kabukOnKontrolOku()[String(job.bookId)]) kabukOnKontrolYaz(job.bookId, null);
        return null;
      }
      // Önemli-1: HER ertelemede bellek yazılır (geçici nedenler kısa ömürlü).
      let son = onSon;
      if (!son && !onSorgulandi) {
        try {
          const on = await kaynakAdim.kabukEkSonKontrol({ bookId: job.bookId });
          son = on && on.var ? on.son || null : null;
        } catch (_) { son = null; }
      }
      const ekeBagli = KABUK_EKE_BAGLI.test(String(k.kod || ''));
      kabukOnKontrolYaz(job.bookId, {
        uretildi: (son && son.uretildi) ?? null, girdiSha: (son && son.girdiSha) ?? null,
        zaman: Date.now(), kod: k.kod || 'ertele',
        omurMs: ekeBagli ? KABUK_ON_KONTROL_OMUR_MS : KABUK_ON_KONTROL_GECICI_OMUR_MS,
      });
      kabukErteleBildir({
        bookId: job.bookId, kod: k.kod || 'ertele', neden: k.neden, girdiSha: k.girdiSha,
        macGirdiSha: k.macGirdiSha || null, kaynakSurumu: job.kaynakSurumu,
      });
      const sebep = `${setKabuk.ISARET} ${k.neden || 'kabuk eki yok'}`;
      return r2Ertele(auth, job, sebep, { kilitBirak: true });
    };
    // Taban üreteçle yeniden kurulur; merdiven + set eki yeni build'e yeniden uygulanır.
    // Ertelenecek durumda r2Ertele sonucunu döner (çağıran aynen döndürür), yoksa null.
    const tabaniUretecleKur = async (uretecNeden) => {
      try {
        await r2KurTabanHazirla({ bookId: job.bookId, kaynak, zipPath, work, job, uretecNeden });
      } catch (e) {
        if (e && e.gecici) return r2Ertele(auth, job, e.message, { kilitBirak: true });
        throw e;
      }
      r2OncekiBoyut = null;
      r2OncekiEnvanter = null;
      if (kaynak.merdiven && merdivenAcik()) {
        merdivenSonuc = await kaynakAdim.merdiven({
          zip: zipPath, calisma: work, bookId: job.bookId, platform: job.platform, log, warn,
        });
      }
      await setEkiUygula();
      return null;
    };
    // TABAN KAPSAMA (03.10, 45482 Shall We 8 Set): set eki SONRASI liste kimliklerinden build'de hâlâ
    // olmayan varsa (set eki ekleyemedi) taban atlanır, üreteç koşar; merdiven + set eki yeni build'e
    // yeniden uygulanır. Set eki eksiği tamamladıysa taban korunur. Üreteç kapalıysa dokunulmaz.
    let tabanIstisnasi = null; // panel hizalamasının çıkardığı sanılan kimlikler (aşağıda doğrulanır)
    // LİSTE KÜÇÜLDÜ (r2-kur): taban claim listesinde olmayan kitap taşıyorsa taban atlanır (yazma kapısı
    // liste-disi-kitap RED yerine). r2-al DIŞI: orada kaynak build R2'dedir, platform işi üreteç koşmaz.
    const kapiListeHam = (setEk.setListesiCoz({ job }) || {}).ham || null;
    if (kaynak.tur === 'r2-kur' && !job.uretecOzeti && uretecKaynak.uretecAcik() && kapiListeHam) {
      const kapi = yazmaKapisi({ zipYolu: zipPath, setListesi: kapiListeHam });
      const fazla = kapi.nedenler.map(n => {
        const m = n.match(/liste-disi-kitap:.*kimliği (\d+) listede yok/);
        return m ? m[1] : null;
      }).filter(Boolean);
      const atlananlar = new Set((job.atlananUyeler || []).map(a => String(a.kitapId)));
      const gercekFazla = fazla.filter(id => !atlananlar.has(id));
      if (gercekFazla.length > 0) {
        log(`taban kapsama: liste küçüldü (${gercekFazla.join(', ')} tabanda var ama claim'de yok) — taban atlanıp üreteçle yeniden kurulacak`);
        const d = await tabaniUretecleKur(`liste kuculdu: ${gercekFazla.join(', ')}`);
        if (d) return d;
      }
    }
    if (kaynak.tur === 'r2-kur' && !job.uretecOzeti && uretecKaynak.uretecAcik()) {
      const eksik = uretecKaynak.tabanKitapEksik(zipPath, kapiListeHam);
      // Panel hizalaması panelde olmayan üyeyi (claim listesinde bayat kalan) menüden çıkarır ama
      // içeriğini silmez: içeriği kökte duran kimlik "eksik" sayılmaz (üreteç boşuna koşmaz;
      // ölçüm 05.10 — 45448/45449/45469/45472 claim'i 61633/61635 taşıyor, panel 73010/73147).
      // İSTİSNA ŞARTLI: panel adımı bu koşuda menüyü panele hizalı DÖNDÜRMEZSE üreteç yoluna düşülür.
      if (eksik.atla) {
        const duran = eksik.eksik.filter((id) => panelMenu.kokIcerikVarMi(zipPath, id));
        if (duran.length && duran.length === eksik.eksik.length) {
          log(`${panelMenu.ISARET} taban kapsama: ${duran.join(', ')} menüde yok ama içeriği `
            + 'tabanda duruyor (panel hizalaması çıkarmış) — taban korunur, panel sonrası doğrulanır');
          eksik.atla = false;
          tabanIstisnasi = duran;
        }
      }
      if (eksik.atla) {
        const d = await tabaniUretecleKur(
          `taban ATLANDI — set eki sonrası eksik: ${eksik.eksik.join(', ')} (${eksik.sebep})`);
        if (d) return d;
      }
    }

    const kabukErtele = await kabukUygula();
    if (kabukErtele) return kabukErtele;

    // PANEL MENÜ HİZALAMA (05.10, panel-menu-hizala.js): kök menülü tek-motor sette menü panelin
    // GetPackageBooks listesine (Group/Tab/üye/sıra) hizalanır, eksik üye İmpark'tan eklenir —
    // okuyucu çevrimiçi açılışta yeşil/mavi bulut göstermez. imKeys'ten ÖNCE: imKeys son üye
    // listesini ve covers[0]'ı kendisi bulur (yeni anahtarlı üye imKeys'siz yayınlanmaz).
    // Manuel build'de ÇALIŞMAZ (sözleşme M1); r2-al ve arşiv/r2-kur'da çalışır (bayat R2 build'in
    // tek düzeltme yolu). Panel/teklif ölçülemedi ya da indirme ağ hatası → ertelenir (failed yok);
    // içeriksiz üye / kapı RED → iş görünür hatayla düşer (eksik içerikle paket yok).
    if (kaynak.tur === 'manuel') {
      log(`${panelMenu.ISARET} manuel build — panel menü hizalama ATLANDI `
        + '(olduğu gibi kullanılır, sözleşme M1)');
    }
    // Yazma kapısının set listesi: varsayılan claim listesi; panel hizalaması panelinkini koyar.
    let kapiSetListesi = null;
    const panelUygula = async () => {
      kapiSetListesi = (setEk.setListesiCoz({ job }) || {}).ham || null;
      delete job.setListesiPanelFarki;
      if (kaynak.tur === 'manuel') return { pm: null };
      try {
        const pm = await kaynakAdim.panelMenuHizala({
          zip: zipPath, calisma: work, bookId: job.bookId, platform: job.platform, log, warn,
          claimListesi: kapiSetListesi, setAdi: job.bookTitle || '',
          atlananUyeler: (job.atlananUyeler || []).map((a) => a.kitapId),
          bildir: (a) => uyeAtla.bildirimGonder({ ...a, warn }),
        });
        if (pm && Array.isArray(pm.atlananUyeler) && pm.atlananUyeler.length) {
          job.atlananUyeler = uyeAtla.birlestir(job.atlananUyeler, pm.atlananUyeler);
        }
        // Panel ölçüldü ve menü panele hizalı (UYGULANDI ya da zaten hizalı) → yazma kapısı panel
        // listesini görür (claim listesi bayat ya da boş olabilir; Web-Z listesine dokunulmaz).
        if (pm && pm.hizali && pm.panelSetListesi) {
          kapiSetListesi = pm.panelSetListesi;
          job.setListesiPanelFarki = { ...pm.setListesiPanelFarki, listeKaynagi: 'panel' };
        }
        return { pm };
      } catch (e) {
        if (e && e.gecici) {
          return { ertele: await r2Ertele(auth, job, e.message, { kilitBirak: kaynak.tur === 'r2-kur' }) };
        }
        throw e;
      }
    };
    let panelSonuc = await panelUygula();
    if (panelSonuc.ertele) return panelSonuc.ertele;
    // Taban kapsama istisnası yalnız panel ölçülüp menü panele HİZALI döndüyse geçerlidir; yoksa
    // (panel boş / uç yok / tutarsız) kimlik gerçekten eksiktir → üreteç yolu, panel adımı yeniden.
    if (tabanIstisnasi && !(panelSonuc.pm && panelSonuc.pm.hizali)) {
      log(`${panelMenu.ISARET} taban kapsama istisnası GERİ ALINDI: panel hizalı dönmedi — `
        + `${tabanIstisnasi.join(', ')} gerçekten eksik, üreteç yoluna düşülüyor`);
      const d = await tabaniUretecleKur(`taban ATLANDI — set eki sonrası eksik: ${tabanIstisnasi.join(', ')}`
        + ' (panel hizalamadı)');
      if (d) return d;
      const kabukErtele2 = await kabukUygula();
      if (kabukErtele2) return kabukErtele2;
      panelSonuc = await panelUygula();
      if (panelSonuc.ertele) return panelSonuc.ertele;
    }
    // r2-al/arşiv (üreteç koşmadı): atlanan üyeler build'in üreteç işaretinden okunur (rapor tutarlı olsun).
    job.atlananUyeler = uyeAtla.birlestir(job.atlananUyeler, uyeAtla.zipIsaretindenOku(zipPath));
    // İçerik sürümü kanıtı (merdiven + set eki): tamamla `kitaplar[].vs` ve `/result` icerikSurumleri.
    const icerikKaniti = kaynakR2.merdivenKaniti({ merdiven: merdivenSonuc, setEki: setEkiRapor });
    job.icerikSurumleri = icerikKaniti.icerikSurumleri; // runner'ın doldurduğu alan (claim DEĞİL)

    // ÇEVRİMDIŞI AKTİVASYON (imKeys.dll, güvenlik 02.10 — imkeys.js): okuyucu imKeys.dll'i boş
    // bulup çevrimdışıysa kitabı SABİT 123456 ile kendisi aktive ediyor; İmpark build'lerinde dosya
    // hiç yok. Her kaynakta (r2-kur build'e yazılır → 4 platform aynısını alır; r2-al'de eksikse;
    // arşiv/manuel'de taze) anahtarlı kapaklara key.ydspublishing.com kodları yazılır. Anahtar
    // çekilemezse iş ERTELENİR; anahtarlı kapakta imKeys boş/yoksa paket YAYINLANMAZ (imkeys-yok).
    let imk;
    try {
      imk = await kaynakAdim.imKeys({
        zipYolu: zipPath, paketId: job.bookId, mod: kaynak.tur === 'r2-al' ? 'eksikse' : 'yaz',
        calisma: work, log,
      });
    } catch (e) {
      if (e && e.gecici) {
        return r2Ertele(auth, job, `${imKeys.ISARET} ${e.message}`, { kilitBirak: kaynak.tur === 'r2-kur' });
      }
      throw e;
    }

    // Menü başlığı: set penceresinin başlığı `<main label>`'dan gelir (ham: "İmpark Eğitim") →
    // yayınevi adı. imKeys'ten sonra, R2 yazımından önce: dört platform + R2 aynı menüyü alır.
    await kaynakAdim.menuBasligi({
      zipYolu: zipPath, yayineviAdi: job.publisherName, calisma: work, log,
    });

    // KÜÇÜK GÖRSEL ONARIMI (06.10, 11845 book4: 10 sayfa, 1 şifreli thumb → kabul KALDI): sayfası olup
    // geçerli thumb'ı olmayan kitaplara thumb üretilir. Saf JS (kasada sips/zip yok). Hata üretimi
    // durdurmaz (zip değişmez, kabul ölçer). EMPP_THUMBS_ONAR=0 kapatır. Manuel build'e dokunulmaz (M1).
    if (kaynak.tur !== 'manuel' && process.env.EMPP_THUMBS_ONAR !== '0') {
      try {
        job.thumbsOnar = await thumbsOnar.thumbsOnar({ zip: zipPath, log, warn });
      } catch (e) {
        warn(`${thumbsOnar.ISARET} HATA (üretim sürüyor, zip değişmedi): ${e.message}`);
      }
    }
    // MENÜ KAPAK GARANTİSİ (06.10, 59835 Super Monsters 2: Teacher's Pack + Worksheets kapaksız):
    // üreteç link kartına coverUrl yazmaz, kabuk images/book1.png'ye düşer, dosya pakette yok.
    // Menü yazan BÜTÜN adımlardan (üreteç, set eki, kabuk, panel) SONRA, R2/paketleyiciden ÖNCE:
    // dört platform + R2 aynı kapakları alır. Manuel build'e dokunulmaz (sözleşme M1; kabul ölçer).
    // Zip yazımı / aday kapısı düşerse hata görünür fırlar (iş kopyası değişmemiş olur).
    // (Burada else dalı YAZILMAZ: runner-pardus.test.js processJob'daki ilk else'i pardus dalı sayar.)
    if (kaynak.tur === 'manuel') {
      log(`${menuKapak.ISARET} manuel build — kapak garantisi ATLANDI (sözleşme M1; kabul kapısı ölçer)`);
    }
    // Kip EMPP_MENU_KAPAK_GARANTI: uyar (varsayılan) → hata iş kopyasını değiştirmez (aday kapısı),
    // uyarı yazılır, üretim sürer; reddet → hata işi düşürür; kapali → adım koşmaz.
    // (06.10 inceleme: CRC/ENOSPC/kapı RED gibi bir hata tüm set üretimini durduruyordu.)
    const mkgKip = String(process.env.EMPP_MENU_KAPAK_GARANTI || '').trim().toLowerCase();
    if (kaynak.tur !== 'manuel' && mkgKip !== 'kapali') {
      try {
        job.menuKapak = await kaynakAdim.menuKapak({
          zip: zipPath, calisma: work, kisaKod: job.kisaKod || null,
          setListesi: (setEk.setListesiCoz({ job }) || {}).ham || null, log, warn,
        });
      } catch (e) {
        if (mkgKip === 'reddet') throw e;
        warn(`${menuKapak.ISARET} kapak garantisi HATA (uyar kipi, üretim sürüyor, zip değişmedi): ${e.message}`);
        job.menuKapak = { durum: 'hata', sebep: e.message };
      }
    }

    // R2'YE YAZ (Dalga B, r2-kur): kurulan build yazma kapısından (B5) geçerse R2'ye yüklenir ve
    // `tamamla` ile sunucu kapısına sunulur. Kapı reddi / 409 → paket ÜRETİLMEZ (kalıcı: failed +
    // bildirim); ağ/5xx/kilit süresi → kira bırakılır (failed yok). Her düşüşte kurma kilidi bırakılır.
    if (kaynak.tur === 'r2-kur') {
      let yayin;
      try {
        yayin = await kaynakAdim.r2KurYayinla({
          job, zipYolu: zipPath, setListesi: kapiSetListesi,
          oncekiBoyut: r2OncekiBoyut, oncekiEnvanter: r2OncekiEnvanter, vsler: icerikKaniti.vsler, istemci: kaynakIstemcisi(auth),
          kapi: imKeys.kapiSar(yazmaKapisi, imk.kapi), ozet: ikiOzet, parcalariYukle,
          // Üreteç özeti `tamamla`ya (sunucu bilinmeyen alanı atar; kayıt `kaynak='uretec'` book-update işi).
          tamamlaEki: job.uretecOzeti || (job.atlananUyeler || []).length
            ? { uretec: { ...(job.uretecOzeti || {}), ...uyeAtla.govdeAlanlari(job.atlananUyeler) } } : {},
          ekWebzVarliklari: job.uretecWebzVarliklari || [],
          parcaBoyutu: MULTIPART_PART_SIZE, log,
          ...r2GecerliSurumKimligi(kaynak),
        });
      } catch (e) {
        if (e && e.gecici) return r2Ertele(auth, job, e.message, { kilitBirak: false });
        throw e;
      }
      if (yayin.degismedi) {
        // Yeni sürüm açılmadı: paket + /result mevcut geçerli sürümle (sunucu parite beyanı) devam eder.
        job.kaynakSurumu = yayin.surum;
        paketKaynakKimligi = `r2-${yayin.surum}`;
      }
      // Arşiv = R2'nin yerel önbelleği: aynı Mac'teki diğer platformlar r2-al'de indirmesin.
      await r2ArsiveYaz(job.bookId, zipPath, { surum: yayin.surum, ...yayin.ozet, uyari: warn });
      // Ertelenen hazır kayıt kararı (O2): kaynak sürümü artık biliniyor (içerik değişmediyse eskisiyle aynı).
      if (hazirErtelenen) {
        const b = await hazirBayatKontrol(auth, job, hazirErtelenen, yayin.surum);
        if (b.sonuc) return b.sonuc;
        if (!b.bayat) return await hazirIsiDevral(auth, job, winPlan, hazirErtelenen, work);
      }
    }
    // imKeys kapısı (r2-kur'da yazma kapısında zaten RED olur): paketleyiciye gitmeden önce.
    if (!imk.kapi.gecti) {
      throw new Error(`${imKeys.ISARET} ${imKeys.NEDEN_KODU} — paket YAYINLANMAZ: ${imk.kapi.nedenler.join(' | ')}`);
    }
    // PAKET İÇERİK ÜYELERİ (05.10): merdiven + set eki + imKeys + menü başlığı SONRASI, paketleyiciye
    // gitmeden önceki SON zip'ten ölçülür (android/mac/windows/pardus aynı zipPath). Hata paketi durdurmaz.
    const uyeOlcum = icerikUyeleri.zipIcerikUyeleri(zipPath);
    job.icerikUyeleri = uyeOlcum.uyeler.length ? uyeOlcum.uyeler : null; // runner alanı (claim DEĞİL)
    if (uyeOlcum.hata) warn(`[uyeler] ölçülemedi: ${uyeOlcum.hata}`);
    log(`[uyeler] ${uyeOlcum.uyeler.length} kitap, ${uyeOlcum.menuSayisi} menü, ${uyeOlcum.atlanan} atlandı`);
    const appName = asciiAppName(job.bookTitle, `book-${job.bookId}`); // paketleyici iç adı ASCII (45496 dersi)
    // Windows: sözleşme sürümü (madde 1, claim'den). Diğerleri '1.0.0' → paketleyici içerikten
    // türetir (surum-turet.js). Windows dosya adı imza yuvasında (_hazir/_imzali) runner'a ait görünür.
    const appVersion = winPlan ? winPlan.surum : '1.0.0';
    const artifactPath = path.join(work, winPlan
      ? windowsSerit.imzaDosyaAdi(job.bookId, appName, winPlan.surum)
      : `artifact${artifactExtension(packagerPlatform)}`);
    let jobId = null; // pardus dalında yerel HTTP packager hiç devreye girmez — jobId yok

    if (packagerPlatform === 'pardus') {
      // Docker'da srv21 ile BİREBİR: HTTP paketleyici (3001) YOK, doğrudan script.
      // İkon: yayıncı zip'inde ico.png yok → kayıtlı logo zip köküne eklenir (aşağıda).
      await injectPardusIcon(zipPath, job.publisherName, work);
      await buildPardusArtifact(zipPath, appName, appVersion, artifactPath, work, {
        bookId: job.bookId, srcVersion: paketKaynakKimligi,
        // claim G kimliği (claim-surum): konteynerdeki paketleyiciye kadar taşınır
        setKimligi: job.setKimligi, guncellemeTabani: job.guncellemeTabani, surum: job.surum,
        kanonikHedef: job,
      });
    } else {
      log('uploading build to packager...');
      const sessionId = await packagerUploadBuild(zipPath, appName, appVersion);
      log('packager session:', sessionId, '- starting package...');
      const logoId = await packagerLogoIdFor(job.publisherName);
      // G tabanı (madde 3): mac/android appVersion '1.0.0' kalır; claim surum'u (G3) ayrı alanla
      // empp-set.json'a iner. Yoksa bugünkü davranış + uyarı (pakette monoton alt sınır yok).
      const gSurum = winPlan ? { surum: winPlan.surum, sebep: '' } : claimGSurumu(job);
      if (!gSurum.surum) {
        warn(`G tabanı: claim surum ${gSurum.sebep === 'yok' ? 'yok' : 'G3 değil (' + job.surum + ')'} — `
          + `${packagerPlatform} paketinde monoton sürüm tabanı OLMAYACAK (eski G manifesti tabansız)`);
      }
      jobId = await packagerStartPackage(sessionId, packagerPlatform, appName, appVersion, logoId,
        winPlan ? winPlan.setKimligi : job.setKimligi, winPlan ? winPlan.guncellemeTabani : job.guncellemeTabani,
        gSurum.surum);
      log('packager jobId:', jobId, '- polling...');
      const pollSonuclari = await packagerPoll(jobId, packagerPlatform);
      // Kanonik motor/kabuk sürümü (paket.json damgası) → /result gövdesine (postResultSuccess).
      job.kanonikSurum = (pollSonuclari && pollSonuclari.kanonikSurum) || null;
      // Kök index denetimi görünürlük köprüsü (2026-09-26) — bkz. kok-index-log-koprusu.js.
      if (pollSonuclari && pollSonuclari.kokIndexDenetimi) {
        const satir = kokIndexOzetSatiriKur({
          bookId: job.bookId, platform: job.platform, ...pollSonuclari.kokIndexDenetimi,
        });
        if (satir) log(satir);
      }

      log('downloading artifact...');
      await packagerDownload(jobId, packagerPlatform, artifactPath);
    }

    // 4. macOS: sign + notarize — düşerse FIRLATIR, artifact yüklenmez (noter kapısı).
    if (packagerPlatform === 'macos') {
      await signAndNotarizeMac(artifactPath);
    }

    // 4b. Yayın öncesi kapılar — RED alan paket R2'ye YÜKLENMEZ.
    //   windows: sözleşmeli zincir (statik kapı + G madde 13, başsız kabul, _hazir, imza yuvası,
    //            Authenticode doğrulama + md5, imzalı kopyada kabul). Yayına YALNIZ imzalı ve
    //            doğrulanmış kopya gider; imzasız yayın yolu YOK, imzayı kapatan anahtar YOK.
    //   diğerleri: başsız kabul (bayrak kapalıysa no-op).
    let yayinYolu;
    let winZincir = null;
    // KABUL KUYRUĞU (05.10): bayrak açık VE hazır kuyruk açıksa imzasız kabul işçiye bırakılır.
    const kabulKuyrugu = packagerPlatform === 'windows' && kabulKuyruguAcik();
    if (packagerPlatform === 'windows') {
      winZincir = await windowsSerit.yayinOncesiZincir({
        artifactPath, job, plan: winPlan, work, jobId, cfg: CONFIG, log, sleep,
        aktivasyon: aktivasyonBeklenir(job.bookTitle),
        imzaKipi: winKip.kip,
        kabulKipi: kabulKuyrugu ? 'kuyruk' : 'satir',
        // Yalnız kabulden geçip hazır kuyruğa girerken sorulur (tembel) — RED alan pakette presign yok.
        r2Hedef: winKip.kip === 'hazir' || kabulKuyrugu ? () => r2HedefYoklama(auth, job) : undefined,
      });
      if (winZincir.kabulKuyrugu) {
        // KABUL BEKLİYOR: yayın YOK, failed YOK. Sunucu bugünkü imza-bekliyor tutmasıyla satırı tutar
        // (lease NULL — sıradaki claim'le aynı ajanda iki kiralı satır olmaz); runner sıradaki işe geçer.
        const bekleSebep = `${windowsHazir.KABUL_KUYRUGU_ISARETI} imzasız kabul işçide bekliyor`;
        const tutma = await imzaBekliyorBildir(auth, job, winZincir.hazir, bekleSebep);
        await packagerReleaseJob(jobId);
        // Ö2: sunucu tutmadıysa kuyruk bu iş için devre dışı — kabul satır içi (eski sunucuda döngü yok).
        if (!tutma.tutuldu) return await kabulSatirIciYedek(auth, job, winPlan, winZincir.hazir.dizin, work);
        return { ertelendi: true, imzaBekliyor: true, kabulKuyrugu: true, sebep: bekleSebep };
      }
      if (winZincir.hazir) {
        // İMZA BEKLİYOR: yayın YOK. Sunucuya ara durum bildirilir (kira bırakılır; book-update
        // `durum:'imza-bekliyor'`u tanıyınca satırı yeniden kiralanmayacak biçimde tutar).
        const bekleSebep = winZincir.sebep || winKip.sebep;
        await imzaBekliyorBildir(auth, job, winZincir.hazir, bekleSebep);
        await packagerReleaseJob(jobId);
        return { ertelendi: true, imzaBekliyor: true, sebep: bekleSebep };
      }
      yayinYolu = winZincir.imzaliYol;
    } else {
      await basliksizKabul(artifactPath, packagerPlatform, job, work);
      yayinYolu = artifactPath;
    }

    // 5. POST artifact FILE back (server uploads to R2).
    log('posting result (completed) with artifact file...');
    const yayin = await postResultSuccess(auth, job, yayinYolu);
    // Windows iş kanıtına R2 anahtarı (md5 + kök index + sürüm zincirde yazıldı).
    if (winZincir) await windowsSerit.yayinKaniti(winZincir, yayin, CONFIG, log);
    if (winZincir) await imzaliSonArsivle(winZincir, yayin, job, winPlan.surum, path.basename(artifactPath));

    // G set tar'ı runner'dan HİÇBİR YERE yüklenmez — tek yazar g-yayin (bkz. yukarıdaki not).

    // Artifact R2'ye gitti — packager'ın yerel kopyasını tutmanın anlamı yok.
    // Bu adım eksikti: her üretim packager'ın output/ dizininde 1-3 GB bırakıyor,
    // hiç silinmiyordu. 2026-08-18'de 119 paket / 118 GB birikmişti.
    // Gerekirse paket R2'den indirilir.
    await packagerReleaseJob(jobId);

    log('job done:', job.bookId, job.platform);
    let boyutMb = null;
    try { boyutMb = Math.round(fs.statSync(yayinYolu).size / 1e6); } catch (_) {}
    bildirGonder({ basarili: true, bookId: job.bookId, bookTitle: job.bookTitle, platform: job.platform, boyutMb });
  } catch (e) {
    // Windows şeridi düştü: R2'ye hiçbir şey yazılmadı. Görünür hata + bekçi bildirimi; failed /
    // erteleme kararını ana döngü verir (postResultFailure ya da kira dönüşü).
    if (packagerPlatform === 'windows') {
      await windowsSerit.bekciBildir({ bookId: job.bookId, bookTitle: job.bookTitle, hata: e }, warn);
    }
    throw e;
  } finally {
    currentJob = null; // idle again — stop extending the lease
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Main loops.
// ---------------------------------------------------------------------------
async function main() {
  log('starting. API:', CONFIG.apiBase, '| packager:', CONFIG.packagerApi, '| caps:', CONFIG.caps.join(','));
  const auth = await enrollOrLoad();
  sonAuth = auth;
  // İlk next-job'dan ÖNCE yetenekleri bildir: sunucu eski listeyle (evde macos dahil) iş kiralamasın.
  // ProBook şeridi açıksa ilk karar BEKLENİR — sağlıklı ProBook varken Mac ilk pardus işini kapmasın.
  if (seritDenetcisi) await seritDenetcisi.tazele({ zorla: true });
  // Pardus kabul erişim kapısı da ilk kararını bekler (en çok 6 sn) — yoksa ilk kira 'ölçülmedi'.
  if (CONFIG.caps.includes('pardus') && CONFIG.pardusKabul
    && process.env.EMPP_PARDUS_KABUL_ERISIM !== '0' && pardusKabulHostu() !== 'yerel') {
    await probookErisimIlkOlcum(pardusKabulHostu());
  }
  guncelYetenekler();
  await heartbeat(auth);

  // Heartbeat loop (fire-and-forget; never throws into the main loop).
  // Önceki tık hâlâ sürüyorsa (yavaş hat, 30 sn zaman aşımı) yenisi açılmaz — bağlantı yığılmaz.
  let hbUcusta = false;
  const hbTimer = setInterval(() => {
    if (stopping || hbUcusta) return;
    hbUcusta = true;
    Promise.resolve(heartbeat(auth)).catch(() => {}).finally(() => { hbUcusta = false; });
  }, CONFIG.heartbeatMs);
  hbTimer.unref?.();

  let netErrAttempt = 0;
  while (!stopping) {
    if (restartRequested(CONFIG.restartFlag)) {
      log('yeniden başlatma isteği (bayrak dosyası) — işler arasında temiz çıkılıyor, launchd yeni kodla açar');
      clearInterval(hbTimer);
      process.exit(0);
    }
    if (pauseRequested(CONFIG.pauseFlag)) {
      if (!main._pauseLogged) { log('duraklatma bayrağı var (' + CONFIG.pauseFlag + ') — yeni iş alınmıyor, kaldırılınca sürer'); main._pauseLogged = true; }
      await sleep(CONFIG.pollMs);
      continue;
    }
    if (main._pauseLogged) { log('duraklatma kalktı — iş almaya devam'); main._pauseLogged = false; }
    if (dusukVeriModu()) {
      if (!main._dusukLogged) { log('WiFi Düşük Veri Modu açık — yükleme/iş alımı duraklatıldı (dusuk-veri-yoksay.istek ile aç)'); main._dusukLogged = true; }
      await sleep(CONFIG.pollMs);
      continue;
    }
    if (main._dusukLogged) { log('Düşük Veri Modu kalktı — iş almaya devam'); main._dusukLogged = false; }
    let job = null;
    try {
      const sira = await siradakiIs(auth);
      if (sira.kapali) {
        // Üretim kapısı (kabul kuyruğu dolu / disk dar): claim yok, nabız (heartbeat) sürer.
        if (main._kapiSebep !== sira.sebep) { log(`üretim kapısı KAPALI — ${sira.sebep}; yeni iş alınmıyor`); main._kapiSebep = sira.sebep; }
        await sleep(CONFIG.pollMs);
        continue;
      }
      if (main._kapiSebep) { log('üretim kapısı açıldı — iş almaya devam'); main._kapiSebep = null; }
      job = sira.job;
      netErrAttempt = 0; // a successful poll resets backoff
    } catch (e) {
      const delay = backoffMs(netErrAttempt++, 1000, 30000);
      warn('next-job poll error, backing off', delay, 'ms:', agHatasiOzeti(e));
      await sleep(delay);
      continue;
    }

    if (!job) {
      await sleep(CONFIG.pollMs);
      continue;
    }

    // A bad job must never kill the loop.
    try {
      const sonuc = await processJob(auth, job);
      // Kaynak yok (exe'siz sözleşme): kira processJob'da bırakıldı, failed yazılmadı. Kısa bekleme
      // (2 sn): arşivli işler gecikmesin; aynı işin tekrar gelmesini sunucu dışlama backoff'u keser.
      if (sonuc && sonuc.ertelendi) await sleep(CONFIG.kaynakYokBeklemeMs);
    } catch (e) {
      if (ertelenebilirKaynakHatasi(e)) {
        // Disk darlığı PAKET KUSURU DEĞİLDİR: 'failed' YAZMA. Kira AÇIKÇA bırakılır
        // (releaseJob, 2026-09-30 — eskiden kira dolana kadar 30 dk asılı kalıyordu; eski
        // sunucuda uç yoksa yine öyle); bu arada ajan beklemeden sıradaki işe geçer (android/mac
        // işleri aynı diske sığabilir, pardus sırası srv21 şeridinde üretilir).
        // Eski davranış satıra 'failed' yazıyordu — panelde "PARDUS HATALI" görünen
        // 8 iş (2026-09-19) bozuk paket değil, dolu diskti (Nadir tespiti).
        const birakildi = await releaseJob(auth, job, agHatasiOzeti(e));
        warn(birakildi
          ? 'job ertelendi (failed YAZILMADI, kira BIRAKILDI — kuyruğun sonunda, başka ajan alabilir):'
          : 'job ertelendi (failed YAZILMADI, kira dolunca kuyruğa döner):',
        job.bookId, job.platform, '-', agHatasiOzeti(e));
        await sleep(15000);
        continue;
      }
      if (isTransientNetworkError(e)) {
        // Ağ/geçici hata: 'failed' YAZMA — lease süresi dolunca API satırı yeniden kuyruğa alır,
        // ajan önbellekten yeniden paketleyip yüklemeyi dener (internet gelince kendiliğinden biter).
        warn('job geçici hata (failed yazılmadı, lease dolunca yeniden denenecek):', job.bookId, job.platform, '-', agHatasiOzeti(e));
        await sleep(120000);
        continue;
      }
      // Özet KÖKTEN kırpılır (hata-ozeti.js): kabul kapısının "[kabul] RED: …" sebebi
      // mesajın sonunda; baştan 200'de kesmek onu yutuyordu (11845 pardus, 26.09).
      // Boş .message (AggregateError) → agHatasiOzeti'nin code/errors çözümü.
      const ozet = hataOzeti(e && typeof e.message === 'string' && e.message.trim()
        ? e.message : agHatasiOzeti(e));
      errlog('job failed:', job.bookId, job.platform, '-', ozet);
      bildirGonder({ basarili: false, bookId: job.bookId, bookTitle: job.bookTitle, platform: job.platform, ayrinti: ozet });
      await postResultFailure(auth, job, e.message);
    }
  }

  clearInterval(hbTimer);
  log('stopped.');
}

// Graceful shutdown.
//
// ÇIKIŞ GÖZCÜSÜ (2026-09-13): ajan, süren bir üretim işinin ortasında sessizce
// yeniden başladı (73768 android, 19:55:44). Ne sinyal handler'ı, ne restart
// bayrağı yolu, ne de bir hata izi log'a düştü; launchd "exit(0)" gördü. Hangi
// yoldan çıkıldığı ÖLÇÜLEMEDİ. Aşağıdaki kancalar davranışı değiştirmez —
// yalnız her çıkışın kodunu ve sebebini log'a yazar ki bir sonraki olayda
// "harici sonlandırma mı, kendi kodumuz mu" sorusu kanıtla kapansın.
/**
 * Kapanışta elde tutulan işin kirasını bırakır (06.10). Elde iş ya da kimlik yoksa null döner.
 * FIRLATMAZ. @returns {Promise<boolean>|null}
 */
function kapanisKirasiBirak(sig, { job, auth, birak = releaseJob } = {}) {
  if (!job || !auth) return null;
  return Promise.resolve()
    .then(() => birak(auth, job, `ajan kapanıyor (${sig}) — iş yarıda kaldı`))
    .then((ok) => {
      log(`kapanış: ${job.bookId} ${job.platform} kirası ${ok ? 'BIRAKILDI' : 'bırakılamadı'}`);
      return Boolean(ok);
    })
    .catch(() => false);
}

function installSignalHandlers() {
  const onSignal = (sig) => {
    log(`received ${sig}, finishing current work then exiting...`);
    stopping = true;
    // Elde iş varsa kirası bırakılır: yeni süreç onu bilmez, kira 30 dk asılı kalıp setin
    // diğer platformlarını (kur bekleyen Windows) bekletir. Bırakma en çok 8 sn sürer.
    const bekle = kapanisKirasiBirak(sig, { job: currentJob, auth: sonAuth });
    if (bekle) {
      setTimeout(() => process.exit(0), 8000).unref?.();
      bekle.finally(() => process.exit(0));
      return;
    }
    // Give in-flight work a brief window; hard-exit fallback.
    setTimeout(() => process.exit(0), 2000).unref?.();
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
  // Varsayılanda sessizce öldüren sinyaller — artık iz bırakıyorlar.
  process.on('SIGHUP', () => onSignal('SIGHUP'));
  process.on('SIGQUIT', () => onSignal('SIGQUIT'));
  // Koşulsuz: hangi yoldan çıkarsak çıkalım son satır bu olur.
  process.on('exit', (code) => log('süreç çıkıyor — çıkış kodu:', code));
  // Varsayılan davranışı taklit eder (log + aynı çıkış kodu), ama iz bırakır.
  process.on('uncaughtException', (e) => {
    errlog('yakalanmamış istisna:', (e && e.stack) || e);
    process.exit(1);
  });
  process.on('unhandledRejection', (r) => {
    errlog('yakalanmamış promise reddi:', (r && r.stack) || r);
    process.exit(1);
  });
}

if (require.main === module) {
  installSignalHandlers();
  main().catch((e) => {
    errlog('fatal:', agHatasiOzeti(e));
    process.exit(1);
  });
}

module.exports = {
  installSignalHandlers,
  kapanisKirasiBirak,
  // downloadFile/zipDir: kaynak ön-ısıtıcısı (kaynak-isitici.js) için dışa açılmıştı; ısıtıcı
  // exe'siz sözleşmeyle (01.10) kapıyla KAPALI, downloadFile .exe yolunu reddeder.
  downloadFile, zipDir,
  // Exe'siz kaynak (01.10): testler kaynakIndirme'ye casus koyar; manuel build yardımcıları.
  kaynakIndirme, manuelZipIndir, manuelBuildHazirla, zipGirisleri, kaynakYokBekle, kaynakYokOzet,
  bildirGonder,
  kaynakYokOzetMetni, kaynakYokDurumOku, kaynakBoyutuTahmin, KAYNAK_YOK_ISARETI,
  // Token OKUYUCUSU (elle-kur aracı jetonu yalnız bununla alır; içerik basılmaz).
  loadToken,
  looksLikeRealApk, isValidArchiveOutput, CONFIG, processJob, extractSfx, findBuildDir, signAndNotarizeMac,
  STAPLE_KAPISI_ISARETI, agStapleCikti,
  packagerReleaseJob,
  ensureDockerReady, runPardusScript, runKabulBetigi, buildPardusArtifact, hazirPardusPaketi, pardusKabulKapisi, heartbeat, injectPardusIcon,
  // ProBook şeridi (2026-09-26) — testler denetçiyi değiştirip yetenek kararını ölçer.
  guncelYetenekler,
  _seritDenetcisiAyarla: (d) => { seritDenetcisi = d; _sonYetenek = ''; },
  // Pardus kabul erişim kapısı (2026-09-27) — testler prob sonucunu doğrudan enjekte eder
  // ya da gerçek TCP ile (özel port) probookErisimDurumu'nu doğrudan çağırır.
  probookErisimDurumu,
  probookErisimIlkOlcum,
  _probookErisimAyarla: (d) => { _probookErisim = d; _sonYetenek = ''; },
  // Süreli konteyner yedek kabul (2026-09-27) — testler bayrak dosyasını değiştirip
  // pardusYedekKabul() üzerinden okur; konteynerKabulKapisi ayrı test edilmek istenirse dışa açık.
  pardusYedekKabul,
  konteynerKabulKapisi,
  _yedekLogSifirla: () => { _yedekAktifSon = false; },
  yuklemeHizSiniri, packagerStartPackage, postResultSuccess, postResultFailure, postResultFailureYanit, presignUpload, releaseJob, releaseJobYanit, imzaBekliyorBildir, hazirIsiDevral,
  aktivasyonBeklenir,
  packagerPoll,
  // Kira bırakma + yetim kira (2026-09-30) — testler sahte API ile uçtan uca ölçer.
  fetchNextJob, releaseJob,
  // Kabul kuyruğu (05.10) — üretim kapısı + iş alma adımı.
  kabulKuyruguAcik, uretimKapisiDurumu, siradakiIs, isDiziniAc,
  // Exe'siz kaynak Dalga B (B4): r2-kur / r2-al — testler adımlara casus koyar, konumu enjekte eder.
  kaynakAdim, kabukTazelemeGovdesi, kabukErteleBildir, parcalariYukle, r2AlHazirla, r2KurTabanHazirla, kaynakKurDurumu,
  _platformAyarla: (p) => { _platform = p || process.platform; _sonYetenek = ''; },
  kabukErteleOzetMetni, sonDegismedi,
  _konumAyarla: (ofiste) => { _konum = { t: Date.now(), ofiste: Boolean(ofiste) }; _sonYetenek = ''; },
};
