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
const { yazilacakSurum, acikMi } = require('./surum-normallestir');
// TEK KAYNAK: sürüm kıyası burada YENİDEN YAZILMAZ (bkz. isNewer/cmpVersion).
const { dahaYeniMi, parcalara } = require('./surum-kiyas');

const DEFAULT_DIR = path.join(os.homedir(), '.empp-agent', 'updates');

/** "60" → "060" (electron.js getCompanyId ile aynı) */
function companyIdFrom(buildDir) {
  try {
    const id = fs.readFileSync(path.join(buildDir, 'kurum.txt'), 'utf8').replace(/\r|\n/g, '').trim();
    return id ? id.padStart(3, '0') : null;
  } catch (e) { return null; }
}

/**
 * "Bu aday elimizdekinden daha yeni mi?" — KARAR. Gövdesi `surum-kiyas.js`'te.
 *
 * 2026-09-21 — KARDEŞ UÇ ONARIMI. Burada eskiden yayıncının electron.js
 * `checkVersion()` davranışının birebir kopyası vardı: "iki taraf da 3 parça
 * DEĞİLSE string farkı = yeni". Aynı gün eklenen `version.txt` normalleştirmesi
 * (commit 07f1d39, 350 MB müşteri indirmesinin kökü) build'in version.txt'sini
 * 3 parçaya indirince, zip adı 4 parçalı kaldığı için kıyas HER KOŞUDA string'e
 * düşüyor ve "yeni" diyordu. ÖLÇÜLDÜ (fixture: build 1.11.5, zip 1.13.1.3):
 * 1., 2. ve 3. `applyPublisherUpdate` çağrısının ÜÇÜ de "uygulandı" döndü —
 * yani aynı ~350 MB zip her paketleme işinde yeniden açılıyordu. Kardeşi
 * `runner.js:cachedZipIsStale` aynı sebeple her işte ~1 GB kaynak indiriyordu.
 *
 * `dahaYeniMi` normalleştirilmiş hâlini aynı sürüm sayar ("1.13.1" ≡ "1.13.1.3")
 * ve belirsiz girdide asla "yeni" demez. Ayrışma ölçüldü: yedi kıyas çiftinin
 * YALNIZ birinde ("1.13.1" ↔ "1.13.1.3") karar değişti; kalan altısı birebir
 * aynı kaldı — bu dar bir düzeltme, davranış yeniden yazımı değil.
 *
 * Ad geriye dönük uyum için korundu (dışa açık; test ve eski çağıranlar kullanır).
 */
function isNewer(current, incoming) {
  return dahaYeniMi(current, incoming);
}

/**
 * HAM ZİP DOSYA ADI sıralaması (`latestLocalUpdate` içindir) — KARAR değil.
 *
 * Ayrıştırma kuralları `surum-kiyas.parcalara`'dan gelir (tek kaynak); ama
 * kanoniklestirme (3 parçaya kırpma) BİLEREK yapılmaz: buradaki iki taraf da
 * diskteki gerçek dosya adıdır, "1.13.1.3.zip" ile "1.13.1.5.zip" AYRI iki
 * dosyadır ve 4. parça GERÇEK bilgidir. Kanonik kıyas ikisini eşit sayar,
 * "en yeni zip" seçimi `readdir` sırasına kalırdı (belirsiz seçim).
 * `dahaYeniMi` ise bir tarafı normalleştirilmiş `version.txt` olan KARAR için
 * kullanılır; orada 4. parça zaten kaybolmuştur.
 */
function cmpVersion(a, b) {
  const pa = parcalara(a) || [];
  const pb = parcalara(b) || [];
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
  // 2026-09-21 bug-fix: yayıncının electron.js'i version.txt 3 parça değilse
  // koşulsuz "eski" sayıp 350MB güncellemeyi tekrar tekrar indiriyordu (kök neden:
  // zip adı ham yazılıyordu, örn "1.13.1.3"). Normalize et; edilemiyorsa mevcut
  // (unzip'ten ÖNCEKİ) değeri geri yaz — zip'in kendi içinde bozuk bir version.txt
  // varsa unzip onu build köküne zaten açmış olabilir, "dokunma" fail-safe'i bunu
  // da kapsamalı (from = unzip'ten önce okunmuş, güvenilir değer).
  if (acikMi()) {
    const { deger } = yazilacakSurum(upd.version, from);
    fs.writeFileSync(path.join(buildDir, 'version.txt'), deger !== null ? deger : from);
  } else {
    fs.writeFileSync(path.join(buildDir, 'version.txt'), upd.version);
  }
  return { applied: true, from, to: upd.version, companyId, reason: 'uygulandı' };
}

module.exports = { applyPublisherUpdate, latestLocalUpdate, isNewer, companyIdFrom, currentVersion, DEFAULT_DIR };
