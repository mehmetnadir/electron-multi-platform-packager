const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// Upload configuration
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

/**
 * LOCAL PACKAGING ENDPOINT
 * Windows, macOS, PWA: Lokal paketleme
 * Linux: Sunucuya gönder, AppImage al
 */
router.post('/local-package', upload.single('buildZip'), async (req, res) => {
  const jobId = uuidv4();
  
  try {
    console.log('📦 Lokal paketleme başlatıldı:', jobId);
    
    const {
      appName,
      appVersion,
      platforms, // ['windows', 'macos', 'linux', 'pwa']
      publisherId
    } = req.body;

    // Validation
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Build ZIP dosyası gerekli'
      });
    }

    if (!appName || !appVersion) {
      return res.status(400).json({
        success: false,
        error: 'Uygulama adı ve versiyon gerekli'
      });
    }

    const selectedPlatforms = JSON.parse(platforms || '[]');
    if (selectedPlatforms.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'En az bir platform seçmelisiniz'
      });
    }

    const buildZipPath = req.file.path;
    const results = {
      jobId,
      appName,
      appVersion,
      platforms: {}
    };

    // Windows Paketleme (Lokal)
    if (selectedPlatforms.includes('windows')) {
      console.log('🪟 Windows paketi oluşturuluyor...');
      try {
        const windowsResult = await packageWindows(buildZipPath, appName, appVersion, jobId);
        results.platforms.windows = {
          success: true,
          path: windowsResult.path,
          size: windowsResult.size,
          downloadUrl: `/api/download/${jobId}/windows`
        };
        console.log('✅ Windows paketi hazır');
      } catch (error) {
        console.error('❌ Windows paketleme hatası:', error);
        results.platforms.windows = {
          success: false,
          error: error.message
        };
      }
    }

    // macOS Paketleme (Lokal)
    if (selectedPlatforms.includes('macos')) {
      console.log('🍎 macOS paketi oluşturuluyor...');
      try {
        const macosResult = await packageMacOS(buildZipPath, appName, appVersion, jobId);
        results.platforms.macos = {
          success: true,
          path: macosResult.path,
          size: macosResult.size,
          downloadUrl: `/api/download/${jobId}/macos`
        };
        console.log('✅ macOS paketi hazır');
      } catch (error) {
        console.error('❌ macOS paketleme hatası:', error);
        results.platforms.macos = {
          success: false,
          error: error.message
        };
      }
    }

    // Linux Paketleme (Remote - Sadece AppImage)
    if (selectedPlatforms.includes('linux')) {
      console.log('🐧 Linux paketi için sunucuya gönderiliyor...');
      try {
        const linuxResult = await packageLinuxRemote(buildZipPath, appName, appVersion, publisherId);
        results.platforms.linux = {
          success: true,
          type: 'appimage',
          downloadUrl: linuxResult.downloadUrl,
          localPath: linuxResult.localPath,
          size: linuxResult.size,
          remote: true,
          autoDownloaded: true,
          message: `Sunucuda oluşturuldu ve output/linux/ klasörüne indirildi`
        };
        console.log('✅ Linux paketi hazır (remote + auto-downloaded)');
      } catch (error) {
        console.error('❌ Linux paketleme hatası:', error);
        results.platforms.linux = {
          success: false,
          error: error.message
        };
      }
    }

    // PWA Paketleme (Lokal)
    if (selectedPlatforms.includes('pwa')) {
      console.log('🌐 PWA paketi oluşturuluyor...');
      try {
        const pwaResult = await packagePWA(buildZipPath, appName, appVersion, jobId);
        results.platforms.pwa = {
          success: true,
          path: pwaResult.path,
          size: pwaResult.size,
          downloadUrl: `/api/download/${jobId}/pwa`
        };
        console.log('✅ PWA paketi hazır');
      } catch (error) {
        console.error('❌ PWA paketleme hatası:', error);
        results.platforms.pwa = {
          success: false,
          error: error.message
        };
      }
    }

    // Cleanup
    await fs.remove(buildZipPath);

    // Response
    res.json({
      success: true,
      jobId,
      results
    });

  } catch (error) {
    console.error('❌ Lokal paketleme hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Windows Paketleme (Lokal)
 */
async function packageWindows(buildZipPath, appName, appVersion, jobId) {
  // TODO: Implement Windows packaging
  // Şimdilik mock
  const outputPath = path.join('temp', jobId, 'windows', `${appName}-${appVersion}-Setup.exe`);
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, 'Mock Windows Package');
  
  const stats = await fs.stat(outputPath);
  return {
    path: outputPath,
    size: stats.size
  };
}

/**
 * macOS Paketleme (Lokal)
 */
async function packageMacOS(buildZipPath, appName, appVersion, jobId) {
  // TODO: Implement macOS packaging
  // Şimdilik mock
  const outputPath = path.join('temp', jobId, 'macos', `${appName}-${appVersion}.dmg`);
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, 'Mock macOS Package');
  
  const stats = await fs.stat(outputPath);
  return {
    path: outputPath,
    size: stats.size
  };
}

/**
 * Linux Paketleme (Remote - Sadece AppImage)
 * 1. Sunucuya gönder
 * 2. AppImage oluştur
 * 3. Otomatik indir
 * 4. output/ klasörüne kaydet
 */
async function packageLinuxRemote(buildZipPath, appName, appVersion, publisherId) {
  console.log('📤 Linux paketi sunucuya gönderiliyor...');
  
  // Book Update API'nin Linux paketleme endpoint'i
  const BOOK_UPDATE_API = process.env.BOOK_UPDATE_API_URL || 'https://akillitahta.ndr.ist/api/v1';
  
  // Build ZIP'i FormData olarak hazırla
  const FormData = require('form-data');
  const form = new FormData();
  form.append('buildZip', fs.createReadStream(buildZipPath));
  form.append('appName', appName);
  form.append('appVersion', appVersion);
  form.append('publisherId', publisherId);
  form.append('packageType', 'appimage'); // Sadece AppImage
  
  try {
    // Sunucuya gönder
    console.log('🌐 Sunucuya bağlanılıyor:', BOOK_UPDATE_API);
    const response = await axios.post(
      `${BOOK_UPDATE_API}/public/package-linux`,
      form,
      {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 600000 // 10 dakika
      }
    );
    
    if (!response.data.success) {
      throw new Error(response.data.error || 'Linux paketleme başarısız');
    }
    
    console.log('✅ Linux paketi sunucuda oluşturuldu');
    console.log('📥 Paket indiriliyor...');
    
    // Paketi indir
    const downloadUrl = response.data.downloadUrl;
    const outputDir = path.join(process.cwd(), 'output', 'linux');
    await fs.ensureDir(outputDir);
    
    const fileName = `${appName}-${appVersion}.AppImage`;
    const outputPath = path.join(outputDir, fileName);
    
    // Dosyayı indir
    const fileResponse = await axios.get(downloadUrl, {
      responseType: 'stream',
      timeout: 600000
    });
    
    const writer = fs.createWriteStream(outputPath);
    fileResponse.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    const stats = await fs.stat(outputPath);
    console.log(`✅ Linux paketi indirildi: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    
    return {
      downloadUrl: downloadUrl,
      localPath: outputPath,
      size: stats.size,
      remote: true,
      autoDownloaded: true
    };
    
  } catch (error) {
    console.error('❌ Linux remote paketleme hatası:', error.message);
    throw new Error(`Linux paketleme başarısız: ${error.message}`);
  }
}

/**
 * PWA Paketleme (Lokal)
 */
async function packagePWA(buildZipPath, appName, appVersion, jobId) {
  // TODO: Implement PWA packaging
  // Şimdilik mock
  const outputPath = path.join('temp', jobId, 'pwa', `${appName}-${appVersion}-pwa.zip`);
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, 'Mock PWA Package');
  
  const stats = await fs.stat(outputPath);
  return {
    path: outputPath,
    size: stats.size
  };
}

/**
 * Download endpoint
 */
router.get('/download/:jobId/:platform', async (req, res) => {
  try {
    const { jobId, platform } = req.params;
    
    const platformPath = path.join('temp', jobId, platform);
    
    if (!await fs.pathExists(platformPath)) {
      return res.status(404).json({
        success: false,
        error: 'Paket bulunamadı'
      });
    }
    
    const files = await fs.readdir(platformPath);
    if (files.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Paket dosyası bulunamadı'
      });
    }
    
    const filePath = path.join(platformPath, files[0]);
    res.download(filePath);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
