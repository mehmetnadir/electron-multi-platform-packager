const { app, BrowserWindow } = require('electron');
const path = require('path');

const BOOK_ENTRY = path.join(__dirname, '..', 'shall-we-5-Set', 'resources', 'app', 'build', 'book1', 'index.html');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#111111',
    title: 'Book1 Viewer',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false
    }
  });

  mainWindow.loadFile(BOOK_ENTRY).catch((error) => {
    const message = `Yerel kitap yüklenemedi.\n\n${error.message}`;
    console.error('[book1-launcher] load error:', error);
    mainWindow.loadURL(`data:text/plain;charset=utf-8,${encodeURIComponent(message)}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
