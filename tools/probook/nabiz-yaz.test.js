'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { birKez, kabulgizliSay, nabizOlustur, apiYoklayici } = require('./nabiz-yaz');
const { arsivOzeti } = require('../../src/agent/kaynak-arsivi');
const { nabizAyristir, seritKarari } = require('../../src/agent/serit-secimi');

test('yazilan nabiz Mac karar fonksiyonunca okunur (uc uca sozlesme)', () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'nabiz-'));
  fs.mkdirSync(path.join(kok, 'work'));
  const dosya = path.join(kok, 'log', 'nabiz.json');
  const simdi = Date.now();
  birKez({ dosya, runnerPid: process.pid, commit: 'abc1234', serit: kok, home: kok, simdi, api: 'ok' });
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

test('API ölçülmediyse (ilk yoklama düştü) Mac ALIR — güvenli taraf', () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'nabiz-api-'));
  fs.mkdirSync(path.join(kok, 'work'));
  const dosya = path.join(kok, 'log', 'nabiz.json');
  const simdi = Date.now();
  birKez({ dosya, runnerPid: process.pid, commit: 'x', serit: kok, home: kok, simdi });
  const n = nabizAyristir(fs.readFileSync(dosya, 'utf8'));
  assert.equal(n.api, 'olculmedi');
  const k = seritKarari({ nabiz: n, simdi, diskMinGb: 0, dolulukMax: 100 });
  assert.equal(k.macPardusAlsin, true);
  assert.match(k.sebep, /ProBook API olculmedi/);
});

test('nabız ProBook kaynak arşivinin özetini taşır; Mac özetiyle farklıysa Mac alır', () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'nabiz-arsiv-'));
  fs.mkdirSync(path.join(kok, 'work'));
  const arsiv = path.join(kok, '.empp-agent', 'kaynak-arsivi', '73581');
  fs.mkdirSync(arsiv, { recursive: true });
  fs.writeFileSync(path.join(arsiv, 'kaynak.json'), JSON.stringify({ dosya: 'build.zip', md5: 'a'.repeat(32), boyut: 5 }));
  const dosya = path.join(kok, 'log', 'nabiz.json');
  const simdi = Date.now();
  birKez({ dosya, runnerPid: process.pid, commit: 'x', serit: kok, home: kok, simdi, api: 'ok' });
  const n = nabizAyristir(fs.readFileSync(dosya, 'utf8'));
  const beklenen = arsivOzeti(path.join(kok, '.empp-agent', 'kaynak-arsivi')).ozet;
  assert.equal(n.arsivOzeti, beklenen);
  const esit = seritKarari({ nabiz: n, simdi, diskMinGb: 0, dolulukMax: 100, arsivOzeti: beklenen });
  assert.equal(esit.probookSaglikli, true, esit.sebep);
  const farkli = seritKarari({ nabiz: n, simdi, diskMinGb: 0, dolulukMax: 100, arsivOzeti: 'ffffffffffffffff' });
  assert.equal(farkli.macPardusAlsin, true);
  assert.match(farkli.sebep, /kaynak arşivi farklı/);
});

test('apiYoklayici: ok → tek hata durumu bozmaz → iki ardışık hata "hata"; 401 "yetkisiz"; jeton yok "jetonsuz"', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'nabiz-tok-'));
  const tok = path.join(kok, 'token.json');
  let cevap = { status: 200, json: async () => ({ jobs: [{}, {}] }) };
  let url = ''; let baslik = null;
  const fetchImpl = async (u, o) => { url = u; baslik = o.headers; if (cevap instanceof Error) throw cevap; return cevap; };
  const y = apiYoklayici({ api: 'https://api.test/api/v1/', tokenDosyasi: tok, fetchImpl });
  assert.equal(await y.yokla(), 'jetonsuz');
  fs.writeFileSync(tok, JSON.stringify({ agentId: 'ag-1', token: 'gizli' }));
  assert.equal(await y.yokla(), 'ok');
  assert.equal(url, 'https://api.test/api/v1/agents/ag-1/peek?n=1');
  assert.equal(baslik['X-Agent-Token'], 'gizli');
  assert.equal(y.kuyrukta(), 2);
  cevap = new Error('ECONNRESET');
  assert.equal(await y.yokla(), 'ok', 'tek geçici hata durumu değiştirmez');
  assert.equal(await y.yokla(), 'hata');
  cevap = { status: 502, json: async () => ({}) };
  assert.equal(await y.yokla(), 'hata');
  cevap = { status: 401, json: async () => ({}) };
  assert.equal(await y.yokla(), 'yetkisiz');
  cevap = { status: 204, json: async () => { throw new Error('boş'); } };
  assert.equal(await y.yokla(), 'ok');
});
