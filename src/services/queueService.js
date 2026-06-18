const EventEmitter = require('events');
const path = require('path');
const fs = require('fs-extra');
const AdmZip = require('adm-zip');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

class QueueService extends EventEmitter {
  constructor() {
    super();
    this.zipQueue = new Map(); // sessionId -> job info
    this.packagingQueue = new Map(); // jobId -> job info
    this.processingZip = new Set(); // Currently processing ZIP items
    this.processingPackaging = new Set(); // Currently processing packaging items
    
    // Paralel işlem konfigürasyonu - PERFORMANS İYİLEŞTİRME
    const cpuCount = os.cpus().length;
    this.maxConcurrentPackaging = Math.max(4, Math.floor(cpuCount * 0.75)); // CPU'nun %75'i
    this.maxConcurrentZip = Math.max(3, Math.floor(cpuCount / 3)); // CPU'nun 1/3'ü
    
    console.log(`🔧 Kuyruk sistemi başlatıldı - CPU: ${cpuCount}, Max paralel paketleme: ${this.maxConcurrentPackaging}, Max paralel ZIP: ${this.maxConcurrentZip}`);
  }

  // ZIP açma işlemi için kuyruk ekle
  async addZipExtractionJob(sessionId, zipInfo, io) {
    const jobInfo = {
      sessionId,
      type: 'zip_extraction',
      status: 'queued',
      zipInfo,
      startedAt: new Date().toISOString(),
      progress: 0
    };

    this.zipQueue.set(sessionId, jobInfo);
    
    // Kullanıcıya hemen döndür - ZIP açılıyor
    io.emit('zip-extraction-started', {
      sessionId,
      status: 'ZIP açılmaya başlandı, diğer adımlara geçebilirsiniz',
      canProceed: true
    });

    // Paralel işleme kontrolü
    this.processNextZipJob(io);

    return jobInfo;
  }

  // Paralel ZIP işleme kontrol sistemi
  async processNextZipJob(io) {
    // Eğer maksimum paralel işlem sayısına ulaşıldıysa bekle
    if (this.processingZip.size >= this.maxConcurrentZip) {
      console.log(`⏳ ZIP işleme kapasitesi dolu (${this.processingZip.size}/${this.maxConcurrentZip}), sırada bekliyor...`);
      return;
    }

    // Sıradaki ZIP job'unu bul
    for (const [sessionId, jobInfo] of this.zipQueue.entries()) {
      if (jobInfo.status === 'queued' && !this.processingZip.has(sessionId)) {
        this.processZipExtraction(sessionId, io);
        break;
      }
    }
  }

  // ZIP açma işlemini asenkron olarak yap
  async processZipExtraction(sessionId, io) {
    if (this.processingZip.has(sessionId)) {
      return; // Zaten işlem görüyor
    }

    this.processingZip.add(sessionId);
    const jobInfo = this.zipQueue.get(sessionId);

    try {
      jobInfo.status = 'processing';
      console.log(`📦 ZIP açma başladı: ${sessionId} (Paralel: ${this.processingZip.size}/${this.maxConcurrentZip})`);
      
      io.emit('zip-extraction-progress', {
        sessionId,
        status: 'ZIP açılıyor...',
        progress: 10
      });

      const { zipPath, uploadPath, originalName } = jobInfo.zipInfo;

      // ZIP dosyasını aç
      const zip = new AdmZip(zipPath);
      const extractPath = path.join(uploadPath, 'extracted');
      
      await fs.ensureDir(extractPath);
      
      // Progress güncelle
      io.emit('zip-extraction-progress', {
        sessionId,
        status: 'Dosyalar çıkarılıyor...',
        progress: 50
      });

      zip.extractAllTo(extractPath, true);

      // Progress güncelle
      io.emit('zip-extraction-progress', {
        sessionId,
        status: 'Dosyalar düzenleniyor...',
        progress: 80
      });

      // Extract edilen dosyaları düzenle
      const extractedFiles = await fs.readdir(extractPath);
      
      if (extractedFiles.length === 1) {
        const singleDir = path.join(extractPath, extractedFiles[0]);
        const stat = await fs.stat(singleDir);
        if (stat.isDirectory()) {
          // Ana klasörün içeriğini upload klasörüne taşı
          await fs.copy(singleDir, uploadPath, { overwrite: true });
          await fs.remove(extractPath);
        }
      } else {
        // Birden fazla dosya/klasör varsa extract klasörünü kullan
        await fs.copy(extractPath, uploadPath, { overwrite: true });
        await fs.remove(extractPath);
      }

      // Orijinal ZIP dosyasını sil
      await fs.remove(zipPath);

      // İşlem tamamlandı
      jobInfo.status = 'completed';
      jobInfo.completedAt = new Date().toISOString();
      jobInfo.progress = 100;

      io.emit('zip-extraction-completed', {
        sessionId,
        status: 'ZIP başarıyla açıldı',
        progress: 100,
        extractedPath: uploadPath
      });

      console.log(`✅ ZIP açma tamamlandı: ${sessionId}`);
      
      // Bekleyen paketleme işlerini kontrol et
      this.checkPendingPackagingJobs(sessionId, io);
      
      // EventEmitter ile diğer dinleyicilere bildir
      this.emit('zip-extraction-completed', { sessionId, extractedPath: uploadPath });

    } catch (error) {
      console.error('ZIP açma hatası:', error);
      
      jobInfo.status = 'failed';
      jobInfo.error = error.message;
      jobInfo.completedAt = new Date().toISOString();

      io.emit('zip-extraction-failed', {
        sessionId,
        status: 'ZIP açma başarısız',
        error: error.message
      });

    } finally {
      this.processingZip.delete(sessionId);
      
      // Sıradaki ZIP job'unu başlat
      setImmediate(() => {
        this.processNextZipJob(io);
      });
    }
  }

  // Paketleme işlemi için kuyruk (mevcut build bilgileri + user inputs)
  async addPackagingJob(jobId, jobInfo, io) {
    // Bu job kullanıcının girdiği bilgileri içerir
    jobInfo.id = jobId;
    jobInfo.queuedAt = new Date().toISOString();
    jobInfo.priority = jobInfo.priority || 5; // Varsayılan öncelik (1-10, düşük sayı yüksek öncelik)
    
    // ZIP açılma durumunu kontrol et
    const zipJob = this.zipQueue.get(jobInfo.sessionId);
    
    // Önce kuyruğa ekle
    this.packagingQueue.set(jobId, jobInfo);
    
    if (zipJob && zipJob.status === 'completed') {
      // ZIP zaten açılmış, hemen başlayabilir
      jobInfo.status = 'ready';
      jobInfo.canStart = true;
      jobInfo.readyAt = new Date().toISOString();
      
      console.log(`📦 Paketleme hemen başlayabilir: ${jobId} (ZIP zaten hazır)`);
      
      io.emit('packaging-queued', { 
        jobId,
        appName: jobInfo.appName,
        platforms: jobInfo.platforms,
        status: 'ZIP hazır, paketleme başlayacak',
        canStart: true
      });
      
      // Paralel işleme kontrolü
      this.processNextPackagingJob(io);
    } else {
      // ZIP açılmasını bekle
      jobInfo.status = 'waiting_for_zip';
      jobInfo.canStart = false;
      
      console.log(`📦 Paketleme kuyruğa eklendi: ${jobId} (ZIP bekleniyor)`);
      
      io.emit('packaging-queued', { 
        jobId,
        appName: jobInfo.appName,
        platforms: jobInfo.platforms,
        status: 'Paketleme kuyruğa eklendi - ZIP açılması bekleniyor',
        canStart: false,
        message: 'Dosyalarınız hazırlanıyor, paketleme başlayacak...'
      });
    }
    
    return jobInfo;
  }

  // Paralel paketleme işleme kontrol sistemi
  async processNextPackagingJob(io) {
    console.log(`🔍 processNextPackagingJob çağrıldı - Processing: ${this.processingPackaging.size}/${this.maxConcurrentPackaging}, Queue: ${this.packagingQueue.size}`);
    
    // Eğer maksimum paralel işlem sayısına ulaşıldıysa bekle
    if (this.processingPackaging.size >= this.maxConcurrentPackaging) {
      console.log(`⏳ Paketleme kapasitesi dolu (${this.processingPackaging.size}/${this.maxConcurrentPackaging}), sırada bekliyor...`);
      return;
    }

    // Öncelik sırasına göre sıradaki job'u bul
    const readyJobs = [];
    for (const [jobId, jobInfo] of this.packagingQueue.entries()) {
      console.log(`  📋 Job ${jobId}: status=${jobInfo.status}, canStart=${jobInfo.canStart}, processing=${this.processingPackaging.has(jobId)}`);
      if (jobInfo.status === 'ready' && jobInfo.canStart && !this.processingPackaging.has(jobId)) {
        readyJobs.push({ jobId, jobInfo });
      }
    }

    console.log(`✅ Hazır job sayısı: ${readyJobs.length}`);

    if (readyJobs.length === 0) {
      console.log('⚠️ Hazır job yok, bekleniyor...');
      return; // Hazır job yok
    }

    // Öncelik sırasına göre sırala (düşük sayı = yüksek öncelik)
    readyJobs.sort((a, b) => {
      const priorityA = a.jobInfo.priority || 5;
      const priorityB = b.jobInfo.priority || 5;
      if (priorityA === priorityB) {
        // Aynı öncelikte, queuedAt zamanına göre (FIFO)
        return new Date(a.jobInfo.queuedAt) - new Date(b.jobInfo.queuedAt);
      }
      return priorityA - priorityB;
    });

    const { jobId, jobInfo } = readyJobs[0];
    
    // İşlemi başlat
    this.startPackagingProcess(jobId, jobInfo, io);
  }

  // Paketleme işlemini başlat
  async startPackagingProcess(jobId, jobInfo, io) {
    if (this.processingPackaging.has(jobId)) {
      return; // Zaten işlem görüyor
    }

    this.processingPackaging.add(jobId);
    
    try {
      jobInfo.status = 'processing';
      jobInfo.startedAt = new Date().toISOString();
      
      console.log(`🚀 Paketleme başladı: ${jobId} (Paralel: ${this.processingPackaging.size}/${this.maxConcurrentPackaging})`);
      
      io.emit('packaging-started', { 
        jobId, 
        status: 'Paketleme işlemi başladı',
        startedAt: jobInfo.startedAt,
        parallelCount: this.processingPackaging.size
      });
      
      // Gerçek paketleme işlemini tetikle (bu event listener tarafından yakalanacak)
      this.emit('start-packaging-process', { jobId, jobInfo, io });
      
    } catch (error) {
      console.error(`❌ Paketleme başlatma hatası (${jobId}):`, error);
      
      jobInfo.status = 'failed';
      jobInfo.error = error.message;
      jobInfo.completedAt = new Date().toISOString();
      
      io.emit('packaging-failed', { 
        jobId, 
        status: 'Paketleme başlatma başarısız',
        error: error.message,
        completedAt: jobInfo.completedAt
      });
      
      this.processingPackaging.delete(jobId);
      
      // Sıradaki job'u başlat
      setImmediate(() => {
        this.processNextPackagingJob(io);
      });
    }
  }

  // ZIP tamamlandığında paketleme işlerini kontrol et
  markZipCompleted(sessionId, io) {
    let readyJobs = 0;
    
    for (const [jobId, jobInfo] of this.packagingQueue.entries()) {
      if (jobInfo.sessionId === sessionId && jobInfo.status === 'waiting_for_zip') {
        jobInfo.canStart = true;
        jobInfo.status = 'ready';
        jobInfo.readyAt = new Date().toISOString();
        
        readyJobs++;
        
        io.emit('packaging-ready', { 
          jobId, 
          status: 'ZIP açıldı, paketleme başlayabilir',
          canStart: true,
          readyAt: jobInfo.readyAt
        });
        
        console.log(`📦 Paketleme hazır: ${jobId} for session: ${sessionId}`);
      }
    }
    
    if (readyJobs > 0) {
      console.log(`✅ ${readyJobs} paketleme işi hazır hale geldi (session: ${sessionId})`);
      
      // Paralel işleme kontrolü
      this.processNextPackagingJob(io);
    }
  }
  
  // Alias for backward compatibility
  checkPendingPackagingJobs(sessionId, io) {
    return this.markZipCompleted(sessionId, io);
  }

  // ZIP işlemi durumunu getir
  getZipStatus(sessionId) {
    return this.zipQueue.get(sessionId) || null;
  }

  // Paketleme işlemi durumunu getir
  getPackagingStatus(jobId) {
    return this.packagingQueue.get(jobId) || null;
  }

  // Paketleme işini başlatıldı olarak işaretle
  markPackagingStarted(jobId, io) {
    const jobInfo = this.packagingQueue.get(jobId);
    if (jobInfo) {
      jobInfo.status = 'processing';
      jobInfo.startedAt = new Date().toISOString();
      
      io.emit('packaging-started', { 
        jobId, 
        status: 'Paketleme işlemi başladı',
        startedAt: jobInfo.startedAt
      });
      
      console.log(`🚀 Paketleme başladı: ${jobId}`);
    }
  }

  // Paketleme işini tamamlandı olarak işaretle
  async markPackagingCompleted(jobId, results, io) {
    try {
      const jobInfo = this.packagingQueue.get(jobId);
      if (!jobInfo) {
        console.error(`❌ Job bilgisi bulunamadı: ${jobId}`);
        return;
      }
      
      jobInfo.status = 'completed';
      jobInfo.completedAt = new Date().toISOString();
      jobInfo.results = results;
      
      console.log(`✅ Paketleme tamamlandı: ${jobId}`);
      
      // Dosyaları output klasörüne taşı
      console.log(`📦 Output klasörüne taşıma başlıyor...`);
      const outputPath = await this.moveToOutputDirectory(jobId, jobInfo, results);
      if (outputPath) {
        jobInfo.outputPath = outputPath;
        console.log(`📁 Dosyalar output klasörüne taşındı: ${outputPath}`);
      }
      
      console.log(`📡 Socket.IO event gönderiliyor...`);
      io.emit('packaging-completed', { 
        jobId, 
        status: 'Paketleme tamamlandı',
        results,
        completedAt: jobInfo.completedAt,
        appName: jobInfo.appName,
        appVersion: jobInfo.appVersion,
        platforms: jobInfo.platforms,
        sessionId: jobInfo.sessionId,
        outputPath: jobInfo.outputPath
      });
      
      // Email notifications removed for open source version
      // Users can implement their own notification system via webhooks
      
      // Başarılı paketleme sonrası temizlik yap (await ile bekle)
      console.log(`🧹 Temizlik fonksiyonu çağrılıyor...`);
      await this.performPostPackagingCleanup(jobId, jobInfo, results);
      console.log(`✅ Temizlik fonksiyonu tamamlandı`);
      
      // Paralel işlemden çıkar
      this.processingPackaging.delete(jobId);
      
      // Sıradaki job'u başlat
      setImmediate(() => {
        this.processNextPackagingJob(io);
      });
    } catch (error) {
      console.error(`❌ markPackagingCompleted hatası (${jobId}):`, error);
    }
  }

  // Paketleme işini başarısız olarak işaretle
  markPackagingFailed(jobId, error, io) {
    const jobInfo = this.packagingQueue.get(jobId);
    if (jobInfo) {
      jobInfo.status = 'failed';
      jobInfo.completedAt = new Date().toISOString();
      jobInfo.error = error;
      
      io.emit('packaging-failed', { 
        jobId, 
        status: 'Paketleme başarısız',
        error,
        completedAt: jobInfo.completedAt
      });
      
      console.log(`❌ Paketleme başarısız: ${jobId} - ${error}`);
      
      // Paralel işlemden çıkar
      this.processingPackaging.delete(jobId);
      
      // Sıradaki job'u başlat
      setImmediate(() => {
        this.processNextPackagingJob(io);
      });
    }
  }

  // İşi iptal et
  cancelJob(jobId, io) {
    console.log(`❌ İş iptal ediliyor: ${jobId}`);
    
    // Paketleme kuyruğunda mı?
    const packagingJob = this.packagingQueue.get(jobId);
    if (packagingJob) {
      // İşleniyor mu?
      if (this.processingPackaging.has(jobId)) {
        console.log(`⚠️ İş şu anda işleniyor, durdurulması zor: ${jobId}`);
        // İşleniyor olsa bile kuyruğu temizle
        this.processingPackaging.delete(jobId);
      }
      
      // Kuyruktan kaldır
      this.packagingQueue.delete(jobId);
      
      // Failed event gönder
      if (io) {
        io.emit('packaging-failed', {
          jobId,
          status: 'İptal edildi',
          error: 'Kullanıcı tarafından iptal edildi',
          completedAt: new Date().toISOString()
        });
      }
      
      console.log(`✅ Paketleme işi iptal edildi: ${jobId}`);
      
      // Sıradaki işi başlat
      setImmediate(() => {
        this.processNextPackagingJob(io);
      });
      
      return true;
    }
    
    // ZIP kuyruğunda mı?
    const zipJob = this.zipQueue.get(jobId);
    if (zipJob) {
      this.zipQueue.delete(jobId);
      this.processingZip.delete(jobId);
      
      if (io) {
        io.emit('zip-extraction-failed', {
          sessionId: jobId,
          error: 'Kullanıcı tarafından iptal edildi'
        });
      }
      
      console.log(`✅ ZIP işi iptal edildi: ${jobId}`);
      return true;
    }
    
    console.log(`⚠️ İş bulunamadı: ${jobId}`);
    return false;
  }

  // Session'a ait tüm hazır paketleme işlerini getir
  getReadyPackagingJobs(sessionId) {
    const readyJobs = [];
    
    for (const [jobId, jobInfo] of this.packagingQueue.entries()) {
      if (jobInfo.sessionId === sessionId && jobInfo.status === 'ready' && jobInfo.canStart) {
        readyJobs.push({ jobId, jobInfo });
      }
    }
    
    return readyJobs;
  }

  // Bulk paketleme job ekleme (birden fazla platform/konfigurasyonu aynı anda)
  async addBulkPackagingJobs(sessionId, jobConfigs, io) {
    const addedJobs = [];
    
    console.log(`📎 Bulk paketleme başlatılıyor: ${jobConfigs.length} job (session: ${sessionId})`);
    
    for (const config of jobConfigs) {
      const jobId = uuidv4();
      
      const jobInfo = {
        jobId,
        sessionId,
        ...config, // platforms, logoId, appName, appVersion, description, packageOptions
        priority: config.priority || 5,
        type: 'bulk_packaging'
      };
      
      const addedJob = await this.addPackagingJob(jobId, jobInfo, io);
      addedJobs.push(addedJob);
    }
    
    console.log(`✅ ${addedJobs.length} paketleme job'u kuyruğa eklendi`);
    
    // Bulk ekleme tamamlandı event'i
    io.emit('bulk-packaging-queued', {
      sessionId,
      totalJobs: addedJobs.length,
      jobIds: addedJobs.map(job => job.id),
      message: `${addedJobs.length} paketleme işi kuyruğa eklendi`
    });
    
    return addedJobs;
  }

  // Kuyruk istatistikleri
  getQueueStatistics() {
    const zipStats = {
      total: this.zipQueue.size,
      processing: this.processingZip.size,
      queued: 0,
      completed: 0,
      failed: 0
    };
    
    for (const [, jobInfo] of this.zipQueue.entries()) {
      if (jobInfo.status === 'queued') zipStats.queued++;
      else if (jobInfo.status === 'completed') zipStats.completed++;
      else if (jobInfo.status === 'failed') zipStats.failed++;
    }
    
    const packagingStats = {
      total: this.packagingQueue.size,
      processing: this.processingPackaging.size,
      ready: 0,
      waiting_for_zip: 0,
      completed: 0,
      failed: 0
    };
    
    for (const [, jobInfo] of this.packagingQueue.entries()) {
      if (jobInfo.status === 'ready') packagingStats.ready++;
      else if (jobInfo.status === 'waiting_for_zip') packagingStats.waiting_for_zip++;
      else if (jobInfo.status === 'completed') packagingStats.completed++;
      else if (jobInfo.status === 'failed') packagingStats.failed++;
    }
    
    return {
      zip: zipStats,
      packaging: packagingStats,
      capacity: {
        maxConcurrentZip: this.maxConcurrentZip,
        maxConcurrentPackaging: this.maxConcurrentPackaging,
        availableZipSlots: Math.max(0, this.maxConcurrentZip - this.processingZip.size),
        availablePackagingSlots: Math.max(0, this.maxConcurrentPackaging - this.processingPackaging.size)
      }
    };
  }

  // Dosyaları output klasörüne taşı
  async moveToOutputDirectory(jobId, jobInfo, results) {
    try {
      // ConfigManager'dan output dizinini al
      const ConfigManager = require('../config/ConfigManager');
      const configManager = global.configManager || new ConfigManager();
      const outputDir = configManager.getOutputDir();
      
      // İş için klasör oluştur: appName_appVersion_timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      const folderName = `${jobInfo.appName || 'app'}_${jobInfo.appVersion || '1.0.0'}_${timestamp}`;
      const jobOutputDir = path.join(outputDir, folderName);
      
      await fs.ensureDir(jobOutputDir);
      console.log(`📁 Output klasörü oluşturuldu: ${jobOutputDir}`);
      
      // Her platform için dosyaları taşı
      const movedFiles = {};
      
      for (const [platform, result] of Object.entries(results)) {
        if (!result || !result.success) continue;
        
        const platformDir = path.join(jobOutputDir, platform);
        await fs.ensureDir(platformDir);
        
        // Dosyaları topla
        const filesToMove = [];
        
        if (result.packages && Array.isArray(result.packages)) {
          // Linux gibi birden fazla paket
          result.packages.forEach(pkg => {
            if (pkg.path) filesToMove.push(pkg.path);
          });
        } else if (result.path) {
          // Tek paket
          filesToMove.push(result.path);
        }
        
        // Dosyaları taşı
        const movedPaths = [];
        for (const filePath of filesToMove) {
          if (await fs.pathExists(filePath)) {
            const fileName = path.basename(filePath);
            const destPath = path.join(platformDir, fileName);
            
            await fs.copy(filePath, destPath);
            movedPaths.push(destPath);
            
            console.log(`  ✓ Taşındı: ${fileName} → ${platformDir}`);
          }
        }
        
        if (movedPaths.length > 0) {
          movedFiles[platform] = movedPaths;
        }
      }
      
      // README dosyası oluştur
      const readmeContent = `# ${jobInfo.appName || 'Uygulama'} v${jobInfo.appVersion || '1.0.0'}

Paketleme Tarihi: ${new Date().toLocaleString('tr-TR')}
Platformlar: ${jobInfo.platforms.join(', ')}

## Dosyalar

${Object.entries(movedFiles).map(([platform, files]) => `
### ${platform.toUpperCase()}
${files.map(f => `- ${path.basename(f)}`).join('\n')}
`).join('\n')}

---
Electron Paketleyici ile oluşturuldu
`;
      
      await fs.writeFile(path.join(jobOutputDir, 'README.md'), readmeContent, 'utf8');
      
      console.log(`✅ ${Object.keys(movedFiles).length} platform için dosyalar taşındı`);
      
      return jobOutputDir;
      
    } catch (error) {
      console.error(`❌ Output klasörüne taşıma hatası (${jobId}):`, error);
      return null;
    }
  }

  // Başarılı paketleme sonrası temizlik fonksiyonu
  async performPostPackagingCleanup(jobId, jobInfo, results) {
    try {
      console.log(`🧹 Paketleme sonrası temizlik başlatılıyor: ${jobId}`);
      
      const tempPath = path.join(process.cwd(), 'temp', jobId);
      
      if (!await fs.pathExists(tempPath)) {
        console.log(`⚠️ Temp klasörü bulunamadı: ${tempPath}`);
        return;
      }
      
      // Başarılı platform sonuçlarını kontrol et
      const successfulPlatforms = [];
      const finalPackages = [];
      
      console.log(`📋 Results yapısı:`, JSON.stringify(results, null, 2));
      
      for (const [platform, result] of Object.entries(results)) {
        // result.success true ise veya result objesi varsa (bazı durumlarda success field olmayabilir)
        if (result && (result.success === true || result.path || result.packages)) {
          successfulPlatforms.push(platform);
          
          // Path varsa ekle
          if (result.path) {
            finalPackages.push(result.path);
          }
          
          // Linux için birden fazla paket olabilir
          if (platform === 'linux' && result.packages) {
            result.packages.forEach(pkg => {
              if (pkg.path) finalPackages.push(pkg.path);
            });
          }
        }
      }
      
      if (successfulPlatforms.length === 0) {
        console.log(`⚠️ Başarılı platform bulunamadı, temizlik atlanıyor: ${jobId}`);
        return;
      }
      
      console.log(`📎 Başarılı platformlar: ${successfulPlatforms.join(', ')}`);
      console.log(`📦 Korunacak paketler: ${finalPackages.length} adet`);
      
      // Temp klasörünü tara ve sadece final paketleri koru
      await this.cleanupTempDirectory(tempPath, finalPackages);
      
      // Upload klasörünü temizle (sessionId ile ilişkili dosyalar)
      await this.cleanupUploadDirectory(jobInfo.sessionId);
      
      // Kuyrukta başka aktif iş var mı kontrol et
      await this.checkAndCleanIfQueueEmpty(jobId);
      
      console.log(`✅ Temizlik tamamlandı: ${jobId}`);
      
    } catch (error) {
      console.error(`❌ Temizlik hatası (${jobId}):`, error);
      // Temizlik hatası paketleme sonuçlarını etkilemez
    }
  }

  // Kuyruk boşsa tam temizlik yap
  async checkAndCleanIfQueueEmpty(excludeJobId) {
    try {
      // Aktif işleri kontrol et
      const activeJobs = this.getAllActiveJobs();
      const zipJobs = activeJobs.zipJobs.filter(job => job.status !== 'completed');
      const packagingJobs = activeJobs.packagingJobs.filter(job => 
        job.status !== 'completed' && job.status !== 'failed' && job.jobId !== excludeJobId
      );
      
      console.log(`🔍 Kuyruk kontrolü - Exclude: ${excludeJobId}`);
      console.log(`   Aktif ZIP işleri: ${zipJobs.length}`);
      console.log(`   Aktif paketleme işleri: ${packagingJobs.length}`);
      
      // Kuyruk tamamen boşsa
      if (zipJobs.length === 0 && packagingJobs.length === 0) {
        console.log('🧹 Kuyruk tamamen boş! Tüm temp ve uploads temizleniyor...');
        
        // Temp klasörünü temizle AMA yeni tamamlanan job'ın çıktısını KORU.
        // HTTP/agent client (book-update worker, Mac agent) artifact'ı status=completed
        // gördükten SONRA /api/download ile indiriyor; emptyDir onu silince indirme 404 olur.
        // excludeJobId dizinini bırak → bir sonraki job tamamlanınca o da temizlenir.
        const tempPath = path.join(process.cwd(), 'temp');
        if (await fs.pathExists(tempPath)) {
          const entries = await fs.readdir(tempPath);
          for (const entry of entries) {
            if (excludeJobId && entry === excludeJobId) continue; // tamamlanan job'ın artifact'ını koru
            await fs.remove(path.join(tempPath, entry));
          }
          console.log(`🗑️ Temp klasörü temizlendi (korunan job: ${excludeJobId || 'yok'})`);
        }
        
        // Tüm uploads klasörünü temizle
        const uploadsPath = path.join(process.cwd(), 'uploads');
        if (await fs.pathExists(uploadsPath)) {
          await fs.emptyDir(uploadsPath);
          console.log('🗑️ Uploads klasörü tamamen temizlendi');
        }
        
        console.log('✅ Tam temizlik tamamlandı - Kuyruk boş');
      } else {
        console.log('📋 Kuyrukta aktif işler var, temizleme yapılmadı');
      }
      
    } catch (error) {
      console.error('❌ Tam temizlik hatası:', error);
    }
  }

  // Upload klasörü temizleme fonksiyonu
  async cleanupUploadDirectory(sessionId) {
    try {
      console.log(`🗑️ Upload klasörü temizleniyor: ${sessionId}`);
      
      const uploadPath = path.join(process.cwd(), 'uploads', sessionId);
      
      if (!await fs.pathExists(uploadPath)) {
        console.log(`  ℹ️ Upload klasörü zaten yok: ${uploadPath}`);
        return;
      }
      
      // Session klasörünü tamamen sil
      await fs.remove(uploadPath);
      console.log(`  ✅ Upload klasörü silindi: ${uploadPath}`);
      
      // Ana uploads klasöründe boş klasör kaldıysa kontrol et
      const uploadsDir = path.join(process.cwd(), 'uploads');
      const remainingItems = await fs.readdir(uploadsDir);
      
      if (remainingItems.length === 0) {
        console.log(`  📁 Uploads klasörü boş, tüm geçici dosyalar temizlendi`);
      } else {
        console.log(`  📊 Uploads klasöründe ${remainingItems.length} session kaldı`);
      }
      
    } catch (error) {
      console.error(`❌ Upload klasörü temizlik hatası (${sessionId}):`, error);
    }
  }

  // Temp directory temizlik fonksiyonu
  async cleanupTempDirectory(tempPath, preserveFiles) {
    try {
      // Korunacak dosyaları normalize et (absolute paths)
      const preservePaths = preserveFiles.map(file => path.resolve(file));
      
      // Recursive olarak tüm dosyaları tara
      const allFiles = await this.getAllFilesRecursive(tempPath);
      
      let deletedCount = 0;
      let preservedCount = 0;
      
      for (const filePath of allFiles) {
        const absolutePath = path.resolve(filePath);
        
        // Eğer bu dosya korunacaklar listesinde değilse sil
        if (!preservePaths.includes(absolutePath)) {
          try {
            await fs.remove(filePath);
            deletedCount++;
          } catch (deleteError) {
            console.warn(`⚠️ Dosya silinemedi: ${filePath} - ${deleteError.message}`);
          }
        } else {
          preservedCount++;
        }
      }
      
      // Boş klasörleri temizle
      await this.removeEmptyDirectories(tempPath);
      
      console.log(`📊 Temizlik sonuçları: ${deletedCount} dosya silindi, ${preservedCount} paket korundu`);
      
    } catch (error) {
      console.error('❌ Temp directory temizlik hatası:', error);
    }
  }

  // Tüm dosyaları recursive olarak getir
  async getAllFilesRecursive(dir) {
    const files = [];
    
    async function scan(currentDir) {
      try {
        const items = await fs.readdir(currentDir);
        
        for (const item of items) {
          const fullPath = path.join(currentDir, item);
          const stat = await fs.stat(fullPath);
          
          if (stat.isDirectory()) {
            await scan(fullPath);
          } else {
            files.push(fullPath);
          }
        }
      } catch (error) {
        console.warn(`⚠️ Directory scan hatası: ${currentDir}`);
      }
    }
    
    await scan(dir);
    return files;
  }

  // Boş klasörleri kaldır
  async removeEmptyDirectories(dir) {
    try {
      const items = await fs.readdir(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = await fs.stat(fullPath);
        
        if (stat.isDirectory()) {
          await this.removeEmptyDirectories(fullPath);
          
          // Klasör boş mu kontrol et
          try {
            const subItems = await fs.readdir(fullPath);
            if (subItems.length === 0) {
              await fs.rmdir(fullPath);
              console.log(`📁 Boş klasör silindi: ${fullPath}`);
            }
          } catch (error) {
            // Klasör silinemezse devam et
          }
        }
      }
    } catch (error) {
      // Directory okuma hatasında devam et
    }
  }

  // Tüm aktif işleri listele
  getAllActiveJobs() {
    return {
      zipJobs: Array.from(this.zipQueue.values()),
      packagingJobs: Array.from(this.packagingQueue.values())
    };
  }

  // Tamamlanan işleri temizle
  cleanup() {
    // 1 saat önce tamamlanan işleri temizle
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    for (const [sessionId, jobInfo] of this.zipQueue.entries()) {
      if (jobInfo.status === 'completed' && 
          new Date(jobInfo.completedAt).getTime() < oneHourAgo) {
        this.zipQueue.delete(sessionId);
      }
    }

    for (const [jobId, jobInfo] of this.packagingQueue.entries()) {
      if ((jobInfo.status === 'completed' || jobInfo.status === 'failed') && 
          jobInfo.completedAt &&
          new Date(jobInfo.completedAt).getTime() < oneHourAgo) {
        this.packagingQueue.delete(jobId);
      }
    }
  }
}

// Singleton instance
const queueService = new QueueService();

// Otomatik temizlik - her 30 dakikada bir
setInterval(() => {
  queueService.cleanup();
}, 30 * 60 * 1000);

module.exports = queueService;