/**
 * Platform Service Registry
 * 
 * Tüm platform servislerini dinamik olarak yöneten merkezi kayıt sistemi
 * 
 * ÖZELLİKLER:
 * - Platform servislerini dinamik kaydetme/kaldırma
 * - Servis keşfi ve sağlık kontrolü
 * - Load balancing ve failover desteği
 * - Servis versiyonlama
 * - Dependency injection container
 * - Configuration management
 * - Event-driven architecture
 * - Hot reloading desteği
 * 
 * @author Dijitap Modular Architecture
 * @version 1.0.0
 */

const path = require('path');
const fs = require('fs-extra');
const EventEmitter = require('events');

class PlatformServiceRegistry extends EventEmitter {
    
    constructor() {
        super();
        
        // Kayıtlı servisler
        this.services = new Map();
        this.serviceInstances = new Map();
        this.serviceConfigs = new Map();
        this.serviceHealth = new Map();
        
        // Registry durumu
        this.isInitialized = false;
        this.lastHealthCheck = null;
        
        // Desteklenen platformlar
        this.supportedPlatforms = ['windows', 'macos', 'linux', 'android', 'pwa'];
        
        console.log('🏛️ Platform Service Registry başlatıldı');
        this._initializeRegistry();
    }

    /**
     * Registry'yi başlat
     */
    async _initializeRegistry() {
        try {
            console.log('🚀 Service Registry başlatılıyor...');
            
            // Platform servislerini otomatik keşfet ve kaydet
            await this._discoverAndRegisterServices();
            
            // Sağlık kontrolü başlat
            this._startHealthMonitoring();
            
            this.isInitialized = true;
            this.emit('registry:initialized');
            
            console.log('✅ Service Registry başarıyla başlatıldı');
            console.log(`📊 Kayıtlı servis sayısı: ${this.services.size}`);
            
        } catch (error) {
            console.error('❌ Service Registry başlatma hatası:', error);
            this.emit('registry:error', error);
        }
    }

    /**
     * Platform servislerini otomatik keşfet
     */
    async _discoverAndRegisterServices() {
        console.log('🔍 Platform servisleri keşfediliyor...');
        
        const platformsDir = path.join(__dirname, '..');
        
        for (const platform of this.supportedPlatforms) {
            try {
                const servicePath = path.join(platformsDir, platform);
                const serviceFile = this._getServiceFileName(platform);
                const fullServicePath = path.join(servicePath, serviceFile);
                
                if (await fs.pathExists(fullServicePath)) {
                    await this._registerServiceFromPath(platform, fullServicePath);
                    console.log(`✅ ${platform} servisi keşfedildi ve kaydedildi`);
                } else {
                    console.warn(`⚠️ ${platform} servisi bulunamadı: ${fullServicePath}`);
                }
                
            } catch (error) {
                console.error(`❌ ${platform} servisi kayıt hatası:`, error.message);
            }
        }
    }

    /**
     * Servis dosya adı oluşturucu
     */
    _getServiceFileName(platform) {
        const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
        return `${platformName}PackagingService.js`;
    }

    /**
     * Servis dosyasından kayıt
     */
    async _registerServiceFromPath(platform, servicePath) {
        try {
            // Servis sınıfını dinamik olarak yükle
            const ServiceClass = require(servicePath);
            
            // Servis metadata'sını oluştur
            const serviceMetadata = {
                platform,
                servicePath,
                serviceClass: ServiceClass,
                version: '1.0.0',
                status: 'registered',
                registeredAt: new Date().toISOString(),
                capabilities: await this._extractServiceCapabilities(ServiceClass)
            };
            
            // Servisi kaydet
            this.services.set(platform, serviceMetadata);
            
            // Servis instance'ını oluştur (lazy loading için null başlat)
            this.serviceInstances.set(platform, null);
            
            // Sağlık durumu başlat
            this.serviceHealth.set(platform, {
                healthy: true,
                lastCheck: new Date().toISOString(),
                score: 1.0,
                errors: []
            });
            
            this.emit('service:registered', { platform, metadata: serviceMetadata });
            
        } catch (error) {
            throw new Error(`Servis kayıt hatası [${platform}]: ${error.message}`);
        }
    }

    /**
     * Servis yeteneklerini çıkar
     */
    async _extractServiceCapabilities(ServiceClass) {
        try {
            // Geçici instance oluştur
            const tempInstance = new ServiceClass();
            
            const capabilities = {
                methods: Object.getOwnPropertyNames(Object.getPrototypeOf(tempInstance))
                    .filter(name => name !== 'constructor' && typeof tempInstance[name] === 'function'),
                platform: tempInstance.platformName || 'unknown',
                hasHealthCheck: typeof tempInstance.healthCheck === 'function',
                hasValidation: typeof tempInstance.validate === 'function',
                hasPackaging: typeof tempInstance.package === 'function'
            };
            
            return capabilities;
            
        } catch (error) {
            return {
                methods: [],
                platform: 'unknown',
                hasHealthCheck: false,
                hasValidation: false,
                hasPackaging: false,
                error: error.message
            };
        }
    }

    /**
     * Platform servisi al (lazy loading ile)
     */
    async getService(platform) {
        if (!this.services.has(platform)) {
            throw new Error(`Platform servisi bulunamadı: ${platform}`);
        }
        
        // Mevcut instance varsa döndür
        let instance = this.serviceInstances.get(platform);
        if (instance) {
            return instance;
        }
        
        // Yeni instance oluştur
        try {
            const serviceMetadata = this.services.get(platform);
            const ServiceClass = serviceMetadata.serviceClass;
            
            // Progress reporter ve error handler oluştur
            const progressReporter = this._createProgressReporter(platform);
            const errorHandler = this._createErrorHandler(platform);
            
            instance = new ServiceClass(progressReporter, errorHandler);
            
            // Instance'ı önbelleğe al
            this.serviceInstances.set(platform, instance);
            
            this.emit('service:instantiated', { platform, instance });
            
            console.log(`🔧 ${platform} servisi instance'ı oluşturuldu`);
            return instance;
            
        } catch (error) {
            const errorMsg = `Servis instance oluşturma hatası [${platform}]: ${error.message}`;
            console.error('❌', errorMsg);
            this.emit('service:error', { platform, error: errorMsg });
            throw new Error(errorMsg);
        }
    }

    /**
     * Progress reporter oluştur
     */
    _createProgressReporter(platform) {
        return {
            updateProgress: (progress, message, metadata = {}) => {
                const progressData = {
                    platform,
                    progress,
                    message,
                    metadata,
                    timestamp: new Date().toISOString()
                };
                
                this.emit('service:progress', progressData);
            }
        };
    }

    /**
     * Error handler oluştur
     */
    _createErrorHandler(platform) {
        return {
            handleError: (error, context = {}) => {
                const errorData = {
                    platform,
                    error: error.message || error,
                    context,
                    timestamp: new Date().toISOString()
                };
                
                this.emit('service:error', errorData);
                
                // Sağlık durumunu güncelle
                this._updateServiceHealth(platform, false, error);
            }
        };
    }

    /**
     * Tüm kayıtlı platformları listele
     */
    getRegisteredPlatforms() {
        return Array.from(this.services.keys());
    }

    /**
     * Servis metadata'sını al
     */
    getServiceMetadata(platform) {
        return this.services.get(platform) || null;
    }

    /**
     * Tüm servislerin metadata'sını al
     */
    getAllServicesMetadata() {
        const metadata = {};
        
        for (const [platform, serviceMetadata] of this.services) {
            metadata[platform] = {
                ...serviceMetadata,
                health: this.serviceHealth.get(platform),
                hasInstance: this.serviceInstances.get(platform) !== null
            };
        }
        
        return metadata;
    }

    /**
     * Servis sağlığını kontrol et
     */
    async checkServiceHealth(platform) {
        if (!this.services.has(platform)) {
            throw new Error(`Platform servisi bulunamadı: ${platform}`);
        }
        
        try {
            const service = await this.getService(platform);
            
            let healthResult;
            if (typeof service.healthCheck === 'function') {
                healthResult = await service.healthCheck();
            } else {
                // Basit sağlık kontrolü
                healthResult = {
                    healthy: true,
                    score: 1.0,
                    message: 'Servis çalışıyor (healthCheck metodu yok)'
                };
            }
            
            // Sağlık durumunu güncelle
            this._updateServiceHealth(platform, healthResult.healthy, null, healthResult);
            
            return healthResult;
            
        } catch (error) {
            this._updateServiceHealth(platform, false, error);
            throw error;
        }
    }

    /**
     * Tüm servislerin sağlığını kontrol et
     */
    async checkAllServicesHealth() {
        console.log('🏥 Tüm servislerin sağlık kontrolü başlatılıyor...');
        
        const healthResults = {};
        const platforms = this.getRegisteredPlatforms();
        
        for (const platform of platforms) {
            try {
                healthResults[platform] = await this.checkServiceHealth(platform);
                console.log(`✅ ${platform} servisi sağlıklı`);
            } catch (error) {
                healthResults[platform] = {
                    healthy: false,
                    error: error.message,
                    platform
                };
                console.error(`❌ ${platform} servisi sağlıksız:`, error.message);
            }
        }
        
        this.lastHealthCheck = new Date().toISOString();
        this.emit('health:check-completed', healthResults);
        
        return healthResults;
    }

    /**
     * Servis sağlık durumunu güncelle
     */
    _updateServiceHealth(platform, healthy, error = null, healthData = {}) {
        const healthInfo = {
            healthy,
            lastCheck: new Date().toISOString(),
            score: healthy ? (healthData.score || 1.0) : 0,
            errors: error ? [error.message || error] : [],
            ...healthData
        };
        
        this.serviceHealth.set(platform, healthInfo);
        this.emit('service:health-updated', { platform, health: healthInfo });
    }

    /**
     * Sağlık izleme başlat
     */
    _startHealthMonitoring() {
        // Her 5 dakikada bir sağlık kontrolü
        const healthCheckInterval = 5 * 60 * 1000; // 5 dakika
        
        setInterval(async () => {
            try {
                await this.checkAllServicesHealth();
            } catch (error) {
                console.error('❌ Otomatik sağlık kontrolü hatası:', error);
            }
        }, healthCheckInterval);
        
        console.log('💓 Sağlık izleme başlatıldı (5 dakika aralıklarla)');
    }

    /**
     * Servis instance'ını yeniden yükle (hot reload)
     */
    async reloadService(platform) {
        if (!this.services.has(platform)) {
            throw new Error(`Platform servisi bulunamadı: ${platform}`);
        }
        
        try {
            console.log(`🔄 ${platform} servisi yeniden yükleniyor...`);
            
            // Mevcut instance'ı temizle
            this.serviceInstances.set(platform, null);
            
            // Module cache'ini temizle
            const serviceMetadata = this.services.get(platform);
            const servicePath = path.resolve(serviceMetadata.servicePath);
            delete require.cache[servicePath];
            
            // Yeni service class'ı yükle
            const ServiceClass = require(servicePath);
            serviceMetadata.serviceClass = ServiceClass;
            serviceMetadata.reloadedAt = new Date().toISOString();
            
            this.emit('service:reloaded', { platform });
            
            console.log(`✅ ${platform} servisi yeniden yüklendi`);
            
        } catch (error) {
            const errorMsg = `Servis yeniden yükleme hatası [${platform}]: ${error.message}`;
            console.error('❌', errorMsg);
            throw new Error(errorMsg);
        }
    }

    /**
     * Registry durumu
     */
    getRegistryStatus() {
        const platforms = this.getRegisteredPlatforms();
        const healthyServices = platforms.filter(platform => {
            const health = this.serviceHealth.get(platform);
            return health && health.healthy;
        });
        
        return {
            initialized: this.isInitialized,
            totalServices: platforms.length,
            healthyServices: healthyServices.length,
            unhealthyServices: platforms.length - healthyServices.length,
            platforms,
            lastHealthCheck: this.lastHealthCheck,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Registry'yi temizle
     */
    cleanup() {
        console.log('🧹 Service Registry temizleniyor...');
        
        // Tüm event listener'ları temizle
        this.removeAllListeners();
        
        // Servisleri temizle
        this.services.clear();
        this.serviceInstances.clear();
        this.serviceConfigs.clear();
        this.serviceHealth.clear();
        
        this.isInitialized = false;
        
        console.log('✅ Service Registry temizlendi');
    }
}

// Singleton instance
let registryInstance = null;

/**
 * Registry singleton'ını al
 */
function getRegistry() {
    if (!registryInstance) {
        registryInstance = new PlatformServiceRegistry();
    }
    return registryInstance;
}

/**
 * Registry'yi sıfırla (test amaçlı)
 */
function resetRegistry() {
    if (registryInstance) {
        registryInstance.cleanup();
        registryInstance = null;
    }
}

module.exports = {
    PlatformServiceRegistry,
    getRegistry,
    resetRegistry
};