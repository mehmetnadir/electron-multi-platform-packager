'use strict';

/**
 * WEB-Z TEMA KABUĞU (2026-10-02) — Flashy offline kök menüsü. Ağ YOK; tema dosyaları depodaki
 * kopyadan (`src/agent/webz-tema/`). "Kaynak paritesi" book-update yoksa kendini atlar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const K = require('./webz-tema-kabuk');
const gMenu = require('../../tools/g-yayin/menu');
const bicim = require('../packaging/set-menu-bicim');
const esitle = require('../../tools/webz-tema-esitle');

const TEMA = path.join(K.TEMA_KOKU, 'web-proxy-modern');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '),
  Buffer.alloc(8)]);
const XML1 = '﻿<?xml version="1.0" encoding="utf-8"?>\r\n<Book hashed="true" kitapId="3100038">'
  + '<Units><Unit name="Theme 1" page="3" ratio="1"></Unit><Unit name="Theme &amp; 2" page="10">'
  + '</Unit></Units></Book>';

const temel = (ek = {}) => ({
  setAdi: 'Flashy Grade 4 Set',
  kitaplar: [
    { n: 1, assetId: '69523', ad: 'Practice Book', bookContent: XML1 },
    { n: 2, assetId: '69084', ad: 'Activty & Test Book' },
  ],
  ...ek,
});

/** Yamayı sahte tarayıcıda koşturur (DOM yok; yalnız yamanın dokunduğu yüzey). */
function yamaOrtami(yamaMetni) {
  const dinleyici = [];
  const fetchler = [];
  const win = {
    location: { href: 'file:///paket/index.html' },
    fetch: (u) => { fetchler.push(String(u)); return Promise.reject(new Error('ağ yok')); },
    open: (u, h) => { win.acilan = [u, h]; },
    xmlParser: {
      parseBookContent: async () => [{ num: 1, label: 'Unit 1 — Örnek', page: 1 }],
    },
    FlashyUI: { renderCardGrid: (kap, ogeler) => { win.cizilen = ogeler; } },
    showAcilisOrtusu: (b) => { win.ortu = b; },
  };
  const ctx = vm.createContext({
    window: win, document: { addEventListener: (ev, f) => dinleyici.push([ev, f]) },
    Promise, JSON, Object, String,
  });
  vm.runInContext(yamaMetni, ctx, { filename: K.YAMA });
  const domHazir = () => dinleyici.forEach(([e, f]) => e === 'DOMContentLoaded' && f());
  return { win, dinleyici, fetchler, domHazir };
}

test('kabuk dosyaları: tema JS/CSS/görsel AYNEN, menü dosyaları + yerel vendor üretilir', () => {
  const { dosyalar } = K.kabukUret(temel());
  for (const y of K.TEMALAR['web-proxy-modern'].dosyalar) {
    const hedef = K.hedefYolu(K.TEMALAR['web-proxy-modern'], y);
    assert.ok(dosyalar.get(hedef).equals(fs.readFileSync(path.join(TEMA, y))), `${y} aynen değil`);
  }
  for (const y of ['index.html', K.YAMA, K.STIL, K.AYAR, K.TANIM,
    'styles/vendor/fontawesome/css/all.min.css', 'styles/vendor/fontawesome/webfonts/fa-solid-900.woff2',
    'styles/vendor/fonts/fonts.css']) {
    assert.ok(dosyalar.has(y), `${y} yok`);
  }
  // Örnek kapaklar/ayar ve yüklenmeyen önyükleyici pakete girmez; kitap içeriğine dokunulmaz.
  for (const y of dosyalar.keys()) {
    assert.ok(!/^covers\/|book-preloader|^book\d+\//.test(y), `beklenmeyen ${y}`);
  }
  const kokuMarka = dosyalar.get('images/logo.png');
  assert.equal(kokuMarka.toString('latin1', 1, 4), 'PNG');
});

test('ağ adresi kalmaz: CDN/analitik/polyfill yok, fontlar yerel dosyaya çözülür', () => {
  const { dosyalar } = K.kabukUret(temel());
  assert.deepEqual(K.agBagimliliklari(dosyalar), []);
  const index = dosyalar.get('index.html').toString('utf8');
  for (const yasak of ['googleapis', 'gstatic', 'cdnjs', 'googletagmanager', 'polyfill.js',
    'manifest.webmanifest', '/go/']) {
    assert.ok(!index.includes(yasak), `index.html'de ${yasak}`);
  }
  // Yerel stil dosyalarının başvurdukları font dosyaları pakette VAR.
  for (const css of ['styles/vendor/fonts/fonts.css', 'styles/vendor/fontawesome/css/all.min.css']) {
    const m = dosyalar.get(css).toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const urller = [...m.matchAll(/url\(([^)]+)\)/g)].map((x) => x[1].replace(/["']/g, ''));
    assert.ok(urller.length > 0, `${css}: url yok`);
    for (const u of urller) {
      const yol = path.posix.normalize(path.posix.join(path.posix.dirname(css), u));
      assert.ok(dosyalar.has(yol), `${css} → ${yol} pakette yok`);
    }
  }
  // Mutasyon tanığı: CDN bağlantısı geri gelirse tarayıcı yakalanır.
  const kirli = new Map(dosyalar);
  kirli.set('index.html', Buffer.from(`${index}<link href="https://fonts.googleapis.com/x">`));
  assert.equal(K.agBagimliliklari(kirli).length, 1);
});

test('index.html: başlık = set adı, imza meta, yama theme.js\'ten ÖNCE, stil eklendi', () => {
  const { dosyalar } = K.kabukUret(temel({ setAdi: 'Flashy <Grade> 8 & Set' }));
  const s = dosyalar.get('index.html').toString('utf8');
  assert.match(s, /<title>Flashy &lt;Grade&gt; 8 &amp; Set<\/title>/);
  assert.match(s, /<meta name="empp-webz-tema" content="web-proxy-modern" \/>/);
  const yama = s.indexOf(`src="${K.YAMA}"`);
  assert.ok(yama > s.indexOf('scripts/library.js') && yama < s.indexOf('src="theme.js'));
  assert.ok(s.indexOf(`href="${K.STIL}"`) < s.indexOf('</head>'));
  assert.equal(bicim.webZKabukIndexiMi(s), true, 'paketleyici kabuğu Web-Z olarak tanımalı');
});

test('altbilgi: "Web Sürümü" çevrimdışı pakette kalkar, "Akıllı Tahta" kalır; desen yoksa RED', () => {
  const s = K.kabukUret(temel()).dosyalar.get('index.html').toString('utf8');
  assert.doesNotMatch(s, /Web Sürümü/);
  assert.match(s, /<footer class="footer">[\s\S]*<span>Akıllı Tahta<\/span>[\s\S]*<\/footer>/);
  const ham = fs.readFileSync(path.join(TEMA, 'index.html'), 'utf8');
  assert.match(ham, /Web Sürümü/, 'kaynak tema metni değişmedi (dönüşüm yalnız pakette)');
  assert.throws(() => K.indexUret(ham.replace('Akıllı Tahta · Web Sürümü', 'X'), 'web-proxy-modern', 'S'),
    (e) => e.kod === 'tema' && /beklenen metin yok/.test(e.message));
});

test('yama sözleşmesi: TEK __setSettings ataması, books = settings.json = set-menu.json', () => {
  const { dosyalar, ayarlar } = K.kabukUret(temel());
  const yama = dosyalar.get(K.YAMA).toString('utf8');
  const yp = gMenu.yamaAyir(yama);
  const ayar = JSON.parse(dosyalar.get(K.AYAR).toString('utf8'));
  assert.deepEqual(yp.ayarlar.books, ayar.books);
  assert.deepEqual(ayar, ayarlar);
  assert.deepEqual(Object.keys(ayar.books), ['book1', 'book2']);
  assert.equal(ayar.publisherName, 'Flashy ELT');
  assert.equal(ayar.books.book2.coverUrl, 'book2/assets/69084/thumbs/1.jpg');
  const tanim = JSON.parse(dosyalar.get(K.TANIM).toString('utf8'));
  assert.deepEqual(tanim.kitaplar.map((k) => [k.klasor, k.assetId, k.ad]),
    [['book1', '69523', 'Practice Book'], ['book2', '69084', 'Activty & Test Book']]);
  assert.equal(tanim.tema, 'web-proxy-modern');
  // Index üreteci / set-ek yamayı yamaAyir ile yeniden yazar: gidiş-dönüş geçerli JS kalmalı.
  const yeni = `${yp.once}${JSON.stringify({ ...yp.ayarlar, setTitle: 'X' }, null, 2)}${yp.sonra}`;
  assert.doesNotThrow(() => new vm.Script(yeni));
  assert.equal(gMenu.yamaAyir(yeni).ayarlar.setTitle, 'X');
});

test('yama davranışı: config fetch gömülü, ünite ağsız, kitap linki bookN/index.html', async () => {
  const { dosyalar } = K.kabukUret(temel());
  const o = yamaOrtami(dosyalar.get(K.YAMA).toString('utf8'));
  const r = await o.win.fetch('config/settings.json?v=123', { cache: 'no-store' });
  assert.equal((await r.json()).books.book1.assetId, '69523');
  const kopya = async (id) => JSON.parse(
    JSON.stringify(await o.win.xmlParser.parseBookContent(id)));
  assert.deepEqual(await kopya('69523'), [
    { num: 1, label: 'Theme 1', page: 3 }, { num: 2, label: 'Theme & 2', page: 10 }]);
  assert.deepEqual(await kopya('69084'), [], 'sahte 8 ünite çıkmamalı');
  assert.equal(o.fetchler.length, 0, 'ünite için ağa/diske istek gitmemeli');
  // openPage theme.js'ten SONRA (DOMContentLoaded) atanır — theme.js'in function bildirimi ezmesin.
  assert.equal(o.win.openPage, undefined);
  o.domHazir();
  o.win.openPage('book1', { title: 'Practice Book' }, null);
  assert.equal(o.win.location.href, 'book1/index.html?defaultPageNo=1');
  assert.equal(o.win.ortu, 'Practice Book');
  o.win.openPage('book2', {}, { page: 10 });
  assert.equal(o.win.location.href, 'book2/index.html?defaultPageNo=10');
  o.win.openPage('../../etc', {}, null);
  assert.equal(o.win.location.href, 'book2/index.html?defaultPageNo=10', 'dizin dışı yol açılmaz');
  // Kapak: tema images/bookN.png ister → coverUrl.
  o.win.FlashyUI.renderCardGrid('bookGrid', [{ id: 'book1', cover: 'images/book1.png' }], () => {});
  assert.equal(o.win.cizilen[0].cover, 'book1/assets/69523/thumbs/1.jpg');
});

test('link kartı: dış adres window.open ile açılır, kapak/yol üretilmez', () => {
  const { dosyalar, ayarlar } = K.kabukUret(temel({
    kitaplar: [{ n: 1, assetId: '69523', ad: 'PB' },
      { link: true, ad: 'Worksheet', url: 'https://flashyelt.com/ws' }],
  }));
  assert.equal(ayarlar.books.link2.type, 'link');
  const o = yamaOrtami(dosyalar.get(K.YAMA).toString('utf8'));
  o.domHazir();
  o.win.openPage('link2', {}, null);
  assert.deepEqual([...o.win.acilan], ['https://flashyelt.com/ws', '_blank']);
  assert.equal(o.win.location.href, 'file:///paket/index.html');
  o.win.FlashyUI.renderCardGrid('g', [{ id: 'link2', cover: 'images/link2.png' }], () => {});
  assert.equal(o.win.cizilen[0].cover, '');
  assert.equal(JSON.parse(dosyalar.get(K.TANIM)).kitaplar.length, 1);
});

test('kapak: Buffer/data URI → images/bookN.<tür>; görsel değilse RED', () => {
  const { dosyalar, ayarlar } = K.kabukUret(temel({
    kitaplar: [{ n: 1, assetId: '1', ad: 'A', kapak: JPG },
      { n: 2, assetId: '2', ad: 'B', kapak: `data:image/webp;base64,${WEBP.toString('base64')}` }],
  }));
  assert.equal(ayarlar.books.book1.coverUrl, 'images/book1.jpg');
  assert.ok(dosyalar.get('images/book1.jpg').equals(JPG));
  assert.equal(ayarlar.books.book2.coverUrl, 'images/book2.webp');
  assert.ok(dosyalar.get('images/book2.webp').equals(WEBP));
  assert.throws(() => K.kabukUret(temel({
    kitaplar: [{ n: 1, assetId: '1', ad: 'A', kapak: Buffer.from('<html>not an image</html>') }],
  })), /kapak görsel değil/);
});

test('ünite ayrıştırma: tema xmlParser kuralı; ilk 100 bayt gizli BookContent çözülür', () => {
  assert.deepEqual(K.uniteleriAyristir(XML1).map((u) => u.page), [3, 10]);
  const gizli = Buffer.from(XML1, 'utf8');
  for (let i = 0; i < 100; i++) gizli[i] = (256 - gizli[i]) & 255;
  assert.equal(K.bookContentMetni(gizli), XML1);
  assert.equal(K.bookContentMetni(Buffer.from('çöp veri değil xml')), null);
  assert.deepEqual(K.uniteleriAyristir('<Book><Chapter title="Giriş"/></Book>'),
    [{ num: 1, label: 'Giriş', page: null }]);
});

test('JS sözdizimi kapısı: bozuk şablon kaçışı yakalanır, üretilenler derlenir', () => {
  const ad = `Set \`\${x}\` </script> ${String.fromCharCode(0x2028)} son`;
  const { dosyalar } = K.kabukUret(temel({ setAdi: ad }));
  assert.doesNotThrow(() => K.sozdizimiDenetle(dosyalar));
  const yama = dosyalar.get(K.YAMA).toString('utf8');
  assert.ok(!yama.includes('</script>'), 'gömülü JSON </script> kapatmamalı');
  assert.equal(gMenu.yamaAyir(yama).ayarlar.setTitle, ad);
  assert.throws(() => K.sozdizimiDenetle(new Map([['x.js', Buffer.from('const a = `${;')]])),
    /sözdizimi bozuk/);
});

test('girdi kapıları: boş liste, kötü dizin, kötü link, yinelenen dizin, boş set adı', () => {
  assert.throws(() => K.kabukUret(temel({ kitaplar: [] })), /kitap listesi boş/);
  assert.throws(() => K.kabukUret(temel({ kitaplar: [{ dizin: '../x', assetId: '1' }] })),
    /geçersiz dizin/);
  const kotuLink = [{ link: true, url: 'javascript:alert(1)' }];
  assert.throws(() => K.kabukUret(temel({ kitaplar: kotuLink })),
    /link adresi geçersiz/);
  assert.throws(() => K.kabukUret(temel({
    kitaplar: [{ n: 1, assetId: '1' }, { dizin: 'book1', assetId: '2' }],
  })), /aynı dizin/);
  assert.throws(() => K.kabukUret(temel({ setAdi: ' ' })), /set adı boş/);
  assert.throws(() => K.kabukUret(temel({ tema: 'yok' })), /bilinmeyen tema/);
});

test('tema seçimi: kurum 310 / "Flashy ELT" → web-proxy-modern; YDS (60) → null', () => {
  assert.equal(K.temaSec({ kurum: '310' }), 'web-proxy-modern');
  assert.equal(K.temaSec({ kurum: 310 }), 'web-proxy-modern');
  assert.equal(K.temaSec({ yayinci: 'flashy elt' }), 'web-proxy-modern');
  assert.equal(K.temaSec({ kurum: '60', yayinci: 'YDS Yayıncılık' }), null);
});

test('KAYNAK.json bütünlüğü: kopyalanan tema dosyalarının sha256\'sı kayıtla aynı', () => {
  const kayit = JSON.parse(fs.readFileSync(path.join(TEMA, 'KAYNAK.json'), 'utf8'));
  assert.equal(kayit.tema, 'web-proxy-modern');
  for (const [ad, v] of Object.entries(kayit.dosyalar)) {
    const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(TEMA, ad)))
      .digest('hex');
    assert.equal(h, v.sha256, `${ad} kayıttan sapmış — tools/webz-tema-esitle.js koş`);
  }
});

test('kaynak paritesi: Worker teması (book-update) ile depo kopyası bayt bayt aynı', (t) => {
  if (!fs.existsSync(esitle.VARSAYILAN_KAYNAK)) {
    t.skip('book-update set-ui-templates.ts yok');
    return;
  }
  const { dosyalar } = esitle.temaCikar(fs.readFileSync(esitle.VARSAYILAN_KAYNAK, 'utf8'),
    'web-proxy-modern');
  for (const [ad, buf] of dosyalar) {
    assert.ok(buf.equals(fs.readFileSync(path.join(TEMA, ad))),
      `${ad} Worker'da değişmiş — node tools/webz-tema-esitle.js`);
  }
});

// --- 03.10 saha 59480 Flashy: `_design/` + `_vendor/` zip'te vardı, paketleyici `!_*` ile attı ---

const PAKET_DISI = require('../packaging/paket-disi-liste');

test('kök dizin `_` ile başlamaz: hiçbir kabuk dosyası dört platformda paket dışı listeye düşmez', () => {
  const { dosyalar } = K.kabukUret(temel());
  const yollar = [...dosyalar.keys()];
  assert.ok(yollar.some((y) => y.startsWith('styles/vendor/')) && yollar.includes('scripts/tasarim/components.js'));
  for (const y of yollar) {
    assert.ok(!/^_/.test(y.split('/')[0]) || !y.includes('/'), `kök dizin "_" önekli: ${y}`);
    for (const pl of PAKET_DISI.PLATFORMLAR) {
      assert.equal(PAKET_DISI.dislayanMadde(y, pl), null, `${y} ${pl} paketinde dışlanır (${PAKET_DISI.dislayanMadde(y, pl)})`);
    }
  }
  // Mutasyon tanığı: eski yerleşim (`_design/`) aynı süzgeçten düşer — bu test onu yakalar.
  assert.equal(PAKET_DISI.dislayanMadde('_design/components.js', 'linux'), 'kok-yedek');
  assert.equal(PAKET_DISI.dislayanMadde('_vendor/fonts/fonts.css', 'android'), 'kok-yedek');
});

test('index.html\'in tüm yerel başvuruları üretilen dosyalar arasında (FlashyUI/menü yüklenir)', () => {
  const { indexYerelReferanslari } = require('./yazma-kapisi');
  const { dosyalar } = K.kabukUret(temel());
  const refler = indexYerelReferanslari(dosyalar.get('index.html').toString('utf8'));
  assert.ok(refler.includes('scripts/tasarim/components.js') && refler.includes('styles/tasarim/tokens.css'));
  assert.ok(refler.includes('styles/vendor/fonts/fonts.css') && refler.includes('theme.js'));
  for (const y of refler) assert.ok(dosyalar.has(y), `index.html → ${y} yok`);
  assert.ok(!dosyalar.get('index.html').toString('utf8').includes('"_design/'));
});

test('`_` önekli kök dizin yakalanır (kabukUret bunda DURUR: kod yedek-dizin)', () => {
  assert.equal(K.yedekKokDizin(['index.html', '_design/tokens.css', 'styles/a.css']), '_design/tokens.css');
  assert.equal(K.yedekKokDizin(['_x.js', 'book1/_motor/a.js', 'styles/vendor/a.css']), null,
    'kök DOSYA ve iç `_` dizin paketleyicide de dışlanmaz');
  assert.equal(K.yedekKokDizin(K.kabukUret(temel()).dosyalar.keys()), null);
});
