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
async function ortam({ idler = ['501', '502', '503'], dataBos = [], bc = {}, kapaksiz = [], sayfasiz = [] } = {}) {
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
    // Kök Electron/İmpark çalışma dosyaları (45540 kökünden örnek) + sf425 kabuk artıkları.
    'electron.js': 'const { app } = require("electron");\napp.whenReady().then(() => {});\n',
    'set_app.config': 'const AppConfig = {\n    appName: "Akıllı Tahta",\n};\n',
    'old_app.config.js': 'const AppConfig = {\n\tbaseEndpointUrl: "https://akillitahta.ydspublishing.com",\n};\n',
    'core/kurumlogo.png': Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n', 'latin1'), Buffer.alloc(150, 7)]),
    'core/icons/ButtonHand.svg': '<svg/>', 'version.txt': '1.12.7', '2030d1504cb4d568b6da.main.js': '// motor paketi',
    'languages/tr.json': '{}', 'i18n/tr.js': '// i18n', 'features/live-test.html': '<html/>', 'assets2/book1.png': 'yds-buton',
    'styles/language-set.css': '/* sf425 */',
    'book1/index.html': '<html>motor</html>', 'book1/electron.js': 'require("electron");',
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
    const ic = { ...icerik(id), ...(bc[id] ? { 'data/BookContent.xml': bc[id] } : {}) };
    if (kapaksiz.includes(id)) delete ic['thumbs/1.jpg'];
    if (sayfasiz.includes(id)) delete ic['pages/1.png'];
    await yaz(k, ic);
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

test('webzMenuDosyalari A1 kapısı: kabuk tek motor menüsü (kapak alanı) taşıyorsa bookN menüsüyle YAZILMAZ', () => {
  const ayar = { books: { 'kapak-501': { assetId: '501', kapak: '501', path: '.', title: 'A' } }, setTitle: 'S' };
  assert.throws(() => U.webzMenuDosyalari({
    yama: `window.__setSettings = ${JSON.stringify(ayar)};`, ayar: JSON.stringify(ayar), tanim: null, index: '<title>S</title>',
  }, { setAdi: 'S', girdiler: [{ dizin: 'book1', id: '501', ad: 'A', grup: '' }] }), (e) => e.kod === 'kalip' && /A1/.test(e.message));
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

test('uret: kapaksız içerik (thumbs/1.jpg yok, pages/1 var) KABUL — ilk sayfa kapak olur; kapıdan GEÇER', async () => {
  const o = await ortam({ kapaksiz: ['502'] });
  const cikti = path.join(o.d, 'out', 'build.zip');
  const liste = LISTE.split('\n').slice(0, 4).join('\n');
  await U.uret({
    setId: '74431', listeHam: liste, duzen: 'bookN', kabuk: 'kalip', kalipZip: o.kalipZip, cikti,
    calisma: path.join(o.d, 'w'), onbellek: path.join(o.d, 'onb'), getir: o.getir, indir: o.indir, bekleMs: 0,
  });
  const dz = M.zipDizini(cikti);
  assert.equal(M.zipGirdiOku(cikti, dz.get('book2/assets/502/thumbs/1.jpg')).toString(), 'sayfa-502');
  assert.equal(M.zipGirdiOku(cikti, dz.get('book1/assets/501/thumbs/1.jpg')).toString(), 'kapak-501', 'kapaklı kitap aynen');
  const kapi = yazmaKapisi({ zipYolu: cikti, setListesi: liste, tur: 'otomatik' });
  assert.equal(kapi.gecti, true, kapi.nedenler.join(' | '));
});

test('uret: kapak da ilk sayfa da yoksa RED (kitap-eksik), build yazılmaz', async () => {
  const o = await ortam({ kapaksiz: ['502'], sayfasiz: ['502'] });
  const cikti = path.join(o.d, 'out', 'build.zip');
  await assert.rejects(U.uret({
    setId: '1', listeHam: LISTE, duzen: 'tek-motor', kalipZip: o.kalipZip, cikti, calisma: path.join(o.d, 'w'),
    onbellek: path.join(o.d, 'onb'), getir: o.getir, indir: o.indir, bekleMs: 0,
  }), (e) => e.kod === 'kitap-eksik' && e.eksik.some((x) => x.id === '502' && /thumbs\/1\.jpg/.test(x.sebep)));
  assert.equal(fs.existsSync(cikti), false);
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
  const g = ['index.html', 'electron.js', 'app.config.js', 'classlibraries/ImWin32.dll'];
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

// ─── Faz 3: Flashy — tema kabuğu + yayıncı dönüşümü ─────────────────────────────────────────

const temaKabuk = require('./webz-tema-kabuk');
const crypto = require('crypto');
const FLASHY_LOGO = fs.readFileSync(path.join(temaKabuk.TEMA_KOKU, 'web-proxy-modern', 'images', 'logo.png'));
const PNG_1 = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\u001a\n', 'latin1'), Buffer.alloc(24, 3)]);
const WEBP_1 = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8, 2)]);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const DONUSUM = { kurum: '310', logo: FLASHY_LOGO, baseEndpointUrl: 'https://akillitahta.ydspublishing.com' };

test('tabanUcYaz: varsa değiştirir, yoksa AppConfig başına ekler; AppConfig yoksa RED', () => {
  assert.equal(U.tabanUcYaz('const AppConfig = {\n  baseEndpointUrl: "https://a.example", x: 1 };', 'https://b.example'),
    'const AppConfig = {\n  baseEndpointUrl: "https://b.example", x: 1 };');
  assert.match(U.tabanUcYaz('var AppConfig = { x: 1 };', 'https://b.example'),
    /^var AppConfig = \{\n {4}baseEndpointUrl: "https:\/\/b\.example",\s*x: 1 \};$/);
  assert.throws(() => U.tabanUcYaz('window.X = {};', 'https://b.example'), (e) => e.kod === 'donusum');
});

test('logo gizleme: motorun 256-b şeması kendi tersidir; gizli logo "düz" sayılmaz (çevrimiçi ezilmez)', () => {
  const g = U.logoGizle(FLASHY_LOGO);
  assert.equal(U.logoDuzMu(FLASHY_LOGO), true);
  assert.equal(U.logoDuzMu(g), false);
  assert.deepEqual(U.logoGizle(g), FLASHY_LOGO);
  assert.deepEqual(g.subarray(100), FLASHY_LOGO.subarray(100), 'yalnız ilk 100 bayt');
});

test('donusumDenetle: kurum sayı, logo düz PNG, uç https kökü — değilse parametre hatası', () => {
  assert.equal(U.donusumDenetle(null), null);
  assert.equal(U.donusumDenetle(DONUSUM).kurum, '310');
  for (const bozuk of [{ kurum: 'x' }, { logo: U.logoGizle(FLASHY_LOGO) }, { logo: WEBP_1 },
    { baseEndpointUrl: 'http://a.example' }, { baseEndpointUrl: 'https://a.example/yol' }]) {
    assert.throws(() => U.donusumDenetle({ ...DONUSUM, ...bozuk }), (e) => e.kod === 'parametre', JSON.stringify(Object.keys(bozuk)));
  }
});

test('alanOku/planKur: panel kapağı (3. alan) plana girer, grup (5. alan) aynen', () => {
  const p = U.planKur({ listeHam: '501 | A | data:image/png;base64,AAAA | book | G\n502 | B' });
  assert.deepEqual(p.kitaplar.map((k) => [k.id, k.kapak, k.grup]), [['501', 'data:image/png;base64,AAAA', 'G'], ['502', null, '']]);
});

const FLASHY_LISTE = [
  `501 | Practice Book | data:image/webp;base64,${WEBP_1.toString('base64')} | book |`,
  '502 | Kitap 2 | https://kapak.example/502.png | book |',
  '503 | Test Book | https://kapak.example/yok.png |  |',
  'link:https://w.example/ws | Worksheet',
].join('\n');

async function flashyUret(o, ek = {}) {
  const getirilen = [];
  const r = await U.uret({
    setId: '74430', setAdi: 'Flashy Grade 4 Set', listeHam: FLASHY_LISTE, kalipZip: o.kalipZip,
    cikti: path.join(o.d, 'flashy', 'build.zip'), calisma: path.join(o.d, 'cal'), duzen: 'otomatik',
    aktivasyon: 'yok', kabuk: { tema: 'web-proxy-modern' }, motorDonusumu: DONUSUM,
    kapakGetir: async (u) => { getirilen.push(u); if (/yok/.test(u)) throw new Error('404'); return PNG_1; },
    onbellek: path.join(o.d, 'onb'), getir: o.getir, indir: o.indir, bekleMs: 0, sahneyiTut: true, ...ek,
  });
  return { r, getirilen };
}

test('uret Flashy: kök = tema kabuğu (kalıp kökü AÇILMAZ), panel kapakları, altbilgi, dört nokta KANITLI', async () => {
  const o = await ortam();
  const { r, getirilen } = await flashyUret(o);
  const kok = path.join(r.sahne, 'build');
  const oku = (y) => fs.readFileSync(path.join(kok, y));
  assert.equal(r.duzen, 'bookN');
  assert.equal(r.kabuk, 'tema:web-proxy-modern');
  // Kalıbın kökü açılmadı: sf425 izleri yok, tema imzası var.
  assert.equal(fs.existsSync(path.join(kok, 'scripts/language-set.js')), false);
  // Kök ÇALIŞMA dosyaları korunur (saha 74430 pardus RED: electron.js yoktu); index dosyaları kalıptan gelmez.
  for (const y of ['electron.js', 'electronUpdate.js', 'set_app.config', 'old_app.config.js', 'version.txt',
    'core/icons/ButtonHand.svg', '2030d1504cb4d568b6da.main.js']) {
    assert.equal(fs.existsSync(path.join(kok, y)), true, `çalışma dosyası korunmalı: ${y}`);
  }
  for (const y of ['languages/tr.json', 'i18n/tr.js', 'features/live-test.html', 'assets2/book1.png',
    'styles/language-set.css', 'images/book1.png']) {
    assert.equal(fs.existsSync(path.join(kok, y)), false, `index dosyası kalıptan gelmemeli: ${y}`);
  }
  // Giriş: main.js = electron.js kopyası, sözdizimi geçerli (node --check).
  assert.deepEqual(oku('main.js'), oku('electron.js'));
  const nc = await M.komut(process.execPath, ['--check', path.join(kok, 'main.js')]);
  assert.equal(nc.code, 0, nc.stderr);
  // Kök yapılandırma + kök logo da dönüşür (beşinci nokta: kök çalışma dosyaları).
  assert.match(oku('set_app.config').toString(), /baseEndpointUrl: "https:\/\/akillitahta\.ydspublishing\.com"/);
  assert.match(oku('old_app.config.js').toString(), /baseEndpointUrl: "https:\/\/akillitahta\.ydspublishing\.com"/);
  assert.equal(sha(U.logoGizle(oku('core/kurumlogo.png'))), sha(FLASHY_LOGO));
  assert.deepEqual(r.donusum.kokYapilandirma, ['set_app.config', 'old_app.config.js']);
  const idx = oku('index.html').toString('utf8');
  assert.match(idx, /<meta name="empp-webz-tema" content="web-proxy-modern" \/>/);
  assert.match(idx, /<title>Flashy Grade 4 Set<\/title>/);
  assert.doesNotMatch(idx, /Web Sürümü/);
  assert.match(idx, /<span>Akıllı Tahta<\/span>/);
  assert.deepEqual(oku('images/logo.png'), FLASHY_LOGO);
  // Kapak: data URI → images/book1.webp; http → indirildi (book2.png); indirilemeyen → thumbs yedeği.
  const ayar = JSON.parse(oku('config/settings.json'));
  assert.equal(ayar.books.book1.coverUrl, 'images/book1.webp');
  assert.deepEqual(oku('images/book1.webp'), WEBP_1);
  assert.equal(ayar.books.book2.coverUrl, 'images/book2.png');
  assert.equal(ayar.books.book3.coverUrl, 'book3/assets/503/thumbs/1.jpg');
  assert.equal(ayar.books.link4.type, 'link');
  assert.deepEqual(getirilen, ['https://kapak.example/502.png', 'https://kapak.example/yok.png']);
  assert.deepEqual(r.kapak, { panel: 2, yedek: 1 });
  assert.equal(ayar.books.book2.title, 'Kitap 2', 'genel ad BookContent pdfUrl yoksa kalır');
  // Dört nokta (diskten): iki kurum.txt, gizli Flashy logosu, baseEndpointUrl.
  assert.equal(oku('kurum.txt').toString(), '310');
  for (const d of ['book1', 'book2', 'book3']) {
    assert.equal(oku(`${d}/kurum.txt`).toString(), '310');
    const logo = oku(`${d}/core/kurumlogo.png`);
    assert.equal(U.logoDuzMu(logo), false);
    assert.equal(sha(U.logoGizle(logo)), sha(FLASHY_LOGO));
    assert.match(oku(`${d}/app.config.js`).toString(), /baseEndpointUrl: "https:\/\/akillitahta\.ydspublishing\.com"/);
  }
  assert.deepEqual(r.donusum.motorlar, ['book1', 'book2', 'book3']);
  assert.equal(r.donusum.logoSha256, sha(FLASHY_LOGO));
  const oz = U.uretecOzeti(r);
  assert.deepEqual([oz.kabuk, oz.donusum, oz.kapak], ['tema:web-proxy-modern',
    { kurum: '310', uc: 'https://akillitahta.ydspublishing.com', motor: 3 }, { panel: 2, yedek: 1 }]);
  // Yazma kapısı (bookN + tema kökü) geçer.
  const k = yazmaKapisi({ zipYolu: r.zip, setListesi: r.kapiListesi, tur: 'otomatik' });
  assert.equal(k.gecti, true, JSON.stringify(k.nedenKodlari));
  await fsp.rm(r.sahne, { recursive: true, force: true });
});

test('uret Flashy: tema kabuğu kalıpta sf425 aramaz (language-set.js yok) — kalip kabuğu ise tema-yok', async () => {
  const o = await ortam();
  // Kalıbın kökünü sf425'siz yeniden kur: yalnız motor.
  const d2 = await fsp.mkdtemp(path.join(os.tmpdir(), 'uretec-sfsiz-'));
  const ac = await M.komut('unzip', ['-q', o.kalipZip, 'book1/*', 'electron.js', '-d', d2]);
  assert.equal(ac.code, 0);
  const sfsiz = path.join(d2, 'k.zip');
  await zipla(d2, sfsiz);
  assert.equal(U.kalipOku(sfsiz).kabuk, false);
  assert.equal(U.kabukGecerliMi({ tema: 'web-proxy-modern' }, U.kalipOku(sfsiz)), true);
  assert.equal(U.kabukGecerliMi({ tema: 'yok-tema' }, U.kalipOku(sfsiz)), false);
  const { r } = await flashyUret({ ...o, kalipZip: sfsiz });
  assert.equal(r.kabuk, 'tema:web-proxy-modern');
  await assert.rejects(flashyUret({ ...o, kalipZip: sfsiz }, { kabuk: 'kalip' }), (e) => e.kod === 'uretec-tema-yok');
});

test('kök giriş dosyası yoksa (electron.js/main.js) tema üretimi RED kalip — yedek şablona düşülmez', async () => {
  const o = await ortam();
  const d2 = await fsp.mkdtemp(path.join(os.tmpdir(), 'uretec-girissiz-'));
  const ac = await M.komut('unzip', ['-q', o.kalipZip, '-x', 'electron.js', '-d', d2]);
  assert.equal(ac.code, 0);
  const girissiz = path.join(d2, 'k.zip');
  await zipla(d2, girissiz);
  await assert.rejects(flashyUret({ ...o, kalipZip: girissiz }), (e) => e.kod === 'kalip' && /giriş dosyası/.test(e.message));
});

test('motorDonusumuDogrula: tek nokta bile tutmazsa RED (kurum / logo düz / uç)', async () => {
  const o = await ortam();
  const { r } = await flashyUret(o);
  const kok = path.join(r.sahne, 'build');
  const bozucular = [
    () => fs.writeFileSync(path.join(kok, 'book2/kurum.txt'), '60'),
    () => fs.writeFileSync(path.join(kok, 'book1/core/kurumlogo.png'), FLASHY_LOGO),
    () => fs.writeFileSync(path.join(kok, 'book3/app.config.js'), 'var AppConfig = { baseEndpointUrl: "https://x.example" };'),
    () => fs.writeFileSync(path.join(kok, 'kurum.txt'), '60'),
    () => fs.writeFileSync(path.join(kok, 'set_app.config'), 'const AppConfig = { baseEndpointUrl: "https://x.example" };'),
    () => fs.writeFileSync(path.join(kok, 'core/kurumlogo.png'), FLASHY_LOGO),
  ];
  for (const boz of bozucular) {
    const yedek = path.join(o.d, `yedek-${Math.random()}`);
    await fsp.cp(kok, yedek, { recursive: true });
    boz();
    assert.throws(() => U.motorDonusumuDogrula(kok, r.donusum.motorlar, DONUSUM), (e) => e.kod === 'donusum');
    await fsp.rm(kok, { recursive: true, force: true });
    await fsp.rename(yedek, kok);
  }
  assert.equal(U.motorDonusumuDogrula(kok, r.donusum.motorlar, DONUSUM).kurum, '310');
  await fsp.rm(r.sahne, { recursive: true, force: true });
});

// ─── Yedek içerik kaynağı (04.10: İmpark zip'i yok/başka kitabın/Data boş → kendi kaynağımız) ──────────

const LISTE3 = LISTE.split('\n').slice(0, 4).join('\n'); // 501, 502, link, 503

/** `id` kitabı için yedek içerik zip'i; `zid` BookContent kitapId'si, kapak işareti `yedek-<id>`. */
async function yedekZip(d, id, { zid = id, ad = `${id}-yedek-${Math.random()}.zip` } = {}) {
  const k = path.join(d, `yedek-ic-${ad}`);
  await yaz(k, {
    'data/BookContent.xml': `<Book kitapId="${zid}"><Page/></Book>`, 'thumbs/1.jpg': `yedek-${id}`,
    'pages/1.png': `ysayfa-${id}`,
  });
  const z = path.join(d, ad);
  await zipla(k, z);
  return z;
}

function sahteYedek(ad, sonuc) {
  const cagri = [];
  return { ad, cagri, getir: async (c) => { cagri.push(c); return typeof sonuc === 'function' ? sonuc(c) : sonuc; } };
}

/** 502 için İmpark davranışını değiştiren getir/indir sarmalayıcıları. */
function imparkBoz(o, { data, vs = 7, status = 200, indirHata = false } = {}) {
  return {
    getir: async (url) => {
      if (!/id=502&/.test(url)) return o.getir(url);
      if (status !== 200) return { status, govde: 'sunucu hatası' };
      return { status: 200, govde: JSON.stringify({ Success: true, Data: data, Vs: vs }) };
    },
    indir: async (url, hedef) => {
      if (indirHata && /\/502-/.test(url)) throw new Error(`indirilemedi (indirme kodu 22): ${url}`);
      return o.indir(url, hedef);
    },
  };
}

function uretTek(o, ek) {
  return U.uret({
    setId: '45479', setAdi: 'Influence 11', listeHam: LISTE3, duzen: 'tek-motor', kalipZip: o.kalipZip,
    cikti: path.join(o.d, 'out', 'build.zip'), calisma: path.join(o.d, 'w'), onbellek: path.join(o.d, 'onb'),
    getir: o.getir, indir: o.indir, bekleMs: 0, ...ek,
  });
}

test('yedek: İmpark zip\'i 404 (14835 sınıfı) → yedek kaynaktan kurulur; sürüm/kapak yedekten, kapıdan GEÇER', async () => {
  const o = await ortam();
  const zip = await yedekZip(o.d, '502');
  const y = sahteYedek('webz-smb', { zip, kaynakId: '502', vs: 7, not: 'SMB WebDijitapDosyalar/502' });
  const r = await uretTek(o, {
    ...imparkBoz(o, { data: 'https://x.example/Uploads/ZKitapZipH/502-7.zip', indirHata: true }),
    yedekKaynaklar: [y], kimlikReferansi: async (id) => id,
  });
  assert.equal(y.cagri.length, 1, 'yedek yalnız 502 için');
  assert.equal(y.cagri[0].id, '502');
  assert.equal(y.cagri[0].imparkVs, 7);
  assert.deepEqual(r.yedek, [{ id: '502', kaynak: 'webz-smb', vs: 7, kimlik: 'kitapId' }]);
  assert.deepEqual(r.kitaplar.map((k) => [k.id, k.kaynak]), [['501', 'impark'], ['502', 'webz-smb'], ['503', 'impark']]);
  assert.equal(M.zipGirdiOku(r.zip, M.zipDizini(r.zip).get('assets/502/thumbs/1.jpg')).toString(), 'yedek-502');
  const xml = menuOku(r.zip, 'classlibraries/ImWin32.dll');
  assert.equal(ig.kapaklar(xml).find((c) => c.ID === '502').version, 7);
  assert.deepEqual(U.uretecOzeti(r).yedek, ['502:webz-smb']);
  const kapi = yazmaKapisi({ zipYolu: r.zip, setListesi: LISTE3, tur: 'otomatik' });
  assert.equal(kapi.gecti, true, kapi.nedenler.join(' | '));
  assert.equal(fs.existsSync(path.join(o.d, 'w', `uretec-yedek-${process.pid}`)), false, 'yedek çalışma dizini silindi');
});

test('yedek: Data BAŞKA kitabın zip\'i (11822 "60 ≠ 11822") → o zip ALINMAZ, yedek İmpark Vs ile kurulur', async () => {
  const o = await ortam();
  const zip = await yedekZip(o.d, '502');
  const y = sahteYedek('webz-smb', (c) => ({ zip, kaynakId: '502', vs: c.imparkVs }));
  const b = imparkBoz(o, { data: 'https://x.example/Uploads/ZKitapZipH/60-25685.zip', vs: 9 });
  const indirilen = [];
  const r = await uretTek(o, {
    getir: b.getir, indir: async (url, h) => { indirilen.push(url); return b.indir(url, h); },
    yedekKaynaklar: [y], kimlikReferansi: async () => '502',
  });
  assert.ok(!indirilen.some((u) => /60-25685/.test(u)), 'başka kitabın zip\'i indirilmez');
  assert.equal(y.cagri[0].imparkVs, 9);
  assert.equal(ig.kapaklar(menuOku(r.zip, 'classlibraries/ImWin32.dll')).find((c) => c.ID === '502').version, 9);
  assert.equal(r.yedek[0].kaynak, 'webz-smb');
});

test('yedek: HİÇBİR kaynakta yok (60068 sınıfı, Data boş) → ertele; sebep denenenleri sayar, build yok', async () => {
  const o = await ortam({ dataBos: ['502'] });
  const a = sahteYedek('webz-smb', { yok: 'WebDijitapDosyalar/502 yok' });
  const b = sahteYedek('onbellek', { yok: 'önbellekte dizin yok' });
  const c = sahteYedek('arsiv', { yok: "41 arşiv build'inde yok" });
  const cikti = path.join(o.d, 'out', 'build.zip');
  await assert.rejects(uretTek(o, { yedekKaynaklar: [a, b, c], kimlikReferansi: async () => null }), (e) => {
    assert.equal(e.kod, 'kitap-eksik');
    const s = e.eksik.find((x) => x.id === '502').sebep;
    assert.match(s, /^hiçbir kaynakta yok — İmpark: İmpark'ta içerik yok \(Data boş\); denenenler: /);
    assert.match(s, /webz-smb: WebDijitapDosyalar\/502 yok \| onbellek: önbellekte dizin yok \| arsiv: 41 arşiv build'inde yok$/);
    assert.match(e.message, /hiçbir kaynakta yok/);
    return true;
  });
  assert.equal(a.cagri[0].imparkVs, 0, 'Data boş cevabının Vs\'i (0) yedeğe gider');
  assert.equal(fs.existsSync(cikti), false);
});

test('yedek: YANLIŞ kimlikli içerik REDDEDİLİR (BookContent kitapId ≠ İmpark referansı), sıradaki denenir', async () => {
  const o = await ortam();
  const yanlis = sahteYedek('arsiv', { zip: await yedekZip(o.d, '502', { zid: '06003144' }), kaynakId: '502', vs: 3 });
  const dogru = sahteYedek('onbellek', { zip: await yedekZip(o.d, '502', { zid: '0602126' }), kaynakId: '502', vs: 5 });
  const bozuk = imparkBoz(o, { data: 'https://x.example/Uploads/ZKitapZipH/502-7.zip', indirHata: true });
  const r = await uretTek(o, { ...bozuk, yedekKaynaklar: [yanlis, dogru], kimlikReferansi: async () => '0602126' });
  assert.deepEqual(r.yedek, [{ id: '502', kaynak: 'onbellek', vs: 5, kimlik: 'kitapId' }]);
  // Yalnız yanlış aday varsa: build YAZILMAZ, sebep "başka kitap".
  const o2 = await ortam();
  const yalniz = sahteYedek('arsiv', { zip: await yedekZip(o2.d, '502', { zid: '06003144' }), kaynakId: '502', vs: 3 });
  await assert.rejects(uretTek(o2, {
    ...imparkBoz(o2, { data: 'https://x.example/Uploads/ZKitapZipH/502-7.zip', indirHata: true }),
    yedekKaynaklar: [yalniz], kimlikReferansi: async () => '0602126',
  }), (e) => e.kod === 'kitap-eksik'
    && /arsiv: RED BookContent kitapId 06003144 ≠ İmpark'ın 502 kitapId'si 0602126 \(başka kitap\)/.test(e.eksik[0].sebep));
  assert.equal(fs.existsSync(path.join(o2.d, 'out', 'build.zip')), false);
});

test('yedek: kaynak kimliği ≠ kitap, geçersiz sürüm ve bozuk düzen RED; referans yoksa kaynak kimliği yeter', async () => {
  const o = await ortam();
  const z = await yedekZip(o.d, '502');
  const bosDizin = path.join(o.d, 'bos-ic');
  await yaz(bosDizin, { 'pages/.keep': '' });
  const bosZip = path.join(o.d, 'bos.zip');
  await zipla(bosDizin, bosZip);
  const adaylar = [
    sahteYedek('a', { zip: z, kaynakId: '999', vs: 1 }),
    sahteYedek('b', { zip: z, kaynakId: '502', vs: -1 }),
    sahteYedek('c', { zip: bosZip, kaynakId: '502', vs: 1 }),
    sahteYedek('d', async () => { throw new Error('SMB koptu'); }),
    sahteYedek('e', { zip: z, kaynakId: '502', vs: 4 }),
  ];
  const r = await uretTek(o, {
    ...imparkBoz(o, { data: 'https://x.example/Uploads/ZKitapZipH/502-7.zip', indirHata: true }),
    yedekKaynaklar: adaylar, kimlikReferansi: async () => null,
  });
  assert.deepEqual(r.yedek, [{ id: '502', kaynak: 'e', vs: 4, kimlik: 'kaynak' }]);
  assert.ok(adaylar.every((y) => y.cagri.length === 1));
});

test('yedek: İmpark\'a ULAŞILAMADI (HTTP 500) ya da kitap-dışı varlık → yedek DENENMEZ (geçici / link kartı)', async () => {
  const o = await ortam();
  const y = sahteYedek('webz-smb', { zip: await yedekZip(o.d, '502'), kaynakId: '502', vs: 7 });
  await assert.rejects(uretTek(o, { ...imparkBoz(o, { status: 500 }), yedekKaynaklar: [y], kimlikReferansi: async () => '502' }),
    (e) => e.kod === 'kitap-eksik' && /İmpark ölçülemedi: HTTP 500/.test(e.eksik[0].sebep));
  assert.equal(y.cagri.length, 0, 'ağ/sunucu hatasında yedekle tahmin üretilmez');
  // Games (contentType games, Data boş) → link/atla yolu; yedek ona sorulmaz.
  const o2 = await ortam();
  const y2 = sahteYedek('webz-smb', { yok: 'yok' });
  const r = await U.uret({
    setId: '1', listeHam: LISTE, duzen: 'tek-motor', kalipZip: o2.kalipZip, cikti: path.join(o2.d, 'b.zip'),
    calisma: path.join(o2.d, 'w'), onbellek: path.join(o2.d, 'onb'), getir: o2.getir, indir: o2.indir, bekleMs: 0,
    yedekKaynaklar: [y2], kimlikReferansi: async () => null,
  });
  assert.equal(y2.cagri.length, 0);
  assert.deepEqual(r.atlanan.map((g) => g.assetId), ['3100010']);
  assert.deepEqual(r.yedek, []);
});
