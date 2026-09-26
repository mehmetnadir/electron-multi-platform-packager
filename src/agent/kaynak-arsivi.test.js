'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { arsivKaynagi, arsivKoku, imparkKaynagiKiyasla } = require('./kaynak-arsivi');
const { srcVersionTuret } = require('./runner-helpers');

function kur(icerik = 'zip-icerigi', kayitEk = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'kaynak-arsivi-'));
  const dizin = path.join(kok, '45482');
  fs.mkdirSync(dizin);
  fs.writeFileSync(path.join(dizin, 'build.zip'), icerik);
  const md5 = crypto.createHash('md5').update(icerik).digest('hex');
  const kayit = { dosya: 'build.zip', md5, boyut: Buffer.byteLength(icerik), etiket: 'uretim-masasi-20260925', ...kayitEk };
  fs.writeFileSync(path.join(dizin, 'kaynak.json'), JSON.stringify(kayit));
  return { kok, dizin, md5 };
}

test('kayıt yoksa null — runner İmpark exe yoluna devam eder', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'kaynak-arsivi-'));
  assert.equal(await arsivKaynagi(45482, { kok }), null);
});

test('geçerli kayıt: zip yolu, md5 ve arşive özgü srcVersion döner', async () => {
  const { kok, dizin, md5 } = kur();
  const r = await arsivKaynagi(45482, { kok });
  assert.equal(r.zip, path.join(dizin, 'build.zip'));
  assert.equal(r.md5, md5);
  assert.equal(r.srcVersion, `arsiv-${md5.slice(0, 12)}`);
  assert.equal(r.etiket, 'uretim-masasi-20260925');
  assert.ok(fs.existsSync(path.join(dizin, '.md5-dogrulandi')), 'md5 damgası yazılmalı');
});

test('GERİLEME: kayıt var ama zip yoksa HATA — eski kaynağa sessizce düşmez', async () => {
  const { kok, dizin } = kur();
  fs.renameSync(path.join(dizin, 'build.zip'), path.join(dizin, 'baska.zip'));
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /zip yok/);
});

test('boyut tutmuyorsa HATA', async () => {
  const { kok } = kur('abc', { boyut: 999 });
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /boyut tutmuyor/);
});

test('md5 tutmuyorsa HATA ve damga yazılmaz', async () => {
  const { kok, dizin } = kur('abc', { md5: '0'.repeat(32) });
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /md5 tutmuyor/);
  assert.ok(!fs.existsSync(path.join(dizin, '.md5-dogrulandi')));
});

test('dosya alanı yol taşıyamaz (arşiv dışına çıkma yok)', async () => {
  const { kok } = kur('abc', { dosya: '../build.zip' });
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /dosya alanı geçersiz/);
});

test('içerik değişince (aynı boyut, yeni mtime) md5 yeniden hesaplanır', async () => {
  const { kok, dizin } = kur('abc');
  await arsivKaynagi(45482, { kok });
  const zip = path.join(dizin, 'build.zip');
  fs.writeFileSync(zip, 'xyz');
  const ileri = new Date(Date.now() + 5000);
  fs.utimesSync(zip, ileri, ileri);
  await assert.rejects(() => arsivKaynagi(45482, { kok }), /md5 tutmuyor/);
});

test('arsivKoku: EMPP_KAYNAK_ARSIVI önceliklidir', () => {
  assert.equal(arsivKoku({ EMPP_KAYNAK_ARSIVI: '/x/y' }), '/x/y');
  assert.match(arsivKoku({}), /\.empp-agent\/kaynak-arsivi$/);
});

// ---------------------------------------------------------------------------
// BAYAT ARŞİV KAPISI (2026-09-26) — İmpark kaynağı arşivden sonra değiştiyse iş düşer.
// Güncel kimlik runner'da `srcVersionTuret(job.downloadUrl)`: köprü presigned URL'si.
// ---------------------------------------------------------------------------

/** Runner'ın next-job'dan aldığı biçim: köprü anahtarı + her seferinde değişen imza. */
function kopruUrl(ad, imza = 'a1b2c3') {
  return `https://acc.r2.cloudflarestorage.com/akillitahtalar/45482/${ad}`
    + '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=k%2F20260926%2Fauto%2Fs3%2Faws4_request'
    + `&X-Amz-Date=20260926T120000Z&X-Amz-Expires=21600&X-Amz-Signature=${imza}`;
}

const BAYAT_MESAJI = 'kaynak arşivi BAYAT: İmpark kaynağı ShallWe8-v47.exe → ShallWe8-v48.exe; '
  + 'build zip yeniden üretilmeli';

test('BAYAT: İmpark kaynağı değiştiyse HATA — eski zip kullanılmaz, md5 okunmaz', async () => {
  const { kok, dizin } = kur('abc', { impark_kaynagi: 'ShallWe8-v47.exe' });
  const guncel = srcVersionTuret(kopruUrl('ShallWe8-v48.exe'));
  await assert.rejects(
    () => arsivKaynagi(45482, { kok, imparkKaynagi: guncel, uyar: () => {} }),
    (e) => e.message.startsWith(BAYAT_MESAJI),
  );
  assert.ok(!fs.existsSync(path.join(dizin, '.md5-dogrulandi')),
    'kıyas zip/md5 denetiminden ÖNCE yapılmalı');
});

test('aynı İmpark kaynağı: imza farklı olsa da BAYAT sayılmaz, arşiv döner', async () => {
  const { kok, md5 } = kur('abc', { impark_kaynagi: 'ShallWe8-v47.exe' });
  const uyarilar = [];
  for (const imza of ['imza-1', 'imza-2']) {
    const r = await arsivKaynagi(45482, {
      kok,
      imparkKaynagi: srcVersionTuret(kopruUrl('ShallWe8-v47.exe', imza)),
      uyar: (m) => uyarilar.push(m),
    });
    assert.equal(r.md5, md5);
    assert.deepEqual(r.imparkKaynagi, ['ShallWe8-v47.exe']);
  }
  assert.deepEqual(uyarilar, []);
});

test('kıyas EŞİTLİKtir: geri dönüş ya da yeniden adlandırma da BAYAT (sıralama yok)', async () => {
  for (const guncel of ['ShallWe8-v46.exe', 'ShallWe8-v47-yeni.exe', 'SW8-26-2.exe']) {
    const { kok } = kur('abc', { impark_kaynagi: 'ShallWe8-v47.exe' });
    await assert.rejects(
      () => arsivKaynagi(45482, { kok, imparkKaynagi: guncel, uyar: () => {} }),
      /kaynak arşivi BAYAT: İmpark kaynağı ShallWe8-v47\.exe → /,
      guncel,
    );
  }
});

test('alan yoksa bugünkü davranış sürer ve kitap başına BİR KEZ uyarılır', async () => {
  const { kok, md5 } = kur('abc');
  const uyarilar = [];
  const uyar = (m) => uyarilar.push(m);
  const r1 = await arsivKaynagi(45482, { kok, imparkKaynagi: 'ShallWe8-v48.exe', uyar });
  const r2 = await arsivKaynagi(45482, { kok, imparkKaynagi: 'ShallWe8-v49.exe', uyar });
  assert.equal(r1.md5, md5);
  assert.equal(r2.md5, md5);
  assert.equal(r1.imparkKaynagi, null);
  assert.equal(uyarilar.length, 1, 'ikinci işte uyarı tekrarlanmamalı');
  assert.match(uyarilar[0], /45482 kaydında impark_kaynagi yok/);
  assert.match(uyarilar[0], /ALGILANAMAZ \(güncel kaynak ShallWe8-v48\.exe\)/);
});

test('çağıran güncel kimlik vermezse kıyas ve uyarı yapılmaz (eski çağıranlar)', async () => {
  const { kok } = kur('abc', { impark_kaynagi: 'ShallWe8-v47.exe' });
  const uyarilar = [];
  const r = await arsivKaynagi(45482, { kok, uyar: (m) => uyarilar.push(m) });
  assert.deepEqual(r.imparkKaynagi, ['ShallWe8-v47.exe']);
  assert.deepEqual(uyarilar, []);
});

test('güncel kimlik boş verilirse HATA — tazelik ölçülemedi, sessiz geçiş yok', async () => {
  const { kok } = kur('abc', { impark_kaynagi: 'ShallWe8-v47.exe' });
  await assert.rejects(
    () => arsivKaynagi(45482, { kok, imparkKaynagi: '', uyar: () => {} }),
    /güncel İmpark kaynağı bilinmiyor/,
  );
});

test('impark_kaynagi alanı boş/dize değilse HATA', async () => {
  for (const bozuk of ['', '   ', 47, {}, true, [], ['MP11-v48.exe', ''], ['MP11-v48.exe', 3]]) {
    const { kok } = kur('abc', { impark_kaynagi: bozuk });
    await assert.rejects(
      () => arsivKaynagi(45482, { kok, imparkKaynagi: 'ShallWe8-v47.exe', uyar: () => {} }),
      /impark_kaynagi alanı geçersiz/,
      JSON.stringify(bozuk),
    );
  }
});

test('imparkKaynagiKiyasla: kayıt tam URL de olabilir, kimlik runner ile aynı türetilir', () => {
  const statik = 'https://akillitahta.ydspublishing.com/Uploads/KitapTekExe/45482/'
    + 'ShallWe8-v47.exe';
  assert.deepEqual(imparkKaynagiKiyasla(statik, 'ShallWe8-v47.exe'),
    { durum: 'ayni', kayitli: ['ShallWe8-v47.exe'], guncel: 'ShallWe8-v47.exe' });
  const yeni = srcVersionTuret(kopruUrl('ShallWe8-v48.exe'));
  assert.equal(imparkKaynagiKiyasla('ShallWe8-v47.exe', yeni).durum, 'bayat');
  assert.equal(imparkKaynagiKiyasla(undefined, 'ShallWe8-v47.exe').durum, 'alan-yok');
  assert.equal(imparkKaynagiKiyasla(null, 'ShallWe8-v47.exe').durum, 'alan-yok');
});

test('liste: köprü İmpark\'ın gerisindeyken arşiv kapsadığı her kaynakta kullanılır (45792)', async () => {
  // Ölçüm 26.09: 45792 zip'i İmpark MP11-v48'den üretildi; köprü 23.09'da hâlâ v47 veriyordu.
  const kapsam = ['MP11-v48.exe', 'MP11-v47.exe'];
  for (const guncel of ['MP11-v47.exe', 'MP11-v48.exe']) {
    const { kok } = kur('abc', { impark_kaynagi: kapsam });
    const r = await arsivKaynagi(45482, { kok, imparkKaynagi: guncel, uyar: () => {} });
    assert.deepEqual(r.imparkKaynagi, kapsam, guncel);
  }
  const { kok } = kur('abc', { impark_kaynagi: kapsam });
  await assert.rejects(
    () => arsivKaynagi(45482, { kok, imparkKaynagi: 'MP11-v49.exe', uyar: () => {} }),
    (e) => e.message.startsWith('kaynak arşivi BAYAT: İmpark kaynağı MP11-v48.exe | MP11-v47.exe'
      + ' → MP11-v49.exe; build zip yeniden üretilmeli'),
  );
});
