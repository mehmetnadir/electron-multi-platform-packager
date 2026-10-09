'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { kitapDizininiAndroidIcinUyarla, androidArsiviUret } = require('./android-arsiv-uretec');

test('kitapDizininiAndroidIcinUyarla: sahte kitap dizinine shim ve manifest ekler', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-android-arsiv-'));
  try {
    const bookDir = path.join(tmpDir, 'book1');
    await fs.ensureDir(bookDir);
    await fs.writeFile(path.join(bookDir, 'index.html'), '<html><head></head><body><h1>Test Book</h1></body></html>');
    await fs.writeFile(path.join(bookDir, 'app.js'), 'window.isApp=Boolean(true);');

    const result = await kitapDizininiAndroidIcinUyarla(bookDir);

    assert.ok(result.dosyalar && result.dosyalar.length > 0, 'Değişen dosyalar listesi dönmeli');
    assert.ok(await fs.pathExists(path.join(bookDir, 'empp-android-shim.js')), 'empp-android-shim.js kopyalanmalı');
    assert.ok(await fs.pathExists(path.join(bookDir, 'empp-manifest.json')), 'empp-manifest.json üretilmeli');

    const html = await fs.readFile(path.join(bookDir, 'index.html'), 'utf8');
    assert.ok(html.includes('empp-android-shim.js'), 'index.html shim referansı içermeli');
    assert.ok(html.includes('__webviewCompatShim'), 'index.html webviewCompatShim içermeli');

    const js = await fs.readFile(path.join(bookDir, 'app.js'), 'utf8');
    assert.ok(js.includes('window.isApp=true||Boolean('), 'app.js isApp yaması almalı');
  } finally {
    await fs.remove(tmpDir);
  }
});

test('kitapDizininiAndroidIcinUyarla: index.html yoksa Error fırlatır', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-android-arsiv-'));
  try {
    const bookDir = path.join(tmpDir, 'emptyBook');
    await fs.ensureDir(bookDir);

    await assert.rejects(
      async () => {
        await kitapDizininiAndroidIcinUyarla(bookDir);
      },
      (err) => {
        assert.match(err.message, /index\.html bulunamadı/);
        return true;
      }
    );
  } finally {
    await fs.remove(tmpDir);
  }
});

test('androidArsiviUret: dizini uyarlayıp zip arşivi oluşturur', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-android-arsiv-'));
  try {
    const bookDir = path.join(tmpDir, 'book1');
    await fs.ensureDir(bookDir);
    await fs.writeFile(path.join(bookDir, 'index.html'), '<html><head></head><body><h1>Zip Test</h1></body></html>');
    await fs.writeFile(path.join(bookDir, 'data.json'), '{"key":"value"}');

    const zipPath = path.join(tmpDir, 'output', 'book1-android.zip');
    const result = await androidArsiviUret(bookDir, zipPath);

    assert.strictEqual(result.ok, true);
    assert.ok(await fs.pathExists(zipPath), 'ZIP dosyası oluşturulmalı');

    const stat = await fs.stat(zipPath);
    assert.ok(stat.size > 0, 'ZIP dosyası boş olmamalı');

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries().map((e) => e.entryName);

    assert.ok(entries.includes('index.html'), 'ZIP index.html içermeli');
    assert.ok(entries.includes('empp-android-shim.js'), 'ZIP empp-android-shim.js içermeli');
    assert.ok(entries.includes('empp-manifest.json'), 'ZIP empp-manifest.json içermeli');
    assert.ok(entries.includes('data.json'), 'ZIP data.json içermeli');
  } finally {
    await fs.remove(tmpDir);
  }
});

/* ------------------------------------------------------------------------------------------------
 * 09.10 — packagingService'ten TAŞINAN her adım için mutasyon-yakalayan test.
 * Adım silinirse/sırası bozulursa ilgili test kırılır (bayt bayt aynı davranış kanıtı).
 * ---------------------------------------------------------------------------------------------- */
const { buildWebViewRequireShim, buildAndroidManifest } = require('./android-arsiv-uretec');
const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">';
const SHIM_TAG = '<script src="empp-android-shim.js"></script>';

async function sahteKitap(tmpDir, html, ek = {}) {
  const bookDir = path.join(tmpDir, 'book1');
  await fs.ensureDir(path.join(bookDir, 'assets', '56385', 'data'));
  await fs.ensureDir(path.join(bookDir, 'classlibraries'));
  await fs.writeFile(path.join(bookDir, 'index.html'), html);
  await fs.writeFile(path.join(bookDir, 'app.config.js'), 'const AppConfig = {};');
  await fs.writeFile(path.join(bookDir, 'assets', '56385', 'data', 'BookContent.xml'), '<xml/>');
  await fs.writeFile(path.join(bookDir, 'classlibraries', 'ImWin32.dll'), 'dll');
  for (const [ad, icerik] of Object.entries(ek)) {
    await fs.ensureDir(path.dirname(path.join(bookDir, ad)));
    await fs.writeFile(path.join(bookDir, ad), icerik);
  }
  return bookDir;
}

test('ALTIN ÇIKTI: boş <head> → tam olarak shim tag + compat shim + viewport (packagingService eski çıktısıyla birebir)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-android-arsiv-'));
  try {
    const bookDir = await sahteKitap(tmpDir, '<!doctype html><html><head><meta charset="utf-8"></head><body>book</body></html>');
    await kitapDizininiAndroidIcinUyarla(bookDir);
    const html = await fs.readFile(path.join(bookDir, 'index.html'), 'utf8');
    // Eski kod: viewport </head> öncesine; sonra <head>'in HEMEN ardına '\n' + androidShimTag + '\n' + requireShim.
    const beklenen = '<!doctype html><html><head>\n' + SHIM_TAG + '\n' + buildWebViewRequireShim()
      + '<meta charset="utf-8">' + VIEWPORT + '</head><body>book</body></html>';
    assert.strictEqual(html, beklenen);
  } finally { await fs.remove(tmpDir); }
});

test('viewport: mevcut meta kanonik değere ÇEVRİLİR (tek meta), yoksa </head> öncesine eklenir', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-android-arsiv-'));
  try {
    const b1 = await sahteKitap(tmpDir, '<html><head><meta name=\'viewport\' content="width=1024"></head><body></body></html>');
    await kitapDizininiAndroidIcinUyarla(b1);
    const h1 = await fs.readFile(path.join(b1, 'index.html'), 'utf8');
    assert.strictEqual((h1.match(/<meta\s+name=["']viewport["']/g) || []).length, 1, 'tek viewport');
    assert.ok(h1.includes(VIEWPORT) && !h1.includes('width=1024'));

    const b2 = path.join(tmpDir, 'book2');
    await fs.ensureDir(b2);
    await fs.writeFile(path.join(b2, 'index.html'), '<html><head><title>x</title></head><body></body></html>');
    await kitapDizininiAndroidIcinUyarla(b2);
    const h2 = await fs.readFile(path.join(b2, 'index.html'), 'utf8');
    assert.ok(h2.includes('<title>x</title>' + VIEWPORT + '</head>'), 'viewport </head> HEMEN öncesine');
  } finally { await fs.remove(tmpDir); }
});

test('eski empp-app-mode script kalıntısı temizlenir (kök ile aynı davranış)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-android-arsiv-'));
  try {
    const bookDir = await sahteKitap(tmpDir, '<html><head><script id="empp-app-mode">\nwindow.APP=1;\n</script></head><body></body></html>');
    await kitapDizininiAndroidIcinUyarla(bookDir);
    const html = await fs.readFile(path.join(bookDir, 'index.html'), 'utf8');
    assert.ok(!html.includes('empp-app-mode') && !html.includes('window.APP=1'));
  } finally { await fs.remove(tmpDir); }
});

test('sıra: android shim <head>\'in İLK çocuğu, compat shim ONDAN SONRA; ikinci koşu idempotent', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-android-arsiv-'));
  try {
    const bookDir = await sahteKitap(tmpDir, '<html><head><meta charset="utf-8"></head><body></body></html>');
    await kitapDizininiAndroidIcinUyarla(bookDir);
    const h1 = await fs.readFile(path.join(bookDir, 'index.html'), 'utf8');
    const afterHead = h1.slice(h1.indexOf('<head>') + '<head>'.length);
    assert.ok(afterHead.trimStart().startsWith(SHIM_TAG), 'shim tag head\'in ilk çocuğu');
    assert.ok(h1.indexOf('empp-android-shim.js') < h1.indexOf('__webviewCompatShim'), 'android shim ÖNCE');
    await kitapDizininiAndroidIcinUyarla(bookDir);
    const h2 = await fs.readFile(path.join(bookDir, 'index.html'), 'utf8');
    assert.strictEqual(h1, h2, 'idempotent');
    assert.strictEqual((h2.match(/empp-android-shim\.js/g) || []).length, 1);
    assert.strictEqual((h2.match(/__webviewCompatShim/g) || []).length, 1);
  } finally { await fs.remove(tmpDir); }
});

test('secenek.requireShim verilirse o kullanılır; verilmezse buildWebViewRequireShim() (packagingService ile aynı metin)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-android-arsiv-'));
  try {
    const bookDir = await sahteKitap(tmpDir, '<html><head></head><body></body></html>');
    await kitapDizininiAndroidIcinUyarla(bookDir, { requireShim: '<script id="__webviewCompatShim">/*OZEL*/</script>' });
    const html = await fs.readFile(path.join(bookDir, 'index.html'), 'utf8');
    assert.ok(html.includes('/*OZEL*/'));
    const svc = require('./packagingService');
    assert.strictEqual(svc._buildWebViewRequireShim(), buildWebViewRequireShim(), 'APK yolu ile G yolu AYNI compat shim metnini üretmeli');
  } finally { await fs.remove(tmpDir); }
});

test('window.isApp yaması: üst-düzey .js yamalanır, alt dizin ve desensiz dosya DOKUNULMAZ, dosyalar listesine girer', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-android-arsiv-'));
  try {
    const bundle = 'var a=1;window.isApp=Boolean(location.search.indexOf("app=1")>-1);window.isApp=Boolean(0);';
    const bookDir = await sahteKitap(tmpDir, '<html><head></head><body></body></html>', {
      'bundle.js': bundle, 'temiz.js': 'var x=1;', 'core/deep.js': bundle,
    });
    const r = await kitapDizininiAndroidIcinUyarla(bookDir);
    const js = await fs.readFile(path.join(bookDir, 'bundle.js'), 'utf8');
    assert.strictEqual(js, 'var a=1;window.isApp=true||Boolean(location.search.indexOf("app=1")>-1);window.isApp=true||Boolean(0);', 'HER geçiş yamalanır (split/join)');
    assert.strictEqual(await fs.readFile(path.join(bookDir, 'core', 'deep.js'), 'utf8'), bundle, 'alt dizin dokunulmaz');
    assert.strictEqual(await fs.readFile(path.join(bookDir, 'temiz.js'), 'utf8'), 'var x=1;');
    assert.ok(r.dosyalar.includes(path.join(bookDir, 'bundle.js')));
    assert.ok(!r.dosyalar.includes(path.join(bookDir, 'temiz.js')), 'yamalanmayan dosya listeye girmez');
  } finally { await fs.remove(tmpDir); }
});

test('empp-manifest.json: kitabın KENDİ köküne göre (tree[\'\'] kendini içermez, assets/<id> + classlibraries dirs)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-android-arsiv-'));
  try {
    const bookDir = await sahteKitap(tmpDir, '<html><head></head><body></body></html>');
    await kitapDizininiAndroidIcinUyarla(bookDir);
    const m = await fs.readJson(path.join(bookDir, 'empp-manifest.json'));
    assert.ok(!m.tree[''].includes('empp-manifest.json'), 'manifest kendini listelemez');
    assert.ok(m.tree[''].includes('empp-android-shim.js'), 'shim manifestten ÖNCE kopyalanır (sıra) → ağaçta görünür');
    assert.ok(m.dirs.includes('assets/56385') && m.dirs.includes('classlibraries'));
    assert.ok(m.tree['assets/56385'].includes('data') && m.tree['classlibraries'].includes('ImWin32.dll'));
    assert.deepStrictEqual(m, await buildAndroidManifest(bookDir).then((x) => ({ ...x, tree: { ...x.tree, '': x.tree[''] } })), 'yazılan = buildAndroidManifest çıktısı');
  } finally { await fs.remove(tmpDir); }
});

test('empp-android-shim.js kaynakla BAYT BAYT aynı (çevrimiçi yoklama kapalı), secenek.kaynakYolu kullanılır', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-android-arsiv-'));
  try {
    const bookDir = await sahteKitap(tmpDir, '<html><head></head><body></body></html>');
    const kaynak = path.join(__dirname, '../platforms/android/empp-android-shim.js');
    await kitapDizininiAndroidIcinUyarla(bookDir, { kaynakYolu: kaynak });
    assert.ok((await fs.readFile(kaynak)).equals(await fs.readFile(path.join(bookDir, 'empp-android-shim.js'))));
    const ozel = path.join(tmpDir, 'ozel-shim.js');
    await fs.writeFile(ozel, '// ozel shim');
    const b2 = path.join(tmpDir, 'book2'); await fs.ensureDir(b2);
    await fs.writeFile(path.join(b2, 'index.html'), '<html><head></head><body></body></html>');
    await kitapDizininiAndroidIcinUyarla(b2, { kaynakYolu: ozel });
    assert.strictEqual(await fs.readFile(path.join(b2, 'empp-android-shim.js'), 'utf8'), '// ozel shim');
  } finally { await fs.remove(tmpDir); }
});

test('salt-okunur index.html (EACCES): shim+manifest yazılır, sonra HATA fırlar — çağıran (packagingService) kitabı düşürür, sessiz geçiş yok', async (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) { t.skip('root 0400\'ü engellemez'); return; }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-android-arsiv-'));
  try {
    const bookDir = await sahteKitap(tmpDir, '<html><head></head><body></body></html>');
    const idx = path.join(bookDir, 'index.html');
    await fs.chmod(idx, 0o400);
    try {
      await assert.rejects(() => kitapDizininiAndroidIcinUyarla(bookDir), /EACCES|EPERM/);
    } finally { await fs.chmod(idx, 0o644); }
    assert.ok(await fs.pathExists(path.join(bookDir, 'empp-android-shim.js')));
    assert.ok(await fs.pathExists(path.join(bookDir, 'empp-manifest.json')));
    assert.ok(!(await fs.readFile(idx, 'utf8')).includes('empp-android-shim.js'), 'index.html değişmedi');
  } finally { await fs.remove(tmpDir); }
});
