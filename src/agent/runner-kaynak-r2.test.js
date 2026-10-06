'use strict';

/**
 * Runner × EXE'SİZ KAYNAK DALGA B (B4) — gerçek `processJob`, uçtan uca, sahte sunucuyla.
 *
 *   r2-al  : imzalı GET (burada yerel sahte adres) → sha256 + boyut → OLDUĞU GİBİ paketleyiciye;
 *            merdiven ve set eki ÇAĞRILMAZ (casus); arşive r2Surum ile yazılır; sonraki iş indirmez.
 *   r2-kur : taban (arşiv) → merdiven (casus) → yazma kapısı (B5) → presign → parça PUT → tamamla;
 *            200 → paketleyiciye gider; 409 / kapı reddi → paket ÜRETİLMEZ + birak; 5xx → kira bırakılır.
 * Paketleyici (3001) sahte: upload-build gövdesi yakalanır, 500 → iş orada düşer. Canlıya istek yok.
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
const { CONFIG, processJob, kaynakIndirme, kaynakAdim } = runner;
const { isTransientNetworkError, ertelenebilirKaynakHatasi } = require('./runner-helpers');

YALITIM.configUygula(CONFIG);
after(() => YALITIM.temizle());

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `r2-${ad}-`));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

/** İçerik + kapak taşıyan set build'i (yazma kapısından geçer). */
function setBuildZip(kitaplar = [['111', 'v1']]) {
  const z = new AdmZip();
  z.addFile('index.html', Buffer.from('<html>set</html>'));
  z.addFile('electron.js', Buffer.from('require("electron");'));
  kitaplar.forEach(([id, etiket], i) => {
    const b = `book${i + 1}/assets/${id}/`;
    z.addFile(`book${i + 1}/index.html`, Buffer.from('<html>kitap</html>'));
    z.addFile(`${b}data/BookContent.xml`, Buffer.from(`<Book v="${etiket}"/>`));
    z.addFile(`${b}pages/1.png`, Buffer.from(`sayfa-${etiket}`));
    z.addFile(`${b}thumbs/1.jpg`, Buffer.from(`kapak-${etiket}`));
  });
  return z.toBuffer();
}

function arsivKur(bookId, icerik, ek = {}) {
  const kok = tmp('arsiv');
  const dizin = path.join(kok, String(bookId));
  fs.mkdirSync(dizin);
  fs.writeFileSync(path.join(dizin, 'build.zip'), icerik);
  fs.writeFileSync(path.join(dizin, 'kaynak.json'), JSON.stringify({
    dosya: 'build.zip', md5: md5(icerik), boyut: icerik.length, etiket: 'test', ...ek,
  }));
  return kok;
}

/** book-update API (agents/test/*) + R2 GET/PUT + paketleyici, tek sahte sunucu. */
async function sahteSunucu({ dosyalar = {}, tamamla = () => [200, { ok: true }] } = {}) {
  const kayit = { istekler: [], govdeler: {}, uploadGovde: null, parcalar: [] };
  const s = http.createServer((req, res) => {
    const parca = [];
    req.on('data', (d) => parca.push(d));
    req.on('end', () => {
      const govde = Buffer.concat(parca);
      const yol = req.url.split('?')[0];
      kayit.istekler.push(`${req.method} ${yol}`);
      const json = (kod, veri) => { res.writeHead(kod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(veri)); };
      if (yol.startsWith('/agents/test/')) {
        const ad = yol.slice('/agents/test/'.length);
        (kayit.govdeler[ad] = kayit.govdeler[ad] || []).push(JSON.parse(govde.toString() || '{}'));
        if (ad === 'kaynak/presign-multipart') {
          const adr = `http://127.0.0.1:${s.address().port}/r2put`;
          const n = kayit.govdeler[ad].at(-1).partCount;
          return json(200, { uploadId: 'UP-1', r2ObjectKey: 'kaynak/45549/2.51.10/build.zip', contentType: 'application/zip',
            urls: Array.from({ length: n }, (_, i) => ({ partNumber: i + 1, url: `${adr}/${i + 1}?X-Amz-Signature=x` })) });
        }
        if (ad === 'kaynak/tamamla') { const [k, v] = tamamla(kayit); return json(k, v); }
        return json(200, { ok: true });
      }
      if (req.method === 'PUT' && yol.startsWith('/r2put/')) {
        kayit.parcalar.push(govde);
        res.writeHead(200, { ETag: `"etag-${yol.split('/').pop()}"` });
        return res.end();
      }
      if (yol === '/api/upload-build') {
        kayit.uploadGovde = govde;
        return json(500, {});
      }
      if (dosyalar[yol] === 'KOPAR') { req.socket.destroy(); return undefined; }
      if (dosyalar[yol]) { res.writeHead(200); return res.end(dosyalar[yol]); }
      res.writeHead(404); return res.end();
    });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  return { url, kayit, kapat: () => new Promise((r) => { if (s.closeAllConnections) s.closeAllConnections(); s.close(r); }) };
}

/** processJob'u yalıtılmış ortamda koşturur; merdiven/set eki/indirme casusları takılır. */
async function isKostur({ job, arsivKoku = tmp('bos-arsiv'), env = {}, sunucu: sunucuSec = {},
  merdivenDonus = { satirlar: [], s1: [] }, kaynakKurSerbest = true, adim = {}, onKontrolDosyasi = null,
  platform = null }) {
  const sunucu = await sahteSunucu(sunucuSec);
  const casus = { merdiven: 0, setEki: 0, r2Indir: [], manuelZipIndir: 0 };
  const orjAdim = { ...kaynakAdim };
  const orjIndirme = { ...kaynakIndirme };
  kaynakAdim.merdiven = async () => { casus.merdiven += 1; return merdivenDonus; };
  kaynakAdim.setEki = async () => { casus.setEki += 1; return { eklenen: [] }; };
  Object.assign(kaynakAdim, adim);
  kaynakIndirme.r2Indir = async (...a) => { casus.r2Indir.push(a[0]); return orjIndirme.r2Indir(...a); };
  kaynakIndirme.manuelZipIndir = async (...a) => { casus.manuelZipIndir += 1; return orjIndirme.manuelZipIndir(...a); };
  const bayrakDizin = tmp('bayrak');
  const ENV = {
    EMPP_KAYNAK_ARSIVI: arsivKoku, EMPP_ARSIV_MERDIVEN: '1', EMPP_SET_UYELIK_EK: '1', EMPP_BILDIRIM: '0',
    EMPP_MERDIVEN_KANIT: tmp('merdiven-kanit'), AGENT_DOWNLOAD_RATE: '', AGENT_DOWNLOAD_MAX_ATTEMPTS: '2',
    AGENT_UPLOAD_RATE: '', EMPP_KAYNAK_UC_DENEME: '2', EMPP_KAYNAK_UC_BEKLE_MS: '0',
    EMPP_KAYNAK_YOK_DURUM: path.join(tmp('durum'), 'kaynak-yok-bildirim.json'),
    ...env,
  };
  const eskiEnv = {};
  for (const k of Object.keys(ENV)) { eskiEnv[k] = process.env[k]; process.env[k] = ENV[k]; }
  const eski = { apiBase: CONFIG.apiBase, packagerApi: CONFIG.packagerApi, kaynakKur: CONFIG.kaynakKur,
    kaynakKurSerbestFlag: CONFIG.kaynakKurSerbestFlag, kaynakYokDurumDosyasi: CONFIG.kaynakYokDurumDosyasi,
    kabukErteleDurumDosyasi: CONFIG.kabukErteleDurumDosyasi,
    kabukOnKontrolDosyasi: CONFIG.kabukOnKontrolDosyasi };
  CONFIG.apiBase = sunucu.url;
  CONFIG.packagerApi = sunucu.url;
  CONFIG.kaynakKur = true;
  CONFIG.kaynakKurSerbestFlag = path.join(bayrakDizin, 'kaynak-kur-serbest.istek');
  CONFIG.kaynakYokDurumDosyasi = ENV.EMPP_KAYNAK_YOK_DURUM;
  CONFIG.kabukErteleDurumDosyasi = path.join(tmp('kabuk-ertele'), 'kabuk-ertele-bildirim.json');
  CONFIG.kabukOnKontrolDosyasi = onKontrolDosyasi || path.join(tmp('on-kontrol'), 'kabuk-ek-on-kontrol.json');
  if (platform) runner._platformAyarla(platform);
  if (kaynakKurSerbest) fs.writeFileSync(CONFIG.kaynakKurSerbestFlag, '');
  runner._konumAyarla(false);
  const loglar = [];
  const orj = { log: console.log, warn: console.warn };
  console.log = (...a) => loglar.push(a.join(' '));
  console.warn = (...a) => loglar.push(a.join(' '));
  let hata = null;
  let donus;
  const is = { bookTitle: 'Test Set', publisherName: 'YDS Publishing', downloadUrl: '', ...job(sunucu.url) };
  try {
    donus = await processJob({ agentId: 'test', token: 'x' }, is);
  } catch (e) {
    hata = e;
  } finally {
    Object.assign(console, orj);
    Object.assign(kaynakAdim, orjAdim);
    Object.assign(kaynakIndirme, orjIndirme);
    Object.assign(CONFIG, eski);
    if (platform) runner._platformAyarla(null);
    for (const [k, v] of Object.entries(eskiEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await sunucu.kapat();
  }
  return { hata, donus, casus, is, loglar: loglar.join('\n'), kayit: sunucu.kayit, arsivKoku };
}

/** Paketleyiciye giden multipart gövdedeki zip baytları. */
function yuklenenZip(govde) {
  assert.ok(govde, 'paketleyiciye build gitmeli');
  const bas = govde.indexOf(Buffer.from('PK\u0003\u0004', 'latin1'));
  const son = govde.lastIndexOf(Buffer.from('PK\u0005\u0006', 'latin1'));
  return govde.subarray(bas, son + 22);
}

const R2_YOL = '/kaynak/45549/2.51.10/build.zip';
const r2Al = (zip, ek = {}) => (u) => ({
  bookId: '45549', platform: 'android', kaynakTuru: 'r2-al', kaynakSurumu: '2.51.10',
  kaynakUrl: `${u}${R2_YOL}?X-Amz-Signature=abc`, kaynakSha256: sha256(zip), kaynakBoyut: zip.length, ...ek,
});

// ---------------------------------------------------------------------------
// r2-al
// ---------------------------------------------------------------------------

test('r2-al: indirilir, sha256+boyut doğrulanır, OLDUĞU GİBİ paketleyiciye; merdiven/set eki ÇAĞRILMAZ; arşive r2Surum', async () => {
  const zip = setBuildZip();
  // Bozuk arşiv kaydı: r2-al'de doğrulamalı arşiv okuması YOK (okunsaydı JSON hatasıyla düşerdi).
  const arsivKoku = tmp('bozuk');
  fs.mkdirSync(path.join(arsivKoku, '45549'));
  fs.writeFileSync(path.join(arsivKoku, '45549', 'kaynak.json'), '{bozuk');
  const r = await isKostur({ arsivKoku, sunucu: { dosyalar: { [R2_YOL]: zip } }, job: r2Al(zip) });
  assert.match(r.hata.message, /packager upload-build failed: HTTP 500/, r.hata.stack);
  assert.equal(r.casus.merdiven, 0, 'r2-al\'de merdiven ÇAĞRILMAMALI');
  assert.equal(r.casus.setEki, 0, 'r2-al\'de set eki ÇAĞRILMAMALI');
  assert.equal(r.casus.r2Indir.length, 1);
  assert.deepEqual(yuklenenZip(r.kayit.uploadGovde), zip, 'paketleyiciye giden zip R2 build\'iyle bayt bayt aynı');
  assert.match(r.loglar, /\[merdiven\] R2 build 2\.51\.10 \(r2-al\) — içerik merdiveni ATLANDI/);
  assert.match(r.loglar, /\[set-ek\] R2 build 2\.51\.10 \(r2-al\) — set üyeliği eki ATLANDI/);
  assert.deepEqual(Object.keys(r.kayit.govdeler), [], 'r2-al R2\'ye yazmaz, kira/kilit bırakmaz');
  const kayit = JSON.parse(fs.readFileSync(path.join(arsivKoku, '45549', 'kaynak.json'), 'utf8'));
  assert.equal(kayit.r2Surum, '2.51.10');
  assert.equal(kayit.sha256, sha256(zip));
});

test('r2-al: arşiv önbelleği aynı sürüm+sha ise HİÇ indirmez; farklı sürümde indirir ve tazeler', async () => {
  const zip = setBuildZip();
  const kok = arsivKur('45549', zip, { r2Surum: '2.51.10', sha256: sha256(zip) });
  let r = await isKostur({ arsivKoku: kok, sunucu: { dosyalar: { [R2_YOL]: zip } }, job: r2Al(zip) });
  assert.match(r.hata.message, /upload-build failed/);
  assert.equal(r.casus.r2Indir.length, 0, 'önbellek isabeti: indirme yok');
  assert.deepEqual(r.kayit.istekler.filter((x) => x.includes('/kaynak/45549')), []);
  assert.deepEqual(yuklenenZip(r.kayit.uploadGovde), zip);
  // Arşivde eski sürüm → indir + tazele.
  const eski = setBuildZip([['111', 'eski']]);
  const kok2 = arsivKur('45549', eski, { r2Surum: '2.51.9', sha256: sha256(eski) });
  r = await isKostur({ arsivKoku: kok2, sunucu: { dosyalar: { [R2_YOL]: zip } }, job: r2Al(zip) });
  assert.equal(r.casus.r2Indir.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(kok2, '45549', 'kaynak.json'), 'utf8')).r2Surum, '2.51.10');
  assert.deepEqual(fs.readFileSync(path.join(kok2, '45549', 'build.zip')), zip);
});

test('r2-al: sha256 uyuşmazlığı → RET (kalıcı), paketleyiciye bir şey gitmez, arşive yazılmaz', async () => {
  const zip = setBuildZip();
  const kok = tmp('arsiv-bos');
  const r = await isKostur({ arsivKoku: kok, sunucu: { dosyalar: { [R2_YOL]: zip } },
    job: r2Al(zip, { kaynakSha256: 'f'.repeat(64) }) });
  assert.ok(r.hata, 'iş düşmeli');
  assert.match(r.hata.message, /\[kaynak-r2\] build sha256 tutmuyor/);
  assert.equal(r.kayit.uploadGovde, null);
  assert.equal(isTransientNetworkError(r.hata), false, 'failed + bildirim yoluna gider');
  assert.equal(ertelenebilirKaynakHatasi(r.hata), false);
  assert.equal(fs.existsSync(path.join(kok, '45549', 'kaynak.json')), false);
});

test('r2-al: imzalı GET 4xx (404) → yeniden denenmez, R2 build etiketiyle görünür hata', async () => {
  const zip = setBuildZip();
  const r = await isKostur({ sunucu: { dosyalar: {} }, job: r2Al(zip) });
  assert.match(r.hata.message, /R2 build HTTP 404 — yeniden denenmez/);
  assert.equal(r.kayit.istekler.filter((x) => x.includes(R2_YOL)).length, 1);
});

// ---------------------------------------------------------------------------
// r2-kur
// ---------------------------------------------------------------------------

const r2Kur = (ek = {}) => () => ({
  bookId: '45549', platform: 'android', kaynakTuru: 'r2-kur', kaynakSurumu: '2.51.10',
  kurulumBitis: '2099-01-01T00:00:00.000Z', setListesi: '111 | Kitap Bir', ...ek,
});
const MERDIVEN = { satirlar: [{ kitap: 'book1', id: '111', durum: 'GUNCEL', vs: 7 }], s1: [] };

test('r2-kur 200: taban arşivden → merdiven → kapı → presign → PUT → tamamla (kitaplar vs merdivenden) → paketleyici', async () => {
  const zip = setBuildZip();
  const kok = arsivKur('45549', zip);
  const r = await isKostur({ arsivKoku: kok, job: r2Kur(), merdivenDonus: MERDIVEN });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.equal(r.casus.merdiven, 1);
  assert.equal(r.casus.setEki, 1);
  assert.deepEqual(Buffer.concat(r.kayit.parcalar), zip, 'R2\'ye yüklenen = kurulan build');
  const t = r.kayit.govdeler['kaynak/tamamla'][0];
  assert.deepEqual(t, {
    bookId: '45549', platform: 'android', surum: '2.51.10', sha256: sha256(zip), boyut: zip.length,
    kitaplar: [{ n: 1, id: '111', vs: 7, icerik: true, kapak: true }],
    uploadId: 'UP-1', r2ObjectKey: 'kaynak/45549/2.51.10/build.zip', parts: [{ partNumber: 1, etag: '"etag-1"' }],
  });
  assert.equal(r.kayit.govdeler['kaynak/birak'], undefined, 'başarıda kilit bırakılmaz (tamamla kapatır)');
  assert.deepEqual(yuklenenZip(r.kayit.uploadGovde), zip, 'paket R2\'ye yazılan build\'den');
  assert.deepEqual(r.is.icerikSurumleri, [{ id: '111', vs: 7 }]);
  const kayit = JSON.parse(fs.readFileSync(path.join(kok, '45549', 'kaynak.json'), 'utf8'));
  assert.equal(kayit.r2Surum, '2.51.10', 'arşiv R2 önbelleği olarak tazelenir');
});

test('r2-kur 409 (sunucu kapısı): yükleme yapılmış olsa da paket ÜRETİLMEZ, birak YOK (sunucu bıraktı), kalıcı hata', async () => {
  const zip = setBuildZip();
  const r = await isKostur({ arsivKoku: arsivKur('45549', zip), job: r2Kur(), merdivenDonus: MERDIVEN,
    sunucu: { tamamla: () => [409, { nedenler: ['boyut 10 < önceki 999 × 0.8'], nedenKodlari: ['boyut-esigi'] }] } });
  assert.match(r.hata.message, /sunucu kapısı RED \(HTTP 409\) \[boyut-esigi\].*boyut 10 < önceki/);
  assert.equal(r.kayit.parcalar.length, 1, 'yükleme yapıldı');
  assert.equal(r.kayit.uploadGovde, null, 'paketleyiciye HİÇBİR ŞEY gitmez');
  assert.equal(r.kayit.govdeler['kaynak/birak'], undefined, 'sunucu kilidi kapı reddiyle aynı istekte bıraktı');
  assert.equal(r.kayit.govdeler.release, undefined, 'kalıcı: kira bırakılmaz, ana döngü failed yazar');
  assert.equal(isTransientNetworkError(r.hata), false);
  assert.equal(ertelenebilirKaynakHatasi(r.hata), false);
});

test('r2-kur kapı reddi: yükleme HİÇ başlamaz (presign yok), birak çağrılır, paket üretilmez', async () => {
  const zip = setBuildZip();
  // Üreteç KAPALI: eksik kitaplı arşiv tabanı atlanmaz (aksi hâlde üreteç koşar), kapı RED vermeye devam eder.
  const r = await isKostur({ arsivKoku: arsivKur('45549', zip), merdivenDonus: MERDIVEN, env: { EMPP_INDEX_URETECI: '0' },
    job: r2Kur({ setListesi: '111 | Kitap Bir\n222 | Kitap İki' }) });
  assert.match(r.hata.message, /yazma kapısı RED.*kitap sayısı 1 ≠ liste 2/);
  assert.equal(r.kayit.govdeler['kaynak/presign-multipart'], undefined);
  assert.equal(r.kayit.parcalar.length, 0);
  assert.equal(r.kayit.uploadGovde, null);
  assert.equal(r.kayit.govdeler['kaynak/birak'].length, 1);
});

test('r2-kur tamamla 5xx (geçici): failed YAZILMAZ — ertelendi, kilit + kira bırakılır', async () => {
  const zip = setBuildZip();
  const r = await isKostur({ arsivKoku: arsivKur('45549', zip), job: r2Kur(), merdivenDonus: MERDIVEN,
    sunucu: { tamamla: () => [503, {}] } });
  assert.equal(r.hata, null, r.hata && r.hata.stack);
  assert.equal(r.donus.ertelendi, true);
  assert.equal(r.kayit.govdeler['kaynak/tamamla'].length, 2, 'EMPP_KAYNAK_UC_DENEME kadar denendi');
  assert.equal(r.kayit.govdeler['kaynak/birak'].length, 1);
  assert.equal(r.kayit.govdeler.release.length, 1);
  assert.equal(r.kayit.uploadGovde, null);
  assert.equal(r.kayit.govdeler.result, undefined, 'failed yazılmaz');
});

test('r2-kur evde (bayrak yok, ofis değil): build kurulmaz, kilit + kira bırakılır', async () => {
  const zip = setBuildZip();
  const r = await isKostur({ arsivKoku: arsivKur('45549', zip), job: r2Kur(), kaynakKurSerbest: false });
  assert.equal(r.hata, null);
  assert.match(r.donus.sebep, /kaynak-kur bu konumda kapalı/);
  assert.equal(r.casus.merdiven, 0);
  assert.equal(r.kayit.govdeler['kaynak/birak'].length, 1);
  assert.equal(r.kayit.govdeler.release.length, 1);
});

test('r2-kur taban yok + üreteç KAPALI (EMPP_INDEX_URETECI=0): §6a BEKLER — kilit + kira bırakılır, failed yok', async () => {
  const r = await isKostur({ job: r2Kur(), env: { EMPP_INDEX_URETECI: '0' } });
  assert.equal(r.hata, null);
  assert.equal(r.donus.ertelendi, true);
  assert.match(r.donus.sebep, /r2-kur: taban yok/);
  assert.equal(r.kayit.govdeler['kaynak/birak'].length, 1);
  assert.equal(r.kayit.govdeler.release.length, 1);
});

test('r2-kur taban yok + üreteç açık ama kurum kalıbı yok: ERTELENİR (uretec-kalip-yok), kilit + kira bırakılır, failed yok', async () => {
  const r = await isKostur({ job: r2Kur() });
  assert.equal(r.hata, null);
  assert.equal(r.donus.ertelendi, true);
  assert.match(r.donus.sebep, /uretec-kalip-yok/);
  assert.equal(r.kayit.govdeler['kaynak/birak'].length, 1);
  assert.equal(r.kayit.govdeler.release.length, 1);
  assert.equal(r.kayit.govdeler['kaynak/tamamla'], undefined);
});

test('r2-kur tabanUrl: önceki geçerli build R2\'den indirilir + sha doğrulanır; arşiv okunmaz', async () => {
  const taban = setBuildZip();
  const tabanYol = '/kaynak/45549/2.51.9/build.zip';
  const kok = tmp('bozuk2');
  fs.mkdirSync(path.join(kok, '45549'));
  fs.writeFileSync(path.join(kok, '45549', 'kaynak.json'), '{bozuk');
  const r = await isKostur({ arsivKoku: kok, merdivenDonus: MERDIVEN, sunucu: { dosyalar: { [tabanYol]: taban } },
    job: (u) => r2Kur({ tabanUrl: `${u}${tabanYol}?X-Amz-Signature=abc`, tabanSha256: sha256(taban) })() });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.equal(r.casus.r2Indir.length, 1);
  assert.equal(r.kayit.govdeler['kaynak/tamamla'].length, 1);
});

test('r2 claim sözleşme dışı (parseNextJob kaynakGecersiz): hiçbir şey indirilmez, r2-kur ise kilit bırakılır', async () => {
  const r = await isKostur({ job: r2Kur({ kaynakGecersiz: 'tabanUrl ve tabanSha256 birlikte gelir' }) });
  assert.match(r.hata.message, /\[kaynak-r2\] claim sözleşme dışı \(r2-kur\): tabanUrl ve tabanSha256/);
  assert.equal(r.casus.r2Indir.length, 0);
  assert.equal(r.kayit.govdeler['kaynak/birak'].length, 1);
  assert.equal(r.kayit.uploadGovde, null);
});

// ---------------------------------------------------------------------------
// /result icerikSurumleri
// ---------------------------------------------------------------------------

test('/result gövdesi: job.icerikSurumleri varsa [{id, vs}] eklenir, yoksa alan hiç yok', async () => {
  const gelen = [];
  const s = http.createServer((req, res) => {
    const p = [];
    req.on('data', (d) => p.push(d));
    req.on('end', () => {
      const yol = req.url.split('?')[0];
      if (yol === '/agents/test/result/presign') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ uploadUrl: `http://127.0.0.1:${s.address().port}/put`, r2ObjectKey: 'k', publicUrl: 'p' }));
      }
      if (yol === '/agents/test/result') gelen.push(JSON.parse(Buffer.concat(p).toString()));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{}');
    });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const eski = CONFIG.apiBase;
  const eskiRate = process.env.AGENT_UPLOAD_RATE;
  CONFIG.apiBase = `http://127.0.0.1:${s.address().port}`;
  process.env.AGENT_UPLOAD_RATE = '';
  const orj = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try {
    const f = path.join(tmp('art'), 'a.apk');
    fs.writeFileSync(f, 'apk');
    await runner.postResultSuccess({ agentId: 'test', token: 'x' }, { bookId: '1', platform: 'android', icerikSurumleri: [{ id: '111', vs: 7 }], kaynakSurumu: '2.51.10' }, f);
    await runner.postResultSuccess({ agentId: 'test', token: 'x' }, { bookId: '1', platform: 'android', icerikSurumleri: [] }, f);
  } finally {
    Object.assign(console, orj);
    CONFIG.apiBase = eski;
    if (eskiRate === undefined) delete process.env.AGENT_UPLOAD_RATE; else process.env.AGENT_UPLOAD_RATE = eskiRate;
    await new Promise((r) => { if (s.closeAllConnections) s.closeAllConnections(); s.close(r); });
  }
  assert.deepEqual(gelen[0].icerikSurumleri, [{ id: '111', vs: 7 }]);
  assert.equal('icerikSurumleri' in gelen[1], false);
  assert.equal(gelen[0].kaynakSurumu, '2.51.10', 'B2 /result: kaynakSurumu gövde kökünde');
  assert.equal('kaynakSurumu' in gelen[1], false, 'claim sürümü yoksa alan yok');
});

// ---------------------------------------------------------------------------
// R2 indirmesi ağ hatasıyla tükenirse GEÇİCİ (koordinatör 01.10): failed yok, ertele
// ---------------------------------------------------------------------------

test('r2-al ağ tükenmesi: failed YAZILMAZ — ertelendi, kira bırakılır, kilit (r2-al\'de yok) bırakılmaz', async () => {
  const zip = setBuildZip();
  const r = await isKostur({ sunucu: { dosyalar: { [R2_YOL]: 'KOPAR' } }, job: r2Al(zip) });
  assert.equal(r.hata, null, r.hata && r.hata.stack);
  assert.equal(r.donus.ertelendi, true);
  assert.match(r.donus.sebep, /R2 build indirilemedi: 2 denemede ağ\/sunucu hatası/);
  assert.equal(r.kayit.istekler.filter((x) => x.includes(R2_YOL)).length, 2, 'AGENT_DOWNLOAD_MAX_ATTEMPTS kadar');
  assert.equal(r.kayit.govdeler.release.length, 1);
  assert.equal(r.kayit.govdeler['kaynak/birak'], undefined);
  assert.equal(r.kayit.govdeler.result, undefined, 'failed yazılmaz');
  assert.equal(r.kayit.uploadGovde, null);
});

test('r2-kur tabanUrl ağ tükenmesi: ertelendi, kilit + kira bırakılır', async () => {
  const tabanYol = '/kaynak/45549/2.51.9/build.zip';
  const r = await isKostur({ sunucu: { dosyalar: { [tabanYol]: 'KOPAR' } },
    job: (u) => r2Kur({ tabanUrl: `${u}${tabanYol}?X-Amz-Signature=abc`, tabanSha256: 'a'.repeat(64) })() });
  assert.equal(r.hata, null, r.hata && r.hata.stack);
  assert.equal(r.donus.ertelendi, true);
  assert.equal(r.kayit.govdeler['kaynak/birak'].length, 1);
  assert.equal(r.kayit.govdeler.release.length, 1);
  assert.equal(r.casus.merdiven, 0);
});

test('manuel yol: ağ tükenmesi bugünkü gibi KALICI kalır (yalnız R2 yolu geçici)', async () => {
  const r = await isKostur({ sunucu: { dosyalar: { '/sources/45549/k.zip': 'KOPAR' } },
    job: (u) => ({ bookId: '45549', platform: 'android', kaynakTuru: 'manuel', downloadUrl: `${u}/sources/45549/k.zip` }) });
  assert.match(r.hata.message, /manuel build indirilemedi/);
  assert.equal(r.kayit.govdeler.release, undefined);
});

// ---------------------------------------------------------------------------
// Kabuk eki (06.10, kabuk-eki-tasarim.md §1): 'ek' kipinde ön kontrol + kabuk adımı ertelemesi
// ---------------------------------------------------------------------------

const EK_ENV = { EMPP_SET_KABUK_TAZELE: '1', EMPP_SET_KABUK_KAYNAGI: 'ek' };
const IKI_KITAP = '111 | Kitap Bir\n222 | Kitap İki';
const ikiKitapZip = () => setBuildZip([['111', 'v1'], ['222', 'v2']]);

/** Ön kontrol + kabuk adımı casusları. */
function kabukCasus({ sonVar = true, kabuk = { durum: 'uygulandi', neden: null } } = {}) {
  const c = { on: [], kabuk: 0 };
  return {
    c,
    adim: {
      kabukEkSonKontrol: async (o) => {
        c.on.push(o);
        return sonVar ? { var: true, neden: null, son: { bookId: o.bookId, uretildi: 'U1', girdiSha: 'ab'.repeat(32) } }
          : { var: false, neden: 'son.json yok' };
      },
      kabukTazele: async () => { c.kabuk += 1; return { ...kabuk }; },
    },
  };
}

test('kabuk eki ön kontrolü: set (2 kitap) + son.json YOK → taban İNDİRİLMEDEN ertele, failed yok', async () => {
  const k = kabukCasus({ sonVar: false });
  const r = await isKostur({ arsivKoku: arsivKur('45549', ikiKitapZip()), env: EK_ENV, adim: k.adim,
    job: r2Kur({ setListesi: IKI_KITAP }), merdivenDonus: MERDIVEN });
  assert.equal(r.hata, null, r.hata && r.hata.stack);
  assert.equal(r.donus.ertelendi, true);
  assert.match(r.donus.sebep, /\[set-kabuk\] kabuk eki yok — son\.json yok; taban İNDİRİLMEDİ/);
  assert.deepEqual(k.c.on, [{ bookId: '45549' }]);
  assert.equal(k.c.kabuk, 0);
  assert.equal(r.casus.merdiven, 0, 'taban kurulmadı');
  assert.equal(r.casus.r2Indir.length, 0);
  assert.doesNotMatch(r.loglar, /kaynak ARŞİVDEN/);
  assert.equal(r.kayit.govdeler['kaynak/birak'].length, 1, 'kurma kilidi bırakıldı');
  assert.equal(r.kayit.govdeler.release.length, 1, 'kira bırakıldı');
  assert.equal(r.kayit.govdeler.result, undefined, 'failed yazılmaz');
  assert.equal(r.kayit.uploadGovde, null);
});

test('kabuk eki: son.json var, kabuk adımı ERTELE → r2Ertele (kilit + kira), R2/paketleyiciye bir şey gitmez', async () => {
  const k = kabukCasus({ kabuk: { durum: 'ertele', kod: 'ek-yok', neden: 'kabuk eki (ek-yok): ek yok', girdiSha: 'ab'.repeat(32) } });
  const r = await isKostur({ arsivKoku: arsivKur('45549', ikiKitapZip()), env: EK_ENV, adim: k.adim,
    job: r2Kur({ setListesi: IKI_KITAP }), merdivenDonus: MERDIVEN });
  assert.equal(r.hata, null, r.hata && r.hata.stack);
  assert.equal(r.donus.ertelendi, true);
  assert.match(r.donus.sebep, /\[set-kabuk\] kabuk eki \(ek-yok\): ek yok/);
  assert.equal(k.c.on.length, 1);
  assert.equal(k.c.kabuk, 1);
  assert.equal(r.casus.merdiven, 1, 'taban kuruldu, kabuk adımına gelindi');
  assert.equal(r.kayit.govdeler['kaynak/presign-multipart'], undefined);
  assert.equal(r.kayit.parcalar.length, 0);
  assert.equal(r.kayit.uploadGovde, null);
  assert.equal(r.kayit.govdeler['kaynak/birak'].length, 1);
  assert.equal(r.kayit.govdeler.release.length, 1);
  assert.equal(r.kayit.govdeler.result, undefined, 'failed yazılmaz');
});

test('kabuk eki: kabuk adımı fırlatırsa ek kipinde de ERTELE (eski kabukla kaynak çıkmaz)', async () => {
  const k = kabukCasus();
  k.adim.kabukTazele = async () => { throw new Error('beklenmedik'); };
  const r = await isKostur({ arsivKoku: arsivKur('45549', ikiKitapZip()), env: EK_ENV, adim: k.adim,
    job: r2Kur({ setListesi: IKI_KITAP }), merdivenDonus: MERDIVEN });
  assert.equal(r.hata, null, r.hata && r.hata.stack);
  assert.equal(r.donus.ertelendi, true);
  assert.equal(r.kayit.parcalar.length, 0);
  assert.equal(r.kayit.govdeler.release.length, 1);
});

test('kabuk eki: son.json var + kabuk UYGULANDI → zincir sürer (R2 yazılır, paketleyiciye gider)', async () => {
  const k = kabukCasus();
  const r = await isKostur({ arsivKoku: arsivKur('45549', ikiKitapZip()), env: EK_ENV, adim: k.adim,
    job: r2Kur({ setListesi: IKI_KITAP }), merdivenDonus: MERDIVEN });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.equal(k.c.kabuk, 1);
  assert.equal(r.kayit.govdeler['kaynak/tamamla'].length, 1);
  assert.equal(r.kayit.govdeler.release, undefined);
});

test('kabuk eki: tek kitaplı liste → ön kontrol YOK; kabuk ATLANDI → zincir sürer', async () => {
  const k = kabukCasus({ sonVar: false, kabuk: { durum: 'atlandi', neden: 'bookN düzeni yok' } });
  const r = await isKostur({ arsivKoku: arsivKur('45549', setBuildZip()), env: EK_ENV, adim: k.adim,
    job: r2Kur(), merdivenDonus: MERDIVEN });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.equal(k.c.on.length, 0);
  assert.equal(k.c.kabuk, 1);
  assert.equal(r.kayit.govdeler['kaynak/tamamla'].length, 1);
});

test('ikili kip (kaynak env yok): ön kontrol yapılmaz, bugünkü zincir', async () => {
  const k = kabukCasus({ sonVar: false, kabuk: { durum: 'atlandi', neden: 'test' } });
  const r = await isKostur({ arsivKoku: arsivKur('45549', ikiKitapZip()), adim: k.adim,
    env: { EMPP_SET_KABUK_TAZELE: '1', EMPP_SET_KABUK_KAYNAGI: 'ikili' },
    job: r2Kur({ setListesi: IKI_KITAP }), merdivenDonus: MERDIVEN });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.equal(k.c.on.length, 0);
  assert.equal(k.c.kabuk, 1);
});


test('kabukErteleBildir: bookId anahtarlı toplu özet — saatte 1 bildirim, N set tek mesaj', () => {
  const eskiDosya = CONFIG.kabukErteleDurumDosyasi;
  const eskiBildirim = process.env.EMPP_BILDIRIM;
  CONFIG.kabukErteleDurumDosyasi = path.join(tmp('kabuk-bildirim'), 'durum.json');
  delete process.env.EMPP_BILDIRIM;
  const giden = [];
  const gonder = (a) => giden.push(a);
  try {
    const t0 = 1_000_000_000;
    const b = (bookId, kod, simdi) => runner.kabukErteleBildir({
      bookId, kod, neden: 'ek yok', girdiSha: 'cd'.repeat(32), kaynakSurumu: '2.51.4', simdi, gonder,
    });
    assert.equal(b('45550', 'ek-yok', t0), true, 'ilk erteleme hemen bildirilir');
    assert.equal(b('45550', 'kapi-red', t0 + 60_000), false, 'aynı saat içinde susar (kod farklı da olsa)');
    assert.equal(b('45551', 'ek-yok', t0 + 120_000), false);
    assert.equal(b('45552', 'ek-bayat', t0 + 180_000), false);
    assert.equal(b('45551', 'ek-yok', t0 + 61 * 60_000), true, 'saat dolunca TEK özet');
    assert.equal(giden.length, 2);
    assert.equal(giden[1][0], 'kosucu');
    assert.match(giden[1][1], /^3 set kabuk eki bekliyor: 45550 \(kapi-red, cdcdcdcdcdcd, 2\.51\.4\); 45551/);
    assert.match(giden[1][1], /Mac: ek-uret --set 45550,45551,45552$/);
    assert.match(giden[1][3], /3 set kabuk eki bekliyor/);
    process.env.EMPP_BILDIRIM = '0';
    assert.equal(b('45553', 'ek-yok', t0 + 200 * 60_000), false, 'EMPP_BILDIRIM=0 → gönderilmez');
  } finally {
    CONFIG.kabukErteleDurumDosyasi = eskiDosya;
    if (eskiBildirim === undefined) delete process.env.EMPP_BILDIRIM; else process.env.EMPP_BILDIRIM = eskiBildirim;
  }
});

// ─── K1 değişmezi (birleşik inceleme): Linux'ta kaynak-kur yalnız tazeleme + 'ek' + açık anahtarla ───

test('K1 yetenek: linux + kaynak-kur — KAYNAGI boş/yanlış, TAZELE=0, anahtar yok → düşer; tam → ilan', () => {
  const anahtar = path.join(tmp('anahtar'), 'kabuk-ek-acik.pem');
  fs.writeFileSync(anahtar, '-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----\n');
  const eski = { caps: CONFIG.caps, kaynakKur: CONFIG.kaynakKur, kaynakKurSerbestFlag: CONFIG.kaynakKurSerbestFlag };
  const anahtarlar = ['EMPP_SET_KABUK_TAZELE', 'EMPP_SET_KABUK_KAYNAGI', 'EMPP_KABUK_EK_ACIK_ANAHTAR'];
  const eskiEnv = Object.fromEntries(anahtarlar.map((k) => [k, process.env[k]]));
  CONFIG.caps = ['android'];
  CONFIG.kaynakKur = true;
  CONFIG.kaynakKurSerbestFlag = path.join(tmp('bayrak'), 'serbest.istek');
  fs.writeFileSync(CONFIG.kaynakKurSerbestFlag, '');
  const caps = (env) => {
    for (const k of anahtarlar) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
    return runner.guncelYetenekler();
  };
  try {
    runner._platformAyarla('linux');
    const tam = { EMPP_SET_KABUK_TAZELE: '1', EMPP_SET_KABUK_KAYNAGI: 'ek', EMPP_KABUK_EK_ACIK_ANAHTAR: anahtar };
    assert.ok(caps(tam).includes('kaynak-kur'), 'tazeleme + ek + anahtar → ilan');
    assert.ok(!caps({ ...tam, EMPP_SET_KABUK_KAYNAGI: '' }).includes('kaynak-kur'), 'KAYNAGI boş → düşer');
    assert.ok(!caps({ ...tam, EMPP_SET_KABUK_KAYNAGI: 'ekk' }).includes('kaynak-kur'), 'KAYNAGI yanlış → düşer');
    assert.ok(!caps({ ...tam, EMPP_SET_KABUK_TAZELE: '0' }).includes('kaynak-kur'), 'TAZELE=0 → düşer');
    assert.ok(!caps({ ...tam, EMPP_KABUK_EK_ACIK_ANAHTAR: `${anahtar}.yok` }).includes('kaynak-kur'), 'anahtar yok → düşer');
    runner._platformAyarla('darwin');
    assert.ok(caps({}).includes('kaynak-kur'), 'Mac Swift ikilisiyle kurar (bugünkü davranış)');
  } finally {
    runner._platformAyarla(null);
    Object.assign(CONFIG, eski);
    for (const k of anahtarlar) { if (eskiEnv[k] === undefined) delete process.env[k]; else process.env[k] = eskiEnv[k]; }
    runner.guncelYetenekler();
  }
});

test('K1 iş anı: linux + r2-kur + kabuk kaynağı ek değil → taban İNDİRİLMEDEN ertele, failed yok', async () => {
  const k = kabukCasus();
  const r = await isKostur({ arsivKoku: arsivKur('45549', ikiKitapZip()), adim: k.adim, platform: 'linux',
    env: { EMPP_SET_KABUK_TAZELE: '1', EMPP_SET_KABUK_KAYNAGI: '' }, job: r2Kur({ setListesi: IKI_KITAP }) });
  assert.equal(r.hata, null, r.hata && r.hata.stack);
  assert.equal(r.donus.ertelendi, true);
  assert.match(r.donus.sebep, /\[set-kabuk\] linux: kabuk kaynağı 'yok' \(yalnız 'ek' kurabilir\) — build kurulmadı/);
  assert.equal(r.casus.merdiven, 0);
  assert.equal(k.c.kabuk, 0);
  assert.equal(r.kayit.govdeler['kaynak/birak'].length, 1);
  assert.equal(r.kayit.govdeler.release.length, 1);
  assert.equal(r.kayit.govdeler.result, undefined);
});

// ─── Ö3: son.json değişmediyse ikinci claim'de taban İNDİRİLMEZ ───

test('Ö3 ön kontrol belleği: eke bağlı erteleme sonrası son.json aynı → indirme sayısı 1', async () => {
  const taban = ikiKitapZip();
  const tabanYol = '/kaynak/45549/2.51.9/build.zip';
  const dosya = path.join(tmp('on-bellek'), 'kabuk-ek-on-kontrol.json');
  const job = (u) => r2Kur({ setListesi: IKI_KITAP, tabanUrl: `${u}${tabanYol}?X-Amz-Signature=abc`,
    tabanSha256: sha256(taban) })();
  const kos = (k) => isKostur({ env: EK_ENV, adim: k.adim, onKontrolDosyasi: dosya, merdivenDonus: MERDIVEN,
    sunucu: { dosyalar: { [tabanYol]: taban } }, job });
  const ertele = { durum: 'ertele', kod: 'ek-yok', neden: 'kabuk eki (ek-yok): ek yok', girdiSha: 'ef'.repeat(32) };
  const k1 = kabukCasus({ kabuk: ertele });
  const r1 = await kos(k1);
  assert.equal(r1.donus.ertelendi, true, r1.hata && r1.hata.stack);
  assert.equal(r1.casus.r2Indir.length, 1, 'ilk claim tabanı indirdi');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(dosya, 'utf8'))), ['45549']);
  const k2 = kabukCasus({ kabuk: ertele });
  const r2 = await kos(k2);
  assert.equal(r2.donus.ertelendi, true);
  assert.match(r2.donus.sebep, /son\.json önceki ertelemeden beri değişmedi \(abababababab\); taban İNDİRİLMEDİ/);
  assert.equal(r1.casus.r2Indir.length + r2.casus.r2Indir.length, 1, 'toplam indirme 1');
  assert.equal(k2.c.kabuk, 0);
  assert.equal(r2.kayit.govdeler.release.length, 1);
  // son.json değişti (Mac yeni ek üretti) → yeniden indirilir; ek uygulanınca bellek temizlenir.
  const k3 = kabukCasus();
  k3.adim.kabukEkSonKontrol = async (o) => ({ var: true, neden: null,
    son: { bookId: o.bookId, uretildi: 'U2', girdiSha: '12'.repeat(32) } });
  const r3 = await kos(k3);
  assert.match(r3.hata.message, /packager upload-build failed/, r3.hata.stack);
  assert.equal(r3.casus.r2Indir.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(dosya, 'utf8')), {}, 'başarıda bellek silinir');
});

test('Ö3: geçici neden (ek-ag) belleğe yazılmaz; sonDegismedi ömür dolunca false', async () => {
  const dosya = path.join(tmp('on-bellek2'), 'kabuk-ek-on-kontrol.json');
  const k = kabukCasus({ kabuk: { durum: 'ertele', kod: 'ek-ag', neden: 'kabuk eki (ek-ag): ECONNRESET' } });
  const r = await isKostur({ arsivKoku: arsivKur('45549', ikiKitapZip()), env: EK_ENV, adim: k.adim,
    onKontrolDosyasi: dosya, job: r2Kur({ setListesi: IKI_KITAP }), merdivenDonus: MERDIVEN });
  assert.equal(r.donus.ertelendi, true);
  assert.equal(fs.existsSync(dosya), false);
  const kayit = { uretildi: 'U1', girdiSha: 'ab', zaman: 1000 };
  assert.equal(runner.sonDegismedi(kayit, { uretildi: 'U1', girdiSha: 'ab' }, 2000), true);
  assert.equal(runner.sonDegismedi(kayit, { uretildi: 'U2', girdiSha: 'ab' }, 2000), false);
  assert.equal(runner.sonDegismedi(kayit, { uretildi: 'U1', girdiSha: 'ab' }, 1000 + 25 * 3600 * 1000), false);
});
