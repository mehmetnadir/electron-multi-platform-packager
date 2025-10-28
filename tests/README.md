# Test Klasörü

Bu klasör tüm otomatik testleri içerir.

## Dosya Yapısı

```
tests/
├── README.md              # Bu dosya
├── test-index.js          # Ana test dosyası (14 test)
├── run-unit-tests.js      # Unit test runner
└── unit/                  # Unit testler (her fonksiyon için ayrı)
    ├── cache.test.js      # Cache testleri
    ├── publishers.test.js # Yayınevi testleri
    ├── logos.test.js      # Logo testleri
    ├── config.test.js     # Konfigürasyon testleri
    └── packaging.test.js  # Paketleme testleri
```

## Test Kategorileri

### 1. API Tests (4 test)
- Cache Headers Kontrolü
- Publishers API
- Logos API  
- Config Repository

### 2. Upload Tests (2 test)
- ZIP Upload
- Session Validation

### 3. Publisher Tests (3 test)
- Publisher Listesi
- Paketleme Adımında Yayınevi
- Yayınevi Seçimi

### 4. Logo Tests (3 test)
- Logo Listesi
- Logo Upload
- Logo Erişilebilirlik

### 5. Packaging Tests (2 test)
- Paketleme Kuyruğu
- Output Klasörü

## Kullanım

### Tüm Testler

```bash
# Tüm testleri çalıştır (14 test)
npm run test:all

# Hızlı test (7 test)
npm test
```

### Unit Testler (Her Fonksiyon Ayrı)

```bash
# Tüm unit testleri çalıştır (5 suite)
npm run test:unit

# Sadece cache testleri
npm run test:cache

# Sadece yayınevi testleri
npm run test:publishers

# Sadece logo testleri
npm run test:logos

# Sadece config testleri
npm run test:config

# Sadece paketleme testleri
npm run test:packaging
```

### Son Test Sonuçları

```
📊 TEST SONUÇLARI
============================================================
✅ Cache Tests (0.09s)
✅ Publishers Tests (0.04s)
✅ Logos Tests (0.04s)
✅ Config Tests (0.01s)
✅ Packaging Tests (0.00s)

Toplam: 5 test suite
✅ Başarılı: 5
❌ Başarısız: 0
⏱️  Toplam Süre: 0.19s
📈 Başarı Oranı: 100.0%
```

## Test Ekleme

Yeni test eklemek için `test-index.js` dosyasını düzenle:

```javascript
async testYeniOzellik() {
  return this.runTest('Yeni Özellik Testi', async () => {
    // Test kodunu buraya yaz
    const axios = require('axios');
    const response = await axios.get(`${this.baseUrl}/api/yeni-endpoint`);
    
    if (!response.data.success) {
      throw new Error('Test başarısız');
    }
  });
}
```

Sonra `runAllTests()` metoduna ekle:

```javascript
await this.runCategoryTests('Yeni Kategori', [
  () => this.testYeniOzellik()
]);
```

## Test Kuralları

1. ✅ Her test bağımsız olmalı
2. ✅ Testler hızlı çalışmalı (<1s)
3. ✅ Hata mesajları açıklayıcı olmalı
4. ✅ Test verileri temizlenmeli
5. ✅ Mock data kullan (gerçek veri değiştirme)

## CI/CD Entegrasyonu

Testler GitHub Actions ile otomatik çalıştırılabilir:

```yaml
- name: Run Tests
  run: npm run test:all
```

## Sorun Giderme

### Test Başarısız Olursa

1. Uygulama çalışıyor mu?
   ```bash
   curl http://localhost:3000/api/health
   ```

2. Port kullanımda mı?
   ```bash
   lsof -i :3000
   ```

3. Logları kontrol et
   - Server console
   - Test output

### Yaygın Hatalar

- **ECONNREFUSED**: Server çalışmıyor
- **Timeout**: Server yanıt vermiyor
- **404**: Endpoint bulunamadı
- **500**: Server hatası

## Katkıda Bulunma

Yeni özellik eklerken:
1. Test yaz
2. Testi çalıştır (başarısız olmalı)
3. Özelliği kodla
4. Testi tekrar çalıştır (başarılı olmalı)
5. Commit yap

## Lisans

MIT
