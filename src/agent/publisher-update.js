'use strict';
/**
 * Yayıncı çalışma-zamanı güncellemesini PAKETLEME ANINDA uygular (2026-08-27).
 *
 * Windows'ta uygulama açılışta `https://www.sorucoz.tv/uploads/akillitahta/{kurum}/Update/
 * version.html` → `{version}.zip` indirip build klasörünün üstüne açar (electron.js
 * checkForUpdates). macOS/Linux paketimizde build salt-okunur (asar) olduğundan bu
 * çalışmaz; ayrıca sunucu Cloudflare JS-challenge'lı (curl/Node 403) — güncelleme zip'i
 * tarayıcıyla alınıp `EMPP_UPDATE_DIR/{kurum}/{version}.zip` olarak konur; burada en yeni
 * uygun sürüm build'e uygulanır, `version.txt` güncellenir.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const DEFAULT_DIR = path.join(os.homedir(), '.empp-agent', 'updates');

/** "60" → "060" (electron.js getCompanyId ile aynı) */
function companyIdFrom(buildDir) {
  try {
    const id = fs.readFileSync(path.join(buildDir, 'kurum.txt'), 'utf8').replace(/\r|\n/g, '').trim();
    return id ? id.padStart(3, '0') : null;
  } catch (e) { return null; }
}

/** electron.js checkVersion ile aynı: 3 parça değilse "güncelle" (true); yoksa sayısal karşılaştırma */
function isNewer(current, incoming) {
  const c = String(current || '').trim().split('.'); const i = String(incoming || '').trim().split('.');
  if (c.length !== 3 || i.length !== 3) return c.join('.') !== i.join('.');
  for (let k = 0; k < 3; k++) { const cv = parseInt(c[k], 10), iv = parseInt(i[k], 10); if (cv < iv) return true; if (cv > iv) return false; }
  return false;
}
function cmpVersion(a, b) {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0), pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let k = 0; k < Math.max(pa.length, pb.length); k++) { const d = (pa[k] || 0) - (pb[k] || 0); if (d) return d; }
  return 0;
}

/** Yerel dizindeki en yeni güncelleme: { version, zipPath } | null */
function latestLocalUpdate(companyId, updateDir = process.env.EMPP_UPDATE_DIR || DEFAULT_DIR) {
  if (!companyId) return null;
  const dir = path.join(updateDir, companyId);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^\d+(\.\d+)*\.zip$/.test(f)); } catch (e) { return null; }
  if (!files.length) return null;
  const best = files.map((f) => f.replace(/\.zip$/, '')).sort(cmpVersion).pop();
  return { version: best, zipPath: path.join(dir, best + '.zip') };
}

function currentVersion(buildDir) {
  try { return fs.readFileSync(path.join(buildDir, 'version.txt'), 'utf8').trim(); } catch (e) { return '1'; }
}

/**
 * Uygular; dönüş: { applied: bool, from, to, companyId, reason }.
 * Zip build köküne (app.config.js'in olduğu yere) açılır — electron.js extractAllTo(dirname, true).
 */
function applyPublisherUpdate(buildDir, opts = {}) {
  const companyId = companyIdFrom(buildDir);
  const from = currentVersion(buildDir);
  const upd = latestLocalUpdate(companyId, opts.updateDir);
  if (!upd) return { applied: false, from, to: null, companyId, reason: companyId ? 'yerel güncelleme yok' : 'kurum.txt yok' };
  if (!isNewer(from, upd.version)) return { applied: false, from, to: upd.version, companyId, reason: 'zaten güncel' };
  const r = spawnSync('unzip', ['-o', '-q', upd.zipPath, '-d', buildDir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`güncelleme açılamadı (${upd.zipPath}): ${(r.stderr || '').slice(-300)}`);
  fs.writeFileSync(path.join(buildDir, 'version.txt'), upd.version);
  return { applied: true, from, to: upd.version, companyId, reason: 'uygulandı' };
}

module.exports = { applyPublisherUpdate, latestLocalUpdate, isNewer, companyIdFrom, currentVersion, DEFAULT_DIR };
