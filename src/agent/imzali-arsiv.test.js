'use strict';

/**
 * İmzalı son sürüm arşivi (Nadir 06.10) — sahte kök (os.tmpdir) altında GERÇEK kopya/silme.
 * Gerçek D:\ ya da kasa dizinlerine dokunulmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const A = require('./imzali-arsiv');

const kokler = [];
test.after(() => { for (const k of kokler) fs.rmSync(k, { recursive: true, force: true }); });

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const var_ = (p) => { try { fs.lstatSync(p); return true; } catch (_) { return false; } };

/** Ortam: <r>/D (birim) + <r>/D/empp-imzali-son (kök) + <r>/C/imzali.exe (kaynak). */
function ortam() {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'imzali-arsiv-')));
  kokler.push(r);
  const birim = path.join(r, 'D');
  fs.mkdirSync(birim);
  fs.mkdirSync(path.join(r, 'C'));
  const govde = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(5000), Buffer.from('IMZA')]);
  const kaynak = path.join(r, 'C', 'imzali.exe');
  fs.writeFileSync(kaynak, govde);
  const kayit = { log: [], bildir: [] };
  const temel = (ek = {}) => ({
    kaynak, bookId: '45449', exeAdi: 'runner-45449-Kitap-2.1.2-Setup.exe', beklenenSha256: sha(govde),
    meta: { baslik: 'Kitap', surum: '2.1.2', imzaZamani: 'Oct  6 10:00:00 2026 GMT', yayinZamani: '2026-10-06T10:00:00.000Z', r2Anahtari: 'softwares/45449/x.exe' },
    kok: path.join(birim, 'empp-imzali-son'),
    log: (s) => kayit.log.push(s), bildir: async (m) => { kayit.bildir.push(m); },
    ...ek,
  });
  return { r, birim, kok: path.join(birim, 'empp-imzali-son'), govde, kaynak, kayit, temel };
}

test('saf: arsivKoku — win32 varsayılanı D:\\empp-imzali-son, Mac/Linux null, env ezer, "0" kapatır', () => {
  assert.equal(A.arsivKoku({}, 'win32'), 'D:\\empp-imzali-son');
  assert.equal(A.arsivKoku({}, 'darwin'), null);
  assert.equal(A.arsivKoku({ EMPP_IMZALI_ARSIV_KOKU: 'E:\\a' }, 'darwin'), 'E:\\a');
  assert.equal(A.arsivKoku({ EMPP_IMZALI_ARSIV_KOKU: '0' }, 'win32'), null);
});

test('saf: bookId yalnız rakam; exe adı yalın .exe — yol enjeksiyonu reddi', () => {
  for (const iyi of ['45449', 72379, '1']) assert.equal(A.bookIdGecerli(iyi), true, String(iyi));
  for (const kotu of ['..', '../45449', '45449\\..\\x', 'C:', '45 49', '', null, '45449/', 'abc', '1'.repeat(13)]) {
    assert.equal(A.bookIdGecerli(kotu), false, String(kotu));
  }
  assert.equal(A.exeAdiGecerli('runner-45449-Kitap-2.1.2-Setup.exe'), true);
  assert.equal(A.exeAdiGecerli('Shall We 6 Set - Setup.exe'), true);
  for (const kotu of ['../x.exe', '..\\x.exe', 'a/b.exe', 'a\\b.exe', 'C:x.exe', '.gizli.exe', 'x.dll', 'x..exe', '']) {
    assert.equal(A.exeAdiGecerli(kotu), false, kotu);
  }
});

test('kopya + son.json: <kök>/<bookId>/<özgün Setup adı>.exe, sha/boyut/meta yazılır', async () => {
  const o = ortam();
  const r = await A.arsivle(o.temel());
  assert.equal(r.durum, 'arsivlendi', JSON.stringify(r));
  const hedef = path.join(o.kok, '45449', 'runner-45449-Kitap-2.1.2-Setup.exe');
  assert.equal(r.hedef, hedef);
  assert.deepEqual(fs.readFileSync(hedef), o.govde);
  const son = JSON.parse(fs.readFileSync(path.join(o.kok, '45449', 'son.json'), 'utf8'));
  assert.equal(son.bookId, '45449');
  assert.equal(son.baslik, 'Kitap');
  assert.equal(son.surum, '2.1.2');
  assert.equal(son.exe, 'runner-45449-Kitap-2.1.2-Setup.exe');
  assert.equal(son.sha256, sha(o.govde));
  assert.equal(son.boyut, o.govde.length);
  assert.equal(son.imzaZamani, 'Oct  6 10:00:00 2026 GMT');
  assert.equal(son.yayinZamani, '2026-10-06T10:00:00.000Z');
  assert.equal(son.r2Anahtari, 'softwares/45449/x.exe');
  assert.ok(son.arsivZamani);
  assert.deepEqual(fs.readdirSync(path.join(o.kok, '45449')).sort(), ['runner-45449-Kitap-2.1.2-Setup.exe', 'son.json'], 'geçici dosya kalmadı');
  assert.equal(o.kayit.bildir.length, 0);
  assert.equal(var_(o.kaynak), true, 'kaynak (C) yerinde — taşıma değil kopya');
});

test('eski 2 sürüm silinir, yeni kalır; .exe olmayan dosya ve alt dizin dokunulmaz', async () => {
  const o = ortam();
  const k = path.join(o.kok, '45449');
  fs.mkdirSync(k, { recursive: true });
  fs.writeFileSync(path.join(k, 'runner-45449-Kitap-2.1.0-Setup.exe'), 'eski1');
  fs.writeFileSync(path.join(k, 'runner-45449-Kitap-2.1.1-Setup.EXE'), 'eski2');
  fs.writeFileSync(path.join(k, 'not.txt'), 'not');
  fs.mkdirSync(path.join(k, 'alt.exe'));
  fs.writeFileSync(path.join(k, 'alt.exe', 'icerde.exe'), 'icerde');
  const r = await A.arsivle(o.temel());
  assert.equal(r.durum, 'arsivlendi', JSON.stringify(r));
  assert.deepEqual(r.silinen.sort(), ['runner-45449-Kitap-2.1.0-Setup.exe', 'runner-45449-Kitap-2.1.1-Setup.EXE']);
  assert.deepEqual(fs.readdirSync(k).sort(), ['alt.exe', 'not.txt', 'runner-45449-Kitap-2.1.2-Setup.exe', 'son.json']);
  assert.equal(var_(path.join(k, 'alt.exe', 'icerde.exe')), true);
});

test('aynı sürüm yeniden yayınlanınca üzerine yazılır, başka kitabın klasörüne dokunulmaz', async () => {
  const o = ortam();
  const baska = path.join(o.kok, '72379');
  fs.mkdirSync(baska, { recursive: true });
  fs.writeFileSync(path.join(baska, 'runner-72379-X-2.0.1-Setup.exe'), 'baska');
  fs.mkdirSync(path.join(o.kok, '45449'), { recursive: true });
  fs.writeFileSync(path.join(o.kok, '45449', 'runner-45449-Kitap-2.1.2-Setup.exe'), 'eski içerik aynı ad');
  const r = await A.arsivle(o.temel());
  assert.equal(r.durum, 'arsivlendi');
  assert.deepEqual(fs.readFileSync(path.join(o.kok, '45449', 'runner-45449-Kitap-2.1.2-Setup.exe')), o.govde);
  assert.equal(fs.readFileSync(path.join(baska, 'runner-72379-X-2.0.1-Setup.exe'), 'utf8'), 'baska');
});

test('sha uyuşmazsa: eski sürüm SİLİNMEZ, yeni yerleşmez, geçici kalmaz, uyarı + bildirim', async () => {
  const o = ortam();
  const k = path.join(o.kok, '45449');
  fs.mkdirSync(k, { recursive: true });
  fs.writeFileSync(path.join(k, 'runner-45449-Kitap-2.1.1-Setup.exe'), 'eski');
  fs.writeFileSync(path.join(k, 'son.json'), '{"surum":"2.1.1"}\n');
  const r = await A.arsivle(o.temel({ beklenenSha256: 'f'.repeat(64) }));
  assert.equal(r.durum, 'hata');
  assert.match(r.sebep, /sha256 uyuşmadı/);
  assert.deepEqual(fs.readdirSync(k).sort(), ['runner-45449-Kitap-2.1.1-Setup.exe', 'son.json']);
  assert.equal(fs.readFileSync(path.join(k, 'son.json'), 'utf8'), '{"surum":"2.1.1"}\n', 'son.json eski sürümü göstermeye devam eder');
  assert.equal(o.kayit.bildir.length, 1);
  assert.match(o.kayit.bildir[0], /^İmzalı arşiv 45449: kopya: sha256 uyuşmadı/);
  assert.ok(o.kayit.log.some((s) => /UYARI 45449 arşivlenemedi/.test(s)));
});

test('kaynak okunamazsa (yok) hata döner, FIRLATMAZ, eski yerinde', async () => {
  const o = ortam();
  const k = path.join(o.kok, '45449');
  fs.mkdirSync(k, { recursive: true });
  fs.writeFileSync(path.join(k, 'runner-45449-Kitap-2.1.1-Setup.exe'), 'eski');
  const r = await A.arsivle(o.temel({ kaynak: path.join(o.r, 'C', 'yok.exe') }));
  assert.equal(r.durum, 'hata');
  assert.equal(var_(path.join(k, 'runner-45449-Kitap-2.1.1-Setup.exe')), true);
  assert.equal(o.kayit.bildir.length, 1);
});

test('klasör dışı + bağ: eski sürüm silinirken sembolik bağ (junction eşi) ve hedefi, kardeş klasör, kök dosyası dokunulmaz', async () => {
  const o = ortam();
  const k = path.join(o.kok, '45449');
  fs.mkdirSync(k, { recursive: true });
  const disari = path.join(o.r, 'disari');
  fs.mkdirSync(disari);
  const disariExe = path.join(disari, 'onemli.exe');
  fs.writeFileSync(disariExe, 'onemli');
  fs.symlinkSync(disariExe, path.join(k, 'bag-eski.exe'));
  fs.symlinkSync(disari, path.join(k, 'bag-dizin.exe'));
  fs.writeFileSync(path.join(o.kok, 'kokte.exe'), 'kok');
  fs.writeFileSync(path.join(o.birim, 'birimde.exe'), 'birim');
  const r = await A.arsivle(o.temel());
  assert.equal(r.durum, 'arsivlendi', JSON.stringify(r));
  assert.deepEqual(r.silinen, []);
  assert.equal(fs.readFileSync(disariExe, 'utf8'), 'onemli', 'bağın hedefi silinmedi');
  assert.equal(var_(path.join(k, 'bag-eski.exe')), true, 'bağ izlenmez/silinmez');
  assert.equal(var_(path.join(o.kok, 'kokte.exe')), true);
  assert.equal(var_(path.join(o.birim, 'birimde.exe')), true);
});

test('<bookId> klasörü bağ/junction ise: izlenmez, yazılmaz, hedefteki exe silinmez', async () => {
  const o = ortam();
  fs.mkdirSync(o.kok);
  const disari = path.join(o.r, 'disari');
  fs.mkdirSync(disari);
  fs.writeFileSync(path.join(disari, 'baska.exe'), 'x');
  fs.symlinkSync(disari, path.join(o.kok, '45449'));
  const r = await A.arsivle(o.temel());
  assert.equal(r.durum, 'hata');
  assert.match(r.sebep, /bağ\/junction/);
  assert.deepEqual(fs.readdirSync(disari), ['baska.exe']);
});

test('D: yoksa (birim/üst dizin yok) atlar: hiçbir şey yazılmaz, C:\'ye yedek yok, bildirim yok', async () => {
  const o = ortam();
  const yokKok = path.join(o.r, 'YOK-D', 'empp-imzali-son');
  const r = await A.arsivle(o.temel({ kok: yokKok }));
  assert.equal(r.durum, 'atlandi');
  assert.match(r.sebep, /birim yok/);
  assert.equal(var_(path.join(o.r, 'YOK-D')), false);
  assert.deepEqual(fs.readdirSync(path.join(o.r, 'C')), ['imzali.exe']);
  assert.equal(o.kayit.bildir.length, 0);
  assert.ok(o.kayit.log.some((s) => /atlandı — birim\/üst dizin yok/.test(s)));
});

test('kök null (win32 dışı) → atlandi, yazma yok', async () => {
  const o = ortam();
  const r = await A.arsivle(o.temel({ kok: null }));
  assert.equal(r.durum, 'atlandi');
  assert.deepEqual(fs.readdirSync(o.birim), []);
});

test('bookId doğrulaması: yol enjeksiyonu (../, ayırıcı, harf) reddedilir; kök dışına dosya yazılmaz', async () => {
  const o = ortam();
  for (const id of ['../45449', '..', '45449/../../C', 'abc', '45449\\..\\x']) {
    const r = await A.arsivle(o.temel({ bookId: id }));
    assert.equal(r.durum, 'hata', id);
    assert.match(r.sebep, /bookId geçersiz/);
  }
  const r2 = await A.arsivle(o.temel({ exeAdi: '../../kacak.exe' }));
  assert.equal(r2.durum, 'hata');
  assert.match(r2.sebep, /exe adı geçersiz/);
  assert.deepEqual(fs.readdirSync(o.birim), [], 'kök bile açılmadı');
  assert.deepEqual(fs.readdirSync(o.r).sort(), ['C', 'D']);
});

test('bildirim fırlatsa da arsivle fırlatmaz', async () => {
  const o = ortam();
  const r = await A.arsivle(o.temel({ bookId: 'x', bildir: async () => { throw new Error('ntfy yok'); } }));
  assert.equal(r.durum, 'hata');
});

test('eskiyseAtla (geri doldurma): arşivde aynı/yeni yayın varsa dokunulmaz; eskiyse güncellenir', async () => {
  const o = ortam();
  await A.arsivle(o.temel());
  const r = await A.arsivle(o.temel({ eskiyseAtla: true, exeAdi: 'runner-45449-Kitap-2.1.0-Setup.exe', meta: { yayinZamani: '2026-10-01T00:00:00Z' } }));
  assert.equal(r.durum, 'atlandi');
  assert.match(r.sebep, /aynı\/yeni sürüm/);
  const r2 = await A.arsivle(o.temel({ eskiyseAtla: true, exeAdi: 'runner-45449-Kitap-2.1.3-Setup.exe', meta: { yayinZamani: '2026-10-07T00:00:00Z' } }));
  assert.equal(r2.durum, 'arsivlendi');
  assert.deepEqual(fs.readdirSync(path.join(o.kok, '45449')).sort(), ['runner-45449-Kitap-2.1.3-Setup.exe', 'son.json']);
});

test('kuru: karar döner, yazma/silme yok', async () => {
  const o = ortam();
  const r = await A.arsivle(o.temel({ kuru: true }));
  assert.equal(r.durum, 'kuru');
  assert.deepEqual(fs.readdirSync(o.birim), []);
});

test('beklenen sha verilmezse kaynaktan hesaplanır; yarım geçici dosya (önceki çöküş) temizlenir', async () => {
  const o = ortam();
  const k = path.join(o.kok, '45449');
  fs.mkdirSync(k, { recursive: true });
  fs.writeFileSync(path.join(k, '.runner-45449-Kitap-2.1.1-Setup.exe.yaziliyor-999'), 'yarim');
  const r = await A.arsivle(o.temel({ beklenenSha256: null }));
  assert.equal(r.durum, 'arsivlendi');
  assert.deepEqual(fs.readdirSync(k).sort(), ['runner-45449-Kitap-2.1.2-Setup.exe', 'son.json']);
});
