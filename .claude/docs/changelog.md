## 2026-10-02 — Windows "imza bekliyor" tutma + imza eşiği (dal `imza-hold-20261002`)

- Eşik: yuva açıkken runner imza adımını (`_hazir` kopyası + imza kuyruğu kilidi + yuva penceresi) en çok
  `EMPP_WIN_IMZA_ESIK_DK` (varsayılan 5; 0 = eski "sonuna kadar bekle") bekler. Aşılırsa `imzaEsigiHatasi` →
  paket hazır kuyruğa (`hazirKoy`), `/release {durum:'imza-bekliyor'}`, runner sıradaki işe geçer. TAKAS
  başladıktan sonra betik ASLA kesilmez (tek yuva paylaşımlı; `komutKos` `yumusak` seçeneği). Kill switch
  `EMPP_WIN_IMZA_BEKLEME=0` eşiği de kapatır.
- Sunucu tutarsa (`tutuldu:true`; book-update `imza-hold-20261002`) satır running+kira bizde kalır, bekçi aynı
  jetonla `/result` yayınlar; eski sunucuda alan yok sayılır, satır kuyruğa döner, yeniden kiralanınca hazır
  kayıt devralınır (eski davranış). `currentJob` release'ten önce düşer (heartbeat lease tazelemesin).
- Bekçi: imzalı kabul KALDI → `reddedildi/` + `postResultFailure` (sunucudaki tutma kapanır).
- Test: `src/agent/runner-imza-hold.test.js` (8), `tools/windows/imza-bekcisi.test.js` (+2); mutasyonla doğrulandı.

## 2026-10-01 — Exe'siz kaynak: runner İmpark exe'sini HİÇBİR koşulda indirmez (dal `exesiz-runner-20261001`)

- Sözleşme: book-update `.claude/docs/exesiz-kaynak-sozlesmesi.md` (ONAYLI 01.10). Kaynak TEK SAF fonksiyondan:
  `src/agent/kaynak-karari.js` → (1) manuel build.zip (claim `kaynakTuru=manuel` ya da adres yolunda
  `/sources/` · `/kaynak/`; yol `.exe` ise manuel SAYILMAZ) — indirilir, OLDUĞU GİBİ kullanılır (merdiven +
  set eki ATLANIR, log satırıyla); (2) kaynak arşivi — bugünkü davranış; (3) yok → `releaseJob(… "build yok —
  exe'siz sözleşme: arşiv/manuel kaynak gerekli")` + `bildir kosucu` (kitap×platform başına 6 sa'te bir),
  `failed` YAZILMAZ, processJob `{ertelendi:true}` döner, ana döngü 15 sn bekler.
- Manuel zip biçimi: kök = build (açılmaz); içinde `resources/app/build/` olan eski 59480 tipi kurulum ağacı
  `unzip` + `findBuildDir` + `zipDir` ile build.zip yapılır (SFX açılmaz). İndirme `manuelZipIndir`
  (curl, `unzip -Z1` doğrulama).
- Kapanan exe yolları: asıl indirme + SFX açma + kaynak önbelleği HIT/MISS/populate + yayıncı güncellemesi
  (exe dalı) + disk kapısındaki HEAD (boyut yalnız yerel arşivden) + hazır pardus devri (`hazirPardusPaketi`
  hep null, dizin ayarlıysa bir kez uyarı). `downloadFile` yolu `.exe` olan adresi reddeder.
  `kaynak-isitici.js`/`isitici-dongu.js`/`local-build.js` kapıyla KAPALI (modüller silinmedi).
- `parseNextJob`: `downloadUrl` artık zorunlu değil (bookId + platform yeter), `kaynakTuru` taşınır.
- Windows şeridi aynı karardan geçer (onKosul + araç denetiminden sonra).
- Test: `kaynak-karari.test.js` (18), `runner-exesiz-kaynak.test.js` (18, gerçek processJob + casus
  `kaynakIndirme`), windows +1, parseNextJob +2; eski exe/önbellek/hazır paket pinleri yeni davranışa
  çevrildi. 14 mutasyonun hepsi yakalandı.
- İnceleme düzeltmeleri (b8d6bfa "DÜZELTME GEREKLİ"):
  - İçerik kapısı zip'i `adm-zip` ile değil `unzip -Z1` (merkez dizin, ZIP64) ile listeler: 2 GiB üstü zip
    artık `ERR_FS_FILE_TOO_LARGE` → "içeriksiz" olmaz; listelenemeyen zip AYRI sebep `[kaynak-okunamadi]`.
    Arşiv zip'i belleğe okunmaz. `__MACOSX/` · `._*` · `.DS_Store` (Finder sıkıştırması) yok sayılır; tek kök
    klasörlü Finder zip'i (`sarmalayici`) açılıp kök klasör build sayılır.
  - Build'siz iş: kitap başına bildirim yerine TEK özet ("N iş build bekliyor: …"), en çok saatte bir; son
    gönderim + bekleyenler `~/.empp-agent/kaynak-yok-bildirim.json`'da (yeniden başlatmada sel yok).
    Bırakma sonrası bekleme 15 sn → 2 sn (`AGENT_KAYNAK_YOK_BEKLEME_MS`).
  - `manuelZipIndir`: HTTP 4xx'te yeniden deneme YOK; tam inen geçersiz zip en çok 2 deneme; ilk 2 bayt `MZ`
    ise hemen exe hatası. Ağ/5xx yeniden denemesi kalır.
  - Windows: `kaynakKarari` artık `araclariDenetle`den ÖNCE — build yoksa iş failed değil, bırakılır.
  - `parseNextJob` `bilgiUrl`'yi taşır; `kaynakTuru:'arsiv-gerekli'` claim'i (downloadUrl yok) kabul edilir,
    manuel SAYILMAZ; arşiv bilgi notu `bilgiUrl`den beslenir.

## 2026-09-30 — Ajan kirası: erteleme kirayı bırakır + yetim kira istek kimliği (dal `kira-birak-20260930`)

- `fetchNextJob` her mantıksal istek için `X-Istek-Id` (UUID) gönderir; yanıt alınamazsa (ağ/zaman
  aşımı/5xx) kimlik korunur, sonraki deneme aynı kimlikle sorar → sunucu aynı işi döndürür (45482/android
  yetim kirası, 30.09 12:17Z). Yalnız 200/204 kimliği tüketir.
- Ertelenebilir dal (disk kapısı, başsız kabul ÖLÇÜLEMEDİ, noter/ProBook) artık `releaseJob` ile
  `POST /agents/:id/release` çağırır: iş kuyruğun sonuna gider, bu ajana 10 dk verilmez, başka ajan alır.
  Eski sunucu (404) / ağ hatası FIRLATMAZ — kira eskisi gibi 30 dk sonra döner.
- Sunucu tarafı: book-update dal `kira-birak-20260930`. Canlıya sıra: önce API, sonra runner restart.
- Test: `src/agent/runner-kira-birak.test.js` (5, sahte API); 4 mutasyonun hepsi yakalandı.
- İnceleme düzeltmesi (01.10): aynı `X-Istek-Id` en çok 3 denemede ya da ilk kullanımdan 5 dk sonra
  yenilenir (sunucu da kaydı 5 dk'dan sonra kabul etmez) — yavaş sunucu yolu ajanı tek işe kilitleyemez.
  Test 7; 7 mutasyonun hepsi yakalandı.

## 2026-09-30 — İmza sözleşmesi Windows paketleme sözleşmesine taşındı

Nadir: "exe imzalama sözleşmesini exe üretim sözleşmesinin içine ekle; birden fazla yerde imza süreci
varsa güncel bilgiyle değiştir". `windows-paketleme-sozlesmesi.md`'ye **İmza (Authenticode) — TEK
KAYNAK** bölümü: yol (İmpark 66902 yuvası, SMB), imza kimliği (DigiCert G4, İm Park Bilişim, bitiş
2027-07-03), ön koşullar, bekleme kuralı + toplu akış (26.09 kararları taşındı), doğrulama kapısı, iç
exe imzasız riski (ölçülmedi), ölü yollar (RDS1 `exe-imzalama`, Certum/DigiCert ertelendi, SignPath).
Bayat atıflar düzeltildi: karar belgesi 25.09, yükleyici araştırması, tek-kabuk planı, `sozlesme.md`
(70 kuru test / canlı koşu yok → 92 test / 26.09 canlı), uçtan uca sağlık, `OKU-imza-yuva-smb.md`,
CLAUDE.md. Kod değişikliği yok.

## 2026-09-27 (4) — Android cihaz katmanı: emülatörün KENDİ sistem ANR'si RED değil ÖLÇÜLEMEDİ

**Kanıt:** 72379 android başsız kabul 13:45–13:51Z RED aldı ("cihaz okuyucu: ekranda WebView
yok"), host aynı anda Rosetta altında Docker Electron + tam test takımıyla aşırı yüklüydü.
`android/logcat.txt`: `uiautomator dump` UiAutomation'a bağlanamadı (`FATAL EXCEPTION` +
"Timeout while connecting UiAutomation" — bu, system_server'ın kendisinin yanıt vermediğinin
kanıtı). `/sdcard/empp-kabul-ui.xml` hiç yazılmadı, `android/menu-ui.xml` 58 bayt "cat: …
No such file or directory" — düğüm sayısı 0 çıktı, mevcut `sistemDiyalogu` (aerr_* düğüm
taraması) hiçbir şey göremedi. `android/menu.png` ekranı ise "Process system isn't responding /
Close app / Wait" sistem diyaloğunu gösteriyordu — paket sağlamdı (cikarma/icerik/odak/guncellik
katmanları GEÇTİ), altyapı arızasıydı.

**Fix (`tools/kabul/android-cihaz.js`):** yeni saf tanıyıcı `sistemAnrMi({uiXml, logcat,
gorunurMetin})` — dump BAŞARISIZ olduğunda (kısa, `<hierarchy>` içermeyen metin) logcat'teki
"Timeout while connecting UiAutomation" imzasıyla birleştirip sistem ANR'sini tanır; UYGULAMANIN
KENDİ ANR'si ("<uygulama> isn't responding") eşleşmez, RED kalır. `asamaOlc` artık kısa/hatalı
dump metnini `son.uiXmlHata`'da saklıyor (gerçek büyük hiyerarşi dökümleri hiç dokunulmaz).
Yeni saf yardımcı `webViewYokKarari(ad, o, logcat)` `!o.webView` kararını RED/ÖLÇÜLEMEDİ arasında
ayırır ve mevcut `ortulen` mekanizmasına (emülatörün başka bir uygulamasının diyaloğuyla aynı yol)
katılır — genel karar `O.genelKarar` üzerinden zaten ÖLÇÜLEMEDİ'yi RED'e sıçratmıyor.
Testler: `tools/kabul/android-cihaz.test.js` (11, yeni dosya) — 72379 kanıtından birebir satırlar,
uygulamanın kendi ANR'si negatifi, dump-başarılı negatifi, mutasyon (logcat imzası kalkınca
RED'e döner), karar-birleştirme (cihaz ÖLÇÜLEMEDİ + diğerleri GEÇTİ → genel ÖLÇÜLEMEDİ).

## 2026-09-27 (3) — Süreli konteyner yedek kabul: ProBook elektrik kesintisiyle kapalıyken Docker fallback

**Karar:** Nadir 27.09 — ProBook elektrik kesintisiyle kapandı, ofise gidene kadar açılamıyor;
"yarına kadar fallback'i devreye al, bu bilgisayardaki docker üzerinden". Süreli bayrak
(`~/.empp-agent/pardus-konteyner-kabul.istek`, ilk satır bitiş ISO zaman damgası) AKTİFKEN VE
ProBook'a erişilemezken `src/agent/runner.js` `pardusKabulKapisi` ProBook betiğini hiç çağırmadan
bu Mac'teki Docker konteyner kapısına (`tools/pardus/konteyner-kabul.sh` → mevcut `konteyner-kapi.sh`,
imaj `pardus-kapi:3`) düşer; `pardusKabulErisimUygula`'ya eklenen `yedekAktif` alanı aynı süre
boyunca `pardus` yeteneğinin heartbeat'ten düşürülmesini de engeller. Süresi dolan bayrak silinmez,
yalnız yok sayılır — bayrak yokken davranış BİREBİR eskisiyle aynıdır. Sonuçlar (GEÇTİ/RED/
ÖLÇÜLEMEDİ) `~/.empp-agent/pardus-konteyner-kabul.log`'a TSV kaydı olarak eklenir — ProBook dönünce
hangi kitapların yeniden ProBook'ta kabul edilmesi gerektiğini bulmak için. Detay ve kapsam dışı
bırakılanlar (K4/E6-E7-E8 güncellik, SET_TUM, gerçek FUSE/AppRun yolu): `.claude/docs/gotchas.md`.
Testler: `src/agent/runner-pardus-yedek.test.js` (20), `tools/pardus/konteyner-kabul.test.js` (9);
mutasyon kanıtı elle doğrulandı (bypass koşulu geçici devre dışı bırakılıp entegrasyon testi
kırıldı, sonra geri alındı).

## 2026-09-27 (2) — Gece düşüşleri: android cihaz kabulü, paketleyici yoklaması, ProBook aktarımı

**Kaynak:** 26→27.09 gecesi `failed` yazılan 7 iş (android 45538, 45469, 45472, 45100, 45449;
pardus 45477). Hiçbiri paket kusuru değildi. Canlı `agent-mode @8be8c10` (27.09 10:48),
tam takım 927/928 (tek kırmızı `ensureDockerReady` yük zamanlaması, tek başına geçer).
- **Cihaz okuyucu sınırı 60 → 120 sn** (`tools/kabul/android-cihaz.js`, 8ca4cf4): yük altında
  emülatör ekranı 60 sn'de okunamıyordu (45538).
- **Aktivasyon serisinde ağ kapalı RED'i yeniden koşulur** (`basliksiz-kabul.js` `kosumAgi`,
  `agAcikYenidenKosulmali`, b689ae7): motorun kendi `isOnline` yoklaması ağ kapalıyken
  "Network is offline" veriyor ve etkinleştirme ekranına geçmiyordu. Yalnız bu imzada, ağ açık
  ve zip indirmesi kesik ikinci koşu yapılır; `AKTIVASYON_CIHAZ_MENU_SN = 150`.
- **Paketleyici yoklaması zaman aşımı geçici** (`runner.js` packagerPoll, `runner-helpers.js`,
  f71f20f): axios `ECONNABORTED`/timeout 6 denemeye kadar tekrar, sonra iş `failed` değil ertelenir.
- **İki aktarım yolu da düşerse ertele** (`probook-kabul.sh`, `probook-aktarim.sh`, eaa98a1):
  "RED: ProBook'a aktarim dustu" (ve eski "RED: kopyalanamadi") `probookErisilemezHatasi`
  sınıfında; `-q` kaldırıldı, ssh stderr `kanıt/aktarim.txt`'ye. Kök: 05:20Z'de Mac uyudu,
  aktarım yarıda kaldı, iş paket kusuru gibi `failed` yazıldı.
- Beş android satırı `pipeline-requeue` ile yeniden kuyrukta (10:50). Açık: srv21 aktarım yolu
  sabah 3 koşuda üst üste düştü (scp yedeği ~340 kB/s) — teşhis ayrı şeritte.
- **Pardus kabul erişim kapısı** (`runner.js` `probookErisimDurumu`/`guncelYetenekler`,
  `runner-helpers.js` `pardusKabulErisimUygula`): ProBook 11:10Z'den beri kapalıyken (Tailscale,
  60014 11:51→12:00 boşa derledi) her pardus işi kabul betiğinde (`probook-kabul.sh` `ssh …
  'echo hazir'`) RED verip 30 dk kirayla aynı döngüyü tekrarlıyordu — Windows imza yuvası
  kapısıyla (`imzaYuvasiDurumu`) birebir kalıp: TCP 22 60 sn önbellekle arka planda ölçülür,
  erişilemezse Mac heartbeat'te `pardus`u ilan etmez. Acil kapatma: `EMPP_PARDUS_KABUL_ERISIM=0`.

## 2026-09-27 — Kaynak arşivi: İmpark exe ADI kapısı kaldırıldı

**Karar:** Nadir 27.09 — "v47 → v51 gibi isim güncellemesi metodu çok kırılgan (insanlar
unutabiliyor), kullanmak istemiyorum." 26.09 "bayat arşiv kapısı" (`kaynak-arsivi.js`) arşivdeki
`impark_kaynagi` exe adını işin exe adıyla kıyaslayıp farkta işi düşürüyordu. Ölçüm: ad İmpark
`S_TestKitaplar.Adi`'dan gelir ("ShallWe8-v51", elle), aktivasyon/lisans değişikliğinde içerik
değişmeden de artar; gece 45482 android bu kapıda düştü, merdiven aynı işte içeriği zaten
güncelliyordu.
- `impark_kaynagi` yalnız BİLGİ: ad farklıysa tek log satırı, iş sürer; alan yok/bozuk hata değil;
  arşiv özetine (ProBook şeridi) girmez. Zip/boyut/md5 denetimleri aynen.
- Güncellik yalnız içerik sürümünden: ZipVersiyon (+ZKitapFileSize) → merdiven S0/S1 → kabul
  E7/K4/SET_TUM. Merdiven kapalıyken de ad kıyası yok (ad içeriği ölçmez; kabul yakalar).
- Nöbetçi: `kaynak-arsivi.test.js` "AD SÜRÜMÜ KARAR DEĞİL" — test dışı kodda ad sürümü güncellik
  kararına girmez (grep + mutasyonla doğrulandı). `runner-arsiv-bayat.test.js` →
  `runner-arsiv-ad-bilgi.test.js`.

## 2026-09-26 (7) — Akşam canlıya alma: G kanalı, Windows şeridi, içerik kapıları, kabul E6/E7/E8

**Yetki:** Nadir 26.09 ~18:45 — "karar aldığımız her şey canlıda olana kadar devam, testler dahil".
Tüm gün süren entegrasyon (`birlesik-20260926` → `birlesik2` → `birlesik3` → `agent-mode`)
akşam boyunca art arda canlıya alındı; son durum `agent-mode` = `cdb5ed4`, süreç kaynağı
`~/.empp-agent/arastirma/birlestirme-notlari-20260926.md`. run-agent.sh yedeği:
`~/.empp-agent/yedek/run-agent.sh.20260926-canliya-alma-oncesi`.

**Canlıya alınan parçalar:**
- **G kanalı istemcileri — mac/Pardus örtü + Windows yerinde + Android; Android EKLEME kapıda RED:**
  monoton sürüm + set kimliği + "ya hep ya hiç" tüm kiplerde birleşti (`e07bc37`, `445fed5`,
  `9d49ead`); üç güvenlik açığı kapandı — Docker'a claim alanları+açık anahtar, tabansız/
  anahtarsız pakete enjeksiyon YOK, renderer fs-shim örtü okuma (`b82f76d`..`3a37126`,
  `95b879e`). Android istemcisi (RouteProcessor katmanı, EmppG eklentisi, üç güvenlik kuralı)
  geldi (`8101b3e`, `a7ff0b6`) ve Android paketlerinde AÇILDI (`EMPP_SET_GUNCELLEME`'ye `android`,
  Nadir: "tüm paketlerde güncelleme istemcisi olsun"). Manifest her eklemeyi sonraki yayınlara
  taşıdığından bir ekleme sonrası o setin Android'i hiçbir G güncellemesini (motor dahil)
  alamıyor — kalıcı donma riski; koruma g-yayin `--ekle` KAPISINDA: anahtarsız `--ekle` RED,
  bilinçli geçiş yalnız `--android-ekleme-dondurur-kabul` (dal `g-yayin-android-kapi`,
  `233854f`, agent-mode'a merge bekliyor). Kalıcı çözüm Nadir A/B seçimi (öneri:
  `~/.empp-agent/arastirma/g-android-kitap-ekleme-onerisi-20260926.md`).
- **Claim sürüm / monoton taban:** mac ve Android G tabanı artık HTTP yolunda claim sürümünü
  `empp-set.json`/`empp-g-paket.json`'a yazıyor (`012760d`, merge `0959b20`); ProBook yerel
  şeridi Docker eşiyle aynı G kimliğini taşıyor (`19a94e3`). Sürümün kalıcı kaynağı book-update
  DB'sindeki `paket_sayaci` — packager yalnız okur.
- **Windows şeridi (runner):** üretim + 13 G'lik kapı + kabul + **sıralı imza** +
  **Authenticode doğrulama**, SONRA R2'ye yükleme (`d825123`); gerçek zip fikstürüyle
  doğrulandı — düz metin `build.zip` fikstürü içeriksiz-kaynak kapısını geçiyordu (`f353aea`);
  eski üreticinin manifesti G istemcisinde RED bekleniyor (D-2, `3a10a29`). Canlı env:
  `EMPP_RUNNER_WINDOWS=1` + `AGENT_CAPS`'a `windows` (imza yuvası evden erişilemezse ilan
  edilmez → evde güvenli).
- **İçerik kapısı (dizin + zip):** içeriksiz kaynağın paketlenmesini engelleyen kapı artık
  arşiv VE önbellek-HIT (zip) yollarında da çalışıyor (`d4023dc`, `7579a75`, merge `62df779`);
  acil kapatma anahtarı `EMPP_ICERIK_KAPISI` (`6cf0b23`, tanımsız/`1` = açık). Canlı ölçüm:
  7 zip'ten 4 GEÇER/3 RED (45550/45551/11845 bilinen + yeni bulgu), yanlış-RED yok.
- **İmpark içerik merdiveni S0/S1:** kitap içeriğini İmpark'ın son sürümüne otomatik
  yükseltir — S0 üretim başında her `bookN` için İmpark sürümünü sorar, S1 geride kalanlara
  en yeni `ZKitapZipH`'yi uygular, kök korunur (`2d3d5cf`, merge `23a909e`); anahtar
  `EMPP_ARSIV_MERDIVEN` (varsayılan kapalı, canlıda AÇIK). `menuCoz` artık iki menü biçimini
  (127/17 ve 27/5) çözüyor — Lingoland 72378/73581 düzeltmesi (`42e3982`).
- **Kabul E6/E7/E8 (ProBook canlı):** CDP (`--remote-debugging-port`) ile kitap açılıp
  `GetKitapGuncellemeBilgi` yakalanıyor (E6/E7), **ayrı HOME zorunlu** (E8) çünkü gerçek ev
  eski paketi de GEÇTİ sayıyor — canlı ölçüm: gerçek ev v36 gördü rc=0 (yanlış GEÇTİ),
  ayrı ev v33 gördü rc=3 (doğru GÜNCEL-DEĞİL) (`6df85e0`, `69ce84f`, merge `0054fa6`). Canlı
  env: `KABUL_CDP=1` (ayrı ev varsayılan açık; kapalıysa E7 ÖLÇÜLEMEDİ sınıfına düşer).
- **Motor kanonik:** 43e23... motor sürümü artık iki Pardus şeridinde (Docker + ProBook
  yerel) aynı `~/.empp-agent/motor/kanonik.json` kaynağından geliyor, `paket.json.motorSurumu`
  sha12 kanıtı taşıyor — E3/T6/D-1 (`7d8ec97`, merge `592da3a`).
- **WebP içerik önbelleği (~90x):** sayfa PNG→WebP dönüşümüne kaynak-md5 tabanlı içerik-adresli
  önbellek eklendi — 20 sayfalık ölçümde 87,8 sn → 0,98 sn (`4c60666`, merge `8a1c40a`).
  Anahtar `EMPP_WEBP_ONBELLEK` (tanımsız = varsayılan dizin + açık, `0` = tamamen kapalı),
  tavan `EMPP_WEBP_ONBELLEK_GB` (varsayılan 30 GB, en eski erişilen budanır).
- **g-yayin dosyalar[] / fs-shim / menü:** `ekle` girdisine imzalı `dosyalar[]` listesi kondu
  (`90d7a58`/`525f1fd`, merge `48776eb`); G ile eklenen kitabın `index.html`'ine
  paketleyicinin fs-shim'i otomatik enjekte ediliyor — ortak modül
  `src/packaging/fs-shim-subbook-html.js` (`823c84a`, merge `bc1ef52`); SET kök menüsü
  (Web-Z kartları + K17 kök index.html) `--ekle`/`--cikar` ile tutarlı güncelleniyor,
  tanınmayan menü biçimi RED (`098515f` set-menu-bicim.js, `01938fe`, merge `f119b3c`);
  Android ucu (manifest+sürüm+dosya) g-yayin'den üretiliyor, tek imza paylaşılıyor
  (`4eb3be4`, merge `4977990`).
- **Eski G üreticisi karantinası (D-2):** `packagingService.js`'in artık hiçbir tüketicisi
  kalmayan eski G paketleme çağrısı kaldırıldı — kanıt: runner artık G tar'ı yüklemiyor,
  istemci `kanal-g-degil` RED ediyor; 4 dosya `_graveyard/2026-09-26-g-eski-uretici/`'ye
  taşındı (git izliyor) + `OKU.md`, D-2 SENTINEL + `olu-yol-kapisi` KARANTİNA listesine
  eklendi (`360555e`, merge `579585e`).
- **Yükleme kanıtı (sha256+boyut):** runner R2'ye PUT'tan ÖNCE dosyanın sha256+boyutunu
  akışla hesaplayıp `/result`'a ekliyor, hata durumunda uyarı basıp yüklemeye devam ediyor
  (`7271e8b`); e2e `db-kanit` adımı book-update DB'sindeki bu değerleri CDN'deki gerçek
  dosyayla karşılaştırıyor (`1cc9513`, merge `b815be8`). Karşı taraf (book-update) migration
  024 (`file_sha256`) ile bunu kabul ediyor.
- **e2e sağlık koşucusu — gece launchd HENÜZ KURULMADI:** uçtan uca sağlık iskeleti + statik
  paket denetçisi (T1-T5, K1/K2, `7f8c6de`, merge `86e1154`), Android G denetimi + gece koşusu
  sarmalayıcısı + launchd şablonu (`320af49`, `02ddaa7`, merge `bc6e271`), sonra canlı koda
  bağlama (`kesif.js`: pipeline-sql→CDN URL, 8 ölçüm; `7dc0ed3`, `a160b2f`, merge `c3bec09`,
  son `cdb5ed4`). **Neden kurulmadı:** ilk elle koşuda (121 sn) T1-T5 hepsi ÖLÇÜLEMEDİ çıktı —
  gerekçelerin bir kısmı o an bayat (g-electron henüz birleşmemişti); her gece yüksek
  öncelikli sahte kırmızı bekçi güvenini kırar (bkz. gate-system.md "Bekçi Güven Gate") →
  önce koşucu canlı veriye bağlandı, gerçek satır (74390 demo kaydı) gelene kadar
  `launchctl bootstrap` bilerek ERTELENDİ (plist hazır: `~/Library/LaunchAgents/
  com.empp.e2e-saglik.plist`, `plutil` ile doğrulandı).

**Canlı env (run-agent.sh, bu akşam eklenen/değişen):** `EMPP_SET_GUNCELLEME=windows,macos,linux,android`
· `EMPP_ICERIK_GUNCELLEME=mac,windows` · `EMPP_ARSIV_MERDIVEN=1` · `KABUL_CDP=1` ·
`EMPP_RUNNER_WINDOWS=1` + `AGENT_CAPS` içine `windows` eklendi. `EMPP_ICERIK_KAPISI` ve
`EMPP_WEBP_ONBELLEK` run-agent.sh'ta tanımlı değil — kod varsayılanları zaten AÇIK.
`EMPP_PROBOOK_SERIT` bilerek run-agent.sh'a KONMADI (bkz. Kalan açıklar).

**Kalan açıklar (canlıya alınmadı / karar bekliyor):**
- **Android G ekleme kalıcı donma riski:** manifest her eklemeyi sonraki yayınlara taşıdığından
  bir ekleme sonrası set Android'de hiçbir G güncellemesi (motor dahil) alamıyor; K17 kök
  `index.html` değişikliği de Android'de RED olabilir (ölçülmedi). Nadir'e 3 soru + 4 seçenek
  (A: tek manifest + kitap başına android arşiv adresi — ÖNERİLEN; B: ayrı imzalı Android
  manifesti; C: cihazda dönüşüm — önerilmez; D: eklemede android ucu yok) —
  `g-android-kitap-ekleme-onerisi-20260926.md` (150 satır).
- **Başsız kabul K4:** mac/android/windows başsız kabulünde güncellik katmanı (E7'nin eşi)
  yok; dal `kabul-k4-basliksiz` açıldı, `KABUL_K4` anahtarı varsayılan kapalı olacak.
- **ProBook şeridi kayıt sırrı:** `EMPP_PROBOOK_SERIT` şeridi koda bağlandı (`13acb01`,
  LAN-yalnız arşiv eşleme + yetim onarımı + kuru koşu) ama run-agent.sh'ta kayıt sırrı +
  LAN arşiv eşlemesi doğrulanana kadar AÇILMADI — Nadir'de bekleyen, dokunulmaz.
- **Panel kodu olmayan kitaplar sürüm kuralı:** 57 Windows kitabının 26'sında panel adında
  `vNN` yok (Flashy, Lingoland, Gold, Fen fasikülleri) → claim sürümü yok, runner Windows işi
  görünür hatayla düşer; öneri (panel kodu yoksa `2.0.<sayaç>`) Nadir'in kararını bekliyor.
- **G sürüm ad alanı tekilleştirme:** g-yayin manifest sürümü ile book-update `paket_sayaci`
  aynı sayaçtan artmazsa aynı `2.51.N` iki farklı içeriğe işaret edebilir; sonraki iş bu
  numarayı yalnız DB'nin vermesi (aynı özetle farklı içerik RED). Bu gece G yayını bilinçli
  olarak yalnız 74390 + `--onayli` ile sınırlı tutuldu.

## 2026-09-26 (6) — Pakete girmeyecekler: Windows politikası dört platformda, tek liste

**Nadir:** "diğer os'ların paketlerini üretirken windows paketinde uyguladığımız gereksizleri atma
politikasını onlarda da uygulamalıyız." Liste `src/packaging/paket-disi-liste.js`'e taşındı;
win/mac/linux `files` dizileri `...paketDisiListe.elektronBuilderDesenleri('<platform>')` yayar,
Android `www` kopyası `www-copy-exclude.js` → aynı modül. Yeni: mac/linux'ta `build/` ve
`**/temp/data/storage.im`; Android'de kök `temp/`, `uploads/`, `build/`, `storage.im`. Windows dizisi
birebir aynı. Muafiyet yok — madde başına kanıt modülde ve `platform-kanallari-sozlesmesi.md`'de.
Ölçüm (45549, 4 storage.im): gerçek APK 5533→5529 girdi, 981 554 294→981 550 793 B; 73581 kaynak
arşivi temiz (3796 dosya, dört platformda önce=sonra). Sentinel okuyucu: `paket-disi-liste-sentinel.js`.

## 2026-09-26 (5) — Windows sözleşmesi açık iş 2 + 5: sessiz derleme başarısı + kök `_` dizin sızıntısı

**Yetki:** Nadir onayıyla Şef (nadir-b8), ayrı çalışma ağacı (`_worktrees/win-acik-isler`,
dal `fix/win-acik-isler-20260926`). Sözleşme `.claude/docs/windows-paketleme-sozlesmesi.md`
"Üretimi etkilemeyen açık işler" madde 2 ve 5'i kapatır.

**Açık iş 2 — makensis sessiz başarı:** `runElectronBuilder()` yalnız Windows'ta,
electron-builder sıfır-dışı çıkış verdiğinde çıktı dizininde HERHANGİ bir `*Setup.exe`
var mı diye bakıp varsa "başarılı" sayıyordu (updateInfoBuilder'ın zararsız hatasını
tolere etmek için yazılmıştı) — ama bu, dosyanın BU derlemede üretildiğini hiç
doğrulamıyordu: makensis GERÇEKTEN başarısız olup ÖNCEKİ bir derlemeden kalma bir
Setup.exe duruyorsa, o ESKİ dosya teslim ediliyordu. İki katman düzeltme:
  (a) `runElectronBuilder`: spawn ANI kaydedilir; win'de sıfır-dışı çıkışta yalnız
      çıktı dizininde mtime'ı SPAWN ANINDAN yeni bir `*Setup.exe` varsa UYARIYLA
      kabul edilir (`⚠️ exit N ama Setup.exe bu derlemede üretildi …`), ad/sürüm
      burada doğrulanmaz; dosya yoksa ya da yalnız ESKİ (spawn'dan önceki) bir dosya
      varsa reddedilir. **NOT (ilk turda aşırı gidilmişti, Şef düzeltmesi 2026-09-26):**
      sıfır-dışı çıkışı KOŞULSUZ reddetmek denendi ama `packageWindows()` config'i
      `publish: {provider:'generic', url:'https://example.com'}` taşıdığı için
      updateInfoBuilder'ın ZARARSIZ ağ hatasını da (Setup.exe GERÇEKTEN üretilmiş
      olsa bile) reddediyordu — win-özel dalın asıl var oluş nedeni tam bu tolerans
      olduğu için mtime şartlı kabule geri dönüldü.
  (b) `src/packaging/windows-setup-dogrulama.js` (yeni) — derleme BAŞLAMADAN önce
      çıktı dizininde duran her `.exe`'yi SİLMEDEN `.eski-<ts>` sonekiyle kenara alır
      (`eskiCiktiyiKenaraAl`); derleme bitince bulunan installer'ın mtime'ının bu
      derlemenin başlangıcından yeni olduğunu VE adının beklenen
      `${appName}-${appVersion}-Setup.exe` (electron-builder'ın kendi `artifactName`
      şablonuyla birebir) olduğunu doğrular (`dogrula`) — tutmazsa anlaşılır Türkçe
      hata, eski dosya silinmez. (a) taze ama YANLIŞ adlı bir dosyayı geçirse bile
      (b) adı doğrulayıp reddeder — iki katman BİRLİKTE kapatıyor.
  Testler: `windows-derleme-sessiz-basari.test.js` (8: exit0, exit≠0+dosya-yok,
  4 senaryo — eski/taze-doğru-ad/taze-yanlış-ad/exit0+eski, mutasyon kanıtı,
  kaynak-sentinel), `windows-setup-dogrulama.test.js` (12).
  Mutasyonla doğrulandı (iki kez — ilk sürüm ve düzeltme sonrası ayrı ayrı):
  spawn-anı tazelik koşulu kaldırılınca "ESKİ exe reddedilmeli" senaryosu +
  mutasyon-sentinel testi düşüyor (kanıt: görev raporu).

**Açık iş 5 — kök `_` dizinleri pakete sızıyor:** `set-kabuk.js`'in güncelleme kanalı
beyaz listesi `_` ile başlayan KÖK dizinleri (ör. SM2 `_eski/`) zaten dışlıyordu, ama
İLK PAKETLEME (build'in kendisi) tamamen ayrı bir kod yolu olduğu için bu dışlamayı
hiç görmüyordu — dört platformun hepsinde (windows/macOS/linux-pardus'un
electron-builder `files` dizisi, Android'in `fs.copy` filtresi). Tek tanım:
`src/packaging/kok-yedek-dizin-disla.js` (yeni) — deseni `set-kabuk.js`
`YEDEK_DIZIN_DESENI`'nden BİREBİR alır (kopya regex yok), iki tüketici biçimi sunar:
`elektronBuilderDesenleri()` (glob: `!_*`, `!_*/**/*`) ve `fsCopyFiltresi(srcRoot)`
(yalnız kök segment, yalnız dizin — `bookN/_x` motor dosyalarına dokunmaz). Beş çağrı
noktasına (win/mac/linux `files[]`, android'in iki `fs.copy` filtresi) tek yerden
bağlandı. Testler: `kok-yedek-dizin-disla.test.js` (8) — gerçek `app-builder-lib`
`FileMatcher` sınıfıyla davranış testi dahil. Mutasyonla doğrulandı: wiring satırları
kaldırılınca BAĞLANTI + fan-out-sapması testleri düşüyor.

**Yan etki (düzeltildi):** `www-copy-exclude.test.js`'teki iki kaynak-sentinel testi
artık birleşik filtre (`birlesikFiltre(createWwwCopyFilter(...), fsCopyFiltresi(...))`)
yüzünden eski tek-satır regex'i yakalamıyordu — testler blok-tabanlı arama ile
güncellendi (davranış aynı, yalnız arama biçimi).

**Kapsam dışı bırakılan (bilerek):** PWA paketleme yolu (`fs.copy(workingPath, pwaPath)`,
~satır 3790) hiçbir filtre taşımıyor — görev kapsamı yalnız windows/macOS/linux-pardus/
android idi, PWA'ya dokunulmadı (mevcut, önceden var olan bir boşluk).

**Test sayıları (Şef düzeltmesi sonrası, güncel):** değişen alan 4 dosya, standalone
33/33 pass (`windows-setup-dogrulama` 10, `kok-yedek-dizin-disla` 8,
`windows-derleme-sessiz-basari` 8 — 5'ten 8'e çıktı, dört senaryo + mutasyon kanıtı
eklendi —, `www-copy-exclude` 7). Bu 4 dosya AYNI ANDA koşulunca `node:test`'in bilinen
IPC seri hâle getirme sorunundan (bkz. `capacitor-splash.test.js` emsali) 1 test
"deserialize" hatasıyla düşüyor — dosya tek başına koşulunca 0 fail; gerçek regresyon
DEĞİL. `npm run test:set` 122 → 145 (140 pass, 5 skip — K15 root/uid, değişmedi). Tam takım
(`npm test`) iki kez koşuldu: ilk turda (katman a "koşulsuz red" hâliyle) 1794 test/
1785 pass/3 bilinen ön-var-olan FAIL; düzeltme sonrası (+3 yeni senaryo testiyle) 1797
test/1789 pass/2 FAIL — ikisi de bilinen `_graveyard/` yokluğu (`windows-asarsiz.test.js`
B4, `capacitor-config.test.js`), `capacitor-splash.test.js` IPC titreşimi bu turda hiç
tetiklenmedi (flaky, tek başına her zaman 5/5). 0 YENİ FAIL, 6 skip (değişmedi).

---

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
