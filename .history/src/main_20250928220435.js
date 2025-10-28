const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const BOOK_BUNDLE_PATH = path.join(__dirname, '../shall-we-5-Set/resources/app/build/book1/index.html');

// Geliştirme ortamı kontrolü
const isDev = process.env.ELECTRON_IS_DEV === '1';

let mainWindow;
let serverProcess;

// Sunucu portu
const SERVER_PORT = 3000;

function createWindow() {
  // Ana pencereyi oluştur
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, '../build/ico.png'),
    title: 'Electron Paketleyici - Çok Platformlu Paketleme Aracı',
    // fullscreen: true, // Paketleyici arayüzü normal pencere olarak açılsın
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    show: false, // Başlangıçta gizle, hazır olunca göster
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
  });

  // Pencere hazır olduğunda göster
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    if (isDev) {
      mainWindow.webContents.openDevTools();
    }

    loadApp();
  });

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

  // Menüyü tamamen kaldır
  Menu.setApplicationMenu(null);
}

function loadLocalBook() {
  mainWindow.loadURL(BOOK_BUNDLE_PATH).catch((error) => {
    console.error('Sayfa yükleme hatası:', error);
  });
}

function loadApp() {
  const appUrl = `http://localhost:${SERVER_PORT}`;

  mainWindow.loadURL(appUrl).catch((error) => {
    console.error('Sayfa yükleme hatası:', error);

    // Hata sayfası göster
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
{{ ... }}
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

function createMenu() {
  const template = [
    {
{{ ... }}
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