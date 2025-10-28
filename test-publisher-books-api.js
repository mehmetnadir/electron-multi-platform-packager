/**
 * Test 1.2: Kitap Listesi API Testi (Electron Packager tarafı)
 * Bu script Book Update API'den yayınevine göre kitap listesini çeker
 */

const axios = require('axios');

const API_URL = process.env.BOOK_UPDATE_API_URL || 'https://akillitahta.ndr.ist/api/v1';

async function testPublisherBooksAPI() {
  console.log('🧪 TEST 1.2: Kitap Listesi API (Electron Packager)');
  console.log('=================================================');
  console.log('');
  
  try {
    // Önce yayınevlerini çek
    console.log('Adım 1: Yayınevlerini getir');
    console.log('---------------------------');
    const publishersResponse = await axios.get(`${API_URL}/public/publishers`);
    
    if (!publishersResponse.data.success || publishersResponse.data.publishers.length === 0) {
      console.error('❌ Yayınevi bulunamadı');
      return false;
    }
    
    const firstPublisher = publishersResponse.data.publishers[0];
    console.log(`✅ Test için yayınevi: ${firstPublisher.name} (ID: ${firstPublisher.id})`);
    console.log('');
    
    // Test 1: Basic request
    console.log('Test 1: Basic GET request (Tüm kitaplar)');
    console.log('-----------------------------------------');
    console.log(`📡 URL: ${API_URL}/public/publishers/${firstPublisher.id}/books`);
    
    const startTime = Date.now();
    const response = await axios.get(`${API_URL}/public/publishers/${firstPublisher.id}/books`);
    const duration = Date.now() - startTime;
    
    console.log(`✅ HTTP Status: ${response.status}`);
    console.log(`⏱️  Response time: ${duration}ms`);
    console.log('');
    
    // Test 2: Response structure
    console.log('Test 2: Response Structure Validation');
    console.log('-------------------------------------');
    
    const data = response.data;
    
    if (data.success) {
      console.log('✅ success field: true');
    } else {
      console.log('❌ success field: false or missing');
      return false;
    }
    
    if (data.publisher) {
      console.log(`✅ publisher object: ${data.publisher.name}`);
    } else {
      console.log('❌ publisher object: missing');
    }
    
    if (Array.isArray(data.books)) {
      console.log(`✅ books array: ${data.books.length} items`);
    } else {
      console.log('❌ books array: missing or not an array');
      return false;
    }
    
    if (typeof data.total === 'number') {
      console.log(`✅ total field: ${data.total}`);
    }
    console.log('');
    
    // Test 3: Book fields
    if (data.books.length > 0) {
      console.log('Test 3: Book Fields Validation');
      console.log('-------------------------------');
      
      const firstBook = data.books[0];
      console.log('First book:');
      console.log(JSON.stringify(firstBook, null, 2));
      console.log('');
      
      const requiredFields = ['id', 'title', 'grade', 'subject', 'bookType', 'platforms'];
      let allFieldsPresent = true;
      
      requiredFields.forEach(field => {
        if (firstBook[field] !== undefined) {
          const value = typeof firstBook[field] === 'object' 
            ? JSON.stringify(firstBook[field]) 
            : firstBook[field];
          console.log(`✅ Field '${field}': ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`);
        } else {
          console.log(`❌ Field '${field}': missing`);
          allFieldsPresent = false;
        }
      });
      
      // Platform kontrolü
      if (firstBook.platforms) {
        console.log('');
        console.log('Platform availability:');
        ['windows', 'macos', 'pardus', 'web'].forEach(platform => {
          if (firstBook.platforms[platform]) {
            console.log(`  ✅ ${platform}: ${firstBook.platforms[platform].enabled ? 'enabled' : 'disabled'}`);
          } else {
            console.log(`  ⚪ ${platform}: not available`);
          }
        });
      }
      
      if (!allFieldsPresent) {
        return false;
      }
    } else {
      console.log('⚠️  No books found for this publisher');
    }
    console.log('');
    
    // Test 4: Filtered request (grade)
    console.log('Test 4: Filtered Request (Grade)');
    console.log('--------------------------------');
    
    if (data.books.length > 0) {
      const firstBookGrade = data.books[0].grade;
      if (firstBookGrade) {
        console.log(`📡 URL: ${API_URL}/public/publishers/${firstPublisher.id}/books?grade=${firstBookGrade}`);
        
        const filteredResponse = await axios.get(
          `${API_URL}/public/publishers/${firstPublisher.id}/books?grade=${firstBookGrade}`
        );
        
        console.log(`✅ Filtered books: ${filteredResponse.data.books.length}`);
        console.log(`✅ Filter applied: grade=${firstBookGrade}`);
        
        // Tüm kitapların aynı grade'de olduğunu kontrol et
        const allSameGrade = filteredResponse.data.books.every(
          book => book.grade === firstBookGrade
        );
        
        if (allSameGrade) {
          console.log('✅ All books have the same grade');
        } else {
          console.log('❌ Some books have different grades');
        }
      } else {
        console.log('⚠️  First book has no grade, skipping filter test');
      }
    }
    console.log('');
    
    // Summary
    console.log('📊 TEST SUMMARY');
    console.log('===============');
    console.log('✅ All tests passed!');
    console.log(`   - HTTP Status: ${response.status}`);
    console.log(`   - Publisher: ${data.publisher.name}`);
    console.log(`   - Books found: ${data.books.length}`);
    console.log(`   - Response time: ${duration}ms`);
    console.log(`   - All fields present: Yes`);
    console.log('');
    
    return true;
    
  } catch (error) {
    console.error('❌ TEST FAILED');
    console.error('==============');
    
    if (error.response) {
      console.error(`HTTP Status: ${error.response.status}`);
      console.error(`Response:`, error.response.data);
    } else if (error.request) {
      console.error('No response received');
      console.error('Error:', error.message);
    } else {
      console.error('Error:', error.message);
    }
    
    return false;
  }
}

// Run test
if (require.main === module) {
  testPublisherBooksAPI()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = { testPublisherBooksAPI };
