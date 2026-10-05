'use strict';

/**
 * PAKET İÇERİK ÜYELERİ (05.10) — saf modül + /result gövdesi + hazır kayıt → bekçi job'ı.
 * Zip'ler test içinde AdmZip ile üretilir; canlıya istek yok.
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const AdmZip = require('adm-zip');

const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();
after(() => YALITIM.temizle());

const ig = require('../runtime/icerik-guncelleme');
const U = require('./icerik-uyeleri');
const runner = require('./runner.js');
const H = require('./windows-hazir');

const { CONFIG } = runner;
YALITIM.configUygula(CONFIG);

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `uyeler-${ad}-`));

/** Kapak: `{id, v, icerik?}`; v === undefined → version özniteliği HİÇ yok; icerik:false → içerik yok. */
function menuXml(kapaklar) {
  const cov = kapaklar.map((c) => `<cover guId="" ID="${c.id}" etkID="${c.id}" actName="k${c.id}" `
    + `xmlSource="assets/${c.id}/data/BookContent.xml" `
    + `URL="https://example.invalid/${c.id}.zip"${c.v === undefined ? '' : ` version="${c.v}"`}/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<main activation="false" key="" version="1.0" type="1">\n`
    + `<Group ID="0"><Tab ID="0">\n${cov}\n</Tab></Group>\n</main>`;
}

/** @param {Record<string, Array<{id:string, v?:number}>|Buffer>} menuler dizin → kapaklar ('.' = kök) */
function zipKur(menuler) {
  const z = new AdmZip();
  z.addFile('index.html', Buffer.from('<html/>'));
  for (const [dizin, icerik] of Object.entries(menuler)) {
    const yol = `${dizin === '.' ? '' : `${dizin}/`}classlibraries/ImWin32.dll`;
    z.addFile(yol, Buffer.isBuffer(icerik) ? icerik : Buffer.from(ig.menuKodla(menuXml(icerik)), 'latin1'));
    for (const c of Buffer.isBuffer(icerik) ? [] : icerik) {
      if (c.icerik === false) continue;
      z.addFile(`${dizin === '.' ? '' : `${dizin}/`}assets/${c.id}/data/BookContent.xml`, Buffer.from('<Book/>'));
    }
  }
  const yol = path.join(tmp('zip'), 'build.zip');
  z.writeZip(yol);
  return yol;
}

test('set zip: iki bookN menüsü → [{id, vs, kitap}], ID 0 kapağı atlanır', () => {
  const zip = zipKur({
    book1: [{ id: '31456', v: 10 }, { id: '0', v: 1 }],
    book2: [{ id: '31457', v: 0 }],
  });
  const r = U.zipIcerikUyeleri(zip);
  assert.equal(r.hata, undefined);
  assert.equal(r.menuSayisi, 2);
  assert.equal(r.atlanan, 1);
  assert.deepEqual(r.uyeler, [
    { id: '31456', vs: 10, kitap: 'book1' },
    { id: '31457', vs: 0, kitap: 'book2' },
  ]);
  assert.deepEqual(U.govdeAlanlari(r), { icerikUyeleri: r.uyeler, icerikUyeleriKaynak: 'menu' });
});

test('tek kitap zip: kök menü → kitap "."', () => {
  const r = U.zipIcerikUyeleri(zipKur({ '.': [{ id: '555', v: 3 }] }));
  assert.deepEqual(r.uyeler, [{ id: '555', vs: 3, kitap: '.' }]);
  assert.equal(r.menuSayisi, 1);
});

test('version\'suz kapak ATLANIR (vs=0 uydurulmaz) ve sayılır', () => {
  const r = U.zipIcerikUyeleri(zipKur({ '.': [{ id: '10', v: undefined }, { id: '11', v: 2 }] }));
  assert.deepEqual(r.uyeler, [{ id: '11', vs: 2, kitap: '.' }]);
  assert.equal(r.atlanan, 1);
});

test('içeriği zip\'te olmayan kapak üye sayılmaz, atlanan\'a eklenir', () => {
  const r = U.zipIcerikUyeleri(zipKur({ '.': [{ id: '20', v: 1, icerik: false }, { id: '21', v: 3 }] }));
  assert.deepEqual(r.uyeler, [{ id: '21', vs: 3, kitap: '.' }]);
  assert.equal(r.atlanan, 1);
});

test('yinelenen id: ilk görülen kalır', () => {
  const r = U.zipIcerikUyeleri(zipKur({
    book1: [{ id: '77', v: 4 }],
    book2: [{ id: '77', v: 9 }, { id: '78', v: 1 }],
  }));
  assert.deepEqual(r.uyeler, [{ id: '77', vs: 4, kitap: 'book1' }, { id: '78', vs: 1, kitap: 'book2' }]);
  assert.equal(r.atlanan, 1);
});

test('bozuk menü → hata, uyeler boş; govdeAlanlari {} (alan hiç gönderilmez)', () => {
  const r = U.zipIcerikUyeleri(zipKur({ '.': Buffer.from('çöp-veri-çözülemez') }));
  assert.match(r.hata, /menü çözülemedi/);
  assert.deepEqual(r.uyeler, []);
  assert.deepEqual(U.govdeAlanlari(r), {});
});

test('zip değil / olmayan dosya → fırlatmaz, hata döner; menüsüz zip → boş, hatasız, {}', () => {
  assert.ok(U.zipIcerikUyeleri('/yok/yok.zip').hata);
  const z = new AdmZip();
  z.addFile('a.txt', Buffer.from('x'));
  const yol = path.join(tmp('bos'), 'b.zip');
  z.writeZip(yol);
  const r = U.zipIcerikUyeleri(yol);
  assert.equal(r.hata, undefined);
  assert.equal(r.menuSayisi, 0);
  assert.deepEqual(U.govdeAlanlari(r), {});
});

test('500 tavanı: 520 kapaktan 500 öğe, 20 atlandı', () => {
  const kapaklar = Array.from({ length: 520 }, (_, i) => ({ id: String(1000 + i), v: i % 7 }));
  const r = U.zipIcerikUyeleri(zipKur({ '.': kapaklar }));
  assert.equal(r.uyeler.length, 500);
  assert.equal(r.atlanan, 20);
  assert.equal(r.uyeler[0].id, '1000');
});

// ---------------------------------------------------------------------------
// /result gövdesi
// ---------------------------------------------------------------------------

async function sonucGovdeleri(isler) {
  const gelen = [];
  const s = http.createServer((req, res) => {
    const p = [];
    req.on('data', (d) => p.push(d));
    req.on('end', () => {
      const yol = req.url.split('?')[0];
      if (yol === '/agents/test/result/presign') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ uploadUrl: `http://127.0.0.1:${s.address().port}/put`, r2ObjectKey: 'k', publicUrl: 'p' }));
      }
      if (yol === '/agents/test/result') gelen.push(JSON.parse(Buffer.concat(p).toString()));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{}');
    });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const eski = CONFIG.apiBase;
  const eskiRate = process.env.AGENT_UPLOAD_RATE;
  CONFIG.apiBase = `http://127.0.0.1:${s.address().port}`;
  process.env.AGENT_UPLOAD_RATE = '';
  const orj = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try {
    const f = path.join(tmp('art'), 'a.apk');
    fs.writeFileSync(f, 'apk');
    for (const job of isler) await runner.postResultSuccess({ agentId: 'test', token: 'x' }, job, f);
  } finally {
    Object.assign(console, orj);
    CONFIG.apiBase = eski;
    if (eskiRate === undefined) delete process.env.AGENT_UPLOAD_RATE; else process.env.AGENT_UPLOAD_RATE = eskiRate;
    await new Promise((r) => { if (s.closeAllConnections) s.closeAllConnections(); s.close(r); });
  }
  return gelen;
}

test('/result gövdesi: job.icerikUyeleri varsa icerikUyeleri + icerikUyeleriKaynak, yoksa/boşsa HİÇ yok', async () => {
  const uyeler = [{ id: '31456', vs: 10, kitap: 'book1' }];
  const gelen = await sonucGovdeleri([
    { bookId: '1', platform: 'android', icerikUyeleri: uyeler },
    { bookId: '1', platform: 'android', icerikUyeleri: null },
    { bookId: '1', platform: 'android', icerikUyeleri: [] },
    { bookId: '1', platform: 'android' },
  ]);
  assert.deepEqual(gelen[0].icerikUyeleri, uyeler);
  assert.equal(gelen[0].icerikUyeleriKaynak, 'menu');
  for (const g of gelen.slice(1)) {
    assert.equal('icerikUyeleri' in g, false);
    assert.equal('icerikUyeleriKaynak' in g, false);
  }
});

// ---------------------------------------------------------------------------
// hazır kuyruk kaydı → bekçi job'ı
// ---------------------------------------------------------------------------

test('hazirKoy manifest.job icerikUyeleri saklar (jobOzeti); yoksa alan yok', () => {
  const uyeler = [{ id: '5', vs: 2, kitap: '.' }];
  assert.deepEqual(H.jobOzeti({ bookId: '1', icerikUyeleri: uyeler }).icerikUyeleri, uyeler);
  assert.equal('icerikUyeleri' in H.jobOzeti({ bookId: '1' }), false);
});
