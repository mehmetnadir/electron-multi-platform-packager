'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const T = require('./paket-temizlik');

const SAAT = 3600 * 1000;
const N = 1_000_000_000_000;
const g = (ad, yasSaat, o = {}) => ({
  ad, yol: '/kok/' + ad, mtimeMs: N - yasSaat * SAAT, bayt: o.bayt ?? 1000,
  artefaktVar: o.artefaktVar ?? false, aktif: o.aktif ?? false,
});

test('aktif iş HER ZAMAN korunur (yaşı ne olursa olsun)', () => {
  const r = T.kararVer([g('job1', 999, { aktif: true, artefaktVar: false })], N);
  assert.equal(r.sil.length, 0);
  assert.equal(r.koru[0].sebep, 'aktif-is');
});

test('taze dizin (<10 dk) korunur — yeni gelen build.zip kazası', () => {
  const r = T.kararVer([{ ad: 'yeni', yol: '/kok/yeni', mtimeMs: N - 60_000, bayt: 1, artefaktVar: false, aktif: false }], N);
  assert.equal(r.sil.length, 0);
  assert.equal(r.koru[0].sebep, 'taze');
});

test('artefaktsız + 6 saatten eski → SİLİNİR', () => {
  const r = T.kararVer([g('scratch', 7)], N);
  assert.equal(r.sil.length, 1);
  assert.equal(r.sil[0].sebep, 'artefaktsiz-eski');
});

test('artefaktsız + 6 saatten yeni → korunur', () => {
  const r = T.kararVer([g('scratch', 5)], N);
  assert.equal(r.sil.length, 0);
  assert.equal(r.koru[0].sebep, 'artefaktsiz-bekleme');
});

test('GÜVENLİK: artefaktlı iş 6 saatte SİLİNMEZ — teslim penceresi 48 saat', () => {
  const r = T.kararVer([g('uretilmis', 10, { artefaktVar: true })], N);
  assert.equal(r.sil.length, 0, 'çıktı taşıyan iş erken silinemez');
  assert.equal(r.koru[0].sebep, 'teslim-penceresinde');
});

test('artefaktlı + 48 saatten eski → SİLİNİR', () => {
  const r = T.kararVer([g('uretilmis', 49, { artefaktVar: true })], N);
  assert.equal(r.sil.length, 1);
  assert.equal(r.sil[0].sebep, 'teslim-penceresi-doldu');
});

test('sınır: tam eşik silmez (kesin büyük olmalı)', () => {
  assert.equal(T.kararVer([g('a', 6, { artefaktVar: false })], N).sil.length, 0);
  assert.equal(T.kararVer([g('b', 48, { artefaktVar: true })], N).sil.length, 0);
});

test('eşikler opts ile değiştirilebilir', () => {
  const r = T.kararVer([g('x', 2, { artefaktVar: true })], N, { artefaktliSaat: 1 });
  assert.equal(r.sil.length, 1);
});

test('artefaktMi: uzantıya göre, büyük/küçük harf duyarsız', () => {
  for (const a of ['a.exe', 'b.IMPARK', 'c.Apk', 'd.dmg', 'e.AppImage', 'f.zip', 'g.deb'])
    assert.equal(T.artefaktMi(a), true, a);
  for (const a of ['main.js', 'app.asar', 'notlar.txt', 'x'])
    assert.equal(T.artefaktMi(a), false, a);
});

test('diskte: artefaktlı ve artefaktsız iş doğru ayrılır', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-tmz-'));
  try {
    const eski = Date.now() - 100 * SAAT;
    await fs.ensureDir(path.join(kok, 'artefaktsiz'));
    await fs.writeFile(path.join(kok, 'artefaktsiz', 'ara.js'), 'x');
    await fs.ensureDir(path.join(kok, 'artefaktli', 'windows'));
    await fs.writeFile(path.join(kok, 'artefaktli', 'windows', 'Kurulum.exe'), 'y'.repeat(50));
    for (const d of ['artefaktsiz', 'artefaktli']) await fs.utimes(path.join(kok, d), eski / 1000, eski / 1000);
    const r = await T.tara(kok, new Set());
    const adlar = (l) => l.map((x) => x.ad).sort();
    assert.deepEqual(adlar(r.sil), ['artefaktli', 'artefaktsiz'], '100 saat sonra ikisi de gider');
    const r2 = await T.tara(kok, new Set(), { artefaktliSaat: 200 });
    assert.deepEqual(adlar(r2.sil), ['artefaktsiz']);
    assert.deepEqual(adlar(r2.koru), ['artefaktli']);
  } finally { await fs.remove(kok); }
});

test('uygula: VARSAYILAN KURU — hiçbir şey silinmez', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-tmz2-'));
  try {
    const eski = Date.now() - 100 * SAAT;
    await fs.ensureDir(path.join(kok, 'eski'));
    await fs.writeFile(path.join(kok, 'eski', 'a.js'), 'x');
    await fs.utimes(path.join(kok, 'eski'), eski / 1000, eski / 1000);
    const r = await T.uygula(kok, new Set());              // kuru varsayılan
    assert.equal(r.kuru, true);
    assert.equal(r.silinen, 1, 'kararı verir');
    assert.equal(await fs.pathExists(path.join(kok, 'eski')), true, 'ama SİLMEZ');
    await T.uygula(kok, new Set(), { kuru: false });
    assert.equal(await fs.pathExists(path.join(kok, 'eski')), false, 'kuru:false ile siler');
  } finally { await fs.remove(kok); }
});

test('GÜVENLİK: aktif id listesi diskte de korur', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-tmz3-'));
  try {
    const eski = Date.now() - 100 * SAAT;
    await fs.ensureDir(path.join(kok, 'job-aktif'));
    await fs.writeFile(path.join(kok, 'job-aktif', 'a.js'), 'x');
    await fs.utimes(path.join(kok, 'job-aktif'), eski / 1000, eski / 1000);
    await T.uygula(kok, new Set(['job-aktif']), { kuru: false });
    assert.equal(await fs.pathExists(path.join(kok, 'job-aktif')), true);
  } finally { await fs.remove(kok); }
});

test('olmayan kök: çökmez', async () => {
  const r = await T.uygula('/boyle/bir/yol/yok', new Set(), { kuru: false });
  assert.equal(r.silinen, 0);
});

// --- kaynak-sentineli: CLI'nin emniyet yolları duruyor mu ---
const CLI = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'tools', 'sunucu-temizlik.js'), 'utf8');

test('sentinel: CLI varsayılanı KURU, silmek için --uygula şart', () => {
  assert.match(CLI, /const KURU = !bayrak\('--uygula'\)/);
});

test('sentinel: kuyruk okunamazsa HİÇBİR ŞEY silinmez', () => {
  assert.match(CLI, /aktif === null/);
  assert.match(CLI, /GÜVENLİ TARAF: hiçbir şey silinmedi/);
  assert.match(CLI, /process\.exit\(3\)/);
});

test('sentinel: --servissiz AÇIK bayraktır, sessiz gevşeme yok', () => {
  assert.match(CLI, /const servissiz = bayrak\('--servissiz'\)/);
  assert.doesNotMatch(CLI, /catch[\s\S]{0,60}return new Set\(\)/,
    'hata yakalanınca boş küme dönmek = sessiz gevşeme');
});

test('sentinel: JSON olmayan cevap (yanlış servis) reddedilir', () => {
  assert.match(CLI, /content-type/);
  assert.match(CLI, /includes\('application\/json'\)/);
});
