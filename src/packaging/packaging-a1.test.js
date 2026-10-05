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

test('kapakaShimEkle: fs-shim kök betiğinin ardına; idempotent; A1 bozuksa hata', async () => {
  const d = a1Agac();
  assert.equal((await A1.kapakaShimEkle(d, 'empp-fs-shim.js', sessiz)).durum, 'enjekte');
  const html = oku(d, 'kapak/index.html');
  assert.ok(html.includes(`${A1.A1_KOK_BETIGI}<script src="empp-fs-shim.js"></script>`));
  assert.deepEqual(A1.kapakDenetle(html), []);
  assert.equal((await A1.kapakaShimEkle(d, 'empp-fs-shim.js', sessiz)).durum, 'zaten-var');
  assert.deepEqual(fs.readdirSync(path.join(d, 'kapak')), ['index.html'], 'geçici dosya kalmaz');
  const d2 = a1Agac();
  fs.rmSync(path.join(d2, 'classlibraries'), { recursive: true });
  // Ö3: işaretli sayfa var ama kök menü yok → A1 değil SAYILMAZ, hata (zorunlu sarmalayıcı düşürür).
  assert.equal((await A1.kapakaShimEkle(d2, 'empp-fs-shim.js', sessiz)).durum, 'hata');
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
  // Ö3: hata yutan blokların DIŞINDA fail-closed doğrulama, iki yolda da.
  assert.match(kaynak, /await a1Duzen\.kapakShimZorunlu\(appPath, 'empp-fs-shim\.js'/);
  assert.match(kaynak, /\} catch \(e\) \{ console\.warn\('⚠️ android shim enjeksiyonu başarısız:', e\.message\); \}\n.*\n.*\n\s*await a1Duzen\.kapakShimZorunlu\(wwwPath, 'empp-android-shim\.js'/);
});

// ─── Set güncelleme kanalı (set-kabuk tanımı) + `_eski/` (koordinatör riski 1 ve 3) ─────────────
const setKabuk = require('./set-kabuk');
const setKimligi = require('./set-kimligi');
const { fsCopyFiltresi, elektronBuilderDesenleri } = require('./kok-yedek-dizin-disla');

test('set-kabuk A1: kapak/ kabuk, assets/+classlibraries/ kitap — YALNIZ {a1:true} ile; varsayılan aynen', () => {
  assert.equal(setKabuk.dalSinifi('kapak'), 'bilinmeyen');
  assert.equal(setKabuk.dalSinifi('assets'), 'bilinmeyen');
  assert.equal(setKabuk.dalSinifi('kapak', { a1: true }), 'kabuk');
  assert.equal(setKabuk.dalSinifi('assets', { a1: true }), 'kitap');
  assert.equal(setKabuk.dalSinifi('classlibraries', { a1: true }), 'kitap');
  assert.equal(setKabuk.dalSinifi('_eski', { a1: true }), 'yedek');
  assert.equal(setKabuk.kabukYoluMu('kapak/index.html'), false);
  assert.equal(setKabuk.kabukYoluMu('kapak/index.html', { a1: true }), true);
  assert.equal(setKabuk.kabukYoluMu('classlibraries/ImWin32.dll', { a1: true }), false);
  assert.deepEqual(setKabuk.kabukSizintilari(['kapak/index.html', 'assets/1/x.png'], { a1: true }), ['assets/1/x.png']);
  assert.deepEqual(setKabuk.dallariSinifla(['kapak', 'assets', 'classlibraries', 'scripts', '_eski'], { a1: true }).bilinmeyen, []);
  // Ö1: bookN imzası A1 öncesiyle bayt-aynı; A1 parçası yalnız IMZA_A1'de.
  assert.equal(setKabuk.IMZA, 'v2 dizin=assets2,core,i18n,config,features,images,languages,scripts,styles '
    + 'artefakt=node_modules,temp,.empp-gecici kitap=^book\\d+$ yedek=^_ durum=empp-set.json|.empp*');
  assert.equal(setKabuk.IMZA_A1, `${setKabuk.IMZA} a1=kabuk:kapak;kitap:assets,classlibraries`);
});

test('set-kimligi A1: empp-set.json kapak/index.html kabukta, kapsam dışı dal yok, duzen=a1; bookN ağacında duzen yok', async () => {
  const d = a1Agac();
  for (const alt of ['scripts', '_eski']) fs.mkdirSync(path.join(d, alt));
  fs.writeFileSync(path.join(d, 'scripts/language-set.js'), '//');
  fs.writeFileSync(path.join(d, '_eski/index-x.html'), 'eski');
  const h = (await setKimligi.paketeYaz(d, { setKimligi: '45485', damga: 0, env: {} })).harita;
  assert.equal(h.duzen, 'a1');
  assert.equal(h.kabukTanimi, setKabuk.IMZA_A1);
  assert.ok(h.kabukDosyalari.includes('kapak/index.html'), h.kabukDosyalari.join(','));
  assert.ok(!h.kabukDosyalari.some((y) => /^(assets|classlibraries|_eski)\//.test(y)), h.kabukDosyalari.join(','));
  assert.deepEqual(h.kapsamDisiDallar, []);
  assert.deepEqual(setKabuk.kabukSizintilari(h.kabukDosyalari, { a1: true }), [], 'kapı A1 seçeneğiyle sızma görmez');
  const b = a1Agac();
  fs.writeFileSync(path.join(b, 'kapak/index.html'), MOTOR); // işaretsiz → A1 değil
  const hb = (await setKimligi.paketeYaz(b, { setKimligi: '45485', damga: 0, env: {} })).harita;
  assert.equal(hb.duzen, undefined);
  assert.equal(hb.kabukTanimi, setKabuk.IMZA, 'bookN/A1-dışı harita imzası değişmez');
  assert.deepEqual(hb.kapsamDisiDallar, ['assets', 'classlibraries', 'kapak'], 'A1 değilse gürültülü kör nokta');
});

test('`_eski/` kök dizini (webz-kabuk-uret arşivi) her paketleme yolunda paket DIŞI', () => {
  const d = a1Agac();
  fs.mkdirSync(path.join(d, '_eski'));
  fs.writeFileSync(path.join(d, '_eski/index-2026.html'), MOTOR);
  const f = fsCopyFiltresi(d);
  assert.equal(f(path.join(d, '_eski')), false);
  assert.equal(f(path.join(d, '_eski/index-2026.html')), false);
  assert.equal(f(path.join(d, 'kapak/index.html')), true);
  assert.deepEqual(elektronBuilderDesenleri(), ['!_*', '!_*/**/*']);
});

test('Ö3 a1Durumu: işaretsiz → degil; işaretli + kök menü yok → bozuk; okuma hatası → bozuk', () => {
  const d = a1Agac();
  assert.equal(A1.a1Durumu(d).durum, 'a1');
  fs.renameSync(path.join(d, 'classlibraries/ImWin32.dll'), path.join(d, 'classlibraries/x'));
  assert.equal(A1.a1Durumu(d).durum, 'bozuk');
  assert.equal(A1.a1DuzeniMi(d), false);
  const e = a1Agac();
  fs.chmodSync(path.join(e, 'kapak/index.html'), 0o000);
  try {
    if (process.getuid && process.getuid() === 0) return; // root her dosyayı okur
    assert.equal(A1.a1Durumu(e).durum, 'bozuk');
  } finally { fs.chmodSync(path.join(e, 'kapak/index.html'), 0o644); }
});

test('Ö3 kapakShimZorunlu: A1 değil → dokunmaz; bozuk / işaret yok / enjeksiyon sonrası geçersiz → paket DÜŞER', async () => {
  const yok = a1Agac();
  fs.rmSync(path.join(yok, 'kapak'), { recursive: true });
  assert.equal((await A1.kapakShimZorunlu(yok, 'empp-fs-shim.js', sessiz)).durum, 'a1-degil');
  const isaretsiz = a1Agac({ kapak: MOTOR });
  assert.equal((await A1.kapakShimZorunlu(isaretsiz, 'empp-fs-shim.js', sessiz)).durum, 'a1-degil');
  const bozuk = a1Agac();
  fs.rmSync(path.join(bozuk, 'app.config.js'));
  await assert.rejects(A1.kapakShimZorunlu(bozuk, 'empp-fs-shim.js', sessiz), /enjekte edilemedi \(hata: A1 işaretli ama kökte yok: app\.config\.js\)/);
  // İşaret var ama A1 kök betiği bozulmuş (shimEkle işareti bulamaz) → düşer.
  const kirik = a1Agac({ kapak: A1.baslikEkle(MOTOR).replace(A1.A1_KOK_BETIGI, `<script ${A1.A1_ISARET}></script>`) });
  await assert.rejects(A1.kapakShimZorunlu(kirik, 'empp-fs-shim.js', sessiz), /paket düşürüldü/);
  // Sağlam: enjekte + doğrulandı; ikinci çağrı zaten-var.
  const ok = a1Agac();
  assert.equal((await A1.kapakShimZorunlu(ok, 'empp-fs-shim.js', sessiz)).durum, 'enjekte');
  assert.equal((await A1.kapakShimZorunlu(ok, 'empp-fs-shim.js', sessiz)).durum, 'zaten-var');
});

test('k1: A1 kök betiği hatayı sessiz yutmaz (console.warn)', () => {
  assert.match(A1.A1_KOK_BETIGI, /catch\(e\)\{console\.warn\(/);
  assert.doesNotMatch(A1.A1_KOK_BETIGI, /catch\(e\)\{\}/);
});

// ─── Ö4: ölü motor temizliği + sayfa ön-getirme A1'de motor sayfasından ─────────────────────────
const oluMotor = require('./olu-motor-temizligi');
const onGetirme = require('./sayfa-on-getirme');

function a1MotorAgaci() {
  const H = (c) => c.repeat(20);
  const ana = `${H('a')}.main.js`; const parca = `${H('b')}.12.js`; const olu = `${H('c')}.main.js`;
  const motor = MOTOR.replace('./bd0c1a4f650802c98ebf.main.js', ana).replace('<script src="app.config.js"></script>',
    '<script src="app.config.js"></script><script src="polyfill.js"></script>');
  // Kabuk kök-düzeyi bir js'e (polyfill.js) başvursun: yalnız kabuktan tohumlanırsa motor ölü sayılırdı.
  const d = a1Agac({ kapak: A1.baslikEkle(motor), kok: KABUK.replace('</body>', '<script src="polyfill.js"></script></body>') });
  fs.writeFileSync(path.join(d, ana), `/* ana */ import("./${parca}")`);
  fs.writeFileSync(path.join(d, parca), '/* parça */');
  fs.writeFileSync(path.join(d, olu), '/* eski main */');
  fs.writeFileSync(path.join(d, 'polyfill.js'), '/* polyfill */');
  return { d, ana, parca, olu };
}

test('Ö4 ölü motor temizliği A1: motorun hash\'li dosyaları SİLİNMEZ, gerçekten ölü olan silinir', async () => {
  const { d, ana, parca, olu } = a1MotorAgaci();
  const r = await oluMotor.paketiTemizle(d);
  assert.ok(fs.existsSync(path.join(d, ana)), 'motor ana bundle kaldı');
  assert.ok(fs.existsSync(path.join(d, parca)), 'motor parçası kaldı');
  assert.ok(!fs.existsSync(path.join(d, olu)), 'ölü main silindi');
  assert.equal(r.toplamDosya, 1);
  // Kanıt: yalnız kök index (kabuk) tohumu motoru öldürürdü — eski davranışın tehlikesi.
  const yalnizKabuk = oluMotor.kapanisHesapla([ana, parca, olu, 'polyfill.js', 'index.html'],
    fs.readFileSync(path.join(d, 'index.html'), 'utf8'), (f) => fs.readFileSync(path.join(d, f), 'utf8'));
  assert.ok(yalnizKabuk.olu.includes(ana), 'kabuk tek tohumken ana bundle ölü sayılıyordu');
});

test('Ö4 ölü motor temizliği A1: motor sayfası okunamıyorsa kökte temizlik YAPILMAZ', async () => {
  const { d, olu } = a1MotorAgaci();
  const r = await oluMotor.dizeniTemizle(d, { ekSayfalar: ['kapak/yok.html'] });
  assert.match(r.atlandi, /^ek-sayfa-okunamadi/);
  assert.ok(fs.existsSync(path.join(d, olu)));
});

test('Ö4 ön-getirme A1: betik kapak/index.html\'e (kapak süzgeciyle) girer, kök kabuğa GİRMEZ', async () => {
  const d = a1Agac();
  for (const id of ['25861', '34333']) {
    fs.mkdirSync(path.join(d, `assets/${id}/pages`), { recursive: true });
    for (const n of [1, 2]) fs.writeFileSync(path.join(d, `assets/${id}/pages/${n}.png`), 'p');
  }
  const r = await onGetirme.paketeUygula(d);
  assert.deepEqual(r.map((x) => [x.kitap, x.sayfa, x.sebep]), [['kapak', 4, 'enjekte-edildi']]);
  const kapak = oku(d, 'kapak/index.html');
  assert.ok(kapak.includes(onGetirme.ISARET));
  assert.ok(kapak.includes("SAYFALAR.filter(function(y){ return y.indexOf('assets/' + KAPAK + '/') === 0; })"));
  assert.ok(!oku(d, 'index.html').includes(onGetirme.ISARET), 'kabuk ısıtma yapmaz');
  assert.deepEqual(A1.kapakDenetle(kapak), [], 'A1 başlığı bozulmadı');
  // Süzgeç çalışma anında: ?kapak=34333 → yalnız o kitabın sayfaları.
  const betik = /<script>\/\*EMPP_ON_GETIRME\*\/([\s\S]*?)<\/script>/.exec(kapak)[1];
  const okunan = [];
  const sahteWin = { require: () => ({ readFile: (y, cb) => { okunan.push(y); cb(null, 'x'); }, join: (...a) => a.join('/') }) };
  new Function('window', 'location', 'document', 'setTimeout', '__dirname', betik)(
    sahteWin, { search: '?kapak=034333&defaultPageNo=3' }, { visibilityState: 'visible', readyState: 'complete', addEventListener() {} },
    (f) => f(), '/kok');
  assert.ok(okunan.length > 0, 'ısıtma başladı');
  assert.ok(okunan.every((y) => y.includes('assets/34333/')), okunan.join(','));
});
