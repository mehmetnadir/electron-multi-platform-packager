'use strict';

/**
 * kaynak-karari.js — SAF kaynak kararı (exe'siz sözleşme, Nadir 01.10).
 * Üç dal (manuel / arşiv / yok) + karışık durumlar + manuel zip biçimi.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  KAYNAK_YOK_SEBEBI, manuelKaynakUrl, kaynakKarari, manuelZipBicimi, exeYoluMu,
} = require('./kaynak-karari');

const ARSIV = { zip: '/arsiv/45482/build.zip', md5: 'a'.repeat(32), boyut: 10, etiket: 't', srcVersion: 'arsiv-aaaaaaaaaaaa' };
const R2 = 'https://acc.r2.cloudflarestorage.com/yayinci';
const IMZA = '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc';

// ─── 1. MANUEL ──────────────────────────────────────────────────────────────────────────────

test('manuel: /sources/ adresi → manuel, merdiven ve set eki KAPALI', () => {
  const url = `${R2}/sources/45482/20261001-120000-shallwe8.zip${IMZA}`;
  const k = kaynakKarari({ job: { bookId: '45482', platform: 'android', downloadUrl: url } });
  assert.deepEqual(k, { tur: 'manuel', url, merdiven: false, setEki: false });
});

test('manuel: /kaynak/ adresi (sözleşme §5 R2 yeri) → manuel', () => {
  const url = `${R2}/kaynak/45482/2.51.3/build.zip${IMZA}`;
  assert.equal(kaynakKarari({ job: { downloadUrl: url } }).tur, 'manuel');
});

test('manuel: claim kaynakTuru=manuel (adres işaretsiz olsa da) → manuel; büyük/küçük harf + boşluk duyarsız', () => {
  const url = `${R2}/baska/yer/build.zip${IMZA}`;
  assert.equal(kaynakKarari({ job: { kaynakTuru: 'manuel', downloadUrl: url } }).tur, 'manuel');
  assert.equal(kaynakKarari({ job: { kaynakTuru: ' Manuel ', downloadUrl: url } }).tur, 'manuel');
});

test('manuel: işaret SORGU dizesinde ise sayılmaz (yalnız yol)', () => {
  const url = `${R2}/akillitahtalar/45482/x.zip?yol=/sources/45482/`;
  assert.equal(manuelKaynakUrl({ downloadUrl: url }), null);
});

// ─── 2. ARŞİV ───────────────────────────────────────────────────────────────────────────────

test('arşiv: kaydı varsa ve manuel değilse → arşiv, merdiven ve set eki AÇIK', () => {
  const k = kaynakKarari({ job: { bookId: '45482', downloadUrl: `${R2}/akillitahtalar/45482/ShallWe8-v47.exe${IMZA}` }, arsiv: ARSIV });
  assert.equal(k.tur, 'arsiv');
  assert.equal(k.arsiv, ARSIV);
  assert.equal(k.merdiven, true);
  assert.equal(k.setEki, true);
});

test('arşiv: downloadUrl hiç yokken de arşiv kullanılır (exe adresi gerekmez)', () => {
  assert.equal(kaynakKarari({ job: { bookId: '45482' }, arsiv: ARSIV }).tur, 'arsiv');
});

// ─── 3. YOK ─────────────────────────────────────────────────────────────────────────────────

test('yok: İmpark exe adresi (köprü presigned) + arşiv yok → yok (exe İNDİRİLMEZ)', () => {
  const k = kaynakKarari({ job: { downloadUrl: `${R2}/akillitahtalar/45472/YDT-Marvel-Grade-12-Set-v62.exe${IMZA}` } });
  assert.deepEqual(k, { tur: 'yok', sebep: KAYNAK_YOK_SEBEBI, merdiven: false, setEki: false });
  assert.equal(KAYNAK_YOK_SEBEBI, 'build yok — exe\'siz sözleşme: arşiv/manuel kaynak gerekli');
});

test('yok: origin exe adresi (/Uploads/KitapTekExe/) + arşiv yok → yok', () => {
  const k = kaynakKarari({ job: { downloadUrl: 'https://www.yayinci.com/Uploads/KitapTekExe/45100/MP8-v49.exe' }, arsiv: null });
  assert.equal(k.tur, 'yok');
});

test('yok: downloadUrl yok, arşiv yok → yok', () => {
  assert.equal(kaynakKarari({ job: { bookId: '1', platform: 'mac' } }).tur, 'yok');
  assert.equal(kaynakKarari({ job: { bookId: '1', downloadUrl: '' } }).tur, 'yok');
  assert.equal(kaynakKarari({}).tur, 'yok');
});

test('yok: arşiv nesnesi zip yolu taşımıyorsa arşiv sayılmaz', () => {
  assert.equal(kaynakKarari({ job: {}, arsiv: {} }).tur, 'yok');
  assert.equal(kaynakKarari({ job: {}, arsiv: { md5: 'x' } }).tur, 'yok');
});

// ─── KARIŞIK ────────────────────────────────────────────────────────────────────────────────

test('karışık: manuel + arşiv ikisi de var → MANUEL kazanır (öncelik 1)', () => {
  const url = `${R2}/sources/45482/k.zip${IMZA}`;
  const k = kaynakKarari({ job: { downloadUrl: url }, arsiv: ARSIV });
  assert.equal(k.tur, 'manuel');
  assert.equal(k.url, url);
});

test('karışık: /sources/ altında .exe → manuel SAYILMAZ (exe hiçbir koşulda); arşiv varsa arşiv, yoksa yok', () => {
  const url = `${R2}/sources/45482/k.EXE${IMZA}`;
  assert.equal(manuelKaynakUrl({ downloadUrl: url }), null);
  assert.equal(kaynakKarari({ job: { downloadUrl: url }, arsiv: ARSIV }).tur, 'arsiv');
  assert.equal(kaynakKarari({ job: { downloadUrl: url } }).tur, 'yok');
});

test('karışık: kaynakTuru=manuel ama adres .exe ya da yok → yok, sebep bunu söyler', () => {
  for (const downloadUrl of [`${R2}/x/y.exe`, '', undefined]) {
    const k = kaynakKarari({ job: { kaynakTuru: 'manuel', downloadUrl } });
    assert.equal(k.tur, 'yok');
    assert.match(k.sebep, /^build yok — exe'siz sözleşme: arşiv\/manuel kaynak gerekli \(claim kaynakTuru=manuel/);
  }
});

test('karışık: kaynakTuru=manuel + adres .exe + arşiv var → arşiv (exe yine indirilmez)', () => {
  assert.equal(kaynakKarari({ job: { kaynakTuru: 'manuel', downloadUrl: `${R2}/x/y.exe` }, arsiv: ARSIV }).tur, 'arsiv');
});

test('karışık: kaynakTuru başka bir değer (ör. "arsiv") manuel saymaz', () => {
  assert.equal(kaynakKarari({ job: { kaynakTuru: 'arsiv', downloadUrl: `${R2}/x/build.zip` } }).tur, 'yok');
});

// ─── exe yolu + manuel zip biçimi ──────────────────────────────────────────────────────────

test('exeYoluMu: yol sonu .exe (sorgu/hash/son eğik çizgi yok sayılır)', () => {
  assert.equal(exeYoluMu('https://x/a/b.exe'), true);
  assert.equal(exeYoluMu('https://x/a/b.EXE?X-Amz-Signature=1'), true);
  assert.equal(exeYoluMu('https://x/a/b.exe#frag'), true);
  assert.equal(exeYoluMu('https://x/a/b.zip?f=c.exe'), false);
  assert.equal(exeYoluMu('https://x/a/exe/b.zip'), false);
  assert.equal(exeYoluMu(''), false);
  assert.equal(exeYoluMu(null), false);
});

test('manuelZipBicimi: kök build (index.html/assets/bookN) → kok, artıksız', () => {
  assert.deepEqual(manuelZipBicimi(['index.html', 'assets/45482/thumbs/1.jpg']), { bicim: 'kok', temizle: false });
  assert.deepEqual(manuelZipBicimi(['index.html', 'book1/assets/25775/pages/1.png', 'core/x.js']), { bicim: 'kok', temizle: false });
  assert.deepEqual(manuelZipBicimi([]), { bicim: 'kok', temizle: false });
  assert.deepEqual(manuelZipBicimi(undefined), { bicim: 'kok', temizle: false });
});

test('manuelZipBicimi: içinde resources/app/build/ olan kurulum ağacı (59480 tipi) → eski-kurulum', () => {
  assert.equal(manuelZipBicimi(['Flashy Grade 8 Set/Flashy.exe',
    'Flashy Grade 8 Set/resources/app/build/index.html']).bicim, 'eski-kurulum');
  assert.equal(manuelZipBicimi(['resources/app/build/index.html']).bicim, 'eski-kurulum');
  assert.equal(manuelZipBicimi(['a\\resources\\app\\build\\index.html']).bicim, 'eski-kurulum');
  // "resources/app/builder" gibi benzer ad yanlış pozitif vermez
  assert.notEqual(manuelZipBicimi(['resources/app/builder/x.js']).bicim, 'eski-kurulum');
});

test('manuelZipBicimi: Finder sıkıştırması — tek klasör + __MACOSX → sarmalayici, temizle', () => {
  assert.deepEqual(manuelZipBicimi(['build/', 'build/index.html', 'build/assets/1/a.jpg',
    '__MACOSX/', '__MACOSX/build/._index.html']), { bicim: 'sarmalayici', temizle: true, kokKlasor: 'build' });
  // kök build + .DS_Store/._ artığı → kok ama temizlenir
  assert.deepEqual(manuelZipBicimi(['index.html', 'assets/1/a.jpg', '.DS_Store', '._index.html']),
    { bicim: 'kok', temizle: true });
  // __MACOSX içindeki resources/app/build eski-kurulum SAYILMAZ (yanlış pozitif yok)
  assert.equal(manuelZipBicimi(['index.html', 'assets/1/a', '__MACOSX/x/resources/app/build/._i']).bicim, 'kok');
  // tek kök dosya (klasör değil) sarmalayıcı sayılmaz
  assert.equal(manuelZipBicimi(['index.html']).bicim, 'kok');
});

// Sunucu sözleşmesi (book-update ajan-kaynak-turu.ts nextJobKaynakSemasi): 'arsiv-gerekli' claim'inde
// downloadUrl YOK, exe adresi yalnız bilgiUrl'de. Adres olsa bile (eski/yanlış sunucu) manuel sayılmaz.
test('arsiv-gerekli: downloadUrl yok + bilgiUrl (exe) → arşiv varsa arşiv, yoksa yok; bilgiUrl ASLA indirilmez', () => {
  const job = { kaynakTuru: 'arsiv-gerekli', bilgiUrl: `${R2}/akillitahtalar/45472/YDT-Set-v62.exe` };
  assert.equal(kaynakKarari({ job }).tur, 'yok');
  assert.equal(kaynakKarari({ job, arsiv: ARSIV }).tur, 'arsiv');
  assert.equal(manuelKaynakUrl({ ...job, downloadUrl: `${R2}/sources/45472/k.zip` }), null,
    'arsiv-gerekli claim\'inde /sources/ adresi bile manuel sayılmaz');
});

test('arşiv içeriksiz + set + üreteç → üreteç', () => {
  const arsiv = { ...ARSIV, iceriksiz: true };
  const job = { kaynakTuru: 'r2-kur', kaynakSurumu: '2.0.0', setKimligi: '1' };
  const r = kaynakKarari({ job, arsiv, uretec: true });
  assert.equal(r.tur, 'r2-kur');
  assert.equal(r.taban.tur, 'uretec');
});

test('arşiv içeriksiz + tek kitap + üreteç → arşiv (eski hata)', () => {
  const arsiv = { zip: 'arsiv.zip', iceriksiz: true };
  const job = { kaynakTuru: 'r2-kur', kaynakSurumu: '2.0.0' };
  const r = kaynakKarari({ job, arsiv, uretec: true });
  assert.equal(r.tur, 'r2-kur');
  assert.equal(r.taban.tur, 'arsiv');
  assert.equal(r.taban.arsiv, arsiv);
});
