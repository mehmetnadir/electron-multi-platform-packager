/**
 * Platform Paketleyici Temel Interface
 * Tüm platform servislerinin uygulaması gereken standart API kontratı
 */

class IPlatformPackager {
  constructor() {
    this.platformName = null;
    this.version = '1.0.0';
    this.supportedFormats = [];
    this.dependencies = [];
    this.isInitialized = false;
  }

  /**
   * Platform servisini başlat ve dependencies'leri kontrol et
   * @returns {Promise<boolean>} Başlatma başarılı mı
   */
  async initialize() {
    throw new Error('initialize() metodu platform servisinde implement edilmeli');
  }

  /**
   * Platform paketleme işlemini gerçekleştir
   * @param {Object} request - Paketleme isteği
   * @param {string} request.workingPath - Kaynak dosya yolu
   * @param {string} request.tempPath - Geçici dosya yolu
   * @param {string} request.appName - Uygulama adı
   * @param {string} request.appVersion - Uygulama versiyonu
   * @param {string} request.logoPath - Logo dosya yolu
   * @param {Object} request.options - Platform özel seçenekler
   * @param {Object} request.companyInfo - Şirket bilgileri
   * @param {Object} request.progressReporter - Progress raporlayıcı
   * @returns {Promise<Object>} Paketleme sonucu
   */
  async package(request) {
    throw new Error('package() metodu platform servisinde implement edilmeli');
  }

  /**
   * Platform özel validasyon işlemleri
   * @param {Object} request - Validasyon isteği
   * @returns {Promise<Object>} Validasyon sonucu
   */
  async validate(request) {
    throw new Error('validate() metodu platform servisinde implement edilmeli');
  }

  /**
   * Platform servis durumunu kontrol et
   * @returns {Promise<Object>} Sağlık durumu
   */
  async healthCheck() {
    return {
      platform: this.platformName,
      version: this.version,
      status: this.isInitialized ? 'healthy' : 'not_initialized',
      timestamp: new Date().toISOString(),
      dependencies: await this.checkDependencies()
    };
  }

  /**
   * Platform bağımlılıklarını kontrol et
   * @returns {Promise<Object>} Bağımlılık durumu
   */
  async checkDependencies() {
    const results = {};
    for (const dep of this.dependencies) {
      try {
        results[dep] = await this.checkDependency(dep);
      } catch (error) {
        results[dep] = { available: false, error: error.message };
      }
    }
    return results;
  }

  /**
   * Tek bir bağımlılığı kontrol et
   * @param {string} dependency - Bağımlılık adı
   * @returns {Promise<Object>} Bağımlılık durumu
   */
  async checkDependency(dependency) {
    throw new Error('checkDependency() metodu platform servisinde implement edilmeli');
  }

  /**
   * Platform özel temizlik işlemleri
   * @param {string} tempPath - Temizlenecek geçici klasör
   * @returns {Promise<void>}
   */
  async cleanup(tempPath) {
    // Default implementation - platform servisleri override edebilir
    const fs = require('fs-extra');
    if (await fs.pathExists(tempPath)) {
      await fs.remove(tempPath);
    }
  }

  /**
   * Platform için desteklenen çıktı formatları
   * @returns {Array<string>} Format listesi
   */
  getSupportedFormats() {
    return this.supportedFormats;
  }

  /**
   * Platform için gerekli minimum konfigürasyon
   * @returns {Object} Konfigürasyon şeması
   */
  getConfigurationSchema() {
    return {
      required: ['appName', 'appVersion', 'workingPath'],
      optional: ['logoPath', 'companyInfo'],
      platformSpecific: {}
    };
  }

  /**
   * Platform bilgilerini döndür
   * @returns {Object} Platform metadata
   */
  getPlatformInfo() {
    return {
      name: this.platformName,
      version: this.version,
      supportedFormats: this.supportedFormats,
      dependencies: this.dependencies,
      isInitialized: this.isInitialized
    };
  }
}

module.exports = IPlatformPackager;