'use strict';

/**
 * fs-shim × G ÖRTÜSÜ (mac/Pardus, 2026-09-26) — renderer'daki kitap okuyucusu kitap dosyalarını
 * `window.require('fs')` ile okur (ölçüm: SM4 11811 `book1/ab436b32….main.js` — BookContent.xml
 * existsSync+readFileSync, kapak için readdirSync(assets/<id>), imKeys.dll/kurum.txt). G ile
 * EKLENEN kitap pakette yoktur; file: zinciri bu okumaları görmez. Shim OKUMA yolunu örtü
 * okuyucusundan (kitap-guncelleyici `ortuFsOkuyucu`) geçirir; YAZMA yolu (WORK) değişmez.
 * Gerçek G akışı: yerel http + imzalı manifest (listesiz ekle = G yayın aracının biçimi).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const shimMod = require('./fs-shim');
const kg = require('../../runtime/kitap-guncelleyici');
const Y = require('../../runtime/kitap-guncelleyici-ortu.yardimci');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const ACIK = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const imzala = (b) => crypto.sign(null, Buffer.from(b), privateKey).toString('base64');
const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), 'empp-shim-ortu-' + ad + '-'));
const XML = '<Book><Name>Kitap 4</Name></Book>';

async function sunucu(rotalar) {
  const s = http.createServer((i, y) => {
    const r = rotalar[decodeURIComponent(i.url.split('?')[0])];
    if (r == null) { y.statusCode = 404; y.end(); return; }
    const g = Buffer.isBuffer(r) ? r : Buffer.from(typeof r === 'string' ? r : JSON.stringify(r));
    y.setHeader('content-length', String(g.length)); y.end(g);
  });
  await new Promise((c) => s.listen(0, '127.0.0.1', c));
  return { taban: 'http://127.0.0.1:' + s.address().port, kapat: () => new Promise((c) => s.close(c)) };
}

/** Paket (book1, book2) + G: book4 eklenir (listesiz), book2 çıkar, yeni menü. */
async function kur() {
  const kok = tmp('paket');
  const dosya = {
    'index.html': '<html>MENU v1</html>',
    'book1/index.html': '<html>kitap1</html>',
    'book1/assets/1/data/BookContent.xml': '<Book>1</Book>',
    'book2/index.html': '<html>kitap2</html>',
    'package.json': JSON.stringify({ version: '2.5.3' }),
  };
  for (const [y, v] of Object.entries(dosya)) {
    fs.mkdirSync(path.dirname(path.join(kok, y)), { recursive: true });
    fs.writeFileSync(path.join(kok, y), v);
  }
  const set = { sema: 2, setKimligi: '9001', taban: '', imza: { alg: 'ed25519', acikAnahtar: ACIK } };
  fs.writeFileSync(path.join(kok, 'empp-set.json'), JSON.stringify(set));
  const ortuKoku = path.join(tmp('ud'), 'empp-guncelleme');
  const s = await Y.sunucuKurVeYayinla(sunucu, (t) => Y.yayinRotalari({
    tabanUrl: t, imzala, setKimligi: '9001', surum: '2.5.4', listesiz: true,
    kabuk: { 'index.html': '<html>MENU v2</html>' },
    kitaplar: [
      { dizin: 'book2', durum: 'cikar' },
      { dizin: 'book4', durum: 'ekle', dosyalar: {
        'index.html': '<html>kitap4</html>',
        'assets/7/data/BookContent.xml': XML,
        'assets/7/kapak.png': 'PNG7',
      } },
    ],
  }));
  try {
    const r = await kg.guncellemeyiCalistir({ taban: s.taban, set, kok, ortuKoku, gunluk: () => {} });
    assert.equal(r.durum, 'guncellendi', JSON.stringify(r));
  } finally { await s.kapat(); }
  return { kok, ortuKoku, work: tmp('work') };
}

test('ortuFsOkuyucu: eklenen kitabın dosyası örtü nesnesine, dizini var-dizin, gizli kitap ENOENT', async () => {
  const { kok, ortuKoku } = await kur();
  const O = kg.ortuFsOkuyucu({ kok, ortuKoku });
  assert.ok(O, 'okuyucu kurulmalı');
  assert.equal(fs.readFileSync(O.yol(path.join(kok, 'book4/assets/7/data/BookContent.xml')), 'utf8'), XML);
  assert.ok(fs.statSync(O.yol(path.join(kok, 'book4/assets/7'))).isDirectory());
  assert.ok(!fs.existsSync(O.yol(path.join(kok, 'book2/index.html'))), 'gizli kitap okunmamalı');
  assert.equal(O.yol(path.join(kok, 'book1/index.html')), null, 'dokunulmayan paket dosyası: null');
  assert.equal(O.yol('/etc/hosts'), null, 'paket dışı: null');
  assert.deepEqual(O.liste(path.join(kok, 'book4/assets/7')).adlar.sort(), ['data', 'kapak.png']);
  assert.equal(O.liste(path.join(kok, 'book4/assets/7')).tam, true);
  assert.deepEqual(O.liste(kok).cikar, ['book2']);
  assert.ok(O.liste(kok).adlar.includes('book4'));
  assert.equal(kg.ortuFsOkuyucu({ kok, ortuKoku, surum: '2.5.3' }), null, 'ana sürecin sürümü değilse kullanılmaz');
  assert.equal(kg.ortuFsOkuyucu({ kok, ortuKoku: tmp('bos') }), null, 'örtü yoksa null');
});

test('shim OKUMA: kitap okuyucusunun fs okumaları (kitap sayfası BASE=book4) örtüden gelir', async () => {
  const { kok, ortuKoku, work } = await kur();
  const O = kg.ortuFsOkuyucu({ kok, ortuKoku });
  const BASE = path.join(kok, 'book4'); // window.__dirname — pakette YOK
  const s = shimMod.createShim(fs, path, path.join(work, 'book4'), BASE, O);
  const xml = path.join(BASE, 'assets/7/data/BookContent.xml'); // getFilePath(...) biçimi
  assert.equal(s.existsSync(xml), true);
  assert.equal(s.readFileSync(xml, 'utf8'), XML);
  assert.equal(s.existsSync(path.join(BASE, 'assets/7')), true);
  assert.equal(s.statSync(path.join(BASE, 'assets')).isDirectory(), true);
  assert.deepEqual(s.readdirSync(path.join(BASE, 'assets/7')).sort(), ['data', 'kapak.png']);
  const d = s.readdirSync(path.join(BASE, 'assets/7'), { withFileTypes: true });
  assert.equal(d.find((x) => x.name === 'data').isDirectory(), true);
  assert.equal(d.find((x) => x.name === 'kapak.png').isFile(), true);
  assert.deepEqual((await s.promises.readdir(path.join(BASE, 'assets/7'))).sort(), ['data', 'kapak.png']);
  assert.equal(await s.promises.readFile(xml, 'utf8'), XML);
  assert.equal(s.existsSync(path.join(BASE, 'assets/7/data/yok.xml')), false);
});

test('shim OKUMA kök sayfa: kök listesi eklenen kitabı gösterir, gizleneni göstermez', async () => {
  const { kok, ortuKoku, work } = await kur();
  const s = shimMod.createShim(fs, path, work, kok, kg.ortuFsOkuyucu({ kok, ortuKoku }));
  const l = s.readdirSync(kok);
  assert.ok(l.includes('book4') && l.includes('book1'));
  assert.ok(!l.includes('book2'));
  assert.equal(s.existsSync(path.join(kok, 'book2/index.html')), false);
  assert.equal(s.readFileSync(path.join(kok, 'index.html'), 'utf8'), '<html>MENU v2</html>');
  assert.equal(s.readFileSync(path.join(kok, 'book1/index.html'), 'utf8'), '<html>kitap1</html>');
});

test('shim YAZMA yolu DEĞİŞMEZ: yazma WORK\'e gider, örtüye/pakete dokunulmaz; WORK okumada önce gelir', async () => {
  const { kok, ortuKoku, work } = await kur();
  const W = path.join(work, 'book4');
  const BASE = path.join(kok, 'book4');
  const once = Y.agacOzeti(ortuKoku);
  const s = shimMod.createShim(fs, path, W, BASE, kg.ortuFsOkuyucu({ kok, ortuKoku }));
  s.writeFileSync(path.join(BASE, 'temp/data/storage.im'), 'veri');
  assert.equal(fs.readFileSync(path.join(W, 'temp/data/storage.im'), 'utf8'), 'veri');
  s.writeFileSync(path.join(BASE, 'assets/7/data/BookContent.xml'), '<Book>K kanalı</Book>');
  assert.equal(s.readFileSync(path.join(BASE, 'assets/7/data/BookContent.xml'), 'utf8'), '<Book>K kanalı</Book>');
  assert.deepEqual(Y.agacOzeti(ortuKoku), once, 'örtüye yazılmamalı');
  assert.ok(!fs.existsSync(BASE), 'pakete yazılmamalı');
});

test('GERİLEME: örtü okuyucusu yoksa (ORTU null) davranış eskisi — eklenen kitap ENOENT', async () => {
  const { kok, work } = await kur();
  const s = shimMod.createShim(fs, path, work, path.join(kok, 'book4'), null);
  assert.equal(s.existsSync(path.join(kok, 'book4/assets/7/data/BookContent.xml')), false);
  assert.throws(() => s.readdirSync(path.join(kok, 'book4/assets/7')), /ENOENT/);
  assert.equal(s.__empp.ORTU, null);
});

test('ortuOkuyucu (renderer): env yoksa / G modülü yoksa null; ikisi varsa ve sürüm aynıysa okuyucu', async () => {
  const { kok, ortuKoku } = await kur();
  const proc = (env) => ({ env });
  assert.equal(shimMod.ortuOkuyucu(require, fs, path, proc({}), kok), null);
  assert.equal(shimMod.ortuOkuyucu(require, fs, path, proc({ EMPP_G_ORTU_KOKU_ETKIN: ortuKoku }), kok), null,
    'pakette empp-set-guncelleyici.js yoksa null');
  fs.copyFileSync(require.resolve('../../runtime/kitap-guncelleyici'), path.join(kok, 'empp-set-guncelleyici.js'));
  const O = shimMod.ortuOkuyucu(require, fs, path, proc({ EMPP_G_ORTU_KOKU_ETKIN: ortuKoku, EMPP_G_ORTU_SURUM_ETKIN: '2.5.4' }), kok);
  assert.ok(O && O.surum === '2.5.4');
  assert.equal(shimMod.ortuOkuyucu(require, fs, path,
    proc({ EMPP_G_ORTU_KOKU_ETKIN: ortuKoku, EMPP_G_ORTU_SURUM_ETKIN: '2.5.9' }), kok), null, 'sürüm farklı → null');
});

test('ana süreç: örtü kurulunca renderer için env yazılır; örtü geçersizse yazılmaz', async () => {
  const { kok, ortuKoku } = await kur();
  const sahte = () => {
    const app = new EventEmitter();
    app.isReady = () => true;
    app.getPath = () => path.dirname(ortuKoku);
    return { app, protocol: { interceptFileProtocol: () => true }, net: {} };
  };
  const env = {};
  const r = kg.ortuSunucusunuKur({ electron: sahte(), kok, ortuKoku, env, kapsam: {}, gunluk: () => {} });
  assert.equal(r.durum, 'kuruldu', JSON.stringify(r));
  assert.equal(env[kg.ORTU_ENV_ETKIN], ortuKoku);
  assert.equal(env[kg.ORTU_ENV_SURUM], '2.5.4');
  const bozuk = path.join(ortuKoku, kg.ORTU_ETKIN);
  fs.writeFileSync(bozuk, fs.readFileSync(bozuk, 'utf8').replace('"2.5.4"', '"2.5.5"'));
  const env2 = {};
  const r2 = kg.ortuSunucusunuKur({ electron: sahte(), kok, ortuKoku, env: env2, kapsam: {}, gunluk: () => {} });
  assert.equal(r2.durum, 'gecersiz');
  assert.ok(!(kg.ORTU_ENV_ETKIN in env2));
});
