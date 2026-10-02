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
async function sahteSunucu(dosyalar = {}, { releaseKanca = null, ozel = null } = {}) {
  const kayit = { istekler: [], release: [], uploadGovde: null, heartbeat: [] };
  const s = http.createServer((req, res) => {
    const parca = [];
    req.on('data', (d) => parca.push(d));
    req.on('end', () => {
      const govde = Buffer.concat(parca);
      kayit.istekler.push(`${req.method} ${req.url}`);
      if (ozel && ozel(req, res, kayit)) return undefined;
      if (req.url === '/agents/test/heartbeat') {
        kayit.heartbeat.push(JSON.parse(govde.toString()));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{}');
      }
      if (req.url === '/agents/test/release') {
        kayit.release.push(JSON.parse(govde.toString()));
        const bitir = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); };
        if (releaseKanca) return Promise.resolve(releaseKanca()).then(bitir);
        return bitir();
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
async function isKostur({ job, arsivKoku = tmp('bos-arsiv'), env = {}, dosyalar = {}, sunucuSec = {} }) {
  const sunucu = await sahteSunucu(dosyalar, sunucuSec);
  const bildir = sahteBildir();
  const casus = { exeIndir: 0, manuelZipIndir: [] };
  const orjIndirme = { ...kaynakIndirme };
  kaynakIndirme.exeIndir = async (...a) => { casus.exeIndir += 1; return orjIndirme.exeIndir(...a); };
  kaynakIndirme.manuelZipIndir = async (...a) => { casus.manuelZipIndir.push(a[0]); return orjIndirme.manuelZipIndir(...a); };
  const ENV = {
    EMPP_KAYNAK_ARSIVI: arsivKoku, EMPP_SOURCE_CACHE: tmp('cache'), EMPP_ARSIV_MERDIVEN: '0',
    EMPP_SET_UYELIK_EK: '0', EMPP_BILDIRIM: '1', EMPP_BILDIR_IKILI: bildir.ikili,
    EMPP_MERDIVEN_KANIT: tmp('merdiven-kanit'), AGENT_DOWNLOAD_RATE: '', AGENT_DOWNLOAD_MAX_ATTEMPTS: '2',
    EMPP_KAYNAK_YOK_DURUM: path.join(tmp('durum'), 'kaynak-yok-bildirim.json'),
    ...env,
  };
  const eskiEnv = {};
  for (const k of Object.keys(ENV)) { eskiEnv[k] = process.env[k]; process.env[k] = ENV[k]; }
  const eski = { apiBase: CONFIG.apiBase, packagerApi: CONFIG.packagerApi, pardusBuildScript: CONFIG.pardusBuildScript,
    kaynakYokDurumDosyasi: CONFIG.kaynakYokDurumDosyasi };
  CONFIG.kaynakYokDurumDosyasi = ENV.EMPP_KAYNAK_YOK_DURUM;
  CONFIG.apiBase = sunucu.url;
  CONFIG.packagerApi = sunucu.url;
  // Güvenlik ağı: pardus dalına düşülürse GERÇEK Docker derlemesi başlamasın.
  const sahteBetik = path.join(tmp('pardus-betik'), 'pardus-packager-build.sh');
  fs.writeFileSync(sahteBetik, '#!/bin/bash\necho "SAHTE pardus betiği" >&2\nexit 1\n', { mode: 0o755 });
  CONFIG.pardusBuildScript = sahteBetik;
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
  return new AdmZip(govde.subarray(bas, son + 22)).getEntries().map((e) => e.entryName)
    .filter((ad) => !ad.endsWith('/')).sort(); // dizin girişleri (zipDir) karşılaştırmaya girmez
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
    assert.match(b[0][1], new RegExp(`^1 iş build bekliyor: 45472/${platform}\\. Exe indirilmez`));
    assert.equal(b[0][3], '⏸ 1 iş build bekliyor');
  });
}

test('yok: downloadUrl HİÇ yok (exe\'siz claim) → aynı şekilde kira bırakılır', async () => {
  const r = await isKostur({ job: () => ({ bookId: '45100', platform: 'android', downloadUrl: '' }) });
  assert.equal(r.hata, null);
  assert.equal(r.donus.ertelendi, true);
  assert.equal(r.casus.exeIndir, 0);
  assert.equal(r.kayit.release.length, 1);
});

/** Özet bildirim testleri için yalıtılmış durum dosyası + sahte bildir. */
async function ozetOrtami(fn) {
  const bildir = sahteBildir();
  const durum = path.join(tmp('ozet'), 'kaynak-yok-bildirim.json');
  const eski = { ikili: process.env.EMPP_BILDIR_IKILI, b: process.env.EMPP_BILDIRIM, d: CONFIG.kaynakYokDurumDosyasi };
  process.env.EMPP_BILDIR_IKILI = bildir.ikili;
  process.env.EMPP_BILDIRIM = '1';
  CONFIG.kaynakYokDurumDosyasi = durum;
  try { await fn({ bildir, durum }); } finally {
    CONFIG.kaynakYokDurumDosyasi = eski.d;
    for (const [k, v] of [['EMPP_BILDIR_IKILI', eski.ikili], ['EMPP_BILDIRIM', eski.b]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('özet bildirim: saatte EN ÇOK BİR, bekleyenler birikir; aralık dolunca TEK özet "N iş build bekliyor"', async () => {
  await ozetOrtami(async ({ bildir, durum }) => {
    const t0 = 1_000_000_000_000;
    assert.equal(runner.kaynakYokOzet({ bookId: '45472', platform: 'android', simdi: t0 }), true, 'ilk bildirim gider');
    assert.equal(runner.kaynakYokOzet({ bookId: '45472', platform: 'mac', simdi: t0 + 60_000 }), false);
    assert.equal(runner.kaynakYokOzet({ bookId: '45100', platform: 'pardus', simdi: t0 + 120_000 }), false);
    assert.equal(runner.kaynakYokOzet({ bookId: '45472', platform: 'mac', simdi: t0 + 180_000 }), false, 'aynı iş tekrar sayılmaz');
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(durum, 'utf8')).bekleyen).sort(),
      ['45100|pardus', '45472|mac']);
    assert.equal(runner.kaynakYokOzet({ bookId: '45100', platform: 'android', simdi: t0 + 3_600_000 }), true, '1 sa dolunca özet');
    const b = await bildir.oku();
    const bekle = Date.now() + 3000;
    let satirlar = b;
    while (satirlar.length < 2 && Date.now() < bekle) { await new Promise((r) => setTimeout(r, 50)); satirlar = await bildir.oku(); }
    assert.equal(satirlar.length, 2, 'toplam iki bildirim (ilk + özet)');
    const ozetler = satirlar.map((x) => x[1].split('.')[0]).sort();
    assert.deepEqual(ozetler, ['1 iş build bekliyor: 45472/android',
      '3 iş build bekliyor: 45100/android, 45100/pardus, 45472/mac']);
    assert.deepEqual(JSON.parse(fs.readFileSync(durum, 'utf8')).bekleyen, {}, 'gönderince liste sıfırlanır');
  });
});

test('özet bildirim: süreç YENİDEN BAŞLASA da sel olmaz (son gönderim durum dosyasından okunur)', async () => {
  await ozetOrtami(async ({ durum }) => {
    const t0 = Date.now();
    // "önceki süreç" 10 dk önce göndermiş
    fs.writeFileSync(durum, JSON.stringify({ sonGonderimMs: t0 - 600_000, bekleyen: {} }));
    for (let i = 0; i < 30; i += 1) {
      assert.equal(runner.kaynakYokOzet({ bookId: String(70000 + i), platform: 'android', simdi: t0 + i }), false);
    }
    assert.equal(Object.keys(runner.kaynakYokDurumOku().bekleyen).length, 30);
  });
});

test('özet bildirim: EMPP_BILDIRIM=0 hiç göndermez ama bekleyeni kaydeder; bozuk durum dosyası sıfırdan başlar', async () => {
  await ozetOrtami(async ({ durum }) => {
    fs.writeFileSync(durum, '{bozuk');
    process.env.EMPP_BILDIRIM = '0';
    assert.equal(runner.kaynakYokOzet({ bookId: '1', platform: 'mac', simdi: Date.now() }), false);
    assert.deepEqual(Object.keys(runner.kaynakYokDurumOku().bekleyen), ['1|mac']);
  });
});

test('kaynakYokOzetMetni: 20\'den fazla iş kırpılır (+N)', () => {
  const liste = Array.from({ length: 23 }, (_, i) => ({ bookId: String(100 + i), platform: 'android' }));
  const m = runner.kaynakYokOzetMetni(liste);
  assert.match(m, /^23 iş build bekliyor: 100\/android, .*119\/android … \+3\. /);
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
  assert.match(r.loglar, /manuel build: eski-kurulum — build dizini: Flashy Grade 8 Set\/resources\/app\/build/);
  const girisler = yuklenenZipGirisleri(r.kayit.uploadGovde);
  assert.ok(girisler.includes('index.html'), girisler.join(','));
  assert.ok(girisler.includes('assets/59480/thumbs/1.jpg'), girisler.join(','));
  assert.ok(!girisler.some((g) => /resources|\.exe$/.test(g)), `kurulum ağacı/exe sızmamalı: ${girisler}`);
  assert.equal(r.casus.exeIndir, 0);
});

test('manuel: tam inen içerik geçerli zip değilse EN ÇOK 2 kez denenir, sonra görünür hata (paketleyiciye gitmez)', async () => {
  const r = await isKostur({
    env: { AGENT_DOWNLOAD_MAX_ATTEMPTS: '12' },
    dosyalar: { '/sources/45482/bozuk.zip': Buffer.from('zip değil') },
    job: (u) => ({ bookId: '45482', platform: 'android', downloadUrl: `${u}/sources/45482/bozuk.zip` }),
  });
  assert.match(r.hata.message, /manuel build geçerli zip değil \(2 tam indirme, \d+ B\) — vazgeçildi: bozuk\.zip/);
  assert.equal(r.kayit.istekler.filter((x) => x.startsWith('GET /sources/')).length, 2, 'tam 2 indirme');
  assert.equal(r.kayit.uploadGovde, null);
});

for (const kod of [404, 403]) {
  // 3 deneme hakkı: 4xx yeniden denenseydi ~10 sn içinde 3 istek görülür (tek istek beklenir).
  test(`manuel: HTTP ${kod} → yeniden deneme YOK, hemen görünür hata`, { timeout: 30000 }, async () => {
    const r = await isKostur({
      env: { AGENT_DOWNLOAD_MAX_ATTEMPTS: '3' },
      sunucuSec: { ozel: (req, res) => {
        if (!req.url.startsWith('/sources/')) return false;
        res.writeHead(kod); res.end('yok'); return true;
      } },
      job: (u) => ({ bookId: '45482', platform: 'android', downloadUrl: `${u}/sources/45482/k.zip?X-Amz-Signature=a` }),
    });
    assert.match(r.hata.message, new RegExp(`manuel build HTTP ${kod} — yeniden denenmez`));
    assert.equal(r.kayit.istekler.filter((x) => x.startsWith('GET /sources/')).length, 1, 'tek istek');
    assert.equal(r.kayit.uploadGovde, null);
  });
}

test('manuel: içerik Windows exe (MZ) → HEMEN exe hatası, ikinci deneme yok', async () => {
  const r = await isKostur({
    env: { AGENT_DOWNLOAD_MAX_ATTEMPTS: '12' },
    dosyalar: { '/sources/45482/k.zip': Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]) },
    job: (u) => ({ bookId: '45482', platform: 'android', downloadUrl: `${u}/sources/45482/k.zip` }),
  });
  assert.match(r.hata.message, /manuel kaynak bir Windows exe'si \(MZ\) — kullanılmaz: k\.zip/);
  assert.equal(r.kayit.istekler.filter((x) => x.startsWith('GET /sources/')).length, 1);
});

test('manuel: geçici 503 yeniden denenir (ağ/5xx sınıfı), ardından build kullanılır', async () => {
  let n = 0;
  const r = await isKostur({
    sunucuSec: { ozel: (req, res) => {
      if (!req.url.startsWith('/sources/')) return false;
      n += 1;
      if (n === 1) { res.writeHead(503); res.end('mesgul'); return true; }
      res.writeHead(200); res.end(kokBuildZip('45482')); return true;
    } },
    job: (u) => ({ bookId: '45482', platform: 'android', downloadUrl: `${u}/sources/45482/k.zip` }),
  });
  assert.match(r.hata.message, /packager upload-build failed: HTTP 500/, r.hata.stack);
  assert.equal(n, 2);
  assert.deepEqual(yuklenenZipGirisleri(r.kayit.uploadGovde), ['assets/45482/thumbs/1.jpg', 'index.html']);
});

test('manuel (Finder sıkıştırması: tek klasör + __MACOSX): klasör build.zip olur, artıklar paketlenmez', async () => {
  const z = new AdmZip();
  z.addFile('build/index.html', Buffer.from('<html></html>'));
  z.addFile('build/assets/45482/thumbs/1.jpg', Buffer.from('jpg'));
  z.addFile('build/.DS_Store', Buffer.from('ds'));
  z.addFile('__MACOSX/build/._index.html', Buffer.from('apple'));
  const r = await isKostur({
    dosyalar: { '/sources/45482/finder.zip': z.toBuffer() },
    job: (u) => ({ bookId: '45482', platform: 'android', downloadUrl: `${u}/sources/45482/finder.zip` }),
  });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.match(r.loglar, /manuel build: sarmalayici \+ macOS artıkları ayıklandı — build dizini: build/);
  assert.deepEqual(yuklenenZipGirisleri(r.kayit.uploadGovde), ['assets/45482/thumbs/1.jpg', 'index.html']);
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
  assert.match(kod, /const kaynak = kaynakKarari\(\{ job, arsiv, uretec: uretecKaynak\.uretecAcik\(\) \}\);/);
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

test('ana döngü: processJob { ertelendi } dönerse failed yazılmaz, KISA (2 sn) beklenir', () => {
  assert.equal(CONFIG.kaynakYokBeklemeMs, 2000);
  const dongu = SRC.slice(SRC.indexOf('// A bad job must never kill the loop.'));
  assert.match(dongu, /const sonuc = await processJob\(auth, job\);\s*\n(\s*\/\/.*\n)*\s*if \(sonuc && sonuc\.ertelendi\) await sleep\(CONFIG\.kaynakYokBeklemeMs\);/);
});

test('kaynak yok: kira bırakılırken nabız işi TAŞIMAZ (heartbeat bırakılan kirayı tazelemez)', async () => {
  const AUTH = { agentId: 'test', token: 'x' };
  const r = await isKostur({
    sunucuSec: { releaseKanca: () => runner.heartbeat(AUTH) },
    job: (u) => ({ bookId: '45472', platform: 'android', downloadUrl: exeAdresi(u, '45472') }),
  });
  assert.equal(r.hata, null);
  assert.equal(r.kayit.release.length, 1);
  assert.equal(r.kayit.heartbeat.length, 1, 'release sırasında bir nabız atıldı');
  assert.deepEqual(r.kayit.heartbeat[0].heldJobs, [], 'nabız bırakılan işi taşımamalı');
});

// Sunucu sözleşmesi (book-update ajan-kaynak-turu.ts): 'arsiv-gerekli' claim'inde downloadUrl YOK,
// exe adresi yalnız bilgiUrl'de — ad bilgisi oradan, indirme ASLA.
test('arsiv-gerekli claim (downloadUrl yok, bilgiUrl exe): arşiv yoksa kira bırakılır, bilgiUrl\'ye istek yok', async () => {
  const r = await isKostur({
    job: (u) => ({ bookId: '45472', platform: 'mac', kaynakTuru: 'arsiv-gerekli', bilgiUrl: exeAdresi(u, '45472') }),
  });
  assert.equal(r.hata, null);
  assert.equal(r.donus.ertelendi, true);
  assert.deepEqual(r.kayit.istekler.filter((x) => /\/exe\//.test(x)), []);
  assert.equal(r.kayit.release.length, 1);
  assert.equal(r.casus.exeIndir, 0);
});

test('arsiv-gerekli claim: arşiv varsa kullanılır; İmpark adı bilgi notu bilgiUrl\'den beslenir', async () => {
  const kok = arsivKur('45482');
  const kayit = JSON.parse(fs.readFileSync(path.join(kok, '45482', 'kaynak.json'), 'utf8'));
  fs.writeFileSync(path.join(kok, '45482', 'kaynak.json'), JSON.stringify({ ...kayit, impark_kaynagi: 'ShallWe8-v47.exe' }));
  const r = await isKostur({
    arsivKoku: kok,
    job: (u) => ({ bookId: '45482', platform: 'android', kaynakTuru: 'arsiv-gerekli',
      bilgiUrl: `${u}/exe/akillitahtalar/45482/ShallWe8-v51.exe?X-Amz-Signature=abc` }),
  });
  assert.match(r.hata.message, /packager upload-build failed/);
  assert.match(r.loglar, /kaynak arşivi 45482: İmpark exe adı değişti \(bilgi\) — ShallWe8-v47\.exe → ShallWe8-v51\.exe/);
  assert.deepEqual(r.kayit.istekler.filter((x) => /\/exe\//.test(x)), []);
});
