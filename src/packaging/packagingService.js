const { spawn } = require('cross-spawn');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const crypto = require('crypto');
const pwaConfigManager = require('../server/pwa-config-manager');

class PackagingService {
  constructor() {
    this.supportedPlatforms = ['windows', 'macos', 'linux', 'android', 'pwa'];
  }

  // Dosya hash'i hesaplama fonksiyonu
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

  // Kurulu uygulamanin dosya hash'lerini kaydetme - Gelismis versiyon
  async saveFileHashes(workingPath, appName, appVersion) {
    console.log('📊 Dosya hashleri hesaplaniyor ve kaydediliyor...');
    
    const hashesFile = path.join(workingPath, '.app-hashes.json');
    const hashes = {
      appName,
      appVersion,
      timestamp: new Date().toISOString(),
      files: {},
      metadata: {
        totalFiles: 0,
        platform: process.platform,
        nodeVersion: process.version,
        buildTime: Date.now()
      }
    };
    
    // Ana dosyalari hashle - genisletilmis liste
    const coreFiles = [
      'index.html',
      'main.js', 
      'package.json',
      'electron.js',
      'style.css',
      'app.js',
      'config.json',
      'preload.js',
      'renderer.js'
    ];
    
    // Otomatik dosya tarama - pattern bazli
    const filePatterns = {
      '.css': 'styles',
      '.js': 'scripts', 
      '.json': 'config',
      '.html': 'templates',
      '.png': 'images',
      '.jpg': 'images',
      '.jpeg': 'images',
      '.svg': 'images',
      '.ico': 'icons',
      '.woff': 'fonts',
      '.woff2': 'fonts',
      '.ttf': 'fonts'
    };
    
    const filesToHash = [...coreFiles];
    
    try {
      // Working directory'deki tum dosyalari tara
      const allFiles = await this.getAllFilesRecursively(workingPath);
      
      for (const file of allFiles) {
        const relativePath = path.relative(workingPath, file);
        const ext = path.extname(relativePath).toLowerCase();
        
        // Core files'da yoksa ve desteklenen extension ise ekle
        if (!filesToHash.includes(relativePath) && filePatterns[ext]) {
          // Temp, node_modules gibi klasorleri atla
          if (!relativePath.includes('node_modules') && 
              !relativePath.includes('temp') && 
              !relativePath.includes('.git') &&
              !relativePath.startsWith('.')) {
            filesToHash.push(relativePath);
          }
        }
      }
      
      console.log(`📁 Toplam ${filesToHash.length} dosya hash'lenecek`);
      
    } catch (error) {
      console.warn('⚠️ Dosya tarama hatasi, sadece core files kullanilacak:', error.message);
    }
    
    // Hash hesaplama
    let hashedCount = 0;
    for (const file of filesToHash) {
      const filePath = path.join(workingPath, file);
      if (await fs.pathExists(filePath)) {
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          const hash = await this.calculateFileHash(filePath);
          if (hash) {
            hashes.files[file] = {
              hash,
              size: stat.size,
              modified: stat.mtime.toISOString(),
              type: path.extname(file) || 'unknown'
            };
            hashedCount++;
          }
        }
      }
    }
    
    hashes.metadata.totalFiles = hashedCount;
    
    await fs.writeJson(hashesFile, hashes, { spaces: 2 });
    console.log(`✅ ${hashedCount} dosya hashi kaydedildi`);
    
    return hashes;
  }

  // Recursive dosya tarama yardimci fonksiyonu
  async getAllFilesRecursively(dir, files = []) {
    try {
      const items = await fs.readdir(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = await fs.stat(fullPath);
        
        if (stat.isDirectory()) {
          // Alt klasorleri tara (depth limit ile)
          if (files.length < 1000) { // Max 1000 dosya
            await this.getAllFilesRecursively(fullPath, files);
          }
        } else {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Sessizce devam et - erisim hatalarini atla
    }
    
    return files;
  }

  // Gelismis kurulum yolu tespit sistemi
  async getInstallationPath(appName, companyId = null, companyName = null) {
    const possiblePaths = [];
    
    // Platform bazli ana kurulum yollari
    if (process.platform === 'win32') {
      const companyDir = companyId ? companyId : (companyName || 'default');
      const baseDir = process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local';
      
      possiblePaths.push(
        path.join(baseDir, 'Programs', 'dijitap', companyDir, appName),
        path.join(baseDir, 'Programs', appName),
        path.join('C:\\Program Files', 'dijitap', companyDir, appName),
        path.join('C:\\Program Files (x86)', 'dijitap', companyDir, appName),
        path.join(baseDir, appName)
      );
    } else if (process.platform === 'darwin') {
      possiblePaths.push(
        path.join('/Applications', `${appName}.app`),
        path.join(process.env.HOME || '/Users/default', 'Applications', `${appName}.app`),
        path.join(process.env.HOME || '/Users/default', '.local', 'share', appName)
      );
    } else {
      // Linux
      possiblePaths.push(
        path.join(process.env.HOME || '/home/user', '.local', 'share', appName),
        path.join('/opt', appName),
        path.join('/usr', 'local', 'share', appName),
        path.join('/home', process.env.USER || 'user', '.local', 'share', appName)
      );
    }
    
    // Her yolu kontrol et ve ilk bulunan kurulum dosyasina sahip olani dondur
    for (const installPath of possiblePaths) {
      try {
        const hashFile = path.join(installPath, '.app-hashes.json');
        if (await fs.pathExists(hashFile)) {
          console.log(`✅ Kurulum bulundu: ${installPath}`);
          return installPath;
        }
      } catch (error) {
        // Devam et - bu path'e erisim yok
        continue;
      }
    }
    
    console.log('📁 Mevcut kurulum bulunamadi, yeni kurulum olacak');
    return null;
  }

  // Mevcut kurulumla karsilastirma - Gelismis versiyon
  async compareWithExistingInstallation(workingPath, appName, appVersion, companyId = null, companyName = null) {
    console.log('🔍 Mevcut kurulum ile karsilastirma yapiliyor...');
    
    const currentHashes = await this.saveFileHashes(workingPath, appName, appVersion);
    
    // Gelismis kurulum yolu tespiti
    const installPath = await this.getInstallationPath(appName, companyId, companyName);
    
    if (installPath) {
      const previousHashesFile = path.join(installPath, '.app-hashes.json');
      
      try {
        const previousHashes = await fs.readJson(previousHashesFile);
        
        console.log(`📋 Onceki kurulum bulundu: v${previousHashes.appVersion}`);
        console.log(`📍 Kurulum yeri: ${installPath}`);
        
        // Dosya farklilikkarini hesapla
        const changedFiles = [];
        const newFiles = [];
        const unchangedFiles = [];
        const deletedFiles = [];
        
        // Yeni/degisen dosyalari kontrol et
        for (const [file, hash] of Object.entries(currentHashes.files)) {
          if (previousHashes.files[file]) {
            if (previousHashes.files[file] !== hash) {
              changedFiles.push(file);
            } else {
              unchangedFiles.push(file);
            }
          } else {
            newFiles.push(file);
          }
        }
        
        // Silinen dosyalari kontrol et
        for (const file of Object.keys(previousHashes.files)) {
          if (!currentHashes.files[file]) {
            deletedFiles.push(file);
          }
        }
        
        const updateInfo = {
          hasExistingInstallation: true,
          installationPath: installPath,
          previousVersion: previousHashes.appVersion,
          currentVersion: appVersion,
          isIdentical: changedFiles.length === 0 && newFiles.length === 0 && deletedFiles.length === 0,
          changedFiles,
          newFiles,
          deletedFiles,
          unchangedFiles,
          updateType: changedFiles.length === 0 && newFiles.length === 0 && deletedFiles.length === 0 ? 'identical' : 'incremental',
          speedImprovement: '30x daha hizli' // Ortalama hesaplama
        };
        
        console.log(`🔄 Guncelleme analizi:`);
        console.log(`  - Degisen dosya: ${changedFiles.length}`);
        console.log(`  - Yeni dosya: ${newFiles.length}`);
        console.log(`  - Silinen dosya: ${deletedFiles.length}`);
        console.log(`  - Degismeyen dosya: ${unchangedFiles.length}`);
        console.log(`  - Guncelleme tipi: ${updateInfo.updateType}`);
        
        if (updateInfo.isIdentical) {
          console.log('⚡ Identical files detected - Quick launch mode!');
        }
        
        return updateInfo;
        
      } catch (error) {
        console.warn('⚠️ Onceki kurulum bilgisi okunamadi:', error.message);
      }
    }
    
    return {
      hasExistingInstallation: false,
      installationPath: null,
      updateType: 'fresh',
      isIdentical: false,
      changedFiles: [],
      newFiles: Object.keys(currentHashes.files),
      deletedFiles: [],
      unchangedFiles: [],
      speedImprovement: null
    };
  }

  // Flatpak manifest oluşturucu
  generateFlatpakManifest(appName, appVersion, companyInfo, appDescription) {
    const appId = `tr.gov.meb.${appName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const sanitizedName = this.sanitizeAppName(appName);
    
    return {
      "app-id": appId,
      "runtime": "org.freedesktop.Platform",
      "runtime-version": "22.08",
      "sdk": "org.freedesktop.Sdk",
      "command": sanitizedName,
      "finish-args": [
        "--share=ipc",
        "--socket=x11",
        "--socket=pulseaudio",
        "--device=dri",
        "--filesystem=home:ro",
        "--env=ELECTRON_IS_DEV=0"
      ],
      "modules": [{
        "name": "zypak",
        "sources": [{
          "type": "git",
          "url": "https://github.com/refi64/zypak",
          "tag": "v2022.04"
        }]
      }, {
        "name": sanitizedName,
        "buildsystem": "simple",
        "build-commands": [
          `install -Dm755 ${sanitizedName} /app/bin/${sanitizedName}`,
          `install -Dm644 ${appId}.desktop /app/share/applications/${appId}.desktop`,
          `install -Dm644 icon.png /app/share/icons/hicolor/256x256/apps/${appId}.png`,
          "install -Dm644 manifest.json /app/share/metainfo/"+ appId + ".metainfo.xml"
        ],
        "sources": [{
          "type": "dir",
          "path": "."
        }]
      }]
    };
  }

  // Flatpak .desktop dosyası oluşturucu
  generateFlatpakDesktop(appName, appVersion, companyInfo, appDescription) {
    const appId = `tr.gov.meb.${appName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const sanitizedName = this.sanitizeAppName(appName);
    
    return `[Desktop Entry]
Version=${appVersion}
Type=Application
Name=${appName}
Name[tr]=${appName}
Comment=${appDescription || appName + ' - Eğitim Uygulaması'}
Comment[tr]=${appDescription || appName + ' - Eğitim Uygulaması'}
Icon=${appId}
Exec=${sanitizedName}
Categories=Education;Teaching;Science;X-Education;
Keywords=education;eğitim;öğretim;${appName.toLowerCase()};
StartupNotify=true
StartupWMClass=${sanitizedName}
MimeType=application/x-electron;
`;
  }

  async startPackaging(jobId, jobInfo, io) {
    const { sessionId, platforms, logoId, logoPath: providedLogoPath, appName, appVersion, packageOptions, pwaConfig } = jobInfo;
    
    const results = {};
    let completedPlatforms = 0;
    const totalPlatforms = platforms.length;
    
    // Logo bilgilerini al (kurum adı ve ID için)
    let companyName = null;
    let companyId = null;
    if (logoId) {
      try {
        const logoService = require('../utils/logoService');
        const logoInfo = await logoService.getLogoById(logoId);
        if (logoInfo) {
          companyName = logoInfo.kurumAdi;
          companyId = logoInfo.kurumId;
          console.log(`📷 Yayınevi logosu kullanılacak: ${companyName} (${companyId})`);
        }
      } catch (error) {
        console.error('Logo bilgisi alınırken hata:', error);
      }
    }

    try {
      // Build klasörünü hazırla
      const buildPath = path.join('uploads', sessionId);
      const tempPath = path.join('temp', jobId);
      
      // Session directory kontrolü
      if (!await fs.pathExists(buildPath)) {
        throw new Error(`Upload session bulunamadı: ${sessionId}. Lütfen dosyaları tekrar yükleyin.`);
      }
      
      await fs.ensureDir(tempPath);

      // Build klasörünü temp'e kopyala ve Electron için hazırla
      const workingPath = path.join(tempPath, 'app');
      
      try {
        await fs.copy(buildPath, workingPath);
      } catch (copyError) {
        throw new Error(`Build dosyaları kopyalanamadı: ${copyError.message}. Session: ${sessionId}`);
      }
      
      // Electron için gerekli dosyaları oluştur
      await this.prepareElectronFiles(workingPath, appName, appVersion, companyName);

      // Logo path'i belirle - önce jobInfo'dan gelen, yoksa prepareLogo ile al
      let logoPath = providedLogoPath;
      if (!logoPath && logoId) {
        console.log('📷 Logo path jobInfo\'da yok, prepareLogo ile alınıyor...');
        logoPath = await this.prepareLogo(logoId, tempPath);
      }
      
      if (logoPath) {
        console.log(`✅ Logo kullanılacak: ${logoPath}`);
      } else {
        console.log('⚠️ Logo yok, varsayılan icon kullanılacak');
      }

      // Her platform için paketleme
      for (let i = 0; i < platforms.length; i++) {
        const platform = platforms[i];
        
        try {
          // Başlangıç durumu
          io.emit('packaging-progress', {
            jobId,
            platform,
            status: 'processing',
            progress: Math.round((i / totalPlatforms) * 100)
          });

          let result;
          switch (platform) {
            case 'windows':
              result = await this.packageWindows(workingPath, tempPath, appName, appVersion, logoPath, packageOptions, companyName, companyId, io, jobId, i, totalPlatforms);
              break;
            case 'macos':
              result = await this.packageMacOS(workingPath, tempPath, appName, appVersion, logoPath, packageOptions, io, jobId, i, totalPlatforms);
              break;
            case 'linux':
              result = await this.packageLinux(workingPath, tempPath, appName, appVersion, logoPath, packageOptions, companyName, companyId, io, jobId, i, totalPlatforms);
              break;
            case 'android':
              result = await this.packageAndroid(workingPath, tempPath, appName, appVersion, logoPath, packageOptions, io, jobId, i, totalPlatforms);
              break;
            case 'pwa':
              // PWA config'i packageOptions'a ekle
              const pwaOptions = { ...packageOptions, pwaConfig };
              result = await this.packagePWA(workingPath, tempPath, appName, appVersion, logoPath, pwaOptions, io, jobId, i, totalPlatforms);
              break;
            default:
              throw new Error(`Desteklenmeyen platform: ${platform}`);
          }

          results[platform] = {
            success: true,
            ...result
          };

          completedPlatforms++;
          
          // Platform tamamlandı - %100 progress ile
          io.emit('packaging-progress', {
            jobId,
            platform,
            status: 'completed',
            progress: Math.round(((i + 1) / totalPlatforms) * 100),
            result
          });

        } catch (error) {
          console.error(`${platform} paketleme hatası:`, error);
          results[platform] = {
            success: false,
            error: error.message
          };

          completedPlatforms++;
          
          io.emit('packaging-progress', {
            jobId,
            platform,
            status: 'failed',
            error: error.message,
            progress: Math.round(((i + 1) / totalPlatforms) * 100)
          });
        }
      }

      return results;

    } catch (error) {
      console.error('Genel paketleme hatası:', error);
      throw error;
    }
  }

  // Flatpak dosyalarını oluşturucu
  async generateFlatpakFiles(outputPath, appName, appVersion, companyInfo, appDescription) {
    try {
      // Flatpak klasörü oluştur
      const flatpakPath = path.join(outputPath, 'flatpak');
      await fs.ensureDir(flatpakPath);
      
      // Manifest dosyası oluştur
      const manifest = this.generateFlatpakManifest(appName, appVersion, companyInfo, appDescription);
      await fs.writeJson(path.join(flatpakPath, 'manifest.json'), manifest, { spaces: 2 });
      
      // Desktop dosyası oluştur
      const desktopContent = this.generateFlatpakDesktop(appName, appVersion, companyInfo, appDescription);
      const appId = `tr.gov.meb.${appName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      await fs.writeFile(path.join(flatpakPath, `${appId}.desktop`), desktopContent);
      
      // MetaInfo dosyası oluştur (Flathub için gerekli)
      const metaInfo = this.generateFlatpakMetaInfo(appName, appVersion, companyInfo, appDescription);
      await fs.writeFile(path.join(flatpakPath, `${appId}.metainfo.xml`), metaInfo);
      
      // README dosyası oluştur
      const readme = this.generateFlatpakReadme(appName, appVersion, companyInfo);
      await fs.writeFile(path.join(flatpakPath, 'FLATPAK_README.md'), readme);
      
      console.log('Flatpak dosyaları oluşturuldu:', flatpakPath);
      
      // Flatpak klasörünü ZIP'le
      console.log('🔄 Flatpak klasörü ZIPleniyor...');
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      
      // Flatpak klasöründeki tüm dosyaları ZIP'e ekle
      const files = await fs.readdir(flatpakPath);
      for (const file of files) {
        const filePath = path.join(flatpakPath, file);
        const stat = await fs.stat(filePath);
        
        if (stat.isFile()) {
          zip.addLocalFile(filePath);
        }
      }
      
      // ZIP dosyasını oluştur
      const zipFileName = `${appName.replace(/\s+/g, '-')}-${appVersion}-flatpak.zip`;
      const zipPath = path.join(outputPath, zipFileName);
      zip.writeZip(zipPath);
      
      console.log(`✅ Flatpak ZIP oluşturuldu: ${zipFileName}`);
      
      // Orijinal flatpak klasörünü sil
      await fs.remove(flatpakPath);
      console.log('🗑️ Flatpak klasörü silindi (ZIP oluşturuldu)');
      
    } catch (error) {
      console.error('Flatpak dosyaları oluşturulurken hata:', error);
      console.error('Stack:', error.stack);
    }
  }

  // Flatpak MetaInfo dosyası oluşturucu
  generateFlatpakMetaInfo(appName, appVersion, companyInfo, appDescription) {
    const appId = `tr.gov.meb.${appName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>
  <name>${appName}</name>
  <summary>${appDescription || appName + ' - Eğitim Uygulaması'}</summary>
  <description>
    <p>
      ${appDescription || appName + ' - ' + companyInfo + ' tarafından hazırlanan eğitim amaçlı interaktif uygulama.'}
    </p>
    <p>
      Bu uygulama Electron teknolojisi ile geliştirilmiş olup, modern web teknolojilerini masaüstü uygulaması olarak sunar.
    </p>
  </description>
  <launchable type="desktop-id">${appId}.desktop</launchable>
  <screenshots>
    <screenshot type="default">
      <image>https://via.placeholder.com/800x600/667eea/ffffff?text=${encodeURIComponent(appName)}</image>
    </screenshot>
  </screenshots>
  <categories>
    <category>Education</category>
    <category>Teaching</category>
  </categories>
  <keywords>
    <keyword>education</keyword>
    <keyword>eğitim</keyword>
    <keyword>öğretim</keyword>
    <keyword>electron</keyword>
  </keywords>
  <content_rating type="oars-1.1" />
  <releases>
    <release version="${appVersion}" date="${new Date().toISOString().split('T')[0]}">
      <description>
        <p>Pardus Yazılım Merkezi için hazırlanan sürüm.</p>
      </description>
    </release>
  </releases>
  <developer_name>${companyInfo}</developer_name>
  <update_contact>support@${companyInfo.toLowerCase().replace(/[^a-z0-9]/g, '')}.com</update_contact>
</component>`;
  }

  // Flatpak README oluşturucu
  generateFlatpakReadme(appName, appVersion, companyInfo) {
    const appId = `tr.gov.meb.${appName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    
    return `# ${appName} - Flatpak Paket Rehberi

## 📦 Pardus Yazılım Merkezi İçin Hazırlanmış

### Uygulama Bilgileri
- **Ad**: ${appName}
- **Versiyon**: ${appVersion}
- **Geliştirici**: ${companyInfo}
- **App ID**: ${appId}
- **Kategori**: Eğitim

### Kurulum

#### Pardus'ta:
\`\`\`bash
# Flatpak kurulu değilse
sudo apt install flatpak gnome-software-plugin-flatpak

# Flathub deposunu ekle
flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo

# Uygulamayı kur (Flathub'da yayınlandıktan sonra)
flatpak install flathub ${appId}
\`\`\`

#### Grafik Arayüzle:
1. **Pardus Yazılım Merkezi**'ni açın
2. **"${appName}"** arayın
3. **"Kur"** butonuna tıklayın
4. **Yönetici şifresi gerektirmez!**

### Geliştiriciler İçin

#### Local Test:
\`\`\`bash
# Build dependencies
flatpak install flathub org.freedesktop.Platform//22.08
flatpak install flathub org.freedesktop.Sdk//22.08

# Build
flatpak-builder build-dir manifest.json

# Test
flatpak-builder --run build-dir manifest.json ${appName.toLowerCase()}
\`\`\`

#### Flathub'a Gönderme:
1. Fork: https://github.com/flathub/flathub
2. Bu dosyaları ${appId} klasörüne kopyala
3. Pull request gönder

### Dosya Yapısı
- \`manifest.json\` - Ana Flatpak manifest
- \`${appId}.desktop\` - Desktop entry
- \`${appId}.metainfo.xml\` - Uygulama metadatası
- \`FLATPAK_README.md\` - Bu dosya

### Yardım
- **Flatpak Docs**: https://docs.flatpak.org/
- **Flathub Docs**: https://docs.flathub.org/
- **Pardus Wiki**: https://wiki.pardus.org.tr/

---

**Not**: Bu dosyalar Electron Paketleyici tarafından otomatik oluşturulmuştur.
`;
  }
  async prepareLogo(logoId, tempPath) {
    const logoService = require('../utils/logoService');
    const logoInfo = await logoService.getLogoById(logoId);
    
    if (!logoInfo) {
      throw new Error('Logo bulunamadı');
    }

    const logoDestPath = path.join(tempPath, 'logo' + path.extname(logoInfo.filePath));
    await fs.copy(logoInfo.filePath, logoDestPath);
    
    return logoDestPath;
  }

  async prepareElectronFiles(appPath, appName, appVersion, companyName = null) {
    // App name'i sanitize et - Electron Builder için
    const sanitizedAppName = this.sanitizeAppName(appName);
    
    // Pencere başlığını oluştur
    const windowTitle = companyName ? `${appName} - ${companyName}` : appName;
    
    console.log(`App name sanitized: "${appName}" -> "${sanitizedAppName}"`);
    console.log(`Window title: "${windowTitle}"`);
    
    // Versiyon numarasını semver formatına çevir (2.0 -> 2.0.0)
    const normalizedVersion = this.normalizeSemver(appVersion);
    
    // package.json oluştur (her zaman üzerine yaz)
    const packageJson = {
      name: sanitizedAppName,
      version: normalizedVersion,
      description: `${appName} - Electron Uygulaması`,
      main: "main.js",
      author: {
        name: "Generated by Electron Packager",
        email: "contact@example.com"
      },
      homepage: "https://example.com",
      repository: {
        type: "git",
        url: "https://github.com/example/example.git"
      },
      scripts: {
        start: "electron ."
      },
      dependencies: {},
      devDependencies: {
        electron: "^27.0.0"
      }
    };

    await fs.writeJson(path.join(appPath, 'package.json'), packageJson, { spaces: 2 });
    console.log('package.json oluşturuldu:', path.join(appPath, 'package.json'));
    
    // Install electron dependencies to prevent version detection errors
    console.log('Electron bağımlılıkları yükleniyor...');
    try {
      const { spawn } = require('child_process');
      await new Promise((resolve, reject) => {
        const child = spawn('npm', ['install', '--only=dev'], {
          cwd: appPath,
          stdio: 'pipe',
          shell: true
        });
        
        child.stdout.on('data', (data) => {
          console.log('NPM:', data.toString().trim());
        });
        
        child.stderr.on('data', (data) => {
          console.error('NPM Error:', data.toString().trim());
        });
        
        child.on('close', (code) => {
          if (code === 0) {
            console.log('✅ Electron bağımlılıkları yüklendi');
            resolve();
          } else {
            console.warn('⚠️ Electron bağımlılık yüklemesi başarısız, devam ediliyor...');
            resolve(); // Don't fail the entire process
          }
        });
        
        child.on('error', () => {
          console.warn('⚠️ NPM bulunamadı, bağımlılık yüklemesi atlanıyor...');
          resolve(); // Don't fail the entire process
        });
      });
    } catch (error) {
      console.warn('⚠️ Electron bağımlılık yüklemesi atlandı:', error.message);
    }

    // Ana main.js dosyası oluştur (eğer yoksa ve electron.js da yoksa)
    const mainJsPath = path.join(appPath, 'main.js');
    const electronJsPath = path.join(appPath, 'electron.js');
    
    // Eğer electron.js varsa onu main.js olarak kopyala
    if (await fs.pathExists(electronJsPath) && !await fs.pathExists(mainJsPath)) {
      await fs.copy(electronJsPath, mainJsPath);
      console.log('electron.js dosyası main.js olarak kopyalandı');
    } else if (!await fs.pathExists(mainJsPath)) {
      const mainJsContent = `
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '${windowTitle}',
    fullscreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Ana menüyü devre dışı bırak
  Menu.setApplicationMenu(null);

  // AppImage için kurulum bildirim dialog'ı
  if (process.env.APPIMAGE) {
    const { dialog } = require('electron');
    setTimeout(() => {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '${appName} - Başarıyla Yüklendi',
        message: 'Kurulum tamamlandı! Uygulama şimdi çalışıyor.',
        detail: 'Bu uygulama ' + (companyName || 'Bilinmeyen Kurum') + ' tarafından hazırlanmıştır.\n\nAppImage formatı sayesinde yönetici şifresi gerekmedi.',
        buttons: ['Tamam']
      });
    }, 1000);
  }

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

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
      `;
      
      await fs.writeFile(mainJsPath, mainJsContent.trim());
    } else {
      // Mevcut main.js dosyasında title'ı güncelle
      try {
        let mainJsContent = await fs.readFile(mainJsPath, 'utf8');
        
        // Title satırını bul ve güncelle
        const titleRegex = /title:\s*['"`].*?['"`]/;
        if (titleRegex.test(mainJsContent)) {
          mainJsContent = mainJsContent.replace(titleRegex, `title: '${windowTitle}'`);
        }
        
        // Fullscreen ekle (eğer yoksa)
        if (!mainJsContent.includes('fullscreen:')) {
          const browserWindowRegex = /(new BrowserWindow\(\{[^}]*)(\}\))/s;
          const match = mainJsContent.match(browserWindowRegex);
          if (match) {
            const updatedConstructor = match[1] + `,\n    fullscreen: true`;
            mainJsContent = mainJsContent.replace(browserWindowRegex, updatedConstructor + match[2]);
          }
        } else {
          // Fullscreen değerini true yap (eğer false ise)
          mainJsContent = mainJsContent.replace(/fullscreen:\s*false/g, 'fullscreen: true');
        }
        
        // Menu import ekle (eğer yoksa)
        if (!mainJsContent.includes('Menu')) {
          mainJsContent = mainJsContent.replace(
            "const { app, BrowserWindow } = require('electron');",
            "const { app, BrowserWindow, Menu } = require('electron');"
          );
        }
        
        // Menu.setApplicationMenu(null) ekle (eğer yoksa)
        if (!mainJsContent.includes('Menu.setApplicationMenu(null)')) {
          // createWindow fonksiyonu içinde loadFile'dan sonra ekle
          const loadFileRegex = /(mainWindow\.loadFile\([^)]+\);)/;
          const match2 = mainJsContent.match(loadFileRegex);
          if (match2) {
            const updatedLoadFile = match2[1] + `\n\n  // Ana menüyü devre dışı bırak\n  Menu.setApplicationMenu(null);`;
            mainJsContent = mainJsContent.replace(loadFileRegex, updatedLoadFile);
          }
        }
        
        // PARDUS UYUMLULUĞU: --no-sandbox parametresi ekle
        // Environment variable kullanarak sandbox'ı devre dışı bırak
        if (!mainJsContent.includes('ELECTRON_DISABLE_SANDBOX')) {
          // app.disableHardwareAcceleration() ve environment check ekle
          const appReadyRegex = /(app\.whenReady\(\))/;
          if (appReadyRegex.test(mainJsContent)) {
            const sandboxCode = `// Pardus uyumluluğu için sandbox devre dışı
// Environment variable ile kontrol
if (process.env.ELECTRON_DISABLE_SANDBOX !== 'false') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
}

`;
            mainJsContent = mainJsContent.replace(appReadyRegex, sandboxCode + '$1');
          }
        }
        
        await fs.writeFile(mainJsPath, mainJsContent);
        console.log('main.js güncellendi - title, fullscreen, menu ve sandbox ayarları uygulandı:', windowTitle);
      } catch (error) {
        console.error('main.js güncellenirken hata:', error);
      }
    }
    
    // Varsayılan icon dosyalarını kontrol et ve eksikse oluştur
    await this.ensureDefaultIcons(appPath);
    
    // Splash screen ekle (şimdilik devre dışı - test için)
    // await this.addSplashScreen(appPath, appName, companyName);
    console.log('⚠️ Splash screen şimdilik devre dışı (Pardus test için)');
  }
  
  async customizeAppImage(outputPath, appName, appVersion, publisherName, publisherId, logoPath) {
    try {
      console.log('🎨 Özel AppImage oluşturuluyor...');
      
      // macOS'ta AppImage extract edilemez, atla (Docker kullanılmıyorsa)
      if (process.platform === 'darwin' && !process.env.FORCE_LINUX_PACKAGING) {
        console.warn('⚠️ macOS\'ta AppImage özelleştirme desteklenmiyor');
        console.log('ℹ️ Standart AppImage kullanılacak');
        console.log('💡 Docker ile paketlerseniz özel AppRun ve .impark eklenecek:');
        console.log('   ./docker-linux-package.sh');
        return;
      }
      
      // AppImage dosyasını bul
      const files = await fs.readdir(outputPath);
      const appImageFile = files.find(f => f.endsWith('.AppImage'));
      
      if (!appImageFile) {
        console.warn('⚠️ AppImage bulunamadı, özelleştirme atlanıyor');
        return;
      }
      
      const appImagePath = path.resolve(outputPath, appImageFile);
      const extractDir = path.resolve(outputPath, 'squashfs-root');
      
      console.log('📦 AppImage extract ediliyor:', appImageFile);
      console.log('  Path:', appImagePath);
      
      // Execute izni ver
      await fs.chmod(appImagePath, 0o755);
      
      // 1. AppImage'ı extract et
      await new Promise((resolve, reject) => {
        const extract = require('child_process').spawn(appImagePath, ['--appimage-extract'], {
          cwd: path.resolve(outputPath),
          stdio: 'pipe'
        });
        
        let output = '';
        extract.stdout.on('data', data => output += data.toString());
        extract.stderr.on('data', data => output += data.toString());
        
        extract.on('close', code => {
          if (code === 0) {
            console.log('✅ Extract tamamlandı');
            resolve();
          } else {
            console.error('❌ Extract hatası:', output);
            reject(new Error(`Extract failed: ${code}`));
          }
        });
      });
      
      // 2. Özel AppRun script'ini oluştur
      console.log('📝 Özel AppRun oluşturuluyor...');
      
      const appRunTemplatePath = path.join(__dirname, 'apprun-template.sh');
      let appRunContent = await fs.readFile(appRunTemplatePath, 'utf8');
      
      // Template değişkenlerini değiştir
      appRunContent = appRunContent
        .replace(/\{\{APP_NAME\}\}/g, appName)
        .replace(/\{\{APP_VERSION\}\}/g, appVersion)
        .replace(/\{\{PUBLISHER_NAME\}\}/g, publisherName || 'DijiTap')
        .replace(/\{\{PUBLISHER_ID\}\}/g, publisherId || '');
      
      // AppRun'ı kaydet
      const appRunPath = path.join(extractDir, 'AppRun');
      await fs.writeFile(appRunPath, appRunContent);
      await fs.chmod(appRunPath, 0o755);
      console.log('✅ Özel AppRun kaydedildi');
      
      // 3. Logo'yu kopyala (eğer varsa)
      if (logoPath && await fs.pathExists(logoPath)) {
        const logoDestPath = path.join(extractDir, 'logo.png');
        await fs.copy(logoPath, logoDestPath);
        console.log('✅ Logo kopyalandı');
      }
      
      // 4. appimagetool ile yeniden paketle
      console.log('📦 Yeniden paketleniyor...');
      
      // appimagetool'u indir (eğer yoksa)
      // path.resolve (path.join DEĞİL): outputPath relatif olabilir; spawn relatif komut
      // yolunu cwd'ye göre çözmeye çalışıp ENOENT verir. Absolute yol şart (extract adımıyla aynı).
      const appimagetoolPath = path.resolve(outputPath, 'appimagetool-x86_64.AppImage');
      if (!await fs.pathExists(appimagetoolPath)) {
        console.log('⬇️ appimagetool indiriliyor...');
        const https = require('https');
        const file = fs.createWriteStream(appimagetoolPath);
        
        await new Promise((resolve, reject) => {
          https.get('https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage', (response) => {
            response.pipe(file);
            file.on('finish', async () => {
              file.close();
              await fs.chmod(appimagetoolPath, 0o755); // await: spawn'dan önce executable olmalı (yarış önle)
              resolve();
            });
          }).on('error', reject);
        });
      }
      
      // Yeni AppImage oluştur (.impark uzantısı ile)
      const imparkName = `${appName.replace(/\s+/g, '-')}-${appVersion}.impark`;
      const imparkPath = path.resolve(outputPath, imparkName);
      
      await new Promise((resolve, reject) => {
        // APPIMAGE_EXTRACT_AND_RUN: appimagetool kendisi bir AppImage; sunucuda/CI'da FUSE
        // mount edilemediğinde kendini extract edip çalışır (FUSE bağımlılığını kaldırır).
        const pack = require('child_process').spawn(appimagetoolPath, [extractDir, imparkPath], {
          cwd: path.resolve(outputPath),
          stdio: 'pipe',
          env: { ...process.env, ARCH: 'x86_64', APPIMAGE_EXTRACT_AND_RUN: '1' }
        });

        let output = '';
        pack.stdout.on('data', data => output += data.toString());
        pack.stderr.on('data', data => output += data.toString());

        // 'error' handler ŞART: yoksa spawn hatası (EACCES/ENOEXEC) unhandled event olarak
        // tüm packager-service process'ini çökertir (in-memory job map kaybolur → 404).
        pack.on('error', err => {
          console.error('❌ appimagetool spawn hatası:', err.message);
          reject(err);
        });

        pack.on('close', code => {
          if (code === 0) {
            console.log('✅ .impark dosyası oluşturuldu');
            resolve();
          } else {
            console.error('❌ Paketleme hatası:', output);
            reject(new Error(`Pack failed: ${code}`));
          }
        });
      });
      
      // 5. Eski AppImage'ı sil, extract klasörünü temizle
      await fs.remove(appImagePath);
      await fs.remove(extractDir);
      await fs.remove(appimagetoolPath);
      
      console.log('✅ Özel AppImage oluşturuldu:', imparkName);
      
    } catch (error) {
      console.error('❌ AppImage özelleştirme hatası:', error);
      console.warn('⚠️ Standart AppImage kullanılacak');
      // Hata olsa bile devam et
    }
  }
  
  async addSplashScreen(appPath, appName, companyName) {
    try {
      console.log('🎨 Splash screen ekleniyor...');
      
      // Splash screen HTML dosyasını oluştur
      const splashTemplatePath = path.join(__dirname, 'splash-screen-template.html');
      console.log('  📂 Template yolu:', splashTemplatePath);
      
      if (!await fs.pathExists(splashTemplatePath)) {
        console.warn('  ⚠️ Splash template bulunamadı, atlanıyor');
        return;
      }
      
      let splashContent = await fs.readFile(splashTemplatePath, 'utf8');
      
      // Template değişkenlerini değiştir
      splashContent = splashContent.replace(/\{\{APP_NAME\}\}/g, appName);
      splashContent = splashContent.replace(/\{\{COMPANY_NAME\}\}/g, companyName || 'Eğitim Uygulaması');
      
      // Splash screen dosyasını kaydet
      const splashPath = path.join(appPath, 'splash.html');
      await fs.writeFile(splashPath, splashContent);
      console.log('✅ Splash screen oluşturuldu:', splashPath);
      
      // main.js'i modifiye et - splash screen ekle
      const mainJsPath = path.join(appPath, 'main.js');
      if (await fs.pathExists(mainJsPath)) {
        let mainJsContent = await fs.readFile(mainJsPath, 'utf8');
        
        // Splash screen kodunu ekle
        const splashCode = `
// Splash Screen
let splashWindow = null;

function createSplashScreen() {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 350,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  
  splashWindow.loadFile('splash.html');
  splashWindow.setIgnoreMouseEvents(true);
}

function closeSplashScreen() {
  if (splashWindow) {
    splashWindow.close();
    splashWindow = null;
  }
}
`;
        
        // BrowserWindow import'una splash ekle
        if (!mainJsContent.includes('let splashWindow')) {
          // createWindow fonksiyonundan önce splash kodunu ekle
          const createWindowRegex = /(function createWindow\(\)|const createWindow = \(\) =>)/;
          if (mainJsContent.match(createWindowRegex)) {
            mainJsContent = mainJsContent.replace(createWindowRegex, splashCode + '\n$1');
          }
        }
        
        // app.whenReady() içinde splash'ı çağır
        if (!mainJsContent.includes('createSplashScreen()')) {
          mainJsContent = mainJsContent.replace(
            /app\.whenReady\(\)\.then\(createWindow\)/,
            `app.whenReady().then(() => {
  createSplashScreen();
  
  // Ana pencereyi 2 saniye sonra aç
  setTimeout(() => {
    createWindow();
    
    // Ana pencere hazır olunca splash'ı kapat
    setTimeout(() => {
      closeSplashScreen();
    }, 1000);
  }, 2000);
})`
          );
        }
        
        await fs.writeFile(mainJsPath, mainJsContent);
        console.log('✅ main.js splash screen ile güncellendi');
      }
      
    } catch (error) {
      console.warn('⚠️ Splash screen eklenemedi:', error.message);
      // Splash screen eklenemese bile paketleme devam etsin
    }
  }

  async ensureDefaultIcons(appPath) {
    // Basit 256x256 PNG icon oluştur (eğer yoksa)
    const iconPath = path.join(appPath, 'ico.png');
    
    if (!await fs.pathExists(iconPath)) {
      console.log('Varsayılan icon oluşturuluyor...');
      
      // Simple SVG to PNG conversion için canvas kullanabiliriz
      // Şimdilik basit bir placeholder oluşturalm
      const sharp = require('sharp');
      
      try {
        // 256x256 mavi bir kare oluştur
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
        
        console.log('Varsayılan icon oluşturuldu:', iconPath);
      } catch (error) {
        console.warn('Icon oluşturulamadı, varsayılanı kullanılacak:', error.message);
      }
    }
  }

  async getValidLinuxIcon(workingPath, logoPath) {
    const sharp = require('sharp');
    
    // Kullanılacak icon dosyasını belirle
    let iconToCheck = logoPath || path.join(workingPath, 'ico.png');
    
    try {
      if (!await fs.pathExists(iconToCheck)) {
        console.log('Icon dosyası bulunamadı, varsayılan oluşturuluyor:', iconToCheck);
        iconToCheck = path.join(workingPath, 'ico.png');
        await this.ensureDefaultIcons(workingPath);
      }
      
      // Icon boyutunu kontrol et
      const metadata = await sharp(iconToCheck).metadata();
      
      if (metadata.width < 256 || metadata.height < 256) {
        console.log(`Icon boyutu uygun değil (${metadata.width}x${metadata.height}), 256x256'ya yeniden boyutlandırılıyor...`);
        
        const resizedIconPath = path.join(workingPath, 'ico-resized.png');
        
        await sharp(iconToCheck)
          .resize(256, 256, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 0 }
          })
          .png()
          .toFile(resizedIconPath);
          
        return resizedIconPath;
      }
      
      return iconToCheck;
      
    } catch (error) {
      console.error('Icon işleme hatası:', error);
      // Fallback: varsayılan icon oluştur
      await this.ensureDefaultIcons(workingPath);
      return path.join(workingPath, 'ico.png');
    }
  }

  async getValidWindowsIcon(workingPath, logoPath) {
    console.log('🖼️ Windows icon hazırlanıyor...');
    const sharp = require('sharp');
    const toIco = require('to-ico');
    
    try {
      let sourceLogo = logoPath;
      
      // Logo yoksa images klasöründen bul
      if (!sourceLogo || !await fs.pathExists(sourceLogo)) {
        const logoPngPath = path.join(workingPath, 'images', 'logo.png');
        if (await fs.pathExists(logoPngPath)) {
          sourceLogo = logoPngPath;
        }
      }
      
      // Hala logo yoksa null dön
      if (!sourceLogo || !await fs.pathExists(sourceLogo)) {
        console.log('📝 Logo bulunamadı, default icon kullanılacak');
        return null;
      }
      
      console.log(`✅ Logo bulundu: ${sourceLogo}`);
      
      // ICO dosyası oluştur (256x256, 128x128, 64x64, 48x48, 32x32, 16x16)
      const icoPath = path.join(workingPath, 'build', 'icon.ico');
      await fs.ensureDir(path.dirname(icoPath));
      
      try {
        // Farklı boyutlarda PNG'ler oluştur
        const sizes = [256, 128, 64, 48, 32, 16];
        const pngBuffers = [];
        
        for (const size of sizes) {
          const buffer = await sharp(sourceLogo)
            .resize(size, size, {
              fit: 'contain',
              background: { r: 255, g: 255, b: 255, alpha: 0 }
            })
            .png()
            .toBuffer();
          pngBuffers.push(buffer);
        }
        
        // ICO dosyası oluştur
        const icoBuffer = await toIco(pngBuffers);
        await fs.writeFile(icoPath, icoBuffer);
        
        console.log(`✅ ICO dosyası oluşturuldu: ${icoPath}`);
        return icoPath;
      } catch (icoError) {
        console.warn('⚠️ ICO oluşturulamadı, PNG kullanılacak:', icoError.message);
        // ICO oluşturulamazsa PNG'yi döndür
        return sourceLogo;
      }
      
    } catch (error) {
      console.warn('⚠️ Windows icon oluşturma hatası:', error.message);
      return null;
    }
  }

  async getValidMacIcon(workingPath, logoPath) {
    const sharp = require('sharp');
    
    // Kullanılacak icon dosyasını belirle
    let iconToCheck = logoPath || path.join(workingPath, 'ico.png');
    
    try {
      if (!await fs.pathExists(iconToCheck)) {
        console.log('macOS icon bulunamadı, varsayılan oluşturuluyor');
        iconToCheck = path.join(workingPath, 'ico.png');
        await this.ensureDefaultIcons(workingPath);
      }
      
      // Icon boyutunu kontrol et
      const metadata = await sharp(iconToCheck).metadata();
      
      if (metadata.width < 512 || metadata.height < 512) {
        console.log(`macOS icon boyutu uygun değil (${metadata.width}x${metadata.height}), 512x512'ye boyutlandırılıyor...`);
        
        const resizedIconPath = path.join(workingPath, 'ico-macos.png');
        
        await sharp(iconToCheck)
          .resize(512, 512, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 0 }
          })
          .png()
          .toFile(resizedIconPath);
          
        return resizedIconPath;
      }
      
      return iconToCheck;
      
    } catch (error) {
      console.error('macOS icon işleme hatası:', error);
      await this.ensureDefaultIcons(workingPath);
      return path.join(workingPath, 'ico.png');
    }
  }

  /**
   * Windows platform paketleme - Dijitap kurum yapısıyla
   * 
   * Kurulum dizini: dijitap\\{companyId || companyName}\\{appName}
   * Örnek: dijitap\\60\\Interactive Software
   * 
   * - Company ID tercih edilir (daha kısa path için)
   * - Windows 255 karakter path limiti için optimizasyon
   * - Program Files altında kurulum yapılır
   * - Tüm uygulamalar tam ekran başlar
   */
  async packageWindows(workingPath, tempPath, appName, appVersion, logoPath, options, companyName = null, companyId = null, io = null, jobId = null, platformIndex = 0, totalPlatforms = 1) {
    console.log('Windows paketleme basliyor...');
    
    const outputPath = path.join(tempPath, 'windows');
    await fs.ensureDir(outputPath);

    // Progress update: 10% - Mevcut kurulum kontrol ediliyor
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'windows',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.1) / totalPlatforms) * 100),
        message: 'Mevcut kurulum kontrol ediliyor...'
      });
    }

    // Mevcut kurulumla karsilastir - gelismis analiz
    const updateInfo = await this.compareWithExistingInstallation(workingPath, appName, appVersion, companyId, companyName);
    
    if (updateInfo.isIdentical) {
      console.log('\u2705 Uygulama zaten guncel! Hizla aciliyor...');
      
      if (io && jobId) {
        io.emit('packaging-progress', {
          jobId,
          platform: 'windows',
          status: 'completed',
          progress: 100,
          message: 'Uygulama zaten guncel - hizla aciliyor!',
          updateType: 'identical'
        });
      }
      
      return {
        platform: 'windows',
        filename: 'Uygulama Guncel - Direkt Aciliyor',
        path: null,
        size: 0,
        type: 'quick-launch',
        updateInfo
      };
    }

    // Progress update: 25%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'windows',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.25) / totalPlatforms) * 100),
        message: updateInfo.hasExistingInstallation ? 
          `Guncelleme hazirlaniyor (${updateInfo.changedFiles.length + updateInfo.newFiles.length} dosya)...` :
          'Icon hazirlaniyor...'
      });
    }

    const validIcon = await this.getValidWindowsIcon(workingPath, logoPath);

    // Kurulum dizini için company bilgisini hazırla
    const companyDir = companyId ? companyId : (companyName || 'default');
    const installDir = `dijitap\\${companyDir}\\${appName}`;
    
    console.log(`Windows kurulum dizini: ${installDir}`);
    console.log(`Company Name: ${companyName}, Company ID: ${companyId}`);
    
    // Electron Builder config oluştur
    const config = {
      appId: `com.${appName.toLowerCase().replace(/\s+/g, '')}.app`,
      productName: appName,
      buildVersion: appVersion,
      generateUpdatesFilesForAllChannels: false, // Update info oluşturma
      publish: {
        provider: "generic",
        url: "https://example.com"
      },
      directories: {
        app: path.resolve(workingPath), // Mutlak yol kullan
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
        icon: validIcon ? path.resolve(validIcon) : undefined, // ICO dosyası (mutlak yol)
        publisherName: options.publisherName || "Dijitap",
        requestedExecutionLevel: "asInvoker"
      },
      nsis: {
        oneClick: true, // Tek tıklamayla otomatik kurulum
        allowElevation: true, // Yönetici izinlerini otomatik al
        allowToChangeInstallationDirectory: false, // Kullanıcı dizin seçemez
        createDesktopShortcut: true, // Masaüstü kısayolu otomatik oluştur
        createStartMenuShortcut: true, // Başlat menüsü kısayolu
        runAfterFinish: true, // Kurulum sonrası otomatik çalıştır
        shortcutName: appName,
        displayLanguageSelector: false,
        language: "1055", // Türkçe
        installerLanguages: ["tr_TR"],
        uninstallDisplayName: appName + " Kaldır",
        menuCategory: "Education",
        artifactName: `\${productName}-\${version}-Setup.\${ext}`,
        perMachine: false,
        include: path.resolve(workingPath, "build/installer.nsh"),
        installerIcon: validIcon ? path.resolve(validIcon) : undefined,
        uninstallerIcon: validIcon ? path.resolve(validIcon) : undefined,
        installerHeader: path.resolve(workingPath, "build/installerHeader.bmp"),
        installerSidebar: path.resolve(workingPath, "build/installerSidebar.bmp")
      }
    };

    // Config dosyasını yaz
    const configPath = path.join(tempPath, 'electron-builder-win.json');
    await fs.writeJson(configPath, config, { spaces: 2 });
    
    // Özel kurulum animasyonu için NSIS script ve build dizini oluştur  
    // Şimdilik basit mesajlar ile - gelecekte geliştirilecek
    await this.createCustomInstallationFiles(workingPath, appName, companyName, logoPath, updateInfo);
    
    // Hata ayıklama için package.json kontrolü
    const packageJsonPath = path.join(workingPath, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      console.log('📄 Package.json kontrolü:');
      console.log(`  - Name: ${packageJson.name}`);
      console.log(`  - Version: ${packageJson.version}`);
      console.log(`  - Main: ${packageJson.main}`);
      console.log(`  - Author: ${JSON.stringify(packageJson.author)}`);
      console.log(`  - DevDependencies: ${Object.keys(packageJson.devDependencies || {}).join(', ')}`);
    } else {
      console.warn('⚠️ package.json dosyası bulunamadı!');
    }

    // Progress update: 50%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'windows',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.5) / totalPlatforms) * 100),
        message: 'Electron Builder çalıştırılıyor...'
      });
    }

    // Electron Builder'ı çalıştır
    await this.runElectronBuilder(configPath, 'win', outputPath);

    // Progress update: 90%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'windows',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.9) / totalPlatforms) * 100),
        message: 'Dosya kontrolü yapılıyor...'
      });
    }

    // Çıktı dosyasını bul - output path'te değil, app/temp içinde olabilir
    let files = [];
    if (await fs.pathExists(outputPath)) {
      files = await fs.readdir(outputPath);
    }
    
    // Eğer output path'te yoksa, temp dizinine bak
    if (files.length === 0) {
      const tempOutputPath = path.join(workingPath, 'temp', path.basename(tempPath), 'windows');
      if (await fs.pathExists(tempOutputPath)) {
        files = await fs.readdir(tempOutputPath);
        console.log(`📁 Installer dosyaları temp dizininde bulundu: ${tempOutputPath}`);
        // Dosyayı asıl output dizinine taşı
        for (const file of files) {
          if (file.endsWith('.exe')) {
            const sourcePath = path.join(tempOutputPath, file);
            const destPath = path.join(outputPath, file);
            await fs.move(sourcePath, destPath);
            console.log(`📋 Installer taşındı: ${destPath}`);
          }
        }
        files = await fs.readdir(outputPath);
      }
    }
    const installerFile = files.find(file => file.endsWith('.exe'));

    if (!installerFile) {
      throw new Error('Windows installer oluşturulamadı');
    }

    return {
      platform: 'windows',
      filename: installerFile,
      path: path.join(outputPath, installerFile),
      size: (await fs.stat(path.join(outputPath, installerFile))).size,
      type: 'installer'
    };
  }

  async packageMacOS(workingPath, tempPath, appName, appVersion, logoPath, options, io = null, jobId = null, platformIndex = 0, totalPlatforms = 1) {
    console.log('macOS paketleme başlıyor...');
    
    const outputPath = path.join(tempPath, 'macos');
    await fs.ensureDir(outputPath);

    // Progress update: 25%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'macos',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.25) / totalPlatforms) * 100),
        message: 'macOS icon hazırlanıyor...'
      });
    }

    const validIcon = await this.getValidMacIcon(workingPath, logoPath);
    const normalizedVersion = this.normalizeSemver(appVersion);

    const config = {
      appId: `com.${appName.toLowerCase().replace(/\s+/g, '')}.app`,
      productName: appName,
      directories: {
        app: path.resolve(workingPath),
        output: outputPath
      },
      files: [
        "**/*",
        "!node_modules",
        "!temp",
        "!uploads"
      ],
      mac: {
        target: {
          target: "dmg",
          arch: ["universal"]  // Universal Binary - hem Intel hem Apple Silicon
        },
        icon: validIcon ? path.resolve(validIcon) : undefined,
        category: "public.app-category.education", // Eğitim kategorisi
        hardenedRuntime: false,
        gatekeeperAssess: false,
        identity: null  // Signing'i devre dışı bırak
      },
      dmg: {
        title: `${appName} ${appVersion}`,
        icon: validIcon ? path.resolve(validIcon) : undefined
      }
    };

    const configPath = path.join(tempPath, 'electron-builder-mac.json');
    await fs.writeJson(configPath, config, { spaces: 2 });

    // Progress update: 50%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'macos',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.5) / totalPlatforms) * 100),
        message: 'DMG oluşturuluyor...'
      });
    }

    try {
      await this.runElectronBuilder(configPath, 'mac', outputPath);
    } catch (error) {
      console.error('❌ macOS paketleme başarısız:', error);
      if (io && jobId) {
        io.emit('packaging-progress', {
          jobId,
          platform: 'macos',
          status: 'failed',
          progress: Math.round(((platformIndex + 0.5) / totalPlatforms) * 100),
          message: `macOS paketleme hatası: ${error.message}`
        });
      }
      throw error;
    }

    // Progress update: 90%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'macos',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.9) / totalPlatforms) * 100),
        message: 'DMG dosyası kontrol ediliyor...'
      });
    }

    // DMG dosyasını bul - outputPath veya tempPath/macos içinde olabilir
    const glob = require('glob');
    const dmgFiles = glob.sync(path.join(tempPath, '**/*.dmg'));
    
    if (dmgFiles.length === 0) {
      throw new Error('macOS DMG oluşturulamadı');
    }
    
    // En son oluşturulan DMG'yi al
    const dmgFile = dmgFiles[0];
    const dmgFilename = path.basename(dmgFile);

    // DMG'yi outputPath'e taşı
    const finalDmgPath = path.join(outputPath, dmgFilename);
    await fs.copy(dmgFile, finalDmgPath);

    const dmgStats = await fs.stat(finalDmgPath);
    if (dmgStats.size === 0) {
      throw new Error('macOS DMG dosyası boş oluşturuldu');
    }

    console.log(`✅ DMG dosyası taşındı: ${finalDmgPath}`);

    return {
      platform: 'macos',
      filename: dmgFilename,
      path: finalDmgPath,
      size: dmgStats.size,
      type: 'dmg'
    };
  }

  async packageLinux(workingPath, tempPath, appName, appVersion, logoPath, options, companyName = null, companyId = null, io = null, jobId = null, platformIndex = 0, totalPlatforms = 1) {
    console.log('Linux paketleme basliyor...');
    
    const outputPath = path.join(tempPath, 'linux');
    await fs.ensureDir(outputPath);

    // Progress update: 10%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'linux',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.1) / totalPlatforms) * 100),
        message: 'Mevcut kurulum kontrol ediliyor...'
      });
    }

    // Mevcut kurulumla karsilastir - gelismis analiz
    const updateInfo = await this.compareWithExistingInstallation(workingPath, appName, appVersion, companyId, companyName);
    
    if (updateInfo.isIdentical) {
      console.log('\u2705 Uygulama zaten guncel! Hizla aciliyor...');
      
      if (io && jobId) {
        io.emit('packaging-progress', {
          jobId,
          platform: 'linux',
          status: 'completed',
          progress: 100,
          message: 'Uygulama zaten guncel - hizla aciliyor!',
          updateType: 'identical'
        });
      }
      
      return {
        platform: 'linux',
        filename: 'Uygulama Guncel - Direkt Aciliyor',
        path: null,
        size: 0,
        type: 'quick-launch',
        updateInfo
      };
    }

    // Progress update: 25%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'linux',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.25) / totalPlatforms) * 100),
        message: updateInfo.hasExistingInstallation ? 
          `Guncelleme hazirlaniyor (${updateInfo.changedFiles.length + updateInfo.newFiles.length} dosya)...` :
          'Linux icon hazirlaniyor...'
      });
    }

    const validIcon = await this.getValidLinuxIcon(workingPath, logoPath);
    const normalizedVersion = this.normalizeSemver(appVersion);

    // AppImage için kurulum mesajı hazırla
    const companyInfo = companyName || 'Bilinmeyen Kurum';
    const installationMessage = `Kurulum devam ediyor bekleyin. Kurulum bittiğinde uygulama otomatik açılacaktır. (${companyInfo})`;
    console.log('Linux kurulum mesajı:', installationMessage);

    const config = {
      appId: `com.${appName.toLowerCase().replace(/\s+/g, '')}.app`,
      productName: appName,
      directories: {
        app: path.resolve(workingPath),
        output: path.resolve(outputPath)
      },
      files: [
        "**/*",
        "!node_modules",
        "!temp",
        "!uploads"
      ],
      linux: {
        target: [
          {
            target: "AppImage",
            arch: ["x64"]
          },
          {
            target: "deb",
            arch: ["x64"]
          }
        ],
        icon: validIcon ? path.resolve(validIcon) : undefined,
        category: "Development",
        description: options.description || appName,
        vendor: options.vendor || "Dijitap",
        maintainer: options.maintainer || `${appName} Team`,
        // DEB/desktop entry ayarları.
        // electron-builder 26.x: desktop entry anahtarları `entry` altına taşınmalı
        // (şema: { desktopActions?, entry? }). Düz key-value v26'da reddedilir.
        desktop: {
          entry: {
            Name: appName,
            Comment: `${appName} - ${companyInfo}`,
            Categories: "Education;Teaching;X-Education;", // Eğitim kategorisi için
            StartupNotify: "true",
            // Pardus uyumluluğu için ek ayarlar
            Keywords: `${appName};Electron;${companyInfo};Education;Eğitim;`,
            MimeType: "application/x-electron;",
            // Eğitim uygulaması olduğunu belirt
            GenericName: "Eğitim Uygulaması",
            Type: "Application"
          }
        },
        // AppImage kurulum mesajı
        executableName: appName.toLowerCase().replace(/\s+/g, '-'),
        artifactName: `${appName}-\${version}.\${ext}`,
        // İlk çalıştırmada gösterilecek mesaj
        synopsis: `${appName} Hazırlanıyor - Lütfen Bekleyin...`
      }
    };

    const configPath = path.join(tempPath, 'electron-builder-linux.json');
    await fs.writeJson(configPath, config, { spaces: 2 });

    // Progress update: 50%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'linux',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.5) / totalPlatforms) * 100),
        message: 'AppImage ve DEB oluşturuluyor...'
      });
    }

    await this.runElectronBuilder(configPath, 'linux', outputPath);

    // Progress update: 70%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'linux',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.7) / totalPlatforms) * 100),
        message: 'Özel AppImage oluşturuluyor (zenity + dijitap)...'
      });
    }

    // Özel AppRun ile AppImage'ı yeniden paketle
    console.log('🎨 customizeAppImage çağrılıyor...');
    console.log('  - outputPath:', outputPath);
    console.log('  - appName:', appName);
    console.log('  - appVersion:', appVersion);
    console.log('  - companyName:', companyName);
    console.log('  - companyId:', companyId);
    console.log('  - logoPath:', logoPath);
    await this.customizeAppImage(outputPath, appName, appVersion, companyName, companyId, logoPath);

    // Flatpak dosyalarını oluştur
    await this.generateFlatpakFiles(outputPath, appName, appVersion, companyName || 'DijiTap', options.description);

    // Progress update: 80%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'linux',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.8) / totalPlatforms) * 100),
        message: 'Flatpak dosyaları oluşturuluyor...'
      });
    }

    // Linux kurulum mesajını AppImage için oluştur
    const installScriptPath = path.join(outputPath, 'install-message.sh');
    const installScript = `#!/bin/bash
# ${appName} AppImage Kurulum ve Çalıştırma Script'i

APPIMAGE_FILE="$1"

if [ -z "$APPIMAGE_FILE" ]; then
    echo "Kullanım: $0 <AppImage-dosyası>"
    echo "Örnek: $0 ${appName}-*.AppImage"
    exit 1
fi

if [ ! -f "$APPIMAGE_FILE" ]; then
    echo "Hata: $APPIMAGE_FILE dosyası bulunamadı!"
    exit 1
fi

echo "\n==============================================\n"
echo "      ${appName} - Eğitim Uygulaması      "
echo "==============================================\n"
echo "${installationMessage}"
echo "\n==============================================\n"

# AppImage'ı çalıştırma izni ver
echo "[1/3] Çalıştırma izni veriliyor..."
chmod +x "$APPIMAGE_FILE" 2>/dev/null || true
echo "✓ İzin verildi"

# İsteğe bağlı olarak masaüstü kısayolu oluştur
echo "\n[2/3] Masaüstü kısayolu oluşturulsun mu? (e/h): "
read -r response
if [[ "$response" =~ ^([eE]|[eE][vV][eE][tT])$ ]]; then
    DESKTOP_FILE="$HOME/Desktop/${appName}.desktop"
    if [ -f "${appName.toLowerCase().replace(/\s+/g, '-')}.desktop" ]; then
        cp "${appName.toLowerCase().replace(/\s+/g, '-')}.desktop" "$DESKTOP_FILE"
        sed -i "s|Exec=%f|Exec=$PWD/$APPIMAGE_FILE|g" "$DESKTOP_FILE"
        chmod +x "$DESKTOP_FILE"
        echo "✓ Masaüstü kısayolu oluşturuldu: $DESKTOP_FILE"
    else
        echo "! .desktop dosyası bulunamadı, kısayol oluşturulamadı"
    fi
else
    echo "- Masaüstü kısayolu atlandı"
fi

echo "\n[3/3] Uygulama başlatılıyor..."
echo "\nAppImage hazır! Uygulama şimdi açılacak..."
echo "\n📝 Not: AppImage yönetici şifresi gerektirmez!"
echo "🎓 Eğitim menüsüne eklemek için DEB paketi kullanın"
echo "\n==============================================\n"

# AppImage'ı çalıştır
echo "Uygulama başlatılıyor: $APPIMAGE_FILE"
"$APPIMAGE_FILE" &

echo "✓ ${appName} başarıyla başlatıldı!"
echo "\nUygulama arkaplanda çalışıyor. Pencereyi kapatabilirsiniz."
`;
    
    await fs.writeFile(installScriptPath, installScript);
    await fs.chmod(installScriptPath, '755');
    
    // AppImage kullanım talimatları oluştur
    const readmePath = path.join(outputPath, 'LINUX_KURULUM_REHBERI.md');
    const instructions = `
# Linux Kurulum Rehberi - ${appName}

## ✅ AppImage (Kolay Yöntem - Önerilen)

### Adımlar:
1. **İndirin**: ${appName}-*.AppImage dosyasını indirin
2. **İzin Verin**: Dosyaya sağ tıklayıp "Properties" > "Permissions" > "Allow executing file as program" seçin
3. **Çalıştırın**: Çift tıklayarak uygulamanızı başlatın

### Terminal üzerinden:
\`\`\`bash
chmod +x ${appName}-*.AppImage
./${appName}-*.AppImage
\`\`\`

### Avantajlar:
- ✅ **Yönetici şifresi gerektirmez**
- ✅ **Hemen çalışır** - kurulum gerekmez
- ✅ **Tüm Linux dağıtımlarında çalışır**
- ✅ **USB'den bile çalışabilir**

---

## 🔒 DEB Paketi (Sistem Kurulumu)

### Adımlar:
\`\`\`bash
sudo dpkg -i ${appName}_*.deb
# Eğer bağımlılık hataları çıkarsa:
sudo apt-get install -f
\`\`\`

### Avantajlar:
- ✅ **Sistem menüsüne eklenir**
- ✅ **Otomatik güncellemeler**
- ✅ **Sistem entegrasyonu**

### Dezavantajlar:
- ❌ **Yönetici şifresi gerektirir**
- ❌ **Sadece Debian/Ubuntu tabanlı sistemlerde**

---

## 📝 Pardus Özel Notlar

- **DEB paketi kurulduktan sonra**: Başlat > Eğitim klasöründe görünecek
- **Masaüstü kısayolu**: Otomatik olarak oluşacak
- **AppImage için**: İndirilen .desktop dosyasını kullanın
  - Menü için: ~/.local/share/applications/ klasörüne kopyalayın
  - Masaüstü için: ~/Desktop/ klasörüne kopyalayın
- **Tavsiye**: Pardus'ta DEB paketi kullanın (Eğitim menüsü entegrasyonu için)

## Uygulama Bilgileri
- **Ad**: ${appName}
- **Versiyon**: ${appVersion}
- **Şurket**: ${companyInfo}
- **Platform**: Linux (AppImage + DEB)
    `;
    
    await fs.writeFile(readmePath, instructions);
    
    // AppImage için .desktop dosyası oluştur (Eğitim menüsü için)
    const desktopFilePath = path.join(outputPath, `${appName.toLowerCase().replace(/\s+/g, '-')}.desktop`);
    const desktopFileContent = `[Desktop Entry]
Version=${appVersion}
Type=Application
Name=${appName}
Comment=${appName} - ${companyInfo} Eğitim Uygulaması
Exec=%f
Icon=application-x-executable
Categories=Education;Teaching;X-Education;
Keywords=${appName};Education;Eğitim;${companyInfo};
StartupNotify=true
GenericName=Eğitim Uygulaması
NoDisplay=false
StartupWMClass=${appName}
`;
    
    await fs.writeFile(desktopFilePath, desktopFileContent);

    // Progress update: 90%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'linux',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.9) / totalPlatforms) * 100),
        message: 'Linux paketleri kontrol ediliyor...'
      });
    }

    const files = await fs.readdir(outputPath);
    // customizeAppImage .AppImage'ı .impark'a rename eder → result.packages'a .impark da
    // dahil edilmeli (yoksa AppImage entry kaybolur, sadece .deb kalır, indirme yanlış dosya verir).
    console.log(`[packageLinux] readdir(${outputPath}) →`, files.filter(f => f.endsWith('.impark') || f.endsWith('.AppImage') || f.endsWith('.deb') || f.endsWith('.zip')));
    const appImageFile = files.find(file => file.endsWith('.impark') || file.endsWith('.AppImage'));
    const debFile = files.find(file => file.endsWith('.deb'));

    const results = [];
    
    if (appImageFile) {
      const appImageAbsPath = path.resolve(outputPath, appImageFile);
      results.push({
        type: 'AppImage',
        filename: appImageFile,
        path: appImageAbsPath,
        size: (await fs.stat(appImageAbsPath)).size
      });
      console.log(`[packageLinux] AppImage/impark path (abs): ${appImageAbsPath}`);
    }

    if (debFile) {
      const debAbsPath = path.resolve(outputPath, debFile);
      results.push({
        type: 'DEB',
        filename: debFile,
        path: debAbsPath,
        size: (await fs.stat(debAbsPath)).size
      });
    }

    // Flatpak ZIP dosyasını kontrol et
    const outputFiles = await fs.readdir(outputPath);
    const flatpakZipFile = outputFiles.find(file => file.endsWith('-flatpak.zip'));

    if (flatpakZipFile) {
      const flatpakZipPath = path.resolve(outputPath, flatpakZipFile);
      const stats = await fs.stat(flatpakZipPath);
      
      results.push({
        type: 'Flatpak',
        filename: flatpakZipFile,
        path: flatpakZipPath,
        size: stats.size,
        message: 'Pardus Yazılım Merkezi için hazır'
      });
      
      console.log('✅ Flatpak ZIP bulundu:', flatpakZipFile);
    } else {
      console.warn('⚠️ Flatpak ZIP bulunamadı');
    }

    if (results.length === 0) {
      throw new Error('Linux paketleri oluşturulamadı');
    }

    return {
      platform: 'linux',
      packages: results
    };
  }

  async packageAndroid(workingPath, tempPath, appName, appVersion, logoPath, options, io = null, jobId = null, platformIndex = 0, totalPlatforms = 1) {
    console.log('Android APK paketleme başlıyor...');
    
    // Progress update: 10%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'android',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.1) / totalPlatforms) * 100),
        message: 'Android projesi hazırlanıyor...'
      });
    }
    
    const androidPath = path.join(tempPath, 'android');
    await fs.ensureDir(androidPath);

    try {
      // Web uygulamasını Android için hazırla
      const webAppPath = path.join(androidPath, 'webapp');
      await fs.copy(workingPath, webAppPath);
      
      // Android için gerekli dosyaları oluştur
      await this.generateAndroidFiles(webAppPath, appName, appVersion, logoPath, options);
      
      // Progress update: 30%
      if (io && jobId) {
        io.emit('packaging-progress', {
          jobId,
          platform: 'android',
          status: 'processing',
          progress: Math.round(((platformIndex + 0.3) / totalPlatforms) * 100),
          message: 'Capacitor projesi oluşturuluyor...'
        });
      }
      
      // Capacitor ile APK oluştur
      const apkResult = await this.buildAPKWithCapacitor(androidPath, appName, appVersion, workingPath, logoPath, io, jobId, platformIndex, totalPlatforms);
      
      return apkResult;
      
    } catch (error) {
      console.error('Android paketleme hatası:', error);
      
      // Hata durumunda WebSocket üzerinden bildir
      if (io && jobId) {
        io.emit('packaging-progress', {
          jobId,
          platform: 'android',
          status: 'error',
          progress: 100,
          message: 'APK oluşturulamadı: ' + error.message
        });
      }
      
      // Hata durumunda proje dosyalarını hazırla
      const zipPath = path.join(tempPath, `${appName}-android-project-v${appVersion}.zip`);
      await this.createZip(androidPath, zipPath);
      
      return {
        platform: 'android',
        filename: path.basename(zipPath),
        path: zipPath,
        size: (await fs.stat(zipPath)).size,
        type: 'project',
        message: 'APK otomatik oluşturulamadı. Android proje dosyaları hazırlandı. Manuel build için talimatları takip edin.',
        requiresManualBuild: true,
        error: error.message
      };
    }
  }

  // Android dosylarını oluşturucu (Capacitor için güncellendi)
  async generateAndroidFiles(webAppPath, appName, appVersion, logoPath, options) {
    // package.json oluştur (Capacitor için)
    const packageJson = {
      name: appName.toLowerCase().replace(/\s+/g, '-'),
      version: appVersion,
      description: `${appName} - Capacitor Android Uygulaması`,
      main: "index.html",
      scripts: {
        "build": "cap build android",
        "sync": "cap sync android",
        "run": "cap run android"
      },
      dependencies: {
        "@capacitor/core": "^6.0.0",
        "@capacitor/android": "^6.0.0"
      },
      devDependencies: {
        "@capacitor/cli": "^6.0.0"
      }
    };
    
    await fs.writeJson(path.join(webAppPath, 'package.json'), packageJson, { spaces: 2 });
    
    // Capacitor config oluştur
    const packageId = `com.dijitap.${appName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const capacitorConfig = `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: '${packageId}',
  appName: '${appName}',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: true
  }
};

export default config;`;
    
    await fs.writeFile(path.join(webAppPath, 'capacitor.config.ts'), capacitorConfig);
    
    console.log('Capacitor Android dosyaları oluşturuldu:', webAppPath);
  }

  // Comprehensive Android icon setup (Capacitor için güncellendi)
  async setupAndroidIcons(webAppPath, cordovaWwwPath, logoPath, appName) {
    const sharp = require('sharp');
    
    console.log('🖼️ Capacitor Android icon setup başlatılıyor:', appName);
    
    try {
      // Web app dizinini şimdilik kopyala (sonra www'ye taşınacak)
      const iconDestPath = path.join(webAppPath, 'icon.png');
      const wwwIconPath = path.join(cordovaWwwPath, 'icon.png');
      
      await fs.copy(logoPath, iconDestPath);
      await fs.copy(logoPath, wwwIconPath);
      
      console.log('✅ Logo kopyalama tamamlandı, Capacitor native mipmap sistem kurulumu bu aşamada atlandı');
      console.log('ℹ️ Native mipmap icons Capacitor platform eklendikten sonra oluşturulacak');
      
    } catch (error) {
      console.error('❌ Android icon setup error:', error);
      // Fallback: just copy the logo as is
      const iconDestPath = path.join(webAppPath, 'icon.png');
      const wwwIconPath = path.join(cordovaWwwPath, 'icon.png');
      await fs.copy(logoPath, iconDestPath);
      await fs.copy(logoPath, wwwIconPath);
      console.log('⚠️ Used fallback icon copying');
    }
  }

  // Android Fullscreen desteğini etkinleştir
  async enableAndroidFullscreen(wwwPath) {
    try {
      const indexPath = path.join(wwwPath, 'index.html');
      
      if (await fs.pathExists(indexPath)) {
        let htmlContent = await fs.readFile(indexPath, 'utf8');
        
        console.log('📱 Android fullscreen desteği ekleniyor...');
        
        // Fullscreen CSS ekle
        const fullscreenCSS = `
<style>
/* Android Fullscreen Support */
body, html {
    margin: 0;
    padding: 0;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    touch-action: manipulation;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
}

* {
    box-sizing: border-box;
}

/* Prevent zoom */
input, textarea, select {
    font-size: 16px;
}
</style>`;
        
        // Fullscreen JavaScript ekle
        const fullscreenJS = `
<script>
// Android Fullscreen Support
document.addEventListener('deviceready', function() {
    console.log('\ud83d\udcf1 Android Cordova haz\u0131r');
    
    // StatusBar plugin varsa gizle
    if (window.StatusBar) {
        StatusBar.hide();
    }
    
    // NavigationBar plugin varsa gizle
    if (window.NavigationBar) {
        NavigationBar.hide();
    }
    
    // Screen orientation lock
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
    }
    
    // Prevent context menu
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        return false;
    });
    
    // Prevent text selection
    document.addEventListener('selectstart', function(e) {
        e.preventDefault();
        return false;
    });
    
    console.log('\u2705 Android fullscreen ayarlar\u0131 uyguland\u0131');
}, false);

// Fallback for non-Cordova environments
if (!window.cordova) {
    document.addEventListener('DOMContentLoaded', function() {
        console.log('\ud83c\udf10 Web ortam\u0131nda çal\u0131\u015f\u0131yor');
        
        // Web'de fullscreen API kullan
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    });
}
</script>`;
        
        // Cordova script'ini ekle (eğer yoksa)
        if (!htmlContent.includes('cordova.js')) {
          const cordovaScript = '<script src="cordova.js"></script>';
          if (htmlContent.includes('</head>')) {
            htmlContent = htmlContent.replace('</head>', cordovaScript + '\n</head>');
          } else if (htmlContent.includes('</body>')) {
            htmlContent = htmlContent.replace('</body>', cordovaScript + '\n</body>');
          }
        }
        
        // Viewport meta normalize et — içeriğin ekrana sığması için kritik.
        // device-width olmadan WebView geniş bir logical width raporlar ve
        // sayfanın responsive breakpoint'leri tetiklenmez (içerik taşar).
        const viewportMeta = '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">';
        if (/<meta\s+name=["']viewport["'][^>]*>/i.test(htmlContent)) {
          htmlContent = htmlContent.replace(/<meta\s+name=["']viewport["'][^>]*>/i, viewportMeta);
          console.log('📐 Mevcut viewport meta güncellendi (device-width)');
        } else if (htmlContent.includes('</head>')) {
          htmlContent = htmlContent.replace('</head>', '  ' + viewportMeta + '\n</head>');
          console.log('📐 Viewport meta eklendi (device-width)');
        }

        // CSS'i head'e ekle
        if (htmlContent.includes('</head>')) {
          htmlContent = htmlContent.replace('</head>', fullscreenCSS + '\n</head>');
        } else {
          htmlContent = fullscreenCSS + '\n' + htmlContent;
        }
        
        // JavaScript'i body'nin sonuna ekle
        if (htmlContent.includes('</body>')) {
          htmlContent = htmlContent.replace('</body>', fullscreenJS + '\n</body>');
        } else {
          htmlContent = htmlContent + fullscreenJS;
        }
        
        await fs.writeFile(indexPath, htmlContent);
        console.log('✅ Android fullscreen desteği eklendi');
        
      } else {
        console.log('⚠️ index.html bulunamadı, fullscreen eklenemedi');
      }
      
    } catch (error) {
      console.error('❌ Android fullscreen eklenirken hata:', error);
    }
  }

  // Capacitor ile APK oluşturucu
  async buildAPKWithCapacitor(androidPath, appName, appVersion, workingPath, logoPath, io, jobId, platformIndex, totalPlatforms) {
    const { spawn } = require('child_process');
    const webAppPath = path.join(androidPath, 'webapp');
    
    try {
      // Progress update: 50%
      if (io && jobId) {
        io.emit('packaging-progress', {
          jobId,
          platform: 'android',
          status: 'processing',
          progress: Math.round(((platformIndex + 0.5) / totalPlatforms) * 100),
          message: 'Cordova kurulumu kontrol ediliyor...'
        });
      }
      
      // Capacitor'ın kurulu olup olmadığını kontrol et
      const hasCapacitor = await this.checkCapacitorInstallation();
      
      if (!hasCapacitor) {
        // Capacitor otomatik kurulumu dene
        try {
          console.log('Capacitor kuruluyor...');
          const { spawn } = require('child_process');
          
          await new Promise((resolve, reject) => {
            const child = spawn('npm', ['install', '@capacitor/core', '@capacitor/cli', '@capacitor/android'], { shell: true });
            
            child.on('close', (code) => {
              if (code === 0) {
                console.log('Capacitor başarıyla kuruldu');
                resolve();
              } else {
                reject(new Error('Capacitor kurulumu başarısız oldu'));
              }
            });
            
            child.on('error', reject);
          });
          
        } catch (installError) {
          throw new Error(`Capacitor kurulu değil ve otomatik kurulum başarısız: ${installError.message}. Lütfen "npm install @capacitor/core @capacitor/cli @capacitor/android" komutuyla manuel kurun.`);
        }
      }
      
      // Progress update: 60%
      if (io && jobId) {
        io.emit('packaging-progress', {
          jobId,
          platform: 'android',
          status: 'processing',
          progress: Math.round(((platformIndex + 0.6) / totalPlatforms) * 100),
          message: 'Capacitor projesi hazırlanıyor...'
        });
      }
      
      // Capacitor projesi hazırla
      await this.initializeCapacitorProject(webAppPath, appName, appVersion, logoPath, workingPath);
      
      // Progress update: 80%
      if (io && jobId) {
        io.emit('packaging-progress', {
          jobId,
          platform: 'android',
          status: 'processing',
          progress: Math.round(((platformIndex + 0.8) / totalPlatforms) * 100),
          message: 'Capacitor ile APK oluşturuluyor...'
        });
      }
      
      // Capacitor sync ve build
      try {
        await this.runCapacitorCommand('sync', ['android'], webAppPath);
        // Gradle ile debug APK build et
        await this.runGradleBuild(webAppPath, 'assembleDebug');
      } catch (buildError) {
        throw new Error('Capacitor build başarısız: ' + buildError.message);
      }
      
      // APK dosyasını bul ve kopyala
      const apkPath = path.join(webAppPath, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
      
      if (await fs.pathExists(apkPath)) {
        const finalApkPath = path.join(androidPath, `${appName}-v${appVersion}.apk`);
        await fs.copy(apkPath, finalApkPath);
        
        return {
          platform: 'android',
          filename: path.basename(finalApkPath),
          path: finalApkPath,
          size: (await fs.stat(finalApkPath)).size,
          type: 'apk',
          message: `Capacitor APK başarıyla oluşturuldu! (Custom icon ile)`
        };
      } else {
        throw new Error('APK dosyası oluşturulamadı. Build output kontrol edilmeli.');
      }
      
    } catch (error) {
      console.error('Capacitor APK build hatası:', error);
      
      // Progress update: Error state
      if (io && jobId) {
        io.emit('packaging-progress', {
          jobId,
          platform: 'android',
          status: 'error',
          progress: 100,
          message: 'APK oluşturulamadı: ' + error.message
        });
      }
      
      // Gradle hatası özel olarak ele alınacak
      if (error.message.includes('Could not find an installed version of Gradle')) {
        throw new Error('Gradle kurulu değil. Android APK oluşturmak için Gradle gereklidir. Lütfen Android Studio kurun veya Gradle\'ı PATH\'e ekleyin.');
      }
      
      throw error;
    }
  }

  // AAB'yi APK'ya dönüştürücü (Akıllı yöntem)
  async convertAABToAPK(aabPath, androidPath, appName, appVersion) {
    const { spawn } = require('child_process');
    
    try {
      console.log('📦 AAB → APK dönüştürme başlıyor...');
      console.log('Kaynak AAB:', path.basename(aabPath));
      
      // Bundletool'un kurulu olup olmadığını kontrol et
      const hasBundletool = await this.checkBundletoolInstallation();
      let bundletoolPath;
      
      if (!hasBundletool) {
        console.log('📦 Bundletool kurulu değil, otomatik kurulum başlıyor...');
        bundletoolPath = await this.installBundletool();
      } else {
        bundletoolPath = path.join(process.cwd(), 'tools', 'bundletool.jar');
      }
      
      // Debug keystore oluştur (tools klasöründe)
      const keystorePath = path.join(process.cwd(), 'tools', 'debug.keystore');
      await this.createDebugKeystore(keystorePath);
      
      // AAB'den APKS oluştur (universal mode)
      const apksPath = path.join(androidPath, `${appName}-v${appVersion}.apks`);
      
      const bundletoolArgs = [
        'build-apks',
        `--bundle="${aabPath}"`,
        `--output="${apksPath}"`,
        `--ks="${keystorePath}"`,
        '--ks-pass=pass:android',
        '--ks-key-alias=androiddebugkey',
        '--key-pass=pass:android',
        '--mode=universal',
        '--overwrite'
      ];
      
      console.log('🔧 APKS dosyası oluşturuluyor...');
      await this.runBundletoolCommand(bundletoolArgs, bundletoolPath);
      
      // APKS dosyasından universal APK çıkar
      const finalApkPath = path.join(androidPath, `${appName}-v${appVersion}.apk`);
      await this.extractUniversalAPK(apksPath, finalApkPath);
      
      // Geçici dosyaları temizle
      if (await fs.pathExists(apksPath)) {
        await fs.remove(apksPath);
        console.log('🧩 Geçici APKS dosyası temizlendi');
      }
      
      // Dosya boyutunu kontrol et
      const stats = await fs.stat(finalApkPath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(1);
      
      console.log('✅ AAB başarıyla APK\'ya çevrildi!');
      console.log('📱 APK dosyası:', path.basename(finalApkPath));
      console.log('📊 Dosya boyutu:', fileSizeMB + ' MB');
      
      return {
        platform: 'android',
        filename: path.basename(finalApkPath),
        path: finalApkPath,
        size: stats.size,
        type: 'apk',
        message: `APK başarıyla oluşturuldu! (AAB'den dönüştürülmüş - ${fileSizeMB} MB)`
      };
      
    } catch (error) {
      console.error('❌ AAB to APK dönüşüm hatası:', error);
      throw new Error(`AAB → APK dönüştürme başarısız: ${error.message}`);
    }
  }
  // Bundletool kurulum kontrolü (Akıllı yöntem)
  async checkBundletoolInstallation() {
    // İlk olarak tools klasöründeki bundletool'u kontrol et
    const localBundletoolPath = path.join(process.cwd(), 'tools', 'bundletool.jar');
    
    if (await fs.pathExists(localBundletoolPath)) {
      console.log('✅ Local bundletool mevcut:', localBundletoolPath);
      return true;
    }
    
    // Sistem üzerindeki bundletool'u kontrol et
    const { spawn } = require('child_process');
    
    return new Promise((resolve) => {
      // Java ile bundletool kontrol et
      const child = spawn('java', ['-jar', '/usr/local/bin/bundletool.jar', 'version'], { shell: true });
      
      child.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Sistem bundletool mevcut');
        }
        resolve(code === 0);
      });
      
      child.on('error', () => {
        resolve(false);
      });
    });
  }
  
  // Bundletool kurulumu (Akıllı yöntem)
  async installBundletool() {
    const bundletoolUrl = 'https://github.com/google/bundletool/releases/download/1.15.6/bundletool-all-1.15.6.jar';
    const bundletoolPath = path.join(process.cwd(), 'tools', 'bundletool.jar');
    
    // Tools klasörünü oluştur
    await fs.ensureDir(path.dirname(bundletoolPath));
    
    // Eğer zaten varsa, kurulum atla
    if (await fs.pathExists(bundletoolPath)) {
      console.log('✅ Bundletool zaten mevcut:', bundletoolPath);
      return bundletoolPath;
    }
    
    try {
      console.log('📦 Bundletool indiriliyor...');
      
      // Bundletool JAR dosyasını indir
      const { spawn } = require('child_process');
      
      await new Promise((resolve, reject) => {
        const child = spawn('curl', ['-L', '-o', bundletoolPath, bundletoolUrl], { shell: true });
        
        child.stdout.on('data', (data) => {
          console.log('Download:', data.toString().trim());
        });
        
        child.on('close', (code) => {
          if (code === 0) {
            console.log('✅ Bundletool başarıyla indirildi:', bundletoolPath);
            resolve(bundletoolPath);
          } else {
            reject(new Error('Bundletool indirme başarısız'));
          }
        });
        
        child.on('error', reject);
      });
      
      return bundletoolPath;
      
    } catch (error) {
      console.error('Bundletool kurulum hatası:', error);
      throw new Error('Bundletool kurulum başarısız. Bundletool manuel kurulumu gerekebilir.');
    }
  }
  
  // Debug keystore oluştur (Akıllı yöntem)
  async createDebugKeystore(keystorePath) {
    // Eğer keystore zaten varsa, yeniden oluşturma
    if (await fs.pathExists(keystorePath)) {
      console.log('✅ Debug keystore zaten mevcut:', keystorePath);
      return keystorePath;
    }
    
    const { spawn } = require('child_process');
    
    // Keystore klasörünü oluştur
    await fs.ensureDir(path.dirname(keystorePath));
    
    console.log('🔐 Debug keystore oluşturuluyor...');
    
    return new Promise((resolve, reject) => {
      const keytoolArgs = [
        '-genkey',
        '-v',
        '-keystore', keystorePath,
        '-storepass', 'android',
        '-alias', 'androiddebugkey',
        '-keypass', 'android',
        '-keyalg', 'RSA',
        '-keysize', '2048',
        '-validity', '10000',
        '-dname', 'CN=Android Debug,O=Android,C=US'
      ];
      
      const child = spawn('keytool', keytoolArgs, { shell: true });
      
      child.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Debug keystore oluşturuldu:', keystorePath);
          resolve(keystorePath);
        } else {
          reject(new Error('Debug keystore oluşturulamadı'));
        }
      });
      
      child.on('error', reject);
    });
  }
  
  // Bundletool komut çalıştırıcı
  async runBundletoolCommand(args, bundletoolPath = null) {
    const { spawn } = require('child_process');
    
    // Eğer bundletool path'i verilmemişse, varsayılanı kullan
    const toolPath = bundletoolPath || path.join(process.cwd(), 'tools', 'bundletool.jar');
    
    return new Promise((resolve, reject) => {
      const javaArgs = ['-jar', toolPath, ...args];
      
      const javaHome = this.getJavaHome();
      const child = spawn('java', javaArgs, {
        shell: true,
        env: {
          ...process.env,
          ...(javaHome ? { JAVA_HOME: javaHome } : {})
        }
      });
      
      let output = '';
      let errorOutput = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString();
        console.log('Bundletool:', data.toString());
      });
      
      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.error('Bundletool Error:', data.toString());
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Bundletool command failed: ${args.join(' ')}\n${errorOutput}`));
        }
      });
      
      child.on('error', (error) => {
        reject(error);
      });
    });
  }
  
  // Universal APK çıkar
  async extractUniversalAPK(apksPath, outputApkPath) {
    try {
      // APKS dosyası aslında bir ZIP dosyasıdır
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(apksPath);
      const entries = zip.getEntries();
      
      // Universal APK'yı bul
      const universalEntry = entries.find(entry => 
        entry.entryName === 'universal.apk' || 
        entry.entryName.includes('universal') ||
        entry.entryName.endsWith('.apk')
      );
      
      if (universalEntry) {
        // Universal APK'yı çıkar
        await fs.writeFile(outputApkPath, universalEntry.getData());
        console.log('Universal APK çıkarıldı:', outputApkPath);
      } else {
        // Eğer universal APK yoksa, ilk APK dosyasını al
        const apkEntry = entries.find(entry => entry.entryName.endsWith('.apk'));
        if (apkEntry) {
          await fs.writeFile(outputApkPath, apkEntry.getData());
          console.log('APK dosyası çıkarıldı:', outputApkPath);
        } else {
          throw new Error('APKS dosyasında APK bulunamadı');
        }
      }
      
    } catch (error) {
      console.error('APK çıkarma hatası:', error);
      throw error;
    }
  }

  // Android SDK kontrolü
  async checkAndroidSDK() {
    const { spawn } = require('child_process');
    
    return new Promise((resolve) => {
      // Android SDK klasörünü kontrol et
      const fs = require('fs-extra');
      const path = require('path');
      const os = require('os');
      
      const possiblePaths = [
        path.join(os.homedir(), 'Library', 'Android', 'sdk'), // macOS
        path.join(os.homedir(), 'Android', 'Sdk'), // Linux
        'C:\\Users\\' + os.userInfo().username + '\\AppData\\Local\\Android\\Sdk', // Windows
        process.env.ANDROID_HOME,
        process.env.ANDROID_SDK_ROOT
      ].filter(Boolean);
      
      for (const sdkPath of possiblePaths) {
        if (fs.pathExistsSync(sdkPath)) {
          console.log('Android SDK bulundu:', sdkPath);
          resolve(true);
          return;
        }
      }
      
      // adb komutuyla kontrol et
      const child = spawn('adb', ['version'], { shell: true });
      
      child.on('close', (code) => {
        resolve(code === 0);
      });
      
      child.on('error', () => {
        resolve(false);
      });
    });
  }
  
  // Capacitor kurulum kontrolü
  async checkCapacitorInstallation() {
    const { spawn } = require('child_process');
    
    return new Promise((resolve) => {
      const child = spawn('npx', ['cap', '--version'], { shell: true });
      
      child.on('close', (code) => {
        resolve(code === 0);
      });
      
      child.on('error', () => {
        resolve(false);
      });
    });
  }

  // Cordova kurulum kontrolü
  async checkCordovaInstallation() {
    const { spawn } = require('child_process');
    
    return new Promise((resolve) => {
      const child = spawn('cordova', ['--version'], { shell: true });
      
      child.on('close', (code) => {
        resolve(code === 0);
      });
      
      child.on('error', () => {
        resolve(false);
      });
    });
  }

  // Capacitor komut çalıştırıcı
  async runCapacitorCommand(command, args, workingDir = null) {
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
      const options = { 
        shell: true,
        env: {
          ...process.env,
          PATH: process.env.PATH + ':/usr/local/bin',
          ANDROID_HOME: process.env.ANDROID_HOME || '/Users/nadir/Library/Android/sdk',
          ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || '/Users/nadir/Library/Android/sdk'
        }
      };
      if (workingDir) {
        options.cwd = workingDir;
      }
      
      const child = spawn('npx', ['cap', command, ...args], options);
      
      let output = '';
      let errorOutput = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString();
        console.log('Capacitor:', data.toString());
      });
      
      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.error('Capacitor Error:', data.toString());
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Capacitor command failed: ${command} ${args.join(' ')}\n${errorOutput}`));
        }
      });
      
      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  // Cordova komut çalıştırıcı
  async runCordovaCommand(command, args, workingDir = null) {
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
      const options = { 
        shell: true,
        env: {
          ...process.env,
          PATH: process.env.PATH + ':/usr/local/bin',
          GRADLE_HOME: '/usr/local/Cellar/gradle/9.1.0/libexec',
          ANDROID_HOME: process.env.ANDROID_HOME || '/Users/nadir/Library/Android/sdk',
          ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || '/Users/nadir/Library/Android/sdk'
        }
      };
      if (workingDir) {
        options.cwd = workingDir;
      }
      
      const child = spawn('cordova', [command, ...args], options);
      
      let output = '';
      let errorOutput = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString();
        console.log('Cordova:', data.toString());
      });
      
      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.error('Cordova Error:', data.toString());
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Cordova command failed: ${command} ${args.join(' ')}\n${errorOutput}`));
        }
      });
      
      child.on('error', (error) => {
        reject(error);
      });
    });
  }
  
  async checkCapacitorInstallation() {
    try {
      const { spawn } = require('cross-spawn');
      return new Promise((resolve) => {
        const child = spawn('npx', ['cap', '--version'], { stdio: 'pipe' });
        child.on('close', (code) => {
          resolve(code === 0);
        });
        child.on('error', () => {
          resolve(false);
        });
      });
    } catch (error) {
      return false;
    }
  }

  async packagePWA(workingPath, tempPath, appName, appVersion, logoPath, options, io = null, jobId = null, platformIndex = 0, totalPlatforms = 1) {
    console.log('🌐 PWA paketleme başlıyor...');
    
    const pwaPath = path.join(tempPath, 'pwa');
    await fs.ensureDir(pwaPath);

    // Progress: 10%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'pwa',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.1) / totalPlatforms) * 100),
        message: 'Build dosyaları kopyalanıyor...'
      });
    }

    // Build klasörünü kopyala
    await fs.copy(workingPath, pwaPath);

    // Progress: 30%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'pwa',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.3) / totalPlatforms) * 100),
        message: 'PWA manifest oluşturuluyor...'
      });
    }

    // PWA manifest oluştur (gelişmiş)
    const manifest = {
      name: appName,
      short_name: appName,
      version: appVersion,
      description: options.description || `${appName} - Eğitim Uygulaması`,
      start_url: "/",
      scope: "/",
      display: "fullscreen",
      display_override: ["fullscreen", "standalone", "minimal-ui"],
      orientation: "any",
      background_color: "#667eea",
      theme_color: "#667eea",
      categories: ["education", "productivity"],
      lang: "tr",
      dir: "ltr",
      icons: [
        {
          src: logoPath ? "/logo-72.png" : "/ico.png",
          sizes: "72x72",
          type: "image/png",
          purpose: "any"
        },
        {
          src: logoPath ? "/logo-96.png" : "/ico.png",
          sizes: "96x96",
          type: "image/png",
          purpose: "any"
        },
        {
          src: logoPath ? "/logo-128.png" : "/ico.png",
          sizes: "128x128",
          type: "image/png",
          purpose: "any"
        },
        {
          src: logoPath ? "/logo-144.png" : "/ico.png",
          sizes: "144x144",
          type: "image/png",
          purpose: "any"
        },
        {
          src: logoPath ? "/logo-152.png" : "/ico.png",
          sizes: "152x152",
          type: "image/png",
          purpose: "any"
        },
        {
          src: logoPath ? "/logo-192.png" : "/ico.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any maskable"
        },
        {
          src: logoPath ? "/logo-384.png" : "/ico.png",
          sizes: "384x384",
          type: "image/png",
          purpose: "any"
        },
        {
          src: logoPath ? "/logo-512.png" : "/ico.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable"
        }
      ],
      screenshots: [],
      shortcuts: [],
      prefer_related_applications: false
    };

    await fs.writeJson(path.join(pwaPath, 'manifest.json'), manifest, { spaces: 2 });

    // Progress: 50%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'pwa',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.5) / totalPlatforms) * 100),
        message: 'Service Worker oluşturuluyor...'
      });
    }

    // Gelişmiş Service Worker oluştur
    const serviceWorker = await this.generateAdvancedServiceWorker(appName, appVersion, pwaPath);
    await fs.writeFile(path.join(pwaPath, 'sw.js'), serviceWorker);

    // Progress: 70%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'pwa',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.7) / totalPlatforms) * 100),
        message: 'Kurulum dosyaları oluşturuluyor...'
      });
    }

    // Install prompt helper oluştur
    const installHelper = this.generateInstallHelper(appName);
    await fs.writeFile(path.join(pwaPath, 'install-helper.js'), installHelper);

    // Download Manager script'ini kopyala
    const downloadManagerPath = path.join(__dirname, '../packaging/pwa-assets/download-manager.js');
    if (await fs.pathExists(downloadManagerPath)) {
      await fs.copy(downloadManagerPath, path.join(pwaPath, 'download-manager.js'));
      console.log('✅ Download Manager eklendi');
    }

    // Offline fallback sayfası
    const offlinePage = this.generateOfflinePage(appName);
    await fs.writeFile(path.join(pwaPath, 'offline.html'), offlinePage);

    // PWA README
    const pwaReadme = this.generatePWAReadme(appName, appVersion);
    await fs.writeFile(path.join(pwaPath, 'PWA_KURULUM_REHBERI.md'), pwaReadme);

    // Progress: 90%
    if (io && jobId) {
      io.emit('packaging-progress', {
        jobId,
        platform: 'pwa',
        status: 'processing',
        progress: Math.round(((platformIndex + 0.9) / totalPlatforms) * 100),
        message: 'PWA paketi hazırlanıyor...'
      });
    }

    // PWA Config oluştur ve kaydet
    if (options.pwaConfig && jobId) {
      try {
        console.log('📋 PWA Config veritabanına kaydediliyor...');
        
        // Config'i veritabanına kaydet
        const config = await pwaConfigManager.createConfig(
          jobId,
          appName,
          appVersion,
          {
            // Windows
            windowsSetupUrl: options.pwaConfig.downloads?.windows?.setup?.url,
            windowsSetupSize: options.pwaConfig.downloads?.windows?.setup?.size,
            windowsSetupEnabled: options.pwaConfig.downloads?.windows?.setup?.enabled,
            
            // Linux
            linuxAppImageUrl: options.pwaConfig.downloads?.linux?.appimage?.url,
            linuxAppImageSize: options.pwaConfig.downloads?.linux?.appimage?.size,
            linuxAppImageEnabled: options.pwaConfig.downloads?.linux?.appimage?.enabled,
            linuxDebUrl: options.pwaConfig.downloads?.linux?.deb?.url,
            linuxDebSize: options.pwaConfig.downloads?.linux?.deb?.size,
            linuxDebEnabled: options.pwaConfig.downloads?.linux?.deb?.enabled,
            
            // macOS
            macosDmgUrl: options.pwaConfig.downloads?.macos?.dmg?.url,
            macosDmgSize: options.pwaConfig.downloads?.macos?.dmg?.size,
            macosDmgEnabled: options.pwaConfig.downloads?.macos?.dmg?.enabled,
            macosAppStoreUrl: options.pwaConfig.downloads?.macos?.appstore?.url,
            macosAppStoreEnabled: options.pwaConfig.downloads?.macos?.appstore?.enabled,
            
            // Android
            androidApkUrl: options.pwaConfig.downloads?.android?.apk?.url,
            androidApkSize: options.pwaConfig.downloads?.android?.apk?.size,
            androidApkEnabled: options.pwaConfig.downloads?.android?.apk?.enabled,
            androidPlayStoreUrl: options.pwaConfig.downloads?.android?.playstore?.url,
            androidPlayStoreEnabled: options.pwaConfig.downloads?.android?.playstore?.enabled,
            
            // iOS
            iosAppStoreUrl: options.pwaConfig.downloads?.ios?.appstore?.url,
            iosAppStoreEnabled: options.pwaConfig.downloads?.ios?.appstore?.enabled,
            
            // Caching
            cachingStrategy: options.pwaConfig.caching?.strategy,
            autoUpdate: options.pwaConfig.caching?.autoUpdate,
            updateInterval: options.pwaConfig.caching?.updateInterval,
            
            // UI
            showPWAButton: options.pwaConfig.ui?.showPWAButton,
            buttonText: options.pwaConfig.ui?.buttonText,
            buttonColor: options.pwaConfig.ui?.buttonColor,
            popupTitle: options.pwaConfig.ui?.popupTitle
          }
        );
        
        // Config'i PWA paketine ekle
        await pwaConfigManager.exportConfigToPackage(jobId, pwaPath);
        console.log('✅ PWA Config pakete eklendi');
        
        // Service Worker'ı oluştur (tüm dosyaları cache'e ekle)
        await this.generateServiceWorker(pwaPath, appName, appVersion);
        
        // index.html'e download-manager.js script'ini ekle
        await this.injectDownloadManagerToHTML(pwaPath);
        
      } catch (error) {
        console.log('❌ PWA Config kaydetme hatası:', error);
        // Hata olsa bile paketleme devam etsin
      }
    }

    // PWA'yı zip'le
    const zipPath = path.join(tempPath, `${appName.replace(/\s+/g, '-')}-PWA-v${appVersion}.zip`);
    await this.createZip(pwaPath, zipPath);

    const zipSize = (await fs.stat(zipPath)).size;

    console.log('✅ PWA paketi oluşturuldu:', zipPath);
    console.log('📦 Paket boyutu:', this.formatBytes(zipSize));

    return {
      platform: 'pwa',
      packages: [
        {
          type: 'PWA',
          filename: path.basename(zipPath),
          path: zipPath,
          size: zipSize,
          message: 'Tarayıcıdan masaüstüne eklenebilir, tam offline destek'
        }
      ]
    };
  }

  async generateServiceWorker(pwaPath, appName, appVersion) {
    try {
      console.log('🔧 Service Worker oluşturuluyor...');
      
      // Tüm dosyaları tara
      const allFiles = await this.getAllFilesRecursive(pwaPath);
      
      // PWA root'una göre relative path'lere çevir
      const relativeFiles = allFiles
        .map(file => '/' + path.relative(pwaPath, file).replace(/\\/g, '/'))
        .filter(file => {
          // Gereksiz dosyaları filtrele
          return !file.includes('node_modules') &&
                 !file.includes('.git') &&
                 !file.includes('sw.js') && // Service Worker'ın kendisini ekleme
                 !file.endsWith('.map') &&
                 !file.endsWith('.DS_Store');
        });
      
      // Kritik dosyaları belirle (install sırasında cache'lenecek)
      const criticalFiles = relativeFiles.filter(file => {
        return file === '/' ||
               file === '/index.html' ||
               file === '/manifest.json' ||
               file === '/ico.png' ||
               file === '/download-manager.js' ||
               file === '/pwa-config.json' ||
               file.startsWith('/scripts/') ||  // Tüm JS dosyaları
               file.startsWith('/styles/') ||   // Tüm CSS dosyaları
               file.startsWith('/images/logo'); // Logo dosyaları
      });
      
      console.log(`📦 ${relativeFiles.length} dosya toplam, ${criticalFiles.length} kritik dosya`);
      
      // Template'i oku
      const templatePath = path.join(__dirname, 'pwa-assets/sw-template.js');
      let swContent = await fs.readFile(templatePath, 'utf-8');
      
      // Placeholder'ları değiştir
      const cacheName = appName.toLowerCase().replace(/\s+/g, '-') + '-v' + appVersion;
      const cachePrefix = appName.toLowerCase().replace(/\s+/g, '-');
      
      // Kritik dosyaları JSON array olarak formatla
      const criticalFilesJson = criticalFiles
        .map(file => `  '${file}'`)
        .join(',\n');
      
      // Tüm dosyaları JSON array olarak formatla
      const allFilesJson = relativeFiles
        .map(file => `  '${file}'`)
        .join(',\n');
      
      swContent = swContent
        .replace(/{{APP_NAME}}/g, appName)
        .replace(/{{APP_VERSION}}/g, appVersion)
        .replace(/{{CACHE_NAME}}/g, cacheName)
        .replace(/{{CACHE_PREFIX}}/g, cachePrefix)
        .replace('{{CRITICAL_FILES_LIST}}', allFilesJson);
      
      // Service Worker'ı yaz
      const swPath = path.join(pwaPath, 'sw.js');
      await fs.writeFile(swPath, swContent, 'utf-8');
      
      console.log('✅ Service Worker oluşturuldu');
    } catch (error) {
      console.error('❌ Service Worker oluşturma hatası:', error);
    }
  }

  async getAllFilesRecursive(dir) {
    const files = [];
    
    async function scan(currentDir) {
      const items = await fs.readdir(currentDir);
      
      for (const item of items) {
        const fullPath = path.join(currentDir, item);
        const stat = await fs.stat(fullPath);
        
        if (stat.isDirectory()) {
          await scan(fullPath);
        } else {
          files.push(fullPath);
        }
      }
    }
    
    await scan(dir);
    return files;
  }

  async injectDownloadManagerToHTML(pwaPath) {
    try {
      const indexPath = path.join(pwaPath, 'index.html');
      
      if (!await fs.pathExists(indexPath)) {
        console.log('⚠️ index.html bulunamadı, PWA scriptleri eklenemedi');
        return;
      }

      let html = await fs.readFile(indexPath, 'utf-8');
      
      // PWA meta taglerini <head>'e ekle
      const pwaMetaTags = `
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="apple-touch-icon" href="/ico.png">`;
      
      if (html.includes('</head>') && !html.includes('rel="manifest"')) {
        html = html.replace('</head>', `${pwaMetaTags}\n</head>`);
        console.log('✅ PWA meta tagleri eklendi');
      }
      
      // Service Worker kaydı ve download-manager.js'i </body> etiketinden önce ekle
      const pwaScripts = `
  <!-- PWA Service Worker -->
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then(registration => {
            console.log('[PWA] Service Worker kayıtlı:', registration.scope);
          })
          .catch(error => {
            console.error('[PWA] Service Worker kayıt hatası:', error);
          });
      });
    }
  </script>
  <script src="/download-manager.js"></script>`;
      
      if (html.includes('</body>')) {
        html = html.replace('</body>', `${pwaScripts}\n</body>`);
        await fs.writeFile(indexPath, html, 'utf-8');
        console.log('✅ Service Worker kaydı ve Download Manager eklendi');
      } else {
        console.log('⚠️ </body> etiketi bulunamadı, PWA scriptleri eklenemedi');
      }
    } catch (error) {
      console.error('❌ PWA script enjeksiyon hatası:', error);
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  async runElectronBuilder(configPath, platform, outputPath) {
    return new Promise((resolve, reject) => {
      const absoluteConfigPath = path.resolve(configPath);
      const args = ['--config', absoluteConfigPath, '--publish', 'never'];

      if (platform) {
        args.push(`--${platform}`);
      }

      const appDir = path.join(path.dirname(configPath), 'app');
      const electronBuilderBin = this.resolveElectronBuilderBinary();

      console.log('🔧 Electron Builder başlatılıyor:');
      console.log(`  - Platform: ${platform}`);
      console.log(`  - Config: ${absoluteConfigPath}`);
      console.log(`  - App Dir: ${appDir}`);
      console.log(`  - Binary: ${electronBuilderBin.command}`);
      console.log(`  - Binary Args: ${electronBuilderBin.args.join(' ')}`);
      console.log(`  - Extra Args: ${args.join(' ')}`);

      const child = spawn(electronBuilderBin.command, [...electronBuilderBin.args, ...args], {
        cwd: appDir,
        stdio: 'pipe',
        shell: false,
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
        const message = data.toString();
        output += message;
        console.log('🔨 Electron Builder:', message.trim());
      });

      child.stderr.on('data', (data) => {
        const message = data.toString();
        errorOutput += message;
        console.error('❌ Electron Builder Error:', message.trim());
      });

      child.on('error', (error) => {
        console.error('❌ Electron Builder başlatma hatası:', error);
        reject(new Error(`Failed to start Electron Builder: ${error.message}`));
      });

      child.on('close', async (code) => {
        console.log(`🏁 Electron Builder tamamlandı (exit code: ${code})`);
        if (code === 0) {
          resolve(output);
        } else {
          // Exit code 1 olsa bile Setup dosyası oluşturulmuş mu kontrol et
          // (updateInfoBuilder hatası Setup dosyasını etkilemez)
          const glob = require('glob');
          if (platform === 'win') {
            const setupFiles = glob.sync(path.join(outputPath, '**/*Setup.exe'));
            if (setupFiles.length > 0) {
              console.log('⚠️ Electron Builder hata verdi ama Setup dosyası oluşturuldu:', setupFiles[0]);
              console.log('✅ Paketleme başarılı sayılıyor (update info hatası ignore edildi)');
              return resolve(output);
            }
          }

          console.error('❌ Tam hata çıktısı:', errorOutput || output);
          reject(new Error(`Electron Builder ${platform} build failed (exit code ${code})`));
        }
      });
    });
  }

  resolveElectronBuilderBinary() {
    const localBin = path.resolve('node_modules/.bin/electron-builder');
    if (fs.existsSync(localBin)) {
      return { command: localBin, args: [] };
    }

    if (process.platform === 'win32') {
      const cmd = path.resolve('node_modules/.bin/electron-builder.cmd');
      if (fs.existsSync(cmd)) {
        return { command: cmd, args: [] };
      }
    }

    return { command: 'npx', args: ['electron-builder'] };
  }

  // Install APK to connected Android device
  async installAPKToDevice(apkPath, appName) {
    const { spawn } = require('child_process');
    
    try {
      console.log('📱 Android cihaza APK yükleme başlıyor...');
      console.log('📋 APK dosyası:', path.basename(apkPath));
      
      // Check for connected devices first
      const devices = await this.checkConnectedDevices();
      if (devices.length === 0) {
        throw new Error('Hiçbir Android cihaz bağlı değil. Lütfen cihazınızı bağlayın ve USB debugging\'i etkinleştirin.');
      }
      
      console.log(`✅ ${devices.length} Android cihaz tespit edildi`);
      
      // Install APK to the first device
      return new Promise((resolve, reject) => {
        // Get absolute path and escape properly
        const absolutePath = path.resolve(apkPath);
        console.log('📱 Installing APK from:', absolutePath);
        
        const child = spawn('adb', ['install', '-r', absolutePath], { 
          shell: false, // Use shell: false to avoid path issues
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let output = '';
        let errorOutput = '';
        
        child.stdout.on('data', (data) => {
          output += data.toString();
          console.log('ADB Install:', data.toString());
        });
        
        child.stderr.on('data', (data) => {
          errorOutput += data.toString();
          console.error('ADB Install Error:', data.toString());
        });
        
        child.on('close', (code) => {
          if (code === 0 && output.includes('Success')) {
            console.log(`✅ ${appName} başarıyla Android cihaza yüklendi!`);
            resolve({
              success: true,
              message: `${appName} başarıyla cihaza yüklendi`,
              devices: devices,
              output: output
            });
          } else {
            console.error(`❌ APK yükleme başarısız: ${errorOutput}`);
            reject(new Error(`APK yükleme başarısız: ${errorOutput || 'Bilinmeyen hata'}`));
          }
        });
        
        child.on('error', (error) => {
          reject(new Error(`ADB install komutu çalıştırılamadı: ${error.message}`));
        });
      });
      
    } catch (error) {
      console.error('❌ APK yükleme hatası:', error);
      throw error;
    }
  }

  // Check connected Android devices
  // Capacitor projesi başlatma (Web arayüzü için)
  async initializeCapacitorProject(webAppPath, appName, appVersion, logoPath, workingPath) {
    console.log('Capacitor projesi hazırlanıyor...');
    
    // Web app'i www klasörüne kopyala
    const wwwPath = path.join(webAppPath, 'www');
    await fs.ensureDir(wwwPath);
    await fs.copy(workingPath, wwwPath);
    
    // Android platform ekle
    try {
      await this.runCapacitorCommand('add', ['android'], webAppPath);
    } catch (error) {
      console.log('Android platform zaten mevcut veya ekleme hatası:', error.message);
    }

    // Yatay ekranı native seviyede zorla (web JS lock Capacitor'da güvenilir değil)
    await this.configureAndroidManifest(webAppPath);

    // Tam ekran (immersive) — status + navigation bar'ı native gizle
    await this.configureAndroidFullscreen(webAppPath);

    // www/index.html'e viewport + fullscreen enjekte et (cap sync bunu kopyalar)
    await this.enableAndroidFullscreen(wwwPath);

    // Kitap viewer'larını WebView'e uyumlu hale getir: viewport normalize +
    // window.require shim (Electron butonları çökmesin) + window.isApp=true zorla
    // (localStorage kalıcılık: tour skip, kalınan sayfa, arka plan kaydedilsin).
    await this.normalizeBookViewerViewports(wwwPath);

    // Logo setup (eğer varsa)
    if (logoPath && await fs.pathExists(logoPath)) {
      await this.setupCapacitorIcons(webAppPath, logoPath, appName);
    }

    console.log('Capacitor projesi hazırlandı');
  }

  // AndroidManifest'i düzenle: uygulamayı YATAY ekrana kilitle.
  // sensorLandscape = her iki yatay yönü kabul eder, dikeyi engeller.
  // Web tarafındaki screen.orientation.lock Capacitor WebView'de güvenilir değil;
  // native android:screenOrientation tek otoriter yöntemdir.
  async configureAndroidManifest(webAppPath) {
    try {
      const manifestPath = path.join(
        webAppPath, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'
      );

      if (!await fs.pathExists(manifestPath)) {
        console.warn('⚠️ AndroidManifest.xml bulunamadı, orientation ayarlanamadı:', manifestPath);
        return;
      }

      let manifest = await fs.readFile(manifestPath, 'utf8');

      if (manifest.includes('android:screenOrientation')) {
        console.log('ℹ️ screenOrientation zaten tanımlı, atlanıyor');
        return;
      }

      // MainActivity <activity> etiketinin İÇİNE screenOrientation attribute'u ekle.
      // ÖNEMLİ: attribute <activity ...> etiketinin içinde olmalı; etiketten önce
      // koyarsak serbest text olur ve Android yok sayar.
      const before = manifest;
      manifest = manifest.replace(
        /<activity(\b[^>]*?android:name="\.MainActivity")/,
        '<activity android:screenOrientation="sensorLandscape"$1'
      );

      if (manifest === before) {
        // Beklenen pattern bulunamadıysa: ilk <activity etiketine ekle
        manifest = manifest.replace(
          /<activity\b/,
          '<activity android:screenOrientation="sensorLandscape"'
        );
      }

      if (manifest !== before) {
        await fs.writeFile(manifestPath, manifest);
        console.log('✅ AndroidManifest: yatay ekran (sensorLandscape) zorlandı');
      } else {
        console.warn('⚠️ MainActivity etiketi bulunamadı, orientation eklenemedi');
      }
    } catch (error) {
      console.error('❌ AndroidManifest düzenlenirken hata:', error.message);
      // Build'i durdurma — orientation olmadan da APK üretilebilir
    }
  }

  // Tam ekran (immersive) modu native seviyede zorla.
  // Web StatusBar.hide() @capacitor/status-bar plugin gerektirir; plugin'siz çalışmaz.
  // Bu yüzden (1) MainActivity.java'ya immersive-sticky flag'leri, (2) styles.xml
  // temalarına windowFullscreen ekler. İkisi birlikte status + navigation bar'ı gizler,
  // WebView tüm ekran yüksekliğini alır (içerik taşması/yanlış yükseklik düzelir).
  async configureAndroidFullscreen(webAppPath) {
    try {
      const javaRoot = path.join(webAppPath, 'android', 'app', 'src', 'main', 'java');

      // MainActivity.java'yı bul (paket adı dinamik: com.dijitap.<app>)
      const findMainActivity = async (dir) => {
        let entries = [];
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { return null; }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            const found = await findMainActivity(full);
            if (found) return found;
          } else if (e.name === 'MainActivity.java') {
            return full;
          }
        }
        return null;
      };

      const mainActivityPath = await findMainActivity(javaRoot);
      if (mainActivityPath) {
        const original = await fs.readFile(mainActivityPath, 'utf8');
        const pkgMatch = original.match(/package\s+([\w.]+)\s*;/);
        const pkg = pkgMatch ? pkgMatch[1] : null;

        if (pkg) {
          const immersive = `package ${pkg};

import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );
    }
}
`;
          await fs.writeFile(mainActivityPath, immersive);
          console.log('✅ MainActivity: immersive fullscreen eklendi');
        } else {
          console.warn('⚠️ MainActivity package adı çözülemedi, fullscreen atlandı');
        }
      } else {
        console.warn('⚠️ MainActivity.java bulunamadı, immersive eklenemedi');
      }

      // styles.xml temalarına windowFullscreen ekle (status bar gizleme + cutout)
      const stylesPath = path.join(
        webAppPath, 'android', 'app', 'src', 'main', 'res', 'values', 'styles.xml'
      );
      if (await fs.pathExists(stylesPath)) {
        let styles = await fs.readFile(stylesPath, 'utf8');
        if (!styles.includes('android:windowFullscreen')) {
          const fsItems =
            '\n        <item name="android:windowFullscreen">true</item>' +
            '\n        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>';
          // AppTheme ile başlayan her <style ...> bloğunun açılışından sonra ekle
          styles = styles.replace(
            /(<style\s+name="AppTheme[^"]*"[^>]*>)/g,
            `$1${fsItems}`
          );
          await fs.writeFile(stylesPath, styles);
          console.log('✅ styles.xml: windowFullscreen eklendi');
        }
      }
    } catch (error) {
      console.error('❌ Fullscreen yapılandırma hatası:', error.message);
      // Build'i durdurma
    }
  }

  // Kitap viewer SPA'larını (book*/index.html) WebView'e uyumlu hale getir:
  //   1) Viewport normalize (device-width, initial-scale=1.0)
  //   2) window.require shim enjekte (path/fs/electron stub) — Electron-bağımlı
  //      butonlar (ana ekrana dön, kapat) WebView'de çökmesin
  //   3) SPA bundle'da window.isApp=true zorla → kalıcılık localStorage'a döner
  //      (tour skip, kalınan sayfa, arka plan ayarları kaydedilir)
  // SADECE book*/ entry sayfa + top-level bundle'a dokunur (deep content'e değil).
  async normalizeBookViewerViewports(wwwPath) {
    try {
      const viewportMeta = '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">';
      const requireShim = this._buildWebViewRequireShim();
      const entries = await fs.readdir(wwwPath, { withFileTypes: true });

      for (const e of entries) {
        if (!e.isDirectory() || !/^book\d*$/i.test(e.name)) continue;
        const bookDir = path.join(wwwPath, e.name);

        // --- index.html: viewport + require shim ---
        const idx = path.join(bookDir, 'index.html');
        if (await fs.pathExists(idx)) {
          let html = await fs.readFile(idx, 'utf8');

          if (/<meta\s+name=["']viewport["'][^>]*>/i.test(html)) {
            html = html.replace(/<meta\s+name=["']viewport["'][^>]*>/i, viewportMeta);
          } else if (/<\/head>/i.test(html)) {
            html = html.replace(/<\/head>/i, viewportMeta + '</head>');
          }

          // Shim'i <head>'in HEMEN başına koy (app.config.js ve SPA bundle'larından önce)
          if (!html.includes('__webviewCompatShim')) {
            html = html.replace(/<head[^>]*>/i, (m) => m + '\n' + requireShim);
          }

          await fs.writeFile(idx, html);
          console.log(`📐 Viewport + require shim: ${e.name}/index.html`);
        }

        // --- bundle: window.isApp=true zorla (top-level .js dosyalarında) ---
        let patched = 0;
        const files = await fs.readdir(bookDir, { withFileTypes: true });
        for (const f of files) {
          if (!f.isFile() || !f.name.endsWith('.js')) continue;
          const jsPath = path.join(bookDir, f.name);
          let js = await fs.readFile(jsPath, 'utf8');
          if (js.includes('window.isApp=Boolean(')) {
            js = js.split('window.isApp=Boolean(').join('window.isApp=true||Boolean(');
            await fs.writeFile(jsPath, js);
            patched++;
          }
        }
        if (patched > 0) {
          console.log(`✅ ${e.name}: window.isApp=true zorlandı (${patched} dosya) — localStorage kalıcılık`);
        }
      }
    } catch (error) {
      console.error('❌ Book viewer WebView uyumluluk hatası:', error.message);
    }
  }

  // WebView'de eksik olan window.require'ı Electron/Node stub'larıyla taklit eden script.
  // Kitap Electron modunda export edilse bile require("path"/"fs"/"electron") çökmesin.
  _buildWebViewRequireShim() {
    return `<script id="__webviewCompatShim">
(function(){
  if (typeof window.require === 'function') return;

  // path: join '..' ve '.' segmentlerini ÇÖZER. Capacitor asset loader ham URL'deki
  // '..'yi (path-traversal koruması) reddettiği için home nav'da çözülmüş yol şart.
  var P = {
    sep: '/',
    dirname: function(p){ p=String(p||''); var s=p.replace(/\\/+$/,''); var i=s.lastIndexOf('/'); return i<=0 ? '/' : s.slice(0,i); },
    basename: function(p){ p=String(p||''); return p.slice(p.lastIndexOf('/')+1); },
    extname: function(p){ var m=/\\.[^.\\/]+$/.exec(String(p||'')); return m?m[0]:''; },
    join: function(){
      var parts = Array.prototype.filter.call(arguments, function(x){ return x!=null && x!==''; });
      var joined = parts.join('/');
      var origin = '';
      var mm = /^([a-zA-Z][a-zA-Z0-9+.-]*:\\/\\/[^\\/]*)/.exec(joined);
      if (mm){ origin = mm[1]; joined = joined.slice(origin.length); }
      var abs = joined.charAt(0) === '/';
      var segs = joined.split('/');
      var out = [];
      for (var i=0;i<segs.length;i++){
        var s = segs[i];
        if (s==='' || s==='.') continue;
        if (s==='..'){ if(out.length && out[out.length-1]!=='..') out.pop(); else if(!abs) out.push('..'); continue; }
        out.push(s);
      }
      var body = out.join('/');
      // origin varsa köke çözülen yolda SONDA slash bırakma:
      // join('https://localhost/book1','../') -> 'https://localhost' (NOT 'https://localhost/').
      // Aksi halde SPA buna '/index.html' ekleyince '//index.html' oluşuyor (Capacitor reddediyor).
      var res = origin
        ? (body ? '/' + body : '')
        : ((abs ? '/' : '') + body);
      return origin + res;
    }
  };

  // fs: localStorage-destekli SANAL dosya sistemi. Kitabın electron-dosya tabanlı
  // kalıcılık katmanı (kalınan sayfa, settings, answers) şeffafça localStorage'a yazılır.
  var VFS_PREFIX = '__vfs__';
  var FS = {
    existsSync: function(p){ try{ return localStorage.getItem(VFS_PREFIX+p) !== null; }catch(e){ return false; } },
    readFileSync: function(p){ try{ return localStorage.getItem(VFS_PREFIX+p); }catch(e){ return null; } },
    writeFileSync: function(p, data){ try{ localStorage.setItem(VFS_PREFIX+p, String(data)); }catch(e){} },
    copyFileSync: function(a,b){ try{ var v=localStorage.getItem(VFS_PREFIX+a); if(v!==null) localStorage.setItem(VFS_PREFIX+b,v); }catch(e){} },
    unlinkSync: function(p){ try{ localStorage.removeItem(VFS_PREFIX+p); }catch(e){} },
    mkdirSync: function(){}, readdirSync: function(){ return []; }
  };

  var ELECTRON = {
    remote: { app: { quit:function(){}, getAppPath:function(){return ''; } } },
    shell: { openExternal:function(u){ try{ window.open(u,'_blank'); }catch(e){} } },
    ipcRenderer: { send:function(){}, on:function(){}, invoke:function(){return Promise.resolve();} }
  };

  window.require = function(m){
    if (m==='path') return P;
    if (m==='fs' || m==='fs-extra') return FS;
    if (m==='electron') return ELECTRON;
    return {};
  };
})();

// Navigasyon normalize: SPA home butonu URL'i string-concat ile kursa bile
// Capacitor asset loader'a ULAŞMADAN temizle. Capacitor ham '..' yolunu (path-traversal)
// reddeder; ayrıca kök /index.html bazı sürümlerde 404 döner ama kök '/' açılışta çalışır.
// Bu yüzden: '..'/'.' çöz + KÖK '/index.html' -> '/'. (book1/index.html gibi alt sayfalar dokunulmaz.)
(function(){
  function clean(u){
    try {
      var url = new URL(String(u), document.baseURI);
      // path'teki tekrarlı '/'leri tekille (ör. //index.html -> /index.html).
      // origin'deki protokol '//' etkilenmez (o pathname'de değil).
      url.pathname = url.pathname.replace(/\\/{2,}/g, '/');
      var abs = url.href;
      // KÖK /index.html -> / (açılışta çalışan kök). Alt sayfalar (book1/index.html) korunur.
      abs = abs.replace(/^(https?:\\/\\/[^\\/]+)\\/index\\.html(\\?|#|$)/, '$1/$2');
      return abs;
    } catch(e){ return u; }
  }
  try {
    var oa = window.location.assign.bind(window.location);
    window.location.assign = function(u){ return oa(clean(u)); };
  } catch(e){}
  try {
    var orp = window.location.replace.bind(window.location);
    window.location.replace = function(u){ return orp(clean(u)); };
  } catch(e){}
  try {
    var d = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (d && d.set){
      Object.defineProperty(window.location, 'href', {
        configurable: true,
        get: function(){ return d.get.call(window.location); },
        set: function(u){ d.set.call(window.location, clean(u)); }
      });
    }
  } catch(e){}
  try {
    document.addEventListener('click', function(ev){
      try {
        var a = ev.target && ev.target.closest && ev.target.closest('a[href]');
        if (a){ var h0 = a.getAttribute('href'); var c = clean(h0); if (c !== h0) a.setAttribute('href', c); }
      } catch(e){}
    }, true);
  } catch(e){}
})();
</script>`;
  }

  // Capacitor için icon setup (Web arayüzü versiyonu)
  // Capacitor 7 template'i adaptive icon (mipmap-anydpi-v26/ic_launcher.xml) kullanır;
  // bu XML API 26+'da düz PNG'yi gölgeler. Garantili görünür ikon için:
  //   1) Her density'ye ic_launcher.png + ic_launcher_round.png üret
  //   2) Çakışan .webp varyantlarını sil (aynı isim = duplicate resource = build FAIL)
  //   3) mipmap-anydpi-v26 (adaptive XML) klasörünü sil → PNG otoriter olur
  async setupCapacitorIcons(webAppPath, logoPath, appName) {
    const sharp = require('sharp');
    console.log('🖼️ Capacitor Android icon setup başlatılıyor:', appName);

    try {
      const resPath = path.join(webAppPath, 'android', 'app', 'src', 'main', 'res');

      const densities = [
        { name: 'mipmap-mdpi', size: 48 },
        { name: 'mipmap-hdpi', size: 72 },
        { name: 'mipmap-xhdpi', size: 96 },
        { name: 'mipmap-xxhdpi', size: 144 },
        { name: 'mipmap-xxxhdpi', size: 192 }
      ];

      const white = { r: 255, g: 255, b: 255, alpha: 1 };

      for (const density of densities) {
        const densityPath = path.join(resPath, density.name);
        await fs.ensureDir(densityPath);

        // Çakışmayı önle: template .webp kullanıyorsa aynı isimli .png ekleyince
        // "duplicate resources" hatası olur. Önce .webp varyantlarını kaldır.
        for (const f of ['ic_launcher.webp', 'ic_launcher_round.webp', 'ic_launcher_foreground.webp']) {
          await fs.remove(path.join(densityPath, f));
        }

        // Logoyu kareye sığdır (contain + beyaz zemin) — geniş logolar bozulmaz
        const iconBuffer = await sharp(logoPath)
          .resize(density.size, density.size, { fit: 'contain', background: white })
          .flatten({ background: white })
          .png()
          .toBuffer();

        await fs.writeFile(path.join(densityPath, 'ic_launcher.png'), iconBuffer);
        await fs.writeFile(path.join(densityPath, 'ic_launcher_round.png'), iconBuffer);

        console.log(`  ✓ ${density.name} (${density.size}x${density.size})`);
      }

      // Adaptive icon XML'lerini kaldır → düz PNG her API'de kullanılır
      await fs.remove(path.join(resPath, 'mipmap-anydpi-v26'));
      console.log('  ✓ mipmap-anydpi-v26 (adaptive XML) kaldırıldı — PNG otoriter');

      console.log('✅ Capacitor Android iconları başarıyla oluşturuldu!');

    } catch (error) {
      console.error('❌ Capacitor icon setup hatası:', error.message);
      // Devam et, icon olmasa da APK oluşabilir
    }
  }

  // Gradle build çalıştırıcı
  // Android build için uygun JAVA_HOME'u çöz. Hardcode etme — makine/sürüm değişir.
  // Capacitor 7 (AGP 8.7.2) JDK 21 ister; bu yüzden adaylar arasından 21+ olanı seçer.
  // Sırayla: env JAVA_HOME → Homebrew openjdk@21 (intel+arm) → `/usr/libexec/java_home`.
  // 21+ yoksa ilk geçerli JDK'ya düşer (gradle net "Java 21 gerekli" hatası verir).
  getJavaHome() {
    if (this._javaHomeCache !== undefined) return this._javaHomeCache;

    const javaMajor = (home) => {
      try {
        const bin = home && path.join(home, 'bin', 'java');
        if (!bin || !fs.existsSync(bin)) return 0;
        const { execSync } = require('child_process');
        const out = execSync(`"${bin}" -version 2>&1`, { encoding: 'utf8' });
        const m = out.match(/version "(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      } catch (e) {
        return 0;
      }
    };

    const candidates = [];
    if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);
    candidates.push('/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'); // Homebrew (Intel)
    candidates.push('/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'); // Homebrew (Apple Silicon)
    try {
      const { execSync } = require('child_process');
      const def = execSync('/usr/libexec/java_home', { encoding: 'utf8' }).trim();
      if (def) candidates.push(def);
    } catch (e) {
      console.error('⚠️ /usr/libexec/java_home çözülemedi:', e.message);
    }

    // Önce JDK 21+ olan ilk geçerli home
    for (const c of candidates) {
      if (javaMajor(c) >= 21) { this._javaHomeCache = c; return c; }
    }
    // 21 yoksa ilk geçerli JDK (build muhtemelen sürüm hatası verecek ama net mesajla)
    for (const c of candidates) {
      if (javaMajor(c) >= 1) {
        console.warn(`⚠️ JDK 21 bulunamadı, ${c} kullanılıyor — Capacitor 7 JDK 21 ister.`);
        this._javaHomeCache = c;
        return c;
      }
    }

    this._javaHomeCache = '';
    return this._javaHomeCache;
  }

  async runGradleBuild(webAppPath, task) {
    const { spawn } = require('child_process');

    return new Promise(async (resolve, reject) => {
      const androidPath = path.join(webAppPath, 'android');
      const gradlePath = path.join(androidPath, 'gradlew');
      
      // Gradle wrapper dosyasının varlığını kontrol et
      if (!await fs.pathExists(gradlePath)) {
        reject(new Error(`Gradle wrapper bulunamadı: ${gradlePath}`));
        return;
      }
      
      // Gradle wrapper'ı executable yap
      try {
        await fs.chmod(gradlePath, 0o755);
        console.log('✅ Gradle wrapper executable yapıldı');
      } catch (chmodError) {
        console.error('⚠️ Gradle wrapper chmod hatası:', chmodError.message);
      }
      
      console.log(`🔧 Gradle task çalıştırılıyor: ${task}`);
      console.log(`📁 Working directory: ${androidPath}`);
      console.log(`🛠️ Gradle path: ${gradlePath}`);
      
      const buildEnv = {
        ...process.env,
        ANDROID_HOME: process.env.ANDROID_HOME || '/Users/nadir/Library/Android/sdk',
        ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || '/Users/nadir/Library/Android/sdk'
      };
      const javaHome = this.getJavaHome();
      if (javaHome) buildEnv.JAVA_HOME = javaHome;

      const child = spawn('./gradlew', [task], {
        cwd: androidPath,
        shell: true,
        env: buildEnv
      });
      
      let output = '';
      let errorOutput = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString();
        console.log('Gradle:', data.toString().trim());
      });
      
      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.error('Gradle Error:', data.toString().trim());
      });
      
      child.on('close', (code) => {
        console.log(`📋 Gradle task tamamlandı (exit code: ${code})`);
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Gradle build failed: ${task}\n${errorOutput}`));
        }
      });
      
      child.on('error', (error) => {
        console.error('❌ Gradle spawn hatası:', error);
        reject(error);
      });
    });
  }

  async checkConnectedDevices() {
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
      const child = spawn('adb', ['devices'], { shell: false });
      
      let output = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          // Parse connected devices
          const lines = output.split('\n');
          const devices = lines
            .slice(1) // Skip "List of devices attached" line
            .filter(line => line.trim() && line.includes('device'))
            .map(line => {
              const parts = line.split('\t');
              return {
                id: parts[0],
                status: parts[1]
              };
            });
            
          console.log('📱 Bağlı Android cihazlar:', devices);
          resolve(devices);
        } else {
          reject(new Error('ADB devices komutu başarısız'));
        }
      });
      
      child.on('error', (error) => {
        reject(new Error(`ADB kullanılamıyor: ${error.message}`));
      });
    });
  }

  async createZip(sourceDir, outputPath) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        resolve(outputPath);
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }

  sanitizeAppName(appName) {
    // Electron Builder icin gecerli package name olustur
    return appName
      .toLowerCase()
      // Turkce karakterleri degistir
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      // Boslukları ve ozel karakterleri tire ile degistir
      .replace(/[^a-z0-9]+/g, '-')
      // Basta ve sonda tire olmamasi icin
      .replace(/^-+|-+$/g, '')
      // Cift tireleri tek tire yap
      .replace(/-+/g, '-')
      // En az 1 karakter olmasi icin, bossa default deger
      || 'electron-app';
  }

  normalizeSemver(version) {
    // Versiyon numarasını semver formatına çevir (major.minor.patch)
    // Örnekler: "2.0" -> "2.0.0", "1" -> "1.0.0", "1.2.3" -> "1.2.3"
    if (!version) return '1.0.0';
    
    const parts = version.toString().split('.');
    
    // Major
    const major = parts[0] || '1';
    // Minor
    const minor = parts[1] || '0';
    // Patch
    const patch = parts[2] || '0';
    
    return `${major}.${minor}.${patch}`;
  }

  // Gelismis kurulum animasyonu icin NSIS script dosyalari olustur
  async createCustomInstallationFiles(workingPath, appName, companyName, logoPath, updateInfo = null) {
    console.log('🎨 Gelismis kurulum animasyonu hazirlaniyor...');
    
    const buildDir = path.join(workingPath, 'build');
    await fs.ensureDir(buildDir);
    
    // Logo dosyasini build dizinine kopyala
    let logoFileName = 'logo.png';
    let sourceLogo = null;
    
    if (logoPath && await fs.pathExists(logoPath)) {
      sourceLogo = logoPath;
      await fs.copy(logoPath, path.join(buildDir, logoFileName));
      console.log('\u2705 Logo build dizinine kopyalandi');
    } else {
      // Eger images/logo.png varsa onu kullan
      const imagesLogoPath = path.join(workingPath, 'images', 'logo.png');
      if (await fs.pathExists(imagesLogoPath)) {
        sourceLogo = imagesLogoPath;
        await fs.copy(imagesLogoPath, path.join(buildDir, logoFileName));
        console.log('\u2705 Images klasorundeki logo kullanildi');
      } else {
        // Varsayilan logo olustur
        const sharp = require('sharp');
        const defaultLogoPath = path.join(buildDir, logoFileName);
        await sharp({
          create: {
            width: 128,
            height: 128,
            channels: 4,
            background: { r: 52, g: 152, b: 219, alpha: 1 }
          }
        })
        .png()
        .toFile(defaultLogoPath);
        sourceLogo = defaultLogoPath;
        console.log('\ud83d\uddbc\ufe0f Varsayilan logo olusturuldu');
      }
    }
    
    // NSIS installer header ve sidebar BMP dosyalarini olustur\n    if (sourceLogo) {\n      const sharp = require('sharp');\n      \n      // Installer Header: 150x57 BMP (beyaz arkaplan + logo)\n      const headerPath = path.join(buildDir, 'installerHeader.bmp');\n      await sharp(sourceLogo)\n        .resize(50, 50, {\n          fit: 'contain',\n          background: { r: 255, g: 255, b: 255, alpha: 1 }\n        })\n        .extend({\n          top: 3,\n          bottom: 4,\n          left: 50,\n          right: 50,\n          background: { r: 255, g: 255, b: 255, alpha: 1 }\n        })\n        .toFormat('bmp')\n        .toFile(headerPath);\n      console.log('\u2705 Installer header BMP olusturuldu: 150x57');\n      \n      // Installer Sidebar: 164x314 BMP (beyaz arkaplan + logo)\n      const sidebarPath = path.join(buildDir, 'installerSidebar.bmp');\n      await sharp(sourceLogo)\n        .resize(120, 120, {\n          fit: 'contain',\n          background: { r: 255, g: 255, b: 255, alpha: 1 }\n        })\n        .extend({\n          top: 97,\n          bottom: 97,\n          left: 22,\n          right: 22,\n          background: { r: 255, g: 255, b: 255, alpha: 1 }\n        })\n        .toFormat('bmp')\n        .toFile(sidebarPath);\n      console.log('\u2705 Installer sidebar BMP olusturuldu: 164x314');\n    }
    
    // Update bilgisine gore detayli mesajlari hazirla
    const companyText = companyName ? companyName : 'Dijitap';
    let installationMessages = '';
    let speedMessage = '';
    let updateTypeMessage = 'Yeni kurulum yapiliyor...';
    
    if (updateInfo && updateInfo.hasExistingInstallation) {
      if (updateInfo.updateType === 'identical') {
        // Identical dosyalar - quick launch mode
        installationMessages = `
  DetailPrint "HIZLI BASLAT MODU - Tum dosyalar ayni!"
  DetailPrint "Onceki kurulum: v${updateInfo.previousVersion} -> v${updateInfo.currentVersion}"
  DetailPrint "Degisiklik yok - direkt aciliyor..."
  DetailPrint "Normal kurulum: ~30 saniye | Hizli: ~1 saniye"
  Sleep 800`;
        speedMessage = 'Hiz Kazanci: 30x daha hizli!';
        updateTypeMessage = 'Ayni dosyalar tespit edildi - Hizli acilis!';
      } else if (updateInfo.updateType === 'incremental') {
        // Incremental update
        const totalFiles = updateInfo.changedFiles.length + updateInfo.newFiles.length + updateInfo.unchangedFiles.length;
        const changedPercent = Math.round(((updateInfo.changedFiles.length + updateInfo.newFiles.length) / totalFiles) * 100);
        const skipPercent = Math.round((updateInfo.unchangedFiles.length / totalFiles) * 100);
        
        installationMessages = `
  DetailPrint "ARTIMSAL GUNCELLEME MODU"
  DetailPrint "Onceki kurulum: v${updateInfo.previousVersion} -> v${updateInfo.currentVersion}"
  DetailPrint "Toplam dosya: ${totalFiles}"
  DetailPrint "- Degisen: ${updateInfo.changedFiles.length} (${changedPercent}%)"
  DetailPrint "- Yeni: ${updateInfo.newFiles.length}"
  DetailPrint "- Atlanacak: ${updateInfo.unchangedFiles.length} (${skipPercent}%)"
  ${updateInfo.deletedFiles && updateInfo.deletedFiles.length > 0 ? `DetailPrint "- Silinecek: ${updateInfo.deletedFiles.length}"` : ''}
  DetailPrint "Sadece degisen dosyalar guncelleniyor..."
  Sleep 2000`;
        speedMessage = updateInfo.speedImprovement || '3x daha hizli!';
        updateTypeMessage = `Artimsal guncelleme - ${updateInfo.unchangedFiles.length} dosya atlanacak`;
      }
    } else {
      // Fresh installation
      installationMessages = `
  DetailPrint "YENI KURULUM - Ilk kez yukleniyor"
  DetailPrint "Tum dosyalar kopyalanacak"
  DetailPrint "Masaustu kisayolu olusturulacak"
  Sleep 1500`;
      updateTypeMessage = 'Ilk kurulum - Tum dosyalar kopyalaniyor';
    }
    
    // Gelismis NSIS script - Detayli bilgiler ve abartisiz animasyon
    const nsisScript = `
# ${appName} - Gelismis Kurulum Script
# Artimsal guncelleme destegi ve detayli bilgiler

# Ana kurulum bolumu - Detayli progress tracking
Section "MainInstall" SEC01
  SetDetailsPrint both
  
  DetailPrint "==========================================="
  DetailPrint "    ${appName} - ${updateTypeMessage}"
  DetailPrint "==========================================="
  ${installationMessages}
  
  DetailPrint "[10%] Kurulum hazirliklari yapiliyor..."
  Sleep 500
  
  DetailPrint "[30%] Dosyalar isleniye basliyor..."
  Sleep 800
  
  DetailPrint "[50%] Ana uygulama dosyalari kopyalaniyor..."
  Sleep 1000
  
  DetailPrint "[70%] Yapilandirma dosyalari guncelleniyor..."
  Sleep 600
  
  DetailPrint "[85%] Masaustu kisayolu olusturuluyor..."
  Sleep 400
  
  DetailPrint "[95%] Son kontroller ve temizlik..."
  Sleep 300
  
  DetailPrint "==========================================="
  DetailPrint "    KURULUM TAMAMLANDI! ✓"
  DetailPrint "==========================================="
  DetailPrint "${appName} basariyla kuruldu!"
  DetailPrint "Kurum: ${companyText}"
  ${speedMessage ? `DetailPrint "${speedMessage}"` : ''}
  DetailPrint "Masaustu kisayolu eklendi."
  DetailPrint "Uygulama simdi otomatik acilacak..."
  
  # Etkileşimsiz kurulum - MessageBox yok
  # DetailPrint mesajları yeterli
SectionEnd

# Opsiyonel: Kurulum sonrasi bilgi gosterimi
!macro customFinishPageAction
  DetailPrint "Kurulum sureci tamamlandi - ${new Date().toLocaleString('tr-TR')}"
  ${updateInfo && updateInfo.hasExistingInstallation ? 'DetailPrint "Onceki kurulum uzerine guncelleme yapildi"' : 'DetailPrint "Yeni kurulum basariyla tamamlandi"'}
!macroend
`;
    
    const nsisPath = path.join(buildDir, 'installer.nsh');
    await fs.writeFile(nsisPath, nsisScript.trim());
    
    console.log('✅ Gelismis NSIS kurulum animasyonu olusturuldu');
    console.log(`  - Build dir: ${buildDir}`);
    console.log(`  - Logo: ${logoFileName}`);
    console.log(`  - NSIS Script: installer.nsh`);
    console.log(`  - Update Type: ${updateInfo ? updateInfo.updateType : 'fresh'}`);
    console.log(`  - Features: Detayli progress, artimsal guncelleme, Turkce mesajlar`);
    
    // Kurulum rehberi dosyasi olustur
    const installGuide = `# ${appName} - Kurulum Rehberi

## Kurulum Bilgileri
- **Uygulama**: ${appName}
- **Kurum**: ${companyText}
- **Platform**: Windows (NSIS)
- **Kurulum Tipi**: ${updateInfo ? updateInfo.updateType : 'fresh'}
${updateInfo && updateInfo.hasExistingInstallation ? `- **Onceki Versiyon**: ${updateInfo.previousVersion}` : ''}
${speedMessage ? `- **Hiz Kazanci**: ${speedMessage}` : ''}

## Ozellikler
- ✅ Tek tiklamayla otomatik kurulum
- ✅ Yonetici izni otomatik alinir
- ✅ Masaustu kisayolu otomatik olusur
- ✅ Kurulum sonrasi otomatik acilir
- ✅ Artimsal guncelleme destegi
${updateInfo && updateInfo.unchangedFiles && updateInfo.unchangedFiles.length > 0 ? `- ✅ ${updateInfo.unchangedFiles.length} dosya atlanarak hizlandirildi` : ''}

## Kurulum Konumu
\`\`\`
$LocalAppData\\Programs\\dijitap\\${companyText}\\${appName}
\`\`\`

---
*Bu dosya otomatik olusturulmustur - ${new Date().toLocaleString('tr-TR')}*
`;
    
    await fs.writeFile(path.join(buildDir, 'KURULUM_REHBERI.md'), installGuide);
  }

  // PWA Helper Functions
  async generateAdvancedServiceWorker(appName, appVersion, pwaPath) {
    const cacheName = `${appName.toLowerCase().replace(/\s+/g, '-')}-v${appVersion}`;
    
    // Tüm dosyaları tara
    const allFiles = [];
    const scanDir = async (dir, baseDir = pwaPath) => {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          await scanDir(fullPath, baseDir);
        } else {
          const relativePath = '/' + path.relative(baseDir, fullPath).replace(/\\\\/g, '/');
          if (!relativePath.includes('node_modules') && !relativePath.includes('.git')) {
            allFiles.push(relativePath);
          }
        }
      }
    };
    
    await scanDir(pwaPath);
    
    // Kritik dosyalar (önce bunlar cache'lenir)
    const criticalFiles = allFiles.filter(f => 
      f.endsWith('.html') || 
      f.endsWith('.css') || 
      f.endsWith('.js') ||
      f.endsWith('.json') ||
      f.endsWith('.png') ||
      f.endsWith('.jpg') ||
      f.endsWith('.svg')
    ).slice(0, 50); // İlk 50 kritik dosya
    
    return `
// ${appName} - Service Worker v${appVersion}
// Gelişmiş offline support ve otomatik güncelleme

const CACHE_NAME = '${cacheName}';
const CRITICAL_CACHE = '${cacheName}-critical';
const RUNTIME_CACHE = '${cacheName}-runtime';

// Kritik dosyalar (hemen cache'lenir)
const CRITICAL_FILES = ${JSON.stringify(criticalFiles, null, 2)};

// Install event - kritik dosyaları cache'le
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(CRITICAL_CACHE)
      .then((cache) => {
        console.log('[SW] Caching critical files...');
        return cache.addAll(CRITICAL_FILES);
      })
      .then(() => {
        console.log('[SW] Critical files cached successfully');
        return self.skipWaiting(); // Hemen aktif et
      })
      .catch((error) => {
        console.error('[SW] Failed to cache critical files:', error);
      })
  );
});

// Activate event - eski cache'leri temizle
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CRITICAL_CACHE && 
              cacheName !== RUNTIME_CACHE &&
              cacheName.startsWith('${appName.toLowerCase().replace(/\s+/g, '-')}')) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] Service worker activated');
      return self.clients.claim(); // Tüm client'ları kontrol et
    })
  );
});

// Fetch event - Cache-First stratejisi
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Sadece same-origin istekleri cache'le
  if (url.origin !== location.origin) {
    return;
  }
  
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Cache'de var, arka planda güncelle
          fetchAndCache(request);
          return cachedResponse;
        }
        
        // Cache'de yok, internetten al
        return fetchAndCache(request);
      })
      .catch(() => {
        // Hata durumunda offline sayfası
        if (request.mode === 'navigate') {
          return caches.match('/offline.html');
        }
      })
  );
});

// Fetch ve cache helper
async function fetchAndCache(request) {
  try {
    const response = await fetch(request);
    
    if (response.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    console.error('[SW] Fetch failed:', error);
    throw error;
  }
}

// Background sync için güncelleme kontrolü
self.addEventListener('sync', (event) => {
  if (event.tag === 'update-check') {
    event.waitUntil(checkForUpdates());
  }
});

async function checkForUpdates() {
  try {
    const response = await fetch('/api/version');
    const { version } = await response.json();
    
    if (version !== '${appVersion}') {
      console.log('[SW] New version available:', version);
      
      // Kullanıcıya bildirim göster
      self.registration.showNotification('Güncelleme Hazır!', {
        body: 'Yeni sürüm indirildi. Uygulamayı yeniden başlatın.',
        icon: '/logo-192.png',
        badge: '/logo-72.png',
        tag: 'update-notification',
        requireInteraction: true,
        actions: [
          { action: 'reload', title: 'Yeniden Başlat' },
          { action: 'dismiss', title: 'Sonra' }
        ]
      });
    }
  } catch (error) {
    console.error('[SW] Update check failed:', error);
  }
}

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'reload') {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        clientList.forEach((client) => {
          client.navigate(client.url);
        });
      })
    );
  }
});

console.log('[SW] Service Worker loaded - ${appName} v${appVersion}');
`;
  }

  generateInstallHelper(appName) {
    return `
// ${appName} - PWA Install Helper
// Kullanıcıya "Masaüstüne Ekle" butonu gösterir

let deferredPrompt;
let installButton;

// Install prompt'u yakala
window.addEventListener('beforeinstallprompt', (e) => {
  console.log('[Install] beforeinstallprompt event fired');
  e.preventDefault();
  deferredPrompt = e;
  
  showInstallButton();
});

// Install butonu göster
function showInstallButton() {
  // Buton zaten varsa göster
  installButton = document.getElementById('pwa-install-btn');
  
  if (!installButton) {
    // Buton yoksa oluştur
    installButton = document.createElement('button');
    installButton.id = 'pwa-install-btn';
    installButton.innerHTML = \`
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      Masaüstüne Ekle
    \`;
    installButton.style.cssText = \`
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 50px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 9999;
      transition: all 0.3s ease;
      animation: slideIn 0.5s ease;
    \`;
    
    // Hover efekti
    installButton.onmouseenter = () => {
      installButton.style.transform = 'translateY(-2px)';
      installButton.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6)';
    };
    
    installButton.onmouseleave = () => {
      installButton.style.transform = 'translateY(0)';
      installButton.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)';
    };
    
    // Animasyon ekle
    const style = document.createElement('style');
    style.textContent = \`
      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      
      @keyframes pulse {
        0%, 100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.05);
        }
      }
      
      #pwa-install-btn:active {
        transform: scale(0.95) !important;
      }
    \`;
    document.head.appendChild(style);
    
    document.body.appendChild(installButton);
  }
  
  installButton.style.display = 'flex';
  
  // Dikkat çekmek için pulse animasyonu
  setTimeout(() => {
    installButton.style.animation = 'pulse 2s infinite';
  }, 2000);
  
  // Click handler
  installButton.addEventListener('click', async () => {
    if (!deferredPrompt) {
      console.log('[Install] No deferred prompt available');
      return;
    }
    
    // Prompt'u göster
    deferredPrompt.prompt();
    
    // Kullanıcının seçimini bekle
    const { outcome } = await deferredPrompt.userChoice;
    console.log(\`[Install] User choice: \${outcome}\`);
    
    if (outcome === 'accepted') {
      console.log('[Install] PWA installed successfully!');
      showSuccessMessage();
    }
    
    // Prompt'u temizle
    deferredPrompt = null;
    installButton.style.display = 'none';
  });
}

// Başarı mesajı göster
function showSuccessMessage() {
  const message = document.createElement('div');
  message.innerHTML = \`
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 24px;
      background: #10b981;
      color: white;
      border-radius: 12px;
      box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);
      z-index: 10000;
      animation: slideIn 0.5s ease;
    ">
      <div style="display: flex; align-items: center; gap: 12px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
        <div>
          <div style="font-weight: 600; margin-bottom: 4px;">Kurulum Başarılı!</div>
          <div style="font-size: 14px; opacity: 0.9;">${appName} masaüstünüze eklendi</div>
        </div>
      </div>
    </div>
  \`;
  
  document.body.appendChild(message);
  
  setTimeout(() => {
    message.style.transition = 'opacity 0.5s ease';
    message.style.opacity = '0';
    setTimeout(() => message.remove(), 500);
  }, 5000);
}

// Uygulama zaten kurulu mu kontrol et
window.addEventListener('appinstalled', () => {
  console.log('[Install] PWA was installed');
  if (installButton) {
    installButton.style.display = 'none';
  }
});

// Standalone modda çalışıyor mu kontrol et
if (window.matchMedia('(display-mode: standalone)').matches) {
  console.log('[Install] Running in standalone mode');
}

console.log('[Install] Install helper loaded');
`;
  }

  generateOfflinePage(appName) {
    return `<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${appName} - Çevrimdışı</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .offline-container {
            background: white;
            border-radius: 20px;
            padding: 60px 40px;
            text-align: center;
            max-width: 500px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }
        
        .offline-icon {
            width: 120px;
            height: 120px;
            margin: 0 auto 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: pulse 2s infinite;
        }
        
        .offline-icon svg {
            width: 60px;
            height: 60px;
            stroke: white;
            stroke-width: 2;
        }
        
        h1 {
            font-size: 28px;
            color: #1f2937;
            margin-bottom: 16px;
        }
        
        p {
            font-size: 16px;
            color: #6b7280;
            line-height: 1.6;
            margin-bottom: 30px;
        }
        
        .retry-btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 14px 32px;
            border-radius: 50px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .retry-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
        }
        
        @keyframes pulse {
            0%, 100% {
                transform: scale(1);
            }
            50% {
                transform: scale(1.05);
            }
        }
    </style>
</head>
<body>
    <div class="offline-container">
        <div class="offline-icon">
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
        
        <h1>İnternet Bağlantısı Yok</h1>
        <p>
            ${appName} çevrimdışı çalışabilir, ancak bazı özellikler internet bağlantısı gerektirebilir.
            Lütfen internet bağlantınızı kontrol edin ve tekrar deneyin.
        </p>
        
        <button class="retry-btn" onclick="location.reload()">
            Yeniden Dene
        </button>
    </div>
</body>
</html>`;
  }

  generatePWAReadme(appName, appVersion) {
    return `# ${appName} - PWA Kurulum Rehberi

## 🌐 Progressive Web App (PWA) Nedir?

PWA, web teknolojileri ile geliştirilmiş ancak native uygulama gibi çalışan modern web uygulamalarıdır.

### ✅ Avantajlar:
- **Şifre gerektirmez** - Öğretmen/öğrenci hesaplarında çalışır
- **2 tıkla kurulum** - Tarayıcıdan masaüstüne ekle
- **Tam offline destek** - İnternet olmadan çalışır
- **Otomatik güncelleme** - Arka planda güncellenir
- **Başlat menüsünde görünür** - Native uygulama gibi
- **Küçük boyut** - İlk yükleme ~5 MB, sonra ~75 MB

---

## 📱 Kurulum Adımları

### Chrome / Edge (Önerilen)

1. **Uygulamayı tarayıcıda açın**
   \`\`\`
   http://sunucu-adresi/${appName.toLowerCase().replace(/\s+/g, '-')}
   \`\`\`

2. **"Masaüstüne Ekle" butonuna tıklayın**
   - Sağ alt köşede mavi buton görünecek
   - Veya adres çubuğundaki + ikonuna tıklayın

3. **"Ekle" butonuna tıklayın**
   - Tarayıcı popup'ı açılacak
   - "Ekle" veya "Install" butonuna tıklayın

4. **✅ Kurulum tamamlandı!**
   - Masaüstünde kısayol oluşacak
   - Başlat menüsünde görünecek
   - Native uygulama gibi çalışacak

---

## 🔧 Sunucuya Kurulum (IT Yöneticileri İçin)

### 1. PWA Dosyalarını Çıkartın

\`\`\`bash
unzip ${appName.replace(/\s+/g, '-')}-PWA-v${appVersion}.zip -d /var/www/html/${appName.toLowerCase().replace(/\s+/g, '-')}
\`\`\`

### 2. Web Sunucusu Yapılandırması

#### Apache (.htaccess)

\`\`\`apache
# PWA için gerekli header'lar
<IfModule mod_headers.c>
    Header set Service-Worker-Allowed "/"
    Header set Access-Control-Allow-Origin "*"
    
    # Cache control
    <FilesMatch "\\.(html|htm)$">
        Header set Cache-Control "no-cache, must-revalidate"
    </FilesMatch>
    
    <FilesMatch "\\.(js|css|png|jpg|jpeg|gif|svg|ico)$">
        Header set Cache-Control "public, max-age=31536000"
    </FilesMatch>
    
    <FilesMatch "manifest\\.json$">
        Header set Content-Type "application/manifest+json"
    </FilesMatch>
</IfModule>

# HTTPS yönlendirmesi (önerilen)
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
\`\`\`

#### Nginx

\`\`\`nginx
server {
    listen 80;
    server_name sunucu-adresi;
    root /var/www/html/${appName.toLowerCase().replace(/\s+/g, '-')};
    
    # Service Worker için gerekli
    add_header Service-Worker-Allowed "/";
    add_header Access-Control-Allow-Origin "*";
    
    # Cache control
    location ~* \\.(html|htm)$ {
        add_header Cache-Control "no-cache, must-revalidate";
    }
    
    location ~* \\.(js|css|png|jpg|jpeg|gif|svg|ico)$ {
        add_header Cache-Control "public, max-age=31536000";
    }
    
    location = /manifest.json {
        add_header Content-Type "application/manifest+json";
    }
    
    # HTTPS yönlendirmesi (önerilen)
    return 301 https://$server_name$request_uri;
}
\`\`\`

### 3. Güncelleme API'si (Opsiyonel)

Otomatik güncelleme için version endpoint'i ekleyin:

\`\`\`javascript
// /api/version endpoint'i
app.get('/api/version', (req, res) => {
  res.json({ version: '${appVersion}' });
});
\`\`\`

---

## 🚀 Kullanım

### Öğretmen/Öğrenci Hesaplarında

1. **Tarayıcıyı açın** (Chrome/Edge)
2. **Sunucu adresine gidin**
3. **"Masaüstüne Ekle" butonuna tıklayın**
4. **✅ Kurulum tamamlandı!**

### Offline Kullanım

- İlk açılışta tüm dosyalar cache'lenir
- İnternet kesilse bile uygulama çalışır
- İnternet gelince otomatik senkronize olur

### Güncelleme

- İnternet varken arka planda otomatik güncellenir
- Bildirim gelir: "Güncelleme hazır"
- Uygulamayı kapatıp açınca yeni sürüm çalışır

---

## 📊 Sistem Gereksinimleri

### Tarayıcı Desteği:
- ✅ Chrome 90+
- ✅ Edge 90+
- ✅ Firefox 90+ (kısıtlı destek)
- ✅ Safari 15+ (iOS/macOS)

### İşletim Sistemi:
- ✅ Windows 10/11
- ✅ macOS 10.15+
- ✅ Linux (Pardus dahil)
- ✅ Android 8+
- ✅ iOS 15+

---

## 🔒 Güvenlik

### HTTPS Zorunluluğu

PWA'lar güvenlik nedeniyle **HTTPS** gerektirir. Localhost dışında HTTP çalışmaz.

**Çözüm:**
- Let's Encrypt ile ücretsiz SSL sertifikası
- Veya self-signed sertifika (test için)

### Permissions

PWA'lar tarayıcı izinleri kullanır:
- Bildirimler (opsiyonel)
- Offline storage
- Kamera/mikrofon (uygulama gerektiriyorsa)

---

## 🐛 Sorun Giderme

### "Masaüstüne Ekle" butonu görünmüyor

**Çözüm:**
1. HTTPS kullanıldığından emin olun
2. manifest.json dosyasının erişilebilir olduğunu kontrol edin
3. Service Worker'ın yüklendiğini kontrol edin (F12 > Application > Service Workers)

### Offline çalışmıyor

**Çözüm:**
1. İlk açılışta internet bağlantısı olmalı
2. Tüm dosyaların cache'lendiğini kontrol edin (F12 > Application > Cache Storage)
3. Service Worker'ın aktif olduğunu kontrol edin

### Güncelleme gelmiyor

**Çözüm:**
1. /api/version endpoint'inin çalıştığını kontrol edin
2. Service Worker'ı manuel olarak güncelleyin (F12 > Application > Service Workers > Update)
3. Cache'i temizleyin ve sayfayı yenileyin

---

## 📞 Destek

Sorun yaşıyorsanız:
1. Tarayıcı console'unu kontrol edin (F12)
2. Service Worker durumunu kontrol edin
3. Network sekmesinde hataları kontrol edin

---

**Sürüm:** ${appVersion}  
**Oluşturulma Tarihi:** ${new Date().toLocaleDateString('tr-TR')}  
**Platform:** Progressive Web App (PWA)
`;
  }
}

module.exports = new PackagingService();