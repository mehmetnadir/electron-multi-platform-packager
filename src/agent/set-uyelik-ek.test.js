'use strict';

/**
 * SET ÜYELİĞİ bookN EKİ (2026-09-30) — gerçek 45482 "Shall We 8 Set" kesiti üstünde.
 * Fikstür `fikstur/set-45482-kesit/`: kök Web-Z menüsü (index.html, cevrimdisi-yama.js,
 * settings.json, set-menu.json) + book1..4'ün GERÇEK index.html / app.config.js / ImWin32.dll'i;
 * görseller yer tutucu. `zkitapziph/`: 45352-2 ve 49436-3 arşivlerinin gerçek BookContent başı.
 * Canlı İmpark'a, R2'ye, panele istek GİTMEZ (getir/indir sahte); her şey os.tmpdir() altında.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const E = require('./set-uyelik-ek');
const M = require('./icerik-merdiven');
const ig = require('../runtime/icerik-guncelleme');

const FIKSTUR = path.join(__dirname, 'fikstur', 'set-45482-kesit');
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `set-ek-${ad}-`));
const CANLI_LISTE = '44187 | Reference Book | \n25772\n45352 | Test Book | \n'
  + '49436 | LGS Deneme Sınavları | \n44579 | Key Words | \n66905 | Games';
const ZIPLER = { 45352: 2, 49436: 3 };

function zipla(dizin, cikti) {
  execFileSync('zip', ['-q', '-r', '-D', '-X', cikti, '.'], { cwd: dizin });
  return cikti;
}

function ortam({ degistir } = {}) {
  const d = tmp('ortam');
  let setKok = path.join(FIKSTUR, 'set');
  if (degistir) {
    const kopya = path.join(d, 'set');
    fs.cpSync(setKok, kopya, { recursive: true });
    degistir(kopya);
    setKok = kopya;
  }
  const zip = zipla(setKok, path.join(d, 'build.zip'));
  const arsivler = {};
  for (const [id, vs] of Object.entries(ZIPLER)) {
    arsivler[id] = zipla(path.join(FIKSTUR, 'zkitapziph', `${id}-${vs}`),
      path.join(d, `kaynak-${id}-${vs}.zip`));
  }
  const calisma = path.join(d, 'is');
  fs.mkdirSync(calisma);
  const sorular = [];
  const indirilen = [];
  return {
    d, zip, calisma, sorular, indirilen,
    ortak: {
      zip, calisma, bookId: '45482', platform: 'test', onbellek: path.join(d, 'onbellek'),
      kanitDizini: path.join(d, 'kanit'),
      getir: async (url) => {
        sorular.push(url);
        const id = /[?&]id=(\d+)/.exec(url)[1];
        if (!ZIPLER[id]) return { status: 200, govde: '{"Success":true,"Data":"","Vs":0}' };
        const data = `https://akillitahta.ydspublishing.com/Uploads/ZKitapZipH/${id}-${ZIPLER[id]}.zip`;
        return { status: 200, govde: JSON.stringify({ Success: true, Data: data, Vs: ZIPLER[id] }) };
      },
      indir: async (url, hedef) => {
        indirilen.push(url);
        const id = /ZKitapZipH\/(\d+)-/.exec(url)[1];
        fs.copyFileSync(arsivler[id], hedef);
      },
    },
  };
}

function dosyaMd5(zip) {
  return md5(fs.readFileSync(zip));
}

/** Zip'teki (menü dosyaları dışı) her girdinin md5'i — "eski kitaplar bayt-aynı" kanıtı. */
function girdiMd5(zip, suzgec = () => true) {
  const d = M.zipDizini(zip);
  const out = new Map();
  for (const [ad, g] of d) {
    if (g.dizin || !suzgec(ad)) continue;
    out.set(ad, md5(M.zipGirdiOku(zip, g)));
  }
  return out;
}

function ayarlar(zip) {
  const d = M.zipDizini(zip);
  const oku = (y) => M.zipGirdiOku(zip, d.get(y)).toString('utf8');
  return {
    yama: require('../../tools/g-yayin/menu').yamaAyir(oku('scripts/cevrimdisi-yama.js')).ayarlar,
    ayar: JSON.parse(oku('config/settings.json')),
    tanim: JSON.parse(oku('set-menu.json')),
  };
}

const eskiMi = (ad) => /^book[1-4]\//.test(ad) || (!ad.startsWith('book')
  && !E.MENU_YOLLARI.includes(ad));

// ─── saf ────────────────────────────────────────────────────────────────────────────────────

test('liste ayrıştırma parseProxyBookList ile birebir: sayaç ortak, link ve virgül biçimi', () => {
  const l = E.setListesiAyristir(CANLI_LISTE);
  assert.deepEqual(l.map((g) => [g.anahtar, g.assetId, g.ad]), [
    ['book1', '44187', 'Reference Book'], ['book2', '25772', ''], ['book3', '45352', 'Test Book'],
    ['book4', '49436', 'LGS Deneme Sınavları'], ['book5', '44579', 'Key Words'],
    ['book6', '66905', 'Games'],
  ]);
  const k = E.setListesiAyristir('11 | A\nlink:https://x.invalid | Site\n12 | B');
  assert.deepEqual(k.map((g) => g.anahtar), ['book1', 'link2', 'book3']);
  assert.equal(k[1].link, true);
  assert.deepEqual(E.setListesiAyristir('11 | A, 12 | B').map((g) => g.assetId), ['11', '12']);
});

test('eşleme: assetId önce, sonra aynı adlı TEK kitap (Games ↔ Grade-8-Games)', () => {
  const exe = [
    { dizin: 'book1', id: '44187', menuAssetId: '44187', ad: 'Reference Book' },
    { dizin: 'book4', id: '0', menuAssetId: 'Grade-8-Games', ad: 'Games' },
  ];
  const r = E.eslestir(E.setListesiAyristir('44187 | X\n66905 | Games\n45352 | Test Book'), exe);
  assert.deepEqual(r.eslesen.map((e) => [e.dizin, e.yol]), [['book1', 'assetId'], ['book4', 'ad']]);
  assert.deepEqual(r.eksik.map((g) => g.assetId), ['45352']);
  assert.deepEqual(r.listedeYok, []);
});

test('set listesi kaynağı: claim > EMPP_SET_LISTESI_DIZINI; ikisi de yoksa null', () => {
  const d = tmp('liste');
  fs.writeFileSync(path.join(d, '45482.txt'), CANLI_LISTE);
  assert.equal(E.setListesiCoz({ job: { bookId: '45482', setListesi: 'a|b' }, env: {} }).kaynak,
    'claim');
  assert.equal(E.setListesiCoz({ job: { bookId: '45482' }, env: { EMPP_SET_LISTESI_DIZINI: d } })
    .ham, CANLI_LISTE);
  assert.equal(E.setListesiCoz({ job: { bookId: '1' }, env: { EMPP_SET_LISTESI_DIZINI: d } }),
    null);
  assert.equal(E.ekAcik({}), false);
  assert.equal(E.ekAcik({ EMPP_SET_UYELIK_EK: '1' }), true);
});

// ─── 45482 kesiti ───────────────────────────────────────────────────────────────────────────

test('eksik yok (liste = exe) → zip BAYT-AYNI, İmpark sorulmaz', async () => {
  const o = ortam();
  const once = dosyaMd5(o.zip);
  const r = await E.setUyelikEki({
    ...o.ortak, liste: '44187 | Reference Book |\n25772\n44579 | Key Words |\n66905 | Games',
  });
  assert.equal(r.sonuc, 'eksik yok, menü güncel — değişiklik yok');
  assert.equal(dosyaMd5(o.zip), once);
  assert.equal(o.sorular.length, 0);
  assert.deepEqual(r.eslesme.find((e) => e.assetId === '66905'),
    { assetId: '66905', dizin: 'book4', yol: 'ad' });
  assert.deepEqual(r.eksikSetKitabi, []);
});

test('2 eksik (45482 canlı listesi) → book5/book6 + menü liste sırası ve adlarıyla', async () => {
  const o = ortam();
  const eski = girdiMd5(o.zip, eskiMi);
  const r = await E.setUyelikEki({ ...o.ortak, liste: CANLI_LISTE });
  assert.equal(r.sonuc, 'UYGULANDI', JSON.stringify(r.eksikSetKitabi));
  assert.deepEqual(r.eklenen.map((e) => [e.dizin, e.id, e.vs, e.ad]), [
    ['book5', '45352', 2, 'Test Book'], ['book6', '49436', 3, 'LGS Deneme Sınavları'],
  ]);
  assert.ok(o.sorular.every((u) => /versiyon=0$/.test(u)), o.sorular.join(' '));

  const a = ayarlar(o.zip);
  const sira = ['book1', 'book2', 'book5', 'book6', 'book3', 'book4'];
  for (const s of [a.yama, a.ayar]) {
    assert.deepEqual(Object.keys(s.books), sira);
    assert.deepEqual(Object.values(s.books).map((b) => b.displayOrder), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(Object.values(s.books).map((b) => b.title), ['Reference Book', 'Workbook',
      'Test Book', 'LGS Deneme Sınavları', 'Key Words', 'Games']);
    assert.equal(s.bookCount, 6);
    assert.equal(s.books.book5.assetId, '45352');
    assert.equal(s.books.book5.coverUrl, 'book5/assets/45352/thumbs/1.jpg');
  }
  assert.deepEqual(a.tanim.kitaplar.map((k) => k.klasor), sira);

  const d = M.zipDizini(o.zip);
  for (const [b, id, vs] of [['book5', '45352', 2], ['book6', '49436', 3]]) {
    const ham = M.zipGirdiOku(o.zip, d.get(`${b}/classlibraries/ImWin32.dll`));
    const kalip = M.zipGirdiOku(o.zip, d.get('book1/classlibraries/ImWin32.dll'));
    assert.deepEqual(ig.menuBicimi(ham), ig.menuBicimi(kalip), 'kalıbın kodlama biçimi');
    const c = ig.kapaklar(ig.menuCoz(ham));
    assert.equal(c.length, 1);
    assert.equal(c[0].ID, id);
    assert.equal(c[0].version, vs);
    assert.match(c[0].URL, new RegExp(`ZKitapZipH/${id}-${vs}\\.zip$`));
    for (const f of ['data/BookContent.xml', 'pages/1.png', 'thumbs/1.jpg']) {
      assert.ok(d.has(`${b}/assets/${id}/${f}`), `${b} ${f}`);
    }
    assert.equal(md5(M.zipGirdiOku(o.zip, d.get(`${b}/index.html`))),
      md5(M.zipGirdiOku(o.zip, d.get('book1/index.html'))));
    assert.ok(![...d.keys()].some((k) => k.startsWith(`${b}/assets/44187`)), 'kalıp içeriği sızdı');
  }
  // Eski kitaplar ve menü dışı kök BAYT-AYNI.
  const sonra = girdiMd5(o.zip, eskiMi);
  assert.equal(sonra.size, eski.size);
  for (const [ad, h] of eski) assert.equal(sonra.get(ad), h, ad);
  assert.ok(fs.existsSync(r.kanit));
  assert.equal(fs.existsSync(`${o.zip}.set-ek-aday`), false, 'aday kopya kalmadı');
});

test('ikinci koşu idempotent: eksik yok → zip değişmez', async () => {
  const o = ortam();
  await E.setUyelikEki({ ...o.ortak, liste: CANLI_LISTE });
  const once = dosyaMd5(o.zip);
  const r = await E.setUyelikEki({ ...o.ortak, liste: CANLI_LISTE });
  assert.equal(r.sonuc, 'eksik yok, menü güncel — değişiklik yok');
  assert.equal(dosyaMd5(o.zip), once);
});

test('indirme hatası → o kitap atlanır, menüye girmez, paket yine üretilir', async () => {
  const o = ortam();
  const eski = girdiMd5(o.zip, eskiMi);
  const indir = o.ortak.indir;
  const r = await E.setUyelikEki({
    ...o.ortak, liste: CANLI_LISTE,
    indir: async (url, hedef) => {
      if (url.includes('49436')) throw new Error(`indirilemedi (indirme kodu 22): ${url}`);
      return indir(url, hedef);
    },
  });
  assert.equal(r.sonuc, 'UYGULANDI');
  assert.deepEqual(r.eklenen.map((e) => e.dizin), ['book5']);
  assert.equal(r.eksikSetKitabi.length, 1);
  assert.equal(r.eksikSetKitabi[0].assetId, '49436');
  assert.match(r.eksikSetKitabi[0].sebep, /indirilemedi/);
  const a = ayarlar(o.zip);
  assert.deepEqual(Object.keys(a.ayar.books), ['book1', 'book2', 'book5', 'book3', 'book4']);
  assert.equal(a.ayar.bookCount, 5);
  assert.ok(![...M.zipDizini(o.zip).keys()].some((k) => k.startsWith('book6/')));
  const sonra = girdiMd5(o.zip, eskiMi);
  for (const [ad, h] of eski) assert.equal(sonra.get(ad), h, ad);
});

test('İmpark içerik vermezse (Data boş) kitap atlanır, sıradaki bir sonraki bookN olur', async () => {
  const o = ortam();
  const getir = o.ortak.getir;
  const r = await E.setUyelikEki({
    ...o.ortak, liste: CANLI_LISTE,
    getir: async (url) => (url.includes('id=45352')
      ? { status: 200, govde: '{"Success":true,"Data":"","Vs":1}' } : getir(url)),
  });
  assert.deepEqual(r.eklenen.map((e) => [e.dizin, e.id]), [['book5', '49436']]);
  assert.match(r.eksikSetKitabi[0].sebep, /içerik yok/);
});

test('arşiv düzeni bozuk (ilk sayfa yok) → kitap eklenmez, diğeri eklenir', async () => {
  const o = ortam();
  const bozuk = tmp('bozuk');
  fs.cpSync(path.join(FIKSTUR, 'zkitapziph', '45352-2'), bozuk, { recursive: true });
  fs.renameSync(path.join(bozuk, 'pages', '1.png'), path.join(bozuk, 'pages', '9.png'));
  const bozukZip = zipla(bozuk, path.join(o.d, 'bozuk-45352.zip'));
  const indir = o.ortak.indir;
  const r = await E.setUyelikEki({
    ...o.ortak, liste: CANLI_LISTE,
    indir: async (url, hedef) => (url.includes('45352')
      ? fs.copyFileSync(bozukZip, hedef) : indir(url, hedef)),
  });
  assert.deepEqual(r.eklenen.map((e) => [e.dizin, e.id]), [['book5', '49436']]);
  assert.match(r.eksikSetKitabi[0].sebep, /pages\/1\.\* yok/);
});

test('kalıbın classlibraries/ ve assets/ içeriği yeni kitaba SIZMAZ', async () => {
  // Gerçek 45482'de book3/classlibraries/ImWin32_sifresiz.xml var (başka kitabın AÇIK menüsü).
  const o = ortam({
    degistir: (k) => fs.writeFileSync(path.join(k, 'book1', 'classlibraries',
      'ImWin32_sifresiz.xml'), '<main><cover ID="44187"/></main>'),
  });
  const r = await E.setUyelikEki({ ...o.ortak, liste: CANLI_LISTE });
  assert.equal(r.sonuc, 'UYGULANDI');
  const adlar = [...M.zipDizini(o.zip).keys()];
  for (const b of ['book5', 'book6']) {
    assert.deepEqual(adlar.filter((a) => a.startsWith(`${b}/classlibraries/`)),
      [`${b}/classlibraries/ImWin32.dll`]);
    assert.deepEqual([...new Set(adlar.filter((a) => a.startsWith(`${b}/assets/`))
      .map((a) => a.split('/')[2]))], [r.eklenen.find((e) => e.dizin === b).id]);
  }
});

test('sıra değişikliği (eksik yok) → menü yeni sıraya geçer, kitaplar bayt-aynı', async () => {
  const o = ortam();
  const eski = girdiMd5(o.zip, eskiMi);
  const r = await E.setUyelikEki({
    ...o.ortak, liste: '44579 | Key Words 8\n44187 | Reference Book\n25772\n66905 | Games',
  });
  assert.equal(r.sonuc, 'UYGULANDI');
  assert.deepEqual(r.eklenen, []);
  const a = ayarlar(o.zip);
  assert.deepEqual(Object.keys(a.yama.books), ['book3', 'book1', 'book2', 'book4']);
  assert.equal(a.ayar.books.book3.title, 'Key Words 8', 'liste adı menüye yansır');
  assert.equal(a.ayar.books.book2.title, 'Workbook', 'liste adı boşsa menü adı korunur');
  assert.equal(a.tanim.kitaplar[0].ad, 'Key Words 8');
  assert.deepEqual(a.tanim.kitaplar.map((k) => k.klasor), ['book3', 'book1', 'book2', 'book4']);
  const sonra = girdiMd5(o.zip, eskiMi);
  assert.equal(sonra.size, eski.size);
  for (const [ad, h] of eski) assert.equal(sonra.get(ad), h, ad);
});

test('kapı RED (yazım eski kitaba dokundu) → iş kopyası HİÇ değişmez, aday atılır', async () => {
  const o = ortam();
  const once = dosyaMd5(o.zip);
  const r = await E.setUyelikEki({
    ...o.ortak, liste: CANLI_LISTE,
    zipKomutu: async (cmd, args, opt) => {
      const z = await M.komut(cmd, args, opt);
      const bozuk = path.join(opt.cwd, 'book1');
      fs.mkdirSync(bozuk, { recursive: true });
      fs.writeFileSync(path.join(bozuk, 'index.html'), 'EZILDI');
      await M.komut('zip', ['-q', `${path.resolve(o.zip)}.set-ek-aday`, 'book1/index.html'],
        { cwd: opt.cwd });
      return z;
    },
  });
  assert.equal(r.sonuc, 'yazım/kapı düştü — iş kopyası DEĞİŞMEDİ');
  assert.equal(dosyaMd5(o.zip), once);
  assert.equal(fs.existsSync(`${o.zip}.set-ek-aday`), false);
  assert.deepEqual(r.eksikSetKitabi.map((e) => e.assetId), ['45352', '49436']);
  assert.match(r.eksikSetKitabi[0].sebep, /değişti: book1\/index\.html/);
});

test('menü Web-Z değilse hiçbir şey eklenmez, eksikler rapora girer', async () => {
  const o = ortam();
  const d = tmp('k17');
  fs.cpSync(path.join(FIKSTUR, 'set'), d, { recursive: true });
  fs.writeFileSync(path.join(d, 'index.html'), '<html>yayıncının kendi menüsü</html>');
  const zip = zipla(d, path.join(o.d, 'yabanci.zip'));
  const once = dosyaMd5(zip);
  const r = await E.setUyelikEki({ ...o.ortak, zip, liste: CANLI_LISTE });
  assert.equal(r.sonuc, 'menü biçimi desteklenmiyor — değişiklik yok');
  assert.equal(dosyaMd5(zip), once);
  assert.equal(r.eksikSetKitabi.length, 2);
});

// ─── runner bağlantısı (kaynak nöbetçisi) ───────────────────────────────────────────────────

test('runner: ek merdivenden SONRA, pardus/HTTP paketleyiciden ÖNCE; yalnız arşiv kaynağında + anahtar', () => {
  const s = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  // Dalga B (B4): çağrılar casuslanabilir `kaynakAdim` (= icerikMerdiveni / setEk.setUyelikEki) üzerinden.
  const merdiven = s.indexOf('await kaynakAdim.merdiven({');
  const ek = s.indexOf('await kaynakAdim.setEki({');
  const pardus = s.indexOf('await buildPardusArtifact(zipPath');
  const http = s.indexOf('await packagerUploadBuild(zipPath');
  assert.ok(merdiven > 0 && ek > merdiven, 'ek merdivenden sonra');
  assert.ok(pardus > ek && http > ek, 'ek paketleyicilerden önce');
  // Exe'siz sözleşme (01.10): manuel build olduğu gibi kullanılır (M1) — ek yalnız arşiv kaynağında.
  assert.match(s, /if \(kaynak\.setEki && setEk\.ekAcik\(\)\)/);
  // Hazır pardus paketi devri tamamen kapalı (processJob hiç sormaz).
  assert.doesNotMatch(s, /setEkBekliyor|\? await hazirPardusPaketi/);
});

// ─── Worksheet LİNK kartı (2026-10-02) ──────────────────────────────────────────────────────
// Saha: 45550/45482/59835… listelerinde `link:<url> | Worksheet` satırı var; offline menü onu
// hiç göstermiyordu. Web-Z teması `type:'link'` kartı çizer ama tıklamayı kitap açmak sanır;
// yama sonuna `set-ek:link-tikla` bloğu eklenir.

const LINKLI_LISTE = '44187 | Reference Book |\n25772\n44579 | Key Words |\n66905 | Games\n'
  + 'link:https://download.ydspublishing.com/worksheets/grade-8-worksheets/ | Worksheet';

test('link: yama bloğu idempotent, yamaAyir hâlâ tam 1 atama görür, JS sözdizimi geçerli', () => {
  const yama = fs.readFileSync(path.join(FIKSTUR, 'set/scripts/cevrimdisi-yama.js'), 'utf8');
  const bir = E.linkYamasiEkle(yama);
  assert.ok(bir.includes(E.LINK_ISARET));
  assert.equal(E.linkYamasiEkle(bir), bir, 'ikinci ekleme değiştirmez');
  assert.doesNotThrow(() => require('../../tools/g-yayin/menu').yamaAyir(bir));
  assert.doesNotThrow(() => new (require('node:vm').Script)(bir));
});

test('link: yeniBooks link kaydı type:link + url + sıra; tanıma (set-menu.json) GİRMEZ', () => {
  const liste = E.setListesiAyristir(LINKLI_LISTE);
  const sirali = [
    { dizin: 'book1', liste: liste[0] }, { dizin: 'book2', liste: liste[1] },
    { dizin: liste[4].anahtar, liste: liste[4], link: true },
  ];
  const b = E.yeniBooks({ book1: { assetId: '1', title: 'A' }, book2: { assetId: '2' } }, sirali);
  assert.deepEqual(Object.keys(b), ['book1', 'book2', 'link5']);
  assert.deepEqual(b.link5, {
    contentType: 'link', displayOrder: 2, title: 'Worksheet', type: 'link',
    url: 'https://download.ydspublishing.com/worksheets/grade-8-worksheets/',
  });
});

test('link: eksik kitap YOK, yalnız link var → menüye girer; eski kitaplar bayt-aynı; 2. koşu değişmez', async () => {
  const o = ortam();
  const eski = girdiMd5(o.zip, eskiMi);
  const r = await E.setUyelikEki({ ...o.ortak, liste: LINKLI_LISTE });
  assert.equal(r.sonuc, 'UYGULANDI', JSON.stringify(r));
  assert.deepEqual(r.linkler.map((l) => l.sebep), ['menüye link kartı olarak girer']);
  const a = ayarlar(o.zip);
  for (const k of [a.yama, a.ayar]) {
    assert.equal(k.books.link5.type, 'link');
    assert.equal(k.books.link5.url,
      'https://download.ydspublishing.com/worksheets/grade-8-worksheets/');
    assert.equal(Object.keys(k.books).pop(), 'link5', 'link liste sırasında sonda');
    assert.equal(k.bookCount, Object.keys(k.books).length);
  }
  assert.equal(a.tanim.kitaplar.some((k) => k.klasor === 'link5'), false);
  const d = M.zipDizini(o.zip);
  const ham = M.zipGirdiOku(o.zip, d.get('scripts/cevrimdisi-yama.js')).toString('utf8');
  assert.ok(ham.includes(E.LINK_ISARET));
  const sonra = girdiMd5(o.zip, eskiMi);
  for (const [ad, h] of eski) assert.equal(sonra.get(ad), h, ad);
  const once = dosyaMd5(o.zip);
  const r2 = await E.setUyelikEki({ ...o.ortak, liste: LINKLI_LISTE });
  assert.equal(r2.sonuc, 'eksik yok, menü güncel — değişiklik yok');
  assert.equal(dosyaMd5(o.zip), once);
});

test('link: http(s) olmayan adres (javascript:) menüye GİRMEZ', async () => {
  const o = ortam();
  const once = dosyaMd5(o.zip);
  const r = await E.setUyelikEki({
    ...o.ortak, liste: '44187 | Reference Book |\n25772\n44579 | Key Words |\n66905 | Games\n'
      + 'link:javascript:alert(1) | Kötü',
  });
  assert.equal(dosyaMd5(o.zip), once);
  assert.match(r.linkler[0].sebep, /http\(s\) değil/);
});

test('link kapısı: menüde link yok ya da yama bloğu yok → RED', () => {
  const metin = { yama: '(function(){})();', ayar: null };
  const sonra = new Map();
  const base = {
    once: new Map(), sonra, eklenen: [], beklenenSira: ['link5'], beklenenAd: {},
    beklenenLink: { link5: 'https://x.invalid/' }, menuMetinleri: metin,
  };
  const yamaYok = require('../../tools/g-yayin/menu');
  assert.ok(yamaYok);
  const ihlal = E.kapiDenetle({
    ...base,
    menuMetinleri: {
      yama: 'window.__setSettings = {"books":{"link5":{"type":"link","url":"https://x.invalid/"}}};',
      ayar: null,
    },
  });
  assert.ok(ihlal.some((s) => /link tıklama bloğu yok/.test(s)), ihlal.join('|'));
  const ihlal2 = E.kapiDenetle({
    ...base,
    menuMetinleri: {
      yama: `window.__setSettings = {"books":{"link5":{"type":"link","url":"https://bu.invalid/"}}};\n${E.LINK_ISARET}`,
      ayar: null,
    },
  });
  assert.ok(ihlal2.some((s) => /menü linki link5/.test(s)), ihlal2.join('|'));
});

// Gerçek 45550 (Shall We 6) arşiv build'i — yoksa atlanır. Yalnız menü dosyaları okunur.
const ARSIV_45550 = path.join(process.env.HOME || '', '.empp-agent/kaynak-arsivi/45550/build.zip');
test('45550 gerçek build: Worksheet linki menüye girer; Games (book5, Grade-6-Games) bozulmaz',
  { skip: !fs.existsSync(ARSIV_45550) }, () => {
    const oku = (y) => execFileSync('unzip', ['-p', ARSIV_45550, y], { maxBuffer: 1 << 26 })
      .toString('utf8');
    const t = { yama: oku('scripts/cevrimdisi-yama.js'), ayar: oku('config/settings.json'),
      tanim: oku('set-menu.json') };
    const liste = E.setListesiAyristir('25776 | Reference Book | \n25786 | Workbook | \n'
      + '16030 | Test Book | \n25814 | Key Words | \n66903 | Games |  | games\n'
      + 'link:https://download.ydspublishing.com/worksheets/grade-6-worksheets/ | Worksheet');
    const books = E.menuBooksOku(t.yama, t.ayar);
    const exe = Object.entries(books).map(([dizin, b]) => ({
      dizin, id: dizin === 'book5' ? '0' : b.assetId, menuAssetId: b.assetId, ad: b.title,
    }));
    const es = E.eslestir(liste, exe);
    assert.deepEqual(es.eksik, [], 'Games 66903 menü assetId ile book5\'e eşleşir');
    assert.equal(es.eslesen.find((e) => e.liste.assetId === '66903').dizin, 'book5');
    const sirali = [];
    for (const g of liste) {
      const e = es.eslesen.find((x) => x.liste === g);
      if (e) sirali.push({ dizin: e.dizin, liste: g });
      if (g.link) sirali.push({ dizin: g.anahtar, liste: g, link: true });
    }
    const out = E.webzYaz(t, sirali);
    const yeniYama = out.get('scripts/cevrimdisi-yama.js').toString('utf8');
    const yeniBooks = E.menuBooksOku(yeniYama, out.get('config/settings.json').toString('utf8'));
    assert.deepEqual(Object.keys(yeniBooks), ['book1', 'book2', 'book4', 'book3', 'book5', 'link6']);
    assert.equal(yeniBooks.book5.assetId, '66903');
    assert.equal(yeniBooks.link6.url,
      'https://download.ydspublishing.com/worksheets/grade-6-worksheets/');
    assert.ok(yeniYama.includes(E.LINK_ISARET));
    assert.equal(out.has('set-menu.json'), false, 'link set-menu.json (kitap tanımı) değiştirmez');
  });

// ─── A1 (tek motorlu set, 05.10) ────────────────────────────────────────────────────────────

test('A1 kapısı: a1MenuMu yalnız dolu kapak alanında true', () => {
  assert.equal(E.a1MenuMu({ book1: { assetId: '1' } }), false);
  assert.equal(E.a1MenuMu({ book1: { assetId: '1', kapak: '' } }), false);
  assert.equal(E.a1MenuMu(null), false);
  assert.equal(E.a1MenuMu({ 'kapak-1': { assetId: '1', kapak: '1', path: '.' } }), true);
});

test('A1 kapısı: kökte kapak/index.html varsa üyelik eki UYGULANMAZ, zip BAYT-AYNI, İmpark sorulmaz', async () => {
  const o = ortam({
    degistir: (k) => {
      fs.mkdirSync(path.join(k, 'kapak'));
      fs.writeFileSync(path.join(k, 'kapak', 'index.html'), '<html></html>');
    },
  });
  const once = dosyaMd5(o.zip);
  const r = await E.setUyelikEki({ ...o.ortak, liste: CANLI_LISTE });
  assert.match(r.sonuc, /^A1 tek motorlu set/);
  assert.equal(dosyaMd5(o.zip), once);
  assert.equal(o.sorular.length, 0);
});
