# Docker ile Linux Paketleme

macOS'ta tam özellikli Linux AppImage (.impark) oluşturmak için Docker kullanın.

## Neden Docker?

macOS'ta üretilen AppImage'lar standart olur çünkü:
- macOS'ta Linux binary'leri çalıştırılamaz
- AppImage extract edilemez
- Özel AppRun eklenemez

Docker ile Linux container'da paketleme yaparak:
- ✅ Özel AppRun (zenity + ~/dijitap/)
- ✅ .impark uzantısı
- ✅ Tam otomatik kurulum
- ✅ Pardus'ta çift tıklama ile çalışma

## Gereksinimler

- Docker Desktop (https://www.docker.com/products/docker-desktop)
- Docker çalışır durumda olmalı

## Kullanım

### 1. Docker ile Paketleme

```bash
./docker-linux-package.sh
```

İlk çalıştırmada Docker image oluşturulacak (5-10 dakika).
Sonraki paketlemeler çok daha hızlı olacak.

### 2. Oluşturulan Dosyalar

```bash
ls -lh output/
```

Dosyalar:
- `*.impark` - Özel AppRun ile tam özellikli
- `*.AppImage` - Standart (yedek)
- `*.deb` - Debian paketi
- `*-flatpak.zip` - Flatpak dosyaları

### 3. Pardus'ta Test

```bash
chmod +x "App-Name-1.0.0.impark"
./"App-Name-1.0.0.impark"
```

İlk çalıştırmada:
1. Zenity "Kuruluyor" ekranı
2. ~/dijitap/ klasörüne kurulum
3. Uygulama açılır

İkinci çalıştırmada:
- Direkt açılır (kurulum yok)

## Standart Paketleme (macOS)

Docker kullanmadan:

```bash
npm run electron
# UI'dan paketleme yap
```

Standart AppImage oluşur:
- Özel AppRun yok
- .AppImage uzantısı
- `ELECTRON_DISABLE_SANDBOX=1` ile çalıştırılmalı

## Sorun Giderme

### Docker çalışmıyor

```bash
# Docker Desktop'ı başlatın
open -a Docker
```

### Image yeniden oluşturma

```bash
docker rmi electron-packager-linux
./docker-linux-package.sh
```

### Container içinde debug

```bash
docker run -it --rm -v "$(pwd):/workspace" electron-packager-linux bash
```

## Teknik Detaylar

### Docker Image

- Base: Ubuntu 22.04
- Node.js 18
- appimagetool
- zenity
- FUSE support

### Paketleme Süreci

1. Docker container başlatılır
2. Proje dizini mount edilir
3. Linux ortamında paketleme yapılır
4. AppImage extract edilir
5. Özel AppRun eklenir
6. appimagetool ile .impark oluşturulur
7. Dosyalar output/ klasörüne kopyalanır

### Environment Variables

- `FORCE_LINUX_PACKAGING=1` - Docker container'da çalıştığını belirtir
- `ELECTRON_DISABLE_SANDBOX=1` - Pardus uyumluluğu için

## Performans

- İlk build: ~5-10 dakika (Docker image)
- Sonraki paketlemeler: ~2-3 dakika
- Standart paketleme: ~1-2 dakika

Docker overhead'i kabul edilebilir seviyede.
