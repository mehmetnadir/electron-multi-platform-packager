[SÖZLEŞME: TASLAK]
<!-- ONAYLI'ya yalnız Nadir geçirir. TASLAK iken bloklama yok, sadece hatırlatma. -->

# electron-multi-platform-packager — Proje Sözleşmesi

> İlk taslak: 2026-09-17 (K17 oturumu). Bu oturumda öğrenilen iş/işlev bilgisi yazıldı;
> tam envanter için `.claude/docs/set-paketi-know-how.md` ve `.claude/CLAUDE.md`.

## İş

Yayıncının akıllı tahta kitap içeriğini (web build) uç kullanıcıya kurulabilir native
pakete çevirir: Windows, macOS (.dmg, imzalı/noterli), Linux/Pardus (.impark = AppImage),
Android (.apk) ve PWA. Kullanıcıları: YDS Publishing üretim hattı (Mac ajanı + srv21
servisi) ve Nadir'in elle üretim yaptığı tarayıcı arayüzü (:3001). Çözdüğü problem:
tek bir web build'den, her işletim sisteminde çift tıkla açılan, çevrimdışı çalışan,
kurum logolu paketler üretmek.

## İşlevler

| Ad | Girdi → Çıktı | Sınır | Durum |
|---|---|---|---|
| paketle (`/api/package`) | sessionId + platform listesi → paket dosyası | build içeriği AYNEN paketlenir; konfig üretilmez (K1) | canlı |
| build yükle (`/api/upload-build`) | build.zip → sessionId | — | canlı |
| logo yönetimi (`/api/logos`) | kurumId + png → logoId | ad eşlemesi Türkçe karakterde düşer (`pickLogoId`) | canlı |
| Mac ajanı (`src/agent/runner.js`) | sunucudan iş kiralar → kaynağı indirir, paketler, R2'ye yükler | tek iş/seferde; yetenekler konuma göre daralır (ofis dışında macos düşer) | canlı |
| Pardus üretimi (`tools/pardus/pardus-packager-build.sh`) | build.zip → .impark (Docker, linux/amd64) | gömülü zenity ZORUNLU (yoksa paket reddedilir); disk kapısı boyut orantılı (kaynak×5, taban 15 GB — K19, sabit 20 GB bayat); `PARDUS_PARALEL=1` ile paralel | canlı |
| srv21 üretim şeridi (`tools/agent/serit-uret.js` + srv21 `/opt/lane-hazirla.mjs`) | bookId → srv21'de hazırlık+derleme → Mac'e `.impark` | Mac ajanı yalnız kabul kapısı + R2 yüklemesi yapar; `EMPP_PARDUS_HAZIR_DIR` altındaki paket `srcVersion` eşleşirse devralınır; scp portu `-P 2222` | canlı |
| linux deb hedefi (`EMPP_LINUX_DEB`) | build → AppImage (+ istenirse deb) | `.impark` yalnız AppImage'dan türer; `EMPP_LINUX_DEB=0` deb'i kapatır (1,5 GB gövdede xz 30+ dk) | canlı |
| SET kök menüsü (`ensureSetMenu`, K17→29b8fc8) | SET build'i → kökte menü sayfası | Kabuğun tek üreticisi masaüstü Üretim Masası (`WebZTemaUretici`); `set-menu.js` artık Web-Z kabuğuna DOKUNMAZ, yalnız kabuk yoksa/kök motor kopyasıysa korur — HTML ÜRETMEZ (Faz 1 kararı, 24.09); yayıncı tasarımlı kök menüye DOKUNMAZ; `app.config.js` üretmez | canlı (kapı `EMPP_SET_MENU=1`) |
| İmpark içerik güncelleme kanalı K (`src/runtime/icerik-guncelleme.js`, Faz 2) | `update.zip` → WORK/`.empp-gecici`'de açılır, BookContent md5 ile doğrulanır, sonra WORK'e taşınır | `adm-zip` çevrimdışı pakete istisnayla girer; `file:` örtüsü WORK'ü BASE önüne koyar; açma doğrulanmadan sürüm İLERLETİLMEZ (sahte ilerletme kapalı); boyut tavanı `VARSAYILAN_TAVAN_MB=4096` (zip bombası/disk koruması); kitap başına en fazla `ESKI_BASARISIZ_TAVAN=2` başarısız açma kenarı tutulur, fazlası silinir; kanal Ş (yayıncının motor/kabuk zip'i) BİLİNÇLİ KAPALI — motor/kabuk yalnız bizim SET kanalı + player-guncelle ile gider | canlı (`EMPP_ICERIK_GUNCELLEME`), ProBook saha ölçümü geçti (57806 book2 v2→v4), 22/22 mutant |
| Motor + okuyucu kabuğu kanonikle değiştirme (`src/packaging/motor-surumu.js` + `okuyucu-kabugu.js`, Faz 3) | paket kökü → kanonik önbellekle (`~/.empp-agent/motor`, `kabuk/<sürüm>`) kıyaslanır, eskiyse değiştirilir | Eskisi ağaç DIŞINA `.empp-eski/` taşınır (silme yok); `paket.json.motorSurumu`/`kabukSurumu` yazılır; kanonik yoksa durum `bilinmiyor` (asla sahte "aynı" üretilmez); kapı `scripts/motor-kapisi.js` rc 0 ikisi de geçti · 1 motor düştü · 3 kabuk düştü · 4 ikisi de düştü · 2 kanonik bilinmiyor. Ölçüm 73768: DMG motor `ba539fb50c60`/kabuk `1.11.5` → Web-Z motor `03e8af70a0f3`/kabuk `1.13.3` | canlı (`EMPP_MOTOR_SURUMU`) |
| ProBook Pardus şeridi (`tools/probook/*` + `src/agent/serit-secimi.js`) | bookId → ProBook'ta yerli derleme (Docker'sız) + yerel kabul + R2 | ProBook BİRİNCİL, Mac docker YEDEK (nabız 10 dk yok ya da disk kapısı düşükse otomatik eşikli devir + ntfy); sıkı sıra: indir→derle→bütünlük→kur+aç(kabul)→yükle→temizle (derlemede kabul KOŞMAZ); kendi jetonu (`AGENT_ENROLL_SECRET` ayrı kayıt, sır diske yazılmaz); kabul yerel dalı + manifest-tabanlı temizlik (yalnız kendi yazdığını siler) + ortak kilit (`~/.kabul.lock` O_EXCL, 60 dk bayat); DEB kapalı (`EMPP_LINUX_DEB=0`). Ölçüm Bloktest 2,2 GB: ProBook derleme 367 sn (Mac docker 1025), kabul 51 sn | kod var, **fiilen kullanılmıyor**: `build_agents` kaydı yok (enroll sırrı srv21 `.env`'de, Nadir verir), `serit-secimi.js` runner'a bağlı değil — bugün ProBook yalnız kabul yapıyor, üretim Mac Docker'da (bkz. `platform-kanallari-sozlesmesi.md` O1) |
| ProBook kabul kapısı (`tools/pardus/probook-kabul.sh`) | üretilen .impark → gerçek Pardus makinesinde kurulur + açılır | kapı düşerse paket R2'ye YÜKLENMEZ; ölçüt pencere + piksel sapması (süreç sayısı DEĞİL) | canlı (kapı `EMPP_PARDUS_KABUL=1`) |
| Windows kabul kapısı (`tools/windows/vm-kapi.js` + `src/windows/vm-kapi-karar.js` + `tools/windows/vm-kopru-sunucu.js`) | üretilen `.exe` → VMware Win11 VM'inde kurulur, açılır, ekran görüntüsü alınır | "Geçti" = çıkış 0 **ve** ekran görüntüsü **ve** süreç ayakta; sonuç gelmezse `zaman-asimi`, izleyici ölürse `bozuk`. Parola hiçbir yerde geçmez (`vmrun` guest işlemleri kimlik ister, snapshot istemez). Taşıma HTTP: Apple Silicon + Win11 ARM'da paylaşılan klasör YOK; sunucu yalnız `bridge*` arayüzüne bağlanır, yol öneki belirteç | araç hazır — misafirde izleyici tek seferlik elle başlatılır | **Çok makineli:** her makinenin kendi kuyruğu/kalbi/işareti vardır (`--makine <ad>`, varsayılan `vm` = Fusion misafiri); `calistir <komut>` ile uzak komut koşturulur (disk ölçümü/temizliği, sürüm sorgusu).
| alt-kitap uyarlamaları (K3/K5/K6/K9) | SET build'i → her `bookN` için shim, manifest, `setBook.enable`, ad-alanlı VFS | ad deseni değil motor imzası (`index.html`+`app.config.js`) ile bulunur | canlı |
| **Başsız kabul kapısı — mac/Android/Windows/Pardus** (Nadir 2026-09-26: "bu bilgisayarda odak çalmadan bir kabul kapısı"; `tools/kabul/basliksiz-kabul.js` + `kosum/` + `src/agent/basliksiz-kabul-kapisi.js`) | üretilen paket (DMG · APK · NSIS · .impark · dizin/zip) → içeriği görünmez açılır (DMG `hdiutil -nobrowse -readonly`, 7z, unzip), kök sayfa paketin KENDİ Electron ana sürümüyle (LSUIElement kopyası, `show:false`+`offscreen`) yüklenir, menü ölçülür, ilk kitap kartına tıklanır, okuyucu ölçülür; Android'de ek olarak pencerisiz emülatörde kur/aç/ölç/kaldır → GEÇTİ(0)/RED(1)/ÖLÇÜLEMEDİ(3) + kalıcı kanıt | Odak çalmaz (kapı kendi ölçer: `lsappinfo front` önce/sonra + ayrı süreçte 300 ms örnekleme; kapı süreci öne geçerse ÖLÇÜLEMEDİ); ölçütler ProBook ile aynı (sapma ≥0,05 / koyu ≥0,005 / renk ≥500, ImageMagick ile birebir doğrulandı) + DOM: SET'te başlık okuyucu başlığı değil, menü kartı = app.config.js taşıyan bookN sayısı, N sn sonra yükleniyor göstergesi yok, kök index motor kopyası değil, okuyucu sayfa izi var; tek kitap paketinde kök motorun kitap rafıysa (MEÇ 73714, BES 74451) ilk kapağa tıklanır ve okuyucu ölçülür (rafta yalnız sapma eşiği aranmaz, kapak şart); ERR_FILE_NOT_FOUND ve JS hataları raporlanır, K17 konsol imzaları RED; mac'te codesign + stapler + spctl (noter/zımba yoksa RED); ağ varsayılan kapalı (yayıncı güncellemesi inmez), HOME sahte (ev dizini kirlenmez); `TCDD_MITM` AVD'sine dokunulmaz; emülatörde başka uygulamanın ANR diyaloğu kapatılır, örtmeye devam ederse cihaz katmanı ÖLÇÜLEMEDİ, bizim uygulamamızın ANR'si RED; RED → R2'ye YÜKLENMEZ, ÖLÇÜLEMEDİ → yükleme yok ama `failed` yazılmaz (ertelenebilir); kanıt `~/.empp-agent/kabul-kanit/<id>-<platform>-<tarih>/`. Doğuş: 26.09 SET kökü ezilmiş 73768 mac/android paketleri kabulsüz R2'ye gitti. **Ortam (Nadir 26.09):** ağır işler (derleme, başsız kabul, tam test, emülatör) makine geneli 2 slotlu semafordan geçer (`~/.empp-agent/agir.sh`, `AGIR_SLOT`); başsız kabul kendi odak-ölçümüyle pencere çalmadığını doğrular (yukarıdaki "Odak çalmaz" tanımı) | kod varsayılanı KAPALI (`EMPP_BASLIKSIZ_KABUL=1` ile açılır); **canlıda AÇIK, `macos,android`** (`~/.empp-agent/run-agent.sh`) |
| yayıncı domain yaması (K16, `src/packaging/yayinci-domain-yamasi.js`) | build içindeki metin dosyalarında `sorucoz.tv` → yayıncının kendi hostu | Host önceliği: options > `baseEndpointUrl` > `testSolutionVideo.apiTemplate`; türetilemezse NO-OP. **TÜM platformlara uygulanır** (Windows istisnası 18.09'da kaldırıldı — `updateBookEndPoint` de bu yamayla bize geliyor) | canlı |
| dil budaması (`electronLanguages`) | build → yalnız tr + en-US dil dosyası | Electron 55 dil taşıyordu (9,0 MB sıkışmış); win/mac/linux üçünde de | canlı |
| açılış yaması (`src/packaging/acilis-yamasi.js`) | yayıncı `main.js` → `show:false` + `ready-to-show` + 8 sn emniyet | ATOMİK: pencere değişkeni ya da `loadFile/loadURL` yoksa hiçbiri konmaz (yalnız `show:false` = pencere HİÇ açılmaz) | canlı |
| açılış göstergesi (K27, `src/packaging/acilis-gostergesi.js`) | tek kitaplık açılış ekranı → güvence 5000 ms → 0 ms, "Kitap Açılıyor.." metni boşaltılır | "Kitap Güncelleniyor %N" dalı KORUNUR (indirme varsa kullanıcı görmeli). İki metin sürümü de kapsanır (yüzdeli+güvenceli / yüzdesiz+güvencesiz). Çapalar dar: `window.t1`+`covers[0]` ve "Kitap Güncelleniyor" üçlüsü | **kapı varsayılan AÇIK** (`EMPP_ACILIS_GOSTERGE=0`) |
| paket kimlik manifesti (Katman 1, `src/packaging/paket-manifesti.js`) | paket kökü → `paket.json` (setId, kurum, sürüm, kitap listesi, parmak izleri) | setId dışarıdan verilirse aynen, verilmezse üretilir (`SET-<sap>-<12 hex>`, sayaç YOK); bir kez yazılır, ağaçta varsa devralınır; parmak izi içerik OKUNMADAN yol+boyuttan, kitap dizini özete dahil | **kapı varsayılan AÇIK** (`EMPP_PAKET_MANIFESTI=0`) |
| sunucu artık temizliği (`src/services/paket-temizlik.js` + `tools/sunucu-temizlik.js`) | temp/ + uploads/ → eski artıklar silinir | aktif iş ve <10 dk KORU; artefaktsız >6 sa, artefaktlı >48 sa SİL; kuyruk okunamazsa HİÇ silmez (exit 3); varsayılan KURU | canlı — srv21 crontab `25 * * * *` |
| ana ekran yolu yaması (K20, `src/packaging/ana-ekran-yolu-yamasi.js`) | bundle'lardaki `path.join(path.dirname(location.href),"../")` → `new URL("..",location.href)` | Geri referanslı regex (join+dirname aynı değişken); idempotent; yalnız `.js`; kök+bookN. Windows'ta beyaz ekranı onarır | canlı |
| ölü motor temizliği (`src/packaging/olu-motor-temizligi.js`) | alt-kitap kökü → index.html'den ulaşılamayan `<20-hex>.…` js/css atılır | Yalnız içerik-hash'li adlar aday; geçişli kapanış; js girişi yoksa NO-OP. sm4: 826 dosya / 191,8 MB, üç kitap açılarak doğrulandı | **kapı varsayılan AÇIK** (`EMPP_OLU_TEMIZLIK=0`) |
| sayfa WebP (`src/packaging/sayfa-webp.js`) | `assets/*/pages/*.png` → WebP içerik, **ad `.png` kalır** | mod1 (ilk 100 bayt, `256−x`) çözülür/yeniden uygulanır; küçülmüyorsa özgün korunur; thumbs ve core'a DOKUNULMAZ. Kapı hâlâ varsayılan KAPALI (ProBook doğrulaması bekliyor) — AMA 2026-09-20 23:30–09-21 arası elle başlatılmış bir süreç bu bayrakla ayakta kalıp ProBook kabulü olmadan üretime karıştı (SM4 Windows paketinde sayfaların çoğu WebP çıktı, kaynak PNG'ydi); artık `webp-kapi-uyarisi.js` kapı açıkken günlüğe GÖRÜNÜR uyarı basıyor (sessiz açık kapı yasak) | **kapı `EMPP_SAYFA_WEBP=1`, varsayılan KAPALI — 2026-09-21'de fiilen açık koştu** |
| sayfa ön-getirme (K24, `src/packaging/sayfa-on-getirme.js`) | kitap açılınca tüm sayfalar SIRAYLA okunup işletim sistemi dosya önbelleği ısıtılır | Enjekte edilen betik `index.html` sonuna girer; Node varsa `fs`, yoksa `fetch`; baytlar atılır; sekme gizlenince durur. sm4: 5 kitap / 380 sayfa | **kapı varsayılan AÇIK** (`EMPP_ON_GETIRME=0`) |
| açılış güncelleme ötelemesi (K25, `src/packaging/acilis-guncelleme-oteleme.js`) | ana süreç `electron.js`/`main.js` → `createWindow()` ÖNE alınır, `checkForUpdates()` ateşle-unut olarak 3 sn sonraya ötelenir | Motor pencereyi `await checkForUpdates()` ARKASINDA açıyordu: splash bile gelmiyordu. Ayrıca `https.get` zaman aşımsızdı → yanıtsız sunucu açılışı süresiz askıya alıyordu; `{timeout:15000}` + `.on("timeout", destroy)` takıldı. Güncelleme iptal EDİLMEZ | **kapı varsayılan AÇIK** (`EMPP_GUNCELLEME_OTELEME=0`) |
| sürüm normalleştirme (`src/agent/surum-normallestir.js`, `publisher-update.js` çağırır) | yayıncı `version.txt` içeriği → daima 3 parçalı semver | Normalize edilemiyorsa YAZMAZ, mevcudu korur (fail-safe, SAF modül). Gerekçe: yayıncının `checkVersion`'ı 3 parça olmayan (örn. `1.13.1.3`) her değeri koşulsuz "eski" saydı → her açılışta ~350 MB boşuna indi | **kapı `EMPP_SURUM_NORMALLESTIR`, varsayılan AÇIK** |
| **sürüm kıyası (`src/agent/surum-kiyas.js`, 2026-09-21)** | iki sürüm dizgesi → `dahaYeniMi` / `ayniSurumMu` (SAF, fs/ağ YOK) | **Neden ayrı modül:** `publisher-update.isNewer` yayıncının `checkVersion` davranışını birebir taklit eder ("3 parça değilse string farkı = yeni") ve YAYINCI tarafında doğrudur — ama `surum-normallestir` etkinleşince önbellekteki `version.txt` 3 parçaya iner ("1.13.1") ve zip adı 4 parçalı kalır ("1.13.1.3") → `isNewer` HER İŞTE cache STALE der → her işte ~1 GB boşuna indirme/çıkarma. `dahaYeniMi` normalleştirilmiş hâli aynı sürüm sayar ve **belirsiz girdide "yeni" DEMEZ**. `runner.js cachedZipIsStale` bunu kullanır; `isNewer` yayıncı yolunda kalır | canlı (24 test) |
| **Windows paket kapısı (`scripts/windows-paket-kapisi.js`, 2026-09-21)** | üretilen `.exe` → 45 maddelik teslim öncesi ölçüm raporu | Kanon `~/Desktop/SM4-Windows-Test/OKU.md` elle kontrol ediliyordu, elle kontrol unutuluyor. **DÖRT durum vardır: PASS · FAIL · ÖLÇÜLEMEDİ · RAPOR** — ölçülemeyen madde (7z yok, asar okunamadı, NSIS başlığı sıkıştırılmış) sessizce PASS'a DÜŞMEZ, nedenini yazar. Ölçüm noktaları bilerek dar: ön-ısıtma **kitap kökünün** `index.html`'inde aranır (main.js'te değil), `version.txt` okunamazsa FAIL değil ÖLÇÜLEMEDİ, 64 MB ikon tavanı geri gelirse gerileme testi kırılır | araç hazır (45 test), **üretim akışına bağlanmadı** |
| VM izleyici sürüm tespiti (`src/windows/izleyici-surum.js`, manuel runbook `tools/windows/YUKSELTME.md`) | guest'teki `vm-izleyici.ps1` metni + kalp dosyası → yükseltme gerekli mi | Üç bağımsız çapayla (arka-plan kalp/çoklu makine/doğrudan URL) sürüm tespiti; şüphede (boş/bozuk/okunamaz) kalp atışı DAİMA "bayat" sayılır. Guest'e otomatik dokunulamaz (parola guest'e girmez) — host tarafı karar modülü, elle yükseltme adımı YUKSELTME.md'de | canlı (saf modül), guest yükseltmesi ELLE |
| ilk sayfa geldiği gibi açılış (K25, `src/packaging/acilis-ilk-sayfa.js`) | bundle'lardaki güncelleme sorgusuna süre bütçesi (2,5 sn) + hata yakalama | Sorgunun `.catch`'i ve zaman aşımı yoktu: ağ düşünce `SET_CHECK_UPDATE` hiç gönderilmiyor, kitabı açan tek şey 5 sn'lik `setTimeout` güvencesi kalıyordu — yani ağsız makinede güvence NORMAL yoldu. Artık karar bilinir bilinmez açılıyor; 5 sn güvence yerinde ama erişilemez. sm4: 22 bundle / 22 çağrı | **kapı varsayılan AÇIK** (`EMPP_ILK_SAYFA=0`) |
| splash beklemesi (K26, `src/packaging/acilis-splash-beklemesi.js`) | bundle'lardaki `setTimeout(()=>ayarla(FR.LOADED),1500)` → süre 0 | Kitap açılırken üç gösterge arka arkaya geliyordu (3 nokta → logo splash → "Kitap Açılıyor.."); ortadaki SAF yapay beklemeydi — logo görseli zaten yüklenmişken 1500 ms daha tutuluyordu. Çağrı ve efekt koşulları korunur, splash iptal EDİLMEZ. `EMPP_SPLASH_MS` ile markalı duraklama verilebilir. sm4: 5 kitap / 31 bundle | **kapı varsayılan AÇIK** (`EMPP_SPLASH_BEKLEMESI=0`) |
| ikon saydamlığı (`src/packaging/ikon-saydamlik.js`) | kurum logosunun ETRAFINDAKİ düz zemin → saydam (Windows/Linux/macOS ikon yollarının üçü) | Kenardan taşma-doldurma: yalnız dışa bağlı zemin silinir, logonun İÇİNDEKİ beyazlar korunur; kenar için yumuşatma bandı. Dört kapı DOKUNMAZ: zaten saydam · köşeler tutarsız · neredeyse tamamı · ihmal edilebilir. Beyaz kutu kaynak logodan geliyor (YDS: 0/262.144 saydam piksel), paketleyiciden değil | **kapı varsayılan AÇIK** (`EMPP_IKON_SAYDAM=0`) |
| Windows mimarisi (`src/packaging/windows-mimari.js`) | `win.target` → `{target:'nsis', arch:[mimari]}`, varsayılan **ia32** | 32 bit uygulama 64 bit Windows'ta WOW64 ile koşar, tersi koşmaz → tek paket iki cihaz sınıfını kapsar. Çok mimarili tek exe reddedildi (açılmış ağaç iki kez gömülür, ~2,5 GB). Geçersiz `EMPP_WIN_ARCH` sessizce düşmez, uyarır | canlı |
| yükleyici davranışı (NSIS `customInit` + `CRCCheck off`, `packagingService.js`) | aynı sürüm zaten kuruluysa kurulum yapılmaz, kitap açılıp yükleyici çıkar; çift tıklamadan sonraki boş "verifying installer" ekranı kaldırıldı | `IfSilent` kapısı toplu/sessiz kurulumu etkilemez; yol kayıt defterinden okunur (sabit `C:\` YOK); `Exec` öncesi `SetOutPath` ŞART (`.onInit` içinde `$OUTDIR` boştur → süreç sessizce başlamaz). Bütünlük denetimi kaybolmaz, kuruluma taşınır | canlı |
| Android kitap indir/güncelle (K8, `empp-android-shim.js`, 2026-09-22) | kitap kartındaki mavi/yeşil bulut → zip indirilir, açılır, kitap indirilen kopyadan okunur | Motorun masaüstü Node zinciri (`https.get` → `createWriteStream` → `adm-zip`) Android'de saplamaydı, kart %0'da kalıyordu. Zip bellekte Blob → `DecompressionStream` → Cache Storage (kitabın kendi adresi); `localStorage` yalnız dosya dizini. İzin ekranı yok. Sunucuda zip'i olmayan kitap 404 → motor catch etmediği için kart %0'da kalır | canlı (10 test, telefonda 74451) |
| Wi-Fi'de otomatik güncelleme (K9, shim + `src/platforms/android/ag-bilgisi.js`, 2026-09-22) | ücretlendirilmeyen bağlantıda kurulu kitapların güncellemeleri (yeşil bulut) kendiliğinden iner | WebView ağ türünü bilemez → yerel `EmppAgPlugin` (ACCESS_NETWORK_STATE, izin ekranı yok). Ölçüt Wi-Fi değil ÖLÇÜLMEYEN bağlantı; mavi bulut otomatik DEĞİL. Motor yalnız görünen sekmeyi kontrol ettiği için güncelleyici menüdeki TÜM kitapları tarar; sürüm `empp_surum`'a yazılır, menü HEM `readFileSync` HEM `fetch` yolunda okunurken işlenir. 6 saatte bir tarar | canlı (telefonda 27 tarandı / 9 güncellendi) |
| kademeli kurulum (planlandı) | paket → açılış kümesi (motor + data + her alt-kitabın ilk 10 sayfası) + arka plan kümesi | Açılış eşiği ölçüldü: 542 MB → 97 MB. İçerik `app.asar`'dan ÇIKMADAN mümkün değil | **tasarım — kod yok** |
| sayfa önbelleği (planlandı) | kitap açılınca arka planda kalan sayfaları mod1-çöz + önbelleğe yaz; **kanca `window.fetch` (ölçüldü) — `empp-fs-shim.js` `installFetch()` zaten orada** | Öncelik kuyruğu (atlanan sayfa öne alınır) · sayfa çevrilirken işçi durur · sürüm damgalı, kitap güncellenince düşer · disk tavanı şart | **tasarım — kod yok** |
| yükleyici (Inno Setup, planlandı) | build → per-user `%LOCALAPPDATA%` tek ekranlı imzalı kurulum | Soru sorulmaz, UAC yok, bitince otomatik açılır; imza 66902 yuvasından | **tasarım — kod yok** |
| imza yuvası gözcüsü (`scripts/imza-yuva-smb.sh`, 2026-09-25) | yerel exe → SMB `KitapTekExe/_hazir/` → pencerede 66902 yuvasına `mv` takası → İm Park imzalı kopya `imzali/<ad>-imzali.exe` | Yuva kimliği SABİT; imzalı sayılmak için pe_is_signed + gövde bayt eşliği (pencere kaçtıysa çıkış 4) + `osslsigncode verify` + imzacı CN; üzerine mv smbfs'te atomik değil; yavaş hatta `SMB_SHA=0`; `hizli-kontrol` İNDİRMEDEN <2 MB okuyarak imzalı+bizim der (Authenticode özetini doğrulamaz — yayın öncesi tam doğrulama şart); `toplu` önce hepsini hazırlar, sonra sırayla imzalatıp `_imzali/`'ye taşır, düşen pakette durur; canlı tetik yalnız `TETIK=1`; ayrıntı `scripts/OKU-imza-yuva-smb.md` | araç hazır (70 kuru test), **CANLI koşu yok** |

## Ekranlar ve Görevleri

| Ekran | Hangi İşlevleri Kullanır | Hangi Kararı Verdirir |
|---|---|---|
| `/` (paketleme arayüzü, :3001) | build yükle, paketle, iş durumu, indir | hangi kitap hangi platformlara üretilecek |
| `/settings` | ayarlar, depo seçimi | çıktı/kaynak dizinleri |
| `/publishers` | yayınevi + logo yönetimi | pakete hangi kurum logosu girecek |

## Veri ve Sınırlar

- **Kaynaklar:** yayıncı exe'si (SFX) → `resources/app/build`; kurum logoları
  `~/.electron-packager-tool/config/logos`; çıktı `config/output`; ajan kaynak önbelleği
  `~/.empp-agent/cache` (tavan `EMPP_CACHE_CAP_GB`).
- **Yasaklar:** `.env`/anahtar dosyası okumak; port 3000; paketleyicinin build içeriğine
  konfig/menü UYDURMASI — tek istisna K17 kök menüsü (kökte menü yoksa paket zaten açılmıyor).
- **Rationale (anomaliler):** boş `resources/app/build` klasörü AppRun'ın `mkdir -p` artığıdır,
  arıza değildir. ProBook'ta `pgrep -f DijiTap/DijiTap` kurulum çocuklarını (cp/rsync) da sayar —
  "süreç var" açılma kanıtı DEĞİLDİR; kanıt `/proc/<pid>/exe` kurulum dizinini gösteren süreç +
  ona ait görünür X penceresi + boş olmayan piksel sapmasıdır. `/api/health` `commit` döner ama çalışan süreç working-tree'yi yükler —
  commit eşitliği kodun eşitliği anlamına gelmez.
  Pardus işinde hazır paket YOKSA iş bu makinede derlenecek demektir; disk kapısı bu yüzden
  kaynak indirilmeden ÖNCE sorulur (`PARDUS_MIN_FREE_GB`). Kapı indirmeden sonra konuşursa
  her düşen iş ~1,5 GB'ı boşa indirir — 2026-09-18 gecesi 11 iş bu şekilde düştü.
  Üretilen `.impark`'ın AppRun'ı `resolve_executable` içermeli: electron-builder ikiliyi
  uygulama adıyla adlandırır, eski şablon yalnız `zkitap|zkitap.bin|electron` arar ve kurulum
  zenity ile "Executable bulunamadı" verir (ölçüm 2026-09-17: srv21'deki şablon bayattı,
  5 paket bu yüzden kapıdan döndü). Şerit üretimi bunu paket başına doğrular.
  ProBook kapısı scp'den ÖNCE hedef diskte `paket×2,5 + 2 GB` boş alan arar ve açılış üst
  sınırını paket boyutuyla ölçekler (`300 + MB/2` sn) — 1,5 GB'lık SET 420 sn'de kurulamıyordu
  ve sağlam paket haksız yere REDdediliyordu.
  Kuyruk boş temizliği `uploads`'u TOPTAN boşaltamaz: kontrolden sonra gelen yükleme silinir,
  unzip düşer ve paketleme işi sonsuza dek "ZIP bekleniyor"da asılı kalır (ölçüm 2026-09-17, 45792;
  son 10 dakikada dokunulmuş dizinler korunur).
  3001 restart reçetesi: `~/.empp-agent/packager.env` ortamıyla, kuyruk BOŞKEN, `/api/health`
  `commit`i çalışan HEAD ile eşleşince güvenli sayılır (pid `~/.empp-agent/packager.pid`) — 24.09
  17244af ile böyle yeniden başlatıldı; kapılar öncekiyle aynı kaldı (`setGuncelleme` sözleşme
  ONAYLI olmadığı için KAPALI).

## Yapılmayacaklar

- SET için `app.config.js` / set konfigi üretmek (K1, Nadir kararı — geri alındı, `_graveyard`).
- Paralel ağır build'i varsayılan yapmak (srv21 paylaşılan üretim sunucusu — nazik build kuralı).
- Yayıncının kendi menüsü/özel index'i olan pakete dokunmak.
- Windows'ta motor/kabuk kanonikle değiştirme (Faz 3) — ertelendi, şimdilik Mac/Linux/Android.
- SET güncelleme kanalı (`EMPP_SET_GUNCELLEME`): Windows'ta AÇIK (üretim ed25519 anahtarı üretildi, karar
  defteri A5 KAPANDI, 26.09). mac/linux/android için istemci yok — kanal o platformlarda kapalı kalır,
  anahtar hazır olduğu için değil, sarmalayıcı yazılmadığı için (`windows-paketleme-sozlesmesi.md` madde 3).
- srv21 `:3093` canlı üreticisinin `set-menu.js`/kod eşitlemesi — HEAD'e çekmek K15/K17'yi siler,
  önce commit kararı Nadir'in.

- **Uzaktan destek** (RustDesk/AnyDesk/TeamViewer) — Nadir 18.09: KAPSAM DIŞI.

## Açık Kararlar (Nadir'e)

- İkinci paralel üretim hattı için ajanın ikinci kimlikle kaydı (`AGENT_ENROLL_SECRET`).
- macOS/Android'de üretim sonrası kabul kapısı **VAR** (başsız kabul, canlıda AÇIK — yukarıdaki satır); **eksik olanlar: `hold` durumu ve geri alma** (pardus'ta ProBook, Windows'ta windows-kasa zaten ayrı var). **Dahası: hatta "üret, bekle, onaylanınca yayınla" diye bir ara durum HİÇ YOK** — `runner.js` `postResultSuccess` build biter bitmez R2'ye yazar, `job done` der ve **yerel çalışma dizinini siler**; incelemek isteyen CDN'den geri indirir. Yani kuyruğa iş koymak = yayına onay vermek; bozuk paket her seferinde ÖNCE müşteriye gider. Kanıt 21.09: kaçak paketleyici yanlış kapılarla (`setMenu:false`, `sayfaWebp:true`) **7 paket** üretti, yedisi de kimse bakmadan canlıya çıktı; bozukluk ancak Nadir bir APK'yi kendi cihazında açınca fark edildi (45482: menü hiç gelmedi, doğrudan kitaba atladı). Gereken: `hold` durumu (üretildi · doğrulanmayı bekliyor · yayınlandı) + kabul kapısının YAYINDAN ÖNCE koşması. Mac kapısı ölçütü: asar kökünde `assets/`+`classlibraries/`, kök `index.html` gerçek SET menüsü mü (dosya varlığı DEĞİL, **davranış**), `bookN` tam, sayfalar PNG.
- K17 menüsünde kitap adı kaynaktan (`BookContent.xml` `pdfUrl`) türetiliyor; panel/DB'deki
  gerçek kitap adlarına bağlanmalı mı?
- 24.09 açık: 73768 1.0.2 teslimi (etkinlik kanıtı bekliyor), ProBook şeridi dosyalarının commit'i,
  srv21 `:3093` eşitleme + systemd birimi, `r2.conf` açık metin R2 anahtarı döndürme.

## Değişiklik Günlüğü

| Tarih | Ne Değişti | Hangi Oturum |
|---|---|---|
| 2026-09-22 | K8 Android kitap indir/güncelle + K9 Wi-Fi otomatik güncelleme (yerel ağ bilgisi eklentisi) eklendi | 476bac52 |
| 2026-09-17 | İlk taslak; K17 SET kök menüsü + pardus paralel bayrağı + ProBook kabul kapısı + srv21 üretim şeridi + `EMPP_LINUX_DEB` + scp portu (-P) onarımı + kuyruk-boş temizliğinin taze uploads'u koruması | 006cff11 |
| 2026-09-18 | Pardus disk kapısı indirmeden ÖNCE soruluyor (gece 11 iş boşuna düşmüştü); Electron verimliliği (dil budaması+açılış yaması+sayfa WebP kapılı, paket %91 app.asar); kademeli kurulum/sayfa önbelleği/Inno Setup tasarımı yazıldı | 006cff11 |
| 2026-09-19 | K20 ana ekran yolu (Windows beyaz ekran) + K21 açılış ağ politikası; Pardus disk kapısı BOYUT ORANTILI (kaynak×5, taban 15 GB), düşünce `failed` YAZILMAZ (kuyruğa döner) | 006cff11 |
| 2026-09-20 | K24 sayfa ön-getirme + K25 açılış ikilisi (güncelleme ötelemesi+ilk-sayfa süre bütçesi) + K26/K27 sabit splash ve 3. gösterge kaldırıldı; Katman 1 `paket.json` manifesti (setId); Windows kabul kapısı (VM+HTTP köprü, çok makineli kuyruk/kalp) | 006cff11 |
| 2026-09-21 | Sayfa WebP kapı-uyarısı günlüğe basar; sürüm normalleştirme + **sürüm kıyas modülü** (`surum-kiyas.js`, cache STALE çakışması giderildi) + **Windows paket kapısı** (45 madde, dört durumlu) + VM izleyici sürüm tespiti; **SET güncelleme kanalı** ilk sürümü (kabuk tanımı+güncelleyici enjekte, Windows asarsız) | 006cff11 |
| 2026-09-24 | **Faz 2** içerik kanalı K (`icerik-guncelleme.js`, 22/22 mutant) + **Faz 3** motor/kabuk kanonik değiştirme (`motor-surumu.js`+`okuyucu-kabugu.js`+kapı `motor-kapisi.js`) + packagingService bağlantıları; SET kök menüsü Web-Z kabuğuna dokunmaz oldu; **ProBook yerli Pardus şeridi** (kurulum+ajan birimi+yerel kabul+manifest temizliği+ortak kilit, Bloktest 2,2 GB 604 sn uçtan uca); test globu genişledi (1652 test, 0 fail) | ef3aaa8, e1f080c, 17244af, 29b8fc8, 420f21e, 0651f80 |
| 2026-09-26 | **G istemcisi mac + Pardus** (örtü: mac `userData/empp-guncelleme`, Pardus `<kurulum>/resources/empp-guncelleme`; imzalı içerik-adresli, `file:` zinciri K ile ortak) + **üç açık kapandı, tüm kiplerde**: monoton sürüm (G3, kurulu = max paket/son G), `kanal`+`setKimligi` denetimi, ya hep ya hiç (Windows `.empp-gecici` hazırlık + günce + atomik damga); aynı arşiv yeniden inmez; kural 8. Kanıt: g-uctan-uca 11/11 × 2 kip, birim 222, mutasyon `tools/g-kanal/ortu-mutasyon.js` | 006cff11 (g-electron) |

## Anlık yama katmanı (2026-09-21, HENÜZ BAĞLANMADI)

Kurulu uygulamaya küçük düzeltmeleri (ör. `index.html` 2.973 bayt vs paket 1,89 GB/13.677 dosya)
yeniden kurulum olmadan uygulamak için `yama-katmani.js` (ana sürece `protocol.handle('file')`
kancası, `userData/<YAMA_DIZIN>` önce aranır, atomik/idempotent, yol kaçışı reddedilir) ve
`yama-defteri.js` (defteri çeker, sha256 doğrular, atomik rename, 5 MB bayt tavanı) yazıldı;
canlı yola BİLİNÇLİ bağlanmadı, kapı `EMPP_YAMA=1` varsayılan KAPALI — renderer `fetch` sarmalı
HTML navigasyonunu YAKALAMAZ, protokol kancası bu yüzden gerekti. Yayıncının kendi güncelleyicisi
açılışta zaten ~350 MB indiriyor; bizim yolumuz İKİNCİ bloklayıcı güncelleme OLMAYACAK.

**2026-09-26 — Windows paketleme sözleşmesi ONAYLI (Nadir).** `windows-paketleme-sozlesmesi.md`: G1–G6 uygulandı,
kurulum ekranı kuralı (ilk kutu, evre metinleri, gerçek MB sayacı, tek yazma) ve zamanlama günlüğü eklendi.
VM'de A 2.51.0 kuruldu, Nadir onayladı. Kod ana ağaçta (`ded619e`, `c11aae0`, `436daa0`); imza bekleme kuralı `4e78243`.

**2026-09-26 — Üretim ed25519 anahtarı üretildi (karar defteri A5 KAPANDI).** Detay `karar-defteri-2026-09-26.md`
A5 satırında; bu belgede yalnız kanal durumu (yukarıda). Üretim yeri, motor temizliği, G'nin kapsamı
(kitabın ANA klasörü, `htmletk/…/etk/` kapsam dışı) ve "kurulum klasörü" tanımı: `platform-kanallari-sozlesmesi.md`
"Ortak özellikler" O1-O4.
