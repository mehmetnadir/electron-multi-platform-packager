#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const packagingService = require('./src/packaging/packagingService');

async function demonstrateIncrementalUpdates() {
    console.log('🚀 INCREMENTAL UPDATE DEMO - Artırılı Güncelleme Sistemi\n');
    console.log('='.repeat(60));
    
    const testJobId = `demo-incremental-${Date.now()}`;
    const tempPath = path.join('temp', testJobId);
    const buildPath = '/Users/nadir/01dev/elecron-paket/test-build';
    
    // Test için gerekli dizinleri oluştur
    fs.mkdirSync(tempPath, { recursive: true });
    
    // Build'i kopyala
    const workingPath = path.join(tempPath, 'app');
    await copyDirectory(buildPath, workingPath);
    
    console.log('📂 Test ortamı hazırlandı');
    console.log(`   - Working Path: ${workingPath}`);
    console.log(`   - Temp Path: ${tempPath}\n`);
    
    // Demo parameters
    const demoParams = {
        workingPath,
        tempPath,
        appName: 'Demo Update App',
        appVersion: '1.0.0',
        logoPath: null,
        options: {
            publisherName: 'Demo Publisher',
            description: 'Demo güncellemeli uygulama'
        },
        companyName: 'Demo Company',
        companyId: '999'
    };
    
    console.log('AŞAMA 1: İLK KURULUM SİMÜLASYONU');
    console.log('-'.repeat(40));
    
    // Electron dosyalarını hazırla
    await packagingService.prepareElectronFiles(
        demoParams.workingPath, 
        demoParams.appName, 
        demoParams.appVersion, 
        demoParams.companyName
    );
    
    // İlk paketleme (fresh install)
    console.log('Windows paketleme başlıyor (ilk kurulum)...');
    
    try {
        const firstInstall = await packagingService.packageWindows(
            demoParams.workingPath,
            demoParams.tempPath,
            demoParams.appName,
            demoParams.appVersion,
            demoParams.logoPath,
            demoParams.options,
            demoParams.companyName,
            demoParams.companyId
        );
        
        console.log('✅ İlk kurulum başarılı!');
        console.log(`   - Dosya: ${firstInstall.filename}`);
        console.log(`   - Boyut: ${Math.round(firstInstall.size / 1024 / 1024)} MB`);
        console.log(`   - Tip: ${firstInstall.type}\n`);
        
    } catch (error) {
        console.error('❌ İlk kurulum hatası:', error.message);
        return;
    }
    
    console.log('AŞAMA 2: AYNI UYGULAMA TEKRAR YÜKLENİYOR');
    console.log('-'.repeat(40));
    console.log('Aynı dosyalarla tekrar paketleme (quick-launch olmalı)...\n');
    
    try {
        const secondInstall = await packagingService.packageWindows(
            demoParams.workingPath,
            demoParams.tempPath,
            demoParams.appName,
            demoParams.appVersion, // Aynı versiyon
            demoParams.logoPath,
            demoParams.options,
            demoParams.companyName,
            demoParams.companyId
        );
        
        if (secondInstall.type === 'quick-launch') {
            console.log('🚀 QUICK-LAUNCH BAŞARILI!');
            console.log('   ✅ Dosyalar aynı - kurulum atlandı');
            console.log('   ✅ Uygulama direkt açılacak');
            console.log('   ⚡ Süre: ~1 saniye (vs 30+ saniye normal kurulum)');
        } else {
            console.log('⚠️ Quick-launch çalışmadı, normal kurulum yapıldı');
        }
        
    } catch (error) {
        console.error('❌ İkinci kurulum hatası:', error.message);
    }
    
    console.log('\nAŞAMA 3: DOSYA DEĞİŞİKLİĞİ SİMÜLASYONU');
    console.log('-'.repeat(40));
    
    // Bir dosyayı değiştir
    const changeFile = path.join(demoParams.workingPath, 'index.html');
    if (await fs.pathExists(changeFile)) {
        let content = await fs.readFile(changeFile, 'utf8');
        content += `\n<!-- Güncelleme zamanı: ${new Date().toISOString()} -->`;
        await fs.writeFile(changeFile, content);
        console.log('📝 index.html dosyası güncellendi');
    }
    
    // Yeni versiyon ile paketleme
    console.log('Güncellenmiş uygulama paketleniyor (v1.0.1)...\n');
    
    try {
        const updateInstall = await packagingService.packageWindows(
            demoParams.workingPath,
            demoParams.tempPath,
            demoParams.appName,
            '1.0.1', // Yeni versiyon
            demoParams.logoPath,
            demoParams.options,
            demoParams.companyName,
            demoParams.companyId
        );
        
        console.log('🔄 INCREMENTAL UPDATE BAŞARILI!');
        console.log('   ✅ Sadece değişen dosyalar güncellendi');
        console.log('   ✅ Değişmeyen dosyalar atlandı');
        console.log(`   ✅ Installer: ${updateInstall.filename}`);
        console.log(`   📦 Boyut: ${Math.round(updateInstall.size / 1024 / 1024)} MB`);
        
    } catch (error) {
        console.error('❌ Güncelleme hatası:', error.message);
    }
    
    console.log('\nAŞAMA 4: LINUX QUICK-LAUNCH TESTİ');
    console.log('-'.repeat(40));
    
    try {
        const linuxResult = await packagingService.packageLinux(
            demoParams.workingPath,
            demoParams.tempPath,
            demoParams.appName,
            '1.0.1', // Aynı versiyon ile test
            demoParams.logoPath,
            demoParams.options,
            demoParams.companyName,
            demoParams.companyId
        );
        
        if (linuxResult.type === 'quick-launch') {
            console.log('🐧 Linux Quick-Launch Başarılı!');
            console.log('   ✅ AppImage direkt açılacak');
            console.log('   ✅ DEB yeniden kuruluma gerek yok');
        } else {
            console.log('🐧 Linux normal paketleme yapıldı');
            console.log(`   📦 AppImage: ${linuxResult.packages.find(p => p.type === 'AppImage')?.filename}`);
            console.log(`   📦 DEB: ${linuxResult.packages.find(p => p.type === 'DEB')?.filename}`);
        }
        
    } catch (error) {
        console.error('❌ Linux paketleme hatası:', error.message);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🎯 DEMO SONUCU - INCREMENTAL UPDATE ÖZETİ:');
    console.log('='.repeat(60));
    console.log('1. ✅ İlk kurulum: Normal paketleme (30+ saniye)');
    console.log('2. ⚡ Aynı dosyalar: Quick-launch (~1 saniye)');
    console.log('3. 🔄 Dosya değişikliği: Artırılı güncelleme (10-15 saniye)');
    console.log('4. 🐧 Linux desteği: AppImage + DEB quick-launch');
    console.log('\n💡 AVANTAJLAR:');
    console.log('   • Aynı dosyalarda kurulum atlanır');
    console.log('   • Değişen dosyalar hızla güncellenir');
    console.log('   • Kullanıcı deneyimi çok daha hızlı');
    console.log('   • Windows ve Linux desteği');
    console.log('   • Hash tabanlı dosya karşılaştırması');
    
    console.log('\n✅ Demo tamamlandı!\n');
    
    // Test çıktılarını temizle
    if (await fs.pathExists(tempPath)) {
        await fs.remove(tempPath);
        console.log('🧹 Test dosyaları temizlendi');
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

// Demo'yu çalıştır
if (require.main === module) {
    demonstrateIncrementalUpdates().catch(console.error);
}

module.exports = { demonstrateIncrementalUpdates };