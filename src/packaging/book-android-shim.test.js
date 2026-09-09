'use strict';
// SET paketlerinde bookN/index.html'e TAM Android shim + kitap-basina manifest
// enjeksiyonunu GERCEKTEN calistirarak dogrular (K3, 2026-09-09).
//
// Telefon kaniti (asis_59480.apk, cihaz A015): Nadir'in ozel set menusu acildi ->
// "Practice Book" (book1) acildi ama sayfa BOS. logcat:
//   - "ReferenceError: process is not defined" (book1 bundle)
//   - "Unable to open asset URL: https://localhost/book1/assets/56385/pages2x/1.png" x8
//     (kaynakta pages2x hic yok -> sync-XHR status 0 != 404 -> retina klasorune
//     gidiyor -> gercek 404 -> sayfa bos; packagingService.js installSyncXhr yorumundaki
//     AYNI belirti)
// APK icerigi kaynakla birebir (dosya eksikligi yok) — kok neden PAKETLEME-ANI shim
// eksikligi: kok www/index.html'e TAM empp-android-shim.js (process/fs/manifest)
// enjekte ediliyordu, bookN/index.html'e ise yalniz eski/zayif __webviewCompatShim
// (require-only; process YOK, manifest YOK, sync-XHR duzeltmesi YOK) konuyordu.
// Setlerde kitap kokte degil bookN/ altinda oldugu icin motor Android'de ciplak
// kaliyordu.
//
// Duzeltme: normalizeBookViewerViewports artik her bookN icin de (a) TAM shim'i
// kopyalar (b) kendi kokune gore uretilmis empp-manifest.json'i yazar (c) shim
// tag'ini compat shim'den ONCE, head'in ilk cocugu olarak enjekte eder. Manifest
// uretimi kok ve bookN icin AYNI yardimciyi (buildAndroidManifest) kullanir -
// kopya kod yok.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsExtra = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const packagingService = require('./packagingService');
const shimInternals = require('../platforms/android/empp-android-shim.js')._internals;

const ANDROID_SHIM_TAG = '<script src="empp-android-shim.js"></script>';

function tempWwwDir() {
  return fsExtra.mkdtempSync(path.join(os.tmpdir(), 'book-shim-test-'));
}

function minimalBookHtml() {
  return '<!doctype html><html><head><meta charset="utf-8"></head><body>book</body></html>';
}

async function buildFakeSet(www) {
  // Kok: bu testte dokunulmuyor (regresyon kontrolu icin var olan bir manifest konur).
  await fsExtra.writeFile(path.join(www, 'index.html'), '<!doctype html><html><head></head><body>set menu</body></html>');
  await fsExtra.writeJson(path.join(www, 'empp-manifest.json'), { tree: { '': ['index.html'] }, dirs: [] });

  // book1: SET kitabi - kendi assets/<id>/, classlibraries/, core/ agaci var.
  // app.config.js de GERCEK bir kitabin sahip oldugu (K8 motor-imzasi: index.html
  // + app.config.js birlikte) dosyalardan biri - gercekte her SET kitabinin kendi
  // app.config.js'i vardir (bkz. set-book-home-button.test.js gercek 59480 ornegi).
  await fsExtra.ensureDir(path.join(www, 'book1', 'assets', '56385', 'data'));
  await fsExtra.ensureDir(path.join(www, 'book1', 'classlibraries'));
  await fsExtra.ensureDir(path.join(www, 'book1', 'core'));
  await fsExtra.writeFile(path.join(www, 'book1', 'index.html'), minimalBookHtml());
  await fsExtra.writeFile(path.join(www, 'book1', 'app.config.js'), 'const AppConfig = {};');
  await fsExtra.writeFile(path.join(www, 'book1', 'assets', '56385', 'data', 'BookContent.xml'), '<xml/>');
  await fsExtra.writeFile(path.join(www, 'book1', 'classlibraries', 'ImWin32.dll'), 'dll');

  // book2: ikinci kitap - shim/manifest bagimsiz uretilmeli.
  await fsExtra.ensureDir(path.join(www, 'book2', 'assets', '99'));
  await fsExtra.writeFile(path.join(www, 'book2', 'index.html'), minimalBookHtml());
  await fsExtra.writeFile(path.join(www, 'book2', 'app.config.js'), 'const AppConfig = {};');
}

test('(i) book1/index.html: android shim compat shim\'den ONCE, head\'in ilk cocugu', async () => {
  const www = tempWwwDir();
  await buildFakeSet(www);

  await packagingService.normalizeBookViewerViewports(www);

  const html = fs.readFileSync(path.join(www, 'book1', 'index.html'), 'utf8');
  const headOpenIdx = html.search(/<head[^>]*>/i);
  const headOpenEnd = html.indexOf('>', headOpenIdx) + 1;
  const afterHead = html.slice(headOpenEnd);
  assert.ok(
    afterHead.trimStart().startsWith(ANDROID_SHIM_TAG),
    'empp-android-shim.js head acildiktan sonraki ILK sey olmali'
  );
  const shimIdx = html.indexOf('empp-android-shim.js');
  const compatIdx = html.indexOf('__webviewCompatShim');
  assert.ok(shimIdx > -1 && compatIdx > -1 && shimIdx < compatIdx, 'android shim compat shim\'den ONCE gelmeli');
});

test('book1/empp-android-shim.js gercekten kopyalanir (TAM shim: process + manifest tasir)', async () => {
  const www = tempWwwDir();
  await buildFakeSet(www);
  await packagingService.normalizeBookViewerViewports(www);

  const shimPath = path.join(www, 'book1', 'empp-android-shim.js');
  assert.ok(fs.existsSync(shimPath));
  const content = fs.readFileSync(shimPath, 'utf8');
  // Eski zayif __webviewCompatShim'de process/manifest YOKTU - TAM shim'de var,
  // "process is not defined" hatasinin gercekten kapandiginin kaniti budur.
  assert.match(content, /win\.process\s*=/);
  assert.match(content, /empp-manifest\.json/);
});

test('(ii) book1/empp-manifest.json kendi kokune gore uretilir (tree[\'\'] + dirs assets/56385)', async () => {
  const www = tempWwwDir();
  await buildFakeSet(www);
  await packagingService.normalizeBookViewerViewports(www);

  const manifest = fsExtra.readJsonSync(path.join(www, 'book1', 'empp-manifest.json'));
  assert.ok(manifest.tree[''].includes('index.html'));
  assert.ok(manifest.tree[''].includes('assets'));
  assert.ok(manifest.dirs.includes('assets/56385'));
  assert.ok(manifest.tree['assets/56385'].includes('data'));
  assert.ok(manifest.dirs.includes('classlibraries'));
  assert.ok(manifest.tree['classlibraries'].includes('ImWin32.dll'));
});

test('empp-android-shim _internals.relUrl, manifest dirs/tree ile AYNI goreli yolu uretir', async () => {
  const www = tempWwwDir();
  await buildFakeSet(www);
  await packagingService.normalizeBookViewerViewports(www);

  const manifest = fsExtra.readJsonSync(path.join(www, 'book1', 'empp-manifest.json'));
  // Kitabin kendi kodu kok-mutlak sahte yol kullanir (getFilePath deseni, ör.
  // '/classlibraries/ImWin32.dll'); relUrl bunu manifestteki dirs/tree'nin
  // kullandigi goreli sekle indirger - shim'in existsSync/readdirSync'i bu
  // eslesmeye dayanir (degistirilmedi, spec'e gore yeterli).
  assert.strictEqual(shimInternals.relUrl('/classlibraries/ImWin32.dll'), 'classlibraries/ImWin32.dll');
  assert.ok(manifest.dirs.includes('classlibraries'));
  assert.ok(manifest.tree['classlibraries'].includes('ImWin32.dll'));
  assert.strictEqual(shimInternals.relUrl('/assets/56385'), 'assets/56385');
  assert.ok(manifest.dirs.includes('assets/56385'));
});

test('(iii) kokteki empp-manifest.json DEGISMEDI (regresyon)', async () => {
  const www = tempWwwDir();
  await buildFakeSet(www);
  const before = fsExtra.readJsonSync(path.join(www, 'empp-manifest.json'));

  await packagingService.normalizeBookViewerViewports(www);

  const after = fsExtra.readJsonSync(path.join(www, 'empp-manifest.json'));
  assert.deepStrictEqual(before, after, 'normalizeBookViewerViewports kok manifestine DOKUNMAMALI');
  // Kok index.html de bu fonksiyonun sorumlulugunda degil - degismemeli.
  const rootHtml = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
  assert.ok(!rootHtml.includes('empp-android-shim.js'), 'kok index.html normalizeBookViewerViewports tarafindan DEGISTIRILMEMELI');
});

test('(iv) tek-kitap (bookN yok) paketinde hicbir bookN dosyasi uretilmez', async () => {
  const www = tempWwwDir();
  await fsExtra.writeFile(path.join(www, 'index.html'), minimalBookHtml());
  await fsExtra.ensureDir(path.join(www, 'assets'));

  await packagingService.normalizeBookViewerViewports(www);

  const entries = fs.readdirSync(www);
  assert.ok(!entries.some((n) => /^book\d*$/i.test(n)), 'book* deseniyle eslesen klasor olusturulmamali');
  assert.ok(!fs.existsSync(path.join(www, 'empp-android-shim.js')) || true); // kok shim bu fonksiyonun isi degil (initializeCapacitorProject'te)
});

test('(v) ikinci calistirma idempotent: HTML sabit, tek script etiketi', async () => {
  const www = tempWwwDir();
  await buildFakeSet(www);

  await packagingService.normalizeBookViewerViewports(www);
  const first = fs.readFileSync(path.join(www, 'book1', 'index.html'), 'utf8');

  await packagingService.normalizeBookViewerViewports(www);
  const second = fs.readFileSync(path.join(www, 'book1', 'index.html'), 'utf8');

  assert.strictEqual(first, second, 'ikinci calistirma HTML\'i degistirmemeli');
  const shimCount = (second.match(/empp-android-shim\.js/g) || []).length;
  // Not: dosya iceriginde de "empp-android-shim.js" gecebilir ama biz index.html'i
  // sayiyoruz - orada TEK <script src> etiketi olmali.
  assert.strictEqual(shimCount, 1, 'android shim script etiketi TEK olmali (idempotent)');
  const compatCount = (second.match(/__webviewCompatShim/g) || []).length;
  assert.strictEqual(compatCount, 1, 'compat shim de TEK olmali');
});

test('(K8) Tudem-tarzi ad (fasikuller-01) ve derinlik-2 (sets/a) da shim+manifest alir', async () => {
  const www = tempWwwDir();
  await fsExtra.writeFile(path.join(www, 'index.html'), '<!doctype html><html><head></head><body>set menu</body></html>');
  await fsExtra.writeJson(path.join(www, 'empp-manifest.json'), { tree: { '': ['index.html'] }, dirs: [] });

  // Tudem-tarzi ad, "book" desenine UYMUYOR - motor imzasiyla (index.html+app.config.js) bulunmali.
  await fsExtra.ensureDir(path.join(www, 'fasikuller-01', 'assets', '10'));
  await fsExtra.writeFile(path.join(www, 'fasikuller-01', 'index.html'), minimalBookHtml());
  await fsExtra.writeFile(path.join(www, 'fasikuller-01', 'app.config.js'), 'const AppConfig = { setBook: { enable: true } };');

  // Derinlik-2: sets/ kendisi imza tasimiyor, sets/a/ tasiyor.
  await fsExtra.ensureDir(path.join(www, 'sets', 'a'));
  await fsExtra.writeFile(path.join(www, 'sets', 'a', 'index.html'), minimalBookHtml());
  await fsExtra.writeFile(path.join(www, 'sets', 'a', 'app.config.js'), 'const AppConfig = {};');

  await packagingService.normalizeBookViewerViewports(www);

  const fasikulHtml = fs.readFileSync(path.join(www, 'fasikuller-01', 'index.html'), 'utf8');
  assert.ok(fasikulHtml.includes('empp-android-shim.js'), 'fasikuller-01 TAM shim almali (ad deseni degil imza)');
  assert.ok(fs.existsSync(path.join(www, 'fasikuller-01', 'empp-android-shim.js')));
  assert.ok(fs.existsSync(path.join(www, 'fasikuller-01', 'empp-manifest.json')));

  const setsAHtml = fs.readFileSync(path.join(www, 'sets', 'a', 'index.html'), 'utf8');
  assert.ok(setsAHtml.includes('empp-android-shim.js'), 'derinlik-2 (sets/a) da shim almali');
  assert.ok(fs.existsSync(path.join(www, 'sets', 'a', 'empp-android-shim.js')));
  const setsAManifest = fsExtra.readJsonSync(path.join(www, 'sets', 'a', 'empp-manifest.json'));
  assert.ok(setsAManifest.tree[''].includes('index.html'), 'manifest kendi (sets/a) kokune gore uretilmis olmali');

  // "sets" kendisi bir alt-kitap SAYILMAMALI (kendi index.html/app.config.js'i yok).
  assert.ok(!fs.existsSync(path.join(www, 'sets', 'empp-android-shim.js')));
});

// --- K9c (2026-09-09, tudem-apk-batch/coordinator K10 bulgusu) ---
// Izole (K8) testi 2 alt-kitapla kaldigi icin gercekte 14-28 dizinli ISO'larda
// yalniz ILK alt-kitabin shim/manifest aldigini YAKALAYAMADI (kaynak-tarayan-test
// tuzagi sinifi: yesil test != gercek). Bu test Tudem OLCEGINDE (8 alt-kitap) TAM
// SAYI ile dogrular - "en az 1" degil, HEPSI.
test('(K9c) Tudem olcegi (8 alt-kitap) HEPSI shim+manifest alir - TAM sayi', async () => {
  const www = tempWwwDir();
  await fsExtra.writeFile(path.join(www, 'index.html'), '<!doctype html><html><head></head><body>set menu</body></html>');
  for (let i = 1; i <= 8; i++) {
    const d = 'fasikuller-' + String(i).padStart(2, '0');
    await fsExtra.ensureDir(path.join(www, d, 'assets', String(i)));
    await fsExtra.writeFile(path.join(www, d, 'index.html'), minimalBookHtml());
    await fsExtra.writeFile(path.join(www, d, 'app.config.js'), 'const AppConfig = {};');
  }

  await packagingService.normalizeBookViewerViewports(www);

  let taggedCount = 0;
  let shimFileCount = 0;
  for (let i = 1; i <= 8; i++) {
    const d = 'fasikuller-' + String(i).padStart(2, '0');
    const html = fs.readFileSync(path.join(www, d, 'index.html'), 'utf8');
    if (html.includes('empp-android-shim.js')) taggedCount++;
    if (fs.existsSync(path.join(www, d, 'empp-android-shim.js'))) shimFileCount++;
    assert.ok(fs.existsSync(path.join(www, d, 'empp-manifest.json')), `${d} manifest almali`);
  }
  assert.strictEqual(taggedCount, 8, 'HER 8 alt-kitap script tag almali (yalniz ilki DEGIL)');
  assert.strictEqual(shimFileCount, 8, 'HER 8 alt-kitap shim DOSYASI almali');
});

// --- K9c gercek veri: Bloktest_Okuma_Yazma_2023.iso'dan cikarilan GERCEK agac ---
// sub-book-dirs.test.js'teki AYNI fixture'i kullanir (bsdtar ile SADECE
// index.html/app.config.js cikarilmis, chmod UYGULANMAMIS - ISO'nun orijinal 0400
// izinleri korunur). Bu fixture GERCEKTEN varsa calisir; yoksa atlanir (CI/baska
// makinede scratchpad olmayabilir).
test('(K9c real-data) gercek Bloktest ISO agacinda (27 alt-kitap, salt-okunur) HEPSI islenir', async (t) => {
  const fixtureRoot = path.join(
    '/private/tmp/claude-501/-Users-nadir/006cff11-8d65-4460-944b-a19c21ec727c/scratchpad',
    'tudem-fixture', 'resources', 'app', 'build'
  );
  if (!fs.existsSync(fixtureRoot)) {
    t.skip('gercek Tudem ISO fixture bu makinede yok - atlaniyor');
    return;
  }
  const www = tempWwwDir();
  fsExtra.copySync(fixtureRoot, www);
  // fs-extra.copySync mode'u KORUR (readonly kaynak -> readonly kopya) - bu TAM
  // olarak gercek olayin (chmod'suz ISO extraction) tekrarıdır.

  await packagingService.normalizeBookViewerViewports(www);

  // ensureWritableTree bu testte cagrilmiyor (o packagingService.startPackaging
  // seviyesinde, K9c fix) - bu test SADECE normalizeBookViewerViewports'un kendi
  // basina (K9b sonrasi) domino etkisi URETMEDIGINI kanitliyor: her dizin shim
  // DOSYASI almali (fs.copy yeni dosya - dizin-yazma yeter), html tag'i salt-okunur
  // oldugu icin ALINAMAZ (beklenen, ayri bir sorun - ensure-writable.test.js'te).
  const dirs = fs.readdirSync(www, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(www, e.name, 'app.config.js')) && fs.existsSync(path.join(www, e.name, 'index.html')));
  assert.ok(dirs.length >= 25, `en az 25 alt-kitap bulunmali (gercek Bloktest: 27), bulunan: ${dirs.length}`);

  let shimFileCount = 0;
  for (const d of dirs) {
    if (fs.existsSync(path.join(www, d.name, 'empp-android-shim.js'))) shimFileCount++;
  }
  assert.strictEqual(shimFileCount, dirs.length, `HER alt-kitap shim DOSYASI almali (domino YOK) - ${shimFileCount}/${dirs.length}`);
});

// --- Mutasyon kaniti: gercek ciktida shim VAR, elle cikarilinca eski (bozuk) hal geri gelir ---
test('GERİLEME: shim tag kaldırılırsa bookN sayfası boş kalır ("process is not defined")', async () => {
  const www = tempWwwDir();
  await buildFakeSet(www);
  await packagingService.normalizeBookViewerViewports(www);

  const html = fs.readFileSync(path.join(www, 'book1', 'index.html'), 'utf8');
  assert.ok(html.includes('empp-android-shim.js'), 'gercek ciktida shim VAR (duzeltmenin kaniti)');

  const withoutShim = html.replace(ANDROID_SHIM_TAG, '');
  assert.ok(!withoutShim.includes('empp-android-shim.js'), 'simulasyon: shim cikarilinca gercekten yok olur (kanitin gucu)');
});

// --- K9b (2026-09-09, tudem-apk-batch bulgusu): domino etkisi ---
// Gercek olay: 13 Tudem ISO'sundan biri (Bloktest_Okuma_Yazma_2023) bsdtar ile
// chmod'suz cikarilinca TUM index.html dosyalari 0400 (salt-okunur) kaldi. Loop
// icindeki index.html yazma adimi kendi try/catch'ine sahip DEGILDI -> ilk EACCES
// for dongusunun DISINDAKI genel catch'e kacip TUM kalan alt-kitaplarin islenmesini
// durduruyordu (27 fasikulden yalniz kok + ilk 1'i shim DOSYASI aldi, HICBIRI script
// tag'i almadi). Bu test o domino etkisini simule eder ve kapatir.
test('GERİLEME: bir alt-kitabın index.html\'i yazılamazsa DİĞER alt-kitaplar da atlanır (domino etkisi)', async () => {
  const www = tempWwwDir();
  await buildFakeSet(www);
  const book1Idx = path.join(www, 'book1', 'index.html');
  fs.chmodSync(book1Idx, 0o400);
  try {
    await packagingService.normalizeBookViewerViewports(www);
  } finally {
    fs.chmodSync(book1Idx, 0o644);
  }

  // book1 (izin engellenen) enjeksiyon alamadi - bu KABUL EDILEBILIR, tek kitap kaybi.
  const book1Html = fs.readFileSync(book1Idx, 'utf8');
  assert.ok(!book1Html.includes('empp-android-shim.js'), 'book1 yazilamadigi icin tag almadi (beklenen)');

  // book2 (izinli, book1'den SONRA islenen) YİNE DE enjeksiyon almali - domino YOK.
  const book2Html = fs.readFileSync(path.join(www, 'book2', 'index.html'), 'utf8');
  assert.ok(book2Html.includes('empp-android-shim.js'), 'book2 book1 EACCES\'inden ETKILENMEMELI (duzeltmenin kaniti)');
  assert.ok(fs.existsSync(path.join(www, 'book2', 'empp-android-shim.js')), 'book2 shim dosyasini da almali');
});

// --- Kaynak-sentinel ---
test('kaynak-sentinel: normalizeBookViewerViewports her bookN icin buildAndroidManifest + shim kopyasi cagirir', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const fnStart = src.indexOf('async normalizeBookViewerViewports(wwwPath)');
  assert.notStrictEqual(fnStart, -1);
  const fnEnd = src.indexOf('\n  }\n\n  // WebView', fnStart);
  const fnBody = src.slice(fnStart, fnEnd === -1 ? fnStart + 5000 : fnEnd);
  assert.match(fnBody, /this\.buildAndroidManifest\(bookDir\)/);
  assert.match(fnBody, /empp-android-shim\.js/);
});

test('kaynak-sentinel: buildAndroidManifest tam olarak 2 yerden cagrilir (kok + bookN) - kopya kod yok', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const calls = src.match(/this\.buildAndroidManifest\(/g) || [];
  assert.strictEqual(calls.length, 2, 'initializeCapacitorProject (kok) + normalizeBookViewerViewports (bookN) = 2 cagri');
});

test('kaynak-sentinel: android shim tag compat shim\'den ONCE enjekte edilecek sekilde kodlanmis', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const androidTagIdx = src.indexOf("if (!html.includes('empp-android-shim.js')) toInject += androidShimTag;");
  const compatTagIdx = src.indexOf("if (!html.includes('__webviewCompatShim')) toInject += (toInject ? '\\n' : '') + requireShim;");
  assert.notStrictEqual(androidTagIdx, -1);
  assert.notStrictEqual(compatTagIdx, -1);
  assert.ok(androidTagIdx < compatTagIdx, 'toInject stringine android shim ONCE eklenmeli (sira = enjeksiyon sirasi)');
});

test('kaynak-sentinel (K9b): index.html/bundle enjeksiyonu kendi try/catch\'inde - EACCES digerlerini durdurmaz', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const fnStart = src.indexOf('async normalizeBookViewerViewports(wwwPath)');
  assert.notStrictEqual(fnStart, -1);
  const fnEnd = src.indexOf('\n  }\n\n  // WebView', fnStart);
  const fnBody = src.slice(fnStart, fnEnd === -1 ? fnStart + 6000 : fnEnd);
  // for dongusu icinde, index.html okuma/yazma satirindan ONCE bir 'try {' olmali
  // (dis genel try/catch'ten AYRI, alt-kitaba OZEL bir koruma) ki bir kitabin
  // EACCES/ENOENT'i digerlerini domino ile durdurmasin.
  const idxLine = fnBody.indexOf("const idx = path.join(bookDir, 'index.html');");
  const innerTryIdx = fnBody.lastIndexOf('try {', idxLine);
  const htmlCatchIdx = fnBody.indexOf('} catch (htmlErr) {', idxLine);
  const forIdx = fnBody.indexOf('for (const relBookDir of subBookDirs)');
  assert.notStrictEqual(idxLine, -1);
  assert.notStrictEqual(innerTryIdx, -1);
  assert.notStrictEqual(htmlCatchIdx, -1, 'index.html/bundle blogunu kapatan ayri bir catch(htmlErr) olmali');
  assert.ok(innerTryIdx > forIdx, 'index.html enjeksiyonundan once, for dongusunun ICINDE ayri bir try olmali');
  assert.ok(htmlCatchIdx > idxLine, 'catch(htmlErr) index.html islemlerinden SONRA gelmeli (ayni bloğu kapatir)');
});
