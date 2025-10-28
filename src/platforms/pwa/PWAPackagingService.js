/**
 * PWA Platform Packaging Service
 * 
 * İzole edilmiş PWA paketleme servisi - diğer platformlardan bağımsız çalışır
 * 
 * ÖZELLİKLER:
 * - Progressive Web App (PWA) oluşturma
 * - Service Worker entegrasyonu
 * - Web App Manifest oluşturma
 * - Offline çalışma desteği ve icon optimizasyonu
 * - ZIP paketleme (web deploy için)
 * 
 * @author Dijitap Modular Architecture
 * @version 1.0.0
 */

const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const archiver = require('archiver');

const BasePackagingService = require('../common/BasePackagingService');
const IPlatformPackager = require('../interfaces/IPlatformPackager');

class PWAPackagingService extends BasePackagingService {
    
    constructor(progressReporter = null, errorHandler = null) {
        super('pwa', progressReporter, errorHandler);
        
        this.outputFormat = 'zip';
        this.manifestFileName = 'manifest.json';
        this.serviceWorkerFileName = 'sw.js';
        this.iconSizes = [72, 96, 128, 144, 152, 192, 384, 512];
        
        console.log('✅ PWA Packaging Service başlatıldı');
    }

    /**
     * Platforma özgü validasyon
     */
    async validate(request) {
        console.log('🔍 PWA validasyonu başlatılıyor...');
        
        try {
            const errors = [];
            const warnings = [];
            
            const baseValidation = await super.validate(request);
            if (!baseValidation.valid) {
                errors.push(...baseValidation.errors);
                warnings.push(...baseValidation.warnings);
            }

            await this._validatePWARequirements(request, errors, warnings);

            const isValid = errors.length === 0;
            
            return {
                valid: isValid,
                errors,
                warnings,
                platform: 'pwa',
                metadata: {
                    outputFormat: this.outputFormat,
                    iconSizes: this.iconSizes
                }
            };
            
        } catch (error) {
            return {
                valid: false,
                errors: [`PWA validasyon hatası: ${error.message}`],
                warnings: [],
                platform: 'pwa'
            };
        }
    }

    /**
     * PWA gereksinim validasyonu
     */
    async _validatePWARequirements(request, errors, warnings) {
        const { workingPath, appName } = request;
        
        // index.html kontrolü
        const indexPath = path.join(workingPath, 'index.html');
        if (!await fs.pathExists(indexPath)) {
            errors.push('index.html dosyası bulunamadı - PWA için gerekli');
        } else {
            const htmlContent = await fs.readFile(indexPath, 'utf8');
            if (!htmlContent.includes('<meta name="viewport"')) {
                warnings.push('Viewport meta tag eksik - responsive design için gerekli');
            }
        }
        
        if (appName.length > 45) {
            warnings.push('Uygulama adı çok uzun, PWA home screen\'de kısaltılabilir');
        }
        
        console.log('📋 PWA gereksinim kontrolü tamamlandı');
    }

    /**
     * PWA paketleme ana işlemi
     */
    async package(request) {
        return this.safeExecute(async () => {
            console.log('🌐 PWA paketleme başlatılıyor...');
            
            const validation = await this.validate(request);
            if (!validation.valid) {
                throw new Error(`Validasyon hatası: ${validation.errors.join(', ')}`);
            }

            const { workingPath, tempPath, appName, appVersion, logoPath, options = {} } = request;
            
            const pwaPath = path.join(tempPath, 'pwa');
            await fs.ensureDir(pwaPath);

            this.updateProgress(10, 'PWA dosyaları kopyalanıyor...');
            await fs.copy(workingPath, pwaPath);

            this.updateProgress(25, 'PWA manifest oluşturuluyor...');
            await this._generateWebAppManifest(pwaPath, appName, appVersion, options);

            this.updateProgress(40, 'Service Worker oluşturuluyor...');
            await this._generateServiceWorker(pwaPath, appName, appVersion);

            this.updateProgress(55, 'PWA icon\'ları hazırlanıyor...');
            await this._generatePWAIcons(pwaPath, logoPath, appName);

            this.updateProgress(70, 'PWA özellikleri ekleniyor...');
            await this._addPWAFeatures(pwaPath, appName);

            this.updateProgress(90, 'PWA paketleniyor...');
            const zipResult = await this._createPWAZip(pwaPath, tempPath, appName, appVersion);

            this.updateProgress(100, 'PWA oluşturuldu!');

            console.log('✅ PWA paketleme başarıyla tamamlandı');

            return {
                platform: 'pwa',
                ...zipResult,
                metadata: {
                    iconSizes: this.iconSizes,
                    buildTime: new Date().toISOString()
                }
            };
            
        }, { operation: 'pwa_packaging', request });
    }

    /**
     * Web App Manifest oluştur
     */
    async _generateWebAppManifest(pwaPath, appName, appVersion, options) {
        const manifest = {
            name: appName,
            short_name: appName.length > 12 ? appName.substring(0, 12) : appName,
            version: appVersion,
            description: options.description || `${appName} - Progressive Web App`,
            start_url: "./index.html",
            display: "fullscreen",
            orientation: "landscape",
            theme_color: options.themeColor || "#667eea",
            background_color: options.backgroundColor || "#ffffff",
            icons: this.iconSizes.map(size => ({
                src: `icons/icon-${size}x${size}.png`,
                sizes: `${size}x${size}`,
                type: "image/png",
                purpose: size >= 192 ? "any maskable" : "any"
            }))
        };
        
        await fs.writeJson(path.join(pwaPath, this.manifestFileName), manifest, { spaces: 2 });
        console.log('✅ Web App Manifest oluşturuldu');
    }

    /**
     * Service Worker oluştur
     */
    async _generateServiceWorker(pwaPath, appName, appVersion) {
        const serviceWorker = `// ${appName} Service Worker v${appVersion}
const CACHE_NAME = '${appName.toLowerCase().replace(/\s+/g, '-')}-v${appVersion}';
const urlsToCache = ['./', './index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});`;
        
        await fs.writeFile(path.join(pwaPath, this.serviceWorkerFileName), serviceWorker);
        console.log('✅ Service Worker oluşturuldu');
    }

    /**
     * PWA icon\'larını oluştur
     */
    async _generatePWAIcons(pwaPath, logoPath, appName) {
        console.log('🖼️ PWA icon\'ları oluşturuluyor...');
        
        try {
            const iconsDir = path.join(pwaPath, 'icons');
            await fs.ensureDir(iconsDir);
            
            let sourceLogo = logoPath;
            if (!sourceLogo || !await fs.pathExists(sourceLogo)) {
                sourceLogo = path.join(iconsDir, 'source-logo.png');
                await this._createDefaultLogo(sourceLogo);
            }
            
            for (const size of this.iconSizes) {
                const iconPath = path.join(iconsDir, `icon-${size}x${size}.png`);
                
                await sharp(sourceLogo)
                    .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
                    .png()
                    .toFile(iconPath);
            }
            
            console.log('✅ PWA icon\'ları oluşturuldu');
            
        } catch (error) {
            console.warn('⚠️ PWA icon oluşturma hatası:', error.message);
        }
    }

    /**
     * Varsayılan logo oluştur
     */
    async _createDefaultLogo(logoPath) {
        await sharp({
            create: { width: 512, height: 512, channels: 4, background: { r: 102, g: 126, b: 234, alpha: 1 } }
        }).png().toFile(logoPath);
    }

    /**
     * PWA özelliklerini ekle
     */
    async _addPWAFeatures(pwaPath, appName) {
        try {
            const indexPath = path.join(pwaPath, 'index.html');
            
            if (await fs.pathExists(indexPath)) {
                let htmlContent = await fs.readFile(indexPath, 'utf8');
                
                const pwaMetaTags = `<meta name="application-name" content="${appName}">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="manifest" href="./manifest.json">`;
                
                const pwaScript = `<script>
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}
</script>`;
                
                if (htmlContent.includes('</head>')) {
                    htmlContent = htmlContent.replace('</head>', pwaMetaTags + '\n</head>');
                }
                if (htmlContent.includes('</body>')) {
                    htmlContent = htmlContent.replace('</body>', pwaScript + '\n</body>');
                }
                
                await fs.writeFile(indexPath, htmlContent);
                console.log('✅ PWA özellikleri eklendi');
            }
        } catch (error) {
            console.warn('⚠️ PWA özellikleri eklenirken hata:', error.message);
        }
    }

    /**
     * PWA ZIP paketi oluştur
     */
    async _createPWAZip(pwaPath, tempPath, appName, appVersion) {
        const zipPath = path.join(tempPath, `${appName}-pwa-v${appVersion}.zip`);
        
        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', async () => {
                const stats = await fs.stat(zipPath);
                
                resolve({
                    filename: path.basename(zipPath),
                    path: zipPath,
                    size: stats.size,
                    type: 'zip',
                    message: `PWA başarıyla oluşturuldu! (${(stats.size / 1024 / 1024).toFixed(1)} MB)`
                });
            });

            archive.on('error', reject);
            archive.pipe(output);
            archive.directory(pwaPath, false);
            archive.finalize();
        });
    }

    /**
     * Platform sağlık kontrolü
     */
    async healthCheck() {
        try {
            const checks = { archiver: true, sharp: true, fileSystem: true };
            
            try {
                require('archiver');
                const sharp = require('sharp');
                await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } }).png().toBuffer();
            } catch (error) {
                checks.archiver = false;
                checks.sharp = false;
            }
            
            const healthScore = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
            
            return {
                healthy: healthScore >= 0.66,
                score: healthScore,
                checks,
                platform: 'pwa',
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            return {
                healthy: false,
                score: 0,
                error: error.message,
                platform: 'pwa',
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = PWAPackagingService;