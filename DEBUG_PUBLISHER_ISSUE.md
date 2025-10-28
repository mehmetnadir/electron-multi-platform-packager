# 🐛 YAYINEVI SEÇİM SORUNU

## Sorun:
ADIM 2'de yayınevi dropdown'u boş görünüyor. Önceden eklenen yayınevi seçilemiyor.

## Olası Nedenler:

### 1. Yayınevleri Yüklenmemiş
```javascript
// app.js içinde publishers array'i boş olabilir
this.publishers = []
```

### 2. ConfigManager Yolu Yanlış
```javascript
// Electron'da farklı path kullanılıyor
/Users/nadir/Library/Application Support/Electron/config/settings.json
```

### 3. Step 2'ye Geçerken Yayınevleri Yüklenmiyor
```javascript
// nextStep() fonksiyonunda yayınevleri yüklenmiyor olabilir
```

---

## Çözüm Adımları:

### 1. Konsol Loglarını Kontrol Et
Electron DevTools'da (Cmd+Option+I) şunları ara:
```
📋 Publisher dropdown güncelleniyor
Yayınevi sayısı: 0
```

### 2. Settings Dosyasını Kontrol Et
```bash
cat "/Users/nadir/Library/Application Support/Electron/config/settings.json"
```

Yayınevleri var mı?

### 3. Manuel Yayınevi Yükleme Ekle
Step 2'ye geçerken yayınevleri yüklensin:

```javascript
// app.js - nextStep fonksiyonunda
if (this.currentStep === 2) {
    // Yayınevlerini yükle
    await this.loadPublishers();
    this.updatePublisherDropdown();
}
```

---

## Hızlı Test:

Electron DevTools Console'da çalıştır:
```javascript
// Yayınevlerini kontrol et
console.log('Publishers:', app.publishers);

// Manuel yükle
app.loadPublishers().then(() => {
    console.log('Loaded:', app.publishers);
    app.updatePublisherDropdown();
});
```

---

## Düzeltme Kodu:

Eğer yayınevleri yüklenmiyorsa, `nextStep` fonksiyonuna ekle:
