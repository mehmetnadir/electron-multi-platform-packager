# 🚀 Entegrasyon - Adım Adım İmplementasyon

## 📍 Mevcut Durum
- ✅ Yayınevi eşleştirme UI hazır
- ✅ Linux paketleme API çalışıyor
- ⏳ Book Update API entegrasyonu bekleniyor

---

## ADIM 1: Book Update API - Yeni Endpoint'ler

### 1.1 Yayınevi Listesi Endpoint'i
**Dosya:** `/Users/nadir/01dev/book-update/services/api/src/routes/public/publishers-list.ts`

```typescript
import { FastifyPluginAsync } from 'fastify';
import { publisherService } from '../../services/mysql/publisher';

const publishersListRoutes: FastifyPluginAsync = async (fastify) => {
  // Tüm yayınevlerini listele (public)
  fastify.get('/publishers', async (request, reply) => {
    try {
      const publishers = await publisherService.getAllPublishers();
      
      return {
        success: true,
        publishers: publishers.map(pub => ({
          id: pub.id,
          name: pub.name,
          slug: pub.slug,
          logo: pub.logo_url,
          description: pub.description
        }))
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Yayınevleri getirilemedi'
      });
    }
  });
};

export default publishersListRoutes;
```

**Test:**
```bash
curl https://akillitahta.ndr.ist/api/v1/publishers
```

**Beklenen Sonuç:**
```json
{
  "success": true,
  "publishers": [
    {
      "id": "1",
      "name": "DijiTap",
      "slug": "dijitap",
      "logo": "https://...",
      "description": "..."
    }
  ]
}
```

---

### 1.2 Kitap Listesi Endpoint'i (Yayınevine Göre)
**Dosya:** `/Users/nadir/01dev/book-update/services/api/src/routes/public/publisher-books.ts`

```typescript
import { FastifyPluginAsync } from 'fastify';
import { bookService } from '../../services/mysql/book';

interface QueryParams {
  grade?: string;
  subject?: string;
  bookType?: string;
}

const publisherBooksRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { publisherId: string }; Querystring: QueryParams }>(
    '/publishers/:publisherId/books',
    async (request, reply) => {
      try {
        const { publisherId } = request.params;
        const { grade, subject, bookType } = request.query;

        const books = await bookService.getBooksByPublisher(publisherId, {
          grade,
          subject,
          bookType
        });

        return {
          success: true,
          books: books.map(book => ({
            id: book.id,
            title: book.title,
            grade: book.grade,
            subject: book.subject,
            bookType: book.book_type,
            platforms: {
              windows: book.windows_url ? {
                url: book.windows_url,
                version: book.windows_version
              } : null,
              macos: book.macos_url ? {
                url: book.macos_url,
                version: book.macos_version
              } : null,
              pardus: book.pardus_url ? {
                url: book.pardus_url,
                version: book.pardus_version
              } : null,
              web: book.web_url ? {
                url: book.web_url,
                version: book.web_version
              } : null
            },
            source: book.source || 'auto_pipeline'
          }))
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Kitaplar getirilemedi'
        });
      }
    }
  );
};

export default publisherBooksRoutes;
```

**Test:**
```bash
curl "https://akillitahta.ndr.ist/api/v1/publishers/1/books?grade=5&subject=Matematik"
```

---

### 1.3 Yeni Kitap Oluşturma Endpoint'i
**Dosya:** `/Users/nadir/01dev/book-update/services/api/src/routes/private/create-book.ts`

```typescript
import { FastifyPluginAsync } from 'fastify';
import { bookService } from '../../services/mysql/book';
import { r2Service } from '../../services/r2/upload';

interface CreateBookBody {
  publisherId: string;
  title: string;
  grade: string;
  subject: string;
  bookType: string;
  source: 'manual_upload';
}

const createBookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: CreateBookBody }>(
    '/books',
    {
      preHandler: fastify.auth([fastify.verifyJWT]) // Auth gerekli
    },
    async (request, reply) => {
      try {
        const bookData = request.body;

        // Yeni kitap kaydı oluştur
        const book = await bookService.createBook({
          ...bookData,
          source: 'manual_upload',
          uploaded_from: 'Electron Packager',
          created_by: request.user.id
        });

        // R2 upload URL'leri oluştur (presigned URLs)
        const uploadUrls = await r2Service.generateUploadUrls(book.id, {
          windows: true,
          macos: true,
          pardus: true,
          web: true
        });

        return {
          success: true,
          bookId: book.id,
          uploadUrls
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Kitap oluşturulamadı'
        });
      }
    }
  );
};

export default createBookRoutes;
```

**Test:**
```bash
curl -X POST https://akillitahta.ndr.ist/api/v1/books \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "publisherId": "1",
    "title": "Test Kitap",
    "grade": "5",
    "subject": "Matematik",
    "bookType": "Ders Kitabı",
    "source": "manual_upload"
  }'
```

---

### 1.4 Paket Yükleme Endpoint'i
**Dosya:** `/Users/nadir/01dev/book-update/services/api/src/routes/private/upload-package.ts`

```typescript
import { FastifyPluginAsync } from 'fastify';
import { bookService } from '../../services/mysql/book';
import { r2Service } from '../../services/r2/upload';

interface UploadPackageBody {
  platform: 'windows' | 'macos' | 'pardus' | 'web';
  version: string;
}

const uploadPackageRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ 
    Params: { bookId: string }; 
    Body: UploadPackageBody 
  }>(
    '/books/:bookId/upload-package',
    {
      preHandler: fastify.auth([fastify.verifyJWT])
    },
    async (request, reply) => {
      try {
        const { bookId } = request.params;
        const { platform, version } = request.body;

        // Multipart file upload
        const data = await request.file();
        if (!data) {
          return reply.status(400).send({
            success: false,
            error: 'Dosya bulunamadı'
          });
        }

        // R2'ye yükle
        const uploadResult = await r2Service.uploadPackage({
          bookId,
          platform,
          version,
          file: data.file,
          filename: data.filename,
          mimetype: data.mimetype
        });

        // Veritabanını güncelle
        await bookService.updatePlatformUrl(bookId, platform, {
          url: uploadResult.url,
          version,
          size: uploadResult.size,
          checksum: uploadResult.checksum
        });

        // book_packages tablosuna kaydet
        await bookService.createPackageRecord({
          bookId,
          platform,
          version,
          fileUrl: uploadResult.url,
          fileSize: uploadResult.size,
          checksum: uploadResult.checksum,
          uploadedBy: request.user.id,
          source: 'manual_upload'
        });

        return {
          success: true,
          url: uploadResult.url,
          size: uploadResult.size,
          platform,
          version
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Paket yüklenemedi'
        });
      }
    }
  );
};

export default uploadPackageRoutes;
```

**Test:**
```bash
curl -X POST https://akillitahta.ndr.ist/api/v1/books/123/upload-package \
  -H "Authorization: Bearer TOKEN" \
  -F "platform=windows" \
  -F "version=1.0.0" \
  -F "file=@package.exe"
```

---

## ADIM 2: Veritabanı Migration'ları

### 2.1 books Tablosu Güncellemesi
**Dosya:** `/Users/nadir/01dev/book-update/database/migrations/001_add_source_to_books.sql`

```sql
-- books tablosuna source alanı ekle
ALTER TABLE books 
ADD COLUMN source ENUM('auto_pipeline', 'manual_upload') 
DEFAULT 'auto_pipeline' 
AFTER updated_at;

-- Yükleyen bilgisi
ALTER TABLE books 
ADD COLUMN uploaded_from VARCHAR(255) NULL 
COMMENT 'Electron Packager version' 
AFTER source;

-- Son manuel yükleme zamanı
ALTER TABLE books 
ADD COLUMN last_manual_upload_at TIMESTAMP NULL 
AFTER uploaded_from;

-- Index ekle
CREATE INDEX idx_books_source ON books(source);
```

**Test:**
```bash
cd /Users/nadir/01dev/book-update
mysql -u root -p book_update < database/migrations/001_add_source_to_books.sql
```

---

### 2.2 book_packages Tablosu Oluşturma
**Dosya:** `/Users/nadir/01dev/book-update/database/migrations/002_create_book_packages.sql`

```sql
CREATE TABLE IF NOT EXISTS book_packages (
  id INT PRIMARY KEY AUTO_INCREMENT,
  book_id INT NOT NULL,
  platform ENUM('windows', 'macos', 'pardus', 'web', 'android', 'ios') NOT NULL,
  version VARCHAR(50) NOT NULL,
  file_url TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  checksum VARCHAR(64) NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  uploaded_by INT NULL,
  source ENUM('auto_pipeline', 'manual_upload') DEFAULT 'manual_upload',
  
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
  
  INDEX idx_book_platform (book_id, platform),
  INDEX idx_version (version),
  INDEX idx_uploaded_at (uploaded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Test:**
```bash
mysql -u root -p book_update < database/migrations/002_create_book_packages.sql
```

---

## ADIM 3: Electron Paketleyici - API Client

### 3.1 Book Update API Client
**Dosya:** `/Users/nadir/01dev/elecron-paket/src/services/bookUpdateApiClient.js`

```javascript
const axios = require('axios');

class BookUpdateApiClient {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl || process.env.BOOK_UPDATE_API_URL || 'https://akillitahta.ndr.ist/api/v1';
    this.apiKey = apiKey;
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
      }
    });
  }

  // Yayınevi listesi
  async getPublishers() {
    try {
      const response = await this.client.get('/publishers');
      return response.data;
    } catch (error) {
      console.error('Yayınevleri getirilemedi:', error.message);
      throw error;
    }
  }

  // Kitap listesi (yayınevine göre)
  async getPublisherBooks(publisherId, filters = {}) {
    try {
      const params = new URLSearchParams();
      if (filters.grade) params.append('grade', filters.grade);
      if (filters.subject) params.append('subject', filters.subject);
      if (filters.bookType) params.append('bookType', filters.bookType);

      const response = await this.client.get(
        `/publishers/${publisherId}/books?${params.toString()}`
      );
      return response.data;
    } catch (error) {
      console.error('Kitaplar getirilemedi:', error.message);
      throw error;
    }
  }

  // Yeni kitap oluştur
  async createBook(bookData) {
    try {
      const response = await this.client.post('/books', bookData);
      return response.data;
    } catch (error) {
      console.error('Kitap oluşturulamadı:', error.message);
      throw error;
    }
  }

  // Paket yükle
  async uploadPackage(bookId, platform, version, filePath) {
    try {
      const FormData = require('form-data');
      const fs = require('fs');
      
      const form = new FormData();
      form.append('platform', platform);
      form.append('version', version);
      form.append('file', fs.createReadStream(filePath));

      const response = await this.client.post(
        `/books/${bookId}/upload-package`,
        form,
        {
          headers: form.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );
      
      return response.data;
    } catch (error) {
      console.error('Paket yüklenemedi:', error.message);
      throw error;
    }
  }
}

module.exports = BookUpdateApiClient;
```

**Test:**
```javascript
// test-book-update-api.js
const BookUpdateApiClient = require('./src/services/bookUpdateApiClient');

async function test() {
  const client = new BookUpdateApiClient();
  
  // Test 1: Yayınevi listesi
  console.log('Test 1: Yayınevi listesi');
  const publishers = await client.getPublishers();
  console.log('✅ Yayınevleri:', publishers.publishers.length);
  
  // Test 2: Kitap listesi
  console.log('\nTest 2: Kitap listesi');
  const books = await client.getPublisherBooks('1', { grade: '5' });
  console.log('✅ Kitaplar:', books.books.length);
}

test().catch(console.error);
```

**Çalıştır:**
```bash
cd /Users/nadir/01dev/elecron-paket
node test-book-update-api.js
```

---

## ADIM 4: Electron Paketleyici - Kitap Yönetimi UI

### 4.1 Kitap Yönetimi Sayfası
**Dosya:** `/Users/nadir/01dev/elecron-paket/src/client/books.html`

```html
<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kitap Yönetimi</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        /* Stil kodları buraya gelecek */
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📚 Kitap Yönetimi</h1>
            <a href="/" class="back-button">← Ana Sayfa</a>
        </div>

        <div class="toolbar">
            <div class="publisher-select">
                <label>Yayınevi:</label>
                <select id="publisherSelect">
                    <option value="">Yükleniyor...</option>
                </select>
            </div>
            <button class="btn btn-primary" onclick="showNewBookModal()">
                <i class="fas fa-plus"></i> Yeni Kitap
            </button>
        </div>

        <div class="filters">
            <select id="gradeFilter">
                <option value="">Tüm Sınıflar</option>
            </select>
            <select id="subjectFilter">
                <option value="">Tüm Dersler</option>
            </select>
            <select id="typeFilter">
                <option value="">Tüm Türler</option>
            </select>
        </div>

        <div id="booksList" class="books-list">
            <!-- Kitaplar buraya gelecek -->
        </div>
    </div>

    <script>
        let currentPublisherId = null;
        let books = [];

        // Sayfa yüklendiğinde
        window.addEventListener('DOMContentLoaded', async () => {
            await loadPublishers();
        });

        // Yayınevlerini yükle
        async function loadPublishers() {
            try {
                const response = await fetch('/api/akillitahta/publishers');
                const data = await response.json();
                
                const select = document.getElementById('publisherSelect');
                select.innerHTML = '<option value="">Seçiniz...</option>';
                
                data.publishers.forEach(pub => {
                    const option = document.createElement('option');
                    option.value = pub.id;
                    option.textContent = pub.name;
                    select.appendChild(option);
                });

                select.addEventListener('change', (e) => {
                    currentPublisherId = e.target.value;
                    if (currentPublisherId) {
                        loadBooks();
                    }
                });
            } catch (error) {
                console.error('Yayınevleri yüklenemedi:', error);
                alert('Yayınevleri yüklenemedi!');
            }
        }

        // Kitapları yükle
        async function loadBooks() {
            if (!currentPublisherId) return;

            try {
                const grade = document.getElementById('gradeFilter').value;
                const subject = document.getElementById('subjectFilter').value;
                const type = document.getElementById('typeFilter').value;

                const params = new URLSearchParams();
                if (grade) params.append('grade', grade);
                if (subject) params.append('subject', subject);
                if (type) params.append('bookType', type);

                const response = await fetch(
                    `/api/publishers/${currentPublisherId}/books?${params.toString()}`
                );
                const data = await response.json();
                
                books = data.books;
                renderBooks();
            } catch (error) {
                console.error('Kitaplar yüklenemedi:', error);
                alert('Kitaplar yüklenemedi!');
            }
        }

        // Kitapları render et
        function renderBooks() {
            const container = document.getElementById('booksList');
            
            if (books.length === 0) {
                container.innerHTML = '<p class="no-books">Kitap bulunamadı</p>';
                return;
            }

            container.innerHTML = books.map(book => `
                <div class="book-card">
                    <div class="book-title">${book.title}</div>
                    <div class="book-info">
                        <span>Sınıf: ${book.grade}</span>
                        <span>Ders: ${book.subject}</span>
                    </div>
                    <div class="book-platforms">
                        ${book.platforms.windows ? '🪟' : ''}
                        ${book.platforms.macos ? '🍎' : ''}
                        ${book.platforms.pardus ? '🐧' : ''}
                        ${book.platforms.web ? '🌐' : ''}
                    </div>
                    <div class="book-actions">
                        <button class="btn btn-primary" onclick="packageBook('${book.id}')">
                            <i class="fas fa-box"></i> Paketle
                        </button>
                        <button class="btn btn-info" onclick="viewBook('${book.id}')">
                            <i class="fas fa-info-circle"></i> Detay
                        </button>
                    </div>
                </div>
            `).join('');
        }

        // Kitap paketleme sayfasına git
        function packageBook(bookId) {
            window.location.href = `/books/${bookId}/package`;
        }

        // Kitap detaylarını göster
        function viewBook(bookId) {
            const book = books.find(b => b.id === bookId);
            alert(JSON.stringify(book, null, 2));
        }

        // Yeni kitap modal'ı
        function showNewBookModal() {
            alert('Yeni kitap ekleme özelliği yakında!');
        }
    </script>
</body>
</html>
```

---

## TEST PLANI - ADIM 1

### Test 1.1: Yayınevi Listesi API
```bash
# Terminal 1: Book Update API'yi çalıştır
cd /Users/nadir/01dev/book-update
pnpm dev

# Terminal 2: Test et
curl https://akillitahta.ndr.ist/api/v1/publishers | jq
```

**Beklenen:** Yayınevi listesi JSON formatında

### Test 1.2: Electron Packager'dan API Çağrısı
```bash
cd /Users/nadir/01dev/elecron-paket
node test-book-update-api.js
```

**Beklenen:** Yayınevi sayısı konsola yazılır

### Test 1.3: Kitap Yönetimi Sayfası
```bash
# Electron Packager'ı çalıştır
cd /Users/nadir/01dev/elecron-paket
npm start

# Tarayıcıda aç
http://localhost:3000/books
```

**Kontrol Listesi:**
- [ ] Yayınevi dropdown'u doluyor mu?
- [ ] Yayınevi seçildiğinde kitaplar yükleniyor mu?
- [ ] Filtreler çalışıyor mu?
- [ ] Tarayıcı konsolunda hata var mı?

---

## Sonraki Adımlar

1. ✅ ADIM 1 tamamlandıktan sonra → ADIM 2'ye geç
2. Her adımda testleri çalıştır
3. Hataları kaydet ve düzelt
4. Başarılı testleri işaretle

**Hazır mısın? İlk adımı atalım! 🚀**
