'use strict';

/**
 * Kira bırakma + yetim kira (2026-09-30) — runner tarafı, sahte API sunucusuyla uçtan uca.
 *
 * (A) next-job yanıtı kaybolursa (ağ/zaman aşımı/5xx) runner AYNI `X-Istek-Id` ile yeniden
 *     sorar; sunucu aynı işi geri verir. Kimlik yalnız 200/204 alınınca tüketilir.
 * (B) ertelenebilir hatada runner kirayı `/release` ile AÇIKÇA bırakır; eski sunucu (404) ya da
 *     ağ hatası FIRLATMAZ (kira eskisi gibi süre dolunca döner).
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();
const runner = require('./runner.js');
YALITIM.configUygula(runner.CONFIG);
after(() => YALITIM.temizle());

const { CONFIG, fetchNextJob, releaseJob } = runner;
const AUTH = { agentId: 'ajan-test', token: 'tok-123' };
const IS = { bookId: '45482', downloadUrl: 'https://x.test/sources/45482/k.exe', platform: 'android' };

/** Test süresince API tabanını yerel sahte sunucuya yönlendirir; gelen istekleri kaydeder. */
async function sahteApi(isleyici, fn) {
  const istekler = [];
  const server = http.createServer((req, res) => {
    let govde = '';
    req.on('data', (c) => { govde += c; });
    req.on('end', () => {
      const kayit = { method: req.method, url: req.url, headers: req.headers, govde };
      istekler.push(kayit);
      isleyici(kayit, res, istekler.length);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const onceki = CONFIG.apiBase;
  CONFIG.apiBase = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(istekler);
  } finally {
    CONFIG.apiBase = onceki;
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

const isYanit = (res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ job: IS }));
};

test('(A) yanıtı kaybolan next-job AYNI X-Istek-Id ile yeniden sorulur, 200 alınınca kimlik yenilenir', async () => {
  await sahteApi((k, res, n) => {
    if (n === 1) { res.socket.destroy(); return; } // sunucu kiraladı, yanıt yolda kayboldu
    isYanit(res);
  }, async (istekler) => {
    await assert.rejects(() => fetchNextJob(AUTH));
    const is = await fetchNextJob(AUTH);
    assert.strictEqual(is.bookId, '45482');
    await fetchNextJob(AUTH);
    const [k1, k2, k3] = istekler.map((i) => i.headers['x-istek-id']);
    assert.match(k1, /^[0-9a-f-]{36}$/);
    assert.strictEqual(k2, k1, 'kaybolan yanıtın tekrarı aynı kimliği taşımalı');
    assert.notStrictEqual(k3, k1, 'yanıt alındıktan sonraki istek YENİ kimlik taşımalı');
    assert.ok(istekler.every((i) => i.url === '/agents/ajan-test/next-job'));
  });
});

test('(A) 5xx kimliği korur (sunucu kiralamış olabilir), 204 tüketir', async () => {
  await sahteApi((k, res, n) => {
    if (n === 1) { res.writeHead(502); res.end('bad gateway'); return; }
    res.writeHead(204); res.end();
  }, async (istekler) => {
    assert.strictEqual(await fetchNextJob(AUTH), null);
    assert.strictEqual(await fetchNextJob(AUTH), null);
    await fetchNextJob(AUTH);
    const [k1, k2, k3] = istekler.map((i) => i.headers['x-istek-id']);
    assert.strictEqual(k2, k1);
    assert.notStrictEqual(k3, k2);
  });
});

test('(B) releaseJob /release ucuna işi ve sebebi yollar, 200 → true', async () => {
  await sahteApi((k, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok"}');
  }, async (istekler) => {
    assert.strictEqual(await releaseJob(AUTH, IS, 'başsız kabul ÖLÇÜLEMEDİ'), true);
    assert.strictEqual(istekler.length, 1);
    assert.strictEqual(istekler[0].method, 'POST');
    assert.strictEqual(istekler[0].url, '/agents/ajan-test/release');
    assert.strictEqual(istekler[0].headers['x-agent-token'], 'tok-123');
    assert.deepStrictEqual(JSON.parse(istekler[0].govde),
      { bookId: '45482', platform: 'android', sebep: 'başsız kabul ÖLÇÜLEMEDİ' });
  });
});

test('(B) eski sunucu (404) ve kapalı API FIRLATMAZ → false', async () => {
  await sahteApi((k, res) => { res.writeHead(404); res.end('not found'); }, async () => {
    assert.strictEqual(await releaseJob(AUTH, IS, 'disk'), false);
  });
  const onceki = CONFIG.apiBase;
  CONFIG.apiBase = 'http://127.0.0.1:1';
  try {
    assert.strictEqual(await releaseJob(AUTH, IS, 'disk'), false);
  } finally {
    CONFIG.apiBase = onceki;
  }
});

test('(B) ana döngü: ertelenebilir dal failed YAZMADAN kirayı bırakır, sonra bekler', () => {
  const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  const bas = SRC.indexOf('if (ertelenebilirKaynakHatasi(e)) {');
  const dal = SRC.slice(bas, SRC.indexOf('if (isTransientNetworkError(e)) {', bas));
  assert.match(dal, /await releaseJob\(auth, job, /);
  assert.ok(dal.indexOf('releaseJob') < dal.indexOf('await sleep(15000)'), 'bırakma beklemeden ÖNCE');
  assert.doesNotMatch(dal, /postResultFailure/);
});
