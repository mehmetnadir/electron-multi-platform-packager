# Kendi Yükleyicimiz — Araştırma Bulguları ve Karar Taslağı

> 2026-09-18. Sekiz paralel araştırma ajanının çıktısının sentezi.
> Nadir'in üç sorusu + "kendi exe yükleyicimizi yapalım" talebi.
> **DURUM: TASLAK — Nadir onayı beklenir. Kod yazılmadan önce onay şart.**

---

## A. "Modern miyiz? Verimli miyiz? Düşük donanımda sağlıklı mıyız?"

### A1. Ölçülen mevcut durum (dosyadan okundu, tahmin değil)

| Ne | Değer | Kanıt |
|---|---|---|
| Paketleyicinin kendi Electron'u | 39.0.0 | `package.json:74` |
| **Üretilen kitaba yazılan Electron** | **^27.0.0** | `packagingService.js:819` |
| electron-builder | ^26.0.12 | `package.json:75` |
| Güncel Electron (2026-09) | **v44** (Chromium M152 / Node 24) | electronjs.org sürüm takvimi |
| Destek penceresi | **son 3 major** → v42/43/44 | Electron destek politikası |

**Bulgu 1 — Sürüm tutarsızlığı:** Üretilen kitabın `package.json`'una `^27.0.0` yazılıyor;
gerçek derlemede kurulu 39 kullanılıyor. Alan ya bilgi amaçlı ölü bir alan ya da bir
tuzak. **Ölçülmedi:** hangi Electron ikilisinin gerçekten pakete girdiği build çıktısından
doğrulanmalı.

**Bulgu 2 — Destek dışıyız:** 39 da 27 de destek penceresinin dışında. Chromium güvenlik
yamaları gelmiyor. Bu bir "yavaşlık" sorunu değil, **güvenlik borcu**.

### A2. Modernlik: Electron'da kalmalı mıyız? → **EVET, kalmalıyız**

| Seçenek | Boştaki RAM | Soğuk açılış | Bizim için engel |
|---|---|---|---|
| Electron | 168-200 MB | 2-4 sn | — |
| Tauri (WebView2) | ~42 MB | 0,5-1 sn | Windows'ta **WebView2 runtime bağımlılığı** (temiz okul imajında yok → offline kurulum +150-200 MB); **Pardus tarafı yok** |
| Neutralino | ~20 MB | — | Olgunluk ve ekosistem yok |

Teams 134 MB → 12 MB küçülmesini WebView2'ye geçerek yaptı; ama Teams'in Pardus derdi yok.
VS Code, Slack, Discord, ChatGPT ve Claude masaüstü hâlâ Electron. **Gömülü içerik +
çevrimdışı + Pardus** üçlüsünde Electron doğru seçim olmayı sürdürüyor. Göç önerilmiyor.

### A3. Verimlilik: nerede kaybediyoruz (ölçülen kod)

| Kayıp | Nerede | Etki |
|---|---|---|
| **`show:false` + `ready-to-show` YOK** | `packagingService.js:877-921` — pencere doğrudan `fullscreen:true` açılıyor | Eski makinede **beyaz/boş ekran çakması** ve "açılmadı mı?" hissi. Paketleyicinin kendi UI'ı bunu doğru yapıyor (`src/main.js:67`), ürettiği kitap yapmıyor |
| **V8 code cache / startup snapshot yok** | repo genelinde 0 eşleşme | Electron'un kendi ölçümü: soğuk derlemede ~%25, gezinmede ~%22 daha az bloklama. **En yüksek getirili tek iyileştirme** |
| **`asarUnpack` / `compression` hiç ayarlanmamış** | 4 dosyada 0 eşleşme | Varsayılan `normal` sıkıştırma; büyük kitapta açılış I/O'su HDD'de cezalı |
| **`backgroundThrottling` ayarlanmamış** | 0 eşleşme | Varsayılan (throttle açık) — tam ekran kitapta genelde zararsız, ölçülmeli |
| **İlk açılışta tüm zip diske açılıyor** | `src/packaging/apprun-template.sh:150` | 1.138 MB'lık pakette ~1,1 GB yazım. Yükseltmede eski kurulum `mv` ile duruyor → geçici olarak **disk 2×** |

### A4. Düşük donanımda sağlıklı mıyız? → **BİLMİYORUZ. Ölçülmedi.**

Bu soruya bugün dürüst cevap "ölçmedik"tir. Elimizde ProBook 6560b (i5-2520M, Pardus ETAP)
var ve ölçüm protokolü hazır (aşağıda). Eşikler ve gerekçeleri:

| Büyüklük | Eşik | Gerekçe |
|---|---|---|
| Soğuk açılış → ilk piksel | ≤ 4 sn | Üstünde "dondu" algısı başlar (Nielsen) |
| Soğuk açılış → etkileşime hazır | ≤ 8 sn | Sınıf içi bekleme toleransı |
| RAM RSS toplamı | ≤ 500 MB | 4 GB RAM'de OS + öğretmenin diğer uygulamasına yer kalsın |
| Süreç sayısı | ≤ 5 | Her ek süreç sabit RSS + bağlam değişimi |
| CPU tepe (ilk 5 sn) | ≤ %70 tek çekirdek | i5-2520M 2 çekirdek; üstü ısı/donma |
| CPU boşta (30 sn sonra) | ≤ %3 | Üstü arka plan sızıntısı işareti |
| Sayfa geçişi | ≤ 300 ms | "Donuk" hissi eşiği |
| Kurulum süresi (HDD) | ≤ 60 sn | — |

Ölçüm komutları (ProBook'ta SSH ile, X11 açıkken):
```bash
PIDS=$(pgrep -f "AppName" | paste -sd, -)
ps -o rss= -p "$PIDS" | awk '{s+=$1} END{print s/1024" MB"}'   # RAM
pidstat -u -r -p "$PIDS" 1 10                                   # CPU+RAM serisi
for p in ${PIDS//,/ }; do grep -E 'write_bytes' /proc/$p/io; done  # disk yazımı
T0=$(date +%s.%N); ./AppName & xdotool search --sync --name "AppName"
echo "ilk pencere: $(echo "$(date +%s.%N)-$T0" | bc) sn"
```
Kıyas noktaları: aynı makinede Chrome ile aynı içerik · yayıncının kendi exe'si · bir
önceki sürümümüz. Adillik: soğuk = yeniden başlatma sonrası ilk çalıştırma; 3 soğuk +
3 sıcak, medyan alınır. Her koşu tek satır JSON olarak arşivlenir:
```json
{"tarih":"","surum":"","makine":"probook-6560b-pardus23","soguk_ilk_piksel_ms":0,
 "soguk_etkilesim_ms":0,"ram_rss_toplam_mb":0,"surec_sayisi":0,"cpu_tepe_pct":0,
 "cpu_bosta_pct":0,"disk_yazim_kurulum_mb":0,"sayfa_gecis_ms":0,"kurulum_suresi_sn":0,
 "kiyas_turu":"chrome|onceki_surum|yayinci_exe","not":""}
```
Kaynaklar: [Electron Performance](https://www.electronjs.org/docs/latest/tutorial/performance) ·
[contentTracing ile açılış analizi](https://blog.scottlogic.com/2019/05/21/analysing-electron-performance-chromium-tracing.html) ·
[pidstat](https://man7.org/linux/man-pages/man1/pidstat.1.html) · Windows: WPR/WPA.

---

## B. Kendi yükleyicimiz

### B1. Teknoloji seçimi

| Aday | Görsel tavan | Admin gerekir mi | Karar |
|---|---|---|---|
| **Inno Setup + Pascal Script** | Özel sayfa çizilebilir, tam ekran marka mümkün | **Hayır** (`PrivilegesRequired=lowest`, `%LOCALAPPDATA%`) | ✅ **SEÇİLDİ** |
| NSIS (electron-builder varsayılanı) | Native widget tavanı — Adobe kalitesi çıkmaz | Hayır | Kabuk güncellemesi için kalır (electron-updater) |
| MSIX | Marka yok, Intune ister | — | ❌ |
| WiX + WPF | Gerçek Adobe kalitesi | — | 2. faz, bakım maliyeti yüksek |
| Stub + CDN'den indirme | — | — | ❌ Zayıf okul ağında kurulum yarım kalır |

**Şu an NSIS kullanıyoruz** (`packagingService.js:1624-1651`: `oneClick:true`,
`perMachine:false`, `lang:tr`). `perMachine:false` zaten per-user — yani admin hakkı
sorunu bugün de yok; kazanılacak olan **görsel kalite ve mesajlaşma**.

### B2. İmza ve SmartScreen

- **EV sertifika artık "anında güven" vermiyor** (Microsoft 2024'te kaldırdı). EV ve OV
  aynı şekilde indirme hacmiyle itibar biriktiriyor.
  ([ToDesktop](https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore),
  [DigiCert](https://knowledge.digicert.com/alerts/ev-signed-application-showing-microsoft-defender-smartscreen-warnings))
- Yapılacak: **sabit imza kimliği** + her sürümde zaman damgası + önce küçük gruba dağıtım.
  Bizde imza yolu hazır: **66902 yuvası** (`~/.claude/skills/exe-imzalama`).
- **Antivirüs yanlış pozitifi NSIS'te toplu olabiliyor** (aynı stub'la üretilen tüm
  kurulumlar birden işaretlenebiliyor — [NSIS resmi sayfa](https://nsis.sourceforge.io/NSIS_False_Positives)).
  Rutin: her sürüm öncesi VirusTotal kontrolü.

### B3. Kurulum ekranı tasarımı (araştırmadan çıkan kurallar)

- **Tek ekran, buton yok, otomatik ilerler.** Öğretmene soru sorulmaz.
- **Belirlenmiş yüzde çubuğu** + aşamaya göre değişen metin. Belirsiz spinner yasak.
- Aşama metinleri: "Dosyalar hazırlanıyor" → "Kitabınız açılıyor" → "Kısayol oluşturuluyor"
  → "Her şey hazır, açılıyor".
- **Gerekçe ölçülmüş:** geri bildirimli bekleme gerçek süreden %11-15 kısa algılanıyor
  (NN/G); adımları göstermek ("labor illusion", Harvard/Management Science) aynı süreyi
  daha güvenilir hissettiriyor.
- Yaşlı / az teknoloji bilen kullanıcı: gövde metni ≥ 20pt, kontrast ≥ 7:1, tek sütun.
- Altta dönen tek satır bilgilendirme (ipucu), yayınevi logosu üstte.
- **Bitince otomatik açılış** — "Finish" düğmesi bile yok.

### B4. Güncelleme mimarisi

- **Kabuk ile içerik ayrılır.** Kabuk (Electron + motor) küçük; içerik (kitap varlıkları)
  ayrı paket.
- Kabuk: electron-updater + NSIS (Squirrel.Windows ölü; tek bakımlı yol bu).
- İçerik: kendi `manifest.json`'umuz — `{version, files:[{path, sha256, size}]}` →
  **dosya seviyesinde delta**.
- **Tuzak:** asar sıkıştırılmışsa tek satır değişiklik **tüm asar'ı** yeniden indirtiyor
  (%100); `differentialPackageStoreAsar` ile ~%3'e iniyor.
- **Tuzak (bizim altyapımız):** **R2 çok-parçalı range isteğinde 400 dönüyor** (tek range
  206 çalışıyor). electron-updater'ın differential indiricisi R2 arkasında kırılabilir.
  Bizim dosya-seviyesi delta tasarımımız bu tuzağa girmez.
- Önbellek: manifest/`latest.yml` **no-cache**; ikili dosyalar sürümlü ad + agresif cache.

### B5. Bildirim + yardım talebi

> **Uzaktan destek KAPSAM DIŞI** (Nadir, 2026-09-18). RustDesk/AnyDesk/TeamViewer
> değerlendirmesi yapıldı ama bu işe girmiyor. Araştırma notu arşiv için: RustDesk
> self-host ücretsiz ve Pardus'ta çalışıyor, tek bilinen riski antivirüs yanlış
> pozitifi. İleride açılırsa buradan devam edilir.

| İhtiyaç | Seçim | Not |
|---|---|---|
| Bildirim | **ntfy self-host** (n.yds.tc — zaten kurulu) | Okul güvenlik duvarı WebSocket upgrade'ini kesiyor → **HTTP long-polling'e düşen istemci şart** |
| Yardım talebi | Uygulama içi "Yardım iste" → ntfy kanalı + tanı bilgisi | Sürüm, kitap kodu, işletim sistemi, son hata. **Öğrenci verisi YOK** |

### B6. Okul ortamı kısıtları (araştırılan)

| Konu | Bulgu |
|---|---|
| MEB ağı | FATİH ağı **karaliste değil beyaz liste**; yeni adres için fatihdestek.eba.gov.tr'den açma talebi gerekiyor. Kendi sunucumuza erişim **garanti değil** |
| SSL | FATİH tableti dışı cihazlara MEB sertifikası kuruluyor — TLS incelemesi olabilir |
| Yönetici hakkı | `%LOCALAPPDATA%` per-user kurulum admin istemez; ama kurum "Prohibit User Installs" GPO'suyla ayrıca engelleyebilir |
| Pardus ETAP | etapadmin/öğretmen/öğrenci hesapları; **LiderAhenk** merkezî dağıtım root ile tek tıkla tüm ağa yayıyor — .deb yolu bu yüzden değerli. AppImage çalışıyor |
| KVKK | Ad-soyad/ses/görüntü işleniyorsa aydınlatma metni + yurtdışı aktarım kuralı. **Anonim sayaç telemetri riski düşük** ama hukuki görüş alınmalı |

**Bize etkisi:** kurulum akışına "ağ erişimi yoksa" dalı konulmalı; whitelist talep metni
öğretmene gösterilecek hazır bir sayfa olmalı.

---

## C. Önerilen deneme sırası

| # | Deneme | Çıktı | Risk |
|---|---|---|---|
| 1 | **Kurulum ekranı görsel prototipi** (HTML, gerçek ölçülerde) | Ekran görüntüsü — Nadir onaylar/düzeltir | Yok |
| 2 | Inno Setup betiği + Pascal özel sayfa, sahte 200 MB yükle | Çalışan kurulum, ProBook/Windows'ta süre ölçümü | Düşük |
| 3 | ProBook'ta **mevcut** bir kitabın temel ölçümü (A4 protokolü) | "Bugün neredeyiz" JSON satırı | Yok (salt ölçüm) |
| 4 | `show:false` + `ready-to-show` + V8 code cache yaması → aynı ölçüm | Önce/sonra kıyası | Orta — paket üretimini etkiler, gate'li |
| 5 | İmzalı uçtan uca: Inno çıktısı → 66902 yuvası → imzalı kurulum | SmartScreen davranışı ölçümü | Düşük |

**Kapsam:** Cambridge paketleri hariç tüm paketlerimiz.

---

## D. Açık sorular (Nadir'e)

1. Windows kabuğu için **NSIS'ten Inno Setup'a geçiş** onaylanıyor mu? (electron-builder
   çıktısını Inno ile sarmalayacağız; electron-updater tarafı NSIS kalabilir.)
2. Electron **v39 → v44** yükseltmesi ayrı bir iş olarak planlansın mı? (güvenlik borcu)
3. "Yardım iste" talepleri hangi ntfy kanalına düşsün — mevcut `kosucu`/`onay`
   kanallarından ayrı bir `destek` kanalı açalım mı?

---

## E. ASAR ÖLÇÜMÜ — gerçek paketlerimiz (2026-09-18, Nadir'in şüphesi doğrulandı)

Ölçülen paket: `~/.empp-agent/pardus-hazir/45472.impark` — **Marvel Grade 12 Set, 1.138 MB**.
Yöntem: `7z l` ile squashfs listesi + asar başlığının (`UInt32LE` pickle) doğrudan ayrıştırılması.

### E1. Paket neyden oluşuyor

| Bileşen | Sıkışmış | Pay |
|---|---|---|
| **`resources/app.asar`** | **1.040,8 MB** | **%91** |
| Electron ikilisi (`marvel-grade-12`) | 68,7 MB | %6 |
| `locales/` (55 dil dosyası) | 9,0 MB | %0,8 |
| `resources.pak` + `icudtl.dat` | 9,6 MB | %0,8 |
| .so kütüphaneleri | 7,7 MB | %0,7 |
| `LICENSES.chromium.html` | 1,2 MB | — |

### E2. asar'ın içi

| Ölçü | Değer |
|---|---|
| Ham boyut | **1.190 MB** (asar SIKIŞTIRMAZ — düz birleştirmedir) |
| Dosya sayısı | **14.448** (118 klasör) |
| **JSON başlık** | **3,51 MB** — açılışta tamamen okunup `JSON.parse` edilir |
| `assets/` (24 alt-kitap) | 1.151,6 MB (%97) |
| Motor js/css/svg | 32,5 MB |
| `core/` (motor varlıkları) | 6,0 MB — **her kitapta tekrar** |

Alt-kitap dağılımı (ilk 5): `33518` 216 MB · `33523` 151 MB · `56399` 131 MB ·
`33414` 123 MB · `33415` 73 MB. En küçükleri 7 MB (57870-57877).

Görsel/veri kırılımı:

| Tür | Adet | Toplam | Ortalama | Medyan | En büyük |
|---|---|---|---|---|---|
| PNG | 11.306 | **936 MB** | 85 KB | **6 KB** | 2,7 MB (`assets/61633/pages/1.png`) |
| JPG | 2.612 | 176 MB | 69 KB | 69 KB | 493 KB (`core/backgrounds/reals/sandy.jpg`) |
| XML | 79 | **44 MB** | 569 KB | 26 KB | **10,3 MB** (`assets/33518/data/coordinates.xml`) |

500 KB üstü PNG'lerin toplamı **291 MB (PNG'nin %31'i)** — bunlar sayfa taramaları.
500 KB üstü XML'lerin toplamı **39 MB (XML'in %89'u)** — `coordinates.xml` dosyaları.

### E3. Tuzaklar (ölçülmüş, sırayla)

| # | Tuzak | Ölçü | Sonuç |
|---|---|---|---|
| 1 | **Motor ile içerik TEK asar'da** | 1,19 GB tek blok | 24 alt-kitabın **birinde** tek sayfa düzeltilse öğretmen **1,04 GB'ı yeniden indirir**. Delta güncelleme imkânsız |
| 2 | **3,51 MB JSON başlık** | 14.448 girdi | Açılışta okunup parse edilir; eski makinede ölçülmeli (protokol A4) |
| 3 | **Sayfa taramaları PNG** | 291 MB (>500 KB) | Tarama görseli için yanlış format. WebP ~%60-70 küçültür → **~180-200 MB kazanç, tek pakette** |
| 4 | **`coordinates.xml` düz metin** | 39 MB | asar sıkıştırmadığı için ham duruyor; sayfa açılışında ayrıştırılıyor |
| 5 | **52 gereksiz dil** | 9,0 MB sıkışmış | Hintçe/Tamilce/Tayca… `electronLanguages: ["tr","en-US"]` ile bedava kazanç |
| 6 | **`core/` + motor her pakette tekrar** | 38,5 MB × paket | 40 kitapta ~1,5 GB tekrar üretim + tekrar indirme |
| 7 | **Kurulum tüm asar'ı diske kopyalıyor** | ~1,26 GB yazım | `AppRun:150` `app.zip` yok → `AppRun:159` `cp -r "$HERE"/*`. Yükseltmede eski kurulum `mv` ile duruyor (`AppRun:132`) → geçici olarak **disk 2× ≈ 2,5 GB** |
| 8 | `cp -r ... 2>/dev/null` | — | Kopya hatası sessizce yutuluyor (silent catch) |

### E4. Bu tek pakette görünen kazanç

| İşlem | Kazanç | Risk |
|---|---|---|
| `electronLanguages` budaması | −9 MB | Yok |
| `LICENSES.chromium.html` çıkarma | −1,2 MB | Lisans metni ayrı sunulmalı |
| Sayfa PNG → WebP | **−180…200 MB** | Motorun WebP okuduğu doğrulanmalı |
| `coordinates.xml` gzip/ikili | −35 MB | Motor okuma yolu değişir |
| **İçerik paketini asar'dan çıkarma** | Güncellemede **1,04 GB → alt-kitap başına 7-216 MB** | Mimari değişiklik — en büyük iş, en büyük kazanç |

**Sıra önerisi:** 5 ve 2 bedava (yapılır) → 3 ölçülür, motor WebP okuyorsa uygulanır →
1/7 mimari karar olarak Nadir'e sunulur.

---

## F. SAYFA GÖRSELLERİ — ölçülmüş kazanç ve DROP-IN yol (2026-09-18)

### F1. Şifreleme aslında engel değil

Paket içindeki varlıklar **mod1** ile şifreli: `c = (256 − p) & 0xFF`, involutif,
**yalnız ilk N bayt** (`yayincilikadm/impark_crypto.py`). `.png` için `N = DEFAULT_N = 100`;
`.xml` için `WHOLE_FILE`. Yani sayfa görselinin ilk 100 baytı çevrilmiş, gerisi **ham PNG**.
Çözmek ve yeniden şifrelemek tek satır.

İlk teşhisim ("şifre sıkıştırmayı engelliyor") **yanlıştı** — doğrusu: PNG zaten sıkışık
olduğu için sıkışmıyor; şifre bunda payı olmayan bir etken.

### F2. Gerçek sayfa görselleri

`45487` (YDT Power 12 Set) — **1.075 sayfa PNG, toplam 325 MB**. Örnek sayfa:
**1659×2340, 8-bit RGB** (A4 @ ~200 DPI).

40 sayfalık temsili örneklem (büyükten küçüğe eşit aralıklı, 14,1 MB):

| Biçim | Boyut | Oran | Görsel kalite |
|---|---|---|---|
| Özgün PNG | 14,1 MB | %100 | — |
| **WebP q82** | **7,4 MB** | **%52** | Gözle özgünden ayırt edilemiyor |
| WebP q90 | 9,1 MB | %64 | — |
| PNG8 (256 renk) | 6,8 MB | %48 | **Gradyanlarda bantlanma** — kabul edilemez |
| PNG yeniden kodlama (kayıpsız) | — | %75-95 | Kazanç yok |

Gradyanlı sayfalarda fark daha keskin: en büyük sayfa (2.446 KB) → WebP q82 **250 KB (%10)**.
Görsel kıyas: `/tmp/png-deney/kiyas-117.png` (özgün / PNG8 / WebP alt alta).

### F3. Motor engeli ve ÇÖZÜMÜ (ölçüldü)

Motor sayfa yolunu **sabit `.png` uzantısıyla** kuruyor:
`kitapDosyalar/{bookId}/pages/{imageName}.png` — yani dosya adını değiştiremeyiz.

**Ama gerek de yok.** Chromium `<img>` için uzantıya değil **içeriğe** bakar (content
sniffing). Ölçüm (Chrome headless, `file://`):

```
{"webp_icerik_png_adli":{"yuklendi":true,"en":1659,"boy":2340},
 "gercek_png":         {"yuklendi":true,"en":1659,"boy":2340}}
```

→ **WebP baytlarını `sayfa.png` adlı dosyaya koyduğumuzda motor kodu değişmeden çalışır.**
Yayıncının motoruna dokunmadan paket boyutu yarıya iner.

### F4. Bu kitapta beklenen kazanç

| Paket | Sayfa PNG | WebP q82 sonrası | Paket boyutu |
|---|---|---|---|
| 45487 YDT Power 12 Set | 325 MB | ~169 MB | 572 MB → **~415 MB (−%27)** |
| 45472 Marvel 12 Set | 936 MB (tüm PNG) | ~487 MB | 1.138 MB → **~690 MB (−%39)** |

Uygulama adımı (paketleme hattında, kitap başına):
1. `assets/*/pages/*.png` → ilk 100 baytı negatifle (çöz)
2. `cwebp -q 82` ile dönüştür
3. **Dosya adını `.png` bırak**
4. İlk 100 baytı yeniden negatifle (şifrele)

### F5. Doğrulama kapısı (uygulamadan önce)

- [ ] Gerçek pakette ProBook'ta açılış — sayfa görünüyor mu, zoom/büyüteç bozuluyor mu
- [ ] Motorun `canvas`/`drawImage` yolu WebP ile çalışıyor mu (yalnız `<img>` değil)
- [ ] `coordinates.xml` koordinatları piksel bazlı mı — biçim değişse de boyut aynı kaldığı
      için etkilenmemeli, ama ölçülmeli
- [ ] Windows exe ve Android APK'da aynı kontrol (aynı motor, aynı Chromium)
- [ ] Şifre yeniden uygulandıktan sonra paket bütünlük denetimi

---

## G. KADEMELİ KURULUM + SAYFA ÖNBELLEĞİ (2026-09-18, ölçümlerle)

### G1. Nadir'in tanımı (spec)

1. **Kurarken aç:** motor + her alt-kitabın **ilk 10 sayfası** hazır olunca uygulama açılır,
   kalanı arka planda sürer.
2. **Sayfa önbelleği:** kitap açıldıktan sonra kalan sayfalar arka planda önbelleğe işlenir,
   şifreleri çözülür, sayfalar arası hızlı geçiş için hazırlanır; **yükleme bitmeden
   görüntülenmeye başlanmaz**.
3. **Asıl kazanç sonraki açılışlarda.** Önce Windows'ta çözülecek.

### G2. Sektörde kim yapıyor

| Kim | Nasıl |
|---|---|
| Xbox · PlayStation | Oyun parçalanır; çekirdek + ilk bölümler önce iner, gerisi oynarken sürer |
| Google Play | **Asset Delivery**: install-time · fast-follow · on-demand |
| Apple | **On-Demand Resources** |
| Steam | Destekliyor ama yaygın değil — **oyunun buna göre tasarlanmış olması** gerekiyor |

Ortak ders: **yükleyici özelliği değil, içerik bölünmesi işi.** Bizdeki engel de aynı —
motor ve içerik tek `app.asar` bloğunda.

### G3. Ölçüm — açılış için ne kadarı yeterli (45487, 16 alt-kitap, 1.075 sayfa, 542 MB)

| Parça | Boyut | Ne zaman |
|---|---|---|
| Motor (js/css/core) | 39 MB | Açılıştan önce |
| `assets/*/data/` | 15 MB | Açılıştan önce |
| Her kitabın ilk 10 sayfası | 43 MB | Açılıştan önce |
| `assets/*/thumbs/` | 59 MB | Kitap seçilince |
| Kalan 915 sayfa | 282 MB | Arka planda |
| `show/` · video · ses | 104 MB | Tıklanınca |

**Açılış eşiği: 542 MB → 97 MB** (WebP ile ~76 MB).

### G4. `isWeb` kapısı KAPALI — ölçüldü, plan düzeltildi

İlk hipotez: motorun `app.config.js`'indeki `isWeb: true` ile sayfalar HTTP'den istenir,
araya yerel sunucu koyarız. **Yanlış çıktı.** Motorun kendi kodunda:

```js
if (AppConfig.bookModule && AppConfig.bookModule.enable) { AppConfig.xml.isWeb = !1; }
```

Bizim paketlerimizde `bookModule.enable: true` (doğrulandı: Lingoland 3 `app.config.js:6-7`),
yani motor `isWeb`'i **zorla false yapıyor**. Ayrıca web dalı, lisans/anahtar uçlarını da
göreli URL'ye çeviriyor (`(isWeb ? "" : "https://www.sorucoz.tv") + "/TestlerMobil/…"`) —
açılsa bile aktivasyon akışını kırardı. Bu kapı kapalıdır.

### G5. Sayfa baytları şifreli — `<img src>` yolu yok

`book1/assets/73452/pages/1.png` başlığı `77 b0 b2 b9` = mod1'lenmiş PNG imzası.
`thumbs/1.jpg` düz JPEG (`ff d8 ff e0`), `data/BookContent.xml` düz metin.
Yani sayfa görselini tarayıcı doğrudan çizemez — **motor JS'te çözüyor**, sonra muhtemelen
blob/data URL'e çeviriyor. Araya girilecek yer `<img>` değil, **okuma çağrısıdır**.

Ölçülen ipucu: yerel dosyalar XHR ile okunuyor
(`1459ms xhr file://…/classlibraries/ImWin32.dll`) — yani `fetch`/XHR kancası (bizim
`fs-shim`'imizde zaten var) doğru katman. **Sayfa okumasının fs mi XHR mi olduğu HENÜZ
ÖLÇÜLMEDİ** (aşağıya bak).

### G6. Deney kaydı — uygulama gizli pencerede koşturuldu (Mac, odak çalmadan)

Yöntem: `app.asar` açıldı, `main.js` kopyası `show:false` ile yamalandı,
`session.webRequest.onBeforeRequest` tüm istekleri kaydetti, `capturePage()` ile ekran alındı.
`ELECTRON_RUN_AS_NODE=1` ortamda set — `env -u` ile temizlenmeli (memory `electron-run-as-node-tuzagi`).

| Bulgu | Kanıt |
|---|---|
| `file://` istekleri **görünür ve yakalanabilir** | `image file://…/core/kurumLogo.png` kaydedildi |
| Yerel dosya okumaları XHR ile de yapılıyor | `xhr file://…/classlibraries/ImWin32.dll` |
| Motor açılışta ağa çıkıyor | `GetKurumLogo`, `GetPackageBooks`, `HasZKitapKey?kitapId=…` |
| **Motor kendi güncellemesini önde koşuyor** | Ekran: **"Kitap Güncelleniyor %28"** — 40 sn sonunda hâlâ orada; sayfa isteği hiç gelmedi |
| Bozuk paket (72379) menüye bile ulaşmıyor | `GetPackageBooks?id=undefined` |

**Sonuç:** sayfa yükleme mekanizması bu koşuda ölçülemedi, çünkü motorun kendi güncelleme
adımı önde. Bir sonraki deneyde bu adım atlanmalı (ağsız koşu ya da güncelleme ucunu
engelleyerek) ve ancak ondan sonra sayfa okuması gözlenebilir.

### G7. Tasarım (ölçüm tamamlanınca uygulanacak)

**a. Paketleme tarafı**
- İçerik `app.asar`'dan çıkar (`asarUnpack` ya da ayrı içerik dizini) — tek blok olduğu sürece
  ne kademeli kurulum ne delta güncelleme mümkün.
- Sayfalar WebP'ye çevrilir, **adı `.png` kalır** (§F).
- Yükleyici iki kümeye ayrılır: **açılış kümesi** (motor + data + ilk 10 sayfa) ve
  **arka plan kümesi** (kalan sayfalar, thumbs, show/video).

**b. Çalışma zamanı — sayfa önbelleği**
- Kitap açılınca arka plan işçisi kalan sayfaları sırayla işler: mod1 çöz (ilk 100 bayt,
  maliyeti yok denecek kadar az) → önbellek dizinine yaz (`userData/onbellek/<kitap>/<sayfa>`)
  → dizine kaydet.
- **Öncelik kuyruğu:** öğretmen 300. sayfaya atlarsa sıra ona geçer.
- **Hızlı geçiş:** bulunulan sayfanın ±3 komşusu bellekte çözülmüş tutulur; gidiş yönüne
  doğru ön-getirme yapılır.
- **Nezaket:** sayfa çevrilirken işçi durur; boşta hızlanır. Öğretmenin işini yavaşlatmak yasak.
- **Sonraki açılışlar:** önbellek diskte kaldığı için ikinci açılıştan itibaren sayfa geçişi
  doğrudan önbellekten — asıl kazanç burada.
- Önbellek sürüm damgası taşır; kitap güncellenince ilgili sayfalar düşer.

**c. Nereye bağlanır**
- Kanca `src/platforms/common/fs-shim.js` (bizim kodumuz) + main süreçteki işçi.
- Yayıncının motoruna **dokunulmaz** — WebP'de olduğu gibi.

### G8. Açık riskler (söz verilmeden ölçülecek)

- Sayfa okuması `fs` mi XHR mi — **ölçülmedi**, kanca yeri buna bağlı.
- Motorun kendi "Kitap Güncelleniyor" adımı bizim kademeli kurulumla çakışabilir; sıralama
  tasarlanmalı (memory `zkitap-electron-kendini-gunceller`).
- Sayfa yerine yer tutucu dönerse motor bunu hata sayar mı — bilinmiyor.
- Electron'da protokol/istek araya girmesi daha önce `fetch`'i komple düşürdü
  (memory `electron-protokol-bayrak-tuzagi`).
- Önbellek diski şişirir: 542 MB paket + önbellek. Tavan ve budama kuralı gerekir.

---

## H. MOTORUN GÜNCELLEME ADIMI — ölçüldü (2026-09-18)

Shall We 6 Set macOS paketi, gizli pencerede (`show:false`), **temiz userData** ile koşturuldu.

| Ne | Ölçüm |
|---|---|
| "Kitap Güncelleniyor %N" süresi | **99 sn** (5. sn %4 → 100. sn %98); kitap 105. sn'de açıldı |
| İndirilen | **`update.zip` — 350,5 MB** |
| Nereye | `…/Application Support/<app>/work/book1/assets/73452/update.zip` |
| **Açıldı mı** | **HAYIR.** `work` içinde tek sayfa dosyası yok; zip olduğu gibi duruyor. Kitap paket içeriğinden açıldı |
| İkinci açılış | **5 sn** — güncelleme ekranı hiç çıkmadı; adım bir kez koşuyor |
| Diskte kalan | 865 MB uygulama + 350 MB artık zip |

**`content-length` yok** (chunked aktarım) — ilk sayımda indirme 0 MB göründü; boyut diskten
ölçüldü. Ölçüm dersi: bayt sayımı yalnız başlıktan yapılmaz.

### H1. Kapı tek bir alan

```js
var r = o.module.checkUpdates[o.module.oneBook];
if (r?.status === PENDING) { d(true); un(n.url, n, e => g(e.loaded))
    .then(() => sn.L5(o.module.dll)).finally(() => { d(false); t(n); }); }
else if (r?.status === NONE) { t(n); }      // güncelleme yoksa ANINDA aç
// + 5 sn emniyet: f false ise yine de aç
```

Kaynağı: `updateBookEndPoint` →
`GetKitapGuncellemeBilgi?id={bookId}&setMi={isSet}&versiyon={version}`
(ölçülen çağrı `id=73452&setMi=0&versiyon=5`).

**Uyarı:** bu pakette çağrı hâlâ `www.sorucoz.tv`'ye gitti — K16 domain yaması
(`src/packaging/yayinci-domain-yamasi.js`) `app.config.js`'teki `updateBookEndPoint`'i
kapsamıyor ya da paket yamadan önce üretilmiş. **Kapsam doğrulanmalı** — o ucu kontrol
etmeden ertelemeli güncelleme kurulamaz.

### H2. Önerilen akış (Nadir'in tarifi: "arka plana at, göz kırpmasıyla kapa-aç")

1. Açılışta uygulama bize sorar → **"güncelleme yok"** → kitap anında açılır.
2. Arka plan işçimiz gerçek yayıncı ucuna sorar, varsa indirir, sha256 doğrular.
3. **Atomik takas** (`<hedef>.yeni_<guid>` → `rename`) — köprü `dosya-yaz` işinin aynısı.
4. Uygulama ya `app.relaunch()` ile ~2 sn'de kendini yeniler, ya da hiç kapanmaz;
   bir sonraki doğal açılışta yeni sürüm gelir. **Ders sırasında asla.**

Güncelleme ATLANMAZ, yalnız ERTELENİR — Nadir'in "hiçbir paket güncellemeden yoksun inmesin"
kuralı korunur.

### H3. Tuzaklar (Nadir'in sorusu: "bayat içerik / yazılamayan sayfa")

| # | Tuzak | Durum | Kural |
|---|---|---|---|
| 1 | **Çift kaynak gölgelemesi** | **GERÇEK — ölçüldü** | `fs-shim.toRead()` `work/`'ü pakete tercih ediyor; motor da güncellemesini AYNI dizine yazıyor. Önbellek bu önceliği bilmeli ve `work/` değişince kendini düşürmeli |
| 2 | Bayat içerik | Riskli | Önbellek anahtarı kitapId + **sürüm** + sayfa + biçim. Sürüm numarası motorun sorgusunda zaten var (`versiyon=N`) |
| 3 | **Yazılamayan sayfa** | Riskli | **Fail-open**: önbelleğe yazılamıyorsa sayfa özgün kaynaktan servis edilir. Önbellek arızası sayfayı ASLA engellemez |
| 4 | Yarım dosya | Riskli | Atomik yazım (geçici + `rename`) — `sayfa-webp.js`'te uygulanan desenin aynısı |
| 5 | Sessiz yutma | Riskli | Her başarısız yazma sayaç + log |
| 6 | Geçersizleştirme fan-out'u | Riskli | "Şu olunca şunlar düşer" TEK fonksiyonda; sözleşme testiyle çivilenir |
| 7 | Disk şişmesi | **GERÇEK** | 865 MB uygulama + 350 MB artık zip + önbellek. Tavan + LRU budama şart; artık `update.zip` temizlenmeli |

**Doğrulama kuralı:** bayat-içerik testi mutasyonla yapılır — kaynağı değiştir, önbelleğin
düştüğünü GÖR. Düşmüyorsa önbellek değil, arıza üreticisidir.

### H4. K16 domain yaması — güncelleme ucunu KAPSAMIYOR (ölçüldü)

| Bulgu | Kanıt |
|---|---|
| `app.config.js` yamanın hedefinde | `TEXT_EXTS` `.js` içeriyor; `yayinci-domain-yamasi.js:162` `app.config.js`'i açıkça tanıyor |
| Ama üretilen pakette **6 `sorucoz.tv` kalmış** | `book1/app.config.js` satır 17, 19, 22, 24, 25 ve **78 (`updateBookEndPoint`)** |
| Canlı çağrı da oraya gitti | Ölçülen istek: `https://www.sorucoz.tv/TestlerMobil/GetKitapGuncellemeBilgi?id=73452&setMi=0&versiyon=5` |
| **Yama Windows'ta hiç koşmuyor** | `packagingService.js:518-520` — `platforms.filter(p => p !== 'windows')` boşsa `applyPublisherDomainPatch` çağrılmıyor. Yalnız-Windows derlemesi yamasız çıkar |

**Sonuç:** güncelleme kapısını (`checkUpdates.status`) bugün kontrol etmiyoruz. Ertelemeli
güncelleme (H2) kurulmadan önce iki şey düzeltilmeli:
1. Yamanın `updateBookEndPoint`'i gerçekten yeniden yazdığı doğrulanmalı (bu pakette yazmamış —
   yama hiç mi koşmadı, yoksa `publisherHost` mi türetilemedi, ölçülmeli).
2. **Windows kapısı kaldırılmalı** — Nadir Windows'u önce çözmek istiyor, yama ise Windows'u atlıyor.

---

## I. Sayfa okuma yolu — ÖLÇÜLDÜ (2026-09-18, kesin)

Açık soru şuydu: "sayfa baytları `fs` ile mi XHR/fetch ile mi okunuyor?" — kademeli
kurulum ve sayfa önbelleği kancasının yeri buna bağlıydı. Motorun paketten çıkarılmış
bundle'ı okundu; tahmin yok, kod var.

### I.1 Motorun gerçek sayfa yükleyicisi

`42c86ce0fe3ad185f93d.main.js` @386679 (minify açılımı):

```js
async function sayfaYukle(t, n = true, r = false, o = false) {
  if (o) return t;                                   // ham geçiş
  if (r && !isSvg(t)) t = t.replace(".png", ".svg"); // svg yedeği
  const s = await fetch(t);                          // ← fs DEĞİL, fetch
  const u = new Uint8Array(await s.arrayBuffer());
  const l = !decode(u.slice(0,5)).toLowerCase().includes("png");
  if (l || n) for (let c = 0; c < 100; c++) u[c] = 256 - u[c];   // mod1, ilk 100 bayt
  let f = t.split(".").pop(); if (f.includes("svg")) f = "svg+xml";
  const p = new Blob([u.buffer], { type: "image/" + f });        // MIME UZANTIDAN
  return URL.createObjectURL(p);                                  // blob: URL
}
```

Sayfa URL'si `07c1044d96ebd86beb98.main.js` @400306'da kuruluyor:
`P = (e) => encodeURI(bookName + "/" + xmlYolu + "." + imageType)` → `assets/<kitap>/pages/103.png`.
BookContent.xml da aynı yoldan: `fetch(encodeURI(bookName + "/" + path))`.

Pencere: `main.js:43` → `file://…/index.html`, `webSecurity:false`, `nodeIntegration:true`.
Özel protokol kaydı **YOK** — `file://` fetch'i webSecurity kapalı olduğu için çalışıyor.

**Sonuç: kanca yeri `window.fetch`.** Bizim `empp-fs-shim.js` zaten `installFetch()` ile
`window.fetch`'i sarmalıyor (anahtar deposu için yazılmıştı) — sayfa önbelleği ve kademeli
kurulum aynı kancayı kullanacak, motora tek satır dokunmadan.

### I.2 Şifreleme durumu — ölçüldü

208 sayfa, 208 thumb tarandı:

| | İlk 4 bayt | Yorum |
|---|---|---|
| `assets/*/pages/*.png` | `77b0b2b9` (200/200 örneklem) | mod1 şifreli (`8950 4e47` negatifi) |
| `assets/*/thumbs/*` | `ffd8ffe0` (50/50) | DÜZ JPEG — şifresiz (`thumbs-sifresiz-kurali` teyit) |

### I.3 WebP, motorun KENDİ kodundan geçirildi — GEÇTİ

Gerçek bir sayfa (103.png) çözüldü → `sharp(...).webp({quality:82})` → yeniden mod1 →
ad `.png` bırakıldı. Sonra yukarıdaki `sayfaYukle` fonksiyonu **birebir** Electron'da
(`node_modules/electron`, `webSecurity:false`, `nodeIntegration:true`) koşturuldu:

| Girdi | `naturalWidth×Height` | canvas(0,0) pikseli | Bayt |
|---|---|---|---|
| PNG (mevcut) | 1922 × 2390 | `59,17,7,255` | 747.721 |
| **WebP, `.png` adıyla** | **1922 × 2390** | `58,17,6,255` | **188.726** |

- Blob MIME'ı `image/png` olarak üretiliyor (uzantıdan), **içerik WebP** — Chromium blob
  içeriğini kokluyor, MIME'a bakmıyor. Görüntü çözülüyor.
- `canvas.drawImage` + `getImageData` de çalışıyor → **büyüteç/canvas yolu da sağlam.**
- Piksel farkı 1/255 = q82 kaybı, gözle görünmez.
- Bu sayfada **%74,8 küçülme** (40 sayfalık daha önceki örneklemde ortalama %52).

`l = !decode(ilk 5 bayt).includes("png")` kontrolü WebP'de de doğru çalışıyor: şifreli
RIFF (`aeb7baba`) "png" içermiyor → `l = true` → çözülüyor. `n` zaten varsayılan `true`.

**Kalan doğrulama (K18):** bu ölçüm macOS Chromium'unda yapıldı. Üretimde açılmadan önce
ProBook'ta tam paket açılacak (sayfa + büyüteç + not katmanı), ayrıca Windows ve Android.
Kapı `EMPP_SAYFA_WEBP=1` o güne kadar KAPALI.
