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
1. Taslak kodu ana ağaca al + commit (kod şu an `~/01dev/_worktrees/win-sozlesme`, dal `taslak/win-sozlesme-20260926`).
2. Sessiz arıza: makensis başarısız olup eski Setup.exe dururken paketleyici başarı diyor → sıfır-dışı çıkışta FAIL.
3. Üretim ed25519 anahtar çifti (test anahtarı `~/.empp-agent/test-guncelleme-ed25519.key` üretime çıkmaz).
4. 3001 bayrakları: `EMPP_ICERIK_GUNCELLEME`, `EMPP_SET_GUNCELLEME`, `EMPP_SAYFA_WEBP` → `~/.empp-agent/run-agent.sh`
   + `temiz-restart-bekle.sh` KANON tablosu; temiz restart kuyruk boşken.
5. `_` önekli kök dizinleri (ör. SM2 `_eski/`) pakete alınmasın — tüm platformlar.
6. Ölçülecek: aktivasyonlu kitapta aktivasyon akışı; G6 gerçek Windows'ta; İmpark `zkitap` localStorage göçü (yok);
   B'nin A üstüne VM'de kurulumu (kapı madde 3); Defender/SmartScreen tarama süresi (bizim dışımızda).
7. İmza: İmpark imza yuvası gerçek koşu (ofiste). Yayımcı adı / Certum başvurusu ertelendi.

## Yapılmayacaklar
Aktivasyon akışına dokunmak · yayıncının özel menüsüne dokunmak (K17) · asar'ı SET dışında değiştirmek ·
`node_modules` içindeki electron-builder şablonlarını değiştirmek · sözleşmede satırı olmayan yama.
