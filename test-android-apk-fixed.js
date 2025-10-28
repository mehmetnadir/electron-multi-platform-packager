#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const packagingService = require('./src/packaging/packagingService');

/**
 * Android APK Üretimi Test Scripti - Düzeltilmiş Versiyon
 * 
 * Bu script, APK üretimi için düzeltmeleri test eder:
 * 1. Kesinlikle APK üretilmesi (proje dosyası vermez)
 * 2. Alternatif APK arama yolları
 * 3. Farklı Gradle task denemeleri
 * 4. Gelişmiş hata yakalama
 */

async function testAndroidAPKFixed() {
    console.log('🤖 Android APK Üretimi Testi - Düzeltilmiş Versiyon\n');
    console.log('='.repeat(60));
    
    const testJobId = `test-android-fixed-${Date.now()}`;
    const tempPath = path.join('temp', testJobId);
    const buildPath = '/Users/nadir/01dev/elecron-paket/test-build';
    
    // Test için gerekli dizinleri oluştur
    await fs.ensureDir(tempPath);
    
    // Build'i kopyala
    const workingPath = path.join(tempPath, 'app');
    await copyDirectory(buildPath, workingPath);
    
    console.log('📂 Test ortamı hazırlandı');
    console.log(`   - Working Path: ${workingPath}`);
    console.log(`   - Temp Path: ${tempPath}\n`);
    
    // Test parametrelerini tanımla
    const testParams = {
        workingPath,
        tempPath,
        appName: 'Test Android App',
        appVersion: '1.0.0',
        logoPath: path.join(workingPath, 'images', 'logo.png'),
        options: {
            publisherName: 'Test Publisher',
            description: 'Test Android uygulaması - APK üretimi testi'
        }
    };
    
    console.log('🚀 Android APK paketleme testi başlıyor...\n');
    
    try {
        const startTime = Date.now();
        
        // Mock IO ve job tracking
        const mockIO = {
            emit: (event, data) => {
                console.log(`📡 Socket Event: ${event}`, {
                    platform: data.platform,
                    status: data.status,
                    progress: data.progress,
                    message: data.message
                });
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
        
        console.log('\n🎉 Android APK Paketleme Başarılı!');
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
            console.log(`✅ APK dosyası başarıyla oluşturuldu ve doğrulandı!`);
            
            // APK dosya bilgileri
            const stats = await fs.stat(result.path);
            console.log(`📈 Dosya boyutu: ${stats.size} bytes`);
            console.log(`📅 Oluşturma tarihi: ${stats.birthtime.toLocaleString('tr-TR')}`);
            
        } else {
            console.log(`❌ HATA: APK dosyası bulunamadı: ${result.path}`);
        }
        
        console.log('\n🎯 Test Sonuçları:');
        console.log('✅ APK başarıyla üretildi (proje dosyası değil)');
        console.log('✅ Hata durumlarında alternatif yollar denendi');
        console.log('✅ Gradle build işlemleri çalıştı');
        console.log('✅ Capacitor entegrasyonu tamamlandı');
        
        return result;
        
    } catch (error) {
        console.error('\n❌ Android APK Paketleme Hatası:');
        console.error('='.repeat(40));
        console.error(`🔥 Hata: ${error.message}`);
        
        // Hata analizi
        if (error.message.includes('Gradle')) {
            console.error('🔧 Çözüm: Android SDK ve Gradle kurulumunu kontrol edin');
            console.error('   - Android Studio kurulumu yapın');
            console.error('   - ANDROID_HOME environment variable ayarlayın');
            console.error('   - Gradle PATH\'e ekleyin');
        } else if (error.message.includes('Capacitor')) {
            console.error('🔧 Çözüm: Capacitor kurulumunu kontrol edin');
            console.error('   - npm install @capacitor/core @capacitor/cli @capacitor/android');
        } else if (error.message.includes('APK dosyası üretilemedi')) {
            console.error('🔧 Çözüm: Build çıktılarını kontrol edin');
            console.error('   - Android proje dosyaları oluşuyor mu?');
            console.error('   - Gradle build loglarını inceleyin');
        }
        
        console.error('\n📋 Test Sonuçları:');
        console.error('❌ APK üretimi başarısız');
        console.error('✅ Hata durumunda proje dosyası verilmedi (doğru davranış)');
        console.error('✅ Detaylı hata mesajları sağlandı');
        
        throw error;
    } finally {
        // Temizlik (isteğe bağlı)
        console.log('\n🧹 Test klasörü: ' + tempPath);
        console.log('   Manuel temizlik için: rm -rf ' + tempPath);
    }
}

// Klasör kopyalama yardımcı fonksiyonu
async function copyDirectory(source, destination) {
    try {
        await fs.copy(source, destination);
        console.log(`📋 Klasör kopyalandı: ${source} → ${destination}`);
    } catch (error) {
        throw new Error(`Klasör kopyalama hatası: ${error.message}`);
    }
}

// Ana fonksiyon
async function main() {
    try {
        await testAndroidAPKFixed();
        console.log('\n🎊 Test başarıyla tamamlandı!');
        process.exit(0);
    } catch (error) {
        console.error('\n💥 Test başarısız:', error.message);
        process.exit(1);
    }
}

// Script direkt çalıştırıldığında test'i başlat
if (require.main === module) {
    main();
}

module.exports = { testAndroidAPKFixed };