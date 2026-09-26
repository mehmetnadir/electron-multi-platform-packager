'use strict';

/**
 * `kok-yedek-dizin-disla.js` testleri — açık iş 5 (2026-09-26): `_` ile
 * başlayan KÖK dizinler (ör. `_eski/`) hiçbir platformun paketine girmemeli.
 *
 * Üç katman:
 *   (1) Modülün kendi saf fonksiyonları (birim test, gerçek dosya sistemi).
 *   (2) electron-builder desenlerinin GERÇEK `FileMatcher` ile davranışı
 *       (windows-asarsiz.test.js B3d ile AYNI teknik — model değil, canlı sınıf).
 *   (3) Kaynak-sentinel: packagingService.js'teki BEŞ çağrı noktasının (win/mac/
 *       linux `files` dizisi + android'in iki `fs.copy` filtresi) bu modülün
 *       desenini GERÇEKTEN taşıdığı — 2026-09-26'dan beri `paket-disi-liste.js`
 *       üzerinden. Fan-out sapması (her platform kendi listesini kurarsa sessizce
 *       ayrışır) burada yakalanır.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');

const mod = require('./kok-yedek-dizin-disla');
const { YEDEK_DIZIN_DESENI } = require('./set-kabuk');

// ─────────────────────────── (1) saf fonksiyonlar ───────────────────────────

test('kokYedekDizinAdiMi: set-kabuk.js YEDEK_DIZIN_DESENI ile BİREBİR aynı karar (kopya desen YOK)', () => {
  const ornekler = ['_eski', '_', '_a1', 'book1', 'assets2', 'config', '', 'x_eski', '_eski_2'];
  for (const ad of ornekler) {
    assert.strictEqual(mod.kokYedekDizinAdiMi(ad), YEDEK_DIZIN_DESENI.test(ad), `ayrıştı: "${ad}"`);
  }
});

test('elektronBuilderDesenleri: kök girdi + recursive içerik için iki desen döner', () => {
  assert.deepStrictEqual(mod.elektronBuilderDesenleri(), ['!_*', '!_*/**/*']);
});

test('fsCopyFiltresi: kök "_" dizini VE içeriği dışlanır, kök "_" dosyası ve bookN içi "_" dokunulmaz', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-kyd-'));
  await fs.ensureDir(path.join(kok, '_eski', 'sub'));
  await fs.writeFile(path.join(kok, '_eski', 'sub', 'dosya.txt'), 'x');
  await fs.writeFile(path.join(kok, '_kokdosyasi.js'), 'x'); // kök DOSYA, dizin DEĞİL
  await fs.ensureDir(path.join(kok, 'book1'));
  await fs.writeFile(path.join(kok, 'book1', '_ic.js'), 'x'); // kök DEĞİL, dokunulmaz
  await fs.writeFile(path.join(kok, 'normal.txt'), 'x');

  const filtre = mod.fsCopyFiltresi(kok);

  assert.strictEqual(filtre(kok), true, 'kökün kendisi dışlanmamalı');
  assert.strictEqual(filtre(path.join(kok, '_eski')), false, 'kök "_eski" DİZİNİ dışlanmalı');
  assert.strictEqual(filtre(path.join(kok, '_eski', 'sub')), false, '"_eski" altındaki alt dizin dışlanmalı');
  assert.strictEqual(filtre(path.join(kok, '_eski', 'sub', 'dosya.txt')), false, '"_eski" içindeki dosya dışlanmalı');
  assert.strictEqual(filtre(path.join(kok, '_kokdosyasi.js')), true, 'kök "_" DOSYASI dışlanmamalı (yalnız dizinler hedef)');
  assert.strictEqual(filtre(path.join(kok, 'book1', '_ic.js')), true, 'bookN İÇİNDEKİ "_" dosyasına dokunulmamalı');
  assert.strictEqual(filtre(path.join(kok, 'normal.txt')), true, 'normal dosya etkilenmemeli');
});

test('birlesikFiltre: TÜM filtreler true dönerse true, biri false dönerse false (VE mantığı)', () => {
  const heptrue = () => true;
  const hepfalse = () => false;
  assert.strictEqual(mod.birlesikFiltre(heptrue, heptrue)('x'), true);
  assert.strictEqual(mod.birlesikFiltre(heptrue, hepfalse)('x'), false);
  assert.strictEqual(mod.birlesikFiltre(hepfalse, heptrue)('x'), false);
  assert.strictEqual(mod.birlesikFiltre()('x'), true, 'filtre verilmezse geçirir (no-op)');
});

// ──────────────────── (2) GERÇEK electron-builder FileMatcher ────────────────────

test('DAVRANIŞ: gerçek FileMatcher ile "_eski/**" dışlanır, "book1/_x" ve kök içerik dokunulmaz', () => {
  const { FileMatcher } = require('app-builder-lib/out/fileMatcher');
  const desenler = ['**/*', '!node_modules', '!temp', '!uploads', '!build', ...mod.elektronBuilderDesenleri()];
  const ele = new FileMatcher('/kaynak', '/hedef', (x) => x, desenler).createFilter();
  const dosya = { isFile: () => true, isDirectory: () => false };
  const dizin = { isFile: () => false, isDirectory: () => true };

  assert.strictEqual(ele('/kaynak/_eski', dizin), false, '_eski kök dizini pakete giriyor');
  assert.strictEqual(ele('/kaynak/_eski/index.html', dosya), false, '_eski içeriği pakete giriyor');
  assert.strictEqual(ele('/kaynak/_eski/sub/deep.js', dosya), false, '_eski içindeki DERİN dosya pakete giriyor');

  // Kitap içi "_" önekli motor dosyalarına DOKUNULMAZ (yalnız kök).
  assert.strictEqual(ele('/kaynak/book1/_internal.js', dosya), true, 'bookN içi "_" dosyası yanlışlıkla dışlandı');
  assert.strictEqual(ele('/kaynak/book3/_data/x.bin', dosya), true, 'bookN içi "_" dizini yanlışlıkla dışlandı');

  // Gerçek içerik hâlâ içeride (pozitif kontrol — dışlama fazla geniş değil).
  assert.strictEqual(ele('/kaynak/package.json', dosya), true);
  assert.strictEqual(ele('/kaynak/index.html', dosya), true);
  assert.strictEqual(ele('/kaynak/book1/index.html', dosya), true);

  // Eski dışlamalar yerinde (gerileme freni).
  assert.strictEqual(ele('/kaynak/node_modules/a/b.js', dosya), false);
});

// ───────────────────────── (3) kaynak-sentinel (bağlantı) ─────────────────────────

function govde(ad) {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const i = src.indexOf(`async ${ad}(`);
  assert.ok(i > -1, `${ad} bulunamadı`);
  const j = src.indexOf('\n  async ', i + 10);
  return src.slice(i, j > -1 ? j : undefined);
}

// 2026-09-26 (Nadir — pakete girmeyecekler dört platformda TEK liste): packagingService
// bu modülü artık DOĞRUDAN çağırmıyor; `paket-disi-liste.js` onu kendi `kok-yedek`
// maddesi olarak taşıyor. Bağlantı zinciri: packagingService → paket-disi-liste →
// kok-yedek-dizin-disla. Zincirin iki halkası da burada çivilenir; packagingService
// tarafının sözleşmesi `paket-disi-liste.test.js`'te.

test('BAĞLANTI: win/mac/linux files dizileri paket-disi-liste üzerinden kök "_" desenlerini taşır', () => {
  const { canliFilesDesenleri } = require('./paket-disi-liste-sentinel');
  const [kokDesen, icerikDeseni] = mod.elektronBuilderDesenleri();
  for (const p of ['windows', 'macos', 'linux']) {
    const d = canliFilesDesenleri(p);
    assert.ok(d.includes(kokDesen) && d.includes(icerikDeseni), `${p} kök yedek dışlamasını taşımıyor`);
  }
  for (const fn of ['packageWindows', 'packageMacOS', 'packageLinux']) {
    assert.match(govde(fn), /\.\.\.paketDisiListe\.elektronBuilderDesenleri\(/, `${fn} tek listeyi çağırmıyor`);
  }
});

test('BAĞLANTI: packageAndroid + initializeCapacitorProject süzgeci kök "_" DİZİNİNİ dışlar, kök "_" DOSYASINI değil', async () => {
  for (const fn of ['packageAndroid', 'initializeCapacitorProject']) {
    assert.match(govde(fn), /createWwwCopyFilter\(workingPath\)/, `${fn} tek süzgeci kullanmıyor`);
  }
  const { createWwwCopyFilter } = require('./www-copy-exclude');
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-kyd-bag-'));
  await fs.outputFile(path.join(kok, '_eski', 'a.html'), 'x');
  await fs.outputFile(path.join(kok, '_kok.js'), 'x');
  const f = createWwwCopyFilter(kok);
  assert.strictEqual(f(path.join(kok, '_eski')), false);
  assert.strictEqual(f(path.join(kok, '_eski', 'a.html')), false);
  assert.strictEqual(f(path.join(kok, '_kok.js')), true, 'kök "_" DOSYASI dışlanmamalı (yalnız dizinler)');
});

test('FAN-OUT SAPMASI FRENİ: "_" deseni TEK yerden — paket-disi-liste bu modülü bir kez alır, packagingService hiç', () => {
  const pdl = fs.readFileSync(path.join(__dirname, 'paket-disi-liste.js'), 'utf8');
  assert.strictEqual((pdl.match(/require\(['"]\.\/kok-yedek-dizin-disla['"]\)/g) || []).length, 1);
  assert.ok(!/\/\^_\//.test(pdl), 'paket-disi-liste kendi "_" regex\'ini yazmış (kopya desen)');
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.strictEqual((src.match(/require\(['"]\.\/kok-yedek-dizin-disla['"]\)/g) || []).length, 0,
    'packagingService kök "_" modülünü doğrudan çağırıyor — iki bağlantı yolu ayrışabilir');
});
