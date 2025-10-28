#!/usr/bin/env node

/**
 * Upload Cleanup Test
 * 
 * Bu test paketleme sonrası upload klasörünün temizlendiğini doğrular.
 */

const io = require('socket.io-client');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');

class UploadCleanupTest {
  constructor() {
    this.baseUrl = 'http://localhost:3000';
    this.testBuildZip = '/Users/nadir/01dev/elecron-paket/build.zip';
    this.socket = null;
    this.sessionId = null;
    this.jobId = null;
    this.uploadPath = null;
  }

  async run() {
    console.log('\n🧪 UPLOAD CLEANUP TEST');
    console.log('='.repeat(80));
    console.log('Bu test paketleme sonrası upload klasörünün temizlendiğini kontrol eder.\n');

    try {
      // 1. Socket.IO bağlantısı
      console.log('📡 Socket.IO bağlanıyor...');
      await this.connectSocket();

      // 2. ZIP yükle ve upload klasörünü kontrol et
      console.log('\n📦 ZIP yükleniyor...');
      await this.uploadZip();
      await this.verifyUploadExists();

      // 3. Paketleme başlat
      console.log('\n🚀 Paketleme başlatılıyor...');
      await this.startPackaging();

      // 4. Paketleme tamamlanana kadar bekle
      console.log('\n⏳ Paketleme izleniyor...');
      await this.waitForCompletion();

      // 5. Upload klasörünün silindiğini doğrula
      console.log('\n🔍 Upload klasörü kontrol ediliyor...');
      await this.verifyUploadDeleted();

      console.log('\n' + '='.repeat(80));
      console.log('✅ TEST BAŞARILI');
      console.log('='.repeat(80));
      console.log('Upload klasörü paketleme sonrası başarıyla temizlendi!\n');

      return { success: true };

    } catch (error) {
      console.error('\n' + '='.repeat(80));
      console.error('❌ TEST BAŞARISIZ');
      console.error('='.repeat(80));
      console.error('Hata:', error.message);
      return { success: false, error: error.message };

    } finally {
      if (this.socket) {
        this.socket.disconnect();
      }
    }
  }

  async connectSocket() {
    return new Promise((resolve, reject) => {
      this.socket = io(this.baseUrl, {
        transports: ['websocket', 'polling']
      });

      this.socket.on('connect', () => {
        console.log('  ✅ Socket.IO bağlandı');
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        reject(new Error('Socket.IO bağlantı hatası: ' + error.message));
      });

      setTimeout(() => {
        if (!this.socket.connected) {
          reject(new Error('Socket.IO bağlantı timeout'));
        }
      }, 5000);
    });
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
    this.uploadPath = path.join(process.cwd(), 'uploads', this.sessionId);
    
    console.log(`  ✅ ZIP yüklendi: ${this.sessionId}`);
    console.log(`  📁 Upload yolu: ${this.uploadPath}`);
  }

  async verifyUploadExists() {
    console.log('\n🔍 Upload klasörü varlığı kontrol ediliyor...');
    
    if (!await fs.pathExists(this.uploadPath)) {
      throw new Error('Upload klasörü oluşturulmadı: ' + this.uploadPath);
    }

    const files = await fs.readdir(this.uploadPath);
    console.log(`  ✅ Upload klasörü mevcut`);
    console.log(`  📊 ${files.length} dosya bulundu`);
    
    files.forEach(file => {
      console.log(`    - ${file}`);
    });
  }

  async startPackaging() {
    // Yayınevi al
    const publishersResponse = await axios.get(`${this.baseUrl}/api/publishers`);
    const publishers = publishersResponse.data;

    if (publishers.length === 0) {
      throw new Error('Yayınevi yok');
    }

    const publisher = publishers[0];

    // Sadece Linux (hızlı test için)
    const packagingData = {
      sessionId: this.sessionId,
      appName: 'Cleanup Test',
      appVersion: '1.0.0',
      appId: 'com.test.cleanup',
      description: 'Upload Cleanup Test',
      author: 'Test',
      platforms: ['linux'],
      publisherId: publisher.id,
      packageFormats: {
        linux: ['AppImage']
      }
    };

    const response = await axios.post(`${this.baseUrl}/api/package`, packagingData);

    if (!response.data.jobId) {
      throw new Error('Job ID alınamadı');
    }

    this.jobId = response.data.jobId;
    console.log(`  ✅ Job ID: ${this.jobId}`);
  }

  async waitForCompletion() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout: 2 dakika içinde paketleme tamamlanmadı'));
      }, 120000);

      let lastProgress = 0;

      this.socket.on('packaging-progress', (data) => {
        if (data.jobId === this.jobId && data.progress > lastProgress) {
          lastProgress = data.progress;
          console.log(`  ⏳ İlerleme: ${data.progress}% - ${data.message || ''}`);
        }
      });

      this.socket.on('packaging-completed', (data) => {
        if (data.jobId === this.jobId) {
          clearTimeout(timeout);
          console.log('  ✅ Paketleme tamamlandı');
          
          // Temizlik işleminin tamamlanması için kısa bir bekleme
          setTimeout(() => resolve(), 2000);
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

  async verifyUploadDeleted() {
    const exists = await fs.pathExists(this.uploadPath);
    
    if (exists) {
      const files = await fs.readdir(this.uploadPath);
      console.log(`  ❌ Upload klasörü hala mevcut!`);
      console.log(`  📊 ${files.length} dosya bulundu:`);
      files.forEach(file => {
        console.log(`    - ${file}`);
      });
      throw new Error('Upload klasörü temizlenmedi!');
    }

    console.log(`  ✅ Upload klasörü başarıyla silindi`);
    console.log(`  🗑️ Yol: ${this.uploadPath}`);

    // Ana uploads klasörünü kontrol et
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (await fs.pathExists(uploadsDir)) {
      const remainingSessions = await fs.readdir(uploadsDir);
      console.log(`  📁 Uploads klasöründe ${remainingSessions.length} session kaldı`);
    }
  }
}

// CLI kullanımı
if (require.main === module) {
  const test = new UploadCleanupTest();
  test.run()
    .then(result => process.exit(result.success ? 0 : 1))
    .catch(() => process.exit(1));
}

module.exports = UploadCleanupTest;
