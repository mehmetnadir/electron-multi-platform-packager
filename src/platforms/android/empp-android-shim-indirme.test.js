'use strict';
// GERİLEME (K8, 2026-09-22): Android pakette kitap kartındaki mavi (indir) / yeşil (güncelle)
// bulut %0'da takılıyordu — https saplaması hemen hata veriyor, AdmZip hiçbir şey yapmıyor,
// path.parse yoktu. Bu dosya zinciri UÇTAN UCA sınar: GERÇEK HTTP sunucusu → https.get akışı
// (ilerleme olayları) → createWriteStream (bellek) → AdmZip.extractAllTo → Cache Storage →
// existsSync + indirilen yanıt. Taşıma katmanı mock'lanmaz.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const zlib = require('node:zlib');
const nodePath = require('node:path');
const shim = require('./empp-android-shim.js');

const { fsMod, pathMod, _internals: I } = shim;

// ---- yardımcılar ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Gerçek zip üretir (deflate ya da stored). girdiler: [[ad, Buffer, 'deflate'|'stored']]
function zipYap(girdiler) {
  const yereller = [], merkez = [];
  let ofset = 0;
  for (const [ad, veri, yontemAdi] of girdiler) {
    const adB = Buffer.from(ad, 'utf8');
    const yontem = yontemAdi === 'stored' ? 0 : 8;
    const sik = yontem === 8 ? zlib.deflateRawSync(veri) : veri;
    const crc = crc32(veri);
    const y = Buffer.alloc(30);
    y.writeUInt32LE(0x04034b50, 0); y.writeUInt16LE(20, 4); y.writeUInt16LE(0x800, 6);
    y.writeUInt16LE(yontem, 8); y.writeUInt32LE(crc, 14); y.writeUInt32LE(sik.length, 18);
    y.writeUInt32LE(veri.length, 22); y.writeUInt16LE(adB.length, 26);
    yereller.push(y, adB, sik);
    const m = Buffer.alloc(46);
    m.writeUInt32LE(0x02014b50, 0); m.writeUInt16LE(20, 4); m.writeUInt16LE(20, 6); m.writeUInt16LE(0x800, 8);
    m.writeUInt16LE(yontem, 10); m.writeUInt32LE(crc, 16); m.writeUInt32LE(sik.length, 20);
    m.writeUInt32LE(veri.length, 24); m.writeUInt16LE(adB.length, 28); m.writeUInt32LE(ofset, 42);
    merkez.push(m, adB);
    ofset += 30 + adB.length + sik.length;
  }
  const md = Buffer.concat(merkez);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(girdiler.length, 8); e.writeUInt16LE(girdiler.length, 10);
  e.writeUInt32LE(md.length, 12); e.writeUInt32LE(ofset, 16);
  return Buffer.concat([...yereller, md, e]);
}
class SahteDepo {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
// Cache Storage: gerçek Response nesneleri saklanır (bayt kopyasıyla).
function sahteCaches() {
  const kasalar = new Map();
  return {
    kasalar,
    open: async (ad) => {
      if (!kasalar.has(ad)) kasalar.set(ad, new Map());
      const m = kasalar.get(ad);
      return {
        put: async (k, r) => { m.set(k, { tip: r.headers.get('content-type'), veri: Buffer.from(await r.arrayBuffer()) }); },
        match: async (k) => (m.has(k) ? new Response(m.get(k).veri, { headers: { 'Content-Type': m.get(k).tip } }) : undefined),
        delete: async (k) => m.delete(k),
      };
    },
  };
}
function ortamKur() {
  const caches = sahteCaches();
  I.ortam.caches = caches;
  I.ortam.storage = new SahteDepo();
  I.ortam.origin = 'https://localhost';
  return caches;
}
function sunucu(yollar) {
  return new Promise((coz) => {
    const s = http.createServer((req, res) => {
      const g = yollar[req.url];
      if (!g) { res.writeHead(404); res.end('yok'); return; }
      res.writeHead(200, { 'Content-Length': g.length, 'Content-Type': 'application/x-zip-compressed' });
      // Parça parça yaz — ilerleme olayları GERÇEKTEN birden çok gelsin.
      let i = 0; const P = 64 * 1024;
      (function yaz() { if (i >= g.length) return res.end(); res.write(g.subarray(i, i + P)); i += P; setImmediate(yaz); })();
    });
    s.listen(0, '127.0.0.1', () => coz(s));
  });
}
// Motorun (modül 552 `S`) indirme fonksiyonunun birebir kopyası — shim'e karşı koşar.
function motorIndir(url, hedef, ilerle) {
  return new Promise((a, o) => {
    const i = fsMod, l = i.createWriteStream(hedef); let c = 0;
    I.httpsGet(url, (e) => {
      const r = parseInt(e.headers['content-length'], 10); let son = 0;
      e.on('data', (d) => { c += d.length; if (ilerle && r) { const t = parseInt((c / r * 100).toFixed(0)); if (t - son > 1) { ilerle({ loaded: t }); son = t; } } });
      e.pipe(l);
      l.on('error', o);
      l.on('finish', () => { l.close(); a(hedef); });
    }).on('error', (e) => { i.unlink(hedef, () => {}); o(e); });
  });
}
const bayt = (n, tohum) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + tohum) & 0xff));

// ---- testler ----
test('path.parse: motorun zip hedefi Node ile AYNI dizini verir', () => {
  for (const p of ['assets/70465/update.zip', '/assets/70465/update.zip', 'update.zip']) {
    assert.strictEqual(pathMod.parse(p).dir, nodePath.posix.parse(p).dir, p);
    assert.strictEqual(pathMod.parse(p).base, nodePath.posix.parse(p).base, p);
  }
});

test('zip okuyucu: deflate + stored girdiler bayt-bayt doğru açılır', async () => {
  const a = bayt(200000, 7), b = Buffer.from('<?xml version="1.0"?><x/>');
  const u8 = new Uint8Array(zipYap([['pages/1.png', a, 'deflate'], ['data/BookContent.xml', b, 'stored']]));
  const g = I.zipGirdileri(u8);
  assert.deepStrictEqual(g.map((x) => x.ad), ['pages/1.png', 'data/BookContent.xml']);
  assert.ok(Buffer.from(await I.zipGirdiAc(u8, g[0])).equals(a));
  assert.ok(Buffer.from(await I.zipGirdiAc(u8, g[1])).equals(b));
});

test('zip-slip: kök dışına çıkan ve mutlak adlar ATLANIR', () => {
  const u8 = new Uint8Array(zipYap([['../kacak.txt', Buffer.from('x'), 'stored'],
    ['/mutlak.txt', Buffer.from('x'), 'stored'], ['a/../../b.txt', Buffer.from('x'), 'stored'],
    ['pages/1.png', Buffer.from('ok'), 'stored']]));
  assert.deepStrictEqual(I.zipGirdileri(u8).map((x) => x.ad), ['pages/1.png']);
});

test('GERİLEME: indirme ilerlemesi %0da kalmaz — gerçek HTTP, akış, uçtan uca açma', async () => {
  const caches = ortamKur();
  // Sıkışmaz veri (gerçek sayfa PNG'si gibi) — yoksa zip birkaç KB olur, tek parçada gelir.
  const sayfa = require('node:crypto').randomBytes(700000), xml = Buffer.from('<BookContent bookId="70465"/>');
  const zip = zipYap([['pages/1.png', sayfa, 'stored'], ['data/BookContent.xml', xml, 'deflate'],
    ['thumbs/1.jpg', bayt(5000, 9), 'stored']]);
  const s = await sunucu({ '/Uploads/ZKitapZipH/70465-1.zip': zip });
  try {
    const url = `http://127.0.0.1:${s.address().port}/Uploads/ZKitapZipH/70465-1.zip`;
    const hedef = pathMod.join('', 'assets/70465', 'update.zip'); // getFilePath(book,'update.zip')
    const ilerleme = [];
    await motorIndir(url, hedef, (e) => ilerleme.push(e.loaded));
    assert.ok(ilerleme.length >= 2, `ilerleme olayı gelmedi: ${ilerleme}`);
    assert.ok(ilerleme[ilerleme.length - 1] >= 95, `son ilerleme ${ilerleme[ilerleme.length - 1]}`);
    const blob = I.bellekDosyalari['/assets/70465/update.zip'];
    assert.ok(blob, 'zip bellekte değil');
    assert.strictEqual(blob.size, zip.length, 'zip boyutu tutmadı');

    assert.strictEqual(fsMod.existsSync('assets/70465/data/BookContent.xml'), false, 'açmadan önce yok');
    const z = new I.AdmZip(hedef);
    await z.extractAllTo(pathMod.parse(hedef).dir, true);
    fsMod.unlinkSync(hedef);
    assert.strictEqual(I.bellekDosyalari['/assets/70465/update.zip'], undefined, 'bellek boşalmadı');

    assert.strictEqual(fsMod.existsSync('assets/70465/data/BookContent.xml'), true, 'isDownloaded ölçütü');
    assert.strictEqual(fsMod.existsSync('assets/70465/pages'), true, 'dizin');
    const r = await I.indirilenYanit(I.mutlakYol('assets/70465/pages/1.png'));
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(sayfa), 'sayfa baytları');
    assert.strictEqual(r.headers.get('content-type'), 'image/png');
    assert.strictEqual(caches.kasalar.get('empp-kitap-v1').size, 3);
  } finally { s.close(); }
});

test('sunucuda zip yoksa (404) istek HATA verir, sahte başarı yazılmaz', async () => {
  ortamKur();
  const s = await sunucu({});
  try {
    const url = `http://127.0.0.1:${s.address().port}/Uploads/ZKitapZipH/15415-1.zip`;
    await assert.rejects(motorIndir(url, 'assets/15415/update.zip'), /HTTP 404/);
    assert.strictEqual(I.bellekDosyalari['/assets/15415/update.zip'], undefined);
    assert.strictEqual(fsMod.existsSync('assets/15415/data/BookContent.xml'), false);
  } finally { s.close(); }
});

test('güncelleme: yeni sürüm eskinin yerini alır, eskide olup yenide olmayan dosya SİLİNİR', async () => {
  const caches = ortamKur();
  const bir = zipYap([['pages/1.png', Buffer.from('ESKI1'), 'stored'], ['pages/9.png', Buffer.from('ESKI9'), 'stored']]);
  const iki = zipYap([['pages/1.png', Buffer.from('YENI1'), 'deflate']]);
  await I.kitapAc(new Blob([bir]), 'assets/1');
  await I.kitapAc(new Blob([iki]), 'assets/1');
  const r = await I.indirilenYanit('/assets/1/pages/1.png');
  assert.strictEqual(await r.text(), 'YENI1');
  assert.strictEqual(fsMod.existsSync('assets/1/pages/9.png'), false);
  assert.strictEqual(caches.kasalar.get('empp-kitap-v1').has('https://localhost/assets/1/pages/9.png'), false);
});

test('bozuk zip: dizin YAZILMAZ — yarım kitap "indirildi" görünmez', async () => {
  ortamKur();
  const iyi = zipYap([['data/BookContent.xml', Buffer.from('<a/>'), 'stored']]);
  await assert.rejects(I.kitapAc(new Blob([iyi.subarray(0, 20)]), 'assets/2'));
  assert.strictEqual(fsMod.existsSync('assets/2/data/BookContent.xml'), false);
});

test('başka kitabın / başka hostun yolu indirilmiş sayılmaz', async () => {
  ortamKur();
  await I.kitapAc(new Blob([zipYap([['data/a.xml', Buffer.from('a'), 'stored']])]), 'assets/3');
  assert.strictEqual(I.indirilmis('/assets/30/data/a.xml'), false, 'önek çakışması');
  assert.strictEqual(I.mutlakYol('https://www.besegitim.com/assets/3/data/a.xml'), null);
  assert.strictEqual(I.indirilmis(I.mutlakYol('https://localhost/assets/3/data/a.xml')), 'dosya');
});

test('küçük metin yazımı eski VFS davranışını korur (localStorage yolu)', () => {
  // Metin parçaları bellek Blob'una GİTMEZ; writeFileSync yoluna düşer.
  const ws = fsMod.createWriteStream('temp/x.json');
  let bitti = false; ws.on('finish', () => { bitti = true; });
  ws.write('{"a":'); ws.end('1}');
  assert.strictEqual(bitti, true);
  assert.strictEqual(I.bellekDosyalari['/temp/x.json'], undefined);
});

test('Buffer yerine-koyma: from(ArrayBuffer) bayt korur, isBuffer yalnız kendi ürettiğini tanır', () => {
  const b = I.BufferShim.from(new Uint8Array([1, 2, 3]).buffer);
  assert.deepStrictEqual([...b], [1, 2, 3]);
  assert.strictEqual(I.BufferShim.isBuffer(b), true);
  assert.strictEqual(I.BufferShim.isBuffer(new Uint8Array(2)), false);
  assert.strictEqual(new TextDecoder().decode(I.BufferShim.from('şğü')), 'şğü');
});
