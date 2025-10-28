# SSH Otomatik Paketleme

Linux sunucuya SSH ile bağlanıp otomatik paketleme ve R2'ye yükleme.

## 🎯 Avantajlar

✅ Tamamen otomatik
✅ Docker gerekmez
✅ Sunucuda işlem, hızlı
✅ Direkt R2'ye yükleme
✅ akillitahta.ndr.ist entegrasyonu

## 🔧 Kurulum

### 1. SSH Key Ayarla

```bash
# SSH key oluştur (eğer yoksa)
ssh-keygen -t rsa -b 4096

# Sunucuya kopyala
ssh-copy-id nadir@10.0.0.21

# Test et
ssh nadir@10.0.0.21 "echo 'SSH çalışıyor!'"
```

### 2. .env Dosyası

`.env` oluştur:

```bash
# Linux Server
LINUX_SERVER_HOST=10.0.0.21
LINUX_SERVER_USER=nadir
LINUX_SERVER_PATH=/home/nadir/elecron-paket
SSH_PRIVATE_KEY_PATH=/Users/nadir/.ssh/id_rsa

# Akıllı Tahta API
AKILLITAHTA_API=https://akillitahta.ndr.ist/api/v1
AKILLITAHTA_AUTH=dXNlcm5hbWU6cGFzc3dvcmQ=

# Otomatik yükleme
REMOTE_PACKAGING_ENABLED=true
AUTO_UPLOAD_TO_R2=true
```

**Not:** `AKILLITAHTA_AUTH` değeri:
```bash
echo -n "username:password" | base64
```

### 3. Sunucuda Proje Kurulumu

```bash
# Sunucuya bağlan
ssh nadir@10.0.0.21

# Proje klasörünü oluştur
mkdir -p ~/elecron-paket
cd ~/elecron-paket

# Projeyi kopyala (ilk seferinde)
# macOS'tan:
scp -r /Users/nadir/01dev/elecron-paket/* nadir@10.0.0.21:~/elecron-paket/

# Sunucuda dependencies yükle
npm install

# appimagetool yükle
wget https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage -O /usr/local/bin/appimagetool
chmod +x /usr/local/bin/appimagetool
```

## 📦 Kullanım

### Programatik Kullanım

```javascript
const SSHPackagingService = require('./src/services/sshPackagingService');

const sshService = new SSHPackagingService();

// Paketleme yap
const result = await sshService.packageOnServer({
  zipPath: '/path/to/build.zip',
  appName: 'My App',
  appVersion: '1.0.0',
  publisherName: 'Publisher',
  publisherId: '123',
  platforms: ['linux'],
  uploadToR2: true,
  bookId: '45504' // akillitahta.ndr.ist book ID
});

console.log('✅ Paketleme tamamlandı:', result.imparkPath);
console.log('☁️ R2\'ye yüklendi:', result.uploadedToR2);
```

### CLI Kullanımı

```bash
# Test script
node -e "
const SSHPackagingService = require('./src/services/sshPackagingService');
const service = new SSHPackagingService();

service.packageOnServer({
  zipPath: './build.zip',
  appName: 'Test App',
  appVersion: '1.0.0',
  publisherName: 'Test Publisher',
  publisherId: '1',
  uploadToR2: true,
  bookId: '45504'
}).then(result => {
  console.log('✅ Başarılı:', result);
  process.exit(0);
}).catch(error => {
  console.error('❌ Hata:', error);
  process.exit(1);
});
"
```

## 🔄 Workflow

```
1. macOS'ta ZIP hazırla
   ↓
2. SSH ile sunucuya gönder
   ↓
3. Linux sunucuda paketle
   - Özel AppRun ekle
   - .impark oluştur
   - Zenity + ~/dijitap/
   ↓
4. .impark'ı macOS'a indir
   ↓
5. R2'ye yükle (akillitahta.ndr.ist API)
   ↓
6. Kitap sayfasını güncelle
   ↓
7. ✅ Hazır! Pardus'ta kullanılabilir
```

## 🌐 akillitahta.ndr.ist Entegrasyonu

### Kitap Bilgilerini Al

```javascript
const bookInfo = await sshService.getBookInfo('45504');
console.log('Kitap:', bookInfo.bookTitle);
console.log('Yayınevi:', bookInfo.publisherName);
```

### R2'ye Yükle

```javascript
await sshService.uploadToR2(
  '/path/to/file.impark',
  '45504', // bookId
  'pardus' // platform
);
```

### API Response

```json
{
  "success": true,
  "url": "https://r2.akillitahta.ndr.ist/books/45504/pardus/latest.impark",
  "size": 173500000,
  "uploadedAt": "2025-10-27T14:30:00Z"
}
```

## 🔐 Güvenlik

### SSH Key Koruması

```bash
# Key izinlerini kontrol et
chmod 600 ~/.ssh/id_rsa
chmod 644 ~/.ssh/id_rsa.pub
```

### API Key Koruması

```bash
# .env dosyasını git'e ekleme
echo ".env" >> .gitignore
```

### Sunucu Güvenliği

```bash
# Firewall (sunucuda)
sudo ufw allow from 192.168.1.0/24 to any port 22
sudo ufw enable
```

## 📊 Monitoring

### SSH Bağlantı Testi

```bash
ssh -v nadir@10.0.0.21
```

### Sunucu Disk Kullanımı

```bash
ssh nadir@10.0.0.21 "df -h"
```

### Paketleme Logları

```bash
ssh nadir@10.0.0.21 "tail -f ~/elecron-paket/packaging.log"
```

## 🐛 Sorun Giderme

### SSH Bağlantı Hatası

```bash
# SSH agent başlat
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_rsa

# Bağlantıyı test et
ssh -vvv nadir@10.0.0.21
```

### Paketleme Hatası

```bash
# Sunucuda manuel test
ssh nadir@10.0.0.21
cd ~/elecron-paket
npm run test
```

### R2 Upload Hatası

```bash
# API test et
curl -u username:password https://akillitahta.ndr.ist/api/v1/book-pages
```

## 💡 İpuçları

1. **İlk Kurulum:** Sunucuda bir kere manuel paketleme yapın, tüm dependencies yüklensin
2. **Hız:** SSH bağlantısı hızlı olmalı (aynı ağda ideal)
3. **Disk:** Sunucuda yeterli disk alanı olmalı (~500MB per job)
4. **Temizlik:** Eski temp dosyaları düzenli silin

## 🚀 Performans

- SSH transfer: ~10MB/s (yerel ağ)
- Paketleme: ~2-3 dakika
- R2 upload: ~30 saniye
- **Toplam: ~3-4 dakika** (Docker'dan çok daha hızlı!)

## 📋 Checklist

- [ ] SSH key kuruldu
- [ ] Sunucuya bağlanabiliyor
- [ ] Proje sunucuda kurulu
- [ ] appimagetool yüklü
- [ ] .env dosyası ayarlandı
- [ ] akillitahta.ndr.ist API erişimi var
- [ ] Test paketleme başarılı
- [ ] R2 upload çalışıyor

✅ Hepsi tamam? Artık otomatik paketleme hazır!
