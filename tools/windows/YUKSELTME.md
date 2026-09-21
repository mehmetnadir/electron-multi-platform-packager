# Guest izleyici yükseltmesi — tek sayfa reçete

> Ne zaman gerekli: host `src/windows/izleyici-surum.js` (`yukseltmeGerekliMi`) guest
> scriptinin **eski** (bb53314-benzeri) sürümde olduğunu söylediğinde. Ölçülen kusur:
> o sürümde kalp atışı ana döngüde SENKRON — `kur` görevi (1,3 GB indirme,
> `Start-Process -Wait`) döngüyü bloke edip kalbi susturuyor, host bunu "izleyici ölü"
> sanıp BAŞARILI işi BOZUK işaretliyor. HEAD sürümü kalbi `Start-Job` ile ayırdı.

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
   node tools/windows/vm-kapi.js hazir     # {"durum":"ayakta","yasSn":...}
   ```
   İstersen `src/windows/izleyici-surum.js` ile de doğrulanabilir: yeni script
   içeriğini (`curl` ile indirdiğin dosyanın bir kopyasını) `surumTespit()`'e ver,
   `surum:'guncel'` dönmeli.

## Nelere DOKUNMA

- `vm-kapi-karar.js`, `yama-katmani.js`, `yama-defteri.js` — bu görevin kapsamı dışında,
  başka ajanlar üzerinde çalışıyor olabilir.
- Guest'e host'tan otomatik komut/dosya gönderme — bu reçete BİLEREK elle, çünkü görev
  guest'e dokunmayı yasaklıyor.
- `~/vm-kapi/durum/belirtec.txt` içeriği — asla sohbete/log'a yapıştırma.

## Cmd.exe "Erisim engellendi" hatası hakkında not

Bu yükseltme, `komut` görev türündeki ayrı bir bilinen soruna (Defender/ASR'ın
`powershell.exe` → `cmd.exe` çocuk sürecini reddetmesi ihtimali) ÇÖZÜM GETİRMEZ —
o, `tools/windows/vm-izleyici.ps1:202`'deki `& cmd /c $g.komut` satırıyla ilgili,
ayrı bir host-tarafı öneridir (bkz. ana rapor / kod yorumu). Bu reçete yalnız sürüm
yükseltmesini kapsar.
