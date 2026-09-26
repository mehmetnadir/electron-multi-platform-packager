'use strict';
/**
 * SET KABUK TANIMI — türetme + SÖZLEŞME testleri.
 *
 * İki sorumluluk:
 *  1) Tanım DOĞRU mu — gerçek bir SET ağacının `index.html`inin yüklediği her şey
 *     kabukta mı, kitap içeriği dışarıda mı, hash'li YENİ dosya kapsamda mı.
 *  2) Tanım TEK mi — üretici (`set-kimligi.js`) ile kapı
 *     (`scripts/windows-paket-kapisi.js`) aynı tanımı mı kullanıyor. Ayrışırlarsa
 *     bu dosya DÜŞER (fan-out sapması: kapı, üreticinin hatasını göremezdi).
 *
 * ÖLÇÜM KAYNAĞI: `index.html` referans listesi gerçek bir SET ağacından
 * (SM4 Set, 6 kitap, 2026-09-21 09:14 üretimi) alınmıştır — uydurma değil.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');

const K = require('./set-kabuk');
const uretici = require('./set-kimligi');
const kapi = require('../../scripts/windows-paket-kapisi');

/**
 * GERÇEK ÖLÇÜM: SM4 Set `index.html`inin referansladığı 12 varlık.
 * `app.config.js` BİLEREK listededir ve ağaçta YOKTUR (bkz.
 * `set-app-config-kasitli-yok.test.js` — Nadir kararı). Kabuk tanımı "referans =
 * var olan dosya" varsayımına dayanamaz; sınıflandırma YOL üzerinden yapılır.
 */
const INDEX_REFERANSLARI = Object.freeze([
  'empp-fs-shim.js',
  'empp-ag-politikasi.js',
  'app.config.js',
  'icons.js',
  'images.js',
  'tour.js',
  'i18n/tr.js',
  '43e23fce2b7009474555a77.js',
  'a8f43f74c72b65a3dd05.main.js',
  'favicon.ico',
  '5cf3775870d5351935ac.main.css',
  'core/kurumLogo.png',
]);

/** Kökteki webpack parçaları — `index.html` bunları HİÇ adlandırmaz (çalışma anı haritası). */
const HASH_PARCALARI = Object.freeze([
  '016270bb2d1096fc39b4.151.css', '14a3e0f44538395536ff.540.js',
  '6e964d06f8fb224c9b46.907.js.LICENSE.txt', 'a2ed1f1de370422e946f.70.js',
]);

// ───────────────────────── 1. türetme doğruluğu ─────────────────────────

test('K1 · index.html\'in 12 referansının TAMAMI kabuk sayılır (eski tanım 0/12 kapsıyordu)', () => {
  const disarida = INDEX_REFERANSLARI.filter((y) => !K.kabukYoluMu(y));
  assert.deepStrictEqual(disarida, [],
    'index.html\'in yüklediği bir varlık kabuk dışında kalırsa set boş ekrana açılır');
  assert.strictEqual(K.kabukDosyalariSuz(INDEX_REFERANSLARI).length, 12);
});

test('K2 · KİTAP İÇERİĞİ kabuğa SIZMAZ (kitabın kendi kanalı)', () => {
  const kitap = [
    'book1/index.html', 'book1/app.config.js', 'book1/assets/45516/p1.png',
    'book2/assets2/x.png', 'book6/rehber.pdf', 'book10/pages/001.png',
  ];
  assert.deepStrictEqual(K.kabukDosyalariSuz(kitap), []);
  assert.deepStrictEqual(K.kabukSizintilari(kitap), kitap);
  for (const y of kitap) assert.match(K.kabukDisiSebep(y), /kitap içeriği/);
});

test('K3 · KAPSAM GENİŞLEDİ ama sızma denetimi SIKI kaldı — karışık listede ayrım net', () => {
  const karisik = [
    'index.html', 'core/kurumLogo.png', 'i18n/tr.js', 'assets2/bg.png',
    'electron.js', 'set_app.config',
    'book1/index.html', 'node_modules/electron/package.json', 'temp/macos/x.icns',
  ];
  assert.deepStrictEqual(K.kabukDosyalariSuz(karisik), [
    'assets2/bg.png', 'core/kurumLogo.png', 'electron.js', 'i18n/tr.js',
    'index.html', 'set_app.config',
  ]);
  assert.deepStrictEqual(K.kabukSizintilari(karisik),
    ['book1/index.html', 'node_modules/electron/package.json', 'temp/macos/x.icns']);
});

test('K4 · HASH\'Lİ YENİ dosya köke düşünce OTOMATİK kapsama girer (statik kapanışın öldüğü yer)', () => {
  for (const y of HASH_PARCALARI) {
    assert.strictEqual(K.kabukYoluMu(y), true, `${y} kapsam dışı kaldı`);
  }
  // Yarın üretilecek, bugün var olmayan bir hash de aynı kuraldan geçer:
  assert.strictEqual(K.kabukYoluMu('ffffffffffffffffffff.999.js'), true);
  assert.strictEqual(K.kabukYoluMu('core/yeni/derin/varlik.svg'), true);
});

test('K5 · SEMBOLİK BAĞ / YOL KAÇIŞI: `..`, mutlak yol, sürücü öneki, NUL reddedilir', () => {
  const kotu = [
    '../index.html', 'assets2/../../gizli', '/etc/passwd', 'C:/Windows/x.dll',
    'core/./a.png', 'core//a.png', 'a\u0000b', '', '   /x',
  ];
  for (const y of kotu) {
    assert.strictEqual(K.kabukYoluMu(y), false, `${JSON.stringify(y)} kabuk sayıldı`);
  }
  // Windows ayracı normalleşir — kaçış DEĞİLDİR.
  assert.strictEqual(K.kabukYoluMu('assets2\\win.png'), true);
  assert.deepStrictEqual(K.kabukDosyalariSuz(['assets2\\win.png']), ['assets2/win.png']);
});

test('K6 · DİZİN ADI bir kabuk DOSYASI değildir (çıplak kök adı sızma sayılır)', () => {
  for (const ad of ['assets2', 'core', 'i18n', 'node_modules', 'temp', 'book1']) {
    assert.strictEqual(K.kabukYoluMu(ad), false, `${ad} dosya gibi kabul edildi`);
    assert.match(K.kabukDisiSebep(ad), /DİZİN adıdır|kitap|artefakt/);
  }
});

test('K7 · kanalın KENDİ durum dosyaları kabuk değildir (kendini güncellemez)', () => {
  assert.strictEqual(K.kabukYoluMu('empp-set.json'), false);
  assert.strictEqual(K.kabukYoluMu('.empp-set-guncelleme.json'), false);
  assert.strictEqual(K.kabukYoluMu('.empp-gecici/x.indirme'), false);
  // Adı `empp` ile başlayan GERÇEK kabuk dosyaları etkilenmez (nokta yok):
  for (const y of ['empp-fs-shim.js', 'empp-ag-politikasi.js', 'empp-set-guncelleyici.js']) {
    assert.strictEqual(K.kabukYoluMu(y), true, `${y} yanlışlıkla durum dosyası sayıldı`);
  }
});

test('K8 · BOZUK GİRDİ (null / sayı / dizi değil / boş) çökertmez, temiz de sayılmaz', () => {
  assert.deepStrictEqual(K.kabukDosyalariSuz(null), []);
  assert.deepStrictEqual(K.kabukDosyalariSuz(undefined), []);
  assert.deepStrictEqual(K.kabukDosyalariSuz('index.html'), [], 'dize bir liste değildir');
  assert.deepStrictEqual(K.kabukDosyalariSuz(['index.html', null, 42, '', {}]), ['index.html']);
  assert.deepStrictEqual(K.kabukSizintilari([null, '', 42]), [null, '', 42]);
  assert.match(K.kabukDisiSebep(42), /dize değil/);
});

test('K9 · BİLİNMEYEN kök dizin "kabuk" da "temiz" de sayılmaz — GÖRÜNÜR olur', () => {
  const c = K.dallariSinifla(['assets2', 'core', 'i18n', 'book1', 'book2',
    'node_modules', 'temp', 'fonts', 'dist']);
  assert.deepStrictEqual(c.kabuk, ['assets2', 'core', 'i18n']);
  assert.deepStrictEqual(c.kitap, ['book1', 'book2']);
  assert.deepStrictEqual(c.artefakt, ['node_modules', 'temp']);
  assert.deepStrictEqual(c.bilinmeyen, ['dist', 'fonts'],
    'beyaz listenin kör noktası sessiz kalırsa o dosyalar hiç güncellenmez');
  assert.match(K.kabukDisiSebep('fonts/x.woff'), /beyaz listesinde olmayan/);
});

test('K10 · index.html HİÇ referans içermese de kabuk tanımı ayakta kalır (ağaç yapısına dayanır)', () => {
  // Bozuk/boş HTML bir ÜRETME girdisi değildir: tanım ağacın dizin yapısından
  // türer, HTML ayrıştırmasından DEĞİL. Bu yüzden boş/bozuk index.html kabuk
  // kümesini boşaltmaz — statik kapanışın kırıldığı yerde bu kural ayakta kalır.
  assert.strictEqual(K.kabukYoluMu('index.html'), true);
  assert.strictEqual(K.kabukYoluMu('a8f43f74c72b65a3dd05.main.js'), true);
});

// ───────────────────────── 2. GERÇEK AĞAÇ (I/O) ─────────────────────────

/** Gerçek SM4 Set ağacının şeklini birebir taklit eden sahte ağaç. */
async function sahteSet() {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'set-kabuk-agac-'));
  const yaz = async (rel, icerik = 'x') => {
    await fs.ensureDir(path.dirname(path.join(kok, rel)));
    await fs.writeFile(path.join(kok, rel), icerik);
  };
  for (const y of INDEX_REFERANSLARI) if (y !== 'app.config.js') await yaz(y);
  for (const y of HASH_PARCALARI) await yaz(y);
  await yaz('set_app.config');
  await yaz('electron.js');
  await yaz('main.js');
  await yaz('assets2/bg.png');
  await yaz('assets2/book1-button.png');
  await yaz('core/icons/derin/a.svg');
  for (const b of ['book1', 'book2', 'book3', 'book4', 'book5', 'book6']) {
    await yaz(`${b}/index.html`);
    await yaz(`${b}/assets/45516/p1.png`);
  }
  await yaz('node_modules/electron/package.json');
  await yaz('temp/macos/mac-universal/app.icns');
  return kok;
}

test('K11 · GERÇEK AĞAÇ ŞEKLİ: 12/12 referans kapsandı · 0 kitap sızması · 0 artefakt', async () => {
  const kok = await sahteSet();
  const kabuk = await uretici.kabukDosyalariBul(kok);

  const varOlanReferanslar = INDEX_REFERANSLARI.filter((y) => y !== 'app.config.js');
  for (const y of varOlanReferanslar) {
    assert.ok(kabuk.includes(y), `index.html referansı kabukta YOK: ${y}`);
  }
  assert.strictEqual(kabuk.filter((y) => /^book\d+\//.test(y)).length, 0, 'kitap sızdı');
  assert.strictEqual(kabuk.filter((y) => y.startsWith('node_modules/')).length, 0);
  assert.strictEqual(kabuk.filter((y) => y.startsWith('temp/')).length, 0);
  for (const y of HASH_PARCALARI) assert.ok(kabuk.includes(y), `hash'li parça eksik: ${y}`);
  assert.ok(kabuk.includes('core/icons/derin/a.svg'), 'core/ alt ağacı taranmadı');
  assert.deepStrictEqual(await uretici.kapsamDisiDallariBul(kok), []);
  await fs.remove(kok);
});

test('K12 · GERÇEK AĞAÇ: sembolik bağ İZLENMEZ (ağaç dışı kabuk girdisi üretilemez)', async () => {
  const kok = await sahteSet();
  const disari = await fs.mkdtemp(path.join(os.tmpdir(), 'set-kabuk-disari-'));
  await fs.writeFile(path.join(disari, 'sir.txt'), 'gizli');
  await fs.symlink(path.join(disari, 'sir.txt'), path.join(kok, 'sir-bagi.txt'));
  await fs.symlink(disari, path.join(kok, 'core', 'disari-bagi'));

  const kabuk = await uretici.kabukDosyalariBul(kok);
  assert.strictEqual(kabuk.includes('sir-bagi.txt'), false, 'kök sembolik bağı kabuğa girdi');
  assert.strictEqual(kabuk.filter((y) => y.includes('disari-bagi')).length, 0,
    'alt ağaçtaki sembolik bağ izlendi');
  await fs.remove(kok); await fs.remove(disari);
});

test('K13 · GERÇEK AĞAÇ: bilinmeyen kök dizin `kapsamDisiDallar`a yazılır (sessiz kalmaz)', async () => {
  const kok = await sahteSet();
  await fs.ensureDir(path.join(kok, 'fonts'));
  await fs.writeFile(path.join(kok, 'fonts', 'a.woff2'), 'x');
  const disi = await uretici.kapsamDisiDallariBul(kok);
  assert.deepStrictEqual(disi, ['fonts']);

  const r = await uretici.paketeYaz(kok, { setKimligi: 'sm4', damga: 0, env: {} });
  assert.deepStrictEqual(r.harita.kapsamDisiDallar, ['fonts']);
  assert.strictEqual(r.harita.kabukDosyalari.filter((y) => y.startsWith('fonts/')).length, 0);
  await fs.remove(kok);
});

// ───────────────────────── 3. SÖZLEŞME: tek kaynak ─────────────────────────

test('S1 · SÖZLEŞME: üretici ve kapı AYNI modülü kullanır (referans kimliği)', () => {
  assert.strictEqual(uretici.KABUK, K, 'üretici tanımın KOPYASINI taşıyor');
  assert.strictEqual(kapi.SET_KABUK, K, 'kapı tanımın KOPYASINI taşıyor');
  assert.strictEqual(uretici.KABUK_DIZINLERI, K.KABUK_DIZINLERI);
  assert.strictEqual(kapi.SET_KABUK_DIZINLERI, K.KABUK_DIZINLERI);
  assert.strictEqual(kapi.kabukSizintilari, K.kabukSizintilari,
    'kapının sızma denetimi üreticininkinden ayrı bir fonksiyon olamaz');
});

test('S2 · SÖZLEŞME: imzalar birebir aynı (biri tanımı değiştirirse düşer)', () => {
  assert.strictEqual(uretici.KABUK_IMZASI, K.IMZA);
  assert.strictEqual(kapi.SET_KABUK_IMZASI, K.IMZA);
  assert.match(K.IMZA, /^v\d+ dizin=/);
});

test('S3 · SÖZLEŞME: üretici ve kapı 40 yolu AYNI sınıflandırır (davranışsal çapraz kontrol)', () => {
  const ornekler = [
    ...INDEX_REFERANSLARI, ...HASH_PARCALARI,
    'index.html', 'set_app.config', 'electron.js', 'main.js', 'package.json',
    'assets2/a.png', 'assets2/alt/derin.js', 'core/a.png', 'i18n/tr.js',
    'book1/index.html', 'book10/x.png', 'assets/45516/p1.png',
    'node_modules/x/y.js', 'temp/macos/a.icns', 'fonts/a.woff2', 'dist/app.js',
    'empp-set.json', '.empp-set-guncelleme.json', '.empp-gecici/a.indirme',
    '../ust.html', '/mutlak.html', 'C:/x.dll', 'assets2', 'core', 'book1',
    '', null, 42,
  ];
  assert.ok(ornekler.length >= 40, `çapraz kontrol örneği az: ${ornekler.length}`);
  const ureticininKabugu = new Set(uretici.kabukDosyalariTopla(ornekler));
  const kapininSizintisi = new Set(kapi.kabukSizintilari(ornekler).map(
    (y) => (typeof y === 'string' ? K.yolNormalle(y) : y)));
  for (const y of ornekler) {
    const n = typeof y === 'string' ? K.yolNormalle(y) : y;
    const uretimdeKabuk = ureticininKabugu.has(n);
    const kapidaSizinti = kapininSizintisi.has(n);
    assert.strictEqual(uretimdeKabuk, !kapidaSizinti,
      `SAPMA: ${JSON.stringify(y)} — üretici kabuk=${uretimdeKabuk}, kapı sızıntı=${kapidaSizinti}`);
  }
});

test('S4 · SÖZLEŞME: süz() ve sizintilari() tam ikilidir (hiçbir girdi iki yere düşmez)', () => {
  const liste = ['index.html', 'book1/a', 'core/b', 'node_modules/c', 'assets2/d', 'temp/e'];
  const kabuk = uretici.kabukDosyalariTopla(liste);
  const sizan = K.kabukSizintilari(liste);
  assert.strictEqual(kabuk.length + sizan.length, liste.length);
  for (const y of sizan) assert.ok(!kabuk.includes(K.yolNormalle(y)));
});

// ─────────── Web-Z sf425 kök kabuğu + yedek dizinleri (2026-09-26, kapı madde 13 C2) ───────────

test('K20 · Web-Z sf425 kök kabuğunun 6 dizini beyaz listede (SM2 menüsü güncellenebilir)', () => {
  for (const d of ['config', 'features', 'images', 'languages', 'scripts', 'styles']) {
    assert.ok(K.KABUK_DIZINLERI.includes(d), `${d} beyaz listede yok`);
    assert.strictEqual(K.dalSinifi(d), 'kabuk');
  }
  // SM2 index.html'in gerçekten yüklediği yollar
  for (const y of ['styles/language-set.css', 'images/logo.png', 'scripts/x.js',
    'config/settings.json', 'languages/tr.json', 'features/a/b.js']) {
    assert.strictEqual(K.kabukYoluMu(y), true, y);
  }
  const c = K.dallariSinifla(['config', 'features', 'images', 'languages', 'scripts', 'styles', 'book1', '_eski']);
  assert.deepStrictEqual(c.bilinmeyen, [], 'SM2 ağacı artık tamamen kapsanıyor');
  assert.match(K.IMZA, /dizin=assets2,core,i18n,config,features,images,languages,scripts,styles /);
});

test('K21 · "_" ile başlayan dizinler (ör. _eski) güncelleme kapsamına HİÇ girmez, bilinmeyen de sayılmaz', () => {
  assert.strictEqual(K.dalSinifi('_eski'), 'yedek');
  assert.strictEqual(K.kabukYoluMu('_eski/index-2026-09-25-182210.html'), false);
  assert.match(K.kabukDisiSebep('_eski/index-2026-09-25-182210.html'), /"_" ile başlayan dizinler/);
  assert.deepStrictEqual(K.kabukDosyalariSuz(['index.html', '_eski/index-2026-09-25-182210.html', '_yedek/a/b.js']),
    ['index.html']);
  const c = K.dallariSinifla(['_eski', '_yedek', 'fonts']);
  assert.deepStrictEqual(c.yedek, ['_eski', '_yedek']);
  assert.deepStrictEqual(c.bilinmeyen, ['fonts'], 'bilinmeyen dizin hâlâ görünür (kör nokta kapanmadı)');
  // desen yalnız DİZİN adlarına: kökteki "_" ile başlayan DOSYA kabukta kalır
  assert.strictEqual(K.kabukYoluMu('_x.js'), true);
  assert.match(K.IMZA, / yedek=\^_ /);
});
