# 🎯 YENİ WIZARD AKIŞI

## Tarih: 27 Ekim 2025, 23:50

---

## 🔄 ESKİ AKIŞ vs YENİ AKIŞ

### ❌ Eski Akış:
```
1. Build Yükle
2. Uygulama Bilgileri (Ad, Versiyon, Yayınevi)
3. Platform Seçimi
```

### ✅ Yeni Akış:
```
1. Build Yükle (build.zip)
2. Yayınevi Seç
3. Kitap Seç (YENİ / VAROLAN) ← YENİ!
4. Platform Seçimi
```

---

## 📋 ADIM 3: KİTAP SEÇİMİ (YENİ)

### Seçenekler:

#### 🆕 Yeni Kitap
- Kitap adı gir
- Versiyon gir
- Açıklama gir (opsiyonel)
- Yeni kitap oluşturulacak

#### 📚 Varolan Kitap
- Yayınevine göre kitap listesi göster
- Listeden kitap seç
- Seçilen kitap güncellenecek

---

## 🎯 PLATFORM SEÇİMİ MANTIĞI

### Senaryo:
```
build.zip yüklendi
Yayınevi: YDS Publishing
Kitap: Matematik 5. Sınıf (VAROLAN)
Platformlar: ✅ Pardus, ✅ macOS
```

### Sonuç:
- **Pardus:** Manuel paket yüklendi → Otomatik güncelleme KAPALI
- **macOS:** Manuel paket yüklendi → Otomatik güncelleme KAPALI
- **Windows:** Seçilmedi → Otomatik güncelleme DEVAM
- **Web:** Seçilmedi → Otomatik güncelleme DEVAM

---

## 💡 MANTIK:

### Manuel Yükleme = Otomatik Güncelleme Bypass

**Neden?**
- Kurum URL'sinden farklı bir versiyon kullanmak istiyorsun
- Özel düzenlemeler yapılmış olabilir
- Test amaçlı farklı versiyon olabilir

**Nasıl?**
- Seçilen platformlar için manuel paket yükle
- Bu platformlar için `source: "manual_upload"` işaretle
- Diğer platformlar `source: "auto_pipeline"` olarak kalır
- Pipeline sadece `auto_pipeline` olanları günceller

---

## 🔧 TEKNİK DETAYLAR

### Database:
```sql
book_pages table:
- source: 'manual_upload' | 'auto_pipeline'
- windows_enabled: boolean
- macos_enabled: boolean
- pardus_enabled: boolean
- web_enabled: boolean
```

### API:
```javascript
POST /api/v1/public/books/:bookId/upload-package
{
  platform: 'pardus',
  version: '1.0.0',
  file: <binary>
}

// Response:
{
  success: true,
  platform: 'pardus',
  url: 'https://cdn.../pardus/xxx.impark',
  isPublished: true
}
```

### Logic:
```javascript
// Platform seçimi
selectedPlatforms = ['pardus', 'macos']

// Upload
for (platform of selectedPlatforms) {
  uploadPackage(bookId, platform, file)
  // Bu platform artık manuel mod
}

// Diğer platformlar
otherPlatforms = ['windows', 'web']
// Bunlar otomatik güncellemeye devam eder
```

---

## 📱 UI AKIŞI

### 1. Ana Sayfa → Wizard
```
http://localhost:3000
```

### 2. Build Yükle
- build.zip seç
- Upload
- ✅ Adım 1 tamamlandı

### 3. Yayınevi Seç
- Dropdown'dan yayınevi seç
- Logo göster
- ✅ Adım 2 tamamlandı

### 4. Kitap Seç (YENİ!)
**Radio Button:**
- ( ) Yeni Kitap
  - Form göster (ad, versiyon, açıklama)
- ( ) Varolan Kitap
  - Kitap listesi göster
  - Kitap seç

### 5. Platform Seç
- ☑ Windows
- ☑ macOS
- ☑ Pardus
- ☑ Web

**Not:** Sadece seçilen platformlar güncellenecek!

### 6. Paketle ve Yükle
- Her platform için paket oluştur
- R2'ye yükle
- Database güncelle
- ✅ Tamamlandı

---

## 🎨 UI DEĞİŞİKLİKLERİ

### Wizard Steps:
```
1. Build Yükle
2. Yayınevi Seç      ← Basitleştirildi
3. Kitap Seç         ← YENİ!
4. Platform Seçimi   ← Aynı
```

### Step 3 (Kitap Seç):
- **Radio Buttons:** Yeni / Varolan
- **Yeni Kitap Form:**
  - Kitap Adı (required)
  - Versiyon (required)
  - Açıklama (optional)
- **Varolan Kitap List:**
  - Loading state
  - Kitap kartları
  - Seçim butonu

---

## 🔄 VAROLAN KİTAP GÜNCELLEME AKIŞI

### Adımlar:
1. Build.zip yükle
2. Yayınevi seç: **YDS Publishing**
3. Kitap türü: **Varolan Kitap**
4. Kitap seç: **Matematik 5. Sınıf**
5. Platform seç: **Pardus, macOS**
6. Paketle ve yükle

### Sonuç:
```javascript
{
  bookId: "12345",
  title: "Matematik 5. Sınıf",
  platforms: {
    windows: {
      enabled: true,
      source: "auto_pipeline",  // Otomatik güncelleme devam
      url: "https://kurum.com/..."
    },
    macos: {
      enabled: true,
      source: "manual_upload",   // Manuel yüklendi
      url: "https://cdn.../macos/12345.dmg"
    },
    pardus: {
      enabled: true,
      source: "manual_upload",   // Manuel yüklendi
      url: "https://cdn.../pardus/12345.impark"
    },
    web: {
      enabled: true,
      source: "auto_pipeline",  // Otomatik güncelleme devam
      url: "https://kurum.com/..."
    }
  }
}
```

---

## 🚀 SONRAKI ADIMLAR

### 1. JavaScript Logic (Öncelik: HIGH)
- [ ] Radio button change event
- [ ] Kitap listesi API çağrısı
- [ ] Kitap seçimi logic
- [ ] Form validation
- [ ] Step navigation güncelle

### 2. API Integration
- [ ] GET /api/akillitahta/publishers/:id/books
- [ ] POST /api/v1/public/books (yeni kitap)
- [ ] POST /api/v1/public/books/:id/upload-package

### 3. Testing
- [ ] Yeni akış testi
- [ ] Varolan kitap güncelleme testi
- [ ] Platform seçimi testi
- [ ] Source field testi

---

## 📝 NOTLAR

### Önemli:
- **Kitap Yönetimi (/books)** sayfası sadece görüntüleme için
- **Ana sayfa wizard** paketleme için
- **Platform seçimi** = Manuel override
- **Seçilmeyen platformlar** = Otomatik güncelleme devam

### Avantajlar:
- ✅ Esnek güncelleme
- ✅ Platform bazlı kontrol
- ✅ Otomatik + Manuel hybrid
- ✅ Test için ideal

---

## 🎯 HEDEF

**Kullanıcı şunu yapabilmeli:**
1. Varolan bir kitabı seç
2. Sadece belirli platformları güncelle
3. Diğer platformlar otomatik güncellenmeye devam etsin

**Örnek:**
> "Matematik 5 kitabının Pardus versiyonunu test etmek istiyorum. 
> Sadece Pardus'u manuel yükleyeceğim, diğerleri kurumdan gelsin."

✅ **MÜMKÜN!**

---

**UI kodu yazıldı, şimdi JavaScript logic'i eklenecek! 🚀**
