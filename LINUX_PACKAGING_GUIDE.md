# Linux Paketleme Rehberi

## 📦 Genel Bakış

Bu proje, Electron tabanlı uygulamaları Linux için AppImage formatında paketler. Kullanıcı sadece `build.zip` ve logo dosyası gönderir, sistem otomatik olarak çalışır bir `.impark` (AppImage) paketi oluşturur.

## 🎯 Temel Özellikler

### ✅ Başarıyla Çalışan Özellikler

1. **AppImage Oluşturma**
   - `zkitap.zip` (Electron runtime) + kullanıcı `build.zip` birleştirme
   - `appimagetool` ile paketleme
   - Çift tıkla çalıştırma

2. **İlk Kurulum**
   - Zenity progress bar (logo ile)
   - `~/DijiTap/APP_NAME/` klasörüne kurulum
   - Otomatik izin ayarlama
   - `kurum.txt` oluşturma
   - Desktop entry oluşturma
   - Logo sistem ikonlarına kopyalama

3. **Versiyon Kontrolü**
   - `.version` dosyası ile güncelleme kontrolü
   - Aynı versiyon → Direkt çalıştır
   - Farklı versiyon → Yeniden kur

4. **Logo Desteği**
   - Zenity progress bar'da logo
   - Uygulama pencere ikonunda logo
   - Sistem menüsünde logo
   - Görev çubuğunda logo

5. **Uygulama Adı**
   - Görev çubuğunda uygulama adı (zkitap değil)
   - `package.json` → `productName` otomatik güncelleme
   - Electron `--name` parametresi

## 🏗️ Sistem Mimarisi

### Sunucu Tarafı

```
/home/ndr/domains/akillitahta.ndr.ist/
├── services/api/
│   └── src/routes/public/package-linux.ts  # API endpoint
├── src/packaging/
│   └── create-appimage-direct.js           # AppImage oluşturma
└── packaging-worker.js                      # Arka plan worker

/home/ndr/elecron-paket/
├── zkitap.zip                               # Electron runtime (78MB)
└── appimagetool-x86_64.AppImage            # AppImage oluşturma aracı

/tmp/packaging-queue/                        # Job queue
/tmp/packaging-processing/                   # İşleniyor
/home/ndr/domains/akillitahta.ndr.ist/public/packages/  # Çıktı
```

### API Endpoints

1. **POST /api/v1/package-linux-public**
   - `file`: build.zip (zorunlu)
   - `icon`: logo.png (opsiyonel)
   - `bookId`, `appName`, `appVersion`, `publisherName`, `publisherId`
   - Döner: `{ jobId, statusUrl }`

2. **GET /api/v1/package-status/:jobId**
   - Döner: `{ status, progress, message, packages[] }`

### Paketleme Süreci

```
1. API Request → Job Queue
2. Worker → Job'u al
3. zkitap.zip extract → App.AppDir/
4. build.zip extract → App.AppDir/resources/app/build/
5. Logo kopyala → App.AppDir/akillitahta.png
6. package.json güncelle (productName)
7. AppRun script oluştur
8. .desktop dosyası oluştur
9. appimagetool → .impark oluştur
10. Public klasöre kopyala
11. API response → downloadUrl
```

## 📝 AppRun Script Özellikleri

### Versiyon Kontrolü
```bash
versionFile="$appPath/.version"
if [ -f "$versionFile" ]; then
    installedVersion=$(cat "$versionFile")
    if [ "$installedVersion" = "$APP_VERSION" ]; then
        needsInstall=false
    fi
fi
```

### Kurulum Adımları
1. **0%** - Kurulum başlatılıyor
2. **10%** - Dosyalar kopyalanıyor
3. **60%** - İzinler ayarlanıyor
4. **80%** - Kurum bilgisi kaydediliyor
5. **85%** - Uygulama ikonu ayarlanıyor
6. **90%** - Versiyon kaydediliyor
7. **95%** - Masaüstü kısayolu oluşturuluyor
8. **100%** - Tamamlandı

### Electron Başlatma
```bash
./zkitap --no-sandbox --disable-gpu-sandbox --icon="$ICON_PATH" --name="$APP_NAME"
```

## 🎨 Logo Yönetimi

### Logo Kopyalama Yerleri
1. `App.AppDir/akillitahta.png` - AppImage içi
2. `~/DijiTap/APP_NAME/resources/app/icon.png` - Electron ana logo
3. `~/DijiTap/APP_NAME/resources/app/build/app-icon.png` - Yedek logo
4. `~/.local/share/icons/APP_NAME.png` - Sistem ikonu

### Logo Kullanım Önceliği
1. `resources/app/icon.png`
2. `resources/app/build/app-icon.png`

## ⚙️ Electron Parametreleri

### Güvenlik
- `--no-sandbox` - Sandbox devre dışı
- `--disable-gpu-sandbox` - GPU sandbox devre dışı
- `ELECTRON_DISABLE_SANDBOX=1` - Env variable

### Görünüm
- `--icon="$ICON_PATH"` - Pencere ikonu
- `--name="$APP_NAME"` - Uygulama adı (görev çubuğu)

## 🐛 Bilinen Sorunlar ve Çözümler

### ❌ YAD Kullanılamadı
**Sorun:** YAD Ubuntu 22.04'te derlenmiş (GLIBC 2.34), Pardus'ta çalışmıyor.
**Çözüm:** Zenity kullanıldı (her yerde mevcut).

### ❌ Progress Bar Pipe Hatası
**Sorun:** Zenity/YAD başlatılamadığında pipe kırılıyor.
**Çözüm:** `|| cat > /dev/null` fallback eklendi.

### ❌ zkitap.bin Futex Hatası
**Sorun:** Ubuntu 22.04'te derlenmiş binary Pardus'ta çalışmıyor.
**Çözüm:** Pardus'ta test edilmeli, Ubuntu'da çalışmayabilir.

### ✅ Görev Çubuğunda "zkitap" Yazıyordu
**Çözüm:** 
- `package.json` → `productName` güncellendi
- `--name` parametresi eklendi
- `StartupWMClass` düzeltildi

## 📊 Dosya Boyutları

- `zkitap.zip`: ~78MB (Electron runtime)
- Kullanıcı `build.zip`: ~28MB (örnek)
- YAD binary: 226KB (kullanılmıyor)
- Final `.impark`: ~104MB

## 🚀 Deployment

### PM2 Servisler
```bash
pm2 restart book-update-api          # API
systemctl restart packaging-worker   # Worker
```

### Log Kontrol
```bash
pm2 logs book-update-api
journalctl -u packaging-worker -f
```

### Test
```bash
curl -X POST https://akillitahta.ndr.ist/api/v1/package-linux-public \
  -F "bookId=12345" \
  -F "appName=TestApp" \
  -F "appVersion=1.0.0" \
  -F "publisherName=Publisher" \
  -F "publisherId=1" \
  -F "file=@build.zip" \
  -F "icon=@logo.png"
```

## 📁 Klasör Yapısı

### Kurulum Dizini
```
~/DijiTap/APP_NAME/
├── zkitap                    # Wrapper script
├── zkitap.bin               # Electron binary (136MB)
├── resources/
│   └── app/
│       ├── icon.png         # Ana logo
│       ├── package.json     # productName güncelli
│       ├── build/
│       │   ├── app-icon.png # Yedek logo
│       │   ├── kurum.txt    # Publisher ID
│       │   └── ...          # Kullanıcı dosyaları
│       └── node_modules/
├── .version                 # Versiyon kontrolü
└── ... (diğer Electron dosyaları)
```

### Sistem Entegrasyonu
```
~/.local/share/applications/APP_NAME.desktop
~/.local/share/icons/APP_NAME.png
```

## 🎯 Sonraki Adımlar

1. ✅ AppImage oluşturma - TAMAMLANDI
2. ✅ Logo desteği - TAMAMLANDI
3. ✅ Versiyon kontrolü - TAMAMLANDI
4. ✅ Progress bar - TAMAMLANDI
5. ⏭️ Çalışan projeye entegrasyon
6. ⏭️ .deb paketi desteği
7. ⏭️ Flatpak desteği

## 📞 API Kullanımı

### Başarılı Response
```json
{
  "status": "completed",
  "progress": 100,
  "message": "Paketleme tamamlandı!",
  "packages": [
    {
      "type": "AppImage",
      "filename": "AkilliTahta-20.0.0.impark",
      "downloadUrl": "https://akillitahta.ndr.ist/packages/AkilliTahta-20.0.0.impark",
      "installerUrl": "https://akillitahta.ndr.ist/packages/AkilliTahta-20.0.0-installer.sh",
      "size": 109446336
    }
  ]
}
```

### Hata Response
```json
{
  "status": "failed",
  "progress": 100,
  "error": "Hata mesajı"
}
```
