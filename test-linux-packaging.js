#!/usr/bin/env node

/**
 * Linux Packaging Test Script
 * Bu script Linux paketleme (AppImage + DEB) problemlerini tespit eder
 */

const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

// Servisleri import et
const packagingService = require('./src/packaging/packagingService');

async function createLinuxTestApp() {
    console.log('🐧 Linux Paketleme Test Uygulaması Oluşturuluyor...\n');
    
    const testDir = path.join(__dirname, 'linux-test-app');
    const sessionId = uuidv4();
    const appPath = path.join('uploads', sessionId);
    
    // Test dizinini temizle
    if (await fs.pathExists(testDir)) {
        await fs.remove(testDir);
    }
    await fs.ensureDir(testDir);
    
    // Test uygulaması dosyalarını oluştur
    console.log('📁 Test uygulama dosyaları oluşturuluyor...');
    
    // Ana HTML dosyası
    const htmlContent = `<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Linux Test Uygulaması</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 40px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }
        .container {
            text-align: center;
            background: rgba(255,255,255,0.1);
            padding: 40px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.2);
        }
        h1 {
            font-size: 3em;
            margin-bottom: 20px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        .info {
            font-size: 1.2em;
            margin: 20px 0;
            opacity: 0.9;
        }
        .logo {
            width: 100px;
            height: 100px;
            background: rgba(255,255,255,0.2);
            border-radius: 50%;
            margin: 0 auto 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 3em;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🐧</div>
        <h1>Linux Test Uygulaması</h1>
        <div class="info">Electron Paketleyici - Linux Test</div>
        <div class="info">AppImage + DEB Packaging Test</div>
        <div class="info">Versiyon: 1.0.0</div>
        <div class="info" id="timestamp"></div>
    </div>
    
    <script>
        document.getElementById('timestamp').textContent = 'Oluşturulma: ' + new Date().toLocaleString('tr-TR');
    </script>
</body>
</html>`;
    
    await fs.writeFile(path.join(testDir, 'index.html'), htmlContent);
    
    // Önceki Android testindeki gibi, uploads/ klasörüne kopyala
    await fs.ensureDir(appPath);
    await fs.copy(testDir, appPath);
    
    console.log('✅ Test uygulaması oluşturuldu');
    console.log(`📂 Upload path: ${appPath}`);
    
    return { sessionId, appPath };
}

async function testLinuxPackaging() {
    console.log('\n🔧 Linux Paketleme Testi Başlatılıyor...\n');
    
    try {
        // Test uygulamasını oluştur
        const { sessionId, appPath } = await createLinuxTestApp();
        
        // Test parametreleri
        const testParams = {
            sessionId: sessionId,
            appName: 'Linux Test App',
            appVersion: '1.0.0',
            platforms: ['linux'],
            logoId: null, // Logo olmadan test
            packageOptions: {
                description: 'Linux paketleme test uygulaması',
                vendor: 'Dijitap Test',
                maintainer: 'Test Team',
                publisherName: 'Dijitap'
            }
        };
        
        console.log('🚀 Linux paketleme başlatılıyor...');
        console.log(`   📱 App: ${testParams.appName}`);
        console.log(`   📦 Platform: Linux (AppImage + DEB)`);
        console.log(`   📂 Session: ${sessionId}`);
        
        // Mock IO object for progress tracking
        const mockIo = {
            emit: (event, data) => {
                if (event === 'packaging-progress') {
                    console.log(`   📊 Progress: ${data.progress}% - ${data.message || data.status}`);
                    if (data.error) {
                        console.error(`   ❌ Error: ${data.error}`);
                    }
                }
            }
        };
        
        // Linux paketlemesini başlat
        const result = await packagingService.startPackaging(
            'test-linux-' + Date.now(),
            testParams,
            mockIo
        );
        
        console.log('\n🎉 Linux Paketleme Testi Sonuçları:');
        console.log('==========================================');
        
        if (result.linux) {
            if (result.linux.success) {
                console.log('✅ Linux paketleme BAŞARILI!');
                console.log(`   📦 Platform: ${result.linux.platform}`);
                
                if (result.linux.packages) {
                    console.log(`   📋 Paket sayısı: ${result.linux.packages.length}`);
                    result.linux.packages.forEach((pkg, index) => {
                        console.log(`   ${index + 1}. ${pkg.type}: ${pkg.filename}`);
                        console.log(`      📁 Path: ${pkg.path}`);
                        console.log(`      📊 Size: ${(pkg.size / 1024 / 1024).toFixed(2)} MB`);
                    });
                } else {
                    console.log('   ⚠️ Paket bilgileri bulunamadı');
                }
            } else {
                console.log('❌ Linux paketleme BAŞARISIZ!');
                console.log(`   🔴 Hata: ${result.linux.error}`);
                return false;
            }
        } else {
            console.log('❌ Linux paketleme sonucu bulunamadı!');
            return false;
        }
        
        // Dosya kontrolleri
        console.log('\n🔍 Dosya Kontrolleri:');
        console.log('==========================================');
        
        const tempDirs = await fs.readdir('temp');
        const linuxTempDir = tempDirs.find(dir => dir.includes('test-linux'));
        
        if (linuxTempDir) {
            const linuxOutputDir = path.join('temp', linuxTempDir, 'linux');
            if (await fs.pathExists(linuxOutputDir)) {
                const outputFiles = await fs.readdir(linuxOutputDir);
                console.log(`📂 Output dizini: ${linuxOutputDir}`);
                console.log('📋 Oluşturulan dosyalar:');
                outputFiles.forEach(file => {
                    console.log(`   - ${file}`);
                });
                
                // AppImage ve DEB kontrolü
                const appImageFile = outputFiles.find(f => f.endsWith('.AppImage'));
                const debFile = outputFiles.find(f => f.endsWith('.deb'));
                
                if (appImageFile) {
                    const appImagePath = path.join(linuxOutputDir, appImageFile);
                    const appImageStats = await fs.stat(appImagePath);
                    console.log(`✅ AppImage: ${appImageFile} (${(appImageStats.size / 1024 / 1024).toFixed(2)} MB)`);
                } else {
                    console.log('❌ AppImage dosyası bulunamadı!');
                }
                
                if (debFile) {
                    const debPath = path.join(linuxOutputDir, debFile);
                    const debStats = await fs.stat(debPath);
                    console.log(`✅ DEB: ${debFile} (${(debStats.size / 1024 / 1024).toFixed(2)} MB)`);
                } else {
                    console.log('❌ DEB dosyası bulunamadı!');
                }
            } else {
                console.log(`❌ Linux output dizini bulunamadı: ${linuxOutputDir}`);
            }
        } else {
            console.log('❌ Linux temp dizini bulunamadı!');
        }
        
        return true;
        
    } catch (error) {
        console.error('\n💥 Linux Paketleme Test Hatası:');
        console.error('==========================================');
        console.error(`🔴 Ana Hata: ${error.message}`);
        
        if (error.stack) {
            console.error('\n📍 Stack Trace:');
            console.error(error.stack);
        }
        
        return false;
    }
}

async function main() {
    console.log('🔬 LINUX PAKETLEME TEST SCRIPT');
    console.log('=====================================\n');
    
    try {
        const success = await testLinuxPackaging();
        
        console.log('\n📋 TEST ÖZETI:');
        console.log('==========================================');
        
        if (success) {
            console.log('🎯 SONUÇ: Linux paketleme TEST BAŞARILI!');
            console.log('✅ AppImage ve DEB paketleri oluşturuldu');
            console.log('✅ Tüm kontroller geçti');
        } else {
            console.log('💥 SONUÇ: Linux paketleme TEST BAŞARISIZ!');
            console.log('❌ Paketleme sırasında hata oluştu');
            console.log('🔧 Loglarda detayları kontrol edin');
        }
        
        console.log('\n🔧 Öneriler:');
        console.log('- electron-builder versiyon uyumluluğunu kontrol edin');
        console.log('- Node.js ve npm versiyonlarını güncelleyin');
        console.log('- Linux build dependencies kurulu olmalı');
        console.log('- macOS\'ta Linux build için ek konfigürasyon gerekebilir');
        
    } catch (error) {
        console.error('💥 Test script hatası:', error.message);
        process.exit(1);
    }
}

// Script'i çalıştır
if (require.main === module) {
    main();
}

module.exports = { testLinuxPackaging };