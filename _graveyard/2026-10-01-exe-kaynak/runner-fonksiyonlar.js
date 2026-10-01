'use strict';
// KARANTİNA — src/agent/runner.js'ten çıkarılan ölü fonksiyon gövdeleri (2026-10-01, exe'siz kaynak
// sözleşmesi sonrası). ÇALIŞTIRILABİLİR DEĞİL (runner.js bağlamı: log, warn, fsp, path, CONFIG,
// latestLocalUpdate, dahaYeniMi, kaynakCacheTavaniGb, lruSilinecekler, diskBosGb, agHatasiOzeti...).
// Nedeni/kanıtı: OKU.md. Kalıcı silme: 2026-11-30.

// ===== 1) runner.js:587-611 — cachedZipIsStale =====
/**
 * Önbellekteki build.zip'in yayıncı güncellemesi eskimiş mi? (kurum.txt + version.txt zip'ten
 * okunur; daha yeni yerel güncelleme varsa cache MISS sayılır → yeniden çıkarılıp uygulanır.)
 *
 * 2026-09-21 — REGRESYON ÖNLEME: burada eskiden `publisher-update.isNewer`
 * kullanılıyordu. O fonksiyon yayıncının electron.js checkVersion davranışını
 * birebir taklit eder ("3 parça değilse string farkı = yeni") ve YAYINCI
 * TARAFINDA doğrudur. Ama `surum-normallestir` düzeltmesi etkinleşince
 * önbellekteki version.txt 3 parçaya iner ("1.13.1") ve zip adı 4 parçalı
 * kalır ("1.13.1.3") → `isNewer('1.13.1','1.13.1.3') === true` → HER İŞTE
 * cache STALE → her işte ~1 GB yeniden indirme/çıkarma. `surum-kiyas.dahaYeniMi`
 * normalleştirilmiş hâli aynı sürüm sayar ve belirsiz girdide "yeni" demez.
 */
function cachedZipIsStale(zipPath) {
  try {
    const { spawnSync } = require('child_process');
    const read = (f) => { const r = spawnSync('unzip', ['-p', zipPath, f], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; };
    const kurum = read('kurum.txt').replace(/\r|\n/g, '');
    const version = read('version.txt') || '1';
    const upd = latestLocalUpdate(kurum ? kurum.padStart(3, '0') : null);
    const stale = !!upd && dahaYeniMi(version, upd.version);
    if (stale) log(`source cache STALE — yayıncı güncellemesi ${version} → ${upd.version}`);
    return stale;
  } catch (e) { return false; }
}

// ===== 2) runner.js:1205-1345 — touchCacheEntry + pruneSiblingVersions + dizinBoyutuHesapla + cacheTavaniUygula =====
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

/**
 * Aynı kitabın ESKİ sürüm cache'lerini siler (yalnız `keepVersion` kalır).
 * Yayıncı exe'yi güncelleyip adındaki sürümü yükseltince (…-v63→v64) eski
 * `{bookId}/{v63.exe}/build.zip` ölü kalıyordu; TTL (14 gün) geç davranıyor ve
 * `/var/empp-cache` şişiyordu (2026-08-29'da 9 ölü dizin = 6.9 GB elle silindi).
 * Yeni sürüm indirilir indirilmez kardeş sürümleri buduyoruz — her iki makinede
 * (S21 + Mac) otomatik, anında, kesin. Hata yutulur; budama üretimi durdurmaz.
 */
async function pruneSiblingVersions(bookDir, keepVersion) {
  try {
    const entries = await fsp.readdir(bookDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name === keepVersion) continue;
      const dead = path.join(bookDir, e.name);
      await fsp.rm(dead, { recursive: true, force: true });
      log('cache prune — eski sürüm silindi:', dead);
    }
  } catch (_) { /* dizin yok / yarış — önemsiz */ }
}

/**
 * `<dir>` altındaki tüm dosyaları özyinelemeli tarayıp toplam boyutu (bayt) döner.
 * `du` spawn etmez — saf fs; hata/erişilemeyen alt yol toplamı bozmaz (0 sayılır).
 */
async function dizinBoyutuHesapla(dir) {
  let toplam = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return 0;
  }
  for (const e of entries) {
    const tam = path.join(dir, e.name);
    try {
      if (e.isDirectory()) {
        toplam += await dizinBoyutuHesapla(tam);
      } else if (e.isFile()) {
        const st = await fsp.stat(tam);
        toplam += st.size;
      }
    } catch (_) { /* yarış / erişim — bu dalı atla, üretimi durdurma */ }
  }
  return toplam;
}

/**
 * Kaynak cache'ine (`<cacheRoot>/<bookId>/<version>/build.zip`) toplam bayt
 * tavanı uygular — cache 2026-09-13'te 35 GB'a ulaştı; `pruneSiblingVersions`
 * yalnız AYNI kitabın eski sürümünü siliyordu, kitaplar ARASI bir tavan yoktu.
 *
 * Tavan artık düz bir sabit DEĞİL — cache'teki EN BÜYÜK tek girdiye ORANTILI
 * (`kaynakCacheTavaniGb`, aynı desen: `pardusGerekliDiskGb`, 2026-09-19). Açık
 * override: `EMPP_CACHE_CAP_GB` (verilirse tek söz sahibi, ölçüme bakılmaz).
 * `korunanBookId` = üzerinde çalışılan iş; LRU seçimi ondan bağımsız aynı kalsa
 * da asla silinmez. Hata yutulur — cache tavanı üretimi asla durdurmaz.
 */
async function cacheTavaniUygula(cacheRoot, korunanBookId) {
  try {
    let bookDirs;
    try {
      bookDirs = await fsp.readdir(cacheRoot, { withFileTypes: true });
    } catch (_) {
      return; // cache kökü henüz yok — tavan uygulanacak bir şey yok
    }

    const girdiler = [];
    for (const bd of bookDirs) {
      if (!bd.isDirectory()) continue;
      const bookId = bd.name;
      const bookDir = path.join(cacheRoot, bookId);
      let versionDirs;
      try {
        versionDirs = await fsp.readdir(bookDir, { withFileTypes: true });
      } catch (_) { continue; }
      for (const vd of versionDirs) {
        if (!vd.isDirectory()) continue;
        const yol = path.join(bookDir, vd.name);
        const bayt = await dizinBoyutuHesapla(yol);
        let sonKullanim;
        try {
          sonKullanim = (await fsp.stat(yol)).mtimeMs;
        } catch (_) {
          sonKullanim = 0;
        }
        girdiler.push({ yol, bayt, sonKullanim, korunan: bookId === String(korunanBookId) });
      }
    }

    const enBuyukGirdiBayt = girdiler.reduce((acc, g) => Math.max(acc, g.bayt), 0) || null;
    const tavanGb = kaynakCacheTavaniGb({
      enBuyukGirdiBayt,
      bosGb: diskBosGb(cacheRoot),
      kat: Number(process.env.EMPP_CACHE_KAT || 3),
      tabanGb: Number(process.env.EMPP_CACHE_TABAN_GB || 5),
      ustSinirPayi: Number(process.env.EMPP_CACHE_UST_SINIR_PAYI || 0.5),
      elleGb: process.env.EMPP_CACHE_CAP_GB ? Number(process.env.EMPP_CACHE_CAP_GB) : null,
    });
    const tavanBayt = tavanGb * 1024 ** 3;

    const silinecekler = lruSilinecekler(girdiler, tavanBayt);
    for (const girdi of silinecekler) {
      try {
        await fsp.rm(girdi.yol, { recursive: true, force: true });
        const mb = (girdi.bayt / 1e6).toFixed(0);
        log('cache tavan — silindi:', girdi.yol, `(${mb} MB)`);
        // Boşalan `<bookId>` dizinini de kaldır (yetim boş klasör kalmasın).
        const bookDir = path.dirname(girdi.yol);
        const kalan = await fsp.readdir(bookDir).catch(() => null);
        if (kalan && kalan.length === 0) {
          await fsp.rmdir(bookDir).catch(() => {});
        }
      } catch (e) {
        warn('cache tavan — silinemedi:', girdi.yol, agHatasiOzeti(e));
      }
    }

    const toplamBayt = girdiler.reduce((acc, g) => acc + g.bayt, 0);
    const toplamGB = (toplamBayt / 1024 ** 3).toFixed(1);
    const tavanGB = (tavanBayt / 1024 ** 3).toFixed(1);
    log(`cache tavan özet: ${toplamGB}/${tavanGB} GB — ${silinecekler.length} girdi silindi`);
  } catch (e) {
    warn('cacheTavaniUygula başarısız (non-fatal):', agHatasiOzeti(e));
  }
}

// ===== 3) runner.js buildPardusArtifact içi — erişilemez hazır-paket dalı (hazirPardusPaketi hep null) — tam blok =====
  // HAZIR PAKET ŞERİDİ (2026-09-17): srv21 aynı kaynaktan .impark'ı ÖNCEDEN üretip
  // `EMPP_PARDUS_HAZIR_DIR`'e bırakır. Ölçüm: derleme kritik yolun %47'si ve konteyner
  // 8 çekirdeğin 8'ini yiyor — ikinci derlemeyi AYNI makinede koşturmak kazanç vermez;
  // başka makinede koşturmak verir. Ajan burada yalnız devralır: bütünlük + kabul kapısı
  // + yükleme yine BU makinede yapılır (kapı atlanmaz).
  const hazir = await hazirPardusPaketi(kimlik);
  if (hazir) {
    await fsp.mkdir(outDir, { recursive: true });
    log(`pardus: HAZIR paket devralındı (${(hazir.boyut / 1e6).toFixed(0)} MB) — derleme atlandı:`, hazir.dosya);
    const bt = imparkDenetle(hazir.dosya);
    if (bt.durum !== 'TAM') {
      throw new Error(`hazır pardus paketi bütünlük denetiminden geçemedi: ${imparkOzet(hazir.dosya, bt)}`);
    }
    log('pardus: bütünlük OK —', imparkOzet(hazir.dosya, bt));
    // Kopya yerine SERT BAĞ: aynı birimdeyse paket iki kez yer kaplamaz. Ölçüm
    // 2026-09-17: Mac diski 824 MB'a düştü, 1,5 GB'lık ikinci kopya üretimi durduruyordu.
    // Farklı birimdeyse (veya bağ kurulamazsa) eski davranışa, kopyalamaya düşülür.
    try {
      await fsp.link(hazir.dosya, artifactPath);
      log('pardus: hazır paket sert bağ ile devralındı (ikinci kopya YOK)');
    } catch (e) {
      await fsp.copyFile(hazir.dosya, artifactPath);
    }
    const mbH = ((await fsp.stat(artifactPath)).size / 1e6).toFixed(0);
    log(`pardus: impark hazır — ${artifactPath} (${mbH}MB)`);
    await pardusKabulKapisi(artifactPath, outDir, appName, kimlik.bookId);
    // Hazır kaynağı ANCAK kapı geçtikten sonra sil. Ölçüm 2026-09-17 (45695):
    // kopyalar kopyalanmaz siliniyordu; kapı düşünce srv21'deki iş dizini de
    // temizlenmiş olduğu için paket TAMAMEN kayboldu ve baştan üretildi.
    await fsp.rm(hazir.dosya, { force: true }).catch(() => {});
    await fsp.rm(`${hazir.dosya.replace(/\.impark$/, '')}.json`, { force: true }).catch(() => {});
    return;
  }
