# Mobil zip'ten build klasörü — ölçüm raporu (2026-09-26)

**Sonuç (tek paragraf, 26.09 güncellemesi sonrası):** Nadir'in "m-" adı doğruydu
— ilk turda 404 alınmasının sebebi URL'de SÜRÜM NUMARASI eksik olmasıydı
(`m-58336.zip` değil `m-58336-17.zip`). `ZKitapZipH/` altında GERÇEKTEN dört
girdi türü var: `<id>-<v>.zip` (duz), `m-<id>-<v>.zip`, `__<id>-<v>.zip`
(nadir, yalnız bazı eski kitaplarda) ve `<id>-<v>/` (bazılarında açık, dosya
dosya HTTP ile okunabilen klasör). AMA Nadir'in "ikisi aynı boyutta" beklentisi
**ölçümle çürüdü**: 7 kitapta duz/m- boyut farkı −34% ile **+65%** arasında
değişiyor, ve İÇERİK MODELİ kitaba göre kökten farklı — kimi kitapta m- sayfa
görsellerini tamamen ATIYOR (yalnız htmletk'e dayanıyor), kimi kitapta sayfaları
**gerçekten küçültülmüş** bir "pages2X" setiyle DEĞİŞTİRİYOR (58237: 1922×2390 →
1281×1593, ölçülmüş çözünürlük düşüşü), kimi kitapta duz'un birebir kopyası,
kimi kitapta duz'un ÜSTÜNE onlarca ekstra htmletk etkinliği ekliyor. 58237
KRİTİK bulgu hâlâ geçerli: ne duz, ne m-, ne de açık klasör — HİÇBİRİ bu kitap
için htmletk (529) veya audio (25) içermiyor; mobil zip ailesinin tamamı bu
kitapta içerik eksik. Motor JS'te (`kaynak-acik/**/*.js`) ve Android shim'de
`m-`/`__` öneki hiç geçmiyor — yalnız `pages2X` adı motorun kendi kod yolunda
var (arka planda `pages`→`pages2x/pages2X` fallback denemesi), yani bu varyantları
kimin/hangi istemcinin talep ettiği kod tabanından doğrulanamadı; canlı
`GetKitapGuncellemeBilgi` (parametreler `setMi=1`, `mobil=1`, `platform=android|ios`
denendi) HİÇBİR ZAMAN m-/__ URL'si döndürmedi. Sürüm tespiti iddiası hâlâ doğru
(tek ~150 baytlık istek). Detay: bkz. §7. imKeys.dll konusu Nadir'in notuyla
risk listesinden çıkarıldı — uygulama çalışırken kendiliğinden İmpark'tan iniyor.
**26.09 ikinci güncelleme — KÖK NEDEN BULUNDU (§9):** 58237'nin htmletk/audio
eksikliği `ZKitapZipH`'in bir özelliği değil, AYRI bir ağacın (`ZKitapZip`,
`H` yok, SMB Storage7) SÜRÜM KATMANLARINDAN kaynaklanıyor. Her sürüm klasörü
(`ZKitapZip/<id>-<v>/`) yalnız o sürümde DEĞİŞENİ taşıyan bir delta'dır;
`ZKitapZipH`'teki tek güncel zip bu katmanların (genelde) FLATTEN edilmiş
hâlidir. 58336'da flatten hiç kesintiye uğramamış (htmletk 410→1050 monoton
artış, güncel zip %100 doğru); 58237'de ise htmletk(529)+audio(25) **v7**
katmanından geliyor ve exe'nin dondurduğu TAM O ANI birebir yansıtıyor (isim
listesi + örnek dosyalar byte-byte eşleşti) — ama v14 güncellemesi bu ikisini
flatten'dan DÜŞÜRMÜŞ (v13 hiç oluşmamış, v14 yalnız sayfa/thumbs/data
taşıyor). Sayfa görselinin şifrelemesi de netleşti: `ZKitapZip` KAYNAĞI
ŞİFRESİZ düz PNG'dir, mod1 (`256-x`, ilk 100 bayt) yalnız `ZKitapZipH`/exe
PAKETLEME anında uygulanır — SMB'deki plain dosyaya mod1 uygulayınca zip'in
central-directory CRC'siyle bit bit eşleşti. Build klasörü için pratik sonuç:
sağlıklı kitapta tek güncel zip yeter; 58237 gibi kesintili kitapta güncel
zip (v14) + eksiksiz eski katman (v7) İKİ KAYNAKTAN birleştirilmeli — tüm
sürümleri indirip birleştirmek (~1,3 GB) gereksiz ve pahalı.

## 1) "m-<kitapId>" arandı, bulunamadı

| Kaynak | Sonuç |
|---|---|
| Paketlenmiş motor JS (`kaynak-acik/book{1,2,3}/*.js`, `app.config.js`) | `updateBookEndPoint` tek adres: `TestlerMobil/GetKitapGuncellemeBilgi?id=&setMi=&versiyon=`. "m-" hiç geçmiyor |
| `yayincilikadm` CLI kaynağı (`~/01dev/yayincilikadm/yayincilikadm/*.py`) | `guncelleme_teklifi.py` bu uca dayanıyor: `Data` alanı `Uploads/ZKitapZipH/<id>-<ZipVersiyon>.zip` döner (2026-09-25 kaynaktan doğrulanmış not) |
| `book-update` deposu (services/, apps/) | "m-" önekli dosya adı, `MobilZip` sabiti YOK |
| srv21 pipeline DB (`akillitahta.pipeline_platform_summaries.r2_object_key`) | Yalnız `softwares/<id>/<ad> - YDS Publishing.{exe,impark}` deseni; "m-" YOK (LIKE '%m-%' boş) |
| Canlı HTTP (x-impark-key'li/siz, ilk turda 6 aday — **hepsi sürümsüz**: `ZKitapZipH/m-58336.zip`, `m-58336-17.zip` YOK ama denenmedi, `MobilZip/58336.zip`, `Uploads/m-58336.zip`, `MobilZip/m-58336.zip`, `mobil/m-58336.zip`) | Hepsi **404** |
| İmpark SQL (`INFORMATION_SCHEMA.COLUMNS LIKE '%Mobil%'/'%Zip%'`) | **ölçülemedi**: İmpark VPN (172.17.x) 2 denemede açılmadı (`impark-diskler.sh` admin-privilege osascript diyaloğu GUI riski taşıdığı için zorlanmadı); SMB de aynı sebeple erişilemedi |

**Kanıt:** `Data` alanı gerçek çağrı ile (id=58336/73456/58237, versiyon=0):
`ZKitapZipH/58336-17.zip`, `ZKitapZipH/73456-1.zip`, `ZKitapZipH/58237-14.zip`.
"Mobil zip" kavramı GERÇEK ve bu URL'ler — ad yalnızca `m-` önekli değil.

**DÜZELTME (26.09, Nadir'in ekranından sonra):** ilk turdaki 404'lerin sebebi
`m-<id>.zip` yazılıp SÜRÜM NUMARASI eklenmemiş olmasıydı — doğru biçim
`m-<id>-<v>.zip`. Bu biçimle `m-` ve nadiren `__` gerçekten var; ayrıntı ve
içerik farkları için **bkz. §7**.

## 2) İçerik kıyası (zip listesi Range ile, indirmeden — `zip_list_remote.py`)

| Kitap (asset) | Sayfa | Ortak ad | Bayt-bayt aynı | Farklı | Yalnız local (exe) | Yalnız remote (zip) |
|---|---|---|---|---|---|---|
| 58336 Student's Book | 136 | 1393 | **1393 (%100)** | 0 | 1 (`flexibleItems.json`) | 0 |
| 73456 Activity Book | 76 | 157 | **157 (%100)** | 0 | 0 | 0 |
| 58237 Skills & Test Book | 120 | 242 | 8 | 234 | **555** (htmletk 529 + audio 25 + flexibleItems.json 1) | 2 (data/*) |

58237'de ortak addaki 234 dosya (pages/thumbs/data) BENZER ama aynı DEĞİL —
boyut ~%0,3-2 farklı (ör. `pages/1.png`: remote 3.754.319 B / local 3.770.121 B),
CRC farklı. Yerel referans exe'nin dosya mtime damgası (`Apr 27 2026`) hem
58336'nın canlı zip Last-Modified'ıyla (`27 Apr 2026`) hem de kendi içeriğiyle
tutarlı; 58237'nin CANLI zip'i ise `10 Eylül 2026` damgalı — yani şu an
yayında olan sürüm, elimizdeki exe referansından **farklı bir üretim turu**.
Hangisinin "doğru/güncel" olduğu SQL'siz kesinleştirilemedi (ölçülemedi:
VPN kapalı → `S_TestKitaplarDetay` sürüm geçmişi okunamadı).

## 3) Sayfa görsel kalitesi (coordinator ek iş 2)

- Mobil zip sayfaları da **mod1 şifreli** (ilk bayt: 256−x) — 3 kitabın da
  `pages/1.png`'i çözüldükten sonra PNG imzası (`89504e47…`) veriyor.
- IHDR: **1922×2390 px**, üç kitapta da, hem mobil zip'te hem yerel exe
  kaynağında BİREBİR AYNI çözünürlük. `pages2x`/retina klasörü hiçbir zip'te yok.
- Sonuç: mobil zip görseli KÜÇÜLTÜLMEMİŞ — tahta paketleri için doğrudan
  kullanılabilir kalitede (58336/73456'da zaten bayt-bayt aynı olduğu için bu
  zaten kesin; 58237'de çözünürlük eşit olsa da bayt farkı var — muhtemelen
  yeniden encode/versiyon farkı, downscale değil).

## 4) Boyut ve ürün ilişkisi

| Nesne | Boyut (Content-Length) |
|---|---|
| 58336-17.zip | 392.147.413 B |
| 73456-1.zip | 130.495.202 B |
| 58237-14.zip | 95.326.152 B |
| **Toplam 3 zip** | **617.968.767 B (~589 MB)** |
| SM2 Set exe (R2, `softwares/59835/…exe`) | 687.170.680 B (~655 MB) |
| Oran | 3 zip toplamı, exe'nin **%89,9**'u |

Kalan ~%10 (~69 MB): kabuk + motor + node_modules + DLL'ler (aşağıda madde 6).

**Kaç üründe geçiyor:** **ölçülemedi**. Pipeline DB (srv21) yalnız SET
düzeyinde `book_id=59835`'i tutuyor; 58336/73456/58237 tekil asset ID'leri bu
DB'de hiç yok (`pipeline_set_book_versions` boş döndü). İmpark tarafındaki
`S_PaketKitaplar` sayımı SQL erişimi gerektiriyor — VPN kapalı.

## 5) Sürüm tespiti

Tek istek yeterli: `GET GetKitapGuncellemeBilgi?id=<id>&setMi=0&versiyon=0`
→ ~150 bayt JSON, `Vs` alanı güncel sürüm numarası, `Data` alanı indirilecek
zip URL'si (versiyon dosya adının `-<n>` kısmında zaten görünür durumda).
**Ölçüm:** 3 kitap × 1 istek = 3 istek, toplam <1 KB gövde, sürüm bilgisi
anında. Nadir'in "en hızlı böyle öğrenilir" iddiası bu ölçekte doğrulandı.

## 6) Hız

20 MB Range indirme (`58336-17.zip`, ofis ağı, cloudflare önden):
**1,375 sn / 20.971.520 B ≈ 14,5 MiB/s (≈15,2 MB/s)**. Bu host (`akillitahta.
ydspublishing.com/Uploads/…`) `x-impark-key` OLMADAN da 200 döndü — key yalnız
`sorucoz.tv`/panel gibi CF-korumalı uçlarda gerekli, statik `Uploads/` yolu
gerektirmiyor (ölçüldü, iki istek de 200).

## 7) ZKitapZipH varyantları (Nadir'in ekranı sonrası, 26.09)

### 7.1 HEAD taraması (7 kitap + 2 tarihi örnek, hepsi `x-impark-key`li)

| Kitap-sürüm | duz | m- | __ | `<id>-<v>/` klasör |
|---|---|---|---|---|
| 6998-4 | 200 / 148.525.017 B / 07.03.2024 | 200 / 147.977.886 B / 17.09.2025 | 404 | 404 |
| 58336-17 | 200 / 392.147.413 B / 27.04.2026 | 200 / 289.034.835 B / 17.08.2026 | 404 | 404 |
| 73456-1 | 200 / 130.495.202 B / 07.09.2026 | 200 / 130.273.848 B / 09.09.2026 | 404 | 403 (dosya dosya AÇIK, dizin kapalı) |
| 58237-14 | 200 / 95.326.152 B / 10.09.2026 07:42 | 200 / 63.240.663 B / 10.09.2026 11:02 | 404 | 403 (dosya dosya AÇIK) |
| 72378-18 | 200 / 633.750.360 B / 19.09.2026 12:26 | 200 / **1.045.527.702 B** / 19.09.2026 22:13 | 404 | 404 |
| 72379-18 | 200 / 290.485.230 B | **404 (m- yok)** | 404 | 404 |
| 5839-16 (2024 kitabı) | 200 / 339.705.831 B / 03.04.2024 | 200 / 400.922.798 B / **13.09.2026** (2 yıl sonra tazelenmiş) | 404 | 404 |
| 25775-25 | 200 / 468.145.468 B / 20.09.2026 12:35 | 200 / 467.224.668 B / 20.09.2026 22:10 | 404 | 404 |
| 9053-1 (ekrandaki `__` örneği) | 200 / 2.851.449 B | 200 / 2.842.530 B | **200 / 637.615 B** | 404 |
| 44187-26 | 200 / 816.482.783 B | 200 / 468.432.791 B | 404 | 404 |

Gözlem: `m-` her kitapta yok (72379-18'de 404). `__` yalnız 9053-1'de bulundu —
ekrandaki diğer `__` örnekleri bu turda denenmedi (zaman kısıtı); tarihi/nadir
bir varyant gibi duruyor, genel kural çıkarılamaz. `<id>-<v>/` klasörü bazı
kitaplarda dizin listelemesi 403 dönse de İÇİNDEKİ dosyalar tek tek 200 döndü
(bkz. §7.3) — yani klasör var, listelemesi kapalı.

### 7.2 duz vs m- içerik kıyası (central directory, CRC32+boyut)

| Kitap | duz girdi | m- girdi | Ortak+birebir aynı | m-'de FAZLA | m-'de EKSİK | Sayfa görseli farkı |
|---|---|---|---|---|---|---|
| 58336 | 1393 | 1560 | 1257 (tümü birebir) | +303 (298'i **yeni htmletk**, kalanı dizin işaretçisi) | **136 `pages/*` TAMAMEN YOK** (`pages2X/` de BOŞ dizin) | m-'de raster sayfa YOK — kitap mobilde tamamen htmletk'e dayanıyor |
| 73456 | 157 | 161 | 157 (tümü birebir) | +4 (yalnız dizin işaretçileri) | 0 | Yok — `pages/` duz ile birebir aynı, `pages2X/` boş/kullanılmıyor |
| 58237 | 244 | 247 | 124 (tümü birebir — data/thumbs) | +123 (121'i **pages2X**, kalanı işaretçi) | **120 `pages/*` YOK** (yerine pages2X) | **ÇÖZÜNÜRLÜK DÜŞÜYOR**: pages/1.png 1922×2390 (3.754.319 B) → pages2X/1.png **1281×1593** (1.406.225 B, mod1 çözülüp IHDR okundu) |
| 72378 | 698 | 1513 | 698 (tümü birebir) | +815 (811'i **yeni htmletk**: 271→1082) | 0 | Yok — sayfalar (208/209) birebir aynı, m- yalnız ÜSTÜNE htmletk ekliyor |

**Yorum:** "m-" tek bir kural izlemiyor; içerik modeli kitaba göre değişiyor —
(a) sayfasız/htmletk-öncelikli (58336), (b) düz kopya (73456), (c) sayfası
küçültülmüş (58237), (d) sayfa aynı + ekstra htmletk (72378). Nadir'in "aynı
boyut" beklentisi bu yüzden 4/4 kitapta yanlış çıktı; ama "biri doğrudan
mobilde iniyor" doğru olabilir — hangi istemcinin hangi varyantı çektiği
kod tabanından teyit edilemedi (bkz. 7.4).

### 7.3 58237 kritik: htmletk/audio HİÇBİR varyantta yok

`m-58237-14.zip` içeriği: yalnız `data/ pages2X/ thumbs/` — **htmletk YOK,
audio YOK**. `__58237-14.zip` 404 (yok). Açık klasör `Uploads/ZKitapZipH/
58237-14/` dizin listelemesi 403 ama dosya dosya GET açık: `pages/1.png` → 200
(3.754.319 B, zip'teki ile birebir), ancak `htmletk/u1/index.html` → **404**,
`audio/T.5.2.mp3` → **404**. Yani bu kitap için htmletk+audio, ZKitapZipH
ağacının HİÇBİR köşesinde yok — yalnız (muhtemelen daha yeni) imzalı exe'de
var. Kök neden SQL'siz belirlenemedi (pipeline gecikmesi mi, bilinçli hariç
tutma mı) — bir sonraki tur için açık soru.

### 7.4 Kim indiriyor?

- Masaüstü motor JS'inde (`kaynak-acik/**/*.js`) ve Android shim'de
  (`empp-android-shim.js`) `m-`/`__` öneki **hiç geçmiyor** — grep 0 sonuç.
- `pages2X` adı motorun KENDİ kodunda var: `backgroundImage.replace("pages",
  "pages2x")` / `"pages2X"` ile bir dosya-var-mı denemesi yapıp varsa onu
  kullanıyor. Bu projenin kendi `CLAUDE.md`'si (`Android CapacitorHttp` notu)
  `pages2x/`'i "retina klasörü" olarak tanımlıyor — yani motorun VARSAYIMI
  pages2x'in DAHA YÜKSEK çözünürlük olduğu. Ölçümümüz TERSİNİ gösterdi
  (58237: pages2X 1281×1593 < pages 1922×2390, **daha DÜŞÜK** çözünürlük) —
  ya isimlendirme yanıltıcı/tarihi, ya da bu kitapta pages2X normalde retina
  değil "düşük bant genişliği" amaçlı dolduruldu. Netleştirilemedi. Yine de
  `pages2X` motor tarafından TANINAN bir kavram; `m-` ve `__` önekleri değil.
- `GetKitapGuncellemeBilgi` — tek bilinen "hangi zip'i indir" ucu — `setMi=1`,
  `mobil=1`, `platform=android`, `platform=ios` parametreleriyle denendi;
  **hepsi aynı düz `<id>-<v>.zip` URL'sini döndü**, hiçbir kombinasyon `m-`
  veya `__` yolunu döndürmedi. Yani bu istemci akışıyla `m-`/`__` hiç
  tetiklenmiyor — onları çeken istemci (varsa) bu kod tabanında yok, farklı/
  eski bir uygulama ya da sunucu-içi bir toplu iş olmalı.

### 7.5 Sonuç — kanonik kaynak hangisi?

Build klasörü için **duz `<id>-<v>.zip` tercih edilmeli**, çünkü (a) canlı
istemci akışının (`GetKitapGuncellemeBilgi`) TEK döndürdüğü URL bu, (b) 3/4
ölçülen kitapta duz = exe ile bayt-bayt aynı (§2), (c) sayfa çözünürlüğü hiç
düşürülmüyor. `m-` yalnız ek bilgi/yedek olarak kullanılabilir: bir kitapta
duz'da eksik olan içerik `m-`'de VARSA (58336, 72378 örnekleri — ekstra
htmletk) tamamlayıcı kaynak olarak çekilebilir; ama otomatik varsayılmamalı —
her kitapta önce iki varyantın central directory'si karşılaştırılmalı (yukarıdaki
`zip_list_remote.py`/`compare_remote.py` ile ölçüm ucuz, tam indirme gerekmez).
58237 gibi durumlarda (htmletk hiçbir varyantta yok) tek çözüm imzalı exe'ye
düşmek.

## 8) Eksik parçalar — build klasörü için mobil zip'te OLMAYANLAR

Mobil zip'in kök dizinleri **sadece**: `audio/ data/ htmletk/ pages/ thumbs/
video/` (+58336'da `flexibleItems.json` yerelde var, zip'te yok). Paketleyicinin
kendi kanonik "kabuk" tanımı (`src/packaging/set-kabuk.js`, sözleşme sürümü 2,
2026-09-26 Windows sözleşmesiyle ölçülmüş) şunu söylüyor: kabuk = kök dosyalar +
`assets2/ core/ i18n/ config/ features/ images/ languages/ scripts/ styles/`.
**Bunların HİÇBİRİ mobil zip'te yok**, dolayısıyla eksik:

| Eksik | Kanonik kaynak (bilinen tek yol) |
|---|---|
| Motor/okuyucu JS (`index.html`, hash'li webpack parçaları, `43e23fce…js`) | İmzalı exe (WinRAR5 SFX) — `Cozumler/TekExeIndir/{Uuid}` veya R2 `softwares/<id>/…exe` |
| `classlibraries/ImWin32.dll` (menü/aktivasyon) | Aynı exe içinden `unrar x` |
| ~~`imKeys.dll`~~ | Risk DEĞİL (Nadir notu, 26.09): uygulama çalışırken İmpark'tan kendiliğinden iniyor, build klasörüne önceden konması gerekmiyor |
| Electron kabuğu + `node_modules` (DijitapTaslak) | Panelin `Uploads/DijitapTaslak`'ı — paketleyici/book-update deposunda HİÇ referans yok, tamamen İmpark tarafı |
| `app.config.js`, kök `config/ features/ images/ languages/ scripts/ styles/` | Aynı exe (set-kabuk.js beyaz listesi) |
| `flexibleItems.json` | Panelin exe-create anında ürettiği ek metadata — mobil zip'te yok, kaynağı ayrıca araştırılmalı |

`apps/uretim-masasi-mac` (Swift) İmpark köprüsü (`ImparkKoprusu.swift`) yalnız
SQL'den kitap adı/kapak METADATA'sı çekiyor — ne mobil zip ne exe içeriğini
indiriyor; Üretim Masası'nın build zip kurulumu bugün tamamen panel/exe akışına
(kitap-uretim skill) dayanıyor, mobil zip'i hiç kullanmıyor.

## Önerilen üretim akışı (taslak)

1. KitapId → `GetKitapGuncellemeBilgi` ile sürüm + zip URL'sini al (1 istek, ucuz).
2. Kabuk şablonunu (set/yayınevi başına BİR KEZ) mevcut imzalı exe'den çıkar,
   önbelleğe al — `set-kabuk.js` beyaz listesiyle ölç, "bilinmeyen dal" varsa
   üretim durdurulmalı (kapı mantığı zaten kodda var).
3. Kitabın içeriğini **duz** `<id>-<v>.zip`'ten indir (§7.5 — kanonik bu),
   şablonun `assets/<id>/` altına yerleştir. `m-<id>-<v>.zip`'i yalnız YEDEK/
   TAMAMLAYICI olarak dene: central directory'sini duz ile kıyasla (indirmeden,
   `zip_list_remote.py`+`compare_remote.py`), duz'da eksik ama m-'de olan bir
   şey (ör. ekstra htmletk) varsa ONU ekle — m-'nin sayfa görsellerini ASLA
   otomatik kullanma (§7.2: bazı kitaplarda düşük çözünürlüklü/eksik).
4. **Doğrulama şart:** indirilen zip'in `htmletk/` ve `audio/` dosya SAYISINI
   referans/önceki exe ile karşılaştır — 58237 örneği gösterdi ki fark sessizce
   oluşabiliyor (VE bu kitapta m-/__ varyantları da aynı eksikliği taşıyor).
   Fark varsa **§9'daki gerçek kök kaynağa** düş: `ZKitapZip/<id>-<v>/`
   (SMB, `H` YOK) — en son htmletk/audio TAŞIYAN sürüm klasörünü bul (58237'de
   v7-12, hepsi aynı) ve o alt dizinleri güncel zip'in üstüne yaz; imzalı
   exe'ye düşmek SON ÇARE, `ZKitapZip` daha ucuz ve daha güncel olabilir.
5. `flexibleItems.json` ayrı üretilmeli/kopyalanmalı (kaynağı belirsiz;
   §9.2'de doğrulandı — hiçbir `ZKitapZip` sürümünde yok, yalnız panel/exe
   tarafında üretiliyor).

## Açık riskler

- **58237 içerik farkının KAYNAĞI bulundu (§9) ama SEBEBİ hâlâ açık:**
  htmletk/audio'nun v13/14'te flatten'dan düşmesi bug mu, kasıtlı "yalnız
  sayfa düzelt" push'u mu — SQL/kaynak kod erişimi olmadan netleşmedi. 58336
  gibi kesintisiz kitaplarda bu risk yok; HER kitap için üretimden önce
  `ZKitapZip` sürüm sayımı (§9.1 tablosu) ile kontrol edilmeli.
- v10'un htmletk dosya sayısı SMB üzerinde 3 ayrı denemede tutarsız çıktı
  (523/339/112) — bu mount'ta derin `find` GÜVENİLMEZ olabilir; kritik bir
  sayıma dayanmadan önce `du`/`ls` ile çapraz doğrula.
- "Kaç üründe geçiyor" ve SQL şema tarafı (`INFORMATION_SCHEMA` LIKE arama)
  ölçülemedi — İmpark VPN erişilemedi, GUI admin-parola diyaloğu riskiyle
  zorlanmadı.
- Ölçüm tek yayınevi (YDS Publishing, SM2 Set) ve 3+4 kitapla yapıldı; farklı
  yayınevlerinde host/anahtar/erişim davranışı ölçülmedi, genelleme riskli.
- **`m-`/`__` varyantlarını kimin/neyin ürettiği ve tükettiği bulunamadı**
  (§7.4) — mevcut motor JS ve Android shim bunları hiç talep etmiyor,
  `GetKitapGuncellemeBilgi` hiçbir parametre kombinasyonuyla bunları
  döndürmüyor. İçerik modeli kitap başına köklü farklı (§7.2) — bu iki
  varyantın nasıl/ne zaman üretildiği (canlı pipeline mı, elle mi, eski bir
  istemci için mi) SQL/kaynak koduyla teyit edilemedi; körü körüne "mobil ⇒
  daha küçük/daha kaliteli" varsayımı yapılmamalı.
- `__` varyantı yalnız 1 kitapta (9053-1) test edildi ve bulundu; ekranda
  görülen diğer `__` örnekleri bu turda denenmedi (zaman kısıtı) — genel
  oran/kural çıkarılamaz.
- Bir SQL sorgusu sırasında pipeline DB kimlik bilgisi terminale bir kez
  yazdırıldı (debug amaçlı `echo`); değer hiçbir dosyaya/rapora yazılmadı,
  yalnızca bu oturumun geçici çıktısında göründü — rotasyon önerilir.

## 9) Sürüm katmanlaması (Storage7 SMB ölçümü, 26.09)

Hipotez DOĞRULANDI: `Uploads/ZKitapZip/<id>-<v>/` (dikkat: `ZKitapZipH` DEĞİL,
`H`'siz — ayrı bir ağaç) her sürüm için yalnız O SÜRÜMDE DEĞİŞENİ tutan bir
klasördür; `ZKitapZipH` bunun (genelde) TEK bir güncel düz zip'e SIKIŞTIRILMIŞ
hâlidir — versiyon başına ayrı zip YOK (58237-7.zip / 58237-12.zip HTTP HEAD
**404**, yalnız en güncel 58237-14.zip var).

### 9.1 — 58237: sürüm başına üst dizinler + dosya sayısı

| Sürüm | Üst dizinler (var olanlar) | htmletk | audio | pages/thumbs | Klasör boyutu (du) |
|---|---|---|---|---|---|
| 1 | data, json, pages, thumbs, +log | — | — | 120/120 (küçük taslak, sayfa1=17.967 B) | 4,4 MB |
| 2 | data, pages, thumbs | — | — | 120/120 | 97,9 MB |
| 3 | data, htmletk, pages, thumbs | 166 | — | 120/120 | 116,7 MB |
| 4 | data, htmletk | 166 | — | — | 18,9 MB |
| 5 | data, htmletk, json, pages, thumbs, +log | 166 | — | 120/120 | 118,3 MB |
| 6 | audio, data, htmletk | 350 | 16 | — | 73,7 MB |
| **7** | **audio, data, htmletk, json, pages, thumbs, +log** | **529** | **25** | **120/120** | **216,3 MB** |
| 8 | audio, data, htmletk | 529 | 25 | — | 117,9 MB |
| 9 | audio, data, htmletk | 529 | 25 | — | 117,9 MB |
| 10 | audio, data, htmletk | ~523* | 25 | — | 115,7 MB |
| 11 | audio, data, htmletk | 521* | 25 | — | 115,4 MB |
| 12 | audio, data, htmletk | 519* | 25 | — | 114,6 MB |
| 13 | **YOK** (klasör hiç oluşmamış) | — | — | — | — |
| 14 (canlı) | data, pages, thumbs, +xml | **YOK** | **YOK** | 120/120 (YENİDEN kodlanmış) | 97,6 MB |

\* v10 sayımı SMB'de 3 farklı denemede 523/339/112 gibi tutarsız sonuç verdi —
büyük/derin `htmletk` dizininde `find` bu mount üzerinde GÜVENİLMEZ; v10-12
için yalnız v11(521)/v12(519) göreli AZALMA yönü güvenilir, kesin sayı DEĞİL.

### 9.2 — Katmanlama kıyası: kaynak-acik (exe) vs sürümler

- **htmletk 529 + audio 25 → v7'den geliyor, BİREBİR.** v7'nin 529 htmletk dosya
  ADI listesi ile local exe referansının 529 adı **0 fark** (`diff` boş).
  3 örnek dosya (`index.html`, `u1/etk/43e23…js`, bir `CheckActivity` PNG'i) ve
  2 audio dosyası (`T.5.2.mp3`, `T.3.4.mp3`) byte-byte **birebir aynı** (Python
  `==` karşılaştırması, tam dosya). v8/v9 aynı sayıyı taşıyor (muhtemelen bu iki
  sürüm htmletk/audio'ya dokunmadı, başka şey değiştirdi).
- **Exe'nin sayfaları v2/v3/v5/v7 ile eşleşiyor, v14 ile DEĞİL.** SMB'deki plain
  (şifresiz) `pages/1.png` dosyasının ilk 100 baytına mod1 (`256-x`) uygulayıp
  CRC32 alınca: v2=v3=v5=v7 → `35a054d7` (3.770.121 B) = **local exe referansıyla
  birebir aynı**. v14'ün sayfası FARKLI: plain hâli 3.754.319 B (v2-7'den 15.802
  B küçük), mod1 sonrası CRC `80fbe0bf` — hem exe'den HEM v2-7'den farklı, YENİDEN
  kodlanmış/değiştirilmiş bir sayfa. **Kanıt zinciri tam kapanıyor:** aynı
  dosyanın plain SMB hâline mod1 uygulanınca ZKitapZipH zip'inin central
  directory CRC'siyle TAM eşleşiyor (`80fbe0bf`=`80fbe0bf`) — yani mod1 şifreleme
  paketleme anında (zip/exe üretiminde) uygulanıyor, ZKitapZip'teki KAYNAK
  DÜZ/ŞİFRESİZ duruyor.
- **Exe'de olup hiçbir sürümde (1..14) olmayan:** yalnız `flexibleItems.json`
  (v1/5/7/10/12/14'te ayrı ayrı denendi, hepsinde YOK) — panelin exe-create
  anında ürettiği ek metadata, delta sistemine hiç girmiyor.

**Sonuç:** yerel exe referansı = **v7'nin dondurulmuş görüntüsü** (htmletk+
audio+pages üçü de v7 ile birebir), v8-v12'nin küçük htmletk değişiklikleri VE
v14'ün sayfa/audio/htmletk kesintisi exe'ye hiç yansımamış — exe daha eski.

### 9.3 — İkinci kitap: 58336 (aynı model, ama KESİNTİSİZ)

| Sürüm | htmletk | audio | video | pages/thumbs | Not |
|---|---|---|---|---|---|
| 1 | 410 | — | — | 136/136 | ilk yükleme |
| 4 | 826 | — | — | (devam) | |
| 5 | 881 | — | — | (devam, son kez `pages` klasörü VAR) | v6+'da pages klasörü bir daha hiç görünmüyor |
| 8 | 1029 | 58 | — | — | audio ilk kez |
| 12 | 1029 | 58 | 11 | — | video ilk kez |
| **17 (canlı)** | **1050** | **58** | **12** | **(v5'ten miras)** | |

58336'da katmanlama HİÇ kesintiye uğramamış: htmletk monoton artıyor
(410→826→881→1029→1029→1050), audio/video eklendikten sonra hiç düşmüyor,
`pages` v5'te dondurulup sonraki 12 sürüm boyunca (hiç `pages` klasörü
taşımadan) miras kalıyor — ve **duz `58336-17.zip` bu mirası birebir yansıtıyor**
(§2'deki %100 eşleşme buradan geliyor). 58237 ile fark: 58237'de v13 hiç
oluşmamış ve v14 üç içerik türünü (htmletk/audio/pages-eski-hâli) BİRDEN
düşürmüş — 58336'da böyle bir kesinti YOK. Yani delta sistemi kendi başına
kayıp üretmiyor; 58237'nin v13/14'ü ayrık bir olay (muhtemelen İNSAN/işlem
hatası ya da bilinçli "yalnızca sayfa düzeltmesi" push'u — ayrım SQL/kaynak
kod olmadan netleştirilemedi).

### 9.4 — ZKitapZip (kaynak) vs ZKitapZipH (paket) aynı sürümde birebir mi?

EVET, dönüşüm kuralı basit ve tutarlı: **`pages/*` mod1 ile şifrelenir, geri
kalan HER ŞEY (htmletk, audio, data, thumbs, video) OLDUĞU GİBİ zip'lenir.**
İki bağımsız kanıt: 58237-14 `pages/1.png` (yukarıda) ve 58336-17
`htmletk/index.html` (plain CRC `fda6911b` = zip CRC `fda6911b`, dönüşümsüz).
`ZKitapZipH` yalnız EN GÜNCEL sürümün paketini tutuyor — versiyon geçmişi
SADECE `ZKitapZip` tarafında yaşıyor.

### 9.5 — Sonuç: build klasörü hangi sürümlerin hangi sırayla bindirilmesi?

- **Normal/sağlıklı kitap (58336 örneği):** tek kaynak yeterli — `ZKitapZipH`
  güncel zip'i, çünkü flattening bozulmadan işlemiş. Katman katman indirmeye
  GEREK YOK.
- **58237 gibi kesintili kitap:** güncel zip/klasör (v14) yalnız `pages/thumbs/
  data`'yı doğru veriyor; `htmletk/audio` için TEK bilinen tam kaynak
  `ZKitapZip/<id>-7/` (veya 8-12, hepsi aynı içerik) — yani build klasörü şu
  BİRLEŞTİRME ile kurulmalı: **v14 (pages/thumbs/data, güncel) + v7 (htmletk/
  audio, çünkü hâlâ en eksiksiz hâli)**, İKİ kaynak, TEK sıralama kuralı yok
  çünkü ikisi FARKLI alt dizinlere yazıyor (çakışma yok).
- **Silinen dosya ifadesi:** HİÇBİR açık silme kaydı/manifesti bulunamadı
  (`tpng_*.xml` = test cevap anahtarı, `test_adjustment_detailed_log.txt` = QA
  log — ikisi de silme listesi DEĞİL). Bir sürümün bir alt dizini
  İÇERMEMESİ "dokunulmadı" ile "kasıtlı silindi" arasında AYIRT EDİLEMİYOR —
  58237 v14'ün htmletk/audio'yu düşürmesi bu yüzden yorumlanamıyor (bug mu,
  kasıtlı reset mi, açık soru).
- **Veri transferi (58237):** 13 sürümün RAW (sıkıştırılmamış) toplamı
  **≈1.294 MB**; güncel TEK flattened zip (sıkıştırılmış) **90,9 MB** — yani
  "tüm sürümleri indirip birleştir" güncel zip'i almaktan **~14×** daha
  pahalı. Ama bu kitapta güncel zip EKSİK olduğu için gerçekçi karşılaştırma:
  güncel zip (90,9 MB) + tek bir eksiksiz eski katman (v12 en küçüğü, 114,6 MB,
  ya da v7 en güvenlisi, 216,3 MB) ≈ **205-307 MB** — yine tüm-geçmişi-indirmekten
  (1,3 GB) çok daha ucuz, ama tek-zip-yeter (58336) durumuna göre 2-3× pahalı.

## Ham kanıt

`~/.empp-agent/arastirma/mobil-zip-20260926/` (zip listeleri, local listeler,
hız testi çıktısı, `varyant-head.tsv`, `58237-katman-topdir.txt`,
`58237-katman-counts.txt`, `58336-katman-topdir.txt`, `58336-katman-counts.txt`,
`58237-du.txt`, `htmletk-names-v{7,8,9,10,11,12}.txt`,
`htmletk-names-local.txt`).
