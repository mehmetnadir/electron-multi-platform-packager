'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  nabizAyristir, seritKarari, yetenekleriUygula, olayMetni, nabizOkuyucu, ESIK_MS,
} = require('./serit-secimi');

const T = Date.parse('2026-09-24T12:00:00Z');
const nabiz = (ek = {}) => nabizAyristir(JSON.stringify({
  zaman: new Date(T - 60000).toISOString(), ajan: 'active', diskBosGb: 130, dolulukYuzde: 40, ...ek,
}));

test('taze nabız + yeterli disk → ProBook sağlıklı, Mac pardus ALMAZ', () => {
  const k = seritKarari({ nabiz: nabiz(), simdi: T });
  assert.equal(k.probookSaglikli, true);
  assert.equal(k.macPardusAlsin, false);
  assert.deepEqual(yetenekleriUygula(['android', 'macos', 'pardus'], k), ['android', 'macos']);
});

test('nabız 10 dk+ bayat → Mac devralır', () => {
  const n = nabizAyristir(JSON.stringify({ zaman: new Date(T - ESIK_MS - 1000).toISOString(), ajan: 'active', diskBosGb: 130 }));
  const k = seritKarari({ nabiz: n, simdi: T });
  assert.equal(k.macPardusAlsin, true);
  assert.match(k.sebep, /nabız bayat \(10 dk\)/);
  assert.deepEqual(yetenekleriUygula(['android', 'pardus'], k), ['android', 'pardus']);
});

test('eşik sınırı: tam 10 dk hâlâ taze sayılır (> ile karşılaştırma)', () => {
  const n = nabizAyristir(JSON.stringify({ zaman: new Date(T - ESIK_MS).toISOString(), ajan: 'active', diskBosGb: 130 }));
  assert.equal(seritKarari({ nabiz: n, simdi: T }).probookSaglikli, true);
});

test('nabız okunamadı / bozuk JSON → Mac devralır', () => {
  assert.equal(nabizAyristir('{bozuk'), null);
  assert.equal(nabizAyristir(''), null);
  assert.equal(nabizAyristir('{"zaman":"dün"}'), null);
  assert.equal(seritKarari({ nabiz: null, simdi: T }).macPardusAlsin, true);
});

test('disk kapısı düşük ya da doluluk %85 üstü → Mac devralır', () => {
  assert.match(seritKarari({ nabiz: nabiz({ diskBosGb: 12 }), simdi: T }).sebep, /disk kapısı düşük \(12 GB/);
  assert.match(seritKarari({ nabiz: nabiz({ dolulukYuzde: 90 }), simdi: T }).sebep, /doluluğu %90/);
});

test('ajan birimi aktif değil → Mac devralır (nabız taze olsa bile)', () => {
  const k = seritKarari({ nabiz: nabiz({ ajan: 'failed' }), simdi: T });
  assert.equal(k.macPardusAlsin, true);
  assert.match(k.sebep, /ajan failed/);
});

test('sunucu ajanı 10 dk+ görmediyse Mac devralır', () => {
  const k = seritKarari({ nabiz: nabiz(), simdi: T, sunucuSonGorulmeMs: T - ESIK_MS - 60000 });
  assert.equal(k.macPardusAlsin, true);
  assert.match(k.sebep, /sunucu ajanı 11 dk görmedi/);
});

test('olaylar: yalnız karar DEĞİŞİNCE üretilir', () => {
  const devir = seritKarari({ nabiz: null, simdi: T, oncekiMacAlir: false });
  assert.equal(devir.olay, 'devir');
  assert.match(olayMetni(devir), /Mac'e devredildi — nabız okunamadı/);
  const donus = seritKarari({ nabiz: nabiz(), simdi: T, oncekiMacAlir: true });
  assert.equal(donus.olay, 'geri-birak');
  assert.match(olayMetni(donus), /ProBook'a döndü/);
  assert.equal(seritKarari({ nabiz: nabiz(), simdi: T, oncekiMacAlir: false }).olay, null);
  assert.equal(seritKarari({ nabiz: nabiz(), simdi: T }).olay, null, 'ilk kararda olay yok');
});

test('karar yoksa yetenekler aynen kalır (güvenli taraf: Mac alır)', () => {
  assert.deepEqual(yetenekleriUygula(['pardus'], null), ['pardus']);
  assert.deepEqual(yetenekleriUygula(null, null), []);
});

test('nabizOkuyucu: ssh ile okur, 60 sn önbellekler, hata → null', () => {
  let cagri = 0; let simdi = T; let cevap = { code: 0, stdout: JSON.stringify({ zaman: new Date(T).toISOString() }) };
  const oku = nabizOkuyucu({
    host: 'x@h', saat: () => simdi,
    calistir: (cmd, args) => { cagri++; assert.equal(cmd, 'ssh'); assert.ok(args.includes('x@h')); return cevap; },
  });
  assert.equal(oku().zamanMs, T);
  simdi += 30000; oku();
  assert.equal(cagri, 1, 'önbellek içinde yeniden ssh yok');
  simdi += 31000; cevap = { code: 255, stdout: '' };
  assert.equal(oku(), null);
  assert.equal(cagri, 2);
});
