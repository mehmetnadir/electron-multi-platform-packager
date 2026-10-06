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

test('anahtarlar ve URL\'ler (hepsi önbellek kırıcılı)', () => {
  assert.equal(E.ekAnahtari('45550', GIRDI_SHA), `kabuk-ek/45550/${GIRDI_SHA}.zip`);
  assert.equal(E.imzaAnahtari('45550', GIRDI_SHA), `kabuk-ek/45550/${GIRDI_SHA}.imza`);
  assert.equal(E.retAnahtari(45550, GIRDI_SHA), `kabuk-ek/45550/${GIRDI_SHA}.ret.json`);
  assert.equal(E.sonAnahtari('45550'), 'kabuk-ek/45550/son.json');
  assert.equal(E.ekUrl('45550', GIRDI_SHA, 7),
    `${E.CDN_TABAN}/kabuk-ek/45550/${GIRDI_SHA}.zip?t=7`);
  assert.match(E.ekUrl('45550', GIRDI_SHA), /\.zip\?t=\d+$/);
  assert.match(E.imzaUrl('45550', GIRDI_SHA), /\.imza\?t=\d+$/);
  assert.match(E.sonUrl('45550'), /\/kabuk-ek\/45550\/son\.json\?t=\d+$/);
  assert.equal(E.sonUrl('1', 5), `${E.CDN_TABAN}/kabuk-ek/1/son.json?t=5`);
  assert.match(E.retUrl('45550', GIRDI_SHA), /\.ret\.json\?t=\d+$/);
  assert.throws(() => E.ekAnahtari('../x', GIRDI_SHA), TypeError);
  assert.throws(() => E.imzaAnahtari('1', 'kısa'), TypeError);
});

const ZIP = `${GIRDI_SHA}.zip`;
const RET = `${GIRDI_SHA}.ret.json`;
const IMZA = `${GIRDI_SHA}.imza`;

function anahtarCifti() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    ozel: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    acik: publicKey.export({ type: 'spki', format: 'pem' }),
  };
}
const ANAHTAR = anahtarCifti();

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

/** İmzalı ek: [zip cevabı, imza cevabı]. */
function imzaliTablo(zip, imza = E.ekImzala(zip, ANAHTAR.ozel)) {
  return [[ZIP, { status: 200, buffer: zip }], [IMZA, { status: 200, buffer: Buffer.from(imza) }]];
}
const ACG = { ...AC, acikAnahtar: ANAHTAR.acik };

test('ekImzala / ekImzaDogrula: geçerli, bozuk, yanlış anahtar, ed25519 dışı', () => {
  const buf = Buffer.from('kabuk eki zip baytları');
  const imza = E.ekImzala(buf, ANAHTAR.ozel);
  assert.match(imza, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(E.ekImzaDogrula(buf, imza, ANAHTAR.acik), true);
  assert.equal(E.ekImzaDogrula(buf, `${imza}\n`, ANAHTAR.acik), true);
  const degisik = Buffer.from(buf);
  degisik[0] ^= 1;
  assert.equal(E.ekImzaDogrula(degisik, imza, ANAHTAR.acik), false);
  const ham = Buffer.from(imza, 'base64');
  ham[5] ^= 0xff;
  assert.equal(E.ekImzaDogrula(buf, ham.toString('base64'), ANAHTAR.acik), false);
  assert.equal(E.ekImzaDogrula(buf, imza, anahtarCifti().acik), false);
  assert.equal(E.ekImzaDogrula(buf, '', ANAHTAR.acik), false);
  assert.equal(E.ekImzaDogrula(buf, 'çöp!', ANAHTAR.acik), false);
  assert.equal(E.ekImzaDogrula(buf, imza, 'pem değil'), false);
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  assert.throws(() => E.ekImzala(buf, rsa.privateKey), TypeError);
  assert.equal(E.ekImzaDogrula(buf, imza, rsa.publicKey), false);
});

test('ekGetir: imzalı 200 → var (doğrulanmış dosyalar)', async () => {
  const d = ornekDosyalar();
  const zip = E.ekPaketle({ manifest: ornekManifest(d), dosyalar: d });
  const { getir, cagrilar } = sahteGetir(imzaliTablo(zip));
  const r = await E.ekGetir({ ...ACG, getir });
  assert.equal(r.durum, 'var');
  assert.equal(r.manifest.girdiSha, GIRDI_SHA);
  assert.ok(r.dosyalar.get('index.html').equals(d.get('index.html')));
  assert.equal(cagrilar.length, 2);
  assert.match(cagrilar[0], /\.zip\?t=\d+$/);
  assert.match(cagrilar[1], /\.imza\?t=\d+$/);
});

test('ekGetir imza: yok, bozuk, yanlış anahtar, anahtarsız → hata; zip ayrıştırılmaz', async () => {
  const d = ornekDosyalar();
  const zip = E.ekPaketle({ manifest: ornekManifest(d), dosyalar: d });
  const yok = await E.ekGetir({ ...ACG,
    getir: sahteGetir([[ZIP, { status: 200, buffer: zip }]]).getir });
  assert.deepEqual([yok.durum, yok.kod], ['hata', 'imza']);
  const ham = Buffer.from(E.ekImzala(zip, ANAHTAR.ozel), 'base64');
  ham[0] ^= 1;
  const bozuk = await E.ekGetir({ ...ACG,
    getir: sahteGetir(imzaliTablo(zip, ham.toString('base64'))).getir });
  assert.deepEqual([bozuk.durum, bozuk.kod], ['hata', 'imza']);
  const yanlis = await E.ekGetir({ ...AC, acikAnahtar: anahtarCifti().acik,
    getir: sahteGetir(imzaliTablo(zip)).getir });
  assert.deepEqual([yanlis.durum, yanlis.kod], ['hata', 'imza']);
  const anahtarsiz = sahteGetir(imzaliTablo(zip));
  const r = await E.ekGetir({ ...AC, getir: anahtarsiz.getir });
  assert.deepEqual([r.durum, r.kod], ['hata', 'imza-anahtari-yok']);
  assert.equal(anahtarsiz.cagrilar.length, 1);
  // İmzasız çöp gövde: ayrıştırılmadan imza hatası (bozuk değil).
  const cop = await E.ekGetir({ ...ACG,
    getir: sahteGetir([[ZIP, { status: 200, buffer: Buffer.from('html 200 sayfası') }]]).getir });
  assert.deepEqual([cop.durum, cop.kod], ['hata', 'imza']);
  // İmza ağ hatası / 5xx → ag.
  const imzaAg = await E.ekGetir({ ...ACG,
    getir: sahteGetir([[ZIP, { status: 200, buffer: zip }],
      [IMZA, new Error('ETIMEDOUT')]]).getir });
  assert.deepEqual([imzaAg.durum, imzaAg.kod], ['hata', 'ag']);
});

test('ekGetir: 404 + ret yok → yok; 404 + ret.json → ret', async () => {
  const yok = await E.ekGetir({ ...ACG, getir: sahteGetir([]).getir });
  assert.deepEqual(yok, { durum: 'yok' });
  assert.deepEqual(await E.ekGetir({ ...AC, getir: sahteGetir([]).getir }), { durum: 'yok' });
  const ret = sahteGetir([[RET,
    { status: 200, buffer: Buffer.from(JSON.stringify({ neden: 'kapı RED: eşleme' })) }]]);
  assert.deepEqual(await E.ekGetir({ ...ACG, getir: ret.getir }),
    { durum: 'ret', neden: 'kapı RED: eşleme' });
  assert.match(ret.cagrilar[1], /\.ret\.json\?t=\d+$/);
  const bozukRet = sahteGetir([[RET, { status: 200, buffer: Buffer.from('{') }]]);
  assert.equal((await E.ekGetir({ ...ACG, getir: bozukRet.getir })).durum, 'ret');
});

test('ekGetir: 403 / ağ hatası / 5xx / bozuk / bayat → hata, FIRLATMAZ', async () => {
  const ag = await E.ekGetir({ ...ACG, getir: sahteGetir([[ZIP, new Error('ECONNRESET')]]).getir });
  assert.deepEqual([ag.durum, ag.kod], ['hata', 'ag']);
  assert.match(ag.mesaj, /ECONNRESET/);
  const s403 = await E.ekGetir({ ...ACG, getir: sahteGetir([[ZIP, { status: 403 }]]).getir });
  assert.deepEqual([s403.durum, s403.kod], ['hata', 'ag']);
  const ret403 = await E.ekGetir({ ...ACG, getir: sahteGetir([[RET, { status: 403 }]]).getir });
  assert.deepEqual([ret403.durum, ret403.kod], ['hata', 'ag']);
  const s5 = await E.ekGetir({ ...ACG, getir: sahteGetir([[ZIP, { status: 502 }]]).getir });
  assert.deepEqual([s5.durum, s5.kod], ['hata', 'ag']);
  const retAg = await E.ekGetir({ ...ACG,
    getir: sahteGetir([[RET, new Error('zaman aşımı')]]).getir });
  assert.deepEqual([retAg.durum, retAg.kod], ['hata', 'ag']);
  // İmzası geçerli ama ayrıştırılamayan gövde → bozuk.
  const cop = Buffer.from('imzalı ama zip değil');
  const bozuk = await E.ekGetir({ ...ACG, getir: sahteGetir(imzaliTablo(cop)).getir });
  assert.deepEqual([bozuk.durum, bozuk.kod], ['hata', 'bozuk']);
  const d = ornekDosyalar();
  const zip = E.ekPaketle({ manifest: ornekManifest(d), dosyalar: d });
  const bayat = await E.ekGetir({ ...ACG, kip: 'a1', getir: sahteGetir(imzaliTablo(zip)).getir });
  assert.deepEqual([bayat.durum, bayat.kod], ['hata', 'bayat']);
  const tavan = await E.ekGetir({ ...ACG, tavan: 10, getir: sahteGetir(imzaliTablo(zip)).getir });
  assert.deepEqual([tavan.durum, tavan.kod], ['hata', 'tavan']);
  const kotuId = await E.ekGetir({ ...ACG, bookId: '../x', getir: sahteGetir([]).getir });
  assert.equal(kotuId.durum, 'hata');
});

/** Merkez dizindeki n. girdinin başlık ofseti. */
function merkezOfseti(zip, n) {
  const e = zip.length - 22;
  let p = zip.readUInt32LE(e + 16);
  for (let i = 0; i < n; i++) {
    p += 46 + zip.readUInt16LE(p + 28) + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return p;
}

test('zip bombası: çakışan/aynı ofsetli girdi, büyük açık boy, toplam ve sayı tavanı', () => {
  const T = 1000;
  // Aynı yerel başlığa işaret eden iki girdi (bomba.js kalıbı).
  const iki = E.zipYaz([{ ad: 'a', veri: Buffer.alloc(100) },
    { ad: 'b', veri: Buffer.alloc(100) }]);
  const ayni = Buffer.from(iki);
  ayni.writeUInt32LE(0, merkezOfseti(ayni, 1) + 42);
  hataKodu(() => E.zipOku(ayni), 'bozuk');
  assert.throws(() => E.zipOku(ayni), /aynı yerel başlığa/);
  // Çakışan aralık: ilk girdinin sıkıştırılmış boyu ikinciye taşar.
  const cakisan = Buffer.from(iki);
  const p0 = merkezOfseti(cakisan, 0);
  cakisan.writeUInt32LE(cakisan.readUInt32LE(p0 + 20) + 10, p0 + 20);
  assert.throws(() => E.zipOku(cakisan), /çakışan girdiler/);
  // Tek girdi açık boy beyanı > 4×tavan (şişirmeden önce red).
  const tek = E.zipYaz([{ ad: 'a', veri: Buffer.alloc(100) }]);
  const buyuk = Buffer.from(tek);
  buyuk.writeUInt32LE(4 * T + 1, merkezOfseti(buyuk, 0) + 24);
  assert.throws(() => E.zipOku(buyuk, { tavan: T }), /4×tavan/);
  // Gerçek bomba: 20 MB sıfır ~20 KB'a sıkışır; varsayılan tavanla açılmadan reddedilir.
  const bomba = E.zipYaz([{ ad: 'index.html', veri: Buffer.alloc(20 * 1024 * 1024) }]);
  assert.ok(bomba.length < 100 * 1024);
  assert.throws(() => E.zipOku(bomba), /4×tavan/);
  hataKodu(() => E.ekAc(bomba, AC), 'bozuk');
  // Toplam: 3 × 3T (her biri ≤ 4T) = 9T > 8T.
  const uc = E.zipYaz(['a', 'b', 'c'].map((ad) => ({ ad, veri: Buffer.alloc(3 * T) })));
  assert.throws(() => E.zipOku(uc, { tavan: T }), /toplamı/);
  assert.equal(E.zipOku(uc, { tavan: 2 * T }).size, 3);
  // Girdi sayısı tavanı.
  const cok = E.zipYaz(Array.from({ length: E.GIRDI_TAVANI + 1 },
    (_, i) => ({ ad: `f${i}`, veri: Buffer.from('x') })));
  assert.throws(() => E.zipOku(cok), /girdi sayısı/);
  const sinir = E.zipYaz(Array.from({ length: E.GIRDI_TAVANI },
    (_, i) => ({ ad: `f${i}`, veri: Buffer.from('x') })));
  assert.equal(E.zipOku(sinir).size, E.GIRDI_TAVANI);
});

test('tavanAl: tek kaynak — seçenek > env > varsayılan', (t) => {
  const eski = process.env.EMPP_KABUK_EK_TAVAN;
  t.after(() => {
    if (eski === undefined) delete process.env.EMPP_KABUK_EK_TAVAN;
    else process.env.EMPP_KABUK_EK_TAVAN = eski;
  });
  delete process.env.EMPP_KABUK_EK_TAVAN;
  assert.equal(E.tavanAl(), 2 * 1024 * 1024);
  process.env.EMPP_KABUK_EK_TAVAN = '1234';
  assert.equal(E.tavanAl(), 1234);
  assert.equal(E.tavanAl({ tavan: 99 }), 99);
  process.env.EMPP_KABUK_EK_TAVAN = 'çöp';
  assert.equal(E.tavanAl(), 2 * 1024 * 1024);
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
