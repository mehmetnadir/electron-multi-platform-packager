'use strict';

/**
 * postResultSuccess → uploadMultipart uçtan uca (sahte API + sahte R2, GERÇEK curl/dd): kesinti sonrası
 * devam, birleştirme başarısızlığında kaydın korunması/silinmesi, imza süresi dolunca (403) URL yenileme,
 * heartbeat'in yüklemeden bağımsız zaman aşımı. Gerçek R2'ye YAZMAZ.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const MB = 1024 * 1024;
const DIZIN = fs.mkdtempSync(path.join(os.tmpdir(), 'devam-runner-'));
process.env.EMPP_YUKLEME_DIZIN = path.join(DIZIN, 'yuklemeler');
process.env.AGENT_MULTIPART_THRESHOLD = String(MB);
process.env.AGENT_MULTIPART_PART_SIZE = String(MB);
process.env.AGENT_UPLOAD_PART_ATTEMPTS = '1';
process.env.AGENT_COMPLETE_ATTEMPTS = '1';
process.env.AGENT_PRESIGN_ATTEMPTS = '1';
delete process.env.AGENT_UPLOAD_RATE;

const test = require('node:test');
const assert = require('node:assert/strict');
const runner = require('./runner');

const AUTH = { agentId: 'ag1', token: 't' };
const JOB = { bookId: '777', platform: 'android' };
const KAYIT = path.join(process.env.EMPP_YUKLEME_DIZIN, 'paket-777-android.json');

function sahteApi(ayar = {}) {
  const st = { yuklemeler: {}, sayac: 0, putlar: [], cagrilar: [], sonuc: null, ...ayar };
  const srv = http.createServer((q, r) => {
    const gov = [];
    q.on('data', (b) => gov.push(b));
    q.on('end', () => {
      const b = Buffer.concat(gov);
      const js = (o, kod = 200) => { r.statusCode = kod; r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(o)); };
      const port = srv.address().port;
      const urls = (n, u) => Array.from({ length: n }, (_, i) => ({ partNumber: i + 1, url: `http://127.0.0.1:${port}/put/${u}/${i + 1}` }));
      if (q.method === 'PUT') {
        const [, , u, n] = q.url.split('/');
        st.putlar.push(Number(n));
        if (st.put403Kalan > 0) { st.put403Kalan -= 1; r.statusCode = 403; return r.end(); }
        const etag = crypto.createHash('md5').update(b).digest('hex');
        st.yuklemeler[u].parcalar[n] = { etag: `"${etag}"`, boyut: b.length, b };
        r.setHeader('ETag', `"${etag}"`); return r.end();
      }
      const ad = q.url.split('/').pop();
      st.cagrilar.push(ad);
      const g = b.length ? JSON.parse(b.toString()) : {};
      if (ad === 'presign-multipart') {
        st.sayac += 1; const u = `UP${st.sayac}`; st.yuklemeler[u] = { parcalar: {} };
        return js({ uploadId: u, r2ObjectKey: 'softwares/777/a.apk', contentType: 'application/octet-stream', urls: urls(g.partCount, u) });
      }
      if (ad === 'multipart-durum') {
        const k = st.yuklemeler[g.uploadId];
        if (!k) return js({ error: 'upload_yok' }, 404);
        return js({ uploadId: g.uploadId, parcalar: Object.entries(k.parcalar).map(([n, p]) => ({ partNumber: +n, etag: p.etag, size: p.boyut })), urls: urls(g.partCount, g.uploadId), contentType: 'application/octet-stream' });
      }
      if (ad === 'abort-multipart') { delete st.yuklemeler[g.uploadId]; return js({ status: 'ok' }); }
      if (ad === 'complete-multipart') {
        if (st.completeKod && st.completeKod !== 200) return js({ error: 'x' }, st.completeKod);
        const k = st.yuklemeler[g.uploadId];
        st.birlesen = Buffer.concat(g.parts.sort((a, c) => a.partNumber - c.partNumber).map((p) => k.parcalar[p.partNumber].b));
        return js({ r2ObjectKey: g.r2ObjectKey, publicUrl: 'https://cdn/x' });
      }
      if (ad === 'result') { st.sonuc = g; return js({ ok: true }); }
      return js({}, 404);
    });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => { runner.CONFIG.apiBase = `http://127.0.0.1:${srv.address().port}/api/v1`; res({ srv, st }); }));
}
const dosya = (bayt) => { const f = path.join(DIZIN, `a-${crypto.randomUUID()}.apk`); fs.writeFileSync(f, crypto.randomBytes(bayt)); return f; };
const kayitSil = () => { try { fs.unlinkSync(KAYIT); } catch (_) { /* yok */ } };

test('yuklemeHizSiniri: varsayılan SINIRSIZ; env ile sınırlanır', () => {
  assert.equal(runner.yuklemeHizSiniri(), '');
  process.env.AGENT_UPLOAD_RATE = '2M';
  assert.equal(runner.yuklemeHizSiniri(), '2M');
  delete process.env.AGENT_UPLOAD_RATE;
});

test('birleştirme 5xx ile düşer: kayıt KALIR; sonraki claim yalnız birleştirir (parça PUT YOK) ve kaydı siler', async () => {
  kayitSil();
  const f = dosya(3 * MB + 500);
  const { srv, st } = await sahteApi({ completeKod: 502 });
  try {
    await assert.rejects(runner.postResultSuccess(AUTH, JOB, f), /complete-multipart failed: HTTP 502/);
    assert.ok(fs.existsSync(KAYIT), 'kayıt kalmalı');
    assert.equal(st.putlar.length, 4);
    st.completeKod = 200; st.putlar.length = 0;
    const r = await runner.postResultSuccess(AUTH, JOB, f);
    assert.equal(st.putlar.length, 0, 'tüm parçalar R2\'de: yeniden yükleme YOK');
    assert.equal(st.sayac, 1, 'yeni uploadId açılmadı');
    assert.equal(r.publicUrl, 'https://cdn/x');
    assert.equal(crypto.createHash('sha256').update(st.birlesen).digest('hex'), crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
    assert.equal(fs.existsSync(KAYIT), false);
    assert.ok(st.sonuc && st.sonuc.status === 'completed' && st.sonuc.fileSha256);
  } finally { srv.close(); }
});

test('birleştirme 4xx (sunucu reddetti): yükleme R2\'de İPTAL edilir ve kayıt silinir', async () => {
  kayitSil();
  const f = dosya(2 * MB);
  const { srv, st } = await sahteApi({ completeKod: 400 });
  try {
    await assert.rejects(runner.postResultSuccess(AUTH, JOB, f), /HTTP 400/);
    assert.ok(st.cagrilar.includes('abort-multipart'));
    assert.equal(st.yuklemeler.UP1, undefined);
    assert.equal(fs.existsSync(KAYIT), false);
  } finally { srv.close(); }
});

test('parça PUT 403 (imza süresi doldu): URL\'ler multipart-durum ile yenilenir, yükleme sürer', async () => {
  kayitSil();
  const f = dosya(2 * MB);
  const { srv, st } = await sahteApi({ put403Kalan: 1 });
  process.env.AGENT_UPLOAD_PART_ATTEMPTS = '3'; process.env.AGENT_UPLOAD_BACKOFF_MS = '1';
  try {
    const r = await runner.postResultSuccess(AUTH, JOB, f);
    assert.ok(r.r2ObjectKey);
    assert.ok(st.cagrilar.includes('multipart-durum'), 'URL yenileme çağrısı yok');
    assert.equal(crypto.createHash('sha256').update(st.birlesen).digest('hex'), crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
  } finally { srv.close(); process.env.AGENT_UPLOAD_PART_ATTEMPTS = '1'; delete process.env.AGENT_UPLOAD_BACKOFF_MS; }
});

test('parça başına yeniden deneme üstel bekleme ile; deneme hakkı bitince hata + kayıt korunur', async () => {
  kayitSil();
  const f = dosya(2 * MB);
  const { srv, st } = await sahteApi({ put403Kalan: 99 });
  process.env.AGENT_UPLOAD_PART_ATTEMPTS = '2'; process.env.AGENT_UPLOAD_BACKOFF_MS = '1';
  try {
    await assert.rejects(runner.postResultSuccess(AUTH, JOB, f), /part 1 could not be uploaded/);
    assert.equal(st.putlar.filter((n) => n === 1).length, 2);
    assert.ok(fs.existsSync(KAYIT), 'ağ hatasında kayıt kalır (sonraki claim sürer)');
  } finally { srv.close(); process.env.AGENT_UPLOAD_PART_ATTEMPTS = '1'; delete process.env.AGENT_UPLOAD_BACKOFF_MS; }
});

test('heartbeat: yanıtsız sunucuda CONFIG.heartbeatTimeoutMs içinde döner (yüklemeyi/olay döngüsünü bloklamaz)', async () => {
  const srv = http.createServer(() => { /* yanıt yok */ });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  runner.CONFIG.apiBase = `http://127.0.0.1:${srv.address().port}/api/v1`;
  const eski = [runner.CONFIG.heartbeatTimeoutMs, runner.CONFIG.heartbeatRetryMs];
  runner.CONFIG.heartbeatTimeoutMs = 200; runner.CONFIG.heartbeatRetryMs = 0;
  try {
    const t0 = Date.now();
    await runner.heartbeat(AUTH);
    const sure = Date.now() - t0;
    assert.ok(sure >= 350 && sure < 3000, `2×200 ms zaman aşımı beklenir, ölçülen ${sure}`);
  } finally { [runner.CONFIG.heartbeatTimeoutMs, runner.CONFIG.heartbeatRetryMs] = eski; srv.closeAllConnections(); srv.close(); }
});
