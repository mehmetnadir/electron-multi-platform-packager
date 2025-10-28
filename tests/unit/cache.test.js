/**
 * Cache Tests - HTTP Cache Header Kontrolü
 * 
 * Bu test, tüm API endpoint'lerinde cache'in devre dışı olduğunu doğrular.
 */

const axios = require('axios');

class CacheTest {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  async testNoCacheHeaders() {
    console.log('🧪 Test: Cache Headers');
    
    const endpoints = [
      '/api/logos',
      '/api/publishers',
      '/api/health',
      '/api/settings'
    ];
    
    for (const endpoint of endpoints) {
      const response = await axios.get(`${this.baseUrl}${endpoint}`);
      const cacheControl = response.headers['cache-control'];
      
      if (!cacheControl) {
        throw new Error(`${endpoint} - Cache-Control header yok`);
      }
      
      if (!cacheControl.includes('no-store')) {
        throw new Error(`${endpoint} - Cache kullanıyor: ${cacheControl}`);
      }
      
      console.log(`  ✓ ${endpoint}: ${cacheControl}`);
    }
    
    console.log('✅ Tüm endpointler cache kullanmıyor\n');
  }

  async testStaticFilesNoCache() {
    console.log('🧪 Test: Static Files Cache');
    
    const staticFiles = [
      '/app.js',
      '/style.css'
    ];
    
    for (const file of staticFiles) {
      try {
        const response = await axios.get(`${this.baseUrl}${file}`);
        const cacheControl = response.headers['cache-control'];
        
        if (cacheControl && cacheControl.includes('no-store')) {
          console.log(`  ✓ ${file}: Cache yok`);
        } else {
          console.log(`  ⚠️  ${file}: Cache var (${cacheControl || 'header yok'})`);
        }
      } catch (error) {
        console.log(`  ⚠️  ${file}: Dosya bulunamadı`);
      }
    }
    
    console.log('✅ Static files kontrol edildi\n');
  }

  async runAll() {
    try {
      await this.testNoCacheHeaders();
      await this.testStaticFilesNoCache();
      return { success: true };
    } catch (error) {
      console.error('❌ Test başarısız:', error.message);
      return { success: false, error: error.message };
    }
  }
}

// CLI kullanımı
if (require.main === module) {
  const test = new CacheTest();
  test.runAll()
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(() => process.exit(1));
}

module.exports = CacheTest;
