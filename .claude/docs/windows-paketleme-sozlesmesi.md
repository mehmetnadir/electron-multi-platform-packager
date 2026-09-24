# Windows Paketleme Sözleşmesi — NSIS SET paketi  `[SÖZLEŞME: TASLAK]`

> Nadir 2026-09-23: "exe üretiminde sözleşmeyi imzalamadık." Doğru — bu belge imza için.
> ONAYLI olana kadar aşağıdaki koda (üç parça) commit/deploy YOK; taslak kod diskte bekler.

## Amaç
Yayıncının Windows exe'sinden (origin, tek kod bütünü = `packagingService`) kurulum deneyimi
düzeltilmiş, asar'sız, sayfaları kayıpsız WebP, SET güncelleme kanallı bir NSIS paketi üretmek.
Kitap türü üretimi belirler: tek kitap · çoklu set · **aktivasyon kodlu** (aktivasyon akışı EZİLMEZ).

## Girdi → Çıktı
| Girdi | Çıktı |
|---|---|
| origin exe (zip'e açılmış kabuk + `bookN/`), `setKimligi`, `guncellemeTabani`, logo | `<Ad>-<sürüm>-Setup.exe` (ia32 NSIS, oneClick, kullanıcı-başına, tr/en-US) + `guncelleme.tar.gz` |

## Paket kuralları (kapı `scripts/windows-paket-kapisi.js`, 13 madde; bugün 10 PASS · 0 FAIL · 2 ÖLÇÜLEMEDİ · 1 RAPOR)
1. Kuruluysa sormadan aç; **sürüm farklıysa güncelle** (sürüm = içerik + paketleyici kaynağı + kapı bayrakları hash'i; sabit 1.0.0 YASAK — 22.09 arızası).
2. CRC ön-tarama yok, sahte yüzde satırı yok, Türkçe metin, logo beyaz kutu temizliği.
3. Açılış: `show:false` + `ready-to-show` + 8 sn emniyet; güncelleme ötelemesi; "Kitap Açılıyor.." ekranı YOK (K27b) — gerçek indirmede "Kitap Güncelleniyor %N" kalır.
4. SET paketinde asar KAPALI (`resources/app/` dizin) — güncelleyici dosya yazabilsin.
5. Sayfa PNG'leri **kayıpsız** WebP (ad `.png` kalır; q82'de pikselleşme görüldü, 22.09).
6. `version.txt` 3 parçalı (yayıncı güncelleyicisi 350 MB tuzağı), `empp-set.json` + güncelleyici enjekte.

## Güncelleme kanalı (detay: `kitap-guncelleme-sozlesmesi.md`)
Uçlar yayıncının R2 kovasında **statik**: `<r2Config.publicUrl>/guncelleme/set/<id>/{surum.json, manifest.json, dosya/…}`.
Üç parça: paketleyici üretir → API presign verir (R2 anahtarı srv21'de) → runner sırayla yükler ve canlı `surum.json`'u doğrular.

## Tetikleyici — KARAR BEKLİYOR (Nadir)
(a) Yeni platform `windows-set` (origin exe `windows` olarak kalır, NSIS paketi ayrı teslim)
(b) `windows` teslimi NSIS paketiyle DEĞİŞİR (müşteri yalnız bizim paketi görür)
Şef önerisi: (a) — geri alınabilir, origin exe kanıt olarak kalır; panelde iki satır.

## Set kimliği — KARAR BEKLİYOR (Nadir) — ölçüldü 2026-09-23
book-update şemasında bir satırın "tek kitap" mı "SET" mi olduğunu söyleyen alan YOK; `short_code`
paylaşım slug'ı, `paket_id` MySQL'e yazılmıyor, `SetKitapId` yalnız İmpark MS SQL'de. Bu yüzden claim
yükünde `setKimligi` şimdilik daima `null` + sebep döner; güncelleme kanalı ancak kimlik gelince çalışır.
Seçenekler: (1) `pipeline_book_summaries.set_kimligi` (+ `kitap_turu`: tek|set|aktivasyonlu) alanı, panelden
girilir/İmpark'tan senkron; (2) `bookId` = setKimligi varsayımı (R2 `softwares/<bookId>` kuralıyla uyumlu ama
tek kitapları da SET sanır). Şef önerisi: (1) — kitap türü zaten ilke 5'te üretimi belirliyor, alan olmalı.

## Kabul ölçütü (bir paket "bitti" demeden)
- Kapı 0 FAIL; ÖLÇÜLEMEDİ maddeleri (3, 5) kurulumda gözle: eski kurulum güncellendi, `app.asar` yok, açılış ekranı yok.
- Güncelleme denemesi: v2 kabuk sunulunca ikinci açılışta değişiklik görünür, `.empp-set-guncelleme.json` yazılır.
- Aktivasyon kodlu bir kitapta aktivasyon akışı bozulmamış (ölçülecek — bugüne kadar SM4 set'te ölçüldü, aktivasyonlu kitapta ÖLÇÜLMEDİ).

## Yapılmayacaklar
Aktivasyon akışına dokunmak · yayıncının özel menüsüne dokunmak (K17) · asar'ı SET dışında değiştirmek · sözleşmede satırı olmayan yama.
