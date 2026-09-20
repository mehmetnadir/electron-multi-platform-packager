'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const M = require('./olu-motor-temizligi');

const H = (n) => String(n).padStart(20, '0').replace(/0/g, 'a').slice(0, 19) + String(n % 10);
const h1 = 'aaaaaaaaaaaaaaaaaaa1';
const h2 = 'bbbbbbbbbbbbbbbbbbb2';
const h3 = 'ccccccccccccccccccc3';
const h4 = 'ddddddddddddddddddd4';

test('tohumlariCikar: src/href toplar, sorgu ve ./ atar, http/data eler', () => {
  const t = M.tohumlariCikar(
    '<script src="./a.js?v=1"></script><link href="b.css"/>' +
    '<script src="https://cdn/x.js"></script><img src="data:image/png;base64,AA"/>' +
    '<img src="core/logo.png#x"/>');
  assert.deepEqual(t, ['a.js', 'b.css', 'core/logo.png']);
});

test('kapanış: index → ana bundle → geçişli chunk', () => {
  const dosyalar = [`${h1}.main.js`, `${h2}.151.js`, `${h3}.907.js`, `${h4}.main.js`, 'app.config.js'];
  const icerik = {
    [`${h1}.main.js`]: `yukle("${h2}")`,
    [`${h2}.151.js`]: `sonra("${h3}")`,
    [`${h3}.907.js`]: 'son',
    [`${h4}.main.js`]: 'eski surum',
    'app.config.js': 'var AppConfig={}',
  };
  const r = M.kapanisHesapla(dosyalar, `<script src="${h1}.main.js"></script><script src="app.config.js"></script>`,
    (f) => icerik[f]);
  assert.equal(r.sebep, 'hesaplandi');
  assert.deepEqual(r.olu, [`${h4}.main.js`], 'yalnız ulaşılmayan eski bundle ölü olmalı');
  assert.ok(r.ulasilan.has(`${h3}.907.js`), 'geçişli chunk ulaşılan sayılmalı');
});

test('GÜVENLİK: hash olmayan dosyalar ASLA ölü sayılmaz', () => {
  const dosyalar = [`${h1}.main.js`, 'app.config.js', 'icons.js', 'images.js', 'tour.js',
    'Main.xml', 'electron.js', 'gizemli-yardimci.js'];
  const r = M.kapanisHesapla(dosyalar, `<script src="${h1}.main.js"></script>`, () => '');
  assert.deepEqual(r.olu, [], 'içerik-hash deseni taşımayan hiçbir dosya silinmemeli');
});

test('GÜVENLİK: tohum VAR ama js girişi yoksa NO-OP (hepsini silme imkânsız)', () => {
  // style.css GERÇEKTEN listede — yani 'tohum-yok' devreye girmez. Tek koruma
  // js-girisi-yok kapısıdır; o kalkarsa iki bundle da silinir.
  const dosyalar = ['style.css', `${h1}.main.js`, `${h2}.151.js`];
  const r = M.kapanisHesapla(dosyalar, '<link href="style.css"/>', () => '');
  assert.equal(r.sebep, 'js-girisi-yok');
  assert.equal(r.olu.length, 0, 'js girişi yokken hiçbir bundle silinmemeli');
});

test('GÜVENLİK: tohum hiç eşleşmezse NO-OP', () => {
  const r = M.kapanisHesapla([`${h1}.main.js`], '<script src="olmayan.js"></script>', () => '');
  assert.equal(r.sebep, 'tohum-yok');
  assert.equal(r.olu.length, 0);
});

test('okuma hatası bir dosyayı düşürür ama çökmez', () => {
  const dosyalar = [`${h1}.main.js`, `${h2}.151.js`];
  const r = M.kapanisHesapla(dosyalar, `<script src="${h1}.main.js"></script>`,
    (f) => { if (f === `${h1}.main.js`) throw new Error('okunamadı'); return ''; });
  assert.equal(r.sebep, 'hesaplandi');
  assert.deepEqual(r.olu, [`${h2}.151.js`]);
});

test('diskte: gerçek dizin temizlenir, korunanlar kalır', async () => {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-olu-'));
  try {
    await fs.writeFile(path.join(d, 'index.html'), `<script src="${h1}.main.js"></script><script src="app.config.js"></script>`);
    await fs.writeFile(path.join(d, `${h1}.main.js`), `ref("${h2}")`);
    await fs.writeFile(path.join(d, `${h2}.151.js`), 'x'.repeat(1000));
    await fs.writeFile(path.join(d, `${h4}.main.js`), 'y'.repeat(5000));   // ölü
    await fs.writeFile(path.join(d, 'app.config.js'), 'cfg');
    await fs.writeFile(path.join(d, 'gizemli.js'), 'korunmali');
    const r = await M.dizeniTemizle(d);
    assert.equal(r.silinen, 1);
    assert.equal(r.bayt, 5000);
    assert.equal(await fs.pathExists(path.join(d, `${h4}.main.js`)), false);
    assert.equal(await fs.pathExists(path.join(d, `${h2}.151.js`)), true, 'ulaşılan chunk kalmalı');
    assert.equal(await fs.pathExists(path.join(d, 'gizemli.js')), true, 'hash desenli olmayan dosya kalmalı');
    assert.equal(await fs.pathExists(path.join(d, 'app.config.js')), true);
  } finally { await fs.remove(d); }
});

test('index.html olmayan dizin atlanır', async () => {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-olu2-'));
  try {
    await fs.writeFile(path.join(d, `${h4}.main.js`), 'z');
    const r = await M.dizeniTemizle(d);
    assert.equal(r.atlandi, 'index-yok');
    assert.equal(await fs.pathExists(path.join(d, `${h4}.main.js`)), true);
  } finally { await fs.remove(d); }
});

test('paketiTemizle: kök + bookN dizinlerini gezer', async () => {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-olu3-'));
  try {
    for (const b of ['book1', 'book2']) {
      await fs.ensureDir(path.join(d, b));
      await fs.writeFile(path.join(d, b, 'index.html'), `<script src="${h1}.main.js"></script>`);
      await fs.writeFile(path.join(d, b, `${h1}.main.js`), 'canli');
      await fs.writeFile(path.join(d, b, `${h4}.main.js`), 'o'.repeat(2000));
    }
    await fs.writeFile(path.join(d, 'index.html'), '<script src="electron.js"></script>');
    await fs.writeFile(path.join(d, 'electron.js'), 'kabuk');
    const r = await M.paketiTemizle(d);
    assert.equal(r.toplamDosya, 2);
    assert.equal(r.toplamBayt, 4000);
    assert.equal(await fs.pathExists(path.join(d, 'electron.js')), true, 'kök kabuk korunmalı');
  } finally { await fs.remove(d); }
});

test('kapı: varsayılan AÇIK, EMPP_OLU_TEMIZLIK=0 kapatır', () => {
  assert.equal(M.acikMi({}), true);
  assert.equal(M.acikMi({ EMPP_OLU_TEMIZLIK: '1' }), true);
  assert.equal(M.acikMi({ EMPP_OLU_TEMIZLIK: '0' }), false);
});

// --- kaynak-sentineli: hattan sessizce düşmesin ---
const SRC = require('fs').readFileSync(require('path').join(__dirname, 'packagingService.js'), 'utf8');

test('sentinel: packagingService ölü motor temizliğini ÇAĞIRIR', () => {
  assert.match(SRC, /require\('\.\/olu-motor-temizligi'\)/, 'modül import edilmeli');
  assert.match(SRC, /oluMotor\.acikMi\(\)/, 'kapı kontrolü çağrılmalı');
  assert.match(SRC, /oluMotor\.paketiTemizle\(workingPath/, 'çalışma kopyasında koşmalı');
});

test('sentinel: temizlik WebP dönüşümünden ÖNCE koşar', () => {
  const iTemizlik = SRC.indexOf('oluMotor.paketiTemizle(workingPath');
  const iWebp = SRC.indexOf('sayfaWebp.klasoruDonustur(workingPath');
  assert.ok(iTemizlik > 0 && iWebp > 0, 'iki adım da bulunmalı');
  assert.ok(iTemizlik < iWebp, 'atacağımız dosyayı WebP\'ye çevirmenin anlamı yok');
});

test('KARAR sentineli: NSIS per-user ve UAC YOK (allowElevation:false, perMachine:false)', () => {
  assert.match(SRC, /allowElevation:\s*false/, '2026-09-18 kararı: UAC sorulmaz');
  assert.match(SRC, /perMachine:\s*false/, 'kurulum kullanıcı profiline');
});

test('KARAR sentineli: electron-builder 26 uyumu — publisherName signtoolOptions altında', () => {
  assert.match(SRC, /signtoolOptions:\s*\{[\s\S]{0,120}publisherName/,
    'win.publisherName eb26\'da geçersiz; signtoolOptions altında olmalı');
  assert.doesNotMatch(SRC, /win:\s*\{[\s\S]{0,400}^\s{8}publisherName:/m,
    'win kökünde publisherName kalmamalı');
});
