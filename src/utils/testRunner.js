const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

class TestRunner {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
    this.testResults = [];
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const emoji = {
      'info': 'ℹ️',
      'success': '✅',
      'error': '❌',
      'warning': '⚠️',
      'test': '🧪'
    }[type] || 'ℹ️';
    
    console.log(`${emoji} [${timestamp}] ${message}`);
  }

  async test(name, fn) {
    this.log(`Test başlatılıyor: ${name}`, 'test');
    try {
      await fn();
      this.testResults.push({ name, status: 'PASS', error: null });
      this.log(`✓ ${name}`, 'success');
      return true;
    } catch (error) {
      this.testResults.push({ name, status: 'FAIL', error: error.message });
      this.log(`✗ ${name}: ${error.message}`, 'error');
      return false;
    }
  }

  async testLogoUpload() {
    await this.test('Logo Yükleme Testi', async () => {
      // Test logosu oluştur (1x1 PNG)
      const testLogoPath = path.join(__dirname, '../../temp/test-logo.png');
      await fs.ensureDir(path.dirname(testLogoPath));
      
      // Minimal PNG (1x1 kırmızı pixel)
      const pngData = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
        0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
        0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D, 0xB4, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
      ]);
      
      await fs.writeFile(testLogoPath, pngData);
      
      // Logo yükle
      const form = new FormData();
      form.append('logo', fs.createReadStream(testLogoPath));
      form.append('kurumId', 'TEST_' + Date.now());
      form.append('kurumAdi', 'Test Logo ' + Date.now());
      
      const response = await axios.post(`${this.baseUrl}/api/logos`, form, {
        headers: form.getHeaders()
      });
      
      if (!response.data.success) {
        throw new Error('Logo yükleme başarısız');
      }
      
      const logoId = response.data.logo?.id || response.data.id || 'unknown';
      this.log(`Logo yüklendi: ${logoId}`, 'success');
      
      // Temizlik
      await fs.remove(testLogoPath);
      
      return response.data.logo;
    });
  }

  async testLogoList() {
    await this.test('Logo Listesi Testi', async () => {
      const response = await axios.get(`${this.baseUrl}/api/logos`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      if (!Array.isArray(response.data)) {
        throw new Error('Logo listesi array değil');
      }
      
      this.log(`${response.data.length} logo bulundu`, 'info');
      
      // Her logo için dosya kontrolü
      for (const logo of response.data) {
        if (!logo.id || !logo.fileName) {
          throw new Error(`Logo eksik bilgi: ${JSON.stringify(logo)}`);
        }
        this.log(`  - ${logo.kurumAdi} (${logo.fileName})`, 'info');
      }
      
      return response.data;
    });
  }

  async testPublisherList() {
    await this.test('Yayınevi Listesi Testi', async () => {
      const response = await axios.get(`${this.baseUrl}/api/publishers`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      if (!Array.isArray(response.data)) {
        throw new Error('Yayınevi listesi array değil');
      }
      
      this.log(`${response.data.length} yayınevi bulundu`, 'info');
      
      for (const publisher of response.data) {
        this.log(`  - ${publisher.name} (${publisher.id})`, 'info');
        if (publisher.isDefault) {
          this.log(`    → Varsayılan yayınevi`, 'info');
        }
      }
      
      return response.data;
    });
  }

  async testCacheHeaders() {
    await this.test('Cache Headers Testi', async () => {
      const endpoints = [
        '/api/logos',
        '/api/publishers',
        '/api/health'
      ];
      
      for (const endpoint of endpoints) {
        const response = await axios.get(`${this.baseUrl}${endpoint}`);
        const cacheControl = response.headers['cache-control'];
        
        if (!cacheControl || !cacheControl.includes('no-store')) {
          throw new Error(`${endpoint} cache header yok veya yanlış: ${cacheControl}`);
        }
        
        this.log(`  ✓ ${endpoint}: ${cacheControl}`, 'success');
      }
    });
  }

  async testLogoAccessibility() {
    await this.test('Logo Erişilebilirlik Testi', async () => {
      // Önce logo listesini al
      const logosResponse = await axios.get(`${this.baseUrl}/api/logos`);
      const logos = logosResponse.data;
      
      if (logos.length === 0) {
        this.log('Hiç logo yok, test atlanıyor', 'warning');
        return;
      }
      
      // İlk logoyu test et
      const testLogo = logos[0];
      const logoUrl = `${this.baseUrl}/logos/${testLogo.fileName}`;
      
      const response = await axios.get(logoUrl, {
        responseType: 'arraybuffer',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      
      if (response.status !== 200) {
        throw new Error(`Logo erişilemedi: ${response.status}`);
      }
      
      if (!response.data || response.data.length === 0) {
        throw new Error('Logo verisi boş');
      }
      
      this.log(`Logo erişilebilir: ${testLogo.fileName} (${response.data.length} bytes)`, 'success');
    });
  }

  async testConfigRepository() {
    await this.test('Konfigürasyon Deposu Testi', async () => {
      const response = await axios.get(`${this.baseUrl}/api/settings`);
      const settings = response.data;
      
      if (!settings.configRepository) {
        throw new Error('configRepository tanımlı değil');
      }
      
      this.log(`Config Repository: ${settings.configRepository}`, 'info');
      
      // Klasör varlığını kontrol et
      const repoInfo = await axios.get(`${this.baseUrl}/api/settings/repository-info`);
      
      if (!repoInfo.data.exists) {
        throw new Error('Config repository klasörü bulunamadı');
      }
      
      this.log(`  - Klasör var: ${repoInfo.data.path}`, 'success');
      this.log(`  - Dosya sayısı: ${repoInfo.data.fileCount}`, 'info');
    });
  }

  async testPublisherInPackagingStep() {
    await this.test('Paketleme Adımında Yayınevi Görünürlük Testi', async () => {
      // 1. Yayınevi listesini al
      const publishersResponse = await axios.get(`${this.baseUrl}/api/publishers`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      const publishers = publishersResponse.data;
      
      if (!Array.isArray(publishers) || publishers.length === 0) {
        throw new Error('❌ Yayınevi listesi boş! Önce yayınevi ekleyin.');
      }
      
      this.log(`✅ API'den ${publishers.length} yayınevi geldi`, 'success');
      
      // 2. Ana sayfa HTML'ini al ve yayınevi dropdown'unu kontrol et
      const indexResponse = await axios.get(`${this.baseUrl}/`);
      const html = indexResponse.data;
      
      // publisherSelect dropdown var mı?
      if (!html.includes('id="publisherSelect"')) {
        throw new Error('❌ publisherSelect dropdown HTML\'de bulunamadı!');
      }
      
      this.log('✅ publisherSelect dropdown HTML\'de mevcut', 'success');
      
      // 3. Cache header'ları kontrol et
      const cacheControl = publishersResponse.headers['cache-control'];
      if (!cacheControl || !cacheControl.includes('no-store')) {
        throw new Error(`❌ Publishers endpoint cache kullanıyor: ${cacheControl}`);
      }
      
      this.log('✅ Publishers endpoint cache kullanmıyor', 'success');
      
      // 4. Her yayınevi için detayları kontrol et
      for (const publisher of publishers) {
        if (!publisher.id || !publisher.name) {
          throw new Error(`❌ Yayınevi eksik bilgi: ${JSON.stringify(publisher)}`);
        }
        
        this.log(`  ✓ ${publisher.name} (ID: ${publisher.id})`, 'success');
        
        if (publisher.isDefault) {
          this.log(`    → Bu varsayılan yayınevi`, 'info');
        }
        
        if (publisher.logo) {
          this.log(`    → Logo: ${publisher.logo}`, 'info');
        }
      }
      
      // 5. JavaScript dosyasını kontrol et - loadPublishers fonksiyonu var mı?
      const appJsResponse = await axios.get(`${this.baseUrl}/app.js`);
      const appJs = appJsResponse.data;
      
      if (!appJs.includes('loadPublishers')) {
        throw new Error('❌ app.js\'de loadPublishers fonksiyonu bulunamadı!');
      }
      
      if (!appJs.includes('updatePublisherDropdown')) {
        throw new Error('❌ app.js\'de updatePublisherDropdown fonksiyonu bulunamadı!');
      }
      
      this.log('✅ JavaScript fonksiyonları mevcut', 'success');
      
      // 6. SORUN TANIMLAMA
      this.log('', 'info');
      this.log('🔍 MANUEL TEST ADIMLARI:', 'warning');
      this.log('  1. Uygulamayı aç ve ZIP yükle', 'info');
      this.log('  2. Paketleme sekmesine geç', 'info');
      this.log('  3. DevTools aç (Option+Cmd+I)', 'info');
      this.log('  4. Console\'da şunları ara:', 'info');
      this.log('     - "Yayınevleri yüklendi (CACHE YOK)"', 'info');
      this.log('     - "📋 Publisher dropdown güncelleniyor"', 'info');
      this.log('     - "⚠️ publisherSelect dropdown bulunamadı!"', 'info');
      this.log('  5. Eğer dropdown bulunamadı uyarısı varsa:', 'info');
      this.log('     → DOM henüz hazır değil, retry mekanizması çalışmalı', 'info');
      this.log('  6. Eğer hiç log yoksa:', 'info');
      this.log('     → loadPublishers() çağrılmıyor olabilir', 'info');
      
      return publishers;
    });
  }

  async runAllTests() {
    this.log('═══════════════════════════════════════', 'info');
    this.log('TEST SUITE BAŞLATILIYOR', 'test');
    this.log('═══════════════════════════════════════', 'info');
    
    const startTime = Date.now();
    
    // Testleri sırayla çalıştır
    await this.testCacheHeaders();
    await this.testConfigRepository();
    await this.testLogoList();
    await this.testPublisherList();
    await this.testPublisherInPackagingStep(); // YENİ TEST
    await this.testLogoAccessibility();
    await this.testLogoUpload();
    
    // Yeniden logo listesini kontrol et (yeni logo eklenmiş mi?)
    await this.testLogoList();
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    // Sonuçları özetle
    this.log('═══════════════════════════════════════', 'info');
    this.log('TEST SONUÇLARI', 'test');
    this.log('═══════════════════════════════════════', 'info');
    
    const passed = this.testResults.filter(r => r.status === 'PASS').length;
    const failed = this.testResults.filter(r => r.status === 'FAIL').length;
    
    this.testResults.forEach(result => {
      const icon = result.status === 'PASS' ? '✅' : '❌';
      this.log(`${icon} ${result.name}`, result.status === 'PASS' ? 'success' : 'error');
      if (result.error) {
        this.log(`   Hata: ${result.error}`, 'error');
      }
    });
    
    this.log('═══════════════════════════════════════', 'info');
    this.log(`Toplam: ${this.testResults.length} test`, 'info');
    this.log(`Başarılı: ${passed}`, 'success');
    this.log(`Başarısız: ${failed}`, failed > 0 ? 'error' : 'info');
    this.log(`Süre: ${duration}s`, 'info');
    this.log('═══════════════════════════════════════', 'info');
    
    return {
      total: this.testResults.length,
      passed,
      failed,
      duration,
      results: this.testResults
    };
  }
}

module.exports = TestRunner;
