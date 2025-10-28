#!/usr/bin/env node

/**
 * DMG Packaging Test with Console Monitoring
 * 
 * Bu test DMG oluşturma sürecini izler ve console loglarını yakalar.
 */

const ConsoleMonitor = require('../utils/console-monitor');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');

class DMGWithConsoleTest {
  constructor() {
    this.baseUrl = 'http://localhost:3000';
    this.testBuildZip = '/Users/nadir/01dev/elecron-paket/build.zip';
    this.monitor = new ConsoleMonitor();
    this.sessionId = null;
    this.jobId = null;
  }

  async run() {
    console.log('\n🧪 DMG PAKETLEME TEST (CONSOLE MONİTORİNG)');
    console.log('='.repeat(80));
    console.log('Bu test server console loglarını yakalar ve DMG oluşturma sürecini izler.\n');

    try {
      // Event listener'ları kur
      this.setupEventListeners();

      // 1. Server'ı başlat ve logları izle
      console.log('📋 Adım 1: Server başlatılıyor ve loglar izleniyor...');
      // Not: Server zaten çalışıyor olmalı, bu yüzden sadece mevcut server'a bağlan
      // await this.monitor.startServer();
      
      // 2. ZIP yükle
      console.log('\n📋 Adım 2: ZIP yükleniyor...');
      await this.uploadZip();
      
      // 3. Paketleme başlat
      console.log('\n📋 Adım 3: Paketleme başlatılıyor...');
      await this.startPackaging();
      
      // 4. Paketleme tamamlanana kadar bekle
      console.log('\n📋 Adım 4: Paketleme izleniyor...');
      await this.waitForCompletion();
      
      // 5. Sonuçları analiz et
      console.log('\n📋 Adım 5: Sonuçlar analiz ediliyor...');
      await this.analyzeResults();
      
      console.log('\n' + '='.repeat(80));
      console.log('✅ TEST BAŞARILI');
      console.log('='.repeat(80));
      
      return { success: true };
      
    } catch (error) {
      console.error('\n' + '='.repeat(80));
      console.error('❌ TEST BAŞARISIZ');
      console.error('='.repeat(80));
      console.error('Hata:', error.message);
      
      // Hata loglarını göster
      console.log('\n📋 SON HATA LOGLARI:');
      this.monitor.printLogs({ type: 'error', count: 10 });
      
      return { success: false, error: error.message };
      
    } finally {
      // Logları kaydet
      const logPath = path.join(__dirname, '../logs', `dmg-test-${Date.now()}.log`);
      await fs.ensureDir(path.dirname(logPath));
      await this.monitor.saveLogs(logPath);
      
      // Özet
      const summary = this.monitor.getSummary();
      console.log('\n📊 LOG ÖZETİ:');
      console.log(`  - Toplam: ${summary.total} log`);
      console.log(`  - Hatalar: ${summary.errors}`);
      console.log(`  - Uyarılar: ${summary.warnings}`);
      console.log(`  - Başarılı: ${summary.success}`);
      console.log(`  - Log dosyası: ${logPath}\n`);
    }
  }

  setupEventListeners() {
    // Electron Builder loglarını yakala
    this.monitor.on('electron-builder', (log) => {
      console.log('🔨 Electron Builder:', log.message);
    });

    // DMG loglarını yakala
    this.monitor.on('dmg', (log) => {
      console.log('💿 DMG:', log.message);
    });

    // Hataları yakala
    this.monitor.on('error', (log) => {
      console.error('❌ HATA:', log.message);
    });

    // Paketleme tamamlandı
    this.monitor.on('packaging-complete', (log) => {
      console.log('✅ Paketleme tamamlandı!');
    });

    // Paketleme başarısız
    this.monitor.on('packaging-failed', (log) => {
      console.error('❌ Paketleme başarısız!');
    });
  }

  async uploadZip() {
    if (!await fs.pathExists(this.testBuildZip)) {
      throw new Error('Test build.zip bulunamadı: ' + this.testBuildZip);
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(this.testBuildZip));

    const response = await axios.post(`${this.baseUrl}/upload`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    if (!response.data.sessionId) {
      throw new Error('Session ID alınamadı');
    }

    this.sessionId = response.data.sessionId;
    console.log(`  ✓ ZIP yüklendi: ${this.sessionId}`);
  }

  async startPackaging() {
    // Yayınevi al
    const publishersResponse = await axios.get(`${this.baseUrl}/api/publishers`);
    const publishers = publishersResponse.data;

    if (publishers.length === 0) {
      throw new Error('Yayınevi yok');
    }

    const publisher = publishers[0];

    // Paketleme isteği
    const packagingData = {
      sessionId: this.sessionId,
      appName: 'Console Test App',
      appVersion: '1.0.0',
      appId: 'com.test.consoleapp',
      description: 'Console Monitoring Test',
      author: 'Test',
      platforms: ['macos'],
      publisherId: publisher.id,
      packageFormats: {
        macos: ['dmg']
      }
    };

    const response = await axios.post(`${this.baseUrl}/package`, packagingData);

    if (!response.data.jobId) {
      throw new Error('Job ID alınamadı');
    }

    this.jobId = response.data.jobId;
    console.log(`  ✓ Job ID: ${this.jobId}`);
    console.log('  ⏳ Paketleme başladı, loglar izleniyor...');
  }

  async waitForCompletion() {
    const maxWaitTime = 120000; // 2 dakika
    const checkInterval = 3000; // 3 saniye
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));

      // Output klasörünü kontrol et
      const ConfigManager = require('../../src/config/ConfigManager');
      const configManager = new ConfigManager();
      const outputDir = configManager.getOutputDir();

      try {
        const items = await fs.readdir(outputDir);
        const folders = [];

        for (const item of items) {
          const itemPath = path.join(outputDir, item);
          const stat = await fs.stat(itemPath);
          if (stat.isDirectory()) {
            folders.push({ name: item, mtime: stat.mtime });
          }
        }

        if (folders.length > 0) {
          folders.sort((a, b) => b.mtime - a.mtime);
          const latestFolder = folders[0];
          const macosPath = path.join(outputDir, latestFolder.name, 'macos');

          if (await fs.pathExists(macosPath)) {
            const files = await fs.readdir(macosPath);
            const dmgFiles = files.filter(f => f.endsWith('.dmg'));

            if (dmgFiles.length > 0) {
              console.log(`  ✅ DMG dosyası bulundu: ${dmgFiles[0]}`);
              return;
            }
          }
        }
      } catch (err) {
        // Devam et
      }

      // Console loglarında hata var mı kontrol et
      const recentErrors = this.monitor.getRecentLogs(5, 'error');
      if (recentErrors.length > 0) {
        console.log('  ⚠️ Son hata logları:');
        recentErrors.forEach(log => {
          console.log(`    - ${log.message}`);
        });
      }
    }

    throw new Error('Timeout: 2 dakika içinde DMG oluşturulamadı');
  }

  async analyzeResults() {
    console.log('\n📊 CONSOLE LOG ANALİZİ:');
    console.log('='.repeat(80));

    // Electron Builder loglarını ara
    const builderLogs = this.monitor.searchLogs('Electron Builder');
    console.log(`\n🔨 Electron Builder Logları (${builderLogs.length}):`);
    builderLogs.slice(-10).forEach(log => {
      console.log(`  - ${log.message}`);
    });

    // DMG loglarını ara
    const dmgLogs = this.monitor.searchLogs(/DMG|dmg/);
    console.log(`\n💿 DMG Logları (${dmgLogs.length}):`);
    dmgLogs.slice(-10).forEach(log => {
      console.log(`  - ${log.message}`);
    });

    // Hataları göster
    if (this.monitor.errors.length > 0) {
      console.log(`\n❌ Hatalar (${this.monitor.errors.length}):`);
      this.monitor.errors.forEach(log => {
        console.log(`  - ${log.message}`);
      });
    }

    // Uyarıları göster
    if (this.monitor.warnings.length > 0) {
      console.log(`\n⚠️ Uyarılar (${this.monitor.warnings.length}):`);
      this.monitor.warnings.slice(-5).forEach(log => {
        console.log(`  - ${log.message}`);
      });
    }

    console.log('\n' + '='.repeat(80));
  }
}

// CLI kullanımı
if (require.main === module) {
  const test = new DMGWithConsoleTest();
  test.run()
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(() => process.exit(1));
}

module.exports = DMGWithConsoleTest;
