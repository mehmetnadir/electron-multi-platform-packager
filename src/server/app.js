const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const socketIo = require('socket.io');
const AdmZip = require('adm-zip');

const packagingService = require('../packaging/packagingService');
const LogoService = require('../utils/logoService');
const uploadService = require('../services/uploadService');
const queueService = require('../services/queueService');
const pwaConfigManager = require('./pwa-config-manager');

// logoService daha sonra ConfigManager ile başlatılacak
let logoService = null;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '2gb' }));
app.use(express.urlencoded({ extended: true, limit: '2gb' }));

// Cache kontrolü - HİÇBİR CACHE KULLANMA
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// Static klasörler - ConfigManager'dan sonra ayarlanacak
// Şimdilik placeholder, ConfigManager yüklendikten sonra güncellenecek
app.use('/uploads', express.static('uploads', { maxAge: 0, etag: false }));
app.use('/temp', express.static('temp', { maxAge: 0, etag: false }));

// Multer ayarları - build klasörü upload için
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.body.sessionId || uuidv4();
    const uploadPath = path.join('uploads', sessionId);
    fs.ensureDirSync(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 2048 * 1024 * 1024, // 2GB limit
    files: 1000 // 1000 dosya limiti
  }
});

// Global state untuk paketleme işlemleri
const packagingJobs = new Map();

// Socket.IO bağlantı yönetimi
io.on('connection', (socket) => {
  console.log('İstemci bağlandı:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('İstemci bağlantısı kesildi:', socket.id);
  });
});

// API Routes

// Sağlık kontrolü
app.get('/api/health', (req, res) => {
  res.json({ status: 'Sunucu çalışıyor', timestamp: new Date().toISOString() });
});

// Enhanced Upload Endpoints - Hash tabanlı resumable upload

// Upload session başlat
app.post('/api/upload/start', async (req, res) => {
  try {
    const { sessionId, files, appName, appVersion, description } = req.body;
    
    if (!sessionId || !files || !Array.isArray(files)) {
      return res.status(400).json({ error: 'sessionId ve files gerekli' });
    }
    
    const session = await uploadService.startUploadSession(
      sessionId, 
      files, 
      io,
      { appName, appVersion, description }
    );
    
    res.json({
      success: true,
      sessionId: session.sessionId,
      message: 'Upload session başlatıldı',
      totalFiles: session.files.length,
      totalSize: session.totalSize
    });
    
  } catch (error) {
    console.error('Upload session start hatası:', error);
    res.status(500).json({ error: 'Upload session başlatılamadı: ' + error.message });
  }
});

// Resume kontrolü - hash ile
app.post('/api/upload/check-resume', async (req, res) => {
  try {
    const { fileHash, fileName, sessionId } = req.body;
    
    if (!fileHash || !fileName || !sessionId) {
      return res.status(400).json({ error: 'fileHash, fileName ve sessionId gerekli' });
    }
    
    const resumeInfo = await uploadService.checkResumeUpload(fileHash, fileName, sessionId);
    
    res.json({
      success: true,
      ...resumeInfo
    });
    
  } catch (error) {
    console.error('Resume check hatası:', error);
    res.status(500).json({ error: 'Resume check başarısız: ' + error.message });
  }
});

// Chunk upload
app.post('/api/upload/chunk', (req, res) => {
  uploadService.handleChunkedUpload(req, res, io);
});

// Upload durumu
app.get('/api/upload/status/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = uploadService.getUploadSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Upload session bulunamadı' });
    }
    
    res.json(session);
    
  } catch (error) {
    res.status(500).json({ error: 'Upload durumu alınamadı: ' + error.message });
  }
});

// Aktif upload'ları listele
app.get('/api/uploads/active', (req, res) => {
  try {
    const activeUploads = uploadService.getActiveUploads();
    res.json(activeUploads);
  } catch (error) {
    res.status(500).json({ error: 'Aktif upload listesi alınamadı: ' + error.message });
  }
});

// Session doğrulama endpoint'i (birleştirilmiş versiyon)
app.get('/api/validate-session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const uploadPath = path.join('uploads', sessionId);
    const buildInfoPath = path.join(uploadPath, 'build-info.json');
    
    const directoryExists = await fs.pathExists(uploadPath);
    const buildInfoExists = await fs.pathExists(buildInfoPath);
    
    const result = {
      success: true,
      sessionId,
      exists: directoryExists, // Geriye uyumluluk için
      directoryExists,
      buildInfoExists,
      files: [],
      uploadSession: uploadService.getUploadSession(sessionId)
    };
    
    if (directoryExists) {
      try {
        const files = await fs.readdir(uploadPath);
        const stats = await fs.stat(uploadPath);
        
        result.files = files;
        result.fileCount = files.length;
        result.createdAt = stats.birthtime;
        result.modifiedAt = stats.mtime;
        result.path = uploadPath;
        
        if (buildInfoExists) {
          result.buildInfo = await fs.readJson(buildInfoPath);
        }
      } catch (dirError) {
        console.error('Dizin okuma hatası:', dirError);
      }
    } else {
      // Mevcut sessionları listele
      const uploadsDir = path.join('uploads');
      let existingSessions = [];
      
      if (await fs.pathExists(uploadsDir)) {
        const allItems = await fs.readdir(uploadsDir);
        existingSessions = allItems.filter(item => item.startsWith('session_'));
      }
      
      result.success = false;
      result.message = 'Session bulunamadı';
      result.existingSessions = existingSessions;
    }
    
    res.json(result);
    
  } catch (error) {
    console.error('Session validation hatası:', error);
    res.status(500).json({ 
      success: false,
      error: 'Session validation başarısız: ' + error.message 
    });
  }
});

// Build klasörü yükleme
app.post('/api/upload-build', (req, res) => {
  upload.array('files')(req, res, async (err) => {
    if (err) {
      console.error('Multer error:', err);
      
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Dosya çok büyük. Maksimum dosya boyutu: 2GB' });
      } else if (err.code === 'LIMIT_FILES') {
        return res.status(400).json({ error: 'Çok fazla dosya. Maksimum 1000 dosya yükleyebilirsiniz' });
      } else {
        return res.status(400).json({ error: 'Dosya yükleme hatası: ' + err.message });
      }
    }
    
    try {
      console.log('Upload request received:', {
        body: req.body,
        files: req.files ? req.files.length : 0,
        sessionId: req.body.sessionId
      });
      
      const sessionId = req.body.sessionId || uuidv4();
      const { appName, appVersion, description } = req.body;
      
      if (!req.files || req.files.length === 0) {
        console.error('No files uploaded:', req.files);
        return res.status(400).json({ error: 'Dosya yüklenmedi. Lütfen dosya seçtiğinizden emin olun.' });
      }

    const uploadPath = path.join('uploads', sessionId);
    await fs.ensureDir(uploadPath);

    // Process uploaded files
    const processedFiles = [];
    
    for (const file of req.files) {
      if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
        // ZIP dosyasını asenkron kuyruğa ekle
        console.log('ZIP dosyası kuyruğa ekleniyor:', file.originalname);
        
        const zipInfo = {
          zipPath: file.path,
          uploadPath: uploadPath,
          originalName: file.originalname,
          size: file.size
        };
        
        // ZIP işlemini kuyruğa ekle - kullanıcı beklemez
        await queueService.addZipExtractionJob(sessionId, zipInfo, io);
        
        processedFiles.push({
          originalName: file.originalname,
          filename: 'zip_processing',
          path: uploadPath,
          size: file.size,
          type: 'zip_queued',
          status: 'ZIP kuyruğa eklendi, açılıyor...'
        });
        
      } else {
        // Normal dosya - doğrudan kopyala
        const destPath = path.join(uploadPath, file.originalname);
        await fs.move(file.path, destPath);
        
        processedFiles.push({
          originalName: file.originalname,
          filename: file.filename,
          path: destPath,
          size: file.size,
          type: 'file'
        });
      }
    }

    // Build bilgilerini kaydet
    const buildInfo = {
      sessionId,
      appName: appName || 'Interactive Software',
      appVersion: appVersion || '1.0.0',
      description: description || '',
      uploadedAt: new Date().toISOString(),
      files: processedFiles
    };

    await fs.writeJson(path.join(uploadPath, 'build-info.json'), buildInfo);

    res.json({
      success: true,
      sessionId,
      message: 'Build dosyaları başarıyla yüklendi',
      buildInfo
    });

    } catch (error) {
      console.error('Build yükleme hatası:', error);
      
      // Hata tipine göre özel mesajlar
      let errorMessage = 'Build yükleme başarısız: ' + error.message;
      
      if (error.code === 'LIMIT_FILE_SIZE') {
        errorMessage = 'Dosya çok büyük. Maksimum dosya boyutu: 2GB';
      } else if (error.code === 'LIMIT_FILES') {
        errorMessage = 'Çok fazla dosya. Maksimum 1000 dosya yükleyebilirsiniz';
      } else if (error.message.includes('ZIP')) {
        errorMessage = 'ZIP dosyası işleme hatası: ' + error.message;
      }
      
      res.status(500).json({ error: errorMessage });
    }
  });
});

// Logo yönetimi
app.get('/api/logos', async (req, res) => {
  try {
    const logos = await logoService.getAvailableLogos();
    res.json(logos);
  } catch (error) {
    res.status(500).json({ error: 'Logo listesi alınamadı: ' + error.message });
  }
});

app.post('/api/logos', upload.single('logo'), async (req, res) => {
  try {
    const { kurumId, kurumAdi } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Logo dosyası yüklenmedi' });
    }

    const logoInfo = await logoService.saveLogo(kurumId, kurumAdi, req.file);
    res.json({ success: true, logoInfo });

  } catch (error) {
    res.status(500).json({ error: 'Logo kaydetme başarısız: ' + error.message });
  }
});

// Logo güncelleme
app.put('/api/logos/:logoId', upload.single('logo'), async (req, res) => {
  try {
    const { logoId } = req.params;
    const { kurumId, kurumAdi } = req.body;
    
    if (!kurumId || !kurumAdi) {
      return res.status(400).json({ error: 'Kurum ID ve Kurum Adı gerekli' });
    }

    const logoInfo = await logoService.updateLogo(logoId, kurumId, kurumAdi, req.file);
    res.json({ success: true, logoInfo });

  } catch (error) {
    res.status(500).json({ error: 'Logo güncelleme başarısız: ' + error.message });
  }
});

// Logo silme
app.delete('/api/logos/:logoId', async (req, res) => {
  try {
    const { logoId } = req.params;
    
    await logoService.deleteLogo(logoId);
    res.json({ success: true, message: 'Logo başarıyla silindi' });

  } catch (error) {
    res.status(500).json({ error: 'Logo silme başarısız: ' + error.message });
  }
});

// Paketleme işlemi başlatma
app.post('/api/package', async (req, res) => {
  try {
    const { 
      sessionId, 
      platforms, 
      logoId, 
      appName, 
      appVersion, 
      description,
      packageOptions = {},
      priority = 5,
      pwaConfig
    } = req.body;
    
    // Debug: PWA config kontrolü
    if (pwaConfig) {
      console.log('📋 PWA Config alındı:', JSON.stringify(pwaConfig, null, 2));
    }

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID gerekli' });
    }

    if (!platforms || platforms.length === 0) {
      return res.status(400).json({ error: 'En az bir platform seçilmeli' });
    }

    const jobId = uuidv4();
    
    // Logo path'i al (eğer logoId varsa)
    let logoPath = null;
    if (logoId) {
      try {
        const logoInfo = await logoService.getLogoInfo(logoId);
        if (logoInfo && logoInfo.filePath) {
          logoPath = logoInfo.filePath;
          console.log(`📷 Logo yolu alındı: ${logoPath}`);
        }
      } catch (error) {
        console.warn(`⚠️ Logo bilgisi alınamadı (${logoId}):`, error.message);
      }
    }
    
    // İş bilgilerini kaydet
    const jobInfo = {
      jobId,
      sessionId,
      platforms,
      logoId,
      logoPath, // Logo path'i ekle
      appName,
      appVersion,
      description,
      packageOptions,
      pwaConfig, // PWA config ekle
      priority,
      status: 'queued',
      createdAt: new Date().toISOString(),
      progress: 0
    };

    // Paketleme işini kuyruğa ekle - ZIP açılmasını bekleyebilir veya hemen başlayabilir
    const queuedJob = await queueService.addPackagingJob(jobId, jobInfo, io);
    
    // Kullanıcıya hemen cevap döndür
    res.json({
      success: true,
      jobId,
      message: queuedJob.canStart ? 
        'Paketleme işlemi hemen başlayacak' : 
        'Paketleme işlemi kuyruğa eklendi - ZIP açılması bekleniyor',
      status: queuedJob.status,
      canStart: queuedJob.canStart,
      priority: priority
    });

  } catch (error) {
    console.error('Paketleme başlatma hatası:', error);
    res.status(500).json({ error: 'Paketleme başlatılamadı: ' + error.message });
  }
});

// Paketleme işlemini başlatan yardımcı fonksiyon
async function startPackagingProcess(jobId, jobInfo, io) {
  try {
    console.log(`🚀 Paketleme işlemi başlatılıyor: ${jobId}`);
    
    // İş durumunu güncelle
    packagingJobs.set(jobId, jobInfo);
    queueService.markPackagingStarted(jobId, io);
    
    // Paketleme işlemini başlat
    const results = await packagingService.startPackaging(jobId, jobInfo, io);
    
    // Başarılı sonuç
    const job = packagingJobs.get(jobId);
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.results = results;
    job.progress = 100;
    
    queueService.markPackagingCompleted(jobId, results, io);
    
  } catch (error) {
    console.error(`❌ Paketleme hatası (${jobId}):`, error);
    
    // Hatalı sonuç
    const job = packagingJobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.error = error.message;
      job.completedAt = new Date().toISOString();
    }
    
    queueService.markPackagingFailed(jobId, error.message, io);
  }
}

// Logo ön işleme fonksiyonu - paketleme başlamadan önce logo'yu hazırlar
async function prepareLogoAssets(sessionId, logoPath) {
  const sharp = require('sharp');
  const toIco = require('to-ico');
  const path = require('path');
  const fs = require('fs-extra');
  
  try {
    console.log(`🎨 Logo asset'leri hazırlanıyor: ${sessionId}`);
    
    // Cache klasörü oluştur
    const cacheDir = path.join(__dirname, '../../temp', sessionId, 'logo-cache');
    await fs.ensureDir(cacheDir);
    
    // ICO oluştur (Windows için)
    const sizes = [256, 128, 64, 48, 32, 16];
    const pngBuffers = [];
    
    for (const size of sizes) {
      const buffer = await sharp(logoPath)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 0 }
        })
        .png()
        .toBuffer();
      pngBuffers.push(buffer);
    }
    
    const icoBuffer = await toIco(pngBuffers);
    await fs.writeFile(path.join(cacheDir, 'icon.ico'), icoBuffer);
    console.log(`✅ ICO hazır: ${sessionId}`);
    
    // macOS için 512x512 PNG
    await sharp(logoPath)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      })
      .png()
      .toFile(path.join(cacheDir, 'icon-macos.png'));
    console.log(`✅ macOS icon hazır: ${sessionId}`);
    
    // NSIS header BMP (150x57)
    await sharp(logoPath)
      .resize(50, 50, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .extend({
        top: 3,
        bottom: 4,
        left: 50,
        right: 50,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .toFormat('bmp')
      .toFile(path.join(cacheDir, 'installerHeader.bmp'));
    
    // NSIS sidebar BMP (164x314)
    await sharp(logoPath)
      .resize(120, 120, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .extend({
        top: 97,
        bottom: 97,
        left: 22,
        right: 22,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .toFormat('bmp')
      .toFile(path.join(cacheDir, 'installerSidebar.bmp'));
    console.log(`✅ NSIS BMP'ler hazır: ${sessionId}`);
    
    console.log(`✅ Tüm logo asset'leri hazır: ${sessionId}`);
  } catch (error) {
    console.warn(`⚠️ Logo asset hazırlama hatası: ${error.message}`);
    // Hata olsa bile devam et, paketleme sırasında tekrar oluşturulur
  }
}

// ZIP tamamlandığında hızır paketleme işlerini başlat
queueService.on('zip-extraction-completed', async (data) => {
  console.log(`✅ ZIP açma tamamlandı: ${data.sessionId}`);
  
  // ZIP'i tamamlandı olarak işaretle ve bekleyen job'ları hazır hale getir
  queueService.markZipCompleted(data.sessionId, io);
  
  // Logo preprocessing kaldırıldı - packagingService içinde yapılıyor
  
  // Bu session için hazır bekleyen paketleme işlerini bul ve başlat
  const readyJobs = queueService.getReadyPackagingJobs(data.sessionId);
  
  for (const { jobId, jobInfo } of readyJobs) {
    console.log(`🔄 Hazır paketleme işi başlatılıyor: ${jobId}`);
    setImmediate(() => {
      startPackagingProcess(jobId, jobInfo, io);
    });
  }
});

// Kuyruk sistemi paketleme event listener'ı
queueService.on('start-packaging-process', async (data) => {
  const { jobId, jobInfo, io } = data;
  await startPackagingProcess(jobId, jobInfo, io);
});

// Paketleme durumu sorgulama
app.get('/api/package-status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = packagingJobs.get(jobId);
  const queueJob = queueService.getPackagingStatus(jobId);
  
  if (!job && !queueJob) {
    return res.status(404).json({ error: 'İş bulunamadı' });
  }
  
  res.json({
    success: true,
    jobId,
    job: job || null,
    queueStatus: queueJob || null
  });
});

// Hazır paketleme işini manuel başlatma
app.post('/api/start-packaging/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const queueJob = queueService.getPackagingStatus(jobId);
    
    if (!queueJob) {
      return res.status(404).json({ error: 'Paketleme işi bulunamadı' });
    }
    
    if (queueJob.status === 'processing') {
      return res.status(409).json({ error: 'Paketleme zaten işleme alındı' });
    }
    
    if (queueJob.status === 'completed') {
      return res.status(409).json({ error: 'Paketleme zaten tamamlandı' });
    }
    
    if (!queueJob.canStart) {
      return res.status(400).json({ 
        error: 'Paketleme henüz başlayamaz - ZIP açılması bekleniyor',
        status: queueJob.status
      });
    }
    
    // Paketleme işlemini başlat
    setImmediate(() => {
      startPackagingProcess(jobId, queueJob, io);
    });
    
    res.json({
      success: true,
      jobId,
      message: 'Paketleme işlemi başlatılıyor',
      status: 'starting'
    });
    
  } catch (error) {
    console.error('Manuel paketleme başlatma hatası:', error);
    res.status(500).json({ error: 'Paketleme başlatılamadı: ' + error.message });
  }
});

// İş iptal etme
app.post('/api/jobs/:jobId/cancel', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    console.log(`❌ İş iptal ediliyor: ${jobId}`);
    
    // Queue service'den işi iptal et
    const cancelled = queueService.cancelJob(jobId, io);
    
    if (cancelled) {
      res.json({ success: true, message: 'İş iptal edildi' });
    } else {
      res.status(404).json({ error: 'İş bulunamadı' });
    }
    
  } catch (error) {
    console.error('İş iptal etme hatası:', error);
    res.status(500).json({ error: 'İş iptal edilemedi: ' + error.message });
  }
});

// Bulk paketleme endpoint'i (birden fazla job aynı anda)
app.post('/api/bulk-package', async (req, res) => {
  try {
    const { sessionId, jobConfigs } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID gerekli' });
    }
    
    if (!jobConfigs || !Array.isArray(jobConfigs) || jobConfigs.length === 0) {
      return res.status(400).json({ error: 'En az bir job konfigürasyonu gerekli' });
    }
    
    // Her job konfigürasyonunu doğrula
    for (let i = 0; i < jobConfigs.length; i++) {
      const config = jobConfigs[i];
      if (!config.platforms || config.platforms.length === 0) {
        return res.status(400).json({ 
          error: `Job ${i + 1}: En az bir platform seçilmeli` 
        });
      }
      if (!config.appName) {
        return res.status(400).json({ 
          error: `Job ${i + 1}: Uygulama adı gerekli` 
        });
      }
    }
    
    // Bulk job ekleme
    const addedJobs = await queueService.addBulkPackagingJobs(sessionId, jobConfigs, io);
    
    res.json({
      success: true,
      sessionId,
      totalJobs: addedJobs.length,
      jobs: addedJobs.map(job => ({
        jobId: job.id,
        status: job.status,
        canStart: job.canStart,
        platforms: job.platforms,
        appName: job.appName,
        priority: job.priority
      })),
      message: `${addedJobs.length} paketleme işi başarıyla kuyruğa eklendi`
    });
    
  } catch (error) {
    console.error('Bulk paketleme hatası:', error);
    res.status(500).json({ error: 'Bulk paketleme başlatılamadı: ' + error.message });
  }
});

// Kuyruk istatistikleri endpoint'i
app.get('/api/queue-statistics', (req, res) => {
  try {
    const stats = queueService.getQueueStatistics();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      statistics: stats
    });
  } catch (error) {
    console.error('Kuyruk istatistikleri hatası:', error);
    res.status(500).json({ error: 'Kuyruk istatistikleri alınamadı: ' + error.message });
  }
});

// Logo dosyası serve etme
app.get('/api/logos/:logoId/file', async (req, res) => {
  const { logoId } = req.params;
  await logoService.serveLogoFile(logoId, res);
});

// Paketlenmiş dosya indirme
app.get('/api/download/:jobId/:platform', async (req, res) => {
  try {
    const { jobId, platform } = req.params;
    const { type } = req.query; // Linux için package type (appimage, deb)
    
    const job = packagingJobs.get(jobId);
    
    if (!job || job.status !== 'completed') {
      return res.status(404).json({ error: 'İş bulunamadı veya henüz tamamlanmadı' });
    }
    
    if (!job.results || !job.results[platform] || !job.results[platform].success) {
      return res.status(404).json({ error: 'Bu platform için paket bulunamadı' });
    }
    
    const result = job.results[platform];
    let filePath;
    
    // Linux için özel handling (multiple packages)
    if (platform === 'linux' && result.packages && type) {
      const packageInfo = result.packages.find(pkg => pkg.type.toLowerCase() === type.toLowerCase());
      if (packageInfo) {
        filePath = packageInfo.path;
        
        // Flatpak için özel durum - klasörü ZIP'le
        if (type.toLowerCase() === 'flatpak' && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          const archiver = require('archiver');
          const zipFileName = `flatpak-files-${jobId}.zip`;
          
          res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);
          res.setHeader('Content-Type', 'application/zip');
          
          const archive = archiver('zip', { zlib: { level: 9 } });
          
          archive.on('error', (err) => {
            console.error('ZIP oluşturma hatası:', err);
            res.status(500).json({ error: 'ZIP oluşturma hatası' });
          });
          
          archive.pipe(res);
          archive.directory(filePath, false);
          archive.finalize();
          
          console.log(`Flatpak klasörü ZIP olarak indiriliyor: ${zipFileName}`);
          return;
        }
      }
    } else if (result.path) {
      filePath = result.path;
    } else {
      // Fallback: dosyayı temp klasöründe ara
      const outputPath = path.join('temp', jobId, platform);
      if (fs.existsSync(outputPath)) {
        const files = fs.readdirSync(outputPath);
        
        let packageFile;
        if (platform === 'linux' && type) {
          // Linux için specific type ara
          if (type.toLowerCase() === 'appimage') {
            packageFile = files.find(file => file.endsWith('.impark') || file.endsWith('.AppImage'));
          } else if (type.toLowerCase() === 'deb') {
            packageFile = files.find(file => file.endsWith('.deb'));
          }
        } else {
          // Genel dosya arama
          packageFile = files.find(file => 
            file.endsWith('.exe') || 
            file.endsWith('.dmg') || 
            file.endsWith('.impark') ||
            file.endsWith('.AppImage') || 
            file.endsWith('.deb') ||
            file.endsWith('.zip')
          );
        }
        
        if (packageFile) {
          filePath = path.join(outputPath, packageFile);
        }
      }
    }
    
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Paket dosyası bulunamadı' });
    }
    
    // Download header'ları ekle
    const fileName = path.basename(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    
    // Dosyayı stream et
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    console.log(`Dosya indiriliyor: ${fileName}`);
    
  } catch (error) {
    console.error('Download hatası:', error);
    res.status(500).json({ error: 'Dosya indirme hatası: ' + error.message });
  }
});

// Session'a ait tüm paketleme işlerini listele
app.get('/api/packaging-jobs/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Queue service'den session'a ait jobları al
    const queueJobs = [];
    const allQueueJobs = queueService.getAllActiveJobs();
    
    for (const job of allQueueJobs.packagingJobs) {
      if (job.sessionId === sessionId) {
        queueJobs.push(job);
      }
    }
    
    // packagingJobs map'inden session'a ait jobları al
    const activeJobs = [];
    for (const [jobId, job] of packagingJobs.entries()) {
      if (job.sessionId === sessionId) {
        activeJobs.push(job);
      }
    }
    
    res.json({
      success: true,
      sessionId,
      queuedJobs: queueJobs,
      activeJobs: activeJobs,
      total: queueJobs.length + activeJobs.length
    });
    
  } catch (error) {
    console.error('Session packaging jobs listesi alınamadı:', error);
    res.status(500).json({ error: 'Packaging jobs listesi alınamadı: ' + error.message });
  }
});

// Tüm işleri listele
app.get('/api/jobs', (req, res) => {
  const jobs = Array.from(packagingJobs.values());
  const queueJobs = queueService.getAllActiveJobs();
  
  res.json({
    success: true,
    activeJobs: jobs,
    queueJobs: queueJobs
  });
});

// Kuyruk durum endpoint'leri

// ZIP açma durumu
app.get('/api/zip-status/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const zipStatus = queueService.getZipStatus(sessionId);
    
    res.json({
      success: true,
      sessionId,
      zipStatus: zipStatus || { status: 'not_found' }
    });
  } catch (error) {
    res.status(500).json({ error: 'ZIP durumu alınamadı: ' + error.message });
  }
});

// Paketleme durumu
app.get('/api/packaging-status/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const packagingStatus = queueService.getPackagingStatus(jobId);
    const jobStatus = packagingJobs.get(jobId);
    
    res.json({
      success: true,
      jobId,
      queueStatus: packagingStatus || { status: 'not_found' },
      jobStatus: jobStatus || { status: 'not_found' }
    });
  } catch (error) {
    res.status(500).json({ error: 'Paketleme durumu alınamadı: ' + error.message });
  }
});

// Tüm aktif işleri listele
app.get('/api/queue-status', (req, res) => {
  try {
    const queueJobs = queueService.getAllActiveJobs();
    const packagingJobsArray = Array.from(packagingJobs.values());
    
    res.json({
      success: true,
      ...queueJobs,
      activePackagingJobs: packagingJobsArray
    });
  } catch (error) {
    res.status(500).json({ error: 'Kuyruk durumu alınamadı: ' + error.message });
  }
});

// Tek bir işi sil (paketler dahil)
app.delete('/api/delete-job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    console.log(`🗑️ İş siliniyor: ${jobId}`);
    
    // Temp klasöründeki job klasörünü bul ve sil
    const tempDir = path.join(__dirname, '../../temp');
    const jobDirs = await fs.readdir(tempDir);
    
    let deleted = false;
    for (const dir of jobDirs) {
      const jobPath = path.join(tempDir, dir);
      const stat = await fs.stat(jobPath);
      
      if (stat.isDirectory()) {
        // Job ID'yi kontrol et (klasör adında veya içinde olabilir)
        if (dir.includes(jobId) || dir === jobId) {
          await fs.remove(jobPath);
          console.log(`✅ Klasör silindi: ${jobPath}`);
          deleted = true;
          break;
        }
      }
    }
    
    if (!deleted) {
      console.log(`⚠️ İş klasörü bulunamadı: ${jobId}`);
    }
    
    res.json({ success: true, deleted, jobId });
  } catch (error) {
    console.error('❌ Silme hatası:', error);
    res.status(500).json({ error: 'İş silinirken hata oluştu: ' + error.message });
  }
});

// Birden fazla işi sil
app.delete('/api/delete-jobs', async (req, res) => {
  try {
    const { jobIds } = req.body;
    
    if (!Array.isArray(jobIds)) {
      return res.status(400).json({ error: 'jobIds array olmalı' });
    }
    
    console.log(`🗑️ ${jobIds.length} iş siliniyor...`);
    
    const tempDir = path.join(__dirname, '../../temp');
    const jobDirs = await fs.readdir(tempDir);
    
    let deletedCount = 0;
    
    for (const dir of jobDirs) {
      const jobPath = path.join(tempDir, dir);
      const stat = await fs.stat(jobPath);
      
      if (stat.isDirectory()) {
        // Job ID'lerden biriyle eşleşiyor mu?
        const matchingJobId = jobIds.find(id => dir.includes(id) || dir === id);
        if (matchingJobId) {
          await fs.remove(jobPath);
          console.log(`✅ Klasör silindi: ${jobPath}`);
          deletedCount++;
        }
      }
    }
    
    console.log(`✅ ${deletedCount}/${jobIds.length} iş silindi`);
    
    res.json({ success: true, deletedCount, totalRequested: jobIds.length });
  } catch (error) {
    console.error('❌ Silme hatası:', error);
    res.status(500).json({ error: 'İşler silinirken hata oluştu: ' + error.message });
  }
});

// ==================== PWA CONFIG API ====================

// Tüm PWA config'leri getir
app.get('/api/pwa-configs', async (req, res) => {
  try {
    const configs = await pwaConfigManager.getAllConfigs();
    res.json({ success: true, configs });
  } catch (error) {
    console.error('PWA configs getirme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Belirli bir PWA config getir
app.get('/api/pwa-config/:jobId', async (req, res) => {
  try {
    const config = await pwaConfigManager.getConfig(req.params.jobId);
    if (!config) {
      return res.status(404).json({ success: false, error: 'Config bulunamadı' });
    }
    res.json({ success: true, config });
  } catch (error) {
    console.error('PWA config getirme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni PWA config oluştur
app.post('/api/pwa-config', async (req, res) => {
  try {
    const { jobId, appName, appVersion, options } = req.body;
    
    if (!jobId || !appName || !appVersion) {
      return res.status(400).json({ 
        success: false, 
        error: 'jobId, appName ve appVersion gerekli' 
      });
    }

    const config = await pwaConfigManager.createConfig(jobId, appName, appVersion, options);
    res.json({ success: true, config });
  } catch (error) {
    console.error('PWA config oluşturma hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PWA config güncelle
app.put('/api/pwa-config/:jobId', async (req, res) => {
  try {
    const { updates } = req.body;
    const config = await pwaConfigManager.updateConfig(req.params.jobId, updates);
    res.json({ success: true, config });
  } catch (error) {
    console.error('PWA config güncelleme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PWA config sil
app.delete('/api/pwa-config/:jobId', async (req, res) => {
  try {
    await pwaConfigManager.deleteConfig(req.params.jobId);
    res.json({ success: true, message: 'Config silindi' });
  } catch (error) {
    console.error('PWA config silme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PWA config istatistikleri
app.get('/api/pwa-stats', async (req, res) => {
  try {
    const stats = await pwaConfigManager.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('PWA stats getirme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== END PWA CONFIG API ====================

// ==================== SETTINGS API ====================
// ConfigManager'ı import et ve global instance'ı kullan
const ConfigManager = require('../config/ConfigManager');

// Eğer global.configManager varsa onu kullan (Electron modunda)
// Yoksa yeni bir instance oluştur (standalone server modunda)
const serverConfigManager = global.configManager || new ConfigManager();

const { router: settingsRouter, setConfigManager } = require('./settingsRoutes');

// ConfigManager'ı hemen set et
setConfigManager(serverConfigManager);
console.log('✅ ConfigManager server\'da başlatıldı');

// LogoService'i ConfigManager ile başlat (singleton)
logoService = require('../utils/logoService');
logoService.init(serverConfigManager);
console.log('✅ LogoService ConfigManager ile başlatıldı');
console.log('📁 Logo dizini:', serverConfigManager.getLogoDir());

// Logos static middleware'ini ConfigManager'dan gelen yol ile ekle - CACHE YOK
app.use('/logos', express.static(serverConfigManager.getLogoDir(), { 
  maxAge: 0, 
  etag: false,
  lastModified: false,
  cacheControl: false
}));
console.log('✅ Logos static middleware eklendi (CACHE YOK):', serverConfigManager.getLogoDir());

app.use('/api', settingsRouter);
// ==================== END SETTINGS API ====================

// Private API routes removed for open source version
// Only local packaging is supported

// ==================== LOCAL PACKAGING API ====================
const localPackagingRouter = require('./localPackagingRoutes');
app.use('/api', localPackagingRouter);
console.log('✅ Local Packaging API routes yüklendi');
// ==================== END LOCAL PACKAGING API ====================

// Ayarlar sayfası
app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/settings.html'));
});

// Yayınevi yönetimi sayfası
app.get('/publishers', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/publishers.html'));
});

// Kitap yönetimi sayfası
app.get('/books', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/books.html'));
});

// Yeni kitap sayfası
app.get('/new-book.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/new-book.html'));
});

// Paketleme sayfası
app.get('/package-book.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/package-book.html'));
});

// Static dosyalar - client build
app.use(express.static(path.join(__dirname, '../client/public')));

// SPA için catch-all
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, '../client/public/index.html'));
  } else {
    res.status(404).json({ error: 'API endpoint bulunamadı' });
  }
});

// Sunucu başlatma
server.listen(PORT, () => {
  console.log(`🚀 Electron Paketleme Servisi çalışıyor: http://localhost:${PORT}`);
  console.log('📁 Upload klasörü: uploads/');
  console.log('🎨 Logo klasörü: logos/');
  console.log('📦 Temp klasörü: temp/');
});

module.exports = { app, server, io, packagingJobs };