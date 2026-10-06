'use strict';

/** İmzalı arşiv geri doldurma (Nadir 06.10) — sahte hazır kök + sahte yuva + sahte D: (os.tmpdir). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const G = require('./imzali-arsiv-doldur');

const kokler = [];
test.after(() => { for (const k of kokler) fs.rmSync(k, { recursive: true, force: true }); });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/**
 * 401: iki yayın — eski (dizinde imzalı kopya var) + yeni (imzalı kopya yalnız yuva _imzali'de).
 * 402: yalnız İMZASIZ exe (sha eşleşmez). 403: manifest'te imzali yok. 404: kopya --kaynak dizininde.
 */
function ortam() {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ia-doldur-')));
  kokler.push(r);
  const hazir = path.join(r, 'windows-hazir');
  const yuva = path.join(r, 'yuva');
  const ek = path.join(r, 'ek');
  fs.mkdirSync(path.join(r, 'D'));
  fs.mkdirSync(path.join(yuva, '_imzali'), { recursive: true });
  fs.mkdirSync(ek);
  const govdeler = {};
  const kayit = (ad, { bookId, surum, zaman, imzaliYer = 'dizin', imzaliYok = false }) => {
    const dizin = path.join(hazir, 'yayinlandi', ad);
    fs.mkdirSync(dizin, { recursive: true });
    const exe = `runner-${bookId}-T-${surum}-Setup.exe`;
    const imzasiz = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(2000)]);
    const imzali = Buffer.concat([imzasiz, Buffer.from('IMZA')]);
    govdeler[`${bookId}-${surum}`] = imzali;
    if (imzaliYer === 'dizin') fs.writeFileSync(path.join(dizin, exe), imzali);
    else fs.writeFileSync(path.join(dizin, exe), imzasiz);
    if (imzaliYer === 'yuva') fs.writeFileSync(path.join(yuva, '_imzali', exe), imzali);
    if (imzaliYer === 'ek') fs.writeFileSync(path.join(ek, `runner-${bookId}-T-${surum}-Setup-imzali.exe`), imzali);
    fs.writeFileSync(path.join(dizin, 'manifest.json'), JSON.stringify({
      bookId, surum, exe, durum: 'yayinlandi', zaman: zaman, job: { bookTitle: `Kitap ${bookId}` },
      ...(imzaliYok ? {} : { imzali: { sha256: sha(imzali), boyut: imzali.length, zamanDamgasi: 'damga' } }),
      yayin: { zaman, r2ObjectKey: `softwares/${bookId}/${surum}.exe` },
    }));
  };
  kayit('401-2.1.0-a', { bookId: '401', surum: '2.1.0', zaman: '2026-10-01T10:00:00Z', imzaliYer: 'dizin' });
  kayit('401-2.1.1-b', { bookId: '401', surum: '2.1.1', zaman: '2026-10-03T10:00:00Z', imzaliYer: 'yuva' });
  kayit('402-2.0.1-a', { bookId: '402', surum: '2.0.1', zaman: '2026-10-02T10:00:00Z', imzaliYer: 'yok' });
  kayit('403-2.0.1-a', { bookId: '403', surum: '2.0.1', zaman: '2026-10-02T10:00:00Z', imzaliYok: true });
  kayit('404-2.0.5-a', { bookId: '404', surum: '2.0.5', zaman: '2026-10-04T10:00:00Z', imzaliYer: 'ek' });
  const cfg = { winHazirKoku: hazir, winImzaYuvaKoku: yuva };
  return { r, cfg, kok: path.join(r, 'D', 'empp-imzali-son'), ek, govdeler, hazir };
}

const listele = (d) => { const o = []; const yuru = (p) => { for (const a of fs.readdirSync(p)) { const t = path.join(p, a); if (fs.statSync(t).isDirectory()) yuru(t); else o.push(path.relative(d, t)); } }; yuru(d); return o.sort(); };

test('--kuru: karar listesi, hiçbir şey yazılmaz', async () => {
  const o = ortam();
  const onceHazir = listele(o.hazir);
  const r = await G.doldur({ cfg: o.cfg, kok: o.kok, kaynaklar: [o.ek], kuru: true });
  assert.deepEqual(r.ozet, { kitap: 4, arsivlendi: 0, kuru: 2, atlandi: 2, hata: 0 });
  assert.deepEqual(fs.readdirSync(path.join(o.r, 'D')), []);
  assert.deepEqual(listele(o.hazir), onceHazir, 'hazır kök değişmedi');
});

test('gerçek: kitap başına EN SON yayın; imzalı kopya sha ile bulunur (yuva/_imzali, --kaynak); imzasız exe asla arşive girmez', async () => {
  const o = ortam();
  const onceHazir = listele(o.hazir);
  const r = await G.doldur({ cfg: o.cfg, kok: o.kok, kaynaklar: [o.ek] });
  const durum = Object.fromEntries(r.satirlar.map((s) => [s.bookId, s.durum]));
  assert.deepEqual(durum, { 401: 'arsivlendi', 402: 'atlandi', 403: 'atlandi', 404: 'arsivlendi' });
  assert.match(r.satirlar.find((s) => s.bookId === '402').sebep, /imzalı kopya bulunamadı/);
  assert.match(r.satirlar.find((s) => s.bookId === '403').sebep, /imzali\.sha256 yok/);
  assert.equal(r.eskiKayit, 1, '401 eski yayın atlandı');
  assert.deepEqual(listele(o.kok), ['401/son.json', '404/son.json', 'Kitap 401.exe', 'Kitap 404.exe']);
  assert.deepEqual(fs.readFileSync(path.join(o.kok, 'Kitap 401.exe')), o.govdeler['401-2.1.1']);
  const son = JSON.parse(fs.readFileSync(path.join(o.kok, '401', 'son.json'), 'utf8'));
  assert.equal(son.surum, '2.1.1');
  assert.equal(son.r2Anahtari, 'softwares/401/2.1.1.exe');
  assert.equal(son.yayinZamani, '2026-10-03T10:00:00Z');
  assert.equal(son.baslik, 'Kitap 401');
  assert.deepEqual(listele(o.hazir), onceHazir, 'kaynaklar kopyalandı, taşınmadı/silinmedi');
  assert.ok(fs.existsSync(path.join(o.cfg.winImzaYuvaKoku, '_imzali', 'runner-401-T-2.1.1-Setup.exe')));
});

test('ikinci koşu idempotent: arşivde aynı yayın var → dokunulmaz', async () => {
  const o = ortam();
  await G.doldur({ cfg: o.cfg, kok: o.kok, kaynaklar: [o.ek] });
  const r = await G.doldur({ cfg: o.cfg, kok: o.kok, kaynaklar: [o.ek] });
  assert.equal(r.ozet.arsivlendi, 0);
  assert.match(r.satirlar.find((s) => s.bookId === '401').sebep, /aynı\/yeni sürüm/);
});

test('--yalniz + argümanlar: bilinmeyen argüman reddedilir', async () => {
  const o = ortam();
  const r = await G.doldur({ cfg: o.cfg, kok: o.kok, kaynaklar: [o.ek], yalniz: '404' });
  assert.deepEqual(r.satirlar.map((s) => s.bookId), ['404']);
  assert.deepEqual(G.argumanlar(['--kuru', '--kok=E:\\a', '--kaynak=x', '--kaynak=y', '--yalniz=7']),
    { kuru: true, kok: 'E:\\a', kaynaklar: ['x', 'y'], yalniz: '7', bilinmeyen: [] });
  assert.deepEqual(G.argumanlar(['--sil', '--kurux']).bilinmeyen, ['--sil', '--kurux']);
});
