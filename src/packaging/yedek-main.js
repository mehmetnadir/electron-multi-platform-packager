'use strict';
/**
 * YEDEK main.js ŞABLONU + başlık satırı — build'de main.js ve electron.js YOKKEN yazılan Electron
 * giriş dosyası (prepareElectronFiles; dört platformun ortak yolu).
 *
 * KÖK NEDEN (02.10, 74430 Flashy Grade 4 Set pardus — ProBook kabulü "pencere 420 sn açılmadı"):
 * şablon packagingService içinde backtick template literal'di; `'…hazırlanmıştır.\n\nAppImage…'`
 * içindeki `\n\n` dosyaya GERÇEK satır sonu olarak düşüyor, tek tırnaklı string kırılıyordu →
 * ana süreç `SyntaxError: Invalid or unexpected token (main.js:27)` ile pencere açmadan ölüyordu.
 * Aynı şablonda `companyName` hiç tanımlı değildi (APPIMAGE'da ReferenceError) ve `${appName}` /
 * `${windowTitle}` tek tırnak içine KAÇIŞSIZ giriyordu (adında ' olan kitap aynı hatayı verir).
 *
 * KURAL: üretilen JS'e giren HER değer JSON.stringify ile string literal olur (kaçış, satır sonu,
 * tırnak, ters bölü, `${`, backtick güvenli); şablonun kendisinde kaçış dizisi YOK.
 * Test: yedek-main.test.js — üretilen kaynak vm.Script ile derlenir (tuzak adlar + mutasyon).
 */

/** JS kaynak metnine güvenli string literal. */
function jsMetin(deger) {
  return JSON.stringify(String(deger == null ? '' : deger));
}

/**
 * @param {{windowTitle: string, appName: string, companyName?: string|null}} p
 * @returns {string} derlenebilir main.js kaynağı
 */
function yedekMainJs({ windowTitle, appName, companyName = null }) {
  const detay = `Bu uygulama ${companyName || 'Bilinmeyen Kurum'} tarafından hazırlanmıştır.\n\n`
    + 'AppImage formatı sayesinde yönetici şifresi gerekmedi.';
  return [
    "const { app, BrowserWindow, Menu } = require('electron');",
    "const path = require('path');",
    '',
    'function createWindow() {',
    '  const mainWindow = new BrowserWindow({',
    '    width: 1200,',
    '    height: 800,',
    `    title: ${jsMetin(windowTitle)},`,
    '    fullscreen: true,',
    '    webPreferences: {',
    '      nodeIntegration: false,',
    '      contextIsolation: true',
    '    }',
    '  });',
    '',
    '  // Ana menüyü devre dışı bırak',
    '  Menu.setApplicationMenu(null);',
    '',
    "  // AppImage için kurulum bildirim dialog'ı",
    '  if (process.env.APPIMAGE) {',
    "    const { dialog } = require('electron');",
    '    setTimeout(() => {',
    '      dialog.showMessageBox(mainWindow, {',
    "        type: 'info',",
    `        title: ${jsMetin(`${appName} - Başarıyla Yüklendi`)},`,
    "        message: 'Kurulum tamamlandı! Uygulama şimdi çalışıyor.',",
    `        detail: ${jsMetin(detay)},`,
    "        buttons: ['Tamam']",
    '      });',
    '    }, 1000);',
    '  }',
    '',
    "  mainWindow.loadFile('index.html');",
    '}',
    '',
    'app.whenReady().then(createWindow);',
    '',
    "app.on('window-all-closed', () => {",
    "  if (process.platform !== 'darwin') {",
    '    app.quit();',
    '  }',
    '});',
    '',
    "app.on('activate', () => {",
    '  if (BrowserWindow.getAllWindows().length === 0) {',
    '    createWindow();',
    '  }',
    '});',
  ].join('\n');
}

/** Mevcut main.js'te ilk `title: '…'` değerini güvenli literal'le değiştirir (yoksa aynen döner). */
function basligiGuncelle(icerik, windowTitle) {
  // Tam string literal (kaçışlı tırnak dahil): eski `['"`].*?['"`]` deseni `"A \"b\""`yi ilk `\"`de
  // kesip literal'in kuyruğunu dosyada bırakıyordu (yedekMainJs çıktısı bu adımdan da geçer).
  const titleRegex = /title:\s*(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/;
  // Fonksiyonlu replace: başlıktaki `$&`, `$1` gibi diziler özel anlam kazanmasın.
  return titleRegex.test(icerik)
    ? icerik.replace(titleRegex, () => `title: ${jsMetin(windowTitle)}`)
    : icerik;
}

module.exports = { yedekMainJs, basligiGuncelle, jsMetin };
