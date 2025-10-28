# 🧪 UI ENTEGRASYON TEST REHBERİ

## Test Tarihi: 27 Ekim 2025

---

## 🎯 TEST KAPSAMI

Bu rehber, Electron Paketleyici UI'ının tüm özelliklerini test etmek için adım adım talimatlar içerir.

---

## ✅ ÖN HAZIRLIK

### 1. Sunucuyu Başlat
```bash
cd /Users/nadir/01dev/elecron-paket
npm start
```

**Beklenen:**
- ✅ Server başladı: `http://localhost:3000`
- ✅ Konsol hataları yok

### 2. Tarayıcıyı Aç
```
http://localhost:3000
```

**Beklenen:**
- ✅ Ana sayfa yüklendi
- ✅ Gradient background görünüyor
- ✅ "Kitaplar" ve "Ayarlar" butonları görünüyor

---

## 📋 TEST SENARYOLARI

### TEST 1: Ana Sayfa ✅

#### Adımlar:
1. `http://localhost:3000` adresini aç
2. Sayfanın yüklendiğini kontrol et
3. Header butonlarını kontrol et

#### Kontrol Listesi:
- [ ] Sayfa yüklendi
- [ ] Gradient background var
- [ ] "Kitaplar" butonu görünüyor
- [ ] "Ayarlar" butonu görünüyor
- [ ] Wizard steps görünüyor
- [ ] Konsol hatası yok

---

### TEST 2: Kitaplar Sayfası ✅

#### Adımlar:
1. "Kitaplar" butonuna tıkla
2. Sayfa yüklendiğini bekle
3. Yayınevi dropdown'unu kontrol et

#### Kontrol Listesi:
- [ ] Sayfa yüklendi (`/books`)
- [ ] "Kitap Yönetimi" başlığı görünüyor
- [ ] Yayınevi dropdown doluyor
- [ ] "Yeni Kitap" butonu görünüyor
- [ ] "Geri" butonu çalışıyor
- [ ] Konsol hatası yok

#### Test 2.1: Yayınevi Seçimi
1. Dropdown'dan bir yayınevi seç
2. Kitapların yüklendiğini bekle

**Kontrol:**
- [ ] Kitaplar yüklendi
- [ ] İstatistik kartları göründü
- [ ] Filtreler göründü
- [ ] Kitap kartları render edildi
- [ ] Platform ikonları doğru

#### Test 2.2: Filtreleme
1. Sınıf filtresinden bir seçim yap
2. Ders filtresinden bir seçim yap
3. Tür filtresinden bir seçim yap

**Kontrol:**
- [ ] Filtreler çalışıyor
- [ ] Kitap listesi güncelleniyor
- [ ] İstatistikler güncelleniyor
- [ ] Konsol hatası yok

#### Test 2.3: Kitap Kartları
1. Bir kitap kartının üzerine gel (hover)
2. "Paketle" butonuna tıkla
3. "Detay" butonuna tıkla

**Kontrol:**
- [ ] Hover efekti çalışıyor
- [ ] "Paketle" butonu paketleme sayfasına yönlendiriyor
- [ ] "Detay" butonu alert gösteriyor
- [ ] Alert'te kitap bilgileri doğru

---

### TEST 3: Yeni Kitap Sayfası ✅

#### Adımlar:
1. Kitaplar sayfasında "Yeni Kitap" butonuna tıkla
2. Form alanlarını doldur
3. Platformları seç
4. "Kitap Oluştur" butonuna tıkla

#### Kontrol Listesi:
- [ ] Sayfa yüklendi (`/new-book.html`)
- [ ] Form alanları görünüyor
- [ ] Platform checkboxları çalışıyor
- [ ] "Geri" butonu çalışıyor

#### Test 3.1: Form Validasyonu
1. Boş form ile submit et
2. Sadece başlık gir, submit et
3. Tüm platformları kaldır, submit et

**Kontrol:**
- [ ] Boş başlık uyarısı gösteriliyor
- [ ] Platform uyarısı gösteriliyor
- [ ] Error alertleri doğru

#### Test 3.2: Başarılı Kitap Oluşturma
1. Tüm alanları doldur:
   - Başlık: "Test Kitap [timestamp]"
   - Sınıf: 5
   - Ders: Matematik
   - Tür: Ders Kitabı
   - Akademik Yıl: 2024-2025
   - Grup: İlkokul
   - Açıklama: Test açıklaması
   - Platformlar: Hepsi seçili

2. "Kitap Oluştur" butonuna tıkla

**Kontrol:**
- [ ] Loading gösteriliyor
- [ ] Success alert gösteriliyor
- [ ] Book ID gösteriliyor
- [ ] 2 saniye sonra paketleme sayfasına yönlendiriyor
- [ ] Konsol'da "Book created" logu var

---

### TEST 4: Paketleme Sayfası ✅

#### Adımlar:
1. Yeni kitap oluşturduktan sonra otomatik yönlendirmeyi bekle
2. Veya kitaplar sayfasından "Paketle" butonuna tıkla

#### Kontrol Listesi:
- [ ] Sayfa yüklendi (`/package-book.html`)
- [ ] Kitap bilgileri gösteriliyor
- [ ] 4 platform bölümü görünüyor
- [ ] Her platform için:
  - [ ] Versiyon input'u var
  - [ ] Dosya seçici var
  - [ ] Yükle butonu var
  - [ ] Status "Bekliyor"

#### Test 4.1: Dosya Seçimi
1. Her platform için bir dosya seç:
   - Windows: .exe dosyası
   - macOS: .dmg dosyası
   - Pardus: .impark dosyası
   - Web: .zip dosyası

**Kontrol:**
- [ ] Dosya seçici çalışıyor
- [ ] Seçilen dosya adı görünüyor

#### Test 4.2: Paket Yükleme (Simüle)
**NOT:** Gerçek dosya yüklemek için büyük dosyalar gerekir.
Test için küçük dosyalar kullanılabilir.

1. Windows için yükle:
   - Versiyon: 1.0.0
   - Dosya: test.exe (herhangi bir dosya)
   - "Yükle" butonuna tıkla

**Kontrol:**
- [ ] Buton disabled oluyor
- [ ] Status "Yükleniyor..." oluyor
- [ ] Progress bar görünüyor
- [ ] Progress %0'dan %100'e ilerliyor
- [ ] Success alert gösteriliyor
- [ ] Status "Tamamlandı" oluyor
- [ ] Section yeşil oluyor
- [ ] Özet bölümü gösteriliyor
- [ ] "Tamamla" butonu gösteriliyor

2. Diğer platformlar için tekrarla

**Kontrol:**
- [ ] Her platform için aynı akış çalışıyor
- [ ] Özet güncelleniyor
- [ ] Konsol hatası yok

#### Test 4.3: Tamamlama
1. En az bir platform yükle
2. "Tamamla ve Kitaplara Dön" butonuna tıkla

**Kontrol:**
- [ ] Kitaplar sayfasına yönlendiriyor
- [ ] Yeni kitap listede görünüyor
- [ ] Platform ikonları enabled

---

### TEST 5: API Entegrasyonu ✅

#### Test 5.1: Network Tab Kontrolü
1. Browser DevTools'u aç (F12)
2. Network sekmesine git
3. Kitaplar sayfasını yükle
4. Yayınevi seç

**Kontrol:**
- [ ] `/api/akillitahta/publishers` - 200 OK
- [ ] `/api/akillitahta/publishers/:id/books` - 200 OK
- [ ] Response time < 1 saniye
- [ ] Response body doğru format

#### Test 5.2: Console Tab Kontrolü
1. Console sekmesine git
2. Tüm sayfaları gez

**Kontrol:**
- [ ] Error yok
- [ ] Warning yok (veya önemsiz)
- [ ] Log mesajları anlamlı

---

### TEST 6: Responsive Design ✅

#### Test 6.1: Desktop (> 1200px)
1. Tarayıcı penceresini genişlet
2. Kitaplar sayfasını aç

**Kontrol:**
- [ ] 3 sütunlu grid
- [ ] Tüm elementler düzgün
- [ ] Butonlar hizalı

#### Test 6.2: Tablet (768px - 1200px)
1. DevTools'da responsive mode'a geç
2. 1024px genişlik seç

**Kontrol:**
- [ ] 2 sütunlu grid
- [ ] Layout bozulmuyor
- [ ] Butonlar erişilebilir

#### Test 6.3: Mobile (< 768px)
1. 375px genişlik seç (iPhone)

**Kontrol:**
- [ ] 1 sütunlu grid
- [ ] Tüm içerik görünüyor
- [ ] Scroll çalışıyor
- [ ] Butonlar tıklanabilir

---

### TEST 7: Error Handling ✅

#### Test 7.1: Network Error
1. Internet bağlantısını kes
2. Kitaplar sayfasını yenile

**Kontrol:**
- [ ] Error mesajı gösteriliyor
- [ ] Uygulama crash olmuyor

#### Test 7.2: Invalid Data
1. URL'de geçersiz bookId kullan
2. `/package-book.html?bookId=invalid&publisherId=123`

**Kontrol:**
- [ ] Error alert gösteriliyor
- [ ] Uygulama crash olmuyor

---

## 📊 TEST SONUÇLARI

### Başarı Kriterleri:
- [ ] Tüm sayfalar yükleniyor
- [ ] API çağrıları çalışıyor
- [ ] Form validasyonu çalışıyor
- [ ] Dosya upload çalışıyor
- [ ] Responsive design çalışıyor
- [ ] Error handling çalışıyor
- [ ] Konsol hatası yok

### Test Özeti:
```
Total Tests: ___
Passed: ___
Failed: ___
Success Rate: ___%
```

---

## 🐛 BULUNAN HATALAR

### Hata 1:
**Açıklama:**
**Adımlar:**
**Beklenen:**
**Gerçekleşen:**
**Öncelik:** High/Medium/Low

---

## ✅ TEST TAMAMLANDI

**Tarih:**
**Tester:**
**Sonuç:** PASSED / FAILED
**Notlar:**

---

## 📝 SONRAKI ADIMLAR

1. [ ] Bulunan hataları düzelt
2. [ ] Eksik özellikleri ekle
3. [ ] Performance optimizasyonu
4. [ ] Accessibility testleri
5. [ ] Cross-browser testleri

---

**Test tamamlandıktan sonra bu dosyayı doldur ve kaydet!**
