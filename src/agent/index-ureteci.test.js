'use strict';

// Index üreteci (2026-10-02) — plan/menü saf kararları + uçtan uca yerel build (sahte İmpark) +
// yazma kapısının tek motorlu set düzeni. Ağ YOK: getir/indir sahte, zip/unzip gerçek CLI.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const U = require('./index-ureteci');
const M = require('./icerik-merdiven');
const ig = require('../runtime/icerik-guncelleme');
const { yazmaKapisi } = require('./yazma-kapisi');
const setEkMod = require('./set-uyelik-ek');

const SABLON = 'https://www.sorucoz.tv/TestlerMobil/GetKitapGuncellemeBilgi?id={bookId}&setMi={isSet}&versiyon={version}';
const KALIP_XML = '<?xml version="1.0"?><main xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
  + 'activation="false" key="" label="İmpark Eğitim" bookUpdate="true" version="1.0" type="1" lisans="">'
  + '<Group ID="0" label=""><Tab ID="0" label=""><cover guId="" ID="111" etkID="111" etkAdi="111" '
  + 'source="assets/111/cover.png" corpID="60" actName="ESKI" lessonID="1" '
  + 'URL="https://x.example/Uploads/ZKitapZipH/111-3.zip" sectionID="0" classID="3" imageURL="/a.png" '
  + 'version="3" kullaniciAktif="true" install="true" update="false" '
  + 'xmlSource="assets/111/data/BookContent.xml" Tip="kitap"></cover></Tab></Group></main>';
const BICIM = { bas: 127, ara: 16, son: 127 };

async function yaz(kok, dosyalar) {
  for (const [yol, veri] of Object.entries(dosyalar)) {
    const t = path.join(kok, yol);
    await fsp.mkdir(path.dirname(t), { recursive: true });
    await fsp.writeFile(t, veri);
  }
}

async function zipla(kaynak, hedef) {
  const r = await M.komut('zip', ['-q', '-r', '-X', path.resolve(hedef), '.'], { cwd: kaynak });
  assert.equal(r.code, 0, r.stderr);
}

const icerik = (id) => ({
  'data/BookContent.xml': `<Book kitapId="${id}"><Page/></Book>`,
  'thumbs/1.jpg': `kapak-${id}`, 'pages/1.png': `sayfa-${id}`, 'htmletk/u1/index.html': 'etk',
});

/** Kalıp build (Web-Z kabuğu + bookN motoru) ve içerik zip'leri; sahte getir/indir. */
async function ortam({ idler = ['501', '502', '503'], dataBos = [], bc = {} } = {}) {
  const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'uretec-test-'));
  const kalipDiz = path.join(d, 'kalip');
  const yamaAyar = { bookCount: 1, books: { book1: { assetId: '111', title: 'Eski', coverUrl: 'images/book1.png' } }, setTitle: 'Eski Set' };
  await yaz(kalipDiz, {
    'index.html': '<html><head><title>Eski Set</title></head><body>kabuk</body></html>',
    'config/settings.json': JSON.stringify(yamaAyar),
    'scripts/language-set.js': '// tema',
    'scripts/cevrimdisi-yama.js': `(function(){\n  window.__setSettings = ${JSON.stringify(yamaAyar)};\n})();\n`,
    'set-menu.json': JSON.stringify({ setAdi: 'Eski Set', tema: 'webZSf425', kitaplar: [{ ad: 'Eski', assetId: '111', klasor: 'book1' }] }),
    'images/book1.png': 'eski-kapak', 'images/logo.png': 'logo', 'kurum.txt': '60', 'electronUpdate.js': '// eu',
    'book1/index.html': '<html>motor</html>',
    'book1/app.config.js': `var AppConfig = { updateBookEndPoint: "${SABLON}" };`,
    'book1/43e23fce2b7009474555a77.js': '// motor',
    'book1/classlibraries/ImWin32.dll': ig.menuKodla(KALIP_XML, () => 0.5, BICIM),
    'book1/assets/111/data/BookContent.xml': '<Book/>', 'book1/assets/111/thumbs/1.jpg': 'k', 'book1/assets/111/pages/1.png': 'p',
    'book1/temp/data/storage.im': 'kullanici-verisi',
  });
  const kalipZip = path.join(d, 'kalip.zip');
  await zipla(kalipDiz, kalipZip);
  const icerikler = {};
  for (const id of idler) {
    const k = path.join(d, `ic-${id}`);
    await yaz(k, { ...icerik(id), ...(bc[id] ? { 'data/BookContent.xml': bc[id] } : {}) });
    icerikler[id] = path.join(d, `${id}.zip`);
    await zipla(k, icerikler[id]);
  }
  const sorulan = [];
  const getir = async (url) => {
    const id = /id=(\d+)/.exec(url)[1];
    sorulan.push(id);
    const data = dataBos.includes(id) || !icerikler[id] ? '' : `https://x.example/Uploads/ZKitapZipH/${id}-7.zip`;
    return { status: 200, govde: JSON.stringify({ Success: true, Data: data, Vs: data ? 7 : 0 }) };
  };
  const indir = async (url, hedef) => {
    const id = /ZKitapZipH\/(\d+)-/.exec(url)[1];
    await fsp.copyFile(icerikler[id], hedef);
  };
  return { d, kalipZip, getir, indir, sorulan };
}

const LISTE = [
  '501 | Student Book |  |  | Books',
  '502 | Workbook |  |  | Books',
  'link:https://v.example/x | Video',
  '503 | Test Book |  |  | Tests',
  '3100010 | Games |  | games |',
].join('\n');

function menuOku(zip, yol) {
  const dz = M.zipDizini(zip);
  return ig.menuCoz(M.zipGirdiOku(zip, dz.get(yol)));
}

// ─── Saf ────────────────────────────────────────────────────────────────────────────────────

test('planKur: link hariç, sıra/ad/grup listeden, tekrar tek kapak, \\n kaçışlı DB metni', () => {
  const p = U.planKur({ listeHam: `${LISTE}\n501 | Student Book |  |  | Books`.replace(/\n/g, '\\n') });
  assert.deepEqual(p.kitaplar.map((k) => [k.n, k.id, k.ad, k.grup]), [
    [1, '501', 'Student Book', 'Books'], [2, '502', 'Workbook', 'Books'], [3, '503', 'Test Book', 'Tests'],
    [4, '3100010', 'Games', ''],
  ]);
  assert.equal(p.linkler.length, 1);
});

test('planKur: aktivasyonlu set bookN düzeninde REDDEDİLİR (her kitap ayrı sorar)', () => {
  assert.throws(() => U.planKur({ listeHam: LISTE, duzen: 'bookN', aktivasyon: 'set' }),
    (e) => e.kod === 'aktivasyon-duzen');
  assert.equal(U.planKur({ listeHam: LISTE, duzen: 'tek-motor', aktivasyon: 'set' }).duzen, 'tek-motor');
  assert.throws(() => U.planKur({ listeHam: '' }), (e) => e.kod === 'liste-yok');
  assert.throws(() => U.planKur({ listeHam: LISTE, duzen: 'xyz' }), (e) => e.kod === 'parametre');
});

test('aktivasyonKarari: otomatik → en az bir anahtarlı kapak = set; bilinmeyen değer hata', () => {
  assert.equal(U.aktivasyonKarari('otomatik', [false, true]), 'set');
  assert.equal(U.aktivasyonKarari('otomatik', [false, false]), 'yok');
  assert.equal(U.aktivasyonKarari('set'), 'set');
  assert.equal(U.aktivasyonKarari('yok', [true]), 'yok');
  assert.throws(() => U.aktivasyonKarari('belki'), (e) => e.kod === 'parametre');
});

test('tekMotorMenuXml: set düzeyi aktivasyon (activation=true, key boş, ID=set), sekme = grup, sıra = liste', () => {
  const kitaplar = [
    { id: '501', vs: 7, url: 'https://x/ZKitapZipH/501-7.zip', ad: 'A & B', grup: 'Books' },
    { id: '502', vs: 2, url: 'https://x/ZKitapZipH/502-2.zip', ad: 'W', grup: 'Books' },
    { id: '503', vs: 1, url: 'https://x/ZKitapZipH/503-1.zip', ad: 'T', grup: 'Tests' },
  ];
  const xml = U.tekMotorMenuXml({ kalipXml: KALIP_XML, setId: '45480', setAdi: 'Marvel 11', aktivasyon: 'set', kitaplar });
  const ana = /<main\b[^>]*>/.exec(xml)[0];
  assert.match(ana, /\sactivation="true"/);
  assert.match(ana, /\skey=""/);
  assert.match(ana, /\sID="45480"/);
  assert.match(ana, /\stype="1"/);
  assert.deepEqual(ig.kapaklar(xml).map((c) => [c.ID, c.version]), [['501', 7], ['502', 2], ['503', 1]]);
  assert.equal((xml.match(/<Tab /g) || []).length, 2);
  assert.match(xml, /actName="A &amp; B"/);
  assert.match(xml, /source="assets\/501\/thumbs\/1\.jpg"/);
  const kapali = U.tekMotorMenuXml({ kalipXml: KALIP_XML, setId: '1', setAdi: '', aktivasyon: 'yok', kitaplar });
  assert.match(/<main\b[^>]*>/.exec(kapali)[0], /\sactivation="false"/);
  const ikiKapak = KALIP_XML.replace('</Tab>', '<cover ID="9"></cover></Tab>');
  assert.throws(() => U.tekMotorMenuXml({ kalipXml: ikiKapak, setId: '1', aktivasyon: 'yok', kitaplar }), (e) => e.kod === 'kalip');
});

test('webzMenuDosyalari: kalıbın eski kitapları TAŞINMAZ; yama+ayar+tanım+başlık listeden', () => {
  const ayar = { bookCount: 1, books: { book1: { assetId: '111', title: 'Eski' } }, setTitle: 'Eski', features: [1] };
  const out = U.webzMenuDosyalari({
    yama: `x;window.__setSettings = ${JSON.stringify(ayar)};y`, ayar: JSON.stringify(ayar),
    tanim: JSON.stringify({ setAdi: 'Eski', kitaplar: [{ klasor: 'book1', assetId: '111' }] }),
    index: '<title>Eski</title>',
  }, { setAdi: 'Yeni', girdiler: [{ dizin: 'book1', id: '501', ad: 'S', grup: 'G' },
    { dizin: 'link2', link: true, url: 'https://v.example/x', ad: 'Video' }, { dizin: 'book3', id: '502', ad: 'W', grup: '' }] });
  const a = JSON.parse(out.get('config/settings.json'));
  assert.deepEqual(Object.keys(a.books), ['book1', 'link2', 'book3']);
  assert.deepEqual(a.books.link2, { contentType: 'link', displayOrder: 1, title: 'Video', type: 'link', url: 'https://v.example/x' });
  assert.equal(a.books.book1.assetId, '501');
  assert.equal(a.books.book1.group, 'G');
  assert.equal(a.bookCount, 3);
  assert.deepEqual(a.features, [1]);
  assert.match(out.get('scripts/cevrimdisi-yama.js').toString(), /"assetId": "502"/);
  assert.ok(out.get('scripts/cevrimdisi-yama.js').toString().includes(setEkMod.LINK_ISARET), 'link varsa tıklama bloğu');
  assert.deepEqual(JSON.parse(out.get('set-menu.json')).kitaplar.map((k) => k.assetId), ['501', '502']);
  assert.equal(out.get('index.html').toString(), '<title>Yeni</title>');
});

// ─── Uçtan uca (yerel) ──────────────────────────────────────────────────────────────────────

test('uret tek-motor: kök motor + tüm kapaklı kök menü + assets/<id>; yazma kapısından GEÇER', async () => {
  const o = await ortam();
  const cikti = path.join(o.d, 'out', 'build.zip');
  const r = await U.uret({
    setId: '45480', setAdi: 'Marvel 11', listeHam: LISTE.split('\n').slice(0, 4).join('\n'), kalipZip: o.kalipZip,
    cikti, calisma: path.join(o.d, 'w'), onbellek: path.join(o.d, 'onb'), getir: o.getir, indir: o.indir,
    aktivasyon: 'otomatik', anahtarliMi: async (id) => id === '503', bekleMs: 0,
  });
  assert.equal(r.aktivasyon, 'set');
  assert.equal(r.duzen, 'tek-motor');
  const adlar = new Set(M.zipDizini(cikti).keys());
  assert.ok(adlar.has('index.html') && adlar.has('app.config.js') && adlar.has('43e23fce2b7009474555a77.js'));
  assert.ok(adlar.has('electronUpdate.js'), 'kök motor eki arşiv kökünden');
  assert.ok(![...adlar].some((a) => a.startsWith('book') || a.startsWith('temp/')), 'bookN/temp yok');
  assert.ok(![...adlar].some((a) => a.startsWith('assets/111/')), 'kalıbın içeriği taşınmaz');
  for (const id of ['501', '502', '503']) assert.ok(adlar.has(`assets/${id}/data/BookContent.xml`));
  const xml = menuOku(cikti, 'classlibraries/ImWin32.dll');
  assert.match(/<main\b[^>]*>/.exec(xml)[0], /activation="true"/);
  assert.deepEqual(ig.kapaklar(xml).map((c) => c.ID), ['501', '502', '503']);
  const kapi = yazmaKapisi({ zipYolu: cikti, setListesi: LISTE.split('\n').slice(0, 4).join('\n'), tur: 'otomatik' });
  assert.equal(kapi.gecti, true, kapi.nedenler.join(' | '));
  assert.deepEqual(kapi.kitaplar.map((k) => [k.n, k.id]), [[1, '501'], [2, '502'], [3, '503']]);
});

test('uret bookN: Web-Z kabuğu kökte, her kitap ayrı motor, eski kapak/kitap taşınmaz; kapıdan GEÇER', async () => {
  const o = await ortam();
  const cikti = path.join(o.d, 'out', 'build.zip');
  const liste = LISTE.split('\n').slice(0, 4).join('\n');
  const r = await U.uret({
    setId: '74430', setAdi: 'Flashy Grade 4 Set', listeHam: liste, duzen: 'bookN', kabuk: 'kalip', kalipZip: o.kalipZip, cikti,
    calisma: path.join(o.d, 'w'), onbellek: path.join(o.d, 'onb'), getir: o.getir, indir: o.indir, bekleMs: 0,
  });
  assert.equal(r.aktivasyon, 'yok');
  const dz = M.zipDizini(cikti);
  const adlar = new Set(dz.keys());
  assert.ok(!adlar.has('images/book1.png'), 'kalıbın eski kapak görseli taşınmaz');
  assert.ok(!adlar.has('book1/temp/data/storage.im'), 'kullanıcı verisi taşınmaz');
  for (const [n, id] of [[1, '501'], [2, '502'], [4, '503']]) { // liste anahtarı: link 3. satırı tutar
    assert.ok(adlar.has(`book${n}/assets/${id}/thumbs/1.jpg`));
    assert.deepEqual(ig.kapaklar(menuOku(cikti, `book${n}/classlibraries/ImWin32.dll`)).map((c) => c.ID), [id]);
  }
  const ayar = JSON.parse(M.zipGirdiOku(cikti, dz.get('config/settings.json')).toString());
  assert.deepEqual(Object.keys(ayar.books), ['book1', 'book2', 'link3', 'book4']);
  assert.deepEqual(Object.values(ayar.books).map((b) => b.assetId || b.url), ['501', '502', 'https://v.example/x', '503']);
  assert.equal(ayar.setTitle, 'Flashy Grade 4 Set');
  assert.match(M.zipGirdiOku(cikti, dz.get('index.html')).toString(), /<title>Flashy Grade 4 Set<\/title>/);
  const kapi = yazmaKapisi({ zipYolu: cikti, setListesi: liste, tur: 'otomatik' });
  assert.equal(kapi.gecti, true, kapi.nedenler.join(' | '));
});

test('uret YA HEP YA HİÇ: bir kitap İmpark\'ta yoksa build YAZILMAZ (kitap-eksik)', async () => {
  const o = await ortam({ dataBos: ['502'] });
  const cikti = path.join(o.d, 'out', 'build.zip');
  await assert.rejects(U.uret({
    setId: '1', listeHam: LISTE, duzen: 'tek-motor', kalipZip: o.kalipZip, cikti, calisma: path.join(o.d, 'w'),
    onbellek: path.join(o.d, 'onb'), getir: o.getir, indir: o.indir, bekleMs: 0,
  }), (e) => e.kod === 'kitap-eksik' && e.eksik.some((x) => x.id === '502') && !e.eksik.some((x) => x.id === '3100010'));
  assert.equal(fs.existsSync(cikti), false);
});

test('uret: anahtarlı kapak bookN düzeninde reddedilir; otomatik ama anahtarliMi yok = hata', async () => {
  const o = await ortam();
  const ortak = {
    setId: '1', listeHam: '501 | A', kalipZip: o.kalipZip, cikti: path.join(o.d, 'b.zip'),
    calisma: path.join(o.d, 'w'), getir: o.getir, indir: o.indir, bekleMs: 0, duzen: 'bookN',
  };
  await assert.rejects(U.uret({ ...ortak, aktivasyon: 'otomatik', anahtarliMi: async () => true }),
    (e) => e.kod === 'aktivasyon-duzen');
  await assert.rejects(U.uret({ ...ortak, aktivasyon: 'otomatik' }), (e) => e.kod === 'parametre');
  assert.equal(o.sorulan.length, 0, 'karar içerik indirmeden ÖNCE');
});

// ─── Yazma kapısı: tek motorlu set ──────────────────────────────────────────────────────────

function tekMotorGirdileri(idler, { eksikKapak = null, eksikIcerik = null } = {}) {
  const g = ['index.html', 'app.config.js', 'classlibraries/ImWin32.dll'];
  for (const id of idler) {
    if (id !== eksikIcerik) g.push(`assets/${id}/data/BookContent.xml`, `assets/${id}/pages/1.png`);
    if (id !== eksikKapak) g.push(`assets/${id}/thumbs/1.jpg`);
  }
  return g;
}
function okuyucuMenu(menuIdler) {
  const kitaplar = menuIdler.map((id) => ({ id, vs: 1, url: `https://x/ZKitapZipH/${id}-1.zip`, ad: id, grup: '' }));
  const xml = U.tekMotorMenuXml({ kalipXml: KALIP_XML, setId: '9', aktivasyon: 'yok', kitaplar });
  const ham = Buffer.from(ig.menuKodla(xml, () => 0.3, BICIM));
  return { veri: (y) => (y === 'classlibraries/ImWin32.dll' ? ham : null), boyut: () => null };
}
const kapiTek = (idler, liste, o = {}) => yazmaKapisi({
  zipYolu: 'x.zip', listele: () => tekMotorGirdileri(idler, o), okuyucu: okuyucuMenu(o.menu || idler),
  setListesi: liste, tur: o.tur || 'otomatik',
});

test('kapı tek motor: 3 kapak = liste → GEÇER, n menü sırası', () => {
  const k = kapiTek(['31723', '33530', '35675'], '33530 | A\n31723 | B\n35675 | C');
  assert.equal(k.gecti, true, k.nedenler.join(' | '));
  assert.deepEqual(k.kitaplar.map((x) => [x.n, x.id]), [[1, '31723'], [2, '33530'], [3, '35675']]);
  assert.ok(k.notlar.some((n) => /tek motorlu set: kök menüde 3 kapak/.test(n)));
});

test('kapı tek motor: kapak/içerik eksik → RED (kapak-yok / icerik-yok)', () => {
  assert.deepEqual(kapiTek(['1', '2'], '1 | a\n2 | b', { eksikKapak: '2' }).nedenKodlari, ['kapak-yok']);
  assert.deepEqual(kapiTek(['1', '2'], '1 | a\n2 | b', { eksikIcerik: '1' }).nedenKodlari, ['icerik-yok']);
});

test('kapı tek motor: listede olup menüde olmayan → kitap-eksik; menüde olup listede olmayan → liste-disi', () => {
  assert.ok(kapiTek(['1', '2'], '1 | a\n2 | b\n3 | c').nedenKodlari.includes('kitap-eksik'));
  assert.ok(kapiTek(['1', '2', '3'], '1 | a\n2 | b').nedenKodlari.includes('liste-disi-kitap'));
});

test('kapı tek motor: listesiz otomatik = liste-yok; manuel listesiz geçer', () => {
  assert.deepEqual(kapiTek(['1', '2'], null).nedenKodlari, ['liste-yok']);
  assert.equal(kapiTek(['1', '2'], null, { tur: 'manuel' }).gecti, true);
});

test('kapı: kök menüde TEK kapak → eski tek kitap yolu (n=1, değişiklik yok)', () => {
  const k = kapiTek(['7'], '7 | a', { menu: ['7'] });
  assert.equal(k.gecti, true);
  assert.deepEqual(k.kitaplar.map((x) => [x.n, x.id]), [[1, '7']]);
  assert.ok(!k.notlar.some((n) => /tek motorlu/.test(n)));
});

// ─── 02.10 şef kararları: otomatik düzen, tema kancası, link kartı, genel ad ─────────────────

test('duzenKarari: otomatik → set ? tek-motor : bookN; açık bookN + set = RED', () => {
  assert.equal(U.duzenKarari('otomatik', 'set'), 'tek-motor');
  assert.equal(U.duzenKarari('otomatik', 'yok'), 'bookN');
  assert.equal(U.duzenKarari('tek-motor', 'yok'), 'tek-motor');
  assert.throws(() => U.duzenKarari('bookN', 'set'), (e) => e.kod === 'aktivasyon-duzen');
});

test('kapiListesiKur: çevrilen satır link olur, atlanan çıkar, kalanı AYNEN (\\n kaçışlı DB metni dahil)', () => {
  const ham = '501 | A |  |  | Books\\n601 | Games |  | games |\\n602 | X |  | worksheets |';
  const m = new Map([['601', 'https://w.example/go/k/web-stream/book2/index.html'], ['602', null]]);
  assert.equal(U.kapiListesiKur(ham, m), '501 | A |  |  | Books\nlink:https://w.example/go/k/web-stream/book2/index.html | Games');
});

test('uret otomatik: anahtarlı kapak → tek-motor; anahtarsız + kabuk yok → uretec-tema-yok, İÇERİK SORULMADAN', async () => {
  const o = await ortam();
  const ortak = { setId: '7', listeHam: '501 | A\n502 | B', kalipZip: o.kalipZip, calisma: path.join(o.d, 'w'),
    onbellek: path.join(o.d, 'onb'), getir: o.getir, indir: o.indir, bekleMs: 0, aktivasyon: 'otomatik' };
  const r = await U.uret({ ...ortak, cikti: path.join(o.d, 'a.zip'), anahtarliMi: async (id) => id === '502' });
  assert.equal(r.duzen, 'tek-motor');
  const sayac = o.sorulan.length;
  await assert.rejects(U.uret({ ...ortak, cikti: path.join(o.d, 'b.zip'), anahtarliMi: async () => false }),
    (e) => e.kod === 'uretec-tema-yok');
  assert.equal(o.sorulan.length, sayac, 'tema yokken İmpark\'a soru gitmez');
  assert.equal(fs.existsSync(path.join(o.d, 'b.zip')), false);
});

test('tema kancası {dizin}: kök menü dışarıdan; kabuğun bookN/ ve images/book* artığı alınmaz', async () => {
  const o = await ortam();
  const kabuk = path.join(o.d, 'kabuk');
  const ayar = { bookCount: 0, books: {}, setTitle: 'X', tema: 'flashy' };
  await yaz(kabuk, {
    'index.html': '<title>X</title>', 'config/settings.json': JSON.stringify(ayar), 'theme.js': '// flashy',
    'images/book1.png': 'eski', 'images/logo.png': 'flashy-logo', 'book9/artik.txt': 'x',
  });
  const cikti = path.join(o.d, 'k.zip');
  const r = await U.uret({ setId: '74430', setAdi: 'Flashy 4', listeHam: '501 | A\n502 | B', kalipZip: o.kalipZip,
    cikti, calisma: path.join(o.d, 'w'), onbellek: path.join(o.d, 'onb'), getir: o.getir, indir: o.indir,
    bekleMs: 0, kabuk: { dizin: kabuk } });
  assert.equal(r.duzen, 'bookN');
  const dz = M.zipDizini(cikti);
  assert.ok(dz.has('theme.js') && dz.has('images/logo.png'));
  assert.ok(!dz.has('images/book1.png') && !dz.has('book9/artik.txt') && !dz.has('scripts/language-set.js'));
  const a = JSON.parse(M.zipGirdiOku(cikti, dz.get('config/settings.json')).toString());
  assert.deepEqual(Object.keys(a.books), ['book1', 'book2']);
  assert.equal(a.tema, 'flashy', 'kabuğun kendi ayarları korunur');
});

test('zip\'siz oyun: bookN\'de webzAdresi ile LİNK KARTI (+yama bloğu), yoksa atlanır; ikisinde de kapı GEÇER', async () => {
  const o = await ortam(); // 601 için içerik yok → Data boş
  const liste = '501 | A |  |  | Books\n601 | Games |  | games |\n502 | B |  |  | Books';
  const ortak = { setId: '7', listeHam: liste, kalipZip: o.kalipZip, calisma: path.join(o.d, 'w'),
    onbellek: path.join(o.d, 'onb'), getir: o.getir, indir: o.indir, bekleMs: 0, kabuk: 'kalip' };
  const r = await U.uret({ ...ortak, cikti: path.join(o.d, 'l.zip'),
    webzAdresi: (g) => `https://w.example/go/k/web-stream/${g.anahtar}/index.html` });
  assert.deepEqual(r.linkKarti.map((x) => x.assetId), ['601']);
  const dz = M.zipDizini(r.zip);
  const a = JSON.parse(M.zipGirdiOku(r.zip, dz.get('config/settings.json')).toString());
  assert.deepEqual(Object.keys(a.books), ['book1', 'link2', 'book3']);
  assert.equal(a.books.link2.url, 'https://w.example/go/k/web-stream/book2/index.html');
  assert.ok(M.zipGirdiOku(r.zip, dz.get('scripts/cevrimdisi-yama.js')).toString().includes(setEkMod.LINK_ISARET));
  assert.ok(!yazmaKapisi({ zipYolu: r.zip, setListesi: liste, tur: 'otomatik' }).gecti, 'ham listeyle kitap-eksik');
  assert.equal(yazmaKapisi({ zipYolu: r.zip, setListesi: r.kapiListesi, tur: 'otomatik' }).gecti, true);
  const r2 = await U.uret({ ...ortak, cikti: path.join(o.d, 'm.zip') });
  assert.deepEqual(r2.atlanan.map((x) => x.assetId), ['601']);
  assert.equal(r2.linkKarti.length, 0);
  assert.equal(yazmaKapisi({ zipYolu: r2.zip, setListesi: r2.kapiListesi, tur: 'otomatik' }).gecti, true);
});

test('genel ad ("Kitap 1", KV başlığı yok) → BookContent pdfUrl\'den ad; sayısal pdf adı ad sayılmaz', async () => {
  const o = await ortam({ bc: { 501: '<Book pdfUrl="pdf/SUPER-MONSTERS-3-STUDENTS.pdf"/>', 502: '<Book pdfUrl="pdf/15792.pdf"/>' } });
  const r = await U.uret({ setId: '7', listeHam: '501 | Kitap 1\n502 | Kitap 2', duzen: 'tek-motor', kalipZip: o.kalipZip,
    cikti: path.join(o.d, 'g.zip'), calisma: path.join(o.d, 'w'), onbellek: path.join(o.d, 'onb'),
    getir: o.getir, indir: o.indir, bekleMs: 0 });
  assert.deepEqual(r.kitaplar.map((k) => k.ad), ['Super Monsters 3 Students', 'Kitap 2']);
});
