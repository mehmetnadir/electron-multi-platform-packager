# Windows Kabul Kapısı — tek seferlik kurulum

> **Neden var:** Pardus'ta gerçek bir kabul kapımız var (`tools/pardus/probook-kabul.sh`:
> kurar, açar, piksel kanıtı alır). Windows'ta yoktu — doğrulama statikti, yani exe'yi
> açıp `app.asar` içindeki işaretleri saymak. Bu, yamaların **pakette** olduğunu
> kanıtlar; uygulamanın **açıldığını** kanıtlamaz. K18 kuralının Windows boşluğu buydu.

## Neden `vmrun` değil

`vmrun`'un guest işlemleri (kurulum, ekran görüntüsü, dosya okuma) guest kullanıcı adı
**ve parola** ister; `vmrun` bunu yalnız komut satırı argümanı olarak alır, yani parola
`ps` çıktısına düşer. Nadir'in parolası ne sohbete girer ne süreç listesine.

Ölçüldü (2026-09-20):

| İşlem | Kimlik gerekiyor mu |
|---|---|
| VM başlat/durdur, **snapshot al/geri dön/listele** | hayır |
| `captureScreen`, `runProgramInGuest`, dosya kopyalama | **evet** |

Bu yüzden köprü **iş kuyruğu** biçiminde: host `gorev/` içine JSON yazar, guest'teki
izleyici işi yapıp `sonuc/` içine JSON + PNG bırakır. Parola hiçbir yerde geçmez. Kimlik
gerektirmeyen snapshot yeteneği de kullanılır — her kurulum temiz zeminde koşar.

## Taşıma: HTTP (bu Mac'te zorunlu) — paylaşılan klasör YOK

Kuyruğun taşıyıcısı normalde paylaşılan klasör olurdu. **Bu makinede o yol yok:**

> Apple Silicon + **Windows 11 ARM** misafir birleşiminde VMware Fusion 13
> paylaşılan klasörleri desteklemiyor — VM Ayarları penceresinde "Sharing" paneli
> hiç görünmez. Ölçüldü (2026-09-20): Fusion 13.6.4, `.vmx` içinde tek bir
> `sharedFolder*`/`hgfs*` satırı yok; Broadcom belgeleri de bu birleşimi dışarıda
> bırakıyor. **Eksik ayar değil, olmayan özellik** — aramaya devam etme.

Yerine **HTTP köprüsü** kullanılıyor: `tools/windows/vm-kopru-sunucu.js` aynı
`~/vm-kapi/{gorev,sonuc,durum}` dizinlerini VMware ağı üzerinden yayınlar. Karar katmanı
(`src/windows/vm-kapi-karar.js`) ve sürücü (`tools/windows/vm-kapi.js`) **hiç değişmedi**;
ikisi de dosyaları görmeye devam ediyor.

Güvenlik sınırları (kod kilitli, `vm-kopru-sunucu.test.js` 12 testle çivili):

- Sunucu **yalnız `bridge*` arayüzlerine** bağlanır (ölçülen: `192.168.11.1` NAT,
  `192.168.225.1` host-only). `0.0.0.0` asla. Ev/ofis ağı bu portu görmez.
- Her yol bir **belirteç** ile başlar (24 hex, ilk açılışta üretilir,
  `~/vm-kapi/durum/belirtec.txt`, 0600). Belirteci bilmeyen 404 alır.
- Dosya servisi tek dizinle sınırlı, yol gezinmesi (`..`, ayraç) reddedilir.
- Kimlik/parola yok, guest'e hiçbir sır gitmez.

## Kurulum (bir kez, ~3 dakika)

1. **Mac'te köprüyü başlat:**
   ```bash
   mkdir -p ~/vm-kapi
   cp tools/windows/vm-izleyici.ps1 ~/vm-kapi/
   node tools/windows/vm-kopru-sunucu.js
   # Çıktı: dinlenen adresler + izleyici komutunun tamamı (belirteç dahil)
   ```
2. **VM içinde izleyiciyi başlat** (normal kullanıcı, **yönetici gerekmez**) — köprünün
   bastığı komutu olduğu gibi yapıştır:
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\vm-kapi\vm-izleyici.ps1 `
       -Adres http://192.168.11.1:8791 -Belirtec <belirtec>
   ```
   `vm-izleyici.ps1`'i VM'e bir kez kopyalaman gerekir (paylaşılan klasör olmadığı için):
   köprü ayaktayken misafirde
   `curl.exe -o C:\vm-kapi\vm-izleyici.ps1 http://192.168.11.1:8791/<belirtec>/dosya/vm-izleyici.ps1`
   yeterli. Pencereyi açık bırak; kapatırsan host "izleyici ölü" der, sessizce yanlış
   sonuç vermez.
3. **Mac'te doğrula:**
   ```bash
   node tools/windows/vm-kapi.js hazir     # {"durum":"ayakta","yasSn":3}
   ```

Paylaşılan klasörün çalıştığı bir kurulumda (x64 misafir) izleyici `-Kok <paylaşım yolu>`
ile de koşar; köprü sunucusuna gerek kalmaz. İki mod da aynı dosya düzenini kullanır.

## Köprüyü doğrulama (Mac'te, ölçülmüş)

```bash
node -e "require('http').get({host:'192.168.11.1',port:8791,path:'/<belirtec>/gorev'},y=>console.log(y.statusCode))"
# 204 = köprü ayakta, kuyruk boş · 404 = belirteç yanlış
```

**`curl` kullanacaksan `--noproxy '*'` şart:** bu Mac'te düz `curl` VMware arayüzüne
çıkarken `000` döndü; `curl --noproxy '*'` ise 404/204 aldı. Sebep ortam değişkeni
DEĞİL (`env | grep -i proxy` boş) — macOS'ta curl sistem vekil ayarlarını okuyor,
node okumuyor. Yani sunucu kusuru yok; ölçüm aracını suçlamadan önce vekili ele.
Misafirdeki `curl.exe` bu kısıttan etkilenmiyor.

Sunucunun yalnız VMware arayüzlerine bağlandığı bağımsız olarak doğrulandı:

```
$ lsof -nP -i :8791
node  ...  TCP 192.168.11.1:8791 (LISTEN)
node  ...  TCP 192.168.225.1:8791 (LISTEN)
```

`0.0.0.0` yok — ev/ofis ağı bu portu görmüyor. (macOS güvenlik duvarı da açık.)

## Kullanım

```bash
node tools/windows/vm-kapi.js anlik-al temiz            # snapshot
node tools/windows/vm-kapi.js kur ~/Downloads/sm4-windows-exe/SM4-K26-TEK-GOSTERGE.exe \
     --surec "Super Monsters 4"
node tools/windows/vm-kapi.js ac --surec "Super Monsters 4" --yol "C:\...\Super Monsters 4.exe"
node tools/windows/vm-kapi.js ekran --surec "Super Monsters 4"
node tools/windows/vm-kapi.js geri-don temiz            # VM'i temize döndür
```

Ekran görüntüleri `~/vm-kapi/sonuc/<kimlik>.png`. HTTP modunda kurulum exe'sini guest
köprüden çeker (`/dosya/<ad>`), yani exe'yi elle kopyalaman gerekmez — `kur` komutu
dosyayı `~/vm-kapi/` altına koyar.

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
