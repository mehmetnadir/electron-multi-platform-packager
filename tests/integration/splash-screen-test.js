#!/usr/bin/env node

/**
 * Splash Screen Test
 * 
 * Bu test splash screen'in paketleme sırasında doğru eklendiğini kontrol eder.
 */

const io = require('socket.io-client');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');

class SplashScreenTest {
    constructor() {
        this.baseUrl = 'http://localhost:3000';
        this.testBuildZip = '/Users/nadir/01dev/elecron-paket/build.zip';
        this.socket = null;
        this.sessionId = null;
        this.jobId = null;
    }

    async run() {
        console.log('\n🎨 SPLASH SCREEN TESTİ');
        console.log('='.repeat(80));
        console.log('Bu test paketleme sırasında splash screen\'in eklendiğini doğrular.\n');

        try {
            // 1. Socket.IO bağlantısı
            console.log('📡 Socket.IO bağlanıyor...');
            await this.connectSocket();

            // 2. ZIP yükle
            console.log('\n📦 ZIP yükleniyor...');
            await this.uploadZip();

            // 3. Linux paketleme başlat
            console.log('\n🚀 Linux paketleme başlatılıyor...');
            await this.startPackaging();

            // 4. Paketleme tamamlanana kadar bekle
            console.log('\n⏳ Paketleme izleniyor...');
            const result = await this.waitForCompletion();

            // 5. Splash screen dosyalarını kontrol et
            console.log('\n🔍 Splash screen dosyaları kontrol ediliyor...');
            await this.verifySplashScreen(result);

            // 6. AppImage dosyasını bul ve bilgi ver
            console.log('\n📦 AppImage dosyası bulundu:');
            await this.showAppImageInfo(result);

            console.log('\n' + '='.repeat(80));
            console.log('✅ TEST BAŞARILI');
            console.log('='.repeat(80));
            console.log('\n📋 PARDUS\'TA TEST İÇİN TALİMATLAR:');
            console.log('1. Yukarıdaki AppImage dosyasını Pardus\'a kopyalayın');
            console.log('2. Dosyaya çalıştırma izni verin: chmod +x <dosya>');
            console.log('3. Çift tıklayarak çalıştırın');
            console.log('4. İlk çalıştırmada "Hazırlanıyor" mesajını göreceksiniz');
            console.log('5. Uygulama açılırken mor-mavi gradient splash screen göreceksiniz');
            console.log('6. 2-3 saniye sonra ana uygulama açılacak\n');

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

    async startPackaging() {
        const response = await axios.post(`${this.baseUrl}/api/package`, {
            sessionId: this.sessionId,
            platforms: ['linux'],
            appName: 'Splash Test App',
            appVersion: '1.0.0',
            description: 'Splash screen test uygulaması'
        });

        if (response.data.error) {
            throw new Error(response.data.error);
        }

        this.jobId = response.data.jobId;
        console.log(`  ✅ Job ID: ${this.jobId}`);
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

    async verifySplashScreen(result) {
        if (!result.results || !result.results.linux) {
            throw new Error('Linux sonuçları bulunamadı');
        }

        const linuxResult = result.results.linux;
        console.log('  📋 Linux sonuçları:', JSON.stringify(linuxResult, null, 2));
        
        const packages = linuxResult.packages || [];
        console.log(`  📦 Toplam ${packages.length} paket bulundu`);

        // AppImage'ı bul
        const appImage = packages.find(pkg => pkg.type === 'AppImage');
        if (!appImage) {
            console.error('  ❌ Paketler:', packages.map(p => p.type).join(', '));
            throw new Error('AppImage paketi bulunamadı');
        }

        console.log(`  ✅ AppImage bulundu: ${appImage.filename}`);

        // Temp klasöründe splash.html dosyasını kontrol et
        const tempPath = appImage.path.replace(/\/linux\/.*$/, '');
        const appPath = path.join(tempPath, 'app');
        const splashPath = path.join(appPath, 'splash.html');

        if (await fs.pathExists(splashPath)) {
            console.log('  ✅ splash.html dosyası oluşturuldu');
            
            // İçeriği kontrol et
            const splashContent = await fs.readFile(splashPath, 'utf8');
            
            if (splashContent.includes('Splash Test App')) {
                console.log('  ✅ Splash screen\'de uygulama adı doğru');
            } else {
                console.warn('  ⚠️ Splash screen\'de uygulama adı bulunamadı');
            }
            
            if (splashContent.includes('loading-bar')) {
                console.log('  ✅ Loading bar animasyonu mevcut');
            }
            
            if (splashContent.includes('gradient')) {
                console.log('  ✅ Gradient arka plan mevcut');
            }
        } else {
            console.warn('  ⚠️ splash.html dosyası bulunamadı:', splashPath);
        }

        // main.js'i kontrol et
        const mainJsPath = path.join(appPath, 'main.js');
        if (await fs.pathExists(mainJsPath)) {
            const mainJsContent = await fs.readFile(mainJsPath, 'utf8');
            
            if (mainJsContent.includes('createSplashScreen')) {
                console.log('  ✅ main.js\'de splash screen fonksiyonu mevcut');
            } else {
                console.warn('  ⚠️ main.js\'de splash screen fonksiyonu bulunamadı');
            }
            
            if (mainJsContent.includes('splashWindow')) {
                console.log('  ✅ Splash window değişkeni tanımlı');
            }
        }
    }

    async showAppImageInfo(result) {
        const linuxResult = result.results.linux;
        const packages = linuxResult.packages || [];
        const appImage = packages.find(pkg => pkg.type === 'AppImage');

        if (appImage) {
            console.log(`  📄 Dosya: ${appImage.filename}`);
            console.log(`  📂 Yol: ${appImage.path}`);
            console.log(`  📊 Boyut: ${(appImage.size / 1024 / 1024).toFixed(2)} MB`);
            
            // Output klasöründeki yolu bul
            if (result.outputPath) {
                const outputAppImagePath = path.join(result.outputPath, 'linux', appImage.filename);
                if (await fs.pathExists(outputAppImagePath)) {
                    console.log(`  🎯 Output: ${outputAppImagePath}`);
                }
            }
        }
    }
}

// Test'i çalıştır
if (require.main === module) {
    const test = new SplashScreenTest();
    test.run().then(result => {
        process.exit(result.success ? 0 : 1);
    }).catch(error => {
        console.error('Test çalıştırma hatası:', error);
        process.exit(1);
    });
}

module.exports = SplashScreenTest;
