#!/usr/bin/env node

/**
 * TEST INDEX - Tüm Testlerin Merkezi
 * 
 * Bu dosya tüm test senaryolarını içerir ve yönetir.
 * Her özellik için ayrı test modülleri vardır.
 */

const TestRunner = require('../src/utils/testRunner');
const fs = require('fs-extra');
const path = require('path');
const io = require('socket.io-client');

class TestIndex {
  constructor() {
    this.baseUrl = 'http://localhost:3000';
    this.testBuildZip = '/Users/nadir/01dev/elecron-paket/build.zip';
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      tests: []
    };
    this.socket = null;
    this.socketEvents = [];
  }

  async setupConsoleCapture() {
    console.log('📡 Console monitoring aktif...');
    
    try {
      this.socket = io(this.baseUrl, {
        transports: ['websocket', 'polling']
      });

      this.socket.on('connect', () => {
        console.log('  ✅ Socket.IO bağlandı');
      });

      const eventNames = [
        'packaging-queued', 'packaging-started', 'packaging-progress',
        'packaging-completed', 'packaging-failed', 'zip-extracted', 'zip-extraction-failed'
      ];

      eventNames.forEach(eventName => {
        this.socket.on(eventName, (data) => {
          this.socketEvents.push({
            timestamp: new Date().toISOString(),
            event: eventName,
            data
          });
        });
      });

    } catch (error) {
      console.log('  ⚠️  Socket.IO bağlantısı kurulamadı');
    }
  }

  async teardownConsoleCapture() {
    if (this.socket) {
      this.socket.disconnect();
    }

    if (this.socketEvents.length > 0) {
      const logPath = path.join(__dirname, 'logs', `test-index-${Date.now()}.json`);
      await fs.ensureDir(path.dirname(logPath));
      await fs.writeJson(logPath, {
        results: this.results,
        socketEvents: this.socketEvents
      }, { spaces: 2 });
      console.log(`\n📄 Loglar kaydedildi: ${logPath}`);
    }
  }

  async runAllTests() {
    console.log('\n🧪 ═══════════════════════════════════════');
    console.log('📋 ELECTRON PAKETLEYICI - TEST INDEX');
    console.log('═══════════════════════════════════════\n');

    // Console monitoring başlat
    await this.setupConsoleCapture();

    const startTime = Date.now();

    try {
      // Test kategorileri
      await this.runCategoryTests('API Tests', [
      () => this.testCacheHeaders(),
      () => this.testPublishersAPI(),
      () => this.testLogosAPI(),
      () => this.testConfigRepository()
    ]);

    await this.runCategoryTests('Upload Tests', [
      () => this.testZipUpload(),
      () => this.testSessionValidation()
    ]);

    await this.runCategoryTests('Publisher Tests', [
      () => this.testPublisherList(),
      () => this.testPublisherInPackaging(),
      () => this.testPublisherSelection()
    ]);

    await this.runCategoryTests('Logo Tests', [
      () => this.testLogoList(),
      () => this.testLogoUpload(),
      () => this.testLogoAccessibility()
    ]);

    await this.runCategoryTests('Packaging Tests', [
      () => this.testPackagingQueue(),
      () => this.testOutputDirectory()
    ]);

    } finally {
      // Console monitoring durdur
      await this.teardownConsoleCapture();
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    this.printSummary(duration);
    
    return this.results;
  }

  async runCategoryTests(category, tests) {
    console.log(`\n📂 ${category}`);
    console.log('─'.repeat(50));

    for (const test of tests) {
      try {
        await test();
      } catch (error) {
        console.error(`❌ Test hatası: ${error.message}`);
      }
    }
  }

  async testCacheHeaders() {
    return this.runTest('Cache Headers Kontrolü', async () => {
      const axios = require('axios');
      const endpoints = ['/api/logos', '/api/publishers', '/api/health'];
      
      for (const endpoint of endpoints) {
        const response = await axios.get(`${this.baseUrl}${endpoint}`);
        const cacheControl = response.headers['cache-control'];
        
        if (!cacheControl || !cacheControl.includes('no-store')) {
          throw new Error(`${endpoint} cache kullanıyor: ${cacheControl}`);
        }
      }
    });
  }

  async testPublishersAPI() {
    return this.runTest('Publishers API', async () => {
      const axios = require('axios');
      const response = await axios.get(`${this.baseUrl}/api/publishers`);
      
      if (!Array.isArray(response.data)) {
        throw new Error('Publishers API array döndürmedi');
      }
      
      if (response.data.length === 0) {
        throw new Error('Yayınevi listesi boş');
      }
    });
  }

  async testLogosAPI() {
    return this.runTest('Logos API', async () => {
      const axios = require('axios');
      const response = await axios.get(`${this.baseUrl}/api/logos`);
      
      if (!Array.isArray(response.data)) {
        throw new Error('Logos API array döndürmedi');
      }
    });
  }

  async testConfigRepository() {
    return this.runTest('Config Repository', async () => {
      const axios = require('axios');
      const response = await axios.get(`${this.baseUrl}/api/settings`);
      
      if (!response.data.configRepository) {
        throw new Error('configRepository tanımlı değil');
      }
      
      const repoInfo = await axios.get(`${this.baseUrl}/api/settings/repository-info`);
      
      if (!repoInfo.data.exists) {
        throw new Error('Config repository klasörü bulunamadı');
      }
    });
  }

  async testZipUpload() {
    return this.runTest('ZIP Upload', async () => {
      if (!await fs.pathExists(this.testBuildZip)) {
        throw new Error('Test build.zip dosyası bulunamadı');
      }
      
      // ZIP dosyası var mı kontrol et
      const stats = await fs.stat(this.testBuildZip);
      if (stats.size === 0) {
        throw new Error('build.zip dosyası boş');
      }
    });
  }

  async testSessionValidation() {
    return this.runTest('Session Validation', async () => {
      const axios = require('axios');
      
      // Geçersiz session
      try {
        await axios.get(`${this.baseUrl}/api/validate-session/invalid-session-id`);
        throw new Error('Geçersiz session kabul edildi');
      } catch (error) {
        if (error.response && error.response.status === 404) {
          // Beklenen davranış
          return;
        }
        throw error;
      }
    });
  }

  async testPublisherList() {
    return this.runTest('Publisher Listesi', async () => {
      const axios = require('axios');
      const response = await axios.get(`${this.baseUrl}/api/publishers`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      const publishers = response.data;
      
      if (publishers.length === 0) {
        throw new Error('Yayınevi listesi boş');
      }
      
      // Her yayınevi için gerekli alanları kontrol et
      publishers.forEach(pub => {
        if (!pub.id || !pub.name) {
          throw new Error('Yayınevi eksik bilgi içeriyor');
        }
      });
    });
  }

  async testPublisherInPackaging() {
    return this.runTest('Paketleme Adımında Yayınevi', async () => {
      const axios = require('axios');
      
      // HTML'de publisherSelect var mı?
      const indexResponse = await axios.get(`${this.baseUrl}/`);
      const html = indexResponse.data;
      
      if (!html.includes('id="publisherSelect"')) {
        throw new Error('publisherSelect dropdown HTML\'de yok');
      }
      
      // JavaScript'te loadPublishers var mı?
      const appJsResponse = await axios.get(`${this.baseUrl}/app.js`);
      const appJs = appJsResponse.data;
      
      if (!appJs.includes('loadPublishers')) {
        throw new Error('app.js\'de loadPublishers fonksiyonu yok');
      }
    });
  }

  async testPublisherSelection() {
    return this.runTest('Yayınevi Seçimi', async () => {
      const axios = require('axios');
      const response = await axios.get(`${this.baseUrl}/api/publishers`);
      const publishers = response.data;
      
      // Varsayılan yayınevi var mı?
      const defaultPublisher = publishers.find(p => p.isDefault);
      
      if (!defaultPublisher) {
        console.warn('⚠️ Varsayılan yayınevi yok');
      }
    });
  }

  async testLogoList() {
    return this.runTest('Logo Listesi', async () => {
      const axios = require('axios');
      const response = await axios.get(`${this.baseUrl}/api/logos`);
      const logos = response.data;
      
      logos.forEach(logo => {
        if (!logo.id || !logo.fileName) {
          throw new Error('Logo eksik bilgi içeriyor');
        }
      });
    });
  }

  async testLogoUpload() {
    return this.runTest('Logo Upload', async () => {
      const axios = require('axios');
      const FormData = require('form-data');
      
      // Test logosu oluştur (1x1 PNG)
      const testLogoPath = path.join(__dirname, '../temp/test-logo.png');
      await fs.ensureDir(path.dirname(testLogoPath));
      
      // Minimal PNG
      const pngData = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
        0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
        0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D, 0xB4, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
      ]);
      
      await fs.writeFile(testLogoPath, pngData);
      
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
      
      await fs.remove(testLogoPath);
    });
  }

  async testLogoAccessibility() {
    return this.runTest('Logo Erişilebilirlik', async () => {
      const axios = require('axios');
      const logosResponse = await axios.get(`${this.baseUrl}/api/logos`);
      const logos = logosResponse.data;
      
      if (logos.length === 0) {
        console.warn('⚠️ Logo yok, test atlanıyor');
        return;
      }
      
      const testLogo = logos[0];
      const logoUrl = `${this.baseUrl}/logos/${testLogo.fileName}`;
      
      const response = await axios.get(logoUrl, {
        responseType: 'arraybuffer'
      });
      
      if (response.status !== 200 || !response.data || response.data.length === 0) {
        throw new Error('Logo erişilemedi');
      }
    });
  }

  async testPackagingQueue() {
    return this.runTest('Paketleme Kuyruğu', async () => {
      // Queue service çalışıyor mu kontrol et
      const axios = require('axios');
      const response = await axios.get(`${this.baseUrl}/api/health`);
      
      if (response.status !== 200) {
        throw new Error('Server sağlıklı değil');
      }
    });
  }

  async testOutputDirectory() {
    return this.runTest('Output Klasörü', async () => {
      const axios = require('axios');
      const response = await axios.get(`${this.baseUrl}/api/settings`);
      const settings = response.data;
      
      // ConfigManager'dan output dizinini al
      const ConfigManager = require('../src/config/ConfigManager');
      const configManager = new ConfigManager();
      const outputDir = configManager.getOutputDir();
      
      if (!await fs.pathExists(outputDir)) {
        throw new Error('Output klasörü bulunamadı: ' + outputDir);
      }
    });
  }

  async runTest(name, testFn) {
    this.results.total++;
    
    try {
      await testFn();
      this.results.passed++;
      this.results.tests.push({ name, status: 'PASS', error: null });
      console.log(`  ✅ ${name}`);
      return true;
    } catch (error) {
      this.results.failed++;
      this.results.tests.push({ name, status: 'FAIL', error: error.message });
      console.log(`  ❌ ${name}: ${error.message}`);
      return false;
    }
  }

  printSummary(duration) {
    console.log('\n═══════════════════════════════════════');
    console.log('📊 TEST SONUÇLARI');
    console.log('═══════════════════════════════════════');
    console.log(`Toplam Test: ${this.results.total}`);
    console.log(`✅ Başarılı: ${this.results.passed}`);
    console.log(`❌ Başarısız: ${this.results.failed}`);
    console.log(`⏭️  Atlanan: ${this.results.skipped}`);
    console.log(`⏱️  Süre: ${duration}s`);
    console.log(`📈 Başarı Oranı: ${((this.results.passed / this.results.total) * 100).toFixed(1)}%`);
    console.log('═══════════════════════════════════════\n');
  }
}

// CLI kullanımı
if (require.main === module) {
  const testIndex = new TestIndex();
  testIndex.runAllTests()
    .then(results => {
      process.exit(results.failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('❌ Test suite hatası:', error);
      process.exit(1);
    });
}

module.exports = TestIndex;
