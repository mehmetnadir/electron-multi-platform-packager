'use strict';

/**
 * Kaynak arşivi = R2'nin yerel önbelleği (Dalga B / B4, sözleşme §5 "Mac arşivi").
 * `r2ArsiveYaz` kayıt + zip yazar (r2Surum, sha256); `r2Onbellek` yalnız aynı sürüm + sha'da isabet;
 * r2Surum'suz (elle yazılmış) kayıt önbellek SAYILMAZ ama `arsivKaynagi` ile taban olur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { arsivKaynagi, ikiOzet, r2Onbellek, r2ArsiveYaz } = require('./kaynak-arsivi');

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `arsiv-r2-${ad}-`));
const sessiz = () => {};

function zipYaz(dizin, icerik) {
  const f = path.join(dizin, 'indirilen.zip');
  fs.writeFileSync(f, icerik);
  return f;
}

test('ikiOzet: md5 + sha256 + boyut tek geçişte, crypto ile birebir', async () => {
  const d = tmp('oz');
  const veri = crypto.randomBytes(300000);
  const oz = await ikiOzet(zipYaz(d, veri));
  assert.deepEqual(oz, {
    md5: crypto.createHash('md5').update(veri).digest('hex'),
    sha256: crypto.createHash('sha256').update(veri).digest('hex'),
    boyut: veri.length,
  });
});

test('r2ArsiveYaz → r2Onbellek isabet; arsivKaynagi aynı kaydı md5 doğrulamasıyla okur, r2Surum döner', async () => {
  const kok = tmp('kok');
  const veri = Buffer.from('R2 build 2.51.10');
  const oz = await ikiOzet(zipYaz(tmp('kaynak'), veri));
  const kaynakZip = zipYaz(tmp('k2'), veri);
  assert.equal(await r2ArsiveYaz('45549', kaynakZip, { kok, surum: '2.51.10', ...oz, uyari: sessiz }), true);
  assert.ok(fs.existsSync(kaynakZip), 'kaynak zip taşınmaz, kopyalanır');
  const kayit = JSON.parse(fs.readFileSync(path.join(kok, '45549', 'kaynak.json'), 'utf8'));
  assert.equal(kayit.r2Surum, '2.51.10');
  assert.equal(kayit.sha256, oz.sha256);
  assert.equal(kayit.dosya, 'build.zip');
  const isabet = await r2Onbellek('45549', { kok, surum: '2.51.10', sha256: oz.sha256, boyut: oz.boyut });
  assert.equal(isabet.zip, path.join(kok, '45549', 'build.zip'));
  assert.deepEqual(fs.readFileSync(isabet.zip), veri);
  const a = await arsivKaynagi('45549', { kok, bilgi: sessiz });
  assert.equal(a.md5, oz.md5);
  assert.equal(a.r2Surum, '2.51.10');
});

test('r2Onbellek: farklı sürüm / farklı sha / boyut farkı → ıska (tazelenecek); yazınca yeni sürüm isabet', async () => {
  const kok = tmp('taze');
  const eski = Buffer.from('eski build');
  const ozE = await ikiOzet(zipYaz(tmp('e'), eski));
  await r2ArsiveYaz('45549', zipYaz(tmp('e2'), eski), { kok, surum: '2.51.9', ...ozE, uyari: sessiz });
  const yeni = Buffer.from('yeni build — daha uzun');
  const ozY = await ikiOzet(zipYaz(tmp('y'), yeni));
  const notlar = [];
  assert.equal(await r2Onbellek('45549', { kok, surum: '2.51.10', sha256: ozY.sha256, bilgi: (m) => notlar.push(m) }), null);
  assert.match(notlar.join('\n'), /önbellek 2\.51\.9 ≠ geçerli 2\.51\.10 — tazelenecek/);
  assert.equal(await r2Onbellek('45549', { kok, surum: '2.51.9', sha256: ozY.sha256, bilgi: sessiz }), null, 'sha farklı');
  assert.equal(await r2Onbellek('45549', { kok, surum: '2.51.9', sha256: ozE.sha256, boyut: 999, bilgi: sessiz }), null, 'boyut farklı');
  await r2ArsiveYaz('45549', zipYaz(tmp('y2'), yeni), { kok, surum: '2.51.10', ...ozY, uyari: sessiz });
  const isabet = await r2Onbellek('45549', { kok, surum: '2.51.10', sha256: ozY.sha256, boyut: ozY.boyut });
  assert.deepEqual(fs.readFileSync(isabet.zip), yeni);
});

test('r2Onbellek: r2Surum\'suz (Üretim Masası) kayıt ÖNBELLEK SAYILMAZ, ama arsivKaynagi tabanı olarak okunur', async () => {
  const kok = tmp('masa');
  const dizin = path.join(kok, '45482');
  fs.mkdirSync(dizin);
  const veri = Buffer.from('masa build');
  fs.writeFileSync(path.join(dizin, 'build.zip'), veri);
  const md5 = crypto.createHash('md5').update(veri).digest('hex');
  const sha = crypto.createHash('sha256').update(veri).digest('hex');
  fs.writeFileSync(path.join(dizin, 'kaynak.json'), JSON.stringify({ dosya: 'build.zip', md5, boyut: veri.length, etiket: 'masa', sha256: sha }));
  const notlar = [];
  assert.equal(await r2Onbellek('45482', { kok, surum: '2.50.1', sha256: sha, bilgi: (m) => notlar.push(m) }), null);
  assert.match(notlar[0], /r2Surum'suz/);
  const a = await arsivKaynagi('45482', { kok, bilgi: sessiz });
  assert.equal(a.r2Surum, null);
  assert.equal(a.zip, path.join(dizin, 'build.zip'));
});

test('r2Onbellek: bozuk kayıt / kayıt yok → null (FIRLATMAZ); zip içeriği sha\'yı tutmuyorsa ıska', async () => {
  const kok = tmp('bozuk');
  fs.mkdirSync(path.join(kok, '1'));
  fs.writeFileSync(path.join(kok, '1', 'kaynak.json'), '{bozuk');
  assert.equal(await r2Onbellek('1', { kok, surum: '2.1.1', sha256: 'a'.repeat(64), bilgi: sessiz }), null);
  assert.equal(await r2Onbellek('2', { kok, surum: '2.1.1', sha256: 'a'.repeat(64), bilgi: sessiz }), null);
  // Kayıt doğru, zip sonradan bozulmuş (aynı boyut): damga tutmaz → sha yeniden hesaplanır → ıska.
  const veri = Buffer.from('dogru icerik');
  const oz = await ikiOzet(zipYaz(tmp('d'), veri));
  await r2ArsiveYaz('3', zipYaz(tmp('d2'), veri), { kok, surum: '2.1.1', ...oz, uyari: sessiz });
  const zip = path.join(kok, '3', 'build.zip');
  fs.writeFileSync(zip, Buffer.from('bozuk icerik'));
  fs.utimesSync(zip, new Date(), new Date(Date.now() + 5000));
  assert.equal(await r2Onbellek('3', { kok, surum: '2.1.1', sha256: oz.sha256, bilgi: sessiz }), null);
});

test('r2ArsiveYaz: yazılamazsa false + uyarı, FIRLATMAZ', async () => {
  const uyarilar = [];
  const ok = await r2ArsiveYaz('9', '/yok/boyle/zip.zip', {
    kok: tmp('hata'), surum: '2.1.1', md5: 'a'.repeat(32), sha256: 'b'.repeat(64), boyut: 1, uyari: (m) => uyarilar.push(m),
  });
  assert.equal(ok, false);
  assert.match(uyarilar[0], /arşive yazılamadı \(önbellek, iş sürer\)/);
});
