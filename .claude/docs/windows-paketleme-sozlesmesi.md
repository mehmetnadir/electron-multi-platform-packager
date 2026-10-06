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
| build zip (Üretim Masası; geçişte İmpark exe'si), `book_id`, türetilen tür, `guncellemeTabani`, logo | `<Ad>-<sürüm>-Setup.exe` (ia32 NSIS, oneClick, kullanıcı-başına, tr/en-US); G tar'ı YOK (D-2, 26.09 — tek yazar `tools/g-yayin`) |

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
Tek yazar `tools/g-yayin` (D-2, 26.09); eski paketleyici→runner yolu karantinada (`_graveyard/2026-09-26-g-eski-uretici/`).
Güncellenen dosyalar SET kabuk beyaz listesiyle sınırlı (`src/packaging/set-kabuk.js`): kök kabuk + sf425 dizinleri
`config, features, images, languages, scripts, styles`; `_` ile başlayan kök dizinler (ör. `_eski`) yedektir, asla güncellenmez.

## Teslim ve yedek — KARARLANDI (Nadir, 2026-09-25)
Windows için müşteri TEK indirme görür (`/go/<kod>/windows`). Arkada iki kaynak vardır:
bizim NSIS paketimiz **varsa ve sağlamsa** o verilir; yoksa ya da sorunluysa İmpark'ın exe'si verilir.
"Sağlam" = kapı 0 FAIL + imzalı + geri alma işareti yok. İmzanın yolu ve kuralları aşağıdaki
**İmza (Authenticode)** bölümündedir; imzasız paket indirmeye çıkmaz, o sürede indirme İmpark exe'sidir. Panelde tek "Windows" satırı;
hangi kaynağın verildiği ayrı alanda tutulur (`build_method`: `passthrough` | `build`).

## Yayına alma — KARARLANDI (Nadir, 2026-10-01)
> Nadir 01.10: *"bugünden itibaren windows paketleri bizim üretimimiz ve imzalama mekanizması ile
> imzalanıp sisteme yüklenmesi lazım."* 01.10 ölçümü: sözleşme 26.09'dan beri ONAYLI ama 57 windows
> satırının 57'si `build_method` NULL (passthrough) — runner windows şeridi tek iş almamıştı.

1. **Varsayılan `build`:** her windows satırı `build_method='build'` olur (mevcut + yeni açılan).
   Passthrough yalnız geçiş yedeğidir: R2'de duran İmpark exe'si, bizim imzalı paketimiz üstüne
   yazılana kadar indirilir; işçi `build` satırına bir daha YAZMAZ (`windowsBuildKorumaKararVer`).
2. **Pilot önce:** ilk satır 45482 (01.10 15:2x). Nadir panelden "Windows" yeniden kuyruğa alır, paketi
   kendisi dener. Pilot geçmeden toplu geçiş ve otomatik yeniden üretim YAPILMAZ.
3. **Pilot sonrası:** kalan satırlar `build`'e çevrilir (yedek: srv21
   `/root/yedek-deploy/build-method-oncesi-20261001.tsv`), yeni satır varsayılanı koda girer;
   üretim oto-kontrol düzeninde sürer (kapı + imza + kabul, her paket kanıtla).
4. **Ön koşul (Mac):** İmpark VPN + Storage7 SMB bağlı (`~/bin/impark-diskler.sh`); yoksa runner
   windows yeteneğini ilan etmez, iş bekler — İmpark exe'si indirilmeye devam eder.

## İmza (Authenticode) — TEK KAYNAK
> Nadir 30.09: imza sözleşmesi exe üretim sözleşmesinin içinde durur. Bu bölüm Windows imzası için tek
> kaynaktır; skill `windows-imzalama`, `scripts/OKU-imza-yuva-smb.md` ve diğer belgeler buraya bağlanır,
> ayrı kural yazmaz. Bölümdeki kararlar tarihleriyle önceki onaylardan taşındı; yeni karar eklenmedi.

**Yol (tek canlı yol):** Kendi kod imzalama sertifikamız YOK. Paket, İmpark'ın panel imza kuyruğunda
imzalanır. Kuyruk dosyanın içine değil yoluna bakar: `…/Uploads/KitapTekExe/66902/windows.exe` o an ne ise
onu imzalar. Yuvayı Mac besler — İmpark VPN + Storage7 SMB üzerinden `scripts/imza-yuva-smb.sh`
(`hazirla` · `bekle-ve-tak` · `hizli-kontrol` · `toplu`; 92 test, gerçek yuvaya dokunmaz). Yuva kimliği
(66902) ve canlı tetik betikte SABİTTİR; başka kitabın yuvasına asla yazılmaz. İmpark'ın kendi exe'si
(passthrough) aynı kuyrukta imzalı gelir; `yayincilikadm` imzasız exe'yi R2'ye koymaz (`pe_is_signed`).

**İmza kimliği (ölçüldü 25-26.09):** DigiCert Trusted G4 Code Signing RSA4096 SHA384 · imzacı
`O=İm Park Bilişim … LTD. ŞTİ., C=TR` · DigiCert RSA4096 SHA256 zaman damgası (sertifika bitişi
**2027-07-03**; zaman damgası sayesinde imza bitişten sonra da geçerli kalır). Kullanıcı yayımcı olarak
"İm Park Bilişim" görür. İmza bloğu ≈ 10,4 KB.

**Ön koşullar (her koşudan önce ölçülür):** (1) İmpark VPN açık — `ping 172.17.2.21`; açıksa tünele
dokunulmaz. (2) Storage7 bağlı (`~/Impark/Storage7/vhosts/akillitahta.ydspublishing.com/httpdocs/Uploads/KitapTekExe`
okunur). (3) Tetik Mac'te: `yayincilikadm book exe-create 66902 --wait 0`; yuvayı boşaltma
`yayincilikadm book exe-remove 66902 --yes` (silme sunucuda olur). Tetik ve gözcü ayrı süreçtir.
(4) Canlı tetik İmpark'ın canlı hattına dokunur: Nadir'in o iş için onayı olmadan koşulmaz; kuru prova
(`KURU=1`) serbest.

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
   imzaya gitmez. Ağır işler (derleme + kabul) 2 slotlu semafordan geçer (`~/.empp-agent/agir.sh`, karar
   defteri G); "paralel" bu tavanla sınırlı, sınırsız eşzamanlı derleme değildir.
2. **Yükle (toplu):** GEÇEN paketlerin hepsi imza hazırlık dizinine (`KitapTekExe/_hazir/`) kopyalanıp
   geri okunur (`imza-yuva-smb.sh toplu`, `SMB_SHA=0`). Kopya süresi İmpark hattına bağlıdır (25.09
   0,2 MB/sn · 26.09 4,6 MB/sn); kopyalar imzadan önce biter, imza sırası kopya beklemez.
   **06.10 (Nadir: "geri okumayı atla · imzayı paralel yapalım"):** kasa yolunda (`imza-yuva-win.js`) geri
   okuma varsayılan KAPALI — sha256 yerelde kopyadan önce, kopya sonrası uzak BOYUT eşitliği; imzalı dönüşte
   gövde eşitliği + Authenticode aynen. `EMPP_IMZA_GERI_OKUMA=1` eskiyi açar. İmza bekçisi boru hattı:
   paket N imza/kabul/yayındayken paket N+1'in `_hazir` kopyası (en çok 1 ileri kopya; yuva/imza tekil);
   kapatma `EMPP_IMZA_ON_KOPYA=0`. Mac `imza-yuva-smb.sh` geri okumayı sürdürür.
3. **İmzala (sırayla):** paket başına tetik → takas → imza → hızlı kontrol → `_imzali/`; bekleme kuralı
   (3 sa + 1 yeniden deneme 1 sa, sonra bildirim) paket başına uygulanır; biri düşerse sıra DURUR.
4. **İndir ve doğrula:** imzalı dosya indirilir; `osslsigncode verify` (imzacı İm Park Bilişim, zincir +
   CRL) ve başsız kabul yeniden koşar. İkisi de geçmeden paket yayına çıkmaz.
5. **Yayınla:** R2'ye yüklenir, kayıtta `build_method=build`; önceki İmpark exe'si yedek olarak kalır.
Bu koşuda ölçülen (26.09, 715 MB): hazırlık 7 dk 42 sn, tetikten imzaya ~6 dk — norm değil.

**Doğrulama kapısı (yayın öncesi, hepsi):** `hizli-kontrol` → imzalı ve BİZİM (Authenticode özetini
doğrulamaz, ön kontroldür) · indirilen kopyada `osslsigncode verify` Succeeded (imzacı İm Park Bilişim,
zincir + CRL, zaman damgası) · `pe_is_signed` (sertifika dizini dolu; `yayincilikadm r2_publish` ile aynı
ölçüt) · başsız kabul yeniden GEÇER. İmzalı boyut ≈ özgün + ~10,4 KB yalnız ipucudur; çıkış kodu kanıt
değildir. Teslim klasörüne kanıt yazılır (imzacı, zaman damgası, sha256, bu koşudaki süre).

**Ne imzalanır — açık risk (ÖLÇÜLMEDİ):** yuva yalnız tek dosyayı, dış `<Ad>-<sürüm>-Setup.exe`'yi imzalar.
Kurulan uygulama exe'si ve kaldırıcı (`Uninstall …exe`) imzasız kalır. Windows 11 Smart App Control açık
makinede imzasız iç exe'yi engelleyebilir; gerçek makinede ölçülene kadar risk olarak durur
(`windows-uretim-metodu-karar-2026-09-25.md` §3).

**Yayın ön şartı:** srv21 işçisinin `build_method=build` satırını tanıması (açık iş 9) ve runner Windows
şeridinin açılması (`EMPP_RUNNER_WINDOWS`, açık iş 11). İkisi de ayrı onaydır.

**Kullanılmayan / ölü yollar (yeniden önerilmez):**
| Yol | Durum |
|---|---|
| RDS1 ajanıyla yuvaya yazma (`yayincilikadm ajan yaz`, eski `exe-imzalama` skill'i) | ÖLÜ — RDS1 2026-09-19'da kalıcı kapandı; açılan iş sonsuz `pending` kalır. Yerine bu bölümdeki SMB yolu |
| Kendi sertifikamız (Certum Standard Cloud · DigiCert OV + KeyLocker, jsign ile Mac'ten) | ERTELENDİ (Nadir, 26.09; yayımcı adı sonra). Seçenek ve maliyet: `windows-uretim-metodu-karar-2026-09-25.md` §3 |
| SignPath OSS başvurusu (kökte `SIGNPATH_*.md`) | Kullanılmıyor; bu repoda gönderim kaydı yok |
| electron-builder `signtoolOptions.publisherName` | Yalnız ad yazar, sertifika yok — imza üretmez |

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
3. ✅ Üretim ed25519 anahtar çifti üretildi (Nadir, 26.09 — karar defteri A5 KAPANDI; test anahtarı
   `~/.empp-agent/test-guncelleme-ed25519.key` üretime çıkmaz). Anahtar detayı: `karar-defteri-2026-09-26.md` A5.
   `EMPP_SET_GUNCELLEME=windows` AÇIK; toplu Windows üretimi artık bu şartla engellenmiyor.
4. ✅ 3001 bayrakları platform kapsamlı: `EMPP_ICERIK_GUNCELLEME=windows`, `EMPP_SAYFA_WEBP=windows`,
   `EMPP_SET_GUNCELLEME=windows` (26.09, üretim anahtarı üretildikten sonra `0`'dan çevrildi) — `run-agent.sh`
   + KANON tablosu. mac/linux/android istemcisi gelince listeye eklenir (karar defteri A5).
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
11. Runner Windows şeridi dalda (`runner-windows`, `src/agent/windows-serit.js`), anahtar `EMPP_RUNNER_WINDOWS` KAPALI: üret → kapı (13 G) → kabul → `_hazir` → sıralı imza → osslsigncode + md5 → kabul → R2 `build_method=build`; imzasız yol yok, G set'ini runner yüklemez (tek yazar g-yayin).

## Yapılmayacaklar
Aktivasyon akışına dokunmak · yayıncının özel menüsüne dokunmak (K17) · asar'ı SET dışında değiştirmek ·
`node_modules` içindeki electron-builder şablonlarını değiştirmek · sözleşmede satırı olmayan yama.
