'use strict';

// Üye kitap yedek kaynakları (icerik-yedek.js) + uretec-kaynak bağlantısı. Ağ/SMB YOK: df, metin getirme
// ve SMB denetimi sahte; zip/unzip gerçek (geçici dizinde).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const Y = require('./icerik-yedek');
const M = require('./icerik-merdiven');
const ig = require('../runtime/icerik-guncelleme');
const uk = require('./uretec-kaynak');

const BICIM = { bas: 127, ara: 16, son: 127 };
const SMB_VAR = async () => true;
const SMB_YOK = async () => false;

async function yaz(kok, dosyalar) {
  for (const [yol, veri] of Object.entries(dosyalar)) {
    const t = path.join(kok, yol);
    await fsp.mkdir(path.dirname(t), { recursive: true });
    await fsp.writeFile(t, veri);
  }
}

async function zipla(kaynak, hedef) {
  await fsp.mkdir(path.dirname(hedef), { recursive: true });
  const r = await M.komut('zip', ['-q', '-r', '-X', path.resolve(hedef), '.'], { cwd: kaynak });
  assert.equal(r.code, 0, r.stderr);
}

const gecici = () => fsp.mkdtemp(path.join(os.tmpdir(), 'icerik-yedek-test-'));
const adlar = (zip) => [...M.zipDizini(zip).keys()].filter((a) => !a.endsWith('/')).sort();
const menuXml = (id, vs) => '<?xml version="1.0"?><main activation="false" key="" type="1"><Group ID="0" label="">'
  + `<Tab ID="0" label=""><cover ID="${id}" URL="https://x.example/Uploads/ZKitapZipH/${id}-${vs}.zip" `
  + `version="${vs}" xmlSource="assets/${id}/data/BookContent.xml"></cover></Tab></Group></main>`;

// ─── smbBagliMi ─────────────────────────────────────────────────────────────────────────────

test('smbBagliMi: yalnız df kaynağı // olan bağlama SMB sayılır; yerel dizin ve olmayan yol DEĞİL', async () => {
  const d = await gecici();
  const df = (cikti, code = 0) => async () => ({ code, stdout: cikti, stderr: '' });
  const smb = 'Filesystem 512-blocks Used Available Capacity Mounted on\n//IMPARK;u@172.17.2.23/Storage7 1 1 1 1% /x\n';
  const yerel = 'Filesystem 512-blocks Used Available Capacity Mounted on\n/dev/disk3s5 1 1 1 1% /System/Volumes/Data\n';
  assert.equal(await Y.smbBagliMi(d, df(smb)), true);
  assert.equal(await Y.smbBagliMi(d, df(yerel)), false, 'yol adı kanıt değil (04.10 Storage7 olayı)');
  assert.equal(await Y.smbBagliMi(d, df(smb, 1)), false);
  assert.equal(await Y.smbBagliMi(path.join(d, 'yok'), df(smb)), false);
  assert.equal(Y.smbKoku({ EMPP_IMPARK_SMB_KOKU: '/a/b' }), '/a/b');
});

// ─── webz-smb ───────────────────────────────────────────────────────────────────────────────

test('webzDosyaYedegi: WebDijitapDosyalar/<id> → kendi zip\'imiz, pages2X HARİÇ (H zip ile aynı küme), sürüm = İmpark Vs', async () => {
  const d = await gecici();
  const up = path.join(d, 'Uploads');
  await yaz(path.join(up, 'WebDijitapDosyalar', '11822'), {
    'data/BookContent.xml': '<Book kitapId="0602126"><Page/></Book>', 'data/test.xml': '<t/>',
    'pages/1.png': 'p1', 'thumbs/1.jpg': 't1', 'htmletk/u1/index.html': 'etk', 'audio/t1.mp3': 'a',
    'pages2X/1.png': 'retina', 'pages2x/2.png': 'retina2',
  });
  const y = Y.webzDosyaYedegi({ uploadsKoku: up, smbDenetle: SMB_VAR });
  const r = await y.getir({ id: '11822', imparkVs: 9, calisma: path.join(d, 'w') });
  assert.equal(r.kaynakId, '11822');
  assert.equal(r.vs, 9);
  assert.deepEqual(adlar(r.zip), ['audio/t1.mp3', 'data/BookContent.xml', 'data/test.xml', 'htmletk/u1/index.html',
    'pages/1.png', 'thumbs/1.jpg']);
  const r0 = await y.getir({ id: '11822', imparkVs: null, calisma: path.join(d, 'w2') });
  assert.equal(r0.vs, 0, 'Vs bilinmiyorsa 0');
});

test('webzDosyaYedegi: SMB bağlı değil / dizin yok / yalnız boş pages/ (14835) → yok + açık sebep', async () => {
  const d = await gecici();
  const up = path.join(d, 'Uploads');
  await fsp.mkdir(path.join(up, 'WebDijitapDosyalar', '14835', 'pages'), { recursive: true });
  const c = { id: '14835', imparkVs: 1, calisma: path.join(d, 'w') };
  assert.match((await Y.webzDosyaYedegi({ uploadsKoku: up, smbDenetle: SMB_YOK }).getir(c)).yok, /^SMB bağlı değil/);
  assert.match((await Y.webzDosyaYedegi({ uploadsKoku: null }).getir(c)).yok, /SMB yolu tanımlı değil/);
  const y = Y.webzDosyaYedegi({ uploadsKoku: up, smbDenetle: SMB_VAR });
  assert.equal((await y.getir(c)).yok, 'WebDijitapDosyalar/14835 içinde data/BookContent.xml yok (dizinde: pages)');
  assert.equal((await y.getir({ ...c, id: '60068' })).yok, 'WebDijitapDosyalar/60068 yok');
  assert.equal(fs.existsSync(path.join(d, 'w')), false, 'içerik yoksa zip kurulmaz');
});

// ─── önbellek ───────────────────────────────────────────────────────────────────────────────

test('onbellekYedegi: aynı kitabın EN YENİ sürümü; başka kitabın zip\'i / ad dışı dosya alınmaz', async () => {
  const d = await gecici();
  await yaz(path.join(d, '501'), { '501-3.zip': 'x', '501-12.zip': 'x', '5011-99.zip': 'x', '501-12.zip.yarim': 'x' });
  const y = Y.onbellekYedegi({ onbellek: d });
  const r = await y.getir({ id: '501' });
  assert.equal(path.basename(r.zip), '501-12.zip');
  assert.equal(r.vs, 12);
  assert.equal(r.kaynakId, '501');
  assert.equal((await y.getir({ id: '777' })).yok, 'önbellekte dizin yok');
  await fsp.mkdir(path.join(d, '888'));
  assert.equal((await y.getir({ id: '888' })).yok, 'önbellekte zip yok');
});

// ─── arşiv ──────────────────────────────────────────────────────────────────────────────────

test('arsivYedegi: başka setin build\'indeki bookN/assets/<id> çıkarılır; sürüm o menüden; menüsüz kopya ALINMAZ', async () => {
  const d = await gecici();
  const kok = path.join(d, 'arsiv');
  // 45000: bookN düzeni, kitap 11822 v8 (menülü) → alınır.
  const s1 = path.join(d, 's1');
  await yaz(s1, {
    'book2/classlibraries/ImWin32.dll': ig.menuKodla(menuXml('11822', 8), () => 0.5, BICIM),
    'book2/assets/11822/data/BookContent.xml': '<Book kitapId="0602126"/>', 'book2/assets/11822/pages/1.png': 'p',
    'book2/assets/11822/thumbs/1.jpg': 't', 'book1/assets/999/data/BookContent.xml': '<Book/>',
  });
  await zipla(s1, path.join(kok, '45000', 'build.zip'));
  // 44000 (sıralamada önce): içerik var ama menüde kapağı yok → atlanır, nota düşer.
  const s0 = path.join(d, 's0');
  await yaz(s0, { 'assets/11822/data/BookContent.xml': '<Book/>', 'assets/11822/pages/1.png': 'p' });
  await zipla(s0, path.join(kok, '44000', 'build.zip'));
  const y = Y.arsivYedegi({ arsivKoku: kok });
  const r = await y.getir({ id: '11822', calisma: path.join(d, 'w') });
  assert.equal(r.vs, 8);
  assert.equal(r.kaynakId, '11822');
  assert.equal(r.url, 'https://x.example/Uploads/ZKitapZipH/11822-8.zip');
  assert.match(r.not, /45000\/book2\/assets\/11822/);
  assert.deepEqual(adlar(r.zip), ['data/BookContent.xml', 'pages/1.png', 'thumbs/1.jpg']);
  const yok = await y.getir({ id: '14835', calisma: path.join(d, 'w') });
  assert.equal(yok.yok, "2 arşiv build'inde yok");
  const sadeceMenusuz = Y.arsivYedegi({ arsivKoku: kok });
  await fsp.rm(path.join(kok, '45000'), { recursive: true });
  assert.match((await sadeceMenusuz.getir({ id: '11822', calisma: path.join(d, 'w') })).yok,
    /1 arşiv build'inde yok \(44000: menüde 11822 kapağı yok\)/);
});

test('arsivOnekiBul: kök ve bookN önekleri; benzer adlı (book2x/, a/book1/) önek kabul edilmez', () => {
  assert.equal(Y.arsivOnekiBul(['assets/5/data/BookContent.xml'], '5'), '');
  assert.equal(Y.arsivOnekiBul(['book12/assets/5/data/BookContent.xml'], '5'), 'book12/');
  assert.equal(Y.arsivOnekiBul(['book2x/assets/5/data/BookContent.xml', 'a/book1/assets/5/data/BookContent.xml'], '5'), null);
  assert.equal(Y.arsivOnekiBul(['assets/55/data/BookContent.xml'], '5'), null);
});

// ─── kimlik referansı ───────────────────────────────────────────────────────────────────────

test('kimlikReferansiKur: önce SMB BookContent, yoksa origin HTTP; ikisi de yoksa null; kitap başına bir kez', async () => {
  const d = await gecici();
  const up = path.join(d, 'Uploads');
  await yaz(path.join(up, 'WebDijitapDosyalar', '11822', 'data'), {
    'BookContent.xml': '<?xml version="1.0"?><Book hashed="true" kitapId="0602126" width="624"><Page/></Book>',
  });
  const istek = [];
  const metinGetir = async (url) => {
    istek.push(url);
    if (/\/14835\//.test(url)) throw new Error('HTTP 404');
    if (/\/60068\//.test(url)) return '<html>Just a moment</html>';
    return '<Book kitapId="0602620"/>';
  };
  const ref = Y.kimlikReferansiKur({ origin: 'https://o.example', uploadsKoku: up, metinGetir, smbDenetle: SMB_VAR });
  assert.equal(await ref('11822'), '0602126');
  assert.equal(istek.length, 0, 'SMB okunduysa HTTP sorulmaz');
  assert.equal(await ref('25850'), '0602620');
  assert.equal(istek[0], 'https://o.example/Uploads/WebDijitapDosyalar/25850/data/BookContent.xml');
  assert.equal(await ref('14835'), null);
  assert.equal(await ref('60068'), null, 'Cloudflare sayfası referans değil');
  await ref('14835');
  assert.equal(istek.filter((u) => /14835/.test(u)).length, 1, 'sonuç önbellekte');
  const smbsiz = Y.kimlikReferansiKur({ origin: 'https://o.example', uploadsKoku: up, metinGetir, smbDenetle: SMB_YOK });
  assert.equal(await smbsiz('11822'), '0602620', 'SMB bağlı değilse dosyası okunmaz (HTTP)');
});

// ─── uretec-kaynak bağlantısı ───────────────────────────────────────────────────────────────

async function kalipArsivi(d) {
  const k = path.join(d, 'kalip');
  const xml = '<?xml version="1.0"?><main activation="false" key="" type="1"><Group ID="0" label=""><Tab ID="0" label="">'
    + '<cover ID="111" URL="u" version="3" xmlSource="assets/111/data/BookContent.xml"></cover></Tab></Group></main>';
  await yaz(k, {
    'electron.js': 'require("electron");', 'kurum.txt': '60', 'config/settings.json': '{}', 'scripts/language-set.js': '//',
    'book1/index.html': '<html/>', 'book1/app.config.js': 'var AppConfig = { updateBookEndPoint: "https://s.example/x?id={bookId}" };',
    'book1/classlibraries/ImWin32.dll': ig.menuKodla(xml, () => 0.5, BICIM),
  });
  const arsiv = path.join(d, 'arsiv');
  await zipla(k, path.join(arsiv, '99999', 'build.zip'));
  return arsiv;
}

test('uretecKaynagi: üreteç varsayılan yedekleri (webz-smb → önbellek → arşiv) + kimlik referansıyla çağrılır', async () => {
  const d = await gecici();
  const arsivKoku = await kalipArsivi(d);
  let verilen = null;
  const env = { EMPP_IMPARK_SMB_KOKU: path.join(d, 'impark') };
  await uk.uretecKaynagi({
    job: { bookId: '45479', bookTitle: 'Influence 11', publisherName: 'YDS Publishing' },
    zipPath: path.join(d, 'build.zip'), work: path.join(d, 'is'), arsivKoku, env, onbellek: path.join(d, 'onb'),
    anahtarliMi: async () => false, listeCozFn: async () => ({ ham: '14835 | Old Man |  |  | Books', kaynak: 'claim' }),
    uret: async (a) => { verilen = a; return { kitaplar: [], linkKarti: [], atlanan: [] }; },
  });
  assert.deepEqual(verilen.yedekKaynaklar.map((y) => y.ad), ['webz-smb', 'onbellek', 'arsiv']);
  assert.equal(typeof verilen.kimlikReferansi, 'function');
  const r = await verilen.yedekKaynaklar[0].getir({ id: '14835', imparkVs: 1, calisma: path.join(d, 'w') });
  assert.equal(r.yok, `SMB bağlı değil (${path.join(d, 'impark', 'Storage7/vhosts/akillitahta.ydspublishing.com/httpdocs/Uploads')})`);
  assert.equal(uk.YAYINCILAR['flashy elt'].uploads, 'Storage3/vhosts/yayincilik.net/flashyelt.yayincilik.net/Uploads');
});

// ─── KESİN "yok" işareti (Nadir 06.10 — uye-atla.js sınıf ayrımı) ──────────────────────────────────────

test('kesin işareti: açık "yok" kanıtı kesin:true; ölçülemedi/bağlı değil/zip kurulamadı/okunamayan arşiv kesin DEĞİL', async () => {
  const d = await gecici();
  const up = path.join(d, 'Uploads');
  await fsp.mkdir(path.join(up, 'WebDijitapDosyalar', '14835', 'pages'), { recursive: true });
  const c = { id: '14835', imparkVs: 1, calisma: path.join(d, 'w') };
  // SMB: dizin yok / BookContent yok / yol tanımlı değil → kesin; SMB bağlı değil → ASLA kesin
  const y = Y.webzDosyaYedegi({ uploadsKoku: up, smbDenetle: SMB_VAR });
  assert.equal((await y.getir(c)).kesin, true, 'BookContent yok');
  assert.equal((await y.getir({ ...c, id: '60068' })).kesin, true, 'dizin yok');
  assert.equal((await Y.webzDosyaYedegi({ uploadsKoku: null }).getir(c)).kesin, true, 'SMB yolu tanımlı değil');
  assert.equal((await Y.webzDosyaYedegi({ uploadsKoku: up, smbDenetle: SMB_YOK }).getir(c)).kesin, undefined,
    'SMB bağlı değil = ölçülemedi');
  // zip kurulamadı (zip komutu hata) → kesin değil
  await yaz(path.join(up, 'WebDijitapDosyalar', '777'), { 'data/BookContent.xml': '<Book/>' });
  const zk = Y.webzDosyaYedegi({ uploadsKoku: up, smbDenetle: SMB_VAR, komut: async () => ({ code: 12, stderr: 'x', stdout: '' }) });
  const zr = await zk.getir({ ...c, id: '777' });
  assert.match(zr.yok, /zip kurulamadı/);
  assert.equal(zr.kesin, undefined);
  // önbellek: dizin yok / zip yok → kesin
  const ob = Y.onbellekYedegi({ onbellek: d });
  assert.equal((await ob.getir({ id: '1' })).kesin, true);
  assert.equal((await Y.onbellekYedegi({ onbellek: null }).getir({ id: '1' })).kesin, true);
  // arşiv: temiz "yok" kesin; notlu (menüde kapak yok) / okunamayan build kesin DEĞİL
  const kok = path.join(d, 'arsiv');
  const s0 = path.join(d, 's0');
  await yaz(s0, { 'assets/11822/data/BookContent.xml': '<Book/>' });
  await zipla(s0, path.join(kok, '44000', 'build.zip'));
  const ar = Y.arsivYedegi({ arsivKoku: kok });
  assert.equal((await ar.getir({ id: '14835', calisma: path.join(d, 'w') })).kesin, true, 'temiz yok');
  const notlu = await ar.getir({ id: '11822', calisma: path.join(d, 'w') });
  assert.match(notlu.yok, /menüde 11822 kapağı yok/);
  assert.equal(notlu.kesin, false, 'notlu yok kesin değil');
  await fsp.mkdir(path.join(kok, '55000'), { recursive: true });
  await fsp.writeFile(path.join(kok, '55000', 'build.zip'), 'zip-degil');
  const bozuk = await Y.arsivYedegi({ arsivKoku: kok }).getir({ id: '14835', calisma: path.join(d, 'w') });
  assert.equal(bozuk.kesin, false, 'okunamayan build varsa kesin değil');
  assert.equal((await Y.arsivYedegi({ arsivKoku: path.join(d, 'yok-kok') }).getir({ id: '1' })).kesin, true);
});
