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
  merdivenDonus = { satirlar: [], s1: [] }, kaynakKurSerbest = true }) {
  const sunucu = await sahteSunucu(sunucuSec);
  const casus = { merdiven: 0, setEki: 0, r2Indir: [], manuelZipIndir: 0 };
  const orjAdim = { ...kaynakAdim };
  const orjIndirme = { ...kaynakIndirme };
  kaynakAdim.merdiven = async () => { casus.merdiven += 1; return merdivenDonus; };
  kaynakAdim.setEki = async () => { casus.setEki += 1; return { eklenen: [] }; };
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
    kaynakKurSerbestFlag: CONFIG.kaynakKurSerbestFlag, kaynakYokDurumDosyasi: CONFIG.kaynakYokDurumDosyasi };
  CONFIG.apiBase = sunucu.url;
  CONFIG.packagerApi = sunucu.url;
  CONFIG.kaynakKur = true;
  CONFIG.kaynakKurSerbestFlag = path.join(bayrakDizin, 'kaynak-kur-serbest.istek');
  CONFIG.kaynakYokDurumDosyasi = ENV.EMPP_KAYNAK_YOK_DURUM;
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
  const r = await isKostur({ arsivKoku: arsivKur('45549', zip), merdivenDonus: MERDIVEN,
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
