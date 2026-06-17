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
 * Map a book-update job platform to the LOCAL packager's platform string.
 *
 *   android -> 'android'  (APK)
 *   macos   -> 'macos'    (.dmg)
 *   mac     -> 'macos'    (book-update's platform ENUM uses 'mac'; accept both)
 *
 * Returns null for anything this Mac agent does not build (windows/linux/pardus/web…)
 * so the caller can fail the job cleanly instead of asking the packager to do
 * something it was not dispatched for.
 *
 * @param {string} platform
 * @returns {('android'|'macos'|null)}
 */
function mapPlatform(platform) {
  switch (String(platform || '').trim().toLowerCase()) {
    case 'android':
      return 'android';
    case 'macos':
    case 'mac':
      return 'macos';
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
  };
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
 * @param {('android'|'macos'|string)} packagerPlatform
 */
function artifactExtension(packagerPlatform) {
  switch (String(packagerPlatform || '').trim().toLowerCase()) {
    case 'android':
      return '.apk';
    case 'macos':
      return '.dmg';
    default:
      return '';
  }
}

/** Join a base URL and a path safely (single slash). */
function joinUrl(base, p) {
  return `${String(base).replace(/\/+$/, '')}/${String(p).replace(/^\/+/, '')}`;
}

module.exports = {
  mapPlatform,
  backoffMs,
  parseNextJob,
  isTerminalStatus,
  packageStatusOf,
  artifactExtension,
  joinUrl,
};
