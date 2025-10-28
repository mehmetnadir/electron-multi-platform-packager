const { app, BrowserWindow, Menu, dialog, shell, ipcMain, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Config Manager
const ConfigManager = require('./config/ConfigManager');
const configManager = new ConfigManager();

// ConfigManager'ı global yap (server'dan erişilebilir olması için)
global.configManager = configManager;

// DevTools clipboard uyarısını devre dışı bırak
app.commandLine.appendSwitch('--unsafely-disable-devtools-self-xss-warnings');

// Geliştirme ortamı kontrolü
const isDev = process.env.ELECTRON_IS_DEV === '1';

let mainWindow;
let serverProcess;

// Sunucu portu
const SERVER_PORT = 3000;

function createWindow() {
  // CSP'yi tamamen devre dışı bırak
  if (isDev) {
    const ses = session.fromPartition('devtools');
    ses.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': undefined
        }
      });
    });
  }

  // Ana pencereyi oluştur
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, '../build/ico.png'),
    title: 'Electron Paketleyici - Çok Platformlu Paketleme Aracı',
    // Normal pencere çerçevesi - sürüklenebilir
    frame: true,
    titleBarStyle: 'default',
    partition: isDev ? 'devtools' : 'persist:main',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
      // DevTools için clipboard ve context menu
      spellcheck: false,
      experimentalFeatures: true,
      // DevTools için güvenlik ayarları
      webSecurity: false,
      allowRunningInsecureContent: true,
      // Ek DevTools ayarları
      plugins: true,
      sandbox: false,
      devTools: true
    },
    show: false // Başlangıçta gizle, hazır olunca göster
  });

  // Pencere hazır olduğunda göster
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'right' });
      
      // DevTools clipboard izni için ek ayarlar
      setTimeout(() => {
        mainWindow.webContents.executeJavaScript(`
          // DevTools için clipboard API izni
          console.log('🔧 DevTools clipboard ayarlanıyor...');
          
          // Clipboard API test
          if (navigator.clipboard) {
            navigator.clipboard.writeText('✅ Clipboard çalışıyor!').then(() => {
              console.log('✅ DevTools clipboard aktif edildi');
            }).catch(err => {
              console.error('❌ Clipboard hatası:', err);
            });
          }
          
          // DevTools context menu izni için
          document.addEventListener('contextmenu', (e) => {
            e.stopImmediatePropagation();
            console.log('🖱️ Context menu engeli kaldırıldı');
          }, true);
          
          console.log('✅ DevTools tam ayarlandı');
        `);
      }, 2000);
    }
  });

  // Sunucu başlatma ve URL yükleme
  startServerAndLoadApp();

  // External linkler için varsayılan browser'ı kullan
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Pencere kapatılırken
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  // Minimal menü oluştur - DevTools için
  createMinimalMenu();
}

function startServerAndLoadApp() {
  if (isDev) {
    // Geliştirme ortamında external sunucu kullan
    loadApp();
  } else {
    // Production'da kendi sunucumuzu başlat
    startInternalServer()
      .then(() => {
        setTimeout(() => {
          loadApp();
        }, 2000); // Sunucunun başlaması için bekle
      })
      .catch((error) => {
        console.error('Sunucu başlatma hatası:', error);
        dialog.showErrorBox(
          'Sunucu Hatası',
          'Uygulama sunucusu başlatılamadı. Lütfen uygulamayı yeniden başlatın.'
        );
      });
  }
}

function startInternalServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, 'server', 'app.js');
    
    // ConfigManager'ın config dosya yolunu server'a geç
    const configPath = configManager.configFile;
    const configDir = path.dirname(configPath);
    
    serverProcess = spawn('node', [serverPath], {
      stdio: 'pipe',
      env: { 
        ...process.env, 
        PORT: SERVER_PORT,
        CONFIG_DIR: configDir,
        CONFIG_FILE: configPath
      }
    });

    serverProcess.stdout.on('data', (data) => {
      console.log('Server:', data.toString());
      if (data.toString().includes('çalışıyor')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('Server Error:', data.toString());
    });

    serverProcess.on('error', (error) => {
      console.error('Server başlatma hatası:', error);
      reject(error);
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Server kapandı, kod: ${code}`);
      }
    });

    // Timeout olarak 10 saniye ver
    setTimeout(() => {
      reject(new Error('Sunucu başlatma zaman aşımı'));
    }, 10000);
  });
}

function loadApp() {
  const defaultPageNo = process.env.DEFAULT_PAGE_NO || '10';
  const appUrl = `http://localhost:${SERVER_PORT}/?defaultPageNo=${encodeURIComponent(defaultPageNo)}`;
  
  mainWindow.loadURL(appUrl).catch((error) => {
    console.error('Sayfa yükleme hatası:', error);
    
    // Hata sayfası göster
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Bağlantı Hatası</title>
        <style>
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          .error-container {
            text-align: center;
            padding: 2rem;
            background: rgba(255,255,255,0.1);
            border-radius: 10px;
            backdrop-filter: blur(10px);
          }
          h1 { margin-bottom: 1rem; }
          p { margin-bottom: 1.5rem; }
          button {
            background: #fff;
            color: #667eea;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
          }
          button:hover { background: #f0f0f0; }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1>🔌 Bağlantı Hatası</h1>
          <p>Uygulama sunucusuna bağlanılamadı.</p>
          <p>Lütfen uygulamayı yeniden başlatın.</p>
          <button onclick="location.reload()">Yeniden Dene</button>
        </div>
      </body>
      </html>
    `;
    
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
  });
}

function createMinimalMenu() {
  const template = [
    {
      label: 'Görünüm',
      submenu: [
        { 
          label: 'Yeniden Yükle', 
          accelerator: 'CmdOrCtrl+R', 
          role: 'reload' 
        },
        { 
          label: 'Geliştirici Araçları', 
          accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click: () => {
            mainWindow.webContents.openDevTools({ mode: 'right' });
          }
        },
        { 
          label: 'Geliştirici Araçları (Yan Taraf)', 
          click: () => {
            mainWindow.webContents.openDevTools({ mode: 'right' });
          }
        },
        { type: 'separator' },
        { 
          label: 'Tam Ekran', 
          accelerator: 'F11', 
          role: 'togglefullscreen' 
        }
      ]
    }
  ];

  // macOS için app menüsü ekle
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about', label: 'Hakkında' },
        { type: 'separator' },
        { role: 'hide', label: 'Gizle' },
        { role: 'hideothers', label: 'Diğerlerini Gizle' },
        { role: 'unhide', label: 'Tümünü Göster' },
        { type: 'separator' },
        { role: 'quit', label: 'Çıkış' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createMenu() {
  const template = [
    {
      label: 'Dosya',
      submenu: [
        {
          label: 'Yeni Proje',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.send('new-project');
          }
        },
        {
          label: 'Build Klasörü Aç',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              title: 'Build Klasörü Seç',
              properties: ['openDirectory'],
              message: 'Electron build klasörünü seçin'
            });
            
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow.webContents.send('build-folder-selected', result.filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Çıkış',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Düzenle',
      submenu: [
        { label: 'Geri Al', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Yinele', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Kes', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Kopyala', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Yapıştır', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Tümünü Seç', accelerator: 'CmdOrCtrl+A', role: 'selectall' }
      ]
    },
    {
      label: 'Görünüm',
      submenu: [
        { label: 'Yeniden Yükle', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Geliştirici Araçları', accelerator: 'F12', role: 'toggledevtools' },
        { type: 'separator' },
        { label: 'Tam Ekran', accelerator: 'F11', role: 'togglefullscreen' },
        { label: 'Yakınlaştır', accelerator: 'CmdOrCtrl+Plus', role: 'zoomin' },
        { label: 'Uzaklaştır', accelerator: 'CmdOrCtrl+-', role: 'zoomout' },
        { label: 'Varsayılan Boyut', accelerator: 'CmdOrCtrl+0', role: 'resetzoom' }
      ]
    },
    {
      label: 'Paketleme',
      submenu: [
        {
          label: 'Tüm Platformlar',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => {
            mainWindow.webContents.send('package-all-platforms');
          }
        },
        { type: 'separator' },
        {
          label: 'Sadece Windows',
          click: () => {
            mainWindow.webContents.send('package-platform', 'windows');
          }
        },
        {
          label: 'Sadece macOS',
          click: () => {
            mainWindow.webContents.send('package-platform', 'macos');
          }
        },
        {
          label: 'Sadece Linux',
          click: () => {
            mainWindow.webContents.send('package-platform', 'linux');
          }
        },
        {
          label: 'Sadece Android',
          click: () => {
            mainWindow.webContents.send('package-platform', 'android');
          }
        },
        {
          label: 'Sadece PWA',
          click: () => {
            mainWindow.webContents.send('package-platform', 'pwa');
          }
        }
      ]
    },
    {
      label: 'Yardım',
      submenu: [
        {
          label: 'Kullanım Kılavuzu',
          click: () => {
            shell.openExternal('https://github.com/nadir/electron-packager-tool/wiki');
          }
        },
        {
          label: 'GitHub Deposu',
          click: () => {
            shell.openExternal('https://github.com/nadir/electron-packager-tool');
          }
        },
        { type: 'separator' },
        {
          label: 'Hakkında',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Hakkında',
              message: 'Electron Paketleyici',
              detail: `
Sürüm: 1.0.0
Electron: ${process.versions.electron}
Chrome: ${process.versions.chrome}
Node.js: ${process.versions.node}

Çok platformlu Electron uygulaması paketleme aracı.
Türkçe dil desteği ile.

© 2024 Nadir
              `.trim()
            });
          }
        }
      ]
    }
  ];

  // macOS için menu düzenlemesi
  if (process.platform === 'darwin') {
    template.unshift({
      label: 'Electron Paketleyici',
      submenu: [
        {
          label: 'Electron Paketleyici Hakkında',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Hakkında',
              message: 'Electron Paketleyici',
              detail: 'Çok platformlu Electron uygulaması paketleme aracı'
            });
          }
        },
        { type: 'separator' },
        { label: 'Servisleri Gizle', accelerator: 'Cmd+H', role: 'hide' },
        { label: 'Diğerlerini Gizle', accelerator: 'Cmd+Shift+H', role: 'hideothers' },
        { label: 'Tümünü Göster', role: 'unhide' },
        { type: 'separator' },
        { label: 'Çıkış', accelerator: 'Cmd+Q', role: 'quit' }
      ]
    });

    // macOS'ta Pencere menüsü ekle
    template.push({
      label: 'Pencere',
      submenu: [
        { label: 'Simge Durumuna Küçült', accelerator: 'Cmd+M', role: 'minimize' },
        { label: 'Kapat', accelerator: 'Cmd+W', role: 'close' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC event handlers
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

ipcMain.handle('show-message-box', async (event, options) => {
  const result = await dialog.showMessageBox(mainWindow, options);
  return result;
});

// Klasör seçici (ayarlar için)
ipcMain.handle('select-directory', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    ...options
  });
  return result;
});

// ConfigManager ayarlarını al
ipcMain.handle('get-config-settings', () => {
  return configManager.getAllSettings();
});

// ConfigManager ayarlarını güncelle
ipcMain.handle('update-config-setting', (event, key, value) => {
  return configManager.updateSetting(key, value);
});

// Config repository değiştir
ipcMain.handle('set-config-repository', async (event, newPath, moveData) => {
  try {
    configManager.setConfigRepository(newPath, moveData);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Dosya okuma (base64)
ipcMain.handle('read-file-as-base64', async (event, filePath) => {
  try {
    const fs = require('fs');
    const imageData = fs.readFileSync(filePath);
    const base64Image = imageData.toString('base64');
    const ext = filePath.split('.').pop().toLowerCase();
    const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
    
    return {
      success: true,
      data: base64Image,
      mimeType: mimeType,
      dataUri: `data:${mimeType};base64,${base64Image}`
    };
  } catch (error) {
    console.error('Dosya okuma hatası:', error);
    return { success: false, error: error.message };
  }
});

// Klasör açma
ipcMain.handle('open-folder', async (event, folderPath) => {
  try {
    console.log('📁 Klasör açılıyor:', folderPath);
    
    // Klasörün var olduğunu kontrol et
    if (!fs.existsSync(folderPath)) {
      console.error('❌ Klasör bulunamadı:', folderPath);
      return { success: false, error: 'Klasör bulunamadı' };
    }
    
    // shell.openPath bir string döndürür - boş string başarı demektir
    const errorMessage = await shell.openPath(folderPath);
    
    if (errorMessage) {
      console.error('❌ Klasör açma hatası:', errorMessage);
      return { success: false, error: errorMessage };
    }
    
    console.log('✅ Klasör açıldı:', folderPath);
    return { success: true };
  } catch (error) {
    console.error('❌ Klasör açma exception:', error);
    return { success: false, error: error.message };
  }
});

// Uygulama event handlers
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

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

// Güvenlik: sadece localhost'tan gelen URL'lere izin ver
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (navigationEvent, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    
    if (parsedUrl.origin !== `http://localhost:${SERVER_PORT}`) {
      navigationEvent.preventDefault();
    }
  });
});
