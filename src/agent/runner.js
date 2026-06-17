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
} = require('./runner-helpers');

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
      {},
      { headers: agentHeaders(auth), timeout: 15000, validateStatus: () => true },
    );
  } catch (e) {
    warn('heartbeat failed:', e.message);
  }
}

async function postResultSuccess(auth, job, artifactPath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(artifactPath), path.basename(artifactPath));
  form.append('bookId', job.bookId);
  form.append('platform', job.platform);
  form.append('status', 'completed');
  form.append('buildMethod', 'build');
  const res = await axios.post(joinUrl(CONFIG.apiBase, `agents/${auth.agentId}/result`), form, {
    headers: { ...agentHeaders(auth), ...form.getHeaders() },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: CONFIG.packageTimeoutMs,
    validateStatus: () => true,
  });
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
async function downloadFile(url, destPath) {
  const res = await axios.get(url, { responseType: 'stream', timeout: CONFIG.packageTimeoutMs, validateStatus: () => true });
  if (res.status !== 200) throw new Error(`download failed: HTTP ${res.status} (${url})`);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    res.data.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.data.on('error', reject);
  });
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

async function packagerStartPackage(sessionId, packagerPlatform, appName, appVersion) {
  const res = await axios.post(
    joinUrl(CONFIG.packagerApi, 'api/package'),
    { sessionId, platforms: [packagerPlatform], appName, appVersion },
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

async function packagerDownload(jobId, packagerPlatform, destPath) {
  await downloadFile(joinUrl(CONFIG.packagerApi, `api/download/${jobId}/${packagerPlatform}`), destPath);
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

  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'empp-agent-'));
  try {
    // 1. download SFX exe.
    const exePath = path.join(work, 'source.exe');
    log('downloading source exe...');
    await downloadFile(job.downloadUrl, exePath);

    // 2. extract -> find resources/app/build.
    const extractDir = path.join(work, 'extracted');
    log('extracting SFX...');
    await extractSfx(exePath, extractDir);
    const buildDir = await findBuildDir(extractDir);
    log('build dir:', buildDir);

    // 3. zip + drive the LOCAL packager.
    const zipPath = path.join(work, 'build.zip');
    await zipDir(buildDir, zipPath);
    const appName = job.bookTitle || `book-${job.bookId}`;
    const appVersion = '1.0.0';
    log('uploading build to packager...');
    const sessionId = await packagerUploadBuild(zipPath, appName, appVersion);
    log('packager session:', sessionId, '- starting package...');
    const jobId = await packagerStartPackage(sessionId, packagerPlatform, appName, appVersion);
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
    log('job done:', job.bookId, job.platform);
  } finally {
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

module.exports = { CONFIG, processJob, extractSfx, findBuildDir, signAndNotarizeMac };
