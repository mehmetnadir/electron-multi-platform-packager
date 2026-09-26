'use strict';

/**
 * HARF KAPISI testleri.
 *
 * DİKKAT — bu testler macOS'ta da koşar ve macOS harf DUYARSIZ'dır. Bu yüzden
 * hiçbir test `fs.existsSync` ile "çözülüyor mu" diye SORMAZ; modül de sormaz.
 * Ağaç bir kez `os.walk` ile indekslenir ve karşılaştırma YAZILIMDA, harf duyarlı
 * yapılır. Test ağacı da bu yüzden harf çakışması İÇERMEZ (macOS'ta kurulamazdı);
 * çakışma sınıfı `harfCakismalari` üzerinden sentetik indeksle sınanır.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const k = require('./harf-kapisi');

async function agacKur() {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'harf-kapisi-'));
  await fs.mkdir(path.join(kok, 'core'), { recursive: true });
  await fs.mkdir(path.join(kok, 'book1', 'core'), { recursive: true });
  await fs.mkdir(path.join(kok, 'assets2'), { recursive: true });
  await fs.writeFile(path.join(kok, 'core', 'kurumlogo.png'), 'LOGO', 'utf8');
  await fs.writeFile(path.join(kok, 'core', 'tam.png'), 'TAM', 'utf8');
  await fs.writeFile(path.join(kok, 'book1', 'core', 'kurumlogo.png'), 'LOGO1', 'utf8');
  await fs.writeFile(path.join(kok, 'assets2', 'Arkaplan.jpg'), 'BG', 'utf8');
  await fs.writeFile(path.join(kok, 'stil.css'), 'x', 'utf8');
  return kok;
}

// ─────────────────────────── 1. TAM EŞLEŞME ───────────────────────────
test('tam eşleşme → TAM, onarım yok', async () => {
  const kok = await agacKur();
  await fs.writeFile(path.join(kok, 'index.html'),
    '<img src="./core/tam.png">', 'utf8');
  const s = await k.tara(kok);
  assert.strictEqual(s.harf.length, 0, 'tam eşleşme harf farkı sayılmamalı');
  assert.strictEqual(s.yok.length, 0);
  assert.ok(s.tam >= 1);
});

// ─────────────────────── 2. YALNIZ HARF FARKI (asıl arıza) ───────────────────────
test('yalnız harf farkı → HARF, disk adı önerilir ve onarılır', async () => {
  const kok = await agacKur();
  const dosya = path.join(kok, 'index.html');
  await fs.writeFile(dosya, '<img src="./core/kurumLogo.png" style="display:none">', 'utf8');
  const s = await k.tara(kok);
  assert.strictEqual(s.harf.length, 1);
  assert.strictEqual(s.harf[0].referans, './core/kurumLogo.png');
  assert.strictEqual(s.harf[0].hedef, 'core/kurumlogo.png');

  const r = await k.paketeUygula(kok, { env: {} });
  assert.strictEqual(r.onarilan, 1);
  const yeni = await fs.readFile(dosya, 'utf8');
  assert.ok(yeni.includes('./core/kurumlogo.png'), 'referans onarılmalı');
  assert.ok(!yeni.includes('kurumLogo.png'), 'eski harf kalmamalı');
  assert.ok(yeni.includes('display:none'), 'kalan HTML korunmalı');

  const s2 = await k.tara(kok);
  assert.strictEqual(s2.harf.length, 0, 'onarımdan sonra temiz olmalı');
});

// ────────────────────────── 3. HİÇ OLMAYAN DOSYA ──────────────────────────
test('hiç olmayan dosya → YOK; kapı DOKUNMAZ (kör yeniden adlandırma yasak)', async () => {
  const kok = await agacKur();
  const dosya = path.join(kok, 'index.html');
  await fs.writeFile(dosya, '<img src="player/Tema1/ileri.png">', 'utf8');
  const s = await k.tara(kok);
  assert.strictEqual(s.harf.length, 0);
  assert.strictEqual(s.yok.length, 1);
  assert.strictEqual(s.yok[0].referans, 'player/Tema1/ileri.png');

  const once = await fs.readFile(dosya, 'utf8');
  await k.paketeUygula(kok, { env: {} });
  assert.strictEqual(await fs.readFile(dosya, 'utf8'), once, 'YOK sınıfı yazılmamalı');
});

// ─────────────────────── 4. ALT DİZİNDE HARF FARKI ───────────────────────
test('alt dizinde harf farkı → göreli yol doğru hesaplanır', async () => {
  const kok = await agacKur();
  const dosya = path.join(kok, 'book1', 'index.html');
  await fs.writeFile(dosya, '<img src="./core/kurumLogo.png">', 'utf8');
  const s = await k.tara(kok);
  assert.strictEqual(s.harf.length, 1);
  assert.strictEqual(s.harf[0].dosya, 'book1/index.html');
  assert.strictEqual(s.harf[0].hedef, 'book1/core/kurumlogo.png',
    'kök değil, KAYNAK DOSYAYA göre çözülmeli');

  await k.paketeUygula(kok, { env: {} });
  const yeni = await fs.readFile(dosya, 'utf8');
  assert.ok(yeni.includes('./core/kurumlogo.png'),
    `göreli yol korunmalı, alınan: ${yeni}`);
});

test('dizin adı da harf farklıysa yakalanır', async () => {
  const kok = await agacKur();
  const dosya = path.join(kok, 'index.html');
  await fs.writeFile(dosya, '<img src="./Core/kurumlogo.png">', 'utf8');
  const s = await k.tara(kok);
  assert.strictEqual(s.harf.length, 1);
  assert.strictEqual(s.harf[0].hedef, 'core/kurumlogo.png');
});

// ─────────────────── 5. SORGU / FRAGMENT İÇEREN REFERANS ───────────────────
test('sorgu ve fragment: yol kısmı denetlenir, kuyruk KORUNUR', async () => {
  const kok = await agacKur();
  const dosya = path.join(kok, 'index.html');
  await fs.writeFile(dosya,
    '<img src="./core/kurumLogo.png?v=2"><img src="./core/kurumLogo.png#frag">', 'utf8');
  const s = await k.tara(kok);
  assert.strictEqual(s.harf.length, 2, 'ikisi de harf farkı sayılmalı');

  await k.paketeUygula(kok, { env: {} });
  const yeni = await fs.readFile(dosya, 'utf8');
  assert.ok(yeni.includes('./core/kurumlogo.png?v=2'), `?v=2 korunmalı: ${yeni}`);
  assert.ok(yeni.includes('./core/kurumlogo.png#frag'), `#frag korunmalı: ${yeni}`);
});

test('yalnız fragment (#bolum) denetlenmez', () => {
  assert.strictEqual(k.denetlenirMi('#bolum'), false);
});

// ────────────────────────── 6. DIŞ URL — DENETLENMEZ ──────────────────────────
test('dış URL / data: / mutlak yol denetlenmez', async () => {
  const kok = await agacKur();
  await fs.writeFile(path.join(kok, 'index.html'), [
    '<img src="https://cdn.example.com/core/kurumLogo.png">',
    '<img src="http://x/KURUMLOGO.PNG">',
    '<img src="//cdn.x/core/kurumLogo.png">',
    '<img src="data:image/png;base64,AAAA">',
    '<img src="/core/kurumLogo.png">',
    '<a href="mailto:a@b.c">m</a>',
    '<a href="javascript:void(0)">j</a>',
  ].join('\n'), 'utf8');
  const s = await k.tara(kok);
  assert.strictEqual(s.harf.length, 0, 'dış referanslar harf farkı üretmemeli');
  assert.strictEqual(s.yok.length, 0, 'dış referanslar YOK da üretmemeli');
  assert.strictEqual(s.atlandi, 7);
});

// ────────────────────────── CSS url() ──────────────────────────
test('CSS url() referansı da denetlenir ve onarılır', async () => {
  const kok = await agacKur();
  const dosya = path.join(kok, 'stil.css');
  await fs.writeFile(dosya, '.a{background:url("assets2/arkaplan.jpg")}', 'utf8');
  const s = await k.tara(kok);
  assert.strictEqual(s.harf.length, 1);
  assert.strictEqual(s.harf[0].hedef, 'assets2/Arkaplan.jpg');
  await k.paketeUygula(kok, { env: {} });
  assert.ok((await fs.readFile(dosya, 'utf8')).includes('assets2/Arkaplan.jpg'));
});

// ────────────────────────── DİSK ÇAKIŞMASI ──────────────────────────
test('yalnız harfiyle ayrışan iki disk dosyası çakışma olarak raporlanır', () => {
  const indeks = {
    gercek: new Set(['core/kurumLogo.png', 'core/kurumlogo.png', 'core/tek.png']),
    kucuk: new Map([
      ['core/kurumlogo.png', ['core/kurumLogo.png', 'core/kurumlogo.png']],
      ['core/tek.png', ['core/tek.png']],
    ]),
  };
  const c = k.harfCakismalari(indeks);
  assert.strictEqual(c.length, 1);
  assert.deepStrictEqual(c[0].adlar, ['core/kurumLogo.png', 'core/kurumlogo.png']);
});

test('birden çok varyant varsa HARF raporlanır ama hedef ÖNERİLMEZ', () => {
  const indeks = {
    gercek: new Set(['core/kurumLogo.png', 'core/kurumlogo.png']),
    kucuk: new Map([['core/kurumlogo.png', ['core/kurumLogo.png', 'core/kurumlogo.png']]]),
  };
  const c = k.referansCozumle('index.html', './core/KURUMLOGO.png', indeks);
  assert.strictEqual(c.durum, 'HARF');
  assert.strictEqual(c.hedef, null, 'belirsizse kör onarım YASAK');
  assert.strictEqual(c.varyantlar.length, 2);
});

// ────────────────────────── MOD / ENV ──────────────────────────
test('EMPP_HARF_KAPISI modları', () => {
  assert.strictEqual(k.modOku({}), 'onar');
  assert.strictEqual(k.modOku({ EMPP_HARF_KAPISI: '0' }), 'kapali');
  assert.strictEqual(k.modOku({ EMPP_HARF_KAPISI: 'uyar' }), 'uyar');
  assert.strictEqual(k.modOku({ EMPP_HARF_KAPISI: 'dusur' }), 'dusur');
  assert.strictEqual(k.acikMi({ EMPP_HARF_KAPISI: '0' }), false);
  assert.strictEqual(k.acikMi({}), true);
});

test('mod=uyar → rapor var, dosya DEĞİŞMEZ', async () => {
  const kok = await agacKur();
  const dosya = path.join(kok, 'index.html');
  await fs.writeFile(dosya, '<img src="./core/kurumLogo.png">', 'utf8');
  const once = await fs.readFile(dosya, 'utf8');
  const r = await k.paketeUygula(kok, { env: { EMPP_HARF_KAPISI: 'uyar' } });
  assert.strictEqual(r.onarilan, 0);
  assert.strictEqual(r.sonuc.harf.length, 1);
  assert.strictEqual(await fs.readFile(dosya, 'utf8'), once);
});

test('mod=dusur → uyuşmazlıkta hata fırlatır', async () => {
  const kok = await agacKur();
  await fs.writeFile(path.join(kok, 'index.html'), '<img src="./core/kurumLogo.png">', 'utf8');
  await assert.rejects(
    () => k.paketeUygula(kok, { env: { EMPP_HARF_KAPISI: 'dusur' } }),
    (e) => e.harfSonucu && e.harfSonucu.harf.length === 1
  );
});

test('mod=kapali → hiç taramaz', async () => {
  const kok = await agacKur();
  const dosya = path.join(kok, 'index.html');
  await fs.writeFile(dosya, '<img src="./core/kurumLogo.png">', 'utf8');
  const r = await k.paketeUygula(kok, { env: { EMPP_HARF_KAPISI: '0' } });
  assert.strictEqual(r.uygulandi, false);
  assert.strictEqual(r.sonuc, null);
});

// ────────────────────────── ÇAĞRI NOKTASI SÖZLEŞMESİ ──────────────────────────
test('packagingService harf kapısını ithal edip çağırıyor (fan-out sapması bekçisi)', async () => {
  const kaynak = await fs.readFile(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.ok(kaynak.includes("require('./harf-kapisi')"), 'modül ithal edilmeli');
  assert.ok(kaynak.includes('harfKapisi.paketeUygula('), 'çağrı noktası olmalı');
  const cagriIdx = kaynak.indexOf('harfKapisi.paketeUygula(');
  const fanOutIdx = kaynak.indexOf('// Her platform için paketleme');
  assert.ok(cagriIdx > 0 && fanOutIdx > cagriIdx,
    'kapı platform fan-out’undan ÖNCE koşmalı (tek nokta)');
});

// ────────────────────────── YARDIMCI BİRİMLER ──────────────────────────
test('yolaIndirge: sorgu, fragment, yüzde kodlaması', () => {
  assert.strictEqual(k.yolaIndirge('a/b.png?v=2'), 'a/b.png');
  assert.strictEqual(k.yolaIndirge('a/b.png#x'), 'a/b.png');
  assert.strictEqual(k.yolaIndirge('a/b%20c.png'), 'a/b c.png');
  assert.strictEqual(k.yolaIndirge('a/%zz.png'), 'a/%zz.png', 'bozuk kodlama ham dönmeli');
});

test('referanslariCikar: HTML src/href + gömülü style url()', () => {
  const r = k.referanslariCikar(
    '<link href="a.css"><img src="b.png"><style>.x{background:url(c.png)}</style>', '.html');
  assert.deepStrictEqual(r.sort(), ['a.css', 'b.png', 'c.png']);
});

test('ağaç dışına çıkan referans (../..) DISARI sayılır, onarılmaz', () => {
  const indeks = { gercek: new Set(['index.html']), kucuk: new Map([['index.html', ['index.html']]]) };
  const c = k.referansCozumle('index.html', '../../gizli/x.png', indeks);
  assert.strictEqual(c.durum, 'DISARI');
});

/* ══════════════════════ ZIP ÇAKIŞMA KAPISI TESTLERİ ══════════════════════
 *
 * Bu testler macOS'ta da koşar. Harf çakışması DOSYA SİSTEMİNDE kurulamaz
 * (macOS harf duyarsız), ama zip GİRDİSİ olarak kurulabilir — çakışma zip'in
 * merkezî dizininde yaşar, diskte değil. Sınıfın ölçüldüğü yer tam olarak orası.
 *
 * Zip'ler stdlib ile, SIKIŞTIRMASIZ (stored) yazılır: `archiver` bir üretim
 * bağımlılığıdır, kapı testinin ona yaslanması kapıyı bağımlılığa bağlardı.
 */

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

/** Minimal "stored" zip yazıcı: { 'yol/ad': 'içerik' } → dosya. */
async function zipYaz(yol, girdiler) {
  const yerel = [];
  const merkez = [];
  let ofset = 0;
  const adlar = Object.keys(girdiler);
  for (const ad of adlar) {
    const adB = Buffer.from(ad, 'utf8');
    const veri = Buffer.from(girdiler[ad], 'utf8');
    const crc = crc32(veri);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(veri.length, 18);
    lfh.writeUInt32LE(veri.length, 22);
    lfh.writeUInt16LE(adB.length, 26);
    yerel.push(lfh, adB, veri);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(veri.length, 20);
    cdh.writeUInt32LE(veri.length, 24);
    cdh.writeUInt16LE(adB.length, 28);
    cdh.writeUInt32LE(ofset, 42);
    merkez.push(cdh, adB);
    ofset += lfh.length + adB.length + veri.length;
  }
  const cdBuf = Buffer.concat(merkez);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(adlar.length, 8);
  eocd.writeUInt16LE(adlar.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(ofset, 16);
  await fs.writeFile(yol, Buffer.concat([...yerel, cdBuf, eocd]));
}

/** Eski İmpark hattının AppRun'ı: core.zip + book.zip AYNI hedefe. */
const APPRUN_IKI_ZIP = [
  '#!/bin/bash',
  'SELF=$(readlink -f "$0")',
  'HERE=${SELF%/*}',
  'basepath=~/DijiTap/kurum',
  'zkitapPath="$basepath/KITAP"',
  'assetsPath="$zkitapPath/resources/app/build"',
  'coreZipPath="$HERE/core.zip"',
  'bookZipPath="$HERE/book.zip"',
  'unzip_and_show_progress $coreZipPath $assetsPath "içerik"',
  'unzip_and_show_progress $bookZipPath $assetsPath "kitap"',
  '',
].join('\n');

/** Bu deponun bugünkü hattı: tek zip. */
const APPRUN_TEK_ZIP = [
  '#!/bin/bash',
  'SELF=$(readlink -f "$0")',
  'HERE=${SELF%/*}',
  'appPath=~/DijiTap/kurum/KITAP',
  'unzip_and_show_progress "$HERE/../app.zip" "$appPath" "kurulum"',
  '',
].join('\n');

async function appDirKur(appRun, zipler) {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-kapisi-'));
  await fs.writeFile(path.join(kok, 'AppRun'), appRun, 'utf8');
  for (const [ad, girdiler] of Object.entries(zipler)) {
    if (girdiler === null) {
      // Kasten BOZUK zip: EOCD imzası olmayan çöp. 22 BAYTTAN UZUN olmalı —
      // kısa dosya "EOCD sığmaz" dalında elenir ve EOCD arama kodu hiç sınanmazdı
      // (M6 mutantı tam bu boşluktan sağ çıkmıştı: bozuk zip sessizce BOŞ zip
      // sayılıyordu, yani "ölçülemedi" → "temiz" yalanı).
      await fs.writeFile(path.join(kok, ad), Buffer.alloc(4096, 0x41), null);
    } else {
      await zipYaz(path.join(kok, ad), girdiler);
    }
  }
  return kok;
}

// ─────────────── 1. KESİŞİM BOŞ ───────────────
test('zip kapısı: kesişim BOŞ → temiz, hiçbir modda düşürmez', async () => {
  const kok = await appDirKur(APPRUN_IKI_ZIP, {
    'core.zip': { 'core/a.png': 'A', 'index.html': 'I' },
    'book.zip': { 'book/b.png': 'B', 'book/c.png': 'C' },
  });
  const r = await k.zipKapisi(kok, { env: { EMPP_ZIP_KAPISI: 'dusur' } });
  assert.strictEqual(r.gruplar.length, 1, 'aynı hedefe iki zip → tek grup');
  const rapor = r.gruplar[0].rapor;
  assert.strictEqual(rapor.tamSayi, 0);
  assert.strictEqual(rapor.harfSayi, 0);
  assert.strictEqual(rapor.temizMi, true);
  assert.strictEqual(r.toplamHarf, 0);
});

// ─────────────── 2. KESİŞİM VAR + İÇERİK AYNI (zararsız) ───────────────
test('zip kapısı: kesişim var ama içerik AYNI → zararsız, temiz sayılır', async () => {
  const kok = await appDirKur(APPRUN_IKI_ZIP, {
    'core.zip': { 'core/ortak.png': 'AYNI', 'core/yalniz-core.png': 'X' },
    'book.zip': { 'core/ortak.png': 'AYNI', 'book/x.png': 'Y' },
  });
  const r = await k.zipKapisi(kok, { env: { EMPP_ZIP_KAPISI: 'dusur' } });
  const rapor = r.gruplar[0].rapor;
  assert.strictEqual(rapor.tamSayi, 1, 'tam yol kesişimi sayılmalı');
  assert.strictEqual(rapor.icerikAyniSayi, 1);
  assert.strictEqual(rapor.icerikFarkliSayi, 0);
  assert.strictEqual(rapor.temizMi, true, 'aynı bayt çakışması arıza değildir');
});

// ─────────────── 3. KESİŞİM VAR + İÇERİK FARKLI (sıraya bağlı) ───────────────
test('zip kapısı: kesişim var + içerik FARKLI → rapor edilir, kazanan SON zip', async () => {
  const kok = await appDirKur(APPRUN_IKI_ZIP, {
    'core.zip': { 'version.txt': '1.11.3', 'index.html': 'ESKI' },
    'book.zip': { 'version.txt': '1.11.5', 'index.html': 'YENI' },
  });
  const r = await k.zipKapisi(kok, { env: { EMPP_ZIP_KAPISI: 'dusur' } });
  const rapor = r.gruplar[0].rapor;
  assert.strictEqual(rapor.tamSayi, 2);
  assert.strictEqual(rapor.icerikFarkliSayi, 2, 'iki yolda da içerik farklı');
  for (const t of rapor.icerikFarkli) {
    assert.strictEqual(t.kazanan, 'book.zip', 'son açılan kazanır (unzip -o)');
  }
  // ÖLÇÜLDÜ: sıra doğru (book daha yeni) → bu sınıf DÜŞÜRMEZ, raporlanır.
  assert.strictEqual(rapor.temizMi, true);
  assert.strictEqual(r.toplamFarkli, 2);
});

// ─────────────── 4. YALNIZ HARF FARKIYLA ÇAKIŞMA (asıl arıza) ───────────────
test('zip kapısı: yalnız harf farkıyla çakışma → ARIZA, temiz DEĞİL', async () => {
  const kok = await appDirKur(APPRUN_IKI_ZIP, {
    'core.zip': { 'core/kurumLogo.png': 'BUYUK-L-30718' },
    'book.zip': { 'core/kurumlogo.png': 'kucuk-l-13642' },
  });
  const r = await k.zipKapisi(kok, { env: { EMPP_ZIP_KAPISI: 'uyar' } });
  const rapor = r.gruplar[0].rapor;
  assert.strictEqual(rapor.tamSayi, 0, 'tam yol olarak çakışmıyorlar — sınıf BU yüzden sinsi');
  assert.strictEqual(rapor.harfSayi, 1);
  assert.deepStrictEqual(rapor.harf[0].adlar, ['core/kurumLogo.png', 'core/kurumlogo.png']);
  assert.strictEqual(rapor.temizMi, false, 'harf çakışması asla temiz sayılmaz');
});

// ─────────────── 5. ZIP OKUNAMADI (ölçülemedi ≠ temiz) ───────────────
test('zip kapısı: zip okunamadı → ÖLÇÜLEMEDİ, asla "temiz" sayılmaz', async () => {
  const kok = await appDirKur(APPRUN_IKI_ZIP, {
    'core.zip': { 'core/a.png': 'A' },
    'book.zip': null, // bozuk
  });
  const r = await k.zipKapisi(kok, { env: { EMPP_ZIP_KAPISI: 'uyar' } });
  const rapor = r.gruplar[0].rapor;
  assert.strictEqual(rapor.okunamayan.length, 1);
  assert.match(rapor.okunamayan[0].hata, /zip okunamadı/);
  assert.strictEqual(rapor.harfSayi, 0, 'ölçülemeyen zip sahte çakışma üretmemeli');
  assert.strictEqual(rapor.temizMi, false, 'ölçülemedi = temiz DEĞİL');
  assert.strictEqual(r.toplamOkunamayan, 1);
});

test('zip kapısı: hiç olmayan zip de ÖLÇÜLEMEDİ sayılır (sessizce atlanmaz)', async () => {
  const kok = await appDirKur(APPRUN_IKI_ZIP, { 'core.zip': { 'a.png': 'A' } });
  const r = await k.zipKapisi(kok, { env: { EMPP_ZIP_KAPISI: 'uyar' } });
  assert.strictEqual(r.toplamOkunamayan, 1, 'book.zip yok → ölçülemedi');
  assert.strictEqual(r.gruplar[0].rapor.temizMi, false);
});

// ─────────────── 6. ÜÇ MOD ───────────────
test('zip kapısı mod=kapali → hiç ölçmez', async () => {
  const kok = await appDirKur(APPRUN_IKI_ZIP, {
    'core.zip': { 'core/kurumLogo.png': 'A' },
    'book.zip': { 'core/kurumlogo.png': 'B' },
  });
  const r = await k.zipKapisi(kok, { env: { EMPP_ZIP_KAPISI: '0' } });
  assert.strictEqual(r.uygulandi, false);
  assert.deepStrictEqual(r.gruplar, []);
});

test('zip kapısı mod=uyar → ölçer, raporlar, DÜŞÜRMEZ', async () => {
  const kok = await appDirKur(APPRUN_IKI_ZIP, {
    'core.zip': { 'core/kurumLogo.png': 'A' },
    'book.zip': { 'core/kurumlogo.png': 'B' },
  });
  const satirlar = [];
  const r = await k.zipKapisi(kok, { env: { EMPP_ZIP_KAPISI: 'uyar' }, log: (s) => satirlar.push(s) });
  assert.strictEqual(r.uygulandi, true);
  assert.strictEqual(r.toplamHarf, 1);
  assert.ok(satirlar.some((s) => s.includes('harf çakışması')), 'rapor satırı basılmalı');
});

test('zip kapısı mod=dusur → harf çakışmasında FIRLATIR', async () => {
  const kok = await appDirKur(APPRUN_IKI_ZIP, {
    'core.zip': { 'core/kurumLogo.png': 'A' },
    'book.zip': { 'core/kurumlogo.png': 'B' },
  });
  await assert.rejects(
    () => k.zipKapisi(kok, { env: { EMPP_ZIP_KAPISI: 'dusur' } }),
    (e) => e.zipSonucu && e.zipSonucu.toplamHarf === 1
  );
});

test('zip kapısı mod=dusur → ölçülemeyen zip de FIRLATIR', async () => {
  const kok = await appDirKur(APPRUN_IKI_ZIP, {
    'core.zip': { 'core/a.png': 'A' },
    'book.zip': null,
  });
  await assert.rejects(
    () => k.zipKapisi(kok, { env: { EMPP_ZIP_KAPISI: 'dusur' } }),
    (e) => e.zipSonucu && e.zipSonucu.toplamOkunamayan === 1
  );
});

test('zipModOku: EMPP_ZIP_KAPISI yoksa EMPP_HARF_KAPISI’ndan türetilir', () => {
  assert.strictEqual(k.zipModOku({}), 'dusur', 'varsayılan düşür');
  assert.strictEqual(k.zipModOku({ EMPP_HARF_KAPISI: 'onar' }), 'dusur', 'zip onarılamaz → düşür');
  assert.strictEqual(k.zipModOku({ EMPP_HARF_KAPISI: 'uyar' }), 'uyar');
  assert.strictEqual(k.zipModOku({ EMPP_HARF_KAPISI: '0' }), 'kapali');
  assert.strictEqual(k.zipModOku({ EMPP_HARF_KAPISI: '0', EMPP_ZIP_KAPISI: 'dusur' }), 'dusur',
    'zip anahtarı önceliklidir');
});

// ─────────────── 7. PLAN AppRun'DAN OKUNUR (tahmin değil) ───────────────
test('apprunZipPlani: değişkenleri çözer, sırayı korur', () => {
  const plan = k.apprunZipPlani(APPRUN_IKI_ZIP);
  assert.strictEqual(plan.length, 2);
  assert.deepStrictEqual(plan.map((p) => p.zipAd), ['core.zip', 'book.zip']);
  assert.strictEqual(plan[0].hedef, plan[1].hedef, 'ikisi de AYNI hedefe açılıyor');
  assert.match(plan[0].hedef, /resources\/app\/build$/);
});

test('apprunZipPlani: tek zip açan AppRun’da grup oluşmaz (kapı no-op)', async () => {
  const kok = await appDirKur(APPRUN_TEK_ZIP, { 'app.zip': { 'index.html': 'I' } });
  const plan = k.apprunZipPlani(APPRUN_TEK_ZIP);
  assert.strictEqual(plan.length, 1);
  const r = await k.zipKapisi(kok, { env: { EMPP_ZIP_KAPISI: 'dusur' } });
  assert.deepStrictEqual(r.gruplar, [], 'ortak hedef yok → ölçülecek çakışma yok');
});

test('deponun kendi apprun-template.sh’i tek zip açıyor (gerileme bekçisi)', async () => {
  const sablon = await fs.readFile(path.join(__dirname, 'apprun-template.sh'), 'utf8');
  const plan = k.apprunZipPlani(sablon);
  const hedefler = new Map();
  for (const a of plan) hedefler.set(a.hedef, (hedefler.get(a.hedef) || 0) + 1);
  for (const [hedef, adet] of hedefler) {
    assert.strictEqual(adet, 1,
      `AYNI hedefe ${adet} zip açılıyor (${hedef}) — eski İmpark hattının çakışma sınıfı geri geldi`);
  }
});

// ─────────────── 8. ÇAĞRI NOKTASI SÖZLEŞMESİ ───────────────
test('zip kapısı çağrı noktası: AppRun yazıldıktan SONRA, appimagetool’dan ÖNCE', async () => {
  const kaynak = await fs.readFile(path.join(__dirname, 'packagingService.js'), 'utf8');
  const cagri = kaynak.indexOf('harfKapisi.zipKapisi(');
  assert.ok(cagri > 0, 'zipKapisi çağrılmalı');
  const appRunYaz = kaynak.indexOf("const appRunPath = path.join(extractDir, 'AppRun');");
  const repack = kaynak.indexOf('// 4. appimagetool ile yeniden paketle');
  assert.ok(appRunYaz > 0 && repack > 0, 'çıpa yorumları duruyor olmalı');
  assert.ok(cagri > appRunYaz, 'AppRun yazılmadan plan okunamaz');
  assert.ok(cagri < repack, '.impark paketlenmeden ÖNCE ölçülmeli (düşerse paket hiç doğmasın)');
});

test('zip kapısı düşüşü yutulmuyor (mod=dusur yukarı taşınır)', async () => {
  const kaynak = await fs.readFile(path.join(__dirname, 'packagingService.js'), 'utf8');
  const i = kaynak.indexOf('harfKapisi.zipKapisi(');
  const pencere = kaynak.slice(i, i + 600);
  assert.ok(pencere.includes('zipErr.zipSonucu'), 'bilinçli düşüş yeniden fırlatılmalı');
  assert.ok(/throw zipErr/.test(pencere), 'throw zipErr olmalı');
});

test('zipIndeksi: bozuk zip’in HER İKİ dalı da hata fırlatır (sessiz boş Map YOK)', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-bozuk-'));
  const kisa = path.join(kok, 'kisa.zip');
  const uzun = path.join(kok, 'uzun.zip');
  await fs.writeFile(kisa, Buffer.from('kisa'), null);            // < 22 bayt
  await fs.writeFile(uzun, Buffer.alloc(4096, 0x41), null);       // > 22 bayt, EOCD yok
  for (const [ad, yol] of [['kısa', kisa], ['uzun', uzun]]) {
    await assert.rejects(() => k.zipIndeksi(yol), (e) => {
      assert.strictEqual(e.zipOkunamadi, true, `${ad}: ölçülemedi işareti şart`);
      return true;
    }, `${ad} çöp dosya boş Map değil HATA döndürmeli`);
  }
  await assert.rejects(() => k.zipIndeksi(path.join(kok, 'yok.zip')),
    (e) => e.zipOkunamadi === true, 'olmayan dosya da ölçülemedi sayılır');
});

test('zipIndeksi: gerçek zip’in merkezî dizinini doğru okur (crc + boyut)', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-okur-'));
  const yol = path.join(kok, 'a.zip');
  await zipYaz(yol, { 'core/x.png': 'ABC', 'dir/y.txt': 'DEFGH' });
  const ix = await k.zipIndeksi(yol);
  assert.strictEqual(ix.size, 2);
  assert.strictEqual(ix.get('core/x.png').boyut, 3);
  assert.strictEqual(ix.get('dir/y.txt').boyut, 5);
  assert.strictEqual(ix.get('core/x.png').crc, crc32(Buffer.from('ABC')));
});
