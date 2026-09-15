'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { kaynakIsit, sirayiIsit, onbellekteVarMi, bosDiskGb } = require('./kaynak-isitici');
const { srcVersionTuret } = require('./runner-helpers');

const URL_A = 'https://akillitahta.ydspublishing.com/Uploads/KitapTekExe/45550/ShallWe6-v49.exe';

async function gecici() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'isitici-test-'));
}

/** Ajanın adımlarını taklit eden sahte araçlar — gerçek ağ/7z yok. */
function sahteArac(kayitlar = []) {
  return {
    downloadFile: async (url, dest) => {
      kayitlar.push(['indir', url]);
      await fsp.writeFile(dest, 'SAHTE-EXE');
    },
    extractSfx: async (exe, dizin) => {
      kayitlar.push(['cikar', exe]);
      await fsp.mkdir(path.join(dizin, 'resources', 'app', 'build'), { recursive: true });
      await fsp.writeFile(path.join(dizin, 'resources', 'app', 'build', 'index.html'), '<html>');
    },
    findBuildDir: async (dizin) => path.join(dizin, 'resources', 'app', 'build'),
    zipDir: async (src, out) => {
      kayitlar.push(['zip', src]);
      await fsp.writeFile(out, 'ZIP-ICERIK');
    },
  };
}

test('ısıtılan kaynak, ajanın OKUDUĞU yola ve anahtara yazılır', async () => {
  const kok = await gecici();
  const kayitlar = [];
  const s = await kaynakIsit({
    bookId: '45550',
    downloadUrl: URL_A,
    cacheRoot: kok,
    diskTabaniGb: 0,
    arac: sahteArac(kayitlar),
  });
  assert.equal(s.durum, 'isitildi');
  // Ajanın processJob'da kurduğu yol ile BİREBİR aynı olmalı; farklıysa HIT hiç olmaz.
  const beklenen = path.join(kok, '45550', srcVersionTuret(URL_A), 'build.zip');
  assert.equal(s.yol, beklenen);
  assert.equal(await fsp.readFile(beklenen, 'utf8'), 'ZIP-ICERIK');
  assert.deepEqual(kayitlar.map((k) => k[0]), ['indir', 'cikar', 'zip']);
});

test('zaten önbellekteyse indirme YAPILMAZ (ajanın işini tekrarlamaz)', async () => {
  const kok = await gecici();
  const hedef = path.join(kok, '45550', srcVersionTuret(URL_A), 'build.zip');
  await fsp.mkdir(path.dirname(hedef), { recursive: true });
  await fsp.writeFile(hedef, 'ESKI');
  const kayitlar = [];
  const s = await kaynakIsit({
    bookId: '45550', downloadUrl: URL_A, cacheRoot: kok, diskTabaniGb: 0, arac: sahteArac(kayitlar),
  });
  assert.equal(s.durum, 'zaten');
  assert.deepEqual(kayitlar, []);
  assert.equal(await fsp.readFile(hedef, 'utf8'), 'ESKI');
});

// Mutasyon kapanı: disk kapısı düşerse ısıtıcı, pardus derlemesinin 20 GB kapısıyla
// yarışır ve partiyi düşürür (15 Eyl'de disk 19 GB'a inince bir iş düştü).
test('boş disk eşiğin altındaysa ısıtma ATLANIR', async () => {
  const kok = await gecici();
  const kayitlar = [];
  const s = await kaynakIsit({
    bookId: '45550', downloadUrl: URL_A, cacheRoot: kok,
    diskTabaniGb: 10 ** 6, arac: sahteArac(kayitlar),
  });
  assert.equal(s.durum, 'disk');
  assert.deepEqual(kayitlar, []);
  assert.equal(fs.existsSync(path.join(kok, '45550')), false);
});

test('bir kitap patlarsa sıradaki ısıtılmaya devam eder', async () => {
  const kok = await gecici();
  const arac = sahteArac();
  const patlak = { ...arac, downloadFile: async () => { throw new Error('origin 504'); } };
  const s1 = await kaynakIsit({ bookId: 'a', downloadUrl: URL_A, cacheRoot: kok, diskTabaniGb: 0, arac: patlak });
  assert.equal(s1.durum, 'hata');
  assert.match(s1.hata, /504/);
  const s2 = await kaynakIsit({ bookId: 'b', downloadUrl: URL_A, cacheRoot: kok, diskTabaniGb: 0, arac });
  assert.equal(s2.durum, 'isitildi');
});

test('yarım dosya bırakmaz: hata hâlinde hedefte .tmp kalmaz', async () => {
  const kok = await gecici();
  const arac = { ...sahteArac(), zipDir: async () => { throw new Error('zip bozuldu'); } };
  const s = await kaynakIsit({ bookId: 'c', downloadUrl: URL_A, cacheRoot: kok, diskTabaniGb: 0, arac });
  assert.equal(s.durum, 'hata');
  const dizin = path.join(kok, 'c', srcVersionTuret(URL_A));
  const kalanlar = fs.existsSync(dizin) ? await fsp.readdir(dizin) : [];
  assert.deepEqual(kalanlar, []);
});

test('sıra SIRAYLA ısıtılır (yayıncı origin\'ine paralel yüklenmez)', async () => {
  const kok = await gecici();
  const sira = [];
  const arac = {
    ...sahteArac(),
    downloadFile: async (url, dest) => {
      sira.push('bas');
      await new Promise((r) => setTimeout(r, 5));
      sira.push('son');
      await fsp.writeFile(dest, 'X');
    },
  };
  await sirayiIsit(
    [{ bookId: '1', downloadUrl: URL_A }, { bookId: '2', downloadUrl: `${URL_A}?v=2` }],
    { cacheRoot: kok, diskTabaniGb: 0, arac }
  );
  // Örtüşme olsaydı ['bas','bas','son','son'] görürdük.
  assert.deepEqual(sira, ['bas', 'son', 'bas', 'son']);
});

test('onbellekteVarMi boş dosyayı HIT saymaz', async () => {
  const kok = await gecici();
  const hedef = path.join(kok, 'd', srcVersionTuret(URL_A), 'build.zip');
  await fsp.mkdir(path.dirname(hedef), { recursive: true });
  await fsp.writeFile(hedef, '');
  assert.equal(await onbellekteVarMi(kok, 'd', URL_A), null);
});

test('bosDiskGb gerçek bir sayı döner (df okunabiliyor)', () => {
  const g = bosDiskGb(os.homedir());
  assert.ok(Number.isFinite(g) && g >= 0, `beklenmedik: ${g}`);
});
