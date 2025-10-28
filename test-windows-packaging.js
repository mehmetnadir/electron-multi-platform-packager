#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const packagingService = require('./src/packaging/packagingService');

async function testWindowsPackaging() {
    console.log('🚀 Windows paketleme testi başlıyor...\n');
    
    const testJobId = `test-windows-${Date.now()}`;
    const tempPath = path.join('temp', testJobId);
    const buildPath = '/Users/nadir/01dev/elecron-paket/test-build'; // build.zip'den çıkarılmış içerik
    
    // Test için gerekli dizinleri oluştur
    fs.mkdirSync(tempPath, { recursive: true });
    
    // Build'i kopyala
    const workingPath = path.join(tempPath, 'app');
    await copyDirectory(buildPath, workingPath);
    
    console.log('📂 Build kopyalandı:', workingPath);
    
    // Test parametrelerini tanımla
    const testParams = {
        workingPath,
        tempPath,
        appName: 'Test Windows App',
        appVersion: '1.0.0',
        logoPath: null, // Logo olmadan test edelim
        options: {
            publisherName: 'Test Publisher',
            description: 'Test uygulaması'
        },
        companyName: 'Test Company',
        companyId: '001'
    };
    
    // Electron dosyalarını hazırla (package.json, main.js vb.)
    console.log('📦 Electron dosyaları hazırlanıyor...');
    await packagingService.prepareElectronFiles(
        workingPath, 
        testParams.appName, 
        testParams.appVersion, 
        testParams.companyName
    );
    
    try {
        console.log('🔧 Windows paketleme başlıyor...');
        const result = await packagingService.packageWindows(
            testParams.workingPath,
            testParams.tempPath,
            testParams.appName,
            testParams.appVersion,
            testParams.logoPath,
            testParams.options,
            testParams.companyName,
            testParams.companyId
        );
        
        console.log('✅ Windows paketleme başarılı!');
        console.log('📦 Sonuç:', JSON.stringify(result, null, 2));
        
    } catch (error) {
        console.error('❌ Windows paketleme başarısız:');
        console.error('🔍 Hata detayı:', error.message);
        console.error('📍 Stack trace:', error.stack);
    }
}

async function copyDirectory(src, dest) {
    const { spawn } = require('child_process');
    return new Promise((resolve, reject) => {
        const cp = spawn('cp', ['-r', src, dest], {
            stdio: 'inherit'
        });
        
        cp.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Failed to copy directory: ${code}`));
            }
        });
    });
}

// Test'i çalıştır
if (require.main === module) {
    testWindowsPackaging().catch(console.error);
}

module.exports = { testWindowsPackaging };