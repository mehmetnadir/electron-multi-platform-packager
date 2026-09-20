# Windows Kabul Kapısı — tek seferlik kurulum

> **Neden var:** Pardus'ta gerçek bir kabul kapımız var (`tools/pardus/probook-kabul.sh`:
> kurar, açar, piksel kanıtı alır). Windows'ta yoktu — doğrulama statikti, yani exe'yi
> açıp `app.asar` içindeki işaretleri saymak. Bu, yamaların **pakette** olduğunu
> kanıtlar; uygulamanın **açıldığını** kanıtlamaz. K18 kuralının Windows boşluğu buydu.

## Neden paylaşılan klasör, neden `vmrun` değil

`vmrun`'un guest işlemleri (kurulum, ekran görüntüsü, dosya okuma) guest kullanıcı adı
**ve parola** ister; `vmrun` bunu yalnız komut satırı argümanı olarak alır, yani parola
`ps` çıktısına düşer. Nadir'in parolası ne sohbete girer ne süreç listesine.

Ölçüldü (2026-09-20):

| İşlem | Kimlik gerekiyor mu |
|---|---|
| VM başlat/durdur, **snapshot al/geri dön/listele** | hayır |
| `captureScreen`, `runProgramInGuest`, dosya kopyalama | **evet** |

Bu yüzden köprü dosya tabanlı: host `gorev/` içine JSON yazar, guest'teki izleyici işi
yapıp `sonuc/` içine JSON + PNG bırakır. Parola hiçbir yerde geçmez. Kimlik
gerektirmeyen snapshot yeteneği de kullanılır — her kurulum temiz zeminde koşar.

## Kurulum (bir kez, ~3 dakika)

1. **Mac'te klasörü oluştur:**
   ```bash
   mkdir -p ~/vm-kapi
   cp tools/windows/vm-izleyici.ps1 ~/vm-kapi/
   ```
2. **Fusion'da paylaşımı aç:** VM Ayarları → Paylaşım → "Paylaşılan Klasörleri Etkinleştir"
   → `+` → `~/vm-kapi` (ad: `vm-kapi`), yazma izniyle.
3. **VM içinde izleyiciyi başlat** (normal kullanıcı, **yönetici gerekmez**):
   ```powershell
   powershell -ExecutionPolicy Bypass -File "\\vmware-host\Shared Folders\vm-kapi\vm-izleyici.ps1"
   ```
   Pencereyi açık bırak. Kapatırsan host "izleyici ölü" der — sessizce yanlış sonuç vermez.
4. **Mac'te doğrula:**
   ```bash
   node tools/windows/vm-kapi.js hazir     # {"durum":"ayakta","yasSn":3}
   ```

## Kullanım

```bash
node tools/windows/vm-kapi.js anlik-al temiz            # snapshot
node tools/windows/vm-kapi.js kur ~/Downloads/sm4-windows-exe/SM4-K26-TEK-GOSTERGE.exe \
     --surec "Super Monsters 4"
node tools/windows/vm-kapi.js ac --surec "Super Monsters 4" --yol "C:\...\Super Monsters 4.exe"
node tools/windows/vm-kapi.js ekran --surec "Super Monsters 4"
node tools/windows/vm-kapi.js geri-don temiz            # VM'i temize döndür
```

Ekran görüntüleri `~/vm-kapi/sonuc/<kimlik>.png`.

## Kapı neyi "geçti" sayar

Çıkış kodu **tek başına yetmez** (memory: `cikis-kodu-basari-kaniti-degil`). Kurulum/açma
görevi ancak şu üçü birden sağlanırsa geçer:

1. çıkış kodu 0,
2. **ekran görüntüsü var**,
3. uygulama süreci gerçekten ayakta (`surecSayisi >= 1`).

Bunlardan biri eksikse `kaldi`. Sonuç hiç gelmezse `zaman-asimi`; izleyici beklerken
ölürse `bozuk` — sessiz bekleme yok.

## Bilinen kısıt

VM **Windows 11 ARM**, ürettiğimiz exe **x64** → x64 emülasyonuyla koşuyor. Mutlak süre
ölçümü gerçek donanımı temsil etmez; kıyaslar hep **aynı VM'de** "önceki paket / yeni
paket" biçiminde yapılmalı.
