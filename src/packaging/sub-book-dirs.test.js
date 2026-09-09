'use strict';
// K8 (2026-09-09, kanıtlı) — `findSubBookDirs` AD DESENİNDEN bağımsız motor-imzası
// (index.html + app.config.js) taramasını GERÇEKTEN dosya sistemiyle doğrular.
//
// Kanıt: Tudem ISO'ları (`~/Downloads/tudem/*.iso`) SET yapısını `book1/` değil
// `fasikuller-01/`, `okula-basladim/`, `d1-portfolyo/` gibi adlı klasörlerle kurar.
// `^book\d*$` regex'i bunları hiç yakalamaz. Bu dosya iddiaları HEM sentetik sahte
// köklerle HEM gerçek bir Tudem ISO'sundan çıkarılan gerçek dizin ağacıyla kanıtlar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { findSubBookDirs, hasEngineSignature, SKIP_DIR_NAMES } = require('./sub-book-dirs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sub-book-dirs-test-'));
}

async function makeEngineDir(root, relPath) {
  const abs = path.join(root, relPath);
  await fs.ensureDir(abs);
  await fs.writeFile(path.join(abs, 'index.html'), '<html></html>');
  await fs.writeFile(path.join(abs, 'app.config.js'), 'const AppConfig = {};');
}

test('(a) klasik book1/book2 hala bulunur (ad deseni degil imza)', async () => {
  const root = tempDir();
  await makeEngineDir(root, 'book1');
  await makeEngineDir(root, 'book2');
  const found = await findSubBookDirs(root);
  assert.deepStrictEqual(found, ['book1', 'book2']);
});

test('(b) Tudem-tarzi adlar (fasikuller-01, d1-portfolyo) bulunur', async () => {
  const root = tempDir();
  await makeEngineDir(root, 'fasikuller-01');
  await makeEngineDir(root, 'd1-portfolyo');
  await makeEngineDir(root, 'e1-matematik');
  await makeEngineDir(root, 'okula-basladim');
  const found = await findSubBookDirs(root);
  assert.deepStrictEqual(found, ['d1-portfolyo', 'e1-matematik', 'fasikuller-01', 'okula-basladim']);
});

test('(c) derinlik-2 alt-kitap bulunur (sets/a/index.html + app.config.js)', async () => {
  const root = tempDir();
  await fs.ensureDir(path.join(root, 'sets')); // sets/ kendisi imza tasimiyor
  await makeEngineDir(root, 'sets/a');
  const found = await findSubBookDirs(root, { maxDepth: 2 });
  assert.deepStrictEqual(found, ['sets/a']);
});

test('(d) yanlis pozitif OLMAZ: core/ (index.html yok) ve assets2/ (skip-list) yakalanmaz', async () => {
  const root = tempDir();
  await fs.ensureDir(path.join(root, 'core'));
  await fs.writeFile(path.join(root, 'core', 'app.config.js'), 'x'); // index.html YOK
  await fs.ensureDir(path.join(root, 'assets2'));
  await fs.writeFile(path.join(root, 'assets2', 'index.html'), 'x');
  await fs.writeFile(path.join(root, 'assets2', 'app.config.js'), 'x'); // ikisi de var AMA skip-list
  await makeEngineDir(root, 'book1');
  const found = await findSubBookDirs(root);
  assert.deepStrictEqual(found, ['book1']);
});

test('(e) alt-kitabin ICINE inilmez (kendi core/assets tekrar taranmaz)', async () => {
  const root = tempDir();
  await makeEngineDir(root, 'book1');
  // book1 ICINDE yanlislikla "alt-kitap gibi gorunen" bir klasor olsa bile (kitabin
  // kendi ic yapisi) - bu ARANMAMALI, cunku book1 zaten bir alt-kitap ve icine inilmez.
  await makeEngineDir(root, 'book1/nested-would-match');
  const found = await findSubBookDirs(root);
  assert.deepStrictEqual(found, ['book1'], 'book1 bulunduktan sonra ICINE inilmemeli');
});

test('(f) tek kitap kokunde (alt kitap yok) sonuc BOS', async () => {
  const root = tempDir();
  await fs.writeFile(path.join(root, 'index.html'), '<html></html>');
  await fs.writeFile(path.join(root, 'app.config.js'), 'const AppConfig = {};');
  await fs.ensureDir(path.join(root, 'assets'));
  const found = await findSubBookDirs(root);
  assert.deepStrictEqual(found, [], 'kok kendisi asla listeye girmez (kok haric kurali)');
});

test('hasEngineSignature: index.html VEYA app.config.js tek basina yetmez, ikisi de gerekir', async () => {
  const root = tempDir();
  await fs.ensureDir(path.join(root, 'yalniz-index'));
  await fs.writeFile(path.join(root, 'yalniz-index', 'index.html'), 'x');
  assert.strictEqual(await hasEngineSignature(path.join(root, 'yalniz-index')), false);

  await fs.ensureDir(path.join(root, 'yalniz-config'));
  await fs.writeFile(path.join(root, 'yalniz-config', 'app.config.js'), 'x');
  assert.strictEqual(await hasEngineSignature(path.join(root, 'yalniz-config')), false);

  await makeEngineDir(root, 'ikisi-de');
  assert.strictEqual(await hasEngineSignature(path.join(root, 'ikisi-de')), true);
});

// --- Gercek veri: Tudem ISO'sundan cikarilan gercek dizin agaci ---
// NOT: ISO'nun TAMAMI (1.7 GB) cikarilmadi - bsdtar ile SADECE index.html/app.config.js
// dosyalari (84 KB) scratchpad altina cikarildi (~/Downloads/tudem'e HICBIR YAZMA yok,
// yalniz OKUNDU). `hece/` ve `metin-yazma/` gercekte SADECE index.html tasiyor
// (app.config.js YOK) - motor imzasi eksik, bu yuzden BULUNMAMALARI beklenir.
const TUDEM_FIXTURE = '/private/tmp/claude-501/-Users-nadir/006cff11-8d65-4460-944b-a19c21ec727c/scratchpad/tudem-fixture/resources/app/build';

test('(gercek veri) Tudem "Bloktest_Okuma_Yazma_2023.iso" build/ agacinda 27 alt-kitap bulunur', { skip: !fs.existsSync(TUDEM_FIXTURE) }, async () => {
  const found = await findSubBookDirs(TUDEM_FIXTURE);
  const expected = [
    'fasikuller-01', 'fasikuller-02', 'fasikuller-03', 'fasikuller-04', 'fasikuller-05',
    'fasikuller-06', 'fasikuller-07', 'fasikuller-08', 'fasikuller-09', 'fasikuller-10',
    'fasikuller-11', 'fasikuller-12', 'fasikuller-13', 'fasikuller-14',
    'hizli-okuma', 'matematik-defterim', 'okula-basladim',
    'okuma1', 'okuma2', 'okuma3', 'okuma4', 'okuma5',
    'oyunlar', 'sarkilar', 'sesbankasi', 'tekrar', 'yazi-cumle',
  ].sort();
  assert.deepStrictEqual(found, expected);
  // "hece" ve "metin-yazma" GERCEKTE sadece index.html tasiyor (app.config.js yok) -
  // motor imzasi eksik oldugu icin bulunmamalari GEREKIR (yanlis-pozitif kontrolu).
  assert.ok(!found.includes('hece'));
  assert.ok(!found.includes('metin-yazma'));
  // kok (build/index.html - Tudem'in kendi launcher'i) ASLA listede olmaz.
  assert.ok(!found.includes(''));
});

// --- Mutasyon kaniti ---
test('GERİLEME: ad deseni regex\'ine dönülürse fasikül dizinleri hiç bulunamaz', async () => {
  const root = tempDir();
  await makeEngineDir(root, 'fasikuller-01');
  await makeEngineDir(root, 'okula-basladim');

  // Eski (K8-oncesi) davranisin dogrudan simulasyonu: ^book\d*$ regex'i.
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const oldStyleFound = entries.filter((e) => e.isDirectory() && /^book\d*$/i.test(e.name)).map((e) => e.name);
  assert.deepStrictEqual(oldStyleFound, [], 'eski regex Tudem adlarini HICBIRINI yakalayamaz (kanitin gucu)');

  // Gercek (duzeltilmis) davranis bunlari bulur:
  const found = await findSubBookDirs(root);
  assert.deepStrictEqual(found, ['fasikuller-01', 'okula-basladim']);
});

test('kaynak-sentinel: SKIP_DIR_NAMES kitap-ici destek dizinlerini kapsar', () => {
  for (const name of ['node_modules', 'assets', 'assets2', 'core', 'classlibraries', 'temp', 'i18n', 'icons', '_graveyard']) {
    assert.ok(SKIP_DIR_NAMES.has(name), `${name} SKIP_DIR_NAMES icinde olmali`);
  }
});
