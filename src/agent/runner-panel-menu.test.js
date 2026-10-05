'use strict';

/**
 * Runner × panel menü hizalama (05.10) — gerçek `processJob`, sahte sunucu, uçtan uca:
 *   K1   : anahtarsız kök menülü sete panel ANAHTARLI yeni üye ekler → hizalama imKeys'ten ÖNCE
 *          koşar, imKeys yeni üyeyi görür → `assets/<id>/imKeys.dll` yazılır, set aktivasyonu açılır.
 *   r2-kur: R2'ye yazılan build ve paketleyiciye giden zip HİZALI menüyü taşır.
 *   Ö3   : panel ölçülemedi → iş ERTELENİR (kilit + kira bırakılır, failed/result yok).
 *   Ö2   : manuel build'de adım hiç çalışmaz (panele sorulmaz) + log satırı.
 * Panel, İmpark teklifi, ZKitapZipH, HasZKitapKey ve keypanel sahte — canlıya istek yok.
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
const panelMenu = require('./panel-menu-hizala');
const ig = require('../runtime/icerik-guncelleme');
const { CONFIG, processJob, kaynakAdim } = runner;

YALITIM.configUygula(CONFIG);
after(() => YALITIM.temizle());

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `rpm-${ad}-`));
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const KODLAR = ['AB3CD', 'PQ9RS'];
const MENU = '<?xml version="1.0"?><main activation="false" key="" label="İmpark Eğitim" ID="45480">'
  + '<Group ID="45480" label="Eski"><Tab ID="1" label="Books"><cover guId="" ID="111" etkID="111" '
  + 'ustBar="assets/111/skins/ustBar.swf" source="assets/111/thumbs/1.jpg" actName="Kitap Bir" '
  + 'URL="https://icerik.ornek.net/Uploads/ZKitapZipH/111-7.zip" version="7" '
  + 'xmlSource="assets/111/data/BookContent.xml" activation="false" tabID="1"></cover></Tab></Group>'
  + '</main>';
const panelGovde = (idler) => JSON.stringify({
  KitapId: 45480, KitapAdi: 'Set', status: true,
  Books: idler.map((id) => ({
    Id: id, Adi: `Kitap ${id}`, DersId: 0, Resim: null, Domain: 'https://icerik.ornek.net',
    GroupId: 683, GroupName: 'Grup', TabId: 9001, TabName: 'Kitaplar', FixName: String(id),
  })),
});
const PANEL = panelGovde([111, 222]);

/** Kök menülü build: verilen kapaklar (her biri içerikli) tek Group/Tab altında. */
function kokBuild({ idler, grup = '45480', glabel = 'Eski', tab = '1', tlabel = 'Books' }) {
  const kapak = (id) => `<cover guId="" ID="${id}" etkID="${id}" actName="Kitap ${id}" `
    + `URL="https://icerik.ornek.net/Uploads/ZKitapZipH/${id}-7.zip" version="7" `
    + `xmlSource="assets/${id}/data/BookContent.xml" activation="false" tabID="${tab}"></cover>`;
  const xml = '<?xml version="1.0"?><main activation="false" key="" label="İmpark Eğitim" ID="45480">'
    + `<Group ID="${grup}" label="${glabel}"><Tab ID="${tab}" label="${tlabel}">`
    + `${idler.map(kapak).join('')}</Tab></Group></main>`;
  const z = new AdmZip();
  z.addFile('index.html', Buffer.from('<html>set</html>'));
  z.addFile('electron.js', Buffer.from('require("electron");'));
  z.addFile('app.config.js', Buffer.from('const AppConfig = { updateBookEndPoint: "https://www.sorucoz.tv/'
    + 'TestlerMobil/GetKitapGuncellemeBilgi?id={bookId}&setMi={isSet}&versiyon={version}" };\n'));
  z.addFile('classlibraries/ImWin32.dll', Buffer.from(ig.menuKodla(xml), 'utf8'));
  for (const id of idler) {
    z.addFile(`assets/${id}/data/BookContent.xml`, Buffer.from(`<Book kitapId="${id}"/>`));
    z.addFile(`assets/${id}/pages/1.png`, Buffer.from(`sayfa-${id}`));
    z.addFile(`assets/${id}/thumbs/1.jpg`, Buffer.from(`kapak-${id}`));
  }
  return z.toBuffer();
}

function buildZip() {
  const z = new AdmZip();
  z.addFile('index.html', Buffer.from('<html>set</html>'));
  z.addFile('electron.js', Buffer.from('require("electron");'));
  z.addFile('app.config.js', Buffer.from('const AppConfig = { updateBookEndPoint: "https://www.sorucoz.tv/'
    + 'TestlerMobil/GetKitapGuncellemeBilgi?id={bookId}&setMi={isSet}&versiyon={version}" };\n'));
  z.addFile('classlibraries/ImWin32.dll', Buffer.from(ig.menuKodla(MENU), 'utf8'));
  z.addFile('assets/111/data/BookContent.xml', Buffer.from('<Book kitapId="111"/>'));
  z.addFile('assets/111/pages/1.png', Buffer.from('sayfa'));
  z.addFile('assets/111/thumbs/1.jpg', Buffer.from('kapak'));
  return z.toBuffer();
}

function uyeArsivi() {
  const z = new AdmZip();
  z.addFile('data/BookContent.xml', Buffer.from('<Book kitapId="222"/>'));
  z.addFile('pages/1.png', Buffer.from('sayfa-222'));
  z.addFile('thumbs/1.jpg', Buffer.from('kapak-222'));
  const yol = path.join(tmp('uye'), '222-3.zip');
  z.writeZip(yol);
  return yol;
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
      const json = (kod, veri) => {
        res.writeHead(kod, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(veri));
      };
      if (yol.startsWith('/agents/test/')) {
        const ad = yol.slice('/agents/test/'.length);
        (kayit.govdeler[ad] = kayit.govdeler[ad] || []).push(JSON.parse(govde.toString() || '{}'));
        if (ad === 'kaynak/presign-multipart') {
          const adr = `http://127.0.0.1:${s.address().port}/r2put`;
          const n = kayit.govdeler[ad].at(-1).partCount;
          return json(200, {
            uploadId: 'UP-1', r2ObjectKey: 'kaynak/45480/2.50.1/build.zip', contentType: 'application/zip',
            urls: Array.from({ length: n }, (_, i) => ({ partNumber: i + 1, url: `${adr}/${i + 1}?X=x` })),
          });
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
      res.writeHead(404);
      return res.end();
    });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  return {
    url, kayit,
    kapat: () => new Promise((r) => { if (s.closeAllConnections) s.closeAllConnections(); s.close(r); }),
  };
}

/** Panel adımı bağımlılıkları: panel listesi + İmpark teklifi + ZKitapZipH (hepsi sahte). */
function panelBag({ panel = { status: 200, govde: PANEL } } = {}) {
  const casus = { panel: [], teklif: [], indir: [] };
  const arsiv = uyeArsivi();
  return {
    casus,
    bag: () => ({
      panelGetir: async (u) => { casus.panel.push(u); return panel; },
      getir: async (u) => {
        casus.teklif.push(u);
        const data = 'https://icerik.ornek.net/Uploads/ZKitapZipH/222-3.zip';
        return { status: 200, govde: JSON.stringify({ Success: true, Data: data, Vs: 3 }) };
      },
      indir: async (u, hedef) => { casus.indir.push(u); fs.copyFileSync(arsiv, hedef); },
      resimIndir: async () => { throw new Error('görsel yok'); },
      onbellek: tmp('onbellek'),
      kanitDizini: tmp('kanit'),
      bekle: async () => {},
    }),
  };
}

async function isKostur({
  job, arsivKoku = tmp('bos'), dosyalar = {}, anahtarli = [], pb = panelBag(), env = {}, uretec = null,
}) {
  const sunucu = await sahteSunucu({ dosyalar });
  const orjAdim = { ...kaynakAdim };
  const orjBag = imKeys.varsayilanBagimliliklar;
  const orjPanel = panelMenu.varsayilanBagimliliklar;
  kaynakAdim.merdiven = async () => ({ satirlar: [], s1: [] });
  kaynakAdim.setEki = async () => ({ eklenen: [] });
  if (uretec) kaynakAdim.uretec = uretec;
  imKeys.varsayilanBagimliliklar = () => ({
    anahtarliMi: async (id) => anahtarli.includes(String(id)),
    kodCek: async () => KODLAR,
  });
  panelMenu.varsayilanBagimliliklar = pb.bag;
  const ENV = {
    EMPP_KAYNAK_ARSIVI: arsivKoku, EMPP_ARSIV_MERDIVEN: '1', EMPP_SET_UYELIK_EK: '1', EMPP_BILDIRIM: '0',
    EMPP_MERDIVEN_KANIT: tmp('mk'), AGENT_DOWNLOAD_RATE: '', AGENT_DOWNLOAD_MAX_ATTEMPTS: '2',
    AGENT_UPLOAD_RATE: '', EMPP_KAYNAK_UC_DENEME: '2', EMPP_KAYNAK_UC_BEKLE_MS: '0',
    EMPP_KAYNAK_YOK_DURUM: path.join(tmp('durum'), 'kaynak-yok-bildirim.json'),
    // Üreteç kapalı: taban kapsama (liste üyesi build'de yok → üreteç) bu testin konusu değil.
    EMPP_INDEX_URETECI: '0',
    ...env,
  };
  const eskiEnv = {};
  for (const k of Object.keys(ENV)) { eskiEnv[k] = process.env[k]; process.env[k] = ENV[k]; }
  const eski = {
    apiBase: CONFIG.apiBase, packagerApi: CONFIG.packagerApi, kaynakKur: CONFIG.kaynakKur,
    kaynakKurSerbestFlag: CONFIG.kaynakKurSerbestFlag, kaynakYokDurumDosyasi: CONFIG.kaynakYokDurumDosyasi,
  };
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
      { bookTitle: 'Set', publisherName: 'YDS Publishing', downloadUrl: '', ...job(sunucu.url) });
  } catch (e) {
    hata = e;
  } finally {
    Object.assign(console, orj);
    Object.assign(kaynakAdim, orjAdim);
    imKeys.varsayilanBagimliliklar = orjBag;
    panelMenu.varsayilanBagimliliklar = orjPanel;
    Object.assign(CONFIG, eski);
    for (const [k, v] of Object.entries(eskiEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await sunucu.kapat();
  }
  return { hata, donus, loglar: loglar.join('\n'), kayit: sunucu.kayit, casus: pb.casus };
}

function yuklenenZip(govde) {
  assert.ok(govde, 'paketleyiciye build gitmeli');
  const bas = govde.indexOf(Buffer.from('PK\u0003\u0004', 'latin1'));
  const son = govde.lastIndexOf(Buffer.from('PK\u0005\u0006', 'latin1'));
  return new AdmZip(govde.subarray(bas, son + 22));
}

function hizaliMi(zip) {
  const xml = ig.menuCoz(zip.getEntry('classlibraries/ImWin32.dll').getData());
  assert.equal(panelMenu.hSimule(xml, 683, 9001, 111), '7', 'eski üye panel Group/Tab altında v7');
  assert.equal(panelMenu.hSimule(xml, 683, 9001, 222), '3', 'yeni üye v3');
  assert.ok(zip.getEntry('assets/222/data/BookContent.xml'), 'yeni üyenin içeriği zip\'te');
  return xml;
}

const imKeysOku = (zip, yol) => {
  const g = zip.getEntry(yol);
  return g ? imKeys.imKeysCoz(g.getData()) : null;
};

test('K1 arşiv: anahtarsız sete panel ANAHTARLI üye ekler → imKeys yeni üyeye yazılır, set aktivasyonu açılır', async () => {
  const r = await isKostur({
    arsivKoku: arsivKur('45480', buildZip()), anahtarli: ['222'],
    job: () => ({ bookId: '45480', platform: 'android' }),
  });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  const zip = yuklenenZip(r.kayit.uploadGovde);
  const xml = hizaliMi(zip);
  assert.deepEqual(imKeysOku(zip, 'assets/222/imKeys.dll'), KODLAR, 'yeni anahtarlı üye imKeys taşır');
  assert.match(xml.match(/<main\b[^>]*>/)[0], /activation="true"/);
  assert.match(r.loglar, /\[panel-menu\] UYGULANDI/);
  // Sıra: hizalama imKeys'ten önce loglanır.
  assert.ok(r.loglar.indexOf('[panel-menu] UYGULANDI') < r.loglar.indexOf('[imkeys] 45480'), r.loglar);
});

const r2Kur = () => ({
  bookId: '45480', platform: 'android', kaynakTuru: 'r2-kur', kaynakSurumu: '2.50.1',
  // Yazma kapısı (B5) liste dışı kitabı R2'ye yazdırmaz: panel üyesi claim setListesi'nde olmalı.
  kurulumBitis: '2099-01-01T00:00:00.000Z', setListesi: '111 | Kitap Bir\n222 | Kitap 222',
});

test('r2-kur: R2\'ye yazılan build ve paketleyiciye giden zip HİZALI menü + yeni üye taşır', async () => {
  const r = await isKostur({ arsivKoku: arsivKur('45480', buildZip()), job: r2Kur });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  hizaliMi(new AdmZip(Buffer.concat(r.kayit.parcalar)));
  hizaliMi(yuklenenZip(r.kayit.uploadGovde));
  assert.equal(r.casus.panel.length, 1);
  assert.match(r.casus.panel[0], /^https:\/\/icerik\.ornek\.net\/MobilService\/GetPackageBooks\?id=45480$/);
});

test('r2-kur: claim listesi BAYAT (eski üye 999), panel yeni üye 222 → kapı GEÇER, liste panelden, fark loglanır', async () => {
  const r = await isKostur({
    arsivKoku: arsivKur('45480', kokBuild({ idler: ['111', '999'] })),
    job: () => ({ ...r2Kur(), setListesi: '111 | Kitap Bir\n999 | Eski Kitap' }),
  });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  const r2Zip = new AdmZip(Buffer.concat(r.kayit.parcalar));
  hizaliMi(r2Zip);
  assert.ok(r2Zip.getEntry('assets/999/data/BookContent.xml'), 'çıkarılan üyenin içeriği silinmez');
  assert.match(r.loglar, /kapı set listesi PANELDEN \(2 üye\); claim fazla \[999\], panel yeni \[222\]/);
  // Menüden çıkan 999 içerik üyesi sayılmaz (paketin menüsünde yok).
  assert.match(r.loglar, /\[uyeler\] 2 kitap/);
});

test('r2-kur: claim listesi YOK + panel 3 üye + menü zaten hizalı → kapı panel listesiyle GEÇER', async () => {
  const pb = panelBag({ panel: { status: 200, govde: panelGovde([111, 222, 333]) } });
  const zip = kokBuild({ idler: ['111', '222', '333'], grup: '683', glabel: 'Grup', tab: '9001',
    tlabel: 'Kitaplar' });
  const r = await isKostur({ arsivKoku: arsivKur('45480', zip), pb,
    job: () => { const j = r2Kur(); delete j.setListesi; return j; } });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.equal(r.casus.teklif.length, 0, 'eksik üye yok');
  assert.match(r.loglar, /kapı set listesi PANELDEN \(3 üye\); claim listesi YOK/);
  assert.ok(r.kayit.parcalar.length > 0, 'R2\'ye yazıldı');
});

test('r2-kur: panel meşru BOŞ → claim listesi aynen (eski davranış): liste dışı kitap hâlâ RED', async () => {
  const pb = panelBag({ panel: { status: 200, govde: '{"Books":null,"statusMessage":"Kitap bulunamadı"}' } });
  const r = await isKostur({
    arsivKoku: arsivKur('45480', kokBuild({ idler: ['111', '333'] })), pb,
    job: () => ({ ...r2Kur(), setListesi: '111 | Kitap Bir' }),
  });
  assert.match(r.hata.message, /yazma kapısı RED .*liste-disi-kitap: kök#2\(333\) kimliği 333 listede yok/);
  assert.equal(r.kayit.parcalar.length, 0);
  assert.equal(r.kayit.uploadGovde, null);
  assert.doesNotMatch(r.loglar, /PANELDEN/);
});

test('r2-kur: panel ucu YOK (404) → iş sürer, menüye dokunulmaz, claim listesi aynen', async () => {
  const pb = panelBag({ panel: { status: 404, govde: 'Not Found' } });
  const r = await isKostur({ arsivKoku: arsivKur('45480', kokBuild({ idler: ['111', '333'] })), pb,
    job: () => ({ ...r2Kur(), setListesi: '111 | Kitap Bir\n333 | Kitap Üç' }) });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.equal(r.casus.panel.length, 1, '4xx yeniden denenmez');
  assert.match(r.loglar, /\[panel-menu\] panel ucu yok .*HTTP 404\) — menü olduğu gibi/);
  const xml = ig.menuCoz(yuklenenZip(r.kayit.uploadGovde).getEntry('classlibraries/ImWin32.dll').getData());
  assert.match(xml, /<Group ID="45480" label="Eski">/);
});

test('r2-kur: panel ölçülemedi → ERTELENDİ (kilit + kira bırakılır, R2/paketleyici/result yok)', async () => {
  const pb = panelBag({ panel: { status: 503, govde: 'bakım' } });
  const r = await isKostur({ arsivKoku: arsivKur('45480', buildZip()), job: r2Kur, pb });
  assert.equal(r.hata, null, r.hata && r.hata.stack);
  assert.equal(r.donus.ertelendi, true);
  assert.match(r.donus.sebep, /PANEL MENÜ HİZALAMA: panel listesi ölçülemedi/);
  assert.equal(r.casus.panel.length, 3, '3 deneme');
  assert.equal(r.kayit.govdeler['kaynak/birak'].length, 1, 'kurma kilidi bırakıldı');
  assert.equal(r.kayit.govdeler.release.length, 1, 'kira bırakıldı');
  assert.equal(r.kayit.parcalar.length, 0);
  assert.equal(r.kayit.uploadGovde, null);
  assert.equal(r.kayit.govdeler.result, undefined, 'failed yazılmaz');
});

test('manuel build: panel menü hizalama ÇALIŞMAZ (sözleşme M1) — panele sorulmaz, log satırı', async () => {
  const zip = buildZip();
  const r = await isKostur({
    dosyalar: { '/sources/45480/build.zip': zip },
    job: (u) => ({ bookId: '45480', platform: 'android', kaynakTuru: 'manuel',
      downloadUrl: `${u}/sources/45480/build.zip` }),
  });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.equal(r.casus.panel.length, 0);
  assert.match(r.loglar, /\[panel-menu\] manuel build — panel menü hizalama ATLANDI/);
  const xml = ig.menuCoz(yuklenenZip(r.kayit.uploadGovde).getEntry('classlibraries/ImWin32.dll').getData());
  assert.match(xml, /<Group ID="45480" label="Eski">/, 'menü olduğu gibi');
});

/** Sahte üreteç: verilen kimliklerle kök menülü build kurar (kapı listesi = claim listesi). */
function sahteUretec(idler, casus) {
  return async (a) => {
    casus.uretec += 1;
    fs.writeFileSync(a.zipPath, kokBuild({ idler }));
    return {
      rapor: {
        kapiListesi: idler.map((id) => `${id} | Kitap ${id}`).join('\n'), duzen: 'kok', aktivasyon: false,
        motor: { kalip: '/k/kalip/motor', dizin: 'm', kurum: '60' }, kabuk: null,
        kitaplar: idler, linkKarti: [], atlanan: [],
      },
      liste: { kaynak: 'test' },
    };
  };
}

/** Önceki hizalı R2 build'i: menüde yalnız 111, 999'un içeriği kökte duruyor (panel çıkarmış). */
function hizaliTaban() {
  const z = new AdmZip(kokBuild({ idler: ['111'] }));
  z.addFile('assets/999/data/BookContent.xml', Buffer.from('<Book kitapId="999"/>'));
  z.addFile('assets/999/pages/1.png', Buffer.from('sayfa-999'));
  z.addFile('assets/999/thumbs/1.jpg', Buffer.from('kapak-999'));
  return z.toBuffer();
}

test('taban kapsama istisnası: panel hizalı dönmezse (404) GERİ ALINIR → üreteç yolu, kapı claim listesiyle geçer', async () => {
  const casus = { uretec: 0 };
  const r = await isKostur({
    arsivKoku: arsivKur('45480', hizaliTaban()), env: { EMPP_INDEX_URETECI: '1' },
    uretec: sahteUretec(['111', '999'], casus), pb: panelBag({ panel: { status: 404, govde: 'yok' } }),
    job: () => ({ ...r2Kur(), setListesi: '111 | Kitap Bir\n999 | Eski' }),
  });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.equal(casus.uretec, 1, 'üreteç bir kez koştu');
  assert.match(r.loglar, /taban kapsama: 999 menüde yok ama içeriği tabanda duruyor/);
  assert.match(r.loglar, /taban kapsama istisnası GERİ ALINDI: panel hizalı dönmedi — 999 gerçekten eksik/);
  const xml = ig.menuCoz(new AdmZip(Buffer.concat(r.kayit.parcalar))
    .getEntry('classlibraries/ImWin32.dll').getData());
  assert.match(xml, /ID="999"/, 'R2 build üreteçle kuruldu, 999 menüde');
});

test('taban kapsama istisnası: panel hizalı dönerse KORUNUR — üreteç koşmaz', async () => {
  const casus = { uretec: 0 };
  const r = await isKostur({
    arsivKoku: arsivKur('45480', hizaliTaban()), env: { EMPP_INDEX_URETECI: '1' },
    uretec: sahteUretec(['111', '999'], casus),
    job: () => ({ ...r2Kur(), setListesi: '111 | Kitap Bir\n999 | Eski' }),
  });
  assert.match(r.hata.message, /packager upload-build failed/, r.hata.stack);
  assert.equal(casus.uretec, 0);
  assert.doesNotMatch(r.loglar, /GERİ ALINDI/);
  assert.match(r.loglar, /kapı set listesi PANELDEN \(2 üye\); claim fazla \[999\], panel yeni \[222\]/);
});

test('setListesiPanelFarki: yerel hazır kaydına girer (jobOzeti), /result gövdesine girmez', () => {
  const H = require('./windows-hazir');
  const fark = { claimVar: true, listeFazla: ['61633'], panelYeni: ['73010'], listeKaynagi: 'panel' };
  assert.deepEqual(H.jobOzeti({ bookId: '1', setListesiPanelFarki: fark }).setListesiPanelFarki, fark);
  assert.equal('setListesiPanelFarki' in H.jobOzeti({ bookId: '1' }), false);
  const kaynak = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  const govde = kaynak.slice(kaynak.indexOf('async function postResultSuccess'),
    kaynak.indexOf('async function postResultFailure'));
  assert.ok(govde.length > 100);
  assert.doesNotMatch(govde, /setListesiPanelFarki/);
});
