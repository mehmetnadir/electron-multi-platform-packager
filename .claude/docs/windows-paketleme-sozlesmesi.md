# Windows Paketleme Sözleşmesi — NSIS SET paketi  `[SÖZLEŞME: ONAYLI]`

> **Onay:** Nadir, 2026-09-26 09:30. Windows 11 ARM VM'inde A paketini (Super Monsters 2 Set 2.51.0) kurdu:
> *"kurulum çok hızlı ekrana geldi, bilgilendirmeler de oldukça iyi şekilde sunuldu. Bu windows sözleşmesinin
> onayladığım anlamına geliyor. Son eksiklere bakacağız ama windows exe paketinin üretimini etkileyen şeyler
> olmadığı kesin."*
> Geçmiş: 2026-09-23 "exe üretiminde sözleşmeyi imzalamadık" → 25.09 G1–G6 kararları → 26.09 test paketi → onay.

## Amaç
Yayıncının Windows exe'sinden ya da Üretim Masası build zip'inden (origin, tek kod bütünü = `packagingService`)
kurulum deneyimi düzeltilmiş, asar'sız, sayfaları kayıpsız WebP, SET güncelleme kanallı bir NSIS paketi üretmek.
Kitap türü üretimi belirler: tek kitap · çoklu set · **aktivasyon kodlu** (aktivasyon akışı EZİLMEZ).

## Girdi → Çıktı
| Girdi | Çıktı |
|---|---|
| build zip (Üretim Masası; geçişte İmpark exe'si), `book_id`, türetilen tür, `guncellemeTabani`, logo | `<Ad>-<sürüm>-Setup.exe` (ia32 NSIS, oneClick, kullanıcı-başına, tr/en-US) + `guncelleme.tar.gz` |

## Paket kuralları (kapı `scripts/windows-paket-kapisi.js`, 15 madde)
1. Kuruluysa sormadan aç; **sürüm farklıysa güncelle**. Sürüm = `2.<panel kodu>.<paket sayacı>` (G3). Panelde ayrı
   sürüm alanı yok; panel kodu kitap adındaki `vNN`'den okunur (SM2-MMv51 → 51). Panelde sürüm alanı açılınca oradan
   okunur. İçerik hash'i yalnız değişiklik TESPİTİ için; sabit 1.0.0 YASAK (22.09 arızası).
2. CRC ön-tarama yok, sahte yüzde satırı yok, Türkçe metin, logo beyaz kutu temizliği.
3. Uygulama açılışı: `show:false` + `ready-to-show` + 8 sn emniyet; güncelleme ötelemesi; "Kitap Açılıyor.." ekranı
   YOK (K27b). Gerçek indirmede "Kitap Güncelleniyor %N" kalır.
4. SET paketinde asar KAPALI (`resources/app/` dizin), güncelleyici dosya yazabilsin.
5. Sayfa PNG'leri **kayıpsız** WebP (ad `.png` kalır; q82'de pikselleşme görüldü, 22.09).
6. `empp-set.json` + güncelleyici enjekte; kanal Ş kapalı işareti ya da 3 parçalı `version.txt` (350 MB tuzağı).
7. **Kurulum ekranı (26.09, Nadir'in "boş ekran" şikâyeti):** çift tıklamadan hemen sonra "Kurulum hazırlanıyor…"
   kutusu; sonra pencerede evre metinleri "Eski sürüm kaldırılıyor…" → "Kurulum dosyası hazırlanıyor…" →
   "Dosyalar açılıyor: X / Y MB" (gerçek bayt) → "Kısayollar oluşturuluyor…". Dosyalar **tek kez**, doğrudan
   kurulum dizinine açılır (geçici klasör + ikinci kopya yok). Kurulum dosyası kendini LOCALAPPDATA'ya kopyalamaz
   (electron-updater kullanılmıyor). İkinci tıklama ikinci kurulum başlatmaz. Açma sonrası uygulama exe'si yoksa
   hata kutusu + çıkış 2. Kod: `src/packaging/nsis-kurulum.js` + kendi şablon kopyamız (`node_modules`'e dokunulmaz).
8. **Zamanlama günlüğü:** kurulum ve açılış evreleri `%APPDATA%\<ad>\acilis-zamanlama.log` (UTC, süreç başından
   geçen süre, işlemci mimarisi alanları). Kurulum dizinine yazılmaz.

## Güncelleme kanalı (detay: `kitap-guncelleme-sozlesmesi.md`)
Uçlar yayıncının R2 kovasında **statik**: `<r2Config.publicUrl>/guncelleme/set/<id>/{surum.json, manifest.json, dosya/…}`.
Üç parça: paketleyici üretir → API presign verir (R2 anahtarı srv21'de) → runner sırayla yükler ve canlı `surum.json`'u doğrular.
Güncellenen dosyalar SET kabuk beyaz listesiyle sınırlı (`src/packaging/set-kabuk.js`): kök kabuk + sf425 dizinleri
`config, features, images, languages, scripts, styles`; `_` ile başlayan kök dizinler (ör. `_eski`) yedektir, asla güncellenmez.

## Teslim ve yedek — KARARLANDI (Nadir, 2026-09-25)
Windows için müşteri TEK indirme görür (`/go/<kod>/windows`). Arkada iki kaynak vardır:
bizim NSIS paketimiz **varsa ve sağlamsa** o verilir; yoksa ya da sorunluysa İmpark'ın exe'si verilir.
"Sağlam" = kapı 0 FAIL + imzalı + geri alma işareti yok. İmza gelene kadar (Certum başvurusu ertelendi,
yayımcı adı sonra) bizim paket imzayı İmpark imza yuvasından (66902, ofiste, `scripts/imza-yuva-smb.sh`)
alır; imzasız paket indirmeye çıkmaz, o sürede indirme İmpark exe'sidir. Panelde tek "Windows" satırı;
hangi kaynağın verildiği ayrı alanda tutulur (`build_method`: `passthrough` | `build`).

**İmza bekleme kuralı — KARARLANDI (Nadir, 2026-09-26):** İmpark imza kuyruğunun süresi onların yüküne
bağlıdır; tek ölçüm (26.09: tetikten imzaya ~6 dk) norm DEĞİLDİR, plan ve raporda "bu koşuda" diye geçer.
Paket **imzalanmadan dönmez**: 1. deneme 3 saate kadar bekler; imza gelmezse yuva temizlenip (exe-remove)
**bir kez** yeniden denenir, 2. deneme 1 saat bekler; yine gelmezse iş hata verir ve Nadir'e bildirim
gider ("imza kuyruğunda sorun olabilir — İmpark'tan düzeltme talebi"). İmzasız paket hiçbir koşulda
yayına/R2'ye çıkmaz; o sürede indirme İmpark exe'sidir.

**Toplu üretim ve imza akışı — KARARLANDI (Nadir, 2026-09-26: "hepsini üretip, ürettiklerimizi yüklemeye
geçelim; sonra sırayla imzalatırız ve indiririz"):** imza kuyruğu tek yuvalı ve sıralıdır; bekleme
paralel işlerle doldurulur.
1. **Üret (paralel):** kapsamdaki bütün Windows paketleri yerelde üretilir (kaynak: bugün İmpark exe'si,
   sonra kitap id'den build klasörü). Her paket başsız kabul kapısından (`tools/kabul`) GEÇER; RED olan
   imzaya gitmez.
2. **Yükle (toplu):** GEÇEN paketlerin hepsi imza hazırlık dizinine (`KitapTekExe/_hazir/`) kopyalanıp
   geri okunur (`imza-yuva-smb.sh toplu`, `SMB_SHA=0`). Kopya süresi İmpark hattına bağlıdır (25.09
   0,2 MB/sn · 26.09 4,6 MB/sn); kopyalar imzadan önce biter, imza sırası kopya beklemez.
3. **İmzala (sırayla):** paket başına tetik → takas → imza → hızlı kontrol → `_imzali/`; bekleme kuralı
   (3 sa + 1 yeniden deneme 1 sa, sonra bildirim) paket başına uygulanır; biri düşerse sıra DURUR.
4. **İndir ve doğrula:** imzalı dosya indirilir; `osslsigncode verify` (imzacı İm Park Bilişim, zincir +
   CRL) ve başsız kabul yeniden koşar. İkisi de geçmeden paket yayına çıkmaz.
5. **Yayınla:** R2'ye yüklenir, kayıtta `build_method=build`; önceki İmpark exe'si yedek olarak kalır.
Bu koşuda ölçülen (26.09, 715 MB): hazırlık 7 dk 42 sn, tetikten imzaya ~6 dk — norm değil.

## Kimlik ve kitap türü — KARARLANDI (Nadir, 2026-09-25)
Kimlik = setin/kitabın kendi `book_id`'si; elle girilen alan YOK. Tür **deterministik** türetilir:
- kitap sayısı > 1 → `set`, değilse `tek`;
- `imKeys.dll` varsa **ya da** DB'de anahtar aktif/doluysa → `aktivasyonlu` (set ya da tek ile birlikte olabilen işaret).
Türetme üretim anında yapılır ve pakete (`empp-set.json`) + kayda yazılır. (DB'deki anahtar alanının yeri ölçülecek.)

## Kaynak — KARARLANDI (Nadir, 2026-09-25)
Set seçildiğinde setteki kitapların verisi İmpark'tan çekilir; Üretim Masası'nın ürettiği **build zip**
(doğru kabuk + kitaplar) dört platformun kaynağı olur. Bizim hattımız deploy edilip testleri bitene kadar
İmpark exe'si kaynak olmaya devam eder (bugünkü build zip yolu: Nadir İmpark'a yükler, köprü onu alır).
Build zip'in **son 2 sürümü** R2'de saklanır (geri dönüş + Web-Z v2 kaynağı; book-update sözleşmesi "Kaynak arşivi").
Aktivasyon: çevrimdışı pakette `imKeys.dll` / İmpark DB anahtar kanalı olduğu gibi kalır (ezilmez).

## Kararlar G1–G6 — Nadir 2026-09-25, uygulandı 2026-09-26
| # | Karar | Uygulama |
|---|---|---|
| G1 | İmpark içerik güncellemesi (kanal K) Windows'ta userData altındaki WORK dizinine açılır; paket K'yi AÇABİLMELİ | `runtime/icerik-guncelleme.js`, `platforms/common/fs-shim.js`, `packaging/icerik-guncelleme.js` Windows'ta açık; adm-zip `empp-vendor/`'da; kapı madde 14 |
| G2 | Kurulum dizinine yazma yok: `imKeys.dll`, `storage.im`, K içeriği userData'da; kaynaktaki `bookN/temp/data/storage.im` pakete girmez | `packagingService.js` storage.im'i dışlar, WORK = userData; kapı madde 15 |
| G3 | Tetik = verdiğimiz kimlik + panelde artan sürüm kodu; **yalnız değişen dosyalar** (delta); kapsam kök kabuk + bookN okuyucu/motor; kitap içeriği K'de | Güncelleyici pakette; canlı v2 henüz yayınlanmadı |
| G4 | Manifest ed25519 ile imzalı, açık anahtar pakete gömülü; imzasız/https-dışı manifest reddedilir | `runtime/kitap-guncelleyici.js`, `packaging/set-kimligi.js`; kapı 13-D. Test paketleri TEST anahtarıyla imzalı |
| G5 | Yayıncının okuyucu güncellemesi (kanal Ş) pakette KAPALI; yeni Ş sürümü Üretim Masası'nda kabul/red; kabul edilirse kanonik okuyucu olur, G3 ile gider | Windows'ta her durumda kapalı (`packagingService.js`); kapı madde 11 |
| G6 | Aynı kitabın İmpark kurulumu varsa bizimki kurulunca kaldırılır: yalnız kimliği eşleşen `C:\DijiTap\<vhost>\<ad>` + kısayolları; `zkitap` SİLİNMEZ; önce aktivasyon ve veri taşınır; yetki yoksa atlanır, loglanır; İmpark açıksa dokunulmaz | `runtime/impark-kaldir.js`, ilk açılıştan ~15 sn sonra koşar |

## Kabul kanıtı (26.09)
- VM (Windows 11 ARM, x86 öykünmesi): A 2.51.0 kuruldu; ilk kutu hızlı geldi, evre metinleri görüldü (Nadir).
  Kapı madde 5 (Türkçe metin, sahte yüzde yok) böylece gözle geçti.
- Wine sessiz kurulum (Mac): A 39 sn (açma 28 sn); B, A'nın üstüne 42 sn (eski sürüm kaldırma 10 sn, açma 23 sn);
  kullanıcı verisi korundu, `app.asar` yok. Kıyas: 20.09 fiziksel kasa, düzeltme öncesi 67–83 sn, bilgisiz banner.
- Kapı (C2 düzeltmesi sonrası yeniden üretim): 12 PASS · 0 FAIL · 2 ÖLÇÜLEMEDİ (3, 5: sıkıştırılmış NSIS metni) · 1 RAPOR.
- Testler: 1.717 testin 1.709'u geçti; 2 FAIL eski (`_graveyard/` yokluğu), 6 atlandı.

## Üretimi etkilemeyen açık işler (onaydan sonra)
1. ✅ Taslak kod ana ağaçta (`ded619e`, `c11aae0`, 2026-09-26).
2. ✅ Sessiz arıza kapandı (`436daa0`): exit≠0'da yalnız bu derlemede üretilmiş Setup.exe kabul edilir
   (updateInfoBuilder'ın zararsız hatası); teslimden önce taze mtime + birebir `<ad>-<sürüm>-Setup.exe` adı
   aranır, eski exe'ler silinmeden kenara alınır.
3. Üretim ed25519 anahtar çifti (test anahtarı `~/.empp-agent/test-guncelleme-ed25519.key` üretime çıkmaz).
   Toplu Windows üretiminden ÖNCE şart; yedek yeri Nadir kararı.
4. ✅ 3001 bayrakları platform kapsamlı: `EMPP_ICERIK_GUNCELLEME=windows`, `EMPP_SAYFA_WEBP=windows`,
   `EMPP_SET_GUNCELLEME=0` (üretim anahtarına kadar) — `run-agent.sh` + KANON tablosu.
5. ✅ `_` önekli kök dizinler hiçbir platform paketine girmez (`436daa0`, `kok-yedek-dizin-disla.js`).
6. Aktivasyon (26.09): 45480 Marvel 11 (keypanel: 15 kitabın 13'ü kod ister) paketlendi, G1/G2 statik PASS,
   başsız kabul GEÇTİ. Motorun kuralı (kod okundu, `da55ad5c…main.js` modül 6395): kapak başına
   `imKeys.dll` varsa kod ekranı; yoksa çevrimiçi `HasZKitapKey`; ağ yoksa hata yutulur → kod SORULMAZ.
   Yani başsız (ağsız) kabul aktivasyonu ölçemez; kanıt yalnız internetli VM testidir.
   BEKLİYOR: Nadir VM testi (`~/vm-kapi/MARVEL11-AKTIVASYON-TEST-*`: kod ekranı, kalıcılık, B-üstüne-A).
   Rapor: `arastirma/aktivasyon-windows-testi-2026-09-26.md`. Ayrıca ölçülecek: G6 gerçek Windows'ta;
   Defender/SmartScreen tarama süresi (bizim dışımızda).
7. ✅ İmza: İmpark imza yuvası (66902) gerçek koşu 26.09 — SM2 A 715 MB imzalandı; imzacı İm Park Bilişim
   (DigiCert Trusted G4 Code Signing), `osslsigncode verify` Succeeded (zincir + CRL), imzalı exe Wine'da sessiz
   kuruldu (0, bütünlük hatası yok). Bu koşuda: hazırlık 462 sn, tetikten imzaya ~6 dk, toplam 13 dk 49 sn.
   Bekleme kuralı betikte (`4e78243`: 180 dk → exe-remove + yeniden tetik → 60 dk → `bildir onay`;
   92 test, mutasyonla doğrulandı). İkinci denemenin CANLI yolu henüz gerçek kuyrukta koşmadı. Rapor: `arastirma/imza-yuvasi-gercek-kosu-2026-09-26.md`.
   Yayımcı adı / Certum başvurusu ertelendi.
8. Başsız kabul kapısı (`tools/kabul`, `b12d2ff`): SM2 Windows A GEÇTİ; runner'da mac+android açık,
   Windows paketleri srv21'de üretildiği için henüz runner kapısında değil.

9. **Yayın ön şartı:** srv21 işçisi `build_method=build` satırını bugün tanımıyor; passthrough bizim
   imzalı exe'mizi İmpark'ınkiyle ezebilir. Toplu akışın 5. adımından (Yayınla) önce işçi kodu + deploy
   (Nadir onayı) şart.
10. Kaynak ayrıntısı artık `kitap-kaynak-sozlesmesi.md`'de (TASLAK): düz zip kanonik, delta tamamlama,
    İmpark exe yalnız fallback.

## Yapılmayacaklar
Aktivasyon akışına dokunmak · yayıncının özel menüsüne dokunmak (K17) · asar'ı SET dışında değiştirmek ·
`node_modules` içindeki electron-builder şablonlarını değiştirmek · sözleşmede satırı olmayan yama.
