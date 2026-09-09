# SET paketi know-how (K1-K9, 2026-09-09)

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

## K1-K9 tablosu

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

## Telefon test tarifi

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

Son Güncelleme: 2026-09-09 (K9c/K9d — gerçek ISO'da 0/N'e düşüren kök neden [salt-okunur çalışma kopyası] + fs-shim'in kendi domino riski kapatıldı)
