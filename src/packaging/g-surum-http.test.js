'use strict';
/**
 * MADDE 3 (2026-09-26): mac/android paketinde monoton tabanın ALT SINIRI claim `surum`udur.
 * Runner mac/android'de appVersion '1.0.0' verir (G3 değil) → taban yoktu; pakete gömülü içerikten
 * ESKİ bir imzalı G manifesti uygulanabiliyordu. Zincir (appVersion DEĞİŞMEDEN):
 *   claim surum → runner `packagerStartPackage` gövdesi `surum` → /api/package `surumCoz` →
 *   jobInfo.surum → set-kimligi `paketeYaz` → empp-set.json `surum`
 *     → Electron (mac/Windows) istemcisi: kurulu = max(package.json, set.surum, uygulanan)
 *     → Android: g-katmani `empp-g-paket.json` `surum` (istemcinin paket tabanı)
 * Her halka gerçek kodla koşar; "eski manifest reddedilir" claim surum düşerse kırılır.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const { packagerStartPackage, CONFIG } = require('../agent/runner.js');
const { claimGSurumu } = require('../agent/runner-helpers');
const sk = require('./set-kimligi');
const kg = require('../runtime/kitap-guncelleyici');
const Y = require('../runtime/kitap-guncelleyici-ortu.yardimci');
const gk = require('../platforms/android/g-katmani');
const GA = require('../platforms/android/empp-g-istemci.js');
const kabuk = require('./set-kabuk');
const nacl = require('../platforms/android/vendor/tweetnacl-1.0.3/nacl.min.js');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const ACIK = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const imzala = (b) => crypto.sign(null, Buffer.from(b), privateKey).toString('base64');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `g-surum-http-${ad}-`));
const CLAIM = { bookId: '73768', setKimligi: '73768', surum: '2.51.3' };

/** Runner'ın GERÇEK isteği → sahte paketleyici gövdeyi yakalar. */
async function runnerGovdesi(job) {
  let govde = null;
  const s = http.createServer((q, y) => {
    let b = '';
    q.on('data', (c) => { b += c; });
    q.on('end', () => { govde = JSON.parse(b); y.writeHead(200, { 'content-type': 'application/json' }); y.end('{"jobId":"j1"}'); });
  });
  await new Promise((c) => s.listen(0, '127.0.0.1', c));
  const onceki = CONFIG.packagerApi;
  CONFIG.packagerApi = `http://127.0.0.1:${s.address().port}`;
  try {
    await packagerStartPackage('s1', 'macos', 'App', '1.0.0', null, job.setKimligi, 'https://g.example.org/g',
      claimGSurumu(job).surum);
  } finally {
    CONFIG.packagerApi = onceki;
    await new Promise((c) => s.close(c));
  }
  return govde;
}

/** /api/package'in yaptığı: surumCoz → jobInfo.surum; packagingService: paketeYaz(surum). */
async function paketKur(govde, { taban = 'https://g.example.org/g' } = {}) {
  const kok = tmp('paket');
  fs.writeFileSync(path.join(kok, 'index.html'), '<html>MENU v1</html>');
  fs.writeFileSync(path.join(kok, 'package.json'), JSON.stringify({ name: 'x', version: govde.appVersion }));
  const jobInfo = { surum: sk.surumCoz(govde.surum).surum };
  await sk.paketeYaz(kok, {
    setKimligi: govde.setKimligi, guncellemeTabani: taban, imzaAcikAnahtari: ACIK, surum: jobInfo.surum, env: {}, damga: 0,
  });
  return { kok, set: JSON.parse(fs.readFileSync(path.join(kok, 'empp-set.json'), 'utf8')) };
}

async function electronKos(kok, set, manSurum, tetik) {
  const sunucu = await Y.sunucuKurVeYayinla(async (rot) => {
    const s = http.createServer((q, y) => {
      const v = rot[decodeURIComponent(q.url.split('?')[0])];
      if (v == null) { y.statusCode = 404; y.end('yok'); return; }
      const g = Buffer.isBuffer(v) ? v : Buffer.from(typeof v === 'string' ? v : JSON.stringify(v));
      y.setHeader('content-length', String(g.length)); y.end(g);
    });
    await new Promise((c) => s.listen(0, '127.0.0.1', c));
    return { taban: `http://127.0.0.1:${s.address().port}`, kapat: () => new Promise((c) => s.close(c)) };
  }, (t) => Y.yayinRotalari({ tabanUrl: t, imzala, setKimligi: set.setKimligi, surum: manSurum, surumTetik: tetik,
    kabuk: { 'index.html': 'MENU v2' }, kitaplar: [] }));
  try {
    return await kg.guncellemeyiCalistir({ taban: sunucu.taban, set, kok, zamanAsimi: 5000, gunluk: () => {} });
  } finally { await sunucu.kapat(); }
}

test('HTTP gövdesi: claim surum AYRI alan olarak gider, appVersion 1.0.0 kalır; claim yoksa alan yok', async () => {
  const g = await runnerGovdesi(CLAIM);
  assert.strictEqual(g.surum, '2.51.3');
  assert.strictEqual(g.appVersion, '1.0.0', 'appVersion claim surum\'a ÇEVRİLMEZ (bu gece kapsam dışı)');
  const yok = await runnerGovdesi({ ...CLAIM, surum: undefined });
  assert.ok(!('surum' in yok));
  const bozuk = await runnerGovdesi({ ...CLAIM, surum: '1.0.0' });
  assert.ok(!('surum' in bozuk), 'G3 olmayan claim surum gönderilmez');
});

test('ZİNCİR mac/Electron: claim surum → empp-set.json → pakete gömülü sürümün/eskisinin imzalı manifesti RET', async () => {
  const g = await runnerGovdesi(CLAIM);
  for (const [ad, manSurum] of [['eşit', '2.51.3'], ['eski', '2.51.2']]) {
    const { kok, set } = await paketKur(g);
    assert.strictEqual(set.surum, '2.51.3');
    const r = await electronKos(kok, set, manSurum, '2.51.9');
    assert.strictEqual(r.sebep, 'manifest-reddedildi:surum-eski', `${ad}: ${JSON.stringify(r)}`);
    assert.strictEqual(r.kuruluSurum, '2.51.3');
    assert.strictEqual(fs.readFileSync(path.join(kok, 'index.html'), 'utf8'), '<html>MENU v1</html>');
  }
  const { kok, set } = await paketKur(g);
  const r = await electronKos(kok, set, '2.51.4');
  assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
});

test('ZİNCİR mac/Electron: claim surum YOKSA bugünkü davranış — taban yok, eski manifest de uygulanır', async () => {
  const g = await runnerGovdesi({ ...CLAIM, surum: undefined });
  const { kok, set } = await paketKur(g);
  assert.strictEqual(set.surum, null);
  const r = await electronKos(kok, set, '2.51.2');
  assert.strictEqual(r.durum, 'guncellendi', 'taban yokken (uyarıyla) bugünkü davranış');
});

// ─── Android: empp-g-paket.json `surum` claim surum'la dolar ───
const MA = `package com.dijitap.x;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
}
`;
async function androidKur(set, appVersion) {
  const kok = tmp('apk');
  const www = path.join(kok, 'www');
  const main = path.join(kok, 'android', 'app', 'src', 'main');
  fs.mkdirSync(path.join(main, 'java', 'com', 'dijitap', 'x'), { recursive: true });
  fs.mkdirSync(www, { recursive: true });
  fs.writeFileSync(path.join(main, 'java', 'com', 'dijitap', 'x', 'MainActivity.java'), MA);
  fs.writeFileSync(path.join(main, 'AndroidManifest.xml'), '<manifest><application></application></manifest>\n');
  fs.writeFileSync(path.join(www, 'empp-set.json'), JSON.stringify(set));
  const loglar = [];
  const r = await gk.kur(kok, www, { paketSurumu: appVersion, log: (s) => loglar.push(s) });
  assert.strictEqual(r.kuruldu, true, r.sebep);
  return { paketMetni: fs.readFileSync(path.join(www, gk.WWW.paket), 'utf8'), loglar };
}

async function androidKos(set, paketMetni, manSurum, tetik) {
  const KOK = `${set.taban}/set/${set.setKimligi}/android`;
  const man = Buffer.from(JSON.stringify({ kanal: 'G', setKimligi: set.setKimligi, surum: manSurum, kabuk: [], kitaplar: [] }));
  const uc = new Map([
    [`${KOK}/surum.json`, Buffer.from(JSON.stringify({ surum: tetik || manSurum, setKimligi: set.setKimligi }))],
    [`${KOK}/manifest.json`, man],
    [`${KOK}/manifest.json.sig`, Buffer.from(imzala(man))],
  ]);
  const kayit = { uygula: 0 };
  const yerel = {
    yapilandirma: async () => ({ metin: JSON.stringify(set), paket: paketMetni }),
    durum: async () => ({ surum: null }),
    getir: async ({ adres }) => (uc.has(adres) ? { durum: 200, b64: uc.get(adres).toString('base64') } : { durum: 404 }),
    ozetler: async ({ yollar }) => ({ ozetler: Object.fromEntries(yollar.map((y) => [y, null])) }),
    yaz: async () => ({ tamam: true }),
    kitapKur: async () => { throw new Error('beklenmedi'); },
    uygula: async (p) => { kayit.uygula += 1; return { surum: p.surum }; },
  };
  const r = await GA.guncellemeyiCalistir({ yerel, kabuk, subtle: crypto.webcrypto.subtle, naclYukle: async () => nacl });
  return { r, kayit };
}

test('ZİNCİR android: claim surum → empp-set.json → empp-g-paket.json; appVersion (1.0.0) DEĞİŞMEZ', async () => {
  const g = await runnerGovdesi(CLAIM);
  const { set } = await paketKur(g);
  const { paketMetni, loglar } = await androidKur(set, g.appVersion);
  assert.deepStrictEqual(JSON.parse(paketMetni), { surum: '2.51.3' });
  assert.strictEqual(GA.paketSurumuCoz(paketMetni), '2.51.3');
  assert.ok(!loglar.some((s) => /claim surum'u \(G3\) yok/.test(s)), loglar.join('\n'));
  for (const [ad, manSurum] of [['eşit', '2.51.3'], ['eski', '2.51.2']]) {
    const { r, kayit } = await androidKos(set, paketMetni, manSurum, '2.51.9');
    assert.strictEqual(r.sebep, 'manifest-reddedildi:surum-eski', `${ad}: ${JSON.stringify(r)}`);
    assert.strictEqual(kayit.uygula, 0);
  }
  const { r } = await androidKos(set, paketMetni, '2.51.4');
  assert.notStrictEqual(r.sebep, 'manifest-reddedildi:surum-eski', JSON.stringify(r));
});

test('android: set\'te claim surum yoksa bugünkü davranış (appVersion) + görünür uyarı; ikisi G3 ise büyüğü', async () => {
  const g = await runnerGovdesi({ ...CLAIM, surum: undefined });
  const { set } = await paketKur(g);
  const { paketMetni, loglar } = await androidKur(set, '1.0.0');
  assert.deepStrictEqual(JSON.parse(paketMetni), { surum: '1.0.0' });
  assert.ok(loglar.some((s) => /claim surum'u \(G3\) yok/.test(s)), 'uyarı yazılmalı');
  const w = tmp('sec');
  fs.writeFileSync(path.join(w, 'empp-set.json'), JSON.stringify({ surum: '2.51.3' }));
  assert.deepStrictEqual(gk.paketSurumuSec(w, '2.52.0'), { surum: '2.52.0', kaynak: 'paket' });
  assert.deepStrictEqual(gk.paketSurumuSec(w, '1.4821.77'), { surum: '2.51.3', kaynak: 'set' });
  fs.writeFileSync(path.join(w, 'empp-set.json'), '{bozuk');
  assert.deepStrictEqual(gk.paketSurumuSec(w, null), { surum: null, kaynak: 'yok' });
});

test('SENTİNEL: /api/package surum\'u surumCoz ile alır, jobInfo.surum; runner appVersion ifadesi değişmedi', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'server', 'app.js'), 'utf8');
  const r = app.slice(app.indexOf("app.post('/api/package'"));
  assert.match(r, /const surumCozum = setKimlikleri\.surumCoz\(surum\);/);
  assert.match(r, /surum: surumCozum\.surum,/);
  const runner = fs.readFileSync(path.join(__dirname, '..', 'agent', 'runner.js'), 'utf8');
  assert.match(runner, /const appVersion = winPlan \? winPlan\.surum : '1\.0\.0';/, 'appVersion bu gece değişmez');
  assert.match(runner, /const gSurum = winPlan \? \{ surum: winPlan\.surum, sebep: '' \} : claimGSurumu\(job\);/);
  assert.match(runner, /guncellemeTabani : job\.guncellemeTabani,\s*gSurum\.surum\);/);
});
