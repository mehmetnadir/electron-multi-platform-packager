'use strict';
// ENTEGRASYON: sayfa-webp.js'in bufferiDonustur/klasoruDonustur'u ile
// webp-onbellek.js'in gerçekten birlikte çalıştığını sınar (sahte küçük PNG'ler,
// sharp GERÇEK — mock yok). Saf önbellek modülü testleri webp-onbellek.test.js'te.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { bufferiDonustur, klasoruDonustur, mod1 } = require('./sayfa-webp');

const gecici = () => fs.mkdtemp(path.join(os.tmpdir(), 'sayfa-webp-onbellek-test-'));

const pngUret = (en = 300, boy = 400) =>
  sharp({ create: { width: en, height: boy, channels: 3, background: { r: 240, g: 90, b: 30 } } })
    .png().toBuffer();

// sıkışmayan gerçek rastgele piksel — 6×6'da ölçülerek doğrulandı: WebP lossless
// PNG'den HER ZAMAN büyük çıkıyor (container ek yükü) → 'kucultmedi' dalı garanti.
const kucultulmezPngUret = async () => {
  const boyut = 6;
  const piksel = require('crypto').randomBytes(boyut * boyut * 3);
  return sharp(piksel, { raw: { width: boyut, height: boyut, channels: 3 } })
    .png({ compressionLevel: 9 }).toBuffer();
};

/** sharp çağrılarını sayan gerçek sharp sarmalayıcı (encode gerçekten atlandı mı?). */
function sayanSharp() {
  const gercekSharp = require('sharp');
  let cagriSayisi = 0;
  const fn = (...args) => { cagriSayisi++; return gercekSharp(...args); };
  return { sharpFn: fn, sayac: () => cagriSayisi };
}

test('ENTEGRASYON: ıska → yaz → isabet, aynı bayt döner ve ikinci çağrıda sharp hiç koşmaz', async () => {
  const dizin = await gecici();
  try {
    const onbellek = { acik: true, dizin, tavanGb: 30 };
    const p = await pngUret(200, 200);
    const { sharpFn, sayac } = sayanSharp();

    const r1 = await bufferiDonustur(p, { kip: 'kayipsiz', onbellek, sharpFn });
    assert.strictEqual(r1.donusturuldu, true);
    assert.strictEqual(r1.onbellek, 'iska');
    const sayi1 = sayac();
    assert.ok(sayi1 >= 1, 'ilk çağrıda sharp koşmalı');

    const r2 = await bufferiDonustur(p, { kip: 'kayipsiz', onbellek, sharpFn });
    assert.strictEqual(r2.donusturuldu, true);
    assert.strictEqual(r2.onbellek, 'isabet');
    assert.deepStrictEqual(r2.cikti, r1.cikti, 'önbellekten dönen çıktı ilk üretimle bayt-eşit olmalı');
    assert.strictEqual(sayac(), sayi1, 'ikinci çağrıda sharp HİÇ çağrılmamalı (önbellekten geldi)');
  } finally { await fs.remove(dizin); }
});

test('ENTEGRASYON: farklı girdi (1 baytlık fark bile) ıska olarak kalır', async () => {
  const dizin = await gecici();
  try {
    const onbellek = { acik: true, dizin, tavanGb: 30 };
    const p1 = await pngUret(200, 200);
    const p2 = await pngUret(201, 200); // farklı boyut → farklı bayt

    await bufferiDonustur(p1, { kip: 'kayipsiz', onbellek });
    const r2 = await bufferiDonustur(p2, { kip: 'kayipsiz', onbellek });
    assert.strictEqual(r2.onbellek, 'iska', 'farklı girdi aynı anahtara denk gelmemeli');
  } finally { await fs.remove(dizin); }
});

test('ENTEGRASYON: aynı girdi farklı kip → ıska (anahtar kipi de kapsıyor)', async () => {
  const dizin = await gecici();
  try {
    const onbellek = { acik: true, dizin, tavanGb: 30 };
    const p = await pngUret(200, 200);

    const r1 = await bufferiDonustur(p, { kip: 'kayipsiz', onbellek });
    assert.strictEqual(r1.onbellek, 'iska');
    const r2 = await bufferiDonustur(p, { kip: 'yakin', kalite: 60, onbellek });
    assert.strictEqual(r2.onbellek, 'iska', 'farklı kip aynı önbellek girdisini kullanmamalı');
  } finally { await fs.remove(dizin); }
});

test('ENTEGRASYON: şifreli (mod1) girdi de doğru cache anahtarıyla isabet eder', async () => {
  const dizin = await gecici();
  try {
    const onbellek = { acik: true, dizin, tavanGb: 30 };
    const p = mod1(await pngUret(150, 150));
    const { sharpFn, sayac } = sayanSharp();

    const r1 = await bufferiDonustur(p, { kip: 'kayipsiz', onbellek, sharpFn });
    assert.strictEqual(r1.donusturuldu, true);
    const sayi1 = sayac();

    const r2 = await bufferiDonustur(p, { kip: 'kayipsiz', onbellek, sharpFn });
    assert.strictEqual(r2.onbellek, 'isabet');
    assert.deepStrictEqual(r2.cikti, r1.cikti);
    assert.strictEqual(sayac(), sayi1, 'şifreli girdide de ikinci çağrı sharp koşturmamalı');
  } finally { await fs.remove(dizin); }
});

test('ENTEGRASYON: "küçülmedi" kararı önbellekten gelir, ikinci çağrıda sharp koşmaz', async () => {
  const dizin = await gecici();
  try {
    const onbellek = { acik: true, dizin, tavanGb: 30 };
    const kucuk = await kucultulmezPngUret();
    const { sharpFn, sayac } = sayanSharp();

    const r1 = await bufferiDonustur(kucuk, { kip: 'kayipsiz', onbellek, sharpFn });
    assert.strictEqual(r1.donusturuldu, false);
    assert.strictEqual(r1.sebep, 'kucultmedi');
    assert.strictEqual(r1.onbellek, 'iska');
    const sayi1 = sayac();
    assert.ok(sayi1 >= 1);

    const r2 = await bufferiDonustur(kucuk, { kip: 'kayipsiz', onbellek, sharpFn });
    assert.strictEqual(r2.donusturuldu, false);
    assert.strictEqual(r2.sebep, 'kucultmedi');
    assert.strictEqual(r2.onbellek, 'isabet', '"özgün" kararı önbellekten gelmeli');
    assert.deepStrictEqual(r2.cikti, kucuk);
    assert.strictEqual(sayac(), sayi1, 'ikinci çağrıda sharp HİÇ koşmamalı — özgün kararı önbellekten geldi');
  } finally { await fs.remove(dizin); }
});

test('ENTEGRASYON: bozuk önbellek dosyası → yeniden çevrilir, çıktı doğru ve önbellek onarılır', async () => {
  const dizin = await gecici();
  try {
    const onbellek = { acik: true, dizin, tavanGb: 30 };
    const p = await pngUret(180, 220);

    const r1 = await bufferiDonustur(p, { kip: 'kayipsiz', onbellek });
    assert.strictEqual(r1.donusturuldu, true);

    // Önbellek dosyasını elle boz (yarım/rastgele veri ile üzerine yaz).
    const { anahtarHesapla, dosyaYolu } = require('./webp-onbellek');
    const anahtar = anahtarHesapla(p, 'kayipsiz');
    const yol = dosyaYolu(dizin, anahtar);
    await fs.writeFile(yol, Buffer.from('bilerek-bozulmus-onbellek-dosyasi'));

    const r2 = await bufferiDonustur(p, { kip: 'kayipsiz', onbellek });
    assert.strictEqual(r2.onbellek, 'iska', 'bozuk dosya ıska sayılıp yeniden çevrilmeli');
    assert.strictEqual(r2.donusturuldu, true);
    const ust = await sharp(r2.cikti).metadata();
    assert.strictEqual(ust.format, 'webp', 'yeniden üretilen çıktı geçerli WebP olmalı');

    // Önbellek artık ONARILMIŞ olmalı — üçüncü çağrı isabet etmeli.
    const r3 = await bufferiDonustur(p, { kip: 'kayipsiz', onbellek });
    assert.strictEqual(r3.onbellek, 'isabet');
    assert.deepStrictEqual(r3.cikti, r2.cikti);
  } finally { await fs.remove(dizin); }
});

test('ENTEGRASYON: EMPP_WEBP_ONBELLEK=0 (kapalı) iken dizine hiç yazılmaz', async () => {
  const dizin = await gecici();
  const hicOlusmayacakOnbellekDizini = path.join(dizin, 'onbellek-hic-olusmamali');
  try {
    const onbellek = { acik: false, dizin: hicOlusmayacakOnbellekDizini };
    const p = await pngUret(120, 120);
    await bufferiDonustur(p, { kip: 'kayipsiz', onbellek });
    await bufferiDonustur(await kucultulmezPngUret(), { kip: 'kayipsiz', onbellek });
    assert.strictEqual(await fs.pathExists(hicOlusmayacakOnbellekDizini), false,
      'kapalıyken önbellek dizini hiç oluşturulmamalı');
  } finally { await fs.remove(dizin); }
});

test('ENTEGRASYON klasoruDonustur: kip başına ayrı önbellek girdisi, log satırı sayaç taşır', async () => {
  const dizin = await gecici();
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'sayfa-webp-klasor-onbellek-'));
  try {
    const onbellek = { acik: true, dizin, tavanGb: 30 };
    const p1 = mod1(await pngUret(150, 150));
    const p2 = mod1(await pngUret(160, 160));
    await fs.outputFile(path.join(kok, 'assets/100/pages/1.png'), p1);
    await fs.outputFile(path.join(kok, 'assets/100/pages/2.png'), p2);

    const gunlukler1 = [];
    const ist1 = await klasoruDonustur(kok, { onbellek, log: (s) => gunlukler1.push(s) });
    assert.strictEqual(ist1.onbellek.iska, 2);
    assert.strictEqual(ist1.onbellek.isabet, 0);
    assert.strictEqual(ist1.onbellek.yazilan, 2);
    assert.ok(gunlukler1.some((s) => /^webp-onbellek isabet=0 ıska=2 yazılan=2$/.test(s)));

    // Aynı sayfaları TEKRAR kur (ilk turda dosya adı değişmedi ama içerik artık
    // WebP — gerçek senaryoda "yeniden derleme" temiz girdiyle başlar, o yüzden
    // burada temiz kaynak PNG'lerle yeni bir klasör kuruyoruz — DEĞİŞMEYEN sayfa
    // simülasyonu).
    const kok2 = await fs.mkdtemp(path.join(os.tmpdir(), 'sayfa-webp-klasor-onbellek-2-'));
    try {
      await fs.outputFile(path.join(kok2, 'assets/200/pages/1.png'), p1); // p1 İLE AYNI bayt
      await fs.outputFile(path.join(kok2, 'assets/200/pages/2.png'), p2); // p2 İLE AYNI bayt

      const gunlukler2 = [];
      const ist2 = await klasoruDonustur(kok2, { onbellek, log: (s) => gunlukler2.push(s) });
      assert.strictEqual(ist2.onbellek.isabet, 2, 'aynı bayt farklı kitapta/yolda da isabet etmeli');
      assert.strictEqual(ist2.onbellek.iska, 0);
      assert.ok(gunlukler2.some((s) => /^webp-onbellek isabet=2 ıska=0 yazılan=0$/.test(s)));

      // İkinci turda üretilen dosya içeriği ilk turdakiyle bayt-eşit olmalı.
      const yeni1 = await fs.readFile(path.join(kok, 'assets/100/pages/1.png'));
      const yeni2 = await fs.readFile(path.join(kok2, 'assets/200/pages/1.png'));
      assert.deepStrictEqual(yeni2, yeni1, 'önbellekten gelen çıktı ilk üretimle bayt-eşit olmalı');
    } finally { await fs.remove(kok2); }
  } finally {
    await fs.remove(dizin);
    await fs.remove(kok);
  }
});

test('ENTEGRASYON: klasoruDonustur tavan aşılınca budama tetiklenir ve log basar', async () => {
  const dizin = await gecici();
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'sayfa-webp-klasor-budama-'));
  try {
    // Tavanı neredeyse sıfıra ayarlıyoruz — yazılan HERHANGİ bir bayt bile
    // tavanı aşacak, budama tetiklenmeli (girdi çok küçükse bile >0 bayt > ~0).
    const onbellek = { acik: true, dizin, tavanGb: 1e-12 };
    const p1 = mod1(await pngUret(300, 300));
    await fs.outputFile(path.join(kok, 'assets/1/pages/1.png'), p1);

    const gunlukler = [];
    await klasoruDonustur(kok, { onbellek, log: (s) => gunlukler.push(s) });
    // Budama günlüğü YALNIZ yazma olduysa VE tavan aşıldıysa basılır; burada ikisi de doğru.
    assert.ok(gunlukler.some((s) => s.startsWith('[webp-onbellek] tavan aşıldı')));
  } finally {
    await fs.remove(dizin);
    await fs.remove(kok);
  }
});
