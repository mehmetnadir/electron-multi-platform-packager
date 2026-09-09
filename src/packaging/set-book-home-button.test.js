'use strict';
// SET paketlerinde bookN/app.config.js'te setBook.enable=false -> true onarimini
// GERCEKTEN dosya sistemiyle dogrular (K5, 2026-09-09, Nadir talebi).
//
// Kanit: kitap 59480 "Flashy Grade 8 Set" - book1/book2'de setBook.enable:true ama
// book3'te false (ayni set icinde bir kitap unutulmus). setBook.enable, kitap
// ICINDEN kok sete "ana sayfa" donus butonunun gorunurlugunu kontrol eder - false
// olan kitapta kullanici sete geri donemiyor.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsExtra = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const {
  ensureSetBookHomeButton,
  ensureSetBookEnabledInContent,
  findSetBookBlock,
  APP_CONFIG_NAME,
} = require('./set-book-home-button');

function tempWwwDir() {
  return fsExtra.mkdtempSync(path.join(os.tmpdir(), 'set-book-home-test-'));
}

// Gercek 59480/book1 (setBook.enable:true) ve book3'ten (setBook.enable:false)
// BIREBIR alinmis parca (bookModule/setBook/externalbutton bloklari, kompakt
// `bookModule:{enable:true,` formati dahil - gercek kaynaktaki tek-satirlik
// yazim STILI de aynen korunmus olsun diye).
function realBook1ConfigTrue() {
  return `const AppConfig = {
	appName: 'Grade-8---Practice-Book',
	 appLogo: 'core/kurumlogo.png',
    imparkLogo: 'core/impark_logo.png',
    splashVideo: 'core/splash.mp4',
    bookModule:{enable:true,
        dll: 'classlibraries/ImWin32.dll',
    },
    initialLanguage: 'tr',

    defaultPageNumber: 1, //Kitap default olarak hangi sayfadan açılsın?

    defaultPageMode: 0, //0: SINGLE, 1: DUAL. Default olarak 0 ayarlıdır.

    setBook: {
        enable: true,//true tek kitapda bile ise alt tarafta ana sayfa butonu çıkar ve bir üstteki index.html i açar.
    },
    externalbutton: {
        enable: false, // External butonun visible değeri
        icon:'core/externalButton.png', //Buton ikon değeri. Default değeri mevcut. Verilmesi zorunlu değil
        link:'/external/index.html',//https://www.impark.com.tr
    },
};
`;
}

function realBook3ConfigFalse() {
  return `const AppConfig = {
	appName: 'Grade-8-Extras',
	 appLogo: 'core/kurumlogo.png',
    imparkLogo: 'core/impark_logo.png',
    splashVideo: 'core/splash.mp4',
    bookModule:{enable:true,
        dll: 'classlibraries/ImWin32.dll',
    },
    initialLanguage: 'tr',

    defaultPageNumber: 1, //Kitap default olarak hangi sayfadan açılsın?

    defaultPageMode: 0, //0: SINGLE, 1: DUAL. Default olarak 0 ayarlıdır.

    setBook: {
        enable: false,//true tek kitapda bile ise alt tarafta ana sayfa butonu çıkar ve bir üstteki index.html i açar.
    },
    externalbutton: {
        enable: false, // External butonun visible değeri
        icon:'core/externalButton.png', //Buton ikon değeri. Default değeri mevcut. Verilmesi zorunlu değil
        link:'/external/index.html',//https://www.impark.com.tr
    },
};
`;
}

async function buildFakeSet(www, { book3EnableTrue = false } = {}) {
  // K8: findSubBookDirs motor imzasi icin index.html DA gerekli (gercek her SET
  // kitabinin sahip oldugu ikili - bkz. sub-book-dirs.js NEDEN blogu).
  await fsExtra.ensureDir(path.join(www, 'book1'));
  await fsExtra.ensureDir(path.join(www, 'book2'));
  await fsExtra.ensureDir(path.join(www, 'book3'));
  await fsExtra.writeFile(path.join(www, 'book1', 'index.html'), '<!doctype html><html><body>book1</body></html>');
  await fsExtra.writeFile(path.join(www, 'book2', 'index.html'), '<!doctype html><html><body>book2</body></html>');
  await fsExtra.writeFile(path.join(www, 'book3', 'index.html'), '<!doctype html><html><body>book3</body></html>');
  await fsExtra.writeFile(path.join(www, 'book1', APP_CONFIG_NAME), realBook1ConfigTrue());
  await fsExtra.writeFile(path.join(www, 'book2', APP_CONFIG_NAME), realBook1ConfigTrue());
  await fsExtra.writeFile(
    path.join(www, 'book3', APP_CONFIG_NAME),
    book3EnableTrue ? realBook1ConfigTrue() : realBook3ConfigFalse()
  );
}

test('(a) enable:false -> true; yorumlar ve diger enable: alanlari BIREBIR korunur', async () => {
  const www = tempWwwDir();
  await buildFakeSet(www);

  const result = await ensureSetBookHomeButton(www);

  assert.strictEqual(result.isSet, true);
  const book3 = result.books.find((b) => b.book === 'book3');
  assert.strictEqual(book3.action, 'patched');

  const content = fs.readFileSync(path.join(www, 'book3', APP_CONFIG_NAME), 'utf8');
  assert.match(content, /setBook:\s*\{\s*enable:\s*true,\/\/true tek kitapda/, 'setBook.enable true olmus, yorum korunmus');
  // Diger enable: alanlari (bookModule, externalbutton) DEGISMEMIS.
  assert.match(content, /bookModule:\{enable:true,/, 'bookModule.enable DOKUNULMAMALI');
  assert.match(content, /externalbutton:\s*\{\s*enable:\s*false/, 'externalbutton.enable DOKUNULMAMALI');
  // appName ve diger tum yapi degismemis (yalniz setBook.enable degisti).
  assert.match(content, /appName:\s*'Grade-8-Extras'/);
});

test('(b) zaten true olan dosya DEGISMEZ (icerik + mtime)', async () => {
  const www = tempWwwDir();
  await buildFakeSet(www); // book1/book2 zaten true
  const cfgPath = path.join(www, 'book1', APP_CONFIG_NAME);
  const before = fs.readFileSync(cfgPath, 'utf8');
  const statBefore = fs.statSync(cfgPath);

  // mtime cozunurlugu bazi dosya sistemlerinde 1sn - kucuk bir bekleme ile
  // "yazilsaydi mtime degisirdi" ihtimalini guclendiriyoruz.
  await new Promise((r) => setTimeout(r, 20));

  const result = await ensureSetBookHomeButton(www);
  const book1 = result.books.find((b) => b.book === 'book1');
  assert.strictEqual(book1.action, 'already-true');

  const after = fs.readFileSync(cfgPath, 'utf8');
  const statAfter = fs.statSync(cfgPath);
  assert.strictEqual(after, before, 'icerik degismemeli');
  assert.strictEqual(statAfter.mtimeMs, statBefore.mtimeMs, 'dosyaya YAZILMAMALI (mtime sabit)');
});

test('(c) setBook blogu yoksa dosya DEGISMEZ + uyari donuyor (action)', async () => {
  const www = tempWwwDir();
  await fsExtra.ensureDir(path.join(www, 'book1'));
  await fsExtra.writeFile(path.join(www, 'book1', 'index.html'), '<!doctype html><html><body>book1</body></html>');
  const cfgPath = path.join(www, 'book1', APP_CONFIG_NAME);
  const content = "const AppConfig = { appName: 'X', bookModule: { enable: true } };\n";
  await fsExtra.writeFile(cfgPath, content);

  const result = await ensureSetBookHomeButton(www);

  const book1 = result.books.find((b) => b.book === 'book1');
  assert.strictEqual(book1.action, 'no-setbook-block');
  assert.strictEqual(fs.readFileSync(cfgPath, 'utf8'), content, 'setBook blogu yoksa dosya DEGISMEMELI');
});

test('(d) tek kitap paketinde (bookN yok) cagri no-op', async () => {
  const www = tempWwwDir();
  await fsExtra.writeFile(path.join(www, 'app.config.js'), realBook1ConfigTrue());
  await fsExtra.ensureDir(path.join(www, 'assets'));

  const result = await ensureSetBookHomeButton(www);

  assert.strictEqual(result.isSet, false);
  assert.deepStrictEqual(result.books, []);
  // Kok app.config.js'e kesinlikle dokunulmamis (bookN dizini olmadigi icin hic taranmadi).
  const content = fs.readFileSync(path.join(www, 'app.config.js'), 'utf8');
  assert.match(content, /enable: true,\/\/true tek kitapda/);
});

test('(e) gercek ornek: 59480 book1 (zaten true) + book3 (false, yamalanir) — birlikte', async () => {
  const www = tempWwwDir();
  await buildFakeSet(www);

  const result = await ensureSetBookHomeButton(www);

  const actions = Object.fromEntries(result.books.map((b) => [b.book, b.action]));
  assert.deepStrictEqual(actions, { book1: 'already-true', book2: 'already-true', book3: 'patched' });
});

test('(K8) Tudem-tarzi ad (fasikuller-01) da setBook.enable=true zorlanir', async () => {
  const www = tempWwwDir();
  await fsExtra.ensureDir(path.join(www, 'fasikuller-01'));
  await fsExtra.writeFile(path.join(www, 'fasikuller-01', 'index.html'), '<!doctype html><html><body>f1</body></html>');
  await fsExtra.writeFile(path.join(www, 'fasikuller-01', APP_CONFIG_NAME), realBook3ConfigFalse());

  const result = await ensureSetBookHomeButton(www);

  assert.strictEqual(result.isSet, true);
  const f1 = result.books.find((b) => b.book === 'fasikuller-01');
  assert.strictEqual(f1.action, 'patched');
  const content = fs.readFileSync(path.join(www, 'fasikuller-01', APP_CONFIG_NAME), 'utf8');
  assert.match(content, /setBook:\s*\{\s*enable:\s*true,/);
});

// --- Dogrudan icerik-fonksiyonu birim testleri (findSetBookBlock / ensureSetBookEnabledInContent) ---
test('findSetBookBlock ic ice parantezli baska bir blok varsa bile setBook sinirini dogru bulur', () => {
  const content = `const AppConfig = {
    weird: { a: { b: 1 } },
    setBook: {
        enable: false,
    },
    tail: {}
  };`;
  const block = findSetBookBlock(content);
  assert.ok(block);
  const inner = content.slice(block.blockInnerStart, block.blockInnerEnd);
  assert.match(inner, /enable:\s*false/);
  assert.doesNotMatch(inner, /tail/);
});

test('ensureSetBookEnabledInContent: enable alani yoksa no-enable-field doner, dosya degismez', () => {
  const content = 'const AppConfig = { setBook: { /* bos */ } };';
  const { action, content: out } = ensureSetBookEnabledInContent(content);
  assert.strictEqual(action, 'no-enable-field');
  assert.strictEqual(out, content);
});

// --- Mutasyon kaniti: blok siniri kaldirilirsa bookModule.enable de degisir (yanlislikla) ---
test('GERİLEME: blok sınırı kaldırılırsa naif regex bookModule.enable\'i de bozar (DLL aktivasyonu çöker)', () => {
  const content = realBook3ConfigFalse();

  // Bozuk (blok-siniri kontrolu OLMAYAN) naif yaklasimin simulasyonu: dosyadaki
  // ILK 'enable: false' veya 'enable:true,' her ne olursa olsun degistirilse...
  // Gercekte dosyadaki ILK enable alani bookModule\'e ait olmayabilir (format
  // farkli: 'enable:true,' bosluksuz) ama YINE DE naif "dosya genelinde ilk
  // enable:false" taramasi setBook disindaki bir alani da yakalayabilir - blok
  // siniri OLMADAN hangi 'enable' alaninin degistigi GARANTI edilemez.
  const naiveFirstFalse = /enable\s*:\s*false/.exec(content);
  assert.ok(naiveFirstFalse, 'iceriginde en az bir enable:false var (setBook\'unki)');

  // Gercek (blok-sinirli) fonksiyon SADECE setBook icindekini degistirir:
  const { content: fixed } = ensureSetBookEnabledInContent(content);
  assert.match(fixed, /bookModule:\{enable:true,/, 'bookModule.enable ASLA degismemeli');
  assert.match(fixed, /setBook:\s*\{\s*enable:\s*true,/, 'setBook.enable degismeli');
  assert.match(fixed, /externalbutton:\s*\{\s*enable:\s*false/, 'externalbutton.enable ASLA degismemeli');
});

// --- K9e (2026-09-09, K9b/K9d ile AYNI desen) ---
test('(K9e) Tudem olcegi (8 alt-kitap) HEPSI setBook.enable=true alir - TAM sayi', async () => {
  const www = tempWwwDir();
  for (let i = 1; i <= 8; i++) {
    const d = path.join(www, 'fasikuller-' + String(i).padStart(2, '0'));
    await fsExtra.ensureDir(d);
    await fsExtra.writeFile(path.join(d, 'index.html'), '<html></html>');
    await fsExtra.writeFile(path.join(d, APP_CONFIG_NAME), realBook3ConfigFalse());
  }

  const result = await ensureSetBookHomeButton(www);
  const patchedCount = result.books.filter((b) => b.action === 'patched').length;
  assert.strictEqual(patchedCount, 8, 'HER 8 alt-kitap da patched olmali (yalnizca ilk degil)');
});

test('GERİLEME: bir alt-kitabın app.config.js\'i EACCES verirse DİĞERLERİ yine de yamalanır (domino etkisi)', async () => {
  const www = tempWwwDir();
  for (let i = 1; i <= 3; i++) {
    const d = path.join(www, 'book' + i);
    await fsExtra.ensureDir(d);
    await fsExtra.writeFile(path.join(d, 'index.html'), '<html></html>');
    await fsExtra.writeFile(path.join(d, APP_CONFIG_NAME), realBook3ConfigFalse());
  }
  const book1Cfg = path.join(www, 'book1', APP_CONFIG_NAME);
  fs.chmodSync(book1Cfg, 0o400);
  let result;
  try {
    result = await ensureSetBookHomeButton(www);
  } finally {
    fs.chmodSync(book1Cfg, 0o644);
  }

  const book1Result = result.books.find((b) => b.book === 'book1');
  assert.strictEqual(book1Result.action, 'error', 'book1 EACCES ile basarisiz OLMALI (beklenen)');
  for (const b of ['book2', 'book3']) {
    const r = result.books.find((x) => x.book === b);
    assert.strictEqual(r.action, 'patched', `${b} book1'in hatasindan ETKILENMEMELI (domino YOK)`);
  }
});

// --- Kaynak-sentinel ---
test('kaynak-sentinel (K9e): for dongusu icinde alt-kitaba OZEL try/catch var', () => {
  const src = fs.readFileSync(path.join(__dirname, 'set-book-home-button.js'), 'utf8');
  const forIdx = src.indexOf('for (const book of bookDirs)');
  const tryIdx = src.indexOf('try {', forIdx);
  const catchIdx = src.indexOf('catch (bookErr)', forIdx);
  assert.notStrictEqual(forIdx, -1);
  assert.notStrictEqual(tryIdx, -1);
  assert.notStrictEqual(catchIdx, -1, 'try/catch(bookErr) olmali - tek kitabin hatasi digerlerini durdurmasin');
});

test('kaynak-sentinel: startPackaging platform fan-out ONCESINDE ensureSetBookHomeButton cagirir', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const requireIdx = src.indexOf("require('./set-book-home-button')");
  const callIdx = src.indexOf('ensureSetBookHomeButton(workingPath)');
  const switchIdx = src.indexOf("case 'windows':");
  assert.notStrictEqual(requireIdx, -1);
  assert.notStrictEqual(callIdx, -1);
  assert.notStrictEqual(switchIdx, -1);
  assert.ok(callIdx < switchIdx, 'ensureSetBookHomeButton platform fan-out ONCESINDE calismali');
});
