# İmza Yuvası Gerçek Koşu — 66902 (2026-09-26)

## Özet
NSIS Windows paketimiz (A, 2.51.0, 715.784.252 B) İmpark imza yuvası 66902 üzerinden
uçtan uca imzalandı, indirilip tam doğrulandı, Wine'da sessiz kuruldu. **Test paketi —
içinde TEST güncelleme anahtarı var, yayına çıkmadı**, yalnız kanıt amaçlı.

## Adımlar ve süreler (BU KOŞUDA ölçüldü — İmpark kuyruğunun o anki yüküne bağlı, NORM SAYILMAZ)
1. Kuru test: `imza-yuva-smb.test.sh` → 70 PASS / 0 FAIL.
2. Ortam: VPN açık (172.17.2.0/24, utun4), Storage1-10 bağlı. Yuvada 18.09 tarihli eski
   test dosyası (152.704 B) duruyordu — betik bunu taban alıp değişimi bekledi (tasarımı gereği).
3. `toplu` akışı (`SMB_SHA=0 TETIK=1 …toplu liste.txt --tavan-dk 90`), tek paket:
   - hazırla (kopya + geri okuma + sha256 doğrulama): **462 sn** (7dk42) — kopya 150 sn
     @4,6 MB/s, geri okuma+sha256 312 sn @2,2 MB/s.
   - tetik (`yayincilikadm book exe-create 66902 --wait 0`, TETIK=1 ile otomatik) → pencere
     (İmpark dosyayı yuvaya yazana kadar): **168 sn**.
   - takas (mv + geri okuma doğrulama): <1 sn (113 ms mv + 145 ms okuma).
   - imza (kuyruğun alıp imzalayıp yuvaya geri yazması): **198 sn**.
   - toplam (hazırlıktan `TOPLU TAMAM`'a): **829 sn (13dk49)**.
4. `yayincilikadm book exe-remove 66902 --yes` → `windows: Başarı ile kaldırıldı`,
   `pardus: Başarı ile kaldırıldı`.

## İmza kimliği ve zaman damgası
İmzacı: **İm Park Bilişim Elektronik Basın Yayın ve Reklam. Eğt. LTD. STİ.** (DigiCert
Trusted G4 Code Signing RSA4096 SHA384 2021 CA1 tarafından verilmiş, notAfter 2027-07-03).
Zaman damgası (DigiCert TSA): **2026-09-26 09:22:55 UTC**.

## Doğrulama
- Betiğin `hizli-kontrol` (yerel imzalı + orijinal): İMZALI ve BİZİM, gövde örnekleri eşit,
  sertifika dizini ofseti 715.784.256 (orijinal 715.784.252 + 4 B hizalama, ≤7 B beklenen
  aralıkta).
- `osslsigncode verify` (indirilmiş yerel kopyada): **Succeeded**, "Signature verification: ok",
  sertifika zinciri (DigiCert root → code signing CA → İm Park) ve CRL kontrolü (internet
  erişimiyle) **ok**.

## Wine kurulum bütünlüğü
İzole `WINEPREFIX`'te sessiz kurulum (`wine "...Setup.exe" /S`): çıkış kodu **0**, süre
41 sn (+ wineboot init 29 sn). "Installer integrity check has failed" mesajı ÇIKMADI.
Kurulum dizininde uygulama + kaldırıcı mevcut:
`AppData/Local/Programs/super-monsters-2-set/Super Monsters 2 Set.exe` (+ Uninstall...exe),
toplam 919 MB.

## Sorunlar
- Wine 10.0 kurulumunda `WINEARCH=win32` desteklenmiyor ("not supported in wow64 mode") —
  arch belirtmeden (varsayılan wow64) koşturunca düzeldi. Betiğin kendisiyle ilgisiz.
- Başka adımda 2 deneme sınırına takılan/DURAN adım olmadı; tüm zincir ilk denemede geçti.

## Toplu üretim için darboğaz hesabı
**(a) Bu koşunun hızıyla:** paket başı ~829 sn (~14 dk) → 50 paket, seri işlem (betik
paketleri sırayla işliyor) ≈ 690 dk ≈ **11,5 saat**.
**(b) En kötü durumda (yeni sözleşme kuralı — imzasız dönülmez, 1. deneme tavanı 3 sa +
1 kez yeniden deneme 1 sa, sonra bildirim):** paket başına tavan 4 sa → 50 paket =
**200 saat** teorik tavan (yalnız HER paket tavana çarparsa; gerçekçi beklenti ikisinin
arasında, kuyruk yüküne bağlı).
Not: bugünkü kopya hızı (4,6 MB/s) 25.09 ölçümünden (0,2 MB/s) 23× farklı — İmpark
tarafının o anki yüküyle değişken, sabit bir norm olarak kullanılmamalı.

## Kapsam ve yan etkiler
Yalnız kitap 66902 hedeflendi, başka `exe-create` çalıştırılmadı. `imza-yuva-smb.sh`
DEĞİŞTİRİLMEDİ (başka ajan ayrı çalışma ağacında güncelliyor). git yazma yok. R2/panel/DB'ye
betiğin kendi yuva akışı ve `exe-remove 66902` dışında yazma yapılmadı.

Kanıt dosyaları: imzalı yerel kopya
`~/Downloads/Windows/SM2-WIN-SOZLESME-TEST-20260926/imzali/`, çalışma log'ları
`scratchpad/imza-66902/` (kosum.log, osslsigncode-verify.log, wine-test.log, exe-remove.log).
