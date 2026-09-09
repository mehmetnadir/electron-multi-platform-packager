'use strict';
// K9c (2026-09-09, tudem-apk-batch kanıtı) — çalışma kopyasını (workingPath)
// SAHİBİNE yazılabilir hale getirir, `fs.copy(buildPath, workingPath)`'ten
// HEMEN SONRA, herhangi bir enjeksiyon adımından ÖNCE çağrılmalı.
//
// NEDEN: Bazı yayıncılar (Tudem) SET içeriklerini ISO'dan üretir; ISO'nun
// kendi dosya izinleri (0400, salt-okunur) zip/upload akışıyla çalışma
// kopyasına da taşınabilir. K9b'nin per-alt-kitap try/catch'i domino etkisini
// (bir kitabın EACCES'i DİĞERLERİNİ durdurması) kapattı, ama kök nedeni
// (dosyaların gerçekten yazılamaz olması) çözmüyor — her alt-kitap TEK TEK
// "izin yok" diye atlanır, sonuç aynı: hiçbir kitap shim/viewport almaz.
//
// BELİRTİ: gerçek Bloktest_Okuma_Yazma_2023.iso'dan bsdtar ile çıkarılan ağaç
// (chmod uygulanmadan) normalizeBookViewerViewports'tan geçirilince: 27/27
// alt-kitap `empp-android-shim.js` DOSYASINI alır (fs.copy yeni dosya oluşturur,
// dizin-yazma izni yeter) ama 0/27 index.html script tag'i alır (var olan
// dosyaya yazma dosya-izni ister, 0400 bunu engeller).
//
// KANIT: `/tmp/tudem-real-nochmod` (bu dosyanın testinde tekrarlanır) — chmod
// uygulanmadan 0/27 tag, chmod uygulanınca (bu fonksiyon veya elle) 27/27 tag.
//
// BOZARSAN: `ensure-writable.test.js`'teki GERİLEME testi kırılır; ayrıca
// gerçek ISO-kaynaklı SET yüklemeleri packagingService.js içinde SESSİZCE
// (tüm adımlar "✅"/"⚠️" loglar ama kullanıcıya hata dönmez) eksik paketlenmeye
// devam eder.
async function ensureWritableTree(rootPath) {
  const fs = require('fs-extra');
  const path = require('path');
  let fixed = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      return; // dizin okunamıyorsa atla, tek nokta bütün taramayı durdurmasın
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      try {
        if (ent.isSymbolicLink()) continue;
        const st = await fs.lstat(full);
        const desiredOwnerBits = ent.isDirectory() ? 0o700 : 0o600;
        if ((st.mode & 0o700) !== desiredOwnerBits) {
          await fs.chmod(full, st.mode | desiredOwnerBits);
          fixed++;
        }
      } catch (chmodErr) {
        // Tek dosyanın chmod'u başarısız olsa bile tarama DEVAM eder (K9b ile
        // aynı ilke: bir öğenin hatası diğerlerini durdurmaz).
        console.warn(`⚠️ ensureWritableTree: ${full} chmod edilemedi:`, chmodErr.message);
      }
      if (ent.isDirectory()) {
        await walk(full);
      }
    }
  }

  await walk(rootPath);
  return fixed;
}

module.exports = { ensureWritableTree };
