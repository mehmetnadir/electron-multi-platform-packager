'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const m = require('./acilis-splash-beklemesi.js');

// Yayıncı bundle'ındaki GERÇEK kalıp (0177f86c49186a63aa3f.main.js @188783'ten birebir).
const GERCEK = '(0,a.useEffect)((function(){l===ce.FR.IDLE&&"loading"!==d&&o&&'
  + 'setTimeout((function(){c(ce.FR.LOADED)}),1500)}),[l,d,o]);';
// İkinci varyant (187de5a528f59946b1d9.js @185074) — `&&o` yok, adlar farklı.
const VARYANT = '(0,a.useEffect)((function(){o===le.FR.IDLE&&"loading"!==l&&'
  + 'setTimeout((function(){i(le.FR.LOADED)}),1500)}),[o,l]),';

function sozdizimiGecerliMi(kod) {
  const yol = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'splash-')), 'a.js');
  fs.writeFileSync(yol, `var a={useEffect:function(){}};var ce={},le={},d,o,l,c,i;${kod}`);
  try { execFileSync(process.execPath, ['--check', yol], { stdio: 'pipe' }); return true; }
  catch { return false; }
}

test('kapı varsayılan AÇIK, yalnız 0 kapatır', () => {
  assert.strictEqual(m.acikMi({}), true);
  assert.strictEqual(m.acikMi({ EMPP_SPLASH_BEKLEMESI: '0' }), false);
});

test('süre EMPP_SPLASH_MS ile ayarlanır, geçersizse varsayılan', () => {
  assert.strictEqual(m.sure({}), m.VARSAYILAN_MS);
  assert.strictEqual(m.sure({ EMPP_SPLASH_MS: '600' }), 600);
  assert.strictEqual(m.sure({ EMPP_SPLASH_MS: 'abc' }), m.VARSAYILAN_MS);
  assert.strictEqual(m.sure({ EMPP_SPLASH_MS: '-5' }), m.VARSAYILAN_MS);
});

test('SAHA KALIBI: 1500 ms kalkar', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.strictEqual(r.uygulandi, true);
  assert.strictEqual(r.yama, 1);
  assert.strictEqual(/,1500\)/.test(r.icerik), false);
  assert.match(r.icerik, /\}\),0\)/);
});

test('ikinci bundle varyantı da yakalanır', () => {
  const r = m.icerigiDuzelt(VARYANT);
  assert.strictEqual(r.uygulandi, true);
  assert.match(r.icerik, /i\(le\.FR\.LOADED\)/);
});

test('çağrı KORUNUR — splash yalnız hızlanır, İPTAL EDİLMEZ', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.match(r.icerik, /c\(ce\.FR\.LOADED\)/);
  assert.match(r.icerik, /setTimeout\(/, 'async yol korunmalı (efekt içi setState)');
});

test('efekt koşulları DEĞİŞMEZ (logo yüklenmeden geçilmez)', () => {
  const r = m.icerigiDuzelt(GERCEK);
  assert.match(r.icerik, /l===ce\.FR\.IDLE&&"loading"!==d&&o&&/);
  assert.match(r.icerik, /\[l,d,o\]/);
});

test('DAVRANIŞ: yamalı kod LOADED\'a geçer ve yamasızdan ERKEN geçer', async () => {
  function kostur(kod) {
    return new Promise((coz) => {
      const olaylar = [];
      const sandbox = {
        a: { useEffect: (f) => f() },
        ce: { FR: { IDLE: 'IDLE', LOADED: 'LOADED' } },
        l: 'IDLE', d: 'loaded', o: true,
        c: (v) => olaylar.push({ v, t: Date.now() }),
        setTimeout,
      };
      const t0 = Date.now();
      vm.runInNewContext(kod, sandbox);
      setTimeout(() => coz({ olaylar, t0 }), 1800);
    });
  }
  const yamali = await kostur(m.icerigiDuzelt(GERCEK).icerik);
  assert.strictEqual(yamali.olaylar.length, 1);
  assert.strictEqual(yamali.olaylar[0].v, 'LOADED');
  const gecikme = yamali.olaylar[0].t - yamali.t0;
  assert.ok(gecikme < 200, `yamalı gecikme ${gecikme} ms — 200'den küçük olmalı`);

  const ham = await kostur(GERCEK);
  assert.ok(ham.olaylar[0].t - ham.t0 >= 1400, 'yamasız kod ~1500 ms beklemeli (arızanın kanıtı)');
});

test('FR.LOADED içermeyen benzer setTimeout YAMALANMAZ', () => {
  const yanlis = 'setTimeout((function(){c(ce.FR.HAZIR)}),1500)';
  const r = m.icerigiDuzelt(yanlis);
  assert.strictEqual(r.uygulandi, false);
  assert.strictEqual(r.icerik, yanlis);
});

test('başka süreli FR.LOADED setTimeout\'una dokunulmaz', () => {
  const baska = 'setTimeout((function(){c(ce.FR.LOADED)}),4000)';
  assert.strictEqual(m.icerigiDuzelt(baska).uygulandi, false);
});

test('özel süre verilebilir (markalı duraklama)', () => {
  assert.match(m.icerigiDuzelt(GERCEK, { ms: 600 }).icerik, /\}\),600\)/);
  assert.match(m.icerigiDuzelt(GERCEK, { ms: -1 }).icerik, /\}\),0\)/);
});

test('birden çok çağrı yerinin hepsi yamalanır', () => {
  const r = m.icerigiDuzelt(GERCEK + VARYANT);
  assert.strictEqual(r.yama, 2);
});

test('iki kez uygulanmaz', () => {
  const bir = m.icerigiDuzelt(GERCEK);
  const iki = m.icerigiDuzelt(bir.icerik);
  assert.strictEqual(iki.uygulandi, false);
  assert.strictEqual(iki.sebep, 'zaten-yamali');
  assert.strictEqual(iki.icerik, bir.icerik);
});

test('geçerli JS üretir', () => {
  assert.strictEqual(sozdizimiGecerliMi(m.icerigiDuzelt(GERCEK).icerik), true);
});

test('null/undefined girdi çökmez', () => {
  assert.doesNotThrow(() => m.icerigiDuzelt(null));
  assert.doesNotThrow(() => m.icerigiDuzelt(undefined));
});

// --- gerçek dosya sistemi ---

test('alt kitaplar yamalanır, alakasız dosyalar yeniden yazılmaz', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'splash-paket-'));
  fs.mkdirSync(path.join(kok, 'book1'));
  fs.writeFileSync(path.join(kok, 'book1', 'main.js'), GERCEK);
  fs.writeFileSync(path.join(kok, 'book1', 'vendor.js'), 'var a=1;');
  const alakasiz = path.join(kok, 'book1', 'vendor.js');
  const once = fs.statSync(alakasiz).mtimeMs;
  const r = await m.paketeUygula(kok);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].cagri, 1);
  assert.match(fs.readFileSync(path.join(kok, 'book1', 'main.js'), 'utf8'), new RegExp(m.ISARET));
  assert.strictEqual(fs.statSync(alakasiz).mtimeMs, once);
});

test('.js olmayan dosya kalıbı içerse bile yamalanmaz', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'splash-suzgec-'));
  const harita = path.join(kok, 'main.js.map');
  fs.writeFileSync(harita, GERCEK);
  const once = fs.readFileSync(harita, 'utf8');
  assert.deepStrictEqual(await m.paketeUygula(kok), []);
  assert.strictEqual(fs.readFileSync(harita, 'utf8'), once);
});

test('ikinci koşu dosyaları değiştirmez', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'splash-iki-'));
  fs.writeFileSync(path.join(kok, 'main.js'), GERCEK);
  await m.paketeUygula(kok);
  const ilk = fs.readFileSync(path.join(kok, 'main.js'), 'utf8');
  assert.deepStrictEqual(await m.paketeUygula(kok), []);
  assert.strictEqual(fs.readFileSync(path.join(kok, 'main.js'), 'utf8'), ilk);
});
