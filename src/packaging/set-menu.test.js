'use strict';
// K17 — SET kök menüsü üretimi (2026-09-17, Pardus ölçümü).
//
// Vaka: sf425 "Shall We 5 Set - Maarif Model" .impark'ı ProBook'ta beyaz ekran;
// konsol "assets not found in .../app.asar" + "ImWin32.dll dosyası okunamadı".
// Kök index.html motorun tek-kitap sayfasının kopyasıydı, kökte assets/ ve
// classlibraries/ yoktu (içerik book1..book4'te). Çalışan set (Flashy 59480)
// kökünde ÖZEL menü + assets2/ görselleri var.
//
// Bu testler üretilen menünün üç sözleşmesini çivi ler:
//   (a) ÖZEL menü varsa dokunulmaz — çalışan paketler bozulmaz,
//   (b) motor kopyası menüye dönüşür, orijinal sayfa YEDEKLENİR (silinmez),
//   (c) kapı kapalıyken (EMPP_SET_MENU yok) HİÇBİR ŞEY değişmez — K1 kararının
//       varsayılan davranışı korunur.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { ensureSetMenu, motorKopyasiMi, MENU_ISARETI, YEDEK_AD } = require('./set-menu');

const MOTOR_INDEX = '<!doctype html><html><head><script src="empp-fs-shim.js"></script>'
  + '<script src="app.config.js"></script></head><body>'
  + '<script defer="defer" src="./a8f43f74c72b65a3dd05.main.js"></script></body></html>';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'set-menu-test-'));
}

/** bookN'leri olan sahte SET build'i; assets2 opsiyonel, kapak thumbs'tan. */
async function sahteSet(opts = {}) {
  const kok = tempDir();
  const kitapSayisi = opts.books != null ? opts.books : 3;
  for (let i = 1; i <= kitapSayisi; i += 1) {
    const b = path.join(kok, `book${i}`);
    await fs.ensureDir(b);
    await fs.writeFile(path.join(b, 'index.html'), MOTOR_INDEX);
    await fs.writeFile(path.join(b, 'app.config.js'), 'const AppConfig = { setBook: { enable: true } };');
    const id = String(58000 + i);
    await fs.ensureDir(path.join(b, 'assets', id, 'thumbs'));
    await fs.writeFile(path.join(b, 'assets', id, 'thumbs', '1.jpg'), 'jpg');
    if (opts.pdfUrl !== false) {
      await fs.ensureDir(path.join(b, 'assets', id, 'data'));
      await fs.writeFile(path.join(b, 'assets', id, 'data', 'BookContent.xml'),
        `<?xml version="1.0"?><Book kitapId="060306${i}" pdfUrl="pdf/SHALL-WE-5-BOOK-${i}-2025.pdf" />`);
    }
  }
  if (opts.assets2) {
    await fs.ensureDir(path.join(kok, 'assets2'));
    await fs.writeFile(path.join(kok, 'assets2', 'styles.css'), '#container{}');
    await fs.writeFile(path.join(kok, 'assets2', 'logo.png'), 'png');
    for (let i = 1; i <= kitapSayisi; i += 1) {
      await fs.writeFile(path.join(kok, 'assets2', `book${i}-button.png`), 'png');
      await fs.writeFile(path.join(kok, 'assets2', `book${i}.png`), 'png');
    }
  }
  if (opts.rootIndex !== null) {
    await fs.writeFile(path.join(kok, 'index.html'), opts.rootIndex || MOTOR_INDEX);
  }
  return kok;
}

test('kapı kapalıyken (EMPP_SET_MENU yok) hiçbir dosya değişmez', async () => {
  const kok = await sahteSet();
  const once = fs.readFileSync(path.join(kok, 'index.html'), 'utf8');
  const eski = process.env.EMPP_SET_MENU;
  delete process.env.EMPP_SET_MENU;
  try {
    const r = await ensureSetMenu(kok);
    assert.strictEqual(r.action, 'disabled');
  } finally {
    if (eski != null) process.env.EMPP_SET_MENU = eski;
  }
  assert.strictEqual(fs.readFileSync(path.join(kok, 'index.html'), 'utf8'), once);
  assert.ok(!fs.existsSync(path.join(kok, YEDEK_AD)), 'yedek de oluşmamalı');
});

test('motor kopyası kök menüye dönüşür; orijinal sayfa yedeklenir (silinmez)', async () => {
  const kok = await sahteSet({ books: 4 });
  const r = await ensureSetMenu(kok, { force: true, appName: 'Shall We 5 Set' });
  assert.strictEqual(r.action, 'generated');
  assert.strictEqual(r.mode, 'sade');
  assert.deepStrictEqual(r.books, ['book1', 'book2', 'book3', 'book4']);
  const html = fs.readFileSync(path.join(kok, 'index.html'), 'utf8');
  assert.ok(html.includes(MENU_ISARETI), 'menü imzası');
  for (let i = 1; i <= 4; i += 1) {
    assert.ok(html.includes(`href="book${i}/index.html"`), `book${i} bağlantısı`);
    assert.ok(html.includes(`book${i}/assets/5800${i}/thumbs/1.jpg`), `book${i} kapağı`);
  }
  assert.ok(html.includes('Shall We 5 Set'), 'başlık');
  assert.ok(!/\.main\.js/.test(html), 'menüde motor bundle çağrısı OLMAMALI');
  assert.strictEqual(fs.readFileSync(path.join(kok, YEDEK_AD), 'utf8'), MOTOR_INDEX);
});

test('assets2 varsa yayıncının kendi tasarımı kullanılır (Flashy iskeleti)', async () => {
  const kok = await sahteSet({ books: 3, assets2: true });
  const r = await ensureSetMenu(kok, { force: true });
  assert.strictEqual(r.mode, 'assets2');
  const html = fs.readFileSync(path.join(kok, 'index.html'), 'utf8');
  assert.ok(html.includes('assets2/styles.css'), 'yayıncı stili');
  assert.ok(html.includes('assets2/logo.png'), 'yayıncı logosu');
  assert.ok(html.includes('src="assets2/book2-button.png"'), 'buton görseli');
  assert.ok(html.includes('src="assets2/book2.png"'), 'kapak görseli');
});

test('ÖZEL menü korunur — çalışan SET paketleri bozulmaz (Flashy 59480 vakası)', async () => {
  const ozel = '<!DOCTYPE html><html><head><link href="assets2/styles.css" rel="stylesheet">'
    + '</head><body><img src="assets2/book1-button.png" onclick="animateCover(this)"></body></html>';
  const kok = await sahteSet({ rootIndex: ozel, assets2: true });
  const r = await ensureSetMenu(kok, { force: true });
  assert.strictEqual(r.action, 'custom-menu-kept');
  assert.strictEqual(fs.readFileSync(path.join(kok, 'index.html'), 'utf8'), ozel);
  assert.ok(!fs.existsSync(path.join(kok, YEDEK_AD)));
});

test('idempotent — ikinci çağrı üretilen menüyü yeniden yazmaz', async () => {
  const kok = await sahteSet();
  await ensureSetMenu(kok, { force: true });
  const ilk = fs.readFileSync(path.join(kok, 'index.html'), 'utf8');
  const r2 = await ensureSetMenu(kok, { force: true });
  assert.strictEqual(r2.action, 'already-generated');
  assert.strictEqual(fs.readFileSync(path.join(kok, 'index.html'), 'utf8'), ilk);
});

test('tek kitap (alt-kitap yok) paketinde no-op', async () => {
  const kok = tempDir();
  await fs.writeFile(path.join(kok, 'index.html'), MOTOR_INDEX);
  await fs.writeFile(path.join(kok, 'app.config.js'), 'const AppConfig = {};');
  await fs.ensureDir(path.join(kok, 'assets', '59480'));
  const r = await ensureSetMenu(kok, { force: true });
  assert.strictEqual(r.action, 'not-a-set');
  assert.strictEqual(fs.readFileSync(path.join(kok, 'index.html'), 'utf8'), MOTOR_INDEX);
});

test('GERİLEME: motor imzası tanınmazsa kırık kök menüye DÖNÜŞMEZ', () => {
  // motorKopyasiMi gevşetilir/kaldırılırsa bu test kırılır: kırık paketin kökü
  // (hash'li bundle çağıran sayfa) MUTLAKA motor kopyası sayılmalı.
  assert.strictEqual(motorKopyasiMi(MOTOR_INDEX), true);
  assert.strictEqual(motorKopyasiMi('<html><body>menü</body></html>'), false);
  assert.strictEqual(motorKopyasiMi(`${MENU_ISARETI}<html>x</html>`), false, 'kendi ürettiğimiz menü');
});

test('kitap adı kaynaktan (BookContent.xml pdfUrl) okunur, "Kitap N" değil', async () => {
  const kok = await sahteSet({ books: 2 });
  await ensureSetMenu(kok, { force: true });
  const html = fs.readFileSync(path.join(kok, 'index.html'), 'utf8');
  assert.ok(html.includes('Shall We 5 Book 1 2025'), 'book1 adı pdfUrl\'den türetilmeli');
  assert.ok(!html.includes('Kitap 1<'), 'yedek etiket kullanılmamalı');
});

test('BookContent.xml yoksa "Kitap N" yedeği kullanılır', async () => {
  const kok = await sahteSet({ books: 2, pdfUrl: false });
  await ensureSetMenu(kok, { force: true });
  const html = fs.readFileSync(path.join(kok, 'index.html'), 'utf8');
  assert.ok(html.includes('Kitap 1'), 'yedek etiket');
});

test('alt kitapta kapak yoksa menü yine üretilir (kapaksız kart)', async () => {
  const kok = await sahteSet({ books: 2 });
  await fs.remove(path.join(kok, 'book2', 'assets'));
  const r = await ensureSetMenu(kok, { force: true });
  assert.strictEqual(r.action, 'generated');
  const html = fs.readFileSync(path.join(kok, 'index.html'), 'utf8');
  assert.ok(html.includes('href="book2/index.html"'), 'kapaksız kitap da menüde');
});

// 2026-09-24 — 73768 (Super Monsters Grade 3 - Maarif): tek kabuk kuralı.
// Kabuğun tek üreticisi Üretim Masası (Web-Z sf425); bu modül onu EZMEZ ve kabuk izi
// olan kökte sade menü (ID etiketli, beyaz) ÜRETMEZ.
const WEBZ_INDEX = '<!DOCTYPE html><html><head><title>Super Monsters Grade 3 - Maarif</title>'
  + '</head><body><div id="bookSetContainer"></div>'
  + '<script src="scripts/cevrimdisi-yama.js"></script>'
  + '<script src="scripts/language-set.js"></script></body></html>';

async function kabukDosyalari(kok) {
  await fs.ensureDir(path.join(kok, 'config'));
  await fs.writeFile(path.join(kok, 'config', 'settings.json'), '{"books":{}}');
  await fs.ensureDir(path.join(kok, 'scripts'));
  await fs.writeFile(path.join(kok, 'scripts', 'language-set.js'), '// tema');
}

test('Web-Z kabuğu kökteyse dokunulmaz (masaüstü tek kabuk üreticisi)', async () => {
  const kok = await sahteSet({ rootIndex: WEBZ_INDEX });
  await kabukDosyalari(kok);
  const r = await ensureSetMenu(kok, { force: true });
  assert.strictEqual(r.action, 'custom-menu-kept');
  assert.strictEqual(r.kabuk, 'webz');
  assert.strictEqual(fs.readFileSync(path.join(kok, 'index.html'), 'utf8'), WEBZ_INDEX);
  assert.ok(!fs.existsSync(path.join(kok, YEDEK_AD)), 'yedek oluşmamalı');
});

test('kabuk dosyaları var ama kök motor kopyası → sade menü ÜRETİLMEZ (73768 vakası)', async () => {
  const kok = await sahteSet();
  await kabukDosyalari(kok);
  const r = await ensureSetMenu(kok, { force: true });
  assert.strictEqual(r.action, 'webz-shell-index-missing');
  const html = fs.readFileSync(path.join(kok, 'index.html'), 'utf8');
  assert.ok(!html.includes(MENU_ISARETI), 'sade menü yazılmamalı');
  assert.ok(motorKopyasiMi(html), 'kök olduğu gibi kalır');
});

test('sayısal PDF adı kitap adı sayılmaz (pdf/15792.pdf → "Kitap N", "15792" değil)', async () => {
  const kok = await sahteSet({ books: 2, pdfUrl: false });
  for (let i = 1; i <= 2; i += 1) {
    const d = path.join(kok, `book${i}`, 'assets', String(58000 + i), 'data');
    await fs.ensureDir(d);
    await fs.writeFile(path.join(d, 'BookContent.xml'),
      `<?xml version="1.0"?><Book pdfUrl="pdf/1579${i}.pdf" />`);
  }
  await ensureSetMenu(kok, { force: true });
  const html = fs.readFileSync(path.join(kok, 'index.html'), 'utf8');
  assert.ok(!html.includes('>15791<') && !html.includes('>15792<'), 'kimlik ad olarak basılmamalı');
  assert.ok(html.includes('Kitap 1'), 'yedek etiket');
});
