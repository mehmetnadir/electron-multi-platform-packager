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
const build4 = () => [101, 102, 103, 104].flatMap((id, i) => kitapGirisleri(i + 1, id));

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
