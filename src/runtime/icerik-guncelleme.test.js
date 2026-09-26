'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const m = require('./icerik-guncelleme.js');
const { makeResolver, createShim } = require('../platforms/common/fs-shim.js');

// Gerçek menü (ProBook, shall-we-5 book2, 2026-09-24 çözüldü) — kısaltılmış.
function menu(v, { id = '57806', url, key = '', ek = '' } = {}) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + `<main activation="false" key="${key}" label="İmpark Eğitim" bookUpdate="true" lisans="">\n`
    + '  <Group ID="0" label="">\n    <Tab ID="0" label="">\n'
    + `      <cover guId="" ID="${id}" source="assets/${id}/cover.png" URL="${url || `/Uploads/ZKitapZip/${id}-${v}.zip`}" version="${v}" activation="false" xmlSource="assets/${id}/data/BookContent.xml"/>\n`
    + ek
    + '    </Tab>\n  </Group>\n</main>';
}
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `icerik-${ad}-`));
const sessiz = () => {};

test('menü kodla/çöz: motorun biçimi, çok baytlı "İmpark" kaymadan döner', () => {
  const x = menu(4);
  const k = m.menuKodla(x);
  assert.notStrictEqual(k, x);
  assert.strictEqual(k.length, 27 + x.length * 5 + 27);
  assert.strictEqual(m.menuCoz(k), x);
  assert.strictEqual(m.menuCoz(Buffer.from(k, 'utf8')), x, 'diskten Buffer olarak okunan da çözülür');
  assert.strictEqual(m.menuCoz(x), x, 'açık metin aynen');
  assert.strictEqual(m.menuCoz('çöp'), null);
});

test('kapaklar/kapakAyarla: yalnız hedef kapağın version+URL alanı değişir', () => {
  const x = menu(2, { ek: '      <cover ID="99" version="7" URL="/u/99-7.zip"/>\n' });
  assert.deepStrictEqual(m.kapaklar(x).map((c) => [c.ID, c.version]), [['57806', 2], ['99', 7]]);
  const y = m.kapakAyarla(x, '57806', { version: 4, URL: 'https://h/ZKitapZipH/57806-4.zip' });
  const k = m.kapaklar(y);
  assert.strictEqual(k[0].version, 4);
  assert.strictEqual(k[0].URL, 'https://h/ZKitapZipH/57806-4.zip');
  assert.strictEqual(k[1].version, 7);
});

test('uzlaşma kuralı (kapakKarari) — tablo', () => {
  const t = (vw, vb, ac, isaret) => m.kapakKarari(vw, vb, ac, isaret);
  assert.deepStrictEqual(t(2, 4, null, false), { surum: 4, taraf: 'paket', icerikKenara: false }, 'WORK geride → paket');
  assert.deepStrictEqual(t(4, 4, null, false), { surum: 4, taraf: 'paket', icerikKenara: false }, 'eşit');
  assert.deepStrictEqual(t(4, 2, 4, true), { surum: 4, taraf: 'work', icerikKenara: false }, 'ileri + açılmış → WORK');
  assert.deepStrictEqual(t(4, 2, null, false), { surum: 2, taraf: 'paket-sahte-ilerletme', icerikKenara: false }, 'ileri + içerik yok → sahte, paket');
  assert.deepStrictEqual(t(7, 5, 6, true), { surum: 6, taraf: 'work', icerikKenara: false }, 'menü açılandan ileride → açılana indir');
  assert.deepStrictEqual(t(4, 6, 4, true), { surum: 6, taraf: 'paket', icerikKenara: true }, 'paket daha yeni → eski açılmış içerik kenara');
  assert.deepStrictEqual(t(3, 3, null, true), { surum: 3, taraf: 'paket', icerikKenara: true }, 'yarım oturum içeriği (sürümsüz) kenara');
});

test('menuUzlastir: kapak kümesi farklıysa iskelet paketten, etkinleştirme anahtarı WORK\'ten', () => {
  const w = menu(4, { key: 'ANAHTAR-123', ek: '      <cover ID="11" version="1"/>\n' });
  const b = menu(2);
  const r = m.menuUzlastir(w, b, () => null);
  assert.ok(r.degisti);
  assert.strictEqual(r.ayniKume, false);
  assert.match(r.xml, /key="ANAHTAR-123"/);
  assert.deepStrictEqual(m.kapaklar(r.xml).map((c) => [c.ID, c.version]), [['57806', 2]]);
});

test('menuUzlastir: değişiklik yoksa degisti=false (dosyaya yazılmaz)', () => {
  const x = menu(4);
  const r = m.menuUzlastir(x, menu(4), () => null);
  assert.strictEqual(r.degisti, false);
});

function kitapKur({ vb, vw, isaretSurum, icerik = true }) {
  const base = tmp('base'); const work = tmp('work');
  fs.mkdirSync(path.join(base, 'book2', 'classlibraries'), { recursive: true });
  fs.writeFileSync(path.join(base, 'book2', 'classlibraries', 'ImWin32.dll'), m.menuKodla(menu(vb)));
  fs.writeFileSync(path.join(base, 'index.html'), '<html>');
  if (vw != null) {
    fs.mkdirSync(path.join(work, 'book2', 'classlibraries'), { recursive: true });
    fs.writeFileSync(path.join(work, 'book2', 'classlibraries', 'ImWin32.dll'), m.menuKodla(menu(vw)));
  }
  const a = path.join(work, 'book2', 'assets', '57806');
  fs.mkdirSync(a, { recursive: true });
  fs.writeFileSync(path.join(a, 'flexibleItems.json'), '[]');
  if (icerik) {
    fs.mkdirSync(path.join(a, 'data'), { recursive: true });
    fs.mkdirSync(path.join(a, 'htmletk', 'u1'), { recursive: true });
    fs.writeFileSync(path.join(a, 'data', 'BookContent.xml'), '<book v="x"/>');
    fs.writeFileSync(path.join(a, 'htmletk', 'u1', 'index.html'), 'etk');
  }
  if (isaretSurum !== undefined) {
    fs.writeFileSync(path.join(a, m.ISARET_ADI), JSON.stringify({
      id: '57806', bookContentMd5: md5(Buffer.from('<book v="x"/>')), dizinler: ['data', 'htmletk'], surum: isaretSurum,
    }));
  }
  return { base, work, a, wMenu: path.join(work, 'book2', 'classlibraries', 'ImWin32.dll') };
}
const surumOku = (p) => m.kapaklar(m.menuCoz(fs.readFileSync(p)))[0].version;

test('uzlastir (disk): SAHA DURUMU — WORK v4 sahte ilerlemiş, paket v2, içerik hiç açılmamış → v2; eski menü yedekte, silme yok', () => {
  const k = kitapKur({ vb: 2, vw: 4, icerik: false });
  fs.writeFileSync(path.join(k.a, 'update.zip'), 'yetim');
  const r = m.uzlastir({ baseKok: k.base, workKok: k.work, log: sessiz, simdi: new Date('2026-09-24T12:00:00Z'), pid: 1 });
  assert.strictEqual(surumOku(k.wMenu), 2);
  assert.strictEqual(r[0].kararlar[0].taraf, 'paket-sahte-ilerletme');
  const yedek = path.join(k.work, m.ESKI_DIZIN, '20260924-120000-000-1', 'book2', 'classlibraries', 'ImWin32.dll');
  assert.strictEqual(surumOku(yedek), 4, 'eski WORK menüsü taşındı, silinmedi');
  assert.ok(fs.existsSync(path.join(k.a, 'update.zip')), 'yetim zip\'e dokunulmaz');
});

test('uzlastir (disk): WORK v4 + doğrulanmış açılmış içerik (işaret v4), paket v2 → WORK kalır, dosyaya yazılmaz', () => {
  const k = kitapKur({ vb: 2, vw: 4, isaretSurum: 4 });
  const once = fs.readFileSync(k.wMenu, 'utf8');
  m.uzlastir({ baseKok: k.base, workKok: k.work, log: sessiz });
  assert.strictEqual(fs.readFileSync(k.wMenu, 'utf8'), once, 'bayt bayt aynı');
  assert.ok(!fs.existsSync(path.join(k.work, m.ESKI_DIZIN)));
});

test('uzlastir (disk): işaretin md5\'i BookContent ile uyuşmuyorsa işaret geçersiz → paket kazanır', () => {
  const k = kitapKur({ vb: 2, vw: 4, isaretSurum: 4 });
  fs.writeFileSync(path.join(k.a, 'data', 'BookContent.xml'), '<bozuk/>');
  m.uzlastir({ baseKok: k.base, workKok: k.work, log: sessiz });
  assert.strictEqual(surumOku(k.wMenu), 2);
});

test('uzlastir (disk): yeni paket (v6) eski açılmış içerikten (v4) ileride → paket kazanır, WORK içeriği kenara taşınır', () => {
  const k = kitapKur({ vb: 6, vw: 4, isaretSurum: 4 });
  m.uzlastir({ baseKok: k.base, workKok: k.work, log: sessiz, simdi: new Date('2026-09-24T12:00:00Z'), pid: 1 });
  assert.strictEqual(surumOku(k.wMenu), 6);
  assert.ok(!fs.existsSync(path.join(k.a, 'data')), 'BASE\'i gölgelemesin');
  assert.ok(!fs.existsSync(path.join(k.a, 'htmletk')));
  assert.ok(fs.existsSync(path.join(k.a, 'flexibleItems.json')), 'kullanıcı verisi yerinde');
  const eski = path.join(k.work, m.ESKI_DIZIN, '20260924-120000-000-1', 'book2', 'assets', '57806');
  assert.ok(fs.existsSync(path.join(eski, 'htmletk', 'u1', 'index.html')), 'taşındı, silinmedi');
});

test('uzlastir: WORK menüsü yoksa hiçbir şey yazılmaz', () => {
  const k = kitapKur({ vb: 2, vw: null, icerik: false });
  const r = m.uzlastir({ baseKok: k.base, workKok: k.work, log: sessiz });
  assert.deepStrictEqual(r, []);
  assert.ok(!fs.existsSync(k.wMenu));
});

test('dosyaEsle: yalnız assets/ altı ve WORK\'te VARSA; BASE dışı ve dizin null', () => {
  const k = kitapKur({ vb: 2, vw: 4, isaretSurum: 4 });
  const iste = (r) => m.dosyaEsle(fs, path, k.base, k.work, path.join(k.base, r));
  assert.strictEqual(iste('book2/assets/57806/htmletk/u1/index.html'), path.join(k.a, 'htmletk', 'u1', 'index.html'));
  assert.strictEqual(iste('book2/assets/57806/pages/1.png'), null, 'WORK\'te yok → BASE');
  assert.strictEqual(iste('book2/classlibraries/ImWin32.dll'), null, 'assets dışı kapsam dışı');
  assert.strictEqual(iste('book2/assets/57806/htmletk'), null, 'dizin');
  assert.strictEqual(m.dosyaEsle(fs, path, k.base, k.work, '/etc/passwd'), null);
});

test('protokolKur: intercept varsa onu kullanır, WORK kopyası BASE\'in önünde; yoksa yol aynen', () => {
  const k = kitapKur({ vb: 2, vw: 4, isaretSurum: 4 });
  let h;
  const protocol = { interceptFileProtocol: (s, fn) => { assert.strictEqual(s, 'file'); h = fn; } };
  const r = m.protokolKur({ protocol, baseKok: k.base, workKok: k.work, log: sessiz });
  assert.strictEqual(r.yontem, 'intercept');
  const url = require('node:url');
  const cagir = (rel) => { let out; h({ url: url.pathToFileURL(path.join(k.base, rel)).toString() + '?v=1' }, (o) => { out = o; }); return out.path; };
  assert.strictEqual(cagir('book2/assets/57806/htmletk/u1/index.html'), path.join(k.a, 'htmletk', 'u1', 'index.html'));
  assert.strictEqual(cagir('book2/index.html'), path.join(k.base, 'book2', 'index.html'));
  assert.strictEqual(r.sayac.work, 1);
});

test('protokolKur: intercept yoksa protocol.handle + net.fetch(bypass) — Range başlığı taşınır', async () => {
  const k = kitapKur({ vb: 2, vw: 4, isaretSurum: 4 });
  let h; const cagrilar = [];
  const protocol = { handle: (s, fn) => { h = fn; } };
  const net = { fetch: async (u, o) => { cagrilar.push([u, o]); return 'yanit'; } };
  const r = m.protokolKur({ protocol, net, baseKok: k.base, workKok: k.work, log: sessiz });
  assert.strictEqual(r.yontem, 'handle');
  const url = require('node:url');
  const headers = { Range: 'bytes=0-10' };
  await h({ url: url.pathToFileURL(path.join(k.base, 'book2/assets/57806/htmletk/u1/index.html')).toString(), method: 'GET', headers });
  assert.strictEqual(cagrilar[0][0], url.pathToFileURL(path.join(k.a, 'htmletk', 'u1', 'index.html')).toString());
  assert.strictEqual(cagrilar[0][1].bypassCustomProtocolHandlers, true);
  assert.strictEqual(cagrilar[0][1].headers, headers);
});

// ─── Renderer: motorun GERÇEK akışının kopyası ───────────────────────────────
// main 42c86ce0 @415772 extractZipFiles: new (require("adm-zip"))(zip).extractAllTo(path.parse(zip).dir,!0);
// fs.unlinkSync(zip) — try/catch, hata console.log ile YUTULUR.
// reducer @363767 + E() @383624: END'de cover.version=newVersion → writeFile(getFilePath("/classlibraries/ImWin32.dll")).
function rendererOrtam({ admZipVar = true, SahteZip, tavanMb } = {}) {
  const BASE = path.join(tmp('asar'), 'app.asar', 'book2');
  const WORK = path.join(tmp('userdata'), 'work', 'book2');
  fs.mkdirSync(path.join(BASE, 'classlibraries'), { recursive: true });
  fs.writeFileSync(path.join(BASE, 'classlibraries', 'ImWin32.dll'), m.menuKodla(menu(2)));
  const shim = createShim(fs, path, WORK, BASE);
  const onceki = (ad) => {
    if (ad === 'fs') return shim;
    if (ad === 'adm-zip') {
      if (!admZipVar) { const e = new Error("Cannot find module 'adm-zip'"); e.code = 'MODULE_NOT_FOUND'; throw e; }
      return SahteZip || AdmZip;
    }
    return require(ad);
  };
  const win = { require: onceki };
  m.rendererKur(win, { R: makeResolver(path, fs, WORK, BASE), realFs: fs, pathMod: path, WORK, realRequire: require, tavanMb });
  return { win, BASE, WORK };
}
function zipYap(dosya) {
  const z = new AdmZip();
  z.addFile('data/BookContent.xml', Buffer.from('<book v="4"/>'));
  z.addFile('htmletk/u1/index.html', Buffer.from('<div id="isaret">v4</div>'));
  z.addFile('pages/1.png', Buffer.from('PNG4'));
  z.writeZip(dosya);
}
async function motorAkisi({ win, BASE }, zipFn = zipYap, yeniSurum = 4) {
  const f = win.require('fs');
  const zip = path.join(BASE, 'assets', '57806', 'update.zip');
  // indirme: createWriteStream (shim → WORK)
  const ws = f.createWriteStream(zip);
  const kaynak = path.join(tmp('sunucu'), '57806-4.zip');
  zipFn(kaynak);
  await new Promise((ok) => { ws.on('finish', ok); ws.end(fs.readFileSync(kaynak)); });
  const loglar = [];
  try {
    const r = win.require('adm-zip');
    const a = new r(zip);
    await a.extractAllTo(path.parse(zip).dir, true);
    f.unlinkSync(zip);
  } catch (e) { loglar.push(String(e && e.message)); }
  // END: reducer sürümü ilerletir, E() menüyü yazar — açma başarısız olsa BİLE.
  const eski = m.menuCoz(f.readFileSync(path.join(BASE, 'classlibraries', 'ImWin32.dll')));
  const yeni = m.kapakAyarla(eski, '57806', { version: yeniSurum, URL: `https://h/Uploads/ZKitapZipH/57806-${yeniSurum}.zip` });
  await new Promise((ok) => f.writeFile(path.join(BASE, 'classlibraries', 'ImWin32.dll'), m.menuKodla(yeni), {}, ok));
  return loglar;
}

test('renderer: adm-zip VAR → açma WORK\'e gider (asar\'a değil), doğrulanır, menü v2→v4 yazılır, işarete sürüm düşer', async () => {
  const o = rendererOrtam();
  const loglar = await motorAkisi(o);
  assert.deepStrictEqual(loglar, []);
  const a = path.join(o.WORK, 'assets', '57806');
  assert.strictEqual(fs.readFileSync(path.join(a, 'htmletk', 'u1', 'index.html'), 'utf8'), '<div id="isaret">v4</div>');
  assert.ok(!fs.existsSync(path.join(o.BASE, 'assets', '57806', 'data')), 'BASE (asar) içine yazılmadı');
  assert.ok(!fs.existsSync(path.join(a, 'update.zip')), 'motor zip\'i sildi (kendi unlink\'i)');
  assert.strictEqual(surumOku(path.join(o.WORK, 'classlibraries', 'ImWin32.dll')), 4);
  const isaret = JSON.parse(fs.readFileSync(path.join(a, m.ISARET_ADI), 'utf8'));
  assert.strictEqual(isaret.surum, 4);
  assert.strictEqual(isaret.bookContentMd5, md5(Buffer.from('<book v="4"/>')));
});

test('MUTASYON — adm-zip YOK (bugünkü saha): motor hatayı yutar, menü yine de v4 yazmaya çalışır → v2 KALIR', async () => {
  const o = rendererOrtam({ admZipVar: false });
  const loglar = await motorAkisi(o);
  assert.match(loglar[0], /Cannot find module 'adm-zip'/);
  assert.strictEqual(surumOku(path.join(o.WORK, 'classlibraries', 'ImWin32.dll')), 2, 'sahte ilerletme engellendi');
  const log = fs.readFileSync(path.join(o.WORK, m.LOG_ADI), 'utf8');
  assert.match(log, /SAHTE İLERLETME ENGELLENDİ: 57806 v2→v4/);
});

test('MUTASYON — açma hatası (girdiler yazılmıyor): doğrulama patlar, menü v2 KALIR, işaret yok', async () => {
  // adm-zip bir fabrika: `new` düz nesne döner — alt sınıf değil, sarmalayıcı.
  function Bos(p) { const z = new AdmZip(p); z.extractAllTo = () => {}; return z; }
  const o = rendererOrtam({ SahteZip: Bos });
  const loglar = await motorAkisi(o);
  assert.match(loglar[0], /açma doğrulanamadı/);
  assert.strictEqual(surumOku(path.join(o.WORK, 'classlibraries', 'ImWin32.dll')), 2);
  assert.ok(!fs.existsSync(path.join(o.WORK, 'assets', '57806', m.ISARET_ADI)));
});

test('MUTASYON — BookContent bozuk yazılırsa (md5 uyuşmaz) menü v2 KALIR', async () => {
  function Bozuk(p) {
    const z = new AdmZip(p); const asil = z.extractAllTo;
    z.extractAllTo = (h, ...r) => { asil.call(z, h, ...r); fs.writeFileSync(path.join(h, 'data', 'BookContent.xml'), 'x'); };
    return z;
  }
  const o = rendererOrtam({ SahteZip: Bozuk });
  const loglar = await motorAkisi(o);
  assert.match(loglar[0], /açma doğrulanamadı/);
  assert.strictEqual(surumOku(path.join(o.WORK, 'classlibraries', 'ImWin32.dll')), 2);
});

test('menuSuz: sürüm artmayan yazma (ör. etkinleştirme anahtarı) AYNEN geçer — bayt bayt', () => {
  const ctx = { dogrulanan: {}, log: sessiz };
  const eski = m.menuKodla(menu(2));
  const yeni = m.menuKodla(menu(2, { key: 'K-1' }));
  assert.strictEqual(m.menuSuz(yeni, eski, ctx), yeni);
});

test('rendererKur idempotent; diğer modüller aynen geçer', () => {
  const o = rendererOrtam();
  const ilk = o.win.__emppIcerik;
  assert.strictEqual(m.rendererKur(o.win, {}), ilk);
  assert.strictEqual(o.win.require('path'), require('path'));
  assert.strictEqual(o.win.require('adm-zip'), o.win.require('adm-zip'), 'sarılı sınıf önbellekli');
});

test('anaSurecKur: kapıda (EMPP_ICERIK_GUNCELLEME=0) hiçbir şey kurulmaz', () => {
  const app = { getPath: () => '/yok', isReady: () => true, once() {} };
  assert.strictEqual(m.anaSurecKur({ electron: { app }, kok: '/x', platform: 'linux', env: { EMPP_ICERIK_GUNCELLEME: '0' } }).durum, 'kapali');
  assert.strictEqual(m.anaSurecKur({ electron: { app }, kok: '/x', platform: 'win32', env: { EMPP_ICERIK_GUNCELLEME: '0' } }).durum, 'kapali');
});

test('anaSurecKur: WINDOWS kapsamda (sözleşme G1) — WORK userData altında, örtü kurulur', () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-win-kok-'));
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'icerik-win-ud-'));
  let kayit = null;
  const protocol = { interceptFileProtocol: (ad, fn) => { kayit = ad; } };
  const app = { getPath: (k) => (k === 'userData' ? ud : '/yok'), isReady: () => true, once() {} };
  const env = {};
  const r = m.anaSurecKur({ electron: { app, protocol }, kok, platform: 'win32', env });
  assert.strictEqual(r.durum, 'kuruldu');
  assert.strictEqual(r.workKok, path.join(ud, 'work'));
  assert.strictEqual(env.EMPP_WORK_DIR, path.join(ud, 'work'), 'renderer aynı WORK\'ü görmeli');
  assert.strictEqual(kayit, 'file', 'file: örtüsü kurulmadı');
  const kaynak = fs.readFileSync(require.resolve('./icerik-guncelleme.js'), 'utf8');
  assert.ok(!kaynak.includes('windows-kapsam-disi'), 'Windows kapsam dışı dönüşü geri gelmiş');
});

test('anaSurecKur: uzlaşma pencereden ÖNCE; örtü yayıncının ÖNCEDEN kaydettiği ready dinleyicisinden de önce kurulur', () => {
  const k = kitapKur({ vb: 2, vw: 4, icerik: false });
  const { EventEmitter } = require('node:events');
  const app = new EventEmitter();
  app.getPath = () => '/yok'; app.isReady = () => false;
  const sira = [];
  app.on('ready', () => sira.push('yayinci-createWindow')); // yayıncı bizden ÖNCE kaydetti
  const protocol = { interceptFileProtocol: () => sira.push('ortu') };
  const env = { EMPP_WORK_DIR: k.work };
  const r = m.anaSurecKur({ electron: { app, protocol }, kok: k.base, platform: 'linux', env });
  assert.strictEqual(r.durum, 'kuruldu');
  assert.strictEqual(surumOku(k.wMenu), 2);
  app.emit('ready');
  assert.deepStrictEqual(sira, ['ortu', 'yayinci-createWindow']);
});

test('anaSurecKur: EMPP_WORK_DIR yoksa userData/work atanır (renderer aynı WORK\'ü miras alır)', () => {
  const ud = tmp('ud');
  const app = { getPath: () => ud, isReady: () => true };
  const env = {};
  m.anaSurecKur({ electron: { app, protocol: { interceptFileProtocol() {} } }, kok: tmp('kok'), platform: 'linux', env });
  assert.strictEqual(env.EMPP_WORK_DIR, path.join(ud, 'work'));
});

// ─── Review düzeltmeleri (2026-09-24) — her biri mutasyonla kanıtlandı (RAPOR.md) ─────────

const ortuDosyasi = (o, rel) => m.dosyaEsle(fs, path, path.dirname(o.BASE), path.dirname(o.WORK),
  path.join(o.BASE, 'assets', '57806', rel));

test('R1 — YARIM AÇMA (ENOSPC ortasında): hedefte hiçbir içerik kalmaz, örtü BASE\'e düşer, geçici .empp-eski\'ye', async () => {
  function Yarim(p) {
    const z = new AdmZip(p);
    z.extractAllTo = (h) => {
      fs.mkdirSync(path.join(h, 'htmletk', 'u1'), { recursive: true });
      fs.writeFileSync(path.join(h, 'htmletk', 'u1', 'index.html'), 'YARIM');
      const e = new Error('ENOSPC: no space left on device'); e.code = 'ENOSPC'; throw e;
    };
    return z;
  }
  const o = rendererOrtam({ SahteZip: Yarim });
  const loglar = await motorAkisi(o);
  assert.match(loglar[0], /ENOSPC/);
  const a = path.join(o.WORK, 'assets', '57806');
  assert.ok(!fs.existsSync(path.join(a, 'htmletk')), 'yarım içerik hedefte YOK');
  assert.strictEqual(ortuDosyasi(o, 'htmletk/u1/index.html'), null, 'örtü WORK\'ten servis etmez');
  assert.strictEqual(o.win.__emppIcerik.R.toRead(path.join(o.BASE, 'assets', '57806', 'htmletk', 'u1', 'index.html')),
    path.join(o.BASE, 'assets', '57806', 'htmletk', 'u1', 'index.html'), 'fs-shim okuması da BASE');
  assert.strictEqual(surumOku(path.join(o.WORK, 'classlibraries', 'ImWin32.dll')), 2);
  const eski = fs.readdirSync(path.join(o.WORK, m.ESKI_DIZIN));
  assert.ok(eski.some((d) => d.startsWith('gecici-57806-')), 'geçici dizin silinmedi, kenara alındı');
  assert.deepStrictEqual(fs.readdirSync(path.join(o.WORK, m.GECICI_DIZIN)), [], 'geçici alan boş');
  assert.ok(JSON.parse(fs.readFileSync(path.join(a, m.BASARISIZ_ADI), 'utf8')).sebep.includes('ENOSPC'));
});

test('R1 — md5 uyuşmazlığında da hedefe hiçbir dosya taşınmaz', async () => {
  function Bozuk(p) {
    const z = new AdmZip(p); const asil = z.extractAllTo;
    z.extractAllTo = (h, ...r) => { asil.call(z, h, ...r); fs.writeFileSync(path.join(h, 'data', 'BookContent.xml'), 'x'); };
    return z;
  }
  const o = rendererOrtam({ SahteZip: Bozuk });
  await motorAkisi(o);
  const a = path.join(o.WORK, 'assets', '57806');
  for (const d of ['data', 'htmletk', 'pages']) assert.ok(!fs.existsSync(path.join(a, d)), d + ' hedefte olmamalı');
});

test('R1 — önceki doğrulanmış açma üstüne başarısız açma: önceki içerik AYNEN kalır', async () => {
  const o = rendererOrtam();
  await motorAkisi(o);
  const a = path.join(o.WORK, 'assets', '57806');
  const once = fs.readFileSync(path.join(a, 'htmletk', 'u1', 'index.html'), 'utf8');
  const yeniZip = (d) => { const z = new AdmZip(); z.addFile('data/BookContent.xml', Buffer.from('<b v5/>')); z.addFile('htmletk/u1/index.html', Buffer.from('v5')); z.writeZip(d); };
  const kaynak = path.join(tmp('s'), 'z.zip'); yeniZip(kaynak);
  // ikinci açma: BookContent yazılıyor ama htmletk girdisi eksik
  const o2Gercek = function (p) { const g = new AdmZip(p); g.extractAllTo = (h) => { fs.mkdirSync(path.join(h, 'data'), { recursive: true }); fs.writeFileSync(path.join(h, 'data', 'BookContent.xml'), '<b v5/>'); }; return g; };
  const S2 = m.admZipSar(o2Gercek, o.win.__emppIcerik);
  assert.throws(() => new S2(kaynak).extractAllTo(path.join(o.BASE, 'assets', '57806'), true), /açma eksik/);
  assert.strictEqual(fs.readFileSync(path.join(a, 'htmletk', 'u1', 'index.html'), 'utf8'), once);
  assert.strictEqual(fs.readFileSync(path.join(a, 'data', 'BookContent.xml'), 'utf8'), '<book v="4"/>');
});

test('R12 — BookContent doğru ama bir girdi eksik → açma eksik, menü v2 KALIR', async () => {
  function Eksik(p) {
    const z = new AdmZip(p); const asil = z.extractAllTo;
    z.extractAllTo = (h, ...r) => { asil.call(z, h, ...r); fs.renameSync(path.join(h, 'pages', '1.png'), path.join(h, 'x.tmp')); };
    return z;
  }
  const o = rendererOrtam({ SahteZip: Eksik });
  const loglar = await motorAkisi(o);
  assert.match(loglar[0], /açma eksik \(1, ilk: pages\/1\.png\)/);
  assert.strictEqual(surumOku(path.join(o.WORK, 'classlibraries', 'ImWin32.dll')), 2);
});

test('R10 — eksik kontrolü sanitize edilmiş adla: "./" ve "\\\\" içeren girdi sahte eksik üretmez', () => {
  assert.strictEqual(m.girdiGoreli(path, './data//BookContent.xml'), 'data/BookContent.xml');
  assert.strictEqual(m.girdiGoreli(path, 'htmletk\\u1\\a.js'), 'htmletk/u1/a.js');
  assert.strictEqual(m.girdiGoreli(path, 'pages/'), 'pages');
  assert.strictEqual(m.girdiGoreli(path, '../../etc/x'), 'etc/x', 'adm-zip gibi köke sabitlenir');
});

test('R10 — boyut tavanı: açılmış toplam tavanı aşarsa hiçbir şey açılmaz (yapısal hata)', async () => {
  const buyuk = (d) => { const z = new AdmZip(); z.addFile('data/BookContent.xml', Buffer.from('<b/>')); z.addFile('pages/1.png', Buffer.alloc(2 * 1024 * 1024)); z.writeZip(d); };
  const o = rendererOrtam({ tavanMb: 1 });
  const loglar = await motorAkisi(o, buyuk);
  assert.match(loglar[0], /tavanı aşıyor/);
  assert.ok(!fs.existsSync(path.join(o.WORK, 'assets', '57806', 'pages')));
  const b = JSON.parse(fs.readFileSync(path.join(o.WORK, 'assets', '57806', m.BASARISIZ_ADI), 'utf8'));
  assert.strictEqual(b.yapisal, true);
});

test('R9 — BookContent kökte değil: 1. deneme sürüm GERİ, 2. deneme VAZGEÇ (sonsuz indirme yok); uzlaşma vazgeçileni korur', async () => {
  const icice = (d) => { const z = new AdmZip(); z.addFile('57806/data/BookContent.xml', Buffer.from('<b/>')); z.writeZip(d); };
  const o = rendererOrtam();
  const l1 = await motorAkisi(o, icice);
  assert.match(l1[0], /kökünde data\/BookContent.xml yok/);
  const menuYol = path.join(o.WORK, 'classlibraries', 'ImWin32.dll');
  assert.strictEqual(surumOku(menuYol), 2, '1. deneme: geri çevrildi');
  const l2 = await motorAkisi(o, icice);
  assert.match(l2[0], /kökünde/);
  assert.strictEqual(surumOku(menuYol), 4, '2. deneme: vazgeçildi, ilerletildi');
  assert.match(fs.readFileSync(path.join(o.WORK, m.LOG_ADI), 'utf8'), /VAZGEÇİLDİ: 57806 v2→v4 içerik AÇILMADI/);
  // Sonraki açılışta uzlaşma bunu "sahte ilerletme" sayıp geri çevirmemeli (yoksa döngü sürer).
  const r = m.uzlastir({ baseKok: path.dirname(o.BASE), workKok: path.dirname(o.WORK), log: sessiz });
  assert.strictEqual(r[0].kararlar[0].taraf, 'work-vazgecildi');
  assert.strictEqual(surumOku(menuYol), 4);
});

test('R9 — geçici (yapısal olmayan) hata sayılmaz: md5 hatası 3 kez de olsa vazgeçilmez', async () => {
  function Bozuk(p) {
    const z = new AdmZip(p); const asil = z.extractAllTo;
    z.extractAllTo = (h, ...r) => { asil.call(z, h, ...r); fs.writeFileSync(path.join(h, 'data', 'BookContent.xml'), 'x'); };
    return z;
  }
  const o = rendererOrtam({ SahteZip: Bozuk });
  for (let i = 0; i < 3; i++) await motorAkisi(o);
  assert.strictEqual(surumOku(path.join(o.WORK, 'classlibraries', 'ImWin32.dll')), 2);
});

test('R5 — menü süzgeci fail-open DEĞİL sessiz: çözülemeyen menü loglanır', () => {
  const satirlar = [];
  const ctx = { dogrulanan: {}, log: (s) => satirlar.push(s) };
  const cop = 'x'.repeat(100);
  assert.strictEqual(m.menuSuz(cop, m.menuKodla(menu(2)), ctx), cop);
  assert.strictEqual(m.menuSuz(m.menuKodla(menu(4)), cop, ctx) != null, true);
  assert.strictEqual(satirlar.filter((s) => /UYARI menü süzgeci/.test(s)).length, 2);
});

test('R5 — renameSync/copyFileSync ile menüye yazma da süzülür; createWriteStream loglanır', () => {
  const o = rendererOrtam();
  const f = o.win.require('fs');
  const menuYol = path.join(o.BASE, 'classlibraries', 'ImWin32.dll');
  const gecici = path.join(o.BASE, 'classlibraries', 'yeni.tmp');
  f.writeFileSync(gecici, m.menuKodla(menu(4)));
  f.renameSync(gecici, menuYol);
  assert.strictEqual(surumOku(path.join(o.WORK, 'classlibraries', 'ImWin32.dll')), 2, 'rename yolu');
  f.writeFileSync(gecici, m.menuKodla(menu(5)));
  f.copyFileSync(gecici, menuYol);
  assert.strictEqual(surumOku(path.join(o.WORK, 'classlibraries', 'ImWin32.dll')), 2, 'copy yolu');
  f.createWriteStream(menuYol).end();
  assert.match(fs.readFileSync(path.join(o.WORK, m.LOG_ADI), 'utf8'), /süzülemeyen yol ile yazılıyor: createWriteStream/);
});

test('R6 — kapak kümesi farklı: eşleşen kapağın version/URL DIŞINDAKİ tüm alanları WORK\'ten (aktive menü)', () => {
  const w = menu(4, { key: 'ANAHTAR-9', ek: '      <cover ID="11" version="1"/>\n' })
    .replace('guId=""', 'guId="GUID-ABC"').replace(/activation="false" xmlSource/, 'activation="true" kullaniciAktif="false" xmlSource');
  const b = menu(2);
  const r = m.menuUzlastir(w, b, () => null);
  const kap = m.kapaklar(r.xml);
  assert.strictEqual(kap.length, 1);
  assert.match(kap[0].etiket, /guId="GUID-ABC"/);
  assert.match(kap[0].etiket, /activation="true"/);
  assert.match(kap[0].etiket, /kullaniciAktif="false"/);
  assert.strictEqual(kap[0].version, 2, 'sürüm kararı paketten (sahte ilerletme)');
  assert.match(kap[0].etiket, /URL="\/Uploads\/ZKitapZip\/57806-2.zip"/);
  assert.match(r.xml, /key="ANAHTAR-9"/);
  assert.match(kap[0].etiket, /\/>$/);
});

test('R7 — kilit: canlı başka örnek kilitliyse uzlaşma ATLANIR; bayat kilit devralınır', () => {
  const k = kitapKur({ vb: 2, vw: 4, icerik: false });
  const kilitYol = path.join(k.work, m.KILIT_ADI);
  fs.writeFileSync(kilitYol, JSON.stringify({ pid: process.ppid, zaman: Date.now() }));
  const r = m.uzlastir({ baseKok: k.base, workKok: k.work, log: sessiz });
  assert.deepStrictEqual(r, [{ sebep: 'kilitli' }]);
  assert.strictEqual(surumOku(k.wMenu), 4, 'dokunulmadı');
  fs.writeFileSync(kilitYol, JSON.stringify({ pid: 999999, zaman: Date.now() })); // ölü pid
  m.uzlastir({ baseKok: k.base, workKok: k.work, log: sessiz });
  assert.strictEqual(surumOku(k.wMenu), 2);
  assert.ok(!fs.existsSync(kilitYol), 'kilit bırakıldı');
  assert.ok(fs.readdirSync(k.work).some((a) => a.startsWith(m.KILIT_ADI + '.bayat-')), 'bayat kilit silinmedi, adlandırıldı');
});

test('R7 — damga ms+pid taşır: aynı saniyede iki süreç farklı .empp-eski dizini kullanır', () => {
  const t = new Date('2026-09-24T12:00:00.123Z');
  assert.notStrictEqual(m.zamanDamgasi(t, 10), m.zamanDamgasi(t, 11));
  assert.strictEqual(m.zamanDamgasi(t, 10), '20260924-120000-123-10');
});

test('R11 — kenara taşıma kullanıcı verisi DOSYALARINA dokunmaz (işaret dizinler listesinde dosya olsa bile)', () => {
  const k = kitapKur({ vb: 6, vw: 4, isaretSurum: 4 });
  const isYol = path.join(k.a, m.ISARET_ADI);
  const j = JSON.parse(fs.readFileSync(isYol, 'utf8')); j.dizinler = ['data', 'htmletk', 'flexibleItems.json']; fs.writeFileSync(isYol, JSON.stringify(j));
  m.uzlastir({ baseKok: k.base, workKok: k.work, log: sessiz });
  assert.ok(fs.existsSync(path.join(k.a, 'flexibleItems.json')));
  assert.ok(!fs.existsSync(path.join(k.a, 'htmletk')));
});

test('R11 — işaretin dizinler listesine kök DOSYALAR girmez', async () => {
  const kokDosyali = (d) => { const z = new AdmZip(); z.addFile('data/BookContent.xml', Buffer.from('<b/>')); z.addFile('flexibleItems.json', Buffer.from('[]')); z.writeZip(d); };
  const o = rendererOrtam();
  await motorAkisi(o, kokDosyali);
  const j = JSON.parse(fs.readFileSync(path.join(o.WORK, 'assets', '57806', m.ISARET_ADI), 'utf8'));
  assert.deepStrictEqual(j.dizinler, ['data']);
});

// ─── İkinci review (REVIEW2-FAZ2.md) ─────────────────────────────────────────────────────

test('Y-A — işaret GEÇERSİZ (md5 tutmuyor) ama içerik WORK\'te: içerik kenara alınır, örtü BASE\'e düşer', () => {
  const k = kitapKur({ vb: 2, vw: 4, isaretSurum: 4 });
  fs.writeFileSync(path.join(k.a, 'data', 'BookContent.xml'), '<bozuk/>');
  const r = m.uzlastir({ baseKok: k.base, workKok: k.work, log: sessiz });
  assert.strictEqual(surumOku(k.wMenu), 2);
  assert.deepStrictEqual(r[0].kenarayaAl, ['57806']);
  assert.ok(!fs.existsSync(path.join(k.a, 'data', 'BookContent.xml')), 'bozuk içerik hedefte kalmadı');
  assert.ok(!fs.existsSync(path.join(k.a, 'htmletk')));
  assert.strictEqual(m.dosyaEsle(fs, path, k.base, k.work, path.join(k.base, 'book2', 'assets', '57806', 'data', 'BookContent.xml')), null);
  assert.ok(fs.existsSync(path.join(k.a, 'flexibleItems.json')), 'kullanıcı verisi yerinde');
});

test('Y-A — işaret HİÇ yok (birleştirme ortasında çökme) ama BookContent WORK\'te: kenara alınır', () => {
  const k = kitapKur({ vb: 2, vw: 2, icerik: true }); // işaret yazılmadan çökmüş
  m.uzlastir({ baseKok: k.base, workKok: k.work, log: sessiz });
  assert.ok(!fs.existsSync(path.join(k.a, 'data')));
  assert.ok(!fs.existsSync(path.join(k.a, 'htmletk')));
});

test('Y2 — birleştirme yarıda kalırsa taşınan dizinler hedefte kalmaz, .empp-eski/yarim-<id>-*\'ye alınır', async () => {
  const o = rendererOrtam();
  const a = path.join(o.WORK, 'assets', '57806');
  // hedefte pages/1.png adında DOLU bir dizin: dosyanın üstüne rename EISDIR/ENOTEMPTY ile patlar
  fs.mkdirSync(path.join(a, 'pages', '1.png'), { recursive: true });
  fs.writeFileSync(path.join(a, 'pages', '1.png', 'engel'), 'x');
  const loglar = await motorAkisi(o);
  assert.ok(loglar.length === 1, 'açma başarısız');
  assert.ok(!fs.existsSync(path.join(a, 'data')), 'önce taşınan data geri alındı');
  assert.ok(!fs.existsSync(path.join(a, 'htmletk')), 'önce taşınan htmletk geri alındı');
  const yarim = fs.readdirSync(path.join(o.WORK, m.ESKI_DIZIN)).filter((d) => d.startsWith('yarim-57806-'));
  assert.strictEqual(yarim.length, 1);
  assert.ok(fs.existsSync(path.join(o.WORK, m.ESKI_DIZIN, yarim[0], 'htmletk', 'u1', 'index.html')));
  assert.match(fs.readFileSync(path.join(o.WORK, m.LOG_ADI), 'utf8'), /BİRLEŞTİRME YARIM KALDI/);
  assert.strictEqual(surumOku(path.join(o.WORK, 'classlibraries', 'ImWin32.dll')), 2);
});

test('Y3 — kilit: sahibi CANLI ama 10 dakikadan eskiyse devralınır', () => {
  const k = kitapKur({ vb: 2, vw: 4, icerik: false });
  const kilitYol = path.join(k.work, m.KILIT_ADI);
  fs.writeFileSync(kilitYol, JSON.stringify({ pid: process.ppid, zaman: Date.now() - 11 * 60 * 1000 }));
  const r = m.uzlastir({ baseKok: k.base, workKok: k.work, log: sessiz });
  assert.notDeepStrictEqual(r, [{ sebep: 'kilitli' }]);
  assert.strictEqual(surumOku(k.wMenu), 2);
  // eşik altı (9 dk) canlı kilit korunur
  fs.writeFileSync(kilitYol, JSON.stringify({ pid: process.ppid, zaman: Date.now() - 9 * 60 * 1000 }));
  assert.deepStrictEqual(m.uzlastir({ baseKok: k.base, workKok: k.work, log: sessiz }), [{ sebep: 'kilitli' }]);
});

const iciceZip = (d) => { const z = new AdmZip(); z.addFile('57806/data/BookContent.xml', Buffer.from('<b/>')); z.writeZip(d); };

test('Y6 — yapısal sayaç yalnız AYNI sebepte artar: iki farklı yapısal hata vazgeçirmez', async () => {
  const o = rendererOrtam({ tavanMb: 1 });
  const buyuk = (d) => { const z = new AdmZip(); z.addFile('data/BookContent.xml', Buffer.from('<b/>')); z.addFile('pages/1.png', Buffer.alloc(2 * 1024 * 1024)); z.writeZip(d); };
  await motorAkisi(o, iciceZip); // sebep A (düzen)
  await motorAkisi(o, buyuk);    // sebep B (tavan)
  const b = JSON.parse(fs.readFileSync(path.join(o.WORK, 'assets', '57806', m.BASARISIZ_ADI), 'utf8'));
  assert.strictEqual(b.sayi, 1);
  assert.strictEqual(surumOku(path.join(o.WORK, 'classlibraries', 'ImWin32.dll')), 2, 'vazgeçilmedi');
});

test('Y14 — başarılı açma .empp-basarisiz.json\'u hedeften kaldırır; sonraki yapısal hata sayacı 1\'den başlar', async () => {
  const o = rendererOrtam();
  const a = path.join(o.WORK, 'assets', '57806');
  await motorAkisi(o, iciceZip, 4); // 1. yapısal hata
  assert.ok(fs.existsSync(path.join(a, m.BASARISIZ_ADI)));
  await motorAkisi(o, zipYap, 4);   // başarılı
  assert.ok(!fs.existsSync(path.join(a, m.BASARISIZ_ADI)), 'başarısızlık kaydı temizlendi');
  await motorAkisi(o, iciceZip, 5); // yeni yapısal hata → sayı 1, vazgeçme YOK
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(a, m.BASARISIZ_ADI), 'utf8')).sayi, 1);
  assert.strictEqual(surumOku(path.join(o.WORK, 'classlibraries', 'ImWin32.dll')), 4, 'v5\'e sahte ilerleme yok');
});

test('Y-B — saklama: kitap başına en fazla 2 başarısız kenar; doğrulanmış içerik kenarı ASLA silinmez', async () => {
  const o = rendererOrtam();
  const eski = path.join(o.WORK, m.ESKI_DIZIN);
  // uzlaşmanın doğrulanmış içerik kenarı (silinmemeli)
  fs.mkdirSync(path.join(eski, '20260101-000000-000-1', 'assets', '57806', 'htmletk'), { recursive: true });
  fs.writeFileSync(path.join(eski, '20260101-000000-000-1', 'assets', '57806', 'htmletk', 'x'), 'dogrulanmis');
  function Bozuk(p) {
    const z = new AdmZip(p); const asil = z.extractAllTo;
    z.extractAllTo = (h, ...r) => { asil.call(z, h, ...r); fs.writeFileSync(path.join(h, 'data', 'BookContent.xml'), 'x'); };
    return z;
  }
  const o2 = { ...o };
  const S = m.admZipSar(Bozuk, o.win.__emppIcerik);
  const kaynak = path.join(tmp('s'), 'z.zip'); zipYap(kaynak);
  for (let i = 0; i < 4; i++) {
    assert.throws(() => new S(kaynak).extractAllTo(path.join(o2.BASE, 'assets', '57806'), true));
    await new Promise((r) => setTimeout(r, 3)); // farklı ms damgası
  }
  const gecici = fs.readdirSync(eski).filter((d) => d.startsWith('gecici-57806-'));
  assert.strictEqual(gecici.length, m.ESKI_BASARISIZ_TAVAN);
  assert.ok(fs.existsSync(path.join(eski, '20260101-000000-000-1', 'assets', '57806', 'htmletk', 'x')), 'doğrulanmış kenar yerinde');
  assert.match(fs.readFileSync(path.join(o.WORK, m.LOG_ADI), 'utf8'), /saklama: eski başarısız kenar silindi gecici-57806-/);
});

test('Y-D — kitap dışı zip (hedef assets/<id> değil) açılmaz, RET loglanır, başarısızlık kaydı yazılmaz', () => {
  const o = rendererOrtam();
  const S = o.win.require('adm-zip');
  const kaynak = path.join(tmp('s'), 'mat.zip'); zipYap(kaynak);
  assert.throws(() => new S(kaynak).extractAllTo(path.join(o.BASE, 'materials', 'x'), true), /kitap dışı zip açılmadı/);
  assert.ok(!fs.existsSync(path.join(o.WORK, 'materials')));
  assert.match(fs.readFileSync(path.join(o.WORK, m.LOG_ADI), 'utf8'), /RET: kitap içerik zip'i değil, açılmadı \(hedef: materials\/x\)/);
  assert.ok(!fs.existsSync(path.join(o.WORK, 'materials', 'x', m.BASARISIZ_ADI)));
});

test('Y14b — bir doğrulanmış açma yalnız BİR ilerlemeyi aklar: açma olmadan ikinci artış geri çevrilir', async () => {
  const o = rendererOrtam();
  await motorAkisi(o); // v2→v4 aklandı
  const f = o.win.require('fs');
  const menuYol = path.join(o.BASE, 'classlibraries', 'ImWin32.dll');
  const eski = m.menuCoz(f.readFileSync(menuYol));
  f.writeFileSync(menuYol, m.menuKodla(m.kapakAyarla(eski, '57806', { version: 5, URL: 'u5' })));
  assert.strictEqual(surumOku(path.join(o.WORK, 'classlibraries', 'ImWin32.dll')), 4);
});

test('Y14c — başarılı açmadan SONRA aynı kitapta başarısız açma: menü artışı aklanmaz', () => {
  const o = rendererOrtam();
  const S = o.win.require('adm-zip');
  const iyi = path.join(tmp('s'), 'iyi.zip'); zipYap(iyi);
  const kotu = path.join(tmp('s'), 'kotu.zip'); iciceZip(kotu);
  const hedef = path.join(o.BASE, 'assets', '57806');
  new S(iyi).extractAllTo(hedef, true);                         // doğrulandı (menü henüz yazılmadı)
  assert.throws(() => new S(kotu).extractAllTo(hedef, true));   // sonraki deneme başarısız
  const f = o.win.require('fs');
  const menuYol = path.join(o.BASE, 'classlibraries', 'ImWin32.dll');
  f.writeFileSync(menuYol, m.menuKodla(m.kapakAyarla(m.menuCoz(f.readFileSync(menuYol)), '57806', { version: 5, URL: 'u5' })));
  assert.strictEqual(surumOku(path.join(o.WORK, 'classlibraries', 'ImWin32.dll')), 2);
});
