'use strict';

/**
 * Runner × INDEX ÜRETECİ (02.10) — gerçek `processJob`, uçtan uca, sahte sunucuyla. Taban ve kaynak
 * arşivi OLMAYAN r2-kur işi: üreteç build'i kurar (sahte İmpark: getir/indir), zincir AYNEN —
 * merdiven (casus) → set eki (casus) → imKeys (test-yalitim sahtesi) → yazma kapısı → presign → PUT →
 * tamamla (+ `uretec` özeti) → paketleyici. Erteleme yolları: kalıp/tema/liste yok → failed YOK.
 * Ayrıca `uretec-kaynak.js` saf parçaları (liste dönüşümü, KV yedeği, kalıp seçimi). Ağ YOK.
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();

const runner = require('./runner.js');
const { CONFIG, processJob, kaynakAdim } = runner;
const M = require('./icerik-merdiven');
const ig = require('../runtime/icerik-guncelleme');
const uk = require('./uretec-kaynak');

YALITIM.configUygula(CONFIG);
after(() => YALITIM.temizle());

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `uretec-${ad}-`));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const SABLON = 'https://www.sorucoz.tv/TestlerMobil/GetKitapGuncellemeBilgi?id={bookId}&setMi={isSet}&versiyon={version}';
const KALIP_XML = '<?xml version="1.0"?><main activation="false" key="" label="İmpark Eğitim" type="1" lisans="">'
  + '<Group ID="0" label=""><Tab ID="0" label=""><cover guId="" ID="111" etkID="111" source="assets/111/cover.png" '
  + 'corpID="60" actName="ESKI" URL="https://x.example/Uploads/ZKitapZipH/111-3.zip" version="3" '
  + 'xmlSource="assets/111/data/BookContent.xml"></cover></Tab></Group></main>';

async function yaz(kok, dosyalar) {
  for (const [yol, veri] of Object.entries(dosyalar)) {
    await fsp.mkdir(path.dirname(path.join(kok, yol)), { recursive: true });
    await fsp.writeFile(path.join(kok, yol), veri);
  }
}
async function zipla(kaynak, hedef) {
  const r = await M.komut('zip', ['-q', '-r', '-X', path.resolve(hedef), '.'], { cwd: kaynak });
  assert.equal(r.code, 0, r.stderr);
}

/** Arşiv: başka bir setin (99999) kurum 60 build'i (Web-Z kabuğu + motor); içerik zip'leri; sahte İmpark. */
async function ortam({ kurum = '60', kabuk = true, idler = ['501', '502'] } = {}) {
  const d = tmp('ortam');
  const kalip = path.join(d, 'kalip');
  const ayar = { bookCount: 1, books: { book1: { assetId: '111', title: 'Eski' } }, setTitle: 'Eski' };
  await yaz(kalip, {
    ...(kabuk ? {
      'index.html': '<title>Eski</title>', 'config/settings.json': JSON.stringify(ayar),
      'scripts/language-set.js': '//', 'scripts/cevrimdisi-yama.js': `window.__setSettings = ${JSON.stringify(ayar)};\n`,
    } : { 'index.html': '<html>motor kopyası</html>' }),
    'kurum.txt': kurum, 'book1/kurum.txt': kurum, 'book1/index.html': '<html>motor</html>', 'book1/electron.js': 'require("electron");',
    'electron.js': 'const { app } = require("electron");\n', 'set_app.config': 'const AppConfig = {\n};\n',
    'book1/app.config.js': `var AppConfig = { updateBookEndPoint: "${SABLON}" };`,
    'book1/classlibraries/ImWin32.dll': ig.menuKodla(KALIP_XML, () => 0.5, { bas: 127, ara: 16, son: 127 }),
    'book1/assets/111/data/BookContent.xml': '<Book/>', 'book1/assets/111/thumbs/1.jpg': 'k', 'book1/assets/111/pages/1.png': 'p',
  });
  const arsivKoku = path.join(d, 'arsiv');
  await fsp.mkdir(path.join(arsivKoku, '99999'), { recursive: true });
  await zipla(kalip, path.join(arsivKoku, '99999', 'build.zip'));
  const icerikler = {};
  for (const id of idler) {
    const k = path.join(d, `ic-${id}`);
    await yaz(k, { 'data/BookContent.xml': `<Book id="${id}"/>`, 'thumbs/1.jpg': `kapak-${id}`, 'pages/1.png': `s-${id}` });
    icerikler[id] = path.join(d, `${id}.zip`);
    await zipla(k, icerikler[id]);
  }
  const getir = async (url) => {
    const id = /id=(\d+)/.exec(url)[1];
    const data = icerikler[id] ? `https://x.example/Uploads/ZKitapZipH/${id}-4.zip` : '';
    return { status: 200, govde: JSON.stringify({ Success: true, Data: data, Vs: data ? 4 : 0 }) };
  };
  const indir = async (url, hedef) => fsp.copyFile(icerikler[/ZKitapZipH\/(\d+)-/.exec(url)[1]], hedef);
  return { d, arsivKoku, getir, indir };
}

async function sahteSunucu({ taban = null } = {}) {
  const kayit = { govdeler: {}, parcalar: [], uploadGovde: null };
  const s = http.createServer((req, res) => {
    const parca = [];
    req.on('data', (x) => parca.push(x));
    req.on('end', () => {
      const govde = Buffer.concat(parca);
      const yol = req.url.split('?')[0];
      const json = (k, v) => { res.writeHead(k, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
      if (yol.startsWith('/agents/test/')) {
        const ad = yol.slice('/agents/test/'.length);
        (kayit.govdeler[ad] = kayit.govdeler[ad] || []).push(JSON.parse(govde.toString() || '{}'));
        if (ad === 'kaynak/presign-multipart') {
          const n = kayit.govdeler[ad].at(-1).partCount;
          const adr = `http://127.0.0.1:${s.address().port}/r2put`;
          return json(200, { uploadId: 'UP-1', r2ObjectKey: 'kaynak/45480/2.0.1/build.zip', contentType: 'application/zip',
            urls: Array.from({ length: n }, (_, i) => ({ partNumber: i + 1, url: `${adr}/${i + 1}?X-Amz-Signature=x` })) });
        }
        return json(200, { ok: true });
      }
      if (req.method === 'PUT' && yol.startsWith('/r2put/')) {
        kayit.parcalar.push(govde);
        res.writeHead(200, { ETag: `"etag-${yol.split('/').pop()}"` });
        return res.end();
      }
      if (taban && req.method === 'GET' && yol === '/taban.zip') {
        res.writeHead(200, { 'Content-Length': taban.length }); return res.end(taban);
      }
      if (yol === '/api/upload-build') { kayit.uploadGovde = govde; return json(500, {}); }
      res.writeHead(404); return res.end();
    });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${s.address().port}`, kayit,
    kapat: () => new Promise((r) => { if (s.closeAllConnections) s.closeAllConnections(); s.close(r); }) };
}

/** processJob'u yalıtılmış ortamda; üreteç adımı sahte İmpark + verilen anahtarlı kararıyla. */
async function isKostur({ job, o, anahtarli = () => false, listeCozFn, env = {}, ek = {}, taban = null, setEkiFn = null }) {
  const sunucu = await sahteSunucu({ taban });
  const casus = { merdiven: 0, setEki: 0, uretec: 0 };
  const orj = { ...kaynakAdim };
  kaynakAdim.merdiven = async () => { casus.merdiven += 1; return { satirlar: [], s1: [] }; };
  kaynakAdim.setEki = async (a) => { casus.setEki += 1; if (setEkiFn) await setEkiFn(a); return { eklenen: [] }; };
  kaynakAdim.uretec = async (a) => {
    casus.uretec += 1;
    return uk.uretecKaynagi({ ...a, arsivKoku: o.arsivKoku, getir: o.getir, indir: o.indir,
      onbellek: path.join(o.d, 'onb'), anahtarliMi: async (id) => anahtarli(id), ...(listeCozFn ? { listeCozFn } : {}), ...ek });
  };
  const ENV = {
    EMPP_KAYNAK_ARSIVI: tmp('bos-arsiv'), EMPP_ARSIV_MERDIVEN: '1', EMPP_SET_UYELIK_EK: '1', EMPP_BILDIRIM: '0',
    EMPP_MERDIVEN_KANIT: tmp('kanit'), EMPP_KAYNAK_UC_DENEME: '2', EMPP_KAYNAK_UC_BEKLE_MS: '0',
    EMPP_KAYNAK_YOK_DURUM: path.join(tmp('durum'), 'k.json'), ...env,
  };
  const eskiEnv = {};
  for (const k of Object.keys(ENV)) { eskiEnv[k] = process.env[k]; process.env[k] = ENV[k]; }
  const eski = { apiBase: CONFIG.apiBase, packagerApi: CONFIG.packagerApi, kaynakKur: CONFIG.kaynakKur,
    kaynakKurSerbestFlag: CONFIG.kaynakKurSerbestFlag, kaynakYokDurumDosyasi: CONFIG.kaynakYokDurumDosyasi };
  Object.assign(CONFIG, { apiBase: sunucu.url, packagerApi: sunucu.url, kaynakKur: true,
    kaynakKurSerbestFlag: path.join(tmp('bayrak'), 'serbest.istek'), kaynakYokDurumDosyasi: ENV.EMPP_KAYNAK_YOK_DURUM });
  fs.writeFileSync(CONFIG.kaynakKurSerbestFlag, '');
  runner._konumAyarla(false);
  const loglar = [];
  const oc = { log: console.log, warn: console.warn };
  console.log = (...a) => loglar.push(a.join(' '));
  console.warn = (...a) => loglar.push(a.join(' '));
  let hata = null;
  let donus;
  const is = { bookTitle: 'Marvel 11', publisherName: 'YDS Publishing', downloadUrl: '', platform: 'android',
    bookId: '45480', kaynakTuru: 'r2-kur', kaynakSurumu: '2.0.1', kurulumBitis: '2099-01-01T00:00:00.000Z',
    ...(taban ? { tabanUrl: `${sunucu.url}/taban.zip?X-Amz-Signature=x`, tabanSha256: sha256(taban) } : {}), ...job };
  try {
    donus = await processJob({ agentId: 'test', token: 'x' }, is);
  } catch (e) { hata = e; } finally {
    Object.assign(console, oc);
    Object.assign(kaynakAdim, orj);
    Object.assign(CONFIG, eski);
    for (const [k, v] of Object.entries(eskiEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await sunucu.kapat();
  }
  return { hata, donus, casus, is, kayit: sunucu.kayit, loglar: loglar.join('\n') };
}

/** Önceki build (R2 tabanı / arşiv) — verilen kök dosyalarıyla; tek kitaplı İmpark ağacı. */
async function tabanZip(kok) {
  const d = tmp('taban');
  await yaz(d, { 'index.html': '<html>eski</html>', 'kurum.txt': '60', 'book1/index.html': 'm',
    'book1/assets/111/data/BookContent.xml': '<Book/>', 'book1/assets/111/pages/1.png': 'p', ...kok });
  const z = path.join(tmp('taban-zip'), 'build.zip');
  await zipla(d, z);
  return fs.readFileSync(z);
}

const yuklenenZip = (g) => g.subarray(g.indexOf(Buffer.from('PK\u0003\u0004', 'latin1')),
  g.lastIndexOf(Buffer.from('PK\u0005\u0006', 'latin1')) + 22);

// ─── Uçtan uca ──────────────────────────────────────────────────────────────────────────────

test('r2-kur taban YOK, anahtarlı set: üreteç tek-motor kurar → zincir aynen → tamamla (+uretec) → paketleyici', async () => {
  const o = await ortam();
  const r = await isKostur({ o, anahtarli: (id) => id === '502', job: { setListesi: '501 | A |  |  | Books\n502 | B |  |  | Tests' } });
  assert.match(r.hata && r.hata.message, /packager upload-build failed/, r.hata && r.hata.stack);
  assert.equal(r.casus.uretec, 1);
  assert.equal(r.casus.merdiven, 1, 'merdiven zincirde AYNEN');
  assert.equal(r.casus.setEki, 1, 'set eki zincirde AYNEN');
  const t = r.kayit.govdeler['kaynak/tamamla'][0];
  assert.deepEqual(t.kitaplar.map((k) => [k.n, k.id, k.icerik, k.kapak]), [[1, '501', true, true], [2, '502', true, true]]);
  assert.equal(t.uretec.kaynak, 'uretec');
  assert.equal(t.uretec.duzen, 'tek-motor');
  assert.equal(t.uretec.aktivasyon, 'set');
  assert.equal(t.uretec.kalip, '99999');
  const yuklenen = Buffer.concat(r.kayit.parcalar);
  assert.equal(t.sha256, sha256(yuklenen));
  assert.deepEqual(yuklenenZip(r.kayit.uploadGovde), yuklenen, 'paket R2\'ye yazılan build\'den');
  const zipYolu = path.join(tmp('kontrol'), 'b.zip');
  fs.writeFileSync(zipYolu, yuklenen);
  const dz = M.zipDizini(zipYolu);
  const xml = ig.menuCoz(M.zipGirdiOku(zipYolu, dz.get('classlibraries/ImWin32.dll')));
  assert.match(/<main\b[^>]*>/.exec(xml)[0], /activation="true"/);
  assert.equal(r.kayit.govdeler['kaynak/birak'], undefined);
});

test('r2-kur taban YOK, anahtarsız YDS seti: bookN + kalıbın Web-Z kabuğu; KV yedeğinden liste (claim boş)', async () => {
  const o = await ortam();
  const ayarlar = { books: { book1: { assetId: '501', title: 'Kitap 1', contentType: 'book' },
    link2: { type: 'link', url: 'https://v.example/x', title: 'Video' }, book3: { assetId: '502', title: 'B' } } };
  const listeCozFn = (a) => uk.listeCoz({ ...a, ayarGetir: async (url) => { assert.match(url, /\/go\/xrp87\/web-stream\/config\/settings\.json$/); return ayarlar; } });
  const r = await isKostur({ o, listeCozFn, job: { bookId: '45485', kisaKod: 'xrp87' } });
  assert.match(r.hata && r.hata.message, /packager upload-build failed/, r.hata && r.hata.stack);
  const t = r.kayit.govdeler['kaynak/tamamla'][0];
  assert.equal(t.uretec.duzen, 'bookN');
  assert.equal(t.uretec.liste, 'kv:xrp87');
  assert.deepEqual(t.kitaplar.map((k) => k.id), ['501', '502']);
  assert.match(r.is.setListesi, /^501 \| Kitap 1 \|  \| book \| \nlink:https:\/\/v\.example\/x \| Video\n502 \| B/);
});

test('r2-kur taban YOK, Flashy (kurum 310): YDS motoru + tema kökü + dört nokta → tamamla (+uretec) → paketleyici', async () => {
  const o = await ortam();
  const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8, 2)]);
  const ucSorular = [];
  const ek = {
    ucSecFn: async (a) => { ucSorular.push(a); return uk.ucSec({ ...a, getirJson: async (u) => {
      if (/HasZKitapKey/.test(u)) throw new Error('HTTP 403 text/html');
      return { Success: true };
    } }); },
    kapakGetir: async () => { throw new Error('ağ yok'); },
  };
  const liste = `501 | Practice Book | data:image/webp;base64,${WEBP.toString('base64')} | book |\n502 | Activity | https://k.example/2.png | book |`;
  const r = await isKostur({ o, ek, job: { publisherName: 'Flashy ELT', bookId: '74430', bookTitle: 'Flashy Grade 4 Set', setListesi: liste } });
  assert.match(r.hata && r.hata.message, /packager upload-build failed/, r.hata && r.hata.stack);
  assert.equal(ucSorular.length, 1);
  assert.deepEqual([ucSorular[0].aday, ucSorular[0].yedek, ucSorular[0].ornekId],
    ['https://flashyelt.yayincilik.net', 'https://akillitahta.ydspublishing.com', '501']);
  const t = r.kayit.govdeler['kaynak/tamamla'][0];
  assert.deepEqual(t.kitaplar.map((k) => [k.n, k.id, k.icerik, k.kapak]), [[1, '501', true, true], [2, '502', true, true]]);
  assert.equal(t.uretec.duzen, 'bookN');
  assert.equal(t.uretec.kabuk, 'tema:web-proxy-modern');
  assert.equal(t.uretec.kalip, '99999', 'kalıp = YDS (60) arşiv build\'i');
  assert.deepEqual(t.uretec.donusum, { kurum: '310', uc: 'https://akillitahta.ydspublishing.com', motor: 2 });
  assert.deepEqual(t.uretec.kapak, { panel: 1, yedek: 1 });
  assert.match(r.loglar, /uç https:\/\/akillitahta\.ydspublishing\.com \(yedek: güncelleme json, anahtar HTTP 403/);
  const yuklenen = Buffer.concat(r.kayit.parcalar);
  assert.deepEqual(yuklenenZip(r.kayit.uploadGovde), yuklenen);
  const zipYolu = path.join(tmp('kontrol'), 'b.zip');
  fs.writeFileSync(zipYolu, yuklenen);
  const dz = M.zipDizini(zipYolu);
  const oku = (y) => M.zipGirdiOku(zipYolu, dz.get(y));
  assert.equal(dz.has('scripts/language-set.js'), false, 'kalıbın (YDS) menü kabuğu gelmedi');
  assert.equal(dz.has('electron.js') && dz.has('main.js'), true, 'kök Electron girişi korunur (saha 74430 pardus RED)');
  assert.match(oku('set_app.config').toString(), /baseEndpointUrl: "https:\/\/akillitahta\.ydspublishing\.com"/);
  assert.match(oku('index.html').toString(), /empp-webz-tema/);
  assert.doesNotMatch(oku('index.html').toString(), /Web Sürümü/);
  assert.equal(oku('kurum.txt').toString(), '310');
  assert.equal(oku('book2/kurum.txt').toString(), '310');
  assert.match(oku('book1/app.config.js').toString(), /baseEndpointUrl: "https:\/\/akillitahta\.ydspublishing\.com"/);
  const logo = fs.readFileSync(path.join(require('./webz-tema-kabuk').TEMA_KOKU, 'web-proxy-modern/images/logo.png'));
  assert.deepEqual(require('./index-ureteci').logoGizle(oku('book1/core/kurumlogo.png')), logo);
  assert.deepEqual(oku('images/book1.webp'), WEBP);
});

test('r2-kur taban YOK, Flashy ama arşivde YDS (60) kalıbı yok: ERTELENİR uretec-kalip-yok — failed/tamamla yok', async () => {
  const o = await ortam({ kurum: '7' });
  const r = await isKostur({ o, job: { publisherName: 'Flashy ELT', bookId: '74430', setListesi: '501 | A' } });
  assert.equal(r.hata, null);
  assert.equal(r.donus.ertelendi, true);
  assert.match(r.donus.sebep, /uretec-kalip-yok/);
  assert.equal(r.kayit.govdeler['kaynak/tamamla'], undefined);
  assert.equal(r.kayit.govdeler['kaynak/birak'].length, 1, 'kurma kilidi bırakılır');
  assert.equal(r.kayit.govdeler.release.length, 1, 'kira bırakılır');
});

test('r2-kur taban YOK, zip\'siz oyun (3100010 Games) link kartı: tamamla webzVarliklari\'nda yol link (saha 59480)', async () => {
  const o = await ortam();
  const liste = '501 | A |  | book | \n3100010 | Games |  | games | \n502 | B |  | book | ';
  const r = await isKostur({ o, job: { bookId: '59480', kisaKod: 'abc12', setListesi: liste } });
  assert.match(r.hata && r.hata.message, /packager upload-build failed/, r.hata && r.hata.stack);
  const t = r.kayit.govdeler['kaynak/tamamla'][0];
  assert.equal(t.uretec.linkKarti, 1);
  assert.deepEqual(t.kitaplar.map((k) => [k.n, k.id]), [[1, '501'], [3, '502']]);
  assert.deepEqual(t.webzVarliklari, [{ n: 2, id: '3100010', yol: 'link', icerik: false, kapak: false }],
    'sunucu kapısı (kendi listesinde 3100010) kimliği kitaplar ∪ webzVarliklari içinde bulur');
  const n = new Set([...t.kitaplar.map((k) => k.n)]);
  assert.equal(n.has(2), false, 'link kartının n\'i İmpark kitabının bookN\'iyle çakışmaz');
  assert.match(r.is.setListesi, /^501 \| A[^\n]*\nlink:https:\/\/akillitahta\.ndr\.ist\/go\/abc12\/web-stream\/book2\/index\.html \| Games\n502/);
});

test('r2-kur taban YOK, aktivasyonsuz ama kabuk YOK: ERTELENİR uretec-tema-yok (YDS kabuğu uydurulmaz)', async () => {
  const o = await ortam({ kabuk: false });
  const r = await isKostur({ o, job: { setListesi: '501 | A\n502 | B' } });
  assert.equal(r.hata, null);
  assert.equal(r.donus.ertelendi, true);
  assert.match(r.donus.sebep, /uretec-tema-yok/);
  assert.equal(r.kayit.govdeler['kaynak/tamamla'], undefined);
});

test('r2-kur taban YOK, liste hiç yok (claim/dosya/kisaKod): ERTELENİR uretec-liste-yok', async () => {
  const o = await ortam();
  const r = await isKostur({ o, job: {} });
  assert.equal(r.donus.ertelendi, true);
  assert.match(r.donus.sebep, /uretec-liste-yok/);
});

// ─── Önceki build taban OLMAZ (03.10 saha 74430/59480: üreteç koşmadı, eski build birebir) ─────

const LISTE2 = '501 | A |  |  | Books\n502 | B |  |  | Tests';
for (const [ad, kok, sebep] of [
  ['üreteç işaretli', { 'electron.js': 'x', 'empp-uretec.json': '{"kaynak":"uretec"}' }, /üreteç build'i \(işaret\)/],
  ['girişsiz (main/electron/package.json main yok)', { 'package.json': '{"main":"yok.js"}' }, /kökte Electron girişi yok/],
]) {
  test(`r2-kur R2 tabanı ${ad}: taban ATLANIR, üreteç koşar → tamamla (+uretec), indirilen eski build yüklenmez`, async () => {
    const o = await ortam();
    const taban = await tabanZip(kok);
    const r = await isKostur({ o, taban, anahtarli: (id) => id === '502', job: { setListesi: LISTE2 } });
    assert.match(r.hata && r.hata.message, /packager upload-build failed/, r.hata && r.hata.stack);
    assert.equal(r.casus.uretec, 1, 'üreteç koştu');
    assert.match(r.loglar, new RegExp(`R2 tabanı ATLANDI \\(${sebep.source}\\)`));
    const t = r.kayit.govdeler['kaynak/tamamla'][0];
    assert.equal(t.uretec.kaynak, 'uretec');
    assert.deepEqual(t.kitaplar.map((k) => k.id), ['501', '502']);
    const yuklenen = Buffer.concat(r.kayit.parcalar);
    assert.notEqual(sha256(yuklenen), sha256(taban), 'yeni build eskisiyle birebir DEĞİL');
    const zipYolu = path.join(tmp('kontrol'), 'b.zip');
    fs.writeFileSync(zipYolu, yuklenen);
    const dz = M.zipDizini(zipYolu);
    assert.equal(dz.has('electron.js') && dz.has('empp-uretec.json'), true, 'yeni build: giriş + üreteç işareti');
    assert.equal(JSON.parse(M.zipGirdiOku(zipYolu, dz.get('empp-uretec.json'))).kaynak, 'uretec');
  });
}

test('r2-kur ARŞİV tabanı girişsiz (eski üreteç build\'i arşive düşmüş): atlanır, üreteç koşar', async () => {
  const o = await ortam();
  const zip = await tabanZip({});
  const ar = tmp('arsiv-girissiz');
  fs.mkdirSync(path.join(ar, '45480'));
  fs.writeFileSync(path.join(ar, '45480', 'build.zip'), zip);
  fs.writeFileSync(path.join(ar, '45480', 'kaynak.json'), JSON.stringify({ dosya: 'build.zip',
    md5: crypto.createHash('md5').update(zip).digest('hex'), boyut: zip.length, etiket: 'eski-uretec' }));
  const r = await isKostur({ o, env: { EMPP_KAYNAK_ARSIVI: ar }, anahtarli: (id) => id === '502', job: { setListesi: LISTE2 } });
  assert.match(r.hata && r.hata.message, /packager upload-build failed/, r.hata && r.hata.stack);
  assert.equal(r.casus.uretec, 1);
  assert.match(r.loglar, /arşiv tabanı ATLANDI \(kökte Electron girişi yok\)/);
  assert.equal(r.kayit.govdeler['kaynak/tamamla'][0].uretec.kaynak, 'uretec');
});

test('r2-kur R2 tabanı girişli + işaretsiz (gerçek YDS build\'i): taban KORUNUR, üreteç koşmaz', async () => {
  const o = await ortam();
  // liste (501, 502) tabanın kitaplarıyla örtüşür: kapsayan taban korunur
  const { zip: taban } = await kitapliTaban(['501', '502'], { arsivde: false });
  const r = await isKostur({ o, taban, job: { setListesi: LISTE2 } });
  assert.equal(r.casus.uretec, 0);
  assert.match(r.loglar, /taban: önceki geçerli R2 build/);
  assert.doesNotMatch(r.loglar, /ATLANDI/);
});

test('r2-kur üreteç KAPALI + girişsiz R2 tabanı: taban alınır ama yazma kapısı RED giris-yok — R2\'ye yazılmaz', async () => {
  const o = await ortam();
  const taban = await tabanZip({});
  const r = await isKostur({ o, taban, env: { EMPP_INDEX_URETECI: '0' }, job: { setListesi: LISTE2 } });
  assert.equal(r.casus.uretec, 0);
  assert.doesNotMatch(r.loglar, /ATLANDI/);
  assert.match(`${r.loglar}\n${r.hata && r.hata.message}`, /giris-yok|Electron giriş dosyası yok/);
  assert.equal(r.kayit.govdeler['kaynak/presign-multipart'], undefined, 'presign yok');
  assert.equal(r.kayit.parcalar.length, 0, 'R2 PUT yok');
});

/** Giriş + N kitaplı (book1..bookN, assets/<id>) taban build'i; kaynak arşivi dizini olarak da verilir. */
async function kitapliTaban(idler, { arsivde = true } = {}) {
  const dosyalar = { 'electron.js': 'x', 'index.html': '<html>elle</html>', 'kurum.txt': '60' };
  idler.forEach((id, i) => {
    dosyalar[`book${i + 1}/index.html`] = 'm';
    dosyalar[`book${i + 1}/assets/${id}/data/BookContent.xml`] = '<Book/>';
    dosyalar[`book${i + 1}/assets/${id}/thumbs/1.jpg`] = 'k';
    dosyalar[`book${i + 1}/assets/${id}/pages/1.png`] = 'p';
  });
  const d = tmp('kitapli');
  await yaz(d, dosyalar);
  const z = path.join(tmp('kitapli-zip'), 'build.zip');
  await zipla(d, z);
  const zip = fs.readFileSync(z);
  if (!arsivde) return { zip, z };
  const ar = tmp('arsiv-kitapli');
  fs.mkdirSync(path.join(ar, '45482'));
  fs.writeFileSync(path.join(ar, '45482', 'build.zip'), zip);
  fs.writeFileSync(path.join(ar, '45482', 'kaynak.json'), JSON.stringify({ dosya: 'build.zip',
    md5: crypto.createHash('md5').update(zip).digest('hex'), boyut: zip.length, etiket: 'SW8-BUILD-20260925' }));
  return { zip, z, ar };
}
const LISTE6 = ['501', '502', '503', '504', '505', '506'].map((i) => `${i} | K${i} |  |  | Books`).join('\n');
const IDLER6 = ['501', '502', '503', '504', '505', '506'];

test('r2-kur ARŞİV tabanı liste kitaplarını KAPSAMIYOR (4 kitap, liste 6; saha 45482): taban ATLANIR, üreteç koşar', async () => {
  const o = await ortam({ idler: IDLER6 });
  const { ar } = await kitapliTaban(['501', '502', '503', '504']);
  const r = await isKostur({ o, env: { EMPP_KAYNAK_ARSIVI: ar }, anahtarli: () => false, job: { bookId: '45482', setListesi: LISTE6 } });
  assert.match(r.hata && r.hata.message, /packager upload-build failed/, r.hata && r.hata.stack);
  assert.equal(r.casus.uretec, 1, 'üreteç koştu');
  assert.match(r.loglar, /taban ATLANDI — set eki sonrası eksik: 505, 506 \(liste 6 kitap, taban 4; eksik: 505, 506\)/);
  assert.equal(r.casus.setEki, 2, 'set eki taban üzerinde denendi, üreteç build\'ine yeniden uygulandı');
  const t = r.kayit.govdeler['kaynak/tamamla'][0];
  assert.equal(t.uretec.kaynak, 'uretec');
  assert.deepEqual(t.kitaplar.map((k) => k.id), IDLER6);
});

test('r2-kur R2 tabanı liste kitaplarını KAPSAMIYOR: taban ATLANIR, üreteç koşar', async () => {
  const o = await ortam({ idler: IDLER6 });
  const { zip } = await kitapliTaban(['501', '502', '503', '504'], { arsivde: false });
  const r = await isKostur({ o, taban: zip, anahtarli: () => false, job: { setListesi: LISTE6 } });
  assert.match(r.hata && r.hata.message, /packager upload-build failed/, r.hata && r.hata.stack);
  assert.equal(r.casus.uretec, 1);
  assert.match(r.loglar, /taban ATLANDI — set eki sonrası eksik: 505, 506/);
});

test('r2-kur set eki eksiği TAMAMLIYOR (taban 4, liste 6, set eki 6 kitaplı yapıyor): taban KORUNUR, üreteç koşmaz', async () => {
  const o = await ortam({ idler: IDLER6 });
  const { ar } = await kitapliTaban(['501', '502', '503', '504']);
  const tam = (await kitapliTaban(IDLER6, { arsivde: false })).z;
  const r = await isKostur({ o, env: { EMPP_KAYNAK_ARSIVI: ar }, job: { bookId: '45482', setListesi: LISTE6 },
    setEkiFn: (a) => fsp.copyFile(tam, a.zip) });
  assert.equal(r.casus.setEki, 1, 'set eki denendi');
  assert.equal(r.casus.uretec, 0, 'set eki sonrası kapsıyor → üreteç koşmadı');
  assert.doesNotMatch(r.loglar, /ATLANDI/);
  assert.match(r.loglar, /taban: ARŞİV/);
  assert.doesNotMatch(r.loglar + String(r.hata && r.hata.message), /kitap-eksik/);
});

test('r2-kur arşiv tabanı listeyi KAPSIYOR / FAZLA kitap içeriyor: taban KORUNUR, üreteç koşmaz', async () => {
  for (const [idler, liste] of [[IDLER6, LISTE6], [IDLER6, '501 | A |  |  | Books\n502 | B |  |  | Books']]) {
    const o = await ortam({ idler: IDLER6 });
    const { ar } = await kitapliTaban(idler);
    const r = await isKostur({ o, env: { EMPP_KAYNAK_ARSIVI: ar }, job: { bookId: '45482', setListesi: liste } });
    assert.equal(r.casus.uretec, 0, 'üreteç koşmadı');
    assert.doesNotMatch(r.loglar, /ATLANDI/);
    assert.match(r.loglar, /taban: ARŞİV/);
  }
});

test('r2-kur üreteç KAPALI + eksik kitaplı arşiv tabanı: taban ATLANMAZ, yazma kapısı kitap-eksik RED', async () => {
  const o = await ortam({ idler: IDLER6 });
  const { ar } = await kitapliTaban(['501', '502', '503', '504']);
  const r = await isKostur({ o, env: { EMPP_KAYNAK_ARSIVI: ar, EMPP_INDEX_URETECI: '0' }, job: { bookId: '45482', setListesi: LISTE6 } });
  assert.equal(r.casus.uretec, 0);
  assert.doesNotMatch(r.loglar, /ATLANDI/);
  assert.match(`${r.loglar}\n${r.hata && r.hata.message}`, /kitap-eksik/);
  assert.equal(r.kayit.parcalar.length, 0, 'R2 PUT yok');
});

test('tabanKitapEksik: kimlik bazlı eksik; fazla kitap/liste yok/okunamayan zip ATLATMAZ', async () => {
  const { z } = await kitapliTaban(['501', '502', '503', '504'], { arsivde: false });
  const d = uk.tabanKitapEksik(z, LISTE6);
  assert.equal(d.atla, true);
  assert.deepEqual(d.eksik, ['505', '506']);
  assert.equal(d.sebep, 'liste 6 kitap, taban 4; eksik: 505, 506');
  // sayı eşit ama kimlik farklı: yine eksik (yalnız sayıyla ölçülmez)
  const e = uk.tabanKitapEksik(z, '501 | a\n502 | b\n503 | c\n999 | d');
  assert.deepEqual(e.eksik, ['999']);
  assert.equal(uk.tabanKitapEksik(z, '501 | a\n502 | b').atla, false, 'fazla kitap (liste dışı) atlatmaz');
  assert.equal(uk.tabanKitapEksik(z, null).atla, false);
  assert.equal(uk.tabanKitapEksik(z, '  ').atla, false);
  const bozuk = path.join(tmp('bozuk2'), 'b.zip');
  fs.writeFileSync(bozuk, 'zip değil');
  assert.equal(uk.tabanKitapEksik(bozuk, LISTE6).atla, false);
});

test('tabanUretecMi: işaret / giriş kuralı; tek sarmalayıcı klasör; okunamayan zip ATLAMAZ; kalipSec üreteç build\'ini almaz', async () => {
  const z = async (kok) => { const p = path.join(tmp('tu'), 'b.zip'); fs.writeFileSync(p, await tabanZip(kok)); return p; };
  assert.deepEqual(uk.tabanUretecMi(await z({ 'main.js': 'x' })), { atla: false, sebep: null });
  assert.deepEqual(uk.tabanUretecMi(await z({ 'package.json': '{"main":"./app/giris.js"}', 'app/giris.js': 'x' })),
    { atla: false, sebep: null });
  assert.equal(uk.tabanUretecMi(await z({ 'book1/electron.js': 'x' })).atla, true, 'kitap motorunun girişi kökü kurtarmaz');
  assert.equal(uk.tabanUretecMi(await z({ 'main.js': 'x', 'empp-uretec.json': '{}' })).atla, true);
  const sar = tmp('sar');
  await yaz(path.join(sar, 'build'), { 'electron.js': 'x', 'index.html': 'i' });
  const sz = path.join(tmp('sarz'), 'b.zip');
  await zipla(sar, sz);
  assert.equal(uk.tabanUretecMi(sz).atla, false, 'tek sarmalayıcı klasör tolere edilir');
  const bozuk = path.join(tmp('bozuk'), 'b.zip');
  fs.writeFileSync(bozuk, 'zip değil');
  assert.deepEqual(uk.tabanUretecMi(bozuk), { atla: false, sebep: null });
  const a = await ortam({ kurum: '60' });
  assert.equal(uk.kalipSec({ arsivKoku: a.arsivKoku, kurum: '60' }).set, '99999');
  const zz = path.join(a.arsivKoku, '99999', 'build.zip');
  const dz = tmp('isaret');
  await yaz(dz, { 'empp-uretec.json': '{}' });
  const r = await M.komut('zip', ['-q', path.resolve(zz), 'empp-uretec.json'], { cwd: dz });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(uk.kalipSec({ arsivKoku: a.arsivKoku, kurum: '60' }), null, 'üreteç build\'i kalıp olmaz');
});

// ─── uretec-kaynak saf parçalar ─────────────────────────────────────────────────────────────

test('ucSec: aday iki soruya JSON dönerse aday; biri bile dönmezse yedek (ölçüm gerekçesiyle)', async () => {
  const uc = { aday: 'https://a.example', yedek: 'https://y.example', ornekId: '7' };
  const sorulan = [];
  const iyi = await uk.ucSec({ ...uc, getirJson: async (u) => { sorulan.push(u); return { Success: false }; } });
  assert.deepEqual([iyi.uc, iyi.secilen], ['https://a.example', 'aday']);
  assert.deepEqual(sorulan, ['https://a.example/TestlerMobil/GetKitapGuncellemeBilgi?id=7&setMi=0&versiyon=0',
    'https://a.example/TestlerMobil/HasZKitapKey?kitapId=7']);
  const k = await uk.ucSec({ ...uc, getirJson: async (u) => (/HasZ/.test(u) ? { Html: 1 } : { Success: true }) });
  assert.deepEqual([k.uc, k.secilen, k.olcum.anahtar], ['https://y.example', 'yedek', 'biçim dışı']);
  assert.equal(uk.ornekKitap('link:https://x.example | L\\nabc | X\\n77 | Y'), '77');
});

test('ayarlardanListe: panel kapağı 3. alana (data/mutlak aynen, göreli → Worker tabanı)', () => {
  assert.equal(uk.ayarlardanListe({ books: {
    book1: { assetId: '1', title: 'A', coverUrl: 'data:image/webp;base64,AAA=' },
    book2: { assetId: '2', title: 'B', coverUrl: 'images/book2.png' },
    book3: { assetId: '3', title: 'C', coverUrl: 'https://c.example/3.jpg' },
  } }, { taban: 'https://w.example/go/k/web-stream' }),
  '1 | A | data:image/webp;base64,AAA= |  | \n2 | B | https://w.example/go/k/web-stream/images/book2.png |  | \n3 | C | https://c.example/3.jpg |  | ');
});

test('ayarlardanListe: Worker settings.json → panel listesi (sıra, link, grup; | kaçışı)', () => {
  assert.equal(uk.ayarlardanListe({ books: {
    book1: { assetId: '1', title: 'A|B', contentType: 'book', group: 'G' }, link2: { type: 'link', url: 'ftp://x', title: 'L' },
    link3: { type: 'link', url: 'https://y.example', title: 'Y' }, book4: { title: 'kimliksiz' },
  } }), '1 | A B |  | book | G\nlink:https://y.example | Y');
  assert.equal(uk.ayarlardanListe({}), null);
});

test('listeCoz: claim ÖNCE (KV\'ye gidilmez); kisaKod biçimsizse KV denenmez', async () => {
  let cagri = 0;
  const ayarGetir = async () => { cagri += 1; return { books: { b: { assetId: '9', title: 'T' } } }; };
  assert.deepEqual(await uk.listeCoz({ job: { setListesi: '1 | A' }, env: {}, ayarGetir }), { ham: '1 | A', kaynak: 'claim' });
  assert.equal(await uk.listeCoz({ job: { kisaKod: '../x' }, env: {}, ayarGetir }), null);
  assert.equal(cagri, 0);
  assert.deepEqual(await uk.listeCoz({ job: { kisaKod: 'ab12c' }, env: {}, ayarGetir }), { ham: '9 | T |  |  | ', kaynak: 'kv:ab12c' });
});

test('kalipSec: yalnız aynı KURUM ve motor taşıyan build; en yeni yazılma', async () => {
  const a = await ortam({ kurum: '60' });
  const b = await ortam({ kurum: '310' });
  fs.renameSync(path.join(b.arsivKoku, '99999'), path.join(a.arsivKoku, '88888'));
  fs.writeFileSync(path.join(a.arsivKoku, '99999', 'kaynak.json'), JSON.stringify({ yazilma: '2026-10-02T10:00:00Z' }));
  assert.equal(uk.kalipSec({ arsivKoku: a.arsivKoku, kurum: '60' }).set, '99999');
  assert.equal(uk.kalipSec({ arsivKoku: a.arsivKoku, kurum: '310' }).set, '88888');
  assert.equal(uk.kalipSec({ arsivKoku: a.arsivKoku, kurum: '7' }), null);
  assert.equal(uk.uretecAcik({}), true);
  assert.equal(uk.uretecAcik({ EMPP_INDEX_URETECI: '0' }), false);
});
