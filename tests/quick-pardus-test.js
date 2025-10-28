#!/usr/bin/env node

/**
 * Hızlı Pardus Test
 * Sandbox düzeltmesi ile yeni AppImage oluşturur
 */

const io = require('socket.io-client');
const axios = require('axios');
const fs = require('fs-extra');
const FormData = require('form-data');

async function test() {
    console.log('\n🐧 PARDUS UYUMLULUK TESTİ');
    console.log('='.repeat(80));
    
    const baseUrl = 'http://localhost:3000';
    const testZip = '/Users/nadir/01dev/elecron-paket/build.zip';
    
    // Socket bağlan
    const socket = io(baseUrl);
    await new Promise(resolve => socket.on('connect', resolve));
    console.log('✅ Socket bağlandı');
    
    // ZIP yükle
    const form = new FormData();
    form.append('files', fs.createReadStream(testZip));
    const uploadRes = await axios.post(`${baseUrl}/api/upload-build`, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });
    const sessionId = uploadRes.data.sessionId;
    console.log('✅ ZIP yüklendi:', sessionId);
    
    // Paketleme başlat
    const packageRes = await axios.post(`${baseUrl}/api/package`, {
        sessionId,
        platforms: ['linux'],
        appName: 'Pardus Test',
        appVersion: '1.0.0',
        description: 'Pardus uyumluluk testi - sandbox devre dışı'
    });
    const jobId = packageRes.data.jobId;
    console.log('✅ Paketleme başladı:', jobId);
    
    // Tamamlanmasını bekle
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 120000);
        
        socket.on('packaging-progress', (data) => {
            if (data.jobId === jobId) {
                console.log(`  ⏳ ${data.progress}% - ${data.message || ''}`);
            }
        });
        
        socket.on('packaging-completed', (data) => {
            if (data.jobId === jobId) {
                clearTimeout(timeout);
                console.log('✅ Paketleme tamamlandı');
                
                if (data.results?.linux?.packages) {
                    const appImage = data.results.linux.packages.find(p => p.type === 'AppImage');
                    if (appImage) {
                        console.log('\n📦 AppImage hazır:');
                        console.log('  Dosya:', appImage.filename);
                        console.log('  Boyut:', (appImage.size / 1024 / 1024).toFixed(2), 'MB');
                        console.log('  Yol:', appImage.path);
                    }
                }
                
                resolve(data);
            }
        });
        
        socket.on('packaging-failed', (data) => {
            if (data.jobId === jobId) {
                clearTimeout(timeout);
                reject(new Error(data.error));
            }
        });
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ TEST TAMAMLANDI');
    console.log('='.repeat(80));
    console.log('\n📋 PARDUS\'TA TEST İÇİN:');
    console.log('1. Yeni AppImage dosyasını Pardus\'a kopyalayın');
    console.log('2. chmod +x "Pardus Test-1.0.0.AppImage"');
    console.log('3. ./"Pardus Test-1.0.0.AppImage"');
    console.log('4. Artık çalışmalı! (--no-sandbox ile)\n');
    
    socket.disconnect();
    process.exit(0);
}

test().catch(error => {
    console.error('\n❌ Test hatası:', error.message);
    process.exit(1);
});
