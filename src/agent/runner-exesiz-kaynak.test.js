'use strict';

/**
 * Runner × EXE'SİZ SÖZLEŞME (Nadir 01.10) — gerçek `processJob`, uçtan uca.
 *
 * İmpark exe'si HİÇBİR koşulda indirilmez. Kaynak: manuel build.zip > kaynak arşivi > yok.
 * Yok → kira `/release` ile bırakılır + `bildir kosucu` + failed YAZILMAZ.
 *
 * Casus: `runner.kaynakIndirme` processJob'daki her uzak kaynak indirmesinin geçtiği nesne;
 * `exeIndir` (= downloadFile) HİÇ çağrılmamalı. Ayrıca sahte API'ye HEAD dahil exe adresine
 * tek istek gitmemeli (exe adresi de yerel sahte sunucuya işaret eder ve sayılır).
 * Paketleyici (3001) yerine sahte HTTP sunucusu: upload-build gövdesi yakalanır (paketleyiciye
 * giden zip'in giriş adları ölçülür), sonra 500 → iş hızlıca düşer. Canlıya istek gitmez.
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

const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
const runner = require('./runner.js');
const { CONFIG, processJob, kaynakIndirme } = runner;

YALITIM.configUygula(CONFIG);
after(() => YALITIM.temizle());

const AYRAC = '// ---------------------------------------------------------------------------\n';
const PROCESS_JOB = SRC.slice(SRC.indexOf('async function processJob'), SRC.indexOf(`${AYRAC}// Main loops`));
const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `exesiz-${ad}-`));

/** Kök build zip'i (sözleşme M1 biçimi). */
function kokBuildZip(bookId) {
  const z = new AdmZip();
  z.addFile('index.html', Buffer.from('<html>manuel</html>'));
  z.addFile(`assets/${bookId}/thumbs/1.jpg`, Buffer.from('manuel-build'));
  return z.toBuffer();
}

/** Eski 59480 tipi: içinde Windows kurulum ağacı (exe + resources/app/build). */
function eskiKurulumZip(bookId) {
  const z = new AdmZip();
  z.addFile('Flashy Grade 8 Set/Flashy Grade 8 Set.exe', Buffer.from('MZ-sahte-exe'));
  z.addFile('Flashy Grade 8 Set/resources/app/build/index.html', Buffer.from('<html>eski</html>'));
  z.addFile(`Flashy Grade 8 Set/resources/app/build/assets/${bookId}/thumbs/1.jpg`, Buffer.from('eski-kurulum'));
  return z.toBuffer();
}

function arsivKur(bookId) {
  const kok = tmp('arsiv');
  const dizin = path.join(kok, String(bookId));
  fs.mkdirSync(dizin);
  const icerik = kokBuildZip(bookId);
  fs.writeFileSync(path.join(dizin, 'build.zip'), icerik);
  fs.writeFileSync(path.join(dizin, 'kaynak.json'), JSON.stringify({
    dosya: 'build.zip', md5: crypto.createHash('md5').update(icerik).digest('hex'),
    boyut: icerik.length, etiket: 'test',
  }));
  return kok;
}

/** Sahte bildir ikilisi: argv'yi satır olarak dosyaya yazar. */
function sahteBildir() {
  const d = tmp('bildir');
  const gunluk = path.join(d, 'gunluk.txt');
  const ikili = path.join(d, 'bildir');
  fs.writeFileSync(ikili, `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(gunluk)}, `
    + 'JSON.stringify(process.argv.slice(2)) + "\\n");\n', { mode: 0o755 });
  return {
    ikili,
    async oku(bekleMs = 3000) {
      const son = Date.now() + bekleMs;
      while (Date.now() < son) {
        if (fs.existsSync(gunluk)) return fs.readFileSync(gunluk, 'utf8').trim().split('\n').map((s) => JSON.parse(s));
        await new Promise((r) => setTimeout(r, 50));
      }
      return [];
    },
  };
}

/**
 * Tek sahte sunucu: book-update API (/agents/test/release) + manuel build dosyaları (/sources/…) +
 * İmpark exe adresi (/exe/…) + paketleyici (/api/upload-build → gövde yakalanır, 500).
 */
async function sahteSunucu(dosyalar = {}) {
  const kayit = { istekler: [], release: [], uploadGovde: null };
  const s = http.createServer((req, res) => {
    const parca = [];
    req.on('data', (d) => parca.push(d));
    req.on('end', () => {
      const govde = Buffer.concat(parca);
      kayit.istekler.push(`${req.method} ${req.url}`);
      if (req.url === '/agents/test/release') {
        kayit.release.push(JSON.parse(govde.toString()));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"ok":true}');
      }
      if (req.url === '/api/upload-build') {
        kayit.uploadGovde = govde;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end('{}');
      }
      const yol = req.url.split('?')[0];
      if (dosyalar[yol]) { res.writeHead(200); return res.end(dosyalar[yol]); }
      res.writeHead(404); return res.end();
    });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  return { url, kayit, kapat: () => new Promise((r) => { if (s.closeAllConnections) s.closeAllConnections(); s.close(r); }) };
}

/** processJob'u yalıtılmış ortamda koşturur; casuslar kaynakIndirme'ye takılır. */
async function isKostur({ job, arsivKoku = tmp('bos-arsiv'), env = {}, dosyalar = {} }) {
  const sunucu = await sahteSunucu(dosyalar);
  const bildir = sahteBildir();
  const casus = { exeIndir: 0, manuelZipIndir: [] };
  const orjIndirme = { ...kaynakIndirme };
  kaynakIndirme.exeIndir = async (...a) => { casus.exeIndir += 1; return orjIndirme.exeIndir(...a); };
  kaynakIndirme.manuelZipIndir = async (...a) => { casus.manuelZipIndir.push(a[0]); return orjIndirme.manuelZipIndir(...a); };
  const ENV = {
    EMPP_KAYNAK_ARSIVI: arsivKoku, EMPP_SOURCE_CACHE: tmp('cache'), EMPP_ARSIV_MERDIVEN: '0',
    EMPP_SET_UYELIK_EK: '0', EMPP_BILDIRIM: '1', EMPP_BILDIR_IKILI: bildir.ikili,
    EMPP_MERDIVEN_KANIT: tmp('merdiven-kanit'), AGENT_DOWNLOAD_RATE: '', AGENT_DOWNLOAD_MAX_ATTEMPTS: '2',
    ...env,
  };
  const eskiEnv = {};
  for (const k of Object.keys(ENV)) { eskiEnv[k] = process.env[k]; process.env[k] = ENV[k]; }
  const eski = { apiBase: CONFIG.apiBase, packagerApi: CONFIG.packagerApi, pardusBuildScript: CONFIG.pardusBuildScript };
  CONFIG.apiBase = sunucu.url;
  CONFIG.packagerApi = sunucu.url;
  // Güvenlik ağı: pardus dalına düşülürse GERÇEK Docker derlemesi başlamasın.
  const sahteBetik = path.join(tmp('pardus-betik'), 'pardus-packager-build.sh');
  fs.writeFileSync(sahteBetik, '#!/bin/bash\necho "SAHTE pardus betiği" >&2\nexit 1\n', { mode: 0o755 });
  CONFIG.pardusBuildScript = sahteBetik;
  runner._kaynakYokBildirimSifirla();
  const loglar = [];
  const orj = { log: console.log, warn: console.warn };
  console.log = (...a) => loglar.push(a.join(' '));
  console.warn = (...a) => loglar.push(a.join(' '));
  let hata = null;
  let donus;
  try {
    donus = await processJob({ agentId: 'test', token: 'x' }, {
      bookTitle: 'Test Set', publisherName: 'YDS Publishing', ...job(sunucu.url),
    });
  } catch (e) {
    hata = e;
  } finally {
    Object.assign(console, orj);
    Object.assign(kaynakIndirme, orjIndirme);
    Object.assign(CONFIG, eski);
    for (const [k, v] of Object.entries(eskiEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await sunucu.kapat();
  }
  return { hata, donus, casus, loglar: loglar.join('\n'), kayit: sunucu.kayit, bildir };
}

/** Paketleyiciye giden multipart gövdedeki zip'in giriş adları (yerel başlıklardan). */
function yuklenenZipGirisleri(govde) {
  assert.ok(govde, 'paketleyiciye build gitmeli');
  const bas = govde.indexOf(Buffer.from('PK\u0003\u0004', 'latin1'));
  const son = govde.lastIndexOf(Buffer.from('PK\u0005\u0006', 'latin1'));
  assert.ok(bas >= 0 && son > bas, 'gövdede zip bulunamadı');
  return new AdmZip(govde.subarray(bas, son + 22)).getEntries().map((e) => e.entryName).sort();
}

const exeAdresi = (u, id) => `${u}/exe/akillitahtalar/${id}/YDT-Marvel-Set-v62.exe?X-Amz-Signature=abc`;

// ---------------------------------------------------------------------------
// 3. YOK — exe indirilmez, kira bırakılır, bildirim, failed yazılmaz
// ---------------------------------------------------------------------------

for (const platform of ['android', 'mac', 'pardus']) {
  test(`yok (${platform}): exe adresi var, arşiv/manuel yok → exe HİÇ indirilmez, /release + bildir kosucu, failed YOK`, async () => {
    const r = await isKostur({ job: (u) => ({ bookId: '45472', platform, downloadUrl: exeAdresi(u, '45472') }) });
    assert.equal(r.hata, null, r.hata && r.hata.stack);
    assert.deepEqual(r.donus, { ertelendi: true, sebep: 'build yok — exe\'siz sözleşme: arşiv/manuel kaynak gerekli' });
    assert.equal(r.casus.exeIndir, 0, 'exe indirme fonksiyonu ÇAĞRILMAMALI');
    assert.deepEqual(r.casus.manuelZipIndir, []);
    // Exe adresine HİÇBİR istek (GET/HEAD) gitmedi; paketleyiciye de.
    assert.deepEqual(r.kayit.istekler.filter((x) => /\/exe\//.test(x)), [], 'exe adresine istek gitmemeli (HEAD dahil)');
    assert.equal(r.kayit.uploadGovde, null, 'paketleyiciye bir şey gitmemeli');
    assert.deepEqual(r.kayit.release, [{ bookId: '45472', platform,
      sebep: 'build yok — exe\'siz sözleşme: arşiv/manuel kaynak gerekli' }]);
    assert.deepEqual(r.kayit.istekler.filter((x) => /result/.test(x)), [], 'failed/sonuç yazılmamalı');
    assert.match(r.loglar, /\[kaynak-yok\] 45472 .*exe İNDİRİLMEDİ, failed YAZILMADI, kira BIRAKILDI/);
    const b = await r.bildir.oku();
    assert.equal(b.length, 1);
    assert.equal(b[0][0], 'kosucu');
    assert.match(b[0][1], /^Test Set \(45472\) — build yok — exe'siz sözleşme/);
    assert.match(b[0][3], new RegExp(`${platform} bekliyor — build yok`));
  });
}

test('yok: downloadUrl HİÇ yok (exe\'siz claim) → aynı şekilde kira bırakılır', async () => {
  const r = await isKostur({ job: () => ({ bookId: '45100', platform: 'android', downloadUrl: '' }) });
  assert.equal(r.hata, null);
  assert.equal(r.donus.ertelendi, true);
  assert.equal(r.casus.exeIndir, 0);
  assert.equal(r.kayit.release.length, 1);
});

test('yok: aynı (kitap, platform) için bildirim süreç başına aralıkta BİR KEZ gider; log her seferinde', async () => {
  const bildir = sahteBildir();
  const eski = { ikili: process.env.EMPP_BILDIR_IKILI, b: process.env.EMPP_BILDIRIM };
  process.env.EMPP_BILDIR_IKILI = bildir.ikili;
  process.env.EMPP_BILDIRIM = '1';
  runner._kaynakYokBildirimSifirla();
  try {
    const is = { bookId: '1', platform: 'android', sebep: 's' };
    assert.equal(runner.kaynakYokBildir(is), true);
    assert.equal(runner.kaynakYokBildir(is), false, 'ikinci bildirim aralık içinde gitmemeli');
    assert.equal(runner.kaynakYokBildir({ ...is, platform: 'mac' }), true, 'başka platform ayrı sayılır');
    process.env.EMPP_BILDIRIM = '0';
    assert.equal(runner.kaynakYokBildir({ ...is, bookId: '2' }), false, 'EMPP_BILDIRIM=0 kapatır');
  } finally {
    for (const [k, v] of [['EMPP_BILDIR_IKILI', eski.ikili], ['EMPP_BILDIRIM', eski.b]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    runner._kaynakYokBildirimSifirla();
  }
});

// ---------------------------------------------------------------------------
// 1. MANUEL — indir, olduğu gibi kullan (merdiven + set eki ATLANIR)
// ---------------------------------------------------------------------------

test('manuel (/sources/, kök build): indirilir, zip OLDUĞU GİBİ paketleyiciye gider; exe indirilmez, arşiv okunmaz', async () => {
  const zip = kokBuildZip('45482');
  // Bozuk arşiv kaydı: manuel işte arşiv OKUNMAMALI (okunursa JSON hatasıyla düşerdi).
  const arsivKoku = tmp('bozuk-arsiv');
  fs.mkdirSync(path.join(arsivKoku, '45482'));
  fs.writeFileSync(path.join(arsivKoku, '45482', 'kaynak.json'), '{bozuk');
  const r = await isKostur({
    arsivKoku,
    dosyalar: { '/sources/45482/20261001-120000-shallwe8.zip': zip },
    job: (u) => ({ bookId: '45482', platform: 'android',
      downloadUrl: `${u}/sources/45482/20261001-120000-shallwe8.zip?X-Amz-Signature=abc` }),
  });
  assert.match(r.hata.message, /packager upload-build failed: HTTP 500/, r.hata.stack);
  assert.equal(r.casus.exeIndir, 0);
  assert.equal(r.casus.manuelZipIndir.length, 1);
  assert.match(r.loglar, /kaynak MANUEL build\.zip \(45482\)/);
  assert.match(r.loglar, /zip kökü doğrudan build — olduğu gibi/);
  assert.deepEqual(yuklenenZipGirisleri(r.kayit.uploadGovde), ['assets/45482/thumbs/1.jpg', 'index.html']);
  assert.equal(r.kayit.release.length, 0, 'kaynak varken kira bırakılmaz');
});

test('manuel: içerik merdiveni ve set üyeliği eki AÇIKKEN bile ATLANIR (log satırıyla)', async () => {
  const r = await isKostur({
    env: { EMPP_ARSIV_MERDIVEN: '1', EMPP_SET_UYELIK_EK: '1' },
    dosyalar: { '/sources/45482/k.zip': kokBuildZip('45482') },
    job: (u) => ({ bookId: '45482', platform: 'android', downloadUrl: `${u}/sources/45482/k.zip`,
      setListesi: '45356 | Student Book\n45352 | Test Book' }),
  });
  assert.match(r.hata.message, /packager upload-build failed/);
  assert.match(r.loglar, /\[merdiven\] manuel build — içerik merdiveni ATLANDI/);
  assert.match(r.loglar, /\[set-ek\] manuel build — set üyeliği eki ATLANDI/);
  assert.doesNotMatch(r.loglar, /\[merdiven\] S0/, 'merdiven koşmamalı');
  assert.doesNotMatch(r.loglar, /\[set-ek\] (set listesi|liste|ek)/i, 'set eki koşmamalı');
  // Tek [set-ek] / [merdiven] satırı = yalnız ATLANDI notu; ek ya da merdiven koşsaydı kendi satırlarını yazardı.
  assert.equal(r.loglar.split('\n').filter((l) => l.includes('[set-ek]')).length, 1, r.loglar);
  assert.equal(r.loglar.split('\n').filter((l) => l.includes('[merdiven]')).length, 1, r.loglar);
});

test('manuel (claim kaynakTuru=manuel, işaretsiz adres) → manuel indirilir', async () => {
  const r = await isKostur({
    dosyalar: { '/baska/build.zip': kokBuildZip('45482') },
    job: (u) => ({ bookId: '45482', platform: 'mac', kaynakTuru: 'manuel', downloadUrl: `${u}/baska/build.zip` }),
  });
  assert.match(r.hata.message, /packager upload-build failed/);
  assert.equal(r.casus.manuelZipIndir.length, 1);
  assert.equal(r.casus.exeIndir, 0);
});

test('manuel (eski 59480 tipi kurulum ağacı): resources/app/build çıkarılır, KÖKÜ build olan zip paketleyiciye gider', async () => {
  const r = await isKostur({
    dosyalar: { '/sources/59480/20260910-flashy8.zip': eskiKurulumZip('59480') },
    job: (u) => ({ bookId: '59480', platform: 'android', downloadUrl: `${u}/sources/59480/20260910-flashy8.zip` }),
  });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.match(r.loglar, /eski kurulum ağacı \(resources\/app\/build\)/);
  const girisler = yuklenenZipGirisleri(r.kayit.uploadGovde);
  assert.ok(girisler.includes('index.html'), girisler.join(','));
  assert.ok(girisler.includes('assets/59480/thumbs/1.jpg'), girisler.join(','));
  assert.ok(!girisler.some((g) => /resources|\.exe$/.test(g)), `kurulum ağacı/exe sızmamalı: ${girisler}`);
  assert.equal(r.casus.exeIndir, 0);
});

test('manuel: indirilen dosya geçerli zip değilse iş görünür hatayla düşer (paketleyiciye gitmez)', async () => {
  const r = await isKostur({
    env: { AGENT_DOWNLOAD_MAX_ATTEMPTS: '1' },
    dosyalar: { '/sources/45482/bozuk.zip': Buffer.from('zip değil') },
    job: (u) => ({ bookId: '45482', platform: 'android', downloadUrl: `${u}/sources/45482/bozuk.zip` }),
  });
  assert.match(r.hata.message, /manuel build indirilemedi: 1 denemede geçerli zip gelmedi/);
  assert.equal(r.kayit.uploadGovde, null);
});

test('manuelZipIndir: .exe yolu İNDİRMEZ, fırlatır (son emniyet); downloadFile de .exe reddeder', async () => {
  await assert.rejects(() => runner.manuelZipIndir('http://127.0.0.1:9/sources/1/a.exe', path.join(tmp('m'), 'x')),
    /manuel kaynak \.exe olamaz/);
  await assert.rejects(() => runner.downloadFile('http://127.0.0.1:9/akillitahtalar/1/a.exe?X-Amz=1', path.join(tmp('d'), 'x')),
    /exe'siz sözleşme: İmpark exe'si indirilmez/);
});

// ---------------------------------------------------------------------------
// 2. ARŞİV — bugünkü davranış (arşiv + merdiven + set eki), exe indirilmez
// ---------------------------------------------------------------------------

test('arşiv: exe adresi olsa da arşiv kullanılır, merdiven AÇIKSA koşar; exe indirilmez, exe adresine istek yok', async () => {
  const r = await isKostur({
    arsivKoku: arsivKur('45482'),
    env: { EMPP_ARSIV_MERDIVEN: '1' },
    job: (u) => ({ bookId: '45482', platform: 'android', downloadUrl: exeAdresi(u, '45482') }),
  });
  assert.match(r.hata.message, /packager upload-build failed: HTTP 500/, r.hata.stack);
  assert.match(r.loglar, /kaynak ARŞİVDEN/);
  assert.match(r.loglar, /\[merdiven\] S0: menü/, 'arşivde merdiven koşmalı (menüsüz test zip\'inde S0 atlar)');
  assert.equal(r.casus.exeIndir, 0);
  assert.deepEqual(r.casus.manuelZipIndir, []);
  assert.deepEqual(r.kayit.istekler.filter((x) => /\/exe\//.test(x)), [], 'exe adresine istek (HEAD dahil) gitmemeli');
  assert.equal(r.kayit.release.length, 0);
  assert.deepEqual(yuklenenZipGirisleri(r.kayit.uploadGovde), ['assets/45482/thumbs/1.jpg', 'index.html']);
});

test('arşiv (pardus): disk kapısı boyutu arşiv zip\'inden ölçer, exe adresine HEAD ATMAZ', async () => {
  const r = await isKostur({
    arsivKoku: arsivKur('45482'),
    env: { PARDUS_MIN_FREE_GB: '999999' },
    job: (u) => ({ bookId: '45482', platform: 'pardus', downloadUrl: exeAdresi(u, '45482') }),
  });
  assert.match(r.hata.message, /\[ertelenebilir-kaynak-darligi\] pardus disk kapısı — .* \(kaynak 0 MB\); kaynak İNDİRİLMEDİ/);
  assert.deepEqual(r.kayit.istekler, [], 'hiçbir uzak isteğe (HEAD dahil) çıkılmamalı');
  assert.equal(r.casus.exeIndir, 0);
});

test('manuel (pardus): disk kapısı manuel adrese de HEAD ATMAZ (taban eşik), indirmeden ÖNCE sorulur', async () => {
  const r = await isKostur({
    env: { PARDUS_MIN_FREE_GB: '999999' },
    dosyalar: { '/sources/45482/k.zip': kokBuildZip('45482') },
    job: (u) => ({ bookId: '45482', platform: 'pardus', downloadUrl: `${u}/sources/45482/k.zip` }),
  });
  assert.match(r.hata.message, /pardus disk kapısı — .*\(kaynak bilinmiyor\); kaynak İNDİRİLMEDİ/);
  assert.deepEqual(r.kayit.istekler, [], 'HEAD/GET gitmemeli');
  assert.deepEqual(r.casus.manuelZipIndir, [], 'disk kapısı indirmeden önce');
});

// ---------------------------------------------------------------------------
// Kaynak metni — exe yolları processJob'dan sökülmüş olmalı (nöbetçi)
// ---------------------------------------------------------------------------

test('processJob metni: exe indirme/SFX açma/HEAD/önbellek/hazır paket yolu YOK; kaynak tek karardan', () => {
  const kod = PROCESS_JOB.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const yasak of ['downloadFile(', 'exeIndir', 'extractSfx(', 'axios.head', 'cachedZip',
    'hazirPardusPaketi(', 'applyPublisherUpdate(', 'source cache MISS']) {
    assert.ok(!kod.includes(yasak), `processJob '${yasak}' içermemeli`);
  }
  assert.match(kod, /const kaynak = kaynakKarari\(\{ job, arsiv \}\);/);
  assert.match(kod, /if \(kaynak\.tur === 'yok'\) \{\s*\n\s*await kaynakYokBekle\(auth, job, kaynak\.sebep\);\s*\n\s*return \{ ertelendi: true/);
  // Karar, ilk indirme/kopyalamadan ÖNCE.
  const karar = kod.indexOf('kaynakKarari(');
  for (const sonra of ['manuelBuildHazirla(', 'fsp.copyFile(arsiv.zip', 'icerikKapisiDenetleZip(']) {
    assert.ok(kod.indexOf(sonra) > karar, `${sonra} karardan sonra gelmeli`);
  }
});

test('hazirPardusPaketi: dizin + eşleşen kayıt olsa bile HER ZAMAN null (devir kapalı)', async () => {
  const dir = tmp('hazir');
  fs.writeFileSync(path.join(dir, '45704.impark'), Buffer.alloc(200000, 1));
  fs.writeFileSync(path.join(dir, '45704.json'), JSON.stringify({ srcVersion: 'MP8-v49.exe',
    paketleyiciKimligi: require('../packaging/surum-turet').paketleyiciKaynakParmakIzi() }));
  const prev = CONFIG.pardusHazirDir;
  CONFIG.pardusHazirDir = dir;
  try {
    assert.equal(await runner.hazirPardusPaketi({ bookId: '45704', srcVersion: 'MP8-v49.exe' }), null);
    assert.ok(fs.existsSync(path.join(dir, '45704.impark')), 'hazır dosyaya dokunulmamalı');
  } finally { CONFIG.pardusHazirDir = prev; }
});

test('kaynakBoyutuTahmin: yalnız yerel; adres verilse de ağa çıkmaz', async () => {
  const d = tmp('boyut');
  const f = path.join(d, 'b.zip');
  fs.writeFileSync(f, Buffer.alloc(1234));
  assert.equal(await runner.kaynakBoyutuTahmin({ yerelZip: f }), 1234);
  assert.equal(await runner.kaynakBoyutuTahmin({ yerelZip: path.join(d, 'yok.zip') }), null);
  assert.equal(await runner.kaynakBoyutuTahmin({ yerelZip: null, downloadUrl: 'http://127.0.0.1:9/a.exe' }), null);
  assert.equal(await runner.kaynakBoyutuTahmin(), null);
});

test('ana döngü: processJob { ertelendi } dönerse failed yazılmaz, kısa beklenir', () => {
  const dongu = SRC.slice(SRC.indexOf('// A bad job must never kill the loop.'));
  assert.match(dongu, /const sonuc = await processJob\(auth, job\);\s*\n(\s*\/\/.*\n)*\s*if \(sonuc && sonuc\.ertelendi\) await sleep\(15000\);/);
});

test('kaynak yok: kira bırakılmadan ÖNCE nabızdan düşülür (heartbeat bırakılan kirayı tazelemesin)', () => {
  const fn = SRC.slice(SRC.indexOf('async function kaynakYokBekle'), SRC.indexOf('async function kaynakYokBekle') + 900);
  const sifir = fn.indexOf('currentJob = null;');
  const birak = fn.indexOf('await releaseJob(auth, job, sebep)');
  assert.ok(sifir > 0 && birak > sifir, 'currentJob = null, releaseJob\'dan önce olmalı');
});
