const { contextBridge, ipcRenderer } = require('electron');

// Güvenli API'yi renderer process'e maruz bırak
contextBridge.exposeInMainWorld('electronAPI', {
  // Uygulama bilgileri
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Dialog işlemleri
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  selectDirectory: (options) => ipcRenderer.invoke('select-directory', options),
  
  // Ayarlar işlemleri
  getConfigSettings: () => ipcRenderer.invoke('get-config-settings'),
  updateConfigSetting: (key, value) => ipcRenderer.invoke('update-config-setting', key, value),
  setConfigRepository: (path, moveData) => ipcRenderer.invoke('set-config-repository', path, moveData),
  
  // Dosya işlemleri
  readFileAsBase64: (filePath) => ipcRenderer.invoke('read-file-as-base64', filePath),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  
  // Menu event listeners
  onNewProject: (callback) => {
    ipcRenderer.on('new-project', callback);
    return () => ipcRenderer.removeListener('new-project', callback);
  },
  
  onBuildFolderSelected: (callback) => {
    ipcRenderer.on('build-folder-selected', callback);
    return () => ipcRenderer.removeListener('build-folder-selected', callback);
  },
  
  onPackageAllPlatforms: (callback) => {
    ipcRenderer.on('package-all-platforms', callback);
    return () => ipcRenderer.removeListener('package-all-platforms', callback);
  },
  
  onPackagePlatform: (callback) => {
    ipcRenderer.on('package-platform', callback);
    return () => ipcRenderer.removeListener('package-platform', callback);
  },
  
  // Platform bilgisi
  platform: process.platform,
  isElectron: true
});

// Türkçe dil desteği için genel fonksiyonlar
contextBridge.exposeInMainWorld('i18n', {
  t: (key, params = {}) => {
    // Basit çeviri sistemi
    const translations = {
      'app.title': 'Electron Paketleyici',
      'app.subtitle': 'Çok Platformlu Paketleme Aracı',
      'menu.file': 'Dosya',
      'menu.edit': 'Düzenle',
      'menu.view': 'Görünüm',
      'menu.packaging': 'Paketleme',
      'menu.help': 'Yardım',
      'button.upload': 'Build Klasörü Yükle',
      'button.package': 'Paketlemeyi Başlat',
      'button.download': 'İndir',
      'status.uploading': 'Yükleniyor...',
      'status.packaging': 'Paketleniyor...',
      'status.completed': 'Tamamlandı',
      'status.failed': 'Başarısız',
      'platform.windows': 'Windows',
      'platform.macos': 'macOS',
      'platform.linux': 'Linux',
      'platform.android': 'Android',
      'platform.pwa': 'PWA',
      'error.upload_failed': 'Dosya yükleme başarısız',
      'error.packaging_failed': 'Paketleme başarısız',
      'success.upload_completed': 'Dosya yükleme tamamlandı',
      'success.packaging_completed': 'Paketleme tamamlandı'
    };
    
    let text = translations[key] || key;
    
    // Parametreleri değiştir
    Object.keys(params).forEach(param => {
      text = text.replace(`{${param}}`, params[param]);
    });
    
    return text;
  }
});

console.log('Preload script yüklendi - Türkçe dil desteği aktif');