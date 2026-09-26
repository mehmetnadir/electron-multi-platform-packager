'use strict';

/**
 * `paket-disi-liste.js` — PAKETE GİRMEYECEKLER, dört platform tek liste (Nadir, 2026-09-26).
 *
 * Üç katman:
 *   (1) SÖZLEŞME — dört tüketici (windows/macos/linux `files` + Android `www` süzgeci)
 *       listeyi AYNI modülden alıyor; kaynakta kopya dışlama literal'i yok; Windows
 *       dizisi taşımadan önceki haliyle BİREBİR aynı.
 *   (2) DAVRANIŞ — canlı `files` dizileri electron-builder'ın KENDİ `FileMatcher`'ında
 *       (model değil, üretim sınıfı) ve Android süzgeci gerçek `fs.copy` ile.
 *   (3) EŞLİK — aynı yol kümesinde Android süzgeci ile electron-builder AYNI kararı
 *       veriyor (belgelenmiş iki biçim farkı hariç, bkz. modül başlığı).
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');

const liste = require('./paket-disi-liste');
const kokYedek = require('./kok-yedek-dizin-disla');
const sentinel = require('./paket-disi-liste-sentinel');
const { createWwwCopyFilter } = require('./www-copy-exclude');

const ELEKTRON = ['windows', 'macos', 'linux'];

function ele(desenler) {
  const { FileMatcher } = require('app-builder-lib/out/fileMatcher');
  return new FileMatcher('/k', '/h', (x) => x, desenler).createFilter();
}
const DOSYA = { isFile: () => true, isDirectory: () => false };
const DIZIN = { isFile: () => false, isDirectory: () => true };

// ─────────────────────────────── (1) SÖZLEŞME ───────────────────────────────

test('SÖZLEŞME: Windows dizisi taşımadan önceki (26.09) literal liste ile BİREBİR aynı', () => {
  assert.deepStrictEqual(sentinel.canliFilesDesenleri('windows'), [
    '**/*', '!node_modules', '!temp', '!uploads', '!build', '!**/temp/data/storage.im',
    '!_*', '!_*/**/*',
  ]);
});

test('SÖZLEŞME: win/mac/linux files dizileri listeyi AYNI modülden yayar, kopya YOK', () => {
  const govdeler = sentinel.platformBloklari();
  const tumDesenler = new Set(ELEKTRON.flatMap((p) => liste.elektronBuilderDesenleri(p)));
  for (const p of ELEKTRON) {
    const blok = sentinel.filesBlokMetni(govdeler[p]);
    assert.ok(blok, `${p} files dizisi bulunamadı`);
    const kod = sentinel.yorumsuz(blok);
    assert.ok(kod.includes(`...paketDisiListe.elektronBuilderDesenleri('${p}')`),
      `${p} files dizisi paket-disi-liste'yi çağırmıyor`);
    for (const lit of kod.matchAll(/"([^"]+)"/g)) {
      assert.ok(!tumDesenler.has(lit[1]),
        `${p} files dizisinde kopya dışlama literal'i: "${lit[1]}" (fan-out sapması)`);
    }
    // Çözülmüş dizi modülün çıktısını ARDIŞIK ve eksiksiz taşır.
    const cozulmus = sentinel.canliFilesDesenleri(p);
    const beklenen = liste.elektronBuilderDesenleri(p);
    const i = cozulmus.indexOf(beklenen[0]);
    assert.deepStrictEqual(cozulmus.slice(i, i + beklenen.length), beklenen, `${p} listesi eksik`);
  }
});

test('SÖZLEŞME: üç electron-builder platformu BUGÜN aynı desenleri alır (muafiyet yok)', () => {
  const w = liste.elektronBuilderDesenleri('windows');
  assert.deepStrictEqual(liste.elektronBuilderDesenleri('macos'), w);
  assert.deepStrictEqual(liste.elektronBuilderDesenleri('linux'), w);
});

test('SÖZLEŞME: Android iki fs.copy noktası da tek süzgeci (createWwwCopyFilter) kullanır', () => {
  const src = fs.readFileSync(sentinel.CANLI, 'utf8');
  const noktalar = [
    'await fs.copy(workingPath, webAppPath,',
    'await fs.copy(workingPath, wwwPath,',
  ];
  for (const im of noktalar) {
    const i = src.indexOf(im);
    assert.notStrictEqual(i, -1, `${im} bulunamadı`);
    const blok = src.slice(i, src.indexOf('});', i) + 3);
    assert.match(blok, /filter:\s*createWwwCopyFilter\(workingPath\)/,
      `${im} süzgeci tek kaynaktan değil`);
  }
  const wce = fs.readFileSync(path.join(__dirname, 'www-copy-exclude.js'), 'utf8');
  assert.match(wce, /require\(['"]\.\/paket-disi-liste['"]\)/,
    'www-copy-exclude listeyi modülden almıyor');
  assert.match(wce, /paketDisiListe\.fsKopyaFiltresi\(srcRoot,\s*'android'\)/);
  assert.ok(!/new Set\(\[/.test(wce),
    'www-copy-exclude kendi segment listesini yeniden tanımlamış');
});

test('SÖZLEŞME: packagingService listeyi TEK yerden alır; kok-yedek doğrudan çağrılmaz', () => {
  const src = fs.readFileSync(sentinel.CANLI, 'utf8');
  assert.strictEqual((src.match(/require\(['"]\.\/paket-disi-liste['"]\)/g) || []).length, 1);
  assert.strictEqual((src.match(/require\(['"]\.\/kok-yedek-dizin-disla['"]\)/g) || []).length, 0,
    'kok-yedek-dizin-disla packagingService\'e doğrudan girmiş — iki kaynak ayrışabilir');
  assert.strictEqual((src.match(/paketDisiListe\.elektronBuilderDesenleri\(/g) || []).length, 3);
});

test('SÖZLEŞME: her madde dört platformda ya da gerekçeli muafiyetle', () => {
  for (const m of liste.MADDELER) {
    const eksik = liste.PLATFORMLAR.filter((p) => !m.platformlar.includes(p));
    if (eksik.length) {
      assert.ok(typeof m.muafiyet === 'string' && m.muafiyet.length > 20,
        `${m.ad}: ${eksik.join(',')} muaf ama ölçülmüş gerekçe (muafiyet) yok`);
    }
    assert.ok(typeof m.gerekce === 'string' && m.gerekce.length > 20, `${m.ad} gerekçesiz`);
  }
});

test('SÖZLEŞME: `_` kök maddesi kok-yedek-dizin-disla\'dan gelir (kopya desen yok)', () => {
  const m = liste.MADDELER.find((x) => x.ad === 'kok-yedek');
  assert.deepStrictEqual([...m.desenler], kokYedek.elektronBuilderDesenleri());
});

test('bilinmeyen platform ve Android için electron-builder deseni istemek FIRLATIR', () => {
  assert.throws(() => liste.maddeler('ios'), /bilinmeyen platform/);
  assert.throws(() => liste.elektronBuilderDesenleri('android'), /yalnız windows/);
});

// ───────────────────────────── (2) DAVRANIŞ ─────────────────────────────

test('DAVRANIŞ: canlı win/mac/linux files dizileri gerçek FileMatcher\'da aynı şeyi dışlar', () => {
  for (const p of ELEKTRON) {
    const e = ele(sentinel.canliFilesDesenleri(p));
    for (const [yol, tur] of [
      ['/k/build', DIZIN], ['/k/build/installer.nsh', DOSYA], ['/k/build/icon.ico', DOSYA],
      ['/k/book1/temp/data/storage.im', DOSYA], ['/k/book5/temp/data/storage.im', DOSYA],
      ['/k/temp/data/storage.im', DOSYA], ['/k/temp/j1/windows/x.exe', DOSYA],
      ['/k/uploads/s1/a.png', DOSYA], ['/k/_eski/index.html', DOSYA], ['/k/_eski', DIZIN],
      ['/k/node_modules/electron/index.js', DOSYA],
    ]) assert.strictEqual(e(yol, tur), false, `${p}: ${yol} pakete giriyor`);
    for (const yol of [
      '/k/index.html', '/k/book1/index.html', '/k/assets/56385/pages/1.png',
      '/k/book1/build/x.js', '/k/core/uploads/a.png', '/k/book1/temp/data/diger.json',
      '/k/empp-vendor/adm-zip/adm-zip.js',
    ]) assert.strictEqual(e(yol, DOSYA), true, `${p}: ${yol} yanlışlıkla dışlandı`);
  }
});

test('DAVRANIŞ: mac/linux adm-zip geri-alması taşındıktan sonra da çalışır; Win\'de yok', () => {
  for (const p of ['macos', 'linux']) {
    const d = sentinel.canliFilesDesenleri(p);
    assert.ok(d.indexOf('node_modules/adm-zip') > d.indexOf('!node_modules'), `${p} sıra bozuk`);
    const e = ele(d);
    assert.strictEqual(e('/k/node_modules/adm-zip/adm-zip.js', DOSYA), true,
      `${p}: adm-zip elendi`);
    assert.strictEqual(e('/k/node_modules/electron/x.js', DOSYA), false);
  }
  assert.ok(!sentinel.canliFilesDesenleri('windows').includes('node_modules/adm-zip'));
});

// ───────────────────────────── (3) EŞLİK ─────────────────────────────

test('EŞLİK: aynı yol kümesinde Android süzgeci ile electron-builder AYNI kararı verir',
  async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-pdl-eslik-'));
  const dosyalar = [
    'index.html', 'app.config.js', 'core/a.js', 'assets/1/p.png', 'book1/index.html',
    'book1/temp/data/storage.im', 'book1/temp/data/diger.json', 'book1/build/x.js',
    'temp/data/storage.im', 'temp/j/windows/a.exe', 'uploads/s/a.png', 'build/installer.nsh',
    '_eski/index.html', 'node_modules/electron/p.json', 'core/uploads/u.png',
  ];
  for (const f of dosyalar) await fs.outputFile(path.join(kok, f), 'x');
  const android = createWwwCopyFilter(kok);
  const eb = ele(sentinel.canliFilesDesenleri('windows'));
  for (const f of dosyalar) {
    const a = android(path.join(kok, f));
    const e = eb(`/k/${f}`, DOSYA);
    assert.strictEqual(a, e, `${f}: android=${a} electron-builder=${e} — listeler ayrıştı`);
  }
});
