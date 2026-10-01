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

// EXE'SİZ SÖZLEŞME (Nadir 01.10): ısıtıcı İmpark exe'sini indiriyordu — kapıyla KAPALI.
// Eski "ısıtıldı/zaten/disk/hata/sıra" testleri kapı testleriyle değişti (davranış artık yok).

test('KAPALI: kaynakIsit hiçbir aracı çağırmaz (indirme/çıkarma/zip yok), önbelleğe yazmaz', async () => {
  const kok = await gecici();
  const kayitlar = [];
  const mesajlar = [];
  const s = await kaynakIsit({
    bookId: '45550', downloadUrl: URL_A, cacheRoot: kok, diskTabaniGb: 0,
    arac: sahteArac(kayitlar), kayit: (m) => mesajlar.push(m),
  });
  assert.equal(s.durum, 'kapali');
  assert.match(s.sebep, /exe'siz sözleşme/);
  assert.deepEqual(kayitlar, [], 'exe indirme/çıkarma/zip ÇAĞRILMAMALI');
  assert.deepEqual(await fsp.readdir(kok), [], 'önbelleğe hiçbir şey yazılmamalı');
  assert.match(mesajlar.join('\n'), /ısıtma atlandı \(45550\): exe'siz sözleşme/);
});

test('KAPALI: sirayiIsit her işi kapali döner, indirme yok', async () => {
  const kok = await gecici();
  const kayitlar = [];
  const s = await sirayiIsit(
    [{ bookId: '1', downloadUrl: URL_A }, { bookId: '2', downloadUrl: `${URL_A}?v=2` }],
    { cacheRoot: kok, diskTabaniGb: 0, arac: sahteArac(kayitlar) },
  );
  assert.deepEqual(s.map((r) => [r.bookId, r.durum]), [['1', 'kapali'], ['2', 'kapali']]);
  assert.deepEqual(kayitlar, []);
});

test('KAPALI: CLI exe adresiyle çağrılsa da hiçbir şey indirmeden uyarıp çıkar', () => {
  const { spawnSync } = require('child_process');
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'isitici-cli-'));
  const r = spawnSync(process.execPath, [path.join(__dirname, 'kaynak-isitici.js'), `45550=${URL_A}`],
    { encoding: 'utf8', timeout: 20000, env: { ...process.env, EMPP_SOURCE_CACHE: kok } });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /kaynak-isitici: exe'siz sözleşme/);
  assert.deepEqual(fs.readdirSync(kok), []);
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
