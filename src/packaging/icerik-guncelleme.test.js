'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const m = require('./icerik-guncelleme.js');
const oteleme = require('./acilis-guncelleme-oteleme.js');

// Yayıncı motorunun GERÇEK electron.js'i (SM3 build.zip ve Shall We 5 .impark'ta birebir,
// 2026-09-24 okundu) — kanal Ş kısmı.
const GERCEK = `const { app, BrowserWindow, screen, shell } = require("electron"); // electron
const path = require("path");
const fs = require("fs")
const http = require("https")
const isDev = process?.env?.DEVMODE;
const createWindow = () => { mainWindow = new BrowserWindow({}); };
app.whenReady().then(async () => {
  try {
    await checkForUpdates()
  } catch (err) {}
  createWindow(); // Create the mainWindow
});
const checkForUpdates = async () => {
  if (isDev) return
  try {
    const promise = new Promise((resolve, reject) => {
      http.get(endpoint + "version.html", res => {
        res.on("end", () => { downloadUpdates(endpoint + body + ".zip").then(() => resolve()) })
      }).on("error", (err) => {
        resolve()
      })
    })
    return promise;
  } catch (err) { return }
}
const downloadUpdates = async (result) => {
  const AdmZip = require("adm-zip")
  new AdmZip(result).extractAllTo(__dirname, true)
}
`;

function sozdizimi(kod) {
  const yol = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-pk-')), 'main.js');
  fs.writeFileSync(yol, kod);
  execFileSync(process.execPath, ['--check', yol], { stdio: 'pipe' });
  return true;
}

test('kanal Ş: checkForUpdates gövdesinin başına tek satır return — sözdizimi geçerli, idempotent', () => {
  const r = m.kanalSKapat(GERCEK);
  assert.strictEqual(r.uygulandi, true);
  assert.match(r.icerik, /const checkForUpdates = async \(\) => \{ return; \/\* EMPP_KANAL_S_KAPALI/);
  assert.strictEqual(r.icerik.split('\n').length, GERCEK.split('\n').length, 'tek satır: satır sayısı değişmez');
  assert.ok(sozdizimi(r.icerik));
  assert.strictEqual(m.kanalSKapat(r.icerik).sebep, 'zaten-kapali');
});

test('kanal Ş: fonksiyon bildirimi biçimi de kapanır; kalıp yoksa dokunulmaz', () => {
  const r = m.kanalSKapat('async function checkForUpdates() {\n  go()\n}\n');
  assert.strictEqual(r.uygulandi, true);
  assert.ok(sozdizimi(r.icerik));
  const y = m.kanalSKapat('const a = 1;\n');
  assert.deepStrictEqual([y.uygulandi, y.sebep, y.icerik], [false, 'kalip-yok', 'const a = 1;\n']);
});

test('kanal Ş + açılış ötelemesi yan yana: iki sırada da sözdizimi geçerli, öteleme kalıbı bozulmaz', () => {
  const a = oteleme.icerigiDuzelt(m.kanalSKapat(GERCEK).icerik);
  assert.strictEqual(a.uygulandi, true);
  assert.ok(sozdizimi(a.icerik));
  const b = m.kanalSKapat(oteleme.icerigiDuzelt(GERCEK).icerik);
  assert.strictEqual(b.uygulandi, true);
  assert.ok(sozdizimi(b.icerik));
});

test('ana süreç bloğu: sona eklenir, çapa yoksa konmaz, idempotent, EMPP_WORK_DIR literali İÇERMEZ', () => {
  const r = m.anaSurecEnjekteEt(GERCEK);
  assert.strictEqual(r.uygulandi, true);
  assert.ok(r.icerik.startsWith(GERCEK));
  assert.ok(sozdizimi(r.icerik));
  assert.strictEqual(m.anaSurecEnjekteEt(r.icerik).sebep, 'zaten-yamali');
  assert.strictEqual(m.anaSurecEnjekteEt('console.log(1)').sebep, 'capa-yok');
  // packagingService main.js'te `EMPP_WORK_DIR` görürse kendi WORK enjeksiyonunu ATLIYOR.
  assert.ok(!m.blokUret().includes('EMPP_WORK_DIR'));
  assert.ok(!/app\.whenReady\(\)/.test(m.blokUret()), 'packagingService whenReady regex\'i bloğa kaymasın');
});

test('paketBagimliliklari: depodaki adm-zip sürümü birebir', () => {
  const surum = require('adm-zip/package.json').version;
  assert.deepStrictEqual(m.paketBagimliliklari(), { 'adm-zip': surum });
  assert.strictEqual(m.ADM_ZIP_FILES_ISTISNASI, 'node_modules/adm-zip');
  assert.ok(!m.ADM_ZIP_FILES_ISTISNASI.includes('/*'), 'yorum-silen sentineller körleşmesin');
});

function paketKur() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-paket-'));
  fs.writeFileSync(path.join(kok, 'electron.js'), GERCEK);
  fs.writeFileSync(path.join(kok, 'main.js'), GERCEK);
  fs.writeFileSync(path.join(kok, 'electronUpdate.js'), GERCEK);
  fs.mkdirSync(path.join(kok, 'book2'));
  fs.writeFileSync(path.join(kok, 'book2', 'electron.js'), GERCEK);
  fs.writeFileSync(path.join(kok, 'package.json'), JSON.stringify({ name: 'x', main: 'main.js', dependencies: {} }));
  return kok;
}

test('paketeUygula: adm-zip (empp-vendor, bağımlılıksız) + modül + ana süreç bloğu + kanal Ş (kök ve bookN)', async () => {
  const kok = paketKur();
  const r = await m.paketeUygula(kok);
  assert.strictEqual(r.admZip, true);
  assert.strictEqual(r.modul, true);
  assert.ok(fs.existsSync(path.join(kok, m.VENDOR_DIZIN, 'adm-zip', 'adm-zip.js')));
  // REGRESYON 73768 mac 1.0.2: bağımlılık yazılırsa electron-builder npm list yolundan toplar,
  // npm UUID'yi *** ile maskeler → ENOENT. node_modules'e de KONMAZ.
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(kok, 'package.json'), 'utf8')).dependencies, {});
  assert.ok(!fs.existsSync(path.join(kok, 'node_modules')), 'node_modules oluşturulmamalı');
  assert.strictEqual(fs.readFileSync(path.join(kok, m.MODUL_ADI), 'utf8'), fs.readFileSync(m.KAYNAK_MODUL, 'utf8'));
  assert.deepStrictEqual(r.anaSurec.map((x) => [x.dosya, x.uygulandi]), [['electron.js', true], ['main.js', true]]);
  assert.ok(!fs.readFileSync(path.join(kok, 'book2', 'electron.js'), 'utf8').includes(m.ISARET), 'ana süreç bloğu yalnız kökte');
  const kapali = r.kanalS.filter((x) => x.uygulandi).map((x) => x.dosya).sort();
  assert.deepStrictEqual(kapali, ['book2/electron.js', 'electron.js', 'electronUpdate.js', 'main.js'].sort());
  for (const f of ['main.js', 'electron.js', 'book2/electron.js']) assert.ok(sozdizimi(fs.readFileSync(path.join(kok, f), 'utf8')));
  // pakete giren adm-zip GERÇEKTEN yüklenebilir (bağımlılıksız)
  const Z = require(path.join(kok, m.ADM_ZIP_GORELI));
  assert.strictEqual(typeof new Z().addFile, 'function');
  // İdempotent
  const r2 = await m.paketeUygula(kok);
  assert.ok(r2.anaSurec.every((x) => !x.uygulandi));
  assert.ok(r2.kanalS.every((x) => !x.uygulandi));
});

test('REGRESYON 73768: eski koşudan kalan adm-zip bağımlılığı (node_modules karşılığı yok) geri alınır; yayıncınınki korunur', async () => {
  const kok = paketKur();
  fs.writeFileSync(path.join(kok, 'package.json'), JSON.stringify({ name: 'x', main: 'main.js', dependencies: { 'adm-zip': '0.5.16', lodash: '4' } }));
  const loglar = [];
  await m.paketeUygula(kok, { log: (x) => loglar.push(x) });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(kok, 'package.json'), 'utf8')).dependencies, { lodash: '4' });
  assert.ok(loglar.some((x) => /adm-zip bağımlılığı kaldırıldı/.test(x)));
  // yayıncı kendi node_modules/adm-zip'ini getirmişse bağımlılık ona aittir — dokunulmaz
  const kok2 = paketKur();
  fs.writeFileSync(path.join(kok2, 'package.json'), JSON.stringify({ name: 'x', main: 'main.js', dependencies: { 'adm-zip': '0.5.10' } }));
  fs.mkdirSync(path.join(kok2, 'node_modules', 'adm-zip'), { recursive: true });
  fs.writeFileSync(path.join(kok2, 'node_modules', 'adm-zip', 'package.json'), '{"name":"adm-zip","version":"0.5.10"}');
  assert.strictEqual(await m.bagimlilikGeriAl(kok2), false);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(kok2, 'package.json'), 'utf8')).dependencies, { 'adm-zip': '0.5.10' });
});

test('paketeUygula ATOMİK: adm-zip kaynağı yoksa ana süreç bloğu KONMAZ (kanal Ş yine kapanır)', async () => {
  const kok = paketKur();
  const r = await m.paketeUygula(kok, { admZipKaynak: path.join(kok, 'yok') });
  assert.strictEqual(r.admZip, false);
  assert.deepStrictEqual(r.anaSurec, []);
  assert.ok(!fs.readFileSync(path.join(kok, 'main.js'), 'utf8').includes(m.ISARET));
  assert.ok(fs.readFileSync(path.join(kok, 'main.js'), 'utf8').includes(m.KANAL_S_ISARET));
});

// ─── SENTİNEL (review #13): kaynak METNİ değil, yorumsuz kaynaktaki GERÇEK files dizileri ───
// packagingService.js dondurulmuş; yama ayrı dosyada (faz2/packagingService.patch). Yarım uygulanırsa
// iki sessiz arıza: çağrı var istisna yok → adm-zip `!node_modules` ile elenir (electron-builder
// 26 ile ölçüldü 2026-09-24: istisnasız asar'da node_modules 0, istisnalı 22 girdi); istisna
// Windows'a sızarsa ölçülmemiş platform değişir (review #4: Windows kapsam dışı).
// Yalnız satır yorumları atılır: blok-yorum regex'i `"**/*"` glob'unu yorum başlangıcı sanıp
// kodu yutuyor (linux-deb-opsiyonel.test.js'in bilinen körlüğü) — burada kullanılmaz.
function yorumsuz(src) {
  return src.replace(/^\s*\/\/.*$/gm, '');
}
function filesDizileri(src) {
  const kod = yorumsuz(src);
  const isaret = { windows: 'async packageWindows(', macos: 'async packageMacOS(', linux: 'async packageLinux(', android: 'async packageAndroid(' };
  const ofs = Object.fromEntries(Object.entries(isaret).map(([ad, im]) => {
    const k = kod.indexOf(im);
    assert.notStrictEqual(k, -1, `sentinel köreldi: ${im}`);
    return [ad, k];
  }));
  assert.ok(ofs.windows < ofs.macos && ofs.macos < ofs.linux && ofs.linux < ofs.android, 'platform sırası değişti');
  const dizi = (bas, son) => {
    const m2 = kod.slice(bas, son).match(/files:\s*\[([\s\S]*?)\]/);
    assert.ok(m2, 'files dizisi bulunamadı');
    return [...m2[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  };
  return { kod, windows: dizi(ofs.windows, ofs.macos), macos: dizi(ofs.macos, ofs.linux), linux: dizi(ofs.linux, ofs.android) };
}
function sentinelDenetle(src) {
  const { kod, windows, macos, linux } = filesDizileri(src);
  const cagriI = kod.indexOf('icerikGuncelleme.paketeUygula(');
  const cagri = cagriI !== -1;
  // Windows'ta adm-zip node_modules istisnasıyla DEĞİL empp-vendor/ ile girer (sözleşme G1, 2026-09-26).
  assert.ok(!windows.includes(m.ADM_ZIP_FILES_ISTISNASI), 'Windows files listesine node_modules/adm-zip istisnası sızmış');
  for (const [ad, liste] of [['macos', macos], ['linux', linux]]) {
    const var_ = liste.includes(m.ADM_ZIP_FILES_ISTISNASI);
    assert.strictEqual(var_, cagri, cagri ? `${ad}: çağrı var ama files istisnası yok` : `${ad}: istisna var ama çağrı yok`);
    if (var_) assert.ok(liste.indexOf(m.ADM_ZIP_FILES_ISTISNASI) > liste.indexOf('!node_modules'), `${ad}: istisna !node_modules'tan SONRA olmalı`);
  }
  if (cagri) {
    const hazir = kod.indexOf('await this.prepareElectronFiles(workingPath');
    assert.ok(hazir !== -1 && cagriI > hazir, 'çağrı prepareElectronFiles SONRASINDA olmalı (package.json/main.js hazır)');
    assert.ok(cagriI < kod.indexOf('async prepareElectronFiles('), 'çağrı startPackaging içinde olmalı');
  }
  // DAVRANIŞ: electron-builder'ın KENDİ eleyicisi — istisna varsa adm-zip içeride, diğer node_modules dışarıda.
  const { FileMatcher } = require('app-builder-lib/out/fileMatcher');
  for (const liste of [macos, linux]) {
    const ele = new FileMatcher('/k', '/h', (x) => x, liste).createFilter();
    const dosya = { isFile: () => true, isDirectory: () => false };
    assert.strictEqual(ele('/k/node_modules/adm-zip/adm-zip.js', dosya), cagri);
    assert.strictEqual(ele('/k/node_modules/electron/index.js', dosya), false);
    assert.strictEqual(ele('/k/book1/index.html', dosya), true);
    // adm-zip'in GERÇEK yeri: satıcı dizini hiçbir desenle elenmemeli (73768 regresyon düzeltmesi).
    assert.strictEqual(ele('/k/' + m.ADM_ZIP_GORELI + '/adm-zip.js', dosya), true, 'empp-vendor elendi');
    assert.strictEqual(ele('/k/' + m.ADM_ZIP_GORELI + '/util/utils.js', dosya), true, 'empp-vendor alt dizini elendi');
  }
  return { cagri };
}

test('SENTİNEL: canlı packagingService — çağrı ↔ mac/linux istisnası birlikte; Windows\'ta asla', () => {
  sentinelDenetle(fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8'));
});

test('SENTİNEL kendini sınar: yama uygulanmış kaynakta geçer, üç mutasyonda KALIR', (t) => {
  const canli = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  if (/icerikGuncelleme\.paketeUygula\(/.test(canli)) { t.skip('yama canlı kaynağa uygulanmış — canlı SENTİNEL testi yeterli'); return; }
  const kaynak = process.env.EMPP_FAZ2_YAMALI_KAYNAK;
  if (!kaynak || !fs.existsSync(kaynak)) {
    t.skip('EMPP_FAZ2_YAMALI_KAYNAK=<yama uygulanmış packagingService.js> verilmedi — öz-sınama KOŞMADI');
    return;
  }
  const yamali = fs.readFileSync(kaynak, 'utf8');
  assert.strictEqual(sentinelDenetle(yamali).cagri, true);
  const tekIstisna = yamali.replace(/(async packageLinux\([\s\S]*?)\n\s*"node_modules\/adm-zip",/, '$1');
  assert.throws(() => sentinelDenetle(tekIstisna), /linux: çağrı var ama files istisnası yok/);
  const winSizinti = yamali.replace(/(async packageWindows\([\s\S]*?"!node_modules",)/, '$1\n        "node_modules/adm-zip",');
  assert.throws(() => sentinelDenetle(winSizinti), /Windows files listesine adm-zip sızmış/);
  const yorumdaCagri = canli.replace('// Electron için gerekli dosyaları oluştur', '// icerikGuncelleme.paketeUygula(workingPath)');
  sentinelDenetle(yorumdaCagri); // yorumdaki çağrı sayılmaz → "çağrı yok" dalı, geçer
});

test('kanal Ş: minify ve function-ifadesi biçimleri de kapanır', () => {
  for (const kod of [
    'const a=1,checkForUpdates=async()=>{go()};',
    'var checkForUpdates = async function () {\n go()\n};',
    'let checkForUpdates = function upd() { go() };',
  ]) {
    const r = m.kanalSKapat(kod);
    assert.strictEqual(r.uygulandi, true, kod);
    assert.ok(sozdizimi(r.icerik + '\nfunction go(){}'), kod);
    assert.strictEqual(m.kanalSTehlikeli(r.icerik), false);
  }
});

test('R2 — kanal Ş tanınmayan biçimdeyse (adı değişmiş minify) adm-zip KONMAZ, modül/blok yok, durum dosyası görünür', async () => {
  const kok = paketKur();
  const tanimsiz = 'const { app } = require("electron");\nconst u=async()=>{ const Z=require("adm-zip"); new Z(x).extractAllTo(__dirname,true) };\napp.whenReady().then(()=>{u()});\n';
  fs.writeFileSync(path.join(kok, 'main.js'), tanimsiz);
  const loglar = [];
  const r = await m.paketeUygula(kok, { log: (x) => loglar.push(x) });
  assert.deepStrictEqual(r.kanalSAcik, ['main.js']);
  assert.strictEqual(r.admZip, false);
  assert.ok(!fs.existsSync(path.join(kok, m.VENDOR_DIZIN)), 'adm-zip pakete girmedi');
  assert.ok(!fs.existsSync(path.join(kok, 'node_modules', 'adm-zip')), 'adm-zip pakete girmedi');
  assert.ok(!fs.existsSync(path.join(kok, m.MODUL_ADI)));
  assert.ok(!fs.readFileSync(path.join(kok, 'main.js'), 'utf8').includes(m.ISARET));
  assert.ok(loglar.some((x) => /⛔ içerik güncelleme KAPALI — kanal Ş kapatılamadı \(main\.js\)/.test(x)));
  const durum = JSON.parse(fs.readFileSync(path.join(kok, m.DURUM_ADI), 'utf8'));
  assert.deepStrictEqual(durum.etkin, { macos: false, linux: false, windows: false, android: false });
  assert.match(durum.hata, /kanal-s-kapatilamadi/);
});

test('R3 — adm-zip çözülemezse fırlatmaz: admZip=false + hata dönüşte, logda ve pakette', async () => {
  const kok = paketKur();
  const loglar = [];
  const yok = path.join(kok, 'olmayan-adm-zip');
  const r = await m.paketeUygula(kok, { log: (x) => loglar.push(x), admZipKaynak: yok });
  assert.strictEqual(r.admZip, false);
  assert.match(r.hata, /adm-zip/);
  assert.ok(loglar.some((x) => x.includes('⛔ içerik güncelleme KAPALI')));
  const durum = JSON.parse(fs.readFileSync(path.join(kok, m.DURUM_ADI), 'utf8'));
  assert.deepStrictEqual([durum.etkin.linux, durum.admZip], [false, false]);
});

test('R3 — admZipKaynagi() FIRLATIRSA da (require.resolve) paketeUygula sonucu döner', async () => {
  const kok = paketKur();
  const mod = require('./icerik-guncelleme.js');
  const Module = require('node:module');
  const asilResolve = Module._resolveFilename;
  Module._resolveFilename = function (istek, ...r) {
    if (istek === 'adm-zip/package.json') { const e = new Error("Cannot find module 'adm-zip/package.json'"); e.code = 'MODULE_NOT_FOUND'; throw e; }
    return asilResolve.call(this, istek, ...r);
  };
  try {
    const r = await mod.paketeUygula(kok);
    assert.strictEqual(r.admZip, false);
    assert.match(r.hata, /Cannot find module/);
  } finally { Module._resolveFilename = asilResolve; }
});

test('Y-C durum dosyası: başarılı pakette mac/linux/WINDOWS etkin (sözleşme G1), Android etkin:false', async () => {
  const kok = paketKur();
  await m.paketeUygula(kok);
  const durum = JSON.parse(fs.readFileSync(path.join(kok, m.DURUM_ADI), 'utf8'));
  assert.deepStrictEqual(durum.etkin, { macos: true, linux: true, windows: true, android: false });
  assert.strictEqual(durum.hata, null);
});

test('kapı: EMPP_ICERIK_GUNCELLEME=0 kapatır, varsayılan açık', () => {
  assert.strictEqual(m.acikMi({}), true);
  assert.strictEqual(m.acikMi({ EMPP_ICERIK_GUNCELLEME: '0' }), false);
});

test('G5 (2026-09-26): kanalSPaketeUygula içerik kapısından BAĞIMSIZ kanal Ş\'yi kapatır, adm-zip KOYMAZ', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'kanal-s-'));
  const giris = 'const { app } = require("electron");\nconst checkForUpdates = async () => {\n  const AdmZip = require("adm-zip")\n}\napp.whenReady().then(() => {})\n';
  fs.writeFileSync(path.join(kok, 'main.js'), giris);
  fs.mkdirSync(path.join(kok, 'book1'));
  fs.writeFileSync(path.join(kok, 'book1', 'electron.js'), giris);
  const r = await m.kanalSPaketeUygula(kok);
  assert.deepStrictEqual(r.kanalSAcik, []);
  assert.deepStrictEqual(r.kanalS.map((x) => x.dosya).sort(), ['book1/electron.js', 'main.js'].map((y) => y.split('/').join(path.sep)).sort());
  for (const d of ['main.js', path.join('book1', 'electron.js')]) {
    assert.ok(fs.readFileSync(path.join(kok, d), 'utf8').includes(m.KANAL_S_ISARET), `${d} kapanmadı`);
  }
  assert.ok(!fs.existsSync(path.join(kok, m.VENDOR_DIZIN)), 'yalnız Ş kapatma adm-zip koymamalı');
  const ikinci = await m.kanalSPaketeUygula(kok);
  assert.ok(ikinci.kanalS.every((x) => x.sebep === 'zaten-kapali'), 'idempotent değil');
});

// ─── PLATFORM KAPSAMI (2026-09-26, Windows sözleşmesi ONAYLI — yalnız Windows) ───
// Bayrak virgüllü platform listesi alabilir; kapı yalnız işin platformlarının HEPSİ
// listedeyse açıktır (ortak workingPath: karışık işte mac çıktısına sızmasın).
// Kural kaynağı: platform-kapisi.js — burada bu modülün acikMi'si uçtan uca sınanır.
test('PLATFORM KAPSAMI: EMPP_ICERIK_GUNCELLEME=windows — windows açık, macos kapalı, karışık kapalı', () => {
  const uyarilar = [];
  const s = { uyar: (x) => uyarilar.push(x) };
  const env = { EMPP_ICERIK_GUNCELLEME: 'windows' };
  assert.strictEqual(m.acikMi(env, ['windows'], s), true, 'yalnız windows işi açık olmalı');
  assert.strictEqual(m.acikMi(env, ['macos'], s), false, 'yalnız macos işi kapalı olmalı');
  assert.strictEqual(m.acikMi(env, ['windows', 'macos'], s), false, 'karışık iş kapalı olmalı');
  assert.strictEqual(m.acikMi({ EMPP_ICERIK_GUNCELLEME: 'windows,macos' }, ['windows', 'macos'], s), true);
  assert.deepStrictEqual(uyarilar, []);
});

test('PLATFORM KAPSAMI: EMPP_ICERIK_GUNCELLEME eski değerler — 0 kapalı, 1 açık, tanımsız → varsayılan AÇIK', () => {
  for (const is of [['windows'], ['macos'], ['windows', 'macos'], undefined]) {
    assert.strictEqual(m.acikMi({ EMPP_ICERIK_GUNCELLEME: '0' }, is), false);
    assert.strictEqual(m.acikMi({ EMPP_ICERIK_GUNCELLEME: '1' }, is), true);
    assert.strictEqual(m.acikMi({}, is), true);
  }
});

test('PLATFORM KAPSAMI: EMPP_ICERIK_GUNCELLEME bilinmeyen platform adı → görünür UYARI, eşleşme yok', () => {
  const uyarilar = [];
  const s = { uyar: (x) => uyarilar.push(x) };
  assert.strictEqual(m.acikMi({ EMPP_ICERIK_GUNCELLEME: 'windows,mac' }, ['macos'], s), false);
  assert.strictEqual(uyarilar.length, 1);
  assert.match(uyarilar[0], /^UYARI: EMPP_ICERIK_GUNCELLEME tanınmayan platform adı: mac /);
  assert.strictEqual(m.acikMi({ EMPP_ICERIK_GUNCELLEME: 'windows,mac' }, ['windows'], s), true, 'tanınan ad çalışmaya devam eder');
});
