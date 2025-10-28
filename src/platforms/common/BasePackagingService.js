/**
 * Temel Paketleme Servisi
 * Tüm platform servislerinin türetileceği base class
 */

const IPlatformPackager = require('../interfaces/IPlatformPackager');
const IProgressReporter = require('../interfaces/IProgressReporter');
const IErrorHandler = require('../interfaces/IErrorHandler');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class BasePackagingService extends IPlatformPackager {
  constructor(platformName) {
    super();
    this.platformName = platformName;
    this.errorHandler = new IErrorHandler(platformName);
    this.progressReporter = null;
    this.config = null;
  }

  /**
   * Platform servisi başlatma
   * @param {Object} config - Platform konfigürasyonu
   * @returns {Promise<boolean>}
   */
  async initialize(config = {}) {
    try {
      this.config = config;
      
      // Bağımlılıkları kontrol et
      const depCheck = await this.checkDependencies();
      const missingDeps = Object.entries(depCheck)
        .filter(([, status]) => !status.available)
        .map(([name]) => name);

      if (missingDeps.length > 0) {
        console.warn(`⚠️ ${this.platformName} - Eksik bağımlılıklar: ${missingDeps.join(', ')}`);
      }

      this.isInitialized = true;
      console.log(`✅ ${this.platformName} servisi başlatıldı`);
      return true;
    } catch (error) {
      console.error(`❌ ${this.platformName} servisi başlatılamadı:`, error.message);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Progress reporter'ı ayarla
   * @param {Object} io - Socket.IO instance
   * @param {string} jobId - İş ID
   */
  setProgressReporter(io, jobId) {
    this.progressReporter = new IProgressReporter(io, jobId, this.platformName);
  }

  /**
   * Güvenli async işlem wrapper
   * @param {Function} operation - Async operasyon
   * @param {Object} context - Hata konteksti
   * @returns {Promise<Object>}
   */
  async safeExecute(operation, context = {}) {
    try {
      return await operation();
    } catch (error) {
      return this.errorHandler.handleError(error, context);
    }
  }

  /**
   * Dosya hash hesaplama
   * @param {string} filePath - Dosya yolu
   * @returns {Promise<string>} Hash değeri
   */
  async calculateFileHash(filePath) {
    try {
      const fileBuffer = await fs.readFile(filePath);
      const hashSum = crypto.createHash('sha256');
      hashSum.update(fileBuffer);
      return hashSum.digest('hex');
    } catch (error) {
      return null;
    }
  }

  /**
   * Logo işleme (ortak fonksiyon)
   * @param {string} logoPath - Logo yolu
   * @param {string} targetPath - Hedef yol
   * @param {Object} options - İşleme seçenekleri
   * @returns {Promise<string>} İşlenmiş logo yolu
   */
  async processLogo(logoPath, targetPath, options = {}) {
    if (!logoPath || !await fs.pathExists(logoPath)) {
      return null;
    }

    const logoExt = path.extname(logoPath);
    const targetLogoPath = path.join(targetPath, `logo${logoExt}`);
    
    await fs.copy(logoPath, targetLogoPath);
    return targetLogoPath;
  }

  /**
   * Geçici klasör oluşturma
   * @param {string} basePath - Ana yol
   * @param {string} prefix - Klasör ön eki
   * @returns {Promise<string>} Geçici klasör yolu
   */
  async createTempDirectory(basePath, prefix = 'temp') {
    const tempDir = path.join(basePath, `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    await fs.ensureDir(tempDir);
    return tempDir;
  }

  /**
   * Klasör boyutu hesaplama
   * @param {string} dirPath - Klasör yolu
   * @returns {Promise<number>} Boyut (bytes)
   */
  async calculateDirectorySize(dirPath) {
    let totalSize = 0;
    
    try {
      const files = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const file of files) {
        const filePath = path.join(dirPath, file.name);
        
        if (file.isDirectory()) {
          totalSize += await this.calculateDirectorySize(filePath);
        } else {
          const stats = await fs.stat(filePath);
          totalSize += stats.size;
        }
      }
    } catch (error) {
      // Sessizce devam et
    }
    
    return totalSize;
  }

  /**
   * Dosya validasyonu
   * @param {string} filePath - Dosya yolu
   * @param {Object} requirements - Gereksinimler
   * @returns {Promise<boolean>} Geçerli mi
   */
  async validateFile(filePath, requirements = {}) {
    try {
      const stats = await fs.stat(filePath);
      
      // Boyut kontrolü
      if (requirements.maxSize && stats.size > requirements.maxSize) {
        return false;
      }
      
      // Extension kontrolü
      if (requirements.extensions) {
        const ext = path.extname(filePath).toLowerCase();
        if (!requirements.extensions.includes(ext)) {
          return false;
        }
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * İşlem timeout wrapper
   * @param {Function} operation - Async operasyon
   * @param {number} timeoutMs - Timeout süresi (ms)
   * @returns {Promise<any>} Operasyon sonucu
   */
  async withTimeout(operation, timeoutMs = 300000) { // 5 dakika default
    return Promise.race([
      operation(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`İşlem ${timeoutMs}ms içinde tamamlanamadı`)), timeoutMs)
      )
    ]);
  }

  /**
   * Retry wrapper
   * @param {Function} operation - Async operasyon
   * @param {number} maxRetries - Maksimum deneme sayısı
   * @param {number} delayMs - Denemeler arası bekleme
   * @returns {Promise<any>} Operasyon sonucu
   */
  async withRetry(operation, maxRetries = 3, delayMs = 1000) {
    let lastError;
    
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (i < maxRetries) {
          console.warn(`⚠️ ${this.platformName} - Deneme ${i + 1}/${maxRetries + 1} başarısız, ${delayMs}ms sonra tekrar deneniyor...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Platform özel metadata oluşturma
   * @param {Object} request - Paketleme isteği
   * @returns {Object} Metadata
   */
  createMetadata(request) {
    return {
      platform: this.platformName,
      version: this.version,
      appName: request.appName,
      appVersion: request.appVersion,
      buildDate: new Date().toISOString(),
      buildEnvironment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      }
    };
  }

  /**
   * Sonuç formatı standardizasyonu
   * @param {Object} result - Ham sonuç
   * @param {Object} request - Orijinal istek
   * @returns {Object} Standart sonuç formatı
   */
  formatResult(result, request) {
    return {
      success: true,
      platform: this.platformName,
      timestamp: new Date().toISOString(),
      metadata: this.createMetadata(request),
      ...result
    };
  }
}

module.exports = BasePackagingService;