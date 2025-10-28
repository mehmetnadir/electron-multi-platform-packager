#!/usr/bin/env node

/**
 * Akıllı Tahta API Test
 * Linux paketleme ve R2 upload testi
 */

require('dotenv').config();
const AkillitahtaPackagingService = require('../src/services/akillitahtaPackagingService');
const path = require('path');

async function test() {
  console.log('\n🧪 AKILLITAHta API TEST');
  console.log('='.repeat(80));

  const service = new AkillitahtaPackagingService();

  // 1. API Test
  console.log('\n1️⃣ API Bağlantı Testi...');
  try {
    await service.test();
  } catch (error) {
    console.error('❌ API bağlantı hatası!');
    console.error('Lütfen kontrol edin:');
    console.error('  - AKILLITAHTA_USERNAME');
    console.error('  - AKILLITAHTA_PASSWORD');
    console.error('  - API çalışıyor mu? https://akillitahta.ndr.ist/health');
    process.exit(1);
  }

  // 2. Linux Paketleme Testi
  console.log('\n2️⃣ Linux Paketleme Testi...');
  
  const zipPath = path.join(__dirname, '../build.zip');
  
  console.log('  ZIP:', zipPath);
  console.log('  Paketleme başlıyor...');
  console.log('  ⏳ Bu işlem 3-5 dakika sürebilir...\n');

  try {
    const result = await service.packageLinux({
      zipPath,
      bookId: '99999', // Test book ID
      appName: 'Test App',
      appVersion: '1.0.0',
      publisherName: 'Test Publisher',
      publisherId: '1',
      uploadToR2: true,
      r2ConfigId: 'default'
    });

    console.log('\n' + '='.repeat(80));
    console.log('✅ TEST BAŞARILI!');
    console.log('='.repeat(80));
    console.log('\n📦 Sonuç:');
    console.log('  - Job ID:', result.jobId);
    console.log('  - Dosya:', result.imparkFilename);
    console.log('  - R2 URL:', result.r2Url);
    console.log('\n💡 Pardus\'ta test edin:');
    console.log('  wget', result.r2Url);
    console.log('  chmod +x', result.imparkFilename);
    console.log('  ./' + result.imparkFilename);
    console.log('\n🎉 Zenity ekranı gelecek ve uygulama açılacak!\n');

  } catch (error) {
    console.error('\n❌ Paketleme hatası!');
    console.error('Hata:', error.message);
    
    if (error.response?.data) {
      console.error('API Response:', error.response.data);
    }
    
    process.exit(1);
  }
}

// Çalıştır
test().catch(error => {
  console.error('\n❌ Test hatası:', error);
  process.exit(1);
});
