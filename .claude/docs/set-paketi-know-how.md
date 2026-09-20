# SET paketi know-how (K1-K16, 2026-09-09)

> Kitap 45538 "English Up 5 Set", 59480 "Flashy Grade 8 Set" ve Tudem ISO'ları
> (`Bloktest_Okuma_Yazma_2023.iso` vb.) üzerinde bulunan, düzeltilen ve (K1-K6b,
> K9 Pardus dahil) telefonda/masaüstünde kanıtlanan dokuz kusurun kalıcı özeti.
> Amaç: bu bilgi koddan/testlerden AYRI bir yerde de yaşasın — gelecekte başka
> bir iş bu fonksiyonlara dokunursa önce burayı okusun.
>
> Kaynak taraf (kitap-update deposu) tarihsel akış: `~/01dev/book-update/.claude/docs/paket-yapilari-tek-kitap-vs-set.md`
> §1-8 (aynı vakanın kronolojik günlüğü, telefon ekran görüntüleri dahil).

## SET nasıl tanınır

Bir paket (build klasörü) **SET** sayılır ↔ kökü İÇİNDE (kök hariç, en fazla
2 seviye aşağı) kendi `index.html` VE `app.config.js` dosyalarına BİRLİKTE
sahip en az bir dizin varsa — bu ikili **motor imzasıdır** (`src/packaging/sub-book-dirs.js`
`findSubBookDirs()`). **AD DESENİ KULLANILMAZ** (K8, 2026-09-09): eskiden
`^book\d+$` regex'i vardı, ama Tudem ISO'ları SET'i `fasikuller-01/`,
`d1-portfolyo/`, `okula-basladim/` gibi TAMAMEN farklı adlarla kurar — bunlar
regex'le hiç yakalanamazdı. Her alt-kitap kendi `assets/<id>/`,
`classlibraries/ImWin32.dll`'ına sahiptir — kökten TAMAMEN bağımsız bir "kitap"
gibi çalışır; bulunduğu anda İÇİNE tekrar inilmez (kendi `core/`/`assets/`'i
başka bir "iç içe SET" sanılmaz). Kök, yayıncının kendi ürettiği bir set-menü
`index.html`'i içerebilir (veya içermeyebilir — paketleyici bunu ÜRETMEZ, bkz.
K1). Alt-kitap bulunamazsa paket **tek kitap** sayılır ve bu dosyadaki hiçbir
SET-özel adım (K3/K5/K6/K6b) çalışmaz — hepsi `findSubBookDirs` boş dönünce
no-op'tur.

## K1-K16 tablosu

| # | Kusur | Belirti (telefonda) | Kök neden | Düzeltme (dosya:fonksiyon) | Test | Kanıt APK |
|---|---|---|---|---|---|---|
| K1 | SET kökünde `app.config.js` yok → **GERİ ALINDI** | AppConfig hatası → sonra "Assets folder must have only one folder" / ImWin32.dll okunamadı | Yayıncı bazı SET build'lerinde kökte `app.config.js` bırakmıyor (`set_app.config` var) | Nadir kararı: paketleyici SET menüsü/konfig **ÜRETMEZ** — build aynen paketlenir. Kod `_graveyard/2026-09-09-set-app-config/` (mv, NEDEN.md) | `set-app-config-kasitli-yok.test.js` (3) | `asis_59480.apk` (app.config.js YOK, özel index korunmuş) |
| K2 | `node_modules/electron` APK'ya sızıyor | — (dosya boyutu/keşifle bulundu, telefon hatası değil) | `packageAndroid`/`initializeCapacitorProject`'teki `fs.copy(workingPath, ...)` filtresizdi | `www-copy-exclude.js` → `createWwwCopyFilter()`; iki `fs.copy` çağrısına `{ filter }` eklendi | `www-copy-exclude.test.js` (7) | her proof APK'da `unzip -l` → 0 `node_modules` |
| K3 | bookN sayfası boş, "process is not defined" + pages2x 404 | menü → kitap seçilince sayfa açılmıyor | TAM Android shim (`empp-android-shim.js`) yalnız SET KÖKÜNE enjekte ediliyordu; bookN yalnız zayıf eski `__webviewCompatShim`'i alıyordu | `packagingService.js` `buildAndroidManifest()` (satır ~3601) + `normalizeBookViewerViewports()` (satır ~3891) — her `bookN/`'e shim kopyası + kitap-başına manifest | `book-android-shim.test.js` (11) | `shim_59480.apk` |
| K4 | "ana sayfa" → `https://localhost/localhost/index.html` (ERR_HTTP_RESPONSE_CODE_FAILURE) | motor tam URL'lerle `path.join(dirname(location.href),'../')` çağırıyor; posix-saf `normalize` origin'in `//`sini yutuyor | `empp-android-shim.js` `pathMod.join` → `joinOriginAware()` (eski compat-shim'in origin-farkında algoritması REPLIKE edildi) | `empp-android-shim-path.test.js` (12) | `home_59480.apk` |
| K5 | kitap içinde "ana sayfa" butonu hiç çıkmıyor | `setBook.enable` bazı bookN'lerde unutulmuş `false` | `set-book-home-button.js` `ensureSetBookHomeButton()` — `packagingService.js` `startPackaging()`'in ortak ön-fanout bloğunda (satır ~412), platform ayrımından ÖNCE, tüm platformlar için | `set-book-home-button.test.js` (9) | `vfs_59480.apk` (book3/app.config.js `setBook.enable:true`) |
| K6 | GAMES (book2) "Kitap Açılıyor.." ekranında kalıyor, book1'in kimliğini istiyor | `empp-android-shim.js` VFS `key(p)` göreli yolları HER ZAMAN site köküne göre anahtarlıyordu — tüm bookN aynı `localStorage` VFS'ini paylaşıyordu | `key(p)`/`pageBaseDir()` — göreli yollar `dirname(location.pathname)` ile ad-alanlanır | `empp-android-shim-vfs-key.test.js` (a)-(e2) | `vfs_59480.apk` |
| K6b | K6 sonrası, temiz kurulumda hâlâ gizli çarpışma riski | motor kalıcılık dosyasını (`storage.im`, `ImWin32.dll`) `__dirname + '/...'` ile MUTLAK yazıyor; K6 kuralı "mutlak yol değişmez" diyordu | `key(p)` — mutlak yol da (istisna: zaten bookN dizini içindeyse hariç) sayfanın kendi dizinine öneklenir | `empp-android-shim-vfs-key.test.js` K6b (a)-(e) | `vfs2_59480.apk` |
| K7 | (bu dosya) — gelecekte aynı kusurların TEKRARLANMAMASI | know-how kodda/testte var ama ayrı, keşfedilebilir bir belgede YOKTU | Bu doküman + kod içi NEDEN/BELİRTİ/KANIT/BOZARSAN yorum blokları + `GERİLEME:` test önekleri + `npm run test:set` | (bu dosya + yorumlar + test adları) | — (davranış değişikliği yok) |
| K8 | Tudem ISO'ları (`fasikuller-01/`, `okula-basladim/`, ...) SET olarak tanınmıyor | Android'de aynı "process is not defined"/boş sayfa (K3-öncesi hâl) — bookN adı YOK diye shim/manifest/setBook adımları hiç çalışmıyordu | `^book\d*$` ad deseni AD DESENİNDEN BAĞIMSIZ motor-imzasına (`index.html`+`app.config.js`) çevrildi: yeni `sub-book-dirs.js` `findSubBookDirs()`, K3 (`normalizeBookViewerViewports`) ve K5 (`ensureSetBookHomeButton`) bunu kullanır; K6/K6b'ye (VFS ad-alanı) hiç dokunulmadı — `pageBaseDir()` zaten `dirname(location.pathname)` kullandığı için derinlik-2 alt-kitaplarda da otomatik doğru çalışıyor | `sub-book-dirs.test.js` (10, gerçek Tudem verisiyle) + `book-android-shim.test.js`/`set-book-home-button.test.js`/`empp-android-shim-vfs-key.test.js`'e eklenen K8 testleri | `tudem_test.apk` (Bloktest_Okuma_Yazma_2023.iso) |
| K9 | Pardus/.impark: PRACTICE BOOK "Kitap Güncelleniyor %10"da takılıyor, book3 loader'da takılıyor | Konsol `ENOENT book1/assets/56385/update.zip not found in .../app.asar` (createWriteStream), `ENOENT book3/temp/data/storage.im not found in .../app.asar`; `~/.config/<app>/work/` hiç oluşmuyor | `empp-fs-shim.js` yalnız KÖK `index.html`'e enjekte ediliyordu — Electron renderer'da alt-kitap sayfasının `__dirname`'i KENDİ dizini olduğu için shim hiç devreye girmiyordu, yazmalar salt-okunur asar'a gidiyordu | yeni `fs-shim-subbook-inject.js` `injectFsShimIntoSubBooks()` — shim TEK kopya kökte kalır, her alt-kitaba GÖRELİ `<script src>` (`../`, `../../`) + `window.__emppSubBook` enjekte edilir; `fs-shim.js` `install()` bunu okuyup WORK'u önekler (K6 sınıfı çapraz-kitap çarpışmasını önler) | `fs-shim-subbook-inject.test.js` (8) + `fs-shim.test.js`'e eklenen K9 testleri (5) | Pardus: `.../scratchpad/apk-test/pardus/` (kayıt); macOS: 3011'de `.app` üretildi (dmg-set-test ajanı test edecek) |
| K9b | tudem-apk-batch (13 ISO, port 3001): 27 fasikülden yalnız kök+1'i `empp-android-shim.js` DOSYASI aldı, HİÇBİR `index.html` script tag'i almadı | Kaynak ISO chmod'suz çıkarılmış → tüm `index.html` 0400 salt-okunur; `normalizeBookViewerViewports` döngüsündeki html/bundle yazma adımı KENDİ try/catch'ine sahip DEĞİLDİ → 1. alt-kitapta EACCES for döngüsünün DIŞINDAKİ genel catch'e kaçıp TÜM kalan alt-kitapları hiç işlemeden bırakıyordu (domino) | html/bundle enjeksiyonu artık kendi `try/catch(htmlErr)`'inde — bir kitabın izin/ENOENT hatası SADECE o kitabı atlar, diğerleri normal işlenir; ayrıca kaynak ISO'lar chmod'lanmalı (üretim tarafı sorumluluğu, kod bunu artık tolere ediyor) | `book-android-shim.test.js`: `GERİLEME: bir alt-kitabın index.html'i yazılamazsa DİĞER alt-kitaplar da atlanır (domino etkisi)` + kaynak-sentinel | repro (`/tmp/repro-eacces`, book2 0400) → düzeltme sonrası book1/book3 normal, book2 atlanır, domino YOK |
| K9c | coordinator K10 (gerçek 3001, kanıtlı): Bloktest.apk 2/28, Renkli-Dünyalar.apk 2/14 — K9b'nin domino düzeltmesi TEK BAŞINA yetmiyordu çünkü GERÇEK ISO'da (chmod'suz) TÜM alt-kitaplar 0400 — K9b her birini TEK TEK atlıyordu (domino yok ama 0 başarı) | Kök neden: çalışma kopyasının (`workingPath`) kendisi salt-okunur — hiçbir enjeksiyon adımı buna karşı korumalı değildi; operatörün/upload akışının chmod'u UNUTMASI = sessiz eksik paket | Yeni `ensure-writable.js` `ensureWritableTree(workingPath)` — `fs.copy(buildPath, workingPath)`'ten HEMEN SONRA, TÜM enjeksiyon adımlarından ÖNCE çağrılır; çalışma kopyasını sahibine yazılabilir yapar, orijinal upload'a DOKUNMAZ | `ensure-writable.test.js` (7, gerçek Bloktest ISO fixture'ıyla) + `book-android-shim.test.js`/`fs-shim-subbook-inject.test.js`'e 8-alt-kitap TAM SAYI testleri | gerçek ISO ağacı (`bsdtar`, chmod YOK) → `ensureWritableTree` sonrası 27/27 tag (önce 0/27) |
| K9d | K9c ile AYNI tarama sırasında bulundu: `fs-shim-subbook-inject.js`'in for döngüsü HİÇ try/catch'siz — Electron/Pardus tarafında AYNI domino riski (henüz gerçek olayla kanıtlanmadı, ama kod deseni birebir aynı) | `injectFsShimIntoSubBooks` bir alt-kitabın EACCES/ENOENT'inde TÜM fonksiyonu (results dizisi dahil) çağırana fırlatıyordu | Döngü içine per-alt-kitap `try/catch(bookErr)` + `action:'error'` sonucu eklendi; `packagingService.js` bunu loglar | `fs-shim-subbook-inject.test.js`: `(g)` 8-alt-kitap TAM SAYI + `GERİLEME:` domino testi + kaynak-sentinel | repro (4 sahte alt-kitap, book1 0400) → book2/3/4 etkilenmedi |
| K11 | `/api/download` ham `filename="${ad}"` Türkçe ı/İ/ğ/Ğ/ş/Ş'de `ERR_INVALID_CHAR` fırlatıp 500 veriyordu (build başarılı, dosya sağlam) | `UcanBalık60+_2023.iso`'dan üretilen APK — Node header doğrulaması Latin-1 dışı karakteri kabul etmiyor | `src/server/content-disposition.js` `buildContentDisposition()` — RFC 5987 ASCII fallback + `filename*=UTF-8''` | `content-disposition.test.js` | tudem-apk-batch raporu |
| K11b | item-3 denetimi (2026-09-09, coordinator): `/api/download` DIŞINDA `localPackagingRoutes.js`'te İKİNCİ bir `res.download()` çağrısı bulundu — K11 düzeltmesi bunu KAPSAMIYORDU | Bu route `app.js`'in kendi `/api/download` route'u tarafından GÖLGELENİR (aynı path, Express İLK eşleşeni çalıştırır) — pratikte ölü kod, ama routing sırası değişirse K11 kusuru SESSİZCE geri gelirdi | `localPackagingRoutes.js` `/download/:jobId/:platform` artık `buildContentDisposition` + `res.sendFile` kullanır, ham `res.download` YOK | `localPackagingRoutes.test.js` (izole Express app, gerçek HTTP isteği) | — (gölgeli route, canlıda tetiklenmiyor — kod hijyeni) |
| K12 | Her `normalizeBookViewerViewports`/`ensureSetBookHomeButton`/`injectFsShimIntoSubBooks` çağrısı kısmi hatada (K9b/K9c/K9d sonrası) TEK SATIR `console.warn` yazıyordu — "27 kitaptan 5'i eksik" TOPLAMI hiçbir yerde YOKTU | Operatör log akışında 5 ayrı satırı "hepsi normal" gibi okuyabiliyordu — TOPLAM/ORAN sinyali yoktu | Üç enjeksiyon noktasına da (bkz. `packagingService.js` ilgili fonksiyonlar) döngü SONUNDA `⚠️ ... enjeksiyonu: X/Y — Z hata: <kitap1>, <kitap2>` (hatalıysa) / `✅ ... : X/Y tamam` (hatasızsa) özet log'u eklendi | `book-android-shim.test.js` `GERİLEME (K12)` + "özet TAMAM" testi | — (yalnız loglama, davranış değişmedi) |
| K13 | `packagingService.js` singleton require-cache'te — canlı süreç (systemd/pm2/launchd) kod dosyaya yazılsa da RESTART edilmeden yeni kodu GÖRMEZ; hangi commit'in koştuğunu kanıtlamanın tek yolu yoktu | "deploy ettim ama davranış değişmedi" şüphesi (srv21 servis haritası, CLAUDE.md) | `src/server/git-commit.js` `getGitCommit()` — `/api/health` yanıtına `commit` (kısa hash, süreç başında BİR KEZ okunur, git yoksa `"bilinmiyor"`) + `startedAt` (ISO zaman) eklendi | `git-commit.test.js` (gerçek `git rev-parse` ile karşılaştırma + repo-olmayan dizin + kaynak-sentinel) | tek `curl /api/health` |
| K14 | Bu Mac'te `~/.gradle/gradle.properties` YOKTU (Gradle varsayılan heap) — büyük bir kitabın Android build'i OOM/gradle-daemon-disconnect ile çöktü | Capacitor 7 Android build'i (resource merge/dexing) yeterli heap olmadan büyük asset ağacında bellek taşırıyor | `src/packaging/android-preflight.js` `checkAndroidGradleHeapPreflight()` — `runGradleBuild()` başında çağrılır, dosyayı DEĞİŞTİRMEZ, Xmx<6g veya dosya yoksa `console.warn` | `android-preflight.test.js` (3 senaryo: dosya yok / 3g / 8g + kaynak-sentinel) | — (yalnız uyarı, build engellenmiyor) |
| K15 | coordinator bulgusu (srv21, gerçek 3001): 4 test (3 chmod-tabanlı domino + 1 graveyard NEDEN.md kontrolü) root altında (empp-packager systemd root çalışıyor) VE `_graveyard/` git'te izlenmediği için FAIL veriyordu — Mac'te 210/210 yeşildi | root için dosya izin bitleri (0400 dahil) yazmayı ENGELLEMEZ → EACCES hiç oluşmaz, "izin engellendi" varsayımına dayanan assertion YANLIŞ çıkar (test varsayımı geçersiz, kod hatası DEĞİL); `_graveyard` bir Librarian arşivi, git-izlenmiyor, taşınmayan makinede yok | `book-android-shim.test.js` / `fs-shim-subbook-inject.test.js` / `set-book-home-button.test.js`'teki 3 domino testi `process.getuid?.() === 0` iken `t.skip(...)`; `set-app-config-kasitli-yok.test.js`'teki graveyard testi `_graveyard/...` dizini yoksa `t.skip(...)` | testlerin kendisi (skip dalı da assert edilir: Mac'te hâlâ GERÇEKTEN çalışır, 0 skip) | Mac (uid≠0, `_graveyard` var): 0 skip; srv21 (uid=0): 4 skip beklenir |
| K16 | (davranış değişikliği YOK, sadece kayıt) Tudem 13 ISO batch'te kuyruk ardı ardına dolu kaldığı için `checkAndCleanIfQueueEmpty` (temp toplu temizliği) ÇOK SEYREK tetiklendi, disk 29.8 GB'a indi, AYRI bir disk guard (agent runner tarafında) devreye girdi | Temizlik TASARIM OLARAK yalnız kuyruk TAMAMEN boşken çalışır — indirilmemiş tamamlanmış iş çıktısını (`temp/<job>/macos`) erken silmemek için (2026-08-27 dersi, aksi halde `/api/download` 404) | `src/services/queueService.js` `checkAndCleanIfQueueEmpty` üstüne KNOW-HOW yorumu eklendi; kod DEĞİŞMEDİ — "indirme tamamlandıktan sonra da (kuyruk dolu olsa bile) temizlenebilir" davranışı Nadir'in kararına bağlı, henüz UYGULANMADI | `queueService.test.js`'teki var olan sentinel (`protectedIds` + "toptan boşaltılmaz") zaten bu davranışı kilitliyor — yeni test yok (davranış değişmedi) | — (yalnız gözlem/kayıt) |

Not (K9, 2026-09-09 — "eski Tudem .impark'lar neden hâlâ çalışıyor?"): K9
düzeltmesinden ÖNCE üretilmiş .impark'lar (Pardus) yeniden üretilmeden de
çalışmaya devam etti — çünkü K9'un kök nedeni (Electron renderer'da alt-kitap
sayfasının `__dirname`'i KENDİ dizini olduğu için fs-shim'in devreye
girmemesi) yalnız alt-kitap İÇERİĞİ GERÇEKTEN diske YAZMAYA çalıştığında
(update.zip indirme, storage.im kalıcılık) ortaya çıkar. Bir alt-kitap salt
okunan statik içerikse (hiç `fs.writeFile`/`createWriteStream` çağırmıyorsa)
shim'in eksikliği hiç fark edilmez — sessizce "çalışıyor" görünür. Bu yüzden
K9 kanıtı APK/impark üretiminde DEĞİL, belirli bir kullanım anında (kitap
güncelleme, storage.im yazma) ortaya çıktı; "eski paket bozulmadı" onu "kod
doğruydu" saymak İÇİN kanıt DEĞİLDİR — yalnızca o paketin o ana kadar hiç
yazma denemediğini gösterir.

Not (K3'ten önce, 2026-08-28): `installSyncXhr()` (`empp-android-shim.js`) —
CapacitorHttp'nin senkron XHR'de `status 0` döndürmesi (pages2x 404 karışıklığı)
K1-K7 numaralamasından önce düzeltilmişti; aynı dosyada NEDEN/BELİRTİ/KANIT/BOZARSAN
formatında yorumlanmıştır, `empp-android-shim.test.js` içinde iki testle korunur.

## Yeni platform/adım eklerken kontrol listesi

Yeni bir platform (örn. iOS) veya paketleme adımı eklerken SET'e özgü şu
sorulara TEK TEK cevap ver — hiçbiri "otomatik gelir" değildir:

1. **Alt-kitaplara da mı uygulanmalı?** Kök için yazdığın kod alt-kitapları
   GÖRMEZ (ayrı dizin, ayrı döngü). SET kontrolü AD DESENİ değil, motor imzası:
   `findSubBookDirs(rootPath, { maxDepth: 2 })` (`src/packaging/sub-book-dirs.js`)
   — Tudem ISO'ları SET'i `book1/` değil `fasikuller-01/` gibi adlarla kurar (K8),
   ad deseni varsayımı (`^book\d+$`) bu klasörleri HİÇ görmez.
2. **Shim gerekiyor mu?** Yalnız WebView tabanlı platformlar (Android/Capacitor)
   Node-uyumluluk shim'ine ihtiyaç duyar. Gerçek Node çalıştıran platformlar
   (Electron/masaüstü) `platforms/common/fs-shim.js` kullanır, bookN sorunu YOK
   (gerçek `fs`, gerçek `__dirname`) — ama YİNE DE doğrula, varsayma.
3. **Manifest (readdir simülasyonu) gerekiyor mu?** WebView'de gerçek `fs.readdir`
   yok; `buildAndroidManifest()` her kök İÇİN AYRI çağrılmalı (kopya kod yazma,
   var olan fonksiyonu bookDir ile çağır).
4. **VFS ad-alanı bookN'e göre mi?** localStorage/VFS tabanlı bir kalıcılık
   katmanı ekliyorsan, aynı origin'i paylaşan bookN'ler arasında anahtar
   çarpışmasını (K6/K6b) DÜŞÜN — mutlak yol dahil.
5. **setBook/bookModule karışmasın:** `setBook.enable` = kitap İÇİNDEN köke
   dönüş butonu (yalnız bookN'de anlamlı). `bookModule.enable` = tek-kitap DLL
   aktivasyon akışı (SET kökünde YANLIŞ varsayımla true bırakılırsa çöker, K1
   dersi). İkisini birbirine karıştıran bir "düzeltme" yazma.
6. **Paketleyici SET içeriği/konfig ÜRETMEZ (K1 kararı):** build klasöründe ne
   varsa AYNEN paketlenir. Eksik `app.config.js`, eksik menü, eksik logo —
   hiçbiri paketleyici tarafından "tamamlanmaz". `set-app-config-kasitli-yok.test.js`
   bunu kilitler.
7. **Test:** yeni davranış `GERİLEME:` önekli bir regresyon testiyle korunmalı
   (mutasyon kanıtı: kodu bilerek boz, testin kırıldığını gör, geri al). `npm run
   test:set` ile hızlı doğrula, sonra tam suite (`npm test`).
8. **Gerçek APK/proof ile kanıtla:** port 3011 (asla 3001), gerçek bookN'li bir
   SET kaynağı (59480 gibi), extraction+grep ile değişikliğin ARTEFAKTA girdiğini
   doğrula — "kod doğru görünüyor" kanıt DEĞİLDİR.

## Doğrulama

Kod değişikliğinin GERÇEKTEN artefakta girdiğini kanıtlamanın iki yolu — birini
"kod doğru görünüyor" ile atlama.

### Telefon (Android) test tarifi

1. APK'yı telefona kur (`adb install -r <apk>`), uygulamayı aç.
2. Chrome DevTools köprüsü: `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`
   (`<pid>` = `adb shell ps | grep <appPackage>`).
3. `cdp-eval.mjs` (veya benzeri bir CDP script) ile `http://localhost:9333/json`
   üzerinden WebView hedefini bul, `Runtime.evaluate` ile tıklama/gezinme simüle et.
4. **Dikkat:** "ana sayfa" düğmesi bazı yayıncı index tasarımlarında (örn. 59480)
   411 CSS-px yükseklikte, araç çubuğunun görünür alanı DIŞINDA kalabilir
   (`y=418` gibi) — fiziksel dokunuşla ulaşılamaz, ekran gerçek boyutuyla
   render edilmiş bir tablet/tahtada sorun olmaz. Bu durumda CDP `Input.dispatchMouseEvent`
   ile koordinat bazlı tıklama kullan (telefon boyutunda insan dokunuşu ulaşamıyor
   diye "buton yok" sanılmasın).
5. logcat: `adb logcat | grep -E "process is not defined|404|ERR_HTTP"` — shim/VFS
   kusurlarının hepsi burada iz bırakır.
6. Temiz kurulum kanıtı gerekiyorsa `localStorage.clear()` (CDP `Runtime.evaluate`)
   + reload — K6 gibi "eski localStorage state gizliyor" sınıfı kusurlar yalnız
   temiz kurulumda görünür.

### Electron (masaüstü) test tarifi

1. **`ELECTRON_RUN_AS_NODE` tuzağı:** VS Code'un entegre terminalinden (veya
   herhangi bir Electron alt-süreç ortamından) `.app`/paket başlatılırsa,
   ortamdan miras kalan `ELECTRON_RUN_AS_NODE=1` Electron'u SADECE Node modunda
   çalıştırır — pencere hiç açılmaz, "çalışmadı" sanılır. Bu değişkeni KALDIRIP
   çalıştır: `env -u ELECTRON_RUN_AS_NODE '<app>.app/Contents/MacOS/<binary>'`.
2. **CDP köprüsü:** aynı komuta `--remote-debugging-port=9333` ekle, sonra
   `http://localhost:9333/json` üzerinden hedefi bul (Android'deki `cdp-eval.mjs`
   akışıyla AYNI mantık — `Runtime.evaluate` ile DOM/tıklama simülasyonu, konsol
   hatalarını (`process is not defined`, `ENOENT ... app.asar`) doğrudan oku).
3. **DMG sonrası `.app` boşalması:** macOS bazı DMG mount/kopyalama akışlarında
   `.app` paketini (Gatekeeper/quarantine ilk-açılış taraması, ya da yarım kalan
   kopya) GEÇİCİ olarak boş/erişilemez bırakabilir — test script'i "uygulama
   bozuk" sanıp erken çıkabilir. Bir izleyici döngüsü (`dmg/app-watcher.sh` —
   bu depoda DEĞİL, test ortamının kendi scratchpad'inde tutulan yardımcı
   script; DMG mount edildikten sonra `.app` ağacının dosya sayısının
   STABİLLEŞMESİNİ bekler) kullanılmadan hemen CDP bağlanmaya çalışmak yanlış
   negatif üretir. Kural: DMG'den hemen sonra sabit bir `sleep` yerine
   `.app` içeriğinin (`find <app>/Contents -type f | wc -l`) art arda İKİ
   ölçümde AYNI sayıyı vermesini bekle, sonra CDP'ye bağlan.

## Tek örnek kuralı (launchd + elle çalıştırma)

`src/agent/runner.js` (pull-mode build agent) ATOMİK bir kira (lease) alır —
ama bu, İKİ FARKLI süreçten YANLIŞLIKLA aynı anda başlatılmayı GÜVENLİ hâle
getirmez, sadece ikinci sürecin işi ÇALMASINI engeller. **İki packager süreci
AYNI ANDA çalışıyor OLMAMALI** (kaynak-cache/temp/output aynı dizinlere yazar,
kira yarışı normalin dışında bir gecikme/log gürültüsü üretir). Kural: launchd
`com.empp.agent` unit'i YÜKLÜYKEN elle `run-agent.sh`/`node src/agent/runner.js`
başlatma. Kontrol:

```bash
launchctl print gui/$UID/com.empp.agent   # "state = running" ise launchd ZATEN ayakta
```

Yüklüyse ve elle de başlatman gerekiyorsa ÖNCE `launchctl bootout gui/$UID/com.empp.agent`
ile launchd kopyasını durdur, işin bitince tekrar `bootstrap` et — ikisini
birden AÇIK bırakma. (Not: `src/agent/runner.js`/`runner-helpers.js` bu depoda
başka bir oturumun bitmemiş işi olduğu için burada koda dokunulmadı — bu madde
SADECE operasyonel/doc kuralıdır.)

## Üretim sonrası doğrulama (Android APK)

Paketleyici APK build'ini bitirdikten SONRA paket adı/sürüm/etiketin doğru
olduğunu OTOMATİK doğrulayan bir adım YOK (kod tarafında eklenmedi — Tudem 13
ISO batch'te bu elle yapıldı). Elle doğrulama komutları:

```bash
AAPT="$ANDROID_HOME/build-tools/<en-yeni-sürüm>/aapt"   # örn. 35.0.0
"$AAPT" dump badging <apk-yolu> | grep -E "package:|versionCode|versionName"
```

Kontrol edilecekler:
- `package: name='<beklenen paket adı>'` — Capacitor App ID üretimi (rakamla
  başlayan başlıkta özel dönüşüm var, bkz. commit 65cf280) doğru mu?
- `versionCode`/`versionName` — batch'te birden fazla kitap paketlenirken YANLIŞ
  kitabın sürümü/etiketi karışmasın (build klasörü karışıklığı sinyali).
- Paket adı Play Store/işletmenin beklediği ad-alanıyla eşleşiyor mu (yanlışsa
  kurulum "güncelleme" değil "farklı uygulama" olarak görünür).

Bu adım kod tarafına EKLENMEDİ (task kapsamı: yalnız doc — otomatik gate
istenirse bu ayrı bir karar/PR'dır).

## Değişen/eklenen dosyalar (K7 + K8 + K9 çalışması)

- `.claude/docs/set-paketi-know-how.md` (bu dosya)
- `.claude/CLAUDE.md` (Dikkat Edilecekler'e pointer)
- `package.json` (`test`, `test:set` script'leri)
- Yorum blokları: `src/packaging/www-copy-exclude.js`, `src/packaging/packagingService.js`
  (`buildAndroidManifest`, `normalizeBookViewerViewports`), `src/packaging/set-book-home-button.js`,
  `src/platforms/android/empp-android-shim.js` (`joinOriginAware`, `pageBaseDir`/`key`, `installSyncXhr`)
- Test adı yeniden adlandırma (`GERİLEME:` öneki): `www-copy-exclude.test.js`,
  `book-android-shim.test.js`, `empp-android-shim-path.test.js`,
  `set-book-home-button.test.js`, `empp-android-shim-vfs-key.test.js` (×2)
- Yeni test: `src/packaging/set-app-config-kasitli-yok.test.js` (K1 "KASITLI YOK" sentinel, 3 test)
- **K8 (ad desenden bağımsız SET tespiti):** yeni `src/packaging/sub-book-dirs.js`
  (`findSubBookDirs`) + `src/packaging/sub-book-dirs.test.js` (10 test, gerçek Tudem
  ISO verisiyle); `packagingService.js` (`normalizeBookViewerViewports`) ve
  `set-book-home-button.js` (`ensureSetBookHomeButton`) artık `^book\d*$` yerine
  bunu kullanır; `book-android-shim.test.js`, `set-book-home-button.test.js`,
  `empp-android-shim-vfs-key.test.js`'e Tudem-tarzı/derinlik-2 testleri eklendi.
- **K9 (Pardus/.impark fs-shim alt-kitap eksikliği):** yeni `src/packaging/fs-shim-subbook-inject.js`
  (`injectFsShimIntoSubBooks`) + `fs-shim-subbook-inject.test.js` (8 test);
  `packagingService.js` `prepareElectronFiles` kök shim enjeksiyonundan SONRA bunu
  çağırır; `src/platforms/common/fs-shim.js` `install()` artık `window.__emppSubBook`
  ile WORK'u önekler (5 yeni test `fs-shim.test.js`'te). Not (düzeltme YOK, sadece
  rapor): alt-kitapta `kurum.txt` ENOENT (kökte `SET_BOOK.txt` var, kitapta
  `kurum.txt` yok) — build aynen paketlendiği için bu beklenen bir durum, dokunulmadı;
  `GetPackageBooks?id=undefined` de paketleyici kapsamı dışı, dokunulmadı.
- **K9b (domino düzeltmesi, tudem-apk-batch bulgusu):** `packagingService.js`
  `normalizeBookViewerViewports` — html/bundle enjeksiyon bloğu artık kendi
  `try/catch(htmlErr)`'inde (önceden döngü-dışı genel catch'e EACCES fırlatıp TÜM
  kalan alt-kitapları atlıyordu); `book-android-shim.test.js`'e 2 yeni test
  (`GERİLEME:` domino testi + kaynak-sentinel).
- **K9c (kök neden — coordinator K10 kanıtı):** yeni `src/packaging/ensure-writable.js`
  (`ensureWritableTree`) + `ensure-writable.test.js` (7 test, gerçek Bloktest ISO
  fixture'ıyla); `packagingService.js` `startPackaging` — `fs.copy(buildPath,
  workingPath)`'ten HEMEN SONRA çağrılır. `book-android-shim.test.js` +
  `fs-shim-subbook-inject.test.js`'e 8-alt-kitap TAM SAYI (`≥1` değil) testleri
  eklendi — izole 2-dizinli testler gerçek 14-28 dizinli ISO'daki "yalnız ilk
  dizin" kusurunu YAKALAMIYORDU (kaynak-tarayan-test-tuzağı sınıfı).
- **K9d (aynı tarama, aynı desen):** `fs-shim-subbook-inject.js`'in for döngüsü
  HİÇ try/catch'siz idi (Electron/Pardus tarafında K9b'yle AYNI domino riski) —
  per-alt-kitap `try/catch(bookErr)` + `action:'error'` eklendi;
  `fs-shim-subbook-inject.test.js`'e 3 yeni test.
- `package.json` `test:set`'e `ensure-writable.test.js` eklendi.
- **K11b (item-3 denetimi, ikinci `res.download`):** `src/server/localPackagingRoutes.js`
  `/download/:jobId/:platform` artık `buildContentDisposition` + `res.sendFile`
  kullanır; yeni `src/server/localPackagingRoutes.test.js` (izole Express app +
  gerçek HTTP isteği + kaynak-sentinel, 2 test).
- **K12 (sessiz kısmi hata sayımı):** `packagingService.js` — `normalizeBookViewerViewports`,
  `ensureSetBookHomeButton` çağrı bloğu, `injectFsShimIntoSubBooks` çağrı bloğu;
  üçüne de döngü sonunda X/Y — Z hata özet log'u eklendi; `book-android-shim.test.js`'e
  2 yeni test (`GERİLEME (K12)` + "özet TAMAM").
- **K13 (canlı süreç commit kanıtı):** yeni `src/server/git-commit.js` (`getGitCommit`)
  + `git-commit.test.js` (4 test); `app.js` `/api/health` artık `commit`+`startedAt` döner.
- **K14 (Android Gradle heap ön-kontrolü):** yeni `src/packaging/android-preflight.js`
  (`checkAndroidGradleHeapPreflight`) + `android-preflight.test.js` (5 test, 3
  senaryo + kaynak-sentinel); `packagingService.js` `runGradleBuild` başında çağrılır;
  `package.json` `test:set`'e eklendi. Dosyaya DOKUNMAZ, sadece uyarır.
- **K15 (root/uid + git-izlenmeyen dizin test sertleştirme, coordinator srv21 bulgusu):**
  `book-android-shim.test.js` / `fs-shim-subbook-inject.test.js` / `set-book-home-button.test.js`
  içindeki 3 domino testi + `set-app-config-kasitli-yok.test.js` içindeki graveyard
  testi artık `process.getuid?.() === 0` / `_graveyard` dizini eksikse `t.skip(...)`
  ile atlanır (Mac'te hâlâ 0 skip ile gerçekten çalışır).
- **K16 (temp temizliği — davranış KAYDI, kod DEĞİŞMEDİ):** `src/services/queueService.js`
  `checkAndCleanIfQueueEmpty` üstüne KNOW-HOW yorumu eklendi (Tudem batch'te disk
  29.8 GB'a indi — ayrı disk guard `runner.js`'de, bu oturumda dokunulmadı).
- **item-10/12 (doc-only, kod eklenmedi):** "Tek örnek kuralı" (launchd `com.empp.agent`
  vs elle `run-agent.sh`) ve "Üretim sonrası doğrulama" (`aapt dump badging`) bölümleri
  eklendi — Nadir kararı/kapsam dışı otomasyon, yalnız operasyonel doc.
- Yeni `.claude/docs/deploy.md` (srv21 dağıtım kuralları, item-11).

## K17 — SET kökünde menü yok → paket beyaz ekran (2026-09-17, Pardus'ta ölçüldü)

**Belirti (Nadir, sf425 `.impark`, ProBook/ETAP):** zenity geçiyor, kurulum bitiyor,
uygulama açılıyor ama sonsuz "…" (beyaz ekran). `~/DijiTap/DijiTap/<Set>/resources/app/build`
klasörü BOŞ görünüyor.

**Boş `build/` SAHTE İZ:** AppRun her kurulumda `mkdir -p "$appPath/resources/app/build"`
yapar ve doldurmaz; içerik `resources/app.asar` içindedir. ProBook'ta ÇALIŞAN kurulumlarda
(Lingoland 2/3/4, YDT Privilege) da aynı boş klasör vardır. Arıza göstergesi DEĞİLDİR.

**Gerçek kök neden (konsol kanıtı):**
```
Error: ENOENT, assets not found in .../app.asar
Uncaught (in promise) Error: ImWin32.dll dosyası okunamadı.
```
Yayıncının otomatik exe'sinden çıkan SET build'inin KÖKÜ, motorun tek-kitap
`index.html`'inin kopyasıdır (`<hash>.main.js`); kökte `assets/` ve `classlibraries/`
yoktur (içerik `book1..bookN` altındadır). Motor bundle'ında set modu YOKTUR
(`set_app.config`/`setBook` string'i hiç geçmez) → kök sayfa MUTLAKA bir set menüsü
olmalıdır. Çalışan tek örnek (Flashy Grade 8, 59480) kökünde elle yazılmış menü +
`assets2/` görselleri taşır. Aynı hata Super Monsters 2 Set'te de üretildi.

**Kapsam ölçümü (CDN'deki APK'ların zip merkezi dizini menzil isteğiyle okundu):**
alt-kitabı olan ve kök index'i motor kopyası olan **14 set** kırık —
45481, 45482, 45538, 45541, 45549, 45550, 45551, 45695, 45704, 45792, 59834, 59835,
73581, 73768. Aynı kaynak build apk/dmg/impark'ın üçüne de gittiği için üç platform da etkilidir.
(Ölçüm aracı: `scratchpad/.../apk-yapi.py`; TUZAK: CDN bazen 206 yerine 200 + tüm gövdeyi
döndürüyor → menzil yanıtı 206 değilse yeniden denenmeli, yoksa "giriş yok" yanlış sonucu çıkar.)

**Düzeltme:** `src/packaging/set-menu.js` `ensureSetMenu()` — SET kökünde menü YOKSA üretir
(`packagingService.js`, `ensureSetBookHomeButton`'dan sonra, `prepareElectronFiles`'tan önce).
- Kökte ÖZEL menü varsa dokunmaz (59480 korunur), orijinal motor sayfası
  `index-motor.yedek.html` olarak saklanır (silme yok), idempotenttir.
- `assets2/` varsa yayıncının kendi tasarımı (buton+kapak+styles.css), yoksa sade menü:
  kapak = `bookN/assets/<id>/thumbs/1.jpg`, etiket = verilen ad ya da "Kitap N".
- `app.config.js` ÜRETMEZ — K1 yasağı (konfig üretimi) yerinde durur.
- Kapı: `EMPP_SET_MENU=1`. Varsayılan KAPALI; **pardus yolunda açık**
  (`tools/pardus/pardus-packager-build.sh` `EMPP_SET_MENU=${EMPP_SET_MENU:-1}`).
  Android/macOS için açmak Nadir kararı + paketleyici yeniden başlatma ister (K13).
- Testler: `set-menu.test.js` (8) — kapı kapalıyken hiç dosya değişmez, motor kopyası
  menüye döner + yedek, assets2 modu, özel menü korunur, idempotent, tek kitapta no-op,
  GERİLEME (motor imzası), kapaksız kitap.

**Saha kanıtı (ProBook, 2026-09-17 12:00):** kurulu sf425'in asar'ı `resources/app`'e açılıp
üretilen menü konuldu (`app.asar` → `app.asar.yedek`) → menü 4 kitabı gerçek kapaklarıyla
listeledi, ilk kitap açıldı (1/192 sayfa, araç çubuğu, ana sayfa düğmesi).

**Paralel üretim:** `PARDUS_PARALEL=1` kilidi ve "çalışan konteyner" kapısını atlar
(varsayılan davranış = tek build, değişmedi). Disk kapısı (20 GB) yerinde — Mac'te boş alan
darsa paralel build başlatma.

Son Güncelleme: 2026-09-17 (K17 — SET kök menüsü) · önceki: 2026-09-09 (K11b-K16 — item-1..13 denetimi: 2. res.download,
kısmi-hata özet sayımı, /api/health commit/startedAt, Android Gradle heap
ön-kontrolü, root/uid + git-izlenmeyen-dizin test sertleştirme (coordinator),
temp temizliği KNOW-HOW kaydı, tek-örnek/üretim-sonrası-doğrulama doc maddeleri,
srv21 deploy.md)

---

## K21 — Açılış ağ politikası (2026-09-19, sm4/book1'de ölçüldü)

**Belirti değil, israf:** 3 nokta ekranı (logo'dan ÖNCEKİ yükleme ekranı) 1048–1104 ms
sürüyor ve bunun ~950 ms'i AĞ beklemesi. Aynı paket ağ kapalıyken **318 ms**'de ve
BİREBİR aynı ekranla açılıyor.

Ölçülen zincir (hepsi sıralı await; `ab436b32….main.js` tek async fonksiyon):

| ms | Uç | Gerçek yanıt |
|---|---|---|
| 101→603 (502) | `https://www.sorucoz.tv` HEAD | canlılık probu |
| 615→726 (111) | `GetPackageBooks?id=undefined` | **HTTP 500** (ASP.NET null parametre) |
| 727→841 (114) | `HasZKitapKey?kitapId=45516` | `{"Success":false,"Message":"ZKitap key içermiyor."}` |
| 844→1097 (253) | `https://www.sorucoz.tv` HEAD | İKİNCİ prob |
| 927→1051 (124) | `GetKitapGuncellemeBilgi` | `{"Success":true,"Vs":9}` — güncelleme yok |
| 1061→1170 | `GetBookSeriesZKitapLogoUrl` | `{"status":false,"…bulunamadı"}` |
| 1171→1284 | `IsZKitapKurumAktif` | `{"Success":true,"Kitap kullanılabilir."}` |

**11 kitapta çapraz doğrulama** (mp11, sw5, sw7, sw8, sm4): `HasZKitapKey` → **11/11
"ZKitap key içermiyor"**; `IsZKitapKurumAktif` → **11/11 "kullanılabilir"**.

### İki çağrı yolu — görünen kapı YANILTIYOR
`if (AppConfig.xml.isWeb || window.isApp)` masaüstünde İKİSİ DE false, ama istek yine
gidiyor. Gerçek yol `bookModule.enable` dalıdır: ImWin32.dll çözülür, her cover için
`getFilePath(xmlSource → imKeys.dll)` **diske** bakılır; dosya varsa ağ çağrısı YOK,
yoksa `hasZKitapKeyUrl` çağrılır. Bundle'da "HasZKitapKey" dizgisini aramak bu yolu
KAÇIRIR (URL `l.bV.hasZKitapKeyUrl` değişkeninden gelir) — özellik adıyla ara.

### Ne yapıldı (kapı `EMPP_AG_POLITIKASI`, varsayılan AÇIK)
- `src/platforms/common/ag-politikasi.js` — çalışma anı, `window.fetch` sarmalı.
  Motorun paketlenmiş kodu DEĞİŞMEZ (K16 dersi: bundle 20-hex hash'li, regex yaması
  sessiz NO-OP üretir). Saf `kararVer(url)` → `gecir | engelle | zamanasimi`.
- `src/packaging/ag-politikasi-yamasi.js` — dosyayı kök'e kopyalar, kök + `bookN/`
  index.html'lerine `<head>`in başına enjekte eder. Alt-kitaba KOPYALANMAZ, göreli
  src verilir (K9 dersi). Yazma atomik.

**Kesilen iki tartışmasız israf:**
1. Sorgusunda `undefined`/`null` **DEĞERİ** olan istek engellenir. Sunucu determinist
   HTTP 500 + HTML döner; motor zaten `.json()`'da patlayıp catch'e düşüyor — 111 ms
   erken düşürülür, davranış aynı. (Parametre ADI ya da alt-dizgi tetiklemez.)
2. Çıplak köke atılan canlılık probuna **5000 ms** zaman aşımı. Motorun kendi kodu
   `fetch(url,{method:"HEAD",mode:"no-cors",timeout:5e3})` yazıyor ama **`timeout`
   fetch'te bir seçenek DEĞİL**, sessizce yok sayılıyor. Karadelik ağda (okul filtresi,
   kopuk VPN) açılış işletim sistemi TCP zaman aşımına kadar asılır. Yeni politika
   değil — yazılmış ama hiç çalışmamış niyetin infazı. Çağıran kendi `signal`ini
   verdiyse DOKUNULMAZ.

**Ürün uçlarına dokunulmaz:** `HasZKitapKey`, `IsZKitapKurumAktif`,
`GetKitapGuncellemeBilgi` ölçüm değil, Nadir kararıdır.

Testler: `ag-politikasi.test.js` (17) + `ag-politikasi-yamasi.test.js` (10), 8/8 mutant
öldürüldü. sm4'te ölçülen: 1048 ms → 897/1018 ms, uzak istek 7 → 6.

### Yan bulgular (kalıcı, ileride lazım)
- **`IsZKitapKurumAktif` bir RENDER KAPISI:** sonucu `bookContent.isAvailable`'a gider;
  `false` ise kitap yerine "kullanılamaz" ekranı çizilir. Ertelenirse kitap açılır,
  sonra kapanır.
- **`HasZKitapKey` fail-open:** hata/çevrimdışı → `activation=false` → kitap key
  sormadan açılır. Ertelemek var olan davranışla AYNI sonucu verir.
- **Ölü dal:** kurum-aktif önbelleğini yazan `unavailable_<zKitapId>`, okuyan bare
  `unavailable` → çevrimdışı önbellek hiç tüketilmiyor.
- **sorucoz.tv Cloudflare managed challenge arkasında:** düz `curl` 403 "Just a moment"
  alır, Electron'un TLS parmak izi geçer. Uçları Electron İÇİNDEN yokla.
