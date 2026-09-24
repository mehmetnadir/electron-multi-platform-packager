'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { birKez, kabulgizliSay, nabizOlustur } = require('./nabiz-yaz');
const { nabizAyristir, seritKarari } = require('../../src/agent/serit-secimi');

test('yazilan nabiz Mac karar fonksiyonunca okunur (uc uca sozlesme)', () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'nabiz-'));
  fs.mkdirSync(path.join(kok, 'work'));
  const dosya = path.join(kok, 'log', 'nabiz.json');
  const simdi = Date.now();
  birKez({ dosya, runnerPid: process.pid, commit: 'abc1234', serit: kok, home: kok, simdi });
  const n = nabizAyristir(fs.readFileSync(dosya, 'utf8'));
  assert.equal(n.ajan, 'active');
  assert.equal(n.commit, 'abc1234');
  assert.ok(Number.isFinite(n.diskBosGb));
  const k = seritKarari({ nabiz: n, simdi, diskMinGb: 0, dolulukMax: 100 });
  assert.equal(k.probookSaglikli, true, k.sebep);
  assert.deepEqual(fs.readdirSync(path.dirname(dosya)), ['nabiz.json'], 'tmp dosyasi kalmamali');
});

test('runner olu → ajan=olu → Mac devralir', () => {
  const n = nabizOlustur({ simdi: Date.now(), runnerPid: 999999, runnerCanli: false, disk: { diskBosGb: 100, dolulukYuzde: 30 }, kabulgizli: 0 });
  assert.equal(n.ajan, 'olu');
  const k = seritKarari({ nabiz: nabizAyristir(JSON.stringify(n)), simdi: Date.now() });
  assert.equal(k.macPardusAlsin, true);
});

test('kabulgizli sayaci iki kurulum kokunu da gezer', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nabiz-home-'));
  fs.mkdirSync(path.join(home, 'DijiTap', 'DijiTap', 'Set.kabulgizli-1'), { recursive: true });
  fs.mkdirSync(path.join(home, 'DijiTap', 'alan.com', 'Kitap.kabulgizli-2'), { recursive: true });
  fs.mkdirSync(path.join(home, 'DijiTap', 'alan.com', 'Normal'), { recursive: true });
  assert.equal(kabulgizliSay(home), 2);
  assert.equal(kabulgizliSay(path.join(home, 'yok')), 0);
});
