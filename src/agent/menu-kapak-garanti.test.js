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

// Varsayılan gömme kipi (link) ölçülür; kabuktan sızan değer testi değiştirmesin.
delete process.env.EMPP_MENU_KAPAK_GOMME;

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

test('kapali kip (eski davranış) onarım: Teacher\'s Pack panel listesinden, Worksheets ilk kitap kapağı (UYARI) → kabul GEÇTİ', async () => {
  const { zip, calisma } = zipKur();
  const once = M.zipDizini(zip);
  const uyarilar = [];
  const r = await G.menuKapakGaranti({ zip, calisma, setListesi: liste(), getir: agYok, warn: (m) => uyarilar.push(m), gommeKip: 'kapali' });
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

test('kapali kip Web-Z kaynağı: listede kapak yoksa Web-Z settings.json coverUrl alınır', async () => {
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
  const r = await G.menuKapakGaranti({ zip, calisma, setListesi: liste(), kisaKod: 'k08ou', getir, gommeKip: 'kapali' });
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

/** r2-al kalıbı: link kartları zaten coverUrl'lü, dosyalar pakette (önceki garanti koşusu). */
function tamPaket({ link4 = JPG2, link4Url = 'images/kapak-link4.jpg' } = {}) {
  const a = ayarlar();
  a.books.link4.coverUrl = link4Url;
  a.books.link5.coverUrl = 'images/kapak-link5.jpg';
  const ek = { 'images/kapak-link5.jpg': JPG };
  if (!/^data:/.test(link4Url)) ek[link4Url] = link4;
  return zipKur({ a, ek });
}

test('A kapali kip: liste kapağı paketteki ile aynı (sha256) → gerek-yok, zip bayt bayt aynı', async () => {
  const { zip, calisma } = tamPaket();
  const once = fs.readFileSync(zip);
  const loglar = [];
  const r = await G.menuKapakGaranti({ zip, calisma, setListesi: liste(), getir: agYok, gommeKip: 'kapali', log: (m) => loglar.push(m) });
  assert.equal(r.durum, 'gerek-yok');
  assert.ok(fs.readFileSync(zip).equals(once));
  assert.ok(loglar.some((m) => /link4 .*aynı \(sha256\)/.test(m)));
});

test('A kapali kip: r2-al build\'inde coverUrl\'lü link, panel listesi kapağı değişmiş → yenilenir', async () => {
  const { zip, calisma } = tamPaket({ link4: JPG }); // pakette eski kapak (JPG), listede yeni (JPG2)
  const once = M.zipDizini(zip);
  const r = await G.menuKapakGaranti({ zip, calisma, setListesi: liste(), getir: agYok, gommeKip: 'kapali' });
  assert.equal(r.durum, 'uygulandi');
  assert.deepEqual(r.kartlar.map((x) => [x.anahtar, x.kaynak, x.yol]), [['link4', 'panel-listesi', 'images/kapak-link4.jpg']]);
  const d = M.zipDizini(zip);
  assert.ok(M.zipGirdiOku(zip, d.get('images/kapak-link4.jpg')).equals(JPG2), 'eski kapak yerine liste kapağı');
  // link5 (listede kapağı yok) ve kitap kapakları dokunulmadı.
  for (const ad of ['images/kapak-link5.jpg', 'book1/assets/58336/thumbs/1.jpg']) assert.equal(d.get(ad).crc, once.get(ad).crc, ad);
  assert.equal(zipOlc(zip).durum, K.DURUM.GECTI);
});

test('A: liste kapağı https ise indirilir; indirilen bayt aynıysa dokunulmaz, farklıysa yenilenir', async () => {
  const url = 'https://cdn.ornek.test/tp.jpg';
  const getirB = (b) => async (u) => (u === url ? { status: 200, govde: b } : { status: 404, govde: Buffer.alloc(0) });
  const ayni = tamPaket();
  const once = fs.readFileSync(ayni.zip);
  const r1 = await G.menuKapakGaranti({ ...ayni, setListesi: liste(url), getir: getirB(JPG2), gommeKip: 'kapali' });
  assert.equal(r1.durum, 'gerek-yok');
  assert.ok(fs.readFileSync(ayni.zip).equals(once));
  const farkli = tamPaket();
  const r2 = await G.menuKapakGaranti({ ...farkli, setListesi: liste(url), getir: getirB(PNG), gommeKip: 'kapali' });
  assert.equal(r2.durum, 'uygulandi');
  assert.equal(r2.kartlar[0].yol, 'images/kapak-link4.png');
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

// ── B: GÖMME KİPİ (EMPP_MENU_KAPAK_GOMME) ─────────────────────────────────────────────────────────

/** Zip'teki iki menü dosyasının books'u (yama + settings.json). */
function menuBooks(zip) {
  const d = M.zipDizini(zip);
  const yama = M.zipGirdiOku(zip, d.get('scripts/cevrimdisi-yama.js')).toString('utf8');
  const ayar = JSON.parse(M.zipGirdiOku(zip, d.get('config/settings.json')).toString('utf8'));
  return { yama: K.yamaAyarlari(yama).books, ayar: ayar.books, yamaMetni: yama, d };
}

test('B link kipi (varsayılan): link kapakları iki menü dosyasına data: gömülür, books eşit, kitaplar değişmez', async () => {
  const { zip, calisma } = zipKur();
  const once = M.zipDizini(zip);
  const r = await G.menuKapakGaranti({ zip, calisma, setListesi: liste(), getir: agYok });
  assert.equal(r.durum, 'uygulandi');
  assert.equal(r.gommeKip, 'link');
  const { yama, ayar, yamaMetni, d } = menuBooks(zip);
  assert.deepEqual(yama, ayar, 'yama ve settings.json books alanı EŞİT (tools/g-yayin/menu.js ayrışma RED eder)');
  assert.equal(yama.link4.coverUrl, `data:image/jpeg;base64,${JPG2.toString('base64')}`);
  assert.match(yama.link5.coverUrl, /^data:image\/jpeg;base64,/); // ilk kitap kapağı (UYARI) gömüldü
  assert.ok(G.dataCoz(yama.link5.coverUrl).equals(JPG));
  for (const k of ['book1', 'book2', 'book3']) assert.equal(yama[k].coverUrl, ayarlar().books[k].coverUrl, k);
  // images/ altına dosya EKLENMEDİ (G kurulu pakete images/ taşımaz); yalnız iki menü dosyası değişti.
  assert.deepEqual([...d.keys()].filter((a) => !once.has(a)), []);
  for (const [ad, g] of once) {
    if (ad === 'config/settings.json' || ad === 'scripts/cevrimdisi-yama.js') continue;
    assert.equal(d.get(ad).crc, g.crc, ad);
  }
  assert.match(yamaMetni, /var b = window\.__setSettings\.books;/);
  assert.ok(r.kartlar.every((x) => x.gomulu && x.yol === null));
  assert.equal(zipOlc(zip).durum, K.DURUM.GECTI);
  // İdempotent: ikinci koşu zip'e dokunmaz.
  const ara = fs.readFileSync(zip);
  const r2 = await G.menuKapakGaranti({ zip, calisma, setListesi: liste(), getir: agYok });
  assert.equal(r2.durum, 'gerek-yok');
  assert.ok(fs.readFileSync(zip).equals(ara));
});

test('B link kipi: önceki koşunun images/kapak-*.jpg dosya yolu data:\'ya çevrilir (G menüyle taşır)', async () => {
  const { zip, calisma } = tamPaket();
  const r = await G.menuKapakGaranti({ zip, calisma, setListesi: liste(), getir: agYok });
  assert.equal(r.durum, 'uygulandi');
  const { yama, ayar } = menuBooks(zip);
  assert.deepEqual(yama, ayar);
  assert.ok(G.dataCoz(yama.link4.coverUrl).equals(JPG2));
  const k5 = r.kartlar.find((x) => x.anahtar === 'link5');
  assert.equal(k5.kaynak, 'paket');
  assert.ok(G.dataCoz(yama.link5.coverUrl).equals(JPG));
});

test('A link kipi: gömülü kapak listeyle aynı → dokunulmaz; liste değişince data: yenilenir', async () => {
  const eski = `data:image/jpeg;base64,${JPG2.toString('base64')}`;
  const ayni = tamPaket({ link4Url: eski });
  // link5 de gömülü olsun ki tek değişken link4 kalsın.
  await G.menuKapakGaranti({ ...ayni, setListesi: liste(), getir: agYok });
  const once = fs.readFileSync(ayni.zip);
  const r1 = await G.menuKapakGaranti({ ...ayni, setListesi: liste(), getir: agYok });
  assert.equal(r1.durum, 'gerek-yok');
  assert.ok(fs.readFileSync(ayni.zip).equals(once));
  const yeni = `data:image/png;base64,${PNG.toString('base64')}`;
  const r2 = await G.menuKapakGaranti({ ...ayni, setListesi: liste(yeni), getir: agYok });
  assert.equal(r2.durum, 'uygulandi');
  const { yama, ayar } = menuBooks(ayni.zip);
  assert.deepEqual(yama, ayar);
  assert.equal(yama.link4.coverUrl, yeni);
});

test('B 200 KB: büyük liste kapağı sharp ile en uzun kenar 400 px JPEG q80\'e küçültülüp gömülür', async () => {
  // eslint-disable-next-line global-require
  const sharp = require('sharp');
  const n = 200;
  const ham = Buffer.alloc(n * n * 3);
  for (let i = 0; i < ham.length; i++) ham[i] = (i * 7919 + (i >> 5) * 104729) % 251; // belirlenimci doku
  const iri = await sharp(ham, { raw: { width: n, height: n, channels: 3 } }).resize(1200, 900, { kernel: 'cubic' }).jpeg({ quality: 95 }).toBuffer();
  assert.ok(iri.length > G.GOMME_TAVANI, `fixture > 200 KB olmalı (${iri.length})`);
  const { zip, calisma } = zipKur();
  const r = await G.menuKapakGaranti({ zip, calisma, setListesi: liste(`data:image/jpeg;base64,${iri.toString('base64')}`), getir: agYok });
  const k4 = r.kartlar.find((x) => x.anahtar === 'link4');
  assert.equal(k4.gomulu, true);
  assert.equal(k4.kucultuldu, true);
  const { yama, ayar } = menuBooks(zip);
  assert.deepEqual(yama, ayar);
  const gomulu = G.dataCoz(yama.link4.coverUrl);
  assert.match(yama.link4.coverUrl, /^data:image\/jpeg;base64,/);
  assert.ok(gomulu.length <= G.GOMME_TAVANI, `gömülü ${gomulu.length} bayt`);
  const md = await sharp(gomulu).metadata();
  assert.deepEqual([md.format, Math.max(md.width, md.height), md.width, md.height], ['jpeg', 400, 400, 300]);
  assert.equal(zipOlc(zip).durum, K.DURUM.GECTI);
  // Küçültme belirlenimci → ikinci koşu dokunmaz.
  const ara = fs.readFileSync(zip);
  const r2 = await G.menuKapakGaranti({ zip, calisma, setListesi: liste(`data:image/jpeg;base64,${iri.toString('base64')}`), getir: agYok });
  assert.equal(r2.durum, 'gerek-yok');
  assert.ok(fs.readFileSync(zip).equals(ara));
});

test('B 200 KB: küçültme sonrası hâlâ > 200 KB → gömülmez, dosya yolunda kalır, UYARI', async () => {
  const iri = Buffer.concat([PNG.slice(0, 8), Buffer.alloc(G.GOMME_TAVANI + 5000, 4)]);
  const cagri = [];
  const sahteSharp = (girdi) => {
    cagri.push(girdi.length);
    const z = {
      rotate: () => z, resize: (o) => { cagri.push(o); return z; }, flatten: () => z, jpeg: (o) => { cagri.push(o); return z; },
      toBuffer: async () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(G.GOMME_TAVANI + 10, 1)]),
    };
    return z;
  };
  const { zip, calisma } = zipKur();
  const uyarilar = [];
  const r = await G.menuKapakGaranti({
    zip, calisma, setListesi: liste(`data:image/png;base64,${iri.toString('base64')}`), getir: agYok, sharp: sahteSharp, warn: (m) => uyarilar.push(m),
  });
  assert.deepEqual(cagri.slice(1), [{ width: 400, height: 400, fit: 'inside', withoutEnlargement: true }, { quality: 80 }]);
  const k4 = r.kartlar.find((x) => x.anahtar === 'link4');
  assert.equal(k4.gomulu, false);
  assert.equal(k4.yol, 'images/kapak-link4.png');
  assert.ok(uyarilar.some((u) => /UYARI link4 .*> 200 KB — gömülmedi, dosya yolunda kaldı/.test(u)), uyarilar.join('\n'));
  const { yama, ayar, d } = menuBooks(zip);
  assert.deepEqual(yama, ayar);
  assert.equal(yama.link4.coverUrl, 'images/kapak-link4.png');
  assert.ok(M.zipGirdiOku(zip, d.get('images/kapak-link4.png')).equals(iri));
  assert.match(yama.link5.coverUrl, /^data:image\/jpeg;base64,/); // küçük kapak yine gömülür
  assert.equal(zipOlc(zip).durum, K.DURUM.GECTI);
});

test('B hepsi kipi: kitap kartları da gömülür; kapali kipte hiçbir coverUrl data: olmaz', async () => {
  const h = zipKur();
  await G.menuKapakGaranti({ ...h, setListesi: liste(), getir: agYok, gommeKip: 'hepsi' });
  const hb = menuBooks(h.zip);
  assert.deepEqual(hb.yama, hb.ayar);
  for (const k of ['book1', 'book2', 'book3', 'link4', 'link5']) assert.match(hb.yama[k].coverUrl, /^data:image\//, k);
  assert.equal(zipOlc(h.zip).durum, K.DURUM.GECTI);
  const kp = zipKur();
  await G.menuKapakGaranti({ ...kp, setListesi: liste(), getir: agYok, gommeKip: 'kapali' });
  const kb = menuBooks(kp.zip);
  assert.deepEqual(kb.yama, kb.ayar);
  assert.ok(Object.values(kb.yama).every((b) => !/^data:/.test(b.coverUrl || '')));
  assert.equal(kb.yama.link4.coverUrl, 'images/kapak-link4.jpg');
});

test('gommeKipi: link varsayılan; kapali/hepsi tanınır; tanınmayan → link', () => {
  assert.equal(G.gommeKipi({}), 'link');
  assert.equal(G.gommeKipi({ EMPP_MENU_KAPAK_GOMME: ' KAPALI ' }), 'kapali');
  assert.equal(G.gommeKipi({ EMPP_MENU_KAPAK_GOMME: 'hepsi' }), 'hepsi');
  assert.equal(G.gommeKipi({ EMPP_MENU_KAPAK_GOMME: 'evet' }), 'link');
});
