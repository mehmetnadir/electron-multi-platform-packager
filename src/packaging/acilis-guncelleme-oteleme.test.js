'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const m = require('./acilis-guncelleme-oteleme.js');

// Yayinci motorunun GERCEK kalibi (electron.js, 2026-09-20 olculdu).
const GERCEK = `const { app, BrowserWindow } = require("electron");
const http = require("https")

const createWindow = () => { mainWindow = new BrowserWindow({}); };

app.whenReady().then(async () => {
  try {
    await checkForUpdates()
  } catch (err) {}
  createWindow(); // Create the mainWindow
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
});

const checkForUpdates = async () => {
  return new Promise((resolve) => {
    http.get(endpoint + "version.html", res => {
      res.on("end", () => resolve())
    }).on("error", (err) => {
      resolve()
    })
  })
}
`;

function sozdizimiGecerliMi(kod) {
  const yol = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oteleme-')), 'electron.js');
  fs.writeFileSync(yol, kod);
  try { execFileSync(process.execPath, ['--check', yol], { stdio: 'pipe' }); return true; }
  catch { return false; }
}

test('kapı varsayılan AÇIK, yalnız 0 kapatır', () => {
  assert.strictEqual(m.acikMi({}), true);
  assert.strictEqual(m.acikMi({ EMPP_GUNCELLEME_OTELEME: '0' }), false);
});

test('SAHA KALIBI: pencere güncellemeden ÖNCE açılır', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.strictEqual(r.uygulandi, true);
  const pencere = r.icerik.indexOf('createWindow();');
  const guncelleme = r.icerik.indexOf('checkForUpdates()');
  assert.strictEqual(pencere < guncelleme, true, 'createWindow() önce gelmeli');
});

test('güncelleme artık AWAIT EDİLMİYOR (açılışı bekletmiyor)', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.strictEqual(/await\s+checkForUpdates/.test(r.icerik), false);
  assert.match(r.icerik, /setTimeout\(/);
});

test('güncelleme İPTAL EDİLMEZ — yalnız ötelenir', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.match(r.icerik, /checkForUpdates\(\)/);
});

test('ötelenmiş çağrının hatası yutulur (açılışı çökertmez)', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.match(r.icerik, /\.catch\(function\(\)\{\}\)/);
});

test('her https.get çağrısına zaman aşımı takılır', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.strictEqual(r.zamanAsimi, 1);
  assert.match(r.icerik, /\{ timeout: \d+ \}/);
  assert.match(r.icerik, /\.on\("timeout"/);
});

test('zaman aşımında istek YOK EDİLİR (yoksa soket asılı kalır)', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.match(r.icerik, /this\.destroy\(\)/);
});

test('ÇIKTI GEÇERLİ JAVASCRIPT — ilk sürüm `})` yi iki kez yazıp dosyayı bozmuştu', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.strictEqual(sozdizimiGecerliMi(r.icerik), true);
  assert.strictEqual(/\}\)\}\)\.on/.test(r.icerik), false);
});

test('error kancası KORUNUR (timeout onun yerine geçmez)', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.match(r.icerik, /\.on\("error"/);
});

test('iki kez uygulanmaz', () => {
  const bir = m.icerigiDuzelt(GERCEK);
  const iki = m.icerigiDuzelt(bir.icerik);
  assert.strictEqual(iki.uygulandi, false);
  assert.strictEqual(iki.sebep, 'zaten-yamali');
  assert.strictEqual(iki.icerik, bir.icerik);
});

test('kalıp yoksa SESSİZ NO-OP değil — sebep bildirilir', () => {
  const r = m.icerigiDuzelt('const x = 1;');
  assert.strictEqual(r.uygulandi, false);
  assert.strictEqual(r.sebep, 'kalip-yok');
});

test('kalıp yoksa dosyaya HİÇ dokunulmaz', () => {
  const kod = 'app.whenReady().then(() => { createWindow(); });';
  const r = m.icerigiDuzelt(kod);
  assert.strictEqual(r.icerik, kod);
});

test('boşluk/yorum farkları kalıbı kaçırmaz', () => {
  const varyant = GERCEK.replace('try {\n    await checkForUpdates()\n  } catch (err) {}',
    'try{await checkForUpdates();}catch(e){}');
  const r = m.icerigiDuzelt(varyant);
  assert.strictEqual(r.uygulandi, true);
  assert.strictEqual(sozdizimiGecerliMi(r.icerik), true);
});

test('süreler ayarlanabilir; geçersiz değer varsayılana döner', () => {
  assert.match(m.icerigiDuzelt(GERCEK, { gecikmeMs: 500, zamanAsimiMs: 2000 }).icerik,
    /\}, 500\)/);
  assert.match(m.icerigiDuzelt(GERCEK, { gecikmeMs: 500, zamanAsimiMs: 2000 }).icerik,
    /\{ timeout: 2000 \}/);
  assert.match(m.icerigiDuzelt(GERCEK, { zamanAsimiMs: 0 }).icerik,
    new RegExp(`\\{ timeout: ${m.VARSAYILAN_ZAMAN_ASIMI_MS} \\}`));
  assert.match(m.icerigiDuzelt(GERCEK, { gecikmeMs: -1 }).icerik,
    new RegExp(`\\}, ${m.VARSAYILAN_GECIKME_MS}\\)`));
});

test('null/undefined girdi çökmez', () => {
  assert.doesNotThrow(() => m.icerigiDuzelt(null));
  assert.doesNotThrow(() => m.icerigiDuzelt(undefined));
});

// ---- paketeUygula: gerçek dosya sistemi ----

function paketKur() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'oteleme-paket-'));
  fs.writeFileSync(path.join(kok, 'electron.js'), GERCEK);
  fs.mkdirSync(path.join(kok, 'book1'));
  fs.writeFileSync(path.join(kok, 'book1', 'electron.js'), GERCEK);
  fs.mkdirSync(path.join(kok, 'assets'));
  fs.writeFileSync(path.join(kok, 'assets', 'okuma.txt'), 'dosya');
  return kok;
}

test('kök ve alt kitap electron.js DOSYAYA yazılır', async () => {
  const kok = paketKur();
  const r = await m.paketeUygula(kok);
  assert.strictEqual(r.filter(x => x.uygulandi).length, 2);
  for (const rel of ['electron.js', path.join('book1', 'electron.js')]) {
    const yeni = fs.readFileSync(path.join(kok, rel), 'utf8');
    assert.match(yeni, new RegExp(m.ISARET));
    assert.strictEqual(yeni.indexOf('createWindow();') < yeni.indexOf('checkForUpdates()'), true);
    assert.strictEqual(sozdizimiGecerliMi(yeni), true);
  }
});

test('main.js de hedeftir (paketleyici giriş dosyasını yeniden adlandırıyor)', async () => {
  const kok = paketKur();
  fs.writeFileSync(path.join(kok, 'main.js'), GERCEK);
  const r = await m.paketeUygula(kok);
  const mainKaydi = r.find(x => x.dosya === 'main.js');
  assert.ok(mainKaydi, 'main.js işlenmeli');
  assert.strictEqual(mainKaydi.uygulandi, true);
  assert.match(fs.readFileSync(path.join(kok, 'main.js'), 'utf8'), new RegExp(m.ISARET));
});

test('ikinci koşu dosyayı DEĞİŞTİRMEZ', async () => {
  const kok = paketKur();
  await m.paketeUygula(kok);
  const ilk = fs.readFileSync(path.join(kok, 'electron.js'), 'utf8');
  const r2 = await m.paketeUygula(kok);
  assert.strictEqual(r2.every(x => !x.uygulandi), true);
  assert.strictEqual(fs.readFileSync(path.join(kok, 'electron.js'), 'utf8'), ilk);
});

test('kalıpsız dosya diske YENİDEN YAZILMAZ', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'oteleme-bos-'));
  const yol = path.join(kok, 'electron.js');
  fs.writeFileSync(yol, 'const x = 1;\n');
  const once = fs.statSync(yol).mtimeMs;
  const r = await m.paketeUygula(kok);
  assert.strictEqual(r[0].sebep, 'kalip-yok');
  assert.strictEqual(fs.statSync(yol).mtimeMs, once);
  assert.strictEqual(fs.readFileSync(yol, 'utf8'), 'const x = 1;\n');
});

test('electron.js olmayan paket sessizce geçilir', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'oteleme-yok-'));
  fs.mkdirSync(path.join(kok, 'assets'));
  assert.deepStrictEqual(await m.paketeUygula(kok), []);
});
