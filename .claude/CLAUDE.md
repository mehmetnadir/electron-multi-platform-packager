# Electron Multi-Platform Packager

> Web uygulamalarını Windows/macOS/Linux/Android/PWA native paketlerine dönüştüren masaüstü + web arayüzlü araç.

## Kimlik
- **Stack:** Electron + Express + Socket.io (server), Capacitor 7 (Android), electron-builder (desktop), sharp (ikon)
- **Port:** 3001 (PORT 3000 YASAK)
- **Paket Yöneticisi:** npm
- **Çalıştırma:** `PORT=3001 node src/server/app.js` → http://localhost:3001 (log: /tmp/empp-server.log)

## Dosya Haritası
| Ne arıyorsun | Nereye bak |
|---|---|
| Paketleme mantığı (TÜM platformlar) | `src/packaging/packagingService.js` (149KB monolith) |
| Android APK akışı | packageAndroid → buildAPKWithCapacitor → initializeCapacitorProject |
| Linux/Win/macOS/PWA | packageLinux / packageWindows / packageMacOS / packagePWA (ayrı metodlar) |
| HTTP route'lar, endpoint'ler | `src/server/app.js` |
| Ayarlar/yayınevi API | `src/server/settingsRoutes.js` (mount: /api) |
| Kuyruk + post-build temizlik | `src/services/queueService.js` |
| Config/output/logo yolları | `src/config/ConfigManager.js` (output: ~/.electron-packager-tool/config/output) |
| Frontend (ana UI) | `src/client/public/app.js` + index.html |
| Ayarlar sayfası | `src/client/settings.html` |
| Yayınevi yönetimi | `src/client/publishers.html` |
| Modüler platform iskeleti (KULLANILMIYOR) | `src/platforms/*` — gerçek akış monolith'te |

## Dikkat Edilecekler (Gotchas)
- **sharp arm64:** Apple Silicon'da `npm i --ignore-scripts --include=optional --os=darwin --cpu=arm64 sharp@<v>` (yanlış mimari kurulursa "Could not load sharp").
- **Android JDK 21:** Capacitor 7 (AGP 8.7.2) JDK 21 ister. `getJavaHome()` env→Homebrew openjdk@21→java_home sırasıyla 21+ seçer. JAVA_HOME'u hardcode ETME.
- **Android = SADECE Android metodları:** Android düzeltmeleri packageAndroid + initializeCapacitorProject + getJavaHome/configureAndroid*/normalizeBookViewerViewports/_buildWebViewRequireShim/setupCapacitorIcons içinde. Linux/Win/macOS metodları İZOLE — birini düzeltmek diğerini etkilemez (ortak: createZip/runCommand generic util'ler).
- **Electron-mode kitap + Capacitor WebView uyumluluğu:** Yayıncı kitapları Electron desktop modunda export ediliyor (window.require electron/fs/path, file-persistence). WebView'de bunlar yok. `_buildWebViewRequireShim()` her book*/index.html'e enjekte edilir: window.isApp=true (localStorage persistence) + require stub (path '..'/'.' çöz, fs=localStorage-VFS, electron stub) + nav-normalize (// collapse, kök /index.html→/). Capacitor `https://localhost/`'tan servis eder ve ham `..`/`//` yollarını reddeder.
- **Browser modu ≠ Electron:** "Klasörde Göster" tarayıcıda /api/open-folder (OS open/explorer/xdg-open) ile çalışır; electronAPI sadece Electron'da.
- **"Sil" output'u da siler:** /api/delete-job, outputPath'i (output dizini içindeyse, traversal-guard'lı) gerçekten siler.
- **Otomatik temizlik:** Kuyruk boşalınca uploads/ tamamen silinir (queueService.checkAndCleanIfQueueEmpty) → tamamlanan işler reprocess EDİLEMEZ (buton kaldırıldı).
- **Test altyapısı YOK.** package.json'da test script bile yok.

## İlgili Dosyalar
| Dosya | Amaç |
|---|---|
| `.claude/docs/changelog.md` | Değişiklik geçmişi |
| `project-switch.md` | Librarian pointer |

Son Güncelleme: 2026-06-15
