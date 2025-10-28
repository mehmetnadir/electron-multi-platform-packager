# Teknik Kararlar ve Gerekçeleri

## 🎯 Neden AppImage?

### Seçilen: AppImage
**Avantajları:**
- ✅ Tek dosya, bağımlılık yok
- ✅ Çift tıkla çalıştır
- ✅ Tüm Linux dağıtımlarında çalışır
- ✅ Kurulum gerektirmez
- ✅ Kullanıcı izni gerektirmez (sudo yok)

**Alternatifleri:**
- ❌ .deb: Sadece Debian/Ubuntu
- ❌ .rpm: Sadece RedHat/Fedora
- ❌ Flatpak: Flatpak runtime gerektirir
- ❌ Snap: Snapd daemon gerektirir

## 🏗️ Neden zkitap.zip Kullanıldı?

### Seçilen: Önceden Derlenmiş Electron Runtime

**Gerekçe:**
- ✅ Electron'u her seferinde derlemek çok yavaş (~10 dakika)
- ✅ Bağımlılık yönetimi karmaşık
- ✅ Kullanıcı sadece içerik gönderir, runtime hazır
- ✅ Tutarlı sonuçlar (her paket aynı Electron versiyonu)

**Yapı:**
```
zkitap.zip (78MB)
├── zkitap (wrapper script)
├── zkitap.bin (Electron binary)
├── resources/
│   └── app/
│       ├── package.json
│       ├── node_modules/
│       └── build/ (BURAYA kullanıcı içeriği eklenir)
```

**Alternatif:** electron-builder kullanmak
- ❌ Her paket için yeniden derleme
- ❌ Bağımlılık sorunları
- ❌ Yavaş (10x daha uzun)

## 📦 Neden Direkt appimagetool?

### Seçilen: appimagetool + App.AppDir

**Gerekçe:**
- ✅ Tam kontrol
- ✅ Özel AppRun script'i
- ✅ İlk çalıştırmada kurulum yapabilme
- ✅ Versiyon kontrolü
- ✅ Logo yönetimi

**electron-builder Sorunu:**
- ❌ Çift tıkla çalışmıyor (chmod +x gerekiyor)
- ❌ Özel kurulum script'i yok
- ❌ Versiyon kontrolü yok
- ❌ Logo yönetimi sınırlı

## 🎨 Neden Zenity?

### Seçilen: Zenity

**Gerekçe:**
- ✅ Tüm Linux dağıtımlarında varsayılan
- ✅ Basit ve güvenilir
- ✅ GTK tabanlı (modern görünüm)
- ✅ Logo desteği (`--window-icon`)

**YAD Denendi, Başarısız:**
- ❌ GLIBC 2.34 gerekiyor (Pardus'ta yok)
- ❌ Bağımlılıkları gömmek çok karmaşık
- ❌ Statik binary yok

**Dialog Denendi, Uygun Değil:**
- ❌ Terminal-based (GUI değil)
- ❌ Kullanıcı deneyimi kötü

**Basit Bash Progress Bar Denendi:**
- ❌ Sadece terminal'de görünür
- ❌ Çift tıklayınca görünmez

## 🔐 Neden Sandbox Devre Dışı?

### Seçilen: --no-sandbox --disable-gpu-sandbox

**Gerekçe:**
- ✅ AppImage içinde sandbox çalışmıyor
- ✅ Futex hatası veriyor
- ✅ Pardus'ta zorunlu

**Güvenlik:**
- ⚠️ Sandbox olmadan çalışır
- ✅ Electron uygulaması zaten kullanıcı izinleriyle çalışır
- ✅ Sistem dosyalarına erişim yok

## 📁 Neden ~/DijiTap/?

### Seçilen: ~/DijiTap/APP_NAME/

**Gerekçe:**
- ✅ Kullanıcı home dizini (izin sorunu yok)
- ✅ Tüm uygulamalar tek yerde
- ✅ Yayınevi bazlı organizasyon
- ✅ Kolay bulunur

**Alternatifleri:**
- ❌ ~/.local/share/APP_NAME/ (gizli klasör, kullanıcı bulamaz)
- ❌ /opt/APP_NAME/ (sudo gerektirir)
- ❌ ~/Applications/ (macOS tarzı, Linux'ta yaygın değil)

## 🔄 Neden Versiyon Kontrolü?

### Seçilen: .version Dosyası

**Gerekçe:**
- ✅ Güncelleme varsa yeniden kur
- ✅ Aynı versiyon varsa direkt çalıştır
- ✅ Kullanıcı deneyimi (hızlı açılış)
- ✅ Disk alanı tasarrufu (eski versiyon silinir)

**Alternatif:** Her seferinde yeniden kur
- ❌ Yavaş (2GB paket için 30 saniye)
- ❌ Disk alanı israfı

## 🖼️ Logo Yönetimi Stratejisi

### Seçilen: Çoklu Lokasyon

**Gerekçe:**
- ✅ Zenity progress bar → `--window-icon`
- ✅ Electron pencere → `--icon`
- ✅ Sistem menüsü → `~/.local/share/icons/`
- ✅ Desktop entry → `Icon=APP_NAME`

**Neden Birden Fazla Kopya?**
- Her sistem farklı yerden logo arar
- Fallback mekanizması gerekli
- Tutarlı görünüm için

## 🎯 Neden package.json Güncelleme?

### Seçilen: productName Otomatik Güncelleme

**Gerekçe:**
- ✅ Görev çubuğunda doğru isim
- ✅ Pencere başlığında doğru isim
- ✅ Sistem menüsünde doğru isim

**Kod:**
```javascript
packageJson.productName = appName;
packageJson.name = appName.toLowerCase().replace(/\s+/g, '-');
```

## 🚀 Neden Asenkron Job Queue?

### Seçilen: File-based Job Queue

**Gerekçe:**
- ✅ API hemen döner (kullanıcı beklemez)
- ✅ Uzun işlemler arka planda
- ✅ Progress takibi
- ✅ Hata yönetimi
- ✅ Yeniden başlatmada kayıp yok

**Alternatif:** Senkron işlem
- ❌ API timeout (2GB paket için 60+ saniye)
- ❌ Kullanıcı bekler
- ❌ Hata durumunda retry yok

## 📊 Performans Optimizasyonları

### 1. zkitap.zip Önbellekleme
- ✅ Her paket için aynı runtime
- ✅ Sadece build.zip extract edilir
- ✅ 10x daha hızlı

### 2. Paralel İşlem Yok
- ✅ Tek worker (kaynak kontrolü)
- ✅ Queue sistemi (sıralı işlem)
- ✅ Sunucu yükü kontrollü

### 3. Temp Klasör Temizleme
- ✅ Her job sonrası temizlik
- ✅ Disk alanı tasarrufu
- ✅ `/tmp` kullanımı (otomatik temizlik)

## 🔒 Güvenlik Kararları

### 1. Kullanıcı İzinleri
- ✅ Sadece kullanıcı home dizini
- ✅ Sistem dosyalarına erişim yok
- ✅ sudo gerektirmez

### 2. Dosya Doğrulama
- ⚠️ ZIP içeriği kontrol edilmiyor
- ⚠️ Zararlı kod kontrolü yok
- ℹ️ Güvenilir kaynaklardan kullanılmalı

### 3. API Güvenliği
- ⚠️ Authentication yok (public endpoint)
- ⚠️ Rate limiting yok
- ℹ️ Üretim için eklenmeli

## 🎨 UX Kararları

### 1. Progress Bar
- ✅ Kullanıcı bilgilendirilir
- ✅ 2GB paket için kritik
- ✅ Logo ile marka kimliği

### 2. Otomatik Kurulum
- ✅ İlk çalıştırmada otomatik
- ✅ Kullanıcı hiçbir şey yapmaz
- ✅ Sonraki açılışlar hızlı

### 3. Masaüstü Entegrasyonu
- ✅ Sistem menüsünde görünür
- ✅ Logo ile tanınabilir
- ✅ Çift tıkla çalışır

## 📝 Kod Kalitesi Kararları

### 1. Bash Script
- ✅ AppRun için standart
- ✅ Tüm Linux'ta çalışır
- ✅ Bağımlılık yok

### 2. Node.js
- ✅ Paketleme için
- ✅ fs-extra kullanımı
- ✅ Async/await

### 3. TypeScript
- ✅ API için
- ✅ Type safety
- ✅ Fastify entegrasyonu

## 🔮 Gelecek Planları

### Kısa Vadeli
1. ✅ AppImage - TAMAMLANDI
2. ⏭️ Çalışan projeye entegrasyon
3. ⏭️ .deb paketi desteği

### Orta Vadeli
4. ⏭️ Flatpak desteği
5. ⏭️ Auto-update mekanizması
6. ⏭️ Dijital imza

### Uzun Vadeli
7. ⏭️ Windows .exe desteği
8. ⏭️ macOS .dmg desteği
9. ⏭️ Cross-platform tek API
