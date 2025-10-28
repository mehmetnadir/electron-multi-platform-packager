/**
 * Progress Raporlama Interface
 * Tüm platform servisleri bu interface ile progress bildirir
 */

class IProgressReporter {
  constructor(io = null, jobId = null, platformName = null) {
    this.io = io;
    this.jobId = jobId;
    this.platformName = platformName;
    this.currentStep = 0;
    this.totalSteps = 100;
    this.startTime = Date.now();
  }

  /**
   * Progress güncelleme
   * @param {number} progress - Progress yüzdesi (0-100)
   * @param {string} message - Durum mesajı
   * @param {Object} metadata - Ek bilgiler
   */
  updateProgress(progress, message, metadata = {}) {
    if (!this.io || !this.jobId) return;

    const progressData = {
      jobId: this.jobId,
      platform: this.platformName,
      status: 'processing',
      progress: Math.min(100, Math.max(0, progress)),
      message,
      timestamp: new Date().toISOString(),
      elapsedTime: Date.now() - this.startTime,
      ...metadata
    };

    this.io.emit('packaging-progress', progressData);
    console.log(`📊 ${this.platformName}: ${progress}% - ${message}`);
  }

  /**
   * Platform işlemini başlat
   * @param {string} message - Başlangıç mesajı
   */
  start(message = 'Paketleme başlıyor...') {
    this.startTime = Date.now();
    this.updateProgress(0, message, { stage: 'started' });
  }

  /**
   * Platform işlemini tamamla
   * @param {Object} result - Sonuç bilgileri
   * @param {string} message - Tamamlanma mesajı
   */
  complete(result, message = 'Paketleme tamamlandı') {
    if (!this.io || !this.jobId) return;

    const completionData = {
      jobId: this.jobId,
      platform: this.platformName,
      status: 'completed',
      progress: 100,
      message,
      result,
      timestamp: new Date().toISOString(),
      totalTime: Date.now() - this.startTime
    };

    this.io.emit('packaging-progress', completionData);
    console.log(`✅ ${this.platformName}: ${message}`);
  }

  /**
   * Platform işleminde hata
   * @param {Error} error - Hata bilgisi
   * @param {string} message - Hata mesajı
   */
  error(error, message = 'Paketlemede hata oluştu') {
    if (!this.io || !this.jobId) return;

    const errorData = {
      jobId: this.jobId,
      platform: this.platformName,
      status: 'failed',
      progress: 100,
      message,
      error: error.message,
      timestamp: new Date().toISOString(),
      totalTime: Date.now() - this.startTime
    };

    this.io.emit('packaging-progress', errorData);
    console.error(`❌ ${this.platformName}: ${message} - ${error.message}`);
  }

  /**
   * Adım bazlı progress güncellemesi
   * @param {number} stepIndex - Mevcut adım
   * @param {string} stepName - Adım adı
   * @param {string} message - Adım mesajı
   */
  step(stepIndex, stepName, message) {
    this.currentStep = stepIndex;
    const progress = Math.round((stepIndex / this.totalSteps) * 100);
    
    this.updateProgress(progress, message, {
      step: stepIndex,
      stepName,
      totalSteps: this.totalSteps
    });
  }

  /**
   * Toplam adım sayısını ayarla
   * @param {number} totalSteps - Toplam adım sayısı
   */
  setTotalSteps(totalSteps) {
    this.totalSteps = totalSteps;
  }

  /**
   * Alt görev progress'i
   * @param {number} subProgress - Alt görev progress'i (0-100)
   * @param {string} subTask - Alt görev adı
   */
  subTask(subProgress, subTask) {
    const baseProgress = Math.round((this.currentStep / this.totalSteps) * 100);
    const adjustedProgress = baseProgress + (subProgress / this.totalSteps);
    
    this.updateProgress(
      Math.min(100, adjustedProgress),
      `${subTask}`,
      {
        step: this.currentStep,
        subProgress,
        subTask
      }
    );
  }

  /**
   * Özel event gönder
   * @param {string} eventName - Event adı
   * @param {Object} data - Event verisi
   */
  emit(eventName, data) {
    if (!this.io) return;

    this.io.emit(eventName, {
      jobId: this.jobId,
      platform: this.platformName,
      timestamp: new Date().toISOString(),
      ...data
    });
  }
}

module.exports = IProgressReporter;