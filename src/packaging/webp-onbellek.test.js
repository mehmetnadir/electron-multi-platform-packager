'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const {
  ayarlariCoz, varsayilanDizin, surumDamgasi, anahtarHesapla, dosyaYolu,
  webpImzaGecerliMi, oku, yaz, budaGerekirse, girdileriListele,
  VARSAYILAN_TAVAN_GB, MARKER_OZGUN, MARKER_WEBP,
} = require('./webp-onbellek');

const gecici = () => fs.mkdtemp(path.join(os.tmpdir(), 'webp-onbellek-test-'));

// Sahte WebP baytı: RIFF + boyut(4) + WEBP + gövde. Gerçek sharp çıktısı değil,
// yalnız imza kontrolünü sınamak için — modülün geri kalanı imzaya bakar,
// içeriğin gerçek bir görüntü olup olmadığına değil.
function sahteWebp(govde = Buffer.from('gövde', 'utf8')) {
  const boyut = Buffer.alloc(4);
  boyut.writeUInt32LE(4 + govde.length, 0);
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), boyut, Buffer.from('WEBP', 'ascii'), govde]);
}

/** mod1 ile aynı involutif dönüşüm (sayfa-webp.js'ten bağımsız, testte kopya). */
function mod1Test(buf, n = 100) {
  const out = Buffer.from(buf);
  const sinir = Math.min(n, out.length);
  for (let i = 0; i < sinir; i++) out[i] = (256 - out[i]) & 0xff;
  return out;
}

test('ayarlariCoz: env yoksa varsayılan dizin + açık + tavan 30', () => {
  const a = ayarlariCoz({});
  assert.strictEqual(a.acik, true);
  assert.strictEqual(a.dizin, varsayilanDizin());
  assert.strictEqual(a.tavanGb, VARSAYILAN_TAVAN_GB);
});

test('ayarlariCoz: EMPP_WEBP_ONBELLEK=0 tamamen kapatır', () => {
  const a = ayarlariCoz({ EMPP_WEBP_ONBELLEK: '0' });
  assert.strictEqual(a.acik, false);
  assert.strictEqual(a.dizin, null);
});

test('ayarlariCoz: özel dizin ve tavanGb env ile geçersiz kılınabilir', () => {
  const a = ayarlariCoz({ EMPP_WEBP_ONBELLEK: '/tmp/ozel-dizin', EMPP_WEBP_ONBELLEK_GB: '5' });
  assert.strictEqual(a.acik, true);
  assert.strictEqual(a.dizin, '/tmp/ozel-dizin');
  assert.strictEqual(a.tavanGb, 5);
});

test('surumDamgasi: gerçek sharp paketinden sürüm okur, dosya-adı güvenli', () => {
  const d = surumDamgasi();
  assert.match(d, /^s[\w.]+-v[\w.]+-k\d+$/);
  assert.doesNotMatch(d, /[^a-zA-Z0-9._-]/);
});

test('anahtarHesapla: aynı bayt + aynı kip → aynı anahtar (deterministik)', () => {
  const buf = Buffer.from('ayni-icerik');
  assert.strictEqual(anahtarHesapla(buf, 'kayipsiz'), anahtarHesapla(buf, 'kayipsiz'));
});

test('anahtarHesapla: farklı girdi baytı farklı anahtar üretir', () => {
  const a = anahtarHesapla(Buffer.from('birinci'), 'kayipsiz');
  const b = anahtarHesapla(Buffer.from('ikinci'), 'kayipsiz');
  assert.notStrictEqual(a, b);
});

test('KRİTİK (mutasyon: kipi anahtardan çıkarma): aynı bayt, farklı kip → farklı anahtar', () => {
  const buf = Buffer.from('ayni-bayt');
  const a = anahtarHesapla(buf, 'kayipsiz');
  const b = anahtarHesapla(buf, 'yakin');
  const c = anahtarHesapla(buf, 'kayipli');
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a, c);
  assert.notStrictEqual(b, c);
});

test('dosyaYolu: <dizin>/<anahtarın ilk 2 karakteri>/<anahtar>', () => {
  const anahtar = 'abcdef123-kayipsiz-s1-v1-k1';
  assert.strictEqual(dosyaYolu('/onbellek', anahtar), path.join('/onbellek', 'ab', anahtar));
});

test('webpImzaGecerliMi: gerçek RIFF/WEBP imzasını tanır, rastgele veriyi reddeder', () => {
  assert.strictEqual(webpImzaGecerliMi(sahteWebp()), true);
  assert.strictEqual(webpImzaGecerliMi(Buffer.from('rastgele veri, imza yok')), false);
  assert.strictEqual(webpImzaGecerliMi(Buffer.alloc(0)), false);
  assert.strictEqual(webpImzaGecerliMi(null), false);
});

test('oku: var olmayan anahtar için null döner (ıska)', async () => {
  const dizin = await gecici();
  try {
    const r = await oku(dizin, 'hic-yok-anahtar');
    assert.strictEqual(r, null);
  } finally { await fs.remove(dizin); }
});

test('yaz → oku round-trip: webp payload bayt-eşit geri döner', async () => {
  const dizin = await gecici();
  try {
    const anahtar = anahtarHesapla(Buffer.from('sayfa-1'), 'kayipsiz');
    const payload = sahteWebp(Buffer.from('sayfa-1-webp-ciktisi'));
    await yaz(dizin, anahtar, { tur: 'webp', cikti: payload });
    const r = await oku(dizin, anahtar, {});
    assert.ok(r);
    assert.strictEqual(r.tur, 'webp');
    assert.deepStrictEqual(r.cikti, payload, 'geri okunan çıktı bayt-eşit olmalı');
  } finally { await fs.remove(dizin); }
});

test('yaz → oku round-trip: şifreli (mod1) payload, sifreliMi:true ile doğrulanır', async () => {
  const dizin = await gecici();
  try {
    const anahtar = anahtarHesapla(Buffer.from('sayfa-sifreli'), 'kayipsiz');
    const duzWebp = sahteWebp(Buffer.from('sifreli-sayfa-webp'));
    const sifreliWebp = mod1Test(duzWebp);
    await yaz(dizin, anahtar, { tur: 'webp', cikti: sifreliWebp });

    // sifreliMi verilmezse (yanlış çağrı) düz imza aranır → payload şifreli
    // olduğundan bulunamaz, bozuk sayılır.
    const yanlisCagrı = await oku(dizin, anahtar, { sifreliMi: false });
    assert.strictEqual(yanlisCagrı, null, 'şifreli payload sifreliMi olmadan geçersiz sayılmalı');

    const r = await oku(dizin, anahtar, { sifreliMi: true, mod1Fn: mod1Test });
    assert.ok(r);
    assert.deepStrictEqual(r.cikti, sifreliWebp);
  } finally { await fs.remove(dizin); }
});

test('yaz → oku round-trip: "özgün" kararı (MARKER_OZGUN) payload olmadan da geçerli', async () => {
  const dizin = await gecici();
  try {
    const anahtar = anahtarHesapla(Buffer.from('kucuk-resim'), 'kayipsiz');
    await yaz(dizin, anahtar, { tur: 'ozgun' });
    const r = await oku(dizin, anahtar, {});
    assert.deepStrictEqual(r, { tur: 'ozgun' });

    const yol = dosyaYolu(dizin, anahtar);
    const ham = await fs.readFile(yol);
    assert.strictEqual(ham.length, 1, 'özgün kararı yalnız 1 baytlık marker olmalı — payload YOK');
    assert.strictEqual(ham[0], MARKER_OZGUN);
  } finally { await fs.remove(dizin); }
});

test('KRİTİK (mutasyon: doğrulama satırını kaldırma): boş dosya bozuk sayılır, null döner', async () => {
  const dizin = await gecici();
  try {
    const anahtar = anahtarHesapla(Buffer.from('bos-dosya'), 'kayipsiz');
    const yol = dosyaYolu(dizin, anahtar);
    await fs.ensureDir(path.dirname(yol));
    await fs.writeFile(yol, Buffer.alloc(0));
    const r = await oku(dizin, anahtar, {});
    assert.strictEqual(r, null, 'boyut 0 → bozuk → null (yeniden çevrilecek)');
  } finally { await fs.remove(dizin); }
});

test('KRİTİK (mutasyon: doğrulama satırını kaldırma): WebP imzası olmayan gövde bozuk sayılır', async () => {
  const dizin = await gecici();
  try {
    const anahtar = anahtarHesapla(Buffer.from('bozuk-govde'), 'kayipsiz');
    const yol = dosyaYolu(dizin, anahtar);
    await fs.ensureDir(path.dirname(yol));
    // MARKER_WEBP + rastgele/eksik veri (RIFF/WEBP imzası YOK — diskte yarım kalmış gibi)
    await fs.writeFile(yol, Buffer.concat([Buffer.from([MARKER_WEBP]), Buffer.from('yarim-kalmis-veri')]));
    const r = await oku(dizin, anahtar, {});
    assert.strictEqual(r, null, 'WebP imzası yoksa bozuk sayılmalı, asla geçerli döndürülmemeli');
  } finally { await fs.remove(dizin); }
});

test('oku: bilinmeyen marker bayt bozuk sayılır', async () => {
  const dizin = await gecici();
  try {
    const anahtar = anahtarHesapla(Buffer.from('bilinmeyen-marker'), 'kayipsiz');
    const yol = dosyaYolu(dizin, anahtar);
    await fs.ensureDir(path.dirname(yol));
    await fs.writeFile(yol, Buffer.from([0xff, 1, 2, 3]));
    const r = await oku(dizin, anahtar, {});
    assert.strictEqual(r, null);
  } finally { await fs.remove(dizin); }
});

test('yaz: bozuk önbellek dosyasının üzerine yeniden yazılabilir (overwrite)', async () => {
  const dizin = await gecici();
  try {
    const anahtar = anahtarHesapla(Buffer.from('yeniden-yaz'), 'kayipsiz');
    const yol = dosyaYolu(dizin, anahtar);
    await fs.ensureDir(path.dirname(yol));
    await fs.writeFile(yol, Buffer.from('bozuk-eski-icerik'));

    const yeniPayload = sahteWebp(Buffer.from('yeni-gecerli-webp'));
    await yaz(dizin, anahtar, { tur: 'webp', cikti: yeniPayload });

    const r = await oku(dizin, anahtar, {});
    assert.ok(r);
    assert.deepStrictEqual(r.cikti, yeniPayload, 'eski bozuk içerik tamamen değiştirilmiş olmalı');
  } finally { await fs.remove(dizin); }
});

test('eşzamanlı iki yazıcı aynı anahtara yazınca sonuç asla bozuk kalmaz', async () => {
  const dizin = await gecici();
  try {
    const anahtar = anahtarHesapla(Buffer.from('yaris-anahtari'), 'kayipsiz');
    const a = sahteWebp(Buffer.from('yazici-A-verisi'));
    const b = sahteWebp(Buffer.from('yazici-B-verisi-farkli-uzunlukta'));

    // Aynı anda iki bağımsız yazma — geçici ad + rename atomikliği çakışmayı önlemeli.
    await Promise.all([
      yaz(dizin, anahtar, { tur: 'webp', cikti: a }),
      yaz(dizin, anahtar, { tur: 'webp', cikti: b }),
    ]);

    const r = await oku(dizin, anahtar, {});
    assert.ok(r, 'sonuç ASLA null (bozuk) olmamalı — iki yazıcıdan biri kazanmış olmalı');
    const aKazandi = r.cikti.equals(a);
    const bKazandi = r.cikti.equals(b);
    assert.ok(aKazandi || bKazandi, 'sonuç iki geçerli yazımdan TAM biri olmalı, karışık/yarım değil');

    // Yarım kalan .tmp- dosyası kalmamalı
    const altDizin = path.dirname(dosyaYolu(dizin, anahtar));
    const kalanlar = await fs.readdir(altDizin);
    assert.ok(!kalanlar.some((ad) => ad.includes('.tmp-')), 'geçici dosya artığı kalmamalı');
  } finally { await fs.remove(dizin); }
});

test('girdileriListele: yarım (.tmp-) dosyaları saymaz, alt dizin olmayan dosyaları görmezden gelir', async () => {
  const dizin = await gecici();
  try {
    const anahtar1 = anahtarHesapla(Buffer.from('liste-1'), 'kayipsiz');
    await yaz(dizin, anahtar1, { tur: 'webp', cikti: sahteWebp() });
    // kök dizine yarım bir .tmp- dosyası bırak (girdileriListele bunu ATLAMALI)
    const altDizin = path.dirname(dosyaYolu(dizin, anahtar1));
    await fs.writeFile(path.join(altDizin, 'baska-bir-anahtar.tmp-1234'), 'yarim');

    const liste = await girdileriListele(dizin);
    assert.strictEqual(liste.length, 1);
    assert.ok(liste[0].yol.endsWith(anahtar1));
  } finally { await fs.remove(dizin); }
});

test('budaGerekirse: tavan aşılınca en eski ERİŞİLEN girdiden başlayarak buda', async () => {
  const dizin = await gecici();
  try {
    // 3 girdi, her biri ~20 bayt payload; tavanı çok küçük tutup (bayt cinsinden
    // birkaç KB) kesin aşılmasını sağlıyoruz.
    const anahtarEski = anahtarHesapla(Buffer.from('en-eski'), 'kayipsiz');
    const anahtarOrta = anahtarHesapla(Buffer.from('orta'), 'kayipsiz');
    const anahtarYeni = anahtarHesapla(Buffer.from('en-yeni'), 'kayipsiz');

    await yaz(dizin, anahtarEski, { tur: 'webp', cikti: sahteWebp(Buffer.alloc(500, 1)) });
    // mtime'ların kesin sıralı olması için küçük gecikme yerine elle geçmişe ayarla
    const yolEski = dosyaYolu(dizin, anahtarEski);
    const tBase = Date.now() / 1000;
    await fs.utimes(yolEski, tBase - 300, tBase - 300);

    await yaz(dizin, anahtarOrta, { tur: 'webp', cikti: sahteWebp(Buffer.alloc(500, 2)) });
    const yolOrta = dosyaYolu(dizin, anahtarOrta);
    await fs.utimes(yolOrta, tBase - 150, tBase - 150);

    await yaz(dizin, anahtarYeni, { tur: 'webp', cikti: sahteWebp(Buffer.alloc(500, 3)) });
    const yolYeni = dosyaYolu(dizin, anahtarYeni);
    await fs.utimes(yolYeni, tBase, tBase);

    const oncekiToplam = (await girdileriListele(dizin)).reduce((a, g) => a + g.boyut, 0);
    // Tavanı toplamın ortası civarına ayarla: en az en-eski silinmeli, en-yeni kalmalı.
    const tavanGb = (oncekiToplam * 0.6) / 1024 ** 3;

    const sonuc = await budaGerekirse(dizin, tavanGb);
    assert.ok(sonuc.silinen >= 1, 'en az bir girdi silinmiş olmalı');
    assert.ok(sonuc.sonrakiToplamBayt <= tavanGb * 1024 ** 3);

    assert.strictEqual(await fs.pathExists(yolEski), false, 'en eski ERİŞİLEN ilk silinmeli');
    assert.strictEqual(await fs.pathExists(yolYeni), true, 'en yeni erişilen son silinecek/kalmalı');
  } finally { await fs.remove(dizin); }
});

test('budaGerekirse: tavan aşılmamışsa hiçbir şey silmez', async () => {
  const dizin = await gecici();
  try {
    const anahtar = anahtarHesapla(Buffer.from('tek-girdi'), 'kayipsiz');
    await yaz(dizin, anahtar, { tur: 'webp', cikti: sahteWebp() });
    const sonuc = await budaGerekirse(dizin, VARSAYILAN_TAVAN_GB); // 30 GB tavan, birkaç bayt var
    assert.strictEqual(sonuc.silinen, 0);
    assert.strictEqual(await fs.pathExists(dosyaYolu(dizin, anahtar)), true);
  } finally { await fs.remove(dizin); }
});

test('oku: mtime "erişildi" olarak tazelenir (budama LRU sırası için)', async () => {
  const dizin = await gecici();
  try {
    const anahtar = anahtarHesapla(Buffer.from('tazelenen'), 'kayipsiz');
    await yaz(dizin, anahtar, { tur: 'webp', cikti: sahteWebp() });
    const yol = dosyaYolu(dizin, anahtar);
    const eski = Date.now() / 1000 - 10000;
    await fs.utimes(yol, eski, eski);

    await oku(dizin, anahtar, {});
    // utimes senkron değil (en-iyi-çaba callback) — kısa bir tik bekle
    await new Promise((r) => setTimeout(r, 50));

    const st = await fs.stat(yol);
    assert.ok(st.mtimeMs / 1000 > eski + 1000, 'okuma sonrası mtime güncellenmiş olmalı');
  } finally { await fs.remove(dizin); }
});
