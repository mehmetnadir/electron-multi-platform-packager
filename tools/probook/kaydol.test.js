'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { kaydol } = require('./kaydol');

const SIR = 'cok-gizli-kayit-sirri-123';
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kaydol-')), '.empp-agent', 'token.json');
const cevap = (status, govde) => async () => ({ status, json: async () => govde });

test('basarili kayit: runner.enroll ile ayni govde, jeton 0600, sir diske YAZILMAZ', async () => {
  const dosya = tmp();
  let govde = null; let url = '';
  const r = await kaydol({
    sir: `${SIR}\n`, api: 'https://x/api/v1/', ad: 'probook-serit', yetenekler: ['pardus'], tokenDosyasi: dosya,
    fetchImpl: async (u, o) => { url = u; govde = JSON.parse(o.body); return cevap(201, { agentId: 'a1', token: 't1' })(); },
  });
  assert.equal(r.agentId, 'a1');
  assert.equal(url, 'https://x/api/v1/agents/enroll');
  assert.deepEqual(Object.keys(govde).sort(), ['capabilities', 'hostname', 'name', 'secret']);
  assert.equal(govde.secret, SIR);
  assert.deepEqual(govde.capabilities, ['pardus']);
  const icerik = fs.readFileSync(dosya, 'utf8');
  assert.deepEqual(JSON.parse(icerik), { agentId: 'a1', token: 't1' });
  assert.ok(!icerik.includes(SIR));
  assert.equal(fs.statSync(dosya).mode & 0o777, 0o600);
});

test('red: hata mesajinda sir yok, jeton dosyasi olusmaz', async () => {
  const dosya = tmp();
  await assert.rejects(
    kaydol({ sir: SIR, api: 'https://x', ad: 'p', yetenekler: ['pardus'], tokenDosyasi: dosya, fetchImpl: cevap(403, { error: 'bad' }) }),
    (e) => /HTTP 403/.test(e.message) && !e.message.includes(SIR),
  );
  assert.equal(fs.existsSync(dosya), false);
});

test('bos sir ve mevcut jeton reddedilir (ikinci kayit sessizce ezmez)', async () => {
  const dosya = tmp();
  await assert.rejects(kaydol({ sir: '  ', api: 'x', ad: 'p', yetenekler: [], tokenDosyasi: dosya }), /boş/);
  fs.mkdirSync(path.dirname(dosya), { recursive: true });
  fs.writeFileSync(dosya, '{}');
  await assert.rejects(kaydol({ sir: SIR, api: 'x', ad: 'p', yetenekler: [], tokenDosyasi: dosya }), /zaten kayıtlı/);
});

test('CLI: sir stdin ile gelir, argv/ortamda yok (gercek HTTP sunucu)', async () => {
  const dosya = tmp();
  let alinan = null;
  const s = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => { alinan = JSON.parse(b); res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"agentId":"a9","token":"t9"}'); });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  try {
    const r = await new Promise((resolve) => {
      const { spawn } = require('node:child_process');
      const p = spawn(process.execPath, [path.join(__dirname, 'kaydol.js')], {
        env: { ...process.env, BOOKUPDATE_API: `http://127.0.0.1:${s.address().port}/api/v1`, AGENT_TOKEN_FILE: dosya },
      });
      let out = ''; p.stdout.on('data', (d) => { out += d; });
      p.on('close', (code) => resolve({ code, out }));
      p.stdin.end(SIR);
    });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /agentId=a9/);
    assert.equal(alinan.secret, SIR);
    assert.equal(alinan.name, 'probook-serit');
    assert.deepEqual(alinan.capabilities, ['pardus']);
  } finally { s.close(); }
});
