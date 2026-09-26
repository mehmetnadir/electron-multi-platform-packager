'use strict';

/**
 * WINDOWS PAKETLEME SÖZLEŞMESİ — packagingService.js BAĞLANTI NOKTALARI (2026-09-26).
 *
 * Modüllerin kendisi kendi testlerinde; burada canlı yolun onları GERÇEKTEN çağırdığı
 * çivilenir (modül var ama çağrılmıyor = sessiz düşüş). Kaynak metni + davranış.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');

const KAYNAK = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
const svc = require('./packagingService');

function govde(ad) {
  const i = KAYNAK.indexOf(`async ${ad}(`);
  assert.ok(i > -1, `${ad} bulunamadı`);
  const j = KAYNAK.indexOf('\n  async ', i + 10);
  return KAYNAK.slice(i, j > -1 ? j : undefined);
}

test('G2: Windows files listesi kaynaktaki bookN/temp/data/storage.im\'i dışlar', () => {
  const g = govde('packageWindows');
  const blok = g.match(/files:\s*\[([\s\S]*?)\n\s*\]/);
  assert.ok(blok);
  assert.ok(blok[1].includes('"!**/temp/data/storage.im"'));
});

test('G5: K kapısı kapalıyken bile Windows hedefinde kanal Ş kapatılır', () => {
  const g = govde('startPackaging');
  const i = g.indexOf("} else if (platforms.includes('windows')) {");
  assert.ok(i > -1, 'Windows için ayrı Ş kapatma dalı yok');
  assert.ok(g.indexOf('icerikGuncelleme.kanalSPaketeUygula(workingPath', i) > i);
});

test('G4: SET kimliği açık anahtarı, güncelleme paketi özel anahtar YOLUNU alır', () => {
  const g = govde('startPackaging');
  assert.match(g, /setKimligi\.paketeYaz\(workingPath, \{[\s\S]*?imzaAcikAnahtari: jobInfo\.guncellemeAcikAnahtari/);
  assert.match(g, /guncellemePaketi\.paketeUret\(workingPath, \{[\s\S]*?imzaAnahtari: jobInfo\.guncellemeImzaAnahtariYolu/);
});

test('madde 6 + G6: açılış zamanlama/İmpark devralma yalnız Windows hedefinde, prepareElectronFiles\'tan SONRA', () => {
  const g = govde('startPackaging');
  const hazirla = g.indexOf('await this.prepareElectronFiles(');
  const cagri = g.indexOf('acilisZamanlama.paketeUygula(workingPath');
  assert.ok(hazirla > -1 && cagri > hazirla, 'main.js hazır olmadan yamalanıyor');
  assert.match(g, /if \(platforms\.includes\('windows'\) && acilisZamanlama\.acikMi\(\)\)/);
});

async function sessizce(fn) {
  const yedek = { log: console.log, info: console.info, warn: console.warn };
  console.log = console.info = console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, yedek); }
}

async function nshUret(env) {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-wsb-'));
  await fs.writeJson(path.join(kok, 'package.json'), { name: 'super-monsters-2-set', version: '2.51.0', main: 'main.js' });
  const eski = process.env.EMPP_NSIS_KURULUM;
  if (env === undefined) delete process.env.EMPP_NSIS_KURULUM; else process.env.EMPP_NSIS_KURULUM = env;
  try {
    await sessizce(() => svc.createCustomInstallationFiles(kok, 'Super Monsters 2 Set', 'YDS Publishing', null, null));
  } finally {
    if (eski === undefined) delete process.env.EMPP_NSIS_KURULUM; else process.env.EMPP_NSIS_KURULUM = eski;
  }
  return {
    nsh: await fs.readFile(path.join(kok, 'build', 'installer.nsh'), 'utf8'),
    ovrVar: await fs.pathExists(path.join(kok, 'build', 'empp-kurulum-ovr.nsh')),
    ovrYolu: path.join(kok, 'build', 'empp-kurulum-ovr.nsh'),
  };
}

test('madde 6: kurulum görünürlüğü varsayılan AÇIK — günlük yolu package.json adından, ovr dosyası yazılır', async () => {
  const r = await nshUret(undefined);
  assert.ok(r.ovrVar);
  assert.match(r.nsh, /!define \/ifndef EMPP_USERDATA_ADI "super-monsters-2-set"/);
  assert.match(r.nsh, /!macro customCheckAppRunning/);
  assert.ok(r.nsh.includes(`!include "${r.ovrYolu.replace(/\\/g, '/')}"`));
  const init = r.nsh.slice(r.nsh.indexOf('!macro customInit'), r.nsh.indexOf('!macro customInstall'));
  assert.ok(init.indexOf('Call emppKurulumBasladi') < init.indexOf('IfSilent empp_kurulum_devam'), 'günlük en erken değil');
  assert.match(init, /Banner::show \/set 76 "Kurulum hazırlanıyor…"/);
  assert.ok(init.indexOf('Banner::destroy') < init.indexOf('Exec '), 'aynı sürüm yolunda Banner açık kalıyor');
  const kur = r.nsh.slice(r.nsh.indexOf('!macro customInstall'));
  assert.match(kur, /emppGunluk "kurulum bitti/);
});

test('madde 6: EMPP_NSIS_KURULUM=0 → eski davranış (ovr yok, customCheckAppRunning yok, günlük yok)', async () => {
  const r = await nshUret('0');
  assert.strictEqual(r.ovrVar, false);
  assert.ok(!/customCheckAppRunning|emppGunluk|Banner::/.test(r.nsh));
  assert.match(r.nsh, /!macro customInit/);
});

test('madde 6: GÖRELİ workingPath\'te bile ovr !include yolu MUTLAK (makensis şablon dizininde koşar)', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-wsb-goreli-'));
  const goreli = path.relative(process.cwd(), kok);
  await fs.writeJson(path.join(kok, 'package.json'), { name: 'x', version: '1.0.0' });
  await sessizce(() => svc.createCustomInstallationFiles(goreli, 'X', 'Y', null, null));
  const nsh = await fs.readFile(path.join(kok, 'build', 'installer.nsh'), 'utf8');
  const m = nsh.match(/!include "([^"]*empp-kurulum-ovr\.nsh)"/);
  assert.ok(m, 'ovr include yok');
  assert.ok(path.isAbsolute(m[1]), `göreli include: ${m[1]}`);
  assert.ok(await fs.pathExists(m[1]));
});

test('GERİLEME: yükleyici araması .exe arar — windows/ altında yalnız guncelleme/ varken yedek yol denenir', () => {
  const g = govde('packageWindows');
  assert.match(g, /if \(!files\.some\(\(f\) => f\.endsWith\('\.exe'\)\)\) \{\n\s+const tempOutputPath/);
  assert.ok(!/if \(files\.length === 0\) \{\n\s+const tempOutputPath/.test(g), 'eski "dizin boş mu" koşulu geri gelmiş');
});

// ─── PLATFORM KAPSAMI (2026-09-26): üç bayrağın beş kapısı işin platformlarını alır ───
// `EMPP_SET_GUNCELLEME=windows` gibi kapsamlı değer ancak çağrı yeri `platforms`'u geçirirse
// işe yarar; geçirmezse kapı "iş platformu verilmedi" diye KAPALI kalır (sessiz değil, UYARI).
test('PLATFORM KAPSAMI: webp/SET/içerik kapıları işin platforms dizisini geçirir', () => {
  const g = govde('startPackaging');
  for (const kapi of ['sayfaWebp', 'setKimligi', 'guncellemePaketi', 'guncelleyiciEnjekte', 'icerikGuncelleme']) {
    const re = new RegExp(`${kapi}\\.acikMi\\(([^)]*)\\)`, 'g');
    const cagrilar = [...g.matchAll(re)].map((x) => x[1].trim());
    assert.ok(cagrilar.length >= 1, `${kapi}.acikMi çağrısı bulunamadı — sentinel köreldi`);
    for (const arg of cagrilar) {
      assert.strictEqual(arg, 'process.env, platforms', `${kapi}.acikMi(${arg}) iş platformlarını geçirmiyor`);
    }
  }
});

test('PLATFORM KAPSAMI: kapsamlı bayrak karışık işte (windows+macos) ortak workingPath\'e UYGULANMAZ', () => {
  const kapilar = {
    EMPP_SAYFA_WEBP: require('./sayfa-webp').acikMi,
    EMPP_SET_GUNCELLEME: require('./set-kimligi').acikMi,
    EMPP_ICERIK_GUNCELLEME: require('./icerik-guncelleme').acikMi,
  };
  const sessiz = { uyar: () => {} };
  for (const [ad, acikMi] of Object.entries(kapilar)) {
    const env = { [ad]: 'windows' };
    assert.strictEqual(acikMi(env, ['windows'], sessiz), true, `${ad}: windows işi`);
    assert.strictEqual(acikMi(env, ['macos'], sessiz), false, `${ad}: macos işi`);
    assert.strictEqual(acikMi(env, ['windows', 'macos'], sessiz), false, `${ad}: karışık iş`);
    assert.strictEqual(acikMi(env, ['linux'], sessiz), false, `${ad}: pardus (linux) işi`);
    assert.strictEqual(acikMi(env, ['android'], sessiz), false, `${ad}: android işi`);
  }
});
