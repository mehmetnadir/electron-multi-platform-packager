/**
 * LOCAL SERVER INTEGRATION TEST
 * Bu test local server'ın proxy route'larını test eder
 * Gerçek kullanıcı deneyimini simüle eder
 */

const axios = require('axios');

const LOCAL_SERVER = 'http://localhost:3000';

async function testLocalServer() {
    console.log('🧪 LOCAL SERVER INTEGRATION TEST');
    console.log('='.repeat(60));
    console.log('');

    let publisherId;
    const results = { total: 0, passed: 0, failed: 0 };

    // Test 1: Publishers endpoint (local proxy)
    try {
        results.total++;
        console.log('Test 1: GET /api/akillitahta/publishers');
        console.log('-'.repeat(60));
        
        const response = await axios.get(`${LOCAL_SERVER}/api/akillitahta/publishers`);
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.success) throw new Error('success: false');
        if (!response.data.publishers.length) throw new Error('No publishers');
        
        publisherId = response.data.publishers[0].id;
        
        console.log(`✅ PASSED`);
        console.log(`   Publishers: ${response.data.publishers.length}`);
        console.log(`   First: ${response.data.publishers[0].name}`);
        console.log('');
        results.passed++;
    } catch (error) {
        console.log(`❌ FAILED: ${error.message}`);
        console.log('');
        results.failed++;
    }

    // Test 2: Publisher books endpoint (local proxy)
    try {
        results.total++;
        console.log('Test 2: GET /api/akillitahta/publishers/:id/books');
        console.log('-'.repeat(60));
        
        if (!publisherId) throw new Error('No publisher ID from previous test');
        
        const response = await axios.get(
            `${LOCAL_SERVER}/api/akillitahta/publishers/${publisherId}/books`
        );
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.success) throw new Error('success: false');
        if (!Array.isArray(response.data.books)) throw new Error('books not array');
        
        console.log(`✅ PASSED`);
        console.log(`   Books: ${response.data.books.length}`);
        console.log(`   Publisher: ${response.data.publisher.name}`);
        console.log('');
        results.passed++;
    } catch (error) {
        console.log(`❌ FAILED: ${error.message}`);
        console.log('');
        results.failed++;
    }

    // Test 3: Publisher books with filters (local proxy)
    try {
        results.total++;
        console.log('Test 3: GET /api/akillitahta/publishers/:id/books?grade=5');
        console.log('-'.repeat(60));
        
        if (!publisherId) throw new Error('No publisher ID from previous test');
        
        const response = await axios.get(
            `${LOCAL_SERVER}/api/akillitahta/publishers/${publisherId}/books?grade=5`
        );
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.success) throw new Error('success: false');
        
        console.log(`✅ PASSED`);
        console.log(`   Filtered books: ${response.data.books.length}`);
        console.log(`   Filter: grade=5`);
        console.log('');
        results.passed++;
    } catch (error) {
        console.log(`❌ FAILED: ${error.message}`);
        console.log('');
        results.failed++;
    }

    // Test 4: Books page HTML
    try {
        results.total++;
        console.log('Test 4: GET /books (HTML page)');
        console.log('-'.repeat(60));
        
        const response = await axios.get(`${LOCAL_SERVER}/books`);
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.includes('Kitap Yönetimi')) throw new Error('Wrong page');
        
        console.log(`✅ PASSED`);
        console.log(`   Page loaded successfully`);
        console.log('');
        results.passed++;
    } catch (error) {
        console.log(`❌ FAILED: ${error.message}`);
        console.log('');
        results.failed++;
    }

    // Test 5: New book page HTML
    try {
        results.total++;
        console.log('Test 5: GET /new-book.html (HTML page)');
        console.log('-'.repeat(60));
        
        const response = await axios.get(`${LOCAL_SERVER}/new-book.html`);
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.includes('Yeni Kitap Ekle')) throw new Error('Wrong page');
        
        console.log(`✅ PASSED`);
        console.log(`   Page loaded successfully`);
        console.log('');
        results.passed++;
    } catch (error) {
        console.log(`❌ FAILED: ${error.message}`);
        console.log('');
        results.failed++;
    }

    // Test 6: Package book page HTML
    try {
        results.total++;
        console.log('Test 6: GET /package-book.html (HTML page)');
        console.log('-'.repeat(60));
        
        const response = await axios.get(`${LOCAL_SERVER}/package-book.html`);
        
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (!response.data.includes('Kitap Paketleme')) throw new Error('Wrong page');
        
        console.log(`✅ PASSED`);
        console.log(`   Page loaded successfully`);
        console.log('');
        results.passed++;
    } catch (error) {
        console.log(`❌ FAILED: ${error.message}`);
        console.log('');
        results.failed++;
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
        console.log('  2. Missing route in server');
        console.log('  3. API endpoint error');
        console.log('  4. Network issue');
        console.log('');
    } else {
        console.log('🎉 ALL TESTS PASSED!');
        console.log('');
    }

    return results.failed === 0;
}

// Run
if (require.main === module) {
    testLocalServer()
        .then(success => process.exit(success ? 0 : 1))
        .catch(error => {
            console.error('Unexpected error:', error);
            process.exit(1);
        });
}

module.exports = { testLocalServer };
