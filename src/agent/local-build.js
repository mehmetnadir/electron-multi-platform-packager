#!/usr/bin/env node
'use strict';
/**
 * Yerel Mac derlemesi — R2'ye YÜKLEMEDEN (2026-08-27, kullanıcı evde/yavaş bağlantı).
 * Ajanın adımlarını aynen izler: SFX exe → unrar → resources/app/build → build.zip →
 * packager upload-build → package (macos, logoId) → indir → codesign → notarize → staple.
 * Sonuç dmg verilen çıktı dizinine kopyalanır; build.zip ajan önbelleğine de yazılır ki
 * sonraki gerçek işte tekrar indirilmesin.
 *
 *   node src/agent/local-build.js --exe <yol> --title "Marvel Grade 11" --publisher "YDS Publishing" --out ~/Desktop
 *
 * Ortam: PACKAGER_API (default http://127.0.0.1:3001), APPLE_SIGN_IDENTITY, APPLE_NOTARY_PROFILE,
 * EMPP_SOURCE_CACHE (default ~/.empp-agent/cache), BOOK_ID (önbellek klasörü için).
 */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const archiver = require('archiver');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const EXE = args.exe; const TITLE = args.title || 'book'; const PUBLISHER = args.publisher || ''; const OUT = args.out || process.cwd();
const BOOK_ID = args.bookId || process.env.BOOK_ID || '0';
const PACKAGER = (process.env.PACKAGER_API || 'http://127.0.0.1:3001').replace(/\/+$/, '');
if (!EXE || !fs.existsSync(EXE)) { console.error('kullanım: --exe <sfx.exe> --title <ad> [--publisher <yayınevi>] [--out <dizin>] [--bookId <id>]'); process.exit(2); }
const log = (...a) => console.log(new Date().toISOString(), '[local-build]', ...a);
const run = (cmd, argv) => new Promise((resolve) => { const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d)); p.on('close', (code) => resolve({ code, out, err })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBuildDir(root) {
  const direct = path.join(root, 'resources', 'app', 'build');
  if (fs.existsSync(path.join(direct, 'index.html'))) return direct;
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(d, e.name);
      if (e.name === 'build' && fs.existsSync(path.join(p, 'index.html')) && p.includes(path.join('resources', 'app'))) return p;
      stack.push(p);
    }
  }
  throw new Error('resources/app/build bulunamadı');
}
function zipDir(src, out) {
  return new Promise((resolve, reject) => {
    const o = fs.createWriteStream(out); const a = archiver('zip', { zlib: { level: 6 } });
    o.on('close', resolve); a.on('error', reject); a.pipe(o); a.directory(src, false); a.finalize();
  });
}
function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

(async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'empp-local-'));
  const cacheRoot = process.env.EMPP_SOURCE_CACHE || path.join(os.homedir(), '.empp-agent', 'cache');
  const cachedZip = path.join(cacheRoot, BOOK_ID, path.basename(EXE), 'build.zip');
  const zipPath = path.join(work, 'build.zip');
  if (fs.existsSync(cachedZip)) { log('önbellek HIT:', cachedZip); await fsp.copyFile(cachedZip, zipPath); }
  else {
    const ex = path.join(work, 'extracted'); await fsp.mkdir(ex, { recursive: true });
    log('unrar ile açılıyor...'); const r = await run('unrar', ['x', '-y', '-o+', EXE, ex + '/']);
    if (r.code !== 0) throw new Error('unrar başarısız: ' + r.err.slice(-300));
    const buildDir = findBuildDir(ex); log('build dizini:', buildDir);
    log('build.zip yazılıyor...'); await zipDir(buildDir, zipPath);
    await fsp.mkdir(path.dirname(cachedZip), { recursive: true }); await fsp.copyFile(zipPath, cachedZip); log('önbelleğe yazıldı:', cachedZip);
  }
  log('packager upload-build...');
  const form = new FormData(); form.append('files', fs.createReadStream(zipPath), 'build.zip'); form.append('appName', TITLE); form.append('appVersion', '1.0.0');
  const up = await axios.post(`${PACKAGER}/api/upload-build`, form, { headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 3600000, validateStatus: () => true });
  if (up.status !== 200 || !up.data?.sessionId) throw new Error('upload-build: HTTP ' + up.status + ' ' + JSON.stringify(up.data));
  let logoId = null;
  try { const logos = await axios.get(`${PACKAGER}/api/logos`, { timeout: 15000 }); const want = normName(PUBLISHER); const list = Array.isArray(logos.data) ? logos.data : (logos.data?.logos || []); const hit = list.find((l) => normName(l.kurumAdi) === want) || list.find((l) => want && (normName(l.kurumAdi).includes(want) || want.includes(normName(l.kurumAdi)))); logoId = hit ? hit.id : null; } catch (e) { /* logo yok */ }
  log('logoId:', logoId);
  const pk = await axios.post(`${PACKAGER}/api/package`, { sessionId: up.data.sessionId, platforms: ['macos'], appName: TITLE, appVersion: '1.0.0', ...(logoId ? { logoId } : {}) }, { timeout: 60000, validateStatus: () => true });
  if (pk.status !== 200 || !pk.data?.jobId) throw new Error('package: HTTP ' + pk.status + ' ' + JSON.stringify(pk.data));
  const jobId = pk.data.jobId; log('packager jobId:', jobId);
  for (;;) {
    await sleep(10000);
    const st = await axios.get(`${PACKAGER}/api/package-status/${jobId}`, { timeout: 30000, validateStatus: () => true });
    const status = st.data?.job?.status || st.data?.status;
    if (status === 'completed') break;
    if (status === 'failed') throw new Error('packager failed: ' + (st.data?.job?.error || ''));
  }
  const dmg = path.join(work, 'artifact.dmg');
  log('dmg indiriliyor (yerel packager)...');
  const dl = await run('curl', ['-sfL', '-o', dmg, `${PACKAGER}/api/download/${jobId}/macos`]);
  if (dl.code !== 0) throw new Error('download: curl exit ' + dl.code);
  const ident = (process.env.APPLE_SIGN_IDENTITY || '').replace(/^Developer ID Application:\s*/i, '');
  if (ident) {
    log('codesign dmg...'); const cs = await run('codesign', ['--force', '--sign', ident, '--timestamp', '--options', 'runtime', dmg]); if (cs.code !== 0) log('codesign uyarı:', cs.err.slice(-200));
    if (process.env.APPLE_NOTARY_PROFILE) {
      log('notarytool submit --wait ...'); const nt = await run('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', process.env.APPLE_NOTARY_PROFILE, '--wait']);
      if (nt.code !== 0) log('notarize başarısız:', (nt.out + nt.err).slice(-400)); else { const sp = await run('xcrun', ['stapler', 'staple', dmg]); log(sp.code === 0 ? 'notarized + stapled' : 'staple başarısız: ' + sp.err.slice(-200)); }
    }
  }
  await fsp.mkdir(OUT, { recursive: true });
  const finalName = `${TITLE}${PUBLISHER ? ' - ' + PUBLISHER : ''}.dmg`.replace(/[\/:]/g, ' ');
  const finalPath = path.join(OUT, finalName);
  await fsp.copyFile(dmg, finalPath);
  try { await axios.delete(`${PACKAGER}/api/delete-job/${jobId}`, { timeout: 60000, validateStatus: () => true }); } catch (e) { /* yok */ }
  await fsp.rm(work, { recursive: true, force: true });
  log('HAZIR:', finalPath);
})().catch((e) => { console.error('[local-build] HATA:', e.message); process.exit(1); });
