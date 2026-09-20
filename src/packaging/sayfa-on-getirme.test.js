'use strict';
const test = require('node:test');
const assert = require('node:assert');
const m = require('./sayfa-on-getirme.js');

// --- kapı ---
test('kapı varsayılan AÇIK, yalnız 0 kapatır', () => {
  assert.strictEqual(m.acikMi({}), true);
  assert.strictEqual(m.acikMi({ EMPP_ON_GETIRME: '1' }), true);
  assert.strictEqual(m.acikMi({ EMPP_ON_GETIRME: '0' }), false);
});

// --- sıralama: Nadir'in "sıralı" şartı ---
test('sayfalar SAYISAL sıraya dizilir — metin sırası 10 < 9 yanlışına düşmez', () => {
  const girdi = ['pages/10.png', 'pages/9.png', 'pages/1.png', 'pages/100.png', 'pages/2.png'];
  assert.deepStrictEqual(m.sayfalariSirala(girdi),
    ['pages/1.png', 'pages/2.png', 'pages/9.png', 'pages/10.png', 'pages/100.png']);
});

test('sıralama uzantıdan bağımsız (WebP dönüşümü .png adını koruyor ama korumasa da)', () => {
  assert.deepStrictEqual(m.sayfalariSirala(['p/2.webp', 'p/1.webp']), ['p/1.webp', 'p/2.webp']);
});

test('sayı içermeyen ad sona atılır, çökme olmaz', () => {
  const s = m.sayfalariSirala(['p/kapak.png', 'p/2.png', 'p/1.png']);
  assert.deepStrictEqual(s.slice(0, 2), ['p/1.png', 'p/2.png']);
  assert.strictEqual(s[2], 'p/kapak.png');
});

test('sıralama girdiyi DEĞİŞTİRMEZ (yan etkisiz)', () => {
  const girdi = ['p/2.png', 'p/1.png'];
  m.sayfalariSirala(girdi);
  assert.deepStrictEqual(girdi, ['p/2.png', 'p/1.png']);
});

// --- betik üretimi ---
test('betik sayfa listesini ve işareti taşır', () => {
  const b = m.betikUret(['p/1.png', 'p/2.png']);
  assert.match(b, /EMPP_ON_GETIRME/);
  assert.match(b, /p\/1\.png/);
  assert.match(b, /p\/2\.png/);
  assert.match(b, /^<script>/);
  assert.match(b, /<\/script>$/);
});

test('boş sayfa listesinde betik ERKEN ÇIKAR (boşuna iş yapmaz)', () => {
  const b = m.betikUret([]);
  assert.match(b, /if \(!SAYFALAR\.length\) return;/);
});

test('geçersiz girdi çökmez', () => {
  assert.doesNotThrow(() => m.betikUret(null));
  assert.doesNotThrow(() => m.betikUret(['iyi', null, 42, undefined, 'iyi2']));
  const b = m.betikUret(['iyi', null, 42, undefined, 'iyi2']);
  assert.match(b, /\["iyi","iyi2"\]/);
});

test('süreler ayarlanabilir, geçersiz değer varsayılana döner', () => {
  assert.match(m.betikUret(['a'], { araMs: 50, baslangicMs: 1000 }), /var ARA = 50, BASLANGIC = 1000;/);
  assert.match(m.betikUret(['a'], { araMs: -5 }),
    new RegExp(`var ARA = ${m.VARSAYILAN_ARA_MS},`));
  assert.match(m.betikUret(['a'], { araMs: 'çok' }),
    new RegExp(`var ARA = ${m.VARSAYILAN_ARA_MS},`));
});

test('betik SIRALI okur — eşzamanlı tur açmaz', () => {
  const b = m.betikUret(['a', 'b', 'c']);
  // Bir sonraki sayfa ancak oncekinin sonucundan SONRA sıraya giriyor.
  assert.match(b, /sirayaDevam\(i \+ 1\)/);
  assert.strictEqual(/Promise\.all|forEach\(|\.map\(/.test(b), false);
});

test('betik arkaplanda duraklar — kullanıcının diskini/CPU sunu çalmaz', () => {
  const b = m.betikUret(['a']);
  assert.match(b, /visibilityState/);
  // Tanimin VARLIGI yetmez, CAGRILMIS olmali: gorunur() cagrisi kaldirilirsa
  // isitma arkaplanda da koser ve kullanicinin makinesini mesgul eder.
  assert.match(b, /if \(!gorunur\(\)\)/);
  assert.match(b, /setTimeout\(function\(\)\{ sirayaDevam\(i\); \}, 1000\)/);
});

test('betik window.fetch SARMALAMAZ (motor kendi sarmalayıcısını sonra kuruyor)', () => {
  const b = m.betikUret(['a']);
  assert.strictEqual(/window\.fetch\s*=/.test(b), false);
});

test('betik iki kez çalışmaz (çift enjeksiyon koruması)', () => {
  const b = m.betikUret(['a']);
  assert.match(b, /if \(window\.__EMPP_ON_GETIRME__\) return;/);
});

test('baytlar tutulmaz — yalnız uzunluk sayılır (bellek şişmesin)', () => {
  const b = m.betikUret(['a']);
  assert.match(b, /bayt \+= n/);
  assert.strictEqual(/push\(|new Map\(|onbellek/.test(b), false);
});

// --- enjeksiyon ---
const HTML = '<html><body><div id="root"></div><script src="main.js"></script></body></html>';

test('betik </body> ÖNÜNE enjekte edilir', () => {
  const r = m.icerigeEnjekteEt(HTML, m.betikUret(['p/1.png']));
  assert.strictEqual(r.uygulandi, true);
  assert.match(r.icerik, /EMPP_ON_GETIRME[\s\S]*<\/body>/);
  assert.strictEqual(r.icerik.indexOf('EMPP_ON_GETIRME') < r.icerik.lastIndexOf('</body>'), true);
});

test('motorun kendi betiklerinden SONRA gelir (onları geciktirmez)', () => {
  const r = m.icerigeEnjekteEt(HTML, m.betikUret(['p/1.png']));
  assert.strictEqual(r.icerik.indexOf('main.js') < r.icerik.indexOf('EMPP_ON_GETIRME'), true);
});

test('zaten yamalı dosyaya ikinci kez dokunulmaz', () => {
  const bir = m.icerigeEnjekteEt(HTML, m.betikUret(['p/1.png']));
  const iki = m.icerigeEnjekteEt(bir.icerik, m.betikUret(['p/1.png']));
  assert.strictEqual(iki.uygulandi, false);
  assert.strictEqual(iki.sebep, 'zaten-yamali');
  assert.strictEqual(iki.icerik, bir.icerik);
});

test('</body> yoksa SESSİZ NO-OP değil — sebep bildirilir', () => {
  const r = m.icerigeEnjekteEt('<html><div>x</div></html>', m.betikUret(['a']));
  assert.strictEqual(r.uygulandi, false);
  assert.strictEqual(r.sebep, 'body-yok');
});

test('boş betikle enjeksiyon yapılmaz', () => {
  const r = m.icerigeEnjekteEt(HTML, '');
  assert.strictEqual(r.uygulandi, false);
  assert.strictEqual(r.sebep, 'betik-bos');
});

test('null/undefined html çökmez', () => {
  assert.doesNotThrow(() => m.icerigeEnjekteEt(null, m.betikUret(['a'])));
  assert.doesNotThrow(() => m.icerigeEnjekteEt(undefined, m.betikUret(['a'])));
});

test('birden çok </body> varsa SONUNCUSUNUN önüne girer', () => {
  // Ilk </body> kullanilirsa betik ikinci govdenin DISINDA kalir; ayrica
  // motorun sonradan gelen betiklerinden ONCE calisip acilisi geciktirir.
  const html = '<html><body>bir</body><body>iki<script src="gec.js"></script></body></html>';
  const r = m.icerigeEnjekteEt(html, m.betikUret(['a']));
  assert.strictEqual(r.uygulandi, true);
  const yer = r.icerik.indexOf('EMPP_ON_GETIRME');
  assert.strictEqual(yer > r.icerik.indexOf('</body>'), true, 'ilk </body>den SONRA olmali');
  assert.strictEqual(yer > r.icerik.indexOf('gec.js'), true, 'son betikten SONRA olmali');
  assert.strictEqual(yer < r.icerik.lastIndexOf('</body>'), true, 'son </body>den ONCE olmali');
});

// --- pakete uygulama (gerçek dosya sistemi, mock yok) ---
const fsx = require('fs-extra');
const os = require('node:os');
const pth = require('node:path');

async function sahtePaket(kitaplar) {
  const kok = await fsx.mkdtemp(pth.join(os.tmpdir(), 'on-getirme-'));
  for (const [ad, sayfalar] of Object.entries(kitaplar)) {
    const dizin = ad === '' ? kok : pth.join(kok, ad);
    await fsx.ensureDir(dizin);
    await fsx.writeFile(pth.join(dizin, 'index.html'), '<html><body><p>k</p></body></html>');
    if (sayfalar > 0) {
      const sayfaDizini = pth.join(dizin, 'assets', '45516', 'pages');
      await fsx.ensureDir(sayfaDizini);
      for (let i = 1; i <= sayfalar; i++) await fsx.writeFile(pth.join(sayfaDizini, `${i}.png`), 'x');
    }
  }
  return kok;
}

test('SET paketinde her alt-kitap KENDİ sayfa listesini alır', async () => {
  const kok = await sahtePaket({ book1: 3, book2: 5 });
  const r = await m.paketeUygula(kok);
  const harita = Object.fromEntries(r.map((x) => [x.kitap, x.sayfa]));
  assert.deepStrictEqual(harita, { book1: 3, book2: 5 });
  const b1 = await fsx.readFile(pth.join(kok, 'book1', 'index.html'), 'utf8');
  assert.match(b1, /assets\/45516\/pages\/1\.png/);
  assert.strictEqual(b1.includes('pages/4.png'), false, 'book1 book2 sayfasını almamalı');
});

test('sayfası olmayan kitaba betik enjekte EDİLMEZ (boşuna kod gömülmez)', async () => {
  const kok = await sahtePaket({ book1: 0 });
  const r = await m.paketeUygula(kok);
  assert.deepStrictEqual(r, []);
  const html = await fsx.readFile(pth.join(kok, 'book1', 'index.html'), 'utf8');
  assert.strictEqual(html.includes(m.ISARET), false);
});

test('sayfalar dosyaya SAYISAL sırada yazılır', async () => {
  const kok = await sahtePaket({ book1: 12 });
  await m.paketeUygula(kok);
  const html = await fsx.readFile(pth.join(kok, 'book1', 'index.html'), 'utf8');
  const liste = JSON.parse(/var SAYFALAR = (\[.*?\]);/.exec(html)[1]);
  assert.strictEqual(liste[0], 'assets/45516/pages/1.png');
  assert.strictEqual(liste[8], 'assets/45516/pages/9.png');
  assert.strictEqual(liste[9], 'assets/45516/pages/10.png');
  assert.strictEqual(liste.length, 12);
});

test('iki kez uygulanırsa ikinci tur dosyayı DEĞİŞTİRMEZ', async () => {
  const kok = await sahtePaket({ book1: 2 });
  await m.paketeUygula(kok);
  const bir = await fsx.readFile(pth.join(kok, 'book1', 'index.html'), 'utf8');
  const r = await m.paketeUygula(kok);
  const iki = await fsx.readFile(pth.join(kok, 'book1', 'index.html'), 'utf8');
  assert.strictEqual(iki, bir);
  assert.strictEqual(r[0].sebep, 'zaten-yamali');
});

test('yol ayıracı her zaman "/" — Windows ters eğik çizgi sızmaz', async () => {
  const kok = await sahtePaket({ book1: 2 });
  await m.paketeUygula(kok);
  const html = await fsx.readFile(pth.join(kok, 'book1', 'index.html'), 'utf8');
  const liste = JSON.parse(/var SAYFALAR = (\[.*?\]);/.exec(html)[1]);
  for (const y of liste) assert.strictEqual(y.includes('\\'), false, y);
});

test('tek kitaplık pakette kökün kendisi de yamalanır', async () => {
  const kok = await sahtePaket({ '': 4 });
  const r = await m.paketeUygula(kok);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].kitap, '(kök)');
  assert.strictEqual(r[0].sayfa, 4);
});
