'use strict';
/**
 * EMPP çalışma dizini aynası (2026-08-27).
 *
 * Yayıncı web uygulaması anahtar/temp dosyalarını (imKeys.dll, kaldığı yer vb.) `fs` ile
 * "exe'nin yanındaki resources/app/build" altına yazar; `remote` modülü Electron 14+'ta
 * olmadığı için o yol boş kalır ve yollar CWD'ye GÖRELİ çözülür. Windows'ta CWD = kurulum
 * dizini olduğu için çalışıyordu; macOS'ta CWD "/" ve .app imzalı/salt-okunur → hiçbir
 * şey kaydedilmiyordu (anahtar her açılışta tekrar soruluyordu).
 *
 * Çözüm: userData altında build'in yazılabilir bir aynasını kur (gerçek dizinler + dosya
 * symlink'leri) ve process.chdir(ayna). Uygulama okuduğunu symlink'ten okur, yazdığı
 * dosya aynada kalır; .app'e dokunulmaz (imza bozulmaz). Sürüm değişince ayna yenilenir.
 */
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['node_modules', 'temp', 'uploads', '.DS_Store']);

/** Bir dizini derinlik sınırıyla aynala: `depth`>0 iken alt dizinler gerçek, dosyalar symlink. */
function mirrorDir(src, dst, depth) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (SKIP.has(name)) continue;
    const s = path.join(src, name);
    const d = path.join(dst, name);
    let st;
    try { st = fs.lstatSync(s); } catch { continue; }
    if (fs.existsSync(d) || isSymlink(d)) continue;
    if (st.isDirectory() && depth > 0) mirrorDir(s, d, depth - 1);
    else fs.symlinkSync(s, d);
  }
}

function isSymlink(p) { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } }

/**
 * Aynayı kurar (gerekirse yeniler) ve yolunu döner.
 * assets/<kitap>/<alt> seviyesine kadar gerçek dizin (derinlik 3) — anahtar ve temp
 * dosyaları kitap klasörüne/altına yazılıyor; sayfa/ses dosyaları symlink.
 */
function buildWorkMirror(buildDir, mirrorDir_, version) {
  const marker = path.join(mirrorDir_, '.empp-mirror');
  const want = `${version || ''}|${buildDir}`;
  let have = null;
  try { have = fs.readFileSync(marker, 'utf8'); } catch { /* yok */ }
  if (have !== want) {
    fs.rmSync(mirrorDir_, { recursive: true, force: true });
    mirrorDir(buildDir, mirrorDir_, 3);
    fs.writeFileSync(marker, want);
  }
  return mirrorDir_;
}

/** Electron main'den çağrılır: ayna + chdir. Hata olursa uygulama eski davranışla açılır. */
function activate(app, buildDir) {
  try {
    if (process.platform === 'win32') return null; // Windows'ta CWD zaten kurulum dizini
    const mirror = buildWorkMirror(buildDir, path.join(app.getPath('userData'), 'work'), app.getVersion());
    process.chdir(mirror);
    return mirror;
  } catch (err) {
    console.error('[empp-work-mirror] kurulamadı, varsayılan CWD ile devam:', err && err.message);
    return null;
  }
}

module.exports = { buildWorkMirror, activate, mirrorDir };
