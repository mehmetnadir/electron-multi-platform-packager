'use strict';
// GERÇEK HTTP üzerinden test — taşıma katmanı mocklanmaz (memory:
// mocklu-test-tasima-katmanini-gizler). Sunucu 127.0.0.1'e bağlanır.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function ortam() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'kopru-'));
  process.env.EMPP_VM_KOK = kok;
  delete require.cache[require.resolve('./vm-kopru-sunucu.js')];
  const mod = require('./vm-kopru-sunucu.js');
  return { kok, mod };
}

// t.after ile kapatılır: assertion patlasa bile soket kapanır, aksi halde
// `node --test` süreci asılı kalıyordu (ilk sürümde yaşandı).
async function ayagaKaldir(mod, t) {
  const belirtec = mod.belirtecAl();
  const s = mod.sunucuKur(belirtec);
  await new Promise((c) => s.listen(0, '127.0.0.1', c));
  t.after(() => new Promise((c) => s.close(c)));
  const taban = `http://127.0.0.1:${s.address().port}/${belirtec}`;
  return { s, taban, belirtec };
}

test('belirteç üretilir, 0600 izinli ve KALICIDIR', () => {
  const { kok, mod } = ortam();
  const b1 = mod.belirtecAl();
  assert.match(b1, /^[a-f0-9]{24}$/);
  const st = fs.statSync(path.join(kok, 'durum', 'belirtec.txt'));
  assert.strictEqual(st.mode & 0o777, 0o600);
  assert.strictEqual(mod.belirtecAl(), b1, 'ikinci çağrı aynı belirteci vermeli');
});

test('bozuk belirteç dosyası YENİLENİR', () => {
  const { kok, mod } = ortam();
  fs.mkdirSync(path.join(kok, 'durum'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'durum', 'belirtec.txt'), 'kisa');
  assert.match(mod.belirtecAl(), /^[a-f0-9]{24}$/);
});

test('YANLIŞ BELİRTEÇ 404 — yol tahminiyle girilemez', async (t) => {
  const { mod } = ortam();
  const { taban } = await ayagaKaldir(mod, t);
  const kotu = taban.replace(/\/[a-f0-9]+$/, '/deadbeefdeadbeefdeadbeef');
  const y = await fetch(`${kotu}/gorev`);
  assert.strictEqual(y.status, 404);
  const iyi = await fetch(`${taban}/gorev`);
  assert.strictEqual(iyi.status, 204, 'doğru belirteçle görev yokken 204');
});

test('görev bir kez verilir, İKİNCİ istekte tekrar VERİLMEZ', async (t) => {
  const { kok, mod } = ortam();
  const { taban } = await ayagaKaldir(mod, t);
  fs.mkdirSync(path.join(kok, 'gorev'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'gorev', '20260920-160000-0001.json'),
    JSON.stringify({ tur: 'ekran', surecAdi: 'X' }));
  const bir = await (await fetch(`${taban}/gorev`)).json();
  assert.strictEqual(bir.tur, 'ekran');
  assert.strictEqual(bir.kimlik, '20260920-160000-0001');
  assert.strictEqual((await fetch(`${taban}/gorev`)).status, 204);
  assert.deepStrictEqual(fs.readdirSync(path.join(kok, 'gorev')), []);
});

test('görevler SIRAYLA verilir', async (t) => {
  const { kok, mod } = ortam();
  const { taban } = await ayagaKaldir(mod, t);
  fs.mkdirSync(path.join(kok, 'gorev'), { recursive: true });
  for (const k of ['20260920-160002-0002', '20260920-160001-0001']) {
    fs.writeFileSync(path.join(kok, 'gorev', `${k}.json`), JSON.stringify({ tur: 'ekran' }));
  }
  assert.strictEqual((await (await fetch(`${taban}/gorev`)).json()).kimlik, '20260920-160001-0001');
  assert.strictEqual((await (await fetch(`${taban}/gorev`)).json()).kimlik, '20260920-160002-0002');
});

test('bozuk görev dosyası sunucuyu ÇÖKERTMEZ, atılır', async (t) => {
  const { kok, mod } = ortam();
  const { taban } = await ayagaKaldir(mod, t);
  fs.mkdirSync(path.join(kok, 'gorev'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'gorev', 'bozuk.json'), '{ yarım');
  assert.strictEqual((await fetch(`${taban}/gorev`)).status, 204);
  assert.deepStrictEqual(fs.readdirSync(path.join(kok, 'gorev')), []);
});

test('kalp atışı yazılır', async (t) => {
  const { kok, mod } = ortam();
  const { taban } = await ayagaKaldir(mod, t);
  assert.strictEqual((await fetch(`${taban}/kalp`, { method: 'POST' })).status, 204);
  const damga = Date.parse(fs.readFileSync(path.join(kok, 'durum', 'kalp.txt'), 'utf8'));
  assert.ok(Math.abs(Date.now() - damga) < 5000);
});

test('sonuç ve ekran dosyaya iner, KARAR MODÜLÜ okuyabilir', async (t) => {
  const { kok, mod } = ortam();
  const { taban } = await ayagaKaldir(mod, t);
  const kimlik = '20260920-160003-0003';
  await fetch(`${taban}/sonuc/${kimlik}`, {
    method: 'POST',
    body: JSON.stringify({ kimlik, cikis: 0, ekran: `${kimlik}.png`, surecSayisi: 3 }),
  });
  await fetch(`${taban}/ekran/${kimlik}`, { method: 'POST', body: Buffer.from('PNG-baytlari') });
  const karar = require('../../src/windows/vm-kapi-karar.js');
  const sonuc = JSON.parse(fs.readFileSync(path.join(kok, 'sonuc', `${kimlik}.json`), 'utf8'));
  assert.strictEqual(karar.gorevKarari(sonuc, 5).durum, 'gecti');
  assert.strictEqual(fs.readFileSync(path.join(kok, 'sonuc', `${kimlik}.png`), 'utf8'), 'PNG-baytlari');
});

test('yol gezinmesi (path traversal) engellenir', async (t) => {
  const { kok, mod } = ortam();
  const { taban } = await ayagaKaldir(mod, t);
  for (const kotu of ['../../kacak', '..%2F..%2Fkacak', 'alt/dizin/kacak']) {
    await fetch(`${taban}/sonuc/${encodeURIComponent(kotu)}`, { method: 'POST', body: '{}' });
  }
  // Hiçbir dosya kök dizinin DIŞINA yazılmamalı.
  assert.strictEqual(fs.existsSync(path.join(kok, '..', 'kacak.json')), false);
  assert.strictEqual(fs.existsSync(path.join(path.dirname(kok), 'kacak.json')), false);
  // Yazılanların hepsi doğrudan sonuc/ altında ve adlarında ayraç YOK.
  const yazilan = fs.readdirSync(path.join(kok, 'sonuc'));
  assert.ok(yazilan.length > 0, 'istek işlenmiş olmalı');
  for (const f of yazilan) {
    assert.strictEqual(f.includes('/'), false, `ad ayraç içeriyor: ${f}`);
    assert.strictEqual(fs.statSync(path.join(kok, 'sonuc', f)).isFile(), true);
  }
});

test('dosya indirme: var olan verilir, olmayan 404', async (t) => {
  const { kok, mod } = ortam();
  const { taban } = await ayagaKaldir(mod, t);
  fs.writeFileSync(path.join(kok, 'kurulum.exe'), 'MZsahte');
  const y = await fetch(`${taban}/dosya/kurulum.exe`);
  assert.strictEqual(y.status, 200);
  assert.strictEqual(await y.text(), 'MZsahte');
  assert.strictEqual((await fetch(`${taban}/dosya/yok.exe`)).status, 404);
});

test('bilinmeyen uç 404', async (t) => {
  const { mod } = ortam();
  const { taban } = await ayagaKaldir(mod, t);
  assert.strictEqual((await fetch(`${taban}/baska`)).status, 404);
});

test('Bağlanılan arayüz YA VMware bridge* YA Tailscale — 0.0.0.0 ve LAN asla', () => {
  const { mod } = ortam();
  for (const a of mod.vmAdresleri()) {
    const vmware = /^bridge\d+/.test(a.ad);
    const tailnet = /\(tailscale\)$/.test(a.ad);
    assert.ok(vmware || tailnet, `beklenmeyen arayüz: ${a.ad} (${a.adres})`);
    assert.notStrictEqual(a.adres, '0.0.0.0');
  }
});

// ——— Tailscale üzerinden bağlanma (gerçek makineler için) ———————————————
const kopru = require('./vm-kopru-sunucu.js');
test('Tailscale CGNAT bloğu (100.64-127.x) tanınır, başka 100.x tanınmaz', () => {
  const sahte = {
    bridge100: [{ family: 'IPv4', internal: false, address: '192.168.11.1' }],
    utun10: [{ family: 'IPv4', internal: false, address: '100.87.144.56' }],
    en0: [{ family: 'IPv4', internal: false, address: '192.168.1.42' }],
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    utun9: [{ family: 'IPv4', internal: false, address: '100.200.1.1' }],   // CGNAT DIŞI
  };
  const a = kopru.vmAdresleri({}, sahte).map((x) => x.adres).sort();
  assert.deepStrictEqual(a, ['100.87.144.56', '192.168.11.1']);
});

test('ev/ofis arayüzü (en0) ve döngü arayüzü ASLA seçilmez', () => {
  const sahte = { en0: [{ family: 'IPv4', internal: false, address: '192.168.1.42' }] };
  assert.deepStrictEqual(kopru.vmAdresleri({}, sahte), []);
});

test('EMPP_VM_ADRES verilirse YALNIZ o adrese bağlanılır', () => {
  const sahte = {
    bridge100: [{ family: 'IPv4', internal: false, address: '192.168.11.1' }],
    utun10: [{ family: 'IPv4', internal: false, address: '100.87.144.56' }],
  };
  const a = kopru.vmAdresleri({ EMPP_VM_ADRES: '100.87.144.56' }, sahte);
  assert.deepStrictEqual(a.map((x) => x.adres), ['100.87.144.56']);
});

test('EMPP_VM_ADRES=0.0.0.0 REDDEDİLİR (dış ağa açılmaz)', () => {
  assert.throws(() => kopru.vmAdresleri({ EMPP_VM_ADRES: '0.0.0.0' }, {}), /0\.0\.0\.0/);
});

// ——— Çok makineli kuyruk ————————————————————————————————————————————
test('yol çözümü: eski yol "vm" makinesine eşlenir (eski izleyici kopmaz)', () => {
  const r = kopru.yoluCoz(['gorev']);
  assert.strictEqual(r.makine, 'vm');
  assert.strictEqual(r.eylem, 'gorev');
  assert.strictEqual(r.eski, true);
});

test('yol çözümü: makine adı verilirse o makine', () => {
  const r = kopru.yoluCoz(['windows-kasa', 'sonuc', '20260920-1']);
  assert.strictEqual(r.makine, 'windows-kasa');
  assert.strictEqual(r.eylem, 'sonuc');
  assert.deepStrictEqual(r.kalan, ['20260920-1']);
});

test('yol çözümü: geçersiz makine adı ve bilinmeyen eylem REDDEDİLİR', () => {
  assert.strictEqual(kopru.yoluCoz(['../kacak', 'gorev']), null);
  assert.strictEqual(kopru.yoluCoz(['makine', 'silsin']), null);
  assert.strictEqual(kopru.yoluCoz([]), null);
  assert.strictEqual(kopru.yoluCoz(['a'.repeat(40), 'gorev']), null);
});

test('makine dizinleri ayrışır — kuyruk ve kalp paylaşılmaz', () => {
  const a = kopru.makineDizinleri('vm');
  const b = kopru.makineDizinleri('windows-kasa');
  assert.notStrictEqual(a.gorev, b.gorev);
  assert.notStrictEqual(a.sonuc, b.sonuc);
  assert.notStrictEqual(a.kalp, b.kalp);
  assert.match(b.kalp, /kalp-windows-kasa\.txt$/);
  assert.match(a.kalp, /kalp\.txt$/, 'varsayılan makine KÖK dizinleri kullanır (geçiş kırılmasın)');
});

test('İKİ MAKİNE birbirinin görevini KAPAMAZ (gerçek HTTP)', async (t) => {
  const { kok, mod } = ortam();
  const { taban } = await ayagaKaldir(mod, t);
  const fsx = require('fs');
  for (const [m, kimlik] of [['vm', '20260920-100000-0001'], ['windows-kasa', '20260920-100000-0002']]) {
    const d = m === 'vm' ? path.join(kok, 'gorev') : path.join(kok, 'gorev', m);
    fsx.mkdirSync(d, { recursive: true });
    fsx.writeFileSync(path.join(d, `${kimlik}.json`), JSON.stringify({ tur: 'ekran', makine: m }));
  }
  const a = await (await fetch(`${taban}/vm/gorev`)).json();
  const b = await (await fetch(`${taban}/windows-kasa/gorev`)).json();
  assert.strictEqual(a.makine, 'vm');
  assert.strictEqual(b.makine, 'windows-kasa');
  // ikisi de tükendi, tekrar istenirse 204
  assert.strictEqual((await fetch(`${taban}/vm/gorev`)).status, 204);
  assert.strictEqual((await fetch(`${taban}/windows-kasa/gorev`)).status, 204);
});

test('kalp atışları ayrı dosyalara yazılır', async (t) => {
  const { kok, mod } = ortam();
  const { taban } = await ayagaKaldir(mod, t);
  await fetch(`${taban}/windows-kasa/kalp`, { method: 'POST' });
  const fsx = require('fs');
  assert.ok(fsx.existsSync(path.join(kok, 'durum', 'kalp-windows-kasa.txt')));
  assert.ok(!fsx.existsSync(path.join(kok, 'durum', 'kalp.txt')), 'başka makinenin kalbi yazılmamalı');
});
