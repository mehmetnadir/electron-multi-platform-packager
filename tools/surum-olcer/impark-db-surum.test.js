'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { uyeKimlikleri, dbYorumla, yazimPlani, argAyristir, ana } = require('./impark-db-surum');
const SY = require('../set-yenile/set-yenile');

test('yazimPlani 4 tur', () => {
  const db = new Map([
    ['1', 5], // artis
    ['2', 3], // taban
    ['3', 4], // esit
    ['4', 2]  // geri
  ]);
  const ics = [
    { impark_kitap_id: '1', vs: 3 },
    { impark_kitap_id: '3', vs: 4 },
    { impark_kitap_id: '4', vs: 5 }
  ];
  
  const plan = yazimPlani(ics, db);
  assert.strictEqual(plan.length, 4);
  
  const artis = plan.find(p => p.kimlik === '1');
  assert.deepStrictEqual(artis, { kimlik: '1', eski: 3, yeni: 5, tur: 'artis' });
  
  const taban = plan.find(p => p.kimlik === '2');
  assert.deepStrictEqual(taban, { kimlik: '2', eski: null, yeni: 3, tur: 'taban' });
  
  const esit = plan.find(p => p.kimlik === '3');
  assert.deepStrictEqual(esit, { kimlik: '3', eski: 4, yeni: 4, tur: 'esit' });
  
  const geri = plan.find(p => p.kimlik === '4');
  assert.deepStrictEqual(geri, { kimlik: '4', eski: 5, yeni: 2, tur: 'geri' });
});

test('dbYorumla bozuk satir', () => {
  const json = '[{"KitapId":123,"ZipVersiyon":2}, {"KitapId":124}, "bozuk", null]';
  const m = dbYorumla(json);
  assert.strictEqual(m.size, 1);
  assert.strictEqual(m.get('123'), 2);
  assert.strictEqual(m.has('124'), false);
});

test('kimlik regex disi -> SQL\'e girmez', () => {
  const ayarMap = new Map();
  ayarMap.set('1', { ogeler: [{ id: '123' }, { id: '0' }, { id: 'abc' }, { id: '12345678901' }] });
  const kimlikler = uyeKimlikleri(ayarMap);
  assert.deepStrictEqual(kimlikler, ['123']);
});

test('yedek kapisi kaldirilirsa test kirilir', async () => {
  const scriptContent = fs.readFileSync(path.join(__dirname, 'impark-db-surum.js'), 'utf8');
  assert.ok(/^ {6}await srv\.yedek/m.test(scriptContent), 'yedek kapisi olmali');
  assert.ok(/vs=GREATEST\(vs,VALUES\(vs\)\);/.test(scriptContent), 'upsert SQL metninde vs atamasi en sonda');
});

test('VPN yok -> 0 + vpn-yok', async () => {
  let log = '';
  const d = {
    calistir: async (cmd) => {
      if (cmd === 'ping') return { kod: 1, stdout: '', stderr: '' };
      return { kod: 0 };
    },
    simdi: () => Date.now(),
  };
  const oLog = console.log;
  console.log = (v) => { log += v; };
  const evDir = os.tmpdir();
  const oldHome = os.homedir;
  os.homedir = () => evDir;
  
  try {
    const r = await ana([], d, {});
    assert.strictEqual(r, 0);
    assert.ok(log.includes('vpn-yok'));
  } finally {
    console.log = oLog;
    os.homedir = oldHome;
  }
});
