#!/usr/bin/env node

const TestRunner = require('./src/utils/testRunner');

async function main() {
  console.log('\n🚀 Electron Paketleyici Test Suite\n');
  
  const runner = new TestRunner('http://localhost:3000');
  
  try {
    const results = await runner.runAllTests();
    
    // Exit code
    process.exit(results.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ Test suite hatası:', error);
    process.exit(1);
  }
}

main();
