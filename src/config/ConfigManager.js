const fs = require('fs');
const path = require('path');
const os = require('os');

class ConfigManager {
  constructor() {
    // Varsayılan config dizini (uygulama data klasörü)
    // Önce environment variable'ı kontrol et (server modunda kullanılır)
    if (process.env.CONFIG_FILE && process.env.CONFIG_DIR) {
      this.configFile = process.env.CONFIG_FILE;
      this.defaultConfigDir = process.env.CONFIG_DIR;
      console.log(`📁 ConfigManager environment variable'dan yüklendi: ${this.configFile}`);
    } else {
      // Electron modunda app.getPath kullan, Node.js modunda os.homedir kullan
      let userDataPath;
      try {
        const { app } = require('electron');
        userDataPath = app.getPath('userData');
      } catch (error) {
        // Node.js modunda (server)
        userDataPath = path.join(os.homedir(), '.electron-packager-tool');
      }
      
      this.defaultConfigDir = path.join(userDataPath, 'config');
      
      // Config dosyası
      this.configFile = path.join(this.defaultConfigDir, 'settings.json');
    }
    
    // Varsayılan ayarlar
    this.defaultSettings = {
      configRepository: this.defaultConfigDir, // Kullanıcı değiştirebilir
      uploadDir: null, // null ise configRepository/uploads kullanılır
      logoDir: null,   // null ise configRepository/logos kullanılır
      tempDir: null,   // null ise configRepository/temp kullanılır
      outputDir: null, // null ise configRepository/output kullanılır
      lastUsedProjects: [],
      theme: 'dark',
      language: 'tr',
      maxParallelBuilds: 5,
      maxParallelZips: 2,
      autoCleanTemp: true,
      keepBuildLogs: true,
      // Yayınevi ayarları (çoklu yayınevi desteği)
      publishers: [],
      // publishers array yapısı:
      // {
      //   id: 'unique-id',
      //   name: 'Yayınevi Adı',
      //   logo: '/path/to/logo.png',
      //   akillitahtaId: 'publisher_123',
      //   apiKey: 'api-key',
      //   autoUpload: false,
      //   isDefault: false
      // }
      defaultPublisherId: null // Varsayılan yayınevi ID'si
    };
    
    this.settings = null;
    this.init();
  }
  
  init() {
    // Config dizinini oluştur
    if (!fs.existsSync(this.defaultConfigDir)) {
      fs.mkdirSync(this.defaultConfigDir, { recursive: true });
    }
    
    // Ayarları yükle veya oluştur
    this.loadSettings();
    
    // Migration: Publisher'lara logoId ekle
    this.migratePublishersLogoId();
    
    // Gerekli klasörleri oluştur
    this.ensureDirectories();
  }
  
  loadSettings() {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf8');
        const loadedSettings = JSON.parse(data);
        
        // Eski ayar dosyalarında publishers array'i olmayabilir, ekleyelim
        if (!loadedSettings.publishers) {
          loadedSettings.publishers = [];
        }
        if (!loadedSettings.defaultPublisherId) {
          loadedSettings.defaultPublisherId = null;
        }
        
        this.settings = { ...this.defaultSettings, ...loadedSettings };
        
        // Ayarları güncellenmiş haliyle kaydet (migration)
        this.saveSettings();
      } else {
        this.settings = { ...this.defaultSettings };
        this.saveSettings();
      }
    } catch (error) {
      console.error('Ayarlar yüklenemedi:', error);
      this.settings = { ...this.defaultSettings };
    }
  }
  
  saveSettings() {
    try {
      console.log(`💾 Ayarlar kaydediliyor: ${this.configFile}`);
      console.log(`📊 Publishers sayısı: ${this.settings.publishers ? this.settings.publishers.length : 0}`);
      
      fs.writeFileSync(
        this.configFile,
        JSON.stringify(this.settings, null, 2),
        'utf8'
      );
      
      console.log('✅ Ayarlar başarıyla kaydedildi');
      return true;
    } catch (error) {
      console.error('❌ Ayarlar kaydedilemedi:', error);
      return false;
    }
  }
  
  ensureDirectories() {
    const dirs = [
      this.getUploadDir(),
      this.getLogoDir(),
      this.getTempDir(),
      this.getOutputDir()
    ];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }
  
  // Getter metodları
  getConfigRepository() {
    return this.settings.configRepository;
  }
  
  getUploadDir() {
    return this.settings.uploadDir || 
           path.join(this.settings.configRepository, 'uploads');
  }
  
  getLogoDir() {
    return this.settings.logoDir || 
           path.join(this.settings.configRepository, 'logos');
  }
  
  getTempDir() {
    return this.settings.tempDir || 
           path.join(this.settings.configRepository, 'temp');
  }
  
  getOutputDir() {
    return this.settings.outputDir || 
           path.join(this.settings.configRepository, 'output');
  }
  
  // Setter metodları
  setConfigRepository(newPath, moveExistingData = false) {
    if (!fs.existsSync(newPath)) {
      throw new Error('Belirtilen klasör bulunamadı');
    }
    
    const oldPath = this.settings.configRepository;
    
    // Mevcut verileri taşı
    if (moveExistingData && oldPath !== newPath && fs.existsSync(oldPath)) {
      this.moveDataToNewRepository(oldPath, newPath);
    }
    
    this.settings.configRepository = newPath;
    this.saveSettings();
    this.ensureDirectories();
    
    return true;
  }
  
  // Verileri yeni repository'ye taşı
  moveDataToNewRepository(oldPath, newPath) {
    try {
      console.log(`📦 Veriler taşınıyor: ${oldPath} → ${newPath}`);
      
      // Taşınacak klasörler
      const foldersToMove = ['uploads', 'logos', 'temp', 'output'];
      
      foldersToMove.forEach(folder => {
        const oldFolderPath = path.join(oldPath, folder);
        const newFolderPath = path.join(newPath, folder);
        
        if (fs.existsSync(oldFolderPath)) {
          // Hedef klasör yoksa oluştur
          if (!fs.existsSync(newFolderPath)) {
            fs.mkdirSync(newFolderPath, { recursive: true });
          }
          
          // Dosyaları kopyala
          this.copyDirectory(oldFolderPath, newFolderPath);
          console.log(`  ✅ ${folder} taşındı`);
        }
      });
      
      // settings.json dosyasını taşı
      const oldSettingsFile = path.join(oldPath, 'settings.json');
      const newSettingsFile = path.join(newPath, 'settings.json');
      
      if (fs.existsSync(oldSettingsFile)) {
        fs.copyFileSync(oldSettingsFile, newSettingsFile);
        console.log(`  ✅ settings.json taşındı`);
      }
      
      console.log('✅ Tüm veriler başarıyla taşındı!');
      
      return true;
    } catch (error) {
      console.error('❌ Veri taşıma hatası:', error);
      throw new Error('Veriler taşınırken hata oluştu: ' + error.message);
    }
  }
  
  // Dizin kopyalama (recursive)
  copyDirectory(src, dest) {
    // Hedef dizini oluştur
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    
    // Kaynak dizindeki tüm öğeleri oku
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        // Alt dizini kopyala
        this.copyDirectory(srcPath, destPath);
      } else {
        // Dosyayı kopyala
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
  
  updateSetting(key, value) {
    if (this.settings.hasOwnProperty(key)) {
      this.settings[key] = value;
      return this.saveSettings();
    }
    return false;
  }
  
  getAllSettings() {
    return { ...this.settings };
  }
  
  resetToDefaults() {
    this.settings = { ...this.defaultSettings };
    return this.saveSettings();
  }
  
  // Son kullanılan projeleri yönet
  addRecentProject(projectPath) {
    if (!this.settings.lastUsedProjects.includes(projectPath)) {
      this.settings.lastUsedProjects.unshift(projectPath);
      
      // Maksimum 10 proje tut
      if (this.settings.lastUsedProjects.length > 10) {
        this.settings.lastUsedProjects = this.settings.lastUsedProjects.slice(0, 10);
      }
      
      this.saveSettings();
    }
  }
  
  getRecentProjects() {
    return this.settings.lastUsedProjects;
  }
  
  // Config repository bilgilerini al
  getRepositoryInfo() {
    const repo = this.settings.configRepository;
    
    try {
      const stats = fs.statSync(repo);
      const files = this.countFilesInDirectory(repo);
      
      return {
        path: repo,
        exists: true,
        isDirectory: stats.isDirectory(),
        size: this.getDirectorySize(repo),
        fileCount: files,
        lastModified: stats.mtime
      };
    } catch (error) {
      return {
        path: repo,
        exists: false,
        error: error.message
      };
    }
  }
  
  countFilesInDirectory(dir) {
    let count = 0;
    
    try {
      const items = fs.readdirSync(dir);
      
      items.forEach(item => {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          count += this.countFilesInDirectory(fullPath);
        } else {
          count++;
        }
      });
    } catch (error) {
      // Hata durumunda 0 döndür
    }
    
    return count;
  }
  
  getDirectorySize(dir) {
    let size = 0;
    
    try {
      const items = fs.readdirSync(dir);
      
      items.forEach(item => {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          size += this.getDirectorySize(fullPath);
        } else {
          size += stat.size;
        }
      });
    } catch (error) {
      // Hata durumunda 0 döndür
    }
    
    return size;
  }
  
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
  
  // ==================== YAYINEVİ YÖNETİMİ ====================
  
  // Yayınevi ekle
  addPublisher(publisherData) {
    const publisher = {
      id: this.generateId(),
      name: publisherData.name || '',
      logo: publisherData.logo || '',
      logoId: publisherData.logoId || null, // Logo ID ekle
      akillitahtaId: publisherData.akillitahtaId || '',
      apiKey: publisherData.apiKey || '',
      autoUpload: publisherData.autoUpload || false,
      isDefault: publisherData.isDefault || false,
      createdAt: new Date().toISOString()
    };
    
    // Eğer bu varsayılan olarak işaretlendiyse, diğerlerini kaldır
    if (publisher.isDefault) {
      this.settings.publishers.forEach(p => p.isDefault = false);
      this.settings.defaultPublisherId = publisher.id;
    }
    
    this.settings.publishers.push(publisher);
    this.saveSettings();
    
    return publisher;
  }
  
  // Yayınevi güncelle
  updatePublisher(publisherId, updates) {
    const index = this.settings.publishers.findIndex(p => p.id === publisherId);
    
    if (index === -1) {
      throw new Error('Yayınevi bulunamadı');
    }
    
    // Varsayılan değişikliği kontrol et
    if (updates.isDefault === true) {
      this.settings.publishers.forEach(p => p.isDefault = false);
      this.settings.defaultPublisherId = publisherId;
    }
    
    this.settings.publishers[index] = {
      ...this.settings.publishers[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    this.saveSettings();
    return this.settings.publishers[index];
  }
  
  // Mevcut publisher'lara logoId ekle (migration)
  migratePublishersLogoId() {
    let updated = false;
    this.settings.publishers.forEach(publisher => {
      if (!publisher.hasOwnProperty('logoId')) {
        publisher.logoId = null;
        updated = true;
      }
    });
    
    if (updated) {
      console.log('✅ Publisher logoId migration tamamlandı');
      this.saveSettings();
    }
  }
  
  // Yayınevi sil
  deletePublisher(publisherId) {
    const index = this.settings.publishers.findIndex(p => p.id === publisherId);
    
    if (index === -1) {
      throw new Error('Yayınevi bulunamadı');
    }
    
    const wasDefault = this.settings.publishers[index].isDefault;
    this.settings.publishers.splice(index, 1);
    
    // Varsayılan silindiyse, ilk yayınevini varsayılan yap
    if (wasDefault && this.settings.publishers.length > 0) {
      this.settings.publishers[0].isDefault = true;
      this.settings.defaultPublisherId = this.settings.publishers[0].id;
    } else if (this.settings.publishers.length === 0) {
      this.settings.defaultPublisherId = null;
    }
    
    this.saveSettings();
    return true;
  }
  
  // Tüm yayınevlerini getir
  getPublishers() {
    return this.settings.publishers || [];
  }
  
  // Belirli bir yayınevini getir
  getPublisher(publisherId) {
    return this.settings.publishers.find(p => p.id === publisherId);
  }
  
  // Varsayılan yayınevini getir
  getDefaultPublisher() {
    if (this.settings.defaultPublisherId) {
      return this.getPublisher(this.settings.defaultPublisherId);
    }
    
    // Varsayılan yoksa ilkini döndür
    return this.settings.publishers.length > 0 ? this.settings.publishers[0] : null;
  }
  
  // Varsayılan yayınevini ayarla
  setDefaultPublisher(publisherId) {
    const publisher = this.getPublisher(publisherId);
    
    if (!publisher) {
      throw new Error('Yayınevi bulunamadı');
    }
    
    // Tüm yayınevlerinin varsayılan işaretini kaldır
    this.settings.publishers.forEach(p => p.isDefault = false);
    
    // Seçileni varsayılan yap
    publisher.isDefault = true;
    this.settings.defaultPublisherId = publisherId;
    
    this.saveSettings();
    return true;
  }
  
  // Unique ID oluştur
  generateId() {
    return 'pub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
}

module.exports = ConfigManager;
