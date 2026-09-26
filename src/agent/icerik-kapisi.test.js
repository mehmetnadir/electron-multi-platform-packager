'use strict';

/**
 * İÇERİKSİZ KAYNAK KAPISI — T1 (2026-09-26).
 * bkz. `~/.empp-agent/arastirma/set-koku-ezilmis-kok-neden-20260926.md` "Regresyon
 * testi taslakları" bölümü. Sentetik dizinlerle — gerçek İmpark zip'i GEREKMEZ.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const AdmZip = require('adm-zip');
const {
  KAPI_ISARETI, acikMi, bookNMi, degerlendir, dizinTara, icerikKapisiDenetle,
  yolListesiTara, girisListesindenDegerlendir, zipGirisAdlariniOku, icerikKapisiDenetleZip,
} = require('./icerik-kapisi');

/** 11845 (SM3-v49.exe) tarzı — yalnız motor: kökte assets/ yok, bookN/ yok. */
async function motorKopyasiDizinKur() {
  const kok = await fsp.mkdtemp(path.join(os.tmpdir(), 'icerik-kapisi-motor-'));
  await fsp.writeFile(path.join(kok, 'index.html'),
    '<html><head><script defer src="./a8f43f74c72b65a3dd05.main.js"></script></head><body></body></html>');
  await fsp.writeFile(path.join(kok, 'app.config.js'), 'module.exports = {};');
  await fsp.mkdir(path.join(kok, 'core'), { recursive: true });
  await fsp.writeFile(path.join(kok, 'core', 'x.png'), 'binary-ish');
  await fsp.mkdir(path.join(kok, 'i18n'), { recursive: true });
  await fsp.writeFile(path.join(kok, 'i18n', 'tr.js'), 'module.exports = {};');
  await fsp.mkdir(path.join(kok, 'classlibraries'), { recursive: true });
  await fsp.writeFile(path.join(kok, 'classlibraries', 'ImWin32.dll'), 'fake-dll');
  return kok;
}

// ---------------------------------------------------------------------------
// Saf fonksiyon — degerlendir
// ---------------------------------------------------------------------------

test('degerlendir: assets de bookN de yoksa [kaynak-iceriksiz] ile düşer', () => {
  const r = degerlendir({ hasAssets: false, hasBookN: false });
  assert.equal(r.gecti, false);
  assert.match(r.sebep, /^\[kaynak-iceriksiz\]/);
  assert.match(r.sebep, /bookN 0, assets\/ yok/);
});

test('degerlendir: yalnız assets varsa geçer (tek kitap)', () => {
  assert.equal(degerlendir({ hasAssets: true, hasBookN: false }).gecti, true);
});

test('degerlendir: yalnız bookN varsa geçer (SET)', () => {
  assert.equal(degerlendir({ hasAssets: false, hasBookN: true }).gecti, true);
});

test('degerlendir: ikisi de varsa geçer', () => {
  assert.equal(degerlendir({ hasAssets: true, hasBookN: true }).gecti, true);
});

test('degerlendir: kaynakAdi verilirse hata metnine <etiket> olarak eklenir', () => {
  const r = degerlendir({ hasAssets: false, hasBookN: false, kaynakAdi: 'SM3-v49.exe' });
  assert.match(r.sebep, /<SM3-v49\.exe>/);
});

test('bookNMi: book1/book12 EVET, books/bookabc/book HAYIR', () => {
  assert.equal(bookNMi('book1'), true);
  assert.equal(bookNMi('book12'), true);
  assert.equal(bookNMi('BOOK3'), true);
  assert.equal(bookNMi('books'), false);
  assert.equal(bookNMi('bookabc'), false);
  assert.equal(bookNMi('book'), false);
});

// ---------------------------------------------------------------------------
// Gerçek dizin — dizinTara / icerikKapisiDenetle (T1 senaryosu, rapordaki tarif)
// ---------------------------------------------------------------------------

test('GERİLEME (T1): 11845 tarzı motor kopyası — assets/ yok, bookN/ yok → RED', async () => {
  const kok = await motorKopyasiDizinKur();
  const sonuc = await icerikKapisiDenetle(kok, { kaynakAdi: 'SM3-v49.exe' });
  assert.equal(sonuc.gecti, false);
  assert.match(sonuc.sebep, /\[kaynak-iceriksiz\]/);
});

test('T1: aynı dizine assets/ eklenince GEÇER (tek kitap)', async () => {
  const kok = await motorKopyasiDizinKur();
  await fsp.mkdir(path.join(kok, 'assets', '72378', 'thumbs'), { recursive: true });
  await fsp.writeFile(path.join(kok, 'assets', '72378', 'thumbs', '1.jpg'), 'jpg');
  const sonuc = await icerikKapisiDenetle(kok);
  assert.equal(sonuc.gecti, true);
  assert.equal(sonuc.sebep, null);
});

test('T1: aynı dizine book1/app.config.js eklenince GEÇER (SET)', async () => {
  const kok = await motorKopyasiDizinKur();
  await fsp.mkdir(path.join(kok, 'book1'), { recursive: true });
  await fsp.writeFile(path.join(kok, 'book1', 'app.config.js'), 'module.exports = {};');
  const sonuc = await icerikKapisiDenetle(kok);
  assert.equal(sonuc.gecti, true);
});

test('dizinTara: olmayan dizin ikisini de false döner (fırlatmaz)', async () => {
  const r = await dizinTara(path.join(os.tmpdir(), 'icerik-kapisi-yok-' + Date.now()));
  assert.deepEqual(r, { hasAssets: false, hasBookN: false });
});

test('dizinTara: assets bir DOSYA ise (dizin değil) sayılmaz', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-kapisi-dosya-'));
  fs.writeFileSync(path.join(kok, 'assets'), 'bu bir dosya, dizin degil');
  const r = await dizinTara(kok);
  assert.equal(r.hasAssets, false);
});

test('45551-v50 tarzı (Web-Z kabuğu YOK, İmpark motoru) senaryosu da RED verir', async () => {
  // Rapor: 45551 işi 26.09 10:30 UTC'de İmpark canlısını indirdi — build.zip 527 dosya,
  // bookN 0, kökte app.config.js bile yoktu (yalnız motor kanonu, index.html md5 c53f0c84…).
  const kok = await fsp.mkdtemp(path.join(os.tmpdir(), 'icerik-kapisi-45551-'));
  await fsp.writeFile(path.join(kok, 'index.html'), '<html><body>motor kanonu</body></html>');
  await fsp.mkdir(path.join(kok, 'core'), { recursive: true });
  await fsp.writeFile(path.join(kok, 'core', 'engine.js'), '// motor');
  const sonuc = await icerikKapisiDenetle(kok, { kaynakAdi: 'ShallWe5-24-v50.exe' });
  assert.equal(sonuc.gecti, false);
});

test('KAPI_ISARETI dışa aktarılır ve sebep metninde kullanılır', () => {
  const r = degerlendir({ hasAssets: false, hasBookN: false });
  assert.ok(r.sebep.startsWith(KAPI_ISARETI));
});

// ---------------------------------------------------------------------------
// Bildirim entegrasyonu (koordinatör ek kapsam, 2026-09-26): bu kapının fırlattığı
// hata runner'ın GENEL başarısızlık yolundan geçmeli (errlog + bildirGonder(basarili:false)
// + postResultFailure) — ne "ertelenebilir" (disk/ProBook darlığı) ne "geçici ağ hatası"
// sayılmalı, yoksa main() döngüsü bildirim ATMADAN sessizce yeniden dener/atlar.
// bkz. src/agent/runner.js `main()` — ertelenebilirKaynakHatasi/isTransientNetworkError
// ikisi de false dönerse errlog+bildirGonder+postResultFailure çalışır.
// ---------------------------------------------------------------------------

test('[kaynak-iceriksiz] hatası ERTELENEBİLİR sayılmaz (bildirim atlanmaz)', () => {
  const { ertelenebilirKaynakHatasi } = require('./runner-helpers');
  const r = degerlendir({ hasAssets: false, hasBookN: false, kaynakAdi: 'SM3-v49.exe' });
  assert.equal(ertelenebilirKaynakHatasi(new Error(r.sebep)), false);
});

test('[kaynak-iceriksiz] hatası GEÇİCİ AĞ HATASI sayılmaz (bildirim atlanmaz)', () => {
  const { isTransientNetworkError } = require('./runner-helpers');
  const r = degerlendir({ hasAssets: false, hasBookN: false, kaynakAdi: 'SM3-v49.exe' });
  assert.equal(isTransientNetworkError(new Error(r.sebep)), false);
});

// ---------------------------------------------------------------------------
// EMPP_ICERIK_KAPISI — kapatma anahtarı (2026-09-26, koordinatör ek işi):
// canlıda yanlış-RED üretirse tüm üretim durmasın diye acil kapatma.
// tanımsız/'1' = AÇIK (bugünkü davranış), '0' = KAPALI.
// ---------------------------------------------------------------------------

test('acikMi: env tanımsızsa AÇIK (varsayılan — bugünkü davranış)', () => {
  assert.equal(acikMi({}), true);
});

test("acikMi: '1' AÇIK", () => {
  assert.equal(acikMi({ EMPP_ICERIK_KAPISI: '1' }), true);
});

test("acikMi: '0'/'false'/'kapali'/'kapalı' KAPALI", () => {
  assert.equal(acikMi({ EMPP_ICERIK_KAPISI: '0' }), false);
  assert.equal(acikMi({ EMPP_ICERIK_KAPISI: 'false' }), false);
  assert.equal(acikMi({ EMPP_ICERIK_KAPISI: 'kapali' }), false);
  assert.equal(acikMi({ EMPP_ICERIK_KAPISI: 'kapalı' }), false);
  assert.equal(acikMi({ EMPP_ICERIK_KAPISI: 'KAPALI' }), false);
});

test('icerikKapisiDenetle: kapatma anahtarı KAPALIYSA içeriksiz kaynak bile GEÇER + log satırı düşer', async () => {
  const kok = await motorKopyasiDizinKur(); // assets/bookN YOK — normalde RED
  const loglar = [];
  const sonuc = await icerikKapisiDenetle(kok, {
    env: { EMPP_ICERIK_KAPISI: '0' },
    log: (s) => loglar.push(s),
  });
  assert.equal(sonuc.gecti, true);
  assert.equal(sonuc.sebep, null);
  assert.ok(loglar.some((s) => s.includes('icerik-kapisi KAPALI (env)')), loglar.join('\n'));
});

test('icerikKapisiDenetle: anahtar AÇIKKEN (varsayılan) içeriksiz kaynak yine RED verir', async () => {
  const kok = await motorKopyasiDizinKur();
  const sonuc = await icerikKapisiDenetle(kok, { env: {} });
  assert.equal(sonuc.gecti, false);
});
