# Gotchas — paketleyici detaylı tuzak defteri

> `.claude/CLAUDE.md` "Dikkat Edilecekler" bölümünden 2026-09-26 slim geçişinde
> taşındı (satır sayısını 80-100 sınırında tutmak için). İçerik AYNEN korunmuştur,
> yalnız yer değiştirdi. CLAUDE.md'de bu konuların her biri için tek satırlık
> pointer var; ayrıntı gerektiğinde burayı oku. Yeni SET-özel bulgular için önce
> `.claude/docs/set-paketi-know-how.md`'ye (K1-K18) bak — orada zaten yaşayan bir
> konuyu burada TEKRAR üretme.

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

- **SET kökünde menü yoksa paket BEYAZ EKRAN (K17, 2026-09-17, Pardus'ta ölçüldü):** yayıncının
  otomatik exe'sinden çıkan SET build'inin kökü motorun tek-kitap `index.html` kopyasıdır;
  kökte `assets/`+`classlibraries/` yoktur → `assets not found in app.asar` +
  `ImWin32.dll okunamadı` → sonsuz "…". Kurulumdaki **boş `resources/app/build` klasörü
  SAHTE izdir** (AppRun her kurulumda `mkdir -p` yapar, doldurmaz; içerik `app.asar`'da —
  çalışan kurulumlarda da boştur). Çözüm `src/packaging/set-menu.js` `ensureSetMenu()`;
  kapı `EMPP_SET_MENU=1` (pardus yolunda varsayılan AÇIK, android/macOS için Nadir kararı +
  3001 restart'ı gerekir). Özel menüsü olan SET'e (Flashy 59480) DOKUNMAZ. 14 set etkilendi
  (bkz. `.claude/docs/set-paketi-know-how.md` K17).

- **Paket AÇILMADAN yüklenmez (K18, 2026-09-17 — Nadir kuralı):** pardus işinde ajan,
  `.impark`'ı R2'ye yüklemeden ÖNCE `tools/pardus/probook-kabul.sh` ile gerçek ProBook'ta
  (etapadmin@192.168.1.55) kurup açar; düşerse iş hata verir, yükleme olmaz
  (`EMPP_PARDUS_KABUL=1`, `src/agent/runner.js` → `buildPardusArtifact` sonu).
  **"Süreç var" açılma kanıtı DEĞİLDİR:** `pgrep -f DijiTap/DijiTap` AppRun'ın kurulum
  çocuklarını (cp/rsync) sayar — ilk sürüm surec=6 görüp kabul verdi, ekranda Chrome vardı.
  Geçerli kanıt: `/proc/<pid>/exe` kurulum dizininde + görünür X penceresi + içerik ölçümü
  (sapma ≥ 0.05, koyu piksel ≥ 0.005, renk ≥ 500 — kırık paket: 0.020/0.00047/10,
  sağlam: 0.198/0.51/93750). Motor hataları stdout'a DÜŞMEZ (renderer devtools) — konsol
  denetimine güvenme. AppRun `.empp-version` önbelleği için kapı eski kurulumları geçici
  yeniden adlandırır, sonunda geri koyar.

- **Başsız kabul kapısı — mac/Android/Windows (K18'in Mac'teki eşi, 2026-09-26):**
  `node tools/kabul/basliksiz-kabul.js <paket>` paketi BU Mac'te odak çalmadan açıp ölçer
  (Electron offscreen + LSUIElement çalışma zamanı kopyası `~/.empp-agent/kabul-kanit/_calisma-zamani/`;
  Android'de ek pencerisiz emülatör). Runner'da `EMPP_BASLIKSIZ_KABUL=1` (varsayılan KAPALI).
  Tuzaklar: Claude Code/VS Code ortamı `ELECTRON_RUN_AS_NODE=1` verir → Electron Node gibi koşar,
  koşum bunu siler; paketlenmiş `.app`/`open` ASLA kullanılmaz; `Pixel_8_Pro_API_35`'te 9 Eylül'den
  bayat snapshot kilidi var (emülatör "snapshot operation pending" ile çıkar) → varsayılan AVD Fold.
  Electron 39 (node_modules) `show:false`+LSUIElement'e rağmen ~3 sn odak çaldı → yalnız kanıtlı
  27.3.11 koşar. Tek kitap paketinde kök motor rafı olabilir (MEÇ 73714, BES 74451) → kapağa tıklanır.

- **Electron verimliliği (2026-09-18, ölçüldü):** `.claude/docs/yukleyici-arastirma-2026-09-18.md`
  §E-F. Paketin **%91'i app.asar**, onun %97'si `assets/` — motor ve içerik TEK blokta, yani
  tek sayfa düzeltmesi 1 GB yeniden indirme. Üç değişiklik yapıldı: (a) `electronLanguages:
  ["tr","en-US"]` win/mac/linux (−9 MB); (b) `src/packaging/acilis-yamasi.js` — üretilen
  kitaba `show:false`+`ready-to-show`+8 sn emniyet, **atomik** (pencere değişkeni ya da
  `loadFile/loadURL` yoksa `show:false` DA konmaz; yalnız başına konursa pencere HİÇ açılmaz);
  (c) `src/packaging/sayfa-webp.js` — sayfa PNG'leri WebP'ye, **dosya adı `.png` kalır**
  (motor uzantıyı sabitliyor ama Chromium içeriğe bakıyor — ölçüldü). mod1 = ilk 100 bayt
  `256−x`, involutif. Kapı **VARSAYILAN KAPALI** `EMPP_SAYFA_WEBP=1`; ProBook kabul kapısından
  (sayfa+büyüteç+canvas) geçmeden üretimde AÇILMAZ. Ölçülen: 14 MB → 7 MB (%50), 20 sayfa/sn.

- **Pardus disk kapısı BOYUT ORANTILI (2026-09-19, ölçümle):** eşik artık sabit DEĞİL.
  `runner-helpers.pardusGerekliDiskGb` = `max(kaynakGb × PARDUS_DISK_KAT, PARDUS_DISK_TABAN_GB)`
  (varsayılan 5 ve 15). Kaynak boyutu **indirmeden** ölçülür (`kaynakBoyutuTahmin`: önce
  ajan önbelleği, olmazsa `HEAD`; ölçülemezse tahmin ÜRETİLMEZ, taban uygulanır).
  Ölçüm: zip → açılmış build **1,17-1,20×**; eşzamanlı tepe ≈ kaynak × 5 (zip + açılmış +
  app.asar + Electron runtime + .impark). Eski düz sabit `PARDUS_MIN_FREE_GB=45` 1,1 GB'lık
  en büyük kitapta bile **10 kat** fazlaydı. Sabit hâlâ **açık override** olarak çalışır ama
  `~/.empp-agent/run-agent.sh`'tan kaldırıldı — geri koymak kapıyı yine düz sabite çevirir.
  **Taban 15 neden:** kapı tek anlıktır, paketleyici 4 paralel iş kabul eder ve ~35 dk'lık
  derleme boyunca başka işler aynı diski yer (20 GB'ı kıl payı geçen 59834 derlemesi
  2026-09-17'de sessizce bozuk paket üretmişti). Asıl emniyet ağı K18 ProBook kabul kapısı.

- **Disk darlığı PAKET KUSURU DEĞİLDİR (2026-09-19):** kapı hatası `DISK_KAPISI_ISARETI`
  ile işaretlenir; `ertelenebilirKaynakHatasi` dalı satıra `failed` **YAZMAZ**, 15 sn
  bekleyip sıradaki işe geçer (kira dolunca satır kuyruğa döner). Eskiden `failed`
  yazılıyordu — panelde "PARDUS HATALI" görünen 8 iş (19 Eylül) bozuk paket değil, dolu
  diskti. Yeni bir kaynak kapısı eklerken aynı ayrımı kur: *eşik* ve *reddetme biçimi*
  iki ayrı karardır.

- **Kurulum bilgilendirmesi — ASCII kırpması KODLAMA SORUNU DEĞİL (2026-09-19, ölçüldü):**
  "Dosyalar isleniye basliyor" gibi metinler `createCustomInstallationFiles` içinde
  düpedüz ASCII yazılmıştı. makensis (NSIS 3 Unicode, `~/Library/Caches/electron-builder/
  nsis/nsis-3.0.4.1/mac/makensis`, `NSISDIR` verilerek Mac'te koşar) UTF-8 kaynağı
  **BOM'suz doğru okuyor**; Türkçe karakterler derlenmiş exe'ye UTF-16 olarak birebir
  giriyor (bayt düzeyinde doğrulandı). Yani çözüm kodlama değil, metni düzgün yazmak.
  Ayrıca kaldırıldı: sahte "[10%]…[95%]" satırları ve aralarındaki `Sleep` (kurulumu
  boşuna 3,6-5,6 sn uzatıyordu). Bağlanma noktası `Section` DEĞİL **`customInstall`**
  makrosudur (`app-builder-lib/templates/nsis/installSection.nsh` onu insert eder);
  `customFinishPageAction` şablonda **hiç referansı olmayan ölü makroydu**. Sentinel:
  `src/packaging/installer-bilgilendirme.test.js` (6 test, 4 mutantla doğrulandı).

- **"<Uygulama> kapatılamaz" diyaloğu nereden gelir (2026-09-19, kaynak okundu):**
  electron-builder'ın `allowOnlyOneInstallerInstance.nsh` makrosu. Per-user kurulumda
  (`perMachine:false`) süreç `tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq
  <exe>"` ile aranır, `taskkill` (önce normal, sonra `/f`) ile kapatılmaya çalışılır;
  **ikinci turda hâlâ ayaktaysa** `appCannotBeClosed` kutusu çıkar. Yani diyalog bir
  paketleme kusuru değil, "süreç iki zorlamalı taskkill'e rağmen ölmedi" demektir.
  Override noktası **`customCheckAppRunning`** makrosudur (aynı dosyada `!ifmacrodef`
  ile aranır). Teşhis için Windows'ta üreme şart — Mac'ten ölçülemez.

- **Kapı bayraklarının kaynağı `~/.empp-agent/run-agent.sh` (2026-09-26 akşam canlıya alma):**
  yeni anahtarlar — `EMPP_RUNNER_WINDOWS` (kapalı→1: Windows şeridi + imza yuvası + `AGENT_CAPS`'a
  `windows`), `EMPP_ARSIV_MERDIVEN` (kapalı→1: İmpark içerik merdiveni S0/S1), `KABUL_CDP`
  (kapalı→1: ProBook CDP kabul, ayrı ev varsayılan açık). `EMPP_ICERIK_KAPISI` ve
  `EMPP_WEBP_ONBELLEK` run-agent.sh'ta YOK — kod varsayılanları zaten AÇIK (dokunmadan çalışır).
  `EMPP_PROBOOK_SERIT` kod varsayılanı kapalı VE run-agent.sh'ta da bilerek KONMADI (kayıt sırrı
  + LAN arşiv eşlemesi doğrulanana kadar).

- **Kabul gerçek HOME'da eski paketi de GEÇTİ sayar (2026-09-26, canlı ölçüm):** ProBook'ta
  gerçek ev v36 (öğretmen profilindeki eski indirme) görüp rc=0 verdi; ayrı HOME v33 görüp
  doğru rc=3 verdi. `KABUL_CDP=1` iken E7 SADECE ayrı ev'de güvenilir — eski ev asla GEÇTİ.

- **G manifestinin TEK yazarı g-yayin — runner tar yüklemez (D-2, 2026-09-26):** eski G
  paketleme çağrısı `packagingService.js`'ten kaldırıldı (`_graveyard/2026-09-26-g-eski-uretici/`).
  Yeni bir G üretim/yayın yolu eklerken manifesti ASLA runner/build tarafında yazma — istemci
  `kanal-g-degil` ile RED eder, bu bilinçli bir kapı.

- **Android G EKLEME kalıcı donma riski (2026-09-26, karar bekliyor):** G manifesti her
  eklemeyi sonraki yayınlara taşıdığından bir kitap eklendikten sonra o setin Android'i
  hiçbir G güncellemesini (motor dahil) alamıyor. Android G istemcisi paketlerde AÇIK
  (`EMPP_SET_GUNCELLEME=windows,macos,linux,android`); koruma g-yayin `--ekle` KAPISINDA:
  anahtarsız `--ekle` RED, bilinçli geçiş yalnız `--android-ekleme-dondurur-kabul` (rapor +
  manifest yanında `ANDROID-DONUK.txt`), dal `g-yayin-android-kapi` (`233854f`, agent-mode'a
  merge bekliyor). Kalıcı çözüm Nadir A/B seçimi — bkz. changelog (7), `g-android-kitap-ekleme-onerisi-20260926.md`.

- **Android'de motor ağ varken "Network is offline" der (2026-09-26, ölçüldü 74451):** İmpark motoru
  açılışta bir kez `fetch(baseEndpointUrl, {method:'HEAD', mode:'no-cors'})` ile `window.isOnline`
  hesaplar (`baseEndpointUrl` yoksa varsayılan besegitim.com). Yayıncı kökleri Cloudflare challenge
  403 + `Cross-Origin-Resource-Policy: same-origin` döner. İki tuzak: (1) CapacitorHttp köprüsü
  (`_capacitor_http_interceptor_`) gövdesiz HEAD 403'te `getInputStream` FileNotFoundException →
  `null` → fetch reddi; (2) WebView'in yamasız fetch'i (`CapacitorWebFetch`) no-cors cevabı CORP
  yüzünden ağ hatasına çevirir — emülatörde denendi, İŞE YARAMAZ. Electron `webSecurity:false`
  (CORS/CORP yok) → 403 çözülür, masaüstü etkilenmez. Kapı `EMPP_ANDROID_CEVRIMICI=1` (varsayılan
  KAPALI): shim yalnız bu yoklamayı yerel CapacitorHttp eklentisine GET (başlıksız) olarak sorar.

- **Süreli konteyner yedek kabul — ProBook erişilemezken (2026-09-27, Nadir: "ProBook elektrik
  kesintisiyle kapandı, yarına kadar bu Mac'teki docker üzerinden fallback'i devreye al"):**
  bayrak dosyası `~/.empp-agent/pardus-konteyner-kabul.istek` (ilk boş olmayan satır = bitiş ISO
  zaman damgası, `EMPP_PARDUS_YEDEK_KABUL_BAYRAK` ile değiştirilebilir) AKTİFKEN VE ProBook'a
  erişilemezken `src/agent/runner.js` `pardusKabulKapisi` ProBook betiğini (`probook-kabul.sh`)
  hiç çağırmadan bu Mac'teki Docker konteyner kapısına (`tools/pardus/konteyner-kabul.sh` →
  `konteyner-kapi.sh`, imaj `pardus-kapi:3`) düşer — ProBook ölçümde erişilir görünüp betik yine
  de "ProBook'a baglanilamadi" ile düşerse de AYNI yola düşülür (ertelemek yerine). Süresi dolan
  bayrak SİLİNMEZ, yalnız yok sayılır — davranış BİREBİR eskisine döner. Sonuçlar (GECTI/RED/
  OLCULEMEDI) `~/.empp-agent/pardus-konteyner-kabul.log`'a TSV olarak eklenir (ProBook dönünce
  hangi kitapların yeniden ProBook'ta kabul edilmesi gerektiğini bulmak için). **Kapsam DIŞI**
  (yalnız açılış + piksel içeriği ölçer): ProBook'un kapsadığı K4 güncellik (CDP E6/E7/E8), SET
  alt kitap sürüm ölçümleri (`SET_TUM`) ve gerçek FUSE/AppRun kurulum yolu — konteynerde FUSE
  genelde yok, `--appimage-extract-and-run` ile mount katmanı ATLANARAK açılır; bu üçü konteyner
  yedeğiyle DOĞRULANMAZ, ProBook döner dönmez TSV listesindeki kitaplar yeniden ProBook'ta
  kabul edilmelidir. İki dal aynı gün konteyner kapısı üzerinde çalıştı — çakışma NOTU:
  1. Konteyner kapısı (`konteyner-kapi.sh`) Rosetta altında (`--platform linux/amd64`, Apple
     Silicon) koşar; `/proc/<pid>/exe` çözülmediği için süreç tespiti argv[0]'a düşer
     (dal `fix/konteyner-kapi-rosetta-20260927`, commit `f4b31c1` — bu dal `konteyner-kapi.sh`'a
     DOKUNMADI, iki dal ayrı birleştirilecek).
  2. Kitap güncelleme diyaloğu ("Kitap Güncelleniyor %x") açıkken de ölçüm İÇERİK görür — ProBook
     kapısındaki davranışla aynı (piksel eşiği diyalog metnini de "içerik" sayar).
