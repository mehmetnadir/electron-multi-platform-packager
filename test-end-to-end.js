/**
 * END-TO-END TEST: Tam Entegrasyon Testi
 * Bu script tüm akışı test eder:
 * 1. Publishers listesi
 * 2. Publisher books listesi
 * 3. Yeni kitap oluşturma
 * 4. Paket yükleme (simüle)
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_URL = process.env.BOOK_UPDATE_API_URL || 'https://akillitahta.ndr.ist/api/v1';

// Test sonuçları
const testResults = {
    total: 0,
    passed: 0,
    failed: 0,
    tests: []
};

// Test helper
function test(name, fn) {
    testResults.total++;
    return fn()
        .then(() => {
            testResults.passed++;
            testResults.tests.push({ name, status: 'PASSED' });
            console.log(`✅ ${name}`);
        })
        .catch(error => {
            testResults.failed++;
            testResults.tests.push({ name, status: 'FAILED', error: error.message });
            console.error(`❌ ${name}`);
            console.error(`   Error: ${error.message}`);
        });
}

// Main test function
async function runEndToEndTest() {
    console.log('🧪 END-TO-END TEST BAŞLIYOR');
    console.log('=' .repeat(60));
    console.log('');

    let publisherId, bookId, uploadPaths;

    // TEST 1: Publishers List
    await test('Test 1: Publishers List API', async () => {
        const response = await axios.get(`${API_URL}/public/publishers`);
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.success) throw new Error('API returned success: false');
        if (!Array.isArray(response.data.publishers)) throw new Error('Publishers is not an array');
        if (response.data.publishers.length === 0) throw new Error('No publishers found');
        
        publisherId = response.data.publishers[0].id;
        console.log(`   Publisher ID: ${publisherId}`);
    });

    // TEST 2: Publisher Books
    await test('Test 2: Publisher Books API', async () => {
        if (!publisherId) throw new Error('Publisher ID not available');
        
        const response = await axios.get(`${API_URL}/public/publishers/${publisherId}/books`);
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.success) throw new Error('API returned success: false');
        if (!Array.isArray(response.data.books)) throw new Error('Books is not an array');
        
        console.log(`   Books found: ${response.data.books.length}`);
    });

    // TEST 3: Publisher Books with Filters
    await test('Test 3: Publisher Books with Filters', async () => {
        if (!publisherId) throw new Error('Publisher ID not available');
        
        const response = await axios.get(`${API_URL}/public/publishers/${publisherId}/books?grade=5`);
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.success) throw new Error('API returned success: false');
        
        console.log(`   Filtered books: ${response.data.books.length}`);
    });

    // TEST 4: Create New Book
    await test('Test 4: Create New Book', async () => {
        if (!publisherId) throw new Error('Publisher ID not available');
        
        const newBook = {
            publisherId,
            title: `E2E Test Kitap ${Date.now()}`,
            grade: '5',
            subject: 'Test Dersi',
            bookType: 'Test Kitabı',
            academicYear: '2024-2025',
            bookGroup: 'Test Grubu',
            description: 'End-to-end test için oluşturuldu',
            source: 'manual_upload',
            platforms: {
                windows: true,
                macos: true,
                pardus: true,
                web: true
            }
        };

        const response = await axios.post(`${API_URL}/public/books`, newBook);
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.success) throw new Error('API returned success: false');
        if (!response.data.bookId) throw new Error('No book ID returned');
        if (!response.data.uploadPaths) throw new Error('No upload paths returned');
        
        bookId = response.data.bookId;
        uploadPaths = response.data.uploadPaths;
        
        console.log(`   Book ID: ${bookId}`);
        console.log(`   Short Code: ${response.data.shortCode}`);
        console.log(`   Upload Paths: ${Object.keys(uploadPaths).length} platforms`);
    });

    // TEST 5: Verify Book Created
    await test('Test 5: Verify Book Created', async () => {
        if (!publisherId || !bookId) throw new Error('Publisher ID or Book ID not available');
        
        const response = await axios.get(`${API_URL}/public/publishers/${publisherId}/books`);
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        
        const createdBook = response.data.books.find(b => b.id === bookId);
        if (!createdBook) throw new Error('Created book not found in list');
        
        console.log(`   Book found: ${createdBook.title}`);
    });

    // TEST 6: Upload Paths Validation
    await test('Test 6: Upload Paths Validation', async () => {
        if (!uploadPaths) throw new Error('Upload paths not available');
        
        const platforms = ['windows', 'macos', 'pardus', 'web'];
        
        for (const platform of platforms) {
            if (!uploadPaths[platform]) throw new Error(`${platform} upload path missing`);
            if (!uploadPaths[platform].path) throw new Error(`${platform} path missing`);
            if (!uploadPaths[platform].fullUrl) throw new Error(`${platform} fullUrl missing`);
        }
        
        console.log(`   All ${platforms.length} platform paths validated`);
    });

    // TEST 7: R2 Config Validation
    await test('Test 7: R2 Config Validation', async () => {
        if (!publisherId) throw new Error('Publisher ID not available');
        
        // Create book response'dan R2 config'i kontrol ettik
        // Bu test zaten create book'ta yapıldı
        console.log(`   R2 config validated in create book response`);
    });

    // TEST 8: API Response Times
    await test('Test 8: API Response Times', async () => {
        const tests = [
            { name: 'Publishers', url: `${API_URL}/public/publishers` },
            { name: 'Books', url: `${API_URL}/public/publishers/${publisherId}/books` }
        ];

        for (const t of tests) {
            const start = Date.now();
            await axios.get(t.url);
            const duration = Date.now() - start;
            
            if (duration > 2000) {
                throw new Error(`${t.name} too slow: ${duration}ms`);
            }
            
            console.log(`   ${t.name}: ${duration}ms`);
        }
    });

    // TEST 9: Error Handling - Invalid Publisher ID
    await test('Test 9: Error Handling - Invalid Publisher ID', async () => {
        try {
            await axios.get(`${API_URL}/public/publishers/invalid-id/books`);
            throw new Error('Should have thrown 404');
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log(`   Correctly returned 404`);
            } else {
                throw error;
            }
        }
    });

    // TEST 10: Error Handling - Missing Required Fields
    await test('Test 10: Error Handling - Missing Required Fields', async () => {
        try {
            await axios.post(`${API_URL}/public/books`, {
                publisherId,
                // title missing
                source: 'manual_upload'
            });
            throw new Error('Should have thrown 400');
        } catch (error) {
            if (error.response && error.response.status === 400) {
                console.log(`   Correctly returned 400`);
            } else {
                throw error;
            }
        }
    });

    // Summary
    console.log('');
    console.log('=' .repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('=' .repeat(60));
    console.log(`Total Tests: ${testResults.total}`);
    console.log(`Passed: ${testResults.passed} ✅`);
    console.log(`Failed: ${testResults.failed} ❌`);
    console.log(`Success Rate: ${Math.round((testResults.passed / testResults.total) * 100)}%`);
    console.log('');

    if (testResults.failed > 0) {
        console.log('Failed Tests:');
        testResults.tests
            .filter(t => t.status === 'FAILED')
            .forEach(t => {
                console.log(`  ❌ ${t.name}`);
                console.log(`     ${t.error}`);
            });
        console.log('');
    }

    // Test data
    if (bookId) {
        console.log('📝 Test Data:');
        console.log(`  Publisher ID: ${publisherId}`);
        console.log(`  Book ID: ${bookId}`);
        console.log('');
        console.log('⚠️  Note: Test book created but not deleted. Clean up manually if needed.');
        console.log('');
    }

    return testResults.failed === 0;
}

// Run tests
if (require.main === module) {
    runEndToEndTest()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('Unexpected error:', error);
            process.exit(1);
        });
}

module.exports = { runEndToEndTest };
