# Changelog

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
