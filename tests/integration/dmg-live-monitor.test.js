#!/usr/bin/env node

/**
 * DMG Live Monitor Test
 * 
 * Mevcut çalışan server'ın Socket.IO event'lerini dinler ve DMG oluşturma sürecini izler.
 */

const io = require('socket.io-client');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');

class DMGLiveMonitorTest {
  constructor() {
    this.baseUrl = 'http://localhost:3000';
    this.testBuildZip = '/Users/nadir/01dev/elecron-paket/build.zip';
    this.socket = null;
    this.events = [];
    this.sessionId = null;
    this.jobId = null;
  }

  async run() {
    console.log('\n🧪 DMG LIVE MONITOR TEST');
    console.log('='.repeat(80));
    console.log('Bu test Socket.IO event\'lerini dinler ve DMG sürecini izler.\n');

    try {
      // 1. Socket.IO bağlantısı kur
      console.log('📡 Socket.IO bağlanıyor...');
      await this.connectSocket();

      // 2. ZIP yükle
      console.log('\n📦 ZIP yükleniyor...');
      await this.uploadZip();

      // 3. Paketleme başlat
      console.log('\n🚀 Paketleme başlatılıyor...');
      await this.startPackaging();

      // 4. Event'leri izle
      console.log('\n👀 Event\'ler izleniyor...\n');
      await this.monitorEvents();

      console.log('\n' + '='.repeat(80));
      console.log('✅ TEST TAMAMLANDI');
      console.log('='.repeat(80));

      this.printEventSummary();

      return { success: true };

    } catch (error) {
      console.error('\n' + '='.repeat(80));
      console.error('❌ TEST BAŞARISIZ');
      console.error('='.repeat(80));
      console.error('Hata:', error.message);

      this.printEventSummary();

      return { success: false, error: error.message };

    } finally {
      if (this.socket) {
        this.socket.disconnect();
      }

      // Event'leri kaydet
      const logPath = path.join(__dirname, '../logs', `dmg-events-${Date.now()}.json`);
      await fs.ensureDir(path.dirname(logPath));
      await fs.writeJson(logPath, this.events, { spaces: 2 });
      console.log(`\n📄 Event'ler kaydedildi: ${logPath}\n`);
    }
  }

  async connectSocket() {
    return new Promise((resolve, reject) => {
      this.socket = io(this.baseUrl, {
        transports: ['websocket', 'polling']
      });

      this.socket.on('connect', () => {
        console.log('  ✅ Socket.IO bağlandı');
        this.setupEventListeners();
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('  ❌ Socket.IO bağlantı hatası:', error.message);
        reject(error);
      });

      setTimeout(() => {
        if (!this.socket.connected) {
          reject(new Error('Socket.IO bağlantı timeout'));
        }
      }, 5000);
    });
  }

  setupEventListeners() {
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
        const event = {
          timestamp: new Date().toISOString(),
          name: eventName,
          data
        };
        this.events.push(event);

        // Console'a yazdır
        const time = new Date().toLocaleTimeString('tr-TR');
        const icon = this.getEventIcon(eventName);
        console.log(`${icon} [${time}] ${eventName}`);

        if (data.message) {
          console.log(`  └─ ${data.message}`);
        }
        if (data.progress !== undefined) {
          console.log(`  └─ İlerleme: ${data.progress}%`);
        }
        if (data.error) {
          console.log(`  └─ Hata: ${data.error}`);
        }
      });
    });
  }

  getEventIcon(eventName) {
    const icons = {
      'packaging-queued': '📋',
      'packaging-started': '🚀',
      'packaging-progress': '⏳',
      'packaging-completed': '✅',
      'packaging-failed': '❌',
      'zip-extracted': '📦',
      'zip-extraction-failed': '❌'
    };
    return icons[eventName] || '📝';
  }

  async uploadZip() {
    if (!await fs.pathExists(this.testBuildZip)) {
      throw new Error('Test build.zip bulunamadı: ' + this.testBuildZip);
    }

    const form = new FormData();
    form.append('files', fs.createReadStream(this.testBuildZip));

    const response = await axios.post(`${this.baseUrl}/api/upload-build`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    if (!response.data.sessionId) {
      throw new Error('Session ID alınamadı');
    }

    this.sessionId = response.data.sessionId;
    console.log(`  ✅ ZIP yüklendi: ${this.sessionId}`);
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
      appName: 'Live Monitor Test',
      appVersion: '1.0.0',
      appId: 'com.test.livemonitor',
      description: 'Live Monitoring Test',
      author: 'Test',
      platforms: ['macos'],
      publisherId: publisher.id,
      packageFormats: {
        macos: ['dmg']
      }
    };

    const response = await axios.post(`${this.baseUrl}/api/package`, packagingData);

    if (!response.data.jobId) {
      throw new Error('Job ID alınamadı');
    }

    this.jobId = response.data.jobId;
    console.log(`  ✅ Job ID: ${this.jobId}`);
  }

  async monitorEvents() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout: 2 dakika içinde paketleme tamamlanmadı'));
      }, 120000); // 2 dakika

      // Tamamlanma veya hata event'ini bekle
      this.socket.on('packaging-completed', (data) => {
        if (data.jobId === this.jobId) {
          clearTimeout(timeout);
          resolve();
        }
      });

      this.socket.on('packaging-failed', (data) => {
        if (data.jobId === this.jobId) {
          clearTimeout(timeout);
          reject(new Error(`Paketleme başarısız: ${data.error}`));
        }
      });
    });
  }

  printEventSummary() {
    console.log('\n📊 EVENT ÖZETİ:');
    console.log('='.repeat(80));
    console.log(`Toplam Event: ${this.events.length}`);

    // Event tiplerini say
    const eventCounts = {};
    this.events.forEach(event => {
      eventCounts[event.name] = (eventCounts[event.name] || 0) + 1;
    });

    console.log('\nEvent Dağılımı:');
    Object.entries(eventCounts).forEach(([name, count]) => {
      const icon = this.getEventIcon(name);
      console.log(`  ${icon} ${name}: ${count}`);
    });

    // Progress event'lerini göster
    const progressEvents = this.events.filter(e => e.name === 'packaging-progress');
    if (progressEvents.length > 0) {
      console.log('\nİlerleme:');
      progressEvents.forEach(event => {
        const time = new Date(event.timestamp).toLocaleTimeString('tr-TR');
        console.log(`  [${time}] ${event.data.progress}% - ${event.data.message || ''}`);
      });
    }

    // Hataları göster
    const errorEvents = this.events.filter(e => 
      e.name.includes('failed') || e.data.error
    );
    if (errorEvents.length > 0) {
      console.log('\n❌ Hatalar:');
      errorEvents.forEach(event => {
        console.log(`  - ${event.name}: ${event.data.error || event.data.message}`);
      });
    }

    console.log('='.repeat(80));
  }
}

// CLI kullanımı
if (require.main === module) {
  const test = new DMGLiveMonitorTest();
  test.run()
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(() => process.exit(1));
}

module.exports = DMGLiveMonitorTest;
