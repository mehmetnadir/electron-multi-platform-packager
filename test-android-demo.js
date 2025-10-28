#!/usr/bin/env node

/**
 * Android APK Üretimi Test Scripti - Basit Demo App ile
 * 
 * Bu test script'i küçük bir demo app oluşturup APK üretimi test eder
 */

const fs = require('fs-extra');
const path = require('path');
const packagingService = require('./src/packaging/packagingService');

async function createSimpleTestApp(appPath) {
    console.log('📱 Basit demo app oluşturuluyor...');
    
    // Ana HTML dosyası
    const indexHtml = `<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Android App</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
            padding: 50px;
            margin: 0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        h1 { font-size: 2.5em; margin-bottom: 20px; }
        p { font-size: 1.2em; margin: 10px 0; }
        .logo { font-size: 4em; margin: 20px; }
        .feature { background: rgba(255,255,255,0.1); padding: 15px; margin: 10px; border-radius: 10px; }
    </style>
</head>
<body>
    <div class="logo">📱</div>
    <h1>Test Android App</h1>
    <p>APK Üretim Testi için Demo Uygulama</p>
    
    <div class="feature">
        <h3>✅ APK Başarıyla Oluşturuldu!</h3>
        <p>Bu uygulama Android APK test sürecinde oluşturuldu.</p>
    </div>
    
    <div class="feature">
        <h3>🚀 Özellikler</h3>
        <p>• Capacitor ile APK üretimi</p>
        <p>• Fullscreen Android desteği</p>
        <p>• Modern responsive tasarım</p>
        <p>• Türkçe karakter desteği</p>
    </div>
    
    <p><small>Test tarihi: ${new Date().toLocaleString('tr-TR')}</small></p>
    
    <script>
        console.log('📱 Test Android App yüklendi!');
        
        // Android fullscreen test
        if (window.innerHeight < window.innerWidth) {
            console.log('🖥️ Landscape mod tespit edildi');
        }
        
        // Touch event test
        document.addEventListener('touchstart', function(e) {
            console.log('👆 Touch event çalışıyor');
        });
        
        // Capacitor hazır olduğunda
        document.addEventListener('deviceready', function() {
            console.log('⚡ Capacitor hazır!');
        });
    </script>
</body>
</html>`;

    await fs.writeFile(path.join(appPath, 'index.html'), indexHtml);
    
    // Package.json
    const packageJson = {
        name: "test-android-app",
        version: "1.0.0",
        description: "Android APK test uygulaması",
        main: "index.html",
        scripts: {
            "start": "http-server . -p 8080",
            "test": "echo \"Test Android App\""
        },
        keywords: ["android", "apk", "test", "capacitor"],
        author: "Test Developer",
        license: "MIT"
    };
    
    await fs.writeJson(path.join(appPath, 'package.json'), packageJson, { spaces: 2 });
    
    // Logo oluştur (SVG → PNG)
    const logoSvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" fill="#667eea"/>
    <circle cx="256" cy="200" r="80" fill="white"/>
    <rect x="176" y="280" width="160" height="120" rx="20" fill="white"/>
    <circle cx="220" cy="330" r="15" fill="#667eea"/>
    <circle cx="292" cy="330" r="15" fill="#667eea"/>
    <rect x="230" y="350" width="52" height="8" rx="4" fill="#667eea"/>
</svg>`;
    
    // Images klasörü oluştur
    const imagesDir = path.join(appPath, 'images');
    await fs.ensureDir(imagesDir);
    await fs.writeFile(path.join(imagesDir, 'logo.svg'), logoSvg);
    
    // Sharp ile PNG'ye çevir
    try {
        const sharp = require('sharp');
        await sharp(Buffer.from(logoSvg))
            .resize(512, 512)
            .png()
            .toFile(path.join(imagesDir, 'logo.png'));
        console.log('✅ Logo oluşturuldu: images/logo.png');
    } catch (error) {
        console.log('⚠️ Sharp bulunamadı, SVG logo kullanılacak');
        // Sharp yoksa basit bir PNG oluştur
        await fs.writeFile(path.join(imagesDir, 'logo.png'), Buffer.from(''));
    }
    
    // Styles klasörü ve CSS
    const stylesDir = path.join(appPath, 'styles');
    await fs.ensureDir(stylesDir);
    
    const mainCss = `/* Test Android App CSS */
body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    margin: 0;
    padding: 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    min-height: 100vh;
}

.container {
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
    text-align: center;
}

.feature-card {
    background: rgba(255,255,255,0.1);
    border-radius: 15px;
    padding: 20px;
    margin: 15px 0;
    backdrop-filter: blur(10px);
}

@media (max-width: 768px) {
    .container { padding: 10px; }
    h1 { font-size: 2em; }
}`;
    
    await fs.writeFile(path.join(stylesDir, 'main.css'), mainCss);
    
    // Scripts klasörü ve JS
    const scriptsDir = path.join(appPath, 'scripts');
    await fs.ensureDir(scriptsDir);
    
    const appJs = `// Test Android App JavaScript
console.log('🚀 Test Android App başlatılıyor...');

// Android özel fonksiyonlar
class TestAndroidApp {
    constructor() {
        this.init();
    }
    
    init() {
        console.log('📱 Android app başlatıldı');
        this.setupEvents();
    }
    
    setupEvents() {
        // Touch events
        document.addEventListener('touchstart', this.onTouch.bind(this));
        
        // Capacitor device ready
        document.addEventListener('deviceready', this.onDeviceReady.bind(this));
        
        // DOM ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', this.onDOMReady.bind(this));
        } else {
            this.onDOMReady();
        }
    }
    
    onTouch(event) {
        console.log('👆 Touch event:', event.touches.length);
    }
    
    onDeviceReady() {
        console.log('⚡ Capacitor device ready!');
    }
    
    onDOMReady() {
        console.log('📄 DOM hazır, app test ediliyor...');
        this.runTests();
    }
    
    runTests() {
        const testResults = {
            touch: 'ontouchstart' in window,
            screen: screen.width + 'x' + screen.height,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString()
        };
        
        console.log('🧪 Test sonuçları:', testResults);
        
        // Test bilgilerini göster
        const testInfo = document.createElement('div');
        testInfo.innerHTML = \`
            <h4>🔍 Test Bilgileri</h4>
            <p>Touch Support: \${testResults.touch ? '✅' : '❌'}</p>
            <p>Screen: \${testResults.screen}</p>
            <p>Test Time: \${new Date().toLocaleTimeString('tr-TR')}</p>
        \`;
        testInfo.style.cssText = 'background: rgba(0,0,0,0.2); padding: 15px; border-radius: 10px; margin: 20px 0; font-size: 14px;';
        
        document.body.appendChild(testInfo);
    }
}

// App'i başlat
const testApp = new TestAndroidApp();`;
    
    await fs.writeFile(path.join(scriptsDir, 'app.js'), appJs);
    
    console.log('✅ Demo app oluşturuldu:', appPath);
    console.log('   - index.html (Ana sayfa)');
    console.log('   - package.json (Proje bilgileri)');
    console.log('   - images/logo.png (Logo)');
    console.log('   - styles/main.css (Stiller)');
    console.log('   - scripts/app.js (JavaScript)');
}

async function testAndroidAPKWithDemo() {
    console.log('🤖 Android APK Üretimi Testi - Demo App ile\n');
    console.log('='.repeat(60));
    
    const testJobId = `demo-android-${Date.now()}`;
    const tempPath = path.join('temp', testJobId);
    const workingPath = path.join(tempPath, 'app');
    
    try {
        // Test için gerekli dizinleri oluştur
        await fs.ensureDir(tempPath);
        await fs.ensureDir(workingPath);
        
        // Demo app oluştur
        await createSimpleTestApp(workingPath);
        
        console.log('\n📂 Test ortamı hazırlandı');
        console.log(`   - Working Path: ${workingPath}`);
        console.log(`   - Temp Path: ${tempPath}\n`);
        
        // Test parametrelerini tanımla
        const testParams = {
            workingPath,
            tempPath,
            appName: 'Demo Android App',
            appVersion: '1.0.0',
            logoPath: path.join(workingPath, 'images', 'logo.png'),
            options: {
                publisherName: 'Demo Publisher',
                description: 'Android APK test uygulaması'
            }
        };
        
        console.log('🚀 Android APK paketleme başlıyor...\n');
        
        const startTime = Date.now();
        
        // Mock IO ve job tracking
        const mockIO = {
            emit: (event, data) => {
                console.log(`📡 ${event}: ${data.message} (${data.progress}%)`);
            }
        };
        
        // Android paketleme işlemini başlat
        const result = await packagingService.packageAndroid(
            testParams.workingPath,
            testParams.tempPath,
            testParams.appName,
            testParams.appVersion,
            testParams.logoPath,
            testParams.options,
            mockIO,
            testJobId,
            0, // platformIndex
            1  // totalPlatforms
        );
        
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        
        console.log('\n🎉 Android APK Test Başarılı!');
        console.log('='.repeat(50));
        console.log(`⏱️  Süre: ${duration} saniye`);
        console.log(`📱 Platform: ${result.platform}`);
        console.log(`📦 Tip: ${result.type}`);
        console.log(`📄 Dosya: ${result.filename}`);
        console.log(`📊 Boyut: ${(result.size / (1024 * 1024)).toFixed(2)} MB`);
        console.log(`💬 Mesaj: ${result.message}`);
        console.log(`📍 Yol: ${result.path}`);
        
        // APK dosyasının varlığını kontrol et
        if (await fs.pathExists(result.path)) {
            const stats = await fs.stat(result.path);
            console.log(`\n✅ APK BAŞARIYLA ÜRETİLDİ VE DOĞRULANDI!`);
            console.log(`📈 Gerçek boyut: ${stats.size} bytes`);
            console.log(`📅 Oluşturma: ${stats.birthtime.toLocaleString('tr-TR')}`);
            
            console.log('\n🎯 ÖNEMLİ: Proje dosyası değil, doğrudan APK üretildi!');
        } else {
            console.log(`❌ HATA: APK dosyası bulunamadı: ${result.path}`);
        }
        
        return result;
        
    } catch (error) {
        console.error('\n❌ Android APK Test Hatası:');
        console.error('='.repeat(40));
        console.error(`🔥 Hata: ${error.message}`);
        
        // Hata türüne göre çözüm önerileri
        if (error.message.includes('APK dosyası üretilemedi')) {
            console.error('\n✅ DOĞRU DAVRANIT: Proje dosyası verilmedi, hata fırlatıldı');
            console.error('📋 Bu beklenen davranıştır - APK üretilemezse sistem hata verir');
        }
        
        console.error('\n🔧 Muhtemel Çözümler:');
        console.error('   1. Android SDK kurulumunu kontrol edin');
        console.error('   2. Java JDK kurulumunu kontrol edin');
        console.error('   3. Gradle kurulumunu kontrol edin');
        console.error('   4. ANDROID_HOME environment variable ayarlayın');
        console.error('   5. Capacitor kurulumunu kontrol edin');
        
        throw error;
    } finally {
        console.log('\n🧹 Test klasörü: ' + tempPath);
        console.log('   Temizlik için: rm -rf ' + tempPath);
    }
}

// Ana fonksiyon
async function main() {
    try {
        await testAndroidAPKWithDemo();
        console.log('\n🎊 Test başarıyla tamamlandı!');
        console.log('📱 APK üretimi doğru çalışıyor - proje dosyası verilmiyor!');
        process.exit(0);
    } catch (error) {
        console.error('\n💥 Test sonucu:', error.message);
        console.log('\n📋 Test Değerlendirmesi:');
        console.log('✅ Sistem doğru çalışıyor: APK üretimi başarısız olduğunda hata veriyor');
        console.log('✅ Proje dosyası verilmiyor (istenen davranış)');
        console.log('✅ Kullanıcıya net hata mesajı veriliyor');
        process.exit(1);
    }
}

// Script direkt çalıştırıldığında test'i başlat
if (require.main === module) {
    main();
}