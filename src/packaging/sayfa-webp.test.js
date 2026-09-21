'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { mod1, pngDurumu, sayfaGorseliMi, bufferiDonustur, klasoruDonustur, acikMi } = require('./sayfa-webp');

const pngUret = (en = 300, boy = 400) =>
  sharp({ create: { width: en, height: boy, channels: 3, background: { r: 240, g: 90, b: 30 } } })
    .png().toBuffer();

test('mod1 involutif — iki kez uygulanınca özgün döner', () => {
  const b = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);
  assert.deepStrictEqual(mod1(mod1(b)), b);
});

test('mod1 yalnız ilk N baytı çevirir', () => {
  const b = Buffer.alloc(200, 0x10);
  const c = mod1(b, 100);
  assert.strictEqual(c[0], (256 - 0x10) & 0xff);
  assert.strictEqual(c[99], (256 - 0x10) & 0xff);
  assert.strictEqual(c[100], 0x10, '100. bayttan sonrası DOKUNULMAMALI');
});

test('pngDurumu düz / şifreli / bilinmiyor ayırır', async () => {
  const p = await pngUret();
  assert.strictEqual(pngDurumu(p), 'duz');
  assert.strictEqual(pngDurumu(mod1(p)), 'sifreli');
  assert.strictEqual(pngDurumu(Buffer.from([1, 2, 3, 4])), 'bilinmiyor');
});

test('yalnız assets/<kitap>/pages/*.png hedeflenir', () => {
  assert.ok(sayfaGorseliMi('assets/61633/pages/1.png'));
  assert.ok(sayfaGorseliMi(path.join('assets', '33518', 'pages', '117.png')));
  assert.ok(!sayfaGorseliMi('assets/61633/thumbs/1.png'), 'thumbs şifresiz kalmalı, dokunulmaz');
  assert.ok(!sayfaGorseliMi('core/backgrounds/reals/sandy.jpg'));
  assert.ok(!sayfaGorseliMi('assets/61633/data/coordinates.xml'));
  assert.ok(!sayfaGorseliMi('pages/1.png'), 'assets kökü olmadan eşleşmemeli');
});

test('düz PNG dönüştürülür ve çıktı WebP olur', async () => {
  const p = await pngUret();
  const r = await bufferiDonustur(p);
  assert.strictEqual(r.donusturuldu, true);
  assert.ok(r.cikti.length < p.length);
  const ust = await sharp(r.cikti).metadata();
  assert.strictEqual(ust.format, 'webp');
});

test('KRİTİK: şifreli girdi şifreli çıkar (mod1 geri uygulanır)', async () => {
  const p = await pngUret();
  const sifreli = mod1(p);
  const r = await bufferiDonustur(sifreli);
  assert.strictEqual(r.donusturuldu, true);
  assert.notStrictEqual(pngDurumu(r.cikti), 'duz', 'çıktı şifresiz bırakılmış');
  const cozulmus = mod1(r.cikti);
  const ust = await sharp(cozulmus).metadata();
  assert.strictEqual(ust.format, 'webp', 'çözülünce geçerli WebP olmalı');
});

test('küçültmüyorsa ÖZGÜN korunur — paket asla büyümez', async () => {
  const kucuk = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png({ compressionLevel: 9 }).toBuffer();
  const r = await bufferiDonustur(kucuk);
  if (!r.donusturuldu) {
    assert.strictEqual(r.sebep, 'kucultmedi');
    assert.deepStrictEqual(r.cikti, kucuk);
  } else {
    assert.ok(r.cikti.length < kucuk.length);
  }
});

test('PNG olmayan içerik dokunulmadan döner', async () => {
  const cop = Buffer.from('bu bir png degil', 'utf8');
  const r = await bufferiDonustur(cop);
  assert.strictEqual(r.donusturuldu, false);
  assert.strictEqual(r.sebep, 'png-degil');
  assert.deepStrictEqual(r.cikti, cop);
});

test('kodlama hatası sessizce yutulmaz, özgün korunur', async () => {
  const p = await pngUret();
  const patlayan = () => ({ webp: () => ({ toBuffer: async () => { throw new Error('bilerek'); } }) });
  const r = await bufferiDonustur(p, { sharpFn: patlayan });
  assert.strictEqual(r.donusturuldu, false);
  assert.match(r.sebep, /^kodlama-hatasi:/);
  assert.deepStrictEqual(r.cikti, p);
});

test('klasör turu: yalnız sayfaları çevirir, diğerlerine dokunmaz', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'webp-test-'));
  try {
    const p = await pngUret(600, 800);
    await fs.outputFile(path.join(kok, 'assets/100/pages/1.png'), mod1(p));
    await fs.outputFile(path.join(kok, 'assets/100/pages/2.png'), mod1(p));
    await fs.outputFile(path.join(kok, 'assets/100/thumbs/1.png'), p);
    await fs.outputFile(path.join(kok, 'core/arka.png'), p);

    const ist = await klasoruDonustur(kok);
    assert.strictEqual(ist.bakilan, 2, 'yalnız iki sayfa aday olmalı');
    assert.strictEqual(ist.donusturulen, 2);
    assert.strictEqual(ist.hata, 0);
    assert.ok(ist.sonrakiBayt < ist.oncekiBayt);

    // sayfa dosyası ADI değişmedi ve şifreli WebP oldu
    const yeni = await fs.readFile(path.join(kok, 'assets/100/pages/1.png'));
    assert.strictEqual((await sharp(mod1(yeni)).metadata()).format, 'webp');
    // thumbs ve core DOKUNULMADI
    assert.deepStrictEqual(await fs.readFile(path.join(kok, 'assets/100/thumbs/1.png')), p);
    assert.deepStrictEqual(await fs.readFile(path.join(kok, 'core/arka.png')), p);
    // geçici dosya artığı kalmadı
    const kalanlar = await fs.readdir(path.join(kok, 'assets/100/pages'));
    assert.deepStrictEqual(kalanlar.sort(), ['1.png', '2.png']);
  } finally { await fs.remove(kok); }
});

test('GÖRÜNÜR UYARI: kapı açıkken klasoruDonustur üretim başında log basar', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'webp-uyari-acik-'));
  const onceki = process.env.EMPP_SAYFA_WEBP;
  process.env.EMPP_SAYFA_WEBP = '1';
  try {
    const gunlukler = [];
    await klasoruDonustur(kok, { log: (s) => gunlukler.push(s) });
    assert.ok(
      gunlukler.some((s) => /^UYARI:.*EMPP_SAYFA_WEBP=1/.test(s)),
      'kapı açıkken görünür UYARI satırı basılmalı'
    );
  } finally {
    if (onceki === undefined) delete process.env.EMPP_SAYFA_WEBP;
    else process.env.EMPP_SAYFA_WEBP = onceki;
    await fs.remove(kok);
  }
});

test('kapı kapalıyken klasoruDonustur UYARI basmaz', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'webp-uyari-kapali-'));
  const onceki = process.env.EMPP_SAYFA_WEBP;
  delete process.env.EMPP_SAYFA_WEBP;
  try {
    const gunlukler = [];
    await klasoruDonustur(kok, { log: (s) => gunlukler.push(s) });
    assert.ok(!gunlukler.some((s) => /^UYARI:/.test(s)), 'kapı kapalıyken UYARI basılmamalı');
  } finally {
    if (onceki !== undefined) process.env.EMPP_SAYFA_WEBP = onceki;
    await fs.remove(kok);
  }
});

test('kuru koşu hiçbir dosyayı değiştirmez', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'webp-kuru-'));
  try {
    const p = await pngUret(600, 800);
    const yol = path.join(kok, 'assets/100/pages/1.png');
    await fs.outputFile(yol, mod1(p));
    const once = await fs.readFile(yol);
    const ist = await klasoruDonustur(kok, { kuru: true });
    assert.strictEqual(ist.donusturulen, 1, 'kuru koşu kazancı yine de raporlamalı');
    assert.deepStrictEqual(await fs.readFile(yol), once, 'kuru koşu dosyayı DEĞİŞTİRMEMELİ');
  } finally { await fs.remove(kok); }
});

test('KAPI: varsayılan KAPALI — yalnız EMPP_SAYFA_WEBP=1 açar', () => {
  assert.strictEqual(acikMi({}), false);
  assert.strictEqual(acikMi({ EMPP_SAYFA_WEBP: '0' }), false);
  assert.strictEqual(acikMi({ EMPP_SAYFA_WEBP: 'true' }), false);
  assert.strictEqual(acikMi({ EMPP_SAYFA_WEBP: '1' }), true);
});
