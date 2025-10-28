/**
 * Test 1.3: Yeni Kitap Oluşturma API Testi
 * Bu script Book Update API'de yeni kitap oluşturur
 */

const axios = require('axios');

const API_URL = process.env.BOOK_UPDATE_API_URL || 'https://akillitahta.ndr.ist/api/v1';

async function testCreateBookAPI() {
  console.log('🧪 TEST 1.3: Yeni Kitap Oluşturma API');
  console.log('====================================');
  console.log('');
  
  try {
    // Önce yayınevlerini çek
    console.log('Adım 1: Yayınevini getir');
    console.log('------------------------');
    const publishersResponse = await axios.get(`${API_URL}/public/publishers`);
    
    if (!publishersResponse.data.success || publishersResponse.data.publishers.length === 0) {
      console.error('❌ Yayınevi bulunamadı');
      return false;
    }
    
    const firstPublisher = publishersResponse.data.publishers[0];
    console.log(`✅ Test için yayınevi: ${firstPublisher.name} (ID: ${firstPublisher.id})`);
    console.log('');
    
    // Test 1: Yeni kitap oluştur
    console.log('Test 1: Yeni Kitap Oluşturma');
    console.log('----------------------------');
    
    const newBook = {
      publisherId: firstPublisher.id,
      title: `Test Kitap ${Date.now()}`,
      grade: '5',
      subject: 'Matematik',
      bookType: 'Ders Kitabı',
      academicYear: '2024-2025',
      bookGroup: 'İlkokul',
      description: 'Electron Packager test kitabı',
      source: 'manual_upload',
      platforms: {
        windows: true,
        macos: true,
        pardus: true,
        web: true
      }
    };
    
    console.log('📡 POST /api/v1/public/books');
    console.log('Request body:', JSON.stringify(newBook, null, 2));
    console.log('');
    
    const startTime = Date.now();
    const response = await axios.post(`${API_URL}/public/books`, newBook);
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
    
    const requiredFields = ['bookId', 'shortCode', 'title', 'publisher', 'uploadPaths', 'r2Config'];
    let allFieldsPresent = true;
    
    requiredFields.forEach(field => {
      if (data[field] !== undefined) {
        const value = typeof data[field] === 'object' 
          ? JSON.stringify(data[field]).substring(0, 50) + '...'
          : data[field];
        console.log(`✅ Field '${field}': ${value}`);
      } else {
        console.log(`❌ Field '${field}': missing`);
        allFieldsPresent = false;
      }
    });
    
    if (!allFieldsPresent) {
      return false;
    }
    console.log('');
    
    // Test 3: Upload paths validation
    console.log('Test 3: Upload Paths Validation');
    console.log('--------------------------------');
    
    if (data.uploadPaths) {
      const platforms = ['windows', 'macos', 'pardus', 'web'];
      platforms.forEach(platform => {
        if (data.uploadPaths[platform]) {
          console.log(`✅ ${platform}:`);
          console.log(`   Path: ${data.uploadPaths[platform].path}`);
          console.log(`   URL: ${data.uploadPaths[platform].fullUrl}`);
        } else {
          console.log(`⚪ ${platform}: not configured`);
        }
      });
    } else {
      console.log('❌ uploadPaths missing');
      return false;
    }
    console.log('');
    
    // Test 4: R2 config validation
    console.log('Test 4: R2 Config Validation');
    console.log('----------------------------');
    
    if (data.r2Config) {
      console.log(`✅ Bucket: ${data.r2Config.bucket}`);
      console.log(`✅ Endpoint: ${data.r2Config.endpoint}`);
      console.log(`✅ Public URL: ${data.r2Config.publicUrl}`);
    } else {
      console.log('❌ r2Config missing');
      return false;
    }
    console.log('');
    
    // Test 5: Oluşturulan kitabı kontrol et
    console.log('Test 5: Kitabın Oluşturulduğunu Doğrula');
    console.log('---------------------------------------');
    
    const booksResponse = await axios.get(
      `${API_URL}/public/publishers/${firstPublisher.id}/books`
    );
    
    const createdBook = booksResponse.data.books.find(
      book => book.id === data.bookId
    );
    
    if (createdBook) {
      console.log(`✅ Kitap listede bulundu: ${createdBook.title}`);
      console.log(`   ID: ${createdBook.id}`);
      console.log(`   Grade: ${createdBook.grade}`);
      console.log(`   Subject: ${createdBook.subject}`);
    } else {
      console.log('❌ Kitap listede bulunamadı');
      return false;
    }
    console.log('');
    
    // Summary
    console.log('📊 TEST SUMMARY');
    console.log('===============');
    console.log('✅ All tests passed!');
    console.log(`   - HTTP Status: ${response.status}`);
    console.log(`   - Book ID: ${data.bookId}`);
    console.log(`   - Short Code: ${data.shortCode}`);
    console.log(`   - Title: ${data.title}`);
    console.log(`   - Publisher: ${data.publisher.name}`);
    console.log(`   - Response time: ${duration}ms`);
    console.log(`   - Upload paths: ${Object.keys(data.uploadPaths).length} platforms`);
    console.log('');
    console.log('📝 Next Steps:');
    console.log('   1. Paketleri oluştur (Windows, macOS, Pardus, Web)');
    console.log('   2. R2\'ye yükle');
    console.log('   3. Kitabı yayınla (isPublished = true)');
    console.log('');
    
    return true;
    
  } catch (error) {
    console.error('❌ TEST FAILED');
    console.error('==============');
    
    if (error.response) {
      console.error(`HTTP Status: ${error.response.status}`);
      console.error(`Response:`, JSON.stringify(error.response.data, null, 2));
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
  testCreateBookAPI()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = { testCreateBookAPI };
