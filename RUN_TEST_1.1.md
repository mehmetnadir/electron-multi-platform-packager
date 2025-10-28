# 🧪 TEST 1.1: Yayınevi Listesi API

## Hazırlık

### 1. Book Update API'yi Çalıştır
```bash
# Terminal 1
cd /Users/nadir/01dev/book-update
pnpm dev
```

**Beklenen Çıktı:**
```
✅ API started on port 3001
✅ Database connected
✅ Routes registered
```

---

## Test Adımları

### Test 1: Book Update API'den Direkt Test

```bash
# Terminal 2
cd /Users/nadir/01dev/book-update
chmod +x test-publishers-list-api.sh
./test-publishers-list-api.sh
```

**Beklenen Çıktı:**
```
🧪 TEST 1.1: Yayınevi Listesi API
==================================

Test 1: Basic GET request
-------------------------
HTTP Status: 200
Response:
{
  "success": true,
  "publishers": [
    {
      "id": "...",
      "name": "...",
      "domain": "...",
      "slug": "...",
      "description": "..."
    }
  ]
}

Test 2: Response Structure Validation
-------------------------------------
✅ 'success' field exists: true
✅ 'publishers' array exists: X items

Test 3: Publisher Fields Validation
-----------------------------------
First publisher:
{
  "id": "...",
  "name": "...",
  "domain": "...",
  "slug": "...",
  "description": "..."
}
✅ Field 'id': ...
✅ Field 'name': ...
✅ Field 'domain': ...
✅ Field 'slug': ...
✅ Field 'description': ...

Test 4: Performance Test
-----------------------
Response time: XXXms
✅ Performance OK (< 1s)

📊 TEST SUMMARY
===============
✅ All tests passed!
   - HTTP Status: 200
   - Publishers found: X
   - Response time: XXXms
```

**Kontrol Listesi:**
- [ ] HTTP Status: 200
- [ ] success: true
- [ ] publishers array dolu
- [ ] Tüm fieldlar mevcut
- [ ] Response time < 1s

---

### Test 2: Electron Packager'dan Test

```bash
# Terminal 3
cd /Users/nadir/01dev/elecron-paket
node test-publishers-api.js
```

**Beklenen Çıktı:**
```
🧪 TEST 1.1: Yayınevi Listesi API (Electron Packager)
====================================================

Test 1: Basic GET request
-------------------------
📡 URL: https://akillitahta.ndr.ist/api/v1/publishers
✅ HTTP Status: 200
⏱️  Response time: XXXms

Test 2: Response Structure Validation
-------------------------------------
✅ success field: true
✅ publishers array: X items

Test 3: Publisher Fields Validation
-----------------------------------
First publisher:
{
  "id": "...",
  "name": "...",
  "domain": "...",
  "slug": "...",
  "description": "..."
}
✅ Field 'id': ...
✅ Field 'name': ...
✅ Field 'domain': ...
✅ Field 'slug': ...
✅ Field 'description': ...

Test 4: Data Usability Test
---------------------------
Dropdown options:
  1. Publisher Name (ID: xxx)
  2. Publisher Name (ID: xxx)
  ...

📊 TEST SUMMARY
===============
✅ All tests passed!
   - HTTP Status: 200
   - Publishers found: X
   - Response time: XXXms
   - All fields present: Yes
```

**Kontrol Listesi:**
- [ ] HTTP Status: 200
- [ ] Tüm fieldlar mevcut
- [ ] Dropdown formatı doğru
- [ ] Response time < 1s

---

### Test 3: Tarayıcı Konsolu Testi

```bash
# Terminal 4 - Electron Packager'ı başlat
cd /Users/nadir/01dev/elecron-paket
npm start
```

**Tarayıcıda:**
1. `http://localhost:3000/publishers` sayfasını aç
2. F12 ile Developer Tools'u aç
3. Console sekmesine git
4. Network sekmesine git

**Kontrol Listesi:**

#### Console:
- [ ] Hata yok
- [ ] "Yayınevleri yüklendi" mesajı var
- [ ] Yayınevi sayısı doğru

#### Network:
- [ ] `/api/akillitahta/publishers` isteği başarılı
- [ ] Status: 200
- [ ] Response time < 1s
- [ ] Response body doğru format

#### UI:
- [ ] Yayınevi dropdown'u doluyor
- [ ] Yayınevi isimleri görünüyor
- [ ] Seçim yapılabiliyor

---

## Hata Senaryoları

### Senaryo 1: API Çalışmıyor
**Hata:**
```
❌ connect ECONNREFUSED 127.0.0.1:3001
```

**Çözüm:**
```bash
cd /Users/nadir/01dev/book-update
pnpm dev
```

---

### Senaryo 2: Database Bağlantı Hatası
**Hata:**
```
❌ Database connection failed
```

**Çözüm:**
```bash
# MySQL'in çalıştığını kontrol et
mysql -u root -p -e "SELECT 1"

# Database'in var olduğunu kontrol et
mysql -u root -p -e "SHOW DATABASES LIKE 'book_update'"
```

---

### Senaryo 3: CORS Hatası
**Hata (Tarayıcı Console):**
```
Access to XMLHttpRequest blocked by CORS policy
```

**Çözüm:**
- Book Update API'de CORS ayarlarını kontrol et
- `services/api/src/index.ts` dosyasında CORS enabled olmalı

---

### Senaryo 4: Boş Liste
**Hata:**
```
✅ publishers array: 0 items
```

**Çözüm:**
```bash
# Database'de yayınevi var mı kontrol et
mysql -u root -p book_update -e "SELECT * FROM publishers"

# Yoksa ekle
mysql -u root -p book_update -e "
INSERT INTO publishers (id, name, domain, created_at, updated_at) 
VALUES 
  (UUID(), 'DijiTap', 'dijitap.com', NOW(), NOW()),
  (UUID(), 'YDS Publishing', 'ydspublishing.com', NOW(), NOW())
"
```

---

## Başarı Kriterleri

### ✅ Test 1.1 Başarılı Sayılır Eğer:

1. **API Yanıt Veriyor:**
   - HTTP Status: 200
   - Response time < 1 saniye

2. **Veri Yapısı Doğru:**
   - `success: true`
   - `publishers` array mevcut
   - En az 1 yayınevi var

3. **Field'lar Tam:**
   - `id` (UUID)
   - `name` (string)
   - `domain` (string)
   - `slug` (string)
   - `description` (string)

4. **Electron Packager Entegrasyonu:**
   - API'den veri çekebiliyor
   - Dropdown'da gösterebiliyor
   - Konsol hatası yok

---

## Sonraki Adım

Test 1.1 başarılı olduktan sonra → **Test 1.2: Kitap Listesi API**

```bash
# Test 1.2'ye geç
cat INTEGRATION_STEP_BY_STEP.md | grep -A 100 "1.2 Kitap Listesi"
```
