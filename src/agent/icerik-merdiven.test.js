'use strict';

/**
 * İÇERİK MERDİVENİ S0/S1 (2026-09-26) — sentetik set + yerel sahte İmpark ucu.
 * Canlı İmpark'a, R2'ye, panele istek GİTMEZ; her şey os.tmpdir() altında.
 *
 * Kapılar:
 *   - geride olan kitap tazelenir, güncel olana ve KÖKE dokunulmaz (md5 kıyası)
 *   - thumbs kimliği tutmazsa iş düşer (yanlış kitabı ezme)
 *   - İmpark 404 / zaman aşımı → ÖLÇÜLEMEDİ, iş eski içerikle DEVAM ETMEZ, hata geçici sayılmaz
 *   - yazıcı köke dokunursa iş düşer (kök koruma)
 *   - runner: anahtar açıkken arşiv işi merdivenden geçer, kapalıyken geçmez
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

// TEST YALITIMI (2026-09-28, agent-test-borcu-20260928 — bkz. test-yalitim.js). Bu dosya
// `runner.js`'i tek bir test içinde GECİKMELİ require ediyor (aşağıda ~494. satır) — env'i
// modül başında set etmek yine de yeterli (require ne zaman çağrılırsa çağrılsın CONFIG o
// anki env'i okur).
const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();
after(() => YALITIM.temizle());

const ig = require('../runtime/icerik-guncelleme');
const M = require('./icerik-merdiven');
const { isTransientNetworkError, ertelenebilirKaynakHatasi } = require('./runner-helpers');

const MOTOR = '43e23fce2b7009474555a77.js';
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `merdiven-${ad}-`));

function yaz(kok, rel, icerik) {
  const p = path.join(kok, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, icerik);
}

function menu(kapakList) {
  const cov = kapakList.map((c) => `<cover guId="" ID="${c.id}" etkID="${c.id}" `
    + `source="assets/${c.id}/cover.png" corpID="60" actName="${c.ad || c.id}" `
    + `URL="${c.url || `https://example.invalid/Uploads/ZKitapZipH/${c.id}-${c.v}.zip`}" `
    + `version="${c.v}"/>`).join('\n');
  return ig.menuKodla('<?xml version="1.0" encoding="UTF-8"?>\n<main activation="false" key="" '
    + `version="1.0" type="1">\n<Group ID="0"><Tab ID="0">\n${cov}\n</Tab></Group>\n</main>`);
}

function kitapIcerigi(kok, id, { thumbs = ['T1', 'T2', 'T3', 'T4'], bc = `<bc id="${id}"/>` } = {}) {
  yaz(kok, `assets/${id}/data/BookContent.xml`, bc);
  thumbs.forEach((t, i) => yaz(kok, `assets/${id}/thumbs/${i + 1}.jpg`, `thumb-${id}-${t}`));
  yaz(kok, `assets/${id}/pages/1.png`, `sayfa1-${id}-eski`);
  yaz(kok, `assets/${id}/pages/2.png`, `sayfa2-${id}-eski`);
  yaz(kok, `assets/${id}/htmletk/u1/etk/${MOTOR}`, 'etk-motor-eski');
}

/** zip -r (varsayılan dizin girdili; `dizinsiz` → -D, archiver benzeri). */
function zipla(dizin, cikti, { dizinsiz = false } = {}) {
  execFileSync('zip', ['-q', '-r', '-X', ...(dizinsiz ? ['-D'] : []), cikti, '.'], { cwd: dizin });
  return cikti;
}

/**
 * Sentetik set: kök kabuk + book1 (1001 v3, GERİDE) + book2 (1002 v5, güncel) + book3 (ID 0).
 * @returns {{zip: string, uc: (port) => string}}
 */
function setKur({ port, dizinsiz = false, book1Thumbs, book2Icerik = true } = {}) {
  const d = tmp('set');
  const uc = `http://127.0.0.1:${port}/TestlerMobil/GetKitapGuncellemeBilgi`
    + '?id={bookId}&setMi={isSet}&versiyon={version}';
  yaz(d, 'index.html', '<html>SET KABUGU menusu</html>');
  yaz(d, MOTOR, 'kok-motor-43e23');
  yaz(d, 'core/a.js', 'core');
  yaz(d, 'kurum.txt', '60');
  for (const [kitap, id, v] of [['book1', 1001, 3], ['book2', 1002, 5]]) {
    yaz(d, `${kitap}/index.html`, `<html>${kitap} okuyucu</html>`);
    yaz(d, `${kitap}/app.config.js`, `var AppConfig={xml:{desktop:{updateBookEndPoint: "${uc}"}}};`);
    yaz(d, `${kitap}/${MOTOR}`, `${kitap}-ana-motor`);
    yaz(d, `${kitap}/classlibraries/ImWin32.dll`, menu([{ id, v }]));
    if (id === 1002 && !book2Icerik) continue; // 14835 sınıfı: menüde kart var, içerik pakette yok
    kitapIcerigi(path.join(d, kitap), id, id === 1001 && book1Thumbs ? { thumbs: book1Thumbs } : {});
  }
  yaz(d, 'book3/index.html', '<html>video</html>');
  yaz(d, 'book3/app.config.js', `var AppConfig={xml:{desktop:{updateBookEndPoint: "${uc}"}}};`);
  yaz(d, 'book3/classlibraries/ImWin32.dll',
    menu([{ id: 0, v: 1, url: 'Grade-8-Games', ad: 'Grade-8-Games' }]));
  yaz(d, 'book3/assets/Grade-8-Games/data/BookContent.xml', '<bc/>');
  const zip = zipla(d, path.join(tmp('setzip'), 'build.zip'), { dizinsiz });
  return { zip };
}

/** İmpark güncelleme zip'i (ZKitapZipH düzeni: kökte data/ thumbs/ pages/ …). */
function guncellemeZipKur(id, { thumbs = ['T1', 'T2', 'T3', 'T4'], bcYok = false } = {}) {
  const d = tmp('gzip');
  if (!bcYok) yaz(d, 'data/BookContent.xml', `<bc id="${id}" v="yeni"/>`);
  else yaz(d, `${id}/data/BookContent.xml`, '<bc yanlis-duzen/>');
  thumbs.forEach((t, i) => yaz(d, `thumbs/${i + 1}.jpg`, `thumb-${id}-${t}`));
  yaz(d, 'pages/1.png', `sayfa1-${id}-YENI`);
  yaz(d, 'pages/3.png', `sayfa3-${id}-YENI`);
  yaz(d, `htmletk/u1/etk/${MOTOR}`, 'etk-motor-yeni');
  return zipla(d, path.join(tmp('gzipout'), `${id}.zip`));
}

/**
 * Sahte İmpark: gerçek davranışın birebiri (guncelleme_teklifi.py, 25.09 ölçümü).
 * kip: 'normal' | '404' | 'yavas'
 */
async function sahteImpark({ surumler, zipler = {}, kip = 'normal' }) {
  const istekler = [];
  let port = 0;
  const sunucu = http.createServer((req, res) => {
    istekler.push(req.url);
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/TestlerMobil/GetKitapGuncellemeBilgi') {
      if (kip === '404') { res.writeHead(404); res.end('yok'); return; }
      const cevap = () => {
        const id = u.searchParams.get('id');
        const v = Number(u.searchParams.get('versiyon')) || 0;
        const zv = surumler[id];
        const govde = zv != null && v < zv
          ? { Success: true, Data: `http://127.0.0.1:${port}/Uploads/ZKitapZipH/${id}-${zv}.zip`, Vs: zv }
          : { Success: true, Data: '', Vs: v };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(govde));
      };
      if (kip === 'yavas') {
        const t = setTimeout(() => { if (!res.destroyed) cevap(); }, 1500);
        res.on('close', () => clearTimeout(t));
      } else cevap();
      return;
    }
    const m = /^\/Uploads\/ZKitapZipH\/(\d+-\d+)\.zip$/.exec(u.pathname);
    if (m && zipler[m[1]]) {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      fs.createReadStream(zipler[m[1]]).pipe(res);
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  port = sunucu.address().port;
  return {
    port, istekler, kapat: () => { sunucu.closeAllConnections(); sunucu.close(); },
  };
}

/** Zip içindeki izin dışı her dosyanın md5'i (kök + güncel kitap + motorlar). */
function korunanMd5(zip, izinliOnekler) {
  const out = {};
  for (const [ad, g] of M.zipDizini(zip)) {
    if (izinliOnekler.some((o) => ad.startsWith(o) || ad === o)) continue;
    // Dizin girdileri de sayılır: kaynakta olmayan `book1/` girdisinin eklenmesi de kök değişikliği.
    out[ad] = g.dizin ? 'DIZIN' : md5(M.zipGirdiOku(zip, g));
  }
  return out;
}

function menuOku(zip, kitap) {
  const d = M.zipDizini(zip);
  return ig.kapaklar(ig.menuCoz(M.zipGirdiOku(zip, d.get(`${kitap}/classlibraries/ImWin32.dll`))));
}

function ortam() {
  return { calisma: tmp('calisma'), onbellek: tmp('onbellek'), kanitDizini: tmp('kanit') };
}

// ─── Davranış: S1 ───────────────────────────────────────────────────────────────────────────

for (const dizinsiz of [false, true]) {
  test(`S1: geride olan kitap tazelenir, güncel olana ve KÖKE dokunulmaz (dizin girdisi ${dizinsiz ? 'yok' : 'var'})`, async () => {
    const g = guncellemeZipKur(1001);
    const imp = await sahteImpark({ surumler: { 1001: 4, 1002: 5 }, zipler: { '1001-4': g } });
    try {
      const { zip } = setKur({ port: imp.port, dizinsiz });
      const izinli = ['book1/assets/1001/', 'book1/classlibraries/ImWin32.dll'];
      const kokOnce = korunanMd5(zip, izinli);
      const loglar = [];
      const r = await M.icerikMerdiveni({ zip, bookId: '45482', platform: 'pardus', log: (s) => loglar.push(s), ...ortam() });

      // S0 tablosu
      const tablo = Object.fromEntries(r.satirlar.map((s) => [s.kitap, s.durum]));
      assert.deepEqual(tablo, { book1: 'GERIDE', book2: 'GUNCEL', book3: 'ATLANDI' });
      assert.ok(!imp.istekler.some((u) => /[?&]id=0&/.test(u)), 'kimlik 0 İmpark\'a sorulmaz');

      // İçerik tazelendi (üzerine yazma; silme yok)
      const d = M.zipDizini(zip);
      const oku = (ad) => M.zipGirdiOku(zip, d.get(ad)).toString();
      assert.equal(oku('book1/assets/1001/data/BookContent.xml'), '<bc id="1001" v="yeni"/>');
      assert.equal(oku('book1/assets/1001/pages/1.png'), 'sayfa1-1001-YENI');
      assert.equal(oku('book1/assets/1001/pages/3.png'), 'sayfa3-1001-YENI');
      assert.equal(oku('book1/assets/1001/pages/2.png'), 'sayfa2-1001-eski', 'üzerine yazma silmez');
      assert.equal(oku(`book1/assets/1001/htmletk/u1/etk/${MOTOR}`), 'etk-motor-yeni');

      // Menü: yalnız içerik doğrulandıktan sonra ilerledi
      const [c1] = menuOku(zip, 'book1');
      assert.equal(c1.version, 4);
      assert.match(c1.URL, /\/ZKitapZipH\/1001-4\.zip$/);
      assert.equal(menuOku(zip, 'book2')[0].version, 5);

      // KÖK + book2 + ana motorlar birebir
      const kokSonra = korunanMd5(zip, izinli);
      assert.deepEqual(kokSonra, kokOnce);
      assert.equal(kokSonra['index.html'], md5('<html>SET KABUGU menusu</html>'));
      assert.equal(kokSonra[MOTOR], md5('kok-motor-43e23'));
      assert.equal(kokSonra[`book1/${MOTOR}`], md5('book1-ana-motor'));

      // Kanıt dosyası + log
      assert.equal(r.s1.length, 1);
      const kanit = JSON.parse(fs.readFileSync(r.kanit, 'utf8'));
      assert.equal(kanit.sonuc, 'S1 UYGULANDI');
      assert.equal(kanit.satirlar.length, 3);
      assert.ok(loglar.some((s) => /S0 book1 1001 v3 İmpark v4 GERIDE/.test(s)), loglar.join('\n'));
      assert.ok(loglar.some((s) => /S1 book1 1001 v3→v4 UYGULANDI \(kapak \+ \d\/\d iç sayfa eşit/.test(s)));
    } finally { imp.kapat(); }
  });
}

test('S1: tek kitap (kök menü) — içerik assets/<ID>, kök index/motor dokunulmaz', async () => {
  const g = guncellemeZipKur(2001);
  const imp = await sahteImpark({ surumler: { 2001: 9 }, zipler: { '2001-9': g } });
  try {
    const d = tmp('tek');
    const uc = `http://127.0.0.1:${imp.port}/TestlerMobil/GetKitapGuncellemeBilgi?id={bookId}&setMi={isSet}&versiyon={version}`;
    yaz(d, 'index.html', '<html>tek</html>');
    yaz(d, MOTOR, 'tek-motor');
    yaz(d, 'app.config.js', `x={updateBookEndPoint: "${uc}"}`);
    yaz(d, 'classlibraries/ImWin32.dll', menu([{ id: 2001, v: 7 }]));
    kitapIcerigi(d, 2001);
    const zip = zipla(d, path.join(tmp('tekzip'), 'build.zip'));
    const izinli = ['assets/2001/', 'classlibraries/ImWin32.dll'];
    const once = korunanMd5(zip, izinli);
    const r = await M.icerikMerdiveni({ zip, ...ortam() });
    assert.equal(r.s1[0].sonra, 9);
    assert.deepEqual(korunanMd5(zip, izinli), once);
    const dz = M.zipDizini(zip);
    const xml = ig.menuCoz(M.zipGirdiOku(zip, dz.get('classlibraries/ImWin32.dll')));
    assert.equal(ig.kapaklar(xml)[0].version, 9);
  } finally { imp.kapat(); }
});

test('S0+S1: gerçek 127/17 menü (72378 Lingoland) ölçülür, S1 menüyü AYNI biçimde yazar', async () => {
  const g = guncellemeZipKur(72378);
  const imp = await sahteImpark({ surumler: { 72378: 19 }, zipler: { '72378-19': g } });
  try {
    const d = tmp('lingo');
    const uc = `http://127.0.0.1:${imp.port}/TestlerMobil/GetKitapGuncellemeBilgi?id={bookId}&setMi={isSet}&versiyon={version}`;
    yaz(d, 'index.html', '<html>tek</html>');
    yaz(d, MOTOR, 'tek-motor');
    yaz(d, 'app.config.js', `x={updateBookEndPoint: "${uc}"}`);
    const gercekMenu = fs.readFileSync(path.join(__dirname, '..', 'runtime', 'fikstur', 'menu-127-17-72378-tek.dll'));
    yaz(d, 'classlibraries/ImWin32.dll', gercekMenu);
    kitapIcerigi(d, 72378);
    const zip = zipla(d, path.join(tmp('lingozip'), 'build.zip'));
    const r = await M.icerikMerdiveni({ zip, ...ortam() });
    assert.deepEqual(r.satirlar.map((s) => [s.id, s.surum, s.durum]), [['72378', 18, 'GERIDE']]);
    assert.equal(r.s1[0].sonra, 19);
    const dz = M.zipDizini(zip);
    const ham = M.zipGirdiOku(zip, dz.get('classlibraries/ImWin32.dll'));
    assert.deepEqual(ig.menuBicimi(ham), { bas: 127, ara: 16, son: 127 }, 'kaynağın biçimi korunmalı');
    assert.equal(ig.kapaklar(ig.menuCoz(ham))[0].version, 19);
  } finally { imp.kapat(); }
});

test('S1: içerik önbelleği <ID>-<Vs> anahtarlı — ikinci işte yeniden indirilmez', async () => {
  const g = guncellemeZipKur(1001);
  const imp = await sahteImpark({ surumler: { 1001: 4, 1002: 5 } });
  try {
    const o = ortam();
    let indirme = 0;
    const indir = async (url, hedef) => { indirme += 1; fs.copyFileSync(g, hedef); };
    for (let i = 0; i < 2; i++) {
      const { zip } = setKur({ port: imp.port });
      const r = await M.icerikMerdiveni({ zip, indir, ...o, calisma: tmp('c') });
      assert.equal(r.s1.length, 1);
    }
    assert.equal(indirme, 1);
    assert.ok(fs.existsSync(path.join(o.onbellek, '1001', '1001-4.zip')));
  } finally { imp.kapat(); }
});

test("S1: thumbs kimliği tutmazsa iş DÜŞER, zip'e hiç yazılmaz (yanlış kitabı ezme)", async () => {
  const g = guncellemeZipKur(1001, { thumbs: ['BASKA1', 'BASKA2', 'BASKA3', 'BASKA4'] });
  const imp = await sahteImpark({ surumler: { 1001: 4, 1002: 5 }, zipler: { '1001-4': g } });
  try {
    const { zip } = setKur({ port: imp.port });
    const once = md5(fs.readFileSync(zip));
    await assert.rejects(M.icerikMerdiveni({ zip, ...ortam() }),
      /İÇERİK MERDİVENİ KİMLİK TUTMUYOR \(S1\): book1 1001 — kapak thumbs\/1\.jpg md5 farklı/);
    assert.equal(md5(fs.readFileSync(zip)), once, 'iş kopyası değişmemeli');
  } finally { imp.kapat(); }
});

test('S1: kapak eşit, iç sayfaların hiçbiri eşit değil (ortak kapaklı başka kitap) → düşer', async () => {
  const g = guncellemeZipKur(1001, { thumbs: ['T1', 'X2', 'X3', 'X4'] });
  const imp = await sahteImpark({ surumler: { 1001: 4, 1002: 5 }, zipler: { '1001-4': g } });
  try {
    const { zip } = setKur({ port: imp.port });
    await assert.rejects(M.icerikMerdiveni({ zip, ...ortam() }), /ortak kapaklı başka kitap/);
  } finally { imp.kapat(); }
});

test('S1: güncelleme zip düzeni yanlış (kökte data/BookContent.xml yok) → düşer', async () => {
  const g = guncellemeZipKur(1001, { bcYok: true });
  const imp = await sahteImpark({ surumler: { 1001: 4, 1002: 5 }, zipler: { '1001-4': g } });
  try {
    const { zip } = setKur({ port: imp.port });
    const once = md5(fs.readFileSync(zip));
    await assert.rejects(M.icerikMerdiveni({ zip, ...ortam() }),
      /S1 DÜŞTÜ: 1001-4\.zip: kökte data\/BookContent\.xml yok/);
    assert.equal(md5(fs.readFileSync(zip)), once);
  } finally { imp.kapat(); }
});

test('KÖK KORUMA: yazıcı köke/ana motora dokunursa iş düşer, zip değişmez', async () => {
  const g = guncellemeZipKur(1001);
  const imp = await sahteImpark({ surumler: { 1001: 4, 1002: 5 }, zipler: { '1001-4': g } });
  try {
    const { zip } = setKur({ port: imp.port });
    const once = md5(fs.readFileSync(zip));
    // Hatalı yazıcı: içeriği doğru yere açar AMA köke index.html ve book1 ana motoru bırakır
    // (publisher-update'in 73768/59834'te kök index'i ezmesi sınıfı).
    const bozukYazici = async ({ sahne, kok, id, guncellemeZip }) => {
      const hedef = path.join(sahne, kok, 'assets', id);
      fs.mkdirSync(hedef, { recursive: true });
      execFileSync('unzip', ['-o', '-q', guncellemeZip, '-d', hedef]);
      yaz(sahne, 'index.html', '<html>OKUYUCU index — kabuk ezildi</html>');
      yaz(sahne, `${kok}${MOTOR}`, 'eski-motor');
      return hedef;
    };
    await assert.rejects(M.icerikMerdiveni({ zip, icerikYaz: bozukYazici, ...ortam() }),
      /İÇERİK MERDİVENİ KÖK KORUMA \(S1\)/);
    assert.equal(md5(fs.readFileSync(zip)), once, 'kök korumaya takılan iş zip\'e yazmamalı');
  } finally { imp.kapat(); }
});

// ─── Davranış: S0 ÖLÇÜLEMEDİ ────────────────────────────────────────────────────────────────

test('S0: İmpark 404 → ÖLÇÜLEMEDİ, iş eski içerikle DEVAM ETMEZ, hata geçici/ertelenebilir değil', async () => {
  const imp = await sahteImpark({ surumler: { 1001: 4 }, kip: '404' });
  try {
    const { zip } = setKur({ port: imp.port });
    const once = md5(fs.readFileSync(zip));
    const o = ortam();
    let hata = null;
    try { await M.icerikMerdiveni({ zip, ...o }); } catch (e) { hata = e; }
    assert.ok(hata, 'iş düşmeliydi');
    assert.match(hata.message, /^İÇERİK MERDİVENİ ÖLÇÜLEMEDİ \(S0\): book1 1001 v3 OLCULEMEDI \(HTTP 404\)/);
    assert.match(hata.message, /eski içerikle üretilmedi/);
    assert.equal(isTransientNetworkError(hata), false, 'sessiz kira dönüşü olmamalı');
    assert.equal(ertelenebilirKaynakHatasi(hata), false);
    assert.equal(md5(fs.readFileSync(zip)), once);
    const kanit = JSON.parse(fs.readFileSync(fs.readdirSync(o.kanitDizini)
      .map((f) => path.join(o.kanitDizini, f))[0], 'utf8'));
    assert.match(kanit.sonuc, /^OLCULEMEDI/);
  } finally { imp.kapat(); }
});

test('S0: zaman aşımı → ÖLÇÜLEMEDİ, metin geçici ağ desenine uymaz', async () => {
  const imp = await sahteImpark({ surumler: { 1001: 4, 1002: 5 }, kip: 'yavas' });
  try {
    const { zip } = setKur({ port: imp.port });
    let hata = null;
    try { await M.icerikMerdiveni({ zip, zamanAsimiMs: 200, ...ortam() }); } catch (e) { hata = e; }
    assert.ok(hata);
    assert.match(hata.message, /ÖLÇÜLEMEDİ \(S0\): book1 1001 v3 OLCULEMEDI \(zaman aşımı \(0\.2 sn\)\)/);
    assert.equal(isTransientNetworkError(hata), false);
  } finally { imp.kapat(); }
});

test('S0: menü çözülemedi → ÖLÇÜLEMEDİ (sahte GÜNCEL yok)', async () => {
  const d = tmp('cozulmez');
  yaz(d, 'classlibraries/ImWin32.dll', 'bu bir menü değil'.repeat(20));
  yaz(d, 'app.config.js', 'x={updateBookEndPoint: "http://127.0.0.1:9/x?id={bookId}"}');
  const zip = zipla(d, path.join(tmp('cz'), 'build.zip'));
  await assert.rejects(M.icerikMerdiveni({ zip, ...ortam() }),
    /ÖLÇÜLEMEDİ \(S0\): \. \? \? OLCULEMEDI \(menü çözülemedi\)/);
});

test('S0: menü yoksa (İmpark okuyucu kitabı değil) atlanır, zip değişmez', async () => {
  const d = tmp('menusuz');
  yaz(d, 'index.html', '<html/>');
  const zip = zipla(d, path.join(tmp('mz'), 'build.zip'));
  const r = await M.icerikMerdiveni({ zip, ...ortam() });
  assert.deepEqual(r.s1, []);
  assert.deepEqual(r.satirlar, []);
});

// ─── Saf kararlar ───────────────────────────────────────────────────────────────────────────

test('teklifYorumla: canlı cevap biçimleri', () => {
  const k = { id: '44187', surum: 33 };
  const ok = (j) => ({ status: 200, govde: JSON.stringify(j) });
  const data = 'https://akillitahta.ydspublishing.com/Uploads/ZKitapZipH/44187-36.zip';
  assert.deepEqual(M.teklifYorumla(k, ok({ Success: true, Data: data, Vs: 36 })),
    { durum: 'GERIDE', vs: 36, data, not: 'v33 < İmpark v36' });
  assert.equal(M.teklifYorumla(k, ok({ Success: true, Data: '', Vs: 33 })).durum, 'GUNCEL');
  assert.equal(M.teklifYorumla(k, ok({ Success: false })).durum, 'OLCULEMEDI');
  assert.equal(M.teklifYorumla(k, { status: 200, govde: '<html>cf</html>' }).not, 'cevap JSON değil');
  assert.equal(M.teklifYorumla(k, { status: 503, govde: '' }).not, 'HTTP 503');
  assert.equal(M.teklifYorumla(k, { hata: 'zaman aşımı (15 sn)' }).durum, 'OLCULEMEDI');
  assert.match(M.teklifYorumla(k, ok({ Success: true, Data: data.replace('44187-', '44188-'), Vs: 36 })).not,
    /başka kitabın zip'i/);
  assert.match(M.teklifYorumla(k, ok({ Success: true, Data: data, Vs: 35 })).not, /tutmuyor/);
  assert.match(M.teklifYorumla({ id: '44187', surum: 36 }, ok({ Success: true, Data: data, Vs: 36 })).not,
    /≤ paket/);
  assert.match(M.teklifYorumla(k, ok({ Success: true, Data: 'https://x/Uploads/m-44187-36.zip' })).not,
    /beklenen biçimde değil/);
});

test('kimlikKarari: kapak + iç sayfa kuralı', () => {
  const o = (ad, a, i) => ({ ad, arsiv: a, impark: i });
  assert.equal(M.kimlikKarari([o('1.jpg', 'a', 'a'), o('2.jpg', 'b', 'b')]).eslesti, true);
  assert.equal(M.kimlikKarari([o('1.jpg', 'a', 'a')]).eslesti, true);
  assert.equal(M.kimlikKarari([o('1.jpg', 'a', 'x'), o('2.jpg', 'b', 'b')]).eslesti, false);
  assert.equal(M.kimlikKarari([o('1.jpg', 'a', 'a'), o('2.jpg', 'b', 'x'), o('9.jpg', 'c', 'y')]).eslesti, false);
  assert.equal(M.kimlikKarari([o('1.jpg', 'a', 'a'), o('2.jpg', 'b', 'x'), o('9.jpg', 'c', 'c')]).eslesti, true);
  assert.equal(M.kimlikKarari([o('1.jpg', null, 'a')]).eslesti, false);
  assert.equal(M.kimlikKarari([]).eslesti, false);
  assert.deepEqual(M.ornekAdlari([1, 2, 3, 4, 5], [1, 2, 3, 4]), ['1.jpg', '2.jpg', '3.jpg', '4.jpg']);
  assert.deepEqual(M.ornekAdlari([1], [1, 2]), ['1.jpg']);
});

test('yazmaIzinliMi + kokKorumaIhlalleri: yalnız assets/<ID> ve kitabın menüsü', () => {
  const h = [{ kok: 'book1/', id: '1001' }];
  assert.equal(M.yazmaIzinliMi('book1/assets/1001/pages/1.png', h), true);
  assert.equal(M.yazmaIzinliMi('book1/classlibraries/ImWin32.dll', h), true);
  for (const ad of ['index.html', MOTOR, `book1/${MOTOR}`, 'book1/index.html',
    'book1/assets/1002/x', 'book2/assets/1001/x', 'book1/assets/1001/../../index.html',
    'classlibraries/ImWin32.dll', 'book1/assets/10010/x']) {
    assert.equal(M.yazmaIzinliMi(ad, h), false, ad);
  }
  assert.equal(M.yazmaIzinliMi('assets/0/x', [{ kok: '', id: '0' }]), false, 'kimlik 0 hedef olamaz');
  const m = (o) => new Map(Object.entries(o).map(([k, v]) => [k, { crc: v, boyut: 1 }]));
  const once = m({ 'index.html': 1, 'book1/assets/1001/a': 2, 'book2/x': 3 });
  assert.deepEqual(M.kokKorumaIhlalleri(once, m({ 'index.html': 1, 'book1/assets/1001/a': 9, 'book1/assets/1001/b': 1, 'book2/x': 3 }), h), []);
  assert.deepEqual(M.kokKorumaIhlalleri(once, m({ 'index.html': 7, 'book1/assets/1001/a': 2, 'book2/x': 3, 'book1/': 0 }), h),
    ['değişti: index.html', 'eklendi: book1/']);
  assert.deepEqual(M.kokKorumaIhlalleri(once, m({ 'index.html': 1, 'book2/x': 3 }), h),
    ['silindi: book1/assets/1001/a']);
});

test('menuKonumlari: sette kök (kabuk) menüsü işlenmez; tek kitapta kök menü', () => {
  const set = M.menuKonumlari(['classlibraries/ImWin32.dll', 'book10/classlibraries/ImWin32.dll',
    'book2/classlibraries/ImWin32.dll', 'book2/assets/1/data/x/classlibraries/ImWin32.dll']);
  assert.equal(set.set, true);
  assert.deepEqual(set.konumlar.map((k) => k.kok), ['book2/', 'book10/']);
  assert.deepEqual(M.menuKonumlari(['classlibraries/ImWin32.dll', 'index.html']),
    { set: false, konumlar: [{ kitap: '.', kok: '' }] });
  assert.deepEqual(M.menuKonumlari(['index.html']).konumlar, []);
});

test('ucSablonu + teklifUrl: motorun URL\'sinin birebiri (setMi daima 0)', () => {
  const s = M.ucSablonu('updateBookEndPoint: "https://www.sorucoz.tv/TestlerMobil/GetKitapGuncellemeBilgi?id={bookId}&setMi={isSet}&versiyon={version}",');
  assert.equal(M.teklifUrl(s, '44187', 33),
    'https://www.sorucoz.tv/TestlerMobil/GetKitapGuncellemeBilgi?id=44187&setMi=0&versiyon=33');
  assert.equal(M.ucSablonu('x=1'), null);
});

test('anahtar: EMPP_ARSIV_MERDIVEN varsayılan KAPALI, yalnız "1" açar', () => {
  assert.equal(M.merdivenAcik({}), false);
  assert.equal(M.merdivenAcik({ EMPP_ARSIV_MERDIVEN: '0' }), false);
  assert.equal(M.merdivenAcik({ EMPP_ARSIV_MERDIVEN: 'true' }), false);
  assert.equal(M.merdivenAcik({ EMPP_ARSIV_MERDIVEN: '1' }), true);
});

// ─── Runner bağlantısı ──────────────────────────────────────────────────────────────────────

const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
const AYRAC = '// ---------------------------------------------------------------------------\n';
const PROCESS_JOB = SRC.slice(SRC.indexOf('async function processJob'), SRC.indexOf(`${AYRAC}// Main loops`));

test('runner: merdiven kaynak hazır olduktan sonra, paketlemeden ÖNCE; yalnız arşiv kaynağında (manuel M1 atlar)', () => {
  // Dalga B (B4): çağrı casuslanabilir `kaynakAdim.merdiven` (= icerikMerdiveni) üzerinden.
  const merdiven = PROCESS_JOB.indexOf('await kaynakAdim.merdiven({');
  assert.ok(merdiven > 0);
  assert.match(PROCESS_JOB, /if \(kaynak\.merdiven && merdivenAcik\(\)\) \{\n\s+merdivenSonuc = await kaynakAdim\.merdiven\(\{\n\s+zip: zipPath,/);
  for (const once of ['fsp.copyFile(arsiv.zip', 'await manuelBuildHazirla(', 'icerikKapisiDenetleZip(zipPath']) {
    assert.ok(PROCESS_JOB.indexOf(once) > 0 && PROCESS_JOB.indexOf(once) < merdiven, `${once} önce`);
  }
  for (const sonra of ['injectPardusIcon(', 'buildPardusArtifact(', 'packagerUploadBuild(']) {
    assert.ok(PROCESS_JOB.indexOf(sonra) > merdiven, `${sonra} sonra`);
  }
  // Hazır pardus paketi devri exe'siz sözleşmeyle tamamen kapalı (processJob hiç sormaz).
  assert.doesNotMatch(PROCESS_JOB, /hazirPardusPaketi\(|hazirDevir/);
});

async function sahtePaketleyici() {
  const istekler = [];
  const s = http.createServer((req, res) => {
    istekler.push(req.url);
    req.resume();
    req.on('end', () => { res.writeHead(500); res.end('{}'); });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { istekler, url: `http://127.0.0.1:${s.address().port}`, kapat: () => s.close() };
}

async function runnerKostur({ zip, acik }) {
  const { CONFIG, processJob } = require('./runner.js');
  YALITIM.configUygula(CONFIG);
  const kok = tmp('arsiv');
  fs.mkdirSync(path.join(kok, '45482'));
  fs.copyFileSync(zip, path.join(kok, '45482', 'build.zip'));
  const b = fs.readFileSync(zip);
  fs.writeFileSync(path.join(kok, '45482', 'kaynak.json'), JSON.stringify({
    dosya: 'build.zip', md5: md5(b), boyut: b.length, etiket: 'test', impark_kaynagi: 'ShallWe8-v47.exe',
  }));
  const pk = await sahtePaketleyici();
  const env = {
    EMPP_KAYNAK_ARSIVI: kok, EMPP_SOURCE_CACHE: tmp('cache'), EMPP_ARSIV_MERDIVEN: acik ? '1' : '0',
    EMPP_ICERIK_ONBELLEK: tmp('io'), EMPP_MERDIVEN_KANIT: tmp('mk'),
  };
  const eski = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const eskiPk = CONFIG.packagerApi;
  Object.assign(process.env, env);
  CONFIG.packagerApi = pk.url;
  const loglar = [];
  const [ol, ow] = [console.log, console.warn];
  console.log = (...a) => loglar.push(a.join(' '));
  console.warn = (...a) => loglar.push(a.join(' '));
  let hata = null;
  try {
    await processJob({ agentId: 't', token: 'x' }, {
      bookId: '45482', platform: 'android', bookTitle: 'Test Set', publisherName: 'YDS Publishing',
      downloadUrl: 'https://acc.r2.cloudflarestorage.com/akillitahtalar/45482/ShallWe8-v47.exe?X-Amz-Signature=ab',
    });
  } catch (e) { hata = e; } finally {
    console.log = ol; console.warn = ow;
    CONFIG.packagerApi = eskiPk;
    for (const [k, v] of Object.entries(eski)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    pk.kapat();
  }
  return { hata, loglar: loglar.join('\n'), istekler: pk.istekler, arsivZip: path.join(kok, '45482', 'build.zip') };
}

test('runner (gerçek processJob): anahtar açık + İmpark 404 → iş düşer, paketleyiciye HİÇ gidilmez', async () => {
  const imp = await sahteImpark({ surumler: { 1001: 4 }, kip: '404' });
  try {
    const { zip } = setKur({ port: imp.port });
    const r = await runnerKostur({ zip, acik: true });
    assert.match(r.hata && r.hata.message, /^İÇERİK MERDİVENİ ÖLÇÜLEMEDİ \(S0\)/);
    assert.deepEqual(r.istekler, [], 'eski içerikle paket üretilmemeli');
  } finally { imp.kapat(); }
});

test('runner (gerçek processJob): anahtar açık → S1 uygulanır, arşiv zip DEĞİŞMEZ', async () => {
  const g = guncellemeZipKur(1001);
  const imp = await sahteImpark({ surumler: { 1001: 4, 1002: 5 }, zipler: { '1001-4': g } });
  try {
    const { zip } = setKur({ port: imp.port });
    const once = md5(fs.readFileSync(zip));
    const r = await runnerKostur({ zip, acik: true });
    assert.match(r.loglar, /\[merdiven\] S1 book1 1001 v3→v4 UYGULANDI/);
    assert.deepEqual(r.istekler, ['/api/upload-build'], 'tazelenmiş zip paketleyiciye gitmeli');
    assert.equal(md5(fs.readFileSync(r.arsivZip)), once, 'arşiv zip yalnız okunur');
  } finally { imp.kapat(); }
});

test('runner (gerçek processJob): anahtar KAPALI → merdiven koşmaz (bugünkü davranış)', async () => {
  const imp = await sahteImpark({ surumler: { 1001: 4 }, kip: '404' });
  try {
    const { zip } = setKur({ port: imp.port });
    const r = await runnerKostur({ zip, acik: false });
    assert.doesNotMatch(r.loglar, /\[merdiven\]/);
    assert.deepEqual(imp.istekler, []);
    assert.deepEqual(r.istekler, ['/api/upload-build']);
  } finally { imp.kapat(); }
});

test('kimlikKarari: kapak md5 farklı ama BookContent kitapId eşitse eşleşir (59835/73581, 03.10)', () => {
  const o = (ad, a, i) => ({ ad, arsiv: a, impark: i });
  const k = [o('1.jpg', 'a', 'x'), o('2.jpg', 'b', 'y')];
  assert.equal(M.kimlikKarari(k).eslesti, false);
  assert.equal(M.kimlikKarari(k, { arsiv: '06003150', impark: '06003150' }).eslesti, true);
  assert.equal(M.kimlikKarari(k, { arsiv: '06003150', impark: '0603062' }).eslesti, false);
  assert.equal(M.kimlikKarari(k, { arsiv: null, impark: '06003150' }).eslesti, false);
  assert.equal(M.kimlikKarari(k, { arsiv: '1', impark: '1' }).eslesti, false, 'çok kısa kimlik kanıt değil');
  assert.equal(M.kitapIdOku('﻿<?xml version="1.0"?>\n<Book hashed="true" kitapId="06003150" width="1">'), '06003150');
  assert.equal(M.kitapIdOku('<Book width="1">'), null);
});

test('S0 (06.10, 45479 kitap 14835): İmpark "Data boş" ama içerik pakette YOK → GÜNCEL değil, ÖLÇÜLEMEDİ', async () => {
  const imp = await sahteImpark({ surumler: { 1001: 3, 1002: 5 } }); // ikisi de Data boş (güncel cevabı)
  try {
    const tam = await M.s0Olc({ zip: setKur({ port: imp.port }).zip });
    assert.equal(tam.satirlar.find((s) => s.kitap === 'book2').durum, 'GUNCEL', 'içerik varsa Data boş = GÜNCEL');
    const eksik = await M.s0Olc({ zip: setKur({ port: imp.port, book2Icerik: false }).zip });
    const b2 = eksik.satirlar.find((s) => s.kitap === 'book2');
    assert.equal(b2.durum, 'OLCULEMEDI');
    assert.match(b2.not, /Data boş ama içerik pakette yok \(assets\/1002\/data\/BookContent\.xml\)/);
    assert.equal(eksik.satirlar.find((s) => s.kitap === 'book1').durum, 'GUNCEL', 'içeriği olan kardeşe dokunmaz');
  } finally { imp.kapat(); }
});

test('S0: icerikVar verilmezse (kurulu uygulama ağacı) denetim yapılmaz — eski davranış', async () => {
  const imp = await sahteImpark({ surumler: { 1001: 3, 1002: 5 } });
  try {
    const { zip } = setKur({ port: imp.port, book2Icerik: false });
    const d = M.zipDizini(zip);
    const r = await M.s0Kaynaktan({ adlar: d.keys(), oku: (rel) => M.zipGirdiOku(zip, d.get(rel)) });
    assert.equal(r.satirlar.find((s) => s.kitap === 'book2').durum, 'GUNCEL');
  } finally { imp.kapat(); }
});
