'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const {
  mod1, pngDurumu, sayfaGorseliMi, bufferiDonustur, klasoruDonustur, acikMi,
  kipCoz, sharpSecenekleri,
} = require('./sayfa-webp');

/** sharp mock: gerçek işlem yapmaz, `.webp()`'e giden seçenek nesnesini yakalar. */
function sahteSharpOlustur() {
  const cagrilar = [];
  const sharpFn = () => ({
    webp: (secenek) => {
      cagrilar.push(secenek);
      return { toBuffer: async () => Buffer.alloc(5, 1) }; // küçük çıktı, guard'ı tetikleyebilir
    },
    metadata: async () => ({ width: 1, height: 1 }),
  });
  return { sharpFn, cagrilar };
}

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

// ---------------------------------------------------------------------------
// KİP: kayipsiz (varsayılan) / yakin / kayipli — 2026-09-22
// ---------------------------------------------------------------------------

test('kipCoz: EMPP_SAYFA_WEBP_KIP tanımsızsa varsayılan kayipsiz, UYARI yok', () => {
  const { kip, uyari } = kipCoz({});
  assert.strictEqual(kip, 'kayipsiz');
  assert.strictEqual(uyari, null);
});

test('kipCoz: geçersiz değer kayipsiz + görünür UYARI üretir', () => {
  const { kip, uyari } = kipCoz({ EMPP_SAYFA_WEBP_KIP: 'zibidi' });
  assert.strictEqual(kip, 'kayipsiz');
  assert.match(uyari, /^UYARI:.*EMPP_SAYFA_WEBP_KIP/);
});

test('kipCoz: geçerli üç değer de aynen döner, UYARI yok', () => {
  assert.deepStrictEqual(kipCoz({ EMPP_SAYFA_WEBP_KIP: 'kayipsiz' }), { kip: 'kayipsiz', uyari: null });
  assert.deepStrictEqual(kipCoz({ EMPP_SAYFA_WEBP_KIP: 'yakin' }), { kip: 'yakin', uyari: null });
  assert.deepStrictEqual(kipCoz({ EMPP_SAYFA_WEBP_KIP: 'kayipli' }), { kip: 'kayipli', uyari: null });
});

test('sharpSecenekleri: her kip doğru sharp .webp() seçeneğini üretir', () => {
  assert.deepStrictEqual(sharpSecenekleri('kayipsiz'), { lossless: true });
  assert.deepStrictEqual(sharpSecenekleri('yakin', { yakinKalite: 60 }), { nearLossless: true, quality: 60 });
  assert.deepStrictEqual(sharpSecenekleri('kayipli', { kayipliKalite: 82 }), { quality: 82 });
  // varsayılan kaliteler (parametre verilmezse)
  assert.deepStrictEqual(sharpSecenekleri('yakin'), { nearLossless: true, quality: 60 });
  assert.deepStrictEqual(sharpSecenekleri('kayipli'), { quality: 82 });
});

test('bufferiDonustur: kip verilmez, env de yoksa sharp.webp lossless:true alır (varsayılan)', async () => {
  const onceki = process.env.EMPP_SAYFA_WEBP_KIP;
  delete process.env.EMPP_SAYFA_WEBP_KIP;
  try {
    const { sharpFn, cagrilar } = sahteSharpOlustur();
    const p = await pngUret(50, 50);
    const r = await bufferiDonustur(p, { sharpFn });
    assert.deepStrictEqual(cagrilar[0], { lossless: true });
    assert.strictEqual(r.kip, 'kayipsiz');
  } finally {
    if (onceki === undefined) delete process.env.EMPP_SAYFA_WEBP_KIP; else process.env.EMPP_SAYFA_WEBP_KIP = onceki;
  }
});

test('bufferiDonustur: opts.kip=yakin ile nearLossless + varsayılan kalite 60', async () => {
  const onceki = process.env.EMPP_SAYFA_WEBP_KALITE;
  delete process.env.EMPP_SAYFA_WEBP_KALITE;
  try {
    const { sharpFn, cagrilar } = sahteSharpOlustur();
    const p = await pngUret(50, 50);
    const r = await bufferiDonustur(p, { kip: 'yakin', sharpFn });
    assert.deepStrictEqual(cagrilar[0], { nearLossless: true, quality: 60 });
    assert.strictEqual(r.kip, 'yakin');
  } finally {
    if (onceki === undefined) delete process.env.EMPP_SAYFA_WEBP_KALITE; else process.env.EMPP_SAYFA_WEBP_KALITE = onceki;
  }
});

test('bufferiDonustur: EMPP_SAYFA_WEBP_KALITE env, yakin kipte kaliteyi değiştirir', async () => {
  const onceki = process.env.EMPP_SAYFA_WEBP_KALITE;
  process.env.EMPP_SAYFA_WEBP_KALITE = '75';
  try {
    const { sharpFn, cagrilar } = sahteSharpOlustur();
    const p = await pngUret(50, 50);
    await bufferiDonustur(p, { kip: 'yakin', sharpFn });
    assert.deepStrictEqual(cagrilar[0], { nearLossless: true, quality: 75 });
  } finally {
    if (onceki === undefined) delete process.env.EMPP_SAYFA_WEBP_KALITE; else process.env.EMPP_SAYFA_WEBP_KALITE = onceki;
  }
});

test('bufferiDonustur: opts.kip=kayipli mevcut davranışı korur (quality 82)', async () => {
  const { sharpFn, cagrilar } = sahteSharpOlustur();
  const p = await pngUret(50, 50);
  const r = await bufferiDonustur(p, { kip: 'kayipli', sharpFn });
  assert.deepStrictEqual(cagrilar[0], { quality: 82 });
  assert.strictEqual(r.kip, 'kayipli');
});

test('bufferiDonustur: geçersiz EMPP_SAYFA_WEBP_KIP → kayipsiz + görünür UYARI log satırı', async () => {
  const onceki = process.env.EMPP_SAYFA_WEBP_KIP;
  process.env.EMPP_SAYFA_WEBP_KIP = 'gecersiz-deger';
  try {
    const gunlukler = [];
    const { sharpFn, cagrilar } = sahteSharpOlustur();
    const p = await pngUret(50, 50);
    const r = await bufferiDonustur(p, { sharpFn, log: (s) => gunlukler.push(s) });
    assert.strictEqual(r.kip, 'kayipsiz');
    assert.deepStrictEqual(cagrilar[0], { lossless: true });
    assert.ok(gunlukler.some((s) => /^UYARI:.*EMPP_SAYFA_WEBP_KIP/.test(s)));
  } finally {
    if (onceki === undefined) delete process.env.EMPP_SAYFA_WEBP_KIP; else process.env.EMPP_SAYFA_WEBP_KIP = onceki;
  }
});

test('GERÇEK ÖLÇÜM: kip=kayipsiz decode edilen piksel özgünle bayt-eşit (bkz. WEBP-KAYIPSIZ-OLCUMU.md)', async () => {
  const p = await pngUret(300, 400);
  const r = await bufferiDonustur(p, { kip: 'kayipsiz' });
  assert.strictEqual(r.donusturuldu, true);
  assert.strictEqual((await sharp(r.cikti).metadata()).format, 'webp');
  const ozgunRaw = await sharp(p).raw().toBuffer();
  const cozulmusRaw = await sharp(r.cikti).raw().toBuffer();
  assert.deepStrictEqual(cozulmusRaw, ozgunRaw, 'lossless WebP piksel-eşit OLMALI');
});

test('GERÇEK ÖLÇÜM: kip=yakin ile küçülür ve neredeyse-kayıpsız kalır (maxAbsErr küçük)', async () => {
  const p = await pngUret(300, 400);
  const r = await bufferiDonustur(p, { kip: 'yakin', kalite: 60 });
  assert.strictEqual(r.donusturuldu, true);
  assert.ok(r.cikti.length < p.length);
  const ozgunRaw = await sharp(p).raw().toBuffer();
  const cozulmusRaw = await sharp(r.cikti).raw().toBuffer();
  assert.strictEqual(cozulmusRaw.length, ozgunRaw.length);
  let maksFark = 0;
  for (let i = 0; i < ozgunRaw.length; i++) {
    const fark = Math.abs(ozgunRaw[i] - cozulmusRaw[i]);
    if (fark > maksFark) maksFark = fark;
  }
  assert.ok(maksFark <= 4, `near-lossless fark küçük olmalı, ölçülen=${maksFark}`);
});

test('boyut-koruma guard kayipsiz kipte de çalışır: küçük düz renkli PNG özgün kalır ya da bayt-eşit döner', async () => {
  const kucuk = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png({ compressionLevel: 9 }).toBuffer();
  const r = await bufferiDonustur(kucuk, { kip: 'kayipsiz' });
  assert.strictEqual(r.kip, 'kayipsiz');
  if (!r.donusturuldu) {
    assert.strictEqual(r.sebep, 'kucultmedi');
    assert.deepStrictEqual(r.cikti, kucuk);
  } else {
    const oRaw = await sharp(kucuk).raw().toBuffer();
    const cRaw = await sharp(r.cikti).raw().toBuffer();
    assert.deepStrictEqual(cRaw, oRaw);
  }
});

test('klasoruDonustur: kip belirtilmezse varsayılan kayipsiz ile dönüştürür ve log kip adını taşır', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'webp-kip-'));
  const onceki = process.env.EMPP_SAYFA_WEBP_KIP;
  delete process.env.EMPP_SAYFA_WEBP_KIP;
  try {
    const p = await pngUret(300, 400);
    await fs.outputFile(path.join(kok, 'assets/100/pages/1.png'), mod1(p));

    const gunlukler = [];
    const ist = await klasoruDonustur(kok, { log: (s) => gunlukler.push(s) });
    assert.strictEqual(ist.donusturulen, 1);

    const yeni = await fs.readFile(path.join(kok, 'assets/100/pages/1.png'));
    const cozulmus = mod1(yeni);
    assert.strictEqual((await sharp(cozulmus).metadata()).format, 'webp');
    const ozgunRaw = await sharp(p).raw().toBuffer();
    const cozulmusRaw = await sharp(cozulmus).raw().toBuffer();
    assert.deepStrictEqual(cozulmusRaw, ozgunRaw, 'klasör turu da bayt-eşit lossless üretmeli');

    assert.ok(gunlukler.some((s) => s.includes('[sayfa-webp] kip=kayipsiz')), 'günlükte kip adı görünmeli');
  } finally {
    if (onceki === undefined) delete process.env.EMPP_SAYFA_WEBP_KIP; else process.env.EMPP_SAYFA_WEBP_KIP = onceki;
    await fs.remove(kok);
  }
});

test('klasoruDonustur: opts.kip=kayipli verilirse eski davranışla dönüştürür', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'webp-kip-kayipli-'));
  try {
    const p = await pngUret(300, 400);
    await fs.outputFile(path.join(kok, 'assets/100/pages/1.png'), mod1(p));

    const gunlukler = [];
    const ist = await klasoruDonustur(kok, { kip: 'kayipli', log: (s) => gunlukler.push(s) });
    assert.strictEqual(ist.donusturulen, 1);
    assert.ok(gunlukler.some((s) => s.includes('[sayfa-webp] kip=kayipli')));
  } finally { await fs.remove(kok); }
});
