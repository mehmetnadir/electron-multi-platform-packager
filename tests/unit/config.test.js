/**
 * Config Tests - Konfigürasyon Yönetimi Testleri
 */

const axios = require('axios');
const fs = require('fs-extra');

class ConfigTest {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  async testConfigRepository() {
    console.log('🧪 Test: Config Repository');
    
    const response = await axios.get(`${this.baseUrl}/api/settings`);
    const settings = response.data;
    
    if (!settings.configRepository) {
      throw new Error('configRepository tanımlı değil');
    }
    
    console.log(`  ✓ Config Repository: ${settings.configRepository}`);
    
    const repoInfo = await axios.get(`${this.baseUrl}/api/settings/repository-info`);
    
    if (!repoInfo.data.exists) {
      throw new Error('Config repository klasörü bulunamadı');
    }
    
    console.log(`  ✓ Klasör mevcut`);
    console.log(`  ✓ ${repoInfo.data.fileCount} dosya var`);
    
    console.log('✅ Config Repository başarılı\n');
  }

  async testOutputDirectory() {
    console.log('🧪 Test: Output Directory');
    
    const ConfigManager = require('../../src/config/ConfigManager');
    const configManager = new ConfigManager();
    const outputDir = configManager.getOutputDir();
    
    console.log(`  ✓ Output Dir: ${outputDir}`);
    
    if (!await fs.pathExists(outputDir)) {
      throw new Error('Output klasörü bulunamadı');
    }
    
    console.log('  ✓ Klasör mevcut');
    console.log('✅ Output Directory başarılı\n');
  }

  async testLogoDirectory() {
    console.log('🧪 Test: Logo Directory');
    
    const ConfigManager = require('../../src/config/ConfigManager');
    const configManager = new ConfigManager();
    const logoDir = configManager.getLogoDir();
    
    console.log(`  ✓ Logo Dir: ${logoDir}`);
    
    if (!await fs.pathExists(logoDir)) {
      throw new Error('Logo klasörü bulunamadı');
    }
    
    console.log('  ✓ Klasör mevcut');
    console.log('✅ Logo Directory başarılı\n');
  }

  async runAll() {
    try {
      await this.testConfigRepository();
      await this.testOutputDirectory();
      await this.testLogoDirectory();
      return { success: true };
    } catch (error) {
      console.error('❌ Test başarısız:', error.message);
      return { success: false, error: error.message };
    }
  }
}

// CLI kullanımı
if (require.main === module) {
  const test = new ConfigTest();
  test.runAll()
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(() => process.exit(1));
}

module.exports = ConfigTest;
