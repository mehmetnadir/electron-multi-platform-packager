'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { yazmaKapisi } = require('./yazma-kapisi');

const FIK = path.join(__dirname, 'fixtures', 'yazma-kapisi');
const f = (ad) => path.join(FIK, ad);
const LISTE3 = '101|Bir\n102|Iki\n103|Uc';
const IKI_GIB = 2 * 1024 * 1024 * 1024;

test('tam geçen set: 3 kitap, içerik+kapak, liste 3, boyut yeterli', () => {
  const r = yazmaKapisi({ buildDizini: f('tam'), setListesi: LISTE3, oncekiBoyut: 1000, boyut: 1000, tur: 'otomatik' });
  assert.equal(r.gecti, true, r.nedenler.join('|'));
  assert.deepEqual(r.nedenler, []);
  assert.deepEqual(r.kitaplar, [
    { n: 1, id: '101', icerik: true, kapak: true },
    { n: 2, id: '102', icerik: true, kapak: true },
    { n: 3, id: '103', icerik: true, kapak: true },
  ]);
});

test('vs biliniyorsa doldurulur, bilinmiyorsa alan yok; link: satırı kitap sayılmaz', () => {
  const r = yazmaKapisi({
    buildDizini: f('tam'), setListesi: `${LISTE3}\nlink:https://x.y|Kısayol`, vsler: { 2: 7 }, tur: 'otomatik',
  });
  assert.equal(r.gecti, true, r.nedenler.join('|'));
  assert.equal(r.kitaplar[1].vs, 7);
  assert.equal('vs' in r.kitaplar[0], false);
});

test('eksik kapak: book2 kapak=false, geçmez', () => {
  const r = yazmaKapisi({ buildDizini: f('eksik-kapak'), setListesi: LISTE3 });
  assert.equal(r.gecti, false);
  assert.equal(r.kitaplar[1].kapak, false);
  assert.equal(r.kitaplar[1].icerik, true);
  assert.ok(r.nedenler.some((n) => /book2: kapak yok/.test(n)), r.nedenler.join('|'));
});

test('eksik içerik: book2 BookContent yok (kapak var) → icerik=false, geçmez', () => {
  const r = yazmaKapisi({ buildDizini: f('eksik-icerik'), setListesi: LISTE3 });
  assert.equal(r.gecti, false);
  assert.deepEqual([r.kitaplar[1].icerik, r.kitaplar[1].kapak], [false, true]);
  assert.ok(r.nedenler.some((n) => /book2: içerik yok/.test(n)));
});

test('fazla bookN: 4 dizin ≠ liste 3', () => {
  const r = yazmaKapisi({ buildDizini: f('fazla-bookn'), setListesi: LISTE3 });
  assert.equal(r.gecti, false);
  assert.deepEqual(r.nedenKodlari, ['liste-disi-kitap']);
  assert.ok(r.nedenler.some((n) => /book4 kimliği 104 listede yok.*kitap sayısı 4 ≠ liste 3/.test(n)), r.nedenler.join('|'));
});

test('eksik bookN: 2 dizin ≠ liste 3', () => {
  const r = yazmaKapisi({ buildDizini: f('eksik-bookn'), setListesi: LISTE3 });
  assert.equal(r.gecti, false);
  assert.deepEqual(r.nedenKodlari, ['kitap-eksik']);
  assert.ok(r.nedenler.some((n) => /liste kimliği 102 build'de yok.*kitap sayısı 2 ≠ liste 3/.test(n)), r.nedenler.join('|'));
});

test('boyut: %79 düşer, %80 geçer, oncekiBoyut yoksa atlanır', () => {
  const baz = { buildDizini: f('tam'), setListesi: LISTE3, oncekiBoyut: 1000 };
  const dus = yazmaKapisi({ ...baz, boyut: 790 });
  assert.equal(dus.gecti, false);
  assert.ok(dus.nedenler.some((n) => /boyut 790 < önceki 1000/.test(n)));
  assert.equal(yazmaKapisi({ ...baz, boyut: 800 }).gecti, true);
  assert.equal(yazmaKapisi({ buildDizini: f('tam'), setListesi: LISTE3, boyut: 1 }).gecti, true);
});

test('manuel + liste yok: sayı atlanır, içerik+kapak denetlenir; otomatik + liste yok set için ret', () => {
  assert.equal(yazmaKapisi({ buildDizini: f('fazla-bookn'), tur: 'manuel' }).gecti, true);
  const kapaksiz = yazmaKapisi({ buildDizini: f('eksik-kapak'), tur: 'manuel' });
  assert.equal(kapaksiz.gecti, false);
  const oto = yazmaKapisi({ buildDizini: f('tam'), tur: 'otomatik' });
  assert.equal(oto.gecti, false);
  assert.ok(oto.nedenler.some((n) => /set listesi yok/.test(n)));
});

test('tek kitap yapılı (bookN yok): kök assets/<id>, n=1; listesiz geçer, liste 1 geçer, liste 2 düşer', () => {
  const r = yazmaKapisi({ buildDizini: f('tek-kitap'), tur: 'otomatik' });
  assert.equal(r.gecti, true, r.nedenler.join('|'));
  assert.deepEqual(r.kitaplar, [{ n: 1, id: '72378', icerik: true, kapak: true }]);
  assert.equal(yazmaKapisi({ buildDizini: f('tek-kitap'), setListesi: '72378|Tek' }).gecti, true);
  assert.equal(yazmaKapisi({ buildDizini: f('tek-kitap'), setListesi: '1|a\n2|b' }).gecti, false);
});

test('okunamayan zip / girdi yok: ret', () => {
  assert.equal(yazmaKapisi({ zipYolu: '/yok/yok.zip' }).gecti, false);
  assert.equal(yazmaKapisi({}).gecti, false);
});

function ziple(kaynak) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yazma-kapisi-'));
  const zip = path.join(dir, 'build.zip');
  const r = spawnSync('zip', ['-qr', zip, '.'], { cwd: kaynak });
  assert.equal(r.status, 0, String(r.stderr));
  return { dir, zip };
}

test('zip yolu: unzip -Z1 ile listelenir, adm-zip require edilmez', () => {
  const { dir, zip } = ziple(f('tam'));
  try {
    const cagri = [];
    const gercek = require('./icerik-kapisi').zipGirisAdlariniOku;
    const r = yazmaKapisi({
      zipYolu: zip, setListesi: LISTE3, tur: 'otomatik', listele: (z) => { cagri.push(z); return gercek(z); },
    });
    assert.equal(r.gecti, true, r.nedenler.join('|'));
    assert.deepEqual(cagri, [zip]);
    const kaynak = fs.readFileSync(path.join(__dirname, 'yazma-kapisi.js'), 'utf8');
    assert.doesNotMatch(kaynak, /require\(['"]adm-zip['"]\)/);
    const adm = (m) => (m.children || []).some((c) => /adm-zip/.test(c.filename) || adm(c));
    assert.equal(adm(require.cache[require.resolve('./yazma-kapisi')]), false);
    assert.equal(yazmaKapisi({ zipYolu: zip, setListesi: LISTE3 }).gecti, true, 'varsayılan listeleyici = unzip');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('zip: __MACOSX/._*/.DS_Store yok sayılır; sarmalayıcı klasör tolere edilir', () => {
  const liste = [
    '__MACOSX/', '__MACOSX/sar/._index.html', 'sar/', 'sar/.DS_Store', 'sar/book1/._x',
    'sar/book1/assets/5/data/BookContent.xml', 'sar/book1/assets/5/pages/1.png', 'sar/book1/assets/5/thumbs/1.jpg',
    'sar/electron.js',
  ];
  const r = yazmaKapisi({ zipYolu: 'sahte.zip', setListesi: '5|Bir', listele: () => liste });
  assert.equal(r.gecti, true, r.nedenler.join('|'));
  assert.deepEqual(r.kitaplar, [{ n: 1, id: '5', icerik: true, kapak: true }]);
});

test('2 GiB üstü seyrek zip: unzip -Z1 listeler, boyut stat edilir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yazma-kapisi-seyrek-'));
  const yol = path.join(dir, 'build.zip');
  const girisler = [
    { ad: 'book1/assets/9/data/BookContent.xml', veri: Buffer.from('<b/>') },
    { ad: 'book1/assets/9/pages/1.jpg', boyut: IKI_GIB + 1024 * 1024 },
    { ad: 'book1/assets/9/thumbs/1.jpg', veri: Buffer.from('c') },
    { ad: 'electron.js', veri: Buffer.from('require("electron");') },
  ];
  const fd = fs.openSync(yol, 'w');
  let ofs = 0; const merkez = [];
  try {
    for (const g of girisler) {
      const ad = Buffer.from(g.ad); const b = g.veri ? g.veri.length : g.boyut;
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(10, 4); h.writeUInt16LE(0x800, 6);
      h.writeUInt32LE(b, 18); h.writeUInt32LE(b, 22); h.writeUInt16LE(ad.length, 26);
      fs.writeSync(fd, h, 0, 30, ofs); fs.writeSync(fd, ad, 0, ad.length, ofs + 30);
      if (g.veri) fs.writeSync(fd, g.veri, 0, g.veri.length, ofs + 30 + ad.length);
      merkez.push({ ad, b, ofs }); ofs += 30 + ad.length + b;
    }
    const cd = ofs;
    for (const m of merkez) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(10, 6); c.writeUInt16LE(0x800, 8);
      c.writeUInt32LE(m.b, 20); c.writeUInt32LE(m.b, 24); c.writeUInt16LE(m.ad.length, 28); c.writeUInt32LE(m.ofs, 42);
      fs.writeSync(fd, c, 0, 46, ofs); fs.writeSync(fd, m.ad, 0, m.ad.length, ofs + 46); ofs += 46 + m.ad.length;
    }
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(merkez.length, 8); e.writeUInt16LE(merkez.length, 10);
    e.writeUInt32LE(ofs - cd, 12); e.writeUInt32LE(cd, 16); fs.writeSync(fd, e, 0, 22, ofs);
  } finally { fs.closeSync(fd); }
  try {
    assert.ok(fs.statSync(yol).size > IKI_GIB);
    const r = yazmaKapisi({ zipYolu: yol, setListesi: '9|Bir', oncekiBoyut: 100, tur: 'otomatik' });
    assert.equal(r.gecti, true, r.nedenler.join('|'));
    assert.deepEqual(r.kitaplar, [{ n: 1, id: '9', icerik: true, kapak: true }]);
    assert.equal(yazmaKapisi({ zipYolu: yol, setListesi: '9|Bir', oncekiBoyut: 4 * IKI_GIB }).gecti, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- 02.10 45549: liste dışı İmpark-dışı ek (kimlik "0") korunur; kapı sayı değil kimlik eşler ---

const kitapGirisleri = (n, id) => [
  `book${n}/assets/${id}/data/BookContent.xml`, `book${n}/assets/${id}/pages/1.png`, `book${n}/assets/${id}/thumbs/1.jpg`,
];
const LISTE4 = '101|Bir\n102|Iki\n103|Uc\n104|Dort';
const build4 = () => ['electron.js', ...[101, 102, 103, 104].flatMap((id, i) => kitapGirisleri(i + 1, id))];

test('45549 benzeri: 4 liste kimliği + book5 kimliği "0" → GEÇER, not düşer, ek sunucuya gitmez', () => {
  const r = yazmaKapisi({ zipYolu: 'sahte.zip', setListesi: LISTE4, listele: () => [...build4(), ...kitapGirisleri(5, 0)] });
  assert.equal(r.gecti, true, r.nedenler.join('|'));
  assert.deepEqual(r.notlar, ['liste dışı ek korundu: book5']);
  assert.deepEqual(r.kitaplar.map((k) => k.id), ['101', '102', '103', '104']);
  assert.deepEqual(r.nedenKodlari, []);
});

test('liste dışı ek içerik/kapaksız bile olsa (kimlik İmpark değil) korunur; boş/harfli kimlik de ek', () => {
  const ek = ['book5/assets/0/x.txt', 'book6/assets/abc/x.txt', 'book7/index.html'];
  const r = yazmaKapisi({ zipYolu: 'sahte.zip', setListesi: LISTE4, listele: () => [...build4(), ...ek] });
  assert.equal(r.gecti, true, r.nedenler.join('|'));
  assert.deepEqual(r.notlar, ['liste dışı ek korundu: book5', 'liste dışı ek korundu: book6', 'liste dışı ek korundu: book7']);
});

test('fazla İmpark kimlikli bookN → RED liste-disi-kitap', () => {
  const r = yazmaKapisi({ zipYolu: 'sahte.zip', setListesi: LISTE4, listele: () => [...build4(), ...kitapGirisleri(5, 999)] });
  assert.equal(r.gecti, false);
  assert.deepEqual(r.nedenKodlari, ['liste-disi-kitap']);
  assert.ok(r.nedenler.some((n) => /book5 kimliği 999 listede yok/.test(n)), r.nedenler.join('|'));
});

test('listede olup build\'de olmayan kimlik → RED kitap-eksik', () => {
  const eksik = build4().filter((y) => !y.startsWith('book3/'));
  const r = yazmaKapisi({ zipYolu: 'sahte.zip', setListesi: LISTE4, listele: () => eksik });
  assert.equal(r.gecti, false);
  assert.deepEqual(r.nedenKodlari, ['kitap-eksik']);
  assert.ok(r.nedenler.some((n) => /liste kimliği 103 build'de yok/.test(n)));
});

test('liste kimliği build\'de var ama içerik/kapak yok → RED (liste kitabı denetlenir)', () => {
  const g = build4().filter((y) => y !== 'book2/assets/102/thumbs/1.jpg');
  const r = yazmaKapisi({ zipYolu: 'sahte.zip', setListesi: LISTE4, listele: () => g });
  assert.equal(r.gecti, false);
  assert.deepEqual(r.nedenKodlari, ['kapak-yok']);
});

test('imparkKimligiMi merdivenin ölçütüyle aynı', () => {
  const { imparkKimligiMi } = require('./yazma-kapisi');
  const m = require('./icerik-merdiven').imparkKimligiMi;
  for (const v of ['0', '', null, undefined, 'abc', '12a', '00', '45549', '7', 0, 5]) {
    assert.equal(imparkKimligiMi(v), m(v), `kimlik ${JSON.stringify(v)}`);
  }
});

// --- 02.10 45550/45538/45695: kimlik dizin adı → ImWin32 kapak kimliği → menü assetId → ad ---
// Saha: `[yazma-kapisi] kitap-eksik: liste kimliği 66903 build'de yok` (45550 Games, dizin
// `assets/Grade-6-Games`, kapak ID "0") ve 45538'de 6376 (İmpark kitabı, dizin `English-Up-5-Workbook`).

const ig = require('../runtime/icerik-guncelleme');

/** Motorun şifreli menüsü (merdiven testindeki biçim) — tek kapak. */
const imMenu = (id, v = 1) => ig.menuKodla('<?xml version="1.0" encoding="UTF-8"?>\n<main activation="false" '
  + `key="" version="1.0" type="1">\n<Group ID="0"><Tab ID="0">\n<cover guId="" ID="${id}" etkID="${id}" `
  + `source="assets/${id}/cover.png" corpID="60" URL="https://example.invalid/Uploads/ZKitapZipH/${id}-${v}.zip" `
  + `version="${v}"/>\n</Tab></Group>\n</main>`);

/** Üretim Masası menüsü: `settings.books` (yama + settings.json, ikisi aynı içerik). */
const menuDosyalari = (books) => {
  const ayar = JSON.stringify({ bookCount: Object.keys(books).length, books }, null, 2);
  return {
    'config/settings.json': ayar,
    'scripts/cevrimdisi-yama.js': `(function () {\n  "use strict";\n\n  window.__setSettings = ${ayar};\n})();\n`,
  };
};

/** Geçici build dizini: {göreli yol: içerik}; kitap(n, dizin) içerik+kapak+ImWin32 ekler. */
function buildKur(dosyalar) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'yazma-kapisi-webz-'));
  for (const [y, v] of Object.entries({ 'electron.js': 'require("electron");', ...dosyalar })) {
    fs.mkdirSync(path.dirname(path.join(kok, y)), { recursive: true });
    fs.writeFileSync(path.join(kok, y), v);
  }
  return kok;
}
const kitap = (n, dizin, kapakId = dizin, { bc = '<BookContent/>' } = {}) => ({
  [`book${n}/assets/${dizin}/data/BookContent.xml`]: bc,
  [`book${n}/assets/${dizin}/pages/1.png`]: 'p',
  [`book${n}/assets/${dizin}/thumbs/1.jpg`]: 't',
  [`book${n}/classlibraries/ImWin32.dll`]: imMenu(kapakId),
  [`book${n}/app.config.js`]: `const AppConfig = { appName: 'book${n}' };`,
});

const SW6_LISTE = '25776 | Reference Book | \n25786 | Workbook | \n16030 | Test Book | \n25814 | Key Words | \n'
  + '66903 | Games |  | games\nlink:https://download.ydspublishing.com/worksheets/grade-6-worksheets/ | Worksheet';
const sw6 = (ek = {}) => ({
  ...kitap(1, 25776), ...kitap(2, 25786), ...kitap(3, 25814), ...kitap(4, 16030),
  ...kitap(5, 'Grade-6-Games', 0),
  ...menuDosyalari({
    book1: { assetId: '25776', title: 'Reference Book' }, book2: { assetId: '25786', title: 'Workbook' },
    book3: { assetId: '25814', title: 'Key Words' }, book4: { assetId: '16030', title: 'Test Book' },
    book5: { assetId: '66903', title: 'Games' },
  }),
  ...ek,
});

test('45550 regresyon: Games book5 (dizin Grade-6-Games, kapak ID "0") ↔ liste 66903 menü assetId ile → GEÇER (dizin + zip)', () => {
  const kok = buildKur(sw6());
  const zipDir = ziple(kok);
  try {
    for (const g of [{ buildDizini: kok }, { zipYolu: zipDir.zip }]) {
      const r = yazmaKapisi({ ...g, setListesi: SW6_LISTE, tur: 'otomatik' });
      assert.equal(r.gecti, true, r.nedenler.join('|'));
      assert.deepEqual(r.kitaplar.map((k) => k.id), ['25776', '25786', '25814', '16030']);
      assert.deepEqual(r.webzVarliklari, [{ n: 5, id: '66903', yol: 'config', icerik: true, kapak: true }]);
      assert.ok(r.notlar.some((n) => /Web-Z varlığı kabul: book5 ← liste 66903 \(menü assetId; dizin Grade-6-Games\)/.test(n)), r.notlar.join('|'));
      assert.equal(r.notlar.some((n) => /liste dışı ek korundu: book5/.test(n)), false);
    }
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
    fs.rmSync(zipDir.dir, { recursive: true, force: true });
  }
});

test('45550 + gerçek eksik İmpark kitabı (69523) → Games kabul ama 69523 yine RED kitap-eksik', () => {
  const kok = buildKur(sw6());
  try {
    const r = yazmaKapisi({ buildDizini: kok, setListesi: `${SW6_LISTE}\n69523 | Practice Book`, tur: 'otomatik' });
    assert.equal(r.gecti, false);
    assert.deepEqual(r.nedenKodlari, ['kitap-eksik']);
    assert.ok(r.nedenler.some((n) => /liste kimliği 69523 build'de yok/.test(n)), r.nedenler.join('|'));
    assert.equal(r.nedenler.some((n) => /66903/.test(n)), false, r.nedenler.join('|'));
    assert.deepEqual(r.webzVarliklari.map((w) => w.id), ['66903']);
  } finally { fs.rmSync(kok, { recursive: true, force: true }); }
});

test('Web-Z adayı olsa da menüsü ve adı tutmayan liste kimliği eşlenmez → RED kitap-eksik (yanlış kabul yok)', () => {
  const kok = buildKur(sw6(menuDosyalari({
    book1: { assetId: '25776', title: 'Reference Book' }, book2: { assetId: '25786', title: 'Workbook' },
    book3: { assetId: '25814', title: 'Key Words' }, book4: { assetId: '16030', title: 'Test Book' },
    book5: { assetId: 'Grade-6-Games', title: 'Oyunlar' },
  })));
  try {
    const r = yazmaKapisi({ buildDizini: kok, setListesi: SW6_LISTE, tur: 'otomatik' });
    assert.equal(r.gecti, false);
    assert.deepEqual(r.nedenKodlari, ['kitap-eksik']);
    assert.ok(r.nedenler.some((n) => /liste kimliği 66903 build'de yok/.test(n)));
    assert.deepEqual(r.webzVarliklari, []);
    assert.ok(r.notlar.includes('liste dışı ek korundu: book5'), r.notlar.join('|'));
  } finally { fs.rmSync(kok, { recursive: true, force: true }); }
});

test('45482 benzeri: menü assetId İmpark değil ("Grade-8-Games") → set eki ile AYNI ad eşlemesi (yol ad)', () => {
  const kok = buildKur({
    ...kitap(1, 44187), ...kitap(2, 'Grade-8-Games', 0),
    ...menuDosyalari({ book1: { assetId: '44187', title: 'Reference Book' }, book2: { assetId: 'Grade-8-Games', title: 'Games' } }),
  });
  try {
    const r = yazmaKapisi({ buildDizini: kok, setListesi: '44187 | Reference Book\n66905 | Games', tur: 'otomatik' });
    assert.equal(r.gecti, true, r.nedenler.join('|'));
    assert.deepEqual(r.webzVarliklari, [{ n: 2, id: '66905', yol: 'ad', icerik: true, kapak: true }]);
    assert.ok(r.notlar.some((n) => /book2 ← liste 66905 \(ad "Games"/.test(n)), r.notlar.join('|'));
  } finally { fs.rmSync(kok, { recursive: true, force: true }); }
});

test('45538 regresyon: İmpark kitabı dizini adlı (English-Up-5-Workbook) → kimlik ImWin32 kapak ID 6376, kitaplar\'a girer (vs merdivenden)', () => {
  const kok = buildKur({
    ...kitap(1, 44815), ...kitap(2, 'English-Up-5-Workbook', 6376), ...kitap(3, 'Grade-5-Games', 0), ...kitap(4, 'Eu5-videos', 0),
    ...menuDosyalari({
      book1: { assetId: '44815', title: "Student's Book" }, book2: { assetId: '6376', title: 'Workbook' },
      book3: { assetId: '66862', title: 'Games' }, book4: { assetId: '66850', title: 'Videos' },
    }),
  });
  const zipDir = ziple(kok);
  try {
    const liste = "44815 | Student's Book\n6376 | Workbook\n66862 | Games |  | games\n66850 | Videos |  | videos\n"
      + 'link:https://download.ydspublishing.com/worksheets/grade-5-worksheets/ | Worksheets';
    for (const g of [{ buildDizini: kok }, { zipYolu: zipDir.zip }]) {
      const r = yazmaKapisi({ ...g, setListesi: liste, vsler: { 1: 4, 2: 3 }, tur: 'otomatik' });
      assert.equal(r.gecti, true, r.nedenler.join('|'));
      assert.deepEqual(r.kitaplar, [
        { n: 1, id: '44815', vs: 4, icerik: true, kapak: true },
        { n: 2, id: '6376', vs: 3, icerik: true, kapak: true },
      ]);
      assert.deepEqual(r.webzVarliklari.map((w) => [w.n, w.id, w.yol]), [[3, '66862', 'config'], [4, '66850', 'config']]);
      assert.ok(r.notlar.includes('kimlik ImWin32 menüsünden: book2 = 6376 (dizin English-Up-5-Workbook)'), r.notlar.join('|'));
    }
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
    fs.rmSync(zipDir.dir, { recursive: true, force: true });
  }
});

test('ImWin32 kimliği İmpark ve listede YOK → RED liste-disi-kitap (sözleşme §5: liste dışı İmpark kimliği ret)', () => {
  const kok = buildKur({ ...kitap(1, 101), ...kitap(2, 'Adli-Kitap', 777) });
  try {
    const r = yazmaKapisi({ buildDizini: kok, setListesi: '101 | Bir', tur: 'otomatik' });
    assert.equal(r.gecti, false);
    assert.deepEqual(r.nedenKodlari, ['liste-disi-kitap']);
    assert.ok(r.nedenler.some((n) => /book2 kimliği 777 listede yok/.test(n)), r.nedenler.join('|'));
  } finally { fs.rmSync(kok, { recursive: true, force: true }); }
});

test('Web-Z varlığının BookContent.xml\'i boş (0 bayt) → RED icerik-yok; kapak beklenmez', () => {
  const kok = buildKur(sw6({ 'book5/assets/Grade-6-Games/data/BookContent.xml': '' }));
  try {
    const r = yazmaKapisi({ buildDizini: kok, setListesi: SW6_LISTE, tur: 'otomatik' });
    assert.equal(r.gecti, false);
    assert.deepEqual(r.nedenKodlari, ['icerik-yok']);
    assert.ok(r.nedenler.some((n) => /book5: Web-Z varlığı 66903 içerik yok/.test(n)), r.nedenler.join('|'));
    assert.deepEqual(r.webzVarliklari, [{ n: 5, id: '66903', yol: 'config', icerik: false, kapak: true }]);
  } finally { fs.rmSync(kok, { recursive: true, force: true }); }
  const kapaksiz = buildKur(sw6());
  try {
    fs.rmSync(path.join(kapaksiz, 'book5/assets/Grade-6-Games/thumbs'), { recursive: true });
    const r = yazmaKapisi({ buildDizini: kapaksiz, setListesi: SW6_LISTE, tur: 'otomatik' });
    assert.equal(r.gecti, true, r.nedenler.join('|'));
    assert.equal(r.webzVarliklari[0].kapak, false);
  } finally { fs.rmSync(kapaksiz, { recursive: true, force: true }); }
});

test('menü okunamazsa (okuyucu null döner) Web-Z eşlemesi yapılmaz → bugünkü davranış (kitap-eksik)', () => {
  const r = yazmaKapisi({
    zipYolu: 'sahte.zip', setListesi: `${LISTE4}\n66903 | Games`,
    listele: () => [...build4(), ...kitapGirisleri(5, 'Grade-6-Games')],
    okuyucu: { veri: () => null, boyut: () => null },
  });
  assert.equal(r.gecti, false);
  assert.deepEqual(r.nedenKodlari, ['kitap-eksik']);
  assert.deepEqual(r.webzVarliklari, []);
});

// --- 03.10 saha 74430/59480: kökte Electron girişi yoksa paketleyici yedek şablona düşer → RED ---

test('Electron giriş dosyası yoksa RED giris-yok; main.js / electron.js / package.json main yeterli', () => {
  const temel = ['book1/assets/5/data/BookContent.xml', 'book1/assets/5/pages/1.png', 'book1/assets/5/thumbs/1.jpg'];
  const kos = (ek, okuyucu = null) => yazmaKapisi({ zipYolu: 'sahte.zip', setListesi: '5|Bir', listele: () => [...temel, ...ek],
    ...(okuyucu ? { okuyucu } : {}) });
  const yok = kos(['index.html', 'electronUpdate.js']);
  assert.equal(yok.gecti, false);
  assert.deepEqual(yok.nedenKodlari, ['giris-yok']);
  assert.match(yok.nedenler.join('|'), /Electron giriş dosyası yok/);
  for (const g of ['main.js', 'electron.js']) assert.equal(kos([g]).gecti, true, g);
  const pj = (main) => ({ veri: (y) => (y === 'package.json' ? Buffer.from(JSON.stringify({ main })) : null), boyut: () => 1 });
  assert.equal(kos(['package.json', 'app/giris.js'], pj('./app/giris.js')).gecti, true, 'package.json main → var olan dosya');
  assert.deepEqual(kos(['package.json'], pj('yok.js')).nedenKodlari, ['giris-yok'], 'main gösterdiği dosya yoksa RED');
  assert.deepEqual(kos(['book1/electron.js']).nedenKodlari, ['giris-yok'], 'bookN içindeki giriş kökü kurtarmaz');
});
