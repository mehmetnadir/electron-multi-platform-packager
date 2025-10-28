# Pardus Yazılım Merkezi'ne Uygulama Ekleme Rehberi

## 🌟 **En Kolay Yöntem: Flatpak**

### Neden Flatpak?
- ✅ **Bağımsız paketleme** - Pardus'un onayına gerek yok
- ✅ **Otomatik Yazılım Merkezi entegrasyonu**
- ✅ **Yönetici şifresi gerektirmez**
- ✅ **Hızlı yayınlanma süreci**
- ✅ **Flathub üzerinden global erişim**

### Adım Adım Flatpak Yayınlama:

#### 1. Flatpak Manifest Dosyası Oluşturma
```json
{
  "app-id": "tr.gov.meb.uygulamaadi",
  "runtime": "org.freedesktop.Platform",
  "runtime-version": "22.08",
  "sdk": "org.freedesktop.Sdk",
  "command": "electron-app",
  "finish-args": [
    "--share=ipc",
    "--socket=x11",
    "--socket=pulseaudio",
    "--device=dri",
    "--filesystem=home:ro"
  ],
  "modules": [
    {
      "name": "electron-app",
      "buildsystem": "simple",
      "build-commands": [
        "install -Dm755 electron-app /app/bin/electron-app",
        "install -Dm644 tr.gov.meb.uygulamaadi.desktop /app/share/applications/tr.gov.meb.uygulamaadi.desktop",
        "install -Dm644 icon.png /app/share/icons/hicolor/256x256/apps/tr.gov.meb.uygulamaadi.png"
      ],
      "sources": [
        {
          "type": "file",
          "path": "electron-app"
        },
        {
          "type": "file",
          "path": "tr.gov.meb.uygulamaadi.desktop"
        },
        {
          "type": "file",
          "path": "icon.png"
        }
      ]
    }
  ]
}
```

#### 2. Desktop Dosyası Hazırlama
```ini
[Desktop Entry]
Version=1.0
Type=Application
Name=Uygulama Adı
Name[tr]=Uygulama Adı
Comment=Eğitim amaçlı interaktif uygulama
Comment[tr]=Eğitim amaçlı interaktif uygulama
Icon=tr.gov.meb.uygulamaadi
Exec=electron-app
Categories=Education;Teaching;Science;
Keywords=education;eğitim;öğretim;
StartupNotify=true
StartupWMClass=electron-app
```

#### 3. Flathub'a Başvuru
```bash
# 1. Flathub deposuna fork yapın
git clone https://github.com/flathub/flathub.git

# 2. Uygulama klasörü oluşturun
mkdir tr.gov.meb.uygulamaadi

# 3. Manifest dosyalarını ekleyin
cp manifest.json tr.gov.meb.uygulamaadi/
cp desktop.desktop tr.gov.meb.uygulamaadi/

# 4. Pull request gönderin
git add .
git commit -m "Add tr.gov.meb.uygulamaadi"
git push origin main
```

---

## 🏛️ **Resmi Pardus Depoları**

### Başvuru Süreci:

#### 1. Ön Gereksinimler
- **Açık kaynak lisansı** (GPL, MIT, Apache vb.)
- **Debian paket formatı** (.deb)
- **Güvenlik taraması** geçmiş olması
- **Türkçe dil desteği** bulunması

#### 2. Başvuru Adımları
```bash
# 1. Pardus Developer Portal'e kayıt
# https://developer.pardus.org.tr/

# 2. Paket politikalarını inceleyin
# https://wiki.pardus.org.tr/Paket_Politikalari

# 3. Debian paket oluşturun
dpkg-buildpackage -us -uc

# 4. Test edin
lintian package.deb

# 5. Başvuru gönderin
```

#### 3. İnceleme Süreci
- **Kod incelemesi**: 2-4 hafta
- **Güvenlik testi**: 1-2 hafta  
- **Uyumluluk testi**: 1 hafta
- **Son onay**: 1 hafta

**Toplam süre**: 5-8 hafta

---

## 🚀 **Electron Paketleyici Entegrasyonu**

### Flatpak Desteği Ekleme:

#### 1. Uygulamaya Flatpak Config Ekleme
```javascript
// packagingService.js - Linux konfigürasyonu
linux: {
  target: [
    {
      target: "AppImage",
      arch: ["x64"]
    },
    {
      target: "deb", 
      arch: ["x64"]
    },
    {
      target: "flatpak",
      arch: ["x64"],
      config: {
        appId: "tr.gov.meb.${appName.toLowerCase()}",
        runtime: "org.freedesktop.Platform",
        runtimeVersion: "22.08",
        sdk: "org.freedesktop.Sdk"
      }
    }
  ]
}
```

#### 2. Otomatik Flatpak Manifest Oluşturma
```javascript
async generateFlatpakManifest(appName, appVersion, companyInfo) {
  const manifest = {
    "app-id": `tr.gov.meb.${appName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    "runtime": "org.freedesktop.Platform",
    "runtime-version": "22.08",
    "sdk": "org.freedesktop.Sdk",
    "command": appName.toLowerCase(),
    "finish-args": [
      "--share=ipc",
      "--socket=x11",
      "--socket=pulseaudio",
      "--device=dri",
      "--filesystem=home:ro"
    ],
    "modules": [{
      "name": appName.toLowerCase(),
      "buildsystem": "simple",
      "build-commands": [
        `install -Dm755 ${appName} /app/bin/${appName}`,
        `install -Dm644 ${appName}.desktop /app/share/applications/tr.gov.meb.${appName}.desktop`,
        `install -Dm644 icon.png /app/share/icons/hicolor/256x256/apps/tr.gov.meb.${appName}.png`
      ]
    }]
  };
  
  return manifest;
}
```

---

## 📋 **Pratik Öneriler**

### Eğitim Kurumları İçin:
1. **Flatpak kullanın** - En hızlı ve kolay
2. **AppID formatı**: `tr.gov.meb.kurum.uygulama`
3. **Kategori**: Education, Teaching
4. **Türkçe açıklamalar** mutlaka ekleyin

### Geliştiriciler İçin:
1. **Test ortamı** kurun:
   ```bash
   flatpak install flathub org.freedesktop.Platform//22.08
   flatpak install flathub org.freedesktop.Sdk//22.08
   ```

2. **Local test**:
   ```bash
   flatpak-builder build-dir manifest.json
   flatpak build-export repo build-dir
   flatpak --user remote-add --no-gpg-verify local-repo repo
   flatpak --user install local-repo tr.gov.meb.uygulamaadi
   ```

---

## 🔗 **Faydalı Linkler**

- **Pardus Developer Portal**: https://developer.pardus.org.tr/
- **Flathub Docs**: https://docs.flathub.org/
- **Flatpak Builder**: https://docs.flatpak.org/en/latest/flatpak-builder.html
- **Pardus Wiki**: https://wiki.pardus.org.tr/
- **Debian Policy**: https://www.debian.org/doc/debian-policy/

---

## ⚡ **Hızlı Başlangıç**

En hızlı yoldan Pardus Yazılım Merkezi'ne uygulama eklemek için:

1. **Flatpak manifest** oluşturun
2. **Flathub'a başvuru** yapın
3. **2-3 hafta içinde** yayında!

Bu yöntem resmi Pardus depolarından çok daha hızlı ve pratiktir.