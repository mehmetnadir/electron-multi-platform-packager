/**
 * Test 1.1: Yayınevi Listesi API Testi (Electron Packager tarafı)
 * Bu script Book Update API'den yayınevi listesini çeker
 */

const axios = require('axios');

const API_URL = process.env.BOOK_UPDATE_API_URL || 'https://akillitahta.ndr.ist/api/v1';

async function testPublishersListAPI() {
  console.log('🧪 TEST 1.1: Yayınevi Listesi API (Electron Packager)');
  console.log('====================================================');
  console.log('');
  
  try {
    // Test 1: Basic request
    console.log('Test 1: Basic GET request');
    console.log('-------------------------');
    console.log(`📡 URL: ${API_URL}/public/publishers`);
    
    const startTime = Date.now();
    const response = await axios.get(`${API_URL}/public/publishers`);
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
    }
    
    if (Array.isArray(data.publishers)) {
      console.log(`✅ publishers array: ${data.publishers.length} items`);
    } else {
      console.log('❌ publishers array: missing or not an array');
      return false;
    }
    console.log('');
    
    // Test 3: Publisher fields
    console.log('Test 3: Publisher Fields Validation');
    console.log('-----------------------------------');
    
    if (data.publishers.length > 0) {
      const firstPub = data.publishers[0];
      console.log('First publisher:');
      console.log(JSON.stringify(firstPub, null, 2));
      console.log('');
      
      const requiredFields = ['id', 'name', 'domain', 'slug', 'description'];
      let allFieldsPresent = true;
      
      requiredFields.forEach(field => {
        if (firstPub[field] !== undefined) {
          console.log(`✅ Field '${field}': ${firstPub[field]}`);
        } else {
          console.log(`❌ Field '${field}': missing`);
          allFieldsPresent = false;
        }
      });
      
      if (!allFieldsPresent) {
        return false;
      }
    } else {
      console.log('⚠️  No publishers found');
      return false;
    }
    console.log('');
    
    // Test 4: Data usability
    console.log('Test 4: Data Usability Test');
    console.log('---------------------------');
    
    // Dropdown için format
    const dropdownOptions = data.publishers.map(pub => ({
      value: pub.id,
      label: pub.name
    }));
    
    console.log('Dropdown options:');
    dropdownOptions.forEach((opt, idx) => {
      console.log(`  ${idx + 1}. ${opt.label} (ID: ${opt.value})`);
    });
    console.log('');
    
    // Summary
    console.log('📊 TEST SUMMARY');
    console.log('===============');
    console.log('✅ All tests passed!');
    console.log(`   - HTTP Status: ${response.status}`);
    console.log(`   - Publishers found: ${data.publishers.length}`);
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
  testPublishersListAPI()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = { testPublishersListAPI };
