/**
 * Platform Orchestrator
 * 
 * Tüm platform servislerini koordine eden ana orkestratör
 * 
 * ÖZELLİKLER:
 * - API çağrıları ile platform servislerini koordine eder
 * - Service Registry entegrasyonu
 * - Paralel ve sıralı paketleme desteği
 * - Error isolation ve rollback mekanizması
 * - Progress tracking ve WebSocket entegrasyonu
 * - Load balancing ve failover
 * - Metadata toplama ve standardizasyon
 * - Circuit breaker pattern
 * 
 * @author Dijitap Modular Architecture
 * @version 1.0.0
 */

const path = require('path');
const fs = require('fs-extra');
const EventEmitter = require('events');
const { getRegistry } = require('../registry/PlatformServiceRegistry');

class PlatformOrchestrator extends EventEmitter {
    
    constructor(io = null) {
        super();
        
        this.io = io; // WebSocket bağlantısı
        this.registry = getRegistry();
        
        // Orchestrator durumu
        this.activeJobs = new Map();
        this.jobHistory = new Map();
        this.jobCounter = 0;
        
        // Konfigurasyon
        this.config = {
            maxConcurrentJobs: 3,
            maxRetries: 3,
            timeout: 30 * 60 * 1000, // 30 dakika
            enableErrorIsolation: true,
            enableCircuitBreaker: true
        };
        
        // Circuit breaker durumları
        this.circuitBreakers = new Map();
        
        console.log('🎭 Platform Orchestrator başlatıldı');
        this._setupEventListeners();
    }

    /**
     * Event listener'ları ayarla
     */
    _setupEventListeners() {
        // Registry event'lerini dinle
        this.registry.on('service:error', (data) => {
            this._handleServiceError(data);
        });
        
        this.registry.on('service:progress', (data) => {
            this._handleServiceProgress(data);
        });
        
        this.registry.on('service:health-updated', (data) => {
            this._handleServiceHealthUpdate(data);
        });
    }

    /**
     * Ana paketleme işlemini başlat
     */
    async startPackaging(jobInfo) {
        const jobId = this._generateJobId();
        const { sessionId, platforms, logoId, appName, appVersion, packageOptions } = jobInfo;
        
        console.log(`🚀 Paketleme işi başlatılıyor: ${jobId}`);
        console.log(`📦 Platformlar: ${platforms.join(', ')}`);
        console.log(`📱 Uygulama: ${appName} v${appVersion}`);
        
        // Job'ı kaydet
        const job = {
            jobId,
            sessionId,
            platforms,
            logoId,
            appName,
            appVersion,
            packageOptions,
            status: 'started',
            startTime: new Date().toISOString(),
            results: {},
            errors: {},
            progress: 0
        };
        
        this.activeJobs.set(jobId, job);
        this.emit('job:started', job);
        
        try {
            // Logo bilgilerini al
            const { companyName, companyId } = await this._getLogoInfo(logoId);
            
            // Build dosyalarını hazırla
            const { workingPath, tempPath } = await this._prepareBuildFiles(sessionId, jobId, appName, appVersion, companyName);
            
            // Logo'yu hazırla
            const logoPath = logoId ? await this._prepareLogo(logoId, tempPath) : null;
            
            // Platform işlemlerini başlat
            const results = await this._processPlatforms(job, {
                workingPath,
                tempPath,
                appName,
                appVersion,
                logoPath,
                packageOptions,
                companyName,
                companyId
            });
            
            // Job'ı tamamla
            job.status = 'completed';
            job.endTime = new Date().toISOString();
            job.results = results;
            job.progress = 100;
            
            this.activeJobs.delete(jobId);
            this.jobHistory.set(jobId, job);
            
            this.emit('job:completed', job);
            
            console.log(`✅ Paketleme işi tamamlandı: ${jobId}`);
            return results;
            
        } catch (error) {
            // Job'ı hata ile tamamla
            job.status = 'failed';
            job.endTime = new Date().toISOString();
            job.error = error.message;
            job.progress = 100;
            
            this.activeJobs.delete(jobId);
            this.jobHistory.set(jobId, job);
            
            this.emit('job:failed', { job, error });
            
            console.error(`❌ Paketleme işi başarısız: ${jobId}`, error);
            throw error;
        }
    }

    /**
     * Job ID oluştur
     */
    _generateJobId() {
        return `job_${++this.jobCounter}_${Date.now()}`;
    }

    /**
     * Logo bilgilerini al
     */
    async _getLogoInfo(logoId) {
        if (!logoId) {
            return { companyName: null, companyId: null };
        }
        
        try {
            const logoService = require('../../utils/logoService');
            const logoInfo = await logoService.getLogoById(logoId);
            
            if (logoInfo) {
                return {
                    companyName: logoInfo.kurumAdi,
                    companyId: logoInfo.kurumId
                };
            }
        } catch (error) {
            console.error('Logo bilgisi alınırken hata:', error);
        }
        
        return { companyName: null, companyId: null };
    }

    /**
     * Build dosyalarını hazırla
     */
    async _prepareBuildFiles(sessionId, jobId, appName, appVersion, companyName) {
        console.log('📁 Build dosyaları hazırlanıyor...');
        
        const buildPath = path.join('uploads', sessionId);
        const tempPath = path.join('temp', jobId);
        
        // Session directory kontrolü
        if (!await fs.pathExists(buildPath)) {
            throw new Error(`Upload session bulunamadı: ${sessionId}. Lütfen dosyaları tekrar yükleyin.`);
        }
        
        await fs.ensureDir(tempPath);
        
        // Build klasörünü temp'e kopyala
        const workingPath = path.join(tempPath, 'app');
        
        try {
            await fs.copy(buildPath, workingPath);
        } catch (copyError) {
            throw new Error(`Build dosyaları kopyalanamadı: ${copyError.message}. Session: ${sessionId}`);
        }
        
        // Electron için gerekli dosyaları oluştur
        await this._prepareElectronFiles(workingPath, appName, appVersion, companyName);
        
        console.log('✅ Build dosyaları hazırlandı');
        return { workingPath, tempPath };
    }

    /**
     * Electron dosyalarını hazırla
     */
    async _prepareElectronFiles(appPath, appName, appVersion, companyName = null) {
        // Basit Electron dosya hazırlama (gerekirse genişletilebilir)
        const packageJson = {
            name: appName.toLowerCase().replace(/\s+/g, '-'),
            version: appVersion,
            description: `${appName} - Electron Uygulaması`,
            main: "main.js"
        };
        
        await fs.writeJson(path.join(appPath, 'package.json'), packageJson, { spaces: 2 });
        
        // main.js yoksa basit bir tane oluştur
        const mainJsPath = path.join(appPath, 'main.js');
        if (!await fs.pathExists(mainJsPath)) {
            const mainJsContent = `
const { app, BrowserWindow, Menu, screen } = require('electron');
const path = require('path');

function createWindow() {
  // Geçmişteki başarılı yöntem: ekran boyutlarını al
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  const mainWindow = new BrowserWindow({
    width: width, // Geçmişteki başarılı yöntem
    height: height, // Geçmişteki başarılı yöntem
    title: '${companyName ? `${appName} - ${companyName}` : appName}',
    fullscreen: false, // Geçmişteki başarılı yöntemde fullscreen yok
    resizable: true, // Pencere yeniden boyutlandırılabilir
    maximizable: true, // Maksimize edilebilir
    simpleFullscreen: false, // macOS için
    fullscreenable: true, // Fullscreen yapılabilir
    titleBarStyle: 'default', // Windows için normal başlık çubuğu
    icon: path.join(__dirname, 'app-icon.png'), // ÇÖZÜLDÜ: Uygulama iconu
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    // Windows için menü çubuğu gizlenir ama pencere kontrolları kalır
    autoHideMenuBar: false,
    menuBarVisible: true,
    show: false // Hazır olana kadar gizli
  });
  
  mainWindow.loadFile('index.html');
  
  // Geçmişteki başarılı yöntem: maximize + removeMenu
  mainWindow.maximize();
  mainWindow.removeMenu();
  
  // Pencere hazır olduğunda göster
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Windows için pencere odaklanır
    mainWindow.focus();
  });
  
  // Geliştirici araçlarını kapat
  if (!process.env.DEBUG) {
    mainWindow.webContents.closeDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
            `;
            await fs.writeFile(mainJsPath, mainJsContent.trim());
        }
    }

    /**
     * Logo'yu hazırla
     */
    async _prepareLogo(logoId, tempPath) {
        try {
            const logoService = require('../../utils/logoService');
            const logoInfo = await logoService.getLogoById(logoId);
            
            if (!logoInfo) {
                throw new Error('Logo bulunamadı');
            }
            
            const logoDestPath = path.join(tempPath, 'logo' + path.extname(logoInfo.filePath));
            await fs.copy(logoInfo.filePath, logoDestPath);
            
            return logoDestPath;
        } catch (error) {
            console.warn('⚠️ Logo hazırlama hatası:', error.message);
            return null;
        }
    }

    /**
     * Platform işlemlerini yürüt
     */
    async _processPlatforms(job, buildInfo) {
        const { platforms } = job;
        const results = {};
        
        console.log(`🔄 ${platforms.length} platform için paketleme başlatılıyor...`);
        
        for (let i = 0; i < platforms.length; i++) {
            const platform = platforms[i];
            
            try {
                console.log(`📦 ${platform} platformu işleniyor... (${i + 1}/${platforms.length})`);
                
                // Progress güncellemesi
                const baseProgress = Math.round((i / platforms.length) * 100);
                this._updateJobProgress(job.jobId, baseProgress, `${platform} platformu işleniyor...`);
                
                // Circuit breaker kontrolü
                if (!this._isCircuitBreakerOpen(platform)) {
                    // Platform servisini al ve çalıştır
                    const result = await this._processSinglePlatform(platform, buildInfo, job.jobId, i, platforms.length);
                    
                    results[platform] = {
                        success: true,
                        ...result
                    };
                    
                    // Circuit breaker'ı başarı olarak işaretle
                    this._recordCircuitBreakerSuccess(platform);
                    
                    console.log(`✅ ${platform} platformu başarıyla tamamlandı`);
                } else {
                    console.warn(`⚠️ ${platform} platformu circuit breaker açık - atlanıyor`);
                    results[platform] = {
                        success: false,
                        error: 'Circuit breaker açık - servis geçici olarak devre dışı'
                    };
                }
                
            } catch (error) {
                console.error(`❌ ${platform} paketleme hatası:`, error);
                
                // Circuit breaker'ı hata olarak işaretle
                this._recordCircuitBreakerFailure(platform);
                
                results[platform] = {
                    success: false,
                    error: error.message
                };
                
                // Error isolation - diğer platformları etkileme
                if (this.config.enableErrorIsolation) {
                    console.log(`🛡️ Error isolation aktif - ${platform} hatası diğer platformları etkilemiyor`);
                } else {
                    throw error; // Error isolation devre dışıysa hatayı yukarı fırlat
                }
            }
            
            // Platform tamamlandı - progress güncelle
            const completedProgress = Math.round(((i + 1) / platforms.length) * 100);
            this._updateJobProgress(job.jobId, completedProgress, `${platform} tamamlandı`);
        }
        
        return results;
    }

    /**
     * Tek platform işlemi
     */
    async _processSinglePlatform(platform, buildInfo, jobId, platformIndex, totalPlatforms) {
        try {
            // Platform servisini al
            const service = await this.registry.getService(platform);
            
            // Request objesini hazırla
            const request = {
                ...buildInfo,
                jobId,
                platformIndex,
                totalPlatforms
            };
            
            // Timeout ile paketleme işlemini çalıştır
            const result = await this._executeWithTimeout(
                () => service.package(request),
                this.config.timeout,
                `${platform} paketleme timeout`
            );
            
            return result;
            
        } catch (error) {
            throw new Error(`${platform} paketleme hatası: ${error.message}`);
        }
    }

    /**
     * Timeout ile işlem çalıştır
     */
    async _executeWithTimeout(operation, timeout, errorMessage) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Timeout: ${errorMessage}`));
            }, timeout);
            
            operation()
                .then((result) => {
                    clearTimeout(timer);
                    resolve(result);
                })
                .catch((error) => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }

    /**
     * Job progress güncellemesi
     */
    _updateJobProgress(jobId, progress, message) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            job.progress = progress;
            job.lastMessage = message;
            job.lastUpdate = new Date().toISOString();
            
            // WebSocket ile bildir
            if (this.io) {
                this.io.emit('packaging-progress', {
                    jobId,
                    progress,
                    message,
                    timestamp: job.lastUpdate
                });
            }
            
            this.emit('job:progress', { jobId, progress, message });
        }
    }

    /**
     * Circuit breaker kontrolleri
     */
    _isCircuitBreakerOpen(platform) {
        if (!this.config.enableCircuitBreaker) {
            return false;
        }
        
        const breaker = this.circuitBreakers.get(platform);
        if (!breaker) {
            return false;
        }
        
        // 5 dakika içinde 3 hata varsa circuit breaker'ı aç
        const now = Date.now();
        const recentFailures = breaker.failures.filter(time => now - time < 5 * 60 * 1000);
        
        return recentFailures.length >= 3;
    }

    _recordCircuitBreakerFailure(platform) {
        if (!this.circuitBreakers.has(platform)) {
            this.circuitBreakers.set(platform, { failures: [], successes: [] });
        }
        
        const breaker = this.circuitBreakers.get(platform);
        breaker.failures.push(Date.now());
        
        // Eski kayıtları temizle (1 saat)
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        breaker.failures = breaker.failures.filter(time => time > oneHourAgo);
    }

    _recordCircuitBreakerSuccess(platform) {
        if (!this.circuitBreakers.has(platform)) {
            this.circuitBreakers.set(platform, { failures: [], successes: [] });
        }
        
        const breaker = this.circuitBreakers.get(platform);
        breaker.successes.push(Date.now());
        
        // Başarı durumunda failure'ları temizle
        breaker.failures = [];
    }

    /**
     * Service event handler'ları
     */
    _handleServiceError(data) {
        console.error(`🚨 Servis hatası [${data.platform}]:`, data.error);
        this.emit('service:error', data);
    }

    _handleServiceProgress(data) {
        // Platform progress'ini job progress'ine dönüştür
        if (this.io) {
            this.io.emit('packaging-progress', {
                platform: data.platform,
                progress: data.progress,
                message: data.message,
                timestamp: data.timestamp
            });
        }
    }

    _handleServiceHealthUpdate(data) {
        console.log(`💓 Servis sağlık güncellendi [${data.platform}]:`, data.health.healthy ? 'Sağlıklı' : 'Sorunlu');
        this.emit('service:health', data);
    }

    /**
     * Aktif job'ları listele
     */
    getActiveJobs() {
        return Array.from(this.activeJobs.values());
    }

    /**
     * Job geçmişini al
     */
    getJobHistory(limit = 50) {
        const jobs = Array.from(this.jobHistory.values());
        return jobs.slice(-limit).reverse(); // Son 50 job'ı ters sırada
    }

    /**
     * Orchestrator durumunu al
     */
    getStatus() {
        return {
            activeJobs: this.activeJobs.size,
            totalJobsProcessed: this.jobHistory.size,
            registryStatus: this.registry.getRegistryStatus(),
            circuitBreakers: Object.fromEntries(this.circuitBreakers),
            config: this.config,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Orchestrator'ü temizle
     */
    cleanup() {
        console.log('🧹 Platform Orchestrator temizleniyor...');
        
        // Aktif job'ları iptal et
        for (const [jobId, job] of this.activeJobs) {
            job.status = 'cancelled';
            job.endTime = new Date().toISOString();
        }
        
        // Event listener'ları temizle
        this.removeAllListeners();
        
        // Map'leri temizle
        this.activeJobs.clear();
        this.jobHistory.clear();
        this.circuitBreakers.clear();
        
        console.log('✅ Platform Orchestrator temizlendi');
    }
}

module.exports = PlatformOrchestrator;