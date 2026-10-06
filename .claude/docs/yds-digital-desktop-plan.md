# YDS Digital Desktop — Uygulama Planı [DURUM: TASLAK, 06.10.2026]

> Nadir talebi (06.10): tek yükleyici → dijital kütüphane arayüzü → kitap seçilince içerik R2'den iner,
> indirme bitmeden açılır (Web-Z gibi) → arka planda tamamlanır → güncellemede yalnız değişenler gelir.
> Flash bellekle internetsiz tahtaya taşıma ("1 kez internet"), aylık sürüm kontrolü önerisi, telemetri.
> Kaynaklar: `scratchpad/desktop-kesif.md` (7 soru, dosya:satır kanıtlı), `yukleyici-arastirma-2026-09-18.md`,
> `g-yayin-r2-yol-tasarimi.md`, `sozlesme.md`, `windows-paketleme-sozlesmesi.md` (ONAYLI), Web-Z v2 sözleşmesi
> (TASLAK). Kod yazılmadı. Satır numaraları Worker `9672eba2` içindir.

## 1. Hedef ve başarı ölçütleri

**Hedef:** Tek imzalı kabuk kurulur. Her kitap imzasız veri olarak gelir. Kitap güncellenince platform paketi
yeniden üretilmez. Kurulu uygulama yalnız değişen dosyaları alır.

| # | Ölçüt | Eşik | Ölçüm |
|---|---|---|---|
| M1 | Kurulum dosyası boyutu | ≤ 150 MB (ia32) | dosya boyutu |
| M2 | Kurulum süresi (HDD) | ≤ 60 sn | NSIS zamanlama günlüğü |
| M3 | Kitap seçimi → ilk sayfa (ilk açılış) | ≤ 8 sn (10 Mbit/s), ≤ 15 sn (2 Mbit/s) | CDP |
| M4 | İndirilmiş kitapta ilk sayfa | ≤ 3 sn | CDP, ağ kapalı |
| M5 | İnmemiş sayfaya atlama | ≤ 2 sn (10 Mbit/s) | CDP |
| M6 | Güncellemede inen bayt | değişen dosyalar toplamı ±%5 | istemci günlüğü |
| M7 | Kitap güncellemesi başına platform derlemesi ve imza | 0 | runner ve imza kaydı |
| M8 | Yayından kurulu uygulamaya ulaşma | çevrimiçi ilk açılışta ≤ 5 dk | telemetri |
| M9 | İndirilmiş kitabın çevrimdışı açılması | %100 (3 platform) | kabul kapısı |
| M10 | Kabuk güncellemesi | ≤ 4 / yıl | imza kaydı |
| M11 | Telemetride kişisel veri alanı | 0 | şema denetimi |

## 2. Mimari

### 2.1 Katmanlar
| Katman | Ne taşır | Nasıl gelir | İmza |
|---|---|---|---|
| Kabuk | Electron, protokol yakalayıcı, indirici, doğrulayıcı, telemetri | kurulum dosyası | Authenticode (Win) / noter (mac) |
| Arayüz paketi | kütüphane ekranı (HTML/JS) | R2, sürümlü | ed25519 manifest |
| Katalog | set ve kitap listesi, kapaklar | R2 `katalog.json` | ed25519 |
| Motor | web motoru (548 KB) + `core/` + `i18n/` | R2 `_motor/<md5>/` | ed25519 |
| Set kabuğu | sf425 set menüsü, `config/settings.json`, polyfill | R2, set başına | ed25519 |
| Kitap içeriği | `pages/thumbs/htmletk/show/audio/video/data` | R2, içerik adresli | kitap manifesti + sha256 |

**İlke:** Kabukta iş mantığı az olur. Kütüphane ekranı, motor ve set kabuğu veridir; değişince imza gerekmez.

### 2.2 Ana karar: tek motor, Web-Z adres düzeni
- Masaüstü yalnız **web motorunu** kullanır. Paket motoru (210 KB) girmez.
- Kabuk Web-Z URL düzenini (`/go/<sc>/web-stream/bookN/…`) yerelde sunar. Motor kendini Web-Z'de sanır.
- Sonuç: "kaldığı yer" ve anahtar tek depoda (`localStorage`). ImWin32.dll ve `imKeys.dll` yok.
- İçerik penceresi `nodeIntegration:false`, `contextIsolation:true`. Bugünkü paketlerden daha güvenli.

### 2.3 "İndirme bitmeden aç" akışı
```
Motor isteği → protocol.handle (kabuk) → yol → kitap manifesti → sha256
   ├─ depoda var → diskten sun (Range destekli)
   └─ depoda yok → net.fetch(CDN/icerik/<sha>) → sha256 doğrula → geçici dosya → rename → sun + depoya yaz
                   (sha tutmazsa yazma, 1 kez yeniden dene, hata sayacı)
Arka plan indirici (öncelik): açık kitabın ±10 sayfası → açık kitabın kalanı → setin diğer kitapları
   · sayfa çevrilirken yavaşlar · 6 eşzamanlı bağlantı · her dosya kaldığı yerden sürer
```
- Depo `userData/depo/<sha[0:2]>/<sha>`; taşınabilir kipte `<uygulama>/veri/depo/`. Ortak dosya 1 kez iner.
- Desen G istemcisinin `zincirKur` + `nesneAdi(sha, yol)` örtüsünün genişlemesidir; yeni kol "ağdan getir ve yaz".

### 2.4 İçerik hattı (R2 dosya düzeyi + kitap manifesti)
```
İmpark Vs artışı → publisher-version-refresh (≤6 sa)
  → v2 derleme (Mac): ZKitapZipH/<id>-<Vs>.zip → kayıpsız WebP → her dosya sha256
  → R2 icerik/<sha[0:2]>/<sha> (değişmez, If-None-Match:*)
  → R2 kitap/<assetId>/<Vs>/manifest.json + .sig   {yol, sha256, boyut}[]
  → R2 set/<setId>/surum.json (tetik, EN SON) + manifest.json(.sig)
  → Web-Z v2 Worker ve Masaüstü AYNI ağacı okur
```
Yükleme sırası ve kurallar G aracından gelir: değişmezler önce, `surum.json` en son, `no-transform`, tek yazar.

### 2.5 Güncelleme
```
Açılış (çevrimiçi) → katalog.json + set surum.json (no-cache)
  → sürüm > yerel? → manifest + .sig → ed25519 + setKimligi + monoton sürüm denetimi
  → fark = yeni sha'lar − depodakiler → yalnız bunlar iner
  → hepsi doğrulanınca işaretçi atomik çevrilir (ya hep ya hiç) → eski sha'lar 2 sürüm tutulur
Açık kitap ders sırasında değişmez; yeni sürüm kitap yeniden açılınca gelir.
```
Kabuk güncellemesi ayrı kanaldır: imzalı `kabuk/surum.json` → kurulum dosyası → Authenticode + ed25519 → sessiz kurulum.

### 2.6 Kütüphane arayüzü
- yds-web `dijital-kutuphane` görünümü arayüz paketine taşınır; yerelde ve çevrimdışı çalışır.
- Veri: imzalı `katalog.json`; yeni yayın adımı book-update `GET /api/v1/external/books` + yds-web koleksiyonlarından üretir.
- Canlı sayfayı uzaktan yükleme reddedildi: çevrimdışı çalışmaz, beyaz listeye takılır, 453 KB ve `no-store`.

## 3. Bugünkü hatla ilişki

```
BUGÜN: kitap güncellendi → 4 platform derleme → kabul ×4 → Windows imza kuyruğu (saatler) → R2
       kurulu paket: K (tam zip, en büyük 790 MB) + G (yalnız kabuk) → içerik çoğu kez gitmiyor
YENİ : kitap güncellendi → v2 derleme 1 kez → değişen dosyalar R2'ye → manifest imza → bitti
       kurulu uygulama: yalnız değişen sha'lar iner · derleme 0 · imza 0
```

| Parça | Durum | Masaüstünde |
|---|---|---|
| G istemcisi (`kitap-guncelleyici.js`): ed25519, monoton sürüm, setKimligi, ya hep ya hiç, nesne deposu | YENİDEN KULLANILIR | çekirdek doğrulayıcı ve yakalayıcı |
| `tools/g-yayin` (yayinla/yukle, Anahtar Zinciri imzası, yükleme sırası) | YENİDEN KULLANILIR | içerik ve katalog yayını |
| `sayfa-webp.js`, Z2 `webz-kabuk-uret` | YENİDEN KULLANILIR | v2 derleme, set kabuğu |
| Başsız kabul, windows-kasa, ProBook kabul | UYARLANIR | kabuk kabulü + "set açılıyor mu" |
| İmza yuvası 66902 + imza bekçisi | KALIR, yükü düşer | yalnız kabuk |
| `publisher-version-refresh`, sözleşme bekçisi | KALIR / GENİŞLER | v2 tetiği; telemetriden kurulu sürüm |
| K kanalı, `imKeys.dll`, A1 düzeni, fs-shim | MASAÜSTÜNDE YOK | eski paketlerde sürer |
| YDS set derlemesi (Win/mac/Pardus) | F5 sonunda EMEKLİ (Karar 4) | — |
| Android APK + G | KAPSAM DIŞI, sürer | — |

**Geçiş:** eski paketler G ve K ile beslenir → G ile kök menüye "Yeni YDS Digital" bandı (imzasız) →
`/go/<kod>/windows` masaüstü kurulumunu verir (`YDS-Digital-<sc>.exe`; Authenticode adı kapsamaz, kabuk adından
seti seçer) → anahtarlı setler aracı uç hazır olana dek eski pakette (F5).

## 4. Flash bellek ve çevrimdışı

| Yol | Ne zaman | Akış |
|---|---|---|
| A. 1 kez internet | tahta ilk açılışta içeriksiz | "İnternete bağlayın" → set iner → "Hazır, interneti kesebilirsiniz" |
| B. Flash belleğe hazırla | evdeki bilgisayarda | kurulum dosyası + seçili setlerin depo dosyaları USB'ye `YDS-Digital/` |
| C. USB'den içe aktar | tahtada | kabuk takılı sürücüleri tarar → `YDS-Digital/depo` → sha doğrulanır → internet gerekmez |

- **Taşınabilir kip:** kurulum yetkisi yoksa USB'den çalışır (Windows portable exe, Pardus AppImage; `tasinabilir` işaret dosyası).
- **Aylık kontrol:** zorunlu değil, açılışı engellemez; 30 gün bağlantısızlıkta küçük not.
- **Aktivasyon:** kod 1 kez girilir, jeton `safeStorage`'da, çevrimdışı süre sınırı yok.

| Durum | Kullanıcıya görünen metin |
|---|---|
| İçerik yok, ağ yok | "Bu kitabı ilk kez açmak için bir kez internet gerekiyor." |
| Yönlendirme | "İnternete bağlayın. Kitabınızı birlikte hazırlayalım. Sonra interneti kesebilirsiniz." |
| İndirme sürüyor | "Kitap hazırlanıyor: %42. Bu sırada okumaya başlayabilirsiniz." |
| Bitti | "Kitabınız hazır. Artık internetsiz açılır." |
| USB bulundu | "Flash bellekte 2 kitap bulundu. Bu bilgisayara alalım mı?" |
| Aylık not | "Ayda bir kez internete bağlanmanızı öneririz. Böylece yenilikler gelir." |
| Ağ engeli | "Okul ağı bağlantımızı engelliyor olabilir. Bu sayfayı bilgi işlem sorumlunuza gösterin." |
| Disk | "Yer yetersiz. Bu kitap için en az 2 GB boş alan gerekiyor." |
| Güncelleme | "Yeni sürüm hazır. Kitabı bir sonraki açışınızda göreceksiniz." |

## 5. Okul ağı (FATİH beyaz liste)

18.09 araştırması "küçük yükleyici + CDN"yi "kurulum yarım kalır" diye reddetti. Yeni model bu arızayı taşımaz:

| 18.09 riski | Yeni modelde |
|---|---|
| Kurulum ağa bağlı | Kurulum dosyası tam, ağsız kurulur; indirme ayrı |
| Tek büyük indirme kopar | Dosya düzeyi, her dosya ayrı sürer, yarım indirme de kullanılır |
| Ağ kapalıysa hiçbir şey olmaz | C yolu (USB içe aktarma) internetsiz |
| R2 çok parçalı Range 400 | Yalnız tek parça Range (206 çalışıyor) |
| TLS incelemesi | Bütünlük imzaya dayanır |

- Tek alan adı önerisi `dijital.ydspublishing.com` (Worker + R2): içerik, katalog, aktivasyon, telemetri (Karar 1).
- Beyaz liste talebi `fatihdestek.eba.gov.tr`; uygulamada hazır talep metni; açılışta erişim yoklaması.
- Yedek: geçişte tam çevrimdışı set paketi sürer; F5'te yerini "içerik paketi" (depo zip'i, imzasız) alır.

## 6. Telemetri

| Alan | Değer | Kişisel |
|---|---|---|
| `kurulumKimligi` | ilk açılışta rastgele UUID (MAC değil) | hayır |
| `olay` | kurulum · nabız (günde ≤1) · set-eklendi · guncelleme-uygulandi · hata | hayır |
| `kabukSurumu`, `isletimSistemi`, `mimari`, `kip` | sabit liste | hayır |
| `setKimlikleri[]`, `yerelBayt`, `cevrimdisiGun` | sayılar | hayır |
| IP, kullanıcı/makine adı, okul | TOPLANMAZ | — |

Uç `POST dijital.ydspublishing.com/t/v1`; Worker IP'yi atar, toplu iletir (`error_events` deseni). Çevrimdışı olaylar
yerelde birikir (≤200). "Aktif" = son 30 günde nabız. Ayarlar'da kapatma anahtarı; KVKK görüşü F4'ten önce.
İstatistik ekranı F6.

## 7. Güvenlik

```
Gömülü 2 açık anahtar (güncel + sonraki) → katalog.sig → set manifest.sig → kitap manifest.sig → dosya sha256
                                          → kabuk/surum.json.sig + Authenticode/noter
```
- Özel anahtar yalnız bu Mac'in Anahtar Zinciri'nde; G'den ayrı kimlik `empp-masaustu-ed25519-uretim`.
- Ret: imzasız/https dışı manifest, düşük sürüm, başka setin kimliği, sha uyuşmazlığı (G'nin 26.09 kuralları).
- `imKeys.dll` masaüstüne girmez; doğrulama aracı uç → keypanel. Cihaz izi `kurulumKimligi` (dock değişince sabit).
- mod1 gizleme olduğu gibi kalır; açıkta kalan içerik bugünkü Web-Z ile aynı, yeni açık yok.
- Linux `safeStorage` anahtarlıksız düz metne düşebilir; jeton set kapsamlı ve kodsuz, risk kabul edilebilir.

## 8. Fazlar

| Faz | Çıktı | Kabul kapısı | Süre | Bağımlılık |
|---|---|---|---|---|
| **F0 ölçüm + prototip** | Mac'te imzasız Electron prototipi: `protocol.handle('https')` yalnız `webz.ydspublishing.com` için, depoda varsa disk, yoksa `net.fetch` + yaz; SW kaydı engelli; set `o6kov` (anahtarsız, 237 MB); 3 sette ilk sayfa bayt ölçümü; ProBook'ta ETAP oturum kapanınca `~/.config` korunuyor mu | ilk sayfa süresi/bayt JSON · tam indirme sonrası ağ kesik açılış 0 hata · kaldığı yer korunur · 2 Mbit/s'de dosya/sn | 1–2 gün | yok (bugünkü proxy) |
| F1 içerik hattı | `tools/masaustu-yayin/`: ZKitapZipH → WebP → sha → R2 `icerik/` + imzalı manifestler + `katalog.json` | 3 kanarya: manifest girdi = zip girdi · HeadObject sayı/boyut eşit · örneklem origin ile bayt-eşit · ikinci yayında değişmeyen dosya yüklemesi 0 | 1,5–2 hafta | F0 |
| F2 kabuk MVP | kütüphane ekranı, yakalayıcı, öncelikli indirici, fark güncellemesi, kabuk güncelleyici iskeleti | M3–M6, M9 Mac'te · mutasyon: kaynak değişir → yalnız o sha iner · bozuk sha → yazılmaz | 2 hafta (F1 ile paralel) | F0 |
| F3 dağıtım + pilot | Win ia32 NSIS imzalı (66902), mac noterli, Pardus AppImage + deb; kabul kapıları uyarlanır; 5 öğretmenle pilot | M1, M2 · 3 platformda kabul GEÇTİ · pilotta 7 gün 0 açılmayan kitap | 1 hafta | F1, F2, Karar 2 |
| F4 çevrimdışı + ağ + telemetri | USB hazırla/içe aktar, taşınabilir kip, erişim yoklaması, talep metni, `/t/v1` | USB'den internetsiz kurulum + açılış 3 platformda · kişisel alan 0 · çevrimdışı olaylar bağlantıda gelir | 1–1,5 hafta | F3, Karar 1, 5, KVKK |
| F5 geçiş | `/go/<kod>/windows` → masaüstü, G bandı, anahtarlı setler (aracı uç), set derlemesi emeklilik kararı | anahtarlı kanarya: İmpark'a aktivasyon isteği 0 · 30 gün ≥%80 kurulum güncel | 2–4 hafta | Web-Z v2 aracı uç, Karar 4 |
| F6 istatistik ekranı | panelde kurulum / aktif / sürüm dağılımı | günlük sayılar telemetriyle tutarlı | 1 hafta | F4 |

F0 `~/.empp-agent/arastirma/masaustu-f0/` altında, üretim ağacı dışında kurulur; canlıya yazmaz, yalnız GET
(Worker WAF'ı için tarayıcı UA).

## 9. Açık kararlar (Nadir)

| # | Karar | Seçenekler | Öneri |
|---|---|---|---|
| 1 | Alan adı / beyaz liste | A: tek yeni alan `dijital.ydspublishing.com` · B: `cdn` + `webz` + `api` ayrı · C: yalnız `cdn` | **A** — beyaz liste tek satır |
| 2 | Windows imzası | A: İmpark yuvası 66902 · B: kendi OV sertifikamız · C: A şimdi, B 03.07.2027 öncesi | **C** — kabuk yılda ≤4 imza |
| 3 | Okuyucu motoru | A: yalnız web motoru · B: yalnız paket motoru · C: ikisi | **A** — tek depo, Web-Z ile aynı davranış |
| 4 | Eski paket üretimi | A: F5 sonunda YDS masaüstü set derlemesi durur, içerik paketi gelir · B: süresiz paralel · C: hemen durdur | **A** — Android sürer |
| 5 | Telemetri kapsamı | A: anonim kimlik + günlük nabız, IP yok, kapatılabilir · B: A + kurum kodu · C: yok | **A** |

## 10. Riskler

| # | Risk | Olasılık | Etki | Önlem |
|---|---|---|---|---|
| R1 | FATİH beyaz listesi alanı açmaz | yüksek | yüksek | tek alan + talep metni + USB yolu + geçişte tam paket |
| R2 | Web motoru yerel kökende hata verir (polyfill alan denetimi) | orta | yüksek | F0'da `webz` alanının kendisi yakalanır |
| R3 | 14.000 küçük dosya zayıf ağda yavaş | orta | orta | F0'da 2 Mbit/s ölçümü; gerekirse thumbs paketi |
| R4 | İçerik hattı (Web-Z v2) gecikir | orta | yüksek | F0/F2 bugünkü proxy ile; kaynak tek ayar |
| R5 | Anahtarlı setler aracı uca bağlı | yüksek | orta | F5'e kadar eski pakette |
| R6 | ETAP oturum kapanışı kullanıcı verisini siler | bilinmiyor | yüksek | F0'da ölçülür; gerekirse `/var/lib/yds-digital` |
| R7 | Windows 7 tahtalar Electron'u açamaz | orta | orta | bugünkü paketler de Electron 39; telemetri |
| R8 | İmza kuyruğu kabuk güncellemesini geciktirir | orta | düşük | ince kabuk; Karar 2-C |
| R9 | Smart App Control imzasız iç exe'yi engeller | bilinmiyor | yüksek | F3'te gerçek Win11'de ölçülür |
| R10 | Disk dolar (1–2 GB'lık setler) | orta | orta | indirme öncesi alan denetimi, budama |
| R11 | Tek dosya > 512 MB kenar önbelleğine girmez | düşük | orta | F1'de en büyük dosya ölçülür |
| R12 | Özel anahtar tek Mac'te | düşük | yüksek | 2 gömülü açık anahtar, yedekleme prosedürü |
| R13 | KVKK görüşü telemetriyi durdurur | düşük | orta | anonim şema, F4 öncesi görüş |

Kritik dosyalar: `src/runtime/kitap-guncelleyici.js`, `tools/g-yayin/yayinla.js`, `tools/g-yayin/yukle.js`,
Worker `services/cloudflare-worker/src/index.ts` + `polyfill.ts` + `pwa.ts`, `src/packaging/sayfa-webp.js`,
yds-web `(content)/dijital-kutuphane/page.tsx`.
