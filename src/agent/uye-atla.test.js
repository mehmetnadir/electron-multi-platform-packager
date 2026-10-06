'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('./uye-atla');

test('atlamaKarari: kesin-yok yok → atlama yok; yarıya kadar (dahil) atlanır; yarıdan fazlası ve tek üye atlanmaz', () => {
  assert.equal(U.atlamaKarari({ toplam: 21, kesin: 1, digerEksik: 0 }).atla, true, '45479: 21 üyeden 14835');
  assert.equal(U.atlamaKarari({ toplam: 4, kesin: 2, digerEksik: 0 }).atla, true, 'tam yarı geçer');
  assert.equal(U.atlamaKarari({ toplam: 3, kesin: 2, digerEksik: 0 }).atla, false, 'yarıdan fazla');
  assert.equal(U.atlamaKarari({ toplam: 1, kesin: 1, digerEksik: 0 }).atla, false, 'tek üye');
  assert.equal(U.atlamaKarari({ toplam: 5, kesin: 0, digerEksik: 0 }).atla, false);
  assert.equal(U.atlamaKarari({ toplam: 5, kesin: 1, digerEksik: 1 }).atla, false, 'başka eksik varsa ertelenir');
  assert.match(U.atlamaKarari({ toplam: 3, kesin: 2, digerEksik: 0 }).sebep, /tavan: 2\/3/);
});

test('imparkTeklif404mu / indirme404mu: yalnız 404 kesin; 5xx/403/ağ/boş değil', () => {
  assert.equal(U.imparkTeklif404mu({ status: 404, govde: '' }), true);
  for (const c of [{ status: 500 }, { status: 502 }, { status: 403 }, { status: 200 }, { hata: 'zaman aşımı' },
    { status: 404, hata: 'x' }, null, undefined]) {
    assert.equal(U.imparkTeklif404mu(c), false, JSON.stringify(c));
  }
  const e404 = Object.assign(new Error('x'), { httpDurum: 404 });
  assert.equal(U.indirme404mu(e404), true);
  assert.equal(U.indirme404mu(Object.assign(new Error('x'), { stderr: 'curl: (22) The requested URL returned error: 404' })), true);
  for (const e of [Object.assign(new Error('x'), { httpDurum: 503 }), Object.assign(new Error('x'), { httpDurum: 403 }),
    new Error('indirilemedi (indirme kodu 28)'), null,
    Object.assign(new Error('x'), { stderr: 'curl: (22) The requested URL returned error: 4040' })]) {
    assert.equal(U.indirme404mu(e), false);
  }
});

test('logSatiri: sabit biçim', () => {
  assert.equal(U.logSatiri('45479', { kitapId: '14835', ad: 'The Old Man and the Sea', sebep: "İmpark'ta içerik yok" }),
    '[uretec] UYE ATLANDI 45479: 14835 "The Old Man and the Sea" — İmpark\'ta içerik yok');
});

test('govdeAlanlari / birlestir', () => {
  assert.deepEqual(U.govdeAlanlari([]), {});
  assert.deepEqual(U.govdeAlanlari(null), {});
  const g = U.govdeAlanlari([{ kitapId: '14835', ad: 'Old Man', sebep: 'yok' }]);
  assert.equal(g.atlananUyeler.length, 1);
  assert.match(g.uyeAtlandiNotu, /^\[uretec\] UYE ATLANDI \(1\): 14835 "Old Man" — yok$/);
  assert.deepEqual(U.birlestir([{ kitapId: '1', ad: 'a' }], [{ kitapId: '1', ad: 'b' }, { kitapId: '2' }], undefined)
    .map((x) => x.ad || x.kitapId), ['a', '2']);
});

test('damgaAl: aynı gün aynı set×kitap bir kez; yazılamazsa bildirim kaybolmaz', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'uye-damga-'));
  const t = new Date('2026-10-06T08:00:00');
  assert.equal(U.damgaAl({ setId: '1', kitapId: '2', dizin: d, simdi: t }), true);
  assert.equal(U.damgaAl({ setId: '1', kitapId: '2', dizin: d, simdi: t }), false);
  assert.equal(U.damgaAl({ setId: '1', kitapId: '3', dizin: d, simdi: t }), true);
  assert.equal(U.damgaAl({ setId: '1', kitapId: '2', dizin: d, simdi: new Date('2026-10-07T08:00:00') }), true);
  // Dizin yerine dosya → mkdir hata verir, EEXIST değil → true (bildirim yine gider)
  const dosya = path.join(d, 'dosya');
  fs.writeFileSync(dosya, 'x');
  assert.equal(U.damgaAl({ setId: '1', kitapId: '2', dizin: path.join(dosya, 'alt'), simdi: t }), true);
});

test('varsayilanIndir: gerçek HTTP 404 → hata.httpDurum=404 → indirme404mu (curl --fail ölçümü, ~15 sn: 5 yeniden deneme)', async () => {
  const http = require('http');
  const M = require('./icerik-merdiven');
  const sunucu = http.createServer((q, s) => { s.statusCode = 404; s.end('yok'); });
  await new Promise((r) => { sunucu.listen(0, '127.0.0.1', r); });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'uye-indir-'));
  try {
    const url = `http://127.0.0.1:${sunucu.address().port}/Uploads/ZKitapZipH/14835-3.zip`;
    const e = await M.varsayilanIndir(url, path.join(d, 'x.zip')).then(() => null, (x) => x);
    assert.ok(e, 'hata fırlatılmalı');
    assert.equal(e.httpDurum, 404);
    assert.equal(U.indirme404mu(e), true);
  } finally {
    sunucu.close();
  }
});
