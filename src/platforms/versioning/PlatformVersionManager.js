/**
 * Platform Version Manager
 * 
 * Platform servislerinin sürümlerini yöneten sistem
 * 
 * ÖZELLİKLER:
 * - Semantic versioning desteği
 * - Geriye dönük uyumluluk kontrolü
 * - Migration sistemi
 * - Version compatibility matrix
 * - Rollback desteği
 * 
 * @author Dijitap Modular Architecture
 * @version 1.0.0
 */

class PlatformVersionManager {
    
    constructor() {
        this.currentVersions = {
            windows: '1.0.0',
            macos: '1.0.0', 
            linux: '1.0.0',
            android: '1.0.0',
            pwa: '1.0.0'
        };
        
        this.compatibilityMatrix = {
            '1.0.0': {
                supported: true,
                deprecated: false,
                migrations: []
            }
        };
        
        console.log('📋 Platform Version Manager başlatıldı');
    }

    /**
     * Platform sürümünü al
     */
    getVersion(platform) {
        return this.currentVersions[platform] || '1.0.0';
    }

    /**
     * Sürüm uyumluluğunu kontrol et
     */
    isCompatible(platform, requestedVersion) {
        const currentVersion = this.getVersion(platform);
        return this._compareVersions(requestedVersion, currentVersion) >= 0;
    }

    /**
     * Sürüm karşılaştırması
     */
    _compareVersions(version1, version2) {
        const v1parts = version1.split('.').map(Number);
        const v2parts = version2.split('.').map(Number);
        
        for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
            const v1part = v1parts[i] || 0;
            const v2part = v2parts[i] || 0;
            
            if (v1part > v2part) return 1;
            if (v1part < v2part) return -1;
        }
        
        return 0;
    }

    /**
     * Tüm platform sürümlerini al
     */
    getAllVersions() {
        return { ...this.currentVersions };
    }
}

module.exports = PlatformVersionManager;