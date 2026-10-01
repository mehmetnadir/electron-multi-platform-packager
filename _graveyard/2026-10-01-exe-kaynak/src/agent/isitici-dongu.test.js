'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { kimlikOku, siradakileriSor, birTur } = require('./isitici-dongu');
const { srcVersionTuret } = require('./runner-helpers');

const IMZALI = 'https://acct.r2.cloudflarestorage.com/akillitahtalar/45550/ShallWe6-v49.exe?X-Amz-Sig=abc';
const KIMLIK = { agentId: 'agent-1', token: 'gizli' };

const gecici = () => fsp.mkdtemp(path.join(os.tmpdir(), 'isitici-dongu-'));

function sahteArac(kayitlar = []) {
  return {
    downloadFile: async (url, dest) => { kayitlar.push(['indir', url]); await fsp.writeFile(dest, 'EXE'); },
    extractSfx: async (exe, dizin) => {
      kayitlar.push(['cikar', exe]);
      await fsp.mkdir(path.join(dizin, 'resources', 'app', 'build'), { recursive: true });
      await fsp.writeFile(path.join(dizin, 'resources', 'app', 'build', 'i.html'), '<html>');
    },
    findBuildDir: async (d) => path.join(d, 'resources', 'app', 'build'),
    zipDir: async (_s, out) => { kayitlar.push(['zip', out]); await fsp.writeFile(out, 'ZIP'); },
  };
}

const sahteIstemci = (yanit, yakala = []) => ({
  get: async (url, cfg) => { yakala.push({ url, cfg }); return yanit; },
});

test('peek ucu doğru adres ve başlıkla çağrılır (kiralama ucu DEĞİL)', async () => {
  const yakala = [];
  await siradakileriSor(KIMLIK, 3, sahteIstemci({ status: 200, data: { jobs: [] } }, yakala));
  const { url, cfg } = yakala[0];
  assert.match(url, /\/agents\/agent-1\/peek\?n=3$/);
  // Mutasyon kapanı: yanlışlıkla next-job'a bağlanırsa ısıtıcı ajanın işini KİRALAR
  // ve ajan işsiz kalır — partiyi durduran sınıf.
  assert.doesNotMatch(url, /next-job/);
  assert.equal(cfg.headers['x-agent-token'], 'gizli');
});

test('200 dışı yanıt veya bozuk gövde boş liste döner (parti etkilenmez)', async () => {
  assert.deepEqual(await siradakileriSor(KIMLIK, 2, sahteIstemci({ status: 503, data: null })), []);
  assert.deepEqual(await siradakileriSor(KIMLIK, 2, sahteIstemci({ status: 200, data: {} })), []);
  assert.deepEqual(
    await siradakileriSor(KIMLIK, 2, sahteIstemci({ status: 200, data: { jobs: 'x' } })), []);
});

test('adresi olmayan iş elenir (yarım kayıt ısıtılmaz)', async () => {
  const jobs = [{ bookId: '1', downloadUrl: IMZALI }, { bookId: '2' }, null];
  const s = await siradakileriSor(KIMLIK, 3, sahteIstemci({ status: 200, data: { jobs } }));
  assert.deepEqual(s.map((j) => j.bookId), ['1']);
});

// EXE'SİZ SÖZLEŞME (Nadir 01.10): döngü İmpark exe'sini ısıtıyordu — kapıyla KAPALI; peek bile yapılmaz.

test('KAPALI: tur peek YAPMAZ, hiçbir şey ısıtmaz/indirmez', async () => {
  const kok = await gecici();
  const kayitlar = [];
  const yakala = [];
  const mesajlar = [];
  const { durum, sonuc } = await birTur({
    kimlik: KIMLIK, adet: 1, cacheRoot: kok, diskTabaniGb: 0,
    arac: sahteArac(kayitlar), kayit: (m) => mesajlar.push(m),
    istemci: sahteIstemci({ status: 200, data: { jobs: [{ bookId: '45550', downloadUrl: IMZALI }] } }, yakala),
  });
  assert.equal(durum, 'kapali');
  assert.deepEqual(sonuc, []);
  assert.deepEqual(yakala, [], 'peek çağrılmamalı');
  assert.deepEqual(kayitlar, [], 'indirme/çıkarma/zip çağrılmamalı');
  assert.equal(fs.existsSync(path.join(kok, '45550', srcVersionTuret(IMZALI))), false);
  assert.match(mesajlar.join('\n'), /ısıtıcı turu atlandı: exe'siz sözleşme/);
});

test('KAPALI: CLI başlatılsa da hemen uyarıp çıkar (döngü kurulmaz)', () => {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'isitici-dongu.js')],
    { encoding: 'utf8', timeout: 20000, env: { ...process.env, AGENT_TOKEN_FILE: path.join(os.tmpdir(), 'yok-token.json') } });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /isitici-dongu: exe'siz sözleşme/);
});

test('local-build.js (exe girdili yerel derleme) KAPALI: --exe verilse de çalışmaz, çıkış 3', () => {
  const { spawnSync } = require('child_process');
  const exe = path.join(os.tmpdir(), `sahte-${process.pid}.exe`);
  fs.writeFileSync(exe, 'MZ');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'local-build.js'), '--exe', exe, '--title', 'x'],
    { encoding: 'utf8', timeout: 20000, env: { ...process.env, PACKAGER_API: 'http://127.0.0.1:9' } });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /local-build: exe'siz sözleşme/);
});

test('kimlik dosyası yoksa/bozuksa null döner (ısıtıcı başlamaz)', async () => {
  const kok = await gecici();
  assert.equal(kimlikOku(path.join(kok, 'yok.json')), null);
  const bozuk = path.join(kok, 'bozuk.json');
  await fsp.writeFile(bozuk, '{ bu json degil');
  assert.equal(kimlikOku(bozuk), null);
  const eksik = path.join(kok, 'eksik.json');
  await fsp.writeFile(eksik, JSON.stringify({ agentId: 'a' }));
  assert.equal(kimlikOku(eksik), null);
  const tam = path.join(kok, 'tam.json');
  await fsp.writeFile(tam, JSON.stringify({ agentId: 'a', token: 't' }));
  assert.deepEqual(kimlikOku(tam), { agentId: 'a', token: 't' });
});
