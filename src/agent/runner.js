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
 *   2. download job.downloadUrl (Windows SFX exe) -> temp
 *   3. extract SFX (unrar, fallback 7z) -> find resources/app/build
 *   4. zip build dir -> POST {PACKAGER}/api/upload-build (sessionId)
 *      -> POST {PACKAGER}/api/package -> poll /api/package-status -> download artifact
 *   5. macos: codesign + notarytool (best-effort; skip with warning if env missing)
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
  pickLogoId, asciiAppName } = require('./runner-helpers');

// ---------------------------------------------------------------------------
// Config (env). No secrets hardcoded.
// ---------------------------------------------------------------------------
const CONFIG = {
  apiBase: (process.env.BOOKUPDATE_API || 'https://akillitahta.ndr.ist/api/v1').replace(/\/+$/, ''),
  enrollSecret: process.env.AGENT_ENROLL_SECRET || '',
  packagerApi: (process.env.PACKAGER_API || 'http://127.0.0.1:3001').replace(/\/+$/, ''),
  caps: (process.env.AGENT_CAPS || 'android,macos')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean),
  tokenFile: process.env.AGENT_TOKEN_FILE || path.join(os.homedir(), '.empp-agent', 'token.json'),
  agentName: process.env.AGENT_NAME || os.hostname(),
  pollMs: Number(process.env.AGENT_POLL_MS || 10000),
  heartbeatMs: Number(process.env.AGENT_HEARTBEAT_MS || 15000),
  packageTimeoutMs: Number(process.env.AGENT_PACKAGE_TIMEOUT_MS || 20 * 60 * 1000),
  // macOS signing (all optional — signing is best-effort).
  signIdentity: process.env.APPLE_SIGN_IDENTITY || '',
  teamId: process.env.APPLE_TEAM_ID || '',
  notaryProfile: process.env.APPLE_NOTARY_PROFILE || '', // notarytool keychain profile name
  appleId: process.env.APPLE_ID || '',
  applePassword: process.env.APPLE_PASSWORD || '',
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

async function fetchNextJob(auth) {
  const res = await axios.get(joinUrl(CONFIG.apiBase, `agents/${auth.agentId}/next-job`), {
    headers: agentHeaders(auth),
    timeout: 30000,
    validateStatus: () => true,
  });
  return parseNextJob(res.status, res.data);
}

async function heartbeat(auth) {
  try {
    await axios.post(
      joinUrl(CONFIG.apiBase, `agents/${auth.agentId}/heartbeat`),
      { heldJobs: currentJob ? [currentJob] : [] },
      { headers: agentHeaders(auth), timeout: 15000, validateStatus: () => true },
    );
  } catch (e) {
    warn('heartbeat failed:', e.message);
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
const { applyPublisherUpdate, latestLocalUpdate, isNewer } = require('./publisher-update');
/**
 * Önbellekteki build.zip'in yayıncı güncellemesi eskimiş mi? (kurum.txt + version.txt zip'ten
 * okunur; daha yeni yerel güncelleme varsa cache MISS sayılır → yeniden çıkarılıp uygulanır.)
 */
function cachedZipIsStale(zipPath) {
  try {
    const { spawnSync } = require('child_process');
    const read = (f) => { const r = spawnSync('unzip', ['-p', zipPath, f], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; };
    const kurum = read('kurum.txt').replace(/\r|\n/g, '');
    const version = read('version.txt') || '1';
    const upd = latestLocalUpdate(kurum ? kurum.padStart(3, '0') : null);
    const stale = !!upd && isNewer(version, upd.version);
    if (stale) log(`source cache STALE — yayıncı güncellemesi ${version} → ${upd.version}`);
    return stale;
  } catch (e) { return false; }
}


/** Ağ/geçici hata mı? (kesinti, DNS, 5xx, R2 complete/presign) — kalıcı hata değil, yeniden denenir. */
function isTransientNetworkError(err) {
  const m = String((err && err.message) || err || '');
  return /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|socket hang up|network|complete-multipart failed: HTTP (5\d\d|0)|presign-multipart failed: HTTP 5|could not be uploaded|curl exit (6|7|28|35|52|55|56)\b/i.test(m);
}

const MULTIPART_THRESHOLD = Number(process.env.AGENT_MULTIPART_THRESHOLD || 300 * 1024 * 1024);
const MULTIPART_PART_SIZE = Number(process.env.AGENT_MULTIPART_PART_SIZE || 64 * 1024 * 1024);

async function uploadMultipart(auth, job, artifactPath, size) {
  const partSize = MULTIPART_PART_SIZE;
  const partCount = Math.ceil(size / partSize);
  const start = await axios.post(
    joinUrl(CONFIG.apiBase, `agents/${auth.agentId}/result/presign-multipart`),
    { bookId: job.bookId, platform: job.platform, partCount },
    { headers: { ...agentHeaders(auth), 'Content-Type': 'application/json' }, timeout: 120000, validateStatus: () => true },
  );
  if (start.status === 404) return null;             // eski sunucu → tek parça yola düş
  if (start.status !== 200 || !start.data?.uploadId) {
    throw new Error(`presign-multipart failed: HTTP ${start.status} ${JSON.stringify(start.data)}`);
  }
  const { uploadId, r2ObjectKey, contentType, urls } = start.data;
  log(`uploading artifact to R2 (multipart: ${partCount}×${(partSize / 1e6).toFixed(0)}MB)`, r2ObjectKey, `${(size / 1e9).toFixed(2)}GB`);

  const rate = process.env.AGENT_UPLOAD_RATE ?? '4M';
  const partFile = `${artifactPath}.part`;
  const parts = [];
  try {
    for (const { partNumber, url } of urls) {
      const offsetMB = ((partNumber - 1) * partSize) / (1024 * 1024);
      const countMB = Math.ceil(Math.min(partSize, size - (partNumber - 1) * partSize) / (1024 * 1024));
      let etag = null;
      // Kesinti dayanıklılığı (2026-08-27): ev/yavaş hat ve gece koşusu — parça başına 30 deneme,
      // başarısızlıkta 30 sn bekle (~15 dk ağ kesintisini yerinde bekler; presigned URL'ler 1 saat).
      const PART_ATTEMPTS = Number(process.env.AGENT_UPLOAD_PART_ATTEMPTS || 30);
      for (let attempt = 1; attempt <= PART_ATTEMPTS && !etag; attempt++) {
        if (stopping) throw new Error('shutting down');
        if (attempt > 1) await sleep(30000);
        await run('dd', [`if=${artifactPath}`, `of=${partFile}`, 'bs=1M', `skip=${offsetMB}`, `count=${countMB}`, 'status=none']);
        const res = await run('curl', [
          '-sS', '-4', '--fail', '-X', 'PUT', '-D', '-', '-o', '/dev/null',
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
          await sleep(backoffMs(attempt, 3000, 30000));
        }
      }
      if (!etag) throw new Error(`part ${partNumber} could not be uploaded`);
      parts.push({ partNumber, etag });
      if (partNumber % 5 === 0 || partNumber === partCount) log(`  parça ${partNumber}/${partCount} yüklendi`);
    }
  } finally {
    await fsp.rm(partFile, { force: true }).catch(() => {});
  }

  // complete-multipart: R2/Cloudflare 5xx geçici olabiliyor (2026-08-27: 40 dk'lık noterli build
  // HTTP 502 ile kaybedildi). Parçalar zaten yüklü — yalnız bu çağrı 3 kez denenir.
  let done = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    done = await axios.post(
      joinUrl(CONFIG.apiBase, `agents/${auth.agentId}/result/complete-multipart`),
      { bookId: job.bookId, platform: job.platform, uploadId, r2ObjectKey, parts },
      { headers: { ...agentHeaders(auth), 'Content-Type': 'application/json' }, timeout: 120000, validateStatus: () => true },
    ).catch((err) => ({ status: 0, data: { error: err.message } }));
    if (done.status === 200) break;
    if (done.status >= 500 || done.status === 0) {
      warn(`complete-multipart HTTP ${done.status} (deneme ${attempt}/3) — ${attempt < 3 ? '15 sn sonra tekrar' : 'vazgeçildi'}`);
      if (attempt < 3) await sleep(15000);
      continue;
    }
    break; // 4xx: tekrar anlamsız
  }
  if (!done || done.status !== 200) throw new Error(`complete-multipart failed: HTTP ${done && done.status} ${JSON.stringify(done && done.data)}`);
  log('artifact uploaded to R2 (multipart) — reporting result...');
  return { r2ObjectKey, publicUrl: done.data.publicUrl };
}

async function postResultSuccess(auth, job, artifactPath) {
  // Presigned R2 PUT: upload the (possibly multi-GB) artifact STRAIGHT to R2,
  // bypassing the Cloudflare edge body-size limit (~100MB) that 413s large APKs.
  // The server then settles the job from the JSON /result body (Decision A path).
  const size = fs.statSync(artifactPath).size;
  // Upload via curl, NOT axios: S21's gateway RESETS large sustained HTTPS transfers
  // (a 3.15GB axios PUT died with ECONNRESET ~2 min in — the same shaper that resets
  // big downloads, now outbound). A steady --limit-rate slips under it; on a reset we
  // re-presign (1h expiry, but stay safe) and retry the whole PUT. curl --upload-file
  // sets Content-Length (R2 rejects chunked) and PUTs; the SIGNED Content-Type header
  // must be sent verbatim. Empty AGENT_UPLOAD_RATE disables the throttle.
  // Büyük artifact → çok parçalı (reset dayanıklı). Sunucu desteklemiyorsa null döner.
  let presigned = null;
  if (size >= MULTIPART_THRESHOLD) {
    presigned = await uploadMultipart(auth, job, artifactPath, size);
  }

  const rate = process.env.AGENT_UPLOAD_RATE ?? '4M';
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
    },
    { headers: { ...agentHeaders(auth), 'Content-Type': 'application/json' }, timeout: 60000, validateStatus: () => true },
  );
  if (res.status !== 200) {
    throw new Error(`result(completed) rejected: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
}

async function postResultFailure(auth, job, errorMessage) {
  try {
    await axios.post(
      joinUrl(CONFIG.apiBase, `agents/${auth.agentId}/result`),
      {
        bookId: job.bookId,
        platform: job.platform,
        status: 'failed',
        error: String(errorMessage).slice(0, 2000),
      },
      { headers: { ...agentHeaders(auth), 'Content-Type': 'application/json' }, timeout: 30000, validateStatus: () => true },
    );
  } catch (e) {
    errlog('could not report failure for', job.bookId, job.platform, '-', e.message);
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
    // Steady throttled pass. NO --speed-time (it tripped a bad -C - resume that this
    // server mis-answers → appended → oversized). --retry handles a genuine reset.
    // NO -C - : resume on this server appends the FULL file after a reset (origin
    // mis-answers the Range) → oversized/corrupt. Each attempt is a FRESH download;
    // the throttle prevents most resets, and an invalid result is caught + retried.
    const res = await run('curl', [
      '-sS', '-4', '-L', '--fail',
      '--retry', '300', '--retry-delay', '3', '--retry-all-errors',
      '--retry-max-time', String(retryMax),
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
  } catch (e) { warn('logo listesi alinamadi:', e.message); return null; }
}

async function packagerStartPackage(sessionId, packagerPlatform, appName, appVersion, logoId) {
  const res = await axios.post(
    joinUrl(CONFIG.packagerApi, 'api/package'),
    { sessionId, platforms: [packagerPlatform], appName, appVersion, ...(logoId ? { logoId } : {}) },
    { timeout: 60000, validateStatus: () => true },
  );
  if (res.status !== 200 || !res.data || !res.data.jobId) {
    throw new Error(`packager package failed: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data.jobId;
}

async function packagerPoll(jobId) {
  const deadline = Date.now() + CONFIG.packageTimeoutMs;
  while (Date.now() < deadline) {
    if (stopping) throw new Error('shutting down');
    const res = await axios.get(joinUrl(CONFIG.packagerApi, `api/package-status/${jobId}`), {
      timeout: 30000,
      validateStatus: () => true,
    });
    if (res.status === 200) {
      const status = packageStatusOf(res.data);
      if (isTerminalStatus(status)) {
        if (status === 'failed') {
          const msg = (res.data && res.data.job && res.data.job.error) || 'packager reported failed';
          throw new Error(`packager job failed: ${msg}`);
        }
        return; // completed
      }
    }
    await sleep(5000);
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

async function packagerDownload(jobId, packagerPlatform, destPath) {
  await downloadArtifact(joinUrl(CONFIG.packagerApi, `api/download/${jobId}/${packagerPlatform}`), destPath);
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
    warn('packager delete-job hatası (iş yine de başarılı):', e.message);
    return false;
  }
}

/**
 * Cache girdisinin mtime'ını şimdiye çeker — TTL temizleyicisi için
 * "gerçekten kullanıldı" işareti. atime bu iş için güvenilmez: `du`,
 * yedekleme, virüs taraması gibi her okuma onu tazeler.
 * Hata yutulur; işaret koyamamak üretimi durdurmaz.
 */
async function touchCacheEntry(dir) {
  try {
    const now = new Date();
    await fsp.utimes(dir, now, now);
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// macOS signing (best-effort).
// ---------------------------------------------------------------------------
async function signAndNotarizeMac(dmgPath) {
  if (!CONFIG.signIdentity) {
    warn('APPLE_SIGN_IDENTITY not set — skipping codesign/notarize (dmg shipped unsigned)');
    return;
  }
  // codesign the .dmg.
  log('codesign:', dmgPath);
  const signArgs = ['--force', '--sign', CONFIG.signIdentity, '--timestamp'];
  if (CONFIG.teamId) signArgs.push('--options', 'runtime');
  signArgs.push(dmgPath);
  const sign = await run('codesign', signArgs);
  if (sign.code !== 0) {
    warn('codesign failed (continuing unsigned):', sign.stderr.slice(-300));
    return;
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
    warn('no notarytool credentials (APPLE_NOTARY_PROFILE or APPLE_ID+APPLE_PASSWORD+APPLE_TEAM_ID) — skipping notarization');
    return;
  }
  log('notarytool submit:', dmgPath);
  const notar = await run('xcrun', notaryArgs);
  if (notar.code !== 0) {
    warn('notarytool failed (continuing without staple):', notar.stderr.slice(-300));
    return;
  }
  const staple = await run('xcrun', ['stapler', 'staple', dmgPath]);
  if (staple.code !== 0) warn('stapler failed:', staple.stderr.slice(-300));
  else log('notarized + stapled:', dmgPath);
}

// ---------------------------------------------------------------------------
// One job, end to end.
// ---------------------------------------------------------------------------
async function processJob(auth, job) {
  const packagerPlatform = mapPlatform(job.platform);
  if (!packagerPlatform) {
    throw new Error(`unsupported platform for this agent: ${job.platform}`);
  }
  log('job:', job.bookId, job.platform, '->', packagerPlatform);
  // Mark in-flight so the heartbeat keeps this job's lease alive during a long build.
  currentJob = { bookId: job.bookId, platform: job.platform };

  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'empp-agent-'));
  try {
    // 1-3. Source cache: the extracted web `build.zip` is produced ONCE per
    //      (book, source-version) and REUSED across platforms + retries — the
    //      SAME web build feeds apk / impark / dmg. This avoids re-downloading
    //      the multi-GB Windows SFX on every job (the slow link is paid once).
    const cacheRoot = process.env.EMPP_SOURCE_CACHE || '/var/empp-cache';
    const srcVersion = (job.downloadUrl.split(/[/?#]/).filter(Boolean).pop() || 'src')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    const cachedZip = path.join(cacheRoot, String(job.bookId), srcVersion, 'build.zip');
    const zipPath = path.join(work, 'build.zip');

    let cacheHit = false;
    try {
      await fsp.access(cachedZip);
      if (cachedZipIsStale(cachedZip)) throw new Error('cache stale (publisher update)');
      await fsp.copyFile(cachedZip, zipPath);
      const mb = ((await fsp.stat(zipPath)).size / 1e6).toFixed(0);
      log(`source cache HIT (${mb}MB) — skip download:`, cachedZip);
      cacheHit = true;
      // Kullanım işaretini mtime'a yaz: TTL temizleyicisi buna bakar.
      // atime kullanılamaz — herhangi bir `du`/yedekleme taraması onu tazeler
      // ve ölü cache sonsuza kadar taze görünür (2026-08-18 tespiti).
      await touchCacheEntry(path.dirname(cachedZip));
    } catch (_) {
      /* cache miss — fall through to download */
    }

    if (!cacheHit) {
      const exePath = path.join(work, 'source.exe');
      log('source cache MISS — downloading source exe...');
      await downloadFile(job.downloadUrl, exePath);

      const extractDir = path.join(work, 'extracted');
      log('extracting SFX...');
      await extractSfx(exePath, extractDir);
      const buildDir = await findBuildDir(extractDir);
      log('build dir:', buildDir);

      // Yayıncı güncellemesi (version.html/zip) paketleme anında uygulanır — macOS'ta
      // çalışma zamanında uygulanamaz (asar salt-okunur), bkz. publisher-update.js.
      try {
        const upd = applyPublisherUpdate(buildDir);
        log(`publisher update: ${upd.reason} (${upd.from} → ${upd.to || '-'}, kurum ${upd.companyId || '?'})`);
      } catch (e) { warn('publisher update uygulanamadı:', e.message); }
      await zipDir(buildDir, zipPath);

      // Populate the shared cache atomically (tmp + rename). Non-fatal on error.
      try {
        await fsp.mkdir(path.dirname(cachedZip), { recursive: true });
        const tmp = `${cachedZip}.tmp-${process.pid}`;
        await fsp.copyFile(zipPath, tmp);
        await fsp.rename(tmp, cachedZip);
        await touchCacheEntry(path.dirname(cachedZip));
        log('source cached for reuse:', cachedZip);
      } catch (e) {
        warn('source cache populate failed (non-fatal):', e.message);
      }
    }
    const appName = asciiAppName(job.bookTitle, `book-${job.bookId}`); // paketleyici iç adı ASCII (45496 dersi)
    const appVersion = '1.0.0';
    log('uploading build to packager...');
    const sessionId = await packagerUploadBuild(zipPath, appName, appVersion);
    log('packager session:', sessionId, '- starting package...');
    const logoId = await packagerLogoIdFor(job.publisherName);
    const jobId = await packagerStartPackage(sessionId, packagerPlatform, appName, appVersion, logoId);
    log('packager jobId:', jobId, '- polling...');
    await packagerPoll(jobId);

    const artifactPath = path.join(work, `artifact${artifactExtension(packagerPlatform)}`);
    log('downloading artifact...');
    await packagerDownload(jobId, packagerPlatform, artifactPath);

    // 4. macOS: sign + notarize (best-effort).
    if (packagerPlatform === 'macos') {
      await signAndNotarizeMac(artifactPath);
    }

    // 5. POST artifact FILE back (server uploads to R2).
    log('posting result (completed) with artifact file...');
    await postResultSuccess(auth, job, artifactPath);

    // Artifact R2'ye gitti — packager'ın yerel kopyasını tutmanın anlamı yok.
    // Bu adım eksikti: her üretim packager'ın output/ dizininde 1-3 GB bırakıyor,
    // hiç silinmiyordu. 2026-08-18'de 119 paket / 118 GB birikmişti.
    // Gerekirse paket R2'den indirilir.
    await packagerReleaseJob(jobId);

    log('job done:', job.bookId, job.platform);
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

  // Heartbeat loop (fire-and-forget; never throws into the main loop).
  const hbTimer = setInterval(() => {
    if (!stopping) heartbeat(auth);
  }, CONFIG.heartbeatMs);
  hbTimer.unref?.();

  let netErrAttempt = 0;
  while (!stopping) {
    let job = null;
    try {
      job = await fetchNextJob(auth);
      netErrAttempt = 0; // a successful poll resets backoff
    } catch (e) {
      const delay = backoffMs(netErrAttempt++, 1000, 30000);
      warn('next-job poll error, backing off', delay, 'ms:', e.message);
      await sleep(delay);
      continue;
    }

    if (!job) {
      await sleep(CONFIG.pollMs);
      continue;
    }

    // A bad job must never kill the loop.
    try {
      await processJob(auth, job);
    } catch (e) {
      if (isTransientNetworkError(e)) {
        // Ağ/geçici hata: 'failed' YAZMA — lease süresi dolunca API satırı yeniden kuyruğa alır,
        // ajan önbellekten yeniden paketleyip yüklemeyi dener (internet gelince kendiliğinden biter).
        warn('job geçici hata (failed yazılmadı, lease dolunca yeniden denenecek):', job.bookId, job.platform, '-', e.message);
        await sleep(120000);
        continue;
      }
      errlog('job failed:', job.bookId, job.platform, '-', e.message);
      await postResultFailure(auth, job, e.message);
    }
  }

  clearInterval(hbTimer);
  log('stopped.');
}

// Graceful shutdown.
function installSignalHandlers() {
  const onSignal = (sig) => {
    log(`received ${sig}, finishing current work then exiting...`);
    stopping = true;
    // Give in-flight work a brief window; hard-exit fallback.
    setTimeout(() => process.exit(0), 2000).unref?.();
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
}

if (require.main === module) {
  installSignalHandlers();
  main().catch((e) => {
    errlog('fatal:', e && e.message ? e.message : e);
    process.exit(1);
  });
}

module.exports = {
  looksLikeRealApk, isValidArchiveOutput, CONFIG, processJob, extractSfx, findBuildDir, signAndNotarizeMac,
  packagerReleaseJob,
  touchCacheEntry
};
