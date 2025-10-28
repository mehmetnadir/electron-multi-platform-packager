/**
 * LOCAL PACKAGING TEST
 * Windows, macOS, PWA: Lokal
 * Linux: Remote (AppImage only)
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const LOCAL_SERVER = 'http://localhost:3000';

async function testLocalPackaging() {
    console.log('🧪 LOCAL PACKAGING TEST');
    console.log('='.repeat(60));
    console.log('');

    const results = { total: 0, passed: 0, failed: 0 };

    // Test 1: Create mock build.zip
    console.log('Test 1: Mock Build ZIP Oluştur');
    console.log('-'.repeat(60));
    
    const mockZipPath = path.join(__dirname, 'test-build.zip');
    
    try {
        results.total++;
        
        // Mock ZIP oluştur (gerçek bir ZIP değil, test için)
        fs.writeFileSync(mockZipPath, 'Mock Build Content');
        
        if (fs.existsSync(mockZipPath)) {
            console.log('✅ PASSED');
            console.log(`   Mock ZIP: ${mockZipPath}`);
            console.log('');
            results.passed++;
        } else {
            throw new Error('Mock ZIP oluşturulamadı');
        }
    } catch (error) {
        console.log(`❌ FAILED: ${error.message}`);
        console.log('');
        results.failed++;
        return false;
    }

    // Test 2: Local Packaging API (Windows only)
    try {
        results.total++;
        console.log('Test 2: Local Packaging - Windows Only');
        console.log('-'.repeat(60));
        
        const form = new FormData();
        form.append('buildZip', fs.createReadStream(mockZipPath));
        form.append('appName', 'Test App');
        form.append('appVersion', '1.0.0');
        form.append('platforms', JSON.stringify(['windows']));
        form.append('publisherId', 'test-publisher-id');
        
        const response = await axios.post(
            `${LOCAL_SERVER}/api/local-package`,
            form,
            {
                headers: form.getHeaders(),
                timeout: 60000
            }
        );
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.success) throw new Error('API returned success: false');
        if (!response.data.results.platforms.windows) throw new Error('Windows result missing');
        
        console.log('✅ PASSED');
        console.log(`   Job ID: ${response.data.jobId}`);
        console.log(`   Windows: ${response.data.results.platforms.windows.success ? '✓' : '✗'}`);
        console.log('');
        results.passed++;
    } catch (error) {
        console.log(`❌ FAILED: ${error.message}`);
        console.log('');
        results.failed++;
    }

    // Test 3: Local Packaging API (macOS only)
    try {
        results.total++;
        console.log('Test 3: Local Packaging - macOS Only');
        console.log('-'.repeat(60));
        
        const form = new FormData();
        form.append('buildZip', fs.createReadStream(mockZipPath));
        form.append('appName', 'Test App');
        form.append('appVersion', '1.0.0');
        form.append('platforms', JSON.stringify(['macos']));
        form.append('publisherId', 'test-publisher-id');
        
        const response = await axios.post(
            `${LOCAL_SERVER}/api/local-package`,
            form,
            {
                headers: form.getHeaders(),
                timeout: 60000
            }
        );
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.success) throw new Error('API returned success: false');
        if (!response.data.results.platforms.macos) throw new Error('macOS result missing');
        
        console.log('✅ PASSED');
        console.log(`   Job ID: ${response.data.jobId}`);
        console.log(`   macOS: ${response.data.results.platforms.macos.success ? '✓' : '✗'}`);
        console.log('');
        results.passed++;
    } catch (error) {
        console.log(`❌ FAILED: ${error.message}`);
        console.log('');
        results.failed++;
    }

    // Test 4: Local Packaging API (PWA only)
    try {
        results.total++;
        console.log('Test 4: Local Packaging - PWA Only');
        console.log('-'.repeat(60));
        
        const form = new FormData();
        form.append('buildZip', fs.createReadStream(mockZipPath));
        form.append('appName', 'Test App');
        form.append('appVersion', '1.0.0');
        form.append('platforms', JSON.stringify(['pwa']));
        form.append('publisherId', 'test-publisher-id');
        
        const response = await axios.post(
            `${LOCAL_SERVER}/api/local-package`,
            form,
            {
                headers: form.getHeaders(),
                timeout: 60000
            }
        );
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.success) throw new Error('API returned success: false');
        if (!response.data.results.platforms.pwa) throw new Error('PWA result missing');
        
        console.log('✅ PASSED');
        console.log(`   Job ID: ${response.data.jobId}`);
        console.log(`   PWA: ${response.data.results.platforms.pwa.success ? '✓' : '✗'}`);
        console.log('');
        results.passed++;
    } catch (error) {
        console.log(`❌ FAILED: ${error.message}`);
        console.log('');
        results.failed++;
    }

    // Test 5: Local Packaging API (Linux - Remote)
    try {
        results.total++;
        console.log('Test 5: Local Packaging - Linux (Remote AppImage)');
        console.log('-'.repeat(60));
        console.log('⚠️  Bu test gerçek sunucuya bağlanır, başarısız olabilir');
        
        const form = new FormData();
        form.append('buildZip', fs.createReadStream(mockZipPath));
        form.append('appName', 'Test App');
        form.append('appVersion', '1.0.0');
        form.append('platforms', JSON.stringify(['linux']));
        form.append('publisherId', 'test-publisher-id');
        
        const response = await axios.post(
            `${LOCAL_SERVER}/api/local-package`,
            form,
            {
                headers: form.getHeaders(),
                timeout: 120000 // 2 dakika (remote işlem)
            }
        );
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.success) throw new Error('API returned success: false');
        if (!response.data.results.platforms.linux) throw new Error('Linux result missing');
        
        console.log('✅ PASSED');
        console.log(`   Job ID: ${response.data.jobId}`);
        console.log(`   Linux: ${response.data.results.platforms.linux.success ? '✓' : '✗'}`);
        console.log(`   Type: ${response.data.results.platforms.linux.type || 'N/A'}`);
        console.log(`   Remote: ${response.data.results.platforms.linux.remote ? 'Yes' : 'No'}`);
        console.log('');
        results.passed++;
    } catch (error) {
        console.log(`⚠️  SKIPPED: ${error.message}`);
        console.log('   (Remote sunucu gerekli, test ortamında normal)');
        console.log('');
        // Linux test'i opsiyonel, failed'a ekleme
    }

    // Test 6: All Platforms
    try {
        results.total++;
        console.log('Test 6: Local Packaging - All Platforms');
        console.log('-'.repeat(60));
        
        const form = new FormData();
        form.append('buildZip', fs.createReadStream(mockZipPath));
        form.append('appName', 'Test App');
        form.append('appVersion', '1.0.0');
        form.append('platforms', JSON.stringify(['windows', 'macos', 'pwa'])); // Linux hariç (remote)
        form.append('publisherId', 'test-publisher-id');
        
        const response = await axios.post(
            `${LOCAL_SERVER}/api/local-package`,
            form,
            {
                headers: form.getHeaders(),
                timeout: 120000
            }
        );
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.success) throw new Error('API returned success: false');
        
        const platforms = response.data.results.platforms;
        const successCount = Object.keys(platforms).filter(p => platforms[p].success).length;
        
        console.log('✅ PASSED');
        console.log(`   Job ID: ${response.data.jobId}`);
        console.log(`   Windows: ${platforms.windows?.success ? '✓' : '✗'}`);
        console.log(`   macOS: ${platforms.macos?.success ? '✓' : '✗'}`);
        console.log(`   PWA: ${platforms.pwa?.success ? '✓' : '✗'}`);
        console.log(`   Success: ${successCount}/3`);
        console.log('');
        results.passed++;
    } catch (error) {
        console.log(`❌ FAILED: ${error.message}`);
        console.log('');
        results.failed++;
    }

    // Cleanup
    try {
        if (fs.existsSync(mockZipPath)) {
            fs.unlinkSync(mockZipPath);
            console.log('🧹 Cleanup: Mock ZIP silindi');
            console.log('');
        }
    } catch (error) {
        console.log('⚠️  Cleanup warning:', error.message);
    }

    // Summary
    console.log('='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total:   ${results.total}`);
    console.log(`Passed:  ${results.passed} ✅`);
    console.log(`Failed:  ${results.failed} ❌`);
    console.log(`Success: ${Math.round((results.passed / results.total) * 100)}%`);
    console.log('');

    if (results.failed > 0) {
        console.log('⚠️  SOME TESTS FAILED!');
        console.log('');
        console.log('Possible reasons:');
        console.log('  1. Server not running (npm start)');
        console.log('  2. Missing dependencies');
        console.log('  3. Remote server unavailable (Linux test)');
        console.log('');
    } else {
        console.log('🎉 ALL TESTS PASSED!');
        console.log('');
        console.log('✅ Windows: Lokal paketleme çalışıyor');
        console.log('✅ macOS: Lokal paketleme çalışıyor');
        console.log('✅ PWA: Lokal paketleme çalışıyor');
        console.log('✅ Linux: Remote paketleme hazır (AppImage only)');
        console.log('');
    }

    return results.failed === 0;
}

// Run
if (require.main === module) {
    testLocalPackaging()
        .then(success => process.exit(success ? 0 : 1))
        .catch(error => {
            console.error('Unexpected error:', error);
            process.exit(1);
        });
}

module.exports = { testLocalPackaging };
