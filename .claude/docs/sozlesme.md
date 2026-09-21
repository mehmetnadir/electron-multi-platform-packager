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
| Pardus üretimi (`tools/pardus/pardus-packager-build.sh`) | build.zip → .impark (Docker, linux/amd64) | gömülü zenity ZORUNLU (yoksa paket reddedilir); disk kapısı 20 GB; `PARDUS_PARALEL=1` ile paralel | canlı |
| srv21 üretim şeridi (`tools/agent/serit-uret.js` + srv21 `/opt/lane-hazirla.mjs`) | bookId → srv21'de hazırlık+derleme → Mac'e `.impark` | Mac ajanı yalnız kabul kapısı + R2 yüklemesi yapar; `EMPP_PARDUS_HAZIR_DIR` altındaki paket `srcVersion` eşleşirse devralınır; scp portu `-P 2222` | canlı |
| linux deb hedefi (`EMPP_LINUX_DEB`) | build → AppImage (+ istenirse deb) | `.impark` yalnız AppImage'dan türer; `EMPP_LINUX_DEB=0` deb'i kapatır (1,5 GB gövdede xz 30+ dk) | canlı |
| SET kök menüsü (`ensureSetMenu`, K17) | SET build'i → kökte menü sayfası | yalnız kök motor kopyasıysa çalışır; özel menüye DOKUNMAZ; `app.config.js` üretmez | canlı (kapı `EMPP_SET_MENU=1`) |
| ProBook kabul kapısı (`tools/pardus/probook-kabul.sh`) | üretilen .impark → gerçek Pardus makinesinde kurulur + açılır | kapı düşerse paket R2'ye YÜKLENMEZ; ölçüt pencere + piksel sapması (süreç sayısı DEĞİL) | canlı (kapı `EMPP_PARDUS_KABUL=1`) |
| Windows kabul kapısı (`tools/windows/vm-kapi.js` + `src/windows/vm-kapi-karar.js` + `tools/windows/vm-kopru-sunucu.js`) | üretilen `.exe` → VMware Win11 VM'inde kurulur, açılır, ekran görüntüsü alınır | "Geçti" = çıkış 0 **ve** ekran görüntüsü **ve** süreç ayakta; sonuç gelmezse `zaman-asimi`, izleyici ölürse `bozuk`. Parola hiçbir yerde geçmez (`vmrun` guest işlemleri kimlik ister, snapshot istemez). Taşıma HTTP: Apple Silicon + Win11 ARM'da paylaşılan klasör YOK; sunucu yalnız `bridge*` arayüzüne bağlanır, yol öneki belirteç | araç hazır — misafirde izleyici tek seferlik elle başlatılır | **Çok makineli:** her makinenin kendi kuyruğu/kalbi/işareti vardır (`--makine <ad>`, varsayılan `vm` = Fusion misafiri); `calistir <komut>` ile uzak komut koşturulur (disk ölçümü/temizliği, sürüm sorgusu).
| alt-kitap uyarlamaları (K3/K5/K6/K9) | SET build'i → her `bookN` için shim, manifest, `setBook.enable`, ad-alanlı VFS | ad deseni değil motor imzası (`index.html`+`app.config.js`) ile bulunur | canlı |
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
| VM izleyici sürüm tespiti (`src/windows/izleyici-surum.js`, manuel runbook `tools/windows/YUKSELTME.md`) | guest'teki `vm-izleyici.ps1` metni + kalp dosyası → yükseltme gerekli mi | Üç bağımsız çapayla (arka-plan kalp/çoklu makine/doğrudan URL) sürüm tespiti; şüphede (boş/bozuk/okunamaz) kalp atışı DAİMA "bayat" sayılır. Guest'e otomatik dokunulamaz (parola guest'e girmez) — host tarafı karar modülü, elle yükseltme adımı YUKSELTME.md'de | canlı (saf modül), guest yükseltmesi ELLE |
| ilk sayfa geldiği gibi açılış (K25, `src/packaging/acilis-ilk-sayfa.js`) | bundle'lardaki güncelleme sorgusuna süre bütçesi (2,5 sn) + hata yakalama | Sorgunun `.catch`'i ve zaman aşımı yoktu: ağ düşünce `SET_CHECK_UPDATE` hiç gönderilmiyor, kitabı açan tek şey 5 sn'lik `setTimeout` güvencesi kalıyordu — yani ağsız makinede güvence NORMAL yoldu. Artık karar bilinir bilinmez açılıyor; 5 sn güvence yerinde ama erişilemez. sm4: 22 bundle / 22 çağrı | **kapı varsayılan AÇIK** (`EMPP_ILK_SAYFA=0`) |
| splash beklemesi (K26, `src/packaging/acilis-splash-beklemesi.js`) | bundle'lardaki `setTimeout(()=>ayarla(FR.LOADED),1500)` → süre 0 | Kitap açılırken üç gösterge arka arkaya geliyordu (3 nokta → logo splash → "Kitap Açılıyor.."); ortadaki SAF yapay beklemeydi — logo görseli zaten yüklenmişken 1500 ms daha tutuluyordu. Çağrı ve efekt koşulları korunur, splash iptal EDİLMEZ. `EMPP_SPLASH_MS` ile markalı duraklama verilebilir. sm4: 5 kitap / 31 bundle | **kapı varsayılan AÇIK** (`EMPP_SPLASH_BEKLEMESI=0`) |
| ikon saydamlığı (`src/packaging/ikon-saydamlik.js`) | kurum logosunun ETRAFINDAKİ düz zemin → saydam (Windows/Linux/macOS ikon yollarının üçü) | Kenardan taşma-doldurma: yalnız dışa bağlı zemin silinir, logonun İÇİNDEKİ beyazlar korunur; kenar için yumuşatma bandı. Dört kapı DOKUNMAZ: zaten saydam · köşeler tutarsız · neredeyse tamamı · ihmal edilebilir. Beyaz kutu kaynak logodan geliyor (YDS: 0/262.144 saydam piksel), paketleyiciden değil | **kapı varsayılan AÇIK** (`EMPP_IKON_SAYDAM=0`) |
| Windows mimarisi (`src/packaging/windows-mimari.js`) | `win.target` → `{target:'nsis', arch:[mimari]}`, varsayılan **ia32** | 32 bit uygulama 64 bit Windows'ta WOW64 ile koşar, tersi koşmaz → tek paket iki cihaz sınıfını kapsar. Çok mimarili tek exe reddedildi (açılmış ağaç iki kez gömülür, ~2,5 GB). Geçersiz `EMPP_WIN_ARCH` sessizce düşmez, uyarır | canlı |
| yükleyici davranışı (NSIS `customInit` + `CRCCheck off`, `packagingService.js`) | aynı sürüm zaten kuruluysa kurulum yapılmaz, kitap açılıp yükleyici çıkar; çift tıklamadan sonraki boş "verifying installer" ekranı kaldırıldı | `IfSilent` kapısı toplu/sessiz kurulumu etkilemez; yol kayıt defterinden okunur (sabit `C:\` YOK); `Exec` öncesi `SetOutPath` ŞART (`.onInit` içinde `$OUTDIR` boştur → süreç sessizce başlamaz). Bütünlük denetimi kaybolmaz, kuruluma taşınır | canlı |
| kademeli kurulum (planlandı) | paket → açılış kümesi (motor + data + her alt-kitabın ilk 10 sayfası) + arka plan kümesi | Açılış eşiği ölçüldü: 542 MB → 97 MB. İçerik `app.asar`'dan ÇIKMADAN mümkün değil | **tasarım — kod yok** |
| sayfa önbelleği (planlandı) | kitap açılınca arka planda kalan sayfaları mod1-çöz + önbelleğe yaz; **kanca `window.fetch` (ölçüldü) — `empp-fs-shim.js` `installFetch()` zaten orada** | Öncelik kuyruğu (atlanan sayfa öne alınır) · sayfa çevrilirken işçi durur · sürüm damgalı, kitap güncellenince düşer · disk tavanı şart | **tasarım — kod yok** |
| yükleyici (Inno Setup, planlandı) | build → per-user `%LOCALAPPDATA%` tek ekranlı imzalı kurulum | Soru sorulmaz, UAC yok, bitince otomatik açılır; imza 66902 yuvasından | **tasarım — kod yok** |

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

## Yapılmayacaklar

- SET için `app.config.js` / set konfigi üretmek (K1, Nadir kararı — geri alındı, `_graveyard`).
- Paralel ağır build'i varsayılan yapmak (srv21 paylaşılan üretim sunucusu — nazik build kuralı).
- Yayıncının kendi menüsü/özel index'i olan pakete dokunmak.

- **Uzaktan destek** (RustDesk/AnyDesk/TeamViewer) — Nadir 18.09: KAPSAM DIŞI.

## Açık Kararlar (Nadir'e)

- İkinci paralel üretim hattı için ajanın ikinci kimlikle kaydı (`AGENT_ENROLL_SECRET`).
- K17 menüsünde kitap adı kaynaktan (`BookContent.xml` `pdfUrl`) türetiliyor; panel/DB'deki
  gerçek kitap adlarına bağlanmalı mı?

## Değişiklik Günlüğü

| Tarih | Ne Değişti | Hangi Oturum |
|---|---|---|
| 2026-09-17 | İlk taslak; K17 (SET kök menüsü) + pardus paralel bayrağı + ProBook kabul kapısı (üretilen paket açılmadan yüklenmez) eklendi | 006cff11 |
| 2026-09-17 | srv21 üretim şeridi + `EMPP_LINUX_DEB`; scp portu (-P) onarıldı; kuyruk-boş temizliği taze uploads'u koruyor; ProBook kapısına disk ön-kontrolü + AppRun (`resolve_executable`) kapısı | 006cff11 |
| 2026-09-18 | pardus disk kapısı kaynak indirmeden ÖNCE soruluyor (gece 11 iş 1,5 GB'ı boşuna indirip düşmüştü) | 006cff11 |
| 2026-09-18 | Electron verimliliği: dil budaması + açılış yaması + sayfa WebP (kapılı). Ölçüm: paketin %91'i app.asar, %97'si assets/ | 006cff11 |
| 2026-09-18 | Kademeli kurulum + sayfa önbelleği + Inno Setup yükleyicisi sözleşmeye eklendi (tasarım). Ölçümler: `.claude/docs/yukleyici-arastirma-2026-09-18.md` §E-G | 006cff11 |
| 2026-09-19 | K20 ana ekran yolu düzeltmesi (Windows beyaz ekran) + K21 açılış ağ politikası (`window.fetch` sarmalı; `?id=undefined` engellenir, canlılık probuna motorun beyan ettiği 5000 ms uygulanır). Ölçüm: 3 nokta ekranının %91'i ağ | 006cff11 |
| 2026-09-19 | Pardus disk kapısı BOYUT ORANTILI oldu (`pardusGerekliDiskGb`: kaynak × 5, taban 15 GB) ve kapı düşünce satıra `failed` YAZILMIYOR (`ertelenebilirKaynakHatasi` → kira dolunca kuyruğa döner, ajan sıradaki işe geçer). Eski düz sabit 45 GB, 19 Eylül'de 8 işi sahte "PARDUS HATALI" yaptı | 006cff11 |
| 2026-09-20 | K24 sayfa ön-getirme (sayfa geçişindeki bekleme) + K25 açılış ikilisi: ana süreçte güncelleme ötelemesi, bundle'larda ilk-sayfa süre bütçesi. Kök bulgu: 5 sn'lik "güvence" ağsız makinede NORMAL yoldu — sorgunun `.catch`'i yoktu | 006cff11 |
| 2026-09-20 | K26 sabit splash beklemesi kaldırıldı (Nadir: "ölme eşşeğim ölme" — üç açılış göstergesi). Ayrıca paket güncelleme planı (Hat C: paket yapısı/yeni kitap) `.claude/docs/paket-guncelleme-plani-2026-09-20.md`'ye yazıldı; asar kilidi nedeniyle değişen içerik asar dışında olmalı | 006cff11 |
| 2026-09-20 | Windows kabul kapısı: VM sürücüsü + karar modülü (18 test) + guest izleyici; taşıma HTTP köprüsüne alındı — Fusion 13 Apple Silicon + Win11 ARM misafirde paylaşılan klasörü DESTEKLEMİYOR (panel yok, vmx'te hgfs satırı yok). Köprü yalnız bridge* arayüzüne bağlanır, belirteç yol önekiyle korunur (12 test, gerçek HTTP) | 006cff11 |
| 2026-09-20 | K27 üçüncü açılış göstergesi kaldırıldı (Nadir: "kalksın, hemen açılmalı"). Ölçüm: pakette "Kitap Açılıyor" 0, 5 sn güvence 0, işaret 10, "Kitap Güncelleniyor" 5 korundu. Ayrıca setId kararı plana yazıldı (panel üretir / elle girilebilir / global tekil / değişmez) | 006cff11 |
| 2026-09-20 | Katman 1: paket kimlik manifesti (`paket.json`) — Nadir'in setId kararı uygulandı. Gerçek derlemede doğrulandı: `SET-super-monsters-4-8c8fd0f9135a`, 5 kitap, paket parmak izi; app.asar içinde bulundu | 006cff11 |
| 2026-09-20 | Windows kapısı çok makineli: kuyruk/kalp/`BENDE` işareti makine bazlı ayrıldı (tek kuyrukta 8 görevin 1'i yanlış makineye gidiyordu), uzak komut (`calistir`) eklendi — Windows-Kasa x64 gerçek donanım kabul şeridi olarak devrede | 006cff11 |
| 2026-09-21 | Sayfa WebP satırı düzeltildi: kapı hâlâ varsayılan KAPALI ama 2026-09-20 23:30–09-21 elle koşan bir süreç ProBook kabulü olmadan üretime karıştı (SM4 Windows); `webp-kapi-uyarisi.js` artık açık kapıyı günlüğe basıyor. Sürüm normalleştirme (`surum-normallestir.js`, varsayılan AÇIK — `checkVersion` 4 parçalı sürümü koşulsuz eski sayıp ~350 MB boşuna indiriyordu) ve VM izleyici sürüm tespiti (`izleyici-surum.js`, manuel runbook) eklendi. Anlık yama katmanı (`yama-katmani.js`+`yama-defteri.js`) HENÜZ BAĞLANMADI | 006cff11 |

## Anlık yama katmanı (2026-09-21, HENÜZ BAĞLANMADI)

Kurulu uygulamaya birkaç KB'lik bir düzeltmeyi (ör. `index.html` **2.973 bayt** vs paket
1.890.051.700 bayt/13.677 dosya) yeniden kurulum olmadan uygulamak için iki modül yazıldı;
canlı paketleme yoluna **bilerek bağlanmadı**, kapı `EMPP_YAMA=1` ile varsayılan KAPALI.
Gerekçe: renderer `fs-shim` `fetch()`'i sarıyor ama **HTML navigasyonu fetch'ten geçmez**
(`file://`'dan okunur), depoda protokol kancası yoktu.

- `src/packaging/yama-katmani.js` — ana sürece `protocol.handle('file')` kancası enjekte eder,
  yol önce `userData/<YAMA_DIZIN>` altında aranır. Atomik (yarım enjeksiyon = pencere hiç açılmaz
  riskiyle hiçbir şey eklenmez), idempotent, `../`/mutlak yol kaçışı reddedilir.
- `src/packaging/yama-defteri.js` — `{surum, dosyalar:[{yol,sha256,bayt}]}` defterini çeker
  (zaman aşımlı), sha256 doğrular, geçici ada yazıp rename ile atomik koyar, bayt bütçesini
  (varsayılan 5 MB) aşarsa listeyi keser.

Yayıncının kendi güncelleyicisi açılışta zaten ~350 MB indiriyor (uygulamadan, ~99 sn bekletiyor);
bizim yolumuz İKİNCİ bloklayıcı güncelleme OLMAYACAK.
