'use strict';

/**
 * Runner × KAYNAK KARARI — gerçek `processJob`, sahte sunucuyla (runner-uretec.test.js kalıbı):
 * liste küçüldü kontrolü yalnız r2-kur'da; atlanan üye fazla sayılmaz; içeriksiz arşiv + set → üreteç.
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

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `kkarar-${ad}-`));
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
    ...(taban && job.kaynakTuru === 'r2-al'
      ? { kaynakUrl: `${sunucu.url}/taban.zip?X-Amz-Signature=x`, kaynakSha256: sha256(taban), kaynakBoyut: taban.length }
      : taban ? { tabanUrl: `${sunucu.url}/taban.zip?X-Amz-Signature=x`, tabanSha256: sha256(taban) } : {}), ...job };
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

const LISTE1 = '501 | A |  |  | Books';
const LISTE2 = '501 | A |  |  | Books\n502 | B |  |  | Tests';

test('r2-kur taban [501,999], claim [501]: "liste kuculdu: 999" → taban atlanır, üreteç koşar', async () => {
  const o = await ortam({ idler: ['501'] });
  const { zip } = await kitapliTaban(['501', '999'], { arsivde: false });
  const r = await isKostur({ o, taban: zip, job: { setListesi: LISTE1 } });
  assert.match(r.hata && r.hata.message, /packager upload-build failed/, r.hata && r.hata.stack);
  assert.equal(r.casus.uretec, 1, 'üreteç koştu');
  assert.match(r.loglar, /taban kapsama: liste küçüldü \(999 tabanda var ama claim'de yok\)/);
  assert.match(r.loglar, /liste kuculdu: 999/);
  const t = r.kayit.govdeler['kaynak/tamamla'][0];
  assert.deepEqual(t.kitaplar.map((k) => k.id), ['501'], 'yeni build yalnız claim kitabını taşır');
});

test('r2-kur taban [501], claim [501,502]: liste KÜÇÜLMEDİ → "liste kuculdu" YOK (eksik yolu işler)', async () => {
  const o = await ortam({ idler: ['501', '502'] });
  const { zip } = await kitapliTaban(['501'], { arsivde: false });
  const r = await isKostur({ o, taban: zip, job: { setListesi: LISTE2 } });
  assert.doesNotMatch(r.loglar, /liste küçüldü|liste kuculdu/);
  assert.match(r.loglar, /taban ATLANDI — set eki sonrası eksik: 502/);
});

test('r2-kur taban [501,999], claim [501], 999 ATLANAN üye: fazla SAYILMAZ → liste kuculdu YOK', async () => {
  const o = await ortam({ idler: ['501'] });
  const { zip } = await kitapliTaban(['501', '999'], { arsivde: false });
  const r = await isKostur({ o, taban: zip,
    job: { setListesi: LISTE1, atlananUyeler: [{ kitapId: '999', sebep: 'içeriksiz' }] } });
  assert.doesNotMatch(r.loglar, /liste küçüldü|liste kuculdu/);
  assert.equal(r.casus.uretec, 0, 'taban korundu, üreteç koşmadı');
});

test('r2-al taban [501,999], claim [501]: kontrol YOK (eski davranış) — kaynak olduğu gibi kullanılır, üreteç koşmaz', async () => {
  const o = await ortam({ idler: ['501'] });
  const { zip } = await kitapliTaban(['501', '999'], { arsivde: false });
  const r = await isKostur({ o, taban: zip, job: { setListesi: LISTE1, kaynakTuru: 'r2-al' } });
  assert.doesNotMatch(r.loglar, /liste küçüldü|liste kuculdu/);
  assert.equal(r.casus.uretec, 0, 'r2-al platform işi üreteç koşmaz (R2 kaynağı eski kalmasın)');
  assert.match(r.loglar, /olduğu gibi kullanılır/);
  assert.match(r.loglar, /uploading build to packager/, 'zincir üreteçsiz paketleyiciye ilerledi');
  assert.equal(r.kayit.govdeler['kaynak/presign-multipart'], undefined, 'r2-al R2\'ye yazmaz');
});

test('içeriksiz arşiv + SET + üreteç açık: arşiv tabanı değil, üreteç kurar (arsiv.iceriksiz işareti)', async () => {
  const o = await ortam({ idler: ['501', '502'] });
  const d = tmp('ic-yok');
  await yaz(d, { 'electron.js': 'x', 'index.html': '<html>motor</html>', 'kurum.txt': '60' });
  const ar = tmp('arsiv-iceriksiz');
  fs.mkdirSync(path.join(ar, '45480'));
  await zipla(d, path.join(ar, '45480', 'build.zip'));
  const zip = fs.readFileSync(path.join(ar, '45480', 'build.zip'));
  fs.writeFileSync(path.join(ar, '45480', 'kaynak.json'), JSON.stringify({ dosya: 'build.zip',
    md5: crypto.createHash('md5').update(zip).digest('hex'), boyut: zip.length, etiket: 'MOTOR-ONLY' }));
  const r = await isKostur({ o, env: { EMPP_KAYNAK_ARSIVI: ar }, job: { setListesi: LISTE2 } });
  assert.equal(r.casus.uretec, 1, 'üreteç koştu');
  assert.doesNotMatch(r.loglar, /taban: ARŞİV/);
  const t = r.kayit.govdeler['kaynak/tamamla'][0];
  assert.equal(t.uretec.kaynak, 'uretec');
  assert.deepEqual(t.kitaplar.map((k) => k.id), ['501', '502']);
});
