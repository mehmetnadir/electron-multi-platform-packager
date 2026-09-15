'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { zenityGom, zenityKapisi, ZenityYokHatasi } = require('./zenity-gom');

async function gecici() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'zenity-gom-'));
}

test('gömer: usr/bin/zenity 755 + usr/share/zenity verisi', async () => {
  const kok = await gecici();
  const kaynakBin = path.join(kok, 'kaynak', 'zenity');
  const kaynakVeri = path.join(kok, 'kaynak-veri');
  await fs.outputFile(kaynakBin, '#!/bin/sh\necho sahte zenity\n');
  await fs.outputFile(path.join(kaynakVeri, 'zenity.ui'), '<ui/>');
  const appdir = path.join(kok, 'squashfs-root');
  await fs.ensureDir(appdir);

  const s = await zenityGom(appdir, { ikili: kaynakBin, veri: kaynakVeri });
  assert.equal(s.bin, path.join(appdir, 'usr', 'bin', 'zenity'));
  assert.equal((await fs.stat(s.bin)).mode & 0o777, 0o755);
  assert.equal(await fs.readFile(s.bin, 'utf8'), '#!/bin/sh\necho sahte zenity\n');
  assert.equal(await fs.readFile(path.join(appdir, 'usr', 'share', 'zenity', 'zenity.ui'), 'utf8'), '<ui/>');
  await zenityKapisi(appdir); // fırlatmamalı
});

test('veri dizini yoksa yalnız ikili gömülür, veri null', async () => {
  const kok = await gecici();
  const kaynakBin = path.join(kok, 'zenity');
  await fs.outputFile(kaynakBin, 'x');
  const appdir = path.join(kok, 'appdir');
  const s = await zenityGom(appdir, { ikili: kaynakBin, veri: path.join(kok, 'yok') });
  assert.equal(s.veri, null);
  assert.ok(await fs.pathExists(s.bin));
});

// Mutasyon kapanı: kaynak yoksa sessizce geçmek eski kusurun ta kendisi — FIRLATMALI.
test('derleme makinesinde zenity yoksa ZenityYokHatasi fırlatır, AppDir\'e dokunmaz', async () => {
  const kok = await gecici();
  const appdir = path.join(kok, 'appdir');
  await fs.ensureDir(appdir);
  await assert.rejects(
    () => zenityGom(appdir, { ikili: path.join(kok, 'yok-zenity') }),
    (e) => e instanceof ZenityYokHatasi && e.code === 'ZENITY_YOK' && /ÜRETİLMEDİ/.test(e.message)
  );
  assert.equal(await fs.pathExists(path.join(appdir, 'usr', 'bin', 'zenity')), false);
});

test('boş ikili kabul edilmez', async () => {
  const kok = await gecici();
  const kaynakBin = path.join(kok, 'zenity');
  await fs.outputFile(kaynakBin, '');
  await assert.rejects(() => zenityGom(path.join(kok, 'appdir'), { ikili: kaynakBin }), ZenityYokHatasi);
});

test('zenityKapisi: gömülü zenity yoksa fırlatır', async () => {
  const kok = await gecici();
  await assert.rejects(() => zenityKapisi(kok), ZenityYokHatasi);
});
