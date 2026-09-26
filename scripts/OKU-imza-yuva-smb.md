# imza-yuva-smb.sh — 66902 imza yuvasını Mac'ten SMB ile besleme

RDS1 ajanı kapandığı için (`exe-imzalama` skill'i) yuvaya yazma işi artık Mac'ten, İmpark
VPN'i ve bağlı Storage7 SMB diski üzerinden yapılır. İmza kuyruğu dosyaya bakmaz, **yola**
bakar: `…/Uploads/KitapTekExe/66902/windows.exe`. Yuva kimliği ve CANLI tetik komutu betikte
**sabittir**.

## Komutlar

| Komut | Ne yapar |
|---|---|
| `hazirla <yerel.exe>` | `KitapTekExe/_hazir/<ad>`'a kopyalar (yuvanın YANI; `exe-create` 66902'yi boşaltır), geri okuyup boyut + sha256 doğrular |
| `bekle-ve-tak <yerel.exe> [--tavan-dk N] [--tavan2-dk N] [--hizli]` | pencereyi (yuvada boyut/mtime değişip durulması = İmpark SFX'i) bekler, `_hazir` → yuva `mv`, geri okur, imzayı bekler. Varsayılan: imzalıyı yerele indirip tam doğrular; `--hizli`: İNDİRMEDEN kabul. **İmza bekleme kuralı** (aşağıda) burada uygulanır |
| `hizli-kontrol <smb-yol> [<yerel-orijinal.exe>]` | salt okuma, dosyayı indirmeden imzalı mı + bizim mi |
| `toplu <liste.txt> [--tavan-dk N] [--tavan2-dk N]` | satır başına bir yerel exe (`#` yorum). Önce HEPSİ hazırlanır; sonra sırayla, PAKET BAŞINA: tetik → takas → imza (`--hizli`) → son hızlı kontrol → `mv` yuva → `KitapTekExe/_imzali/<ad>`. Her paket kendi **İmza bekleme kuralı** döngüsünü ayrı ayrı çalıştırır. Bir paket 2. denemede de düşerse DURUR, sonrakine geçmez, özet basar |

Çıkış: 0 tamam · 2 kullanım/ön koşul · 3 tavan (2 denemede de) ya da imzasız · 4 takas tutmadı,
imzalı dosya bizim değil ya da imzacı yanlış.

## İmza bekleme kuralı (Nadir, 2026-09-26)

İmpark imza kuyruğunun süresi onların yüküne bağlı; paket imzalanmadan yayına/`_imzali/`'ye
ÇIKMAZ. `bekle-ve-tak` (ve `toplu`'nun her paketi) şu sırayı izler:

1. **1. deneme** — tavan varsayılan **180 dk** (`--tavan-dk` ile ezilir). Bu sürede pencere
   görünüp takas olur ve imza gelirse biter (çıkış 0).
2. Tavan dolarsa (bugünkü tek-deneme `hata 3`'ün yerine): (a) yuvada ne kaldığı `hizli-kontrol`
   ile İNDİRMEDEN ölçülüp loglanır; (b) yuva temizlenir (CANLI: `yayincilikadm book exe-remove
   66902`; KURU: sahte `EXE_REMOVE_KOMUTU`); (c) paket yeniden `hazirla` ile hazırlanır ve tetik
   (`TETIK=1` ise betik çeker, değilse bugünkü gibi yazdırıp bekler); (d) **2. deneme** başlar,
   tavan varsayılan **60 dk** (`--tavan2-dk`).
3. 2. deneme de tavan dolarsa: iş **çıkış 3** ile biter ve bildirim gider (CANLI: `bildir`;
   KURU: sahte `BILDIR_KOMUTU`) — `bildir onay "<ad>: 66902 imza kuyruğu 2 denemede imzalamadı
   (<tavan1>+<tavan2> dk) — İmpark'tan düzeltme talebi" -b "İmza kuyruğu" -p yuksek -e warning`.
   `bildir` yoksa/hata verirse yalnız loglanır, çıkış yine 3'tür — imzasız dosya HİÇBİR KOŞULDA
   `_imzali/`'ye çıkmaz.
4. Yuvada erken gelmiş **bizim exe'nin imzalı hâli** varsa (imza erken geldi) mevcut "üzerine
   yazma" koruması geçerlidir — yeniden deneme YOK, doğrudan başarı.
5. `toplu` kipinde bu döngü **paket başınadır**; bir paket 2. denemede de düşerse bugünkü gibi
   DURUR, sonraki paketlere geçilmez.

`TAVAN_SN` ortam değişkeni geriye uyumlu kalır: verilirse 1. denemenin tavanını (saniye
cinsinden) `--tavan-dk`'nın önüne geçerek ezer. Aynı şekilde `TAVAN2_SN` 2. denemeyi ezer
(KURU testlerde saniye ölçeğinde hızlı koşmak için kullanılır).

## Hızlı kontrol (indirmeden)
Rastgele erişimle yalnız şunlar okunur: ilk 4 KB (DOS başlığı → `e_lfanew` → optional header →
data directory[4]), sertifika bloğu (~10 KB), orijinal verilirse hizalama baytları + ilk 1 MB +
3 rastgele 256 KB aralık. **Toplam < 2 MB.**
- İmzalı sayılma: dizin boyutu > 0 **ve** dosya boyutu = ofset + boyut, WIN_CERTIFICATE
  türü PKCS#7 → `openssl pkcs7 -print_certs` ile imzacı (EKU Code Signing, CA değil) ve zaman
  damgası (TSTInfo genTime ya da TSA signingTime) yazılır; imzacı `İm Park Bilişim` olmalı.
- Orijinalle: imzalama dosyayı **8 bayta hizalar** (ölçüldü: 142.249 → ofset 142.256, imzalı
  152.704 = 142.256 + 10.448). Kural `orijinal ≤ ofset < orijinal + 8`; aradaki baytlar sıfır;
  aralıklar birebir (PE checksum + sertifika dizini girdisi hariç — imzalama bunları değiştirir).
- **Sınır:** Authenticode özetini ve sertifika zincirini DOĞRULAMAZ (dosyanın tamamı gerekir).
  Yayına/R2'ye almadan önce indirilen kopyada `pe_is_signed` + `osslsigncode verify` şart.

## CANLI akış (tetik ve yuvaya yazma Nadir'in onayıyla)
Tek paket: `hazirla` → `SMB_SHA=0 … bekle-ve-tak <exe>` (varsayılan tavanlar 180+60 dk, kural
yukarıda) → `PENCERE BEKLENİYOR` görününce AYRI terminalde `yayincilikadm book exe-create 66902
--wait 0` → bitince `yayincilikadm book exe-remove 66902`. 1. deneme tavanı dolarsa betik BUNU
**kendisi** yapar (exe-remove + yeniden hazırla + tetik yazdır/çek) ve 2. denemeye geçer —
elle tekrar müdahale gerekmez, yalnız 2. deneme için de tetik AYRI terminalde beklenmelidir
(`TETIK=1` verilmediyse).
Toplu: `SMB_SHA=0 scripts/imza-yuva-smb.sh toplu liste.txt`. Tetik varsayılan olarak her
pakette (her denemede) **yalnız yazdırılır** (`TETİK — AYRI terminalde ŞİMDİ çalıştır: …`);
`TETIK=1` verilirse betik tetiği taban izi alındıktan sonra ayrı süreçte kendisi çalıştırır.

## Ortam değişkenleri
| Değişken | Anlam |
|---|---|
| `SMB_SHA=0` | takasta ve başlangıçta SMB'den tam sha256 okuma YOK, yalnız boyut. Büyük dosyada ÖNERİLİR (`mv` içeriği değiştirmez; kimlik imza aşamasında doğrulanır) |
| `TETIK=1` | toplu kipte (ve yeniden denemede) tetiği çalıştır (CANLI: sabit `exe-create 66902`; KURU: yalnız sahte `TETIK_KOMUTU`, yoksa çıkış 2) |
| `TAVAN_SN` | 1. deneme tavanı saniye cinsinden — verilirse `--tavan-dk`'yı ezer (geriye uyumlu). Varsayılan `--tavan-dk 180` |
| `TAVAN2_SN` | 2. deneme (yeniden deneme) tavanı saniye cinsinden — verilirse `--tavan2-dk`'yı ezer. Varsayılan `--tavan2-dk 60` |
| `ARALIK_SN` | yoklama aralığı (varsayılan 2 sn, her turda tek satır log) |
| `EXE_REMOVE_KOMUTU` | yalnız KURU test kancası — 1. deneme tavanı dolunca çalıştırılır; CANLI'de SABİT `yayincilikadm book exe-remove 66902` |
| `BILDIR_KOMUTU` | yalnız KURU test kancası — 2. deneme de tavan dolunca çalıştırılır; CANLI'de SABİT `bildir` |
| `HAZIR_DIZIN`, `IMZALI_DIZIN` | yalnız CANLI; `HAZIR_DIZIN` 66902 içinde olamaz |

Takas geri okuması tutmazsa yerelden yeniden kopyalayıp 3 kez dener; yuvada **imzalı ve daha
büyük** dosya varsa (imza erken geldi) üzerine YAZMAZ — bu durumda yeniden deneme de devreye
girmez (doğrudan başarı sayılır).

## Test (gerçek yuvaya/SMB'ye dokunmaz)
`bash scripts/imza-yuva-smb.test.sh` → **92 PASS**, ≈2,5 dk (26.09'da 70 PASS'tan 92'ye çıktı —
22 yeni test imza bekleme kuralı için: (i) 1. denemede gelmez/2.'de gelir, (ii) iki denemede de
gelmez, (iii) 1. denemede gelir/yeniden deneme yok, (iv) toplu 2 paket karışık, (v) `--tavan-dk`/
`--tavan2-dk` argüman eşlemesi). `KURU=1 KURU_DIZIN=<mkdtemp>` kipinde sahte yuva; İmpark
(boşaltma + SFX), imza kuyruğu VE `exe-remove`/`bildir` arka planda taklit edilir; tek
kullanımlık test CA'sı. Ek fikstürler (yoksa ATLA): 18.09 İm Park/DigiCert imzalı test exe'sinin
yerel kopyası `~/.cache/imza-yuva-smb/66902-imzali-20260918.exe` (yuvadan salt-okuma `cp`),
imzasız NSIS `~/Downloads/Windows/SM2-WIN-NSIS-20260925/*.exe` (806 MB, yalnız 4 KB okunur).
Mutasyonla doğrulandı: gövde kontrolü, takas geri okuması, hızlı kontroldeki aralık karşılaştırması
kaldırılınca testler düşüyor (2 / 4 / 6 FAIL); **yeniden deneme dalı** kaldırılınca 12 FAIL
((i)/(ii)/(iv)/(v)'nin retry'a bağlı kontrolleri), **bildirim çağrısı** kaldırılınca 2 FAIL
((ii)'nin bildirim kontrolleri) — her ikisinde de kod birebir geri yüklenip `cmp` ile doğrulandı.

## Ölçümler (2026-09-25, Storage7)
- `hazirla` 50 MB: kopya **275 sn = 0,2 MB/s**; F_NOCACHE geri okuma + sha256 **35 sn = 1,4 MB/s**
  (sabah Mac→Storage7 yazma 17 MB/s ölçülmüştü → hat değişken; makine yükü 20-40).
- `hizli-kontrol` yuvadaki 152.704 B dosyada: orijinalsiz **14.544 B, 0,19 sn**; orijinalle
  **156.800 B, 0,32 sn** → İMZALI ve BİZİM, 2026-09-18 14:39:41 UTC (osslsigncode ile aynı).
- Bugünkü hızla 1,4 GB: hazırlık ≈ 2 sa (paketler önceden, toplu hazırlanmalı), tam sha256
  geri okuma ≈ 17 dk (→ `SMB_SHA=0`), hızlı kontrol ≈ 1,8 MB ≈ birkaç sn.

## Ölçülmüş bağlam — 26.09 ilk gerçek koşu (bu koşuda ölçülen, norm SAYILMAZ)
İmza kuyruğuna ilk canlı koşuda (715 MB paket, tek deneme, hiç yeniden deneme gerekmedi):
hazırlama **7 dk 42 sn**, pencere (SFX görünmesi) **+168 sn**, takas **+169 sn**, imza dahil
tamamı **+367 sn**. İmzacı: `İm Park Bilişim…`. Bu rakamlar tek bir koşunun ölçümüdür — yük
günden güne değişir (bkz. kural yukarıda: tam bu yüzden 1. deneme tavanı 180 dk gibi geniş
tutulur); sabit bir performans normu olarak OKUNMAMALI.

## Bilinen sınırlar
- İmza kuyruğunun dosyayı **alma anı** ölçülmedi; 1,4 GB ve toplu kip canlı koşulmadı.
- Art arda N paket: yuvadaki imzalıyı `_imzali/`'ye `mv` etmek yuvayı boşaltır; İmpark
  panelinin bundan etkilenip etkilenmediği ölçülmedi (tek paket akışında `exe-remove` var).
- Var olan dosyanın üzerine `mv` macOS smbfs'te **atomik değil** (önce sil sonra adlandır).
  Memory: `smb-uzerinde-atomik-takas-yok`.
- SMB öznitelik önbelleği yoklamayı birkaç sn geciktirebilir (ölçülmedi).
- `osslsigncode verify` (varsayılan indirmeli yol) CRL için internet ister.
