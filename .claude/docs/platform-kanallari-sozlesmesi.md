# Platform Kanalları Sözleşmesi — macOS dmg · Android apk · Pardus .impark  `[SÖZLEŞME: TASLAK]`

> Taslak: 2026-09-26 (oturum 006cff11). Onay Nadir'in. Girdi `kitap-kaynak-sozlesmesi.md`'den gelir, burada
> tanımlanmaz. Windows ayrı ve ONAYLI: `windows-paketleme-sozlesmesi.md`. Kurulu dosyanın güncelliğini izleyen
> bekçi ayrı sözleşmede yazılıyor. `book-update/.claude/docs/pardus-hatti-sozlesmesi.md` (23.09) kararları
> §Pardus şeridi'ne bağlandı. Kanıt tabanı: HEAD `b363059`, canlı 3001 `2484677` (`/api/health`, 09:24Z başladı),
> DB `pipeline-sql` 26.09 13:05, `~/.empp-agent/agent.log` 26.09.

## Amaç
Tek build klasöründen (geçişte İmpark exe'si) üç platform paketini tek hatta üretmek:
üret → platform kapısı (imza · noter · disk · bütünlük) → kabul (paket açılıp ölçülür) → R2 → pipeline satırı → portal.
Kabulden geçmeyen paket R2'ye gitmez. Aktivasyon kanalı ezilmez. Her adım masada görünür.

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
- Ara durum YOK. Kabul GEÇTİ → aynı işte R2'ye yazılır, `completed`, portal düğmesi açılır (`runner.js:1869-1874`,
  `build-agents.ts:677-708`). Kuyruğa iş koymak hâlâ yayına onaydır; onayı artık otomatik kapı veriyor.
- Başsız kabul runner'da 26.09 09:24Z'den beri açık (`run-agent.sh:41-42`; kod varsayılanı KAPALI,
  `basliksiz-kabul-kapisi.js:9,32`). Kapı CLI'ı her işte diskten okunur, runner yeniden başlatılmadan güncellenir.
- İlk canlı sonuçlar: 73768 mac ÖLÇÜLEMEDİ (25 sn, NODE_OPTIONS arızası, d5add17 ile düzeldi); 72378 android RED
  (Electron katmanı GEÇTİ, emülatörde "ekranda içerik yok"); 59835 android GEÇTİ (270 sn). Yanlış-pozitif oranı ÖLÇÜLMEDİ.
- Geri alma yok: yeni paket aynı ada yazılır, başka adlı eski paket silinir (`build-agents.ts:667`), ajan çalışma
  dizinini siler (`runner.js:1898`). İnceleme için R2'den geri indirilir.

## SET paketleri (apk/dmg/impark açılmama) — bugünkü durum
| Katman | Durum | Kanıt |
|---|---|---|
| Alt kitaba shim, manifest, ad-alanlı VFS (Android K3-K6b, Electron K9, K10) | kodda | 58b7797 (09.09) |
| Kökte menü yoksa koru (K17); Web-Z kabuğuna dokunma | kodda, `EMPP_SET_MENU=1` | 29b8fc8 (24.09), `run-agent.sh:26` |
| Yayıncı güncellemesi SET kökünü ezmesin; ezilmişse iş hatası | kodda | baefe86 (26.09 10:43) |
| Kabul: mac/android başsız, pardus ProBook | canlı | `run-agent.sh:41-42,58` |
| Kaynak: köprüdeki exe'lerde kanonik kabuk yok (49 set kaydı) | AÇIK: 13 YDS setinin build zip'i İmpark'a yüklenmeyi bekliyor | `tek-kabuk-…plani:133-142` |
| 26.09 saha | 59835 SM2 Set: pardus ProBook GEÇTİ, android GEÇTİ, mac noterli (kabul öncesi). 73768: pardus GEÇTİ, mac yeniden kuyrukta | `agent.log` |

Paketleyici tarafı kapandı. Açık olan iki şey var: kaynak kabuğu ve 26.09 öncesinde R2'ye çıkmış SET paketleri
(kaçının bozuk olduğu ÖLÇÜLMEDİ).

## Pardus şeridi (23.09 + 24.09 kararları)
| Şerit | Karar | Bugün |
|---|---|---|
| ProBook yerli (birincil) | 24.09 karar 1-5: kendi jetonu, otomatik eşikli devir, sıkı sıra, Tailscale | kod 420f21e; `build_agents`'ta ProBook YOK (kayıt sırrı Nadir'de); `serit-secimi.js` runner'a bağlı değil (`serit-secimi.js:11-12`) |
| Mac Docker (yedek; bugün tek şerit) | 24.09 karar 2 | canlı; DEB kapalı (`pardus-packager-build.sh:121`) |
| Hazır devralma (srv21 şeridi) | 17.09 | 16 paket (18-20.09, 13 GB) bekliyor; 5'i kuyruktaki işe ait (11811, 11845, 45481, 45541, 59834); devralma yalnız `srcVersion` kıyaslar, paketleyici commit'ine bakmaz (`runner.js:1662-1680`) |
| Kanal 1 zorlama bekçisi | 23.09 §1 | YOK: `pardus-hat-bekcisi.sh` ve `com.empp.pardus-hat` yok |
| srv21 fallback | 23.09 §2-3 | kod YOK (API'de `srv21-fallback` 0 eşleşme); "aynı üretim" ön şartı sağlanmıyor (`tek-kabuk-…plani:35-41`) |

Bu belge 23.09'daki "kanal 1"i "ProBook ya da Mac Docker" diye yeniden tanımlar. srv21 fallback açık karar 5'tedir.

## Veri ve sınırlar (ölçülen değerler norm değildir; `agent.log` 26.09)
- mac: 72380 tek kitap 5 dk 20 sn / 0,41 GB · 59834 set 12 dk 38 sn / 1,46 GB · 59835 set 59 dk 49 sn / 0,78 GB (noter dahil).
- android: 73768 5 dk 15 sn / 0,67 GB (kabulsüz) · 59835 6 dk 32 sn / 0,69 GB (kabul 270 sn) · 72378 kabul RED 348 sn
  (emülatör açılışı 73 sn, kurulum 156 sn).
- pardus: 72380 5 dk 23 sn / 0,34 GB (ProBook 248 sn) · 73768 10 dk 14 sn / 0,74 GB (80 sn) · 59835 7 dk 12 sn / 0,70 GB (313 sn).
  Bloktest 2,2 GB: Mac Docker 1025 sn, ProBook yerli 367 sn, yerel kabul 51 sn (`pardus-seridi-probook-plani…:8-20`, `sozlesme.md:32`).
- R2: 300 MB üstü çok parçalı, 64 MB parça (`runner.js:389-390`); ofiste 25 MB/s, dışarıda 4 MB/s (`run-agent.sh:94-97`).

## Kapılar (kod varsayılanı → canlı değer, `run-agent.sh`)
| Bayrak | Kod varsayılanı | Canlı | Not |
|---|---|---|---|
| `EMPP_BASLIKSIZ_KABUL` + `_PLATFORMLAR` | KAPALI; liste 4 platform (`basliksiz-kabul-kapisi.js:27,32`) | `1`, `macos,android` (:41-42) | tavan 20 dk |
| `EMPP_PARDUS_KABUL` | KAPALI (`runner.js:104`) | `1` (:58); ProBook önce LAN, yoksa Tailscale (:68-72) | tavan 45 dk (:74) |
| `AGENT_NOTER_ZORUNLU` | AÇIK (`runner.js:90`) | tanımsız, yani AÇIK | `0` yalnız acil geri dönüş |
| `PARDUS_DISK_KAT` / `_TABAN_GB` | 5 / 15 (`runner.js:1767-1768`) | tanımsız | `PARDUS_MIN_FREE_GB` BOŞ kalır (:49-57) |
| `EMPP_SET_MENU` | Pardus betiğinde 1 (`pardus-packager-build.sh:116`) | `1` (:26) | |
| `EMPP_ICERIK_GUNCELLEME` (K) | AÇIK (`icerik-guncelleme.js:77-78`) | `windows` (:36), yani üç platformda KAPALI | açık karar 6 |
| `EMPP_SET_GUNCELLEME` / `EMPP_SAYFA_WEBP` | AÇIK / KAPALI | `0` / `windows` (:32,37) | |
| Canlı 3001 | `/api/health` kapıları yukarıdakiyle aynı; commit 2484677 ≠ HEAD b363059 | | fark: belge, imza betiği, kabul CLI'ı (her işte diskten okunur) |

## Açık kararlar (Nadir — tek tek sorulur)
1. **Kabulden geçen paket insan onayı beklemeden yayına çıksın mı?** Öneri: evet; kanıt masada görünsün, ilk 20 RED/GEÇTİ elle
   doğrulanana kadar her RED bildirim olarak gelsin. Gerekçe: 72378 RED'inin gerçek olup olmadığı bilinmiyor, oran ölçülmedi.
2. **Önceki paket geri dönüş için saklansın mı?** Öneri: evet, `softwares/<id>/_onceki/` altında son 1 sürüm, silme yerine
   taşıma. Gerekçe: bugün bozuk paket fark edilirse tek yol 5-60 dk'lık yeniden üretim; build zip'te "son 2 sürüm" kuralı var.
3. **Pardus AppRun paketi "büyükse" değil "farklıysa" mı kursun?** Öneri: evet, kıyas `paket.json` üretim zamanıyla. Gerekçe:
   içerik-hash sürümü sıralanamaz (`surum-turet.js:241-242`), `sort -V` kıyası (`apprun-template.sh:125`) yeni paketi yaklaşık
   yarı olasılıkla "eski" sayıp kurmaz. Kod okumasıyla çıkarıldı, ProBook'ta iki ardışık paketle ÖLÇÜLECEK.
4. **16 hazır Pardus paketi Silinecekler'e taşınıp devralma kapatılsın mı?** Öneri: evet; devralma ProBook şeridiyle
   paketleyici commit eşitliği şartıyla geri açılır. Gerekçe: paketler baefe86'dan önce üretildi, tek koruma ProBook kabulü.
5. **srv21 Pardus fallback'ı (23.09) uygulansın mı?** Öneri: hayır, ProBook + Mac Docker ikilisiyle kapatılsın. Gerekçe:
   iki bağımsız şerit var, srv21 paketleyicisi Mac'ten ayrışmış, srv21 paylaşılan üretim sunucusu (nazik build kuralı).
6. **İçerik kanalı K Pardus'ta açılsın mı (`windows,linux`)?** Öneri: evet, macos imzalı derlemede ölçülünce eklensin.
   Gerekçe: bugün mac/Pardus'ta kitap güncellemesi iner ama açılmaz; ProBook'ta 57806 v2→v4 geçti.
7. **Android APK'ya artan versionCode ve kalıcı, yedekli bir imza anahtarı verilsin mi?** Öneri: evet, versionCode = panel sürüm
   kodu × 1000 + sayaç. Anahtar bugünkü debug anahtarı kalsın, yedeği alınsın. Gerekçe: anahtar kaybolursa kurulu APK'lar güncellenemez.
8. **Kabuldeki "aktivasyon bekleniyor" işareti keypanel.db'den mi gelsin?** Öneri: evet. Gerekçe: runner başlık regex'i
   kullanıyor (`runner.js:1714`), kaynak sözleşmesi keypanel diyor (`kitap-kaynak-sozlesmesi.md:49-53`).

## Yapılmayacaklar
Kabulsüz yükleme · `AGENT_NOTER_ZORUNLU=0`'ı kalıcı yapmak · aktivasyon kanalına (ImWin32.dll, imKeys.dll) dokunmak ya da
kod/anahtar gömmek · bayat paketleyici kopyasıyla üretmek · srv21'de ağır derlemeyi varsayılan yapmak · düz disk/önbellek
sabitlerini geri koymak · paketleyicide SET menüsü/konfig uydurmak (K1) · m- zip'i kaynak almak.

## Uygulama durumu (26.09)
- Kod var ve canlı: noter kapısı, Pardus disk kapısı, ProBook kabulü, başsız kabul (macos+android), SET düzeltmeleri,
  sürüm türetme, Android K8/K9.
- Kod var, devrede değil: ProBook şeridi (kayıt + runner yaması), `serit-secimi.js`.
- Kod yok: build zip'i kaynak alma (runner SFX bekliyor), hold durumu, kabul kanıtı ekranı, artefakt geçmişi, srv21
  fallback, kanal 1 bekçisi, hazır devralmada commit kontrolü, Android versionCode, AppRun hash-güvenli kıyas.

## Eskiyen belgeler (dosya:satır → ne değişmeli)
- `electron-multi-platform-packager/.claude/docs/sozlesme.md:36` "varsayılan KAPALI" → canlıda `macos,android` AÇIK.
- `…/sozlesme.md:117` "macOS/Android'de kabul kapısı YOK" → kapı var; eksik olanlar hold ve geri alma.
- `…/sozlesme.md:26` "disk kapısı 20 GB" → boyut orantılı (kaynak×5, taban 15).
- `…/sozlesme.md:32` ProBook şeridi "canlı" → kod var, ajan kayıtlı değil, runner'a bağlı değil.
- `book-update/.claude/docs/masaustu-mobil-paketleme.md:11` Android ajanı Server21 → Mac ajanı (Server21 son nabız 09-09).
- `…/masaustu-mobil-paketleme.md:12` kaynak `/Uploads/KitapTekExe` → köprü R2 (`build-agents.ts:289-300`), hedef build zip.
- `book-update/.claude/docs/paket-yapilari-tek-kitap-vs-set.md:60-61` "tüm SET paketleri açılmıyor" → bu belge §SET.
- `book-update/.claude/docs/pardus-hatti-sozlesmesi.md:16-28` → 24.09 ProBook kararları ve bu belge §Pardus şeridi'ne bağlanmalı.
- `uretim-masasi-mac/docs/sozlesmeler/04-bu-mac-guncelleme.md:70` ve `05-yayinla.md:63` "Pardus her zaman bu Mac'te" → hazır devralma + ProBook.
- `book-update/CLAUDE.md:124` (SET açılmıyor) ve `:131` (noter onaysız dmg) → bu belge; noter artık zorunlu.
