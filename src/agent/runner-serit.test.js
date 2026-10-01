'use strict';
/**
 * ProBook şeridi ↔ runner bağlantısı (2026-09-26). Gerçek runner modülü yüklenir; denetçi
 * gerçek `seritDenetcisiKur` + dosya kipi nabız okuyucusudur (ssh yok). Ölçülen: heartbeat'in
 * gönderdiği yetenek listesi (`guncelYetenekler`) ProBook sağlığına göre `pardus` düşürüyor mu.
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// TEST YALITIMI (2026-09-28, agent-test-borcu-20260928 — bkz. test-yalitim.js). Bu dosya
// `runner.guncelYetenekler()`i 3 kez çağırıyor; hiçbiri macSerbestFlag/macDurdurFlag/
// pardusYedekKabulFlag için izolasyon yapmıyordu — GERÇEK ~/.empp-agent/* dosyaları okunuyordu.
const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();

const runner = require('./runner.js');
const { seritDenetcisiKur } = require('./serit-secimi');

YALITIM.configUygula(runner.CONFIG);
after(() => YALITIM.temizle());

const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');

function nabizYaz(dosya, yasMs, ek = {}) {
  fs.writeFileSync(dosya, JSON.stringify({
    zaman: new Date(Date.now() - yasMs).toISOString(), ajan: 'active', api: 'ok', diskBosGb: 100, dolulukYuzde: 40, ...ek,
  }));
}

test('kod varsayılanı KAPALI: EMPP_PROBOOK_SERIT yoksa pardus Mac\'te kalır', () => {
  const eski = runner.CONFIG.caps;
  runner.CONFIG.caps = ['android', 'pardus'];
  try {
    runner._seritDenetcisiAyarla(seritDenetcisiKur({ env: {}, caps: runner.CONFIG.caps }));
    assert.deepEqual(runner.guncelYetenekler(), ['android', 'pardus', 'kaynak-r2']);
  } finally { runner.CONFIG.caps = eski; }
});

test('ProBook sağlıklı → heartbeat yetenekleri pardus İÇERMEZ; nabız bayatlayınca geri gelir', async () => {
  const eski = runner.CONFIG.caps;
  runner.CONFIG.caps = ['android', 'pardus'];
  const dosya = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'runner-serit-')), 'nabiz.json');
  try {
    const d = seritDenetcisiKur({
      env: { EMPP_PROBOOK_SERIT: '1', EMPP_PROBOOK_NABIZ_DOSYA: dosya, EMPP_BILDIRIM: '0' },
      caps: runner.CONFIG.caps, arsivOzetiFn: () => null,
    });
    runner._seritDenetcisiAyarla(d);
    assert.deepEqual(runner.guncelYetenekler(), ['android', 'pardus', 'kaynak-r2'], 'karar yokken Mac alır');

    nabizYaz(dosya, 30 * 1000);
    await d.tazele({ zorla: true });
    assert.deepEqual(runner.guncelYetenekler(), ['android', 'kaynak-r2']);

    nabizYaz(dosya, 11 * 60 * 1000);
    await d.tazele({ zorla: true });
    assert.deepEqual(runner.guncelYetenekler(), ['android', 'pardus', 'kaynak-r2']);

    nabizYaz(dosya, 30 * 1000, { api: 'yetkisiz' });
    await d.tazele({ zorla: true });
    assert.deepEqual(runner.guncelYetenekler(), ['android', 'pardus', 'kaynak-r2'], 'ProBook kiralayamıyorsa Mac alır');
  } finally {
    runner.CONFIG.caps = eski;
    runner._seritDenetcisiAyarla(null);
  }
});

test('main: ilk heartbeat\'ten ÖNCE şerit kararı beklenir (Mac ilk pardus işini kapmasın)', () => {
  const fn = SRC.slice(SRC.indexOf('async function main()'), SRC.indexOf('// Heartbeat loop'));
  const iBekle = fn.indexOf('await seritDenetcisi.tazele({ zorla: true })');
  const iHb = fn.indexOf('await heartbeat(auth)');
  assert.ok(iBekle > 0 && iHb > iBekle, 'tazele heartbeat\'ten önce');
});

test('guncelYetenekler şerit denetçisini senkron uygular, okumayı beklemez', () => {
  const fn = SRC.slice(SRC.indexOf('function guncelYetenekler()'), SRC.indexOf('async function fetchNextJob'));
  assert.match(fn, /seritDenetcisi\.tazele\(\)\.catch\(/);
  assert.doesNotMatch(fn, /await /);
  assert.match(fn, /caps = seritDenetcisi\.uygula\(caps\)/);
});
