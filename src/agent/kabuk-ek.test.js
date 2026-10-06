'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const E = require('./kabuk-ek');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const GIRDI_SHA = 'a'.repeat(64);
const SABIT_SAAT = '2026-10-06T00:00:00.000Z';

function ornekGirdi() {
  return {
    baslik: 'Set 45550',
    kitaplar: [
      { sira: 1, klasor: 'book1', assetId: '111', baslik: 'K1', tur: 'book', kapak: '111' },
      { sira: 2, klasor: 'book2', assetId: '222', baslik: 'K2', tur: 'book', kapak: '222' },
    ],
  };
}

function ornekDosyalar() {
  return new Map([
    ['index.html', Buffer.from('<!doctype html><title>set</title>'.repeat(20))],
    ['scripts/language-set.js', Buffer.from('/* sonrakiSatirDugmesi */\nvar a = 1;\n'.repeat(30))],
    ['config/settings.json', Buffer.from('{"a":1}')],
    ['set-menu.json', Buffer.from('{"kitaplar":[]}')],
    ['images/book1.png', crypto.randomBytes(3000)],
    ['features/kelime-avi.html', Buffer.from('<p>özellik ığüşöç</p>')],
  ]);
}

function ornekManifest(dosyalar = ornekDosyalar(), ek = {}) {
  return E.manifestKur({
    bookId: '45550', kisaKod: 'ABC', kip: 'bookN', girdiSha: GIRDI_SHA,
    webzSettingsSha: 'b'.repeat(64), tabanSurum: '2.51.3', tabanSha256: 'c'.repeat(64),
    arac: { kaynak: 'a810e9f9', sha256: '6ccb35b1ae0c' }, dosyalar, uretildi: SABIT_SAAT, ...ek,
  });
}

const AC = { bookId: '45550', girdiSha: GIRDI_SHA, kip: 'bookN' };

function hataKodu(fn, kod) {
  assert.throws(fn, (e) => e instanceof E.EkHatasi && e.kod === kod, `beklenen kod: ${kod}`);
}

test('girdiParmakIzi: anahtar sırasından bağımsız, aynı girdi aynı sha', () => {
  const g1 = ornekGirdi();
  const g2 = {
    kitaplar: g1.kitaplar.map((k) => Object.fromEntries(Object.entries(k).reverse())),
    baslik: g1.baslik,
  };
  const kap1 = new Map([['kapak-book1.png', Buffer.from('x')],
    ['kapak-book2.png', Buffer.from('y')]]);
  const kap2 = { 'kapak-book2.png': sha(Buffer.from('y')), 'kapak-book1.png': Buffer.from('x') };
  const a = E.girdiParmakIzi({ kip: 'bookN', girdi: g1, kapaklar: kap1, a1Girdi: null });
  const b = E.girdiParmakIzi({ kip: 'bookN', girdi: g2, kapaklar: kap2 });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b);
});

test('girdiParmakIzi: tek bayt / tek alan değişimi → farklı sha', () => {
  const kap = new Map([['kapak-book1.png', Buffer.from('xyz')]]);
  const temel = E.girdiParmakIzi({ kip: 'bookN', girdi: ornekGirdi(), kapaklar: kap });
  const kap2 = new Map([['kapak-book1.png', Buffer.from('xyZ')]]);
  assert.notEqual(E.girdiParmakIzi({ kip: 'bookN', girdi: ornekGirdi(), kapaklar: kap2 }), temel);
  const g = ornekGirdi();
  g.kitaplar[1].assetId = '223';
  assert.notEqual(E.girdiParmakIzi({ kip: 'bookN', girdi: g, kapaklar: kap }), temel);
  assert.notEqual(E.girdiParmakIzi({ kip: 'a1', girdi: ornekGirdi(), kapaklar: kap }), temel);
  // Dizi sırası anlamlıdır (kitap sırası) → değişince sha değişir.
  const t = ornekGirdi();
  t.kitaplar.reverse();
  assert.notEqual(E.girdiParmakIzi({ kip: 'bookN', girdi: t, kapaklar: kap }), temel);
});

test('girdiParmakIzi: a1Girdi bayt değişimi sha değiştirir; null ≠ boş', () => {
  const kap = {};
  const a1 = new Map([['classlibraries/ImWin32.dll', Buffer.from('menu')],
    ['kapak/index.html', Buffer.from('<html>')]]);
  const s1 = E.girdiParmakIzi({ kip: 'a1', girdi: ornekGirdi(), kapaklar: kap, a1Girdi: a1 });
  const a1b = new Map(a1);
  a1b.set('kapak/index.html', Buffer.from('<htmL>'));
  const s2 = E.girdiParmakIzi({ kip: 'a1', girdi: ornekGirdi(), kapaklar: kap, a1Girdi: a1b });
  assert.notEqual(s1, s2);
  const bos = E.girdiParmakIzi({ kip: 'a1', girdi: ornekGirdi(), kapaklar: kap, a1Girdi: {} });
  const yok = E.girdiParmakIzi({ kip: 'a1', girdi: ornekGirdi(), kapaklar: kap, a1Girdi: null });
  assert.notEqual(bos, yok);
  const kisa = { a: 'kısa' };
  assert.throws(() => E.girdiParmakIzi({ kip: 'a1', girdi: {}, kapaklar: kisa }), TypeError);
});

test('manifestKur: yol sıralı liste, sha/boyut, toplamBayt', () => {
  const d = ornekDosyalar();
  const m = ornekManifest(d);
  assert.equal(m.sozlesme, 1);
  assert.equal(m.bookId, '45550');
  assert.deepEqual(m.dosyalar.map((x) => x.yol), [...d.keys()].sort());
  for (const x of m.dosyalar) {
    assert.equal(x.sha256, sha(d.get(x.yol)));
    assert.equal(x.boyut, d.get(x.yol).length);
  }
  assert.equal(m.toplamBayt, [...d.values()].reduce((t, b) => t + b.length, 0));
  assert.match(E.manifestKur({ bookId: 1, kip: 'a1', girdiSha: GIRDI_SHA, dosyalar: new Map() })
    .uretildi, /^\d{4}-\d\d-\d\dT/);
});

test('ekPaketle → ekAc gidiş-dönüş: Buffer eşitliği + manifest', () => {
  const d = ornekDosyalar();
  const m = ornekManifest(d);
  const zip = E.ekPaketle({ manifest: m, dosyalar: d });
  const { manifest, dosyalar } = E.ekAc(zip, AC);
  assert.deepEqual(manifest, m);
  assert.deepEqual([...dosyalar.keys()].sort(), [...d.keys()].sort());
  for (const [y, b] of d) assert.ok(dosyalar.get(y).equals(b), y);
});

test('ekPaketle: aynı girdi → bayt-aynı zip (sabit tarih)', () => {
  const d = ornekDosyalar();
  const ters = new Map([...d].reverse());
  const z1 = E.ekPaketle({ manifest: ornekManifest(d), dosyalar: d });
  const z2 = E.ekPaketle({ manifest: ornekManifest(ters), dosyalar: ters });
  assert.ok(z1.equals(z2));
  // DOS tarih alanı 1980-01-01 (0x0021), saat 0.
  assert.equal(z1.readUInt16LE(10), 0);
  assert.equal(z1.readUInt16LE(12), 0x21);
});

test('standart açıcı (unzip) zip\'i açar ve içeriği doğrular', (t) => {
  const v = spawnSync('unzip', ['-v'], { encoding: 'utf8' });
  if (v.error || v.status !== 0) { t.skip('unzip yok'); return; }
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'kabuk-ek-test-'));
  t.after(() => fs.rmSync(dizin, { recursive: true, force: true }));
  const d = ornekDosyalar();
  const zipYolu = path.join(dizin, 'ek.zip');
  fs.writeFileSync(zipYolu, E.ekPaketle({ manifest: ornekManifest(d), dosyalar: d }));
  const liste = spawnSync('unzip', ['-l', zipYolu], { encoding: 'utf8' });
  assert.equal(liste.status, 0, liste.stderr);
  for (const y of [...d.keys(), E.MANIFEST_ADI]) assert.ok(liste.stdout.includes(y), y);
  const sina = spawnSync('unzip', ['-t', zipYolu], { encoding: 'utf8' });
  assert.equal(sina.status, 0, sina.stdout + sina.stderr);
  const cikti = path.join(dizin, 'ac');
  const ac = spawnSync('unzip', ['-q', zipYolu, '-d', cikti], { encoding: 'utf8' });
  assert.equal(ac.status, 0, ac.stderr);
  for (const [y, b] of d) assert.ok(fs.readFileSync(path.join(cikti, y)).equals(b), y);
});

test('yol güvenliği: .., mutlak, ters bölü, _ önek, boş, beyaz liste dışı → yol', () => {
  const kotu = ['../x', 'a/../index.html', '/abs', 'C:/x', 'a\\b', '_eski/index.html', '',
    'scripts//x.js', './index.html', 'scripts/kotu.js', 'bookN/index.html', 'kabuk-ek.json',
    'images/../../etc.png'];
  for (const y of kotu) {
    const d = new Map([[y, Buffer.from('x')]]);
    hataKodu(() => E.ekPaketle({ manifest: { dosyalar: [] }, dosyalar: d }), 'yol');
  }
  // Açma tarafı: zip içine kötü yol elle konur (zipYaz denetlemez).
  for (const y of ['../x', '/abs', 'a\\b', '_eski/x', 'scripts/kotu.js']) {
    const v = Buffer.from('x');
    const m = { ...ornekManifest(new Map()), dosyalar: [{ yol: y, sha256: sha(v), boyut: 1 }],
      toplamBayt: 1 };
    const zip = E.zipYaz([{ ad: E.MANIFEST_ADI, veri: Buffer.from(JSON.stringify(m)) },
      { ad: y, veri: v }]);
    hataKodu(() => E.ekAc(zip, AC), 'yol');
  }
  // Biçim denetimi beyaz listeden bağımsızdır: her şeyi kabul eden liste de bunları açmaz.
  const hepsi = () => true;
  for (const y of ['../x', '/abs', 'a\\b', '_eski/index.html', 'a//b', E.MANIFEST_ADI]) {
    hataKodu(() => E.yolDenetle(y, hepsi), 'yol');
  }
});

test('beyaz liste: varsayılan kabukDosyasiMi; klasorler varsa images/ yalnız onlar', () => {
  const d = new Map([['images/book9.png', Buffer.from('p')]]);
  const m = ornekManifest(d);
  E.ekPaketle({ manifest: m, dosyalar: d }); // klasör listesi yok → güvenli ad kabul
  hataKodu(() => E.ekPaketle({ manifest: m, dosyalar: d }, { klasorler: ['book1'] }), 'yol');
  const zip = E.ekPaketle({ manifest: m, dosyalar: d }, { klasorler: new Set(['book9']) });
  hataKodu(() => E.ekAc(zip, { ...AC, klasorler: ['book1'] }), 'yol');
  assert.equal(E.ekAc(zip, { ...AC, klasorler: ['book9'] }).dosyalar.size, 1);
  // Özel beyaz liste fonksiyonu varsayılanın yerine geçer.
  hataKodu(() => E.ekAc(zip, { ...AC, beyazListe: () => false }), 'yol');
});

test('tavan: env ile küçük tavan → paketleme ve açma reddi', (t) => {
  const eski = process.env.EMPP_KABUK_EK_TAVAN;
  t.after(() => {
    if (eski === undefined) delete process.env.EMPP_KABUK_EK_TAVAN;
    else process.env.EMPP_KABUK_EK_TAVAN = eski;
  });
  const d = ornekDosyalar();
  const m = ornekManifest(d);
  const zip = E.ekPaketle({ manifest: m, dosyalar: d });
  process.env.EMPP_KABUK_EK_TAVAN = String(zip.length - 1);
  hataKodu(() => E.ekPaketle({ manifest: m, dosyalar: d }), 'tavan');
  hataKodu(() => E.ekAc(zip, AC), 'tavan');
  process.env.EMPP_KABUK_EK_TAVAN = String(zip.length);
  assert.ok(E.ekPaketle({ manifest: m, dosyalar: d }).equals(zip));
  hataKodu(() => E.ekAc(zip, { ...AC, tavan: 100 }), 'tavan');
  assert.equal(E.EK_TAVAN_BAYT > 0, true);
});

test('sha bozulması: zip içinde bayt değişimi → bozuk', () => {
  const govde = Buffer.from(`{"saklanan":"${'z'.repeat(50)}"}`);
  const d = new Map([['config/settings.json', govde]]);
  const m = ornekManifest(d);
  const zip = E.ekPaketle({ manifest: m, dosyalar: d });
  // Son yerel girdinin verisi merkez dizinden hemen önce: o bölgede bir bayt değiştir.
  const mdOfs = zip.readUInt32LE(zip.length - 22 + 16);
  const bozuk = Buffer.from(zip);
  bozuk[mdOfs - 3] ^= 0xff;
  hataKodu(() => E.ekAc(bozuk, AC), 'bozuk');
  // CRC geçerli ama manifest sha'sı farklı (içerik değiştirilip zip yeniden yazılmış).
  const sahte = Buffer.from('{"saklanan":"' + 'y'.repeat(50) + '"}');
  const zip2 = E.zipYaz([{ ad: E.MANIFEST_ADI, veri: Buffer.from(JSON.stringify(m)) },
    { ad: 'config/settings.json', veri: sahte }]);
  hataKodu(() => E.ekAc(zip2, AC), 'bozuk');
});

test('manifest-zip küme farkı ve eksik manifest → bozuk', () => {
  const d = new Map([['index.html', Buffer.from('a')], ['set-menu.json', Buffer.from('{}')]]);
  const m = ornekManifest(d);
  const mj = Buffer.from(JSON.stringify(m));
  // Zip'te fazladan dosya.
  const fazla = E.zipYaz([{ ad: E.MANIFEST_ADI, veri: mj },
    { ad: 'index.html', veri: d.get('index.html') },
    { ad: 'set-menu.json', veri: d.get('set-menu.json') },
    { ad: 'config/settings.json', veri: Buffer.from('{}') }]);
  hataKodu(() => E.ekAc(fazla, AC), 'bozuk');
  // Zip'te eksik dosya.
  const eksik = E.zipYaz([{ ad: E.MANIFEST_ADI, veri: mj },
    { ad: 'index.html', veri: d.get('index.html') }]);
  hataKodu(() => E.ekAc(eksik, AC), 'bozuk');
  // Manifest yok / JSON değil / zip değil.
  hataKodu(() => E.ekAc(E.zipYaz([{ ad: 'index.html', veri: Buffer.from('a') }]), AC), 'bozuk');
  hataKodu(() => E.ekAc(E.zipYaz([{ ad: E.MANIFEST_ADI, veri: Buffer.from('{x') }]), AC), 'bozuk');
  hataKodu(() => E.ekAc(Buffer.from('zip değil, düz metin gövde'), AC), 'bozuk');
  // Paketlerken de manifest ile Map uyuşmazsa üretilmez.
  const tek = new Map([['index.html', Buffer.from('a')]]);
  hataKodu(() => E.ekPaketle({ manifest: m, dosyalar: tek }), 'bozuk');
});

test('bayat: girdiSha / bookId / kip / sözleşme farkı', () => {
  const d = ornekDosyalar();
  const zip = E.ekPaketle({ manifest: ornekManifest(d), dosyalar: d });
  hataKodu(() => E.ekAc(zip, { ...AC, girdiSha: 'f'.repeat(64) }), 'bayat');
  hataKodu(() => E.ekAc(zip, { ...AC, bookId: '45551' }), 'bayat');
  hataKodu(() => E.ekAc(zip, { ...AC, kip: 'a1' }), 'bayat');
  assert.ok(E.ekAc(zip, { ...AC, bookId: 45550, girdiSha: GIRDI_SHA.toUpperCase() }));
  const m2 = { ...ornekManifest(d), sozlesme: 2 };
  const zip2 = E.ekPaketle({ manifest: m2, dosyalar: d });
  hataKodu(() => E.ekAc(zip2, AC), 'bayat');
});

test('anahtarlar ve URL\'ler', () => {
  assert.equal(E.ekAnahtari('45550', GIRDI_SHA), `kabuk-ek/45550/${GIRDI_SHA}.zip`);
  assert.equal(E.retAnahtari(45550, GIRDI_SHA), `kabuk-ek/45550/${GIRDI_SHA}.ret.json`);
  assert.equal(E.sonAnahtari('45550'), 'kabuk-ek/45550/son.json');
  assert.equal(E.ekUrl('45550', GIRDI_SHA), `${E.CDN_TABAN}/kabuk-ek/45550/${GIRDI_SHA}.zip`);
  assert.match(E.sonUrl('45550'), /\/kabuk-ek\/45550\/son\.json\?t=\d+$/);
  assert.equal(E.sonUrl('1', 5), `${E.CDN_TABAN}/kabuk-ek/1/son.json?t=5`);
  assert.match(E.retUrl('45550', GIRDI_SHA), /\.ret\.json\?t=\d+$/);
  assert.throws(() => E.ekAnahtari('../x', GIRDI_SHA), TypeError);
  assert.throws(() => E.ekAnahtari('1', 'kısa'), TypeError);
});

const ZIP = `${GIRDI_SHA}.zip`;
const RET = `${GIRDI_SHA}.ret.json`;

function sahteGetir(tablo) {
  const cagrilar = [];
  const getir = async (url) => {
    cagrilar.push(url);
    const anahtar = url.replace(/\?.*$/, '');
    for (const [son, cevap] of tablo) {
      if (anahtar.endsWith(son)) {
        if (cevap instanceof Error) throw cevap;
        return cevap;
      }
    }
    return { status: 404, buffer: Buffer.alloc(0) };
  };
  return { getir, cagrilar };
}

test('ekGetir: 200 → var (doğrulanmış dosyalar)', async () => {
  const d = ornekDosyalar();
  const zip = E.ekPaketle({ manifest: ornekManifest(d), dosyalar: d });
  const { getir, cagrilar } = sahteGetir([[`${GIRDI_SHA}.zip`, { status: 200, buffer: zip }]]);
  const r = await E.ekGetir({ ...AC, getir });
  assert.equal(r.durum, 'var');
  assert.equal(r.manifest.girdiSha, GIRDI_SHA);
  assert.ok(r.dosyalar.get('index.html').equals(d.get('index.html')));
  assert.deepEqual(cagrilar, [E.ekUrl('45550', GIRDI_SHA)]);
});

test('ekGetir: 404 + ret yok → yok; 404 + ret.json → ret', async () => {
  const yok = await E.ekGetir({ ...AC, getir: sahteGetir([]).getir });
  assert.deepEqual(yok, { durum: 'yok' });
  const ret = sahteGetir([[`${GIRDI_SHA}.ret.json`,
    { status: 200, buffer: Buffer.from(JSON.stringify({ neden: 'kapı RED: eşleme' })) }]]);
  assert.deepEqual(await E.ekGetir({ ...AC, getir: ret.getir }),
    { durum: 'ret', neden: 'kapı RED: eşleme' });
  assert.match(ret.cagrilar[1], /\.ret\.json\?t=\d+$/);
  const bozukRet = sahteGetir([[RET, { status: 200, buffer: Buffer.from('{') }]]);
  assert.equal((await E.ekGetir({ ...AC, getir: bozukRet.getir })).durum, 'ret');
});

test('ekGetir: ağ hatası / 5xx / bozuk / bayat → hata, FIRLATMAZ', async () => {
  const ag = await E.ekGetir({ ...AC, getir: sahteGetir([[ZIP, new Error('ECONNRESET')]]).getir });
  assert.equal(ag.durum, 'hata');
  assert.equal(ag.kod, 'ag');
  assert.match(ag.mesaj, /ECONNRESET/);
  const s5 = await E.ekGetir({ ...AC, getir: sahteGetir([[ZIP, { status: 502 }]]).getir });
  assert.deepEqual([s5.durum, s5.kod], ['hata', 'ag']);
  const retAg = await E.ekGetir({ ...AC,
    getir: sahteGetir([[`${GIRDI_SHA}.ret.json`, new Error('zaman aşımı')]]).getir });
  assert.deepEqual([retAg.durum, retAg.kod], ['hata', 'ag']);
  const bozuk = await E.ekGetir({ ...AC,
    getir: sahteGetir([[ZIP, { status: 200, buffer: Buffer.from('html 200 sayfası') }]]).getir });
  assert.deepEqual([bozuk.durum, bozuk.kod], ['hata', 'bozuk']);
  const d = ornekDosyalar();
  const zip = E.ekPaketle({ manifest: ornekManifest(d), dosyalar: d });
  const bayat = await E.ekGetir({ ...AC, kip: 'a1',
    getir: sahteGetir([[`${GIRDI_SHA}.zip`, { status: 200, buffer: zip }]]).getir });
  assert.deepEqual([bayat.durum, bayat.kod], ['hata', 'bayat']);
  const kotuId = await E.ekGetir({ ...AC, bookId: '../x', getir: sahteGetir([]).getir });
  assert.equal(kotuId.durum, 'hata');
});

test('sonOku: 200 → obje, 404/ağ/bozuk → null', async () => {
  const son = { '45550': { girdiSha: GIRDI_SHA } };
  const ok = sahteGetir([['son.json', { status: 200, buffer: Buffer.from(JSON.stringify(son)) }]]);
  assert.deepEqual(await E.sonOku({ bookId: '45550', getir: ok.getir }), son);
  assert.match(ok.cagrilar[0], /son\.json\?t=\d+$/);
  assert.equal(await E.sonOku({ bookId: '45550', getir: sahteGetir([]).getir }), null);
  assert.equal(await E.sonOku({ bookId: '45550',
    getir: sahteGetir([['son.json', new Error('ağ')]]).getir }), null);
  assert.equal(await E.sonOku({ bookId: '45550',
    getir: sahteGetir([['son.json', { status: 200, buffer: Buffer.from('<html>') }]]).getir }),
  null);
});

test('EkHatasi: kod ve sınıf', () => {
  const e = new E.EkHatasi('bayat', 'mesaj');
  assert.ok(e instanceof Error);
  assert.equal(e.kod, 'bayat');
  assert.equal(e.message, 'mesaj');
  assert.equal(E.SOZLESME, 1);
});
