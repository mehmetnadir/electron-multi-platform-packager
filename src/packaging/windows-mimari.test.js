'use strict';
const test = require('node:test');
const assert = require('node:assert');
const m = require('./windows-mimari');

// ---------------------------------------------------------------------------
// Nadir kararı (2026-09-20): Windows paketleri 32 bit (ia32) üretilir.
// 32 bit uygulama 64 bit Windows'ta WOW64 ile çalışır; tersi çalışmaz.
// ---------------------------------------------------------------------------

test('varsayılan mimari ia32 — 64 bit çalıştıramayan cihazlar kapsanır', () => {
  const r = m.mimariCoz({});
  assert.strictEqual(r.mimari, 'ia32');
  assert.strictEqual(r.kaynak, 'varsayilan');
  assert.strictEqual(m.VARSAYILAN, 'ia32');
});

test('hedef nesnesi electron-builder biçiminde ve TEK mimari taşır', () => {
  const h = m.hedef({});
  assert.deepStrictEqual(h, { target: 'nsis', arch: ['ia32'] });
  // İki mimariyi tek exe'de birleştirmek 1,2 GB içeriği ikiye katlar.
  assert.strictEqual(h.arch.length, 1, 'çoklu mimari kurulum dosyasını ~2,5 GB yapar');
});

test('EMPP_WIN_ARCH ile bilinçli olarak değiştirilebilir', () => {
  assert.strictEqual(m.mimariCoz({ EMPP_WIN_ARCH: 'x64' }).mimari, 'x64');
  assert.strictEqual(m.mimariCoz({ EMPP_WIN_ARCH: 'x64' }).kaynak, 'ortam');
  assert.deepStrictEqual(m.hedef({ EMPP_WIN_ARCH: 'arm64' }).arch, ['arm64']);
});

test('GERİLEME: geçersiz değer SESSİZCE yutulmaz, uyarı üretir', () => {
  // Sessiz düşüş yanlış mimaride paket üretir ve sahada "açılmıyor" olarak döner.
  const r = m.mimariCoz({ EMPP_WIN_ARCH: 'x86' });
  assert.strictEqual(r.mimari, 'ia32', 'güvenli varsayılana düşmeli');
  assert.strictEqual(r.kaynak, 'gecersiz');
  assert.match(r.uyari, /x86/, 'uyarı geçersiz değeri söylemeli');
  assert.match(r.uyari, /ia32/, 'uyarı geçerli seçenekleri söylemeli');
});

test('boşluklu/boş değer varsayılana döner, uyarı üretmez', () => {
  for (const v of ['', '   ', undefined]) {
    const r = m.mimariCoz({ EMPP_WIN_ARCH: v });
    assert.strictEqual(r.mimari, 'ia32');
    assert.strictEqual(r.uyari, undefined);
  }
  assert.strictEqual(m.mimariCoz({ EMPP_WIN_ARCH: '  x64  ' }).mimari, 'x64', 'boşluk kırpılmalı');
});

// --- SENTİNEL: canlı yol gerçekten bu modülü kullanıyor mu ---
test('SENTİNEL: packagingService win hedefini bu modülden alır, sabit yazmaz', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.match(src, /const windowsMimari = require\('\.\/windows-mimari'\)/, 'modül require edilmiyor');
  assert.match(src, /target: windowsMimari\.hedef\(\)/, 'win.target modülden gelmiyor');
  // Eski sabit geri gelirse yakala: win bloğunda elle yazılmış arch listesi olmamalı.
  const winBlok = src.slice(src.indexOf('      win: {'), src.indexOf('      win: {') + 700);
  assert.ok(!/arch:\s*\[\s*["']x64["']\s*\]/.test(winBlok), 'win bloğunda sabit x64 mimarisi kalmış');
});
