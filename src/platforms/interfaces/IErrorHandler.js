/**
 * Platform Hata Yönetimi Interface
 * Platform özel hata türleri ve işleme stratejileri
 */

class IErrorHandler {
  constructor(platformName, logger = console) {
    this.platformName = platformName;
    this.logger = logger;
    this.errorTypes = {
      DEPENDENCY_MISSING: 'dependency_missing',
      CONFIGURATION_ERROR: 'configuration_error',
      BUILD_FAILED: 'build_failed',
      FILE_SYSTEM_ERROR: 'file_system_error',
      NETWORK_ERROR: 'network_error',
      TIMEOUT_ERROR: 'timeout_error',
      UNKNOWN_ERROR: 'unknown_error'
    };
  }

  /**
   * Hata işleme ve kategorize etme
   * @param {Error} error - Orijinal hata
   * @param {Object} context - Hata konteksti
   * @returns {Object} İşlenmiş hata bilgisi
   */
  handleError(error, context = {}) {
    const errorInfo = this.categorizeError(error, context);
    this.logError(errorInfo);
    return this.formatError(errorInfo);
  }

  /**
   * Hatayı kategorize et
   * @param {Error} error - Hata
   * @param {Object} context - Kontekst
   * @returns {Object} Kategorize edilmiş hata
   */
  categorizeError(error, context) {
    const errorType = this.determineErrorType(error);
    const severity = this.determineSeverity(error, errorType);
    const isRecoverable = this.isRecoverable(error, errorType);
    const suggestions = this.getSuggestions(errorType, error);

    return {
      platform: this.platformName,
      type: errorType,
      severity,
      isRecoverable,
      originalError: error,
      message: error.message,
      stack: error.stack,
      context,
      suggestions,
      timestamp: new Date().toISOString(),
      errorId: this.generateErrorId()
    };
  }

  /**
   * Hata türünü belirle
   * @param {Error} error - Hata
   * @returns {string} Hata türü
   */
  determineErrorType(error) {
    const message = error.message.toLowerCase();

    if (message.includes('enoent') || message.includes('file not found')) {
      return this.errorTypes.FILE_SYSTEM_ERROR;
    }
    if (message.includes('timeout') || message.includes('timed out')) {
      return this.errorTypes.TIMEOUT_ERROR;
    }
    if (message.includes('network') || message.includes('fetch')) {
      return this.errorTypes.NETWORK_ERROR;
    }
    if (message.includes('gradle') || message.includes('capacitor') || 
        message.includes('electron-builder')) {
      return this.errorTypes.DEPENDENCY_MISSING;
    }
    if (message.includes('build failed') || message.includes('compilation')) {
      return this.errorTypes.BUILD_FAILED;
    }
    if (message.includes('config') || message.includes('invalid')) {
      return this.errorTypes.CONFIGURATION_ERROR;
    }

    return this.errorTypes.UNKNOWN_ERROR;
  }

  /**
   * Hata şiddetini belirle
   * @param {Error} error - Hata
   * @param {string} errorType - Hata türü
   * @returns {string} Şiddet seviyesi
   */
  determineSeverity(error, errorType) {
    switch (errorType) {
      case this.errorTypes.DEPENDENCY_MISSING:
      case this.errorTypes.CONFIGURATION_ERROR:
        return 'high';
      case this.errorTypes.BUILD_FAILED:
      case this.errorTypes.FILE_SYSTEM_ERROR:
        return 'medium';
      case this.errorTypes.NETWORK_ERROR:
      case this.errorTypes.TIMEOUT_ERROR:
        return 'low';
      default:
        return 'medium';
    }
  }

  /**
   * Hata kurtarılabilir mi
   * @param {Error} error - Hata
   * @param {string} errorType - Hata türü
   * @returns {boolean} Kurtarılabilir mi
   */
  isRecoverable(error, errorType) {
    switch (errorType) {
      case this.errorTypes.NETWORK_ERROR:
      case this.errorTypes.TIMEOUT_ERROR:
        return true;
      case this.errorTypes.FILE_SYSTEM_ERROR:
        return error.message.includes('EBUSY') || error.message.includes('EMFILE');
      case this.errorTypes.BUILD_FAILED:
        return false; // Platform specific recovery
      default:
        return false;
    }
  }

  /**
   * Hata için öneriler
   * @param {string} errorType - Hata türü
   * @param {Error} error - Orijinal hata
   * @returns {Array<string>} Öneriler
   */
  getSuggestions(errorType, error) {
    const suggestions = [];

    switch (errorType) {
      case this.errorTypes.DEPENDENCY_MISSING:
        suggestions.push('Gerekli bağımlılıkları yükleyin');
        suggestions.push('PATH environment variable\'ını kontrol edin');
        break;
      case this.errorTypes.CONFIGURATION_ERROR:
        suggestions.push('Konfigürasyon dosyalarını kontrol edin');
        suggestions.push('Eksik parametreleri ekleyin');
        break;
      case this.errorTypes.BUILD_FAILED:
        suggestions.push('Build loglarını inceleyin');
        suggestions.push('Kaynak dosyaların doğruluğunu kontrol edin');
        break;
      case this.errorTypes.FILE_SYSTEM_ERROR:
        suggestions.push('Dosya izinlerini kontrol edin');
        suggestions.push('Disk alanını kontrol edin');
        break;
      case this.errorTypes.NETWORK_ERROR:
        suggestions.push('İnternet bağlantınızı kontrol edin');
        suggestions.push('Proxy ayarlarını kontrol edin');
        break;
      case this.errorTypes.TIMEOUT_ERROR:
        suggestions.push('İşlem zaman aşımı limitini artırın');
        suggestions.push('Sistem kaynaklarını kontrol edin');
        break;
    }

    return suggestions;
  }

  /**
   * Hatayı formatla
   * @param {Object} errorInfo - Hata bilgisi
   * @returns {Object} Formatlanmış hata
   */
  formatError(errorInfo) {
    return {
      success: false,
      error: {
        id: errorInfo.errorId,
        platform: errorInfo.platform,
        type: errorInfo.type,
        severity: errorInfo.severity,
        message: this.getLocalizedMessage(errorInfo),
        isRecoverable: errorInfo.isRecoverable,
        suggestions: errorInfo.suggestions,
        timestamp: errorInfo.timestamp,
        details: {
          originalMessage: errorInfo.message,
          context: errorInfo.context
        }
      }
    };
  }

  /**
   * Lokalize edilmiş hata mesajı
   * @param {Object} errorInfo - Hata bilgisi
   * @returns {string} Lokalize mesaj
   */
  getLocalizedMessage(errorInfo) {
    const messages = {
      [this.errorTypes.DEPENDENCY_MISSING]: `${this.platformName} için gerekli araçlar eksik`,
      [this.errorTypes.CONFIGURATION_ERROR]: `${this.platformName} konfigürasyon hatası`,
      [this.errorTypes.BUILD_FAILED]: `${this.platformName} paketleme başarısız`,
      [this.errorTypes.FILE_SYSTEM_ERROR]: 'Dosya sistemi hatası',
      [this.errorTypes.NETWORK_ERROR]: 'Ağ bağlantı hatası',
      [this.errorTypes.TIMEOUT_ERROR]: 'İşlem zaman aşımına uğradı',
      [this.errorTypes.UNKNOWN_ERROR]: 'Bilinmeyen hata oluştu'
    };

    return messages[errorInfo.type] || errorInfo.message;
  }

  /**
   * Hata logla
   * @param {Object} errorInfo - Hata bilgisi
   */
  logError(errorInfo) {
    const logLevel = errorInfo.severity === 'high' ? 'error' : 'warn';
    
    this.logger[logLevel](`[${this.platformName}] ${errorInfo.type}: ${errorInfo.message}`, {
      errorId: errorInfo.errorId,
      context: errorInfo.context,
      suggestions: errorInfo.suggestions
    });
  }

  /**
   * Benzersiz hata ID oluştur
   * @returns {string} Hata ID
   */
  generateErrorId() {
    return `${this.platformName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = IErrorHandler;