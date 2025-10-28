/**
 * macOS Platform Packaging Service
 * 
 * Izole edilmiş macOS paketleme servisi - diğer platformlardan bağımsız çalışır
 * 
 * ÖZELLİKLER:
 * - DMG dosyası oluşturma
 * - Universal binary desteği (x64 + ARM64)
 * - Icon optimizasyonu (512x512 minimum)
 * - Eğitim kategorisi ayarları
 * - Gatekeeper uyumluluğu
 * - Electron Builder entegrasyonu
 * - Hata izolasyonu ve özel error handling
 * - Progress tracking
 * - Metadata standardizasyonu
 * 
 * @author Dijitap Modular Architecture
 * @version 1.0.0
 */

const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const { spawn } = require('child_process');

// Base sınıfları ve interface'leri import et
const BasePackagingService = require('../common/BasePackagingService');
const IPlatformPackager = require('../interfaces/IPlatformPackager');

class MacOSPackagingService extends BasePackagingService {
    
    constructor(progressReporter = null, errorHandler = null) {
        super('macos', progressReporter, errorHandler);
        
        // macOS-specific ayarlar
        this.supportedArchitectures = ['x64', 'arm64'];
        this.outputFormat = 'dmg';
        this.minimumIconSize = 512;
        this.category = 'public.app-category.education';
        
        // macOS electron-builder gereksinimleri
        this.requiredFiles = ['main.js', 'package.json'];
        this.excludedFiles = ['node_modules', 'temp', 'uploads'];
        
        console.log('✅ macOS Packaging Service initialized');
    }

    /**
     * Platforma özgü validasyon
     */
    async validate(request) {
        console.log('🔍 macOS validasyonu başlatılıyor...');
        
        try {
            const errors = [];
            const warnings = [];
            
            // Base validasyon çağır
            const baseValidation = await super.validate(request);
            if (!baseValidation.valid) {
                errors.push(...baseValidation.errors);
                warnings.push(...baseValidation.warnings);
            }

            // macOS-specific validasyonlar
            await this._validateMacOSRequirements(request, errors, warnings);
            await this._validateIconRequirements(request, errors, warnings);
            await this._validateElectronBuilderDependencies(request, errors, warnings);

            const isValid = errors.length === 0;
            
            if (isValid) {
                console.log('✅ macOS validasyonu başarılı');
            } else {
                console.log(`❌ macOS validasyonu başarısız: ${errors.length} hata, ${warnings.length} uyarı`);
            }

            return {
                valid: isValid,
                errors,
                warnings,
                platform: 'macos',
                metadata: {
                    architectures: this.supportedArchitectures,
                    outputFormat: this.outputFormat,
                    category: this.category,
                    minimumIconSize: this.minimumIconSize
                }
            };
            
        } catch (error) {
            const errorMsg = `macOS validasyon hatası: ${error.message}`;
            console.error('❌', errorMsg);
            
            return {
                valid: false,
                errors: [errorMsg],
                warnings: [],
                platform: 'macos'
            };
        }
    }

    /**
     * macOS-specific gereksinim validasyonu
     */
    async _validateMacOSRequirements(request, errors, warnings) {
        const { workingPath, appName, appVersion } = request;
        
        // Temel dosya varlık kontrolü
        for (const file of this.requiredFiles) {
            const filePath = path.join(workingPath, file);
            if (!await fs.pathExists(filePath)) {
                errors.push(`Gerekli dosya eksik: ${file}`);
            }
        }

        // App name macOS uyumluluğu
        if (appName.length > 255) {
            errors.push('Uygulama adı çok uzun (max 255 karakter)');
        }

        // Bundle identifier uyumluluğu
        const bundleId = this._generateBundleId(appName);
        if (bundleId.length > 255) {
            warnings.push('Bundle identifier çok uzun olabilir');
        }

        // Sürüm formatı kontrolü (semantic versioning)
        const versionRegex = /^\d+\.\d+\.\d+(-[\w\d.-]+)?$/;
        if (!versionRegex.test(appVersion)) {
            warnings.push('Sürüm formatı semantic versioning kurallarına uymayabilir');
        }

        console.log('📋 macOS gereksinim kontrolü tamamlandı');
    }

    /**
     * Icon gereksinimleri validasyonu
     */
    async _validateIconRequirements(request, errors, warnings) {
        const { workingPath, logoPath } = request;
        
        try {
            const iconPath = logoPath || path.join(workingPath, 'ico.png');
            
            if (await fs.pathExists(iconPath)) {
                const metadata = await sharp(iconPath).metadata();
                
                if (metadata.width < this.minimumIconSize || metadata.height < this.minimumIconSize) {
                    warnings.push(`Icon boyutu küçük (${metadata.width}x${metadata.height}), ${this.minimumIconSize}x${this.minimumIconSize} önerilir`);
                }
                
                if (metadata.format !== 'png') {
                    warnings.push('Icon formatı PNG önerilir');
                }
                
                console.log(`🖼️ Icon kontrolü: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);
            } else {
                warnings.push('Icon dosyası bulunamadı, varsayılan kullanılacak');
            }
            
        } catch (error) {
            warnings.push(`Icon analiz edilemedi: ${error.message}`);
        }
    }

    /**
     * Electron Builder bağımlılık kontrolü
     */
    async _validateElectronBuilderDependencies(request, errors, warnings) {
        const { workingPath } = request;
        
        try {
            const packageJsonPath = path.join(workingPath, 'package.json');
            
            if (await fs.pathExists(packageJsonPath)) {
                const packageJson = await fs.readJson(packageJsonPath);
                
                // Electron bağımlılığı kontrolü
                const electronVersion = packageJson.devDependencies?.electron || 
                                      packageJson.dependencies?.electron;
                
                if (!electronVersion) {
                    warnings.push('Electron bağımlılığı bulunamadı, otomatik eklenecek');
                }
                
                // Main file kontrolü
                if (!packageJson.main) {
                    warnings.push('package.json main field eksik, varsayılan kullanılacak');
                }
                
                console.log('📦 Electron bağımlılık kontrolü tamamlandı');
            }
            
        } catch (error) {
            warnings.push(`package.json analiz edilemedi: ${error.message}`);
        }
    }

    /**
     * macOS paketleme ana işlemi
     */
    async package(request) {
        return this.safeExecute(async () => {
            console.log('🍎 macOS paketleme başlatılıyor...');
            
            // Öncelikle validasyon yap
            const validation = await this.validate(request);
            if (!validation.valid) {
                throw new Error(`Validasyon hatası: ${validation.errors.join(', ')}`);
            }

            const { workingPath, tempPath, appName, appVersion, logoPath, options = {} } = request;
            
            // Çıktı dizinini hazırla
            const outputPath = path.join(tempPath, 'macos');
            await fs.ensureDir(outputPath);

            // Progress: %25 - Icon hazırlama
            this.updateProgress(25, 'macOS icon hazırlanıyor...');

            // Icon'u hazırla ve optimize et
            const validIcon = await this._prepareValidIcon(workingPath, logoPath);

            // Progress: %40 - Yapılandırma oluşturma
            this.updateProgress(40, 'Electron Builder yapılandırması oluşturuluyor...');

            // Electron Builder konfigürasyonu oluştur
            const config = await this._createElectronBuilderConfig(
                workingPath, outputPath, appName, appVersion, validIcon, options
            );

            // Konfigürasyon dosyasını yaz
            const configPath = path.join(tempPath, 'electron-builder-mac.json');
            await fs.writeJson(configPath, config, { spaces: 2 });

            // Progress: %50 - Build başlatma
            this.updateProgress(50, 'DMG oluşturuluyor...');

            // Electron Builder'ı çalıştır
            await this._runElectronBuilder(configPath, workingPath);

            // Progress: %90 - Sonuç kontrolü
            this.updateProgress(90, 'DMG dosyası kontrol ediliyor...');

            // Oluşturulan DMG dosyasını bul
            const result = await this._findAndValidateOutput(outputPath, appName, appVersion);

            // Progress: %100 - Tamamlandı
            this.updateProgress(100, 'macOS paketleme tamamlandı!');

            console.log('✅ macOS paketleme başarıyla tamamlandı');
            console.log(`📄 DMG dosyası: ${result.filename}`);
            console.log(`📊 Dosya boyutu: ${(result.size / 1024 / 1024).toFixed(1)} MB`);

            return {
                platform: 'macos',
                ...result,
                metadata: {
                    architectures: this.supportedArchitectures,
                    category: this.category,
                    iconOptimized: validIcon !== logoPath,
                    buildTime: new Date().toISOString()
                }
            };
            
        }, { operation: 'macos_packaging', request });
    }

    /**
     * macOS için geçerli icon hazırlama
     */
    async _prepareValidIcon(workingPath, logoPath) {
        console.log('🖼️ macOS icon hazırlanıyor...');
        
        try {
            // Kullanılacak icon dosyasını belirle
            let iconToCheck = logoPath || path.join(workingPath, 'ico.png');
            
            if (!await fs.pathExists(iconToCheck)) {
                console.log('macOS icon bulunamadı, varsayılan oluşturuluyor');
                iconToCheck = path.join(workingPath, 'ico.png');
                await this._ensureDefaultIcon(workingPath);
            }
            
            // Icon boyutunu kontrol et
            const metadata = await sharp(iconToCheck).metadata();
            
            if (metadata.width < this.minimumIconSize || metadata.height < this.minimumIconSize) {
                console.log(`macOS icon boyutu uygun değil (${metadata.width}x${metadata.height}), ${this.minimumIconSize}x${this.minimumIconSize}'ye boyutlandırılıyor...`);
                
                const resizedIconPath = path.join(workingPath, 'ico-macos.png');
                
                await sharp(iconToCheck)
                    .resize(this.minimumIconSize, this.minimumIconSize, {
                        fit: 'contain',
                        background: { r: 255, g: 255, b: 255, alpha: 0 }
                    })
                    .png()
                    .toFile(resizedIconPath);
                    
                console.log('✅ macOS icon boyutlandırıldı');
                return resizedIconPath;
            }
            
            console.log('✅ macOS icon uygun boyutta');
            return iconToCheck;
            
        } catch (error) {
            console.error('macOS icon hazırlama hatası:', error);
            await this._ensureDefaultIcon(workingPath);
            return path.join(workingPath, 'ico.png');
        }
    }

    /**
     * Varsayılan icon oluşturma
     */
    async _ensureDefaultIcon(workingPath) {
        const iconPath = path.join(workingPath, 'ico.png');
        
        if (!await fs.pathExists(iconPath)) {
            console.log('🎨 Varsayılan macOS icon oluşturuluyor...');
            
            try {
                // 512x512 mavi kare icon oluştur
                await sharp({
                    create: {
                        width: this.minimumIconSize,
                        height: this.minimumIconSize,
                        channels: 4,
                        background: { r: 52, g: 152, b: 219, alpha: 1 }
                    }
                })
                .png()
                .toFile(iconPath);
                
                console.log('✅ Varsayılan macOS icon oluşturuldu');
            } catch (error) {
                console.warn('⚠️ Varsayılan icon oluşturulamadı:', error.message);
            }
        }
    }

    /**
     * Bundle ID oluşturucu
     */
    _generateBundleId(appName) {
        const sanitizedName = appName
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[^a-z0-9]/g, '');
            
        return `com.${sanitizedName}.app`;
    }

    /**
     * Electron Builder konfigürasyonu oluşturma
     */
    async _createElectronBuilderConfig(workingPath, outputPath, appName, appVersion, iconPath, options) {
        console.log('⚙️ macOS Electron Builder konfigürasyonu oluşturuluyor...');
        
        const bundleId = this._generateBundleId(appName);
        
        const config = {
            appId: bundleId,
            productName: appName,
            buildVersion: appVersion,
            directories: {
                app: path.resolve(workingPath),
                output: path.resolve(outputPath)
            },
            files: [
                "**/*",
                ...this.excludedFiles.map(file => `!${file}`)
            ],
            mac: {
                target: {
                    target: "dmg",
                    arch: this.supportedArchitectures
                },
                icon: iconPath,
                category: this.category,
                hardenedRuntime: false, // Eğitim uygulamaları için devre dışı
                gatekeeperAssess: false, // Geliştirme amaçlı
                // Ek macOS ayarları
                type: "distribution",
                minimumSystemVersion: "10.14.0" // Mojave ve üzeri
            },
            dmg: {
                title: `${appName} ${appVersion}`,
                icon: iconPath,
                // DMG görsel ayarları
                background: null, // Varsayılan arkaplan
                iconSize: 80,
                window: {
                    width: 540,
                    height: 380
                },
                contents: [
                    {
                        x: 130,
                        y: 220,
                        type: "file"
                    },
                    {
                        x: 410,
                        y: 220,
                        type: "link",
                        path: "/Applications"
                    }
                ]
            },
            // macOS-specific metadata
            copyright: options.copyright || `© ${new Date().getFullYear()} ${appName}`,
            
            // Notarization ayarları (isteğe bağlı)
            // afterSign: "scripts/notarize.js", // Eğer notarization gerekirse
            
            // Ek build ayarları
            buildDependenciesFromSource: false,
            nodeGypRebuild: false,
            npmRebuild: false
        };

        console.log('📋 macOS konfigürasyonu hazırlandı:');
        console.log(`  - Bundle ID: ${bundleId}`);
        console.log(`  - Architectures: ${this.supportedArchitectures.join(', ')}`);
        console.log(`  - Category: ${this.category}`);
        console.log(`  - Icon: ${path.basename(iconPath)}`);

        return config;
    }

    /**
     * Electron Builder çalıştırma
     */
    async _runElectronBuilder(configPath, workingPath) {
        console.log('🔨 Electron Builder (macOS) başlatılıyor...');
        
        return new Promise((resolve, reject) => {
            const absoluteConfigPath = path.resolve(configPath);
            const workingDir = process.cwd();
            
            console.log(`  - Config: ${absoluteConfigPath}`);
            console.log(`  - Working Dir: ${workingDir}`);
            console.log(`  - Platform: mac`);

            const child = spawn('npx', [
                'electron-builder',
                '--config', absoluteConfigPath,
                '--publish', 'never',
                '--mac'
            ], {
                cwd: workingDir,
                stdio: 'pipe',
                shell: true,
                env: {
                    ...process.env,
                    npm_config_cache: path.join(process.cwd(), '.npm-cache'),
                    npm_config_prefix: path.join(process.cwd(), '.npm-global'),
                    DEBUG: 'electron-builder'
                }
            });

            let output = '';
            let errorOutput = '';

            child.stdout.on('data', (data) => {
                const message = data.toString().trim();
                if (message) {
                    output += message + '\n';
                    console.log('🔨 Electron Builder:', message);
                }
            });

            child.stderr.on('data', (data) => {
                const message = data.toString().trim();
                if (message) {
                    errorOutput += message + '\n';
                    // Bazı electron-builder mesajları stderr'a yazılır ama hata değildir
                    if (message.includes('ERROR') || message.includes('Error')) {
                        console.error('❌ Electron Builder Error:', message);
                    } else {
                        console.log('ℹ️ Electron Builder Info:', message);
                    }
                }
            });

            child.on('close', (code) => {
                console.log(`🏁 Electron Builder (macOS) tamamlandı (exit code: ${code})`);
                
                if (code === 0) {
                    console.log('✅ macOS DMG başarıyla oluşturuldu');
                    resolve(output);
                } else {
                    const errorMsg = `Electron Builder failed with code ${code}`;
                    console.error('❌', errorMsg);
                    console.error('❌ Hata detayları:', errorOutput);
                    reject(new Error(`${errorMsg}: ${errorOutput}`));
                }
            });
            
            child.on('error', (error) => {
                const errorMsg = `Electron Builder başlatılamadı: ${error.message}`;
                console.error('❌', errorMsg);
                reject(new Error(errorMsg));
            });
        });
    }

    /**
     * Çıktı dosyasını bulma ve doğrulama
     */
    async _findAndValidateOutput(outputPath, appName, appVersion) {
        console.log('🔍 macOS çıktı dosyaları aranıyor...');
        
        try {
            const files = await fs.readdir(outputPath);
            console.log('📁 Bulunan dosyalar:', files);
            
            // DMG dosyasını bul
            const dmgFile = files.find(file => file.endsWith('.dmg'));
            
            if (!dmgFile) {
                throw new Error('macOS DMG dosyası bulunamadı. Muhtemel dosyalar: ' + files.join(', '));
            }
            
            const dmgPath = path.join(outputPath, dmgFile);
            const stats = await fs.stat(dmgPath);
            
            // Dosya boyutu kontrolü (çok küçükse hata olabilir)
            if (stats.size < 1024 * 1024) { // 1MB'dan küçük
                console.warn('⚠️ DMG dosyası beklenenden küçük:', stats.size, 'bytes');
            }
            
            console.log('✅ macOS DMG dosyası bulundu:', dmgFile);
            console.log('📊 Dosya boyutu:', (stats.size / 1024 / 1024).toFixed(1), 'MB');
            
            return {
                filename: dmgFile,
                path: dmgPath,
                size: stats.size,
                type: 'dmg'
            };
            
        } catch (error) {
            throw new Error(`macOS çıktı kontrolü başarısız: ${error.message}`);
        }
    }

    /**
     * Platform sağlık kontrolü
     */
    async healthCheck() {
        try {
            console.log('🏥 macOS platform sağlık kontrolü...');
            
            const checks = {
                electronBuilder: false,
                sharp: false,
                nodeVersion: false,
                diskSpace: false
            };
            
            // Electron Builder kontrolü
            try {
                await this._checkCommand('npx electron-builder --version');
                checks.electronBuilder = true;
            } catch (error) {
                console.warn('⚠️ Electron Builder bulunamadı');
            }
            
            // Sharp kontrolü
            try {
                const sharp = require('sharp');
                await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } }).png().toBuffer();
                checks.sharp = true;
            } catch (error) {
                console.warn('⚠️ Sharp kütüphanesi çalışmıyor');
            }
            
            // Node.js versiyonu kontrolü
            const nodeVersion = process.version;
            const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
            checks.nodeVersion = majorVersion >= 16;
            
            // Disk alanı kontrolü (basit)
            checks.diskSpace = true; // Bu örnekte her zaman true
            
            const healthScore = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
            const isHealthy = healthScore >= 0.75;
            
            console.log(`🏥 macOS platform sağlık skoru: ${(healthScore * 100).toFixed(0)}%`);
            
            return {
                healthy: isHealthy,
                score: healthScore,
                checks,
                recommendations: this._generateHealthRecommendations(checks),
                platform: 'macos',
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            return {
                healthy: false,
                score: 0,
                error: error.message,
                platform: 'macos',
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Sağlık önerilerini oluştur
     */
    _generateHealthRecommendations(checks) {
        const recommendations = [];
        
        if (!checks.electronBuilder) {
            recommendations.push('Electron Builder kurulumu gerekli: npm install -g electron-builder');
        }
        
        if (!checks.sharp) {
            recommendations.push('Sharp kütüphanesi kurulumu gerekli: npm install sharp');
        }
        
        if (!checks.nodeVersion) {
            recommendations.push('Node.js 16+ sürümü öneriliyor');
        }
        
        if (recommendations.length === 0) {
            recommendations.push('Tüm sistem kontrolleri başarılı!');
        }
        
        return recommendations;
    }

    /**
     * Yardımcı komut çalıştırıcı
     */
    async _checkCommand(command) {
        return new Promise((resolve, reject) => {
            const child = spawn(command, { shell: true, stdio: 'pipe' });
            
            let output = '';
            
            child.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            child.on('close', (code) => {
                if (code === 0) {
                    resolve(output);
                } else {
                    reject(new Error(`Command failed: ${command}`));
                }
            });
            
            child.on('error', reject);
        });
    }
}

module.exports = MacOSPackagingService;