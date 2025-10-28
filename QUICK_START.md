# Hızlı Başlangıç Rehberi

## 📦 Paket Oluşturma

### 1. API Kullanımı

```bash
curl -X POST https://akillitahta.ndr.ist/api/v1/package-linux-public \
  -F "bookId=12345" \
  -F "appName=UygulamaAdi" \
  -F "appVersion=1.0.0" \
  -F "publisherName=YayineviAdi" \
  -F "publisherId=1" \
  -F "file=@build.zip" \
  -F "icon=@logo.png"
```

**Response:**
```json
{
  "success": true,
  "jobId": "pkg-1761593275773-p4l2t6tqa",
  "message": "Paketleme başlatıldı",
  "statusUrl": "/api/v1/package-status/pkg-1761593275773-p4l2t6tqa"
}
```

### 2. Durum Kontrolü

```bash
curl https://akillitahta.ndr.ist/api/v1/package-status/pkg-1761593275773-p4l2t6tqa
```

**Response:**
```json
{
  "status": "completed",
  "progress": 100,
  "message": "Paketleme tamamlandı!",
  "packages": [
    {
      "type": "AppImage",
      "filename": "UygulamaAdi-1.0.0.impark",
      "downloadUrl": "https://akillitahta.ndr.ist/packages/UygulamaAdi-1.0.0.impark",
      "size": 109446336
    }
  ]
}
```

## 🎯 Gereksinimler

### build.zip İçeriği
```
build/
├── index.html
├── electron.js
├── config/
├── images/
├── scripts/
└── ... (diğer uygulama dosyaları)
```

### logo.png
- Format: PNG
- Önerilen boyut: 256x256 veya 512x512
- Maksimum: 1MB

## 🚀 Pardus'ta Kullanım

### 1. İndirme
```bash
wget https://akillitahta.ndr.ist/packages/UygulamaAdi-1.0.0.impark
```

### 2. İzin Verme
```bash
chmod +x UygulamaAdi-1.0.0.impark
```

### 3. Çalıştırma
```bash
./UygulamaAdi-1.0.0.impark
```

**VEYA** Dosya yöneticisinden çift tıkla!

## 📊 İlk Çalıştırma

1. **Zenity Progress Bar** gösterilir
   - Başlık: Uygulama adı
   - Logo: Yayınevi logosu
   - Progress: 0% → 100%

2. **Otomatik Kurulum**
   - `~/DijiTap/UygulamaAdi/` klasörüne kurulur
   - Logo sistem ikonlarına kopyalanır
   - Masaüstü kısayolu oluşturulur
   - `kurum.txt` dosyası oluşturulur

3. **Uygulama Açılır**
   - Pencere ikonunda yayınevi logosu
   - Görev çubuğunda uygulama adı

## 🔄 Sonraki Çalıştırmalar

- Versiyon aynıysa → Direkt açılır (hızlı)
- Versiyon farklıysa → Yeniden kurulur

## 🎨 Sistem Entegrasyonu

### Masaüstü Kısayolu
```bash
~/.local/share/applications/UygulamaAdi.desktop
```

### Sistem İkonu
```bash
~/.local/share/icons/UygulamaAdi.png
```

### Kurulum Dizini
```bash
~/DijiTap/UygulamaAdi/
```

## 🛠️ Sunucu Yönetimi

### Servisleri Yeniden Başlat
```bash
# API
pm2 restart book-update-api

# Worker
systemctl restart packaging-worker
```

### Log Kontrol
```bash
# API logs
pm2 logs book-update-api

# Worker logs
journalctl -u packaging-worker -f
```

### Dosya Temizleme
```bash
# Temp dosyalar
rm -rf /tmp/pkg-*
rm -rf /tmp/packaging-*

# Eski paketler
rm /home/ndr/domains/akillitahta.ndr.ist/public/packages/*.impark
```

## 🐛 Sorun Giderme

### Paket İndirme Hatası
```bash
# Nginx logları kontrol et
tail -f /var/log/nginx/error.log
```

### Paketleme Başarısız
```bash
# Worker logları kontrol et
journalctl -u packaging-worker -n 100
```

### Progress Bar Görünmüyor
```bash
# Zenity yüklü mü?
which zenity

# Yükle
sudo apt install zenity
```

### Uygulama Açılmıyor
```bash
# Kurulum dizinini kontrol et
ls -la ~/DijiTap/UygulamaAdi/

# İzinleri kontrol et
ls -la ~/DijiTap/UygulamaAdi/zkitap*

# Manuel çalıştır
cd ~/DijiTap/UygulamaAdi/
./zkitap --no-sandbox
```

## 📝 Test Senaryosu

### 1. Yeni Paket Oluştur
```bash
curl -X POST https://akillitahta.ndr.ist/api/v1/package-linux-public \
  -F "bookId=12345" \
  -F "appName=TestApp" \
  -F "appVersion=1.0.0" \
  -F "publisherName=TestPublisher" \
  -F "publisherId=1" \
  -F "file=@build.zip" \
  -F "icon=@logo.png"
```

### 2. Durum Kontrol Et
```bash
curl https://akillitahta.ndr.ist/api/v1/package-status/JOB_ID | python3 -m json.tool
```

### 3. İndir ve Test Et
```bash
wget https://akillitahta.ndr.ist/packages/TestApp-1.0.0.impark
chmod +x TestApp-1.0.0.impark
./TestApp-1.0.0.impark
```

### 4. Güncelleme Test Et
```bash
# Yeni versiyon oluştur
curl -X POST https://akillitahta.ndr.ist/api/v1/package-linux-public \
  -F "appVersion=2.0.0" \
  ... (diğer parametreler)

# İndir ve çalıştır
wget https://akillitahta.ndr.ist/packages/TestApp-2.0.0.impark
chmod +x TestApp-2.0.0.impark
./TestApp-2.0.0.impark

# Yeniden kurulum yapmalı
```

## 🎯 Önemli Notlar

1. **Logo Zorunlu Değil**
   - Logo gönderilmezse varsayılan ikon kullanılır
   - Ama kullanıcı deneyimi için önerilir

2. **Versiyon Formatı**
   - Semantic versioning önerilir: `1.0.0`, `2.1.3`
   - Her güncelleme için versiyon artırılmalı

3. **build.zip İçeriği**
   - `electron.js` dosyası olmalı
   - `package.json` olmalı
   - Tüm bağımlılıklar dahil olmalı

4. **Pardus Uyumluluğu**
   - zkitap.zip Pardus için derlenmiş
   - Ubuntu'da çalışmayabilir (GLIBC sorunu)
   - Test her zaman Pardus'ta yapılmalı

5. **Disk Alanı**
   - Her paket ~104MB
   - Kurulum ~104MB daha
   - Toplam ~208MB per uygulama

## 📞 Destek

Sorun yaşarsanız:
1. Log dosyalarını kontrol edin
2. Zenity yüklü mü kontrol edin
3. İzinleri kontrol edin
4. Manuel çalıştırmayı deneyin
