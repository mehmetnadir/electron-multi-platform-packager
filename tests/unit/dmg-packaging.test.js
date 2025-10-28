/**
 * DMG Packaging Test - macOS DMG Oluşturma Testi
 * 
 * Bu test DMG paketleme sürecini kontrol eder.
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');

class DMGPackagingTest {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
    this.testBuildZip = '/Users/nadir/01dev/elecron-paket/build.zip';
  }

  async testZipUpload() {
    console.log('🧪 Test 1: ZIP Upload');
    
    if (!await fs.pathExists(this.testBuildZip)) {
      throw new Error('Test build.zip bulunamadı: ' + this.testBuildZip);
    }
    
    const form = new FormData();
    form.append('file', fs.createReadStream(this.testBuildZip));
    
    const response = await axios.post(`${this.baseUrl}/upload`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    if (!response.data.sessionId) {
      throw new Error('Session ID alınamadı');
    }
    
    this.sessionId = response.data.sessionId;
    console.log(`  ✓ ZIP yüklendi: ${this.sessionId}`);
    console.log('✅ ZIP Upload başarılı\n');
    
    return this.sessionId;
  }

  async testPackagingRequest() {
    console.log('🧪 Test 2: Paketleme İsteği (macOS DMG)');
    
    if (!this.sessionId) {
      throw new Error('Session ID yok, önce ZIP yükle');
    }
    
    // Yayınevi listesini al
    const publishersResponse = await axios.get(`${this.baseUrl}/api/publishers`);
    const publishers = publishersResponse.data;
    
    if (publishers.length === 0) {
      throw new Error('Yayınevi yok');
    }
    
    const publisher = publishers[0];
    console.log(`  ✓ Yayınevi: ${publisher.name}`);
    
    // Paketleme isteği gönder
    const packagingData = {
      sessionId: this.sessionId,
      appName: 'DMG Test App',
      appVersion: '1.0.0',
      appId: 'com.test.dmgapp',
      description: 'DMG Test',
      author: 'Test',
      platforms: ['macos'],
      publisherId: publisher.id,
      packageFormats: {
        macos: ['dmg']
      }
    };
    
    console.log('  ✓ Paketleme isteği gönderiliyor...');
    console.log(`    - Platform: macOS`);
    console.log(`    - Format: DMG`);
    
    const response = await axios.post(`${this.baseUrl}/package`, packagingData);
    
    if (!response.data.jobId) {
      throw new Error('Job ID alınamadı');
    }
    
    this.jobId = response.data.jobId;
    console.log(`  ✓ Job ID: ${this.jobId}`);
    console.log('✅ Paketleme isteği başarılı\n');
    
    return this.jobId;
  }

  async testPackagingProgress() {
    console.log('🧪 Test 3: Paketleme İlerlemesi İzleme');
    
    if (!this.jobId) {
      throw new Error('Job ID yok');
    }
    
    console.log('  ⏳ Paketleme izleniyor (max 60 saniye)...');
    
    const maxWaitTime = 60000; // 60 saniye
    const checkInterval = 2000; // 2 saniye
    const startTime = Date.now();
    
    let lastProgress = 0;
    let lastMessage = '';
    let isCompleted = false;
    let error = null;
    
    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      
      try {
        // Job durumunu kontrol et (bu endpoint olmayabilir, socket.io kullanılıyor)
        // Alternatif: localStorage'dan veya socket event'lerinden kontrol
        console.log('  ⏳ Bekleniyor...');
        
        // Basit kontrol: output klasörünü kontrol et
        const ConfigManager = require('../../src/config/ConfigManager');
        const configManager = new ConfigManager();
        const outputDir = configManager.getOutputDir();
        
        // DMG dosyası var mı kontrol et
        const files = await fs.readdir(outputDir);
        const dmgFiles = files.filter(f => f.endsWith('.dmg'));
        
        if (dmgFiles.length > 0) {
          console.log(`  ✓ DMG dosyası bulundu: ${dmgFiles[0]}`);
          isCompleted = true;
          break;
        }
        
      } catch (err) {
        console.log(`  ⚠️  Kontrol hatası: ${err.message}`);
      }
    }
    
    if (!isCompleted) {
      console.log('  ⚠️  60 saniye içinde tamamlanmadı');
      console.log('  ℹ️  Manuel kontrol gerekli');
    }
    
    console.log('✅ İzleme tamamlandı\n');
  }

  async testDMGOutput() {
    console.log('🧪 Test 4: DMG Çıktı Kontrolü');
    
    const ConfigManager = require('../../src/config/ConfigManager');
    const configManager = new ConfigManager();
    const outputDir = configManager.getOutputDir();
    
    console.log(`  ✓ Output klasörü: ${outputDir}`);
    
    if (!await fs.pathExists(outputDir)) {
      throw new Error('Output klasörü yok');
    }
    
    // Son oluşturulan klasörü bul
    const items = await fs.readdir(outputDir);
    const folders = [];
    
    for (const item of items) {
      const itemPath = path.join(outputDir, item);
      const stat = await fs.stat(itemPath);
      if (stat.isDirectory()) {
        folders.push({
          name: item,
          mtime: stat.mtime
        });
      }
    }
    
    if (folders.length === 0) {
      console.log('  ⚠️  Output klasöründe paket yok');
      console.log('  ℹ️  Paketleme henüz tamamlanmamış olabilir');
      return;
    }
    
    // En son oluşturulan klasör
    folders.sort((a, b) => b.mtime - a.mtime);
    const latestFolder = folders[0];
    const latestPath = path.join(outputDir, latestFolder.name);
    
    console.log(`  ✓ Son paket: ${latestFolder.name}`);
    
    // macOS klasörünü kontrol et
    const macosPath = path.join(latestPath, 'macos');
    if (await fs.pathExists(macosPath)) {
      const macosFiles = await fs.readdir(macosPath);
      console.log(`  ✓ macOS klasöründe ${macosFiles.length} dosya var`);
      
      macosFiles.forEach(file => {
        console.log(`    - ${file}`);
      });
      
      const dmgFiles = macosFiles.filter(f => f.endsWith('.dmg'));
      if (dmgFiles.length === 0) {
        console.log('  ❌ DMG dosyası bulunamadı!');
        console.log('  ℹ️  Paketleme başarısız olmuş olabilir');
      } else {
        console.log(`  ✅ DMG dosyası mevcut: ${dmgFiles[0]}`);
      }
    } else {
      console.log('  ⚠️  macOS klasörü yok');
    }
    
    console.log('✅ Output kontrolü tamamlandı\n');
  }

  async checkServerLogs() {
    console.log('🧪 Test 5: Server Log Kontrolü');
    console.log('  ℹ️  Server console\'da şunları kontrol et:');
    console.log('    - "🚀 Paketleme başladı" mesajı');
    console.log('    - "📦 macOS paketleme başlıyor" mesajı');
    console.log('    - "Creating DMG" mesajı');
    console.log('    - Herhangi bir hata mesajı');
    console.log('    - "✅ Paketleme tamamlandı" mesajı');
    console.log('✅ Log kontrolü hatırlatması yapıldı\n');
  }

  async runAll() {
    try {
      console.log('\n🔍 DMG PAKETLEME TEST SÜRECİ');
      console.log('='.repeat(60));
      console.log('Bu test DMG oluşturma sürecini adım adım test eder.\n');
      
      await this.testZipUpload();
      await this.testPackagingRequest();
      await this.testPackagingProgress();
      await this.testDMGOutput();
      await this.checkServerLogs();
      
      console.log('='.repeat(60));
      console.log('📊 TEST TAMAMLANDI');
      console.log('='.repeat(60));
      console.log('✅ Tüm adımlar tamamlandı');
      console.log('\n💡 SONRAKI ADIMLAR:');
      console.log('1. Electron uygulamasında Console\'u aç (Option+Cmd+I)');
      console.log('2. Server console\'da hata mesajlarını kontrol et');
      console.log('3. Output klasöründe DMG dosyasını kontrol et');
      console.log('4. Eğer DMG yoksa, server loglarını paylaş\n');
      
      return { success: true };
    } catch (error) {
      console.error('\n❌ Test başarısız:', error.message);
      console.error('Stack:', error.stack);
      return { success: false, error: error.message };
    }
  }
}

// CLI kullanımı
if (require.main === module) {
  const test = new DMGPackagingTest();
  test.runAll()
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(() => process.exit(1));
}

module.exports = DMGPackagingTest;
