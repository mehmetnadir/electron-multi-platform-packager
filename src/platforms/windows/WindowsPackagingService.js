/**
 * İzole Windows Paketleme Servisi
 * Windows platforma özel paketleme işlemleri
 */

const BasePackagingService = require('../common/BasePackagingService');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

class WindowsPackagingService extends BasePackagingService {
  constructor() {
    super('windows');
    this.supportedFormats = ['exe', 'msi', 'portable'];
    this.dependencies = ['electron-builder', 'nsis'];
  }

  /**
   * Windows bağımlılık kontrolü
   * @param {string} dependency 
   * @returns {Promise<Object>}
   */
  async checkDependency(dependency) {
    switch (dependency) {
      case 'electron-builder':
        return this.checkElectronBuilder();
      case 'nsis':
        return this.checkNSIS();
      default:
        return { available: false, error: 'Bilinmeyen bağımlılık' };
    }
  }

  /**
   * Electron Builder kontrolü
   */
  async checkElectronBuilder() {
    try {
      const { spawn } = require('child_process');
      return new Promise((resolve) => {
        const child = spawn('npx', ['electron-builder', '--version'], { shell: true });
        
        child.on('close', (code) => {
          resolve({
            available: code === 0,
            version: code === 0 ? 'available' : 'not_found'
          });
        });
        
        child.on('error', () => {
          resolve({ available: false, error: 'Electron Builder kurulu değil' });
        });
      });
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  /**
   * NSIS kontrolü
   */
  async checkNSIS() {
    // Electron Builder ile birlikte gelir, kontrol etmemize gerek yok
    return { available: true, version: 'included_with_electron_builder' };
  }

  /**
   * Platform özel validasyon
   * @param {Object} request 
   * @returns {Promise<Object>}
   */
  async validate(request) {
    const errors = [];
    
    // Temel validasyon
    if (!request.appName) {
      errors.push('Uygulama adı gerekli');
    }
    
    if (!request.appVersion) {
      errors.push('Uygulama versiyonu gerekli');
    }
    
    if (!request.workingPath || !await fs.pathExists(request.workingPath)) {
      errors.push('Geçerli çalışma dizini gerekli');
    }
    
    // Windows özel validasyon
    if (request.options?.publisherName && request.options.publisherName.length > 100) {
      errors.push('Yayıncı adı 100 karakterden uzun olamaz');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Ana paketleme fonksiyonu
   * @param {Object} request 
   * @returns {Promise<Object>}
   */
  async package(request) {
    return this.safeExecute(async () => {
      // Validasyon
      const validation = await this.validate(request);
      if (!validation.valid) {
        throw new Error(`Validasyon hatası: ${validation.errors.join(', ')}`);
      }

      this.progressReporter?.start('Windows paketleme başlıyor...');

      // Çıktı dizini oluştur
      const outputPath = path.join(request.tempPath, 'windows');
      await fs.ensureDir(outputPath);

      this.progressReporter?.step(1, 'validation', 'Mevcut kurulum kontrol ediliyor...');

      // Mevcut kurulumla karşılaştır
      const updateInfo = await this.compareWithExistingInstallation(
        request.workingPath, 
        request.appName, 
        request.appVersion, 
        request.companyInfo?.companyId, 
        request.companyInfo?.companyName
      );

      // Eğer uygulama zaten güncel ise
      if (updateInfo.isIdentical) {
        this.progressReporter?.complete({
          platform: 'windows',
          filename: 'Uygulama Güncel - Direkt Açılıyor',
          path: null,
          size: 0,
          type: 'quick-launch',
          updateInfo
        }, 'Uygulama zaten güncel - hızla açılıyor!');

        return this.formatResult({
          filename: 'Uygulama Güncel - Direkt Açılıyor',
          path: null,
          size: 0,
          type: 'quick-launch',
          updateInfo
        }, request);
      }

      this.progressReporter?.step(2, 'icon_preparation', 'Icon hazırlanıyor...');

      // Icon işleme - Debug bilgileri ile
      console.log('🔍 Icon işleme debug bilgileri:');
      console.log('  - Request logoPath:', request.logoPath);
      console.log('  - WorkingPath:', request.workingPath);
      
      const validIcon = await this.getValidWindowsIcon(request.workingPath, request.logoPath);
      
      console.log('🏁 Final icon path:', validIcon);
      console.log('📁 Icon dosyası var mı?', await fs.pathExists(validIcon));
      
      if (await fs.pathExists(validIcon)) {
        const stats = await fs.stat(validIcon);
        console.log('📊 Icon dosya boyutu:', stats.size, 'bytes');
      }

      // ÇÖZÜLDİ: Icon dosyasını working directory'e kopyala
      if (validIcon && await fs.pathExists(validIcon)) {
        const iconDestPath = path.join(request.workingPath, 'app-icon.png');
        await fs.copy(validIcon, iconDestPath);
        console.log('✅ Icon working directory\'e kopyalandı:', iconDestPath);
      }

      this.progressReporter?.step(3, 'config_creation', 'Electron Builder konfigürasyonu oluşturuluyor...');

      // Electron Builder config oluştur
      const config = await this.createElectronBuilderConfig(
        request, 
        outputPath, 
        validIcon, 
        updateInfo
      );

      // Config dosyasını yaz
      const configPath = path.join(request.tempPath, 'electron-builder-win.json');
      await fs.writeJson(configPath, config, { spaces: 2 });

      this.progressReporter?.step(4, 'custom_files', 'Özel kurulum dosyaları oluşturuluyor...');

      // Özel kurulum dosyaları oluştur
      await this.createCustomInstallationFiles(
        request.workingPath, 
        request.appName, 
        request.companyInfo?.companyName, 
        request.logoPath, 
        updateInfo
      );

      this.progressReporter?.step(5, 'building', 'Electron Builder çalıştırılıyor...');

      // Electron Builder'ı çalıştır
      await this.runElectronBuilder(configPath, 'win');

      this.progressReporter?.step(6, 'file_check', 'Dosya kontrolü yapılıyor...');

      // Çıktı dosyasını bul
      const installerFile = await this.findInstallerFile(outputPath, request.workingPath, request.tempPath);

      if (!installerFile) {
        throw new Error('Windows installer oluşturulamadı');
      }

      const result = {
        filename: installerFile.name,
        path: installerFile.path,
        size: installerFile.size,
        type: 'installer',
        updateInfo
      };

      this.progressReporter?.complete(result, 'Windows paketleme tamamlandı');

      return this.formatResult(result, request);

    }, { operation: 'windows_packaging', request });
  }

  /**
   * Mevcut kurulumla karşılaştırma
   */
  async compareWithExistingInstallation(workingPath, appName, appVersion, companyId, companyName) {
    try {
      // Platform özel installasyon yolu bulma
      const installationPath = await this.getWindowsInstallationPath(appName, companyId, companyName);
      
      if (!installationPath) {
        return {
          hasExistingInstallation: false,
          isIdentical: false,
          updateType: 'fresh',
          changedFiles: [],
          newFiles: [],
          deletedFiles: [],
          unchangedFiles: []
        };
      }

      // Mevcut dosya hash'lerini oku
      const existingHashFile = path.join(installationPath, '.app-hashes.json');
      if (!await fs.pathExists(existingHashFile)) {
        return {
          hasExistingInstallation: true,
          isIdentical: false,
          updateType: 'upgrade',
          previousVersion: 'unknown'
        };
      }

      const existingHashes = await fs.readJson(existingHashFile);
      
      // Yeni dosya hash'lerini hesapla
      const newHashes = await this.calculateFileHashes(workingPath, appName, appVersion);
      
      // Karşılaştırma analizi
      const comparison = this.analyzeChanges(existingHashes, newHashes);
      
      return {
        hasExistingInstallation: true,
        isIdentical: comparison.isIdentical,
        updateType: comparison.isIdentical ? 'identical' : 'incremental',
        previousVersion: existingHashes.appVersion,
        ...comparison
      };

    } catch (error) {
      console.warn('Kurulum karşılaştırma hatası:', error.message);
      return {
        hasExistingInstallation: false,
        isIdentical: false,
        updateType: 'fresh'
      };
    }
  }

  /**
   * Windows kurulum yolu bulma
   */
  async getWindowsInstallationPath(appName, companyId, companyName) {
    const possiblePaths = [];
    const companyDir = companyId || companyName || 'default';
    const baseDir = process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local';
    
    possiblePaths.push(
      path.join(baseDir, 'Programs', 'dijitap', companyDir, appName),
      path.join(baseDir, 'Programs', appName),
      path.join('C:\\Program Files', 'dijitap', companyDir, appName),
      path.join('C:\\Program Files (x86)', 'dijitap', companyDir, appName)
    );
    
    for (const installPath of possiblePaths) {
      try {
        const hashFile = path.join(installPath, '.app-hashes.json');
        if (await fs.pathExists(hashFile)) {
          return installPath;
        }
      } catch (error) {
        continue;
      }
    }
    
    return null;
  }

  /**
   * Electron Builder config oluştur
   */
  async createElectronBuilderConfig(request, outputPath, validIcon, updateInfo) {
    const companyDir = request.companyInfo?.companyId || 
                       request.companyInfo?.companyName || 
                       'default';
    
    // Sidebar imageni oluştur
    let sidebarImage = undefined;
    if (validIcon && await fs.pathExists(validIcon)) {
      try {
        const sidebarPath = path.join(path.dirname(validIcon), 'sidebar.png');
        sidebarImage = await this._convertToBMP(validIcon, sidebarPath);
        console.log('✅ NSIS sidebar image hazırlandı:', sidebarImage);
      } catch (error) {
        console.warn('⚠️ Sidebar image oluşturulamadı:', error.message);
      }
    }
    
    // DEBUG: Icon konfigürasyon bilgileri
    console.log('🔧 NSIS Icon Konfigürasyonu:');
    console.log('  📁 validIcon path:', validIcon);
    console.log('  📄 validIcon format:', path.extname(validIcon));
    console.log('  ✅ ICO format mi?', validIcon.endsWith('.ico'));
    console.log('  📁 sidebarImage:', sidebarImage);
    
    return {
      appId: `com.${request.appName.toLowerCase().replace(/\s+/g, '')}.app`,
      productName: request.appName,
      buildVersion: request.appVersion,
      directories: {
        app: path.resolve(request.workingPath),
        output: outputPath
      },
      files: [
        "**/*",
        "!node_modules",
        "!temp",
        "!uploads"
      ],
      win: {
        target: {
          target: "nsis",
          arch: ["x64"]
        },
        icon: validIcon, // Uygulama ikonu
        publisherName: request.options?.publisherName || "Dijitap",
        requestedExecutionLevel: "asInvoker"
      },
      nsis: {
        oneClick: true, // Kullanıcı onayı olmadan otomatik kurulum
        allowElevation: false, // Yönetici izni istenmez
        allowToChangeInstallationDirectory: false,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        runAfterFinish: true, // Kurulum sonrası otomatik açılma
        shortcutName: request.appName,
        displayLanguageSelector: false,
        language: "1055", // Türkçe
        installerLanguages: ["tr_TR"],
        uninstallDisplayName: request.appName + " Kaldır",
        menuCategory: "Education",
        artifactName: `\${productName}-\${version}-Setup.\${ext}`,
        perMachine: false,
        // ÇÖZÜLDÜ: Kurulum dosyasının (.exe) ikonu - ICO formatı ZORUNLU
        installerIcon: validIcon.endsWith('.ico') ? validIcon : undefined,
        uninstallerIcon: validIcon.endsWith('.ico') ? validIcon : undefined,
        installerHeaderIcon: validIcon.endsWith('.ico') ? validIcon : undefined,
        // Sidebar için PNG kullan
        installerSidebar: sidebarImage
      }
    };
  }

  /**
   * Geçerli Windows icon alma ve hazırlama
   */
  async getValidWindowsIcon(workingPath, logoPath) {
    console.log('🖼️ Windows icon hazırlanıyor...');
    console.log('📁 Çalışma dizini:', workingPath);
    console.log('🖼️ Logo yolu:', logoPath);
    
    try {
      // Logo yoksa varsayılan icon oluştur
      if (!logoPath || !await fs.pathExists(logoPath)) {
        console.log('⚠️ Logo bulunamadı, varsayılan icon oluşturuluyor');
        const defaultIconPath = path.join(workingPath, 'icon.ico');
        await this._createDefaultIcon(defaultIconPath.replace('.ico', '.png'));
        return await this._convertToWindowsIcon(defaultIconPath.replace('.ico', '.png'), defaultIconPath);
      }
      
      // Logo'dan Windows icon'u oluştur - ICO formatında
      const iconPath = path.join(workingPath, 'app-icon.ico');
      const finalIconPath = await this._convertToWindowsIcon(logoPath, iconPath);
      
      // Icon dosyasının varlığını kontrol et ve debug bilgisi ver
      console.log('🔍 Icon dosyası kontrolü:');
      console.log('  📁 Icon yolu:', finalIconPath);
      console.log('  ✅ Dosya var mı?', await fs.pathExists(finalIconPath));
      
      if (await fs.pathExists(finalIconPath)) {
        const stats = await fs.stat(finalIconPath);
        console.log('  📊 Dosya boyutu:', stats.size, 'bytes');
        console.log('  📄 Dosya formatı:', path.extname(finalIconPath));
      }
      
      console.log('✅ Windows icon hazırlandı:', finalIconPath);
      return finalIconPath;
      
    } catch (error) {
      console.warn('⚠️ Windows icon oluşturma hatası:', error.message);
      
      // Fallback: orijinal logo'yu PNG formatında kullan
      if (logoPath && await fs.pathExists(logoPath)) {
        console.log('🔄 Fallback: Orijinal logo PNG formatında kullanılıyor');
        const pngIconPath = path.join(workingPath, 'fallback-icon.png');
        await fs.copy(logoPath, pngIconPath);
        return pngIconPath;
      }
      
      // Son çare: basit icon oluştur
      const fallbackIconPath = path.join(workingPath, 'fallback-icon.png');
      await this._createDefaultIcon(fallbackIconPath);
      return fallbackIconPath;
    }
  }

  /**
   * Logo'yu Windows ICO formatına çevir
   */
  async _convertToWindowsIcon(logoPath, iconPath) {
    const sharp = require('sharp');
    
    try {
      console.log('🔄 Logo ICO formatına çevriliyor...');
      console.log('📁 Kaynak logo:', logoPath);
      console.log('🎯 Hedef icon:', iconPath);
      
      // NSIS installer için hem PNG hem ICO formatları oluştur
      const pngIconPath = iconPath.replace('.ico', '.png');
      
      // PNG format (uygulama için)
      await sharp(logoPath)
        .resize(256, 256, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 0 }
        })
        .png()
        .toFile(pngIconPath);
      
      console.log('✅ PNG icon oluşturuldu:', pngIconPath);
      
      // ICO format (NSIS installer için) - farklı boyutlarda
      const icoSizes = [16, 32, 48, 64, 128, 256];
      const icoBuffer = await this._createMultiSizeICO(logoPath, icoSizes);
      
      // ICO dosyasını yaz
      await fs.writeFile(iconPath, icoBuffer);
      console.log('✅ ICO icon oluşturuldu:', iconPath);
      
      // NSIS installer için ICO formatını döndür
      return iconPath;
      
    } catch (error) {
      console.error('❌ Logo çevirme hatası:', error);
      // Fallback: PNG formatını döndür
      const pngIconPath = iconPath.replace('.ico', '.png');
      if (await fs.pathExists(pngIconPath)) {
        console.log('🔄 Fallback: PNG formatı kullanılıyor');
        return pngIconPath;
      }
      throw error;
    }
  }

  /**
   * Çoklu boyutta ICO dosyası oluştur
   */
  async _createMultiSizeICO(logoPath, sizes) {
    const sharp = require('sharp');
    
    try {
      console.log('🔧 Multi-size ICO oluşturuluyor...');
      
      // ICO başlığı oluştur
      const iconCount = sizes.length;
      const headerSize = 6 + (iconCount * 16);
      let totalSize = headerSize;
      
      // Her boyut için PNG buffer'ları oluştur
      const imageBuffers = [];
      for (const size of sizes) {
        const buffer = await sharp(logoPath)
          .resize(size, size, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 0 }
          })
          .png()
          .toBuffer();
        
        imageBuffers.push(buffer);
        totalSize += buffer.length;
      }
      
      // ICO dosyası buffer'ını oluştur
      const icoBuffer = Buffer.alloc(totalSize);
      let offset = 0;
      
      // ICO başlığı yaz
      icoBuffer.writeUInt16LE(0, offset); // Reserved
      offset += 2;
      icoBuffer.writeUInt16LE(1, offset); // Type (1 = ICO)
      offset += 2;
      icoBuffer.writeUInt16LE(iconCount, offset); // Image count
      offset += 2;
      
      // Görüntü dizini yazalım
      let imageOffset = headerSize;
      for (let i = 0; i < iconCount; i++) {
        const size = sizes[i];
        const buffer = imageBuffers[i];
        
        icoBuffer.writeUInt8(size === 256 ? 0 : size, offset); // Width
        offset += 1;
        icoBuffer.writeUInt8(size === 256 ? 0 : size, offset); // Height
        offset += 1;
        icoBuffer.writeUInt8(0, offset); // Color palette
        offset += 1;
        icoBuffer.writeUInt8(0, offset); // Reserved
        offset += 1;
        icoBuffer.writeUInt16LE(1, offset); // Color planes
        offset += 2;
        icoBuffer.writeUInt16LE(32, offset); // Bits per pixel
        offset += 2;
        icoBuffer.writeUInt32LE(buffer.length, offset); // Image size
        offset += 4;
        icoBuffer.writeUInt32LE(imageOffset, offset); // Image offset
        offset += 4;
        
        imageOffset += buffer.length;
      }
      
      // Görüntü verilerini yaz
      for (const buffer of imageBuffers) {
        buffer.copy(icoBuffer, offset);
        offset += buffer.length;
      }
      
      console.log('✅ Multi-size ICO oluşturuldu:', totalSize, 'bytes');
      return icoBuffer;
      
    } catch (error) {
      console.error('❌ Multi-size ICO oluşturma hatası:', error);
      throw error;
    }
  }

  /**
   * Varsayılan icon oluştur
   */
  async _createDefaultIcon(iconPath) {
    const sharp = require('sharp');
    
    try {
      console.log('🎨 Varsayılan Windows icon oluşturuluyor...');
      console.log('🎯 Hedef:', iconPath);
      
      // 256x256 mavi gradient icon
      await sharp({
        create: {
          width: 256,
          height: 256,
          channels: 4,
          background: { r: 52, g: 152, b: 219, alpha: 1 }
        }
      })
      .png()
      .toFile(iconPath);
      
      console.log('✅ Varsayılan icon oluşturuldu:', iconPath);
      
    } catch (error) {
      console.warn('⚠️ Varsayılan icon oluşturulamadı:', error.message);
    }
  }

  /**
   * PNG'yi BMP formatına çevir (NSIS sidebar için)
   */
  async _convertToBMP(iconPath, bmpPath) {
    const sharp = require('sharp');
    
    try {
      console.log('🔄 BMP format dönüşümü...');
      console.log('📁 Kaynak:', iconPath);
      console.log('🎯 Hedef BMP:', bmpPath);
      
      // NSIS sidebar için optimal boyut: 164x314
      await sharp(iconPath)
        .resize(164, 314, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .png() // BMP yerine PNG kullan (NSIS PNG'yi de destekler)
        .toFile(bmpPath.replace('.bmp', '.png'));
      
      const finalPath = bmpPath.replace('.bmp', '.png');
      console.log('✅ Sidebar image oluşturuldu:', finalPath);
      return finalPath;
      
    } catch (error) {
      console.warn('⚠️ BMP dönüşüm hatası:', error.message);
      return iconPath; // Fallback: orijinal icon'u kullan
    }
  }

  /**
   * Özel kurulum dosyaları oluştur
   */
  /**
   * CACHE BUSTING: Özel kurulum dosyaları oluştur
   */
  async createCustomInstallationFiles(workingPath, appName, companyName, logoPath, updateInfo) {
    console.log('🗑️ CACHE BUSTING: Kurulum dosyaları hazırlanıyor...');
    
    const buildDir = path.join(workingPath, 'build');
    await fs.ensureDir(buildDir);
    
    // CACHE BUSTING: Tüm eski cache'leri temizle
    try {
      const cacheFiles = [
        path.join(workingPath, 'main.js.backup'),
        path.join(workingPath, 'electron.js.backup'),
        path.join(workingPath, '.app-hashes.json'),
        path.join(buildDir, 'cache.json'),
        path.join(buildDir, 'installer.nsh'),
        path.join(buildDir, 'build-info.json')
      ];
      
      for (const cacheFile of cacheFiles) {
        if (await fs.pathExists(cacheFile)) {
          await fs.remove(cacheFile);
          console.log('🗑️ Cache dosyası silindi:', path.basename(cacheFile));
        }
      }
    } catch (error) {
      console.warn('⚠️ Cache temizleme hatası:', error.message);
    }
    
    // Main.js dosyasını kontrol et ve pencere modunu ayarla - CACHE BUSTING
    await this._ensureWindowMode(workingPath, appName, companyName);
    
    // setBook konfigürasyonu manuel olarak ayarlanacak - otomatik değiştirilmez
    
    // NSIS script oluştur
    const nsisScript = this.generateNSISScript(appName, companyName, updateInfo);
    await fs.writeFile(path.join(buildDir, 'installer.nsh'), nsisScript);
    
    // ÇÖZÜLDÜ: Logo dosyasını build dizinine kopyala
    if (logoPath && await fs.pathExists(logoPath)) {
      const logoDestPath = path.join(buildDir, 'app-icon.png');
      
      // Logo'yu PNG formatında kopyala (NSIS için)
      try {
        const sharp = require('sharp');
        await sharp(logoPath)
          .resize(256, 256, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
          .png()
          .toFile(logoDestPath);
          
        console.log('✅ Kurum logosu NSIS için hazırlandı');
      } catch (error) {
        console.warn('⚠️ Logo PNG dönüştürme hatası:', error.message);
        // Fallback: direkt kopyala
        await fs.copy(logoPath, logoDestPath);
      }
    }
    
    // Kurulum rehberi oluştur
    const installGuide = this.generateInstallGuide(appName, companyName, updateInfo);
    await fs.writeFile(path.join(buildDir, 'KURULUM_REHBERI.md'), installGuide);
    
    // CACHE BUSTING: Timestamp ve build info ekle
    const cacheInfo = {
      timestamp: Date.now(),
      appName,
      companyName,
      buildId: Math.random().toString(36).substr(2, 9),
      cacheCleared: true,
      homeButtonNavigation: true,
      debugConsole: true,
      freshBuild: true
    };
    await fs.writeFile(path.join(buildDir, 'build-info.json'), JSON.stringify(cacheInfo, null, 2));
    
    console.log('✅ CACHE BUSTING: Özel kurulum dosyaları oluşturuldu - cache temizlendi');
    console.log('🐛 Build ID:', cacheInfo.buildId);
  }

  /**
   * CACHE BUSTING: Main.js dosyasında pencere modunu zorla ayarla
   */
  async _ensureWindowMode(workingPath, appName, companyName) {
    console.log('🗑️ CACHE BUSTING: Önce tüm eski dosyaları temizle...');
    console.log('📁 Working path:', workingPath);
    
    const mainJsPath = path.join(workingPath, 'main.js');
    const electronJsPath = path.join(workingPath, 'electron.js');
    
    // STEP 1: TÜM ESKİ DOSYALARI SİL - CACHE BUST
    try {
      if (await fs.pathExists(mainJsPath)) {
        await fs.remove(mainJsPath);
        console.log('🗑️ main.js silindi');
      }
      if (await fs.pathExists(electronJsPath + '.backup')) {
        await fs.remove(electronJsPath + '.backup');
        console.log('🗑️ electron.js.backup silindi');
      }
    } catch (error) {
      console.warn('⚠️ Dosya silme hatası:', error.message);
    }
    
    // STEP 1.5: HTML ETKİNLİKLERİNE ZOOM ENHANCEMENTİ UYGULA
    await this._applyZoomEnhancementToHtmlActivities(workingPath);
    
    // STEP 2: HER ZAMAN YENİ TEMPLATE OLUŞTUR
    const windowTitle = companyName ? `${appName} - ${companyName}` : appName;
    
    const freshMainJsContent = `const { app, BrowserWindow, screen, shell, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

const createWindow = () => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    fullscreen: false,
    resizable: true,
    maximizable: true,
    title: '${windowTitle}',
    webPreferences: {
      worldSafeExecuteJavaScript: true,
      contextIsolation: false,
      nodeIntegration: true,
      enableRemoteModule: true,
      webSecurity: false
    }
  });
  
  mainWindow.maximize();
  mainWindow.removeMenu();
  mainWindow.loadFile('index.html');
  
  // CACHE BUSTING DEBUG: Console'u otomatik aç
  mainWindow.webContents.openDevTools();
  console.log('🐛 CACHE BUSTING DEBUG: Developer console aktif!');
  
  // Home button navigation - CACHE BUSTING VERSION
  mainWindow.webContents.on('dom-ready', () => {
    mainWindow.webContents.executeJavaScript(\`
      (function() {
        console.log('🏠 CACHE BUSTING: Home button navigation system initialized');
        console.log('📍 Current location:', window.location.href);
        
        // Override window.location.assign for home navigation
        const originalAssign = window.location.assign;
        window.location.assign = function(url) {
          console.log('🔄 Navigation intercepted:', url);
          if (url === '../index.html' || url.includes('../index.html')) {
            console.log('🏠 Home navigation detected - redirecting to index.html');
            originalAssign.call(window.location, 'index.html');
            return;
          }
          originalAssign.call(window.location, url);
        };
        
        // Enhanced home button click handler
        document.addEventListener('click', function(event) {
          const target = event.target;
          const targetName = target.name || target.getAttribute('name');
          
          if (target && targetName === 'home') {
            console.log('🏠 CACHE BUSTING: Home button clicked!');
            event.preventDefault();
            event.stopPropagation();
            
            // Multi-method approach for robust navigation
            try {
              window.location.assign('../index.html');
            } catch (e) {
              console.warn('Method 1 failed, trying Method 2:', e);
              try {
                window.location.href = 'index.html';
              } catch (e2) {
                console.warn('Method 2 failed, trying Method 3:', e2);
                window.location.replace('index.html');
              }
            }
            
            return false;
          }
        }, true);
        
        console.log('✅ CACHE BUSTING: Navigation handlers ready');
      })();
    \`).catch(err => {
      console.warn('⚠️ Navigation injection failed:', err.message);
    });
  });
};

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

// IPC handler for root navigation
ipcMain.removeAllListeners('navigate-to-root');
ipcMain.on('navigate-to-root', () => {
  console.log('📨 Received navigate-to-root message');
  const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (mainWindow) {
    mainWindow.loadFile('index.html');
  }
});
`;
    
    // STEP 3: YENİ MAIN.JS'Yİ YAZ - HER ZAMAN
    await fs.writeFile(mainJsPath, freshMainJsContent);
    console.log('✅ CACHE BUSTING: Yeni main.js oluşturuldu - tüm eski cache temizlendi');
    console.log('🐛 Console otomatik açılacak - home button navigation test edilebilir');
    
    return;
  }

  /**
   * HTML etkinliklerine zoom enhancement uygula
   */
  async _applyZoomEnhancementToHtmlActivities(workingPath) {
    try {
      // Glob'u require et
      const glob = require('glob');
      
      console.log('🔍 HTML etkinlikleri aranıyor:', workingPath);
      
      // HTML etkinlik dosyalarını bul
      const pattern = path.join(workingPath, '**/htmletk/**/index.html');
      const htmlFiles = glob.sync(pattern, { absolute: true });
      
      console.log(`📊 ${htmlFiles.length} adet HTML etkinlik dosyası bulundu`);
      
      if (htmlFiles.length === 0) {
        console.log('ℹ️ HTML etkinlik dosyası bulunamadı, zoom enhancement atlanıyor');
        return;
      }
      
      // Zoom enhancement şablonları
      const ZOOM_CSS = `
    /* Zoom+Pan Enhancement CSS */
    .zoom-controls {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      background: rgba(255, 255, 255, 0.95);
      padding: 12px;
      border-radius: 8px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.2);
      backdrop-filter: blur(5px);
      min-width: 80px;
    }

    .zoom-btn-row {
      display: flex;
      gap: 8px;
    }

    .zoom-btn {
      width: 32px;
      height: 32px;
      border: 2px solid #4a90e2;
      background: white;
      cursor: pointer;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 18px;
      color: #4a90e2;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .zoom-btn:hover {
      background: #4a90e2;
      color: white;
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    }

    .zoom-btn:active {
      transform: translateY(0);
    }

    .zoom-level {
      font-size: 12px;
      font-weight: bold;
      color: #333;
      background: rgba(74, 144, 226, 0.1);
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid rgba(74, 144, 226, 0.3);
      min-width: 45px;
      text-align: center;
    }

    .zoom-reset {
      width: 60px;
      height: 28px;
      font-size: 11px;
      background: #f8f9fa;
      border: 2px solid #6c757d;
      color: #6c757d;
    }

    .zoom-reset:hover {
      background: #6c757d;
      color: white;
    }

    #activity-viewport {
      overflow: hidden;
      position: relative;
      width: 100%;
      height: 100%;
    }

    #root {
      transform-origin: 0 0;
      transition: transform 0.2s ease;
      cursor: grab;
    }

    #root:active {
      cursor: grabbing;
    }

    #root.dragging {
      cursor: grabbing !important;
    }

    #root * {
      pointer-events: auto;
    }

    #root.panning * {
      pointer-events: none;
    }
`;
      
      const ZOOM_HTML = `
    <!-- Zoom Controls -->
    <div class="zoom-controls">
      <div class="zoom-btn-row">
        <button class="zoom-btn" onclick="zoomIn()" title="Yakınlaştır">+</button>
        <button class="zoom-btn" onclick="zoomOut()" title="Uzaklaştır">-</button>
      </div>
      <div class="zoom-level" id="zoom-level">100%</div>
      <button class="zoom-btn zoom-reset" onclick="resetZoom()" title="Orijinal boyut">1:1</button>
    </div>
`;
      
      const ZOOM_JS = `
    // Zoom+Pan Enhancement JavaScript
    let currentZoom = 1;
    let currentPanX = 0;
    let currentPanY = 0;
    let isDragging = false;

    function updateTransform() {
      const root = document.getElementById('root');
      const zoomLevel = document.getElementById('zoom-level');
      if (root) {
        root.style.transform = \`scale(\${currentZoom}) translate(\${currentPanX}px, \${currentPanY}px)\`;
      }
      if (zoomLevel) {
        zoomLevel.textContent = Math.round(currentZoom * 100) + '%';
      }
    }

    function zoomIn() {
      currentZoom = Math.min(currentZoom * 1.2, 3);
      updateTransform();
      saveZoomState();
    }

    function zoomOut() {
      currentZoom = Math.max(currentZoom / 1.2, 0.5);
      updateTransform();
      saveZoomState();
    }

    function resetZoom() {
      currentZoom = 1;
      currentPanX = 0;
      currentPanY = 0;
      updateTransform();
      saveZoomState();
    }

    function saveZoomState() {
      try {
        localStorage.setItem('activityZoom', JSON.stringify({
          zoom: currentZoom,
          panX: currentPanX,
          panY: currentPanY
        }));
      } catch (e) {
        console.log('Could not save zoom state:', e);
      }
    }

    function loadZoomState() {
      try {
        const saved = localStorage.getItem('activityZoom');
        if (saved) {
          const state = JSON.parse(saved);
          currentZoom = state.zoom || 1;
          currentPanX = state.panX || 0;
          currentPanY = state.panY || 0;
          updateTransform();
        }
      } catch (e) {
        console.log('Could not load zoom state:', e);
      }
    }

    function initializePan() {
      const root = document.getElementById('root');
      if (!root) return;

      let startX, startY, initialPanX, initialPanY;
      let spacePressed = false;
      let shiftPressed = false;
      
      // Klavye olayları
      document.addEventListener('keydown', function(e) {
        if (e.code === 'Space') {
          spacePressed = true;
          if (currentZoom > 1.1) {
            root.style.cursor = 'grab';
            e.preventDefault();
          }
        }
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
          shiftPressed = true;
        }
      });
      
      document.addEventListener('keyup', function(e) {
        if (e.code === 'Space') {
          spacePressed = false;
          root.style.cursor = currentZoom > 1.1 ? 'default' : 'default';
        }
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
          shiftPressed = false;
        }
      });

      // Pan başlangıç - sağ tık, space+sol tık, shift+sol tık
      root.addEventListener('mousedown', function(e) {
        const target = e.target;
        
        // İnteraktif elementleri kontrol et
        const isInteractive = target.tagName === 'BUTTON' || 
                             target.tagName === 'INPUT' || 
                             target.onclick || 
                             target.ondrag || 
                             target.draggable ||
                             target.classList.contains('draggable') ||
                             target.classList.contains('interactive') ||
                             target.getAttribute('data-interactive') ||
                             getComputedStyle(target).cursor === 'pointer';

        // Zoom yeterli değilse veya interactive elementse çık
        if (isInteractive || currentZoom <= 1.1) return;
        
        // Pan koşulları: sağ tık VEYA space+sol tık VEYA shift+sol tık
        const rightClick = e.button === 2;
        const leftClickWithSpace = e.button === 0 && spacePressed;
        const leftClickWithShift = e.button === 0 && shiftPressed;
        
        if (rightClick || leftClickWithSpace || leftClickWithShift) {
          isDragging = true;
          startX = e.clientX;
          startY = e.clientY;
          initialPanX = currentPanX;
          initialPanY = currentPanY;
          
          root.classList.add('panning');
          root.style.cursor = 'grabbing';
          e.preventDefault();
        }
      });

      // Pan hareketi
      document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        currentPanX = initialPanX + deltaX / currentZoom;
        currentPanY = initialPanY + deltaY / currentZoom;
        
        updateTransform();
        e.preventDefault();
      });

      // Pan bitirme
      document.addEventListener('mouseup', function(e) {
        if (isDragging) {
          isDragging = false;
          root.classList.remove('panning');
          root.style.cursor = currentZoom > 1.1 ? (spacePressed ? 'grab' : 'default') : 'default';
          saveZoomState();
        }
      });
      
      // Sağ tık menüsünü engelle (pan için kullanıyoruz)
      root.addEventListener('contextmenu', function(e) {
        if (currentZoom > 1.1) {
          e.preventDefault();
        }
      });

      // Dokunmatik pan desteği (çift parmak)
      let touchStartDistance = 0;
      let touchStartX = 0;
      let touchStartY = 0;
      let touchPanX = 0;
      let touchPanY = 0;
      
      root.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2 && currentZoom > 1.1) {
          // Çift parmak - pan başlat
          const touch1 = e.touches[0];
          const touch2 = e.touches[1];
          touchStartDistance = Math.hypot(
            touch2.clientX - touch1.clientX,
            touch2.clientY - touch1.clientY
          );
          touchStartX = (touch1.clientX + touch2.clientX) / 2;
          touchStartY = (touch1.clientY + touch2.clientY) / 2;
          touchPanX = currentPanX;
          touchPanY = currentPanY;
          e.preventDefault();
        }
      });
      
      root.addEventListener('touchmove', function(e) {
        if (e.touches.length === 2 && currentZoom > 1.1) {
          const touch1 = e.touches[0];
          const touch2 = e.touches[1];
          const currentDistance = Math.hypot(
            touch2.clientX - touch1.clientX,
            touch2.clientY - touch1.clientY
          );
          const currentX = (touch1.clientX + touch2.clientX) / 2;
          const currentY = (touch1.clientY + touch2.clientY) / 2;
          
          // Eğer mesafe değişmiyorsa (zoom değil), pan yap
          if (Math.abs(currentDistance - touchStartDistance) < 10) {
            const deltaX = currentX - touchStartX;
            const deltaY = currentY - touchStartY;
            currentPanX = touchPanX + deltaX / currentZoom;
            currentPanY = touchPanY + deltaY / currentZoom;
            updateTransform();
          }
          e.preventDefault();
        }
      });
      
      root.addEventListener('touchend', function(e) {
        if (e.touches.length < 2) {
          saveZoomState();
        }
      });

      // Wheel zoom
      root.addEventListener('wheel', function(e) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          
          const delta = e.deltaY > 0 ? 0.9 : 1.1;
          const newZoom = Math.max(0.5, Math.min(3, currentZoom * delta));
          
          if (newZoom !== currentZoom) {
            currentZoom = newZoom;
            updateTransform();
            saveZoomState();
          }
        }
      });
    }

    document.addEventListener('DOMContentLoaded', function() {
      loadZoomState();
      initializePan();
    });

    setTimeout(function() {
      loadZoomState();
      initializePan();
    }, 500);
`;
      
      // Her HTML dosyasını işle
      let enhancedCount = 0;
      
      for (const filePath of htmlFiles) {
        try {
          console.log(`🔄 İşleniyor: ${path.relative(workingPath, filePath)}`);
          
          let content = await fs.readFile(filePath, 'utf8');
          
          // Zaten zoom enhancementı var mı kontrol et
          if (content.includes('zoom-controls')) {
            console.log('  -> Zaten zoom enhancementı var, atlanıyor');
            continue;
          }
          
          // CSS ekle
          const headEndIndex = content.indexOf('</head>');
          if (headEndIndex !== -1) {
            content = content.slice(0, headEndIndex) + 
                     '  <style>' + ZOOM_CSS + '  </style>\n' +
                     content.slice(headEndIndex);
          }
          
          // Viewport wrapper ekle
          content = content.replace(
            '<div id="root"></div>',
            '<div id="activity-viewport"><div id="root"></div></div>'
          );
          
          // Zoom kontrolleri toolbar'a ekle
          const toolbarEndIndex = content.indexOf('</div>', content.indexOf('class="toolbar"'));
          if (toolbarEndIndex !== -1) {
            content = content.slice(0, toolbarEndIndex) + 
                     '      ' + ZOOM_HTML + '\n    ' +
                     content.slice(toolbarEndIndex);
          }
          
          // JavaScript ekle
          const bodyEndIndex = content.lastIndexOf('</body>');
          if (bodyEndIndex !== -1) {
            content = content.slice(0, bodyEndIndex) + 
                     '  <script>' + ZOOM_JS + '  </script>\n' +
                     content.slice(bodyEndIndex);
          }
          
          // Dosyayı kaydet
          await fs.writeFile(filePath, content, 'utf8');
          enhancedCount++;
          console.log('  -> ✅ Zoom enhancement uygulandı!');
          
        } catch (error) {
          console.error(`  -> ❌ Hata: ${error.message}`);
        }
      }
      
      console.log(`🎉 Zoom Enhancement Tamamlandı!`);
      console.log(`📊 İşlenen dosya: ${htmlFiles.length}`);
      console.log(`✨ Geliştirilen dosya: ${enhancedCount}`);
      console.log(`📈 Atlanılan dosya: ${htmlFiles.length - enhancedCount}`);
      
    } catch (error) {
      console.error('❌ Zoom enhancement uygulama hatası:', error.message);
    }
  }

  /**
   * NSIS script üret - Kurum logosu destekli
   */
  generateNSISScript(appName, companyName, updateInfo) {
    const companyText = companyName || 'Bilinmeyen Kurum';
    const speedMessage = updateInfo?.unchangedFiles?.length > 0 ? 
      `${updateInfo.unchangedFiles.length} dosya atlandı` : '';

    return `# ${appName} - Özel NSIS Kurulum Script'i
# Kurum logosu destekli otomatik kurulum

!include "MUI2.nsh"
!include "FileFunc.nsh"

# Kurulum ayarları
Name "${appName}"
OutFile "${appName}-Setup.exe"
InstallDir "$LOCALAPPDATA\\Programs\\dijitap\\${appName}"
RequestExecutionLevel user
SilentInstall silent

# Modern UI ayarları - Kurum logosu
!define MUI_ICON "app-icon.png"
!define MUI_UNICON "app-icon.png"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "app-icon.png"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_WELCOMEFINISHPAGE_BITMAP "app-icon.png"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "app-icon.png"

# Özel başlık ve açıklama
!define MUI_WELCOMEPAGE_TITLE "${appName} Kurulumu"
!define MUI_WELCOMEPAGE_TEXT "${companyText} tarafından hazırlanan ${appName} uygulaması kuruluyor...\$\\r\$\\n\$\\r\$\\n${speedMessage}\$\\r\$\\n\$\\r\$\\nKurulum otomatik olarak tamamlanacak ve uygulama açılacaktır."

# Kurulum progress'inde logo gösterimi
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "Kurulum Tamamlandı!"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "${companyText} - ${appName}"

# Sayfalar
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

# Diller
!insertmacro MUI_LANGUAGE "Turkish"

# Türkçe mesajlar
LangString INSTALL_MESSAGE \${LANG_TURKISH} "${appName} kurulumu başlıyor..."
LangString COMPLETE_MESSAGE \${LANG_TURKISH} "Kurulum tamamlandı! ${companyText}"
LangString SPEED_MESSAGE \${LANG_TURKISH} "${speedMessage}"
LangString LAUNCHING_MESSAGE \${LANG_TURKISH} "${appName} açılıyor..."

# Progress bar özelleştirmesi
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"

# Kurulum bölümü
Section "" SecMain
  SetOutPath "$INSTDIR"
  
  # Tüm dosyaları kopyala
  File /r "*.*"
  
  # Masaüstü kısayolu oluştur
  CreateShortCut "$DESKTOP\\${appName}.lnk" "$INSTDIR\\${appName}.exe" "" "$INSTDIR\\app-icon.ico"
  
  # Başlatma menüsü kısayolu
  CreateDirectory "$SMPROGRAMS\\${companyText}"
  CreateShortCut "$SMPROGRAMS\\${companyText}\\${appName}.lnk" "$INSTDIR\\${appName}.exe" "" "$INSTDIR\\app-icon.ico"
  
  # Registry kayıt
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${appName}" "DisplayName" "${appName}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${appName}" "UninstallString" "$INSTDIR\\Uninstall.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${appName}" "Publisher" "${companyText}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${appName}" "DisplayIcon" "$INSTDIR\\app-icon.ico"
  
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
SectionEnd

# Kurulum başlangıcında logo göster
Function .onInit
  SetSilent silent
  InitPluginsDir
  
  # Logo splash screen
  File /oname=$PLUGINSDIR\\splash.bmp "app-icon.png"
  advsplash::show 2000 1000 1000 -1 $PLUGINSDIR\\splash
  Pop $0
FunctionEnd

# Kurulum tamamlandığında otomatik açılma
Function .onInstSuccess
  MessageBox MB_OK "$(COMPLETE_MESSAGE)" /SD IDOK
  ExecShell "" "$INSTDIR\\${appName}.exe"
FunctionEnd`;
  }

  /**
   * Kurulum rehberi üret
   */
  generateInstallGuide(appName, companyName, updateInfo) {
    const companyText = companyName || 'Bilinmeyen Kurum';
    const speedMessage = updateInfo?.unchangedFiles?.length > 0 ? 
      `${updateInfo.unchangedFiles.length} dosya atlanarak hızlandırıldı` : '';

    return `# ${appName} - Kurulum Rehberi

## Kurulum Bilgileri
- **Uygulama**: ${appName}
- **Kurum**: ${companyText}
- **Platform**: Windows (NSIS)
- **Kurulum Tipi**: ${updateInfo?.updateType || 'fresh'}
${updateInfo?.previousVersion ? `- **Önceki Versiyon**: ${updateInfo.previousVersion}` : ''}
${speedMessage ? `- **Hız Kazancı**: ${speedMessage}` : ''}

## Özellikler
- ✅ Tek tıklamayla otomatik kurulum
- ✅ Yönetici izni otomatik alınır
- ✅ Masaüstü kısayolu otomatik oluşur
- ✅ Kurulum sonrası otomatik açılır
- ✅ Artımsal güncelleme desteği
${updateInfo?.unchangedFiles?.length > 0 ? `- ✅ ${updateInfo.unchangedFiles.length} dosya atlanarak hızlandırıldı` : ''}

## Kurulum Konumu
\`\`\`
$LocalAppData\\Programs\\dijitap\\${companyText}\\${appName}
\`\`\`

---
*Bu dosya otomatik oluşturulmuştur - ${new Date().toLocaleString('tr-TR')}*`;
  }

  /**
   * Electron Builder çalıştır
   */
  async runElectronBuilder(configPath, platform) {
    return this.withTimeout(async () => {
      return new Promise((resolve, reject) => {
        const child = spawn('npx', ['electron-builder', '--config', configPath, '--' + platform], {
          stdio: ['inherit', 'pipe', 'pipe'],
          shell: true
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          stdout += data;
          console.log(data.toString());
        });

        child.stderr.on('data', (data) => {
          stderr += data;
          console.error(data.toString());
        });

        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Electron Builder failed with code ${code}: ${stderr}`));
          }
        });

        child.on('error', reject);
      });
    }, 600000); // 10 dakika timeout
  }

  /**
   * Installer dosyasını bul
   */
  async findInstallerFile(outputPath, workingPath, tempPath) {
    // Ana output dizinini kontrol et
    let files = [];
    if (await fs.pathExists(outputPath)) {
      files = await fs.readdir(outputPath);
    }
    
    // Eğer bulunamazsa temp dizinini kontrol et
    if (files.length === 0) {
      const tempOutputPath = path.join(workingPath, 'temp', path.basename(tempPath), 'windows');
      if (await fs.pathExists(tempOutputPath)) {
        files = await fs.readdir(tempOutputPath);
        
        // Dosyayı ana output dizinine taşı
        for (const file of files) {
          if (file.endsWith('.exe')) {
            const sourcePath = path.join(tempOutputPath, file);
            const destPath = path.join(outputPath, file);
            await fs.move(sourcePath, destPath);
          }
        }
        files = await fs.readdir(outputPath);
      }
    }
    
    const installerFile = files.find(file => file.endsWith('.exe'));
    
    if (installerFile) {
      const filePath = path.join(outputPath, installerFile);
      const stats = await fs.stat(filePath);
      
      return {
        name: installerFile,
        path: filePath,
        size: stats.size
      };
    }
    
    return null;
  }

  /**
   * Dosya hash'lerini hesapla
   */
  async calculateFileHashes(workingPath, appName, appVersion) {
    // Mevcut koddan hash hesaplama mantığı alınacak
    const hashes = {
      appName,
      appVersion,
      timestamp: new Date().toISOString(),
      files: {},
      metadata: {
        totalFiles: 0,
        platform: 'windows',
        nodeVersion: process.version,
        buildTime: Date.now()
      }
    };
    
    // Core dosyaları hashle
    const coreFiles = [
      'index.html',
      'main.js',
      'package.json',
      'electron.js',
      'style.css',
      'app.js'
    ];
    
    for (const file of coreFiles) {
      const filePath = path.join(workingPath, file);
      if (await fs.pathExists(filePath)) {
        const hash = await this.calculateFileHash(filePath);
        if (hash) {
          const stats = await fs.stat(filePath);
          hashes.files[file] = {
            hash,
            size: stats.size,
            modified: stats.mtime.toISOString()
          };
        }
      }
    }
    
    hashes.metadata.totalFiles = Object.keys(hashes.files).length;
    return hashes;
  }

  /**
   * Değişiklikleri analiz et
   */
  analyzeChanges(existingHashes, newHashes) {
    const changedFiles = [];
    const newFiles = [];
    const deletedFiles = [];
    const unchangedFiles = [];
    
    // Yeni ve değişen dosyaları bul
    for (const [file, fileInfo] of Object.entries(newHashes.files)) {
      if (!existingHashes.files[file]) {
        newFiles.push(file);
      } else if (existingHashes.files[file].hash !== fileInfo.hash) {
        changedFiles.push(file);
      } else {
        unchangedFiles.push(file);
      }
    }
    
    // Silinen dosyaları bul
    for (const file of Object.keys(existingHashes.files)) {
      if (!newHashes.files[file]) {
        deletedFiles.push(file);
      }
    }
    
    const isIdentical = changedFiles.length === 0 && 
                       newFiles.length === 0 && 
                       deletedFiles.length === 0;
    
    return {
      isIdentical,
      changedFiles,
      newFiles,
      deletedFiles,
      unchangedFiles
    };
  }

  /**
   * Platform konfigürasyon şeması
   */
  getConfigurationSchema() {
    return {
      required: ['appName', 'appVersion', 'workingPath'],
      optional: ['logoPath', 'companyInfo'],
      platformSpecific: {
        publisherName: { type: 'string', maxLength: 100 },
        requestedExecutionLevel: { type: 'string', enum: ['asInvoker', 'requireAdministrator'] },
        oneClick: { type: 'boolean', default: true },
        createDesktopShortcut: { type: 'boolean', default: true }
      }
    };
  }
}

module.exports = WindowsPackagingService;