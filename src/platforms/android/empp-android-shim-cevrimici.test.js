'use strict';
// GERİLEME (2026-09-26, webview-ag bulgusu, paket 74451): İmpark motoru açılışta
// `fetch(baseEndpointUrl, {method:'HEAD', mode:'no-cors'})` ile window.isOnline'ı hesaplar.
// besegitim.com kökü Cloudflare challenge 403 + `Cross-Origin-Resource-Policy: same-origin` döner:
// CapacitorHttp köprüsü gövdesiz HEAD 403'ü REDDEDER, WebView'in yamasız fetch'i de no-cors cevabı
// CORP yüzünden ağ hatasına çevirir (emülatörde ölçüldü) → ağ varken isOnline=false → güncelleme
// sorusu ve çevrimiçi aktivasyon "Network is offline". Kapı açıkken shim yalnız bu yoklamayı yerel
// CapacitorHttp eklentisine GET olarak (WebView başlıksız) sorar: HERHANGİ bir HTTP cevabı → çözülür,
// ağ hatası → reddedilir (Electron webSecurity:false ile aynı anlam). CORS isteyen aktivasyon/API
// istekleri köprüde KALIR.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Y = require('./cevrimici-yoklama');

const KAYNAK = fs.readFileSync(path.join(__dirname, 'empp-android-shim.js'), 'utf8');
const KOK = 'https://besegitim.com';

/**
 * Sahte WebView: `fetch` = CapacitorHttp yamalı fetch (köprü; kökte HEAD 403'ü reddeder),
 * `CapacitorWebFetch` = yamasız WebView fetch (no-cors'ta CORP yüzünden reddeder),
 * `Capacitor.nativePromise('CapacitorHttp','request')` = yerel eklenti (gövdeli 403'ü status olarak döner).
 */
function sahteWebView({ agYok = false, capYok = false, yalnizPlugins = false, cevrimdisi = false, yerelStatus = 403 } = {}) {
  const kopru = [];
  const webview = [];
  const yerel = [];
  class Response { constructor(b, i) { this.body = b; this.status = i.status; } }
  const win = {
    document: {},
    localStorage: null,
    navigator: { onLine: !cevrimdisi },
    location: { origin: 'https://localhost' },
    XMLHttpRequest: function () {},
    Response,
    fetch: async (u, i) => {
      const url = String((u && u.url) || u);
      const yontem = String((i && i.method) || 'GET').toUpperCase();
      kopru.push({ url, yontem, kip: i && i.mode });
      if (agYok) throw new TypeError('Failed to fetch');
      if (yontem === 'HEAD' && url.replace(/\/$/, '') === KOK) throw new TypeError('Failed to fetch'); // gövdesiz HEAD 403
      return { status: 200, kopru: true, url };
    },
    CapacitorWebFetch: async (u, i) => { webview.push({ url: String(u), init: i }); throw new TypeError('Failed to fetch'); }, // CORP
  };
  if (!capYok) {
    const istek = async (o) => {
      yerel.push(o);
      if (agYok) throw new Error('Unable to resolve host "besegitim.com"');
      return { status: yerelStatus, headers: {}, data: '<html>challenge</html>', url: o.url };
    };
    win.Capacitor = yalnizPlugins
      ? { Plugins: { CapacitorHttp: { request: istek } } }
      : { nativePromise: (eklenti, yontem, o) => (eklenti === 'CapacitorHttp' && yontem === 'request' ? istek(o) : Promise.reject(new Error('yok'))) };
  }
  return { win, kopru, webview, yerel };
}

function yukle(win, acik) {
  const src = Y.shimMetni(KAYNAK, acik);
  const m = { exports: {} };
  const log = console.log;
  console.log = () => {};
  try {
    new Function('module', 'window', 'btoa', 'atob', 'TextDecoder', src)(m, win,
      (s) => Buffer.from(s, 'binary').toString('base64'), (s) => Buffer.from(s, 'base64').toString('binary'), TextDecoder);
  } finally { console.log = log; }
  return m.exports;
}

// Motorun açılış yoklamasının birebir kopyası (42c86ce0fe3ad185f93d.main.js, 74451 APK).
async function motorYoklamasi(win) {
  const log = console.log;
  console.log = () => {};
  try {
    await win.fetch(KOK, { method: 'HEAD', mode: 'no-cors', timeout: 5e3 });
    return true;
  } catch (e) { return false; } finally { console.log = log; }
}

test('kapı KAPALI (varsayılan): kusur korunur — köprü HEAD\'i reddeder, isOnline=false; yerel eklenti çağrılmaz', async () => {
  const s = sahteWebView();
  const m = yukle(s.win, false);
  assert.strictEqual(m._internals.CEVRIMICI_YOKLAMA, false);
  assert.strictEqual(await motorYoklamasi(s.win), false);
  assert.strictEqual(s.yerel.length, 0);
  assert.deepStrictEqual(s.kopru.map((k) => k.yontem), ['HEAD']);
});

test('yamasız WebView fetch\'i de çözüm DEĞİL (CORP same-origin → ağ hatası): kapı onu kullanmaz', async () => {
  const s = sahteWebView();
  await assert.rejects(s.win.CapacitorWebFetch(KOK, { method: 'HEAD', mode: 'no-cors' }));
  yukle(s.win, true);
  assert.strictEqual(await motorYoklamasi(s.win), true);
  assert.strictEqual(s.webview.length, 1, 'yalnız bu testin kendi denemesi');
});

test('kapı AÇIK: yoklama yerel eklentiye GET, başlıksız, motorun timeout\'uyla → 403 bile isOnline=true; köprüye uğramaz', async () => {
  const s = sahteWebView();
  const m = yukle(s.win, true);
  assert.strictEqual(m._internals.CEVRIMICI_YOKLAMA, true);
  assert.strictEqual(await motorYoklamasi(s.win), true);
  assert.deepStrictEqual(s.yerel, [{ url: KOK, method: 'GET', headers: {}, connectTimeout: 5000, readTimeout: 5000 }]);
  assert.strictEqual(s.kopru.length, 0);
});

test('kapı AÇIK: yerel cevap 200 de çözülür; Response status geçerli aralıkta', async () => {
  const s = sahteWebView({ yerelStatus: 200 });
  yukle(s.win, true);
  const r = await s.win.fetch(KOK, { method: 'HEAD', mode: 'no-cors' });
  assert.strictEqual(r.status, 200);
  const s2 = sahteWebView({ yerelStatus: 0 });
  yukle(s2.win, true);
  assert.strictEqual((await s2.win.fetch(KOK, { method: 'HEAD', mode: 'no-cors' })).status, 200, '0 → 200 (Response aralığı)');
});

test('kapı AÇIK, ağ YOK: yerel eklenti reddeder → isOnline=false (çevrimdışı anlamı korunur)', async () => {
  const s = sahteWebView({ agYok: true });
  yukle(s.win, true);
  assert.strictEqual(await motorYoklamasi(s.win), false);
  assert.strictEqual(s.yerel.length, 1);
});

test('kapı AÇIK, navigator.onLine=false: istek atılmadan isOnline=false', async () => {
  const s = sahteWebView({ cevrimdisi: true });
  yukle(s.win, true);
  assert.strictEqual(await motorYoklamasi(s.win), false);
  assert.strictEqual(s.yerel.length, 0);
  assert.strictEqual(s.kopru.length, 0);
});

test('kapı AÇIK: aktivasyon/API (cors GET/POST), sunucu saati HEAD\'i ve yerel HEAD köprüde KALIR', async () => {
  const s = sahteWebView();
  yukle(s.win, true);
  await s.win.fetch(`${KOK}/TestlerMobil/HasZKitapKey?kitapId=72859`);
  await s.win.fetch(`${KOK}/TestlerMobil/GetKitapGuncellemeBilgi?id=72859&setMi=0&versiyon=1`);
  await s.win.fetch('https://api.dijitap.com/v2/Book/1/aktivasyon', { method: 'POST', body: '{}' });
  await s.win.fetch(`${KOK}/TestlerMobil/Tarih`, { method: 'HEAD' }); // motorun sunucu saati (cors)
  await s.win.fetch('https://besegitim.com/x', { method: 'GET', mode: 'no-cors' }); // yalnız HEAD saptırılır
  await s.win.fetch('https://localhost/assets/1/pages2x/', { method: 'HEAD', mode: 'no-cors' });
  assert.strictEqual(s.yerel.length, 0, JSON.stringify(s.yerel));
  assert.strictEqual(s.kopru.length, 6);
});

test('kapı AÇIK, Capacitor yok: eski yola (köprü) düşer, çökmez; Plugins yolu da çalışır', async () => {
  const s = sahteWebView({ capYok: true });
  yukle(s.win, true);
  assert.strictEqual(await motorYoklamasi(s.win), false);
  assert.strictEqual(s.kopru.length, 1);
  const s2 = sahteWebView({ yalnizPlugins: true });
  yukle(s2.win, true);
  assert.strictEqual(await motorYoklamasi(s2.win), true);
  assert.strictEqual(s2.yerel.length, 1);
});

test('cevrimiciYoklamaMi: Request benzeri nesne, küçük harf, http(s) dışı, yerel köken', () => {
  const s = sahteWebView();
  const f = yukle(s.win, true)._internals.cevrimiciYoklamaMi;
  const o = 'https://localhost';
  assert.strictEqual(f({ url: `${KOK}/`, method: 'HEAD', mode: 'no-cors' }, undefined, o), true);
  assert.strictEqual(f(KOK, { method: 'head', mode: 'NO-CORS' }, o), true);
  assert.strictEqual(f('http://mec.yayincilik.net', { method: 'HEAD', mode: 'no-cors' }, o), true);
  assert.strictEqual(f(KOK, { method: 'HEAD', mode: 'cors' }, o), false);
  assert.strictEqual(f(KOK, { method: 'HEAD' }, o), false);
  assert.strictEqual(f(KOK, undefined, o), false);
  assert.strictEqual(f('data:text/plain,x', { method: 'HEAD', mode: 'no-cors' }, o), false);
  assert.strictEqual(f('https://localhost/x', { method: 'HEAD', mode: 'no-cors' }, o), false);
});
