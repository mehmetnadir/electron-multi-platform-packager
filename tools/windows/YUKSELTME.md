# Guest izleyici yükseltmesi — tek sayfa reçete

> Ne zaman gerekli: host `src/windows/izleyici-surum.js` (`yukseltmeGerekliMi`) guest
> scriptinin **eski** (bb53314-benzeri) sürümde olduğunu söylediğinde. Ölçülen kusur:
> o sürümde kalp atışı ana döngüde SENKRON — `kur` görevi (1,3 GB indirme,
> `Start-Process -Wait`) döngüyü bloke edip kalbi susturuyor, host bunu "izleyici ölü"
> sanıp BAŞARILI işi BOZUK işaretliyor. HEAD sürümü kalbi `Start-Job` ile ayırdı.
>
> **2026-09-21 — İKİNCİ SEBEP (yeni, daha ciddi):** kalbin ayrılması yanlış alarmı
> kapattı ama ters yönde bir körlük açtı. `komut` dalındaki `& cmd /c $g.komut`
> çağrısının ZAMAN AŞIMI YOKTU: bir ajan `Get-PSDrive -PSProvider FileSystem`
> gönderdi, erişilemeyen bir ağ sürücüsünde asıldı, ana döngü **16+ dakika** bloke
> kaldı. Kalp ayrı işte attığı için host "ayakta, yaş 2 sn" gördü; alınan görev
> (`20260921-102107`) sonuç yazamadı, sıradaki görev (`20260921-102341`) hiç alınmadı.
> Tek kötü komut TÜM şeridi kilitledi ve host bunu göremedi.
>
> Yeni sürüm üç şeyi birden getirir:
>   1. **Görev başına zaman aşımı** — host her görevde `zamanAsimiSn` gönderir; guest
>      tavanı aşınca süreci VE ÇOCUKLARINI (`taskkill /T /F`) öldürür, sonuç dosyasına
>      `durum:"zaman-asimi"` + geçen süre + komutun ilk 160 karakterini yazar ve
>      sıradaki göreve geçer. Görev SESSİZCE kaybolmaz, şerit açılır.
>   2. **Kalp artık yalan söylemez** — her atış ana döngünün son ilerleme damgasını
>      (`sonDonguDamgasi`) taşır. Host "ayakta ama şerit N sn'dir ilerlemiyor" diyebilir.
>   3. `kur` dalındaki sınırsız `Start-Process -Wait` de aynı tavana bağlandı.

**Bu adımlar guest içinde ELLE yapılır — host'tan otomatik dokunma YASAK** (bu görev
tanımının kısıtı; ajan/betik guest'e komut göndermez, açmaz, yeniden başlatmaz).
**Parola gerekmez.** **Yeni pencere AÇMA** — halihazırda izleyicinin çalıştığı
PowerShell penceresini kullan.

## Adımlar

1. **Mevcut izleyiciyi durdur** — o pencerede `Ctrl+C` bas (izleyici görevin ortasında
   olsa bile pencere kilitli değildir; `finally` bloğu kalp işini temizler).

2. **Yeni scripti üstüne indir** (aynı pencerede, host'taki köprü ayaktayken):
   ```powershell
   curl.exe -o C:\vm-kapi\vm-izleyici.ps1 http://192.168.11.1:8791/<belirtec>/dosya/vm-izleyici.ps1
   ```
   `<belirtec>` değeri: az önce Ctrl+C ile durdurduğun komutun kendi satırında zaten
   görünüyor (yukarı ok / komut geçmişi ile bakabilirsin) — host tarafında
   `~/vm-kapi/durum/belirtec.txt` içinde de var. **Belirtecin DEĞERİNİ hiçbir sohbete,
   log'a veya bu dosyaya YAZMA** — 0600 izinli, tek amacı köprüye kimin eriştiğini
   sınırlamak.

3. **Aynı pencerede, aynı parametrelerle yeniden başlat** (komut geçmişinden yukarı ok
   ile son çalıştırdığın satırı geri çağırıp Enter'a basman yeterli — parametreler
   değişmedi):
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\vm-kapi\vm-izleyici.ps1 `
       -Adres http://192.168.11.1:8791 -Belirtec <belirtec>
   ```
   Ekranda "VM izleyici" ile başlayan, makine adını ve HTTP modunu bildiren satırı gör
   (script'in kendi `Write-Host` çıktısı — 160. satır).

4. **Host'tan doğrula** (guest'e dokunmadan, Mac'te):
   ```bash
   node tools/windows/vm-kapi.js hazir
   ```
   **Yükseltmenin DAVRANIŞSAL kanıtı `serit` alanıdır** — metin eşleşmesi değil,
   izleyicinin gerçekten ne gönderdiği:

   | `hazir` çıktısı | Anlamı |
   |---|---|
   | `"serit": "bilinmiyor"` | guest hâlâ **ESKİ** sürüm — kalp şerit damgası taşımıyor, yükseltme tutmamış |
   | `"serit": "akiyor"` | guest **YENİ** sürüm, döngü boşta ve ilerliyor → yükseltme başarılı |
   | `"serit": "calisiyor"` | yeni sürüm, o an bir görevin içinde (normal) |
   | `"serit": "tikali"` | ayakta **ama şerit ilerlemiyor** — çıkış kodu 5 |

   Çıkış kodları: `0` sağlam · `3` izleyici yok/ölü · `5` ayakta ama şerit tıkalı.
   Bekçi/izleyici betiği yazarken **0'dan farklı her kod arızadır** — eskiden
   "ayakta" tek başına yeşil sayılıyordu, 2026-09-21 arızasını bu kaçırdı.

   `src/windows/izleyici-surum.js` `surumTespit()` ARTIK bu yükseltmeyi de ayırt eder
   (2026-09-21 öğleden sonra onarıldı): çapa kümesi üçten **altıya** çıktı — eklenen
   üçü `zamanAsimiSn`, `Surec-Agaci-Oldur`, `sonDonguDamgasi` ve üçü de bilinen HİÇBİR
   eski sürümde (a9091a5…041bee8) geçmiyor. Önceki üç çapa 041bee8'te de mevcut
   olduğu için tespit zaman aşımsız bir izleyiciye "guncel" diyordu. Ayrıca sonuç artık
   üç değerli: okunan metin izleyici scripti değilse/boşsa `bilinmiyor` döner, `guncel`
   ASLA dönmez.

   **İki kanıt bağımsızdır, biri diğerinin yerine geçmez:** `serit` tablosu DAVRANIŞ
   ölçer (döngü gerçekten ilerliyor mu), `surumTespit()` METİN ölçer (dosya doğru
   sürüm mü). Yükseltme kabulünde ikisi birden istenir.

## Nelere DOKUNMA

- `vm-kapi-karar.js`, `yama-katmani.js`, `yama-defteri.js` — bu görevin kapsamı dışında,
  başka ajanlar üzerinde çalışıyor olabilir.
- Guest'e host'tan otomatik komut/dosya gönderme — bu reçete BİLEREK elle, çünkü görev
  guest'e dokunmayı yasaklıyor.
- `~/vm-kapi/durum/belirtec.txt` içeriği — asla sohbete/log'a yapıştırma.

## Cmd.exe "Erisim engellendi" hatası hakkında not

Bu yükseltme, `komut` görev türündeki ayrı bir bilinen soruna (Defender/ASR'ın
`powershell.exe` → `cmd.exe` çocuk sürecini reddetmesi ihtimali) ÇÖZÜM GETİRMEZ.
Yeni sürüm o çağrıyı `Start-Process $env:ComSpec` üzerinden yapar — reddedilirse
artık SESSİZ ASILMA yerine hata/çıkış kodu üretir, ama ASR kuralının kendisi
Windows tarafında ayrıca çözülmelidir.

## Zaman aşımı tavanı nasıl değişir

Tavan gövdeyle birlikte gider, script'e gömülü DEĞİLDİR:

```bash
node tools/windows/vm-kapi.js calistir "dir C:\" --zaman-asimi 120   # host 120 sn, guest 90 sn
node tools/windows/vm-kapi.js kur <exe|url> --zaman-asimi 3600        # host 3600, guest 3570
```

Guest tavanı host tavanından bilerek 30 sn kısadır (`GUEST_PAY_SN`): guest şeridini
host pes etmeden ÖNCE açsın ve sonuç dosyasına gerçek sebebi yazsın. `zamanAsimiSn`
alanı hiç gelmezse (eski host) guest kendi varsayılanlarına düşer: komut 600 sn,
kurulum 1800 sn.

---

# İzleyici kilitlenirse — uzaktan kurtarma (gözcü)

> **Neden bu bölüm var (ölçüldü, 2026-09-21):** izleyicinin ana döngüsü asıldı ve
> **40 dakika** kilitli kaldı. O sırada `node tools/windows/vm-kapi.js hazir
> --makine windows-kasa` → `{"durum":"ayakta","yasSn":4,"serit":"bilinmiyor"}`,
> **çıkış kodu 0 (YEŞİL)**. Gerçek: 10:21'de alınan görev sonuç yazmadı, 10:23:41'de
> kuyruğa giren görev 11:01'de hâlâ alınmamıştı. Kurtarmanın tek yolu makineye
> fiziksel gidip Ctrl+C basmaktı — **SSH (22) KAPALI, WinRM (5985/5986) KAPALI**,
> RDP (3389) açık ama odak çalıyor (ajan kullanamaz), SMB (445) yalnız dosya taşır.

## Neden gözcü — üç seçeneğin kıyası

| | (a) Windows **servisi** | (b) **Gözcü süreci** (seçilen) | (c) **WinRM/SSH açmak** |
|---|---|---|---|
| Asılmayı gerçekten kurtarır mı | **Hayır.** Servis/görev "yeniden başlat" politikası yalnız SÜREÇ ÇIKIŞINDA tetiklenir; asılan süreç çıkmaz. 40 dakikalık arızada 0 kez tetiklenirdi | **Evet.** İlerleme damgası eskiyince süreç ağacını öldürür, yeniden başlatır | Hayır — yalnız insan/ajan *fark ederse* elle müdahale imkânı verir |
| Ekran kanıtı (`Ekran-Al`) | **Kırılır.** Servis Oturum 0'da koşar, `CopyFromScreen` siyah verir → kabul kapısının 3 şartından biri (ekran) düşer | Korunur (masaüstü oturumunda koşar) | Etkilenmez |
| Uzaktan komut yüzeyi | yok | **yok** (yalnız çekme; Windows'ta açılan port 0) | **var** — tailnet'e açık yeni bir dinleyici |
| Nadir'in tek seferlik adımı | ~6 (servis sarmalayıcı + hesap + izin) | **5** (aşağıda) | ~7 (yetenek kurulumu, servis, güvenlik duvarı, anahtar dağıtımı, ACL) |
| Yönetici hakkı | gerekir | **gerekmez** (görev kaydı reddedilirse Başlangıç klasörü yedek yolu) | gerekir |
| Geri alma | servis sil + kayıt temizliği | **tek komut**, iz bırakmaz | yetenek kaldır + kural sil |
| Köprü sunucusunda değişiklik | — | **0 satır** (var olan `dosya` ve `sonuc` uçları kullanılır) | — |

**Karar: (b).** Gerekçe tek cümle değil, üç ölçü: (1) bugünkü arıza bir **asılmaydı, çökme
değildi** — (a)'nın yeniden başlatma politikası sıfır kez tetiklenirdi; (2) (a)'nın servis
biçimi ekran kanıtını öldürür, yani K18 kabul kapısını bozar; (3) (c) tek başına **hiçbir
şeyi otomatik kurtarmaz** ve karşılığında tailnet'e yeni bir dinleyici açar. (a)'nın işe
yarayan kısmı — **zamanlanmış görev** — (b)'nin altında kullanılıyor: gözcüyü oturum
açılışında başlatır ve 5 dakikada bir "hâlâ koşuyor mu" diye bakar. (c) kapalı kalır;
gözcü kurulduktan sonra uzaktan kurtarma zaten **inbound erişim gerektirmiyor**.

**Bağımlılık (açık yazılıyor):** gözcünün kararı, ana döngünün bastığı **ilerleme damgasına**
(`%LOCALAPPDATA%\vm-kapi\dongu.json` → `sonDonguDamgasi`) dayanır. O damgayı bu belgenin
üst kısmındaki yeni izleyici sürümü üretir (`izleyici-zaman-asimi` ajanının işi). **Önce
izleyici yükseltmesi, sonra gözcü.** Damga yoksa gözcü "iyi" demez — günlüğe `ELLE` yazar
ve hiçbir şey öldürmez (ölçüm 2026-09-21: windows-kasa kalp dosyası 24 bayt çıplak ISO =
eski sürüm, `serit:"bilinmiyor"`).

## Nadir'in tek seferlik adımları (makine açıkken)

1. **Önce izleyiciyi yükselt** — bu belgenin başındaki 4 adım. `serit` alanı
   `akiyor`/`calisiyor` göstermeden gözcüye geçme.
2. **Gözcü dosyalarını indir** (izleyicinin koştuğu pencerede değil, **yeni** bir
   PowerShell penceresinde; `<belirtec>` değerini yapıştırırken ekrana yazdırma):
   ```powershell
   curl.exe -o C:\vm-kapi\vm-gozcu.ps1      http://<mac-ip>:8791/<belirtec>/dosya/vm-gozcu.ps1
   curl.exe -o C:\vm-kapi\gozcu-kur.ps1     http://<mac-ip>:8791/<belirtec>/dosya/gozcu-kur.ps1
   curl.exe -o C:\vm-kapi\gozcu-kaldir.ps1  http://<mac-ip>:8791/<belirtec>/dosya/gozcu-kaldir.ps1
   ```
3. **Belirteci makineye bir kez yaz** (gözcü izleyiciyi yeniden başlatırken buradan okur;
   **değeri hiçbir sohbete/log'a yazma**, kaynağı Mac'te `~/vm-kapi/durum/belirtec.txt`):
   ```powershell
   Set-Content -Path C:\vm-kapi\belirtec.txt -Value '<belirtec>' -NoNewline -Encoding ascii
   ```
4. **Kur** (yönetici gerekmez; betik izinleri kendisi daraltır):
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\vm-kapi\gozcu-kur.ps1 `
       -Adres http://<mac-ip>:8791 -Makine windows-kasa
   ```
5. **Kanıt** — makinede `Get-Content C:\vm-kapi\gozcu.log -Tail 20`, Mac'te:
   ```bash
   node tools/windows/vm-kapi.js hazir --makine windows-kasa-gozcu   # yaş büyümemeli
   ```

## Kilitlendiğinde ne yapılır (artık Mac'ten)

```bash
node tools/windows/vm-kapi.js hazir --makine windows-kasa        # serit: tikali mi?
node tools/windows/izleyici-kurtar.js --makine windows-kasa      # uzaktan tetik bırak
node tools/windows/vm-kapi.js hazir --makine windows-kasa        # ~30 sn sonra: akiyor
```

`izleyici-kurtar.js` **hiçbir port açmaz**: `~/vm-kapi/yeniden-baslat-windows-kasa.txt`
dosyasına yeni bir damga yazar, gözcü onu köprünün var olan `dosya` ucundan çeker.
Gözcü ayrıca **kendiliğinden** de müdahale eder (boş şerit > 60 sn, ya da görev tavanı +
60 sn payı aşıldı). Kestiği görevi sessizce kaybetmez: host'a `durum:"zaman-asimi"` +
`GOZCU KESTI: <sebep>` yazar, `hazir`/`bekle` bunu alarm olarak görür.

**Hâlâ elle müdahale gereken durumlar** (gözcü `ELLE` yazar, hiçbir şey öldürmez):
- **Damga yok** — izleyici eski sürüm. Çözüm: bu belgenin başındaki yükseltme.
- **Saatlik tavan doldu** (1 saatte 3 müdahale) — tekrar eden bir arıza var; gözcü
  bilerek durur. Frensiz bir autoFix'in günde 288 restart ürettiği ve bekçinin
  kapatıldığı emsal bu freni doğurdu.
- **Gözcünün kendisi ölü** — `hazir --makine windows-kasa-gozcu` yaşı büyüyorsa
  zamanlanmış görev 5 dakikada bir geri getirir; getirmiyorsa makineye bakılmalı.
- **Belirteç dosyası yok/bozuk** — gözcü izleyiciyi başlatamaz, günlüğe `HATA` yazar.

## Güvenlik kararı

- **Windows tarafında açılan port YOK.** Kurtarma yolu *çekme* yönündedir; SSH/WinRM
  kapalı kalır. Bu, (c) seçeneğinin reddedilmesinin asıl karşılığıdır.
- **Tetiği kim bırakabilir:** (1) tailnet üyesi olmak **ve** (2) 24 hex yol belirtecini
  bilmek. Yani "tüm tailnet" değil, "tailnet ∩ belirteci bilen". Köprü zaten yalnız
  `bridge*` + Tailscale adreslerine bağlanıyor, `0.0.0.0` asla.
- **Tetiğin etki alanı sınırlı:** yalnız *izleyiciyi yeniden başlatır*. Komut çalıştırma
  kanalı ayrı ve değişmedi (`gorev` kuyruğu). Tetik dosyasının içeriği sır değil, sayaçtır.
- **Belirteç değeri:** repoda, betiklerde, günlükte **geçmez**. Makinede yalnız
  `C:\vm-kapi\belirtec.txt` içinde durur; kurulum betiği `icacls ... /inheritance:r
  /grant:r <kullanıcı>:(R)` ile devralmayı kaldırır. Kaynağı Mac'te
  `~/vm-kapi/durum/belirtec.txt` (0600). Bir sapma testi betiklerde 24 hex değer aramaz
  — bulursa kırılır.
- **Önerilen ek daraltma (Nadir kararı, bu görevin kapsamı dışında):** Tailscale ACL ile
  8791/tcp'yi yalnız Mac ↔ windows-kasa arasına kısmak. Gözcü buna bağımlı değil.

## Geri alma

```powershell
powershell -ExecutionPolicy Bypass -File C:\vm-kapi\gozcu-kaldir.ps1
```
Zamanlanmış görevi, yedek Başlangıç kısayolunu, koşan gözcü sürecini ve gözcünün durum
dosyasını kaldırır. **İzleyiciye ve belirteç dosyasına dokunmaz** (onlar gözcüden önce de
vardı) ve **günlüğü korur** (kanıt; silmek için `-GunlukleriDeSil`). Sonrası 2026-09-21
öncesi hâldir: izleyici elle yönetilir. Kurulan servis, açılan port, eklenen güvenlik
duvarı kuralı olmadığı için geri alma tek adımdır.

## Makinede doğrulanacak (Mac'ten ÖLÇÜLEMEDİ)

Bu Mac'te `pwsh` yok (`which pwsh powershell` → boş), yani PowerShell gövdesi **hiç
çalıştırılamadı ve gerçek sözdizimi denetimi yapılamadı**. Mac'te yapılabilen: metin
düzeyinde değişmez testleri (`tools/windows/vm-gozcu.test.js`, 12 test). Makinede
sırayla doğrulanacaklar:

1. `powershell -NoProfile -Command "[void][ScriptBlock]::Create((Get-Content -Raw C:\vm-kapi\vm-gozcu.ps1)); 'sozdizimi OK'"` — gerçek ayrıştırıcı kabul ediyor mu.
2. `gozcu-kur.ps1` yönetici olmadan `Register-ScheduledTask`'ı geçiyor mu; geçmiyorsa
   yedek Başlangıç yolu kuruluyor mu.
3. Zamanlanmış görev **masaüstü oturumunda** mı koşuyor: gözcünün başlattığı izleyici
   penceresi görünüyor mu ve `ekran` görevi **siyah olmayan** PNG üretiyor mu.
4. `%LOCALAPPDATA%` eşleşmesi: gözcü günlüğündeki `damga yolu:` satırı, izleyicinin
   yazdığı `dongu.json` ile **aynı kullanıcı profilinde** mi.
5. `-KuruProva` ile bir tur: karar doğru mu (hiçbir şey öldürmeden).
6. Yapay kilit tatbikatı: izleyiciye tavanı aşan bir görev verilip gözcünün
   (a) süreç ağacını öldürdüğü, (b) `GOZCU KESTI` sonucunu host'a yazdığı,
   (c) yeni izleyicinin kuyruğu **5 sn içinde** aktığı ölçülmeli.
7. `taskkill /T /F` yolunun bu makinede izinli olduğu (Defender/ASR reddi yok).
8. `izleyici-kurtar.js` tetiğinden sonra gözcünün en geç bir tur (15 sn) içinde
   müdahale ettiği.
