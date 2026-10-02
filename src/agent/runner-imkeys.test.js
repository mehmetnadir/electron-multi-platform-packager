'use strict';

/**
 * Runner × imKeys (güvenlik 02.10) — gerçek `processJob`, sahte sunucuyla, uçtan uca:
 *   r2-kur : anahtarlı kapağa imKeys.dll R2'ye yazılan build'in İÇİNDE (4 platform aynısını alır);
 *            paket tanımsız/0 kod → yazma kapısı RED `imkeys-yok` (presign yok, birak neden kodu);
 *            keypanel'e ulaşılamaz → ertelendi (kilit + kira bırakılır, failed yok).
 *   r2-al  : build'de imKeys yoksa eklenir (paketleyiciye giden zip'te var); doluysa korunur.
 *   arşiv  : paket anahtarlı ama kapak çözülemiyor → paketleyiciye HİÇBİR ŞEY gitmez.
 * HasZKitapKey ve keypanel sahte bağımlılıkla (imkeys.varsayilanBagimliliklar) — canlıya istek yok.
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();

const runner = require('./runner.js');
const imKeys = require('./imkeys');
const { CONFIG, processJob, kaynakAdim } = runner;
const { isTransientNetworkError } = require('./runner-helpers');

YALITIM.configUygula(CONFIG);
after(() => YALITIM.temizle());

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `rimk-${ad}-`));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const KODLAR = ['AB3CD', 'PQ9RS'];

function setBuildZip({ id = '111', imKeysVeri = null, dizin = null } = {}) {
  const z = new AdmZip();
  z.addFile('index.html', Buffer.from('<html>set</html>'));
  const b = `book1/assets/${dizin || id}/`;
  z.addFile('book1/index.html', Buffer.from('<html>kitap</html>'));
  z.addFile(`${b}data/BookContent.xml`, Buffer.from('<Book v="1"/>'));
  z.addFile(`${b}pages/1.png`, Buffer.from('sayfa'));
  z.addFile(`${b}thumbs/1.jpg`, Buffer.from('kapak'));
  if (imKeysVeri) z.addFile(`${b}imKeys.dll`, imKeysVeri);
  return z.toBuffer();
}

function arsivKur(bookId, icerik) {
  const kok = tmp('arsiv');
  fs.mkdirSync(path.join(kok, String(bookId)));
  fs.writeFileSync(path.join(kok, String(bookId), 'build.zip'), icerik);
  fs.writeFileSync(path.join(kok, String(bookId), 'kaynak.json'), JSON.stringify({
    dosya: 'build.zip', md5: md5(icerik), boyut: icerik.length, etiket: 'test' }));
  return kok;
}

async function sahteSunucu({ dosyalar = {} } = {}) {
  const kayit = { govdeler: {}, uploadGovde: null, parcalar: [] };
  const s = http.createServer((req, res) => {
    const parca = [];
    req.on('data', (d) => parca.push(d));
    req.on('end', () => {
      const govde = Buffer.concat(parca);
      const yol = req.url.split('?')[0];
      const json = (kod, veri) => { res.writeHead(kod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(veri)); };
      if (yol.startsWith('/agents/test/')) {
        const ad = yol.slice('/agents/test/'.length);
        (kayit.govdeler[ad] = kayit.govdeler[ad] || []).push(JSON.parse(govde.toString() || '{}'));
        if (ad === 'kaynak/presign-multipart') {
          const adr = `http://127.0.0.1:${s.address().port}/r2put`;
          const n = kayit.govdeler[ad].at(-1).partCount;
          return json(200, { uploadId: 'UP-1', r2ObjectKey: 'kaynak/45480/2.50.1/build.zip', contentType: 'application/zip',
            urls: Array.from({ length: n }, (_, i) => ({ partNumber: i + 1, url: `${adr}/${i + 1}?X-Amz-Signature=x` })) });
        }
        return json(200, { ok: true });
      }
      if (req.method === 'PUT' && yol.startsWith('/r2put/')) {
        kayit.parcalar.push(govde);
        res.writeHead(200, { ETag: `"etag-${yol.split('/').pop()}"` });
        return res.end();
      }
      if (yol === '/api/upload-build') { kayit.uploadGovde = govde; return json(500, {}); }
      if (dosyalar[yol]) { res.writeHead(200); return res.end(dosyalar[yol]); }
      res.writeHead(404); return res.end();
    });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  return { url, kayit, kapat: () => new Promise((r) => { if (s.closeAllConnections) s.closeAllConnections(); s.close(r); }) };
}

/** imKeys bağımlılığı: `anahtarli` kimlikler anahtarlı; `kodlar` dizi ya da fırlatılacak hata. */
function bagKur(anahtarli, kodlar = KODLAR) {
  const casus = { cek: 0 };
  return { casus, bag: () => ({
    anahtarliMi: async (id) => anahtarli.includes(String(id)),
    kodCek: async () => { casus.cek += 1; if (kodlar instanceof Error) throw kodlar; return kodlar; },
  }) };
}

async function isKostur({ job, arsivKoku = tmp('bos'), sunucu: sec = {}, bag }) {
  const sunucu = await sahteSunucu(sec);
  const orjAdim = { ...kaynakAdim };
  const orjBag = imKeys.varsayilanBagimliliklar;
  kaynakAdim.merdiven = async () => ({ satirlar: [{ kitap: 'book1', id: '111', durum: 'GUNCEL', vs: 7 }], s1: [] });
  kaynakAdim.setEki = async () => ({ eklenen: [] });
  imKeys.varsayilanBagimliliklar = bag;
  const ENV = {
    EMPP_KAYNAK_ARSIVI: arsivKoku, EMPP_ARSIV_MERDIVEN: '1', EMPP_SET_UYELIK_EK: '1', EMPP_BILDIRIM: '0',
    EMPP_MERDIVEN_KANIT: tmp('mk'), AGENT_DOWNLOAD_RATE: '', AGENT_DOWNLOAD_MAX_ATTEMPTS: '2', AGENT_UPLOAD_RATE: '',
    EMPP_KAYNAK_UC_DENEME: '2', EMPP_KAYNAK_UC_BEKLE_MS: '0',
    EMPP_KAYNAK_YOK_DURUM: path.join(tmp('durum'), 'kaynak-yok-bildirim.json'),
  };
  const eskiEnv = {};
  for (const k of Object.keys(ENV)) { eskiEnv[k] = process.env[k]; process.env[k] = ENV[k]; }
  const eski = { apiBase: CONFIG.apiBase, packagerApi: CONFIG.packagerApi, kaynakKur: CONFIG.kaynakKur,
    kaynakKurSerbestFlag: CONFIG.kaynakKurSerbestFlag, kaynakYokDurumDosyasi: CONFIG.kaynakYokDurumDosyasi };
  CONFIG.apiBase = sunucu.url;
  CONFIG.packagerApi = sunucu.url;
  CONFIG.kaynakKur = true;
  CONFIG.kaynakKurSerbestFlag = path.join(tmp('bayrak'), 'kaynak-kur-serbest.istek');
  CONFIG.kaynakYokDurumDosyasi = ENV.EMPP_KAYNAK_YOK_DURUM;
  fs.writeFileSync(CONFIG.kaynakKurSerbestFlag, '');
  runner._konumAyarla(false);
  const loglar = [];
  const orj = { log: console.log, warn: console.warn };
  console.log = (...a) => loglar.push(a.join(' '));
  console.warn = (...a) => loglar.push(a.join(' '));
  let hata = null;
  let donus;
  try {
    donus = await processJob({ agentId: 'test', token: 'x' },
      { bookTitle: 'Marvel Grade 11', publisherName: 'YDS Publishing', downloadUrl: '', ...job(sunucu.url) });
  } catch (e) {
    hata = e;
  } finally {
    Object.assign(console, orj);
    Object.assign(kaynakAdim, orjAdim);
    imKeys.varsayilanBagimliliklar = orjBag;
    Object.assign(CONFIG, eski);
    for (const [k, v] of Object.entries(eskiEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await sunucu.kapat();
  }
  return { hata, donus, loglar: loglar.join('\n'), kayit: sunucu.kayit };
}

function yuklenenZip(govde) {
  assert.ok(govde, 'paketleyiciye build gitmeli');
  const bas = govde.indexOf(Buffer.from('PK\u0003\u0004', 'latin1'));
  const son = govde.lastIndexOf(Buffer.from('PK\u0005\u0006', 'latin1'));
  return new AdmZip(govde.subarray(bas, son + 22));
}
const imKeysOku = (zip, yol) => { const g = zip.getEntry(yol); return g ? imKeys.imKeysCoz(g.getData()) : null; };

const r2Kur = (ek = {}) => () => ({
  bookId: '45480', platform: 'android', kaynakTuru: 'r2-kur', kaynakSurumu: '2.50.1',
  kurulumBitis: '2099-01-01T00:00:00.000Z', setListesi: '111 | Kitap Bir', ...ek,
});

test('r2-kur: anahtarlı kapağın imKeys.dll\'i R2\'ye yazılan build\'in içinde; paketleyiciye giden zip\'te de; log kod içermez', async () => {
  const b = bagKur(['45480', '111']);
  const r = await isKostur({ arsivKoku: arsivKur('45480', setBuildZip()), job: r2Kur(), bag: b.bag });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  const r2Zip = new AdmZip(Buffer.concat(r.kayit.parcalar));
  assert.deepEqual(imKeysOku(r2Zip, 'book1/assets/111/imKeys.dll'), KODLAR, 'R2 build\'i imKeys taşır');
  assert.deepEqual(imKeysOku(yuklenenZip(r.kayit.uploadGovde), 'book1/assets/111/imKeys.dll'), KODLAR);
  assert.equal(b.casus.cek, 1);
  assert.match(r.loglar, /\[imkeys\] 45480: 1 kapak · 1 anahtarlı · 1 yazıldı · 0 korundu · 2 kod/);
  assert.ok(!r.loglar.includes('AB3CD') && !r.loglar.includes('PQ9RS'), 'kod değeri log\'a DÜŞMEZ');
});

test('r2-kur: paket keypanel\'de tanımsız (404) → yazma kapısı RED imkeys-yok; presign YOK, birak neden kodu, kalıcı', async () => {
  const b = bagKur(['45480', '111'], new imKeys.ImKeysHatasi('paket 45480 keypanel\'de tanımlı değil (404) — anahtar kaynağı yok'));
  const r = await isKostur({ arsivKoku: arsivKur('45480', setBuildZip()), job: r2Kur(), bag: b.bag });
  assert.match(r.hata.message, /yazma kapısı RED.*imkeys-yok: paket 45480 keypanel'de tanımlı değil/);
  assert.equal(r.kayit.govdeler['kaynak/presign-multipart'], undefined);
  assert.equal(r.kayit.parcalar.length, 0);
  assert.equal(r.kayit.uploadGovde, null, 'paket ÜRETİLMEZ');
  const birak = r.kayit.govdeler['kaynak/birak'];
  assert.equal(birak.length, 1);
  assert.ok(birak[0].nedenKodlari.includes('imkeys-yok'), JSON.stringify(birak[0]));
  assert.equal(isTransientNetworkError(r.hata), false, 'failed + bildirim yoluna gider');
});

test('r2-kur: keypanel\'e ulaşılamıyor (geçici) → ertelendi: kilit + kira bırakılır, R2\'ye/paketleyiciye hiçbir şey, failed yok', async () => {
  const b = bagKur(['45480', '111'], new imKeys.ImKeysHatasi('srv21 ssh rc=255: timeout', { gecici: true }));
  const r = await isKostur({ arsivKoku: arsivKur('45480', setBuildZip()), job: r2Kur(), bag: b.bag });
  assert.equal(r.hata, null, r.hata && r.hata.stack);
  assert.equal(r.donus.ertelendi, true);
  assert.match(r.donus.sebep, /\[imkeys\] srv21 ssh rc=255/);
  assert.equal(r.kayit.govdeler['kaynak/birak'].length, 1);
  assert.equal(r.kayit.govdeler.release.length, 1);
  assert.equal(r.kayit.parcalar.length, 0);
  assert.equal(r.kayit.uploadGovde, null);
  assert.equal(r.kayit.govdeler.result, undefined);
});

const R2_YOL = '/kaynak/45480/2.50.1/build.zip';
const r2Al = (zip) => (u) => ({
  bookId: '45480', platform: 'pardus', kaynakTuru: 'r2-al', kaynakSurumu: '2.50.1',
  kaynakUrl: `${u}${R2_YOL}?X-Amz-Signature=abc`, kaynakSha256: sha256(zip), kaynakBoyut: zip.length,
});

test('r2-al: imKeys\'siz eski R2 build → eksik imKeys eklenir (paketleyici/konteyner girdisinde var)', async () => {
  const zip = setBuildZip();
  const b = bagKur(['45480', '111']);
  const r = await isKostur({ sunucu: { dosyalar: { [R2_YOL]: zip } }, job: (u) => ({ ...r2Al(zip)(u), platform: 'android' }), bag: b.bag });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.deepEqual(imKeysOku(yuklenenZip(r.kayit.uploadGovde), 'book1/assets/111/imKeys.dll'), KODLAR);
});

test('r2-al: build\'de dolu imKeys varsa KORUNUR, keypanel çağrılmaz (4 platform aynı R2 build)', async () => {
  const zip = setBuildZip({ imKeysVeri: imKeys.imKeysBicimle(['R2KOD']) });
  const b = bagKur(['45480', '111']);
  const r = await isKostur({ sunucu: { dosyalar: { [R2_YOL]: zip } }, job: (u) => ({ ...r2Al(zip)(u), platform: 'android' }), bag: b.bag });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.equal(b.casus.cek, 0);
  assert.deepEqual(imKeysOku(yuklenenZip(r.kayit.uploadGovde), 'book1/assets/111/imKeys.dll'), ['R2KOD']);
});

test('arşiv: paket anahtarlı ama kapak kimliği çözülemiyor → imkeys-yok, paketleyiciye HİÇBİR ŞEY gitmez', async () => {
  const zip = setBuildZip({ dizin: 'Adli-Kitap' }); // menü yok, sayısal dizin yok
  const b = bagKur(['45480']);
  const r = await isKostur({ arsivKoku: arsivKur('45480', zip), bag: b.bag,
    job: () => ({ bookId: '45480', platform: 'android' }) });
  assert.ok(r.hata, 'iş düşmeli');
  assert.match(r.hata.message, /\[imkeys\] imkeys-yok — paket YAYINLANMAZ: imkeys-yok: paket 45480 anahtarlı ama build'de anahtarlı kapak çözülemedi/);
  assert.equal(r.kayit.uploadGovde, null);
});

test('arşiv: anahtarsız kitap → zip dokunulmadan paketleyiciye (bugünkü davranış)', async () => {
  const zip = setBuildZip({ id: '25776' });
  const b = bagKur([]);
  const r = await isKostur({ arsivKoku: arsivKur('45550', zip), bag: b.bag,
    job: () => ({ bookId: '45550', platform: 'android', setListesi: '25776 | K' }) });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.equal(yuklenenZip(r.kayit.uploadGovde).getEntry('book1/assets/25776/imKeys.dll'), null);
  assert.equal(b.casus.cek, 0);
});
