'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readyToShowEkle, ISARET } = require('./acilis-yamasi');

const COK_SATIR = `function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    fullscreen: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  mainWindow.loadFile('index.html');
}
app.whenReady().then(createWindow);`;

const TEK_SATIR = `const win = new BrowserWindow({ width: 1200, fullscreen: true });
win.loadFile('index.html');`;

const sozdizimiGecerli = (kod) => {
  try { new Function(kod); return true; } catch (e) { return false; }
};

test('çok satırlı BrowserWindow: üç parça da enjekte edilir', () => {
  const r = readyToShowEkle(COK_SATIR);
  assert.strictEqual(r.uygulandi, true);
  assert.strictEqual(r.pencere, 'mainWindow');
  assert.match(r.icerik, /show: false/, 'show:false yok');
  assert.match(r.icerik, /mainWindow\.once\('ready-to-show'/, 'ready-to-show kancası yok');
  assert.match(r.icerik, /setTimeout\(/, 'emniyet zamanlayıcısı yok');
  assert.ok(sozdizimiGecerli(r.icerik), 'çıktı geçerli JS değil');
});

test('GERİLEME: tek satırlık BrowserWindow yazımında süslü parantez bozulmaz', () => {
  // Satır sonu `//` yorumu kullanılırsa satırın kalanı yutulur ve kod kırılır.
  const r = readyToShowEkle(TEK_SATIR);
  assert.strictEqual(r.uygulandi, true);
  assert.ok(sozdizimiGecerli(r.icerik), 'tek satır yazımında çıktı kırıldı');
  assert.match(r.icerik, /width: 1200/, 'seçenekler yutulmuş');
  assert.match(r.icerik, /fullscreen: true/, 'fullscreen yutulmuş');
});

test('ATOMİKLİK: yükleme çağrısı yoksa show:false DA konulmaz', () => {
  // En tehlikeli durum: show:false konulup göster çağrısı konulmazsa pencere HİÇ açılmaz.
  const kod = `const win = new BrowserWindow({ width: 800 });\nconsole.log('yükleme yok');`;
  const r = readyToShowEkle(kod);
  assert.strictEqual(r.uygulandi, false);
  assert.strictEqual(r.sebep, 'yukleme-cagrisi-yok');
  assert.ok(!/show: false/.test(r.icerik), 'show:false yalnız başına konmuş — pencere hiç açılmaz');
  assert.strictEqual(r.icerik, kod, 'kaynak değişmemeliydi');
});

test('pencere değişkeni tanınmıyorsa dokunulmaz', () => {
  const kod = `createBrowserWindow();\nwin.loadFile('i.html');`;
  const r = readyToShowEkle(kod);
  assert.strictEqual(r.uygulandi, false);
  assert.strictEqual(r.sebep, 'pencere-degiskeni-yok');
  assert.strictEqual(r.icerik, kod);
});

test('yayıncı show: tanımlamışsa kararına dokunulmaz', () => {
  const kod = `const win = new BrowserWindow({ show: true });\nwin.loadFile('i.html');`;
  const r = readyToShowEkle(kod);
  assert.strictEqual(r.uygulandi, false);
  assert.strictEqual(r.sebep, 'show-zaten-tanimli');
  assert.strictEqual(r.icerik, kod);
});

test('idempotent: ikinci çağrı hiçbir şey eklemez', () => {
  const bir = readyToShowEkle(COK_SATIR);
  const iki = readyToShowEkle(bir.icerik);
  assert.strictEqual(iki.uygulandi, false);
  assert.strictEqual(iki.sebep, 'zaten-var');
  assert.strictEqual(iki.icerik, bir.icerik);
  assert.strictEqual((bir.icerik.match(new RegExp(ISARET, 'g')) || []).length, 2);
});

test('loadURL kullanan yayıncı kodu da desteklenir', () => {
  const kod = `let pencere = new BrowserWindow({\n  fullscreen: true\n});\npencere.loadURL('file://x');`;
  const r = readyToShowEkle(kod);
  assert.strictEqual(r.uygulandi, true);
  assert.strictEqual(r.pencere, 'pencere');
  assert.ok(sozdizimiGecerli(r.icerik));
});

test('boş/geçersiz giriş çökmez', () => {
  for (const g of ['', null, undefined]) {
    const r = readyToShowEkle(g);
    assert.strictEqual(r.uygulandi, false);
  }
});

test('SENTINEL: dil budaması üç platform yapılandırmasında da tanımlı', () => {
  // locales/ 55 dil taşıyor (45472.impark'ta 9,0 MB sıkışmış) — yalnız tr + en-US.
  const kaynak = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const adet = (kaynak.match(/electronLanguages:\s*\["tr", "en-US"\]/g) || []).length;
  assert.strictEqual(adet, 3, `win/mac/linux üçünde de olmalı, bulunan: ${adet}`);
});

test('SENTINEL: canlı paketleme yolu yamayı çağırıyor', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.match(kaynak, /require\('\.\/acilis-yamasi'\)/, 'modül import edilmemiş');
  assert.match(kaynak, /readyToShowEkle\(mainJsContent\)/, 'main.js yolunda çağrılmıyor');
  // Şablon literali içine sızmamalı (string-birleştirmesine-ekleme tuzağı)
  const sablon = kaynak.slice(kaynak.indexOf('const mainJsContent = `'), kaynak.indexOf('app.whenReady().then(createWindow);'));
  assert.ok(!sablon.includes("require('./acilis-yamasi')"), 'require üretilen main.js şablonuna sızmış');
});

// --- K19 (2026-09-19, sm4 saha kanıtı) — "önce bildir, sonra ata" kalıbı ---
test('K19: `let w; … w = new BrowserWindow({` kalıbına yama UYGULANIR', () => {
  const kaynak = [
    'let mainWindow;',
    'const createWindow = () => {',
    '  mainWindow = new BrowserWindow({ width: 800, height: 600 });',
    '  mainWindow.loadURL("file://index.html");',
    '};',
  ].join('\n');
  const r = readyToShowEkle(kaynak);
  assert.equal(r.uygulandi, true, r.sebep);
  assert.equal(r.pencere, 'mainWindow');
  assert.match(r.icerik, /show: false,/);
  assert.match(r.icerik, /mainWindow\.once\('ready-to-show'/);
  assert.match(r.icerik, /setTimeout\(/);
});

test('K19: üye ataması (`obj.win = new BrowserWindow`) YAKALANMAZ', () => {
  const kaynak = [
    'const obj = {};',
    'obj.win = new BrowserWindow({ width: 800 });',
    'obj.win.loadURL("x");',
  ].join('\n');
  const r = readyToShowEkle(kaynak);
  assert.equal(r.uygulandi, false);
  assert.equal(r.sebep, 'pencere-degiskeni-yok');
});

test('K19: bildirilmemiş değişkene (global sızıntı) yama YAZILMAZ', () => {
  const kaynak = [
    'function f(){',
    '  sizinti = new BrowserWindow({ width: 800 });',
    '  sizinti.loadURL("x");',
    '}',
  ].join('\n');
  const r = readyToShowEkle(kaynak);
  assert.equal(r.uygulandi, false);
  assert.equal(r.sebep, 'pencere-degiskeni-yok');
});

test('GERİLEME: gerçek sm4 kabuğu (SET electron.js) yamayı ALIR', () => {
  // sm4 kabuğunun birebir iskeleti — 2026-09-19'da "pencere-degiskeni-yok" diye atlanmıştı
  const kaynak = [
    'let mainWindow;',
    'const createWindow = () => {',
    '  const { width, height } = screen.getPrimaryDisplay().workAreaSize;',
    '  mainWindow = new BrowserWindow({',
    '    width: width,',
    '    webPreferences: { nodeIntegration: true },',
    '  });',
    '  mainWindow.maximize()',
    '  mainWindow.removeMenu();',
    '  mainWindow.loadURL(`file://${path.join(__dirname, "index.html")}`);',
    '};',
  ].join('\n');
  const r = readyToShowEkle(kaynak);
  assert.equal(r.uygulandi, true, 'sm4 kabuğu yamayı almalı — sebep: ' + r.sebep);
  assert.equal(r.pencere, 'mainWindow');
});

test('K19: aynı adlı değişken bildirilmişken üye ataması YANLIŞ pencereye yazmaz', () => {
  // Lookbehind olmasa: `obj.win` içindeki `win` eşleşir, `let win` bildirimi de
  // var olduğu için kontrol geçer ve yama YANLIŞ nesneye (`win`) yazılırdı.
  const kaynak = [
    'let win;',
    'const obj = {};',
    'obj.win = new BrowserWindow({ width: 800 });',
    'obj.win.loadURL("x");',
  ].join('\n');
  const r = readyToShowEkle(kaynak);
  assert.equal(r.uygulandi, false, 'üye atamasına yama yazılmamalı — sebep: ' + r.sebep);
});
