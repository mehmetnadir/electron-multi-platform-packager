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
  assert.equal(A.exeAdiGecerli('Türkçe Başlık! (2).exe'), true);
  for (const kotu of ['../x.exe', '..\\x.exe', 'a/b.exe', 'a\\b.exe', 'C:x.exe', 'x.dll', '']) {
    assert.equal(A.exeAdiGecerli(kotu), false, kotu);
  }
});

test('kopya + son.json: <kök>/<Set adı>.exe, sha/boyut/meta yazılır', async () => {
  const o = ortam();
  const r = await A.arsivle(o.temel());
  assert.equal(r.durum, 'arsivlendi', JSON.stringify(r));
  const hedef = path.join(o.kok, 'Kitap.exe');
  assert.equal(r.hedef, hedef);
  assert.deepEqual(fs.readFileSync(hedef), o.govde);
  const son = JSON.parse(fs.readFileSync(path.join(o.kok, '45449', 'son.json'), 'utf8'));
  assert.equal(son.bookId, '45449');
  assert.equal(son.baslik, 'Kitap');
  assert.equal(son.surum, '2.1.2');
  assert.equal(son.exe, 'Kitap.exe');
  assert.equal(son.exeYolu, 'Kitap.exe');
  assert.equal(son.sha256, sha(o.govde));
  assert.equal(son.boyut, o.govde.length);
  assert.equal(son.imzaZamani, 'Oct  6 10:00:00 2026 GMT');
  assert.equal(son.yayinZamani, '2026-10-06T10:00:00.000Z');
  assert.equal(son.r2Anahtari, 'softwares/45449/x.exe');
  assert.ok(son.arsivZamani);
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
  
  fs.writeFileSync(path.join(k, 'son.json'), JSON.stringify({ bookId: '45449', exe: 'Kitap Eski.exe', exeYolu: 'Kitap Eski.exe' }));
  fs.writeFileSync(path.join(o.kok, 'Kitap Eski.exe'), 'kök eski');

  const r = await A.arsivle(o.temel());
  assert.equal(r.durum, 'arsivlendi', JSON.stringify(r));
  assert.deepEqual(r.silinen.sort(), ['Kitap Eski.exe', 'runner-45449-Kitap-2.1.0-Setup.exe', 'runner-45449-Kitap-2.1.1-Setup.EXE']);
  assert.deepEqual(fs.readdirSync(k).sort(), ['alt.exe', 'not.txt', 'son.json']);
  assert.equal(var_(path.join(k, 'alt.exe', 'icerde.exe')), true);
  assert.equal(var_(path.join(o.kok, 'Kitap Eski.exe')), false);
  assert.equal(var_(path.join(o.kok, 'Kitap.exe')), true);
});

test('aynı sürüm yeniden yayınlanınca üzerine yazılır, başka kitabın klasörüne dokunulmaz', async () => {
  const o = ortam();
  fs.mkdirSync(o.kok, { recursive: true });
  fs.writeFileSync(path.join(o.kok, 'Baska.exe'), 'baska');
  const baska = path.join(o.kok, '72379');
  fs.mkdirSync(baska, { recursive: true });
  fs.writeFileSync(path.join(baska, 'son.json'), JSON.stringify({ bookId: '72379', exe: 'Kitap.exe' }));
  
  const r = await A.arsivle(o.temel());
  assert.equal(r.durum, 'arsivlendi');
  assert.equal(r.hedef, path.join(o.kok, 'Kitap (45449).exe'));
  assert.deepEqual(fs.readFileSync(r.hedef), o.govde);
  assert.equal(fs.readFileSync(path.join(o.kok, 'Baska.exe'), 'utf8'), 'baska');
});

test('sha uyuşmazsa: eski sürüm SİLİNMEZ, yeni yerleşmez, geçici kalmaz, uyarı + bildirim', async () => {
  const o = ortam();
  const k = path.join(o.kok, '45449');
  fs.mkdirSync(k, { recursive: true });
  fs.writeFileSync(path.join(o.kok, 'Kitap.exe'), 'eski');
  fs.writeFileSync(path.join(k, 'son.json'), '{"surum":"2.1.1","exeYolu":"Kitap.exe"}\n');
  const r = await A.arsivle(o.temel({ beklenenSha256: 'f'.repeat(64) }));
  assert.equal(r.durum, 'hata');
  assert.match(r.sebep, /sha256 uyuşmadı/);
  assert.deepEqual(fs.readdirSync(k).sort(), ['son.json']);
  assert.equal(fs.readFileSync(path.join(k, 'son.json'), 'utf8'), '{"surum":"2.1.1","exeYolu":"Kitap.exe"}\n');
  assert.equal(fs.readFileSync(path.join(o.kok, 'Kitap.exe'), 'utf8'), 'eski');
  assert.equal(o.kayit.bildir.length, 1);
  assert.match(o.kayit.bildir[0], /^İmzalı arşiv 45449: kopya: sha256 uyuşmadı/);
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
  const k = path.join(o.kok, '45449');
  fs.mkdirSync(k, { recursive: true });
  fs.writeFileSync(path.join(o.kok, 'Kitap.exe'), 'eski2.1.3');
  fs.writeFileSync(path.join(k, 'son.json'), JSON.stringify({ yayinZamani: '2026-10-06T10:00:00.000Z', exeYolu: 'Kitap.exe', surum: '2.1.3' }));
  const r = await A.arsivle(o.temel({ eskiyseAtla: true }));
  assert.equal(r.durum, 'atlandi');
  assert.match(r.sebep, /arşivde aynı\/yeni sürüm var \(2\.1\.3/);
  assert.equal(fs.readFileSync(path.join(o.kok, 'Kitap.exe'), 'utf8'), 'eski2.1.3');
  const r2 = await A.arsivle(o.temel({ eskiyseAtla: true, meta: { yayinZamani: '2026-10-06T10:00:00.001Z' } }));
  assert.equal(r2.durum, 'arsivlendi');
  assert.deepEqual(fs.readFileSync(r2.hedef), o.govde);
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
  fs.writeFileSync(path.join(o.kok, '.Kitap.exe.yaziliyor-123'), 'yarim');
  const r = await A.arsivle(o.temel({ beklenenSha256: null }));
  assert.equal(r.durum, 'arsivlendi');
  assert.equal(var_(path.join(o.kok, '.Kitap.exe.yaziliyor-123')), false);
  const son = JSON.parse(fs.readFileSync(path.join(k, 'son.json'), 'utf8'));
  assert.equal(son.sha256, sha(o.govde));
});


// Ş8 (inceleme 06.10): NTFS harf duyarsız. Diskte eski ad `setup.exe` kalmış, yeni sürüm `Setup.exe`
// adıyla yazılmış (aynı dosya). Harf duyarlı kıyas onu "eski" sayıp YENİ arşivi siliyordu.
test('Ş8 win32: tut ile yalnız harfleri farklı ad SİLİNMEZ (Setup.exe vs setup.exe)', async () => {
  const o = ortam();
  const k = path.join(o.kok, '45496');
  fs.mkdirSync(k, { recursive: true });
  fs.writeFileSync(path.join(o.kok, 'setup.exe'), 'YENI');
  fs.writeFileSync(path.join(o.kok, 'eski-1.0.0.exe'), 'eski');
  const r = await A.eskileriSil(o.kok, k, 'eski-1.0.0.exe', 'Setup.exe', () => {}, 'win32');
  assert.deepEqual(r.silinen, ['eski-1.0.0.exe']);
  assert.equal(fs.readFileSync(path.join(o.kok, 'setup.exe'), 'utf8'), 'YENI', 'yeni arşiv silindi');

  // yol biçiminde tut da aynı dosyayı korur (basename normalizasyonu)
  fs.writeFileSync(path.join(k, 'eski-0.9.exe'), 'eski');
  const r2 = await A.eskileriSil(o.kok, k, 'setup.exe', 'D:\\empp-imzali-son\\45496\\SETUP.EXE', () => {}, 'win32');
  assert.deepEqual(r2.silinen, ['eski-0.9.exe']);
  assert.equal(fs.existsSync(path.join(o.kok, 'setup.exe')), true);
});
test('exeAdiGecerli: gizli/sonu nokta-boşluk/aygıt adı/sürücü RED; Türkçe + ! kabul', () => {
  for (const kotu of ['.gizli.exe', 'x..exe', 'x .exe', 'x..exe', 'CON.exe', 'nul.exe', ' x.exe', 'a:b.exe', 'a*b.exe', '.exe']) {
    assert.equal(A.exeAdiGecerli(kotu), false, kotu);
  }
  for (const iyi of ['Shall We ! 6 Set.exe', 'Lingoland Grade 2 - Maarif Model.exe', 'Ğüşiöç İI.exe', 'Super Monsters 4 Set.exe']) {
    assert.equal(A.exeAdiGecerli(iyi), true, iyi);
  }
});

test('GEÇİŞ: eski son.json exe adı kökte yok, eski <bookId>\\*.exe yok → sorunsuz arşivlenir', async () => {
  const o = ortam();
  const k = path.join(o.kok, '45449');
  fs.mkdirSync(k, { recursive: true });
  fs.writeFileSync(path.join(k, 'son.json'), JSON.stringify({ bookId: '45449', exe: 'runner-45449-Kitap-2.1.1-Setup.exe' }));
  fs.writeFileSync(path.join(o.kok, 'Baska Set.exe'), 'baska');
  const r = await A.arsivle(o.temel());
  assert.equal(r.durum, 'arsivlendi', JSON.stringify(r));
  assert.deepEqual(r.silinen, []);
  assert.deepEqual(fs.readdirSync(o.kok).sort(), ['45449', 'Baska Set.exe', 'Kitap.exe']);
  assert.equal(fs.readFileSync(path.join(o.kok, 'Baska Set.exe'), 'utf8'), 'baska');
});

test('başlık değişince eski ad silinir; BAŞKA setin exe\'si (kayıtlı adı eski adla çakışsa bile) SİLİNMEZ', async () => {
  const o = ortam();
  fs.mkdirSync(path.join(o.kok, '45449'), { recursive: true });
  fs.mkdirSync(path.join(o.kok, '72379'), { recursive: true });
  fs.writeFileSync(path.join(o.kok, '45449', 'son.json'), JSON.stringify({ bookId: '45449', exeYolu: 'Eski Baslik.exe' }));
  fs.writeFileSync(path.join(o.kok, 'Eski Baslik.exe'), 'eski');
  fs.writeFileSync(path.join(o.kok, '72379', 'son.json'), JSON.stringify({ bookId: '72379', exeYolu: 'Diger Set.exe' }));
  fs.writeFileSync(path.join(o.kok, 'Diger Set.exe'), 'diger');
  let r = await A.arsivle(o.temel());
  assert.equal(r.durum, 'arsivlendi');
  assert.deepEqual(r.silinen, ['Eski Baslik.exe']);
  assert.equal(var_(path.join(o.kok, 'Diger Set.exe')), true);
  // bozuk kayıt: 45449'un son.json'u başka setin adını gösteriyor → o ad silinmez
  fs.writeFileSync(path.join(o.kok, '45449', 'son.json'), JSON.stringify({ bookId: '45449', exeYolu: 'Diger Set.exe' }));
  r = await A.arsivle(o.temel());
  assert.equal(r.durum, 'arsivlendi');
  assert.equal(fs.readFileSync(path.join(o.kok, 'Diger Set.exe'), 'utf8'), 'diger', 'başka setin exe\'si korundu');
});

test('çakışma eki: kökte başka setin adı varsa " (<bookId>)"; kötü başlık güvenli ada iner', async () => {
  const o = ortam();
  fs.mkdirSync(path.join(o.kok, '72379'), { recursive: true });
  fs.writeFileSync(path.join(o.kok, '72379', 'son.json'), JSON.stringify({ bookId: '72379', exe: 'Kitap.exe', exeYolu: 'Kitap.exe' }));
  fs.writeFileSync(path.join(o.kok, 'Kitap.exe'), 'diger');
  const r = await A.arsivle(o.temel());
  assert.equal(r.hedef, path.join(o.kok, 'Kitap (45449).exe'));
  assert.equal(fs.readFileSync(path.join(o.kok, 'Kitap.exe'), 'utf8'), 'diger');
  const r2 = await A.arsivle(o.temel({ bookId: '45450', meta: { baslik: '../../Evil: <x>?', surum: '1' } }));
  assert.equal(r2.durum, 'arsivlendi', JSON.stringify(r2));
  assert.equal(path.dirname(r2.hedef), o.kok);
  assert.equal(path.basename(r2.hedef), 'Evil x.exe');
  const r3 = await A.arsivle(o.temel({ bookId: '45451', meta: { baslik: '...', surum: '1' } }));
  assert.equal(path.basename(r3.hedef), 'Kitap (45451).exe', 'başlık boşa inerse özgün adtan türer');
});

test('baslik yoksa özgün Setup adından runner-<id>- ve -<sürüm>-Setup atılır', async () => {
  const o = ortam();
  const r = await A.arsivle(o.temel({ exeAdi: 'runner-45449-Shall-We-6-Set-2.1.2-Setup.exe', meta: { surum: '2.1.2' } }));
  assert.equal(path.basename(r.hedef), 'Shall We 6 Set.exe');
});
