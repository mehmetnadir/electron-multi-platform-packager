# imza-yuva-smb.sh — 66902 imza yuvasını Mac'ten SMB ile besleme

RDS1 ajanı kapandığı için (`exe-imzalama` skill'i) yuvaya yazma işi artık Mac'ten, İmpark
VPN'i ve bağlı Storage7 SMB diski üzerinden yapılır. İmza kuyruğu dosyaya bakmaz, **yola**
bakar: `…/Uploads/KitapTekExe/66902/windows.exe`. Yuva kimliği ve CANLI tetik komutu betikte
**sabittir**.

## Komutlar

| Komut | Ne yapar |
|---|---|
| `hazirla <yerel.exe>` | `KitapTekExe/_hazir/<ad>`'a kopyalar (yuvanın YANI; `exe-create` 66902'yi boşaltır), geri okuyup boyut + sha256 doğrular |
| `bekle-ve-tak <yerel.exe> [--tavan-dk N] [--hizli]` | pencereyi (yuvada boyut/mtime değişip durulması = İmpark SFX'i) bekler, `_hazir` → yuva `mv`, geri okur, imzayı bekler. Varsayılan: imzalıyı yerele indirip tam doğrular; `--hizli`: İNDİRMEDEN kabul |
| `hizli-kontrol <smb-yol> [<yerel-orijinal.exe>]` | salt okuma, dosyayı indirmeden imzalı mı + bizim mi |
| `toplu <liste.txt> [--tavan-dk N]` | satır başına bir yerel exe (`#` yorum). Önce HEPSİ hazırlanır; sonra sırayla: tetik → takas → imza (`--hizli`) → son hızlı kontrol → `mv` yuva → `KitapTekExe/_imzali/<ad>`. Bir paket düşerse DURUR, sonrakine geçmez, özet basar |

Çıkış: 0 tamam · 2 kullanım/ön koşul · 3 tavan ya da imzasız · 4 takas tutmadı, imzalı dosya
bizim değil ya da imzacı yanlış.

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
Tek paket: `hazirla` → `SMB_SHA=0 … bekle-ve-tak <exe> --tavan-dk 60` → `PENCERE BEKLENİYOR`
görününce AYRI terminalde `yayincilikadm book exe-create 66902 --wait 0` → bitince
`yayincilikadm book exe-remove 66902`.
Toplu: `SMB_SHA=0 scripts/imza-yuva-smb.sh toplu liste.txt --tavan-dk 60`. Tetik varsayılan
olarak her pakette **yalnız yazdırılır** (`TETİK — AYRI terminalde ŞİMDİ çalıştır: …`);
`TETIK=1` verilirse betik tetiği taban izi alındıktan sonra ayrı süreçte kendisi çalıştırır.

## Ortam değişkenleri
| Değişken | Anlam |
|---|---|
| `SMB_SHA=0` | takasta ve başlangıçta SMB'den tam sha256 okuma YOK, yalnız boyut. Büyük dosyada ÖNERİLİR (`mv` içeriği değiştirmez; kimlik imza aşamasında doğrulanır) |
| `TETIK=1` | toplu kipte tetiği çalıştır (CANLI: sabit `exe-create 66902`; KURU: yalnız sahte `TETIK_KOMUTU`, yoksa çıkış 2) |
| `TAVAN_SN`, `ARALIK_SN` | tavan (varsayılan 20 dk) ve yoklama aralığı (2 sn, her turda tek satır) |
| `HAZIR_DIZIN`, `IMZALI_DIZIN` | yalnız CANLI; `HAZIR_DIZIN` 66902 içinde olamaz |

Takas geri okuması tutmazsa yerelden yeniden kopyalayıp 3 kez dener; yuvada **imzalı ve daha
büyük** dosya varsa (imza erken geldi) üzerine YAZMAZ.

## Test (gerçek yuvaya/SMB'ye dokunmaz)
`bash scripts/imza-yuva-smb.test.sh` → **70 PASS**, ≈1,5 dk. `KURU=1 KURU_DIZIN=<mkdtemp>`
kipinde sahte yuva; İmpark (boşaltma + SFX) ve imza kuyruğu arka planda taklit edilir; tek
kullanımlık test CA'sı. Ek fikstürler (yoksa ATLA): 18.09 İm Park/DigiCert imzalı test exe'sinin
yerel kopyası `~/.cache/imza-yuva-smb/66902-imzali-20260918.exe` (yuvadan salt-okuma `cp`),
imzasız NSIS `~/Downloads/Windows/SM2-WIN-NSIS-20260925/*.exe` (806 MB, yalnız 4 KB okunur).
Mutasyonla doğrulandı: gövde kontrolü, takas geri okuması ve hızlı kontroldeki aralık
karşılaştırması kaldırılınca testler düşüyor (2 / 4 / 6 FAIL).

## Ölçümler (2026-09-25, Storage7)
- `hazirla` 50 MB: kopya **275 sn = 0,2 MB/s**; F_NOCACHE geri okuma + sha256 **35 sn = 1,4 MB/s**
  (sabah Mac→Storage7 yazma 17 MB/s ölçülmüştü → hat değişken; makine yükü 20-40).
- `hizli-kontrol` yuvadaki 152.704 B dosyada: orijinalsiz **14.544 B, 0,19 sn**; orijinalle
  **156.800 B, 0,32 sn** → İMZALI ve BİZİM, 2026-09-18 14:39:41 UTC (osslsigncode ile aynı).
- Bugünkü hızla 1,4 GB: hazırlık ≈ 2 sa (paketler önceden, toplu hazırlanmalı), tam sha256
  geri okuma ≈ 17 dk (→ `SMB_SHA=0`), hızlı kontrol ≈ 1,8 MB ≈ birkaç sn.

## Bilinen sınırlar
- İmza kuyruğunun dosyayı **alma anı** ölçülmedi; 1,4 GB ve toplu kip canlı koşulmadı.
- Art arda N paket: yuvadaki imzalıyı `_imzali/`'ye `mv` etmek yuvayı boşaltır; İmpark
  panelinin bundan etkilenip etkilenmediği ölçülmedi (tek paket akışında `exe-remove` var).
- Var olan dosyanın üzerine `mv` macOS smbfs'te **atomik değil** (önce sil sonra adlandır).
  Memory: `smb-uzerinde-atomik-takas-yok`.
- SMB öznitelik önbelleği yoklamayı birkaç sn geciktirebilir (ölçülmedi).
- `osslsigncode verify` (varsayılan indirmeli yol) CRL için internet ister.
