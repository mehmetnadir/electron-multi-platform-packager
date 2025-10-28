# Linux Sunucu Paketleme Servisi

macOS'tan Linux sunucuya dosya gönderip tam özellikli .impark oluşturma.

## Mimari

```
macOS (Client)                    Linux Server
    |                                  |
    | 1. ZIP + Config gönder          |
    |--------------------------------->|
    |                                  | 2. Paketleme yap
    |                                  |    - Özel AppRun
    |                                  |    - .impark
    |                                  |    - Zenity
    | 3. .impark dosyasını al         |
    |<---------------------------------|
```

## Kurulum

### Linux Sunucuda

#### 1. Gerekli Paketler

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y \
    nodejs npm \
    build-essential \
    libfuse2 \
    zenity \
    unzip \
    wget

# appimagetool
wget https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage -O /usr/local/bin/appimagetool
chmod +x /usr/local/bin/appimagetool
```

#### 2. Proje Kurulumu

```bash
# Proje klasörünü kopyala
scp -r /path/to/elecron-paket user@linux-server:/home/user/

# Sunucuda
cd /home/user/elecron-paket
npm install
```

#### 3. Paketleme Servisi Başlat

```bash
# Servis olarak çalıştır
npm run server

# Veya PM2 ile
npm install -g pm2
pm2 start src/server/app.js --name electron-packager
pm2 save
pm2 startup
```

#### 4. Firewall

```bash
# Port 3000'i aç
sudo ufw allow 3000/tcp
```

### macOS'ta (Client)

#### 1. Sunucu Ayarları

`.env` dosyası oluştur:

```bash
REMOTE_PACKAGING_SERVER=http://your-linux-server:3000
REMOTE_PACKAGING_ENABLED=true
```

#### 2. SSH Key (Opsiyonel)

```bash
# SSH key oluştur
ssh-keygen -t rsa -b 4096

# Sunucuya kopyala
ssh-copy-id user@linux-server
```

## Kullanım

### Otomatik Mod

macOS'ta normal paketleme yap:

```bash
npm run electron
# UI'dan Linux paketleme seç
```

Eğer `REMOTE_PACKAGING_ENABLED=true` ise:
1. ZIP otomatik sunucuya gönderilir
2. Linux sunucu paketler
3. .impark otomatik indirilir
4. Output klasörüne kaydedilir

### Manuel Mod

```bash
# Sunucuya gönder
curl -X POST http://linux-server:3000/api/remote-package \
  -F "file=@build.zip" \
  -F "appName=My App" \
  -F "appVersion=1.0.0"

# Sonucu indir
curl -O http://linux-server:3000/api/download/My-App-1.0.0.impark
```

## API Endpoints

### POST /api/remote-package

Paketleme isteği gönder.

**Request:**
```json
{
  "file": "build.zip (multipart)",
  "appName": "App Name",
  "appVersion": "1.0.0",
  "publisherName": "Publisher",
  "publisherId": "123"
}
```

**Response:**
```json
{
  "success": true,
  "jobId": "abc-123",
  "status": "processing"
}
```

### GET /api/remote-package/:jobId

İş durumunu kontrol et.

**Response:**
```json
{
  "jobId": "abc-123",
  "status": "completed",
  "progress": 100,
  "downloadUrl": "/api/download/abc-123.impark"
}
```

### GET /api/download/:filename

Dosyayı indir.

## Güvenlik

### 1. API Key

```bash
# Sunucuda
export API_KEY="your-secret-key"

# macOS'ta
export REMOTE_PACKAGING_API_KEY="your-secret-key"
```

### 2. HTTPS

```bash
# Nginx reverse proxy
sudo apt-get install nginx

# /etc/nginx/sites-available/packager
server {
    listen 443 ssl;
    server_name packager.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. Rate Limiting

```javascript
// src/server/app.js
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 10 // max 10 istek
});

app.use('/api/remote-package', limiter);
```

## Monitoring

### PM2 Dashboard

```bash
pm2 monit
```

### Logs

```bash
pm2 logs electron-packager
```

### Disk Kullanımı

```bash
# Otomatik temizlik (cron)
0 2 * * * find /home/user/elecron-paket/temp -mtime +1 -delete
```

## Performans

### Paralel Paketleme

```javascript
// src/services/queueService.js
const MAX_CONCURRENT_JOBS = 3; // Sunucu kapasitesine göre
```

### Cache

```bash
# Electron Builder cache
export ELECTRON_CACHE=/var/cache/electron
```

## Sorun Giderme

### Servis Çalışmıyor

```bash
pm2 restart electron-packager
pm2 logs electron-packager --lines 100
```

### Port Kullanımda

```bash
sudo lsof -i :3000
sudo kill -9 <PID>
```

### Disk Dolu

```bash
df -h
du -sh /home/user/elecron-paket/temp/*
rm -rf /home/user/elecron-paket/temp/*
```

## Avantajlar

✅ macOS'ta Docker gerekmez
✅ Hızlı paketleme (Linux native)
✅ Tam özellikli .impark
✅ Zenity + ~/dijitap/ otomatik
✅ Paralel paketleme
✅ Merkezi yönetim

## Örnek Workflow

1. macOS'ta ZIP hazırla
2. Sunucuya gönder (otomatik)
3. Linux'ta paketle
4. .impark indir (otomatik)
5. Pardus'a kopyala
6. Çift tıkla, çalış!

## Maliyet

- VPS: ~$5-10/ay (DigitalOcean, Hetzner)
- Alternatif: Mevcut sunucunuz (ücretsiz!)
