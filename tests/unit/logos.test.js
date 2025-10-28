/**
 * Logos Tests - Logo Yönetimi Testleri
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs-extra');
const path = require('path');

class LogosTest {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  async testLogosAPI() {
    console.log('🧪 Test: Logos API');
    
    const response = await axios.get(`${this.baseUrl}/api/logos`, {
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    
    if (!Array.isArray(response.data)) {
      throw new Error('Logos API array dönmedi');
    }
    
    console.log(`  ✓ ${response.data.length} logo bulundu`);
    
    response.data.forEach(logo => {
      if (!logo.id || !logo.fileName) {
        throw new Error('Logo eksik bilgi içeriyor');
      }
      console.log(`  ✓ ${logo.kurumAdi} (${logo.fileName})`);
    });
    
    console.log('✅ Logos API çalışıyor\n');
  }

  async testLogoAccessibility() {
    console.log('🧪 Test: Logo Erişilebilirlik');
    
    const logosResponse = await axios.get(`${this.baseUrl}/api/logos`);
    const logos = logosResponse.data;
    
    if (logos.length === 0) {
      console.log('  ⚠️  Logo yok, test atlanıyor\n');
      return;
    }
    
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
    
    console.log(`  ✓ ${testLogo.fileName} erişilebilir (${response.data.length} bytes)`);
    console.log('✅ Logo erişilebilirlik başarılı\n');
  }

  async testLogoUpload() {
    console.log('🧪 Test: Logo Upload');
    
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
    
    console.log('  ✓ Test logosu yüklendi');
    
    // Temizlik
    await fs.remove(testLogoPath);
    
    console.log('✅ Logo upload başarılı\n');
  }

  async runAll() {
    try {
      await this.testLogosAPI();
      await this.testLogoAccessibility();
      await this.testLogoUpload();
      return { success: true };
    } catch (error) {
      console.error('❌ Test başarısız:', error.message);
      return { success: false, error: error.message };
    }
  }
}

// CLI kullanımı
if (require.main === module) {
  const test = new LogosTest();
  test.runAll()
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(() => process.exit(1));
}

module.exports = LogosTest;
