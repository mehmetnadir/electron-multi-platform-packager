# Changelog

## 2026-08-30 — Disk şişmesi kökten önlendi (agent-mode output + kaynak-cache sızıntısı)

S21 diski %89'a dayanmıştı; iki bağımsız sızıntı bulundu ve kapatıldı:

- **Paketleyici output (98 GB / 98 klasör):** `delete-job` output klasörünü YALNIZ
  `req.body.outputPath` verilirse siliyordu (frontend gönderir). **Ajan body
  göndermiyordu** → agent modunda `~/.electron-packager-tool/config/output/{name}`
  HİÇ silinmiyordu; her yeniden-build yeni tarihli 1-1.8 GB klasör bırakıyordu.
  Fix: `delete-job` outputPath'i job kaydından çözer (`packagingJobs` +
  otoriter `queueService.getPackagingStatus`), ajanın body'siz çağrısı da siler.
  Backstop: `sweepStaleOutputs` (başlangıç + saatlik, mtime > `OUTPUT_TTL_HOURS`=72s)
  packager build↔silme arasında restart olup job kaydı uçarsa yakalar. İlk sweep
  S21'de 50 klasör/51 GB, Mac'te 8 klasör temizledi (S21 disk %89→%82).
- **Kaynak cache (6.9 GB):** yayıncı exe adındaki sürüm bump'ında (…-v63→v64) eski
  `/var/empp-cache/{book}/{v63}/build.zip` ölü kalıyordu. Fix: `pruneSiblingVersions`
  — ajan yeni sürümü indirir indirmez aynı kitabın eski sürüm cache'lerini siler
  (populate + HIT sonrası; S21 + Mac otomatik). TTL janitor (14 gün) backstop.

Not: pipeline worker (windows/pardus) `/var/empp-cache` kullanmaz (`.pipeline-work`,
per-job temizlenir) → empp-cache tamamen ajanın (android+mac), self-prune hepsini kapsar.
Testler: runner sentinel (21) + app sentinel (3), 75/75.

## 2026-06-15 — Android paketleme + WebView uyumluluk + UI düzeltmeleri

Bu oturum baştan sona Android APK üretimini ve birkaç UI/sunucu hatasını düzeltti.

### Android APK
- **sharp arm64 fix:** Apple Silicon'a Intel binary kurulmuştu → prebuilt arm64 çekildi.
- **Gradle JAVA_HOME bug:** `runGradleBuild` fallback'i `/usr/libexec/java_home` (araç yolu, JDK home değil) idi → gradle çöküp ZIP fallback'e düşüyordu. Yeni `getJavaHome()` env→openjdk@21→java_home sırasıyla **JDK 21+** seçer (Capacitor 7 zorunluluğu). Bundletool'daki hardcoded @21 yolu da helper'a çevrildi.
- **Launcher ikonu:** `setupCapacitorIcons` yeniden yazıldı — density PNG (launcher+round), çakışan .webp silme, `mipmap-anydpi-v26` adaptive XML kaldırma → ikon garantili görünür (önceden adaptive XML PNG'yi gölgeliyordu).
- **Yatay zorlama:** `configureAndroidManifest` MainActivity'ye `android:screenOrientation="sensorLandscape"` (attribute olarak — ilk denemede yanlışlıkla text düşmüştü).
- **Tam ekran:** `configureAndroidFullscreen` MainActivity.java'ya IMMERSIVE_STICKY + styles.xml windowFullscreen.
- **Viewport/sığma:** book viewer'lara device-width viewport (SPA sahneyi window.innerWidth/1920 ile ölçekliyor).
- **WebView uyumluluk shim'i** (`_buildWebViewRequireShim`, her book*/index.html'e enjekte):
  - `window.isApp=true` (bundle yaması) → localStorage persistence: tour skip + kalınan sayfa + arka plan.
  - `window.require` stub: path ('..'/'.' çöz), fs (localStorage-VFS), electron (no-op) → Electron-bağımlı butonlar çökmez.
  - Navigation-normalize: `//` collapse + kök `/index.html`→`/`; join kök çıktıda trailing slash bırakmaz → home butonu menüye döner (Capacitor ham `..`/`//` reddediyordu).

### Sunucu / UI
- **`/api/open-folder`:** Tarayıcı modunda "Klasörde Göster" (OS open/explorer/xdg-open, shell:false güvenli).
- **"Sil" gerçek silme:** delete-job/delete-jobs artık outputPath'i de siler (`safeRemoveOutputDir`, output-dizini-içinde traversal guard).
- **"Yeniden İşle" kaldırıldı:** Otomatik temizlik uploads'u sildiği için reprocess hep başarısızdı.
- **settings.html null fix:** Yayınevi alanları ayrı sayfaya taşınmış; loadSettings/saveSettings guard'landı (boş publisher gönderip veri silme riski de kapandı).
- **publishers.html oluşturuldu:** `/publishers` route'u eksik dosyayı sendFile ediyordu (ENOENT). Tam CRUD + logo upload.

### Bilinen / Bekleyen
- Test altyapısı yok — bu düzeltmeler için test yazılmadı.
- APK ~510 MB (asset'ler gömülü) — on-demand cache düşünülebilir.
- Release-imzalı APK akışı yok (sadece debug assembleDebug).
- WebView shim, yayıncının minified bundle'ına bağlı (`window.isApp=Boolean(` pattern) — kitap sürümü değişirse yeniden doğrula.
