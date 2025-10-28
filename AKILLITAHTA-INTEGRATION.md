# 🌐 Akıllı Tahta Entegrasyonu

akillitahta.ndr.ist API kullanarak otomatik Linux paketleme ve R2 yükleme.

## 🎯 Workflow

```
1. Electron Paketleyici (macOS)
   ↓ ZIP hazırla
   ↓ POST /api/v1/package-linux
   
2. akillitahta.ndr.ist (10.0.0.21)
   ↓ ZIP al
   ↓ Linux'ta paketle (.impark)
   ↓ R2'ye yükle
   ↓ Book page güncelle
   
3. ✅ HAZIR!
   - Pardus'ta kullanılabilir
   - Zenity + ~/dijitap/
   - Çift tıklama ile çalışır
```

## 🔧 Kurulum

### 1. .env Dosyası

`.env` oluştur:

```bash
# Akıllı Tahta API
AKILLITAHTA_API=https://akillitahta.ndr.ist/api/v1
AKILLITAHTA_USERNAME=your_username
AKILLITAHTA_PASSWORD=your_password
```

### 2. Test

```bash
node tests/test-akillitahta-packaging.js
```

## 📦 Kullanım

### Programatik

```javascript
const AkillitahtaPackagingService = require('./src/services/akillitahtaPackagingService');

const service = new AkillitahtaPackagingService();

// Paketleme yap
const result = await service.packageLinux({
  zipPath: './build.zip',
  bookId: '45504',
  appName: 'Marathon Plus 9',
  appVersion: '1.0.0',
  publisherName: 'Koza Yayınları',
  publisherId: '1',
  uploadToR2: true,
  r2ConfigId: 'default'
});

console.log('✅ Hazır:', result.r2Url);
```

### CLI

```bash
# Test
node tests/test-akillitahta-packaging.js

# Gerçek paketleme
node -e "
const service = require('./src/services/akillitahtaPackagingService');
const s = new service();

s.packageLinux({
  zipPath: './build.zip',
  bookId: '45504',
  appName: 'My App',
  appVersion: '1.0.0',
  uploadToR2: true
}).then(r => console.log('✅', r.r2Url));
"
```

## 🌐 API Endpoint

```
POST https://akillitahta.ndr.ist/api/v1/package-linux
```

**Form Data:**
- `file`: ZIP dosyası
- `bookId`: Kitap ID
- `appName`: Uygulama adı
- `appVersion`: Versiyon
- `publisherName`: Yayınevi (opsiyonel)
- `publisherId`: Yayınevi ID (opsiyonel)
- `uploadToR2`: true/false
- `r2ConfigId`: R2 config ID

**Response:**
```json
{
  "success": true,
  "jobId": "pkg-123-abc",
  "imparkFilename": "App-1.0.0.impark",
  "r2Url": "https://cdn.akillitahta.ndr.ist/books/45504/pardus/App-1.0.0.impark",
  "message": "Paketleme tamamlandı"
}
```

## ✨ Özellikler

### Otomatik İşlemler

1. ✅ ZIP upload
2. ✅ Linux paketleme
3. ✅ Özel AppRun (zenity + dijitap)
4. ✅ .impark oluşturma
5. ✅ R2'ye yükleme
6. ✅ Book page güncelleme (pardusEnabled = true)

### Zenity Progress Bar

İlk çalıştırmada:
```
┌─────────────────────────────────┐
│ DijiTap Akıllı Tahta            │
│                                 │
│ Marathon Plus 9 kuruluyor...   │
│                                 │
│ [████████████████░░░░] 80%     │
└─────────────────────────────────┘
```

### Kalıcı Kurulum

```
~/dijitap/
  └── Marathon Plus 9/
      ├── zkitap (executable)
      └── resources/
          └── app/
              └── build/
                  └── kurum.txt
```

## 🐛 Sorun Giderme

### API Bağlantı Hatası

```bash
# API test et
curl -u username:password https://akillitahta.ndr.ist/api/v1/package-linux/test
```

**Beklenen:**
```json
{
  "status": "ok",
  "message": "Package Linux API çalışıyor"
}
```

### Paketleme Hatası

```bash
# Sunucuda log kontrol
ssh nadir@10.0.0.21
pm2 logs book-update-api
```

### R2 Upload Hatası

```bash
# R2 config kontrol
curl -u username:password https://akillitahta.ndr.ist/api/v1/r2-configs
```

## 📊 Performans

- Upload: ~30 saniye (50MB ZIP)
- Paketleme: ~2-3 dakika
- R2 Upload: ~30 saniye
- **Toplam: ~3-4 dakika**

## 🔐 Güvenlik

- ✅ Basic Authentication
- ✅ HTTPS
- ✅ Rate limiting (100 req/15dk)
- ✅ File size limit (500MB)

## 💡 İpuçları

1. **ZIP Boyutu:** Mümkün olduğunca küçük tutun
2. **Book ID:** Doğru book ID kullanın
3. **Test:** Önce test book ID ile deneyin (99999)
4. **Monitoring:** pm2 logs ile takip edin

## 📋 Checklist

- [ ] .env dosyası ayarlandı
- [ ] API credentials doğru
- [ ] Test başarılı
- [ ] build.zip hazır
- [ ] Book ID biliniyor
- [ ] R2 config ayarlandı

✅ Hepsi tamam? Artık otomatik paketleme hazır!

## 🎉 Sonuç

Artık:
- ✅ macOS'tan tek komut
- ✅ Linux'ta otomatik paketle
- ✅ R2'ye otomatik yükle
- ✅ Pardus'ta çift tıkla, çalış!

**Tam otomatik workflow!** 🚀
