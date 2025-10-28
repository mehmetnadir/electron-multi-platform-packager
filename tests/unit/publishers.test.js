/**
 * Publishers Tests - Yayınevi Yönetimi Testleri
 * 
 * Bu test, yayınevi API'lerini ve frontend entegrasyonunu doğrular.
 */

const axios = require('axios');

class PublishersTest {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  async testPublishersAPI() {
    console.log('🧪 Test: Publishers API');
    
    const response = await axios.get(`${this.baseUrl}/api/publishers`, {
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    
    if (!Array.isArray(response.data)) {
      throw new Error('Publishers API array dönmedi');
    }
    
    console.log(`  ✓ ${response.data.length} yayınevi bulundu`);
    
    if (response.data.length === 0) {
      throw new Error('Yayınevi listesi boş');
    }
    
    // Her yayınevi için gerekli alanları kontrol et
    response.data.forEach((pub, index) => {
      if (!pub.id) throw new Error(`Yayınevi ${index}: id eksik`);
      if (!pub.name) throw new Error(`Yayınevi ${index}: name eksik`);
      
      console.log(`  ✓ ${pub.name} (${pub.id})`);
      
      if (pub.isDefault) {
        console.log(`    → Varsayılan yayınevi`);
      }
    });
    
    console.log('✅ Publishers API çalışıyor\n');
  }

  async testPublisherInHTML() {
    console.log('🧪 Test: HTML\'de Publisher Dropdown');
    
    const response = await axios.get(`${this.baseUrl}/`);
    const html = response.data;
    
    if (!html.includes('id="publisherSelect"')) {
      throw new Error('publisherSelect dropdown HTML\'de yok');
    }
    
    console.log('  ✓ publisherSelect dropdown mevcut');
    console.log('✅ HTML kontrolü başarılı\n');
  }

  async testPublisherInJS() {
    console.log('🧪 Test: JavaScript\'te Publisher Fonksiyonları');
    
    const response = await axios.get(`${this.baseUrl}/app.js`);
    const js = response.data;
    
    const requiredFunctions = [
      'loadPublishers',
      'updatePublisherDropdown'
    ];
    
    for (const fn of requiredFunctions) {
      if (!js.includes(fn)) {
        throw new Error(`${fn} fonksiyonu app.js\'de yok`);
      }
      console.log(`  ✓ ${fn} fonksiyonu mevcut`);
    }
    
    console.log('✅ JavaScript kontrolü başarılı\n');
  }

  async testDefaultPublisher() {
    console.log('🧪 Test: Varsayılan Yayınevi');
    
    const response = await axios.get(`${this.baseUrl}/api/publishers`);
    const publishers = response.data;
    
    const defaultPublisher = publishers.find(p => p.isDefault);
    
    if (!defaultPublisher) {
      console.log('  ⚠️  Varsayılan yayınevi yok');
    } else {
      console.log(`  ✓ Varsayılan: ${defaultPublisher.name}`);
    }
    
    console.log('✅ Varsayılan yayınevi kontrolü tamamlandı\n');
  }

  async runAll() {
    try {
      await this.testPublishersAPI();
      await this.testPublisherInHTML();
      await this.testPublisherInJS();
      await this.testDefaultPublisher();
      return { success: true };
    } catch (error) {
      console.error('❌ Test başarısız:', error.message);
      return { success: false, error: error.message };
    }
  }
}

// CLI kullanımı
if (require.main === module) {
  const test = new PublishersTest();
  test.runAll()
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(() => process.exit(1));
}

module.exports = PublishersTest;
