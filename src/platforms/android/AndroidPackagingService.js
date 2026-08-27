/**
 * Android Platform Packaging Service
 * 
 * İzole edilmiş Android paketleme servisi - diğer platformlardan bağımsız çalışır
 * 
 * ÖZELLİKLER:
 * - APK dosyası oluşturma (Capacitor tabanlı)
 * - Web uygulamasını Android native'e dönüştürme
 * - Custom icon desteği ve fullscreen mobil deneyim
 * - Gradle build sistem entegrasyonu
 * - Hata izolasyonu ve progress tracking
 * - SADECE APK üretimi (proje dosyaları verilmez)
 * 
 * @author Dijitap Modular Architecture
 * @version 1.0.0
 */

const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const { spawn } = require('child_process');

const BasePackagingService = require('../common/BasePackagingService');
const IPlatformPackager = require('../interfaces/IPlatformPackager');

class AndroidPackagingService extends BasePackagingService {
    
    constructor(progressReporter = null, errorHandler = null) {
        super('android', progressReporter, errorHandler);
        
        // Android-specific ayarlar
        this.outputFormat = 'apk';
        this.packageSystem = 'capacitor';
        this.minSdkVersion = 22;
        this.targetSdkVersion = 33;
        this.capacitorVersion = '^6.0.0';
        
        console.log('✅ Android Packaging Service başlatıldı');
    }

    /**
     * Platforma özgü validasyon
     */
    async validate(request) {
        console.log('🔍 Android validasyonu başlatılıyor...');
        
        try {
            const errors = [];
            const warnings = [];
            
            // Base validasyon
            const baseValidation = await super.validate(request);
            if (!baseValidation.valid) {
                errors.push(...baseValidation.errors);
                warnings.push(...baseValidation.warnings);
            }

            // Android-specific validasyonlar
            await this._validateAndroidRequirements(request, errors, warnings);

            const isValid = errors.length === 0;
            
            return {
                valid: isValid,
                errors,
                warnings,
                platform: 'android',
                metadata: {
                    packageSystem: this.packageSystem,
                    outputFormat: this.outputFormat,
                    minSdkVersion: this.minSdkVersion
                }
            };
            
        } catch (error) {
            return {
                valid: false,
                errors: [`Android validasyon hatası: ${error.message}`],
                warnings: [],
                platform: 'android'
            };
        }
    }

    /**
     * Android gereksinim validasyonu
     */
    async _validateAndroidRequirements(request, errors, warnings) {
        const { workingPath, appName } = request;
        
        // index.html kontrolü
        const indexPath = path.join(workingPath, 'index.html');
        if (!await fs.pathExists(indexPath)) {
            errors.push('index.html dosyası bulunamadı - Android APK için gerekli');
        }
        
        // App name uzunluğu
        if (appName.length > 30) {
            warnings.push('Uygulama adı çok uzun, Android\'de kısaltılabilir');
        }
        
        // Java kontrolü
        try {
            await this._checkCommand('java -version');
        } catch (error) {
            errors.push('Java Runtime Environment gerekli (JRE 8+)');
        }
        
        console.log('📋 Android gereksinim kontrolü tamamlandı');
    }

    /**
     * Android paketleme ana işlemi
     */
    async package(request) {
        return this.safeExecute(async () => {
            console.log('📱 Android APK paketleme başlatılıyor...');
            
            // Validasyon
            const validation = await this.validate(request);
            if (!validation.valid) {
                throw new Error(`Validasyon hatası: ${validation.errors.join(', ')}`);
            }

            const { workingPath, tempPath, appName, appVersion, logoPath } = request;
            
            // Android dizini hazırla
            const androidPath = path.join(tempPath, 'android');
            const webAppPath = path.join(androidPath, 'webapp');
            await fs.ensureDir(androidPath);

            // Progress güncellemeleri ile build işlemi
            this.updateProgress(10, 'Android projesi hazırlanıyor...');
            await fs.copy(workingPath, webAppPath);

            this.updateProgress(30, 'Capacitor dosyaları oluşturuluyor...');
            await this._generateAndroidFiles(webAppPath, appName, appVersion, logoPath);

            this.updateProgress(50, 'Capacitor kurulumu kontrol ediliyor...');
            await this._ensureCapacitorInstallation();

            this.updateProgress(60, 'Capacitor projesi hazırlanıyor...');
            await this._initializeCapacitorProject(webAppPath, appName, appVersion, logoPath, workingPath);

            this.updateProgress(80, 'APK oluşturuluyor...');
            const apkResult = await this._buildAPKWithCapacitor(webAppPath, appName, appVersion, androidPath);

            this.updateProgress(100, 'Android APK oluşturuldu!');

            console.log('✅ Android APK paketleme başarıyla tamamlandı');
            console.log(`📱 APK dosyası: ${apkResult.filename}`);

            return {
                platform: 'android',
                ...apkResult,
                metadata: {
                    packageSystem: this.packageSystem,
                    buildTime: new Date().toISOString()
                }
            };
            
        }, { operation: 'android_packaging', request });
    }

    /**
     * Package ID oluşturucu
     */
    _generatePackageId(appName) {
        const sanitizedName = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
        return `com.dijitap.${sanitizedName}`;
    }

    /**
     * Android dosyalarını oluştur
     */
    async _generateAndroidFiles(webAppPath, appName, appVersion, logoPath) {
        console.log('📄 Android dosyaları oluşturuluyor...');
        
        // package.json
        const packageJson = {
            name: appName.toLowerCase().replace(/\s+/g, '-'),
            version: appVersion,
            description: `${appName} - Capacitor Android Uygulaması`,
            main: "index.html",
            dependencies: {
                "@capacitor/core": this.capacitorVersion,
                "@capacitor/android": this.capacitorVersion
            },
            devDependencies: {
                "@capacitor/cli": this.capacitorVersion
            }
        };
        
        await fs.writeJson(path.join(webAppPath, 'package.json'), packageJson, { spaces: 2 });
        
        // Capacitor config
        const packageId = this._generatePackageId(appName);
        const capacitorConfig = `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: '${packageId}',
  appName: '${appName}',
  webDir: 'www',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: true },
  plugins: { CapacitorHttp: { enabled: true } } // yayıncı API CORS vermiyor (2026-08-27)
};

export default config;`;
        
        await fs.writeFile(path.join(webAppPath, 'capacitor.config.ts'), capacitorConfig);
        console.log('✅ Capacitor Android dosyaları oluşturuldu');
    }

    /**
     * Capacitor kurulumunu kontrol et ve kur
     */
    async _ensureCapacitorInstallation() {
        try {
            await this._checkCommand('npx @capacitor/cli --version');
            console.log('✅ Capacitor zaten kurulu');
        } catch (error) {
            console.log('📦 Capacitor kuruluyor...');
            await this._runCommand('npm', ['install', '@capacitor/core', '@capacitor/cli', '@capacitor/android'], { shell: true });
            console.log('✅ Capacitor kuruldu');
        }
    }

    /**
     * Capacitor projesini başlat
     */
    async _initializeCapacitorProject(webAppPath, appName, appVersion, logoPath, workingPath) {
        console.log('🚀 Capacitor projesi başlatılıyor...');
        
        // www dizinini hazırla
        const wwwPath = path.join(webAppPath, 'www');
        await fs.ensureDir(wwwPath);
        
        // Web dosyalarını www'ye kopyala
        await fs.copy(workingPath, wwwPath);
        
        // Android fullscreen desteği ekle
        await this._enableAndroidFullscreen(wwwPath);
        
        // Icon hazırla
        if (logoPath) {
            await fs.copy(logoPath, path.join(webAppPath, 'icon.png'));
            await fs.copy(logoPath, path.join(wwwPath, 'icon.png'));
        }
        
        // Capacitor init ve android platform ekle
        await this._runCapacitorCommand('init', [appName, this._generatePackageId(appName)], webAppPath);
        await this._runCapacitorCommand('add', ['android'], webAppPath);
        
        console.log('✅ Capacitor projesi hazırlandı');
    }

    /**
     * Android fullscreen desteği
     */
    async _enableAndroidFullscreen(wwwPath) {
        try {
            const indexPath = path.join(wwwPath, 'index.html');
            
            if (await fs.pathExists(indexPath)) {
                let htmlContent = await fs.readFile(indexPath, 'utf8');
                
                const fullscreenCSS = `<style>
body, html { margin: 0; padding: 0; width: 100vw; height: 100vh; overflow: hidden; }
</style>`;
                
                const fullscreenJS = `<script>
document.addEventListener('deviceready', function() {
    if (window.StatusBar) StatusBar.hide();
    document.addEventListener('contextmenu', e => e.preventDefault());
}, false);
</script>`;
                
                if (htmlContent.includes('</head>')) {
                    htmlContent = htmlContent.replace('</head>', fullscreenCSS + '\n</head>');
                }
                if (htmlContent.includes('</body>')) {
                    htmlContent = htmlContent.replace('</body>', fullscreenJS + '\n</body>');
                }
                
                await fs.writeFile(indexPath, htmlContent);
                console.log('✅ Android fullscreen desteği eklendi');
            }
        } catch (error) {
            console.warn('⚠️ Fullscreen eklenirken hata:', error.message);
        }
    }

    /**
     * APK build işlemi
     */
    async _buildAPKWithCapacitor(webAppPath, appName, appVersion, androidPath) {
        console.log('🔨 Capacitor ile APK build...');
        
        try {
            // Sync ve build
            await this._runCapacitorCommand('sync', ['android'], webAppPath);
            await this._runGradleBuild(webAppPath);
            
            // APK dosyasını bul
            const apkPath = await this._findBuiltAPK(webAppPath);
            if (!apkPath) {
                throw new Error('APK dosyası bulunamadı');
            }
            
            const finalApkPath = path.join(androidPath, `${appName}-v${appVersion}.apk`);
            await fs.copy(apkPath, finalApkPath);
            
            const stats = await fs.stat(finalApkPath);
            
            return {
                filename: path.basename(finalApkPath),
                path: finalApkPath,
                size: stats.size,
                type: 'apk',
                message: `APK başarıyla oluşturuldu! (${(stats.size / 1024 / 1024).toFixed(1)} MB)`
            };
            
        } catch (error) {
            // ÖNEMLI: Android için SADECE APK üretilir
            throw new Error(`Android APK üretimi başarısız: ${error.message}. Android paketleme sadece APK dosyası üretir.`);
        }
    }

    /**
     * Capacitor komutunu çalıştır
     */
    async _runCapacitorCommand(command, args = [], workingDir = process.cwd()) {
        return this._runCommand('npx', ['@capacitor/cli', command, ...args], {
            cwd: workingDir,
            shell: true
        });
    }

    /**
     * Gradle build çalıştır
     */
    async _runGradleBuild(webAppPath) {
        const androidDir = path.join(webAppPath, 'android');
        const gradlewPath = path.join(androidDir, 'gradlew');
        
        if (await fs.pathExists(gradlewPath)) {
            await this._runCommand(gradlewPath, ['assembleDebug'], { cwd: androidDir });
        } else {
            await this._runCommand('gradle', ['assembleDebug'], { cwd: androidDir });
        }
    }

    /**
     * Build edilmiş APK'yı bul
     */
    async _findBuiltAPK(webAppPath) {
        const possiblePaths = [
            path.join(webAppPath, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
            path.join(webAppPath, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
        ];
        
        for (const apkPath of possiblePaths) {
            if (await fs.pathExists(apkPath)) {
                console.log('✅ APK bulundu:', apkPath);
                return apkPath;
            }
        }
        
        return null;
    }

    /**
     * Platform sağlık kontrolü
     */
    async healthCheck() {
        try {
            const checks = {
                java: false,
                capacitor: false,
                nodeVersion: false
            };
            
            // Java kontrolü
            try {
                await this._checkCommand('java -version');
                checks.java = true;
            } catch (error) {
                console.warn('⚠️ Java bulunamadı');
            }
            
            // Capacitor kontrolü
            try {
                await this._checkCommand('npx @capacitor/cli --version');
                checks.capacitor = true;
            } catch (error) {
                console.warn('⚠️ Capacitor bulunamadı');
            }
            
            // Node.js kontrolü
            const nodeVersion = process.version;
            const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
            checks.nodeVersion = majorVersion >= 16;
            
            const healthScore = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
            const isHealthy = healthScore >= 0.66;
            
            return {
                healthy: isHealthy,
                score: healthScore,
                checks,
                recommendations: this._generateHealthRecommendations(checks),
                platform: 'android',
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            return {
                healthy: false,
                score: 0,
                error: error.message,
                platform: 'android',
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Sağlık önerileri
     */
    _generateHealthRecommendations(checks) {
        const recommendations = [];
        
        if (!checks.java) {
            recommendations.push('Java 8+ kurulumu gerekli');
        }
        if (!checks.capacitor) {
            recommendations.push('Capacitor kurulumu gerekli: npm install -g @capacitor/cli');
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
     * Komut çalıştırıcı yardımcısı
     */
    async _runCommand(command, args = [], options = {}) {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                stdio: 'pipe',
                shell: true,
                ...options
            });
            
            let output = '';
            let errorOutput = '';
            
            child.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            child.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            
            child.on('close', (code) => {
                if (code === 0) {
                    resolve(output);
                } else {
                    reject(new Error(`Command failed: ${command} ${args.join(' ')} - ${errorOutput}`));
                }
            });
            
            child.on('error', reject);
        });
    }

    /**
     * Komut kontrolü
     */
    async _checkCommand(command) {
        return this._runCommand(command, [], { stdio: 'pipe' });
    }
}

module.exports = AndroidPackagingService;