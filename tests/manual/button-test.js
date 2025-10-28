#!/usr/bin/env node

/**
 * Buton Testi - Manuel Test Helper
 * 
 * Bu script Electron uygulamasında butonların çalışıp çalışmadığını test eder.
 * Console çıktılarını gösterir.
 */

console.log('\n🧪 BUTON TESTİ - MANUEL TEST HELPER');
console.log('='.repeat(80));
console.log('\nBu test için Electron uygulamasını açın ve DevTools Console\'u kullanın.\n');

console.log('📋 TEST EDİLECEK BUTONLAR:\n');

console.log('1️⃣  KLASÖRDE GÖSTER BUTONU');
console.log('   Konum: Aktif İşlemler > Tamamlanan İş');
console.log('   Fonksiyon: app.openOutputFolder(folderPath)');
console.log('   Test Komutu:');
console.log('   ```javascript');
console.log('   app.openOutputFolder("/Users/nadir/Library/CloudStorage/GoogleDrive-nadir52@gmail.com/Drive\'ım/packager-config/output/Splash Test App_1.0.0_2025-10-27")');
console.log('   ```');
console.log('   Beklenen Console Çıktısı:');
console.log('   - 📁 Klasör açılıyor: [yol]');
console.log('   - 📁 Klasör açma sonucu: {success: true}');
console.log('   Beklenen Davranış:');
console.log('   - ✅ Finder/Explorer açılır');
console.log('   - ✅ Toast: "Klasör açıldı"\n');

console.log('2️⃣  YENİDEN İŞLE BUTONU (Aktif İşlemler)');
console.log('   Konum: Aktif İşlemler > Devam Eden İş');
console.log('   Fonksiyon: app.retryJob(jobId)');
console.log('   Test: Bir işi iptal edin, sonra "Yeniden İşle" butonuna tıklayın');
console.log('   Beklenen Console Çıktısı:');
console.log('   - 🔄 İş yeniden başlatılıyor: [jobId]');
console.log('   Beklenen Davranış:');
console.log('   - ✅ İş yeniden kuyruğa eklenir');
console.log('   - ✅ Toast: "İş yeniden başlatıldı"\n');

console.log('3️⃣  İPTAL ET BUTONU');
console.log('   Konum: Aktif İşlemler > Devam Eden İş');
console.log('   Fonksiyon: app.cancelJob(jobId)');
console.log('   Test: Bir paketleme başlatın, "İptal Et" butonuna tıklayın');
console.log('   Beklenen Console Çıktısı:');
console.log('   - ❌ İş iptal ediliyor: [jobId]');
console.log('   Beklenen Davranış:');
console.log('   - ✅ İş iptal edilir');
console.log('   - ✅ Toast: "İş iptal edildi"\n');

console.log('4️⃣  YENİDEN İŞLE BUTONU (Tamamlanan İşler)');
console.log('   Konum: Aktif İşlemler > Tamamlanan İş');
console.log('   Fonksiyon: app.reprocessJob(index)');
console.log('   Test: Tamamlanan bir işte "Yeniden İşle" butonuna tıklayın');
console.log('   Beklenen Console Çıktısı:');
console.log('   - 🔄 İş yeniden işleniyor: [index]');
console.log('   Beklenen Davranış:');
console.log('   - ✅ İş bilgileri form\'a yüklenir\n');

console.log('5️⃣  SİL BUTONU');
console.log('   Konum: Aktif İşlemler > Tamamlanan İş');
console.log('   Fonksiyon: app.deleteJob(index)');
console.log('   Test: Tamamlanan bir işte "Sil" butonuna tıklayın');
console.log('   Beklenen Console Çıktısı:');
console.log('   - 🗑️ İş siliniyor: [index]');
console.log('   Beklenen Davranış:');
console.log('   - ✅ İş listeden silinir\n');

console.log('6️⃣  DETAY BUTONU');
console.log('   Konum: Aktif İşlemler > Tamamlanan İş');
console.log('   Fonksiyon: app.showJobDetails(jobId, true)');
console.log('   Test: "Detay" butonuna tıklayın');
console.log('   Beklenen Davranış:');
console.log('   - ✅ Modal açılır ve iş detayları gösterilir\n');

console.log('='.repeat(80));
console.log('\n📝 TEST ADIMI:\n');
console.log('1. Electron uygulamasını açın: npm run electron');
console.log('2. F12 ile DevTools Console\'u açın');
console.log('3. Yukarıdaki test komutlarını Console\'a yapıştırın');
console.log('4. Her buton için console çıktısını ve davranışı kontrol edin');
console.log('5. Sonuçları kaydedin\n');

console.log('🎯 HIZLI TEST KOMUTU (Console\'a yapıştırın):\n');
console.log('```javascript');
console.log('// 1. API kontrolü');
console.log('console.log("electronAPI:", window.electronAPI);');
console.log('console.log("openFolder:", typeof window.electronAPI?.openFolder);');
console.log('');
console.log('// 2. Klasörde Göster testi');
console.log('app.openOutputFolder("/Users/nadir/Library/CloudStorage/GoogleDrive-nadir52@gmail.com/Drive\'ım/packager-config/output/Splash Test App_1.0.0_2025-10-27");');
console.log('```\n');

console.log('='.repeat(80));
console.log('✅ Test helper hazır! Yukarıdaki adımları takip edin.\n');
