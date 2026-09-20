## 2026-09-19 (4) — K20: SET "ana ekran" butonu Windows'ta beyaz ekran (saha arızası)

**Bildiren:** Nadir, üretilen exe'yi kurup açtıktan sonra. Kitap açıkken alt bardaki
"ana ekran" butonu kök menüye dönmesi gerekirken beyaz ekranda kalıyordu.

**Kök neden (ölçüldü, motorda — bizim değişikliklerimiz DEĞİL):**
`getParentPath()` bir URL üzerinde `path.join` çağırıyor:
`path.join(path.dirname(window.location.href), "../")`, çağıran ise
`window.location.href = getParentPath() + "/index.html"` diyor.

| Platform | Üretilen adres | Sonuç |
|---|---|---|
| Windows | `.\file:\C:\…\app.asar\/index.html` | GEÇERSİZ → beyaz ekran |
| Linux/mac | `file:/opt/…/app.asar//index.html` | Chromium kabul eder → çalışır |

Arıza yalnız Windows'ta görünür; Pardus ve mac paketlerinde gizli kalmış.

**Düzeltme:** `src/packaging/ana-ekran-yolu-yamasi.js` — `path` yerine `URL`:
`new URL("..",window.location.href).href.replace(/\/$/,"")`. Geri referanslı regex
(`join` ve `dirname` AYNI değişkenden gelmeli) üye/benzer kalıpları eler; idempotent
(`EMPP_ANA_EKRAN_YOLU` işareti); atomik yazım. Ölü temizlikten SONRA koşar.
11 test, **dört mutasyon da öldürüldü** (geri referans, idempotans, sondaki `/`, `.js` süzgeci).
`externalbutton` da aynı yardımcıyı kullandığı için o da onarıldı.

**Üretim:** `SM4-K20-anaekran-duzeltildi.exe` **1298,9 MB** / 147 sn.
Hat: `🏠 ana ekran yolu (K20): 5 dosyada 5 düzeltme` (ölü temizlik sonrası 31 → 5 canlı bundle).
Paket içi denetim: book1'de yamalı 1, **kalan hatalı kalıp 0**.

Tam takım: 451 test / 446 pass / 1 fail — düşen test `runner-pardus` zaman aşımı
testi, yük altında flaky; tek başına **39/39 geçti**. K20 ile ilgisi yok.

## 2026-09-19 (3) — Sunucu artık temizliği deterministik hale getirildi

**Kusur:** mevcut `checkAndCleanIfQueueEmpty` YALNIZ bir iş bitip kuyruk boşaldığı an
tetikleniyor ve `completed` işleri `delete-job` çağrılana kadar SÜRESİZ koruyor.
İş akmayan günlerde hiç çalışmıyor → srv21'de 4 gün eski 19,5 GB birikmişti, disk %99.

**Yeni:** `src/services/paket-temizlik.js` (saf karar) + `tools/sunucu-temizlik.js` (CLI).
Karar sırası — ilk eşleşen kazanır:

| # | Koşul | Sonuç |
|---|---|---|
| 1 | aktif iş | KORU |
| 2 | < 10 dk dokunulmuş | KORU (2026-09-17 build.zip kazası) |
| 3 | artefakt YOK + > 6 sa | **SİL** |
| 4 | artefakt VAR + > 48 sa | **SİL** |
| 5 | aksi | KORU (teslim penceresi sürüyor) |

Emniyet: varsayılan **KURU** (silmek için `--uygula`) · kuyruk ucu cevap vermez ya da
JSON değil dönerse **hiçbir şey silinmez, exit 3** · servisi olmayan kök için
`--servissiz` **açık bayrak** (sessiz gevşeme yok) · silinecek yol kökün dışındaysa atlanır.
13 birim + 4 kaynak-sentineli testi; **beş mutasyon da öldürüldü** (aktif koruması,
taze koruması, artefakt ayrımı, kuru varsayılanı, `>` vs `>=` sınırı).

**srv21 kurulumu:** `/usr/local/bin/paket-artik-temizlik.sh`, crontab `25 * * * *`
(flock ile tek koşu), günlük `/var/log/paket-artik-temizlik.log`. İki kök taranıyor:
`/opt/electron-packager` (kuyruk ucu `:3005/api/queue-status`) ve `/opt/empp-packager`
(`--servissiz`). Crontab yedeği: `/root/.crontab-yedek-20260919`.

**İlk canlı koşu:** 18.09 tarihli 6 `.impark` (3,6 GB) **"teslim-penceresinde" diye
KORUNDU** — 48 saat dolunca kendiliğinden gidecek. Elle silme kararı ortadan kalktı.

Tam takım: **440 test / 436 pass / 0 fail**.

## 2026-09-19 (2) — Kararlar deterministik hale getirildi + A/B exe ölçümü

**Yeni modül `src/packaging/olu-motor-temizligi.js`** — index.html'den ulaşılamayan
webpack çıktılarını atar. Kapı **varsayılan AÇIK** (`EMPP_OLU_TEMIZLIK=0` kapatır).
Üç koruma, üçü de mutasyonla çivilendi: (1) yalnız `<20-hex>.…` içerik-hash'li dosyalar
aday, (2) geçişli kapanış, (3) js girişi yoksa NO-OP. Gerçek pakette **826 dosya /
191,8 MB**; book1/book4/book5 Electron'da AÇILDI (#root dolu, sayfa 1/10, 5 görsel +
4 canvas). "Dokunma listesi" ölü daldı (ADAY_RE zaten eliyordu) — kaldırıldı.

**Karar–kod hizalaması:** `nsis.allowElevation` `true` → **`false`**. 18.09 kararı
"per-user `%LOCALAPPDATA%`, UAC yok" idi ama kod hâlâ yükseltme istiyordu.
Kaynak-sentineli testleriyle çivilendi (`perMachine:false` + `allowElevation:false`,
`signtoolOptions.publisherName`, temizlik WebP'den ÖNCE).

**A/B ÖLÇÜM — aynı kaynak (sm4), iki Windows exe'si:**

| | Kontrol (kapalı) | Tam (açık) | Fark |
|---|---|---|---|
| Kurulum exe | **1451,5 MB** | **1318,2 MB** | **−133,2 MB (%9,2)** |
| `app.asar` (diskte) | ~1847 MB | **1532,4 MB** | **≈ −315 MB** |
| `locales/` | (ölçülmedi) | **2 dosya** (`tr.pak`, `en-US.pak`) | 55 → 2 |

Hat günlüğü (tam koşu): `🧹 ölü motor temizliği: 826 dosya, 191,8 MB` ·
`🖼️ Sayfa WebP: 286/380 dönüştürüldü, 216 MB → 93 MB (kazanç 123 MB)` ·
`✅ EMPP_READY_TO_SHOW enjekte edildi (pencere: mainWindow)` · `setBook 5/5` · `fs-shim 5/5`.

Ham bayt kazancı ~315 MB ama indirme kazancı 133 MB — çünkü NSIS/LZMA ölü JS'i zaten
iyi sıkıştırıyordu; WebP kazancı ise sıkıştırılamaz olduğu için birebir yansıyor.

**Açık kusur:** servis koşusunda electron-builder NSIS adımına geçmeden **exit 0** ile
çıktı (`collected node modules`'tan sonra sustu); aynı config elle koşulduğunda tamamlandı.
`runElectronBuilder` exit 0'ı çıktıyı doğrulamadan başarı sayıyor — [[cikis-kodu-basari-kaniti-degil]].

Tam takım: **423 test / 419 pass / 0 fail**.

## 2026-09-19 — K19: Windows hattı onarıldı + ilk örnek paket üretildi (sm4)

- **Arıza 1 — Windows derlemesi hiç çalışmıyordu.** `win.publisherName` electron-builder
  26'da KALDIRILMIŞ: `Invalid configuration object … unknown property 'publisherName'`
  → exit 1. Bu yol ajanda koşmadığı için (yetenekler `android,pardus`) sessizce çürümüş.
  Düzeltme: seçenek `win.signtoolOptions.publisherName` altına taşındı.
- **Arıza 2 — açılış yaması sm4'te sessizce atlanıyordu.** Yayıncı kabuğu
  `let mainWindow;` … `mainWindow = new BrowserWindow({` yazıyor; `PENCERE_REGEX`
  yalnız bildirimli kalıbı arıyordu → `⚠️ EMPP_READY_TO_SHOW atlandı — pencere-degiskeni-yok`.
  Eklenen `PENCERE_ATAMA_REGEX` lookbehind ile üye atamalarını (`obj.win = …`) eler ve
  değişkenin gerçekten bildirilmiş olmasını şart koşar. Testler 10 → 15, üç mutasyonla
  kanıtlandı (kalıp kaldır → 2 kırılır, bildirim şartı kaldır → 1, lookbehind kaldır → 1).
- **Üretim (sm4 kontrol):** `Super Monsters 4-1.13.8-Setup.exe`, **1451,5 MB**, 169 sn,
  `PE32 … Nullsoft Installer` doğrulandı. Hatta `✅ EMPP_READY_TO_SHOW enjekte edildi
  (pencere: mainWindow)`, `setBook 5/5`, `fs-shim 5/5`.
- **Not:** üretilen uygulama **Electron 27.3.11** kullanıyor (kayıtta 39 yazıyordu) —
  güvenlik borcu sanılandan büyük.
- **K16 domain yaması sm4'te NO-OP** (`baseEndpointUrl` yok, `yayincilik.net` yok) —
  bu örnek için İSTENEN davranış: `sorucoz.tv` yerinde kaldığı için güncelleme testi gerçek.

## 2026-09-18 — K16 yayıncı-domain yaması: sessiz NO-OP giderildi + Windows kapısı kaldırıldı

- **Ölçülen arıza:** Gerçek pakette `applyPublisherDomainPatch` kuru koşumu
  `yayıncı host türetilemedi (config'te *.yayincilik.net yok) — NO-OP` bastı;
  `publisherHost = null`. Yani yama aylardır hiçbir şey değiştirmiyordu.
- **Kök neden:** `derivePublisherHost` yalnız `*.yayincilik.net` kalıbı ve
  `testSolutionVideo.apiTemplate` üzerinden host türetiyordu. İncelenen iki pakette de
  ikisi de yok; ama `book1/app.config.js:243` → `baseEndpointUrl: "https://akillitahta.ydspublishing.com"` var.
- **Düzeltme:** `BASE_ENDPOINT_HOST_RE` eklendi ve `derivePublisherHost` içinde
  **1. öncelik** yapıldı (options > baseEndpointUrl > apiTemplate). `sorucoz.tv` ve
  `localhost` türetilen host olarak reddediliyor.
- **Ölçüm (gerçek config):** `publisherHost = akillitahta.ydspublishing.com`,
  1 dosyada 6 değişiklik, kalan `sorucoz.tv` = **0**. `updateBookEndPoint` artık
  yayıncının kendi ucunu gösteriyor.
- **İkinci değişiklik:** `packagingService.js` içindeki `platforms.filter((p) => p !== 'windows')`
  kapısı kaldırıldı — yama artık Windows dahil tüm platformlara uygulanıyor. Gerekçe:
  (1) motorun açılışta kendini güncelleme ucu (`updateBookEndPoint`) üçüncü tarafta kalıyordu;
  (2) ertelenmiş/arka plan güncelleme tasarımı o ucun bizde olmasına bağlı.
- **Test:** `yayinci-domain-yamasi.test.js` 17 → 22. Eski "Windows kapısı var" kilidi
  `GERİLEME: Windows HARİÇ gate'i KALDIRILDI` testine çevrildi. Her iki değişiklik de
  mutasyonla kanıtlandı (kural kaldırılınca 3 test, kapı geri konunca 1 test kırılıyor).
  Tam takım: **404 test / 400 pass / 0 fail / 4 skip**.

## 2026-09-17 — K18: ProBook kabul kapısı (paket açılmadan yüklenmez)

- **Kural (Nadir):** "her yaptığını pardus'ta aç. doğrulayıp öyle yükle." K17 sınıfı
  (14 SET paketi aylarca beyaz ekran) zenity + bütünlük + asar denetimlerinin HEPSİNDEN
  geçmişti — çünkü hiçbiri uygulamayı AÇMIYORDU.
- **Ne eklendi:** `tools/pardus/probook-kabul.sh` — üretilen `.impark` gerçek ProBook'a
  (etapadmin@192.168.1.55) kopyalanır, kurulur, açılır; kanıt toplanır (pencere adı,
  geometri, konsol, pencere ekran görüntüsü). `src/agent/runner.js` bu kapıyı
  `buildPardusArtifact`'ın sonunda, artifact kopyalandıktan SONRA / yüklemeden ÖNCE
  koşturur (`EMPP_PARDUS_KABUL=1`); rc≠0 → hata fırlar → R2'ye yükleme YOK.
- **Ölçülen yanlış kabul (ilk sürüm):** `pgrep -f 'DijiTap/DijiTap'` AppRun'ın KURULUM
  çocuklarını (cp/rsync, komut satırında aynı yol) da sayıyor; "surec=6" görüp KABUL
  verdi, ekran görüntüsünde Chrome vardı. Düzeltildi — geçerli kanıt: `/proc/<pid>/exe`
  kurulum dizinini gösteren süreç + ona ait görünür X penceresi (>300 px) + pencerenin
  gri standart sapması ≥ 0.02.
- **Kurulum önbelleği tuzağı:** AppRun `.empp-version` aynıysa paketi açmaz, ESKİ kurulumu
  çalıştırır. Kapı test öncesi mevcut kurulumları `.kabulgizli-<damga>` diye yeniden
  adlandırır (silmez), sonunda yeni kurulumu siler ve eskileri geri koyar.
- **Ölçüm (kanıt):** yeşil yol `Impact Grade 12` → pencere 20 sn'de açıldı, 1366x671,
  sapma 0.198, kitap 1/88 göründü → KABUL (rc=0). Kapı zaman aşımı gerçek: `runKabulBetigi`
  süreç GRUBUNU öldürür (`detached` + `kill(-pid)`), `spawn`'ın `timeout`u tek başına
  yetmiyordu (ssh/scp çocukları boruyu açık tutup `close`'u geciktiriyor: 400 ms kapı
  30 sn asılı kaldı — testle ölçüldü).
- **Testler:** `src/agent/runner-pardus.test.js` +6 test (kapı kapalıyken çağrılmaz,
  rc=0 geçer, rc≠0 fırlar, gerçek timeout, `timeoutMs` yasağı sentineli, kapı sırası).
  26/26 geçiyor.

## 2026-09-17 — K17: SET kök menüsü (beyaz ekran kökü)

- **Ölçüm (ProBook/Pardus):** sf425 `.impark` beyaz ekran. Boş `resources/app/build`
  SAHTE iz (AppRun her kurulumda açar, doldurmaz; içerik `app.asar`'da). Gerçek neden:
  SET kökü motorun tek-kitap `index.html` kopyası, kökte `assets/`+`classlibraries/` yok
  → `assets not found` + `ImWin32.dll okunamadı` → sonsuz "…". Super Monsters 2 Set'te
  de üretildi. Motor bundle'ında set modu YOK.
- **Kapsam:** CDN'deki APK'ların zip merkezi dizini menzil isteğiyle okundu → alt-kitaplı +
  kök index'i motor kopyası olan **14 set**: 45481 45482 45538 45541 45549 45550 45551
  45695 45704 45792 59834 59835 73581 73768 (apk/dmg/impark aynı kaynaktan → üçü de kırık).
- **Yeni:** `src/packaging/set-menu.js` (`ensureSetMenu`) + `set-menu.test.js` (10 test,
  `npm run test:set`'e eklendi → 132 test, 0 hata). Kökte menü yoksa üretir; ÖZEL menüye
  dokunmaz (Flashy 59480), motor sayfasını `index-motor.yedek.html` olarak saklar,
  idempotent, `app.config.js` ÜRETMEZ (K1 yasağı yerinde). `assets2/` varsa yayıncı
  tasarımı; yoksa sade menü — kapak `bookN/assets/<id>/thumbs/1.jpg`, ad
  `BookContent.xml`'deki `pdfUrl`'den türetilir.
- **Kanca:** `packagingService.js` — `ensureSetBookHomeButton`'dan sonra,
  `prepareElectronFiles`'tan önce. Kapı `EMPP_SET_MENU=1`, varsayılan KAPALI.
- **Pardus yolu:** `tools/pardus/pardus-packager-build.sh` — `EMPP_SET_MENU` konteynere
  geçirilir ve bu yolda varsayılan AÇIK; ayrıca `PARDUS_PARALEL=1` ile kilit/konteyner
  kapısı atlanabilir (varsayılan tek build kuralı değişmedi).
- **Saha kanıtı:** ProBook'ta kurulu sf425'in asar'ı açılıp menü konuldu → 4 kitap gerçek
  kapaklarıyla listelendi, ilk kitap 1/192 sayfayla açıldı.
- **Bekleyen karar (Nadir):** Android/macOS için kapıyı açmak (3001 paketleyici restart'ı ister).

# Changelog

## 2026-09-16 — Açık .dmg mac üretimini düşürüyordu (dmg birim çakışması kapısı)

**Belirti:** `Electron Builder mac build failed (exit code 1)` — mesaj imzayı/araç
zincirini suçluyor, yalan söylüyor.

**Kök neden (ölçüldü, 72378 mac):** electron-builder dmg'yi `/Volumes/<dmg.title>`
altına bağlar; `dmg.title` = `"<appName> <version>"`. Daha önce üretilmiş aynı adlı
bir `.dmg` Finder'da açıksa electron-builder'ın `hdiutil detach -quiet` denemesi
rc=2 alır, beş kez tekrar eder ve build düşer. Downloads'taki
`Lingoland Grade 2 … (1).dmg` ve Grade 3'ünki bağlıydı; Grade 2 ancak `-force` ile
ayrıldı.

**Düzeltme:** `src/packaging/dmg-birim-kapisi.js` — `runElectronBuilder` mac yolunda,
spawn'dan ÖNCE çakışan birimi `hdiutil detach` (gerekirse `-force`) ile bırakır;
bırakamazsa build'i hiç başlatmadan anlaşılır Türkçe hata verir. Birim adı config'ten
türetilir (`dmg.title`, yoksa `productName + sürüm`); yol ayıracı taşıyan ad reddedilir.

**Testler:** `src/packaging/dmg-birim-kapisi.test.js` — 10 test, 4'ü `GERİLEME:`
önekli. Sentinel (kapı spawn'dan önce çağrılıyor mu) mutasyonla doğrulandı: kapı
çağrısı silinince test kırılıyor. Takım: 341 geçti / 0 hata / 4 atlandı (atlananlar
gerçek Tudem ISO fixture'ı bu makinede olmadığı için, değişiklikle ilgisiz).

**Genel kural:** bir üretim kapısı, denetlediği işle ilgisiz bir zincire bağlıysa
kusurludur — burada zincir "kullanıcının Finder'da neyi açık bıraktığı"ydı.

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

## 2026-09-18 — Electron verimliliği: dil budaması, açılış yaması, sayfa WebP

**Ölçüm (Nadir'in "asar tuzaklı gibi" şüphesi doğrulandı).** `45472.impark` (Marvel 12 Set,
1.138 MB): `resources/app.asar` paketin **%91'i** (1.190 MB ham, 14.448 dosya, JSON başlık
3,51 MB); içindeki `assets/` 1.151 MB, motor yalnız 38,5 MB. Motor ve içerik TEK blokta →
tek sayfa düzeltmesi 1,04 GB yeniden indirme demek. Detay: `yukleyici-arastirma-2026-09-18.md`.

**1. Dil budaması** — `electronLanguages: ["tr","en-US"]` win/mac/linux üçünde de.
Electron 55 dil taşıyordu (`locales/`, ölçülen 9,0 MB sıkışmış).

**2. Açılış yaması** — `src/packaging/acilis-yamasi.js` (yeni): üretilen kitapta
`show:false` + `ready-to-show` + **8 sn emniyet zamanlayıcısı**. Üretilen şablonda bu
yoktu (`packagingService.js` BrowserWindow doğrudan `fullscreen:true`) → eski makinede
beyaz ekran çakması. **Atomik**: pencere değişkeni ya da `loadFile/loadURL` bulunamazsa
`show:false` DA konulmaz (yalnız başına konursa pencere HİÇ açılmaz — K18 sınıfı arıza).
Tuzak: satır sonu `//` yorumu tek satırlık `new BrowserWindow({...})` yazımında satırın
kalanını yutuyordu → blok yorum kullanıldı (gerileme testi var).

**3. Sayfa görselleri → WebP** — `src/packaging/sayfa-webp.js` (yeni), **kapı VARSAYILAN
KAPALI** (`EMPP_SAYFA_WEBP=1`). Dosya adı `.png` KALIR: motor uzantıyı sabitliyor
(`pages/{imageName}.png`) ama Chromium `<img>` için İÇERİĞE bakıyor — Chrome headless ile
ölçüldü (`naturalWidth=1659`, gerçek PNG ile birebir). mod1 şifresi (ilk 100 bayt, `256−x`,
involutif) çözülür → WebP q82 → yeniden şifrelenir. Korumalar: küçülmüyorsa özgün korunur ·
çıktı geri okunup doğrulanır · yalnız `assets/*/pages/*.png` (thumbs ve core dokunulmaz) ·
atomik yazım (geçici + rename). **Gerçek sayfalarda ölçüldü: 35/40 dönüştü, 14 MB → 7 MB
(%50), 20 sayfa/sn** (1.075 sayfalık kitap ≈ 54 sn).

**Testler:** `acilis-yamasi.test.js` (10) + `sayfa-webp.test.js` (12), ikisi de mutasyonla
kanıtlandı. Tam paket **399 test, 0 fail** (4 çevresel skip).

**AÇIK:** WebP kapısı ProBook'ta doğrulanmadan üretimde açılmaz — sayfa + büyüteç +
canvas yolu + Windows/Android aynı motorla kontrol. `LICENSES.chromium.html` (1,2 MB)
BİLEREK çıkarılmadı: Chromium lisansı atıf metnini dağıtmayı şart koşuyor.
