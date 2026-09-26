# Platform Kanalları Sözleşmesi — macOS dmg · Android apk · Pardus .impark  `[SÖZLEŞME: TASLAK]`

> Taslak: 2026-09-26 (oturum 006cff11). Onay Nadir'in. Girdi `kitap-kaynak-sozlesmesi.md`'den gelir, burada
> tanımlanmaz. Windows ayrı ve ONAYLI: `windows-paketleme-sozlesmesi.md`. Kurulu dosyanın güncelliğini izleyen
> bekçi ayrı sözleşmede yazılıyor. Kanıt tabanı (commit/health/DB/log) ve tarihli ölçüm ayrıntıları →
> `docs/arastirma/platform-kanallari-kanit-20260926.md`.

## Amaç
Tek build klasöründen (geçişte İmpark exe'si) üç platform paketini tek hatta üretmek:
üret → platform kapısı (imza · noter · disk · bütünlük) → kabul (paket açılıp ölçülür) → R2 → pipeline satırı → portal.
Kabulden geçmeyen paket R2'ye gitmez. Aktivasyon kanalı ezilmez. Her adım masada görünür.

## Ortak özellikler — dört platform (KARARLANDI, Nadir 2026-09-26)
Nadir'in beyanı spec'tir; Windows (`windows-paketleme-sozlesmesi.md`) dahil dört platformu bağlar.

| # | Kural | Bugün (26.09 15:10, ölçüldü) | Eksik |
|---|---|---|---|
| O1 | **Üretim yeri:** Pardus ProBook'ta (indir, paketle, kabul, temizlik, yükle); ProBook'a ulaşılamazsa Mac Docker. Windows, dmg, apk bu Mac'te. | Pardus fiilen Mac Docker'da; ProBook yalnız kabul. ProBook şeridi hazırlanıyor (runner bağlantısı, kurulum, kuru koşu) | ProBook `build_agents` kaydı: enroll sırrı srv21 `.env`'de, Nadir verir |
| O2 | **Motor temizliği Windows'taki gibi:** index'ten ulaşılmayan, üst üste yazılmış webpack çıktıları (her kitapta 13 `*.main.js`) atılır; pakete girmeyecekler listesi tek kaynaktan. | Dört platformda açık: `olu-motor-temizligi.js` (varsayılan açık, pardus konteynerine `EMPP_OLU_TEMIZLIK=1` geçer) + `paket-disi-liste.js` (f63500c) | — |
| O3 | **Uzaktan güncelleme (G), bizim kanalımız:** kök `index.html`, index'le eklenen/çıkarılan kitaplar (set bileşimi) ve her kitabın **ANA klasöründeki** `43e23fce2b7009474555a77.js` değişir (kapsam detayı O4). Arayüzden nasıl tetikleneceği **SONRA** kararlaştırılacak (Nadir 26.09); sunucuda manifest yokken istemci sessizdir (hata basmaz, bekler). | Yalnız Windows'ta kod var (`src/runtime/kitap-guncelleyici.js`), KAPALI | Üretim ed25519 anahtarı **ÜRETİLDİ** (karar defteri A5, KAPANDI); `EMPP_SET_GUNCELLEME=windows`. mac/android/pardus'ta istemci hâlâ yok — anahtar hazır, sarmalayıcı eksik. Gövde salt-okunur: mac `.app` imzası, APK assets, AppImage squashfs; **"kurulum klasörü" tanımı (Nadir 26.09):** Windows/Pardus'ta kurulum dizini (yazılabilir), macOS'ta `.app` imzalı + yazılabilir yer `~/Library/Application Support/<app>/`, Android'de uygulamanın kendi veri alanı. G bu yazılabilir yere imzalı bir örtü yazar; kabuk açılışta imzası geçerli ve daha yeni örtü varsa onu yükler |
| O4 | **Motor `43e23fce…js` güncelliği index'le birlikte bizde:** bizim derlememiz kanonik (24.09 karar 2, `tek-kabuk-ve-guncelleme-plani-2026-09-24.md`), G kanalıyla dağıtılır. **Kapsam (Nadir 26.09):** G yalnız kitabın **ANA** klasöründeki kopyayı değiştirir; kitap index'i yalnız kendi dizinindekini çağırır. `htmletk/…/etk/` kopyaları **KAPSAM DIŞI**, G dokunmaz. | 73581 ölçümü: kök kopya `1bcb5b8c…`, dört kitap kopyası `f4437153…` (aynı, ANA klasör — G burayı hedefler), etkinlik kopyası `1c6096ef…` (üç farklı sürüm tek pakette, `htmletk/…/etk/` — kapsam dışı) | G istemcisi (O3) |
| O5 | **Kitap içeriği İmpark güncellemeleriyle (K):** `GetKitapGuncellemeBilgi` → `ZKitapZipH`. | Android çalışıyor (74451); Pardus 26.09'da açıldı (`a0cc28d`); Windows (bizim NSIS) kod var, Windows'ta ölçülmedi; mac KAPALI | mac kapısı + başsız kabulde K senaryosu; Windows'ta bir ölçüm |

Sonuç (itiraz, 26.09): G istemcisi olmayan paket sonradan uzaktan güncellenemez. 26.09 YDS koşusunun mac, android ve pardus paketleri G'siz çıkıyor; G gelince kullanıcılar bir kez daha yeni paket kurmalı. Koşu durdurulmadı, çünkü canlıdaki bozuk index'li paketler daha kötü.

**Ortam (KARARLANDI, Nadir 2026-09-26):** paketleme/kabul ağır işleri (derleme, başsız kabul, tam test, emülatör) makine geneli 2 slotlu semafordan geçer (`~/.empp-agent/agir.sh`); başsız kabul kendi odak-ölçümüyle pencere çalmadığını doğrular. Detay: `sozlesme.md` Başsız kabul satırı.

## İşlevler
| İşlev | Ne yapar | Nerede koşar | Masada nerede |
|---|---|---|---|
| İş kiralama | `next-job` ajanın yeteneklerindeki platformu verir. Canlı tek ajan Mac (`mac,android,pardus`); `Server21-linux` (android) son nabız 09-09 | `build-agents.ts:217-228`, `run-agent.sh:10`, `build_agents` (DB) | Yayınla → "Bu Mac (ajan)" etiketi yerel `run-agent.sh`'tan (`05-yayinla.md:36`); sunucudaki yetenek/nabız YOK (`04-bu-mac-guncelleme.md:67-69`) |
| Kaynak | Köprüdeki İmpark exe'si ya da elle atanmış `sources/` adresi. Ajan yalnız SFX içindeki `resources/app/build`'i kabul eder, build zip'i ALMAZ | `build-agents.ts:289-300`, `runner.js:617-626,684` | Yayınla → 2 · Kaynak (`05-yayinla.md:34,46-47`) |
| Kaynak önbelleği | Kitap + kaynak sürümü başına tek `build.zip`, üç platform paylaşır. Yayıncının okuyucu güncellemesi paketleme anında uygulanır, SET köküne açılmaz (baefe86) | `runner.js:1731-1839`, `run-agent.sh:75` | masada YOK |
| Paketleme | mac/android → 3001 HTTP; pardus → Docker betiği (HTTP yok) | `runner.js:1846-1862` | Bu Mac → 3001 sağlığı (`04:35`); Docker/pardus derlemesi YOK (`04:70-71`) |
| Sürüm damgası | Ajan `1.0.0` verir, paketleyici içerik + kod + kapı parmak izinden `1.<a>.<b>` türetir | `runner.js:1842`, `packagingService.js:447`, `surum-turet.js:231-243` | YOK |
| Kabul | Paketi açıp ölçer. RED → yükleme yok, `failed`. ÖLÇÜLEMEDİ → yükleme yok, `failed` yazılmaz, kira dolunca kuyruğa döner | mac/android bu Mac (`basliksiz-kabul-kapisi.js`); pardus ProBook K18 (`runner.js:1571-1601`) | YOK: kanıt `~/.empp-agent/kabul-kanit/` (eklenecek ekran) |
| Yayın | R2 PUT → `/result`: `completed`, `build_method='build'`, `<platform>_enabled=1`; aynı klasördeki başka adlı eski paket SİLİNİR; yerel çalışma dizini silinir | `runner.js:481-537,1872-1898`, `build-agents.ts:660-712` | Yayınla → 4 · ilerleme (5 sn yoklama) + "Doğrula" (R2 Range GET) (`05:37-38`) |
| Yalnız yerel üretim | Sunucuya yazmadan apk/dmg → `~/Uretim/<id>-<ad>/` | 3001 (`05-yayinla.md:50`) | Yayınla → 5; pardus yalnız komut satırı notu (`05:40`) |
| Platform açma | "İndirme platformları" adımı android/mac kuyruğunu açar | `08-set-menusu-proxy-menusu.md` | Set menüsü ekranı |

## Platform matrisi
| Soru | macOS dmg | Android apk | Pardus .impark |
|---|---|---|---|
| Kaynak | köprü exe → `resources/app/build`; build zip hedef (kod yok) | aynı | aynı; hazır paket varsa kaynak hiç inmez (`runner.js:1749-1752`) |
| Üretim yeri | Mac ajanı; yalnız ofiste (geçit 192.168.1.254) ya da `macos-serbest.istek`; Xcode aracı kırıksa yetenek düşer (`runner.js:112-115`, `runner-helpers.js:178-196`) | Mac ajanı (srv21 ajanı 09-09'dan beri sessiz) | Mac Docker (canlı) · hazır devralma (srv21 şeridi) · ProBook şeridi (devrede değil) · srv21 fallback (kod yok) — §Pardus şeridi |
| İmza | Developer ID + hardened runtime (`run-agent.sh:19-20`) | `assembleDebug`, derleyen makinenin debug anahtarı (`packagingService.js:3308`) | yok; squashfs bütünlüğü (`runner.js:1540-1543`) + zenity kapısı (`pardus-packager-build.sh`) |
| Noter | notarytool + stapler ZORUNLU, düşerse yüklenmez; geçici sınıf ertelenir (`runner.js:88-90,1240-1323`); profil `empp-notary` (`run-agent.sh:21`) | — | — |
| Disk kapısı | yok | yok | kaynak×5, taban 15 GB, indirmeden ÖNCE; düşerse `failed` yazılmaz (`runner.js:1763-1780`) |
| Kabul | başsız, bu Mac, odak çalmadan; codesign+stapler+spctl de ölçülür | başsız + pencerisiz emülatör (`Pixel_Fold_API_35`) | ProBook K18; başsız listede YOK (`run-agent.sh:42`) |
| R2 yolu | `softwares/<id>/<Başlık> - <Yayınevi>.dmg` | `… .apk` | `… .impark`, `application/x-appimage` (`agent-result-upload.ts:36-76`) |
| Pipeline satırı (DB) | `build`: completed 42 · failed 3 · queued 1; NULL 11 | `build`: completed 47 · queued 1 | `build`: completed 18 · failed 17 · queued 14 · running 1; `download` 3 (Tier 0 artığı) |
| Portal | `/go/<kod>/mac` | `/go/<kod>/android` | `/go/<kod>/pardus` |
| Kurulu uygulama nasıl güncellenir | Öz-güncelleme YOK: yeni dmg elle sürüklenir. Kitap içeriği kanalı K KAPALI: güncelleme iner, açılmaz (`tek-kabuk-…plani:18-21`) | Yeni APK üstüne kurulur; versionCode şablonda 1, paketleyici yazmıyor (grep 0); aynı imza şart. Kitap içeriği K8 bulut + K9 ölçülmeyen bağlantıda otomatik (`sozlesme.md:57-58`) | Yeni .impark: AppRun `.empp-version` kıyası; paket büyükse eski kurulum `mv` ile kenara, yeniden kurulur (`apprun-template.sh:95-135`). K KAPALI. Ağdan öz-güncelleme YOK |
| Aktivasyon farkı | `ImWin32.dll` fs-shim ile `~/Library/Application Support/<app>/work/`; makine kimliği ilk MAC (`masaustu-mobil-paketleme.md:31,39`) | VFS `localStorage` (`pm clear` siler), makineId `"{}"` sabit (`…:54`); SET'te kitap başına ad-alanı (`paket-yapilari…:142-144`) | gerçek fs, veri `~/.empp-work` (`apprun-template.sh:114`); ProBook kapısı aktivasyon serisinde renk eşiği aramaz (`runner.js:1709-1718`) |
| Masada | Yayınla + Doğrula; ofis kısıtı ve noter sonucu görünmez | Yayınla + Doğrula + yerel üret | Yayınla + Doğrula; Docker, ProBook, hazır dizin görünmez |

Not: Atlas/Waypoint 9'un kabuk öz-güncelleme manifesti ayrı üründedir (`interactive-software/kabuk/electron/kabuk-guncelleme.js:1-30`).
Bu hattan geçen her Pardus paketinin çalışma zamanı Electron `^27`'dir (`packagingService.js:1302`); o manifest bunu paketten okumalı.

## "Üret, bekle, onaylanınca yayınla" — bugünkü hâl
- Ara durum YOK. Kabul GEÇTİ → aynı işte R2'ye yazılır, `completed`, portal düğmesi açılır (`runner.js:1869-1874`, `build-agents.ts:677-708`). Kuyruğa iş koymak hâlâ yayına onaydır; onayı artık otomatik kapı veriyor.
- Başsız kabul runner'da 26.09 09:24Z'den beri açık (`run-agent.sh:41-42`; kod varsayılanı KAPALI, `basliksiz-kabul-kapisi.js:9,32`). Kapı CLI'ı her işte diskten okunur, runner yeniden başlatılmadan güncellenir.
- İlk canlı sonuçlar (73768/72378/59835) ve yanlış-pozitif oranı (ÖLÇÜLMEDİ) → araştırma dosyası.
- Geri alma yok: yeni paket aynı ada yazılır, başka adlı eski paket silinir (`build-agents.ts:667`), ajan çalışma dizinini siler (`runner.js:1898`). İnceleme için R2'den geri indirilir.

## SET paketleri (apk/dmg/impark açılmama) — bugünkü durum
| Katman | Durum | Kanıt |
|---|---|---|
| Alt kitaba shim, manifest, ad-alanlı VFS (Android K3-K6b, Electron K9, K10) | kodda | 58b7797 (09.09) |
| Kökte menü yoksa koru (K17); Web-Z kabuğuna dokunma | kodda, `EMPP_SET_MENU=1` | 29b8fc8 (24.09), `run-agent.sh:26` |
| Yayıncı güncellemesi SET kökünü ezmesin; ezilmişse iş hatası | kodda | baefe86 (26.09 10:43) |
| Kabul: mac/android başsız, pardus ProBook | canlı | `run-agent.sh:41-42,58` |
| Kaynak: köprüdeki exe'lerde kanonik kabuk yok (49 set kaydı) | AÇIK: 13 YDS setinin build zip'i İmpark'a yüklenmeyi bekliyor | `tek-kabuk-…plani:133-142` |

Paketleyici tarafı kapandı. Açık olan iki şey var: kaynak kabuğu ve 26.09 öncesinde R2'ye çıkmış SET paketleri (kaçının bozuk olduğu ÖLÇÜLMEDİ). 26.09 saha kanıtı (59835/73768) → araştırma dosyası.

## Pardus şeridi (23.09 + 24.09 kararları)
| Şerit | Karar | Bugün |
|---|---|---|
| ProBook yerli (birincil) | 24.09 karar 1-5: kendi jetonu, otomatik eşikli devir, sıkı sıra, Tailscale | kod 420f21e; `build_agents`'ta ProBook YOK (kayıt sırrı Nadir'de); `serit-secimi.js` runner'a bağlı değil (`serit-secimi.js:11-12`) |
| Mac Docker (yedek; bugün tek şerit) | 24.09 karar 2 | canlı; DEB kapalı (`pardus-packager-build.sh:121`) |
| Hazır devralma (srv21 şeridi) | 17.09 | 16 paket (18-20.09, 13 GB) bekliyor; 5'i kuyruktaki işe ait (11811, 11845, 45481, 45541, 59834); devralma yalnız `srcVersion` kıyaslar, paketleyici commit'ine bakmaz (`runner.js:1662-1680`) |
| Kanal 1 zorlama bekçisi | 23.09 §1 | YOK: `pardus-hat-bekcisi.sh` ve `com.empp.pardus-hat` yok |
| srv21 fallback | 23.09 §2-3 | kod YOK (API'de `srv21-fallback` 0 eşleşme); "aynı üretim" ön şartı sağlanmıyor (`tek-kabuk-…plani:35-41`) |

Bu belge 23.09'daki "kanal 1"i "ProBook ya da Mac Docker" diye yeniden tanımlar. srv21 fallback açık karar 5'tedir.

## Veri ve sınırlar
Ölçülen mac/android/pardus/R2 süre-boyut değerleri (norm değildir) → araştırma dosyası.

## Pakete girmeyecekler — Windows politikası dört platformda (KARARLANDI, Nadir 2026-09-26)
> *"diğer os'ların paketlerini üretirken windows paketinde uyguladığımız gereksizleri atma politikasını onlarda da
> uygulamalıyız."*
- Liste TEK kaynaktan gelir (`src/packaging/paket-disi-liste.js`); windows/macos/linux electron-builder `files` dizileri `...paketDisiListe.elektronBuilderDesenleri('<platform>')` yayar, Android `www` kopyası `www-copy-exclude.js` → `fsKopyaFiltresi(…, 'android')`; kopya liste yasak (`paket-disi-liste.test.js`).
- Kapsam: `node_modules`, kök `temp/`, `uploads/`, `build/`, `**/temp/data/storage.im` (yayıncının kendi kullanıcı verisi, G2), `_` önekli kök dizinler. Bir madde bir platformda kırılma riski taşırsa modülde o platform `platformlar`dan çıkar ve `muafiyet` gerekçesi yazılır.
- 26.09 öncesi: mac/linux'ta `build/` ve `storage.im` dışlanmıyordu; Android yalnız `node_modules` + `.git`.
- 26.09 denetimi — MUAFİYET YOK, dört madde dört platformda:
  - `build/` mac/linux: electron-builder buildResources'ı DİSKTEN okur (`readdir`/`path.join(buildResourcesDir)`), `files`'tan bağımsız; mac entitlements/ikon/dmg arka planı `build/` dışından mutlak yol. `workingPath/build/`e yalnız Windows yazar (NSIS, `icon.ico`). Android: web kökü sarmal `build/` olamaz (yükleme açılırken tek sarmal dizin köke alınır, `queueService`).
  - `storage.im`: motor `existsSync||saveStorage({})`; mac/linux/windows yazma fs-shim ile WORK'e, Android empp-android-shim VFS'ine. storage.im'siz kaynaklar (45538, 45482, 73581) dört platformda zaten çıkıyor. Davranış farkı (G2'nin amacı): yayıncının ayarları/son sayfası/"tur tamamlandı"sı yeni kullanıcıya taşınmaz.
  - Android kök `temp/`: göreli çıktı yolunda electron-builder çıktısı + tek kitapta kullanıcı verisi; `uploads/`: motor yerel `uploads/` okumaz.
  - Bilinen biçim farkı (davranışı değiştirilmedi): kökteki `_x.js` DOSYASI electron-builder'da `!_*` ile dışlanır, Android'de kalır (kaynaklarda örneği sıfır).
- Ayrı karar (bu maddeye dahil DEĞİL): kayıpsız sayfa WebP bugün yalnız Windows'ta; diğer platformlar ProBook / cihaz ölçümünden sonra.

## Kapılar (kod varsayılanı → canlı değer, `run-agent.sh`)
| Bayrak | Kod varsayılanı | Canlı | Not |
|---|---|---|---|
| `EMPP_BASLIKSIZ_KABUL` + `_PLATFORMLAR` | KAPALI; liste 4 platform (`basliksiz-kabul-kapisi.js:27,32`) | `1`, `macos,android` (:41-42) | tavan 20 dk |
| `EMPP_PARDUS_KABUL` | KAPALI (`runner.js:104`) | `1` (:58); ProBook önce LAN, yoksa Tailscale (:68-72) | tavan 45 dk (:74) |
| `AGENT_NOTER_ZORUNLU` | AÇIK (`runner.js:90`) | tanımsız, yani AÇIK | `0` yalnız acil geri dönüş |
| `PARDUS_DISK_KAT` / `_TABAN_GB` | 5 / 15 (`runner.js:1767-1768`) | tanımsız | `PARDUS_MIN_FREE_GB` BOŞ kalır (:49-57) |
| `EMPP_SET_MENU` | Pardus betiğinde 1 (`pardus-packager-build.sh:116`) | `1` (:26) | |
| `EMPP_ICERIK_GUNCELLEME` (K) | AÇIK (`icerik-guncelleme.js:77-78`) | `windows` (:36), yani üç platformda KAPALI | açık karar 6 |
| `EMPP_SET_GUNCELLEME` / `EMPP_SAYFA_WEBP` | AÇIK / KAPALI | `windows` / `windows` (26.09, anahtar üretimiyle `0`→`windows`) | mac/linux/android eklenince genişler |
| Canlı 3001 | `/api/health` kapıları yukarıdakiyle aynı; commit 2484677 ≠ HEAD b363059 | | fark: belge, imza betiği, kabul CLI'ı (her işte diskten okunur) |

## Açık kararlar (Nadir — tek tek sorulur)
1. **Kabulden geçen paket insan onayı beklemeden yayına çıksın mı?** Öneri: evet; kanıt masada görünsün, ilk 20 RED/GEÇTİ elle doğrulanana kadar her RED bildirim olarak gelsin. Gerekçe: 72378 RED'inin gerçek olup olmadığı bilinmiyor, oran ölçülmedi.
2. **Önceki paket geri dönüş için saklansın mı?** Öneri: evet, `softwares/<id>/_onceki/` altında son 1 sürüm, silme yerine taşıma. Gerekçe: bugün bozuk paket fark edilirse tek yol 5-60 dk'lık yeniden üretim; build zip'te "son 2 sürüm" kuralı var.
3. **Pardus AppRun paketi "büyükse" değil "farklıysa" mı kursun?** Öneri: evet, kıyas `paket.json` üretim zamanıyla. Gerekçe: içerik-hash sürümü sıralanamaz (`surum-turet.js:241-242`), `sort -V` kıyası (`apprun-template.sh:125`) yeni paketi yaklaşık yarı olasılıkla "eski" sayıp kurmaz. Kod okumasıyla çıkarıldı, ProBook'ta iki ardışık paketle ÖLÇÜLECEK.
4. **16 hazır Pardus paketi Silinecekler'e taşınıp devralma kapatılsın mı?** Öneri: evet; devralma ProBook şeridiyle paketleyici commit eşitliği şartıyla geri açılır. Gerekçe: paketler baefe86'dan önce üretildi, tek koruma ProBook kabulü.
5. **srv21 Pardus fallback'ı (23.09) uygulansın mı?** Öneri: hayır, ProBook + Mac Docker ikilisiyle kapatılsın. Gerekçe: iki bağımsız şerit var, srv21 paketleyicisi Mac'ten ayrışmış, srv21 paylaşılan üretim sunucusu (nazik build kuralı).
6. **İçerik kanalı K Pardus'ta açılsın mı (`windows,linux`)?** Öneri: evet, macos imzalı derlemede ölçülünce eklensin. Gerekçe: bugün mac/Pardus'ta kitap güncellemesi iner ama açılmaz; ProBook'ta 57806 v2→v4 geçti.
7. **Android APK'ya artan versionCode ve kalıcı, yedekli bir imza anahtarı verilsin mi?** Öneri: evet, versionCode = panel sürüm kodu × 1000 + sayaç. Anahtar bugünkü debug anahtarı kalsın, yedeği alınsın. Gerekçe: anahtar kaybolursa kurulu APK'lar güncellenemez.
8. **Kabuldeki "aktivasyon bekleniyor" işareti keypanel.db'den mi gelsin?** Öneri: evet. Gerekçe: runner başlık regex'i kullanıyor (`runner.js:1714`), kaynak sözleşmesi keypanel diyor (`kitap-kaynak-sozlesmesi.md:49-53`).

## Yapılmayacaklar
Kabulsüz yükleme · `AGENT_NOTER_ZORUNLU=0`'ı kalıcı yapmak · aktivasyon kanalına (ImWin32.dll, imKeys.dll) dokunmak ya da kod/anahtar gömmek · bayat paketleyici kopyasıyla üretmek · srv21'de ağır derlemeyi varsayılan yapmak · düz disk/önbellek sabitlerini geri koymak · paketleyicide SET menüsü/konfig uydurmak (K1) · m- zip'i kaynak almak.

## Uygulama durumu (26.09)
- Kod var ve canlı: noter kapısı, Pardus disk kapısı, ProBook kabulü, başsız kabul (macos+android), SET düzeltmeleri, sürüm türetme, Android K8/K9.
- Kod var, devrede değil: ProBook şeridi (kayıt + runner yaması), `serit-secimi.js`.
- Kod yok: build zip'i kaynak alma (runner SFX bekliyor), hold durumu, kabul kanıtı ekranı, artefakt geçmişi, srv21 fallback, kanal 1 bekçisi, hazır devralmada commit kontrolü, Android versionCode, AppRun hash-güvenli kıyas.

## Eskiyen belgeler
Dosya:satır → ne değişmeli listesi → araştırma dosyası (`docs/arastirma/platform-kanallari-kanit-20260926.md`).
