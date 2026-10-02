'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const devam = require('./devam-yukleme');

const gecici = () => fs.mkdtempSync(path.join(os.tmpdir(), 'devam-yukleme-'));
const MB = 1024 * 1024;

// ------------------------------------------------------------------ birim: durum + karar mantığı
const sahteIstemci = (ek = {}) => {
  const c = { baslat: 0, durum: 0, iptal: [], ...ek };
  return {
    c,
    istemci: {
      baslat: async (n) => {
        c.baslat += 1;
        if (ek.baslatNull) return null;
        return { uploadId: `U${c.baslat}`, r2ObjectKey: 'anahtar', contentType: 'x/y', urls: Array.from({ length: n }, (_, i) => ({ partNumber: i + 1, url: `u${i + 1}` })) };
      },
      durum: async (g) => {
        c.durum += 1;
        if (ek.durumHata && c.durum <= ek.durumHata) throw new Error('ağ');
        if (ek.durumYok) return { durum: 'yok' };
        return { durum: 'var', parcalar: ek.r2Parcalar || [], urls: Array.from({ length: g.partCount }, (_, i) => ({ partNumber: i + 1, url: `taze${i + 1}` })) };
      },
      iptal: async (g) => { c.iptal.push(g.uploadId); },
    },
  };
};
const dosyaYap = (dizin, bayt) => {
  const f = path.join(dizin, 'a.bin');
  fs.writeFileSync(f, crypto.randomBytes(bayt));
  return f;
};
const ortak = (dizin, f, size, sha, istemci, parcaYukleyici) => ({
  dosya: f, size, sha256: sha, partSize: MB, kimlik: { bookId: '1', platform: 'android' },
  istemci, parcaYukleyici, dizin: path.join(dizin, 'y'), bekle: async () => {},
});

test('durumYolu: kimlikten güvenli dosya adı', () => {
  const y = devam.durumYolu({ kapsam: 'paket', bookId: '45/../x', platform: 'android' }, '/d');
  assert.equal(y, '/d/paket-45_.._x-android.json');
});

test('ilk yükleme: baslat çağrılır, her parça durum dosyasına yazılır', async () => {
  const d = gecici(); const f = dosyaYap(d, 3 * MB);
  const { c, istemci } = sahteIstemci();
  let kaydetCagri = 0;
  const y = await devam.cokParcaYukle(ortak(d, f, 3 * MB, 'sha1', istemci, async (_f, _s, _p, urls, _ct, sec) => {
    for (const { partNumber } of urls) { await sec.kaydet(partNumber, `"e${partNumber}"`); kaydetCagri += 1; }
    return urls.map((u) => ({ partNumber: u.partNumber, etag: `"e${u.partNumber}"` }));
  }));
  assert.equal(c.baslat, 1); assert.equal(kaydetCagri, 3); assert.equal(y.devamEdildi, false);
  const kayit = JSON.parse(fs.readFileSync(y.durumYolu, 'utf8'));
  assert.deepEqual(Object.keys(kayit.parcalar), ['1', '2', '3']);
  assert.equal(kayit.uploadId, 'U1');
});

test('devam: eşleşen kayıt + R2 ListParts → yalnız eksikler, baslat ÇAĞRILMAZ, taze URL kullanılır', async () => {
  const d = gecici(); const f = dosyaYap(d, 4 * MB);
  const yol = devam.durumYolu({ kapsam: 'paket', bookId: '1', platform: 'android' }, path.join(d, 'y'));
  await devam.durumYaz(yol, { v: 1, kapsam: 'paket', bookId: '1', platform: 'android', uploadId: 'ESKI', r2ObjectKey: 'anahtar', size: 4 * MB, sha256: 'sha1', partSize: MB, partCount: 4, parcalar: { 1: '"a"', 2: '"b"' } });
  // R2: 1 ve 2 duruyor; 3 yarım değil yok
  const { c, istemci } = sahteIstemci({ r2Parcalar: [{ partNumber: 1, etag: '"a"', size: MB }, { partNumber: 2, etag: '"b"', size: MB }] });
  let gelenSec; let gelenUrls;
  const y = await devam.cokParcaYukle(ortak(d, f, 4 * MB, 'sha1', istemci, async (_f, _s, _p, urls, _ct, sec) => {
    gelenSec = sec; gelenUrls = urls;
    return [1, 2, 3, 4].map((n) => ({ partNumber: n, etag: sec.tamamlanan[n] || `"y${n}"` }));
  }));
  assert.equal(c.baslat, 0);
  assert.equal(y.devamEdildi, true); assert.equal(y.atlanan, 2); assert.equal(y.uploadId, 'ESKI');
  assert.deepEqual(Object.keys(gelenSec.tamamlanan), ['1', '2']);
  assert.equal(gelenUrls[0].url, 'taze1');
});

test('devam: yerel kayıtta olup R2 ListParts\'ta OLMAYAN ya da boyutu yanlış parça yeniden yüklenir', async () => {
  const d = gecici(); const f = dosyaYap(d, 4 * MB);
  const yol = devam.durumYolu({ kapsam: 'paket', bookId: '1', platform: 'android' }, path.join(d, 'y'));
  await devam.durumYaz(yol, { v: 1, kapsam: 'paket', bookId: '1', platform: 'android', uploadId: 'E', r2ObjectKey: 'a', size: 4 * MB, sha256: 's', partSize: MB, partCount: 4, parcalar: { 1: '"a"', 2: '"b"', 3: '"c"' } });
  const { istemci } = sahteIstemci({ r2Parcalar: [{ partNumber: 1, etag: '"a"', size: MB }, { partNumber: 3, etag: '"c"', size: 12345 }] });
  let sec0;
  await devam.cokParcaYukle(ortak(d, f, 4 * MB, 's', istemci, async (_f, _s, _p, _u, _c, sec) => { sec0 = sec; return []; }));
  assert.deepEqual(Object.keys(sec0.tamamlanan), ['1']);
});

test('dosya değişti (sha farklı): eski yükleme İPTAL edilir, baştan başlanır', async () => {
  const d = gecici(); const f = dosyaYap(d, 2 * MB);
  const yol = devam.durumYolu({ kapsam: 'paket', bookId: '1', platform: 'android' }, path.join(d, 'y'));
  await devam.durumYaz(yol, { v: 1, kapsam: 'paket', bookId: '1', platform: 'android', uploadId: 'ESKI', r2ObjectKey: 'a', size: 2 * MB, sha256: 'ESKISHA', partSize: MB, partCount: 2, parcalar: { 1: '"a"' } });
  const { c, istemci } = sahteIstemci();
  const y = await devam.cokParcaYukle(ortak(d, f, 2 * MB, 'YENISHA', istemci, async () => []));
  assert.deepEqual(c.iptal, ['ESKI']); assert.equal(c.baslat, 1); assert.equal(y.uploadId, 'U1');
});

test('R2\'de yükleme yok (iptal/sona ermiş): kayıt silinir, baştan başlanır (iptal çağrısı gereksiz)', async () => {
  const d = gecici(); const f = dosyaYap(d, 2 * MB);
  const yol = devam.durumYolu({ kapsam: 'paket', bookId: '1', platform: 'android' }, path.join(d, 'y'));
  await devam.durumYaz(yol, { v: 1, kapsam: 'paket', bookId: '1', platform: 'android', uploadId: 'ESKI', r2ObjectKey: 'a', size: 2 * MB, sha256: 's', partSize: MB, partCount: 2, parcalar: { 1: '"a"' } });
  const { c, istemci } = sahteIstemci({ durumYok: true });
  const y = await devam.cokParcaYukle(ortak(d, f, 2 * MB, 's', istemci, async () => []));
  assert.equal(c.baslat, 1); assert.deepEqual(c.iptal, []); assert.equal(y.uploadId, 'U1');
});

test('kayıt 24 saatten eski: iptal + baştan', async () => {
  const d = gecici(); const f = dosyaYap(d, 2 * MB);
  const yol = devam.durumYolu({ kapsam: 'paket', bookId: '1', platform: 'android' }, path.join(d, 'y'));
  await devam.durumYaz(yol, { v: 1, kapsam: 'paket', bookId: '1', platform: 'android', uploadId: 'ESKI', r2ObjectKey: 'a', size: 2 * MB, sha256: 's', partSize: MB, partCount: 2, parcalar: {} });
  const { c, istemci } = sahteIstemci();
  await devam.cokParcaYukle({ ...ortak(d, f, 2 * MB, 's', istemci, async () => []), simdi: () => Date.now() + 25 * 3600e3 });
  assert.deepEqual(c.iptal, ['ESKI']); assert.equal(c.baslat, 1);
});

test('durum sorgusu geçici hatayla düşerse: yeniden dene; sürerse FIRLAT ve kaydı KORU (sahipsiz bırakma)', async () => {
  const d = gecici(); const f = dosyaYap(d, 2 * MB);
  const yol = devam.durumYolu({ kapsam: 'paket', bookId: '1', platform: 'android' }, path.join(d, 'y'));
  await devam.durumYaz(yol, { v: 1, kapsam: 'paket', bookId: '1', platform: 'android', uploadId: 'ESKI', r2ObjectKey: 'a', size: 2 * MB, sha256: 's', partSize: MB, partCount: 2, parcalar: { 1: '"a"' } });
  const { c, istemci } = sahteIstemci({ durumHata: 99 });
  await assert.rejects(devam.cokParcaYukle(ortak(d, f, 2 * MB, 's', istemci, async () => [])), /ağ/);
  assert.equal(c.durum, 4); assert.equal(c.baslat, 0);
  assert.ok(fs.existsSync(yol), 'kayıt korunmalı');
  // 2. çağrıda ilk 2 deneme düşer, 3.sü geçer
  const k = sahteIstemci({ durumHata: 2 });
  const y = await devam.cokParcaYukle(ortak(d, f, 2 * MB, 's', k.istemci, async () => []));
  assert.equal(y.devamEdildi, true);
});

test('sunucu eski (baslat null): null döner → çağıran tek parça yola düşer; kayıt bırakılmaz', async () => {
  const d = gecici(); const f = dosyaYap(d, 2 * MB);
  const { istemci } = sahteIstemci({ baslatNull: true });
  assert.equal(await devam.cokParcaYukle(ortak(d, f, 2 * MB, 's', istemci, async () => [])), null);
  assert.deepEqual(fs.existsSync(path.join(d, 'y')) ? fs.readdirSync(path.join(d, 'y')) : [], []);
});

test('eskileriTemizle: yalnız süresi dolan iptal edilip silinir', async () => {
  const d = gecici(); const dizin = path.join(d, 'y');
  const taban = { v: 1, kapsam: 'paket', platform: 'android', r2ObjectKey: 'a', parcalar: {} };
  await devam.durumYaz(path.join(dizin, 'paket-1-android.json'), { ...taban, bookId: '1', uploadId: 'ESKI' });
  await devam.durumYaz(path.join(dizin, 'paket-2-android.json'), { ...taban, bookId: '2', uploadId: 'YENI' });
  // 1'i yaşlandır
  const p1 = path.join(dizin, 'paket-1-android.json');
  const j = JSON.parse(fs.readFileSync(p1, 'utf8')); j.guncelleme = Date.now() - 30 * 3600e3;
  fs.writeFileSync(p1, JSON.stringify(j));
  const iptaller = [];
  const r = await devam.eskileriTemizle({ dizin, iptalci: async (k) => { iptaller.push(k.uploadId); } });
  assert.equal(r.silinen, 1); assert.deepEqual(iptaller, ['ESKI']);
  assert.deepEqual(fs.readdirSync(dizin), ['paket-2-android.json']);
});

// ------------------------------------------------------------------ kesinti: gerçek curl/dd + SIGKILL
/** Sahte R2 + sunucu: parçalar bellekte; PUT'lar günlüğe yazılır. */
function sahteSunucu({ putGecikmeMs = 0 } = {}) {
  const st = { yuklemeler: {}, putlar: [], sayac: 0, birlesen: null };
  const srv = http.createServer((q, r) => {
    const parcalar = [];
    q.on('data', (b) => parcalar.push(b));
    q.on('end', () => {
      const govde = Buffer.concat(parcalar);
      const url = q.url;
      const js = (o, kod = 200) => { r.statusCode = kod; r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(o)); };
      const port = srv.address().port;
      const urls = (n, u) => Array.from({ length: n }, (_, i) => ({ partNumber: i + 1, url: `http://127.0.0.1:${port}/put/${u}/${i + 1}` }));
      if (q.method === 'PUT') {
        const [, , u, n] = url.split('/');
        const kayit = st.yuklemeler[u];
        if (!kayit) { r.statusCode = 404; return r.end(); }
        setTimeout(() => {
          const etag = crypto.createHash('md5').update(govde).digest('hex');
          kayit.parcalar[n] = { etag: `"${etag}"`, govde };
          st.putlar.push({ u, n: Number(n) });
          r.setHeader('ETag', `"${etag}"`); r.end();
        }, putGecikmeMs);
        return undefined;
      }
      const g = govde.length ? JSON.parse(govde.toString()) : {};
      if (url === '/baslat') {
        st.sayac += 1; const u = `UP${st.sayac}`;
        st.yuklemeler[u] = { parcalar: {} };
        return js({ uploadId: u, r2ObjectKey: 'k/a.bin', contentType: 'application/octet-stream', urls: urls(g.partCount, u) });
      }
      if (url === '/durum') {
        const kayit = st.yuklemeler[g.uploadId];
        if (!kayit) return js({}, 404);
        return js({
          parcalar: Object.entries(kayit.parcalar).map(([n, p]) => ({ partNumber: Number(n), etag: p.etag, size: p.govde.length })),
          urls: urls(g.partCount, g.uploadId),
        });
      }
      if (url === '/iptal') { delete st.yuklemeler[g.uploadId]; return js({}); }
      if (url === '/birlestir') {
        const k = st.yuklemeler[g.uploadId];
        st.birlesen = Buffer.concat(g.parts.sort((a, b) => a.partNumber - b.partNumber).map((p) => k.parcalar[p.partNumber].govde));
        return js({});
      }
      return js({}, 404);
    });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, st, port: srv.address().port })));
}

const cocukCalistir = (dosya, port, dizin, env = {}) => spawn(process.execPath, [path.join(__dirname, 'devam-yukleme-cocuk.js'), dosya, String(port)], {
  env: { ...process.env, EMPP_YUKLEME_DIZIN: path.join(dizin, 'y'), AGENT_UPLOAD_PART_ATTEMPTS: '1', ...env },
});
const bitir = (p) => new Promise((res) => { let o = ''; p.stdout.on('data', (b) => { o += b; }); p.stderr.on('data', (b) => { o += b; }); p.on('close', (kod, sinyal) => res({ kod, sinyal, o })); });

test('kesinti: süreç SIGKILL ile ölür → yeniden başlayınca yalnız eksik parçalar gider, son dosya sha doğru', { timeout: 90000 }, async () => {
  const d = gecici();
  const f = path.join(d, 'a.bin');
  fs.writeFileSync(f, crypto.randomBytes(8 * MB + 300000)); // 9 parça (son kısmi)
  const sha = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const { srv, st, port } = await sahteSunucu({ putGecikmeMs: 250 });
  try {
    // 1. süreç: yavaş sunucu; ≥3 parça kaydedilince öldür
    const c1 = cocukCalistir(f, port, d);
    const c1Son = bitir(c1);
    const t0 = Date.now();
    while (Object.keys(st.yuklemeler.UP1 ? st.yuklemeler.UP1.parcalar : {}).length < 3 && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 20));
    c1.kill('SIGKILL');
    const s1 = await c1Son;
    assert.equal(s1.sinyal, 'SIGKILL');
    const oncekiPut = st.putlar.length;
    const hazir = Object.keys(st.yuklemeler.UP1.parcalar).map(Number).sort((a, b) => a - b);
    assert.ok(hazir.length >= 3 && hazir.length < 9, `yarıda kalmalı: ${hazir}`);
    const kayitYolu = path.join(d, 'y', 'paket-9001-android.json');
    assert.ok(fs.existsSync(kayitYolu), 'durum dosyası ölümden sonra duruyor');

    // 2. süreç: aynı sunucu, devam
    const c2 = cocukCalistir(f, port, d);
    const s2 = await bitir(c2);
    assert.equal(s2.kod, 0, s2.o);
    assert.match(s2.o, /SONUC \{"devamEdildi":true/);
    const yeniPutlar = st.putlar.slice(oncekiPut).map((x) => x.n).sort((a, b) => a - b);
    // yalnız eksikler: önceden R2'de olan HİÇBİR parça yeniden gönderilmedi
    for (const n of hazir) assert.ok(!yeniPutlar.includes(n), `parça ${n} yeniden gitti: ${yeniPutlar}`);
    assert.equal(st.yuklemeler.UP1 !== undefined && st.sayac, 1, 'yeni uploadId açılmadı');
    assert.equal(crypto.createHash('sha256').update(st.birlesen).digest('hex'), sha, 'birleşen dosya orijinalle aynı');
    assert.equal(fs.existsSync(kayitYolu), false, 'başarıdan sonra kayıt silinir');
  } finally { srv.close(); }
});

test('kesinti: dosya değişince devam EDİLMEZ — eski yükleme iptal, yeni uploadId, doğru birleşim', { timeout: 90000 }, async () => {
  const d = gecici();
  const f = path.join(d, 'a.bin');
  fs.writeFileSync(f, crypto.randomBytes(6 * MB));
  const { srv, st, port } = await sahteSunucu({ putGecikmeMs: 250 });
  try {
    const c1 = cocukCalistir(f, port, d); const c1Son = bitir(c1);
    const t0 = Date.now();
    while (Object.keys(st.yuklemeler.UP1 ? st.yuklemeler.UP1.parcalar : {}).length < 2 && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 20));
    c1.kill('SIGKILL'); await c1Son;
    fs.writeFileSync(f, crypto.randomBytes(6 * MB)); // içerik değişti, aynı boyut
    const sha2 = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    const s2 = await bitir(cocukCalistir(f, port, d));
    assert.equal(s2.kod, 0, s2.o);
    assert.match(s2.o, /SONUC \{"devamEdildi":false/);
    assert.equal(st.yuklemeler.UP1, undefined, 'eski yükleme iptal edildi');
    assert.equal(st.sayac, 2);
    assert.equal(crypto.createHash('sha256').update(st.birlesen).digest('hex'), sha2);
  } finally { srv.close(); }
});
