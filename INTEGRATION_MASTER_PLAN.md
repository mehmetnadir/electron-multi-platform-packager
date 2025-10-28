# 🔗 Electron Paketleyici ↔ Book Update Entegrasyon Master Planı

## 📋 Proje Durumu

### ✅ Electron Paketleyici (Masaüstü)
- [x] Windows paketi oluşturma
- [x] macOS paketi oluşturma
- [x] Linux/Pardus paketi oluşturma (AppImage)
- [x] PWA paketi oluşturma
- [x] Yayınevi yönetimi (yerel)
- [x] Logo yönetimi
- [x] Yayınevi eşleştirme UI

### ✅ Book Update (Web/API)
- [x] Yayınevi yönetimi (veritabanı)
- [x] Kitap yönetimi
- [x] Pipeline sistemi (otomatik indirme/yükleme)
- [x] R2 Storage entegrasyonu
- [x] Multi-platform destek
- [x] Linux paketleme API (`/api/v1/package-linux-public`)

## 🎯 Entegrasyon Hedefleri

### 1. Yayınevi Eşleştirmesi
**Amaç:** Masaüstündeki yerel yayınevini web'deki yayınevi ile eşleştirmek.

**Senaryo:**
```
Masaüstü Yayınevi: "DijiTap" (ID: local-123)
     ↓ Eşleştir
Web Yayınevi: "DijiTap" (ID: 1)
```

**Kullanım:**
- Paketleme sırasında doğru yayınevi bilgilerini kullanmak
- Otomatik logo çekmek
- R2 ayarlarını almak

### 2. Kitap Listesi Senkronizasyonu
**Amaç:** Web'de eklenmiş kitapları masaüstünde görmek.

**Senaryo:**
```
1. Kullanıcı masaüstünde yayınevi seçer
2. Web'den o yayınevinin kitapları çekilir
3. Sınıf, ders filtreleri ile liste gösterilir
4. Kullanıcı kitap seçer
```

### 3. Yarı-Otomatik Paketleme
**Amaç:** Mevcut kitap için yeni paket oluşturmak.

**Senaryo A - Mevcut Kitap:**
```
1. Kullanıcı web'den kitap seçer (örn: "Matematik 5")
2. Build.zip yükler
3. "Paketle ve Yükle" butonuna tıklar
4. Sistem:
   - Tüm platformlar için paket oluşturur
   - R2'ye yükler
   - Web'deki kitap kaydını günceller
   - İndirme linklerini döner
```

**Senaryo B - Yeni Kitap:**
```
1. Kullanıcı "Yeni Kitap" seçer
2. Kitap bilgilerini girer (ad, sınıf, ders, vb.)
3. Build.zip yükler
4. "Oluştur ve Yükle" butonuna tıklar
5. Sistem:
   - Web'de yeni kitap kaydı oluşturur
   - Tüm platformlar için paket oluşturur
   - R2'ye yükler
   - İndirme linklerini döner
```

### 4. Pipeline Entegrasyonu
**Amaç:** Masaüstünden yüklenen paketlerin pipeline'ı bypass etmesi.

**Mevcut Durum:**
```
Web'de kitap eklenir → ID girilir → Pipeline:
  1. Yayınevi domain'inden indir
  2. Platform'a göre işle
  3. R2'ye yükle
```

**Yeni Durum:**
```
Masaüstünden paket yüklenir → Pipeline:
  1. ❌ Domain'den indirme (SKIP)
  2. ✅ Hazır paketi al
  3. ✅ R2'ye yükle
```

**Ayırt Etme:**
- `source` field: "manual_upload" | "auto_pipeline"
- `manual_upload` ise domain'den indirme adımı atlanır

## 📐 Teknik Mimari

### API Endpoints (Yeni)

#### 1. Yayınevi Listesi
```
GET /api/v1/publishers
Response: [
  {
    id: "1",
    name: "DijiTap",
    slug: "dijitap",
    logo: "https://...",
    r2Config: { ... }
  }
]
```

#### 2. Kitap Listesi (Yayınevine Göre)
```
GET /api/v1/publishers/:publisherId/books?grade=5&subject=matematik
Response: [
  {
    id: "book-123",
    title: "Matematik 5",
    grade: "5",
    subject: "Matematik",
    platforms: {
      windows: { url: "...", version: "1.0.0" },
      macos: { url: "...", version: "1.0.0" },
      pardus: { url: "...", version: "1.0.0" },
      web: { url: "...", version: "1.0.0" }
    }
  }
]
```

#### 3. Yeni Kitap Oluştur
```
POST /api/v1/books
Body: {
  publisherId: "1",
  title: "Matematik 5",
  grade: "5",
  subject: "Matematik",
  source: "manual_upload"
}
Response: {
  bookId: "book-456",
  uploadUrls: {
    windows: "https://r2.../upload-token",
    macos: "https://r2.../upload-token",
    pardus: "https://r2.../upload-token",
    web: "https://r2.../upload-token"
  }
}
```

#### 4. Paket Yükle (Mevcut Kitap)
```
POST /api/v1/books/:bookId/upload-package
Body: {
  platform: "windows" | "macos" | "pardus" | "web",
  version: "1.0.0",
  file: <binary>
}
Response: {
  success: true,
  url: "https://r2.../package.exe"
}
```

### Veri Akışı

```
┌─────────────────────────────────────────────────────────────┐
│                    ELECTRON PAKETLEYİCİ                      │
│                        (Masaüstü)                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 1. Yayınevi Seç
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  GET /api/v1/publishers                                      │
│  → Yayınevi listesi                                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 2. Kitap Listesi İste
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  GET /api/v1/publishers/:id/books                            │
│  → Kitap listesi (filtreli)                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
            Mevcut Kitap          Yeni Kitap
                    │                   │
                    ▼                   ▼
        ┌───────────────────┐   ┌──────────────────┐
        │ Kitap Seç         │   │ Bilgileri Gir    │
        │ Build.zip Yükle   │   │ Build.zip Yükle  │
        └───────────────────┘   └──────────────────┘
                    │                   │
                    │                   │ POST /api/v1/books
                    │                   │ → bookId + uploadUrls
                    │                   │
                    └─────────┬─────────┘
                              │
                              │ 3. Paketleme Başlat
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              YEREL PAKETLEME (4 Platform)                    │
│  • Windows (.exe)                                            │
│  • macOS (.dmg)                                              │
│  • Pardus (.impark)                                          │
│  • PWA (web build)                                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 4. R2'ye Yükle
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  POST /api/v1/books/:bookId/upload-package                   │
│  → Her platform için ayrı ayrı                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 5. Veritabanı Güncelle
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    BOOK UPDATE API                           │
│  • Kitap kaydını güncelle                                    │
│  • Platform URL'lerini kaydet                                │
│  • source = "manual_upload"                                  │
│  • Pipeline'ı bypass et                                      │
└─────────────────────────────────────────────────────────────┘
```

## 🗄️ Veritabanı Değişiklikleri

### books Tablosu (Yeni Alanlar)
```sql
ALTER TABLE books ADD COLUMN source ENUM('auto_pipeline', 'manual_upload') DEFAULT 'auto_pipeline';
ALTER TABLE books ADD COLUMN uploaded_from VARCHAR(255) NULL COMMENT 'Electron Packager version';
ALTER TABLE books ADD COLUMN last_manual_upload_at TIMESTAMP NULL;
```

### book_packages Tablosu (Yeni)
```sql
CREATE TABLE book_packages (
  id INT PRIMARY KEY AUTO_INCREMENT,
  book_id INT NOT NULL,
  platform ENUM('windows', 'macos', 'pardus', 'web', 'android', 'ios') NOT NULL,
  version VARCHAR(50) NOT NULL,
  file_url TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  checksum VARCHAR(64),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  uploaded_by INT NULL,
  source ENUM('auto_pipeline', 'manual_upload') DEFAULT 'manual_upload',
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_book_platform (book_id, platform),
  INDEX idx_version (version)
);
```

## 📱 UI/UX Değişiklikleri

### Electron Paketleyici - Yeni Sayfalar

#### 1. Kitap Yönetimi Sayfası
```
/books

┌─────────────────────────────────────────────────────────┐
│  📚 Kitap Yönetimi                                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Yayınevi: [DijiTap ▼]         [+ Yeni Kitap]          │
│                                                          │
│  Filtreler:                                             │
│  Sınıf: [Tümü ▼]  Ders: [Tümü ▼]  Tür: [Tümü ▼]       │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 📖 Matematik 5                                    │  │
│  │ Sınıf: 5 | Ders: Matematik | Versiyon: 1.0.0    │  │
│  │ [📦 Paketle] [📤 Yükle] [ℹ️ Detay]              │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 📖 Türkçe 5                                       │  │
│  │ Sınıf: 5 | Ders: Türkçe | Versiyon: 2.1.0       │  │
│  │ [📦 Paketle] [📤 Yükle] [ℹ️ Detay]              │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

#### 2. Paketleme Sayfası
```
/books/:bookId/package

┌─────────────────────────────────────────────────────────┐
│  📦 Matematik 5 - Paketleme                              │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. Build Dosyası                                       │
│  ┌────────────────────────────────────────────────┐    │
│  │ [📁 build.zip seç] veya sürükle-bırak          │    │
│  │ ✅ build.zip (28.5 MB)                          │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  2. Platform Seçimi                                     │
│  ☑ Windows (.exe)                                       │
│  ☑ macOS (.dmg)                                         │
│  ☑ Pardus (.impark)                                     │
│  ☑ PWA (web)                                            │
│                                                          │
│  3. Versiyon                                            │
│  [1.0.0] (Otomatik artırılır)                          │
│                                                          │
│  4. PWA Ayarları (Opsiyonel)                           │
│  ┌────────────────────────────────────────────────┐    │
│  │ Start URL: [/]                                  │    │
│  │ Scope: [/]                                      │    │
│  │ Display: [standalone ▼]                        │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  [🚀 Paketle ve Yükle]                                  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

#### 3. Progress Sayfası
```
/books/:bookId/progress

┌─────────────────────────────────────────────────────────┐
│  ⏳ Paketleme İlerliyor...                              │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ✅ Windows Paketi                                      │
│  ████████████████████████ 100%                          │
│  ✓ Paketleme tamamlandı                                │
│  ✓ R2'ye yüklendi                                       │
│                                                          │
│  ⏳ macOS Paketi                                         │
│  ████████████░░░░░░░░░░░░ 60%                           │
│  → Paketleniyor...                                      │
│                                                          │
│  ⏸ Pardus Paketi                                        │
│  ░░░░░░░░░░░░░░░░░░░░░░░░ 0%                            │
│  ⏳ Sırada bekliyor...                                  │
│                                                          │
│  ⏸ PWA Paketi                                           │
│  ░░░░░░░░░░░░░░░░░░░░░░░░ 0%                            │
│  ⏳ Sırada bekliyor...                                  │
│                                                          │
│  [❌ İptal Et]                                          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Book Update - Değişiklikler

#### Admin Panel - Kitap Detay
```
Yeni Alan: "Kaynak"
• Otomatik Pipeline (domain'den indirildi)
• Manuel Yükleme (Electron Packager'dan)

Yeni Buton: "Manuel Paket Yükle"
→ Electron Packager'a yönlendir
```

## 🔄 İş Akışı Örnekleri

### Örnek 1: Mevcut Kitabı Güncelleme

```
1. Kullanıcı Electron Packager'ı açar
2. Yayınevi seçer: "DijiTap"
3. Kitap listesinden "Matematik 5" seçer
4. "Paketle" butonuna tıklar
5. build.zip yükler
6. Platform seçer: Windows, macOS, Pardus, PWA
7. "Paketle ve Yükle" butonuna tıklar

Arka Plan:
8. Her platform için paket oluşturulur (paralel)
9. Her paket R2'ye yüklenir
10. Book Update API'sine bildirim gönderilir
11. Veritabanı güncellenir (URL'ler, versiyon, source)
12. Pipeline bu kitabı atlar (source=manual_upload)

Sonuç:
13. Kullanıcıya indirme linkleri gösterilir
14. Web'de kitap sayfası otomatik güncellenir
```

### Örnek 2: Yeni Kitap Ekleme

```
1. Kullanıcı "Yeni Kitap" butonuna tıklar
2. Form doldurur:
   - Yayınevi: DijiTap
   - Ad: Fen Bilimleri 6
   - Sınıf: 6
   - Ders: Fen Bilimleri
   - Tür: Ders Kitabı
3. build.zip yükler
4. Platform seçer
5. "Oluştur ve Yükle" butonuna tıklar

Arka Plan:
6. Book Update API'de yeni kitap kaydı oluşturulur
7. bookId döner
8. Her platform için paket oluşturulur
9. R2'ye yüklenir
10. Kitap kaydı güncellenir

Sonuç:
11. Kitap web'de yayına girer
12. Kullanıcıya linkler gösterilir
```

## 🧪 Test Planı

### Faz 1: API Entegrasyonu
- [ ] Test 1.1: Yayınevi listesi çekme
- [ ] Test 1.2: Kitap listesi çekme (filtreli)
- [ ] Test 1.3: Yeni kitap oluşturma
- [ ] Test 1.4: Paket yükleme (tek platform)
- [ ] Test 1.5: Paket yükleme (çoklu platform)

### Faz 2: UI Geliştirme
- [ ] Test 2.1: Kitap yönetimi sayfası
- [ ] Test 2.2: Yayınevi seçimi ve eşleştirme
- [ ] Test 2.3: Kitap listesi ve filtreleme
- [ ] Test 2.4: Paketleme formu
- [ ] Test 2.5: Progress tracking

### Faz 3: Paketleme Entegrasyonu
- [ ] Test 3.1: Windows paketi + R2 upload
- [ ] Test 3.2: macOS paketi + R2 upload
- [ ] Test 3.3: Pardus paketi + R2 upload
- [ ] Test 3.4: PWA paketi + R2 upload
- [ ] Test 3.5: Paralel paketleme

### Faz 4: Pipeline Entegrasyonu
- [ ] Test 4.1: Manuel yükleme source kontrolü
- [ ] Test 4.2: Pipeline bypass
- [ ] Test 4.3: Otomatik güncelleme devre dışı
- [ ] Test 4.4: Versiyon kontrolü

### Faz 5: End-to-End
- [ ] Test 5.1: Yeni kitap oluştur ve yükle
- [ ] Test 5.2: Mevcut kitabı güncelle
- [ ] Test 5.3: Çoklu platform yükleme
- [ ] Test 5.4: Hata senaryoları
- [ ] Test 5.5: Performans testi

## 📅 İmplementasyon Sırası

### Sprint 1: API Hazırlığı (1-2 gün)
1. ✅ Yayınevi eşleştirme UI (TAMAMLANDI)
2. ⏭️ Book Update API'ye yeni endpoint'ler ekle
3. ⏭️ Veritabanı migration'ları
4. ⏭️ API testleri

### Sprint 2: Kitap Listesi (1-2 gün)
5. ⏭️ Kitap yönetimi sayfası UI
6. ⏭️ Yayınevi seçimi entegrasyonu
7. ⏭️ Kitap listesi çekme
8. ⏭️ Filtreleme ve arama

### Sprint 3: Paketleme UI (2-3 gün)
9. ⏭️ Paketleme formu
10. ⏭️ Build.zip yükleme
11. ⏭️ Platform seçimi
12. ⏭️ PWA ayarları

### Sprint 4: R2 Upload (2-3 gün)
13. ⏭️ R2 upload servisi
14. ⏭️ Progress tracking
15. ⏭️ Hata yönetimi
16. ⏭️ Retry mekanizması

### Sprint 5: Pipeline Entegrasyonu (1-2 gün)
17. ⏭️ Source field kontrolü
18. ⏭️ Pipeline bypass
19. ⏭️ Veritabanı güncellemeleri

### Sprint 6: Test ve Optimizasyon (2-3 gün)
20. ⏭️ End-to-end testler
21. ⏭️ Performans optimizasyonu
22. ⏭️ Hata düzeltmeleri
23. ⏭️ Dokümantasyon

## 🎯 Başarı Kriterleri

1. ✅ Yayınevi eşleştirmesi çalışıyor
2. ⏳ Kitap listesi web'den çekiliyor
3. ⏳ Yeni kitap oluşturulabiliyor
4. ⏳ 4 platform için paket oluşturuluyor
5. ⏳ R2'ye otomatik yükleniyor
6. ⏳ Web'de kitap otomatik güncelleniyor
7. ⏳ Pipeline manuel yüklemeleri bypass ediyor
8. ⏳ Kullanıcı deneyimi akıcı

## 📝 Notlar

- Her adım test edilecek
- Tarayıcı konsolu takip edilecek
- Hata logları kaydedilecek
- Performans metrikleri ölçülecek
- Kullanıcı geri bildirimleri toplanacak
