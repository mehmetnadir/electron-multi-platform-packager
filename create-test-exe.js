#!/usr/bin/env node

/**
 * Test EXE Oluşturucu
 * 
 * Bu script test uygulaması için Windows EXE dosyası oluşturur
 */

const path = require('path');
const fs = require('fs-extra');
const PackagingService = require('./src/packaging/packagingService');

class TestExeCreator {
  constructor() {
    this.testAppPath = path.join(__dirname, 'test-app');
    this.outputPath = path.join(__dirname, 'test-output');
    this.appName = 'Test Uygulaması';
    this.appVersion = '1.0.0';
    this.companyName = 'Dijitap Test';
    this.companyId = 'TEST001';
  }

  async createTestExe() {
    console.log('🚀 Test EXE oluşturuluyor...');
    console.log('='.repeat(50));

    try {
      // Çıktı klasörünü temizle
      await fs.remove(this.outputPath);
      await fs.ensureDir(this.outputPath);

      // Test uygulamasının var olduğunu kontrol et
      if (!await fs.pathExists(this.testAppPath)) {
        throw new Error('Test uygulaması bulunamadı: ' + this.testAppPath);
      }

      console.log('📁 Test uygulaması hazırlanıyor...');
      
      // Package.json kontrolü ve electron kurulumu
      const packageJsonPath = path.join(this.testAppPath, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        console.log('📦 Package.json bulundu, electron kuruluyor...');
        
        // Electron kurulumunu simüle et (gerçek kurulum için npm gerekli)
        const { spawn } = require('child_process');
        
        try {
          await new Promise((resolve, reject) => {
            const npmProcess = spawn('npm', ['install'], {
              cwd: this.testAppPath,
              stdio: 'pipe',
              shell: true
            });

            npmProcess.stdout.on('data', (data) => {
              console.log('NPM:', data.toString().trim());
            });

            npmProcess.stderr.on('data', (data) => {
              console.warn('NPM Warning:', data.toString().trim());
            });

            npmProcess.on('close', (code) => {
              if (code === 0) {
                console.log('✅ Electron başarıyla kuruldu');
                resolve();
              } else {
                console.warn('⚠️ NPM kurulum uyarısı, devam ediliyor...');
                resolve(); // Test için devam et
              }
            });

            npmProcess.on('error', (error) => {
              console.warn('⚠️ NPM bulunamadı, manuel kurulum gerekebilir');
              resolve(); // Test için devam et
            });
          });
        } catch (error) {
          console.warn('⚠️ Electron kurulum uyarısı:', error.message);
        }
      }

      console.log('🔨 Windows EXE paketlemesi başlatılıyor...');

      // Mock progress callback
      const mockProgressCallback = {
        emit: (event, data) => {
          if (event === 'packaging-progress') {
            console.log(`📊 Progress: ${data.progress}% - ${data.message || data.platform}`);
          }
        }
      };

      // Windows paketleme
      const result = await PackagingService.packageWindows(
        this.testAppPath,           // workingPath
        this.outputPath,            // tempPath  
        this.appName,               // appName
        this.appVersion,            // appVersion
        null,                       // logoPath
        {                           // options
          publisherName: 'Dijitap Test',
          description: 'Test uygulaması'
        },
        this.companyName,           // companyName
        this.companyId,             // companyId
        mockProgressCallback,       // io
        'test-exe-job',            // jobId
        0,                         // platformIndex
        1                          // totalPlatforms
      );

      console.log('\n🎉 Test EXE başarıyla oluşturuldu!');
      console.log('='.repeat(50));
      
      if (result.type === 'quick-launch') {
        console.log('⚡ Quick Launch modu - uygulama zaten güncel!');
      } else {
        console.log(`📁 Dosya: ${result.filename}`);
        console.log(`📂 Konum: ${result.path}`);
        console.log(`📊 Boyut: ${(result.size / 1024 / 1024).toFixed(2)} MB`);
      }

      console.log('\n📋 Test talimatları:');
      console.log('1. Oluşturulan EXE dosyasını çalıştırın');
      console.log('2. Kurulum sürecini gözlemleyin');
      console.log('3. Uygulama otomatik açılacak');
      console.log('4. Artımlı güncelleme sistemini test edin');

      return result;

    } catch (error) {
      console.error('❌ Test EXE oluşturma hatası:', error.message);
      throw error;
    }
  }

  async testIncrementalUpdate() {
    console.log('\n🔄 Artımlı güncelleme testi...');
    
    // Küçük bir değişiklik yap
    const indexPath = path.join(this.testAppPath, 'index.html');
    const indexContent = await fs.readFile(indexPath, 'utf8');
    const updatedContent = indexContent.replace('Versiyon: 1.0.0', 'Versiyon: 1.0.1');
    await fs.writeFile(indexPath, updatedContent);

    console.log('✏️ Sürüm 1.0.1 için değişiklik yapıldı');
    
    // Yeni versiyonu pakitle
    console.log('📦 Versiyon 1.0.1 paketleniyor...');
    
    const result = await PackagingService.packageWindows(
      this.testAppPath,
      this.outputPath,
      this.appName,
      '1.0.1',
      null,
      { publisherName: 'Dijitap Test' },
      this.companyName,
      this.companyId,
      { emit: () => {} },
      'test-update-job',
      0,
      1
    );

    console.log('✅ Artımlı güncelleme testi tamamlandı');
    
    // Değişikliği geri al
    await fs.writeFile(indexPath, indexContent);
    
    return result;
  }
}

// Script direkt çalıştırılırsa
if (require.main === module) {
  const creator = new TestExeCreator();
  
  creator.createTestExe()
    .then(result => {
      console.log('\n✅ Test EXE hazır!');
      
      // İsteğe bağlı artımlı güncelleme testi
      console.log('\n❓ Artımlı güncelleme testi yapılsın mı? (5 saniye sonra otomatik...)');
      
      setTimeout(async () => {
        try {
          console.log('\n🔄 Artımlı güncelleme testi başlatılıyor...');
          await creator.testIncrementalUpdate();
        } catch (error) {
          console.warn('⚠️ Artımlı güncelleme testi uyarısı:', error.message);
        }
      }, 5000);
    })
    .catch(error => {
      console.error('💥 Fatal hata:', error);
      process.exit(1);
    });
}

module.exports = TestExeCreator;