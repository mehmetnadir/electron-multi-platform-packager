'use strict';

/**
 * SET GÜNCELLEYİCİ TESTLERİ.
 *
 * DİSİPLİN: dosya sistemi HER TESTTE GERÇEK (gerçek geçici dizin) — mocklu fs
 * taşıma katmanını gizler. Ağ ise ikiye ayrılır:
 *   • Uçtan uca testler GERÇEK `http` sunucusuyla koşar (varsayılan `getir` ve
 *     akışlı `arsiviIndir` gerçekten çalışır).
 *   • Dal testlerinde `getir` enjekte edilir — yalnız uzak ucun DAVRANIŞINI
 *     taklit etmek için; yazma/doğrulama yolu hep gerçektir.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const crypto = require('node:crypto');

const kg = require('./kitap-guncelleyici');

/* ------------------------------------------ TEST imza anahtarı (sözleşme G4) */
// Her test koşusunda taze ed25519 çifti — gerçek anahtar ASLA teste girmez.
const { publicKey: TEST_ACIK_K, privateKey: TEST_OZEL } = crypto.generateKeyPairSync('ed25519');
const TEST_ACIK = TEST_ACIK_K.export({ type: 'spki', format: 'der' }).toString('base64');
const imzala = (govde) => crypto.sign(null, Buffer.from(govde), TEST_OZEL).toString('base64');
const govdeYap = (r) => (Buffer.isBuffer(r) ? r : Buffer.from(typeof r === 'string' ? r : JSON.stringify(r)));
/** Rota tablosundaki her `/manifest.json` için `/manifest.json.sig` ucu ekler (imzalı yayın). */
function imzaRotalariEkle(rotalar) {
  const sonuc = Object.assign({}, rotalar);
  for (const yol of Object.keys(rotalar)) {
    const r = manifestVarsayilan(yol, rotalar[yol]);
    if (!yol.endsWith('/manifest.json') || r instanceof Error) continue;
    sonuc[yol] = r;
    if (Object.prototype.hasOwnProperty.call(rotalar, yol + kg.IMZA_UZANTI)) continue;
    sonuc[yol + kg.IMZA_UZANTI] = imzala(govdeYap(r));
  }
  return sonuc;
}
/**
 * Fikstür varsayılanı (kimlik denetimi, 2026-09-26): manifest NESNESİNDE `kanal`/`setKimligi`
 * yoksa G kanalı + yolun set kimliği doldurulur. Reddi sınayan testler alanları AÇIKÇA verir.
 */
function manifestVarsayilan(yol, r) {
  if (!yol.endsWith('/manifest.json') || !r || Buffer.isBuffer(r) || typeof r !== 'object'
    || r instanceof Error || Array.isArray(r)) return r;
  const k = (yol.match(/\/set\/([^/]+)\/manifest\.json$/) || [])[1];
  return Object.assign({ kanal: 'G', setKimligi: k ? decodeURIComponent(k) : '9001' }, r);
}

/* ------------------------------------------------------------- yardımcılar */

const ozet = (v) => kg.sha256(Buffer.from(v));

function gecici(ad) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'empp-' + ad + '-'));
}

/** Gerçek dosya sistemi + çağrı defteri (sıra ve `unlink` kanıtı için). */
function izleyenFs() {
  const g = kg.varsayilanFs();
  const kayit = [];
  return {
    kayit,
    fs: {
      readFile: g.readFile,
      writeFile: (p, v) => { kayit.push({ op: 'writeFile', p }); return g.writeFile(p, v); },
      rename: (a, b) => { kayit.push({ op: 'rename', p: a, hedef: b }); return g.rename(a, b); },
      unlink: (p) => { kayit.push({ op: 'unlink', p }); return g.unlink(p); },
      mkdir: g.mkdir,
      stat: g.stat,
      readdir: g.readdir,
      rm: (p, o) => { kayit.push({ op: 'rm', p }); return g.rm(p, o); },
    },
  };
}

/** Basit paket iskeleti kurar. */
function paketKur(dosyalar) {
  const kok = gecici('paket');
  for (const yol of Object.keys(dosyalar)) {
    const tam = path.join(kok, yol);
    fs.mkdirSync(path.dirname(tam), { recursive: true });
    fs.writeFileSync(tam, dosyalar[yol]);
  }
  return kok;
}

/** Yol listesini yoldan içeriğe çeviren yardımcı. */
function oku(kok, yol) {
  try { return fs.readFileSync(path.join(kok, yol), 'utf8'); } catch (e) { return null; }
}
const varMi = (kok, yol) => fs.existsSync(path.join(kok, yol));

/** Rota tablosundan gerçek HTTP sunucusu; istek sayacı tutar. */
async function sunucuKur(rotalarHam, { askida = false, imzasiz = false } = {}) {
  const rotalar = imzasiz ? rotalarHam : imzaRotalariEkle(rotalarHam);
  const sayac = { toplam: 0, yollar: [] };
  const s = http.createServer((istek, yanit) => {
    const yol = decodeURI(istek.url.split('?')[0]);
    sayac.toplam += 1;
    sayac.yollar.push(yol);
    if (askida) return; // yanıt YOK — zaman aşımı senaryosu
    const r = rotalar[yol];
    if (r == null) { yanit.statusCode = 404; yanit.end('yok'); return; }
    const govde = Buffer.isBuffer(r) ? r : Buffer.from(typeof r === 'string' ? r : JSON.stringify(r));
    yanit.statusCode = 200;
    yanit.setHeader('content-length', String(govde.length));
    yanit.end(govde);
  });
  await new Promise((c) => s.listen(0, '127.0.0.1', c));
  return {
    taban: 'http://127.0.0.1:' + s.address().port,
    sayac,
    kapat: () => new Promise((c) => s.close(c)),
  };
}

/* ------------------------------------------------- asgari ZIP yazıcı (test) */

let CRC_TABLO = null;
function crc32(b) {
  if (!CRC_TABLO) {
    CRC_TABLO = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLO[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC_TABLO[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** @param {{yol:string, veri:string|Buffer, sikistir?:boolean}[]} girdiler */
function zipYap(girdiler) {
  const yerel = []; const merkez = [];
  let ofset = 0;
  for (const g of girdiler) {
    const ad = Buffer.from(g.yol, 'utf8');
    const ham = Buffer.from(g.veri);
    const yontem = g.sikistir ? 8 : 0;
    const govde = g.sikistir ? zlib.deflateRawSync(ham) : ham;
    const crc = crc32(ham);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(yontem, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(govde.length, 18);
    lh.writeUInt32LE(ham.length, 22); lh.writeUInt16LE(ad.length, 26); lh.writeUInt16LE(0, 28);
    yerel.push(lh, ad, govde);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(yontem, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(govde.length, 20); ch.writeUInt32LE(ham.length, 24);
    ch.writeUInt16LE(ad.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(ofset, 42);
    merkez.push(ch, ad);
    ofset += lh.length + ad.length + govde.length;
  }
  const yb = Buffer.concat(yerel); const mb = Buffer.concat(merkez);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(0, 4); e.writeUInt16LE(0, 6);
  e.writeUInt16LE(girdiler.length, 8); e.writeUInt16LE(girdiler.length, 10);
  e.writeUInt32LE(mb.length, 12); e.writeUInt32LE(yb.length, 16); e.writeUInt16LE(0, 20);
  return Buffer.concat([yb, mb, e]);
}

const SET = (uzer = {}) => Object.assign({
  setKimligi: '9001', taban: '', damga: '', kabukDosyalari: [], kitapDizinleri: [],
  imza: { alg: 'ed25519', acikAnahtar: TEST_ACIK },
}, uzer);

/* ============================================ 1) UÇTAN UCA — GERÇEK HTTP + FS */

test('E2E: yalnız index.html değişti → SADECE o iner, atomik yerine konur, damga yazılır',
  async () => {
    const yeni = '<html>YENI KABUK</html>';
    const sabit = 'body{}';
    const kok = paketKur({
      'index.html': '<html>ESKI</html>',
      'assets2/stil.css': sabit,
      'book1/veri.txt': 'kitap icerigi',
    });
    const s = await sunucuKur({
      '/set/9001/surum.json': { surum: '2.1.10', uretim: '2026-09-21T00:00:00Z' },
      '/set/9001/manifest.json': {
        surum: '2.1.10',
        kabuk: [
          { yol: 'index.html', sha256: ozet(yeni), boyut: Buffer.byteLength(yeni) },
          { yol: 'assets2/stil.css', sha256: ozet(sabit), boyut: Buffer.byteLength(sabit) },
        ],
        kitaplar: [],
      },
      '/set/9001/dosya/index.html': yeni,
      '/set/9001/dosya/assets2/stil.css': sabit,
    });
    try {
      const r = await kg.guncellemeyiCalistir({ taban: s.taban, set: SET(), kok, zamanAsimi: 4000 });
      assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
      assert.strictEqual(r.kabukIndirilen, 1, 'yalnız 1 dosya inmeliydi');
      assert.strictEqual(oku(kok, 'index.html'), yeni);
      assert.strictEqual(oku(kok, 'assets2/stil.css'), sabit, 'değişmeyen dosya korunmalı');
      assert.strictEqual(oku(kok, 'book1/veri.txt'), 'kitap icerigi', 'kitap içeriğine DOKUNULMAZ');
      assert.ok(!s.sayac.yollar.includes('/set/9001/dosya/assets2/stil.css'),
        'sha256 aynı olan dosya indirilmemeliydi');
      assert.ok(varMi(kok, kg.DAMGA_ADI), 'damga yazılmalı');
      assert.ok(!fs.readdirSync(kok).some((a) => a.endsWith(kg.GECICI_UZANTI)),
        'geçici .indirme artığı kalmamalı');
    } finally { await s.kapat(); }
  });

test('E2E: kitap EKLEME uçtan uca — gerçek arşiv iner, açılır, yerine konur',
  async () => {
    const arsiv = zipYap([
      { yol: 'index.html', veri: '<html>book7</html>' },
      { yol: 'assets/sayfa/1.txt', veri: 'sayfa bir', sikistir: true },
    ]);
    const kabuk = '<html>MENU: book7 var</html>';
    const kok = paketKur({ 'index.html': '<html>MENU: bos</html>' });
    const s = await sunucuKur({
      '/set/9001/surum.json': { surum: '2.1.11' },
      '/set/9001/manifest.json': {
        surum: '2.1.11',
        kabuk: [{ yol: 'index.html', sha256: ozet(kabuk), boyut: Buffer.byteLength(kabuk) }],
        kitaplar: [{
          dizin: 'book7', durum: 'ekle', kaynak: 'ARSIV',
          sha256: kg.sha256(arsiv), boyut: arsiv.length,
        }],
      },
      '/set/9001/dosya/index.html': kabuk,
      '/arsiv/book7.zip': arsiv,
    });
    const izle = izleyenFs();
    try {
      // `kaynak` gerçek sunucuya işaret etmeli — port ancak çalışma anında belli
      // olur, bu yüzden manifest yanıtı geçerken tek alan yeniden yazılır.
      // Gövdenin geri kalanı (surum/manifest/dosya/arşiv) GERÇEK HTTP'den gelir.
      const rotalar = s.taban;
      const r = await kg.guncellemeyiCalistir({
        taban: rotalar,
        set: SET(),
        kok,
        fs: izle.fs,
        zamanAsimi: 5000,
        getir: async (adres, o) => {
          if (adres.endsWith('/manifest.json') || adres.endsWith('/manifest.json' + kg.IMZA_UZANTI)) {
            // Gövde değiştiği için YAYINCI yeniden imzalar (gerçek hayatta da imza en son atılır).
            const y = await kg.varsayilanGetir(adres.replace(/\.sig$/, ''), o);
            const n = JSON.parse(y.govde.toString('utf8'));
            n.kitaplar[0].kaynak = rotalar + '/arsiv/book7.zip';
            const govde = Buffer.from(JSON.stringify(n));
            return { durum: 200, govde: adres.endsWith(kg.IMZA_UZANTI) ? Buffer.from(imzala(govde)) : govde };
          }
          return kg.varsayilanGetir(adres, o);
        },
      });
      assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
      assert.deepStrictEqual(r.eklenen, ['book7']);
      assert.strictEqual(oku(kok, 'book7/index.html'), '<html>book7</html>');
      assert.strictEqual(oku(kok, 'book7/assets/sayfa/1.txt'), 'sayfa bir', 'deflate girdisi açılmalı');
      assert.strictEqual(oku(kok, 'index.html'), kabuk);
      assert.ok(!varMi(kok, kg.GECICI_DIZIN), 'geçici dizin temizlenmeli');

      // SIRA KANITI: kitap yerine konurken yapılan rename, kabuk rename'inden ÖNCE.
      const kitapIdx = izle.kayit.findIndex((k) => k.op === 'rename' && String(k.hedef).endsWith('book7'));
      const kabukIdx = izle.kayit.findIndex((k) => k.op === 'rename' && String(k.hedef).endsWith('index.html'));
      assert.ok(kitapIdx !== -1 && kabukIdx !== -1, 'her iki rename de olmalı');
      assert.ok(kitapIdx < kabukIdx, 'SIRA İHLALİ: kabuk kitap verisinden önce yazıldı');
      assert.ok(r.sira.findIndex((x) => x.tur === 'kitap-ekle')
        < r.sira.findIndex((x) => x.tur === 'kabuk'), 'rapor sırası da kitap-önce olmalı');
    } finally { await s.kapat(); }
  });

test('E2E: sürüm değişmedi → manifest HİÇ indirilmez (gerçek sunucu istek sayacı)',
  async () => {
    const kok = paketKur({ 'index.html': 'x' });
    fs.writeFileSync(path.join(kok, kg.DAMGA_ADI), JSON.stringify({ surum: '2.1.12' }));
    const s = await sunucuKur({
      '/set/9001/surum.json': { surum: '2.1.12' },
      '/set/9001/manifest.json': { surum: '2.1.12', kabuk: [], kitaplar: [] },
    });
    try {
      const r = await kg.guncellemeyiCalistir({ taban: s.taban, set: SET(), kok, zamanAsimi: 4000 });
      assert.strictEqual(r.durum, 'guncel');
      assert.strictEqual(r.istek, 1, 'tek istek (surum.json) olmalıydı');
      assert.deepStrictEqual(s.sayac.yollar, ['/set/9001/surum.json']);
    } finally { await s.kapat(); }
  });

test('E2E: 404 → sessiz atlama, istisna sızmaz, paket olduğu gibi kalır', async () => {
  const kok = paketKur({ 'index.html': 'DOKUNULMADI' });
  const s = await sunucuKur({}); // her yol 404
  try {
    const r = await kg.guncellemeyiCalistir({ taban: s.taban, set: SET(), kok, zamanAsimi: 4000 });
    assert.strictEqual(r.durum, 'atlandi');
    assert.match(r.sebep, /^surum-alinamadi:durum-404/);
    assert.strictEqual(oku(kok, 'index.html'), 'DOKUNULMADI');
    assert.ok(!varMi(kok, kg.DAMGA_ADI), 'başarısız turda damga yazılmamalı');
  } finally { await s.kapat(); }
});

test('E2E: zaman aşımı — sunucu yanıt vermiyor → güncelleme atlanır, uygulama sürer',
  async () => {
    const kok = paketKur({ 'index.html': 'DOKUNULMADI' });
    const s = await sunucuKur({}, { askida: true });
    try {
      const basla = Date.now();
      const r = await kg.guncellemeyiCalistir({ taban: s.taban, set: SET(), kok, zamanAsimi: 400 });
      assert.strictEqual(r.durum, 'atlandi');
      assert.match(r.sebep, /^surum-alinamadi:/);
      assert.ok(Date.now() - basla < 8000, 'zaman aşımı gerçekten kesmeli');
      assert.strictEqual(oku(kok, 'index.html'), 'DOKUNULMADI');
    } finally { await s.kapat(); }
  });

/* ================================================== 2) SERT KURALLAR (dal testleri) */

/** Uzak ucu taklit eden getir üreteci — fs hep gerçek. */
function getirKur(haritaHam, { imzasiz = false } = {}) {
  const harita = imzasiz ? haritaHam : imzaRotalariEkle(haritaHam);
  const sayac = { yollar: [] };
  const getir = async (adres) => {
    const yol = adres.replace(/^https?:\/\/[^/]+/, '');
    sayac.yollar.push(yol);
    const r = harita[yol];
    if (r === undefined) return { durum: 404, govde: Buffer.alloc(0) };
    if (r instanceof Error) throw r;
    return {
      durum: 200,
      govde: Buffer.isBuffer(r) ? r : Buffer.from(typeof r === 'string' ? r : JSON.stringify(r)),
    };
  };
  return { getir, sayac };
}

test('sha256 uyuşmazlığı → hedef dosya BOZULMAZ, geçici dosya atılır', async () => {
  const kok = paketKur({ 'index.html': 'ORIJINAL' });
  const { getir } = getirKur({
    '/set/9001/surum.json': { surum: '2.1.13' },
    '/set/9001/manifest.json': {
      surum: '2.1.13',
      kabuk: [{ yol: 'index.html', sha256: 'f'.repeat(64), boyut: 5 }],
      kitaplar: [],
    },
    '/set/9001/dosya/index.html': 'SAHTE',
  });
  const r = await kg.guncellemeyiCalistir({ taban: 'https://uc', set: SET(), kok, getir });
  assert.strictEqual(r.durum, 'kismi');
  assert.strictEqual(oku(kok, 'index.html'), 'ORIJINAL', 'HEDEFE DOKUNULMAMALIYDI');
  assert.ok(!varMi(kok, 'index.html' + kg.GECICI_UZANTI), 'geçici dosya atılmalı');
  // Ya hep ya hiç (2026-09-26): gövde doğrulanmadan hiçbir yere YAZILMAZ; hazırlık alanı atılır.
  assert.ok(!varMi(kok, kg.GECICI_DIZIN), 'hazırlık alanı atılmalı');
  assert.strictEqual(r.sebep, 'kabuk-sha256-uyusmaz');
  assert.ok(!varMi(kok, kg.DAMGA_ADI), 'damga yazılmamalı — sonraki açılışta yeniden denenir');
});

test('boyut manifest ile uyuşmuyor → dosya atlanır, hedef korunur', async () => {
  const yeni = 'YENI';
  const kok = paketKur({ 'index.html': 'ORIJINAL' });
  const { getir } = getirKur({
    '/set/9001/surum.json': { surum: '2.1.14' },
    '/set/9001/manifest.json': {
      surum: '2.1.14',
      kabuk: [{ yol: 'index.html', sha256: ozet(yeni), boyut: 9999 }],
      kitaplar: [],
    },
    '/set/9001/dosya/index.html': yeni,
  });
  const r = await kg.guncellemeyiCalistir({ taban: 'https://uc', set: SET(), kok, getir });
  assert.strictEqual(r.kabukAtlanan, 1);
  assert.strictEqual(oku(kok, 'index.html'), 'ORIJINAL');
});

test('yol kaçışı: `../` içeren kabuk yolu REDDEDİLİR, indirme isteği bile yapılmaz',
  async () => {
    const kok = paketKur({ 'index.html': 'x' });
    const disari = path.join(path.dirname(kok), 'kacak.txt');
    const { getir, sayac } = getirKur({
      '/set/9001/surum.json': { surum: '2.1.1' },
      '/set/9001/manifest.json': {
        surum: '2.1.1',
        kabuk: [{ yol: '../kacak.txt', sha256: ozet('kotu'), boyut: 4 }],
        kitaplar: [],
      },
    });
    const r = await kg.guncellemeyiCalistir({ taban: 'https://uc', set: SET(), kok, getir });
    assert.strictEqual(r.kabukAtlanan, 1);
    assert.strictEqual(r.durum, 'kismi');
    assert.ok(!fs.existsSync(disari), 'kök DIŞINA dosya yazılmamalı');
    assert.ok(!sayac.yollar.some((y) => y.includes('kacak')), 'kaçak yol için istek yapılmamalı');
  });

test('yol kaçışı: mutlak yol ve Windows sürücüsü REDDEDİLİR', () => {
  assert.strictEqual(kg.yolGuvenliMi('/etc/passwd'), false);
  assert.strictEqual(kg.yolGuvenliMi('C:/Windows/system32/x.dll'), false);
  assert.strictEqual(kg.yolGuvenliMi('a/../../b'), false);
  assert.strictEqual(kg.yolGuvenliMi('a/./b'), false);
  assert.strictEqual(kg.yolGuvenliMi('..\\..\\kacak'), false);
  assert.strictEqual(kg.yolGuvenliMi(''), false);
  assert.strictEqual(kg.yolGuvenliMi('assets2/js/app.js'), true);
  assert.strictEqual(kg.hedefYoluCoz('/paket', '../disari'), null);
  assert.ok(String(kg.hedefYoluCoz('/paket', 'assets2/a.js')).endsWith('/paket/assets2/a.js'));
});

test('bozuk JSON → sessiz atlama, istisna sızmaz', async () => {
  const kok = paketKur({ 'index.html': 'x' });
  const { getir } = getirKur({ '/set/9001/surum.json': Buffer.from('{bu json degil') });
  const r = await kg.guncellemeyiCalistir({ taban: 'https://uc', set: SET(), kok, getir });
  assert.strictEqual(r.durum, 'atlandi');
  assert.match(r.sebep, /^surum-alinamadi:/);
});

test('ağ hatası (fırlatan getir) → sessiz atlama', async () => {
  const kok = paketKur({ 'index.html': 'x' });
  const { getir } = getirKur({ '/set/9001/surum.json': new Error('ECONNREFUSED') });
  const r = await kg.guncellemeyiCalistir({ taban: 'https://uc', set: SET(), kok, getir });
  assert.strictEqual(r.durum, 'atlandi');
  assert.match(r.sebep, /ECONNREFUSED/);
});

test('setKimligi null → kanal HİÇ çalışmaz, tek istek bile yapılmaz + GÜNLÜĞE yazılır',
  async () => {
    const kok = paketKur({ 'index.html': 'x' });
    const { getir, sayac } = getirKur({ '/set/9001/surum.json': { surum: '2.1.35' } });
    const satirlar = [];
    const r = await kg.guncellemeyiCalistir({
      taban: 'https://uc',
      set: SET({ setKimligi: null, sebep: 'paketleme isteğinde setKimligi yok' }),
      kok, getir, gunluk: (m) => satirlar.push(m),
    });
    assert.strictEqual(r.durum, 'kapali');
    assert.strictEqual(r.sebep, 'set-kimligi-yok');
    assert.strictEqual(r.istek, 0);
    assert.strictEqual(sayac.yollar.length, 0);
    assert.ok(satirlar.some((m) => /set kimliği yok/.test(m)), 'sessiz atlama YASAK — günlük şart');
    assert.ok(satirlar.some((m) => /setKimligi yok/.test(m)), 'sebep günlüğe taşınmalı');
  });

test('silme KAPALI (varsayılan): manifestte olmayan kabuk artığı için unlink ÇAĞRILMAZ',
  async () => {
    const yeni = 'YENI';
    const kok = paketKur({
      'index.html': 'ESKI',
      'assets2/eski.js': 'artik',
    });
    const { getir } = getirKur({
      '/set/9001/surum.json': { surum: '2.1.2' },
      '/set/9001/manifest.json': {
        surum: '2.1.2',
        kabuk: [{ yol: 'assets2/yeni.js', sha256: ozet(yeni), boyut: Buffer.byteLength(yeni) }],
        kitaplar: [],
      },
      '/set/9001/dosya/assets2/yeni.js': yeni,
    });
    const izle = izleyenFs();
    const r = await kg.guncellemeyiCalistir({
      taban: 'https://uc', set: SET(), kok, getir, fs: izle.fs,
    });
    assert.strictEqual(r.durum, 'guncellendi');
    assert.strictEqual(r.kabukSilinen, 0);
    assert.strictEqual(oku(kok, 'assets2/eski.js'), 'artik', 'artık KORUNMALI');
    assert.strictEqual(izle.kayit.filter((k) => k.op === 'unlink').length, 0,
      'silme kapalıyken HİÇ unlink çağrılmamalı');
  });

test('silme AÇIK: yalnız kabuk artığı silinir, kitap dizinlerine DOKUNULMAZ', async () => {
  const yeni = 'YENI';
  const kok = paketKur({
    'assets2/yeni.js': 'ESKI',
    'assets2/eski.js': 'artik',
    'book1/veri.txt': 'kitap',
  });
  const { getir } = getirKur({
    '/set/9001/surum.json': { surum: '2.1.3' },
    '/set/9001/manifest.json': {
      surum: '2.1.3',
      kabuk: [{ yol: 'assets2/yeni.js', sha256: ozet(yeni), boyut: Buffer.byteLength(yeni) }],
      kitaplar: [],
    },
    '/set/9001/dosya/assets2/yeni.js': yeni,
  });
  const r = await kg.guncellemeyiCalistir({
    taban: 'https://uc', set: SET({ kitapDizinleri: ['book1'] }), kok, getir, silmeAcik: true,
  });
  assert.strictEqual(r.durum, 'guncellendi');
  assert.strictEqual(r.kabukSilinen, 1);
  assert.ok(!varMi(kok, 'assets2/eski.js'), 'kabuk artığı silinmeliydi');
  assert.strictEqual(oku(kok, 'book1/veri.txt'), 'kitap', 'kitap dizini bu kapıya TABİ DEĞİL');
});

test('kitap ÇIKARMA: dizin gider, HAYALET madde (.empp-silinecek) kalmaz', async () => {
  const kabuk = '<html>MENU: book2 yok</html>';
  const kok = paketKur({
    'index.html': '<html>MENU: book2 var</html>',
    'book2/veri.txt': 'silinecek kitap',
  });
  const { getir } = getirKur({
    '/set/9001/surum.json': { surum: '2.1.4' },
    '/set/9001/manifest.json': {
      surum: '2.1.4',
      kabuk: [{ yol: 'index.html', sha256: ozet(kabuk), boyut: Buffer.byteLength(kabuk) }],
      kitaplar: [{ dizin: 'book2', durum: 'cikar' }],
    },
    '/set/9001/dosya/index.html': kabuk,
  });
  const r = await kg.guncellemeyiCalistir({ taban: 'https://uc', set: SET(), kok, getir });
  assert.strictEqual(r.durum, 'guncellendi');
  assert.deepStrictEqual(r.cikarilan, ['book2']);
  assert.ok(!varMi(kok, 'book2'), 'kitap dizini kaldırılmalı');
  assert.ok(!fs.readdirSync(kok).some((a) => a.endsWith(kg.SILINECEK_UZANTI)),
    'hayalet .empp-silinecek artığı kalmamalı');
  assert.strictEqual(oku(kok, 'index.html'), kabuk);
});

test('EKLEME yarıda kesildi (sha uyuşmadı) → menü BOZULMAZ: kabuk eski kalır, kitap yok',
  async () => {
    const arsiv = zipYap([{ yol: 'index.html', veri: 'yeni kitap' }]);
    const kabuk = '<html>MENU: book7 var</html>';
    const kok = paketKur({ 'index.html': '<html>MENU: bos</html>' });
    const { getir } = getirKur({
      '/set/9001/surum.json': { surum: '2.1.5' },
      '/set/9001/manifest.json': {
        surum: '2.1.5',
        kabuk: [{ yol: 'index.html', sha256: ozet(kabuk), boyut: Buffer.byteLength(kabuk) }],
        kitaplar: [{
          dizin: 'book7', durum: 'ekle', kaynak: 'https://uc/arsiv.zip',
          sha256: 'a'.repeat(64), boyut: arsiv.length,
        }],
      },
      '/set/9001/dosya/index.html': kabuk,
    });
    const r = await kg.guncellemeyiCalistir({
      taban: 'https://uc', set: SET(), kok, getir,
      // Arşiv "iner" ama özeti manifestle tutmaz — yarıda kesilmiş indirme.
      arsiviIndir: async (adres, hedef) => {
        await fsp.writeFile(hedef, arsiv.slice(0, 40));
        return { durum: 200, boyut: arsiv.length, ozet: 'b'.repeat(64) };
      },
    });
    assert.strictEqual(r.durum, 'kismi');
    assert.strictEqual(r.sebep, 'kitap-hazirlanamadi');
    assert.ok(!varMi(kok, 'book7'), 'yarım kitap menüye GİRMEMELİ');
    assert.strictEqual(oku(kok, 'index.html'), '<html>MENU: bos</html>',
      'üyelik eksikken KABUK GÜNCELLENMEMELİ — yoksa menü olmayan kitabı gösterir');
    assert.ok(!varMi(kok, kg.GECICI_DIZIN), 'kısmi indirme artığı bırakılmamalı');
    assert.ok(!varMi(kok, kg.DAMGA_ADI), 'damga yazılmamalı — sonraki açılışta baştan');
  });

test('SIRA KURALI: çıkarma + kabuk — kitap hamlesi kabuk yazımından ÖNCE olur', async () => {
  const kabuk = 'YENI MENU';
  const kok = paketKur({ 'index.html': 'ESKI MENU', 'book3/a.txt': 'x' });
  const { getir } = getirKur({
    '/set/9001/surum.json': { surum: '2.1.6' },
    '/set/9001/manifest.json': {
      surum: '2.1.6',
      kabuk: [{ yol: 'index.html', sha256: ozet(kabuk), boyut: Buffer.byteLength(kabuk) }],
      kitaplar: [{ dizin: 'book3', durum: 'cikar' }],
    },
    '/set/9001/dosya/index.html': kabuk,
  });
  const izle = izleyenFs();
  const r = await kg.guncellemeyiCalistir({
    taban: 'https://uc', set: SET(), kok, getir, fs: izle.fs,
  });
  assert.strictEqual(r.durum, 'guncellendi');
  // Çıkarma: kitap dizini hazırlık alanının yedeğine TAŞINIR (atomik rename; kesinleşince atılır).
  const kitapIdx = izle.kayit.findIndex(
    (k) => k.op === 'rename' && k.p === path.join(kok, 'book3')
      && String(k.hedef).startsWith(path.join(kok, kg.GECICI_DIZIN)));
  const kabukIdx = izle.kayit.findIndex(
    (k) => k.op === 'rename' && k.hedef === path.join(kok, 'index.html'));
  assert.ok(kitapIdx !== -1, 'çıkarma önce kitabı yedeğe taşımalı (atomik)');
  assert.ok(!varMi(kok, 'book3') && !varMi(kok, kg.GECICI_DIZIN), 'kitap gitmeli, artık kalmamalı');
  assert.ok(kabukIdx !== -1);
  assert.ok(kitapIdx < kabukIdx, 'SIRA İHLALİ: kabuk kitap hamlesinden önce yazıldı');
  assert.deepStrictEqual(r.sira.map((x) => x.tur), ['kitap-cikar', 'kabuk']);
});

test('kabuk yarım kalırsa üyelik GERİ ALINIR — hayalet menü oluşmaz', async () => {
  const kok = paketKur({ 'index.html': 'ESKI MENU', 'book4/a.txt': 'x' });
  const { getir } = getirKur({
    '/set/9001/surum.json': { surum: '2.1.7' },
    '/set/9001/manifest.json': {
      surum: '2.1.7',
      kabuk: [{ yol: 'index.html', sha256: ozet('YENI'), boyut: 4 }],
      kitaplar: [{ dizin: 'book4', durum: 'cikar' }],
    },
    // dosya ucu 404 → kabuk yazılamaz
  });
  const r = await kg.guncellemeyiCalistir({ taban: 'https://uc', set: SET(), kok, getir });
  assert.strictEqual(r.durum, 'kismi');
  assert.strictEqual(oku(kok, 'book4/a.txt'), 'x', 'kabuk yazılamadıysa çıkarma geri alınmalı');
  assert.ok(!fs.readdirSync(kok).some((a) => a.endsWith(kg.SILINECEK_UZANTI)));
  assert.strictEqual(oku(kok, 'index.html'), 'ESKI MENU');
});

test('arşiv içi yol kaçışı (zip-slip) → kitap eklenmez, kök dışına yazılmaz', async () => {
  const arsiv = zipYap([{ yol: '../../kacak.txt', veri: 'kotu' }]);
  const kok = paketKur({ 'index.html': 'MENU' });
  const disari = path.join(path.dirname(kok), 'kacak.txt');
  const { getir } = getirKur({
    '/set/9001/surum.json': { surum: '2.1.8' },
    '/set/9001/manifest.json': {
      surum: '2.1.8',
      kabuk: [],
      kitaplar: [{
        dizin: 'book9', durum: 'ekle', kaynak: 'https://uc/a.zip',
        sha256: kg.sha256(arsiv), boyut: arsiv.length,
      }],
    },
  });
  const r = await kg.guncellemeyiCalistir({
    taban: 'https://uc', set: SET(), kok, getir,
    arsiviIndir: async (adres, hedef) => {
      await fsp.writeFile(hedef, arsiv);
      return { durum: 200, boyut: arsiv.length, ozet: kg.sha256(arsiv) };
    },
  });
  assert.strictEqual(r.uyelikBasarisiz, 1);
  assert.ok(!varMi(kok, 'book9'));
  assert.ok(!fs.existsSync(disari), 'arşiv kök dışına yazamamalı');
});

test('önceki çöken koşudan kalan `.empp-silinecek` artığı GERİ ALINIR', async () => {
  const kok = paketKur({ ['book5' + kg.SILINECEK_UZANTI + '/a.txt']: 'kurtarilacak' });
  const satirlar = [];
  const sayi = await kg.artiklariTopla(kg.varsayilanFs(), kok, (m) => satirlar.push(m));
  assert.strictEqual(sayi, 1);
  assert.strictEqual(oku(kok, 'book5/a.txt'), 'kurtarilacak', 'asıl ad boşsa geri alınmalı');
  assert.ok(satirlar.some((m) => /geri alındı/.test(m)));
});

test('artık + canlı dizin birlikteyse artık ATILIR (çift kayıt olmaz)', async () => {
  const kok = paketKur({
    'book5/a.txt': 'canli',
    ['book5' + kg.SILINECEK_UZANTI + '/a.txt']: 'eski',
  });
  await kg.artiklariTopla(kg.varsayilanFs(), kok, () => {});
  assert.strictEqual(oku(kok, 'book5/a.txt'), 'canli');
  assert.ok(!varMi(kok, 'book5' + kg.SILINECEK_UZANTI));
});

test('varsayılan RET: bozuk manifest / bozuk girdi / bilinmeyen üyelik durumu', async () => {
  assert.strictEqual(kg.manifestiDogrula({ surum: 'a', kabuk: 'dizi-degil' }), null);
  assert.strictEqual(kg.manifestiDogrula({ kabuk: [] }), null);
  assert.strictEqual(kg.kabukGirdisiGecerliMi({ yol: 'a', sha256: 'kisa', boyut: 1 }), false);
  assert.strictEqual(kg.kabukGirdisiGecerliMi({ yol: 'a', sha256: 'a'.repeat(64) }), false);
  assert.strictEqual(kg.uyelikGirdisiGecerliMi({ dizin: 'b', durum: 'bilinmeyen' }), false);
  assert.strictEqual(kg.uyelikGirdisiGecerliMi({ dizin: 'b', durum: 'ekle', kaynak: 'ftp://x', sha256: 'a'.repeat(64), boyut: 1 }), false);
  assert.strictEqual(kg.uyelikGirdisiGecerliMi({ dizin: 'b', durum: 'cikar' }), true);

  const kok = paketKur({ 'index.html': 'ORIJINAL' });
  const { getir } = getirKur({
    '/set/9001/surum.json': { surum: '2.1.9' },
    '/set/9001/manifest.json': { surum: '2.1.9', kitaplar: [] }, // kabuk YOK
  });
  const r = await kg.guncellemeyiCalistir({ taban: 'https://uc', set: SET(), kok, getir });
  assert.strictEqual(r.durum, 'atlandi');
  assert.match(r.sebep, /manifest-alinamadi/);
  assert.strictEqual(oku(kok, 'index.html'), 'ORIJINAL');
});

test('asgari ZIP çözücü: store + deflate girdileri doğru açar, dizin girdisi atlanır', () => {
  const z = zipYap([
    { yol: 'a.txt', veri: 'duz' },
    { yol: 'alt/b.txt', veri: 'sikisik icerik '.repeat(20), sikistir: true },
  ]);
  const girdiler = kg.arsivCozVarsayilan(z);
  assert.strictEqual(girdiler.length, 2);
  assert.strictEqual(girdiler[0].veri.toString('utf8'), 'duz');
  assert.strictEqual(girdiler[1].yol, 'alt/b.txt');
  assert.strictEqual(girdiler[1].veri.toString('utf8'), 'sikisik icerik '.repeat(20));
  assert.throws(() => kg.arsivCozVarsayilan(Buffer.from('zip degil')), /zip-eocd-yok/);
});

test('istisna sızmaz: fs tamamen patlasa bile rapor döner, throw olmaz', async () => {
  const patlak = new Proxy({}, { get: () => () => { throw new Error('disk oldu'); } });
  const r = await kg.guncellemeyiCalistir({
    taban: 'https://uc', set: SET(), kok: '/olmayan', fs: patlak,
    getir: async () => ({ durum: 200, govde: Buffer.from(JSON.stringify({ surum: '2.1.10' })) }),
  });
  assert.ok(r && typeof r === 'object');
  assert.ok(['atlandi', 'kismi'].includes(r.durum));
});

test('kapılar: acikMi / silmeAcikMi / zamanAsimiCoz / tabaniCoz', () => {
  assert.strictEqual(kg.acikMi({}), true, 'varsayılan AÇIK');
  assert.strictEqual(kg.acikMi({ EMPP_SET_GUNCELLEME: '0' }), false);
  assert.strictEqual(kg.silmeAcikMi({}), false, 'varsayılan KAPALI');
  assert.strictEqual(kg.silmeAcikMi({ EMPP_GUNCELLEME_SILME: '1' }), true);
  assert.strictEqual(kg.zamanAsimiCoz({}), 15000);
  assert.strictEqual(kg.zamanAsimiCoz({ EMPP_GUNCELLEME_ZAMAN_ASIMI: '2500' }), 2500);
  assert.strictEqual(kg.zamanAsimiCoz({ EMPP_GUNCELLEME_ZAMAN_ASIMI: 'abc' }), 15000);
  assert.strictEqual(kg.tabaniCoz({}, 'https://gomulu/'), 'https://gomulu');
  assert.strictEqual(kg.tabaniCoz({ EMPP_GUNCELLEME_TABANI: 'https://ezen' }, 'https://gomulu'),
    'https://ezen');
});

test('guncellemeyiBaslat: kapı kapalıyken hiç koşmaz; set dosyası yoksa sessiz atlar',
  async () => {
    const kok = paketKur({ 'index.html': 'x' });
    const satirlar = [];
    const kapali = await kg.guncellemeyiBaslat({
      kok, env: { EMPP_SET_GUNCELLEME: '0' }, gunluk: (m) => satirlar.push(m),
    });
    assert.strictEqual(kapali.sebep, 'kapali');
    assert.ok(satirlar.some((m) => /kapalı/.test(m)));

    const yok = await kg.guncellemeyiBaslat({ kok, env: {}, gunluk: () => {} });
    assert.strictEqual(yok.sebep, 'set-dosyasi-yok');
  });

test('guncellemeyiBaslat: empp-set.json okunur, env tabanı gömülüyü EZER', async () => {
  const kok = paketKur({ 'index.html': 'ESKI' });
  fs.writeFileSync(path.join(kok, kg.VARSAYILAN_SET_ADI), JSON.stringify({
    setKimligi: '9001', taban: 'https://gomulu', kitapDizinleri: [],
    imza: { alg: 'ed25519', acikAnahtar: TEST_ACIK },
  }));
  const yeni = 'YENI';
  const s = await sunucuKur({
    '/set/9001/surum.json': { surum: '2.1.40' },
    '/set/9001/manifest.json': {
      surum: '2.1.40',
      kabuk: [{ yol: 'index.html', sha256: ozet(yeni), boyut: Buffer.byteLength(yeni) }],
      kitaplar: [],
    },
    '/set/9001/dosya/index.html': yeni,
  });
  try {
    const r = await kg.guncellemeyiBaslat({
      kok,
      env: { EMPP_GUNCELLEME_TABANI: s.taban, EMPP_GUNCELLEME_ZAMAN_ASIMI: '4000' },
      gunluk: () => {},
    });
    assert.strictEqual(r.durum, 'guncellendi', JSON.stringify(r));
    assert.strictEqual(oku(kok, 'index.html'), yeni);
  } finally { await s.kapat(); }
});

test('setiNormalize: kimliksiz set GÖRÜNÜR kalır, alanlar güvenli türe indirgenir', () => {
  const n = kg.setiNormalize({ setKimligi: null, sebep: 'kimlik yok', kabukDosyalari: 'yanlis' });
  assert.strictEqual(n.setKimligi, null);
  assert.strictEqual(n.sebep, 'kimlik yok');
  assert.deepStrictEqual(n.kabukDosyalari, []);
  assert.strictEqual(kg.setiNormalize({ setKimligi: 45516 }).setKimligi, '45516');
  assert.strictEqual(kg.setiNormalize(null).setKimligi, null);
});

/* ======================================== 3) İMZA + HTTPS (sözleşme G4, 2026-09-26) */

function g4Harita(uzer = {}) {
  const yeni = 'YENI-G4';
  return Object.assign({
    '/set/9001/surum.json': { surum: '2.1.14' },
    '/set/9001/manifest.json': {
      surum: '2.1.14',
      kabuk: [{ yol: 'index.html', sha256: ozet(yeni), boyut: Buffer.byteLength(yeni) }],
      kitaplar: [],
    },
    '/set/9001/dosya/index.html': yeni,
  }, uzer);
}

test('G4: imzasız manifest (.sig ucu yok) REDDEDİLİR — kabuğa dokunulmaz, damga yazılmaz', async () => {
  const kok = paketKur({ 'index.html': 'ESKI' });
  const { getir, sayac } = getirKur(g4Harita(), { imzasiz: true });
  const r = await kg.guncellemeyiCalistir({ taban: 'https://uc', set: SET(), kok, getir });
  assert.strictEqual(r.durum, 'atlandi');
  assert.match(r.sebep, /manifest-imzasiz/);
  assert.strictEqual(oku(kok, 'index.html'), 'ESKI');
  assert.ok(!sayac.yollar.some((y) => y.includes('/dosya/')), 'imzasız manifestten dosya indirildi');
  assert.ok(!varMi(kok, kg.DAMGA_ADI));
});

test('G4: BAŞKA anahtarla imzalanmış manifest reddedilir', async () => {
  const kok = paketKur({ 'index.html': 'ESKI' });
  const { privateKey: yabanci } = crypto.generateKeyPairSync('ed25519');
  const h = g4Harita();
  h['/set/9001/manifest.json.sig'] = crypto.sign(null, govdeYap(h['/set/9001/manifest.json']), yabanci).toString('base64');
  const { getir } = getirKur(h, { imzasiz: true });
  const r = await kg.guncellemeyiCalistir({ taban: 'https://uc', set: SET(), kok, getir });
  assert.match(r.sebep, /manifest-imzasi-gecersiz/);
  assert.strictEqual(oku(kok, 'index.html'), 'ESKI');
});

test('G4: imzadan SONRA değiştirilmiş manifest gövdesi reddedilir (tek bayt)', async () => {
  const kok = paketKur({ 'index.html': 'ESKI' });
  const h = g4Harita();
  const asil = govdeYap(h['/set/9001/manifest.json']);
  h['/set/9001/manifest.json.sig'] = imzala(asil);
  const bozuk = Buffer.from(asil); bozuk[bozuk.length - 2] ^= 1;
  h['/set/9001/manifest.json'] = bozuk;
  const { getir } = getirKur(h, { imzasiz: true });
  const r = await kg.guncellemeyiCalistir({ taban: 'https://uc', set: SET(), kok, getir });
  assert.match(r.sebep, /manifest-imzasi-gecersiz/);
  assert.strictEqual(oku(kok, 'index.html'), 'ESKI');
});

test('G4: pakette imza anahtarı yoksa kanal KAPALI — tek istek bile yapılmaz, günlüğe yazılır', async () => {
  const kok = paketKur({ 'index.html': 'ESKI' });
  const { getir, sayac } = getirKur(g4Harita());
  const satirlar = [];
  for (const imza of [undefined, { alg: 'rsa', acikAnahtar: TEST_ACIK }, { alg: 'ed25519', acikAnahtar: 'Ym96dWs=' }]) {
    const r = await kg.guncellemeyiCalistir({
      taban: 'https://uc', set: SET({ imza }), kok, getir, gunluk: (m) => satirlar.push(m),
    });
    assert.strictEqual(r.durum, 'kapali');
    assert.strictEqual(r.sebep, 'imza-anahtari-yok');
  }
  assert.strictEqual(sayac.yollar.length, 0, 'anahtarsız pakette ağ isteği yapıldı');
  assert.ok(satirlar.some((m) => /imza anahtarı yok/.test(m)));
});

test('G4: https olmayan taban reddedilir (yerel sınama ucu hariç), istek yapılmaz', async () => {
  const kok = paketKur({ 'index.html': 'ESKI' });
  const { getir, sayac } = getirKur(g4Harita());
  for (const taban of ['http://panel.ornek.com/set-guncelleme', 'ftp://uc', 'file:///C:/x']) {
    const r = await kg.guncellemeyiCalistir({ taban, set: SET(), kok, getir });
    assert.strictEqual(r.sebep, 'taban-https-degil', taban);
  }
  assert.strictEqual(sayac.yollar.length, 0);
  assert.strictEqual(kg.adresGuvenliMi('https://cdn.ornek.com/x'), true);
  assert.strictEqual(kg.adresGuvenliMi('http://127.0.0.1:8080/x'), true);
  assert.strictEqual(kg.adresGuvenliMi('http://localhost/x'), true);
  assert.strictEqual(kg.adresGuvenliMi('http://10.0.0.21/x'), false);
  assert.strictEqual(kg.adresGuvenliMi('bozuk'), false);
});

test('G4: imzalı manifestteki üyelik arşivi http ise girdi reddedilir (kaynak da https olmalı)', () => {
  const g = { dizin: 'book5', durum: 'ekle', sha256: 'a'.repeat(64), boyut: 1 };
  assert.strictEqual(kg.uyelikGirdisiGecerliMi(Object.assign({}, g, { kaynak: 'http://cdn.ornek.com/a.zip' })), false);
  assert.strictEqual(kg.uyelikGirdisiGecerliMi(Object.assign({}, g, { kaynak: 'https://cdn.ornek.com/a.zip' })), true);
});

test('G4: manifestImzasiGecerliMi saf — bozuk base64 / kısa imza / bozuk anahtar false döner', () => {
  const govde = Buffer.from('{"surum":"x"}');
  const iyi = imzala(govde);
  assert.strictEqual(kg.manifestImzasiGecerliMi(govde, iyi, TEST_ACIK), true);
  assert.strictEqual(kg.manifestImzasiGecerliMi(govde, iyi + '\n', TEST_ACIK), true, 'sondaki satır sonu tolere edilir');
  assert.strictEqual(kg.manifestImzasiGecerliMi(govde, 'kisa', TEST_ACIK), false);
  assert.strictEqual(kg.manifestImzasiGecerliMi(govde, '%%%', TEST_ACIK), false);
  assert.strictEqual(kg.manifestImzasiGecerliMi(govde, iyi, 'Ym96dWs='), false);
  assert.strictEqual(kg.manifestImzasiGecerliMi(govde, iyi, ''), false);
  assert.strictEqual(kg.setiNormalize({ setKimligi: 1, imza: { alg: 'ed25519', acikAnahtar: TEST_ACIK } }).imzaAnahtari, TEST_ACIK);
  assert.strictEqual(kg.setiNormalize({ setKimligi: 1 }).imzaAnahtari, '');
});
