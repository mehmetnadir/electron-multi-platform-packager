# 🐧 Linux Paketleme Süreci

## 📋 Genel Bakış

Bu dokümantasyon, Electron uygulamalarının Linux için nasıl paketlendiğini ve akillitahta.ndr.ist API'si üzerinden otomatik paketleme sürecini açıklar.

## 🎯 Süreç Akışı (Özet)

```
macOS (lokal makine)
   ├─ Windows (.exe/.msi) & macOS (.dmg) paketleri burada üretilir
   └─ build.zip hazırlanır (Linux paketleme girdisi)
        ↓ HTTPS (Basic Auth)
akillitahta.ndr.ist (Linux sunucu - 10.0.0.21)
   ├─ build.zip alınır ve açılır
   ├─ Electron Builder (Linux hedefli) çalışır
   ├─ .impark AppImage üretilir
   └─ Temp içerikler temizlenir
        ↓
İstemci (Pardus/Ubuntu)
   └─ .impark indirilir, chmod +x, çalıştırılır
```

> ℹ️ **Platform ayrımı:** macOS/Windows paketleri _bu makinede_ üretilir. Linux (.impark) paketleri sadece Linux sunucuda üretilebilir.

## 🎯 Süreç Adımları

### 1️⃣ ZIP Hazırlama (macOS)

```bash
# Örnek build.zip içeriği:
build.zip
├── index.html
├── manifest.json
├── ico.png
└── book1/
    └── ... (kitap dosyaları)
```

**Boyut:** ~3-5 KB (temel dosyalar) veya ~50-100 MB (tam uygulama)

### 2️⃣ API'ye Gönderme (Linux Paket Talebi)

- **Prod endpoint:** `POST https://akillitahta.ndr.ist/api/v1/package-linux`
- **Auth:** Basic (AKILLITAHTA_USERNAME / AKILLITAHTA_PASSWORD)
- **Test endpoint:** `POST /api/v1/package-linux-public` (auth gerektirmez, gerçek paketleme yapmaz)

**Form Data Örneği:**
```bash
curl -X POST https://akillitahta.ndr.ist/api/v1/package-linux \
  -H "Authorization: Basic $(printf '%s:%s' "$AKILLITAHTA_USERNAME" "$AKILLITAHTA_PASSWORD" | base64)" \
  -F "file=@build.zip" \
  -F "bookId=99999" \
  -F "appName=Test Kitap" \
  -F "appVersion=1.0.0" \
  -F "publisherName=Test Yayınevi" \
  -F "publisherId=1"
```

### 3️⃣ Sunucuda İşlem (10.0.0.21)

**Lokasyon:** `/home/ndr/domains/akillitahta.ndr.ist`

**Adımlar:**

1. **ZIP Kaydetme** (1 saniye)
   ```
   /tmp/pkg-1234567890-abc/build.zip
   ```

2. **Extract** (1 saniye)
   ```
   /tmp/pkg-1234567890-abc/extracted/
   ├── index.html
   ├── manifest.json
   └── ...
   ```

3. **Electron Builder** (2-3 dakika)
   ```bash
   cd /home/ndr/domains/akillitahta.ndr.ist
   export FORCE_LINUX_PACKAGING=1
   node -e "const PackagingService = require('./src/packaging/packagingService');
            (async () => {
              await new PackagingService().packageLinux(...);
            })();"
   ```

4. **Paketleme Detayları:**
   - Electron Builder çalıştırılır
   - Linux AppImage oluşturulur
   - Özel AppRun script'i eklenir:
     * Zenity progress bar
     * ~/dijitap/ klasörüne kurulum
     * İlk çalıştırmada otomatik kurulum
   - `.impark` uzantısı ile kaydedilir

5. **Çıktı:**
   ```
   /tmp/pkg-1234567890-abc/linux/Test-Kitap-1.0.0.impark
   ```

### 4️⃣ API Response

```json
{
  "success": true,
  "jobId": "pkg-1234567890-abc",
  "imparkFilename": "Test-Kitap-1.0.0.impark",
  "imparkPath": "/tmp/pkg-1234567890-abc/linux/Test-Kitap-1.0.0.impark",
  "message": "Paketleme tamamlandı!",
  "note": "Dosya sunucuda /tmp klasöründe oluşturuldu ve temizlendi"
}
```

### 5️⃣ Otomatik Temizlik

**Hemen:**
- `/tmp/pkg-1234567890-abc/` klasörü silinir
- Disk alanı temizlenir

**Her Paketlemede:**
- 1 saatten eski `/tmp/pkg-*` dosyaları silinir
- Sunucu disk alanı korunur

## 🎨 Özel AppRun Özellikleri

### İlk Çalıştırma:
```
1. Çift tıklama: Test-Kitap-1.0.0.impark
2. Zenity ekranı: "Test Kitap kuruluyor..."
3. ~/dijitap/Test Kitap/ klasörüne kurulum
4. Uygulama açılır
```

### İkinci Çalıştırma:
```
1. Çift tıklama
2. Direkt açılır (kurulum yok)
```

### Kurulum Yapısı:
```
~/dijitap/
└── Test Kitap/
    ├── zkitap (executable)
    └── resources/
        └── app/
            └── build/
                ├── kurum.txt (Publisher ID)
                └── ... (kitap dosyaları)
```

## 🔧 Teknik Detaylar

### Platform Bazlı Sorumluluklar

| Görev | Platform | Açıklama |
|-------|----------|----------|
| Windows installer (exe/msi) | macOS (lokal) | electron-builder cross-build ile |
| macOS dmg | macOS (lokal) | Notarization & signing burada |
| Linux impark/AppImage | Linux sunucu (10.0.0.21) | API tetikler, otomatik temizlik |

> 🔒 Linux sunucu macOS/Windows binary üretemez. macOS makine Linux AppImage üretebilir ancak `.impark` özel AppRun/Zenity süreci için Linux ortam tercih edildi.

### Sunucu Yapılandırması

**Sunucu:** 10.0.0.21  
**Proje Yolu:** `/home/ndr/domains/akillitahta.ndr.ist`  
**Temp Klasör:** `/tmp/pkg-*/`  
**API:** `https://akillitahta.ndr.ist/api/v1`

### Environment Variables

```bash
FORCE_LINUX_PACKAGING=1  # Linux paketleme zorla
```

### Dependencies

**Sunucuda Gerekli:**

| Paket | Not |
|-------|-----|
| Node.js 18+ | `/home/ndr/domains/akillitahta.ndr.ist` projesi için |
| Electron Builder | `package.json` scripts üzerinden çağrılır |
| appimagetool | AppImage oluşturmak için zorunlu |
| zenity | Kurulum progress bar'ı için |
| FUSE | AppImage çalıştırma için (istemci tarafı) |

## 📊 Performans

| Adım | Süre |
|------|------|
| ZIP Upload | 1-2 saniye |
| ZIP Extract | 1 saniye |
| Electron Builder | 2-3 dakika |
| .impark Oluşturma | 10 saniye |
| Temizlik | 1 saniye |
| **TOPLAM** | **~3-4 dakika** |

## 🚀 Pardus'ta Kullanım

### 1. İndirme
```bash
# API'den .impark dosyasını indir
wget https://akillitahta.ndr.ist/downloads/Test-Kitap-1.0.0.impark
```

### 2. İzin Verme
```bash
chmod +x Test-Kitap-1.0.0.impark
```

### 3. Çalıştırma
```bash
./Test-Kitap-1.0.0.impark
```

### 4. İlk Kurulum
- Zenity ekranı görünür: "Test Kitap kuruluyor..."
- Progress bar: %0 → %100
- ~/dijitap/Test Kitap/ klasörüne kurulum
- Uygulama otomatik açılır

### 5. Sonraki Kullanımlar
- Çift tıklama
- Direkt açılır (kurulum yok)

## 🔄 Workflow Özeti

```
macOS (lokal makine)
    ├─ npm run package:mac
    ├─ npm run package:windows
    └─ build.zip → Linux API

akillitahta.ndr.ist (10.0.0.21)
    └─ POST /api/v1/package-linux
        ├─ build.zip kaydet
        ├─ extract
        ├─ Electron Builder (Linux)
        ├─ .impark bul → yanıtlıyor
        └─ temp temizle

Pardus/Ubuntu cihaz
    ├─ .impark indir
    ├─ chmod +x
    └─ ./Test-Kitap-1.0.0.impark
        ├─ Zenity progress
        ├─ ~/dijitap/Test Kitap/ kurulumu
        └─ Uygulama açılır
```

## 🧹 Temizlik Stratejisi

### Her Paketleme Sonrası:
```javascript
// workDir tamamen silinir
await fs.remove(workDir);
```

### Her Paketleme Sırasında:
```javascript
// 1 saatten eski temp dosyalar silinir
const files = await fs.readdir('/tmp');
for (const file of files) {
  if (file.startsWith('pkg-')) {
    const age = now - stats.mtimeMs;
    if (age > 60 * 60 * 1000) {
      await fs.remove(filePath);
    }
  }
}
```

## 📝 Notlar

- **macOS/Windows paketleri**: Lokal makinede üretilir, API'ye dâhil edilmez.
- **Linux paketleri**: API ile 10.0.0.21'e gönderilir, `.impark` üretimi yapılır.
- **Public endpoint**: Sadece doğrulama/sağlık testi; gerçek paketleme için Basic Auth zorunlu.
- **Disk koruması**: Her paketleme sonunda workDir temizlenir + 1 saatten eski temp klasörleri silinir.
- **Sunucu izleme**: `pm2 logs book-update-api --lines 100` ile süreç takip edilebilir.
- **Zenity/FUSE**: Pardus gibi istemcilerde AppImage kurulumu için hazır olmalıdır.

## 🆘 Sorun Giderme

### Paketleme Başarısız
```bash
# Sunucuda log kontrol
ssh root@10.0.0.21
pm2 logs book-update-api --lines 100
```

### .impark Bulunamadı
```bash
# Temp klasörü kontrol
ssh root@10.0.0.21
ls -la /tmp/pkg-*
```

### Disk Dolu
```bash
# Eski dosyaları manuel temizle
ssh root@10.0.0.21
rm -rf /tmp/pkg-*
```

## 🎉 Başarı Kriterleri

✅ API Response: `success: true`  
✅ .impark dosyası oluşturuldu  
✅ Temp klasör temizlendi  
✅ Pardus'ta çalışıyor  
✅ Zenity ekranı görünüyor  
✅ ~/dijitap/ klasörüne kurulum yapıldı  

**Tüm kriterler sağlanırsa: TAM BAŞARI!** 🚀
