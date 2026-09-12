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
- **Agent modunda output silinmez tuzağı (2026-08-30):** `delete-job` gerçek paketleri (`config/output/{name}`) YALNIZ `req.body.outputPath` verilirse siler (frontend gönderir). Ajan body'siz çağırıyordu → agent modunda output HİÇ silinmiyor, `~/.electron-packager-tool/config/output` 98 GB'a şişti. Fix: outputPath job kaydından çözülür (`packagingJobs` + otoriter `queueService.getPackagingStatus(jobId)`). Backstop: `sweepStaleOutputs` (başlangıç + saatlik, mtime > `OUTPUT_TTL_HOURS`=72s) — build↔silme arası restart'ta job kaydı uçarsa yakalar. Yeni "iş bitince sil" akışı yazarken: ajanın gerçekten neyi sildiğini SUNUCUDA ölç (agent "output released" log'u atsa bile packager silmemiş olabilir).
- **Kaynak cache sürüm budaması (2026-08-30):** yayıncı exe sürümü bump'lanınca (…-v63→v64) eski `/var/empp-cache/{book}/{v63}/build.zip` ölü kalır. `pruneSiblingVersions` yeni sürüm cache'e girer girmez (populate+HIT sonrası) aynı kitabın diğer sürümlerini siler. TTL janitor (14 gün) yalnız backstop — bump'ta anında budama bunun işi.
- **dmg düzeni:** `platforms/macos/dmg-layout.js` (sharp arka plan, MUTLAK yol — göreli yol app dizinine göre çözülüp ENOENT verdi).
- **Ajan (`src/agent/runner.js`):** kaynak önbelleği (`EMPP_SOURCE_CACHE/{bookId}/{exeAdı}/build.zip`), yayıncı güncellemesi paketleme anında (`publisher-update.js`, `EMPP_UPDATE_DIR/{kurum}/{version}.zip`; cache STALE), R2 multipart parça 30 deneme, complete-multipart 5xx 3 deneme, geçici ağ hatasında `failed` yazılmaz (lease dolunca yeniden). `local-build.js` = R2'siz yerel imzalı/noterli dmg.
- **Sunucu (S21) servisleri:** gerçek Android paketleyici = systemd `empp-packager` (`/opt/empp-packager`, :3091) + systemd `empp-agent`. pm2 `packager-service` (`/opt/electron-packager`) AYRI kopya — güncellemede `/opt/empp-packager`'ı reset'le, `systemctl restart empp-packager empp-agent`. Log: `/var/log/empp-packager.log`, `/var/log/empp-agent.log`.
- **NAZİK BUILD — GENEL KURAL (2026-09-07, Nadir):** srv21 PAYLAŞILAN üretim sunucusu (yayıncı panelleri, API'ler, video/php işleri orada). Ağır build (electron-builder → mksquashfs/fpm, 2GB+ app'te ~35dk ve 12GB temp I/O) canlı siteleri yavaşlatır. Kural koda gömüldü: `resolveElectronBuilderBinary()` Linux'ta komutu `nice -n 19 ionice -c 3` ile sarar (çocuk süreçlere miras kalır) → canlı trafik CPU/I/O'da HER ZAMAN önce. Acil kapatma: `EMPP_GENTLE=0`. Sentinel: `src/packaging/gentle-build.test.js`. Ek disiplin (toplu işlerde): **tek build**, paralel YASAK; yoğun saatte kaçın. İhlal kanıtı: 2 paralel build load'u 7→9.6'ya çıkardı, siteler yavaşladı (2026-09-07).
- **Browser modu ≠ Electron:** "Klasörde Göster" tarayıcıda /api/open-folder ile çalışır; electronAPI sadece Electron'da.
- **SET paketi (alt-kitap dizinli) know-how (K1-K16, 2026-09-09):** SET'e dokunan
  HERHANGİ bir değişiklikten önce `.claude/docs/set-paketi-know-how.md`'yi oku —
  on altı kusurun/dersin (eksik app.config.js, node_modules sızıntısı, alt-kitaba
  shim/manifest eksikliği, origin-farkında olmayan path.join, setBook.enable, VFS
  anahtar çarpışması ×2, ad-desenden bağımsız SET tespiti/Tudem, Electron fs-shim
  alt-kitap eksikliği, bir alt-kitabın EACCES'inin diğerlerini domino ile
  durdurması, sessiz kısmi-hata sayımı, Gradle heap ön-kontrolü, root/uid test
  sertleştirme) tablosu, "SET nasıl tanınır" (motor imzası: `index.html`+
  `app.config.js`, AD DESENİ DEĞİL), yeni platform/adım checklist'i, telefon +
  Electron test tarifi ("Doğrulama"), "Tek örnek kuralı" ve "Üretim sonrası
  doğrulama" bölümleri orada. Testte `GERİLEME:` önekli olanlar regresyon
  kapılarıdır — kırılırsa DUR, körü körüne geri alma.
- **İndirme dosya adında Türkçe karakter (K11/K11b, 2026-09-09):** `/api/download`, logo serve route'u VE `localPackagingRoutes.js`'in (gölgede kalan) `/download` route'u dosya adını ham UTF-8 ile `Content-Disposition` header'ına koyarsa Node `ERR_INVALID_CHAR` fırlatıp 500 verir (ı/İ/ğ/Ğ/ş/Ş Latin-1 dışında). `src/server/content-disposition.js` (`buildContentDisposition`) RFC 5987 ile ASCII fallback + `filename*=UTF-8''` üretir — YENİ bir dosya-adı/header noktası eklenirse bunu kullan, ham `filename="${...}"`/ham `res.download(...)` YAZMA.
- **Canlı süreç hangi kodu koşuyor (K13, 2026-09-09):** `packagingService.js` singleton require-cache'te — restart olmadan yeni kod devreye girmez. `curl /api/health` artık `commit` (kısa git hash, `src/server/git-commit.js`) + `startedAt` döner; deploy sonrası bunu doğrula, "restart ettim" yeterli KANIT DEĞİLDİR.
- **Android Gradle heap ön-kontrolü (K14, 2026-09-09):** `runGradleBuild` başlamadan `src/packaging/android-preflight.js` `~/.gradle/gradle.properties`'teki `org.gradle.jvmargs` Xmx'i kontrol eder (<6g veya dosya yoksa `console.warn`) — dosyaya DOKUNMAZ. Büyük kitap build'i OOM veriyorsa ÖNCE bu uyarıya bak.
- **Testler:** `node --test 'src/**/*.test.js'` (223; `node --test src/` Node 24'te çalışmaz). Sentinel testler canlı yolları kilitler. SET-özel hızlı kapı: `npm run test:set` (122). 4 test (3 chmod-domino + 1 graveyard) root/uid=0 veya `_graveyard/` eksikse KENDİNİ `t.skip` eder (K15) — Mac'te normal kullanıcı olarak 0 skip beklenir.

## İlgili Dosyalar
| Dosya | Amaç |
|---|---|
| `.claude/docs/changelog.md` | Değişiklik geçmişi |
| `.claude/docs/set-paketi-know-how.md` | SET paketi K1-K16 bilgi tablosu + doğrulama/deploy operasyon kuralları |
| `.claude/docs/deploy.md` | srv21 dağıtım kuralları (ff-only, restart-yalnız-kuyruk-boşken, iki ayrı kopya uyarısı) |
| `project-switch.md` | Librarian pointer |

Son Güncelleme: 2026-09-09 (K11b-K16 — 2. res.download, kısmi-hata özet sayımı, /api/health commit/startedAt, Android Gradle heap ön-kontrolü, root/uid test sertleştirme, srv21 deploy.md)

- **Ajan logo/ikon (2026-09-12):** `pickLogoId` yayıncı ADINI `/api/logos` kayıtlarıyla eşler — kayıt yoksa/ad farklıysa sessizce varsayılan ikon. Pardus için zip kökünde `ico.png` şart → `injectPardusIcon` (runner.js) kayıtlı logoyu ekler. Yeniden başlatma: `touch ~/.empp-agent/yeniden-baslat.istek` (işler arasında temiz çıkış).
- **Ajan duraklatma bayrağı (2026-09-12):** `~/.empp-agent/duraklat.istek` durdukça ajan yeni iş almaz (süren iş biter); kaldıran çağırandır. Bu Mac'te elle üretim koşarken (paketleyici 4 paralel iş kabul ediyor, iki Gradle aynı `@capacitor/android` build dizinini paylaşıp R.jar yarışıyla düşüyor) bayrağı koy, paketleyici boşalınca üret, sonra kaldır. `yeniden-baslat.istek` ise tek kullanımlık restart.
- **macOS yalnız ofiste (2026-09-12, Nadir kararı):** noter yüklemesi (300-500 MB) ev hattını boğuyor. Ajan heartbeat'te `guncelYetenekler()` bildirir: geçit 192.168.1.254 değilse `macos` düşer (`android,pardus` kalır), sunucu next-job'u buna göre kiralar. Bayraklar `~/.empp-agent/macos-serbest.istek` (evde de aç) / `macos-durdur.istek` (ofiste de kes), kalıcı. Aynı gece: pardus aracı Electron ikilisini her derlemede GitHub'dan indiriyordu → `electron_config_cache=/cache/electron` (volume) eklendi.
- **TUZAK — `yeniden-baslat.istek` paketleyiciyi de öldürür (2026-09-12 17:54, ölçüldü):** paketleyici (3001) `run-agent.sh` içinden nohup çocuk olarak açılıyor; runner bayrakla çıkınca launchd süreç grubunu (AbandonProcessGroup yok) kapatıyor → paketleyici yeniden başlıyor, süren TÜM işler kayboluyor (Vitanova 7. sınıf job'u yok oldu, `packager.log` sıfırlandı). Bayrağı yalnız `/api/queue-status` boşken ve ajan işsizken koy; kalıcı çare plist'e `AbandonProcessGroup=true`.
