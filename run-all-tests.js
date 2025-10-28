#!/usr/bin/env node

/**
 * MASTER TEST RUNNER
 * Tüm testleri sırayla çalıştırır ve sonuçları raporlar
 */

const { spawn } = require('child_process');
const path = require('path');

// Test dosyaları
const tests = [
    {
        name: 'Test 0: Local Server Integration',
        file: 'test-local-server.js',
        description: 'Local server proxy route testleri'
    },
    {
        name: 'Test 1.1: Publishers List API',
        file: 'test-publishers-api.js',
        description: 'Yayınevi listesi endpoint testi'
    },
    {
        name: 'Test 1.2: Publisher Books API',
        file: 'test-publisher-books-api.js',
        description: 'Kitap listesi endpoint testi'
    },
    {
        name: 'Test 1.3: Create Book API',
        file: 'test-create-book-api.js',
        description: 'Yeni kitap oluşturma endpoint testi'
    },
    {
        name: 'Test E2E: End-to-End Integration',
        file: 'test-end-to-end.js',
        description: 'Tam entegrasyon testi'
    }
];

// Test sonuçları
const results = {
    total: tests.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    tests: []
};

// Test çalıştır
function runTest(test) {
    return new Promise((resolve) => {
        console.log('');
        console.log('='.repeat(70));
        console.log(`🧪 ${test.name}`);
        console.log(`📝 ${test.description}`);
        console.log('='.repeat(70));
        console.log('');

        const testProcess = spawn('node', [test.file], {
            cwd: __dirname,
            stdio: 'inherit'
        });

        testProcess.on('close', (code) => {
            if (code === 0) {
                results.passed++;
                results.tests.push({ ...test, status: 'PASSED' });
                console.log('');
                console.log(`✅ ${test.name} - PASSED`);
            } else {
                results.failed++;
                results.tests.push({ ...test, status: 'FAILED', exitCode: code });
                console.log('');
                console.log(`❌ ${test.name} - FAILED (exit code: ${code})`);
            }
            resolve();
        });

        testProcess.on('error', (error) => {
            results.failed++;
            results.tests.push({ ...test, status: 'ERROR', error: error.message });
            console.log('');
            console.log(`❌ ${test.name} - ERROR: ${error.message}`);
            resolve();
        });
    });
}

// Tüm testleri çalıştır
async function runAllTests() {
    console.log('');
    console.log('🚀 MASTER TEST RUNNER');
    console.log('='.repeat(70));
    console.log(`📊 Total Tests: ${tests.length}`);
    console.log(`⏰ Started: ${new Date().toLocaleString('tr-TR')}`);
    console.log('='.repeat(70));

    const startTime = Date.now();

    // Testleri sırayla çalıştır
    for (const test of tests) {
        await runTest(test);
    }

    const duration = Date.now() - startTime;

    // Özet rapor
    console.log('');
    console.log('');
    console.log('='.repeat(70));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total Tests:    ${results.total}`);
    console.log(`Passed:         ${results.passed} ✅`);
    console.log(`Failed:         ${results.failed} ❌`);
    console.log(`Success Rate:   ${Math.round((results.passed / results.total) * 100)}%`);
    console.log(`Duration:       ${Math.round(duration / 1000)}s`);
    console.log(`Finished:       ${new Date().toLocaleString('tr-TR')}`);
    console.log('='.repeat(70));
    console.log('');

    // Detaylı sonuçlar
    console.log('📋 DETAILED RESULTS:');
    console.log('');
    results.tests.forEach((test, index) => {
        const icon = test.status === 'PASSED' ? '✅' : '❌';
        console.log(`${index + 1}. ${icon} ${test.name}`);
        console.log(`   Status: ${test.status}`);
        if (test.exitCode) console.log(`   Exit Code: ${test.exitCode}`);
        if (test.error) console.log(`   Error: ${test.error}`);
        console.log('');
    });

    // Başarısız testler
    if (results.failed > 0) {
        console.log('❌ FAILED TESTS:');
        console.log('');
        results.tests
            .filter(t => t.status !== 'PASSED')
            .forEach(test => {
                console.log(`  • ${test.name}`);
                console.log(`    File: ${test.file}`);
                if (test.error) console.log(`    Error: ${test.error}`);
                console.log('');
            });
    }

    // UI Test Hatırlatması
    console.log('');
    console.log('📝 MANUAL UI TESTS:');
    console.log('');
    console.log('  UI testleri manuel olarak yapılmalıdır.');
    console.log('  Test rehberi: test-ui-integration.md');
    console.log('');
    console.log('  Adımlar:');
    console.log('  1. npm start');
    console.log('  2. http://localhost:3000');
    console.log('  3. test-ui-integration.md dosyasını takip et');
    console.log('');

    // Sonuç
    console.log('='.repeat(70));
    if (results.failed === 0) {
        console.log('🎉 ALL TESTS PASSED!');
    } else {
        console.log('⚠️  SOME TESTS FAILED!');
    }
    console.log('='.repeat(70));
    console.log('');

    // Exit code
    process.exit(results.failed > 0 ? 1 : 0);
}

// Çalıştır
if (require.main === module) {
    runAllTests().catch(error => {
        console.error('Unexpected error:', error);
        process.exit(1);
    });
}

module.exports = { runAllTests };
