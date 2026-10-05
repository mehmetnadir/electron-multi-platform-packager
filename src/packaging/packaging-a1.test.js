'use strict';
/**
 * A1 düzeni paketleme adımları (2026-10-05): shim'ler kapak/index.html'e <base> sonrası girer,
 * kök app.config.js'te setBook.enable açılır, kök index denetimi A1'i geçerli sayar / bozuğu düşürür,
 * K17 set menüsü A1 köküne dokunmaz. İki paketleme yolu kuralı: shim enjeksiyonu masaüstü
 * (prepareElectronFiles) VE Android (www) yolunda — kaynak sentinel'i ikisini de zorlar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A1 = require('./a1-duzen');
const { ensureSetBookHomeButton } = require('./set-book-home-button');
const agPolitikasi = require('./ag-politikasi-yamasi');
const kokIndex = require('./kok-index-denetimi');
const { ensureSetMenu } = require('./set-menu');

const MOTOR = '<!doctype html><html><head><meta charset="UTF-8"/><script src="app.config.js"></script>'
  + '<script defer="defer" src="./bd0c1a4f650802c98ebf.main.js"></script></head><body></body></html>';
const KABUK = '<html><head><title>Set</title></head><body><script src="scripts/language-set.js"></script></body></html>';
const CONFIG = 'const AppConfig = {\n  bookModule: { enable: true },\n  setBook: {\n    enable: false, // ana sayfa\n  },\n};\n';

function a1Agac({ kapak = A1.baslikEkle(MOTOR), kok = KABUK } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-a1-'));
  for (const alt of ['kapak', 'classlibraries', 'assets/25861/data']) fs.mkdirSync(path.join(d, alt), { recursive: true });
  fs.writeFileSync(path.join(d, 'index.html'), kok);
  fs.writeFileSync(path.join(d, 'kapak/index.html'), kapak);
  fs.writeFileSync(path.join(d, 'classlibraries/ImWin32.dll'), 'menü');
  fs.writeFileSync(path.join(d, 'app.config.js'), CONFIG);
  fs.writeFileSync(path.join(d, 'assets/25861/data/BookContent.xml'), '<Book/>');
  return d;
}
const oku = (d, ad) => fs.readFileSync(path.join(d, ad), 'utf8');
const sessiz = { log() {}, warn() {} };

test('setBook: A1 kökünde KÖK app.config.js setBook.enable=true olur (diğer enable alanları aynen)', async () => {
  const d = a1Agac();
  const r = await ensureSetBookHomeButton(d);
  assert.equal(r.isSet, true);
  assert.equal(r.a1, true);
  assert.deepEqual(r.books.map((b) => [b.book, b.action]), [['.', 'patched']]);
  assert.match(oku(d, 'app.config.js'), /setBook: \{\n {4}enable: true, \/\/ ana sayfa/);
  assert.match(oku(d, 'app.config.js'), /bookModule: \{ enable: true \}/);
  assert.equal((await ensureSetBookHomeButton(d)).books[0].action, 'already-true', 'idempotent');
});

test('setBook: A1 olmayan tek kitap kökü ETKİLENMEZ (isSet false)', async () => {
  const d = a1Agac();
  fs.writeFileSync(path.join(d, 'kapak/index.html'), MOTOR); // işaretsiz → A1 değil
  assert.deepEqual(await ensureSetBookHomeButton(d), { isSet: false, books: [] });
  assert.match(oku(d, 'app.config.js'), /enable: false/);
});

test('kapakaShimEkle: fs-shim kök betiğinin ardına; idempotent; A1 değilse dokunmaz', async () => {
  const d = a1Agac();
  assert.equal((await A1.kapakaShimEkle(d, 'empp-fs-shim.js', sessiz)).durum, 'enjekte');
  const html = oku(d, 'kapak/index.html');
  assert.ok(html.includes(`${A1.A1_KOK_BETIGI}<script src="empp-fs-shim.js"></script>`));
  assert.deepEqual(A1.kapakDenetle(html), []);
  assert.equal((await A1.kapakaShimEkle(d, 'empp-fs-shim.js', sessiz)).durum, 'zaten-var');
  assert.deepEqual(fs.readdirSync(path.join(d, 'kapak')), ['index.html'], 'geçici dosya kalmaz');
  const d2 = a1Agac();
  fs.rmSync(path.join(d2, 'classlibraries'), { recursive: true });
  assert.equal((await A1.kapakaShimEkle(d2, 'empp-fs-shim.js', sessiz)).durum, 'a1-degil');
});

test('ağ politikası + fs-shim + android shim: üçü de <base> sonrası, kök de alır; kapak denetimi geçer', async () => {
  const d = a1Agac();
  const r = await agPolitikasi.paketeUygula(d);
  assert.deepEqual(r.enjekte, ['(kök)', 'kapak/index.html']);
  await A1.kapakaShimEkle(d, 'empp-fs-shim.js', sessiz);
  await A1.kapakaShimEkle(d, 'empp-android-shim.js', sessiz);
  const html = oku(d, 'kapak/index.html');
  const i = (s) => html.indexOf(s);
  assert.ok(i('<base href="../">') < i(A1.A1_KOK_BETIGI));
  for (const s of ['empp-android-shim.js', 'empp-fs-shim.js', 'empp-ag-politikasi.js']) {
    assert.ok(i(s) > i(A1.A1_KOK_BETIGI), `${s} işaretten sonra`);
  }
  assert.deepEqual(A1.kapakDenetle(html), []);
  assert.equal((await agPolitikasi.paketeUygula(d)).enjekte.length, 0, 'yeniden paketlemede çoğalmaz');
});

test('kök index denetimi: A1 düzeni geçerli (a1-kabuk) — kaynak motor da kaynak kabuk da', async () => {
  const d = a1Agac();
  await agPolitikasi.paketeUygula(d);
  const env = { EMPP_KOK_INDEX_DENETIMI: 'dusur' };
  for (const kaynak of [MOTOR, KABUK]) {
    const r = await kokIndex.paketeUygula(d, kaynak, { env });
    assert.equal(r.sonuc.sonuc, 'a1-kabuk', r.sonuc.detay);
  }
});

test('kök index denetimi: A1 motor sayfası başlığını kaybetmişse ya da kök kabuk değilse DÜŞER', async () => {
  const env = { EMPP_KOK_INDEX_DENETIMI: 'dusur' };
  const basliksiz = a1Agac({ kapak: MOTOR });
  await assert.rejects(kokIndex.paketeUygula(basliksiz, MOTOR, { env }), /A1 motor sayfası geçersiz/);
  const shimOnce = a1Agac({ kapak: A1.baslikEkle(MOTOR).replace('<head>', '<head><script src="empp-fs-shim.js"></script>') });
  await assert.rejects(kokIndex.paketeUygula(shimOnce, MOTOR, { env }), /A1 motor sayfası geçersiz/);
  const kokMotor = a1Agac({ kok: MOTOR });
  await assert.rejects(kokIndex.paketeUygula(kokMotor, MOTOR, { env }), /kök index sf425 kabuğu değil/);
  // A1 adayı olmayan (kapak/ yok) tek motorlu kök eski kurallarla değerlendirilir.
  const eski = a1Agac({ kok: MOTOR });
  fs.rmSync(path.join(eski, 'kapak'), { recursive: true });
  assert.equal((await kokIndex.paketeUygula(eski, MOTOR, { env })).sonuc.sonuc, 'sadik');
});

test('K17 set menüsü A1 köküne dokunmaz (alt kitap yok → not-a-set)', async () => {
  const d = a1Agac();
  const r = await ensureSetMenu(d, { force: true });
  assert.equal(r.action, 'not-a-set');
  assert.equal(oku(d, 'index.html'), KABUK);
});

test('SENTINEL (iki paketleme yolu): masaüstü ve Android shim enjeksiyonu A1 motor sayfasını da kapsar', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.match(kaynak, /a1Duzen\.kapakaShimEkle\(appPath, 'empp-fs-shim\.js'/);
  assert.match(kaynak, /a1Duzen\.kapakaShimEkle\(wwwPath, 'empp-android-shim\.js'/);
});
