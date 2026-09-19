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
 *
 * Returns null for anything this Mac agent does not build (windows/web…) so the
 * caller can fail the job cleanly instead of asking the packager to do something
 * it was not dispatched for.
 *
 * @param {string} platform
 * @returns {('android'|'macos'|'pardus'|null)}
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
 * three fields the runner needs to act: bookId, platform, downloadUrl.
 *
 * @param {number} status   HTTP status code
 * @param {any} body        parsed JSON body (or undefined for 204)
 * @returns {({bookId:string, platform:string, downloadUrl:string, buildMethod?:string, bookTitle?:string})|null}
 */
function parseNextJob(status, body) {
  if (status === 204) return null;
  if (status !== 200 || !body || typeof body !== 'object') return null;

  const job = body.job && typeof body.job === 'object' ? body.job : body;
  if (!job || typeof job !== 'object') return null;

  const bookId = job.bookId != null ? String(job.bookId) : '';
  const platform = job.platform != null ? String(job.platform) : '';
  const downloadUrl = job.downloadUrl != null ? String(job.downloadUrl) : '';

  if (!bookId || !platform || !downloadUrl) return null;

  return {
    bookId,
    platform,
    downloadUrl,
    buildMethod: job.buildMethod != null ? String(job.buildMethod) : undefined,
    bookTitle: job.bookTitle != null ? String(job.bookTitle) : undefined,
    ...(job.publisherName != null ? { publisherName: String(job.publisherName) } : {}),
  };
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
  return izin ? caps.slice() : caps.filter((c) => !macMi(c));
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
 * Kaynak cache'i (~/.empp-agent/cache, `<bookId>/<version>/build.zip`) bir toplam
 * bayt tavanını aşınca hangi girdilerin silineceğine karar verir (saf — IO yok).
 * `pruneSiblingVersions` yalnız AYNI kitabın eski sürümünü siler; bu fonksiyon
 * TÜM kitaplar arasında en eski kullanılanı (LRU) seçer — cache 2026-09-13'te
 * 35 GB'a ulaşınca eklendi.
 *
 * En eski `sonKullanim`'dan başlayarak toplam bayt tavanın ALTINA inene kadar
 * silinecekleri sırayla döndürür. `korunan: true` işaretli girdiler (üzerinde
 * çalışılan iş) asla listeye girmez — tavanı aşmaya devam etse bile atlanır.
 * `girdiler` mutasyona UĞRAMAZ (kopya üzerinde sıralanır).
 *
 * @param {Array<{yol:string, bayt?:number, sonKullanim?:number, korunan?:boolean}>} girdiler
 * @param {number} tavanBayt
 * @returns {Array<{yol:string, bayt:number, sonKullanim:number, korunan?:boolean}>}
 *   silme sırasıyla
 */
function lruSilinecekler(girdiler, tavanBayt) {
  const liste = Array.isArray(girdiler) ? girdiler : [];
  const tavan = Number.isFinite(tavanBayt) ? tavanBayt : 0;

  // Normalize edilmiş kopya — girdi dizisini/nesnelerini mutasyona uğratma.
  const normal = liste.map((g) => ({
    yol: g && g.yol,
    bayt: Number.isFinite(g && g.bayt) ? g.bayt : 0,
    sonKullanim: Number.isFinite(g && g.sonKullanim) ? g.sonKullanim : 0,
    korunan: !!(g && g.korunan),
  }));

  let toplam = normal.reduce((acc, g) => acc + g.bayt, 0);
  if (toplam <= tavan) return [];

  // En eskiden en yeniye sırala (kararlı: eşit sonKullanim'da girdi sırası korunur).
  const sirali = normal
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (a.g.sonKullanim - b.g.sonKullanim) || (a.i - b.i))
    .map((x) => x.g);

  const silinecekler = [];
  for (const girdi of sirali) {
    if (toplam <= tavan) break;
    if (girdi.korunan) continue;
    silinecekler.push(girdi);
    toplam -= girdi.bayt;
  }
  return silinecekler;
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
  return /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|socket hang up|network|fetch failed|lease_not_held|complete-multipart failed: HTTP (5\d\d|0)|presign-multipart failed: HTTP 5|could not be uploaded|curl exit (6|7|28|35|52|55|56)\b/i.test(raw);
}

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
function ertelenebilirKaynakHatasi(err) {
  const raw = typeof err === 'string' ? err
    : (err && typeof err === 'object' && typeof err.message === 'string') ? err.message
      : '';
  return raw.includes(DISK_KAPISI_ISARETI);
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

module.exports = {
  pauseRequested,
  etkinYetenekler,
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
  lruSilinecekler,
  isTransientNetworkError,
  agHatasiOzeti,
  pardusGerekliDiskGb,
  ertelenebilirKaynakHatasi,
  DISK_KAPISI_ISARETI,
};
