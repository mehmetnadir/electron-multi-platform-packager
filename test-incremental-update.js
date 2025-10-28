#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const packagingService = require('./src/packaging/packagingService');

async function testIncrementalUpdate() {
    console.log('🔄 Incremental Update Test başlıyor...\n');
    
    const testJobId = `test-incremental-${Date.now()}`;
    const tempPath = path.join('temp', testJobId);
    const buildPath = '/Users/nadir/01dev/elecron-paket/test-build';
    
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
        appName: 'Test Update App',
        appVersion: '1.0.0',
        logoPath: null,
        options: {
            publisherName: 'Test Publisher',
            description: 'Test update uygulaması'
        },
        companyName: 'Test Company',
        companyId: '001'
    };
    
    console.log('🔍 İlk kurulum simülasyonu...');
    
    // İlk kez karşılaştırma yap (fresh install olmalı)
    const initialUpdateInfo = await packagingService.compareWithExistingInstallation(
        testParams.workingPath, 
        testParams.appName, 
        testParams.appVersion
    );
    
    console.log('📊 İlk kurulum analizi:');
    console.log(`  - Mevcut kurulum: ${initialUpdateInfo.hasExistingInstallation}`);
    console.log(`  - Update tipi: ${initialUpdateInfo.updateType}`);
    console.log(`  - Yeni dosya sayısı: ${initialUpdateInfo.newFiles.length}`);
    
    // Aynı dosyalarla tekrar test et (identical olmalı)
    console.log('\n🔄 Aynı dosyalarla tekrar test...');
    
    const secondUpdateInfo = await packagingService.compareWithExistingInstallation(
        testParams.workingPath, 
        testParams.appName, 
        testParams.appVersion
    );
    
    console.log('📊 İkinci analiz:');
    console.log(`  - Mevcut kurulum: ${secondUpdateInfo.hasExistingInstallation}`);
    console.log(`  - Update tipi: ${secondUpdateInfo.updateType}`);
    console.log(`  - Identical: ${secondUpdateInfo.isIdentical}`);
    console.log(`  - Değişmeyen dosya: ${secondUpdateInfo.unchangedFiles.length}`);
    
    // Bir dosyayı değiştir ve tekrar test et
    console.log('\n✏️ Dosya değiştirme simülasyonu...');
    
    const testFile = path.join(workingPath, 'test-change.txt');
    await fs.writeFile(testFile, 'Bu dosya değiştirildi: ' + Date.now());
    
    const thirdUpdateInfo = await packagingService.compareWithExistingInstallation(
        testParams.workingPath, 
        testParams.appName, 
        '1.0.1' // Versiyon değiştir
    );
    
    console.log('📊 Dosya değişikliği sonrası analiz:');
    console.log(`  - Update tipi: ${thirdUpdateInfo.updateType}`);
    console.log(`  - Önceki versiyon: ${thirdUpdateInfo.previousVersion || 'yok'}`);
    console.log(`  - Yeni versiyon: ${thirdUpdateInfo.currentVersion}`);
    console.log(`  - Değişen dosya: ${thirdUpdateInfo.changedFiles.length}`);
    console.log(`  - Yeni dosya: ${thirdUpdateInfo.newFiles.length}`);
    console.log(`  - Değişmeyen dosya: ${thirdUpdateInfo.unchangedFiles.length}`);
    
    console.log('\n✅ Test tamamlandı!');
    
    // Test çıktılarını temizle
    if (await fs.pathExists(tempPath)) {
        await fs.remove(tempPath);
        console.log('🧹 Temp dosyalar temizlendi');
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
    testIncrementalUpdate().catch(console.error);
}

module.exports = { testIncrementalUpdate };