'use strict';

/**
 * 27.09 gecesi (45100, 45449 android): paketleyici durum yoklamasının TEK bir 30 sn'lik
 * zaman aşımı işi `failed` yazdırdı; paketleyici ikisini de başarıyla bitirmişti.
 * Bu test packagerPoll'un geçici yoklama hatasını aynı yoklamada tolere ettiğini,
 * kalıcı hatada ve tavanda ise fırlattığını ölçer (axios.get taklit edilir).
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

// TEST YALITIMI (2026-09-28, agent-test-borcu-20260928 — bkz. test-yalitim.js).
const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();

const runner = require('./runner');
const { isTransientNetworkError, yoklamaYenidenDenenir } = require('./runner-helpers');

YALITIM.configUygula(runner.CONFIG);
after(() => YALITIM.temizle());

const TAMAM = {
  status: 200,
  data: { job: { status: 'completed', results: { android: { success: true, path: 'x.apk' } } } },
};

function zamanAsimi(ms = 30000) {
  const e = new Error(`timeout of ${ms}ms exceeded`);
  e.code = 'ECONNABORTED';
  return e;
}

async function taklitle(cevaplar, fn) {
  const asil = axios.get;
  const eskiAralik = runner.CONFIG.packagerPollMs;
  let cagri = 0;
  axios.get = async () => {
    const c = cevaplar[Math.min(cagri, cevaplar.length - 1)];
    cagri += 1;
    if (c instanceof Error) throw c;
    return c;
  };
  runner.CONFIG.packagerPollMs = 0;
  try {
    return { sonuc: await fn(), cagri: () => cagri };
  } finally {
    axios.get = asil;
    runner.CONFIG.packagerPollMs = eskiAralik;
  }
}

test('axios zaman aşımı geçici ağ hatası sayılır (failed yazılmaz)', () => {
  assert.equal(isTransientNetworkError(zamanAsimi()), true);
  assert.equal(isTransientNetworkError(new Error('timeout of 120000ms exceeded')), true);
  assert.equal(isTransientNetworkError(new Error('ECONNABORTED')), true);
  // mutasyon kapanı: kalıcı hatalar hâlâ kalıcı
  assert.equal(isTransientNetworkError(new Error('packager job failed: Gradle build failed')), false);
});

test('yoklamaYenidenDenenir: geçici + tavan altı → true; tavanda ya da kalıcıda → false', () => {
  assert.equal(yoklamaYenidenDenenir(zamanAsimi(), 1, 6), true);
  assert.equal(yoklamaYenidenDenenir(zamanAsimi(), 5, 6), true);
  assert.equal(yoklamaYenidenDenenir(zamanAsimi(), 6, 6), false);
  assert.equal(yoklamaYenidenDenenir(new Error('401 Unauthorized'), 1, 6), false);
});

test('packagerPoll: iki ardışık 30 sn zaman aşımından sonra tamamlanan işi döndürür (27.09 45100/45449)', async () => {
  const r = await taklitle([zamanAsimi(), zamanAsimi(), TAMAM], () => runner.packagerPoll('j1', 'android'));
  assert.deepEqual(r.sonuc, TAMAM.data.job.results);
  assert.equal(r.cagri(), 3);
});

test('packagerPoll: ardışık hata tavanında zaman aşımını fırlatır (geçici sınıfta kalır)', async () => {
  let yakalanan = null;
  try {
    await taklitle([zamanAsimi()], () => runner.packagerPoll('j2', 'android'));
  } catch (e) { yakalanan = e; }
  assert.ok(yakalanan, 'fırlatmalıydı');
  assert.match(yakalanan.message, /timeout of 30000ms exceeded/);
  assert.equal(isTransientNetworkError(yakalanan), true, 'ana döngü failed YAZMAMALI');
});

test('packagerPoll: kalıcı hata ilk seferde fırlar (yeniden deneme yok)', async () => {
  const kalici = new Error('Request failed with status code 401 Unauthorized');
  await assert.rejects(
    taklitle([kalici, TAMAM], () => runner.packagerPoll('j3', 'android')),
    (e) => e === kalici,
  );
});
