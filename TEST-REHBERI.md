# Test Rehberi - Electron Paketleyici

## 🎯 Test Stratejisi

Her kod değişikliği için:
1. ✅ Küçük, odaklanmış testler yaz
2. ✅ Testi önce çalıştır (kırmızı)
3. ✅ Kodu yaz (yeşil)
4. ✅ Refactor yap (temiz)
5. ✅ Test sonuçlarını kaydet

## 📋 Test Index

`tests/test-index.js` - Tüm testlerin merkezi yönetim dosyası

### Test Kategorileri:

#### 1. API Tests
- Cache Headers Kontrolü
- Publishers API
- Logos API
- Config Repository

#### 2. Upload Tests
- ZIP Upload
- Session Validation

#### 3. Publisher Tests
- Publisher Listesi
- Paketleme Adımında Yayınevi
- Yayınevi Seçimi

#### 4. Logo Tests
- Logo Listesi
- Logo Upload
- Logo Erişilebilirlik

#### 5. Packaging Tests
- Paketleme Kuyruğu
- Output Klasörü

## Otomatik Test Suite

Uygulama için otomatik test suite oluşturuldu. Testler şunları kontrol eder:

### Test Edilen Özellikler

1. **Cache Headers Testi** ✅
   - Tüm API endpoint'lerinde cache header'ları kontrol eder
   - `no-store, no-cache` olduğunu doğrular

2. **Konfigürasyon Deposu Testi** ✅
   - Config repository yolunun doğru olduğunu kontrol eder
   - Klasörün var olduğunu doğrular
   - Dosya sayısını raporlar

3. **Logo Listesi Testi** ✅
   - `/api/logos` endpoint'inden logo listesini alır
   - Her logonun gerekli bilgilere sahip olduğunu kontrol eder
   - Logo sayısını raporlar

4. **Yayınevi Listesi Testi** ✅
   - `/api/publishers` endpoint'inden yayınevi listesini alır
   - Varsayılan yayınevini tespit eder
   - Yayınevi sayısını raporlar

5. **Logo Erişilebilirlik Testi** ✅
   - Logo dosyalarının HTTP üzerinden erişilebilir olduğunu kontrol eder
   - Dosya boyutunu raporlar

6. **Logo Yükleme Testi** ✅
   - Test logosu oluşturur (1x1 PNG)
   - Logo yükleme API'sini test eder
   - Yüklenen logoyu listede kontrol eder

## Test Çalıştırma

### Ön Koşullar
Uygulama çalışıyor olmalı:
```bash
npm run electron
```

### Test Komutları

#### Tüm Testleri Çalıştır
```bash
npm run test:all
```
14 kategoride tüm testleri çalıştırır (API, Upload, Publisher, Logo, Packaging)

#### Hızlı Test
```bash
npm run test:quick
# veya
npm test
```
Temel API ve özellik testlerini çalıştırır (7 test)

#### Tek Kategori Test
```bash
node tests/test-index.js
```

### Son Test Sonuçları (27 Ekim 2025)

```
🧪 ═══════════════════════════════════════
📋 ELECTRON PAKETLEYICI - TEST INDEX
═══════════════════════════════════════

📂 API Tests
  ✅ Cache Headers Kontrolü
  ✅ Publishers API
  ✅ Logos API
  ✅ Config Repository

📂 Upload Tests
  ✅ ZIP Upload
  ⚠️  Session Validation (geliştirme aşamasında)

📂 Publisher Tests
  ✅ Publisher Listesi
  ✅ Paketleme Adımında Yayınevi
  ✅ Yayınevi Seçimi

📂 Logo Tests
  ✅ Logo Listesi
  ✅ Logo Upload
  ✅ Logo Erişilebilirlik

📂 Packaging Tests
  ✅ Paketleme Kuyruğu
  ✅ Output Klasörü

═══════════════════════════════════════
📊 TEST SONUÇLARI
═══════════════════════════════════════
Toplam Test: 14
✅ Başarılı: 13
❌ Başarısız: 1
⏱️  Süre: 0.17s
📈 Başarı Oranı: 92.9%
═══════════════════════════════════════
```

### Beklenen Çıktı (Hızlı Test)
```
🚀 Electron Paketleyici Test Suite

═══════════════════════════════════════
TEST SUITE BAŞLATILIYOR
═══════════════════════════════════════
🧪 Test başlatılıyor: Cache Headers Testi
✅ ✓ Cache Headers Testi
🧪 Test başlatılıyor: Konfigürasyon Deposu Testi
✅ ✓ Konfigürasyon Deposu Testi
🧪 Test başlatılıyor: Logo Listesi Testi
ℹ️ 2 logo bulundu
✅ ✓ Logo Listesi Testi
🧪 Test başlatılıyor: Yayınevi Listesi Testi
ℹ️ 1 yayınevi bulundu
✅ ✓ Yayınevi Listesi Testi
🧪 Test başlatılıyor: Logo Erişilebilirlik Testi
✅ ✓ Logo Erişilebilirlik Testi
🧪 Test başlatılıyor: Logo Yükleme Testi
✅ ✓ Logo Yükleme Testi
🧪 Test başlatılıyor: Logo Listesi Testi
ℹ️ 3 logo bulundu
✅ ✓ Logo Listesi Testi
═══════════════════════════════════════
TEST SONUÇLARI
═══════════════════════════════════════
✅ Cache Headers Testi
✅ Konfigürasyon Deposu Testi
✅ Logo Listesi Testi
✅ Yayınevi Listesi Testi
✅ Logo Erişilebilirlik Testi
✅ Logo Yükleme Testi
✅ Logo Listesi Testi
═══════════════════════════════════════
Toplam: 7 test
Başarılı: 7
Başarısız: 0
Süre: 0.13s
═══════════════════════════════════════
```

## Test Sonuçları

### ✅ Doğrulanan Özellikler

1. **Cache Yok** - Tüm endpoint'lerde cache devre dışı
2. **Konfigürasyon Deposu** - Google Drive'da doğru konumda
3. **Logo Yönetimi** - Logolar eklenebiliyor ve listeleniyor
4. **Yayınevi Yönetimi** - Yayınevleri doğru çalışıyor
5. **Logo Erişimi** - Logo dosyaları HTTP üzerinden erişilebilir
6. **Logo Upload** - Yeni logo ekleme çalışıyor

## Manuel Test Adımları

### Logo Ekleme ve Görünürlük Testi

1. **Uygulamayı Başlat**
   ```bash
   npm run electron
   ```

2. **Logo Ekle**
   - "Logo Yönetimi" sekmesine git
   - "Yeni Logo Ekle" butonuna tıkla
   - Bir logo seç ve yükle

3. **2. Adımda Kontrol Et**
   - ZIP yükle
   - "Paketleme" sekmesine geç
   - Logo dropdown'unda yeni eklediğin logoyu gör

4. **Cache Kontrolü**
   - Sayfayı yenile (F5)
   - Logo hala görünüyor mu?
   - Yeni logo ekle
   - Dropdown otomatik güncelleniyor mu?

### Yayınevi Ekleme ve Görünürlük Testi

1. **Yayınevi Ekle**
   - "Ayarlar" → "Yayınevi Yönetimi"
   - "Yeni Yayınevi Ekle"
   - Bilgileri doldur ve kaydet

2. **Paketleme Sekmesinde Kontrol Et**
   - Ana sayfaya dön
   - ZIP yükle
   - "Paketleme" sekmesine geç
   - Yayınevi dropdown'unda yeni yayınevini gör

3. **Cache Kontrolü**
   - Sayfayı yenile
   - Yayınevi hala görünüyor mu?

### Otomatik Buton Testi (27 Ekim 2025)

**Test Butonu Eklendi:** Aktif İşlemler menüsünde "🧪 Test" butonu

1. **Test Çalıştırma**
   - Sağ üstteki "Aktif İşlemler" (🔔) butonuna tıkla
   - "🧪 Test" butonuna tıkla
   - F12 ile Console'u aç ve sonuçları gör

2. **Test Edilen Butonlar**
   - ✅ **Klasörde Göster**: BAŞARILI
     - Console: `📁 Klasör açılıyor: [yol]`
     - Console: `✅ Klasör açıldı: [yol]`
     - Finder/Explorer açılıyor
   
   - ✅ **Detay Göster**: BAŞARILI
     - Modal 2 saniye sonra açılıyor
     - İş detayları gösteriliyor
   
   - ⏳ **İptal Et**: Manuel test gerekli
   - ⏳ **Yeniden İşle**: Manuel test gerekli
   - ⏳ **Sil**: Manuel test gerekli

3. **Test Sonuçları (27 Ekim 2025)**
   ```
   🧪 ===== BUTON TESTLERİ BAŞLIYOR =====
   
   1️⃣ API KONTROLÜ:
     ✅ electronAPI: Mevcut
     ✅ openFolder: function
   
   2️⃣ AKTİF İŞLER:
     Toplam: 1
   
   3️⃣ TAMAMLANAN İŞLER:
     Toplam: 8
     0: Features Test - ✅ Path var
     1: Quick Test - ✅ Path var
     ...
   
   4️⃣ KLASÖRDE GÖSTER TESTİ:
     Test ediliyor: Features Test
     Path: /Users/nadir/Library/CloudStorage/.../Features Test_1.0.0_2025-10-27
     📁 Klasör açılıyor: [yol]
     ✅ Klasör açıldı: [yol]
   
   5️⃣ DETAY GÖSTER TESTİ:
     İlk işin detayı gösteriliyor...
   
   🧪 ===== TEST TAMAMLANDI =====
   
   📊 SONUÇ:
     ✅ Klasörde Göster: Test edildi
     ✅ Detay Göster: 2 saniye sonra açılacak
     ℹ️ Diğer butonlar (İptal, Yeniden İşle): Manuel test gerekli
   ```

### Manuel Buton Testleri

**İptal Et Butonu:**
- Bir paketleme başlat
- "İptal Et" butonuna tıkla
- Console: `❌ İş iptal ediliyor: [jobId]`
- Toast: "İş iptal edildi"

**Yeniden İşle Butonu:**
- İptal edilmiş bir işte "Yeniden İşle" butonuna tıkla
- Console: `🔄 İş yeniden başlatılıyor: [jobId]`
- Toast: "İş yeniden başlatıldı"

**Sil Butonu:**
- Tamamlanan bir işte "Sil" butonuna tıkla
- Console: `🗑️ İş siliniyor: [index]`
- İş listeden silinir

## Sorun Giderme

### Test Başarısız Olursa

1. **Uygulama Çalışıyor mu?**
   ```bash
   curl http://localhost:3000/api/health
   ```

2. **Port Kullanımda mı?**
   ```bash
   lsof -i :3000
   ```

3. **Konfigürasyon Deposu Var mı?**
   - Ayarlar → Depo Konumu
   - Klasörün var olduğunu kontrol et

4. **Logları Kontrol Et**
   - Electron penceresinde F12 (DevTools)
   - Console'da hata var mı?

## Test Dosyaları

- `src/utils/testRunner.js` - Test suite ana dosyası
- `test-app.js` - Test runner script
- `package.json` - `npm test` komutu

## Yeni Test Ekleme

`src/utils/testRunner.js` dosyasına yeni test metodu ekle:

```javascript
async testYeniOzellik() {
  await this.test('Yeni Özellik Testi', async () => {
    // Test kodunu buraya yaz
    const response = await axios.get(`${this.baseUrl}/api/yeni-endpoint`);
    
    if (!response.data.success) {
      throw new Error('Test başarısız');
    }
    
    this.log('Test başarılı', 'success');
  });
}
```

Sonra `runAllTests()` metoduna ekle:
```javascript
await this.testYeniOzellik();
```
