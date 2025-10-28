#!/usr/bin/env node

/**
 * Unit Test Runner
 * 
 * Tüm unit testleri sırayla çalıştırır.
 * Her test bağımsız olarak çalışır ve sonuçları raporlar.
 * Console loglarını yakalar ve kaydeder.
 */

const CacheTest = require('./unit/cache.test');
const PublishersTest = require('./unit/publishers.test');
const LogosTest = require('./unit/logos.test');
const ConfigTest = require('./unit/config.test');
const PackagingTest = require('./unit/packaging.test');
const io = require('socket.io-client');
const fs = require('fs-extra');
const path = require('path');

class UnitTestRunner {
  constructor() {
    this.results = [];
    this.socket = null;
    this.socketEvents = [];
    this.consoleCapture = {
      logs: [],
      errors: [],
      warnings: []
    };
  }

  async setupConsoleCapture() {
    console.log('📡 Console monitoring başlatılıyor...');
    
    try {
      this.socket = io('http://localhost:3000', {
        transports: ['websocket', 'polling']
      });

      this.socket.on('connect', () => {
        console.log('  ✅ Socket.IO bağlandı - loglar yakalanıyor');
      });

      // Tüm event'leri yakala
      const eventNames = [
        'packaging-queued',
        'packaging-started',
        'packaging-progress',
        'packaging-completed',
        'packaging-failed',
        'zip-extracted',
        'zip-extraction-failed'
      ];

      eventNames.forEach(eventName => {
        this.socket.on(eventName, (data) => {
          this.socketEvents.push({
            timestamp: new Date().toISOString(),
            event: eventName,
            data
          });
        });
      });

    } catch (error) {
      console.log('  ⚠️  Socket.IO bağlantısı kurulamadı (opsiyonel)');
    }
  }

  async teardownConsoleCapture() {
    if (this.socket) {
      this.socket.disconnect();
    }

    // Logları kaydet
    if (this.socketEvents.length > 0) {
      const logPath = path.join(__dirname, 'logs', `unit-tests-${Date.now()}.json`);
      await fs.ensureDir(path.dirname(logPath));
      await fs.writeJson(logPath, {
        results: this.results,
        socketEvents: this.socketEvents,
        consoleCapture: this.consoleCapture
      }, { spaces: 2 });
      console.log(`\n📄 Loglar kaydedildi: ${logPath}`);
    }
  }

  async runTest(TestClass, name) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 ${name}`);
    console.log('='.repeat(60));
    
    const startTime = Date.now();
    const test = new TestClass();
    const result = await test.runAll();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    this.results.push({
      name,
      success: result.success,
      duration,
      error: result.error
    });
    
    if (result.success) {
      console.log(`✅ ${name} - BAŞARILI (${duration}s)`);
    } else {
      console.log(`❌ ${name} - BAŞARISIZ (${duration}s)`);
      console.log(`   Hata: ${result.error}`);
    }
  }

  async runAll() {
    console.log('\n🧪 UNIT TEST RUNNER');
    console.log('='.repeat(60));
    console.log('Her fonksiyon için ayrı test çalıştırılıyor...\n');
    
    // Console monitoring başlat
    await this.setupConsoleCapture();
    
    const startTime = Date.now();
    
    try {
      // Testleri sırayla çalıştır
      await this.runTest(CacheTest, 'Cache Tests');
      await this.runTest(PublishersTest, 'Publishers Tests');
      await this.runTest(LogosTest, 'Logos Tests');
      await this.runTest(ConfigTest, 'Config Tests');
      await this.runTest(PackagingTest, 'Packaging Tests');
    } finally {
      // Console monitoring durdur
      await this.teardownConsoleCapture();
    }
    
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Özet
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SONUÇLARI');
    console.log('='.repeat(60));
    
    const passed = this.results.filter(r => r.success).length;
    const failed = this.results.filter(r => !r.success).length;
    
    this.results.forEach(result => {
      const icon = result.success ? '✅' : '❌';
      console.log(`${icon} ${result.name} (${result.duration}s)`);
      if (result.error) {
        console.log(`   └─ ${result.error}`);
      }
    });
    
    console.log('\n' + '='.repeat(60));
    console.log(`Toplam: ${this.results.length} test suite`);
    console.log(`✅ Başarılı: ${passed}`);
    console.log(`❌ Başarısız: ${failed}`);
    console.log(`⏱️  Toplam Süre: ${totalDuration}s`);
    console.log(`📈 Başarı Oranı: ${((passed / this.results.length) * 100).toFixed(1)}%`);
    console.log('='.repeat(60) + '\n');
    
    return {
      total: this.results.length,
      passed,
      failed,
      duration: totalDuration
    };
  }
}

// CLI kullanımı
if (require.main === module) {
  const runner = new UnitTestRunner();
  runner.runAll()
    .then(result => {
      process.exit(result.failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('❌ Test runner hatası:', error);
      process.exit(1);
    });
}

module.exports = UnitTestRunner;
