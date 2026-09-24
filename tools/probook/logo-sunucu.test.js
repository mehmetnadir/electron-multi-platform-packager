'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { baslat } = require('./logo-sunucu');
const { pickLogoId } = require('../../src/agent/runner-helpers');

test('runner sozlesmesi: /api/logos listesi pickLogoId ile eslesir, dosya indirilir, kacis yok', async () => {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'));
  const id = '0ee182cd-2420-4555-bff6-51b5c57c8839';
  fs.writeFileSync(path.join(dizin, 'logos.json'), JSON.stringify([{ id, kurumId: 'tudem', kurumAdi: 'Tudem' }]));
  fs.writeFileSync(path.join(dizin, `${id}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(os.tmpdir(), 'gizli.png'), 'x');
  const s = await baslat({ dizin, port: 0 });
  const taban = `http://127.0.0.1:${s.address().port}`;
  try {
    const liste = await (await fetch(`${taban}/api/logos`)).json();
    assert.equal(pickLogoId(liste, 'Tudem'), id);
    const dosya = await fetch(`${taban}/api/logos/${id}/file`);
    assert.equal(dosya.status, 200);
    assert.deepEqual([...Buffer.from(await dosya.arrayBuffer())], [0x89, 0x50, 0x4e, 0x47]);
    assert.equal((await fetch(`${taban}/api/logos/..%2Fgizli/file`)).status, 404);
    assert.equal((await fetch(`${taban}/api/logos/yok-yok-yok-yok/file`)).status, 404);
    assert.equal((await fetch(`${taban}/api/logos`, { method: 'POST' })).status, 405);
  } finally { s.close(); }
});

test('logos.json yoksa bos liste (runner varsayilan ikona duser, cokmez)', async () => {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'));
  const s = await baslat({ dizin, port: 0 });
  try {
    const liste = await (await fetch(`http://127.0.0.1:${s.address().port}/api/logos`)).json();
    assert.deepEqual(liste, []);
  } finally { s.close(); }
});
