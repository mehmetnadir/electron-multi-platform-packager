'use strict';
/**
 * MENÜ KAPAK GARANTİSİ testleri (2026-10-06, 59835). Fixture = Windows exe 2.51.2 menüsünün biçimi:
 * üç kitap thumbs kapaklı, iki link coverUrl'süz, images/book1.png yok. Panel listesi satırı
 * `link:<url> | ad | data:image/jpeg;base64,…` (DB proxy_asset_id biçimi). Ağ YOK (getir sahte).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const G = require('./menu-kapak-garanti');
const M = require('./icerik-merdiven');
const K = require('../../tools/kabul/menu-kapak');

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]);
const JPG2 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.alloc(2500, 9)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2000, 3)]);
const TP = 'https://download.ydspublishing.com/download/1268/tp.pdf';
const WS = 'https://download.ydspublishing.com/worksheets/grade-2/';

function ayarlar({ thumbs3 = true } = {}) {
  return {
    bookCount: 5,
    setTitle: 'Super Monsters 2 Set',
    books: {
      book1: { assetId: '58336', contentType: 'book', coverUrl: 'book1/assets/58336/thumbs/1.jpg', displayOrder: 0, title: "Student's Book" },
      book2: { assetId: '73456', contentType: 'book', coverUrl: 'book2/assets/73456/thumbs/1.jpg', displayOrder: 1, title: 'Activity Book' },
      book3: { assetId: '58237', contentType: 'book', ...(thumbs3 ? { coverUrl: 'book3/assets/58237/thumbs/1.jpg' } : {}), displayOrder: 2, title: 'Skills & Test Book' },
      link4: { contentType: 'link', displayOrder: 3, title: "Teacher's Pack", type: 'link', url: TP },
      link5: { contentType: 'link', displayOrder: 4, title: 'Worksheets', type: 'link', url: WS },
    },
  };
}

function zipKur({ a = ayarlar(), ek = {}, haric = [] } = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-kapak-g-'));
  const dizin = path.join(kok, 'build');
  const yaz = (rel, v) => {
    if (haric.includes(rel)) return;
    fs.mkdirSync(path.dirname(path.join(dizin, rel)), { recursive: true });
    fs.writeFileSync(path.join(dizin, rel), v);
  };
  yaz('index.html', '<html></html>');
  yaz('config/settings.json', JSON.stringify(a, null, 2));
  yaz('scripts/cevrimdisi-yama.js', `/* yama */\n(function () {\n  window.__setSettings = ${JSON.stringify(a, null, 2)};\n`
    + '  var b = window.__setSettings.books; /* { süslü } */\n})();\n');
  yaz('images/bg.jpg', JPG);
  yaz('book1/assets/58336/thumbs/1.jpg', JPG);
  yaz('book2/assets/73456/thumbs/1.jpg', JPG);
  yaz('book3/assets/58237/thumbs/1.jpg', JPG);
  for (const [rel, v] of Object.entries(ek)) yaz(rel, v);
  const zip = path.join(kok, 'build.zip');
  const r = spawnSync('zip', ['-q', '-r', '-X', zip, '.'], { cwd: dizin });
  assert.equal(r.status, 0, String(r.stderr));
  return { zip, calisma: kok };
}

const liste = (tpKapak = `data:image/jpeg;base64,${JPG2.toString('base64')}`) => [
  "58336 | Student's Book | ", '73456 | Activity Book', '58237 | Skills & Test Book | ',
  `link:${TP} | Teacher's Pack | ${tpKapak}`, `link:${WS} | Worksheets`,
].join('\\n'); // DB metni kaçışlı \n taşır

const agYok = async (url) => { throw new Error(`ağ yasak: ${url}`); };

function zipOlc(zip) {
  const d = M.zipDizini(zip);
  return K.menuKapakOlc(G.zipOkuyucu(zip, d, ''));
}

test('önce: 59835 kalıbı kabul ölçütünde RED (iki link kartı kırık)', () => {
  const { zip } = zipKur();
  const s = zipOlc(zip);
  assert.equal(s.durum, K.DURUM.RED);
  assert.deepEqual([...new Set(s.kartlar.filter((k) => k.sorun).map((k) => k.anahtar))].sort(), ['link4', 'link5']);
});

test('onarım: Teacher\'s Pack panel listesinden, Worksheets ilk kitap kapağı (UYARI) → kabul GEÇTİ', async () => {
  const { zip, calisma } = zipKur();
  const once = M.zipDizini(zip);
  const uyarilar = [];
  const r = await G.menuKapakGaranti({ zip, calisma, setListesi: liste(), getir: agYok, warn: (m) => uyarilar.push(m) });
  assert.equal(r.durum, 'uygulandi');
  const k = Object.fromEntries(r.kartlar.map((x) => [x.anahtar, x]));
  assert.equal(k.link4.kaynak, 'panel-listesi');
  assert.equal(k.link4.yol, 'images/kapak-link4.jpg');
  assert.equal(k.link5.kaynak, 'ilk-kitap-kapagi');
  assert.ok(uyarilar.some((u) => /link5 .*ilk kitabın kapağı/.test(u)), 'yedek kapak UYARI yazmalı (sessiz düşme yok)');
  assert.equal(zipOlc(zip).durum, K.DURUM.GECTI);
  // Panel listesindeki bayt aynen pakette.
  const d = M.zipDizini(zip);
  assert.ok(M.zipGirdiOku(zip, d.get('images/kapak-link4.jpg')).equals(JPG2));
  // Yazılmayan her girdi aynı (crc + boyut); yalnız iki kapak eklendi, iki menü dosyası değişti.
  const yeni = [...d.keys()].filter((a) => !once.has(a)).sort();
  assert.deepEqual(yeni, ['images/kapak-link4.jpg', 'images/kapak-link5.jpg']);
  for (const [ad, g] of once) {
    if (ad === 'config/settings.json' || ad === 'scripts/cevrimdisi-yama.js') continue;
    assert.equal(d.get(ad).crc, g.crc, ad);
  }
  // Yama hâlâ tek atamalı ve kodun geri kalanı korunmuş.
  const yama = M.zipGirdiOku(zip, d.get('scripts/cevrimdisi-yama.js')).toString('utf8');
  assert.match(yama, /var b = window\.__setSettings\.books; \/\* \{ süslü \} \*\//);
  assert.equal(K.yamaAyarlari(yama).books.link4.coverUrl, 'images/kapak-link4.jpg');
});

test('Web-Z kaynağı: listede kapak yoksa Web-Z settings.json coverUrl alınır', async () => {
  const { zip, calisma } = zipKur();
  const istekler = [];
  const getir = async (url) => {
    istekler.push(url);
    if (url.endsWith('/go/k08ou/web-stream/config/settings.json')) {
      const w = ayarlar();
      w.books.link5.coverUrl = `data:image/png;base64,${PNG.toString('base64')}`;
      return { status: 200, govde: Buffer.from(JSON.stringify(w)) };
    }
    return { status: 404, govde: Buffer.from('Not Found') };
  };
  const r = await G.menuKapakGaranti({ zip, calisma, setListesi: liste(), kisaKod: 'k08ou', getir });
  const k5 = r.kartlar.find((x) => x.anahtar === 'link5');
  assert.equal(k5.kaynak, 'webz');
  assert.equal(k5.yol, 'images/kapak-link5.png');
  assert.equal(istekler.length, 1);
  assert.equal(zipOlc(zip).durum, K.DURUM.GECTI);
});

test('kitap: thumbs yok → ilk sayfa (UYARI); o da yoksa yer tutucu SVG (UYARI), kabul GEÇTİ + uyarı', async () => {
  const a = ayarlar();
  a.books.book2.coverUrl = 'images/book2.png'; // pakette yok
  a.books.book3.coverUrl = 'images/book3.png'; // pakette yok
  const { zip, calisma } = zipKur({
    a,
    ek: { 'book2/assets/73456/pages/1.png': PNG },
    haric: ['book2/assets/73456/thumbs/1.jpg', 'book3/assets/58237/thumbs/1.jpg'],
  });
  const uyarilar = [];
  const r = await G.menuKapakGaranti({ zip, calisma, setListesi: liste(), getir: agYok, warn: (m) => uyarilar.push(m) });
  const k = Object.fromEntries(r.kartlar.map((x) => [x.anahtar, x]));
  assert.equal(k.book2.kaynak, 'ilk-sayfa');
  assert.equal(k.book3.kaynak, 'yer-tutucu');
  assert.equal(k.book3.yol, 'images/kapak-book3.svg');
  assert.ok(uyarilar.some((u) => /book3 .*YER TUTUCU/.test(u)));
  const s = zipOlc(zip);
  assert.equal(s.durum, K.DURUM.GECTI);
  assert.ok(s.uyarilar.some((u) => /book3/.test(u)));
});

test('kapakları tam paket: gerek-yok, zip bayt bayt aynı', async () => {
  const a = ayarlar();
  a.books.link4.coverUrl = 'images/kapak-link4.jpg';
  a.books.link5.coverUrl = 'images/kapak-link5.jpg';
  const { zip, calisma } = zipKur({ a, ek: { 'images/kapak-link4.jpg': JPG, 'images/kapak-link5.jpg': JPG } });
  const once = fs.readFileSync(zip);
  const r = await G.menuKapakGaranti({ zip, calisma, setListesi: liste(), getir: agYok });
  assert.equal(r.durum, 'gerek-yok');
  assert.ok(fs.readFileSync(zip).equals(once));
});

test('Z2 kabuğu (images/book1.png var): link yedekle çalışıyor; listede kendi kapağı varsa o konur', async () => {
  const { zip, calisma } = zipKur({ ek: { 'images/book1.png': JPG } });
  assert.equal(zipOlc(zip).durum, K.DURUM.GECTI);
  const r = await G.menuKapakGaranti({ zip, calisma, setListesi: liste(), getir: agYok });
  assert.equal(r.durum, 'uygulandi');
  assert.deepEqual(r.kartlar.map((x) => x.anahtar), ['link4']); // link5'in kendi kapağı yok → dokunulmaz
  assert.equal(zipOlc(zip).durum, K.DURUM.GECTI);
});

test('set olmayan paket: atlandi, zip aynı', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-kapak-tek-'));
  fs.writeFileSync(path.join(kok, 'index.html'), '<html></html>');
  const zip = path.join(kok, 'b.zip');
  spawnSync('zip', ['-q', '-X', zip, 'index.html'], { cwd: kok });
  const r = await G.menuKapakGaranti({ zip, calisma: kok, getir: agYok });
  assert.equal(r.durum, 'atlandi');
});

test('zip yazılamazsa hata FIRLATILIR ve iş kopyası değişmez', async () => {
  const { zip, calisma } = zipKur();
  const once = fs.readFileSync(zip);
  await assert.rejects(
    G.menuKapakGaranti({ zip, calisma, setListesi: liste(), getir: agYok, komut: async () => ({ code: 12, stderr: 'disk dolu' }) }),
    /zip yazılamadı/,
  );
  assert.ok(fs.readFileSync(zip).equals(once));
});

test('aday kapısı: yazılan dışında girdi değişirse RED, iş kopyası değişmez', async () => {
  const { zip, calisma } = zipKur();
  const once = fs.readFileSync(zip);
  // Gerçek zip yazımı + araya sızan yabancı girdi (başka adımın yarışı / hatalı komut).
  const komut = async (cmd, args, o) => {
    const r = await M.komut(cmd, args, o);
    fs.writeFileSync(path.join(o.cwd, 'index.html'), '<html>bozuldu</html>');
    const aday = args.find((a) => a.endsWith('.menu-kapak-aday'));
    await M.komut('zip', ['-q', '-X', aday, 'index.html'], o);
    return r;
  };
  await assert.rejects(
    G.menuKapakGaranti({ zip, calisma, setListesi: liste(), getir: agYok, komut }),
    /kapı RED .*değişti\/silindi: index\.html/,
  );
  assert.ok(fs.readFileSync(zip).equals(once));
});

test('listedenLinkKapagi: adres, sonra ad eşleşir; görsel olmayan alan yok sayılır', () => {
  assert.match(G.listedenLinkKapagi(liste(), { url: TP }), /^data:image\/jpeg/);
  assert.match(G.listedenLinkKapagi(liste(), { url: 'x', baslik: "teacher's pack" }), /^data:image/);
  assert.equal(G.listedenLinkKapagi(liste(), { url: WS }), null);
  assert.equal(G.listedenLinkKapagi(`link:${TP} | TP | düz metin`, { url: TP }), null);
});

test('gorselUzantisi: jpg/png/svg tanınır, 404 gövdesi tanınmaz', () => {
  assert.equal(G.gorselUzantisi(JPG), 'jpg');
  assert.equal(G.gorselUzantisi(PNG), 'png');
  assert.equal(G.gorselUzantisi(G.yerTutucuSvg('Worksheets', 'Set')), 'svg');
  assert.equal(G.gorselUzantisi(Buffer.from('Not Found')), null);
  assert.ok(G.yerTutucuSvg('A', '').length > K.KAPAK_ALT_SINIR);
});
