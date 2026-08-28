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
| Platform yardımcıları (KULLANILIYOR) | `src/platforms/macos/{mac-signing,dmg-layout}.js`, `src/platforms/common/fs-shim.js`, `src/platforms/android/empp-android-shim.js`; `*PackagingService.js` iskeletleri canlı yol DEĞİL ama sentinel'ler onları da tutar |
| Ajan (pull-mode build agent) | `src/agent/runner.js`, `runner-helpers.js`, `publisher-update.js`, `local-build.js` |

## Dikkat Edilecekler (Gotchas)
- **sharp arm64:** Apple Silicon'da `npm i --ignore-scripts --include=optional --os=darwin --cpu=arm64 sharp@<v>` (yanlış mimari kurulursa "Could not load sharp").
- **Android JDK 21:** Capacitor 7 (AGP 8.7.2) JDK 21 ister. `getJavaHome()` env→Homebrew openjdk@21→java_home sırasıyla 21+ seçer. JAVA_HOME'u hardcode ETME.
- **İki paketleme yolu var — ikisini de düzelt:** canlı `/api/package` → `packaging/packagingService.js` (monolith). `src/platforms/*` servisleri ayrı config yazar (mac: `MacOSPackagingService`, android: `AndroidPackagingService` .ts config). 27 Ağu'da mac imzası ve android CapacitorHttp yalnız birine konup boşa build alındı. Sentinel testler ikisini de zorlar.
- **`electron.js` varsa main.js düzenlemeleri de uygulanır (2026-08-27):** eskiden else-dalında kalıp title/fullscreen/sandbox/fs-shim atlanıyordu. `prepareElectronFiles` bloğu her durumda çalışır.
- **macOS imza:** `platforms/macos/mac-signing.js` → `APPLE_SIGN_IDENTITY` ("Developer ID Application:" ön eki kırpılır, electron-builder reddeder), hardened runtime, entitlements (`resources/entitlements.mac.plist`), `notarize:false` — noter ajanın işi (`notarytool --keychain-profile`). `asar` AÇIK kalır (kapatmak 10k dosya = saatler).
- **Yayıncı uygulaması masaüstü modu (Electron/Android ortak ders):** anahtar deposu `classlibraries/ImWin32.dll` (şifreli XML) `fs` ile yazılır, `fetch` ile okunur; yollar `getFilePath` → exe yolu boş → kök-mutlak sahte (`/classlibraries/…`, `/temp/…`). Mac: `platforms/common/fs-shim.js` (fs+fetch, work dizini). Android: `platforms/android/empp-android-shim.js` (VFS localStorage + yerel asset senkron XHR + `empp-manifest.json`, path/os/electron/https/adm-zip stub, `window.__dirname=''`). Detay: book-update `.claude/docs/masaustu-mobil-paketleme.md`, `aktivasyon-mekanizmasi.md`.
- **Android CapacitorHttp ZORUNLU ama tuzaklı:** yayıncı API'si CORS vermiyor → `plugins.CapacitorHttp.enabled=true`. Fakat Capacitor `XMLHttpRequest`'i KURUCU düzeyinde sarar; senkron istekte `status 0`. Bundle `pages2x/` için senkron HEAD atıp `404!=status` bakar → 0 → olmayan retina klasörü → BOŞ SAYFA. Shim kurucuyu sarar (sync → `CapacitorWebXMLHttpRequest.open/send`). Prototip yaması İŞE YARAMAZ. `CapacitorWebXMLHttpRequest` constructor değil, metod objesi.
- **`?app=1` (window.isApp) KULLANMA:** mobil mod farklı akış; sayfa yükleyici yine masaüstü yolunu kullanır. Masaüstü modu + shim doğru yol (28 Ağu doğrulandı).
- **`settingsRoutes.js` 'electron'ı koşulsuz require ETME:** sunucuda yok → crash-loop. Korumalı require.
- **Kuyruk boşalınca temizlik:** temp'i toptan silme — tamamlanmış ama ajanın henüz indirmediği çıktı (`temp/<job>/macos`) korunur (`queueService`), yoksa `/api/download` 404.
- **dmg düzeni:** `platforms/macos/dmg-layout.js` (sharp arka plan, MUTLAK yol — göreli yol app dizinine göre çözülüp ENOENT verdi).
- **Ajan (`src/agent/runner.js`):** kaynak önbelleği (`EMPP_SOURCE_CACHE/{bookId}/{exeAdı}/build.zip`), yayıncı güncellemesi paketleme anında (`publisher-update.js`, `EMPP_UPDATE_DIR/{kurum}/{version}.zip`; cache STALE), R2 multipart parça 30 deneme, complete-multipart 5xx 3 deneme, geçici ağ hatasında `failed` yazılmaz (lease dolunca yeniden). `local-build.js` = R2'siz yerel imzalı/noterli dmg.
- **Sunucu (S21) servisleri:** gerçek Android paketleyici = systemd `empp-packager` (`/opt/empp-packager`, :3091) + systemd `empp-agent`. pm2 `packager-service` (`/opt/electron-packager`) AYRI kopya — güncellemede `/opt/empp-packager`'ı reset'le, `systemctl restart empp-packager empp-agent`. Log: `/var/log/empp-packager.log`, `/var/log/empp-agent.log`.
- **Browser modu ≠ Electron:** "Klasörde Göster" tarayıcıda /api/open-folder ile çalışır; electronAPI sadece Electron'da.
- **Testler:** `node --test 'src/**/*.test.js'` (70; `node --test src/` Node 24'te çalışmaz). Sentinel testler canlı yolları kilitler.

## İlgili Dosyalar
| Dosya | Amaç |
|---|---|
| `.claude/docs/changelog.md` | Değişiklik geçmişi |
| `project-switch.md` | Librarian pointer |

Son Güncelleme: 2026-08-28 (Mac imza/noter/shim, Android shim + senkron XHR, S21 servis haritası)
