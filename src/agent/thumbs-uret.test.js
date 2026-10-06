const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { thumbsUret } = require('./thumbs-uret');

test('10 sayfa/0 thumb -> 10 thumb', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbs-uret-test-'));
  await fsp.mkdir(path.join(tmp, 'pages'));
  for (let i = 1; i <= 10; i++) {
    await fsp.writeFile(path.join(tmp, 'pages', `${i}.jpg`), 'sahte');
  }
  
  await thumbsUret(tmp, () => {});
  
  const thumbs = await fsp.readdir(path.join(tmp, 'thumbs'));
  assert.equal(thumbs.length, 10);
  
  await fsp.rm(tmp, { recursive: true, force: true });
});

test('10 sayfa/1 thumb -> 9 yeni, mevcut 1 bayt-ayni', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbs-uret-test-'));
  await fsp.mkdir(path.join(tmp, 'pages'));
  for (let i = 1; i <= 10; i++) {
    await fsp.writeFile(path.join(tmp, 'pages', `${i}.jpg`), 'sahte');
  }
  await fsp.mkdir(path.join(tmp, 'thumbs'));
  await fsp.writeFile(path.join(tmp, 'thumbs', '1.jpg'), 'eski');
  
  await thumbsUret(tmp, () => {});
  
  const thumbs = await fsp.readdir(path.join(tmp, 'thumbs'));
  assert.equal(thumbs.length, 10);
  
  const icerik1 = await fsp.readFile(path.join(tmp, 'thumbs', '1.jpg'), 'utf8');
  assert.equal(icerik1, 'eski');
  
  await fsp.rm(tmp, { recursive: true, force: true });
});

test('pages yok -> hicbir sey', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbs-uret-test-'));
  await thumbsUret(tmp, () => {});
  const icerik = fs.existsSync(path.join(tmp, 'thumbs'));
  assert.equal(icerik, false);
  await fsp.rm(tmp, { recursive: true, force: true });
});

test('sips yok -> kopya + uyari (mock execSync)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbs-uret-test-'));
  await fsp.mkdir(path.join(tmp, 'pages'));
  await fsp.writeFile(path.join(tmp, 'pages', '1.png'), 'pngicerik');
  
  let uyariVar = false;
  
  const { execSync } = require('child_process');
  const orgExec = execSync;
  require('child_process').execSync = (cmd, opts) => {
    if (cmd === 'which sips') throw new Error('yok');
    return orgExec(cmd, opts);
  };
  
  await thumbsUret(tmp, (msg) => {
    if (msg.includes('sips yok') || msg.includes('aynen kopyalanıyor')) uyariVar = true;
  });
  
  require('child_process').execSync = orgExec;
  
  const t = await fsp.readdir(path.join(tmp, 'thumbs'));
  assert.equal(t.includes('1.jpg'), true);
  assert.equal(uyariVar, true);
  
  await fsp.rm(tmp, { recursive: true, force: true });
});
