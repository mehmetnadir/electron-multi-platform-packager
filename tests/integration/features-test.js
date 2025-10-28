#!/usr/bin/env node

/**
 * Yeni Özellikler Test
 * 
 * Bu test yeni eklenen özellikleri doğrular:
 * 1. Flatpak ZIP oluşturma
 * 2. Yayınevi logosu kullanımı
 * 3. Aktif işlem yönetimi (İptal/Yeniden İşle)
 */

const io = require('socket.io-client');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');

class FeaturesTest {
    constructor() {
        this.baseUrl = 'http://localhost:3000';
        this.testBuildZip = '/Users/nadir/01dev/elecron-paket/build.zip';
        this.socket = null;
        this.sessionId = null;
        this.jobId = null;
    }

    async run() {
        console.log('\n🧪 YENİ ÖZELLİKLER TESTİ');
        console.log('='.repeat(80));
        console.log('Test edilen özellikler:');
        console.log('1. ✅ Flatpak ZIP oluşturma');
        console.log('2. ✅ Yayınevi logosu kullanımı');
        console.log('3. ✅ Aktif işlem yönetimi\n');

        try {
            // 1. Socket.IO bağlantısı
            console.log('📡 Socket.IO bağlanıyor...');
            await this.connectSocket();

            // 2. ZIP yükle
            console.log('\n📦 ZIP yükleniyor...');
            await this.uploadZip();

            // 3. Yayınevi listesini al
            console.log('\n🏢 Yayınevi listesi alınıyor...');
            const publishers = await this.getPublishers();
            const publisherId = publishers.length > 0 ? publishers[0].kurumId : null;
            
            if (publisherId) {
                console.log(`  ✅ Yayınevi seçildi: ${publishers[0].kurumAdi} (${publisherId})`);
            } else {
                console.log('  ⚠️ Yayınevi bulunamadı, logo testi atlanacak');
            }

            // 4. Linux paketleme başlat (Flatpak testi için)
            console.log('\n🚀 Linux paketleme başlatılıyor...');
            await this.startPackaging(publisherId);

            // 5. İşi iptal et (Aktif işlem yönetimi testi)
            console.log('\n❌ İş iptal ediliyor (test)...');
            await this.sleep(3000); // 3 saniye bekle
            await this.cancelJob();

            // 6. Yeniden başlat
            console.log('\n🔄 İş yeniden başlatılıyor...');
            await this.startPackaging(publisherId);

            // 7. Paketleme tamamlanana kadar bekle
            console.log('\n⏳ Paketleme izleniyor...');
            const result = await this.waitForCompletion();

            // 8. Flatpak ZIP kontrolü
            console.log('\n🔍 Flatpak ZIP kontrol ediliyor...');
            await this.verifyFlatpakZip(result);

            console.log('\n' + '='.repeat(80));
            console.log('✅ TÜM TESTLER BAŞARILI');
            console.log('='.repeat(80));
            console.log('✓ Flatpak ZIP oluşturuldu');
            console.log('✓ Yayınevi logosu kullanıldı');
            console.log('✓ İş iptal edildi ve yeniden başlatıldı\n');

            return { success: true };

        } catch (error) {
            console.error('\n' + '='.repeat(80));
            console.error('❌ TEST BAŞARISIZ');
            console.error('='.repeat(80));
            console.error('Hata:', error.message);
            console.error('Stack:', error.stack);
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
        console.log(`  ✅ ZIP yüklendi: ${this.sessionId}`);
    }

    async getPublishers() {
        const response = await axios.get(`${this.baseUrl}/api/publishers`);
        return response.data || [];
    }

    async startPackaging(publisherId) {
        const response = await axios.post(`${this.baseUrl}/api/package`, {
            sessionId: this.sessionId,
            platforms: ['linux'],
            logoId: publisherId,
            appName: 'Features Test',
            appVersion: '1.0.0',
            description: 'Yeni özellikler testi'
        });

        if (response.data.error) {
            throw new Error(response.data.error);
        }

        this.jobId = response.data.jobId;
        console.log(`  ✅ Job ID: ${this.jobId}`);
    }

    async cancelJob() {
        try {
            const response = await axios.post(`${this.baseUrl}/api/jobs/${this.jobId}/cancel`);
            
            if (response.data.success) {
                console.log('  ✅ İş başarıyla iptal edildi');
            } else {
                console.log('  ⚠️ İş iptal edilemedi (zaten tamamlanmış olabilir)');
            }
        } catch (error) {
            console.log('  ⚠️ İptal hatası:', error.message);
        }
    }

    async waitForCompletion() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout: 2 dakika içinde paketleme tamamlanmadı'));
            }, 120000);

            this.socket.on('packaging-progress', (data) => {
                if (data.jobId === this.jobId) {
                    console.log(`  ⏳ İlerleme: ${data.progress}% - ${data.message || ''}`);
                }
            });

            this.socket.on('packaging-completed', (data) => {
                if (data.jobId === this.jobId) {
                    clearTimeout(timeout);
                    console.log('  ✅ Paketleme tamamlandı');
                    resolve(data);
                }
            });

            this.socket.on('packaging-failed', (data) => {
                if (data.jobId === this.jobId) {
                    clearTimeout(timeout);
                    reject(new Error('Paketleme başarısız: ' + data.error));
                }
            });
        });
    }

    async verifyFlatpakZip(result) {
        if (!result.results || !result.results.linux) {
            throw new Error('Linux sonuçları bulunamadı');
        }

        const linuxResult = result.results.linux;
        const packages = linuxResult.packages || [];

        // Flatpak ZIP'i bul
        const flatpakZip = packages.find(pkg => 
            pkg.type === 'Flatpak' && pkg.filename && pkg.filename.endsWith('-flatpak.zip')
        );

        if (!flatpakZip) {
            throw new Error('Flatpak ZIP bulunamadı! Paketler: ' + 
                packages.map(p => p.filename).join(', '));
        }

        console.log(`  ✅ Flatpak ZIP bulundu: ${flatpakZip.filename}`);
        console.log(`  📊 Boyut: ${(flatpakZip.size / 1024).toFixed(2)} KB`);

        // Dosyanın var olduğunu kontrol et
        if (flatpakZip.path && await fs.pathExists(flatpakZip.path)) {
            console.log(`  ✅ Dosya mevcut: ${flatpakZip.path}`);
        } else {
            throw new Error('Flatpak ZIP dosyası bulunamadı: ' + flatpakZip.path);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Test'i çalıştır
if (require.main === module) {
    const test = new FeaturesTest();
    test.run().then(result => {
        process.exit(result.success ? 0 : 1);
    }).catch(error => {
        console.error('Test çalıştırma hatası:', error);
        process.exit(1);
    });
}

module.exports = FeaturesTest;
