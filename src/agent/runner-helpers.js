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

module.exports = {
  asciiAppName,
  pickLogoId,
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
};
