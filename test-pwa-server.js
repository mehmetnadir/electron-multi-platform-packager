#!/usr/bin/env node

/**
 * PWA Test Sunucusu
 * PWA paketlerini lokal olarak test etmek için basit HTTPS sunucusu
 */

const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const HTTP_PORT = 8080;
const HTTPS_PORT = 8443;

// PWA test klasörü
const PWA_TEST_DIR = path.join(__dirname, 'pwa-test');

// Middleware
app.use(express.json());

// CORS ve PWA için gerekli header'lar
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Service-Worker-Allowed', '/');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  
  // Cache control
  if (req.path.match(/\.(html|htm)$/)) {
    res.header('Cache-Control', 'no-cache, must-revalidate');
  } else if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico)$/)) {
    res.header('Cache-Control', 'public, max-age=31536000');
  } else if (req.path === '/manifest.json') {
    res.header('Content-Type', 'application/manifest+json');
  }
  
  next();
});

// Static files
app.use(express.static(PWA_TEST_DIR));

// Version API (otomatik güncelleme için)
app.get('/api/version', (req, res) => {
  res.json({ 
    version: '1.0.0',
    updateAvailable: false,
    timestamp: new Date().toISOString()
  });
});

// Root redirect
app.get('/', (req, res) => {
  res.sendFile(path.join(PWA_TEST_DIR, 'index.html'));
});

// Self-signed sertifika oluştur
async function generateSelfSignedCert() {
  const certDir = path.join(__dirname, '.cert');
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');
  
  await fs.ensureDir(certDir);
  
  if (await fs.pathExists(keyPath) && await fs.pathExists(certPath)) {
    console.log('✅ SSL sertifikası mevcut');
    return { key: keyPath, cert: certPath };
  }
  
  console.log('🔐 Self-signed SSL sertifikası oluşturuluyor...');
  
  return new Promise((resolve, reject) => {
    const cmd = `openssl req -x509 -newkey rsa:4096 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`;
    
    exec(cmd, (error) => {
      if (error) {
        console.error('❌ Sertifika oluşturulamadı:', error.message);
        console.log('ℹ️  Sadece HTTP sunucusu başlatılacak (PWA çalışmayabilir)');
        resolve(null);
      } else {
        console.log('✅ SSL sertifikası oluşturuldu');
        resolve({ key: keyPath, cert: certPath });
      }
    });
  });
}

// Sunucuları başlat
async function startServers() {
  await fs.ensureDir(PWA_TEST_DIR);
  
  // HTTP sunucusu (HTTPS'e yönlendirme için)
  http.createServer((req, res) => {
    res.writeHead(301, { Location: `https://localhost:${HTTPS_PORT}${req.url}` });
    res.end();
  }).listen(HTTP_PORT, () => {
    console.log(`🌐 HTTP sunucusu: http://localhost:${HTTP_PORT} (HTTPS'e yönlendiriyor)`);
  });
  
  // HTTPS sunucusu
  const certPaths = await generateSelfSignedCert();
  
  if (certPaths) {
    const httpsOptions = {
      key: fs.readFileSync(certPaths.key),
      cert: fs.readFileSync(certPaths.cert)
    };
    
    https.createServer(httpsOptions, app).listen(HTTPS_PORT, () => {
      console.log('\n🎉 PWA Test Sunucusu Hazır!\n');
      console.log(`📱 HTTPS: https://localhost:${HTTPS_PORT}`);
      console.log(`📁 Klasör: ${PWA_TEST_DIR}\n`);
      console.log('📋 Kullanım:');
      console.log('1. PWA paketini oluşturun');
      console.log('2. ZIP\'i pwa-test/ klasörüne çıkartın');
      console.log('3. https://localhost:8443 adresini açın');
      console.log('4. "Masaüstüne Ekle" butonuna tıklayın\n');
      console.log('⚠️  Tarayıcı "Güvenli değil" uyarısı verecek - "Gelişmiş" > "Devam et" tıklayın\n');
      console.log('🛑 Durdurmak için: Ctrl+C\n');
    });
  } else {
    console.log('\n⚠️  HTTPS başlatılamadı, sadece HTTP çalışıyor');
    console.log('PWA özellikleri çalışmayacak (Service Worker HTTPS gerektirir)\n');
  }
}

// Sunucuları başlat
startServers().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Sunucu kapatılıyor...');
  process.exit(0);
});
