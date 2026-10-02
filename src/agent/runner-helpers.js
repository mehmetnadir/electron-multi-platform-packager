'use strict';

/**
 * Pure helpers for the build-agent runner (NO IO, NO network, NO process state).
 *
 * The agent runner (runner.js) PULLs jobs from book-update's agent API, builds
 * via the LOCAL packager HTTP service, then POSTs the artifact file back. These
 * functions hold the decision/parsing/math logic so they can be unit-tested
 * without a live API, a real job, or the network.
 *
 * CommonJS — matches the repo style (require / module.exports).
 */

/**
 * Map a book-update job platform to this agent's build target string.
 *
 *   android -> 'android'  (APK, via LOCAL packager HTTP API)
 *   macos   -> 'macos'    (.dmg, via LOCAL packager HTTP API)
 *   mac     -> 'macos'    (book-update's platform ENUM uses 'mac'; accept both)
 *   pardus  -> 'pardus'   (.impark, via pardus-packager-build.sh + Docker — NOT the
 *                          local HTTP packager; runner.js branches on this value)
 *   windows -> 'windows'  (NSIS .exe, via LOCAL packager HTTP API — SET güncelleme
 *                          kanalının kaynağı) — YALNIZ `EMPP_RUNNER_WINDOWS=1` ise;
 *                          aksi hâlde `null` (desteklenmiyor gibi davranır).
 *
 * KAPI (2026-09-23, Şef/Nadir yetkisiyle): sözleşmedeki tetikleyici kararı
 * ("windows-set ayrı bir platform mı, yoksa 'windows' teslimini mi değiştirir?" —
 * bkz. `windows-paketleme-sozlesmesi.md` "Tetikleyici — KARAR BEKLİYOR") henüz
 * VERİLMEDİ. `mapPlatform('windows')` varsayılan olarak `null` dönmezse, runner'ı
 * yeniden başlatan HERHANGİ bir agent boru hattındaki `windows` işlerini claim
 * edip NSIS paketi üretmeye başlar — bu, Nadir'in henüz vermediği kararı fiilen
 * uygulamış olur. `EMPP_RUNNER_WINDOWS=1` açıkça verilmeden bu dal KAPALI kalır.
 *
 * Returns null for anything this Mac agent does not build (kapı kapalıyken windows
 * dahil) so the caller can fail the job cleanly instead of asking the packager to
 * do something it was not dispatched for.
 *
 * @param {string} platform
 * @returns {('android'|'macos'|'pardus'|'windows'|null)}
 */
function mapPlatform(platform) {
  switch (String(platform || '').trim().toLowerCase()) {
    case 'android':
      return 'android';
    case 'macos':
    case 'mac':
      return 'macos';
    case 'pardus':
      return 'pardus';
    case 'windows':
      return process.env.EMPP_RUNNER_WINDOWS === '1' ? 'windows' : null;
    default:
      return null;
  }
}

/**
 * Exponential backoff (ms) with a cap, for network-error retries on the poll loop.
 * attempt is 0-based: 0 -> base, 1 -> base*2, 2 -> base*4 … capped at maxMs.
 *
 * @param {number} attempt    0-based retry attempt
 * @param {number} [baseMs=1000]
 * @param {number} [maxMs=30000]
 * @returns {number} delay in ms (>= 0)
 */
function backoffMs(attempt, baseMs = 1000, maxMs = 30000) {
  const a = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const raw = baseMs * Math.pow(2, a);
  return Math.min(raw, maxMs);
}

/**
 * Parse a GET /next-job response into a normalized job, or null when there is no work.
 *
 * The agent API returns:
 *   - HTTP 204 (no body)        -> no work             -> null
 *   - HTTP 200 { job: {...} }   -> a leased job        -> normalized job
 *
 * We accept either { job: {...} } or a bare {...} (defensive) and require the
 * two fields the runner needs to act: bookId, platform.
 *
 * EXE'SİZ SÖZLEŞME (Nadir 01.10): `downloadUrl` artık ZORUNLU DEĞİL. Eskiden alan yoksa iş
 * burada SESSİZCE düşüyordu (null → "iş yok" sanılıp kira dolana kadar asılı kalıyordu). Kaynak
 * kararı (arşiv / manuel build / yok → kira bırak) `kaynak-karari.js`'te verilir; burada yalnız
 * taşınır. `downloadUrl` yoksa alan boş dize olur (tanımsız değil — eski okuyucular güvenli).
 * `kaynakTuru` (claim, ör. 'manuel') varsa AYNEN taşınır.
 *
 * @param {number} status   HTTP status code
 * @param {any} body        parsed JSON body (or undefined for 204)
 * @returns {({bookId:string, platform:string, downloadUrl:string, kaynakTuru?:string,
 *   buildMethod?:string, bookTitle?:string})|null}
 */
function parseNextJob(status, body) {
  if (status === 204) return null;
  if (status !== 200 || !body || typeof body !== 'object') return null;

  const job = body.job && typeof body.job === 'object' ? body.job : body;
  if (!job || typeof job !== 'object') return null;

  const bookId = job.bookId != null ? String(job.bookId) : '';
  const platform = job.platform != null ? String(job.platform) : '';
  const downloadUrl = job.downloadUrl != null ? String(job.downloadUrl) : '';

  if (!bookId || !platform) return null;

  return {
    bookId,
    platform,
    downloadUrl,
    // Kaynak türü (exe'siz sözleşme §7 M1, ör. 'manuel'): kaynak-karari.js okur.
    ...(typeof job.kaynakTuru === 'string' && job.kaynakTuru.trim()
      ? { kaynakTuru: job.kaynakTuru.trim() } : {}),
    // Bilgi adresi (sunucu 'arsiv-gerekli': exe adresi İNDİRİLEBİLİR alanda durmaz, yalnız ad/sürüm
    // bilgisi için `bilgiUrl`de gelir — book-update ajan-kaynak-turu.ts nextJobKaynakSemasi).
    ...(typeof job.bilgiUrl === 'string' && job.bilgiUrl.trim() ? { bilgiUrl: job.bilgiUrl.trim() } : {}),
    buildMethod: job.buildMethod != null ? String(job.buildMethod) : undefined,
    bookTitle: job.bookTitle != null ? String(job.bookTitle) : undefined,
    ...(job.publisherName != null ? { publisherName: String(job.publisherName) } : {}),
    // SET güncelleme kanalı (2026-09-23): windows SET işlerinde claim bu ikisini taşır —
    // yoksa (android/macos/pardus, ya da eski API) alanlar tanımsız kalır, güncelleme
    // adımı runner.js'te sessizce atlanır (varsayılan RET, tahmin ÜRETİLMEZ).
    ...(job.setKimligi != null ? { setKimligi: String(job.setKimligi) } : {}),
    ...(job.guncellemeTabani != null ? { guncellemeTabani: String(job.guncellemeTabani) } : {}),
    // G3 sürümü (claim-surum, 2026-09-26): pardus G kimliği, mac/android monoton taban ve
    // windows şeridi `job.surum` okur. Bu satır yokken sunucunun gönderdiği surum burada
    // DÜŞÜYORDU → canlıda 45482 pardus "surum-yok" ile G'siz üretildi (21:17). Eksiklik
    // sebepleri de taşınır ki ajan günlüğü sunucunun neden sürüm vermediğini söylesin.
    ...(job.surum != null ? { surum: String(job.surum) } : {}),
    ...(job.surumYok != null ? { surumYok: String(job.surumYok) } : {}),
    ...(job.guncellemeTabaniYok != null ? { guncellemeTabaniYok: String(job.guncellemeTabaniYok) } : {}),
    // SET LİSTESİ (2026-10-01): book-update claim'i 30.09 16:15'ten beri panel set listesini
    // (web-stream `proxy_asset_id`, ham metin) `setListesi` alanında gönderiyor; bu satır yokken
    // alan burada DÜŞÜYORDU → set-uyelik-ek.js "set listesi yok" deyip ek atlıyordu (01.10 12:07
    // 45550/mac: API set_listesi logu, runner 13 sn sonra "atlandı"). Yalnız dosya yedeği olan
    // 45482'de ek çalışıyordu. Ham değer AYNEN taşınır; ayrıştırma setListesiAyristir'in işi.
    ...(typeof job.setListesi === 'string' && job.setListesi.trim() ? { setListesi: job.setListesi } : {}),
    // KISA KOD (02.10, index üreteci): DB'de liste boşsa üreteç Worker'ın KV'den kurduğu settings.json'u
    // `/go/<kisaKod>/web-stream/config/settings.json`'dan okur; zip'siz oyun için link kartı adresi.
    ...(typeof (job.kisaKod || job.shortCode) === 'string' && String(job.kisaKod || job.shortCode).trim()
      ? { kisaKod: String(job.kisaKod || job.shortCode).trim() } : {}),
    ...r2KaynakAlanlari(job),
  };
}

/**
 * DALGA B (B4, exe'siz sözleşme §5): `r2-kur` / `r2-al` claim alanları. Bu dallarda `downloadUrl`
 * BEKLENMEZ (sözleşme: olmamalı). Şekil `kaynak-r2.claimKaynakDogrula` (book-update zod
 * `nextJobKaynakSemasi` ikizi, ortak fikstür) ile denetlenir; uymayan claim `kaynakGecersiz`
 * (neden) taşır → kaynak-karari 'gecersiz' der, hiçbir şey indirilmez, iş görünür hatayla düşer.
 * İşi düşürmek (null) yerine taşımak bilerek: sunucu satırı kiraladı, sessizce yok saymak kirayı
 * 30 dk asılı bırakırdı. Eski türler (manuel/arsiv-gerekli) bugünkü yolu izler; onlarda zaten exe
 * indirmeyen karar fonksiyonu son sözü söyler.
 */
function r2KaynakAlanlari(job) {
  const tur = typeof job.kaynakTuru === 'string' ? job.kaynakTuru.trim() : '';
  if (tur !== 'r2-kur' && tur !== 'r2-al') return {};
  const { claimKaynakDogrula } = require('./kaynak-r2');
  const al = {};
  for (const k of ['kaynakSurumu', 'kaynakUrl', 'kaynakSha256', 'tabanUrl', 'tabanSha256', 'kurulumBitis']) {
    if (typeof job[k] === 'string' && job[k]) al[k] = job[k];
  }
  if (typeof job.kaynakBoyut === 'number') al.kaynakBoyut = job.kaynakBoyut;
  const d = claimKaynakDogrula(job);
  if (!d.gecerli) al.kaynakGecersiz = d.neden;
  return al;
}

/**
 * Yayinci adina gore paketleyici logosu sec. Eslesme kurumAdi ile (buyuk/kucuk
 * harf ve bosluk duyarsiz); yoksa kurumId ile slug karsilastirmasi. Bulunamazsa
 * null: paketleyici varsayilan ikonu kullanir (2026-08-26'ya kadar HER paket boyleydi —
 * ajan logoId hic gondermiyordu, dmg/apk mavi Electron ikonuyla cikiyordu).
 * @param {Array<{id:string,kurumId?:string,kurumAdi?:string}>} logos
 * @param {string|undefined} publisherName
 */
function pickLogoId(logos, publisherName) {
  if (!Array.isArray(logos) || !publisherName) return null;
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = norm(publisherName);
  if (!want) return null;
  const byName = logos.find((l) => norm(l.kurumAdi) === want);
  if (byName) return byName.id;
  const byId = logos.find((l) => norm(l.kurumId) === want);
  if (byId) return byId.id;
  // "YDS Publishing" vs "ydspublishing" gibi kısmi eşleşme (bir yönde içerme)
  const loose = logos.find((l) => want.includes(norm(l.kurumId)) || norm(l.kurumAdi).includes(want));
  return loose ? loose.id : null;
}

/**
 * Bir dosyayı zip'in KÖKÜNE (yol bilgisi olmadan, `zip -j`) ekler; aynı adlı giriş varsa ezer.
 * Pardus/Linux ikonu için: paketleyici `workingPath/ico.png`'yi okur, yayıncı build.zip'lerinde
 * bu dosya YOK (2026-09-12 ölçümü: YDS/Flashy/Cambridge zip köklerinde ikon yok → Electron
 * varsayılan ikonu). Giriş adı = dosyanın kendi adı; çağıran dosyayı istediği adla yazar.
 * @param {string} zipPath
 * @param {string} filePath
 * @returns {{ ok: boolean, error?: string }}
 */
function addFileToZipRoot(zipPath, filePath) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('zip', ['-j', '-q', zipPath, filePath], { encoding: 'utf8' });
  if (r.error) return { ok: false, error: String(r.error.message || r.error) };
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.stdout || `zip rc=${r.status}`).trim().slice(-300) };
  return { ok: true };
}

/**
 * İşler arasında yeniden başlatma isteği var mı? Bayrak dosyası varsa SİLER ve true döner.
 * Kod güncellemesi sonrası ajanı iş ortasında öldürmeden (kira/paket kaybı) yenilemek için:
 * `touch ~/.empp-agent/yeniden-baslat.istek` → runner o anki işi bitirir, çıkar, launchd
 * (KeepAlive) yeni kodla başlatır. Dosya yoksa/silinemezse false (iş sürer).
 * @param {string} flagPath
 * @returns {boolean}
 */
/**
 * Duraklatma bayrağı: dosya DURDUKÇA ajan yeni iş almaz (silinmez, kalıcı; kaldıran
 * çağıran taraftır). Kullanım: bu Mac'te elle/harici bir üretim koşarken paketleyicide
 * "aynı anda tek build" kuralını korumak (2026-09-12: Vitanova partisi + ajanın Flashy
 * android işi aynı anda koşunca Gradle R.jar yarışı, android üretimi düştü).
 */
function pauseRequested(flagPath) {
  const fs = require('fs');
  try { return fs.existsSync(flagPath); } catch (e) { return false; }
}

/**
 * Konuma göre etkin yetenekler (2026-09-12, Nadir kararı): macOS (dmg) işi noter için 300-500 MB'ı
 * Apple'a YÜKLER; ev hattında bu yükleme diğer her şeyi (pardus Electron indirmesi dahil) boğar.
 * Kural: mac yalnız ofiste ya da `macos-serbest.istek` bayrağıyla; `macos-durdur.istek` her yerde keser.
 * android/pardus konumdan bağımsız sürer. Sunucu next-job'u heartbeat'teki yeteneklere göre kiralar.
 */
function etkinYetenekler(caps, durum) {
  const d = durum || {};
  const macMi = (c) => c === 'macos' || c === 'mac';
  // `macAraci`: Apple araç zinciri (xcrun/notarytool) ayakta mı.
  //
  // 2026-09-16: Xcode 27.0 otomatik güncellemesi lisans onayını sıfırladı; xcrun'a
  // bağlı HER ŞEY rc=69 vermeye başladı (notarytool dahil). Ajan bunu bilmediği için
  // mac işi kiralamaya devam etti: her iş ~730 MB kaynak indirdi, 35 saniyede
  // `Electron Builder mac build failed (exit code 1)` aldı ve satıra sahte bir
  // `failed` yazdı (73768, 72378). Yeteneği elle `macos-durdur.istek` ile kapatmak
  // zorunda kaldık — yani kurtarma İNSANA bağlıydı.
  //
  // Artık araç zinciri yetenek kapısının parçası: bozuksa mac kendiliğinden düşer,
  // lisans kabul edilince kendiliğinden geri gelir. `undefined` = ölçülmedi
  // (saf fonksiyon kendi başına prob çalıştırmaz) → engellemez; ajan her zaman
  // kesin bir boolean geçer.
  const aracKirik = d.macAraci === false;
  const izin = !d.macDurdur && !aracKirik && (Boolean(d.ofiste) || Boolean(d.macSerbest));
  // WINDOWS (2026-09-26, windows-serit.js): yalnız `EMPP_RUNNER_WINDOWS=1` (windowsAcik) VE imza
  // yuvası ölçülüp erişilir bulunduysa (imzaYuvasi === true) ilan edilir. İmzasız Windows paketi
  // yayına çıkamayacağı için yuvaya ulaşamayan ajan işi hiç kiralamaz. Ölçülmediyse ilan YOK.
  // İMZA BEKLİYOR (sözleşme exesiz-kaynak §2a, Nadir 02.10): hazır kuyruk açıkken (imzaBekleme)
  // yuva erişilemese de ilan edilir — paket üretilir, kabulden geçer, imzasız hâliyle hazır kuyruğa
  // girer, yayına ÇIKMAZ; imzayı yuva açılınca bekçi atar. `imzaBekleme` verilmezse eski kural.
  const windowsIzin = d.windowsAcik === true && (d.imzaYuvasi === true || d.imzaBekleme === true);
  return caps.filter((c) => (izin || !macMi(c)) && (windowsIzin || c !== 'windows'));
}

/**
 * PARDUS KABUL ERİŞİM KAPISI (2026-09-27): ProBook'a (kabul betiğinin GERÇEKTEN ssh ile
 * bağlanacağı host) erişilemiyorken Mac `pardus` yeteneğini heartbeat'ten düşürür.
 *
 * NEDEN: kabul kapısı açıkken (`EMPP_PARDUS_KABUL=1`) her pardus işi 1,5–10 dk derleniyor,
 * sonra `tools/pardus/probook-kabul.sh` `ssh … 'echo hazir'` ile düşüp "RED: ProBook'a
 * baglanilamadi" veriyor — iş ertelenebilir sayılıp 30 dk kirada aynı döngü tekrarlanıyor
 * (27.09, ProBook 11:10Z'den beri kapalı: 60014 11:51→12:00 boşa derledi). Windows imza
 * yuvası için aynı sınıf `imzaYuvasiDurumu` ile önceden çözüldü — burada birebir kalıp.
 *
 * Saf: env okumaz, ssh/prob çağrısı YAPMAZ — sonucu çağıran (probookErisimDurumu) sağlar.
 * Girdi dizisi mutasyona UĞRAMAZ.
 *
 * `yedekAktif` (2026-09-27, SÜRELİ KONTEYNER YEDEK KABUL): Nadir'in bayrağıyla açılan geçici
 * mod — ProBook elektrik kesintisi gibi bir sebeple erişilemezken kabul bu Mac'teki Docker
 * konteyner kapısından (tools/pardus/konteyner-kapi.sh) yapılır. true iken ProBook
 * erişilemezliği pardus'u heartbeat'ten DÜŞÜRMEZ — iş yine kiralanır, kabul konteyner
 * yoluna düşer (pardusKabulKapisi, runner.js).
 * @param {string[]} caps
 * @param {{kabulAcik:boolean, kapiAcik:boolean, host:string, erisilir:(boolean|null|undefined), yedekAktif?:boolean}} d
 * @returns {string[]}
 */
function pardusKabulErisimUygula(caps, d) {
  const durum = d || {};
  if (!Array.isArray(caps) || !caps.includes('pardus')) return caps; // pardus caps'te yok
  if (!durum.kabulAcik) return caps; // kabul kapısı kapalı → ProBook hiç gerekmiyor
  if (durum.kapiAcik === false) return caps; // acil kapatma: EMPP_PARDUS_KABUL_ERISIM=0
  if (durum.host === 'yerel') return caps; // kabul ProBook'un kendisinde koşuyor
  if (durum.yedekAktif) return caps; // süreli konteyner yedek kabulü açık — erişilemezlik düşürmez
  if (durum.erisilir === false) return caps.filter((c) => c !== 'pardus');
  return caps; // true/undefined/null (henüz ölçülmedi) — bugünkü davranış korunur
}

/**
 * SÜRELİ KONTEYNER YEDEK KABUL BAYRAĞI (2026-09-27, Nadir: "ProBook yarına kadar kapalı,
 * bu Mac'teki docker üzerinden fallback'i devreye al"). Bayrak dosyasının içeriğini yorumlar —
 * saf fonksiyon, dosya İŞLEMİ YAPMAZ (okuma çağıran tarafta, bkz. runner.js `pardusYedekKabul`).
 *
 * İlk boş olmayan satır bitiş ISO zaman damgasıdır. Süresi dolan bayrak SİLİNMEZ, yalnız
 * yok sayılır (bir sonraki okuyucu `suresi-doldu` sebebiyle pasif görür).
 *
 * @param {string} icerik bayrak dosyasının ham metni (yoksa çağıran '' geçer)
 * @param {number} [simdiMs] test için enjekte edilebilir "şimdi" (varsayılan Date.now())
 * @returns {{aktif:true, bitis:string}|{aktif:false, bitis?:string, sebep:'suresi-doldu'|'gecersiz'}}
 */
function pardusYedekKabulDurumu(icerik, simdiMs) {
  const simdi = typeof simdiMs === 'number' ? simdiMs : Date.now();
  const satir = String(icerik == null ? '' : icerik)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  if (!satir) return { aktif: false, sebep: 'gecersiz' };
  const zaman = Date.parse(satir);
  if (Number.isNaN(zaman)) return { aktif: false, sebep: 'gecersiz' };
  if (zaman > simdi) return { aktif: true, bitis: satir };
  return { aktif: false, bitis: satir, sebep: 'suresi-doldu' };
}

/** `route -n get default` çıktısından ağ geçidini çeker; yoksa null. */
/**
 * `dusuk-veri` ikilisinin çıktısını yorumlar (Nadir kuralı 2026-09-13): WiFi Düşük Veri Modu
 * (Network framework: path.isConstrained) açıksa yükleme/iş alımı duraklatılır — yol/hotspot verisini yakmaz.
 * Girdi ör: "constrained=1 expensive=0 status=ok". Güvenli varsayılan: okunamazsa FALSE (üretimi durdurma).
 */
function dusukVeriAyristir(ciktiStr) {
  const m = /constrained=([01])/.exec(String(ciktiStr || ''));
  return m ? m[1] === '1' : false;
}

function agGecidiAyikla(routeCiktisi) {
  const m = /gateway:\s*([0-9.]+)/.exec(String(routeCiktisi || ''));
  return m ? m[1] : null;
}

function restartRequested(flagPath) {
  const fs = require('fs');
  try {
    if (!fs.existsSync(flagPath)) return false;
    fs.unlinkSync(flagPath);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * True when a packager job-status response means the job is done (any terminal state).
 * @param {string} status
 */
function isTerminalStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return s === 'completed' || s === 'failed';
}

/**
 * Pull the per-platform status string out of the packager's /package-status body.
 * Shape: { success, jobId, job: { status, progress, results, error } }.
 * Returns '' if not determinable yet.
 *
 * @param {any} body
 * @returns {string}
 */
function packageStatusOf(body) {
  if (!body || typeof body !== 'object') return '';
  const job = body.job && typeof body.job === 'object' ? body.job : null;
  if (job && job.status != null) return String(job.status).trim().toLowerCase();
  return '';
}

/**
 * File extension (with leading dot) for a built artifact of the given packager platform.
 * @param {('android'|'macos'|'pardus'|string)} packagerPlatform
 */
function artifactExtension(packagerPlatform) {
  switch (String(packagerPlatform || '').trim().toLowerCase()) {
    case 'android':
      return '.apk';
    case 'macos':
      return '.dmg';
    case 'pardus':
      return '.impark';
    case 'windows':
      return '.exe';
    default:
      return '';
  }
}

/**
 * Best-effort Content-Type for a built artifact, keyed the same way as
 * artifactExtension. The R2 upload's REAL Content-Type is always the server's
 * presigned value (`presigned.contentType` in runner.js) — this map only feeds a
 * local fallback header when a caller needs one before presigning (defensive; the
 * agent never invents the signed header). `.impark` is an opaque squashfs/AppImage
 * blob, so 'application/octet-stream' — same bucket as an unrecognized platform.
 * @param {('android'|'macos'|'pardus'|string)} packagerPlatform
 */
function artifactContentType(packagerPlatform) {
  switch (String(packagerPlatform || '').trim().toLowerCase()) {
    case 'android':
      return 'application/vnd.android.package-archive';
    case 'macos':
      return 'application/x-apple-diskimage';
    case 'windows':
      return 'application/x-msdownload';
    case 'pardus':
    default:
      return 'application/octet-stream';
  }
}

/** Join a base URL and a path safely (single slash). */
function joinUrl(base, p) {
  return `${String(base).replace(/\/+$/, '')}/${String(p).replace(/^\/+/, '')}`;
}

/**
 * Clip a (possibly very long, multi-line) packager error to a reportable size while
 * keeping the diagnostic core. A Gradle failure puts the real cause under a
 * "What went wrong" header several lines into the message — a blind slice(0, maxLen)
 * can cut that off and leave only the generic preamble. When the marker is present,
 * always keep it plus the following 6 lines, even if that means the head of the
 * message gets truncated harder to make room.
 *
 * @param {string} raw
 * @param {number} [maxLen=1500]
 * @returns {string}
 */
function clipPackagerError(raw, maxLen = 1500) {
  const s = String(raw == null ? '' : raw);
  if (s.length <= maxLen) return s;

  const marker = 'What went wrong';
  const idx = s.indexOf(marker);
  if (idx === -1) return s.slice(0, maxLen);

  // marker line + up to 6 following lines.
  const block = s.slice(idx).split('\n').slice(0, 7).join('\n');
  if (block.length >= maxLen) return block.slice(0, maxLen);

  const headBudget = maxLen - block.length - 1; // -1 for the joining newline
  const head = headBudget > 0 ? s.slice(0, headBudget) : '';
  return (head ? `${head}\n${block}` : block).slice(0, maxLen);
}

/**
 * Decide whether a packager `/api/package-status/:jobId` response means "there is a
 * real, downloadable package for this platform" — and if not, build the failure
 * message to report upstream.
 *
 * Bug this guards against (2026-09-08, book-update agent): `packagingService.startPackaging`
 * catches each platform's build error internally and stores it as
 * `job.results[platform] = {success:false, error}`, then RETURNS NORMALLY — so the
 * packager's overall `job.status` is 'completed' even though the requested platform
 * has no package. The agent used to treat 'completed' as "go download", hit a 404 on
 * `/api/download`, and reported `last_error: "artifact download failed: curl exit 22
 * (404 ...)"` — the real cause ("Gradle build failed: ... Java heap space") never
 * reached the DB; diagnosis took 20 minutes reading server logs by hand.
 *
 * @param {any} body                    parsed `/api/package-status` JSON: {success, jobId, job}
 * @param {string} packagerPlatform     the single platform this agent requested ('android'|'macos')
 * @returns {{ok:true}|{ok:false, message:string}}
 */
function packagerResultOf(body, packagerPlatform) {
  const job = body && typeof body === 'object' && body.job && typeof body.job === 'object' ? body.job : null;
  const results = job && job.results && typeof job.results === 'object' ? job.results : null;
  const platformResult = results && results[packagerPlatform] && typeof results[packagerPlatform] === 'object'
    ? results[packagerPlatform]
    : null;

  if (platformResult && platformResult.success === true) {
    return { ok: true };
  }

  // En spesifik olan platform hatasını tercih et (örn. "Android APK üretilemedi: ...
  // Gradle build failed: ... Java heap space"); yoksa job-seviyesi hataya, o da yoksa
  // genel "paket yok" mesajına düş.
  const platformError = platformResult && platformResult.error != null ? String(platformResult.error) : '';
  const jobError = job && job.error != null ? String(job.error) : '';
  const raw = platformError || jobError
    || `paket üretilmedi: '${packagerPlatform}' için başarılı sonuç yok`;

  return { ok: false, message: clipPackagerError(raw) };
}


/**
 * Paketleyiciye gönderilen uygulama adı ASCII olmalı (2026-08-28): "YKS-DİL Dergi Seti" gibi
 * Türkçe harfli adlarda paketleyici çıktıyı üretti ama /api/download 500 verdi (45496 mac+android).
 * R2'deki nihai ad zaten API'de (artifactFileName) kuruluyor; burası yalnız paketleyici iç adı.
 */
const TR_MAP = { 'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G', 'ı': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O', 'ş': 's', 'Ş': 'S', 'ü': 'u', 'Ü': 'U' };
function asciiAppName(name, fallback = 'book') {
  const s = String(name || '')
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => TR_MAP[ch] || ch)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ()._-]/g, ' ').replace(/\s+/g, ' ').trim();
  return s || fallback;
}

/**
 * Ağ/geçici hata mı? (kesinti, DNS, 5xx, R2 complete/presign) — kalıcı hata değil, yeniden denenir.
 *
 * Boş/eksik mesajlı hatalar (`''`, `undefined`, `null`, `.message`'sız nesne) de GEÇİCİ sayılır:
 * ağ katmanı hataları (özellikle macOS/undici) sıklıkla mesajsız gelir; bunları kalıcı saymak
 * gerçek bir ağ kesintisini iş hatası gibi düşürüp yeniden denenmesini engeller (2026-09-13
 * `heartbeat failed: ` — iki nokta üst üsteden sonra mesaj boş — kanıtı).
 *
 * @param {Error|string|*} err
 * @returns {boolean}
 */
function isTransientNetworkError(err) {
  let raw;
  if (typeof err === 'string') {
    raw = err;
  } else if (err && typeof err === 'object' && typeof err.message === 'string') {
    raw = err.message;
  } else {
    raw = '';
  }
  if (raw.trim() === '') return true;
  // `lease_not_held` (HTTP 409): kira, iş sürerken doldu. Bu bir PAKET kusuru
  // değildir — makine uyuduğu/ağı gittiği için kalp atışı duramadı demektir.
  // 2026-09-16 ölçümü: dizüstü evden ofise taşınırken iki kez uyudu (10 + 28 dk),
  // DNS ~55 dk çözmedi; 45480 pardus paketi derlendi (bütünlük TAM), TÜM parçalar
  // yüklendi, yalnız son `complete-multipart` 409 aldı. Ajan satıra `failed` yazdı.
  // (Satır API'nin "agent lease expired - otomatik recovery" mekanizmasıyla kendi
  // kendine `queued`'a döndü — KİLİTLENMEDİ.) Yine de yazmak iki kez yanlıştı:
  // kira artık bizde değil, yani sahibi olmadığımız bir kaydı eziyoruz; ve paket
  // sağlam olduğu hâlde partiye sahte bir başarısızlık düşüyor. Doğrusu diğer
  // geçici hatalarla aynı: `failed` YAZMA, satırı normal claim akışına bırak.
  // `timeout of Nms exceeded` / ECONNABORTED: axios'un KENDİ zaman aşımı biçimi (ETIMEDOUT
  // değil). Eksikti → 27.09 gecesi 45100/45449 android paketleyici durum yoklaması
  // (127.0.0.1:3001, 30 sn) tek seferlik takılınca işler `failed` yazıldı; paketleyici
  // ikisini de başarıyla bitirmişti. 2026-08-30 45549 mac (ağ kesintisinde presign
  // 120 sn) aynı sınıftı.
  return /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ECONNABORTED|timeout of \d+ms exceeded|EHOSTUNREACH|ENETUNREACH|EPIPE|socket hang up|network|fetch failed|lease_not_held|complete-multipart failed: HTTP (5\d\d|0)|presign-multipart failed: HTTP 5|could not be uploaded|curl exit (6|7|28|35|52|55|56)\b/i.test(raw);
}

/**
 * Paketleyici durum yoklaması (GET /api/package-status, 127.0.0.1:3001) tek isteği düşünce
 * aynı yoklamada yeniden denenmeli mi? Saf.
 *
 * Neden (27.09 gecesi, ölçümle): 45100 ve 45449 android yoklamaları TEK bir 30 sn'lik
 * zaman aşımıyla düştü ve iş `failed` yazıldı; paketleyici günlüğünde ikisi de
 * "Paketleme tamamlandı" — APK üretilmişti, yalnız durum cevabı makine yükü altında
 * geç kaldı. Yoklama idempotent ve ucuz; tek kaçırılan cevap paketi geçersiz kılmaz.
 * Tavan ardışık hatayı sınırlar: paketleyici gerçekten ölmüşse iş yine düşer (ve
 * hata geçici sınıfta olduğundan `failed` yazılmaz, kira dolunca yeniden kuyruğa girer).
 *
 * @param {*} hata       axios hatası
 * @param {number} ardisik  bu hata DAHİL ardışık düşen istek sayısı
 * @param {number} [tavan]
 * @returns {boolean} true → bekle ve yeniden sor; false → fırlat
 */
function yoklamaYenidenDenenir(hata, ardisik, tavan = PAKETLEYICI_YOKLAMA_HATA_TAVANI) {
  return isTransientNetworkError(hata) && Number(ardisik) < Number(tavan);
}
/** Ardışık düşen durum isteği tavanı: 6 × (30 sn + 5 sn) ≈ 3,5 dk takılmaya dayanır. */
const PAKETLEYICI_YOKLAMA_HATA_TAVANI = Number(process.env.AGENT_PACKAGER_POLL_HATA_TAVANI || 6);

// ---------------------------------------------------------------------------
// Pardus disk kapısı — BOYUT ORANTILI (2026-09-19, ölçümle).
// ---------------------------------------------------------------------------
/**
 * Bir pardus derlemesinin gerektirdiği boş disk alanını kaynağın SIKIŞTIRILMIŞ
 * boyutundan türetir.
 *
 * Neden: eski kapı düz bir sabitti (`PARDUS_MIN_FREE_GB`, ajan başlatıcısında 45,
 * kodda 20) ve paketin boyutuna HİÇ bakmıyordu — 111 MB'lık kitap da 1,1 GB'lık
 * kitap da aynı 45 GB'ı istiyordu. Nadir'in sorusu ("3 GB boş varken 1,5 GB'lık
 * dosya neden reddediliyor?") bu sabitin ölçülmemiş olduğunu açığa çıkardı.
 *
 * Ölçüm (2026-09-19, açmadan — `zipfile` ile dizin okunarak):
 *   59834 build.zip 931 MB → açılmış 1085 MB (1,17×), 5612 dosya
 *   73581 build.zip 713 MB → açılmış  857 MB (1,20×), 3983 dosya
 * Eşzamanlı tepe zinciri: zip + açılmış build + app.asar (asar sıkıştırmaz) +
 * Electron linux-unpacked (~250 MB) + .impark çıktısı ≈ kaynak × 5.
 * 931 MB'lık kaynak için ≈ 4,4 GB; kapı 45 GB istiyordu (10 katı).
 *
 * TABAN NEDEN 15 GB? 45 sayısı keyfi değildi: 2026-09-17'de 20 GB kapısını kıl payı
 * geçen bir derleme SESSİZCE bozuk paket üretmişti (59834 → V8 snapshot FATAL).
 * Sebep eşiğin düşüklüğü değil, kapının TEK ANLIK olması: paketleyici 4 paralel iş
 * kabul ediyor ve ~35 dakikalık derleme boyunca android/mac işleri aynı diski yiyor,
 * yani başlangıçtaki boşluk bitişte kalan boşluk değil. Taban bu eşzamanlı tüketim
 * için ayrılan paydır; orantılı terim ise YALNIZ bu işin kendi tepesini karşılar.
 * Asıl emniyet ağı aşağıda değil ileride: K18 ProBook kabul kapısı + bütünlük ölçümü
 * bozuk paketi yüklenmeden yakalar (11811 bugün tam da oradan döndü).
 *
 * SAF fonksiyon — ölçüm (stat/HEAD) çağırana aittir, burada I/O yok.
 *
 * @param {object} p
 * @param {number|null} p.kaynakBayt Kaynağın sıkıştırılmış boyutu; bilinmiyorsa null.
 * @param {number} [p.kat]      Tepe/kaynak oranı (ölçülen ≈5).
 * @param {number} [p.tabanGb]  Eşzamanlı işler için ayrılan taban (varsayılan 15).
 * @param {number|null} [p.elleGb] Açık override (`PARDUS_MIN_FREE_GB`); verilirse tek söz sahibi.
 * @returns {number} Gereken boş GB (tam sayı).
 */
function pardusGerekliDiskGb({ kaynakBayt, kat = 5, tabanGb = 15, elleGb = null } = {}) {
  if (Number.isFinite(elleGb) && elleGb > 0) return Math.ceil(elleGb);
  const taban = Number.isFinite(tabanGb) && tabanGb > 0 ? Math.ceil(tabanGb) : 15;
  if (!Number.isFinite(kaynakBayt)) return taban; // ölçülemedi — tahmin üretme
  const k = Number.isFinite(kat) && kat > 0 ? kat : 5;
  // Sıfır/negatif boyut ayrıca elenmez: orantılı terim 0'ın altına düşse bile taban
  // (her zaman ≥ 1) kazanır. Ayrı bir koruma yazmak ölçülemeyen ölü dal üretirdi
  // (mutasyon testinde hayatta kalan tek mutant buydu, 2026-09-19).
  const orantili = Math.ceil((kaynakBayt / 1e9) * k);
  return Math.max(orantili, taban);
}

/** Disk kapısı hatalarını diğerlerinden ayıran işaret (mesaja gömülür). */
const DISK_KAPISI_ISARETI = '[ertelenebilir-kaynak-darligi]';

/**
 * Hata, paketin kusuru DEĞİL de makinenin o anki kaynak darlığı mı?
 *
 * Böyle bir hatada satıra `failed` YAZILMAZ: kira dolunca API satırı kuyruğa geri
 * alır ve paket ya disk boşalınca ya da srv21 şeridinde üretilir. Eski davranış
 * `status:'failed'` yazıyordu; panelde "PARDUS HATALI" görünen 8 iş (2026-09-19)
 * aslında bozuk paket değil, dolu diskti — yanlış teşhis defterde kalıyordu.
 *
 * @param {Error|string|*} err
 * @returns {boolean}
 */
/** ProBook'a ERİŞİLEMEMESİ hatalarını ayıran işaret (mesaja gömülür). */
const PROBOOK_KAPISI_ISARETI = '[ertelenebilir-probook-erisimi]';

/**
 * Başsız kabul kapısının ÖLÇEMEMESİ (Electron çalışma zamanı / emülatör / hdiutil
 * altyapısı) — paket kusuru DEĞİL; yükleme yapılmaz ama `failed` da yazılmaz
 * (src/agent/basliksiz-kabul-kapisi.js, 2026-09-26).
 */
const BASLIKSIZ_KABUL_ISARETI = '[ertelenebilir-basliksiz-kabul]';

/**
 * windows-kasa (gerçek Windows) kabulünün ÖLÇEMEMESİ — zaman aşımı, izleyici koptu, rapor gelmedi,
 * paket kasa'ya inmedi, kilit boşalmadı. Paket kusuru DEĞİL; yükleme yok, `failed` yazılmaz
 * (src/agent/windows-kasa-kabul.js, 2026-10-02).
 */
const WIN_KASA_KABUL_ISARETI = '[ertelenebilir-windows-kasa]';

/** Noter/imza zincirinin GEÇİCİ hatalarını ayıran işaret (mesaja gömülür). */
const NOTER_KAPISI_ISARETI = '[ertelenebilir-noter]';

function ertelenebilirKaynakHatasi(err) {
  const raw = typeof err === 'string' ? err
    : (err && typeof err === 'object' && typeof err.message === 'string') ? err.message
      : '';
  return raw.includes(DISK_KAPISI_ISARETI) || raw.includes(PROBOOK_KAPISI_ISARETI)
    || raw.includes(BASLIKSIZ_KABUL_ISARETI)
    || raw.includes(WIN_KASA_KABUL_ISARETI)
    || raw.includes(NOTER_KAPISI_ISARETI);
}

// ---------------------------------------------------------------------------
// NOTER KAPISI (2026-09-26, Nadir onayı) — noter onaysız DMG YÜKLENMEZ.
//
// NEDEN: `signAndNotarizeMac` best-effort'tu; notarytool düşünce "continuing without
// staple" deyip onaysız DMG'yi R2'ye yüklüyordu. Kanıt agent.log 26.09 06:11/06:14 UTC
// (59834 mac, 73768 mac): "Error: No Keychain password item found for profile:
// empp-notary". 06:17'den itibaren AYNI profille dört iş Accepted oldu → anahtarlık
// açılışta kilitliydi, oturum açılınca açıldı: bu sınıf GEÇİCİDİR.
//
// SINIFLANDIRMA (Şef ölçümü): ERTELENEBİLİR = anahtarlık öğesi bulunamadı/kilitli, ağ,
// zaman aşımı, Apple servisine erişilemedi (5xx), stapler'ın CloudKit yayılma yarışı
// ("Record not found"). Satıra `failed` YAZILMAZ, kira dolunca kuyruğa döner.
// KALICI = Apple "Invalid"/"Rejected" ve diğer her şey (imza hatası dahil).
// Kalıcı işaret ertelenebilir işarete BASKIN gelir (Invalid + timeout → kalıcı).
// ---------------------------------------------------------------------------
const NOTER_KALICI_RE = [
  /status:\s*(Invalid|Rejected)\b/i,
];
const NOTER_ERTELENEBILIR_RE = [
  /No Keychain password item found/i,
  /User interaction is not allowed/i,
  /errSecInteractionNotAllowed/i,
  /keychain is locked/i,
  // codesign'ın kilitli anahtarlık hatası (Şef kararı 26.09 — kök neden açılışta kilitli anahtarlık).
  /errSecInternalComponent/,
  /Internet connection appears to be offline/i,
  /NSURLErrorDomain/i,
  /network connection was lost/i,
  /timed out|time[- ]?out\b|zaman aşımı/i,
  /hostname could not be found|could not connect|unable to connect|cannot connect/i,
  /\b(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED)\b/,
  /HTTP (status )?(code:? )?5\d\d\b|Service Unavailable|Bad Gateway|Gateway Timeout/i,
  /timestamp service is not available/i,
  /Record not found/i,
];

/**
 * Araç çıktısından (stdout+stderr) raporlanacak İLK ANLAMLI satır. notarytool ilk satıra
 * "Conducting pre-submission checks…" yazar — bilgi taşımaz; ilk hata satırı seçilir
 * ("Error: No Keychain password item found…"), yoksa ilk boş olmayan satır. SAF.
 * @param {string} metin
 * @returns {string}
 */
function noterIlkSatir(metin) {
  const satirlar = String(metin == null ? '' : metin).split(/\r?\n/)
    .map((s) => s.trim()).filter(Boolean);
  const hata = satirlar.find((s) => /error|invalid|rejected|failed|fail|hata|denied/i.test(s));
  return (hata || satirlar[0] || '').slice(0, 300);
}

/**
 * Noter/imza hatası geçici mi? SAF. @param {string} metin @returns {boolean}
 */
function noterHatasiErtelenebilirMi(metin) {
  const m = String(metin == null ? '' : metin);
  if (NOTER_KALICI_RE.some((re) => re.test(m))) return false;
  return NOTER_ERTELENEBILIR_RE.some((re) => re.test(m));
}

/**
 * Noter kapısı hatasını üretir: "noter onayı alınamadı — DMG yüklenmedi: <ilk satır>".
 * Geçiciyse mesaja `NOTER_KAPISI_ISARETI` eklenir → `ertelenebilirKaynakHatasi` tanır.
 * @param {string} asama 'codesign' | 'notarytool' | 'stapler' | 'yapilandirma'
 * @param {{code?:number, stdout?:string, stderr?:string}|null} res
 * @returns {Error & {ertelenebilir:boolean, asama:string}}
 */
function noterHatasi(asama, res) {
  const ham = res ? [res.stdout, res.stderr].filter((x) => typeof x === 'string').join('\n') : '';
  const ilk = noterIlkSatir(ham) || `(çıktı boş, rc=${res ? res.code : '?'})`;
  const ertelenebilir = noterHatasiErtelenebilirMi(ham);
  const e = new Error(`noter onayı alınamadı — DMG yüklenmedi: ${ilk} (${asama}`
    + `${res && res.code != null ? `, rc=${res.code}` : ''})${ertelenebilir ? ` ${NOTER_KAPISI_ISARETI}` : ''}`);
  e.ertelenebilir = ertelenebilir;
  e.asama = asama;
  return e;
}

/**
 * probook-kabul.sh RED çıktısı, paketin kusuru DEĞİL de ProBook'a ERİŞİLEMEMESİ mi?
 * (ssh bağlantısı kurulamadı / ProBook'un kendi diski dolu / kapı ProBook yanıt
 * vermediği için zaman aşımına uğradı). Bu üçü ALTYAPI'dır — ölçüm 2026-09-21:
 * 45478 pardus 03:41'de "ProBook'a baglanilamadi" ile düştü (gece, muhtemelen makine
 * uykuda), 12:50'de AYNI IP (etapadmin@192.168.1.55, script varsayılanıyla birebir)
 * ile GEÇTİ — IP/config hatası değil, o anki erişilebilirlik.
 *
 * AKTARIM DÜŞÜŞÜ de bu sınıftadır (2026-09-27, ölçümle): 45477 pardus'ta paket Mac'ten
 * ProBook'a giderken srv21 atlaması 6 dk sonra düştü, scp yedeği 600/1277 MB'ta kaldı
 * (Mac kapak kapalı pilde 05:20Z'de uyudu, Wi-Fi 05:30–06:02Z yok) → "RED: kopyalanamadi"
 * ile `failed` yazıldı; AYNI paket 06:02'de yeniden kiralandı. Kopyalanamamak paketin
 * içeriğiyle ilgisizdir. Kapı: "RED: ProBook'a aktarim dustu" (PROBOOK_AKTARIM dolu) ve
 * eski tek-scp yolunun "RED: kopyalanamadi" satırı. sha256 UYUŞMAZLIĞI bu sınıfa GİRMEZ
 * ("aktarim dogrulanamadi") — test edilen bayt ≠ yayınlanacak bayt, RED kalır.
 *
 * Paketin AÇILAMAMASI, penceresinin içerik taşımaması veya kapanması bu sınıfa
 * GİRMEZ — o gerçek paket kusurudur (K18), `failed` yazılması doğrudur.
 *
 * @param {string} cikti probook-kabul.sh birleşik stdout/stderr çıktısı
 * @param {boolean} [timedOut] kapı betiği kendi üst sınırında bitmediyse true
 * @returns {boolean}
 */
const PROBOOK_AKTARIM_DUSUSU_RE = /RED: ProBook'a aktarim dustu|RED: kopyalanamadi\b/;
function probookErisilemezHatasi(cikti, timedOut = false) {
  if (timedOut) return true;
  const raw = typeof cikti === 'string' ? cikti : '';
  return /ProBook'a baglanilamadi/.test(raw) || /ProBook diskinde yer yok/.test(raw)
    || PROBOOK_AKTARIM_DUSUSU_RE.test(raw);
}

/**
 * probook-kabul.sh'in YENİ iki karar sınıfını ayırır — saf fonksiyon (2026-09-26, kabul kapısı
 * canlı yarısı; rapor ~/.empp-agent/arastirma/e2e-kanit-pardus-kabul-20260926.md §B.1):
 *   rc 3 RED-GÜNCEL-DEĞİL → stdout `GUNCEL-DEGIL: <ayrıntı>` + `yeniden kuyruk onerisi: <öneri>`;
 *        runner `failed` yazar, last_error `güncel değil:` ile başlar, paket YÜKLENMEZ.
 *   rc 4 ÖLÇÜLEMEDİ       → stdout `OLCULEMEDI: <sebep>`; paket kusuru DEĞİL, `failed` yazılmaz.
 * Diğer kodlar için null (eski sınıflama: erişilemez / RED).
 * @param {{code:number, stdout?:string, stderr?:string, timedOut?:boolean}} kabul
 * @returns {{durum:'GUNCEL_DEGIL'|'OLCULEMEDI', sebep:string, oneri:string}|null}
 */
function pardusKabulSinifi(kabul) {
  if (!kabul || kabul.timedOut) return null;
  const cikti = `${kabul.stdout || ''}\n${kabul.stderr || ''}`;
  const satir = (desen) => {
    const m = cikti.split('\n').map((s) => s.replace(/^\[kabul\]\s*/, '')).find((s) => desen.test(s));
    return m ? m.replace(desen, '').trim() : '';
  };
  if (kabul.code === 3) {
    return {
      durum: 'GUNCEL_DEGIL',
      sebep: satir(/^GUNCEL-DEGIL:\s*/) || 'kapı güncel değil dedi (ayrıntı yok)',
      oneri: satir(/^yeniden kuyruk onerisi:\s*/),
    };
  }
  if (kabul.code === 4) {
    return { durum: 'OLCULEMEDI', sebep: satir(/^OLCULEMEDI:\s*/) || 'kapı ölçemedi (ayrıntı yok)', oneri: '' };
  }
  return null;
}

/**
 * Bir hata nesnesinden loglanabilir TEK SATIRLIK özet üretir — saf fonksiyon.
 *
 * KÖK NEDEN (2026-09-13 ölçüm, 18 günlük heartbeat günlüğü): 3930 heartbeat
 * hatasının %52,4'ü (2057) BOŞ `.message` ile logluyordu. Sebep: Node 20+
 * Happy Eyeballs (`autoSelectFamily`) A ve AAAA'yı paralel dener; ikisi de
 * düşünce fırlatılan `AggregateError`'ın ÜST `.message`'ı boş string'tir —
 * gerçek bilgi `.code` ve `.errors[]` (ya da `.cause.errors[]`) içindedir.
 *
 * Öncelik sırası:
 *   1. `err.message` doluysa onu kullan.
 *   2. AggregateError-benzeri (`err.errors` ya da `err.cause?.errors` bir dizi):
 *      alt hataların code/message'larını benzersizleştirip virgülle birleştirir
 *      (ör. `AggregateError: ECONNREFUSED, ENETUNREACH`).
 *   3. `err.code`, yoksa `err.cause?.code`.
 *   4. Hiçbiri yoksa `'bilinmeyen hata'`.
 *
 * String girdi kendi metnini kullanır (boşsa yine `'bilinmeyen hata'`);
 * null/undefined `'bilinmeyen hata'` döner. Çıktı her zaman tek satırdır
 * (yeni satırlar boşluğa çevrilir) ve `maxLen` karaktere kırpılır.
 *
 * @param {Error|AggregateError|string|null|undefined} err
 * @param {number} [maxLen=200]
 * @returns {string}
 */
function agHatasiOzeti(err, maxLen = 200) {
  const sinir = Number.isFinite(maxLen) && maxLen > 0 ? maxLen : 200;
  const tekSatir = (s) => String(s).replace(/\s+/g, ' ').trim();
  const kirp = (s) => {
    const t = tekSatir(s);
    return t.length > sinir ? `${t.slice(0, sinir - 1)}…` : t;
  };

  if (err == null) return 'bilinmeyen hata';

  if (typeof err === 'string') {
    const t = tekSatir(err);
    return t ? kirp(t) : 'bilinmeyen hata';
  }

  if (typeof err === 'object') {
    const msg = typeof err.message === 'string' ? tekSatir(err.message) : '';
    if (msg) return kirp(msg);

    // AggregateError benzeri: kendi .errors'ı ya da .cause.errors'ı bir dizi.
    const altHatalar = Array.isArray(err.errors)
      ? err.errors
      : (err.cause && Array.isArray(err.cause.errors) ? err.cause.errors : null);
    if (altHatalar && altHatalar.length > 0) {
      const gorulen = new Set();
      const parcalar = [];
      for (const alt of altHatalar) {
        let p = null;
        if (alt && typeof alt === 'object') p = alt.code || alt.message || null;
        else if (typeof alt === 'string') p = alt;
        if (p) {
          p = String(p);
          if (!gorulen.has(p)) { gorulen.add(p); parcalar.push(p); }
        }
      }
      if (parcalar.length > 0) {
        const ad = (typeof err.name === 'string' && err.name) || 'AggregateError';
        return kirp(`${ad}: ${parcalar.join(', ')}`);
      }
    }

    const kod = err.code || (err.cause && err.cause.code);
    if (kod) return kirp(String(kod));
  }

  return 'bilinmeyen hata';
}

/**
 * Kaynak cache dizin adını (`<cacheRoot>/<bookId>/<srcVersion>/build.zip`) indirme
 * URL'sinden türetir — saf (IO yok, `crypto` yalnız hash için kullanılır).
 *
 * KÖK NEDEN (2026-09-13 ölçüm): eski kod `downloadUrl.split(/[/?#]/).filter(Boolean).pop()`
 * yapıyordu — yani URL'yi `/`, `?`, `#` karakterlerinin HEPSİNDE bölüp SON parçayı
 * alıyordu. Presigned R2/S3 URL'lerinde sorgu dizesindeki `X-Amz-Credential` değeri
 * `%2F` (encoded '/') taşır, LİTERAL '/' taşımaz — yani sorgu dizesinin içinde hiç
 * bölünme noktası olmuyor ve `pop()` doğrudan TÜM sorgu dizesini (imza+tarih+süre
 * dahil) döndürüyordu. İmza her presign'de değiştiği için aynı dosya için üretilen
 * ad da her seferinde değişiyor, cache asla HIT olmuyordu (45449/45448/45472/45496/
 * 45551 dizinleri — hepsi `X-Amz-Algorithm_...` ile başlıyordu).
 *
 * DÜZELTME: önce sorgu/hash (`?`, `#` sonrası) tamamen ATILIR, yalnız YOL kısmı
 * kalır; yoldaki `/`-ayrılmış son parça alınır. Bu son parça boşsa veya sanitize
 * sonrası hiç alfasayısal karakter içermiyorsa (anlamsız — ör. yalnız noktalama ya
 * da hiç yol yok), yolun kısa sha1'inden deterministik bir yedek üretilir — ASLA
 * imza/sorgu içeren bir ad üretilmez. Aynı girdi HER ZAMAN aynı çıktıyı verir
 * (saf fonksiyon), böylece presigned URL yeniden imzalansa bile (yol aynı kaldığı
 * sürece) cache HIT korunur.
 *
 * Sağlıklı eski adlar (`English-Up-6-v47.exe`, `SM2v10.exe`) davranış olarak
 * DEĞİŞMEZ — bunlar zaten sorgusuz, güvenli karakterli yol sonlarıdır.
 *
 * @param {string} downloadUrl
 * @param {number} [maxLen=80]
 * @returns {string} dizin-adı-güvenli, deterministik srcVersion
 */
function srcVersionTuret(downloadUrl, maxLen = 80) {
  const ham = String(downloadUrl == null ? '' : downloadUrl);
  // Sorgu dizesi + hash ATILIR (presigned imza/tarih/süre burada yaşar).
  const yolKismi = ham.split(/[?#]/)[0];
  const parcalar = yolKismi.split('/').filter(Boolean);
  const sonParca = parcalar.length ? parcalar[parcalar.length - 1] : '';
  const sinirli = Number.isFinite(maxLen) && maxLen > 0 ? maxLen : 80;
  const temiz = sonParca.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, sinirli);
  if (temiz && /[a-zA-Z0-9]/.test(temiz)) return temiz;
  // Yol parçası yok/anlamsız -> yolun kendisinden deterministik yedek (imza YOK).
  const crypto = require('crypto');
  const hash = crypto.createHash('sha1').update(yolKismi).digest('hex').slice(0, 16);
  return `src-${hash}`;
}

// ---------------------------------------------------------------------------
// SET güncelleme kanalı — Runner parçası (3/3, 2026-09-23, bkz.
// .claude/docs/kitap-guncelleme-sozlesmesi.md "Sunucu tarafı — TASARIM").
// Bu bölümdeki fonksiyonlar SAFTIR (I/O yok) — tar/curl/fs çağrıları runner.js'te.
// ---------------------------------------------------------------------------

/**
 * Bir SET güncelleme paketindeki dosyaları YÜKLEME SIRASINA göre sıralar:
 * önce `dosya/*` (kabuk içerik), sonra `manifest.json`, EN SON `surum.json`.
 *
 * Neden bu sıra (sözleşme, "Üyelik kuralları" + "Çalışma anı kuralları"): bir
 * tüketici (çalışan exe) `surum.json`'u okuyup "yeni sürüm var" kararını verir —
 * içerik ve manifest R2'de ondan ÖNCE durmalı, yoksa bir istemci surum.json'u
 * görüp manifest/dosya henüz orada değilken güncellemeye kalkar (yarım görünüm).
 * BAŞKA BİR SIRA KABUL EDİLMEZ.
 *
 * Girdi öğeleri düz string (yol) ya da `{yol, ...}` nesnesi olabilir; nesneler
 * kendi kimliğiyle (yalnız yeniden sıralanmış olarak) döner. Orijinal liste
 * DEĞİŞTİRİLMEZ (kopya üzerinde çalışılır); aynı kategori içindeki öğeler girdi
 * sırasını korur (kararlı sıralama).
 *
 * @param {Array<string|{yol:string}>} liste
 * @returns {Array<string|{yol:string}>}
 */
function guncellemeDosyalariniSirala(liste) {
  if (!Array.isArray(liste)) return [];
  const yolOf = (item) => (typeof item === 'string'
    ? item
    : (item && typeof item === 'object' && item.yol != null ? String(item.yol) : ''));
  const kategori = (yol) => {
    if (yol === 'surum.json') return 2;
    if (yol === 'manifest.json') return 1;
    return 0; // 'dosya/*' ve tanınmayan her şey — en güvenli varsayılan EN ÖNCE gider
  };
  return liste
    .map((item, index) => ({ item, index, sira: kategori(yolOf(item)) }))
    .sort((a, b) => (a.sira - b.sira) || (a.index - b.index))
    .map((x) => x.item);
}

/**
 * Bir SET kabuk/güncelleme dosyasının Content-Type'ını uzantısından türetir.
 * SAF fonksiyon — `presign-guncelleme` isteğine giden `dosyalar[].contentType`
 * alanını doldurmak için kullanılır. R2'ye giden GERÇEK PUT header'ı her zaman
 * ayrıca verilir (bu yalnız istek gövdesini/yerel curl header'ını besler, sunucu
 * imzasının yerine geçmez).
 *
 * @param {string} yol
 * @returns {string}
 */
function guncellemeIcerikTipi(yol) {
  const m = String(yol || '').toLowerCase().match(/\.[a-z0-9]+$/);
  const ext = m ? m[0] : '';
  const TIPLER = {
    '.html': 'text/html', '.htm': 'text/html',
    '.json': 'application/json',
    '.js': 'application/javascript', '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.ttf': 'font/ttf', '.otf': 'font/otf',
    '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
    '.pdf': 'application/pdf',
    '.wasm': 'application/wasm',
    '.txt': 'text/plain',
    '.xml': 'application/xml',
  };
  return TIPLER[ext] || 'application/octet-stream';
}

/**
 * `tar -tzf <arşiv>` çıktısını (satır başına bir yol) SET güncelleme paketinin
 * beklenen köküne (`set/<setKimligi>/`) göre ayrıştırır: dizin girdilerini ve
 * beklenen kökün DIŞINDA kalan/güvensiz girdileri ELER, kalanları köke göre
 * GÖRELİ yola indirger.
 *
 * Güvenlik (sözleşme "Varsayılan RET" — eksik alan/`..`/mutlak yol → o öğe
 * atlanır): `..` segmenti içeren, `/` ile başlayan (mutlak) ya da beklenen
 * `setKimligi` kökünün dışında kalan girdiler SESSİZCE elenir — fırlatmaz,
 * dönen listede yer almaz. Boş satırlar ve `/` ile biten dizin girdileri de
 * elenir.
 *
 * SAF fonksiyon — tar'ı ÇALIŞTIRMAZ, yalnız onun metin çıktısını ayrıştırır.
 *
 * @param {string} cikisMetni  `tar -tzf` stdout
 * @param {string} setKimligi  beklenen set kimliği (örn. '11811')
 * @returns {string[]} köke göre göreli yol listesi (örn. ['manifest.json', 'dosya/assets2/x.png'])
 */
function tarListesiniAyristir(cikisMetni, setKimligi) {
  const setId = String(setKimligi || '').trim();
  if (!setId || !String(cikisMetni || '').trim()) return [];
  const kok = `set/${setId}/`;
  const sonuc = [];
  for (const ham of String(cikisMetni).split(/\r?\n/)) {
    const satir = ham.trim();
    if (!satir) continue;
    if (satir.endsWith('/')) continue; // dizin girdisi
    const yol = satir.replace(/^\.\//, ''); // bazı tar sürümleri './' öneki koyar
    if (!yol.startsWith(kok)) continue; // beklenen setin dışında — atla
    const goreli = yol.slice(kok.length);
    if (!goreli) continue;
    if (goreli.startsWith('/') || goreli.split('/').includes('..')) continue; // mutlak/`..` — RET
    sonuc.push(goreli);
  }
  return sonuc;
}

/**
 * PARDUS (Docker) BETİĞİNE GİDEN ORTAM (2026-09-26): G kanalının manifest doğrulama AÇIK anahtarı
 * (`EMPP_GUNCELLEME_ACIK_ANAHTAR`, SPKI DER base64 ed25519) pakete gömülsün diye betiğe — oradan
 * `-e` ile konteynere — geçer. Açık anahtar sır DEĞİLDİR. Geçerli bir ed25519 AÇIK anahtar değilse
 * (boş, bozuk, RSA, özel anahtar DER/PEM) DÜŞÜRÜLÜR: pakette G kapalı kalır, sebep döner.
 * Özel anahtar bu yoldan ASLA geçmez. Saf: yalnız `crypto` ile ayrıştırır.
 * @returns {{env: object, gAnahtari: string|null, sebep: string}}
 */
function pardusBetikEnv(env, job) {
  const cikti = { ...(env || {}) };
  const ham = typeof cikti.EMPP_GUNCELLEME_ACIK_ANAHTAR === 'string'
    ? cikti.EMPP_GUNCELLEME_ACIK_ANAHTAR.trim() : '';
  let sebep = '';
  if (!ham) sebep = 'yok';
  else if (/PRIVATE|BEGIN /i.test(ham)) sebep = 'ozel-anahtar-ya-da-pem';
  else {
    try {
      const k = require('crypto').createPublicKey({ key: Buffer.from(ham, 'base64'), format: 'der', type: 'spki' });
      if (k.asymmetricKeyType !== 'ed25519') sebep = 'ed25519-degil';
    } catch (e) { sebep = 'gecersiz'; }
  }
  if (sebep) delete cikti.EMPP_GUNCELLEME_ACIK_ANAHTAR;
  else cikti.EMPP_GUNCELLEME_ACIK_ANAHTAR = ham;
  const g = pardusGKimligi(job);
  // Kimlik YALNIZ claim'den gelir: ajan ortamından sızmış eski bir değer konteynere geçmez.
  for (const ad of Object.values(PARDUS_G_ENV)) delete cikti[ad];
  for (const [alan, ad] of Object.entries(PARDUS_G_ENV)) {
    if (g.kimlik[alan]) cikti[ad] = g.kimlik[alan];
  }
  return {
    env: cikti, gAnahtari: sebep ? null : ham, sebep, gKimlik: g.kimlik, gSebepler: g.sebepler,
  };
}

/**
 * Claim'in G alanlarının (`setKimligi`, `guncellemeTabani`, `surum`) konteynere giden ortam
 * değişkeni adları. `tools/pardus/pardus-packager-build.sh` bunları `-e` ile geçirir,
 * `tools/pardus/packager-run-linux.js` jobInfo'ya koyar (HTTP yolunda /api/package gövdesi).
 */
const PARDUS_G_ENV = Object.freeze({
  setKimligi: 'EMPP_G_SET_KIMLIGI',
  guncellemeTabani: 'EMPP_G_GUNCELLEME_TABANI',
  surum: 'EMPP_G_SURUM',
});
/** `src/packaging/set-kimligi.js` KIMLIK_DESENI ile AYNI (test çiviler). */
const G_SET_KIMLIGI_RE = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Claim'in G kimliğini doğrular (SAF). Geçersiz alan DÜŞÜRÜLÜR ve sebebi döner — paketleme
 * durmaz, yalnız o pakette G kanalı kurulmaz (packagingService taban/kimlik yoksa enjekte etmez).
 *  - setKimligi: set-kimligi deseni (URL yoluna girer).
 *  - guncellemeTabani: https (ya da yerel http), kullanıcı bilgisi YOK, `.invalid` yer tutucu DEĞİL.
 *  - surum: G3 (`2.<panel>.<sayaç>`) — istemcinin monoton tabanına girer.
 * @returns {{kimlik: {setKimligi:string|null, guncellemeTabani:string|null, surum:string|null},
 *            sebepler: string[]}}
 */
function pardusGKimligi(job) {
  const j = job || {};
  const kimlik = { setKimligi: null, guncellemeTabani: null, surum: null };
  const sebepler = [];
  const ham = (v) => (v == null ? '' : String(v).trim());

  const s = ham(j.setKimligi);
  if (!s) sebepler.push('set-kimligi-yok');
  else if (!G_SET_KIMLIGI_RE.test(s)) sebepler.push('set-kimligi-gecersiz');
  else kimlik.setKimligi = s;

  const t = ham(j.guncellemeTabani).replace(/\/+$/, '');
  if (!t) sebepler.push('taban-yok');
  else {
    let u = null;
    try { u = new URL(t); } catch (e) { u = null; }
    const guvenli = require('../runtime/kitap-guncelleyici').adresGuvenliMi(t);
    if (!u || !guvenli || /\s/.test(t)) sebepler.push('taban-gecersiz');
    else if (u.username || u.password) sebepler.push('taban-kimlik-bilgisi-tasiyor');
    else if (/\.invalid$/i.test(u.hostname)) sebepler.push('taban-yer-tutucu');
    else kimlik.guncellemeTabani = t;
  }

  const v = ham(j.surum);
  if (!v) sebepler.push('surum-yok');
  else if (!require('../runtime/kitap-guncelleyici').gSurumCoz(v)) sebepler.push('surum-gecersiz');
  else kimlik.surum = v;

  return { kimlik, sebepler };
}

/**
 * Claim'in G sürümü (`surum`, G3 `2.<panel>.<sayaç>`; 2026-09-26 madde 3). HTTP yolunda
 * paketleyiciye AYRI alan olarak gider (empp-set.json `surum` → istemcinin monoton tabanı);
 * appVersion'ı DEĞİŞTİRMEZ. Saf.
 * @returns {{surum: string|null, sebep: ''|'yok'|'g3-degil'}}
 */
function claimGSurumu(job) {
  const v = job && job.surum != null ? String(job.surum).trim() : '';
  if (!v) return { surum: null, sebep: 'yok' };
  if (!require('../runtime/kitap-guncelleyici').gSurumCoz(v)) return { surum: null, sebep: 'g3-degil' };
  return { surum: v, sebep: '' };
}

module.exports = {
  claimGSurumu,
  pardusBetikEnv,
  pardusGKimligi,
  PARDUS_G_ENV,
  pauseRequested,
  etkinYetenekler,
  pardusKabulErisimUygula,
  pardusYedekKabulDurumu,
  srcVersionTuret,
  agGecidiAyikla,
  dusukVeriAyristir,
  asciiAppName,
  pickLogoId,
  addFileToZipRoot,
  restartRequested,
  mapPlatform,
  backoffMs,
  parseNextJob,
  isTerminalStatus,
  packageStatusOf,
  artifactExtension,
  artifactContentType,
  joinUrl,
  clipPackagerError,
  packagerResultOf,
  isTransientNetworkError,
  yoklamaYenidenDenenir,
  PAKETLEYICI_YOKLAMA_HATA_TAVANI,
  agHatasiOzeti,
  pardusGerekliDiskGb,
  ertelenebilirKaynakHatasi,
  DISK_KAPISI_ISARETI,
  NOTER_KAPISI_ISARETI,
  noterIlkSatir,
  noterHatasiErtelenebilirMi,
  noterHatasi,
  probookErisilemezHatasi,
  pardusKabulSinifi,
  PROBOOK_KAPISI_ISARETI,
  BASLIKSIZ_KABUL_ISARETI,
  WIN_KASA_KABUL_ISARETI,
  guncellemeDosyalariniSirala,
  guncellemeIcerikTipi,
  tarListesiniAyristir,
};
