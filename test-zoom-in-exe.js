#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const WindowsPackagingService = require('./src/platforms/windows/WindowsPackagingService');

// Test için basit bir app oluştur
async function createTestApp() {
  const testPath = path.join(__dirname, 'test-zoom-app');
  
  // Temizle
  if (await fs.pathExists(testPath)) {
    await fs.remove(testPath);
  }
  
  await fs.ensureDir(testPath);
  
  // Package.json
  const packageJson = {
    name: 'test-zoom-app',
    version: '1.0.0',
    description: 'Test app with HTML activities',
    main: 'main.js'
  };
  await fs.writeJson(path.join(testPath, 'package.json'), packageJson, { spaces: 2 });
  
  // Ana index.html
  const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Test App</title>
</head>
<body>
  <h1>Test App</h1>
  <a href="book1/assets/5907/htmletk/u1/index.html">HTML Etkinlik</a>
</body>
</html>`;
  await fs.writeFile(path.join(testPath, 'index.html'), indexHtml);
  
  // HTML etkinlik oluştur
  const htmletkPath = path.join(testPath, 'book1/assets/5907/htmletk/u1');
  await fs.ensureDir(htmletkPath);
  
  const activityHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Etkinlik</title>
  <style>
    .player {
      display: grid;
      width: 100vw;
      height: 100%;
      grid-template-columns: 1fr 7fr;
    }
    .toolbar {
      background: #ececec;
      padding: 20px;
    }
  </style>
</head>
<body>
  <div class="player">
    <div class="toolbar">
      <h3>Toolbar</h3>
      <p>Zoom butonları buraya eklenecek</p>
    </div>
    <div id="root">
      <h1>HTML Etkinlik İçeriği</h1>
      <p>Bu alan zoom yapılabilir olacak</p>
    </div>
  </div>
</body>
</html>`;
  
  await fs.writeFile(path.join(htmletkPath, 'index.html'), activityHtml);
  
  console.log('✅ Test app oluşturuldu:', testPath);
  return testPath;
}

// Windows packaging test et
async function testWindowsPackaging() {
  console.log('🚀 Windows packaging zoom enhancement testi başlıyor...');
  
  const testAppPath = await createTestApp();
  const outputPath = path.join(__dirname, 'test-output');
  
  // Temizle
  if (await fs.pathExists(outputPath)) {
    await fs.remove(outputPath);
  }
  await fs.ensureDir(outputPath);
  
  try {
    // Mock progress callback
    const mockProgressCallback = {
      emit: (event, data) => {
        if (event === 'packaging-progress') {
          console.log(`📊 Progress: ${data.progress}% - ${data.message || data.platform}`);
        }
      }
    };

    // Windows paketleme servisi oluştur
    const windowsService = new WindowsPackagingService();
    
    // Test request objesi
    const request = {
      workingPath: testAppPath,
      tempPath: outputPath,
      appName: 'Test Zoom App',
      appVersion: '1.0.0',
      logoPath: null,
      options: {
        publisherName: 'Test Company',
        description: 'Test uygulaması zoom enhancement ile'
      },
      companyInfo: {
        companyName: 'Test Company',
        companyId: 'test-company'
      }
    };
    
    // Progress reporter mock
    windowsService.progressReporter = {
      start: (msg) => console.log('🚀', msg),
      step: (step, id, msg) => console.log(`📊 Step ${step}:`, msg),
      complete: (result, msg) => console.log('✅', msg)
    };

    // Sadece zoom enhancement testini yap (paketleme olmadan)
    await windowsService._applyZoomEnhancementToHtmlActivities(testAppPath);
    
    // HTML dosyasını kontrol et
    const htmlPath = path.join(testAppPath, 'book1/assets/5907/htmletk/u1/index.html');
    const htmlContent = await fs.readFile(htmlPath, 'utf8');
    
    if (htmlContent.includes('zoom-controls')) {
      console.log('✅ BAŞARILI: HTML etkinliğe zoom enhancement eklendi!');
      console.log('🔍 Zoom kontrolleri var:', htmlContent.includes('zoom-btn'));
      console.log('🔍 Zoom CSS var:', htmlContent.includes('zoom-level'));
      console.log('🔍 Zoom JS var:', htmlContent.includes('function zoomIn()'));
    } else {
      console.log('❌ BAŞARISIZ: Zoom enhancement eklenmedi');
    }
    
  } catch (error) {
    console.error('❌ Test hatası:', error.message);
  } finally {
    // Temizle
    await fs.remove(testAppPath);
    await fs.remove(outputPath);
  }
}

// Test çalıştır
testWindowsPackaging().then(() => {
  console.log('🏁 Test tamamlandı');
}).catch(error => {
  console.error('💥 Test kritik hatası:', error);
});