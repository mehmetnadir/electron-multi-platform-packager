'use strict';
/**
 * Test fikstürü: okuyucu kabuğu taşıyan sahte paketler (06.10, okuyucu sürümü kapısı bağlama testleri).
 * Gerçek biçim: index.html → `<h20>.main.js` → `e.exports={i8:"X"}` (okuyucu-surumu-kapisi.test.js ile aynı).
 *   a1Agaci     : A1 düzeni (kök sf425 set kabuğu + kapak/index.html okuyucu + ImWin32.dll)
 *   asarYap     : ağaçtan app.asar (+ büyük dolgu: akışın erken kesildiği ölçülür)
 *   imparkYap   : `resources/app.asar` taşıyan 7z arşivi (.impark adlı) — 7z squashfs'te olduğu gibi
 *                 `x -so … resources/app.asar` ile akıtır; Mac'te mksquashfs olmadan uçtan uca test
 *   nsisYap     : `$PLUGINSDIR/app-64.7z` (içinde resources/app.asar) taşıyan 7z arşivi (.exe adlı) —
 *                 paket-cikar.js windowsAc'ın gerçek yolu
 * 7z yoksa (`yediz()` null) arşiv kuran testler atlanır.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const A1 = require('../../../src/packaging/a1-duzen');
const { yedizBul } = require('../paket-cikar');

const MAIN = 'a1b2c3d4e5f6a7b8c9d0.main.js';
const OKUYUCU_SAYFASI = '<!doctype html><html><head><title>Akıllı Tahta Uygulaması</title>'
  + `<script defer="defer" src="./${MAIN}"></script></head><body><div id="root"></div></body></html>`;
const SET_KABUGU = '<!doctype html><html><head><title>Set</title></head><body>'
  + '<a href="kapak/index.html?kapak=1">1</a></body></html>';

const gecici = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `okp-${ad}-`));
const temizle = (...d) => { for (const x of d) if (x) fs.rmSync(x, { recursive: true, force: true }); };

/** A1 düzeni ağaç; `dolguKb` > 0 ise sona (asar sırasında sonra gelen) büyük dosya eklenir. */
function a1Agaci(surum, { dolguKb = 0 } = {}) {
  const d = gecici('a1');
  fs.writeFileSync(path.join(d, 'index.html'), SET_KABUGU);
  fs.writeFileSync(path.join(d, 'app.config.js'), 'window.AppConfig={};');
  fs.mkdirSync(path.join(d, 'classlibraries'));
  fs.writeFileSync(path.join(d, 'classlibraries', 'ImWin32.dll'), 'x');
  fs.mkdirSync(path.join(d, 'kapak'));
  fs.writeFileSync(path.join(d, ...A1.A1_MOTOR_SAYFASI.split('/')), A1.baslikEkle(OKUYUCU_SAYFASI));
  fs.writeFileSync(path.join(d, MAIN), `(function(e){e.exports={i8:"${surum}"}})({});`);
  if (dolguKb > 0) {
    fs.mkdirSync(path.join(d, 'zz-varliklar'));
    fs.writeFileSync(path.join(d, 'zz-varliklar', 'dolgu.bin'), Buffer.alloc(dolguKb * 1024, 7));
  }
  return d;
}

/** bookN SET ağacı; `null` = okuyucusuz kitap. */
function setAgaci(surumler) {
  const d = gecici('set');
  fs.writeFileSync(path.join(d, 'index.html'), SET_KABUGU);
  surumler.forEach((s, i) => {
    const b = path.join(d, `book${i + 1}`);
    fs.mkdirSync(b);
    if (s === null) { fs.writeFileSync(path.join(b, 'kitap.pdf'), '%PDF'); return; }
    fs.writeFileSync(path.join(b, 'index.html'), OKUYUCU_SAYFASI);
    fs.writeFileSync(path.join(b, 'app.config.js'), 'window.AppConfig={};');
    fs.writeFileSync(path.join(b, MAIN), `(function(e){e.exports={i8:"${s}"}})({});`);
  });
  return d;
}

async function asarYap(agac, hedef) {
  // eslint-disable-next-line global-require
  const asar = require('@electron/asar');
  await asar.createPackage(agac, hedef);
  return hedef;
}

const yediz = () => yedizBul();

function yedizEkle(arsiv, cwd, girdiler) {
  const r = spawnSync(yediz(), ['a', '-t7z', '-mx=1', arsiv, ...girdiler], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`7z a rc=${r.status}: ${r.stderr || r.stdout}`);
}

/** `resources/app.asar` taşıyan .impark (7z biçimi). */
async function imparkYap(agac, cikti, ad = 'Deneme-1.0.0.impark') {
  const d = gecici('impark');
  fs.mkdirSync(path.join(d, 'resources'));
  await asarYap(agac, path.join(d, 'resources', 'app.asar'));
  fs.writeFileSync(path.join(d, 'AppRun'), '#!/bin/sh\n');
  const paket = path.join(cikti, ad);
  yedizEkle(paket, d, ['resources', 'AppRun']);
  temizle(d);
  return paket;
}

/** NSIS benzeri .exe: `$PLUGINSDIR/app-64.7z` → resources/app.asar + Uygulama.exe. */
async function nsisYap(agac, cikti, ad = 'runner-1-T-2.1.1-Setup.exe') {
  const ic = gecici('nsis-ic');
  fs.mkdirSync(path.join(ic, 'resources'));
  await asarYap(agac, path.join(ic, 'resources', 'app.asar'));
  fs.writeFileSync(path.join(ic, 'Uygulama.exe'), 'MZ Electron/27.3.11');
  const dis = gecici('nsis-dis');
  fs.mkdirSync(path.join(dis, '$PLUGINSDIR'));
  yedizEkle(path.join(dis, '$PLUGINSDIR', 'app-64.7z'), ic, ['resources', 'Uygulama.exe']);
  const paket = path.join(cikti, ad);
  yedizEkle(paket, dis, ['$PLUGINSDIR']);
  temizle(ic, dis);
  return paket;
}

module.exports = { MAIN, gecici, temizle, a1Agaci, setAgaci, asarYap, imparkYap, nsisYap, yediz };
