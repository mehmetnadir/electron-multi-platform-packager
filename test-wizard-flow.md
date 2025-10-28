# 🧪 WIZARD FLOW TEST

## Test Tarihi: 28 Ekim 2025, 00:26

---

## 🎯 TEST KAPSAMI

Bu test, yeni 4 adımlı wizard akışını ve sidebar'ı test eder.

---

## ✅ TEST 1: BUTON METNİ

### Adımlar:
1. Electron'u aç
2. Her adımda buton metnini kontrol et

### Beklenen:
| Adım | Buton Metni |
|------|-------------|
| 1    | İleri       |
| 2    | İleri       |
| 3    | İleri       |
| 4    | Başlat ve Kuyruğa Ekle |

### Konsol Logları:
```
🔘 Button update - Step: 1/4
  → Buton: İLERİ

🔘 Button update - Step: 2/4
  → Buton: İLERİ

🔘 Button update - Step: 3/4
  → Buton: İLERİ

🔘 Button update - Step: 4/4
  → Buton: BAŞLAT
```

### Sonuç:
- [ ] PASSED
- [ ] FAILED - Hangi adımda yanlış? ___

---

## ✅ TEST 2: PLATFORM SEÇİMİ

### Adımlar:
1. Step 3'e git
2. Windows platformunu seç
3. macOS platformunu seç
4. Konsolu kontrol et

### Beklenen Konsol:
```
🎯 Platform toggle: windows, Current: []
🎯 Platform toggle: windows, Current: [windows]
🎯 Platform toggle: macos, Current: [windows]
🎯 Platform toggle: macos, Current: [windows, macos]
```

### Sonuç:
- [ ] PASSED - Platformlar seçiliyor
- [ ] FAILED - Platform seçilmiyor

---

## ✅ TEST 3: STEP 3 VALIDATION

### Adımlar:
1. Step 3'te platform seç
2. "İleri" butonuna tıkla
3. Konsolu kontrol et

### Beklenen Konsol:
```
✅ Step 3 validation - Platforms: [windows, macos]
```

### Platform Seçilmediyse:
```
✅ Step 3 validation - Platforms: []
⚠️ Platform seçilmedi!
```

### Sonuç:
- [ ] PASSED - Validation çalışıyor
- [ ] FAILED - Validation çalışmıyor

---

## ✅ TEST 4: SIDEBAR - AKTİF İŞLEMLER

### Adımlar:
1. Tam akışı tamamla (Step 1-4)
2. "Başlat ve Kuyruğa Ekle" butonuna tıkla
3. Sidebar'ı kontrol et

### Beklenen:
- [ ] "Aktif İşlemler" alanında iş görünüyor
- [ ] İş adı doğru (girdiğin paket adı)
- [ ] Platformlar görünüyor
- [ ] Progress bar var
- [ ] İptal butonu çalışıyor

### Konsol Logları:
```
✅ Paketleme kuyruğa eklendi: {jobId: "xxx"}
🔄 updateSidebar çağrıldı - Active jobs: 1 Completed: 0
✅ Aktif işler render ediliyor: ["xxx"]
```

### Sonuç:
- [ ] PASSED - Sidebar çalışıyor
- [ ] FAILED - Sidebar boş

---

## ✅ TEST 5: TAM AKIŞ

### Adımlar:
1. **Step 1:** build.zip yükle
2. **Step 2:** Paket adı: "Test Kitap", Versiyon: "1.0.0", Yayınevi seç
3. **Step 3:** Windows ve macOS seç
4. **Step 4:** "Sadece Paketle" seç
5. "Başlat ve Kuyruğa Ekle" tıkla

### Beklenen:
- [ ] Her adımda "İleri" butonu
- [ ] Step 4'te "Başlat" butonu
- [ ] Sidebar'da iş görünüyor
- [ ] Konsol hatası yok

### Sonuç:
- [ ] PASSED
- [ ] FAILED - Hangi adımda? ___

---

## 🐛 SORUN TESPITI

### Eğer Step 3'te "Başlat" Butonu Görünüyorsa:

**Konsol'da kontrol et:**
```
🔘 Button update - Step: ?/?
```

**Olası Sorunlar:**
1. `this.currentStep` yanlış (3 yerine 4)
2. `this.totalSteps` yanlış (4 yerine 3)
3. `updateWizardUI()` çağrılmıyor

---

### Eğer Sidebar Boşsa:

**Konsol'da kontrol et:**
```
🔄 updateSidebar çağrıldı - Active jobs: ?
```

**Olası Sorunlar:**
1. `activeJobs.set()` çağrılmıyor
2. Socket.IO event gelmiyor
3. `jobId` yok

---

## 📊 TEST SONUÇLARI

### Özet:
```
Total Tests: 5
Passed: ___
Failed: ___
Success Rate: ___%
```

### Başarısız Testler:
1. ___
2. ___
3. ___

---

## 🔧 HATA AYIKLAMA

### Konsol Komutları:

```javascript
// Current step kontrol
console.log('Step:', app.currentStep, '/', app.totalSteps);

// Platforms kontrol
console.log('Platforms:', app.selectedPlatforms);

// Active jobs kontrol
console.log('Active Jobs:', app.activeJobs.size);
console.log('Jobs:', Array.from(app.activeJobs.keys()));

// Sidebar render
app.updateSidebar();
```

---

## ✅ BAŞARI KRİTERLERİ

- [ ] Tüm adımlarda doğru buton metni
- [ ] Platform seçimi çalışıyor
- [ ] Step 3'ten Step 4'e geçiliyor
- [ ] Sidebar'da işler görünüyor
- [ ] Konsol hatası yok

---

**Test tamamlandıktan sonra bu dosyayı doldur ve sonuçları paylaş!**
